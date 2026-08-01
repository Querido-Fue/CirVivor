import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    assertTileNavigationSource
} = await loadGameModule('ingame/contract/tile_navigation_contract.js');
const {
    createRouteFlowFieldAtlas
} = await loadGameModule('ingame/navigation/route_flow_field_atlas.js');
const {
    createGpuSignedDistanceField
} = await loadGameModule('ingame/physics/gpu/gpu_signed_distance_field.js');
const {
    GPU_BENCHMARK_ARENA_LAYOUT,
    GpuBenchmarkNavigationSource,
    createGpuBenchmarkNavigationSource
} = await loadGameModule(
    'scene/benchmark/gpu_benchmark_navigation_source.js'
);

function cellIndex(grid, row, column) {
    return (row * grid.cols) + column;
}

test('GPU benchmark arena는 고정 64x36 layout과 정확한 좌표 경계를 제공한다', () => {
    const source = createGpuBenchmarkNavigationSource();
    const grid = source.getNavigationGrid();
    const bounds = source.getWorldBounds();

    assert.ok(source instanceof GpuBenchmarkNavigationSource);
    assert.strictEqual(assertTileNavigationSource(source), source);
    assert.equal(source.mapId, 'gpu-benchmark-open-arena');
    assert.deepEqual(
        { cols: grid.cols, rows: grid.rows, size: grid.size, cellSize: grid.cellSize },
        { cols: 64, rows: 36, size: 2304, cellSize: 1 }
    );
    assert.deepEqual({ ...bounds }, {
        minX: 0,
        minY: 0,
        maxX: 64,
        maxY: 36,
        width: 64,
        height: 36
    });
    assert.deepEqual(source.worldToTile(0, 0, {}), {
        row: 0,
        column: 0,
        inside: true
    });
    assert.deepEqual(source.worldToTile(63.999, 35.999, {}), {
        row: 35,
        column: 63,
        inside: true
    });
    assert.deepEqual(source.worldToTile(64, 36, {}), {
        row: 36,
        column: 64,
        inside: false
    });
    assert.deepEqual(source.worldToTile(-0.001, -0.001, {}), {
        row: -1,
        column: -1,
        inside: false
    });
    assert.deepEqual(source.tileToWorld(0, 0, {}), {
        x: 0.5,
        y: 0.5,
        row: 0,
        column: 0
    });
    assert.deepEqual(source.tileToWorld(35, 63, {}), {
        x: 63.5,
        y: 35.5,
        row: 35,
        column: 63
    });
    assert.throws(
        () => source.tileToWorld(36, 0, {}),
        (error) => error?.name === 'RangeError'
    );

    assert.ok(Object.isFrozen(source));
    assert.ok(Object.isFrozen(GPU_BENCHMARK_ARENA_LAYOUT));
    assert.ok(Object.isFrozen(GPU_BENCHMARK_ARENA_LAYOUT.worldBounds));
    assert.ok(Object.isFrozen(GPU_BENCHMARK_ARENA_LAYOUT.staticWalls));
    assert.ok(Object.isFrozen(GPU_BENCHMARK_ARENA_LAYOUT.initialBoxes));
    assert.equal(GPU_BENCHMARK_ARENA_LAYOUT.staticWalls.length, 2);
    assert.equal(GPU_BENCHMARK_ARENA_LAYOUT.initialBoxes.length, 3);
    for (const rectangle of [
        ...GPU_BENCHMARK_ARENA_LAYOUT.staticWalls,
        ...GPU_BENCHMARK_ARENA_LAYOUT.initialBoxes
    ]) {
        assert.ok(Object.isFrozen(rectangle));
        assert.equal(rectangle.origin, 'center');
    }
});

test('고정 벽과 상자는 같은 layout에서 blocked grid로 정확히 rasterize된다', () => {
    const source = createGpuBenchmarkNavigationSource();
    const grid = source.getNavigationGrid();
    const blockedCount = grid.blocked.reduce((count, value) => count + value, 0);

    assert.equal(blockedCount, 99);

    // 왼쪽/오른쪽 세로벽은 각각 2x18 셀입니다.
    assert.equal(grid.blocked[cellIndex(grid, 9, 15)], 1);
    assert.equal(grid.blocked[cellIndex(grid, 26, 16)], 1);
    assert.equal(grid.blocked[cellIndex(grid, 18, 14)], 0);
    assert.equal(grid.blocked[cellIndex(grid, 9, 47)], 1);
    assert.equal(grid.blocked[cellIndex(grid, 26, 48)], 1);
    assert.equal(grid.blocked[cellIndex(grid, 18, 49)], 0);

    // 세 box는 각각 겹치지 않는 3x3 셀입니다.
    assert.equal(grid.blocked[cellIndex(grid, 10, 25)], 1);
    assert.equal(grid.blocked[cellIndex(grid, 25, 38)], 1);
    assert.equal(grid.blocked[cellIndex(grid, 27, 23)], 1);
    assert.equal(grid.blocked[cellIndex(grid, 8, 25)], 0);
    assert.equal(grid.blocked[cellIndex(grid, 27, 38)], 0);
    assert.equal(grid.blocked[cellIndex(grid, 29, 23)], 0);
});

test('네 direct route와 중앙 target은 walkable이며 GPU navigation 산출물과 호환된다', () => {
    const source = createGpuBenchmarkNavigationSource();
    const grid = source.getNavigationGrid();
    const target = source.getCorePosition();
    const tower = source.getTowerSpawnPosition();
    const routes = source.getSpawnRoutes();

    assert.strictEqual(target, tower);
    assert.deepEqual(
        {
            x: target.x,
            y: target.y,
            row: target.row,
            column: target.column
        },
        { x: 32, y: 18, row: 18, column: 32 }
    );
    assert.equal(source.isWalkableTile(target.row, target.column), true);
    assert.deepEqual(source.worldToTile(target.x, target.y, {}), {
        row: target.row,
        column: target.column,
        inside: true
    });
    assert.equal(routes.length, 4);
    assert.deepEqual(
        Array.from(routes, (route) => route.gateId),
        [
            'benchmark-left-gate',
            'benchmark-right-gate',
            'benchmark-top-gate',
            'benchmark-bottom-gate'
        ]
    );
    for (const route of routes) {
        assert.ok(Object.isFrozen(route));
        assert.ok(Object.isFrozen(route.waypoints));
        assert.equal(route.waypoints.length, 2);
        assert.strictEqual(route.entryPoint, route.waypoints[0]);
        assert.strictEqual(route.coreAttackPoint, target);
        assert.strictEqual(route.waypoints[1], target);
        assert.equal(
            source.isWalkableTile(route.entryPoint.row, route.entryPoint.column),
            true
        );
    }
    assert.equal(routes[0].entryPoint.y, target.y);
    assert.equal(routes[1].entryPoint.y, target.y);
    assert.equal(routes[2].entryPoint.x, target.x);
    assert.equal(routes[3].entryPoint.x, target.x);

    const atlas = createRouteFlowFieldAtlas(source);
    assert.equal(atlas.cols, 64);
    assert.equal(atlas.rows, 36);
    assert.equal(atlas.fieldCount, 4);
    assert.equal(atlas.routes.length, 4);
    assert.deepEqual({ x: atlas.origin.x, y: atlas.origin.y }, { x: 0, y: 0 });
    for (let fieldIndex = 0; fieldIndex < atlas.fieldCount; fieldIndex++) {
        const stage = atlas.stages[fieldIndex];
        assert.deepEqual(
            { column: stage.goalCell.column, row: stage.goalCell.row },
            { column: target.column, row: target.row }
        );
        const goalDirectionOffset = (
            (fieldIndex * atlas.size) + stage.goalIndex
        ) * 2;
        assert.equal(atlas.directions[goalDirectionOffset], 0);
        assert.equal(atlas.directions[goalDirectionOffset + 1], 0);

        const entry = routes[fieldIndex].entryPoint;
        const entryDirectionOffset = (
            (fieldIndex * atlas.size)
                + cellIndex(grid, entry.row, entry.column)
        ) * 2;
        assert.ok(
            Math.hypot(
                atlas.directions[entryDirectionOffset],
                atlas.directions[entryDirectionOffset + 1]
            ) > 0
        );
    }

    const sdf = createGpuSignedDistanceField(grid);
    assert.equal(sdf.cols, 64);
    assert.equal(sdf.rows, 36);
    assert.equal(sdf.worldWidth, 64);
    assert.equal(sdf.worldHeight, 36);
    assert.notStrictEqual(sdf.blocked, grid.blocked);
    assert.equal(sdf.blocked[cellIndex(grid, 18, 15)], 1);
    assert.ok(sdf.values[cellIndex(grid, 18, 15)] <= 0);
    assert.equal(sdf.blocked[cellIndex(grid, target.row, target.column)], 0);
    assert.ok(sdf.values[cellIndex(grid, target.row, target.column)] > 0);
});
