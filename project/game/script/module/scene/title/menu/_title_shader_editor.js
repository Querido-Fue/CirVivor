import { getDebugSystem } from 'debug/debug_system.js';
import { getMouseInput, getMouseFocus } from 'input/input_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import {
    TITLE_SHADER_SETTINGS, getTitleShaderSetting, setTitleShaderSetting,
    resetTitleShaderSettings, saveTitleShaderSettings
} from 'display/_title_shader_settings.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { releaseUIItem } from 'ui/_ui_pool.js';
import { TYPOGRAPHY } from 'ui/style/typography.js';
import { BUTTON_STYLE } from 'ui/style/component_styles.js';

const COLUMNS = 2;
const VERTICAL_PADDING_WH = 1.5;

function persistShaderSettings() {
    void saveTitleShaderSettings().catch(error => console.error('셰이더 설정 저장 실패:', error));
}

/** Nonmodal title-menu content; the existing menu owns its session and focus. */
export class TitleShaderEditor {
    constructor(menu) {
        this.menu = menu;
        this.active = false;
        this.first = 0;
        this.wheelRemainder = 0;
        this.lastWheel = getMouseInput('wheelY') || 0;
        this.entries = [];
        this.rows = [];
        this.layoutKey = '';
    }

    update(paneLayout, pointerEnabled) {
        const active = getDebugSystem()?.isControlOptionActive('titleShaderSettings') === true;
        const wheel = getMouseInput('wheelY') || 0;
        const delta = wheel - this.lastWheel;
        this.lastWheel = wheel;
        if (!active) {
            if (this.active) this.release();
            this.active = false;
            return false;
        }
        const justOpened = !this.active;
        this.active = true;
        const menu = this.menu;
        this.bounds = {
            x: paneLayout.cardPane.x, y: menu.WH * .10,
            w: paneLayout.cardPane.w, h: menu.WH * .80,
            radius: menu.WH * .018
        };
        // Preserve readable labels and controls; reduce the whitespace to one third.
        const rowGap = menu.WH * .03 * menu.uiScale / 3;
        const rowHeight = menu.WW * .018 * menu.uiScale
            + menu.WH * (.011 / 3 + .022) * menu.uiScale + rowGap;
        const contentInset = menu.WH * .06 * menu.uiScale;
        const availableHeight = this.bounds.h - contentInset * 2;
        const visibleRows = Math.max(1, Math.floor((availableHeight + rowGap) / rowHeight));
        const count = visibleRows * COLUMNS;
        const maxFirst = Math.max(0, Math.ceil(TITLE_SHADER_SETTINGS.length / COLUMNS) - visibleRows) * COLUMNS;
        this.contentTop = this.bounds.y + contentInset
            + Math.max(0, availableHeight - (visibleRows * rowHeight - rowGap)) / 2;
        this.contentHeight = visibleRows * rowHeight - rowGap;
        this.maxFirst = maxFirst;
        this.visibleCount = count;
        this.first = Math.min(this.first, maxFirst);
        const mx = getMouseInput('x');
        const my = getMouseInput('y');
        const b = this.bounds;
        const inside = mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
        const canInteract = pointerEnabled && getMouseFocus().includes('ui');
        const dragging = this.rows.some(row => row.slider.dragging);
        if (!justOpened && canInteract && inside && !dragging) {
            this.wheelRemainder += delta;
            const steps = Math.trunc(this.wheelRemainder);
            if (steps !== 0) {
                this.first = Math.max(0, Math.min(maxFirst, this.first + steps * COLUMNS));
                this.wheelRemainder -= steps;
            }
        } else {
            this.wheelRemainder = 0;
        }
        const key = [b.x, b.y, b.w, b.h, menu.uiScale, this.first, count].join(':');
        if (key !== this.layoutKey) {
            this.build(count, rowHeight);
            this.layoutKey = key;
        }
        for (const entry of this.entries) {
            if (!entry.item.update) continue;
            const item = entry.item;
            // Existing controls use their layer for focus. Draw uses the menu's surface.
            item.layer = 'ui';
            item.clickAble = canInteract;
            item.update();
        }
        return true;
    }

    build(count, rowHeight) {
        const previousEntries = this.entries;
        const previousRows = new Map(this.rows.map(row => [row.setting.id, row.slider]));
        this.entries = [];
        this.rows = [];
        const menu = this.menu;
        const b = this.bounds;
        const parent = { x: b.x, y: b.y, width: b.w, height: b.h, layer: 'ui', uiScale: menu.uiScale };
        const header = new LayoutHandler(parent).paddingX('OW', 7).space('WH', VERTICAL_PADDING_WH)
            .item('text').text('셰이더 설정').textStyle(TYPOGRAPHY.H3)
            .fill(ColorSchemes.Overlay.Text.Item);
        this.append(header.build());
        const paddingX = b.w * .07;
        const columnGap = paddingX / 3;
        const columnWidth = (b.w - paddingX * 2 - columnGap) / COLUMNS;
        const end = Math.min(TITLE_SHADER_SETTINGS.length, this.first + count);
        for (let index = this.first; index < end; index++) {
            const setting = TITLE_SHADER_SETTINGS[index];
            const offset = index - this.first;
            const rowParent = { ...parent,
                x: b.x + paddingX + (offset % COLUMNS) * (columnWidth + columnGap),
                y: this.contentTop + Math.floor(offset / COLUMNS) * rowHeight,
                width: columnWidth, height: rowHeight };
            const handler = new LayoutHandler(rowParent)
                .item('text').text(setting.group)
                .textStyle(TYPOGRAPHY.SETTINGS_DESCRIPTION).fill(ColorSchemes.Overlay.Text.Item)
                .item('text').text(setting.label)
                .textStyle(TYPOGRAPHY.SETTINGS_DESCRIPTION).fill(ColorSchemes.Overlay.Text.Item)
                .space('WH', 1.1 / 3)
                .group().width('parent', 100).justifyContent('space-between')
                .item('slider', setting.id).width('parent', 77).height('WH', 2.2)
                .prop('trackHeight', menu.WH * .004 * menu.uiScale)
                .prop('knobRadius', menu.WH * .007 * menu.uiScale)
                .prop('min', setting.min).prop('max', setting.max).prop('step', setting.step)
                .prop('showValue', false).valueTextStyle(TYPOGRAPHY.SLIDER_VALUE)
                .setValue(getTitleShaderSetting(setting.id))
                .onChange(value => setTitleShaderSetting(setting.id, value))
                .onCommit(persistShaderSettings)
                .item('text', setting.id + '_value').width('parent', 20)
                .text(String(getTitleShaderSetting(setting.id))).textStyle(TYPOGRAPHY.SLIDER_VALUE)
                .textAlign('right').fill(ColorSchemes.Overlay.Text.Item)
                .vAlign('center').endGroup();
            const result = handler.build();
            const previous = previousRows.get(setting.id);
            if (previous) {
                const generated = result.components[setting.id];
                previous.reconcileLayoutFrom(generated);
                result.dynamicItems.find(entry => entry.item === generated).item = previous;
                result.components[setting.id] = previous;
                releaseUIItem(generated);
            }
            this.rows.push({ setting, slider: result.components[setting.id], value: result.components[setting.id + '_value'] });
            this.append(result);
        }
        const footer = new LayoutHandler(parent).paddingX('OW', 7)
            .bottomSpace('WH', VERTICAL_PADDING_WH).bottomGroup().width('parent', 100).justifyContent('space-between')
            .item('text').text(`${this.first + 1}–${end} / ${TITLE_SHADER_SETTINGS.length}`)
            .textStyle(TYPOGRAPHY.SETTINGS_DESCRIPTION).fill(ColorSchemes.Overlay.Text.Item).vAlign('center')
            .item('button', 'reset_shader_settings').buttonStyle(BUTTON_STYLE.OVERLAY_LINK).buttonText('전체 초기화')
            .buttonColor(ColorSchemes.Overlay.Button.Link)
            .onClick(() => {
                resetTitleShaderSettings();
                persistShaderSettings();
                for (const row of this.rows) void row.slider.animateToValue(getTitleShaderSetting(row.setting.id));
            }).endGroup();
        this.append(footer.build());
        const retained = new Set(this.entries.map(entry => entry.item));
        for (const entry of previousEntries) {
            if (!retained.has(entry.item)) releaseUIItem(entry.item);
        }
    }

    append(result) {
        this.entries.push(...result.staticItems, ...result.dynamicItems);
    }

    draw(session) {
        const b = this.bounds;
        if (!b) return;
        session.recordTitleWebGpuPanelContentBounds(b);
        session.renderPanel({ shape: 'roundRect', ...b, fill: ColorSchemes.Overlay.Panel.Background,
            stroke: ColorSchemes.Overlay.Panel.Divider, lineWidth: this.menu.WH * .0015, alpha: .96 });
        for (const row of this.rows) row.value.text = String(getTitleShaderSetting(row.setting.id));
        for (const entry of this.entries) {
            if (entry.item.draw) {
                entry.item.layer = session.uiLayerId;
                entry.item.draw();
            } else session.renderPanel(entry.item);
        }
        const trackY = this.contentTop;
        const trackH = this.contentHeight;
        const thumbH = trackH * Math.min(1, this.visibleCount / (Math.ceil(TITLE_SHADER_SETTINGS.length / COLUMNS) * COLUMNS));
        session.renderPanel({ shape: 'roundRect', x: b.x + b.w * .97,
            y: trackY + (trackH - thumbH) * this.first / Math.max(1, this.maxFirst),
            w: b.w * .006, h: thumbH, radius: b.w * .003,
            fill: ColorSchemes.Overlay.Slider.ValueActive, alpha: .9 });
    }

    invalidate() { this.layoutKey = ''; }

    release() {
        persistShaderSettings();
        for (const entry of this.entries) releaseUIItem(entry.item);
        this.entries.length = 0;
        this.rows.length = 0;
        this.layoutKey = '';
    }
}
