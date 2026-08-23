import { fingerprintR8Record } from './r8_fingerprint_contract.js';
import {
    requireR8NonEmptyString
} from './word_inventory_contract.js';
import {
    ABILITY_SLOT_IDS,
    normalizeAbilitySlotId
} from './word_sentence_contract.js';

export const SENTENCE_BOARD_RESULT_CODE = Object.freeze({
    DRAFT_STARTED: 'DRAFT_STARTED',
    DRAFT_CHANGED: 'DRAFT_CHANGED',
    DRAFT_DISCARDED: 'DRAFT_DISCARDED',
    VALID: 'VALID',
    INVALID_DRAFT: 'INVALID_DRAFT',
    INVENTORY_CHANGED: 'INVENTORY_CHANGED',
    WRONG_PHASE: 'WRONG_PHASE',
    PENDING_ACTIVATION: 'PENDING_ACTIVATION',
    NO_DRAFT: 'NO_DRAFT',
    COMMITTED: 'COMMITTED',
    TRANSACTION_CONFLICT: 'TRANSACTION_CONFLICT',
    WORD_SYSTEM_REJECTED: 'WORD_SYSTEM_REJECTED',
    DESTROYED: 'DESTROYED'
});

export const SENTENCE_BOARD_ROLE = Object.freeze({
    SUBJECT: 'SUBJECT',
    VERB: 'VERB',
    PAYLOAD: 'PAYLOAD',
    MODIFIER: 'MODIFIER'
});

const SLOT_KEYS = new Set([
    'subjectInstanceId',
    'verbInstanceId',
    'payloadInstanceId',
    'modifierInstanceIds'
]);

function normalizeNullableInstanceId(value, label) {
    return value === null ? null : requireR8NonEmptyString(value, label);
}

export function normalizeSentenceBoardSlot(source, label = 'sentenceBoardSlot') {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError(`${label}은 객체여야 합니다.`);
    }
    for (const key of Reflect.ownKeys(source)) {
        if (typeof key === 'symbol' || !SLOT_KEYS.has(key)) {
            throw new RangeError(`${label}.${String(key)}은 지원하지 않는 필드입니다.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(`${label}.${key}은 data property여야 합니다.`);
        }
    }
    if (!Array.isArray(source.modifierInstanceIds)) {
        throw new TypeError(`${label}.modifierInstanceIds는 배열이어야 합니다.`);
    }
    return Object.freeze({
        subjectInstanceId: normalizeNullableInstanceId(
            source.subjectInstanceId,
            `${label}.subjectInstanceId`
        ),
        verbInstanceId: normalizeNullableInstanceId(
            source.verbInstanceId,
            `${label}.verbInstanceId`
        ),
        payloadInstanceId: normalizeNullableInstanceId(
            source.payloadInstanceId,
            `${label}.payloadInstanceId`
        ),
        modifierInstanceIds: Object.freeze(
            source.modifierInstanceIds.map((instanceId, index) => (
                requireR8NonEmptyString(
                    instanceId,
                    `${label}.modifierInstanceIds[${index}]`
                )
            ))
        )
    });
}

export function createEmptySentenceBoardSlot() {
    return normalizeSentenceBoardSlot({
        subjectInstanceId: null,
        verbInstanceId: null,
        payloadInstanceId: null,
        modifierInstanceIds: []
    });
}

export function isEmptySentenceBoardSlot(slot) {
    return slot?.subjectInstanceId === null
        && slot?.verbInstanceId === null
        && slot?.payloadInstanceId === null
        && Array.isArray(slot?.modifierInstanceIds)
        && slot.modifierInstanceIds.length === 0;
}

export function normalizeSentenceBoardSlots(source, label = 'sentenceBoardSlots') {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError(`${label}은 slot lookup 객체여야 합니다.`);
    }
    for (const key of Object.keys(source)) normalizeAbilitySlotId(key, label);
    return Object.freeze(Object.fromEntries(ABILITY_SLOT_IDS.map((slotId) => [
        slotId,
        normalizeSentenceBoardSlot(
            source[slotId] ?? createEmptySentenceBoardSlot(),
            `${label}.${slotId}`
        )
    ])));
}

function authoredInstanceIdentity(instanceId, inventoryById, label) {
    if (instanceId === null) return null;
    const instance = inventoryById?.[instanceId];
    if (!instance || instance.instanceId !== instanceId) {
        throw new RangeError(`${label} instance를 소유하지 않았습니다: ${instanceId}`);
    }
    return Object.freeze({
        instanceId,
        definitionId: instance.definitionId,
        upgradeLevel: instance.upgradeLevel
    });
}

/** Exact instance ID와 upgrade level을 포함하는 authored board identity입니다. */
export function fingerprintSentenceBoardAuthored(
    slots,
    inventorySnapshot
) {
    const normalized = normalizeSentenceBoardSlots(slots);
    const inventoryById = inventorySnapshot?.instancesById;
    if (!inventoryById || typeof inventoryById !== 'object') {
        throw new TypeError('inventorySnapshot.instancesById가 필요합니다.');
    }
    const authoredSlots = ABILITY_SLOT_IDS.map((slotId) => {
        const slot = normalized[slotId];
        return Object.freeze({
            slotId,
            subject: authoredInstanceIdentity(
                slot.subjectInstanceId,
                inventoryById,
                `${slotId}.subject`
            ),
            verb: authoredInstanceIdentity(
                slot.verbInstanceId,
                inventoryById,
                `${slotId}.verb`
            ),
            payload: authoredInstanceIdentity(
                slot.payloadInstanceId,
                inventoryById,
                `${slotId}.payload`
            ),
            modifiers: Object.freeze(slot.modifierInstanceIds.map(
                (instanceId, index) => authoredInstanceIdentity(
                    instanceId,
                    inventoryById,
                    `${slotId}.modifiers[${index}]`
                )
            ))
        });
    });
    return fingerprintR8Record(
        'sentence-board-authored.r8',
        authoredSlots,
        'sentenceBoard'
    );
}
