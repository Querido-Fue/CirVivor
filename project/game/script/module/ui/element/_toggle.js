import { BaseUIElement } from "./_base_element.js";
import { render, shadowOn, shadowOff } from "display/display_system.js";
import { getMouseInput, getMouseFocus } from "input/input_system.js";
import { ColorSchemes } from "display/_theme_handler.js";
import { animate, remove } from "animation/animation_system.js";
import { colorUtil } from "util/color_util.js";
import { DropdownElement } from "./_dropdown.js";

/**
 * @class ToggleElement
 * @description ON/OFF 토글 스위치 UI 요소입니다.
 */
export class ToggleElement extends BaseUIElement {
    constructor(properties) {
        super(properties);
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

        this._animValue = this.value ? 1 : 0;
        if (this._animID) { remove(this._animID.id); this._animID = null; }

        this.hoverScaleMultiplier = 1.15;
        this.pressScaleMultiplier = 1.15;
    }

    /**
         * @override
         */
    reset() {
        super.reset();
        if (this._animID) { remove(this._animID.id); this._animID = null; }
        this.onChange = null;
    }

    /**
     * 값을 설정하고 애니메이션을 재생합니다.
     * @param {boolean} newValue 
     */
    setValue(newValue) {
        if (this.value !== newValue) {
            this.value = newValue;
            if (this.onChange) this.onChange(this.value);

            if (this._animID) remove(this._animID.id);
            this._animID = animate(this, {
                variable: '_animValue',
                endValue: this.value ? 1 : 0,
                duration: 0.3,
                type: 'easeOutExpo'
            });
        }
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

        if (getMouseInput('leftClicked') && getMouseFocus().includes(this.layer)) {
            if (isOver) {
                this.setValue(!this.value);
            }
        }

        const isLeftClicking = getMouseInput('leftClicking');

        // 기본 UI 요소의 공통 상호작용 처리 호출
        this._handleInteractionState(isOver, isLeftClicking);
    }

    /**
         * @override
         */
    draw() {
        if (!this.visible) return;

        const c1 = colorUtil().cssToRgb(this.inactiveColor);
        const c2 = colorUtil().cssToRgb(this.activeColor);
        const t = this._animValue;

        const r = Math.round(c1.r + (c2.r - c1.r) * t);
        const g = Math.round(c1.g + (c2.g - c1.g) * t);
        const b = Math.round(c1.b + (c2.b - c1.b) * t);
        const a1 = c1.a !== undefined ? c1.a : 1;
        const a2 = c2.a !== undefined ? c2.a : 1;
        const a = a1 + (a2 - a1) * t;

        const trackColor = `rgba(${r}, ${g}, ${b}, ${a})`;

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

        const knobR = h * 0.4;
        const padding = h * 0.1;
        const startX = x + padding + knobR;
        const endX = x + w - padding - knobR;
        const knobX = startX + (endX - startX) * this._animValue;
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
