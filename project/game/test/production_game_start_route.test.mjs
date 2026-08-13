import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    CORRIDOR_EIGHT_MAP_DATA,
    INGAME_MAP_DATA
} = await loadGameModule('data/scene/game/corridor_eight_map_data.js');
const {
    GAME_MAP_DATA
} = await loadGameModule('data/scene/game/game_map_data.js');
const {
    R2_ENEMY_SHOWCASE_MAP_DATA
} = await loadGameModule('data/scene/game/r2_enemy_showcase_map_data.js');
const {
    R2_ENEMY_SHOWCASE_WAVE_01_DATA
} = await loadGameModule('data/scene/game/r2_enemy_showcase_wave_data.js');
const {
    PRODUCTION_STAGE_ONE_RUNTIME_MAP_ID,
    PRODUCTION_STAGE_ONE_SELECTION_MAP_ID,
    createProductionGameStartOptions
} = await loadGameModule('scene/game/production_game_start_route.js');

test('첫 production map 선택은 preview ID를 유지하고 R2 showcase Wave 1 세션을 연다', () => {
    assert.equal(PRODUCTION_STAGE_ONE_SELECTION_MAP_ID,
        CORRIDOR_EIGHT_MAP_DATA.id);
    assert.equal(PRODUCTION_STAGE_ONE_RUNTIME_MAP_ID,
        R2_ENEMY_SHOWCASE_MAP_DATA.id);

    const options = createProductionGameStartOptions(
        CORRIDOR_EIGHT_MAP_DATA.id
    );
    assert.equal(options.mapId, R2_ENEMY_SHOWCASE_MAP_DATA.id);
    assert.equal(options.tileNavigationSource.mapId,
        R2_ENEMY_SHOWCASE_MAP_DATA.id);
    assert.strictEqual(options.waveDefinition, R2_ENEMY_SHOWCASE_WAVE_01_DATA);
    assert.equal(options.enemyWaveEnabled, true);
    assert.equal(options.gameplayWorldActorsEnabled, true);
    assert.equal(options.enemyRecoveryEnabled, true);
    assert.equal(options.tileNavigationSource.getSpawnRoutes().length, 2);
    assert.equal(options.tileNavigationSource.getRouteGraph()?.closures.length, 2);
    assert.equal(GAME_MAP_DATA.DEFAULT_MAP_ID, CORRIDOR_EIGHT_MAP_DATA.id);
    assert.deepEqual(Array.from(GAME_MAP_DATA.MAPS, ({ id }) => id), [
        CORRIDOR_EIGHT_MAP_DATA.id
    ]);
    assert.deepEqual(Array.from(INGAME_MAP_DATA.MAPS, ({ id }) => id), [
        CORRIDOR_EIGHT_MAP_DATA.id
    ]);
});

test('첫 카드가 아닌 직접 map 요청은 기존 map resolver 경로를 보존한다', () => {
    assert.deepEqual(createProductionGameStartOptions('custom-map'), {
        mapId: 'custom-map'
    });
    assert.deepEqual(createProductionGameStartOptions(undefined), {
        mapId: undefined
    });
});

test('실제 SceneSystem gameStart 조합은 Stage 1 runtime 옵션을 GameScene에 그대로 전달한다', async () => {
    const sceneSystemSource = await readFile(new URL(
        '../script/module/scene/scene_system.js',
        import.meta.url
    ), 'utf8');
    const context = vm.createContext({ console });
    const sceneModule = new vm.SourceTextModule(sceneSystemSource, {
        context,
        identifier: 'scene_system.production_route.js'
    });
    const createdGameScenes = [];

    class GameSceneStub {
        constructor(sceneSystem, options) {
            this.sceneSystem = sceneSystem;
            this.options = options;
            createdGameScenes.push(this);
        }

        destroy() {}
    }

    const dependencyModules = new Map([
        ['./title/_title_scene.js', new vm.SyntheticModule(
            ['TitleScene'],
            function initializeTitleScene() {
                this.setExport('TitleScene', class TitleScene {});
            },
            { context }
        )],
        ['./loading/_loading_scene.js', new vm.SyntheticModule(
            ['LoadingScene'],
            function initializeLoadingScene() {
                this.setExport('LoadingScene', class LoadingScene {});
            },
            { context }
        )],
        ['./game/_game_scene.js', new vm.SyntheticModule(
            ['GAME_SCENE_MODES', 'GameScene'],
            function initializeGameScene() {
                this.setExport('GAME_SCENE_MODES', { PLAY: 'play' });
                this.setExport('GameScene', GameSceneStub);
            },
            { context }
        )],
        ['./game/production_game_start_route.js', new vm.SyntheticModule(
            ['createProductionGameStartOptions'],
            function initializeProductionRoute() {
                this.setExport(
                    'createProductionGameStartOptions',
                    createProductionGameStartOptions
                );
            },
            { context }
        )],
        ['./benchmark/_benchmark_scene.js', new vm.SyntheticModule(
            ['BenchmarkScene'],
            function initializeBenchmarkScene() {
                this.setExport('BenchmarkScene', class BenchmarkScene {});
            },
            { context }
        )],
        ['simulation/simulation_command_queue.js', new vm.SyntheticModule(
            ['clearSimulationCommands'],
            function initializeCommandQueue() {
                this.setExport('clearSimulationCommands', () => {});
            },
            { context }
        )]
    ]);

    await sceneModule.link((specifier) => {
        const dependency = dependencyModules.get(specifier);
        if (!dependency) {
            throw new Error(`예상하지 못한 SceneSystem import입니다: ${specifier}`);
        }
        return dependency;
    });
    await sceneModule.evaluate();

    const SceneSystemRuntime = sceneModule.namespace.SceneSystem;
    const sceneSystem = new SceneSystemRuntime({});
    sceneSystem.gameStart(CORRIDOR_EIGHT_MAP_DATA.id);

    assert.equal(createdGameScenes.length, 1);
    const { options } = createdGameScenes[0];
    assert.equal(options.mode, 'play');
    assert.equal(options.mapId, R2_ENEMY_SHOWCASE_MAP_DATA.id);
    assert.equal(options.tileNavigationSource.mapId,
        R2_ENEMY_SHOWCASE_MAP_DATA.id);
    assert.strictEqual(options.waveDefinition, R2_ENEMY_SHOWCASE_WAVE_01_DATA);
    assert.equal(options.enemyWaveEnabled, true);
    assert.equal(options.gameplayWorldActorsEnabled, true);
    assert.equal(options.enemyRecoveryEnabled, true);
});
