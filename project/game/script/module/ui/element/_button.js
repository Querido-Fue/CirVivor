import { BaseUIElement } from "./_base_element.js";
import { render } from "display/display_system.js";
import { getMouseInput, getMouseFocus } from "input/input_system.js";
import { colorUtil } from "util/color_util.js";
import { ColorSchemes } from "display/_theme_handler.js";
import { shadowOn, shadowOff, measureText } from "display/display_system.js";
import { DropdownElement } from "./_dropdown.js";

/**
 * @class ButtonElement
 * @description 상호작용 가능한 UI 버튼 요소입니다. 내부 요소(TextElement, Icon 등)를 left, center, right 영역에 배치할 수 있습니다.
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
 * @param {Array<object>} [properties.left=[]] - 왼쪽 영역 UI 요소들
 * @param {Array<object>} [properties.center=[]] - 중앙 영역 UI 요소들
 * @param {Array<object>} [properties.right=[]] - 오른쪽 영역 UI 요소들
 * @param {number} [properties.alpha=1] - 투명도
 * @param {number} [properties.margin=0] - 마진 (내부 요소와 테두리 사이의 간격)
 * @param {number} [properties.itemSpacing=0] - 내부 요소 간의 간격
 * @param {boolean} [properties.clickAble=true] - 클릭 가능 여부
 */
export class ButtonElement extends BaseUIElement {
    constructor(properties) {
        super(properties);
    }

    init(properties) {
        super.init(properties);
        if (!properties) return;
        this.onClick = properties.onClick || (() => { });
        this.onHover = properties.onHover || (() => { });

        this.left = properties.left || [];
        this.center = properties.center || [];
        this.right = properties.right || [];

        this.margin = properties.margin || 0;
        this.itemSpacing = properties.itemSpacing || 5; // 아이템 간 기본 간격

        this.width = properties.width || 100;
        this.height = properties.height || 30;

        this.idleColor = properties.idleColor || ColorSchemes.Overlay.Control.Inactive;
        this.hoverColor = properties.hoverColor || ColorSchemes.Overlay.Control.Hover;

        if (properties.color) this.color = properties.color;

        this.radius = properties.radius !== undefined ? properties.radius : 5;
    }

    reset() {
        super.reset();
        this.left = [];
        this.center = [];
        this.right = [];
        this.onClick = () => { };
        this.onHover = () => { };
    }

    update() {
        if (!this.visible) return;

        if (!getMouseFocus().includes(this.layer)) {
            return;
        }

        const mx = getMouseInput("x");
        const my = getMouseInput("y");
        if (DropdownElement.isPointerBlockedFor(mx, my, this.layer, this.id)) {
            this._handleInteractionState(false, false);
            return;
        }

        let isHovered = false;
        if (mx >= this.x && mx <= this.x + this.width && my >= this.y && my <= this.y + this.height && this.clickAble) {
            isHovered = true;
        }

        const isLeftClicking = getMouseInput("leftClicking");

        // 부모의 공통 호버, 클릭 스케일 애니메이션 처리
        this._handleInteractionState(isHovered, isLeftClicking, this.onHover);

        if (isHovered && getMouseInput("leftClicked")) {
            this.onClick();
        }


        // 자식 요소들 업데이트 (update 메서드가 존재하는 경우)
        [...this.left, ...this.center, ...this.right].forEach(item => {
            if (item && typeof item.update === 'function') {
                item.update();
            }
        });
    }

    draw() {
        if (!this.visible) return;

        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;
        const scaledW = this.width * this.scale;
        const scaledH = this.height * this.scale;

        const scaledX = cx - scaledW / 2;
        const scaledY = cy - scaledH / 2;

        if (this.shadow) {
            shadowOn(this.layer, this.shadow.blur, this.shadow.color);
        }

        const bounds = { x: scaledX, y: scaledY, w: scaledW, h: scaledH };
        this.currentColor = colorUtil().lerpColor(this.idleColor, this.hoverColor, this.hoverValue, bounds);

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


        // 자식 요소들의 스케일 적용된 간격
        const scaledSpacing = this.itemSpacing * this.scale;
        const scaledMargin = this.margin * this.scale;

        // --- 왼쪽 요소 렌더링 ---
        let currentLeftX = scaledX + scaledMargin;
        for (const item of this.left) {
            if (!item) continue;
            const w = this._getItemWidth(item, scaledH);
            this._drawItem(item, currentLeftX, scaledY, scaledH, 'left', w);
            currentLeftX += w + scaledSpacing;
        }

        // --- 오른쪽 요소 렌더링 ---
        let currentRightX = scaledX + scaledW - scaledMargin;
        for (let i = this.right.length - 1; i >= 0; i--) {
            const item = this.right[i];
            if (!item) continue;
            const w = this._getItemWidth(item, scaledH);
            currentRightX -= w;
            this._drawItem(item, currentRightX, scaledY, scaledH, 'right', w);
            currentRightX -= scaledSpacing;
        }

        // --- 중앙 요소 렌더링 ---
        // 중앙 요소들의 전체 너비 계산
        let totalCenterWidth = 0;
        const centerItemsWidths = [];
        for (const item of this.center) {
            if (item) {
                const w = this._getItemWidth(item, scaledH);
                centerItemsWidths.push(w);
                totalCenterWidth += w;
            } else {
                centerItemsWidths.push(0);
            }
        }
        if (this.center.length > 1) {
            totalCenterWidth += (this.center.length - 1) * scaledSpacing;
        }

        let currentCenterX = cx - (totalCenterWidth / 2); // 정중앙에서 전체 크기의 절반만큼 뺀 곳에서 시작
        for (let i = 0; i < this.center.length; i++) {
            const item = this.center[i];
            const w = centerItemsWidths[i];
            if (item) {
                this._drawItem(item, currentCenterX, scaledY, scaledH, 'center', w);
                currentCenterX += w + scaledSpacing;
            }
        }

        if (this.shadow) {
            shadowOff(this.layer);
        }
    }

    /**
     * 아이템의 예상 너비를 반환합니다.
     */
    _getItemWidth(item, scaledButtonHeight) {
        if (item.width !== undefined && typeof item.width === 'number') {
            return item.width * this.scale;
        }
        // 텍스트 요소
        if (item.text !== undefined && item.font && typeof item.size === 'number') {
            const scaledSize = item.size * this.scale;
            let familyName = item.font;
            if (!familyName.includes('"') && !familyName.includes("'")) {
                const parts = familyName.split(',');
                familyName = `"${parts[0].trim()}"${parts[1] ? ',' + parts[1] : ''}`;
            }
            const fontString = `${item.fontWeight || ''}${scaledSize}px ${familyName}`;

            // 드로우 핸들러의 measureText를 사용해 텍스트 너비 측정
            return measureText(item.text, fontString);
        }
        // 아이콘 요소
        if (item.constructor.name === 'Icon' || item.type !== undefined) {
            return scaledButtonHeight * 0.5; // 내부 패딩을 뺀 정확한 바운딩 박스를 사용하므로, 0.75면 충분히 크고 자연스러움
        }
        return 0;
    }

    /**
     * 각 항목을 그립니다.
     */
    _drawItem(item, x, y, h, slotName, itemWidth) {
        // 아이콘 요소
        if (item.constructor.name === 'Icon' || item.type !== undefined) {
            // 버튼 높이 기반 아이콘 크기 (itemWidth와 동일)
            const iconSize = itemWidth;
            // 세로 가운데 정렬
            const iconY = y + (h - iconSize) / 2;
            item.draw(this.layer, x, iconY, iconSize, iconSize, this.scale, this.alpha, item.color || this.color);
        }
        // 텍스트 요소
        else if (item.text !== undefined && item.font && typeof item.size === 'number') {
            const scaledSize = item.size * this.scale;
            let familyName = item.font;
            if (!familyName.includes('"') && !familyName.includes("'")) {
                const parts = familyName.split(',');
                familyName = `"${parts[0].trim()}"${parts[1] ? ',' + parts[1] : ''}`;
            }

            const align = item.align || slotName || 'left';
            let renderX = x;
            if (align === 'center') renderX = x + itemWidth / 2;
            else if (align === 'right') renderX = x + itemWidth;

            render(this.layer, {
                shape: 'text',
                text: item.text,
                x: renderX,
                y: y + h / 2, // 중간 기준선
                font: `${item.fontWeight || ''}${scaledSize}px ${familyName}`,
                fill: item.color || this.color,
                alpha: (item.alpha !== undefined ? item.alpha : 1) * this.alpha,
                align: align,
                baseline: 'middle'
            });
        }
        // 기타 UI 요소(draw 지원 객체)
        else if (typeof item.draw === 'function') {
            const origX = item.x;
            const origY = item.y;
            item.x = x;
            item.y = y;
            item.draw();
            item.x = origX;
            item.y = origY;
        }
    }
}

