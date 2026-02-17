import { BaseUIElement } from "./base_element.js";
import { render } from "display/_display_system.js";

/**
 * @class TextElement
 * @description UI 텍스트 요소입니다.
 */
export class TextElement extends BaseUIElement {
    /**
     * @param {object} properties - 텍스트 속성
     * @param {object} properties.parent - 부모 객체
     * @param {string} properties.layer - 렌더링 레이어
     * @param {string} properties.text - 텍스트 내용
     * @param {string} properties.align - 정렬 (center, left, right)
     * @param {number} properties.x - X 좌표
     * @param {number} properties.y - Y 좌표
     * @param {string} properties.font - 폰트 이름
     * @param {number} properties.size - 폰트 크기
     * @param {string} properties.color - 색상
     * @param {number} [properties.alpha=1] - 투명도
     * @param {number} [properties.rotation=0] - 회전 각도
     */
    constructor(properties) {
        super(properties);
        this.text = properties.text || '';
        this.align = properties.align || 'center';
        this.font = properties.font || 'arial';
        this.fontWeight = properties.fontWeight ? properties.fontWeight + " " : "";
        this.size = properties.size || 12;
        this.color = properties.color
        this.rotation = properties.rotation || 0;
    }

    update() {
    }

    draw() {
        if (!this.visible) return;

        render(this.layer, {
            shape: 'text',
            text: this.text,
            x: this.x,
            y: this.y,
            font: `${this.fontWeight}${this.size}px ${this.font}`,
            fill: this.color,
            alpha: this.alpha,
            rotation: this.rotation,
            align: this.align,
            baseline: 'middle'
        });
    }
}