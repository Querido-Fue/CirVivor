import { assertCoreIntegrity } from '../contract/core_integrity_contract.js';
import { fingerprintR8Record } from '../contract/r8_fingerprint_contract.js';
import { assertRunOutcome } from '../contract/run_outcome_contract.js';
import {
    WAVE_OVERTIME_DAMAGE_BASIS,
    WAVE_RESOLUTION_FIXED_POINT_SCALE
} from '../contract/wave_resolution_contract.js';
import {
    getWaveQuiescenceSnapshotFingerprint
} from '../contract/wave_quiescence_contract.js';
import {
    WAVE_RUN_FACT_TYPE,
    WAVE_RUN_RESULT_CODE,
    WAVE_RUN_STATE
} from '../contract/wave_run_state_contract.js';

const UINT32_MAX = 0xffff_ffff;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const DEFAULT_FACT_CAPACITY = 128;
const DEFAULT_TRANSACTION_CAPACITY = 256;

export const CORE_OVERTIME_PRESSURE_FACT_TYPE = Object.freeze({
    OVERTIME_STARTED: WAVE_RUN_FACT_TYPE.OVERTIME_STARTED,
    OVERTIME_PULSE: WAVE_RUN_FACT_TYPE.OVERTIME_PULSE,
    CORE_DAMAGED: 'CoreDamaged',
    CORE_DEPLETED: 'CoreDepleted',
    RUN_FAILED: 'RunFailed',
    WAVE_FAILED: WAVE_RUN_FACT_TYPE.WAVE_FAILED
});

export const CORE_OVERTIME_PRESSURE_RESULT_CODE = Object.freeze({
    ACCEPTED: 'ACCEPTED',
    DEFERRED: 'DEFERRED',
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

function requireBoolean(value, label) {
    if (typeof value !== 'boolean') {
        throw new TypeError(`${label}은 boolean이어야 합니다.`);
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

function requireNonNegativeFinite(value, label) {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label}은 0 이상의 유한수여야 합니다.`);
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

function powerOfTen(exponent) {
    if (!Number.isSafeInteger(exponent) || exponent < 0 || exponent > 400) {
        throw new RangeError('fixed-point decimal exponent 범위를 벗어났습니다.');
    }
    return 10n ** BigInt(exponent);
}

/**
 * Number의 canonical decimal 문자열을 사용해 binary floating-point 곱셈 없이
 * siegeWeight를 R9 fixed-point로 내림 인코딩합니다.
 */
export function encodeWaveSiegeWeightFixedPoint(siegeWeight) {
    const value = requireNonNegativeFinite(siegeWeight, 'siegeWeight');
    if (value === 0) return 0;
    const [mantissa, exponentText = '0'] = value.toString().toLowerCase().split('e');
    const exponent = Number(exponentText);
    if (!Number.isSafeInteger(exponent)) {
        throw new RangeError('siegeWeight exponent가 안전한 정수가 아닙니다.');
    }
    const decimalIndex = mantissa.indexOf('.');
    const decimalPlaces = decimalIndex < 0
        ? 0
        : mantissa.length - decimalIndex - 1;
    const digits = mantissa.replace('.', '');
    if (!/^\d+$/u.test(digits)) {
        throw new RangeError('siegeWeight decimal 표현을 해석할 수 없습니다.');
    }
    let numerator = BigInt(digits)
        * BigInt(WAVE_RESOLUTION_FIXED_POINT_SCALE);
    const scaleExponent = exponent - decimalPlaces;
    let encoded;
    if (scaleExponent >= 0) {
        encoded = numerator * powerOfTen(scaleExponent);
    } else {
        encoded = numerator / powerOfTen(-scaleExponent);
    }
    if (encoded > MAX_SAFE_BIGINT) {
        throw new RangeError('siegeWeight fixed-point가 안전한 정수 범위를 벗어났습니다.');
    }
    return Number(encoded);
}

function normalizeOvertimeFormula(source) {
    const overtime = requireRecord(source, 'overtime profile');
    if (overtime.damageBasis !== WAVE_OVERTIME_DAMAGE_BASIS.SIEGE_WEIGHT) {
        throw new RangeError('overtime damageBasis는 SIEGE_WEIGHT여야 합니다.');
    }
    const minimumDamageFixedPoint = requireUint32(
        overtime.minimumDamageFixedPoint,
        'minimumDamageFixedPoint'
    );
    const maximumDamageFixedPoint = requireUint32(
        overtime.maximumDamageFixedPoint,
        'maximumDamageFixedPoint'
    );
    if (minimumDamageFixedPoint > maximumDamageFixedPoint) {
        throw new RangeError('overtime minimum damage는 maximum 이하여야 합니다.');
    }
    return Object.freeze({
        minimumDamageFixedPoint,
        maximumDamageFixedPoint,
        damagePerSiegeWeightNumerator: requireUint32(
            overtime.damagePerSiegeWeightNumerator,
            'damagePerSiegeWeightNumerator'
        ),
        damagePerSiegeWeightDenominator: requireUint32(
            overtime.damagePerSiegeWeightDenominator,
            'damagePerSiegeWeightDenominator',
            { positive: true }
        )
    });
}

/** Shared contract의 host reference이며 runtime도 이 함수만 호출합니다. */
export function calculateCoreOvertimeDamageFixedPoint(
    siegeWeight,
    overtimeProfile
) {
    const formula = normalizeOvertimeFormula(overtimeProfile);
    const siegeWeightFixedPoint
        = encodeWaveSiegeWeightFixedPoint(siegeWeight);
    const scaled = BigInt(siegeWeightFixedPoint)
        * BigInt(formula.damagePerSiegeWeightNumerator)
        / BigInt(formula.damagePerSiegeWeightDenominator);
    const minimum = BigInt(formula.minimumDamageFixedPoint);
    const maximum = BigInt(formula.maximumDamageFixedPoint);
    const damageFixedPointBigInt = scaled < minimum
        ? minimum
        : scaled > maximum
            ? maximum
            : scaled;
    const damageFixedPoint = Number(damageFixedPointBigInt);
    return Object.freeze({
        siegeWeight: requireNonNegativeFinite(siegeWeight, 'siegeWeight'),
        siegeWeightFixedPoint,
        scaledDamageFixedPointExact: scaled.toString(),
        damageFixedPoint,
        damage: damageFixedPoint / WAVE_RESOLUTION_FIXED_POINT_SCALE
    });
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

function assertWaveRunCoordinator(coordinator) {
    if (!coordinator
        || typeof coordinator.getOvertimePressureView !== 'function'
        || typeof coordinator.transitionToDefeated !== 'function') {
        throw new TypeError(
            'CoreOvertimePressureDirector에는 WaveRunCoordinator pressure port가 필요합니다.'
        );
    }
    return coordinator;
}

function normalizeHostileEvidence(snapshot, hostileStatus) {
    const status = requireRecord(hostileStatus, 'hostileStatus');
    const revision = requireUint32(status.revision, 'hostileStatus.revision');
    const registryRevision = requireUint32(
        status.registryRevision,
        'hostileStatus.registryRevision'
    );
    const liveHostileActorCount = requireUint32(
        status.liveHostileActorCount,
        'hostileStatus.liveHostileActorCount'
    );
    const pendingHostileActorCount = requireUint32(
        status.pendingHostileActorCount,
        'hostileStatus.pendingHostileActorCount'
    );
    const hostileActorCount = requireUint32(
        status.hostileActorCount,
        'hostileStatus.hostileActorCount'
    );
    const countExact = requireBoolean(status.countExact, 'hostileStatus.countExact');
    const siegeWeight = requireNonNegativeFinite(
        status.siegeWeight,
        'hostileStatus.siegeWeight'
    );
    const exact = countExact
        && revision === snapshot.hostile.revision
        && registryRevision === snapshot.hostile.registryRevision
        && registryRevision === snapshot.registryRevision
        && liveHostileActorCount === snapshot.hostile.liveHostileActorCount
        && pendingHostileActorCount === snapshot.hostile.pendingHostileActorCount
        && hostileActorCount === snapshot.hostile.hostileActorCount
        && liveHostileActorCount + pendingHostileActorCount === hostileActorCount;
    return Object.freeze({
        exact,
        revision,
        registryRevision,
        liveHostileActorCount,
        pendingHostileActorCount,
        hostileActorCount,
        siegeWeight
    });
}

function createWaveIdentity(view) {
    return [
        view.runSessionId,
        view.mapId,
        view.waveOrdinal,
        view.waveId,
        view.waveAttemptOrdinal
    ].join(':');
}

/** CPU-only overtime Core pressure authority입니다. */
export class CoreOvertimePressureDirector {
    constructor(options = {}) {
        this.coreIntegrity = assertCoreIntegrity(options.coreIntegrity);
        this.runOutcome = assertRunOutcome(options.runOutcome);
        this.waveRunCoordinator = assertWaveRunCoordinator(
            options.waveRunCoordinator
        );
        this.factJournal = new BoundedRingJournal(requirePositiveCapacity(
            options.factCapacity ?? DEFAULT_FACT_CAPACITY,
            'factCapacity'
        ));
        this.transactionCapacity = requirePositiveCapacity(
            options.transactionCapacity ?? DEFAULT_TRANSACTION_CAPACITY,
            'transactionCapacity'
        );
        this.transactionRecords = new Map();
        this.transactionOrder = new Array(this.transactionCapacity);
        this.transactionNextIndex = 0;
        this.transactionSize = 0;
        this.activeWaveIdentity = null;
        this.observedOvertimeStartFactRevision = 0;
        this.overtimePulseOrdinal = 0;
        this.nextPulseFixedTick = 0;
        this.lastPulseFact = null;
        this.coreDepletedFact = null;
        this.failure = null;
        this.destroyed = false;
    }

    observeFixedBoundary(request = {}) {
        const source = requireRecord(request, 'overtime pressure request');
        const snapshotFingerprint = getWaveQuiescenceSnapshotFingerprint(
            source.snapshot
        );
        const view = this.waveRunCoordinator.getOvertimePressureView();
        const completedFixedTick = requireUint32(
            source.completedFixedTick,
            'completedFixedTick'
        );
        const fixedTick = requireUint32(source.fixedTick, 'fixedTick');
        const completedBoundary = requireBoolean(
            source.completedBoundary,
            'completedBoundary'
        );
        const intentionalPause = requireBoolean(
            source.intentionalPause,
            'intentionalPause'
        );
        const recoveryRequired = requireBoolean(
            source.recoveryRequired,
            'recoveryRequired'
        );
        const hostile = normalizeHostileEvidence(source.snapshot, source.hostileStatus);
        const transactionId = source.transactionId === undefined
            ? [
                'r9-overtime-boundary',
                view.runSessionId,
                view.waveOrdinal,
                completedFixedTick,
                snapshotFingerprint
            ].join(':')
            : requireNonEmptyString(source.transactionId, 'transactionId');
        const canonical = {
            runSessionId: view.runSessionId,
            mapId: source.snapshot.wave.mapId,
            waveId: source.snapshot.wave.waveId,
            waveOrdinal: source.snapshot.wave.waveOrdinal,
            waveAttemptOrdinal: view.waveAttemptOrdinal,
            fixedTick,
            completedFixedTick,
            completedBoundary,
            intentionalPause,
            recoveryRequired,
            snapshotFingerprint,
            hostileRevision: hostile.revision,
            hostileRegistryRevision: hostile.registryRevision,
            hostileActorCount: hostile.hostileActorCount,
            siegeWeightFixedPoint: encodeWaveSiegeWeightFixedPoint(
                hostile.siegeWeight
            )
        };
        const transactionFingerprint = fingerprintR8Record(
            'r9-core-overtime-pressure-transaction',
            canonical,
            transactionId
        );
        const previous = this.transactionRecords.get(transactionId);
        if (previous) {
            if (previous.fingerprint !== transactionFingerprint) {
                this.failure ??= Object.freeze({
                    reason: 'transaction-conflict',
                    transactionId,
                    previousFingerprint: previous.fingerprint,
                    transactionFingerprint
                });
                return this.#createResult(
                    CORE_OVERTIME_PRESSURE_RESULT_CODE.TRANSACTION_CONFLICT,
                    transactionId,
                    transactionFingerprint,
                    { recoveryRequired: true }
                );
            }
            return this.#createResult(
                previous.code,
                transactionId,
                transactionFingerprint,
                { replayed: true }
            );
        }
        if (this.destroyed) {
            return this.#createResult(
                CORE_OVERTIME_PRESSURE_RESULT_CODE.DESTROYED,
                transactionId,
                transactionFingerprint
            );
        }
        if (this.failure !== null) {
            return this.#createResult(
                CORE_OVERTIME_PRESSURE_RESULT_CODE.RECOVERY_REQUIRED,
                transactionId,
                transactionFingerprint,
                { recoveryRequired: true }
            );
        }
        const identityMatches = source.snapshot.wave.mapId === view.mapId
            && source.snapshot.wave.waveId === view.waveId
            && source.snapshot.wave.waveOrdinal === view.waveOrdinal
            && source.snapshot.fixedTick === fixedTick;
        if (!identityMatches || !hostile.exact) {
            return this.#rememberAndCreateResult(
                transactionId,
                transactionFingerprint,
                CORE_OVERTIME_PRESSURE_RESULT_CODE.SOURCE_CHANGED,
                { recoveryRequired: true }
            );
        }
        if (recoveryRequired
            || source.snapshot.run.recoveryRequired
            || !source.snapshot.events.contiguous) {
            return this.#rememberAndCreateResult(
                transactionId,
                transactionFingerprint,
                CORE_OVERTIME_PRESSURE_RESULT_CODE.RECOVERY_REQUIRED,
                { recoveryRequired: true }
            );
        }

        const facts = [];
        this.#observeOvertimeStart(view, facts);
        if (this.coreIntegrity.isDepleted()
            || this.runOutcome.isDefeated()
            || view.state === WAVE_RUN_STATE.RUN_DEFEATED) {
            this.#transitionToDefeated(view, completedFixedTick, null, facts);
            return this.#rememberAndCreateResult(
                transactionId,
                transactionFingerprint,
                CORE_OVERTIME_PRESSURE_RESULT_CODE.RUN_DEFEATED,
                { facts, defeated: true }
            );
        }
        if (!completedBoundary || intentionalPause) {
            return this.#rememberAndCreateResult(
                transactionId,
                transactionFingerprint,
                CORE_OVERTIME_PRESSURE_RESULT_CODE.DEFERRED,
                { facts }
            );
        }
        if (view.state !== WAVE_RUN_STATE.OVERTIME
            || !view.overtimeStarted
            || this.activeWaveIdentity === null) {
            return this.#rememberAndCreateResult(
                transactionId,
                transactionFingerprint,
                CORE_OVERTIME_PRESSURE_RESULT_CODE.WRONG_PHASE,
                { facts }
            );
        }
        if (hostile.hostileActorCount === 0) {
            return this.#rememberAndCreateResult(
                transactionId,
                transactionFingerprint,
                CORE_OVERTIME_PRESSURE_RESULT_CODE.DEFERRED,
                { facts }
            );
        }
        const pendingTerminalCleanup = source.snapshot.pending.lifecycleCommandCount > 0;
        if (completedFixedTick < this.nextPulseFixedTick
            || pendingTerminalCleanup) {
            return this.#rememberAndCreateResult(
                transactionId,
                transactionFingerprint,
                CORE_OVERTIME_PRESSURE_RESULT_CODE.DEFERRED,
                {
                    facts,
                    pendingTerminalCleanup,
                    nextPulseFixedTick: this.nextPulseFixedTick
                }
            );
        }

        let damage;
        try {
            damage = calculateCoreOvertimeDamageFixedPoint(
                hostile.siegeWeight,
                view.resolutionProfile.overtime
            );
        } catch (error) {
            this.failure = Object.freeze({
                reason: 'damage-formula',
                message: String(error?.message ?? error)
            });
            return this.#createResult(
                CORE_OVERTIME_PRESSURE_RESULT_CODE.RECOVERY_REQUIRED,
                transactionId,
                transactionFingerprint,
                { recoveryRequired: true }
            );
        }
        const pulseOrdinal = this.overtimePulseOrdinal + 1;
        const scheduledFixedTick = this.nextPulseFixedTick;
        const pressureKey = [
            view.runSessionId,
            view.mapId,
            view.waveId,
            view.waveOrdinal,
            view.waveAttemptOrdinal,
            pulseOrdinal,
            scheduledFixedTick,
            hostile.revision
        ].join(':');
        const before = this.coreIntegrity.getCurrentIntegrity();
        const appliedDamage = this.coreIntegrity.applyIntegrityDamage(damage.damage);
        const after = this.coreIntegrity.getCurrentIntegrity();
        this.overtimePulseOrdinal = pulseOrdinal;
        try {
            this.nextPulseFixedTick = checkedUint32Sum(
                scheduledFixedTick,
                view.resolutionProfile.overtime.pulseIntervalTicks,
                'next overtime pulse fixed tick'
            );
        } catch (error) {
            this.failure = Object.freeze({
                reason: 'pulse-schedule-overflow',
                message: String(error?.message ?? error)
            });
        }
        const pulseFact = Object.freeze({
            type: CORE_OVERTIME_PRESSURE_FACT_TYPE.OVERTIME_PULSE,
            runSessionId: view.runSessionId,
            mapId: view.mapId,
            waveId: view.waveId,
            waveOrdinal: view.waveOrdinal,
            waveAttemptOrdinal: view.waveAttemptOrdinal,
            overtimePulseOrdinal: pulseOrdinal,
            scheduledFixedTick,
            observedFixedTick: fixedTick,
            completedFixedTick,
            hostileSnapshotRevision: hostile.revision,
            hostileActorCount: hostile.hostileActorCount,
            siegeWeight: hostile.siegeWeight,
            siegeWeightFixedPoint: damage.siegeWeightFixedPoint,
            scaledDamageFixedPointExact: damage.scaledDamageFixedPointExact,
            damageFixedPoint: damage.damageFixedPoint,
            requestedDamage: damage.damage,
            appliedDamage,
            pressureKey
        });
        this.lastPulseFact = pulseFact;
        this.#appendFact(pulseFact, facts);
        if (appliedDamage > 0) {
            this.#appendFact(Object.freeze({
                type: CORE_OVERTIME_PRESSURE_FACT_TYPE.CORE_DAMAGED,
                sourceType: CORE_OVERTIME_PRESSURE_FACT_TYPE.OVERTIME_PULSE,
                pressureKey,
                overtimePulseOrdinal: pulseOrdinal,
                scheduledFixedTick,
                damage: appliedDamage,
                damageFixedPoint: damage.damageFixedPoint,
                coreIntegrityBefore: before,
                currentIntegrity: after,
                maxIntegrity: this.coreIntegrity.getMaxIntegrity()
            }), facts);
        }
        if (after <= 0 && this.coreDepletedFact === null) {
            this.coreDepletedFact = Object.freeze({
                type: CORE_OVERTIME_PRESSURE_FACT_TYPE.CORE_DEPLETED,
                sourceType: CORE_OVERTIME_PRESSURE_FACT_TYPE.OVERTIME_PULSE,
                eventKey: pressureKey,
                pressureKey,
                overtimePulseOrdinal: pulseOrdinal,
                scheduledFixedTick,
                currentIntegrity: 0,
                maxIntegrity: this.coreIntegrity.getMaxIntegrity()
            });
            this.#appendFact(this.coreDepletedFact, facts);
            this.#transitionToDefeated(
                view,
                completedFixedTick,
                pressureKey,
                facts
            );
        }
        const defeated = this.runOutcome.isDefeated();
        return this.#rememberAndCreateResult(
            transactionId,
            transactionFingerprint,
            defeated
                ? CORE_OVERTIME_PRESSURE_RESULT_CODE.RUN_DEFEATED
                : CORE_OVERTIME_PRESSURE_RESULT_CODE.ACCEPTED,
            {
                facts,
                pulsed: true,
                defeated,
                coreDepletedFact: this.coreDepletedFact,
                recoveryRequired: this.failure !== null
            }
        );
    }

    getFacts() {
        return this.factJournal.snapshot();
    }

    getStatus() {
        return Object.freeze({
            activeWaveIdentity: this.activeWaveIdentity,
            overtimePulseOrdinal: this.overtimePulseOrdinal,
            nextPulseFixedTick: this.nextPulseFixedTick,
            lastPulseFact: this.lastPulseFact,
            coreDepletedFact: this.coreDepletedFact,
            facts: this.getFacts(),
            failure: this.failure,
            recoveryRequired: this.requiresRecovery(),
            destroyed: this.destroyed
        });
    }

    requiresRecovery() {
        return !this.destroyed && this.failure !== null;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.transactionRecords.clear();
        this.transactionOrder.fill(undefined);
        this.transactionSize = 0;
        this.activeWaveIdentity = null;
    }

    #observeOvertimeStart(view, facts) {
        if (!view.overtimeStarted
            || view.state !== WAVE_RUN_STATE.OVERTIME
            || !view.overtimeStartedFact) {
            return;
        }
        const waveIdentity = createWaveIdentity(view);
        if (this.activeWaveIdentity !== null
            && this.activeWaveIdentity !== waveIdentity) {
            this.overtimePulseOrdinal = 0;
            this.nextPulseFixedTick = 0;
            this.coreDepletedFact = null;
            this.lastPulseFact = null;
            this.observedOvertimeStartFactRevision = 0;
        }
        this.activeWaveIdentity = waveIdentity;
        if (this.nextPulseFixedTick === 0) {
            this.nextPulseFixedTick = requireUint32(
                view.firstPulseFixedTick,
                'firstPulseFixedTick',
                { positive: true }
            );
        } else if (this.overtimePulseOrdinal === 0
            && this.nextPulseFixedTick !== view.firstPulseFixedTick) {
            this.failure ??= Object.freeze({
                reason: 'overtime-schedule-conflict',
                expectedFirstPulseFixedTick: this.nextPulseFixedTick,
                observedFirstPulseFixedTick: view.firstPulseFixedTick
            });
            return;
        }
        const factRevision = requireUint32(
            view.overtimeStartedFact.factRevision,
            'OvertimeStarted.factRevision',
            { positive: true }
        );
        if (factRevision !== this.observedOvertimeStartFactRevision) {
            this.observedOvertimeStartFactRevision = factRevision;
            this.#appendFact(view.overtimeStartedFact, facts);
        }
    }

    #transitionToDefeated(view, fixedTick, pressureKey, facts) {
        let runFailedFact = this.runOutcome.getRunFailedFact();
        if (this.runOutcome.isRunning()) {
            runFailedFact = this.runOutcome.transitionToDefeated({
                fixedTick,
                sourceType: pressureKey
                    ? CORE_OVERTIME_PRESSURE_FACT_TYPE.OVERTIME_PULSE
                    : CORE_OVERTIME_PRESSURE_FACT_TYPE.CORE_DEPLETED,
                sourceEventKey: pressureKey
            }).fact;
            this.#appendFact(runFailedFact, facts);
        }
        if (view.state === WAVE_RUN_STATE.RUN_DEFEATED) return;
        const defeatRevision = Math.max(
            1,
            this.overtimePulseOrdinal,
            requireUint32(fixedTick, 'defeat fixedTick')
        );
        const transition = this.waveRunCoordinator.transitionToDefeated({
            transactionId: [
                'r9-overtime-defeat',
                view.runSessionId,
                view.waveOrdinal,
                pressureKey ?? `core:${defeatRevision}`
            ].join(':'),
            runSessionId: view.runSessionId,
            planId: view.planId,
            waveOrdinal: view.waveOrdinal,
            waveId: view.waveId,
            defeatRevision,
            cause: pressureKey ? 'OVERTIME_CORE_DEPLETED' : 'CORE_DEPLETED'
        });
        if (transition.code === WAVE_RUN_RESULT_CODE.ACCEPTED) {
            for (const fact of transition.facts) this.#appendFact(fact, facts);
        }
    }

    #appendFact(fact, facts) {
        this.factJournal.append(fact);
        facts.push(fact);
    }

    #rememberAndCreateResult(
        transactionId,
        transactionFingerprint,
        code,
        outcome = {}
    ) {
        const result = this.#createResult(
            code,
            transactionId,
            transactionFingerprint,
            outcome
        );
        this.#rememberTransaction(
            transactionId,
            transactionFingerprint,
            code
        );
        return result;
    }

    #createResult(code, transactionId, transactionFingerprint, outcome = {}) {
        return Object.freeze({
            accepted: code === CORE_OVERTIME_PRESSURE_RESULT_CODE.ACCEPTED,
            code,
            replayed: outcome.replayed === true,
            pulsed: outcome.pulsed === true,
            defeated: outcome.defeated === true,
            recoveryRequired: outcome.recoveryRequired === true,
            transactionId,
            transactionFingerprint,
            facts: Object.freeze([...(outcome.facts ?? [])]),
            coreDepletedFact: outcome.coreDepletedFact ?? this.coreDepletedFact,
            overtimePulseOrdinal: this.overtimePulseOrdinal,
            nextPulseFixedTick: this.nextPulseFixedTick,
            pendingTerminalCleanup:
                outcome.pendingTerminalCleanup === true
        });
    }

    #rememberTransaction(transactionId, fingerprint, code) {
        if (this.transactionSize === this.transactionCapacity) {
            const evictedId = this.transactionOrder[this.transactionNextIndex];
            this.transactionRecords.delete(evictedId);
        } else {
            this.transactionSize++;
        }
        this.transactionOrder[this.transactionNextIndex] = transactionId;
        this.transactionNextIndex = (
            this.transactionNextIndex + 1
        ) % this.transactionCapacity;
        this.transactionRecords.set(transactionId, Object.freeze({
            fingerprint,
            code
        }));
    }
}
