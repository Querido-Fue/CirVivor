import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { loadGameModule } from './support/source_module_loader.mjs';

const { BaseScene } = await loadGameModule('scene/_base_scene.js');
const { GameSystem } = await loadGameModule('ingame/game_system.js');
const { GPU_BODY_PRESENTATION_PROFILE } = await loadGameModule(
    'ingame/physics/gpu/gpu_body_presentation_clock.js'
);
const gameSceneSource = await readFile(
    new URL('../script/module/scene/game/_game_scene.js', import.meta.url),
    'utf8'
);
const gameSceneContext = vm.createContext({});
const gameSceneModule = new vm.SourceTextModule(gameSceneSource, {
    context: gameSceneContext,
    identifier: '_game_scene.js'
});
await gameSceneModule.link(async (specifier) => {
    const exportsBySpecifier = {
        'scene/_base_scene.js': { BaseScene },
        'ingame/game_system.js': { GameSystem },
        './game_scene_dependency_factory.js': {
            createGameSceneDependencies() {
                throw new Error('테스트는 명시적 GameScene dependencies를 사용해야 합니다.');
            }
        }
    };
    const exports = exportsBySpecifier[specifier];
    if (!exports) {
        throw new Error(`예상하지 못한 GameScene import입니다: ${specifier}`);
    }
    const exportNames = Object.keys(exports);
    return new vm.SyntheticModule(exportNames, function setExports() {
        for (const exportName of exportNames) {
            this.setExport(exportName, exports[exportName]);
        }
    }, { context: gameSceneContext });
});
await gameSceneModule.evaluate();
const { GameScene } = gameSceneModule.namespace;

async function loadGameSceneWithGameSystem(GameSystemClass) {
    const context = vm.createContext({});
    const module = new vm.SourceTextModule(gameSceneSource, {
        context,
        identifier: '_game_scene.presentation_profile.js'
    });
    const modules = new Map([
        ['scene/_base_scene.js', new vm.SyntheticModule(
            ['BaseScene'],
            function initializeBaseScene() {
                this.setExport('BaseScene', BaseScene);
            },
            { context }
        )],
        ['ingame/game_system.js', new vm.SyntheticModule(
            ['GameSystem'],
            function initializeGameSystem() {
                this.setExport('GameSystem', GameSystemClass);
            },
            { context }
        )],
        ['./game_scene_dependency_factory.js', new vm.SyntheticModule(
            ['createGameSceneDependencies'],
            function initializeDependencyFactory() {
                this.setExport('createGameSceneDependencies', () => {
                    throw new Error('테스트는 명시적 GameScene dependencies를 사용해야 합니다.');
                });
            },
            { context }
        )]
    ]);
    await module.link((specifier) => {
        const dependency = modules.get(specifier);
        if (!dependency) {
            throw new Error(`예상하지 못한 GameScene import입니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();
    return module.namespace.GameScene;
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

class RecoveryBackend {
    constructor(mode) {
        this.mode = mode;
        this.bodies = new Map();
        this.runtimeState = 'gpu-ready';
        this.recovering = false;
        this.hardFailNextFixed = false;
        this.initCount = 0;
        this.destroyCount = 0;
        this.trackedHandle = null;
    }

    getCapacity() {
        return 64;
    }

    init() {
        this.initCount++;
        if (this.mode === 'init-throws') {
            throw new Error('replacement backend init failure');
        }
        return true;
    }

    spawnBodies(bodies) {
        const handles = bodies.map((body) => {
            const handle = Object.freeze({
                entityId: body.entityId,
                incarnation: body.incarnation
            });
            this.bodies.set(handleKey(handle), body);
            return handle;
        });
        if (this.mode === 'fail-first-spawn') {
            this.recovering = true;
            this.runtimeState = 'gpu-requires-rebuild';
        }
        return {
            accepted: bodies.length,
            rejected: 0,
            handles,
            requiresRecovery: this.recovering
        };
    }

    despawnBodies(handles) {
        let removed = 0;
        for (const handle of handles) {
            removed += this.bodies.delete(handleKey(handle)) ? 1 : 0;
        }
        return { removed, rejected: handles.length - removed };
    }

    hasBody(handle) {
        return this.bodies.has(handleKey(handle));
    }

    hasActiveBodies() {
        return this.bodies.size > 0;
    }

    canControlBody(handle) {
        return this.hasBody(handle);
    }

    stageFixedPrograms(plan) {
        const controls = Array.isArray(plan?.controls) ? plan.controls : [];
        const sourceRelativeSpawns = Array.isArray(plan?.sourceRelativeSpawns)
            ? plan.sourceRelativeSpawns
            : [];
        const requested = controls.length + sourceRelativeSpawns.length;
        if (this.recovering) {
            return {
                accepted: 0,
                rejected: requested,
                requiresRecovery: true,
                reason: 'gpu-requires-rebuild'
            };
        }
        const hasStaleHandle = controls.some((control) => (
            !this.canControlBody(control)
        )) || sourceRelativeSpawns.some((spawn) => (
            !this.hasBody(spawn.sourceHandle)
        ));
        if (hasStaleHandle) {
            return {
                accepted: 0,
                rejected: requested,
                requiresRecovery: false,
                reason: 'stale-source'
            };
        }
        return {
            accepted: requested,
            rejected: 0,
            requiresRecovery: false
        };
    }

    configureTrackedBody(handle = null) {
        if (handle === null) {
            this.trackedHandle = null;
            return { accepted: true, tracked: false };
        }
        if (!this.hasBody(handle)) {
            return { accepted: false, reason: 'stale-handle' };
        }
        this.trackedHandle = Object.freeze({
            entityId: handle.entityId,
            incarnation: handle.incarnation
        });
        return { accepted: true, tracked: true };
    }

    fixedUpdate() {
        if (this.hardFailNextFixed) {
            this.hardFailNextFixed = false;
            this.recovering = true;
            this.runtimeState = 'gpu-requires-rebuild';
            return false;
        }
        return this.bodies.size > 0;
    }

    updatePresentation() {}

    synchronizePresentation() {}

    draw() {
        return this.bodies.size > 0;
    }

    getRuntimeState() {
        return this.runtimeState;
    }

    requiresRecovery() {
        return this.recovering;
    }

    destroy() {
        if (this.destroyCount > 0) {
            return;
        }
        this.destroyCount++;
        this.bodies.clear();
        this.trackedHandle = null;
        this.runtimeState = 'destroyed';
    }
}

function createAnimationHandle() {
    let active = true;
    return {
        id: 1,
        promise: Promise.resolve(),
        retarget() {
            return active;
        },
        remove() {
            active = false;
        },
        isActive() {
            return active;
        }
    };
}

test('hard GPU failure는 wave session을 한 번 재시작하고 성공 전 무한 restart를 막는다', () => {
    const backends = [];
    const backendModes = ['fail-first-spawn', 'normal', 'fail-first-spawn'];
    let legacyClearCount = 0;
    const dependencies = {
        inputActionSource: {
            isPressed() {
                return false;
            },
            getWheelTotals(out) {
                out.x = 0;
                out.y = 0;
                return out;
            }
        },
        animationPort: {
            animate() {
                return createAnimationHandle();
            }
        },
        timePort: {
            getDelta: () => 1 / 120,
            getFixedDelta: () => 1 / 60,
            getFixedInterpolationAlpha: () => 0.5
        },
        viewportPort: {
            getSnapshot(out) {
                out.ww = 1920;
                out.wh = 1080;
                return out;
            }
        },
        worldRenderPort: {
            drawCircle() {},
            drawSquareInstances() {}
        },
        webGpuPlatformPort: {
            getState() {
                return { ready: true, deviceGeneration: 1 };
            }
        },
        enemySimulationBackendFactory() {
            const backend = new RecoveryBackend(
                backendModes[backends.length] ?? 'fail-first-spawn'
            );
            backends.push(backend);
            return backend;
        },
        legacyWorldPort: {
            clear() {
                legacyClearCount++;
            }
        }
    };
    const scene = new GameScene({}, { dependencies });

    const initialGameSystem = scene.getGameSystem();
    const initialObjectSystem = initialGameSystem.getObjectSystem();
    const initialCoreIntegrity = initialGameSystem.getCoreIntegrity();
    const initialCorePresentation = initialObjectSystem.getCore();
    const initialInputRouter = initialGameSystem.playerControlRouter;
    const initialInputMapper = initialGameSystem.inputActionMapper;
    const initialCameraController = initialGameSystem.getCameraZoomController();
    const initialTowerFacade = initialObjectSystem.getTower();
    const initialEndpoint = initialObjectSystem.getGpuSimulationEndpoint();
    const initialRegistry = initialObjectSystem.getWorldRegistry();
    const initialSessionGeneration = initialEndpoint.getStatus().sessionGeneration;
    const maxIntegrity = initialCoreIntegrity.getMaxIntegrity();
    const appliedDamage = initialCoreIntegrity.applyIntegrityDamage(37);
    const damagedIntegrity = initialCoreIntegrity.getCurrentIntegrity();

    assert.ok(appliedDamage > 0);
    assert.equal(damagedIntegrity, maxIntegrity - appliedDamage);
    assert.strictEqual(
        initialCorePresentation.getCoreIntegrity(),
        initialCoreIntegrity
    );
    assert.equal(legacyClearCount, 1);

    assert.equal(scene.getNextGpuLifecycleFixedTick(), 1);
    assert.equal(scene.getNextEnemyLifecycleFixedTick(), 1);

    scene.fixedUpdate();
    const firstReplacementEndpoint = initialObjectSystem.getGpuSimulationEndpoint();
    const firstReplacementRegistry = initialObjectSystem.getWorldRegistry();

    assert.equal(backends.length, 2);
    assert.equal(backends[0].destroyCount, 1);
    assert.strictEqual(scene.getGameSystem(), initialGameSystem);
    assert.strictEqual(initialGameSystem.getObjectSystem(), initialObjectSystem);
    assert.strictEqual(initialGameSystem.getCoreIntegrity(), initialCoreIntegrity);
    assert.strictEqual(initialObjectSystem.getCore(), initialCorePresentation);
    assert.strictEqual(initialObjectSystem.getTower(), initialTowerFacade);
    assert.strictEqual(initialGameSystem.playerControlRouter, initialInputRouter);
    assert.strictEqual(initialGameSystem.inputActionMapper, initialInputMapper);
    assert.strictEqual(
        initialGameSystem.getCameraZoomController(),
        initialCameraController
    );
    assert.notStrictEqual(firstReplacementEndpoint, initialEndpoint);
    assert.notStrictEqual(firstReplacementRegistry, initialRegistry);
    assert.ok(
        firstReplacementEndpoint.getStatus().sessionGeneration
            > initialSessionGeneration
    );
    assert.equal(initialEndpoint.getStatus().destroyed, true);
    assert.equal(scene.getEnemyRecoveryStatus().restartCount, 1);
    assert.equal(scene.getEnemyRecoveryStatus().restartGeneration, 1);
    assert.equal(initialGameSystem.getFixedTick(), 0);
    assert.equal(firstReplacementRegistry.getActiveCount(), 0);
    assert.equal(
        initialObjectSystem.getGpuWorldActorStatus().spawnTargetFixedTick,
        1
    );
    assert.equal(initialCoreIntegrity.getCurrentIntegrity(), damagedIntegrity);
    assert.equal(initialCoreIntegrity.getMaxIntegrity(), maxIntegrity);
    assert.equal(legacyClearCount, 1);

    scene.fixedUpdate();
    assert.equal(initialGameSystem.getFixedTick(), 1);
    assert.equal(scene.getNextGpuLifecycleFixedTick(), 2);
    assert.equal(firstReplacementRegistry.getActiveCount(), 3);
    assert.equal(firstReplacementRegistry.getActiveCount('enemy'), 1);
    assert.equal(firstReplacementRegistry.getActiveCount('tower'), 1);
    assert.equal(firstReplacementRegistry.getActiveCount('core-proxy'), 1);
    assert.ok(initialObjectSystem.getGpuWorldActorStatus().towerHandle);
    assert.ok(initialObjectSystem.getGpuWorldActorStatus().coreProxyHandle);
    assert.equal(scene.getEnemyRecoveryStatus().restartGeneration, null);
    assert.equal(initialCoreIntegrity.getCurrentIntegrity(), damagedIntegrity);
    assert.equal(legacyClearCount, 1);

    backends[1].hardFailNextFixed = true;
    scene.fixedUpdate();
    const secondReplacementEndpoint = initialObjectSystem.getGpuSimulationEndpoint();
    const secondReplacementRegistry = initialObjectSystem.getWorldRegistry();

    assert.equal(backends.length, 3);
    assert.equal(backends[1].destroyCount, 1);
    assert.strictEqual(scene.getGameSystem(), initialGameSystem);
    assert.strictEqual(initialGameSystem.getObjectSystem(), initialObjectSystem);
    assert.strictEqual(initialGameSystem.getCoreIntegrity(), initialCoreIntegrity);
    assert.strictEqual(initialObjectSystem.getCore(), initialCorePresentation);
    assert.strictEqual(initialObjectSystem.getTower(), initialTowerFacade);
    assert.strictEqual(initialGameSystem.playerControlRouter, initialInputRouter);
    assert.strictEqual(
        initialGameSystem.getCameraZoomController(),
        initialCameraController
    );
    assert.notStrictEqual(secondReplacementEndpoint, firstReplacementEndpoint);
    assert.notStrictEqual(secondReplacementRegistry, firstReplacementRegistry);
    assert.ok(
        secondReplacementEndpoint.getStatus().sessionGeneration
            > firstReplacementEndpoint.getStatus().sessionGeneration
    );
    assert.equal(firstReplacementEndpoint.getStatus().destroyed, true);
    assert.equal(scene.getEnemyRecoveryStatus().restartCount, 2);
    assert.equal(initialGameSystem.getFixedTick(), 1);
    assert.equal(secondReplacementRegistry.getActiveCount(), 0);
    assert.equal(
        initialObjectSystem.getGpuWorldActorStatus().spawnTargetFixedTick,
        2
    );
    assert.equal(initialCoreIntegrity.getCurrentIntegrity(), damagedIntegrity);
    assert.equal(legacyClearCount, 1);

    scene.fixedUpdate();
    assert.equal(backends.length, 3);
    assert.equal(initialGameSystem.getFixedTick(), 1);
    assert.equal(scene.getEnemyRecoveryStatus().restartCount, 2);
    assert.equal(scene.getEnemyRecoveryStatus().restartGeneration, 1);
    assert.strictEqual(
        initialObjectSystem.getGpuSimulationEndpoint(),
        secondReplacementEndpoint
    );
    assert.equal(initialCoreIntegrity.getCurrentIntegrity(), damagedIntegrity);
    assert.equal(legacyClearCount, 1);

    scene.destroy();
    scene.destroy();
    assert.equal(backends[2].destroyCount, 1);
    assert.equal(legacyClearCount, 2);
});

test('replacement init 예외는 기존 GPU world와 CPU domain을 원자적으로 보존한다', () => {
    const backends = [];
    const backendModes = ['normal', 'init-throws'];
    const dependencies = {
        inputActionSource: {
            isPressed() {
                return false;
            },
            getWheelTotals(out) {
                out.x = 0;
                out.y = 0;
                return out;
            }
        },
        animationPort: {
            animate() {
                return createAnimationHandle();
            }
        },
        timePort: {
            getDelta: () => 1 / 120,
            getFixedDelta: () => 1 / 60,
            getFixedInterpolationAlpha: () => 0.5
        },
        viewportPort: {
            getSnapshot(out) {
                out.ww = 1920;
                out.wh = 1080;
                return out;
            }
        },
        worldRenderPort: {
            drawCircle() {},
            drawSquareInstances() {}
        },
        webGpuPlatformPort: {
            getState() {
                return { ready: true, deviceGeneration: 1 };
            }
        },
        enemySimulationBackendFactory() {
            const backend = new RecoveryBackend(
                backendModes[backends.length] ?? 'init-throws'
            );
            backends.push(backend);
            return backend;
        }
    };
    const gameSystem = new GameSystem(dependencies);
    assert.equal(gameSystem.enter(), true);
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 1);

    const objectSystem = gameSystem.getObjectSystem();
    const coreIntegrity = gameSystem.getCoreIntegrity();
    const corePresentation = objectSystem.getCore();
    const towerFacade = objectSystem.getTower();
    const inputRouter = gameSystem.playerControlRouter;
    const inputMapper = gameSystem.inputActionMapper;
    const cameraController = gameSystem.getCameraZoomController();
    const endpoint = objectSystem.getGpuSimulationEndpoint();
    const registry = objectSystem.getWorldRegistry();
    const backend = objectSystem.getEnemySimulationBackend();
    const waveDirector = objectSystem.waveDirector;
    const sessionGeneration = endpoint.getStatus().sessionGeneration;
    const actorStatus = objectSystem.getGpuWorldActorStatus();
    const towerHandle = actorStatus.towerHandle;
    const coreProxyHandle = actorStatus.coreProxyHandle;
    const maxIntegrity = coreIntegrity.getMaxIntegrity();
    coreIntegrity.applyIntegrityDamage(37);
    const damagedIntegrity = coreIntegrity.getCurrentIntegrity();

    assert.equal(backends.length, 1);
    assert.strictEqual(backend, backends[0]);
    assert.equal(backend.initCount, 1);
    assert.equal(backend.destroyCount, 0);
    assert.ok(towerHandle);
    assert.ok(coreProxyHandle);
    assert.equal(registry.getActiveCount(), 3);
    assert.equal(damagedIntegrity < maxIntegrity, true);

    backend.hardFailNextFixed = true;
    assert.equal(gameSystem.fixedUpdate(), false);
    assert.equal(gameSystem.getFixedTick(), 1);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), true);
    const nextLifecycleTickBeforeRestart = gameSystem.getNextGpuLifecycleFixedTick();

    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);
    assert.equal(backends.length, 2);
    assert.equal(backends[0].destroyCount, 0);
    assert.equal(backends[1].initCount, 1);
    assert.equal(backends[1].destroyCount, 1);
    assert.strictEqual(gameSystem.getObjectSystem(), objectSystem);
    assert.strictEqual(gameSystem.getCoreIntegrity(), coreIntegrity);
    assert.strictEqual(objectSystem.getCore(), corePresentation);
    assert.strictEqual(objectSystem.getTower(), towerFacade);
    assert.strictEqual(gameSystem.playerControlRouter, inputRouter);
    assert.strictEqual(gameSystem.inputActionMapper, inputMapper);
    assert.strictEqual(gameSystem.getCameraZoomController(), cameraController);
    assert.strictEqual(objectSystem.getGpuSimulationEndpoint(), endpoint);
    assert.strictEqual(objectSystem.getWorldRegistry(), registry);
    assert.strictEqual(objectSystem.getEnemySimulationBackend(), backend);
    assert.strictEqual(objectSystem.waveDirector, waveDirector);
    assert.equal(endpoint.getStatus().sessionGeneration, sessionGeneration);
    assert.equal(endpoint.getStatus().destroyed, false);
    assert.equal(gameSystem.getFixedTick(), 1);
    assert.equal(
        gameSystem.getNextGpuLifecycleFixedTick(),
        nextLifecycleTickBeforeRestart
    );
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), true);
    assert.equal(registry.getActiveCount(), 3);
    assert.strictEqual(objectSystem.getGpuWorldActorStatus().towerHandle, towerHandle);
    assert.strictEqual(
        objectSystem.getGpuWorldActorStatus().coreProxyHandle,
        coreProxyHandle
    );
    assert.strictEqual(towerFacade.getStatus().bodyHandle, towerHandle);
    assert.equal(towerFacade.getStatus().sessionGeneration, sessionGeneration);
    assert.strictEqual(corePresentation.getCoreIntegrity(), coreIntegrity);
    assert.equal(coreIntegrity.getCurrentIntegrity(), damagedIntegrity);
    assert.equal(coreIntegrity.getMaxIntegrity(), maxIntegrity);

    gameSystem.destroy();
    gameSystem.destroy();
    assert.equal(backends[0].destroyCount, 1);
    assert.equal(backends[1].destroyCount, 1);
});

test('선택한 enemy presentation profile을 소유한 같은 GameSystem이 GPU world만 재시작한다', async () => {
    const instances = [];
    class CapturingGameSystem {
        constructor(dependencies, options) {
            this.dependencies = dependencies;
            this.options = options;
            this.enterCount = 0;
            this.destroyCount = 0;
            this.restartCount = 0;
            this.recoveryRequired = true;
            instances.push(this);
        }

        enter() {
            this.enterCount++;
            return true;
        }

        fixedUpdate() {
            return this.restartCount > 0;
        }

        isEnemySimulationRecoveryRequired() {
            return this.recoveryRequired;
        }

        restartGpuWorldAtSafeWaveBoundary() {
            if (!this.recoveryRequired) {
                return false;
            }
            this.restartCount++;
            this.recoveryRequired = false;
            return true;
        }

        destroy() {
            if (this.destroyCount > 0) {
                return;
            }
            this.destroyCount++;
        }
    }

    const ProfileGameScene = await loadGameSceneWithGameSystem(
        CapturingGameSystem
    );
    const profiles = Object.values(GPU_BODY_PRESENTATION_PROFILE);

    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
        const profile = profiles[profileIndex];
        const firstInstanceIndex = instances.length;
        let legacyClearCount = 0;
        const dependencies = {
            webGpuPlatformPort: {
                getState() {
                    return {
                        ready: true,
                        deviceGeneration: profileIndex + 1
                    };
                }
            },
            legacyWorldPort: {
                clear() {
                    legacyClearCount++;
                }
            }
        };
        const tileNavigationSource = Object.freeze({
            id: `injected-navigation-${profileIndex}`
        });
        const scene = new ProfileGameScene({}, {
            dependencies,
            tileNavigationSource,
            enemyPresentationProfile: profile
        });
        const initialSystem = instances[firstInstanceIndex];

        assert.strictEqual(initialSystem.dependencies, dependencies);
        assert.equal(initialSystem.options.enemyPresentationProfile, profile);
        assert.strictEqual(
            initialSystem.options.tileNavigationSource,
            tileNavigationSource
        );
        assert.equal(initialSystem.enterCount, 1);

        scene.fixedUpdate();
        assert.equal(instances.length, firstInstanceIndex + 1);
        assert.strictEqual(scene.getGameSystem(), initialSystem);
        assert.equal(initialSystem.destroyCount, 0);
        assert.equal(initialSystem.restartCount, 1);
        assert.equal(scene.getEnemyRecoveryStatus().restartCount, 1);
        assert.equal(
            scene.getEnemyRecoveryStatus().restartGeneration,
            profileIndex + 1
        );
        assert.equal(legacyClearCount, 1);

        scene.fixedUpdate();
        assert.equal(instances.length, firstInstanceIndex + 1);
        assert.equal(scene.getEnemyRecoveryStatus().restartGeneration, null);
        assert.equal(initialSystem.restartCount, 1);
        assert.equal(legacyClearCount, 1);

        scene.destroy();
        scene.destroy();
        assert.equal(initialSystem.destroyCount, 1);
        assert.equal(legacyClearCount, 2);
    }
});

test('recovery를 끈 benchmark child는 hard GPU 상태에서도 session과 적 registry를 자동 교체하지 않는다', async () => {
    const instances = [];
    class RecoveryDisabledGameSystem {
        constructor(dependencies, options) {
            this.dependencies = dependencies;
            this.options = options;
            this.fixedUpdateCount = 0;
            this.destroyCount = 0;
            instances.push(this);
        }

        enter() {
            return true;
        }

        fixedUpdate() {
            this.fixedUpdateCount++;
            return false;
        }

        isEnemySimulationRecoveryRequired() {
            return true;
        }

        destroy() {
            this.destroyCount++;
        }
    }

    const RecoveryDisabledGameScene = await loadGameSceneWithGameSystem(
        RecoveryDisabledGameSystem
    );
    let legacyClearCount = 0;
    const dependencies = {
        webGpuPlatformPort: {
            getState() {
                return { ready: true, deviceGeneration: 7 };
            }
        },
        legacyWorldPort: {
            clear() {
                legacyClearCount++;
            }
        }
    };
    const tileNavigationSource = Object.freeze({ id: 'benchmark-arena' });
    const scene = new RecoveryDisabledGameScene({}, {
        dependencies,
        tileNavigationSource,
        enemyRecoveryEnabled: false
    });

    scene.fixedUpdate();
    scene.fixedUpdate();

    assert.equal(instances.length, 1);
    assert.equal(instances[0].fixedUpdateCount, 2);
    assert.equal(instances[0].destroyCount, 0);
    assert.strictEqual(
        instances[0].options.tileNavigationSource,
        tileNavigationSource
    );
    assert.deepEqual(
        { ...scene.getEnemyRecoveryStatus() },
        { restartCount: 0, restartGeneration: null }
    );
    assert.equal(legacyClearCount, 1);

    scene.destroy();
    assert.equal(instances[0].destroyCount, 1);
    assert.equal(legacyClearCount, 2);
});
