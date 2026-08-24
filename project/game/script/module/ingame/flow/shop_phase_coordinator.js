import {
    WORD_SHOP_RESULT_CODE
} from '../contract/word_shop_contract.js';
import { fingerprintR8Record } from '../contract/r8_fingerprint_contract.js';
import {
    requireR8NonEmptyString,
    requireR8NonNegativeSafeInteger
} from '../contract/word_inventory_contract.js';
import { SENTENCE_RUNTIME_PHASE } from '../contract/word_sentence_contract.js';

export const SHOP_RUNTIME_PHASE = Object.freeze({
    COMBAT: 'COMBAT',
    SHOP_OPENING: 'SHOP_OPENING',
    SHOP: 'SHOP',
    SHOP_CLOSING: 'SHOP_CLOSING'
});

export const SHOP_OPEN_SOURCE_KIND = Object.freeze({
    QA_EXPLICIT: 'QA_EXPLICIT',
    WAVE_SETTLEMENT: 'WAVE_SETTLEMENT'
});

export const SHOP_PHASE_RESULT_CODE = Object.freeze({
    OPEN_PREFLIGHT_READY: 'OPEN_PREFLIGHT_READY',
    OPEN_PREFLIGHT_REJECTED: 'OPEN_PREFLIGHT_REJECTED',
    OPEN_REQUESTED: 'OPEN_REQUESTED',
    OPEN_DEFERRED: 'OPEN_DEFERRED',
    OPENED: 'OPENED',
    OPEN_REJECTED: 'OPEN_REJECTED',
    SHOP_NOT_CONFIGURED: 'SHOP_NOT_CONFIGURED',
    CONTINUE_BLOCKED_DRAFT: 'CONTINUE_BLOCKED_DRAFT',
    CONTINUE_BLOCKED_COMMERCE: 'CONTINUE_BLOCKED_COMMERCE',
    CONTINUE_BLOCKED_BOARD: 'CONTINUE_BLOCKED_BOARD',
    CLOSE_REQUESTED: 'CLOSE_REQUESTED',
    CLOSED: 'CLOSED',
    CLOSE_REJECTED: 'CLOSE_REJECTED',
    WRONG_PHASE: 'WRONG_PHASE',
    TRANSACTION_CONFLICT: 'TRANSACTION_CONFLICT',
    DESTROYED: 'DESTROYED'
});

const OPEN_SOURCE_KINDS = new Set(Object.values(SHOP_OPEN_SOURCE_KIND));
const READY_PROBATION_STATES = new Set(['IDLE', 'PASSED']);
const DEFAULT_HISTORY_CAPACITY = 256;

function requirePositiveSafeInteger(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)
        || value <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return value;
}

function normalizeCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function freezeReceipt(source) {
    return Object.freeze({ ...source });
}

function normalizeOpenRequest(source) {
    const sourceKind = requireR8NonEmptyString(
        source.sourceKind,
        'shop open sourceKind'
    );
    if (!OPEN_SOURCE_KINDS.has(sourceKind)) {
        throw new RangeError(`shop open sourceKind가 알려지지 않았습니다: ${sourceKind}`);
    }
    return Object.freeze({
        sourceKind,
        sourceId: requireR8NonEmptyString(
            source.sourceId,
            'shop open sourceId'
        ),
        settlementOrdinal: requirePositiveSafeInteger(
            source.settlementOrdinal,
            'shop open settlementOrdinal'
        ),
        transactionId: requireR8NonEmptyString(
            source.transactionId,
            'shop open transactionId'
        ),
        minimumFixedTick: requireR8NonNegativeSafeInteger(
            source.minimumFixedTick ?? 0,
            'shop open minimumFixedTick'
        ),
        expectedCommerceRevision:
            source.expectedCommerceRevision === undefined
                || source.expectedCommerceRevision === null
                ? null
                : requireR8NonNegativeSafeInteger(
                    source.expectedCommerceRevision,
                    'shop open expectedCommerceRevision'
                )
    });
}

/** Future Wave settlement owner가 사용할 typed request factory입니다. */
export function createWaveSettlementShopOpenRequest(source = {}) {
    return normalizeOpenRequest({
        ...source,
        sourceKind: SHOP_OPEN_SOURCE_KIND.WAVE_SETTLEMENT
    });
}

/** Raw runtime status를 phase owner가 비교할 bounded scalar snapshot으로 고정합니다. */
export function normalizeShopSafeBoundarySnapshot(source = {}) {
    const probationState = source.recoveryProbationState === null
        || source.recoveryProbationState === undefined
        ? null
        : String(source.recoveryProbationState);
    return Object.freeze({
        fixedTick: normalizeCount(source.fixedTick),
        wordActivationCount: normalizeCount(source.wordActivationCount),
        abilityExecutionCount: normalizeCount(source.abilityExecutionCount),
        towerCreationPendingCount: normalizeCount(
            source.towerCreationPendingCount
        ),
        towerMergePendingCount: normalizeCount(source.towerMergePendingCount),
        actorMaterializationPendingCount: normalizeCount(
            source.actorMaterializationPendingCount
        ),
        actorTransitActiveCount: normalizeCount(
            source.actorTransitActiveCount
        ),
        commercePendingCount: normalizeCount(source.commercePendingCount),
        endpointPendingFixedTick: normalizeCount(
            source.endpointPendingFixedTick
        ),
        wavePendingSpawnCount: normalizeCount(source.wavePendingSpawnCount),
        endpointRecoveryRequired: source.endpointRecoveryRequired === true,
        recoveryProbationState: probationState,
        runDefeated: source.runDefeated === true
    });
}

function collectOpeningBlockers(snapshot, minimumFixedTick) {
    const blockers = [];
    if (snapshot.fixedTick < minimumFixedTick) {
        blockers.push('MINIMUM_FIXED_TICK');
    }
    if (snapshot.wordActivationCount !== 0) blockers.push('WORD_ACTIVATION');
    if (snapshot.abilityExecutionCount !== 0) blockers.push('ABILITY_EXECUTION');
    if (snapshot.towerCreationPendingCount !== 0) blockers.push('TOWER_CREATION');
    if (snapshot.towerMergePendingCount !== 0) blockers.push('TOWER_MERGE');
    if (snapshot.actorMaterializationPendingCount !== 0) {
        blockers.push('ACTOR_MATERIALIZATION');
    }
    if (snapshot.actorTransitActiveCount !== 0) blockers.push('ACTOR_TRANSIT');
    if (snapshot.commercePendingCount !== 0) blockers.push('COMMERCE');
    if (snapshot.endpointPendingFixedTick !== 0) {
        blockers.push('ENDPOINT_FIXED_READBACK');
    }
    if (snapshot.wavePendingSpawnCount !== 0) blockers.push('WAVE_QUEUE');
    if (snapshot.endpointRecoveryRequired) blockers.push('ENDPOINT_RECOVERY');
    if (snapshot.recoveryProbationState !== null
        && !READY_PROBATION_STATES.has(snapshot.recoveryProbationState)) {
        blockers.push('RECOVERY_PROBATION');
    }
    if (snapshot.runDefeated) blockers.push('RUN_DEFEATED');
    return Object.freeze(blockers);
}

/** Combat과 frozen Shop fixed boundary 사이의 단일 phase authority입니다. */
export class ShopPhaseCoordinator {
    constructor(options = {}) {
        for (const [ownerName, owner, methods] of [
            ['wordSystem', options.wordSystem, [
                'setRuntimePhase',
                'getStatusView',
                'cancelPendingActivationRequests',
                'captureRuntimePhaseCheckpoint',
                'restoreRuntimePhaseCheckpoint'
            ]],
            ['shopSession', options.shopSession, [
                'previewOpen',
                'open',
                'close',
                'getStatus',
                'captureAtomicCheckpoint',
                'restoreAtomicCheckpoint'
            ]],
            ['sentenceBoard', options.sentenceBoard, ['validateCommitted', 'getStatus']],
            ['commerceState', options.commerceState, ['getRevision', 'getStatus']]
        ]) {
            for (const method of methods) {
                if (typeof owner?.[method] !== 'function') {
                    throw new TypeError(`${ownerName}.${method}()가 필요합니다.`);
                }
            }
        }
        if (typeof options.safeBoundaryPort?.getSnapshot !== 'function') {
            throw new TypeError('safeBoundaryPort.getSnapshot()이 필요합니다.');
        }
        if (options.presentationPort !== undefined
            && typeof options.presentationPort?.synchronize !== 'function') {
            throw new TypeError('presentationPort.synchronize()가 필요합니다.');
        }
        this.wordSystem = options.wordSystem;
        this.shopSession = options.shopSession;
        this.sentenceBoard = options.sentenceBoard;
        this.commerce = options.commerceState;
        this.safeBoundaryPort = options.safeBoundaryPort;
        this.presentationPort = options.presentationPort ?? null;
        this.shopRuntimeMode = options.shopRuntimeMode ?? 'QA';
        this.shopConfigured = options.shopConfigured !== false;
        this.failureInjector = typeof options.failureInjector === 'function'
            ? options.failureInjector
            : null;
        this.historyCapacity = requirePositiveSafeInteger(
            options.historyCapacity ?? DEFAULT_HISTORY_CAPACITY,
            'shop phase historyCapacity'
        );
        this.phase = SHOP_RUNTIME_PHASE.COMBAT;
        this.pendingOpen = null;
        this.pendingClose = null;
        this.history = new Map();
        this.historyOrder = [];
        this.lastSafeBoundary = null;
        this.lastOpeningBlockers = Object.freeze([]);
        this.lastReceipt = null;
        this.openCount = 0;
        this.closeCount = 0;
        this.openDeferralCount = 0;
        this.destroyed = false;
    }

    /** R9 settlement가 reward commit 전에 호출하는 immutable Shop readiness seam입니다. */
    preflightOpen(source = {}) {
        const request = normalizeOpenRequest(source);
        const commerceStatus = this.commerce.getStatus();
        const rejection = (reason, extra = {}) => freezeReceipt({
            accepted: false,
            code: SHOP_PHASE_RESULT_CODE.OPEN_PREFLIGHT_REJECTED,
            transactionId: request.transactionId,
            request,
            reason,
            runtimeMode: this.shopRuntimeMode,
            phase: this.phase,
            commerceRevision: commerceStatus.commerceRevision,
            mutationCount: 0,
            ...extra
        });
        if (this.destroyed) return rejection('DESTROYED');
        if (!this.shopConfigured) return rejection('SHOP_NOT_CONFIGURED');
        if (this.phase !== SHOP_RUNTIME_PHASE.COMBAT) {
            return rejection('WRONG_PHASE');
        }
        if (request.sourceKind === SHOP_OPEN_SOURCE_KIND.WAVE_SETTLEMENT
            && source.warmExposureApproved !== true) {
            return rejection('WARM_EXPOSURE_GATE');
        }
        if (commerceStatus.pendingTransactionCount !== 0) {
            return rejection('PENDING_COMMERCE', {
                pendingTransactionCount:
                    commerceStatus.pendingTransactionCount
            });
        }
        const shopPreview = this.shopSession.previewOpen({
            transactionId: request.transactionId,
            shopSessionOrdinal: request.settlementOrdinal,
            expectedCommerceRevision: commerceStatus.commerceRevision
        });
        if (shopPreview.accepted !== true
            || shopPreview.code !== WORD_SHOP_RESULT_CODE.OPEN_PREFLIGHT_READY) {
            return rejection('SHOP_PREFLIGHT_REJECTED', { shopPreview });
        }
        const preflightFingerprint = fingerprintR8Record(
            'shop-phase-open-preflight.r9',
            {
                request,
                runtimeMode: this.shopRuntimeMode,
                commerceRevision: commerceStatus.commerceRevision,
                inventoryRevision: commerceStatus.inventoryRevision,
                shopPreflightFingerprint: shopPreview.preflightFingerprint,
                warmExposureApproved: source.warmExposureApproved === true
            }
        );
        return freezeReceipt({
            accepted: true,
            code: SHOP_PHASE_RESULT_CODE.OPEN_PREFLIGHT_READY,
            transactionId: request.transactionId,
            request,
            requestFingerprint: fingerprintR8Record(
                'shop-phase-open.r8',
                request
            ),
            preflightFingerprint,
            runtimeMode: this.shopRuntimeMode,
            commerceRevision: commerceStatus.commerceRevision,
            inventoryRevision: commerceStatus.inventoryRevision,
            meaningfulOfferPool: Object.freeze({
                count: shopPreview.meaningfulOfferCount,
                fingerprint: shopPreview.meaningfulOfferPoolFingerprint,
                requiredCount: shopPreview.requiredOfferCount
            }),
            shopPreview,
            phase: this.phase,
            mutationCount: 0
        });
    }

    requestOpen(source = {}) {
        const request = normalizeOpenRequest(source);
        const requestFingerprint = fingerprintR8Record(
            'shop-phase-open.r8',
            request
        );
        const replay = this.#resolveReplay(
            request.transactionId,
            requestFingerprint
        );
        if (replay) return replay;
        if (this.destroyed) {
            return this.#remember(
                request.transactionId,
                requestFingerprint,
                this.#destroyedReceipt(request.transactionId)
            );
        }
        if (!this.shopConfigured) {
            return this.#remember(request.transactionId, requestFingerprint, {
                accepted: false,
                code: SHOP_PHASE_RESULT_CODE.SHOP_NOT_CONFIGURED,
                transactionId: request.transactionId,
                runtimeMode: this.shopRuntimeMode,
                phase: this.phase,
                mutationCount: 0
            });
        }
        if (this.phase === SHOP_RUNTIME_PHASE.SHOP_OPENING
            && this.pendingOpen?.request.transactionId
                === request.transactionId) {
            if (this.pendingOpen.requestFingerprint === requestFingerprint) {
                return this.pendingOpen.receipt;
            }
            return this.#conflictReceipt(
                request.transactionId,
                requestFingerprint
            );
        }
        if (this.phase !== SHOP_RUNTIME_PHASE.COMBAT) {
            return this.#remember(request.transactionId, requestFingerprint, {
                accepted: false,
                code: SHOP_PHASE_RESULT_CODE.WRONG_PHASE,
                transactionId: request.transactionId,
                phase: this.phase,
                mutationCount: 0
            });
        }
        let ingressCancellation = null;
        if (request.sourceKind === SHOP_OPEN_SOURCE_KIND.WAVE_SETTLEMENT) {
            ingressCancellation = this.wordSystem
                .cancelPendingActivationRequests('wave-settlement');
            if (this.wordSystem.setRuntimePhase(SENTENCE_RUNTIME_PHASE.PAUSE)
                !== true) {
                return this.#remember(request.transactionId, requestFingerprint, {
                    accepted: false,
                    code: SHOP_PHASE_RESULT_CODE.OPEN_REJECTED,
                    transactionId: request.transactionId,
                    phase: this.phase,
                    ingressCancellation,
                    mutationCount: 0
                });
            }
        }
        const receipt = freezeReceipt({
            accepted: true,
            code: SHOP_PHASE_RESULT_CODE.OPEN_REQUESTED,
            transactionId: request.transactionId,
            requestFingerprint,
            request,
            ingressCancellation,
            phase: SHOP_RUNTIME_PHASE.SHOP_OPENING,
            mutationCount: 1
        });
        this.pendingOpen = Object.freeze({
            request,
            requestFingerprint,
            receipt
        });
        this.phase = SHOP_RUNTIME_PHASE.SHOP_OPENING;
        this.lastReceipt = receipt;
        return receipt;
    }

    progressOpening() {
        if (this.destroyed) return this.#destroyedReceipt();
        if (this.phase !== SHOP_RUNTIME_PHASE.SHOP_OPENING
            || this.pendingOpen === null) {
            return freezeReceipt({
                accepted: false,
                code: SHOP_PHASE_RESULT_CODE.WRONG_PHASE,
                transactionId: null,
                phase: this.phase,
                mutationCount: 0
            });
        }
        const snapshot = normalizeShopSafeBoundarySnapshot(
            this.safeBoundaryPort.getSnapshot()
        );
        const blockers = collectOpeningBlockers(
            snapshot,
            this.pendingOpen.request.minimumFixedTick
        );
        this.lastSafeBoundary = snapshot;
        this.lastOpeningBlockers = blockers;
        if (blockers.length !== 0) {
            this.openDeferralCount++;
            const receipt = freezeReceipt({
                accepted: false,
                code: SHOP_PHASE_RESULT_CODE.OPEN_DEFERRED,
                transactionId: this.pendingOpen.request.transactionId,
                phase: this.phase,
                safeBoundary: snapshot,
                blockers,
                mutationCount: 0
            });
            this.lastReceipt = receipt;
            return receipt;
        }
        const pending = this.pendingOpen;
        const shopCheckpoint = this.shopSession.captureAtomicCheckpoint();
        const wordCheckpoint
            = this.wordSystem.captureRuntimePhaseCheckpoint();
        let shopReceipt = null;
        let presentationAttempted = false;
        try {
            this.failureInjector?.('before-shop-open', pending.request);
            shopReceipt = this.shopSession.open({
                transactionId: pending.request.transactionId,
                shopSessionOrdinal: pending.request.settlementOrdinal,
                expectedCommerceRevision:
                    pending.request.expectedCommerceRevision
                        ?? this.commerce.getRevision()
            });
            if (shopReceipt.code !== WORD_SHOP_RESULT_CODE.OPENED) {
                throw new Error(`ShopSession open rejected: ${shopReceipt.code}`);
            }
            this.failureInjector?.('after-shop-open', pending.request);
            if (this.wordSystem.setRuntimePhase(SENTENCE_RUNTIME_PHASE.SHOP)
                !== true) {
                throw new Error('WordSystem SHOP phase publication에 실패했습니다.');
            }
            this.failureInjector?.('after-word-shop', pending.request);
            presentationAttempted = true;
            this.presentationPort?.synchronize();
            this.failureInjector?.('after-presentation-open', pending.request);
        } catch (error) {
            this.wordSystem.restoreRuntimePhaseCheckpoint(wordCheckpoint);
            this.shopSession.restoreAtomicCheckpoint(shopCheckpoint);
            if (presentationAttempted) {
                try {
                    this.presentationPort?.synchronize();
                } catch {
                    // authority rollback이 우선이며 다음 정상 frame이 다시 동기화합니다.
                }
            }
            this.pendingOpen = null;
            this.phase = SHOP_RUNTIME_PHASE.COMBAT;
            return this.#remember(
                pending.request.transactionId,
                pending.requestFingerprint,
                {
                    accepted: false,
                    code: SHOP_PHASE_RESULT_CODE.OPEN_REJECTED,
                    transactionId: pending.request.transactionId,
                    shopReceipt,
                    failure: Object.freeze({
                        message: error instanceof Error
                            ? error.message
                            : String(error)
                    }),
                    rolledBack: true,
                    phase: this.phase,
                    mutationCount: 0
                }
            );
        }
        this.pendingOpen = null;
        this.phase = SHOP_RUNTIME_PHASE.SHOP;
        this.openCount++;
        return this.#remember(
            pending.request.transactionId,
            pending.requestFingerprint,
            {
                accepted: true,
                code: SHOP_PHASE_RESULT_CODE.OPENED,
                transactionId: pending.request.transactionId,
                request: pending.request,
                safeBoundary: snapshot,
                shopReceipt,
                phase: this.phase,
                mutationCount: 1
            }
        );
    }

    requestContinue(source = {}) {
        const transactionId = requireR8NonEmptyString(
            source.transactionId,
            'shop continue transactionId'
        );
        const shopStatus = this.shopSession.getStatus();
        const boardStatus = this.sentenceBoard.getStatus();
        const requestFingerprint = fingerprintR8Record(
            'shop-phase-continue.r8',
            {
                transactionId,
                shopSessionOrdinal: shopStatus.shopSessionOrdinal,
                rowFingerprint: shopStatus.row?.rowFingerprint ?? 0,
                boardRevision: boardStatus.boardRevision,
                boardFingerprint: boardStatus.boardFingerprint
            }
        );
        const replay = this.#resolveReplay(transactionId, requestFingerprint);
        if (replay) return replay;
        if (this.destroyed) {
            return this.#remember(
                transactionId,
                requestFingerprint,
                this.#destroyedReceipt(transactionId)
            );
        }
        if (this.phase === SHOP_RUNTIME_PHASE.SHOP_CLOSING
            && this.pendingClose?.transactionId === transactionId) {
            if (this.pendingClose.requestFingerprint === requestFingerprint) {
                return this.pendingClose.receipt;
            }
            return this.#conflictReceipt(transactionId, requestFingerprint);
        }
        if (this.phase !== SHOP_RUNTIME_PHASE.SHOP) {
            return this.#remember(transactionId, requestFingerprint, {
                accepted: false,
                code: SHOP_PHASE_RESULT_CODE.WRONG_PHASE,
                transactionId,
                phase: this.phase,
                mutationCount: 0
            });
        }
        const commerceStatus = this.commerce.getStatus();
        if (commerceStatus.pendingTransactionCount !== 0) {
            return this.#remember(transactionId, requestFingerprint, {
                accepted: false,
                code: SHOP_PHASE_RESULT_CODE.CONTINUE_BLOCKED_COMMERCE,
                transactionId,
                pendingTransactionCount:
                    commerceStatus.pendingTransactionCount,
                phase: this.phase,
                mutationCount: 0
            });
        }
        if (boardStatus.draftSlots !== null) {
            return this.#remember(transactionId, requestFingerprint, {
                accepted: false,
                code: SHOP_PHASE_RESULT_CODE.CONTINUE_BLOCKED_DRAFT,
                transactionId,
                draftRevision: boardStatus.draftRevision,
                phase: this.phase,
                mutationCount: 0
            });
        }
        const boardValidation = this.sentenceBoard.validateCommitted();
        if (boardValidation.valid !== true) {
            return this.#remember(transactionId, requestFingerprint, {
                accepted: false,
                code: SHOP_PHASE_RESULT_CODE.CONTINUE_BLOCKED_BOARD,
                transactionId,
                boardValidation,
                phase: this.phase,
                mutationCount: 0
            });
        }
        const receipt = freezeReceipt({
            accepted: true,
            code: SHOP_PHASE_RESULT_CODE.CLOSE_REQUESTED,
            transactionId,
            requestFingerprint,
            boardValidation,
            phase: SHOP_RUNTIME_PHASE.SHOP_CLOSING,
            mutationCount: 1
        });
        this.pendingClose = Object.freeze({
            transactionId,
            requestFingerprint,
            receipt,
            boardValidation
        });
        this.phase = SHOP_RUNTIME_PHASE.SHOP_CLOSING;
        this.lastReceipt = receipt;
        return receipt;
    }

    progressClosing() {
        if (this.destroyed) return this.#destroyedReceipt();
        if (this.phase !== SHOP_RUNTIME_PHASE.SHOP_CLOSING
            || this.pendingClose === null) {
            return freezeReceipt({
                accepted: false,
                code: SHOP_PHASE_RESULT_CODE.WRONG_PHASE,
                transactionId: null,
                phase: this.phase,
                mutationCount: 0
            });
        }
        const pending = this.pendingClose;
        const shopCheckpoint = this.shopSession.captureAtomicCheckpoint();
        const wordCheckpoint
            = this.wordSystem.captureRuntimePhaseCheckpoint();
        let shopReceipt = null;
        let presentationAttempted = false;
        try {
            this.failureInjector?.('before-shop-close', pending);
            shopReceipt = this.shopSession.close({
                transactionId: pending.transactionId
            });
            if (shopReceipt.code !== WORD_SHOP_RESULT_CODE.CLOSED) {
                throw new Error(`ShopSession close rejected: ${shopReceipt.code}`);
            }
            this.failureInjector?.('after-shop-close', pending);
            if (this.wordSystem.setRuntimePhase(SENTENCE_RUNTIME_PHASE.COMBAT)
                !== true) {
                throw new Error('WordSystem COMBAT phase publication에 실패했습니다.');
            }
            this.failureInjector?.('after-word-combat', pending);
            presentationAttempted = true;
            this.presentationPort?.synchronize();
            this.failureInjector?.('after-presentation-close', pending);
        } catch (error) {
            this.wordSystem.restoreRuntimePhaseCheckpoint(wordCheckpoint);
            this.shopSession.restoreAtomicCheckpoint(shopCheckpoint);
            if (presentationAttempted) {
                try {
                    this.presentationPort?.synchronize();
                } catch {
                    // authority rollback이 우선이며 다음 정상 frame이 다시 동기화합니다.
                }
            }
            this.pendingClose = null;
            this.phase = SHOP_RUNTIME_PHASE.SHOP;
            return this.#remember(
                pending.transactionId,
                pending.requestFingerprint,
                {
                    accepted: false,
                    code: SHOP_PHASE_RESULT_CODE.CLOSE_REJECTED,
                    transactionId: pending.transactionId,
                    shopReceipt,
                    boardValidation: pending.boardValidation,
                    failure: Object.freeze({
                        message: error instanceof Error
                            ? error.message
                            : String(error)
                    }),
                    rolledBack: true,
                    phase: this.phase,
                    mutationCount: 0
                }
            );
        }
        this.pendingClose = null;
        this.phase = SHOP_RUNTIME_PHASE.COMBAT;
        this.closeCount++;
        return this.#remember(
            pending.transactionId,
            pending.requestFingerprint,
            {
                accepted: true,
                code: SHOP_PHASE_RESULT_CODE.CLOSED,
                transactionId: pending.transactionId,
                shopReceipt,
                boardValidation: pending.boardValidation,
                phase: this.phase,
                mutationCount: 1
            }
        );
    }

    getPhase() {
        return this.destroyed ? null : this.phase;
    }

    getStatus() {
        return Object.freeze({
            phase: this.destroyed ? null : this.phase,
            runtimeMode: this.shopRuntimeMode,
            configured: this.shopConfigured,
            pendingOpenRequest: this.pendingOpen?.request ?? null,
            pendingCloseTransactionId:
                this.pendingClose?.transactionId ?? null,
            lastSafeBoundary: this.lastSafeBoundary,
            lastOpeningBlockers: this.lastOpeningBlockers,
            openCount: this.openCount,
            closeCount: this.closeCount,
            openDeferralCount: this.openDeferralCount,
            rememberedTransactionCount: this.history.size,
            historyCapacity: this.historyCapacity,
            lastReceipt: this.lastReceipt,
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.phase = SHOP_RUNTIME_PHASE.COMBAT;
        this.pendingOpen = null;
        this.pendingClose = null;
        this.history.clear();
        this.historyOrder.length = 0;
        this.lastSafeBoundary = null;
        this.lastOpeningBlockers = Object.freeze([]);
        this.lastReceipt = null;
    }

    #resolveReplay(transactionId, requestFingerprint) {
        const known = this.history.get(transactionId);
        if (!known) return null;
        return known.requestFingerprint === requestFingerprint
            ? known.receipt
            : this.#conflictReceipt(transactionId, requestFingerprint);
    }

    #remember(transactionId, requestFingerprint, source) {
        const receipt = Object.isFrozen(source)
            ? source
            : freezeReceipt(source);
        if (!this.history.has(transactionId)) {
            this.history.set(transactionId, Object.freeze({
                requestFingerprint,
                receipt
            }));
            this.historyOrder.push(transactionId);
        }
        while (this.historyOrder.length > this.historyCapacity) {
            const retired = this.historyOrder.shift();
            this.history.delete(retired);
        }
        this.lastReceipt = receipt;
        return receipt;
    }

    #conflictReceipt(transactionId, requestFingerprint) {
        return freezeReceipt({
            accepted: false,
            code: SHOP_PHASE_RESULT_CODE.TRANSACTION_CONFLICT,
            transactionId,
            requestFingerprint,
            phase: this.phase,
            mutationCount: 0
        });
    }

    #destroyedReceipt(transactionId = null) {
        return freezeReceipt({
            accepted: false,
            code: SHOP_PHASE_RESULT_CODE.DESTROYED,
            transactionId,
            phase: null,
            mutationCount: 0
        });
    }
}
