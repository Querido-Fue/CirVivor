import { getData } from 'data/data_handler.js';

const {
    STATE_LISTS: MOUSE_BUTTON_STATE_LISTS,
    BUTTON_CODES: MOUSE_BUTTON_CODES
} = getData('MOUSE_BUTTON_INPUT_DATA');

/**
 * @class MouseButtonStateMachine
 * @description 마우스 버튼별 물리 입력과 프레임 단위 상태 전이를 관리합니다.
 */
export class MouseButtonStateMachine {
    /**
     * @param {{registerClick?:Function, reset?:Function}|null} [debugModeToggleHandler=null] - 중클릭 debug toggle 처리기입니다.
     */
    constructor(debugModeToggleHandler = null) {
        this.debugModeToggleHandler = debugModeToggleHandler;
        this.mouseButtons = {
            left: this._createButtonState(),
            right: this._createButtonState(),
            middle: this._createButtonState()
        };
    }

    /**
     * 버튼별 상태머신을 한 프레임만큼 전진시킵니다.
     */
    updateAll() {
        this._updateButton('left');
        this._updateButton('right');
        this._updateButton('middle');
    }

    /**
     * 버튼 상태 전이 이벤트를 큐에 적재합니다.
     * @param {number} buttonCode - DOM 마우스 버튼 코드입니다.
     * @param {'press'|'release'} eventType - 상태 전이 종류입니다.
     * @param {number} [eventTimestamp=performance.now()] - 입력 발생 시각(ms)입니다.
     */
    queueButtonStateChange(buttonCode, eventType, eventTimestamp = performance.now()) {
        const buttonName = this._resolveButtonName(buttonCode);
        if (!buttonName) return;

        const button = this.mouseButtons[buttonName];
        if (!button) return;

        if (button.state === MOUSE_BUTTON_STATE_LISTS.inactive) {
            button.clickedConsumed = false;
            button.queuedEvents.length = 0;

            if (eventType === 'press') {
                button.physicalDown = true;
                button.queuedEvents.push('inactivePress');
                return;
            }

            button.physicalDown = false;
            button.queuedEvents.push('inactiveRelease');
            return;
        }

        if (eventType === 'press') {
            if (button.physicalDown) return;
            button.physicalDown = true;
            button.queuedEvents.push('press');
            return;
        }

        if (!button.physicalDown) return;
        button.physicalDown = false;
        button.queuedEvents.push('release');

        if (buttonName === 'middle') {
            this.debugModeToggleHandler?.registerClick?.(eventTimestamp);
        }
    }

    /**
     * 모든 버튼 입력을 즉시 초기 상태로 리셋합니다.
     */
    resetAllButtons() {
        this.debugModeToggleHandler?.reset?.();
        Object.values(this.mouseButtons).forEach((button) => {
            button.physicalDown = false;
            button.queuedEvents.length = 0;
            button.clickedConsumed = false;
            button.state = MOUSE_BUTTON_STATE_LISTS.idle;
        });
    }

    /**
     * 모든 버튼 입력을 비활성 상태로 전환합니다.
     */
    setAllButtonsInactive() {
        this.debugModeToggleHandler?.reset?.();
        Object.values(this.mouseButtons).forEach((button) => {
            button.physicalDown = false;
            button.queuedEvents.length = 0;
            button.clickedConsumed = false;
            button.state = MOUSE_BUTTON_STATE_LISTS.inactive;
        });
    }

    /**
     * 버튼의 현재 상태 배열을 반환합니다.
     * @param {'left'|'right'|'middle'} buttonName - 버튼 이름입니다.
     * @returns {readonly string[]|null} 현재 버튼 상태입니다.
     */
    getButtonState(buttonName) {
        return this.mouseButtons[buttonName]?.state || null;
    }

    /**
     * 지정한 버튼 상태가 현재 활성인지 확인합니다.
     * @param {'left'|'right'|'middle'} buttonName - 검사할 버튼 이름입니다.
     * @param {'inactive'|'idle'|'click'|'clicking'|'clicked'} state - 검사할 상태 이름입니다.
     * @param {{includeConsumed?: boolean}} [options={}] - 소비된 상태 포함 여부 옵션입니다.
     * @returns {boolean} 상태 활성 여부입니다.
     */
    hasButtonState(buttonName, state, options = {}) {
        const button = this.mouseButtons[buttonName];
        if (!button || !Array.isArray(button.state)) {
            return false;
        }

        if (state === 'clicked' && options.includeConsumed !== true && button.clickedConsumed) {
            return false;
        }

        return button.state.includes(state);
    }

    /**
     * 지정한 버튼의 단발성 상태를 소비 처리합니다.
     * @param {'left'|'right'|'middle'} buttonName - 소비할 버튼 이름입니다.
     * @param {'clicked'} [state='clicked'] - 소비할 상태 이름입니다.
     * @returns {boolean} 실제로 소비되었으면 true를 반환합니다.
     */
    consumeButtonState(buttonName, state = 'clicked') {
        const button = this.mouseButtons[buttonName];
        if (!button || state !== 'clicked' || !Array.isArray(button.state)) {
            return false;
        }

        if (!button.state.includes('clicked') || button.clickedConsumed) {
            return false;
        }

        button.clickedConsumed = true;
        return true;
    }

    /**
     * 버튼 상태 초기값을 생성합니다.
     * @returns {{physicalDown: boolean, state: readonly string[], queuedEvents: string[], clickedConsumed: boolean}}
     * @private
     */
    _createButtonState() {
        return {
            physicalDown: false,
            state: MOUSE_BUTTON_STATE_LISTS.idle,
            queuedEvents: [],
            clickedConsumed: false
        };
    }

    /**
     * 브라우저 버튼 번호를 내부 버튼 이름으로 변환합니다.
     * @param {number} buttonCode - DOM 마우스 버튼 코드입니다.
     * @returns {'left'|'right'|'middle'|null} 내부 버튼 이름입니다.
     * @private
     */
    _resolveButtonName(buttonCode) {
        return MOUSE_BUTTON_CODES[buttonCode] || null;
    }

    /**
     * 지정한 버튼의 상태머신을 한 프레임만큼 전진시킵니다.
     * @param {'left'|'right'|'middle'} buttonName - 내부 버튼 이름입니다.
     * @private
     */
    _updateButton(buttonName) {
        const button = this.mouseButtons[buttonName];
        if (!button) return;

        if (button.queuedEvents.length > 0) {
            const nextEvent = button.queuedEvents.shift();
            if (nextEvent === 'inactivePress') {
                button.clickedConsumed = false;
                button.state = MOUSE_BUTTON_STATE_LISTS.inactive;
                return;
            }
            if (nextEvent === 'inactiveRelease') {
                this.resetAllButtons();
                return;
            }
            if (nextEvent === 'press') {
                button.clickedConsumed = false;
                button.state = MOUSE_BUTTON_STATE_LISTS.click;
                return;
            }
            if (nextEvent === 'release') {
                button.clickedConsumed = false;
                button.state = MOUSE_BUTTON_STATE_LISTS.clicked;
                return;
            }
        }

        if (button.state === MOUSE_BUTTON_STATE_LISTS.click) {
            button.state = button.physicalDown
                ? MOUSE_BUTTON_STATE_LISTS.clicking
                : MOUSE_BUTTON_STATE_LISTS.clicked;
            button.clickedConsumed = false;
            return;
        }

        if (button.state === MOUSE_BUTTON_STATE_LISTS.clicking) {
            if (!button.physicalDown) {
                button.clickedConsumed = false;
                button.state = MOUSE_BUTTON_STATE_LISTS.clicked;
            }
            return;
        }

        if (button.state === MOUSE_BUTTON_STATE_LISTS.clicked) {
            button.clickedConsumed = false;
            button.state = MOUSE_BUTTON_STATE_LISTS.idle;
            return;
        }

        if (button.state === MOUSE_BUTTON_STATE_LISTS.inactive) {
            button.clickedConsumed = false;
            return;
        }

        button.clickedConsumed = false;
        button.state = MOUSE_BUTTON_STATE_LISTS.idle;
    }
}
