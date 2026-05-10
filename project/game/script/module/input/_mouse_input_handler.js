import { getScaleRatio, getCanvasOffset } from 'display/display_system.js';
import { DebugModeToggleHandler } from './_debug_mode_toggle_handler.js';
import { MouseButtonStateMachine } from './_mouse_button_state_machine.js';
import { resolveFiniteNumber } from 'util/number_util.js';

/**
 * 마우스 입력의 기본 포커스 레이어 목록입니다.
 * @type {ReadonlyArray<string>}
 */
const DEFAULT_MOUSE_FOCUS_LIST = Object.freeze(['ui', 'object']);

/**
 * @class MouseInputHandler
 * @description 마우스 입력을 관리하는 클래스입니다.
 * 마우스 위치와 버튼별 상태 배열을 추적합니다.
 */
export class MouseInputHandler {
    constructor() {
        this.mousePos = { x: 0, y: 0 };
        this.buttonStateMachine = new MouseButtonStateMachine(new DebugModeToggleHandler());
        this.mouseButtons = this.buttonStateMachine.mouseButtons;

        this.focusList = [...DEFAULT_MOUSE_FOCUS_LIST];

        window.addEventListener('mousemove', (e) => {
            this.#updateMousePosition(e);
        });
        document.addEventListener('mousemove', (e) => {
            this.#updateMousePosition(e);
        });
        window.addEventListener('mousedown', (e) => {
            this.#updateMousePosition(e);
            this.buttonStateMachine.queueButtonStateChange(e.button, 'press', e.timeStamp);
        });
        window.addEventListener('mouseup', (e) => {
            this.#updateMousePosition(e);
            this.buttonStateMachine.queueButtonStateChange(e.button, 'release', e.timeStamp);
        });
        window.addEventListener('blur', () => {
            this.buttonStateMachine.setAllButtonsInactive();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.buttonStateMachine.setAllButtonsInactive();
            }
        });
        document.addEventListener('mouseleave', () => {
            if (typeof document.hasFocus === 'function' && !document.hasFocus()) {
                return;
            }
            this.buttonStateMachine.resetAllButtons();
        });
    }

    /**
     * @private
     * DOM 이벤트 좌표를 내부 게임 좌표로 변환합니다.
     * @param {MouseEvent} event - 원본 마우스 이벤트
     */
    #updateMousePosition(event) {
        const scale = resolveFiniteNumber(Number(getScaleRatio()), 1);
        const offset = getCanvasOffset();
        const offsetX = resolveFiniteNumber(Number(offset?.x), 0);
        const offsetY = resolveFiniteNumber(Number(offset?.y), 0);
        const clientX = resolveFiniteNumber(Number(event?.clientX), offsetX);
        const clientY = resolveFiniteNumber(Number(event?.clientY), offsetY);
        this.mousePos.x = (clientX - offsetX) * scale;
        this.mousePos.y = (clientY - offsetY) * scale;
    }

    /**
     * 입력 상태를 업데이트합니다. (주로 마우스 클릭 상태 처리)
     */
    update() {
        this.buttonStateMachine.updateAll();
    }

    /**
     * 마우스 입력 상태를 강제로 초기화합니다.
     * 창 비활성화 후 복귀 시 눌림 상태가 남지 않도록 사용합니다.
     * @param {{inactive?: boolean}} [options={}] - inactive 상태로 전환할지 여부입니다.
     */
    resetMouseInput(options = {}) {
        if (options.inactive === true) {
            this.buttonStateMachine.setAllButtonsInactive();
            return;
        }

        this.buttonStateMachine.resetAllButtons();
    }

    /**
     * 마우스 관련 정보를 반환합니다.
     * @param {string} key - 요청할 데이터 키 (pos, x, y, left, right, middle)
     * @returns {any} 마우스 데이터
     */
    getMouseInput(key) {
        switch (key) {
            case 'pos':
                return this.mousePos;
            case 'y':
                return this.mousePos.y;
            case 'x':
                return this.mousePos.x;
            case 'left':
                return this.buttonStateMachine.getButtonState('left');
            case 'right':
                return this.buttonStateMachine.getButtonState('right');
            case 'middle':
                return this.buttonStateMachine.getButtonState('middle');
        }
        return null;
    }

    /**
     * 지정한 버튼 상태가 현재 활성인지 확인합니다.
     * 기본적으로 이미 소비된 `clicked` 상태는 제외합니다.
     * @param {'left'|'right'|'middle'} buttonName - 검사할 버튼 이름입니다.
     * @param {'inactive'|'idle'|'click'|'clicking'|'clicked'} state - 검사할 상태 이름입니다.
     * @param {{includeConsumed?: boolean}} [options={}] - 소비된 상태 포함 여부 옵션입니다.
     * @returns {boolean} 상태 활성 여부입니다.
     */
    hasButtonState(buttonName, state, options = {}) {
        return this.buttonStateMachine.hasButtonState(buttonName, state, options);
    }

    /**
     * 지정한 버튼의 단발성 상태를 소비 처리합니다.
     * 현재는 `clicked` 상태만 소비 대상으로 지원합니다.
     * @param {'left'|'right'|'middle'} buttonName - 소비할 버튼 이름입니다.
     * @param {'clicked'} [state='clicked'] - 소비할 상태 이름입니다.
     * @returns {boolean} 실제로 소비되었으면 true를 반환합니다.
     */
    consumeButtonState(buttonName, state = 'clicked') {
        return this.buttonStateMachine.consumeButtonState(buttonName, state);
    }

    /**
     * 마우스 포커스 레이어를 설정합니다. (기존 포커스 리스트 초기화)
     * @param {string} focus - 포커스 레이어
     */
    setFocus(focus) {
        this.focusList = Array.isArray(focus) ? [...focus] : [focus];
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
        if (this.focusList.length === 0) return 'none';
        return this.focusList[this.focusList.length - 1];
    }
}
