import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
    GPU_FORMATION_PREPARE_PROGRAM_FLAG,
    GPU_FORMATION_PREPARE_RESULT,
    GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON,
    GPU_FORMATION_RUNTIME_ABI_VERSION,
    GPU_FORMATION_RUNTIME_STATUS,
    GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
    GPU_FORMATION_TRANSFORM_RESULT
} = await loadGameModule('ingame/physics/gpu/gpu_formation_runtime_abi.js');
const gameObjectSystemSource = await readFile(new URL(
    '../script/module/ingame/object/game_object_system.js',
    import.meta.url
), 'utf8');
const formationCommandOwnerSource = await readFile(new URL(
    '../script/module/ingame/object/enemy/gpu_formation_command_owner.js',
    import.meta.url
), 'utf8');

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

function createBackend(handle, { submittedTickCount = 4 } = {}) {
    const completed = [];
    const staged = [];
    let bodyLive = true;
    let formationRuntimeStatus = Object.freeze({
        abiVersion: GPU_FORMATION_RUNTIME_ABI_VERSION,
        requiresRecovery: false,
        lastTransformCompletion: null,
        terminal: null
    });
    const protocol = Object.freeze({
        sessionGeneration: 5,
        deviceGeneration: 2,
        authoritativeEpoch: 3,
        submittedTickCount
    });
    return {
        completed,
        staged,
        setBodyLive(value) { bodyLive = value === true; },
        setFormationRuntimeStatus(value) {
            formationRuntimeStatus = Object.freeze({ ...value });
        },
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
            return formationRuntimeStatus;
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

function createOwnerFixture(options = {}) {
    const registry = new WorldRegistry({ capacity: 2 });
    const handle = activateNaturalH(registry);
    const backend = createBackend(handle, options);
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
    return { owner, backend, handle };
}

test('prepare owner는 backend에 Formation ABI exact source identity를 전달한다', () => {
    const { backend, handle } = createOwnerFixture();
    const record = backend.staged[0].records[0];
    assert.equal(record.sourceEntityId, handle.entityId);
    assert.equal(record.sourceIncarnation, handle.incarnation);
    assert.equal(Object.hasOwn(record, 'entityId'), false);
    assert.equal(Object.hasOwn(record, 'incarnation'), false);
});

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

test('prepare 완료는 submit 직전 protocol watermark를 transform 권위로 보존한다', () => {
    const { owner, backend } = createOwnerFixture();
    backend.completed.push(sourceInvalidEnvelope(
        backend,
        GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.DIED_AFTER_STAGE
    ));

    const completed = owner.commitCompletedAtFixedBoundary(6);
    const prepared = owner.preparedByFingerprint.get(
        completed.batchIdFingerprint
    );
    assert.deepEqual(prepared.protocol, {
        sessionGeneration: 5,
        deviceGeneration: 2,
        authoritativeEpoch: 3,
        submittedTickCount: 4
    });
    assert.equal(Object.hasOwn(prepared.protocol, 'submittedTick'), false);
});

test('prepare submit watermark가 completion tick과 연속하지 않으면 fail-close한다', () => {
    const { owner, backend } = createOwnerFixture({ submittedTickCount: 3 });
    backend.completed.push(sourceInvalidEnvelope(
        backend,
        GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.DIED_AFTER_STAGE
    ));

    const completed = owner.commitCompletedAtFixedBoundary(6);
    assert.equal(completed.protocolFailure.code, 'completion-envelope-mismatch');
    assert.equal(owner.requiresRecovery(), true);
    assert.equal(owner.getStatus().preparedTransformBatchCount, 0);
});

test('N+1 첫 empty drain은 in-flight를 보존해 같은 boundary의 늦은 completion을 인증한다', () => {
    const { owner, backend } = createOwnerFixture();

    const firstAttempt = owner.commitCompletedAtFixedBoundary(6);
    assert.equal(firstAttempt.pending, true);
    assert.equal(firstAttempt.stale, false);
    assert.equal(firstAttempt.protocolFailure, null);
    assert.equal(owner.getStatus().inFlightPrepareBatchCount, 1);

    backend.completed.push(sourceInvalidEnvelope(
        backend,
        GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.DIED_AFTER_STAGE
    ));
    const retry = owner.commitCompletedAtFixedBoundary(6);
    assert.equal(retry.stale, false);
    assert.equal(retry.pending, undefined);
    assert.equal(retry.protocolFailure, null);
    assert.equal(retry.results.length, 1);
    assert.equal(owner.getStatus().inFlightPrepareBatchCount, 0);
    assert.equal(owner.requiresRecovery(), false);
});

test('GameObjectSystem은 Formation completion pending 동안 같은 fixed boundary를 보존한다', () => {
    assert.match(gameObjectSystemSource,
        /completedFormationPrograms\.pending === true\) \{\s*return false;/);
    assert.ok(
        gameObjectSystemSource.indexOf(
            'completedFormationPrograms.pending === true'
        ) < gameObjectSystemSource.indexOf(
            'completedFormationPrograms.protocolFailure'
        )
    );
});

test('Formation transform authored scalar는 GPU f32 정밀도로 completion과 비교된다', () => {
    assert.notEqual(Math.fround(0.12), 0.12);
    assert.match(
        formationCommandOwnerSource,
        /destinationRadius:\s*Math\.fround\(destinationIntent\.radius\)/
    );
    assert.match(
        formationCommandOwnerSource,
        /destinationInverseMass:\s*Math\.fround\(destinationIntent\.inverseMass\)/
    );
    assert.match(
        formationCommandOwnerSource,
        /destinationFlowSpeed:\s*Math\.fround\(destinationIntent\.flowSpeed\)/
    );
    assert.match(
        formationCommandOwnerSource,
        /destinationTowerContactDamage:\s*Math\.fround\(destinationIntent\.towerContactDamage\)/
    );
    assert.match(
        formationCommandOwnerSource,
        /result\.destinationTowerContactDamage\s*!==\s*authored\.destinationTowerContactDamage/
    );
});

test('Formation transform readback 지연은 같은 fixed boundary를 pending 보존한 뒤 exact 완료된다', () => {
    const { owner, backend } = createOwnerFixture();
    owner.inFlightBySourceTick.clear();
    const sourceA = Object.freeze({
        entityId: 1,
        incarnation: 1,
        memberCount: 1,
        occupiedSlotMask: 1,
        rotationStep: 0,
        generation: 1,
        lineageHash: 101,
        currentHealthCenti: 100,
        maxHealthCenti: 100
    });
    const sourceB = Object.freeze({
        ...sourceA,
        entityId: 2,
        lineageHash: 202
    });
    const destination = Object.freeze({
        entityId: 1,
        incarnation: 2,
        definitionCode: 1,
        coordinateSystemCode: 2,
        policyCode: 1,
        memberCount: 2,
        occupiedSlotMask: 3,
        rotationStep: 0,
        generation: 2,
        flags: 1,
        lineageHash: 303
    });
    const authored = Object.freeze({
        fingerprint: 404,
        sourceA,
        sourceB,
        destination,
        expectedCurrentHealthCenti: 220,
        expectedMaxHealthCenti: 220,
        destinationRadius: Math.fround(0.386080298),
        destinationInverseMass: Math.fround(0.5),
        destinationFlowSpeed: Math.fround(2.25),
        destinationTowerContactDamage: Math.fround(0.12),
        motionSourceIndex: 0
    });
    owner.pendingTransformCompletionByTick.set(5, Object.freeze({
        batchIdFingerprint: 505,
        transformBatchIdFingerprint: 606,
        targetFixedTick: 5,
        armedCount: 1,
        completionProtocol: Object.freeze({
            sessionGeneration: 5,
            deviceGeneration: 2,
            authoritativeEpoch: 3
        }),
        records: Object.freeze([authored])
    }));
    backend.setFormationRuntimeStatus({
        abiVersion: GPU_FORMATION_RUNTIME_ABI_VERSION,
        state: 'ready',
        sessionGeneration: 5,
        deviceGeneration: 2,
        authoritativeEpoch: 3,
        pendingTransformReadbackCount: 1,
        armedTransformCount: 0,
        commitRequested: false,
        requiresRecovery: false,
        failure: null,
        lastTransformCompletion: null
    });

    const pending = owner.commitCompletedAtFixedBoundary(6);
    assert.equal(pending.pending, true);
    assert.equal(pending.protocolFailure, null);
    assert.equal(owner.requiresRecovery(), false);
    assert.equal(owner.getStatus().pendingTransformCompletionCount, 1);

    backend.setFormationRuntimeStatus({
        abiVersion: GPU_FORMATION_RUNTIME_ABI_VERSION,
        state: 'ready',
        sessionGeneration: 5,
        deviceGeneration: 2,
        authoritativeEpoch: 3,
        pendingTransformReadbackCount: 0,
        armedTransformCount: 0,
        commitRequested: false,
        requiresRecovery: false,
        failure: null,
        lastTransformCompletion: Object.freeze({
            abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
            sessionGeneration: 5,
            deviceGeneration: 2,
            authoritativeEpoch: 3,
            preparedSourceTick: 4,
            sourceTick: 5,
            submittedTick: 5,
            completedThroughTick: 5,
            batchIdFingerprint: 606,
            programCount: 1,
            committedCount: 1,
            preparedEffectRekeyCount: 0,
            effectRekeyCount: 0,
            status: GPU_FORMATION_RUNTIME_STATUS.OK,
            results: Object.freeze([Object.freeze({
                result: GPU_FORMATION_TRANSFORM_RESULT.COMMITTED,
                fingerprint: 404,
                prepareBatchFingerprint: 505,
                preparedSourceTick: 4,
                targetFixedTick: 5,
                expectedCurrentHealthCenti: 220,
                expectedMaxHealthCenti: 220,
                destinationRadius: Math.fround(0.386080298),
                destinationInverseMass: Math.fround(0.5),
                destinationFlowSpeed: Math.fround(2.25),
                destinationTowerContactDamage: Math.fround(0.12),
                motionSourceIndex: 0,
                preparedEffectRekeyCount: 0,
                effectRekeyCount: 0,
                sourceA,
                sourceB,
                destination
            })])
        })
    });
    const completed = owner.commitCompletedAtFixedBoundary(6);
    assert.equal(completed.protocolFailure, null);
    assert.equal(completed.pending, false);
    assert.equal(owner.requiresRecovery(), false);
    assert.equal(owner.getStatus().pendingTransformCompletionCount, 0);
    assert.equal(owner.getStatus().lastValidatedTransformTick, 5);
});

test('완료가 끝내 오지 않은 in-flight는 다음 boundary에서 bounded retire된다', () => {
    const { owner } = createOwnerFixture();

    const pending = owner.commitCompletedAtFixedBoundary(6);
    assert.equal(pending.pending, true);
    assert.equal(pending.stale, false);
    assert.equal(owner.getStatus().inFlightPrepareBatchCount, 1);
    assert.equal(owner.commitCompletedAtFixedBoundary(7).stale, true);
    assert.equal(owner.getStatus().inFlightPrepareBatchCount, 0);
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

test('same-boundary Formation transform의 registry-missing/backend-live source는 authentic lifecycle proof로 stage된다', () => {
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
    assert.equal(backend.hasBody(handle), true);
    const lifecycle = Object.freeze({
        fixedTick: 5,
        spawned: Object.freeze([]),
        despawned: Object.freeze([Object.freeze({
            commandId: 'formation-transform:5:source:0',
            handle,
            reason: 'formation-transform'
        })]),
        rejected: Object.freeze([]),
        recoveryRequired: false
    });
    authentic.add(lifecycle);

    const committed = owner.commitAtFixedBoundary(5, lifecycle);
    assert.equal(committed.stagedCount, 1);
    assert.equal(backend.staged[0].records[0].flags,
        GPU_FORMATION_PREPARE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID);
    assert.equal(owner.requiresRecovery(), false);
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
