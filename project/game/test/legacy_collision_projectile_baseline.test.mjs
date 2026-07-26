import assert from 'node:assert/strict';
import {
    checkDefaultLegacyCollisionProjectileBaseline,
    exportDefaultLegacyCollisionProjectileBaseline,
    exportLegacyCollisionNullSinkParity
} from './support/export_legacy_collision_projectile_baseline.mjs';

const first = await checkDefaultLegacyCollisionProjectileBaseline();
const second = await exportDefaultLegacyCollisionProjectileBaseline();
assert.equal(
    JSON.stringify(second),
    JSON.stringify(first),
    '같은 production replay를 두 번 실행한 결과가 byte-identical해야 합니다.'
);

assert.equal(first.records.length, 60);
assert.equal(first.summary.projectileHitCount, 6);
assert.equal(first.summary.totalScanTruncateCount, 22);
assert.equal(first.summary.finalStateHash, '7cbb31b14a9c90e0');

const firstSolve = first.firstSolveInternals;
assert.ok(firstSolve);
assert.equal(firstSolve.grid.gridMode, 'default');
assert.equal(firstSolve.grid.gridDataOnly, false);
assert.equal(firstSolve.grid.bodies.length, 52);
assert.equal(firstSolve.grid.planes.broad.type, 'Float32Array');
assert.equal(firstSolve.grid.planes.broad.stride, 14);
assert.equal(firstSolve.grid.planes.relation.type, 'Float64Array');
assert.equal(firstSolve.grid.planes.relation.stride, 8);
assert.equal(firstSolve.grid.planes.candidateSweep.type, 'Float64Array');
assert.equal(firstSolve.grid.planes.candidateSweep.stride, 8);
assert.match(firstSolve.grid.planes.broad.rawSha256, /^[0-9a-f]{64}$/);
assert.match(firstSolve.grid.planes.relation.rawSha256, /^[0-9a-f]{64}$/);
assert.match(firstSolve.grid.planes.candidateSweep.rawSha256, /^[0-9a-f]{64}$/);
assert.ok(firstSolve.grid.gridCells.length > 1);
assert.ok(firstSolve.candidate.priorityPairs.length > 0);
assert.ok(firstSolve.candidate.normalPairs.length > 0);

const normalFairness = firstSolve.candidate.fairness.find((entry) => entry.enemyId === 1000);
const anchorFairness = firstSolve.candidate.fairness.find((entry) => entry.enemyId === 1100);
assert.equal(normalFairness.visitLimit, 32);
assert.equal(anchorFairness.visitLimit, 64);
assert.equal(firstSolve.candidate.candidateScanEpoch, 0);
assert.equal(firstSolve.candidate.nextCandidateScanEpoch, 1);

const tickZeroTrace = first.traceCheckpoints.find((checkpoint) => checkpoint.tick === 0);
assert.ok(tickZeroTrace);
assert.equal(tickZeroTrace.candidateBuilds.length, 2);
assert.deepEqual(
    tickZeroTrace.solvePasses.map((pass) => ({
        passIndex: pass.passIndex,
        rebuiltGrid: pass.rebuiltGrid,
        rebuiltCandidates: pass.rebuiltCandidates
    })),
    [
        { passIndex: 0, rebuiltGrid: true, rebuiltCandidates: true },
        { passIndex: 1, rebuiltGrid: false, rebuiltCandidates: false },
        { passIndex: 2, rebuiltGrid: true, rebuiltCandidates: true }
    ]
);
assert.ok(tickZeroTrace.candidateBuilds[0].priorityPairCount > 0);
assert.ok(tickZeroTrace.candidateBuilds[0].normalPairCount > 0);
assert.ok(tickZeroTrace.candidateBuilds[0].counters.scanTruncateCount > 0);
assert.equal(tickZeroTrace.projectileTrace.queryCount, 144);
assert.ok(tickZeroTrace.projectileTrace.emptyQueryCount > 0);
assert.ok(
    tickZeroTrace.projectileTrace.candidateQueries.some((query) => (
        query.projectileId === 3004
        && query.candidateOutcomes.some((outcome) => (
            outcome.enemyId === 2006 && outcome.result === 'inactive'
        ))
    )),
    '같은 tick에 비활성화된 target의 skip 사유가 actual sweep trace에 남아야 합니다.'
);

assert.deepEqual(
    first.projectileHits.map((hit) => [
        hit.projectileId,
        hit.enemyId,
        hit.enemyActiveAfterImpact
    ]),
    [
        [3000, 2000, true],
        [3001, 2001, true],
        [3002, 2003, true],
        [3002, 2004, true],
        [3002, 2005, true],
        [3003, 2006, false]
    ]
);
assert.equal(first.projectileHits[0].substep, 1, 'initial overlap가 첫 substep에서 맞아야 합니다.');
assert.ok(first.projectileHits[1].substep > 1, 'fast sweep가 중간 substep에서 맞아야 합니다.');
assert.equal(
    first.projectileHits.some((hit) => hit.projectileId === 3004),
    false,
    '같은 tick에 먼저 비활성화된 target을 다음 projectile이 다시 맞히면 안 됩니다.'
);

const tickZeroState = first.checkpoints.find((checkpoint) => checkpoint.tick === 0).state;
assert.equal(tickZeroState.enemies.find((enemy) => enemy.id === 2006).active, false);
assert.deepEqual(
    tickZeroState.projectiles.find((projectile) => projectile.id === 3004).hitEnemyIds,
    []
);
assert.deepEqual(
    first.records.find((record) => record.tick === 1).releasedEnemyIdsSincePreviousTick,
    [2006]
);
assert.equal(
    first.records.find((record) => record.tick === 6).releasedEnemyIdsSincePreviousTick.length,
    28
);
assert.equal(
    first.sleepEntryTicks.find((entry) => entry.enemyId === 2100).tick,
    46
);

const nullSinkParity = await exportLegacyCollisionNullSinkParity();
assert.equal(
    nullSinkParity.nullSinkStateHash,
    nullSinkParity.defaultStateHash,
    'trace sink를 null로 둔 production 경로의 fixed state가 기본 경로와 같아야 합니다.'
);

console.log(
    `legacy collision/projectile baseline: ${first.records.length} ticks, `
    + `${first.summary.projectileHitCount} hits, ${first.summary.finalStateHash}`
);
