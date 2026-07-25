import { MouseInputHandler } from './_mouse_input_handler.js';
import { KeyboardInputHandler } from './_keyboard_input_handler.js';
import { InputBindingMap } from './_input_binding_map.js';
import { resolveFiniteNumber } from 'util/number_util.js';

let inputSystemInstance = null;
const DEFAULT_MOUSE_BUTTON_SNAPSHOT = Object.freeze(['idle']);
const DEFAULT_FOCUS_SNAPSHOT = Object.freeze(['ui', 'object']);

/**
 * 입력 배열을 재사용 대상 배열에 복사합니다.
 * @param {Array<*>} target - 제자리에서 갱신할 대상 배열입니다.
 * @param {Array<*>|unknown} source - 우선 복사할 입력 배열입니다.
 * @param {Array<*>} fallback - source가 배열이 아닐 때 복사할 기본 배열입니다.
 * @returns {void}
 */
function copyInputArrayInto(target, source, fallback) {
    target.length = 0;
    const values = Array.isArray(source) ? source : fallback;
    for (let i = 0; i < values.length; i++) {
        target.push(values[i]);
    }
}

/**
 * 의미 action의 own 상태를 재사용 대상 객체에 동기화합니다.
 * @param {Record<string, boolean>} target - 제자리에서 갱신할 action 상태 객체입니다.
 * @param {Record<string, unknown>} source - 현재 action 상태 객체입니다.
 * @returns {void}
 */
function copyInputActionStatesInto(target, source) {
    for (const key in target) {
        if (Object.prototype.hasOwnProperty.call(target, key)
            && !Object.prototype.hasOwnProperty.call(source, key)) {
            delete target[key];
        }
    }
    for (const key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            target[key] = source[key] === true;
        }
    }
}

/**
 * 재사용 가능한 시뮬레이션 입력 스냅샷 버퍼를 생성합니다.
 * @returns {{mousePos: {x: number, y: number}, wheel: {x:number,y:number}, mouseButtons: {left: Array<*>, right: Array<*>, middle: Array<*>}, focusList: Array<*>, actionStates: Record<string, boolean>, keys: Record<string, boolean>}} 새 입력 스냅샷 버퍼입니다.
 */
function createSimulationInputSnapshotBuffer() {
    return {
        mousePos: { x: 0, y: 0 },
        wheel: { x: 0, y: 0 },
        mouseButtons: { left: [], right: [], middle: [] },
        focusList: [],
        actionStates: {},
        keys: {}
    };
}

/**
 * @class InputSystem
 * @description 게임의 마우스 및 키보드 입력을 처리하고 관리하는 시스템입니다.
 */
export class InputSystem {
    /**
     * @param {{bindings?:Record<string,string[]>}} [options={}] - 초기 사용자 키 바인딩입니다.
     */
    constructor(options = {}) {
        inputSystemInstance = this;
        this.mouseInputHandler = new MouseInputHandler();
        this.keyboardInputHandler = new KeyboardInputHandler();
        this.bindingMap = new InputBindingMap(options.bindings);
        this.actionStateScratch = {};
    }

    async init() {
    }

    draw() {
    }

    /**
     * 입력 시스템의 상태를 업데이트합니다.
     * 마우스와 키보드 입력을 처리합니다.
     */
    update() {
        this.mouseInputHandler.update();
        this.keyboardInputHandler.update();
    }

    /**
     * 마우스와 키보드 입력 상태를 모두 초기화합니다.
     * 창 비활성화 후 복귀 시 남아 있는 눌림 상태를 제거합니다.
     * @param {{mouseInactive?: boolean}} [options={}] - 마우스를 inactive 상태로 둘지 여부입니다.
     */
    resetAllInputState(options = {}) {
        this.mouseInputHandler.resetMouseInput({ inactive: options.mouseInactive === true });
        this.keyboardInputHandler.resetKeyboardInput();
    }

    /**
     * settings.json에서 읽은 사용자 키 바인딩 오버라이드를 즉시 적용합니다.
     * @param {Record<string,string[]>} [bindings={}] - action별 KeyboardEvent.code 배열입니다.
     * @returns {Record<string,string[]>} 정규화된 전체 바인딩 복사본입니다.
     */
    setBindings(bindings = {}) {
        const normalizedBindings = this.bindingMap.replaceOverrides(bindings);
        this.keyboardInputHandler.resetKeyboardInput();
        return normalizedBindings;
    }

    /**
     * 현재 정규화된 전체 키 바인딩을 반환합니다.
     * @param {Record<string,string[]>} [out={}] - 재사용 대상입니다.
     * @returns {Record<string,string[]>} 호출자가 소유하는 바인딩입니다.
     */
    getBindings(out = {}) {
        return this.bindingMap.getBindings(out);
    }

    /**
     * 모든 키 바인딩을 입력 모듈의 기본 배치로 되돌립니다.
     * @returns {Record<string,string[]>} 기본 바인딩 복사본입니다.
     */
    resetBindings() {
        const defaultBindings = this.bindingMap.reset();
        this.keyboardInputHandler.resetKeyboardInput();
        return defaultBindings;
    }

    /**
     * 지정한 의미 action의 현재 눌림 상태를 반환합니다.
     * @param {string} actionId - 의미 입력 ID 또는 legacy 의미 별칭입니다.
     * @returns {boolean} action 활성 여부입니다.
     */
    isActionPressed(actionId) {
        return this.bindingMap.isActionPressed(actionId, this.keyboardInputHandler);
    }

    /**
     * 지정한 의미 action의 단발 누름 edge를 소비합니다.
     * @param {string} actionId - 의미 입력 ID 또는 legacy 의미 별칭입니다.
     * @returns {boolean} 하나 이상의 물리 edge를 소비했는지 여부입니다.
     */
    consumeActionPress(actionId) {
        return this.bindingMap.consumeActionPress(actionId, this.keyboardInputHandler);
    }

    /**
     * 시뮬레이션 런타임에 전달할 입력 스냅샷을 최신 입력과 정확히 동기화합니다.
     * 재사용 가능한 `out`이 있으면 같은 객체와 기존 mousePos·wheel·버튼 배열·focusList·actionStates
     * 컨테이너를 제자리에서 갱신합니다. 물리 KeyboardEvent.code는 스냅샷에 노출하지 않습니다.
     * `keys`는 의미 action 상태를 담는 임시 호환 별칭입니다.
     * @param {object|null} [out=null] - 갱신할 재사용 스냅샷입니다.
     * @returns {{mousePos: {x: number, y: number}, wheel:{x:number,y:number}, mouseButtons: {left: string[], right: string[], middle: string[]}, focusList: string[], actionStates:Record<string,boolean>, keys: Record<string, boolean>}} 유효한 `out`을 전달하면 동일한 객체, 아니면 새 스냅샷입니다.
     */
    getSimulationInputSnapshot(out = null) {
        const mouseButtons = this.mouseInputHandler?.mouseButtons || {};
        const snapshot = out && typeof out === 'object'
            ? out
            : createSimulationInputSnapshotBuffer();
        snapshot.mousePos ||= { x: 0, y: 0 };
        snapshot.wheel ||= { x: 0, y: 0 };
        snapshot.mouseButtons ||= { left: [], right: [], middle: [] };
        snapshot.mouseButtons.left ||= [];
        snapshot.mouseButtons.right ||= [];
        snapshot.mouseButtons.middle ||= [];
        snapshot.focusList ||= [];
        snapshot.actionStates ||= {};
        snapshot.keys ||= {};

        snapshot.mousePos.x = resolveFiniteNumber(Number(this.mouseInputHandler?.mousePos?.x), 0);
        snapshot.mousePos.y = resolveFiniteNumber(Number(this.mouseInputHandler?.mousePos?.y), 0);
        if (typeof this.mouseInputHandler?.copyWheelTotalsInto === 'function') {
            this.mouseInputHandler.copyWheelTotalsInto(snapshot.wheel);
        } else {
            snapshot.wheel.x = 0;
            snapshot.wheel.y = 0;
        }
        snapshot.wheel.x = resolveFiniteNumber(Number(snapshot.wheel.x), 0);
        snapshot.wheel.y = resolveFiniteNumber(Number(snapshot.wheel.y), 0);
        copyInputArrayInto(snapshot.mouseButtons.left, mouseButtons.left?.state, DEFAULT_MOUSE_BUTTON_SNAPSHOT);
        copyInputArrayInto(snapshot.mouseButtons.right, mouseButtons.right?.state, DEFAULT_MOUSE_BUTTON_SNAPSHOT);
        copyInputArrayInto(snapshot.mouseButtons.middle, mouseButtons.middle?.state, DEFAULT_MOUSE_BUTTON_SNAPSHOT);
        copyInputArrayInto(snapshot.focusList, this.mouseInputHandler?.focusList, DEFAULT_FOCUS_SNAPSHOT);
        this.bindingMap.writeActionStates(
            this.keyboardInputHandler,
            this.actionStateScratch
        );
        copyInputActionStatesInto(snapshot.actionStates, this.actionStateScratch);
        copyInputActionStatesInto(snapshot.keys, this.actionStateScratch);
        return snapshot;
    }
}

/**
 * 마우스 입력 상태를 반환합니다.
 * @param {string} key - 입력 키 (x, y, left, right, middle 등)
 * @returns {any} 마우스 입력 값
 */
export const getMouseInput = (key) => inputSystemInstance.mouseInputHandler.getMouseInput(key);

/**
 * 지정한 마우스 버튼 상태 배열에 특정 상태가 포함되어 있는지 검사합니다.
 * @param {'left'|'right'|'middle'} button - 검사할 버튼 이름
 * @param {'inactive'|'idle'|'click'|'clicking'|'clicked'} state - 검사할 상태 이름
 * @param {{includeConsumed?: boolean}} [options={}] - 소비된 상태 포함 여부 옵션입니다.
 * @returns {boolean} 상태 포함 여부
 */
export const hasMouseState = (button, state, options = {}) => inputSystemInstance.mouseInputHandler.hasButtonState(button, state, options);

/**
 * 지정한 마우스 버튼의 단발성 상태를 소비 처리합니다.
 * 현재는 `clicked` 상태만 소비 대상으로 사용합니다.
 * @param {'left'|'right'|'middle'} button - 소비할 버튼 이름입니다.
 * @param {'clicked'} [state='clicked'] - 소비할 상태 이름입니다.
 * @returns {boolean} 실제로 소비되었으면 true를 반환합니다.
 */
export const consumeMouseState = (button, state = 'clicked') => inputSystemInstance.mouseInputHandler.consumeButtonState(button, state);

/**
 * 지정한 마우스 버튼이 현재 눌림 계열 상태인지 반환합니다.
 * `click`과 `clicking`을 동일한 누름 계열로 취급합니다.
 * @param {'left'|'right'|'middle'} button - 검사할 버튼 이름
 * @returns {boolean} 누름 계열 상태 여부
 */
export const isMousePressing = (button) => hasMouseState(button, 'click') || hasMouseState(button, 'clicking');
/**
 * 현재 마우스 포커스 스택의 내부 배열 참조를 반환합니다.
 * 배열 끝이 최상위 포커스입니다. `addMouseFocus()`와 `removeMouseFocus()`는 현재 배열을 제자리에서 변경하고,
 * `setMouseFocus()`는 새 배열로 교체하므로 이전에 받은 참조가 이후의 새 스택을 가리키지는 않습니다.
 * 호출자는 반환 배열을 읽기 전용으로 취급해야 합니다.
 * @returns {string[]} 호출 시점의 마우스 포커스 스택 배열 참조입니다.
 */
export const getMouseFocus = () => inputSystemInstance.mouseInputHandler.focusList;

/**
 * 마우스 포커스를 추가합니다.
 * @param {string} focus - 추가할 포커스 레이어
 * @returns {void}
 */
export const addMouseFocus = (focus) => inputSystemInstance.mouseInputHandler.addFocus(focus);

/**
 * 마우스 포커스를 제거합니다.
 * @param {string} focus - 제거할 포커스 레이어
 * @returns {void}
 */
export const removeMouseFocus = (focus) => inputSystemInstance.mouseInputHandler.removeFocus(focus);
/**
 * 기존 마우스 포커스 스택 전체를 새 배열로 교체합니다.
 * 배열 입력은 얕게 복제하고 문자열 입력은 단일 항목 스택으로 감쌉니다.
 * @param {string|string[]} focus - 새 포커스 스택 또는 단일 포커스 레이어입니다.
 * @returns {void}
 */
export const setMouseFocus = (focus) => inputSystemInstance.mouseInputHandler.setFocus(focus);
/**
 * 키보드에 연결된 의미 action의 현재 상태를 반환합니다.
 * 물리 KeyboardEvent.code를 직접 조회하지 않습니다.
 * @param {string} actionId - 의미 action ID 또는 legacy 의미 별칭입니다.
 * @returns {boolean} action 활성 여부입니다.
 */
export const getKeyboardInput = (actionId) => inputSystemInstance?.isActionPressed?.(actionId) === true;
/**
 * 지정한 의미 action에 연결된 반복되지 않은 누름 edge를 한 번 소비합니다.
 * @param {string} actionId - 소비할 의미 action ID 또는 legacy 의미 별칭입니다.
 * @returns {boolean} 누름 edge 소비 여부입니다.
 */
export const consumeKeyboardPress = (actionId) => inputSystemInstance?.consumeActionPress?.(actionId) === true;
/**
 * 키보드 입력 상태를 초기화합니다.
 * @returns {void}
 */
export const resetKeyboardInput = () => inputSystemInstance.keyboardInputHandler.resetKeyboardInput();

/**
 * 사용자 키 바인딩 오버라이드를 가장 최근 InputSystem에 적용합니다.
 * @param {Record<string,string[]>} [bindings={}] - action별 KeyboardEvent.code 배열입니다.
 * @returns {Record<string,string[]>} 정규화된 전체 바인딩입니다.
 */
export const setInputBindings = (bindings = {}) => inputSystemInstance.setBindings(bindings);

/**
 * 현재 정규화된 전체 키 바인딩을 복사해 반환합니다.
 * @param {Record<string,string[]>} [out={}] - 재사용 대상입니다.
 * @returns {Record<string,string[]>} 호출자가 소유하는 바인딩입니다.
 */
export const getInputBindings = (out = {}) => inputSystemInstance.getBindings(out);

/**
 * 모든 키 바인딩을 기본 배치로 되돌립니다.
 * @returns {Record<string,string[]>} 기본 바인딩 복사본입니다.
 */
export const resetInputBindings = () => inputSystemInstance.resetBindings();
