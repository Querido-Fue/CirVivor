/**
 * @class KeyboardInputHandler
 * @description 키보드 입력을 관리하는 클래스입니다.
 * 키 상태 등을 추적합니다.
 */
export class KeyboardInputHandler {
    constructor() {
        this.keys = {
            up: false,
            down: false,
            left: false,
            right: false,
            space: false,
            pause: false,
            reload: false,
        };

        window.addEventListener("keydown", (e) => {
            switch (e.key) {
                case "ArrowUp":
                case "w":
                    this.keys.up = true;
                    break;
                case "ArrowDown":
                case "s":
                    this.keys.down = true;
                    break;
                case "ArrowLeft":
                case "a":
                    this.keys.left = true;
                    break;
                case "ArrowRight":
                case "d":
                    this.keys.right = true;
                    break;
                case " ":
                    this.keys.space = true;
                    break;
                case "p":
                    this.keys.pause = true;
                    break;
                case "r":
                    this.keys.reload = true;
                    break;
            }
        });

        window.addEventListener("keyup", (e) => {
            switch (e.key) {
                case "ArrowUp":
                case "w":
                    this.keys.up = false;
                    break;
                case "ArrowDown":
                case "s":
                    this.keys.down = false;
                    break;
                case "ArrowLeft":
                case "a":
                    this.keys.left = false;
                    break;
                case "ArrowRight":
                case "d":
                    this.keys.right = false;
                    break;
                case " ":
                    this.keys.space = false;
                    break;
                case "p":
                    this.keys.pause = false;
                    break;
                case "r":
                    this.keys.reload = false;
                    break;
            }
        });
    }

    /**
     * @private
     * 입력 상태를 업데이트합니다.
     */
    _update() {
    }

    /**
     * 키보드 입력 상태를 초기화합니다.
     */
    resetKeyboardInput() {
        this.keys = {
            up: false,
            down: false,
            left: false,
            right: false,
            space: false,
            pause: false,
            reload: false,
        };
    }

    /**
     * 키보드 관련 정보를 반환합니다.
     * @param {string} key - 요청할 데이터 키
     * @returns {any} 키보드 데이터
     */
    getKeyboardInput(key) {
        switch (key) {
            case "up":
                return this.keys.up;
            case "down":
                return this.keys.down;
            case "left":
                return this.keys.left;
            case "right":
                return this.keys.right;
            case "space":
                return this.keys.space;
            case "pause":
                return this.keys.pause;
            case "reload":
                return this.keys.reload;
        }
        return null;
    }
}