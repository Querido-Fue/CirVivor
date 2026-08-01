import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { BASIC_CIRCLE_ENEMY_DATA } = await loadGameModule(
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
const {
    GPU_CIRCLE_BODY_COLLISION_LAYER
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

    fixedUpdate(delta) {
        this.calls.push({ type: 'fixedUpdate', delta });
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
        return this.destroyed ? 'destroyed' : 'gpu-ready';
    }

    requiresRecovery() {
        return false;
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
    const [route] = tileMap.getSpawnRoutes();
    const waveGroup = CORRIDOR_EIGHT_WAVE_01_DATA.phases[0].spawnGroups[0];

    assert.equal(backend.initialized, true);
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
    assert.equal(spawnCall.bodies.length, 1);
    const body = spawnCall.bodies[0];
    assert.ok(Number.isSafeInteger(body.entityId) && body.entityId > 0);
    assert.equal(body.incarnation, 1);
    assert.equal(body.kindId, 'enemy');
    assert.equal(body.enemyDefinitionId, BASIC_CIRCLE_ENEMY_DATA.id);
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
    assert.equal(body.velocity.x, 0);
    assert.equal(body.velocity.y, 0);
    assert.equal(body.radius, BASIC_CIRCLE_ENEMY_DATA.collisionRadiusTiles);
    assert.equal(body.inverseMass, 1 / BASIC_CIRCLE_ENEMY_DATA.collisionWeight);
    assert.equal(body.flowSpeed, BASIC_CIRCLE_ENEMY_DATA.moveSpeedTilesPerSecond);
    assert.equal(body.layerMask, GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY);
    assert.equal(
        body.collisionMask,
        GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN
    );
    assert.equal(body.alive, true);
    assert.deepEqual(Array.from(body.renderStyle.color), Array.from(BASIC_CIRCLE_ENEMY_DATA.colorRgba));
    assert.equal(body.renderStyle.radiusScale, BASIC_CIRCLE_ENEMY_DATA.radiusScale);
    assert.equal(body.renderStyle.visible, true);

    const handle = {
        entityId: body.entityId,
        incarnation: body.incarnation
    };
    const registry = objectSystem.getWorldRegistry();
    assert.equal(backend.hasBody(handle), true);
    assert.equal(registry.has(handle), true);
    assert.equal(registry.getActiveCount('enemy'), 1);
    const entityView = registry.copyEntityView(handle, {});
    assert.equal(entityView.definitionId, BASIC_CIRCLE_ENEMY_DATA.id);
    assert.equal(entityView.createdAtTick, 1);
    assert.equal(entityView.metadata.gateId, route.gateId);
    assert.equal(entityView.metadata.pathId, route.pathId);
    assert.equal(entityView.metadata.initialWaypointIndex, 1);

    backend.calls.length = 0;
    assert.equal(objectSystem.fixedUpdate(1 / 60, 2), true);
    assert.deepEqual(
        backend.calls.map(({ type }) => type),
        ['fixedUpdate']
    );
    assert.equal(objectSystem.getLastCompletedEnemyFixedTick(), 2);
    assert.equal(backend.bodiesByHandle.size, 1);

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
    assert.equal(objectSystem.isEnemySimulationRecoveryRequired(), false);
    assert.equal(objectSystem.getEnemyWaveStatus().queuedSpawnCount, 1);
    assert.equal(objectSystem.getEnemyLifecycleCommandOwner().getPendingCount(), 1);
    assert.equal(objectSystem.getWorldRegistry().getActiveCount(), 0);
    assert.equal(objectSystem.getWorldRegistry().getReservedCount(), 0);

    assert.equal(objectSystem.fixedUpdate(1 / 60, 1), true);
    assert.equal(objectSystem.getLastCompletedEnemyFixedTick(), 1);
    assert.equal(objectSystem.getEnemyLifecycleCommandOwner().getPendingCount(), 0);
    assert.equal(objectSystem.getWorldRegistry().getActiveCount(), 1);
    assert.equal(
        backend.calls.filter(({ type }) => type === 'spawnBodies').length,
        2
    );

    objectSystem.destroy();
});

test('terminal unsupported 플랫폼은 spawn command를 무기한 soft-stall하지 않고 hard recovery로 승격한다', () => {
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

    assert.equal(objectSystem.fixedUpdate(1 / 60, 1), false);
    assert.equal(objectSystem.getLastCompletedEnemyFixedTick(), 0);
    assert.equal(objectSystem.isEnemySimulationRecoveryRequired(), true);
    assert.equal(objectSystem.getEnemyLifecycleCommandOwner().getPendingCount(), 1);
    assert.equal(objectSystem.getWorldRegistry().getReservedCount(), 0);
    assert.equal(objectSystem.getWorldRegistry().getActiveCount(), 0);
    assert.equal(
        objectSystem.getEnemySimulationBackend().getRuntimeState(),
        'gpu-terminal-unavailable'
    );

    objectSystem.destroy();
});
