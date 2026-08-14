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
    assert.match(bootstrapSource, /catch \(error\) \{\s*lastSnapshotError = error;/);
    assert.match(bootstrapSource, /fixedTicksPerSecond/);
    assert.match(bootstrapSource, /scheduledFixedStepCount/);
    assert.match(bootstrapSource, /frameDeltaSecondsTotal/);
    assert.match(bootstrapSource, /rafTimestampDeltaMsTotal/);
    assert.match(bootstrapSource, /debugFrameModeHistogram/);
    assert.match(bootstrapSource, /catchUpMaximumStepHistogram/);
    assert.match(bootstrapSource, /allFrameCpuMs/);
    assert.match(bootstrapSource, /requestAutoSoakForeground/);
    assert.match(bootstrapSource, /fixedTicksPerActiveSimulationSecond/);
    assert.match(bootstrapSource, /foregroundCoverageRatio/);
    assert.match(bootstrapSource, /partialFixedFrameCount/);
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

    const autoSoakStart = bootstrapSource.indexOf('\nasync function bootstrap()');
    const catchStart = bootstrapSource.indexOf('\nbootstrap().catch', autoSoakStart);
    assert.ok(autoSoakStart >= 0);
    assert.ok(catchStart > autoSoakStart);
    const autoSoakBody = bootstrapSource.slice(autoSoakStart, catchStart);
    assert.match(autoSoakBody, /if \(autoSoakDurationMs <= 0\) \{\s*return;/);
    assert.match(autoSoakBody, /api\.selectWave\(1\);/);
    assert.match(autoSoakBody, /finally \{\s*api\.safeExit\(\);/);
});
