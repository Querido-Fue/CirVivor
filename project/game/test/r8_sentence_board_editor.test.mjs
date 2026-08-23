import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    R3_SHOOT_WORD_INSTANCE,
    R3_TOWER_WORD_INSTANCE,
    R5_SHOWCASE_SENTENCE_LOADOUT
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    SENTENCE_BOARD_RESULT_CODE
} = await loadGameModule('ingame/contract/sentence_board_contract.js');
const {
    ABILITY_SLOT_ID,
    SENTENCE_COMPILE_ERROR_CODE,
    SENTENCE_RUNTIME_PHASE,
    WORD_DEFINITION_ID
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    SentenceBoardState
} = await loadGameModule('ingame/word/sentence_board_state.js');
const {
    SentenceCompiler
} = await loadGameModule('ingame/word/sentence_compiler.js');
const {
    ABILITY_ACTIVATION_RESULT_CODE,
    ABILITY_EXECUTION_OUTCOME_CODE,
    WordSystem
} = await loadGameModule('ingame/word/word_system.js');
const {
    WordInventoryState
} = await loadGameModule('ingame/word/word_inventory_state.js');

function assertDeepFrozen(value, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
        assertDeepFrozen(child, visited);
    }
}

function createHarness(options = {}) {
    const inventory = new WordInventoryState({
        runSessionId: options.runSessionId ?? 'run.board'
    });
    const wordSystem = new WordSystem({
        loadout: R5_SHOWCASE_SENTENCE_LOADOUT
    });
    const board = new SentenceBoardState({ inventory, wordSystem });
    return { inventory, wordSystem, board };
}

function acquireWord(inventory, definitionId, suffix) {
    const receipt = inventory.acquire({
        transactionId: `inventory.acquire.${suffix}`,
        definitionId,
        acquiredShopSessionOrdinal: 1,
        expectedRevision: inventory.getRevision()
    });
    assert.equal(receipt.accepted, true);
    return receipt.instance.instanceId;
}

function findSlot(validation, slotId) {
    return validation.slotValidations.find((entry) => entry.slotId === slotId);
}

test('starter board는 R5 exact compiled identity를 보존하고 빈 slot을 허용한다', () => {
    const { board } = createHarness({ runSessionId: 'run.board.starter' });
    const baselineCompiler = new SentenceCompiler();
    board.beginDraft();
    const validation = board.validateDraft();

    assert.equal(validation.valid, true);
    for (const [slotId, sentence] of Object.entries(
        R5_SHOWCASE_SENTENCE_LOADOUT
    )) {
        assert.equal(
            findSlot(validation, slotId).compiledAbility.compiledAbilityId,
            baselineCompiler.compile(sentence).compiledAbilityId
        );
    }
    const pointer = findSlot(validation, ABILITY_SLOT_ID.PRIMARY_POINTER);
    assert.equal(pointer.empty, true);
    assert.equal(pointer.valid, true);
    assert.equal(pointer.compiledAbility, null);

    board.clearSlot(ABILITY_SLOT_ID.Q);
    const withEmptyQ = board.validateDraft();
    assert.equal(withEmptyQ.valid, true);
    assert.equal(findSlot(withEmptyQ, ABILITY_SLOT_ID.Q).empty, true);
});

test('unknown/unowned instance와 wrong role은 compiler validation에서 거절된다', () => {
    const { board } = createHarness({ runSessionId: 'run.board.invalid-role' });
    board.beginDraft();
    board.setSubject(ABILITY_SLOT_ID.Q, R3_SHOOT_WORD_INSTANCE.id);
    let validation = board.validateDraft();
    assert.equal(validation.valid, false);
    assert.equal(
        findSlot(validation, ABILITY_SLOT_ID.Q).code,
        SENTENCE_COMPILE_ERROR_CODE.WRONG_WORD_KIND
    );

    board.setSubject(ABILITY_SLOT_ID.Q, 'word-instance.unowned.tower');
    validation = board.validateDraft();
    assert.equal(validation.valid, false);
    assert.equal(
        findSlot(validation, ABILITY_SLOT_ID.Q).code,
        SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_WORD_INSTANCE
    );
});

test('owned word는 여러 slot에서 재사용되며 exact modifier duplicate만 거절된다', () => {
    const { inventory, board } = createHarness({
        runSessionId: 'run.board.reuse'
    });
    const twiceId = acquireWord(
        inventory,
        WORD_DEFINITION_ID.TWICE,
        'reuse.twice'
    );
    board.beginDraft();
    board.setSubject(ABILITY_SLOT_ID.E, R3_TOWER_WORD_INSTANCE.id);
    assert.equal(board.validateDraft().valid, true);

    board.addModifier(ABILITY_SLOT_ID.Q, twiceId);
    board.addModifier(ABILITY_SLOT_ID.Q, twiceId);
    const duplicate = board.validateDraft();
    assert.equal(duplicate.valid, false);
    assert.equal(
        findSlot(duplicate, ABILITY_SLOT_ID.Q).code,
        SENTENCE_COMPILE_ERROR_CODE.DUPLICATE_MODIFIER_INSTANCE
    );
});

test('두 level-0 twice와 한 level-1 twice는 ×4 semantic parity지만 authored identity가 다르다', () => {
    const two = createHarness({ runSessionId: 'run.board.twice.two' });
    const twoFirst = acquireWord(
        two.inventory,
        WORD_DEFINITION_ID.TWICE,
        'two.first'
    );
    const twoSecond = acquireWord(
        two.inventory,
        WORD_DEFINITION_ID.TWICE,
        'two.second'
    );
    two.board.beginDraft();
    two.board.addModifier(ABILITY_SLOT_ID.Q, twoFirst);
    two.board.addModifier(ABILITY_SLOT_ID.Q, twoSecond);
    const twoValidation = two.board.validateDraft();
    const twoPreview = findSlot(twoValidation, ABILITY_SLOT_ID.Q).preview;

    const one = createHarness({ runSessionId: 'run.board.twice.one' });
    const oneId = acquireWord(
        one.inventory,
        WORD_DEFINITION_ID.TWICE,
        'one'
    );
    const upgraded = one.inventory.upgrade({
        transactionId: 'inventory.upgrade.one.level1',
        instanceId: oneId,
        expectedRevision: one.inventory.getRevision()
    });
    assert.equal(upgraded.instance.upgradeLevel, 1);
    one.board.beginDraft();
    one.board.addModifier(ABILITY_SLOT_ID.Q, oneId);
    const oneValidation = one.board.validateDraft();
    const onePreview = findSlot(oneValidation, ABILITY_SLOT_ID.Q).preview;

    assert.equal(twoValidation.valid, true);
    assert.equal(oneValidation.valid, true);
    assert.equal(twoPreview.copiesPerSubject, 4);
    assert.equal(onePreview.copiesPerSubject, 4);
    assert.equal(
        twoPreview.modifierSetFingerprint,
        onePreview.modifierSetFingerprint
    );
    assert.equal(
        findSlot(twoValidation, ABILITY_SLOT_ID.Q).compiledAbility
            .compiledAbilityId,
        findSlot(oneValidation, ABILITY_SLOT_ID.Q).compiledAbility
            .compiledAbilityId
    );
    assert.notEqual(
        twoValidation.boardFingerprint,
        oneValidation.boardFingerprint
    );
});

test('level-2 twice는 ×8이고 Merge sentence의 modifier는 거절된다', () => {
    const levelTwo = createHarness({ runSessionId: 'run.board.twice.level2' });
    const twiceId = acquireWord(
        levelTwo.inventory,
        WORD_DEFINITION_ID.TWICE,
        'level2'
    );
    for (const level of [1, 2]) {
        const upgraded = levelTwo.inventory.upgrade({
            transactionId: `inventory.upgrade.level${level}`,
            instanceId: twiceId,
            expectedRevision: levelTwo.inventory.getRevision()
        });
        assert.equal(upgraded.instance.upgradeLevel, level);
    }
    levelTwo.board.beginDraft();
    levelTwo.board.addModifier(ABILITY_SLOT_ID.Q, twiceId);
    const validation = levelTwo.board.validateDraft();
    assert.equal(
        findSlot(validation, ABILITY_SLOT_ID.Q).preview.copiesPerSubject,
        8
    );

    const merge = createHarness({ runSessionId: 'run.board.merge' });
    const mergeId = acquireWord(
        merge.inventory,
        WORD_DEFINITION_ID.MERGE,
        'merge'
    );
    const mergeTwiceId = acquireWord(
        merge.inventory,
        WORD_DEFINITION_ID.TWICE,
        'merge.twice'
    );
    merge.board.beginDraft();
    merge.board.setSubject(ABILITY_SLOT_ID.SHIFT, R3_TOWER_WORD_INSTANCE.id);
    merge.board.setVerb(ABILITY_SLOT_ID.SHIFT, mergeId);
    merge.board.setPayload(ABILITY_SLOT_ID.SHIFT, null);
    merge.board.addModifier(ABILITY_SLOT_ID.SHIFT, mergeTwiceId);
    const mergeValidation = merge.board.validateDraft();
    assert.equal(mergeValidation.valid, false);
    assert.equal(
        findSlot(mergeValidation, ABILITY_SLOT_ID.SHIFT).code,
        SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_MODIFIER_FOR_OPERATION
    );
});

test('다섯 slot commit은 invalid 하나에도 전부 무변경이고 replay/conflict가 exact하다', () => {
    const { wordSystem, board } = createHarness({
        runSessionId: 'run.board.atomic'
    });
    wordSystem.setRuntimePhase(SENTENCE_RUNTIME_PHASE.SHOP);
    const before = wordSystem.getStatusView().slots;
    board.beginDraft();
    board.clearSlot(ABILITY_SLOT_ID.Q);
    board.setVerb(ABILITY_SLOT_ID.E, R3_TOWER_WORD_INSTANCE.id);
    const rejected = board.commitDraft({ transactionId: 'board.invalid.1' });
    assert.equal(rejected.code, SENTENCE_BOARD_RESULT_CODE.INVALID_DRAFT);
    assert.strictEqual(
        board.commitDraft({ transactionId: 'board.invalid.1' }),
        rejected
    );
    assert.deepEqual(wordSystem.getStatusView().slots, before);

    board.beginDraft();
    board.clearSlot(ABILITY_SLOT_ID.E);
    const committed = board.commitDraft({ transactionId: 'board.commit.1' });
    assert.equal(committed.code, SENTENCE_BOARD_RESULT_CODE.COMMITTED);
    assert.equal(committed.wordSystemReceipt.mutationCount, 5);
    assert.strictEqual(
        board.commitDraft({ transactionId: 'board.commit.1' }),
        committed
    );

    board.clearSlot(ABILITY_SLOT_ID.Q);
    const conflict = board.commitDraft({ transactionId: 'board.commit.1' });
    assert.equal(
        conflict.code,
        SENTENCE_BOARD_RESULT_CODE.TRANSACTION_CONFLICT
    );
});

test('draft inventory revision drift는 revalidation 전 commit을 막는다', () => {
    const { inventory, wordSystem, board } = createHarness({
        runSessionId: 'run.board.drift'
    });
    wordSystem.setRuntimePhase(SENTENCE_RUNTIME_PHASE.SHOP);
    board.beginDraft();
    acquireWord(inventory, WORD_DEFINITION_ID.TWICE, 'drift');
    const receipt = board.commitDraft({ transactionId: 'board.drift.1' });
    assert.equal(receipt.code, SENTENCE_BOARD_RESULT_CODE.INVENTORY_CHANGED);
    assert.equal(wordSystem.getStatusView().rememberedEditorCommitCount, 0);
});

test('editor commit은 cooldown을 보존하고 pending activation이 있으면 막힌다', () => {
    const cooldown = createHarness({ runSessionId: 'run.board.cooldown' });
    cooldown.wordSystem.beginFixedTick(10);
    const request = cooldown.wordSystem.requestSlotActivation(
        ABILITY_SLOT_ID.Q,
        { targetFixedTick: 10 }
    );
    assert.equal(request.code, ABILITY_ACTIVATION_RESULT_CODE.REQUESTED);
    cooldown.wordSystem.drainActivationRequests();
    cooldown.wordSystem.recordExecutionOutcome({
        abilityRequestId: request.abilityRequestId,
        executionId: 'execution.cooldown.1',
        executionOrdinal: 1,
        slotId: ABILITY_SLOT_ID.Q,
        code: ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED,
        completedFixedTick: 10,
        cooldownConsumed: true
    });
    const nextEligible = cooldown.wordSystem.getSlotView(
        ABILITY_SLOT_ID.Q
    ).cooldown.nextEligibleFixedTick;
    cooldown.wordSystem.setRuntimePhase(SENTENCE_RUNTIME_PHASE.SHOP);
    cooldown.board.beginDraft();
    const committed = cooldown.board.commitDraft({
        transactionId: 'board.cooldown.1'
    });
    assert.equal(committed.accepted, true);
    assert.equal(
        cooldown.wordSystem.getSlotView(ABILITY_SLOT_ID.Q)
            .cooldown.nextEligibleFixedTick,
        nextEligible
    );

    const pending = createHarness({ runSessionId: 'run.board.pending' });
    pending.wordSystem.beginFixedTick(1);
    assert.equal(
        pending.wordSystem.requestSlotActivation(ABILITY_SLOT_ID.Q).accepted,
        true
    );
    pending.wordSystem.setRuntimePhase(SENTENCE_RUNTIME_PHASE.SHOP);
    pending.board.beginDraft();
    const blocked = pending.board.commitDraft({
        transactionId: 'board.pending.1'
    });
    assert.equal(blocked.code, SENTENCE_BOARD_RESULT_CODE.PENDING_ACTIVATION);
});

test('preview/status/receipt는 외부 mutation이 불가능한 immutable snapshot이다', () => {
    const { wordSystem, board } = createHarness({
        runSessionId: 'run.board.immutable'
    });
    wordSystem.setRuntimePhase(SENTENCE_RUNTIME_PHASE.SHOP);
    board.beginDraft();
    const validation = board.validateDraft();
    const receipt = board.commitDraft({ transactionId: 'board.immutable.1' });
    const status = board.getStatus();

    assertDeepFrozen(validation);
    assertDeepFrozen(receipt);
    assertDeepFrozen(status);
    assert.throws(() => {
        status.committedSlots.Q.subjectInstanceId = 'tampered';
    }, TypeError);
});
