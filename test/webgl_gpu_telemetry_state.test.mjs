import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const telemetryState = await loadGameModule(
    'display/webgl/_webgl_gpu_telemetry_state.js'
);

test('WebGL GPU telemetry frame clock은 비활성일 때 멈추고 활성 frame만 증가한다', () => {
    telemetryState.setWebGLGpuTelemetryEnabled(false);
    telemetryState.resetWebGLGpuTelemetryFrameId();

    assert.equal(telemetryState.isWebGLGpuTelemetryEnabled(), false);
    assert.equal(telemetryState.advanceWebGLGpuTelemetryFrame(), 0);
    assert.equal(telemetryState.getWebGLGpuTelemetryFrameId(), 0);

    assert.equal(telemetryState.setWebGLGpuTelemetryEnabled(true), true);
    assert.equal(telemetryState.advanceWebGLGpuTelemetryFrame(), 1);
    assert.equal(telemetryState.advanceWebGLGpuTelemetryFrame(), 2);
    assert.equal(telemetryState.getWebGLGpuTelemetryFrameId(), 2);

    assert.equal(telemetryState.setWebGLGpuTelemetryEnabled(false), false);
    assert.equal(telemetryState.advanceWebGLGpuTelemetryFrame(), 2);
});

test('WebGL GPU telemetry trial reset은 활성 상태를 유지하고 frame ID만 초기화한다', () => {
    telemetryState.setWebGLGpuTelemetryEnabled(true);
    telemetryState.advanceWebGLGpuTelemetryFrame();
    const previousGeneration = telemetryState.getWebGLGpuTelemetryTrialGeneration();
    telemetryState.resetWebGLGpuTelemetryFrameId();

    assert.equal(telemetryState.isWebGLGpuTelemetryEnabled(), true);
    assert.equal(telemetryState.getWebGLGpuTelemetryFrameId(), 0);
    assert.equal(
        telemetryState.getWebGLGpuTelemetryTrialGeneration(),
        previousGeneration + 1
    );
    assert.equal(telemetryState.advanceWebGLGpuTelemetryFrame(), 1);

    telemetryState.setWebGLGpuTelemetryEnabled(false);
    telemetryState.resetWebGLGpuTelemetryFrameId();
});

test('retiring collector는 surface destroy 뒤 pending query와 마지막 frame을 손실 없이 배출한다', () => {
    telemetryState.resetRetiredWebGLGpuTelemetry();
    telemetryState.setWebGLGpuTelemetryEnabled(true);
    telemetryState.resetWebGLGpuTelemetryFrameId();
    const generation = telemetryState.getWebGLGpuTelemetryTrialGeneration();
    let available = false;
    let pendingCount = 1;
    let sampleCount = 0;
    let destroyed = false;
    const ring = {
        poll() {
            if (available && pendingCount > 0) {
                pendingCount = 0;
                sampleCount = 1;
            }
        },
        drainSamples() {
            if (sampleCount === 0) {
                return [];
            }
            sampleCount = 0;
            return [{
                scope: 'title.overlay_blur_composite.gpu_ms',
                frameId: 12,
                rendererId: 'retired-modal',
                trialGeneration: generation,
                gpuMs: 0.75
            }];
        },
        getSnapshot() {
            return {
                status: 'ready',
                active: false,
                pendingCount,
                sampleCount,
                rejectedBeginCount: 0,
                disjointCount: 0,
                discardedQueryCount: 0,
                apiFailureCount: 0
            };
        },
        destroy() {
            destroyed = true;
        }
    };

    assert.equal(telemetryState.retireWebGLGpuTelemetryCollector({
        rendererId: 'retired-modal',
        timerQueryRing: ring,
        frameSamples: [{
            rendererId: 'retired-modal',
            trialGeneration: generation,
            frameId: 12,
            blurRefreshCount: 1
        }]
    }), true);

    let drained = telemetryState.drainRetiredWebGLGpuTelemetry();
    assert.equal(drained.gpuSamples.length, 0);
    assert.equal(drained.frameSamples.length, 1);
    assert.equal(drained.collectorSnapshots[0].completed, false);
    assert.equal(drained.state.collectorCount, 1);
    assert.equal(destroyed, false);

    available = true;
    telemetryState.advanceWebGLGpuTelemetryFrame();
    drained = telemetryState.drainRetiredWebGLGpuTelemetry();
    assert.deepEqual(Array.from(drained.gpuSamples, (sample) => ({
        rendererId: sample.rendererId,
        trialGeneration: sample.trialGeneration,
        frameId: sample.frameId,
        gpuMs: sample.gpuMs
    })), [{
        rendererId: 'retired-modal',
        trialGeneration: generation,
        frameId: 12,
        gpuMs: 0.75
    }]);
    assert.equal(drained.collectorSnapshots[0].completed, true);
    assert.equal(drained.state.collectorCount, 0);
    assert.equal(drained.state.droppedGpuSampleCount, 0);
    assert.equal(drained.state.droppedFrameSampleCount, 0);
    assert.equal(destroyed, true);

    telemetryState.setWebGLGpuTelemetryEnabled(false);
    telemetryState.resetRetiredWebGLGpuTelemetry();
});
