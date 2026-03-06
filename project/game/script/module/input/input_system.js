import { MouseInputHandler } from "./_mouse_input_handler.js";
import { KeyboardInputHandler } from "./_keyboard_input_handler.js";

let inputSystemInstance = null;

/**
 * @class InputSystem
 * @description 게임의 마우스 및 키보드 입력을 처리하고 관리하는 시스템입니다.
 */
export class InputSystem {
    constructor() {
        inputSystemInstance = this;
        this.mouseInputHandler = new MouseInputHandler();
        this.keyboardInputHandler = new KeyboardInputHandler();
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
 * @param {'idle'|'click'|'clicking'|'clicked'} state - 검사할 상태 이름
 * @returns {boolean} 상태 포함 여부
 */
export const hasMouseState = (button, state) => {
    const mouseState = inputSystemInstance.mouseInputHandler.getMouseInput(button);
    return Array.isArray(mouseState) ? mouseState.includes(state) : false;
};

/**
 * 지정한 마우스 버튼이 현재 눌림 계열 상태인지 반환합니다.
 * `click`과 `clicking`을 동일한 누름 계열로 취급합니다.
 * @param {'left'|'right'|'middle'} button - 검사할 버튼 이름
 * @returns {boolean} 누름 계열 상태 여부
 */
export const isMousePressing = (button) => hasMouseState(button, 'click') || hasMouseState(button, 'clicking');
/**
 * 현재 마우스 포커스 레이어를 반환합니다.
 * @returns {string} 포커스 레이어 이름
 */
export const getMouseFocus = () => inputSystemInstance.mouseInputHandler.focusList;

/**
 * 마우스 포커스를 추가합니다.
 * @param {string} focus - 추가할 포커스 레이어
 */
export const addMouseFocus = (focus) => inputSystemInstance.mouseInputHandler.addFocus(focus);

/**
 * 마우스 포커스를 제거합니다.
 * @param {string} focus - 제거할 포커스 레이어
 */
export const removeMouseFocus = (focus) => inputSystemInstance.mouseInputHandler.removeFocus(focus);
/**
 * 마우스 포커스 레이어를 설정합니다.
 * @param {string} focus - 포커스 레이어 이름
 */
export const setMouseFocus = (focus) => inputSystemInstance.mouseInputHandler.setFocus(focus);
/**
 * 키보드 키 입력 상태를 반환합니다.
 * @param {string} key - 키 코드 (예: 'ArrowUp', 'Space')
 * @returns {boolean} 키 눌림 여부
 */
export const getKeyboardInput = (key) => inputSystemInstance.keyboardInputHandler.getKeyboardInput(key);
/**
 * 키보드 입력 상태를 초기화합니다.
 */
export const resetKeyboardInput = () => inputSystemInstance.keyboardInputHandler.resetKeyboardInput();
