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
        this.destroyCount = 0;
    }

    getCapacity() {
        return 64;
    }

    init() {
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

    assert.equal(scene.getNextGpuLifecycleFixedTick(), 1);
    assert.equal(scene.getNextEnemyLifecycleFixedTick(), 1);

    scene.fixedUpdate();
    assert.equal(backends.length, 2);
    assert.equal(backends[0].destroyCount, 1);
    assert.equal(scene.getEnemyRecoveryStatus().restartCount, 1);
    assert.equal(scene.getEnemyRecoveryStatus().restartGeneration, 1);
    assert.equal(scene.gameSystem.getFixedTick(), 0);
    assert.equal(scene.gameSystem.getObjectSystem().getWorldRegistry().getActiveCount(), 0);

    scene.fixedUpdate();
    assert.equal(scene.gameSystem.getFixedTick(), 1);
    assert.equal(scene.getNextGpuLifecycleFixedTick(), 2);
    assert.equal(scene.gameSystem.getObjectSystem().getWorldRegistry().getActiveCount(), 1);
    assert.equal(scene.getEnemyRecoveryStatus().restartGeneration, null);

    backends[1].hardFailNextFixed = true;
    scene.fixedUpdate();
    assert.equal(backends.length, 3);
    assert.equal(backends[1].destroyCount, 1);
    assert.equal(scene.getEnemyRecoveryStatus().restartCount, 2);
    assert.equal(scene.gameSystem.getFixedTick(), 0);

    scene.fixedUpdate();
    assert.equal(backends.length, 3);
    assert.equal(scene.gameSystem.getFixedTick(), 0);
    assert.equal(scene.getEnemyRecoveryStatus().restartCount, 2);
    assert.equal(scene.getEnemyRecoveryStatus().restartGeneration, 1);

    scene.destroy();
    scene.destroy();
    assert.equal(backends[2].destroyCount, 1);
    assert.equal(legacyClearCount, 4);
});

test('선택한 enemy presentation profile은 최초와 hard-recovery 교체 GameSystem에 동일하게 전달된다', async () => {
    const instances = [];
    class CapturingGameSystem {
        constructor(dependencies, options) {
            this.dependencies = dependencies;
            this.options = options;
            this.enterCount = 0;
            this.destroyCount = 0;
            this.recoveryRequired = (instances.length % 2) === 0;
            instances.push(this);
        }

        enter() {
            this.enterCount++;
            return true;
        }

        fixedUpdate() {
            return false;
        }

        isEnemySimulationRecoveryRequired() {
            return this.recoveryRequired;
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
        const recoveredSystem = instances[firstInstanceIndex + 1];
        assert.equal(instances.length, firstInstanceIndex + 2);
        assert.equal(initialSystem.destroyCount, 1);
        assert.strictEqual(recoveredSystem.dependencies, dependencies);
        assert.equal(recoveredSystem.options.enemyPresentationProfile, profile);
        assert.strictEqual(
            recoveredSystem.options.tileNavigationSource,
            tileNavigationSource
        );
        assert.equal(recoveredSystem.enterCount, 1);
        assert.equal(scene.getEnemyRecoveryStatus().restartCount, 1);
        assert.equal(
            scene.getEnemyRecoveryStatus().restartGeneration,
            profileIndex + 1
        );
        assert.equal(legacyClearCount, 2);

        scene.destroy();
        scene.destroy();
        assert.equal(initialSystem.destroyCount, 1);
        assert.equal(recoveredSystem.destroyCount, 1);
        assert.equal(legacyClearCount, 3);
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
