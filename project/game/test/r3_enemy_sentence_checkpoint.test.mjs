import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ABILITY_SUBJECT_SNAPSHOT_STATUS
} = await loadGameModule('ingame/contract/ability_execution_contract.js');
const {
    ACTOR_PAYLOAD_MATERIALIZATION_STATUS
} = await loadGameModule('ingame/contract/actor_payload_contract.js');
const {
    ABILITY_SLOT_ID
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    R3_SHOWCASE_SENTENCE_LOADOUT
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
    ActorPayloadMaterializer
} = await loadGameModule('ingame/word/actor_payload_materializer.js');

class FakeSentenceGpuEndpoint {
    constructor(sessionGeneration = 1) {
        this.sessionGeneration = sessionGeneration;
        this.abilityRequests = [];
        this.abilityCompletions = [];
        this.payloadRequests = [];
        this.payloadCompletions = [];
        this.snapshotTokens = new Set();
        this.nextAbilityReceipt = null;
        this.cancelledAbilityCount = 0;
        this.cancelledPayloadCount = 0;
    }

    requestAbilityExecutionCommand(command) {
        this.abilityRequests.push(command);
        if (this.nextAbilityReceipt) {
            const receipt = this.nextAbilityReceipt;
            this.nextAbilityReceipt = null;
            return receipt;
        }
        return { accepted: true };
    }

    drainCompletedAbilitySubjectSnapshots(out) {
        out.push(...this.abilityCompletions);
        this.abilityCompletions.length = 0;
        return out;
    }

    completeSubjects(command, subjectCount, status = null) {
        const resolvedStatus = status ?? (subjectCount === 0
            ? ABILITY_SUBJECT_SNAPSHOT_STATUS.ZERO_SUBJECT
            : ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE);
        const snapshotToken = subjectCount > 0 ? Object.freeze({}) : null;
        if (snapshotToken) this.snapshotTokens.add(snapshotToken);
        this.abilityCompletions.push(Object.freeze({
            executionId: command.executionId,
            executionOrdinal: command.executionOrdinal,
            commandFingerprint: command.fingerprint,
            targetFixedTick: command.targetFixedTick,
            sourceTick: command.targetFixedTick,
            status: resolvedStatus,
            subjectCount,
            capacityDemand: subjectCount,
            snapshotFingerprint: 0x8000 + command.executionOrdinal,
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
        return {
            accepted: true,
            transactionId: request.transactionId,
            reservationCount: request.subjectCompletion.subjectCount
        };
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
            status: ACTOR_PAYLOAD_MATERIALIZATION_STATUS.COMPLETE,
            state: 'COMMITTED',
            committed: true,
            generatedCount: request.subjectCompletion.subjectCount,
            requiresRecovery: false
        }));
    }

    cancelPendingActorPayloadMaterializations() {
        this.cancelledPayloadCount += this.payloadRequests.length;
        return { cancelledExecutionCount: this.payloadRequests.length };
    }

    getActorPayloadMaterializationStatus() {
        return { requiresRecovery: false };
    }

    getStatus() {
        return { sessionGeneration: this.sessionGeneration };
    }

    getBackend() {
        return {
            cancelPendingAbilityExecutions: () => {
                this.cancelledAbilityCount++;
            }
        };
    }
}

function createHarness(endpoint = new FakeSentenceGpuEndpoint()) {
    const wordSystem = new WordSystem({
        loadout: R3_SHOWCASE_SENTENCE_LOADOUT
    });
    const abilityRuntime = new AbilityRuntime({ wordSystem, endpoint });
    const materializer = new ActorPayloadMaterializer({
        abilityRuntime,
        endpoint
    });
    return { wordSystem, abilityRuntime, materializer, endpoint };
}

function destroyHarness(harness) {
    harness.materializer.destroy();
    harness.abilityRuntime.destroy();
    harness.wordSystem.destroy();
}

test('Tower 1→Enemy 1은 5단계 GPU 상태 뒤 COMMITTED에서만 cooldown을 소비한다', () => {
    const harness = createHarness();
    const { wordSystem, abilityRuntime, materializer, endpoint } = harness;
    wordSystem.beginFixedTick(1);
    const activation = wordSystem.requestSlotActivation(ABILITY_SLOT_ID.Q);
    assert.equal(activation.code, ABILITY_ACTIVATION_RESULT_CODE.REQUESTED);
    assert.equal(abilityRuntime.stageForFixedTick({ targetFixedTick: 1 })
        .acceptedCount, 1);
    const command = endpoint.abilityRequests[0];
    endpoint.completeSubjects(command, 1);
    assert.equal(abilityRuntime.observeCompletedSubjectSnapshots(2).readyCount, 1);
    assert.equal(materializer.stageReadyForFixedTick({ targetFixedTick: 2 })
        .stagedCount, 1);
    endpoint.completePayload(endpoint.payloadRequests[0]);
    assert.equal(materializer.observeCompleted(3).committedCount, 1);

    assert.deepEqual(
        abilityRuntime.getStatus().executionStateHistory.map(({ state }) => state),
        [
            ABILITY_EXECUTION_STATE.REQUESTED,
            ABILITY_EXECUTION_STATE.SUBJECT_SNAPSHOT_PENDING,
            ABILITY_EXECUTION_STATE.DESTINATION_PRELEASE_PENDING,
            ABILITY_EXECUTION_STATE.GPU_MATERIALIZATION_PENDING,
            ABILITY_EXECUTION_STATE.COMMITTED
        ]
    );
    assert.equal(abilityRuntime.getStatus().activeExecutions.length, 0);
    assert.equal(wordSystem.getStatusView().lastExecutionOutcome.subjectCount, 1);
    assert.equal(wordSystem.getStatusView().lastExecutionOutcome.generatedCount, 1);
    assert.equal(wordSystem.getStatusView().lastExecutionOutcome.cooldownConsumed,
        true);
    wordSystem.beginFixedTick(2);
    assert.equal(
        wordSystem.requestSlotActivation(ABILITY_SLOT_ID.Q).code,
        ABILITY_ACTIVATION_RESULT_CODE.COOLDOWN
    );
    wordSystem.beginFixedTick(3);
    assert.equal(
        wordSystem.requestSlotActivation(ABILITY_SLOT_ID.Q).code,
        ABILITY_ACTIVATION_RESULT_CODE.REQUESTED
    );
    destroyHarness(harness);
});

test('Tower 0은 ZERO_SUBJECT로 끝나며 cooldown과 payload reservation을 소비하지 않는다', () => {
    const harness = createHarness();
    const { wordSystem, abilityRuntime, materializer, endpoint } = harness;
    wordSystem.beginFixedTick(7);
    wordSystem.requestSlotActivation(ABILITY_SLOT_ID.Q);
    abilityRuntime.stageForFixedTick({ targetFixedTick: 7 });
    endpoint.completeSubjects(endpoint.abilityRequests[0], 0);
    abilityRuntime.observeCompletedSubjectSnapshots(8);

    assert.equal(materializer.stageReadyForFixedTick({ targetFixedTick: 8 })
        .stagedCount, 0);
    assert.equal(endpoint.payloadRequests.length, 0);
    assert.equal(abilityRuntime.getStatus().lastExecutionState.state,
        ABILITY_EXECUTION_STATE.ZERO_SUBJECT);
    assert.equal(wordSystem.getStatusView().lastExecutionOutcome.code,
        ABILITY_EXECUTION_OUTCOME_CODE.ZERO_SUBJECT);
    assert.equal(wordSystem.getStatusView().lastExecutionOutcome.cooldownConsumed,
        false);
    assert.equal(wordSystem.getSlotView(ABILITY_SLOT_ID.Q)
        .cooldown.nextEligibleFixedTick, 0);
    destroyHarness(harness);
});

test('GPU ingress pressure 재시도는 ordinal/request를 보존하고 상태를 중복 생성하지 않는다', () => {
    const endpoint = new FakeSentenceGpuEndpoint();
    endpoint.nextAbilityReceipt = {
        accepted: false,
        retryable: true,
        reason: 'ability-command-capacity'
    };
    const harness = createHarness(endpoint);
    const { wordSystem, abilityRuntime } = harness;
    wordSystem.beginFixedTick(11);
    wordSystem.requestSlotActivation(ABILITY_SLOT_ID.E);
    const deferred = abilityRuntime.stageForFixedTick({ targetFixedTick: 11 });
    assert.equal(deferred.deferredCount, 1);
    assert.equal(abilityRuntime.getStatus().activeExecutions[0].state,
        ABILITY_EXECUTION_STATE.REQUESTED);
    const accepted = abilityRuntime.stageForFixedTick({ targetFixedTick: 11 });
    assert.equal(accepted.acceptedCount, 1);
    assert.equal(endpoint.abilityRequests.length, 2);
    assert.equal(endpoint.abilityRequests[0].executionId,
        endpoint.abilityRequests[1].executionId);
    assert.deepEqual(
        abilityRuntime.getStatus().executionStateHistory.map(({ state }) => state),
        [
            ABILITY_EXECUTION_STATE.REQUESTED,
            ABILITY_EXECUTION_STATE.SUBJECT_SNAPSHOT_PENDING
        ]
    );
    destroyHarness(harness);
});

test('GPU endpoint 교체는 소유 중 실행을 CANCELLED로 닫고 old completion을 격리한다', () => {
    const oldEndpoint = new FakeSentenceGpuEndpoint(3);
    const harness = createHarness(oldEndpoint);
    const { wordSystem, abilityRuntime, materializer } = harness;
    wordSystem.beginFixedTick(13);
    wordSystem.requestSlotActivation(ABILITY_SLOT_ID.E);
    abilityRuntime.stageForFixedTick({ targetFixedTick: 13 });
    const oldCommand = oldEndpoint.abilityRequests[0];
    const replacement = new FakeSentenceGpuEndpoint(4);
    materializer.resetGpuBinding(replacement);
    abilityRuntime.resetGpuBinding(replacement);
    oldEndpoint.completeSubjects(oldCommand, 10);
    abilityRuntime.observeCompletedSubjectSnapshots(14);

    const status = abilityRuntime.getStatus();
    assert.equal(status.inFlightCount, 0);
    assert.equal(status.readySnapshotCount, 0);
    assert.equal(status.lastExecutionState.state,
        ABILITY_EXECUTION_STATE.CANCELLED);
    assert.equal(status.history.at(-1).code,
        ABILITY_EXECUTION_OUTCOME_CODE.CANCELLED);
    assert.equal(replacement.abilityCompletions.length, 0);
    assert.equal(oldEndpoint.abilityCompletions.length, 1);
    assert.equal(status.recoveryRequired, false);
    destroyHarness(harness);
});
