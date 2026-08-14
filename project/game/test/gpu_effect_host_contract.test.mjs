import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ENEMY_CAPABILITY_ID,
    createEnemyCapabilityMask
} = await loadGameModule('ingame/contract/enemy_capability_contract.js');
const {
    GPU_EFFECT_EVENT_TYPE,
    GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
    GPU_EFFECT_PULSE_PROGRAM_FLAG,
    GPU_EFFECT_PULSE_PROGRAM_RESULT,
    GPU_EFFECT_RUNTIME_STATUS,
    GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION
} = await loadGameModule('ingame/physics/gpu/gpu_effect_runtime_abi.js');
const {
    ENEMY_EFFECT_DEFINITION_BY_ID,
    ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
    PENTA_BOOST_EFFECT_DEFINITION_ID,
    PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_ID
} = await loadGameModule('data/object/enemy/enemy_effect_catalog_data.js');
const { WorldRegistry } = await loadGameModule(
    'ingame/object/world_registry.js'
);
const {
    GpuEffectCommandOwner,
    createGpuEffectPulseBatchId,
    createGpuEffectPulseCommandId
} = await loadGameModule(
    'ingame/object/enemy/gpu_effect_command_owner.js'
);
const { PentagonEffectDirector } = await loadGameModule(
    'ingame/object/enemy/pentagon_effect_director.js'
);

const EFFECT_CAPABILITY_MASK = createEnemyCapabilityMask([
    ENEMY_CAPABILITY_ID.EFFECT_EMITTER
]);
const PROFILE = ENEMY_EFFECT_EMITTER_PROFILE_BY_ID[
    PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_ID
];
const DEFINITION = ENEMY_EFFECT_DEFINITION_BY_ID[
    PENTA_BOOST_EFFECT_DEFINITION_ID
];

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function createMetadata() {
    return Object.freeze({
        capabilityMask: EFFECT_CAPABILITY_MASK,
        effectEmitterProfileId: PROFILE.id,
        effectEmitterDefinitionCode: PROFILE.emitterDefinitionCode,
        effectDefinitionId: DEFINITION.id,
        effectDefinitionCode: DEFINITION.effectDefinitionCode,
        effectSelfTargetAllowed: PROFILE.selfTargetAllowed,
        effectPentaTargetAllowed: PROFILE.pentaTargetAllowed,
        effectClusterRetargetIntervalTicks: PROFILE.retargetIntervalTicks,
        effectTowerContactDamageModifiable:
            DEFINITION.towerContactDamageEffectModifiable,
        effectProjectileTowerDamageModifiable:
            DEFINITION.projectileTowerDamageEffectModifiable,
        effectDirectCoreImpactDamageModifiable:
            DEFINITION.directCoreImpactDamageEffectModifiable,
        effectProjectileCoreDamageModifiable:
            DEFINITION.typedProjectileCoreDamageEffectModifiable
    });
}

function activateEmitter(registry, backend, createdAtTick = 1) {
    const handle = registry.reserveEntity({
        kindId: 'enemy',
        definitionId: 'basic_penta_01',
        createdAtTick
    });
    assert.ok(handle);
    assert.equal(registry.activateReserved(handle, createMetadata()), true);
    backend.bodies.add(handleKey(handle));
    return handle;
}

function createEffectBackend(sessionGeneration = 1, options = {}) {
    const completed = [];
    const staged = [];
    const bodies = new Set();
    let protocol = Object.freeze({
        sessionGeneration,
        deviceGeneration: options.deviceGeneration ?? 4,
        authoritativeEpoch: options.authoritativeEpoch ?? 7
    });
    let terminal = null;
    return {
        bodies,
        staged,
        completed,
        hasBody(handle) { return bodies.has(handleKey(handle)); },
        getEventProtocolState() { return protocol; },
        stageEffectPulseProgramBatch(batch) {
            const invalidRecord = batch.records.find((record) => {
                const sourceLive = bodies.has(
                    `${record.sourceEntityId}:${record.sourceIncarnation}`
                );
                const allowsSourceInvalid = (
                    record.flags
                    & GPU_EFFECT_PULSE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID
                ) !== 0;
                return sourceLive === allowsSourceInvalid;
            });
            if (invalidRecord) {
                return Object.freeze({
                    accepted: false,
                    abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
                    sourceTick: batch.sourceTick,
                    stagedCount: 0,
                    reason: 'effect-source-invalid-provenance'
                });
            }
            staged.push(batch);
            return Object.freeze({
                accepted: true,
                abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
                sourceTick: batch.sourceTick,
                stagedCount: batch.records.length
            });
        },
        drainCompletedEffectProgramBatches(out = []) {
            const drainedCount = completed.length;
            out.push(...completed.splice(0));
            if (drainedCount > 0 && options.advanceEpochOnDrain === true) {
                protocol = Object.freeze({
                    ...protocol,
                    authoritativeEpoch: protocol.authoritativeEpoch + 1
                });
            }
            return out;
        },
        cancelPendingEffectProgramsForTerminal(request) {
            const pulseProgramCount = staged.reduce(
                (count, batch) => count + batch.records.length,
                0
            );
            terminal = Object.freeze({
                abiVersion: GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION,
                state: 'armed',
                finalFixedTick: request.finalFixedTick,
                submittedTick: 0,
                pulseProgramCount,
                pendingPulseProgramCount: pulseProgramCount,
                pendingEffectReadbackCount: pulseProgramCount > 0 ? 1 : 0,
                failure: null
            });
            return terminal;
        },
        getEffectRuntimeStatus() {
            return Object.freeze({
                abiVersion: 1,
                state: 'idle',
                activePoolIndex: 0,
                sourceTick: 0,
                lastSubmittedTick: 0,
                completedThroughTick: 0,
                pendingPulseProgramCount: terminal?.pendingPulseProgramCount ?? 0,
                pendingEffectReadbackCount: terminal?.pendingEffectReadbackCount ?? 0,
                requiresRecovery: false,
                failure: null,
                terminal
            });
        }
    };
}

function createPulseCommand(sessionGeneration, tick, handle, pulseSequence = 0) {
    return Object.freeze({
        commandId: createGpuEffectPulseCommandId(
            sessionGeneration,
            tick,
            handle,
            pulseSequence
        ),
        targetFixedTick: tick,
        sourceHandle: Object.freeze({ ...handle }),
        effectEmitterProfileId: PROFILE.id,
        effectDefinitionId: DEFINITION.id,
        pulseSequence
    });
}

function createLifecycleProofHarness() {
    const authenticCommits = new WeakSet();
    return Object.freeze({
        port: Object.freeze({
            isAuthenticCommit(commit, fixedTick) {
                return authenticCommits.has(commit)
                    && commit?.fixedTick === fixedTick;
            }
        }),
        publish(commit) {
            authenticCommits.add(commit);
            return commit;
        }
    });
}

function createLifecycleCommit(fixedTick, despawned = []) {
    return Object.freeze({
        fixedTick,
        state: 'committed',
        spawned: Object.freeze([]),
        despawned: Object.freeze(despawned.map((entry) => Object.freeze({
            commandId: entry.commandId,
            handle: Object.freeze({ ...entry.handle }),
            reason: entry.reason
        }))),
        rejected: Object.freeze([]),
        recoveryRequired: false
    });
}

test('Effect owner whole-tick capacity는 256 program을 받고 257 program을 zero-partial 거절한다', () => {
    const sessionGeneration = 10;
    const registry = new WorldRegistry({ capacity: 257 });
    const backend = createEffectBackend(sessionGeneration);
    const handles = Array.from(
        { length: 257 },
        () => activateEmitter(registry, backend)
    );
    const createOwner = () => new GpuEffectCommandOwner(backend, registry, {
        sessionGeneration,
        effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
        effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
        commandCapacity: 256
    });

    const acceptedOwner = createOwner();
    const acceptedCommands = handles.slice(0, 256).map((handle) => (
        createPulseCommand(sessionGeneration, 1, handle)
    ));
    const acceptedBatchId = createGpuEffectPulseBatchId(
        sessionGeneration,
        1,
        acceptedCommands
    );
    const accepted = acceptedOwner.getCommandPort().requestPulseBatch({
        batchId: acceptedBatchId,
        targetFixedTick: 1,
        commands: acceptedCommands
    });
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.batchId, acceptedBatchId);
    assert.equal(accepted.targetFixedTick, 1);
    assert.equal(accepted.queuedCount, 256);
    assert.equal(accepted.commandIds.length, 256);
    acceptedOwner.destroy();

    const rejectedOwner = createOwner();
    const rejectedCommands = handles.map((handle) => (
        createPulseCommand(sessionGeneration, 2, handle)
    ));
    const rejectedBatchId = createGpuEffectPulseBatchId(
        sessionGeneration,
        2,
        rejectedCommands
    );
    const rejected = rejectedOwner.getCommandPort().requestPulseBatch({
        batchId: rejectedBatchId,
        targetFixedTick: 2,
        commands: rejectedCommands
    });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.reason, 'effect-command-capacity');
    assert.equal(rejected.queuedCount, 0);
    assert.equal(rejectedOwner.getStatus().pendingPulseProgramCount, 0);
    assert.equal(backend.staged.length, 0);
    rejectedOwner.destroy();
});

test('Effect owner는 same-tick P 전체를 한 batch로 stage하고 zero-target completion을 exact command로 enrich한다', () => {
    const sessionGeneration = 11;
    const registry = new WorldRegistry({ capacity: 8 });
    const backend = createEffectBackend(sessionGeneration, {
        advanceEpochOnDrain: true
    });
    const left = activateEmitter(registry, backend);
    const right = activateEmitter(registry, backend);
    const owner = new GpuEffectCommandOwner(backend, registry, {
        sessionGeneration,
        effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
        effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
        commandCapacity: 8
    });
    const commands = [left, right].map((handle) => (
        createPulseCommand(sessionGeneration, 5, handle)
    ));
    const batchId = createGpuEffectPulseBatchId(
        sessionGeneration,
        5,
        commands
    );
    const request = Object.freeze({
        batchId,
        targetFixedTick: 5,
        commands: Object.freeze(commands)
    });
    const receipt = owner.getCommandPort().requestPulseBatch(request);
    assert.equal(receipt.accepted, true);
    assert.equal(receipt.queuedCount, 2);
    assert.strictEqual(owner.getCommandPort().requestPulseBatch(request), receipt);

    const commit = owner.commitAtFixedBoundary(5);
    assert.equal(commit.recoveryRequired, false);
    assert.equal(commit.programs.length, 2);
    assert.equal(backend.staged.length, 1);
    assert.equal(backend.staged[0].records.length, 2);
    assert.equal('sourceSlot' in backend.staged[0].records[0], false);
    assert.equal(
        backend.staged[0].records[0].flags,
        GPU_EFFECT_PULSE_PROGRAM_FLAG.PENTA_TARGET_ALLOWED
            | GPU_EFFECT_PULSE_PROGRAM_FLAG.TOWER_CONTACT_DAMAGE_MODIFIABLE
            | GPU_EFFECT_PULSE_PROGRAM_FLAG.PROJECTILE_TOWER_DAMAGE_MODIFIABLE
    );
    assert.equal(
        backend.staged[0].records[0].retargetIntervalTicks,
        PROFILE.retargetIntervalTicks
    );

    backend.completed.push(Object.freeze({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        ...backend.getEventProtocolState(),
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 5,
        submittedTick: 5,
        completedThroughTick: 5,
        status: GPU_EFFECT_RUNTIME_STATUS.OK,
        candidateCount: 0,
        appliedInstanceCount: 0,
        eventCount: commands.length,
        pulseResults: Object.freeze(commands.map((command, programIndex) => (
            Object.freeze({
                programIndex,
                pulseSequence: command.pulseSequence,
                resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.ZERO_TARGET,
                candidateCount: 0,
                appliedCount: 0
            })
        ))),
        events: Object.freeze(commands.map((command, programIndex) => (
            Object.freeze({
                type: GPU_EFFECT_EVENT_TYPE.PULSE_EMITTED,
                flags: 0,
                effectInstanceId:
                    backend.staged[0].records[programIndex].fingerprint,
                instanceIncarnation: 7,
                sourceEntityId: command.sourceHandle.entityId,
                sourceIncarnation: command.sourceHandle.incarnation,
                targetEntityId: command.sourceHandle.entityId,
                targetIncarnation: command.sourceHandle.incarnation,
                effectDefinitionCode: DEFINITION.effectDefinitionCode,
                valueFixedPoint: 0,
                position: Object.freeze({ x: programIndex, y: 0 })
            })
        )))
    }));
    const completion = owner.commitCompletedAtFixedBoundary(6);
    assert.equal(completion.protocolFailure, null);
    assert.equal(completion.results.length, 2);
    assert.deepEqual(
        Array.from(completion.results, ({ commandId }) => commandId),
        Array.from(commands, ({ commandId }) => commandId)
    );
    assert.equal(owner.getStatus().pendingPulseProgramCount, 0);
    assert.equal(backend.getEventProtocolState().authoritativeEpoch, 8);
});

test('Effect owner는 pulse/application event의 exact source-target-definition provenance를 검증한다', () => {
    const sessionGeneration = 15;
    const registry = new WorldRegistry({ capacity: 4 });
    const backend = createEffectBackend(sessionGeneration);
    const sourceHandle = activateEmitter(registry, backend);
    const targetHandle = activateEmitter(registry, backend);
    const owner = new GpuEffectCommandOwner(backend, registry, {
        sessionGeneration,
        effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
        effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
        commandCapacity: 4
    });
    const commands = [createPulseCommand(sessionGeneration, 5, sourceHandle)];
    const batchId = createGpuEffectPulseBatchId(sessionGeneration, 5, commands);
    assert.equal(owner.getCommandPort().requestPulseBatch({
        batchId,
        targetFixedTick: 5,
        commands
    }).accepted, true);
    assert.equal(owner.commitAtFixedBoundary(5).programs.length, 1);
    const record = backend.staged[0].records[0];
    backend.completed.push(Object.freeze({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        ...backend.getEventProtocolState(),
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 5,
        submittedTick: 5,
        completedThroughTick: 5,
        status: GPU_EFFECT_RUNTIME_STATUS.OK,
        candidateCount: 1,
        appliedInstanceCount: 1,
        eventCount: 2,
        pulseResults: Object.freeze([Object.freeze({
            programIndex: 0,
            pulseSequence: 0,
            resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.APPLIED,
            candidateCount: 1,
            appliedCount: 1
        })]),
        events: Object.freeze([
            Object.freeze({
                type: GPU_EFFECT_EVENT_TYPE.PULSE_EMITTED,
                flags: 0,
                effectInstanceId: record.fingerprint,
                instanceIncarnation: 7,
                sourceEntityId: sourceHandle.entityId,
                sourceIncarnation: sourceHandle.incarnation,
                targetEntityId: sourceHandle.entityId,
                targetIncarnation: sourceHandle.incarnation,
                effectDefinitionCode: DEFINITION.effectDefinitionCode,
                valueFixedPoint: 1,
                position: Object.freeze({ x: 1, y: 2 })
            }),
            Object.freeze({
                type: GPU_EFFECT_EVENT_TYPE.INSTANCE_APPLIED,
                flags: 0,
                effectInstanceId: 1,
                instanceIncarnation: 7,
                sourceEntityId: sourceHandle.entityId,
                sourceIncarnation: sourceHandle.incarnation,
                targetEntityId: targetHandle.entityId,
                targetIncarnation: targetHandle.incarnation,
                effectDefinitionCode: DEFINITION.effectDefinitionCode,
                valueFixedPoint: 1,
                position: Object.freeze({ x: 3, y: 4 })
            })
        ])
    }));
    const completion = owner.commitCompletedAtFixedBoundary(6);
    assert.equal(completion.protocolFailure, null);
    assert.equal(completion.events.length, 2);
    assert.deepEqual(
        { ...completion.events[0].targetHandle },
        { ...sourceHandle }
    );
    assert.deepEqual(
        { ...completion.events[1].targetHandle },
        { ...targetHandle }
    );
});

for (const forgedCase of ['missing', 'extra', 'duplicate']) {
    test(`Effect owner는 ${forgedCase} forged event composition을 cadence mutation 전에 봉인한다`, () => {
        const sessionGeneration = forgedCase === 'missing'
            ? 40
            : forgedCase === 'extra'
                ? 41
                : 42;
        const registry = new WorldRegistry({ capacity: 4 });
        const backend = createEffectBackend(sessionGeneration);
        const sourceHandle = activateEmitter(registry, backend);
        const targetHandle = activateEmitter(registry, backend);
        const owner = new GpuEffectCommandOwner(backend, registry, {
            sessionGeneration,
            effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
            effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
            commandCapacity: 4
        });
        const commands = [createPulseCommand(sessionGeneration, 5, sourceHandle)];
        const batchId = createGpuEffectPulseBatchId(sessionGeneration, 5, commands);
        assert.equal(owner.getCommandPort().requestPulseBatch({
            batchId,
            targetFixedTick: 5,
            commands
        }).accepted, true);
        assert.equal(owner.commitAtFixedBoundary(5).programs.length, 1);
        const record = backend.staged[0].records[0];
        const appliedCount = forgedCase === 'duplicate' ? 2 : 1;
        const pulseEvent = Object.freeze({
            type: GPU_EFFECT_EVENT_TYPE.PULSE_EMITTED,
            flags: 0,
            effectInstanceId: record.fingerprint,
            instanceIncarnation: 7,
            sourceEntityId: sourceHandle.entityId,
            sourceIncarnation: sourceHandle.incarnation,
            targetEntityId: sourceHandle.entityId,
            targetIncarnation: sourceHandle.incarnation,
            effectDefinitionCode: DEFINITION.effectDefinitionCode,
            valueFixedPoint: appliedCount,
            position: Object.freeze({ x: 0, y: 0 })
        });
        const instanceEvent = Object.freeze({
            type: GPU_EFFECT_EVENT_TYPE.INSTANCE_APPLIED,
            flags: 0,
            effectInstanceId: 1,
            instanceIncarnation: 7,
            sourceEntityId: sourceHandle.entityId,
            sourceIncarnation: sourceHandle.incarnation,
            targetEntityId: targetHandle.entityId,
            targetIncarnation: targetHandle.incarnation,
            effectDefinitionCode: DEFINITION.effectDefinitionCode,
            valueFixedPoint: 1,
            position: Object.freeze({ x: 1, y: 1 })
        });
        const events = forgedCase === 'missing'
            ? [pulseEvent]
            : forgedCase === 'extra'
                ? [pulseEvent, pulseEvent, instanceEvent]
                : [pulseEvent, instanceEvent, instanceEvent];
        backend.completed.push(Object.freeze({
            abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
            ...backend.getEventProtocolState(),
            previousSourceTick: 0,
            previousSubmittedTick: 0,
            sourceTick: 5,
            submittedTick: 5,
            completedThroughTick: 5,
            status: GPU_EFFECT_RUNTIME_STATUS.OK,
            candidateCount: appliedCount,
            appliedInstanceCount: appliedCount,
            eventCount: events.length,
            pulseResults: Object.freeze([Object.freeze({
                programIndex: 0,
                pulseSequence: 0,
                resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.APPLIED,
                candidateCount: appliedCount,
                appliedCount
            })]),
            events: Object.freeze(events)
        }));
        const completion = owner.commitCompletedAtFixedBoundary(6);
        assert.equal(
            completion.protocolFailure.code,
            'effect-completion-protocol'
        );
        assert.equal(owner.getStatus().pendingPulseProgramCount, 1);
        assert.equal(owner.getStatus().recoveryRequired, true);
    });
}

test('Effect owner는 batch replay payload conflict와 whole-tick capacity failure를 mutation 전에 닫는다', () => {
    const sessionGeneration = 12;
    const registry = new WorldRegistry({ capacity: 8 });
    const backend = createEffectBackend(sessionGeneration);
    const first = activateEmitter(registry, backend);
    const second = activateEmitter(registry, backend);
    const owner = new GpuEffectCommandOwner(backend, registry, {
        sessionGeneration,
        effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
        effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
        commandCapacity: 1
    });
    const commands = [first, second].map((handle) => (
        createPulseCommand(sessionGeneration, 8, handle)
    ));
    const batchId = createGpuEffectPulseBatchId(sessionGeneration, 8, commands);
    assert.equal(owner.getCommandPort().requestPulseBatch({
        batchId,
        targetFixedTick: 8,
        commands
    }).reason, 'effect-command-capacity');
    assert.equal(owner.getStatus().pendingPulseProgramCount, 0);
    assert.equal(backend.staged.length, 0);

    const one = [commands[0]];
    const oneBatchId = createGpuEffectPulseBatchId(sessionGeneration, 8, one);
    assert.equal(owner.getCommandPort().requestPulseBatch({
        batchId: oneBatchId,
        targetFixedTick: 8,
        commands: one
    }).accepted, true);
    const conflict = owner.getCommandPort().requestPulseBatch({
        batchId: oneBatchId,
        targetFixedTick: 9,
        commands: one
    });
    assert.equal(conflict.accepted, false);
    assert.equal(conflict.reason, 'effect-batch-replay-conflict');
    assert.equal(owner.getStatus().recoveryRequired, true);
    assert.equal(backend.staged.length, 0);
});

test('Effect owner는 future completion을 보류하고 predecessor gap을 mutation 전 recovery로 봉인한다', () => {
    const sessionGeneration = 13;
    const registry = new WorldRegistry({ capacity: 4 });
    const backend = createEffectBackend(sessionGeneration);
    const handle = activateEmitter(registry, backend);
    const owner = new GpuEffectCommandOwner(backend, registry, {
        sessionGeneration,
        effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
        effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
        commandCapacity: 4
    });
    const commands = [createPulseCommand(sessionGeneration, 5, handle)];
    const batchId = createGpuEffectPulseBatchId(sessionGeneration, 5, commands);
    assert.equal(owner.getCommandPort().requestPulseBatch({
        batchId,
        targetFixedTick: 5,
        commands
    }).accepted, true);
    assert.equal(owner.commitAtFixedBoundary(5).recoveryRequired, false);
    backend.completed.push(Object.freeze({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        ...backend.getEventProtocolState(),
        previousSourceTick: 99,
        previousSubmittedTick: 99,
        sourceTick: 5,
        submittedTick: 5,
        completedThroughTick: 5,
        status: GPU_EFFECT_RUNTIME_STATUS.OK,
        candidateCount: 0,
        appliedInstanceCount: 0,
        eventCount: 0,
        pulseResults: Object.freeze([Object.freeze({
            programIndex: 0,
            pulseSequence: 0,
            resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.ZERO_TARGET,
            candidateCount: 0,
            appliedCount: 0
        })]),
        events: Object.freeze([])
    }));
    const future = owner.commitCompletedAtFixedBoundary(5);
    assert.equal(future.results.length, 0);
    assert.equal(owner.getStatus().deferredCompletionBatchCount, 1);
    const failed = owner.commitCompletedAtFixedBoundary(6);
    assert.equal(failed.protocolFailure.code, 'effect-completion-protocol');
    assert.equal(owner.getStatus().recoveryRequired, true);
    assert.equal(owner.getStatus().pendingPulseProgramCount, 1);
});

test('Effect owner는 future batch의 drain-time protocol을 보존해 idle epoch advance 뒤에도 authentic completion을 수락한다', () => {
    const sessionGeneration = 32;
    const registry = new WorldRegistry({ capacity: 2 });
    const backend = createEffectBackend(sessionGeneration, {
        advanceEpochOnDrain: true
    });
    const handle = activateEmitter(registry, backend);
    const owner = new GpuEffectCommandOwner(backend, registry, {
        sessionGeneration,
        effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
        effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
        commandCapacity: 2
    });
    const commands = [createPulseCommand(sessionGeneration, 5, handle)];
    const batchId = createGpuEffectPulseBatchId(sessionGeneration, 5, commands);
    assert.equal(owner.getCommandPort().requestPulseBatch({
        batchId,
        targetFixedTick: 5,
        commands
    }).accepted, true);
    assert.equal(owner.commitAtFixedBoundary(5).programs.length, 1);
    const record = backend.staged[0].records[0];
    backend.completed.push(Object.freeze({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        ...backend.getEventProtocolState(),
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 5,
        submittedTick: 5,
        completedThroughTick: 5,
        status: GPU_EFFECT_RUNTIME_STATUS.OK,
        candidateCount: 0,
        appliedInstanceCount: 0,
        eventCount: 1,
        pulseResults: Object.freeze([Object.freeze({
            programIndex: 0,
            pulseSequence: 0,
            resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.ZERO_TARGET,
            candidateCount: 0,
            appliedCount: 0
        })]),
        events: Object.freeze([Object.freeze({
            type: GPU_EFFECT_EVENT_TYPE.PULSE_EMITTED,
            flags: 0,
            effectInstanceId: record.fingerprint,
            instanceIncarnation: 7,
            sourceEntityId: handle.entityId,
            sourceIncarnation: handle.incarnation,
            targetEntityId: handle.entityId,
            targetIncarnation: handle.incarnation,
            effectDefinitionCode: DEFINITION.effectDefinitionCode,
            valueFixedPoint: 0,
            position: Object.freeze({ x: 0, y: 0 })
        })])
    }));
    const deferred = owner.commitCompletedAtFixedBoundary(5);
    assert.equal(deferred.results.length, 0);
    assert.equal(backend.getEventProtocolState().authoritativeEpoch, 8);
    const completion = owner.commitCompletedAtFixedBoundary(6);
    assert.equal(completion.protocolFailure, null);
    assert.equal(completion.results.length, 1);
    assert.equal(owner.getStatus().pendingPulseProgramCount, 0);
});

test('Effect owner는 completion watermark가 sourceTick과 다르면 mutation 전 fail-close한다', () => {
    const sessionGeneration = 33;
    const registry = new WorldRegistry({ capacity: 2 });
    const backend = createEffectBackend(sessionGeneration);
    const handle = activateEmitter(registry, backend);
    const owner = new GpuEffectCommandOwner(backend, registry, {
        sessionGeneration,
        effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
        effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
        commandCapacity: 2
    });
    const commands = [createPulseCommand(sessionGeneration, 5, handle)];
    const batchId = createGpuEffectPulseBatchId(sessionGeneration, 5, commands);
    assert.equal(owner.getCommandPort().requestPulseBatch({
        batchId,
        targetFixedTick: 5,
        commands
    }).accepted, true);
    assert.equal(owner.commitAtFixedBoundary(5).recoveryRequired, false);
    backend.completed.push(Object.freeze({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        ...backend.getEventProtocolState(),
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 5,
        submittedTick: 5,
        completedThroughTick: 6,
        status: GPU_EFFECT_RUNTIME_STATUS.OK,
        candidateCount: 0,
        appliedInstanceCount: 0,
        eventCount: 0,
        pulseResults: Object.freeze([Object.freeze({
            programIndex: 0,
            pulseSequence: 0,
            resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.ZERO_TARGET,
            candidateCount: 0,
            appliedCount: 0
        })]),
        events: Object.freeze([])
    }));

    const failed = owner.commitCompletedAtFixedBoundary(6);
    assert.equal(failed.protocolFailure.code, 'effect-completion-protocol');
    assert.equal(owner.getStatus().pendingPulseProgramCount, 1);
    assert.equal(owner.getStatus().completedThroughTick, 0);
    owner.destroy();
});

test('Effect owner는 same-boundary despawn source를 SOURCE_INVALID provenance로 정상 종결한다', () => {
    const sessionGeneration = 31;
    const registry = new WorldRegistry({ capacity: 2 });
    const backend = createEffectBackend(sessionGeneration);
    const handle = activateEmitter(registry, backend);
    const lifecycleProof = createLifecycleProofHarness();
    const owner = new GpuEffectCommandOwner(backend, registry, {
        sessionGeneration,
        effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
        effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
        commandCapacity: 2,
        lifecycleCommitProofPort: lifecycleProof.port
    });
    const commands = [createPulseCommand(sessionGeneration, 5, handle)];
    const batchId = createGpuEffectPulseBatchId(sessionGeneration, 5, commands);
    assert.equal(owner.getCommandPort().requestPulseBatch({
        batchId,
        targetFixedTick: 5,
        commands
    }).accepted, true);
    assert.equal(registry.remove(handle), true);
    backend.bodies.delete(handleKey(handle));
    const lifecycle = lifecycleProof.publish(createLifecycleCommit(5, [{
        commandId: 'gpu-death:5:0',
        handle,
        reason: 'gpu-death'
    }]));
    const retryLifecycle = lifecycleProof.publish(createLifecycleCommit(5));
    assert.equal(owner.commitAtFixedBoundary(
        5,
        Object.freeze([lifecycle, retryLifecycle])
    ).programs.length, 1);
    assert.equal(
        backend.staged[0].records[0].flags,
        GPU_EFFECT_PULSE_PROGRAM_FLAG.PENTA_TARGET_ALLOWED
            | GPU_EFFECT_PULSE_PROGRAM_FLAG.TOWER_CONTACT_DAMAGE_MODIFIABLE
            | GPU_EFFECT_PULSE_PROGRAM_FLAG.PROJECTILE_TOWER_DAMAGE_MODIFIABLE
            | GPU_EFFECT_PULSE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID
    );
    backend.completed.push(Object.freeze({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        ...backend.getEventProtocolState(),
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 5,
        submittedTick: 5,
        completedThroughTick: 5,
        status: GPU_EFFECT_RUNTIME_STATUS.OK,
        candidateCount: 0,
        appliedInstanceCount: 0,
        eventCount: 0,
        pulseResults: Object.freeze([Object.freeze({
            programIndex: 0,
            pulseSequence: 0,
            resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.SOURCE_INVALID,
            candidateCount: 0,
            appliedCount: 0
        })]),
        events: Object.freeze([])
    }));
    const completion = owner.commitCompletedAtFixedBoundary(6);
    assert.equal(completion.protocolFailure, null);
    assert.equal(completion.results[0].resultCode,
        GPU_EFFECT_PULSE_PROGRAM_RESULT.SOURCE_INVALID);
    assert.deepEqual(
        { ...completion.results[0].sourceHandle },
        { ...handle }
    );
    assert.equal(owner.getStatus().pendingPulseProgramCount, 0);
});

for (const proofCase of ['missing', 'forged', 'wrong-handle']) {
    test(`Effect owner는 ${proofCase} lifecycle 증거의 missing source batch를 zero-partial 거절한다`, () => {
        const sessionGeneration = proofCase === 'missing'
            ? 43
            : proofCase === 'forged'
                ? 44
                : 45;
        const registry = new WorldRegistry({ capacity: 3 });
        const backend = createEffectBackend(sessionGeneration);
        const handle = activateEmitter(registry, backend);
        const other = activateEmitter(registry, backend);
        const lifecycleProof = createLifecycleProofHarness();
        const owner = new GpuEffectCommandOwner(backend, registry, {
            sessionGeneration,
            effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
            effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
            commandCapacity: 3,
            lifecycleCommitProofPort: lifecycleProof.port
        });
        const commands = [createPulseCommand(sessionGeneration, 5, handle)];
        const batchId = createGpuEffectPulseBatchId(sessionGeneration, 5, commands);
        assert.equal(owner.getCommandPort().requestPulseBatch({
            batchId,
            targetFixedTick: 5,
            commands
        }).accepted, true);
        assert.equal(registry.remove(handle), true);
        backend.bodies.delete(handleKey(handle));
        const candidate = proofCase === 'missing'
            ? null
            : createLifecycleCommit(5, [{
                commandId: 'gpu-death:5:forged',
                handle: proofCase === 'wrong-handle' ? other : handle,
                reason: 'gpu-death'
            }]);
        const lifecycle = proofCase === 'wrong-handle'
            ? lifecycleProof.publish(candidate)
            : candidate;
        const commit = owner.commitAtFixedBoundary(5, lifecycle);
        assert.equal(commit.recoveryRequired, true);
        assert.equal(commit.programs.length, 0);
        assert.equal(backend.staged.length, 0);
        assert.equal(owner.getStatus().pendingPulseProgramCount, 1);
    });
}

test('Effect owner는 public ALLOW_SOURCE_INVALID flag 주입을 contract 단계에서 거절한다', () => {
    const sessionGeneration = 46;
    const registry = new WorldRegistry({ capacity: 2 });
    const backend = createEffectBackend(sessionGeneration);
    const handle = activateEmitter(registry, backend);
    const owner = new GpuEffectCommandOwner(backend, registry, {
        sessionGeneration,
        effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
        effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
        commandCapacity: 2
    });
    const command = {
        ...createPulseCommand(sessionGeneration, 5, handle),
        flags: GPU_EFFECT_PULSE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID
    };
    const receipt = owner.getCommandPort().requestPulseBatch({
        batchId: createGpuEffectPulseBatchId(sessionGeneration, 5, [command]),
        targetFixedTick: 5,
        commands: [command]
    });
    assert.equal(receipt.accepted, false);
    assert.equal(receipt.reason, 'effect-pulse-batch-contract');
    assert.equal(backend.staged.length, 0);
    assert.equal(owner.getStatus().recoveryRequired, false);
});

test('Effect owner는 live source의 forged SOURCE_INVALID completion을 fail-close한다', () => {
    const sessionGeneration = 47;
    const registry = new WorldRegistry({ capacity: 2 });
    const backend = createEffectBackend(sessionGeneration);
    const handle = activateEmitter(registry, backend);
    const owner = new GpuEffectCommandOwner(backend, registry, {
        sessionGeneration,
        effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
        effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
        commandCapacity: 2
    });
    const commands = [createPulseCommand(sessionGeneration, 5, handle)];
    assert.equal(owner.getCommandPort().requestPulseBatch({
        batchId: createGpuEffectPulseBatchId(sessionGeneration, 5, commands),
        targetFixedTick: 5,
        commands
    }).accepted, true);
    assert.equal(owner.commitAtFixedBoundary(5).programs.length, 1);
    assert.equal(
        backend.staged[0].records[0].flags
            & GPU_EFFECT_PULSE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID,
        0
    );
    backend.completed.push(Object.freeze({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        ...backend.getEventProtocolState(),
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 5,
        submittedTick: 5,
        completedThroughTick: 5,
        status: GPU_EFFECT_RUNTIME_STATUS.OK,
        candidateCount: 0,
        appliedInstanceCount: 0,
        eventCount: 0,
        pulseResults: Object.freeze([Object.freeze({
            programIndex: 0,
            pulseSequence: 0,
            resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.SOURCE_INVALID,
            candidateCount: 0,
            appliedCount: 0
        })]),
        events: Object.freeze([])
    }));
    const completion = owner.commitCompletedAtFixedBoundary(6);
    assert.equal(
        completion.protocolFailure.code,
        'effect-completion-protocol'
    );
    assert.equal(owner.getStatus().pendingPulseProgramCount, 1);
});

test('Effect owner는 generation tuple을 session-device-epoch 계층으로 비교해 old session을 stale drop한다', () => {
    const sessionGeneration = 30;
    const registry = new WorldRegistry({ capacity: 2 });
    const backend = createEffectBackend(sessionGeneration, {
        deviceGeneration: 1,
        authoritativeEpoch: 1
    });
    const owner = new GpuEffectCommandOwner(backend, registry, {
        sessionGeneration,
        effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
        effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
        commandCapacity: 2
    });
    backend.completed.push(Object.freeze({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        sessionGeneration: sessionGeneration - 1,
        deviceGeneration: 999,
        authoritativeEpoch: 999,
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 1,
        submittedTick: 1,
        completedThroughTick: 1,
        status: GPU_EFFECT_RUNTIME_STATUS.OK,
        candidateCount: 0,
        appliedInstanceCount: 0,
        eventCount: 0,
        pulseResults: Object.freeze([]),
        events: Object.freeze([])
    }));
    const completion = owner.commitCompletedAtFixedBoundary(2);
    assert.equal(completion.protocolFailure, null);
    assert.equal(completion.staleBatchCount, 1);
    assert.equal(owner.getStatus().recoveryRequired, false);
});

test('Effect terminal close는 in-flight owner state와 port를 즉시 회수하고 late completion을 no-op 처리한다', () => {
    const sessionGeneration = 14;
    const registry = new WorldRegistry({ capacity: 4 });
    const backend = createEffectBackend(sessionGeneration);
    const handle = activateEmitter(registry, backend);
    const owner = new GpuEffectCommandOwner(backend, registry, {
        sessionGeneration,
        effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
        effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
        commandCapacity: 4
    });
    const command = createPulseCommand(sessionGeneration, 5, handle);
    const commands = [command];
    const batchId = createGpuEffectPulseBatchId(sessionGeneration, 5, commands);
    const port = owner.getCommandPort();
    assert.equal(port.requestPulseBatch({
        batchId,
        targetFixedTick: 5,
        commands
    }).accepted, true);
    assert.equal(owner.commitAtFixedBoundary(5).programs.length, 1);
    const closed = owner.closeIngress('run-defeated', 6);
    assert.equal(closed.terminalCancellation.state, 'armed');
    assert.equal(closed.terminalCancellation.pulseProgramCount, 1);
    assert.equal(owner.getStatus().pendingPulseProgramCount, 0);
    assert.equal(port.requestPulseBatch({}).reason, 'effect-command-port-revoked');

    backend.completed.push(Object.freeze({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        ...backend.getEventProtocolState(),
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 5,
        submittedTick: 5,
        completedThroughTick: 5,
        status: GPU_EFFECT_RUNTIME_STATUS.OK,
        candidateCount: 0,
        appliedInstanceCount: 0,
        eventCount: 0,
        pulseResults: Object.freeze([Object.freeze({
            programIndex: 0,
            pulseSequence: 0,
            resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.ZERO_TARGET,
            candidateCount: 0,
            appliedCount: 0
        })]),
        events: Object.freeze([])
    }));
    const late = owner.commitCompletedAtFixedBoundary(7);
    assert.equal(late.results.length, 0);
    assert.equal(late.protocolFailure, null);
    assert.equal(owner.getStatus().pendingPulseProgramCount, 0);
});

test('Pentagon director는 lifecycle spawn+120 tick cadence와 zero-target completion을 SoA roster에서 전진시킨다', () => {
    const sessionGeneration = 21;
    const registry = new WorldRegistry({ capacity: 8 });
    const backend = createEffectBackend(sessionGeneration);
    const handle = activateEmitter(registry, backend, 1);
    const stagedRequests = [];
    const endpoint = {
        hasBody: (candidate) => backend.hasBody(candidate),
        getCapacity: () => 8,
        getStatus: () => Object.freeze({ sessionGeneration })
    };
    const effectCommandPort = Object.freeze({
        requestPulseBatch(batch) {
            stagedRequests.push(batch);
            return Object.freeze({
                accepted: true,
                batchId: batch.batchId,
                targetFixedTick: batch.targetFixedTick,
                queuedCount: batch.commands.length,
                replayed: false
            });
        }
    });
    const director = new PentagonEffectDirector({
        endpoint,
        registry,
        effectCommandPort,
        sessionGeneration,
        capacity: 8
    });
    director.observeLifecycle({
        recoveryRequired: false,
        despawned: [],
        spawned: [{ handle }]
    }, 1);
    assert.equal(director.getStatus().activeEmitterCount, 1);
    assert.equal(director.stageForFixedTick({ targetFixedTick: 120 }).stagedCount, 0);
    const stage = director.stageForFixedTick({ targetFixedTick: 121 });
    assert.equal(stage.accepted, true);
    assert.equal(stage.stagedCount, 1);
    assert.equal(stagedRequests.length, 1);

    const command = stagedRequests[0].commands[0];
    director.observeFixedCommit({
        recoveryRequired: false,
        effectPrograms: {
            state: 'committed',
            recoveryRequired: false,
            batchId: stage.batchId,
            programs: [{
                commandId: command.commandId,
                sourceHandle: command.sourceHandle,
                pulseSequence: 0
            }]
        }
    }, 121);
    const firstCompletionSnapshot = Object.freeze({
        fixedTick: 122,
        protocolFailure: null,
        results: Object.freeze([Object.freeze({
            commandId: command.commandId,
            sourceTick: 121,
            sourceHandle: command.sourceHandle,
            pulseSequence: 0,
            resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.ZERO_TARGET,
            candidateCount: 0,
            appliedCount: 0
        })])
    });
    director.observeCompletedEvents(firstCompletionSnapshot);
    assert.equal(director.getStatus().pendingPulseCount, 0);
    assert.equal(director.getStatus().lastCompletedSourceTick, 121);
    assert.equal(director.getStatus().telemetry.zeroTargetCompletionCount, 1);
    // 같은 fixed boundary의 downstream readback이 pending이면 owner가 같은
    // frozen snapshot object를 반환합니다. 이미 적용한 completion은 no-op입니다.
    director.observeCompletedEvents(firstCompletionSnapshot);
    assert.equal(director.requiresRecovery(), false);
    assert.equal(director.getStatus().pendingPulseCount, 0);
    assert.equal(director.getStatus().telemetry.completedPulseCount, 1);
    assert.equal(director.getStatus().telemetry.zeroTargetCompletionCount, 1);
    assert.equal(director.stageForFixedTick({ targetFixedTick: 240 }).stagedCount, 0);
    const secondStage = director.stageForFixedTick({ targetFixedTick: 241 });
    assert.equal(secondStage.stagedCount, 1);
    const secondCommand = stagedRequests[1].commands[0];
    director.observeFixedCommit({
        recoveryRequired: false,
        effectPrograms: {
            state: 'committed',
            recoveryRequired: false,
            batchId: secondStage.batchId,
            programs: [{
                commandId: secondCommand.commandId,
                sourceHandle: secondCommand.sourceHandle,
                pulseSequence: 1
            }]
        }
    }, 241);
    assert.ok(registry.remove(handle));
    backend.bodies.delete(handleKey(handle));
    director.observeLifecycle({
        recoveryRequired: false,
        despawned: [{ handle }],
        spawned: []
    }, 241);
    director.observeCompletedEvents({
        fixedTick: 242,
        protocolFailure: null,
        results: [{
            commandId: secondCommand.commandId,
            sourceTick: 241,
            sourceHandle: secondCommand.sourceHandle,
            pulseSequence: 1,
            resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.SOURCE_INVALID,
            candidateCount: 0,
            appliedCount: 0
        }]
    });
    assert.equal(director.getStatus().activeEmitterCount, 0);
    assert.equal(director.getStatus().telemetry.staleCompletionCount, 1);
    assert.equal(director.requiresRecovery(), false);

    director.closeForTerminal(241);
    assert.equal(director.stageForFixedTick({ targetFixedTick: 242 }).accepted, false);
    director.destroy();
});

test('Pentagon director는 same-boundary GPU materialization 전 비-Emitter lifecycle spawn을 무시한다', () => {
    const sessionGeneration = 211;
    const registry = new WorldRegistry({ capacity: 2 });
    const backend = createEffectBackend(sessionGeneration);
    const handle = registry.reserveEntity({
        kindId: 'enemy',
        definitionId: 'basic_hexa_group_01',
        createdAtTick: 5
    });
    assert.ok(handle);
    assert.equal(registry.activateReserved(handle, Object.freeze({
        capabilityMask: 0,
        effectEmitterProfileId: null
    })), true);
    assert.equal(backend.hasBody(handle), false);
    const director = new PentagonEffectDirector({
        endpoint: {
            hasBody: (candidate) => backend.hasBody(candidate),
            getCapacity: () => 2,
            getStatus: () => Object.freeze({ sessionGeneration })
        },
        registry,
        effectCommandPort: Object.freeze({
            requestPulseBatch() { throw new Error('not used'); }
        }),
        sessionGeneration,
        capacity: 2
    });

    director.observeLifecycle({
        recoveryRequired: false,
        despawned: [],
        spawned: [{ handle }]
    }, 5);
    assert.equal(director.getStatus().activeEmitterCount, 0);
    assert.equal(director.requiresRecovery(), false);
});

test('Pentagon director는 backend body가 없는 실제 Emitter spawn을 계속 fail-close한다', () => {
    const sessionGeneration = 212;
    const registry = new WorldRegistry({ capacity: 2 });
    const backend = createEffectBackend(sessionGeneration);
    const handle = activateEmitter(registry, backend, 5);
    backend.bodies.delete(handleKey(handle));
    const director = new PentagonEffectDirector({
        endpoint: {
            hasBody: (candidate) => backend.hasBody(candidate),
            getCapacity: () => 2,
            getStatus: () => Object.freeze({ sessionGeneration })
        },
        registry,
        effectCommandPort: Object.freeze({
            requestPulseBatch() { throw new Error('not used'); }
        }),
        sessionGeneration,
        capacity: 2
    });

    director.observeLifecycle({
        recoveryRequired: false,
        despawned: [],
        spawned: [{ handle }]
    }, 5);
    assert.equal(director.requiresRecovery(), true);
    assert.equal(director.getStatus().failure.code, 'effect-lifecycle-contract');
});

test('Pentagon director는 live roster SOURCE_INVALID completion을 recovery로 fail-close한다', () => {
    const sessionGeneration = 22;
    const registry = new WorldRegistry({ capacity: 3 });
    const backend = createEffectBackend(sessionGeneration);
    const left = activateEmitter(registry, backend, 1);
    const right = activateEmitter(registry, backend, 1);
    let stagedRequest = null;
    const director = new PentagonEffectDirector({
        endpoint: {
            hasBody: (candidate) => backend.hasBody(candidate),
            getCapacity: () => 3,
            getStatus: () => Object.freeze({ sessionGeneration })
        },
        registry,
        effectCommandPort: Object.freeze({
            requestPulseBatch(batch) {
                stagedRequest = batch;
                return Object.freeze({
                    accepted: true,
                    batchId: batch.batchId,
                    targetFixedTick: batch.targetFixedTick,
                    queuedCount: batch.commands.length,
                    replayed: false
                });
            }
        }),
        sessionGeneration,
        capacity: 3
    });
    director.observeLifecycle({
        recoveryRequired: false,
        despawned: [],
        spawned: [{ handle: left }, { handle: right }]
    }, 1);
    const stage = director.stageForFixedTick({ targetFixedTick: 121 });
    const [leftCommand, rightCommand] = stagedRequest.commands;
    director.observeFixedCommit({
        recoveryRequired: false,
        effectPrograms: {
            state: 'committed',
            recoveryRequired: false,
            batchId: stage.batchId,
            programs: stagedRequest.commands.map((command) => ({
                commandId: command.commandId,
                sourceHandle: command.sourceHandle,
                pulseSequence: 0
            }))
        }
    }, 121);

    director.observeCompletedEvents({
        fixedTick: 122,
        protocolFailure: null,
        results: [{
            commandId: leftCommand.commandId,
            sourceTick: 121,
            sourceHandle: leftCommand.sourceHandle,
            pulseSequence: 0,
            resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.ZERO_TARGET,
            candidateCount: 0,
            appliedCount: 0
        }, {
            commandId: rightCommand.commandId,
            sourceTick: 121,
            sourceHandle: rightCommand.sourceHandle,
            pulseSequence: 0,
            resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.SOURCE_INVALID,
            candidateCount: 0,
            appliedCount: 0
        }]
    });
    assert.equal(director.requiresRecovery(), true);
    assert.equal(
        director.getStatus().failure.code,
        'effect-completion-cadence'
    );
    assert.equal(director.getStatus().pendingPulseCount, 2);
    assert.equal(director.getStatus().telemetry.completedPulseCount, 0);
    assert.equal(director.getStatus().telemetry.zeroTargetCompletionCount, 0);
    director.destroy();
});

for (const [label, status] of [
    ['candidate', GPU_EFFECT_RUNTIME_STATUS.CANDIDATE_CAPACITY_EXCEEDED],
    ['instance', GPU_EFFECT_RUNTIME_STATUS.INSTANCE_CAPACITY_EXCEEDED],
    ['event', GPU_EFFECT_RUNTIME_STATUS.EVENT_CAPACITY_EXCEEDED],
    ['grid', GPU_EFFECT_RUNTIME_STATUS.GRID_OVERFLOW],
    ['combined', GPU_EFFECT_RUNTIME_STATUS.CANDIDATE_CAPACITY_EXCEEDED
        | GPU_EFFECT_RUNTIME_STATUS.GRID_OVERFLOW]
]) {
    test(`Effect ${label} capacity completion은 normal zero-partial로 watermark만 전진한다`, () => {
        const sessionGeneration = 60 + status;
        const registry = new WorldRegistry({ capacity: 2 });
        const backend = createEffectBackend(sessionGeneration);
        const handle = activateEmitter(registry, backend);
        const owner = new GpuEffectCommandOwner(backend, registry, {
            sessionGeneration,
            effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
            effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
            commandCapacity: 2
        });
        const commands = [createPulseCommand(sessionGeneration, 5, handle)];
        const batchId = createGpuEffectPulseBatchId(sessionGeneration, 5, commands);
        assert.equal(owner.getCommandPort().requestPulseBatch({
            batchId,
            targetFixedTick: 5,
            commands
        }).accepted, true);
        assert.equal(owner.commitAtFixedBoundary(5).programs.length, 1);
        backend.completed.push(Object.freeze({
            abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
            ...backend.getEventProtocolState(),
            previousSourceTick: 0,
            previousSubmittedTick: 0,
            sourceTick: 5,
            submittedTick: 5,
            completedThroughTick: 5,
            status,
            candidateCount: 0,
            appliedInstanceCount: 0,
            eventCount: 0,
            pulseResults: Object.freeze([Object.freeze({
                programIndex: 0,
                pulseSequence: 0,
                resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.CAPACITY_REJECTED,
                candidateCount: 0,
                appliedCount: 0
            })]),
            events: Object.freeze([])
        }));
        const completion = owner.commitCompletedAtFixedBoundary(6);
        assert.equal(completion.protocolFailure, null);
        assert.equal(completion.results.length, 1);
        assert.equal(
            completion.results[0].resultCode,
            GPU_EFFECT_PULSE_PROGRAM_RESULT.CAPACITY_REJECTED
        );
        const statusSnapshot = owner.getStatus();
        assert.equal(statusSnapshot.recoveryRequired, false);
        assert.equal(statusSnapshot.pendingPulseProgramCount, 0);
        assert.equal(statusSnapshot.completedThroughTick, 5);
        assert.equal(statusSnapshot.telemetry.capacityRejectedCount, 1);
    });
}

for (const forged of ['fatal-status-mix', 'forged-event']) {
    test(`Effect capacity ${forged}는 telemetry mutation 전 recovery로 봉인한다`, () => {
        const sessionGeneration = forged === 'fatal-status-mix' ? 80 : 81;
        const registry = new WorldRegistry({ capacity: 2 });
        const backend = createEffectBackend(sessionGeneration);
        const handle = activateEmitter(registry, backend);
        const owner = new GpuEffectCommandOwner(backend, registry, {
            sessionGeneration,
            effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
            effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
            commandCapacity: 2
        });
        const commands = [createPulseCommand(sessionGeneration, 5, handle)];
        assert.equal(owner.getCommandPort().requestPulseBatch({
            batchId: createGpuEffectPulseBatchId(sessionGeneration, 5, commands),
            targetFixedTick: 5,
            commands
        }).accepted, true);
        assert.equal(owner.commitAtFixedBoundary(5).programs.length, 1);
        const events = forged === 'forged-event'
            ? [Object.freeze({
                type: GPU_EFFECT_EVENT_TYPE.PULSE_EMITTED,
                flags: 0,
                effectInstanceId: backend.staged[0].records[0].fingerprint,
                instanceIncarnation: 7,
                sourceEntityId: handle.entityId,
                sourceIncarnation: handle.incarnation,
                targetEntityId: handle.entityId,
                targetIncarnation: handle.incarnation,
                effectDefinitionCode: DEFINITION.effectDefinitionCode,
                valueFixedPoint: 0,
                position: Object.freeze({ x: 0, y: 0 })
            })]
            : [];
        backend.completed.push(Object.freeze({
            abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
            ...backend.getEventProtocolState(),
            previousSourceTick: 0,
            previousSubmittedTick: 0,
            sourceTick: 5,
            submittedTick: 5,
            completedThroughTick: 5,
            status: forged === 'fatal-status-mix'
                ? GPU_EFFECT_RUNTIME_STATUS.GRID_OVERFLOW
                    | GPU_EFFECT_RUNTIME_STATUS.PROGRAM_CAPACITY_EXCEEDED
                : GPU_EFFECT_RUNTIME_STATUS.GRID_OVERFLOW,
            candidateCount: 0,
            appliedInstanceCount: 0,
            eventCount: events.length,
            pulseResults: Object.freeze([Object.freeze({
                programIndex: 0,
                pulseSequence: 0,
                resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.CAPACITY_REJECTED,
                candidateCount: 0,
                appliedCount: 0
            })]),
            events: Object.freeze(events)
        }));
        const completion = owner.commitCompletedAtFixedBoundary(6);
        assert.equal(completion.protocolFailure.code, 'effect-completion-protocol');
        const statusSnapshot = owner.getStatus();
        assert.equal(statusSnapshot.recoveryRequired, true);
        assert.equal(statusSnapshot.pendingPulseProgramCount, 1);
        assert.equal(statusSnapshot.completedThroughTick, 0);
        assert.equal(statusSnapshot.telemetry.capacityRejectedCount, 0);
    });
}

for (const reason of [
    'effect-command-capacity',
    'effect-command-history-capacity'
]) {
    test(`Pentagon director는 ${reason} receipt를 sequence 미소비 N+1 retry로 처리한다`, () => {
        const sessionGeneration = reason === 'effect-command-capacity' ? 90 : 91;
        const registry = new WorldRegistry({ capacity: 2 });
        const backend = createEffectBackend(sessionGeneration);
        const handle = activateEmitter(registry, backend, 1);
        const requests = [];
        const director = new PentagonEffectDirector({
            endpoint: {
                hasBody: (candidate) => backend.hasBody(candidate),
                getCapacity: () => 2,
                getStatus: () => Object.freeze({ sessionGeneration })
            },
            registry,
            effectCommandPort: Object.freeze({
                requestPulseBatch(batch) {
                    requests.push(batch);
                    if (requests.length === 1) {
                        return Object.freeze({
                            accepted: false,
                            batchId: batch.batchId,
                            targetFixedTick: batch.targetFixedTick,
                            queuedCount: 0,
                            reason
                        });
                    }
                    return Object.freeze({
                        accepted: true,
                        batchId: batch.batchId,
                        targetFixedTick: batch.targetFixedTick,
                        queuedCount: batch.commands.length,
                        replayed: false
                    });
                }
            }),
            sessionGeneration,
            capacity: 2
        });
        director.observeLifecycle({
            recoveryRequired: false,
            despawned: [],
            spawned: [{ handle }]
        }, 1);
        const rejected = director.stageForFixedTick({ targetFixedTick: 121 });
        assert.equal(rejected.accepted, false);
        assert.equal(rejected.reason, reason);
        assert.equal(rejected.recoveryRequired, false);
        assert.equal(director.getStatus().pendingPulseCount, 0);
        assert.equal(director.getStatus().telemetry.capacityRejectedStageCount, 1);
        assert.equal(
            director.stageForFixedTick({ targetFixedTick: 121 }).replayed,
            true
        );
        assert.equal(requests.length, 1);
        const retried = director.stageForFixedTick({ targetFixedTick: 122 });
        assert.equal(retried.accepted, true);
        assert.equal(retried.stagedCount, 1);
        assert.equal(requests[0].commands[0].pulseSequence, 0);
        assert.equal(requests[1].commands[0].pulseSequence, 0);
        assert.notEqual(requests[0].commands[0].commandId, requests[1].commands[0].commandId);
        assert.equal(director.requiresRecovery(), false);
    });
}

for (const forged of ['batch-id', 'queued-count', 'extra-field', 'replayed']) {
    test(`Pentagon director는 forged ${forged} capacity receipt를 fail-close한다`, () => {
        const sessionGeneration = 100 + [
            'batch-id', 'queued-count', 'extra-field', 'replayed'
        ].indexOf(forged);
        const registry = new WorldRegistry({ capacity: 2 });
        const backend = createEffectBackend(sessionGeneration);
        const handle = activateEmitter(registry, backend, 1);
        const director = new PentagonEffectDirector({
            endpoint: {
                hasBody: (candidate) => backend.hasBody(candidate),
                getCapacity: () => 2,
                getStatus: () => Object.freeze({ sessionGeneration })
            },
            registry,
            effectCommandPort: Object.freeze({
                requestPulseBatch(batch) {
                    return Object.freeze({
                        accepted: false,
                        batchId: forged === 'batch-id'
                            ? `${batch.batchId}:forged`
                            : batch.batchId,
                        targetFixedTick: batch.targetFixedTick,
                        queuedCount: forged === 'queued-count' ? 1 : 0,
                        reason: 'effect-command-capacity',
                        ...(forged === 'extra-field' ? { extra: true } : {}),
                        ...(forged === 'replayed' ? { replayed: false } : {})
                    });
                }
            }),
            sessionGeneration,
            capacity: 2
        });
        director.observeLifecycle({
            recoveryRequired: false,
            despawned: [],
            spawned: [{ handle }]
        }, 1);
        const receipt = director.stageForFixedTick({ targetFixedTick: 121 });
        assert.equal(receipt.accepted, false);
        assert.equal(receipt.recoveryRequired, true);
        assert.equal(director.requiresRecovery(), true);
        assert.equal(director.getStatus().pendingPulseCount, 0);
        assert.equal(director.getStatus().telemetry.capacityRejectedStageCount, 0);
    });
}

test('Pentagon delayed CAPACITY_REJECTED completion은 관찰 boundary에서 같은 sequence로 재시도한다', () => {
    const sessionGeneration = 110;
    const registry = new WorldRegistry({ capacity: 2 });
    const backend = createEffectBackend(sessionGeneration);
    const handle = activateEmitter(registry, backend, 1);
    const requests = [];
    const director = new PentagonEffectDirector({
        endpoint: {
            hasBody: (candidate) => backend.hasBody(candidate),
            getCapacity: () => 2,
            getStatus: () => Object.freeze({ sessionGeneration })
        },
        registry,
        effectCommandPort: Object.freeze({
            requestPulseBatch(batch) {
                requests.push(batch);
                return Object.freeze({
                    accepted: true,
                    batchId: batch.batchId,
                    targetFixedTick: batch.targetFixedTick,
                    queuedCount: batch.commands.length,
                    replayed: false
                });
            }
        }),
        sessionGeneration,
        capacity: 2
    });
    director.observeLifecycle({
        recoveryRequired: false,
        despawned: [],
        spawned: [{ handle }]
    }, 1);
    const stage = director.stageForFixedTick({ targetFixedTick: 121 });
    const command = requests[0].commands[0];
    director.observeFixedCommit({
        recoveryRequired: false,
        effectPrograms: {
            state: 'committed',
            recoveryRequired: false,
            batchId: stage.batchId,
            programs: [{
                commandId: command.commandId,
                sourceHandle: command.sourceHandle,
                pulseSequence: 0
            }]
        }
    }, 121);
    director.observeCompletedEvents({
        fixedTick: 130,
        protocolFailure: null,
        results: [{
            commandId: command.commandId,
            sourceTick: 121,
            sourceHandle: command.sourceHandle,
            pulseSequence: 0,
            resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.CAPACITY_REJECTED,
            candidateCount: 0,
            appliedCount: 0
        }]
    });
    assert.equal(director.requiresRecovery(), false);
    const retry = director.stageForFixedTick({ targetFixedTick: 130 });
    assert.equal(retry.accepted, true);
    assert.equal(retry.stagedCount, 1);
    assert.equal(requests[1].commands[0].pulseSequence, 0);
    assert.notEqual(requests[1].commands[0].commandId, command.commandId);
});
