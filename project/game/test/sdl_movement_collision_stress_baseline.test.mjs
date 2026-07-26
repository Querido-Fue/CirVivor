import assert from 'node:assert/strict';
import { exportDefaultGameSystemBaseline } from './support/export_sdl_game_system_baseline.mjs';
import {
    checkDefaultMovementCollisionStressBaseline,
    exportMovementCollisionStressBaseline,
    measureMovementCollisionStress,
    readMovementCollisionStressFixture
} from './support/export_sdl_movement_collision_stress_baseline.mjs';

const sourceFixture = await readMovementCollisionStressFixture();
const baseline = await checkDefaultMovementCollisionStressBaseline();
const repeatedBaseline = await exportMovementCollisionStressBaseline(sourceFixture);

assert.deepEqual(repeatedBaseline, baseline);
assert.equal(baseline.schemaVersion, 1);
assert.equal(baseline.source.fixedStep.hz, 60);
assert.equal(baseline.source.participantCount, 800);
assert.equal(
    baseline.source.participantKind,
    'independent production movement circles'
);
assert.equal(
    baseline.summary.integrateCallCount,
    sourceFixture.participantCount * sourceFixture.fixedStep.tickCount
);
assert.equal(
    baseline.summary.resolverCallCount,
    sourceFixture.participantCount * sourceFixture.fixedStep.tickCount
);
assert.ok(baseline.summary.positionCorrectionCount > 0);
assert.ok(baseline.summary.tileProbeCount > 0);
assert.ok(
    baseline.summary.maximumTileProbesPerResolve
        <= baseline.operationBudget.maxTileProbesPerResolve
);
assert.ok(
    baseline.summary.maximumPositionCorrectionsPerResolve
        <= baseline.operationBudget.maxPositionCorrectionsPerResolve
);
assert.ok(
    baseline.summary.tileProbeCount
        <= baseline.operationBudget.maxTotalTileProbes
);
assert.ok(
    baseline.summary.positionCorrectionCount
        <= baseline.operationBudget.maxTotalPositionCorrections
);
assert.match(baseline.initialStateHash, /^[0-9a-f]{16}$/);
assert.match(baseline.recordsDigest, /^[0-9a-f]{16}$/);
assert.match(baseline.summary.finalStateHash, /^[0-9a-f]{16}$/);
assert.deepEqual(
    baseline.checkpoints.map(({ tick }) => tick),
    sourceFixture.checkpointTicks
);

assert.deepEqual(baseline.oracle.excludedGameplayClaims, [
    'participants are enemies',
    'participants are projectiles',
    'dynamic participants collide with each other',
    'overlay blur or rendering is measured'
]);
assert.ok(
    baseline.oracle.unavailableCapabilities.includes(
        'tick heap-allocation telemetry'
    )
);

const gameSystemBaseline = await exportDefaultGameSystemBaseline();
assert.deepEqual(
    [...new Set(gameSystemBaseline.records.map(({ entityCount }) => entityCount))],
    [2]
);
assert.deepEqual(
    [...new Set(gameSystemBaseline.records.map(({ projectileCount }) => projectileCount))],
    [0]
);
assert.ok(
    gameSystemBaseline.oracle.unavailableCapabilities.includes('projectiles')
);
assert.ok(
    gameSystemBaseline.oracle.unavailableCapabilities.includes(
        'general contact stream'
    )
);

const informationalTiming = await measureMovementCollisionStress(sourceFixture);
assert.equal(
    informationalTiming.classification,
    'informational-only-not-a-pass-fail-gate'
);
assert.ok(Number.isFinite(informationalTiming.elapsedMilliseconds));
assert.ok(informationalTiming.elapsedMilliseconds >= 0);
assert.ok(Number.isFinite(informationalTiming.participantStepsPerSecond));
console.log(
    'SDL movement/collision stress informational timing: '
    + `${informationalTiming.elapsedMilliseconds.toFixed(2)} ms (not a gate)`
);
