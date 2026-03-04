import { BaseUIElement } from "./_base_element.js";
import { render } from "display/display_system.js";

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
        this.init(properties);
    }

    /**
     * 텍스트 요소를 초기화합니다.
     * @param {object} properties - 텍스트 속성
     */
    init(properties) {
        super.init(properties);
        if (!properties) return;
        this.text = properties.text || '';
        this.align = properties.align || 'center';
        this.font = properties.font || 'arial';
        this.fontWeight = properties.fontWeight ? properties.fontWeight + " " : "";
        this.size = properties.size || 12;
        this.color = properties.color;
        this.rotation = properties.rotation || 0;
    }

    /**
     * 요소 상태를 기본값으로 초기화합니다.
     */
    reset() {
        super.reset();
        this.text = '';
    }

    /**
     * 텍스트 요소 상태를 갱신합니다.
     */
    update() {
    }

    /**
     * 텍스트를 현재 레이어에 렌더링합니다.
     */
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
