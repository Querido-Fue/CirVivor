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

function createCoordinatorHarness() {
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
        runSeed: 101,
        unlockedWordDefinitionIds: FIVE_OFFER_POOL
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
            }
        }
    });
    return {
        commerce,
        wordSystem,
        board,
        shop,
        safe,
        coordinator,
        getSynchronizeCount: () => synchronizeCount
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
    return {
        keys,
        drawCounts,
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
            }
        }
    };
}

test('GameSystem SHOP은 fixed/control/GPU submit을 얼리고 update/draw는 계속하며 exact next tick으로 복귀한다', () => {
    const harness = createGameSystemDependencies();
    const gameSystem = new GameSystem(harness.dependencies, {
        initialGold: R8_WORD_SHOP_BALANCE.QA_INITIAL_GOLD,
        r8ShopOptions: {
            autoOpen: true,
            sourceId: 'test.r8-auto-open',
            runSessionId: 'run.phase.game-system',
            runSeed: R8_WORD_SHOP_BALANCE.QA_RUN_SEED,
            unlockedWordDefinitionIds:
                R8_ALL_UNLOCKED_WORD_DEFINITION_IDS
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
    assert.equal(gameSystem.fixedUpdate(), false);
    assert.equal(gameSystem.getShopPhaseStatus().phase, SHOP_RUNTIME_PHASE.SHOP);
    const submittedAtOpen = backend.getEventProtocolState().submittedTickCount;

    for (let index = 0; index < 5; index++) {
        assert.equal(gameSystem.fixedUpdate(), false);
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
    gameSystem.draw();
    assert.ok(harness.drawCounts.circles > 0);
    assert.ok(harness.drawCounts.squares > 0);

    const close = gameSystem.requestShopContinue({
        transactionId: 'shop.phase.game-system.continue.1'
    });
    assert.equal(close.code, SHOP_PHASE_RESULT_CODE.CLOSE_REQUESTED);
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 2);
    assert.equal(gameSystem.getShopPhaseStatus().phase, SHOP_RUNTIME_PHASE.COMBAT);
    assert.equal(gameSystem.getGold(), R8_WORD_SHOP_BALANCE.QA_INITIAL_GOLD);
    assert.strictEqual(gameSystem.getGoldLedger(), gameSystem.getRunCommerceState());
    gameSystem.destroy();
});

test('R8 exact QA route만 data-owned Gold/pool과 auto-open을 추가하고 기존 routes는 유지한다', () => {
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
    assert.equal(Object.hasOwn(ordinary, 'r8ShopOptions'), false);
    assert.equal(Object.hasOwn(r6, 'r8ShopOptions'), false);
    assert.equal(Object.hasOwn(r7, 'r8ShopOptions'), false);
    assert.strictEqual(r8.wordSystemOptions.loadout, R5_SHOWCASE_SENTENCE_LOADOUT);
    assert.equal(r8.enemyWaveEnabled, false);
    assert.equal(r8.initialGold, R8_WORD_SHOP_BALANCE.QA_INITIAL_GOLD);
    assert.equal(r8.r8ShopOptions.autoOpen, true);
    assert.deepEqual(
        r8.r8ShopOptions.unlockedWordDefinitionIds,
        R8_ALL_UNLOCKED_WORD_DEFINITION_IDS
    );
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
