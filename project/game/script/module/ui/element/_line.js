import { BaseUIElement } from "./_base_element.js";
import { render, shadowOn, shadowOff } from "display/display_system.js";

/**
 * @class LineElement
 * @description UI 라인 요소입니다.
 */
export class LineElement extends BaseUIElement {
    /**
     * @param {object} properties - 라인 속성
     * @param {object} properties.parent - 부모 객체
     * @param {string} properties.layer - 렌더링 레이어
     * @param {number} properties.x1 - 시작 X 좌표
     * @param {number} properties.y1 - 시작 Y 좌표
     * @param {number} properties.x2 - 끝 X 좌표
     * @param {number} properties.y2 - 끝 Y 좌표
     * @param {number} properties.width - 선 두께
     * @param {string} properties.color - 색상
     * @param {number} [properties.alpha=1] - 투명도
     */
    constructor(properties) {
        super(properties);
    }

    init(properties) {
        super.init(properties);
        if (!properties) return;
        this.x1 = properties.x1 || 0;
        this.y1 = properties.y1 || 0;
        this.x2 = properties.x2 || 0;
        this.y2 = properties.y2 || 0;
        this.width = properties.width || 1;
        this.color = properties.color;
    }

    reset() {
        super.reset();
    }

    update() {
    }

    draw() {
        if (!this.visible) return;

        if (this.shadow) {
            shadowOn(this.layer, this.shadow.blur, this.shadow.color);
        }

        render(this.layer, {
            shape: 'line',
            x1: this.x1,
            y1: this.y1,
            x2: this.x2,
            y2: this.y2,
            stroke: this.color,
            lineWidth: this.width,
            alpha: this.alpha
        });

        if (this.shadow) {
            shadowOff(this.layer);
        }
    }
}