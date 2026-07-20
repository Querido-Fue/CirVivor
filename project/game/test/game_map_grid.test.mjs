import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const dataModule = await loadGameModule('data/scene/game/game_map_data.js');
const gridModule = await loadGameModule('scene/game/map/game_map_grid.js');
const { GAME_MAP_DATA } = dataModule;
const {
    normalizeGameMapId,
    resolveGameMapDefinition,
    isGameMapFloorCell,
    isResolvedGameMapFloorCell,
    buildGameMapGeometry
} = gridModule;
const defaultMap = resolveGameMapDefinition(GAME_MAP_DATA.DEFAULT_MAP_ID);

/**
 * 두 수가 허용 오차 안에서 같은지 확인합니다.
 * @param {number} actual - 실제 값입니다.
 * @param {number} expected - 기대 값입니다.
 * @param {string} label - 실패 메시지에 사용할 이름입니다.
 * @param {number} [epsilon=1e-9] - 허용 오차입니다.
 */
function assertNear(actual, expected, label, epsilon = 1e-9) {
    assert.ok(
        Math.abs(actual - expected) <= epsilon,
        `${label}: expected ${expected}, received ${actual}`
    );
}

assert.ok(Object.isFrozen(GAME_MAP_DATA));
assert.ok(Object.isFrozen(GAME_MAP_DATA.TILE_TYPES));
assert.ok(Object.isFrozen(GAME_MAP_DATA.WORLD_LAYOUT));
assert.ok(Object.isFrozen(GAME_MAP_DATA.MAPS));
assert.ok(defaultMap);
assert.ok(Object.isFrozen(defaultMap));
assert.ok(Object.isFrozen(defaultMap.tiles));
assert.ok(Object.isFrozen(defaultMap.playerSpawn));
assert.equal(defaultMap.rows, 11);
assert.equal(defaultMap.columns, 15);
assert.equal(defaultMap.tiles.length, defaultMap.rows);
for (const tileRow of defaultMap.tiles) {
    assert.equal(tileRow.length, defaultMap.columns);
}

assert.equal(normalizeGameMapId(' d_corridor_01 '), 'd_corridor_01');
assert.equal(normalizeGameMapId('unknown_map'), GAME_MAP_DATA.DEFAULT_MAP_ID);
assert.equal(resolveGameMapDefinition('unknown_map'), defaultMap);
assert.equal(isGameMapFloorCell(defaultMap, -1, 0), false);
assert.equal(isGameMapFloorCell(defaultMap, 0, defaultMap.columns), false);
assert.equal(isGameMapFloorCell({
    id: 'invalid_tile_map',
    rows: 1,
    columns: 1,
    tiles: ['X']
}, 0, 0), false);

let floorCount = 0;
for (let row = 0; row < defaultMap.rows; row++) {
    for (let column = 0; column < defaultMap.columns; column++) {
        const expectedFloor = row < 3 || row >= 8 || column >= 12;
        assert.equal(
            isGameMapFloorCell(defaultMap, row, column),
            expectedFloor,
            `예상하지 못한 타일: row=${row}, column=${column}`
        );
        assert.equal(
            isResolvedGameMapFloorCell(defaultMap, row, column),
            expectedFloor,
            `resolved 조회가 다른 타일: row=${row}, column=${column}`
        );
        floorCount += expectedFloor ? 1 : 0;
    }
}
assert.equal(floorCount, 105);
assert.equal(
    isGameMapFloorCell(defaultMap, defaultMap.playerSpawn.row, defaultMap.playerSpawn.column),
    true
);
assert.equal(isResolvedGameMapFloorCell(defaultMap, -1, 0), false);
assert.equal(isResolvedGameMapFloorCell(defaultMap, 0, defaultMap.columns), false);
assert.equal(isResolvedGameMapFloorCell(null, 0, 0), isGameMapFloorCell(null, 0, 0));
const customMap = { id: 'custom', rows: 1, columns: 1, tiles: ['F'] };
assert.equal(
    isResolvedGameMapFloorCell(customMap, 0, 0),
    isGameMapFloorCell(customMap, 0, 0)
);

// 전역 검증 intrinsic이 바뀌면 등록 맵 전용 조회도 범용 계약의 호출·결과로 fallback합니다.
const moduleGlobal = normalizeGameMapId.constructor('return globalThis')();
const originalArrayIsArrayDescriptor = Object.getOwnPropertyDescriptor(
    moduleGlobal.Array,
    'isArray'
);
const originalNumberIsIntegerDescriptor = Object.getOwnPropertyDescriptor(
    moduleGlobal.Number,
    'isInteger'
);
const genericIntrinsicTrace = [];
const resolvedIntrinsicTrace = [];

function installTrackedMapIntrinsics(trace) {
    Object.defineProperty(moduleGlobal.Array, 'isArray', {
        ...originalArrayIsArrayDescriptor,
        value(value) {
            trace.push('Array.isArray');
            return originalArrayIsArrayDescriptor.value(value);
        }
    });
    Object.defineProperty(moduleGlobal.Number, 'isInteger', {
        ...originalNumberIsIntegerDescriptor,
        value(value) {
            trace.push(`Number.isInteger:${String(value)}`);
            return originalNumberIsIntegerDescriptor.value(value);
        }
    });
}

try {
    installTrackedMapIntrinsics(genericIntrinsicTrace);
    const genericPatchedResult = isGameMapFloorCell(defaultMap, 0, 0);
    installTrackedMapIntrinsics(resolvedIntrinsicTrace);
    const resolvedPatchedResult = isResolvedGameMapFloorCell(defaultMap, 0, 0);
    assert.equal(resolvedPatchedResult, genericPatchedResult);
    assert.deepEqual(resolvedIntrinsicTrace, genericIntrinsicTrace);
} finally {
    Object.defineProperty(moduleGlobal.Array, 'isArray', originalArrayIsArrayDescriptor);
    Object.defineProperty(moduleGlobal.Number, 'isInteger', originalNumberIsIntegerDescriptor);
}

const visited = new Set();
const pending = [{ row: 0, column: 0 }];
while (pending.length > 0) {
    const cell = pending.pop();
    const key = `${cell.row}:${cell.column}`;
    if (visited.has(key) || !isGameMapFloorCell(defaultMap, cell.row, cell.column)) {
        continue;
    }
    visited.add(key);
    pending.push(
        { row: cell.row - 1, column: cell.column },
        { row: cell.row + 1, column: cell.column },
        { row: cell.row, column: cell.column - 1 },
        { row: cell.row, column: cell.column + 1 }
    );
}
assert.equal(visited.size, floorCount);

const viewport = Object.freeze({ ww: 1200, objectWH: 900 });
const geometry = buildGameMapGeometry(defaultMap.id, viewport);
const expectedCellSize = Math.min(
    (viewport.ww * GAME_MAP_DATA.WORLD_LAYOUT.MAX_WIDTH_RATIO) / defaultMap.columns,
    (viewport.objectWH * GAME_MAP_DATA.WORLD_LAYOUT.MAX_OBJECT_HEIGHT_RATIO) / defaultMap.rows
);
assertNear(geometry.cellSize, expectedCellSize, '정사각 셀 크기');
assertNear(geometry.width, geometry.cellSize * geometry.columns, '맵 너비');
assertNear(geometry.height, geometry.cellSize * geometry.rows, '맵 높이');
assertNear(geometry.originX + (geometry.width * 0.5), viewport.ww * 0.5, '가로 중앙 정렬');
assertNear(geometry.originY + (geometry.height * 0.5), viewport.objectWH * 0.5, '세로 중앙 정렬');
assert.equal(geometry.mapId, defaultMap.id);
assert.equal(geometry.rows, defaultMap.rows);
assert.equal(geometry.columns, defaultMap.columns);
assert.equal(geometry.tileGapRatio, GAME_MAP_DATA.WORLD_LAYOUT.TILE_GAP_CELL_RATIO);
assert.equal(geometry.floorLocalCenters.length, floorCount);
for (const center of geometry.floorLocalCenters) {
    assert.equal(isGameMapFloorCell(defaultMap, center.row, center.column), true);
    assertNear(center.x, center.column + 0.5, '바닥 셀 단위 로컬 중심 x');
    assertNear(center.y, center.row + 0.5, '바닥 셀 단위 로컬 중심 y');
}
assertNear(
    geometry.playerSpawn.x,
    geometry.originX + ((defaultMap.playerSpawn.column + 0.5) * geometry.cellSize),
    '플레이어 스폰 x'
);
assertNear(
    geometry.playerSpawn.y,
    geometry.originY + ((defaultMap.playerSpawn.row + 0.5) * geometry.cellSize),
    '플레이어 스폰 y'
);

const expectedWallThickness = Math.max(
    GAME_MAP_DATA.WORLD_LAYOUT.WALL_MIN_THICKNESS_PX,
    geometry.cellSize * GAME_MAP_DATA.WORLD_LAYOUT.WALL_THICKNESS_CELL_RATIO
);
assert.equal(geometry.boundaryWalls.length, 8);
let mergedBoundaryCellLength = 0;
for (const wall of geometry.boundaryWalls) {
    for (const value of [wall.x, wall.y, wall.w, wall.h]) {
        assert.equal(Number.isFinite(value), true);
    }
    assert.ok(wall.w > 0);
    assert.ok(wall.h > 0);
    assert.equal(wall.origin, 'center');

    const isHorizontal = Math.abs(wall.h - expectedWallThickness) <= 1e-9;
    const isVertical = Math.abs(wall.w - expectedWallThickness) <= 1e-9;
    assert.ok(isHorizontal || isVertical);
    mergedBoundaryCellLength += isHorizontal
        ? wall.w / geometry.cellSize
        : wall.h / geometry.cellSize;
}
assertNear(mergedBoundaryCellLength, 76, '병합 벽의 전체 경계 길이');

const fallbackGeometry = buildGameMapGeometry('unknown_map', {
    ww: Number.NaN,
    objectWH: -10
});
assert.equal(fallbackGeometry.mapId, GAME_MAP_DATA.DEFAULT_MAP_ID);
for (const value of [
    fallbackGeometry.originX,
    fallbackGeometry.originY,
    fallbackGeometry.cellSize,
    fallbackGeometry.width,
    fallbackGeometry.height,
    fallbackGeometry.playerSpawn.x,
    fallbackGeometry.playerSpawn.y
]) {
    assert.equal(Number.isFinite(value), true);
}

console.log('game map grid contract: ok');
