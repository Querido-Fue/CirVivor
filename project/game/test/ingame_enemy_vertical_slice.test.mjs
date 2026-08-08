import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { BASIC_SQUARE_ENEMY_DATA } = await loadGameModule(
    'data/object/enemy/basic_circle_enemy_data.js'
);
const { CORRIDOR_EIGHT_WAVE_01_DATA } = await loadGameModule(
    'data/scene/game/corridor_eight_wave_01_data.js'
);
const { CoreIntegrity } = await loadGameModule(
    'ingame/state/core_integrity.js'
);
const { GameObjectSystem } = await loadGameModule(
    'ingame/object/game_object_system.js'
);
const { GameSystem } = await loadGameModule('ingame/game_system.js');
const {
    requestGpuBenchmarkEnemyBatch
} = await loadGameModule(
    'scene/benchmark/gpu_benchmark_enemy_spawn_adapter.js'
);
const {
    requestGpuBenchmarkProjectileBatch
} = await loadGameModule(
    'scene/benchmark/gpu_benchmark_projectile_spawn_adapter.js'
);
const {
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_RENDER_SHAPE
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

class FakeEnemySimulationBackend {
    constructor(capacity = 64) {
        this.capacity = capacity;
        this.bodiesByHandle = new Map();
        this.calls = [];
        this.initialized = false;
        this.destroyed = false;
        this.spawnMode = 'accept';
        this.fixedUpdateMode = 'accept';
        this.runtimeState = 'gpu-ready';
        this.recovering = false;
        this.completedEventBatches = [];
        this.eventProtocolState = null;
        this.replaceBodiesCallCount = 0;
        this.readbackBodiesCallCount = 0;
    }

    getCapacity() {
        return this.capacity;
    }

    init(tileMap) {
        this.tileMap = tileMap;
        this.initialized = true;
        this.calls.push({ type: 'init', tileMap });
        return true;
    }

    spawnBodies(source) {
        const bodies = Array.from(source);
        this.calls.push({ type: 'spawnBodies', bodies });
        if (this.spawnMode === 'reject-once-unavailable') {
            this.spawnMode = 'accept';
            return {
                accepted: 0,
                rejected: bodies.length,
                capacity: this.capacity,
                handles: [],
                reason: 'unavailable'
            };
        }
        for (const body of bodies) {
            this.bodiesByHandle.set(handleKey(body), body);
        }
        return {
            accepted: bodies.length,
            rejected: 0,
            capacity: this.capacity,
            handles: bodies.map(({ entityId, incarnation }) => ({
                entityId,
                incarnation
            }))
        };
    }

    despawnBodies(source) {
        const handles = Array.from(source);
        this.calls.push({ type: 'despawnBodies', handles });
        let removed = 0;
        for (const handle of handles) {
            removed += this.bodiesByHandle.delete(handleKey(handle)) ? 1 : 0;
        }
        return {
            removed,
            rejected: handles.length - removed,
            capacity: this.capacity
        };
    }

    hasBody(handle) {
        return this.bodiesByHandle.has(handleKey(handle));
    }

    hasActiveBodies() {
        return this.bodiesByHandle.size > 0;
    }

    canControlBody(handle) {
        const body = this.bodiesByHandle.get(handleKey(handle));
        return body?.kindId === 'tower';
    }

    stageFixedPrograms(plan = {}) {
        const controls = Array.from(plan.controls ?? []);
        const sourceRelativeSpawns = Array.from(
            plan.sourceRelativeSpawns ?? []
        );
        this.calls.push({
            type: 'stageFixedPrograms',
            targetFixedTick: plan.targetFixedTick,
            controls,
            sourceRelativeSpawns
        });

        const controlledHandles = new Set();
        const controlsValid = controls.every((control) => {
            const key = handleKey(control);
            if (controlledHandles.has(key) || !this.canControlBody(control)) {
                return false;
            }
            controlledHandles.add(key);
            return true;
        });
        const sourcesValid = sourceRelativeSpawns.every(({ sourceHandle }) => (
            this.hasBody(sourceHandle)
        ));
        const commandCount = controls.length + sourceRelativeSpawns.length;
        if (!controlsValid || !sourcesValid) {
            return {
                accepted: 0,
                rejected: commandCount,
                reason: 'control-contract',
                requiresRecovery: false
            };
        }
        return {
            accepted: commandCount,
            rejected: 0,
            requiresRecovery: false
        };
    }

    configureTrackedBody(handle = null) {
        if (handle === null) {
            return { accepted: true, tracked: null };
        }
        const accepted = this.canControlBody(handle);
        return {
            accepted,
            tracked: accepted
                ? { entityId: handle.entityId, incarnation: handle.incarnation }
                : null,
            reason: accepted ? undefined : 'stale-handle'
        };
    }

    setFixedUpdateMode(mode) {
        this.fixedUpdateMode = mode;
    }

    fixedUpdate(delta, sourceTick) {
        this.calls.push({ type: 'fixedUpdate', delta, sourceTick });
        if (this.fixedUpdateMode === 'backpressure-once') {
            this.fixedUpdateMode = 'resume-after-backpressure';
            this.runtimeState = 'gpu-backpressure';
            this.recovering = true;
            return false;
        }
        if (this.fixedUpdateMode === 'resume-after-backpressure') {
            this.fixedUpdateMode = 'accept';
            this.runtimeState = 'gpu-ready';
            this.recovering = false;
        }
        return true;
    }

    updatePresentation(frame) {
        this.calls.push({
            type: 'updatePresentation',
            frame: {
                frameDelta: frame.frameDelta,
                fixedDelta: frame.fixedDelta,
                fixedAlpha: frame.fixedAlpha
            }
        });
        return true;
    }

    synchronizePresentation() {
        this.calls.push({ type: 'synchronizePresentation' });
    }

    draw(projection) {
        this.calls.push({ type: 'draw', projection });
        return true;
    }

    getRuntimeState() {
        return this.destroyed ? 'destroyed' : this.runtimeState;
    }

    requiresRecovery() {
        return this.recovering;
    }

    setEventProtocolState(protocol) {
        this.eventProtocolState = protocol;
    }

    getEventProtocolState() {
        return this.eventProtocolState;
    }

    drainCompletedEventBatches(out) {
        out.push(...this.completedEventBatches.splice(0));
        return out;
    }

    replaceBodies() {
        this.replaceBodiesCallCount++;
        throw new Error('live enemy 경로에서 replaceBodies()를 호출하면 안 됩니다.');
    }

    readbackBodies() {
        this.readbackBodiesCallCount++;
        throw new Error('live enemy 경로에서 readbackBodies()를 호출하면 안 됩니다.');
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.calls.push({ type: 'destroy' });
        this.bodiesByHandle.clear();
        this.destroyed = true;
        this.initialized = false;
    }
}

function createGameSceneDependencies(backend) {
    return {
        inputActionSource: {
            isPressed() {
                return false;
            },
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
                return { ready: true };
            }
        },
        enemySimulationBackend: backend,
        legacyWorldPort: {
            clear() {}
        }
    };
}

test('신규 게임 적은 next-fixed 경계에서 실제 wave 데이터로 GPU backend에 진입한다', () => {
    const backend = new FakeEnemySimulationBackend();
    const objectSystem = new GameObjectSystem({
        enemySimulationBackend: backend,
        webGpuPlatformPort: {
            getState() {
                return { ready: true };
            }
        },
        worldRenderPort: {
            drawCircle() {},
            drawSquareInstances() {}
        }
    }, {
        coreIntegrity: new CoreIntegrity({ maxIntegrity: 100 })
    });

    objectSystem.init({ ww: 1920, wh: 1080 });
    const tileMap = objectSystem.getTileMap();
    const endpoint = objectSystem.getEnemySimulationEndpoint();
    assert.strictEqual(objectSystem.getGpuSimulationEndpoint(), endpoint);
    const [route] = tileMap.getSpawnRoutes();
    const waveGroup = CORRIDOR_EIGHT_WAVE_01_DATA.phases[0].spawnGroups[0];

    assert.equal(backend.initialized, true);
    assert.strictEqual(endpoint.getBackend(), backend);
    assert.strictEqual(endpoint.getRegistry(), objectSystem.getWorldRegistry());
    assert.strictEqual(
        endpoint.getLifecycleCommandOwner(),
        objectSystem.getEnemyLifecycleCommandOwner()
    );
    assert.strictEqual(backend.tileMap, tileMap);
    assert.equal(backend.bodiesByHandle.size, 0);
    assert.equal(objectSystem.getWorldRegistry().getActiveCount(), 0);
    assert.equal(objectSystem.getEnemyWaveStatus().queuedSpawnCount, 0);

    objectSystem.update(0.25, 1 / 120, 1 / 60);
    objectSystem.draw();
    assert.equal(backend.bodiesByHandle.size, 0);
    assert.equal(
        backend.calls.filter(({ type }) => type === 'spawnBodies').length,
        0
    );

    backend.calls.length = 0;
    assert.equal(objectSystem.fixedUpdate(1 / 60, 1), true);
    assert.deepEqual(
        backend.calls.map(({ type }) => type),
        ['spawnBodies', 'fixedUpdate']
    );
    assert.equal(objectSystem.getLastCompletedEnemyFixedTick(), 1);
    assert.equal(objectSystem.getEnemyWaveStatus().queuedSpawnCount, 1);

    const spawnCall = backend.calls[0];
    assert.equal(spawnCall.bodies.length, 3);
    const body = spawnCall.bodies.find(({ kindId }) => kindId === 'enemy');
    assert.ok(body);
    assert.equal(spawnCall.bodies.filter(({ kindId }) => kindId === 'tower').length, 1);
    assert.equal(
        spawnCall.bodies.filter(({ kindId }) => kindId === 'core-proxy').length,
        1
    );
    assert.ok(Number.isSafeInteger(body.entityId) && body.entityId > 0);
    assert.equal(body.incarnation, 1);
    assert.equal(body.kindId, 'enemy');
    assert.equal(body.definitionId, BASIC_SQUARE_ENEMY_DATA.id);
    assert.equal(body.enemyDefinitionId, BASIC_SQUARE_ENEMY_DATA.id);
    assert.equal(body.gateId, route.gateId);
    assert.equal(body.pathId, route.pathId);
    assert.equal(body.waypointIndex, 1);
    assert.equal(body.spawnSequence, 0);
    assert.equal(body.waveId, CORRIDOR_EIGHT_WAVE_01_DATA.waveId);
    assert.equal(body.policyId, waveGroup.policyId);

    const entry = route.waypoints[0];
    const next = route.waypoints[1];
    const directionX = next.x - entry.x;
    const directionY = next.y - entry.y;
    const directionLength = Math.hypot(directionX, directionY);
    const laneOffset = waveGroup.laneOffsetsTiles[0];
    assert.equal(body.position.x, entry.x + ((-directionY / directionLength) * laneOffset));
    assert.equal(body.position.y, entry.y + ((directionX / directionLength) * laneOffset));
    assert.equal(
        body.velocity.x,
        (directionX / directionLength) * BASIC_SQUARE_ENEMY_DATA.moveSpeedTilesPerSecond
    );
    assert.equal(
        body.velocity.y,
        (directionY / directionLength) * BASIC_SQUARE_ENEMY_DATA.moveSpeedTilesPerSecond
    );
    assert.equal(body.radius, BASIC_SQUARE_ENEMY_DATA.collisionRadiusTiles);
    assert.equal(body.inverseMass, 1 / BASIC_SQUARE_ENEMY_DATA.collisionWeight);
    assert.equal(body.flowSpeed, BASIC_SQUARE_ENEMY_DATA.moveSpeedTilesPerSecond);
    assert.equal(body.bodyLayer, GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY);
    assert.equal(
        body.collisionMask,
        GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN
    );
    assert.equal(body.interactionLayer, GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY);
    assert.equal(
        body.interactionMask,
        GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.CORE_PROXY
    );
    assert.equal('layerMask' in body, false);
    assert.equal('sensorMask' in body, false);
    assert.equal(body.health, BASIC_SQUARE_ENEMY_DATA.maxHealth);
    assert.equal(body.lifetime, -1);
    assert.equal(body.alive, true);
    assert.deepEqual(Array.from(body.renderStyle.color), Array.from(BASIC_SQUARE_ENEMY_DATA.colorRgba));
    assert.equal(body.renderStyle.radiusScale, BASIC_SQUARE_ENEMY_DATA.radiusScale);
    assert.equal(body.renderStyle.visible, true);
    assert.equal(body.renderStyle.shapeCode, GPU_CIRCLE_BODY_RENDER_SHAPE.SQUARE);

    const handle = {
        entityId: body.entityId,
        incarnation: body.incarnation
    };
    const registry = objectSystem.getWorldRegistry();
    assert.equal(backend.hasBody(handle), true);
    assert.equal(registry.has(handle), true);
    assert.equal(registry.getActiveCount('enemy'), 1);
    assert.equal(endpoint.getStatus().activeCount, 3);
    const entityView = registry.copyEntityView(handle, {});
    assert.equal(entityView.definitionId, BASIC_SQUARE_ENEMY_DATA.id);
    assert.equal(entityView.createdAtTick, 1);
    assert.equal(entityView.metadata.gateId, route.gateId);
    assert.equal(entityView.metadata.pathId, route.pathId);
    assert.equal(entityView.metadata.initialWaypointIndex, 1);

    backend.calls.length = 0;
    assert.equal(objectSystem.fixedUpdate(1 / 60, 2), true);
    assert.deepEqual(
        backend.calls.map(({ type }) => type),
        ['stageFixedPrograms', 'fixedUpdate']
    );
    assert.equal(backend.calls[0].targetFixedTick, 2);
    assert.equal(backend.calls[0].controls.length, 1);
    const towerControl = backend.calls[0].controls[0];
    assert.equal(
        towerControl.entityId,
        spawnCall.bodies.find(({ kindId }) => kindId === 'tower').entityId
    );
    assert.equal(towerControl.incarnation, 1);
    assert.equal(towerControl.moveIntentX, 0);
    assert.equal(towerControl.moveIntentY, 0);
    assert.deepEqual(backend.calls[0].sourceRelativeSpawns, []);
    assert.equal(objectSystem.getLastCompletedEnemyFixedTick(), 2);
    assert.equal(backend.bodiesByHandle.size, 3);

    for (let fixedTick = 3; fixedTick <= 156; fixedTick++) {
        assert.equal(objectSystem.fixedUpdate(1 / 60, fixedTick), true);
    }
    assert.equal(objectSystem.getLastCompletedEnemyFixedTick(), 156);
    assert.equal(objectSystem.getEnemyWaveStatus().queuedSpawnCount, 32);
    assert.deepEqual(
        new Set(Array.from(
            backend.bodiesByHandle.values(),
            ({ kindId, definitionId }) => kindId === 'enemy' ? definitionId : null
        ).filter(Boolean)),
        new Set(waveGroup.enemyDefinitionIds)
    );
    const hostileAttackStatus = objectSystem.getHostileAttackStatus();
    assert.equal(Object.isFrozen(hostileAttackStatus), true);
    assert.equal(hostileAttackStatus.activeArcherCount, 0);
    assert.equal(hostileAttackStatus.pendingShotCount, 0);
    assert.equal(hostileAttackStatus.shotStartAttemptCount, 0);
    assert.equal(hostileAttackStatus.shotResolvedCount, 0);

    backend.calls.length = 0;
    objectSystem.update(0.75, 1 / 144, 1 / 60);
    objectSystem.draw();
    assert.deepEqual(
        backend.calls.map(({ type }) => type),
        ['updatePresentation', 'draw']
    );
    assert.deepEqual(backend.calls[0].frame, {
        frameDelta: 1 / 144,
        fixedDelta: 1 / 60,
        fixedAlpha: 0.75
    });
    assert.strictEqual(
        backend.calls[1].projection,
        objectSystem.getWorldViewProjection()
    );
    assert.equal(backend.replaceBodiesCallCount, 0);
    assert.equal(backend.readbackBodiesCallCount, 0);

    objectSystem.destroy();
    objectSystem.destroy();
    assert.equal(backend.destroyed, true);
    assert.equal(backend.bodiesByHandle.size, 0);
    assert.equal(registry.getStatus().destroyed, true);
    assert.equal(registry.getStatus().activeCount, 0);
    assert.equal(objectSystem.getEnemyLifecycleCommandOwner().getStatus().destroyed, true);
    assert.equal(backend.replaceBodiesCallCount, 0);
    assert.equal(backend.readbackBodiesCallCount, 0);
    assert.equal(
        backend.calls.filter(({ type }) => type === 'destroy').length,
        1
    );
});

test('일시 unavailable인 첫 spawn은 wave cursor를 잃지 않고 같은 fixed tick에 재시도한다', () => {
    const backend = new FakeEnemySimulationBackend();
    backend.spawnMode = 'reject-once-unavailable';
    const objectSystem = new GameObjectSystem({
        enemySimulationBackend: backend,
        webGpuPlatformPort: {
            getState() {
                return { ready: true };
            }
        },
        worldRenderPort: {
            drawCircle() {},
            drawSquareInstances() {}
        }
    }, {
        coreIntegrity: new CoreIntegrity({ maxIntegrity: 100 })
    });
    objectSystem.init({ ww: 1920, wh: 1080 });

    assert.equal(objectSystem.fixedUpdate(1 / 60, 1), false);
    assert.equal(objectSystem.getLastCompletedEnemyFixedTick(), 0);
    assert.equal(
        objectSystem.getNextGpuLifecycleFixedTick(),
        1,
        'lifecycle commit 자체가 stalled면 N+1 경계는 아직 열려 있어야 합니다.'
    );
    assert.equal(objectSystem.isEnemySimulationRecoveryRequired(), false);
    assert.equal(objectSystem.getEnemyWaveStatus().queuedSpawnCount, 1);
    assert.equal(objectSystem.getEnemyLifecycleCommandOwner().getPendingCount(), 3);
    assert.equal(objectSystem.getWorldRegistry().getActiveCount(), 0);
    assert.equal(objectSystem.getWorldRegistry().getReservedCount(), 0);

    assert.equal(objectSystem.fixedUpdate(1 / 60, 1), true);
    assert.equal(objectSystem.getLastCompletedEnemyFixedTick(), 1);
    assert.equal(objectSystem.getEnemyLifecycleCommandOwner().getPendingCount(), 0);
    assert.equal(objectSystem.getWorldRegistry().getActiveCount(), 3);
    assert.equal(
        backend.calls.filter(({ type }) => type === 'spawnBodies').length,
        2
    );

    objectSystem.destroy();
});

test('pending N+1 GPU submit 중 새 mixed-body batch는 열린 N+2 lifecycle 경계에 통합 예약된다', () => {
    const backend = new FakeEnemySimulationBackend();
    const gameSystem = new GameSystem(createGameSceneDependencies(backend));
    gameSystem.enter();
    const objectSystem = gameSystem.getObjectSystem();
    const endpoint = gameSystem.getGpuSimulationEndpoint();
    const gameScene = {
        getGameSystem() {
            return gameSystem;
        },
        getGpuSimulationEndpoint() {
            return endpoint;
        },
        getNextGpuLifecycleFixedTick() {
            return gameSystem.getNextGpuLifecycleFixedTick();
        },
        getNextEnemyLifecycleFixedTick() {
            return this.getNextGpuLifecycleFixedTick();
        }
    };

    assert.equal(gameSystem.getFixedTick(), 0);
    assert.equal(objectSystem.getNextGpuLifecycleFixedTick(), 1);
    assert.equal(objectSystem.getNextEnemyLifecycleFixedTick(), 1);
    assert.equal(gameSystem.getNextGpuLifecycleFixedTick(), 1);
    assert.equal(gameSystem.getNextEnemyLifecycleFixedTick(), 1);
    assert.equal(gameScene.getNextGpuLifecycleFixedTick(), 1);
    assert.equal(gameScene.getNextEnemyLifecycleFixedTick(), 1);

    backend.setFixedUpdateMode('backpressure-once');
    assert.equal(gameSystem.fixedUpdate(), false);

    assert.equal(gameSystem.getFixedTick(), 0);
    assert.equal(objectSystem.getLastCompletedEnemyFixedTick(), 0);
    assert.equal(endpoint.getRuntimeState(), 'gpu-backpressure');
    assert.equal(gameScene.getNextGpuLifecycleFixedTick(), 2);

    const enemyBatch = requestGpuBenchmarkEnemyBatch({
        gameScene,
        count: 1,
        sessionGeneration: 11,
        batchSequence: 0,
        spawnSequence: 100
    });
    const projectileBatch = requestGpuBenchmarkProjectileBatch({
        gameScene,
        count: 1,
        sessionGeneration: 11,
        batchSequence: 0,
        spawnSequence: 200
    });

    assert.equal(enemyBatch.accepted, true);
    assert.equal(projectileBatch.accepted, true);
    assert.equal(enemyBatch.targetFixedTick, 2);
    assert.equal(projectileBatch.targetFixedTick, 2);
    assert.equal(endpoint.getPendingCommandCount(), 2);

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 1);
    assert.equal(endpoint.getRuntimeState(), 'gpu-ready');
    assert.equal(endpoint.getPendingCommandCount(), 2);
    assert.equal(gameScene.getNextGpuLifecycleFixedTick(), 2);

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 2);
    assert.equal(endpoint.getPendingCommandCount(), 0);
    assert.equal(endpoint.getRegistry().getActiveCount('enemy'), 2);
    assert.equal(endpoint.getRegistry().getActiveCount('projectile'), 1);
    assert.equal(gameScene.getNextGpuLifecycleFixedTick(), 3);

    gameSystem.destroy();
});

test('terminal unsupported 플랫폼은 CPU no-wave fallback으로 고정되어 fixed tick을 지속한다', () => {
    const platform = {
        getState: () => ({ status: 'unsupported', ready: false }),
        getDevice: () => null,
        getCanvasFormat: () => null,
        getDeviceGeneration: () => 0,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    };
    const objectSystem = new GameObjectSystem({
        webGpuPlatformPort: platform,
        worldRenderPort: {
            drawCircle() {},
            drawSquareInstances() {}
        }
    }, {
        coreIntegrity: new CoreIntegrity({ maxIntegrity: 100 }),
        enemyWaveEnabled: true
    });
    objectSystem.init({ ww: 1920, wh: 1080 });

    assert.equal(objectSystem.fixedUpdate(1 / 60, 1), true);
    assert.equal(objectSystem.getLastCompletedEnemyFixedTick(), 1);
    assert.equal(objectSystem.isEnemySimulationRecoveryRequired(), false);
    assert.equal(objectSystem.getEnemyLifecycleCommandOwner().getPendingCount(), 0);
    assert.equal(objectSystem.getWorldRegistry().getReservedCount(), 0);
    assert.equal(objectSystem.getWorldRegistry().getActiveCount(), 0);
    assert.equal(
        objectSystem.getEnemySimulationBackend().getRuntimeState(),
        'gpu-deferred'
    );

    objectSystem.destroy();
});

test('event protocol violation은 같은 fixed 경계의 lifecycle과 GPU submit 전에 즉시 중단한다', () => {
    const backend = new FakeEnemySimulationBackend();
    const objectSystem = new GameObjectSystem({
        enemySimulationBackend: backend,
        worldRenderPort: {
            drawCircle() {},
            drawSquareInstances() {}
        }
    }, {
        coreIntegrity: new CoreIntegrity({ maxIntegrity: 100 }),
        enemyWaveEnabled: false
    });
    objectSystem.init({ ww: 1920, wh: 1080 });
    const endpoint = objectSystem.getGpuSimulationEndpoint();
    const protocol = {
        sessionGeneration: endpoint.getStatus().sessionGeneration,
        deviceGeneration: 2,
        authoritativeEpoch: 3
    };
    backend.setEventProtocolState(protocol);
    backend.completedEventBatches.push({
        ...protocol,
        deviceGeneration: protocol.deviceGeneration + 1,
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 1,
        submittedTick: 1,
        completedThroughTick: 1,
        events: []
    });

    assert.equal(objectSystem.fixedUpdate(1 / 60, 2), false);
    assert.equal(objectSystem.isEnemySimulationRecoveryRequired(), true);
    assert.equal(objectSystem.getLastCompletedEnemyFixedTick(), 0);
    assert.equal(
        backend.calls.filter(({ type }) => type === 'fixedUpdate').length,
        0
    );
    assert.equal(
        backend.calls.filter(({ type }) => type === 'spawnBodies').length,
        0
    );
    assert.equal(
        backend.calls.filter(({ type }) => type === 'synchronizePresentation').length,
        1
    );

    objectSystem.destroy();
});
