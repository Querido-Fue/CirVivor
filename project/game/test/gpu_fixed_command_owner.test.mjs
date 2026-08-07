import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { WorldRegistry } = await loadGameModule(
    'ingame/object/world_registry.js'
);
const { GpuFixedCommandOwner } = await loadGameModule(
    'ingame/object/gpu_fixed_command_owner.js'
);
const { GPU_SPAWN_PROGRAM_MODE } = await loadGameModule(
    'ingame/physics/gpu/gpu_fixed_primitive_abi.js'
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

test('legacy explicit commandCapacity는 control/spawn이 공유하는 inbox 상한을 보존한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 2 });
    const source = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry, {
        commandCapacity: 1,
        historyCapacity: 8
    });

    assert.equal(owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source),
        2,
        'spawn:legacy-shared-capacity'
    ).accepted, true);
    const control = owner.requestBodyControl({
        handle: source,
        moveIntentX: 1,
        moveIntentY: 0
    }, 2, 'control:legacy-shared-capacity');
    assert.deepEqual({ ...control }, {
        accepted: false,
        commandId: 'control:legacy-shared-capacity',
        reason: 'command-capacity'
    });
    const status = owner.getStatus();
    assert.equal(status.capacity, 1);
    assert.equal(status.pendingSourceRelativeSpawnCount, 1);
    assert.equal(status.pendingControlCount, 0);
    owner.destroy();
});

test('default와 explicit domain inbox는 spawn 포화가 control enqueue를 막지 않는다', () => {
    for (const options of [
        {},
        {
            controlCommandCapacity: 1,
            sourceRelativeSpawnCommandCapacity: 2,
            historyCapacity: 16
        }
    ]) {
        const backend = createFakeBackend();
        const registry = new WorldRegistry({ capacity: 1 });
        const source = activateBody(registry, backend);
        const owner = new GpuFixedCommandOwner(backend, registry, options);
        const spawnCapacity = owner.getStatus().sourceRelativeSpawnCapacity;
        for (let index = 0; index < spawnCapacity; index++) {
            assert.equal(owner.requestSourceRelativeSpawn(
                createSourceRelativeIntent(source, {
                    positionOffset: { x: index, y: -index }
                }),
                2,
                `spawn:domain-capacity:${spawnCapacity}:${index}`
            ).accepted, true);
        }
        assert.equal(owner.requestSourceRelativeSpawn(
            createSourceRelativeIntent(source),
            2,
            `spawn:domain-capacity:${spawnCapacity}:overflow`
        ).accepted, false);
        assert.equal(owner.requestBodyControl({
            handle: source,
            moveIntentX: 1,
            moveIntentY: 0
        }, 2, `control:after-spawn-capacity:${spawnCapacity}`).accepted, true);
        const status = owner.getStatus();
        assert.equal(status.pendingSourceRelativeSpawnCount, spawnCapacity);
        assert.equal(status.pendingControlCount, 1);
        owner.destroy();
    }
});

test('registry capacity failure는 source-relative batch만 zero-partial rollback하고 동일 tick control은 수락한다', () => {
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
    assert.equal(owner.requestBodyControl({
        handle: source,
        moveIntentX: 1,
        moveIntentY: 0
    }, 5, 'control:survives-registry-pressure').accepted, true);

    const commit = owner.commitAtFixedBoundary(5);
    assert.equal(commit.controls.length, 1);
    assert.equal(commit.sourceRelativeSpawns.length, 0);
    assert.deepEqual(
        Array.from(commit.rejected, (entry) => ({
            domain: entry.domain,
            code: entry.code
        })),
        [{ domain: 'spawn', code: 'registry-capacity' }, {
            domain: 'spawn',
            code: 'registry-capacity'
        }]
    );
    assert.equal(commit.recoveryRequired, false);
    assert.equal(backend.stagedPlans.length, 1);
    assert.equal(backend.stagedPlans[0].controls.length, 1);
    assert.equal(backend.stagedPlans[0].sourceRelativeSpawns.length, 0);
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

test('source-relative owner는 exact source provenance를 주입하고 mismatch/partial metadata를 enqueue 전 거부한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 4 });
    const source = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);

    const accepted = owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source, {
            destinationSpawn: createProjectileIntent({
                spawnSequence: 42,
                producerId: 'tower-primary-weapon',
                sourceAbilityId: 'primary-pointer-fire'
            }),
            modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT,
            launchVelocity: undefined,
            sourceVelocityScale: undefined,
            aimWorldPoint: { x: 9, y: -2 },
            launchSpeed: 18
        }),
        14,
        'spawn:provenance'
    );
    assert.equal(accepted.accepted, true);
    const committed = owner.commitAtFixedBoundary(14);
    assert.equal(committed.controls.length, 0);
    assert.equal(committed.sourceRelativeSpawns.length, 1);
    const staged = backend.stagedPlans[0].sourceRelativeSpawns[0];
    assert.equal(staged.modeFlags, GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT);
    assert.deepEqual({ ...staged.aimWorldPoint }, { x: 9, y: -2 });
    assert.equal(staged.launchSpeed, 18);
    assert.equal('launchVelocity' in staged, false);
    assert.equal('sourceVelocityScale' in staged, false);
    assert.equal(staged.destinationSpawn.sourceEntityId, source.entityId);
    assert.equal(staged.destinationSpawn.sourceIncarnation, source.incarnation);
    assert.equal(staged.destinationSpawn.producerId, 'tower-primary-weapon');
    assert.equal(staged.destinationSpawn.sourceAbilityId, 'primary-pointer-fire');
    assert.equal(Object.isFrozen(staged.destinationSpawn), true);

    const destination = committed.sourceRelativeSpawns[0].handle;
    backend.addBody(destination);
    queueSpawnOutcome(backend, {
        sourceTick: 14,
        sourceHandle: source,
        destinationHandle: destination,
        reason: 'resolved'
    });
    assert.equal(owner.commitCompletedAtFixedBoundary(15).completed.length, 1);
    const view = registry.copyEntityView(destination, {});
    assert.equal(view.metadata.sourceEntityId, source.entityId);
    assert.equal(view.metadata.sourceIncarnation, source.incarnation);
    assert.equal(view.metadata.spawnSequence, 42);
    assert.equal(view.metadata.producerId, 'tower-primary-weapon');
    assert.equal(view.metadata.sourceAbilityId, 'primary-pointer-fire');

    assert.throws(() => owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source, {
            destinationSpawn: createProjectileIntent({
                sourceEntityId: source.entityId
            })
        }),
        16,
        'spawn:partial-provenance'
    ), /sourceEntityId\/sourceIncarnation/);
    assert.throws(() => owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source, {
            destinationSpawn: createProjectileIntent({
                sourceEntityId: source.entityId,
                sourceIncarnation: source.incarnation + 1
            })
        }),
        16,
        'spawn:mismatched-provenance'
    ), /정확히 일치/);
    assert.throws(() => owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source, {
            modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT,
            aimWorldPoint: { x: 1, y: 2 },
            launchSpeed: 18
        }),
        16,
        'spawn:aim-forbidden-velocity'
    ), /launchVelocity\/sourceVelocityScale/);
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(registry.getReservedCount(), 0);
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

test('body/program/result-ring spawn pressure는 control을 수락하고 destination reservation을 전부 회수한다', () => {
    for (const reason of [
        'body-capacity',
        'spawn-program-capacity',
        'spawn-program-readback-capacity'
    ]) {
        const backend = createFakeBackend();
        const registry = new WorldRegistry({ capacity: 3 });
        const source = activateBody(registry, backend);
        const owner = new GpuFixedCommandOwner(backend, registry, {
            controlCommandCapacity: 1,
            sourceRelativeSpawnCommandCapacity: 2,
            historyCapacity: 16
        });
        backend.stageFixedPrograms = (plan) => {
            backend.stagedPlans.push(plan);
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
                    reason
                }
            };
        };

        assert.equal(owner.requestBodyControl({
            handle: source,
            moveIntentX: 1,
            moveIntentY: 0
        }, 20, `control:${reason}`).accepted, true);
        assert.equal(owner.requestSourceRelativeSpawn(
            createSourceRelativeIntent(source),
            20,
            `spawn:${reason}:a`
        ).accepted, true);
        assert.equal(owner.requestSourceRelativeSpawn(
            createSourceRelativeIntent(source, {
                positionOffset: { x: -0.5, y: 0.25 }
            }),
            20,
            `spawn:${reason}:b`
        ).accepted, true);

        const committed = owner.commitAtFixedBoundary(20);
        assert.equal(committed.state, 'committed-with-rejections', reason);
        assert.equal(committed.recoveryRequired, false, reason);
        assert.equal(committed.controls.length, 1, reason);
        assert.equal(committed.sourceRelativeSpawns.length, 0, reason);
        assert.deepEqual(
            Array.from(committed.rejected, ({ domain, code }) => ({ domain, code })),
            [{ domain: 'spawn', code: reason }, { domain: 'spawn', code: reason }],
            reason
        );
        assert.equal(backend.stagedPlans.length, 1, reason);
        assert.equal(backend.stagedPlans[0].controls.length, 1, reason);
        assert.equal(backend.stagedPlans[0].sourceRelativeSpawns.length, 2, reason);
        assert.equal(registry.getActiveCount(), 1, reason);
        assert.equal(registry.getReservedCount(), 0, reason);
        assert.equal(owner.getPendingCount(), 0, reason);
        assert.equal(owner.getStatus().recoveryRequired, false, reason);
    }
});

test('backend이 source batch를 partial accept하면 계약 오염으로 recovery하고 모든 reservation을 zero-partial 회수한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 3 });
    const source = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry, {
        controlCommandCapacity: 1,
        sourceRelativeSpawnCommandCapacity: 2,
        historyCapacity: 16
    });
    backend.stageFixedPrograms = (plan) => {
        backend.stagedPlans.push(plan);
        return {
            accepted: 1,
            rejected: 1,
            requiresRecovery: false,
            controls: { accepted: 0, rejected: 0, reason: null },
            sourceRelativeSpawns: {
                accepted: 1,
                rejected: 1,
                reason: 'spawn-program-partial'
            }
        };
    };

    assert.equal(owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source),
        30,
        'spawn:partial:a'
    ).accepted, true);
    assert.equal(owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source, {
            positionOffset: { x: -0.5, y: 0.25 }
        }),
        30,
        'spawn:partial:b'
    ).accepted, true);

    const committed = owner.commitAtFixedBoundary(30);
    assert.equal(committed.state, 'failed');
    assert.equal(committed.recoveryRequired, true);
    assert.equal(committed.sourceRelativeSpawns.length, 0);
    assert.equal(committed.protocolFailure.stage, 'fixed-command-domain');
    assert.equal(committed.protocolFailure.code, 'spawn-domain-partial');
    assert.ok(Array.from(committed.rejected).every(
        ({ domain, code }) => domain === 'spawn'
            && code === 'spawn-program-partial'
    ));
    assert.equal(registry.getActiveCount(), 1);
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(owner.getStatus().recoveryRequired, true);
});

test('backend control domain reject는 spawn 정상 거부와 달리 protocol failure/recovery로 올린다', () => {
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
        return {
            accepted: 0,
            rejected: plan.controls.length,
            reason: 'control-program-capacity',
            requiresRecovery: false,
            controls: {
                accepted: 0,
                rejected: plan.controls.length,
                reason: 'control-program-capacity'
            },
            sourceRelativeSpawns: {
                accepted: 0,
                rejected: 0,
                reason: null
            }
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

    const committed = owner.commitAtFixedBoundary(20);
    assert.equal(committed.state, 'failed');
    assert.equal(committed.recoveryRequired, true);
    assert.equal(committed.controls.length, 0);
    assert.equal(committed.rejected.length, 2);
    assert.ok(Array.from(committed.rejected).every(
        ({ domain, code }) => domain === 'control'
            && code === 'control-program-capacity'
    ));
    assert.equal(committed.protocolFailure.stage, 'fixed-command-domain');
    assert.equal(committed.protocolFailure.code, 'control-domain-rejected');
    assert.equal(backend.stagedPlans.length, 1);
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(owner.getStatus().recoveryRequired, true);
});
