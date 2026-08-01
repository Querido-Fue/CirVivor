import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const {
    CORRIDOR_EIGHT_MAP_DATA
} = await loadGameModule('data/scene/game/corridor_eight_map_data.js');
const { createTileMap } = await loadGameModule('ingame/map/tile_map.js');
const {
    createGpuSignedDistanceField,
    createGpuSignedDistanceFieldSnapshot,
    sampleGpuSignedDistanceField,
    sampleGpuWorldSignedDistance,
    sampleSignedDistanceFieldBilinear,
    signedDistanceToWorldAabb
} = await loadGameModule('ingame/physics/gpu/gpu_signed_distance_field.js');

const EPSILON = 1e-6;

/**
 * Float32 값을 허용 오차로 비교합니다.
 * @param {number} actual - 실제 값입니다.
 * @param {number} expected - 기대 값입니다.
 * @param {string} message - 실패 메시지입니다.
 */
function assertNear(actual, expected, message) {
    assert.ok(
        Math.abs(actual - expected) <= EPSILON,
        `${message}: expected=${expected}, actual=${actual}`
    );
}

/**
 * row/column 위치의 SDF 값을 읽습니다.
 * @param {object} snapshot - SDF snapshot입니다.
 * @param {number} row - 행입니다.
 * @param {number} column - 열입니다.
 * @returns {number} 거리 값입니다.
 */
function valueAt(snapshot, row, column) {
    return snapshot.values[(row * snapshot.cols) + column];
}

// 3x3 중앙 장애물은 자기 셀만 seed가 되고 모든 거리는 그 중심에서 측정됩니다.
const sourceBlocked = new Uint8Array([
    0, 0, 0,
    0, 1, 0,
    0, 0, 0
]);
const threeByThree = createGpuSignedDistanceField({
    cols: 3,
    rows: 3,
    size: 9,
    cellSize: 2,
    blocked: sourceBlocked
});
assert.strictEqual(createGpuSignedDistanceFieldSnapshot, createGpuSignedDistanceField);
assert.equal(threeByThree.worldWidth, 6);
assert.equal(threeByThree.worldHeight, 6);
assertNear(valueAt(threeByThree, 0, 0), Math.fround(Math.SQRT2 * 2), '3x3 NW');
assert.equal(valueAt(threeByThree, 0, 1), 2);
assertNear(valueAt(threeByThree, 0, 2), Math.fround(Math.SQRT2 * 2), '3x3 NE');
assert.equal(valueAt(threeByThree, 1, 0), 2);
assert.ok(Object.is(valueAt(threeByThree, 1, 1), -0));
assert.equal(valueAt(threeByThree, 1, 2), 2);
assertNear(valueAt(threeByThree, 2, 0), Math.fround(Math.SQRT2 * 2), '3x3 SW');
assert.equal(valueAt(threeByThree, 2, 1), 2);
assertNear(valueAt(threeByThree, 2, 2), Math.fround(Math.SQRT2 * 2), '3x3 SE');

// snapshot은 TileMap typed array의 시점 복사이며 이후 원본 변경을 보지 않습니다.
assert.notStrictEqual(threeByThree.blocked, sourceBlocked);
sourceBlocked.fill(1);
assert.deepEqual(Array.from(threeByThree.blocked), [
    0, 0, 0,
    0, 1, 0,
    0, 0, 0
]);

// 현재 54x30 corridor의 방향성과 대표 거리값을 golden으로 고정합니다.
const tileMap = createTileMap(CORRIDOR_EIGHT_MAP_DATA.id);
const corridor = createGpuSignedDistanceField(tileMap.getNavigationGrid());
assert.equal(corridor.cols, 54);
assert.equal(corridor.rows, 30);
assert.equal(corridor.size, 1620);
assert.equal(valueAt(corridor, 3, 8), -2);
assert.equal(valueAt(corridor, 8, 3), 3);
assert.ok(Object.is(valueAt(corridor, 11, 8), -0));
assert.equal(valueAt(corridor, 12, 8), 1);
assert.equal(valueAt(corridor, 14, 45), 3);
// 원본의 27→13→6→3→1 step은 power-of-two JFA가 아니므로 이 먼 셀은 근사값입니다.
assert.equal(valueAt(corridor, 0, 53), -19.92485809326172);

// 수동 bilinear는 texel 중심에서 원본 값을 보존하고 맵 바깥은 edge clamp합니다.
assert.strictEqual(sampleSignedDistanceFieldBilinear, sampleGpuSignedDistanceField);
assert.ok(Object.is(sampleGpuSignedDistanceField(threeByThree, 3, 3), 0));
assertNear(
    sampleGpuSignedDistanceField(threeByThree, 2, 3),
    1,
    'walkable/blocked 중간 bilinear'
);
assert.equal(sampleGpuSignedDistanceField(threeByThree, -100, 3), 2);
assertNear(
    sampleGpuSignedDistanceField(threeByThree, -100, -100),
    Math.fround(Math.SQRT2 * 2),
    'NW edge clamp'
);

const bounds = Object.freeze({ minX: 0, minY: 0, maxX: 6, maxY: 6 });
assert.equal(signedDistanceToWorldAabb(bounds, 3, 3), 3);
assert.ok(Object.is(signedDistanceToWorldAabb(bounds, 0, 3), -0));
assert.equal(signedDistanceToWorldAabb(bounds, -0.5, 3), -0.5);
assertNear(
    signedDistanceToWorldAabb(bounds, -1, -1),
    -Math.SQRT2,
    'AABB outside corner'
);
assert.equal(sampleGpuWorldSignedDistance(threeByThree, bounds, 1, 3), 1);
assert.equal(sampleGpuWorldSignedDistance(threeByThree, bounds, -0.5, 3), -0.5);
assert.ok(Object.is(sampleGpuWorldSignedDistance(threeByThree, bounds, 3, 3), 0));

// 잘못된 grid, 좌표와 AABB는 조용히 보정하지 않습니다.
assert.throws(
    () => createGpuSignedDistanceField({
        cols: 1,
        rows: 1,
        size: 1,
        cellSize: 1,
        blocked: new Int8Array(1)
    }),
    (error) => error?.name === 'TypeError'
);
assert.throws(
    () => sampleGpuSignedDistanceField(threeByThree, Number.NaN, 0),
    (error) => error?.name === 'TypeError'
);
assert.throws(
    () => signedDistanceToWorldAabb(
        { minX: 0, minY: 0, maxX: 0, maxY: 1 },
        0,
        0
    ),
    (error) => error?.name === 'RangeError'
);

console.log('gpu signed distance field contract: ok');
