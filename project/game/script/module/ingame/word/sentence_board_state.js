import {
    R5_SHOWCASE_SENTENCE_LOADOUT,
    R7_WORD_DEFINITION_BY_ID
} from 'data/word/r3_word_catalog_data.js';
import {
    R8_WORD_UPGRADE_PROFILE_BY_ID
} from 'data/word/r8_word_upgrade_profile_data.js';
import {
    SENTENCE_BOARD_RESULT_CODE,
    createEmptySentenceBoardSlot,
    fingerprintSentenceBoardAuthored,
    isEmptySentenceBoardSlot,
    normalizeSentenceBoardSlots
} from '../contract/sentence_board_contract.js';
import { fingerprintR8Record } from '../contract/r8_fingerprint_contract.js';
import {
    requireR8NonEmptyString
} from '../contract/word_inventory_contract.js';
import {
    ABILITY_SLOT_IDS,
    SENTENCE_RUNTIME_PHASE,
    normalizeAbilitySlotId
} from '../contract/word_sentence_contract.js';
import { SentenceCompiler } from './sentence_compiler.js';
import { createRuntimeWordCatalogView } from './runtime_word_catalog_view.js';
import {
    WORD_SYSTEM_EDITOR_COMMIT_CODE,
    WordSystem
} from './word_system.js';
import { WordInventoryState } from './word_inventory_state.js';

const DEFAULT_TRANSACTION_HISTORY_CAPACITY = 256;

function requirePositiveSafeInteger(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)
        || value <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return value;
}

function freezeReceipt(source) {
    return Object.freeze({ ...source });
}

function cloneSlots(slots) {
    return normalizeSentenceBoardSlots(Object.fromEntries(
        ABILITY_SLOT_IDS.map((slotId) => {
            const slot = slots[slotId];
            return [slotId, {
                subjectInstanceId: slot.subjectInstanceId,
                verbInstanceId: slot.verbInstanceId,
                payloadInstanceId: slot.payloadInstanceId,
                modifierInstanceIds: Array.from(slot.modifierInstanceIds)
            }];
        })
    ));
}

function loadoutToBoardSlots(loadout) {
    if (!loadout || typeof loadout !== 'object' || Array.isArray(loadout)) {
        throw new TypeError('initialLoadout은 slot lookup 객체여야 합니다.');
    }
    for (const key of Object.keys(loadout)) {
        normalizeAbilitySlotId(key, 'initialLoadout slotId');
    }
    return normalizeSentenceBoardSlots(Object.fromEntries(
        ABILITY_SLOT_IDS.map((slotId) => {
            const sentence = loadout[slotId] ?? null;
            return [slotId, sentence === null
                ? createEmptySentenceBoardSlot()
                : {
                    subjectInstanceId: sentence.subjectWordInstanceId,
                    verbInstanceId: sentence.verbWordInstanceId,
                    payloadInstanceId: sentence.payloadWordInstanceId,
                    modifierInstanceIds: sentence.modifierWordInstanceIds
                }];
        })
    ));
}

function createSentenceDefinition(slotId, slot) {
    return Object.freeze({
        id: `sentence.r8.board.${slotId.toLowerCase()}`,
        subjectWordInstanceId: slot.subjectInstanceId,
        verbWordInstanceId: slot.verbInstanceId,
        payloadWordInstanceId: slot.payloadInstanceId,
        modifierWordInstanceIds: slot.modifierInstanceIds
    });
}

function createCompiledPreview(compiledAbility) {
    if (!compiledAbility) return null;
    return Object.freeze({
        compiledAbilityId: compiledAbility.compiledAbilityId,
        actionCode: compiledAbility.actionCode,
        operationKind: compiledAbility.operationKind ?? null,
        payloadCode: compiledAbility.payloadCode,
        cooldownTicks: compiledAbility.cooldownTicks,
        modifierSetFingerprint:
            compiledAbility.modifierSetFingerprint ?? 0,
        copiesPerSubject:
            compiledAbility.executionShape?.copiesPerSubject ?? 1,
        displaySentenceData: compiledAbility.displaySentenceData
    });
}

function createSlotValidation(slotId, slot, compiler) {
    if (isEmptySentenceBoardSlot(slot)) {
        return Object.freeze({
            slotId,
            empty: true,
            valid: true,
            code: 'EMPTY',
            message: null,
            sentenceDefinition: null,
            compiledAbility: null,
            preview: null
        });
    }
    const sentenceDefinition = createSentenceDefinition(slotId, slot);
    const compileResult = compiler.tryCompile(sentenceDefinition);
    return Object.freeze({
        slotId,
        empty: false,
        valid: compileResult.valid,
        code: compileResult.code,
        message: compileResult.message,
        sentenceDefinition,
        compiledAbility: compileResult.compiledAbility,
        preview: createCompiledPreview(compileResult.compiledAbility)
    });
}

function wordSystemCodeToBoardCode(code) {
    if (code === WORD_SYSTEM_EDITOR_COMMIT_CODE.WRONG_PHASE) {
        return SENTENCE_BOARD_RESULT_CODE.WRONG_PHASE;
    }
    if (code === WORD_SYSTEM_EDITOR_COMMIT_CODE.PENDING_ACTIVATION) {
        return SENTENCE_BOARD_RESULT_CODE.PENDING_ACTIVATION;
    }
    if (code === WORD_SYSTEM_EDITOR_COMMIT_CODE.DESTROYED) {
        return SENTENCE_BOARD_RESULT_CODE.DESTROYED;
    }
    return SENTENCE_BOARD_RESULT_CODE.WORD_SYSTEM_REJECTED;
}

/** Owned WordInstance로 다섯 ability sentence의 draft/commit을 소유합니다. */
export class SentenceBoardState {
    constructor(options = {}) {
        if (!(options.inventory instanceof WordInventoryState)) {
            throw new TypeError('SentenceBoardState에는 WordInventoryState가 필요합니다.');
        }
        if (!(options.wordSystem instanceof WordSystem)) {
            throw new TypeError('SentenceBoardState에는 WordSystem이 필요합니다.');
        }
        this.inventory = options.inventory;
        this.wordSystem = options.wordSystem;
        this.wordDefinitionsById = options.wordDefinitionsById
            ?? R7_WORD_DEFINITION_BY_ID;
        this.upgradeProfilesById = options.upgradeProfilesById
            ?? R8_WORD_UPGRADE_PROFILE_BY_ID;
        this.transactionHistoryCapacity = requirePositiveSafeInteger(
            options.transactionHistoryCapacity
                ?? DEFAULT_TRANSACTION_HISTORY_CAPACITY,
            'transactionHistoryCapacity'
        );
        const inventorySnapshot = this.inventory.getSnapshot();
        this.committedSlots = loadoutToBoardSlots(
            options.initialLoadout ?? R5_SHOWCASE_SENTENCE_LOADOUT
        );
        this.boardRevision = requirePositiveSafeInteger(
            options.initialBoardRevision ?? 1,
            'initialBoardRevision'
        );
        this.draftRevision = 0;
        this.inventoryRevision = inventorySnapshot.revision;
        this.boardFingerprint = fingerprintSentenceBoardAuthored(
            this.committedSlots,
            inventorySnapshot
        );
        this.draftSlots = null;
        this.draftInventoryRevision = null;
        this.lastValidation = null;
        this.lastCommittedValidation = null;
        this.lastReceipt = null;
        this.transactionEntries = new Map();
        this.transactionOrder = [];
        this.destroyed = false;
        const initialValidation = this.validateCommitted();
        if (initialValidation.valid !== true) {
            throw new RangeError(
                `initial sentence board가 compile되지 않습니다: ${initialValidation.code}`
            );
        }
    }

    beginDraft() {
        if (this.destroyed) return this.#destroyedReceipt();
        const inventorySnapshot = this.inventory.getSnapshot();
        this.draftSlots = cloneSlots(this.committedSlots);
        this.draftInventoryRevision = inventorySnapshot.revision;
        this.draftRevision++;
        this.lastValidation = null;
        return freezeReceipt({
            accepted: true,
            code: SENTENCE_BOARD_RESULT_CODE.DRAFT_STARTED,
            draftRevision: this.draftRevision,
            inventoryRevision: this.draftInventoryRevision,
            mutationCount: 1
        });
    }

    setSubject(slotId, instanceId) {
        return this.#replaceSlotField(
            slotId,
            'subjectInstanceId',
            this.#normalizeNullableInstanceId(instanceId, 'subjectInstanceId')
        );
    }

    setVerb(slotId, instanceId) {
        return this.#replaceSlotField(
            slotId,
            'verbInstanceId',
            this.#normalizeNullableInstanceId(instanceId, 'verbInstanceId')
        );
    }

    setPayload(slotId, instanceId) {
        return this.#replaceSlotField(
            slotId,
            'payloadInstanceId',
            this.#normalizeNullableInstanceId(instanceId, 'payloadInstanceId')
        );
    }

    addModifier(slotId, instanceId) {
        const modifierInstanceId = requireR8NonEmptyString(
            instanceId,
            'modifierInstanceId'
        );
        return this.#mutateSlot(slotId, (slot) => ({
            ...slot,
            modifierInstanceIds: [
                ...slot.modifierInstanceIds,
                modifierInstanceId
            ]
        }));
    }

    removeModifier(slotId, instanceId) {
        const modifierInstanceId = requireR8NonEmptyString(
            instanceId,
            'modifierInstanceId'
        );
        return this.#mutateSlot(slotId, (slot) => {
            const index = slot.modifierInstanceIds.indexOf(modifierInstanceId);
            if (index < 0) return slot;
            const modifierInstanceIds = Array.from(slot.modifierInstanceIds);
            modifierInstanceIds.splice(index, 1);
            return { ...slot, modifierInstanceIds };
        });
    }

    clearSlot(slotId) {
        return this.#mutateSlot(
            slotId,
            () => createEmptySentenceBoardSlot()
        );
    }

    discardDraft() {
        if (this.destroyed) return this.#destroyedReceipt();
        if (this.draftSlots === null) return this.#noDraftReceipt();
        this.draftSlots = null;
        this.draftInventoryRevision = null;
        this.draftRevision++;
        this.lastValidation = null;
        return freezeReceipt({
            accepted: true,
            code: SENTENCE_BOARD_RESULT_CODE.DRAFT_DISCARDED,
            draftRevision: this.draftRevision,
            mutationCount: 1
        });
    }

    validateDraft() {
        return this.#validateDraftInternal().result;
    }

    /** Continue가 현재 inventory revision의 committed board를 재검증합니다. */
    validateCommitted() {
        if (this.destroyed) return this.#destroyedReceipt();
        const validation = this.#validateSlotsInternal(
            this.committedSlots,
            this.inventoryRevision,
            'COMMITTED'
        );
        this.lastCommittedValidation = validation.result;
        return validation.result;
    }

    commitDraft(source = {}) {
        const transactionId = requireR8NonEmptyString(
            source.transactionId,
            'sentence board transactionId'
        );
        if (this.destroyed) {
            return this.#destroyedReceipt(transactionId);
        }
        if (this.draftSlots === null) {
            const known = this.transactionEntries.get(transactionId);
            return known?.receipt ?? this.#noDraftReceipt(transactionId);
        }
        const validation = this.#validateDraftInternal();
        const requestFingerprint = fingerprintR8Record(
            'sentence-board-commit.r8',
            {
                transactionId,
                inventoryRevision: this.draftInventoryRevision,
                boardFingerprint: validation.result.boardFingerprint,
                slots: this.draftSlots
            }
        );
        const known = this.transactionEntries.get(transactionId);
        if (known) {
            if (known.requestFingerprint === requestFingerprint) {
                return known.receipt;
            }
            return freezeReceipt({
                accepted: false,
                code: SENTENCE_BOARD_RESULT_CODE.TRANSACTION_CONFLICT,
                transactionId,
                requestFingerprint,
                boardRevision: this.boardRevision,
                mutationCount: 0
            });
        }
        if (validation.result.valid !== true) {
            return this.#remember(transactionId, requestFingerprint, {
                accepted: false,
                code: validation.result.code,
                transactionId,
                requestFingerprint,
                validation: validation.result,
                boardRevision: this.boardRevision,
                mutationCount: 0
            });
        }
        const wordStatus = this.wordSystem.getStatusView();
        if (wordStatus.phase !== SENTENCE_RUNTIME_PHASE.SHOP) {
            return this.#remember(transactionId, requestFingerprint, {
                accepted: false,
                code: SENTENCE_BOARD_RESULT_CODE.WRONG_PHASE,
                transactionId,
                requestFingerprint,
                phase: wordStatus.phase,
                boardRevision: this.boardRevision,
                mutationCount: 0
            });
        }
        if (wordStatus.pendingActivationCount !== 0) {
            return this.#remember(transactionId, requestFingerprint, {
                accepted: false,
                code: SENTENCE_BOARD_RESULT_CODE.PENDING_ACTIVATION,
                transactionId,
                requestFingerprint,
                pendingActivationCount: wordStatus.pendingActivationCount,
                boardRevision: this.boardRevision,
                mutationCount: 0
            });
        }
        const wordSystemReceipt = this.wordSystem.commitEditorLoadout({
            transactionId,
            requestFingerprint,
            boardFingerprint: validation.result.boardFingerprint,
            compiler: validation.compiler,
            loadout: validation.loadout
        });
        if (wordSystemReceipt.accepted !== true) {
            return this.#remember(transactionId, requestFingerprint, {
                accepted: false,
                code: wordSystemCodeToBoardCode(wordSystemReceipt.code),
                transactionId,
                requestFingerprint,
                wordSystemReceipt,
                boardRevision: this.boardRevision,
                mutationCount: 0
            });
        }
        this.committedSlots = cloneSlots(this.draftSlots);
        this.inventoryRevision = this.draftInventoryRevision;
        this.boardFingerprint = validation.result.boardFingerprint;
        this.boardRevision++;
        this.lastCommittedValidation = Object.freeze({
            ...validation.result,
            scope: 'COMMITTED'
        });
        const receipt = freezeReceipt({
            accepted: true,
            code: SENTENCE_BOARD_RESULT_CODE.COMMITTED,
            transactionId,
            requestFingerprint,
            priorBoardRevision: this.boardRevision - 1,
            boardRevision: this.boardRevision,
            inventoryRevision: this.inventoryRevision,
            boardFingerprint: this.boardFingerprint,
            validation: validation.result,
            wordSystemReceipt,
            mutationCount: ABILITY_SLOT_IDS.length
        });
        this.draftSlots = null;
        this.draftInventoryRevision = null;
        return this.#remember(
            transactionId,
            requestFingerprint,
            receipt
        );
    }

    getStatus() {
        return Object.freeze({
            boardRevision: this.destroyed ? 0 : this.boardRevision,
            draftRevision: this.destroyed ? 0 : this.draftRevision,
            inventoryRevision: this.destroyed ? 0 : this.inventoryRevision,
            draftInventoryRevision: this.destroyed
                ? null
                : this.draftInventoryRevision,
            boardFingerprint: this.destroyed ? 0 : this.boardFingerprint,
            committedSlots: this.destroyed ? null : this.committedSlots,
            draftSlots: this.destroyed ? null : this.draftSlots,
            lastValidation: this.lastValidation,
            lastCommittedValidation: this.lastCommittedValidation,
            lastReceipt: this.lastReceipt,
            rememberedTransactionCount: this.transactionEntries.size,
            transactionHistoryCapacity: this.transactionHistoryCapacity,
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.committedSlots = null;
        this.draftSlots = null;
        this.draftInventoryRevision = null;
        this.lastValidation = null;
        this.lastCommittedValidation = null;
        this.lastReceipt = null;
        this.transactionEntries.clear();
        this.transactionOrder.length = 0;
    }

    #validateDraftInternal() {
        if (this.destroyed) {
            return Object.freeze({
                result: this.#destroyedReceipt(),
                compiler: null,
                loadout: null
            });
        }
        if (this.draftSlots === null) {
            return Object.freeze({
                result: this.#noDraftReceipt(),
                compiler: null,
                loadout: null
            });
        }
        const validation = this.#validateSlotsInternal(
            this.draftSlots,
            this.draftInventoryRevision,
            'DRAFT'
        );
        this.lastValidation = validation.result;
        return validation;
    }

    #validateSlotsInternal(slots, expectedInventoryRevision, scope) {
        const inventorySnapshot = this.inventory.getSnapshot();
        if (inventorySnapshot.revision !== expectedInventoryRevision) {
            const result = freezeReceipt({
                accepted: false,
                valid: false,
                code: SENTENCE_BOARD_RESULT_CODE.INVENTORY_CHANGED,
                scope,
                expectedInventoryRevision,
                inventoryRevision: inventorySnapshot.revision,
                ...(scope === 'DRAFT'
                    ? { draftRevision: this.draftRevision }
                    : { boardRevision: this.boardRevision }),
                boardFingerprint: null,
                slotValidations: Object.freeze([]),
                mutationCount: 0
            });
            return Object.freeze({ result, compiler: null, loadout: null });
        }
        const catalog = createRuntimeWordCatalogView({
            inventorySnapshot,
            wordDefinitionsById: this.wordDefinitionsById,
            upgradeProfilesById: this.upgradeProfilesById
        });
        const compiler = new SentenceCompiler({
            wordDefinitionsById: catalog.wordDefinitionsById,
            wordInstancesById: catalog.wordInstancesById
        });
        const slotValidations = Object.freeze(ABILITY_SLOT_IDS.map(
            (slotId) => createSlotValidation(
                slotId,
                slots[slotId],
                compiler
            )
        ));
        const valid = slotValidations.every((entry) => entry.valid);
        const boardFingerprint = valid
            ? fingerprintSentenceBoardAuthored(
                slots,
                inventorySnapshot
            )
            : null;
        const result = Object.freeze({
            accepted: valid,
            valid,
            scope,
            code: valid
                ? SENTENCE_BOARD_RESULT_CODE.VALID
                : SENTENCE_BOARD_RESULT_CODE.INVALID_DRAFT,
            ...(scope === 'DRAFT'
                ? { draftRevision: this.draftRevision }
                : { boardRevision: this.boardRevision }),
            inventoryRevision: inventorySnapshot.revision,
            catalogFingerprint: catalog.catalogFingerprint,
            boardFingerprint,
            slotValidations,
            mutationCount: 0
        });
        const loadout = valid
            ? Object.freeze(Object.fromEntries(slotValidations.map((entry) => [
                entry.slotId,
                entry.sentenceDefinition
            ])))
            : null;
        return Object.freeze({ result, compiler, loadout });
    }

    #replaceSlotField(slotId, field, value) {
        return this.#mutateSlot(slotId, (slot) => ({
            ...slot,
            [field]: value
        }));
    }

    #mutateSlot(slotId, mutator) {
        const normalizedSlotId = normalizeAbilitySlotId(slotId);
        if (this.destroyed) return this.#destroyedReceipt();
        if (this.draftSlots === null) return this.#noDraftReceipt();
        const current = this.draftSlots[normalizedSlotId];
        const nextSource = mutator(current);
        const nextSlots = Object.fromEntries(ABILITY_SLOT_IDS.map((id) => [
            id,
            id === normalizedSlotId ? nextSource : this.draftSlots[id]
        ]));
        this.draftSlots = normalizeSentenceBoardSlots(nextSlots);
        this.draftRevision++;
        this.lastValidation = null;
        return freezeReceipt({
            accepted: true,
            code: SENTENCE_BOARD_RESULT_CODE.DRAFT_CHANGED,
            slotId: normalizedSlotId,
            draftRevision: this.draftRevision,
            inventoryRevision: this.draftInventoryRevision,
            mutationCount: 1
        });
    }

    #normalizeNullableInstanceId(instanceId, label) {
        return instanceId === null
            ? null
            : requireR8NonEmptyString(instanceId, label);
    }

    #remember(transactionId, requestFingerprint, source) {
        const receipt = Object.isFrozen(source)
            ? source
            : freezeReceipt(source);
        if (!this.transactionEntries.has(transactionId)) {
            this.transactionEntries.set(transactionId, Object.freeze({
                requestFingerprint,
                receipt
            }));
            this.transactionOrder.push(transactionId);
        }
        while (this.transactionOrder.length > this.transactionHistoryCapacity) {
            const retired = this.transactionOrder.shift();
            this.transactionEntries.delete(retired);
        }
        this.lastReceipt = receipt;
        return receipt;
    }

    #noDraftReceipt(transactionId = null) {
        return freezeReceipt({
            accepted: false,
            code: SENTENCE_BOARD_RESULT_CODE.NO_DRAFT,
            transactionId,
            boardRevision: this.destroyed ? 0 : this.boardRevision,
            mutationCount: 0
        });
    }

    #destroyedReceipt(transactionId = null) {
        return freezeReceipt({
            accepted: false,
            code: SENTENCE_BOARD_RESULT_CODE.DESTROYED,
            transactionId,
            boardRevision: 0,
            mutationCount: 0
        });
    }
}
