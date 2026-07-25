import {
    DEFAULT_KEYBOARD_BINDINGS,
    LEGACY_INPUT_ACTION_ALIASES
} from './_input_binding_constants.js';

const MAX_BINDINGS_PER_ACTION = 4;
const MAX_KEYBOARD_CODE_LENGTH = 64;
const KEYBOARD_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;
const INPUT_ACTION_LIST = Object.freeze(Object.keys(DEFAULT_KEYBOARD_BINDINGS));

/**
 * 설정에서 읽은 KeyboardEvent.code 후보를 검증합니다.
 * @param {*} value - 검증할 값입니다.
 * @returns {boolean} 지원 가능한 물리 키 코드인지 여부입니다.
 */
function isValidKeyboardCode(value) {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= MAX_KEYBOARD_CODE_LENGTH
        && KEYBOARD_CODE_PATTERN.test(value);
}

/**
 * action별 코드 배열을 호출자 소유 객체에 깊이 복사합니다.
 * @param {Record<string, string[]>} source - 복사할 바인딩입니다.
 * @param {Record<string, string[]>} [out={}] - 재사용 대상입니다.
 * @returns {Record<string, string[]>} 갱신한 대상 객체입니다.
 */
function copyBindingMapInto(source, out = {}) {
    for (const key of Object.keys(out)) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
            delete out[key];
        }
    }
    for (const actionId of INPUT_ACTION_LIST) {
        const targetCodes = Array.isArray(out[actionId]) ? out[actionId] : [];
        targetCodes.length = 0;
        targetCodes.push(...source[actionId]);
        out[actionId] = targetCodes;
    }
    return out;
}

/**
 * @class InputBindingMap
 * @description 사용자 오버라이드를 검증해 물리 KeyboardEvent.code와 의미 action을 연결합니다.
 */
export class InputBindingMap {
    /**
     * @param {Record<string, string[]>} [overrides={}] - settings.json의 사용자 오버라이드입니다.
     */
    constructor(overrides = {}) {
        this.bindings = {};
        this.replaceOverrides(overrides);
    }

    /**
     * 사용자 오버라이드를 기본 배치 위에 적용합니다.
     * 명시적인 빈 배열은 해당 action을 미지정 상태로 유지합니다.
     * @param {Record<string, string[]>} [overrides={}] - 새 사용자 오버라이드입니다.
     * @returns {Record<string, string[]>} 정규화된 전체 바인딩 복사본입니다.
     */
    replaceOverrides(overrides = {}) {
        const source = overrides && typeof overrides === 'object'
            ? overrides
            : {};

        for (const actionId of INPUT_ACTION_LIST) {
            const hasOverride = Object.prototype.hasOwnProperty.call(source, actionId);
            const rawCodes = hasOverride ? source[actionId] : DEFAULT_KEYBOARD_BINDINGS[actionId];
            const fallbackCodes = DEFAULT_KEYBOARD_BINDINGS[actionId];
            const candidateCodes = Array.isArray(rawCodes) ? rawCodes : fallbackCodes;
            const normalizedCodes = [];

            for (let index = 0;
                index < candidateCodes.length
                && normalizedCodes.length < MAX_BINDINGS_PER_ACTION;
                index++) {
                const code = candidateCodes[index];
                if (!isValidKeyboardCode(code) || normalizedCodes.includes(code)) {
                    continue;
                }
                normalizedCodes.push(code);
            }

            this.bindings[actionId] = normalizedCodes;
        }

        return this.getBindings();
    }

    /**
     * 모든 action을 기본 키 배치로 되돌립니다.
     * @returns {Record<string, string[]>} 기본 바인딩 복사본입니다.
     */
    reset() {
        return this.replaceOverrides({});
    }

    /**
     * 현재 정규화된 전체 바인딩을 깊이 복사합니다.
     * @param {Record<string, string[]>} [out={}] - 재사용 대상입니다.
     * @returns {Record<string, string[]>} 호출자가 소유하는 바인딩입니다.
     */
    getBindings(out = {}) {
        return copyBindingMapInto(this.bindings, out);
    }

    /**
     * 지정한 action의 물리 코드 중 하나라도 현재 눌려 있는지 확인합니다.
     * @param {string} actionId - 의미 입력 ID 또는 legacy 의미 별칭입니다.
     * @param {{isCodePressed:(code:string)=>boolean}} keyboardHandler - 원시 키보드 입력기입니다.
     * @returns {boolean} action 활성 여부입니다.
     */
    isActionPressed(actionId, keyboardHandler) {
        const resolvedActionId = LEGACY_INPUT_ACTION_ALIASES[actionId] || actionId;
        const codes = this.bindings[resolvedActionId];
        if (!Array.isArray(codes)) {
            return false;
        }
        for (let index = 0; index < codes.length; index++) {
            if (keyboardHandler?.isCodePressed?.(codes[index]) === true) {
                return true;
            }
        }
        return false;
    }

    /**
     * 지정한 action에 연결된 모든 누름 edge를 한 action edge로 소비합니다.
     * @param {string} actionId - 의미 입력 ID 또는 legacy 의미 별칭입니다.
     * @param {{consumeCodePress:(code:string)=>boolean}} keyboardHandler - 원시 키보드 입력기입니다.
     * @returns {boolean} 하나 이상의 물리 edge를 소비했는지 여부입니다.
     */
    consumeActionPress(actionId, keyboardHandler) {
        const resolvedActionId = LEGACY_INPUT_ACTION_ALIASES[actionId] || actionId;
        const codes = this.bindings[resolvedActionId];
        if (!Array.isArray(codes)) {
            return false;
        }

        let consumed = false;
        for (let index = 0; index < codes.length; index++) {
            if (keyboardHandler?.consumeCodePress?.(codes[index]) === true) {
                consumed = true;
            }
        }
        return consumed;
    }

    /**
     * 모든 action의 현재 눌림 상태를 재사용 객체에 기록합니다.
     * @param {{isCodePressed:(code:string)=>boolean}} keyboardHandler - 원시 키보드 입력기입니다.
     * @param {Record<string, boolean>} [out={}] - 상태 기록 대상입니다.
     * @returns {Record<string, boolean>} 갱신한 동일 객체입니다.
     */
    writeActionStates(keyboardHandler, out = {}) {
        for (const key of Object.keys(out)) {
            if (!Object.prototype.hasOwnProperty.call(this.bindings, key)) {
                delete out[key];
            }
        }
        for (const actionId of INPUT_ACTION_LIST) {
            out[actionId] = this.isActionPressed(actionId, keyboardHandler);
        }
        return out;
    }
}
