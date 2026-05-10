import { BaseUIElement } from './_base_element.js';
import { render } from 'display/display_system.js';
import { clampFiniteNumber } from 'util/number_util.js';

const DEFAULT_PROGRESS_BAR_WIDTH = 100;
const DEFAULT_PROGRESS_BAR_HEIGHT = 10;
const DEFAULT_PROGRESS_BAR_BASE_COLOR = '#444444';
const DEFAULT_PROGRESS_BAR_FILL_COLOR = '#FFFFFF';

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
    /**
     * 진행 바 요소를 생성합니다.
     * @param {object} properties - 진행 바 속성입니다.
     */
    constructor(properties) {
        super(properties);
        this.init(properties);
    }

    /**
     * 진행 바 요소 상태를 초기화합니다.
     * @param {object} properties - 진행 바 속성입니다.
     * @override
     */
    init(properties) {
        super.init(properties);
        if (!properties) return;
        this.width = clampFiniteNumber(Number(properties.width), 0, Infinity, DEFAULT_PROGRESS_BAR_WIDTH);
        this.height = clampFiniteNumber(Number(properties.height), 0, Infinity, DEFAULT_PROGRESS_BAR_HEIGHT);
        this.percent = clampFiniteNumber(Number(properties.percent), 0, 100, 0);
        this.baseColor = properties.baseColor || DEFAULT_PROGRESS_BAR_BASE_COLOR;
        this.fillColor = properties.fillColor || DEFAULT_PROGRESS_BAR_FILL_COLOR;
    }

    /**
     * 진행 바 요소를 기본 상태로 되돌립니다.
     * @override
     */
    reset() {
        super.reset();
        this.width = DEFAULT_PROGRESS_BAR_WIDTH;
        this.height = DEFAULT_PROGRESS_BAR_HEIGHT;
        this.percent = 0;
        this.baseColor = DEFAULT_PROGRESS_BAR_BASE_COLOR;
        this.fillColor = DEFAULT_PROGRESS_BAR_FILL_COLOR;
    }

    /**
     * 진행 바 요소 상태를 갱신합니다.
     * @override
     */
    update() {
    }

    /**
     * 진행 바 요소를 렌더링합니다.
     * @override
     */
    draw() {
        if (!this.visible) return;

        const radius = this.height / 2;
        const fillW = this.width * (clampFiniteNumber(Number(this.percent), 0, 100, 0) / 100);

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
