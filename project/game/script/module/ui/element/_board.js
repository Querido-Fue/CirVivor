import { BaseUIElement } from "./_base_element.js";
import { render } from "display/display_system.js";
import { ColorSchemes } from "display/_theme_handler.js";

/**
 * @class BoardElement
 * @description 둥근 사각형 형태의 UI 보드 요소입니다.
 */
export class BoardElement extends BaseUIElement {
    /**
     * @param {object} properties - 보드 속성
     * @param {object} properties.parent - 부모 객체
     * @param {string} properties.layer - 렌더링 레이어
     * @param {number} properties.x - X 좌표
     * @param {number} properties.y - Y 좌표
     * @param {number} properties.width - 너비
     * @param {number} properties.height - 높이
     * @param {string} properties.color - 색상
     * @param {number} [properties.alpha=1] - 투명도
     * @param {number} [properties.round=0] - 모서리 둥글기
     */
    constructor(properties) {
        super(properties);
        this.width = properties.width || 0;
        this.height = properties.height || 0;
        this.color = properties.color || ColorSchemes.Overlay.Panel.Background;
        this.round = properties.round || 0;
    }

    update() {
    }

    draw() {
        if (!this.visible) return;

        render(this.layer, {
            shape: 'roundRect',
            x: this.x,
            y: this.y,
            w: this.width,
            h: this.height,
            radius: this.round,
            fill: this.color,
            alpha: this.alpha
        });
    }
}