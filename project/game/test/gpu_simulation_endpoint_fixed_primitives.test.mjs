import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GpuSimulationEndpoint,
    GpuEnemySimulationEndpoint,
    createGpuSimulationEndpoint
} = await loadGameModule('ingame/gpu_simulation_endpoint.js');

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function createCanonicalSpawnIntent(definitionId = 'fixed_primitive_fixture') {
    return {
        kindId: 'projectile',
        definitionId,
        position: { x: 1, y: 2 },
        velocity: { x: 0.5, y: -0.25 },
        radius: 0.2,
        inverseMass: 1,
        bodyLayer: 0x0002,
        collisionMask: 0x0001,
        interactionLayer: 0x0004,
        interactionMask: 0x0008,
        alive: true,
        health: 1,
        penetration: 1,
        damageSelf: 0,
        damageOther: 0,
        lifetimeRemaining: 5
    };
}

function createPrimitiveBackend(options = {}) {
    const bodies = new Map();
    const calls = [];
    const completedSpawnProgramBatches = [];
    const completedEventBatches = [];
    let protocol = Object.freeze({
        sessionGeneration: 1,
        deviceGeneration: 1,
        authoritativeEpoch: 1,
        submittedTickCount: 0
    });
    let trackedPose = null;
    let destroyed = false;

    const backend = {
        bodies,
        calls,
        completedSpawnProgramBatches,
        completedEventBatches,
        setProtocol(next) {
            protocol = Object.freeze({ ...next });
        },
        setTrackedPose(next) {
            trackedPose = next;
        },
        queueSpawnProgramBatch(batch) {
            completedSpawnProgramBatches.push(batch);
        },
        queueEventBatch(batch) {
            completedEventBatches.push(batch);
        },
        getCapacity() {
            return options.capacity ?? 8;
        },
        init(tileMap) {
            calls.push({ type: 'init', tileMap });
            return true;
        },
        spawnBodies(source) {
            const batch = Array.from(source);
            calls.push({ type: 'spawnBodies', bodies: batch });
            const handles = batch.map((body) => {
                const handle = Object.freeze({
                    entityId: body.entityId,
                    incarnation: body.incarnation
                });
                bodies.set(handleKey(handle), body);
                return handle;
            });
            return {
                accepted: batch.length,
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
        canControlBody(handle) {
            calls.push({ type: 'canControlBody', handle });
            return bodies.has(handleKey(handle));
        },
        stageFixedPrograms(plan) {
            calls.push({ type: 'stageFixedPrograms', plan });
            for (const entry of plan.sourceRelativeSpawns) {
                bodies.set(
                    handleKey(entry.destinationHandle),
                    entry.destinationSpawn
                );
            }
            const controlCount = plan.controls.length;
            const spawnCount = plan.sourceRelativeSpawns.length;
            return {
                accepted: controlCount + spawnCount,
                rejected: 0,
                requiresRecovery: false,
                controls: {
                    accepted: controlCount,
                    rejected: 0,
                    reason: null
                },
                sourceRelativeSpawns: {
                    accepted: spawnCount,
                    rejected: 0,
                    reason: null
                }
            };
        },
        drainCompletedSpawnProgramBatches(out = []) {
            calls.push({ type: 'drainCompletedSpawnProgramBatches' });
            for (const batch of completedSpawnProgramBatches.splice(0)) {
                for (const outcome of batch.outcomes ?? []) {
                    if (outcome.reason === 'source-invalid') {
                        bodies.delete(handleKey(outcome.destinationHandle));
                    }
                }
                out.push(batch);
            }
            return out;
        },
        hasPendingSpawnProgramThroughTick(sourceTick) {
            calls.push({ type: 'hasPendingSpawnProgramThroughTick', sourceTick });
            return completedSpawnProgramBatches.some(
                (batch) => batch.sourceTick <= sourceTick
            );
        },
        drainCompletedEventBatches(out = []) {
            calls.push({ type: 'drainCompletedEventBatches' });
            out.push(...completedEventBatches.splice(0));
            return out;
        },
        configureTrackedBody(handle) {
            calls.push({ type: 'configureTrackedBody', handle });
            return Object.freeze({
                accepted: true,
                tracked: handle === null ? null : Object.freeze({ ...handle })
            });
        },
        getObservedTrackedPose() {
            calls.push({ type: 'getObservedTrackedPose' });
            return trackedPose;
        },
        getLatestTrackedPose() {
            calls.push({ type: 'getLatestTrackedPose' });
            return trackedPose;
        },
        fixedUpdate(delta, sourceTick) {
            calls.push({ type: 'fixedUpdate', delta, sourceTick });
            return true;
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
        getEventProtocolState() {
            return protocol;
        },
        getRuntimeState() {
            return destroyed ? 'destroyed' : 'gpu-ready';
        },
        requiresRecovery() {
            return false;
        },
        getStatus() {
            return Object.freeze({
                state: destroyed ? 'destroyed' : 'gpu-ready',
                marker: 'fixed-primitive-backend'
            });
        },
        destroy() {
            if (destroyed) {
                return;
            }
            destroyed = true;
            calls.push({ type: 'destroy' });
            bodies.clear();
        }
    };
    return backend;
}

function createLegacyBackend() {
    const backend = createPrimitiveBackend();
    delete backend.canControlBody;
    delete backend.stageFixedPrograms;
    delete backend.drainCompletedSpawnProgramBatches;
    delete backend.hasPendingSpawnProgramThroughTick;
    delete backend.configureTrackedBody;
    delete backend.getObservedTrackedPose;
    delete backend.getLatestTrackedPose;
    delete backend.getEventProtocolState;
    return backend;
}

function createEndpoint(backend) {
    const endpoint = createGpuSimulationEndpoint({
        gpuSimulationBackend: backend
    }, {
        capacity: backend.getCapacity(),
        controlCommandCapacity: 4,
        spawnProgramCapacity: 4
    });
    backend.setProtocol?.({
        sessionGeneration: endpoint.getStatus().sessionGeneration,
        deviceGeneration: 7,
        authoritativeEpoch: 3,
        submittedTickCount: 0
    });
    endpoint.init({ id: 'fixed-primitive-map' });
    return endpoint;
}

function spawnSource(endpoint, definitionId = 'controlled_source') {
    assert.equal(endpoint.requestSpawn(
        createCanonicalSpawnIntent(definitionId),
        1,
        `spawn:${definitionId}`
    ).accepted, true);
    return endpoint.commitAtFixedBoundary(1).spawned[0].handle;
}

function createEventBatch(protocol, handle, sourceTick) {
    return Object.freeze({
        sessionGeneration: protocol.sessionGeneration,
        deviceGeneration: protocol.deviceGeneration,
        authoritativeEpoch: protocol.authoritativeEpoch,
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick,
        submittedTick: 1,
        completedThroughTick: sourceTick,
        events: Object.freeze([Object.freeze({
            type: 'contact',
            eventType: 'interaction-enter',
            sequence: 0,
            entityId: handle.entityId,
            incarnation: handle.incarnation,
            valueFixedPoint: 0
        })])
    });
}

function assertNoPublicSlotKeys(value, path = 'root') {
    if (value === null || typeof value !== 'object') {
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        assert.equal(
            /^(slot|sourceSlot|destinationSlot|stableSlot)$/i.test(key),
            false,
            `${path}.${key}가 private GPU slot을 노출했습니다.`
        );
        assertNoPublicSlotKeys(child, `${path}.${key}`);
    }
}

test('generic endpoint는 fixed primitive public seam을 제공하고 private GPU slot을 노출하지 않는다', () => {
    assert.strictEqual(GpuSimulationEndpoint, GpuEnemySimulationEndpoint);
    const backend = createPrimitiveBackend();
    const endpoint = createEndpoint(backend);
    const source = spawnSource(endpoint);

    assert.equal(typeof endpoint.requestBodyControl, 'function');
    assert.equal(typeof endpoint.requestSourceRelativeSpawn, 'function');
    assert.equal(typeof endpoint.configureTrackedBody, 'function');
    assert.equal(typeof endpoint.getObservedTrackedPose, 'function');
    assert.equal('getBodySlot' in endpoint, false);
    assert.equal('resolveBodySlot' in endpoint, false);

    const control = endpoint.requestBodyControl({
        handle: source,
        moveIntentX: 1,
        moveIntentY: 0
    }, 2, 'control:source:2');
    assert.equal(control.accepted, true);
    const replay = endpoint.requestBodyControl({
        handle: source,
        moveIntentX: 1,
        moveIntentY: 0
    }, 2, 'control:source:2');
    assert.equal(replay.accepted, true);
    assert.equal(replay.replay, true);

    const committed = endpoint.commitAtFixedBoundary(2);
    assert.equal(committed.fixedCommands.controls.length, 1);
    const staged = backend.calls.find(({ type }) => type === 'stageFixedPrograms');
    assert.deepEqual(Array.from(staged.plan.controls, (entry) => ({ ...entry })), [{
        entityId: source.entityId,
        incarnation: source.incarnation,
        moveIntentX: 1,
        moveIntentY: 0
    }]);
    assert.equal(staged.plan.sourceRelativeSpawns.length, 0);
    assertNoPublicSlotKeys(control, 'controlReceipt');
    assertNoPublicSlotKeys(committed.fixedCommands, 'fixedCommit');
    assertNoPublicSlotKeys(endpoint.getStatus(), 'status');
    endpoint.destroy();
});

test('tracked body observation은 exact handle만 구성하고 immutable observed snapshot을 반환한다', () => {
    const backend = createPrimitiveBackend();
    const endpoint = createEndpoint(backend);
    const source = spawnSource(endpoint, 'tracked_source');
    const observed = Object.freeze({
        valid: true,
        entityId: source.entityId,
        incarnation: source.incarnation,
        sourceTick: 9,
        observedThroughTick: 9,
        position: Object.freeze({ x: 3.25, y: 4.5 }),
        previousPosition: Object.freeze({ x: 3, y: 4.25 }),
        velocity: Object.freeze({ x: 0.25, y: 0.25 }),
        ageTicks: 0,
        sessionGeneration: endpoint.getStatus().sessionGeneration,
        deviceGeneration: 7,
        authoritativeEpoch: 3
    });
    backend.setTrackedPose(observed);

    const configured = endpoint.configureTrackedBody(source);
    assert.equal(configured.accepted, true);
    assert.deepEqual({ ...configured.tracked }, { ...source });
    const stale = endpoint.configureTrackedBody({
        entityId: source.entityId,
        incarnation: source.incarnation + 1
    });
    assert.deepEqual({ ...stale }, {
        accepted: false,
        reason: 'stale-handle'
    });
    const snapshot = endpoint.getObservedTrackedPose();
    assert.equal(snapshot.valid, observed.valid);
    assert.equal(snapshot.entityId, observed.entityId);
    assert.equal(snapshot.incarnation, observed.incarnation);
    assert.equal(snapshot.sourceTick, observed.sourceTick);
    assert.deepEqual({ ...snapshot.position }, { ...observed.position });
    assert.deepEqual(
        { ...snapshot.previousPosition },
        { ...observed.previousPosition }
    );
    assert.deepEqual({ ...snapshot.velocity }, { ...observed.velocity });
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.position), true);
    assert.equal(Object.isFrozen(snapshot.previousPosition), true);
    assert.equal(Object.isFrozen(snapshot.velocity), true);
    assert.throws(() => {
        snapshot.position.x = 100;
    }, TypeError);
    assert.deepEqual({ ...endpoint.configureTrackedBody(null) }, {
        accepted: true,
        tracked: null
    });
    endpoint.destroy();
});

test('SpawnProgram completion은 event drain 전에 destination을 활성화하며 public 결과에는 slot이 없다', () => {
    const backend = createPrimitiveBackend();
    const endpoint = createEndpoint(backend);
    const source = spawnSource(endpoint, 'spawn_program_source');
    const protocol = backend.getEventProtocolState();

    const requested = endpoint.requestSourceRelativeSpawn({
        sourceHandle: source,
        destinationSpawn: createCanonicalSpawnIntent('spawn_program_destination'),
        positionOffset: { x: 0.25, y: -0.5 },
        launchVelocity: { x: 4, y: 2 },
        sourceVelocityScale: 0.5
    }, 2, 'source-relative:2');
    assert.equal(requested.accepted, true);
    assert.equal(endpoint.getStatus().reservedCount, 0);

    const commit = endpoint.commitAtFixedBoundary(2);
    const pending = commit.fixedCommands.sourceRelativeSpawns[0];
    assert.equal(pending.state, 'gpu-resolve-pending');
    assert.equal(endpoint.getStatus().activeCount, 1);
    assert.equal(endpoint.getStatus().reservedCount, 1);
    assertNoPublicSlotKeys(requested, 'spawnReceipt');
    assertNoPublicSlotKeys(pending, 'spawnPending');

    backend.queueSpawnProgramBatch(Object.freeze({
        ...protocol,
        sourceTick: 2,
        outcomes: Object.freeze([Object.freeze({
            sourceHandle: source,
            destinationHandle: pending.handle,
            reason: 'resolved'
        })])
    }));
    backend.queueEventBatch(createEventBatch(protocol, pending.handle, 2));
    const snapshot = endpoint.commitCompletedEventsAtFixedBoundary(3);

    const spawnDrainIndex = backend.calls.findIndex(
        ({ type }) => type === 'drainCompletedSpawnProgramBatches'
    );
    const eventDrainIndex = backend.calls.findIndex(
        ({ type }) => type === 'drainCompletedEventBatches'
    );
    assert.ok(spawnDrainIndex >= 0);
    assert.ok(eventDrainIndex > spawnDrainIndex);
    assert.equal(snapshot.protocolFailure, null);
    assert.equal(snapshot.contactEvents.length, 1);
    assert.equal(snapshot.contactEvents[0].disposition, 'applied');
    assert.equal(endpoint.getRegistry().has(pending.handle), true);
    assert.equal(endpoint.getStatus().activeCount, 2);
    assert.equal(endpoint.getStatus().reservedCount, 0);
    assert.equal(
        endpoint.getStatus().fixedCommands.lastCompletionResult.completed[0].outcome,
        'resolved'
    );
    endpoint.destroy();
});

test('endpoint는 spawn domain pressure에서 동일 tick control을 commit하고 reservation을 누수하지 않는다', () => {
    const backend = createPrimitiveBackend();
    backend.stageFixedPrograms = (plan) => {
        backend.calls.push({ type: 'stageFixedPrograms', plan });
        return {
            accepted: plan.controls.length,
            rejected: plan.sourceRelativeSpawns.length,
            requiresRecovery: false,
            controls: {
                accepted: plan.controls.length,
                rejected: 0,
                reason: null
            },
            sourceRelativeSpawns: {
                accepted: 0,
                rejected: plan.sourceRelativeSpawns.length,
                reason: 'spawn-program-capacity'
            }
        };
    };
    const endpoint = createEndpoint(backend);
    const source = spawnSource(endpoint, 'pressure_source');

    assert.equal(endpoint.requestBodyControl({
        handle: source,
        moveIntentX: 1,
        moveIntentY: 0
    }, 2, 'control:pressure').accepted, true);
    assert.equal(endpoint.requestSourceRelativeSpawn({
        sourceHandle: source,
        destinationSpawn: createCanonicalSpawnIntent('pressure_destination'),
        positionOffset: { x: 0, y: 0 },
        launchVelocity: { x: 4, y: 0 },
        sourceVelocityScale: 0
    }, 2, 'spawn:pressure').accepted, true);

    const committed = endpoint.commitAtFixedBoundary(2);
    assert.equal(committed.state, 'committed-with-rejections');
    assert.equal(committed.recoveryRequired, false);
    assert.equal(committed.fixedCommands.controls.length, 1);
    assert.equal(committed.fixedCommands.sourceRelativeSpawns.length, 0);
    assert.deepEqual(
        Array.from(committed.fixedCommands.rejected, ({ domain, code }) => ({
            domain,
            code
        })),
        [{ domain: 'spawn', code: 'spawn-program-capacity' }]
    );
    assert.equal(endpoint.getStatus().activeCount, 1);
    assert.equal(endpoint.getStatus().reservedCount, 0);
    assert.equal(endpoint.getStatus().fixedCommands.pendingDestinationCount, 0);
    assert.equal(endpoint.requiresRecovery(), false);
    endpoint.destroy();
});

test('SpawnProgram protocol failure는 같은 경계의 event/lifecycle/fixed submit을 모두 차단한다', () => {
    const backend = createPrimitiveBackend();
    const endpoint = createEndpoint(backend);
    const source = spawnSource(endpoint, 'failure_source');
    const protocol = backend.getEventProtocolState();
    assert.equal(endpoint.requestSourceRelativeSpawn({
        sourceHandle: source,
        destinationSpawn: createCanonicalSpawnIntent('failure_destination'),
        positionOffset: { x: 0, y: 0 },
        launchVelocity: { x: 1, y: 0 },
        sourceVelocityScale: 0
    }, 2, 'source-relative:failure').accepted, true);
    const pending = endpoint.commitAtFixedBoundary(2)
        .fixedCommands.sourceRelativeSpawns[0];

    assert.equal(endpoint.requestSpawn(
        createCanonicalSpawnIntent('must_not_spawn'),
        3,
        'lifecycle:must-not-commit'
    ).accepted, true);
    backend.queueSpawnProgramBatch(Object.freeze({
        ...protocol,
        deviceGeneration: protocol.deviceGeneration + 1,
        sourceTick: 2,
        outcomes: Object.freeze([Object.freeze({
            sourceHandle: source,
            destinationHandle: pending.handle,
            reason: 'resolved'
        })])
    }));
    backend.queueEventBatch(createEventBatch(protocol, source, 2));

    const failure = endpoint.commitCompletedEventsAtFixedBoundary(3);
    assert.equal(failure.protocolFailure.stage, 'spawn-program-completion');
    assert.equal(failure.protocolFailure.code, 'generation-mismatch');
    assert.equal(
        backend.calls.filter(({ type }) => type === 'drainCompletedEventBatches').length,
        0
    );

    const spawnCallCount = backend.calls.filter(
        ({ type }) => type === 'spawnBodies'
    ).length;
    const stageCallCount = backend.calls.filter(
        ({ type }) => type === 'stageFixedPrograms'
    ).length;
    const fixedCallCount = backend.calls.filter(
        ({ type }) => type === 'fixedUpdate'
    ).length;
    const boundary = endpoint.commitAtFixedBoundary(3);
    assert.equal(boundary.state, 'failed');
    assert.equal(boundary.recoveryRequired, true);
    assert.equal(
        backend.calls.filter(({ type }) => type === 'spawnBodies').length,
        spawnCallCount
    );
    assert.equal(
        backend.calls.filter(({ type }) => type === 'stageFixedPrograms').length,
        stageCallCount
    );
    assert.equal(endpoint.fixedUpdate(1 / 60, 3), false);
    assert.equal(
        backend.calls.filter(({ type }) => type === 'fixedUpdate').length,
        fixedCallCount
    );
    endpoint.destroy();
});

test('새 optional API가 없는 injected legacy backend의 spawn-only 거부는 terminal recovery 없이 fail closed한다', () => {
    const backend = createLegacyBackend();
    const endpoint = createEndpoint(backend);
    const source = spawnSource(endpoint, 'legacy_source');

    assert.deepEqual({ ...endpoint.requestBodyControl({
        handle: source,
        moveIntentX: 1,
        moveIntentY: 0
    }, 2, 'legacy:control') }, {
        accepted: false,
        commandId: 'legacy:control',
        reason: 'flow-body-not-controllable'
    });
    assert.deepEqual({ ...endpoint.configureTrackedBody(null) }, {
        accepted: false,
        reason: 'fixed-primitives-unsupported'
    });
    assert.equal(endpoint.getObservedTrackedPose(), null);
    assert.equal(endpoint.requestSourceRelativeSpawn({
        sourceHandle: source,
        destinationSpawn: createCanonicalSpawnIntent('legacy_destination'),
        positionOffset: { x: 0, y: 0 },
        launchVelocity: { x: 1, y: 0 },
        sourceVelocityScale: 0
    }, 2, 'legacy:source-relative').accepted, true);
    const committed = endpoint.commitAtFixedBoundary(2);
    assert.equal(committed.state, 'committed-with-rejections');
    assert.equal(committed.recoveryRequired, false);
    assert.equal(committed.fixedCommands.rejected[0].code,
        'fixed-primitives-unsupported');
    assert.equal(committed.fixedCommands.rejected[0].domain, 'spawn');
    assert.equal(committed.fixedCommands.protocolFailure, null);
    assert.equal(endpoint.getStatus().reservedCount, 0);
    assert.equal(endpoint.requiresRecovery(), false);
    endpoint.destroy();
});
