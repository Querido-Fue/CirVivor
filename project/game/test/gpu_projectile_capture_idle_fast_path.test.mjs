import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL(
    '../script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    import.meta.url
), 'utf8');

test('capture hot pass는 captor와 capturable projectile이 함께 있을 때만 열린다', () => {
    assert.match(
        source,
        /this\.projectileCaptureProjectileBodyCount = 0;/u
    );
    assert.match(
        source,
        /captureMeta\.role[\s\S]*?=== GPU_PROJECTILE_CAPTURE_ROLE\.PROJECTILE\) \{[\s\S]*?projectileCaptureProjectileBodyCount\+\+;/u
    );
    assert.match(
        source,
        /const canPublishEmptyProjectileCaptureCompletion[\s\S]*?this\.projectileCaptureDomainBodyCount > 0[\s\S]*?this\.projectileCaptureProjectileBodyCount === 0[\s\S]*?this\.projectileCaptureMaintenanceBodyCount === 0/u
    );
    assert.match(
        source,
        /const needsProjectileCaptureReadback[\s\S]*?this\.projectileCaptureDomainBodyCount > 0[\s\S]*?this\.projectileCaptureProjectileBodyCount > 0[\s\S]*?this\.projectileCaptureMaintenanceBodyCount > 0/u
    );
    assert.match(
        source,
        /\|\| this\.projectileCaptureRetryState !== null[\s\S]*?\|\| armedProjectileCaptureRelease\?\.commitRequested === true[\s\S]*?\|\| terminalProjectileCaptureCancel\?\.state === 'armed'/u
    );
    assert.match(
        source,
        /else if \(canPublishEmptyProjectileCaptureCompletion\) \{[\s\S]*?#publishEmptyProjectileCaptureCompletion\(\{/u
    );
    assert.match(
        source,
        /#publishEmptyProjectileCaptureCompletion\([\s\S]*?completedThroughTick: sourceTick[\s\S]*?status: GPU_PROJECTILE_CAPTURE_TICK_STATUS\.COMPLETE[\s\S]*?captureCount: 0[\s\S]*?releasePreparationCount: 0[\s\S]*?cleanupCount: 0[\s\S]*?completed: true[\s\S]*?#advanceProjectileCaptureCompletionWatermark\(\)/u
    );
});
