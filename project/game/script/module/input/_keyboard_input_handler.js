/**
 * DOM KeyboardEvent.key 값을 내부 입력 키 이름으로 변환하는 매핑입니다.
 * @type {Readonly<Record<string, string>>}
 */
const KEYBOARD_ACTION_BY_DOM_KEY = Object.freeze({
    ArrowUp: 'up',
    w: 'up',
    ArrowDown: 'down',
    s: 'down',
    ArrowLeft: 'left',
    a: 'left',
    ArrowRight: 'right',
    d: 'right',
    ' ': 'space',
    p: 'pause',
    r: 'reload'
});

/**
 * 기본 키보드 입력 상태를 생성합니다.
 * @returns {{up:boolean, down:boolean, left:boolean, right:boolean, space:boolean, pause:boolean, reload:boolean}} 키 상태 객체입니다.
 */
function createDefaultKeyboardState() {
    return {
        up: false,
        down: false,
        left: false,
        right: false,
        space: false,
        pause: false,
        reload: false
    };
}

/**
 * @class KeyboardInputHandler
 * @description 키보드 입력을 관리하는 클래스입니다.
 * 키 상태 등을 추적합니다.
 */
export class KeyboardInputHandler {
    constructor() {
        this.keys = createDefaultKeyboardState();

        window.addEventListener('keydown', (e) => {
            this.#setKeyState(e.key, true);
        });

        window.addEventListener('keyup', (e) => {
            this.#setKeyState(e.key, false);
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
     * 키보드 입력 상태를 초기화합니다.
     */
    resetKeyboardInput() {
        this.keys = createDefaultKeyboardState();
    }

    /**
     * 키보드 관련 정보를 반환합니다.
     * @param {string} key - 요청할 데이터 키
     * @returns {any} 키보드 데이터
     */
    getKeyboardInput(key) {
        return Object.prototype.hasOwnProperty.call(this.keys, key) ? this.keys[key] : null;
    }

    /**
     * DOM key 입력을 내부 키 상태에 반영합니다.
     * @param {string} domKey - KeyboardEvent.key 값입니다.
     * @param {boolean} isPressed - 눌림 여부입니다.
     * @private
     */
    #setKeyState(domKey, isPressed) {
        const keyName = KEYBOARD_ACTION_BY_DOM_KEY[domKey];
        if (!keyName) {
            return;
        }

        this.keys[keyName] = isPressed === true;
    }
}
