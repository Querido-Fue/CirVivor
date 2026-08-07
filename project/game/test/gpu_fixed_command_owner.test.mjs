import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { WorldRegistry } = await loadGameModule(
    'ingame/object/world_registry.js'
);
const { GpuFixedCommandOwner } = await loadGameModule(
    'ingame/object/gpu_fixed_command_owner.js'
);

function handleKey(handle) {
    return handle.entityId + ':' + handle.incarnation;
}

function createProjectileIntent(overrides = {}) {
    return {
        kindId: 'projectile',
        definitionId: 'phase3_fixture_projectile',
        spawnSequence: 7,
        position: { x: 99, y: 98 },
        velocity: { x: 97, y: 96 },
        radius: 0.25,
        inverseMass: 10,
        bodyLayer: 2,
        collisionMask: 0,
        interactionLayer: 2,
        interactionMask: 129,
        health: 3,
        lifetime: 2,
        contactHandler: {
            damageSelf: 1,
            damageOther: 2.5,
            flags: 0
        },
        alive: true,
        ...overrides
    };
}

function createSourceRelativeIntent(sourceHandle, overrides = {}) {
    return {
        sourceHandle,
        destinationSpawn: createProjectileIntent(),
        positionOffset: { x: 0.5, y: -0.25 },
        launchVelocity: { x: 12, y: -3 },
        sourceVelocityScale: 0.75,
        ...overrides
    };
}

function createFakeBackend(options = {}) {
    const bodies = new Map();
    const stagedPlans = [];
    const completionBatches = [];
    let protocol = {
        sessionGeneration: options.sessionGeneration ?? 1,
        deviceGeneration: options.deviceGeneration ?? 2,
        authoritativeEpoch: options.authoritativeEpoch ?? 3
    };
    let recoveryRequired = false;

    return {
        bodies,
        stagedPlans,
        completionBatches,
        addBody(handle, bodyOptions = {}) {
            bodies.set(handleKey(handle), {
                controllable: bodyOptions.controllable !== false
            });
        },
        removeBody(handle) {
            bodies.delete(handleKey(handle));
        },
        setProtocol(nextProtocol) {
            protocol = { ...protocol, ...nextProtocol };
        },
        getProtocol() {
            return { ...protocol };
        },
        setRecoveryRequired(value) {
            recoveryRequired = value === true;
        },
        hasBody(handle) {
            return bodies.has(handleKey(handle));
        },
        canControlBody(handle) {
            return bodies.get(handleKey(handle))?.controllable === true;
        },
        stageFixedPrograms(plan) {
            stagedPlans.push(plan);
            const accepted = plan.controls.length
                + plan.sourceRelativeSpawns.length;
            return { accepted, rejected: 0, requiresRecovery: false };
        },
        drainCompletedSpawnProgramBatches(out) {
            out.push(...completionBatches.splice(0));
            return out;
        },
        getEventProtocolState() {
            return { ...protocol };
        },
        requiresRecovery() {
            return recoveryRequired;
        },
        getRuntimeState() {
            return recoveryRequired ? 'gpu-recovery-required' : 'gpu-ready';
        }
    };
}

function activateBody(registry, backend, descriptor = {}) {
    const handle = registry.reserveEntity({
        kindId: descriptor.kindId ?? 'tower-proxy-fixture',
        definitionId: descriptor.definitionId ?? 'phase3_controlled_body',
        createdAtTick: descriptor.createdAtTick ?? 0
    });
    assert.ok(handle);
    assert.equal(registry.activateReserved(handle), true);
    backend.addBody(handle, descriptor);
    return handle;
}

function queueSpawnOutcome(backend, {
    sourceTick,
    sourceHandle,
    destinationHandle,
    reason,
    protocol = backend.getProtocol()
}) {
    backend.completionBatches.push({
        ...protocol,
        sourceTick,
        outcomes: [{ sourceHandle, destinationHandle, reason }]
    });
}

test('stale와 incarnation reuse는 deterministic reject하고 registry/backend desync만 recovery로 올린다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 2 });
    const owner = new GpuFixedCommandOwner(backend, registry);

    const stale = owner.requestBodyControl({
        handle: { entityId: 91, incarnation: 4 },
        moveIntent: { x: 1, y: 0 }
    }, 1, 'control:stale');
    assert.equal(stale.accepted, false);
    assert.equal(stale.reason, 'stale-handle');
    assert.equal(owner.getStatus().recoveryRequired, false);

    const first = activateBody(registry, backend);
    assert.equal(registry.remove(first), true);
    backend.removeBody(first);
    const reused = activateBody(registry, backend);
    assert.equal(reused.entityId, first.entityId);
    assert.equal(reused.incarnation, first.incarnation + 1);

    const staleIncarnation = owner.requestBodyControl({
        handle: first,
        moveIntentX: 0,
        moveIntentY: 1
    }, 1, 'control:stale-incarnation');
    assert.equal(staleIncarnation.accepted, false);
    assert.equal(staleIncarnation.reason, 'stale-handle');
    assert.equal(owner.getStatus().recoveryRequired, false);
    assert.equal(backend.stagedPlans.length, 0);

    const desyncBackend = createFakeBackend();
    const desyncRegistry = new WorldRegistry({ capacity: 1 });
    const desyncHandle = desyncRegistry.reserveEntity({
        kindId: 'tower-proxy-fixture',
        definitionId: 'desync',
        createdAtTick: 0
    });
    assert.equal(desyncRegistry.activateReserved(desyncHandle), true);
    const desyncOwner = new GpuFixedCommandOwner(desyncBackend, desyncRegistry);
    const desync = desyncOwner.requestBodyControl({
        handle: desyncHandle,
        moveIntentX: 1,
        moveIntentY: 0
    }, 1, 'control:desync');
    assert.equal(desync.accepted, false);
    assert.equal(desync.reason, 'registry-backend-desync');
    assert.equal(desyncOwner.getStatus().recoveryRequired, true);
    assert.equal(desyncBackend.stagedPlans.length, 0);
});

test('동일 commandId replay는 idempotent이고 다른 payload 재사용은 fail fast한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 1 });
    const handle = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);
    const command = {
        handle,
        moveIntentX: 0.5,
        moveIntentY: -0.25
    };

    const first = owner.requestBodyControl(command, 2, 'control:duplicate');
    const replay = owner.requestBodyControl(command, 2, 'control:duplicate');
    assert.equal(first.accepted, true);
    assert.equal(replay.accepted, true);
    assert.equal(replay.replay, true);
    assert.equal(owner.getPendingCount(), 1);
    assert.equal(owner.getStatus().telemetry.replayed, 1);
    assert.throws(() => owner.requestBodyControl({
        handle,
        moveIntentX: -0.5,
        moveIntentY: -0.25
    }, 2, 'control:duplicate'), /다른 payload/);

    const committed = owner.commitAtFixedBoundary(2);
    assert.equal(committed.controls.length, 1);
    assert.equal(backend.stagedPlans.length, 1);
    assert.equal(backend.stagedPlans[0].controls.length, 1);
});

test('같은 exact body/tick의 동일 payload는 한 canonical command로 coalesce하고 다른 payload는 둘 다 적용하지 않는다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 1 });
    const handle = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);
    const canonical = {
        handle,
        moveIntentX: 1,
        moveIntentY: 0
    };

    assert.equal(
        owner.requestBodyControl(canonical, 3, 'control:canonical').accepted,
        true
    );
    const coalesced = owner.requestBodyControl(
        canonical,
        3,
        'control:coalesced'
    );
    assert.equal(coalesced.accepted, true);
    assert.equal(coalesced.coalesced, true);
    assert.equal(coalesced.canonicalCommandId, 'control:canonical');
    assert.equal(owner.getPendingCount(), 1);

    const coalescedCommit = owner.commitAtFixedBoundary(3);
    assert.equal(coalescedCommit.controls.length, 1);
    assert.equal(backend.stagedPlans.length, 1);
    assert.equal(backend.stagedPlans[0].controls.length, 1);
    assert.equal(owner.getStatus().telemetry.coalesced, 1);

    assert.equal(owner.requestBodyControl({
        handle,
        moveIntentX: 1,
        moveIntentY: 0
    }, 4, 'control:conflict-a').accepted, true);
    const conflicting = owner.requestBodyControl({
        handle,
        moveIntentX: 0,
        moveIntentY: 1
    }, 4, 'control:conflict-b');
    assert.equal(conflicting.accepted, false);
    assert.equal(conflicting.reason, 'body-tick-conflict');

    const conflictCommit = owner.commitAtFixedBoundary(4);
    assert.equal(conflictCommit.controls.length, 0);
    assert.deepEqual(
        Array.from(conflictCommit.rejected, (entry) => entry.code),
        ['body-tick-conflict']
    );
    assert.equal(backend.stagedPlans.length, 1);
    assert.equal(owner.getPendingCount(), 0);
});

test('bounded command capacity reject는 거부된 request의 partial stage를 남기지 않는다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 2 });
    const firstHandle = activateBody(registry, backend);
    const secondHandle = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry, {
        commandCapacity: 1,
        historyCapacity: 8
    });

    assert.equal(owner.requestBodyControl({
        handle: firstHandle,
        moveIntentX: 1,
        moveIntentY: 0
    }, 2, 'control:capacity-a').accepted, true);
    const rejected = owner.requestBodyControl({
        handle: secondHandle,
        moveIntentX: 0,
        moveIntentY: 1
    }, 2, 'control:capacity-b');
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.reason, 'command-capacity');
    assert.equal(owner.getPendingCount(), 1);

    const commit = owner.commitAtFixedBoundary(2);
    assert.equal(commit.controls.length, 1);
    assert.equal(backend.stagedPlans.length, 1);
    assert.equal(backend.stagedPlans[0].controls.length, 1);
    assert.equal(
        backend.stagedPlans[0].controls[0].entityId,
        firstHandle.entityId
    );
});

test('destination reservation의 mid-loop capacity failure는 source-relative batch 전체를 zero-partial rollback한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 2 });
    const source = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry, {
        commandCapacity: 4,
        historyCapacity: 16
    });

    assert.equal(owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source),
        5,
        'spawn:capacity-a'
    ).accepted, true);
    assert.equal(owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source, {
            positionOffset: { x: -0.5, y: 0.25 }
        }),
        5,
        'spawn:capacity-b'
    ).accepted, true);

    const commit = owner.commitAtFixedBoundary(5);
    assert.equal(commit.sourceRelativeSpawns.length, 0);
    assert.deepEqual(
        Array.from(commit.rejected, (entry) => entry.code),
        ['registry-capacity', 'registry-capacity']
    );
    assert.equal(backend.stagedPlans.length, 0);
    assert.equal(registry.getActiveCount(), 1);
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(owner.getPendingCount(), 0);
});

test('enqueue 뒤 generation/epoch가 바뀐 command는 새 world에 stage되지 않는다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 1 });
    const handle = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);

    assert.equal(owner.requestBodyControl({
        handle,
        moveIntentX: 1,
        moveIntentY: 0
    }, 5, 'control:old-generation').accepted, true);
    backend.setProtocol({ authoritativeEpoch: 4 });

    const staleGeneration = owner.commitAtFixedBoundary(5);
    assert.deepEqual(
        Array.from(staleGeneration.rejected, (entry) => entry.code),
        ['stale-generation']
    );
    assert.equal(staleGeneration.recoveryRequired, false);
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(backend.stagedPlans.length, 0);

    assert.equal(owner.requestBodyControl({
        handle,
        moveIntentX: 0,
        moveIntentY: 1
    }, 6, 'control:current-generation').accepted, true);
    assert.equal(owner.commitAtFixedBoundary(6).controls.length, 1);
    assert.equal(backend.stagedPlans.length, 1);
});

test('source-relative destination은 GPU result 전 reserved이고 resolved result에서만 활성화된다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 4 });
    const source = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);

    const request = owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source),
        3,
        'spawn:resolved'
    );
    assert.equal(request.accepted, true);
    assert.equal(registry.getReservedCount(), 0);

    const commit = owner.commitAtFixedBoundary(3);
    assert.equal(commit.sourceRelativeSpawns.length, 1);
    const destination = commit.sourceRelativeSpawns[0].handle;
    assert.equal(registry.getActiveCount(), 1);
    assert.equal(registry.getReservedCount(), 1);
    assert.equal(registry.has(destination), false);
    assert.equal(backend.hasBody(destination), false);
    assert.equal(owner.getPendingCount(), 1);
    assert.equal(backend.stagedPlans.length, 1);
    assert.equal(backend.stagedPlans[0].sourceRelativeSpawns.length, 1);
    assert.equal(
        handleKey(backend.stagedPlans[0].sourceRelativeSpawns[0].sourceHandle),
        handleKey(source)
    );
    assert.equal(
        handleKey(backend.stagedPlans[0].sourceRelativeSpawns[0].destinationHandle),
        handleKey(destination)
    );

    backend.addBody(destination);
    queueSpawnOutcome(backend, {
        sourceTick: 3,
        sourceHandle: source,
        destinationHandle: destination,
        reason: 'resolved'
    });
    const completion = owner.commitCompletedAtFixedBoundary(4);
    assert.equal(completion.protocolFailure, null);
    assert.equal(completion.completed.length, 1);
    assert.equal(completion.completed[0].outcome, 'resolved');
    assert.equal(registry.getActiveCount(), 2);
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(registry.has(destination), true);
    assert.equal(owner.getPendingCount(), 0);
});

test('commit 후 source-invalid result는 destination reservation을 취소하고 incarnation 재사용에서도 orphan을 남기지 않는다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 2 });
    const source = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);

    assert.equal(owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source),
        7,
        'spawn:source-invalid'
    ).accepted, true);
    const commit = owner.commitAtFixedBoundary(7);
    const destination = commit.sourceRelativeSpawns[0].handle;
    assert.equal(registry.getReservedCount(), 1);
    assert.equal(registry.has(destination), false);

    backend.removeBody(source);
    assert.equal(registry.remove(source), true);
    queueSpawnOutcome(backend, {
        sourceTick: 7,
        sourceHandle: source,
        destinationHandle: destination,
        reason: 'source-invalid'
    });
    const completion = owner.commitCompletedAtFixedBoundary(8);
    assert.equal(completion.protocolFailure, null);
    assert.equal(completion.completed.length, 1);
    assert.equal(completion.completed[0].outcome, 'source-invalid');
    assert.equal(registry.getActiveCount(), 0);
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(registry.has(destination), false);
    assert.equal(backend.hasBody(destination), false);
    assert.equal(owner.getPendingCount(), 0);

    const reused = registry.reserveEntity({
        kindId: 'projectile',
        definitionId: 'after-cleanup',
        createdAtTick: 9
    });
    assert.equal(reused.entityId, destination.entityId);
    assert.equal(reused.incarnation, destination.incarnation + 1);
});

test('old generation SpawnProgram completion은 destination을 활성화하지 않고 destroy cleanup까지 격리된다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 2 });
    const source = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);

    assert.equal(owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source),
        10,
        'spawn:old-completion'
    ).accepted, true);
    const commit = owner.commitAtFixedBoundary(10);
    const destination = commit.sourceRelativeSpawns[0].handle;
    const oldProtocol = backend.getProtocol();
    backend.addBody(destination);
    backend.setProtocol({ deviceGeneration: oldProtocol.deviceGeneration + 1 });
    queueSpawnOutcome(backend, {
        sourceTick: 10,
        sourceHandle: source,
        destinationHandle: destination,
        reason: 'resolved',
        protocol: oldProtocol
    });

    const completion = owner.commitCompletedAtFixedBoundary(11);
    assert.equal(completion.completed.length, 0);
    assert.equal(completion.protocolFailure.code, 'generation-mismatch');
    assert.equal(owner.getStatus().recoveryRequired, true);
    assert.equal(registry.has(destination), false);
    assert.equal(registry.getReservedCount(), 1);

    backend.removeBody(destination);
    owner.destroy();
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(registry.has(destination), false);
});

test('완료 history가 capacity에 도달해도 oldest completed ID를 재활용해 새 command를 계속 수락한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 1 });
    const handle = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry, {
        commandCapacity: 1,
        historyCapacity: 2
    });

    for (let tick = 1; tick <= 4; tick++) {
        const receipt = owner.requestBodyControl({
            handle,
            moveIntentX: tick % 2,
            moveIntentY: (tick + 1) % 2
        }, tick, 'control:history:' + tick);
        assert.equal(
            receipt.accepted,
            true,
            'completed history가 새 command를 영구 거부했습니다: tick=' + tick
        );
        const committed = owner.commitAtFixedBoundary(tick);
        assert.equal(committed.controls.length, 1);
        assert.equal(owner.getPendingCount(), 0);
    }

    assert.equal(backend.stagedPlans.length, 4);
    assert.equal(owner.getStatus().recoveryRequired, false);
});

test('completion batch의 후반 outcome contract failure는 앞 outcome도 registry에 부분 적용하지 않는다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 3 });
    const source = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry, {
        commandCapacity: 4,
        historyCapacity: 16
    });

    assert.equal(owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source),
        12,
        'spawn:atomic-completion:first'
    ).accepted, true);
    assert.equal(owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source, {
            positionOffset: { x: -0.5, y: 0.25 }
        }),
        12,
        'spawn:atomic-completion:second'
    ).accepted, true);
    const committed = owner.commitAtFixedBoundary(12);
    assert.equal(committed.sourceRelativeSpawns.length, 2);
    const firstDestination = committed.sourceRelativeSpawns[0].handle;
    const secondDestination = committed.sourceRelativeSpawns[1].handle;
    assert.equal(registry.getActiveCount(), 1);
    assert.equal(registry.getReservedCount(), 2);

    backend.addBody(firstDestination);
    backend.completionBatches.push({
        ...backend.getProtocol(),
        sourceTick: 12,
        outcomes: [{
            sourceHandle: source,
            destinationHandle: firstDestination,
            reason: 'resolved'
        }, {
            sourceHandle: source,
            destinationHandle: secondDestination,
            reason: 'contract-invalid-fixture'
        }]
    });

    const completion = owner.commitCompletedAtFixedBoundary(13);
    assert.equal(completion.protocolFailure.code, 'unknown-outcome');
    assert.equal(completion.completed.length, 0);
    assert.equal(registry.getActiveCount(), 1);
    assert.equal(registry.getReservedCount(), 2);
    assert.equal(registry.has(firstDestination), false);
    assert.equal(registry.has(secondDestination), false);
    assert.equal(owner.getPendingCount(), 2);
    assert.equal(owner.getStatus().recoveryRequired, true);

    backend.removeBody(firstDestination);
    owner.destroy();
    assert.equal(registry.getReservedCount(), 0);
});

test('backend fixed-program-capacity atomic reject는 due count 전체를 capacity telemetry에 기록한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 2 });
    const firstHandle = activateBody(registry, backend);
    const secondHandle = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry, {
        commandCapacity: 4,
        historyCapacity: 16
    });
    backend.stageFixedPrograms = (plan) => {
        backend.stagedPlans.push(plan);
        const dueCount = plan.controls.length
            + plan.sourceRelativeSpawns.length;
        return {
            accepted: 0,
            rejected: dueCount,
            reason: 'fixed-program-capacity',
            requiresRecovery: false
        };
    };

    assert.equal(owner.requestBodyControl({
        handle: firstHandle,
        moveIntentX: 1,
        moveIntentY: 0
    }, 20, 'control:backend-capacity:first').accepted, true);
    assert.equal(owner.requestBodyControl({
        handle: secondHandle,
        moveIntentX: 0,
        moveIntentY: 1
    }, 20, 'control:backend-capacity:second').accepted, true);

    const before = owner.getStatus().telemetry.capacityRejected;
    const committed = owner.commitAtFixedBoundary(20);
    assert.equal(committed.state, 'committed-with-rejections');
    assert.equal(committed.recoveryRequired, false);
    assert.equal(committed.controls.length, 0);
    assert.equal(committed.rejected.length, 2);
    assert.ok(Array.from(committed.rejected).every(
        ({ code }) => code === 'fixed-program-capacity'
    ));
    assert.equal(backend.stagedPlans.length, 1);
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(
        owner.getStatus().telemetry.capacityRejected - before,
        2
    );
});
