import { fingerprintR8Record } from '../contract/r8_fingerprint_contract.js';
import {
    createWaveClearProof,
    getWaveQuiescenceSnapshotFingerprint
} from '../contract/wave_quiescence_contract.js';
import {
    WAVE_RUN_RESULT_CODE,
    WAVE_RUN_STATE
} from '../contract/wave_run_state_contract.js';
import {
    SHOP_RUNTIME_CONFIGURATION_MODE
} from '../contract/shop_runtime_configuration_contract.js';
import {
    SHOP_PHASE_RESULT_CODE,
    SHOP_RUNTIME_PHASE,
    createWaveSettlementShopOpenRequest
} from './shop_phase_coordinator.js';

const UINT32_MAX = 0xffff_ffff;
const DEFAULT_FACT_CAPACITY = 128;
const DEFAULT_TRANSACTION_CAPACITY = 256;

export const WAVE_SETTLEMENT_FACT_TYPE = Object.freeze({
    WAVE_COMPLETED: 'WaveCompleted',
    WAVE_SETTLEMENT_COMMITTED: 'WaveSettlementCommitted',
    SHOP_OPEN_REQUESTED: 'ShopOpenRequested',
    SHOP_OPENED: 'ShopOpened',
    SETTLEMENT_BLOCKED: 'SettlementBlocked'
});

export const WAVE_SETTLEMENT_STAGE = Object.freeze({
    PREFLIGHTED: 'PREFLIGHTED',
    WAVE_COMPLETED: 'WAVE_COMPLETED',
    REWARD_COMMITTED: 'REWARD_COMMITTED',
    SHOP_REQUESTED: 'SHOP_REQUESTED',
    OPENED: 'OPENED',
    BLOCKED: 'BLOCKED'
});

export const WAVE_SETTLEMENT_RESULT_CODE = Object.freeze({
    OPEN_REQUESTED: 'OPEN_REQUESTED',
    OPEN_DEFERRED: 'OPEN_DEFERRED',
    OPENED: 'OPENED',
    SETTLEMENT_BLOCKED: 'SETTLEMENT_BLOCKED',
    WRONG_PHASE: 'WRONG_PHASE',
    SOURCE_CHANGED: 'SOURCE_CHANGED',
    TRANSACTION_CONFLICT: 'TRANSACTION_CONFLICT',
    RUN_DEFEATED: 'RUN_DEFEATED',
    RECOVERY_REQUIRED: 'RECOVERY_REQUIRED',
    DESTROYED: 'DESTROYED'
});

function requireRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label}은 record여야 합니다.`);
    }
    return value;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requireUint32(value, label, { positive = false } = {}) {
    if (!Number.isSafeInteger(value)
        || value < (positive ? 1 : 0)
        || value > UINT32_MAX) {
        throw new RangeError(`${label}은 ${positive ? '양의 ' : ''}uint32여야 합니다.`);
    }
    return value;
}

function requirePositiveCapacity(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 4_096) {
        throw new RangeError(`${label}은 1..4096 범위여야 합니다.`);
    }
    return value;
}

function freezeReceipt(source) {
    return Object.freeze({ ...source });
}

function assertPort(ownerName, owner, methods) {
    for (const method of methods) {
        if (typeof owner?.[method] !== 'function') {
            throw new TypeError(`${ownerName}.${method}()가 필요합니다.`);
        }
    }
    return owner;
}

class BoundedRingJournal {
    constructor(capacity) {
        this.capacity = capacity;
        this.entries = new Array(capacity);
        this.nextIndex = 0;
        this.size = 0;
    }

    append(entry) {
        this.entries[this.nextIndex] = entry;
        this.nextIndex = (this.nextIndex + 1) % this.capacity;
        this.size = Math.min(this.size + 1, this.capacity);
    }

    snapshot() {
        const result = new Array(this.size);
        const start = (this.nextIndex - this.size + this.capacity)
            % this.capacity;
        for (let index = 0; index < this.size; index++) {
            result[index] = this.entries[(start + index) % this.capacity];
        }
        return Object.freeze(result);
    }
}

export function createWaveSettlementTransactionId(source = {}) {
    return [
        'wave-settlement',
        requireNonEmptyString(source.runSessionId, 'settlement runSessionId'),
        requireNonEmptyString(source.mapId, 'settlement mapId'),
        requireUint32(source.waveOrdinal, 'settlement waveOrdinal', {
            positive: true
        }),
        requireNonEmptyString(source.waveId, 'settlement waveId'),
        requireUint32(
            source.completionRevision,
            'settlement completionRevision',
            { positive: true }
        )
    ].join(':');
}

/** Exact clear proof, completion reward, and Post-R8 Shop open을 잇는 CPU authority입니다. */
export class WaveSettlementCoordinator {
    constructor(options = {}) {
        this.waveRun = assertPort(
            'waveRunCoordinator',
            options.waveRunCoordinator,
            [
                'getSettlementView',
                'prepareSettlement',
                'observeShopOpened',
                'getFacts'
            ]
        );
        this.commerce = assertPort(
            'commerceState',
            options.commerceState,
            ['credit', 'getRevision', 'getStatus']
        );
        this.shopPhase = assertPort(
            'shopPhaseCoordinator',
            options.shopPhaseCoordinator,
            ['preflightOpen', 'requestOpen', 'getStatus']
        );
        this.coreIntegrity = assertPort(
            'coreIntegrity',
            options.coreIntegrity,
            ['getCurrentIntegrity', 'getMaxIntegrity', 'isDepleted']
        );
        this.runOutcome = assertPort(
            'runOutcome',
            options.runOutcome,
            ['isRunning', 'isDefeated']
        );
        this.overtimePressure = options.overtimePressureDirector ?? null;
        if (this.overtimePressure !== null) {
            assertPort(
                'overtimePressureDirector',
                this.overtimePressure,
                ['getStatus', 'requiresRecovery']
            );
        }
        this.warmExposureGate = assertPort(
            'warmExposureGate',
            options.warmExposureGate,
            ['isApproved']
        );
        this.qaRuntimeAuthorized = options.qaRuntimeAuthorized === true;
        this.failureInjector = typeof options.failureInjector === 'function'
            ? options.failureInjector
            : null;
        this.transactionCapacity = requirePositiveCapacity(
            options.transactionHistoryCapacity
                ?? DEFAULT_TRANSACTION_CAPACITY,
            'settlement transactionHistoryCapacity'
        );
        this.factJournal = new BoundedRingJournal(requirePositiveCapacity(
            options.factHistoryCapacity ?? DEFAULT_FACT_CAPACITY,
            'settlement factHistoryCapacity'
        ));
        this.transactions = new Map();
        this.transactionOrder = new Array(this.transactionCapacity);
        this.transactionNextIndex = 0;
        this.transactionSize = 0;
        this.activeTransactionId = null;
        this.factRevision = 0;
        this.commitCount = 0;
        this.openRequestCount = 0;
        this.openCount = 0;
        this.blockedCount = 0;
        this.replayCount = 0;
        this.conflictCount = 0;
        this.lastReceipt = null;
        this.destroyed = false;
    }

    commitSettlement(request = {}) {
        if (this.destroyed) {
            return this.#createDetachedReceipt(
                WAVE_SETTLEMENT_RESULT_CODE.DESTROYED
            );
        }
        const source = requireRecord(request, 'commitSettlement request');
        const transactionId = requireNonEmptyString(
            source.transactionId,
            'settlement transactionId'
        );
        const quiescenceSnapshot = requireRecord(
            source.quiescenceSnapshot,
            'settlement quiescenceSnapshot'
        );
        const snapshotFingerprint
            = getWaveQuiescenceSnapshotFingerprint(quiescenceSnapshot);
        const fixedTick = requireUint32(source.fixedTick, 'settlement fixedTick');
        if (fixedTick !== quiescenceSnapshot.fixedTick) {
            return this.#createDetachedReceipt(
                WAVE_SETTLEMENT_RESULT_CODE.SOURCE_CHANGED,
                { transactionId, reason: 'SETTLEMENT_FIXED_TICK_MISMATCH' }
            );
        }
        const expectedCommerceRevision = requireUint32(
            source.expectedCommerceRevision,
            'settlement expectedCommerceRevision',
            { positive: true }
        );
        const waveStatistics = source.waveStatistics === undefined
            ? Object.freeze({})
            : Object.freeze({ ...requireRecord(
                source.waveStatistics,
                'settlement waveStatistics'
            ) });
        const waveStatisticsFingerprint = fingerprintR8Record(
            'r9-wave-settlement-statistics',
            waveStatistics
        );
        const intentFingerprint = fingerprintR8Record(
            'r9-wave-settlement-intent',
            {
                transactionId,
                snapshotFingerprint,
                fixedTick,
                expectedCommerceRevision,
                waveStatisticsFingerprint
            }
        );
        const known = this.transactions.get(transactionId);
        if (known) {
            if (known.intentFingerprint !== intentFingerprint) {
                this.conflictCount++;
                return this.#createDetachedReceipt(
                    WAVE_SETTLEMENT_RESULT_CODE.TRANSACTION_CONFLICT,
                    { transactionId, intentFingerprint }
                );
            }
            this.replayCount++;
            return this.#advance(known.record, true);
        }

        const proofResult = createWaveClearProof(quiescenceSnapshot);
        const view = this.waveRun.getSettlementView();
        if (proofResult.accepted !== true
            || !proofResult.proof
            || view.state !== WAVE_RUN_STATE.CLEAR_CANDIDATE
            || view.destroyed === true) {
            return this.#createDetachedReceipt(
                view.state === WAVE_RUN_STATE.RUN_DEFEATED
                    || this.runOutcome.isDefeated()
                    ? WAVE_SETTLEMENT_RESULT_CODE.RUN_DEFEATED
                    : WAVE_SETTLEMENT_RESULT_CODE.WRONG_PHASE,
                { transactionId, proofResult, waveState: view.state }
            );
        }
        const proof = proofResult.proof;
        if (proof.proofFingerprint !== view.clearProofFingerprint
            || proof.runSessionId !== undefined
            && proof.runSessionId !== view.runSessionId
            || proof.mapId !== view.mapId
            || proof.waveId !== view.waveId
            || proof.waveOrdinal !== view.waveOrdinal) {
            return this.#createDetachedReceipt(
                WAVE_SETTLEMENT_RESULT_CODE.SOURCE_CHANGED,
                { transactionId, reason: 'CLEAR_PROOF_IDENTITY_MISMATCH' }
            );
        }
        const canonicalTransactionId = createWaveSettlementTransactionId({
            runSessionId: view.runSessionId,
            mapId: view.mapId,
            waveOrdinal: view.waveOrdinal,
            waveId: view.waveId,
            completionRevision: proof.completionRevision
        });
        if (transactionId !== canonicalTransactionId) {
            return this.#createDetachedReceipt(
                WAVE_SETTLEMENT_RESULT_CODE.SOURCE_CHANGED,
                {
                    transactionId,
                    reason: 'NON_CANONICAL_SETTLEMENT_ID',
                    canonicalTransactionId
                }
            );
        }
        if (this.runOutcome.isDefeated() || this.coreIntegrity.isDepleted()) {
            return this.#createDetachedReceipt(
                WAVE_SETTLEMENT_RESULT_CODE.RUN_DEFEATED,
                { transactionId }
            );
        }
        if (this.commerce.getRevision() !== expectedCommerceRevision) {
            return this.#createDetachedReceipt(
                WAVE_SETTLEMENT_RESULT_CODE.SOURCE_CHANGED,
                {
                    transactionId,
                    reason: 'COMMERCE_REVISION_DRIFT',
                    expectedCommerceRevision,
                    commerceRevision: this.commerce.getRevision()
                }
            );
        }
        const pressure = this.#capturePressureSummary(view);
        if (pressure.recoveryRequired) {
            return this.#createDetachedReceipt(
                WAVE_SETTLEMENT_RESULT_CODE.RECOVERY_REQUIRED,
                { transactionId, reason: 'OVERTIME_PRESSURE_RECOVERY' }
            );
        }
        const warmExposureApproved
            = this.warmExposureGate.isApproved() === true;
        const shopTransactionId = `${transactionId}:shop-open`;
        const shopOpenPreview = createWaveSettlementShopOpenRequest({
            sourceId: `${transactionId}:preflight`,
            settlementOrdinal: view.waveOrdinal,
            transactionId: shopTransactionId,
            minimumFixedTick: fixedTick
        });
        const shopPreflight = this.shopPhase.preflightOpen({
            ...shopOpenPreview,
            warmExposureApproved
        });
        const runtimeAccepted = shopPreflight.runtimeMode
                === SHOP_RUNTIME_CONFIGURATION_MODE.PRODUCTION
            || this.qaRuntimeAuthorized
                && shopPreflight.runtimeMode
                    === SHOP_RUNTIME_CONFIGURATION_MODE.QA;
        const finalCoreIntegrity = this.coreIntegrity.getCurrentIntegrity();
        const nextProgression = view.nextProgression;
        const fullFingerprint = fingerprintR8Record(
            'r9-wave-settlement-transaction',
            {
                transactionId,
                runSessionId: view.runSessionId,
                planId: view.planId,
                planFingerprint: view.planFingerprint,
                mapId: view.mapId,
                waveId: view.waveId,
                waveOrdinal: view.waveOrdinal,
                waveAttemptOrdinal: view.waveAttemptOrdinal,
                completionRevision: proof.completionRevision,
                quiescenceProofFingerprint: proof.proofFingerprint,
                clearType: view.completedInOvertime ? 'OVERTIME' : 'NORMAL',
                overtimePulseCount: pressure.overtimePulseCount,
                overtimeDamageTotalFixedPoint:
                    pressure.overtimeDamageTotalFixedPoint,
                finalCoreIntegrity,
                completionGoldBonus: view.completionGoldBonus,
                commerceRevision: expectedCommerceRevision,
                nextProgression,
                shopPreflightFingerprint:
                    shopPreflight.preflightFingerprint ?? 0,
                waveStatisticsFingerprint
            }
        );
        const record = {
            transactionId,
            intentFingerprint,
            fingerprint: fullFingerprint,
            stage: WAVE_SETTLEMENT_STAGE.PREFLIGHTED,
            view,
            proof,
            quiescenceSnapshot,
            fixedTick,
            expectedCommerceRevision,
            waveStatistics,
            waveStatisticsFingerprint,
            pressure,
            finalCoreIntegrity,
            nextProgression,
            shopPreflight,
            shopTransactionId,
            warmExposureApproved,
            waveCompletedReceipt: null,
            rewardReceipt: null,
            settlementReceipt: null,
            shopRequestReceipt: null,
            shopOpenedReceipt: null,
            transientFailure: null,
            lastReceipt: null
        };
        this.#rememberTransaction(record);
        this.activeTransactionId = transactionId;
        if (shopPreflight.accepted !== true
            || !runtimeAccepted
            || warmExposureApproved !== true) {
            return this.#block(record, 'SHOP_PREFLIGHT_REJECTED', {
                rewardPublished: false,
                runtimeAccepted
            });
        }
        return this.#advance(record, false);
    }

    /** ShopPhaseCoordinator가 safe boundary를 처리한 뒤 authentic OPENED만 관찰합니다. */
    observeShopOpening() {
        if (this.destroyed) {
            return this.#createDetachedReceipt(
                WAVE_SETTLEMENT_RESULT_CODE.DESTROYED
            );
        }
        const entry = this.activeTransactionId === null
            ? null
            : this.transactions.get(this.activeTransactionId);
        if (!entry) {
            return this.#createDetachedReceipt(
                WAVE_SETTLEMENT_RESULT_CODE.WRONG_PHASE
            );
        }
        return this.#observeShop(entry.record, false);
    }

    getFacts() {
        return this.factJournal.snapshot();
    }

    getStatus() {
        const active = this.activeTransactionId === null
            ? null
            : this.transactions.get(this.activeTransactionId)?.record ?? null;
        return Object.freeze({
            activeTransactionId: this.activeTransactionId,
            activeStage: active?.stage ?? null,
            activeFingerprint: active?.fingerprint ?? 0,
            completionRevision: active?.proof.completionRevision ?? 0,
            settlementOrdinal: active?.view.waveOrdinal ?? 0,
            clearType: active
                ? active.view.completedInOvertime ? 'OVERTIME' : 'NORMAL'
                : null,
            rewardPublished: active?.rewardReceipt !== null,
            shopRequested: active?.shopRequestReceipt !== null,
            shopOpened: active?.shopOpenedReceipt !== null,
            commitCount: this.commitCount,
            openRequestCount: this.openRequestCount,
            openCount: this.openCount,
            blockedCount: this.blockedCount,
            replayCount: this.replayCount,
            conflictCount: this.conflictCount,
            rememberedTransactionCount: this.transactions.size,
            transactionHistoryCapacity: this.transactionCapacity,
            lastReceipt: this.lastReceipt,
            settlementReceipt: active?.settlementReceipt ?? null,
            facts: this.getFacts(),
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.transactions.clear();
        this.transactionOrder.fill(undefined);
        this.transactionSize = 0;
        this.activeTransactionId = null;
        this.lastReceipt = null;
    }

    #capturePressureSummary(view) {
        if (!view.completedInOvertime) {
            return Object.freeze({
                overtimePulseCount: 0,
                overtimeDamageTotalFixedPoint: 0,
                recoveryRequired: false
            });
        }
        if (!this.overtimePressure) {
            return Object.freeze({
                overtimePulseCount: 0,
                overtimeDamageTotalFixedPoint: 0,
                recoveryRequired: true
            });
        }
        const status = this.overtimePressure.getStatus();
        return Object.freeze({
            overtimePulseCount: requireUint32(
                status.overtimePulseOrdinal,
                'settlement overtimePulseOrdinal'
            ),
            overtimeDamageTotalFixedPoint: requireUint32(
                status.overtimeDamageTotalFixedPoint,
                'settlement overtimeDamageTotalFixedPoint'
            ),
            recoveryRequired:
                status.recoveryRequired === true
                || this.overtimePressure.requiresRecovery() === true
        });
    }

    #advance(record, replayed) {
        if (record.stage === WAVE_SETTLEMENT_STAGE.BLOCKED
            || record.stage === WAVE_SETTLEMENT_STAGE.OPENED) {
            return this.#publishReceipt(record, record.lastReceipt, replayed);
        }
        record.transientFailure = null;
        try {
            if (record.stage === WAVE_SETTLEMENT_STAGE.PREFLIGHTED) {
                this.failureInjector?.('before-wave-completed', record);
                const waveReceipt = this.waveRun.prepareSettlement({
                    transactionId: `${record.transactionId}:wave-completed`,
                    runSessionId: record.view.runSessionId,
                    planId: record.view.planId,
                    waveOrdinal: record.view.waveOrdinal,
                    waveId: record.view.waveId,
                    clearProofFingerprint: record.proof.proofFingerprint,
                    completionRevision: record.proof.completionRevision
                });
                if (waveReceipt.accepted !== true
                    || waveReceipt.code !== WAVE_RUN_RESULT_CODE.ACCEPTED) {
                    return this.#block(
                        record,
                        waveReceipt.code === WAVE_RUN_RESULT_CODE.RUN_DEFEATED
                            ? 'RUN_DEFEATED'
                            : 'WAVE_COMPLETION_REJECTED',
                        { waveReceipt }
                    );
                }
                record.waveCompletedReceipt = waveReceipt;
                record.stage = WAVE_SETTLEMENT_STAGE.WAVE_COMPLETED;
                const completedFact = waveReceipt.facts[0] ?? null;
                if (completedFact) this.factJournal.append(completedFact);
                this.failureInjector?.('after-wave-completed', record);
            }
            if (record.stage === WAVE_SETTLEMENT_STAGE.WAVE_COMPLETED) {
                if (this.runOutcome.isDefeated()
                    || this.coreIntegrity.isDepleted()) {
                    return this.#block(record, 'RUN_DEFEATED', {
                        rewardPublished: false
                    });
                }
                if (this.commerce.getRevision()
                    !== record.expectedCommerceRevision) {
                    return this.#block(record, 'COMMERCE_DRIFT_BEFORE_REWARD', {
                        rewardPublished: false,
                        commerceRevision: this.commerce.getRevision()
                    });
                }
                this.failureInjector?.('before-reward', record);
                const rewardReceipt = this.commerce.credit({
                    transactionId: `${record.transactionId}:reward`,
                    amount: record.view.completionGoldBonus,
                    fixedTick: record.fixedTick,
                    sourceKind: 'WAVE_COMPLETION_BONUS'
                });
                if (rewardReceipt.accepted !== true) {
                    return this.#block(record, 'REWARD_REJECTED', {
                        rewardPublished: false,
                        rewardReceipt
                    });
                }
                const rewardCommerceRevision = this.commerce.getRevision();
                if (rewardCommerceRevision
                    !== record.expectedCommerceRevision + 1) {
                    return this.#block(record, 'COMMERCE_DRIFT_AFTER_REWARD', {
                        rewardPublished: true,
                        rewardReceipt,
                        rewardCommerceRevision
                    });
                }
                record.rewardReceipt = rewardReceipt;
                record.rewardCommerceRevision = rewardCommerceRevision;
                record.stage = WAVE_SETTLEMENT_STAGE.REWARD_COMMITTED;
                record.settlementReceipt = freezeReceipt({
                    transactionId: record.transactionId,
                    fingerprint: record.fingerprint,
                    runSessionId: record.view.runSessionId,
                    planId: record.view.planId,
                    planFingerprint: record.view.planFingerprint,
                    mapId: record.view.mapId,
                    waveId: record.view.waveId,
                    waveOrdinal: record.view.waveOrdinal,
                    waveAttemptOrdinal: record.view.waveAttemptOrdinal,
                    completionRevision: record.proof.completionRevision,
                    quiescenceProofFingerprint:
                        record.proof.proofFingerprint,
                    clearType: record.view.completedInOvertime
                        ? 'OVERTIME'
                        : 'NORMAL',
                    overtimePulseCount:
                        record.pressure.overtimePulseCount,
                    overtimeDamageTotalFixedPoint:
                        record.pressure.overtimeDamageTotalFixedPoint,
                    finalCoreIntegrity: record.finalCoreIntegrity,
                    maxCoreIntegrity: this.coreIntegrity.getMaxIntegrity(),
                    completionGoldBonus:
                        record.view.completionGoldBonus,
                    commerceRevisionBefore:
                        record.expectedCommerceRevision,
                    commerceRevisionAfter: rewardCommerceRevision,
                    nextProgression: record.nextProgression,
                    shopPreflightFingerprint:
                        record.shopPreflight.preflightFingerprint,
                    waveStatisticsFingerprint:
                        record.waveStatisticsFingerprint,
                    rewardReceipt,
                    rewardPublicationPolicy:
                        'PUBLISHED_DURABLE_NO_ROLLBACK'
                });
                this.commitCount++;
                this.#appendFact({
                    type: WAVE_SETTLEMENT_FACT_TYPE
                        .WAVE_SETTLEMENT_COMMITTED,
                    factId: `${record.transactionId}:committed`,
                    settlementTransactionId: record.transactionId,
                    settlementFingerprint: record.fingerprint,
                    completionRevision: record.proof.completionRevision,
                    completionGoldBonus:
                        record.view.completionGoldBonus,
                    commerceRevision: rewardCommerceRevision,
                    clearType: record.view.completedInOvertime
                        ? 'OVERTIME'
                        : 'NORMAL'
                });
                this.failureInjector?.('after-reward', record);
            }
            if (record.stage === WAVE_SETTLEMENT_STAGE.REWARD_COMMITTED) {
                if (this.commerce.getRevision()
                    !== record.rewardCommerceRevision) {
                    return this.#block(record, 'COMMERCE_DRIFT_BEFORE_SHOP', {
                        rewardPublished: true,
                        commerceRevision: this.commerce.getRevision()
                    });
                }
                this.failureInjector?.('before-shop-request', record);
                const shopRequest = createWaveSettlementShopOpenRequest({
                    sourceId: `${record.transactionId}:committed`,
                    settlementOrdinal: record.view.waveOrdinal,
                    transactionId: record.shopTransactionId,
                    minimumFixedTick: record.fixedTick,
                    expectedCommerceRevision:
                        record.rewardCommerceRevision
                });
                const shopReceipt = this.shopPhase.requestOpen(shopRequest);
                if (shopReceipt.accepted !== true
                    || shopReceipt.code
                        !== SHOP_PHASE_RESULT_CODE.OPEN_REQUESTED) {
                    return this.#block(record, 'SHOP_REQUEST_REJECTED', {
                        rewardPublished: true,
                        shopReceipt
                    });
                }
                record.shopRequestReceipt = shopReceipt;
                record.stage = WAVE_SETTLEMENT_STAGE.SHOP_REQUESTED;
                this.openRequestCount++;
                this.#appendFact({
                    type: WAVE_SETTLEMENT_FACT_TYPE.SHOP_OPEN_REQUESTED,
                    settlementTransactionId: record.transactionId,
                    shopTransactionId: record.shopTransactionId,
                    sourceKind: shopRequest.sourceKind,
                    sourceId: shopRequest.sourceId,
                    settlementOrdinal: shopRequest.settlementOrdinal,
                    minimumFixedTick: shopRequest.minimumFixedTick,
                    expectedCommerceRevision:
                        shopRequest.expectedCommerceRevision
                });
                this.failureInjector?.('after-shop-request', record);
            }
            return this.#observeShop(record, replayed);
        } catch (error) {
            record.transientFailure = Object.freeze({
                stage: record.stage,
                message: error instanceof Error ? error.message : String(error)
            });
            return this.#publishReceipt(record, freezeReceipt({
                accepted: false,
                code: WAVE_SETTLEMENT_RESULT_CODE.RECOVERY_REQUIRED,
                transactionId: record.transactionId,
                fingerprint: record.fingerprint,
                stage: record.stage,
                transientFailure: record.transientFailure,
                rewardPublished: record.rewardReceipt !== null,
                rewardPublicationPolicy: record.rewardReceipt
                    ? 'PUBLISHED_DURABLE_NO_ROLLBACK'
                    : 'NOT_PUBLISHED'
            }), replayed);
        }
    }

    #observeShop(record, replayed) {
        if (record.stage !== WAVE_SETTLEMENT_STAGE.SHOP_REQUESTED) {
            return this.#publishReceipt(record, record.lastReceipt, replayed);
        }
        const shopStatus = this.shopPhase.getStatus();
        const shopReceipt = shopStatus.lastReceipt;
        if (shopStatus.phase === SHOP_RUNTIME_PHASE.SHOP_OPENING) {
            return this.#publishReceipt(record, freezeReceipt({
                accepted: true,
                code: shopReceipt?.code
                    === SHOP_PHASE_RESULT_CODE.OPEN_DEFERRED
                    ? WAVE_SETTLEMENT_RESULT_CODE.OPEN_DEFERRED
                    : WAVE_SETTLEMENT_RESULT_CODE.OPEN_REQUESTED,
                transactionId: record.transactionId,
                fingerprint: record.fingerprint,
                stage: record.stage,
                settlementReceipt: record.settlementReceipt,
                shopRequestReceipt: record.shopRequestReceipt,
                shopProgressReceipt: shopReceipt,
                rewardPublished: true,
                rewardPublicationPolicy: 'PUBLISHED_DURABLE_NO_ROLLBACK'
            }), replayed);
        }
        if (shopReceipt?.transactionId === record.shopTransactionId
            && shopReceipt.code === SHOP_PHASE_RESULT_CODE.OPEN_REJECTED) {
            return this.#block(record, 'SHOP_OPEN_REJECTED', {
                rewardPublished: true,
                shopReceipt
            });
        }
        if (shopStatus.phase !== SHOP_RUNTIME_PHASE.SHOP
            || shopReceipt?.transactionId !== record.shopTransactionId
            || shopReceipt.code !== SHOP_PHASE_RESULT_CODE.OPENED) {
            return this.#publishReceipt(record, freezeReceipt({
                accepted: true,
                code: WAVE_SETTLEMENT_RESULT_CODE.OPEN_REQUESTED,
                transactionId: record.transactionId,
                fingerprint: record.fingerprint,
                stage: record.stage,
                settlementReceipt: record.settlementReceipt,
                shopRequestReceipt: record.shopRequestReceipt,
                rewardPublished: true,
                rewardPublicationPolicy: 'PUBLISHED_DURABLE_NO_ROLLBACK'
            }), replayed);
        }
        if (this.commerce.getRevision() !== record.rewardCommerceRevision) {
            return this.#block(record, 'COMMERCE_DRIFT_AT_SHOP_OPEN', {
                rewardPublished: true,
                commerceRevision: this.commerce.getRevision(),
                shopReceipt
            });
        }
        const rowFingerprint = shopReceipt.shopReceipt?.row?.rowFingerprint ?? 0;
        const shopSessionId = [
            'word-shop-session',
            record.view.runSessionId,
            record.view.waveOrdinal,
            rowFingerprint
        ].join(':');
        const waveReceipt = this.waveRun.observeShopOpened({
            transactionId: `${record.transactionId}:shop-opened`,
            runSessionId: record.view.runSessionId,
            planId: record.view.planId,
            waveOrdinal: record.view.waveOrdinal,
            waveId: record.view.waveId,
            shopSessionId,
            completionRevision: record.proof.completionRevision,
            shopReady: true
        });
        if (waveReceipt.accepted !== true) {
            return this.#block(record, 'WAVE_SHOP_OBSERVATION_REJECTED', {
                rewardPublished: true,
                waveReceipt,
                shopReceipt
            });
        }
        record.shopOpenedReceipt = shopReceipt;
        record.stage = WAVE_SETTLEMENT_STAGE.OPENED;
        this.openCount++;
        const openedFact = this.#appendFact({
            type: WAVE_SETTLEMENT_FACT_TYPE.SHOP_OPENED,
            settlementTransactionId: record.transactionId,
            shopTransactionId: record.shopTransactionId,
            shopSessionId,
            settlementOrdinal: record.view.waveOrdinal,
            rowFingerprint,
            completionRevision: record.proof.completionRevision
        });
        const terminalReceipt = freezeReceipt({
            accepted: true,
            code: WAVE_SETTLEMENT_RESULT_CODE.OPENED,
            transactionId: record.transactionId,
            fingerprint: record.fingerprint,
            stage: record.stage,
            settlementReceipt: record.settlementReceipt,
            shopRequestReceipt: record.shopRequestReceipt,
            shopOpenedReceipt: shopReceipt,
            waveShopReceipt: waveReceipt,
            shopOpenedFact: openedFact,
            rewardPublished: true,
            rewardPublicationPolicy: 'PUBLISHED_DURABLE_NO_ROLLBACK'
        });
        return this.#publishReceipt(record, terminalReceipt, replayed);
    }

    #block(record, reason, extra = {}) {
        if (record.stage !== WAVE_SETTLEMENT_STAGE.BLOCKED) {
            record.stage = WAVE_SETTLEMENT_STAGE.BLOCKED;
            this.blockedCount++;
            this.#appendFact({
                type: WAVE_SETTLEMENT_FACT_TYPE.SETTLEMENT_BLOCKED,
                settlementTransactionId: record.transactionId,
                settlementFingerprint: record.fingerprint,
                reason,
                rewardPublished: extra.rewardPublished === true
            });
        }
        const rewardPublished = record.rewardReceipt !== null
            || extra.rewardPublished === true;
        const code = reason === 'RUN_DEFEATED'
            ? WAVE_SETTLEMENT_RESULT_CODE.RUN_DEFEATED
            : WAVE_SETTLEMENT_RESULT_CODE.SETTLEMENT_BLOCKED;
        return this.#publishReceipt(record, freezeReceipt({
            accepted: false,
            code,
            transactionId: record.transactionId,
            fingerprint: record.fingerprint,
            stage: record.stage,
            reason,
            settlementReceipt: record.settlementReceipt,
            rewardPublished,
            rewardPublicationPolicy: rewardPublished
                ? 'PUBLISHED_DURABLE_NO_ROLLBACK'
                : 'NOT_PUBLISHED',
            ...extra
        }), false);
    }

    #appendFact(fields) {
        const fact = Object.freeze({
            ...fields,
            settlementFactRevision: ++this.factRevision
        });
        this.factJournal.append(fact);
        return fact;
    }

    #rememberTransaction(record) {
        if (this.transactionSize === this.transactionCapacity) {
            const evictedId = this.transactionOrder[this.transactionNextIndex];
            this.transactions.delete(evictedId);
        } else {
            this.transactionSize++;
        }
        this.transactionOrder[this.transactionNextIndex] = record.transactionId;
        this.transactionNextIndex = (
            this.transactionNextIndex + 1
        ) % this.transactionCapacity;
        this.transactions.set(record.transactionId, Object.freeze({
            intentFingerprint: record.intentFingerprint,
            record
        }));
    }

    #publishReceipt(record, receipt, replayed) {
        const source = receipt ?? freezeReceipt({
            accepted: false,
            code: WAVE_SETTLEMENT_RESULT_CODE.WRONG_PHASE,
            transactionId: record.transactionId,
            fingerprint: record.fingerprint,
            stage: record.stage
        });
        const published = replayed
            ? freezeReceipt({ ...source, replayed: true })
            : source;
        record.lastReceipt = published;
        this.lastReceipt = published;
        return published;
    }

    #createDetachedReceipt(code, extra = {}) {
        const receipt = freezeReceipt({
            accepted: code === WAVE_SETTLEMENT_RESULT_CODE.OPEN_REQUESTED
                || code === WAVE_SETTLEMENT_RESULT_CODE.OPEN_DEFERRED
                || code === WAVE_SETTLEMENT_RESULT_CODE.OPENED,
            code,
            transactionId: extra.transactionId ?? null,
            mutationCount: 0,
            ...extra
        });
        this.lastReceipt = receipt;
        return receipt;
    }
}
