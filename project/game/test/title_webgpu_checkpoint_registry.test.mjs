import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const {
    TITLE_WEBGPU_BASE_CHECKPOINT_ID,
    TITLE_WEBGPU_CENTER_BACKDROP_ID,
    TitleWebGpuCheckpointRegistry
} = await loadGameModule('scene/title/webgpu/_title_webgpu_checkpoint_registry.js');

test('checkpoint는 같은 frame/generation에서 한 번 seal되고 immutable descriptor로 조회된다', () => {
    const registry = new TitleWebGpuCheckpointRegistry();
    const device = {};
    const context = { frameId: 4, deviceGeneration: 2, device };
    const texture = {};
    const view = {};
    assert.equal(registry.beginFrame(context), true);
    registry.assertWritable(texture);
    const checkpoint = registry.seal(TITLE_WEBGPU_BASE_CHECKPOINT_ID, {
        texture,
        view,
        width: 1920,
        height: 1080,
        format: 'rgba8unorm'
    });

    assert.equal(Object.isFrozen(checkpoint), true);
    assert.strictEqual(registry.get(TITLE_WEBGPU_BASE_CHECKPOINT_ID, context), checkpoint);
    assert.equal(checkpoint.frameId, 4);
    assert.equal(checkpoint.deviceGeneration, 2);
    assert.equal(checkpoint.colorSpace, 'srgb-compat');
    assert.equal(checkpoint.alphaMode, 'premultiplied');
    assert.throws(() => registry.assertWritable(texture), /seal 이후/);
    assert.throws(() => registry.seal(TITLE_WEBGPU_BASE_CHECKPOINT_ID, {
        texture: {}, view: {}, width: 1, height: 1, format: 'rgba8unorm'
    }), /이미 seal/);
});

test('center backdrop과 overlay checkpoint는 다른 texture/ID이며 seal 후 write가 금지된다', () => {
    const registry = new TitleWebGpuCheckpointRegistry();
    const context = { frameId: 1, deviceGeneration: 1, device: {} };
    const centerTexture = {};
    const outputTexture = {};
    registry.beginFrame(context);
    registry.seal(TITLE_WEBGPU_CENTER_BACKDROP_ID, {
        texture: centerTexture,
        view: {},
        width: 320,
        height: 320,
        format: 'rgba8unorm'
    });
    registry.assertWritable(outputTexture);
    registry.seal(TITLE_WEBGPU_BASE_CHECKPOINT_ID, {
        texture: outputTexture,
        view: {},
        width: 1920,
        height: 1080,
        format: 'rgba8unorm'
    });
    assert.notStrictEqual(
        registry.get(TITLE_WEBGPU_CENTER_BACKDROP_ID).texture,
        registry.get(TITLE_WEBGPU_BASE_CHECKPOINT_ID).texture
    );
    assert.throws(() => registry.seal('duplicate-texture', {
        texture: outputTexture,
        view: {},
        width: 1,
        height: 1,
        format: 'rgba8unorm'
    }), /same|같은/);
});

test('frame/generation/device drift 조회를 거부하고 endFrame에서 texture 참조를 제거한다', () => {
    const registry = new TitleWebGpuCheckpointRegistry();
    const device = {};
    const context = { frameId: 8, deviceGeneration: 3, device };
    registry.beginFrame(context);
    registry.seal(TITLE_WEBGPU_BASE_CHECKPOINT_ID, {
        texture: {}, view: {}, width: 8, height: 8, format: 'rgba8unorm'
    });
    assert.equal(registry.get(TITLE_WEBGPU_BASE_CHECKPOINT_ID, {
        ...context,
        frameId: 7
    }), null);
    assert.equal(registry.get(TITLE_WEBGPU_BASE_CHECKPOINT_ID, {
        ...context,
        deviceGeneration: 2
    }), null);
    assert.equal(registry.get(TITLE_WEBGPU_BASE_CHECKPOINT_ID, {
        ...context,
        device: {}
    }), null);
    assert.equal(registry.endFrame(), true);
    assert.equal(registry.get(TITLE_WEBGPU_BASE_CHECKPOINT_ID), null);
    assert.equal(registry.endFrame(), false);
    assert.equal(registry.beginFrame({ frameId: 9, deviceGeneration: 2, device }), false);
});
