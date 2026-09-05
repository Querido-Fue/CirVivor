import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    R6_TOWERS_MERGE_SENTENCE
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    SentenceCompiler
} = await loadGameModule('ingame/word/sentence_compiler.js');
const {
    normalizeTowerGroupOperationProfile
} = await loadGameModule(
    'ingame/contract/tower_group_operation_contract.js'
);
const {
    PRIMARY_TOWER_LOGICAL_ID,
    TOWER_COMBAT_FACT_TYPE,
    TOWER_CREATION_REASON,
    TOWER_CREATION_RESULT,
    TOWER_GROUP_RECORD_STATE,
    TOWER_MERGE_REASON,
    TOWER_MERGE_RESULT,
    TOWER_SHARE_SCALE,
    TowerGroupState
} = await loadGameModule('ingame/object/tower/tower_group_state.js');
const {
    TowerShareLedger
} = await loadGameModule('ingame/object/tower/tower_share_ledger.js');

const MERGE_OPERATION = new SentenceCompiler().compile(
    R6_TOWERS_MERGE_SENTENCE
);
const PROTOCOL = Object.freeze({
    sessionGeneration: 17,
    deviceGeneration: 5,
    authoritativeEpoch: 23
});

function assertDeepFrozen(value, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
        assertDeepFrozen(child, visited);
    }
}

function mergeRequest(transactionId, requestedFixedTick, extra = {}) {
    return {
        transactionId,
        compiledOperation: MERGE_OPERATION,
        requestedFixedTick,
        ...extra
    };
}

function splitToCount(state, count, transactionId) {
    assert.equal(Number.isSafeInteger(count) && count >= 1, true);
    if (count === 1) return null;
    const plan = state.planCreation({
        transactionId,
        childCount: count - 1
    });
    assert.equal(plan.accepted, true, plan.reason);
    const receipt = state.commitCreation(plan);
    assert.equal(receipt.result, TOWER_CREATION_RESULT.COMMITTED);
    return receipt;
}

function bindMissingLiving(state, entityBase = 10_000) {
    for (const record of state.getTowerRecords()) {
        if (record.state !== TOWER_GROUP_RECORD_STATE.LIVING
            || record.exactGpuBinding) {
            continue;
        }
        state.bindGpuBody(record.logicalTowerId, {
            entityId: entityBase + record.logicalTowerOrdinal,
            incarnation: 1
        }, PROTOCOL);
    }
}

function createBoundState(count, prefix, entityBase = 10_000) {
    const state = new TowerGroupState();
    splitToCount(state, count, `${prefix}-split`);
    bindMissingLiving(state, entityBase);
    return state;
}

function damageEvent(record, sourceTick, damageFixedPoint, key) {
    return {
        type: 'contact',
        eventType: 'damage-applied',
        disposition: 'applied',
        entityId: 900_000 + sourceTick,
        incarnation: 1,
        other: {
            entityId: record.exactGpuBinding.entityId,
            incarnation: record.exactGpuBinding.incarnation
        },
        ...PROTOCOL,
        sourceTick,
        sequence: 0,
        key,
        damageFixedPoint,
        reason: null
    };
}

function deathEvent(record, sourceTick, key) {
    return {
        type: 'death',
        eventType: 'death',
        disposition: 'despawn-requested',
        entityId: record.exactGpuBinding.entityId,
        incarnation: record.exactGpuBinding.incarnation,
        ...PROTOCOL,
        sourceTick,
        sequence: 0,
        key,
        reason: 'health-depleted',
        reasonFlags: 0
    };
}

function publicSnapshot(state) {
    const status = state.getStatus();
    return {
        records: state.getTowerRecords(),
        livingShareUnits: status.livingShareUnits,
        lostShareUnits: status.lostShareUnits,
        livingTowerCount: status.livingTowerCount,
        primaryLogicalTowerId: status.primaryLogicalTowerId,
        groupRevision: status.groupRevision,
        stateRevision: status.stateRevision,
        pendingCreation: status.pendingCreation,
        pendingMerge: status.pendingMerge
    };
}

test('TowerShareLedger Merge는 identity/overflow/Share invariant를 fail-closed 검증한다', () => {
    const ledger = new TowerShareLedger({
        runBaseMaxHpFixedPoint: 3000,
        runBasePowerFixedPoint: 1000
    });
    const records = [
        {
            logicalTowerId: 'tower-a',
            logicalTowerOrdinal: 1,
            shareUnits: 400_000_000,
            currentHpFixedPoint: 900,
            maxHpFixedPoint: 1200,
            powerFixedPoint: 400,
            state: TOWER_GROUP_RECORD_STATE.LIVING,
            exactGpuBinding: { entityId: 1, incarnation: 1, ...PROTOCOL }
        },
        {
            logicalTowerId: 'tower-b',
            logicalTowerOrdinal: 2,
            shareUnits: 600_000_000,
            currentHpFixedPoint: 1500,
            maxHpFixedPoint: 1800,
            powerFixedPoint: 600,
            state: TOWER_GROUP_RECORD_STATE.LIVING,
            exactGpuBinding: { entityId: 2, incarnation: 1, ...PROTOCOL }
        }
    ];
    const plan = ledger.planMerge([...records].reverse(), 'tower-a');
    assert.deepEqual(plan.sources.map((record) => record.logicalTowerId), [
        'tower-a',
        'tower-b'
    ]);
    assert.equal(plan.livingShareUnits, TOWER_SHARE_SCALE);
    assert.equal(plan.currentHpFixedPoint, 2400);
    assert.equal(plan.maxHpFixedPoint, 3000);
    assert.equal(plan.powerFixedPoint, 1000);
    assertDeepFrozen(plan);

    assert.throws(() => ledger.planMerge([
        records[0],
        { ...records[1], logicalTowerId: 'tower-a' }
    ], 'tower-a'), /고유/);
    assert.throws(() => ledger.planMerge([
        records[0],
        { ...records[1], state: TOWER_GROUP_RECORD_STATE.DEAD }
    ], 'tower-a'), /LIVING/);
    assert.throws(() => ledger.planMerge([
        { ...records[0], shareUnits: 399_999_999 },
        records[1]
    ], 'tower-a'), /Share invariant/);
    assert.throws(() => ledger.planMerge([
        { ...records[0], powerFixedPoint: Number.MAX_SAFE_INTEGER },
        { ...records[1], powerFixedPoint: Number.MAX_SAFE_INTEGER }
    ], 'tower-a'), /안전한 정수 범위/);
});

test('2→1, 4→1, 256→1은 primary identity와 exact 합을 보존하고 MERGED lineage만 만든다', () => {
    for (const count of [2, 4, 256]) {
        const state = createBoundState(
            count,
            `exact-${count}`,
            20_000 + (count * 1000)
        );
        const before = state.getTowerRecords().filter((record) => (
            record.state === TOWER_GROUP_RECORD_STATE.LIVING
        ));
        const expected = {
            shareUnits: before.reduce((sum, record) => (
                sum + record.shareUnits
            ), 0),
            currentHpFixedPoint: before.reduce((sum, record) => (
                sum + record.currentHpFixedPoint
            ), 0),
            maxHpFixedPoint: before.reduce((sum, record) => (
                sum + record.maxHpFixedPoint
            ), 0),
            powerFixedPoint: before.reduce((sum, record) => (
                sum + record.powerFixedPoint
            ), 0)
        };
        const primaryBefore = state.getPrimaryTowerRecord();
        const plan = state.planMerge(mergeRequest(
            `exact-${count}-merge`,
            100 + count
        ));
        assert.equal(plan.accepted, true);
        assert.equal(plan.sourceCount, count);
        assert.equal(plan.survivor.logicalTowerId, PRIMARY_TOWER_LOGICAL_ID);
        assert.strictEqual(
            plan.survivor.exactGpuBinding,
            primaryBefore.exactGpuBinding
        );
        assert.equal(plan.survivor.shareUnits, expected.shareUnits);
        assert.equal(
            plan.survivor.currentHpFixedPoint,
            expected.currentHpFixedPoint
        );
        assert.equal(plan.survivor.maxHpFixedPoint, expected.maxHpFixedPoint);
        assert.equal(plan.survivor.powerFixedPoint, expected.powerFixedPoint);
        assert.equal(typeof plan.fingerprint, 'string');
        assert.equal(plan.fingerprint.length, 16);
        assert.equal(plan.operationIdentity.compiledAbilityId,
            MERGE_OPERATION.compiledAbilityId);
        assert.deepEqual(plan.sources.map((record) => (
            record.logicalTowerOrdinal
        )), Array.from({ length: count }, (_, index) => index + 1));
        assertDeepFrozen(plan);

        const receipt = state.commitMerge(plan);
        assert.equal(receipt.result, TOWER_MERGE_RESULT.COMMITTED);
        assert.equal(receipt.sourceCount, count);
        assert.equal(receipt.consumedCount, count - 1);
        assert.equal(receipt.fact.type, TOWER_COMBAT_FACT_TYPE.MERGED);
        assert.deepEqual(state.getLastCommittedFacts(), [receipt.fact]);
        assert.equal(receipt.fact.lineage.length, count - 1);
        assert.equal(state.getStatus().livingTowerCount, 1);
        assert.equal(state.getStatus().lostShareUnits, 0);
        assert.equal(state.getPrimaryTowerRecord().shareUnits,
            TOWER_SHARE_SCALE);
        assert.strictEqual(
            state.getPrimaryTowerRecord().exactGpuBinding,
            primaryBefore.exactGpuBinding
        );
        const consumed = state.getTowerRecords().filter((record) => (
            record.state === TOWER_GROUP_RECORD_STATE.MERGED
        ));
        assert.equal(consumed.length, count - 1);
        assert.equal(consumed.every((record) => (
            record.mergedIntoLogicalTowerId === PRIMARY_TOWER_LOGICAL_ID
            && record.mergedTransactionId === plan.transactionId
            && record.mergedPlanFingerprint === plan.fingerprint
            && record.shareUnits === 0
            && record.exactGpuBinding === null
        )), true);
        assert.equal(state.auditInvariants().valid, true);
        assertDeepFrozen(receipt);
    }
});

test('서로 다른 damage는 final-boundary refresh에서 current HP 합만 갱신한다', () => {
    const state = createBoundState(4, 'damage-refresh', 40_000);
    let sourceTick = 1;
    for (const [record, damage] of state.getTowerRecords().entries()) {
        state.commitCompletedEvents({
            events: [damageEvent(
                damage,
                sourceTick,
                (record + 1) * 100,
                `heterogeneous-damage-${sourceTick}`
            )]
        });
        sourceTick++;
    }
    const plan = state.planMerge(mergeRequest('damage-refresh-merge', 50));
    assert.equal(plan.currentHpFixedPoint, 2000);
    const structureFingerprint = plan.sourceStructureFingerprint;
    const fingerprint = plan.fingerprint;

    const second = state.getTowerRecords().filter((record) => (
        record.state === TOWER_GROUP_RECORD_STATE.LIVING
    ))[1];
    state.commitCompletedEvents({
        events: [damageEvent(
            second,
            sourceTick,
            50,
            'pending-non-lethal-damage'
        )]
    });
    const refreshed = state.refreshPendingMerge({ plan });
    assert.equal(refreshed.accepted, true);
    assert.notStrictEqual(refreshed, plan);
    assert.equal(refreshed.currentHpFixedPoint, 1950);
    assert.equal(refreshed.maxHpFixedPoint, 3000);
    assert.equal(refreshed.powerFixedPoint, 1000);
    assert.equal(refreshed.livingShareUnits, TOWER_SHARE_SCALE);
    assert.equal(refreshed.sourceStructureFingerprint, structureFingerprint);
    assert.notEqual(refreshed.fingerprint, fingerprint);
    const receipt = state.commitMerge(refreshed);
    assert.equal(receipt.result, TOWER_MERGE_RESULT.COMMITTED);
    assert.equal(state.getPrimaryTowerRecord().currentHpFixedPoint, 1950);
    assert.equal(state.auditInvariants().valid, true);
});

test('Tower death 뒤 living Merge는 Lost Share와 잃은 maxHP/Power를 복원하지 않는다', () => {
    const state = createBoundState(4, 'death-before-merge', 50_000);
    const victim = state.getTowerRecords()[3];
    const deathFacts = state.commitCompletedEvents({
        events: [deathEvent(victim, 1, 'pre-merge-death')]
    });
    assert.deepEqual(deathFacts.map((fact) => fact.type), [
        TOWER_COMBAT_FACT_TYPE.DIED,
        TOWER_COMBAT_FACT_TYPE.SHARE_LOST
    ]);
    const plan = state.planMerge(mergeRequest('after-death-merge', 10));
    assert.equal(plan.accepted, true);
    assert.equal(plan.sourceCount, 3);
    assert.equal(plan.livingShareUnits, 750_000_000);
    assert.equal(plan.lostShareUnits, 250_000_000);
    assert.equal(plan.currentHpFixedPoint, 2250);
    assert.equal(plan.maxHpFixedPoint, 2250);
    assert.equal(plan.powerFixedPoint, 750);

    const receipt = state.commitMerge(plan);
    assert.equal(receipt.result, TOWER_MERGE_RESULT.COMMITTED);
    assert.deepEqual(state.getLastCommittedFacts().map((fact) => fact.type), [
        TOWER_COMBAT_FACT_TYPE.MERGED
    ]);
    assert.equal(JSON.stringify(receipt).includes('Bounty'), false);
    assert.equal(JSON.stringify(receipt).includes('Reward'), false);
    assert.equal(JSON.stringify(receipt).includes('TowerDied'), false);
    assert.equal(state.getStatus().lostShareUnits, 250_000_000);
    assert.equal(state.getPrimaryTowerRecord().shareUnits, 750_000_000);
    assert.equal(state.getPrimaryTowerRecord().maxHpFixedPoint, 2250);
    assert.equal(state.getPrimaryTowerRecord().powerFixedPoint, 750);
    assert.equal(state.auditInvariants().valid, true);
});

test('0/1 living Merge는 immutable insufficient receipt이며 public mutation이 0이다', () => {
    const one = new TowerGroupState();
    const beforeOne = publicSnapshot(one);
    const request = mergeRequest('one-insufficient', 1);
    const preview = one.previewMerge(request);
    assert.equal(preview.result,
        TOWER_MERGE_RESULT.REJECTED_INSUFFICIENT_SUBJECTS);
    assert.equal(preview.reason, TOWER_MERGE_REASON.INSUFFICIENT_SUBJECTS);
    assert.equal(preview.sourceCount, 1);
    assert.equal(one.getStatus().pendingMerge, null);
    const receipt = one.planMerge(request);
    assert.equal(receipt.mutationCount, 0);
    assert.strictEqual(one.planMerge(request), receipt);
    assert.deepEqual(publicSnapshot(one), beforeOne);
    assertDeepFrozen(receipt);

    const zero = new TowerGroupState();
    bindMissingLiving(zero, 60_000);
    const [tower] = zero.getTowerRecords();
    zero.commitCompletedEvents({
        events: [deathEvent(tower, 1, 'zero-living-death')]
    });
    const beforeZero = publicSnapshot(zero);
    const zeroReceipt = zero.planMerge(mergeRequest('zero-insufficient', 2));
    assert.equal(zeroReceipt.result,
        TOWER_MERGE_RESULT.REJECTED_INSUFFICIENT_SUBJECTS);
    assert.equal(zeroReceipt.sourceCount, 0);
    assert.equal(zeroReceipt.mutationCount, 0);
    assert.deepEqual(publicSnapshot(zero), beforeZero);
    assert.equal(zero.auditInvariants().valid, true);
});

test('pending source death/binding/primary 변경은 refresh/commit에서 전량 SOURCE_CHANGED다', () => {
    const binding = createBoundState(2, 'binding-drift', 70_000);
    const bindingRequest = mergeRequest('binding-drift-merge', 10);
    const bindingPlan = binding.planMerge(bindingRequest);
    binding.releaseGpuBindings();
    const afterBindingChange = publicSnapshot(binding);
    const alteredSourceReplay = binding.planMerge(bindingRequest);
    assert.equal(alteredSourceReplay.result,
        TOWER_MERGE_RESULT.PROTOCOL_FAILURE);
    assert.equal(alteredSourceReplay.reason,
        TOWER_MERGE_REASON.TRANSACTION_FINGERPRINT_MISMATCH);
    const bindingReject = binding.refreshPendingMerge({ plan: bindingPlan });
    assert.equal(bindingReject.result,
        TOWER_MERGE_RESULT.REJECTED_SOURCE_CHANGED);
    assert.equal(bindingReject.reason, TOWER_MERGE_REASON.SOURCE_CHANGED);
    assert.deepEqual(publicSnapshot(binding), {
        ...afterBindingChange,
        pendingMerge: null
    });

    const membership = createBoundState(3, 'membership-drift', 71_000);
    const membershipPlan = membership.planMerge(
        mergeRequest('membership-drift-merge', 11)
    );
    const nonPrimary = membership.getTowerRecords()[2];
    membership.commitCompletedEvents({
        events: [deathEvent(nonPrimary, 1, 'pending-source-death')]
    });
    const lostAfterDeath = membership.getStatus().lostShareUnits;
    const membershipReject = membership.refreshPendingMerge({
        plan: membershipPlan
    });
    assert.equal(membershipReject.result,
        TOWER_MERGE_RESULT.REJECTED_SOURCE_CHANGED);
    assert.equal(membership.getStatus().lostShareUnits, lostAfterDeath);
    assert.equal(membership.getStatus().livingTowerCount, 2);
    assert.equal(membership.auditInvariants().valid, true);

    const primary = createBoundState(2, 'primary-drift', 72_000);
    const primaryPlan = primary.planMerge(
        mergeRequest('primary-drift-merge', 12)
    );
    const primaryRecord = primary.getPrimaryTowerRecord();
    primary.commitCompletedEvents({
        events: [deathEvent(primaryRecord, 1, 'pending-primary-death')]
    });
    const newPrimary = primary.getStatus().primaryLogicalTowerId;
    const primaryReject = primary.commitMerge(primaryPlan);
    assert.equal(primaryReject.result,
        TOWER_MERGE_RESULT.REJECTED_SOURCE_CHANGED);
    assert.notEqual(newPrimary, PRIMARY_TOWER_LOGICAL_ID);
    assert.equal(primary.getStatus().primaryLogicalTowerId, newPrimary);
    assert.equal(primary.getStatus().pendingMerge, null);
    assert.equal(primary.auditInvariants().valid, true);
});

test('creation↔merge mutual exclusion과 replay/conflict fingerprint가 exact하다', () => {
    const creationFirst = createBoundState(2, 'creation-first', 80_000);
    const creationPlan = creationFirst.planCreation({
        transactionId: 'creation-first-pending',
        childCount: 1
    });
    const conflictRequest = mergeRequest('merge-blocked-by-creation', 20);
    const mergeConflict = creationFirst.planMerge(conflictRequest);
    assert.equal(mergeConflict.result,
        TOWER_MERGE_RESULT.REJECTED_CONFLICTING_TRANSACTION);
    assert.equal(mergeConflict.reason,
        TOWER_MERGE_REASON.CREATION_TRANSACTION_PENDING);
    assert.strictEqual(creationFirst.planMerge(conflictRequest), mergeConflict);
    creationFirst.rejectCreation(creationPlan, 'test-cleanup');

    const mergeFirst = createBoundState(2, 'merge-first', 81_000);
    const request = mergeRequest('merge-first-pending', 21);
    const plan = mergeFirst.planMerge(request);
    assert.equal(plan.accepted, true);
    assert.strictEqual(mergeFirst.planMerge(request), plan);
    const blockedCreation = mergeFirst.planCreation({
        transactionId: 'creation-blocked-by-merge',
        childCount: 1
    });
    assert.equal(blockedCreation.result, TOWER_CREATION_RESULT.REJECTED_CAPACITY);
    assert.equal(blockedCreation.reason,
        TOWER_CREATION_REASON.MERGE_TRANSACTION_PENDING);
    assert.equal(mergeFirst.getStatus().pendingCreation, null);

    const tickConflict = mergeFirst.planMerge({
        ...request,
        requestedFixedTick: 22
    });
    assert.equal(tickConflict.result, TOWER_MERGE_RESULT.PROTOCOL_FAILURE);
    assert.equal(tickConflict.reason,
        TOWER_MERGE_REASON.TRANSACTION_FINGERPRINT_MISMATCH);
    const alteredProfile = normalizeTowerGroupOperationProfile({
        ...MERGE_OPERATION.groupOperationProfile,
        previewFormulaId: 'preview.tower-group-merge.r6.altered',
        towerGroupOperationProfileFingerprint: undefined
    });
    const operationConflict = mergeFirst.planMerge({
        ...request,
        compiledOperation: {
            ...MERGE_OPERATION,
            groupOperationProfile: alteredProfile,
            groupOperationProfileFingerprint:
                alteredProfile.towerGroupOperationProfileFingerprint
        }
    });
    assert.equal(operationConflict.result, TOWER_MERGE_RESULT.PROTOCOL_FAILURE);
    assert.equal(operationConflict.reason,
        TOWER_MERGE_REASON.TRANSACTION_FINGERPRINT_MISMATCH);
    mergeFirst.rejectMerge(plan, 'test-cleanup');

    const replay = createBoundState(2, 'commit-replay', 82_000);
    const replayRequest = mergeRequest('commit-replay-merge', 30);
    const replayPlan = replay.planMerge(replayRequest);
    const committed = replay.commitMerge(replayPlan);
    assert.strictEqual(replay.commitMerge(replayPlan), committed);
    assert.strictEqual(replay.planMerge({
        ...replayRequest,
        fingerprint: replayPlan.fingerprint
    }), committed);
    const alteredReplay = replay.planMerge({
        ...replayRequest,
        fingerprint: '0000000000000000'
    });
    assert.equal(alteredReplay.result, TOWER_MERGE_RESULT.PROTOCOL_FAILURE);
    assert.equal(alteredReplay.reason,
        TOWER_MERGE_REASON.TRANSACTION_FINGERPRINT_MISMATCH);
    assert.equal(replay.getStatus().livingTowerCount, 1);
    assert.equal(replay.getStatus().rememberedMergeTransactionCount, 1);
    assert.equal(replay.auditInvariants().valid, true);

    const bounded = new TowerGroupState({ mergeHistoryCapacity: 2 });
    for (let index = 0; index < 3; index++) {
        bounded.planMerge(mergeRequest(`bounded-merge-${index}`, index + 1));
    }
    assert.equal(bounded.getStatus().mergeHistoryCapacity, 2);
    assert.equal(bounded.getStatus().rememberedMergeTransactionCount, 2);
});

test('Merge→split과 randomized split→merge는 ordinal 단조 증가와 Share invariant를 보존한다', () => {
    const state = createBoundState(4, 'ordinal-seed', 90_000);
    const firstPlan = state.planMerge(mergeRequest('ordinal-first-merge', 1));
    state.commitMerge(firstPlan);
    const highestBeforeSplit = Math.max(...state.getTowerRecords().map(
        (record) => record.logicalTowerOrdinal
    ));
    splitToCount(state, 3, 'ordinal-after-merge-split');
    const firstNewOrdinals = state.getTowerRecords()
        .filter((record) => (
            record.state === TOWER_GROUP_RECORD_STATE.LIVING
            && record.logicalTowerId !== PRIMARY_TOWER_LOGICAL_ID
        ))
        .map((record) => record.logicalTowerOrdinal);
    assert.equal(firstNewOrdinals.every((ordinal) => (
        ordinal > highestBeforeSplit
    )), true);
    bindMissingLiving(state, 90_000);

    let random = 0x0823a11c;
    let lastOrdinal = Math.max(...state.getTowerRecords().map(
        (record) => record.logicalTowerOrdinal
    ));
    for (let step = 0; step < 128; step++) {
        const merge = state.planMerge(mergeRequest(
            `property-merge-${step}`,
            step + 2
        ));
        assert.equal(merge.accepted, true, `merge ${step}`);
        assert.equal(state.commitMerge(merge).result,
            TOWER_MERGE_RESULT.COMMITTED);
        random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
        const nextCount = 2 + (random % 7);
        splitToCount(state, nextCount, `property-split-${step}`);
        const newLiving = state.getTowerRecords().filter((record) => (
            record.state === TOWER_GROUP_RECORD_STATE.LIVING
        ));
        const newestOrdinal = Math.max(...newLiving.map(
            (record) => record.logicalTowerOrdinal
        ));
        assert.equal(newestOrdinal > lastOrdinal, true, `ordinal ${step}`);
        lastOrdinal = newestOrdinal;
        bindMissingLiving(state, 90_000);
        const audit = state.auditInvariants();
        assert.equal(audit.valid, true, audit.violations.join(','));
        assert.equal(
            audit.livingShareUnits + audit.lostShareUnits,
            TOWER_SHARE_SCALE
        );
        assert.equal(audit.lostShareUnits, 0);
    }
});
