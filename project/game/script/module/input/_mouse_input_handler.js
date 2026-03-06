import { getScaleRatio, getCanvasOffset } from 'display/display_system.js';

const MOUSE_BUTTON_STATE_LISTS = Object.freeze({
    idle: Object.freeze(['idle']),
    click: Object.freeze(['click', 'clicking']),
    clicking: Object.freeze(['clicking']),
    clicked: Object.freeze(['idle', 'clicked'])
});

const MOUSE_BUTTON_CODES = Object.freeze({
    0: 'left',
    1: 'middle',
    2: 'right'
});

/**
 * @class MouseInputHandler
 * @description 마우스 입력을 관리하는 클래스입니다.
 * 마우스 위치와 버튼별 상태 배열을 추적합니다.
 */
export class MouseInputHandler {
    constructor() {
        this.mousePos = { x: 0, y: 0 };
        this.mouseButtons = {
            left: this.#createButtonState(),
            right: this.#createButtonState(),
            middle: this.#createButtonState()
        };

        this.focusList = ["ui", "object"]; // 기본 포커스

        window.addEventListener("mousemove", (e) => {
            this.#updateMousePosition(e);
        });
        window.addEventListener("mousedown", (e) => {
            this.#queueButtonStateChange(e.button, 'press');
        });
        window.addEventListener("mouseup", (e) => {
            this.#queueButtonStateChange(e.button, 'release');
        });
        window.addEventListener("blur", () => {
            this.#resetAllButtons();
        });
        document.addEventListener("mouseleave", () => {
            this.#resetAllButtons();
        });
    }

    /**
     * @private
     * 버튼 상태 초기값을 생성합니다.
     * @returns {{physicalDown: boolean, state: readonly string[], queuedEvents: string[]}}
     */
    #createButtonState() {
        return {
            physicalDown: false,
            state: MOUSE_BUTTON_STATE_LISTS.idle,
            queuedEvents: []
        };
    }

    /**
     * @private
     * DOM 이벤트 좌표를 내부 게임 좌표로 변환합니다.
     * @param {MouseEvent} event - 원본 마우스 이벤트
     */
    #updateMousePosition(event) {
        const scale = getScaleRatio();
        const offset = getCanvasOffset();
        this.mousePos.x = (event.clientX - offset.x) * scale;
        this.mousePos.y = (event.clientY - offset.y) * scale;
    }

    /**
     * @private
     * 브라우저 버튼 번호를 내부 버튼 이름으로 변환합니다.
     * @param {number} buttonCode - DOM 마우스 버튼 코드
     * @returns {'left'|'right'|'middle'|null} 내부 버튼 이름
     */
    #resolveButtonName(buttonCode) {
        return MOUSE_BUTTON_CODES[buttonCode] || null;
    }

    /**
     * @private
     * 버튼 상태 전이 이벤트를 큐에 적재합니다.
     * @param {number} buttonCode - DOM 마우스 버튼 코드
     * @param {'press'|'release'} eventType - 상태 전이 종류
     */
    #queueButtonStateChange(buttonCode, eventType) {
        const buttonName = this.#resolveButtonName(buttonCode);
        if (!buttonName) return;

        const button = this.mouseButtons[buttonName];
        if (!button) return;

        if (eventType === 'press') {
            if (button.physicalDown) return;
            button.physicalDown = true;
            button.queuedEvents.push('press');
            return;
        }

        if (!button.physicalDown) return;
        button.physicalDown = false;
        button.queuedEvents.push('release');
    }

    /**
     * @private
     * 버튼별 상태머신을 한 프레임만큼 전진시킵니다.
     * @param {'left'|'right'|'middle'} buttonName - 내부 버튼 이름
     */
    #updateButton(buttonName) {
        const button = this.mouseButtons[buttonName];
        if (!button) return;

        if (button.queuedEvents.length > 0) {
            const nextEvent = button.queuedEvents.shift();
            if (nextEvent === 'press') {
                button.state = MOUSE_BUTTON_STATE_LISTS.click;
                return;
            }
            if (nextEvent === 'release') {
                button.state = MOUSE_BUTTON_STATE_LISTS.clicked;
                return;
            }
        }

        if (button.state === MOUSE_BUTTON_STATE_LISTS.click) {
            button.state = button.physicalDown
                ? MOUSE_BUTTON_STATE_LISTS.clicking
                : MOUSE_BUTTON_STATE_LISTS.clicked;
            return;
        }

        if (button.state === MOUSE_BUTTON_STATE_LISTS.clicking) {
            if (!button.physicalDown) {
                button.state = MOUSE_BUTTON_STATE_LISTS.clicked;
            }
            return;
        }

        if (button.state === MOUSE_BUTTON_STATE_LISTS.clicked) {
            button.state = MOUSE_BUTTON_STATE_LISTS.idle;
            return;
        }

        button.state = MOUSE_BUTTON_STATE_LISTS.idle;
    }

    /**
     * @private
     * 모든 버튼 입력을 즉시 초기 상태로 리셋합니다.
     */
    #resetAllButtons() {
        Object.values(this.mouseButtons).forEach((button) => {
            button.physicalDown = false;
            button.queuedEvents.length = 0;
            button.state = MOUSE_BUTTON_STATE_LISTS.idle;
        });
    }

    /**
     * 입력 상태를 업데이트합니다. (주로 마우스 클릭 상태 처리)
     */
    update() {
        this.#updateButton('left');
        this.#updateButton('right');
        this.#updateButton('middle');
    }

    /**
     * 마우스 관련 정보를 반환합니다.
     * @param {string} key - 요청할 데이터 키 (pos, x, y, left, right, middle)
     * @returns {any} 마우스 데이터
     */
    getMouseInput(key) {
        switch (key) {
            case "pos":
                return this.mousePos;
            case "y":
                return this.mousePos.y;
            case "x":
                return this.mousePos.x;
            case "left":
                return this.mouseButtons.left.state;
            case "right":
                return this.mouseButtons.right.state;
            case "middle":
                return this.mouseButtons.middle.state;
        }
        return null;
    }

    /**
     * 마우스 포커스 레이어를 설정합니다. (기존 포커스 리스트 초기화)
     * @param {string} focus - 포커스 레이어
     */
    setFocus(focus) {
        this.focusList = Array.isArray(focus) ? focus : [focus];
    }

    /**
     * 마우스 포커스 레이어를 추가합니다.
     * @param {string} focus - 포커스 레이어
     */
    addFocus(focus) {
        if (this.focusList.includes(focus)) {
            // 이미 있으면 제거 후 다시 추가 (맨 위로 이동)
            this.removeFocus(focus);
        }
        this.focusList.push(focus);
    }

    /**
     * 마우스 포커스 레이어를 제거합니다.
     * @param {string} focus - 포커스 레이어
     */
    removeFocus(focus) {
        const index = this.focusList.indexOf(focus);
        if (index > -1) {
            this.focusList.splice(index, 1);
        }
    }

    /**
     * 현재 마우스 포커스 (최상위)를 반환합니다.
     * @returns {string} 포커스 레이어 이름
     */
    get focus() {
        if (this.focusList.length === 0) return "none";
        return this.focusList[this.focusList.length - 1];
    }
}
