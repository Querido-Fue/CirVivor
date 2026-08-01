import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sceneSystemSource = await readFile(
    new URL('../script/module/scene/scene_system.js', import.meta.url),
    'utf8'
);
const titleSceneSource = await readFile(
    new URL('../script/module/scene/title/_title_scene.js', import.meta.url),
    'utf8'
);
const loadingSceneSource = await readFile(
    new URL('../script/module/scene/loading/_loading_scene.js', import.meta.url),
    'utf8'
);
const benchmarkSceneSource = await readFile(
    new URL('../script/module/scene/benchmark/_benchmark_scene.js', import.meta.url),
    'utf8'
);

assert.match(sceneSystemSource, /new LoadingScene\(this\), SCENE_STATES\.LOADING/);
assert.match(sceneSystemSource, /new TitleScene\(this, handoff\)/);
assert.match(sceneSystemSource, /new GameScene\(this, \{/);
assert.match(sceneSystemSource, /new BenchmarkScene\(this\)/);
assert.doesNotMatch(benchmarkSceneSource, /data\/data_handler\.js/);
assert.match(
    benchmarkSceneSource,
    /ingame\/gpu_simulation_endpoint\.js/
);
assert.doesNotMatch(titleSceneSource, /TitleLoadingSequence|new TitleGradientBackground|new TitleBackGround/);
assert.match(titleSceneSource, /beginTitleScenePhase/);
assert.match(titleSceneSource, /promoteCompletedTitleIntro/);
assert.match(loadingSceneSource, /new TitleScenePresentation\(this\.titleController\)/);
assert.match(loadingSceneSource, /createTitleGpuRolloutProfile\(\)/);
assert.match(loadingSceneSource, /titleGpuRolloutProfile: this\.titleGpuRolloutProfile/);
assert.match(loadingSceneSource, /releaseTitlePresentation\(\)/);
assert.match(loadingSceneSource, /isTitleSceneHandoffReady/);
assert.doesNotMatch(loadingSceneSource, /promoteCompletedLoadingContent|isLoadingComplete/);

const titleRuntimeContext = vm.createContext({ console });
const titleRuntimeModule = new vm.SourceTextModule(titleSceneSource, {
    context: titleRuntimeContext,
    identifier: '_title_scene.js'
});
const baseSceneModule = new vm.SyntheticModule(['BaseScene'], function init() {
    this.setExport('BaseScene', class BaseScene {
        constructor(sceneSystem) {
            this.sceneSystem = sceneSystem;
        }
    });
}, { context: titleRuntimeContext });
await titleRuntimeModule.link(() => baseSceneModule);
await titleRuntimeModule.evaluate();
const titleLifecycleTrace = [];
const titlePresentation = {
    beginTitleScenePhase() {
        titleLifecycleTrace.push('begin');
        return true;
    },
    update() {
        titleLifecycleTrace.push('update');
    },
    promoteCompletedTitleIntro() {
        titleLifecycleTrace.push('promote');
    }
};
const rolloutProfile = Object.freeze({
    pipelineMode: 'legacy-webgl',
    simulationMode: 'cpu'
});
const TitleSceneRuntime = titleRuntimeModule.namespace.TitleScene;
const titleRuntime = new TitleSceneRuntime({}, {
    presentation: titlePresentation,
    titleController: { id: 'controller' },
    titleGpuRolloutProfile: rolloutProfile
});
assert.deepEqual(titleLifecycleTrace, ['begin']);
assert.strictEqual(titleRuntime.titleGpuRolloutProfile, rolloutProfile);
titleRuntime.update();
assert.deepEqual(titleLifecycleTrace, ['begin', 'update', 'promote']);

const trace = [];
class LoadingSceneStub {
    constructor(sceneSystem) {
        this.sceneSystem = sceneSystem;
        this.presentation = { id: 'presentation' };
        this.titleController = { id: 'controller' };
        this.ready = false;
        this.releaseCount = 0;
        this.destroyCount = 0;
    }

    releaseTitlePresentation() {
        this.releaseCount++;
        if (!this.ready) return null;
        return {
            presentation: this.presentation,
            titleController: this.titleController
        };
    }

    destroy() {
        this.destroyCount++;
        trace.push('loading-destroy');
    }
}

class TitleSceneStub {
    constructor(sceneSystem, handoff) {
        this.sceneSystem = sceneSystem;
        this.presentation = handoff.presentation;
        this.titleController = handoff.titleController;
        trace.push('title-create');
    }
}

const gameSceneTransitions = [];
class GameSceneStub {
    constructor(sceneSystem, options) {
        this.sceneSystem = sceneSystem;
        this.options = options;
        this.destroyCount = 0;
        gameSceneTransitions.push('play-create');
    }

    destroy() {
        this.destroyCount++;
        gameSceneTransitions.push('play-destroy');
    }
}
class BenchmarkSceneStub {
    constructor(sceneSystem) {
        this.sceneSystem = sceneSystem;
        gameSceneTransitions.push('benchmark-create');
    }
}
let clearSimulationCommandCount = 0;
const context = vm.createContext({ console });
const sceneModule = new vm.SourceTextModule(sceneSystemSource, {
    context,
    identifier: 'scene_system.js'
});
const dependencyModules = new Map([
    ['./title/_title_scene.js', new vm.SyntheticModule(['TitleScene'], function init() {
        this.setExport('TitleScene', TitleSceneStub);
    }, { context })],
    ['./loading/_loading_scene.js', new vm.SyntheticModule(['LoadingScene'], function init() {
        this.setExport('LoadingScene', LoadingSceneStub);
    }, { context })],
    ['./game/_game_scene.js', new vm.SyntheticModule(['GAME_SCENE_MODES', 'GameScene'], function init() {
        this.setExport('GAME_SCENE_MODES', { PLAY: 'play', BENCHMARK: 'benchmark' });
        this.setExport('GameScene', GameSceneStub);
    }, { context })],
    ['./benchmark/_benchmark_scene.js', new vm.SyntheticModule(['BenchmarkScene'], function init() {
        this.setExport('BenchmarkScene', BenchmarkSceneStub);
    }, { context })],
    ['simulation/simulation_command_queue.js', new vm.SyntheticModule(['clearSimulationCommands'], function init() {
        this.setExport('clearSimulationCommands', () => {
            clearSimulationCommandCount++;
        });
    }, { context })]
]);

await sceneModule.link((specifier) => dependencyModules.get(specifier));
await sceneModule.evaluate();
const { SceneSystem } = sceneModule.namespace;
const sceneSystem = new SceneSystem({ overlayManager: {} });
await sceneSystem.init();
const loadingScene = sceneSystem.scene;
const presentationIdentity = loadingScene.presentation;
const controllerIdentity = loadingScene.titleController;

assert.equal(sceneSystem.sceneState, 'loading');
assert.equal(sceneSystem.completeLoading({}), false);
assert.strictEqual(sceneSystem.scene, loadingScene);
assert.equal(loadingScene.releaseCount, 0);
assert.equal(sceneSystem.completeLoading(loadingScene), false);
assert.strictEqual(sceneSystem.scene, loadingScene);
assert.equal(loadingScene.releaseCount, 1);

loadingScene.ready = true;
assert.equal(sceneSystem.completeLoading(loadingScene), true);
assert.equal(sceneSystem.sceneState, 'title');
assert.ok(sceneSystem.scene instanceof TitleSceneStub);
assert.strictEqual(sceneSystem.scene.presentation, presentationIdentity);
assert.strictEqual(sceneSystem.scene.titleController, controllerIdentity);
assert.equal(loadingScene.destroyCount, 1);
assert.deepEqual(trace, ['title-create', 'loading-destroy']);
assert.equal(sceneSystem.completeLoading(loadingScene), false);
assert.equal(loadingScene.releaseCount, 2);

sceneSystem.gameStart('map-test');
assert.ok(sceneSystem.scene instanceof GameSceneStub);
assert.equal(sceneSystem.scene.options.mode, 'play');
assert.equal(sceneSystem.scene.options.mapId, 'map-test');
assert.equal(clearSimulationCommandCount, 1);
const playScene = sceneSystem.scene;

sceneSystem.benchmarkStart();
assert.equal(playScene.destroyCount, 1);
assert.ok(sceneSystem.scene instanceof BenchmarkSceneStub);
assert.equal(clearSimulationCommandCount, 2);
assert.deepEqual(gameSceneTransitions, [
    'play-create',
    'play-destroy',
    'benchmark-create'
]);

console.log('title loading scene handoff contract: ok');
