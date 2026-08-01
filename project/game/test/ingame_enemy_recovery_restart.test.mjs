import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { loadGameModule } from './support/source_module_loader.mjs';

const { BaseScene } = await loadGameModule('scene/_base_scene.js');
const { GameSystem } = await loadGameModule('ingame/game_system.js');
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

    scene.fixedUpdate();
    assert.equal(backends.length, 2);
    assert.equal(backends[0].destroyCount, 1);
    assert.equal(scene.getEnemyRecoveryStatus().restartCount, 1);
    assert.equal(scene.getEnemyRecoveryStatus().restartGeneration, 1);
    assert.equal(scene.gameSystem.getFixedTick(), 0);
    assert.equal(scene.gameSystem.getObjectSystem().getWorldRegistry().getActiveCount(), 0);

    scene.fixedUpdate();
    assert.equal(scene.gameSystem.getFixedTick(), 1);
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
