import { BaseUIElement } from "./base_element.js";
import { render } from "display/_display_system.js";
import { getMouseInput, getMouseFocus } from "input/_input_system.js";
import { animate } from "animation/_animation_system.js";
import { ColorSchemes } from "display/theme_handler.js";
/**
 * @class SegmentControl
 * @description 여러 옵션 중 하나를 선택하는 세그먼트 컨트롤 UI입니다.
 * @param {object} properties - 속성
 * @param {object[]} properties.items - 옵션 배열 [{label: 'Text', value: 1}, ...]
 * @param {any} properties.value - 초기 값
 * @param {Function} properties.onChange - 변경 시 콜백 (value) => {}
 * @param {number} properties.width - 전체 너비
 * @param {number} properties.height - 전체 높이
 */
export class SegmentControl extends BaseUIElement {
    constructor(properties) {
        super(properties);
        this.items = properties.items || [];
        this.onChange = properties.onChange || (() => { });

        this.width = properties.width || 200;
        this.height = properties.height || 40;
        this.radius = properties.radius || 8;


        this.backgroundColor = properties.backgroundColor || ColorSchemes.Overlay.Segment.Background;
        this.thumbColor = properties.thumbColor || ColorSchemes.Overlay.Segment.Thumb;
        this.textColorActive = properties.textColorActive || ColorSchemes.Overlay.Segment.TextActive;
        this.textColorInactive = properties.textColorInactive || ColorSchemes.Overlay.Segment.TextInactive;

        this.font = properties.font || `600 ${this.height * 0.55}px "Pretendard Variable", arial`;


        this._value = null;
        this.selectedIndex = 0;

        this.selectionProgress = 0;

        this._hoverScale = 1.0;
        this.clickAble = true;

        if (properties.value !== undefined) {
            this.value = properties.value;
            this.selectionProgress = this.selectedIndex;
        }
    }

    get value() { return this._value; }

    set value(val) {
        if (this._value === val) return;
        this._value = val;

        const newIndex = this.items.findIndex(item => item.value === val);
        if (newIndex !== -1) {
            this.selectedIndex = newIndex;

            if (this.visible && Math.abs(this.selectionProgress - this.selectedIndex) > 0.01) {
                animate(this, {
                    variable: 'selectionProgress',
                    startValue: this.selectionProgress,
                    endValue: this.selectedIndex,
                    type: 'easeOutExpo',
                    duration: 0.3
                });
            } else {
                this.selectionProgress = this.selectedIndex;
            }
        }
    }

    update() {
        if (!this.visible) return;

        this.padding = this.height * 0.1;
        this.segmentWidth = (this.width - (this.padding * 2)) / this.items.length;
        this.thumbHeight = this.height - (this.padding * 2);

        if (getMouseFocus() === this.layer && this.clickAble) {
            const mx = getMouseInput("x");
            const my = getMouseInput("y");
            const isOver = mx >= this.x && mx <= this.x + this.width && my >= this.y && my <= this.y + this.height;

            const targetScale = isOver ? 1.05 : 1.0;
            if (Math.abs(this._hoverScale - targetScale) > 0.001) {
                if (this._lastTargetScale !== targetScale) {
                    this._lastTargetScale = targetScale;
                    animate(this, {
                        variable: '_hoverScale',
                        startValue: this._hoverScale || 1.0,
                        endValue: targetScale,
                        duration: 0.2,
                        type: 'easeOutExpo'
                    });
                }
            }
            if (this._hoverScale === undefined) this._hoverScale = 1.0;

            if (isOver && getMouseInput("leftClicked")) {
                const relativeX = mx - this.x - this.padding;
                let clickedIndex = Math.floor(relativeX / this.segmentWidth);

                if (clickedIndex < 0) clickedIndex = 0;
                if (clickedIndex >= this.items.length) clickedIndex = this.items.length - 1;

                if (this.selectedIndex !== clickedIndex) {
                    this.selectedIndex = clickedIndex;
                    this.value = this.items[clickedIndex].value;
                    this.onChange(this.value);
                }
            }
        }
    }

    draw() {
        if (!this.visible) return;

        const scale = this._hoverScale || 1.0;

        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;

        const w = this.width * scale;
        const h = this.height * scale;
        const x = cx - w / 2;
        const y = cy - h / 2;

        const scaledPadding = this.padding * scale;
        const scaledSegW = this.segmentWidth * scale;

        const thumbXOffset = scaledPadding + (scaledSegW * this.selectionProgress);

        render(this.layer, {
            shape: 'roundRect',
            x: x,
            y: y,
            w: w,
            h: h,
            radius: this.radius * scale,
            fill: this.backgroundColor,
            alpha: this.alpha
        });

        render(this.layer, {
            shape: 'roundRect',
            x: x + thumbXOffset,
            y: y + scaledPadding,
            w: scaledSegW,
            h: h - (scaledPadding * 2), // height minus padding
            radius: (this.radius - 2) * scale,
            fill: this.thumbColor,
            alpha: this.alpha,
            shadow: { blur: 4 * scale, color: 'rgba(0,0,0,0.1)' }
        });

        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            const itemX = x + scaledPadding + (scaledSegW * i) + (scaledSegW / 2);
            const itemY = y + h / 2;

            const isSelected = i === this.selectedIndex;
            const color = isSelected ? this.textColorActive : this.textColorInactive;

            const fontToUse = this.font || `600 ${this.height * 0.55}px "Pretendard Variable", arial`;

            render(this.layer, {
                shape: 'text',
                text: item.label,
                x: itemX,
                y: itemY,
                font: fontToUse,
                fill: color,
                align: 'center',
                baseline: 'middle',
                alpha: this.alpha
            });
        }
    }
}
