import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    R3_TOWER_WORD_INSTANCE,
    R5_SHOWCASE_SENTENCE_LOADOUT,
    R6_QA_SENTENCE_LOADOUT,
    R7_QA_SENTENCE_LOADOUT
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
    R8_WORD_SHOP_BALANCE
} = await loadGameModule('data/word/r8_word_shop_catalog_data.js');
const {
    SHOP_OPEN_SOURCE_KIND,
    SHOP_PHASE_RESULT_CODE,
    SHOP_RUNTIME_PHASE,
    ShopPhaseCoordinator,
    createWaveSettlementShopOpenRequest
} = await loadGameModule('ingame/flow/shop_phase_coordinator.js');
const {
    ABILITY_SLOT_ID,
    SENTENCE_RUNTIME_PHASE,
    WORD_DEFINITION_ID
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    fingerprintUnlockedWordPool
} = await loadGameModule('ingame/contract/word_shop_contract.js');
const {
    SHOP_RUNTIME_CONFIGURATION_MODE
} = await loadGameModule(
    'ingame/contract/shop_runtime_configuration_contract.js'
);
const {
    FIXED_STEP_RESULT
} = await loadGameModule('simulation/fixed_step_result_contract.js');
const {
    GameSystem
} = await loadGameModule('ingame/game_system.js');
const {
    RunCommerceState
} = await loadGameModule('ingame/state/run_commerce_state.js');
const {
    SentenceBoardState
} = await loadGameModule('ingame/word/sentence_board_state.js');
const {
    WordShopSession
} = await loadGameModule('ingame/word/word_shop_session.js');
const {
    WordSystem
} = await loadGameModule('ingame/word/word_system.js');
const {
    createProductionGameStartOptions,
    createProductionShopGameStartOptions,
    createR6QaGameStartOptions,
    createR7QaGameStartOptions,
    createR8QaGameStartOptions,
    isR8QaLaunchRequested,
    PRODUCTION_STAGE_ONE_SELECTION_MAP_ID,
    R8_QA_LAUNCH_ARGUMENT
} = await loadGameModule('scene/game/production_game_start_route.js');

const FIVE_OFFER_POOL = Object.freeze([
    WORD_DEFINITION_ID.TOWER,
    WORD_DEFINITION_ID.ENEMY,
    WORD_DEFINITION_ID.SHOOT,
    WORD_DEFINITION_ID.MERGE,
    WORD_DEFINITION_ID.TWICE
]);

function createCoordinatorHarness(options = {}) {
    const commerce = new RunCommerceState({
        runSessionId: 'run.phase.coordinator',
        initialGold: 100
    });
    const wordSystem = new WordSystem({
        loadout: R5_SHOWCASE_SENTENCE_LOADOUT
    });
    const board = new SentenceBoardState({
        inventory: commerce.inventory,
        wordSystem
    });
    const shop = new WordShopSession({
        commerceState: commerce,
        runtimeMode: SHOP_RUNTIME_CONFIGURATION_MODE.QA,
        runSeed: 101,
        unlockedWordDefinitionIds: FIVE_OFFER_POOL,
        unlockedPoolFingerprint: fingerprintUnlockedWordPool(FIVE_OFFER_POOL),
        allowEconomicallyRedundantOffers: true
    });
    const safe = {
        fixedTick: 0,
        wordActivationCount: 1,
        abilityExecutionCount: 1,
        towerCreationPendingCount: 1,
        towerMergePendingCount: 1,
        actorMaterializationPendingCount: 1,
        actorTransitActiveCount: 1,
        commercePendingCount: 0,
        endpointPendingFixedTick: 1,
        wavePendingSpawnCount: 1,
        endpointRecoveryRequired: true,
        recoveryProbationState: 'PENDING',
        runDefeated: false,
        activeBodyCount: 10000
    };
    let synchronizeCount = 0;
    let synchronizeFailureCount = 0;
    const coordinator = new ShopPhaseCoordinator({
        wordSystem,
        shopSession: shop,
        sentenceBoard: board,
        commerceState: commerce,
        safeBoundaryPort: {
            getSnapshot() {
                return safe;
            }
        },
        presentationPort: {
            synchronize() {
                synchronizeCount++;
                if (synchronizeFailureCount > 0) {
                    synchronizeFailureCount--;
                    throw new Error('injected:presentation-synchronize');
                }
            }
        },
        failureInjector: options.failureInjector
    });
    return {
        commerce,
        wordSystem,
        board,
        shop,
        safe,
        coordinator,
        getSynchronizeCount: () => synchronizeCount,
        failNextSynchronize() {
            synchronizeFailureCount++;
        }
    };
}

function openRequest(overrides = {}) {
    return {
        sourceKind: SHOP_OPEN_SOURCE_KIND.QA_EXPLICIT,
        sourceId: 'test.explicit-open',
        settlementOrdinal: 1,
        transactionId: 'shop.phase.open.1',
        minimumFixedTick: 1,
        ...overrides
    };
}

function shopAction(shop, overrides = {}) {
    const status = shop.getStatus();
    return {
        transactionId: 'shop.phase.action.1',
        rowFingerprint: status.row.rowFingerprint,
        expectedCommerceRevision: status.commerceRevision,
        expectedInventoryRevision: status.inventoryRevision,
        ...overrides
    };
}

function clearSafeBlockers(safe) {
    Object.assign(safe, {
        fixedTick: 1,
        wordActivationCount: 0,
        abilityExecutionCount: 0,
        towerCreationPendingCount: 0,
        towerMergePendingCount: 0,
        actorMaterializationPendingCount: 0,
        actorTransitActiveCount: 0,
        endpointPendingFixedTick: 0,
        wavePendingSpawnCount: 0,
        endpointRecoveryRequired: false,
        recoveryProbationState: 'PASSED'
    });
}

test('SHOP_OPENING은 모든 safe-boundary blocker를 defer하고 ordinary body pressure는 무시한다', () => {
    const harness = createCoordinatorHarness();
    const requested = harness.coordinator.requestOpen(openRequest());
    assert.equal(requested.code, SHOP_PHASE_RESULT_CODE.OPEN_REQUESTED);
    assert.equal(harness.coordinator.getPhase(), SHOP_RUNTIME_PHASE.SHOP_OPENING);

    const deferred = harness.coordinator.progressOpening();
    assert.equal(deferred.code, SHOP_PHASE_RESULT_CODE.OPEN_DEFERRED);
    assert.deepEqual(deferred.blockers, [
        'MINIMUM_FIXED_TICK',
        'WORD_ACTIVATION',
        'ABILITY_EXECUTION',
        'TOWER_CREATION',
        'TOWER_MERGE',
        'ACTOR_MATERIALIZATION',
        'ACTOR_TRANSIT',
        'ENDPOINT_FIXED_READBACK',
        'WAVE_QUEUE',
        'ENDPOINT_RECOVERY',
        'RECOVERY_PROBATION'
    ]);

    clearSafeBlockers(harness.safe);
    const opened = harness.coordinator.progressOpening();
    assert.equal(opened.code, SHOP_PHASE_RESULT_CODE.OPENED);
    assert.equal(harness.coordinator.getPhase(), SHOP_RUNTIME_PHASE.SHOP);
    assert.equal(
        harness.wordSystem.getStatusView().phase,
        SENTENCE_RUNTIME_PHASE.SHOP
    );
    assert.equal(harness.getSynchronizeCount(), 1);
    assert.strictEqual(
        harness.coordinator.requestOpen(openRequest()),
        opened
    );
});

test('Shop에서 buy/reroll/upgrade/edit 후 draft를 닫아야 Continue가 COMBAT을 복원한다', () => {
    const harness = createCoordinatorHarness();
    harness.coordinator.requestOpen(openRequest());
    clearSafeBlockers(harness.safe);
    harness.coordinator.progressOpening();

    const twiceOffer = harness.shop.getStatus().row.offers.find(
        ({ definitionId }) => definitionId === WORD_DEFINITION_ID.TWICE
    );
    const purchased = harness.shop.purchaseOffer(shopAction(harness.shop, {
        transactionId: 'shop.phase.purchase.twice',
        offerId: twiceOffer.offerId
    }));
    const twiceId = purchased.commerceReceipt.inventoryReceipt.instance.instanceId;
    const rerolled = harness.shop.reroll(shopAction(harness.shop, {
        transactionId: 'shop.phase.reroll.1'
    }));
    assert.equal(rerolled.accepted, true);
    const upgraded = harness.shop.upgradeOwnedWord(shopAction(harness.shop, {
        transactionId: 'shop.phase.upgrade.twice',
        instanceId: twiceId
    }));
    assert.equal(upgraded.accepted, true);

    harness.board.beginDraft();
    harness.board.addModifier(ABILITY_SLOT_ID.Q, twiceId);
    const boardCommit = harness.board.commitDraft({
        transactionId: 'shop.phase.board.commit.1'
    });
    assert.equal(boardCommit.accepted, true);
    assert.equal(harness.board.getStatus().draftSlots, null);

    harness.board.beginDraft();
    const blocked = harness.coordinator.requestContinue({
        transactionId: 'shop.phase.continue.blocked'
    });
    assert.equal(
        blocked.code,
        SHOP_PHASE_RESULT_CODE.CONTINUE_BLOCKED_DRAFT
    );
    harness.board.discardDraft();
    const closeRequested = harness.coordinator.requestContinue({
        transactionId: 'shop.phase.continue.1'
    });
    assert.equal(closeRequested.code, SHOP_PHASE_RESULT_CODE.CLOSE_REQUESTED);
    assert.equal(
        harness.coordinator.getPhase(),
        SHOP_RUNTIME_PHASE.SHOP_CLOSING
    );
    const closed = harness.coordinator.progressClosing();
    assert.equal(closed.code, SHOP_PHASE_RESULT_CODE.CLOSED);
    assert.equal(harness.coordinator.getPhase(), SHOP_RUNTIME_PHASE.COMBAT);
    assert.equal(
        harness.wordSystem.getStatusView().phase,
        SENTENCE_RUNTIME_PHASE.COMBAT
    );
    assert.equal(harness.getSynchronizeCount(), 2);
    assert.equal(harness.shop.getStatus().active, false);
});

test('inventory drift와 pending commerce는 Continue에서 mutation 전에 분리된다', () => {
    const harness = createCoordinatorHarness();
    harness.coordinator.requestOpen(openRequest());
    clearSafeBlockers(harness.safe);
    harness.coordinator.progressOpening();
    harness.commerce.inventory.acquire({
        transactionId: 'shop.phase.external.acquire',
        definitionId: WORD_DEFINITION_ID.TWICE,
        acquiredShopSessionOrdinal: 1,
        expectedRevision: harness.commerce.inventory.getRevision()
    });
    const drift = harness.coordinator.requestContinue({
        transactionId: 'shop.phase.continue.drift'
    });
    assert.equal(drift.code, SHOP_PHASE_RESULT_CODE.CONTINUE_BLOCKED_BOARD);
    assert.equal(harness.coordinator.getPhase(), SHOP_RUNTIME_PHASE.SHOP);

    const originalGetStatus = harness.commerce.getStatus.bind(harness.commerce);
    harness.commerce.getStatus = () => Object.freeze({
        ...originalGetStatus(),
        pendingTransactionCount: 1
    });
    const commercePending = harness.coordinator.requestContinue({
        transactionId: 'shop.phase.continue.commerce-pending'
    });
    assert.equal(
        commercePending.code,
        SHOP_PHASE_RESULT_CODE.CONTINUE_BLOCKED_COMMERCE
    );
});

function createGameSystemDependencies() {
    const keys = Object.create(null);
    const drawCounts = { circles: 0, squares: 0 };
    const wheelTotals = { x: 0, y: 0 };
    const uiFrameDeltas = [];
    return {
        keys,
        drawCounts,
        uiFrameDeltas,
        dependencies: {
            inputActionSource: {
                isPressed(key) {
                    return keys[key] === true;
                },
                getPointerPosition(out) {
                    out.x = 0;
                    out.y = 0;
                    return out;
                },
                isPrimaryPointerPressed() {
                    return false;
                },
                getWheelTotals(out) {
                    Object.assign(out, wheelTotals);
                    return out;
                }
            },
            animationPort: {
                animate() {
                    return {
                        promise: Promise.resolve(),
                        retarget() { return true; },
                        remove() {},
                        isActive() { return true; }
                    };
                }
            },
            timePort: {
                getDelta() { return 1 / 120; },
                getFixedDelta() { return 1 / 60; },
                getFixedInterpolationAlpha() { return 0.5; }
            },
            viewportPort: {
                getSnapshot(out) {
                    Object.assign(out, {
                        ww: 1280,
                        wh: 720,
                        uiww: 1280,
                        uiOffsetX: 0,
                        uiScale: 1
                    });
                    return out;
                }
            },
            worldRenderPort: {
                drawCircle() { drawCounts.circles++; },
                drawSquareInstances() { drawCounts.squares++; }
            },
            gameplayStatusRenderPort: {
                update(status, viewport, frameDelta) {
                    uiFrameDeltas.push(frameDelta);
                },
                draw() {}
            }
        }
    };
}

test('GameSystem SHOP은 fixed/control/GPU submit을 얼리고 update/draw는 계속하며 exact next tick으로 복귀한다', () => {
    const harness = createGameSystemDependencies();
    const gameSystem = new GameSystem(harness.dependencies, {
        initialGold: R8_WORD_SHOP_BALANCE.QA_INITIAL_GOLD,
        r8ShopOptions: {
            mode: SHOP_RUNTIME_CONFIGURATION_MODE.QA,
            autoOpen: true,
            sourceId: 'test.r8-auto-open',
            runSessionId: 'run.phase.game-system',
            runSeed: R8_WORD_SHOP_BALANCE.QA_RUN_SEED,
            unlockedWordDefinitionIds:
                R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
            unlockedPoolFingerprint: fingerprintUnlockedWordPool(
                R8_ALL_UNLOCKED_WORD_DEFINITION_IDS
            ),
            allowEconomicallyRedundantOffers: true
        }
    });
    assert.equal(gameSystem.enter(), true);
    const tower = gameSystem.getObjectSystem().getTower();
    const initialTowerX = tower.position.x;
    const backend = gameSystem.getObjectSystem().getEnemySimulationBackend();

    assert.equal(gameSystem.getShopPhaseStatus().phase,
        SHOP_RUNTIME_PHASE.SHOP_OPENING);
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 1);
    assert.equal(tower.position.x, initialTowerX);
    assert.equal(gameSystem.fixedUpdate(), FIXED_STEP_RESULT.COMPLETED);
    assert.equal(gameSystem.getShopPhaseStatus().phase, SHOP_RUNTIME_PHASE.SHOP);
    const submittedAtOpen = backend.getEventProtocolState().submittedTickCount;
    const originalWorldUpdate = gameSystem.getObjectSystem().update.bind(
        gameSystem.getObjectSystem()
    );
    let worldUpdateArguments = null;
    gameSystem.getObjectSystem().update = (...args) => {
        worldUpdateArguments = args;
        return originalWorldUpdate(...args);
    };

    for (let index = 0; index < 5; index++) {
        assert.equal(
            gameSystem.fixedUpdate(),
            FIXED_STEP_RESULT.INTENTIONAL_PAUSE
        );
    }
    assert.equal(gameSystem.getFixedTick(), 1);
    assert.equal(tower.position.x, initialTowerX);
    assert.equal(
        backend.getEventProtocolState().submittedTickCount,
        submittedAtOpen
    );
    assert.equal(gameSystem.getGameplayStatus().wave.queuedSpawnCount, 0);
    assert.equal(
        gameSystem.getWordSystem().getStatusView().pendingActivationCount,
        0
    );

    gameSystem.update();
    assert.deepEqual(worldUpdateArguments, [1, 0, 1 / 60]);
    assert.equal(harness.uiFrameDeltas.at(-1), 1 / 120);
    gameSystem.draw();
    assert.ok(harness.drawCounts.circles > 0);
    assert.ok(harness.drawCounts.squares > 0);

    const close = gameSystem.requestShopContinue({
        transactionId: 'shop.phase.game-system.continue.1'
    });
    assert.equal(close.code, SHOP_PHASE_RESULT_CODE.CLOSE_REQUESTED);
    assert.equal(gameSystem.fixedUpdate(), FIXED_STEP_RESULT.COMPLETED);
    assert.equal(gameSystem.getFixedTick(), 1);
    assert.equal(gameSystem.getShopPhaseStatus().phase, SHOP_RUNTIME_PHASE.COMBAT);
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 2);
    assert.equal(gameSystem.getGold(), R8_WORD_SHOP_BALANCE.QA_INITIAL_GOLD);
    assert.strictEqual(gameSystem.getGoldLedger(), gameSystem.getRunCommerceState());
    gameSystem.destroy();
});

test('R8 exact QA auto-open과 R9 ordinary production Shop route를 분리한다', () => {
    assert.equal(isR8QaLaunchRequested([R8_QA_LAUNCH_ARGUMENT]), true);
    assert.equal(isR8QaLaunchRequested(['--r7-qa']), false);
    const ordinary = createProductionGameStartOptions(
        PRODUCTION_STAGE_ONE_SELECTION_MAP_ID
    );
    const r6 = createR6QaGameStartOptions();
    const r7 = createR7QaGameStartOptions();
    const r8 = createR8QaGameStartOptions();

    assert.strictEqual(
        ordinary.wordSystemOptions.loadout,
        R5_SHOWCASE_SENTENCE_LOADOUT
    );
    assert.strictEqual(r6.wordSystemOptions.loadout, R6_QA_SENTENCE_LOADOUT);
    assert.strictEqual(r7.wordSystemOptions.loadout, R7_QA_SENTENCE_LOADOUT);
    assert.equal(Object.hasOwn(ordinary, 'r8ShopOptions'), true);
    assert.equal(
        ordinary.r8ShopOptions.mode,
        SHOP_RUNTIME_CONFIGURATION_MODE.PRODUCTION
    );
    assert.equal(ordinary.r8ShopOptions.autoOpen, false);
    assert.equal(ordinary.r9WarmExposureApproved, true);
    assert.equal(ordinary.r9QaRuntimeAuthorized, false);
    assert.equal(ordinary.r9WaveRunPlan.waves.length, 1);
    assert.equal(Object.hasOwn(r6, 'r8ShopOptions'), false);
    assert.equal(Object.hasOwn(r7, 'r8ShopOptions'), false);
    assert.strictEqual(r8.wordSystemOptions.loadout, R5_SHOWCASE_SENTENCE_LOADOUT);
    assert.equal(r8.enemyWaveEnabled, false);
    assert.equal(r8.initialGold, R8_WORD_SHOP_BALANCE.QA_INITIAL_GOLD);
    assert.equal(r8.r8ShopOptions.autoOpen, true);
    assert.equal(r8.r8ShopOptions.mode, SHOP_RUNTIME_CONFIGURATION_MODE.QA);
    assert.deepEqual(
        r8.r8ShopOptions.unlockedWordDefinitionIds,
        R8_ALL_UNLOCKED_WORD_DEFINITION_IDS
    );
    assert.equal(
        r8.r8ShopOptions.unlockedPoolFingerprint,
        fingerprintUnlockedWordPool(R8_ALL_UNLOCKED_WORD_DEFINITION_IDS)
    );
    assert.equal(r8.r8ShopOptions.allowEconomicallyRedundantOffers, true);
});

test('ordinary mode는 Disabled이고 production identity는 네 필드를 모두 요구한다', () => {
    const harness = createGameSystemDependencies();
    const ordinaryGame = new GameSystem(harness.dependencies);
    assert.equal(
        ordinaryGame.getShopRuntimeConfiguration().mode,
        SHOP_RUNTIME_CONFIGURATION_MODE.DISABLED
    );
    const disabled = ordinaryGame.requestShopOpen(openRequest({
        transactionId: 'ordinary.shop.open'
    }));
    assert.equal(disabled.code, SHOP_PHASE_RESULT_CODE.SHOP_NOT_CONFIGURED);
    assert.equal(disabled.mutationCount, 0);
    assert.equal(
        ordinaryGame.getShopPhaseStatus().phase,
        SHOP_RUNTIME_PHASE.COMBAT
    );
    ordinaryGame.destroy();

    const identity = {
        runSessionId: 'run.production.explicit',
        runSeed: 0x12345678,
        unlockedWordDefinitionIds: R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
        unlockedPoolFingerprint: fingerprintUnlockedWordPool(
            R8_ALL_UNLOCKED_WORD_DEFINITION_IDS
        )
    };
    const production = createProductionShopGameStartOptions(
        PRODUCTION_STAGE_ONE_SELECTION_MAP_ID,
        identity
    );
    assert.equal(
        production.r8ShopOptions.mode,
        SHOP_RUNTIME_CONFIGURATION_MODE.PRODUCTION
    );
    assert.equal(production.r8ShopOptions.autoOpen, false);
    assert.equal(production.r8ShopOptions.allowEconomicallyRedundantOffers,
        false);
    assert.equal(createProductionShopGameStartOptions(
        PRODUCTION_STAGE_ONE_SELECTION_MAP_ID,
        { ...identity, mode: SHOP_RUNTIME_CONFIGURATION_MODE.QA }
    ).r8ShopOptions.mode, SHOP_RUNTIME_CONFIGURATION_MODE.PRODUCTION);
    for (const forbiddenOptions of [
        { autoOpen: true },
        { allowEconomicallyRedundantOffers: true }
    ]) {
        assert.throws(() => createProductionShopGameStartOptions(
            PRODUCTION_STAGE_ONE_SELECTION_MAP_ID,
            { ...identity, ...forbiddenOptions }
        ));
    }
    for (const missingKey of [
        'runSessionId',
        'runSeed',
        'unlockedWordDefinitionIds',
        'unlockedPoolFingerprint'
    ]) {
        const incomplete = { ...identity };
        delete incomplete[missingKey];
        assert.throws(() => createProductionShopGameStartOptions(
            PRODUCTION_STAGE_ONE_SELECTION_MAP_ID,
            incomplete
        ));
    }
});

for (const failureKind of [
    'shop-open-throw',
    'shop-open-reject',
    'word-shop-false',
    'presentation-open-throw'
]) {
    test(`atomic open ${failureKind}는 COMBAT/비활성 상태로 rollback한다`, () => {
        const harness = createCoordinatorHarness();
        const commerceBefore = harness.commerce.getStatus();
        const boardBefore = harness.board.getStatus();
        if (failureKind === 'shop-open-throw') {
            harness.shop.open = () => { throw new Error('injected:shop-open'); };
        } else if (failureKind === 'shop-open-reject') {
            harness.shop.open = () => Object.freeze({
                accepted: false,
                code: 'INJECTED_OPEN_REJECT',
                mutationCount: 0
            });
        } else if (failureKind === 'word-shop-false') {
            const original = harness.wordSystem.setRuntimePhase.bind(
                harness.wordSystem
            );
            harness.wordSystem.setRuntimePhase = (phase) => (
                phase === SENTENCE_RUNTIME_PHASE.SHOP
                    ? false
                    : original(phase)
            );
        } else {
            harness.failNextSynchronize();
        }
        harness.coordinator.requestOpen(openRequest());
        clearSafeBlockers(harness.safe);
        const rejected = harness.coordinator.progressOpening();
        assert.equal(rejected.code, SHOP_PHASE_RESULT_CODE.OPEN_REJECTED);
        assert.equal(rejected.rolledBack, true);
        assert.equal(harness.coordinator.getPhase(), SHOP_RUNTIME_PHASE.COMBAT);
        assert.equal(harness.shop.getStatus().active, false);
        assert.equal(harness.shop.getStatus().openCount, 0);
        assert.equal(
            harness.wordSystem.getStatusView().phase,
            SENTENCE_RUNTIME_PHASE.COMBAT
        );
        assert.equal(harness.commerce.getStatus().gold, commerceBefore.gold);
        assert.equal(
            harness.commerce.getStatus().inventoryFingerprint,
            commerceBefore.inventoryFingerprint
        );
        assert.equal(
            harness.board.getStatus().boardFingerprint,
            boardBefore.boardFingerprint
        );
        assert.strictEqual(
            harness.coordinator.requestOpen(openRequest()),
            rejected
        );
        const conflict = harness.coordinator.requestOpen(openRequest({
            sourceId: 'test.conflicting-open'
        }));
        assert.equal(conflict.code, SHOP_PHASE_RESULT_CODE.TRANSACTION_CONFLICT);
    });
}

for (const failureKind of [
    'shop-close-throw',
    'shop-close-reject',
    'word-combat-false',
    'presentation-close-throw'
]) {
    test(`atomic close ${failureKind}는 SHOP/활성 상태로 rollback한다`, () => {
        const harness = createCoordinatorHarness();
        harness.coordinator.requestOpen(openRequest());
        clearSafeBlockers(harness.safe);
        harness.coordinator.progressOpening();
        const shopBefore = harness.shop.getStatus();
        const commerceBefore = harness.commerce.getStatus();
        const boardBefore = harness.board.getStatus();
        if (failureKind === 'shop-close-throw') {
            harness.shop.close = () => { throw new Error('injected:shop-close'); };
        } else if (failureKind === 'shop-close-reject') {
            harness.shop.close = () => Object.freeze({
                accepted: false,
                code: 'INJECTED_CLOSE_REJECT',
                mutationCount: 0
            });
        } else if (failureKind === 'word-combat-false') {
            const original = harness.wordSystem.setRuntimePhase.bind(
                harness.wordSystem
            );
            harness.wordSystem.setRuntimePhase = (phase) => (
                phase === SENTENCE_RUNTIME_PHASE.COMBAT
                    ? false
                    : original(phase)
            );
        } else {
            harness.failNextSynchronize();
        }
        const transactionId = `atomic.close.${failureKind}`;
        const requested = harness.coordinator.requestContinue({ transactionId });
        assert.equal(requested.code, SHOP_PHASE_RESULT_CODE.CLOSE_REQUESTED);
        assert.equal(harness.shop.getStatus().active, true);
        const rejected = harness.coordinator.progressClosing();
        assert.equal(rejected.code, SHOP_PHASE_RESULT_CODE.CLOSE_REJECTED);
        assert.equal(rejected.rolledBack, true);
        assert.equal(harness.coordinator.getPhase(), SHOP_RUNTIME_PHASE.SHOP);
        assert.equal(harness.shop.getStatus().active, true);
        assert.equal(harness.shop.getStatus().closeCount, shopBefore.closeCount);
        assert.strictEqual(harness.shop.getStatus().row, shopBefore.row);
        assert.equal(
            harness.wordSystem.getStatusView().phase,
            SENTENCE_RUNTIME_PHASE.SHOP
        );
        assert.equal(harness.commerce.getStatus().gold, commerceBefore.gold);
        assert.equal(
            harness.commerce.getStatus().inventoryFingerprint,
            commerceBefore.inventoryFingerprint
        );
        assert.equal(
            harness.board.getStatus().boardFingerprint,
            boardBefore.boardFingerprint
        );
        assert.strictEqual(
            harness.coordinator.requestContinue({ transactionId }),
            rejected
        );
    });
}

test('SentenceBoard status snapshot은 mutation 전 identity를 재사용한다', () => {
    const harness = createCoordinatorHarness();
    const first = harness.board.getStatus();
    assert.strictEqual(harness.board.getStatus(), first);
    harness.board.beginDraft();
    const drafted = harness.board.getStatus();
    assert.notStrictEqual(drafted, first);
    assert.strictEqual(harness.board.getStatus(), drafted);
});

test('future Wave settlement port는 typed request만 export하고 WaveDirector caller는 추가하지 않는다', async () => {
    const request = createWaveSettlementShopOpenRequest({
        sourceId: 'wave.settlement.future.1',
        settlementOrdinal: 2,
        transactionId: 'shop.phase.wave.future.2',
        minimumFixedTick: 50
    });
    assert.equal(request.sourceKind, SHOP_OPEN_SOURCE_KIND.WAVE_SETTLEMENT);
    const waveSource = await readFile(
        new URL('../script/module/ingame/flow/wave_director.js', import.meta.url),
        'utf8'
    );
    assert.doesNotMatch(waveSource, /ShopPhaseCoordinator|requestShopOpen/u);
    assert.match(waveSource, /completionOwned:\s*false/u);
});
