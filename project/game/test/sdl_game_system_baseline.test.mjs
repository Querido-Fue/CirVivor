import assert from 'node:assert/strict';
import {
    checkDefaultGameSystemBaseline,
    exportGameSystemBaseline,
    hashBaselineValue,
    readReplayFixture
} from './support/export_sdl_game_system_baseline.mjs';

const replayFixture = await readReplayFixture();
const baseline = await checkDefaultGameSystemBaseline();
const repeatedBaseline = await exportGameSystemBaseline(replayFixture);

assert.deepEqual(repeatedBaseline, baseline);
assert.equal(baseline.schemaVersion, 1);
assert.equal(baseline.oracle.hashAlgorithm, 'fnv1a64-utf8');
assert.equal(baseline.oracle.canonicalEncoding, 'cirvivor-canonical-v1-f64be');
assert.equal(baseline.replay.fixedStep.hz, 60);
assert.equal(baseline.records.length, replayFixture.fixedStep.tickCount);
assert.equal(baseline.records[0].tick, 0);
assert.equal(baseline.records.at(-1).tick, replayFixture.fixedStep.tickCount - 1);

assert.equal(baseline.staticWorld.mapId, 'corridor_eight_01');
assert.equal(baseline.staticWorld.tileGrid.cols, 54);
assert.equal(baseline.staticWorld.tileGrid.rows, 30);
assert.equal(baseline.staticWorld.tileGrid.size, 1620);
assert.equal(baseline.staticWorld.tileGrid.walkableTileCount, 828);
assert.equal(baseline.staticWorld.spawnRoutes.length, 1);
assert.equal(baseline.staticWorld.spawnRoutes[0].gateId, 'west-gate-01');
assert.equal(baseline.staticWorld.spawnRoutes[0].waypoints.length, 25);

for (const record of baseline.records) {
    assert.match(record.inputHash, /^[0-9a-f]{16}$/);
    assert.match(record.stateHash, /^[0-9a-f]{16}$/);
    assert.match(record.eventsHash, /^[0-9a-f]{16}$/);
    assert.equal(record.rngState, null);
    assert.equal(record.entityCount, 2);
    assert.equal(record.projectileCount, 0);
    assert.equal(record.contactCount, 0);
}

assert.ok(baseline.summary.totalTileCorrectionCount > 0);
assert.ok(baseline.summary.maximumTowerSpeed > 0);
assert.equal(
    baseline.summary.finalStateHash,
    baseline.records.at(-1).stateHash
);

const initialTower = baseline.initialState.entities.find(({ id }) => id === 'the-tower');
const firstCheckpointTower = baseline.checkpoints[0].state.entities.find(
    ({ id }) => id === 'the-tower'
);
const finalTower = baseline.checkpoints.at(-1).state.entities.find(
    ({ id }) => id === 'the-tower'
);
assert.ok(firstCheckpointTower.physics.position.x > initialTower.physics.position.x);
assert.deepEqual(finalTower.moveIntent, { x: 0, y: 0 });
assert.deepEqual(finalTower.physics.velocity, { x: 0, y: 0 });

const opposingHorizontalCheckpoint = baseline.checkpoints.find(({ tick }) => tick === 341);
const opposingTower = opposingHorizontalCheckpoint.state.entities.find(
    ({ id }) => id === 'the-tower'
);
assert.equal(opposingTower.moveIntent.x, 0);
assert.equal(opposingTower.moveIntent.y, -1);

const resizedFixture = JSON.parse(JSON.stringify(replayFixture));
resizedFixture.viewport = { ww: 1280, wh: 720 };
const resizedBaseline = await exportGameSystemBaseline(resizedFixture);
assert.equal(resizedBaseline.staticWorldHash, baseline.staticWorldHash);
assert.deepEqual(
    resizedBaseline.records.map(({ stateHash }) => stateHash),
    baseline.records.map(({ stateHash }) => stateHash)
);

const unknownMapFixture = JSON.parse(JSON.stringify(replayFixture));
unknownMapFixture.mapId = 'unknown-map-must-not-fallback';
await assert.rejects(
    exportGameSystemBaseline(unknownMapFixture),
    /등록된 production 맵과 일치하지 않습니다/
);

assert.notEqual(
    hashBaselineValue({ x: 0 }),
    hashBaselineValue({ x: -0 })
);
assert.equal(
    hashBaselineValue({ a: 1, b: 2 }),
    hashBaselineValue({ b: 2, a: 1 })
);

console.log('SDL GameSystem replay/state-hash baseline contract: ok');
