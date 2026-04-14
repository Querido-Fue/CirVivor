import {
    ENEMY_AI_WORKER_MESSAGE_TYPES,
    createEnemyAIWorkerMessage,
    isEnemyAIWorkerMessage
} from './enemy_ai_worker_protocol.js';
import {
    createEnemyAISharedTransport,
    exportEnemyAISharedTransportBuffers,
    isEnemyAISharedTransportSupported,
    readEnemyAISharedResultAt,
    readEnemyAISharedResultState
} from './enemy_ai_shared_transport.js';
import { getSimulationRuntimeSnapshot } from './simulation_runtime.js';

/**
 * 적 AI 워커 코디네이터 기본 통계를 생성합니다.
 * @returns {{supported: boolean, running: boolean, ready: boolean, requestCount: number, responseCount: number, fallbackCount: number, staleDropCount: number, lastRequestId: number, lastCompletedRequestId: number, lastLatencyMs: number, lastEnemyCount: number, latestRequestedWallsVersion: number, latestRequestedEnemyTopologyVersion: number, lastWallsVersion: number, lastEnemyTopologyVersion: number, transportSupported: boolean, transportMode: string, lastSharedResultVersion: number, lastError: string|null}}
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
        lastEnemyCount: 0,
        latestRequestedWallsVersion: -1,
        latestRequestedEnemyTopologyVersion: -1,
        lastWallsVersion: -1,
        lastEnemyTopologyVersion: -1,
        transportSupported: isEnemyAISharedTransportSupported(),
        transportMode: isEnemyAISharedTransportSupported() ? 'message' : 'unavailable',
        lastSharedResultVersion: 0,
        lastError: null
    };
}

/**
 * 적 AI 워커를 관리하는 코디네이터입니다.
 */
export class EnemyAIWorkerCoordinator {
    constructor() {
        this.worker = null;
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
        return this.stats.ready === true && this.worker !== null;
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
        if (this.worker) {
            return true;
        }

        if (typeof Worker !== 'function') {
            this.stats.supported = false;
            this.stats.lastError = '중첩 Web Worker를 지원하지 않는 런타임입니다.';
            return false;
        }

        try {
            if (!this.sharedResultTransport && isEnemyAISharedTransportSupported()) {
                this.sharedResultTransport = createEnemyAISharedTransport();
            }
            const sharedResultBuffers = this.sharedResultTransport
                ? exportEnemyAISharedTransportBuffers(this.sharedResultTransport)
                : null;
            const worker = new Worker(new URL('./enemy_ai_worker.js', import.meta.url), {
                type: 'module',
                name: 'cirvivor-enemy-ai'
            });
            worker.addEventListener('message', this._boundHandleMessage);
            worker.addEventListener('error', this._boundHandleWorkerError);
            worker.addEventListener('messageerror', this._boundHandleMessageError);
            this.worker = worker;
            this.stats.running = true;
            this.stats.ready = false;
            this.stats.lastError = null;
            this.stats.transportMode = sharedResultBuffers
                ? 'sab'
                : (this.stats.transportSupported ? 'message' : 'unavailable');
            this.worker.postMessage(createEnemyAIWorkerMessage(ENEMY_AI_WORKER_MESSAGE_TYPES.BOOTSTRAP, {
                runtimeSnapshot: getSimulationRuntimeSnapshot(),
                sharedResultBuffers
            }));
            return true;
        } catch (error) {
            this.stats.lastError = error instanceof Error ? error.message : String(error);
            this.stats.running = false;
            this.stats.ready = false;
            this.worker = null;
            return false;
        }
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
     * @returns {{supported: boolean, running: boolean, ready: boolean, requestCount: number, responseCount: number, fallbackCount: number, staleDropCount: number, lastRequestId: number, lastCompletedRequestId: number, lastLatencyMs: number, lastEnemyCount: number, latestRequestedWallsVersion: number, latestRequestedEnemyTopologyVersion: number, lastWallsVersion: number, lastEnemyTopologyVersion: number, transportSupported: boolean, transportMode: string, lastSharedResultVersion: number, lastError: string|null}}
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
        if (this.worker) {
            try {
                this.worker.postMessage(createEnemyAIWorkerMessage(ENEMY_AI_WORKER_MESSAGE_TYPES.SHUTDOWN));
            } catch {
                // 종료 직전 오류는 무시합니다.
            }
            this.worker.removeEventListener('message', this._boundHandleMessage);
            this.worker.removeEventListener('error', this._boundHandleWorkerError);
            this.worker.removeEventListener('messageerror', this._boundHandleMessageError);
            this.worker.terminate();
        }

        this.worker = null;
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
        this.stats.latestRequestedWallsVersion = -1;
        this.stats.latestRequestedEnemyTopologyVersion = -1;
        this.stats.lastWallsVersion = -1;
        this.stats.lastEnemyTopologyVersion = -1;
        this.stats.transportMode = this.stats.transportSupported ? 'message' : 'unavailable';
        this.stats.lastSharedResultVersion = 0;
    }

    /**
     * @private
     * @param {object} payload
     * @returns {boolean}
     */
    _postBatch(payload) {
        if (!this.worker) {
            return false;
        }

        this.inFlightRequest = {
            requestId: payload.requestId,
            requestedAt: payload.requestedAt
        };
        this.stats.requestCount++;
        this.worker.postMessage(createEnemyAIWorkerMessage(
            ENEMY_AI_WORKER_MESSAGE_TYPES.COMPUTE_BATCH,
            payload
        ));
        return true;
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
     * @private
     * @param {MessageEvent} event
     */
    _handleMessage(event) {
        const message = event.data;
        if (!isEnemyAIWorkerMessage(message)) {
            return;
        }

        switch (message.type) {
            case ENEMY_AI_WORKER_MESSAGE_TYPES.READY:
                this.stats.ready = true;
                this._flushPendingRequest();
                break;
            case ENEMY_AI_WORKER_MESSAGE_TYPES.RESULT_BATCH:
                this._handleResultBatch(message);
                break;
            case ENEMY_AI_WORKER_MESSAGE_TYPES.ERROR:
                this.stats.lastError = typeof message.error === 'string'
                    ? message.error
                    : '적 AI 워커에서 알 수 없는 오류가 보고되었습니다.';
                break;
        }
    }

    /**
     * @private
     * @param {object} message
     */
    _handleResultBatch(message) {
        const requestId = Number.isInteger(message.requestId) ? message.requestId : -1;
        if (requestId < this.stats.lastCompletedRequestId) {
            this.inFlightRequest = null;
            this.stats.staleDropCount++;
            this._flushPendingRequest();
            return;
        }

        const latencyBase = this.inFlightRequest && this.inFlightRequest.requestId === requestId
            ? this.inFlightRequest.requestedAt
            : 0;
        this.inFlightRequest = null;
        const resultWallsVersion = Number.isInteger(message.wallsVersion) ? message.wallsVersion : -1;
        const resultEnemyTopologyVersion = Number.isInteger(message.enemyTopologyVersion)
            ? message.enemyTopologyVersion
            : -1;
        if ((this.latestRequestedWallsVersion >= 0 && resultWallsVersion !== this.latestRequestedWallsVersion)
            || (this.latestRequestedEnemyTopologyVersion >= 0
                && resultEnemyTopologyVersion !== this.latestRequestedEnemyTopologyVersion)) {
            this.stats.staleDropCount++;
            this._flushPendingRequest();
            return;
        }

        this.latestResultsByEnemyId.clear();
        let appliedEnemyCount = 0;
        if (message.sharedResult === true && this.sharedResultTransport) {
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
                this.stats.staleDropCount++;
                this._flushPendingRequest();
                return;
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

                this.latestResultsByEnemyId.set(result.id, {
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
                this.latestResultsByEnemyId.set(result.id, {
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

        this.latestWallsVersion = resultWallsVersion;
        this.latestEnemyTopologyVersion = resultEnemyTopologyVersion;
        this.stats.responseCount++;
        this.stats.lastCompletedRequestId = requestId;
        this.stats.lastLatencyMs = latencyBase > 0 ? Math.max(0, performance.now() - latencyBase) : 0;
        this.stats.lastEnemyCount = Number.isInteger(message.enemyCount) ? message.enemyCount : appliedEnemyCount;
        this.stats.lastWallsVersion = this.latestWallsVersion;
        this.stats.lastEnemyTopologyVersion = this.latestEnemyTopologyVersion;
        this._flushPendingRequest();
    }

    /**
     * @private
     * @param {ErrorEvent} event
     */
    _handleWorkerError(event) {
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
        this.stats.ready = false;
    }

    /**
     * @private
     */
    _handleMessageError() {
        this.stats.lastError = '적 AI 워커 메시지를 역직렬화하지 못했습니다.';
        this.stats.ready = false;
    }
}
