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
const { WaveRunCoordinator } = await loadGameModule(
    'ingame/flow/wave_run_coordinator.js'
);
const resolutionData = await loadGameModule(
    'data/scene/game/r9_wave_resolution_profile_data.js'
);
const planData = await loadGameModule(
    'data/scene/game/r9_wave_run_plan_data.js'
);
const { WaveDirector } = await loadGameModule('ingame/flow/wave_director.js');

const {
    WAVE_OVERTIME_DAMAGE_BASIS,
    createWaveResolutionProfile,
    createWaveResolutionProfileCatalog,
    getWaveResolutionProfileFingerprint
} = resolutionContract;
const {
    createWaveRunPlan,
    createWaveRunPlanCatalog,
    getWaveRunPlanFingerprint,
    getWaveRunPlanWaveMetadata,
    measureAuthoredWaveScheduleDurationTicks
} = planContract;
const {
    WAVE_RUN_FACT_TYPE,
    WAVE_RUN_FINAL_CONTINUE_RESULT,
    WAVE_RUN_RESULT_CODE,
    WAVE_RUN_STATE
} = stateContract;

function createProfile(overrides = {}) {
    return createWaveResolutionProfile({
        profileId: 'fixture-resolution',
        combatDurationTicks: 2,
        requireAllHostilesCleared: true,
        overtime: {
            enabled: true,
            graceTicks: 1,
            pulseIntervalTicks: 2,
            damageBasis: WAVE_OVERTIME_DAMAGE_BASIS.SIEGE_WEIGHT,
            minimumDamageFixedPoint: 100,
            damagePerSiegeWeightNumerator: 2,
            damagePerSiegeWeightDenominator: 3,
            maximumDamageFixedPoint: 10_000,
            ...overrides.overtime
        },
        settlement: {
            completionGoldBonus: 5,
            openShop: true,
            ...overrides.settlement
        },
        ...Object.fromEntries(
            Object.entries(overrides).filter(([key]) => (
                key !== 'overtime' && key !== 'settlement'
            ))
        )
    });
}

function createFrozenWave(waveId, mapId = 'fixture-map') {
    return Object.freeze({
        waveId,
        mapId,
        enemyModifiers: Object.freeze({}),
        timeline: Object.freeze([Object.freeze({
            timelineEntryId: `${waveId}-entry`,
            type: 'SPAWN_GROUP',
            spawnGroup: Object.freeze({})
        })])
    });
}

function createFixturePlan(options = {}) {
    const profile = options.profile ?? createProfile();
    const mapId = options.mapId ?? 'fixture-map';
    const waveIds = options.waveIds ?? ['fixture-wave'];
    const profiles = options.profiles ?? [profile];
    const profileById = Object.freeze(Object.fromEntries(
        profiles.map((entry) => [entry.profileId, entry])
    ));
    const plan = createWaveRunPlan({
        planId: options.planId ?? 'fixture-plan',
        mapId,
        waves: waveIds.map((waveId, index) => ({
            waveOrdinal: index + 1,
            waveDefinition: createFrozenWave(waveId, mapId),
            resolutionProfileId:
                options.resolutionProfileIds?.[index] ?? profile.profileId
        })),
        shopAfterEveryWave: true,
        finalContinueResult: WAVE_RUN_FINAL_CONTINUE_RESULT.MAP_CLEAR_READY
    }, { resolutionProfileById: profileById });
    return { plan, profileById };
}

function createHarness(options = {}) {
    const fixture = options.fixture ?? createFixturePlan(options);
    const runSessionId = options.runSessionId ?? 'fixture-run';
    const coordinator = new WaveRunCoordinator({
        plan: fixture.plan,
        runSessionId,
        factHistoryCapacity: options.factHistoryCapacity ?? 32,
        transactionHistoryCapacity: options.transactionHistoryCapacity ?? 64
    });
    let transactionOrdinal = 0;
    const transaction = (prefix) => `${prefix}:${++transactionOrdinal}`;
    const planSource = () => ({
        runSessionId,
        planId: fixture.plan.planId
    });
    const waveSource = () => ({
        ...planSource(),
        waveOrdinal: coordinator.getStatus().currentWaveOrdinal,
        waveId: coordinator.getStatus().currentWaveId
    });
    return {
        coordinator,
        fixture,
        runSessionId,
        transaction,
        planSource,
        waveSource,
        start() {
            return coordinator.startPlan({
                transactionId: transaction('start'),
                ...planSource(),
                planFingerprint: getWaveRunPlanFingerprint(fixture.plan)
            });
        },
        begin(waveOrdinal = 1, startingFixedTick = 0) {
            return coordinator.beginWave({
                transactionId: transaction('begin'),
                ...planSource(),
                waveOrdinal,
                waveId: getWaveRunPlanWaveMetadata(
                    fixture.plan,
                    waveOrdinal
                ).waveId,
                startingFixedTick
            });
        },
        clear(completionRevision = 1) {
            return coordinator.prepareClearCandidate({
                transactionId: transaction('clear'),
                ...waveSource(),
                allSpawnsQueued: true,
                remainingSpawnCount: 0,
                blockedSpawnCount: 0,
                hostileActorCount: 0,
                quiescenceProven: true,
                clearProofFingerprint: 1000 + completionRevision,
                completionRevision
            });
        },
        settle(completionRevision = 1) {
            return coordinator.prepareSettlement({
                transactionId: transaction('settle'),
                ...waveSource(),
                clearProofFingerprint: 1000 + completionRevision,
                completionRevision
            });
        },
        openShop(completionRevision = 1) {
            return coordinator.observeShopOpened({
                transactionId: transaction('shop-open'),
                ...waveSource(),
                shopSessionId: `shop-${completionRevision}`,
                completionRevision,
                shopReady: true
            });
        },
        continueShop(completionRevision = 1) {
            return coordinator.observeShopContinue({
                transactionId: transaction('continue'),
                ...waveSource(),
                continueReceiptId: `continue-${completionRevision}`,
                completionRevision,
                authentic: true
            });
        }
    };
}

test('WaveResolutionProfile은 getter/Proxy를 key마다 한 번만 materialize한다', () => {
    const gets = new Map();
    const ownKeys = new Map();
    const wrap = (label, value) => new Proxy(value, {
        ownKeys(target) {
            ownKeys.set(label, (ownKeys.get(label) ?? 0) + 1);
            return Reflect.ownKeys(target);
        },
        get(target, key, receiver) {
            if (typeof key === 'string') {
                const identity = `${label}.${key}`;
                gets.set(identity, (gets.get(identity) ?? 0) + 1);
            }
            return Reflect.get(target, key, receiver);
        }
    });
    const overtime = wrap('overtime', {
        enabled: true,
        graceTicks: 3,
        pulseIntervalTicks: 2,
        damageBasis: WAVE_OVERTIME_DAMAGE_BASIS.SIEGE_WEIGHT,
        minimumDamageFixedPoint: 1,
        damagePerSiegeWeightNumerator: 2,
        damagePerSiegeWeightDenominator: 3,
        maximumDamageFixedPoint: 4
    });
    const settlement = wrap('settlement', {
        completionGoldBonus: 0,
        openShop: true
    });
    const profile = createWaveResolutionProfile(wrap('profile', {
        profileId: 'proxy-profile',
        combatDurationTicks: 10,
        requireAllHostilesCleared: true,
        overtime,
        settlement
    }));
    assert.equal(profile.profileId, 'proxy-profile');
    assert.deepEqual(Object.fromEntries(ownKeys), {
        profile: 1,
        overtime: 1,
        settlement: 1
    });
    for (const count of gets.values()) assert.equal(count, 1);
    assert.equal(gets.size, 15);
});

test('resolution validation/fingerprint/deep freeze는 canonical이다', () => {
    const left = createProfile();
    const right = createProfile();
    assert.equal(
        getWaveResolutionProfileFingerprint(left),
        getWaveResolutionProfileFingerprint(right)
    );
    assert.equal(Object.isFrozen(left), true);
    assert.equal(Object.isFrozen(left.overtime), true);
    assert.equal(Object.isFrozen(left.settlement), true);
    assert.throws(() => { left.overtime.graceTicks = 99; }, TypeError);
    assert.throws(() => createProfile({ combatDurationTicks: 0 }), /uint32/);
    assert.throws(() => createProfile({
        overtime: { damagePerSiegeWeightDenominator: 0 }
    }), /uint32/);
    assert.throws(() => createProfile({
        overtime: {
            minimumDamageFixedPoint: 10,
            maximumDamageFixedPoint: 9
        }
    }), /minimum/);
    assert.throws(() => createWaveResolutionProfile({
        profileId: 'unknown-key',
        combatDurationTicks: 1,
        requireAllHostilesCleared: true,
        overtime: left.overtime,
        settlement: left.settlement,
        fallbackSeconds: 1
    }), /known keys/);
    assert.throws(
        () => createWaveResolutionProfileCatalog([left, right]),
        /중복/
    );
});

test('production/QA profile과 plan data는 exact schedule bound를 만족한다', () => {
    assert.equal(
        resolutionData.R9_WAVE_RESOLUTION_PROFILE_CATALOG.profiles.length,
        6
    );
    assert.equal(planData.R9_PRODUCTION_WAVE_RUN_PLANS.length, 3);
    assert.equal(planData.R9_QA_THREE_WAVE_RUN_PLAN.waves.length, 3);
    assert.equal(
        Object.values(planData.R9_PRODUCTION_WAVE_RUN_PLAN_BY_MAP_ID)
            .includes(planData.R9_QA_THREE_WAVE_RUN_PLAN),
        false
    );
    for (const plan of planData.R9_WAVE_RUN_PLAN_CATALOG.plans) {
        assert.equal(Object.isFrozen(plan), true);
        for (const wave of plan.waves) {
            const metadata = getWaveRunPlanWaveMetadata(plan, wave.waveOrdinal);
            assert.ok(
                metadata.scheduleDurationTicks
                    <= metadata.resolutionProfile.combatDurationTicks
            );
        }
    }
    assert.equal(
        measureAuthoredWaveScheduleDurationTicks(
            planData.R9_CORRIDOR_PRODUCTION_WAVE_RUN_PLAN.waves[0].waveDefinition
        ),
        156
    );
    assert.equal(
        measureAuthoredWaveScheduleDurationTicks(
            planData.R9_R2_SHOWCASE_PRODUCTION_WAVE_RUN_PLAN.waves[0].waveDefinition
        ),
        50_000
    );
    assert.equal(
        measureAuthoredWaveScheduleDurationTicks(
            planData.R9_PERFORMANCE_PRODUCTION_WAVE_RUN_PLAN.waves[0].waveDefinition
        ),
        10_000
    );
    assert.deepEqual(
        planData.R9_QA_THREE_WAVE_RUN_PLAN.waves.map(({ waveOrdinal }) => waveOrdinal),
        [1, 2, 3]
    );
});

test('WaveRunPlan은 uniqueness/map/profile/duration/frozen authority를 fail-close한다', () => {
    const profile = createProfile();
    const profileById = Object.freeze({ [profile.profileId]: profile });
    const base = {
        planId: 'validation-plan',
        mapId: 'fixture-map',
        waves: [{
            waveOrdinal: 1,
            waveDefinition: createFrozenWave('one'),
            resolutionProfileId: profile.profileId
        }],
        shopAfterEveryWave: true,
        finalContinueResult: WAVE_RUN_FINAL_CONTINUE_RESULT.MAP_CLEAR_READY
    };
    assert.throws(() => createWaveRunPlan({
        ...base,
        waves: [{ ...base.waves[0], waveOrdinal: 2 }]
    }, { resolutionProfileById: profileById }), /contiguous/);
    assert.throws(() => createWaveRunPlan({
        ...base,
        waves: [
            base.waves[0],
            { ...base.waves[0], waveOrdinal: 2 }
        ]
    }, { resolutionProfileById: profileById }), /waveId.*중복/);
    assert.throws(() => createWaveRunPlan({
        ...base,
        waves: [{ ...base.waves[0], waveDefinition: createFrozenWave('one', 'other') }]
    }, { resolutionProfileById: profileById }), /mapId/);
    assert.throws(() => createWaveRunPlan({
        ...base,
        waves: [{ ...base.waves[0], resolutionProfileId: 'missing' }]
    }, { resolutionProfileById: profileById }), /찾을 수 없습니다/);
    const tooShort = createProfile({
        profileId: 'short-profile',
        combatDurationTicks: 1
    });
    const longWave = Object.freeze({
        waveId: 'long',
        mapId: 'fixture-map',
        timeline: Object.freeze([Object.freeze({
            timelineEntryId: 'wait',
            type: 'WAIT',
            durationSeconds: 2 / 60
        })])
    });
    assert.throws(() => createWaveRunPlan({
        ...base,
        waves: [{
            waveOrdinal: 1,
            waveDefinition: longWave,
            resolutionProfileId: tooShort.profileId
        }]
    }, {
        resolutionProfileById: Object.freeze({ [tooShort.profileId]: tooShort })
    }), /초과/);
    const mutableWave = { ...createFrozenWave('mutable') };
    assert.throws(() => createWaveRunPlan({
        ...base,
        waves: [{ ...base.waves[0], waveDefinition: mutableWave }]
    }, { resolutionProfileById: profileById }), /deep-frozen/);
    const plan = createWaveRunPlan(base, { resolutionProfileById: profileById });
    assert.throws(() => createWaveRunPlanCatalog([plan, plan]), /중복/);
});

test('clock은 completed boundary만 한 번 증가하고 pause/backpressure/replay는 0이다', () => {
    const harness = createHarness();
    assert.equal(harness.start().code, WAVE_RUN_RESULT_CODE.ACCEPTED);
    assert.equal(harness.begin().code, WAVE_RUN_RESULT_CODE.ACCEPTED);
    const base = {
        ...harness.waveSource(),
        proposedElapsedCombatTicks: 1,
        completedFixedTick: 1
    };
    const paused = harness.coordinator.observeClockTick({
        transactionId: 'clock-boundary-1',
        ...base,
        completed: true,
        intentionalPause: true
    });
    assert.equal(paused.code, WAVE_RUN_RESULT_CODE.DEFERRED);
    assert.equal(harness.coordinator.getStatus().elapsedCombatTicks, 0);
    const blocked = harness.coordinator.observeClockTick({
        transactionId: 'clock-boundary-1',
        ...base,
        completed: false,
        intentionalPause: false
    });
    assert.equal(blocked.code, WAVE_RUN_RESULT_CODE.DEFERRED);
    const completedRequest = {
        transactionId: 'clock-boundary-1',
        ...base,
        completed: true,
        intentionalPause: false
    };
    const completed = harness.coordinator.observeClockTick(completedRequest);
    assert.equal(completed.code, WAVE_RUN_RESULT_CODE.ACCEPTED);
    assert.equal(harness.coordinator.getStatus().elapsedCombatTicks, 1);
    const replay = harness.coordinator.observeClockTick(completedRequest);
    assert.equal(replay.replayed, true);
    assert.equal(replay.facts.length, 0);
    assert.equal(harness.coordinator.getStatus().elapsedCombatTicks, 1);
    const sameTickDifferentTransaction = harness.coordinator.observeClockTick({
        ...completedRequest,
        transactionId: 'clock-old-boundary'
    });
    assert.equal(sameTickDifferentTransaction.code, WAVE_RUN_RESULT_CODE.DEFERRED);
    const conflict = harness.coordinator.observeClockTick({
        ...completedRequest,
        proposedElapsedCombatTicks: 2,
        completedFixedTick: 2
    });
    assert.equal(conflict.code, WAVE_RUN_RESULT_CODE.TRANSACTION_CONFLICT);
    assert.equal(harness.coordinator.getStatus().elapsedCombatTicks, 1);
});

test('deadline exact boundary는 normal clear 또는 spawn drain/Overtime으로 분기한다', () => {
    const normal = createHarness();
    normal.start();
    normal.begin();
    for (let tick = 1; tick <= 2; tick++) {
        const result = normal.coordinator.observeClockTick({
            transactionId: `normal-clock-${tick}`,
            ...normal.waveSource(),
            proposedElapsedCombatTicks: tick,
            completedFixedTick: tick,
            completed: true,
            intentionalPause: false
        });
        assert.equal(result.code, WAVE_RUN_RESULT_CODE.ACCEPTED);
    }
    assert.equal(normal.coordinator.getStatus().deadlineReached, true);
    assert.equal(
        normal.coordinator.getFacts().filter(
            ({ type }) => type === WAVE_RUN_FACT_TYPE.WAVE_DEADLINE_REACHED
        ).length,
        1
    );
    const clear = normal.coordinator.observeDeadline({
        transactionId: 'normal-deadline',
        ...normal.waveSource(),
        allSpawnsQueued: true,
        remainingSpawnCount: 0,
        blockedSpawnCount: 0,
        hostileActorCount: 0,
        quiescenceProven: true,
        clearProofFingerprint: 77,
        completionRevision: 1
    });
    assert.equal(clear.code, WAVE_RUN_RESULT_CODE.ACCEPTED);
    assert.equal(normal.coordinator.getStatus().state, WAVE_RUN_STATE.CLEAR_CANDIDATE);

    const overtime = createHarness({
        profile: createProfile({ combatDurationTicks: 1 })
    });
    overtime.start();
    overtime.begin();
    overtime.coordinator.observeClockTick({
        transactionId: 'overtime-clock',
        ...overtime.waveSource(),
        proposedElapsedCombatTicks: 1,
        completedFixedTick: 1,
        completed: true,
        intentionalPause: false
    });
    const drain = overtime.coordinator.observeDeadline({
        transactionId: 'overtime-deadline-drain',
        ...overtime.waveSource(),
        allSpawnsQueued: false,
        remainingSpawnCount: 1,
        blockedSpawnCount: 0,
        hostileActorCount: 1,
        quiescenceProven: false,
        clearProofFingerprint: 0,
        completionRevision: 1
    });
    assert.equal(drain.code, WAVE_RUN_RESULT_CODE.ACCEPTED);
    assert.equal(
        overtime.coordinator.getStatus().state,
        WAVE_RUN_STATE.DEADLINE_SPAWN_DRAIN
    );
    const entered = overtime.coordinator.observeDeadline({
        transactionId: 'overtime-deadline-enter',
        ...overtime.waveSource(),
        allSpawnsQueued: true,
        remainingSpawnCount: 0,
        blockedSpawnCount: 0,
        hostileActorCount: 1,
        quiescenceProven: false,
        clearProofFingerprint: 0,
        completionRevision: 1
    });
    assert.equal(entered.code, WAVE_RUN_RESULT_CODE.ACCEPTED);
    assert.equal(overtime.coordinator.getStatus().state, WAVE_RUN_STATE.OVERTIME);
    assert.equal(
        entered.facts[0].type,
        WAVE_RUN_FACT_TYPE.OVERTIME_STARTED
    );
});

test('forbidden transition/old identity/conflict는 state를 변경하지 않는다', () => {
    const harness = createHarness();
    harness.start();
    harness.begin();
    const before = harness.coordinator.getStatus();
    const wrongPhase = harness.coordinator.prepareSettlement({
        transactionId: 'premature-settlement',
        ...harness.waveSource(),
        clearProofFingerprint: 1,
        completionRevision: 1
    });
    assert.equal(wrongPhase.code, WAVE_RUN_RESULT_CODE.WRONG_PHASE);
    const oldWave = harness.coordinator.observeClockTick({
        transactionId: 'old-wave-clock',
        ...harness.waveSource(),
        waveId: 'old-wave',
        proposedElapsedCombatTicks: 1,
        completedFixedTick: 1,
        completed: true,
        intentionalPause: false
    });
    assert.equal(oldWave.code, WAVE_RUN_RESULT_CODE.SOURCE_CHANGED);
    const oldPlan = harness.coordinator.observeClockTick({
        transactionId: 'old-plan-clock',
        ...harness.waveSource(),
        planId: 'old-plan',
        proposedElapsedCombatTicks: 1,
        completedFixedTick: 1,
        completed: true,
        intentionalPause: false
    });
    assert.equal(oldPlan.code, WAVE_RUN_RESULT_CODE.SOURCE_CHANGED);
    assert.equal(harness.coordinator.getStatus().state, before.state);
    assert.equal(harness.coordinator.getStatus().elapsedCombatTicks, 0);
});

test('3-Wave Continue는 same plan next identity를 거쳐 final MAP_CLEAR_READY가 된다', () => {
    const fixture = { plan: planData.R9_QA_THREE_WAVE_RUN_PLAN };
    const harness = createHarness({ fixture, runSessionId: 'r9-qa-run' });
    harness.start();
    harness.begin(1, 100);
    for (let ordinal = 1; ordinal <= 3; ordinal++) {
        assert.equal(harness.clear(ordinal).code, WAVE_RUN_RESULT_CODE.ACCEPTED);
        assert.equal(harness.settle(ordinal).code, WAVE_RUN_RESULT_CODE.ACCEPTED);
        assert.equal(harness.openShop(ordinal).code, WAVE_RUN_RESULT_CODE.ACCEPTED);
        const continued = harness.continueShop(ordinal);
        assert.equal(continued.code, WAVE_RUN_RESULT_CODE.ACCEPTED);
        if (ordinal < 3) {
            assert.equal(
                harness.coordinator.getStatus().state,
                WAVE_RUN_STATE.NEXT_WAVE_PREPARE
            );
            const nextMetadata = getWaveRunPlanWaveMetadata(fixture.plan, ordinal + 1);
            const prepared = harness.coordinator.prepareNextWave({
                transactionId: harness.transaction('next'),
                ...harness.planSource(),
                completedWaveOrdinal: ordinal,
                completedWaveId: harness.coordinator.getStatus().currentWaveId,
                nextWaveOrdinal: ordinal + 1,
                nextWaveId: nextMetadata.waveId,
                completionRevision: ordinal
            });
            assert.equal(prepared.code, WAVE_RUN_RESULT_CODE.ACCEPTED);
            assert.equal(
                harness.begin(ordinal + 1, 100 + ordinal).code,
                WAVE_RUN_RESULT_CODE.ACCEPTED
            );
        }
    }
    const status = harness.coordinator.getStatus();
    assert.equal(status.state, WAVE_RUN_STATE.MAP_CLEAR_READY);
    assert.equal(status.currentWaveOrdinal, 3);
    assert.equal(
        status.facts.filter(({ type }) => type === WAVE_RUN_FACT_TYPE.MAP_CLEAR_READY)
            .length,
        1
    );
});

test('defeat/destroy는 exact terminal seal이며 status/facts는 immutable이다', () => {
    const harness = createHarness();
    harness.start();
    harness.begin();
    const request = {
        transactionId: 'defeat-once',
        ...harness.waveSource(),
        defeatRevision: 1,
        cause: 'CORE_DEPLETED'
    };
    const defeated = harness.coordinator.transitionToDefeated(request);
    assert.equal(defeated.code, WAVE_RUN_RESULT_CODE.ACCEPTED);
    const replay = harness.coordinator.transitionToDefeated(request);
    assert.equal(replay.replayed, true);
    assert.equal(
        harness.coordinator.getFacts().filter(
            ({ type }) => type === WAVE_RUN_FACT_TYPE.WAVE_FAILED
        ).length,
        1
    );
    const status = harness.coordinator.getStatus();
    assert.equal(Object.isFrozen(status), true);
    assert.equal(Object.isFrozen(status.facts), true);
    assert.equal(Object.isFrozen(status.facts[0]), true);
    assert.throws(() => { status.state = 'MUTATED'; }, TypeError);
    assert.throws(() => { status.facts.push({}); }, TypeError);
    harness.coordinator.destroy();
    assert.equal(harness.coordinator.getStatus().state, WAVE_RUN_STATE.DESTROYED);
    const afterDestroy = harness.coordinator.observeClockTick({
        transactionId: 'after-destroy',
        ...harness.waveSource(),
        proposedElapsedCombatTicks: 1,
        completedFixedTick: 1,
        completed: true,
        intentionalPause: false
    });
    assert.equal(afterDestroy.code, WAVE_RUN_RESULT_CODE.DESTROYED);
});

test('R8/Post-R8 source는 Turn 1에 연결되지 않고 WaveDirector completionOwned=false다', async () => {
    const sourceUrls = [
        '../script/module/scene/game/production_game_start_route.js',
        '../script/module/ingame/flow/shop_phase_coordinator.js',
        '../script/module/ingame/contract/r8_fingerprint_contract.js'
    ].map((relative) => new URL(relative, import.meta.url));
    const sources = await Promise.all(sourceUrls.map((url) => readFile(url, 'utf8')));
    for (const source of sources) {
        assert.doesNotMatch(source, /r9_wave|wave_run_coordinator/i);
    }
    const director = new WaveDirector({
        waveDefinition: planData.R9_QA_WAVE_01_DATA
    });
    assert.equal(director.getStatus().completionOwned, false);
    director.destroy();
});

console.log('R9 wave run contracts: ok');
