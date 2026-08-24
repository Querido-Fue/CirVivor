import { fingerprintR8Record } from '../contract/r8_fingerprint_contract.js';
import {
    getWaveRunPlanFingerprint,
    getWaveRunPlanWaveMetadata
} from '../contract/wave_run_plan_contract.js';
import {
    WAVE_RUN_FACT_TYPE,
    WAVE_RUN_RESULT_CODE,
    WAVE_RUN_STATE,
    WAVE_RUN_TERMINAL_STATES
} from '../contract/wave_run_state_contract.js';
import {
    createWaveClearProof,
    getWaveQuiescenceSnapshotFingerprint
} from '../contract/wave_quiescence_contract.js';

const UINT32_MAX = 0xffff_ffff;
const DEFAULT_FACT_HISTORY_CAPACITY = 128;
const DEFAULT_TRANSACTION_HISTORY_CAPACITY = 256;
const COMBAT_CLOCK_STATES = new Set([
    WAVE_RUN_STATE.WAVE_ACTIVE,
    WAVE_RUN_STATE.DEADLINE_SPAWN_DRAIN,
    WAVE_RUN_STATE.OVERTIME
]);
const CLEAR_SOURCE_STATES = new Set([
    WAVE_RUN_STATE.WAVE_ACTIVE,
    WAVE_RUN_STATE.DEADLINE_SPAWN_DRAIN,
    WAVE_RUN_STATE.OVERTIME
]);
const TERMINAL_STATES = new Set(WAVE_RUN_TERMINAL_STATES);

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

function requireBoolean(value, label) {
    if (typeof value !== 'boolean') {
        throw new TypeError(`${label}은 boolean이어야 합니다.`);
    }
    return value;
}

function requireUint32(value, label) {
    if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
        throw new RangeError(`${label}은 uint32여야 합니다.`);
    }
    return value;
}

function requirePositiveCapacity(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 4_096) {
        throw new RangeError(`${label}은 1..4096 범위여야 합니다.`);
    }
    return value;
}

function checkedUint32Sum(left, right, label) {
    const result = left + right;
    if (!Number.isSafeInteger(result) || result > UINT32_MAX) {
        throw new RangeError(`${label}이 uint32 범위를 벗어났습니다.`);
    }
    return result;
}

function freezeDetails(details = {}) {
    const frozen = {};
    for (const [key, value] of Object.entries(details)) {
        if (Array.isArray(value)) {
            frozen[key] = Object.freeze([...value]);
        } else if (value && typeof value === 'object') {
            frozen[key] = Object.freeze({ ...value });
        } else {
            frozen[key] = value;
        }
    }
    return Object.freeze(frozen);
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
        const start = (this.nextIndex - this.size + this.capacity) % this.capacity;
        for (let index = 0; index < this.size; index++) {
            result[index] = this.entries[(start + index) % this.capacity];
        }
        return Object.freeze(result);
    }
}

export class WaveRunCoordinator {
    constructor(options = {}) {
        const normalizedOptions = requireRecord(options, 'WaveRunCoordinator options');
        this.plan = normalizedOptions.plan;
        this.planFingerprint = getWaveRunPlanFingerprint(this.plan);
        this.runSessionId = requireNonEmptyString(
            normalizedOptions.runSessionId,
            'runSessionId'
        );
        this.factJournal = new BoundedRingJournal(requirePositiveCapacity(
            normalizedOptions.factHistoryCapacity ?? DEFAULT_FACT_HISTORY_CAPACITY,
            'factHistoryCapacity'
        ));
        this.transactionHistoryCapacity = requirePositiveCapacity(
            normalizedOptions.transactionHistoryCapacity
                ?? DEFAULT_TRANSACTION_HISTORY_CAPACITY,
            'transactionHistoryCapacity'
        );
        this.transactionRecords = new Map();
        this.transactionOrder = new Array(this.transactionHistoryCapacity);
        this.transactionNextIndex = 0;
        this.transactionSize = 0;
        this.state = WAVE_RUN_STATE.INACTIVE;
        this.started = false;
        this.currentWaveOrdinal = 0;
        this.currentWaveMetadata = null;
        this.preparedNextWave = false;
        this.waveAttemptOrdinal = 0;
        this.waveStartFixedTick = 0;
        this.elapsedCombatTicks = 0;
        this.deadlineFixedTick = 0;
        this.deadlineReached = false;
        this.overtimeStarted = false;
        this.firstPulseFixedTick = 0;
        this.overtimeStartedFact = null;
        this.clearProofFingerprint = 0;
        this.completionRevision = 0;
        this.factRevision = 0;
        this.destroyed = false;
    }

    startPlan(request = {}) {
        const source = requireRecord(request, 'startPlan request');
        const canonical = {
            runSessionId: source.runSessionId,
            planId: source.planId,
            planFingerprint: source.planFingerprint ?? this.planFingerprint
        };
        return this.#transact('start-plan', source, canonical, () => {
            const sourceCode = this.#validatePlanSource(source);
            if (sourceCode) return { code: sourceCode };
            if (this.started || this.state !== WAVE_RUN_STATE.INACTIVE) {
                return { code: WAVE_RUN_RESULT_CODE.WRONG_PHASE };
            }
            this.started = true;
            return {
                code: WAVE_RUN_RESULT_CODE.ACCEPTED,
                details: {
                    planId: this.plan.planId,
                    waveCount: this.plan.waves.length
                }
            };
        });
    }

    beginWave(request = {}) {
        const source = requireRecord(request, 'beginWave request');
        const canonical = {
            runSessionId: source.runSessionId,
            planId: source.planId,
            waveOrdinal: source.waveOrdinal,
            waveId: source.waveId,
            startingFixedTick: source.startingFixedTick
        };
        return this.#transact('begin-wave', source, canonical, () => {
            const sourceCode = this.#validatePlanSource(source);
            if (sourceCode) return { code: sourceCode };
            const waveOrdinal = requireUint32(source.waveOrdinal, 'waveOrdinal');
            const startingFixedTick = requireUint32(
                source.startingFixedTick,
                'startingFixedTick'
            );
            const expectedOrdinal = this.currentWaveOrdinal === 0
                ? 1
                : this.currentWaveOrdinal + 1;
            const initialBegin = this.started
                && this.state === WAVE_RUN_STATE.INACTIVE
                && this.currentWaveOrdinal === 0;
            const nextBegin = this.state === WAVE_RUN_STATE.NEXT_WAVE_PREPARE
                && this.preparedNextWave;
            if ((!initialBegin && !nextBegin) || waveOrdinal !== expectedOrdinal) {
                return { code: WAVE_RUN_RESULT_CODE.WRONG_PHASE };
            }
            if (waveOrdinal < 1 || waveOrdinal > this.plan.waves.length) {
                return { code: WAVE_RUN_RESULT_CODE.SOURCE_CHANGED };
            }
            const metadata = getWaveRunPlanWaveMetadata(this.plan, waveOrdinal);
            if (source.waveId !== metadata.waveId) {
                return { code: WAVE_RUN_RESULT_CODE.SOURCE_CHANGED };
            }
            const deadlineFixedTick = checkedUint32Sum(
                startingFixedTick,
                metadata.resolutionProfile.combatDurationTicks,
                'deadlineFixedTick'
            );
            this.currentWaveOrdinal = waveOrdinal;
            this.currentWaveMetadata = metadata;
            this.preparedNextWave = false;
            this.waveAttemptOrdinal = 1;
            this.waveStartFixedTick = startingFixedTick;
            this.elapsedCombatTicks = 0;
            this.deadlineFixedTick = deadlineFixedTick;
            this.deadlineReached = false;
            this.overtimeStarted = false;
            this.firstPulseFixedTick = 0;
            this.overtimeStartedFact = null;
            this.clearProofFingerprint = 0;
            this.state = WAVE_RUN_STATE.WAVE_ACTIVE;
            const fact = this.#appendFact({
                type: WAVE_RUN_FACT_TYPE.WAVE_STARTED,
                runSessionId: this.runSessionId,
                planId: this.plan.planId,
                mapId: this.plan.mapId,
                waveId: metadata.waveId,
                waveOrdinal,
                waveAttemptOrdinal: this.waveAttemptOrdinal,
                startingFixedTick,
                combatDurationTicks:
                    metadata.resolutionProfile.combatDurationTicks,
                resolutionProfileId:
                    this.plan.waves[waveOrdinal - 1].resolutionProfileId
            });
            return {
                code: WAVE_RUN_RESULT_CODE.ACCEPTED,
                facts: [fact],
                details: { deadlineFixedTick }
            };
        });
    }

    observeClockTick(request = {}) {
        const source = requireRecord(request, 'observeClockTick request');
        const canonical = {
            runSessionId: source.runSessionId,
            planId: source.planId,
            waveOrdinal: source.waveOrdinal,
            waveId: source.waveId,
            proposedElapsedCombatTicks: source.proposedElapsedCombatTicks,
            completedFixedTick: source.completedFixedTick
        };
        return this.#transact('observe-clock-tick', source, canonical, () => {
            const sourceCode = this.#validateWaveSource(source);
            if (sourceCode) return { code: sourceCode };
            const proposedElapsedCombatTicks = requireUint32(
                source.proposedElapsedCombatTicks,
                'proposedElapsedCombatTicks'
            );
            const completedFixedTick = requireUint32(
                source.completedFixedTick,
                'completedFixedTick'
            );
            if (!COMBAT_CLOCK_STATES.has(this.state)) {
                return {
                    code: TERMINAL_STATES.has(this.state)
                        ? this.#terminalResultCode()
                        : WAVE_RUN_RESULT_CODE.WRONG_PHASE
                };
            }
            if (source.intentionalPause === true || source.completed !== true) {
                return {
                    code: WAVE_RUN_RESULT_CODE.DEFERRED,
                    details: { elapsedCombatTicks: this.elapsedCombatTicks }
                };
            }
            requireBoolean(source.intentionalPause, 'intentionalPause');
            requireBoolean(source.completed, 'completed');
            const expectedElapsed = this.elapsedCombatTicks + 1;
            if (proposedElapsedCombatTicks < expectedElapsed) {
                return {
                    code: WAVE_RUN_RESULT_CODE.DEFERRED,
                    details: { elapsedCombatTicks: this.elapsedCombatTicks }
                };
            }
            if (proposedElapsedCombatTicks !== expectedElapsed
                || completedFixedTick !== checkedUint32Sum(
                    this.waveStartFixedTick,
                    proposedElapsedCombatTicks,
                    'completedFixedTick'
                )) {
                return { code: WAVE_RUN_RESULT_CODE.SOURCE_CHANGED };
            }
            this.elapsedCombatTicks = proposedElapsedCombatTicks;
            const facts = [];
            const combatDurationTicks
                = this.currentWaveMetadata.resolutionProfile.combatDurationTicks;
            if (!this.deadlineReached
                && this.elapsedCombatTicks >= combatDurationTicks) {
                this.deadlineReached = true;
                facts.push(this.#appendFact({
                    type: WAVE_RUN_FACT_TYPE.WAVE_DEADLINE_REACHED,
                    runSessionId: this.runSessionId,
                    mapId: this.plan.mapId,
                    waveId: this.currentWaveMetadata.waveId,
                    waveOrdinal: this.currentWaveOrdinal,
                    waveAttemptOrdinal: this.waveAttemptOrdinal,
                    elapsedCombatTicks: this.elapsedCombatTicks,
                    deadlineFixedTick: this.deadlineFixedTick,
                    observedFixedTick: completedFixedTick
                }));
            }
            return {
                code: WAVE_RUN_RESULT_CODE.ACCEPTED,
                facts,
                details: {
                    elapsedCombatTicks: this.elapsedCombatTicks,
                    deadlineReached: this.deadlineReached
                }
            };
        });
    }

    observeDeadline(request = {}) {
        const source = requireRecord(request, 'observeDeadline request');
        return this.#observeExactQuiescence(
            'observe-deadline',
            source,
            true
        );
    }

    prepareClearCandidate(request = {}) {
        const source = requireRecord(request, 'prepareClearCandidate request');
        return this.#observeExactQuiescence(
            'prepare-clear-candidate',
            source,
            false
        );
    }

    observeWaveQuiescence(request = {}) {
        const source = requireRecord(request, 'observeWaveQuiescence request');
        return this.#observeExactQuiescence(
            'observe-wave-quiescence',
            source,
            false
        );
    }

    /** GameObjectSystem의 narrow evaluator port와 직접 호환됩니다. */
    evaluateWaveQuiescence(snapshot) {
        const snapshotFingerprint
            = getWaveQuiescenceSnapshotFingerprint(snapshot);
        const result = this.observeWaveQuiescence({
            transactionId: `wave-quiescence:${snapshotFingerprint}`,
            snapshot
        });
        return Object.freeze({
            accepted: result.accepted,
            clearCandidateAccepted: result.accepted
                && result.state === WAVE_RUN_STATE.CLEAR_CANDIDATE,
            recoveryRequired: result.code
                === WAVE_RUN_RESULT_CODE.SOURCE_CHANGED
                || result.code === WAVE_RUN_RESULT_CODE.TRANSACTION_CONFLICT,
            code: result.code,
            state: result.state,
            facts: result.facts,
            transactionFingerprint: result.transactionFingerprint
        });
    }

    prepareSettlement(request = {}) {
        const source = requireRecord(request, 'prepareSettlement request');
        const canonical = {
            runSessionId: source.runSessionId,
            planId: source.planId,
            waveOrdinal: source.waveOrdinal,
            waveId: source.waveId,
            clearProofFingerprint: source.clearProofFingerprint,
            completionRevision: source.completionRevision
        };
        return this.#transact('prepare-settlement', source, canonical, () => {
            const sourceCode = this.#validateWaveSource(source);
            if (sourceCode) return { code: sourceCode };
            if (this.state !== WAVE_RUN_STATE.CLEAR_CANDIDATE) {
                return { code: WAVE_RUN_RESULT_CODE.WRONG_PHASE };
            }
            const clearProofFingerprint = requireUint32(
                source.clearProofFingerprint,
                'clearProofFingerprint'
            );
            const completionRevision = requireUint32(
                source.completionRevision,
                'completionRevision'
            );
            if (clearProofFingerprint !== this.clearProofFingerprint
                || completionRevision === 0
                || completionRevision < this.completionRevision) {
                return { code: WAVE_RUN_RESULT_CODE.SOURCE_CHANGED };
            }
            this.completionRevision = completionRevision;
            this.state = WAVE_RUN_STATE.SETTLEMENT_PENDING;
            const fact = this.#appendFact({
                type: WAVE_RUN_FACT_TYPE.WAVE_COMPLETED,
                runSessionId: this.runSessionId,
                mapId: this.plan.mapId,
                waveId: this.currentWaveMetadata.waveId,
                waveOrdinal: this.currentWaveOrdinal,
                waveAttemptOrdinal: this.waveAttemptOrdinal,
                completionRevision,
                clearProofFingerprint,
                elapsedCombatTicks: this.elapsedCombatTicks,
                completedInOvertime: this.overtimeStarted
            });
            return {
                code: WAVE_RUN_RESULT_CODE.ACCEPTED,
                facts: [fact],
                details: {
                    completionRevision,
                    completionGoldBonus: this.currentWaveMetadata
                        .resolutionProfile.settlement.completionGoldBonus,
                    openShop: true
                }
            };
        });
    }

    observeShopOpened(request = {}) {
        const source = requireRecord(request, 'observeShopOpened request');
        const canonical = {
            runSessionId: source.runSessionId,
            planId: source.planId,
            waveOrdinal: source.waveOrdinal,
            waveId: source.waveId,
            shopSessionId: source.shopSessionId,
            completionRevision: source.completionRevision
        };
        return this.#transact('observe-shop-opened', source, canonical, () => {
            const sourceCode = this.#validateWaveSource(source);
            if (sourceCode) return { code: sourceCode };
            if (this.state !== WAVE_RUN_STATE.SETTLEMENT_PENDING
                && this.state !== WAVE_RUN_STATE.SHOP_OPENING) {
                return { code: WAVE_RUN_RESULT_CODE.WRONG_PHASE };
            }
            if (source.completionRevision !== this.completionRevision) {
                return { code: WAVE_RUN_RESULT_CODE.SOURCE_CHANGED };
            }
            requireNonEmptyString(source.shopSessionId, 'shopSessionId');
            this.state = WAVE_RUN_STATE.SHOP_OPENING;
            if (source.shopReady !== true) {
                return { code: WAVE_RUN_RESULT_CODE.SHOP_NOT_READY };
            }
            requireBoolean(source.shopReady, 'shopReady');
            this.state = WAVE_RUN_STATE.SHOP;
            return {
                code: WAVE_RUN_RESULT_CODE.ACCEPTED,
                details: { shopSessionId: source.shopSessionId }
            };
        });
    }

    observeShopContinue(request = {}) {
        const source = requireRecord(request, 'observeShopContinue request');
        const canonical = {
            runSessionId: source.runSessionId,
            planId: source.planId,
            waveOrdinal: source.waveOrdinal,
            waveId: source.waveId,
            continueReceiptId: source.continueReceiptId,
            completionRevision: source.completionRevision
        };
        return this.#transact('observe-shop-continue', source, canonical, () => {
            const sourceCode = this.#validateWaveSource(source);
            if (sourceCode) return { code: sourceCode };
            if (this.state !== WAVE_RUN_STATE.SHOP) {
                return { code: WAVE_RUN_RESULT_CODE.WRONG_PHASE };
            }
            requireNonEmptyString(source.continueReceiptId, 'continueReceiptId');
            if (source.completionRevision !== this.completionRevision) {
                return { code: WAVE_RUN_RESULT_CODE.SOURCE_CHANGED };
            }
            if (source.authentic !== true) {
                return { code: WAVE_RUN_RESULT_CODE.SHOP_NOT_READY };
            }
            requireBoolean(source.authentic, 'authentic');
            if (this.currentWaveOrdinal < this.plan.waves.length) {
                this.state = WAVE_RUN_STATE.NEXT_WAVE_PREPARE;
                this.preparedNextWave = false;
                const nextOrdinal = this.currentWaveOrdinal + 1;
                const nextMetadata = getWaveRunPlanWaveMetadata(this.plan, nextOrdinal);
                return {
                    code: WAVE_RUN_RESULT_CODE.ACCEPTED,
                    details: {
                        nextWaveOrdinal: nextOrdinal,
                        nextWaveId: nextMetadata.waveId
                    }
                };
            }
            this.state = WAVE_RUN_STATE.MAP_CLEAR_READY;
            const fact = this.#appendFact({
                type: WAVE_RUN_FACT_TYPE.MAP_CLEAR_READY,
                runSessionId: this.runSessionId,
                planId: this.plan.planId,
                mapId: this.plan.mapId,
                waveId: this.currentWaveMetadata.waveId,
                waveOrdinal: this.currentWaveOrdinal,
                completionRevision: this.completionRevision,
                finalContinueResult: this.plan.finalContinueResult
            });
            return {
                code: WAVE_RUN_RESULT_CODE.ACCEPTED,
                facts: [fact],
                details: { finalContinueResult: this.plan.finalContinueResult }
            };
        });
    }

    prepareNextWave(request = {}) {
        const source = requireRecord(request, 'prepareNextWave request');
        const canonical = {
            runSessionId: source.runSessionId,
            planId: source.planId,
            completedWaveOrdinal: source.completedWaveOrdinal,
            completedWaveId: source.completedWaveId,
            nextWaveOrdinal: source.nextWaveOrdinal,
            nextWaveId: source.nextWaveId,
            completionRevision: source.completionRevision
        };
        return this.#transact('prepare-next-wave', source, canonical, () => {
            const sourceCode = this.#validatePlanSource(source);
            if (sourceCode) return { code: sourceCode };
            if (this.state !== WAVE_RUN_STATE.NEXT_WAVE_PREPARE
                || this.preparedNextWave) {
                return { code: WAVE_RUN_RESULT_CODE.WRONG_PHASE };
            }
            if (source.completedWaveOrdinal !== this.currentWaveOrdinal
                || source.completedWaveId !== this.currentWaveMetadata.waveId
                || source.completionRevision !== this.completionRevision) {
                return { code: WAVE_RUN_RESULT_CODE.SOURCE_CHANGED };
            }
            const nextWaveOrdinal = this.currentWaveOrdinal + 1;
            if (nextWaveOrdinal > this.plan.waves.length
                || source.nextWaveOrdinal !== nextWaveOrdinal) {
                return { code: WAVE_RUN_RESULT_CODE.SOURCE_CHANGED };
            }
            const nextMetadata = getWaveRunPlanWaveMetadata(
                this.plan,
                nextWaveOrdinal
            );
            if (source.nextWaveId !== nextMetadata.waveId) {
                return { code: WAVE_RUN_RESULT_CODE.SOURCE_CHANGED };
            }
            this.preparedNextWave = true;
            const fact = this.#appendFact({
                type: WAVE_RUN_FACT_TYPE.NEXT_WAVE_READY,
                runSessionId: this.runSessionId,
                planId: this.plan.planId,
                mapId: this.plan.mapId,
                completedWaveOrdinal: this.currentWaveOrdinal,
                completedWaveId: this.currentWaveMetadata.waveId,
                nextWaveOrdinal,
                nextWaveId: nextMetadata.waveId,
                completionRevision: this.completionRevision
            });
            return {
                code: WAVE_RUN_RESULT_CODE.ACCEPTED,
                facts: [fact],
                details: { nextWaveOrdinal, nextWaveId: nextMetadata.waveId }
            };
        });
    }

    transitionToDefeated(request = {}) {
        const source = requireRecord(request, 'transitionToDefeated request');
        const canonical = {
            runSessionId: source.runSessionId,
            planId: source.planId,
            waveOrdinal: source.waveOrdinal,
            waveId: source.waveId,
            defeatRevision: source.defeatRevision,
            cause: source.cause
        };
        return this.#transact('transition-to-defeated', source, canonical, () => {
            if (this.state === WAVE_RUN_STATE.RUN_DEFEATED) {
                return { code: WAVE_RUN_RESULT_CODE.RUN_DEFEATED };
            }
            const sourceCode = this.#validateWaveSource(source);
            if (sourceCode) return { code: sourceCode };
            if (this.state === WAVE_RUN_STATE.MAP_CLEAR_READY) {
                return { code: WAVE_RUN_RESULT_CODE.WRONG_PHASE };
            }
            const defeatRevision = requireUint32(
                source.defeatRevision,
                'defeatRevision'
            );
            if (defeatRevision === 0) {
                return { code: WAVE_RUN_RESULT_CODE.SOURCE_CHANGED };
            }
            const cause = requireNonEmptyString(source.cause, 'cause');
            this.state = WAVE_RUN_STATE.RUN_DEFEATED;
            const fact = this.#appendFact({
                type: WAVE_RUN_FACT_TYPE.WAVE_FAILED,
                runSessionId: this.runSessionId,
                planId: this.plan.planId,
                mapId: this.plan.mapId,
                waveId: this.currentWaveMetadata.waveId,
                waveOrdinal: this.currentWaveOrdinal,
                waveAttemptOrdinal: this.waveAttemptOrdinal,
                defeatRevision,
                cause
            });
            return {
                code: WAVE_RUN_RESULT_CODE.ACCEPTED,
                facts: [fact],
                details: { defeatRevision, cause }
            };
        });
    }

    getFacts() {
        return this.factJournal.snapshot();
    }

    /** CoreOvertimePressureDirector가 per-tick journal scan 없이 읽는 bounded port입니다. */
    getOvertimePressureView() {
        const metadata = this.currentWaveMetadata;
        return Object.freeze({
            runSessionId: this.runSessionId,
            planId: this.plan.planId,
            mapId: this.plan.mapId,
            state: this.state,
            waveId: metadata?.waveId ?? null,
            waveOrdinal: this.currentWaveOrdinal,
            waveAttemptOrdinal: this.waveAttemptOrdinal,
            deadlineFixedTick: this.deadlineFixedTick,
            overtimeStarted: this.overtimeStarted,
            firstPulseFixedTick: this.firstPulseFixedTick,
            overtimeStartedFact: this.overtimeStartedFact,
            resolutionProfile: metadata?.resolutionProfile ?? null,
            destroyed: this.destroyed
        });
    }

    /** WaveSettlementCoordinator가 mutable plan 배열 없이 읽는 O(1) authority view입니다. */
    getSettlementView() {
        const metadata = this.currentWaveMetadata;
        let nextProgression = null;
        if (metadata) {
            if (this.currentWaveOrdinal < this.plan.waves.length) {
                const nextMetadata = getWaveRunPlanWaveMetadata(
                    this.plan,
                    this.currentWaveOrdinal + 1
                );
                nextProgression = Object.freeze({
                    type: 'NEXT_WAVE',
                    waveOrdinal: this.currentWaveOrdinal + 1,
                    waveId: nextMetadata.waveId,
                    resolutionProfileId: this.plan.waves[
                        this.currentWaveOrdinal
                    ].resolutionProfileId
                });
            } else {
                nextProgression = Object.freeze({
                    type: WAVE_RUN_STATE.MAP_CLEAR_READY,
                    finalContinueResult: this.plan.finalContinueResult
                });
            }
        }
        return Object.freeze({
            runSessionId: this.runSessionId,
            planId: this.plan.planId,
            planFingerprint: this.planFingerprint,
            mapId: this.plan.mapId,
            state: this.state,
            waveCount: this.plan.waves.length,
            waveId: metadata?.waveId ?? null,
            waveOrdinal: this.currentWaveOrdinal,
            waveAttemptOrdinal: this.waveAttemptOrdinal,
            resolutionProfileId: this.currentWaveOrdinal > 0
                ? this.plan.waves[
                    this.currentWaveOrdinal - 1
                ].resolutionProfileId
                : null,
            clearProofFingerprint: this.clearProofFingerprint,
            completionRevision: this.completionRevision,
            completedInOvertime: this.overtimeStarted,
            overtimeStarted: this.overtimeStarted,
            elapsedCombatTicks: this.elapsedCombatTicks,
            completionGoldBonus:
                metadata?.resolutionProfile.settlement.completionGoldBonus ?? 0,
            shopAfterEveryWave: this.plan.shopAfterEveryWave,
            nextProgression,
            destroyed: this.destroyed
        });
    }

    getStatus() {
        const metadata = this.currentWaveMetadata;
        return Object.freeze({
            runSessionId: this.runSessionId,
            planId: this.plan.planId,
            planFingerprint: this.planFingerprint,
            mapId: this.plan.mapId,
            state: this.state,
            started: this.started,
            waveCount: this.plan.waves.length,
            currentWaveOrdinal: this.currentWaveOrdinal,
            currentWaveId: metadata?.waveId ?? null,
            currentResolutionProfileId: this.currentWaveOrdinal > 0
                ? this.plan.waves[this.currentWaveOrdinal - 1].resolutionProfileId
                : null,
            waveAttemptOrdinal: this.waveAttemptOrdinal,
            waveStartFixedTick: this.waveStartFixedTick,
            elapsedCombatTicks: this.elapsedCombatTicks,
            combatDurationTicks:
                metadata?.resolutionProfile.combatDurationTicks ?? 0,
            deadlineFixedTick: this.deadlineFixedTick,
            deadlineReached: this.deadlineReached,
            overtimeStarted: this.overtimeStarted,
            firstPulseFixedTick: this.firstPulseFixedTick,
            overtimeStartedFact: this.overtimeStartedFact,
            preparedNextWave: this.preparedNextWave,
            clearProofFingerprint: this.clearProofFingerprint,
            completionRevision: this.completionRevision,
            factRevision: this.factRevision,
            facts: this.getFacts(),
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.state = WAVE_RUN_STATE.DESTROYED;
        this.transactionRecords.clear();
        this.transactionOrder.fill(undefined);
        this.transactionSize = 0;
    }

    #observeExactQuiescence(action, source, deadlineRequired) {
        const snapshot = source.snapshot;
        const snapshotFingerprint
            = getWaveQuiescenceSnapshotFingerprint(snapshot);
        const canonical = {
            runSessionId: this.runSessionId,
            planId: this.plan.planId,
            mapId: snapshot.wave.mapId,
            waveOrdinal: snapshot.wave.waveOrdinal,
            waveId: snapshot.wave.waveId,
            snapshotFingerprint
        };
        return this.#transact(action, source, canonical, () => {
            if (!this.currentWaveMetadata
                || snapshot.wave.mapId !== this.plan.mapId
                || snapshot.wave.waveOrdinal !== this.currentWaveOrdinal
                || snapshot.wave.waveId !== this.currentWaveMetadata.waveId) {
                return { code: WAVE_RUN_RESULT_CODE.SOURCE_CHANGED };
            }
            if (!CLEAR_SOURCE_STATES.has(this.state)) {
                return {
                    code: TERMINAL_STATES.has(this.state)
                        ? this.#terminalResultCode()
                        : WAVE_RUN_RESULT_CODE.WRONG_PHASE
                };
            }
            if (deadlineRequired && !this.deadlineReached) {
                return { code: WAVE_RUN_RESULT_CODE.WRONG_PHASE };
            }
            const proofResult = createWaveClearProof(snapshot);
            if (proofResult.accepted) {
                return this.#acceptExactClearProof(proofResult.proof);
            }
            if (!snapshot.run.running
                || snapshot.run.defeated
                || snapshot.run.coreDepleted) {
                return {
                    code: snapshot.run.defeated || snapshot.run.coreDepleted
                        ? WAVE_RUN_RESULT_CODE.RUN_DEFEATED
                        : WAVE_RUN_RESULT_CODE.QUIESCENCE_NOT_PROVEN,
                    details: { blockers: proofResult.blockers }
                };
            }
            if (snapshot.run.recoveryRequired) {
                return {
                    code: WAVE_RUN_RESULT_CODE.QUIESCENCE_NOT_PROVEN,
                    details: { blockers: proofResult.blockers }
                };
            }
            if (!this.deadlineReached) {
                return {
                    code: WAVE_RUN_RESULT_CODE.QUIESCENCE_NOT_PROVEN,
                    details: { blockers: proofResult.blockers }
                };
            }
            const spawnDrained = snapshot.wave.allSpawnsQueued
                && snapshot.wave.remainingSpawnCount === 0
                && snapshot.wave.blockedSpawnCount === 0
                && snapshot.pending.hostileProducerCount === 0;
            if (!spawnDrained) {
                this.state = WAVE_RUN_STATE.DEADLINE_SPAWN_DRAIN;
                return {
                    code: WAVE_RUN_RESULT_CODE.ACCEPTED,
                    details: {
                        spawnDrainPending: true,
                        blockers: proofResult.blockers
                    }
                };
            }
            if (snapshot.hostile.hostileActorCount > 0) {
                return this.#enterOvertime(snapshot);
            }
            return {
                code: WAVE_RUN_RESULT_CODE.QUIESCENCE_NOT_PROVEN,
                details: { blockers: proofResult.blockers }
            };
        });
    }

    #acceptExactClearProof(proof) {
        const clearProofFingerprint = proof.proofFingerprint;
        const completionRevision = proof.completionRevision;
        this.clearProofFingerprint = clearProofFingerprint;
        this.completionRevision = Math.max(
            this.completionRevision,
            completionRevision - 1
        );
        this.state = WAVE_RUN_STATE.CLEAR_CANDIDATE;
        return {
            code: WAVE_RUN_RESULT_CODE.ACCEPTED,
            details: { clearProofFingerprint, completionRevision }
        };
    }

    #enterOvertime(snapshot) {
        const profile = this.currentWaveMetadata.resolutionProfile;
        if (!profile.overtime.enabled) {
            return { code: WAVE_RUN_RESULT_CODE.DEFERRED };
        }
        if (this.state === WAVE_RUN_STATE.OVERTIME) {
            return {
                code: WAVE_RUN_RESULT_CODE.QUIESCENCE_NOT_PROVEN
            };
        }
        this.state = WAVE_RUN_STATE.OVERTIME;
        this.overtimeStarted = true;
        const firstPulseFixedTick = checkedUint32Sum(
            this.deadlineFixedTick,
            profile.overtime.graceTicks,
            'first overtime pulse fixed tick'
        );
        this.firstPulseFixedTick = firstPulseFixedTick;
        const fact = this.#appendFact({
            type: WAVE_RUN_FACT_TYPE.OVERTIME_STARTED,
            runSessionId: this.runSessionId,
            mapId: this.plan.mapId,
            waveId: this.currentWaveMetadata.waveId,
            waveOrdinal: this.currentWaveOrdinal,
            waveAttemptOrdinal: this.waveAttemptOrdinal,
            deadlineFixedTick: this.deadlineFixedTick,
            firstPulseFixedTick,
            hostileActorCount: snapshot.hostile.hostileActorCount,
            hostileSnapshotRevision: snapshot.hostile.revision
        });
        this.overtimeStartedFact = fact;
        return {
            code: WAVE_RUN_RESULT_CODE.ACCEPTED,
            facts: [fact],
            details: { firstPulseFixedTick }
        };
    }

    #validatePlanSource(source) {
        if (source.runSessionId !== this.runSessionId
            || source.planId !== this.plan.planId
            || (source.planFingerprint !== undefined
                && source.planFingerprint !== this.planFingerprint)) {
            return WAVE_RUN_RESULT_CODE.SOURCE_CHANGED;
        }
        return null;
    }

    #validateWaveSource(source) {
        const planCode = this.#validatePlanSource(source);
        if (planCode) return planCode;
        if (!this.currentWaveMetadata
            || source.waveOrdinal !== this.currentWaveOrdinal
            || source.waveId !== this.currentWaveMetadata.waveId) {
            return WAVE_RUN_RESULT_CODE.SOURCE_CHANGED;
        }
        return null;
    }

    #terminalResultCode() {
        if (this.state === WAVE_RUN_STATE.RUN_DEFEATED) {
            return WAVE_RUN_RESULT_CODE.RUN_DEFEATED;
        }
        if (this.state === WAVE_RUN_STATE.DESTROYED) {
            return WAVE_RUN_RESULT_CODE.DESTROYED;
        }
        return WAVE_RUN_RESULT_CODE.WRONG_PHASE;
    }

    #appendFact(fields) {
        const fact = Object.freeze({
            ...fields,
            factRevision: ++this.factRevision
        });
        this.factJournal.append(fact);
        return fact;
    }

    #createResult(code, transactionId, transactionFingerprint, outcome = {}) {
        return Object.freeze({
            accepted: code === WAVE_RUN_RESULT_CODE.ACCEPTED,
            code,
            replayed: outcome.replayed === true,
            transactionId,
            transactionFingerprint,
            state: this.state,
            facts: Object.freeze([...(outcome.facts ?? [])]),
            details: freezeDetails(outcome.details)
        });
    }

    #transact(action, request, canonical, mutate) {
        const transactionId = requireNonEmptyString(
            request.transactionId,
            `${action}.transactionId`
        );
        const transactionFingerprint = fingerprintR8Record(
            'r9-wave-run-transaction',
            { action, ...canonical },
            transactionId
        );
        const previous = this.transactionRecords.get(transactionId);
        if (previous) {
            if (previous.fingerprint !== transactionFingerprint) {
                return this.#createResult(
                    WAVE_RUN_RESULT_CODE.TRANSACTION_CONFLICT,
                    transactionId,
                    transactionFingerprint
                );
            }
            return this.#createResult(
                previous.result.code,
                transactionId,
                transactionFingerprint,
                { replayed: true, details: previous.result.details }
            );
        }
        if (this.destroyed) {
            return this.#createResult(
                WAVE_RUN_RESULT_CODE.DESTROYED,
                transactionId,
                transactionFingerprint
            );
        }
        const outcome = mutate();
        const result = this.#createResult(
            outcome.code,
            transactionId,
            transactionFingerprint,
            outcome
        );
        if (outcome.code === WAVE_RUN_RESULT_CODE.ACCEPTED) {
            this.#rememberTransaction(transactionId, transactionFingerprint, result);
        }
        return result;
    }

    #rememberTransaction(transactionId, fingerprint, result) {
        if (this.transactionSize === this.transactionHistoryCapacity) {
            const evictedId = this.transactionOrder[this.transactionNextIndex];
            this.transactionRecords.delete(evictedId);
        } else {
            this.transactionSize++;
        }
        this.transactionOrder[this.transactionNextIndex] = transactionId;
        this.transactionNextIndex = (
            this.transactionNextIndex + 1
        ) % this.transactionHistoryCapacity;
        this.transactionRecords.set(transactionId, Object.freeze({
            fingerprint,
            result
        }));
    }
}
