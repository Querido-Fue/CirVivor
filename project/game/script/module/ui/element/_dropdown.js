import { BaseUIElement } from "./_base_element.js";
import { ANIMATION_CATEGORY, animate, remove } from "animation/animation_system.js";
import { render, shadowOn, shadowOff, measureText } from "display/display_system.js";
import { consumeMouseState, getMouseInput, getMouseFocus, hasMouseState, isMousePressing } from "input/input_system.js";
import { ColorSchemes } from "display/_theme_handler.js";
import { colorUtil } from "util/color_util.js";
import { createFontString, truncateTextToWidth } from "util/font_util.js";
import { OVERLAY_RENDER_CONSTANTS } from "display/webgl/_webgl_constants.js";

/**
 * @class DropdownElement
 * @description Single-select dropdown with expandable option list.
 */
export class DropdownElement extends BaseUIElement {
    #value;
    #openAnimId;
    #selectionAnimId;
    static openedElementId = null;
    static inputBlocker = null;

    constructor(properties) {
        super(properties);
        this.init(properties);
    }

    /**
     * 현재 드랍다운이 점유한 화면 영역 위에 포인터가 있는지 검사합니다.
     * 레이어와 관계없이 동일 좌표의 하위 UI 상호작용을 막습니다.
     * @param {number} px - 검사할 포인터 X 좌표입니다.
     * @param {number} py - 검사할 포인터 Y 좌표입니다.
     * @param {string} layer - 호출 측 레이어입니다.
     * @param {string} requesterId - 차단 검사 요청 요소 ID입니다.
     * @returns {boolean} 다른 드랍다운이 해당 좌표를 점유 중이면 true입니다.
     */
    static isPointerBlockedFor(px, py, layer, requesterId) {
        void layer;
        const blocker = DropdownElement.inputBlocker;
        if (!blocker) return false;
        if (blocker.ownerId === requesterId) return false;
        return px >= blocker.x && px <= blocker.x + blocker.w
            && py >= blocker.y && py <= blocker.y + blocker.h;
    }

    #syncInputBlocker(mainRect, panelRect) {
        const shouldBlock = this.isOpen || this.openProgress > 0.01;
        if (!shouldBlock) {
            if (DropdownElement.inputBlocker?.ownerId === this.id) {
                DropdownElement.inputBlocker = null;
            }
            return;
        }

        const minX = Math.min(mainRect.x, panelRect.x);
        const maxX = Math.max(mainRect.x + mainRect.w, panelRect.x + panelRect.w);
        const minY = Math.min(mainRect.y, panelRect.y);
        const maxY = Math.max(mainRect.y + mainRect.h, panelRect.y + panelRect.h);

        DropdownElement.inputBlocker = {
            ownerId: this.id,
            layer: this.layer,
            x: minX,
            y: minY,
            w: maxX - minX,
            h: maxY - minY
        };
    }

    /**
         * @override
         */
    init(properties) {
        super.init(properties);
        if (!properties) return;

        this.items = Array.isArray(properties.items) ? properties.items : [];
        this.onChange = properties.onChange || (() => { });

        this.width = properties.width || 200;
        this.height = properties.height || 36;
        this.radius = properties.radius !== undefined ? properties.radius : 8;

        this.optionHeight = properties.optionHeight || (this.height * 1.2);
        this.optionGap = properties.optionGap !== undefined ? properties.optionGap : this.height * 0.12;
        this.openDirection = properties.openDirection === "up" ? "up" : "down";

        this.backgroundColor = properties.backgroundColor || ColorSchemes.Overlay.Segment.Background;
        this.hoverColor = properties.hoverColor || ColorSchemes.Overlay.Control.Hover;
        this.panelColor = properties.panelColor || ColorSchemes.Overlay.Panel.GlassBackground || ColorSchemes.Overlay.Panel.Background;
        this.panelBorderColor = properties.panelBorderColor || ColorSchemes.Overlay.Panel.Divider;
        this.itemHoverColor = properties.itemHoverColor || ColorSchemes.Overlay.Control.Hover;
        this.textColor = properties.textColor || ColorSchemes.Overlay.Segment.TextInactive;
        this.textActiveColor = properties.textActiveColor || ColorSchemes.Overlay.Segment.TextActive;
        this.iconColor = properties.iconColor || ColorSchemes.Overlay.Text.Control || this.textColor;

        this.font = properties.font || createFontString({
            weight: 600,
            sizePx: this.height * 0.5
        });

        this.hoverScaleMultiplier = 1.0;
        this.pressScaleMultiplier = 1.0;

        this.#value = null;
        this.selectedIndex = -1;
        this.isOpen = false;
        this.openProgress = 0;
        this.hoveredOptionIndex = -1;
        this.#openAnimId = -1;
        this.#selectionAnimId = -1;
        this.previousSelectionLabel = null;
        this.selectionProgress = 1;

        if (properties.value !== undefined) {
            this.value = properties.value;
        } else if (this.items.length > 0) {
            this.value = this.items[0].value;
        }
    }

    /**
         * @override
         */
    reset() {
        super.reset();
        if (this.#openAnimId !== -1) {
            remove(this.#openAnimId);
            this.#openAnimId = -1;
        }
        if (this.#selectionAnimId !== -1) {
            remove(this.#selectionAnimId);
            this.#selectionAnimId = -1;
        }

        if (DropdownElement.openedElementId === this.id) {
            DropdownElement.openedElementId = null;
        }
        if (DropdownElement.inputBlocker?.ownerId === this.id) {
            DropdownElement.inputBlocker = null;
        }

        this.items = [];
        this.onChange = () => { };
        this.isOpen = false;
        this.openProgress = 0;
        this.hoveredOptionIndex = -1;
        this.selectedIndex = -1;
        this.#value = null;
        this.previousSelectionLabel = null;
        this.selectionProgress = 1;
    }

    /**
     * 새 레이아웃의 배치·테마 스타일과 항목만 받아 열림·선택 애니메이션을 유지합니다.
     * @param {DropdownElement|null|undefined} source - 새 레이아웃이 만든 드롭다운입니다.
     * @returns {DropdownElement} 현재 드롭다운입니다.
     */
    reconcileLayoutFrom(source) {
        if (!source || source === this) {
            return this;
        }

        const layoutFields = [
            'parent', 'layer', 'x', 'y', 'width', 'height', 'radius',
            'optionHeight', 'optionGap', 'openDirection', 'backgroundColor',
            'hoverColor', 'panelColor', 'panelBorderColor', 'itemHoverColor',
            'textColor', 'textActiveColor', 'iconColor', 'font', 'onChange',
            'alpha', 'shadow', 'visible', 'clickAble', 'tooltip',
            'hoverScaleMultiplier', 'pressScaleMultiplier', 'renderOrder'
        ];
        for (const field of layoutFields) {
            this[field] = source[field];
        }

        this.items = source.items;
        const selectedIndex = this.items.findIndex((item) => item.value === this.#value);
        if (selectedIndex >= 0) {
            this.selectedIndex = selectedIndex;
        }
        return this;
    }

    get value() {
        return this.#value;
    }

    set value(val) {
        if (this.#selectionAnimId !== -1) {
            remove(this.#selectionAnimId);
            this.#selectionAnimId = -1;
        }
        this.previousSelectionLabel = null;
        this.selectionProgress = 1;
        this.#applyValue(val);
    }

    /**
     * 선택 라벨을 지정 값으로 교차 감쇠합니다.
     * @param {string|number|boolean} value - 새 선택 값입니다.
     * @param {{duration?:number, easing?:string}} [options={}] - 교차 감쇠 옵션입니다.
     * @returns {Promise<void>} 선택 전환이 끝나면 이행됩니다.
     */
    animateToValue(value, options = {}) {
        const previousLabel = this.selectedIndex >= 0
            ? (this.items[this.selectedIndex]?.label ?? '')
            : '';
        const previousValue = this.#value;

        if (this.#selectionAnimId !== -1) {
            remove(this.#selectionAnimId);
            this.#selectionAnimId = -1;
        }
        this.#applyValue(value);
        const selectedLabel = this.selectedIndex >= 0
            ? (this.items[this.selectedIndex]?.label ?? '')
            : '';
        if (Object.is(previousValue, this.#value) || previousLabel === selectedLabel) {
            this.previousSelectionLabel = null;
            this.selectionProgress = 1;
            return Promise.resolve();
        }

        this.previousSelectionLabel = previousLabel;
        this.selectionProgress = 0;
        const duration = Number.isFinite(options.duration) && options.duration >= 0
            ? options.duration
            : 0.2;
        const easing = typeof options.easing === 'string' && options.easing.length > 0
            ? options.easing
            : 'easeOutExpo';
        const animation = animate(this, {
            animationCategory: ANIMATION_CATEGORY.UI,
            variable: 'selectionProgress',
            startValue: 0,
            endValue: 1,
            duration,
            type: easing
        });
        this.#selectionAnimId = animation.id;
        return animation.promise.then(() => {
            if (this.#selectionAnimId !== animation.id) {
                return;
            }
            this.#selectionAnimId = -1;
            this.previousSelectionLabel = null;
            this.selectionProgress = 1;
        });
    }

    /**
     * 항목 목록 규칙에 따라 내부 선택값과 index를 갱신합니다.
     * @param {string|number|boolean} val - 적용할 값입니다.
     * @returns {void}
     * @private
     */
    #applyValue(val) {
        const foundIndex = this.items.findIndex(item => item.value === val);
        if (foundIndex !== -1) {
            this.#value = val;
            this.selectedIndex = foundIndex;
            return;
        }

        if (this.items.length > 0) {
            this.#value = this.items[0].value;
            this.selectedIndex = 0;
        } else {
            this.#value = null;
            this.selectedIndex = -1;
        }
    }

    #setOpen(open) {
        if (this.isOpen === open) return;

        this.isOpen = open;
        if (open) {
            DropdownElement.openedElementId = this.id;
        } else if (DropdownElement.openedElementId === this.id) {
            DropdownElement.openedElementId = null;
        }

        if (this.#openAnimId !== -1) {
            remove(this.#openAnimId);
            this.#openAnimId = -1;
        }
        this.#openAnimId = animate(this, {
            animationCategory: ANIMATION_CATEGORY.UI,
            variable: "openProgress",
            startValue: "current",
            endValue: open ? 1 : 0,
            type: "easeOutExpo",
            duration: 0.2
        }).id;
    }

    #getMainRect() {
        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;
        const w = this.width * this.scale;
        const h = this.height * this.scale;
        const inset = w * 0.01;
        return { x: (cx - w / 2) + inset, y: cy - h / 2, w: w * 0.98, h };
    }

    #getVisibleItemCount() {
        return this.items.length;
    }

    #getPanelRect(mainRect) {
        const optionH = this.optionHeight * this.scale;
        const totalH = optionH * this.#getVisibleItemCount();
        const visibleH = totalH * this.openProgress;

        let y = mainRect.y + mainRect.h + (this.optionGap * this.scale);
        if (this.openDirection === "up") {
            y = mainRect.y - (this.optionGap * this.scale) - visibleH;
        }

        return {
            x: mainRect.x,
            y,
            w: mainRect.w,
            h: visibleH,
            optionH
        };
    }

    #isPointInsideRect(px, py, rect) {
        return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
    }

    #getOptionIndexByPointer(mouseX, mouseY, panelRect) {
        if (panelRect.h <= 0 || panelRect.optionH <= 0) return -1;
        if (!this.#isPointInsideRect(mouseX, mouseY, panelRect)) return -1;

        const idx = Math.floor((mouseY - panelRect.y) / panelRect.optionH);
        if (idx < 0 || idx >= this.items.length) return -1;
        return idx;
    }

    /**
     * 표시 가능한 폭에 맞춰 라벨을 말줄임 처리합니다.
     * @param {string} text - 원본 라벨입니다.
     * @param {number} maxWidth - 표시 가능한 최대 폭입니다.
     * @returns {string} 말줄임 처리된 라벨입니다.
     */
    #fitText(text, maxWidth) {
        return truncateTextToWidth(text, {
            maxWidth,
            measureWidth: (label) => measureText(label, this.font)
        });
    }

    /**
         * @override
         * 클릭 동작이나 드롭다운 패널 토글 시의 상호작용 상태를 갱신합니다.
         */
    update() {
        if (!this.visible) {
            if (DropdownElement.inputBlocker?.ownerId === this.id) {
                DropdownElement.inputBlocker = null;
            }
            return;
        }

        if (this.clickAble === false || !getMouseFocus().includes(this.layer)) {
            if (this.isOpen) this.#setOpen(false);
            if (DropdownElement.inputBlocker?.ownerId === this.id) {
                DropdownElement.inputBlocker = null;
            }
            return;
        }

        if (DropdownElement.openedElementId !== null && DropdownElement.openedElementId !== this.id && this.isOpen) {
            this.#setOpen(false);
        }

        const mx = getMouseInput("x");
        const my = getMouseInput("y");

        const mainRect = this.#getMainRect();
        const panelRect = this.#getPanelRect(mainRect);
        this.#syncInputBlocker(mainRect, panelRect);

        const isOverMain = this.#isPointInsideRect(mx, my, mainRect);
        const openAreaRect = {
            x: Math.min(mainRect.x, panelRect.x),
            y: Math.min(mainRect.y, panelRect.y),
            w: Math.max(mainRect.x + mainRect.w, panelRect.x + panelRect.w) - Math.min(mainRect.x, panelRect.x),
            h: Math.max(mainRect.y + mainRect.h, panelRect.y + panelRect.h) - Math.min(mainRect.y, panelRect.y)
        };
        const isOverOpenArea = (this.isOpen || this.openProgress > 0.01) && this.#isPointInsideRect(mx, my, openAreaRect);
        this.hoveredOptionIndex = this.openProgress > 0.1 ? this.#getOptionIndexByPointer(mx, my, panelRect) : -1;

        const isLeftPressing = isMousePressing('left');
        this._handleInteractionState(isOverMain || isOverOpenArea, isLeftPressing && isOverMain);

        if (!hasMouseState('left', 'clicked')) return;

        if (isOverMain) {
            consumeMouseState('left', 'clicked');
            if (DropdownElement.openedElementId !== null && DropdownElement.openedElementId !== this.id) {
                DropdownElement.openedElementId = null;
            }
            this.#setOpen(!this.isOpen);
            return;
        }

        if (!this.isOpen) return;

        if (isOverOpenArea) {
            consumeMouseState('left', 'clicked');
        }

        if (this.hoveredOptionIndex !== -1) {
            const selected = this.items[this.hoveredOptionIndex];
            if (selected) {
                const changed = this.#value !== selected.value;
                if (changed) {
                    void this.animateToValue(selected.value);
                    this.onChange(this.#value);
                }
            }
        }
        this.#setOpen(false);
    }

    /**
         * @override
         * 메인(선택된 상태) 표시부를 그립니다.
         */
    draw() {
        if (!this.visible) return;

        const mainRect = this.#getMainRect();
        const basePad = mainRect.h * 0.3;
        const textMaxW = Math.max(0, mainRect.w - basePad * 2.4);

        const bg = colorUtil().lerpColor(this.backgroundColor, this.hoverColor, this.hoverValue);

        render(this.layer, {
            shape: "roundRect",
            x: mainRect.x,
            y: mainRect.y,
            w: mainRect.w,
            h: mainRect.h,
            radius: this.radius * this.scale,
            fill: bg,
            alpha: this.alpha
        });

        const selectedLabel = this.selectedIndex >= 0
            ? (this.items[this.selectedIndex]?.label ?? "")
            : "";

        if (this.previousSelectionLabel !== null && this.selectionProgress < 1) {
            render(this.layer, {
                shape: "text",
                text: this.#fitText(this.previousSelectionLabel, textMaxW),
                x: mainRect.x + basePad,
                y: mainRect.y + (mainRect.h / 2),
                font: this.font,
                fill: this.textActiveColor,
                align: "left",
                baseline: "middle",
                alpha: this.alpha * (1 - this.selectionProgress)
            });
        }

        render(this.layer, {
            shape: "text",
            text: this.#fitText(selectedLabel, textMaxW),
            x: mainRect.x + basePad,
            y: mainRect.y + (mainRect.h / 2),
            font: this.font,
            fill: this.selectedIndex >= 0 ? this.textActiveColor : this.textColor,
            align: "left",
            baseline: "middle",
            alpha: this.alpha * (this.previousSelectionLabel !== null ? this.selectionProgress : 1)
        });

        const iconHalfHeight = mainRect.h * 0.12;
        const iconHalfWidth = mainRect.h * 0.207;
        const iconCX = mainRect.x + mainRect.w - basePad - iconHalfWidth;
        const iconCY = mainRect.y + (mainRect.h / 2);
        const p = this.openProgress;

        const leftYClosed = iconCY - iconHalfHeight;
        const centerYClosed = iconCY + iconHalfHeight;
        const rightYClosed = iconCY - iconHalfHeight;

        const leftYOpen = iconCY + iconHalfHeight;
        const centerYOpen = iconCY - iconHalfHeight;
        const rightYOpen = iconCY + iconHalfHeight;

        const leftY = leftYClosed + ((leftYOpen - leftYClosed) * p);
        const centerY = centerYClosed + ((centerYOpen - centerYClosed) * p);
        const rightY = rightYClosed + ((rightYOpen - rightYClosed) * p);

        render(this.layer, {
            shape: "line",
            x1: iconCX - iconHalfWidth,
            y1: leftY,
            x2: iconCX,
            y2: centerY,
            stroke: this.iconColor,
            lineWidth: Math.max(1, this.scale * 1.1),
            lineCap: "round",
            alpha: this.alpha
        });
        render(this.layer, {
            shape: "line",
            x1: iconCX,
            y1: centerY,
            x2: iconCX + iconHalfWidth,
            y2: rightY,
            stroke: this.iconColor,
            lineWidth: Math.max(1, this.scale * 1.1),
            lineCap: "round",
            alpha: this.alpha
        });
    }

    /**
         * 패널이 열렸을 때 상단(또는 하단)으로 부양되는 옵션 목록을 캔버스 최상단에 그립니다.
         */
    drawFloating() {
        if (!this.visible) return;
        if (this.openProgress <= 0.01 || this.items.length === 0) return;

        const mainRect = this.#getMainRect();
        const panelRect = this.#getPanelRect(mainRect);

        const panelRadius = Math.max(2, (this.radius - 1) * this.scale);
        const panelAlpha = this.alpha * this.openProgress;
        const overlaySession = this.parent?.session || null;
        const glassAlpha = typeof overlaySession?.getGlassPanelAlpha === 'function'
            ? overlaySession.getGlassPanelAlpha()
            : (overlaySession?.effectiveTransparent === true ? 1 : 0);
        const opaqueAlpha = typeof overlaySession?.getOpaquePanelAlpha === 'function'
            ? overlaySession.getOpaquePanelAlpha()
            : 1 - glassAlpha;
        const shadowColor = ColorSchemes.Overlay.Panel.Shadow || "rgba(0, 0, 0, 0.25)";
        let glassRendered = false;
        if (glassAlpha > 0 && typeof overlaySession?.renderFloatingGlassPanel === 'function') {
            glassRendered = overlaySession.renderFloatingGlassPanel({
                x: panelRect.x,
                y: panelRect.y,
                w: panelRect.w,
                h: panelRect.h,
                radius: panelRadius,
                blur: OVERLAY_RENDER_CONSTANTS.FLOATING_DROPDOWN_BLUR_RADIUS,
                fill: this.panelColor,
                stroke: ColorSchemes.Overlay.Panel.GlassBorder || this.panelBorderColor,
                lineWidth: 1,
                tintColor: ColorSchemes.Overlay.Panel.GlassTint,
                edgeColor: ColorSchemes.Overlay.Panel.GlassEdge,
                tintStrength: ColorSchemes.Overlay.Panel.GlassTintStrength,
                edgeStrength: ColorSchemes.Overlay.Panel.GlassEdgeStrength,
                shadowRadius: 6 * this.scale,
                shadowColor,
                alpha: panelAlpha * glassAlpha
            });
        }

        const floatingLayer = glassRendered
            ? (overlaySession.getFloatingUILayerId() || this.layer)
            : (overlaySession?.uiLayerId || this.layer);
        const flatMix = glassRendered ? opaqueAlpha : 1;
        if (flatMix > 0) {
            shadowOn(floatingLayer, 6 * this.scale, shadowColor);
            render(floatingLayer, {
                shape: "roundRect",
                x: panelRect.x,
                y: panelRect.y,
                w: panelRect.w,
                h: panelRect.h,
                radius: panelRadius,
                fill: ColorSchemes.Overlay.Panel.Background || this.panelColor,
                stroke: ColorSchemes.Overlay.Panel.Border || this.panelBorderColor,
                lineWidth: 1,
                alpha: panelAlpha * flatMix
            });
            shadowOff(floatingLayer);
        }

        const textPad = panelRect.optionH * 0.3;
        for (let i = 0; i < this.items.length; i++) {
            const rowY = panelRect.y + (panelRect.optionH * i);
            const rowBottom = rowY + panelRect.optionH;
            if (rowBottom > panelRect.y + panelRect.h + 0.1) break;

            const isHovered = i === this.hoveredOptionIndex;
            const isSelected = i === this.selectedIndex;

            if (isHovered) {
                render(floatingLayer, {
                    shape: "roundRect",
                    x: panelRect.x + (this.scale * 2),
                    y: rowY + (this.scale * 1),
                    w: panelRect.w - (this.scale * 4),
                    h: panelRect.optionH - (this.scale * 2),
                    radius: Math.max(2, panelRadius * 0.8),
                    fill: this.itemHoverColor,
                    alpha: panelAlpha
                });
            }

            if (i > 0) {
                render(floatingLayer, {
                    shape: "line",
                    x1: panelRect.x + textPad,
                    y1: rowY,
                    x2: panelRect.x + panelRect.w - textPad,
                    y2: rowY,
                    stroke: this.panelBorderColor,
                    lineWidth: 1,
                    alpha: panelAlpha * 0.6
                });
            }

            const markerRadius = panelRect.optionH * 0.08;
            if (isSelected) {
                render(floatingLayer, {
                    shape: "circle",
                    x: panelRect.x + panelRect.w - (textPad * 1.2),
                    y: rowY + (panelRect.optionH / 2),
                    radius: markerRadius,
                    fill: this.textActiveColor,
                    alpha: panelAlpha
                });
            }

            const optionTextWidth = panelRect.w - (textPad * 3.2);
            render(floatingLayer, {
                shape: "text",
                text: this.#fitText(this.items[i].label, optionTextWidth),
                x: panelRect.x + textPad,
                y: rowY + (panelRect.optionH / 2),
                font: this.font,
                fill: isSelected ? this.textActiveColor : this.textColor,
                align: "left",
                baseline: "middle",
                alpha: panelAlpha
            });
        }
    }
}
