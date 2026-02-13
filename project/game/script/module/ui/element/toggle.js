import { BaseUIElement } from "./base_element.js";
import { render } from "../../display/_display_system.js";
import { getMouseInput, getMouseFocus } from "../../input/_input_system.js";
import { ColorSchemes } from "../../display/theme_handler.js";
import { animate, remove } from "../../animation/_animation_system.js";
import { cssToRgb } from "../../../util/color_util.js";

/**
 * @class ToggleElement
 * @description ON/OFF 토글 스위치 UI 요소입니다.
 */
export class ToggleElement extends BaseUIElement {
    constructor(properties) {
        super(properties);

        this.width = properties.width || 60;
        this.height = properties.height || 30;
        this.value = properties.value || false;

        this.activeColor = properties.activeColor || ColorSchemes.Overlay.Toggle.Active;
        this.inactiveColor = properties.inactiveColor || ColorSchemes.Overlay.Toggle.Inactive;
        this.knobColor = properties.knobColor || ColorSchemes.Overlay.Toggle.Knob;

        this.onChange = properties.onChange || null;

        this._animValue = this.value ? 1 : 0;
        this._animID = null;
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

    update() {
        if (!this.visible) return;

        if (getMouseInput('leftClicked') && getMouseFocus() === this.layer) {
            const mx = getMouseInput('x');
            const my = getMouseInput('y');
            if (mx >= this.x && mx <= this.x + this.width &&
                my >= this.y && my <= this.y + this.height) {
                this.setValue(!this.value);
            }
        }
    }

    draw() {
        if (!this.visible) return;

        const c1 = cssToRgb(this.inactiveColor);
        const c2 = cssToRgb(this.activeColor);
        const t = this._animValue;

        const r = Math.round(c1.r + (c2.r - c1.r) * t);
        const g = Math.round(c1.g + (c2.g - c1.g) * t);
        const b = Math.round(c1.b + (c2.b - c1.b) * t);
        const a1 = c1.a !== undefined ? c1.a : 1;
        const a2 = c2.a !== undefined ? c2.a : 1;
        const a = a1 + (a2 - a1) * t;

        const trackColor = `rgba(${r}, ${g}, ${b}, ${a})`;

        render(this.layer, {
            shape: 'roundRect',
            x: this.x,
            y: this.y,
            w: this.width,
            h: this.height,
            radius: this.height / 2,
            fill: trackColor,
            alpha: this.alpha
        });

        const knobR = this.height * 0.4;
        const padding = this.height * 0.1;
        const startX = this.x + padding + knobR;
        const endX = this.x + this.width - padding - knobR;
        const knobX = startX + (endX - startX) * this._animValue;
        const knobY = this.y + this.height / 2;

        render(this.layer, {
            shape: 'circle',
            x: knobX,
            y: knobY,
            radius: knobR,
            fill: this.knobColor,
            alpha: this.alpha
        });
    }
}
