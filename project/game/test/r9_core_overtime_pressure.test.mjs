import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const resolutionContract = await loadGameModule(
    'ingame/contract/wave_resolution_contract.js'
);
const planContract = await loadGameModule(
    'ingame/contract/wave_run_plan_contract.js'
);
const stateContract = await loadGameModule(
    'ingame/contract/wave_run_state_contract.js'
);
const { createWaveQuiescenceSnapshot } = await loadGameModule(
    'ingame/contract/wave_quiescence_contract.js'
);
const { WaveRunCoordinator } = await loadGameModule(
    'ingame/flow/wave_run_coordinator.js'
);
const pressureModule = await loadGameModule(
    'ingame/flow/core_overtime_pressure_director.js'
);
const { CoreIntegrity } = await loadGameModule(
    'ingame/state/core_integrity.js'
);
const { RunOutcome } = await loadGameModule('ingame/state/run_outcome.js');

const {
    WAVE_OVERTIME_DAMAGE_BASIS,
    createWaveResolutionProfile
} = resolutionContract;
const {
    createWaveRunPlan,
    getWaveRunPlanFingerprint,
    getWaveRunPlanWaveMetadata
} = planContract;
const {
    WAVE_RUN_FACT_TYPE,
    WAVE_RUN_FINAL_CONTINUE_RESULT,
    WAVE_RUN_STATE
} = stateContract;
const {
    CORE_OVERTIME_PRESSURE_FACT_TYPE,
    CORE_OVERTIME_PRESSURE_RESULT_CODE,
    CoreOvertimePressureDirector,
    calculateCoreOvertimeDamageFixedPoint,
    encodeWaveSiegeWeightFixedPoint
} = pressureModule;

function createProfile(overrides = {}) {
    return createWaveResolutionProfile({
        profileId: overrides.profileId ?? 'r9-overtime-fixture-profile',
        combatDurationTicks: overrides.combatDurationTicks ?? 2,
        requireAllHostilesCleared: true,
        overtime: {
            enabled: true,
            graceTicks: 1,
            pulseIntervalTicks: 2,
            damageBasis: WAVE_OVERTIME_DAMAGE_BASIS.SIEGE_WEIGHT,
            minimumDamageFixedPoint: 1_000,
            damagePerSiegeWeightNumerator: 250,
            damagePerSiegeWeightDenominator: 1_000,
            maximumDamageFixedPoint: 5_000,
            ...overrides.overtime
        },
        settlement: {
            completionGoldBonus: 0,
            openShop: true
        }
    });
}

function createPlan(profile = createProfile()) {
    const mapId = 'r9-overtime-fixture-map';
    const waveDefinition = Object.freeze({
        waveId: 'r9-overtime-fixture-wave',
        mapId,
        enemyModifiers: Object.freeze({}),
        timeline: Object.freeze([Object.freeze({
            timelineEntryId: 'r9-overtime-fixture-entry',
            type: 'SPAWN_GROUP',
            spawnGroup: Object.freeze({})
        })])
    });
    return createWaveRunPlan({
        planId: 'r9-overtime-fixture-plan',
        mapId,
        waves: [{
            waveOrdinal: 1,
            waveDefinition,
            resolutionProfileId: profile.profileId
        }],
        shopAfterEveryWave: true,
        finalContinueResult: WAVE_RUN_FINAL_CONTINUE_RESULT.MAP_CLEAR_READY
    }, {
        resolutionProfileById: Object.freeze({
            [profile.profileId]: profile
        })
    });
}

function createSnapshot(harness, overrides = {}) {
    const liveHostileActorCount = overrides.liveHostileActorCount ?? 2;
    const pendingHostileActorCount
        = overrides.pendingHostileActorCount ?? 0;
    const revision = overrides.revision ?? ++harness.snapshotRevision;
    return createWaveQuiescenceSnapshot({
        snapshotRevision: revision,
        fixedTick: overrides.fixedTick ?? harness.completedFixedTick + 1,
        protocol: {
            sessionGeneration: 1,
            deviceGeneration: 2,
            authoritativeEpoch: 3
        },
        wave: {
            mapId: harness.plan.mapId,
            waveId: harness.waveId,
            waveOrdinal: 1,
            initialized: true,
            totalSpawnCount: 2,
            queuedSpawnCount: 2,
            remainingSpawnCount: 0,
            blockedSpawnCount: 0,
            allSpawnsQueued: true,
            completionOwned: false
        },
        hostile: {
            revision,
            registryRevision: overrides.registryRevision ?? 10,
            countExact: overrides.countExact ?? true,
            liveHostileActorCount,
            pendingHostileActorCount,
            hostileActorCount:
                liveHostileActorCount + pendingHostileActorCount
        },
        pending: {
            hostileLifecycleSpawnCount: 0,
            hostileMaterializationCount: 0,
            hostileTransitCount: 0,
            hostileAtomicTransformCount: 0,
            lifecycleCommandCount: overrides.lifecycleCommandCount ?? 0,
            materializationWorkCount: 0,
            transitActorCount: 0,
            atomicTransformWorkCount: 0
        },
        events: {
            lastSubmittedTick: overrides.lastSubmittedTick ?? 1,
            lastCompletedTick: overrides.lastCompletedTick ?? 1,
            completedThroughTick: overrides.completedThroughTick ?? 1,
            deferredBatchCount: overrides.deferredBatchCount ?? 0,
            protocolFailure: overrides.protocolFailure ?? false
        },
        registryRevision: overrides.registryRevision ?? 10,
        run: {
            running: overrides.running ?? harness.runOutcome.isRunning(),
            defeated: overrides.defeated ?? harness.runOutcome.isDefeated(),
            coreDepleted:
                overrides.coreDepleted ?? harness.coreIntegrity.isDepleted(),
            recoveryRequired: overrides.recoveryRequired ?? false
        }
    });
}

function createHostileStatus(snapshot, siegeWeight) {
    return Object.freeze({
        revision: snapshot.hostile.revision,
        registryRevision: snapshot.hostile.registryRevision,
        countExact: snapshot.hostile.countExact,
        liveHostileActorCount: snapshot.hostile.liveHostileActorCount,
        pendingHostileActorCount: snapshot.hostile.pendingHostileActorCount,
        hostileActorCount: snapshot.hostile.hostileActorCount,
        siegeWeight,
        bountyPotential: 0,
        sentenceCreatedHostileCount: 0
    });
}

function createHarness(options = {}) {
    const profile = options.profile ?? createProfile();
    const plan = createPlan(profile);
    const runSessionId = options.runSessionId ?? 'r9-overtime-fixture-run';
    const coordinator = new WaveRunCoordinator({
        plan,
        runSessionId,
        factHistoryCapacity: 64,
        transactionHistoryCapacity: 128
    });
    const coreIntegrity = new CoreIntegrity({
        maxIntegrity: options.maxIntegrity ?? 100
    });
    const runOutcome = new RunOutcome();
    const director = new CoreOvertimePressureDirector({
        coreIntegrity,
        runOutcome,
        waveRunCoordinator: coordinator,
        factCapacity: options.factCapacity ?? 32,
        transactionCapacity: 64
    });
    const waveId = getWaveRunPlanWaveMetadata(plan, 1).waveId;
    const harness = {
        profile,
        plan,
        waveId,
        runSessionId,
        coordinator,
        coreIntegrity,
        runOutcome,
        director,
        snapshotRevision: 0,
        transactionOrdinal: 0,
        completedFixedTick: 0
    };
    coordinator.startPlan({
        transactionId: 'start',
        runSessionId,
        planId: plan.planId,
        planFingerprint: getWaveRunPlanFingerprint(plan)
    });
    coordinator.beginWave({
        transactionId: 'begin',
        runSessionId,
        planId: plan.planId,
        waveOrdinal: 1,
        waveId,
        startingFixedTick: 0
    });
    for (let elapsed = 1; elapsed <= profile.combatDurationTicks; elapsed++) {
        coordinator.observeClockTick({
            transactionId: `clock:${elapsed}`,
            runSessionId,
            planId: plan.planId,
            waveOrdinal: 1,
            waveId,
            proposedElapsedCombatTicks: elapsed,
            completedFixedTick: elapsed,
            intentionalPause: false,
            completed: true
        });
        harness.completedFixedTick = elapsed;
    }
    const deadlineSnapshot = createSnapshot(harness, {
        fixedTick: harness.completedFixedTick + 1,
        liveHostileActorCount: options.hostileActorCount ?? 2
    });
    const overtime = coordinator.evaluateWaveQuiescence(deadlineSnapshot);
    assert.equal(overtime.state, WAVE_RUN_STATE.OVERTIME);
    return harness;
}

function observe(harness, options = {}) {
    const completedFixedTick = options.completedFixedTick
        ?? harness.completedFixedTick;
    const fixedTick = options.fixedTick ?? completedFixedTick + 1;
    const snapshot = options.snapshot ?? createSnapshot(harness, {
        fixedTick,
        liveHostileActorCount: options.hostileActorCount ?? 2,
        lifecycleCommandCount: options.lifecycleCommandCount ?? 0,
        running: options.running,
        defeated: options.defeated,
        coreDepleted: options.coreDepleted,
        recoveryRequired: options.snapshotRecoveryRequired ?? false
    });
    return harness.director.observeFixedBoundary({
        transactionId: options.transactionId,
        fixedTick,
        completedFixedTick,
        completedBoundary: options.completedBoundary ?? true,
        intentionalPause: options.intentionalPause ?? false,
        recoveryRequired: options.recoveryRequired ?? false,
        snapshot,
        hostileStatus: options.hostileStatus
            ?? createHostileStatus(snapshot, options.siegeWeight ?? 8)
    });
}

test('fixed-point host reference는 decimal·rational·min/max·BigInt overflow를 결정론적으로 계산한다', () => {
    const overtime = createProfile().overtime;
    assert.equal(encodeWaveSiegeWeightFixedPoint(1.005), 1_005);
    assert.deepEqual(
        calculateCoreOvertimeDamageFixedPoint(4.5, overtime),
        {
            siegeWeight: 4.5,
            siegeWeightFixedPoint: 4_500,
            scaledDamageFixedPointExact: '1125',
            damageFixedPoint: 1_125,
            damage: 1.125
        }
    );
    assert.equal(
        calculateCoreOvertimeDamageFixedPoint(0, overtime).damageFixedPoint,
        1_000
    );
    assert.equal(
        calculateCoreOvertimeDamageFixedPoint(1_000, overtime).damageFixedPoint,
        5_000
    );
    const overflowSafe = calculateCoreOvertimeDamageFixedPoint(
        9_000_000_000_000,
        {
            ...overtime,
            damagePerSiegeWeightNumerator: 0xffff_ffff,
            damagePerSiegeWeightDenominator: 1,
            maximumDamageFixedPoint: 0xffff_ffff
        }
    );
    assert.equal(overflowSafe.damageFixedPoint, 0xffff_ffff);
    assert.equal(
        BigInt(overflowSafe.scaledDamageFixedPointExact)
            > BigInt(Number.MAX_SAFE_INTEGER),
        true
    );
    assert.throws(
        () => encodeWaveSiegeWeightFixedPoint(Number.MAX_VALUE),
        /안전한 정수 범위/u
    );
});

test('damage는 raw hostile count가 아니라 authored siegeWeight만 사용한다', () => {
    const first = createHarness({ hostileActorCount: 1 });
    const second = createHarness({ hostileActorCount: 999 });
    const firstPulse = observe(first, {
        completedFixedTick: 3,
        hostileActorCount: 1,
        siegeWeight: 4.5
    });
    const secondPulse = observe(second, {
        completedFixedTick: 3,
        hostileActorCount: 999,
        siegeWeight: 4.5
    });
    assert.equal(firstPulse.pulsed, true);
    assert.equal(secondPulse.pulsed, true);
    assert.equal(firstPulse.facts.find((fact) => (
        fact.type === WAVE_RUN_FACT_TYPE.OVERTIME_PULSE
    )).requestedDamage, 1.125);
    assert.equal(secondPulse.facts.find((fact) => (
        fact.type === WAVE_RUN_FACT_TYPE.OVERTIME_PULSE
    )).requestedDamage, 1.125);

    const siegeExcluded = createHarness({ hostileActorCount: 1 });
    const excludedPulse = observe(siegeExcluded, {
        completedFixedTick: 3,
        hostileActorCount: 1,
        siegeWeight: 0
    });
    const excludedFact = excludedPulse.facts.find((fact) => (
        fact.type === WAVE_RUN_FACT_TYPE.OVERTIME_PULSE
    ));
    assert.equal(excludedFact.siegeWeightFixedPoint, 0);
    assert.equal(excludedFact.scaledDamageFixedPointExact, '0');
    assert.equal(excludedFact.requestedDamage, 1);
    assert.equal(siegeExcluded.coordinator.getStatus().state, WAVE_RUN_STATE.OVERTIME);
});

test('OvertimeStarted는 exact once이고 pulse cadence와 replay가 ordinal을 보존한다', () => {
    const harness = createHarness();
    const beforeDue = observe(harness, {
        transactionId: 'before-due',
        completedFixedTick: 2
    });
    assert.equal(beforeDue.pulsed, false);
    assert.equal(beforeDue.facts.filter((fact) => (
        fact.type === WAVE_RUN_FACT_TYPE.OVERTIME_STARTED
    )).length, 1);

    const pulseSnapshot = createSnapshot(harness, {
        fixedTick: 4,
        liveHostileActorCount: 2
    });
    const pulseRequest = {
        transactionId: 'pulse-one',
        completedFixedTick: 3,
        fixedTick: 4,
        snapshot: pulseSnapshot,
        hostileStatus: createHostileStatus(pulseSnapshot, 8)
    };
    const firstPulse = observe(harness, pulseRequest);
    const replay = observe(harness, pulseRequest);
    assert.equal(firstPulse.pulsed, true);
    assert.equal(firstPulse.overtimePulseOrdinal, 1);
    assert.equal(firstPulse.nextPulseFixedTick, 5);
    assert.equal(replay.replayed, true);
    assert.equal(replay.pulsed, false);
    assert.equal(replay.facts.length, 0);

    const cadenceGap = observe(harness, { completedFixedTick: 4 });
    const secondPulse = observe(harness, { completedFixedTick: 5 });
    assert.equal(cadenceGap.pulsed, false);
    assert.equal(secondPulse.pulsed, true);
    assert.equal(secondPulse.overtimePulseOrdinal, 2);
    const facts = harness.director.getFacts();
    assert.equal(facts.filter((fact) => (
        fact.type === WAVE_RUN_FACT_TYPE.OVERTIME_STARTED
    )).length, 1);
    assert.equal(facts.filter((fact) => (
        fact.type === WAVE_RUN_FACT_TYPE.OVERTIME_PULSE
    )).length, 2);
});

test('같은 transaction ID의 다른 siege evidence는 conflict이며 damage를 중복 적용하지 않는다', () => {
    const harness = createHarness();
    const first = observe(harness, {
        transactionId: 'conflict-boundary',
        completedFixedTick: 3,
        siegeWeight: 4
    });
    const integrity = harness.coreIntegrity.getCurrentIntegrity();
    const conflict = observe(harness, {
        transactionId: 'conflict-boundary',
        completedFixedTick: 3,
        siegeWeight: 8
    });
    assert.equal(first.pulsed, true);
    assert.equal(conflict.code,
        CORE_OVERTIME_PRESSURE_RESULT_CODE.TRANSACTION_CONFLICT);
    assert.equal(conflict.recoveryRequired, true);
    assert.equal(harness.coreIntegrity.getCurrentIntegrity(), integrity);
    assert.equal(harness.director.getStatus().overtimePulseOrdinal, 1);
});

test('due boundary의 final hostile clear와 pending terminal cleanup은 pulse보다 우선한다', () => {
    const finalDeath = createHarness({ hostileActorCount: 1 });
    const clearSnapshot = createSnapshot(finalDeath, {
        fixedTick: 4,
        liveHostileActorCount: 0
    });
    const clear = finalDeath.coordinator.evaluateWaveQuiescence(clearSnapshot);
    assert.equal(clear.clearCandidateAccepted, true);
    const suppressed = observe(finalDeath, {
        completedFixedTick: 3,
        fixedTick: 4,
        snapshot: clearSnapshot,
        hostileStatus: createHostileStatus(clearSnapshot, 0)
    });
    assert.equal(suppressed.pulsed, false);
    assert.equal(finalDeath.coreIntegrity.getCurrentIntegrity(), 100);

    const cleanupPending = createHarness({ hostileActorCount: 1 });
    const deferred = observe(cleanupPending, {
        completedFixedTick: 3,
        hostileActorCount: 1,
        siegeWeight: 8,
        lifecycleCommandCount: 1
    });
    assert.equal(deferred.pulsed, false);
    assert.equal(deferred.pendingTerminalCleanup, true);
    assert.equal(cleanupPending.director.getStatus().overtimePulseOrdinal, 0);
});

test('Core impact damage가 먼저 반영되고 run이 살아 있을 때만 overtime damage가 이어진다', () => {
    const harness = createHarness({ maxIntegrity: 5 });
    assert.equal(harness.coreIntegrity.applyIntegrityDamage(2), 2);
    const pulse = observe(harness, {
        completedFixedTick: 3,
        siegeWeight: 8
    });
    const damaged = pulse.facts.find((fact) => (
        fact.type === CORE_OVERTIME_PRESSURE_FACT_TYPE.CORE_DAMAGED
    ));
    assert.equal(damaged.coreIntegrityBefore, 3);
    assert.equal(damaged.damage, 2);
    assert.equal(damaged.currentIntegrity, 1);

    const impactLethal = createHarness({ maxIntegrity: 1 });
    impactLethal.coreIntegrity.applyIntegrityDamage(1);
    impactLethal.runOutcome.transitionToDefeated({
        fixedTick: 3,
        sourceType: 'CoreDepleted'
    });
    const noPulse = observe(impactLethal, {
        completedFixedTick: 3,
        running: false,
        defeated: true,
        coreDepleted: true
    });
    assert.equal(noPulse.pulsed, false);
    assert.equal(noPulse.code, CORE_OVERTIME_PRESSURE_RESULT_CODE.RUN_DEFEATED);
    assert.equal(impactLethal.coordinator.getStatus().state,
        WAVE_RUN_STATE.RUN_DEFEATED);
});

test('lethal overtime은 Core/Run/Wave terminal facts를 한 번만 만들고 미래 pulse를 봉인한다', () => {
    const harness = createHarness({ maxIntegrity: 1 });
    const lethal = observe(harness, {
        completedFixedTick: 3,
        siegeWeight: 8
    });
    assert.equal(lethal.pulsed, true);
    assert.equal(lethal.defeated, true);
    assert.equal(harness.coreIntegrity.isTerminallySealed(), true);
    assert.equal(harness.runOutcome.isDefeated(), true);
    assert.equal(harness.coordinator.getStatus().state, WAVE_RUN_STATE.RUN_DEFEATED);
    const types = lethal.facts.map(({ type }) => type);
    assert.equal(types.filter((type) => (
        type === CORE_OVERTIME_PRESSURE_FACT_TYPE.CORE_DEPLETED
    )).length, 1);
    assert.equal(types.filter((type) => (
        type === CORE_OVERTIME_PRESSURE_FACT_TYPE.RUN_FAILED
    )).length, 1);
    assert.equal(types.filter((type) => (
        type === CORE_OVERTIME_PRESSURE_FACT_TYPE.WAVE_FAILED
    )).length, 1);
    assert.equal(harness.coordinator.getFacts().some((fact) => (
        fact.type === WAVE_RUN_FACT_TYPE.WAVE_COMPLETED
    )), false);

    const future = observe(harness, {
        completedFixedTick: 5,
        running: false,
        defeated: true,
        coreDepleted: true
    });
    assert.equal(future.pulsed, false);
    assert.equal(harness.director.getStatus().overtimePulseOrdinal, 1);
    assert.equal(harness.coordinator.getFacts().filter((fact) => (
        fact.type === WAVE_RUN_FACT_TYPE.WAVE_FAILED
    )).length, 1);
});

test('pause/backpressure/recovery boundary는 pulse를 만들지 않고 recovery 뒤 ordinal/cadence를 보존한다', () => {
    const harness = createHarness();
    const paused = observe(harness, {
        completedFixedTick: 3,
        completedBoundary: false,
        intentionalPause: true
    });
    assert.equal(paused.pulsed, false);
    assert.equal(harness.director.getStatus().nextPulseFixedTick, 3);

    const recovery = observe(harness, {
        completedFixedTick: 3,
        recoveryRequired: true
    });
    assert.equal(recovery.pulsed, false);
    assert.equal(recovery.recoveryRequired, true);
    assert.equal(harness.director.getStatus().overtimePulseOrdinal, 0);
    assert.equal(harness.director.requiresRecovery(), false);

    const afterRecovery = observe(harness, {
        completedFixedTick: 3,
        siegeWeight: 8
    });
    assert.equal(afterRecovery.pulsed, true);
    assert.equal(afterRecovery.overtimePulseOrdinal, 1);
    assert.equal(afterRecovery.nextPulseFixedTick, 5);
});

test('정상 event watermark 지연은 같은 fixed tick을 defer하고 protocol failure만 recovery로 승격한다', () => {
    const delayed = createHarness();
    const delayedSnapshot = createSnapshot(delayed, {
        fixedTick: 4,
        liveHostileActorCount: 2,
        lastSubmittedTick: 1,
        lastCompletedTick: 0,
        completedThroughTick: 0
    });
    const deferred = observe(delayed, {
        completedFixedTick: 3,
        fixedTick: 4,
        snapshot: delayedSnapshot,
        hostileStatus: createHostileStatus(delayedSnapshot, 8)
    });
    assert.equal(deferred.code, CORE_OVERTIME_PRESSURE_RESULT_CODE.DEFERRED);
    assert.equal(deferred.recoveryRequired, false);
    assert.equal(deferred.pulsed, false);
    assert.equal(delayed.director.requiresRecovery(), false);
    assert.equal(delayed.coreIntegrity.getCurrentIntegrity(), 100);

    const contiguousSnapshot = createSnapshot(delayed, {
        fixedTick: 4,
        liveHostileActorCount: 2,
        lastSubmittedTick: 1,
        lastCompletedTick: 1,
        completedThroughTick: 1
    });
    const retried = observe(delayed, {
        completedFixedTick: 3,
        fixedTick: 4,
        snapshot: contiguousSnapshot,
        hostileStatus: createHostileStatus(contiguousSnapshot, 8)
    });
    assert.equal(retried.pulsed, true);
    assert.equal(retried.recoveryRequired, false);
    assert.equal(retried.overtimePulseOrdinal, 1);

    const failed = createHarness();
    const failedSnapshot = createSnapshot(failed, {
        fixedTick: 4,
        liveHostileActorCount: 2,
        protocolFailure: true
    });
    const recovery = observe(failed, {
        completedFixedTick: 3,
        fixedTick: 4,
        snapshot: failedSnapshot,
        hostileStatus: createHostileStatus(failedSnapshot, 8)
    });
    assert.equal(
        recovery.code,
        CORE_OVERTIME_PRESSURE_RESULT_CODE.RECOVERY_REQUIRED
    );
    assert.equal(recovery.recoveryRequired, true);
    assert.equal(recovery.pulsed, false);
});

test('Sentence-created fractional siege와 countsTowardSiege=false aggregate를 그대로 소비한다', () => {
    const sentence = createHarness({ hostileActorCount: 3 });
    const sentencePulse = observe(sentence, {
        completedFixedTick: 3,
        hostileActorCount: 3,
        siegeWeight: 6.75
    });
    const pulseFact = sentencePulse.facts.find((fact) => (
        fact.type === WAVE_RUN_FACT_TYPE.OVERTIME_PULSE
    ));
    assert.equal(pulseFact.siegeWeightFixedPoint, 6_750);
    assert.equal(pulseFact.damageFixedPoint, 1_687);

    const nonSiegeBlocker = createHarness({ hostileActorCount: 1 });
    const excluded = observe(nonSiegeBlocker, {
        completedFixedTick: 3,
        hostileActorCount: 1,
        siegeWeight: 0
    });
    assert.equal(excluded.pulsed, true);
    assert.equal(nonSiegeBlocker.coordinator.getStatus().state,
        WAVE_RUN_STATE.OVERTIME);
});

test('fact history는 bounded/immutable이고 pulse identity는 monotonic하다', () => {
    const harness = createHarness({ factCapacity: 4, maxIntegrity: 100 });
    for (const tick of [3, 5, 7, 9]) {
        const result = observe(harness, {
            completedFixedTick: tick,
            siegeWeight: 4
        });
        assert.equal(result.pulsed, true);
    }
    const status = harness.director.getStatus();
    assert.equal(status.facts.length, 4);
    assert.equal(Object.isFrozen(status), true);
    assert.equal(Object.isFrozen(status.facts), true);
    assert.equal(Object.isFrozen(status.facts[0]), true);
    assert.equal(status.overtimePulseOrdinal, 4);
    const pulseOrdinals = status.facts
        .filter((fact) => fact.type === WAVE_RUN_FACT_TYPE.OVERTIME_PULSE)
        .map((fact) => fact.overtimePulseOrdinal);
    assert.deepEqual(pulseOrdinals, [...pulseOrdinals].sort((a, b) => a - b));
});

test('Overtime 1,000 pulse stress는 ordinal을 잃지 않고 fact/transaction history를 bounded 유지한다', () => {
    const harness = createHarness({ factCapacity: 8, maxIntegrity: 100_000 });
    for (let ordinal = 1; ordinal <= 1_000; ordinal++) {
        const receipt = observe(harness, {
            transactionId: `pulse-stress:${ordinal}`,
            completedFixedTick: 3 + ((ordinal - 1) * 2),
            siegeWeight: 4
        });
        assert.equal(receipt.pulsed, true, `pulse=${ordinal}`);
        assert.equal(receipt.overtimePulseOrdinal, ordinal, `pulse=${ordinal}`);
        assert.equal(receipt.recoveryRequired, false, `pulse=${ordinal}`);
    }
    const status = harness.director.getStatus();
    assert.equal(status.overtimePulseOrdinal, 1_000);
    assert.equal(status.overtimeDamageTotalFixedPoint, 1_000_000);
    assert.equal(status.facts.length, 8);
    assert.ok(harness.coordinator.getFacts().length <= 64);
    assert.equal(harness.coreIntegrity.getCurrentIntegrity(), 99_000);
    assert.equal(harness.runOutcome.isRunning(), true);
});

test('GameObjectSystem은 impact→clear test→overtime→terminal→ordinary staging 순서를 고정하고 recovery에서 CPU pressure를 보존한다', async () => {
    const gameObjectSystemSource = await readFile(
        new URL('../script/module/ingame/object/game_object_system.js', import.meta.url),
        'utf8'
    );
    const fixedUpdateStart = gameObjectSystemSource.indexOf('fixedUpdate(delta');
    const coreImpact = gameObjectSystemSource.indexOf(
        '#transitionRunOutcomeForCore(',
        fixedUpdateStart
    );
    const quiescence = gameObjectSystemSource.indexOf(
        '#evaluateWaveQuiescenceBeforeGameplayIngress(',
        coreImpact
    );
    const overtime = gameObjectSystemSource.indexOf(
        '#evaluateCoreOvertimePressureBeforeGameplayIngress(',
        quiescence
    );
    const overtimeTerminal = gameObjectSystemSource.indexOf(
        '#transitionRunOutcomeForCore(',
        overtime
    );
    const ordinaryStaging = gameObjectSystemSource.indexOf(
        'let primaryProjectileShotReceipt',
        overtimeTerminal
    );
    assert.equal(
        fixedUpdateStart < coreImpact
            && coreImpact < quiescence
            && quiescence < overtime
            && overtime < overtimeTerminal
            && overtimeTerminal < ordinaryStaging,
        true
    );
    const recoverySlice = gameObjectSystemSource.slice(
        gameObjectSystemSource.indexOf('restartGpuWorldAtSafeWaveBoundary()'),
        gameObjectSystemSource.indexOf('restartEnemyGpuWorldAtSafeWaveBoundary()')
    );
    assert.doesNotMatch(recoverySlice, /coreOvertimePressureDirector\?\.destroy/u);

    const directorSource = await readFile(
        new URL(
            '../script/module/ingame/flow/core_overtime_pressure_director.js',
            import.meta.url
        ),
        'utf8'
    );
    assert.doesNotMatch(
        directorSource,
        /hostileActorCount\s*[*/]\s*damagePerSiegeWeight/u
    );
    assert.match(directorSource, /BigInt\(siegeWeightFixedPoint\)/u);
});
