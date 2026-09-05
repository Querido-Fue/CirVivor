import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { loadGameModule } from './support/source_module_loader.mjs';

const { BaseScene } = await loadGameModule('scene/_base_scene.js');
const { GameSystem } = await loadGameModule('ingame/game_system.js');
const GAME_SCENE_SOURCE = await readFile(
    new URL('../project/game/script/module/scene/game/_game_scene.js', import.meta.url),
    'utf8'
);

function createSyntheticModule(context, identifier, exports) {
    const exportNames = Object.keys(exports);
    return new vm.SyntheticModule(exportNames, function initialize() {
        for (const exportName of exportNames) {
            this.setExport(exportName, exports[exportName]);
        }
    }, { context, identifier });
}

async function loadActualGameScene() {
    const context = vm.createContext({});
    const dependencies = new Map([
        ['scene/_base_scene.js', createSyntheticModule(
            context,
            'scene/_base_scene.js',
            { BaseScene }
        )],
        ['ingame/game_system.js', createSyntheticModule(
            context,
            'ingame/game_system.js',
            { GameSystem }
        )],
        ['simulation/fixed_step_result_contract.js', createSyntheticModule(
            context,
            'simulation/fixed_step_result_contract.js',
            {
                FIXED_STEP_RESULT: Object.freeze({
                    COMPLETED: 'COMPLETED',
                    DEFERRED_BACKPRESSURE: 'DEFERRED_BACKPRESSURE',
                    INTENTIONAL_PAUSE: 'INTENTIONAL_PAUSE'
                })
            }
        )],
        ['./game_scene_dependency_factory.js', createSyntheticModule(
            context,
            'game_scene_dependency_factory.js',
            {
                createGameSceneDependencies() {
                    throw new Error('테스트는 명시적 dependencies를 사용해야 합니다.');
                }
            }
        )]
    ]);
    const module = new vm.SourceTextModule(GAME_SCENE_SOURCE, {
        context,
        identifier: 'scene/game/_game_scene.js'
    });
    await module.link((specifier) => {
        const dependency = dependencies.get(specifier);
        if (!dependency) {
            throw new Error(`예상하지 못한 GameScene import입니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();
    return module.namespace.GameScene;
}

const GameScene = await loadActualGameScene();

class DrawTraceEnemySimulationBackend {
    constructor(trace) {
        this.trace = trace;
        this.capacity = 64;
        this.active = true;
        this.recoveryRequired = false;
        this.state = 'gpu-ready';
        this.failNextDraw = false;
        this.destroyed = false;
    }

    getCapacity() {
        return this.capacity;
    }

    init(tileMap) {
        this.tileMap = tileMap;
        return true;
    }

    spawnBodies(bodies) {
        return {
            accepted: bodies.length,
            rejected: 0,
            capacity: this.capacity,
            handles: []
        };
    }

    despawnBodies(handles) {
        return {
            removed: 0,
            rejected: handles.length,
            capacity: this.capacity
        };
    }

    hasBody() {
        return false;
    }

    hasActiveBodies() {
        return this.active && !this.destroyed;
    }

    fixedUpdate() {
        return true;
    }

    updatePresentation() {
        return null;
    }

    synchronizePresentation() {
    }

    draw(camera) {
        this.trace.push({ type: 'gpu-enemies', camera });
        if (this.failNextDraw) {
            this.failNextDraw = false;
            this.recoveryRequired = true;
            this.state = 'gpu-failed';
            return false;
        }
        return true;
    }

    getRuntimeState() {
        return this.destroyed ? 'destroyed' : this.state;
    }

    requiresRecovery() {
        return !this.destroyed && this.recoveryRequired;
    }

    destroy() {
        this.destroyed = true;
        this.active = false;
        this.state = 'destroyed';
    }
}

function createGameSceneHarness(options = {}) {
    const trace = [];
    const statusDraws = [];
    const statusRendererLifecycle = {
        createCount: 0,
        destroyCount: 0
    };
    const backend = new DrawTraceEnemySimulationBackend(trace);
    const viewport = {
        ww: 1920,
        wh: 1080,
        uiww: 1920,
        uiOffsetX: 0,
        uiScale: 1
    };
    const dependencies = {
        inputActionSource: {
            isPressed: () => false,
            getPointerPosition(out) {
                out.x = 0;
                out.y = 0;
                return out;
            },
            isPrimaryPointerPressed() {
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
                return {
                    remove() {},
                    retarget() {
                        return true;
                    }
                };
            }
        },
        timePort: {
            getDelta: () => 1 / 120,
            getFixedDelta: () => 1 / 60,
            getFixedInterpolationAlpha: () => 0.5
        },
        viewportPort: {
            getSnapshot(out) {
                Object.assign(out, viewport);
                return out;
            }
        },
        gameplayStatusRenderPort: {
            createSession() {
                statusRendererLifecycle.createCount++;
                return {
                    draw(status, statusViewport) {
                        statusDraws.push({
                            status,
                            viewport: { ...statusViewport }
                        });
                        trace.push({ type: 'game-status' });
                        return true;
                    },
                    destroy() {
                        statusRendererLifecycle.destroyCount++;
                    }
                };
            }
        },
        worldRenderPort: {
            drawSquareInstances() {
                trace.push({ type: 'tile-map' });
            },
            drawCircle(options) {
                trace.push({
                    type: options.fill === '#ffb52e' ? 'core' : 'tower'
                });
            }
        },
        webGpuPlatformPort: {
            getState() {
                return {
                    ready: options.platformReady !== false,
                    status: options.platformReady === false ? 'unsupported' : 'ready',
                    deviceGeneration: 1
                };
            }
        },
        enemySimulationBackend: backend,
        legacyWorldPort: {
            clear() {
            }
        }
    };
    const scene = new GameScene({}, {
        dependencies,
        enemyWaveEnabled: false,
        enemyRecoveryEnabled: false,
        ...options
    });
    return {
        backend,
        scene,
        statusDraws,
        statusRendererLifecycle,
        trace,
        viewport
    };
}

test('benchmark/tool enemy-only draw는 owner camera로 GPU만 그리고 gameplay status를 그리지 않는다', () => {
    const {
        backend,
        scene,
        statusDraws,
        statusRendererLifecycle,
        trace
    } = createGameSceneHarness();
    try {
        const gameSystem = scene.getGameSystem();
        const objectSystem = gameSystem.getObjectSystem();
        const camera = objectSystem.getWorldViewProjection();

        assert.equal(scene.drawEnemySimulation(), true);
        assert.deepEqual(trace.map(({ type }) => type), ['gpu-enemies']);
        assert.equal(statusDraws.length, 0);
        assert.strictEqual(trace[0].camera, camera);
        assert.equal(objectSystem.isEnemySimulationRecoveryRequired(), false);
        assert.equal(gameSystem.isEnemySimulationRecoveryRequired(), false);

        trace.length = 0;
        backend.failNextDraw = true;
        assert.equal(scene.drawEnemySimulation(), false);
        assert.deepEqual(trace.map(({ type }) => type), ['gpu-enemies']);
        assert.equal(statusDraws.length, 0);
        assert.strictEqual(trace[0].camera, camera);
        assert.equal(objectSystem.isEnemySimulationRecoveryRequired(), true);
        assert.equal(gameSystem.isEnemySimulationRecoveryRequired(), true);
        assert.equal(statusRendererLifecycle.createCount, 1);
        assert.equal(statusRendererLifecycle.destroyCount, 0);
    } finally {
        scene.destroy();
    }
    assert.equal(statusRendererLifecycle.destroyCount, 1);
});

test('GPU world full draw는 TileMap, GPU world, CPU Core만 그리고 CPU Tower를 그리지 않는다', () => {
    const { scene, statusDraws, trace } = createGameSceneHarness();
    try {
        scene.draw();
        assert.deepEqual(
            trace.map(({ type }) => type),
            ['tile-map', 'gpu-enemies', 'core', 'game-status']
        );
        assert.strictEqual(
            trace[1].camera,
            scene.getGameSystem().getObjectSystem().getWorldViewProjection()
        );
        assert.equal(statusDraws.length, 1);
        const [{ status, viewport }] = statusDraws;
        assert.equal(Object.isFrozen(status), true);
        assert.equal(Object.isFrozen(status.tower), true);
        assert.equal(Object.isFrozen(status.core), true);
        assert.equal(Object.isFrozen(status.hostileAttack), true);
        assert.equal(Object.isFrozen(status.wave), true);
        assert.deepEqual({ ...status.tower }, {
            available: true,
            state: 'ALIVE',
            alive: true,
            currentHp: 30,
            maxHp: 30,
            livingTowerCount: 1
        });
        assert.deepEqual({ ...status.core }, {
            available: true,
            currentIntegrity: 100,
            maxIntegrity: 100,
            depleted: false
        });
        assert.deepEqual({ ...status.hostileAttack }, {
            available: true,
            registeredArcherCount: 0,
            pendingShotCount: 0,
            requestAttempts: 0,
            requestAccepted: 0,
            fixedAccepted: 0,
            completedResolved: 0,
            completedSourceInvalid: 0,
            completedTargetInvalid: 0,
            noTargetTicks: 0,
            recoveryRequired: false
        });
        assert.deepEqual({ ...status.wave }, {
            available: false,
            totalSpawnCount: 0,
            queuedSpawnCount: 0,
            blockedSpawnCount: 0,
            remainingSpawnCount: 0,
            allSpawnsQueued: false
        });
        assert.equal('archers' in status.hostileAttack, false);
        assert.equal('pendingShots' in status.hostileAttack, false);
        assert.equal('lastCommittedFacts' in status.tower, false);
        assert.equal(status.fixedTick, 0);
        assert.equal(status.recoveryRequired, false);
        assert.deepEqual(viewport, {
            ww: 1920,
            wh: 1080,
            uiww: 1920,
            uiOffsetX: 0,
            uiScale: 1
        });
    } finally {
        scene.destroy();
    }
});

test('CPU fallback full draw는 기존 TileMap, GPU no-op layer, Core, Tower 순서를 유지한다', () => {
    const { scene, statusDraws, trace } = createGameSceneHarness({
        platformReady: false
    });
    try {
        scene.draw();
        assert.deepEqual(
            trace.map(({ type }) => type),
            ['tile-map', 'gpu-enemies', 'core', 'tower', 'game-status']
        );
        assert.equal(statusDraws.length, 1);
        assert.deepEqual({ ...statusDraws[0].status.tower }, {
            available: false,
            state: 'N/A',
            alive: null,
            currentHp: null,
            maxHp: null,
            livingTowerCount: null
        });
        assert.equal(statusDraws[0].status.core.currentIntegrity, 100);
    } finally {
        scene.destroy();
    }
});

test('resize·pause sync·recovery draw는 committed status를 재계산하지 않고 최신 UI viewport만 전달한다', () => {
    const {
        backend,
        scene,
        statusDraws,
        trace,
        viewport
    } = createGameSceneHarness();
    try {
        const gameSystem = scene.getGameSystem();
        const before = gameSystem.getGameplayStatus();
        scene.synchronizePresentation();
        scene.draw();
        const pausedDraw = statusDraws.at(-1).status;
        assert.equal(pausedDraw.fixedTick, before.fixedTick);
        assert.equal(pausedDraw.tower.currentHp, before.tower.currentHp);
        assert.equal(pausedDraw.core.currentIntegrity, before.core.currentIntegrity);

        viewport.ww = 1600;
        viewport.wh = 900;
        viewport.uiww = 1440;
        viewport.uiOffsetX = 80;
        viewport.uiScale = 1.25;
        scene.resize();
        trace.length = 0;
        backend.failNextDraw = true;
        scene.draw();

        assert.deepEqual(trace.map(({ type }) => type), [
            'tile-map',
            'gpu-enemies',
            'core',
            'game-status'
        ]);
        const recoveryDraw = statusDraws.at(-1);
        assert.equal(recoveryDraw.status.recoveryRequired, true);
        assert.equal(recoveryDraw.status.fixedTick, before.fixedTick);
        assert.equal(recoveryDraw.status.tower.currentHp, 30);
        assert.equal(recoveryDraw.status.tower.state, 'ALIVE');
        assert.equal(recoveryDraw.status.core.currentIntegrity, 100);
        assert.deepEqual(recoveryDraw.viewport, viewport);
        assert.equal(gameSystem.getTowerCombatStatus().currentHp, 30);
        assert.equal(gameSystem.getCoreIntegrity().getCurrentIntegrity(), 100);
    } finally {
        scene.destroy();
    }
});

test('초기 camera zoom 옵션은 controller 생성 전에 projection과 목표 zoom에 함께 적용된다', () => {
    const { scene } = createGameSceneHarness({ initialCameraZoom: 1 });
    try {
        const gameSystem = scene.getGameSystem();
        assert.equal(
            gameSystem.getObjectSystem().getWorldViewProjection().getZoom(),
            1
        );
        assert.equal(gameSystem.getCameraZoomController().getTargetZoom(), 1);
    } finally {
        scene.destroy();
    }
});
