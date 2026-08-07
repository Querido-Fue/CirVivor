import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { loadGameModule } from './support/source_module_loader.mjs';

const { BaseScene } = await loadGameModule('scene/_base_scene.js');
const { GameSystem } = await loadGameModule('ingame/game_system.js');
const GAME_SCENE_SOURCE = await readFile(
    new URL('../script/module/scene/game/_game_scene.js', import.meta.url),
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
    const backend = new DrawTraceEnemySimulationBackend(trace);
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
                out.ww = 1920;
                out.wh = 1080;
                return out;
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
    return { backend, scene, trace };
}

test('enemy-only draw는 owner camera로 GPU만 한 번 그리고 draw 실패를 recovery 상태에 반영한다', () => {
    const { backend, scene, trace } = createGameSceneHarness();
    try {
        const gameSystem = scene.getGameSystem();
        const objectSystem = gameSystem.getObjectSystem();
        const camera = objectSystem.getWorldViewProjection();

        assert.equal(scene.drawEnemySimulation(), true);
        assert.deepEqual(trace.map(({ type }) => type), ['gpu-enemies']);
        assert.strictEqual(trace[0].camera, camera);
        assert.equal(objectSystem.isEnemySimulationRecoveryRequired(), false);
        assert.equal(gameSystem.isEnemySimulationRecoveryRequired(), false);

        trace.length = 0;
        backend.failNextDraw = true;
        assert.equal(scene.drawEnemySimulation(), false);
        assert.deepEqual(trace.map(({ type }) => type), ['gpu-enemies']);
        assert.strictEqual(trace[0].camera, camera);
        assert.equal(objectSystem.isEnemySimulationRecoveryRequired(), true);
        assert.equal(gameSystem.isEnemySimulationRecoveryRequired(), true);
    } finally {
        scene.destroy();
    }
});

test('GPU world full draw는 TileMap, GPU world, CPU Core만 그리고 CPU Tower를 그리지 않는다', () => {
    const { scene, trace } = createGameSceneHarness();
    try {
        scene.draw();
        assert.deepEqual(
            trace.map(({ type }) => type),
            ['tile-map', 'gpu-enemies', 'core']
        );
        assert.strictEqual(
            trace[1].camera,
            scene.getGameSystem().getObjectSystem().getWorldViewProjection()
        );
    } finally {
        scene.destroy();
    }
});

test('CPU fallback full draw는 기존 TileMap, GPU no-op layer, Core, Tower 순서를 유지한다', () => {
    const { scene, trace } = createGameSceneHarness({ platformReady: false });
    try {
        scene.draw();
        assert.deepEqual(
            trace.map(({ type }) => type),
            ['tile-map', 'gpu-enemies', 'core', 'tower']
        );
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
