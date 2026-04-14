import { BaseUIElement } from "./_base_element.js";
import { render, shadowOn, shadowOff } from "display/display_system.js";
import { getMouseInput, getMouseFocus, hasMouseState, isMousePressing } from "input/input_system.js";
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
    #valueAnim;
    #overflowAnim;
    constructor(properties) {
        super(properties);
        this.init(properties);
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
        this.min = properties.min !== undefined ? properties.min : 0;
        this.max = properties.max !== undefined ? properties.max : 100;
        this.step = this.#normalizeStep(properties.step);
        this.value = this.#quantizeValue(properties.value !== undefined ? properties.value : this.min);
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
        this.onCommit = properties.onCommit || null;
        this.valueFormatter = properties.valueFormatter || null;
        this.dragging = false;
        this.dragChanged = false;

        this._overflow = 0;
        this.lastMouseX = 0;
        this.hoverScaleMultiplier = 1.1;
        this.pressScaleMultiplier = 1.1;

        if (this.#valueAnim) { remove(this.#valueAnim.id); this.#valueAnim = null; }
        if (this.#overflowAnim) { remove(this.#overflowAnim.id); this.#overflowAnim = null; }
    }

    /**
         * @override
         */
    reset() {
        super.reset();
        if (this.#valueAnim) { remove(this.#valueAnim.id); this.#valueAnim = null; }
        if (this.#overflowAnim) { remove(this.#overflowAnim.id); this.#overflowAnim = null; }
        this.onChange = null;
        this.onCommit = null;
    }

    /**
         * @override
         * 마우스 드래그 동작 등을 추적하여 슬라이더 값 및 오버플로우 애니메이션을 업데이트합니다.
         */
    update() {
        if (!this.visible) return;

        const mx = getMouseInput('x');
        const my = getMouseInput('y');
        const isLeftPressing = isMousePressing('left');
        const isLeftClick = hasMouseState('left', 'click');

        // 포커스 확인: 현재 포커스 레이어와 다르면 입력 무시
        if (!getMouseFocus().includes(this.layer)) {
            if (this.dragging) {
                this.#commitDragValue();
                this.dragging = false;
            }
            return;
        }

        if (DropdownElement.isPointerBlockedFor(mx, my, this.layer, this.id)) {
            if (this.dragging) {
                this.#commitDragValue();
                this.dragging = false;
            }
            this._handleInteractionState(false, false);
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

        // 눌림 시작 프레임에 슬라이더 위였다면 드래그를 개시합니다.
        if (isLeftClick && getMouseFocus().includes(this.layer) && isOverSlider) {
            if (!this.dragging) {
                this.dragging = true;
                this.dragChanged = false;
                if (this.#overflowAnim) {
                    remove(this.#overflowAnim.id);
                    this.#overflowAnim = null;
                }
            }
        }

        if (!isLeftPressing) {
            if (this.dragging) {
                this.#commitDragValue();
                this.dragging = false;
                this.#overflowAnim = animate(this, {
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
            const newValue = this.#quantizeValue(this.min + ratio * (this.max - this.min));

            if (newValue !== this.value) {
                this.value = newValue;
                this.dragChanged = true;
                if (this.#valueAnim) remove(this.#valueAnim.id);
                this.#valueAnim = animate(this, {
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
    }

    /**
     * @private
     * 슬라이더 step 값을 유효한 양수로 정규화합니다.
     * @param {number|undefined} step - 입력 step 값입니다.
     * @returns {number} 사용할 step 값입니다.
     */
    #normalizeStep(step) {
        const normalizedStep = Number(step);
        if (!Number.isFinite(normalizedStep) || normalizedStep <= 0) {
            return 1;
        }

        return normalizedStep;
    }

    /**
     * @private
     * 현재 step 값 기준으로 소수점 정밀도를 계산합니다.
     * @returns {number} 표시 및 반올림에 사용할 소수 자릿수입니다.
     */
    #getStepPrecision() {
        const normalizedStep = this.step.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
        const dotIndex = normalizedStep.indexOf('.');
        return dotIndex === -1 ? 0 : normalizedStep.length - dotIndex - 1;
    }

    /**
     * @private
     * 원시 입력값을 min/max와 step 기준으로 양자화합니다.
     * @param {number} rawValue - 보정 전 값입니다.
     * @returns {number} 슬라이더에서 사용할 보정된 값입니다.
     */
    #quantizeValue(rawValue) {
        const cappedValue = mathUtil().cap(rawValue, this.min, this.max);
        const steppedValue = this.min + (Math.round((cappedValue - this.min) / this.step) * this.step);
        const precision = this.#getStepPrecision();
        return Number(mathUtil().cap(steppedValue, this.min, this.max).toFixed(precision));
    }

    /**
     * @private
     * 포매터가 없을 때 사용할 기본 표시 값을 반환합니다.
     * @param {number} value - 표시할 값입니다.
     * @returns {number} step 정밀도에 맞춘 값입니다.
     */
    #getDisplayValue(value) {
        const precision = this.#getStepPrecision();
        return precision > 0 ? Number(value.toFixed(precision)) : Math.round(value);
    }

    /**
     * @private
     * 드래그 중 변경된 값을 마우스 해제 시점에 확정 콜백으로 전달합니다.
     */
    #commitDragValue() {
        if (!this.dragChanged) {
            return;
        }

        this.dragChanged = false;
        if (this.onCommit) {
            this.onCommit(this.value);
        }
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
                text: this.valueFormatter ? this.valueFormatter(this.value) : this.#getDisplayValue(this.value),
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
