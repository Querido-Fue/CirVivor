import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
    R8_WORD_SHOP_BALANCE
} = await loadGameModule('data/word/r8_word_shop_catalog_data.js');
const {
    INPUT_ACTION_IDS
} = await loadGameModule('input/_input_binding_constants.js');
const {
    ABILITY_SLOT_ID,
    WORD_DEFINITION_ID
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    SHOP_UI_COMMAND_TYPE
} = await loadGameModule('ingame/contract/shop_ui_command_contract.js');
const {
    SHOP_RUNTIME_PHASE
} = await loadGameModule('ingame/flow/shop_phase_coordinator.js');
const {
    GameSystem
} = await loadGameModule('ingame/game_system.js');
const {
    createShopOverlayLayout
} = await loadGameModule('scene/game/shop/shop_overlay_layout.js');
const {
    createShopOverlayRenderState
} = await loadGameModule('scene/game/shop/shop_overlay_render_state.js');
const {
    ShopOverlayInteraction
} = await loadGameModule('scene/game/shop/shop_overlay_interaction.js');
const {
    SentenceEditorOverlayModel
} = await loadGameModule('scene/game/shop/sentence_editor_overlay_model.js');

class HeadlessShopOverlaySession {
    constructor(options = {}) {
        this.options = options;
        this.editorModel = new SentenceEditorOverlayModel();
        this.interaction = new ShopOverlayInteraction({
            inputSource: options.inputSource,
            editorModel: this.editorModel
        });
        this.renderState = null;
        this.layout = null;
        this.destroyed = false;
    }

    update(status, viewport, delta) {
        if (this.destroyed) return false;
        this.editorModel.synchronizeInventory(
            status?.commerce?.inventory?.instances ?? []
        );
        this.renderState = createShopOverlayRenderState(
            status,
            this.editorModel.getStatus()
        );
        this.layout = createShopOverlayLayout(viewport, this.renderState);
        const emitted = this.interaction.update(
            this.renderState,
            this.layout,
            {
                deltaSeconds: delta,
                tooltipDelaySeconds:
                    this.options.settingsSource?.getTooltipDelaySeconds?.()
            }
        );
        this.renderState = createShopOverlayRenderState(
            status,
            this.editorModel.getStatus()
        );
        this.layout = createShopOverlayLayout(viewport, this.renderState);
        return emitted;
    }

    draw() { return false; }
    drainCommands() { return this.interaction.drainCommands(); }
    getRenderSnapshot() { return this.renderState; }
    getLayoutSnapshot() { return this.layout; }
    getInteractionStatus() { return this.interaction.getStatus(); }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.interaction.destroy();
        this.editorModel.destroy();
    }
}

function assertDeepFrozen(value, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
        assertDeepFrozen(child, visited);
    }
}

function center(bounds) {
    return {
        x: bounds.x + bounds.w * 0.5,
        y: bounds.y + bounds.h * 0.5
    };
}

function createHarness(options = {}) {
    const input = {
        actions: Object.create(null),
        pointer: { x: 0, y: 0 },
        pointerPressed: false,
        wheel: { x: 0, y: 0 }
    };
    const animationCalls = [];
    const viewport = {
        ww: 1280,
        wh: 720,
        uiww: 1280,
        uiOffsetX: 0,
        uiScale: 1
    };
    let renderer = null;
    const dependencies = {
        inputActionSource: {
            isPressed(actionId) {
                return input.actions[actionId] === true;
            },
            getPointerPosition(out) {
                Object.assign(out, input.pointer);
                return out;
            },
            isPrimaryPointerPressed() {
                return input.pointerPressed;
            },
            getWheelTotals(out) {
                Object.assign(out, input.wheel);
                return out;
            }
        },
        animationPort: {
            animate(owner, properties) {
                animationCalls.push(Object.freeze({ ...properties }));
                owner[properties.variable] = properties.endValue;
                return Object.freeze({
                    id: animationCalls.length,
                    promise: Promise.resolve(),
                    retarget() { return true; },
                    remove() {},
                    isActive() { return false; }
                });
            }
        },
        timePort: {
            getDelta() { return options.frameDelta ?? 1 / 120; },
            getFixedDelta() { return 1 / 60; },
            getFixedInterpolationAlpha() { return 0.5; }
        },
        viewportPort: {
            getSnapshot(out) {
                Object.assign(out, viewport);
                return out;
            }
        },
        uiSettingsSource: {
            getTooltipDelaySeconds() {
                return options.tooltipDelaySeconds ?? 0.3;
            }
        },
        gameplayStatusRenderPort: {
            createSession(sessionOptions) {
                renderer = new HeadlessShopOverlaySession(sessionOptions);
                return renderer;
            }
        },
        worldRenderPort: {
            drawCircle() {},
            drawSquareInstances() {}
        }
    };
    const game = new GameSystem(dependencies, {
        initialGold: options.initialGold
            ?? R8_WORD_SHOP_BALANCE.QA_INITIAL_GOLD,
        r8ShopOptions: {
            autoOpen: true,
            sourceId: options.sourceId ?? 'test.r8-overlay',
            runSessionId: options.runSessionId ?? 'run.r8-overlay',
            runSeed: options.runSeed ?? R8_WORD_SHOP_BALANCE.QA_RUN_SEED,
            unlockedWordDefinitionIds: R8_ALL_UNLOCKED_WORD_DEFINITION_IDS
        }
    });
    assert.equal(game.enter(), true);
    assert.equal(game.fixedUpdate(), true);
    assert.equal(game.fixedUpdate(), false);
    assert.equal(game.getShopPhaseStatus().phase, SHOP_RUNTIME_PHASE.SHOP);
    game.update();
    return {
        game,
        input,
        viewport,
        animationCalls,
        get renderer() { return renderer; }
    };
}

function clickTarget(harness, targetId) {
    const target = harness.renderer.getLayoutSnapshot().focusTargets.find(
        ({ id }) => id === targetId
    );
    assert.ok(target, `target not found: ${targetId}`);
    Object.assign(harness.input.pointer, center(target.bounds));
    harness.input.pointerPressed = false;
    harness.game.update();
    harness.input.pointerPressed = true;
    harness.game.update();
    harness.input.pointerPressed = false;
    harness.game.update();
    return harness.game.getShopUiCommandStatus().lastReceipt;
}

function pressAction(harness, actionId) {
    harness.input.actions[actionId] = true;
    harness.game.update();
    harness.input.actions[actionId] = false;
    harness.game.update();
}

function focusTargetWithKeyboard(harness, targetId) {
    const targetCount = harness.renderer.getLayoutSnapshot().focusTargets.length;
    for (let index = 0; index <= targetCount; index++) {
        if (harness.renderer.getInteractionStatus().focusTargetId === targetId) {
            return;
        }
        pressAction(harness, INPUT_ACTION_IDS.UI_FOCUS_NEXT);
    }
    assert.fail(`keyboard focus target not reached: ${targetId}`);
}

function findInventoryEntry(renderer, definitionId, ordinal = 0) {
    return renderer.getRenderSnapshot().inventory.filter(
        (entry) => entry.definitionId === definitionId
    )[ordinal];
}

function acquireDefinition(harness, definitionId, suffix) {
    const inventory = harness.game.getWordInventory();
    const receipt = inventory.acquire({
        transactionId: `overlay.acquire.${suffix}`,
        definitionId,
        acquiredShopSessionOrdinal: 1,
        expectedRevision: inventory.getRevision()
    });
    assert.equal(receipt.accepted, true);
    harness.game.update();
    return receipt.instance.instanceId;
}

function canonicalSurfacePayload(surfaceId, harness) {
    return {
        surfaceId,
        renderState: harness.renderer.getRenderSnapshot(),
        layout: harness.renderer.getLayoutSnapshot()
    };
}

function hashCanonicalSurface(payload) {
    return createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex');
}

test('5 cards와 전체 editor layout은 resolution/UI-scale matrix bounds 안에 있다', () => {
    const harness = createHarness();
    const renderState = harness.renderer.getRenderSnapshot();
    assert.equal(renderState.offers.length, 5);
    assert.equal(new Set(renderState.offers.map((offer) => (
        offer.definitionId
    ))).size, 5);

    for (const viewport of [
        { ww: 1280, wh: 720, uiww: 1280, uiOffsetX: 0, uiScale: 1 },
        { ww: 1920, wh: 1080, uiww: 1600, uiOffsetX: 160, uiScale: 1.25 },
        { ww: 2560, wh: 1440, uiww: 1920, uiOffsetX: 320, uiScale: 0.75 }
    ]) {
        const layout = createShopOverlayLayout(viewport, renderState);
        assert.equal(layout.offerCards.length, 5);
        assert.equal(layout.editorPanel.rows.length, 5);
        for (const target of layout.focusTargets) {
            assert.ok(target.bounds.x >= viewport.uiOffsetX - 0.001);
            assert.ok(
                target.bounds.x + target.bounds.w
                    <= viewport.uiOffsetX + viewport.uiww + 0.001
            );
            assert.ok(target.bounds.y >= -0.001);
            assert.ok(target.bounds.y + target.bounds.h <= viewport.wh + 0.001);
        }
    }
    harness.game.destroy();
});

test('render snapshot은 immutable이고 Gold/insufficient/disabled 상태를 구분한다', () => {
    const harness = createHarness({ initialGold: 0, runSessionId: 'run.overlay.zero' });
    const snapshot = harness.renderer.getRenderSnapshot();
    assert.equal(snapshot.gold, 0);
    assert.equal(snapshot.rerollEnabled, false);
    assert.equal(snapshot.offers.every((offer) => (
        offer.state === 'insufficient' && offer.enabled === false
    )), true);
    assertDeepFrozen(snapshot);
    assertDeepFrozen(harness.renderer.getLayoutSnapshot());
    assert.throws(() => {
        snapshot.offers[0].sold = true;
    }, TypeError);
    harness.game.destroy();
});

test('mouse와 keyboard confirm은 같은 offer purchase semantic과 exact receipt를 만든다', () => {
    const mouse = createHarness({ runSessionId: 'run.overlay.mouse' });
    const mouseOffer = mouse.renderer.getRenderSnapshot().offers[0];
    const mouseReceipt = clickTarget(mouse, `offer:${mouseOffer.offerId}`);
    assert.equal(mouseReceipt.accepted, true);
    assert.equal(mouseReceipt.commandType, SHOP_UI_COMMAND_TYPE.BUY_OFFER);
    assert.equal(mouseReceipt.authorityReceipt.offerId, mouseOffer.offerId);
    assert.equal(
        mouse.game.getGold(),
        R8_WORD_SHOP_BALANCE.QA_INITIAL_GOLD - mouseOffer.price
    );
    assert.equal(
        mouse.renderer.getRenderSnapshot().offers[0].state,
        'sold'
    );

    const keyboard = createHarness({ runSessionId: 'run.overlay.keyboard' });
    const keyboardOffer = keyboard.renderer.getRenderSnapshot().offers[0];
    pressAction(keyboard, INPUT_ACTION_IDS.UI_FOCUS_NEXT);
    assert.equal(
        keyboard.renderer.getInteractionStatus().focusTargetId,
        `offer:${keyboardOffer.offerId}`
    );
    pressAction(keyboard, INPUT_ACTION_IDS.UI_CONFIRM);
    const keyboardReceipt = keyboard.game.getShopUiCommandStatus().lastReceipt;
    assert.equal(keyboardReceipt.accepted, true);
    assert.equal(keyboardReceipt.commandType, SHOP_UI_COMMAND_TYPE.BUY_OFFER);
    assert.equal(
        keyboardReceipt.authorityReceipt.definitionId,
        mouseReceipt.authorityReceipt.definitionId
    );
    mouse.game.destroy();
    keyboard.game.destroy();
});

test('keyboard-only traversal로 reroll/buy/upgrade/모든 role/add-remove/apply/discard/continue가 가능하다', () => {
    const harness = createHarness({ runSessionId: 'run.overlay.keyboard-all' });
    focusTargetWithKeyboard(harness, 'reroll');
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    assert.equal(
        harness.game.getShopUiCommandStatus().lastReceipt.commandType,
        SHOP_UI_COMMAND_TYPE.REROLL
    );
    const offer = harness.renderer.getRenderSnapshot().offers[0];
    focusTargetWithKeyboard(harness, `offer:${offer.offerId}`);
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    assert.equal(
        harness.game.getShopUiCommandStatus().lastReceipt.commandType,
        SHOP_UI_COMMAND_TYPE.BUY_OFFER
    );

    const twiceId = acquireDefinition(
        harness,
        WORD_DEFINITION_ID.TWICE,
        'keyboard-all.twice'
    );
    const tower = findInventoryEntry(
        harness.renderer,
        WORD_DEFINITION_ID.TOWER
    );
    const shoot = findInventoryEntry(
        harness.renderer,
        WORD_DEFINITION_ID.SHOOT
    );
    focusTargetWithKeyboard(harness, `inventory:${twiceId}`);
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    focusTargetWithKeyboard(harness, 'upgrade');
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    assert.equal(
        harness.game.getWordInventory().getInstance(twiceId).upgradeLevel,
        1
    );

    focusTargetWithKeyboard(harness, `inventory:${tower.instanceId}`);
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    for (const role of ['subject', 'payload']) {
        focusTargetWithKeyboard(
            harness,
            `slot:${ABILITY_SLOT_ID.Q}:${role}`
        );
        pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    }
    focusTargetWithKeyboard(harness, `inventory:${shoot.instanceId}`);
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    focusTargetWithKeyboard(harness, `slot:${ABILITY_SLOT_ID.Q}:verb`);
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    focusTargetWithKeyboard(harness, `inventory:${twiceId}`);
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    focusTargetWithKeyboard(harness, `slot:${ABILITY_SLOT_ID.Q}:modifier`);
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    assert.deepEqual(
        Array.from(harness.game.getSentenceBoard().getStatus()
            .draftSlots[ABILITY_SLOT_ID.Q].modifierInstanceIds),
        [twiceId]
    );
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    assert.deepEqual(
        Array.from(harness.game.getSentenceBoard().getStatus()
            .draftSlots[ABILITY_SLOT_ID.Q].modifierInstanceIds),
        []
    );
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    focusTargetWithKeyboard(harness, 'apply');
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    assert.equal(
        harness.game.getSentenceBoard().getStatus().draftSlots,
        null
    );

    focusTargetWithKeyboard(harness, `inventory:${tower.instanceId}`);
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    focusTargetWithKeyboard(harness, `slot:${ABILITY_SLOT_ID.E}:subject`);
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    assert.notEqual(
        harness.game.getSentenceBoard().getStatus().draftSlots,
        null
    );
    focusTargetWithKeyboard(harness, 'discard');
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    focusTargetWithKeyboard(harness, 'continue');
    pressAction(harness, INPUT_ACTION_IDS.UI_CONFIRM);
    assert.equal(
        harness.game.getShopPhaseStatus().phase,
        SHOP_RUNTIME_PHASE.SHOP_CLOSING
    );
    harness.game.destroy();
});

test('reroll은 row를 교체하고 이전 offer command는 stale receipt로 거절된다', () => {
    const harness = createHarness({ runSessionId: 'run.overlay.reroll' });
    const before = harness.renderer.getRenderSnapshot();
    const oldOffer = before.offers[0];
    const oldCommandContext = {
        rowFingerprint: before.rowFingerprint,
        expectedCommerceRevision: before.commerceRevision,
        expectedInventoryRevision: before.inventoryRevision
    };
    const reroll = clickTarget(harness, 'reroll');
    assert.equal(reroll.accepted, true);
    assert.equal(reroll.commandType, SHOP_UI_COMMAND_TYPE.REROLL);
    assert.notEqual(
        harness.renderer.getRenderSnapshot().rowFingerprint,
        before.rowFingerprint
    );
    const stale = harness.game.handleShopUiCommands([Object.freeze({
        commandId: 'shop-ui.r8:1:999:buy_offer',
        type: SHOP_UI_COMMAND_TYPE.BUY_OFFER,
        interactionSequence: 999,
        shopSessionOrdinal: 1,
        offerId: oldOffer.offerId,
        expectedBoardRevision: before.boardRevision,
        expectedDraftRevision: before.draftRevision,
        ...oldCommandContext
    })])[0];
    assert.equal(stale.accepted, false);
    assert.match(stale.code, /STALE/u);
    harness.game.destroy();
});

test('UI interaction-sequence command ID는 editor mutation도 exact replay/conflict로 봉인한다', () => {
    const harness = createHarness({ runSessionId: 'run.overlay.replay' });
    const twiceId = acquireDefinition(
        harness,
        WORD_DEFINITION_ID.TWICE,
        'replay.twice'
    );
    const status = harness.renderer.getRenderSnapshot();
    const command = Object.freeze({
        commandId: 'shop-ui.r8:1:500:add_modifier',
        type: SHOP_UI_COMMAND_TYPE.ADD_MODIFIER,
        interactionSequence: 500,
        shopSessionOrdinal: status.shopSessionOrdinal,
        rowFingerprint: status.rowFingerprint,
        expectedCommerceRevision: status.commerceRevision,
        expectedInventoryRevision: status.inventoryRevision,
        expectedBoardRevision: status.boardRevision,
        expectedDraftRevision: status.draftRevision,
        slotId: ABILITY_SLOT_ID.Q,
        instanceId: twiceId
    });
    const first = harness.game.handleShopUiCommands([command])[0];
    const replay = harness.game.handleShopUiCommands([command])[0];
    assert.strictEqual(replay, first);
    assert.deepEqual(
        Array.from(harness.game.getSentenceBoard().getStatus()
            .draftSlots[ABILITY_SLOT_ID.Q].modifierInstanceIds),
        [twiceId]
    );
    const conflict = harness.game.handleShopUiCommands([Object.freeze({
        ...command,
        instanceId: 'word-instance.changed'
    })])[0];
    assert.equal(conflict.accepted, false);
    assert.equal(conflict.code, 'TRANSACTION_CONFLICT');
    assert.deepEqual(
        Array.from(harness.game.getSentenceBoard().getStatus()
            .draftSlots[ABILITY_SLOT_ID.Q].modifierInstanceIds),
        [twiceId]
    );
    harness.game.destroy();
});

test('inventory select→role place와 modifier ordering은 click workflow로 보존된다', () => {
    const harness = createHarness({ runSessionId: 'run.overlay.editor' });
    acquireDefinition(harness, WORD_DEFINITION_ID.TWICE, 'editor.twice.1');
    acquireDefinition(harness, WORD_DEFINITION_ID.TWICE, 'editor.twice.2');
    const tower = findInventoryEntry(
        harness.renderer,
        WORD_DEFINITION_ID.TOWER
    );
    clickTarget(harness, `inventory:${tower.instanceId}`);
    clickTarget(harness, `slot:${ABILITY_SLOT_ID.E}:subject`);
    assert.equal(
        harness.game.getSentenceBoard().getStatus()
            .draftSlots[ABILITY_SLOT_ID.E].subjectInstanceId,
        tower.instanceId
    );

    const firstTwice = findInventoryEntry(
        harness.renderer,
        WORD_DEFINITION_ID.TWICE,
        0
    );
    const secondTwice = findInventoryEntry(
        harness.renderer,
        WORD_DEFINITION_ID.TWICE,
        1
    );
    clickTarget(harness, `inventory:${firstTwice.instanceId}`);
    clickTarget(harness, `slot:${ABILITY_SLOT_ID.Q}:modifier`);
    clickTarget(harness, `inventory:${secondTwice.instanceId}`);
    clickTarget(harness, `slot:${ABILITY_SLOT_ID.Q}:modifier`);
    const boardStatus = harness.game.getSentenceBoard().getStatus();
    assert.deepEqual(
        Array.from(boardStatus.draftSlots[ABILITY_SLOT_ID.Q]
            .modifierInstanceIds),
        [firstTwice.instanceId, secondTwice.instanceId]
    );
    const validation = harness.game.getSentenceBoard().validateDraft();
    const q = validation.slotValidations.find(
        ({ slotId }) => slotId === ABILITY_SLOT_ID.Q
    );
    assert.equal(q.preview.copiesPerSubject, 4);
    harness.game.destroy();
});

test('upgrade panel receipt와 upgraded twice ×4 preview가 같은 selected instance에 반영된다', () => {
    const harness = createHarness({ runSessionId: 'run.overlay.upgrade' });
    acquireDefinition(harness, WORD_DEFINITION_ID.TWICE, 'upgrade.twice');
    const twice = findInventoryEntry(
        harness.renderer,
        WORD_DEFINITION_ID.TWICE,
        0
    );
    clickTarget(harness, `inventory:${twice.instanceId}`);
    const upgrade = clickTarget(harness, 'upgrade');
    assert.equal(upgrade.accepted, true);
    assert.equal(upgrade.commandType, SHOP_UI_COMMAND_TYPE.UPGRADE_WORD);
    assert.equal(
        harness.game.getWordInventory().getInstance(twice.instanceId)
            .upgradeLevel,
        1
    );
    clickTarget(harness, `slot:${ABILITY_SLOT_ID.Q}:modifier`);
    assert.equal(harness.renderer.getRenderSnapshot().preview.copiesPerSubject, 4);
    assert.match(
        harness.renderer.getRenderSnapshot().preview.text,
        /The Tower shoots Enemies twice · ×4/u
    );
    harness.game.destroy();
});

test('invalid verb/payload 조합은 preview reason과 Apply disabled를 만들고 Discard가 복원한다', () => {
    const harness = createHarness({ runSessionId: 'run.overlay.invalid' });
    acquireDefinition(harness, WORD_DEFINITION_ID.MERGE, 'invalid.merge');
    const merge = findInventoryEntry(
        harness.renderer,
        WORD_DEFINITION_ID.MERGE
    );
    clickTarget(harness, `inventory:${merge.instanceId}`);
    clickTarget(harness, `slot:${ABILITY_SLOT_ID.Q}:verb`);
    const invalid = harness.renderer.getRenderSnapshot();
    assert.equal(invalid.draftActive, true);
    assert.equal(invalid.draftValid, false);
    assert.equal(invalid.applyEnabled, false);
    assert.equal(invalid.preview.valid, false);
    assert.notEqual(invalid.preview.code, 'VALID');
    const discard = clickTarget(harness, 'discard');
    assert.equal(discard.accepted, true);
    assert.equal(
        harness.game.getSentenceBoard().getStatus().draftSlots,
        null
    );
    assert.equal(harness.renderer.getRenderSnapshot().continueEnabled, false);
    harness.game.destroy();
});

test('Apply/Continue은 board commit과 SHOP_CLOSING receipt를 거쳐 exact next fixed tick에 복귀한다', () => {
    const harness = createHarness({ runSessionId: 'run.overlay.continue' });
    acquireDefinition(harness, WORD_DEFINITION_ID.TWICE, 'continue.twice');
    const twice = findInventoryEntry(
        harness.renderer,
        WORD_DEFINITION_ID.TWICE,
        0
    );
    clickTarget(harness, `inventory:${twice.instanceId}`);
    clickTarget(harness, `slot:${ABILITY_SLOT_ID.Q}:modifier`);
    const apply = clickTarget(harness, 'apply');
    assert.equal(apply.accepted, true);
    assert.equal(apply.commandType, SHOP_UI_COMMAND_TYPE.APPLY_BOARD);
    assert.equal(harness.renderer.getRenderSnapshot().draftActive, false);
    const fixedBefore = harness.game.getFixedTick();
    const continued = clickTarget(harness, 'continue');
    assert.equal(continued.accepted, true);
    assert.equal(continued.commandType, SHOP_UI_COMMAND_TYPE.CONTINUE);
    assert.equal(
        harness.game.getShopPhaseStatus().phase,
        SHOP_RUNTIME_PHASE.SHOP_CLOSING
    );
    assert.equal(harness.game.fixedUpdate(), true);
    assert.equal(harness.game.getFixedTick(), fixedBefore + 1);
    assert.equal(
        harness.game.getShopPhaseStatus().phase,
        SHOP_RUNTIME_PHASE.COMBAT
    );
    harness.game.destroy();
});

test('Shop keyboard/pointer held 입력은 Continue 뒤 combat movement/fire로 click-through하지 않는다', () => {
    const harness = createHarness({ runSessionId: 'run.overlay.no-click' });
    const tower = harness.game.getObjectSystem().getTower();
    const initialX = tower.position.x;
    harness.input.actions[INPUT_ACTION_IDS.MOVE_RIGHT] = true;
    harness.input.actions[INPUT_ACTION_IDS.UI_FOCUS_NEXT] = true;
    harness.input.pointerPressed = true;
    harness.game.update();
    harness.game.requestShopContinue({
        transactionId: 'shop.overlay.no-click.continue'
    });
    assert.equal(harness.game.fixedUpdate(), true);
    assert.equal(tower.position.x, initialX);
    assert.equal(harness.game.fixedUpdate(), true);
    assert.equal(tower.position.x, initialX);
    harness.input.actions[INPUT_ACTION_IDS.MOVE_RIGHT] = false;
    harness.input.actions[INPUT_ACTION_IDS.UI_FOCUS_NEXT] = false;
    harness.input.pointerPressed = false;
    harness.game.fixedUpdate();
    harness.input.actions[INPUT_ACTION_IDS.MOVE_RIGHT] = true;
    harness.game.fixedUpdate();
    assert.ok(tower.position.x > initialX);
    harness.game.destroy();
});

test('tooltip은 real delta 0.01 정밀도이고 focus/geometry는 pause·resize·UI animation과 독립적이다', async () => {
    const harness = createHarness({
        runSessionId: 'run.overlay.tooltip',
        tooltipDelaySeconds: 0.01,
        frameDelta: 0
    });
    const rendererSource = await readFile(
        new URL('../script/module/scene/game/shop/shop_overlay_renderer.js', import.meta.url),
        'utf8'
    );
    assert.match(rendererSource, /animationCategory:\s*ANIMATION_CATEGORY\.UI/u);
    assert.doesNotMatch(
        rendererSource,
        /ANIMATION_CATEGORY\.(?:GAME_MECHANIC|EFFECT)/u
    );
    const target = harness.renderer.getLayoutSnapshot().focusTargets[0];
    Object.assign(harness.input.pointer, center(target.bounds));
    harness.game.update();
    harness.game.update();
    assert.equal(
        harness.renderer.getInteractionStatus().tooltipVisible,
        false
    );

    const status = harness.game.getGameplayStatus();
    harness.renderer.update(status, harness.viewport, 0.009);
    assert.equal(
        harness.renderer.getInteractionStatus().tooltipVisible,
        false
    );
    harness.renderer.update(status, harness.viewport, 0.001);
    assert.equal(
        harness.renderer.getInteractionStatus().tooltipVisible,
        true
    );
    const focusBefore = harness.renderer.getInteractionStatus().focusTargetId;
    Object.assign(harness.viewport, {
        ww: 1920,
        wh: 1080,
        uiww: 1600,
        uiOffsetX: 160,
        uiScale: 1.25
    });
    harness.game.resize();
    harness.renderer.update(
        harness.game.getGameplayStatus(),
        harness.viewport,
        0
    );
    assert.equal(
        harness.renderer.getInteractionStatus().focusTargetId,
        focusBefore
    );
    assert.equal(harness.renderer.getLayoutSnapshot().viewport.ww, 1920);
    harness.game.destroy();
    assert.equal(harness.renderer.destroyed, true);
});

test('pure render-state surface도 committed/draft phase와 immutable contract를 보존한다', () => {
    const harness = createHarness({ runSessionId: 'run.overlay.pure' });
    const state = createShopOverlayRenderState(
        harness.game.getGameplayStatus(),
        {
            selectedInventoryInstanceId: null,
            selectedSlotId: ABILITY_SLOT_ID.Q
        }
    );
    assert.equal(state.visible, true);
    assert.equal(state.slotRows.length, 5);
    assert.equal(state.draftActive, false);
    assertDeepFrozen(state);
    harness.game.destroy();
});

test('shop.default/sold/editor valid-invalid canonical surfaces는 승인 manifest와 일치한다', async () => {
    const surfaces = [];
    const defaultHarness = createHarness({
        runSessionId: 'run.golden.shop.default'
    });
    surfaces.push(canonicalSurfacePayload('shop.default', defaultHarness));

    const soldHarness = createHarness({
        runSessionId: 'run.golden.shop.sold'
    });
    const soldOffer = soldHarness.renderer.getRenderSnapshot().offers[0];
    clickTarget(soldHarness, `offer:${soldOffer.offerId}`);
    const commerce = soldHarness.game.getRunCommerceState();
    const spent = commerce.spend({
        transactionId: 'golden.shop.sold.spend-rest',
        amount: commerce.getBalance(),
        expectedCommerceRevision: commerce.getRevision(),
        purpose: 'R8_GOLDEN_DISABLED_STATE',
        contextFingerprint: 1
    });
    assert.equal(spent.accepted, true);
    soldHarness.game.update();
    surfaces.push(canonicalSurfacePayload(
        'shop.sold-and-disabled',
        soldHarness
    ));

    const validHarness = createHarness({
        runSessionId: 'run.golden.editor.valid'
    });
    const validTwiceId = acquireDefinition(
        validHarness,
        WORD_DEFINITION_ID.TWICE,
        'golden.valid.twice'
    );
    validHarness.game.getSentenceBoard().beginDraft();
    validHarness.game.getSentenceBoard().addModifier(
        ABILITY_SLOT_ID.Q,
        validTwiceId
    );
    validHarness.game.getSentenceBoard().validateDraft();
    validHarness.game.update();
    surfaces.push(canonicalSurfacePayload('editor.valid', validHarness));

    const invalidHarness = createHarness({
        runSessionId: 'run.golden.editor.invalid'
    });
    const invalidMergeId = acquireDefinition(
        invalidHarness,
        WORD_DEFINITION_ID.MERGE,
        'golden.invalid.merge'
    );
    invalidHarness.game.getSentenceBoard().beginDraft();
    invalidHarness.game.getSentenceBoard().setVerb(
        ABILITY_SLOT_ID.Q,
        invalidMergeId
    );
    invalidHarness.game.getSentenceBoard().validateDraft();
    invalidHarness.game.update();
    surfaces.push(canonicalSurfacePayload('editor.invalid', invalidHarness));

    const manifest = JSON.parse(await readFile(
        new URL('./fixtures/r8_shop_overlay_golden_manifest.json', import.meta.url),
        'utf8'
    ));
    assert.equal(manifest.schemaVersion, 1);
    assert.deepEqual(
        Object.keys(manifest.surfaces),
        [
            'shop.default',
            'shop.sold-and-disabled',
            'editor.valid',
            'editor.invalid'
        ]
    );
    const actualSurfaces = Object.fromEntries(surfaces.map((surface) => [
        surface.surfaceId,
        hashCanonicalSurface(surface)
    ]));
    for (const expected of Object.values(manifest.surfaces)) {
        assert.match(expected, /^[0-9a-f]{64}$/u);
    }
    assert.deepEqual(actualSurfaces, manifest.surfaces);
    for (const harness of [
        defaultHarness,
        soldHarness,
        validHarness,
        invalidHarness
    ]) {
        harness.game.destroy();
    }
});
