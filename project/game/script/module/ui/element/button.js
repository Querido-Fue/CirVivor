import { BaseUIElement } from "./base_element.js";
import { render } from "display/_display_system.js";
import { getMouseInput, getMouseFocus } from "input/_input_system.js";
import { animate, remove } from "animation/_animation_system.js";

import { colorUtil } from "util/color_util.js";
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
 * @param {string} [properties.iconType='none'] - 아이콘 타입 ('arrow', 'confirm', 'deny', 'none')
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

        this._idleColorStruct = colorUtil().cssToRgb(this.idleColor);
        this._hoverColorStruct = colorUtil().cssToRgb(this.hoverColor);
        if (properties.color) this.color = properties.color;

        this.enableHoverGradient = properties.enableHoverGradient || false;
        this.radius = properties.radius || 5;

        this.iconType = properties.iconType || 'none'; // 'arrow', 'confirm', 'deny', 'none'
    }

    update() {
        if (!this.visible) return;

        if (!getMouseFocus().includes(this.layer)) {
            return;
        };

        let isHovered = false;
        if (getMouseInput("x") >= this.x && getMouseInput("x") <= this.x + this.width && getMouseInput("y") >= this.y && getMouseInput("y") <= this.y + this.height && this.clickAble) {
            isHovered = true;
        }

        const isLeftClicking = getMouseInput("leftClicking");

        // 부모의 공통 호버, 클릭 스케일 애니메이션 처리
        this._handleInteractionState(isHovered, isLeftClicking, this.onHover);


        if (isHovered && getMouseInput("leftClicked")) {
            this.onClick();
        }

        const t = this.hoverValue;
        const r = this._idleColorStruct.r + (this._hoverColorStruct.r - this._idleColorStruct.r) * t;
        const g = this._idleColorStruct.g + (this._hoverColorStruct.g - this._idleColorStruct.g) * t;
        const b = this._idleColorStruct.b + (this._hoverColorStruct.b - this._idleColorStruct.b) * t;
        const a = this._idleColorStruct.a + (this._hoverColorStruct.a - this._idleColorStruct.a) * t;

        this.currentColor = colorUtil().rgbParse(r, g, b, a);
    }

    draw() {
        if (!this.visible) return;

        // 스케일 적용 (중심점 기준 축소/확대가 아니라 top-left 부터 시작하는 LayoutHandler 룰에 맞춤)
        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;
        const scaledW = this.width * this.scale;
        const scaledH = this.height * this.scale;

        // 버튼이 가운데로 모이도록 cx, cy를 기준으로 다시 x,y 계산
        const scaledX = cx - scaledW / 2;
        const scaledY = cy - scaledH / 2;

        if (this.shadow) {
            shadowOn(this.layer, this.shadow.blur, this.shadow.color);
        }

        render(this.layer, {
            shape: 'roundRect',
            x: scaledX,
            y: scaledY,
            w: scaledW,
            h: scaledH,
            radius: this.radius,
            fill: this.currentColor,
            alpha: this.alpha
        });

        if (this.enableHoverGradient && this.hoverValue > 0.01) {
            const startOpacity = 0.2 * this.hoverValue;

            const gradient = {
                type: 'linear',
                x1: scaledX,
                y1: scaledY,
                x2: scaledX + scaledW,
                y2: scaledY,
                stops: [
                    { offset: 0, color: `rgba(255, 255, 255, ${startOpacity})` },
                    { offset: 0.8, color: `rgba(255, 255, 255, ${startOpacity})` },
                    { offset: 1, color: 'rgba(255, 255, 255, 0)' }
                ]
            };

            render(this.layer, {
                shape: 'roundRect',
                x: scaledX,
                y: scaledY,
                w: scaledW,
                h: scaledH,
                radius: this.radius,
                fill: gradient,
                alpha: this.alpha
            });
        }

        // 레이아웃 계산
        const iconSize = this.iconType !== 'none' ? scaledH * 0.5 : 0;
        if (this.iconType && this.iconType !== 'none') {
            const iconSize = this.text ? scaledH * 0.4 : scaledH * 0.6; // 텍스트 유무에 따라 크기 조절
            const iconX = scaledX; // 아이콘은 항상 왼쪽 시작점
            const iconY = scaledY; // 아이콘 Y는 버튼 상단

            this._drawIcon(this.iconType, scaledX, scaledY, scaledW, scaledH);
        }

        let textX;

        if (this.align === 'center') {
            textX = scaledX + scaledW / 2;
        } else if (this.align === 'right') {
            textX = scaledX + scaledW - this.margin;
        } else if (this.align === 'left') {
            textX = scaledX + this.margin;
            // 아이콘이 있다면 텍스트 시작 위치를 아이콘 뒤로 미룸
            if (this.iconType === 'arrow') {
                textX += scaledW * 0.25; // 화살표 길이만큼 이동
            } else if (['confirm', 'deny', 'check'].includes(this.iconType)) {
                textX += scaledW * 0.15 + (scaledH * 0.4) / 2 + (scaledW * 0.05); // 아이콘 위치 + 반대편까지 + 여백
            }
        }

        if (textX !== undefined) {
            // 폰트 크기 스케일 적용
            const scaledSize = this.size * this.scale;

            let familyName = this.font;
            if (!familyName.includes('"') && !familyName.includes("'")) {
                const parts = familyName.split(',');
                familyName = `"${parts[0].trim()}"${parts[1] ? ',' + parts[1] : ''}`;
            }

            render(this.layer, {
                shape: 'text',
                text: this.text,
                x: textX,
                y: scaledY + scaledH / 2,
                font: `${this.fontWeight}${scaledSize}px ${familyName}`,
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
    /**
     * 아이콘을 그립니다.
     * @param {string} type - 아이콘 타입
     * @param {number} x - X 좌표
     * @param {number} y - Y 좌표
     * @param {number} w - 너비
     * @param {number} h - 높이
     */
    _drawIcon(type, x, y, w, h) {
        if (type === 'arrow') {
            // 화살표 높이 및 크기 계산
            const arrowH = (h * 0.13) * 0.7;

            const arrowLeft = x;
            const arrowLen = (w * 0.25) * 0.7;
            const arrowRight = x + arrowLen;
            const arrowY = y + h / 2;
            const headSize = arrowH * 0.9 * 3;

            render(this.layer, {
                shape: 'line',
                x1: arrowLeft, y1: arrowY,
                x2: arrowRight, y2: arrowY,
                stroke: this.color,
                lineWidth: 1.2 * this.scale,
                alpha: this.alpha,
                lineCap: 'round'
            });
            render(this.layer, {
                shape: 'line',
                x1: arrowRight - headSize, y1: arrowY - headSize,
                x2: arrowRight, y2: arrowY,
                stroke: this.color,
                lineWidth: 1.2 * this.scale,
                alpha: this.alpha,
                lineCap: 'round'
            });
            render(this.layer, {
                shape: 'line',
                x1: arrowRight - headSize, y1: arrowY + headSize,
                x2: arrowRight, y2: arrowY,
                stroke: this.color,
                lineWidth: 1.2 * this.scale,
                alpha: this.alpha,
                lineCap: 'round'
            });
        } else if (type === 'confirm') {
            // O 아이콘
            const iconSize = (h * 0.4) * 0.85;
            const iconX = x + w * 0.15;
            const iconY = y + h / 2;

            render(this.layer, {
                shape: 'circle',
                x: iconX,
                y: iconY,
                radius: iconSize / 2,
                fill: false,
                stroke: this.color,
                lineWidth: 1.2 * this.scale,
                alpha: this.alpha
            });
        } else if (type === 'deny') {
            // X 아이콘
            const iconSize = h * 0.4;
            const iconX = x + w * 0.15;
            const iconY = y + h / 2;
            const xSize = iconSize * 0.6;

            render(this.layer, {
                shape: 'line',
                x1: iconX - xSize / 2,
                y1: iconY - xSize / 2,
                x2: iconX + xSize / 2,
                y2: iconY + xSize / 2,
                stroke: this.color,
                lineWidth: 1.2 * this.scale,
                alpha: this.alpha,
                lineCap: 'round'
            });
            render(this.layer, {
                shape: 'line',
                x1: iconX + xSize / 2,
                y1: iconY - xSize / 2,
                x2: iconX - xSize / 2,
                y2: iconY + xSize / 2,
                stroke: this.color,
                lineWidth: 1.2 * this.scale,
                alpha: this.alpha,
                lineCap: 'round'
            });
        } else if (type === 'check') {
            const iconSize = h * 0.4;
            const iconX = x + w * 0.15;
            const iconY = y + h / 2;
            const halfSize = iconSize / 2;

            // 체크 아이콘 (V 형태)
            // 왼쪽 점: (iconX - halfSize * 0.8, iconY)
            // 중간 점: (iconX - halfSize * 0.2, iconY + halfSize * 0.8)
            // 오른쪽 점: (iconX + halfSize * 0.8, iconY - halfSize * 0.8)

            render(this.layer, {
                shape: 'line',
                x1: iconX - halfSize * 0.8, y1: iconY,
                x2: iconX - halfSize * 0.2, y2: iconY + halfSize * 0.8,
                stroke: this.color,
                lineWidth: 1.2 * this.scale,
                alpha: this.alpha,
                lineCap: 'round'
            });
            render(this.layer, {
                shape: 'line',
                x1: iconX - halfSize * 0.2, y1: iconY + halfSize * 0.8,
                x2: iconX + halfSize * 0.8, y2: iconY - halfSize * 0.8,
                stroke: this.color,
                lineWidth: 1.2 * this.scale,
                alpha: this.alpha,
                lineCap: 'round'
            });
        }
    }
}
