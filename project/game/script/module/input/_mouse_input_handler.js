import { getScaleRatio, getCanvasOffset } from 'display/display_system.js';
import { getData } from 'data/data_handler.js';
import { getSetting, setSetting } from 'save/save_system.js';

const GLOBAL_CONSTANTS = getData('GLOBAL_CONSTANTS');
const DEBUG_MODE_TOGGLE = GLOBAL_CONSTANTS.DEBUG_MODE_TOGGLE;

const MOUSE_BUTTON_STATE_LISTS = Object.freeze({
    inactive: Object.freeze(['inactive']),
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
        this.debugToggleClickTimestamps = [];
        this.debugModeToggleJob = Promise.resolve();

        this.focusList = ["ui", "object"]; // 기본 포커스

        window.addEventListener("mousemove", (e) => {
            this.#updateMousePosition(e);
        });
        document.addEventListener("mousemove", (e) => {
            this.#updateMousePosition(e);
        });
        window.addEventListener("mousedown", (e) => {
            this.#updateMousePosition(e);
            this.#queueButtonStateChange(e.button, 'press', e.timeStamp);
        });
        window.addEventListener("mouseup", (e) => {
            this.#updateMousePosition(e);
            this.#queueButtonStateChange(e.button, 'release', e.timeStamp);
        });
        window.addEventListener("blur", () => {
            this.#setAllButtonsInactive();
        });
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                this.#setAllButtonsInactive();
            }
        });
        document.addEventListener("mouseleave", () => {
            if (typeof document.hasFocus === 'function' && !document.hasFocus()) {
                return;
            }
            this.#resetAllButtons();
        });
    }

    /**
     * @private
     * 버튼 상태 초기값을 생성합니다.
     * @returns {{physicalDown: boolean, state: readonly string[], queuedEvents: string[], clickedConsumed: boolean}}
     */
    #createButtonState() {
        return {
            physicalDown: false,
            state: MOUSE_BUTTON_STATE_LISTS.idle,
            queuedEvents: [],
            clickedConsumed: false
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
     * @param {number} [eventTimestamp=performance.now()] - 입력 발생 시각(ms)입니다.
     */
    #queueButtonStateChange(buttonCode, eventType, eventTimestamp = performance.now()) {
        const buttonName = this.#resolveButtonName(buttonCode);
        if (!buttonName) return;

        const button = this.mouseButtons[buttonName];
        if (!button) return;
        const normalizedTimestamp = this.#normalizeEventTimestamp(eventTimestamp);

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
            this.#registerDebugModeToggleClick(normalizedTimestamp);
        }
    }

    /**
     * @private
     * 디버그 모드 토글 판정에 사용할 이벤트 시각을 정규화합니다.
     * @param {number} eventTimestamp - 원본 이벤트 시각(ms)입니다.
     * @returns {number} 정규화된 시각(ms)입니다.
     */
    #normalizeEventTimestamp(eventTimestamp) {
        return Number.isFinite(eventTimestamp) ? eventTimestamp : performance.now();
    }

    /**
     * @private
     * 디버그 토글 판정에 필요한 최근 휠클릭 시각만 유지합니다.
     * @param {number} referenceTimestamp - 비교 기준 시각(ms)입니다.
     */
    #pruneDebugModeToggleClicks(referenceTimestamp) {
        const minimumTimestamp = referenceTimestamp - DEBUG_MODE_TOGGLE.CLICK_WINDOW_MS;
        while (
            this.debugToggleClickTimestamps.length > 0
            && this.debugToggleClickTimestamps[0] < minimumTimestamp
        ) {
            this.debugToggleClickTimestamps.shift();
        }
    }

    /**
     * @private
     * 디버그 모드 토글용 휠클릭 시퀀스를 초기화합니다.
     */
    #resetDebugModeToggleClicks() {
        this.debugToggleClickTimestamps.length = 0;
    }

    /**
     * @private
     * 휠클릭 누적 횟수를 기록하고 조건 충족 시 디버그 모드 토글을 예약합니다.
     * @param {number} eventTimestamp - 클릭이 완료된 시각(ms)입니다.
     */
    #registerDebugModeToggleClick(eventTimestamp) {
        this.#pruneDebugModeToggleClicks(eventTimestamp);
        this.debugToggleClickTimestamps.push(eventTimestamp);

        if (this.debugToggleClickTimestamps.length < DEBUG_MODE_TOGGLE.REQUIRED_MIDDLE_CLICKS) {
            return;
        }

        this.#resetDebugModeToggleClicks();
        this.#queueDebugModeToggle();
    }

    /**
     * @private
     * 디버그 모드 토글 저장과 런타임 반영을 직렬화하여 처리합니다.
     */
    #queueDebugModeToggle() {
        this.debugModeToggleJob = this.debugModeToggleJob
            .catch(() => undefined)
            .then(async () => {
                const nextDebugMode = !Boolean(getSetting('debugMode'));
                await setSetting('debugMode', nextDebugMode);

                const systemHandler = window.Game?.systemHandler;
                if (systemHandler && typeof systemHandler.applyRuntimeSettings === 'function') {
                    await systemHandler.applyRuntimeSettings({ debugMode: nextDebugMode });
                }
                if (systemHandler?.debugSystem && typeof systemHandler.debugSystem.applyRuntimeSettings === 'function') {
                    systemHandler.debugSystem.applyRuntimeSettings({ debugMode: nextDebugMode });
                }
            })
            .catch((error) => {
                console.warn('디버그 모드 토글 처리 중 오류가 발생했습니다.', error);
            });
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
            if (nextEvent === 'inactivePress') {
                button.clickedConsumed = false;
                button.state = MOUSE_BUTTON_STATE_LISTS.inactive;
                return;
            }
            if (nextEvent === 'inactiveRelease') {
                this.#resetAllButtons();
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

    /**
     * @private
     * 모든 버튼 입력을 즉시 초기 상태로 리셋합니다.
     */
    #resetAllButtons() {
        this.#resetDebugModeToggleClicks();
        Object.values(this.mouseButtons).forEach((button) => {
            button.physicalDown = false;
            button.queuedEvents.length = 0;
            button.clickedConsumed = false;
            button.state = MOUSE_BUTTON_STATE_LISTS.idle;
        });
    }

    /**
     * @private
     * 모든 버튼 입력을 비활성 상태로 전환합니다.
     * 창 포커스 복귀용 첫 클릭을 무시할 때 사용합니다.
     */
    #setAllButtonsInactive() {
        this.#resetDebugModeToggleClicks();
        Object.values(this.mouseButtons).forEach((button) => {
            button.physicalDown = false;
            button.queuedEvents.length = 0;
            button.clickedConsumed = false;
            button.state = MOUSE_BUTTON_STATE_LISTS.inactive;
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
     * 마우스 입력 상태를 강제로 초기화합니다.
     * 창 비활성화 후 복귀 시 눌림 상태가 남지 않도록 사용합니다.
     * @param {{inactive?: boolean}} [options={}] - inactive 상태로 전환할지 여부입니다.
     */
    resetMouseInput(options = {}) {
        if (options.inactive === true) {
            this.#setAllButtonsInactive();
            return;
        }

        this.#resetAllButtons();
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
     * 지정한 버튼 상태가 현재 활성인지 확인합니다.
     * 기본적으로 이미 소비된 `clicked` 상태는 제외합니다.
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
     * 현재는 `clicked` 상태만 소비 대상으로 지원합니다.
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
