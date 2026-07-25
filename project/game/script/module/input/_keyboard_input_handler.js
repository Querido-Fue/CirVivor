/**
 * KeyboardEvent에서 설정에 저장 가능한 물리 키 코드를 추출합니다.
 * @param {KeyboardEvent|object|null|undefined} event - DOM 키보드 이벤트입니다.
 * @returns {string|null} KeyboardEvent.code 또는 null입니다.
 */
function resolveKeyboardCode(event) {
    return typeof event?.code === 'string' && event.code.length > 0
        ? event.code
        : null;
}

/**
 * @class KeyboardInputHandler
 * @description DOM KeyboardEvent.code의 눌림 상태와 단발 edge만 관리하는 원시 입력기입니다.
 * 의미 action 변환은 InputBindingMap이 담당합니다.
 */
export class KeyboardInputHandler {
    constructor() {
        this.downCodes = new Set();
        this.pressedCodes = new Set();

        window.addEventListener('keydown', (event) => {
            this.#setCodeState(
                resolveKeyboardCode(event),
                true,
                event?.repeat === true
            );
        });

        window.addEventListener('keyup', (event) => {
            this.#setCodeState(resolveKeyboardCode(event), false);
        });

        window.addEventListener('blur', () => {
            this.resetKeyboardInput();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.resetKeyboardInput();
            }
        });
    }

    /**
     * 입력 상태를 업데이트합니다.
     */
    update() {
    }

    /**
     * 키보드 입력 상태와 대기 중인 edge를 초기화합니다.
     */
    resetKeyboardInput() {
        this.downCodes.clear();
        this.pressedCodes.clear();
    }

    /**
     * 물리 KeyboardEvent.code의 현재 눌림 상태를 반환합니다.
     * @param {string} code - KeyboardEvent.code입니다.
     * @returns {boolean} 현재 눌림 여부입니다.
     */
    isCodePressed(code) {
        return typeof code === 'string' && this.downCodes.has(code);
    }

    /**
     * 기존 직접 조회 호출을 물리 코드 조회에 연결합니다.
     * 의미 action 조회는 InputSystem.getKeyboardInput()을 사용해야 합니다.
     * @param {string} code - KeyboardEvent.code입니다.
     * @returns {boolean} 현재 눌림 여부입니다.
     */
    getKeyboardInput(code) {
        return this.isCodePressed(code);
    }

    /**
     * 물리 KeyboardEvent.code의 반복되지 않은 누름 edge를 한 번 소비합니다.
     * @param {string} code - KeyboardEvent.code입니다.
     * @returns {boolean} 대기 중인 누름 edge를 소비했는지 여부입니다.
     */
    consumeCodePress(code) {
        if (typeof code !== 'string' || !this.pressedCodes.has(code)) {
            return false;
        }

        this.pressedCodes.delete(code);
        return true;
    }

    /**
     * 기존 직접 edge 소비 호출을 물리 코드 소비에 연결합니다.
     * 의미 action 소비는 InputSystem.consumeKeyboardPress()를 사용해야 합니다.
     * @param {string} code - KeyboardEvent.code입니다.
     * @returns {boolean} 대기 중인 누름 edge를 소비했는지 여부입니다.
     */
    consumeKeyboardPress(code) {
        return this.consumeCodePress(code);
    }

    /**
     * 물리 코드 상태를 내부 Set에 반영합니다.
     * @param {string|null} code - KeyboardEvent.code입니다.
     * @param {boolean} isPressed - 눌림 여부입니다.
     * @param {boolean} [isRepeat=false] - 브라우저 자동 반복 keydown 여부입니다.
     * @private
     */
    #setCodeState(code, isPressed, isRepeat = false) {
        if (!code) {
            return;
        }

        const wasPressed = this.downCodes.has(code);
        if (isPressed === true) {
            this.downCodes.add(code);
            if (!wasPressed && isRepeat !== true) {
                this.pressedCodes.add(code);
            }
            return;
        }

        this.downCodes.delete(code);
    }
}
