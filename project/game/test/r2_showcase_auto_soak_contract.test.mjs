import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const bootstrapSource = await readFile(
    new URL('./nw_r2_showcase_manual/bootstrap.js', import.meta.url),
    'utf8'
);

test('manual showcase 자동 soak는 명시적 환경 변수에서만 bounded telemetry를 남기고 Safe Exit한다', () => {
    assert.match(
        bootstrapSource,
        /CIRVIVOR_R2_SHOWCASE_AUTO_SOAK_SECONDS/
    );
    assert.match(bootstrapSource, /globalThis\.nw\?\.process \?\? globalThis\.process/);
    assert.match(bootstrapSource, /Math\.min\(600, seconds\) \* 1000/);
    assert.match(bootstrapSource, /AUTO_SOAK_READY_TIMEOUT_MS = 30_000/);
    assert.match(
        bootstrapSource,
        /snapshot\.fixedTick > 0[\s\S]*runtimeState === 'gpu-ready'/
    );
    assert.match(bootstrapSource, /snapshot\.windowFocused === true/);
    assert.match(bootstrapSource, /snapshot\.loopRunning === true/);
    assert.match(bootstrapSource, /previousActiveSnapshot/);
    assert.match(
        bootstrapSource,
        /snapshot\.fixedTick > previousActiveSnapshot\.fixedTick/
    );
    assert.match(bootstrapSource, /catch \(error\) \{\s*lastSnapshotError = error;/);
    assert.match(bootstrapSource, /fixedTicksPerSecond/);
    assert.match(bootstrapSource, /scheduledFixedStepCount/);
    assert.match(bootstrapSource, /frameDeltaSecondsTotal/);
    assert.match(bootstrapSource, /rafTimestampDeltaMsTotal/);
    assert.match(bootstrapSource, /debugFrameModeHistogram/);
    assert.match(bootstrapSource, /catchUpMaximumStepHistogram/);
    assert.match(bootstrapSource, /allFrameCpuMs/);
    assert.match(bootstrapSource, /rafFrameDeltaMs/);
    assert.match(bootstrapSource, /wallFrameDeltaMs/);
    assert.match(bootstrapSource, /longFrameSamples/);
    assert.match(bootstrapSource, /pulsePhase: Number\.isInteger\(fixedTick\) \? fixedTick % 120/);
    assert.match(bootstrapSource, /frameGapMs/);
    assert.match(bootstrapSource, /requestAutoSoakForeground/);
    assert.match(bootstrapSource, /fixedTicksPerActiveSimulationSecond/);
    assert.match(bootstrapSource, /foregroundCoverageRatio/);
    assert.match(bootstrapSource, /partialFixedFrameCount/);
    assert.match(bootstrapSource, /detailedPhaseTimings/);
    assert.match(bootstrapSource, /objectFixed/);
    assert.match(bootstrapSource, /waveQueueSpawns/);
    assert.match(bootstrapSource, /projectileCapture/);
    assert.match(bootstrapSource, /atomicTransform/);
    assert.match(bootstrapSource, /routeAvailability/);
    assert.match(bootstrapSource, /routeRuntimeSnapshot/);
    assert.match(bootstrapSource, /routeRuntimeStatus/);
    assert.match(bootstrapSource, /routeReadbackBypassEligibleSampleCount/);
    assert.match(bootstrapSource, /maximumRouteProjectileThreatBodyCount/);
    assert.match(bootstrapSource, /maximumActiveBodyCount/);
    assert.match(bootstrapSource, /recoveryRestartCount/);
    assert.match(bootstrapSource, /firstRecoveryFailure/);
    assert.match(bootstrapSource, /R2_AUTO_SOAK_RESULT /);
    assert.match(bootstrapSource, /CIRVIVOR_R2_SHOWCASE_AUTO_TARGET/);
    assert.match(bootstrapSource, /performance-map-2/);
    assert.match(bootstrapSource, /api\.selectPerformanceMap\(\)/);
    assert.match(bootstrapSource, /CIRVIVOR_R2_SHOWCASE_RECEIPT_IDENTITY/);
    assert.match(bootstrapSource, /persistAutoSoakReceipt/);
    assert.match(bootstrapSource, /worktreeContentKey/);
    assert.match(bootstrapSource, /PERFORMANCE_DEFINITION_SPAWN_COUNTS/);
    assert.match(bootstrapSource, /acceptedSpawnCountByDefinitionId/);
    assert.match(bootstrapSource, /requiredWorkloadCompleted/);
    assert.match(bootstrapSource, /getReleaseSimulationProfilerSnapshot/);
    assert.match(bootstrapSource, /getWebGpuFrameTelemetryPort/);
    assert.match(bootstrapSource, /frameTelemetryPort\.setEnabled\(true\)/);
    assert.match(bootstrapSource, /totalCompletedFixedStepCount/);
    assert.match(bootstrapSource, /totalFailedFixedStepCount === 0/);
    assert.match(bootstrapSource, /totalDroppedFixedStepCount === 0/);
    assert.match(bootstrapSource, /totalLostSimulationSeconds === 0/);
    assert.match(bootstrapSource, /simulationProgressRatio/);
    assert.match(bootstrapSource, /fixedCpuP50Ms/);
    assert.match(bootstrapSource, /fixedCpuP95Ms/);
    assert.match(bootstrapSource, /fixedCpuP99Ms/);
    assert.match(bootstrapSource, /unexpectedCapacityOverflowCount === 0/);
    assert.match(bootstrapSource, /uncapturedErrorCount === 0/);
    assert.match(bootstrapSource, /requiredStorageBuffersPerShaderStage <= 9/);
    assert.match(bootstrapSource, /protocolFailureCount === 0/);

    const autoSoakStart = bootstrapSource.indexOf('\nasync function bootstrap()');
    const catchStart = bootstrapSource.indexOf('\nbootstrap().catch', autoSoakStart);
    assert.ok(autoSoakStart >= 0);
    assert.ok(catchStart > autoSoakStart);
    const autoSoakBody = bootstrapSource.slice(autoSoakStart, catchStart);
    assert.match(autoSoakBody, /if \(autoSoakDurationMs <= 0\) \{\s*return;/);
    assert.match(autoSoakBody, /api\.selectWave\(1\);/);
    assert.match(bootstrapSource, /setReleaseSimulationProfilerEnabled\(true/);
    assert.match(autoSoakBody, /setReleaseSimulationProfilerEnabled\(false/);
    assert.match(autoSoakBody, /finally \{[\s\S]*api\.safeExit\(\);/);
});
