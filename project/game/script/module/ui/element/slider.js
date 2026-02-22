import { BaseUIElement } from "./base_element.js";
import { render } from "display/_display_system.js";
import { getMouseInput, getMouseFocus } from "input/_input_system.js";
import { ColorSchemes } from "display/theme_handler.js";
import { animate, remove } from "animation/_animation_system.js";
import { colorUtil } from "util/color_util.js";
import { mathUtil } from "util/math_util.js";
import { GLOBAL_CONSTANTS } from "data/global/global_constants.js";

/**
 * @class SliderElement
 * @description 탄성 애니메이션이 적용된 드래그 가능한 슬라이더 UI 요소입니다.
 */
export class SliderElement extends BaseUIElement {
    constructor(properties) {
        super(properties);

        this.width = properties.width || 100;
        this.trackHeight = properties.trackHeight || 4;
        this.knobRadius = properties.knobRadius || 2;
        this.min = properties.min || 0;
        this.max = properties.max || 100;
        this.value = properties.value || this.min;

        this.activeColor = properties.activeColor || ColorSchemes.Overlay.Slider.ValueActive;
        this.trackColor = properties.trackColor || ColorSchemes.Overlay.Slider.Track;
        this.knobColor = properties.knobColor || ColorSchemes.Overlay.Slider.Knob;
        this.valueColor = properties.valueColor || ColorSchemes.Overlay.Slider.ValueInactive;
        this.valueFont = properties.valueFont || '500 12px "Pretendard Variable", arial';
        this.showValue = properties.showValue !== undefined ? properties.showValue : true;
        this.valuePrefix = properties.valuePrefix || '';
        this.valueSuffix = properties.valueSuffix || '';
        this.valueOffsetX = properties.valueOffsetX || 15;
        this.valueOffsetY = properties.valueOffsetY || 0;

        this.onChange = properties.onChange || null;
        this.valueFormatter = properties.valueFormatter || null;
        this.dragging = false;

        this._overflow = 0;
        this.lastMouseX = 0;
        this.hoverScaleMultiplier = 1.15;
        this.pressScaleMultiplier = 1.15;
    }

    update() {
        if (!this.visible) return;

        const mx = getMouseInput('x');
        const my = getMouseInput('y');

        // 포커스 확인: 현재 포커스 레이어와 다르면 입력 무시
        if (!getMouseFocus().includes(this.layer)) {
            if (this.dragging) {
                this.dragging = false;
            }
            return;
        }

        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;
        const baseW = this.width * this.scale;
        const baseH = this.trackHeight * this.scale;
        const baseX = cx - baseW / 2;
        const drawY = cy - baseH / 2 + this.valueOffsetY;

        let pullDirection = 'none';

        if (this._overflow > 0.01) {
            if (this.lastMouseX < cx) pullDirection = 'left';
            else pullDirection = 'right';
        }

        const overflowValue = this._overflow * this.scale;
        const currentWidth = baseW + overflowValue;

        let hitX = baseX;
        if (pullDirection === 'left') {
            hitX = (baseX + baseW) - currentWidth;
        } else {
            hitX = baseX;
        }

        const hitBuffer = this.knobRadius * 1.5 * this.scale;
        const hitBufferX = 20 * this.scale;

        const isOverSlider = mx >= hitX - hitBufferX && mx <= hitX + currentWidth + hitBufferX &&
            my >= drawY - hitBuffer && my <= drawY + hitBuffer;

        if (getMouseInput('leftClicking') && getMouseFocus().includes(this.layer)) {
            if (isOverSlider || this.dragging) {
                if (!this.dragging) {
                    this.dragging = true;
                    if (this._overflowAnim) {
                        remove(this._overflowAnim.id);
                        this._overflowAnim = null;
                    }
                }
            }
        }

        if (!getMouseInput('leftClicking')) {
            if (this.dragging) {
                this.dragging = false;
                this._overflowAnim = animate(this, {
                    variable: '_overflow',
                    endValue: 0,
                    duration: 0.3,
                    type: 'easeOutBack'
                });
            }
        }

        if (this.dragging) {
            this.lastMouseX = mx;

            const relativeX = mx - hitX;
            const ratio = Math.max(0, Math.min(1, relativeX / currentWidth));
            const newValue = Math.round(this.min + ratio * (this.max - this.min));

            if (newValue !== this.value) {
                this.value = newValue;
                if (this.onChange) this.onChange(this.value);
            }

            // Max Overflow를 너비 비례로 설정 (해상도 독립적)
            const maxOverflow = this.width * GLOBAL_CONSTANTS.SLIDER_MAX_OVERFLOW * this.scale;

            if (mx < this.x) {
                this._overflow = mathUtil().decay(this.x - mx, maxOverflow);
            } else if (mx > this.x + this.width) {
                this._overflow = mathUtil().decay(mx - (this.x + this.width), maxOverflow);
            } else {
                this._overflow = 0;
            }
        }

        // BaseUIElement의 공통 함수 호출 (_isFocused는 this.isPressed 로 활용, _hoverScale은 this.scale로 대체)
        this._handleInteractionState(isOverSlider || this.dragging, this.dragging);
    }

    draw() {
        if (!this.visible) return;

        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;

        const baseW = this.width * this.scale;
        const baseH = this.trackHeight * this.scale;
        const baseX = cx - baseW / 2;
        const drawY = cy - baseH / 2 + this.valueOffsetY;

        let pullDirection = 'right';
        if (this._overflow > 0.01 && this.lastMouseX < cx) {
            pullDirection = 'left';
        }

        const maxOverflow = this.width * GLOBAL_CONSTANTS.SLIDER_MAX_OVERFLOW * this.scale;
        const overflowValue = this._overflow * this.scale;
        const currentWidth = baseW + overflowValue;
        const currentHeight = baseH * (1 - (this._overflow / maxOverflow) * 0.2);

        let drawX = baseX;
        if (pullDirection === 'left') {
            drawX = (baseX + baseW) - currentWidth;
        }

        const tColor = this.trackColor || ColorSchemes.Overlay.Slider.Track;

        render(this.layer, {
            shape: 'roundRect',
            x: drawX,
            y: drawY - currentHeight / 2,
            w: currentWidth,
            h: currentHeight,
            radius: currentHeight / 2,
            fill: tColor,
            alpha: this.alpha
        });

        const ratio = (this.value - this.min) / (this.max - this.min);
        const fillW = currentWidth * ratio;

        if (fillW > 0) {
            render(this.layer, {
                shape: 'roundRect',
                x: drawX,
                y: drawY - currentHeight / 2,
                w: fillW,
                h: currentHeight,
                radius: currentHeight / 2,
                fill: this.activeColor,
                alpha: this.alpha
            });
        }

        const knobX = drawX + fillW;
        const knobR = this.knobRadius * this.scale;

        render(this.layer, {
            shape: 'circle',
            x: knobX,
            y: drawY,
            radius: knobR,
            fill: this.knobColor,
            alpha: this.alpha
        });

        if (this.showValue) {
            const textY = drawY - (this.trackHeight * 2.25 * this.scale);

            const cNormal = this.valueColor || ColorSchemes.Overlay.Slider.ValueInactive;
            const cActive = this.activeColor || ColorSchemes.Overlay.Slider.ValueActive;

            // valueText 컬러 페이드는 isPressed 상태에 기반
            const vColor = colorUtil().lerpColor(cNormal, cActive, this.isPressed ? 1.0 : this.hoverValue);

            render(this.layer, {
                shape: 'text',
                text: this.valueFormatter ? this.valueFormatter(this.value) : `${this.valuePrefix}${this.value}${this.valueSuffix}`,
                x: baseX + baseW / 2,
                y: textY,
                font: this.valueFont,
                fill: vColor,
                align: 'center',
                baseline: 'middle',
                alpha: this.alpha
            });
        }
    }
}
