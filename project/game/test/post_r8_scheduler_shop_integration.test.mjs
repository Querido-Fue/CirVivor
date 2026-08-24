import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadGameModule } from './support/source_module_loader.mjs';

const GAME_ROOT = fileURLToPath(new URL('../', import.meta.url));

function syntheticModule(context, identifier, exports) {
    return new vm.SyntheticModule(
        Object.keys(exports),
        function initialize() {
            for (const [name, value] of Object.entries(exports)) {
                this.setExport(name, value);
            }
        },
        { context, identifier }
    );
}

async function loadSystemHandler(timeState, profilerState) {
    const context = vm.createContext({ console, performance });
    class EmptySystem {}
    const moduleBySpecifier = new Map([
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
            beginPerformanceSection() { return 0; },
            endPerformanceSection() {}
        }],
        ['sound/sound_system.js', { SoundSystem: EmptySystem }],
        ['game/time_handler.js', {
            getTimeHandler() { return timeState; }
        }],
        ['ui/_ui_pool.js', { warmupUIPools() {} }],
        ['simulation/simulation_command_queue.js', {
            drainSimulationCommands() { return []; }
        }],
        ['simulation/simulation_runtime.js', {
            syncSimulationRuntime() {}
        }],
        ['simulation/release_simulation_profiler.js', {
            isReleaseSimulationProfilerCollecting() { return true; },
            recordReleaseSimulationFixedStep(
                timestampMs,
                durationMs,
                completed,
                deferred
            ) {
                profilerState.fixedSamples.push({
                    timestampMs,
                    durationMs,
                    completed,
                    deferred
                });
            },
            shouldRecordReleaseSimulationForFrameMode(mode) {
                return mode !== 'paused' && mode !== 'step';
            }
        }],
        ['debug/_release_simulation_profiler_hud.js', {
            drawReleaseSimulationProfilerHud() {}
        }]
    ]);
    const sourcePath = path.join(GAME_ROOT, 'script', 'module', 'system_handler.js');
    const source = await readFile(sourcePath, 'utf8');
    const module = new vm.SourceTextModule(source, {
        context,
        identifier: pathToFileURL(sourcePath).href
    });
    await module.link((specifier) => {
        const exports = moduleBySpecifier.get(specifier);
        if (!exports) throw new Error(`SystemHandler stub 누락: ${specifier}`);
        return syntheticModule(context, `stub:${specifier}`, exports);
    });
    await module.evaluate();
    return module.namespace.SystemHandler;
}

async function loadApp(SystemHandler, frameState) {
    const fixedPolicy = await loadGameModule(
        'simulation/fixed_step_catch_up_policy.js'
    );
    const windowObject = {
        addEventListener() {}
    };
    const documentObject = {
        hidden: false,
        hasFocus() { return true; },
        addEventListener() {},
        documentElement: { style: {} }
    };
    let requestId = 0;
    const context = vm.createContext({
        console,
        performance,
        window: windowObject,
        document: documentObject,
        requestAnimationFrame() { return ++requestId; },
        cancelAnimationFrame() {},
        setTimeout
    });
    class EmptyConstructor {}
    const moduleBySpecifier = new Map([
        ['game/module/system_handler.js', { SystemHandler }],
        ['game/time_handler.js', { TimeHandler: EmptyConstructor }],
        ['util/math_util.js', { MathUtil: EmptyConstructor }],
        ['util/color_util.js', { ColorUtil: EmptyConstructor }],
        ['util/runtime_tool.js', {
            RuntimeTool: EmptyConstructor,
            runtimeTool() { return { closeWindow() {} }; }
        }],
        ['simulation/fixed_step_catch_up_policy.js', {
            FixedStepCatchUpPolicy: fixedPolicy.FixedStepCatchUpPolicy,
            countExcessFixedStepDebt: fixedPolicy.countExcessFixedStepDebt,
            restoreUncompletedFixedStepDebt:
                fixedPolicy.restoreUncompletedFixedStepDebt
        }],
        ['simulation/release_simulation_profiler.js', {
            isReleaseSimulationProfilerCollecting() { return true; },
            recordReleaseSimulationFrame(
                timestampMs,
                frameCpuMs,
                frameIntervalSeconds,
                scheduledFixedStepCount,
                droppedFixedStepCount,
                clampLossSeconds,
                fixedStepSeconds,
                cpuBound,
                intentionalPauseCount
            ) {
                frameState.frames.push({
                    timestampMs,
                    frameCpuMs,
                    frameIntervalSeconds,
                    scheduledFixedStepCount,
                    droppedFixedStepCount,
                    clampLossSeconds,
                    fixedStepSeconds,
                    cpuBound,
                    intentionalPauseCount
                });
            },
            resumeReleaseSimulationProfiler() {},
            shouldRecordReleaseSimulationForFrameMode(mode) {
                return mode !== 'paused' && mode !== 'step';
            },
            suspendReleaseSimulationProfiler() {}
        }],
        ['display/webgl/_webgl_gpu_telemetry_state.js', {
            advanceWebGLGpuTelemetryFrame() {}
        }]
    ]);
    const sourcePath = path.join(GAME_ROOT, 'script', 'main.js');
    const source = await readFile(sourcePath, 'utf8');
    const module = new vm.SourceTextModule(source, {
        context,
        identifier: pathToFileURL(sourcePath).href
    });
    await module.link((specifier) => {
        const exports = moduleBySpecifier.get(specifier);
        if (!exports) throw new Error(`App stub 누락: ${specifier}`);
        return syntheticModule(context, `stub:${specifier}`, exports);
    });
    await module.evaluate();
    return module.namespace.App;
}

function createGameSceneDependencies() {
    return {
        inputActionSource: {
            isPressed() { return false; },
            getPointerPosition(out) {
                out.x = 0;
                out.y = 0;
                return out;
            },
            isPrimaryPointerPressed() { return false; },
            getWheelTotals(out) {
                out.x = 0;
                out.y = 0;
                return out;
            }
        },
        animationPort: {
            animate() {
                return {
                    promise: Promise.resolve(),
                    retarget() { return true; },
                    remove() {},
                    isActive() { return true; }
                };
            }
        },
        timePort: {
            getDelta() { return 1 / 60; },
            getFixedDelta() { return 1 / 60; },
            getFixedInterpolationAlpha() { return 0.5; }
        },
        viewportPort: {
            getSnapshot(out) {
                Object.assign(out, {
                    ww: 1280,
                    wh: 720,
                    uiww: 1280,
                    uiOffsetX: 0,
                    uiScale: 1
                });
                return out;
            }
        },
        worldRenderPort: {
            drawCircle() {},
            drawSquareInstances() {}
        },
        legacyWorldPort: { clear() {} }
    };
}

function fixedOnlyPolicy(handler) {
    return handler.createPausePolicy({
        runFrameTimeUpdate: false,
        runSoundUpdate: false,
        runAnimationUpdate: false,
        runInputUpdate: false,
        runUiUpdate: false,
        runOverlayUpdate: false,
        runObjectUpdate: false,
        runSceneUpdate: false,
        runSimulationCommandApply: false,
        runDebugUpdate: false,
        renderFrame: false,
        renderInput: false,
        renderObject: false,
        renderScene: false,
        renderUi: false,
        renderOverlay: false,
        renderDebug: false,
        renderSound: false
    });
}

test('actual App→SystemHandler→SceneSystem→GameScene SHOP 10초는 debt/catch-up을 만들지 않는다', async (t) => {
    const previousWindow = globalThis.window;
    const previousRequire = globalThis.require;
    const nodeRequire = createRequire(import.meta.url);
    globalThis.window = {
        nw: { App: { argv: [] } },
        require: nodeRequire
    };
    globalThis.require = nodeRequire;
    t.after(() => {
        if (previousWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = previousWindow;
        }
        if (previousRequire === undefined) {
            delete globalThis.require;
        } else {
            globalThis.require = previousRequire;
        }
    });
    const { GameScene } = await loadGameModule('scene/game/_game_scene.js');
    const { SceneSystem } = await loadGameModule('scene/scene_system.js');
    const shopData = await loadGameModule(
        'data/word/r8_word_shop_catalog_data.js'
    );
    const shopContract = await loadGameModule(
        'ingame/contract/word_shop_contract.js'
    );
    const runtimeConfig = await loadGameModule(
        'ingame/contract/shop_runtime_configuration_contract.js'
    );
    const timeState = {
        fixedStepSeconds: 1 / 60,
        fixedUpdateCount: 0,
        fixedAlpha: 0,
        updateFixed() { this.fixedUpdateCount++; },
        setFixedInterpolationAlpha(value) { this.fixedAlpha = value; }
    };
    const profilerState = { fixedSamples: [] };
    const SystemHandler = await loadSystemHandler(timeState, profilerState);
    const frameState = { frames: [] };
    const App = await loadApp(SystemHandler, frameState);
    const scene = new GameScene(null, {
        dependencies: createGameSceneDependencies(),
        enemyWaveEnabled: false,
        initialGold: shopData.R8_WORD_SHOP_BALANCE.QA_INITIAL_GOLD,
        r8ShopOptions: {
            mode: runtimeConfig.SHOP_RUNTIME_CONFIGURATION_MODE.QA,
            autoOpen: true,
            sourceId: 'test.actual-scheduler',
            runSessionId: 'run.actual-scheduler',
            runSeed: shopData.R8_WORD_SHOP_BALANCE.QA_RUN_SEED,
            unlockedWordDefinitionIds:
                shopData.R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
            unlockedPoolFingerprint: shopContract.fingerprintUnlockedWordPool(
                shopData.R8_ALL_UNLOCKED_WORD_DEFINITION_IDS
            ),
            allowEconomicallyRedundantOffers: true
        }
    });
    const sceneSystem = new SceneSystem({});
    sceneSystem.scene = scene;
    const counters = {
        animationFixed: 0,
        globalObjectFixed: 0,
        sceneFixed: 0,
        gameManagerFixed: 0
    };
    const originalSceneFixed = sceneSystem.fixedUpdate.bind(sceneSystem);
    sceneSystem.fixedUpdate = () => {
        counters.sceneFixed++;
        return originalSceneFixed();
    };
    const handler = new SystemHandler();
    handler.sceneSystem = sceneSystem;
    handler.animationSystem = {
        update() { counters.animationFixed++; }
    };
    handler.objectSystem = {
        fixedUpdate() { counters.globalObjectFixed++; }
    };
    handler.gameManager = {
        fixedUpdate() { counters.gameManagerFixed++; }
    };
    handler.frameExecutionPolicy = fixedOnlyPolicy(handler);
    const receipts = [];
    const contexts = [];
    const originalTick = handler.tick.bind(handler);
    handler.tick = (context) => {
        contexts.push({ ...context });
        const receipt = originalTick(context);
        receipts.push(receipt);
        return receipt;
    };

    const firstBoundary = handler.tick({
        frameDeltaSeconds: 1 / 60,
        fixedStepSeconds: 1 / 60,
        fixedStepCount: 1,
        fixedAlpha: 0,
        debugFrameMode: 'running'
    });
    assert.equal(firstBoundary.completedFixedStepCount, 1);
    const openingBoundary = handler.tick({
        frameDeltaSeconds: 1 / 60,
        fixedStepSeconds: 1 / 60,
        fixedStepCount: 2,
        fixedAlpha: 0,
        debugFrameMode: 'running'
    });
    assert.deepEqual(
        { ...openingBoundary },
        {
            requestedFixedStepCount: 2,
            completedFixedStepCount: 1,
            deferredBackpressureCount: 0,
            intentionalPauseCount: 1,
            consumedFixedStepCount: 2
        }
    );
    const gameSystem = scene.getGameSystem();
    assert.equal(gameSystem.getShopPhaseStatus().phase, 'SHOP');
    assert.equal(timeState.fixedAlpha, 1);
    const backend = gameSystem.getObjectSystem().getEnemySimulationBackend();
    const submitBeforeShop = backend.getEventProtocolState().submittedTickCount;
    const pipelineBeforeShop = { ...counters };
    const fixedTimeBeforeShop = timeState.fixedUpdateCount;
    const releaseBeforeShop = profilerState.fixedSamples.length;

    const app = new App(handler);
    app.running = true;
    app.lastFrameTimestamp = 1_000;
    let now = 1_000;
    const receiptStart = receipts.length;
    for (let frame = 0; frame < 600; frame++) {
        now += 1000 / 60;
        app.loop(now);
    }
    const shopReceipts = receipts.slice(receiptStart);
    assert.equal(shopReceipts.length, 600);
    assert.equal(
        shopReceipts.every((receipt) => (
            receipt.requestedFixedStepCount === 0
            && receipt.deferredBackpressureCount === 0
            && receipt.intentionalPauseCount === 0
        )),
        true
    );
    assert.equal(app.accumulatorSeconds, 0);
    assert.deepEqual(counters, pipelineBeforeShop);
    assert.equal(timeState.fixedUpdateCount, fixedTimeBeforeShop);
    assert.equal(profilerState.fixedSamples.length, releaseBeforeShop);
    assert.equal(
        backend.getEventProtocolState().submittedTickCount,
        submitBeforeShop
    );
    const shopFrames = frameState.frames.slice(-600);
    assert.equal(
        shopFrames.every((frame) => (
            frame.scheduledFixedStepCount === 0
            && frame.droppedFixedStepCount === 0
        )),
        true
    );

    const fixedTickBeforeContinue = gameSystem.getFixedTick();
    gameSystem.requestShopContinue({
        transactionId: 'actual-scheduler.continue'
    });
    let closingReceipt = null;
    for (let frame = 0; frame < 3; frame++) {
        now += 1000 / 60;
        app.loop(now);
        const candidate = receipts.at(-1);
        assert.ok(candidate.requestedFixedStepCount <= 1);
        if (candidate.requestedFixedStepCount > 0) {
            closingReceipt = candidate;
            break;
        }
    }
    assert.ok(closingReceipt);
    assert.equal(closingReceipt.requestedFixedStepCount, 1);
    assert.equal(closingReceipt.completedFixedStepCount, 1);
    assert.equal(closingReceipt.deferredBackpressureCount, 0);
    assert.equal(gameSystem.getFixedTick(), fixedTickBeforeContinue);
    assert.equal(gameSystem.getShopPhaseStatus().phase, 'COMBAT');

    let resumedReceipt = null;
    for (let frame = 0; frame < 3; frame++) {
        now += 1000 / 60;
        app.loop(now);
        const candidate = receipts.at(-1);
        assert.ok(candidate.requestedFixedStepCount <= 1);
        if (candidate.requestedFixedStepCount > 0) {
            resumedReceipt = candidate;
            break;
        }
    }
    assert.ok(resumedReceipt);
    assert.equal(resumedReceipt.requestedFixedStepCount, 1);
    assert.equal(resumedReceipt.completedFixedStepCount, 1);
    assert.equal(resumedReceipt.deferredBackpressureCount, 0);
    assert.equal(gameSystem.getFixedTick(), fixedTickBeforeContinue + 1);
    assert.ok(app.accumulatorSeconds < app.fixedStepSeconds);
    assert.equal(frameState.frames.at(-1).droppedFixedStepCount, 0);
    scene.destroy();
});

test('SystemHandler backpressure receipt는 미실행 remainder를 debt로 보존한다', async () => {
    const timeState = {
        fixedStepSeconds: 1 / 60,
        updateCount: 0,
        updateFixed() { this.updateCount++; },
        setFixedInterpolationAlpha() {}
    };
    const profilerState = { fixedSamples: [] };
    const SystemHandler = await loadSystemHandler(timeState, profilerState);
    const handler = new SystemHandler();
    let attemptCount = 0;
    handler.sceneSystem = {
        getFixedStepDisposition() { return 'COMPLETED'; },
        getFixedStepBatchBoundaryRevision() { return 0; },
        fixedUpdate() {
            attemptCount++;
            return false;
        }
    };
    handler.animationSystem = { update() {} };
    handler.objectSystem = { fixedUpdate() {} };
    handler.gameManager = { fixedUpdate() { assert.fail('deferred manager'); } };
    handler.frameExecutionPolicy = fixedOnlyPolicy(handler);
    const receipt = handler.tick({
        fixedStepSeconds: 1 / 60,
        fixedStepCount: 2,
        fixedAlpha: 0,
        debugFrameMode: 'running'
    });
    assert.deepEqual(
        { ...receipt },
        {
            requestedFixedStepCount: 2,
            completedFixedStepCount: 0,
            deferredBackpressureCount: 2,
            intentionalPauseCount: 0,
            consumedFixedStepCount: 0
        }
    );
    assert.equal(attemptCount, 1);
    assert.equal(timeState.updateCount, 1);
    assert.equal(profilerState.fixedSamples.length, 1);
    assert.equal(profilerState.fixedSamples[0].deferred, true);
});
