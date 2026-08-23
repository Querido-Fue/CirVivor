import { ABILITY_SLOT_ID } from 'ingame/contract/word_sentence_contract.js';

/**
 * @class SentenceEditorOverlayModel
 * @description inventory 선택과 editor focus만 소유하는 비-authoritative UI model입니다.
 */
export class SentenceEditorOverlayModel {
    constructor() {
        this.selectedInventoryInstanceId = null;
        this.selectedSlotId = ABILITY_SLOT_ID.Q;
        this.selectionRevision = 0;
        this.destroyed = false;
    }

    selectInventoryWord(instanceId) {
        if (this.destroyed) return false;
        const normalized = typeof instanceId === 'string' && instanceId.length > 0
            ? instanceId
            : null;
        if (normalized === this.selectedInventoryInstanceId) return false;
        this.selectedInventoryInstanceId = normalized;
        this.selectionRevision++;
        return true;
    }

    selectSlot(slotId) {
        if (this.destroyed
            || typeof slotId !== 'string'
            || slotId.length === 0
            || slotId === this.selectedSlotId) {
            return false;
        }
        this.selectedSlotId = slotId;
        this.selectionRevision++;
        return true;
    }

    /** inventory mutation 뒤 사라진 선택을 presentation state에서 제거합니다. */
    synchronizeInventory(inventoryInstances = []) {
        if (this.destroyed || this.selectedInventoryInstanceId === null) {
            return false;
        }
        const stillOwned = inventoryInstances.some(
            ({ instanceId }) => instanceId === this.selectedInventoryInstanceId
        );
        return stillOwned
            ? false
            : this.selectInventoryWord(null);
    }

    getStatus() {
        return Object.freeze({
            selectedInventoryInstanceId: this.destroyed
                ? null
                : this.selectedInventoryInstanceId,
            selectedSlotId: this.destroyed ? null : this.selectedSlotId,
            selectionRevision: this.selectionRevision,
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.selectedInventoryInstanceId = null;
        this.selectedSlotId = null;
    }
}
