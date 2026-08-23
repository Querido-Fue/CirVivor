import { ANIMATION_CATEGORY } from 'animation/_constants.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { render } from 'display/display_system.js';
import { createFontString } from 'util/font_util.js';
import { SentenceEditorOverlayModel } from './sentence_editor_overlay_model.js';
import {
    ShopOverlayInteraction,
    normalizeShopTooltipDelaySeconds
} from './shop_overlay_interaction.js';
import { createShopOverlayLayout } from './shop_overlay_layout.js';
import { createShopOverlayRenderState } from './shop_overlay_render_state.js';

const UI_LAYER = 'ui';
const DEFAULT_TOOLTIP_DELAY_SECONDS = 0.3;

export const SHOP_OVERLAY_CANONICAL_SURFACE_IDS = Object.freeze([
    'shop.default',
    'shop.sold-and-disabled',
    'editor.valid',
    'editor.invalid'
]);

function color(path, fallback) {
    let value = ColorSchemes;
    for (const key of path) value = value?.[key];
    return value ?? fallback;
}

function drawRect(bounds, options = {}) {
    render(UI_LAYER, {
        shape: options.radius > 0 ? 'roundRect' : 'rect',
        x: bounds.x,
        y: bounds.y,
        w: bounds.w,
        h: bounds.h,
        radius: options.radius ?? 0,
        fill: options.fill ?? false,
        stroke: options.stroke ?? false,
        lineWidth: options.lineWidth ?? 1,
        alpha: options.alpha ?? 1
    });
}

function drawText(bounds, text, options = {}) {
    const align = options.align ?? 'left';
    const x = align === 'center'
        ? bounds.x + bounds.w * 0.5
        : (align === 'right' ? bounds.x + bounds.w : bounds.x);
    render(UI_LAYER, {
        shape: 'text',
        text: `${text ?? ''}`,
        x,
        y: bounds.y + bounds.h * (options.yRatio ?? 0.5),
        font: createFontString({
            weight: options.weight ?? 500,
            sizePx: options.size ?? 12
        }),
        fill: options.fill ?? '#ffffff',
        alpha: options.alpha ?? 1,
        align,
        baseline: 'middle'
    });
}

function targetVisual(interaction, id) {
    return Object.freeze({
        focused: interaction?.focusTargetId === id,
        hovered: interaction?.hoverTargetId === id,
        pressed: interaction?.pressedTargetId === id,
        blocked: interaction?.lastBlockedTargetId === id
    });
}

function drawInteractiveBox(bounds, label, options = {}) {
    const visual = options.visual ?? {};
    const enabled = options.enabled === true;
    const panel = color(['Overlay', 'Control', 'Inactive'], 'rgba(20,30,44,0.9)');
    const hover = color(['Overlay', 'Control', 'Hover'], 'rgba(255,255,255,0.14)');
    const confirm = color(['Overlay', 'Button', 'Confirm', 'Idle'], '#166ffb');
    const cancel = color(['Overlay', 'Button', 'Cancel', 'Idle'], '#ff5050');
    let fill = enabled ? panel : 'rgba(110,118,132,0.12)';
    if (enabled && (visual.hovered || visual.focused)) fill = hover;
    if (enabled && visual.pressed) fill = options.accent ?? confirm;
    if (visual.blocked) fill = 'rgba(255,170,64,0.22)';
    if (options.danger === true && enabled) fill = cancel;
    drawRect(bounds, {
        radius: options.radius ?? Math.max(2, bounds.h * 0.1),
        fill,
        stroke: visual.focused
            ? (options.accent ?? confirm)
            : color(['Overlay', 'Panel', 'Divider'], 'rgba(255,255,255,0.1)'),
        lineWidth: visual.focused ? 2 : 1,
        alpha: options.alpha ?? 1
    });
    drawText({
        x: bounds.x + bounds.w * 0.06,
        y: bounds.y,
        w: bounds.w * 0.88,
        h: bounds.h
    }, label, {
        align: options.align ?? 'center',
        size: options.fontSize,
        weight: options.weight ?? 600,
        fill: enabled
            ? color(['Overlay', 'Text', 'Item'], '#e5e7eb')
            : color(['Overlay', 'Text', 'Control'], '#7b8492'),
        alpha: enabled ? 1 : 0.72
    });
}

/**
 * @class ShopOverlayRenderer
 * @description R8 Shop/GameSystem snapshot을 2D UI 명령으로 표시하는 GameScene contributor입니다.
 */
export class ShopOverlayRenderer {
    constructor(options = {}) {
        this.inputSource = options.inputSource ?? null;
        this.animationPort = options.animationPort ?? null;
        this.settingsSource = options.settingsSource ?? null;
        this.editorModel = new SentenceEditorOverlayModel();
        this.interaction = new ShopOverlayInteraction({
            inputSource: this.inputSource,
            editorModel: this.editorModel
        });
        this.presentation = { emphasis: 1 };
        this.presentationAnimation = null;
        this.renderState = null;
        this.layout = null;
        this.lastVisible = false;
        this.drawCount = 0;
        this.updateCount = 0;
        this.destroyed = false;
    }

    update(gameplayStatus, viewport, frameDelta = 0) {
        if (this.destroyed) return false;
        this.#synchronizeSnapshot(gameplayStatus, viewport);
        this.#synchronizeVisibilityAnimation();
        const tooltipDelaySeconds = normalizeShopTooltipDelaySeconds(
            this.settingsSource?.getTooltipDelaySeconds?.()
                ?? DEFAULT_TOOLTIP_DELAY_SECONDS
        );
        const emitted = this.interaction.update(
            this.renderState,
            this.layout,
            {
                deltaSeconds: frameDelta,
                tooltipDelaySeconds
            }
        );
        this.#synchronizeSnapshot(gameplayStatus, viewport);
        this.updateCount++;
        return emitted;
    }

    draw(gameplayStatus, viewport) {
        if (this.destroyed) return false;
        this.#synchronizeSnapshot(gameplayStatus, viewport);
        if (this.renderState?.visible !== true || !this.layout) return false;
        const interaction = this.interaction.getStatus();
        this.#drawBackdrop();
        this.#drawTop(interaction);
        this.#drawOffers(interaction);
        this.#drawInventory(interaction);
        this.#drawEditor(interaction);
        this.#drawTooltip(interaction);
        this.drawCount++;
        return true;
    }

    drainCommands() {
        return this.interaction.drainCommands();
    }

    getRenderSnapshot() {
        return this.renderState;
    }

    getLayoutSnapshot() {
        return this.layout;
    }

    getInteractionStatus() {
        return this.interaction.getStatus();
    }

    getStatus() {
        return Object.freeze({
            visible: this.renderState?.visible === true,
            drawCount: this.drawCount,
            updateCount: this.updateCount,
            renderState: this.renderState,
            layout: this.layout,
            interaction: this.interaction.getStatus(),
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.presentationAnimation?.remove?.();
        this.presentationAnimation = null;
        this.interaction.destroy();
        this.editorModel.destroy();
        this.inputSource = null;
        this.animationPort = null;
        this.settingsSource = null;
        this.renderState = null;
        this.layout = null;
    }

    #synchronizeSnapshot(gameplayStatus, viewport) {
        const commerceInstances = gameplayStatus?.commerce?.inventory
            ?.instances ?? [];
        this.editorModel.synchronizeInventory(commerceInstances);
        this.renderState = createShopOverlayRenderState(
            gameplayStatus,
            this.editorModel.getStatus()
        );
        this.layout = createShopOverlayLayout(viewport, this.renderState);
    }

    #synchronizeVisibilityAnimation() {
        const visible = this.renderState?.visible === true;
        if (visible === this.lastVisible) return;
        this.lastVisible = visible;
        this.presentationAnimation?.remove?.();
        this.presentationAnimation = null;
        this.presentation.emphasis = visible ? 0 : 1;
        if (visible && typeof this.animationPort?.animate === 'function') {
            this.presentationAnimation = this.animationPort.animate(
                this.presentation,
                {
                    animationCategory: ANIMATION_CATEGORY.UI,
                    variable: 'emphasis',
                    startValue: 0,
                    endValue: 1,
                    type: 'easeOutCubic',
                    duration: 0.16
                }
            );
        }
    }

    #drawBackdrop() {
        const { viewport, root, offerPanel, inventoryPanel, editorPanel } = this.layout;
        drawRect({ x: 0, y: 0, w: viewport.ww, h: viewport.wh }, {
            fill: 'rgba(0, 0, 0, 0.58)',
            alpha: 1
        });
        drawRect(root, {
            radius: Math.max(8, 14 * this.layout.designScale),
            fill: color(['Overlay', 'Panel', 'Background'], '#05080e'),
            stroke: color(['Overlay', 'Panel', 'Border'], '#152033'),
            lineWidth: Math.max(1, this.layout.designScale)
        });
        for (const panel of [offerPanel, inventoryPanel.bounds, editorPanel.bounds]) {
            drawRect(panel, {
                radius: Math.max(5, 9 * this.layout.designScale),
                fill: color(['Overlay', 'Control', 'Inactive'], 'rgba(255,255,255,0.05)'),
                stroke: color(['Overlay', 'Panel', 'Divider'], 'rgba(255,255,255,0.08)'),
                lineWidth: 1
            });
        }
    }

    #drawTop(interaction) {
        const top = this.layout.top;
        const scale = this.layout.designScale;
        drawText(top.title, this.renderState.title, {
            size: Math.max(15, 23 * scale),
            weight: 750,
            fill: color(['Game', 'Font'], '#f2f4f8')
        });
        drawText(top.gold, `GOLD  ${this.renderState.gold}`, {
            align: 'right',
            size: Math.max(13, 18 * scale),
            weight: 700,
            fill: '#f6c453'
        });
        drawText(top.feedback, this.renderState.feedback.text, {
            align: 'center',
            size: Math.max(9, 11 * scale),
            fill: this.renderState.feedback.kind === 'error'
                ? '#ff7a7a'
                : (this.renderState.feedback.kind === 'stale'
                    ? '#ffb454'
                    : '#76d59a')
        });
        drawInteractiveBox(
            top.reroll,
            `REROLL · ${this.renderState.rerollCost}G`,
            {
                enabled: this.renderState.rerollEnabled,
                visual: targetVisual(interaction, 'reroll'),
                fontSize: Math.max(10, 13 * scale)
            }
        );
    }

    #drawOffers(interaction) {
        const scale = this.layout.designScale;
        for (let index = 0; index < this.layout.offerCards.length; index++) {
            const card = this.layout.offerCards[index];
            const offer = this.renderState.offers[index];
            const id = `offer:${offer.offerId}`;
            const visual = targetVisual(interaction, id);
            const fill = offer.sold
                ? 'rgba(92,100,112,0.18)'
                : (offer.affordable
                    ? color(['Overlay', 'Control', 'Inactive'], 'rgba(255,255,255,0.06)')
                    : 'rgba(156,73,73,0.18)');
            drawRect(card.bounds, {
                radius: Math.max(4, 8 * scale),
                fill: visual.hovered && offer.enabled
                    ? color(['Overlay', 'Control', 'Hover'], 'rgba(255,255,255,0.13)')
                    : fill,
                stroke: visual.focused
                    ? '#4d94ff'
                    : color(['Overlay', 'Panel', 'Divider'], 'rgba(255,255,255,0.08)'),
                lineWidth: visual.focused ? 2 : 1,
                alpha: visual.pressed ? 0.78 : 1
            });
            drawText({
                x: card.bounds.x + card.bounds.w * 0.08,
                y: card.bounds.y,
                w: card.bounds.w * 0.84,
                h: card.bounds.h
            }, offer.label, {
                align: 'center',
                yRatio: 0.38,
                size: Math.max(12, 18 * scale),
                weight: 700,
                fill: offer.sold ? '#7d8591' : '#f0f2f5'
            });
            drawText(card.bounds, offer.sold ? 'SOLD' : `${offer.price} GOLD`, {
                align: 'center',
                yRatio: 0.69,
                size: Math.max(9, 12 * scale),
                weight: 650,
                fill: offer.affordable ? '#f6c453' : '#ff7a7a'
            });
            drawText(card.bounds, offer.rarityId.toUpperCase(), {
                align: 'center',
                yRatio: 0.86,
                size: Math.max(7, 9 * scale),
                fill: '#8ea0b8'
            });
        }
    }

    #drawInventory(interaction) {
        const panel = this.layout.inventoryPanel;
        const scale = this.layout.designScale;
        drawText(panel.header, 'OWNED WORDS', {
            size: Math.max(11, 15 * scale),
            weight: 700,
            fill: color(['Overlay', 'Text', 'Section'], '#9aa4b2')
        });
        for (let index = 0; index < panel.entries.length; index++) {
            const layoutEntry = panel.entries[index];
            const entry = this.renderState.inventory[index];
            const id = `inventory:${entry.instanceId}`;
            const visual = targetVisual(interaction, id);
            drawInteractiveBox(layoutEntry.bounds, entry.label, {
                enabled: entry.enabled,
                visual,
                accent: entry.selected ? '#35a7ff' : '#166ffb',
                fontSize: Math.max(7, 9.5 * scale),
                weight: entry.selected ? 750 : 550
            });
            if (entry.selected) {
                drawRect(layoutEntry.bounds, {
                    radius: Math.max(2, layoutEntry.bounds.h * 0.1),
                    fill: false,
                    stroke: '#35a7ff',
                    lineWidth: 2
                });
            }
        }
        drawRect(panel.upgradePanel, {
            radius: Math.max(3, 6 * scale),
            fill: 'rgba(255,255,255,0.035)',
            stroke: color(['Overlay', 'Panel', 'Divider'], 'rgba(255,255,255,0.08)'),
            lineWidth: 1
        });
        const selected = this.renderState.selectedInventoryEntry;
        drawText({
            x: panel.upgradePanel.x + panel.upgradePanel.w * 0.04,
            y: panel.upgradePanel.y,
            w: panel.upgradePanel.w * 0.48,
            h: panel.upgradePanel.h
        }, selected
            ? `${selected.label} · ${this.renderState.selectedUpgrade.reason ?? 'UPGRADE_READY'}`
            : '단어를 선택하세요', {
            size: Math.max(8, 10 * scale),
            weight: 550,
            fill: color(['Overlay', 'Text', 'Item'], '#d5d5d5')
        });
        const upgradeLabel = this.renderState.selectedUpgrade.cost === null
            ? 'UPGRADE'
            : `UPGRADE · ${this.renderState.selectedUpgrade.cost}G`;
        drawInteractiveBox(panel.upgradeButton, upgradeLabel, {
            enabled: this.renderState.selectedUpgrade.enabled,
            visual: targetVisual(interaction, 'upgrade'),
            fontSize: Math.max(8, 11 * scale)
        });
    }

    #drawEditor(interaction) {
        const panel = this.layout.editorPanel;
        const scale = this.layout.designScale;
        drawText(panel.header, 'FIVE ABILITY SLOTS · SUBJECT / VERB / PAYLOAD / MODIFIER', {
            size: Math.max(9, 12 * scale),
            weight: 700,
            fill: color(['Overlay', 'Text', 'Section'], '#9aa4b2')
        });
        for (let rowIndex = 0; rowIndex < panel.rows.length; rowIndex++) {
            const layoutRow = panel.rows[rowIndex];
            const stateRow = this.renderState.slotRows[rowIndex];
            drawRect(layoutRow.bounds, {
                radius: Math.max(2, 4 * scale),
                fill: stateRow.selected
                    ? 'rgba(22,111,251,0.08)'
                    : 'rgba(255,255,255,0.018)',
                stroke: stateRow.preview.valid
                    ? 'rgba(118,213,154,0.16)'
                    : 'rgba(255,122,122,0.34)',
                lineWidth: 1
            });
            drawText(layoutRow.label, stateRow.slotId, {
                align: 'center',
                size: Math.max(8, 10 * scale),
                weight: 750,
                fill: stateRow.preview.valid ? '#dce3ec' : '#ff7a7a'
            });
            for (const role of ['subject', 'verb', 'payload', 'modifier']) {
                const cell = stateRow[role];
                const targetId = `slot:${stateRow.slotId}:${role}`;
                drawInteractiveBox(layoutRow.cells[role], cell.label, {
                    enabled: cell.enabled && this.renderState.interactive,
                    visual: targetVisual(interaction, targetId),
                    fontSize: Math.max(6.8, 8.8 * scale),
                    weight: 550
                });
            }
        }
        drawRect(panel.preview, {
            radius: Math.max(3, 6 * scale),
            fill: this.renderState.preview.valid
                ? 'rgba(54,145,94,0.12)'
                : 'rgba(180,67,67,0.15)',
            stroke: this.renderState.preview.valid ? '#4ba879' : '#d65757',
            lineWidth: 1
        });
        drawText({
            x: panel.preview.x + panel.preview.w * 0.025,
            y: panel.preview.y,
            w: panel.preview.w * 0.95,
            h: panel.preview.h
        }, this.renderState.preview.text, {
            size: Math.max(8, 10.5 * scale),
            weight: 600,
            fill: this.renderState.preview.valid ? '#9ee2b9' : '#ff9a9a'
        });
        const footer = panel.footer;
        drawInteractiveBox(footer.apply, 'APPLY', {
            enabled: this.renderState.applyEnabled,
            visual: targetVisual(interaction, 'apply'),
            fontSize: Math.max(9, 11 * scale)
        });
        drawInteractiveBox(footer.discard, 'DISCARD', {
            enabled: this.renderState.discardEnabled,
            visual: targetVisual(interaction, 'discard'),
            danger: true,
            fontSize: Math.max(9, 11 * scale)
        });
        drawInteractiveBox(footer.continue, 'CONTINUE', {
            enabled: this.renderState.continueEnabled,
            visual: targetVisual(interaction, 'continue'),
            fontSize: Math.max(9, 11 * scale)
        });
    }

    #drawTooltip(interaction) {
        if (interaction.tooltipVisible !== true
            || !interaction.tooltipText) return;
        const root = this.layout.root;
        const pointer = interaction.pointer;
        const width = root.w * 0.27;
        const height = root.h * 0.055;
        const x = Math.min(
            root.x + root.w - width,
            Math.max(root.x, pointer.x + root.w * 0.012)
        );
        const y = Math.min(
            root.y + root.h - height,
            Math.max(root.y, pointer.y + root.h * 0.018)
        );
        const bounds = { x, y, w: width, h: height };
        drawRect(bounds, {
            radius: Math.max(3, 5 * this.layout.designScale),
            fill: 'rgba(4,8,14,0.96)',
            stroke: '#50647f',
            lineWidth: 1
        });
        drawText({
            x: x + width * 0.04,
            y,
            w: width * 0.92,
            h: height
        }, interaction.tooltipText, {
            size: Math.max(8, 10 * this.layout.designScale),
            fill: '#e4e9ef'
        });
    }
}

export function createShopOverlayRenderer(options = {}) {
    return new ShopOverlayRenderer(options);
}
