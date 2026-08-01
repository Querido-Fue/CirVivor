import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { WebGpuUiAtlasRegistry } = await loadGameModule(
    'display/webgpu/webgpu_ui_atlas_registry.js'
);

function createGpu(label) {
    const calls = {
        createTexture: [],
        createView: 0,
        copy: [],
        destroy: 0
    };
    const device = {
        label,
        queue: {
            copyExternalImageToTexture(...args) {
                calls.copy.push(args);
            }
        },
        createTexture(descriptor) {
            calls.createTexture.push(descriptor);
            return {
                descriptor,
                createView() {
                    calls.createView += 1;
                    return { textureLabel: label, index: calls.createView };
                },
                destroy() {
                    calls.destroy += 1;
                }
            };
        }
    };
    return { device, calls };
}

function frame(device, deviceGeneration = 1, frameId = 1) {
    return { device, deviceGeneration, frameId };
}

test('같은 source/revision은 upload와 packet allocation 없이 exact slot을 재사용한다', () => {
    const gpu = createGpu('a');
    const registry = new WebGpuUiAtlasRegistry();
    const source = { width: 120, height: 40 };
    const first = registry.getOrUpload({
        context: frame(gpu.device),
        source,
        revision: 3,
        capacityWidth: 256,
        capacityHeight: 64
    });
    const second = registry.getOrUpload({
        context: frame(gpu.device, 1, 2),
        source,
        revision: 3,
        capacityWidth: 256,
        capacityHeight: 64
    });

    assert.strictEqual(second, first);
    assert.equal(gpu.calls.createTexture.length, 1);
    assert.equal(gpu.calls.createTexture[0].usage, 0x02 | 0x04 | 0x10);
    assert.equal(gpu.calls.copy.length, 1);
    assert.equal(first.uvScaleX, 120 / 256);
    assert.equal(first.uvScaleY, 40 / 64);
    assert.deepEqual({ ...registry.getDiagnostics() }, {
        destroyed: false,
        deviceGeneration: 1,
        lastFrameId: 2,
        entryCount: 1,
        maxEntries: 8,
        allocationCount: 1,
        uploadCount: 1,
        uploadedPixelCount: 4800,
        cacheHitCount: 1,
        evictionCount: 0,
        destroyCount: 0,
        generationChangeCount: 0
    });
});

test('revision/실제 크기 dirty는 1회 upload하고 capacity 안에서는 texture를 재할당하지 않는다', () => {
    const gpu = createGpu('a');
    const registry = new WebGpuUiAtlasRegistry();
    const source = { width: 100, height: 50 };
    registry.getOrUpload({
        context: frame(gpu.device),
        source,
        revision: 0,
        capacityWidth: 160,
        capacityHeight: 80
    });
    source.width = 140;
    const resized = registry.getOrUpload({
        context: frame(gpu.device, 1, 2),
        source,
        revision: 1,
        capacityWidth: 160,
        capacityHeight: 80
    });

    assert.equal(gpu.calls.createTexture.length, 1);
    assert.equal(gpu.calls.copy.length, 2);
    assert.equal(resized.width, 140);
    assert.equal(resized.revision, 1);
    assert.equal(gpu.calls.copy[1][2].width, 140);
    assert.equal(gpu.calls.copy[1][1].premultipliedAlpha, true);
});

test('capacity grow와 generation 변경은 이전 texture를 폐기하고 정확히 한 번 재업로드한다', () => {
    const firstGpu = createGpu('a');
    const secondGpu = createGpu('b');
    const registry = new WebGpuUiAtlasRegistry();
    const source = { width: 40, height: 20 };
    registry.getOrUpload({ context: frame(firstGpu.device), source, revision: 1 });
    source.width = 80;
    registry.getOrUpload({
        context: frame(firstGpu.device, 1, 2),
        source,
        revision: 2
    });
    registry.getOrUpload({
        context: frame(secondGpu.device, 2, 3),
        source,
        revision: 2
    });

    assert.equal(firstGpu.calls.createTexture.length, 2);
    assert.equal(firstGpu.calls.destroy, 2);
    assert.equal(secondGpu.calls.createTexture.length, 1);
    assert.equal(secondGpu.calls.copy.length, 1);
    assert.equal(registry.getDiagnostics().generationChangeCount, 1);
});

test('bounded LRU eviction과 destroy는 source texture를 정확히 한 번 폐기한다', () => {
    const gpu = createGpu('a');
    const registry = new WebGpuUiAtlasRegistry({ maxEntries: 2 });
    const a = { width: 1, height: 1 };
    const b = { width: 1, height: 1 };
    const c = { width: 1, height: 1 };
    registry.getOrUpload({ context: frame(gpu.device, 1, 1), source: a, revision: 0 });
    registry.getOrUpload({ context: frame(gpu.device, 1, 2), source: b, revision: 0 });
    registry.getOrUpload({ context: frame(gpu.device, 1, 3), source: a, revision: 0 });
    registry.getOrUpload({ context: frame(gpu.device, 1, 4), source: c, revision: 0 });

    assert.equal(registry.getDiagnostics().entryCount, 2);
    assert.equal(registry.getDiagnostics().evictionCount, 1);
    assert.equal(gpu.calls.destroy, 1);
    assert.equal(registry.destroy(), true);
    assert.equal(registry.destroy(), false);
    assert.equal(gpu.calls.destroy, 3);
});

test('stale generation/frame와 same-generation device drift는 upload 전에 거부한다', () => {
    const firstGpu = createGpu('a');
    const secondGpu = createGpu('b');
    const registry = new WebGpuUiAtlasRegistry();
    const source = { width: 4, height: 4 };
    registry.getOrUpload({
        context: frame(firstGpu.device, 3, 8),
        source,
        revision: 0
    });

    assert.throws(() => registry.getOrUpload({
        context: frame(firstGpu.device, 2, 9),
        source,
        revision: 1
    }), /stale.*generation/);
    assert.throws(() => registry.getOrUpload({
        context: frame(firstGpu.device, 3, 7),
        source,
        revision: 1
    }), /stale.*frame/);
    assert.throws(() => registry.getOrUpload({
        context: frame(secondGpu.device, 3, 9),
        source,
        revision: 1
    }), /device drift/);
    assert.equal(firstGpu.calls.copy.length, 1);
    assert.equal(secondGpu.calls.copy.length, 0);
});

test('registry source는 canvas 획득/encoder finish/submit/presentation mark를 소유하지 않는다', async () => {
    const sourceText = await import('node:fs/promises').then(({ readFile }) => readFile(
        new URL('../script/module/display/webgpu/webgpu_ui_atlas_registry.js', import.meta.url),
        'utf8'
    ));
    assert.doesNotMatch(sourceText, /getCurrentTexture|acquireFrameTarget|createCommandEncoder/);
    assert.doesNotMatch(sourceText, /\.finish\s*\(|queue\.submit|markCanvas(?:Drawn|Cleared)/);
    assert.match(sourceText, /copyExternalImageToTexture/);
});
