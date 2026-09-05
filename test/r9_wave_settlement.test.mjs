import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    R8_ALL_UNLOCKED_WORD_DEFINITION_IDS
} = await loadGameModule('data/word/r8_word_shop_catalog_data.js');
const {
    R5_SHOWCASE_SENTENCE_LOADOUT
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    R9_PERFORMANCE_PRODUCTION_WAVE_RUN_PLAN,
    R9_QA_THREE_WAVE_RUN_PLAN
} = await loadGameModule('data/scene/game/r9_wave_run_plan_data.js');
const {
    fingerprintUnlockedWordPool
} = await loadGameModule('ingame/contract/word_shop_contract.js');
const {
    SHOP_RUNTIME_CONFIGURATION_MODE
} = await loadGameModule(
    'ingame/contract/shop_runtime_configuration_contract.js'
);
const {
    ABILITY_SLOT_ID,
    SENTENCE_RUNTIME_PHASE
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    createWaveClearProof,
    createWaveQuiescenceSnapshot
} = await loadGameModule('ingame/contract/wave_quiescence_contract.js');
const {
    getWaveRunPlanFingerprint
} = await loadGameModule('ingame/contract/wave_run_plan_contract.js');
const {
    WAVE_RUN_RESULT_CODE,
    WAVE_RUN_STATE
} = await loadGameModule('ingame/contract/wave_run_state_contract.js');
const {
    SHOP_PHASE_RESULT_CODE,
    SHOP_RUNTIME_PHASE,
    ShopPhaseCoordinator
} = await loadGameModule('ingame/flow/shop_phase_coordinator.js');
const {
    WaveRunCoordinator
} = await loadGameModule('ingame/flow/wave_run_coordinator.js');
const {
    WAVE_SETTLEMENT_FACT_TYPE,
    WAVE_SETTLEMENT_RESULT_CODE,
    WaveSettlementCoordinator,
    createWaveSettlementTransactionId
} = await loadGameModule('ingame/flow/wave_settlement_coordinator.js');
const {
    CoreIntegrity
} = await loadGameModule('ingame/state/core_integrity.js');
const {
    RunCommerceState
} = await loadGameModule('ingame/state/run_commerce_state.js');
const {
    RunOutcome
} = await loadGameModule('ingame/state/run_outcome.js');
const {
    SentenceBoardState
} = await loadGameModule('ingame/word/sentence_board_state.js');
const {
    WordShopSession
} = await loadGameModule('ingame/word/word_shop_session.js');
const {
    WordSystem
} = await loadGameModule('ingame/word/word_system.js');

function createSnapshot(harness, overrides = {}) {
    const view = harness.waveRun.getSettlementView();
    const liveHostileActorCount = overrides.liveHostileActorCount ?? 0;
    const pendingHostileActorCount
        = overrides.pendingHostileActorCount ?? 0;
    const totalSpawnCount = overrides.totalSpawnCount ?? 1;
    const remainingSpawnCount = overrides.remainingSpawnCount ?? 0;
    return createWaveQuiescenceSnapshot({
        snapshotRevision: overrides.snapshotRevision ?? 10,
        fixedTick: overrides.fixedTick ?? 10,
        protocol: {
            sessionGeneration: overrides.sessionGeneration ?? 1,
            deviceGeneration: overrides.deviceGeneration ?? 2,
            authoritativeEpoch: overrides.authoritativeEpoch ?? 3
        },
        wave: {
            mapId: view.mapId,
            waveId: view.waveId,
            waveOrdinal: view.waveOrdinal,
            initialized: true,
            totalSpawnCount,
            queuedSpawnCount: totalSpawnCount - remainingSpawnCount,
            remainingSpawnCount,
            blockedSpawnCount: overrides.blockedSpawnCount ?? 0,
            allSpawnsQueued: overrides.allSpawnsQueued ?? true,
            completionOwned: false
        },
        hostile: {
            revision: overrides.hostileRevision
                ?? overrides.snapshotRevision
                ?? 10,
            registryRevision: overrides.trackerRegistryRevision ?? 20,
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
            lifecycleCommandCount: 0,
            materializationWorkCount: 0,
            transitActorCount: 0,
            atomicTransformWorkCount: 0
        },
        events: {
            lastSubmittedTick: overrides.eventTick ?? 8,
            lastCompletedTick: overrides.eventTick ?? 8,
            completedThroughTick: overrides.eventTick ?? 8,
            deferredBatchCount: 0,
            protocolFailure: false
        },
        registryRevision: overrides.registryRevision ?? 20,
        run: {
            running: overrides.running ?? true,
            defeated: overrides.defeated ?? false,
            coreDepleted: overrides.coreDepleted ?? false,
            recoveryRequired: overrides.recoveryRequired ?? false
        }
    });
}

function createHarness(options = {}) {
    const plan = options.plan ?? R9_QA_THREE_WAVE_RUN_PLAN;
    const runSessionId = options.runSessionId
        ?? `run.r9.settlement.${plan.planId}`;
    const commerce = new RunCommerceState({
        runSessionId,
        initialGold: options.initialGold ?? 11
    });
    const wordSystem = new WordSystem({
        loadout: R5_SHOWCASE_SENTENCE_LOADOUT
    });
    const board = new SentenceBoardState({
        inventory: commerce.inventory,
        wordSystem
    });
    const shopMode = options.shopMode
        ?? SHOP_RUNTIME_CONFIGURATION_MODE.PRODUCTION;
    const shopPool = options.shopPool
        ?? R8_ALL_UNLOCKED_WORD_DEFINITION_IDS;
    const shopOptions = shopMode === SHOP_RUNTIME_CONFIGURATION_MODE.DISABLED
        ? {
            commerceState: commerce,
            runtimeMode: shopMode
        }
        : {
            commerceState: commerce,
            runtimeMode: shopMode,
            runSeed: options.runSeed ?? 0x9a24_0001,
            unlockedWordDefinitionIds: shopPool,
            unlockedPoolFingerprint: fingerprintUnlockedWordPool(shopPool),
            allowEconomicallyRedundantOffers:
                shopMode === SHOP_RUNTIME_CONFIGURATION_MODE.QA
        };
    const shop = new WordShopSession(shopOptions);
    const safe = {
        fixedTick: 10,
        wordActivationCount: 0,
        abilityExecutionCount: 0,
        towerCreationPendingCount: 0,
        towerMergePendingCount: 0,
        actorMaterializationPendingCount: 0,
        actorTransitActiveCount: 0,
        commercePendingCount: 0,
        endpointPendingFixedTick: 0,
        wavePendingSpawnCount: 0,
        endpointRecoveryRequired: false,
        recoveryProbationState: 'IDLE',
        runDefeated: false
    };
    const shopPhase = new ShopPhaseCoordinator({
        wordSystem,
        shopSession: shop,
        sentenceBoard: board,
        commerceState: commerce,
        safeBoundaryPort: {
            getSnapshot() {
                return safe;
            }
        },
        shopRuntimeMode: shopMode,
        shopConfigured: shopMode
            !== SHOP_RUNTIME_CONFIGURATION_MODE.DISABLED
    });
    const waveRun = new WaveRunCoordinator({ plan, runSessionId });
    assert.equal(waveRun.startPlan({
        transactionId: `${runSessionId}:start`,
        runSessionId,
        planId: plan.planId,
        planFingerprint: getWaveRunPlanFingerprint(plan)
    }).code, WAVE_RUN_RESULT_CODE.ACCEPTED);
    assert.equal(waveRun.beginWave({
        transactionId: `${runSessionId}:begin:1`,
        runSessionId,
        planId: plan.planId,
        waveOrdinal: 1,
        waveId: plan.waves[0].waveDefinition.waveId,
        startingFixedTick: 0
    }).code, WAVE_RUN_RESULT_CODE.ACCEPTED);
    const core = new CoreIntegrity({ maxIntegrity: 100 });
    const runOutcome = new RunOutcome();
    const pressureState = {
        overtimePulseOrdinal: options.overtimePulseOrdinal ?? 0,
        overtimeDamageTotalFixedPoint:
            options.overtimeDamageTotalFixedPoint ?? 0,
        recoveryRequired: options.pressureRecoveryRequired === true
    };
    const pressure = {
        getStatus() {
            return Object.freeze({ ...pressureState });
        },
        requiresRecovery() {
            return pressureState.recoveryRequired;
        }
    };
    const warmGate = {
        approved: options.warmExposureApproved !== false,
        isApproved() {
            return this.approved;
        }
    };
    const settlement = new WaveSettlementCoordinator({
        waveRunCoordinator: waveRun,
        commerceState: commerce,
        shopPhaseCoordinator: shopPhase,
        coreIntegrity: core,
        runOutcome,
        overtimePressureDirector: pressure,
        warmExposureGate: warmGate,
        qaRuntimeAuthorized:
            shopMode === SHOP_RUNTIME_CONFIGURATION_MODE.QA,
        failureInjector: options.failureInjector,
        factHistoryCapacity: options.factHistoryCapacity ?? 32,
        transactionHistoryCapacity:
            options.transactionHistoryCapacity ?? 16
    });
    return {
        plan,
        runSessionId,
        commerce,
        wordSystem,
        board,
        shop,
        safe,
        shopPhase,
        waveRun,
        core,
        runOutcome,
        pressureState,
        warmGate,
        settlement
    };
}

function acceptClear(harness, overrides = {}) {
    const snapshot = createSnapshot(harness, overrides);
    const evaluation = harness.waveRun.evaluateWaveQuiescence(snapshot);
    assert.equal(evaluation.accepted, true);
    assert.equal(evaluation.clearCandidateAccepted, true);
    assert.equal(harness.waveRun.getSettlementView().state,
        WAVE_RUN_STATE.CLEAR_CANDIDATE);
    return snapshot;
}

function createSettlementRequest(harness, snapshot, overrides = {}) {
    const proof = createWaveClearProof(snapshot).proof;
    const view = harness.waveRun.getSettlementView();
    return {
        transactionId: createWaveSettlementTransactionId({
            runSessionId: view.runSessionId,
            mapId: view.mapId,
            waveOrdinal: view.waveOrdinal,
            waveId: view.waveId,
            completionRevision: proof.completionRevision
        }),
        quiescenceSnapshot: snapshot,
        fixedTick: snapshot.fixedTick,
        expectedCommerceRevision: harness.commerce.getRevision(),
        waveStatistics: {
            authoredSpawnCount: snapshot.wave.totalSpawnCount
        },
        ...overrides
    };
}

function finishShopOpen(harness) {
    const phaseReceipt = harness.shopPhase.progressOpening();
    assert.equal(phaseReceipt.code, SHOP_PHASE_RESULT_CODE.OPENED);
    const settlementReceipt = harness.settlement.observeShopOpening();
    assert.equal(settlementReceipt.code, WAVE_SETTLEMENT_RESULT_CODE.OPENED);
    return settlementReceipt;
}

test('normal clear는 bonus와 settlement/Shop facts를 exact once commit한다', () => {
    const harness = createHarness();
    const snapshot = acceptClear(harness);
    harness.wordSystem.beginFixedTick(snapshot.fixedTick);
    const activation = harness.wordSystem.requestSlotActivation(
        ABILITY_SLOT_ID.Q,
        { targetFixedTick: snapshot.fixedTick }
    );
    assert.equal(activation.accepted, true);
    assert.equal(harness.wordSystem.getStatusView().pendingActivationCount, 1);
    const request = createSettlementRequest(harness, snapshot);
    const requested = harness.settlement.commitSettlement(request);
    assert.equal(requested.code, WAVE_SETTLEMENT_RESULT_CODE.OPEN_REQUESTED);
    assert.equal(harness.commerce.getBalance(), 16);
    assert.equal(harness.commerce.getGoldStatus().creditCount, 1);
    assert.equal(harness.shopPhase.getPhase(), SHOP_RUNTIME_PHASE.SHOP_OPENING);
    assert.equal(harness.wordSystem.getStatusView().pendingActivationCount, 0);
    assert.equal(harness.wordSystem.getStatusView().phase,
        SENTENCE_RUNTIME_PHASE.PAUSE);

    const opened = finishShopOpen(harness);
    assert.equal(harness.waveRun.getSettlementView().state, WAVE_RUN_STATE.SHOP);
    assert.equal(harness.shop.getStatus().openCount, 1);
    assert.equal(harness.wordSystem.getStatusView().phase,
        SENTENCE_RUNTIME_PHASE.SHOP);
    assert.equal(opened.settlementReceipt.clearType, 'NORMAL');
    assert.equal(opened.settlementReceipt.completionGoldBonus, 5);
    const factTypes = harness.settlement.getFacts().map((fact) => fact.type);
    assert.deepEqual(factTypes, [
        WAVE_SETTLEMENT_FACT_TYPE.WAVE_COMPLETED,
        WAVE_SETTLEMENT_FACT_TYPE.WAVE_SETTLEMENT_COMMITTED,
        WAVE_SETTLEMENT_FACT_TYPE.SHOP_OPEN_REQUESTED,
        WAVE_SETTLEMENT_FACT_TYPE.SHOP_OPENED
    ]);

    const replay = harness.settlement.commitSettlement(request);
    assert.equal(replay.code, WAVE_SETTLEMENT_RESULT_CODE.OPENED);
    assert.equal(replay.replayed, true);
    assert.equal(harness.commerce.getGoldStatus().creditCount, 1);
    assert.equal(harness.shop.getStatus().openCount, 1);
    assert.equal(harness.settlement.getStatus().commitCount, 1);
    assert.equal(harness.settlement.getStatus().openCount, 1);

    const conflict = harness.settlement.commitSettlement({
        ...request,
        waveStatistics: { authoredSpawnCount: 999 }
    });
    assert.equal(conflict.code,
        WAVE_SETTLEMENT_RESULT_CODE.TRANSACTION_CONFLICT);
    assert.equal(harness.commerce.getGoldStatus().creditCount, 1);
});

test('Overtime clear는 pulse ordinal과 누적 fixed-point damage를 영수증에 고정한다', () => {
    const harness = createHarness({
        overtimePulseOrdinal: 3,
        overtimeDamageTotalFixedPoint: 7_500
    });
    const duration = harness.waveRun.getStatus().combatDurationTicks;
    for (let elapsed = 1; elapsed <= duration; elapsed++) {
        const receipt = harness.waveRun.observeClockTick({
            transactionId: `overtime-clock:${elapsed}`,
            runSessionId: harness.runSessionId,
            planId: harness.plan.planId,
            waveOrdinal: 1,
            waveId: harness.plan.waves[0].waveDefinition.waveId,
            proposedElapsedCombatTicks: elapsed,
            completedFixedTick: elapsed,
            intentionalPause: false,
            completed: true
        });
        assert.equal(receipt.code, WAVE_RUN_RESULT_CODE.ACCEPTED);
    }
    const overtimeSnapshot = createSnapshot(harness, {
        snapshotRevision: duration + 1,
        fixedTick: duration + 1,
        liveHostileActorCount: 1
    });
    assert.equal(
        harness.waveRun.evaluateWaveQuiescence(overtimeSnapshot).accepted,
        true
    );
    assert.equal(harness.waveRun.getSettlementView().state,
        WAVE_RUN_STATE.OVERTIME);
    const clear = acceptClear(harness, {
        snapshotRevision: duration + 2,
        fixedTick: duration + 2
    });
    harness.safe.fixedTick = clear.fixedTick;
    const requested = harness.settlement.commitSettlement(
        createSettlementRequest(harness, clear)
    );
    assert.equal(requested.code, WAVE_SETTLEMENT_RESULT_CODE.OPEN_REQUESTED);
    const opened = finishShopOpen(harness);
    assert.equal(opened.settlementReceipt.clearType, 'OVERTIME');
    assert.equal(opened.settlementReceipt.overtimePulseCount, 3);
    assert.equal(opened.settlementReceipt.overtimeDamageTotalFixedPoint, 7_500);
});

test('completion bonus 0도 별도 credit transaction을 exact once 기록한다', () => {
    const harness = createHarness({
        plan: R9_PERFORMANCE_PRODUCTION_WAVE_RUN_PLAN,
        initialGold: 9
    });
    const snapshot = acceptClear(harness);
    const beforeRevision = harness.commerce.getRevision();
    const requested = harness.settlement.commitSettlement(
        createSettlementRequest(harness, snapshot)
    );
    assert.equal(requested.code, WAVE_SETTLEMENT_RESULT_CODE.OPEN_REQUESTED);
    assert.equal(harness.commerce.getBalance(), 9);
    assert.equal(harness.commerce.getGoldStatus().creditCount, 1);
    assert.equal(harness.commerce.getRevision(), beforeRevision + 1);
    assert.equal(requested.settlementReceipt.completionGoldBonus, 0);
});

test('production pool/runtime/warm exposure preflight 실패는 reward와 Shop을 모두 0으로 막는다', () => {
    const cases = [
        {
            name: 'meaningful-pool-insufficient',
            options: {
                shopPool: R8_ALL_UNLOCKED_WORD_DEFINITION_IDS.slice(0, 4)
            }
        },
        {
            name: 'runtime-disabled',
            options: {
                shopMode: SHOP_RUNTIME_CONFIGURATION_MODE.DISABLED
            }
        },
        {
            name: 'warm-exposure-partial',
            options: { warmExposureApproved: false }
        }
    ];
    for (const definition of cases) {
        const harness = createHarness(definition.options);
        const snapshot = acceptClear(harness);
        const result = harness.settlement.commitSettlement(
            createSettlementRequest(harness, snapshot)
        );
        assert.equal(result.code,
            WAVE_SETTLEMENT_RESULT_CODE.SETTLEMENT_BLOCKED,
        definition.name);
        assert.equal(result.rewardPublished, false, definition.name);
        assert.equal(harness.commerce.getGoldStatus().creditCount, 0,
            definition.name);
        assert.equal(harness.shop.getStatus().openCount, 0, definition.name);
        assert.equal(harness.shopPhase.getPhase(), SHOP_RUNTIME_PHASE.COMBAT,
            definition.name);
        assert.equal(harness.waveRun.getSettlementView().state,
            WAVE_RUN_STATE.CLEAR_CANDIDATE, definition.name);
    }
});

test('commerce drift는 reward 전에는 mutation 0, reward 뒤에는 durable bonus를 보존하고 Shop을 막는다', () => {
    const before = createHarness();
    const beforeSnapshot = acceptClear(before);
    const staleRequest = createSettlementRequest(before, beforeSnapshot);
    before.commerce.credit({
        transactionId: 'external-before-settlement',
        amount: 1,
        fixedTick: beforeSnapshot.fixedTick,
        sourceKind: 'TEST_EXTERNAL'
    });
    const stale = before.settlement.commitSettlement(staleRequest);
    assert.equal(stale.code, WAVE_SETTLEMENT_RESULT_CODE.SOURCE_CHANGED);
    assert.equal(before.commerce.getGoldStatus().creditCount, 1);
    assert.equal(before.shop.getStatus().openCount, 0);

    const after = createHarness();
    const afterSnapshot = acceptClear(after);
    after.safe.endpointPendingFixedTick = 1;
    const requested = after.settlement.commitSettlement(
        createSettlementRequest(after, afterSnapshot)
    );
    assert.equal(requested.code, WAVE_SETTLEMENT_RESULT_CODE.OPEN_REQUESTED);
    assert.equal(after.shopPhase.progressOpening().code,
        SHOP_PHASE_RESULT_CODE.OPEN_DEFERRED);
    assert.equal(after.settlement.observeShopOpening().code,
        WAVE_SETTLEMENT_RESULT_CODE.OPEN_DEFERRED);
    after.commerce.credit({
        transactionId: 'external-after-reward',
        amount: 1,
        fixedTick: afterSnapshot.fixedTick,
        sourceKind: 'TEST_EXTERNAL'
    });
    after.safe.endpointPendingFixedTick = 0;
    assert.equal(after.shopPhase.progressOpening().code,
        SHOP_PHASE_RESULT_CODE.OPEN_REJECTED);
    const blocked = after.settlement.observeShopOpening();
    assert.equal(blocked.code,
        WAVE_SETTLEMENT_RESULT_CODE.SETTLEMENT_BLOCKED);
    assert.equal(blocked.rewardPublished, true);
    assert.equal(blocked.rewardPublicationPolicy,
        'PUBLISHED_DURABLE_NO_ROLLBACK');
    assert.equal(after.commerce.getGoldStatus().creditCount, 2);
    assert.equal(after.shop.getStatus().openCount, 0);
});

test('Shop open이 100 boundary 지연돼도 settlement/reward/open은 exact once다', () => {
    const harness = createHarness();
    const snapshot = acceptClear(harness);
    harness.safe.endpointPendingFixedTick = 1;
    const requested = harness.settlement.commitSettlement(
        createSettlementRequest(harness, snapshot)
    );
    assert.equal(requested.code,
        WAVE_SETTLEMENT_RESULT_CODE.OPEN_REQUESTED);
    for (let boundary = 1; boundary <= 100; boundary++) {
        assert.equal(
            harness.shopPhase.progressOpening().code,
            SHOP_PHASE_RESULT_CODE.OPEN_DEFERRED,
            `boundary=${boundary}`
        );
        assert.equal(
            harness.settlement.observeShopOpening().code,
            WAVE_SETTLEMENT_RESULT_CODE.OPEN_DEFERRED,
            `boundary=${boundary}`
        );
        assert.equal(harness.commerce.getGoldStatus().creditCount, 1);
        assert.equal(harness.shop.getStatus().openCount, 0);
    }
    harness.safe.endpointPendingFixedTick = 0;
    finishShopOpen(harness);
    const status = harness.settlement.getStatus();
    assert.equal(status.commitCount, 1);
    assert.equal(status.openRequestCount, 1);
    assert.equal(status.openCount, 1);
    assert.equal(harness.commerce.getGoldStatus().creditCount, 1);
    assert.equal(harness.shop.getStatus().openCount, 1);
});

test('reward 전/후 recovery 재시도는 같은 settlement를 이어서 열고 bonus를 중복하지 않는다', () => {
    for (const failureStage of ['before-reward', 'after-reward']) {
        let remainingFailureCount = 1;
        const harness = createHarness({
            failureInjector(stage) {
                if (stage === failureStage && remainingFailureCount > 0) {
                    remainingFailureCount--;
                    throw new Error(`injected:${stage}`);
                }
            }
        });
        const snapshot = acceptClear(harness);
        const request = createSettlementRequest(harness, snapshot);
        const interrupted = harness.settlement.commitSettlement(request);
        assert.equal(interrupted.code,
            WAVE_SETTLEMENT_RESULT_CODE.RECOVERY_REQUIRED,
        failureStage);
        assert.equal(harness.shop.getStatus().openCount, 0, failureStage);
        const expectedCredits = failureStage === 'after-reward' ? 1 : 0;
        assert.equal(harness.commerce.getGoldStatus().creditCount,
            expectedCredits, failureStage);

        const resumed = harness.settlement.commitSettlement(request);
        assert.equal(resumed.code,
            WAVE_SETTLEMENT_RESULT_CODE.OPEN_REQUESTED,
        failureStage);
        assert.equal(harness.commerce.getGoldStatus().creditCount, 1,
            failureStage);
        finishShopOpen(harness);
        assert.equal(harness.shop.getStatus().openCount, 1, failureStage);
        assert.equal(harness.settlement.getStatus().commitCount, 1,
            failureStage);
    }
});

test('Core depletion race에서는 defeat가 clear보다 우선하고 completion/reward/Shop은 0이다', () => {
    const harness = createHarness();
    const snapshot = acceptClear(harness);
    harness.core.applyIntegrityDamage(100);
    harness.runOutcome.transitionToDefeated({
        fixedTick: snapshot.fixedTick,
        sourceType: 'CoreDepleted',
        sourceEventKey: 'test-core-depleted'
    });
    harness.waveRun.transitionToDefeated({
        transactionId: 'test-wave-defeated',
        runSessionId: harness.runSessionId,
        planId: harness.plan.planId,
        waveOrdinal: 1,
        waveId: harness.plan.waves[0].waveDefinition.waveId,
        defeatRevision: 1,
        cause: 'CoreDepleted'
    });
    const result = harness.settlement.commitSettlement(
        createSettlementRequest(harness, snapshot)
    );
    assert.equal(result.code, WAVE_SETTLEMENT_RESULT_CODE.RUN_DEFEATED);
    assert.equal(harness.commerce.getGoldStatus().creditCount, 0);
    assert.equal(harness.shop.getStatus().openCount, 0);
    assert.equal(harness.waveRun.getFacts().filter(
        (fact) => fact.type === WAVE_SETTLEMENT_FACT_TYPE.WAVE_COMPLETED
    ).length, 0);
});

test('settlement status/facts는 bounded immutable이고 production seam만 사용한다', async () => {
    const harness = createHarness({ factHistoryCapacity: 4 });
    const snapshot = acceptClear(harness);
    harness.settlement.commitSettlement(
        createSettlementRequest(harness, snapshot)
    );
    finishShopOpen(harness);
    const status = harness.settlement.getStatus();
    assert.equal(Object.isFrozen(status), true);
    assert.equal(Object.isFrozen(status.facts), true);
    assert.equal(status.facts.length, 4);
    assert.throws(() => { status.commitCount = 99; }, TypeError);

    const source = await readFile(
        new URL(
            '../project/game/script/module/ingame/flow/wave_settlement_coordinator.js',
            import.meta.url
        ),
        'utf8'
    );
    assert.match(source, /createWaveSettlementShopOpenRequest/u);
    assert.match(source, /shopPhase\.preflightOpen/u);
    assert.match(source, /shopPhase\.requestOpen/u);
    assert.doesNotMatch(source, /wordShopSession\.open|shopSession\.open/u);
    const waveDirectorSource = await readFile(
        new URL(
            '../project/game/script/module/ingame/flow/wave_director.js',
            import.meta.url
        ),
        'utf8'
    );
    assert.match(waveDirectorSource, /completionOwned:\s*false/u);
    assert.doesNotMatch(waveDirectorSource, /completionGoldBonus|requestOpen/u);
});
