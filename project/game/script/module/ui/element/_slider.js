import { BaseUIElement } from "./_base_element.js";
import { render, shadowOn, shadowOff } from "display/display_system.js";
import { getMouseInput, getMouseFocus, hasMouseState, isMousePressing } from "input/input_system.js";
import { ColorSchemes } from "display/_theme_handler.js";
import { animate, remove } from "animation/animation_system.js";
import { colorUtil } from "util/color_util.js";
import { mathUtil } from "util/math_util.js";
import { clamp01 } from "util/number_util.js";
import { DropdownElement } from "./_dropdown.js";

const SLIDER_MAX_OVERFLOW = 0.05;

/**
 * @class SliderElement
 * @description 탄성 애니메이션이 적용된 드래그 가능한 슬라이더 UI 요소입니다.
 */
export class SliderElement extends BaseUIElement {
    #valueAnim;
    #overflowAnim;
    #valueAnimRevision;
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
        this.height = properties.height || 0;
        this.trackHeight = properties.trackHeight || 4;
        this.knobRadius = properties.knobRadius || 2;
        this.min = properties.min !== undefined ? properties.min : 0;
        this.max = properties.max !== undefined ? properties.max : 100;
        this.step = this.#normalizeStep(properties.step);
        this.value = this.#quantizeValue(properties.value !== undefined ? properties.value : this.min);
        this.displayValue = this.value;

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
        this.#valueAnimRevision = (this.#valueAnimRevision || 0) + 1;
        if (this.#overflowAnim) { remove(this.#overflowAnim.id); this.#overflowAnim = null; }
    }

    /**
         * @override
         */
    reset() {
        super.reset();
        if (this.#valueAnim) { remove(this.#valueAnim.id); this.#valueAnim = null; }
        this.#valueAnimRevision = (this.#valueAnimRevision || 0) + 1;
        if (this.#overflowAnim) { remove(this.#overflowAnim.id); this.#overflowAnim = null; }
        this.onChange = null;
        this.onCommit = null;
    }

    /**
     * 기존 `animatedValue` 접근 계약을 공식 표시값인 `displayValue`에 연결합니다.
     * @returns {number} 현재 화면에 표시되는 값입니다.
     */
    get animatedValue() {
        return this.displayValue;
    }

    /**
     * 기존 `animatedValue` 쓰기를 공식 표시값인 `displayValue`에 연결합니다.
     * @param {number} value - 새 표시값입니다.
     */
    set animatedValue(value) {
        this.displayValue = value;
    }

    /**
     * 레이아웃 재생성 결과의 배치·스타일만 받아 현재 drag와 표시값 애니메이션을 보존합니다.
     * 전달된 slider의 raw value와 상호작용 상태는 복사하지 않습니다.
     * @param {SliderElement|null|undefined} source - 새 레이아웃이 만든 slider입니다.
     * @returns {SliderElement} 현재 slider입니다.
     */
    reconcileLayoutFrom(source) {
        if (!source || source === this) {
            return this;
        }

        const layoutFields = [
            'parent', 'layer', 'x', 'y', 'width', 'height', 'trackHeight', 'knobRadius',
            'min', 'max', 'step', 'activeColor', 'trackColor', 'knobColor', 'valueColor',
            'valueFont', 'showValue', 'valueOffsetX', 'valueOffsetY', 'onChange', 'onCommit',
            'valueFormatter', 'alpha', 'shadow', 'visible', 'clickAble', 'tooltip',
            'hoverScaleMultiplier', 'pressScaleMultiplier', 'renderOrder'
        ];
        for (const field of layoutFields) {
            this[field] = source[field];
        }
        return this;
    }

    /**
     * 현재 표시값이 raw 목표값까지 도달했는지 반환합니다.
     * @returns {boolean} 표시 애니메이션이 없으면 true입니다.
     */
    isDisplayValueSettled() {
        return this.#valueAnim === null || this.#valueAnim === undefined;
    }

    /**
     * rapid retarget을 따라가며 마지막 표시값 애니메이션이 끝날 때까지 기다립니다.
     * @returns {Promise<void>} 표시값이 최신 raw 목표에 도달하면 이행됩니다.
     */
    async waitForDisplayValueSettle() {
        while (this.#valueAnim) {
            const currentAnimation = this.#valueAnim;
            await currentAnimation.promise;
            if (this.#valueAnim === currentAnimation) {
                this.displayValue = this.value;
                this.#valueAnim = null;
            }
        }
    }

    /**
     * 콜백을 발생시키지 않고 slider를 지정 값으로 보간합니다.
     * @param {number} value - 새 raw/표시 목표값입니다.
     * @param {{duration?:number, easing?:string}} [options={}] - 표시값 애니메이션 옵션입니다.
     * @returns {Promise<void>} 최신 목표 애니메이션이 끝나면 이행됩니다.
     */
    animateToValue(value, options = {}) {
        const targetValue = this.#quantizeValue(value);
        this.value = targetValue;
        this.dragging = false;
        this.dragChanged = false;
        return this.#animateDisplayValueTo(targetValue, options);
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
            const ratio = clamp01(relativeX / currentWidth);
            const newValue = this.#quantizeValue(this.min + ratio * (this.max - this.min));

            if (newValue !== this.value) {
                this.value = newValue;
                this.dragChanged = true;
                void this.#animateDisplayValueTo(this.value);
                if (this.onChange) this.onChange(this.value);
            }

            // 최대 오버플로우를 너비 비례로 설정 (해상도 독립적)
            const maxOverflow = this.width * SLIDER_MAX_OVERFLOW * this.scale;

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
     * 현재 표시값에서 목표값까지 단일 애니메이션을 시작합니다.
     * @param {number} targetValue - 표시 목표값입니다.
     * @param {{duration?:number, easing?:string}} [options={}] - 애니메이션 옵션입니다.
     * @returns {Promise<void>} 생성한 애니메이션의 완료 Promise입니다.
     * @private
     */
    #animateDisplayValueTo(targetValue, options = {}) {
        if (Object.is(this.displayValue, targetValue)) {
            if (this.#valueAnim) {
                remove(this.#valueAnim.id);
                this.#valueAnim = null;
                this.#valueAnimRevision = (this.#valueAnimRevision || 0) + 1;
            }
            this.displayValue = targetValue;
            return Promise.resolve();
        }

        const duration = Number.isFinite(options.duration) && options.duration >= 0
            ? options.duration
            : 0.2;
        const easing = typeof options.easing === 'string' && options.easing.length > 0
            ? options.easing
            : 'easeOutExpo';
        const animationRevision = (this.#valueAnimRevision || 0) + 1;
        this.#valueAnimRevision = animationRevision;

        if (this.#valueAnim?.retarget?.({
            endValue: targetValue,
            duration,
            type: easing
        }) === true) {
            const retargetedAnimation = this.#valueAnim;
            return retargetedAnimation.promise.then(() => {
                if (this.#valueAnim !== retargetedAnimation
                    || this.#valueAnimRevision !== animationRevision) {
                    return;
                }
                this.displayValue = targetValue;
                this.#valueAnim = null;
            });
        }

        if (this.#valueAnim) {
            remove(this.#valueAnim.id);
            this.#valueAnim = null;
        }

        const displayAnimation = animate(this, {
            variable: 'displayValue',
            startValue: 'current',
            endValue: targetValue,
            duration,
            type: easing
        });
        this.#valueAnim = displayAnimation;
        return displayAnimation.promise.then(() => {
            if (this.#valueAnim !== displayAnimation
                || this.#valueAnimRevision !== animationRevision) {
                return;
            }
            this.displayValue = targetValue;
            this.#valueAnim = null;
        });
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

        const maxOverflow = this.width * SLIDER_MAX_OVERFLOW * this.scale;
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

        const ratio = (this.displayValue - this.min) / (this.max - this.min);
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
            const formattedDisplayValue = this.#getDisplayValue(this.displayValue);

            const cNormal = this.valueColor || ColorSchemes.Overlay.Slider.ValueInactive;
            const cActive = this.activeColor || ColorSchemes.Overlay.Slider.ValueActive;

            // 값 텍스트 색상 페이드는 누름 상태에 기반
            const vColor = colorUtil().lerpColor(cNormal, cActive, this.isPressed ? 1.0 : this.hoverValue);

            render(this.layer, {
                shape: 'text',
                text: this.valueFormatter
                    ? this.valueFormatter(formattedDisplayValue)
                    : formattedDisplayValue,
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
