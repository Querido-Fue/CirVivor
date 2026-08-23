import { INPUT_ACTION_IDS } from 'input/_input_binding_constants.js';
import {
    SHOP_UI_COMMAND_TYPE
} from 'ingame/contract/shop_ui_command_contract.js';
import { isPointInsideShopOverlayRect } from './shop_overlay_layout.js';

const DEFAULT_TOOLTIP_DELAY_SECONDS = 0.3;
const MAX_TOOLTIP_DELAY_SECONDS = 2;
const MAX_QUEUED_COMMANDS = 64;

function normalizeDelta(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

/** existing setting의 0.01초 precision을 UI timer 경계에서도 보존합니다. */
export function normalizeShopTooltipDelaySeconds(value) {
    const number = Number(value);
    const finite = Number.isFinite(number)
        ? number
        : DEFAULT_TOOLTIP_DELAY_SECONDS;
    return Math.round(
        Math.max(0, Math.min(MAX_TOOLTIP_DELAY_SECONDS, finite)) * 100
    ) / 100;
}

function readPressed(inputSource, actionId) {
    return inputSource?.isPressed?.(actionId) === true;
}

function getTargetTooltip(target, renderState) {
    if (!target) return '';
    if (target.kind === 'offer') {
        return renderState.offers.find(
            ({ offerId }) => offerId === target.offerId
        )?.tooltip ?? '';
    }
    if (target.kind === 'inventory') {
        return renderState.inventory.find(
            ({ instanceId }) => instanceId === target.instanceId
        )?.tooltip ?? '';
    }
    if (target.kind === 'slot-role') {
        return renderState.slotRows.find(
            ({ slotId }) => slotId === target.slotId
        )?.[target.role]?.tooltip ?? '';
    }
    if (target.kind === 'reroll') {
        return `새로운 5개 제안 · Gold ${renderState.rerollCost}`;
    }
    if (target.kind === 'upgrade') return '선택한 단어를 다음 레벨로 강화';
    if (target.kind === 'apply') return '유효한 다섯 슬롯 draft를 한 번에 적용';
    if (target.kind === 'discard') return '편집 중인 draft를 폐기';
    if (target.kind === 'continue') return 'Shop을 닫고 같은 전투 월드로 복귀';
    return '';
}

/**
 * @class ShopOverlayInteraction
 * @description mouse/keyboard 상태를 semantic command로만 변환합니다.
 */
export class ShopOverlayInteraction {
    constructor(options = {}) {
        this.inputSource = options.inputSource ?? null;
        this.editorModel = options.editorModel;
        if (!this.editorModel) {
            throw new TypeError('ShopOverlayInteraction editorModel이 필요합니다.');
        }
        this.pointer = { x: 0, y: 0 };
        this.pointerPressed = false;
        this.previousPointerPressed = false;
        this.actionPressed = {
            next: false,
            previous: false,
            confirm: false,
            cancel: false
        };
        this.previousActionPressed = { ...this.actionPressed };
        this.focusIndex = 0;
        this.focusTargetId = null;
        this.lastFocusTargetId = null;
        this.hoverTargetId = null;
        this.pressedTargetId = null;
        this.tooltipTargetId = null;
        this.tooltipText = '';
        this.tooltipElapsedSeconds = 0;
        this.tooltipVisible = false;
        this.interactionSequence = 0;
        this.commandQueue = [];
        this.lastActivationSource = null;
        this.lastBlockedTargetId = null;
        this.active = false;
        this.destroyed = false;
    }

    update(renderState, layout, options = {}) {
        if (this.destroyed) return false;
        this.#readInputs();
        const interactive = renderState?.interactive === true
            && Array.isArray(layout?.focusTargets);
        if (!interactive) {
            this.#deactivate();
            this.#commitInputEdges();
            return false;
        }
        if (!this.active) {
            this.active = true;
            this.#restoreFocus(layout.focusTargets);
            this.#commitInputEdges();
            this.#updateHover(layout.focusTargets, renderState, options);
            return false;
        }

        this.#repairFocus(layout.focusTargets);
        this.#updateHover(layout.focusTargets, renderState, options);
        const nextEdge = this.actionPressed.next
            && !this.previousActionPressed.next;
        const previousEdge = this.actionPressed.previous
            && !this.previousActionPressed.previous;
        const confirmEdge = this.actionPressed.confirm
            && !this.previousActionPressed.confirm;
        const cancelEdge = this.actionPressed.cancel
            && !this.previousActionPressed.cancel;
        const pointerEdge = this.pointerPressed
            && !this.previousPointerPressed;
        let emitted = false;

        if (nextEdge || previousEdge) {
            this.#moveFocus(layout.focusTargets, nextEdge ? 1 : -1);
        }
        if (cancelEdge) {
            emitted = this.#cancel(renderState);
        } else if (pointerEdge && this.hoverTargetId !== null) {
            const pointerIndex = layout.focusTargets.findIndex(
                ({ id }) => id === this.hoverTargetId
            );
            if (pointerIndex >= 0) {
                this.#setFocus(pointerIndex, layout.focusTargets);
                emitted = this.#activateTarget(
                    layout.focusTargets[pointerIndex],
                    renderState,
                    'mouse'
                );
            }
        } else if (confirmEdge) {
            emitted = this.#activateTarget(
                layout.focusTargets[this.focusIndex] ?? null,
                renderState,
                'keyboard'
            );
        }

        const focusedTarget = layout.focusTargets[this.focusIndex] ?? null;
        this.pressedTargetId = this.pointerPressed
            ? this.hoverTargetId
            : (this.actionPressed.confirm ? focusedTarget?.id ?? null : null);
        this.#commitInputEdges();
        return emitted;
    }

    drainCommands() {
        if (this.commandQueue.length === 0) return Object.freeze([]);
        const drained = Object.freeze(Array.from(this.commandQueue));
        this.commandQueue.length = 0;
        return drained;
    }

    getStatus() {
        return Object.freeze({
            active: this.active,
            focusIndex: this.focusIndex,
            focusTargetId: this.focusTargetId,
            hoverTargetId: this.hoverTargetId,
            pressedTargetId: this.pressedTargetId,
            tooltipTargetId: this.tooltipTargetId,
            tooltipText: this.tooltipText,
            tooltipElapsedSeconds: this.tooltipElapsedSeconds,
            tooltipVisible: this.tooltipVisible,
            interactionSequence: this.interactionSequence,
            queuedCommandCount: this.commandQueue.length,
            lastActivationSource: this.lastActivationSource,
            lastBlockedTargetId: this.lastBlockedTargetId,
            pointer: Object.freeze({ ...this.pointer }),
            pointerPressed: this.pointerPressed,
            editor: this.editorModel?.getStatus?.() ?? Object.freeze({
                selectedInventoryInstanceId: null,
                selectedSlotId: null,
                selectionRevision: 0,
                destroyed: true
            }),
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.commandQueue.length = 0;
        this.inputSource = null;
        this.editorModel = null;
        this.active = false;
        this.focusTargetId = null;
        this.hoverTargetId = null;
        this.pressedTargetId = null;
        this.tooltipTargetId = null;
        this.tooltipText = '';
    }

    #readInputs() {
        const result = this.inputSource?.getPointerPosition?.(this.pointer);
        if (result && result !== this.pointer) {
            const x = Number(result.x);
            const y = Number(result.y);
            if (Number.isFinite(x)) this.pointer.x = x;
            if (Number.isFinite(y)) this.pointer.y = y;
        }
        this.pointerPressed = this.inputSource
            ?.isPrimaryPointerPressed?.() === true;
        this.actionPressed.next = readPressed(
            this.inputSource,
            INPUT_ACTION_IDS.UI_FOCUS_NEXT
        );
        this.actionPressed.previous = readPressed(
            this.inputSource,
            INPUT_ACTION_IDS.UI_FOCUS_PREVIOUS
        );
        this.actionPressed.confirm = readPressed(
            this.inputSource,
            INPUT_ACTION_IDS.UI_CONFIRM
        );
        this.actionPressed.cancel = readPressed(
            this.inputSource,
            INPUT_ACTION_IDS.UI_CANCEL
        );
    }

    #commitInputEdges() {
        this.previousPointerPressed = this.pointerPressed;
        Object.assign(this.previousActionPressed, this.actionPressed);
    }

    #deactivate() {
        if (this.focusTargetId) {
            this.lastFocusTargetId = this.focusTargetId;
        }
        this.active = false;
        this.hoverTargetId = null;
        this.pressedTargetId = null;
        this.tooltipTargetId = null;
        this.tooltipText = '';
        this.tooltipElapsedSeconds = 0;
        this.tooltipVisible = false;
    }

    #restoreFocus(targets) {
        const restored = this.lastFocusTargetId
            ? targets.findIndex(({ id }) => id === this.lastFocusTargetId)
            : -1;
        this.#setFocus(restored >= 0 ? restored : 0, targets);
    }

    #repairFocus(targets) {
        const exact = targets.findIndex(({ id }) => id === this.focusTargetId);
        this.#setFocus(exact >= 0 ? exact : 0, targets);
    }

    #moveFocus(targets, direction) {
        if (targets.length === 0) return;
        const next = (this.focusIndex + direction + targets.length)
            % targets.length;
        this.#setFocus(next, targets);
    }

    #setFocus(index, targets) {
        if (targets.length === 0) {
            this.focusIndex = 0;
            this.focusTargetId = null;
            return;
        }
        this.focusIndex = Math.max(0, Math.min(targets.length - 1, index));
        this.focusTargetId = targets[this.focusIndex].id;
        this.lastFocusTargetId = this.focusTargetId;
        const target = targets[this.focusIndex];
        if (target.kind === 'slot-role') {
            this.editorModel.selectSlot(target.slotId);
        }
    }

    #updateHover(targets, renderState, options) {
        const hovered = targets.find((target) => (
            isPointInsideShopOverlayRect(this.pointer, target.bounds)
        )) ?? null;
        const nextHoverId = hovered?.id ?? null;
        if (nextHoverId !== this.hoverTargetId) {
            this.hoverTargetId = nextHoverId;
            this.tooltipTargetId = nextHoverId;
            this.tooltipText = getTargetTooltip(hovered, renderState);
            this.tooltipElapsedSeconds = 0;
            this.tooltipVisible = false;
        } else if (nextHoverId !== null) {
            this.tooltipElapsedSeconds += normalizeDelta(options.deltaSeconds);
            const delay = normalizeShopTooltipDelaySeconds(
                options.tooltipDelaySeconds
            );
            this.tooltipVisible = this.tooltipText.length > 0
                && this.tooltipElapsedSeconds + Number.EPSILON >= delay;
        }
    }

    #cancel(renderState) {
        if (this.editorModel.getStatus().selectedInventoryInstanceId !== null) {
            this.editorModel.selectInventoryWord(null);
            this.#enqueueCommand(
                SHOP_UI_COMMAND_TYPE.SELECT_INVENTORY_WORD,
                renderState,
                { instanceId: null },
                'keyboard'
            );
            return true;
        }
        if (renderState.draftActive) {
            this.#enqueueCommand(
                SHOP_UI_COMMAND_TYPE.DISCARD_DRAFT,
                renderState,
                {},
                'keyboard'
            );
            return true;
        }
        return false;
    }

    #activateTarget(target, renderState, source) {
        if (!target) return false;
        this.lastActivationSource = source;
        if (target.kind === 'slot-role') {
            this.editorModel.selectSlot(target.slotId);
        }
        if (target.enabled !== true) {
            this.lastBlockedTargetId = target.id;
            return false;
        }
        this.lastBlockedTargetId = null;
        switch (target.kind) {
            case 'reroll':
                return this.#enqueueCommand(
                    SHOP_UI_COMMAND_TYPE.REROLL,
                    renderState,
                    {},
                    source
                );
            case 'offer':
                return this.#enqueueCommand(
                    SHOP_UI_COMMAND_TYPE.BUY_OFFER,
                    renderState,
                    { offerId: target.offerId },
                    source
                );
            case 'inventory':
                this.editorModel.selectInventoryWord(target.instanceId);
                return this.#enqueueCommand(
                    SHOP_UI_COMMAND_TYPE.SELECT_INVENTORY_WORD,
                    renderState,
                    { instanceId: target.instanceId },
                    source
                );
            case 'upgrade':
                return this.#enqueueCommand(
                    SHOP_UI_COMMAND_TYPE.UPGRADE_WORD,
                    renderState,
                    { instanceId: target.instanceId },
                    source
                );
            case 'slot-role':
                return this.#activateRoleTarget(target, renderState, source);
            case 'apply':
                return this.#enqueueCommand(
                    SHOP_UI_COMMAND_TYPE.APPLY_BOARD,
                    renderState,
                    {},
                    source
                );
            case 'discard':
                return this.#enqueueCommand(
                    SHOP_UI_COMMAND_TYPE.DISCARD_DRAFT,
                    renderState,
                    {},
                    source
                );
            case 'continue':
                return this.#enqueueCommand(
                    SHOP_UI_COMMAND_TYPE.CONTINUE,
                    renderState,
                    {},
                    source
                );
            default:
                return false;
        }
    }

    #activateRoleTarget(target, renderState, source) {
        const instanceId = this.editorModel.getStatus()
            .selectedInventoryInstanceId;
        if (!instanceId) return false;
        const row = renderState.slotRows.find(
            ({ slotId }) => slotId === target.slotId
        );
        let type;
        if (target.role === 'subject') {
            type = SHOP_UI_COMMAND_TYPE.PLACE_SUBJECT;
        } else if (target.role === 'verb') {
            type = SHOP_UI_COMMAND_TYPE.PLACE_VERB;
        } else if (target.role === 'payload') {
            type = SHOP_UI_COMMAND_TYPE.PLACE_PAYLOAD;
        } else if (row?.modifier?.modifierInstanceIds.includes(instanceId)) {
            type = SHOP_UI_COMMAND_TYPE.REMOVE_MODIFIER;
        } else {
            type = SHOP_UI_COMMAND_TYPE.ADD_MODIFIER;
        }
        return this.#enqueueCommand(type, renderState, {
            slotId: target.slotId,
            instanceId
        }, source);
    }

    #enqueueCommand(type, renderState, payload, source) {
        if (this.commandQueue.length >= MAX_QUEUED_COMMANDS) return false;
        this.interactionSequence++;
        const commandId = [
            'shop-ui.r8',
            renderState.shopSessionOrdinal,
            this.interactionSequence,
            type.toLowerCase()
        ].join(':');
        this.commandQueue.push(Object.freeze({
            commandId,
            type,
            interactionSequence: this.interactionSequence,
            interactionSource: source,
            shopSessionOrdinal: renderState.shopSessionOrdinal,
            rowFingerprint: renderState.rowFingerprint,
            expectedCommerceRevision: renderState.commerceRevision,
            expectedInventoryRevision: renderState.inventoryRevision,
            expectedBoardRevision: renderState.boardRevision,
            expectedDraftRevision: renderState.draftRevision,
            ...payload
        }));
        return true;
    }
}
