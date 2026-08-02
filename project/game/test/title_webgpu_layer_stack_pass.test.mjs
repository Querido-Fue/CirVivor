import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const {
    TitleWebGpuLayerStackPass,
    TITLE_WEBGPU_LAYER_STACK_SHADER
} = await loadGameModule('scene/title/webgpu/_title_webgpu_layer_stack_pass.js');

function createGpu(id = 'gpu') {
    const calls = {
        id,
        shaderModules: [],
        samplers: [],
        pipelines: [],
        buffers: [],
        bindGroups: [],
        writes: [],
        passes: [],
        forbiddenSubmitCount: 0
    };
    const device = {
        id,
        queue: {
            writeBuffer(buffer, offset, data) {
                calls.writes.push({ buffer, offset, data: new Float32Array(data) });
            },
            submit() {
                calls.forbiddenSubmitCount += 1;
                throw new Error('layer stack이 submit하면 안 됩니다.');
            }
        },
        createShaderModule(descriptor) {
            const module = { id: `${id}:shader:${calls.shaderModules.length}`, descriptor };
            calls.shaderModules.push(module);
            return module;
        },
        createSampler(descriptor) {
            const sampler = { id: `${id}:sampler:${calls.samplers.length}`, descriptor };
            calls.samplers.push(sampler);
            return sampler;
        },
        createRenderPipeline(descriptor) {
            const pipeline = {
                id: `${id}:pipeline:${calls.pipelines.length}`,
                descriptor,
                kind: descriptor.fragment.entryPoint.replace('_fragment', ''),
                getBindGroupLayout(index) {
                    return { id: `${this.id}:layout:${index}`, pipeline: this };
                }
            };
            calls.pipelines.push(pipeline);
            return pipeline;
        },
        createBuffer(descriptor) {
            const buffer = {
                id: `${id}:buffer:${calls.buffers.length}`,
                descriptor,
                destroyCount: 0,
                destroy() { this.destroyCount += 1; }
            };
            calls.buffers.push(buffer);
            return buffer;
        },
        createBindGroup(descriptor) {
            const bindGroup = {
                id: `${id}:bind-group:${calls.bindGroups.length}`,
                descriptor
            };
            calls.bindGroups.push(bindGroup);
            return bindGroup;
        }
    };
    const encoder = {
        beginRenderPass(descriptor) {
            const harness = createRenderPassHarness();
            harness.trace.descriptor = descriptor;
            calls.passes.push(harness.trace);
            return harness.renderPass;
        }
    };
    return { device, encoder, calls };
}

function createRenderPassHarness() {
    const trace = {
        descriptor: null,
        pipelines: [],
        groups: [],
        draws: [],
        events: [],
        endCount: 0
    };
    const renderPass = {
        setPipeline(pipeline) {
            trace.pipelines.push(pipeline);
            trace.events.push(`pipeline:${pipeline.kind}`);
        },
        setBindGroup(index, bindGroup) {
            trace.groups.push({ index, bindGroup });
            trace.events.push(`group:${bindGroup.id}`);
        },
        draw(...args) {
            trace.draws.push(args);
            trace.events.push('draw');
        },
        end() {
            trace.endCount += 1;
        }
    };
    return { renderPass, trace };
}

function createContext(gpu, generation = 4, frameId = 1) {
    return Object.freeze({
        device: gpu.device,
        deviceGeneration: generation,
        frameId,
        encoder: gpu.encoder,
        format: 'rgba8unorm'
    });
}

function textureNode(view, overrides = {}) {
    return {
        kind: 'texture',
        view,
        screenBounds: overrides.screenBounds || { x: 0, y: 0, width: 320, height: 180 },
        sourceLogicalOrigin: overrides.sourceLogicalOrigin || { x: 0, y: 0 },
        sourceLogicalSize: overrides.sourceLogicalSize || { width: 320, height: 180 },
        opacity: overrides.opacity ?? 1,
        contentScale: overrides.contentScale ?? 1,
        contentOrigin: overrides.contentOrigin || { x: 0.5, y: 0.5 }
    };
}

test('texture/dim/vignette node를 입력 순서 그대로 한 offscreen render pass에 그린다', () => {
    const gpu = createGpu('order');
    const stack = new TitleWebGpuLayerStackPass({
        device: gpu.device,
        format: 'rgba8unorm'
    });
    const firstView = { id: 'scene' };
    const secondView = { id: 'overlay-ui' };
    const drawCount = stack.encodeOffscreen(createContext(gpu), {
        targetView: { id: 'target' },
        width: 320,
        height: 180,
        clear: { r: 0.1, g: 0.2, b: 0.3, a: 0.4 },
        nodes: [
            textureNode(firstView),
            { kind: 'dim', color: [0.2, 0.1, 0.05, 0.5], opacity: 0.8 },
            textureNode(secondView, { opacity: 0.75 }),
            { kind: 'vignette', color: [0, 0, 0, 0.7], edgeWidth: 24, cornerRadius: 18 }
        ]
    });

    assert.equal(drawCount, 4);
    assert.equal(gpu.calls.passes.length, 1);
    const trace = gpu.calls.passes[0];
    assert.equal(trace.descriptor.colorAttachments[0].loadOp, 'clear');
    assert.deepEqual({ ...trace.descriptor.colorAttachments[0].clearValue }, {
        r: 0.1,
        g: 0.2,
        b: 0.3,
        a: 0.4
    });
    assert.deepEqual(trace.pipelines.map((pipeline) => pipeline.kind), [
        'texture',
        'dim',
        'texture',
        'vignette'
    ]);
    assert.deepEqual(trace.draws, Array.from({ length: 4 }, () => [6, 1, 0, 0]));
    assert.equal(trace.endCount, 1);
    assert.strictEqual(
        trace.groups[0].bindGroup.descriptor.entries[1].resource,
        firstView
    );
    assert.strictEqual(
        trace.groups[2].bindGroup.descriptor.entries[1].resource,
        secondView
    );
    assert.equal(gpu.calls.forbiddenSubmitCount, 0);
});

test('texture uniform은 logical source mapping과 content scale/origin을 보존한다', () => {
    const gpu = createGpu('mapping');
    const stack = new TitleWebGpuLayerStackPass({
        device: gpu.device,
        format: 'rgba8unorm'
    });
    stack.encodeOffscreen(createContext(gpu), {
        targetView: {},
        width: 800,
        height: 450,
        nodes: [textureNode({}, {
            screenBounds: { x: 100, y: 60, width: 360, height: 240 },
            sourceLogicalOrigin: { x: 80, y: 40 },
            sourceLogicalSize: { width: 720, height: 405 },
            opacity: 0.625,
            contentScale: 0.8,
            contentOrigin: { x: 0.25, y: 0.75 }
        })]
    });

    assert.deepEqual(Array.from(gpu.calls.writes[0].data.slice(0, 12)), [
        800, 450,
        100, 60,
        360, 240,
        80, 40,
        720, 405,
        0.25, 0.75
    ]);
    assert.ok(Math.abs(gpu.calls.writes[0].data[16] - 0.625) < 1e-6);
    assert.ok(Math.abs(gpu.calls.writes[0].data[17] - 0.8) < 1e-6);
    assert.match(
        TITLE_WEBGPU_LAYER_STACK_SHADER,
        /parameters\.contentOrigin \* parameters\.targetSize/u
    );
    assert.match(
        TITLE_WEBGPU_LAYER_STACK_SHADER,
        /parameters\.screenOrigin - scaleOrigin\) \* contentScale/u
    );
    assert.match(
        TITLE_WEBGPU_LAYER_STACK_SHADER,
        /input\.sourceLogicalPosition - parameters\.sourceLogicalOrigin/u
    );
    assert.match(
        TITLE_WEBGPU_LAYER_STACK_SHADER,
        /textureSampleLevel\(layerTexture, layerSampler, sourceUv, 0\.0\)/u
    );
});

test('dim과 vignette는 texture 없이 analytic premultiplied shader를 사용한다', () => {
    const gpu = createGpu('analytic');
    const stack = new TitleWebGpuLayerStackPass({
        device: gpu.device,
        format: 'rgba8unorm'
    });
    stack.encodeOffscreen(createContext(gpu), {
        targetView: {},
        width: 200,
        height: 100,
        clear: false,
        nodes: [
            { kind: 'dim', color: [0.25, 0.5, 0.75, 0.4], opacity: 0.5 },
            { kind: 'vignette', color: [0.1, 0.2, 0.3, 0.8], opacity: 0.75 }
        ]
    });

    assert.equal(gpu.calls.passes[0].descriptor.colorAttachments[0].loadOp, 'load');
    const uniforms = gpu.calls.writes[0].data;
    assert.deepEqual(Array.from(uniforms.slice(12, 15)), [0.25, 0.5, 0.75]);
    assert.ok(Math.abs(uniforms[15] - 0.4) < 1e-6);
    assert.deepEqual(Array.from(uniforms.slice(16, 20)), [0.5, 1, 0, 0]);
    const second = 64;
    assert.ok(Math.abs(uniforms[second + 12] - 0.1) < 1e-6);
    assert.ok(Math.abs(uniforms[second + 15] - 0.8) < 1e-6);
    assert.equal(uniforms[second + 16], 0.75);
    assert.equal(uniforms[second + 18], 18);
    assert.equal(uniforms[second + 19], 20);
    assert.equal(
        gpu.calls.bindGroups
            .map((group) => Array.from(group.descriptor.entries, (entry) => entry.binding).join(','))
            .join('|'),
        '2|2'
    );
    assert.match(TITLE_WEBGPU_LAYER_STACK_SHADER, /parameters\.color\.rgb \* alpha/u);
    assert.match(TITLE_WEBGPU_LAYER_STACK_SHADER, /1\.0 - smoothstep/u);
    assert.doesNotMatch(TITLE_WEBGPU_LAYER_STACK_SHADER, /dither|noise|fract\s*\(|sin\s*\(/iu);
});

test('full-screen present와 ROI offscreen은 같은 logical pixel의 analytic 값을 보존한다', () => {
    const gpu = createGpu('analytic-roi');
    const stack = new TitleWebGpuLayerStackPass({
        device: gpu.device,
        format: 'rgba8unorm'
    });
    const fullNodes = [{
        kind: 'dim',
        color: [0, 0, 0, 0.35],
        opacity: 0.8
    }, {
        kind: 'vignette',
        color: [0, 0, 0, 0.7],
        opacity: 0.9,
        edgeWidth: 18,
        cornerRadius: 12
    }];
    const finalPass = createRenderPassHarness();
    stack.encodeRenderPass(finalPass.renderPass, createContext(gpu), {
        width: 160,
        height: 96,
        nodes: fullNodes
    });

    const crop = { x: 32, y: 16, width: 80, height: 64 };
    const roiNodes = fullNodes.map((node) => ({
        ...node,
        sourceLogicalOrigin: { x: crop.x, y: crop.y },
        sourceLogicalSize: { width: 160, height: 96 }
    }));
    stack.encodeOffscreen(createContext(gpu), {
        targetView: {},
        width: crop.width,
        height: crop.height,
        nodes: roiNodes
    });

    const fullUniforms = gpu.calls.writes[0].data;
    const roiUniforms = gpu.calls.writes[1].data;
    assert.deepEqual(Array.from(fullUniforms.slice(6, 10)), [0, 0, 160, 96]);
    assert.deepEqual(Array.from(roiUniforms.slice(6, 10)), [32, 16, 160, 96]);
    const vignetteSlot = 64;
    assert.deepEqual(
        Array.from(roiUniforms.slice(vignetteSlot + 6, vignetteSlot + 10)),
        [32, 16, 160, 96]
    );
    assert.ok(Math.abs(
        analyticDimAlpha(fullUniforms, 0)
        - analyticDimAlpha(roiUniforms, 0)
    ) < 1e-7);
    for (const [localX, localY] of [
        [0.5, 0.5],
        [40.5, 0.5],
        [79.5, 63.5],
        [40.5, 32.5]
    ]) {
        const fullAlpha = analyticVignetteAlpha(
            fullUniforms,
            vignetteSlot,
            crop.x + localX,
            crop.y + localY
        );
        const roiAlpha = analyticVignetteAlpha(
            roiUniforms,
            vignetteSlot,
            localX,
            localY
        );
        assert.ok(Math.abs(fullAlpha - roiAlpha) < 1e-7);
    }
    assert.equal(finalPass.trace.endCount, 0);
    assert.match(
        TITLE_WEBGPU_LAYER_STACK_SHADER,
        /input\.screenPosition\s*\+ parameters\.sourceLogicalOrigin/u
    );
    assert.match(
        TITLE_WEBGPU_LAYER_STACK_SHADER,
        /let halfSize = logicalTargetSize \* 0\.5/u
    );
});

test('모든 pipeline은 premultiplied blend state를 사용한다', () => {
    const gpu = createGpu('blend');
    const stack = new TitleWebGpuLayerStackPass({
        device: gpu.device,
        format: 'bgra8unorm'
    });
    stack.encodeOffscreen({
        ...createContext(gpu),
        format: 'bgra8unorm'
    }, {
        targetView: {},
        width: 32,
        height: 32,
        nodes: [
            textureNode({}, {
                screenBounds: { x: 0, y: 0, width: 32, height: 32 },
                sourceLogicalSize: { width: 32, height: 32 }
            }),
            { kind: 'dim' },
            { kind: 'vignette' }
        ]
    });
    assert.equal(gpu.calls.pipelines.length, 3);
    for (const pipeline of gpu.calls.pipelines) {
        const target = pipeline.descriptor.fragment.targets[0];
        assert.equal(target.format, 'bgra8unorm');
        assert.deepEqual({ ...target.blend.color }, {
            operation: 'add',
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha'
        });
        assert.deepEqual({ ...target.blend.alpha }, {
            operation: 'add',
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha'
        });
    }
});

test('warm frame은 pipeline/sampler/buffer/bind group을 재사용하고 같은 frame encode는 buffer를 분리한다', () => {
    const gpu = createGpu('warm');
    const stack = new TitleWebGpuLayerStackPass({
        device: gpu.device,
        format: 'rgba8unorm'
    });
    const view = { id: 'warm-view' };
    const nodes = [
        textureNode(view),
        { kind: 'dim', color: [0, 0, 0, 0.2] },
        { kind: 'vignette', edgeWidth: 20, cornerRadius: 10 }
    ];
    stack.encodeOffscreen(createContext(gpu, 4, 1), {
        targetView: {}, width: 320, height: 180, nodes
    });
    const external = createRenderPassHarness();
    stack.encodeRenderPass(external.renderPass, createContext(gpu, 4, 1), {
        width: 320, height: 180, nodes
    });
    assert.equal(external.trace.endCount, 0, 'caller-owned pass를 끝내면 안 됨');
    assert.equal(gpu.calls.buffers.length, 2);
    assert.equal(gpu.calls.bindGroups.length, 6);

    const warmCounts = {
        shaderModules: gpu.calls.shaderModules.length,
        samplers: gpu.calls.samplers.length,
        pipelines: gpu.calls.pipelines.length,
        buffers: gpu.calls.buffers.length,
        bindGroups: gpu.calls.bindGroups.length
    };
    stack.encodeOffscreen(createContext(gpu, 4, 2), {
        targetView: {}, width: 320, height: 180, nodes
    });
    assert.deepEqual({
        shaderModules: gpu.calls.shaderModules.length,
        samplers: gpu.calls.samplers.length,
        pipelines: gpu.calls.pipelines.length,
        buffers: gpu.calls.buffers.length,
        bindGroups: gpu.calls.bindGroups.length
    }, warmCounts);
    assert.equal(stack.getDiagnostics().renderPassEncodeCount, 1);
});

test('fixed device/generation/format drift와 stale frame을 fail-closed 거부하고 destroy한다', () => {
    const first = createGpu('first');
    const second = createGpu('second');
    const stack = new TitleWebGpuLayerStackPass({
        device: first.device,
        format: 'rgba8unorm'
    });
    const input = {
        targetView: {},
        width: 16,
        height: 16,
        nodes: [{ kind: 'dim' }]
    };
    stack.encodeOffscreen(createContext(first, 7, 10), input);
    assert.throws(
        () => stack.encodeOffscreen(createContext(second, 7, 11), input),
        /device drift/
    );
    assert.throws(
        () => stack.encodeOffscreen(createContext(first, 8, 11), input),
        /generation drift/
    );
    assert.throws(
        () => stack.encodeOffscreen(createContext(first, 7, 9), input),
        /stale.*frame/
    );
    assert.throws(
        () => stack.encodeOffscreen({
            ...createContext(first, 7, 11),
            format: 'bgra8unorm'
        }, input),
        /format drift/
    );
    assert.equal(stack.destroy(), true);
    assert.equal(stack.destroy(), false);
    assert.equal(first.calls.buffers[0].destroyCount, 1);
    assert.throws(() => stack.encodeOffscreen(createContext(first, 7, 12), input), /destroy/);
    assert.throws(
        () => new TitleWebGpuLayerStackPass({
            device: first.device,
            format: 'rgba16float'
        }),
        /rgba8unorm, bgra8unorm/
    );
});

test('layer stack source는 presentation acquire/encoder 생성/finish/submit을 소유하지 않는다', async () => {
    const source = await readFile(
        new URL(
            '../script/module/scene/title/webgpu/_title_webgpu_layer_stack_pass.js',
            import.meta.url
        ),
        'utf8'
    );
    for (const forbidden of [
        'getCurrentTexture',
        'acquireFrameTarget',
        'createCommandEncoder',
        'queue.submit',
        '.finish(',
        'markCanvasDrawn',
        'markCanvasCleared'
    ]) {
        assert.equal(source.includes(forbidden), false, `${forbidden} 호출 금지`);
    }
});

function analyticDimAlpha(uniforms, offset) {
    return uniforms[offset + 15] * uniforms[offset + 16];
}

function analyticVignetteAlpha(uniforms, offset, localX, localY) {
    const logicalX = localX + uniforms[offset + 6];
    const logicalY = localY + uniforms[offset + 7];
    const halfWidth = uniforms[offset + 8] * 0.5;
    const halfHeight = uniforms[offset + 9] * 0.5;
    const radius = Math.max(
        0,
        Math.min(uniforms[offset + 19], halfWidth, halfHeight)
    );
    const roundedX = Math.abs(logicalX - halfWidth) - (halfWidth - radius);
    const roundedY = Math.abs(logicalY - halfHeight) - (halfHeight - radius);
    const signedDistance = Math.hypot(
        Math.max(roundedX, 0),
        Math.max(roundedY, 0)
    ) + Math.min(Math.max(roundedX, roundedY), 0) - radius;
    const inwardDistance = Math.max(0, -signedDistance);
    const edgeWidth = Math.max(uniforms[offset + 18], 0.0001);
    const t = Math.max(0, Math.min(1, inwardDistance / edgeWidth));
    const edge = 1 - (t * t * (3 - (2 * t)));
    return uniforms[offset + 15] * uniforms[offset + 16] * edge;
}
