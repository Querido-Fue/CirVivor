import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ABILITY_SUBJECT_SNAPSHOT_STATUS
} = await loadGameModule('ingame/contract/ability_execution_contract.js');
const {
    ABILITY_SLOT_ID
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    R5_SHOWCASE_SENTENCE_LOADOUT,
    R6_QA_SENTENCE_LOADOUT,
    R6_TOWERS_MERGE_SENTENCE
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    ABILITY_ACTIVATION_RESULT_CODE,
    ABILITY_EXECUTION_OUTCOME_CODE,
    WordSystem
} = await loadGameModule('ingame/word/word_system.js');
const {
    ABILITY_EXECUTION_STATE,
    AbilityRuntime
} = await loadGameModule('ingame/word/ability_runtime.js');
const {
    SentenceCompiler
} = await loadGameModule('ingame/word/sentence_compiler.js');
const {
    SentenceRuntimeEstimator
} = await loadGameModule('ingame/word/sentence_runtime_estimator.js');
const {
    TOWER_GROUP_RECORD_STATE,
    TowerGroupState
} = await loadGameModule('ingame/object/tower/tower_group_state.js');
const {
    TowerMergeCoordinator
} = await loadGameModule('ingame/object/tower/tower_merge_coordinator.js');
const {
    WorldRegistry
} = await loadGameModule('ingame/object/world_registry.js');
const {
    PRODUCTION_STAGE_ONE_SELECTION_MAP_ID,
    R6_QA_LAUNCH_ARGUMENT,
    createProductionGameStartOptions,
    createR6QaGameStartOptions,
    isR6QaLaunchRequested
} = await loadGameModule('scene/game/production_game_start_route.js');

const PROTOCOL = Object.freeze({
    sessionGeneration: 31,
    deviceGeneration: 7,
    authoritativeEpoch: 11
});
const MERGE_OPERATION = new SentenceCompiler().compile(
    R6_TOWERS_MERGE_SENTENCE
);

function assertDeepFrozen(value, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
        assertDeepFrozen(child, visited);
    }
}

class FakeAbilityEndpoint {
    constructor(sessionGeneration = 1) {
        this.sessionGeneration = sessionGeneration;
        this.requests = [];
        this.completions = [];
        this.snapshotTokens = new Set();
        this.cancelled = 0;
        this.nextReceipt = null;
    }

    requestAbilityExecutionCommand(command) {
        this.requests.push(command);
        if (this.nextReceipt) {
            const receipt = this.nextReceipt;
            this.nextReceipt = null;
            return receipt;
        }
        return Object.freeze({ accepted: true });
    }

    drainCompletedAbilitySubjectSnapshots(out) {
        out.push(...this.completions);
        this.completions.length = 0;
        return out;
    }

    complete(command, subjectCount, status = null) {
        const resolvedStatus = status ?? (subjectCount === 0
            ? ABILITY_SUBJECT_SNAPSHOT_STATUS.ZERO_SUBJECT
            : ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE);
        const snapshotToken = resolvedStatus
                === ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE
            && subjectCount > 0
            ? Object.freeze({})
            : null;
        if (snapshotToken) this.snapshotTokens.add(snapshotToken);
        this.completions.push(Object.freeze({
            executionId: command.executionId,
            executionOrdinal: command.executionOrdinal,
            commandFingerprint: command.fingerprint,
            targetFixedTick: command.targetFixedTick,
            sourceTick: command.targetFixedTick,
            status: resolvedStatus,
            subjectCount,
            capacityDemand: subjectCount,
            snapshotFingerprint: 0x9000 + command.executionOrdinal,
            snapshotToken,
            requiresRecovery: false
        }));
    }

    getAbilitySubjectSnapshotGpuBinding(token) {
        return this.snapshotTokens.has(token)
            ? Object.freeze({ token })
            : null;
    }

    releaseAbilitySubjectSnapshot(token) {
        return this.snapshotTokens.delete(token);
    }

    getAbilitySubjectSnapshotStatus() {
        return Object.freeze({ requiresRecovery: false });
    }

    getStatus() {
        return Object.freeze({ sessionGeneration: this.sessionGeneration });
    }

    getBackend() {
        return Object.freeze({
            cancelPendingAbilityExecutions: () => {
                this.cancelled++;
            }
        });
    }
}

class PreviewMergeBackend {
    canStageTowerMerge() { return true; }
    stageTowerMergeTransaction() {
        throw new Error('preview fixture는 stage하지 않습니다.');
    }
    drainCompletedTowerMergeTransactions(out) { return out; }
    finalizeTowerMergeTransaction() { return { accepted: false }; }
    cleanupTowerMergeTransaction() { return { accepted: false }; }
    cancelAllTowerMerges() { return { requiresRecovery: false }; }
    getTowerMergeRuntimeStatus() {
        return Object.freeze({
            state: 'ready',
            recordCapacity: 256,
            requiresRecovery: false,
            failure: null
        });
    }
    getEventProtocolState() { return PROTOCOL; }
}

function createAbilityHarness(endpoint = new FakeAbilityEndpoint()) {
    const wordSystem = new WordSystem({ loadout: R6_QA_SENTENCE_LOADOUT });
    const abilityRuntime = new AbilityRuntime({ wordSystem, endpoint });
    return { wordSystem, abilityRuntime, endpoint };
}

function destroyAbilityHarness(harness) {
    harness.abilityRuntime.destroy();
    harness.wordSystem.destroy();
}

function requestMergeSnapshot(harness, tick, subjectCount) {
    const { wordSystem, abilityRuntime, endpoint } = harness;
    wordSystem.beginFixedTick(tick);
    const activation = wordSystem.requestSlotActivation(
        ABILITY_SLOT_ID.SHIFT,
        { targetFixedTick: tick }
    );
    assert.equal(activation.code, ABILITY_ACTIVATION_RESULT_CODE.REQUESTED);
    assert.equal(abilityRuntime.stageForFixedTick({ targetFixedTick: tick })
        .acceptedCount, 1);
    const command = endpoint.requests.at(-1);
    endpoint.complete(command, subjectCount);
    const observation = abilityRuntime.observeCompletedSubjectSnapshots(
        tick + 1
    );
    return { command, observation };
}

function createPreviewFixture(count) {
    const state = new TowerGroupState();
    if (count > 1) {
        const plan = state.planCreation({
            transactionId: `preview-split-${count}`,
            childCount: count - 1
        });
        assert.equal(state.commitCreation(plan).accepted, true);
    }
    const registry = new WorldRegistry({ capacity: count + 2 });
    for (const record of state.getTowerRecords()) {
        if (record.state !== TOWER_GROUP_RECORD_STATE.LIVING) continue;
        const handle = registry.reserveEntity({
            kindId: 'tower',
            definitionId: 'the-tower',
            createdAtTick: 0
        });
        assert.equal(registry.activateReserved(handle, {}), true);
        state.bindGpuBody(record.logicalTowerId, handle, PROTOCOL);
    }
    const coordinator = new TowerMergeCoordinator({
        towerGroupState: state,
        registry,
        backend: new PreviewMergeBackend()
    });
    return { state, registry, coordinator };
}

test('R6 QA launcher만 Merge slot을 주입하고 preview는 exact scalar plan을 노출한다', () => {
    assert.equal(isR6QaLaunchRequested([R6_QA_LAUNCH_ARGUMENT]), true);
    assert.equal(isR6QaLaunchRequested([]), false);
    assert.equal(isR6QaLaunchRequested(['--r6-qa-extra']), false);
    const production = createProductionGameStartOptions(
        PRODUCTION_STAGE_ONE_SELECTION_MAP_ID
    );
    const qa = createR6QaGameStartOptions(
        PRODUCTION_STAGE_ONE_SELECTION_MAP_ID
    );
    assert.strictEqual(
        production.wordSystemOptions.loadout,
        R5_SHOWCASE_SENTENCE_LOADOUT
    );
    assert.strictEqual(qa.wordSystemOptions.loadout, R6_QA_SENTENCE_LOADOUT);
    assert.notStrictEqual(
        production.wordSystemOptions.loadout[ABILITY_SLOT_ID.SHIFT],
        qa.wordSystemOptions.loadout[ABILITY_SLOT_ID.SHIFT]
    );

    const fixture = createPreviewFixture(4);
    const plan = fixture.coordinator.previewTowerMerge({
        compiledOperation: MERGE_OPERATION,
        requestedFixedTick: 9
    });
    const estimator = new SentenceRuntimeEstimator({
        getRuntimeState: () => Object.freeze({
            nextFixedTick: 9,
            livingTowerCount: 4,
            towerSubjectCountExact: true,
            liveHostileActorCount: 3,
            pendingHostileActorCount: 1,
            siegeWeight: 3,
            registryAvailable: 20,
            bodyAvailable: 20
        }),
        previewTowerMerge: (request) => (
            fixture.coordinator.previewTowerMerge(request)
        )
    });
    const preview = estimator.estimate(MERGE_OPERATION, {
        cooldown: { remainingTicks: 0 }
    });
    assert.equal(preview.previewExact, true);
    assert.equal(preview.executionEnabled, true);
    assert.equal(preview.rawSubjectCount, 4);
    assert.equal(preview.resultingTowerCount, 1);
    assert.equal(preview.warningCode, 'TOWER_MERGE_CONSOLIDATION');
    assert.deepEqual(preview.towerMergePreview, {
        sourceCount: 4,
        result: plan.result ?? null,
        reason: plan.reason ?? null,
        survivor: {
            logicalTowerId: plan.survivor.logicalTowerId,
            logicalTowerOrdinal: plan.survivor.logicalTowerOrdinal,
            exactGpuBinding: {
                entityId: plan.survivor.exactGpuBinding.entityId,
                incarnation: plan.survivor.exactGpuBinding.incarnation
            }
        },
        livingShareUnits: plan.livingShareUnits,
        lostShareUnits: plan.lostShareUnits,
        currentHpFixedPoint: plan.currentHpFixedPoint,
        maxHpFixedPoint: plan.maxHpFixedPoint,
        powerFixedPoint: plan.powerFixedPoint
    });
    assertDeepFrozen(preview);
    estimator.destroy();
    fixture.coordinator.destroy();
    fixture.registry.destroy();
    fixture.state.destroy();
});

test('0/1 Tower snapshot은 authentic INSUFFICIENT_SUBJECTS이고 cooldown을 소비하지 않는다', () => {
    for (const subjectCount of [0, 1]) {
        const harness = createAbilityHarness();
        const { command, observation } = requestMergeSnapshot(
            harness,
            3,
            subjectCount
        );
        assert.equal(command.payloadCode, 0);
        assert.equal(command.targetPolicyCode, 0);
        assert.equal(command.actorActionProfileFingerprint, 0);
        assert.equal(
            command.groupOperationProfileFingerprint,
            MERGE_OPERATION.groupOperationProfileFingerprint
        );
        assert.equal(command.generationLimit, 0xffffffff);
        assert.equal(observation.readyTowerMergeCount, 0);
        assert.equal(
            harness.abilityRuntime.getStatus().lastExecutionState.state,
            ABILITY_EXECUTION_STATE.INSUFFICIENT_SUBJECTS
        );
        assert.equal(
            harness.wordSystem.getStatusView().lastExecutionOutcome.code,
            ABILITY_EXECUTION_OUTCOME_CODE.INSUFFICIENT_SUBJECTS
        );
        assert.equal(
            harness.wordSystem.getStatusView().lastExecutionOutcome
                .cooldownConsumed,
            false
        );
        assert.equal(
            harness.wordSystem.getSlotView(ABILITY_SLOT_ID.SHIFT)
                .cooldown.nextEligibleFixedTick,
            0
        );
        destroyAbilityHarness(harness);
    }
});

test('Merge stage receipt는 nonterminal이고 authentic COMMITTED terminal만 exact 1회 cooldown을 소비한다', () => {
    const harness = createAbilityHarness();
    const { observation } = requestMergeSnapshot(harness, 10, 2);
    assert.equal(observation.readyTowerMergeCount, 1);
    assert.equal(harness.abilityRuntime.drainReadySnapshots([]).length, 0);
    const [ready] = harness.abilityRuntime
        .drainReadyTowerMergeSnapshots([]);
    assert.equal(harness.abilityRuntime.markTowerMergePending(ready, 11), true);
    assert.equal(harness.endpoint.snapshotTokens.size, 0);
    assert.equal(harness.wordSystem.getStatusView().lastExecutionOutcome, null);
    assert.equal(
        harness.abilityRuntime.getStatus().lastExecutionState.state,
        ABILITY_EXECUTION_STATE.TOWER_MERGE_PENDING
    );

    assert.equal(harness.abilityRuntime.completeSnapshotExecution(ready, {
        snapshotAlreadyReleased: true,
        completedFixedTick: 12,
        generatedCount: 0
    }), true);
    assert.equal(harness.abilityRuntime.completeSnapshotExecution(ready, {
        snapshotAlreadyReleased: true,
        completedFixedTick: 12,
        generatedCount: 0
    }), false);
    const status = harness.abilityRuntime.getStatus();
    assert.equal(status.history.length, 1);
    assert.equal(status.history[0].code,
        ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED);
    assert.deepEqual(status.executionStateHistory.map(({ state }) => state), [
        ABILITY_EXECUTION_STATE.REQUESTED,
        ABILITY_EXECUTION_STATE.SUBJECT_SNAPSHOT_PENDING,
        ABILITY_EXECUTION_STATE.DESTINATION_PRELEASE_PENDING,
        ABILITY_EXECUTION_STATE.TOWER_MERGE_PENDING,
        ABILITY_EXECUTION_STATE.COMMITTED
    ]);
    assert.equal(
        harness.wordSystem.getStatusView().lastExecutionOutcome
            .cooldownConsumed,
        true
    );
    harness.wordSystem.beginFixedTick(12);
    assert.equal(harness.wordSystem.requestSlotActivation(
        ABILITY_SLOT_ID.SHIFT
    ).code, ABILITY_ACTIVATION_RESULT_CODE.COOLDOWN);
    harness.wordSystem.beginFixedTick(13);
    assert.equal(harness.wordSystem.requestSlotActivation(
        ABILITY_SLOT_ID.SHIFT
    ).code, ABILITY_ACTIVATION_RESULT_CODE.REQUESTED);
    destroyAbilityHarness(harness);
});

test('snapshot capacity와 runtime-unavailable Merge terminal은 cooldown을 소비하지 않는다', () => {
    const capacity = createAbilityHarness();
    capacity.wordSystem.beginFixedTick(15);
    capacity.wordSystem.requestSlotActivation(ABILITY_SLOT_ID.SHIFT);
    capacity.abilityRuntime.stageForFixedTick({ targetFixedTick: 15 });
    capacity.endpoint.complete(
        capacity.endpoint.requests[0],
        257,
        ABILITY_SUBJECT_SNAPSHOT_STATUS.CAPACITY_REJECTED
    );
    capacity.abilityRuntime.observeCompletedSubjectSnapshots(16);
    assert.equal(
        capacity.wordSystem.getStatusView().lastExecutionOutcome.code,
        ABILITY_EXECUTION_OUTCOME_CODE.SUBJECT_CAPACITY_REJECTED
    );
    assert.equal(
        capacity.wordSystem.getStatusView().lastExecutionOutcome
            .cooldownConsumed,
        false
    );
    destroyAbilityHarness(capacity);

    const unavailableEndpoint = new FakeAbilityEndpoint();
    unavailableEndpoint.nextReceipt = Object.freeze({
        accepted: false,
        runtimeUnavailable: true,
        reason: 'ability-runtime-unavailable',
        requiresRecovery: false
    });
    const unavailable = createAbilityHarness(unavailableEndpoint);
    unavailable.wordSystem.beginFixedTick(17);
    unavailable.wordSystem.requestSlotActivation(ABILITY_SLOT_ID.SHIFT);
    unavailable.abilityRuntime.stageForFixedTick({ targetFixedTick: 17 });
    assert.equal(
        unavailable.wordSystem.getStatusView().lastExecutionOutcome.code,
        ABILITY_EXECUTION_OUTCOME_CODE.RUNTIME_UNAVAILABLE
    );
    assert.equal(
        unavailable.wordSystem.getStatusView().lastExecutionOutcome
            .cooldownConsumed,
        false
    );
    assert.equal(unavailable.abilityRuntime.requiresRecovery(), false);
    destroyAbilityHarness(unavailable);
});

test('source-changed와 recovery replacement cancel은 terminal이지만 cooldown은 0이고 old domain을 격리한다', () => {
    const sourceChanged = createAbilityHarness();
    requestMergeSnapshot(sourceChanged, 20, 4);
    const [changedReady] = sourceChanged.abilityRuntime
        .drainReadyTowerMergeSnapshots([]);
    assert.equal(sourceChanged.abilityRuntime.markTowerMergePending(
        changedReady,
        21
    ), true);
    assert.equal(sourceChanged.abilityRuntime.rejectSnapshotExecution(
        changedReady,
        ABILITY_EXECUTION_OUTCOME_CODE.SOURCE_CHANGED,
        {
            snapshotAlreadyReleased: true,
            completedFixedTick: 22
        }
    ), true);
    assert.equal(
        sourceChanged.wordSystem.getStatusView().lastExecutionOutcome.code,
        ABILITY_EXECUTION_OUTCOME_CODE.SOURCE_CHANGED
    );
    assert.equal(
        sourceChanged.wordSystem.getStatusView().lastExecutionOutcome
            .cooldownConsumed,
        false
    );
    destroyAbilityHarness(sourceChanged);

    const oldEndpoint = new FakeAbilityEndpoint(41);
    const recovery = createAbilityHarness(oldEndpoint);
    requestMergeSnapshot(recovery, 30, 2);
    const [pending] = recovery.abilityRuntime
        .drainReadyTowerMergeSnapshots([]);
    assert.equal(recovery.abilityRuntime.markTowerMergePending(
        pending,
        31
    ), true);
    const replacement = new FakeAbilityEndpoint(42);
    assert.equal(recovery.abilityRuntime.resetGpuBinding(replacement), true);
    const status = recovery.abilityRuntime.getStatus();
    assert.equal(status.activeExecutions.length, 0);
    assert.equal(status.lastExecutionState.state,
        ABILITY_EXECUTION_STATE.CANCELLED);
    assert.equal(status.history.at(-1).code,
        ABILITY_EXECUTION_OUTCOME_CODE.CANCELLED);
    assert.equal(
        recovery.wordSystem.getStatusView().lastExecutionOutcome
            .cooldownConsumed,
        false
    );
    assert.equal(
        recovery.wordSystem.getSlotView(ABILITY_SLOT_ID.SHIFT)
            .cooldown.nextEligibleFixedTick,
        0
    );
    assert.equal(replacement.completions.length, 0);
    destroyAbilityHarness(recovery);
});
