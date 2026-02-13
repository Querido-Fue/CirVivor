import { Vector2 } from '../../util/vector2.js';
import { getScaleRatio, getCanvasOffset } from '../display/_display_system.js';

/**
 * @class MouseInputHandler
 * @description 마우스 입력을 관리하는 클래스입니다.
 * 마우스 위치, 클릭 상태 등을 추적합니다.
 */
export class MouseInputHandler {
    constructor() {
        this.mousePos = new Vector2(0, 0);
        this.mouseLeftClicking = false;
        this.mouseLeftTemp = false;
        this.mouseLeftClicked = false;
        this.mouseRightClicking = false;
        this.mouseRightTemp = false;
        this.mouseRightClicked = false;

        this.focus = "main";

        window.addEventListener("mousemove", (e) => {
            const scale = getScaleRatio();
            const offset = getCanvasOffset();
            this.mousePos = new Vector2((e.clientX - offset.x) * scale, (e.clientY - offset.y) * scale);
        });
        window.addEventListener("mousedown", (e) => {
            if (e.button === 0) {
                this.mouseLeftClicking = true;
            } else if (e.button === 2) {
                this.mouseRightClicking = true;
            }
        });
        window.addEventListener("mouseup", (e) => {
            if (e.button === 0) {
                this.mouseLeftClicking = false;
            } else if (e.button === 2) {
                this.mouseRightClicking = false;
            }
        });
    }

    /**
     * @private
     * 입력 상태를 업데이트합니다. (주로 마우스 클릭 상태 처리)
     */
    _update() {
        if (this.mouseLeftClicking) {
            this.mouseLeftTemp = true;
        }

        if (this.mouseLeftClicked) {
            this.mouseLeftClicked = false;
        }

        if (!this.mouseLeftClicking && this.mouseLeftTemp) {
            this.mouseLeftClicked = true;
            this.mouseLeftTemp = false;
        }

        if (this.mouseRightClicking) {
            this.mouseRightTemp = true;
        }

        if (this.mouseRightClicked) {
            this.mouseRightClicked = false;
        }

        if (!this.mouseRightClicking && this.mouseRightTemp) {
            this.mouseRightClicked = true;
            this.mouseRightTemp = false;
        }
    }

    /**
     * 마우스 관련 정보를 반환합니다.
     * @param {string} key - 요청할 데이터 키 (pos, x, y, clicking, clicked 등)
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
            case "leftClicking":
                return this.mouseLeftClicking;
            case "leftClicked":
                return this.mouseLeftClicked;
            case "rightClicking":
                return this.mouseRightClicking;
            case "rightClicked":
                return this.mouseRightClicked;
        }
        return null;
    }

    /**
     * 마우스 포커스 레이어를 설정합니다.
     * @param {string} focus - 포커스 레이어
     */
    setFocus(focus) {
        this.focus = focus;
    }
}