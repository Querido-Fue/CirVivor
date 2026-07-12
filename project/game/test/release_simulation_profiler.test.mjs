import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const profilerModule = await loadGameModule('simulation/release_simulation_profiler.js');
const { ReleaseSimulationProfiler } = profilerModule;

const fixedStepSeconds = 1 / 60;
const profiler = new ReleaseSimulationProfiler({
    frameCapacity: 128,
    fixedCapacity: 128,
    rateWindowMs: 1000,
    quantileWindowMs: 10000,
    snapshotIntervalMs: 1000
});

assert.equal(profiler.setEnabled(true, 0), true);
for (let frame = 1; frame <= 60; frame++) {
    const timestampMs = frame * (1000 / 60);
    profiler.recordFixedStep(timestampMs, frame, true);
    profiler.recordFrame(
        timestampMs,
        frame / 10,
        fixedStepSeconds,
        1,
        frame === 30 ? 2 : 0,
        frame === 40 ? 0.05 : 0,
        fixedStepSeconds,
        frame > 30
    );
}

const snapshot = profiler.getSnapshot();
assert.equal(snapshot.enabled, true);
assert.equal(snapshot.active, true);
assert.ok(Math.abs(snapshot.frameRate - 60) < 1e-9);
assert.ok(Math.abs(snapshot.actualFixedTicksPerSecond - 60) < 1e-9);
assert.ok(Math.abs(snapshot.cumulativeFixedTicksPerSecond - 60) < 1e-9);
assert.ok(Math.abs(snapshot.droppedFixedStepsPerSecond - 2) < 1e-9);
assert.equal(snapshot.totalDroppedFixedStepCount, 2);
assert.equal(snapshot.totalScheduledFixedStepCount, 60);
assert.equal(snapshot.totalCompletedFixedStepCount, 60);
assert.ok(Math.abs(snapshot.totalDroppedDebtSeconds - (2 / 60)) < 1e-9);
assert.ok(Math.abs(snapshot.totalFrameDeltaClampLossSeconds - 0.05) < 1e-9);
assert.ok(Math.abs(snapshot.totalLostSimulationSeconds - ((2 / 60) + 0.05)) < 1e-9);
assert.ok(Math.abs(snapshot.simulationProgressRatio - 1) < 1e-9);
assert.ok(Math.abs(snapshot.cpuBoundFramePercent - 50) < 1e-9);
assert.equal(snapshot.totalCpuBoundEntryCount, 1);
assert.equal(snapshot.frameSampleCount, 60);
assert.equal(snapshot.fixedSampleCount, 60);
assert.ok(Math.abs(snapshot.frameIntervalP50Ms - (1000 / 60)) < 1e-9);
assert.ok(Math.abs(snapshot.frameIntervalP95Ms - (1000 / 60)) < 1e-9);
assert.ok(Math.abs(snapshot.frameIntervalP99Ms - (1000 / 60)) < 1e-9);
assert.ok(Math.abs(snapshot.frameCpuP50Ms - 3) < 1e-9);
assert.ok(Math.abs(snapshot.frameCpuP95Ms - 5.7) < 1e-9);
assert.ok(Math.abs(snapshot.frameCpuP99Ms - 6) < 1e-9);
assert.equal(snapshot.fixedCpuP50Ms, 30);
assert.equal(snapshot.fixedCpuP95Ms, 57);
assert.equal(snapshot.fixedCpuP99Ms, 60);

const pausedTotalFrames = snapshot.frameSampleCount;
profiler.suspend();
profiler.recordFixedStep(5000, 999, true);
profiler.recordFrame(5000, 999, 4, 1, 10, 1, fixedStepSeconds, true);
assert.equal(profiler.getSnapshot().frameSampleCount, pausedTotalFrames);

profiler.resume(5000);
for (let frame = 1; frame <= 30; frame++) {
    const timestampMs = 5000 + (frame * (1000 / 30));
    profiler.recordFixedStep(timestampMs, 2, true);
    profiler.recordFrame(
        timestampMs,
        1,
        1 / 30,
        1,
        0,
        0,
        fixedStepSeconds,
        false
    );
}
const resumedSnapshot = profiler.getSnapshot();
assert.ok(Math.abs(resumedSnapshot.frameRate - 30) < 1e-9);
assert.ok(Math.abs(resumedSnapshot.actualFixedTicksPerSecond - 30) < 1e-9);
assert.equal(resumedSnapshot.frameSampleCount, 30);
assert.equal(resumedSnapshot.fixedSampleCount, 30);

const failedProfiler = new ReleaseSimulationProfiler({
    frameCapacity: 8,
    fixedCapacity: 8,
    snapshotIntervalMs: 1
});
failedProfiler.setEnabled(true, 0);
failedProfiler.recordFixedStep(1, 4, false);
failedProfiler.recordFrame(2, 1, 0.002, 1, 0, 0, fixedStepSeconds, false);
assert.equal(failedProfiler.getSnapshot().totalFailedFixedStepCount, 1);
assert.ok(Math.abs(failedProfiler.getSnapshot().totalLostSimulationSeconds - fixedStepSeconds) < 1e-9);

assert.equal(failedProfiler.setEnabled(false, 3), false);
const disabledSnapshot = failedProfiler.getSnapshot();
const disabledRevision = disabledSnapshot.revision;
assert.equal(disabledSnapshot.enabled, false);
failedProfiler.recordFrame(1000, 100, 1, 10, 10, 1, fixedStepSeconds, true);
assert.equal(failedProfiler.getSnapshot().revision, disabledRevision);

console.log('release simulation profiler contract: ok');
