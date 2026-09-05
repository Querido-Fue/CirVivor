import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const {
    TitleWebGpuCompositePass,
    TITLE_WEBGPU_COMPOSITE_SHADER
} = await loadGameModule('scene/title/webgpu/_title_webgpu_composite_pass.js');

function createGpu() {
    const calls = {
        pipelines: [],
        buffers: [],
        bindGroups: [],
        writes: [],
        passes: []
    };
    const device = {
        queue: {
            writeBuffer(buffer, offset, data) {
                calls.writes.push({ buffer, offset, data: new Float32Array(data) });
            }
        },
        createShaderModule(descriptor) { return { descriptor }; },
        createSampler(descriptor) { return { descriptor }; },
        createRenderPipeline(descriptor) {
            calls.pipelines.push(descriptor);
            return {
                descriptor,
                getBindGroupLayout() { return { id: calls.pipelines.length }; }
            };
        },
        createBuffer(descriptor) {
            const buffer = { descriptor, destroyCount: 0, destroy() { this.destroyCount++; } };
            calls.buffers.push(buffer);
            return buffer;
        },
        createBindGroup(descriptor) {
            const bindGroup = { descriptor };
            calls.bindGroups.push(bindGroup);
            return bindGroup;
        }
    };
    const encoder = {
        beginRenderPass(descriptor) {
            const trace = { descriptor, pipeline: null, scissors: [], groups: [], draws: [], ended: false };
            calls.passes.push(trace);
            return {
                setPipeline(value) { trace.pipeline = value; },
                setScissorRect(...value) { trace.scissors.push(value); },
                setBindGroup(...value) { trace.groups.push(value); },
                draw(...value) { trace.draws.push(value); },
                end() { trace.ended = true; }
            };
        }
    };
    return { device, encoder, calls };
}

function context(gpu, generation = 1, frameId = 1) {
    return {
        device: gpu.device,
        deviceGeneration: generation,
        frameId,
        encoder: gpu.encoder,
        format: 'rgba8unorm'
    };
}

test('premultiplied layer를 입력 순서와 ROI scissor로 한 render pass에 합성한다', () => {
    const gpu = createGpu();
    const pass = new TitleWebGpuCompositePass();
    const firstView = { id: 'scene' };
    const secondView = { id: 'effect' };
    pass.encode(context(gpu), {
        targetView: { id: 'target' },
        targetWidth: 100,
        targetHeight: 80,
        layers: [
            {
                view: firstView,
                destX: 0,
                destY: 0,
                destWidth: 100,
                destHeight: 80
            },
            {
                view: secondView,
                destX: -2.5,
                destY: 10.2,
                destWidth: 22,
                destHeight: 30,
                uvWidth: 0.5,
                uvHeight: 0.75,
                opacity: 0.4
            }
        ]
    });

    assert.equal(gpu.calls.passes.length, 1);
    assert.equal(gpu.calls.passes[0].descriptor.colorAttachments[0].loadOp, 'clear');
    assert.deepEqual(gpu.calls.passes[0].scissors, [
        [0, 0, 100, 80],
        [0, 10, 20, 31]
    ]);
    assert.deepEqual(gpu.calls.passes[0].draws, [
        [6, 1, 0, 0],
        [6, 1, 0, 0]
    ]);
    assert.strictEqual(
        gpu.calls.passes[0].groups[0][1].descriptor.entries[1].resource,
        firstView
    );
    assert.strictEqual(
        gpu.calls.passes[0].groups[1][1].descriptor.entries[1].resource,
        secondView
    );
    const uniforms = gpu.calls.writes[0].data;
    assert.deepEqual(Array.from(uniforms.slice(0, 11)), [
        100, 80, 0, 0, 100, 80, 0, 0, 1, 1, 1
    ]);
    assert.equal(uniforms[64 + 6], 0);
    assert.equal(uniforms[64 + 8], 0.5);
    assert.ok(Math.abs(uniforms[64 + 10] - 0.4) < 1e-6);
});

test('warm frame은 pipeline/sampler/buffer/bind group을 재사용하고 같은 frame 다중 encode는 buffer를 분리한다', () => {
    const gpu = createGpu();
    const pass = new TitleWebGpuCompositePass({ maxLayers: 2 });
    const sourceView = { id: 'source' };
    const input = {
        targetView: { id: 'target' },
        targetWidth: 32,
        targetHeight: 32,
        layers: [{
            view: sourceView,
            destX: 0,
            destY: 0,
            destWidth: 32,
            destHeight: 32
        }]
    };
    pass.encode(context(gpu, 1, 1), input);
    pass.encode(context(gpu, 1, 1), input);
    assert.equal(gpu.calls.buffers.length, 2);
    assert.equal(gpu.calls.bindGroups.length, 2);

    pass.encode(context(gpu, 1, 2), input);
    assert.equal(gpu.calls.pipelines.length, 1);
    assert.equal(gpu.calls.buffers.length, 2);
    assert.equal(gpu.calls.bindGroups.length, 2);
    assert.equal(pass.getDiagnostics().uniformBufferCreateCount, 2);
});

test('generation drift는 buffer/cache를 폐기하고 stale/device identity drift를 거부한다', () => {
    const first = createGpu();
    const second = createGpu();
    const pass = new TitleWebGpuCompositePass();
    const input = {
        targetView: {},
        targetWidth: 8,
        targetHeight: 8,
        layers: [{ view: {}, destX: 0, destY: 0, destWidth: 8, destHeight: 8 }]
    };
    pass.encode(context(first, 2, 5), input);
    assert.throws(() => pass.encode(context(first, 1, 6), input), /stale.*generation/);
    assert.throws(() => pass.encode(context(second, 2, 6), input), /device drift/);
    pass.encode(context(second, 3, 6), input);
    assert.equal(first.calls.buffers[0].destroyCount, 1);
    assert.equal(second.calls.pipelines.length, 1);
    assert.equal(pass.destroy(), true);
    assert.equal(pass.destroy(), false);
    assert.equal(second.calls.buffers[0].destroyCount, 1);
});

test('shader/pipeline은 premultiplied alpha와 top-left pixel 좌표 계약을 보존한다', () => {
    assert.match(TITLE_WEBGPU_COMPOSITE_SHADER, /opacity:\s*f32,\s*padding:\s*f32,/u);
    assert.match(TITLE_WEBGPU_COMPOSITE_SHADER, /destinationOrigin \+ corner \* parameters\.destinationSize/);
    assert.match(TITLE_WEBGPU_COMPOSITE_SHADER, /1\.0 - \(pixel\.y \/ parameters\.targetSize\.y\) \* 2\.0/);
    assert.match(TITLE_WEBGPU_COMPOSITE_SHADER, /textureSample\(sourceTexture, sourceSampler, input\.uv\) \* parameters\.opacity/);
    const gpu = createGpu();
    const pass = new TitleWebGpuCompositePass();
    pass.encode(context(gpu), {
        targetView: {},
        targetWidth: 4,
        targetHeight: 4,
        layers: [{ view: {}, destX: 0, destY: 0, destWidth: 4, destHeight: 4 }]
    });
    const blend = gpu.calls.pipelines[0].fragment.targets[0].blend;
    assert.deepEqual({ ...blend.color }, {
        operation: 'add',
        srcFactor: 'one',
        dstFactor: 'one-minus-src-alpha'
    });
    assert.deepEqual({ ...blend.alpha }, {
        operation: 'add',
        srcFactor: 'one',
        dstFactor: 'one-minus-src-alpha'
    });
});

test('composite source는 presentation acquire/finish/submit/mark를 소유하지 않는다', async () => {
    const source = await readFile(
        new URL('../project/game/script/module/scene/title/webgpu/_title_webgpu_composite_pass.js', import.meta.url),
        'utf8'
    );
    assert.doesNotMatch(source, /getCurrentTexture|acquireFrameTarget|createCommandEncoder/);
    assert.doesNotMatch(source, /\.finish\s*\(|queue\.submit|markCanvas(?:Drawn|Cleared)/);
});
