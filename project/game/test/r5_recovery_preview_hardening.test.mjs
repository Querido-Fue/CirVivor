import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ABILITY_CREATION_ORIGIN_CODE,
    ABILITY_SUBJECT_SNAPSHOT_STATUS,
    createAbilityEntityMetadata
} = await loadGameModule('ingame/contract/ability_execution_contract.js');
const {
    ABILITY_SLOT_ID,
    SENTENCE_ACTION_CODE,
    normalizeSentenceDefinition
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    R3_ENEMY_WORD_INSTANCE,
    R3_SHOOT_WORD_INSTANCE,
    R3_TOWER_WORD_INSTANCE,
    R5_EMIT_WORD_INSTANCE,
    R5_SUMMON_WORD_INSTANCE,
    R5_THROW_WORD_INSTANCE
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    R5_THROW_ACTOR_ACTION_PROFILE
} = await loadGameModule('data/word/r5_actor_action_profile_data.js');
const {
    ABILITY_ACTIVATION_RESULT_CODE,
    ABILITY_EXECUTION_OUTCOME_CODE,
    WordSystem
} = await loadGameModule('ingame/word/word_system.js');
const {
    AbilityRuntime
} = await loadGameModule('ingame/word/ability_runtime.js');
const {
    ActorPayloadMaterializer
} = await loadGameModule('ingame/word/actor_payload_materializer.js');
const {
    SentenceCompiler
} = await loadGameModule('ingame/word/sentence_compiler.js');
const {
    SentenceRuntimeEstimator
} = await loadGameModule('ingame/word/sentence_runtime_estimator.js');
const {
    createGpuTowerSpawnIntent
} = await loadGameModule('ingame/object/tower/gpu_tower_spawn_adapter.js');
const {
    createGpuRegistryMetadata,
    normalizeGpuSpawnIntent
} = await loadGameModule('ingame/object/gpu_spawn_intent.js');
const {
    TOWER_RECOVERY_PLACEMENT_POLICY_ID,
    createTowerRecoveryPlacementDescriptor
} = await loadGameModule('ingame/object/tower/tower_group_contract.js');

class FakeRecoveryEndpoint {
    constructor(sessionGeneration = 1) {
        this.sessionGeneration = sessionGeneration;
        this.abilityRequests = [];
        this.abilityCompletions = [];
        this.payloadRequests = [];
        this.payloadCompletions = [];
        this.snapshotTokens = new Set();
        this.cancelledPayloadCount = 0;
        this.cancelledAbilityCount = 0;
    }

    requestAbilityExecutionCommand(command) {
        this.abilityRequests.push(command);
        return { accepted: true };
    }

    drainCompletedAbilitySubjectSnapshots(out) {
        out.push(...this.abilityCompletions);
        this.abilityCompletions.length = 0;
        return out;
    }

    completeSubjects(command, subjectCount = 1) {
        const snapshotToken = subjectCount > 0 ? Object.freeze({}) : null;
        if (snapshotToken) this.snapshotTokens.add(snapshotToken);
        this.abilityCompletions.push(Object.freeze({
            executionId: command.executionId,
            executionOrdinal: command.executionOrdinal,
            commandFingerprint: command.fingerprint,
            targetFixedTick: command.targetFixedTick,
            sourceTick: command.targetFixedTick,
            status: subjectCount > 0
                ? ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE
                : ABILITY_SUBJECT_SNAPSHOT_STATUS.ZERO_SUBJECT,
            subjectCount,
            capacityDemand: subjectCount,
            snapshotFingerprint: 0x7100 + command.executionOrdinal,
            snapshotToken,
            requiresRecovery: false
        }));
    }

    getAbilitySubjectSnapshotGpuBinding(token) {
        return this.snapshotTokens.has(token) ? { token } : null;
    }

    releaseAbilitySubjectSnapshot(token) {
        return this.snapshotTokens.delete(token);
    }

    getAbilitySubjectSnapshotStatus() {
        return { requiresRecovery: false };
    }

    requestActorPayloadMaterialization(request) {
        this.payloadRequests.push(request);
        return Object.freeze({
            accepted: true,
            transactionId: request.transactionId,
            reservationCount: request.subjectCompletion.subjectCount
        });
    }

    drainCompletedActorPayloadMaterializations(out) {
        out.push(...this.payloadCompletions);
        this.payloadCompletions.length = 0;
        return out;
    }

    completePayload(request) {
        this.payloadCompletions.push(Object.freeze({
            transactionId: request.transactionId,
            executionOrdinal: request.command.executionOrdinal,
            commandFingerprint: request.command.fingerprint,
            snapshotFingerprint:
                request.subjectCompletion.snapshotFingerprint,
            subjectCount: request.subjectCompletion.subjectCount,
            materializationTargetTick: request.targetFixedTick,
            status: 1,
            state: 'COMMITTED',
            committed: true,
            generatedCount: request.subjectCompletion.subjectCount,
            requiresRecovery: false
        }));
    }

    cancelPendingActorPayloadMaterializations() {
        this.cancelledPayloadCount += this.payloadRequests.length;
        return Object.freeze({
            cancelledExecutionCount: this.payloadRequests.length
        });
    }

    getActorPayloadMaterializationStatus() {
        return Object.freeze({
            requiresRecovery: false,
            aggregateReadbackByteSize: 64,
            placement: Object.freeze({
                commandHighWater: this.payloadRequests.length,
                aggregateReadbackByteSize: 96,
                requiresRecovery: false
            }),
            transit: Object.freeze({
                activeActorCount: 0,
                activeActorHighWater: 0,
                aggregateReadbackByteSize: 64,
                requiresRecovery: false
            })
        });
    }

    getStatus() {
        return { sessionGeneration: this.sessionGeneration };
    }

    getBackend() {
        return Object.freeze({
            cancelPendingAbilityExecutions: () => {
                this.cancelledAbilityCount++;
            }
        });
    }
}

function createSentence(verbWordInstance, id) {
    return normalizeSentenceDefinition({
        id,
        subjectWordInstanceId: R3_TOWER_WORD_INSTANCE.id,
        verbWordInstanceId: verbWordInstance.id,
        payloadWordInstanceId: R3_ENEMY_WORD_INSTANCE.id,
        modifierWordInstanceIds: []
    });
}

test('GPU-world 교체는 네 verb의 pending payload를 전부 취소하고 old completion을 격리한다', () => {
    const verbSlots = Object.freeze([
        [ABILITY_SLOT_ID.E, R3_SHOOT_WORD_INSTANCE, 'Shoot'],
        [ABILITY_SLOT_ID.SHIFT, R5_THROW_WORD_INSTANCE, 'Throw'],
        [ABILITY_SLOT_ID.SPACE, R5_EMIT_WORD_INSTANCE, 'Emit'],
        [ABILITY_SLOT_ID.Q, R5_SUMMON_WORD_INSTANCE, 'Summon']
    ]);
    const loadout = Object.fromEntries(verbSlots.map(
        ([slotId, verb]) => [slotId, createSentence(
            verb,
            `sentence.r5.recovery.${verb.id}`
        )]
    ));
    const oldEndpoint = new FakeRecoveryEndpoint(3);
    const wordSystem = new WordSystem({ loadout });
    const abilityRuntime = new AbilityRuntime({
        wordSystem,
        endpoint: oldEndpoint
    });
    const materializer = new ActorPayloadMaterializer({
        abilityRuntime,
        endpoint: oldEndpoint
    });

    wordSystem.beginFixedTick(1);
    for (const [slotId] of verbSlots) {
        assert.equal(wordSystem.requestSlotActivation(slotId).code,
            ABILITY_ACTIVATION_RESULT_CODE.REQUESTED);
    }
    assert.equal(abilityRuntime.stageForFixedTick({ targetFixedTick: 1 })
        .acceptedCount, 4);
    for (const command of oldEndpoint.abilityRequests) {
        oldEndpoint.completeSubjects(command, 1);
    }
    assert.equal(abilityRuntime.observeCompletedSubjectSnapshots(1)
        .readyCount, 4);
    assert.equal(materializer.stageReadyForFixedTick({ targetFixedTick: 1 })
        .stagedCount, 4);

    const activeStatus = materializer.getStatus();
    assert.equal(activeStatus.telemetry.inFlightHighWater, 4);
    assert.equal(activeStatus.telemetry.subjectHighWater, 1);
    assert.equal(activeStatus.telemetry.placementHighWater, 4);
    assert.deepEqual(Object.keys(activeStatus.telemetry.perVerbCounts),
        ['Shoot', 'Throw', 'Emit', 'Summon']);
    for (const [, , verbName] of verbSlots) {
        assert.deepEqual(activeStatus.telemetry.perVerbCounts[verbName], {
            staged: 1,
            committed: 0,
            rejected: 0,
            cancelled: 0
        });
    }

    const replacement = new FakeRecoveryEndpoint(4);
    assert.equal(materializer.resetGpuBinding(replacement), true);
    assert.equal(abilityRuntime.resetGpuBinding(replacement), true);
    assert.equal(oldEndpoint.snapshotTokens.size, 0);
    assert.equal(oldEndpoint.cancelledPayloadCount, 4);
    assert.equal(abilityRuntime.getStatus().history.length, 4);
    assert.ok(abilityRuntime.getStatus().history.every(
        ({ code }) => code === ABILITY_EXECUTION_OUTCOME_CODE.CANCELLED
    ));
    for (const [slotId] of verbSlots) {
        assert.equal(wordSystem.getSlotView(slotId)
            .cooldown.nextEligibleFixedTick, 0);
    }

    for (const request of oldEndpoint.payloadRequests) {
        oldEndpoint.completePayload(request);
    }
    assert.equal(materializer.observeCompleted(2).observedCount, 0);
    assert.equal(oldEndpoint.payloadCompletions.length, 4);
    const recoveredStatus = materializer.getStatus();
    assert.equal(recoveredStatus.totalCancelled, 4);
    assert.equal(recoveredStatus.telemetry.capacityReasons.cancelled, 4);
    for (const [, , verbName] of verbSlots) {
        assert.equal(
            recoveredStatus.telemetry.perVerbCounts[verbName].cancelled,
            1
        );
    }
    assert.ok(JSON.stringify(recoveredStatus.telemetry).length < 4096);
    assert.equal(Array.isArray(recoveredStatus.telemetry), false);

    materializer.destroy();
    abilityRuntime.destroy();
    wordSystem.destroy();
});

test('Tower preview는 generation eligibility와 R4 plan/action 경계를 분리해 노출한다', () => {
    const throwTowerSentence = normalizeSentenceDefinition({
        id: 'sentence.r5.preview.tower-throws-tower',
        subjectWordInstanceId: R3_TOWER_WORD_INSTANCE.id,
        verbWordInstanceId: R5_THROW_WORD_INSTANCE.id,
        payloadWordInstanceId: R3_TOWER_WORD_INSTANCE.id,
        modifierWordInstanceIds: []
    });
    const compiledAbility = new SentenceCompiler().compile(
        throwTowerSentence
    );
    const towerPlan = Object.freeze({
        accepted: true,
        executionEnabled: true,
        reason: null,
        livingShareUnits: 900_000_000,
        lostShareUnits: 100_000_000,
        totalLivingCurrentHp: 75_000,
        existing: Object.freeze([{ logicalTowerOrdinal: 1 }]),
        children: Object.freeze([
            { logicalTowerOrdinal: 4 },
            { logicalTowerOrdinal: 5 }
        ]),
        capacity: Object.freeze({
            currentTowerCount: 3,
            childCount: 2,
            requiredTowerCount: 5,
            productionTowerCapacity: 256
        })
    });
    let requestedChildCount = null;
    const exact = new SentenceRuntimeEstimator({
        getRuntimeState: () => ({
            livingTowerCount: 3,
            towerSubjectCountExact: true,
            eligibleTowerActorCount: 2,
            towerGenerationEligibilityExact: true,
            liveHostileActorCount: 0,
            hostileSubjectCountExact: true,
            registryAvailable: 256,
            bodyAvailable: 256
        }),
        previewTowerCreation: ({ childCount }) => {
            requestedChildCount = childCount;
            return towerPlan;
        }
    }).estimate(compiledAbility, { cooldown: { remainingTicks: 0 } });

    assert.equal(requestedChildCount, 2);
    assert.equal(exact.rawSubjectCount, 3);
    assert.equal(exact.eligibleSubjectCount, 2);
    assert.equal(exact.eligibleSubjectCountExact, true);
    assert.equal(exact.generationEligibilityExact, true);
    assert.equal(exact.generationLimit,
        compiledAbility.budgets.generation);
    assert.equal(exact.newTowerCount, 2);
    assert.equal(exact.travelDurationFixedTicks, 30);
    assert.equal(exact.activationDelayFixedTicks, 30);
    assert.equal(exact.actorAction.profileFingerprint,
        R5_THROW_ACTOR_ACTION_PROFILE.actorActionProfileFingerprint);
    assert.strictEqual(exact.towerCapacity, towerPlan.capacity);
    assert.deepEqual(exact.towerShare, {
        livingShareUnits: 900_000_000,
        lostShareUnits: 100_000_000,
        totalLivingCurrentHp: 75_000
    });
    assert.deepEqual(exact.towerAllocations, {
        existing: towerPlan.existing,
        children: towerPlan.children
    });
    assert.equal(exact.towerPlanExact, true);
    assert.equal(exact.placementExact, false);
    assert.equal(exact.previewExact, false);
    assert.equal(exact.executionEnabled, true);

    const exactGenerationZero = new SentenceRuntimeEstimator({
        getRuntimeState: () => ({
            livingTowerCount: 3,
            towerSubjectCountExact: true,
            eligibleTowerActorCount: 0,
            towerGenerationEligibilityExact: true,
            registryAvailable: 256,
            bodyAvailable: 256
        }),
        previewTowerCreation: () => {
            throw new Error('zero subject는 R4 preview를 호출하면 안 됩니다.');
        }
    }).estimate(compiledAbility, { cooldown: { remainingTicks: 0 } });
    assert.equal(exactGenerationZero.eligibleSubjectCount, 0);
    assert.equal(exactGenerationZero.executionEnabled, false);
    assert.equal(exactGenerationZero.executionDisabledReason, 'ZERO_SUBJECT');
    assert.equal(exactGenerationZero.cooldownRemainingTicks, 0);

    const unknownCount = new SentenceRuntimeEstimator({
        getRuntimeState: () => ({
            livingTowerCount: null,
            towerSubjectCountExact: false,
            registryAvailable: 256,
            bodyAvailable: 256
        }),
        previewTowerCreation: () => towerPlan
    }).estimate(compiledAbility, { cooldown: { remainingTicks: 0 } });
    assert.equal(unknownCount.executionEnabled, false);
    assert.equal(unknownCount.executionDisabledReason,
        'SUBJECT_COUNT_NOT_EXACT');
    assert.equal(unknownCount.cooldownRemainingTicks, 0);

    const generationUnknown = new SentenceRuntimeEstimator({
        getRuntimeState: () => ({
            livingTowerCount: 3,
            towerSubjectCountExact: true,
            registryAvailable: 256,
            bodyAvailable: 256
        }),
        previewTowerCreation: ({ childCount }) => ({
            ...towerPlan,
            children: Object.freeze(Array.from(
                { length: childCount },
                (_, index) => ({ logicalTowerOrdinal: index + 4 })
            ))
        })
    }).estimate(compiledAbility, { cooldown: { remainingTicks: 0 } });
    assert.equal(generationUnknown.eligibleSubjectCount, 3);
    assert.equal(generationUnknown.generationEligibilityExact, false);
    assert.equal(generationUnknown.eligibleSubjectCountExact, false);
    assert.equal(generationUnknown.towerPlanExact, false);
});

test('recovery Tower spawn intent는 durable generation/provenance를 복원하고 transit은 재생성하지 않는다', () => {
    const recoveryPlacementDescriptor = createTowerRecoveryPlacementDescriptor({
        policyId:
            TOWER_RECOVERY_PLACEMENT_POLICY_ID.MAP_ANCHOR_LATTICE_V1,
        mapRecoveryAnchorId: 'map:r5-recovery:tower-spawn',
        mapLatticeVersion: 3,
        anchorPosition: { x: 8.5, y: 6.25 }
    }, 2);
    const creationMetadata = Object.freeze({
        generation: 7,
        creationOriginCode:
            ABILITY_CREATION_ORIGIN_CODE.SENTENCE_PAYLOAD,
        sourceAbilityCode: 731,
        sourceExecutionId: 'ability-execution.r5.recovery:41',
        sourceExecutionFingerprint: 0x1234abcd,
        sourceExecutionOrdinal: 41,
        visibleFromExecutionOrdinal: 42,
        actorActionCode: SENTENCE_ACTION_CODE.THROW,
        actorActionProfileId: R5_THROW_ACTOR_ACTION_PROFILE.id,
        actorActionProfileFingerprint:
            R5_THROW_ACTOR_ACTION_PROFILE.actorActionProfileFingerprint,
        recoveryPlacementDescriptor
    });
    const intent = createGpuTowerSpawnIntent({
        position: recoveryPlacementDescriptor.position,
        logicalTowerOrdinal: 2,
        shareUnits: 500_000_000,
        creationMetadata
    });

    assert.equal(intent.abilityGeneration, 7);
    assert.equal(intent.abilityCreationOriginCode,
        ABILITY_CREATION_ORIGIN_CODE.SENTENCE_PAYLOAD);
    assert.equal(intent.sourceAbilityCode, 731);
    assert.equal('sourceExecutionId' in intent, false);
    assert.equal(intent.sourceExecutionFingerprint, 0x1234abcd);
    assert.equal(intent.sourceExecutionOrdinal, 41);
    assert.equal(intent.visibleFromExecutionOrdinal, 42);
    assert.equal(intent.actorActionCode, SENTENCE_ACTION_CODE.THROW);
    assert.equal(intent.actorActionProfileId,
        R5_THROW_ACTOR_ACTION_PROFILE.id);
    assert.equal(intent.actorActionProfileFingerprint,
        R5_THROW_ACTOR_ACTION_PROFILE.actorActionProfileFingerprint);
    assert.equal(intent.recoveryPlacementPolicyId,
        TOWER_RECOVERY_PLACEMENT_POLICY_ID.MAP_ANCHOR_LATTICE_V1);
    assert.equal(intent.recoveryLogicalTowerOrdinal, 2);
    assert.equal(intent.mapRecoveryAnchorId,
        'map:r5-recovery:tower-spawn');
    assert.equal(intent.mapRecoveryLatticeVersion, 3);
    assert.deepEqual(intent.position, { x: 8.5, y: 6.25 });
    assert.deepEqual(intent.velocity, { x: 0, y: 0 });
    assert.equal('actorTransitPhase' in intent, false);
    assert.equal('travelDurationFixedTicks' in intent, false);
    const normalizedIntent = normalizeGpuSpawnIntent(intent);
    const registryMetadata = createGpuRegistryMetadata(normalizedIntent);
    const abilityMetadata = createAbilityEntityMetadata({
        kindId: normalizedIntent.kindId,
        definitionId: normalizedIntent.definitionId,
        metadata: registryMetadata
    });
    assert.equal(registryMetadata.sourceExecutionFingerprint, 0x1234abcd);
    assert.equal(registryMetadata.actorActionProfileFingerprint,
        R5_THROW_ACTOR_ACTION_PROFILE.actorActionProfileFingerprint);
    assert.equal(abilityMetadata.generation, 7);
    assert.equal(abilityMetadata.sourceAbilityCode, 731);
    assert.equal(abilityMetadata.sourceExecutionFingerprint, 0x1234abcd);
    assert.equal(abilityMetadata.sourceExecutionOrdinal, 41);
    assert.equal(abilityMetadata.visibleFromExecutionOrdinal, 42);
    assert.throws(() => createGpuRegistryMetadata({
        ...normalizedIntent,
        actorActionProfileFingerprint: undefined
    }), /모두 함께 제공/);
    assert.throws(() => createGpuRegistryMetadata({
        ...normalizedIntent,
        mapRecoveryAnchorX: normalizedIntent.mapRecoveryAnchorX + 0.25
    }), /ordinal\/visibility\/anchor/);
});
