import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const {
    CORRIDOR_EIGHT_MAP_DATA
} = await loadGameModule('data/scene/game/corridor_eight_map_data.js');
const { THE_TOWER_DATA } = await loadGameModule(
    'data/object/tower/the_tower_data.js'
);
const {
    isTileNavigationSource
} = await loadGameModule('ingame/contract/tile_navigation_contract.js');
const {
    isWorldViewProjection2D
} = await loadGameModule(
    'ingame/contract/world_view_projection_contract.js'
);
const {
    TILE_WORLD_SIZE,
    TileMap,
    createTileMap
} = await loadGameModule('ingame/map/tile_map.js');
const { TileMapRenderer } = await loadGameModule(
    'ingame/map/tile_map_renderer.js'
);
const { WorldCamera2D } = await loadGameModule(
    'ingame/map/world_camera_2d.js'
);
const {
    EnemyAIFlowFieldBackend
} = await loadGameModule(
    'object/enemy/ai/wasm/_enemy_ai_flow_field_backend.js'
);

const tileMap = createTileMap(CORRIDOR_EIGHT_MAP_DATA.id);
const grid = tileMap.getNavigationGrid();

assert.ok(isTileNavigationSource(tileMap));
assert.equal(THE_TOWER_DATA.RADIUS_TILES * 2, TILE_WORLD_SIZE);
assert.equal(grid.cols, 54);
assert.equal(grid.rows, 30);
assert.equal(grid.size, 1620);
assert.equal(grid.cellSize, TILE_WORLD_SIZE);

let walkableCount = 0;
for (let index = 0; index < grid.blocked.length; index++) {
    walkableCount += grid.blocked[index] === 0 ? 1 : 0;
}
assert.equal(walkableCount, 828);

const [spawnRoute] = tileMap.getSpawnRoutes();
assert.equal(spawnRoute.gateId, 'west-gate-01');
assert.equal(spawnRoute.pathId, 'west-figure-eight-core');
assert.equal(spawnRoute.waypoints.length, 25);
assert.deepEqual(spawnRoute.entryPoint, spawnRoute.waypoints[0]);
assert.deepEqual(spawnRoute.coreAttackPoint, tileMap.getCorePosition());

// 8자 교차점은 같은 월드 좌표를 다른 진행 index에서 다시 통과합니다.
assert.equal(spawnRoute.waypoints[4].x, spawnRoute.waypoints[12].x);
assert.equal(spawnRoute.waypoints[4].y, spawnRoute.waypoints[12].y);
assert.equal(spawnRoute.waypoints[6].x, spawnRoute.waypoints[18].x);
assert.equal(spawnRoute.waypoints[6].y, spawnRoute.waypoints[18].y);

// 입구는 아래로 진행한 뒤 오른쪽으로 꺾이는 ㄴ자입니다.
assert.equal(spawnRoute.waypoints[0].x, spawnRoute.waypoints[1].x);
assert.ok(spawnRoute.waypoints[1].y > spawnRoute.waypoints[0].y);
assert.equal(spawnRoute.waypoints[2].y, spawnRoute.waypoints[3].y);
assert.ok(spawnRoute.waypoints[3].x > spawnRoute.waypoints[2].x);

// 출구는 오른쪽으로 진행한 뒤 Core 쪽 아래로 꺾이는 ㄱ자입니다.
assert.equal(spawnRoute.waypoints[21].y, spawnRoute.waypoints[22].y);
assert.ok(spawnRoute.waypoints[22].x > spawnRoute.waypoints[21].x);
assert.equal(spawnRoute.waypoints[22].x, spawnRoute.waypoints[23].x);
assert.ok(spawnRoute.waypoints[23].y > spawnRoute.waypoints[22].y);

/**
 * 한 셀에서 가로로 이어진 보행 가능 타일 수를 셉니다.
 * @param {number} row - 기준 행입니다.
 * @param {number} column - 기준 열입니다.
 * @returns {number} 연속 폭입니다.
 */
function countHorizontalRun(row, column) {
    let start = column;
    let end = column;
    while (tileMap.isWalkableTile(row, start - 1)) {
        start--;
    }
    while (tileMap.isWalkableTile(row, end + 1)) {
        end++;
    }
    return end - start + 1;
}

/**
 * 한 셀에서 세로로 이어진 보행 가능 타일 수를 셉니다.
 * @param {number} row - 기준 행입니다.
 * @param {number} column - 기준 열입니다.
 * @returns {number} 연속 폭입니다.
 */
function countVerticalRun(row, column) {
    let start = row;
    let end = row;
    while (tileMap.isWalkableTile(start - 1, column)) {
        start--;
    }
    while (tileMap.isWalkableTile(end + 1, column)) {
        end++;
    }
    return end - start + 1;
}

assert.equal(
    countHorizontalRun(
        spawnRoute.waypoints[1].row,
        spawnRoute.waypoints[1].column
    ),
    6
);
assert.equal(
    countVerticalRun(
        spawnRoute.waypoints[3].row,
        spawnRoute.waypoints[3].column
    ),
    6
);
assert.equal(
    countHorizontalRun(
        spawnRoute.waypoints[23].row,
        spawnRoute.waypoints[23].column
    ),
    6
);

const coreTile = tileMap.worldToTile(
    tileMap.getCorePosition().x,
    tileMap.getCorePosition().y,
    {}
);
assert.equal(coreTile.inside, true);
assert.equal(tileMap.isWalkableTile(coreTile.row, coreTile.column), true);
assert.equal(tileMap.isWalkableTile(-1, coreTile.column), false);
const coreWorldFromTile = tileMap.tileToWorld(coreTile.row, coreTile.column, {});
assert.equal(coreTile.row, tileMap.getCorePosition().row);
assert.equal(coreTile.column, tileMap.getCorePosition().column);
assert.equal(
    coreWorldFromTile.x - tileMap.getCorePosition().x,
    TILE_WORLD_SIZE * 0.5
);
assert.equal(
    coreWorldFromTile.y - tileMap.getCorePosition().y,
    TILE_WORLD_SIZE * 0.5
);

// 신규 타일 grid는 기존 JS/WASM Flow Field backend ABI에 그대로 전달할 수 있습니다.
let wasmGrid = null;
let wasmGoal = null;
const flowBackend = new EnemyAIFlowFieldBackend({
    minimumWasmGridSize: 1024,
    runtimeFactory() {
        return {
            buildFlowField(receivedGrid, receivedGoal) {
                wasmGrid = receivedGrid;
                wasmGoal = { ...receivedGoal };
                return {
                    integration: new Float32Array(receivedGrid.size),
                    dirX: new Float32Array(receivedGrid.size),
                    dirY: new Float32Array(receivedGrid.size),
                    goalIndex: (receivedGoal.cy * receivedGrid.cols) + receivedGoal.cx
                };
            }
        };
    }
});
const flowResult = flowBackend.buildFlowField(
    grid,
    { cx: coreTile.column, cy: coreTile.row },
    () => {
        throw new Error('1620셀 맵은 테스트 WASM backend로 dispatch되어야 합니다.');
    }
);
assert.strictEqual(wasmGrid, grid);
assert.deepEqual(wasmGoal, { cx: coreTile.column, cy: coreTile.row });
assert.equal(flowResult.goalIndex, (coreTile.row * grid.cols) + coreTile.column);
assert.equal(flowBackend.getStatus().wasmBuildCount, 1);

// 여러 Gate가 독립 route로 같은 Core에 합류할 수 있습니다.
const multiGateDefinition = {
    id: 'multi-gate-test',
    macroRows: 3,
    macroColumns: 5,
    pathWidthTiles: 6,
    directionBlueprint: [
        'xy###',
        'abcde',
        '#####'
    ],
    coreMacroCell: [1, 4],
    towerSpawnMacroCell: [1, 3],
    enemySpawnRoutes: [
        {
            gateId: 'west-gate',
            pathId: 'west-path',
            macroCells: [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]]
        },
        {
            gateId: 'north-west-gate',
            pathId: 'north-west-path',
            macroCells: [
                [0, 0],
                [0, 1],
                [1, 1],
                [1, 2],
                [1, 3],
                [1, 4]
            ]
        }
    ]
};
const multiGateMap = new TileMap(multiGateDefinition);
assert.equal(multiGateMap.getSpawnRoutes().length, 2);
assert.equal(
    multiGateMap.getSpawnRoutes().map(({ gateId }) => gateId).join(','),
    'west-gate,north-west-gate'
);
for (const route of multiGateMap.getSpawnRoutes()) {
    assert.deepEqual(route.coreAttackPoint, multiGateMap.getCorePosition());
}

assert.throws(
    () => new TileMap({
        ...multiGateDefinition,
        id: 'invalid-jump',
        enemySpawnRoutes: [{
            gateId: 'jump-gate',
            pathId: 'jump-path',
            macroCells: [[1, 0], [1, 2], [1, 4]]
        }]
    }),
    /직교 인접/
);

// 월드 projection은 해상도마다 전체 맵을 같은 비율로 contain합니다.
const camera = new WorldCamera2D();
camera.init(tileMap.getWorldBounds(), { ww: 2560, wh: 1440 });
assert.ok(isWorldViewProjection2D(camera));
const expectedScale = Math.min(2560 / grid.cols, 1440 / grid.rows);
assert.equal(camera.getScale(), expectedScale);

const viewportTopLeft = camera.worldToViewport(0, 0, {});
const viewportBottomRight = camera.worldToViewport(
    tileMap.getWorldBounds().width,
    tileMap.getWorldBounds().height,
    {}
);
assert.equal(viewportTopLeft.x, 0);
assert.ok(viewportTopLeft.y > 0);
assert.equal(viewportBottomRight.x, 2560);
assert.ok(viewportBottomRight.y < 1440);
assert.deepEqual(
    camera.viewportToWorld(viewportBottomRight.x, viewportBottomRight.y, {}),
    {
        x: tileMap.getWorldBounds().width,
        y: tileMap.getWorldBounds().height
    }
);

// 정적 타일 projection은 첫 draw와 resize에서만 재계산합니다.
const tileBatches = [];
const tileRenderer = new TileMapRenderer({
    drawSquareInstances(options) {
        tileBatches.push({
            size: options.size,
            centerCount: options.centers.length
        });
    }
});
const originalWorldToViewport = camera.worldToViewport.bind(camera);
let tileProjectionCount = 0;
camera.worldToViewport = (...args) => {
    tileProjectionCount++;
    return originalWorldToViewport(...args);
};
tileRenderer.draw(tileMap, camera);
const firstProjectionCount = tileProjectionCount;
const firstProjectedTileSize = tileBatches[0].size;
assert.equal(firstProjectionCount, walkableCount);
assert.equal(tileBatches[0].centerCount, walkableCount);

tileRenderer.draw(tileMap, camera);
assert.equal(tileProjectionCount, firstProjectionCount);

camera.resize({ ww: 1280, wh: 720 });
tileRenderer.draw(tileMap, camera);
assert.equal(tileProjectionCount, firstProjectionCount + walkableCount);
assert.equal(tileBatches[2].size, firstProjectedTileSize * 0.5);
tileRenderer.destroy();

console.log('ingame responsive tile map and multi-gate contract: ok');
