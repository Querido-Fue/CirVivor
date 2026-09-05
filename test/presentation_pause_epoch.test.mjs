import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const systemHandlerSource = await readFile(
    new URL('../project/game/script/module/system_handler.js', import.meta.url),
    'utf8'
);
const sceneSystemSource = await readFile(
    new URL('../project/game/script/module/scene/scene_system.js', import.meta.url),
    'utf8'
);
const gameSceneSource = await readFile(
    new URL('../project/game/script/module/scene/game/_game_scene.js', import.meta.url),
    'utf8'
);
const baseSceneSource = await readFile(
    new URL('../project/game/script/module/scene/_base_scene.js', import.meta.url),
    'utf8'
);

const FIXED_STEP_RESULT = Object.freeze({
    COMPLETED: 'COMPLETED',
    DEFERRED_BACKPRESSURE: 'DEFERRED_BACKPRESSURE',
    INTENTIONAL_PAUSE: 'INTENTIONAL_PAUSE'
});

function normalizeFixedStepResult(result) {
    if (result === true || result === undefined) return FIXED_STEP_RESULT.COMPLETED;
    if (result === false) return FIXED_STEP_RESULT.DEFERRED_BACKPRESSURE;
    return result;
}

function createSyntheticModule(context, exports) {
    const exportNames = Object.keys(exports);
    return new vm.SyntheticModule(exportNames, function initialize() {
        for (const exportName of exportNames) {
            this.setExport(exportName, exports[exportName]);
        }
    }, { context });
}

async function loadSystemHandler() {
    const context = vm.createContext({ console });
    const timeHandler = {
        fixedStepSeconds: 1 / 60,
        freezeFrameDelta() {},
        setFixedInterpolationAlpha() {}
    };
    class EmptySystem {}
    const dependencies = new Map([
        ['save/save_system.js', { SaveSystem: EmptySystem }],
        ['display/display_system.js', { DisplaySystem: EmptySystem }],
        ['animation/animation_system.js', { AnimationSystem: EmptySystem }],
        ['input/input_system.js', { InputSystem: EmptySystem }],
        ['object/object_system.js', { ObjectSystem: EmptySystem }],
        ['scene/scene_system.js', { SceneSystem: EmptySystem }],
        ['ui/ui_system.js', { UISystem: EmptySystem }],
        ['overlay/overlay_system.js', { OverlayManager: EmptySystem }],
        ['debug/debug_system.js', {
            DebugSystem: EmptySystem,
            beginPerformanceSection: () => 0,
            endPerformanceSection: () => {}
        }],
        ['sound/sound_system.js', { SoundSystem: EmptySystem }],
        ['game/time_handler.js', { getTimeHandler: () => timeHandler }],
        ['ui/_ui_pool.js', { warmupUIPools: () => {} }],
        ['simulation/simulation_command_queue.js', {
            drainSimulationCommands: () => []
        }],
        ['simulation/simulation_runtime.js', { syncSimulationRuntime: () => {} }],
        ['simulation/release_simulation_profiler.js', {
            isReleaseSimulationProfilerCollecting: () => false,
            recordReleaseSimulationFixedStep: () => {},
            shouldRecordReleaseSimulationForFrameMode: () => false
        }],
        ['debug/_release_simulation_profiler_hud.js', {
            drawReleaseSimulationProfilerHud: () => {}
        }]
    ]);
    const dependencyModules = new Map(
        [...dependencies].map(([specifier, exports]) => [
            specifier,
            createSyntheticModule(context, exports)
        ])
    );
    const module = new vm.SourceTextModule(systemHandlerSource, {
        context,
        identifier: 'system_handler.js'
    });
    await module.link((specifier) => dependencyModules.get(specifier));
    await module.evaluate();
    return module.namespace.SystemHandler;
}

async function loadSceneSystem() {
    const context = vm.createContext({ console });
    class EmptyScene {}
    const module = new vm.SourceTextModule(sceneSystemSource, {
        context,
        identifier: 'scene_system.js'
    });
    const dependencies = new Map([
        ['./title/_title_scene.js', createSyntheticModule(context, { TitleScene: EmptyScene })],
        ['./loading/_loading_scene.js', createSyntheticModule(context, { LoadingScene: EmptyScene })],
        ['./game/_game_scene.js', createSyntheticModule(context, {
            GAME_SCENE_MODES: { PLAY: 'play', BENCHMARK: 'benchmark' },
            GameScene: EmptyScene
        })],
        ['./benchmark/_benchmark_scene.js', createSyntheticModule(context, { BenchmarkScene: EmptyScene })],
        ['./game/production_game_start_route.js', createSyntheticModule(context, {
            createProductionGameStartOptions: (mapId) => ({ mapId })
        })],
        ['simulation/simulation_command_queue.js', createSyntheticModule(context, {
            clearSimulationCommands: () => {}
        })],
        ['simulation/fixed_step_result_contract.js', createSyntheticModule(context, {
            normalizeFixedStepResult
        })]
    ]);
    await module.link((specifier) => dependencies.get(specifier));
    await module.evaluate();
    return module.namespace.SceneSystem;
}

async function loadGameScene(onSynchronize) {
    const context = vm.createContext({ console });
    class BaseSceneStub {
        constructor(sceneSystem) {
            this.sceneSystem = sceneSystem;
        }
    }
    class GameSystemStub {
        enter() {}
        synchronizePresentation() {
            onSynchronize();
        }
    }
    const module = new vm.SourceTextModule(gameSceneSource, {
        context,
        identifier: '_game_scene.js'
    });
    const dependencies = new Map([
        ['scene/_base_scene.js', createSyntheticModule(context, { BaseScene: BaseSceneStub })],
        ['ingame/game_system.js', createSyntheticModule(context, { GameSystem: GameSystemStub })],
        ['simulation/fixed_step_result_contract.js', createSyntheticModule(context, {
            FIXED_STEP_RESULT
        })],
        ['./game_scene_dependency_factory.js', createSyntheticModule(context, {
            createGameSceneDependencies: () => ({})
        })]
    ]);
    await module.link((specifier) => dependencies.get(specifier));
    await module.evaluate();
    return module.namespace.GameScene;
}

const DISABLED_FRAME_POLICY = Object.freeze({
    runFrameTimeUpdate: false,
    runFixedStep: false,
    runSoundUpdate: false,
    runAnimationUpdate: false,
    runInputUpdate: false,
    runUiUpdate: false,
    runOverlayUpdate: false,
    runObjectUpdate: false,
    runSceneUpdate: false,
    runSimulationCommandApply: false,
    runDebugUpdate: false,
    renderFrame: false
});

test('setPauseReason은 실제 진입·해제마다 presentation을 정확히 한 번 동기화한다', async () => {
    const SystemHandler = await loadSystemHandler();
    const systemHandler = new SystemHandler();
    let synchronizeCount = 0;
    systemHandler.sceneSystem = {
        synchronizePresentation() {
            synchronizeCount++;
        }
    };

    assert.equal(systemHandler.setPauseReason('app-inactive', true, {
        keepLoopRunning: false,
        runSceneUpdate: false
    }), true);
    assert.equal(synchronizeCount, 1);
    assert.equal(systemHandler.setPauseReason('app-inactive', true, {
        keepLoopRunning: false,
        runSceneUpdate: false
    }), false);
    assert.equal(synchronizeCount, 1);
    assert.equal(systemHandler.clearPauseReason('app-inactive'), true);
    assert.equal(synchronizeCount, 2);
    assert.equal(systemHandler.clearPauseReason('app-inactive'), false);
    assert.equal(synchronizeCount, 2);
});

test('debug paused 경계는 scene update가 꺼져도 진입·해제마다 한 번만 동기화한다', async () => {
    const SystemHandler = await loadSystemHandler();
    const systemHandler = new SystemHandler();
    let synchronizeCount = 0;
    systemHandler.sceneSystem = {
        synchronizePresentation() {
            synchronizeCount++;
        }
    };
    systemHandler.frameExecutionPolicy = systemHandler.createPausePolicy(DISABLED_FRAME_POLICY);

    systemHandler.tick({ debugFrameMode: 'running' });
    assert.equal(synchronizeCount, 0);
    systemHandler.tick({ debugFrameMode: 'paused' });
    systemHandler.tick({ debugFrameMode: 'paused' });
    assert.equal(synchronizeCount, 1);
    systemHandler.tick({ debugFrameMode: 'step' });
    systemHandler.tick({ debugFrameMode: 'step' });
    assert.equal(synchronizeCount, 2);
    systemHandler.tick({ debugFrameMode: 'paused' });
    assert.equal(synchronizeCount, 3);
    systemHandler.tick({ debugFrameMode: 'running' });
    systemHandler.tick({ debugFrameMode: 'running' });
    assert.equal(synchronizeCount, 4);
});

test('SceneSystem과 GameScene은 동기화 훅을 현재 플레이 세션에만 전달한다', async () => {
    const SceneSystem = await loadSceneSystem();
    const sceneSystem = new SceneSystem({});
    let sceneCallCount = 0;
    sceneSystem.scene = {
        synchronizePresentation() {
            sceneCallCount++;
        }
    };
    sceneSystem.synchronizePresentation();
    assert.equal(sceneCallCount, 1);
    sceneSystem.scene = {};
    assert.doesNotThrow(() => sceneSystem.synchronizePresentation());

    let gameSystemCallCount = 0;
    const GameScene = await loadGameScene(() => {
        gameSystemCallCount++;
    });
    const gameScene = new GameScene({}, {
        dependencies: {
            legacyWorldPort: { clear() {} }
        }
    });
    gameScene.synchronizePresentation();
    assert.equal(gameSystemCallCount, 1);
});

test('BaseScene의 기본 동기화 훅은 title·benchmark 호환 no-op이다', async () => {
    const context = vm.createContext({ console });
    const module = new vm.SourceTextModule(baseSceneSource, {
        context,
        identifier: '_base_scene.js'
    });
    await module.link(() => {
        throw new Error('BaseScene은 dependency를 가져오지 않아야 합니다.');
    });
    await module.evaluate();
    const scene = new module.namespace.BaseScene({});
    assert.doesNotThrow(() => scene.synchronizePresentation());
});
