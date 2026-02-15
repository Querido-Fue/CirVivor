import { BaseUIElement } from "./base_element.js";
import { render } from "display/_display_system.js";
import { getMouseInput, getMouseFocus } from "input/_input_system.js";
import { animate, remove } from "animation/_animation_system.js";
import { getDelta } from "game/time_handler.js";

import { cssToRgb, rgbParse } from "util/color_util.js";
import { ColorSchemes } from "display/theme_handler.js";

/**
 * @class ButtonElement
 * @description 상호작용 가능한 UI 버튼 요소입니다.
 * @param {object} properties - 버튼 속성
 * @param {object} properties.parent - 부모 객체
 * @param {Function} properties.onClick - 클릭 시 콜백
 * @param {Function} properties.onHover - 호버 시 콜백
 * @param {string} properties.layer - 렌더링 레이어
 * @param {number} properties.x - X 좌표
 * @param {number} properties.y - Y 좌표
 * @param {number} properties.width - 너비
 * @param {number} properties.height - 높이
 * @param {string} properties.idleColor - 기본 색상
 * @param {string} properties.hoverColor - 호버 색상
 * @param {string} properties.text - 버튼 텍스트
 * @param {string} properties.align - 텍스트 정렬
 * @param {string} properties.font - 폰트
 * @param {number} properties.fontWeight - 폰트 굵기
 * @param {number} properties.size - 폰트 크기
 * @param {string} properties.color - 텍스트 색상
 * @param {number} [properties.alpha=1] - 투명도
 * @param {number} [properties.margin=0] - 텍스트 마진
 * @param {boolean} [properties.clickAble=true] - 클릭 가능 여부
 */
export class ButtonElement extends BaseUIElement {
    constructor(properties) {
        super(properties);
        this.onClick = properties.onClick || (() => { });
        this.onHover = properties.onHover || (() => { });

        this.text = properties.text || '';
        this.align = properties.align || 'center';
        this.font = properties.font || 'arial';
        this.fontWeight = properties.fontWeight ? properties.fontWeight + " " : "";
        this.size = properties.size || 12;
        this.color = properties.color;

        this.margin = properties.margin || 0;
        this.verticalMargin = properties.verticalMargin || 0;


        if (properties.width) {
            this.width = properties.width;
            this.autoWidth = false;
        } else {
            const tempCanvas = document.createElement('canvas');
            const ctx = tempCanvas.getContext('2d');
            ctx.font = `${this.fontWeight}${this.size}px ${this.font}`;
            const textWidth = ctx.measureText(this.text).width;
            this.width = textWidth + (this.margin * 2);
            this.autoWidth = true;
        }

        if (properties.height) {
            this.height = properties.height;
        } else {
            this.height = this.size + (this.verticalMargin * 2);
        }

        this.idleColor = properties.idleColor || ColorSchemes.Overlay.Control.Inactive;
        this.hoverColor = properties.hoverColor || ColorSchemes.Overlay.Control.Hover;

        this._idleColorStruct = cssToRgb(this.idleColor);
        this._hoverColorStruct = cssToRgb(this.hoverColor);

        this.hoverValue = 0;
        this._targetHoverValue = 0;
        this.hoverAnimId = -1;

        if (properties.color) this.color = properties.color;

        this.clickAnimationTimer = 0;
        this.clickAble = properties.clickAble === undefined ? true : properties.clickAble;
        this.enableHoverGradient = properties.enableHoverGradient !== undefined ? properties.enableHoverGradient : true;
        this.radius = properties.radius || 5;
    }

    update() {
        if (!this.visible) return;

        // 포커스 확인
        if (getMouseFocus() !== this.layer) return;

        let isHovered = false;
        const mx = getMouseInput('x');
        if (getMouseInput("x") >= this.x && getMouseInput("x") <= this.x + this.width && getMouseInput("y") >= this.y && getMouseInput("y") <= this.y + this.height && this.clickAble) {
            isHovered = true;
        }

        const targetValue = isHovered ? 1.0 : 0.0;

        if (targetValue !== this._targetHoverValue) {
            this._targetHoverValue = targetValue;

            if (this.hoverAnimId !== -1) {
                remove(this.hoverAnimId);
                this.hoverAnimId = -1;
            }

            const animObj = animate(this, {
                variable: 'hoverValue',
                startValue: this.hoverValue,
                endValue: this._targetHoverValue,
                type: 'easeOutCubic',
                duration: 0.2
            });
            this.hoverAnimId = animObj.id;

            if (isHovered) this.onHover();
        }


        if (isHovered && getMouseInput("leftClicked")) {
            this.onClick();
            if (this.clickAnimationTimer === 0) {
                animate(this, { variable: 'size', startValue: this.size * 0.9, endValue: this.size, type: "easeOutExpo", duration: 0.3 });
                this.clickAnimationTimer = 0.3;
            }
        }

        const t = this.hoverValue;
        const r = this._idleColorStruct.r + (this._hoverColorStruct.r - this._idleColorStruct.r) * t;
        const g = this._idleColorStruct.g + (this._hoverColorStruct.g - this._idleColorStruct.g) * t;
        const b = this._idleColorStruct.b + (this._hoverColorStruct.b - this._idleColorStruct.b) * t;
        const a = this._idleColorStruct.a + (this._hoverColorStruct.a - this._idleColorStruct.a) * t;

        this.currentColor = rgbParse(r, g, b, a);

        if (this.clickAnimationTimer > 0) {
            this.clickAnimationTimer -= getDelta();
        }
        if (this.clickAnimationTimer < 0) {
            this.clickAnimationTimer = 0;
        }
    }

    draw() {
        if (!this.visible) return;

        if (this.shadow) {
            shadowOn(this.layer, this.shadow.blur, this.shadow.color);
        }

        render(this.layer, {
            shape: 'roundRect',
            x: this.x,
            y: this.y,
            w: this.width,
            h: this.height,
            radius: this.radius,
            fill: this.currentColor,
            alpha: this.alpha
        });

        if (this.enableHoverGradient && this.hoverValue > 0.01) {
            const startOpacity = 0.2 * this.hoverValue;

            const gradient = {
                type: 'linear',
                x1: this.x,
                y1: this.y,
                x2: this.x + this.width,
                y2: this.y,
                stops: [
                    { offset: 0, color: `rgba(255, 255, 255, ${startOpacity})` },
                    { offset: 0.8, color: `rgba(255, 255, 255, ${startOpacity})` },
                    { offset: 1, color: 'rgba(255, 255, 255, 0)' }
                ]
            };

            render(this.layer, {
                shape: 'roundRect',
                x: this.x,
                y: this.y,
                w: this.width,
                h: this.height,
                radius: this.radius,
                fill: gradient,
                alpha: this.alpha
            });
        }

        let textX;
        switch (this.align) {
            case 'center':
                textX = this.x + this.width / 2;
                break;
            case 'right':
                textX = this.x + this.width - this.margin;
                break;
            case 'left':
                textX = this.x + this.margin;
                break;
        }

        if (textX !== undefined) {
            render(this.layer, {
                shape: 'text',
                text: this.text,
                x: textX,
                y: this.y + this.height / 2,
                font: `${this.fontWeight}${this.size}px ${this.font}`,
                fill: this.color,
                alpha: this.alpha,
                align: this.align,
                baseline: 'middle'
            });
        }

        if (this.shadow) {
            shadowOff(this.layer);
        }
    }
}
