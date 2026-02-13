import { BaseUIElement } from "./base_element.js";
import { render } from "../../display/_display_system.js";
import { getMouseInput, getMouseFocus } from "../../input/_input_system.js";
import { ColorSchemes } from "../../display/theme_handler.js";
import { animate, remove } from "../../animation/_animation_system.js";
import { lerpColor } from "../../../util/color_util.js";
import { mathUtil } from "../../../util/math_util.js";

const MAX_OVERFLOW = 20;

/**
 * @class SliderElement
 * @description 탄성 애니메이션이 적용된 드래그 가능한 슬라이더 UI 요소입니다.
 */
export class SliderElement extends BaseUIElement {
    constructor(properties) {
        super(properties);

        this.width = properties.width || 100;
        this.trackHeight = properties.trackHeight || 4;
        this.knobRadius = properties.knobRadius || 8;
        this.min = properties.min || 0;
        this.max = properties.max || 100;
        this.value = properties.value || this.min;

        this.activeColor = properties.activeColor || ColorSchemes.Overlay.Slider.ValueActive;
        this.trackColor = properties.trackColor || ColorSchemes.Overlay.Slider.Track;
        this.knobColor = properties.knobColor || ColorSchemes.Overlay.Slider.Knob;
        this.valueColor = properties.valueColor || ColorSchemes.Overlay.Slider.ValueInactive;
        this.valueFont = properties.valueFont || '500 12px "Pretendard Variable", arial';
        this.showValue = properties.showValue !== undefined ? properties.showValue : true;
        this.valueSuffix = properties.valueSuffix !== undefined ? properties.valueSuffix : '%';
        this.valueOffsetX = properties.valueOffsetX || 15;

        this.onChange = properties.onChange || null;
        this.valueFormatter = properties.valueFormatter || null;
        this.dragging = false;

        this._overflow = 0;
        this._hoverScale = 1;
        this._focusRatio = 0;
        this._overflowAnim = null;
        this._hoverAnim = null;
        this._focusAnim = null;
        this._isHovered = false;
        this._isFocused = false;
        this.lastMouseX = 0;
    }

    update() {
        if (!this.visible) return;

        const mx = getMouseInput('x');
        const my = getMouseInput('y');

        const baseW = this.width * this._hoverScale;
        const baseH = this.trackHeight * this._hoverScale;
        const baseX = this.x + (this.width - baseW) / 2;

        const centerX = this.x + this.width / 2;
        let pullDirection = 'none';

        if (this._overflow > 0.01) {
            if (this.lastMouseX < centerX) pullDirection = 'left';
            else pullDirection = 'right';
        }

        const overflowValue = this._overflow * this._hoverScale;
        const currentWidth = baseW + overflowValue;

        let hitX = baseX;
        if (pullDirection === 'left') {
            hitX = (baseX + baseW) - currentWidth;
        } else {
            hitX = baseX;
        }

        const hitBuffer = this.knobRadius * 1.5 * this._hoverScale;
        const hitBufferX = 20;

        const isOverSlider = mx >= hitX - hitBufferX && mx <= hitX + currentWidth + hitBufferX &&
            my >= this.y - hitBuffer && my <= this.y + hitBuffer;

        if (getMouseInput('leftClicking') && getMouseFocus() === this.layer) {
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
                    duration: 0.5,
                    type: 'easeOutElastic'
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

            if (mx < this.x) {
                this._overflow = mathUtil().decay(this.x - mx, MAX_OVERFLOW);
            } else if (mx > this.x + this.width) {
                this._overflow = mathUtil().decay(mx - (this.x + this.width), MAX_OVERFLOW);
            } else {
                this._overflow = 0;
            }
        }

        const targetHover = (isOverSlider || this.dragging) ? 1.15 : 1.0;
        if (this._isHovered !== (targetHover > 1.0)) {
            this._isHovered = (targetHover > 1.0);
            if (this._hoverAnim) remove(this._hoverAnim.id);
            this._hoverAnim = animate(this, {
                variable: '_hoverScale',
                endValue: targetHover,
                duration: 0.2,
                type: 'easeOutExpo'
            });
        }

        const targetFocus = (isOverSlider || this.dragging) ? 1.0 : 0.0;
        if (this._isFocused !== (targetFocus > 0.5)) {
            this._isFocused = (targetFocus > 0.5);
            if (this._focusAnim) remove(this._focusAnim.id);
            this._focusAnim = animate(this, {
                variable: '_focusRatio',
                endValue: targetFocus,
                duration: 0.25,
                type: 'linear'
            });
        }
    }

    draw() {
        if (!this.visible) return;

        const baseW = this.width * this._hoverScale;
        const baseH = this.trackHeight * this._hoverScale;
        const baseX = this.x + (this.width - baseW) / 2;

        const centerX = this.x + this.width / 2;
        let pullDirection = 'right';
        if (this._overflow > 0.01 && this.lastMouseX < centerX) {
            pullDirection = 'left';
        }

        const overflowValue = this._overflow * this._hoverScale;
        const currentWidth = baseW + overflowValue;
        const currentHeight = baseH * (1 - (this._overflow / MAX_OVERFLOW) * 0.2);

        let drawX = baseX;
        if (pullDirection === 'left') {
            drawX = (baseX + baseW) - currentWidth;
        }

        const tColor = this.trackColor || ColorSchemes.Overlay.Slider.Track;

        render(this.layer, {
            shape: 'roundRect',
            x: drawX,
            y: this.y - currentHeight / 2,
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
                y: this.y - currentHeight / 2,
                w: fillW,
                h: currentHeight,
                radius: currentHeight / 2,
                fill: this.activeColor,
                alpha: this.alpha
            });
        }

        const knobX = drawX + fillW;
        const knobR = this.knobRadius * this._hoverScale;

        render(this.layer, {
            shape: 'circle',
            x: knobX,
            y: this.y,
            radius: knobR,
            fill: this.knobColor,
            alpha: this.alpha
        });

        if (this.showValue) {
            const textY = this.y - (this.trackHeight * 1.5 * this._hoverScale) - 5;

            const cNormal = this.valueColor || ColorSchemes.Overlay.Slider.ValueInactive;
            const cActive = this.activeColor || ColorSchemes.Overlay.Slider.ValueActive;
            const vColor = lerpColor(cNormal, cActive, this._focusRatio);

            render(this.layer, {
                shape: 'text',
                text: this.valueFormatter ? this.valueFormatter(this.value) : `${this.value}${this.valueSuffix}`,
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
