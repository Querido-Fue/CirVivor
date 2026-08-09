import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { WorldRegistry } = await loadGameModule('ingame/object/world_registry.js');
const { GpuFormationCommandOwner } = await loadGameModule(
    'ingame/object/enemy/gpu_formation_command_owner.js'
);
const { BASIC_HEXA_ENEMY_DATA } = await loadGameModule(
    'data/object/enemy/basic_hexa_enemy_data.js'
);
const {
    createGpuEnemySpawnIntent,
    materializeNaturalHexaFormationActivation
} = await loadGameModule('ingame/object/enemy/gpu_enemy_spawn_adapter.js');
const { createGpuRegistryMetadata } = await loadGameModule(
    'ingame/object/gpu_spawn_intent.js'
);
const {
    GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
    GPU_FORMATION_PREPARE_RESULT,
    GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON,
    GPU_FORMATION_RUNTIME_ABI_VERSION,
    GPU_FORMATION_RUNTIME_STATUS
} = await loadGameModule('ingame/physics/gpu/gpu_formation_runtime_abi.js');

function activateNaturalH(registry) {
    const intent = createGpuEnemySpawnIntent({
        definition: BASIC_HEXA_ENEMY_DATA,
        route: {
            gateId: 'formation-owner-gate',
            pathId: 'formation-owner-path',
            waypoints: [{ x: 1, y: 1 }, { x: 2, y: 1 }]
        },
        spawnSequence: 1,
        waveId: 'formation-owner-wave'
    });
    const handle = registry.reserveEntity({
        kindId: 'enemy',
        definitionId: BASIC_HEXA_ENEMY_DATA.id,
        createdAtTick: 1
    });
    const activation = materializeNaturalHexaFormationActivation(intent, handle);
    assert.equal(registry.activateReserved(
        handle,
        createGpuRegistryMetadata(activation)
    ), true);
    return handle;
}

function createBackend(handle) {
    const completed = [];
    const staged = [];
    let bodyLive = true;
    const protocol = Object.freeze({
        sessionGeneration: 5,
        deviceGeneration: 2,
        authoritativeEpoch: 3
    });
    return {
        completed,
        staged,
        setBodyLive(value) { bodyLive = value === true; },
        hasBody(candidate) {
            return bodyLive
                && candidate.entityId === handle.entityId
                && candidate.incarnation === handle.incarnation;
        },
        stageFormationPrepareBatch(batch) {
            staged.push(batch);
            return Object.freeze({
                abiVersion: GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
                accepted: true,
                targetFixedTick: batch.targetFixedTick,
                stagedCount: batch.records.length,
                replayed: false,
                requiresRecovery: false
            });
        },
        drainCompletedFormationPrepareBatches(out = []) {
            out.push(...completed.splice(0));
            return out;
        },
        armPreparedFormationTransformBatch() { throw new Error('not used'); },
        commitArmedFormationTransformBatch() { throw new Error('not used'); },
        cancelArmedFormationTransformBatch() { throw new Error('not used'); },
        cancelPendingFormationProgramsForTerminal() { throw new Error('not used'); },
        getFormationRuntimeStatus() {
            return Object.freeze({
                abiVersion: GPU_FORMATION_RUNTIME_ABI_VERSION,
                requiresRecovery: false,
                lastTransformCompletion: null,
                terminal: null
            });
        },
        getEventProtocolState() { return protocol; }
    };
}

function sourceInvalidEnvelope(backend, reason) {
    const batch = backend.staged[0];
    const record = batch.records[0];
    return Object.freeze({
        abiVersion: GPU_FORMATION_RUNTIME_ABI_VERSION,
        sessionGeneration: 5,
        deviceGeneration: 2,
        authoritativeEpoch: 3,
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 5,
        submittedTick: 5,
        completedThroughTick: 5,
        batchIdFingerprint: batch.batchIdFingerprint,
        programCount: 1,
        resultCount: 1,
        pairCount: 0,
        gridSmallOverflow: 0,
        gridBigOverflow: 0,
        status: GPU_FORMATION_RUNTIME_STATUS.OK,
        results: Object.freeze([Object.freeze({
            programIndex: 0,
            sourceEntityId: record.sourceEntityId,
            sourceIncarnation: record.sourceIncarnation,
            prepareSequence: record.prepareSequence,
            fingerprint: record.fingerprint,
            result: GPU_FORMATION_PREPARE_RESULT.SOURCE_INVALID,
            flags: record.flags,
            sourceInvalidReason: reason
        })])
    });
}

function createOwnerFixture() {
    const registry = new WorldRegistry({ capacity: 2 });
    const handle = activateNaturalH(registry);
    const backend = createBackend(handle);
    const owner = new GpuFormationCommandOwner(
        backend,
        registry,
        Object.freeze({ requestAtomicTransformBatch() { throw new Error('not used'); } }),
        { sessionGeneration: 5, commandCapacity: 2 }
    );
    assert.equal(owner.getCommandPort().requestPrepareBatch({
        targetFixedTick: 5,
        records: [{ sourceHandle: handle, prepareSequence: 0 }]
    }).accepted, true);
    assert.equal(owner.commitAtFixedBoundary(5).stagedCount, 1);
    return { owner, backend };
}

test('exact live staged H의 DIED_AFTER_STAGE는 normal SOURCE_INVALID로 완료된다', () => {
    const { owner, backend } = createOwnerFixture();
    backend.completed.push(sourceInvalidEnvelope(
        backend,
        GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.DIED_AFTER_STAGE
    ));
    const completed = owner.commitCompletedAtFixedBoundary(6);
    assert.equal(completed.protocolFailure, null);
    assert.equal(completed.results.length, 1);
    assert.equal(completed.results[0].result, GPU_FORMATION_PREPARE_RESULT.SOURCE_INVALID);
    assert.equal(completed.pairs.length, 0);
    assert.equal(completed.stale, false);
    assert.equal(owner.requiresRecovery(), false);
});

for (const forgedReason of [
    GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.NONE,
    GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.LIFECYCLE_REMOVED
]) {
    test(`no-ALLOW SOURCE_INVALID reason ${forgedReason}은 mutation 전 fail-close한다`, () => {
        const { owner, backend } = createOwnerFixture();
        backend.completed.push(sourceInvalidEnvelope(backend, forgedReason));
        const completed = owner.commitCompletedAtFixedBoundary(6);
        assert.equal(completed.protocolFailure.code, 'completion-result-mismatch');
        assert.equal(owner.requiresRecovery(), true);
        assert.equal(owner.getStatus().inFlightPrepareBatchCount, 1);
        assert.equal(owner.getStatus().lastPrepareCompletedTick, 0);
    });
}

test('ALLOW lifecycle-removed stage가 live NO_PAIR로 되돌아오면 fail-close한다', () => {
    const registry = new WorldRegistry({ capacity: 2 });
    const handle = activateNaturalH(registry);
    const backend = createBackend(handle);
    const authentic = new WeakSet();
    const owner = new GpuFormationCommandOwner(
        backend,
        registry,
        Object.freeze({ requestAtomicTransformBatch() { throw new Error('not used'); } }),
        {
            sessionGeneration: 5,
            commandCapacity: 2,
            lifecycleCommitProofPort: Object.freeze({
                isAuthenticCommit(commit, fixedTick) {
                    return authentic.has(commit) && commit?.fixedTick === fixedTick;
                }
            })
        }
    );
    assert.equal(owner.getCommandPort().requestPrepareBatch({
        targetFixedTick: 5,
        records: [{ sourceHandle: handle, prepareSequence: 0 }]
    }).accepted, true);
    assert.equal(registry.remove(handle), true);
    backend.setBodyLive(false);
    const lifecycle = Object.freeze({
        fixedTick: 5,
        spawned: Object.freeze([]),
        despawned: Object.freeze([Object.freeze({
            commandId: 'gpu-death:5:0',
            handle,
            reason: 'gpu-death'
        })]),
        rejected: Object.freeze([]),
        recoveryRequired: false
    });
    authentic.add(lifecycle);
    assert.equal(owner.commitAtFixedBoundary(5, lifecycle).stagedCount, 1);
    const envelope = sourceInvalidEnvelope(
        backend,
        GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.NONE
    );
    backend.completed.push(Object.freeze({
        ...envelope,
        results: Object.freeze([Object.freeze({
            ...envelope.results[0],
            result: GPU_FORMATION_PREPARE_RESULT.NO_PAIR
        })])
    }));
    const completed = owner.commitCompletedAtFixedBoundary(6);
    assert.equal(completed.protocolFailure.code, 'completion-result-mismatch');
    assert.equal(owner.requiresRecovery(), true);
    assert.equal(owner.getStatus().inFlightPrepareBatchCount, 1);
});

test('GPU-world replacement는 old Formation command port를 revoke하고 fresh owner를 pending-zero로 시작한다', () => {
    const { owner } = createOwnerFixture();
    const stalePort = owner.getCommandPort();
    assert.equal(owner.getStatus().inFlightPrepareBatchCount, 1);

    owner.destroy();
    const destroyed = owner.getStatus();
    assert.equal(destroyed.destroyed, true);
    assert.equal(destroyed.pendingPrepareBatchCount, 0);
    assert.equal(destroyed.inFlightPrepareBatchCount, 0);
    assert.equal(destroyed.preparedTransformBatchCount, 0);
    assert.equal(destroyed.armedTransformBatchCount, 0);
    assert.equal(destroyed.pendingTransformCompletionCount, 0);
    assert.equal(destroyed.backend, null);
    assert.throws(() => stalePort.requestPrepareBatch({
        targetFixedTick: 6,
        records: []
    }));

    const replacementRegistry = new WorldRegistry({ capacity: 2 });
    const replacementHandle = activateNaturalH(replacementRegistry);
    const replacementBackend = createBackend(replacementHandle);
    const replacement = new GpuFormationCommandOwner(
        replacementBackend,
        replacementRegistry,
        Object.freeze({ requestAtomicTransformBatch() { throw new Error('not used'); } }),
        { sessionGeneration: 6, commandCapacity: 2 }
    );
    const fresh = replacement.getStatus();
    assert.equal(fresh.destroyed, false);
    assert.equal(fresh.pendingPrepareBatchCount, 0);
    assert.equal(fresh.inFlightPrepareBatchCount, 0);
    assert.equal(fresh.preparedTransformBatchCount, 0);
    assert.equal(fresh.armedTransformBatchCount, 0);
    assert.equal(fresh.pendingTransformCompletionCount, 0);
    assert.equal(fresh.recoveryRequired, false);
});

console.log('GpuFormationCommandOwner contract: ok');
