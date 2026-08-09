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
const {
    GPU_CIRCLE_APPLIED_EVENT_FLAG
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');

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
    let eventProtocolState = options.eventProtocolState ?? null;

    return {
        bodies,
        calls,
        completedEventBatches,
        setEventProtocolState(next) {
            eventProtocolState = next === null ? null : Object.freeze({ ...next });
        },
        getEventProtocolState() {
            return eventProtocolState;
        },
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
        canControlBody(handle) {
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
                ...(eventProtocolState ?? {}),
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

function setCurrentEventProtocol(endpoint, backend, overrides = {}) {
    const protocol = Object.freeze({
        sessionGeneration: endpoint.getStatus().sessionGeneration,
        deviceGeneration: overrides.deviceGeneration ?? 1,
        authoritativeEpoch: overrides.authoritativeEpoch ?? 1
    });
    backend.setEventProtocolState(protocol);
    return protocol;
}

function createCompletedBatch(protocol, overrides = {}) {
    return {
        sessionGeneration: protocol.sessionGeneration,
        deviceGeneration: protocol.deviceGeneration,
        authoritativeEpoch: protocol.authoritativeEpoch,
        previousSourceTick: overrides.previousSourceTick ?? 0,
        previousSubmittedTick: overrides.previousSubmittedTick ?? 0,
        sourceTick: overrides.sourceTick ?? 1,
        submittedTick: overrides.submittedTick ?? overrides.sourceTick ?? 1,
        completedThroughTick:
            overrides.completedThroughTick ?? overrides.sourceTick ?? 1,
        events: overrides.events ?? [],
        ...overrides
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

test('endpoint는 body capacity와 256 상한으로 Effect capacity를 한 번 resolve해 backend와 owner에 공유한다', () => {
    const backend = createFakeBackend({ capacity: 300 });
    let receivedOptions = null;
    const endpoint = createGpuSimulationEndpoint({
        gpuSimulationBackendFactory(_dependencies, options) {
            receivedOptions = options;
            return backend;
        }
    }, { capacity: 300 });

    assert.equal(receivedOptions.capacity, 300);
    assert.equal(receivedOptions.effectCommandCapacity, 256);
    const status = endpoint.getStatus();
    assert.equal(status.effectCommandCapacity, 256);
    assert.equal(status.effectCommands.capacity, 256);
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

test('generic GPU endpoint는 atomic spawn batch ingress를 lifecycle owner에 위임한다', () => {
    const backend = createFakeBackend({ capacity: 4 });
    const endpoint = createGpuSimulationEndpoint({
        gpuSimulationBackend: backend
    });
    endpoint.init({ id: 'batch-ingress-map' });

    const requested = endpoint.requestSpawnBatch([
        {
            intent: createSpawnIntent(10),
            targetFixedTick: 1,
            commandId: 'endpoint:batch:0'
        },
        {
            intent: createSpawnIntent(11),
            targetFixedTick: 1,
            commandId: 'endpoint:batch:1'
        }
    ]);
    assert.deepEqual({ ...requested }, {
        accepted: true,
        requestedCount: 2,
        queuedCount: 2
    });
    assert.equal(endpoint.getPendingCommandCount(), 2);

    const duplicate = endpoint.requestSpawnBatch([
        {
            intent: createSpawnIntent(12),
            targetFixedTick: 1,
            commandId: 'endpoint:batch:duplicate'
        },
        {
            intent: createSpawnIntent(13),
            targetFixedTick: 1,
            commandId: 'endpoint:batch:duplicate'
        }
    ]);
    assert.deepEqual({ ...duplicate }, {
        accepted: false,
        requestedCount: 2,
        queuedCount: 0,
        reason: 'duplicate-command'
    });
    assert.equal(endpoint.getPendingCommandCount(), 2);

    const committed = endpoint.commitAtFixedBoundary(1);
    assert.equal(committed.state, 'committed');
    assert.equal(committed.spawned.length, 2);
    assert.equal(endpoint.getPendingCommandCount(), 0);
    assert.deepEqual(
        backend.calls
            .filter(({ type }) => type === 'spawnBodies')[0]
            .bodies
            .map(({ spawnSequence }) => spawnSequence),
        [10, 11]
    );
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

test('GPU death completion은 검증된 envelope drain 경계에서만 despawn을 예약한다', () => {
    const backend = createFakeBackend({ capacity: 4 });
    const endpoint = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend });
    endpoint.init({ id: 'event-map' });
    endpoint.requestSpawn(createSpawnIntent(), 1, 'event-spawn:0');
    const spawn = endpoint.commitAtFixedBoundary(1).spawned[0].handle;
    const protocol = setCurrentEventProtocol(endpoint, backend, {
        deviceGeneration: 7,
        authoritativeEpoch: 2
    });

    backend.completedEventBatches.push(createCompletedBatch(protocol, {
        sourceTick: 1,
        submittedTick: 1,
        events: [{
            type: 'death',
            eventType: 'death',
            sequence: 0,
            entityId: spawn.entityId,
            incarnation: spawn.incarnation,
            bodyId: 0,
            reasonFlags: 1
        }]
    }));

    const snapshot = endpoint.commitCompletedEventsAtFixedBoundary(2);
    assert.equal(endpoint.hasBody(spawn), true);
    assert.equal(endpoint.getPendingCommandCount(), 1);
    assert.equal(snapshot.deathEvents.length, 1);
    assert.equal(snapshot.deathEvents[0].disposition, 'despawn-requested');
    assert.equal(snapshot.deathEvents[0].authoritativeEpoch, 2);
    assert.equal(
        snapshot.deathEvents[0].key,
        `${protocol.sessionGeneration}:7:2:${spawn.entityId}`
            + `:${spawn.incarnation}:1:0:death`
    );
    assert.equal(
        backend.calls.filter(({ type }) => type === 'despawnBodies').length,
        0
    );

    const commit = endpoint.commitAtFixedBoundary(2);
    assert.equal(commit.despawned.length, 1);
    assert.equal(commit.despawned[0].reason, 'gpu-death');
    assert.equal(commit.despawned[0].commandId, `gpu-death:${snapshot.deathEvents[0].key}`);
    assert.equal(endpoint.hasBody(spawn), false);
    assert.equal(endpoint.getStatus().events.death, 1);
    endpoint.destroy();
});

test('stale incarnation은 폐기하고 같은 batch의 exact duplicate만 dedupe한다', () => {
    const backend = createFakeBackend({ capacity: 4 });
    const endpoint = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend });
    endpoint.init({ id: 'dedupe-map' });
    endpoint.requestSpawn(createSpawnIntent(), 1, 'dedupe-spawn:0');
    const firstHandle = endpoint.commitAtFixedBoundary(1).spawned[0].handle;
    endpoint.requestDespawn(firstHandle, 'fixture-recycle', 2, 'dedupe-remove:0');
    endpoint.commitAtFixedBoundary(2);
    endpoint.requestSpawn(createSpawnIntent(1), 3, 'dedupe-spawn:1');
    const currentHandle = endpoint.commitAtFixedBoundary(3).spawned[0].handle;
    const protocol = setCurrentEventProtocol(endpoint, backend, {
        deviceGeneration: 4,
        authoritativeEpoch: 3
    });

    const staleDeath = {
        type: 'death', eventType: 'death', sequence: 0,
        entityId: firstHandle.entityId, incarnation: firstHandle.incarnation,
        bodyId: 0, reasonFlags: 1
    };
    const currentDeath = {
        type: 'death', eventType: 'death', sequence: 0,
        entityId: currentHandle.entityId, incarnation: currentHandle.incarnation,
        bodyId: 0, reasonFlags: 1
    };
    backend.completedEventBatches.push(
        createCompletedBatch(protocol, {
            sourceTick: 2,
            submittedTick: 2,
            events: [staleDeath]
        }),
        createCompletedBatch(protocol, {
            sourceTick: 3,
            submittedTick: 3,
            previousSourceTick: 2,
            previousSubmittedTick: 2,
            events: [currentDeath, { ...currentDeath }]
        })
    );

    const snapshot = endpoint.commitCompletedEventsAtFixedBoundary(4);
    assert.deepEqual(
        Array.from(snapshot.deathEvents, ({ disposition }) => disposition),
        ['stale', 'despawn-requested', 'duplicate']
    );
    assert.equal(endpoint.getPendingCommandCount(), 1);
    assert.equal(endpoint.getStatus().events.death, 1);
    assert.equal(endpoint.getStatus().events.stale, 1);
    assert.equal(endpoint.getStatus().events.deduped, 1);
    assert.equal(endpoint.commitAtFixedBoundary(4).despawned.length, 1);
    endpoint.destroy();
});

test('event가 없는 completion도 완전한 envelope에서만 watermark를 전진시킨다', () => {
    const backend = createFakeBackend({ capacity: 2 });
    const endpoint = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend }, {
        completedEventSnapshotCapacity: 1,
        completedEventKeyHistoryCapacity: 2
    });
    endpoint.init({ id: 'watermark-map' });
    const protocol = setCurrentEventProtocol(endpoint, backend, {
        deviceGeneration: 11,
        authoritativeEpoch: 4
    });
    backend.completedEventBatches.push(createCompletedBatch(protocol, {
        sourceTick: 8,
        submittedTick: 8
    }));

    const snapshot = endpoint.commitCompletedEventsAtFixedBoundary(9);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(snapshot.completedThroughTick, 8);
    assert.equal(snapshot.batchCount, 1);
    assert.equal(snapshot.events.length, 0);
    assert.equal(endpoint.getStatus().events.completedThroughTick, 8);
    assert.equal(endpoint.requiresRecovery(), false);
    endpoint.destroy();
});

test('typed interaction event 방향과 exact duplicate key는 body 배열 순서와 독립적이다', () => {
    const backend = createFakeBackend({ capacity: 4 });
    const endpoint = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend });
    endpoint.init({ id: 'typed-event-map' });
    endpoint.requestSpawn(createSpawnIntent(0), 1, 'typed-spawn:0');
    endpoint.requestSpawn(createSpawnIntent(1), 1, 'typed-spawn:1');
    const [subject, other] = endpoint.commitAtFixedBoundary(1).spawned.map(({ handle }) => handle);
    const protocol = setCurrentEventProtocol(endpoint, backend, {
        deviceGeneration: 3,
        authoritativeEpoch: 5
    });
    const reverseEvent = {
        type: 'contact', eventType: 'interaction-enter', sequence: 1,
        entityId: other.entityId, incarnation: other.incarnation,
        otherEntityId: subject.entityId, otherIncarnation: subject.incarnation,
        valueFixedPoint: 0
    };
    backend.completedEventBatches.push(createCompletedBatch(protocol, {
        sourceTick: 1,
        submittedTick: 1,
        events: [{
            type: 'contact', eventType: 'interaction-enter', sequence: 0,
            entityId: subject.entityId, incarnation: subject.incarnation,
            otherEntityId: other.entityId, otherIncarnation: other.incarnation,
            valueFixedPoint: 0
        }, reverseEvent, { ...reverseEvent }]
    }));

    const snapshot = endpoint.commitCompletedEventsAtFixedBoundary(2);
    assert.deepEqual(
        Array.from(snapshot.contactEvents, ({ disposition }) => disposition),
        ['applied', 'applied', 'duplicate']
    );
    assert.equal(snapshot.contactEvents[0].eventType, 'interaction-enter');
    assert.equal(snapshot.contactEvents[0].valueFixedPoint, 0);
    assert.notEqual(snapshot.contactEvents[0].key, snapshot.contactEvents[1].key);
    assert.equal(snapshot.contactEvents[1].key, snapshot.contactEvents[2].key);
    endpoint.destroy();
});

test('Maximum Damage Window zero-value damage event는 marker/flag 일치 시에만 정규화한다', () => {
    const createEndpointWithPair = (label) => {
        const backend = createFakeBackend({ capacity: 4 });
        const endpoint = createGpuEnemySimulationEndpoint({
            enemySimulationBackend: backend
        });
        endpoint.init({ id: `maximum-damage-window-${label}` });
        endpoint.requestSpawn(createSpawnIntent(0), 1, `${label}:spawn:0`);
        endpoint.requestSpawn(createSpawnIntent(1), 1, `${label}:spawn:1`);
        const [subject, other] = endpoint.commitAtFixedBoundary(1)
            .spawned.map(({ handle }) => handle);
        return {
            backend,
            endpoint,
            protocol: setCurrentEventProtocol(endpoint, backend),
            subject,
            other
        };
    };
    const maximumDamageWindowFlags = GPU_CIRCLE_APPLIED_EVENT_FLAG.CONTINUOUS_POLICY
        | GPU_CIRCLE_APPLIED_EVENT_FLAG.MAXIMUM_DAMAGE_WINDOW;
    const valid = createEndpointWithPair('valid');
    valid.backend.completedEventBatches.push(createCompletedBatch(valid.protocol, {
        sourceTick: 1,
        submittedTick: 1,
        events: [{
            type: 'contact',
            eventType: 'damage-applied',
            sequence: 0,
            entityId: valid.subject.entityId,
            incarnation: valid.subject.incarnation,
            otherEntityId: valid.other.entityId,
            otherIncarnation: valid.other.incarnation,
            valueFixedPoint: 0,
            flags: maximumDamageWindowFlags,
            maximumDamageWindow: true
        }]
    }));
    const validSnapshot = valid.endpoint.commitCompletedEventsAtFixedBoundary(2);
    assert.equal(validSnapshot.protocolFailure, null);
    assert.equal(validSnapshot.contactEvents.length, 1);
    assert.equal(validSnapshot.contactEvents[0].eventType, 'damage-applied');
    assert.equal(validSnapshot.contactEvents[0].valueFixedPoint, 0);
    assert.equal(validSnapshot.contactEvents[0].damageFixedPoint, 0);
    assert.equal(validSnapshot.contactEvents[0].maximumDamageWindow, true);
    assert.equal(validSnapshot.contactEvents[0].flags, maximumDamageWindowFlags);
    assert.equal(valid.endpoint.requiresRecovery(), false);
    valid.endpoint.destroy();

    const assertRejected = (label, overrides) => {
        const fixture = createEndpointWithPair(label);
        fixture.backend.completedEventBatches.push(createCompletedBatch(fixture.protocol, {
            sourceTick: 1,
            submittedTick: 1,
            events: [{
                type: 'contact',
                eventType: 'damage-applied',
                sequence: 0,
                entityId: fixture.subject.entityId,
                incarnation: fixture.subject.incarnation,
                otherEntityId: fixture.other.entityId,
                otherIncarnation: fixture.other.incarnation,
                valueFixedPoint: 0,
                flags: maximumDamageWindowFlags,
                maximumDamageWindow: true,
                ...overrides
            }]
        }));
        const snapshot = fixture.endpoint.commitCompletedEventsAtFixedBoundary(2);
        assert.equal(snapshot.events.length, 0, label);
        assert.equal(snapshot.protocolFailure?.code, 'event-contract', label);
        assert.equal(fixture.endpoint.requiresRecovery(), true, label);
        fixture.endpoint.destroy();
    };

    assertRejected('direct-zero', {
        flags: GPU_CIRCLE_APPLIED_EVENT_FLAG.CONTINUOUS_POLICY,
        maximumDamageWindow: false
    });
    assertRejected('negative-window', { valueFixedPoint: -1 });
    assertRejected('spoofed-marker', {
        flags: GPU_CIRCLE_APPLIED_EVENT_FLAG.CONTINUOUS_POLICY
    });
    assertRejected('inconsistent-marker', { maximumDamageWindow: false });
    assertRejected('non-damage-window', {
        eventType: 'interaction-continuous'
    });
});

test('sequence gap과 conflicting duplicate는 watermark/side effect 없이 recovery를 latch한다', () => {
    const backend = createFakeBackend({ capacity: 2 });
    const endpoint = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend });
    endpoint.init({ id: 'sequence-gap-map' });
    endpoint.requestSpawn(createSpawnIntent(), 1, 'sequence-spawn:0');
    const handle = endpoint.commitAtFixedBoundary(1).spawned[0].handle;
    const protocol = setCurrentEventProtocol(endpoint, backend);
    backend.completedEventBatches.push(createCompletedBatch(protocol, {
        sourceTick: 1,
        events: [{
            type: 'death', eventType: 'death', sequence: 1,
            entityId: handle.entityId, incarnation: handle.incarnation,
            bodyId: 0, reasonFlags: 1
        }]
    }));

    const snapshot = endpoint.commitCompletedEventsAtFixedBoundary(2);
    assert.equal(snapshot.events.length, 0);
    assert.equal(snapshot.completedThroughTick, 0);
    assert.equal(snapshot.protocolFailure.code, 'sequence-gap');
    assert.equal(endpoint.getPendingCommandCount(), 0);
    assert.equal(endpoint.requiresRecovery(), true);
    endpoint.destroy();
});

test('noncontiguous batch와 incomplete watermark는 prefix 전체를 fail-closed 한다', () => {
    const backend = createFakeBackend({ capacity: 4 });
    const endpoint = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend });
    endpoint.init({ id: 'batch-gap-map' });
    const protocol = setCurrentEventProtocol(endpoint, backend);
    backend.completedEventBatches.push(
        createCompletedBatch(protocol, { sourceTick: 1, submittedTick: 1 }),
        createCompletedBatch(protocol, {
            previousSourceTick: 2,
            previousSubmittedTick: 2,
            sourceTick: 3,
            submittedTick: 3
        })
    );

    const snapshot = endpoint.commitCompletedEventsAtFixedBoundary(4);
    assert.equal(snapshot.completedThroughTick, 0);
    assert.equal(snapshot.batchCount, 0);
    assert.equal(snapshot.protocolFailure.code, 'batch-gap');
    assert.equal(endpoint.requiresRecovery(), true);
    endpoint.destroy();

    const backend2 = createFakeBackend({ capacity: 2 });
    const endpoint2 = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend2 });
    endpoint2.init({ id: 'watermark-gap-map' });
    const protocol2 = setCurrentEventProtocol(endpoint2, backend2);
    backend2.completedEventBatches.push(createCompletedBatch(protocol2, {
        sourceTick: 1,
        submittedTick: 1,
        completedThroughTick: 2
    }));
    const incomplete = endpoint2.commitCompletedEventsAtFixedBoundary(3);
    assert.equal(incomplete.completedThroughTick, 0);
    assert.equal(incomplete.protocolFailure.code, 'watermark-gap');
    assert.equal(endpoint2.requiresRecovery(), true);
    endpoint2.destroy();
});

test('old generation/epoch은 폐기하고 future tick은 해당 fixed 경계까지 보류한다', () => {
    const backend = createFakeBackend({ capacity: 2 });
    const endpoint = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend });
    endpoint.init({ id: 'generation-future-map' });
    const protocol = setCurrentEventProtocol(endpoint, backend, {
        deviceGeneration: 5,
        authoritativeEpoch: 7
    });
    backend.completedEventBatches.push(createCompletedBatch(protocol, {
        deviceGeneration: 4,
        authoritativeEpoch: 6,
        sourceTick: 1,
        events: [{
            type: 'death', eventType: 'death', sequence: 0,
            entityId: 99, incarnation: 1, bodyId: 0, reasonFlags: 1
        }]
    }));
    const stale = endpoint.commitCompletedEventsAtFixedBoundary(2);
    assert.equal(stale.events.length, 0);
    assert.equal(stale.completedThroughTick, 0);
    assert.equal(endpoint.getStatus().events.stale, 1);
    assert.equal(endpoint.requiresRecovery(), false);

    backend.completedEventBatches.push(createCompletedBatch(protocol, {
        sourceTick: 5,
        submittedTick: 5
    }));
    const early = endpoint.commitCompletedEventsAtFixedBoundary(5);
    assert.equal(early.batchCount, 0);
    assert.equal(early.completedThroughTick, 0);
    assert.equal(endpoint.getStatus().events.deferredBatchCount, 1);
    const due = endpoint.commitCompletedEventsAtFixedBoundary(6);
    assert.equal(due.batchCount, 1);
    assert.equal(due.completedThroughTick, 5);
    endpoint.destroy();
});

test('generation mismatch와 bounded snapshot overflow는 어떤 event도 부분 적용하지 않는다', () => {
    const backend = createFakeBackend({ capacity: 4 });
    const endpoint = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend });
    endpoint.init({ id: 'generation-mismatch-map' });
    const protocol = setCurrentEventProtocol(endpoint, backend, {
        deviceGeneration: 2,
        authoritativeEpoch: 2
    });
    backend.completedEventBatches.push(createCompletedBatch(protocol, {
        deviceGeneration: 3,
        sourceTick: 1
    }));
    const mismatch = endpoint.commitCompletedEventsAtFixedBoundary(2);
    assert.equal(mismatch.protocolFailure.code, 'generation-mismatch');
    assert.equal(mismatch.completedThroughTick, 0);
    assert.equal(endpoint.requiresRecovery(), true);
    assert.equal(endpoint.getStatus().events.deferredBatchCount, 0);
    for (let sourceTick = 2; sourceTick <= 5; sourceTick++) {
        backend.completedEventBatches.push(createCompletedBatch(protocol, {
            sourceTick,
            submittedTick: sourceTick
        }));
        const afterFailure = endpoint.commitCompletedEventsAtFixedBoundary(
            sourceTick + 1
        );
        assert.equal(afterFailure.protocolFailure.code, 'generation-mismatch');
        assert.equal(endpoint.getStatus().events.deferredBatchCount, 0);
    }
    endpoint.destroy();

    const backend2 = createFakeBackend({ capacity: 4 });
    const endpoint2 = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend2 }, {
        completedEventSnapshotCapacity: 1
    });
    endpoint2.init({ id: 'snapshot-overflow-map' });
    endpoint2.requestSpawn(createSpawnIntent(0), 1, 'overflow-spawn:0');
    endpoint2.requestSpawn(createSpawnIntent(1), 1, 'overflow-spawn:1');
    const [left, right] = endpoint2.commitAtFixedBoundary(1).spawned.map(({ handle }) => handle);
    const protocol2 = setCurrentEventProtocol(endpoint2, backend2);
    backend2.completedEventBatches.push(createCompletedBatch(protocol2, {
        sourceTick: 1,
        events: [left, right].map((handle, sequence) => ({
            type: 'contact', eventType: 'interaction-enter', sequence,
            entityId: handle.entityId, incarnation: handle.incarnation,
            valueFixedPoint: 0
        }))
    }));
    const overflow = endpoint2.commitCompletedEventsAtFixedBoundary(2);
    assert.equal(overflow.protocolFailure.code, 'snapshot-capacity');
    assert.equal(overflow.events.length, 0);
    assert.equal(overflow.completedThroughTick, 0);
    assert.equal(endpoint2.getPendingCommandCount(), 0);
    assert.equal(endpoint2.requiresRecovery(), true);
    endpoint2.destroy();
});

test('lower drain 내부 idle epoch 전환은 방금 완료된 batch를 stale로 만들지 않는다', () => {
    const backend = createFakeBackend({ capacity: 2 });
    const endpoint = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend });
    endpoint.init({ id: 'drain-epoch-map' });
    const protocol = setCurrentEventProtocol(endpoint, backend, {
        deviceGeneration: 6,
        authoritativeEpoch: 9
    });
    backend.completedEventBatches.push(createCompletedBatch(protocol, {
        sourceTick: 1,
        submittedTick: 1
    }));
    const drain = backend.drainCompletedEventBatches;
    backend.drainCompletedEventBatches = (out) => {
        const result = drain(out);
        backend.setEventProtocolState({
            ...protocol,
            authoritativeEpoch: protocol.authoritativeEpoch + 1
        });
        return result;
    };

    const snapshot = endpoint.commitCompletedEventsAtFixedBoundary(2);
    assert.equal(snapshot.protocolFailure, null);
    assert.equal(snapshot.batchCount, 1);
    assert.equal(snapshot.completedThroughTick, 1);
    assert.equal(endpoint.getStatus().events.stale, 0);
    assert.equal(endpoint.requiresRecovery(), false);
    endpoint.destroy();
});

test('sparse event batch predecessor chain은 drain timing과 무관하게 같은 watermark를 만든다', () => {
    const run = (splitDrain) => {
        const backend = createFakeBackend({ capacity: 2 });
        const endpoint = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend });
        endpoint.init({ id: `sparse-${splitDrain ? 'split' : 'joined'}-map` });
        const protocol = setCurrentEventProtocol(endpoint, backend);
        backend.completedEventBatches.push(createCompletedBatch(protocol, {
            sourceTick: 1,
            submittedTick: 1,
            completedThroughTick: splitDrain ? 1 : 3
        }));
        if (splitDrain) {
            const first = endpoint.commitCompletedEventsAtFixedBoundary(4);
            assert.equal(first.completedThroughTick, 1);
            assert.equal(first.protocolFailure, null);
        }
        backend.completedEventBatches.push(createCompletedBatch(protocol, {
            previousSourceTick: 1,
            previousSubmittedTick: 1,
            sourceTick: 3,
            submittedTick: 3,
            completedThroughTick: 3
        }));
        const completed = endpoint.commitCompletedEventsAtFixedBoundary(4);
        const result = {
            completedThroughTick: completed.completedThroughTick,
            recoveryRequired: endpoint.requiresRecovery()
        };
        endpoint.destroy();
        return result;
    };

    assert.deepEqual(run(false), run(true));
    assert.deepEqual(run(false), {
        completedThroughTick: 3,
        recoveryRequired: false
    });
});

test('backend protocol session mismatch는 실패하고 hierarchical old generation envelope는 stale drop한다', () => {
    const bootstrap = createGpuEnemySimulationEndpoint({
        enemySimulationBackend: createFakeBackend({ capacity: 1 })
    });
    bootstrap.destroy();

    const backend = createFakeBackend({ capacity: 2 });
    const endpoint = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend });
    endpoint.init({ id: 'protocol-session-mismatch-map' });
    const sessionGeneration = endpoint.getStatus().sessionGeneration;
    const staleProtocol = {
        sessionGeneration: sessionGeneration - 1,
        deviceGeneration: 1,
        authoritativeEpoch: 1
    };
    backend.setEventProtocolState(staleProtocol);
    backend.completedEventBatches.push(createCompletedBatch(staleProtocol));
    const mismatch = endpoint.commitCompletedEventsAtFixedBoundary(2);
    assert.equal(mismatch.protocolFailure.code, 'generation-mismatch');
    assert.equal(endpoint.getStatus().events.stale, 0);
    endpoint.destroy();

    const backend2 = createFakeBackend({ capacity: 2 });
    const endpoint2 = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend2 });
    endpoint2.init({ id: 'mixed-generation-map' });
    const protocol2 = setCurrentEventProtocol(endpoint2, backend2, {
        deviceGeneration: 3,
        authoritativeEpoch: 3
    });
    backend2.completedEventBatches.push(createCompletedBatch(protocol2, {
        deviceGeneration: 2,
        authoritativeEpoch: 4,
        events: [{
            type: 'death', eventType: 'death', sequence: 0,
            entityId: 90, incarnation: 1, bodyId: 0, reasonFlags: 1
        }]
    }));
    backend2.completedEventBatches.push(createCompletedBatch(protocol2, {
        sessionGeneration: protocol2.sessionGeneration - 1,
        deviceGeneration: 999,
        authoritativeEpoch: 999,
        events: [{
            type: 'death', eventType: 'death', sequence: 0,
            entityId: 91, incarnation: 1, bodyId: 0, reasonFlags: 1
        }]
    }));
    const mixed = endpoint2.commitCompletedEventsAtFixedBoundary(2);
    assert.equal(mixed.protocolFailure, null);
    assert.equal(mixed.events.length, 0);
    assert.equal(endpoint2.getStatus().events.stale, 2);
    assert.equal(endpoint2.requiresRecovery(), false);
    endpoint2.destroy();
});

test('새 authoritative epoch의 predecessor chain은 0에서 다시 시작한다', () => {
    const backend = createFakeBackend({ capacity: 2 });
    const endpoint = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend });
    endpoint.init({ id: 'event-stream-epoch-map' });
    const firstProtocol = setCurrentEventProtocol(endpoint, backend, {
        deviceGeneration: 4,
        authoritativeEpoch: 1
    });
    backend.completedEventBatches.push(createCompletedBatch(firstProtocol, {
        sourceTick: 10,
        submittedTick: 1
    }));
    assert.equal(
        endpoint.commitCompletedEventsAtFixedBoundary(11).completedThroughTick,
        10
    );

    const secondProtocol = setCurrentEventProtocol(endpoint, backend, {
        deviceGeneration: 4,
        authoritativeEpoch: 2
    });
    backend.completedEventBatches.push(createCompletedBatch(secondProtocol, {
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 12,
        submittedTick: 2
    }));
    const restarted = endpoint.commitCompletedEventsAtFixedBoundary(13);
    assert.equal(restarted.protocolFailure, null);
    assert.equal(restarted.completedThroughTick, 12);
    assert.equal(endpoint.requiresRecovery(), false);
    endpoint.destroy();
});

test('future batch는 drain 당시 protocol provenance로 due 경계까지 보존된다', () => {
    const backend = createFakeBackend({ capacity: 2 });
    const endpoint = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend });
    endpoint.init({ id: 'future-provenance-map' });
    const protocol = setCurrentEventProtocol(endpoint, backend, {
        deviceGeneration: 7,
        authoritativeEpoch: 9
    });
    backend.completedEventBatches.push(createCompletedBatch(protocol, {
        sourceTick: 5,
        submittedTick: 1
    }));
    const drain = backend.drainCompletedEventBatches;
    backend.drainCompletedEventBatches = (out) => {
        const result = drain(out);
        backend.setEventProtocolState({
            ...protocol,
            authoritativeEpoch: protocol.authoritativeEpoch + 1
        });
        return result;
    };

    const early = endpoint.commitCompletedEventsAtFixedBoundary(5);
    assert.equal(early.batchCount, 0);
    assert.equal(endpoint.getStatus().events.deferredBatchCount, 1);
    const due = endpoint.commitCompletedEventsAtFixedBoundary(6);
    assert.equal(due.protocolFailure, null);
    assert.equal(due.completedThroughTick, 5);
    assert.equal(endpoint.requiresRecovery(), false);
    endpoint.destroy();
});

test('zero-event batch replay는 exact envelope만 dedupe하고 변조는 fail-closed 한다', () => {
    const backend = createFakeBackend({ capacity: 2 });
    const endpoint = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend });
    endpoint.init({ id: 'batch-replay-map' });
    const protocol = setCurrentEventProtocol(endpoint, backend);
    const original = createCompletedBatch(protocol, {
        sourceTick: 1,
        submittedTick: 1,
        completedThroughTick: 1
    });
    backend.completedEventBatches.push(original);
    assert.equal(
        endpoint.commitCompletedEventsAtFixedBoundary(2).completedThroughTick,
        1
    );

    backend.completedEventBatches.push({ ...original });
    const replay = endpoint.commitCompletedEventsAtFixedBoundary(2);
    assert.equal(replay.protocolFailure, null);
    assert.equal(replay.completedThroughTick, 1);
    assert.equal(endpoint.requiresRecovery(), false);

    backend.completedEventBatches.push({
        ...original,
        completedThroughTick: 2
    });
    const corrupted = endpoint.commitCompletedEventsAtFixedBoundary(3);
    assert.equal(corrupted.protocolFailure.code, 'duplicate-batch-conflict');
    assert.equal(corrupted.completedThroughTick, 1);
    assert.equal(endpoint.requiresRecovery(), true);
    endpoint.destroy();
});

test('동일 future batch가 두 번 defer돼도 due prepare 안에서 exact dedupe한다', () => {
    const backend = createFakeBackend({ capacity: 2 });
    const endpoint = createGpuEnemySimulationEndpoint({ enemySimulationBackend: backend });
    endpoint.init({ id: 'future-replay-map' });
    const protocol = setCurrentEventProtocol(endpoint, backend);
    const future = createCompletedBatch(protocol, {
        sourceTick: 5,
        submittedTick: 1,
        completedThroughTick: 5
    });
    backend.completedEventBatches.push(future);
    assert.equal(
        endpoint.commitCompletedEventsAtFixedBoundary(5).protocolFailure,
        null
    );
    backend.completedEventBatches.push({ ...future });
    assert.equal(
        endpoint.commitCompletedEventsAtFixedBoundary(5).protocolFailure,
        null
    );

    const due = endpoint.commitCompletedEventsAtFixedBoundary(6);
    assert.equal(due.protocolFailure, null);
    assert.equal(due.completedThroughTick, 5);
    assert.equal(endpoint.requiresRecovery(), false);
    endpoint.destroy();
});

test('terminal close는 pending gameplay command와 raw lifecycle 우회를 제거하고 전용 Core cleanup port만 허용한다', () => {
    const backend = createFakeBackend({ capacity: 8 });
    backend.stageFixedPrograms = (plan) => {
        backend.calls.push({ type: 'stageFixedPrograms', plan });
        return Object.freeze({
            accepted: plan.controls.length + plan.sourceRelativeSpawns.length,
            rejected: 0
        });
    };
    let cleanupBinding = null;
    const endpoint = createGpuSimulationEndpoint({
        gpuSimulationBackend: backend,
        coreImpactCleanupPortReceiver(binding) {
            assert.equal(cleanupBinding, null);
            cleanupBinding = binding;
        }
    });
    assert.ok(cleanupBinding);
    assert.equal('coreImpactCleanupPort' in endpoint, false);
    endpoint.init({ id: 'terminal-close-map' });
    const protocol = setCurrentEventProtocol(endpoint, backend);
    assert.equal(endpoint.requestSpawnBatch([
        ...Array.from({ length: 5 }, (_, spawnSequence) => ({
            intent: createSpawnIntent(spawnSequence),
            targetFixedTick: 1,
            commandId: `terminal-close:active:${spawnSequence}`
        }))
    ]).accepted, true);
    const [
        handle,
        gpuDeathHandle,
        gpuDeathOnlyHandle,
        forgedGpuDeathHandle,
        forgedCoreImpactHandle
    ] = endpoint.commitAtFixedBoundary(1).spawned.map(({ handle: entry }) => entry);
    const rawLifecycleOwner = endpoint.getLifecycleCommandOwner();
    const rawFixedOwner = endpoint.fixedCommandOwner;

    backend.completedEventBatches.push(createCompletedBatch(protocol, {
        sourceTick: 1,
        submittedTick: 1,
        events: [{
            type: 'death',
            eventType: 'death',
            sequence: 0,
            entityId: gpuDeathHandle.entityId,
            incarnation: gpuDeathHandle.incarnation,
            reasonFlags: 1
        }, {
            type: 'death',
            eventType: 'death',
            sequence: 1,
            entityId: gpuDeathOnlyHandle.entityId,
            incarnation: gpuDeathOnlyHandle.incarnation,
            reasonFlags: 1
        }]
    }));
    const completed = endpoint.commitCompletedEventsAtFixedBoundary(3);
    assert.equal(completed.deathEvents[0].disposition, 'despawn-requested');
    const precloseUpgrade = cleanupBinding.port
        .requestCommittedCoreImpactCleanup(
            gpuDeathHandle,
            3,
            'core-impact:terminal-close:preclose-upgrade'
        );
    assert.equal(precloseUpgrade.accepted, false);
    assert.equal(precloseUpgrade.reason, 'duplicate-despawn');
    assert.equal(precloseUpgrade.disposition, 'CORE_IMPACT');
    assert.equal(precloseUpgrade.dispositionUpgraded, true);
    assert.equal(
        precloseUpgrade.commandId,
        `gpu-death:${completed.deathEvents[0].key}`
    );
    assert.equal(endpoint.requestDespawn(
        forgedGpuDeathHandle,
        'gpu-death',
        3,
        'gpu-death:public-preclose-forgery'
    ).accepted, true);
    assert.equal(endpoint.requestDespawn(
        forgedCoreImpactHandle,
        'core-impact',
        3,
        'core-impact:public-preclose-forgery',
        { disposition: 'CORE_IMPACT' }
    ).accepted, true);

    assert.equal(endpoint.requestSourceRelativeSpawn({
        sourceHandle: handle,
        destinationSpawn: createSpawnIntent(7),
        positionOffset: { x: 0, y: 0 },
        launchVelocity: { x: 1, y: 0 },
        sourceVelocityScale: 0
    }, 2, 'terminal-close:staged-source-relative').accepted, true);
    const staged = endpoint.commitAtFixedBoundary(2);
    assert.equal(staged.fixedCommands.sourceRelativeSpawns.length, 1);
    assert.equal(endpoint.getStatus().pendingSourceRelativeDestinationCount, 1);
    assert.equal(endpoint.getRegistry().getReservedCount(), 1);

    assert.equal(endpoint.requestSpawn(
        createSpawnIntent(4),
        5,
        'terminal-close:future:single'
    ).accepted, true);
    assert.equal(endpoint.requestSpawnBatch([
        {
            intent: createSpawnIntent(5),
            targetFixedTick: 5,
            commandId: 'terminal-close:future:batch:0'
        },
        {
            intent: createSpawnIntent(6),
            targetFixedTick: 5,
            commandId: 'terminal-close:future:batch:1'
        }
    ]).accepted, true);
    assert.equal(endpoint.requestBodyControl({
        handle,
        moveIntentX: 1,
        moveIntentY: 0
    }, 5, 'terminal-close:control').accepted, true);
    assert.equal(endpoint.requestSourceRelativeSpawn({
        sourceHandle: handle,
        destinationSpawn: createSpawnIntent(8),
        positionOffset: { x: 0, y: 0 },
        launchVelocity: { x: 1, y: 0 },
        sourceVelocityScale: 0
    }, 5, 'terminal-close:source-relative').accepted, true);
    assert.equal(endpoint.getPendingCommandCount(), 10);

    const closed = endpoint.closeGameplayIngress('run-defeated');
    assert.deepEqual({ ...closed }, { closed: true, reason: 'run-defeated' });
    const closedStatus = endpoint.getStatus();
    assert.equal(closedStatus.pendingCommandCount, 2);
    assert.equal(closedStatus.lifecycle.pendingCount, 2);
    assert.equal(closedStatus.fixedCommands.pendingCommandCount, 0);
    assert.equal(closedStatus.fixedCommands.pendingDestinationCount, 0);
    assert.equal(
        closedStatus.gameplayIngressCloseCleanup.lifecycle.cancelledCount,
        5
    );
    assert.equal(
        closedStatus.gameplayIngressCloseCleanup.lifecycle
            .preservedCleanupCount,
        2
    );
    assert.equal(
        closedStatus.gameplayIngressCloseCleanup.fixedCommands
            .cancelledCommandCount,
        2
    );
    assert.equal(
        closedStatus.gameplayIngressCloseCleanup.fixedCommands
            .releasedDestinationCount,
        1
    );
    assert.equal(endpoint.getRegistry().getReservedCount(), 0);

    assert.equal(endpoint.requestSpawn({}, 3).accepted, false);
    assert.equal(endpoint.requestSpawnBatch([]).accepted, false);
    assert.equal(endpoint.requestBodyControl({}, 3, 'terminal-close:late-control').accepted, false);
    assert.equal(endpoint.requestSourceRelativeSpawn(
        {},
        3,
        'terminal-close:late-source'
    ).accepted, false);
    assert.equal(endpoint.requestDespawn(
        handle,
        'core-impact',
        3,
        'core-impact:public-forgery',
        { disposition: 'CORE_IMPACT' }
    ).accepted, false);
    assert.equal(rawLifecycleOwner.requestSpawn({}, 3).accepted, false);
    assert.equal(rawLifecycleOwner.requestSpawnBatch([]).accepted, false);
    assert.equal(rawLifecycleOwner.requestDespawn(
        handle,
        'cleanup',
        3,
        'terminal-close:raw-despawn'
    ).accepted, false);
    assert.equal(rawFixedOwner.requestBodyControl(
        {},
        3,
        'terminal-close:raw-control'
    ).accepted, false);
    assert.equal(rawFixedOwner.requestSourceRelativeSpawn(
        {},
        3,
        'terminal-close:raw-source-relative'
    ).accepted, false);

    const privileged = cleanupBinding.port
        .requestCommittedCoreImpactCleanup(
            handle,
            3,
            'core-impact:terminal-close'
        );
    assert.equal(privileged.accepted, true);
    const duplicate = cleanupBinding.port
        .requestCommittedCoreImpactCleanup(
            handle,
            3,
            'core-impact:terminal-close:duplicate'
        );
    assert.equal(duplicate.accepted, false);
    assert.equal(duplicate.reason, 'duplicate-despawn');

    const finalCommit = endpoint.commitAtFixedBoundary(3);
    assert.equal(finalCommit.spawned.length, 0);
    assert.equal(finalCommit.despawned.length, 3);
    const gpuDeathCleanup = finalCommit.despawned.find(({ handle: entry }) => (
        entry.entityId === gpuDeathHandle.entityId
            && entry.incarnation === gpuDeathHandle.incarnation
    ));
    assert.equal(gpuDeathCleanup.reason, 'gpu-death');
    assert.equal(
        gpuDeathCleanup.commandId,
        `gpu-death:${completed.deathEvents[0].key}`
    );
    assert.equal(gpuDeathCleanup.disposition, 'CORE_IMPACT');
    assert.equal(gpuDeathCleanup.bountyEligible, false);
    const gpuDeathOnlyCleanup = finalCommit.despawned.find(({ handle: entry }) => (
        entry.entityId === gpuDeathOnlyHandle.entityId
            && entry.incarnation === gpuDeathOnlyHandle.incarnation
    ));
    assert.equal(gpuDeathOnlyCleanup.reason, 'gpu-death');
    assert.equal(
        gpuDeathOnlyCleanup.commandId,
        `gpu-death:${completed.deathEvents[1].key}`
    );
    assert.equal('disposition' in gpuDeathOnlyCleanup, false);
    assert.equal('bountyEligible' in gpuDeathOnlyCleanup, false);
    const coreImpactCleanup = finalCommit.despawned.find(({ handle: entry }) => (
        entry.entityId === handle.entityId
            && entry.incarnation === handle.incarnation
    ));
    assert.equal(coreImpactCleanup.reason, 'core-impact');
    assert.equal(coreImpactCleanup.disposition, 'CORE_IMPACT');
    assert.equal(coreImpactCleanup.bountyEligible, false);
    assert.equal(endpoint.hasBody(forgedGpuDeathHandle), true);
    assert.equal(endpoint.hasBody(forgedCoreImpactHandle), true);
    assert.deepEqual(Array.from(finalCommit.fixedCommands.controls), []);
    assert.deepEqual(Array.from(finalCommit.fixedCommands.sourceRelativeSpawns), []);
    assert.equal(endpoint.getPendingCommandCount(), 0);
    assert.equal(endpoint.getRegistry().getReservedCount(), 0);
    const finalized = endpoint.finalizeClosedGameplayIngress();
    assert.equal(finalized.lifecycleCancelledCount, 0);
    assert.deepEqual({ ...finalized.fixedCommands }, {
        closed: true,
        reason: 'run-defeated',
        cancelledCommandCount: 0,
        releasedDestinationCount: 0,
        failedDestinationCount: 0
    });

    assert.equal(cleanupBinding.port.requestCommittedCoreImpactCleanup(
        { entityId: 99, incarnation: 1 },
        4,
        'core-impact:revoked'
    ).reason, 'core-impact-cleanup-port-revoked');
    assert.equal(rawFixedOwner.requestBodyControl(
        {},
        4,
        'terminal-close:raw-control-after-finalize'
    ).accepted, false);
    assert.equal(rawFixedOwner.requestSourceRelativeSpawn(
        {},
        4,
        'terminal-close:raw-source-after-finalize'
    ).accepted, false);
    assert.equal(endpoint.getPendingCommandCount(), 0);
    assert.equal(endpoint.getRegistry().getReservedCount(), 0);
    endpoint.destroy();
});
