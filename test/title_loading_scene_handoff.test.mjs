import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sceneSystemSource = await readFile(
    new URL('../project/game/script/module/scene/scene_system.js', import.meta.url),
    'utf8'
);
const titleSceneSource = await readFile(
    new URL('../project/game/script/module/scene/title/_title_scene.js', import.meta.url),
    'utf8'
);
const loadingSceneSource = await readFile(
    new URL('../project/game/script/module/scene/loading/_loading_scene.js', import.meta.url),
    'utf8'
);
const titlePresentationSource = await readFile(
    new URL('../project/game/script/module/scene/title/_title_scene_presentation.js', import.meta.url),
    'utf8'
);
const benchmarkSceneSource = await readFile(
    new URL('../project/game/script/module/scene/benchmark/_benchmark_scene.js', import.meta.url),
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
assert.match(
    loadingSceneSource,
    /new TitleScenePresentation\(this\.titleController, \{\s*titleGpuRolloutProfile: this\.titleGpuRolloutProfile\s*\}\)/
);
assert.match(loadingSceneSource, /createTitleGpuRolloutProfile\(\)/);
assert.match(loadingSceneSource, /titleGpuRolloutProfile: this\.titleGpuRolloutProfile/);
assert.match(loadingSceneSource, /releaseTitlePresentation\(\)/);
assert.match(loadingSceneSource, /isTitleSceneHandoffReady/);
assert.doesNotMatch(loadingSceneSource, /promoteCompletedLoadingContent|isLoadingComplete/);

const loadingRuntimeContext = vm.createContext({ console });
const loadingRolloutProfile = Object.freeze({
    pipelineMode: 'legacy-webgl',
    simulationMode: 'cpu',
    source: 'identity-test'
});
const presentationDependencyModules = new Map([
    ['display/display_system.js', new vm.SyntheticModule([
        'getDisplaySystem',
        'getWebGpuBlurPort',
        'getWebGpuFrameContributorPort'
    ], function init() {
        this.setExport('getDisplaySystem', () => null);
        this.setExport('getWebGpuBlurPort', () => null);
        this.setExport('getWebGpuFrameContributorPort', () => null);
    }, { context: loadingRuntimeContext })],
    ['./_title_background.js', new vm.SyntheticModule(['TitleBackGround'], function init() {
        this.setExport('TitleBackGround', class TitleBackGround {});
    }, { context: loadingRuntimeContext })],
    ['./_title_gradient_background.js', new vm.SyntheticModule(['TitleGradientBackground'], function init() {
        this.setExport('TitleGradientBackground', class TitleGradientBackground {});
    }, { context: loadingRuntimeContext })],
    ['./_title_loading_sequence.js', new vm.SyntheticModule(['TitleLoadingSequence'], function init() {
        this.setExport('TitleLoadingSequence', class TitleLoadingSequence {
            constructor() {
                this.ready = false;
            }

            isTitleSceneHandoffReady() {
                return this.ready;
            }
        });
    }, { context: loadingRuntimeContext })],
    ['./_title_scene_intro_sequence.js', new vm.SyntheticModule(['TitleSceneIntroSequence'], function init() {
        this.setExport('TitleSceneIntroSequence', class TitleSceneIntroSequence {});
    }, { context: loadingRuntimeContext })],
    ['./_title_gpu_rollout.js', new vm.SyntheticModule(['TITLE_PIPELINE_MODE'], function init() {
        this.setExport('TITLE_PIPELINE_MODE', {
            LEGACY_WEBGL: 'legacy-webgl',
            WEBGPU_KAWASE: 'webgpu-kawase',
            WEBGPU_GAUSSIAN: 'webgpu-gaussian'
        });
    }, { context: loadingRuntimeContext })],
    ['./webgpu/_title_webgpu_base_graph.js', new vm.SyntheticModule([
        'getTitleWebGpuBaseGraphBlurAlgorithmId',
        'TitleWebGpuBaseGraph'
    ], function init() {
        this.setExport('getTitleWebGpuBaseGraphBlurAlgorithmId', (pipelineMode) => (
            pipelineMode === 'webgpu-kawase' ? 'kawase-optimized' : null
        ));
        this.setExport('TitleWebGpuBaseGraph', class TitleWebGpuBaseGraph {});
    }, { context: loadingRuntimeContext })],
    ['./webgpu/_title_webgpu_overlay_capture_gate.js', new vm.SyntheticModule([
        'beginTitleWebGpuOverlayCapture',
        'endTitleWebGpuOverlayCapture'
    ], function init() {
        this.setExport('beginTitleWebGpuOverlayCapture', () => null);
        this.setExport('endTitleWebGpuOverlayCapture', () => false);
    }, { context: loadingRuntimeContext })],
    ['./webgpu/_title_webgpu_overlay_pipeline.js', new vm.SyntheticModule([
        'createTitleWebGpuOverlayPipeline'
    ], function init() {
        this.setExport('createTitleWebGpuOverlayPipeline', () => null);
    }, { context: loadingRuntimeContext })]
]);
const titlePresentationRuntimeModule = new vm.SourceTextModule(titlePresentationSource, {
    context: loadingRuntimeContext,
    identifier: '_title_scene_presentation.js'
});
await titlePresentationRuntimeModule.link((specifier) => presentationDependencyModules.get(specifier));
await titlePresentationRuntimeModule.evaluate();

const loadingRuntimeModule = new vm.SourceTextModule(loadingSceneSource, {
    context: loadingRuntimeContext,
    identifier: '_loading_scene.js'
});
const loadingBaseSceneModule = new vm.SyntheticModule(['BaseScene'], function init() {
    this.setExport('BaseScene', class BaseScene {
        constructor(sceneSystem) {
            this.sceneSystem = sceneSystem;
        }
    });
}, { context: loadingRuntimeContext });
const loadingControllerModule = new vm.SyntheticModule(['TitleSceneController'], function init() {
    this.setExport('TitleSceneController', class TitleSceneController {
        constructor(sceneSystem) {
            this.sceneSystem = sceneSystem;
            this.content = null;
        }

        setTitleContent(content) {
            this.content = content;
        }
    });
}, { context: loadingRuntimeContext });
const loadingRolloutModule = new vm.SyntheticModule(['createTitleGpuRolloutProfile'], function init() {
    this.setExport('createTitleGpuRolloutProfile', () => loadingRolloutProfile);
}, { context: loadingRuntimeContext });
const loadingDependencies = new Map([
    ['scene/_base_scene.js', loadingBaseSceneModule],
    ['../title/_title_scene_controller.js', loadingControllerModule],
    ['../title/_title_gpu_rollout.js', loadingRolloutModule],
    ['../title/_title_scene_presentation.js', titlePresentationRuntimeModule]
]);
await loadingRuntimeModule.link((specifier) => loadingDependencies.get(specifier));
await loadingRuntimeModule.evaluate();

const LoadingSceneRuntime = loadingRuntimeModule.namespace.LoadingScene;
const loadingRuntime = new LoadingSceneRuntime({});
const loadingPresentationIdentity = loadingRuntime.presentation;
const loadingControllerIdentity = loadingRuntime.titleController;
assert.strictEqual(loadingRuntime.titleGpuRolloutProfile, loadingRolloutProfile);
assert.strictEqual(
    loadingPresentationIdentity.titleGpuRolloutProfile,
    loadingRolloutProfile
);
assert.strictEqual(
    loadingPresentationIdentity.getTitleGpuRolloutProfile(),
    loadingRolloutProfile
);
assert.equal(loadingRuntime.releaseTitlePresentation(), null);
loadingPresentationIdentity.content.ready = true;
const loadingHandoff = loadingRuntime.releaseTitlePresentation();
assert.strictEqual(loadingHandoff.presentation, loadingPresentationIdentity);
assert.strictEqual(loadingHandoff.titleController, loadingControllerIdentity);
assert.strictEqual(loadingHandoff.titleGpuRolloutProfile, loadingRolloutProfile);
assert.strictEqual(
    loadingHandoff.presentation.titleGpuRolloutProfile,
    loadingHandoff.titleGpuRolloutProfile
);
assert.strictEqual(
    loadingHandoff.presentation.getTitleGpuRolloutProfile(),
    loadingHandoff.titleGpuRolloutProfile
);
assert.equal(loadingRuntime.presentation, null);
assert.equal(loadingRuntime.titleController, null);
assert.equal(loadingRuntime.titleGpuRolloutProfile, null);

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
const rolloutProfile = Object.freeze({
    pipelineMode: 'legacy-webgl',
    simulationMode: 'cpu'
});
const titlePresentation = {
    titleGpuRolloutProfile: rolloutProfile,
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
const TitleSceneRuntime = titleRuntimeModule.namespace.TitleScene;
const titleRuntime = new TitleSceneRuntime({}, {
    presentation: titlePresentation,
    titleController: { id: 'controller' },
    titleGpuRolloutProfile: rolloutProfile
});
assert.deepEqual(titleLifecycleTrace, ['begin']);
assert.strictEqual(titleRuntime.titleGpuRolloutProfile, rolloutProfile);
assert.strictEqual(titleRuntime.presentation, titlePresentation);
assert.strictEqual(
    titleRuntime.presentation.titleGpuRolloutProfile,
    titleRuntime.titleGpuRolloutProfile
);
assert.throws(() => new TitleSceneRuntime({}, {
    presentation: titlePresentation,
    titleController: { id: 'controller' },
    titleGpuRolloutProfile: { ...rolloutProfile }
}), /exact loading rollout profile identity/);
titleRuntime.update();
assert.deepEqual(titleLifecycleTrace, ['begin', 'update', 'promote']);

const trace = [];
class LoadingSceneStub {
    constructor(sceneSystem) {
        this.sceneSystem = sceneSystem;
        this.presentation = { id: 'presentation' };
        this.titleController = { id: 'controller' };
        this.titleGpuRolloutProfile = { id: 'rollout-profile' };
        this.ready = false;
        this.releaseCount = 0;
        this.destroyCount = 0;
    }

    releaseTitlePresentation() {
        this.releaseCount++;
        if (!this.ready) return null;
        return {
            presentation: this.presentation,
            titleController: this.titleController,
            titleGpuRolloutProfile: this.titleGpuRolloutProfile
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
        this.titleGpuRolloutProfile = handoff.titleGpuRolloutProfile;
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
    ['./game/production_game_start_route.js', new vm.SyntheticModule([
        'createProductionGameStartOptions'
    ], function init() {
        this.setExport('createProductionGameStartOptions', (mapId) => ({
            mapId,
            routeReceipt: 'production-game-start-options'
        }));
    }, { context })],
    ['./benchmark/_benchmark_scene.js', new vm.SyntheticModule(['BenchmarkScene'], function init() {
        this.setExport('BenchmarkScene', BenchmarkSceneStub);
    }, { context })],
    ['simulation/simulation_command_queue.js', new vm.SyntheticModule(['clearSimulationCommands'], function init() {
        this.setExport('clearSimulationCommands', () => {
            clearSimulationCommandCount++;
        });
    }, { context })],
    ['simulation/fixed_step_result_contract.js', new vm.SyntheticModule(['normalizeFixedStepResult'], function init() {
        this.setExport('normalizeFixedStepResult', (result) => {
            if (result === false) return 'DEFERRED_BACKPRESSURE';
            if (result === 'INTENTIONAL_PAUSE') return result;
            return 'COMPLETED';
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
const rolloutProfileIdentity = loadingScene.titleGpuRolloutProfile;

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
assert.strictEqual(sceneSystem.scene.titleGpuRolloutProfile, rolloutProfileIdentity);
assert.equal(loadingScene.destroyCount, 1);
assert.deepEqual(trace, ['title-create', 'loading-destroy']);
assert.equal(sceneSystem.completeLoading(loadingScene), false);
assert.equal(loadingScene.releaseCount, 2);

sceneSystem.gameStart('map-test');
assert.ok(sceneSystem.scene instanceof GameSceneStub);
assert.equal(sceneSystem.scene.options.mode, 'play');
assert.equal(sceneSystem.scene.options.mapId, 'map-test');
assert.equal(sceneSystem.scene.options.routeReceipt,
    'production-game-start-options');
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
