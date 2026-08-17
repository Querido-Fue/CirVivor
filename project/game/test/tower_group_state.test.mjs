import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    PRIMARY_TOWER_LOGICAL_ID,
    TOWER_COMBAT_FACT_TYPE,
    TOWER_CREATION_REASON,
    TOWER_CREATION_RESULT,
    TOWER_GROUP_RECORD_STATE,
    TOWER_SHARE_SCALE,
    TowerGroupState
} = await loadGameModule('ingame/object/tower/tower_group_state.js');
const { TowerShareLedger } = await loadGameModule(
    'ingame/object/tower/tower_share_ledger.js'
);

const PROTOCOL = Object.freeze({
    sessionGeneration: 7,
    deviceGeneration: 3,
    authoritativeEpoch: 11
});

function deathEvent(handle, sourceTick, key) {
    return {
        type: 'death',
        eventType: 'death',
        disposition: 'despawn-requested',
        entityId: handle.entityId,
        incarnation: handle.incarnation,
        ...PROTOCOL,
        sourceTick,
        sequence: 0,
        key,
        reason: 'health-depleted',
        reasonFlags: 0
    };
}

function damageEvent(handle, sourceTick, damageFixedPoint, key) {
    return {
        type: 'contact',
        eventType: 'damage-applied',
        disposition: 'applied',
        entityId: 9000 + sourceTick,
        incarnation: 1,
        other: { ...handle },
        ...PROTOCOL,
        sourceTick,
        sequence: 0,
        key,
        damageFixedPoint,
        reason: null
    };
}

function valuesById(plan) {
    return Object.fromEntries(plan.allocations.map((entry) => [
        entry.logicalTowerId,
        {
            shareUnits: entry.shareUnits,
            currentHpFixedPoint: entry.currentHpFixedPoint,
            maxHpFixedPoint: entry.maxHpFixedPoint,
            powerFixedPoint: entry.powerFixedPoint,
            existing: entry.existing
        }
    ]));
}

test('초기 TowerGroup은 full Share, 30 HP, Power 10의 단일 logical Tower다', () => {
    const state = new TowerGroupState();
    const status = state.getStatus();
    const [tower] = state.getTowerRecords();

    assert.equal(status.fullShareUnits, TOWER_SHARE_SCALE);
    assert.equal(status.livingShareUnits, TOWER_SHARE_SCALE);
    assert.equal(status.lostShareUnits, 0);
    assert.equal(status.livingTowerCount, 1);
    assert.equal(status.primaryLogicalTowerId, PRIMARY_TOWER_LOGICAL_ID);
    assert.equal(tower.logicalTowerOrdinal, 1);
    assert.equal(tower.shareUnits, TOWER_SHARE_SCALE);
    assert.equal(tower.currentHpFixedPoint, 3000);
    assert.equal(tower.maxHpFixedPoint, 3000);
    assert.equal(tower.powerFixedPoint, 1000);
    assert.equal(tower.state, TOWER_GROUP_RECORD_STATE.LIVING);
    assert.equal(state.auditInvariants().valid, true);
});

test('초기 ledger allocation과 recovery descriptor clone은 accessor/hole을 허용하지 않는다', () => {
    const ledger = new TowerShareLedger({
        runBaseMaxHpFixedPoint: 3000,
        runBasePowerFixedPoint: 1000
    });
    assert.deepEqual(ledger.createInitialTower(), {
        logicalTowerId: PRIMARY_TOWER_LOGICAL_ID,
        logicalTowerOrdinal: 1,
        shareUnits: TOWER_SHARE_SCALE,
        currentHpFixedPoint: 3000,
        maxHpFixedPoint: 3000,
        powerFixedPoint: 1000
    });

    let getterReadCount = 0;
    const accessorDescriptor = {};
    Object.defineProperty(accessorDescriptor, 'position', {
        enumerable: true,
        get() {
            getterReadCount++;
            return { x: 1, y: 2 };
        }
    });
    const accessorState = new TowerGroupState();
    const accessorPlan = accessorState.planCreation({
        transactionId: 'reject-accessor-descriptor',
        childCount: 1,
        childRecoverySpawnDescriptors: [accessorDescriptor]
    });
    assert.equal(accessorPlan.result, TOWER_CREATION_RESULT.REJECTED_DESCRIPTOR);
    assert.equal(getterReadCount, 0);
    assert.equal(accessorState.getStatus().pendingCreation, null);

    const sparse = new Array(2);
    sparse[1] = 'spawn';
    const sparseState = new TowerGroupState();
    const sparsePlan = sparseState.planCreation({
        transactionId: 'reject-sparse-descriptor',
        childCount: 1,
        childRecoverySpawnDescriptors: [{ path: sparse }]
    });
    assert.equal(sparsePlan.result, TOWER_CREATION_RESULT.REJECTED_DESCRIPTOR);
    assert.equal(sparseState.getStatus().pendingCreation, null);
});

test('30/30과 18/30의 1→2 plan/commit은 Share, HP, Power를 정확히 보존한다', () => {
    const full = new TowerGroupState();
    const descriptor = { position: { x: 2, y: 3 } };
    const fullPlan = full.planCreation({
        transactionId: 'full-1-to-2',
        childCount: 1,
        childRecoverySpawnDescriptors: [descriptor]
    });
    descriptor.position.x = 99;
    assert.equal(fullPlan.accepted, true);
    assert.deepEqual(
        [...fullPlan.existing, ...fullPlan.children].map((record) => ({
            shareUnits: record.shareUnits,
            currentHpFixedPoint: record.currentHpFixedPoint,
            maxHpFixedPoint: record.maxHpFixedPoint,
            powerFixedPoint: record.powerFixedPoint
        })),
        [
            {
                shareUnits: 500_000_000,
                currentHpFixedPoint: 1500,
                maxHpFixedPoint: 1500,
                powerFixedPoint: 500
            },
            {
                shareUnits: 500_000_000,
                currentHpFixedPoint: 1500,
                maxHpFixedPoint: 1500,
                powerFixedPoint: 500
            }
        ]
    );
    assert.equal(fullPlan.children[0].recoverySpawnDescriptor.position.x, 2);
    assert.equal(full.getStatus().totalTowerRecordCount, 1);
    assert.equal(full.getStatus().pendingCreation.childCount, 1);
    const fullCommit = full.commitCreation(fullPlan);
    assert.equal(fullCommit.result, TOWER_CREATION_RESULT.COMMITTED);
    assert.equal(fullCommit.createdCount, 1);
    assert.equal(full.getStatus().livingTowerCount, 2);
    assert.equal(full.getTowerRecords().reduce(
        (sum, record) => sum + record.currentHpFixedPoint,
        0
    ), 3000);
    assert.equal(full.auditInvariants().valid, true);

    const damaged = new TowerGroupState();
    const handle = Object.freeze({ entityId: 101, incarnation: 1 });
    damaged.bindGpuBody(PRIMARY_TOWER_LOGICAL_ID, handle, PROTOCOL);
    damaged.commitCompletedEvents({
        events: [damageEvent(handle, 1, 1200, 'damage-30-to-18')]
    });
    const damagedPlan = damaged.planCreation({
        transactionId: 'damaged-1-to-2',
        childCount: 1
    });
    assert.equal(damagedPlan.accepted, true);
    assert.deepEqual(
        [...damagedPlan.existing, ...damagedPlan.children].map((record) => (
            [record.currentHpFixedPoint, record.maxHpFixedPoint]
        )),
        [[900, 1500], [900, 1500]]
    );
    damaged.commitCreation(damagedPlan);
    assert.equal(damaged.getTowerRecords().reduce(
        (sum, record) => sum + record.currentHpFixedPoint,
        0
    ), 1800);
    assert.equal(damaged.auditInvariants().valid, true);
});

test('1→100은 숨은 낮은 count cap 없이 exact unit과 centi-stat을 배분한다', () => {
    const state = new TowerGroupState();
    const plan = state.planCreation({
        transactionId: 'one-to-one-hundred',
        childCount: 99
    });
    assert.equal(plan.accepted, true);
    assert.equal(plan.existing.length + plan.children.length, 100);
    for (const record of [...plan.existing, ...plan.children]) {
        assert.equal(record.shareUnits, 10_000_000);
        assert.equal(record.currentHpFixedPoint, 30);
        assert.equal(record.maxHpFixedPoint, 30);
        assert.equal(record.powerFixedPoint, 10);
    }
    state.commitCreation(plan);
    const records = state.getTowerRecords();
    assert.equal(records.length, 100);
    assert.equal(records.reduce((sum, record) => sum + record.shareUnits, 0),
        TOWER_SHARE_SCALE);
    assert.equal(records.reduce(
        (sum, record) => sum + record.currentHpFixedPoint,
        0
    ), 3000);
    assert.equal(state.auditInvariants().valid, true);
});

test('largest-remainder는 heterogeneous input permutation과 무관하다', () => {
    const ledger = new TowerShareLedger({
        runBaseMaxHpFixedPoint: 3000,
        runBasePowerFixedPoint: 1000
    });
    const living = [
        {
            logicalTowerId: 'tower-a',
            logicalTowerOrdinal: 1,
            shareUnits: 500_000_001,
            currentHpFixedPoint: 1200,
            maxHpFixedPoint: 1500,
            powerFixedPoint: 500,
            exactGpuBinding: { entityId: 30, incarnation: 2 }
        },
        {
            logicalTowerId: 'tower-b',
            logicalTowerOrdinal: 2,
            shareUnits: 299_999_999,
            currentHpFixedPoint: 900,
            maxHpFixedPoint: 900,
            powerFixedPoint: 300,
            exactGpuBinding: { entityId: 20, incarnation: 4 }
        },
        {
            logicalTowerId: 'tower-c',
            logicalTowerOrdinal: 3,
            shareUnits: 200_000_000,
            currentHpFixedPoint: 600,
            maxHpFixedPoint: 600,
            powerFixedPoint: 200,
            exactGpuBinding: { entityId: 10, incarnation: 6 }
        }
    ];
    const children = [
        { logicalTowerId: 'tower-d', logicalTowerOrdinal: 4 },
        { logicalTowerId: 'tower-e', logicalTowerOrdinal: 5 }
    ];
    const forward = ledger.planCreation(living, children);
    const reversed = ledger.planCreation(
        [...living].reverse(),
        [...children].reverse()
    );
    assert.equal(forward.accepted, true);
    assert.deepEqual(valuesById(forward), valuesById(reversed));
    assert.equal(forward.allocations.reduce(
        (sum, record) => sum + record.shareUnits,
        0
    ), TOWER_SHARE_SCALE);
    assert.equal(forward.allocations.reduce(
        (sum, record) => sum + record.currentHpFixedPoint,
        0
    ), 2700);
    for (const record of forward.allocations) {
        assert.equal(record.currentHpFixedPoint <= record.maxHpFixedPoint, true);
    }
});

test('exact Tower death는 Share를 한 번만 Lost로 옮기고 primary를 낮은 ordinal로 유지한다', () => {
    const state = new TowerGroupState();
    const plan = state.planCreation({
        transactionId: 'death-two-towers',
        childCount: 1
    });
    state.commitCreation(plan);
    const [primary, child] = state.getTowerRecords();
    const primaryHandle = Object.freeze({ entityId: 201, incarnation: 1 });
    const childHandle = Object.freeze({ entityId: 202, incarnation: 1 });
    state.bindGpuBody(primary.logicalTowerId, primaryHandle, PROTOCOL);
    state.bindGpuBody(child.logicalTowerId, childHandle, PROTOCOL);

    const childDeath = deathEvent(childHandle, 1, 'child-death');
    const facts = state.commitCompletedEvents({ events: [childDeath] });
    assert.deepEqual(facts.map((fact) => fact.type), [
        TOWER_COMBAT_FACT_TYPE.DIED,
        TOWER_COMBAT_FACT_TYPE.SHARE_LOST
    ]);
    assert.equal(state.getStatus().livingTowerCount, 1);
    assert.equal(state.getStatus().livingShareUnits, 500_000_000);
    assert.equal(state.getStatus().lostShareUnits, 500_000_000);
    assert.equal(state.getStatus().primaryLogicalTowerId, primary.logicalTowerId);
    assert.equal(state.getPrimaryTowerRecord().shareUnits, 500_000_000);
    assert.equal(state.getPrimaryTowerRecord().maxHpFixedPoint, 1500);

    assert.deepEqual(state.commitCompletedEvents({ events: [childDeath] }), []);
    assert.deepEqual(state.commitCompletedEvents({
        events: [deathEvent(
            { entityId: childHandle.entityId, incarnation: 2 },
            2,
            'child-aba-death'
        )]
    }), []);
    assert.equal(state.getStatus().lostShareUnits, 500_000_000);

    const survivorPlan = state.planCreation({
        transactionId: 'survivor-split',
        childCount: 1
    });
    assert.equal(survivorPlan.accepted, true);
    assert.deepEqual(
        [...survivorPlan.existing, ...survivorPlan.children].map((record) => (
            [record.shareUnits, record.currentHpFixedPoint, record.maxHpFixedPoint]
        )),
        [[250_000_000, 750, 750], [250_000_000, 750, 750]]
    );
    state.rejectCreation(survivorPlan, 'test-reject');
    assert.equal(state.getStatus().livingTowerCount, 1);
    assert.equal(state.auditInvariants().valid, true);

    const lastFacts = state.commitCompletedEvents({
        events: [deathEvent(primaryHandle, 3, 'primary-death')]
    });
    assert.deepEqual(lastFacts.map((fact) => fact.type), [
        TOWER_COMBAT_FACT_TYPE.DIED,
        TOWER_COMBAT_FACT_TYPE.SHARE_LOST,
        TOWER_COMBAT_FACT_TYPE.NO_LIVING_TOWERS
    ]);
    assert.equal(state.getStatus().livingTowerCount, 0);
    assert.equal(state.getStatus().lostShareUnits, TOWER_SHARE_SCALE);
    assert.equal(lastFacts.some((fact) => fact.type === 'RunFailed'), false);
    const zeroPlan = state.planCreation({
        transactionId: 'zero-share-create',
        childCount: 1
    });
    assert.equal(zeroPlan.result, TOWER_CREATION_RESULT.REJECTED_ZERO_SHARE);
    assert.equal(
        zeroPlan.reason,
        TOWER_CREATION_REASON.ZERO_LIVING_SHARE_NON_VIABLE
    );
    assert.equal(state.auditInvariants().valid, true);
});

test('source drift/reject/non-viable creation은 public state를 전혀 바꾸지 않는다', () => {
    const state = new TowerGroupState();
    const original = state.getStatus();
    const plan = state.planCreation({
        transactionId: 'source-drift',
        childCount: 1
    });
    state.bindGpuBody(
        PRIMARY_TOWER_LOGICAL_ID,
        { entityId: 301, incarnation: 1 },
        PROTOCOL
    );
    const drift = state.commitCreation(plan);
    assert.equal(drift.result, TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED);
    assert.equal(state.getStatus().livingTowerCount, 1);
    assert.equal(state.getStatus().livingShareUnits, original.livingShareUnits);
    assert.equal(state.getTowerRecords().length, 1);

    const rejectedPlan = state.planCreation({
        transactionId: 'explicit-reject',
        childCount: 1
    });
    const beforeReject = state.getTowerRecords();
    state.rejectCreation(rejectedPlan, 'capacity');
    assert.deepEqual(state.getTowerRecords(), beforeReject);

    const nonViable = new TowerGroupState({ maxHp: 0.01 });
    const nonViablePlan = nonViable.planCreation({
        transactionId: 'non-viable-health',
        childCount: 1
    });
    assert.equal(
        nonViablePlan.result,
        TOWER_CREATION_RESULT.REJECTED_NON_VIABLE_HEALTH
    );
    assert.equal(
        nonViablePlan.reason,
        TOWER_CREATION_REASON.NON_VIABLE_DERIVED_HEALTH
    );
    assert.equal(nonViable.getTowerRecords().length, 1);
    assert.equal(nonViable.getStatus().pendingCreation, null);
});

test('동일 exact GPU binding 재확인은 state revision과 pending creation을 바꾸지 않는다', () => {
    const state = new TowerGroupState();
    const handle = Object.freeze({ entityId: 401, incarnation: 2 });
    const firstBinding = state.bindGpuBody(
        PRIMARY_TOWER_LOGICAL_ID,
        handle,
        PROTOCOL
    );
    const plan = state.planCreation({
        transactionId: 'idempotent-binding-plan',
        childCount: 1
    });
    const revision = state.getStatus().stateRevision;
    const secondBinding = state.bindGpuBody(
        PRIMARY_TOWER_LOGICAL_ID,
        handle,
        PROTOCOL
    );

    assert.strictEqual(secondBinding, firstBinding);
    assert.equal(state.getStatus().stateRevision, revision);
    assert.equal(
        state.commitCreation(plan).result,
        TOWER_CREATION_RESULT.COMMITTED
    );
    assert.equal(state.auditInvariants().valid, true);
});

test('160-step create/death churn은 Share, HP bound, identity, Lost monotonic을 보존한다', () => {
    const state = new TowerGroupState();
    let nextEntityId = 1000;
    let sourceTick = 1;
    let previousLostShareUnits = 0;

    for (let step = 0; step < 160; step++) {
        const plan = state.planCreation({
            transactionId: `property-create-${step}`,
            childCount: 1
        });
        assert.equal(plan.accepted, true, `step ${step} creation`);
        state.commitCreation(plan);

        if (step % 4 === 3) {
            const living = state.getTowerRecords().filter((record) => (
                record.state === TOWER_GROUP_RECORD_STATE.LIVING
            ));
            const victim = living[living.length - 1];
            const handle = Object.freeze({
                entityId: nextEntityId++,
                incarnation: 1
            });
            state.bindGpuBody(victim.logicalTowerId, handle, PROTOCOL);
            state.commitCompletedEvents({
                events: [deathEvent(
                    handle,
                    sourceTick++,
                    `property-death-${step}`
                )]
            });
        }

        const audit = state.auditInvariants();
        assert.equal(audit.valid, true, audit.violations.join(','));
        assert.equal(
            audit.livingShareUnits + audit.lostShareUnits,
            TOWER_SHARE_SCALE
        );
        assert.equal(audit.lostShareUnits >= previousLostShareUnits, true);
        previousLostShareUnits = audit.lostShareUnits;
    }

    const records = state.getTowerRecords();
    assert.equal(new Set(records.map((record) => record.logicalTowerId)).size,
        records.length);
    assert.equal(new Set(records.map((record) => record.logicalTowerOrdinal)).size,
        records.length);
    for (const record of records) {
        assert.equal(record.currentHpFixedPoint >= 0, true);
        assert.equal(record.currentHpFixedPoint <= record.maxHpFixedPoint, true);
    }
});
