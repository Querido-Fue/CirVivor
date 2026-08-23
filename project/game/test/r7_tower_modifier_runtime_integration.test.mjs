import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';
import { WorldRegistry } from '../script/module/ingame/object/world_registry.js';

const {
    ABILITY_CREATION_ORIGIN_CODE,
    ABILITY_SUBJECT_SNAPSHOT_STATUS,
    normalizeAbilityExecutionCommand
} = await loadGameModule('ingame/contract/ability_execution_contract.js');
const {
    ABILITY_SLOT_ID,
    SENTENCE_ACTION_CODE,
    normalizeSentenceDefinition
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    R5_SHOWCASE_SENTENCE_LOADOUT,
    R6_QA_SENTENCE_LOADOUT,
    R6_TOWERS_MERGE_SENTENCE,
    R7_QA_SENTENCE_LOADOUT,
    R7_TOWER_SHOOTS_TOWERS_TWICE_SENTENCE,
    R7_TWICE_WORD_INSTANCE_2
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    R5_SHOOT_ACTOR_ACTION_PROFILE
} = await loadGameModule('data/word/r5_actor_action_profile_data.js');
const {
    R5_TOWER_ACTOR_PAYLOAD_DEFINITION
} = await loadGameModule('ingame/contract/actor_payload_contract.js');
const {
    GPU_ACTOR_ACTION_PLACEMENT_STATUS
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_action_placement_abi.js'
);
const {
    SentenceCompiler
} = await loadGameModule('ingame/word/sentence_compiler.js');
const {
    ABILITY_EXECUTION_OUTCOME_CODE,
    WordSystem
} = await loadGameModule('ingame/word/word_system.js');
const {
    ActorPayloadMaterializer
} = await loadGameModule('ingame/word/actor_payload_materializer.js');
const {
    TOWER_CREATION_COORDINATOR_MODE,
    TOWER_CREATION_RESULT,
    TOWER_GROUP_RECORD_STATE,
    TOWER_RECOVERY_PLACEMENT_POLICY_ID,
    TOWER_SHARE_SCALE,
    freezeTowerCreationMetadata
} = await loadGameModule('ingame/object/tower/tower_group_contract.js');
const {
    PRIMARY_TOWER_LOGICAL_ID,
    TowerGroupState
} = await loadGameModule('ingame/object/tower/tower_group_state.js');
const {
    TowerCreationCoordinator
} = await loadGameModule('ingame/object/tower/tower_creation_coordinator.js');
const {
    createGpuTowerSpawnIntent
} = await loadGameModule('ingame/object/tower/gpu_tower_spawn_adapter.js');
const {
    GPU_TOWER_CREATION_ABI,
    GPU_TOWER_CREATION_ABI_VERSION,
    GPU_TOWER_CREATION_MODE,
    GPU_TOWER_CREATION_STATUS,
    computeGpuTowerCreationMetadataRecordFingerprint
} = await loadGameModule('ingame/physics/gpu/gpu_tower_creation_abi.js');
const {
    GPU_TOWER_CREATION_ACTOR_ACTION_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_tower_creation_shaders.js');
const {
    PRODUCTION_STAGE_ONE_SELECTION_MAP_ID,
    R7_QA_LAUNCH_ARGUMENT,
    createProductionGameStartOptions,
    createR7QaGameStartOptions,
    isR7QaLaunchRequested
} = await loadGameModule('scene/game/production_game_start_route.js');

const compiler = new SentenceCompiler();
const R7_TOWER_TWICE_ABILITY = compiler.compile(
    R7_TOWER_SHOOTS_TOWERS_TWICE_SENTENCE
);
const R7_TOWER_TWICE_TWICE_ABILITY = compiler.compile(
    normalizeSentenceDefinition({
        id: 'sentence.test.r7.tower-shoots-towers-twice-twice',
        subjectWordInstanceId:
            R7_TOWER_SHOOTS_TOWERS_TWICE_SENTENCE.subjectWordInstanceId,
        verbWordInstanceId:
            R7_TOWER_SHOOTS_TOWERS_TWICE_SENTENCE.verbWordInstanceId,
        payloadWordInstanceId:
            R7_TOWER_SHOOTS_TOWERS_TWICE_SENTENCE.payloadWordInstanceId,
        modifierWordInstanceIds: [
            ...R7_TOWER_SHOOTS_TOWERS_TWICE_SENTENCE
                .modifierWordInstanceIds,
            R7_TWICE_WORD_INSTANCE_2.id
        ]
    }, 'R7_TOWER_TWICE_TWICE_SENTENCE', {
        payloadRequirement: 'REQUIRED'
    })
);
const MERGE_OPERATION = compiler.compile(R6_TOWERS_MERGE_SENTENCE);

const PROTOCOL = Object.freeze({
    sessionGeneration: 17,
    deviceGeneration: 3,
    authoritativeEpoch: 11
});

class R7SnapshotRuntime {
    constructor(binding, token) {
        this.binding = binding;
        this.token = token;
        this.releaseCount = 0;
    }

    getSnapshotGpuBinding(token) {
        return token === this.token ? this.binding : null;
    }

    releaseSnapshot(token) {
        if (token !== this.token) return false;
        this.releaseCount++;
        return true;
    }
}

class R7PlacementRuntime {
    constructor() {
        this.pending = null;
        this.completions = [];
        this.bindings = new Map();
        this.releaseCount = 0;
        this.cancelCount = 0;
        this.destinationFingerprint = 0x730001;
        this.placementFingerprint = 0x730002;
    }

    canAccept() { return this.pending === null; }

    stage(request) {
        if (this.pending) {
            return Object.freeze({ accepted: false, reason: 'capacity' });
        }
        this.pending = request;
        return Object.freeze({
            accepted: true,
            transactionId: request.transactionId,
            subjectCount: request.subjectCompletion.subjectCount,
            destinationCount: request.destinationLeases.length,
            destinationFingerprint: this.destinationFingerprint,
            actorActionProfileFingerprint:
                request.command.actorActionProfileFingerprint
        });
    }

    submitPendingForFixedTick() {
        return Object.freeze({ submittedCount: 1, deferredCount: 0 });
    }

    complete() {
        const request = this.pending;
        assert.ok(request);
        const token = Object.freeze({});
        const binding = Object.freeze({
            abiVersion: 1,
            buffer: Object.freeze({ size: 4096 }),
            aggregateByteOffset: 0,
            byteLength: 4096,
            subjectCount: request.subjectCompletion.subjectCount,
            destinationCount: request.destinationLeases.length,
            copiesPerSubject: request.command.copiesPerSubject,
            modifierSetFingerprint:
                request.command.modifierSetFingerprint,
            executionOrdinal: request.command.executionOrdinal,
            commandFingerprint: request.command.fingerprint,
            snapshotFingerprint:
                request.subjectCompletion.snapshotFingerprint,
            destinationFingerprint: this.destinationFingerprint,
            placementFingerprint: this.placementFingerprint,
            actorActionProfileFingerprint:
                request.command.actorActionProfileFingerprint,
            snapshotSourceTick: request.subjectCompletion.sourceTick,
            placementTargetTick: request.targetFixedTick,
            transactionId: request.transactionId
        });
        this.bindings.set(token, binding);
        this.completions.push(Object.freeze({
            transactionId: request.transactionId,
            status: GPU_ACTOR_ACTION_PLACEMENT_STATUS.COMPLETE,
            subjectCount: request.subjectCompletion.subjectCount,
            destinationCount: request.destinationLeases.length,
            copiesPerSubject: request.command.copiesPerSubject,
            modifierSetFingerprint:
                request.command.modifierSetFingerprint,
            executionOrdinal: request.command.executionOrdinal,
            commandFingerprint: request.command.fingerprint,
            snapshotFingerprint:
                request.subjectCompletion.snapshotFingerprint,
            destinationFingerprint: this.destinationFingerprint,
            placementFingerprint: this.placementFingerprint,
            actorActionProfileFingerprint:
                request.command.actorActionProfileFingerprint,
            placementToken: token,
            ...PROTOCOL
        }));
        this.pending = null;
    }

    drainCompleted(out = []) {
        out.push(...this.completions);
        this.completions.length = 0;
        return out;
    }

    getPlacementGpuBinding(token) {
        return this.bindings.get(token) ?? null;
    }

    releasePlacement(token) {
        if (!this.bindings.delete(token)) return false;
        this.releaseCount++;
        return true;
    }

    cancelAll() {
        this.pending = null;
        this.cancelCount++;
        return Object.freeze({ cancelledCount: 1 });
    }
}

class R7TowerBackend {
    constructor() {
        this.capacity = 256;
        this.availableBodies = 255;
        this.preleases = new Map();
        this.staged = null;
        this.completions = [];
        this.lastStage = null;
    }

    supportsGpuSubjectActorActionTowerCreation() { return true; }
    canStageTowerCreation() { return this.staged === null; }
    getTowerCreationRuntimeStatus() {
        return Object.freeze({
            state: 'ready',
            recordCapacity: this.capacity,
            towerCapacity: this.capacity,
            productionTowerCapacity: this.capacity,
            requiresRecovery: false
        });
    }
    getTowerGroupRuntimeStatus() {
        return Object.freeze({ capacity: this.capacity });
    }
    getAvailableTowerCreationBodyCapacity() { return this.availableBodies; }
    getEventProtocolState() { return PROTOCOL; }

    preleaseTowerCreationBodies(request) {
        if (request.handles.length > this.availableBodies) {
            return Object.freeze({
                accepted: false,
                reason: 'BODY_CAPACITY',
                requiresRecovery: false
            });
        }
        const token = Object.freeze({});
        this.preleases.set(token, request);
        this.availableBodies -= request.handles.length;
        return Object.freeze({
            accepted: true,
            token,
            handles: Object.freeze([...request.handles]),
            slots: Object.freeze(request.handles.map((_, index) => 20 + index)),
            requiresRecovery: false
        });
    }

    cancelTowerCreationBodyPrelease(token) {
        const request = this.preleases.get(token);
        if (!request) {
            return Object.freeze({ accepted: false, requiresRecovery: false });
        }
        this.preleases.delete(token);
        this.availableBodies += request.handles.length;
        return Object.freeze({
            accepted: true,
            cancelledCount: request.handles.length,
            requiresRecovery: false
        });
    }

    stageTowerCreationTransaction(request) {
        assert.equal(
            request.mode,
            GPU_TOWER_CREATION_MODE.GPU_SUBJECT_ACTOR_ACTION
        );
        assert.equal(request.actorAction.subjectCount, 1);
        assert.equal(request.actorAction.destinationCount, 2);
        assert.equal(request.actorAction.copiesPerSubject, 2);
        assert.equal(
            request.actorAction.modifierSetFingerprint,
            R7_TOWER_TWICE_ABILITY.modifierSetFingerprint
        );
        this.staged = request;
        this.lastStage = request;
        return Object.freeze({
            accepted: true,
            transactionId: request.plan.transactionId,
            transactionFingerprint: request.transactionFingerprint,
            sourceTick: request.sourceTick,
            recordCount: request.plan.existing.length
                + request.plan.children.length,
            childCount: request.plan.children.length,
            targetGroupRevision: request.plan.targetGroupRevision,
            targetRosterFingerprint: 0x730003,
            mode: request.mode,
            executionOrdinal: request.actorAction.executionOrdinal,
            commandFingerprint: request.actorAction.commandFingerprint,
            snapshotFingerprint: request.actorAction.snapshotFingerprint,
            subjectCount: request.actorAction.subjectCount,
            destinationCount: request.actorAction.destinationCount,
            copiesPerSubject: request.actorAction.copiesPerSubject,
            modifierSetFingerprint:
                request.actorAction.modifierSetFingerprint,
            placementFingerprint: request.actorAction.placementFingerprint,
            actorActionProfileFingerprint:
                request.actorAction.actorActionProfileFingerprint,
            recoveryRequired: false
        });
    }

    drainCompletedTowerCreationTransactions(out = []) {
        out.push(...this.completions);
        this.completions.length = 0;
        return out;
    }

    completeCommitted(generations) {
        const request = this.staged;
        assert.ok(request);
        assert.equal(generations.length, request.plan.children.length);
        const prelease = this.preleases.get(request.preleaseToken);
        const metadataCommits = Object.freeze(generations.map(
            (generation, destinationRank) => {
                const handle = prelease.handles[destinationRank];
                const record = {
                    abiVersion: 1,
                    destinationRank,
                    entityId: handle.entityId,
                    incarnation: handle.incarnation,
                    logicalTowerOrdinal: request.plan.children[destinationRank]
                        .logicalTowerOrdinal,
                    generation,
                    actionCode: request.actorAction.actionCode
                };
                return Object.freeze({
                    ...record,
                    recordFingerprint:
                        computeGpuTowerCreationMetadataRecordFingerprint(record),
                    fingerprintValid: true
                });
            }
        ));
        this.completions.push(Object.freeze({
            transactionId: request.plan.transactionId,
            transactionFingerprint: request.transactionFingerprint,
            sourceTick: request.sourceTick,
            submittedTick: request.sourceTick,
            childCount: request.plan.children.length,
            result: GPU_TOWER_CREATION_STATUS.COMMITTED,
            committed: true,
            rejectedSourceChanged: false,
            protocolFailure: false,
            recoveryRequired: false,
            metadataCommits,
            mode: request.mode,
            executionOrdinal: request.actorAction.executionOrdinal,
            commandFingerprint: request.actorAction.commandFingerprint,
            snapshotFingerprint: request.actorAction.snapshotFingerprint,
            subjectCount: request.actorAction.subjectCount,
            destinationCount: request.actorAction.destinationCount,
            copiesPerSubject: request.actorAction.copiesPerSubject,
            modifierSetFingerprint:
                request.actorAction.modifierSetFingerprint,
            placementFingerprint: request.actorAction.placementFingerprint,
            actorActionProfileFingerprint:
                request.actorAction.actorActionProfileFingerprint,
            evidence: Object.freeze({ committed: true }),
            ...PROTOCOL
        }));
    }

    finalizeTowerCreationTransaction(request) {
        const prelease = this.preleases.get(request.preleaseToken);
        if (!prelease) {
            return Object.freeze({ accepted: false, requiresRecovery: false });
        }
        this.preleases.delete(request.preleaseToken);
        if (!request.committed) {
            this.availableBodies += prelease.handles.length;
        }
        this.staged = null;
        return Object.freeze({
            accepted: true,
            committed: request.committed,
            finalizedCount: prelease.handles.length,
            handles: request.committed
                ? Object.freeze([...prelease.handles])
                : Object.freeze([]),
            requiresRecovery: false
        });
    }

    cancelAllTowerCreations(reason) {
        let cancelledCount = 0;
        for (const request of this.preleases.values()) {
            cancelledCount += request.handles.length;
        }
        this.availableBodies += cancelledCount;
        this.preleases.clear();
        this.staged = null;
        return Object.freeze({
            cancelledPreleaseCount: cancelledCount,
            reason,
            requiresRecovery: false
        });
    }
}

function createR7CoordinatorFixture(options = {}) {
    const compiledAbility = options.compiledAbility
        ?? R7_TOWER_TWICE_ABILITY;
    const command = normalizeAbilityExecutionCommand({
        executionId: options.executionId
            ?? 'execution.r7.tower-runtime',
        executionOrdinal: options.executionOrdinal ?? 41,
        targetFixedTick: options.targetFixedTick ?? 50,
        subjectLimit: 1000,
        generationLimit: 65535,
        aimPoint: { x: 8, y: 6 },
        compiledAbility
    });
    const snapshotToken = Object.freeze({});
    const completion = Object.freeze({
        status: ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE,
        executionId: command.executionId,
        executionOrdinal: command.executionOrdinal,
        commandFingerprint: command.fingerprint,
        snapshotFingerprint: options.snapshotFingerprint ?? 0x730004,
        subjectCount: 1,
        sourceTick: command.targetFixedTick,
        snapshotToken
    });
    const snapshotBinding = Object.freeze({
        abiVersion: 1,
        buffer: Object.freeze({ size: 4096 }),
        wordOffset: 0,
        byteOffset: 0,
        byteLength: 4096,
        recordStride: 64,
        subjectCount: 1,
        executionOrdinal: command.executionOrdinal,
        commandFingerprint: command.fingerprint,
        snapshotFingerprint: completion.snapshotFingerprint,
        sourceTick: completion.sourceTick,
        ...PROTOCOL
    });
    const snapshotRuntime = new R7SnapshotRuntime(
        snapshotBinding,
        snapshotToken
    );
    const placementRuntime = new R7PlacementRuntime();
    const backend = new R7TowerBackend();
    const registry = new WorldRegistry({ capacity: 300 });
    const state = new TowerGroupState();
    const primaryHandle = registry.reserveEntity({
        kindId: 'tower',
        definitionId: 'the-tower',
        createdAtTick: 0
    });
    registry.activateReserved(primaryHandle, { logicalTowerOrdinal: 1 });
    state.bindGpuBody(PRIMARY_TOWER_LOGICAL_ID, primaryHandle, PROTOCOL);
    const coordinator = new TowerCreationCoordinator({
        towerGroupState: state,
        registry,
        backend,
        abilitySubjectSnapshotRuntime: snapshotRuntime,
        actorActionPlacementRuntime: placementRuntime
    });
    const request = Object.freeze({
        mode: TOWER_CREATION_COORDINATOR_MODE.GPU_SUBJECT_ACTOR_ACTION,
        transactionId: options.transactionId
            ?? 'transaction.r7.tower-runtime',
        childCount: command.copiesPerSubject,
        requestedFixedTick: command.targetFixedTick,
        executionId: command.executionId,
        executionOrdinal: command.executionOrdinal,
        command,
        subjectCompletion: completion,
        snapshotToken,
        actorActionProfileId: R5_SHOOT_ACTOR_ACTION_PROFILE.id,
        actorActionProfile: R5_SHOOT_ACTOR_ACTION_PROFILE,
        payloadDefinition: R5_TOWER_ACTOR_PAYLOAD_DEFINITION,
        recoveryPlacementPolicy: Object.freeze({
            policyId:
                TOWER_RECOVERY_PLACEMENT_POLICY_ID.MAP_ANCHOR_LATTICE_V1,
            mapRecoveryAnchorId: 'map.spawn.primary',
            mapLatticeVersion: 7,
            anchorPosition: Object.freeze({ x: 2, y: 4 })
        }),
        sdf: Object.freeze({
            cols: 1,
            rows: 1,
            enabled: false,
            worldWidth: 16,
            worldHeight: 12
        })
    });
    return {
        backend,
        command,
        completion,
        coordinator,
        placementRuntime,
        registry,
        request,
        snapshotRuntime,
        state
    };
}

const coordinatorSource = await readFile(new URL(
    '../script/module/ingame/object/tower/tower_creation_coordinator.js',
    import.meta.url
), 'utf8');
const gameSystemSource = await readFile(new URL(
    '../script/module/ingame/game_system.js',
    import.meta.url
), 'utf8');

function createNoopEnemyEndpoint() {
    return {
        requestActorPayloadMaterialization() {
            return Object.freeze({ accepted: false });
        },
        drainCompletedActorPayloadMaterializations(out = []) { return out; },
        cancelPendingActorPayloadMaterializations() {
            return Object.freeze({ cancelledCount: 0 });
        },
        getActorPayloadMaterializationStatus() { return null; }
    };
}

test('R7 Tower twice coordinator는 1×2 mapping을 exact-once commit하고 복구 provenance를 보존한다', () => {
    const fixture = createR7CoordinatorFixture();
    const queued = fixture.coordinator.requestTowerCreation(fixture.request);
    assert.equal(queued.accepted, true);
    assert.strictEqual(
        fixture.coordinator.requestTowerCreation(fixture.request),
        queued
    );

    const placement = fixture.coordinator.stageForFixedTick(
        fixture.command.targetFixedTick
    );
    assert.equal(placement.phase, 'actor-action-placement');
    assert.equal(placement.subjectCount, 1);
    assert.equal(placement.destinationCount, 2);
    assert.equal(placement.copiesPerSubject, 2);
    assert.deepEqual(
        fixture.placementRuntime.pending.destinationLeases.map((lease) => ({
            snapshotRank: lease.snapshotRank,
            copyIndex: lease.copyIndex,
            destinationRank: lease.destinationRank
        })),
        [
            { snapshotRank: 0, copyIndex: 0, destinationRank: 0 },
            { snapshotRank: 0, copyIndex: 1, destinationRank: 1 }
        ]
    );

    fixture.placementRuntime.complete();
    const placementReady = fixture.coordinator
        .observeCompletedAtFixedBoundary(fixture.command.targetFixedTick + 1);
    assert.equal(placementReady.phase, 'actor-action-placement-ready');
    assert.equal(placementReady.readyForCreationStage, true);
    assert.equal(fixture.snapshotRuntime.releaseCount, 1);

    const creation = fixture.coordinator
        .stageReadyActorActionPlacementAtFixedBoundary(
            fixture.command.targetFixedTick + 1
        );
    assert.equal(creation.phase, 'tower-creation');
    assert.equal(fixture.backend.lastStage.actorAction.subjectCount, 1);
    assert.equal(fixture.backend.lastStage.actorAction.destinationCount, 2);
    assert.equal(fixture.backend.lastStage.actorAction.copiesPerSubject, 2);

    fixture.backend.completeCommitted([2, 5]);
    const committed = fixture.coordinator.observeCompletedAtFixedBoundary(
        fixture.command.targetFixedTick + 2
    );
    assert.equal(committed.result, TOWER_CREATION_RESULT.COMMITTED);
    assert.equal(committed.createdCount, 2);
    assert.equal(committed.subjectCount, 1);
    assert.equal(committed.destinationCount, 2);
    assert.equal(committed.copiesPerSubject, 2);
    assert.equal(
        committed.modifierSetFingerprint,
        R7_TOWER_TWICE_ABILITY.modifierSetFingerprint
    );
    assert.equal(fixture.state.getStatus().livingTowerCount, 3);
    assert.equal(fixture.registry.getStatus().reservedCount, 0);
    assert.equal(fixture.backend.preleases.size, 0);
    assert.equal(fixture.placementRuntime.releaseCount, 1);

    const living = fixture.state.getTowerRecords().filter((record) => (
        record.alive
    ));
    assert.equal(
        living.reduce((sum, record) => sum + record.shareUnits, 0)
            + fixture.state.getStatus().lostShareUnits,
        TOWER_SHARE_SCALE
    );
    const children = living.slice(1);
    assert.deepEqual(
        children.map((record) => ({
            sourceSubjectRank:
                record.creationMetadata.sourceSubjectRank,
            copyIndex: record.creationMetadata.copyIndex,
            destinationRank: record.creationMetadata.destinationRank,
            generation: record.creationMetadata.generation
        })),
        [
            {
                sourceSubjectRank: 0,
                copyIndex: 0,
                destinationRank: 0,
                generation: 2
            },
            {
                sourceSubjectRank: 0,
                copyIndex: 1,
                destinationRank: 1,
                generation: 5
            }
        ]
    );
    for (const child of children) {
        const descriptor = child.creationMetadata
            .recoveryPlacementDescriptor;
        const intent = createGpuTowerSpawnIntent({
            position: descriptor.position,
            logicalTowerOrdinal: child.logicalTowerOrdinal,
            creationMetadata: child.creationMetadata
        });
        assert.equal(intent.modifierSetFingerprint,
            R7_TOWER_TWICE_ABILITY.modifierSetFingerprint);
        assert.equal(intent.copiesPerSubject, 2);
        assert.equal(intent.subjectCount, 1);
        assert.equal(intent.destinationCount, 2);
        assert.equal(intent.copyIndex, child.creationMetadata.copyIndex);
    }
    assert.equal(fixture.state.auditInvariants().valid, true);
    assert.strictEqual(
        fixture.coordinator.requestTowerCreation(fixture.request),
        committed
    );
    fixture.coordinator.destroy();
});

test('R7 replay conflict와 commit 전 취소는 예약·ledger를 전량 정리하고 stale callback을 무시한다', () => {
    const conflict = createR7CoordinatorFixture({
        transactionId: 'transaction.r7.replay-conflict'
    });
    conflict.coordinator.requestTowerCreation(conflict.request);
    const altered = createR7CoordinatorFixture({
        transactionId: conflict.request.transactionId,
        compiledAbility: R7_TOWER_TWICE_TWICE_ABILITY
    });
    const mismatch = conflict.coordinator.requestTowerCreation(
        altered.request
    );
    assert.equal(mismatch.result, TOWER_CREATION_RESULT.PROTOCOL_FAILURE);
    assert.equal(mismatch.reason, 'TRANSACTION_FINGERPRINT_MISMATCH');
    assert.equal(mismatch.recoveryRequired, true);
    assert.equal(conflict.registry.getStatus().reservedCount, 0);
    conflict.coordinator.destroy();
    altered.coordinator.destroy();

    const cancelled = createR7CoordinatorFixture({
        transactionId: 'transaction.r7.cancel-before-commit'
    });
    cancelled.coordinator.requestTowerCreation(cancelled.request);
    cancelled.coordinator.stageForFixedTick(
        cancelled.command.targetFixedTick
    );
    assert.equal(cancelled.registry.getStatus().reservedCount, 2);
    cancelled.placementRuntime.complete();
    const result = cancelled.coordinator.cancelPending(
        'r7-cancel-before-commit'
    );
    assert.equal(result.cancelled, true);
    assert.equal(result.recoveryRequired, false);
    assert.equal(cancelled.snapshotRuntime.releaseCount, 1);
    assert.equal(cancelled.registry.getStatus().reservedCount, 0);
    assert.equal(cancelled.registry.getStatus().activeCount, 1);
    assert.equal(cancelled.backend.preleases.size, 0);
    assert.equal(cancelled.state.getStatus().livingTowerCount, 1);
    assert.equal(cancelled.state.getTowerRecords().length, 1);
    const beforeStale = cancelled.state.getStatus();
    cancelled.coordinator.observeCompletedAtFixedBoundary(
        cancelled.command.targetFixedTick + 1
    );
    assert.equal(
        cancelled.state.getStatus().groupRevision,
        beforeStale.groupRevision
    );
    assert.equal(cancelled.state.getStatus().livingTowerCount, 1);
    const receipts = cancelled.coordinator
        .drainActorPayloadTerminalReceipts([]);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].terminal, true);
    assert.equal(
        receipts[0].result,
        TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED
    );
    cancelled.coordinator.destroy();
});

test('Tower twice는 exact subject×copies를 coordinator와 cooldown owner에 0/N으로 연결한다', () => {
    const command = normalizeAbilityExecutionCommand({
        executionId: 'execution.r7.tower-twice',
        executionOrdinal: 9,
        targetFixedTick: 20,
        subjectLimit: 1000,
        generationLimit: 65535,
        aimPoint: { x: 8, y: 6 },
        compiledAbility: R7_TOWER_TWICE_ABILITY
    });
    const snapshotToken = Object.freeze({});
    const completion = Object.freeze({
        status: ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE,
        executionId: command.executionId,
        executionOrdinal: command.executionOrdinal,
        commandFingerprint: command.fingerprint,
        snapshotFingerprint: 0x710001,
        subjectCount: 3,
        sourceTick: 20,
        snapshotToken
    });
    const ready = Object.freeze({ command, completion });
    const ability = {
        ready: [ready],
        completed: null,
        rejected: null,
        drainReadySnapshots(out) {
            out.push(...this.ready);
            this.ready.length = 0;
            return out;
        },
        returnReadySnapshot(record) { this.ready.unshift(record); },
        completeSnapshotExecution(record, result) {
            this.completed = { record, result };
            return true;
        },
        rejectSnapshotExecution(record, code, result) {
            this.rejected = { record, code, result };
            return true;
        },
        markGpuMaterializationPending() { return true; }
    };
    const coordinator = {
        request: null,
        getStatus() { return Object.freeze({ state: 'idle' }); },
        requestTowerCreation(request) {
            this.request = request;
            return Object.freeze({
                accepted: true,
                requestFingerprint: 'request.r7.tower-twice'
            });
        },
        cancelPending() { return Object.freeze({ cancelled: true }); }
    };
    const materializer = new ActorPayloadMaterializer({
        abilityRuntime: ability,
        endpoint: createNoopEnemyEndpoint(),
        towerCreationCoordinatorProvider: () => coordinator,
        towerPayloadContextProvider: () => ({
            runtimeAvailable: true,
            sdf: Object.freeze({
                cols: 1,
                rows: 1,
                worldWidth: 16,
                worldHeight: 16
            }),
            recoveryPlacementPolicy: Object.freeze({
                policyId:
                    TOWER_RECOVERY_PLACEMENT_POLICY_ID.MAP_ANCHOR_LATTICE_V1,
                mapRecoveryAnchorId: 'map.spawn.primary',
                mapLatticeVersion: 1,
                anchorPosition: Object.freeze({ x: 2, y: 4 })
            })
        })
    });

    const staged = materializer.stageReadyForFixedTick({
        targetFixedTick: 20
    });
    assert.equal(staged.stagedCount, 1);
    assert.equal(
        coordinator.request.mode,
        TOWER_CREATION_COORDINATOR_MODE.GPU_SUBJECT_ACTOR_ACTION
    );
    assert.equal(coordinator.request.subjectCompletion.subjectCount, 3);
    assert.equal(coordinator.request.childCount, 6);
    assert.equal(coordinator.request.command.copiesPerSubject, 2);
    assert.equal(
        coordinator.request.command.modifierSetFingerprint,
        R7_TOWER_TWICE_ABILITY.modifierSetFingerprint
    );

    const handles = Object.freeze(Array.from({ length: 6 }, (_, index) => (
        Object.freeze({ entityId: 100 + index, incarnation: 1 })
    )));
    const observed = materializer.observeTowerCreationCompletion(
        Object.freeze({
            terminal: true,
            receiptKind: 'tower-creation-terminal',
            pending: false,
            staged: false,
            phase: null,
            result: TOWER_CREATION_RESULT.COMMITTED,
            committed: true,
            transactionId: coordinator.request.transactionId,
            requestFingerprint: 'request.r7.tower-twice',
            actorActionProfileFingerprint:
                command.actorActionProfileFingerprint,
            subjectCount: 3,
            destinationCount: 6,
            copiesPerSubject: 2,
            modifierSetFingerprint: command.modifierSetFingerprint,
            destinationFingerprint: 0x710002,
            placementFingerprint: 0x710003,
            createdCount: 6,
            handles,
            sourceTick: 21
        }),
        21
    );
    assert.equal(observed.committedCount, 1);
    assert.equal(observed.committedHandles.length, 6);
    assert.equal(ability.completed.result.generatedCount, 6);
    assert.equal(ability.rejected, null);
    const history = materializer.getStatus().history.at(-1);
    assert.equal(history.subjectCount, 3);
    assert.equal(history.destinationCount, 6);
    assert.equal(history.copiesPerSubject, 2);
    assert.equal(
        history.modifierSetFingerprint,
        command.modifierSetFingerprint
    );
    materializer.destroy();
});

test('Tower twice 반복은 1→3→9→27→81→243이며 다음 x3을 256 cap에서 원자 거절한다', () => {
    const state = new TowerGroupState();
    const expectedCounts = [3, 9, 27, 81, 243];
    for (const expected of expectedCounts) {
        const current = state.getStatus().livingTowerCount;
        const plan = state.planCreation({
            transactionId: `transaction.r7.growth.${expected}`,
            childCount: current * 2
        });
        assert.equal(plan.accepted, true, plan.reason);
        const committed = state.commitCreation(plan);
        assert.equal(committed.result, TOWER_CREATION_RESULT.COMMITTED);
        assert.equal(state.getStatus().livingTowerCount, expected);
        const living = state.getTowerRecords().filter((record) => record.alive);
        assert.equal(
            living.reduce((sum, record) => sum + record.shareUnits, 0)
                + state.getStatus().lostShareUnits,
            TOWER_SHARE_SCALE
        );
        assert.equal(state.auditInvariants().valid, true);
    }
    const before = state.getStatus();
    const backend = {
        canStageTowerCreation: () => true,
        getTowerCreationRuntimeStatus: () => Object.freeze({
            state: 'ready',
            recordCapacity: 256,
            towerCapacity: 256,
            productionTowerCapacity: 256,
            requiresRecovery: false
        }),
        getTowerGroupRuntimeStatus: () => Object.freeze({ capacity: 256 }),
        getAvailableTowerCreationBodyCapacity: () => 1000,
        preleaseTowerCreationBodies: () => Object.freeze({ accepted: false }),
        cancelTowerCreationBodyPrelease: () => Object.freeze({
            accepted: true,
            requiresRecovery: false
        }),
        stageTowerCreationTransaction: () => Object.freeze({ accepted: false }),
        drainCompletedTowerCreationTransactions: (out = []) => out,
        finalizeTowerCreationTransaction: () => Object.freeze({
            accepted: true
        }),
        cancelAllTowerCreations: () => Object.freeze({
            requiresRecovery: false
        }),
        getEventProtocolState: () => Object.freeze({
            sessionGeneration: 1,
            deviceGeneration: 0,
            authoritativeEpoch: 0
        })
    };
    const registry = {
        reserveEntity: () => null,
        activateReservedBatch: () => Object.freeze({ accepted: false }),
        cancelReservation: () => true,
        getStatus: () => Object.freeze({
            capacity: 1000,
            activeCount: 0,
            reservedCount: 0
        })
    };
    const coordinator = new TowerCreationCoordinator({
        towerGroupState: state,
        registry,
        backend
    });
    const rejected = coordinator.previewTowerCreation({
        transactionId: 'transaction.r7.growth.cap',
        childCount: before.livingTowerCount * 2
    });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.result, TOWER_CREATION_RESULT.REJECTED_CAPACITY);
    assert.equal(state.getStatus().livingTowerCount, 243);
    assert.equal(state.getStatus().pendingCreation, null);
    coordinator.destroy();
});

test('Merge 뒤 twice는 MERGED identity를 부활시키지 않고 새 ordinal만 단조 증가시킨다', () => {
    const state = new TowerGroupState();
    const split = state.planCreation({
        transactionId: 'transaction.r7.merge-seed',
        childCount: 2
    });
    state.commitCreation(split);
    const merged = state.commitMerge(state.planMerge({
        transactionId: 'transaction.r7.merge',
        compiledOperation: MERGE_OPERATION,
        requestedFixedTick: 30
    }));
    assert.equal(merged.accepted, true);
    assert.equal(state.getStatus().livingTowerCount, 1);
    const postMerge = state.getTowerRecords();
    const mergedIds = postMerge.filter((record) => (
        record.state === TOWER_GROUP_RECORD_STATE.MERGED
    )).map((record) => record.logicalTowerId);
    assert.equal(mergedIds.length, 2);

    const twice = state.planCreation({
        transactionId: 'transaction.r7.after-merge-twice',
        childCount: 2
    });
    const receipt = state.commitCreation(twice);
    assert.equal(receipt.created.length, 2);
    assert.deepEqual(
        state.getTowerRecords().filter((record) => (
            record.state === TOWER_GROUP_RECORD_STATE.MERGED
        )).map((record) => record.logicalTowerId),
        mergedIds
    );
    assert.deepEqual(
        receipt.created.map((record) => record.logicalTowerOrdinal),
        [4, 5]
    );
    assert.equal(state.getStatus().livingTowerCount, 3);
    assert.equal(state.auditInvariants().valid, true);
});

test('twice 뒤 Merge는 Share·현재/최대 HP·Power 합을 exact 보존한다', () => {
    const state = new TowerGroupState();
    state.commitCreation(state.planCreation({
        transactionId: 'transaction.r7.twice-before-merge',
        childCount: 2
    }));
    const before = state.getTowerRecords().filter((record) => record.alive)
        .reduce((aggregate, record) => ({
            shareUnits: aggregate.shareUnits + record.shareUnits,
            currentHpFixedPoint:
                aggregate.currentHpFixedPoint + record.currentHpFixedPoint,
            maxHpFixedPoint:
                aggregate.maxHpFixedPoint + record.maxHpFixedPoint,
            powerFixedPoint:
                aggregate.powerFixedPoint + record.powerFixedPoint
        }), {
            shareUnits: 0,
            currentHpFixedPoint: 0,
            maxHpFixedPoint: 0,
            powerFixedPoint: 0
        });
    const merged = state.commitMerge(state.planMerge({
        transactionId: 'transaction.r7.twice-then-merge',
        compiledOperation: MERGE_OPERATION,
        requestedFixedTick: 60
    }));
    assert.equal(merged.accepted, true);
    const survivor = state.getTowerRecords().find((record) => record.alive);
    assert.deepEqual({
        shareUnits: survivor.shareUnits,
        currentHpFixedPoint: survivor.currentHpFixedPoint,
        maxHpFixedPoint: survivor.maxHpFixedPoint,
        powerFixedPoint: survivor.powerFixedPoint
    }, before);
    assert.equal(state.getStatus().livingTowerCount, 1);
    assert.equal(state.auditInvariants().valid, true);
});

test('committed Tower recovery metadata와 GPU ABI는 modifier provenance를 보존한다', () => {
    const recoveryPlacementDescriptor = Object.freeze({
        policyId: TOWER_RECOVERY_PLACEMENT_POLICY_ID.MAP_ANCHOR_LATTICE_V1,
        logicalTowerOrdinal: 7,
        mapRecoveryAnchorId: 'map.spawn.primary',
        mapLatticeVersion: 3,
        anchorPosition: Object.freeze({ x: 2, y: 4 }),
        position: Object.freeze({ x: 2, y: 4 })
    });
    const metadata = freezeTowerCreationMetadata({
        generation: 4,
        creationOriginCode: ABILITY_CREATION_ORIGIN_CODE.SENTENCE_PAYLOAD,
        sourceAbilityCode: 0x720001,
        sourceExecutionId: 'execution.r7.recovery',
        sourceExecutionFingerprint: 0x720002,
        sourceExecutionOrdinal: 7,
        visibleFromExecutionOrdinal: 8,
        actorActionCode: SENTENCE_ACTION_CODE.SHOOT,
        actorActionProfileId: 'actor-action.r7.shoot',
        actorActionProfileFingerprint: 0x720003,
        modifierSetFingerprint: 0x720004,
        modifierStackCount: 1,
        copiesPerSubject: 2,
        subjectCount: 3,
        destinationCount: 6,
        sourceSubjectRank: 1,
        copyIndex: 1,
        destinationRank: 3,
        destinationFingerprint: 0x720005,
        placementFingerprint: 0x720006,
        childDescriptorFingerprint: 0x720007,
        requestedFixedTick: 40,
        recoveryPlacementDescriptor
    });
    const intent = createGpuTowerSpawnIntent({
        position: recoveryPlacementDescriptor.position,
        logicalTowerOrdinal: 7,
        creationMetadata: metadata
    });
    for (const key of [
        'modifierSetFingerprint',
        'modifierStackCount',
        'copiesPerSubject',
        'subjectCount',
        'destinationCount',
        'sourceSubjectRank',
        'copyIndex',
        'destinationRank',
        'destinationFingerprint',
        'placementFingerprint',
        'childDescriptorFingerprint'
    ]) {
        assert.equal(intent[key], metadata[key], key);
    }
    assert.equal(GPU_TOWER_CREATION_ABI_VERSION, 3);
    assert.equal(GPU_TOWER_CREATION_ABI.PROGRAM.SUBJECT_COUNT, 144);
    assert.equal(GPU_TOWER_CREATION_ABI.PROGRAM.COPIES_PER_SUBJECT, 148);
    assert.equal(
        GPU_TOWER_CREATION_ABI.PROGRAM.MODIFIER_SET_FINGERPRINT,
        152
    );
    assert.match(
        GPU_TOWER_CREATION_ACTOR_ACTION_WGSL,
        /AGGREGATE_DESTINATION_COUNT[\s\S]*PROGRAM_CHILD_COUNT/
    );
    assert.match(
        GPU_TOWER_CREATION_ACTOR_ACTION_WGSL,
        /source_rank \* copies_per_subject \+ copy_index != rank/
    );
    assert.match(
        GPU_TOWER_CREATION_ACTOR_ACTION_WGSL,
        /set_transit_word\([\s\S]*placement_word\(rank, PLACEMENT_SOURCE_RANK\)/
    );
});

test('--r7-qa와 bounded modifier status는 기존 production/R6 loadout을 오염시키지 않는다', () => {
    assert.equal(isR7QaLaunchRequested([R7_QA_LAUNCH_ARGUMENT]), true);
    assert.equal(isR7QaLaunchRequested(['--r7-qa-extra']), false);
    const qa = createR7QaGameStartOptions(
        PRODUCTION_STAGE_ONE_SELECTION_MAP_ID
    );
    assert.strictEqual(qa.wordSystemOptions.loadout, R7_QA_SENTENCE_LOADOUT);
    assert.notStrictEqual(R7_QA_SENTENCE_LOADOUT, R6_QA_SENTENCE_LOADOUT);

    const priorNw = globalThis.nw;
    try {
        globalThis.nw = { App: { argv: [R7_QA_LAUNCH_ARGUMENT] } };
        assert.strictEqual(
            createProductionGameStartOptions(
                PRODUCTION_STAGE_ONE_SELECTION_MAP_ID
            ).wordSystemOptions.loadout,
            R7_QA_SENTENCE_LOADOUT
        );
        globalThis.nw = { App: { argv: [] } };
        assert.strictEqual(
            createProductionGameStartOptions(
                PRODUCTION_STAGE_ONE_SELECTION_MAP_ID
            ).wordSystemOptions.loadout,
            R5_SHOWCASE_SENTENCE_LOADOUT
        );
    } finally {
        if (priorNw === undefined) delete globalThis.nw;
        else globalThis.nw = priorNw;
    }

    const words = new WordSystem({
        loadout: {
            [ABILITY_SLOT_ID.SHIFT]:
                R7_TOWER_SHOOTS_TOWERS_TWICE_SENTENCE
        }
    });
    try {
        assert.equal(words.recordExecutionOutcome({
            executionOrdinal: 1,
            slotId: ABILITY_SLOT_ID.SHIFT,
            code: ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED,
            completedFixedTick: 10,
            subjectCount: 3,
            generatedCount: 6,
            copiesPerSubject: 2,
            modifierSetFingerprint:
                R7_TOWER_TWICE_ABILITY.modifierSetFingerprint,
            cooldownConsumed: true
        }), true);
        const outcome = words.getStatusView().lastExecutionOutcome;
        assert.equal(Object.isFrozen(outcome), true);
        assert.equal(outcome.modifierStackCount, 1);
        assert.equal(outcome.effectiveGeneratedCount, 6);
        assert.equal(
            outcome.lastModifierOutcome,
            ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED
        );
    } finally {
        words.destroy();
    }

    assert.match(coordinatorSource,
        /modifierSetFingerprint,[\s\S]*copiesPerSubject,[\s\S]*destinationCount,[\s\S]*snapshotFingerprint,[\s\S]*placementFingerprint,[\s\S]*childDescriptorFingerprint,[\s\S]*requestedFixedTick/);
    assert.match(coordinatorSource,
        /snapshotRank: Math\.floor\(index \/ request\.copiesPerSubject\)/);
    assert.match(gameSystemSource,
        /modifierSetFingerprint:[\s\S]*modifierStackCount:[\s\S]*copiesPerSubject:[\s\S]*effectiveGeneratedCount:[\s\S]*resultingTowerCount:[\s\S]*lastModifierOutcome:/);
});
