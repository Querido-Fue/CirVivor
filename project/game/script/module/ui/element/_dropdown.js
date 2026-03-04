import { BaseUIElement } from "./_base_element.js";
import { animate, remove } from "animation/animation_system.js";
import { render, shadowOn, shadowOff, measureText, getBehindCanvases, getCanvas } from "display/display_system.js";
import { getMouseInput, getMouseFocus } from "input/input_system.js";
import { ColorSchemes } from "display/_theme_handler.js";
import { colorUtil } from "util/color_util.js";
import { getSetting } from "save/save_system.js";

/**
 * @class DropdownElement
 * @description Single-select dropdown with expandable option list.
 */
export class DropdownElement extends BaseUIElement {
    static openedElementId = null;
    static inputBlocker = null;

    constructor(properties) {
        super(properties);
    }

    _resolveSourceCanvases() {
        let backCanvases = [];
        let sameLayerCanvas = null;

        try {
            backCanvases = getBehindCanvases(this.layer) || [];
        } catch (_e) {
            backCanvases = [];
        }

        try {
            sameLayerCanvas = getCanvas(this.layer);
        } catch (_e) {
            sameLayerCanvas = null;
        }

        this.sourceCanvases = sameLayerCanvas ? [...backCanvases, sameLayerCanvas] : backCanvases;
    }

    static isPointerBlockedFor(px, py, layer, requesterId) {
        const blocker = DropdownElement.inputBlocker;
        if (!blocker) return false;
        if (blocker.ownerId === requesterId) return false;
        if (blocker.layer && layer && blocker.layer !== layer) return false;
        return px >= blocker.x && px <= blocker.x + blocker.w
            && py >= blocker.y && py <= blocker.y + blocker.h;
    }

    _syncInputBlocker(mainRect, panelRect) {
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
        this.sourceCanvases = [];

        this.width = properties.width || 200;
        this.height = properties.height || 36;
        this.radius = properties.radius !== undefined ? properties.radius : 8;

        this.optionHeight = properties.optionHeight || (this.height * 1.4);
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

        this.font = properties.font || `600 ${this.height * 0.5}px "Pretendard Variable", arial`;

        this.hoverScaleMultiplier = 1.03;
        this.pressScaleMultiplier = 1.03;

        this._value = null;
        this.selectedIndex = -1;
        this.isOpen = false;
        this.openProgress = 0;
        this.hoveredOptionIndex = -1;
        this._openAnimId = -1;

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
        if (this._openAnimId !== -1) {
            remove(this._openAnimId);
            this._openAnimId = -1;
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
        this._value = null;
    }

    get value() {
        return this._value;
    }

    set value(val) {
        const foundIndex = this.items.findIndex(item => item.value === val);
        if (foundIndex !== -1) {
            this._value = val;
            this.selectedIndex = foundIndex;
            return;
        }

        if (this.items.length > 0) {
            this._value = this.items[0].value;
            this.selectedIndex = 0;
        } else {
            this._value = null;
            this.selectedIndex = -1;
        }
    }

    _setOpen(open) {
        if (this.isOpen === open) return;

        this.isOpen = open;
        if (open) {
            DropdownElement.openedElementId = this.id;
        } else if (DropdownElement.openedElementId === this.id) {
            DropdownElement.openedElementId = null;
        }

        if (this._openAnimId !== -1) {
            remove(this._openAnimId);
            this._openAnimId = -1;
        }
        this._openAnimId = animate(this, {
            variable: "openProgress",
            startValue: "current",
            endValue: open ? 1 : 0,
            type: "easeOutExpo",
            duration: 0.2
        }).id;
    }

    _getMainRect() {
        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;
        const w = this.width * this.scale;
        const h = this.height * this.scale;
        const inset = w * 0.01;
        return { x: (cx - w / 2) + inset, y: cy - h / 2, w: w * 0.98, h };
    }

    _getVisibleItemCount() {
        return this.items.length;
    }

    _getPanelRect(mainRect) {
        const optionH = this.optionHeight * this.scale;
        const totalH = optionH * this._getVisibleItemCount();
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

    _isPointInsideRect(px, py, rect) {
        return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
    }

    _getOptionIndexByPointer(mouseX, mouseY, panelRect) {
        if (panelRect.h <= 0 || panelRect.optionH <= 0) return -1;
        if (!this._isPointInsideRect(mouseX, mouseY, panelRect)) return -1;

        const idx = Math.floor((mouseY - panelRect.y) / panelRect.optionH);
        if (idx < 0 || idx >= this.items.length) return -1;
        return idx;
    }

    _fitText(text, maxWidth) {
        const raw = `${text ?? ""}`;
        if (maxWidth <= 0 || raw.length === 0) return "";
        if (measureText(raw, this.font) <= maxWidth) return raw;

        let end = raw.length;
        while (end > 0) {
            const trimmed = `${raw.slice(0, end)}...`;
            if (measureText(trimmed, this.font) <= maxWidth) return trimmed;
            end--;
        }
        return "...";
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

        if (!getMouseFocus().includes(this.layer)) {
            if (this.isOpen) this._setOpen(false);
            if (DropdownElement.inputBlocker?.ownerId === this.id) {
                DropdownElement.inputBlocker = null;
            }
            return;
        }

        if (DropdownElement.openedElementId !== null && DropdownElement.openedElementId !== this.id && this.isOpen) {
            this._setOpen(false);
        }

        const mx = getMouseInput("x");
        const my = getMouseInput("y");

        const mainRect = this._getMainRect();
        const panelRect = this._getPanelRect(mainRect);
        this._syncInputBlocker(mainRect, panelRect);

        const isOverMain = this._isPointInsideRect(mx, my, mainRect);
        const openAreaRect = {
            x: Math.min(mainRect.x, panelRect.x),
            y: Math.min(mainRect.y, panelRect.y),
            w: Math.max(mainRect.x + mainRect.w, panelRect.x + panelRect.w) - Math.min(mainRect.x, panelRect.x),
            h: Math.max(mainRect.y + mainRect.h, panelRect.y + panelRect.h) - Math.min(mainRect.y, panelRect.y)
        };
        const isOverOpenArea = (this.isOpen || this.openProgress > 0.01) && this._isPointInsideRect(mx, my, openAreaRect);
        this.hoveredOptionIndex = this.openProgress > 0.1 ? this._getOptionIndexByPointer(mx, my, panelRect) : -1;

        const isLeftClicking = getMouseInput("leftClicking");
        this._handleInteractionState(isOverMain || isOverOpenArea, isLeftClicking && isOverMain);

        if (!getMouseInput("leftClicked")) return;

        if (isOverMain) {
            if (DropdownElement.openedElementId !== null && DropdownElement.openedElementId !== this.id) {
                DropdownElement.openedElementId = null;
            }
            this._setOpen(!this.isOpen);
            return;
        }

        if (!this.isOpen) return;

        if (this.hoveredOptionIndex !== -1) {
            const selected = this.items[this.hoveredOptionIndex];
            if (selected) {
                const changed = this._value !== selected.value;
                this.value = selected.value;
                if (changed) this.onChange(this._value);
            }
        }
        this._setOpen(false);
    }

    /**
         * @override
         * 메인(선택된 상태) 표시부를 그립니다.
         */
    draw() {
        if (!this.visible) return;

        const mainRect = this._getMainRect();
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

        render(this.layer, {
            shape: "text",
            text: this._fitText(selectedLabel, textMaxW),
            x: mainRect.x + basePad,
            y: mainRect.y + (mainRect.h / 2),
            font: this.font,
            fill: this.selectedIndex >= 0 ? this.textActiveColor : this.textColor,
            align: "left",
            baseline: "middle",
            alpha: this.alpha
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

        if (!this.sourceCanvases || this.sourceCanvases.length === 0) {
            this._resolveSourceCanvases();
        }

        const mainRect = this._getMainRect();
        const panelRect = this._getPanelRect(mainRect);

        const panelRadius = Math.max(2, (this.radius - 1) * this.scale);
        const panelAlpha = this.alpha * this.openProgress;
        const disableTransparency = getSetting("disableTransparency");
        const panelFill = disableTransparency
            ? (ColorSchemes.Overlay.Panel.Background || this.panelColor)
            : this.panelColor;
        const panelStroke = disableTransparency
            ? (ColorSchemes.Overlay.Panel.Border || this.panelBorderColor)
            : this.panelBorderColor;

        shadowOn(this.layer, 6 * this.scale, ColorSchemes.Overlay.Panel.Shadow || "rgba(0, 0, 0, 0.25)");
        render(this.layer, {
            shape: disableTransparency ? "roundRect" : "glassRect",
            x: panelRect.x,
            y: panelRect.y,
            w: panelRect.w,
            h: panelRect.h,
            radius: panelRadius,
            image: this.sourceCanvases,
            blur: 8,
            fill: panelFill,
            stroke: panelStroke,
            lineWidth: 1,
            alpha: panelAlpha
        });
        shadowOff(this.layer);

        const textPad = panelRect.optionH * 0.3;
        for (let i = 0; i < this.items.length; i++) {
            const rowY = panelRect.y + (panelRect.optionH * i);
            const rowBottom = rowY + panelRect.optionH;
            if (rowBottom > panelRect.y + panelRect.h + 0.1) break;

            const isHovered = i === this.hoveredOptionIndex;
            const isSelected = i === this.selectedIndex;

            if (isHovered) {
                render(this.layer, {
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
                render(this.layer, {
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
                render(this.layer, {
                    shape: "circle",
                    x: panelRect.x + panelRect.w - (textPad * 1.2),
                    y: rowY + (panelRect.optionH / 2),
                    radius: markerRadius,
                    fill: this.textActiveColor,
                    alpha: panelAlpha
                });
            }

            const optionTextWidth = panelRect.w - (textPad * 3.2);
            render(this.layer, {
                shape: "text",
                text: this._fitText(this.items[i].label, optionTextWidth),
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
