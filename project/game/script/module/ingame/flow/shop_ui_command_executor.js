import { fingerprintR8Record } from '../contract/r8_fingerprint_contract.js';
import {
    SHOP_UI_COMMAND_RESULT_CODE,
    SHOP_UI_COMMAND_TYPE,
    isShopUiCommandType
} from '../contract/shop_ui_command_contract.js';
import { SHOP_RUNTIME_PHASE } from './shop_phase_coordinator.js';

const DEFAULT_HISTORY_CAPACITY = 256;

function freezeReceipt(source) {
    return Object.freeze({ ...source });
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}

function normalizeHistoryCapacity(value) {
    return Number.isSafeInteger(value) && value > 0
        ? value
        : DEFAULT_HISTORY_CAPACITY;
}

/**
 * @class ShopUiCommandExecutor
 * @description UI의 semantic command를 Shop/Commerce/SentenceBoard authority 호출로 변환합니다.
 */
export class ShopUiCommandExecutor {
    constructor(options = {}) {
        if (!options.shopSession
            || !options.sentenceBoard
            || !options.phaseCoordinator) {
            throw new TypeError('ShopUiCommandExecutor authority가 누락되었습니다.');
        }
        this.shopSession = options.shopSession;
        this.sentenceBoard = options.sentenceBoard;
        this.phaseCoordinator = options.phaseCoordinator;
        this.historyCapacity = normalizeHistoryCapacity(
            options.historyCapacity
        );
        this.history = new Map();
        this.historyOrder = [];
        this.executionCount = 0;
        this.replayCount = 0;
        this.conflictCount = 0;
        this.lastReceipt = null;
        this.destroyed = false;
    }

    /** 한 semantic command를 idempotent하게 실행합니다. */
    execute(command) {
        const normalized = this.#normalizeCommand(command);
        if (!normalized) {
            return this.#setLast(freezeReceipt({
                accepted: false,
                code: this.destroyed
                    ? SHOP_UI_COMMAND_RESULT_CODE.DESTROYED
                    : SHOP_UI_COMMAND_RESULT_CODE.INVALID_COMMAND,
                commandId: command?.commandId ?? null,
                commandType: command?.type ?? null,
                mutationCount: 0
            }));
        }
        const requestFingerprint = fingerprintR8Record(
            'shop-ui-command.r8',
            normalized
        );
        const known = this.history.get(normalized.commandId);
        if (known) {
            if (known.requestFingerprint === requestFingerprint) {
                this.replayCount++;
                return this.#setLast(known.receipt);
            }
            this.conflictCount++;
            return this.#setLast(freezeReceipt({
                accepted: false,
                code: SHOP_UI_COMMAND_RESULT_CODE.TRANSACTION_CONFLICT,
                commandId: normalized.commandId,
                commandType: normalized.type,
                requestFingerprint,
                mutationCount: 0
            }));
        }
        const receipt = this.#dispatch(normalized, requestFingerprint);
        this.executionCount++;
        this.#remember(normalized.commandId, requestFingerprint, receipt);
        return receipt;
    }

    /** 여러 command를 interaction sequence 순서대로 실행합니다. */
    executeAll(commands = []) {
        if (!Array.isArray(commands) || commands.length === 0) {
            return Object.freeze([]);
        }
        return Object.freeze(commands.map((command) => this.execute(command)));
    }

    getStatus() {
        return Object.freeze({
            executionCount: this.executionCount,
            replayCount: this.replayCount,
            conflictCount: this.conflictCount,
            rememberedCommandCount: this.history.size,
            historyCapacity: this.historyCapacity,
            lastReceipt: this.lastReceipt,
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.history.clear();
        this.historyOrder.length = 0;
        this.lastReceipt = null;
        this.shopSession = null;
        this.sentenceBoard = null;
        this.phaseCoordinator = null;
    }

    #normalizeCommand(command) {
        if (this.destroyed
            || !command
            || typeof command !== 'object'
            || !isNonEmptyString(command.commandId)
            || !isShopUiCommandType(command.type)
            || !Number.isSafeInteger(command.interactionSequence)
            || command.interactionSequence <= 0) {
            return null;
        }
        return Object.freeze({ ...command });
    }

    #dispatch(command, requestFingerprint) {
        if (this.phaseCoordinator.getPhase() !== SHOP_RUNTIME_PHASE.SHOP) {
            return freezeReceipt({
                accepted: false,
                code: SHOP_UI_COMMAND_RESULT_CODE.WRONG_PHASE,
                commandId: command.commandId,
                commandType: command.type,
                requestFingerprint,
                phase: this.phaseCoordinator.getPhase(),
                mutationCount: 0
            });
        }

        switch (command.type) {
            case SHOP_UI_COMMAND_TYPE.BUY_OFFER:
                return this.#wrapAuthorityReceipt(command, requestFingerprint,
                    this.shopSession.purchaseOffer({
                        transactionId: command.commandId,
                        offerId: command.offerId,
                        rowFingerprint: command.rowFingerprint,
                        expectedCommerceRevision:
                            command.expectedCommerceRevision,
                        expectedInventoryRevision:
                            command.expectedInventoryRevision
                    }));
            case SHOP_UI_COMMAND_TYPE.REROLL:
                return this.#wrapAuthorityReceipt(command, requestFingerprint,
                    this.shopSession.reroll({
                        transactionId: command.commandId,
                        rowFingerprint: command.rowFingerprint,
                        expectedCommerceRevision:
                            command.expectedCommerceRevision,
                        expectedInventoryRevision:
                            command.expectedInventoryRevision
                    }));
            case SHOP_UI_COMMAND_TYPE.UPGRADE_WORD:
                return this.#wrapAuthorityReceipt(command, requestFingerprint,
                    this.shopSession.upgradeOwnedWord({
                        transactionId: command.commandId,
                        instanceId: command.instanceId,
                        rowFingerprint: command.rowFingerprint,
                        expectedCommerceRevision:
                            command.expectedCommerceRevision,
                        expectedInventoryRevision:
                            command.expectedInventoryRevision
                    }));
            case SHOP_UI_COMMAND_TYPE.SELECT_INVENTORY_WORD:
                return freezeReceipt({
                    accepted: true,
                    code: SHOP_UI_COMMAND_RESULT_CODE.SELECTED,
                    commandId: command.commandId,
                    commandType: command.type,
                    requestFingerprint,
                    instanceId: command.instanceId ?? null,
                    mutationCount: 0
                });
            case SHOP_UI_COMMAND_TYPE.PLACE_SUBJECT:
                return this.#mutateBoard(command, requestFingerprint, () => (
                    this.sentenceBoard.setSubject(
                        command.slotId,
                        command.instanceId
                    )
                ), SHOP_UI_COMMAND_RESULT_CODE.PLACED);
            case SHOP_UI_COMMAND_TYPE.PLACE_VERB:
                return this.#mutateBoard(command, requestFingerprint, () => (
                    this.sentenceBoard.setVerb(
                        command.slotId,
                        command.instanceId
                    )
                ), SHOP_UI_COMMAND_RESULT_CODE.PLACED);
            case SHOP_UI_COMMAND_TYPE.PLACE_PAYLOAD:
                return this.#mutateBoard(command, requestFingerprint, () => (
                    this.sentenceBoard.setPayload(
                        command.slotId,
                        command.instanceId
                    )
                ), SHOP_UI_COMMAND_RESULT_CODE.PLACED);
            case SHOP_UI_COMMAND_TYPE.ADD_MODIFIER:
                return this.#mutateBoard(command, requestFingerprint, () => (
                    this.sentenceBoard.addModifier(
                        command.slotId,
                        command.instanceId
                    )
                ), SHOP_UI_COMMAND_RESULT_CODE.MODIFIER_ADDED);
            case SHOP_UI_COMMAND_TYPE.REMOVE_MODIFIER:
                return this.#mutateBoard(command, requestFingerprint, () => (
                    this.sentenceBoard.removeModifier(
                        command.slotId,
                        command.instanceId
                    )
                ), SHOP_UI_COMMAND_RESULT_CODE.MODIFIER_REMOVED);
            case SHOP_UI_COMMAND_TYPE.APPLY_BOARD:
                return this.#wrapAuthorityReceipt(command, requestFingerprint,
                    this.#commitBoard(command));
            case SHOP_UI_COMMAND_TYPE.DISCARD_DRAFT:
                return this.#wrapAuthorityReceipt(command, requestFingerprint,
                    this.#discardBoard(command));
            case SHOP_UI_COMMAND_TYPE.CONTINUE:
                return this.#wrapAuthorityReceipt(command, requestFingerprint,
                    this.phaseCoordinator.requestContinue({
                        transactionId: command.commandId
                    }));
            default:
                return freezeReceipt({
                    accepted: false,
                    code: SHOP_UI_COMMAND_RESULT_CODE.INVALID_COMMAND,
                    commandId: command.commandId,
                    commandType: command.type,
                    requestFingerprint,
                    mutationCount: 0
                });
        }
    }

    #mutateBoard(command, requestFingerprint, mutate, successCode) {
        const stale = this.#validateBoardRevision(command);
        if (stale) return stale;
        const boardStatus = this.sentenceBoard.getStatus();
        let beginReceipt = null;
        if (boardStatus.draftSlots === null) {
            beginReceipt = this.sentenceBoard.beginDraft();
            if (beginReceipt.accepted !== true) {
                return this.#wrapAuthorityReceipt(
                    command,
                    requestFingerprint,
                    beginReceipt
                );
            }
        }
        const mutationReceipt = mutate();
        const validation = this.sentenceBoard.validateDraft();
        return freezeReceipt({
            accepted: mutationReceipt.accepted === true,
            code: mutationReceipt.accepted === true
                ? successCode
                : mutationReceipt.code,
            commandId: command.commandId,
            commandType: command.type,
            requestFingerprint,
            slotId: command.slotId,
            instanceId: command.instanceId,
            beginReceipt,
            authorityReceipt: mutationReceipt,
            validation,
            mutationCount: (beginReceipt?.mutationCount ?? 0)
                + (mutationReceipt.mutationCount ?? 0)
        });
    }

    #commitBoard(command) {
        const stale = this.#validateBoardRevision(command);
        if (stale) return stale;
        return this.sentenceBoard.commitDraft({
            transactionId: command.commandId
        });
    }

    #discardBoard(command) {
        const stale = this.#validateBoardRevision(command);
        if (stale) return stale;
        return this.sentenceBoard.discardDraft();
    }

    #validateBoardRevision(command) {
        const status = this.sentenceBoard.getStatus();
        const expectedBoardRevision = Number(command.expectedBoardRevision);
        const expectedDraftRevision = Number(command.expectedDraftRevision);
        const boardMatches = Number.isSafeInteger(expectedBoardRevision)
            && expectedBoardRevision === status.boardRevision;
        const draftMatches = Number.isSafeInteger(expectedDraftRevision)
            && expectedDraftRevision === status.draftRevision;
        if (boardMatches && draftMatches) return null;
        return freezeReceipt({
            accepted: false,
            code: SHOP_UI_COMMAND_RESULT_CODE.STALE_BOARD_REVISION,
            commandId: command.commandId,
            commandType: command.type,
            expectedBoardRevision,
            boardRevision: status.boardRevision,
            expectedDraftRevision,
            draftRevision: status.draftRevision,
            mutationCount: 0
        });
    }

    #wrapAuthorityReceipt(command, requestFingerprint, authorityReceipt) {
        if (authorityReceipt?.commandId === command.commandId
            && authorityReceipt?.requestFingerprint === requestFingerprint) {
            return authorityReceipt;
        }
        return freezeReceipt({
            accepted: authorityReceipt?.accepted === true,
            code: authorityReceipt?.code
                ?? SHOP_UI_COMMAND_RESULT_CODE.INVALID_COMMAND,
            commandId: command.commandId,
            commandType: command.type,
            requestFingerprint,
            authorityReceipt,
            mutationCount: authorityReceipt?.mutationCount ?? 0
        });
    }

    #remember(commandId, requestFingerprint, receipt) {
        this.history.set(commandId, Object.freeze({
            requestFingerprint,
            receipt
        }));
        this.historyOrder.push(commandId);
        while (this.historyOrder.length > this.historyCapacity) {
            this.history.delete(this.historyOrder.shift());
        }
        this.#setLast(receipt);
    }

    #setLast(receipt) {
        this.lastReceipt = receipt;
        return receipt;
    }
}
