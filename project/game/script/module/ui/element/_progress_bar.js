import { BaseUIElement } from "./_base_element.js";
import { render } from "display/display_system.js";

/**
 * @class ProgressBarElement
 * @description UI 진행 바 요소입니다.
 * @param {object} properties - 진행 바 속성
 * @param {object} properties.parent - 부모 객체
 * @param {string} properties.layer - 렌더링 레이어
 * @param {number} properties.x - X 좌표
 * @param {number} properties.y - Y 좌표
 * @param {number} properties.width - 너비
 * @param {number} properties.height - 높이
 * @param {number} [properties.percent=0] - 진행도 (0~100)
 * @param {string} [properties.baseColor='#444444'] - 배경 색상
 * @param {string} [properties.fillColor='#FFFFFF'] - 채워진 부분 색상
 */
export class ProgressBarElement extends BaseUIElement {
    constructor(properties) {
        super(properties);
    }

    init(properties) {
        super.init(properties);
        if (!properties) return;
        this.width = properties.width || 100;
        this.height = properties.height || 10;
        this.percent = properties.percent !== undefined ? properties.percent : 0;
        this.baseColor = properties.baseColor || '#444444';
        this.fillColor = properties.fillColor || '#FFFFFF';
    }

    reset() {
        super.reset();
        this.percent = 0;
        this.baseColor = '#444444';
        this.fillColor = '#FFFFFF';
    }

    update() {
    }

    draw() {
        if (!this.visible) return;

        const radius = this.height / 2;
        const fillW = this.width * (this.percent / 100);

        render(this.layer, {
            shape: 'roundRect',
            x: this.x,
            y: this.y,
            w: this.width,
            h: this.height,
            radius: radius,
            fill: this.baseColor,
            alpha: this.alpha
        });

        if (fillW > 0) {
            render(this.layer, {
                shape: 'roundRect',
                x: this.x,
                y: this.y,
                w: fillW,
                h: this.height,
                radius: radius,
                fill: this.fillColor,
                alpha: this.alpha
            });
        }
    }
}
