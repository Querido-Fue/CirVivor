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
const {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');
const { PROJECTILE_TARGET_POLICY_ID } = await loadGameModule(
    'ingame/contract/projectile_target_policy_contract.js'
);
const { GPU_CIRCLE_BODY_COLLISION_LAYER } = await loadGameModule(
    'ingame/physics/gpu/gpu_circle_body_abi.js'
);
const { createGpuRegistryMetadata } = await loadGameModule(
    'ingame/object/gpu_spawn_intent.js'
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
        damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
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

function createAimPointIntent(sourceHandle, overrides = {}) {
    return {
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT,
        sourceHandle,
        destinationSpawn: createProjectileIntent(),
        positionOffset: { x: 0.5, y: -0.25 },
        aimWorldPoint: { x: 9, y: -2 },
        launchSpeed: 18,
        ...overrides
    };
}

function createTargetEntityIntent(sourceHandle, targetHandle, overrides = {}) {
    return {
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        sourceHandle,
        targetHandle,
        destinationSpawn: createProjectileIntent(),
        positionOffset: { x: 0.5, y: -0.25 },
        targetOffset: { x: 0, y: 0 },
        launchSpeed: 12,
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
    assert.equal(registry.activateReserved(handle, createGpuRegistryMetadata({
        kindId: descriptor.kindId ?? 'tower-proxy-fixture',
        definitionId: descriptor.definitionId ?? 'phase3_controlled_body',
        teamId: descriptor.teamId ?? GAMEPLAY_TEAM_ID.PLAYER,
        damagePolicyId: descriptor.damagePolicyId
            ?? GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        allegiancePolicy: descriptor.allegiancePolicy
            ?? GAMEPLAY_ALLEGIANCE_POLICY.FIXED_PLAYER
    })), true);
    backend.addBody(handle, descriptor);
    return handle;
}

function queueSpawnOutcome(backend, {
    sourceTick,
    sourceHandle,
    targetHandle = null,
    destinationHandle,
    reason,
    protocol = backend.getProtocol()
}) {
    backend.completionBatches.push({
        ...protocol,
        sourceTick,
        outcomes: [{
            sourceHandle,
            ...(targetHandle ? { targetHandle } : {}),
            destinationHandle,
            reason
        }]
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
        createAimPointIntent(source, {
            destinationSpawn: createProjectileIntent({
                spawnSequence: 42,
                producerId: 'tower-primary-weapon',
                sourceAbilityId: 'primary-pointer-fire'
            }),
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
    ), /launchVelocity/);
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(registry.getReservedCount(), 0);
});

test('target-entity request는 Team/kind와 무관하게 exact target provenance를 주입·보존한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 4 });
    const source = activateBody(registry, backend, {
        kindId: 'enemy',
        definitionId: 'same-team-source',
        teamId: GAMEPLAY_TEAM_ID.PLAYER
    });
    const target = activateBody(registry, backend, {
        kindId: 'tower-proxy-fixture',
        definitionId: 'same-team-target',
        teamId: GAMEPLAY_TEAM_ID.PLAYER
    });
    const owner = new GpuFixedCommandOwner(backend, registry);
    const intent = createTargetEntityIntent(source, target);
    delete intent.targetOffset;

    const receipt = owner.requestSourceRelativeSpawn(
        intent,
        16,
        'spawn:target-entity:resolved'
    );
    assert.equal(receipt.accepted, true);
    const committed = owner.commitAtFixedBoundary(16);
    assert.equal(committed.sourceRelativeSpawns.length, 1);
    const destination = committed.sourceRelativeSpawns[0].handle;
    const staged = backend.stagedPlans[0].sourceRelativeSpawns[0];
    assert.equal(
        staged.modeFlags,
        GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY
    );
    assert.deepEqual({ ...staged.sourceHandle }, { ...source });
    assert.deepEqual({ ...staged.targetHandle }, { ...target });
    assert.deepEqual({ ...staged.positionOffset }, { x: 0.5, y: -0.25 });
    assert.deepEqual({ ...staged.targetOffset }, { x: 0, y: 0 });
    assert.equal(staged.launchSpeed, 12);
    assert.equal(staged.destinationSpawn.teamId, GAMEPLAY_TEAM_ID.PLAYER);
    assert.equal(staged.destinationSpawn.targetEntityId, target.entityId);
    assert.equal(staged.destinationSpawn.targetIncarnation, target.incarnation);
    assert.equal(Object.isFrozen(staged.targetHandle), true);
    assert.equal(Object.isFrozen(staged.targetOffset), true);
    assert.equal(registry.getReservedCount(), 1);

    backend.addBody(destination);
    queueSpawnOutcome(backend, {
        sourceTick: 16,
        sourceHandle: source,
        targetHandle: target,
        destinationHandle: destination,
        reason: 'resolved'
    });
    const completion = owner.commitCompletedAtFixedBoundary(17);
    assert.equal(completion.protocolFailure, null);
    assert.equal(completion.completed[0].outcome, 'resolved');
    const view = registry.copyEntityView(destination, {});
    assert.equal(view.metadata.sourceEntityId, source.entityId);
    assert.equal(view.metadata.sourceIncarnation, source.incarnation);
    assert.equal(view.metadata.targetEntityId, target.entityId);
    assert.equal(view.metadata.targetIncarnation, target.incarnation);
    assert.equal(owner.getStatus().recoveryRequired, false);
});

test('같은 completion boundary 재호출은 targeted resolved 결과를 exact 보존하고 다음 tick에서 비운다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 3 });
    const source = activateBody(registry, backend, {
        kindId: 'enemy',
        definitionId: 'archer-completion-retry',
        teamId: GAMEPLAY_TEAM_ID.HOSTILE
    });
    const target = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);

    assert.equal(owner.requestSourceRelativeSpawn(
        createTargetEntityIntent(source, target),
        27,
        'spawn:target-completion-retry'
    ).accepted, true);
    const staged = owner.commitAtFixedBoundary(27);
    const destination = staged.sourceRelativeSpawns[0].handle;
    backend.addBody(destination);
    queueSpawnOutcome(backend, {
        sourceTick: 27,
        sourceHandle: source,
        targetHandle: target,
        destinationHandle: destination,
        reason: 'resolved'
    });

    const first = owner.commitCompletedAtFixedBoundary(28);
    assert.deepEqual(
        Array.from(first.completed, ({ commandId, outcome }) => ({ commandId, outcome })),
        [{
            commandId: 'spawn:target-completion-retry',
            outcome: 'resolved'
        }]
    );
    const revisionAfterFirst = registry.getRevision();
    const telemetryAfterFirst = { ...owner.getStatus().telemetry };
    const activeAfterFirst = registry.getActiveCount();
    const reservedAfterFirst = registry.getReservedCount();
    const pendingAfterFirst = owner.getPendingCount();

    const sameTickRetry = owner.commitCompletedAtFixedBoundary(28);
    assert.equal(sameTickRetry, first);
    assert.equal(registry.getRevision(), revisionAfterFirst);
    assert.deepEqual({ ...owner.getStatus().telemetry }, telemetryAfterFirst);
    assert.equal(registry.getActiveCount(), activeAfterFirst);
    assert.equal(registry.getReservedCount(), reservedAfterFirst);
    assert.equal(owner.getPendingCount(), pendingAfterFirst);
    assert.equal(owner.getStatus().pendingDestinationCount, 0);

    const sameTickCommit = owner.commitAtFixedBoundary(28);
    assert.equal(sameTickCommit.completed.length, 1);
    assert.equal(
        sameTickCommit.completed[0].commandId,
        'spawn:target-completion-retry'
    );

    const nextTick = owner.commitCompletedAtFixedBoundary(29);
    assert.notEqual(nextTick, first);
    assert.equal(nextTick.fixedTick, 29);
    assert.equal(nextTick.completed.length, 0);
    assert.equal(nextTick.protocolFailure, null);
    assert.equal(owner.commitAtFixedBoundary(29).completed.length, 0);
});

test('같은 completion boundary의 새 batch는 prior 결과를 재적용하지 않고 증분 병합한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 4 });
    const source = activateBody(registry, backend, {
        kindId: 'enemy',
        definitionId: 'archer-completion-merge',
        teamId: GAMEPLAY_TEAM_ID.HOSTILE
    });
    const target = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);

    assert.equal(owner.requestSourceRelativeSpawn(
        createTargetEntityIntent(source, target),
        30,
        'spawn:target-completion-merge:first'
    ).accepted, true);
    assert.equal(owner.requestSourceRelativeSpawn(
        createTargetEntityIntent(source, target, {
            positionOffset: { x: -0.5, y: 0.25 }
        }),
        30,
        'spawn:target-completion-merge:second'
    ).accepted, true);
    const staged = owner.commitAtFixedBoundary(30);
    const firstDestination = staged.sourceRelativeSpawns[0].handle;
    const secondDestination = staged.sourceRelativeSpawns[1].handle;

    backend.addBody(firstDestination);
    queueSpawnOutcome(backend, {
        sourceTick: 30,
        sourceHandle: source,
        targetHandle: target,
        destinationHandle: firstDestination,
        reason: 'resolved'
    });
    const first = owner.commitCompletedAtFixedBoundary(31);
    assert.equal(first.completed.length, 1);
    assert.equal(owner.getStatus().telemetry.completedResolved, 1);
    assert.equal(owner.getStatus().pendingDestinationCount, 1);
    const revisionBeforeSecond = registry.getRevision();

    backend.addBody(secondDestination);
    queueSpawnOutcome(backend, {
        sourceTick: 30,
        sourceHandle: source,
        targetHandle: target,
        destinationHandle: secondDestination,
        reason: 'resolved'
    });
    const merged = owner.commitCompletedAtFixedBoundary(31);
    assert.deepEqual(
        Array.from(merged.completed, ({ commandId }) => commandId),
        [
            'spawn:target-completion-merge:first',
            'spawn:target-completion-merge:second'
        ]
    );
    assert.equal(registry.getRevision(), revisionBeforeSecond + 1);
    assert.equal(owner.getStatus().telemetry.completedResolved, 2);
    assert.equal(owner.getStatus().pendingDestinationCount, 0);
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(registry.getActiveCount(), 4);
    assert.equal(registry.getReservedCount(), 0);
});

test('target-entity schema는 exact metadata contradiction과 mode forbidden field를 reservation 전에 거부한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 4 });
    const source = activateBody(registry, backend);
    const target = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);

    assert.throws(() => owner.requestSourceRelativeSpawn(
        createTargetEntityIntent(source, target, {
            destinationSpawn: createProjectileIntent({
                targetEntityId: target.entityId
            })
        }),
        18,
        'spawn:target-partial-metadata'
    ), /targetEntityId\/targetIncarnation/);
    assert.throws(() => owner.requestSourceRelativeSpawn(
        createTargetEntityIntent(source, target, {
            destinationSpawn: createProjectileIntent({
                targetEntityId: target.entityId,
                targetIncarnation: target.incarnation + 1
            })
        }),
        18,
        'spawn:target-mismatched-metadata'
    ), /actual targetHandle/);
    assert.throws(() => owner.requestSourceRelativeSpawn(
        createTargetEntityIntent(source, target, {
            aimWorldPoint: { x: 3, y: 4 }
        }),
        18,
        'spawn:target-forbidden-aim'
    ), /aimWorldPoint/);
    const missingOffset = createTargetEntityIntent(source, target);
    delete missingOffset.positionOffset;
    assert.throws(() => owner.requestSourceRelativeSpawn(
        missingOffset,
        18,
        'spawn:target-missing-position-offset'
    ), /positionOffset/);
    assert.throws(() => owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source, { targetHandle: target }),
        18,
        'spawn:velocity-forbidden-target'
    ), /targetHandle/);
    assert.throws(() => owner.requestSourceRelativeSpawn(
        createTargetEntityIntent(source, target, {
            targetOffset: { x: 1e100, y: 0 }
        }),
        18,
        'spawn:target-float32-overflow'
    ), /float32/);
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(backend.stagedPlans.length, 0);
});

test('target request liveness는 source-first이고 stale target은 normal, target desync만 recovery다', () => {
    const staleBackend = createFakeBackend();
    const staleRegistry = new WorldRegistry({ capacity: 2 });
    const source = activateBody(staleRegistry, staleBackend);
    const staleOwner = new GpuFixedCommandOwner(staleBackend, staleRegistry);
    const staleTarget = { entityId: 91, incarnation: 4 };
    assert.deepEqual({ ...staleOwner.requestSourceRelativeSpawn(
        createTargetEntityIntent(source, staleTarget),
        19,
        'spawn:stale-target'
    ) }, {
        accepted: false,
        commandId: 'spawn:stale-target',
        reason: 'stale-target'
    });
    assert.equal(staleOwner.getStatus().recoveryRequired, false);
    assert.deepEqual({ ...staleOwner.requestSourceRelativeSpawn(
        createTargetEntityIntent(
            { entityId: 92, incarnation: 5 },
            staleTarget
        ),
        19,
        'spawn:both-stale'
    ) }, {
        accepted: false,
        commandId: 'spawn:both-stale',
        reason: 'stale-source'
    });

    const desyncBackend = createFakeBackend();
    const desyncRegistry = new WorldRegistry({ capacity: 2 });
    const desyncSource = activateBody(desyncRegistry, desyncBackend);
    const desyncTarget = activateBody(desyncRegistry, desyncBackend);
    desyncBackend.removeBody(desyncTarget);
    const desyncOwner = new GpuFixedCommandOwner(desyncBackend, desyncRegistry);
    assert.deepEqual({ ...desyncOwner.requestSourceRelativeSpawn(
        createTargetEntityIntent(desyncSource, desyncTarget),
        19,
        'spawn:target-desync'
    ) }, {
        accepted: false,
        commandId: 'spawn:target-desync',
        reason: 'registry-backend-desync'
    });
    assert.equal(desyncOwner.getStatus().recoveryRequired, true);
    assert.equal(desyncRegistry.getReservedCount(), 0);
});

test('commit-time stale target은 reservation 없이 spawn만 거절하고 같은 tick control은 유지한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 3 });
    const source = activateBody(registry, backend);
    const target = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);
    assert.equal(owner.requestSourceRelativeSpawn(
        createTargetEntityIntent(source, target),
        20,
        'spawn:commit-stale-target'
    ).accepted, true);
    assert.equal(owner.requestBodyControl({
        handle: source,
        moveIntentX: 1,
        moveIntentY: 0
    }, 20, 'control:commit-stale-target').accepted, true);
    backend.removeBody(target);
    assert.equal(registry.remove(target), true);

    const committed = owner.commitAtFixedBoundary(20);
    assert.equal(committed.state, 'committed-with-rejections');
    assert.equal(committed.recoveryRequired, false);
    assert.equal(committed.controls.length, 1);
    assert.equal(committed.sourceRelativeSpawns.length, 0);
    assert.deepEqual(
        Array.from(committed.rejected, ({ domain, code }) => ({ domain, code })),
        [{ domain: 'spawn', code: 'stale-target' }]
    );
    assert.equal(backend.stagedPlans[0].controls.length, 1);
    assert.equal(backend.stagedPlans[0].sourceRelativeSpawns.length, 0);
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(owner.getPendingCount(), 0);

    const bothBackend = createFakeBackend();
    const bothRegistry = new WorldRegistry({ capacity: 2 });
    const bothSource = activateBody(bothRegistry, bothBackend);
    const bothTarget = activateBody(bothRegistry, bothBackend);
    const bothOwner = new GpuFixedCommandOwner(bothBackend, bothRegistry);
    assert.equal(bothOwner.requestSourceRelativeSpawn(
        createTargetEntityIntent(bothSource, bothTarget),
        20,
        'spawn:commit-both-stale'
    ).accepted, true);
    bothBackend.removeBody(bothSource);
    bothBackend.removeBody(bothTarget);
    assert.equal(bothRegistry.remove(bothSource), true);
    assert.equal(bothRegistry.remove(bothTarget), true);
    const bothCommit = bothOwner.commitAtFixedBoundary(20);
    assert.deepEqual(
        Array.from(bothCommit.rejected, ({ domain, code }) => ({ domain, code })),
        [{ domain: 'spawn', code: 'stale-source' }]
    );
    assert.equal(bothCommit.recoveryRequired, false);
    assert.equal(bothRegistry.getReservedCount(), 0);
});

test('GPU target-invalid completion은 exact reservation을 normal cleanup하고 telemetry를 올린다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 3 });
    const source = activateBody(registry, backend);
    const target = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);
    assert.equal(owner.requestSourceRelativeSpawn(
        createTargetEntityIntent(source, target),
        21,
        'spawn:gpu-target-invalid'
    ).accepted, true);
    const committed = owner.commitAtFixedBoundary(21);
    const destination = committed.sourceRelativeSpawns[0].handle;
    assert.equal(registry.getReservedCount(), 1);
    assert.equal(backend.hasBody(destination), false);

    queueSpawnOutcome(backend, {
        sourceTick: 21,
        sourceHandle: source,
        targetHandle: target,
        destinationHandle: destination,
        reason: 'target-invalid'
    });
    const completion = owner.commitCompletedAtFixedBoundary(22);
    assert.equal(completion.protocolFailure, null);
    assert.deepEqual(
        Array.from(completion.completed, ({ commandId, outcome }) => ({
            commandId,
            outcome
        })),
        [{ commandId: 'spawn:gpu-target-invalid', outcome: 'target-invalid' }]
    );
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(registry.has(destination), false);
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(owner.getStatus().telemetry.completedTargetInvalid, 1);
    assert.equal(owner.getStatus().recoveryRequired, false);
});

test('targeted SpawnProgram pressure는 같은 tick control/fixed domain과 reservation을 오염시키지 않는다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 3 });
    const source = activateBody(registry, backend);
    const target = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry, {
        controlCommandCapacity: 1,
        sourceRelativeSpawnCommandCapacity: 1,
        historyCapacity: 8
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
                reason: 'spawn-program-capacity'
            }
        };
    };
    assert.equal(owner.requestSourceRelativeSpawn(
        createTargetEntityIntent(source, target),
        22,
        'spawn:target-pressure'
    ).accepted, true);
    assert.equal(owner.requestBodyControl({
        handle: source,
        moveIntentX: 0,
        moveIntentY: 1
    }, 22, 'control:target-pressure').accepted, true);

    const committed = owner.commitAtFixedBoundary(22);
    assert.equal(committed.state, 'committed-with-rejections');
    assert.equal(committed.recoveryRequired, false);
    assert.equal(committed.controls.length, 1);
    assert.equal(committed.sourceRelativeSpawns.length, 0);
    assert.equal(committed.rejected[0].code, 'spawn-program-capacity');
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(owner.getPendingCount(), 0);
});

test('source-relative materialization은 target policy/mask를 exact source Team 주입 뒤에도 보존한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 2 });
    const source = activateBody(registry, backend, {
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE
    });
    const owner = new GpuFixedCommandOwner(backend, registry);
    const targetPolicyId =
        PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN;
    const interactionMask = GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
        | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN;
    const destinationSpawn = createProjectileIntent({
        targetPolicyId,
        interactionMask
    });
    assert.equal(destinationSpawn.teamId, undefined);
    assert.equal(interactionMask, 640);

    assert.equal(owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source, { destinationSpawn }),
        16,
        'spawn:target-policy-materialization'
    ).accepted, true);
    const committed = owner.commitAtFixedBoundary(16);
    assert.equal(committed.sourceRelativeSpawns.length, 1);
    const staged = backend.stagedPlans[0].sourceRelativeSpawns[0];
    assert.equal(staged.destinationSpawn.teamId, GAMEPLAY_TEAM_ID.HOSTILE);
    assert.equal(staged.destinationSpawn.targetPolicyId, targetPolicyId);
    assert.equal(staged.destinationSpawn.interactionMask, interactionMask);
    assert.equal(staged.destinationSpawn.sourceEntityId, source.entityId);
    assert.equal(staged.destinationSpawn.sourceIncarnation, source.incarnation);
    assert.equal(Object.isFrozen(staged.destinationSpawn), true);

    const destination = committed.sourceRelativeSpawns[0].handle;
    backend.addBody(destination);
    queueSpawnOutcome(backend, {
        sourceTick: 16,
        sourceHandle: source,
        destinationHandle: destination,
        reason: 'resolved'
    });
    assert.equal(owner.commitCompletedAtFixedBoundary(17).completed.length, 1);
    const view = registry.copyEntityView(destination, {});
    assert.equal(view.metadata.teamId, GAMEPLAY_TEAM_ID.HOSTILE);
    assert.equal(view.metadata.targetPolicyId, targetPolicyId);
});

test('source-relative raw command는 getter sourceHandle을 한 번만 snapshot해 team/source drift를 막는다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 4 });
    const player = activateBody(registry, backend, {
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.FIXED_PLAYER
    });
    const hostile = activateBody(registry, backend, {
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE
    });
    const owner = new GpuFixedCommandOwner(backend, registry);
    const driftingIntent = createSourceRelativeIntent(player);
    let sourceHandleReadCount = 0;
    Object.defineProperty(driftingIntent, 'sourceHandle', {
        enumerable: true,
        get() {
            sourceHandleReadCount++;
            return sourceHandleReadCount === 1 ? player : hostile;
        }
    });

    assert.equal(owner.requestSourceRelativeSpawn(
        driftingIntent,
        17,
        'spawn:getter-source-snapshot'
    ).accepted, true);
    assert.equal(sourceHandleReadCount, 1);

    const committed = owner.commitAtFixedBoundary(17);
    assert.equal(committed.sourceRelativeSpawns.length, 1);
    const staged = backend.stagedPlans[0].sourceRelativeSpawns[0];
    assert.equal(handleKey(staged.sourceHandle), handleKey(player));
    assert.notEqual(handleKey(staged.sourceHandle), handleKey(hostile));
    assert.equal(staged.destinationSpawn.teamId, GAMEPLAY_TEAM_ID.PLAYER);
    assert.equal(staged.destinationSpawn.sourceEntityId, player.entityId);
    assert.equal(staged.destinationSpawn.sourceIncarnation, player.incarnation);
});

test('target raw Proxy는 ownKeys/source/target getter를 한 번만 읽고 target drift를 fingerprint로 막는다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 4 });
    const source = activateBody(registry, backend);
    const firstTarget = activateBody(registry, backend);
    const secondTarget = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);
    const raw = createTargetEntityIntent(source, firstTarget);
    let sourceReadCount = 0;
    let targetReadCount = 0;
    let ownKeysCount = 0;
    Object.defineProperty(raw, 'sourceHandle', {
        enumerable: true,
        configurable: true,
        get() {
            sourceReadCount++;
            return source;
        }
    });
    Object.defineProperty(raw, 'targetHandle', {
        enumerable: true,
        configurable: true,
        get() {
            targetReadCount++;
            return targetReadCount === 1 ? firstTarget : secondTarget;
        }
    });
    const proxied = new Proxy(raw, {
        ownKeys(target) {
            ownKeysCount++;
            return Reflect.ownKeys(target);
        }
    });

    assert.equal(owner.requestSourceRelativeSpawn(
        proxied,
        23,
        'spawn:target-proxy-snapshot'
    ).accepted, true);
    assert.equal(ownKeysCount, 1);
    assert.equal(sourceReadCount, 1);
    assert.equal(targetReadCount, 1);
    const committed = owner.commitAtFixedBoundary(23);
    const staged = backend.stagedPlans[0].sourceRelativeSpawns[0];
    assert.deepEqual({ ...staged.targetHandle }, { ...firstTarget });
    assert.equal(staged.destinationSpawn.targetEntityId, firstTarget.entityId);
    assert.equal(
        staged.destinationSpawn.targetIncarnation,
        firstTarget.incarnation
    );

    assert.equal(owner.requestSourceRelativeSpawn(
        createTargetEntityIntent(source, firstTarget),
        24,
        'spawn:target-command-id-drift'
    ).accepted, true);
    assert.throws(() => owner.requestSourceRelativeSpawn(
        createTargetEntityIntent(source, secondTarget),
        24,
        'spawn:target-command-id-drift'
    ), /다른 payload/);
});

test('source-relative snapshot은 frozen plain intent와 typed array를 보존하고 duplicate replay를 유지한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 3 });
    const source = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);
    const createFrozenTypedIntent = () => Object.freeze({
        sourceHandle: Object.freeze({ ...source }),
        destinationSpawn: Object.freeze({
            ...createProjectileIntent(),
            debugBytes: new Uint8Array([7, 11, 13])
        }),
        positionOffset: Object.freeze({ x: 0.5, y: -0.25 }),
        launchVelocity: Object.freeze({ x: 12, y: -3 }),
        sourceVelocityScale: 0.75
    });

    const first = owner.requestSourceRelativeSpawn(
        createFrozenTypedIntent(),
        18,
        'spawn:frozen-typed-replay'
    );
    const replay = owner.requestSourceRelativeSpawn(
        createFrozenTypedIntent(),
        18,
        'spawn:frozen-typed-replay'
    );
    assert.equal(first.accepted, true);
    assert.equal(replay.accepted, true);
    assert.equal(replay.replay, true);

    const committed = owner.commitAtFixedBoundary(18);
    const staged = backend.stagedPlans[0].sourceRelativeSpawns[0];
    assert.deepEqual(Array.from(staged.destinationSpawn.debugBytes), [7, 11, 13]);
    assert.equal(Object.isFrozen(staged.destinationSpawn.debugBytes), true);
});

test('source-relative snapshot은 cycle/function/symbol raw payload를 enqueue 전에 거부한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 2 });
    const source = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);
    const cyclic = createSourceRelativeIntent(source);
    cyclic.extra = cyclic;
    assert.throws(() => owner.requestSourceRelativeSpawn(
        cyclic,
        19,
        'spawn:cyclic-snapshot'
    ), /순환 참조/);

    assert.throws(() => owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source, { extra: () => {} }),
        19,
        'spawn:function-snapshot'
    ), /함수/);
    assert.throws(() => owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source, { extra: Symbol('snapshot') }),
        19,
        'spawn:symbol-snapshot'
    ), /symbol/);
    const symbolKey = createSourceRelativeIntent(source);
    symbolKey[Symbol('hidden-drift')] = 1;
    assert.throws(() => owner.requestSourceRelativeSpawn(
        symbolKey,
        19,
        'spawn:symbol-key-snapshot'
    ), /symbol/);
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(backend.stagedPlans.length, 0);
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

test('target completion mismatch는 batch 전체 registry mutation 없이 recovery를 강제한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 5 });
    const source = activateBody(registry, backend);
    const expectedTarget = activateBody(registry, backend);
    const wrongTarget = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry, {
        commandCapacity: 4,
        historyCapacity: 16
    });

    assert.equal(owner.requestSourceRelativeSpawn(
        createTargetEntityIntent(source, expectedTarget),
        25,
        'spawn:target-mismatch:first'
    ).accepted, true);
    assert.equal(owner.requestSourceRelativeSpawn(
        createTargetEntityIntent(source, expectedTarget, {
            positionOffset: { x: -0.5, y: 0.25 }
        }),
        25,
        'spawn:target-mismatch:second'
    ).accepted, true);
    const committed = owner.commitAtFixedBoundary(25);
    assert.equal(committed.sourceRelativeSpawns.length, 2);
    const firstDestination = committed.sourceRelativeSpawns[0].handle;
    const secondDestination = committed.sourceRelativeSpawns[1].handle;
    assert.equal(registry.getActiveCount(), 3);
    assert.equal(registry.getReservedCount(), 2);

    backend.addBody(firstDestination);
    const revisionBeforeCompletion = registry.getRevision();
    backend.completionBatches.push({
        ...backend.getProtocol(),
        sourceTick: 25,
        outcomes: [{
            sourceHandle: source,
            targetHandle: expectedTarget,
            destinationHandle: firstDestination,
            reason: 'resolved'
        }, {
            sourceHandle: source,
            targetHandle: wrongTarget,
            destinationHandle: secondDestination,
            reason: 'target-invalid'
        }]
    });

    const completion = owner.commitCompletedAtFixedBoundary(26);
    assert.equal(completion.protocolFailure.code, 'destination-contract');
    assert.equal(completion.completed.length, 0);
    assert.equal(registry.getRevision(), revisionBeforeCompletion);
    assert.equal(registry.getActiveCount(), 3);
    assert.equal(registry.getReservedCount(), 2);
    assert.equal(registry.has(firstDestination), false);
    assert.equal(registry.has(secondDestination), false);
    assert.equal(backend.hasBody(firstDestination), true);
    assert.equal(backend.hasBody(secondDestination), false);
    assert.equal(owner.getStatus().pendingDestinationCount, 2);
    assert.equal(owner.getStatus().recoveryRequired, true);
    assert.equal(owner.commitAtFixedBoundary(26).state, 'failed');

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

test('cancelAll은 pending fixed command와 destination reservation을 idempotent하게 회수하고 owner binding을 유지한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 3 });
    const source = activateBody(registry, backend);
    const owner = new GpuFixedCommandOwner(backend, registry);

    assert.equal(owner.requestBodyControl({
        handle: source,
        moveIntentX: 1,
        moveIntentY: 0
    }, 40, 'control:terminal-cancel').accepted, true);
    assert.equal(owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source),
        40,
        'spawn:terminal-cancel'
    ).accepted, true);
    assert.equal(owner.getPendingCount(), 2);
    assert.equal(registry.getReservedCount(), 0);

    assert.deepEqual({ ...owner.cancelAll() }, {
        cancelledCommandCount: 2,
        releasedDestinationCount: 0,
        failedDestinationCount: 0
    });
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(owner.getStatus().pendingControlCount, 0);
    assert.equal(owner.getStatus().pendingSourceRelativeSpawnCount, 0);
    assert.equal(registry.getReservedCount(), 0);
    assert.deepEqual({ ...owner.cancelAll() }, {
        cancelledCommandCount: 0,
        releasedDestinationCount: 0,
        failedDestinationCount: 0
    });

    const emptyFinal = owner.commitAtFixedBoundary(40);
    assert.equal(emptyFinal.state, 'committed');
    assert.deepEqual(Array.from(emptyFinal.controls), []);
    assert.deepEqual(Array.from(emptyFinal.sourceRelativeSpawns), []);
    assert.deepEqual(Array.from(emptyFinal.rejected), []);
    assert.equal(backend.stagedPlans.length, 0);

    assert.equal(owner.requestSourceRelativeSpawn(
        createSourceRelativeIntent(source),
        41,
        'spawn:terminal-reservation'
    ).accepted, true);
    const staged = owner.commitAtFixedBoundary(41);
    assert.equal(staged.sourceRelativeSpawns.length, 1);
    assert.equal(owner.getStatus().pendingDestinationCount, 1);
    assert.equal(registry.getReservedCount(), 1);
    assert.deepEqual({ ...owner.cancelAll() }, {
        cancelledCommandCount: 0,
        releasedDestinationCount: 1,
        failedDestinationCount: 0
    });
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(owner.getStatus().pendingDestinationCount, 0);
    assert.equal(registry.getReservedCount(), 0);
    assert.deepEqual({ ...owner.cancelAll() }, {
        cancelledCommandCount: 0,
        releasedDestinationCount: 0,
        failedDestinationCount: 0
    });

    // cancel은 owner/runtime protocol binding을 파괴하지 않습니다.
    assert.equal(owner.requestBodyControl({
        handle: source,
        moveIntentX: 0,
        moveIntentY: 1
    }, 42, 'control:after-terminal-cancel').accepted, true);
    assert.equal(owner.commitAtFixedBoundary(42).controls.length, 1);
    assert.equal(backend.stagedPlans.length, 2);
});
