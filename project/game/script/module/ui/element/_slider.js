import { BaseUIElement } from "./_base_element.js";
import { render, shadowOn, shadowOff } from "display/display_system.js";
import { getMouseInput, getMouseFocus } from "input/input_system.js";
import { ColorSchemes } from "display/_theme_handler.js";
import { animate, remove } from "animation/animation_system.js";
import { colorUtil } from "util/color_util.js";
import { mathUtil } from "util/math_util.js";
import { getData } from "data/data_handler.js";
import { DropdownElement } from "./_dropdown.js";

const GLOBAL_CONSTANTS = getData('GLOBAL_CONSTANTS');

/**
 * @class SliderElement
 * @description 탄성 애니메이션이 적용된 드래그 가능한 슬라이더 UI 요소입니다.
 */
export class SliderElement extends BaseUIElement {
    constructor(properties) {
        super(properties);
    }

    /**
         * @override
         */
    init(properties) {
        super.init(properties);
        if (!properties) return;
        this.width = properties.width || 100;
        this.trackHeight = properties.trackHeight || 4;
        this.knobRadius = properties.knobRadius || 2;
        this.min = properties.min || 0;
        this.max = properties.max || 100;
        this.value = properties.value || this.min;
        this.animatedValue = this.value;

        this.activeColor = properties.activeColor || ColorSchemes.Overlay.Slider.ValueActive;
        this.trackColor = properties.trackColor || ColorSchemes.Overlay.Slider.Track;
        this.knobColor = properties.knobColor || ColorSchemes.Overlay.Slider.Knob;
        this.valueColor = properties.valueColor || ColorSchemes.Overlay.Slider.ValueInactive;
        this.valueFont = properties.valueFont || '500 12px "Pretendard Variable", arial';
        this.showValue = properties.showValue !== undefined ? properties.showValue : true;
        this.valueOffsetX = properties.valueOffsetX || 15;
        this.valueOffsetY = properties.valueOffsetY || 0;

        this.onChange = properties.onChange || null;
        this.valueFormatter = properties.valueFormatter || null;
        this.dragging = false;

        this._overflow = 0;
        this.lastMouseX = 0;
        this.hoverScaleMultiplier = 1.1;
        this.pressScaleMultiplier = 1.1;
        this.prevLeftClicking = false;

        if (this._valueAnim) { remove(this._valueAnim.id); this._valueAnim = null; }
        if (this._overflowAnim) { remove(this._overflowAnim.id); this._overflowAnim = null; }
    }

    /**
         * @override
         */
    reset() {
        super.reset();
        if (this._valueAnim) { remove(this._valueAnim.id); this._valueAnim = null; }
        if (this._overflowAnim) { remove(this._overflowAnim.id); this._overflowAnim = null; }
        this.onChange = null;
    }

    /**
         * @override
         * 마우스 드래그 동작 등을 추적하여 슬라이더 값 및 오버플로우 애니메이션을 업데이트합니다.
         */
    update() {
        if (!this.visible) return;

        const mx = getMouseInput('x');
        const my = getMouseInput('y');
        const isLeftClicking = getMouseInput('leftClicking');

        // 포커스 확인: 현재 포커스 레이어와 다르면 입력 무시
        if (!getMouseFocus().includes(this.layer)) {
            if (this.dragging) {
                this.dragging = false;
            }
            this.prevLeftClicking = isLeftClicking;
            return;
        }

        if (DropdownElement.isPointerBlockedFor(mx, my, this.layer, this.id)) {
            if (this.dragging) {
                this.dragging = false;
            }
            this._handleInteractionState(false, false);
            this.prevLeftClicking = isLeftClicking;
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

        // 드래그 시작 시점 (이전에 누르지 않았고, 지금 누르기 시작했고, 마우스가 슬라이더 위에 있을 때)
        if (isLeftClicking && !this.prevLeftClicking && getMouseFocus().includes(this.layer) && isOverSlider) {
            if (!this.dragging) {
                this.dragging = true;
                if (this._overflowAnim) {
                    remove(this._overflowAnim.id);
                    this._overflowAnim = null;
                }
            }
        }

        if (!isLeftClicking) {
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
                if (this._valueAnim) remove(this._valueAnim.id);
                this._valueAnim = animate(this, {
                    variable: 'animatedValue',
                    startValue: 'current',
                    endValue: this.value,
                    duration: 0.2,
                    type: 'easeOutExpo'
                });
                if (this.onChange) this.onChange(this.value);
            }

            // 최대 오버플로우를 너비 비례로 설정 (해상도 독립적)
            const maxOverflow = this.width * GLOBAL_CONSTANTS.SLIDER_MAX_OVERFLOW * this.scale;

            if (mx < baseX) {
                this._overflow = mathUtil().decay(baseX - mx, maxOverflow);
            } else if (mx > baseX + baseW) {
                this._overflow = mathUtil().decay(mx - (baseX + baseW), maxOverflow);
            } else {
                this._overflow = 0;
            }
        }

        // 기본 UI 요소의 공통 상호작용 처리 호출
        this._handleInteractionState(isOverSlider || this.dragging, this.dragging);

        this.prevLeftClicking = isLeftClicking;
    }

    /**
         * @override
         * 내부 트랙, 슬라이더 동그라미(Knob) 및 텍스트 값을 화면에 그립니다.
         */
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

        const ratio = (this.animatedValue - this.min) / (this.max - this.min);
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

        shadowOn(this.layer, 5, ColorSchemes.Overlay.Slider.Shadow || 'rgba(0, 0, 0, 0.2)');
        render(this.layer, {
            shape: 'circle',
            x: knobX,
            y: drawY,
            radius: knobR,
            fill: this.knobColor,
            alpha: this.alpha
        });
        shadowOff(this.layer);

        if (this.showValue) {
            const textY = drawY - (this.trackHeight * 2.25 * this.scale);

            const cNormal = this.valueColor || ColorSchemes.Overlay.Slider.ValueInactive;
            const cActive = this.activeColor || ColorSchemes.Overlay.Slider.ValueActive;

            // 값 텍스트 색상 페이드는 누름 상태에 기반
            const vColor = colorUtil().lerpColor(cNormal, cActive, this.isPressed ? 1.0 : this.hoverValue);

            render(this.layer, {
                shape: 'text',
                text: this.valueFormatter ? this.valueFormatter(this.value) : this.value,
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
