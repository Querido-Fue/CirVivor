import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const BENCHMARK_SCENE_SOURCE = await readFile(
    new URL('../script/module/scene/benchmark/_benchmark_scene.js', import.meta.url),
    'utf8'
);

const PRESENTATION_PROFILES = Object.freeze({
    STRICT_INTERPOLATION: 'strict-interpolation',
    REFERENCE_CLOCK_EXTRAPOLATION: 'reference-clock-extrapolation',
    CAPPED_ACCUMULATOR_EXTRAPOLATION: 'capped-accumulator-extrapolation'
});
const COMMAND_TYPES = Object.freeze({
    REPLACE_AUXILIARY_WORLD: 'benchmarkScene.replaceAuxiliaryWorld',
    SPAWN_GPU_ENEMY_BATCH: 'benchmarkScene.spawnGpuEnemyBatch',
    SPAWN_GPU_PROJECTILE_BATCH: 'benchmarkScene.spawnGpuProjectileBatch',
    APPEND_BOX_WALLS: 'benchmarkScene.appendBoxWalls',
    DESTROY_AUXILIARY_WORLD: 'benchmarkScene.destroyAuxiliaryWorld'
});

function createSyntheticModule(context, identifier, exports) {
    const exportNames = Object.keys(exports);
    return new vm.SyntheticModule(exportNames, function initialize() {
        for (const exportName of exportNames) {
            this.setExport(exportName, exports[exportName]);
        }
    }, { context, identifier });
}

function applyCommandBatch(scene, commands) {
    for (const command of commands) {
        if (command.type === COMMAND_TYPES.REPLACE_AUXILIARY_WORLD) {
            scene.player = command.player;
            scene.staticWalls = [...command.staticWalls];
            scene.boxWalls = [...command.boxWalls];
            scene.projectiles = [...command.projectiles];
            continue;
        }
        if (command.type === COMMAND_TYPES.SPAWN_GPU_ENEMY_BATCH) {
            scene.spawnGpuEnemyBatch(command.count);
            continue;
        }
        if (command.type === COMMAND_TYPES.APPEND_BOX_WALLS) {
            scene.boxWalls.push(...command.walls);
            continue;
        }
        if (command.type === COMMAND_TYPES.SPAWN_GPU_PROJECTILE_BATCH) {
            scene.spawnGpuProjectileBatch(command.count);
            continue;
        }
        if (command.type === COMMAND_TYPES.DESTROY_AUXILIARY_WORLD) {
            scene.player = null;
            scene.staticWalls = [];
            scene.boxWalls = [];
            scene.projectiles = [];
        }
    }
}

async function createBenchmarkHarness() {
    const trace = {
        appliedCommandBatches: [],
        buildResetCount: 0,
        buildSpawnGpuEnemyCounts: [],
        buildSpawnBoxCount: 0,
        buildSpawnGpuProjectileCounts: [],
        enqueuedCommands: [],
        requestedGpuBatches: [],
        requestedGpuProjectileBatches: [],
        requestedGpuPlayerProxies: [],
        navigationSources: [],
        profilerStates: [],
        buttonDraws: [],
        gpuHudDraws: [],
        auxiliaryWorldDraws: [],
        buttonUpdateCount: 0,
        projectileCullCount: 0,
        collisionSyncCount: 0
    };
    const objectSystem = Object.freeze({ id: 'cpu-auxiliary-object-system' });
    let profilerEnabled = false;
    const context = vm.createContext({ console });
    const dependencies = new Map([
        ['scene/_base_scene.js', createSyntheticModule(context, '_base_scene.js', {
            BaseScene: class BaseScene {
                constructor(sceneSystem) {
                    this.sceneSystem = sceneSystem;
                }
            }
        })],
        ['object/object_system.js', createSyntheticModule(context, 'object_system.js', {
            getObjectSystem() {
                return objectSystem;
            }
        })],
        ['ingame/gpu_simulation_endpoint.js', createSyntheticModule(
            context,
            'gpu_simulation_endpoint.js',
            { GPU_BODY_PRESENTATION_PROFILE: PRESENTATION_PROFILES }
        )],
        ['simulation/simulation_command_queue.js', createSyntheticModule(
            context,
            'simulation_command_queue.js',
            {
                enqueueSimulationCommand(command) {
                    trace.enqueuedCommands.push(command);
                    return true;
                }
            }
        )],
        ['../game/_game_scene.js', createSyntheticModule(context, '_game_scene.js', {
            GameScene: class GameScene {}
        })],
        ['../game/game_scene_dependency_factory.js', createSyntheticModule(
            context,
            'game_scene_dependency_factory.js',
            {
                createGameSceneDependencies() {
                    throw new Error('테스트는 명시적 dependencies를 사용해야 합니다.');
                }
            }
        )],
        ['./benchmark_scene_snapshot_utils.js', createSyntheticModule(
            context,
            'benchmark_scene_snapshot_utils.js',
            { createDefaultCollisionStats: () => ({ collisionCheckCount: 0 }) }
        )],
        ['./commands/benchmark_scene_command_builder.js', createSyntheticModule(
            context,
            'benchmark_scene_command_builder.js',
            {
                buildBenchmarkSceneResetAuxiliaryWorldCommands() {
                    trace.buildResetCount++;
                    return [{
                        type: COMMAND_TYPES.REPLACE_AUXILIARY_WORLD,
                        player: { id: 'cpu-player' },
                        staticWalls: [{ id: 'static-a' }, { id: 'static-b' }],
                        boxWalls: [{ id: 'reset-box-a' }, { id: 'reset-box-b' }],
                        projectiles: []
                    }];
                },
                buildBenchmarkSceneSpawnGpuEnemiesCommand(count) {
                    trace.buildSpawnGpuEnemyCounts.push(count);
                    return {
                        type: COMMAND_TYPES.SPAWN_GPU_ENEMY_BATCH,
                        count
                    };
                },
                buildBenchmarkSceneSpawnGpuProjectileBatchCommand(count = 10) {
                    trace.buildSpawnGpuProjectileCounts.push(count);
                    return {
                        type: COMMAND_TYPES.SPAWN_GPU_PROJECTILE_BATCH,
                        count
                    };
                },
                buildBenchmarkSceneSpawnRandomBoxCommand() {
                    trace.buildSpawnBoxCount++;
                    return {
                        type: COMMAND_TYPES.APPEND_BOX_WALLS,
                        walls: [{ id: 'queued-box' }]
                    };
                }
            }
        )],
        ['./commands/benchmark_scene_command_apply_handlers.js', createSyntheticModule(
            context,
            'benchmark_scene_command_apply_handlers.js',
            {
                applyBenchmarkSceneCommandsToLocalState(scene, commands) {
                    trace.appliedCommandBatches.push({
                        scene,
                        commands: [...commands]
                    });
                    applyCommandBatch(scene, commands);
                }
            }
        )],
        ['./commands/benchmark_scene_command_protocol.js', createSyntheticModule(
            context,
            'benchmark_scene_command_protocol.js',
            { BENCHMARK_SCENE_COMMAND_TYPES: COMMAND_TYPES }
        )],
        ['./gpu_benchmark_enemy_spawn_adapter.js', createSyntheticModule(
            context,
            'gpu_benchmark_enemy_spawn_adapter.js',
            {
                requestGpuBenchmarkEnemyBatch(request) {
                    trace.requestedGpuBatches.push({ ...request });
                    return Object.freeze({
                        accepted: true,
                        requestedCount: request.count,
                        queuedCount: request.count,
                        targetFixedTick:
                            request.gameScene.getNextGpuLifecycleFixedTick(),
                        reason: 'queued',
                        nextSpawnSequence: request.spawnSequence + request.count
                    });
                }
            }
        )],
        ['./gpu_benchmark_projectile_spawn_adapter.js', createSyntheticModule(
            context,
            'gpu_benchmark_projectile_spawn_adapter.js',
            {
                requestGpuBenchmarkProjectileBatch(request) {
                    trace.requestedGpuProjectileBatches.push({ ...request });
                    return Object.freeze({
                        accepted: true,
                        requestedCount: request.count,
                        queuedCount: request.count,
                        targetFixedTick:
                            request.gameScene.getNextGpuLifecycleFixedTick(),
                        reason: 'queued',
                        nextSpawnSequence:
                            request.spawnSequence + request.count
                    });
                }
            }
        )],
        ['./gpu_benchmark_player_proxy_spawn_adapter.js', createSyntheticModule(
            context,
            'gpu_benchmark_player_proxy_spawn_adapter.js',
            {
                GPU_BENCHMARK_PLAYER_PROXY_KIND_ID: 'benchmark-player-proxy',
                requestGpuBenchmarkPlayerProxy(request) {
                    const result = Object.freeze({
                        accepted: true,
                        requestedCount: 1,
                        queuedCount: 1,
                        targetFixedTick:
                            request.gameScene.getNextGpuLifecycleFixedTick(),
                        reason: 'queued'
                    });
                    trace.requestedGpuPlayerProxies.push({
                        ...request,
                        result
                    });
                    return result;
                }
            }
        )],
        ['./gpu_benchmark_navigation_source.js', createSyntheticModule(
            context,
            'gpu_benchmark_navigation_source.js',
            {
                createGpuBenchmarkNavigationSource() {
                    const source = Object.freeze({
                        id: `benchmark-navigation-${trace.navigationSources.length + 1}`
                    });
                    trace.navigationSources.push(source);
                    return source;
                }
            }
        )],
        ['./render/benchmark_scene_button_renderer.js', createSyntheticModule(
            context,
            'benchmark_scene_button_renderer.js',
            {
                drawGameSceneButtons(buttons, options) {
                    trace.buttonDraws.push({ buttons, options: { ...options } });
                }
            }
        )],
        ['./render/gpu_benchmark_hud_renderer.js', createSyntheticModule(
            context,
            'gpu_benchmark_hud_renderer.js',
            {
                drawGpuBenchmarkHud(status, viewport) {
                    trace.gpuHudDraws.push({ status, viewport: { ...viewport } });
                }
            }
        )],
        ['./render/benchmark_scene_world_renderer.js', createSyntheticModule(
            context,
            'benchmark_scene_world_renderer.js',
            {
                drawGameSceneWorldObjects(options) {
                    trace.auxiliaryWorldDraws.push({ ...options });
                }
            }
        )],
        ['./update/benchmark_scene_update_helpers.js', createSyntheticModule(
            context,
            'benchmark_scene_update_helpers.js',
            {
                cullLocalGameSceneProjectiles() {
                    trace.projectileCullCount++;
                },
                syncGameSceneCollisionStats(scene) {
                    trace.collisionSyncCount++;
                    scene.collisionStats.collisionCheckCount = 17;
                },
                updateGameSceneButtonInput() {
                    trace.buttonUpdateCount++;
                    return false;
                }
            }
        )],
        ['simulation/simulation_runtime.js', createSyntheticModule(
            context,
            'simulation_runtime.js',
            {
                getSimulationObjectOffsetY: () => 24,
                getSimulationObjectWH: () => 900,
                getSimulationWH: () => 1080,
                getSimulationWW: () => 1920
            }
        )],
        ['debug/debug_system.js', createSyntheticModule(context, 'debug_system.js', {
            beginPerformanceSection: () => 0,
            endPerformanceSection: () => {}
        })],
        ['simulation/release_simulation_profiler.js', createSyntheticModule(
            context,
            'release_simulation_profiler.js',
            {
                isReleaseSimulationProfilerCollecting: () => profilerEnabled,
                setReleaseSimulationProfilerEnabled(enabled) {
                    profilerEnabled = enabled === true;
                    trace.profilerStates.push(profilerEnabled);
                    return profilerEnabled;
                }
            }
        )]
    ]);

    const module = new vm.SourceTextModule(BENCHMARK_SCENE_SOURCE, {
        context,
        identifier: 'scene/benchmark/_benchmark_scene.js'
    });
    await module.link((specifier) => {
        const dependency = dependencies.get(specifier);
        if (!dependency) {
            throw new Error(`예상하지 못한 BenchmarkScene import입니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();
    return {
        BenchmarkScene: module.namespace.BenchmarkScene,
        BENCHMARK_SCENE_RUNTIME_MODES: module.namespace.BENCHMARK_SCENE_RUNTIME_MODES,
        trace
    };
}

function createGpuChild(sceneHandler, options) {
    const calls = {
        fixedUpdate: 0,
        update: [],
        draw: 0,
        drawEnemySimulation: 0,
        resize: 0,
        synchronizePresentation: 0,
        destroy: 0
    };
    const gameSystem = {
        getFixedTick: () => 41,
        getNextGpuLifecycleFixedTick: () => 42,
        isEnemySimulationRecoveryRequired: () => false
    };
    const endpoint = {
        getStatus() {
            return {
                state: 'gpu-ready',
                activeCount: 24,
                reservedCount: 2,
                pendingCommandCount: 4,
                recoveryRequired: false,
                backend: {
                    gpu: {
                        presentation: {
                            profile: options.enemyPresentationProfile,
                            predictionDelta: 0.008,
                            interpolationAlpha: 0.5
                        },
                        overflow: {
                            lastSmallCount: 0,
                            lastBigCount: 1
                        },
                        contact: {
                            lastCount: 8,
                            lastOverflowCount: 1
                        },
                        events: {
                            lastAppliedCount: 6,
                            lastDeathCount: 2,
                            lastAppliedOverflowCount: 2,
                            lastDeathOverflowCount: 3,
                            lastSubmittedTick: 40,
                            completedThroughTick: 39
                        }
                    }
                }
            };
        },
        getRegistry() {
            return {
                getActiveCount(kindId) {
                    if (kindId === 'enemy') return 19;
                    if (kindId === 'projectile') return 4;
                    if (kindId === 'benchmark-player-proxy') return 1;
                    return 24;
                }
            };
        }
    };
    return {
        sceneHandler,
        options,
        calls,
        fixedUpdate() {
            calls.fixedUpdate++;
        },
        update(updateOptions) {
            calls.update.push(updateOptions);
        },
        draw() {
            calls.draw++;
        },
        drawEnemySimulation() {
            calls.drawEnemySimulation++;
            return true;
        },
        resize() {
            calls.resize++;
        },
        synchronizePresentation() {
            calls.synchronizePresentation++;
        },
        destroy() {
            calls.destroy++;
        },
        getGameSystem() {
            return gameSystem;
        },
        getNextGpuLifecycleFixedTick() {
            return gameSystem.getNextGpuLifecycleFixedTick();
        },
        getGpuSimulationEndpoint() {
            return endpoint;
        },
        getEnemyRecoveryStatus() {
            return { restartCount: 3 };
        }
    };
}

function getButton(scene, id) {
    return Array.from(scene.buttons).find((button) => button.id === id);
}

function getButtonIds(scene) {
    return Array.from(scene.buttons, (button) => button.id);
}

function assertNoChildLifecycleCalls(child) {
    assert.equal(child.calls.fixedUpdate, 0);
    assert.equal(child.calls.update.length, 0);
    assert.equal(child.calls.draw, 0);
    assert.equal(child.calls.drawEnemySimulation, 0);
    assert.equal(child.calls.resize, 0);
    assert.equal(child.calls.synchronizePresentation, 0);
}

test('GPU-only benchmark는 기능 명령을 GPU 적과 CPU 보조 월드에 적용하고 lifecycle을 한 번씩 실행한다', async () => {
    const harness = await createBenchmarkHarness();
    const sceneHandler = { id: 'scene-handler' };
    const gameDependencies = {
        webGpuPlatformPort: {
            getState: () => ({ ready: true, status: 'ready' })
        },
        gameplayStatusRenderPort: {
            createSession() {
                throw new Error('benchmark child는 production status HUD를 받으면 안 됩니다.');
            }
        }
    };
    const children = [];
    const scene = new harness.BenchmarkScene(sceneHandler, {
        dependencies: gameDependencies,
        gameSceneFactory(handler, options) {
            const child = createGpuChild(handler, options);
            children.push(child);
            return child;
        }
    });

    assert.equal(scene.getRuntimeMode(), harness.BENCHMARK_SCENE_RUNTIME_MODES.GPU_ONLY);
    assert.equal(scene.enemyPresentationProfile, PRESENTATION_PROFILES.REFERENCE_CLOCK_EXTRAPOLATION);
    assert.equal(children.length, 1);
    assert.strictEqual(children[0].sceneHandler, sceneHandler);
    assert.notStrictEqual(
        children[0].options.dependencies,
        gameDependencies,
        '자식 GameScene은 CPU 보조 월드를 지우지 않는 격리 dependency를 받아야 합니다.'
    );
    assert.strictEqual(
        children[0].options.dependencies.webGpuPlatformPort,
        gameDependencies.webGpuPlatformPort
    );
    assert.equal(
        'gameplayStatusRenderPort' in children[0].options.dependencies,
        false,
        'benchmark child dependency에는 production status HUD port가 없어야 합니다.'
    );
    assert.equal(
        typeof gameDependencies.gameplayStatusRenderPort.createSession,
        'function',
        'benchmark adapter는 원본 dependency bundle을 변형하면 안 됩니다.'
    );
    assert.equal(
        typeof children[0].options.dependencies.legacyWorldPort?.clear,
        'function'
    );
    assert.equal(children[0].options.enemyWaveEnabled, false);
    assert.equal(children[0].options.enemyRecoveryEnabled, false);
    assert.equal(children[0].options.initialCameraZoom, 1);
    assert.strictEqual(
        children[0].options.tileNavigationSource,
        harness.trace.navigationSources[0]
    );
    assert.equal(
        children[0].options.dependencies.inputActionSource.isPressed('move-left'),
        false
    );
    assert.deepEqual(
        { ...children[0].options.dependencies.inputActionSource.getPointerPosition({}) },
        { x: 0, y: 0 }
    );
    assert.equal(
        children[0].options.dependencies.inputActionSource.isPrimaryPointerPressed(),
        false
    );
    assert.deepEqual(
        { ...children[0].options.dependencies.inputActionSource.getWheelTotals({}) },
        { x: 0, y: 0 }
    );
    assert.equal(
        children[0].options.enemyPresentationProfile,
        PRESENTATION_PROFILES.REFERENCE_CLOCK_EXTRAPOLATION
    );
    assert.equal(harness.trace.requestedGpuPlayerProxies.length, 1);
    assert.strictEqual(
        harness.trace.requestedGpuPlayerProxies[0].gameScene,
        children[0]
    );
    assert.equal(
        harness.trace.requestedGpuPlayerProxies[0].sessionGeneration,
        1
    );
    assert.deepEqual(
        { ...harness.trace.requestedGpuPlayerProxies[0].result },
        {
            accepted: true,
            requestedCount: 1,
            queuedCount: 1,
            targetFixedTick: 42,
            reason: 'queued'
        }
    );
    assert.equal(harness.trace.buildResetCount, 1);
    assert.equal(
        harness.trace.appliedCommandBatches[0].commands[0].type,
        COMMAND_TYPES.REPLACE_AUXILIARY_WORLD
    );
    assert.ok(scene.player, 'constructor가 CPU 보조 player를 만들어야 합니다.');
    assert.equal(scene.staticWalls.length, 2);
    assert.equal(scene.boxWalls.length, 2);
    assert.equal(typeof scene.activateLegacyCpuBenchmark, 'undefined');
    assert.equal(getButtonIds(scene).includes('activateLegacyCpu'), false);
    assert.match(getButton(scene, 'referenceClock').label, /^● /);
    assert.deepEqual(harness.trace.profilerStates, [true]);

    assert.equal(getButton(scene, 'spawnEnemy100').onClick(), true);
    assert.equal(getButton(scene, 'spawnBox').onClick(), true);
    assert.equal(getButton(scene, 'spawnProjectile10').onClick(), true);
    assert.deepEqual(harness.trace.buildSpawnGpuEnemyCounts, [100]);
    assert.equal(harness.trace.buildSpawnBoxCount, 1);
    assert.deepEqual(harness.trace.buildSpawnGpuProjectileCounts, [10]);
    assert.equal(harness.trace.enqueuedCommands.length, 3);
    assert.deepEqual(
        harness.trace.enqueuedCommands.map((command) => command.type),
        [
            COMMAND_TYPES.SPAWN_GPU_ENEMY_BATCH,
            COMMAND_TYPES.APPEND_BOX_WALLS,
            COMMAND_TYPES.SPAWN_GPU_PROJECTILE_BATCH
        ]
    );
    assert.equal(harness.trace.requestedGpuBatches.length, 0);
    assert.equal(harness.trace.requestedGpuProjectileBatches.length, 0);
    assertNoChildLifecycleCalls(children[0]);

    scene.applySimulationCommands(harness.trace.enqueuedCommands);
    assert.equal(harness.trace.requestedGpuBatches.length, 1);
    assert.strictEqual(
        harness.trace.requestedGpuBatches[0].gameScene,
        children[0]
    );
    assert.equal(harness.trace.requestedGpuBatches[0].count, 100);
    assert.equal(harness.trace.requestedGpuBatches[0].sessionGeneration, 1);
    assert.equal(harness.trace.requestedGpuBatches[0].batchSequence, 0);
    assert.equal(harness.trace.requestedGpuBatches[0].spawnSequence, 0);
    assert.equal(harness.trace.requestedGpuProjectileBatches.length, 1);
    assert.strictEqual(
        harness.trace.requestedGpuProjectileBatches[0].gameScene,
        children[0]
    );
    assert.equal(harness.trace.requestedGpuProjectileBatches[0].count, 10);
    assert.equal(
        harness.trace.requestedGpuProjectileBatches[0].sessionGeneration,
        1
    );
    assert.equal(harness.trace.requestedGpuProjectileBatches[0].batchSequence, 0);
    assert.equal(harness.trace.requestedGpuProjectileBatches[0].spawnSequence, 0);
    assert.equal(scene.boxWalls.length, 3);
    assert.equal(scene.projectiles.length, 0);
    assertNoChildLifecycleCalls(children[0]);

    const status = scene.getGpuVisualQaStatus();
    assert.equal(status.runtimeMode, harness.BENCHMARK_SCENE_RUNTIME_MODES.GPU_ONLY);
    assert.equal(status.presentationProfile, PRESENTATION_PROFILES.REFERENCE_CLOCK_EXTRAPOLATION);
    assert.equal(status.predictionDelta, 0.008);
    assert.equal(status.interpolationAlpha, 0.5);
    assert.equal(status.activeCount, 24);
    assert.equal(status.enemyActiveCount, 19);
    assert.equal(status.projectileActiveCount, 4);
    assert.equal(status.playerProxyActiveCount, 1);
    assert.equal(status.reservedCount, 2);
    assert.equal(status.pendingCommandCount, 4);
    assert.equal(status.totalQueuedEnemySpawnCount, 100);
    assert.equal(status.totalQueuedProjectileSpawnCount, 10);
    assert.equal(status.totalQueuedSpawnCount, 110);
    assert.equal(status.projectileCount, 0);
    assert.equal(status.cpuProjectileCount, 0);
    assert.equal(status.boxCount, 3);
    assert.equal(status.lastSpawnBatchReason, 'queued');
    assert.equal(status.lastEnemySpawnBatchReason, 'queued');
    assert.equal(status.lastProjectileSpawnBatchReason, 'queued');
    assert.equal(status.lastPlayerProxyReason, 'queued');
    assert.equal(status.gpuContactCount, 8);
    assert.equal(status.gpuAppliedEventCount, 6);
    assert.equal(status.gpuDeathEventCount, 2);
    assert.equal(status.gpuContactOverflowCount, 1);
    assert.equal(status.gpuAppliedEventOverflowCount, 2);
    assert.equal(status.gpuDeathEventOverflowCount, 3);
    assert.equal(status.gpuEventSubmittedTickWatermark, 40);
    assert.equal(status.gpuEventCompletedTickWatermark, 39);

    const updateOptions = { frameId: 7 };
    scene.fixedUpdate();
    scene.update(updateOptions);
    scene.draw();
    scene.resize();
    scene.synchronizePresentation();
    assert.equal(children[0].calls.fixedUpdate, 1);
    assert.deepEqual(children[0].calls.update, [updateOptions]);
    assert.equal(children[0].calls.draw, 0, 'Level 1 전체 draw를 호출하면 안 됩니다.');
    assert.equal(children[0].calls.drawEnemySimulation, 1);
    assert.equal(children[0].calls.resize, 1);
    assert.equal(children[0].calls.synchronizePresentation, 1);
    assert.equal(harness.trace.projectileCullCount, 1);
    assert.equal(harness.trace.collisionSyncCount, 1);
    assert.equal(harness.trace.buttonUpdateCount, 1);
    assert.equal(harness.trace.auxiliaryWorldDraws.length, 1);
    assert.equal(harness.trace.buttonDraws.length, 1);
    assert.equal(harness.trace.gpuHudDraws.length, 1);
    assert.equal(harness.trace.gpuHudDraws[0].status.cpuCollisionCheckCount, 17);
    assert.equal(harness.trace.buildResetCount, 2, 'resize는 CPU 보조 월드만 재설정해야 합니다.');
    assert.equal(children.length, 1, 'resize가 GPU session을 재생성하면 안 됩니다.');
    assert.equal(
        harness.trace.requestedGpuPlayerProxies.length,
        1,
        'resize는 현재 GPU session에 player proxy를 중복 예약하면 안 됩니다.'
    );
    assert.ok(getButton(scene, 'spawnEnemy100'));

    scene.destroy();
    assert.equal(children[0].calls.destroy, 1);
    assert.equal(harness.trace.requestedGpuPlayerProxies.length, 1);
    assert.deepEqual(harness.trace.profilerStates, [true, false]);
});

test('profile 전환은 GPU child와 보조 월드를 재설정하고 CPU fallback 없이 버튼을 유지한다', async () => {
    const harness = await createBenchmarkHarness();
    const children = [];
    const scene = new harness.BenchmarkScene({}, {
        dependencies: {
            webGpuPlatformPort: {
                getState: () => ({ ready: true, status: 'ready' })
            },
            gameplayStatusRenderPort: {
                createSession() {
                    throw new Error(
                        'restart child는 production status HUD를 받으면 안 됩니다.'
                    );
                }
            }
        },
        gameSceneFactory(handler, options) {
            const child = createGpuChild(handler, options);
            children.push(child);
            return child;
        }
    });
    assert.equal(harness.trace.requestedGpuPlayerProxies.length, 1);
    assert.strictEqual(
        harness.trace.requestedGpuPlayerProxies[0].gameScene,
        children[0]
    );
    assert.equal(
        harness.trace.requestedGpuPlayerProxies[0].sessionGeneration,
        1
    );

    scene.spawnGpuEnemyBatch(7);
    scene.spawnGpuProjectileBatch(2);
    assert.equal(scene.getGpuVisualQaStatus().totalQueuedSpawnCount, 9);
    assert.equal(
        scene.getGpuVisualQaStatus().totalQueuedProjectileSpawnCount,
        2
    );
    const firstChild = children[0];
    assert.equal(
        scene.setGpuPresentationProfile(PRESENTATION_PROFILES.STRICT_INTERPOLATION),
        true
    );
    assert.equal(firstChild.calls.destroy, 1);
    assert.equal(children.length, 2);
    assert.equal(harness.trace.requestedGpuPlayerProxies.length, 2);
    assert.strictEqual(
        harness.trace.requestedGpuPlayerProxies[1].gameScene,
        children[1]
    );
    assert.equal(
        harness.trace.requestedGpuPlayerProxies[1].sessionGeneration,
        2
    );
    assert.equal(
        harness.trace.requestedGpuPlayerProxies[1].result.targetFixedTick,
        42
    );
    assert.equal(children[1].options.enemyWaveEnabled, false);
    assert.equal(children[1].options.enemyRecoveryEnabled, false);
    assert.equal(children[1].options.initialCameraZoom, 1);
    assert.equal(
        'gameplayStatusRenderPort' in children[1].options.dependencies,
        false
    );
    assert.notStrictEqual(
        children[1].options.tileNavigationSource,
        firstChild.options.tileNavigationSource,
        '재시작한 GPU session은 새 benchmark navigation source를 받아야 합니다.'
    );
    assert.equal(
        children[1].options.enemyPresentationProfile,
        PRESENTATION_PROFILES.STRICT_INTERPOLATION
    );
    assert.equal(scene.getRuntimeMode(), harness.BENCHMARK_SCENE_RUNTIME_MODES.GPU_ONLY);
    assert.equal(harness.trace.buildResetCount, 2);
    assert.equal(scene.getGpuVisualQaStatus().totalQueuedSpawnCount, 0);
    assert.equal(scene.getGpuVisualQaStatus().lastSpawnBatchReason, 'session-reset');
    assert.equal(
        scene.getGpuVisualQaStatus().lastProjectileSpawnBatchReason,
        'session-reset'
    );
    assert.equal(scene.getGpuVisualQaStatus().playerProxyActiveCount, 1);
    assert.equal(scene.getGpuVisualQaStatus().lastPlayerProxyReason, 'queued');
    assert.ok(getButton(scene, 'spawnEnemy100'));
    assert.ok(getButton(scene, 'spawnBox'));
    assert.ok(getButton(scene, 'spawnProjectile10'));
    assert.match(getButton(scene, 'strictInterpolation').label, /^● /);
    assert.doesNotMatch(getButton(scene, 'referenceClock').label, /^● /);
    assert.equal(typeof scene.activateLegacyCpuBenchmark, 'undefined');

    scene.spawnGpuEnemyBatch(3);
    scene.spawnGpuProjectileBatch(4);
    assert.equal(harness.trace.requestedGpuBatches.length, 2);
    assert.equal(harness.trace.requestedGpuBatches[1].sessionGeneration, 2);
    assert.equal(harness.trace.requestedGpuBatches[1].batchSequence, 0);
    assert.equal(harness.trace.requestedGpuBatches[1].spawnSequence, 0);
    assert.equal(harness.trace.requestedGpuProjectileBatches.length, 2);
    assert.equal(
        harness.trace.requestedGpuProjectileBatches[1].sessionGeneration,
        2
    );
    assert.equal(
        harness.trace.requestedGpuProjectileBatches[1].batchSequence,
        0
    );
    assert.equal(
        harness.trace.requestedGpuProjectileBatches[1].spawnSequence,
        0
    );
    assert.equal(scene.getGpuVisualQaStatus().totalQueuedSpawnCount, 7);

    assert.throws(
        () => scene.setGpuPresentationProfile('invalid-profile'),
        /지원하지 않는 GPU presentation profile/
    );
    assert.equal(children.length, 2, 'invalid profile은 새 child를 만들면 안 됩니다.');
    assert.equal(children[1].calls.destroy, 0, 'invalid profile은 현재 child를 파괴하면 안 됩니다.');
    assert.equal(harness.trace.buildResetCount, 2);
    assert.equal(harness.trace.requestedGpuPlayerProxies.length, 2);

    const appliedBeforeDestroy = harness.trace.appliedCommandBatches.length;
    scene.destroy();
    scene.destroy();
    assert.equal(firstChild.calls.destroy, 1);
    assert.equal(children[1].calls.destroy, 1);
    assert.equal(
        harness.trace.appliedCommandBatches.length,
        appliedBeforeDestroy + 1,
        '보조 월드 destroy command는 한 번만 적용해야 합니다.'
    );
    assert.equal(
        harness.trace.appliedCommandBatches.at(-1).commands[0].type,
        COMMAND_TYPES.DESTROY_AUXILIARY_WORLD
    );
    assert.equal(scene.player, null);
    assert.equal(scene.projectiles.length, 0);
    assert.equal(scene.staticWalls.length, 0);
    assert.equal(scene.boxWalls.length, 0);
    assert.equal(scene.buttons.length, 0);
    assert.deepEqual(harness.trace.profilerStates, [true, false]);

    scene.applySimulationCommands([{
        type: COMMAND_TYPES.SPAWN_GPU_ENEMY_BATCH,
        count: 100
    }]);
    assert.equal(harness.trace.appliedCommandBatches.length, appliedBeforeDestroy + 1);
    assert.equal(scene.spawnGpuEnemyBatch(100).reason, 'scene-destroyed');
    assert.equal(scene.spawnGpuProjectileBatch(10).reason, 'scene-destroyed');
    assert.equal(scene.restartGpuVisualQa(), false);
    assert.equal(harness.trace.requestedGpuBatches.length, 2);
    assert.equal(harness.trace.requestedGpuProjectileBatches.length, 2);
    assert.equal(harness.trace.requestedGpuPlayerProxies.length, 2);
});

test('invalid 초기 profile은 child·보조 월드·profiler를 만들기 전에 거부한다', async () => {
    const harness = await createBenchmarkHarness();
    let childCreateCount = 0;
    assert.throws(
        () => new harness.BenchmarkScene({}, {
            dependencies: {},
            gameSceneFactory() {
                childCreateCount++;
                return createGpuChild({}, {});
            },
            enemyPresentationProfile: 'invalid-profile'
        }),
        /지원하지 않는 GPU presentation profile/
    );
    assert.equal(childCreateCount, 0);
    assert.equal(harness.trace.buildResetCount, 0);
    assert.equal(harness.trace.appliedCommandBatches.length, 0);
    assert.equal(harness.trace.requestedGpuPlayerProxies.length, 0);
    assert.deepEqual(harness.trace.profilerStates, []);
    assert.doesNotMatch(BENCHMARK_SCENE_SOURCE, /activateLegacyCpuBenchmark/);
});
