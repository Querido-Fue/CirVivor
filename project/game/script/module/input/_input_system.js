import { MouseInputHandler } from "./mouse_input_handler.js";
import { KeyboardInputHandler } from "./keyboard_input_handler.js";

let inputSystemInstance = null;

export class InputSystem {
    constructor() {
        inputSystemInstance = this;
        this.mouseInputHandler = new MouseInputHandler();
        this.keyboardInputHandler = new KeyboardInputHandler();
    }

    async init() {
    }

    _draw() {
    }

    /**
     * @private
     * 입력 시스템의 상태를 업데이트합니다.
     * 마우스와 키보드 입력을 처리합니다.
     */
    _update() {
        this.mouseInputHandler._update();
        this.keyboardInputHandler._update();
    }
}

/**
 * 마우스 입력 상태를 반환합니다.
 * @param {string} key - 입력 키 (x, y, leftClicked, leftClicking 등)
 * @returns {any} 마우스 입력 값
 */
export const getMouseInput = (key) => inputSystemInstance.mouseInputHandler.getMouseInput(key);
/**
 * 현재 마우스 포커스 레이어를 반환합니다.
 * @returns {string} 포커스 레이어 이름
 */
export const getMouseFocus = () => inputSystemInstance.mouseInputHandler.focus;

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