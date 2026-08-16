import {
    INPUT_DISPOSITIONS,
    PLAYER_ACTION_TYPES,
    PLAYER_CONTROL_CONTEXTS
} from '../contract/player_controllable_contract.js';
import { ABILITY_SLOT_ID } from '../contract/word_sentence_contract.js';

const SLOT_INPUT_PRIORITY = 50;
const ACTION_SLOT_BY_TYPE = Object.freeze({
    [PLAYER_ACTION_TYPES.SKILL_SHIFT]: ABILITY_SLOT_ID.SHIFT,
    [PLAYER_ACTION_TYPES.SKILL_SPACE]: ABILITY_SLOT_ID.SPACE,
    [PLAYER_ACTION_TYPES.SKILL_Q]: ABILITY_SLOT_ID.Q,
    [PLAYER_ACTION_TYPES.SKILL_E]: ABILITY_SLOT_ID.E
});

/**
 * PlayerAction을 WordSystem slot activation request로 변환합니다.
 * PRIMARY_POINTER가 비어 있을 때는 PASS하여 기존 Basic Bullet이 그대로 소비합니다.
 */
export class SentenceSlotController {
    constructor(wordSystem) {
        if (!wordSystem
            || typeof wordSystem.requestSlotActivation !== 'function'
            || typeof wordSystem.hasSlotAssignment !== 'function') {
            throw new TypeError('SentenceSlotController에는 WordSystem이 필요합니다.');
        }
        this.controlTargetId = 'sentence.runtime.slots';
        this.wordSystem = wordSystem;
        this.primaryPressed = false;
        this.enabled = true;
        this.lastActivationResult = null;
    }

    getControlContext() {
        return PLAYER_CONTROL_CONTEXTS.GAMEPLAY;
    }

    getInputPriority() {
        return SLOT_INPUT_PRIORITY;
    }

    isControlEnabled() {
        return this.enabled;
    }

    handlePlayerAction(action) {
        if (!this.enabled) {
            return INPUT_DISPOSITIONS.PASS;
        }
        if (action?.type === PLAYER_ACTION_TYPES.PRIMARY_POINTER_FIRE) {
            const pressed = action.payload?.pressed === true;
            const risingEdge = pressed && !this.primaryPressed;
            this.primaryPressed = pressed;
            if (!this.wordSystem.hasSlotAssignment(
                ABILITY_SLOT_ID.PRIMARY_POINTER
            )) {
                return INPUT_DISPOSITIONS.PASS;
            }
            if (risingEdge) {
                this.lastActivationResult = this.wordSystem
                    .requestSlotActivation(ABILITY_SLOT_ID.PRIMARY_POINTER, {
                        aimViewport: {
                            x: action.payload?.viewportX,
                            y: action.payload?.viewportY
                        }
                    });
            }
            return INPUT_DISPOSITIONS.CONSUMED;
        }

        const slotId = ACTION_SLOT_BY_TYPE[action?.type];
        if (!slotId || !this.wordSystem.hasSlotAssignment(slotId)) {
            return INPUT_DISPOSITIONS.PASS;
        }
        this.lastActivationResult = this.wordSystem.requestSlotActivation(
            slotId,
            {
                aimViewport: {
                    x: action.payload?.viewportX,
                    y: action.payload?.viewportY
                }
            }
        );
        return INPUT_DISPOSITIONS.CONSUMED;
    }

    getStatus() {
        return Object.freeze({
            enabled: this.enabled,
            primaryPressed: this.primaryPressed,
            lastActivationResult: this.lastActivationResult
        });
    }

    destroy() {
        if (!this.enabled) {
            return;
        }
        this.enabled = false;
        this.primaryPressed = false;
        this.lastActivationResult = null;
        this.wordSystem = null;
    }
}
