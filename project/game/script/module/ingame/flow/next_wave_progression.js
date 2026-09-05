import {
    requireNonNegativeSafeInteger,
    requirePositiveSafeInteger
} from 'util/number_util.js';

const NEXT_WAVE_TRANSACTION_CAPACITY = 32;

export const NEXT_WAVE_PROGRESSION_RESULT_CODE = Object.freeze({
    PREPARED: 'PREPARED',
    ACTIVATED: 'ACTIVATED',
    DEFERRED_UNSAFE_BOUNDARY: 'DEFERRED_UNSAFE_BOUNDARY',
    WRONG_PHASE: 'WRONG_PHASE',
    SOURCE_CHANGED: 'SOURCE_CHANGED',
    TRANSACTION_CONFLICT: 'TRANSACTION_CONFLICT',
    DIRECTOR_INIT_FAILED: 'DIRECTOR_INIT_FAILED',
    DESTROYED: 'DESTROYED'
});

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

/**
 * 같은 GPU world의 다음 Wave 준비/활성화 요청과 bounded replay 이력의 단일 소유자입니다.
 * Wave 완료/보상은 WaveRunCoordinator, 실제 world 교체는 주입된 GameObjectSystem port가 소유합니다.
 */
export class NextWaveProgression {
    #ports;
    #transactions = new Map();
    #order = new Array(NEXT_WAVE_TRANSACTION_CAPACITY);
    #nextIndex = 0;
    #size = 0;
    #prepared = null;
    #destroyed = false;

    constructor(ports) {
        for (const name of [
            'getPreparationContext',
            'captureSafeBoundary',
            'createWaveDirector',
            'installPreparedWave',
            'getWaveStatus',
            'captureEndpointIdentity',
            'openGameplayIngress'
        ]) {
            if (typeof ports?.[name] !== 'function') {
                throw new TypeError(`NextWaveProgression.${name}() port가 필요합니다.`);
            }
        }
        this.#ports = Object.freeze({ ...ports });
    }

    prepare(request = {}) {
        const transactionId = requireNonEmptyString(
            request.transactionId,
            'next Wave transactionId'
        );
        const waveOrdinal = requirePositiveSafeInteger(
            request.waveOrdinal,
            'next Wave waveOrdinal'
        );
        const fixedTickOffset = requireNonNegativeSafeInteger(
            request.fixedTickOffset,
            'next Wave fixedTickOffset'
        );
        const planFingerprint = requirePositiveSafeInteger(
            request.planFingerprint,
            'next Wave planFingerprint'
        );
        const waveDefinition = request.waveDefinition;
        const waveId = requireNonEmptyString(
            waveDefinition?.waveId,
            'next Wave waveDefinition.waveId'
        );
        const mapId = requireNonEmptyString(
            waveDefinition?.mapId,
            'next Wave waveDefinition.mapId'
        );
        const intentFingerprint = [
            mapId,
            waveId,
            waveOrdinal,
            fixedTickOffset,
            planFingerprint
        ].join(':');
        const known = this.#transactions.get(transactionId);
        if (known?.intentFingerprint !== undefined
            && known.intentFingerprint !== intentFingerprint) {
            return Object.freeze({
                accepted: false,
                code: NEXT_WAVE_PROGRESSION_RESULT_CODE.TRANSACTION_CONFLICT,
                transactionId,
                intentFingerprint,
                mutationCount: 0
            });
        }
        if (known?.prepareReceipt) return known.prepareReceipt;
        if (this.#destroyed) {
            return Object.freeze({
                accepted: false,
                code: NEXT_WAVE_PROGRESSION_RESULT_CODE.DESTROYED,
                transactionId,
                intentFingerprint,
                mutationCount: 0
            });
        }
        const context = this.#ports.getPreparationContext();
        if (!context.ready
            || (this.#prepared !== null
                && this.#prepared.activationReceipt === null)) {
            return Object.freeze({
                accepted: false,
                code: NEXT_WAVE_PROGRESSION_RESULT_CODE.WRONG_PHASE,
                transactionId,
                intentFingerprint,
                mutationCount: 0
            });
        }
        if (mapId !== context.tileMap?.mapId
            || waveOrdinal !== context.waveOrdinal + 1
            || fixedTickOffset !== context.fixedTickOffset) {
            return Object.freeze({
                accepted: false,
                code: NEXT_WAVE_PROGRESSION_RESULT_CODE.SOURCE_CHANGED,
                transactionId,
                intentFingerprint,
                mutationCount: 0
            });
        }
        const safeBoundary = this.#ports.captureSafeBoundary();
        if (!safeBoundary.accepted) {
            return Object.freeze({
                accepted: false,
                code:
                    NEXT_WAVE_PROGRESSION_RESULT_CODE
                        .DEFERRED_UNSAFE_BOUNDARY,
                transactionId,
                intentFingerprint,
                safeBoundary,
                mutationCount: 0
            });
        }
        this.#rememberNextWaveTransactionIntent(
            transactionId,
            intentFingerprint
        );

        let candidate = null;
        try {
            candidate = this.#ports.createWaveDirector({
                waveDefinition,
                fixedTickOffset
            });
            if (candidate.init(context.tileMap) !== true) {
                throw new Error('next WaveDirector init이 완료되지 않았습니다.');
            }
            const candidateStatus = candidate.getStatus();
            if (candidateStatus.initialized !== true
                || candidateStatus.waveId !== waveId
                || candidateStatus.fixedTickOffset !== fixedTickOffset
                || candidateStatus.queuedSpawnCount !== 0
                || candidateStatus.routeAvailabilityVersion !== null) {
                throw new Error('next WaveDirector 초기 상태가 올바르지 않습니다.');
            }
        } catch (error) {
            try {
                candidate?.destroy();
            } catch {
                // 실패한 candidate만 폐기하고 settled old Wave를 보존합니다.
            }
            return Object.freeze({
                accepted: false,
                code: NEXT_WAVE_PROGRESSION_RESULT_CODE.DIRECTOR_INIT_FAILED,
                transactionId,
                intentFingerprint,
                failure: Object.freeze({
                    message: String(error?.message ?? error)
                }),
                oldWavePreserved: true,
                mutationCount: 0
            });
        }

        const oldWaveId = this.#ports.installPreparedWave(candidate, {
            waveDefinition,
            waveOrdinal
        });
        const endpointIdentity = this.#ports.captureEndpointIdentity();
        const receipt = Object.freeze({
            accepted: true,
            code: NEXT_WAVE_PROGRESSION_RESULT_CODE.PREPARED,
            transactionId,
            intentFingerprint,
            planFingerprint,
            oldWaveId,
            waveId,
            waveOrdinal,
            fixedTickOffset,
            earliestSpawnFixedTick: fixedTickOffset + 1,
            endpointIdentity,
            sameGpuWorld: true,
            routeAvailability: safeBoundary.routeAvailability,
            hostileBaseline: safeBoundary.hostile,
            gameplayIngressSealed: true,
            mutationCount: 1
        });
        this.#prepared = {
            transactionId,
            intentFingerprint,
            planFingerprint,
            waveId,
            waveOrdinal,
            fixedTickOffset,
            prepareReceipt: receipt,
            activationReceipt: null
        };
        this.#publishNextWavePrepareReceipt(transactionId, receipt);
        return receipt;
    }

    activate(request = {}) {
        const transactionId = requireNonEmptyString(
            request.transactionId,
            'next Wave activation transactionId'
        );
        const planFingerprint = requirePositiveSafeInteger(
            request.planFingerprint,
            'next Wave activation planFingerprint'
        );
        if (this.#destroyed) {
            return Object.freeze({
                accepted: false,
                code: NEXT_WAVE_PROGRESSION_RESULT_CODE.DESTROYED,
                transactionId,
                mutationCount: 0
            });
        }
        const known = this.#transactions.get(transactionId);
        const knownPlanFingerprint
            = known?.activationReceipt?.planFingerprint
                ?? known?.prepareReceipt?.planFingerprint
                ?? null;
        if (knownPlanFingerprint !== null
            && knownPlanFingerprint !== planFingerprint) {
            return Object.freeze({
                accepted: false,
                code: NEXT_WAVE_PROGRESSION_RESULT_CODE.TRANSACTION_CONFLICT,
                transactionId,
                mutationCount: 0
            });
        }
        if (known?.activationReceipt) return known.activationReceipt;
        const prepared = this.#prepared;
        if (!prepared) {
            return Object.freeze({
                accepted: false,
                code: NEXT_WAVE_PROGRESSION_RESULT_CODE.WRONG_PHASE,
                transactionId,
                mutationCount: 0
            });
        }
        if (prepared.transactionId !== transactionId
            || prepared.planFingerprint !== planFingerprint) {
            return Object.freeze({
                accepted: false,
                code: NEXT_WAVE_PROGRESSION_RESULT_CODE.TRANSACTION_CONFLICT,
                transactionId,
                mutationCount: 0
            });
        }
        if (prepared.activationReceipt) return prepared.activationReceipt;
        const safeBoundary = this.#ports.captureSafeBoundary({
            requireOldWaveCompleted: false
        });
        const status = this.#ports.getWaveStatus();
        if (!safeBoundary.accepted
            || status?.waveId !== prepared.waveId
            || status.queuedSpawnCount !== 0
            || status.fixedTickOffset !== prepared.fixedTickOffset) {
            return Object.freeze({
                accepted: false,
                code:
                    NEXT_WAVE_PROGRESSION_RESULT_CODE
                        .DEFERRED_UNSAFE_BOUNDARY,
                transactionId,
                safeBoundary,
                mutationCount: 0
            });
        }
        this.#ports.openGameplayIngress();
        const receipt = Object.freeze({
            accepted: true,
            code: NEXT_WAVE_PROGRESSION_RESULT_CODE.ACTIVATED,
            transactionId,
            planFingerprint,
            waveId: prepared.waveId,
            waveOrdinal: prepared.waveOrdinal,
            earliestSpawnFixedTick: prepared.fixedTickOffset + 1,
            endpointIdentity: this.#ports.captureEndpointIdentity(),
            gameplayIngressSealed: false,
            mutationCount: 1
        });
        prepared.activationReceipt = receipt;
        this.#publishNextWaveActivationReceipt(transactionId, receipt);
        return receipt;
    }

    getStatus(gameplayIngressSealed) {
        const prepared = this.#prepared;
        return Object.freeze({
            prepared: prepared !== null,
            activated: prepared?.activationReceipt !== null
                && prepared?.activationReceipt !== undefined,
            transactionId: prepared?.transactionId ?? null,
            planFingerprint: prepared?.planFingerprint ?? 0,
            waveId: prepared?.waveId ?? null,
            waveOrdinal: prepared?.waveOrdinal ?? 0,
            fixedTickOffset: prepared?.fixedTickOffset ?? 0,
            gameplayIngressSealed,
            rememberedTransactionCount: this.#transactions.size
        });
    }

    destroy() {
        this.#destroyed = true;
        this.#transactions.clear();
        this.#order.fill(undefined);
        this.#nextIndex = 0;
        this.#size = 0;
        this.#prepared = null;
        this.#ports = null;
    }

    #rememberNextWaveTransactionIntent(transactionId, intentFingerprint) {
        if (this.#transactions.has(transactionId)) return;
        if (this.#size === NEXT_WAVE_TRANSACTION_CAPACITY) {
            const retiredId = this.#order[this.#nextIndex];
            this.#transactions.delete(retiredId);
        } else {
            this.#size++;
        }
        this.#order[this.#nextIndex] = transactionId;
        this.#nextIndex = (
            this.#nextIndex + 1
        ) % NEXT_WAVE_TRANSACTION_CAPACITY;
        this.#transactions.set(transactionId, {
            intentFingerprint,
            prepareReceipt: null,
            activationReceipt: null
        });
    }

    #publishNextWavePrepareReceipt(transactionId, receipt) {
        const record = this.#transactions.get(transactionId);
        if (record) record.prepareReceipt = receipt;
    }

    #publishNextWaveActivationReceipt(transactionId, receipt) {
        const record = this.#transactions.get(transactionId);
        if (record) record.activationReceipt = receipt;
    }
}
