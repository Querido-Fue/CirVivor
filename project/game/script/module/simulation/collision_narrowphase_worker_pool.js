import {
    COLLISION_CONTACT_RESULT_STRIDE,
    COLLISION_RELATION_BROAD_STRIDE
} from '../physics/collision_soa_layout.js';
import {
    COLLISION_NARROWPHASE_COMPLETION_INDEX,
    COLLISION_NARROWPHASE_COMPLETION_STATE,
    COLLISION_NARROWPHASE_COMPLETION_STRIDE,
    COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES,
    createCollisionNarrowphaseWorkerMessage,
    isCollisionNarrowphaseWorkerMessage
} from './collision_narrowphase_worker_protocol.js';
import { getSimulationRuntimeSnapshot } from './simulation_runtime.js';

const COLLISION_NARROWPHASE_WORKER_POOL_MAX_SIZE = 3;
const COLLISION_NARROWPHASE_WORKER_POOL_RESERVED_THREAD_COUNT = 2;
const COLLISION_NARROWPHASE_INITIAL_BODY_CAPACITY = 4096;
const COLLISION_NARROWPHASE_INITIAL_PAIR_CAPACITY = 65536;
const COLLISION_NARROWPHASE_DEFAULT_SYNC_WAIT_TIMEOUT_MS = 4;

/**
 * 충돌 narrowphase worker pool 기본 통계를 생성합니다.
 * @returns {{supported: boolean, running: boolean, ready: boolean, requestCount: number, responseCount: number, fallbackCount: number, staleDropCount: number, overflowCount: number, lastRequestId: number, lastCompletedRequestId: number, lastLatencyMs: number, lastPairCount: number, lastContactCount: number, poolSize: number, chunkCount: number, completedChunkCount: number, bodyCapacity: number, pairCapacity: number, transportMode: string, lastError: string|null}}
 */
function createDefaultCollisionNarrowphaseWorkerStats() {
    return {
        supported: isCollisionNarrowphaseWorkerPoolSupported(),
        running: false,
        ready: false,
        requestCount: 0,
        responseCount: 0,
        fallbackCount: 0,
        staleDropCount: 0,
        overflowCount: 0,
        lastRequestId: 0,
        lastCompletedRequestId: 0,
        lastLatencyMs: 0,
        lastPairCount: 0,
        lastContactCount: 0,
        poolSize: 0,
        chunkCount: 0,
        completedChunkCount: 0,
        bodyCapacity: 0,
        pairCapacity: 0,
        transportMode: 'none',
        lastError: null
    };
}

/**
 * 충돌 narrowphase worker pool 지원 여부를 반환합니다.
 * @returns {boolean}
 */
export function isCollisionNarrowphaseWorkerPoolSupported() {
    return typeof Worker === 'function' && typeof SharedArrayBuffer === 'function';
}

/**
 * 현재 실행 컨텍스트에서 Atomics.wait 기반 동기 대기를 사용할 수 있는지 반환합니다.
 * @returns {boolean}
 */
export function isCollisionNarrowphaseSyncWaitSupported() {
    return typeof document === 'undefined'
        && typeof Atomics === 'object'
        && typeof Atomics.wait === 'function'
        && typeof Atomics.notify === 'function';
}

/**
 * 안전한 hardware concurrency 값을 반환합니다.
 * @returns {number|null}
 */
function getCollisionNarrowphaseWorkerHardwareConcurrency() {
    const hardwareConcurrency = globalThis.navigator?.hardwareConcurrency;
    return Number.isInteger(hardwareConcurrency) && hardwareConcurrency > 0
        ? hardwareConcurrency
        : null;
}

/**
 * 현재 런타임 설정 기준 충돌 narrowphase worker pool 크기를 계산합니다.
 * @returns {number}
 */
function resolveCollisionNarrowphaseWorkerPoolSize() {
    const runtimeSettings = getSimulationRuntimeSnapshot()?.settings ?? {};
    if (runtimeSettings.simulationWorkerAuthorityMode !== true) {
        return 1;
    }

    const hardwareConcurrency = getCollisionNarrowphaseWorkerHardwareConcurrency();
    if (hardwareConcurrency === null) {
        return 2;
    }

    return Math.max(
        1,
        Math.min(
            COLLISION_NARROWPHASE_WORKER_POOL_MAX_SIZE,
            hardwareConcurrency - COLLISION_NARROWPHASE_WORKER_POOL_RESERVED_THREAD_COUNT
        )
    );
}

/**
 * 공유 버퍼 묶음을 생성합니다.
 * @param {number} bodyCapacity
 * @param {number} pairCapacity
 * @returns {object}
 */
function createCollisionNarrowphaseSharedBuffers(bodyCapacity, pairCapacity) {
    const safeBodyCapacity = Math.max(1, bodyCapacity);
    const safePairCapacity = Math.max(1, pairCapacity);
    return {
        relationBuffer: new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * safeBodyCapacity * COLLISION_RELATION_BROAD_STRIDE),
        bodyKindBuffer: new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT * safeBodyCapacity),
        bodyShapeBuffer: new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT * safeBodyCapacity),
        pairLowBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * safePairCapacity),
        pairHighBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * safePairCapacity),
        contactResultBuffer: new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * safePairCapacity * COLLISION_CONTACT_RESULT_STRIDE),
        bodyCapacity: safeBodyCapacity,
        pairCapacity: safePairCapacity
    };
}

/**
 * 충돌 narrowphase worker pool입니다.
 */
export class CollisionNarrowphaseWorkerPool {
    constructor() {
        this.workers = [];
        this.workerStates = [];
        this.workerIndexByInstance = new Map();
        this.sharedBuffers = null;
        this.relationData = null;
        this.bodyKindCodes = null;
        this.bodyShapeCodes = null;
        this.pairLowIndices = null;
        this.pairHighIndices = null;
        this.contactResultData = null;
        this.completionBuffer = null;
        this.completionState = null;
        this.inFlightRequest = null;
        this.requestSequence = 0;
        this.stats = createDefaultCollisionNarrowphaseWorkerStats();
        this._boundHandleMessage = this._handleMessage.bind(this);
        this._boundHandleWorkerError = this._handleWorkerError.bind(this);
        this._boundHandleMessageError = this._handleMessageError.bind(this);
    }

    /**
     * 현재 준비 상태를 반환합니다.
     * @returns {boolean}
     */
    isReady() {
        return this.stats.ready === true && this.workers.length > 0;
    }

    /**
     * 충돌 narrowphase worker pool 시작을 보장합니다.
     * @returns {boolean}
     */
    ensureStarted() {
        if (this.workers.length > 0) {
            return true;
        }

        if (!isCollisionNarrowphaseWorkerPoolSupported()) {
            this.stats.supported = false;
            this.stats.lastError = '충돌 narrowphase worker pool을 지원하지 않는 런타임입니다.';
            return false;
        }

        try {
            this._createSharedBufferViews(
                COLLISION_NARROWPHASE_INITIAL_BODY_CAPACITY,
                COLLISION_NARROWPHASE_INITIAL_PAIR_CAPACITY
            );
            const poolSize = resolveCollisionNarrowphaseWorkerPoolSize();
            for (let workerIndex = 0; workerIndex < poolSize; workerIndex++) {
                this._spawnWorker(workerIndex);
            }

            this.stats.running = true;
            this.stats.ready = false;
            this.stats.lastError = null;
            this.stats.poolSize = this.workers.length;
            this.stats.transportMode = 'sab';
            return true;
        } catch (error) {
            this.stats.lastError = error instanceof Error ? error.message : String(error);
            this.stats.running = false;
            this.stats.ready = false;
            this.stop();
            return false;
        }
    }

    /**
     * worker pool을 중지하고 상태를 초기화합니다.
     */
    stop() {
        for (let i = 0; i < this.workers.length; i++) {
            const worker = this.workers[i];
            if (!worker) {
                continue;
            }
            try {
                worker.postMessage(createCollisionNarrowphaseWorkerMessage(COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES.SHUTDOWN));
            } catch {
                // 종료 직전 오류는 무시합니다.
            }
            worker.removeEventListener('message', this._boundHandleMessage);
            worker.removeEventListener('error', this._boundHandleWorkerError);
            worker.removeEventListener('messageerror', this._boundHandleMessageError);
            worker.terminate();
        }

        if (this.inFlightRequest?.resolve) {
            this.inFlightRequest.resolve(null);
        }
        this.workers.length = 0;
        this.workerStates.length = 0;
        this.workerIndexByInstance.clear();
        this.inFlightRequest = null;
        this.stats.running = false;
        this.stats.ready = false;
        this.stats.poolSize = 0;
        this.stats.chunkCount = 0;
        this.stats.completedChunkCount = 0;
        this.stats.transportMode = 'none';
    }

    /**
     * 현재 통계 스냅샷을 반환합니다.
     * @returns {object}
     */
    getStatsSnapshot() {
        return {
            ...this.stats
        };
    }

    /**
     * enemy circle pair contact 계산을 요청합니다.
     * @param {{relationData: Float64Array, bodyKindCodes: Uint8Array, bodyShapeCodes: Uint8Array, pairLowIndices: Int32Array, pairHighIndices: Int32Array, bodyCount: number, pairCount: number}} payload
     * @returns {Promise<object|null>}
     */
    async computeEnemyCircleContacts(payload) {
        if (this.inFlightRequest) {
            this.stats.fallbackCount++;
            return null;
        }
        if (!this.ensureStarted() || !this.isReady()) {
            this.stats.fallbackCount++;
            return null;
        }

        const bodyCount = Math.max(0, Math.min(
            Number.isInteger(payload?.bodyCount) ? payload.bodyCount : 0,
            Math.floor((payload?.relationData?.length ?? 0) / COLLISION_RELATION_BROAD_STRIDE),
            payload?.bodyKindCodes?.length ?? 0,
            payload?.bodyShapeCodes?.length ?? 0
        ));
        const pairCount = Math.max(0, Math.min(
            Number.isInteger(payload?.pairCount) ? payload.pairCount : 0,
            payload?.pairLowIndices?.length ?? 0,
            payload?.pairHighIndices?.length ?? 0
        ));
        if (bodyCount <= 0 || pairCount <= 0) {
            return {
                resultCount: 0,
                resultRanges: [],
                resultData: this.contactResultData,
                durationMs: 0
            };
        }
        if (!this._ensureCapacity(bodyCount, pairCount) || !this.isReady()) {
            this.stats.fallbackCount++;
            return null;
        }

        this._writeInputSnapshot(payload, bodyCount, pairCount);
        const chunks = this._createRangeChunks(pairCount);
        if (chunks.length === 0) {
            return {
                resultCount: 0,
                resultRanges: [],
                resultData: this.contactResultData,
                durationMs: 0
            };
        }

        return new Promise((resolve) => {
            const requestId = ++this.requestSequence;
            this.inFlightRequest = {
                requestId,
                requestedAt: performance.now(),
                bodyCount,
                pairCount,
                chunkCount: chunks.length,
                completedChunkCount: 0,
                completedChunkIndices: new Set(),
                resultRanges: [],
                resultCount: 0,
                overflow: false,
                resolve
            };
            this.stats.requestCount++;
            this.stats.lastRequestId = requestId;
            this.stats.lastPairCount = pairCount;
            this.stats.lastContactCount = 0;
            this.stats.chunkCount = chunks.length;
            this.stats.completedChunkCount = 0;

            for (let i = 0; i < chunks.length; i++) {
                const worker = this.workers[chunks[i].workerIndex] ?? this.workers[i % this.workers.length];
                if (!worker) {
                    this._failInFlightRequest('충돌 narrowphase worker chunk를 보낼 수 없습니다.');
                    return;
                }
                try {
                    worker.postMessage(createCollisionNarrowphaseWorkerMessage(
                        COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES.COMPUTE_RANGE,
                        {
                            ...chunks[i],
                            requestId,
                            requestGroupId: requestId,
                            bodyCount,
                            maxPairCount: pairCount
                        }
                    ));
                } catch (error) {
                    this._failInFlightRequest(error instanceof Error ? error.message : String(error));
                    return;
                }
            }
        });
    }

    /**
     * Atomics.wait로 같은 fixed pass 안에서 enemy circle contact 계산 완료를 기다립니다.
     * @param {{relationData: Float64Array, bodyKindCodes: Uint8Array, bodyShapeCodes: Uint8Array, pairLowIndices: Int32Array, pairHighIndices: Int32Array, bodyCount: number, pairCount: number}} payload
     * @param {{waitTimeoutMs?: number}} [options={}]
     * @returns {object|null}
     */
    computeEnemyCircleContactsSync(payload, options = {}) {
        if (this.inFlightRequest || !isCollisionNarrowphaseSyncWaitSupported()) {
            this.stats.fallbackCount++;
            return null;
        }
        if (!this.ensureStarted() || !this.isReady()) {
            this.stats.fallbackCount++;
            return null;
        }

        const counts = this._normalizeInputCounts(payload);
        const bodyCount = counts.bodyCount;
        const pairCount = counts.pairCount;
        if (bodyCount <= 0 || pairCount <= 0) {
            return {
                resultCount: 0,
                resultRanges: [],
                resultData: this.contactResultData,
                overflow: false,
                durationMs: 0
            };
        }
        if (!this._ensureCapacity(bodyCount, pairCount) || !this.isReady()) {
            this.stats.fallbackCount++;
            return null;
        }

        this._writeInputSnapshot(payload, bodyCount, pairCount);
        const chunks = this._createRangeChunks(pairCount);
        if (chunks.length === 0) {
            return {
                resultCount: 0,
                resultRanges: [],
                resultData: this.contactResultData,
                overflow: false,
                durationMs: 0
            };
        }

        const waitTimeoutMs = Number.isFinite(options.waitTimeoutMs)
            ? Math.max(0, options.waitTimeoutMs)
            : COLLISION_NARROWPHASE_DEFAULT_SYNC_WAIT_TIMEOUT_MS;
        const requestId = ++this.requestSequence;
        const requestedAt = performance.now();
        this._resetCompletionState(chunks.length, requestId);
        this.stats.requestCount++;
        this.stats.lastRequestId = requestId;
        this.stats.lastPairCount = pairCount;
        this.stats.lastContactCount = 0;
        this.stats.chunkCount = chunks.length;
        this.stats.completedChunkCount = 0;

        for (let i = 0; i < chunks.length; i++) {
            const worker = this.workers[chunks[i].workerIndex] ?? this.workers[i % this.workers.length];
            if (!worker) {
                this.stats.fallbackCount++;
                this.stats.lastError = '충돌 narrowphase worker chunk를 보낼 수 없습니다.';
                this.stop();
                return null;
            }

            try {
                worker.postMessage(createCollisionNarrowphaseWorkerMessage(
                    COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES.COMPUTE_RANGE,
                    {
                        ...chunks[i],
                        requestId,
                        requestGroupId: requestId,
                        bodyCount,
                        maxPairCount: pairCount,
                        completionBuffer: this.completionBuffer,
                        completionOffset: i * COLLISION_NARROWPHASE_COMPLETION_STRIDE,
                        suppressResultMessage: true
                    }
                ));
            } catch (error) {
                this.stats.fallbackCount++;
                this.stats.lastError = error instanceof Error ? error.message : String(error);
                this.stop();
                return null;
            }
        }

        const result = this._waitForSyncCompletion({
            requestId,
            pairCount,
            chunks,
            requestedAt,
            waitTimeoutMs
        });
        if (!result) {
            this.stats.fallbackCount++;
            this.stop();
            return null;
        }

        this.stats.responseCount++;
        this.stats.lastCompletedRequestId = requestId;
        this.stats.lastLatencyMs = result.durationMs;
        this.stats.lastContactCount = result.resultCount;
        this.stats.completedChunkCount = chunks.length;
        if (result.overflow) {
            this.stats.overflowCount++;
        }
        return result;
    }

    /**
     * 공유 버퍼와 typed array view를 생성합니다.
     * @param {number} bodyCapacity
     * @param {number} pairCapacity
     * @private
     */
    _createSharedBufferViews(bodyCapacity, pairCapacity) {
        this.sharedBuffers = createCollisionNarrowphaseSharedBuffers(bodyCapacity, pairCapacity);
        this.relationData = new Float64Array(this.sharedBuffers.relationBuffer);
        this.bodyKindCodes = new Uint8Array(this.sharedBuffers.bodyKindBuffer);
        this.bodyShapeCodes = new Uint8Array(this.sharedBuffers.bodyShapeBuffer);
        this.pairLowIndices = new Int32Array(this.sharedBuffers.pairLowBuffer);
        this.pairHighIndices = new Int32Array(this.sharedBuffers.pairHighBuffer);
        this.contactResultData = new Float64Array(this.sharedBuffers.contactResultBuffer);
        if (!this.completionBuffer) {
            this.completionBuffer = new SharedArrayBuffer(
                Int32Array.BYTES_PER_ELEMENT
                    * COLLISION_NARROWPHASE_COMPLETION_STRIDE
                    * COLLISION_NARROWPHASE_WORKER_POOL_MAX_SIZE
            );
            this.completionState = new Int32Array(this.completionBuffer);
        }
        this.stats.bodyCapacity = this.sharedBuffers.bodyCapacity;
        this.stats.pairCapacity = this.sharedBuffers.pairCapacity;
    }

    /**
     * payload에서 안전한 body/pair count를 계산합니다.
     * @param {object|null|undefined} payload
     * @returns {{bodyCount: number, pairCount: number}}
     * @private
     */
    _normalizeInputCounts(payload) {
        return {
            bodyCount: Math.max(0, Math.min(
                Number.isInteger(payload?.bodyCount) ? payload.bodyCount : 0,
                Math.floor((payload?.relationData?.length ?? 0) / COLLISION_RELATION_BROAD_STRIDE),
                payload?.bodyKindCodes?.length ?? 0,
                payload?.bodyShapeCodes?.length ?? 0
            )),
            pairCount: Math.max(0, Math.min(
                Number.isInteger(payload?.pairCount) ? payload.pairCount : 0,
                payload?.pairLowIndices?.length ?? 0,
                payload?.pairHighIndices?.length ?? 0
            ))
        };
    }

    /**
     * sync completion header를 초기화합니다.
     * @param {number} chunkCount
     * @param {number} requestId
     * @private
     */
    _resetCompletionState(chunkCount, requestId) {
        const limit = Math.min(
            this.completionState.length,
            Math.max(0, chunkCount) * COLLISION_NARROWPHASE_COMPLETION_STRIDE
        );
        for (let i = 0; i < limit; i++) {
            this.completionState[i] = 0;
        }
        for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
            const offset = chunkIndex * COLLISION_NARROWPHASE_COMPLETION_STRIDE;
            Atomics.store(
                this.completionState,
                offset + COLLISION_NARROWPHASE_COMPLETION_INDEX.REQUEST_ID,
                requestId
            );
            Atomics.store(
                this.completionState,
                offset + COLLISION_NARROWPHASE_COMPLETION_INDEX.STATE,
                COLLISION_NARROWPHASE_COMPLETION_STATE.RUNNING
            );
        }
    }

    /**
     * sync completion header를 기다리고 result range 목록을 만듭니다.
     * @param {{requestId: number, pairCount: number, chunks: object[], requestedAt: number, waitTimeoutMs: number}} waitState
     * @returns {object|null}
     * @private
     */
    _waitForSyncCompletion(waitState) {
        const deadline = performance.now() + waitState.waitTimeoutMs;
        const resultRanges = [];
        let resultCount = 0;
        let overflow = false;

        for (let i = 0; i < waitState.chunks.length; i++) {
            const chunk = waitState.chunks[i];
            const offset = i * COLLISION_NARROWPHASE_COMPLETION_STRIDE;
            const stateIndex = offset + COLLISION_NARROWPHASE_COMPLETION_INDEX.STATE;
            let state = Atomics.load(this.completionState, stateIndex);
            while (state === COLLISION_NARROWPHASE_COMPLETION_STATE.RUNNING) {
                const remainingMs = Math.max(0, deadline - performance.now());
                if (remainingMs <= 0) {
                    this.stats.lastError = '충돌 narrowphase worker sync 대기 시간이 초과되었습니다.';
                    return null;
                }
                try {
                    Atomics.wait(this.completionState, stateIndex, state, remainingMs);
                } catch (error) {
                    this.stats.lastError = error instanceof Error ? error.message : String(error);
                    return null;
                }
                state = Atomics.load(this.completionState, stateIndex);
            }

            if (state !== COLLISION_NARROWPHASE_COMPLETION_STATE.DONE) {
                this.stats.lastError = '충돌 narrowphase worker sync 결과가 오류 상태입니다.';
                return null;
            }

            const completedRequestId = Atomics.load(
                this.completionState,
                offset + COLLISION_NARROWPHASE_COMPLETION_INDEX.REQUEST_ID
            );
            if (completedRequestId !== waitState.requestId) {
                this.stats.staleDropCount++;
                this.stats.lastError = '충돌 narrowphase worker sync request id가 일치하지 않습니다.';
                return null;
            }

            const chunkResultCount = Math.max(0, Atomics.load(
                this.completionState,
                offset + COLLISION_NARROWPHASE_COMPLETION_INDEX.RESULT_COUNT
            ));
            resultCount += chunkResultCount;
            overflow = overflow || Atomics.load(
                this.completionState,
                offset + COLLISION_NARROWPHASE_COMPLETION_INDEX.OVERFLOW
            ) !== 0;
            resultRanges.push({
                chunkIndex: chunk.chunkIndex,
                pairStart: chunk.pairStart,
                pairCount: chunk.pairCount,
                resultOffset: chunk.resultOffset,
                resultCount: chunkResultCount
            });
        }

        resultRanges.sort((a, b) => a.pairStart - b.pairStart);
        return {
            requestId: waitState.requestId,
            pairCount: waitState.pairCount,
            resultCount,
            resultRanges,
            resultData: this.contactResultData,
            overflow,
            durationMs: Math.max(0, performance.now() - waitState.requestedAt)
        };
    }

    /**
     * 필요한 입력 크기를 수용하도록 공유 버퍼 크기를 보장합니다.
     * @param {number} bodyCount
     * @param {number} pairCount
     * @returns {boolean}
     * @private
     */
    _ensureCapacity(bodyCount, pairCount) {
        const bodyCapacity = this.sharedBuffers?.bodyCapacity ?? 0;
        const pairCapacity = this.sharedBuffers?.pairCapacity ?? 0;
        if (bodyCount <= bodyCapacity && pairCount <= pairCapacity) {
            return true;
        }

        const nextBodyCapacity = Math.max(bodyCount, bodyCapacity * 2, COLLISION_NARROWPHASE_INITIAL_BODY_CAPACITY);
        const nextPairCapacity = Math.max(pairCount, pairCapacity * 2, COLLISION_NARROWPHASE_INITIAL_PAIR_CAPACITY);
        this._createSharedBufferViews(nextBodyCapacity, nextPairCapacity);
        for (let i = 0; i < this.workers.length; i++) {
            if (this.workerStates[i]) {
                this.workerStates[i].ready = false;
            }
            this._postBootstrap(i);
        }
        this.stats.ready = false;
        return false;
    }

    /**
     * 현재 입력 snapshot을 공유 버퍼에 씁니다.
     * @param {object} payload
     * @param {number} bodyCount
     * @param {number} pairCount
     * @private
     */
    _writeInputSnapshot(payload, bodyCount, pairCount) {
        this.relationData.set(payload.relationData.subarray(0, bodyCount * COLLISION_RELATION_BROAD_STRIDE), 0);
        this.bodyKindCodes.set(payload.bodyKindCodes.subarray(0, bodyCount), 0);
        this.bodyShapeCodes.set(payload.bodyShapeCodes.subarray(0, bodyCount), 0);
        this.pairLowIndices.set(payload.pairLowIndices.subarray(0, pairCount), 0);
        this.pairHighIndices.set(payload.pairHighIndices.subarray(0, pairCount), 0);
    }

    /**
     * pool worker별 pair range chunk를 생성합니다.
     * @param {number} pairCount
     * @returns {object[]}
     * @private
     */
    _createRangeChunks(pairCount) {
        const poolSize = Math.max(1, this.workers.length);
        const chunkCount = Math.min(poolSize, pairCount);
        const chunks = [];
        for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
            const pairStart = Math.floor((pairCount * chunkIndex) / chunkCount);
            const pairEnd = Math.floor((pairCount * (chunkIndex + 1)) / chunkCount);
            chunks.push({
                chunkIndex,
                chunkCount,
                workerIndex: chunkIndex % poolSize,
                pairStart,
                pairCount: Math.max(0, pairEnd - pairStart),
                resultOffset: pairStart,
                resultCapacity: Math.max(0, pairEnd - pairStart)
            });
        }
        return chunks;
    }

    /**
     * 내부 pool worker 하나를 생성하고 bootstrap 메시지를 보냅니다.
     * @param {number} workerIndex
     * @private
     */
    _spawnWorker(workerIndex) {
        const worker = new Worker(new URL('./collision_narrowphase_worker.js', import.meta.url), {
            type: 'module',
            name: `cirvivor-collision-narrowphase-${workerIndex}`
        });
        worker.addEventListener('message', this._boundHandleMessage);
        worker.addEventListener('error', this._boundHandleWorkerError);
        worker.addEventListener('messageerror', this._boundHandleMessageError);

        this.workers[workerIndex] = worker;
        this.workerStates[workerIndex] = {
            worker,
            workerIndex,
            ready: false
        };
        this.workerIndexByInstance.set(worker, workerIndex);
        this._postBootstrap(workerIndex);
    }

    /**
     * worker에 현재 공유 버퍼 bootstrap 메시지를 보냅니다.
     * @param {number} workerIndex
     * @private
     */
    _postBootstrap(workerIndex) {
        const worker = this.workers[workerIndex];
        if (!worker) {
            return;
        }

        worker.postMessage(createCollisionNarrowphaseWorkerMessage(COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES.BOOTSTRAP, {
            sharedBuffers: this.sharedBuffers,
            workerIndex
        }));
    }

    /**
     * 모든 pool worker가 bootstrap을 끝냈는지 반환합니다.
     * @returns {boolean}
     * @private
     */
    _areAllWorkersReady() {
        if (this.workerStates.length === 0) {
            return false;
        }

        for (let i = 0; i < this.workerStates.length; i++) {
            if (this.workerStates[i]?.ready !== true) {
                return false;
            }
        }

        return true;
    }

    /**
     * 메시지 이벤트를 보낸 worker index를 찾습니다.
     * @param {MessageEvent|ErrorEvent|null|undefined} event
     * @returns {number}
     * @private
     */
    _getWorkerIndexFromEvent(event) {
        const currentTarget = event?.currentTarget;
        if (currentTarget && this.workerIndexByInstance.has(currentTarget)) {
            return this.workerIndexByInstance.get(currentTarget);
        }

        return -1;
    }

    /**
     * @param {MessageEvent} event
     * @private
     */
    _handleMessage(event) {
        const message = event.data;
        if (!isCollisionNarrowphaseWorkerMessage(message)) {
            return;
        }

        const workerIndex = Number.isInteger(message.workerIndex)
            ? message.workerIndex
            : this._getWorkerIndexFromEvent(event);
        switch (message.type) {
            case COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES.READY:
                if (message.bootstrapped !== true) {
                    break;
                }
                if (this.workerStates[workerIndex]) {
                    this.workerStates[workerIndex].ready = true;
                }
                this.stats.ready = this._areAllWorkersReady();
                break;
            case COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES.RESULT_RANGE:
                this._handleResultRange(message);
                break;
            case COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES.ERROR:
                this.stats.lastError = typeof message.error === 'string'
                    ? message.error
                    : '충돌 narrowphase worker에서 알 수 없는 오류가 보고되었습니다.';
                if (this.workerStates[workerIndex]) {
                    this.workerStates[workerIndex].ready = false;
                }
                this.stats.ready = false;
                this._failInFlightRequest();
                break;
        }
    }

    /**
     * worker range 결과를 현재 요청에 병합합니다.
     * @param {object} message
     * @private
     */
    _handleResultRange(message) {
        const requestId = Number.isInteger(message.requestId) ? message.requestId : -1;
        const inFlightRequest = this.inFlightRequest;
        if (!inFlightRequest || requestId !== inFlightRequest.requestId || requestId < this.stats.lastCompletedRequestId) {
            this.stats.staleDropCount++;
            return;
        }

        const chunkIndex = Number.isInteger(message.chunkIndex) ? message.chunkIndex : 0;
        if (inFlightRequest.completedChunkIndices.has(chunkIndex)) {
            this.stats.staleDropCount++;
            return;
        }

        inFlightRequest.completedChunkIndices.add(chunkIndex);
        inFlightRequest.completedChunkCount++;
        inFlightRequest.resultCount += Number.isInteger(message.resultCount) ? Math.max(0, message.resultCount) : 0;
        inFlightRequest.overflow = inFlightRequest.overflow || message.overflow === true;
        inFlightRequest.resultRanges.push({
            chunkIndex,
            pairStart: Number.isInteger(message.pairStart) ? message.pairStart : 0,
            pairCount: Number.isInteger(message.pairCount) ? message.pairCount : 0,
            resultOffset: Number.isInteger(message.resultOffset) ? message.resultOffset : 0,
            resultCount: Number.isInteger(message.resultCount) ? message.resultCount : 0
        });
        this.stats.completedChunkCount = inFlightRequest.completedChunkCount;
        if (inFlightRequest.completedChunkCount < inFlightRequest.chunkCount) {
            return;
        }

        inFlightRequest.resultRanges.sort((a, b) => a.pairStart - b.pairStart);
        const result = {
            requestId,
            pairCount: inFlightRequest.pairCount,
            resultCount: inFlightRequest.resultCount,
            resultRanges: inFlightRequest.resultRanges,
            resultData: this.contactResultData,
            overflow: inFlightRequest.overflow,
            durationMs: Math.max(0, performance.now() - inFlightRequest.requestedAt)
        };
        this.stats.responseCount++;
        this.stats.lastCompletedRequestId = requestId;
        this.stats.lastLatencyMs = result.durationMs;
        this.stats.lastContactCount = result.resultCount;
        if (result.overflow) {
            this.stats.overflowCount++;
        }

        const resolve = inFlightRequest.resolve;
        this.inFlightRequest = null;
        resolve(result);
    }

    /**
     * 진행 중 요청을 실패 처리합니다.
     * @param {string|null} [errorMessage=null]
     * @private
     */
    _failInFlightRequest(errorMessage = null) {
        if (typeof errorMessage === 'string' && errorMessage.length > 0) {
            this.stats.lastError = errorMessage;
        }
        const inFlightRequest = this.inFlightRequest;
        this.inFlightRequest = null;
        if (inFlightRequest?.resolve) {
            inFlightRequest.resolve(null);
        }
    }

    /**
     * @param {ErrorEvent} event
     * @private
     */
    _handleWorkerError(event) {
        const workerIndex = this._getWorkerIndexFromEvent(event);
        const baseMessage = typeof event?.message === 'string' && event.message.length > 0
            ? event.message
            : '충돌 narrowphase worker 실행 중 오류가 발생했습니다.';
        const fileName = typeof event?.filename === 'string' && event.filename.length > 0
            ? event.filename
            : null;
        const lineNumber = Number.isInteger(event?.lineno) && event.lineno > 0
            ? event.lineno
            : null;
        const columnNumber = Number.isInteger(event?.colno) && event.colno > 0
            ? event.colno
            : null;
        this.stats.lastError = fileName
            ? `${baseMessage} (${fileName}${lineNumber !== null ? `:${lineNumber}` : ''}${columnNumber !== null ? `:${columnNumber}` : ''})`
            : baseMessage;
        if (this.workerStates[workerIndex]) {
            this.workerStates[workerIndex].ready = false;
        }
        this.stats.ready = false;
        this._failInFlightRequest();
    }

    /**
     * @private
     */
    _handleMessageError() {
        this.stats.lastError = '충돌 narrowphase worker 메시지를 역직렬화하지 못했습니다.';
        this.stats.ready = false;
        this._failInFlightRequest();
    }
}
