import { BaseUIElement } from "./_base_element.js";
import { render, shadowOn, shadowOff } from "display/display_system.js";
import { getMouseInput, getMouseFocus, hasMouseState, isMousePressing } from "input/input_system.js";
import { ColorSchemes } from "display/_theme_handler.js";
import { animate, remove } from "animation/animation_system.js";
import { colorUtil, formatRgba } from "util/color_util.js";
import { clamp01 } from "util/number_util.js";
import { DropdownElement } from "./_dropdown.js";

const TOGGLE_ANIMATION = Object.freeze({
    DURATION_SECONDS: 0.32,
    EASING: 'easeOutExpo',
    KNOB_TRAVEL_SHRINK_RATIO: 0.4
});

/**
 * @class ToggleElement
 * @description ON/OFF 토글 스위치 UI 요소입니다.
 */
export class ToggleElement extends BaseUIElement {
    #animID;
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
        this.width = properties.width || 60;
        this.height = properties.height || 30;
        this.value = properties.value || false;

        this.activeColor = properties.activeColor || ColorSchemes.Overlay.Toggle.Active;
        this.inactiveColor = properties.inactiveColor || ColorSchemes.Overlay.Toggle.Inactive;
        this.knobColor = properties.knobColor || ColorSchemes.Overlay.Toggle.Knob;

        this.onChange = properties.onChange || null;

        this.animValue = this.value ? 1 : 0;
        if (this.#animID) { remove(this.#animID.id); this.#animID = null; }

        this.hoverScaleMultiplier = 1.15;
        this.pressScaleMultiplier = 1.15;
    }

    /**
         * @override
         */
    reset() {
        super.reset();
        if (this.#animID) { remove(this.#animID.id); this.#animID = null; }
        this.onChange = null;
    }

    /**
     * 새 레이아웃의 배치·테마 스타일만 받아 진행 중인 토글 보간을 유지합니다.
     * @param {ToggleElement|null|undefined} source - 새 레이아웃이 만든 토글입니다.
     * @returns {ToggleElement} 현재 토글입니다.
     */
    reconcileLayoutFrom(source) {
        if (!source || source === this) {
            return this;
        }

        const layoutFields = [
            'parent', 'layer', 'x', 'y', 'width', 'height',
            'activeColor', 'inactiveColor', 'knobColor', 'onChange',
            'alpha', 'shadow', 'visible', 'clickAble', 'tooltip',
            'hoverScaleMultiplier', 'pressScaleMultiplier', 'renderOrder'
        ];
        for (const field of layoutFields) {
            this[field] = source[field];
        }
        return this;
    }

    /**
     * 값을 설정하고 현재 위치에서 새 상태까지 토글 애니메이션을 재생합니다.
     * @param {boolean} newValue - 새 ON/OFF 값입니다.
     * @returns {void}
     */
    setValue(newValue) {
        void this.animateToValue(newValue, { notify: true });
    }

    /**
     * 현재 위치에서 새 ON/OFF 값까지 보간합니다.
     * @param {boolean} newValue - 새 ON/OFF 값입니다.
     * @param {{duration?:number, easing?:string, notify?:boolean}} [options={}] - 애니메이션 및 콜백 옵션입니다.
     * @returns {Promise<void>} 최신 목표 애니메이션이 끝나면 이행됩니다.
     */
    animateToValue(newValue, options = {}) {
        const valueChanged = this.value !== newValue;
        this.value = newValue;
        if (valueChanged && options.notify === true && this.onChange) {
            this.onChange(this.value);
        }

        if (this.#animID) {
            remove(this.#animID.id);
            this.#animID = null;
        }

        const targetValue = this.value ? 1 : 0;
        if (Object.is(this.animValue, targetValue)) {
            this.animValue = targetValue;
            return Promise.resolve();
        }

        const duration = Number.isFinite(options.duration) && options.duration >= 0
            ? options.duration
            : TOGGLE_ANIMATION.DURATION_SECONDS;
        const easing = typeof options.easing === 'string' && options.easing.length > 0
            ? options.easing
            : TOGGLE_ANIMATION.EASING;
        const animation = animate(this, {
            variable: 'animValue',
            startValue: 'current',
            endValue: targetValue,
            duration,
            type: easing
        });
        this.#animID = animation;
        return animation.promise.then(() => {
            if (this.#animID !== animation) {
                return;
            }
            this.animValue = targetValue;
            this.#animID = null;
        });
    }

    /**
     * @override
     */
    update() {
        if (!this.visible) return;

        const mx = getMouseInput('x');
        const my = getMouseInput('y');
        if (DropdownElement.isPointerBlockedFor(mx, my, this.layer, this.id)) {
            this._handleInteractionState(false, false);
            return;
        }

        const isOver = mx >= this.x && mx <= this.x + this.width &&
            my >= this.y && my <= this.y + this.height;

        if (hasMouseState('left', 'clicked') && getMouseFocus().includes(this.layer)) {
            if (isOver) {
                this.setValue(!this.value);
            }
        }

        const isLeftPressing = isMousePressing('left');

        // 기본 UI 요소의 공통 상호작용 처리 호출
        this._handleInteractionState(isOver, isLeftPressing);
    }

    /**
         * @override
         */
    draw() {
        if (!this.visible) return;

        const c1 = colorUtil().cssToRgb(this.inactiveColor);
        const c2 = colorUtil().cssToRgb(this.activeColor);
        const t = clamp01(this.animValue);

        const r = Math.round(c1.r + (c2.r - c1.r) * t);
        const g = Math.round(c1.g + (c2.g - c1.g) * t);
        const b = Math.round(c1.b + (c2.b - c1.b) * t);
        const a1 = c1.a !== undefined ? c1.a : 1;
        const a2 = c2.a !== undefined ? c2.a : 1;
        const a = a1 + (a2 - a1) * t;

        const trackColor = formatRgba(r, g, b, a);

        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;

        const w = this.width * this.scale;
        const h = this.height * this.scale;

        const x = cx - w / 2;
        const y = cy - h / 2;

        render(this.layer, {
            shape: 'roundRect',
            x: x,
            y: y,
            w: w,
            h: h,
            radius: h / 2,
            fill: trackColor,
            alpha: this.alpha
        });

        const baseKnobR = h * 0.4;
        const travelMorph = Math.sin(Math.PI * t);
        const knobR = baseKnobR * (1 - travelMorph * TOGGLE_ANIMATION.KNOB_TRAVEL_SHRINK_RATIO);
        const padding = h * 0.1;
        const startX = x + padding + baseKnobR;
        const endX = x + w - padding - baseKnobR;
        const knobX = startX + (endX - startX) * t;
        const knobY = y + h / 2;

        shadowOn(this.layer, 5, ColorSchemes.Overlay.Toggle.Shadow || 'rgba(0, 0, 0, 0.2)');
        render(this.layer, {
            shape: 'circle',
            x: knobX,
            y: knobY,
            radius: knobR,
            fill: this.knobColor,
            alpha: this.alpha
        });
        shadowOff(this.layer);
    }
}
