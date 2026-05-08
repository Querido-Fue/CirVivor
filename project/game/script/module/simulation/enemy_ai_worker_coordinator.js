import {
    ENEMY_AI_WORKER_MESSAGE_TYPES,
    createEnemyAIWorkerMessage,
    isEnemyAIWorkerMessage
} from './enemy_ai_worker_protocol.js';
import {
    createEnemyAISharedTransport,
    exportEnemyAISharedTransportBuffers,
    getEnemyAISharedNextResultSlotIndex,
    isEnemyAISharedTransportSupported,
    publishEnemyAISharedResultSlot,
    readEnemyAISharedResultAt,
    readEnemyAISharedResultRangeState,
    readEnemyAISharedResultState
} from './enemy_ai_shared_transport.js';
import { getSimulationRuntimeSnapshot } from './simulation_runtime.js';

const ENEMY_AI_WORKER_POOL_MAX_SIZE = 3;
const ENEMY_AI_WORKER_POOL_RESERVED_THREAD_COUNT = 2;

/**
 * 적 AI 워커 코디네이터 기본 통계를 생성합니다.
 * @returns {{supported: boolean, running: boolean, ready: boolean, requestCount: number, responseCount: number, fallbackCount: number, staleDropCount: number, lastRequestId: number, lastCompletedRequestId: number, lastLatencyMs: number, waitMs: number, lastEnemyCount: number, poolSize: number, chunkCount: number, completedChunkCount: number, chunkResponseCount: number, sharedResultRangeCount: number, latestRequestedWallsVersion: number, latestRequestedEnemyTopologyVersion: number, lastWallsVersion: number, lastEnemyTopologyVersion: number, transportSupported: boolean, transportMode: string, lastSharedResultVersion: number, lastError: string|null}}
 */
function createDefaultEnemyAIWorkerStats() {
    return {
        supported: typeof Worker === 'function',
        running: false,
        ready: false,
        requestCount: 0,
        responseCount: 0,
        fallbackCount: 0,
        staleDropCount: 0,
        lastRequestId: 0,
        lastCompletedRequestId: 0,
        lastLatencyMs: 0,
        waitMs: 0,
        lastEnemyCount: 0,
        poolSize: 0,
        chunkCount: 0,
        completedChunkCount: 0,
        chunkResponseCount: 0,
        sharedResultRangeCount: 0,
        latestRequestedWallsVersion: -1,
        latestRequestedEnemyTopologyVersion: -1,
        lastWallsVersion: -1,
        lastEnemyTopologyVersion: -1,
        transportSupported: isEnemyAISharedTransportSupported(),
        transportMode: 'message',
        lastSharedResultVersion: 0,
        lastError: null
    };
}

/**
 * 안전한 hardware concurrency 값을 반환합니다.
 * @returns {number|null}
 */
function getEnemyAIWorkerHardwareConcurrency() {
    const hardwareConcurrency = globalThis.navigator?.hardwareConcurrency;
    return Number.isInteger(hardwareConcurrency) && hardwareConcurrency > 0
        ? hardwareConcurrency
        : null;
}

/**
 * 현재 런타임 설정 기준 적 AI 워커 pool 크기를 계산합니다.
 * @returns {number}
 */
function resolveEnemyAIWorkerPoolSize() {
    const runtimeSettings = getSimulationRuntimeSnapshot()?.settings ?? {};
    if (runtimeSettings.simulationWorkerAuthorityMode !== true) {
        return 1;
    }

    const hardwareConcurrency = getEnemyAIWorkerHardwareConcurrency();
    if (hardwareConcurrency === null) {
        return 2;
    }

    return Math.max(
        1,
        Math.min(
            ENEMY_AI_WORKER_POOL_MAX_SIZE,
            hardwareConcurrency - ENEMY_AI_WORKER_POOL_RESERVED_THREAD_COUNT
        )
    );
}

/**
 * 적 AI 워커를 관리하는 코디네이터입니다.
 */
export class EnemyAIWorkerCoordinator {
    constructor() {
        this.worker = null;
        this.workers = [];
        this.workerStates = [];
        this.workerIndexByInstance = new Map();
        this.pendingRequest = null;
        this.inFlightRequest = null;
        this.latestResultsByEnemyId = new Map();
        this.latestWallsVersion = -1;
        this.latestEnemyTopologyVersion = -1;
        this.latestRequestedWallsVersion = -1;
        this.latestRequestedEnemyTopologyVersion = -1;
        this.sharedResultTransport = null;
        this.sharedResultState = null;
        this.sharedResultScratch = null;
        this.requestSequence = 0;
        this.stats = createDefaultEnemyAIWorkerStats();
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
     * 현재 최신 원격 결과를 반환합니다.
     * @param {number|null|undefined} enemyId
     * @param {number|null|undefined} wallsVersion
     * @param {number|null|undefined} enemyTopologyVersion
     * @returns {object|null}
     */
    getResult(enemyId, wallsVersion, enemyTopologyVersion) {
        if (!Number.isInteger(enemyId)) {
            return null;
        }

        if (Number.isInteger(wallsVersion) && wallsVersion >= 0 && this.latestWallsVersion !== wallsVersion) {
            return null;
        }
        if (Number.isInteger(enemyTopologyVersion)
            && enemyTopologyVersion >= 0
            && this.latestEnemyTopologyVersion !== enemyTopologyVersion) {
            return null;
        }

        return this.latestResultsByEnemyId.get(enemyId) ?? null;
    }

    /**
     * 적 AI 워커 시작을 보장합니다.
     * @returns {boolean}
     */
    ensureStarted() {
        if (this.workers.length > 0) {
            return true;
        }

        if (typeof Worker !== 'function') {
            this.stats.supported = false;
            this.stats.lastError = '중첩 Web Worker를 지원하지 않는 런타임입니다.';
            return false;
        }

        try {
            const poolSize = resolveEnemyAIWorkerPoolSize();
            const useSharedResultTransport = isEnemyAISharedTransportSupported();
            if (useSharedResultTransport && !this.sharedResultTransport) {
                this.sharedResultTransport = createEnemyAISharedTransport();
            }
            if (!useSharedResultTransport) {
                this.sharedResultTransport = null;
            }

            const sharedResultBuffers = useSharedResultTransport && this.sharedResultTransport
                ? exportEnemyAISharedTransportBuffers(this.sharedResultTransport)
                : null;

            for (let workerIndex = 0; workerIndex < poolSize; workerIndex++) {
                this._spawnWorker(workerIndex, sharedResultBuffers);
            }

            this.worker = this.workers[0] ?? null;
            this.stats.running = true;
            this.stats.ready = false;
            this.stats.lastError = null;
            this.stats.poolSize = this.workers.length;
            this.stats.transportMode = sharedResultBuffers
                ? (this.workers.length === 1 ? 'sab' : 'sab-pool')
                : 'message';
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
     * 내부 pool 워커 하나를 생성하고 bootstrap 메시지를 보냅니다.
     * @param {number} workerIndex
     * @param {object|null} sharedResultBuffers
     * @private
     */
    _spawnWorker(workerIndex, sharedResultBuffers) {
        const worker = new Worker(new URL('./enemy_ai_worker.js', import.meta.url), {
            type: 'module',
            name: `cirvivor-enemy-ai-${workerIndex}`
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
        worker.postMessage(createEnemyAIWorkerMessage(ENEMY_AI_WORKER_MESSAGE_TYPES.BOOTSTRAP, {
            runtimeSnapshot: getSimulationRuntimeSnapshot(),
            sharedResultBuffers,
            workerIndex
        }));
    }

    /**
     * 모든 pool 워커가 bootstrap을 끝냈는지 반환합니다.
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
     * 최신 배치를 워커로 보내거나 pending 슬롯에 덮어씁니다.
     * @param {object} payload
     * @returns {boolean}
     */
    requestBatch(payload) {
        const enemies = Array.isArray(payload?.enemies) ? payload.enemies : [];
        if (enemies.length === 0) {
            return false;
        }

        if (!this.ensureStarted()) {
            return false;
        }

        const requestPayload = {
            requestId: ++this.requestSequence,
            requestedAt: performance.now(),
            runtimeSnapshot: getSimulationRuntimeSnapshot(),
            ...payload
        };
        this.latestRequestedWallsVersion = Number.isInteger(requestPayload.wallsVersion)
            ? requestPayload.wallsVersion
            : -1;
        this.latestRequestedEnemyTopologyVersion = Number.isInteger(requestPayload.enemyTopologyVersion)
            ? requestPayload.enemyTopologyVersion
            : -1;
        this.stats.lastRequestId = requestPayload.requestId;
        this.stats.latestRequestedWallsVersion = this.latestRequestedWallsVersion;
        this.stats.latestRequestedEnemyTopologyVersion = this.latestRequestedEnemyTopologyVersion;

        if (!this.isReady() || this.inFlightRequest) {
            this.pendingRequest = requestPayload;
            return true;
        }

        return this._postBatch(requestPayload);
    }

    /**
     * 활성 적 집합 기준으로 내부 캐시를 정리합니다.
     * @param {Set<number>} activeEnemyIds
     */
    reconcileActiveEnemyIds(activeEnemyIds) {
        if (!(activeEnemyIds instanceof Set) || this.latestResultsByEnemyId.size === 0) {
            return;
        }

        for (const enemyId of this.latestResultsByEnemyId.keys()) {
            if (!activeEnemyIds.has(enemyId)) {
                this.latestResultsByEnemyId.delete(enemyId);
            }
        }
    }

    /**
     * local fallback 사용 횟수를 기록합니다.
     * @param {number} [count=1]
     */
    recordFallback(count = 1) {
        const safeCount = Number.isFinite(count) ? Math.max(0, count) : 1;
        this.stats.fallbackCount += safeCount;
    }

    /**
     * 현재 통계 스냅샷을 반환합니다.
     * @returns {{supported: boolean, running: boolean, ready: boolean, requestCount: number, responseCount: number, fallbackCount: number, staleDropCount: number, lastRequestId: number, lastCompletedRequestId: number, lastLatencyMs: number, waitMs: number, lastEnemyCount: number, poolSize: number, chunkCount: number, completedChunkCount: number, chunkResponseCount: number, sharedResultRangeCount: number, latestRequestedWallsVersion: number, latestRequestedEnemyTopologyVersion: number, lastWallsVersion: number, lastEnemyTopologyVersion: number, transportSupported: boolean, transportMode: string, lastSharedResultVersion: number, lastError: string|null}}
     */
    getStatsSnapshot() {
        return {
            ...this.stats
        };
    }

    /**
     * 워커를 중지하고 상태를 초기화합니다.
     */
    stop() {
        for (let i = 0; i < this.workers.length; i++) {
            const worker = this.workers[i];
            if (!worker) {
                continue;
            }
            try {
                worker.postMessage(createEnemyAIWorkerMessage(ENEMY_AI_WORKER_MESSAGE_TYPES.SHUTDOWN));
            } catch {
                // 종료 직전 오류는 무시합니다.
            }
            worker.removeEventListener('message', this._boundHandleMessage);
            worker.removeEventListener('error', this._boundHandleWorkerError);
            worker.removeEventListener('messageerror', this._boundHandleMessageError);
            worker.terminate();
        }

        this.worker = null;
        this.workers.length = 0;
        this.workerStates.length = 0;
        this.workerIndexByInstance.clear();
        this.pendingRequest = null;
        this.inFlightRequest = null;
        this.latestResultsByEnemyId.clear();
        this.latestWallsVersion = -1;
        this.latestEnemyTopologyVersion = -1;
        this.latestRequestedWallsVersion = -1;
        this.latestRequestedEnemyTopologyVersion = -1;
        this.sharedResultTransport = null;
        this.sharedResultState = null;
        this.sharedResultScratch = null;
        this.stats.running = false;
        this.stats.ready = false;
        this.stats.poolSize = 0;
        this.stats.chunkCount = 0;
        this.stats.completedChunkCount = 0;
        this.stats.sharedResultRangeCount = 0;
        this.stats.waitMs = 0;
        this.stats.latestRequestedWallsVersion = -1;
        this.stats.latestRequestedEnemyTopologyVersion = -1;
        this.stats.lastWallsVersion = -1;
        this.stats.lastEnemyTopologyVersion = -1;
        this.stats.transportMode = 'message';
        this.stats.lastSharedResultVersion = 0;
    }

    /**
     * @private
     * @param {object} payload
     * @returns {boolean}
     */
    _postBatch(payload) {
        if (this.workers.length === 0) {
            return false;
        }

        const useSharedResultRanges = this.sharedResultTransport !== null && this.workers.length > 1;
        const sharedResultSlot = useSharedResultRanges
            ? getEnemyAISharedNextResultSlotIndex(this.sharedResultTransport)
            : -1;
        const chunks = this._createBatchChunks(payload, {
            useSharedResultRanges,
            sharedResultSlot
        });
        if (chunks.length === 0) {
            return false;
        }

        this.inFlightRequest = {
            requestId: payload.requestId,
            requestedAt: payload.requestedAt,
            wallsVersion: Number.isInteger(payload.wallsVersion) ? payload.wallsVersion : -1,
            enemyTopologyVersion: Number.isInteger(payload.enemyTopologyVersion) ? payload.enemyTopologyVersion : -1,
            enemyCount: Array.isArray(payload.enemies) ? payload.enemies.length : 0,
            chunkCount: chunks.length,
            completedChunkCount: 0,
            remainingChunkCount: chunks.length,
            completedChunkIndices: new Set(),
            sharedResultSlot,
            sharedResultRangeCount: 0,
            sharedResultRanges: [],
            resultsByEnemyId: new Map()
        };
        this.stats.requestCount++;
        this.stats.chunkCount = chunks.length;
        this.stats.completedChunkCount = 0;
        this.stats.poolSize = this.workers.length;
        this.stats.waitMs = 0;
        this.stats.sharedResultRangeCount = 0;

        for (let i = 0; i < chunks.length; i++) {
            const worker = this.workers[chunks[i].workerIndex] ?? this.workers[i % this.workers.length];
            if (!worker) {
                this._failInFlightRequest('적 AI 워커 chunk를 보낼 수 없습니다.');
                return false;
            }
            try {
                worker.postMessage(createEnemyAIWorkerMessage(
                    ENEMY_AI_WORKER_MESSAGE_TYPES.COMPUTE_BATCH,
                    chunks[i]
                ));
            } catch (error) {
                this._failInFlightRequest(error instanceof Error ? error.message : String(error));
                return false;
            }
        }
        return true;
    }

    /**
     * 요청 배치를 pool worker별 chunk로 나눕니다.
     * @param {object} payload
     * @param {{useSharedResultRanges?: boolean, sharedResultSlot?: number}} [options={}]
     * @returns {object[]}
     * @private
     */
    _createBatchChunks(payload, options = {}) {
        const enemies = Array.isArray(payload?.enemies) ? payload.enemies : [];
        if (enemies.length === 0) {
            return [];
        }

        const poolSize = Math.max(1, this.workers.length);
        if (poolSize <= 1 || enemies.length <= 1) {
            return [{
                ...payload,
                requestGroupId: payload.requestId,
                chunkIndex: 0,
                chunkCount: 1,
                workerIndex: 0
            }];
        }

        const chunkCount = Math.min(poolSize, enemies.length);
        const chunks = [];
        for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
            const startIndex = Math.floor((enemies.length * chunkIndex) / chunkCount);
            const endIndex = Math.floor((enemies.length * (chunkIndex + 1)) / chunkCount);
            chunks.push({
                ...payload,
                requestGroupId: payload.requestId,
                chunkIndex,
                chunkCount,
                workerIndex: chunkIndex % poolSize,
                ...(options.useSharedResultRanges === true ? {
                    sharedResultSlot: options.sharedResultSlot,
                    sharedResultOffset: startIndex,
                    sharedResultCapacity: Math.max(0, endIndex - startIndex)
                } : {}),
                targetEnemies: enemies.slice(startIndex, endIndex)
            });
        }

        return chunks;
    }

    /**
     * @private
     */
    _flushPendingRequest() {
        if (!this.pendingRequest || this.inFlightRequest || !this.isReady()) {
            return false;
        }

        const nextPayload = this.pendingRequest;
        this.pendingRequest = null;
        return this._postBatch(nextPayload);
    }

    /**
     * 진행 중인 요청을 실패 처리하고 pending 요청을 다시 시도합니다.
     * @param {string|null} [errorMessage=null]
     * @private
     */
    _failInFlightRequest(errorMessage = null) {
        if (typeof errorMessage === 'string' && errorMessage.length > 0) {
            this.stats.lastError = errorMessage;
        }
        this.inFlightRequest = null;
        this.stats.completedChunkCount = 0;
        this._flushPendingRequest();
    }

    /**
     * @private
     * @param {MessageEvent} event
     */
    _handleMessage(event) {
        const message = event.data;
        if (!isEnemyAIWorkerMessage(message)) {
            return;
        }

        const workerIndex = Number.isInteger(message.workerIndex)
            ? message.workerIndex
            : this._getWorkerIndexFromEvent(event);
        switch (message.type) {
            case ENEMY_AI_WORKER_MESSAGE_TYPES.READY:
                if (message.bootstrapped !== true) {
                    break;
                }
                if (this.workerStates[workerIndex]) {
                    this.workerStates[workerIndex].ready = true;
                }
                this.stats.ready = this._areAllWorkersReady();
                if (this.stats.ready === true) {
                    this._flushPendingRequest();
                }
                break;
            case ENEMY_AI_WORKER_MESSAGE_TYPES.RESULT_BATCH:
                this._handleResultBatch(message);
                break;
            case ENEMY_AI_WORKER_MESSAGE_TYPES.ERROR:
                this.stats.lastError = typeof message.error === 'string'
                    ? message.error
                    : '적 AI 워커에서 알 수 없는 오류가 보고되었습니다.';
                if (this.workerStates[workerIndex]) {
                    this.workerStates[workerIndex].ready = false;
                }
                this.stats.ready = false;
                this._failInFlightRequest();
                break;
        }
    }

    /**
     * @private
     * @param {object} message
     */
    _handleResultBatch(message) {
        const requestId = Number.isInteger(message.requestId) ? message.requestId : -1;
        const inFlightRequest = this.inFlightRequest;
        if (!inFlightRequest || requestId !== inFlightRequest.requestId || requestId < this.stats.lastCompletedRequestId) {
            this.stats.staleDropCount++;
            this._flushPendingRequest();
            return;
        }

        const resultWallsVersion = Number.isInteger(message.wallsVersion) ? message.wallsVersion : -1;
        const resultEnemyTopologyVersion = Number.isInteger(message.enemyTopologyVersion)
            ? message.enemyTopologyVersion
            : -1;
        if ((this.latestRequestedWallsVersion >= 0 && resultWallsVersion !== this.latestRequestedWallsVersion)
            || (this.latestRequestedEnemyTopologyVersion >= 0
                && resultEnemyTopologyVersion !== this.latestRequestedEnemyTopologyVersion)) {
            this.stats.staleDropCount++;
            this.inFlightRequest = null;
            this._flushPendingRequest();
            return;
        }

        const chunkIndex = Number.isInteger(message.chunkIndex) ? message.chunkIndex : 0;
        if (inFlightRequest.completedChunkIndices.has(chunkIndex)) {
            this.stats.staleDropCount++;
            return;
        }

        const chunkResults = this._readResultBatchResults(
            message,
            requestId,
            resultWallsVersion,
            resultEnemyTopologyVersion
        );
        if (!chunkResults) {
            this.stats.staleDropCount++;
            this.inFlightRequest = null;
            this._flushPendingRequest();
            return;
        }

        if (chunkResults.sharedResultRange) {
            inFlightRequest.sharedResultRanges.push(chunkResults.sharedResultRange);
            inFlightRequest.sharedResultRangeCount++;
            this.stats.sharedResultRangeCount = inFlightRequest.sharedResultRangeCount;
        }
        for (const [enemyId, result] of chunkResults.resultsByEnemyId.entries()) {
            inFlightRequest.resultsByEnemyId.set(enemyId, result);
        }

        inFlightRequest.completedChunkIndices.add(chunkIndex);
        inFlightRequest.completedChunkCount++;
        inFlightRequest.remainingChunkCount = Math.max(0, inFlightRequest.remainingChunkCount - 1);
        this.stats.chunkResponseCount++;
        this.stats.completedChunkCount = inFlightRequest.completedChunkCount;
        if (inFlightRequest.remainingChunkCount > 0) {
            return;
        }

        this.latestResultsByEnemyId.clear();
        for (const [enemyId, result] of inFlightRequest.resultsByEnemyId.entries()) {
            this.latestResultsByEnemyId.set(enemyId, result);
        }

        this.latestWallsVersion = resultWallsVersion;
        this.latestEnemyTopologyVersion = resultEnemyTopologyVersion;
        if (inFlightRequest.sharedResultRangeCount > 0 && this.sharedResultTransport) {
            const sharedResult = publishEnemyAISharedResultSlot(
                this.sharedResultTransport,
                inFlightRequest.sharedResultSlot,
                requestId,
                resultWallsVersion,
                resultEnemyTopologyVersion,
                inFlightRequest.resultsByEnemyId.size
            );
            this.stats.lastSharedResultVersion = Number.isInteger(sharedResult?.version)
                ? sharedResult.version
                : this.stats.lastSharedResultVersion;
        }
        this.stats.responseCount++;
        this.stats.lastCompletedRequestId = requestId;
        this.stats.lastLatencyMs = Math.max(0, performance.now() - inFlightRequest.requestedAt);
        this.stats.waitMs = this.stats.lastLatencyMs;
        this.stats.lastEnemyCount = inFlightRequest.enemyCount;
        this.stats.lastWallsVersion = this.latestWallsVersion;
        this.stats.lastEnemyTopologyVersion = this.latestEnemyTopologyVersion;
        this.inFlightRequest = null;
        this._flushPendingRequest();
    }

    /**
     * 워커 결과 메시지를 id 기준 결과 Map으로 정규화합니다.
     * @param {object} message
     * @param {number} requestId
     * @param {number} resultWallsVersion
     * @param {number} resultEnemyTopologyVersion
     * @returns {{resultsByEnemyId: Map<number, object>, appliedEnemyCount: number, sharedResultRange: object|null}|null}
     * @private
     */
    _readResultBatchResults(message, requestId, resultWallsVersion, resultEnemyTopologyVersion) {
        const resultsByEnemyId = new Map();
        let appliedEnemyCount = 0;
        let sharedResultRange = null;
        if (Number.isInteger(message.sharedResultSlot)
            && Number.isInteger(message.sharedResultOffset)
            && Number.isInteger(message.sharedResultCount)
            && message.sharedResultCount > 0
            && this.sharedResultTransport) {
            const sharedState = readEnemyAISharedResultRangeState(
                this.sharedResultTransport,
                {
                    slotIndex: message.sharedResultSlot,
                    resultOffset: message.sharedResultOffset,
                    resultCount: message.sharedResultCount,
                    requestId,
                    wallsVersion: resultWallsVersion,
                    enemyTopologyVersion: resultEnemyTopologyVersion
                },
                this.sharedResultState
            );
            this.sharedResultState = sharedState;
            if (!sharedState) {
                return null;
            }

            const sharedScratch = this.sharedResultScratch && typeof this.sharedResultScratch === 'object'
                ? this.sharedResultScratch
                : {
                    acc: { x: 0, y: 0 },
                    enemyAIState: {}
                };
            this.sharedResultScratch = sharedScratch;
            for (let i = 0; i < sharedState.resultCount; i++) {
                const result = readEnemyAISharedResultAt(sharedState, i, sharedScratch);
                if (!Number.isInteger(result?.id)) {
                    continue;
                }

                resultsByEnemyId.set(result.id, {
                    id: result.id,
                    acc: {
                        x: Number.isFinite(result.acc?.x) ? result.acc.x : 0,
                        y: Number.isFinite(result.acc?.y) ? result.acc.y : 0
                    },
                    accSpeed: Number.isFinite(result.accSpeed) ? result.accSpeed : 0,
                    enemyAIState: result.enemyAIState && typeof result.enemyAIState === 'object'
                        ? { ...result.enemyAIState }
                        : null
                });
                appliedEnemyCount++;
            }
            sharedResultRange = {
                slotIndex: message.sharedResultSlot,
                resultOffset: message.sharedResultOffset,
                resultCount: sharedState.resultCount
            };
        } else if (message.sharedResult === true && this.sharedResultTransport) {
            const sharedState = readEnemyAISharedResultState(
                this.sharedResultTransport,
                this.sharedResultState
            );
            this.sharedResultState = sharedState;
            const sharedResultVersion = Number.isInteger(message.sharedResultVersion)
                ? message.sharedResultVersion
                : 0;
            if (!sharedState
                || sharedState.requestId !== requestId
                || sharedState.wallsVersion !== resultWallsVersion
                || sharedState.enemyTopologyVersion !== resultEnemyTopologyVersion
                || (sharedResultVersion > 0 && sharedState.version !== sharedResultVersion)) {
                return null;
            }

            const sharedScratch = this.sharedResultScratch && typeof this.sharedResultScratch === 'object'
                ? this.sharedResultScratch
                : {
                    acc: { x: 0, y: 0 },
                    enemyAIState: {}
                };
            this.sharedResultScratch = sharedScratch;
            for (let i = 0; i < sharedState.resultCount; i++) {
                const result = readEnemyAISharedResultAt(sharedState, i, sharedScratch);
                if (!Number.isInteger(result?.id)) {
                    continue;
                }

                resultsByEnemyId.set(result.id, {
                    id: result.id,
                    acc: {
                        x: Number.isFinite(result.acc?.x) ? result.acc.x : 0,
                        y: Number.isFinite(result.acc?.y) ? result.acc.y : 0
                    },
                    accSpeed: Number.isFinite(result.accSpeed) ? result.accSpeed : 0,
                    enemyAIState: result.enemyAIState && typeof result.enemyAIState === 'object'
                        ? { ...result.enemyAIState }
                        : null
                });
                appliedEnemyCount++;
            }
            this.stats.lastSharedResultVersion = sharedState.version;
        } else {
            const results = Array.isArray(message.results) ? message.results : [];
            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                if (!Number.isInteger(result?.id)) {
                    continue;
                }
                resultsByEnemyId.set(result.id, {
                    id: result.id,
                    acc: result.acc && typeof result.acc === 'object'
                        ? {
                            x: Number.isFinite(result.acc.x) ? result.acc.x : 0,
                            y: Number.isFinite(result.acc.y) ? result.acc.y : 0
                        }
                        : { x: 0, y: 0 },
                    accSpeed: Number.isFinite(result.accSpeed) ? result.accSpeed : 0,
                    enemyAIState: result.enemyAIState && typeof result.enemyAIState === 'object'
                        ? { ...result.enemyAIState }
                        : null
                });
                appliedEnemyCount++;
            }
            this.stats.lastSharedResultVersion = 0;
        }

        return {
            resultsByEnemyId,
            appliedEnemyCount,
            sharedResultRange
        };
    }

    /**
     * @private
     * @param {ErrorEvent} event
     */
    _handleWorkerError(event) {
        const workerIndex = this._getWorkerIndexFromEvent(event);
        const baseMessage = typeof event?.message === 'string' && event.message.length > 0
            ? event.message
            : '적 AI 워커 실행 중 오류가 발생했습니다.';
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
        this.stats.lastError = '적 AI 워커 메시지를 역직렬화하지 못했습니다.';
        this.stats.ready = false;
        this._failInFlightRequest();
    }
}
