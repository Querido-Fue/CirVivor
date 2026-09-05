import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';
import { WorldRegistry } from '../project/game/script/module/ingame/object/world_registry.js';
import {
    GPU_TOWER_CREATION_MODE,
    GPU_TOWER_CREATION_STATUS,
    computeGpuTowerCreationMetadataRecordFingerprint
} from '../project/game/script/module/ingame/physics/gpu/gpu_tower_creation_abi.js';

const {
    ABILITY_SUBJECT_SNAPSHOT_STATUS,
    normalizeAbilityExecutionCommand
} = await loadGameModule('ingame/contract/ability_execution_contract.js');
const {
    GPU_ACTOR_ACTION_PLACEMENT_STATUS
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_action_placement_abi.js'
);
const {
    R5_SHOOT_ACTOR_ACTION_PROFILE
} = await loadGameModule('data/word/r5_actor_action_profile_data.js');
const {
    R5_TOWER_ACTOR_PAYLOAD_DEFINITION
} = await loadGameModule('ingame/contract/actor_payload_contract.js');
const {
    R5_ENEMIES_SHOOT_TOWER_SENTENCE,
    R5_TOWER_SHOOTS_TOWER_SENTENCE
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    SentenceCompiler
} = await loadGameModule('ingame/word/sentence_compiler.js');
const {
    PRIMARY_TOWER_LOGICAL_ID,
    TOWER_CREATION_RESULT,
    TowerGroupState
} = await loadGameModule('ingame/object/tower/tower_group_state.js');
const {
    TOWER_CREATION_COORDINATOR_MODE,
    TOWER_RECOVERY_PLACEMENT_POLICY_ID
} = await loadGameModule('ingame/object/tower/tower_group_contract.js');
const {
    TowerCreationCoordinator
} = await loadGameModule('ingame/object/tower/tower_creation_coordinator.js');

const PROTOCOL = Object.freeze({
    sessionGeneration: 5,
    deviceGeneration: 2,
    authoritativeEpoch: 9
});

class FakeSnapshotRuntime {
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

class FakeActorActionPlacementRuntime {
    constructor(protocol) {
        this.protocol = protocol;
        this.pending = null;
        this.completions = [];
        this.records = new Map();
        this.releaseCount = 0;
        this.cancelCount = 0;
        this.nextPlacementFingerprint = 0x770001;
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
            destinationFingerprint: 0x660001,
            profileFingerprint:
                request.command.actorActionProfileFingerprint
        });
    }

    submitPendingForFixedTick() {
        return Object.freeze({ submittedCount: 1, deferredCount: 0 });
    }

    complete(status = GPU_ACTOR_ACTION_PLACEMENT_STATUS.COMPLETE) {
        const request = this.pending;
        assert.ok(request);
        const token = status === GPU_ACTOR_ACTION_PLACEMENT_STATUS.COMPLETE
            ? Object.freeze({})
            : null;
        const binding = token ? Object.freeze({
            abiVersion: 1,
            buffer: Object.freeze({ size: 4096 }),
            aggregateByteOffset: 0,
            byteLength: 4096,
            subjectCount: request.subjectCompletion.subjectCount,
            executionOrdinal: request.command.executionOrdinal,
            commandFingerprint: request.command.fingerprint,
            snapshotFingerprint: request.subjectCompletion.snapshotFingerprint,
            destinationFingerprint: 0x660001,
            placementFingerprint: this.nextPlacementFingerprint,
            actorActionProfileFingerprint:
                request.command.actorActionProfileFingerprint,
            snapshotSourceTick: request.subjectCompletion.sourceTick,
            placementTargetTick: request.targetFixedTick,
            transactionId: request.transactionId
        }) : null;
        if (token) this.records.set(token, binding);
        this.completions.push(Object.freeze({
            transactionId: request.transactionId,
            status,
            subjectCount: request.subjectCompletion.subjectCount,
            executionOrdinal: request.command.executionOrdinal,
            commandFingerprint: request.command.fingerprint,
            snapshotFingerprint: request.subjectCompletion.snapshotFingerprint,
            destinationFingerprint: 0x660001,
            placementFingerprint: status
                === GPU_ACTOR_ACTION_PLACEMENT_STATUS.COMPLETE
                ? this.nextPlacementFingerprint
                : 0,
            actorActionProfileFingerprint:
                request.command.actorActionProfileFingerprint,
            placementToken: token,
            ...this.protocol
        }));
        this.pending = null;
    }

    drainCompleted(out = []) {
        out.push(...this.completions);
        this.completions.length = 0;
        return out;
    }

    getPlacementGpuBinding(token) {
        return this.records.get(token) ?? null;
    }

    releasePlacement(token) {
        if (!this.records.delete(token)) return false;
        this.releaseCount++;
        return true;
    }

    cancelAll() {
        this.pending = null;
        this.cancelCount++;
        return Object.freeze({ cancelledCount: 1 });
    }
}

class FakeR5TowerBackend {
    constructor(options = {}) {
        this.protocol = PROTOCOL;
        this.capacity = options.capacity ?? 256;
        this.availableBodies = options.availableBodies ?? this.capacity;
        this.preleases = new Map();
        this.staged = null;
        this.completions = [];
        this.lastStage = null;
        this.lastFinalize = null;
    }

    supportsGpuSubjectActorActionTowerCreation() { return true; }
    canStageTowerCreation() { return this.staged === null; }
    getTowerCreationRuntimeStatus() {
        return Object.freeze({
            state: 'ready',
            recordCapacity: this.capacity,
            towerCapacity: this.capacity,
            productionTowerCapacity: 256,
            requiresRecovery: false
        });
    }
    getTowerGroupRuntimeStatus() {
        return Object.freeze({ capacity: this.capacity });
    }
    getAvailableTowerCreationBodyCapacity() { return this.availableBodies; }
    getEventProtocolState() { return this.protocol; }

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
            slots: Object.freeze(request.handles.map((_, index) => 10 + index)),
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
        assert.equal(
            request.actorAction.actorActionProfileFingerprint,
            request.actorActionPlacementBinding
                .actorActionProfileFingerprint
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
            targetRosterFingerprint: 0x990001,
            mode: request.mode,
            executionOrdinal: request.actorAction.executionOrdinal,
            commandFingerprint: request.actorAction.commandFingerprint,
            snapshotFingerprint: request.actorAction.snapshotFingerprint,
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
        const metadataCommits = Object.freeze(generations.map(
            (generation, destinationRank) => {
                const handle = this.preleases.get(
                    request.preleaseToken
                ).handles[destinationRank];
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
            placementFingerprint: request.actorAction.placementFingerprint,
            actorActionProfileFingerprint:
                request.actorAction.actorActionProfileFingerprint,
            evidence: Object.freeze({ committed: true }),
            ...this.protocol
        }));
    }

    completeRejected() {
        const request = this.staged;
        this.completions.push(Object.freeze({
            transactionId: request.plan.transactionId,
            transactionFingerprint: request.transactionFingerprint,
            sourceTick: request.sourceTick,
            submittedTick: request.sourceTick,
            childCount: request.plan.children.length,
            result: GPU_TOWER_CREATION_STATUS.REJECTED_SOURCE_CHANGED,
            committed: false,
            rejectedSourceChanged: true,
            protocolFailure: false,
            recoveryRequired: false,
            metadataCommits: Object.freeze([]),
            mode: request.mode,
            executionOrdinal: request.actorAction.executionOrdinal,
            commandFingerprint: request.actorAction.commandFingerprint,
            snapshotFingerprint: request.actorAction.snapshotFingerprint,
            placementFingerprint: request.actorAction.placementFingerprint,
            actorActionProfileFingerprint:
                request.actorAction.actorActionProfileFingerprint,
            evidence: Object.freeze({ sourceChanged: true }),
            ...this.protocol
        }));
    }

    finalizeTowerCreationTransaction(request) {
        const prelease = this.preleases.get(request.preleaseToken);
        this.lastFinalize = request;
        if (!prelease) {
            return Object.freeze({ accepted: false, requiresRecovery: false });
        }
        this.preleases.delete(request.preleaseToken);
        if (!request.committed) this.availableBodies += prelease.handles.length;
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
        let cancelled = 0;
        for (const request of this.preleases.values()) {
            cancelled += request.handles.length;
        }
        this.availableBodies += cancelled;
        this.preleases.clear();
        this.staged = null;
        return Object.freeze({
            cancelledPreleaseCount: cancelled,
            reason,
            requiresRecovery: false
        });
    }
}

function createFixture(options = {}) {
    const sentence = options.enemySources
        ? R5_ENEMIES_SHOOT_TOWER_SENTENCE
        : R5_TOWER_SHOOTS_TOWER_SENTENCE;
    const compiledAbility = new SentenceCompiler().compile(sentence);
    const command = normalizeAbilityExecutionCommand({
        executionId: options.executionId ?? 'execution.r5.tower-payload',
        executionOrdinal: options.executionOrdinal ?? 7,
        targetFixedTick: options.targetFixedTick ?? 11,
        subjectLimit: 1000,
        generationLimit: 65535,
        aimPoint: { x: 8, y: 6 },
        compiledAbility
    });
    const childCount = options.childCount ?? 1;
    const snapshotToken = Object.freeze({});
    const completion = Object.freeze({
        status: ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE,
        executionId: command.executionId,
        executionOrdinal: command.executionOrdinal,
        commandFingerprint: command.fingerprint,
        snapshotFingerprint: options.snapshotFingerprint ?? 0x550001,
        subjectCount: childCount,
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
        subjectCount: childCount,
        executionOrdinal: command.executionOrdinal,
        commandFingerprint: command.fingerprint,
        snapshotFingerprint: completion.snapshotFingerprint,
        sourceTick: completion.sourceTick,
        ...PROTOCOL
    });
    const snapshotRuntime = new FakeSnapshotRuntime(
        snapshotBinding,
        snapshotToken
    );
    const placementRuntime = new FakeActorActionPlacementRuntime(PROTOCOL);
    const backend = new FakeR5TowerBackend(options);
    const registry = new WorldRegistry({
        capacity: options.registryCapacity ?? 300
    });
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
        transactionId: options.transactionId ?? 'transaction.r5.tower-payload',
        childCount,
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
            mapLatticeVersion: 3,
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
        primaryHandle,
        registry,
        request,
        snapshotRuntime,
        state
    };
}

function runToCreationStage(fixture) {
    assert.equal(
        fixture.coordinator.requestTowerCreation(fixture.request).accepted,
        true
    );
    const placement = fixture.coordinator.stageForFixedTick(
        fixture.command.targetFixedTick
    );
    assert.equal(placement.phase, 'actor-action-placement');
    fixture.placementRuntime.complete();
    const placementReady = fixture.coordinator.observeCompletedAtFixedBoundary(
        fixture.command.targetFixedTick + 1
    );
    assert.equal(placementReady.phase, 'actor-action-placement-ready');
    assert.equal(placementReady.readyForCreationStage, true);
    assert.equal(
        fixture.coordinator.drainActorPayloadTerminalReceipts([]).length,
        0
    );
    const creation = fixture.coordinator
        .stageReadyActorActionPlacementAtFixedBoundary(
            fixture.command.targetFixedTick + 1
        );
    assert.equal(creation.phase, 'tower-creation');
    return creation;
}

test('placement-ready receipt는 terminal이 아니며 취소 시 retained placement를 exact-once 해제한다', () => {
    const fixture = createFixture({
        transactionId: 'transaction.r5.placement-ready-cancel'
    });
    assert.equal(
        fixture.coordinator.requestTowerCreation(fixture.request).accepted,
        true
    );
    fixture.coordinator.stageForFixedTick(fixture.command.targetFixedTick);
    fixture.placementRuntime.complete();
    const ready = fixture.coordinator.observeCompletedAtFixedBoundary(
        fixture.command.targetFixedTick + 1
    );

    assert.equal(ready.phase, 'actor-action-placement-ready');
    assert.equal(ready.terminal, undefined);
    assert.equal(
        fixture.coordinator.drainActorPayloadTerminalReceipts([]).length,
        0
    );
    assert.equal(fixture.snapshotRuntime.releaseCount, 1);
    assert.equal(fixture.placementRuntime.releaseCount, 0);

    const cancelled = fixture.coordinator.cancelPending('ready-cancel-test');
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.recoveryRequired, false);
    assert.equal(fixture.snapshotRuntime.releaseCount, 1);
    assert.equal(fixture.placementRuntime.releaseCount, 1);
    assert.equal(fixture.placementRuntime.records.size, 0);
    assert.equal(fixture.registry.getStatus().reservedCount, 0);
    assert.equal(fixture.backend.preleases.size, 0);

    const receipts = fixture.coordinator.drainActorPayloadTerminalReceipts([]);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].terminal, true);
    assert.equal(receipts[0].result,
        TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED);
});

test('production capability가 없으면 R5 ingress는 정상 RUNTIME_UNAVAILABLE 0-mutation이다', () => {
    const fixture = createFixture();
    const coordinator = new TowerCreationCoordinator({
        towerGroupState: fixture.state,
        registry: fixture.registry,
        backend: {
            ...fixture.backend,
            canStageTowerCreation:
                fixture.backend.canStageTowerCreation.bind(fixture.backend),
            getTowerCreationRuntimeStatus:
                fixture.backend.getTowerCreationRuntimeStatus.bind(fixture.backend),
            getTowerGroupRuntimeStatus:
                fixture.backend.getTowerGroupRuntimeStatus.bind(fixture.backend),
            getAvailableTowerCreationBodyCapacity:
                fixture.backend.getAvailableTowerCreationBodyCapacity
                    .bind(fixture.backend),
            preleaseTowerCreationBodies:
                fixture.backend.preleaseTowerCreationBodies.bind(fixture.backend),
            cancelTowerCreationBodyPrelease:
                fixture.backend.cancelTowerCreationBodyPrelease
                    .bind(fixture.backend),
            stageTowerCreationTransaction:
                fixture.backend.stageTowerCreationTransaction.bind(fixture.backend),
            drainCompletedTowerCreationTransactions:
                fixture.backend.drainCompletedTowerCreationTransactions
                    .bind(fixture.backend),
            finalizeTowerCreationTransaction:
                fixture.backend.finalizeTowerCreationTransaction
                    .bind(fixture.backend),
            cancelAllTowerCreations:
                fixture.backend.cancelAllTowerCreations.bind(fixture.backend),
            getEventProtocolState:
                fixture.backend.getEventProtocolState.bind(fixture.backend)
        },
        abilitySubjectSnapshotRuntime: fixture.snapshotRuntime,
        actorActionPlacementRuntime: fixture.placementRuntime
    });
    assert.equal(coordinator.requestTowerCreation(fixture.request).accepted, true);
    const result = coordinator.stageForFixedTick(fixture.command.targetFixedTick);
    assert.equal(result.result, TOWER_CREATION_RESULT.REJECTED_CAPACITY);
    assert.equal(result.reason, 'RUNTIME_UNAVAILABLE');
    assert.equal(result.recoveryRequired, false);
    assert.equal(fixture.registry.getStatus().reservedCount, 0);
    assert.equal(fixture.state.getTowerRecords().length, 1);
    assert.equal(fixture.backend.preleases.size, 0);
    const terminalReceipts = [];
    coordinator.drainActorPayloadTerminalReceipts(terminalReceipts);
    assert.equal(terminalReceipts.length, 1);
    assert.strictEqual(terminalReceipts[0], result);
    assert.equal(terminalReceipts[0].terminal, true);
    assert.equal(terminalReceipts[0].receiptKind,
        'tower-creation-terminal');
    assert.equal(coordinator.drainActorPayloadTerminalReceipts([]).length, 0);
});

test('Tower/Enemy frozen Subjects의 1/N payload는 mixed generation metadata와 recovery descriptor를 0/N commit한다', () => {
    for (const enemySources of [false, true]) {
        const fixture = createFixture({
            enemySources,
            childCount: enemySources ? 3 : 1,
            transactionId: enemySources
                ? 'transaction.r5.enemy-sources'
                : 'transaction.r5.tower-source'
        });
        runToCreationStage(fixture);
        assert.equal(
            fixture.coordinator.drainActorPayloadTerminalReceipts([]).length,
            0
        );
        const generations = enemySources ? [1, 4, 9] : [2];
        fixture.backend.completeCommitted(generations);
        const committed = fixture.coordinator.observeCompletedAtFixedBoundary(
            fixture.command.targetFixedTick + 2
        );
        assert.equal(committed.result, TOWER_CREATION_RESULT.COMMITTED);
        assert.equal(committed.createdCount, generations.length);
        assert.equal(fixture.snapshotRuntime.releaseCount, 1);
        assert.equal(fixture.placementRuntime.releaseCount, 1);
        assert.equal(fixture.registry.getStatus().reservedCount, 0);
        assert.equal(fixture.backend.preleases.size, 0);
        const children = fixture.state.getTowerRecords().slice(1);
        assert.deepEqual(
            children.map((child) => child.creationMetadata.generation),
            generations
        );
        children.forEach((child, index) => {
            const metadata = child.creationMetadata;
            assert.equal(
                metadata.actorActionProfileFingerprint,
                fixture.command.actorActionProfileFingerprint
            );
            assert.equal(
                metadata.recoveryPlacementDescriptor.logicalTowerOrdinal,
                child.logicalTowerOrdinal
            );
            assert.equal(
                metadata.recoveryPlacementDescriptor.mapLatticeVersion,
                3
            );
            assert.deepEqual(
                metadata.recoveryPlacementDescriptor.position,
                { x: 2, y: 4 }
            );
            const registryView = fixture.registry.copyEntityView(
                committed.handles[index],
                {}
            );
            assert.equal(
                registryView.metadata.abilityGeneration,
                generations[index]
            );
        });
        assert.deepEqual(
            fixture.backend.lastFinalize.childAbilityMetadata.map(
                (metadata) => metadata.generation
            ),
            generations
        );
        assert.equal(fixture.state.auditInvariants().valid, true);
        const terminalReceipts = [];
        fixture.coordinator.drainActorPayloadTerminalReceipts(
            terminalReceipts
        );
        assert.deepEqual(terminalReceipts, [committed]);
        assert.equal(
            fixture.coordinator.drainActorPayloadTerminalReceipts([]).length,
            0
        );
    }
});

test('source snapshot 이후 source 생사와 무관하게 frozen count를 유지하고 group drift만 creation에서 전량 reject한다', () => {
    const fixture = createFixture({ childCount: 2 });
    runToCreationStage(fixture);
    fixture.state.commitCompletedEvents({
        events: [{
            type: 'contact',
            eventType: 'damage-applied',
            disposition: 'applied',
            entityId: 900,
            incarnation: 1,
            other: fixture.primaryHandle,
            ...PROTOCOL,
            sourceTick: 12,
            sequence: 0,
            key: 'r5-group-hp-drift',
            damageFixedPoint: 100,
            reason: null
        }]
    });
    assert.equal(fixture.backend.lastStage.plan.children.length, 2);
    fixture.backend.completeRejected();
    const rejected = fixture.coordinator.observeCompletedAtFixedBoundary(14);
    assert.equal(
        rejected.result,
        TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED
    );
    assert.equal(fixture.registry.getStatus().reservedCount, 0);
    assert.equal(fixture.registry.getStatus().activeCount, 1);
    assert.equal(fixture.state.getTowerRecords().length, 1);
    assert.equal(fixture.placementRuntime.releaseCount, 1);
    assert.equal(
        rejected.actorActionProfileFingerprint,
        fixture.command.actorActionProfileFingerprint
    );
    assert.equal(
        rejected.placementFingerprint,
        fixture.backend.lastStage.actorActionPlacementBinding
            .placementFingerprint
    );
});

test('snapshot 뒤 Tower Subject가 죽어도 다른 living Share 기준으로 frozen child count를 계획한다', () => {
    const fixture = createFixture({
        childCount: 2,
        transactionId: 'transaction.r5.source-death-after-snapshot'
    });
    const seedPlan = fixture.state.planCreation({
        transactionId: 'seed-second-tower',
        childCount: 1,
        childRecoverySpawnDescriptors: [{ position: { x: 3, y: 4 } }]
    });
    const seeded = fixture.state.commitCreation(seedPlan);
    const seedHandle = fixture.registry.reserveEntity({
        kindId: 'tower',
        definitionId: 'the-tower',
        createdAtTick: 1
    });
    fixture.registry.activateReserved(seedHandle, { logicalTowerOrdinal: 2 });
    fixture.state.bindGpuBody(
        seeded.created[0].logicalTowerId,
        seedHandle,
        PROTOCOL
    );
    fixture.state.commitCompletedEvents({
        events: [{
            type: 'death',
            eventType: 'death',
            disposition: 'despawn-requested',
            entityId: fixture.primaryHandle.entityId,
            incarnation: fixture.primaryHandle.incarnation,
            ...PROTOCOL,
            sourceTick: 10,
            sequence: 0,
            key: 'r5-subject-source-death',
            reason: 'health-depleted',
            reasonFlags: 0
        }]
    });
    assert.equal(
        fixture.state.getTowerRecords().filter((record) => record.alive).length,
        1
    );
    runToCreationStage(fixture);
    assert.equal(fixture.backend.lastStage.plan.children.length, 2);
    assert.equal(fixture.backend.lastStage.plan.livingShareUnits, 500_000_000);
    fixture.backend.completeCommitted([2, 5]);
    const committed = fixture.coordinator.observeCompletedAtFixedBoundary(13);
    assert.equal(committed.createdCount, 2);
});

test('R5 production Tower total 256은 stage하고 257은 모든 reservation 전에 거절한다', () => {
    const exact = createFixture({
        childCount: 255,
        capacity: 256,
        registryCapacity: 300,
        transactionId: 'transaction.r5.capacity-256'
    });
    exact.coordinator.requestTowerCreation(exact.request);
    const staged = exact.coordinator.stageForFixedTick(
        exact.command.targetFixedTick
    );
    assert.equal(staged.phase, 'actor-action-placement');
    assert.equal(exact.registry.getStatus().reservedCount, 255);
    exact.coordinator.cancelPending('capacity-fixture-cleanup');

    const overflow = createFixture({
        childCount: 256,
        capacity: 256,
        registryCapacity: 300,
        transactionId: 'transaction.r5.capacity-257'
    });
    overflow.coordinator.requestTowerCreation(overflow.request);
    const rejected = overflow.coordinator.stageForFixedTick(
        overflow.command.targetFixedTick
    );
    assert.equal(rejected.result, TOWER_CREATION_RESULT.REJECTED_CAPACITY);
    assert.equal(rejected.reason, 'TOWER_CAPACITY');
    assert.equal(overflow.registry.getStatus().reservedCount, 0);
    assert.equal(overflow.backend.preleases.size, 0);
});

test('zero living Share는 placement/body/registry prelease 전에 whole reject한다', () => {
    const fixture = createFixture({
        transactionId: 'transaction.r5.zero-share'
    });
    fixture.state.commitCompletedEvents({
        events: [{
            type: 'death',
            eventType: 'death',
            disposition: 'despawn-requested',
            entityId: fixture.primaryHandle.entityId,
            incarnation: fixture.primaryHandle.incarnation,
            ...PROTOCOL,
            sourceTick: 10,
            sequence: 0,
            key: 'r5-zero-share-death',
            reason: 'health-depleted',
            reasonFlags: 0
        }]
    });
    // 유일한 body가 retire되며 GPU snapshot binding도 사라진 경계에서도
    // canonical living-Share 0 판정이 SOURCE_STATE_CHANGED보다 우선합니다.
    fixture.snapshotRuntime.binding = null;
    fixture.coordinator.requestTowerCreation(fixture.request);
    const rejected = fixture.coordinator.stageForFixedTick(
        fixture.command.targetFixedTick
    );
    assert.equal(rejected.result, TOWER_CREATION_RESULT.REJECTED_ZERO_SHARE);
    assert.equal(fixture.registry.getStatus().reservedCount, 0);
    assert.equal(fixture.backend.preleases.size, 0);
});

test('SDF placement reject는 registry/body/ledger/cooldown-side mutation 없이 전량 rollback한다', () => {
    const fixture = createFixture({ childCount: 3 });
    fixture.coordinator.requestTowerCreation(fixture.request);
    fixture.coordinator.stageForFixedTick(fixture.command.targetFixedTick);
    assert.equal(fixture.registry.getStatus().reservedCount, 3);
    fixture.placementRuntime.complete(
        GPU_ACTOR_ACTION_PLACEMENT_STATUS.SDF_REJECTED
    );
    const rejected = fixture.coordinator.observeCompletedAtFixedBoundary(12);
    assert.equal(rejected.result, TOWER_CREATION_RESULT.REJECTED_DESCRIPTOR);
    assert.equal(rejected.recoveryRequired, false);
    assert.equal(fixture.registry.getStatus().reservedCount, 0);
    assert.equal(fixture.registry.getStatus().activeCount, 1);
    assert.equal(fixture.backend.preleases.size, 0);
    assert.equal(fixture.state.getTowerRecords().length, 1);
});

test('same transaction replay는 snapshot token/profile까지 bind하고 altered snapshot은 mismatch다', () => {
    const fixture = createFixture();
    const first = fixture.coordinator.requestTowerCreation(fixture.request);
    assert.strictEqual(
        fixture.coordinator.requestTowerCreation(fixture.request),
        first
    );
    const alteredFixture = createFixture({
        transactionId: fixture.request.transactionId,
        snapshotFingerprint: fixture.completion.snapshotFingerprint + 1
    });
    const mismatch = fixture.coordinator.requestTowerCreation({
        ...alteredFixture.request,
        command: fixture.command,
        executionId: fixture.command.executionId,
        executionOrdinal: fixture.command.executionOrdinal,
        subjectCompletion: Object.freeze({
            ...alteredFixture.completion,
            executionId: fixture.command.executionId,
            executionOrdinal: fixture.command.executionOrdinal,
            commandFingerprint: fixture.command.fingerprint
        })
    });
    assert.equal(mismatch.result, TOWER_CREATION_RESULT.PROTOCOL_FAILURE);
    assert.equal(mismatch.reason, 'TRANSACTION_FINGERPRINT_MISMATCH');
    assert.equal(mismatch.recoveryRequired, true);
    assert.equal(fixture.registry.getStatus().reservedCount, 0);
});
