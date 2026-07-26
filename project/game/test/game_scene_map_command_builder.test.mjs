import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { loadGameModule } from './support/source_module_loader.mjs';

const DEFAULT_MAP_ID = 'corridor_eight_01';
const { PLAY_MAP_DATA } = await loadGameModule('data/scene/game/play_map_data.js');
const GAME_SCENE_COMMAND_TYPES = Object.freeze({
    REPLACE_WORLD: 'gameScene.replaceWorldState'
});

/**
 * 명령 빌더 테스트에서 사용할 결정적인 맵 기하를 생성합니다.
 * @param {object} mapDefinition - 정규화된 맵 정의입니다.
 * @param {{ww:number, objectWH:number}} viewport - 테스트 월드 크기입니다.
 * @returns {object} 명령 빌더가 소비할 맵 기하입니다.
 */
function buildGeometryFixture(mapDefinition, viewport) {
    const cellSize = Math.min(viewport.ww / 15, viewport.objectWH / 11);
    const boundaryWalls = Array.from({ length: 8 }, (_, index) => ({
        x: 100 + (index * 10),
        y: 200 + (index * 5),
        w: cellSize * 2,
        h: 6,
        origin: 'center'
    }));
    return {
        mapId: mapDefinition.id,
        cellSize,
        playerSpawn: { x: 900, y: 450 },
        boundaryWalls,
        floorLocalCenters: [],
        originX: 0,
        originY: 0,
        rows: 11,
        columns: 15,
        width: cellSize * 15,
        height: cellSize * 11,
        tileGapRatio: 0.035
    };
}

const context = vm.createContext({ console });
const builderSource = await readFile(
    new URL(
        '../script/module/scene/game/commands/game_scene_map_command_builder.js',
        import.meta.url
    ),
    'utf8'
);
const builderModule = new vm.SourceTextModule(builderSource, {
    context,
    identifier: 'game_scene_map_command_builder.js'
});
const dataModule = new vm.SyntheticModule(['PLAY_MAP_DATA'], function initializeDataModule() {
    this.setExport('PLAY_MAP_DATA', PLAY_MAP_DATA);
}, { context });
const protocolModule = new vm.SyntheticModule(
    ['GAME_SCENE_COMMAND_TYPES'],
    function initializeProtocolModule() {
        this.setExport('GAME_SCENE_COMMAND_TYPES', GAME_SCENE_COMMAND_TYPES);
    },
    { context }
);
const gridModule = new vm.SyntheticModule(
    ['buildGameMapGeometry', 'resolveGameMapDefinition'],
    function initializeGridModule() {
        this.setExport('buildGameMapGeometry', buildGeometryFixture);
        this.setExport('resolveGameMapDefinition', () => ({ id: DEFAULT_MAP_ID }));
    },
    { context }
);

await builderModule.link((specifier) => {
    if (specifier === 'data/scene/game/play_map_data.js') return dataModule;
    if (specifier === 'simulation/game_scene_simulation_protocol.js') return protocolModule;
    if (specifier === '../map/game_map_grid.js') return gridModule;
    throw new Error(`예상하지 못한 import입니다: ${specifier}`);
});
await builderModule.evaluate();

const { buildGameSceneResetPlayWorldCommands } = builderModule.namespace;

/**
 * 테스트용 게임 씬 상태를 생성합니다.
 * @param {number} ww - 월드 너비입니다.
 * @param {number} objectWH - 오브젝트 월드 높이입니다.
 * @returns {object} 명령 빌더가 사용하는 최소 씬 상태입니다.
 */
function createScene(ww, objectWH) {
    return {
        WW: ww,
        objectWH,
        mapId: DEFAULT_MAP_ID,
        wallIdCounter: 1,
        projIdCounter: 7
    };
}

const firstScene = createScene(1200, 900);
const [firstCommand] = buildGameSceneResetPlayWorldCommands(firstScene, 'unknown_map');

assert.equal(firstCommand.type, GAME_SCENE_COMMAND_TYPES.REPLACE_WORLD);
assert.equal(firstCommand.mapId, DEFAULT_MAP_ID);
assert.equal(firstCommand.mapGeometry.mapId, DEFAULT_MAP_ID);
assert.equal(firstCommand.staticWalls.length, firstCommand.mapGeometry.boundaryWalls.length);
assert.equal(firstCommand.staticWalls.length, 8);
assert.equal(firstCommand.boxWalls.length, 0);
assert.equal(firstCommand.projectiles.length, 0);
assert.equal(firstCommand.nextWallIdCounter, 9);
assert.equal(firstCommand.nextProjIdCounter, 7);
assert.equal(firstCommand.player.position.x, firstCommand.mapGeometry.playerSpawn.x);
assert.equal(firstCommand.player.position.y, firstCommand.mapGeometry.playerSpawn.y);
assert.equal(
    firstCommand.player.radius,
    firstCommand.mapGeometry.cellSize * PLAY_MAP_DATA.PLAYER_RADIUS_CELL_RATIO
);

for (let i = 0; i < firstCommand.staticWalls.length; i++) {
    assert.equal(firstCommand.staticWalls[i].id, i + 1);
    assert.equal(firstCommand.staticWalls[i].origin, 'center');
}

const resizedScene = createScene(1600, 1000);
const [resizedCommand] = buildGameSceneResetPlayWorldCommands(
    resizedScene,
    firstCommand.mapId
);
assert.equal(resizedCommand.mapId, firstCommand.mapId);
assert.equal(resizedCommand.staticWalls.length, firstCommand.staticWalls.length);
assert.notEqual(resizedCommand.mapGeometry.cellSize, firstCommand.mapGeometry.cellSize);

console.log('game scene map command builder contract: ok');
