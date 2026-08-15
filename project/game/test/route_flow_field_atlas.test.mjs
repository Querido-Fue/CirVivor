import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { createTileMap } = await loadGameModule('ingame/map/tile_map.js');
const {
    ROUTE_FLOW_FIELD_NO_NEXT_LAYER,
    createRouteFlowFieldAtlas
} = await loadGameModule('ingame/navigation/route_flow_field_atlas.js');

test('자기 교차 route는 distinct stage goal source와 metadata를 결정적으로 컴파일한다', () => {
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const repeated = createRouteFlowFieldAtlas(tileMap);
    const pathWidth = tileMap.getPathWidthTiles();
    const navigationGrid = tileMap.getNavigationGrid();
    const uniqueGoalCellCount = new Set(route.waypoints.slice(1).map((waypoint) => (
        `${Math.floor((waypoint.y - atlas.origin.y) / atlas.cellSize)}:`
        + `${Math.floor((waypoint.x - atlas.origin.x) / atlas.cellSize)}`
    ))).size;

    assert.equal(atlas.cols, navigationGrid.cols / pathWidth);
    assert.equal(atlas.rows, navigationGrid.rows / pathWidth);
    assert.equal(atlas.cellSize, navigationGrid.cellSize * pathWidth);
    assert.equal(atlas.fieldCount, route.waypoints.length - 1);
    assert.equal(atlas.sourceLayerCount, uniqueGoalCellCount);
    assert.equal(atlas.routes.length, 1);
    assert.equal(atlas.routes[0].pathId, route.pathId);
    assert.equal(atlas.routes[0].firstFieldIndex, 0);
    assert.equal(atlas.routes[0].firstTargetWaypointIndex, 1);
    assert.equal(atlas.directions.length, atlas.fieldCount * atlas.size * 2);
    assert.equal(atlas.integrationCosts.length, atlas.fieldCount * atlas.size);
    assert.equal(atlas.gpuGeneration.version, 2);
    assert.equal(atlas.gpuGeneration.sourceLayerCount, uniqueGoalCellCount);
    assert.equal(atlas.gpuGeneration.stageLayerIndices.length, atlas.fieldCount);
    assert.deepEqual(
        Array.from(atlas.gpuGeneration.stageLayerIndices),
        atlas.stages.map((stage) => stage.sourceLayerIndex)
    );
    assert.equal(
        atlas.gpuGeneration.blockedLayers.length,
        atlas.size * uniqueGoalCellCount
    );
    assert.equal(
        atlas.gpuGeneration.goalCellIndices.length,
        uniqueGoalCellCount
    );
    assert.ok(atlas.gpuGeneration.relaxationPassCount > 0);
    assert.equal(atlas.contentKey, repeated.contentKey);
    assert.deepEqual(Array.from(atlas.directions), Array.from(repeated.directions));
    assert.deepEqual(
        Array.from(atlas.integrationCosts),
        Array.from(repeated.integrationCosts)
    );

    const shiftedRoutes = tileMap.getSpawnRoutes().map((sourceRoute, routeIndex) => ({
        ...sourceRoute,
        waypoints: sourceRoute.waypoints.map((waypoint, waypointIndex) => (
            routeIndex === 0 && waypointIndex === 1
                ? { ...waypoint, x: waypoint.x + 0.125 }
                : waypoint
        ))
    }));
    const shiftedGoalAtlas = createRouteFlowFieldAtlas({
        getNavigationGrid: () => tileMap.getNavigationGrid(),
        getSpawnRoutes: () => shiftedRoutes,
        getWorldBounds: () => tileMap.getWorldBounds(),
        getPathWidthTiles: () => tileMap.getPathWidthTiles(),
        getFlowTransitionRadius: () => tileMap.getFlowTransitionRadius(),
        getRouteClosurePhysicalBlocking: () => (
            tileMap.getRouteClosurePhysicalBlocking()
        ),
        getRouteGraph: () => tileMap.getRouteGraph()
    });
    assert.deepEqual(
        Array.from(shiftedGoalAtlas.directions),
        Array.from(atlas.directions),
        '같은 goal cell은 동일한 방향 plane을 사용해야 합니다.'
    );
    assert.notEqual(
        shiftedGoalAtlas.contentKey,
        atlas.contentKey,
        'GPU goalPosition float32 비트가 바뀌면 content key도 바뀌어야 합니다.'
    );

    for (let index = 0; index < atlas.stages.length; index++) {
        const stage = atlas.stages[index];
        const waypoint = route.waypoints[index + 1];
        const expectedCell = {
            column: Math.floor((waypoint.x - atlas.origin.x) / atlas.cellSize),
            row: Math.floor((waypoint.y - atlas.origin.y) / atlas.cellSize)
        };
        assert.deepEqual(
            { column: stage.goalCell.column, row: stage.goalCell.row },
            expectedCell
        );
        assert.ok(stage.sourceLayerIndex < atlas.sourceLayerCount);
        assert.deepEqual(
            { x: stage.goalPosition.x, y: stage.goalPosition.y },
            { x: waypoint.x, y: waypoint.y }
        );
        assert.equal(
            stage.nextFieldIndex,
            index + 1 < atlas.stages.length
                ? index + 1
                : ROUTE_FLOW_FIELD_NO_NEXT_LAYER
        );
    }

    const entry = route.entryPoint;
    const entryColumn = Math.floor((entry.x - atlas.origin.x) / atlas.cellSize);
    const entryRow = Math.floor((entry.y - atlas.origin.y) / atlas.cellSize);
    const entryCellIndex = (entryRow * atlas.cols) + entryColumn;
    const entryDirectionOffset = entryCellIndex * 2;
    assert.equal(atlas.directions[entryDirectionOffset], 0);
    assert.ok(atlas.directions[entryDirectionOffset + 1] > 0);
    assert.ok(atlas.integrationCosts[entryCellIndex] > 0);

    for (let fieldIndex = 0; fieldIndex < atlas.fieldCount; fieldIndex++) {
        const stage = atlas.stages[fieldIndex];
        const goalOffset = ((fieldIndex * atlas.size) + stage.goalIndex) * 2;
        assert.equal(atlas.directions[goalOffset], 0);
        assert.equal(atlas.directions[goalOffset + 1], 0);
        assert.equal(
            atlas.integrationCosts[(fieldIndex * atlas.size) + stage.goalIndex],
            0
        );

        const previous = route.waypoints[fieldIndex];
        const previousColumn = Math.floor(
            (previous.x - atlas.origin.x) / atlas.cellSize
        );
        const previousRow = Math.floor(
            (previous.y - atlas.origin.y) / atlas.cellSize
        );
        const previousIndex = (previousRow * atlas.cols) + previousColumn;
        const directionOffset = (
            (fieldIndex * atlas.size) + previousIndex
        ) * 2;
        const expectedX = Math.sign(stage.goalCell.column - previousColumn);
        const expectedY = Math.sign(stage.goalCell.row - previousRow);
        const expectedLength = Math.hypot(expectedX, expectedY);
        const dot = (
            atlas.directions[directionOffset] * (expectedX / expectedLength)
        ) + (
            atlas.directions[directionOffset + 1] * (expectedY / expectedLength)
        );
        assert.ok(dot > 0.999, `stage ${fieldIndex}가 authored 순서를 따라야 합니다.`);
    }

    const blockedIndex = atlas.gpuGeneration.blockedLayers.subarray(
        0,
        atlas.size
    ).findIndex(
        (value) => value !== 0
    );
    assert.ok(blockedIndex >= 0);
    for (let fieldIndex = 0; fieldIndex < atlas.fieldCount; fieldIndex++) {
        const offset = ((fieldIndex * atlas.size) + blockedIndex) * 2;
        assert.equal(atlas.directions[offset], 0);
        assert.equal(atlas.directions[offset + 1], 0);
        assert.ok(
            atlas.integrationCosts[(fieldIndex * atlas.size) + blockedIndex] >= 1e19
        );
    }
});

test('재방문 waypoint는 같은 goal source를 재사용하되 stage 진행 identity는 유지한다', () => {
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const firstVisit = route.waypoints.findIndex((waypoint, index) => (
        index > 0
        && route.waypoints.findIndex((candidate) => (
            candidate.row === waypoint.row && candidate.column === waypoint.column
        )) < index
    ));
    assert.ok(firstVisit > 0);
    const originalVisit = route.waypoints.findIndex((waypoint) => (
        waypoint.row === route.waypoints[firstVisit].row
        && waypoint.column === route.waypoints[firstVisit].column
    ));
    const originalStageIndex = originalVisit - 1;
    const repeatedStageIndex = firstVisit - 1;

    assert.notEqual(originalStageIndex, repeatedStageIndex);
    assert.equal(
        atlas.stages[originalStageIndex].goalIndex,
        atlas.stages[repeatedStageIndex].goalIndex
    );
    assert.equal(
        atlas.stages[originalStageIndex].sourceLayerIndex,
        atlas.stages[repeatedStageIndex].sourceLayerIndex
    );
    assert.notEqual(
        atlas.stages[originalStageIndex].nextFieldIndex,
        atlas.stages[repeatedStageIndex].nextFieldIndex
    );
});

function createRouteSource({ cols, rows, blocked, pathWidthTiles, waypoints }) {
    const normalizedWaypoints = waypoints.map(({ x, y }) => Object.freeze({
        x,
        y,
        column: Math.floor(x),
        row: Math.floor(y)
    }));
    return {
        getNavigationGrid: () => ({
            cols,
            rows,
            size: cols * rows,
            cellSize: 1,
            blocked: new Uint8Array(blocked)
        }),
        getSpawnRoutes: () => [{
            gateId: 'gate-test',
            pathId: 'path-test',
            entryPoint: normalizedWaypoints[0],
            waypoints: normalizedWaypoints
        }],
        getWorldBounds: () => ({ minX: 0, minY: 0 }),
        getPathWidthTiles: () => pathWidthTiles,
        getRouteGraph: () => null
    };
}

test('macro route는 건너뛴 셀과 corner-cut 대각선을 GPU allocation 전에 거절한다', () => {
    assert.throws(
        () => createRouteFlowFieldAtlas(createRouteSource({
            cols: 6,
            rows: 2,
            blocked: new Uint8Array(12),
            pathWidthTiles: 2,
            waypoints: [
                { x: 0.5, y: 0.5 },
                { x: 4.5, y: 0.5 }
            ]
        })),
        /인접 flow cell/
    );
    assert.throws(
        () => createRouteFlowFieldAtlas(createRouteSource({
            cols: 4,
            rows: 4,
            blocked: new Uint8Array(16),
            pathWidthTiles: 2,
            waypoints: [
                { x: 0.5, y: 0.5 },
                { x: 2.5, y: 2.5 }
            ]
        })),
        /corner-cut 없이 연결/
    );
});

test('일반 route도 차단벽으로 goal과 분리된 waypoint를 publication 전에 거절한다', () => {
    assert.throws(
        () => createRouteFlowFieldAtlas(createRouteSource({
            cols: 3,
            rows: 1,
            blocked: new Uint8Array([0, 1, 0]),
            pathWidthTiles: 1,
            waypoints: [
                { x: 0.5, y: 0.5 },
                { x: 2.5, y: 0.5 }
            ]
        })),
        /goal에 도달할 수 없습니다/
    );
});
