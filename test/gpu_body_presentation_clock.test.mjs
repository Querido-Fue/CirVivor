import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_BODY_PRESENTATION_PROFILE,
    GPU_BODY_PRESENTATION_SHADER_MODE,
    GpuBodyPresentationClock
} = await loadGameModule('ingame/physics/gpu/gpu_body_presentation_clock.js');

test('reference clock은 원본처럼 fixed에서 동기화하고 렌더 frame마다 한 번만 전진한다', () => {
    const clock = new GpuBodyPresentationClock();
    clock.advancePhysics(1 / 60, 10);

    const first = { ...clock.advanceRender({
        frameDelta: 1 / 120,
        renderFrameId: 11,
        fixedAlpha: 0.5
    }) };
    const duplicate = { ...clock.advanceRender({
        frameDelta: 1 / 120,
        renderFrameId: 11,
        fixedAlpha: 0.75
    }) };

    assert.equal(first.presentationMode, GPU_BODY_PRESENTATION_SHADER_MODE.EXTRAPOLATION);
    assert.equal(first.predictionDelta, Math.fround(0.008));
    assert.equal(duplicate.predictionDelta, first.predictionDelta);
    assert.equal(duplicate.interpolationAlpha, 0.75);

    clock.advancePhysics(1 / 60, 11);
    assert.equal(clock.getShaderState().predictionDelta, 0);
    assert.equal(clock.getClockState().renderTime, clock.getClockState().simulationTime);
});

test('reference clock은 발사 프레임이 길어져도 물리 한 틱보다 앞서 예측하지 않는다', () => {
    const clock = new GpuBodyPresentationClock();
    clock.advancePhysics(1 / 60, 20);

    const stalledFrame = clock.advanceRender({
        frameDelta: 0.05,
        renderFrameId: 21,
        fixedAlpha: 0
    });

    assert.equal(stalledFrame.predictionDelta, 1 / 60);
    assert.equal(clock.getClockState().renderTime > clock.getClockState().simulationTime, true);
});

test('capped accumulator profile은 alpha와 fixed delta 범위를 넘지 않는다', () => {
    const clock = new GpuBodyPresentationClock({
        profile: GPU_BODY_PRESENTATION_PROFILE.CAPPED_ACCUMULATOR_EXTRAPOLATION
    });
    clock.advancePhysics(1 / 60, 1);

    assert.equal(clock.advanceRender({
        fixedDelta: 1 / 60,
        fixedAlpha: 2,
        renderFrameId: 2
    }).predictionDelta, 1 / 60);
    assert.equal(clock.advanceRender({
        fixedDelta: 1 / 60,
        fixedAlpha: -1,
        renderFrameId: 3
    }).predictionDelta, 0);
});

test('strict interpolation은 예측 없이 previous/current alpha만 전달한다', () => {
    const clock = new GpuBodyPresentationClock({
        profile: GPU_BODY_PRESENTATION_PROFILE.STRICT_INTERPOLATION
    });
    clock.advancePhysics(0.02, 4);
    const state = clock.advanceRender({
        frameDelta: 0.1,
        fixedAlpha: 0.25,
        renderFrameId: 5
    });

    assert.deepEqual({ ...state }, {
        presentationMode: GPU_BODY_PRESENTATION_SHADER_MODE.STRICT_INTERPOLATION,
        predictionDelta: 0,
        interpolationAlpha: 0.25
    });
});

test('synchronize는 pause/teleport 이후 예측 age를 제거한다', () => {
    const clock = new GpuBodyPresentationClock();
    clock.advancePhysics(1 / 60, 1);
    clock.advanceRender({ frameDelta: 0.05, renderFrameId: 2 });
    assert.equal(clock.getShaderState().predictionDelta, 1 / 60);

    clock.synchronize(2);
    assert.equal(clock.getShaderState().predictionDelta, 0);
    assert.equal(clock.getClockState().renderTime, clock.getClockState().simulationTime);
});

test('지원하지 않는 profile과 비양수 fixed delta는 거부한다', () => {
    assert.throws(() => new GpuBodyPresentationClock({ profile: 'blend-ish' }), /지원하지 않는/);
    const clock = new GpuBodyPresentationClock();
    assert.throws(() => clock.advancePhysics(0), /양수/);
    assert.throws(() => clock.advancePhysics(NaN), /양수/);
});
