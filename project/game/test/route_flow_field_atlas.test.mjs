import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { createTileMap } = await loadGameModule('ingame/map/tile_map.js');
const {
    ROUTE_FLOW_FIELD_NO_NEXT_LAYER,
    createRouteFlowFieldAtlas
} = await loadGameModule('ingame/navigation/route_flow_field_atlas.js');

test('기존 JS/WASM flow plane을 waypoint별 GPU atlas로 결정적으로 컴파일한다', () => {
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const repeated = createRouteFlowFieldAtlas(tileMap);

    assert.equal(atlas.cols, tileMap.getNavigationGrid().cols);
    assert.equal(atlas.rows, tileMap.getNavigationGrid().rows);
    assert.equal(atlas.fieldCount, route.waypoints.length - 1);
    assert.equal(atlas.routes.length, 1);
    assert.equal(atlas.routes[0].pathId, route.pathId);
    assert.equal(atlas.routes[0].firstFieldIndex, 0);
    assert.equal(atlas.routes[0].firstTargetWaypointIndex, 1);
    assert.equal(atlas.directions.length, atlas.fieldCount * atlas.size * 2);
    assert.equal(atlas.contentKey, repeated.contentKey);
    assert.deepEqual(Array.from(atlas.directions), Array.from(repeated.directions));

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
        getWorldBounds: () => tileMap.getWorldBounds()
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
        assert.deepEqual(
            { column: stage.goalCell.column, row: stage.goalCell.row },
            { column: waypoint.column, row: waypoint.row }
        );
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
        const goalDirectionOffset = ((index * atlas.size) + stage.goalIndex) * 2;
        assert.equal(atlas.directions[goalDirectionOffset], 0);
        assert.equal(atlas.directions[goalDirectionOffset + 1], 0);
    }

    const entry = route.entryPoint;
    const entryCellIndex = (entry.row * atlas.cols) + entry.column;
    const entryDirectionOffset = entryCellIndex * 2;
    assert.equal(atlas.directions[entryDirectionOffset], 0);
    assert.ok(atlas.directions[entryDirectionOffset + 1] > 0);

    const blockedIndex = tileMap.getNavigationGrid().blocked.findIndex((value) => value !== 0);
    assert.ok(blockedIndex >= 0);
    for (let fieldIndex = 0; fieldIndex < atlas.fieldCount; fieldIndex++) {
        const offset = ((fieldIndex * atlas.size) + blockedIndex) * 2;
        assert.equal(atlas.directions[offset], 0);
        assert.equal(atlas.directions[offset + 1], 0);
    }
});

test('같은 교차점을 재방문해도 waypoint stage는 서로 다른 layer 진행 상태를 가진다', () => {
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
    assert.notEqual(
        atlas.stages[originalStageIndex].nextFieldIndex,
        atlas.stages[repeatedStageIndex].nextFieldIndex
    );
});
