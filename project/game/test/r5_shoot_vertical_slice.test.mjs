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
    TOWER_CREATION_COORDINATOR_MODE,
    TOWER_CREATION_RESULT
} = await loadGameModule('ingame/object/tower/tower_group_contract.js');
const {
    R5_SHOWCASE_SENTENCE_LOADOUT
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

class FakeR5Endpoint {
    constructor() {
        this.abilityRequests = [];
        this.abilityCompletions = [];
        this.snapshotTokens = new Set();
        this.releasedSnapshotCount = 0;
    }

    requestAbilityExecutionCommand(command) {
        this.abilityRequests.push(command);
        return Object.freeze({ accepted: true });
    }

    drainCompletedAbilitySubjectSnapshots(out) {
        out.push(...this.abilityCompletions);
        this.abilityCompletions.length = 0;
        return out;
    }

    completeSubjects(command, subjectCount) {
        const snapshotToken = subjectCount > 0 ? Object.freeze({}) : null;
        if (snapshotToken) this.snapshotTokens.add(snapshotToken);
        this.abilityCompletions.push(Object.freeze({
            executionId: command.executionId,
            executionOrdinal: command.executionOrdinal,
            commandFingerprint: command.fingerprint,
            targetFixedTick: command.targetFixedTick,
            sourceTick: command.targetFixedTick,
            status: subjectCount === 0
                ? ABILITY_SUBJECT_SNAPSHOT_STATUS.ZERO_SUBJECT
                : ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE,
            subjectCount,
            capacityDemand: subjectCount,
            snapshotFingerprint: subjectCount > 0
                ? 0x5000 + command.executionOrdinal
                : 0,
            snapshotToken,
            requiresRecovery: false
        }));
        return snapshotToken;
    }

    getAbilitySubjectSnapshotGpuBinding(token) {
        return this.snapshotTokens.has(token)
            ? Object.freeze({ token })
            : null;
    }

    releaseAbilitySubjectSnapshot(token) {
        const released = this.snapshotTokens.delete(token);
        if (released) this.releasedSnapshotCount++;
        return released;
    }

    getAbilitySubjectSnapshotStatus() {
        return Object.freeze({ requiresRecovery: false });
    }

    requestActorPayloadMaterialization() {
        throw new Error('Tower payload가 R3 Enemy materializer로 진입했습니다.');
    }

    drainCompletedActorPayloadMaterializations(out) {
        return out;
    }

    cancelPendingActorPayloadMaterializations() {
        return Object.freeze({ cancelledExecutionCount: 0 });
    }

    getActorPayloadMaterializationStatus() {
        return Object.freeze({ requiresRecovery: false });
    }

    getStatus() {
        return Object.freeze({ sessionGeneration: 5 });
    }

    getBackend() {
        return Object.freeze({
            cancelPendingAbilityExecutions: () => Object.freeze({
                cancelledExecutionCount: 0
            })
        });
    }
}

class FakeTowerCreationCoordinator {
    constructor(endpoint) {
        this.endpoint = endpoint;
        this.requests = [];
        this.requestFingerprintByTransaction = new Map();
    }

    getStatus() {
        return Object.freeze({ state: 'idle', recoveryRequired: false });
    }

    requestTowerCreation(request) {
        this.requests.push(request);
        const requestFingerprint = `tower-request:${this.requests.length}`;
        this.requestFingerprintByTransaction.set(
            request.transactionId,
            requestFingerprint
        );
        return Object.freeze({
            accepted: true,
            transactionId: request.transactionId,
            requestFingerprint,
            actorActionProfileFingerprint:
                request.command.actorActionProfileFingerprint,
            recoveryRequired: false
        });
    }

    complete(request, options = {}) {
        this.endpoint.releaseAbilitySubjectSnapshot(request.snapshotToken);
        const result = options.result ?? TOWER_CREATION_RESULT.COMMITTED;
        const committed = result === TOWER_CREATION_RESULT.COMMITTED;
        const createdCount = options.createdCount
            ?? (committed ? request.childCount : 0);
        const handles = options.handles ?? (committed
            ? Array.from({ length: createdCount }, (_, index) => (
                Object.freeze({ entityId: 100 + index, incarnation: 1 })
            ))
            : []);
        return Object.freeze({
            pending: false,
            committed,
            result,
            reason: options.reason ?? null,
            transactionId: request.transactionId,
            requestFingerprint: options.requestFingerprint
                ?? this.requestFingerprintByTransaction.get(
                    request.transactionId
                ),
            actorActionProfileFingerprint:
                options.actorActionProfileFingerprint
                    ?? request.command.actorActionProfileFingerprint,
            sourceTick: request.requestedFixedTick,
            createdCount,
            handles: Object.freeze(handles),
            recoveryRequired: options.recoveryRequired === true
        });
    }
}

function createHarness(options = {}) {
    const endpoint = new FakeR5Endpoint();
    const coordinator = new FakeTowerCreationCoordinator(endpoint);
    const wordSystem = new WordSystem({
        loadout: R5_SHOWCASE_SENTENCE_LOADOUT
    });
    wordSystem.bindRuntimePreviewProvider(Object.freeze({
        estimate: () => Object.freeze({
            executionEnabled: options.ingressAvailable !== false,
            executionDisabledReason: options.ingressAvailable === false
                ? 'RUNTIME_UNAVAILABLE'
                : null
        })
    }));
    const abilityRuntime = new AbilityRuntime({ wordSystem, endpoint });
    const materializer = new ActorPayloadMaterializer({
        abilityRuntime,
        endpoint,
        towerCreationCoordinatorProvider: () => coordinator,
        towerPayloadContextProvider: () => Object.freeze({
            runtimeAvailable: options.materializationAvailable !== false,
            sdf: Object.freeze({
                enabled: false,
                cols: 1,
                rows: 1,
                worldWidth: 32,
                worldHeight: 24
            }),
            recoveryPlacementPolicy: Object.freeze({
                policyId: 'tower-recovery.map-anchor-lattice.v1',
                mapRecoveryAnchorId: 'map:test:tower-spawn',
                mapLatticeVersion: 1,
                anchorPosition: Object.freeze({ x: 8, y: 12 })
            })
        })
    });
    return { endpoint, coordinator, wordSystem, abilityRuntime, materializer };
}

function destroyHarness(harness) {
    harness.materializer.destroy();
    harness.abilityRuntime.destroy();
    harness.wordSystem.destroy();
}

function stageShoot(harness, slotId, fixedTick, subjectCount) {
    harness.wordSystem.beginFixedTick(fixedTick);
    const activation = harness.wordSystem.requestSlotActivation(slotId, {
        targetFixedTick: fixedTick,
        aimViewport: Object.freeze({ x: 12, y: 7 })
    });
    assert.equal(activation.code, ABILITY_ACTIVATION_RESULT_CODE.REQUESTED);
    assert.equal(harness.abilityRuntime.stageForFixedTick({
        targetFixedTick: fixedTick
    }).acceptedCount, 1);
    const command = harness.endpoint.abilityRequests.at(-1);
    harness.endpoint.completeSubjects(command, subjectCount);
    assert.equal(harness.abilityRuntime.observeCompletedSubjectSnapshots(
        fixedTick + 1
    ).readyCount, subjectCount > 0 ? 1 : 0);
    const staged = harness.materializer.stageReadyForFixedTick({
        targetFixedTick: fixedTick + 1
    });
    return Object.freeze({ activation, command, staged });
}

test('production R5 ingress unavailable은 execution ordinal/snapshot/cooldown을 소비하지 않는다', () => {
    const harness = createHarness({ ingressAvailable: false });
    harness.wordSystem.beginFixedTick(1);
    for (const slotId of [ABILITY_SLOT_ID.SHIFT, ABILITY_SLOT_ID.SPACE]) {
        const result = harness.wordSystem.requestSlotActivation(slotId, {
            targetFixedTick: 1
        });
        assert.equal(result.code,
            ABILITY_ACTIVATION_RESULT_CODE.RUNTIME_UNAVAILABLE);
        assert.equal(result.accepted, false);
        assert.equal(harness.wordSystem.getSlotView(slotId)
            .cooldown.remainingTicks, 0);
    }
    assert.equal(harness.abilityRuntime.stageForFixedTick({ targetFixedTick: 1 })
        .acceptedCount, 0);
    assert.equal(harness.endpoint.abilityRequests.length, 0);
    assert.equal(harness.abilityRuntime.getStatus().executionStateHistory.length,
        0);
    destroyHarness(harness);
});

test('Tower Shoot는 1→2, 다음 execution 2→4를 frozen count로 만들고 COMMITTED에서만 cooldown을 소비한다', () => {
    const harness = createHarness();
    let totalTowerCount = 1;
    const first = stageShoot(harness, ABILITY_SLOT_ID.SHIFT, 1, 1);
    assert.equal(first.staged.stagedCount, 1);
    const firstRequest = harness.coordinator.requests[0];
    assert.equal(firstRequest.mode,
        TOWER_CREATION_COORDINATOR_MODE.GPU_SUBJECT_ACTOR_ACTION);
    assert.equal(firstRequest.childCount, 1);
    assert.equal(firstRequest.actorActionProfileId,
        first.command.compiledAbility.actorActionProfileId);
    assert.equal(firstRequest.command.actorActionProfileFingerprint,
        first.command.compiledAbility.actorActionProfileFingerprint);
    const firstCompletion = harness.coordinator.complete(firstRequest);
    const firstObserved = harness.materializer
        .observeTowerCreationCompletion(firstCompletion, 2);
    totalTowerCount += firstObserved.committedHandles.length;
    assert.equal(totalTowerCount, 2);
    assert.equal(harness.wordSystem.getStatusView().lastExecutionOutcome
        .cooldownConsumed, true);

    const second = stageShoot(harness, ABILITY_SLOT_ID.SHIFT, 3, 2);
    const secondRequest = harness.coordinator.requests[1];
    assert.equal(secondRequest.childCount, 2);
    assert.equal(secondRequest.command.executionOrdinal,
        firstRequest.command.executionOrdinal + 1);
    assert.equal(secondRequest.childCount, totalTowerCount);
    const secondObserved = harness.materializer.observeTowerCreationCompletion(
        harness.coordinator.complete(secondRequest),
        4
    );
    totalTowerCount += secondObserved.committedHandles.length;
    assert.equal(totalTowerCount, 4);
    assert.equal(secondObserved.committedCount, 1);
    assert.equal(harness.endpoint.snapshotTokens.size, 0);
    assert.equal(harness.materializer.getStatus().totalTowerCommitted, 2);
    assert.deepEqual(
        harness.abilityRuntime.getStatus().executionStateHistory
            .filter(({ state }) => state === ABILITY_EXECUTION_STATE.COMMITTED)
            .map(({ executionOrdinal }) => executionOrdinal),
        [1, 2]
    );
    destroyHarness(harness);
});

test('Enemies Shoot Tower는 frozen Enemy 10명을 Tower child 10명으로 전달한다', () => {
    const harness = createHarness();
    const staged = stageShoot(harness, ABILITY_SLOT_ID.SPACE, 5, 10);
    assert.equal(staged.staged.stagedCount, 1);
    const request = harness.coordinator.requests[0];
    assert.equal(request.childCount, 10);
    const observed = harness.materializer.observeTowerCreationCompletion(
        harness.coordinator.complete(request),
        6
    );
    assert.equal(observed.committedHandles.length, 10);
    assert.equal(1 + observed.committedHandles.length, 11);
    assert.equal(harness.wordSystem.getStatusView().lastExecutionOutcome
        .generatedCount, 10);
    destroyHarness(harness);
});

test('Tower creation capacity/placement/runtime race 거절은 cooldown을 소비하지 않는다', () => {
    for (const fixture of [
        Object.freeze({
            result: TOWER_CREATION_RESULT.REJECTED_CAPACITY,
            reason: 'PRODUCTION_TOWER_CAPACITY',
            expected: ABILITY_EXECUTION_OUTCOME_CODE
                .DESTINATION_CAPACITY_REJECTED
        }),
        Object.freeze({
            result: TOWER_CREATION_RESULT.REJECTED_CAPACITY,
            reason: 'ACTOR_ACTION_PLACEMENT_REJECTED',
            expected: ABILITY_EXECUTION_OUTCOME_CODE.PLACEMENT_REJECTED
        })
    ]) {
        const harness = createHarness();
        stageShoot(harness, ABILITY_SLOT_ID.SPACE, 10, 256);
        const request = harness.coordinator.requests[0];
        const completion = harness.coordinator.complete(request, fixture);
        const observed = harness.materializer.observeTowerCreationCompletion(
            completion,
            11
        );
        assert.equal(observed.committedCount, 0);
        assert.equal(harness.wordSystem.getStatusView().lastExecutionOutcome.code,
            fixture.expected);
        assert.equal(harness.wordSystem.getStatusView().lastExecutionOutcome
            .cooldownConsumed, false);
        assert.equal(harness.wordSystem.getSlotView(ABILITY_SLOT_ID.SPACE)
            .cooldown.nextEligibleFixedTick, 0);
        assert.equal(harness.materializer.requiresRecovery(), false);
        destroyHarness(harness);
    }

    const race = createHarness({ materializationAvailable: false });
    const staged = stageShoot(race, ABILITY_SLOT_ID.SHIFT, 20, 1);
    assert.equal(staged.staged.stagedCount, 0);
    assert.equal(staged.staged.rejectedCount, 1);
    assert.equal(race.coordinator.requests.length, 0);
    assert.equal(race.wordSystem.getStatusView().lastExecutionOutcome.code,
        ABILITY_EXECUTION_OUTCOME_CODE.RUNTIME_UNAVAILABLE);
    assert.equal(race.wordSystem.getStatusView().lastExecutionOutcome
        .cooldownConsumed, false);
    assert.equal(race.materializer.requiresRecovery(), false);
    assert.equal(race.endpoint.snapshotTokens.size, 0);
    destroyHarness(race);
});

test('Enemy Subjects가 있어도 living Tower Share가 0이면 Tower Payload는 전량 거절하고 cooldown을 보존한다', () => {
    const harness = createHarness();
    const staged = stageShoot(harness, ABILITY_SLOT_ID.SPACE, 25, 4);
    assert.equal(staged.staged.stagedCount, 1);
    const request = harness.coordinator.requests[0];
    const completion = harness.coordinator.complete(request, {
        result: TOWER_CREATION_RESULT.REJECTED_ZERO_SHARE,
        reason: 'ZERO_LIVING_SHARE',
        createdCount: 0,
        handles: []
    });
    const observed = harness.materializer.observeTowerCreationCompletion(
        completion,
        26
    );
    const outcome = harness.wordSystem.getStatusView().lastExecutionOutcome;
    assert.equal(observed.committedCount, 0);
    assert.equal(outcome.subjectCount, 4);
    assert.equal(outcome.generatedCount, 0);
    assert.equal(outcome.code,
        ABILITY_EXECUTION_OUTCOME_CODE.DESTINATION_CAPACITY_REJECTED);
    assert.equal(outcome.cooldownConsumed, false);
    assert.equal(harness.wordSystem.getSlotView(ABILITY_SLOT_ID.SPACE)
        .cooldown.nextEligibleFixedTick, 0);
    assert.equal(harness.endpoint.snapshotTokens.size, 0);
    assert.equal(harness.materializer.requiresRecovery(), false);
    destroyHarness(harness);
});

test('Tower COMMITTED identity/count shape 위조는 cooldown 없이 protocol recovery를 건다', () => {
    const harness = createHarness();
    stageShoot(harness, ABILITY_SLOT_ID.SHIFT, 30, 1);
    const request = harness.coordinator.requests[0];
    const malformed = harness.coordinator.complete(request, {
        createdCount: 0,
        handles: []
    });
    const observed = harness.materializer.observeTowerCreationCompletion(
        malformed,
        31
    );
    assert.equal(observed.committedCount, 0);
    assert.equal(observed.recoveryRequired, true);
    assert.equal(harness.wordSystem.getStatusView().lastExecutionOutcome.code,
        ABILITY_EXECUTION_OUTCOME_CODE.PROTOCOL_REJECTED);
    assert.equal(harness.wordSystem.getStatusView().lastExecutionOutcome
        .cooldownConsumed, false);
    assert.equal(harness.abilityRuntime.getStatus().lastExecutionState.state,
        ABILITY_EXECUTION_STATE.FAILED_PROTOCOL);
    destroyHarness(harness);
});

test('Tower completion profile fingerprint 변조는 publication 성공처럼 보여도 protocol recovery다', () => {
    const harness = createHarness();
    stageShoot(harness, ABILITY_SLOT_ID.SHIFT, 40, 1);
    const request = harness.coordinator.requests[0];
    const completion = harness.coordinator.complete(request, {
        actorActionProfileFingerprint:
            (request.command.actorActionProfileFingerprint + 1) >>> 0
    });
    const observed = harness.materializer.observeTowerCreationCompletion(
        completion,
        41
    );
    const outcome = harness.wordSystem.getStatusView().lastExecutionOutcome;
    assert.equal(observed.committedCount, 0);
    assert.equal(observed.recoveryRequired, true);
    assert.equal(outcome.code,
        ABILITY_EXECUTION_OUTCOME_CODE.PROTOCOL_REJECTED);
    assert.equal(outcome.cooldownConsumed, false);
    assert.equal(harness.materializer.getStatus().totalTowerCommitted, 0);
    assert.equal(harness.abilityRuntime.getStatus().lastExecutionState.state,
        ABILITY_EXECUTION_STATE.FAILED_PROTOCOL);
    destroyHarness(harness);
});
