import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    DEFAULT_KEYBOARD_BINDINGS,
    INPUT_ACTION_IDS
} = await loadGameModule('input/_input_binding_constants.js');
const {
    INPUT_DISPOSITIONS,
    PLAYER_ACTION_TYPES,
    PLAYER_CONTROL_CONTEXTS
} = await loadGameModule('ingame/contract/player_controllable_contract.js');
const {
    ABILITY_SLOT_ID
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    R3_TOWER_SHOOTS_ENEMY_SENTENCE
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    InputActionMapper
} = await loadGameModule('ingame/input/input_action_mapper.js');
const {
    PlayerControlRouter
} = await loadGameModule('ingame/input/player_control_router.js');
const {
    WordSystem
} = await loadGameModule('ingame/word/word_system.js');
const {
    SentenceSlotController
} = await loadGameModule('ingame/word/sentence_slot_controller.js');

test('Shift/Space/Q/E default bindings와 semantic action identity가 물리 키와 분리된다', () => {
    assert.deepEqual(
        Array.from(DEFAULT_KEYBOARD_BINDINGS[INPUT_ACTION_IDS.SKILL_SHIFT]),
        ['ShiftLeft', 'ShiftRight']
    );
    assert.deepEqual(
        Array.from(DEFAULT_KEYBOARD_BINDINGS[INPUT_ACTION_IDS.SKILL_SPACE]),
        ['Space']
    );
    assert.deepEqual(
        Array.from(DEFAULT_KEYBOARD_BINDINGS[INPUT_ACTION_IDS.SKILL_Q]),
        ['KeyQ']
    );
    assert.deepEqual(
        Array.from(DEFAULT_KEYBOARD_BINDINGS[INPUT_ACTION_IDS.SKILL_E]),
        ['KeyE']
    );
    assert.deepEqual({
        shift: PLAYER_ACTION_TYPES.SKILL_SHIFT,
        space: PLAYER_ACTION_TYPES.SKILL_SPACE,
        q: PLAYER_ACTION_TYPES.SKILL_Q,
        e: PLAYER_ACTION_TYPES.SKILL_E
    }, {
        shift: 'skillShift',
        space: 'skillSpace',
        q: 'skillQ',
        e: 'skillE'
    });
});

test('InputActionMapper는 한 physical held 구간에서 skill execution edge를 하나만 만든다', () => {
    const mapper = new InputActionMapper();
    const pressed = new Set();
    const inputSource = {
        isPressed(actionId) {
            return pressed.has(actionId);
        }
    };

    pressed.add(INPUT_ACTION_IDS.SKILL_Q);
    const first = mapper.mapSkillEdgeActions(inputSource);
    assert.equal(first.length, 1);
    assert.equal(first[0].type, PLAYER_ACTION_TYPES.SKILL_Q);
    const qAction = first[0];

    assert.equal(mapper.mapSkillEdgeActions(inputSource).length, 0);
    pressed.delete(INPUT_ACTION_IDS.SKILL_Q);
    assert.equal(mapper.mapSkillEdgeActions(inputSource).length, 0);
    pressed.add(INPUT_ACTION_IDS.SKILL_Q);
    const second = mapper.mapSkillEdgeActions(inputSource);
    assert.equal(second.length, 1);
    assert.strictEqual(second[0], qAction);

    pressed.add(INPUT_ACTION_IDS.SKILL_SHIFT);
    pressed.add(INPUT_ACTION_IDS.SKILL_SPACE);
    pressed.add(INPUT_ACTION_IDS.SKILL_E);
    const ordered = mapper.mapSkillEdgeActions(inputSource);
    assert.deepEqual(ordered.map(({ type }) => type), [
        PLAYER_ACTION_TYPES.SKILL_SHIFT,
        PLAYER_ACTION_TYPES.SKILL_SPACE,
        PLAYER_ACTION_TYPES.SKILL_E
    ]);
});

test('PlayerControlRouter에서 assigned PRIMARY slot만 Basic Bullet compatibility target보다 먼저 소비한다', () => {
    const wordSystem = new WordSystem();
    const slotController = new SentenceSlotController(wordSystem);
    const router = new PlayerControlRouter();
    let compatibilityCalls = 0;
    const compatibilityTarget = {
        controlTargetId: 'fixture.primary.compatibility',
        getControlContext: () => PLAYER_CONTROL_CONTEXTS.GAMEPLAY,
        getInputPriority: () => 0,
        isControlEnabled: () => true,
        handlePlayerAction(action) {
            if (action.type !== PLAYER_ACTION_TYPES.PRIMARY_POINTER_FIRE) {
                return INPUT_DISPOSITIONS.PASS;
            }
            if (action.payload?.pressed === true) {
                compatibilityCalls++;
            }
            return INPUT_DISPOSITIONS.CONSUMED;
        }
    };
    router.register(compatibilityTarget);
    router.register(slotController);
    wordSystem.beginFixedTick(1);

    assert.equal(router.dispatch({
        type: PLAYER_ACTION_TYPES.PRIMARY_POINTER_FIRE,
        payload: { pressed: true }
    }), INPUT_DISPOSITIONS.CONSUMED);
    assert.equal(compatibilityCalls, 1);

    router.dispatch({
        type: PLAYER_ACTION_TYPES.PRIMARY_POINTER_FIRE,
        payload: { pressed: false }
    });
    wordSystem.setSlotSentence(
        ABILITY_SLOT_ID.PRIMARY_POINTER,
        R3_TOWER_SHOOTS_ENEMY_SENTENCE
    );
    wordSystem.beginFixedTick(2);
    assert.equal(router.dispatch({
        type: PLAYER_ACTION_TYPES.PRIMARY_POINTER_FIRE,
        payload: { pressed: true }
    }), INPUT_DISPOSITIONS.CONSUMED);
    assert.equal(compatibilityCalls, 1);
    assert.equal(wordSystem.drainActivationRequests().length, 1);

    router.destroy();
    slotController.destroy();
    wordSystem.destroy();
});
