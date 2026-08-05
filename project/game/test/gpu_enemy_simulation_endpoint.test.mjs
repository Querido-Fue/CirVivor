import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_BODY_PRESENTATION_PROFILE,
    GpuSimulationEndpoint,
    GpuEnemySimulationEndpoint,
    createGpuSimulationEndpoint,
    createGpuEnemySimulationEndpoint,
    createGpuEnemySpawnIntent
} = await loadGameModule(
    'ingame/gpu_simulation_endpoint.js'
);

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function createSpawnIntent(spawnSequence = 0) {
    return createGpuEnemySpawnIntent({
        definition: {
            id: 'basic_circle_01',
            shapeType: 'square',
            moveSpeedTilesPerSecond: 2.5,
            collisionRadiusTiles: 0.5939696961966999,
            collisionWeight: 1,
            colorRgba: [1, 108 / 255, 108 / 255, 1],
            radiusScale: 1
        },
        route: {
            gateId: 'west-gate-01',
            pathId: 'west-figure-eight-core',
            waypoints: [
                { x: 3, y: 3 },
                { x: 4, y: 3 }
            ]
        },
        spawnSequence,
        waveId: 'corridor_eight_wave_01',
        policyId: 'corebound',
        laneOffsetTiles: 0
    });
}

function createFakeBackend(options = {}) {
    const bodies = new Map();
    const calls = [];
    const completedEventBatches = [];
    let state = options.state ?? 'gpu-ready';
    let recoveryRequired = options.recoveryRequired === true;
    let destroyCount = 0;

    return {
        bodies,
        calls,
        completedEventBatches,
        get destroyCount() {
            return destroyCount;
        },
        getCapacity() {
            return options.capacity ?? 8;
        },
        init(tileMap) {
            calls.push({ type: 'init', tileMap });
            return true;
        },
        spawnBodies(source) {
            const spawnBodies = Array.from(source);
            calls.push({ type: 'spawnBodies', bodies: spawnBodies });
            const handles = spawnBodies.map((body) => {
                const handle = Object.freeze({
                    entityId: body.entityId,
                    incarnation: body.incarnation
                });
                bodies.set(handleKey(handle), body);
                return handle;
            });
            return {
                accepted: spawnBodies.length,
                rejected: 0,
                handles,
                requiresRecovery: false
            };
        },
        despawnBodies(source) {
            const handles = Array.from(source);
            calls.push({ type: 'despawnBodies', handles });
            let removed = 0;
            for (const handle of handles) {
                removed += bodies.delete(handleKey(handle)) ? 1 : 0;
            }
            return {
                removed,
                rejected: handles.length - removed,
                requiresRecovery: false
            };
        },
        hasBody(handle) {
            return bodies.has(handleKey(handle));
        },
        hasActiveBodies() {
            return bodies.size > 0;
        },
        fixedUpdate(delta, sourceTick) {
            calls.push({ type: 'fixedUpdate', delta, sourceTick });
            return true;
        },
        drainCompletedEventBatches(out = []) {
            calls.push({ type: 'drainCompletedEventBatches' });
            out.push(...completedEventBatches.splice(0));
            return out;
        },
        updatePresentation(frame) {
            calls.push({ type: 'updatePresentation', frame });
        },
        synchronizePresentation() {
            calls.push({ type: 'synchronizePresentation' });
        },
        draw(camera) {
            calls.push({ type: 'draw', camera });
            return true;
        },
        getRuntimeState() {
            return state;
        },
        requiresRecovery() {
            return recoveryRequired;
        },
        getStatus() {
            return Object.freeze({
                state,
                bodyCount: bodies.size,
                events: Object.freeze({
                    queuedBatches: completedEventBatches.length
                }),
                marker: 'fake-backend'
            });
        },
        destroy() {
            if (destroyCount > 0) {
                return;
            }
            destroyCount++;
            calls.push({ type: 'destroy' });
            bodies.clear();
            recoveryRequired = false;
            state = 'destroyed';
        }
    };
}

test('generic endpoint 이름은 기존 enemy endpoint와 constructor identity를 공유한다', () => {
    assert.strictEqual(GpuSimulationEndpoint, GpuEnemySimulationEndpoint);

    const backend = createFakeBackend({ capacity: 3 });
    let factoryCallCount = 0;
    const endpoint = createGpuSimulationEndpoint({
        gpuSimulationBackendFactory(dependencies, options) {
            factoryCallCount++;
            assert.equal(dependencies.webGpuPlatformPort, null);
            assert.equal(options.capacity, 3);
            return backend;
        }
    }, { capacity: 3 });

    assert.equal(factoryCallCount, 1);
    assert.equal(endpoint instanceof GpuSimulationEndpoint, true);
    assert.equal(endpoint instanceof GpuEnemySimulationEndpoint, true);
    assert.strictEqual(endpoint.getBackend(), backend);
    endpoint.destroy();
});

test('GPU enemy endpoint는 lifecycle mutation을 target fixed boundary까지 보류하고 registry와 backend를 함께 확정한다', () => {
    const backend = createFakeBackend({ capacity: 4 });
    const endpoint = createGpuEnemySimulationEndpoint({
        enemySimulationBackend: backend
    });
    const tileMap = { id: 'tile-map-fixture' };

    assert.ok(endpoint instanceof GpuEnemySimulationEndpoint);
    assert.equal(endpoint.init(tileMap), true);
    assert.equal(endpoint.init(tileMap), true);
    assert.equal(
        backend.calls.filter(({ type }) => type === 'init').length,
        1
    );

    const requested = endpoint.requestSpawn(
        createSpawnIntent(),
        2,
        'endpoint:spawn:0'
    );
    assert.equal(requested.accepted, true);
    assert.equal(endpoint.getPendingCommandCount(), 1);
    assert.equal(endpoint.getRegistry().getActiveCount(), 0);
    assert.equal(endpoint.getRegistry().getReservedCount(), 0);
    assert.equal(backend.bodies.size, 0);
    assert.equal(
        backend.calls.filter(({ type }) => type === 'spawnBodies').length,
        0
    );
    const pendingStatus = endpoint.getStatus();
    assert.equal(pendingStatus.state, 'gpu-ready');
    assert.equal(pendingStatus.initialized, true);
    assert.equal(pendingStatus.activeCount, 0);
    assert.equal(pendingStatus.reservedCount, 0);
    assert.equal(pendingStatus.pendingCommandCount, 1);
    assert.equal(pendingStatus.backend.bodyCount, 0);
    assert.equal(pendingStatus.lifecycle.pendingCount, 1);
    assert.equal(pendingStatus.registry.activeCount, 0);

    const earlyCommit = endpoint.commitAtFixedBoundary(1);
    assert.equal(earlyCommit.state, 'committed');
    assert.equal(earlyCommit.spawned.length, 0);
    assert.equal(endpoint.getPendingCommandCount(), 1);
    assert.equal(endpoint.getRegistry().getActiveCount(), 0);
    assert.equal(backend.bodies.size, 0);

    const spawnCommit = endpoint.commitAtFixedBoundary(2);
    assert.equal(spawnCommit.state, 'committed');
    assert.equal(spawnCommit.spawned.length, 1);
    assert.equal(endpoint.getPendingCommandCount(), 0);
    const handle = spawnCommit.spawned[0].handle;
    assert.equal(endpoint.hasBody(handle), true);
    assert.equal(endpoint.hasActiveBodies(), true);
    assert.equal(endpoint.getRegistry().has(handle), true);
    assert.equal(endpoint.getRegistry().getActiveCount(), 1);
    assert.equal(endpoint.getRegistry().getReservedCount(), 0);
    assert.equal(backend.bodies.has(handleKey(handle)), true);
    assert.equal(backend.bodies.size, 1);
    const activeStatus = endpoint.getStatus();
    assert.equal(activeStatus.activeCount, 1);
    assert.equal(activeStatus.reservedCount, 0);
    assert.equal(activeStatus.pendingCommandCount, 0);
    assert.equal(activeStatus.recoveryRequired, false);
    assert.equal(activeStatus.backend.bodyCount, 1);
    assert.equal(activeStatus.lifecycle.pendingCount, 0);
    assert.equal(activeStatus.registry.activeCount, 1);

    const entityView = endpoint.getRegistry().copyEntityView(handle, {});
    assert.equal(entityView.kindId, 'enemy');
    assert.equal(entityView.definitionId, 'basic_circle_01');
    assert.equal(entityView.createdAtTick, 2);
    assert.equal(entityView.metadata.gateId, 'west-gate-01');
    assert.equal(entityView.metadata.pathId, 'west-figure-eight-core');

    const despawnRequested = endpoint.requestDespawn(
        handle,
        'benchmark-reset',
        4,
        'endpoint:despawn:0'
    );
    assert.equal(despawnRequested.accepted, true);
    endpoint.commitAtFixedBoundary(3);
    assert.equal(endpoint.hasBody(handle), true);
    assert.equal(endpoint.getRegistry().has(handle), true);
    assert.equal(backend.bodies.has(handleKey(handle)), true);
    assert.equal(
        backend.calls.filter(({ type }) => type === 'despawnBodies').length,
        0
    );

    const despawnCommit = endpoint.commitAtFixedBoundary(4);
    assert.equal(despawnCommit.state, 'committed');
    assert.equal(despawnCommit.despawned.length, 1);
    assert.equal(endpoint.hasBody(handle), false);
    assert.equal(endpoint.hasActiveBodies(), false);
    assert.equal(endpoint.getRegistry().has(handle), false);
    assert.equal(endpoint.getRegistry().getActiveCount(), 0);
    assert.equal(backend.bodies.size, 0);
    const despawnedStatus = endpoint.getStatus();
    assert.equal(despawnedStatus.activeCount, 0);
    assert.equal(despawnedStatus.pendingCommandCount, 0);
    assert.equal(despawnedStatus.backend.bodyCount, 0);

    endpoint.destroy();
});

test('GPU enemy endpoint는 fixed/presentation/draw/status를 위임하고 한 번만 teardown한다', () => {
    const backend = createFakeBackend({ capacity: 6 });
    let receivedBackendDependencies = null;
    let receivedBackendOptions = null;
    const endpoint = new GpuEnemySimulationEndpoint({
        enemySimulationBackendFactory(dependencies, options) {
            receivedBackendDependencies = dependencies;
            receivedBackendOptions = options;
            return backend;
        }
    }, {
        capacity: 6,
        presentationProfile:
            GPU_BODY_PRESENTATION_PROFILE.STRICT_INTERPOLATION
    });
    const tileMap = { id: 'delegation-map' };
    const presentationFrame = {
        frameDelta: 1 / 120,
        fixedDelta: 1 / 60,
        fixedAlpha: 0.5
    };
    const camera = { id: 'camera-fixture' };

    endpoint.init(tileMap);
    assert.equal(receivedBackendDependencies.webGpuPlatformPort, null);
    assert.equal(receivedBackendOptions.capacity, 6);
    assert.equal(
        receivedBackendOptions.presentationProfile,
        GPU_BODY_PRESENTATION_PROFILE.STRICT_INTERPOLATION
    );
    assert.equal(endpoint.fixedUpdate(1 / 60, 7), true);
    assert.equal(endpoint.updatePresentation(presentationFrame), undefined);
    assert.equal(endpoint.synchronizePresentation(), undefined);
    assert.equal(endpoint.draw(camera), true);
    assert.deepEqual(
        backend.calls.slice(1).map(({ type }) => type),
        [
            'fixedUpdate',
            'updatePresentation',
            'synchronizePresentation',
            'draw'
        ]
    );
    assert.equal(backend.calls[1].delta, 1 / 60);
    assert.equal(backend.calls[1].sourceTick, 7);
    assert.strictEqual(backend.calls[2].frame, presentationFrame);
    assert.strictEqual(backend.calls[4].camera, camera);

    const status = endpoint.getStatus();
    assert.equal(Object.isFrozen(status), true);
    assert.equal(status.state, 'gpu-ready');
    assert.equal(status.initialized, true);
    assert.equal(status.destroyed, false);
    assert.equal(status.capacity, 6);
    assert.equal(status.activeCount, 0);
    assert.equal(status.activeEnemyCount, 0);
    assert.equal(status.activeProjectileCount, 0);
    assert.equal(status.reservedCount, 0);
    assert.equal(status.pendingCommandCount, 0);
    assert.equal(status.recoveryRequired, false);
    assert.equal(status.backend.marker, 'fake-backend');
    assert.equal(status.events.backend.queuedBatches, 0);
    assert.equal(status.lifecycle.destroyed, false);
    assert.equal(status.registry.destroyed, false);
    assert.strictEqual(endpoint.getBackend(), backend);
    assert.equal(typeof endpoint.replaceBodies, 'undefined');
    assert.equal('replaceBodies' in endpoint, false);

    endpoint.destroy();
    endpoint.destroy();
    assert.equal(backend.destroyCount, 1);
    assert.equal(
        backend.calls.filter(({ type }) => type === 'destroy').length,
        1
    );
    assert.equal(endpoint.getRuntimeState(), 'destroyed');
    assert.equal(endpoint.hasActiveBodies(), false);
    assert.equal(endpoint.getPendingCommandCount(), 0);
    assert.equal(endpoint.requiresRecovery(), false);
    assert.equal(endpoint.draw(camera), false);
    endpoint.updatePresentation(presentationFrame);
    endpoint.synchronizePresentation();
    assert.equal(
        backend.calls.filter(({ type }) => type === 'updatePresentation').length,
        1
    );
    assert.equal(
        backend.calls.filter(({ type }) => type === 'synchronizePresentation').length,
        1
    );
    assert.equal(
        backend.calls.filter(({ type }) => type === 'draw').length,
        1
    );
    assert.equal(endpoint.getRegistry().getStatus().destroyed, true);
    assert.equal(endpoint.getLifecycleCommandOwner().getStatus().destroyed, true);

    const destroyedStatus = endpoint.getStatus();
    assert.equal(destroyedStatus.state, 'destroyed');
    assert.equal(destroyedStatus.initialized, false);
    assert.equal(destroyedStatus.destroyed, true);
    assert.equal(destroyedStatus.activeCount, 0);
    assert.equal(destroyedStatus.reservedCount, 0);
    assert.equal(destroyedStatus.pendingCommandCount, 0);
    assert.equal(destroyedStatus.recoveryRequired, false);
    assert.throws(() => endpoint.fixedUpdate(1 / 60), /destroy/);
    assert.throws(
        () => endpoint.requestSpawn(createSpawnIntent(1), 5),
        /destroy/
    );
});

test('GPU death completion은 drain 경계에서만 despawn을 예약하고 같은 target tick commit에서 제거된다', () => {
    const backend = createFakeBackend({ capacity: 4 });
    const endpoint = createGpuEnemySimulationEndpoint({
        enemySimulationBackend: backend
    });
    endpoint.init({ id: 'event-map' });
    endpoint.requestSpawn(createSpawnIntent(), 1, 'event-spawn:0');
    const spawn = endpoint.commitAtFixedBoundary(1).spawned[0].handle;

    backend.completedEventBatches.push({
        sourceTick: 1,
        submittedTick: 1,
        deviceGeneration: 7,
        completedThroughTick: 1,
        events: [{
            type: 'death',
            sequence: 3,
            entityId: spawn.entityId,
            incarnation: spawn.incarnation,
            bodyId: 0,
            reason: 1
        }]
    });

    assert.equal(endpoint.hasBody(spawn), true);
    assert.equal(endpoint.getPendingCommandCount(), 0);
    const snapshot = endpoint.commitCompletedEventsAtFixedBoundary(2);
    assert.equal(endpoint.hasBody(spawn), true);
    assert.equal(endpoint.getRegistry().has(spawn), true);
    assert.equal(endpoint.getPendingCommandCount(), 1);
    assert.equal(snapshot.deathEvents.length, 1);
    assert.equal(snapshot.deathEvents[0].disposition, 'despawn-requested');
    assert.equal(snapshot.deathEvents[0].deviceGeneration, 7);
    assert.equal(snapshot.deathEvents[0].sourceTick, 1);
    assert.equal(snapshot.deathEvents[0].sequence, 3);
    assert.equal(
        snapshot.deathEvents[0].key,
        `${endpoint.getStatus().sessionGeneration}:7:${spawn.entityId}`
            + `:${spawn.incarnation}:1:3:death`
    );
    assert.equal(
        backend.calls.filter(({ type }) => type === 'despawnBodies').length,
        0
    );

    const commit = endpoint.commitAtFixedBoundary(2);
    assert.equal(commit.despawned.length, 1);
    assert.equal(commit.despawned[0].reason, 'gpu-death');
    assert.equal(
        commit.despawned[0].commandId,
        `gpu-death:${snapshot.deathEvents[0].key}`
    );
    assert.equal(endpoint.hasBody(spawn), false);
    assert.equal(endpoint.getRegistry().has(spawn), false);
    assert.equal(endpoint.getStatus().events.death, 1);
    assert.equal(endpoint.getStatus().events.stale, 0);
    endpoint.destroy();
});

test('GPU completion은 stale incarnation과 exact duplicate를 안전하게 억제한다', () => {
    const backend = createFakeBackend({ capacity: 4 });
    const endpoint = createGpuEnemySimulationEndpoint({
        enemySimulationBackend: backend
    });
    endpoint.init({ id: 'dedupe-map' });
    endpoint.requestSpawn(createSpawnIntent(), 1, 'dedupe-spawn:0');
    const firstHandle = endpoint.commitAtFixedBoundary(1).spawned[0].handle;
    endpoint.requestDespawn(firstHandle, 'fixture-recycle', 2, 'dedupe-remove:0');
    endpoint.commitAtFixedBoundary(2);
    endpoint.requestSpawn(createSpawnIntent(1), 3, 'dedupe-spawn:1');
    const currentHandle = endpoint.commitAtFixedBoundary(3).spawned[0].handle;
    assert.equal(currentHandle.entityId, firstHandle.entityId);
    assert.ok(currentHandle.incarnation > firstHandle.incarnation);

    backend.completedEventBatches.push({
        sourceTick: 2,
        deviceGeneration: 4,
        completedThroughTick: 2,
        events: [{
            type: 'death',
            sequence: 9,
            entityId: firstHandle.entityId,
            incarnation: firstHandle.incarnation,
            bodyId: 0,
            reason: 1
        }]
    }, {
        sourceTick: 3,
        deviceGeneration: 4,
        completedThroughTick: 3,
        events: [{
            type: 'death',
            sequence: 10,
            entityId: currentHandle.entityId,
            incarnation: currentHandle.incarnation,
            bodyId: 0,
            reason: 1
        }, {
            type: 'death',
            sequence: 10,
            entityId: currentHandle.entityId,
            incarnation: currentHandle.incarnation,
            bodyId: 0,
            reason: 1
        }]
    });

    const snapshot = endpoint.commitCompletedEventsAtFixedBoundary(4);
    assert.equal(snapshot.deathEvents.length, 3);
    assert.deepEqual(
        Array.from(snapshot.deathEvents, ({ disposition }) => disposition),
        ['stale', 'despawn-requested', 'duplicate']
    );
    assert.equal(endpoint.getPendingCommandCount(), 1);
    assert.equal(endpoint.hasBody(currentHandle), true);
    const status = endpoint.getStatus();
    assert.equal(status.events.death, 2);
    assert.equal(status.events.stale, 1);
    assert.equal(status.events.deduped, 1);

    const commit = endpoint.commitAtFixedBoundary(4);
    assert.equal(commit.despawned.length, 1);
    assert.equal(endpoint.hasBody(currentHandle), false);
    endpoint.destroy();
});

test('event가 없는 GPU completion도 completedThroughTick watermark와 최신 빈 snapshot을 전진시킨다', () => {
    const backend = createFakeBackend({ capacity: 2 });
    const endpoint = createGpuEnemySimulationEndpoint({
        enemySimulationBackend: backend
    }, {
        completedEventSnapshotCapacity: 1,
        completedEventKeyHistoryCapacity: 2
    });
    endpoint.init({ id: 'watermark-map' });
    backend.completedEventBatches.push({
        sourceTick: 8,
        submittedTick: 8,
        deviceGeneration: 11,
        completedThroughTick: 8,
        events: []
    });

    const snapshot = endpoint.commitCompletedEventsAtFixedBoundary(9);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(snapshot.targetFixedTick, 9);
    assert.equal(snapshot.completedThroughTick, 8);
    assert.equal(snapshot.batchCount, 1);
    assert.equal(snapshot.events.length, 0);
    assert.equal(endpoint.getLastCompletedSimulationEvents(), snapshot);
    assert.equal(endpoint.getStatus().completedThroughTick, 8);
    assert.equal(endpoint.getStatus().events.completedThroughTick, 8);
    assert.equal(endpoint.getPendingCommandCount(), 0);
    endpoint.destroy();
});

test('event dedupe key는 같은 tick/sequence라도 exact entity incarnation을 구분한다', () => {
    const backend = createFakeBackend({ capacity: 2 });
    const endpoint = createGpuEnemySimulationEndpoint({
        enemySimulationBackend: backend
    });
    endpoint.init({ id: 'exact-event-identity-map' });
    backend.completedEventBatches.push({
        sourceTick: 12,
        deviceGeneration: 3,
        completedThroughTick: 12,
        events: [{
            type: 'contact',
            sequence: 5,
            entityId: 41,
            incarnation: 1,
            damageFixedPoint: 25
        }, {
            type: 'contact',
            sequence: 5,
            entityId: 41,
            incarnation: 2,
            damageFixedPoint: 25
        }, {
            type: 'contact',
            sequence: 5,
            entityId: 41,
            incarnation: 2,
            damageFixedPoint: 25
        }]
    });

    const snapshot = endpoint.commitCompletedEventsAtFixedBoundary(13);
    assert.deepEqual(
        Array.from(snapshot.contactEvents, ({ disposition }) => disposition),
        ['applied', 'applied', 'duplicate']
    );
    assert.notEqual(
        snapshot.contactEvents[0].key,
        snapshot.contactEvents[1].key
    );
    assert.equal(
        snapshot.contactEvents[1].key,
        snapshot.contactEvents[2].key
    );
    assert.equal(endpoint.getStatus().events.applied, 2);
    assert.equal(endpoint.getStatus().events.deduped, 1);
    endpoint.destroy();
});
