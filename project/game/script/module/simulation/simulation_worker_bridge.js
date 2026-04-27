import {
    SIMULATION_WORKER_MESSAGE_TYPES,
    createSimulationWorkerMessage,
    isSimulationWorkerMessage,
    normalizeSimulationExecutionPolicy,
    normalizeSimulationFrameContext
} from 'simulation/simulation_protocol.js';
import {
    createGameSceneSharedPresentationSnapshot,
    createGameSceneSharedPresentationTransport,
    exportGameSceneSharedPresentationBuffers,
    GAME_SCENE_SHARED_PRESENTATION_STORAGE_TYPE,
    isGameSceneSharedPresentationSupported,
    readGameSceneSharedPresentationState
} from 'simulation/game_scene_shared_presentation.js';
import { errThrow, getPerformanceDebugger } from 'debug/debug_system.js';

const MAX_PENDING_FIXED_STEP_COUNT = 2;

/**
 * 백프레셔 누적 시 워커가 따라잡으려는 고정 스텝 수를 제한합니다.
 * 과도한 catch-up으로 ack 주기가 무너지는 것을 막기 위한 상한입니다.
 * @param {number|null|undefined} currentFixedStepCount
 * @param {number|null|undefined} nextFixedStepCount
 * @returns {number}
 */
function mergePendingFixedStepCount(currentFixedStepCount, nextFixedStepCount) {
    const currentCount = Number.isInteger(currentFixedStepCount) && currentFixedStepCount > 0
        ? currentFixedStepCount
        : 0;
    const nextCount = Number.isInteger(nextFixedStepCount) && nextFixedStepCount > 0
        ? nextFixedStepCount
        : 0;
    return Math.min(MAX_PENDING_FIXED_STEP_COUNT, currentCount + nextCount);
}

/**
 * 브리지 상태의 기본 스냅샷을 생성합니다.
 * @returns {{supported: boolean, enabled: boolean, running: boolean, ready: boolean, lastFrameId: number, lastAckFrameId: number, lastCommandCount: number, lastError: string|null, lastReadyAt: number, lastMessageAt: number, hasPresentationSnapshot: boolean, workerSnapshot: object|null}}
 */
function createDefaultBridgeStatus() {
    return {
        supported: typeof Worker === 'function',
        enabled: false,
        running: false,
        ready: false,
        lastFrameId: 0,
        lastAckFrameId: 0,
        lastCommandCount: 0,
        lastError: null,
        lastReadyAt: 0,
        lastMessageAt: 0,
        hasPresentationSnapshot: false,
        workerSnapshot: null
    };
}

/**
 * 워커 오류를 콘솔과 디버그 시스템에 노출합니다.
 * errThrow는 내부적으로 예외를 다시 던지므로, 여기서는 로그 목적으로만 호출하고 즉시 삼킵니다.
 * @param {Error|null} error
 * @param {string} message
 */
function reportSimulationWorkerBridgeError(error, message) {
    const safeMessage = typeof message === 'string' && message.length > 0
        ? message
        : '시뮬레이션 워커 오류';

    try {
        errThrow(error, safeMessage, 'error');
    } catch (reportedError) {
        if (reportedError !== error) {
            console.error(reportedError);
        }
    }
}

/**
 * 단순 통계 객체를 얕은 읽기 전용 스냅샷으로 복제합니다.
 * @param {object|null|undefined} stats
 * @returns {object|null}
 */
function cloneFlatStats(stats) {
    return stats && typeof stats === 'object' ? { ...stats } : null;
}

/**
 * ms 단위 숫자 필드를 성능 디버거 샘플로 기록합니다.
 * @param {object} performanceDebugger
 * @param {string} prefix
 * @param {object|null|undefined} stats
 * @param {number} timestamp
 */
function recordDurationFields(performanceDebugger, prefix, stats, timestamp) {
    if (!stats || typeof stats !== 'object') {
        return;
    }

    for (const [fieldName, durationMs] of Object.entries(stats)) {
        if (!fieldName.endsWith('Ms') || !Number.isFinite(durationMs) || durationMs <= 0) {
            continue;
        }

        performanceDebugger.recordSample(
            `${prefix}.${fieldName.slice(0, -2)}`,
            durationMs,
            timestamp
        );
    }
}

/**
 * 워커 스냅샷의 계측 값을 메인 스레드 성능 디버거에 병합합니다.
 * @param {object|null|undefined} workerSnapshot
 * @param {number} [timestamp=performance.now()]
 */
function recordWorkerProfileSamples(workerSnapshot, timestamp = performance.now()) {
    if (!workerSnapshot || typeof workerSnapshot !== 'object') {
        return;
    }

    const performanceDebugger = getPerformanceDebugger();
    if (!performanceDebugger || !performanceDebugger.isEnabled()) {
        return;
    }

    recordDurationFields(performanceDebugger, 'worker.frame', workerSnapshot.profileStats, timestamp);
    recordDurationFields(performanceDebugger, 'worker.collision', workerSnapshot.collisionStats, timestamp);

    const aiStats = workerSnapshot.aiStats;
    if (Number.isFinite(aiStats?.totalMs) && aiStats.totalMs > 0) {
        performanceDebugger.recordSample('worker.ai.total', aiStats.totalMs, timestamp);
    }
    if (aiStats?.policyMs && typeof aiStats.policyMs === 'object') {
        for (const [policyName, durationMs] of Object.entries(aiStats.policyMs)) {
            if (Number.isFinite(durationMs) && durationMs > 0) {
                performanceDebugger.recordSample(`worker.ai.policy.${policyName}`, durationMs, timestamp);
            }
        }
    }

    const enemyAIWorker = workerSnapshot.enemyAIWorker;
    if (Number.isFinite(enemyAIWorker?.lastLatencyMs) && enemyAIWorker.lastLatencyMs > 0) {
        performanceDebugger.recordSample('worker.enemyAI.latency', enemyAIWorker.lastLatencyMs, timestamp);
    }
}

/**
 * @class SimulationWorkerBridge
 * @description 메인 스레드와 시뮬레이션 섀도우 워커 사이의 메시지 전달과 상태 추적을 담당합니다.
 */
export class SimulationWorkerBridge {
    constructor() {
        this.worker = null;
        this.status = createDefaultBridgeStatus();
        this.presentationSnapshot = null;
        this.sharedPresentationTransport = null;
        this.frameSequenceId = 0;
        this.pendingFrameSyncPayload = null;
        this._boundHandleMessage = this._handleMessage.bind(this);
        this._boundHandleWorkerError = this._handleWorkerError.bind(this);
        this._boundHandleMessageError = this._handleMessageError.bind(this);
    }

    /**
     * 브리지를 현재 설정 기준으로 초기화합니다.
     * @param {{enabled?: boolean, bootstrapSnapshot?: object|null}} [options={}]
     * @returns {boolean}
     */
    init(options = {}) {
        const enabled = options.enabled === true;
        const bootstrapSnapshot = options.bootstrapSnapshot ?? null;
        if (!enabled) {
            this.status.enabled = false;
            return false;
        }

        return this.start(bootstrapSnapshot);
    }

    /**
     * 워커 사용 가능 여부를 반환합니다.
     * @returns {boolean}
     */
    isSupported() {
        return this.status.supported === true;
    }

    /**
     * 현재 워커가 실행 중인지 반환합니다.
     * @returns {boolean}
     */
    isRunning() {
        return this.worker !== null && this.status.running === true;
    }

    /**
     * 브리지 현재 상태를 읽기 전용 스냅샷으로 반환합니다.
     * @returns {{supported: boolean, enabled: boolean, running: boolean, ready: boolean, lastFrameId: number, lastAckFrameId: number, lastCommandCount: number, lastError: string|null, lastReadyAt: number, lastMessageAt: number, hasPresentationSnapshot: boolean, workerSnapshot: object|null}}
     */
    getStatusSnapshot() {
        this._syncSharedPresentationStatus();
        const workerSnapshot = this.status.workerSnapshot
            ? {
                ...this.status.workerSnapshot,
                aiStats: this.status.workerSnapshot.aiStats && typeof this.status.workerSnapshot.aiStats === 'object'
                    ? {
                        ...this.status.workerSnapshot.aiStats,
                        policyCounts: this.status.workerSnapshot.aiStats.policyCounts && typeof this.status.workerSnapshot.aiStats.policyCounts === 'object'
                            ? { ...this.status.workerSnapshot.aiStats.policyCounts }
                            : {},
                        policyMs: this.status.workerSnapshot.aiStats.policyMs && typeof this.status.workerSnapshot.aiStats.policyMs === 'object'
                            ? { ...this.status.workerSnapshot.aiStats.policyMs }
                            : {}
                    }
                    : null,
                enemyAIWorker: this.status.workerSnapshot.enemyAIWorker
                    && typeof this.status.workerSnapshot.enemyAIWorker === 'object'
                    ? { ...this.status.workerSnapshot.enemyAIWorker }
                    : null,
                collisionStats: cloneFlatStats(this.status.workerSnapshot.collisionStats),
                profileStats: cloneFlatStats(this.status.workerSnapshot.profileStats)
            }
            : null;
        return {
            ...this.status,
            workerSnapshot
        };
    }

    /**
     * 브리지가 마지막으로 받은 읽기 전용 프레젠테이션 스냅샷을 반환합니다.
     * 반환값은 읽기 전용으로 취급해야 합니다.
     * @returns {{sceneState?: string|null, scene?: object|null}|null}
     */
    getPresentationSnapshot() {
        return this.presentationSnapshot;
    }

    /**
     * 현재 설정 기준으로 워커를 시작하거나 중지합니다.
     * @param {boolean} enabled
     * @param {object|null} [bootstrapSnapshot=null]
     * @returns {boolean}
     */
    setEnabled(enabled, bootstrapSnapshot = null) {
        if (enabled === true) {
            return this.start(bootstrapSnapshot);
        }

        this.stop();
        this.status.enabled = false;
        return false;
    }

    /**
     * 시뮬레이션 워커를 시작합니다.
     * @param {object|null} [bootstrapSnapshot=null]
     * @returns {boolean}
     */
    start(bootstrapSnapshot = null) {
        this.status.enabled = true;

        if (!this.isSupported()) {
            this.status.lastError = '현재 런타임은 Web Worker를 지원하지 않습니다.';
            return false;
        }

        if (!this.worker) {
            const worker = new Worker(new URL('./simulation_worker.js', import.meta.url), {
                type: 'module',
                name: 'cirvivor-simulation-shadow'
            });

            worker.addEventListener('message', this._boundHandleMessage);
            worker.addEventListener('error', this._boundHandleWorkerError);
            worker.addEventListener('messageerror', this._boundHandleMessageError);
            this.worker = worker;
            this.status.running = true;
            this.status.ready = false;
            this.status.lastError = null;
            this.status.lastFrameId = 0;
            this.status.lastAckFrameId = 0;
            this.status.lastCommandCount = 0;
            this.status.hasPresentationSnapshot = false;
            this.presentationSnapshot = null;
            this.frameSequenceId = 0;
            this.pendingFrameSyncPayload = null;
        }

        if (bootstrapSnapshot) {
            this.bootstrap(bootstrapSnapshot);
        }

        return true;
    }

    /**
     * 현재 시뮬레이션 스냅샷으로 워커를 재동기화합니다.
     * @param {object|null} [bootstrapSnapshot=null]
     * @returns {boolean}
     */
    bootstrap(bootstrapSnapshot = null) {
        if (!this.worker || !bootstrapSnapshot) {
            return false;
        }

        this.pendingFrameSyncPayload = null;
        const sharedPresentationBuffers = this._prepareSharedPresentationBootstrap(bootstrapSnapshot);
        const sceneSnapshot = bootstrapSnapshot?.scene?.scene ?? null;
        const useSharedPresentation = sharedPresentationBuffers !== null
            && sceneSnapshot?.sceneType === 'game'
            && this.sharedPresentationTransport !== null;
        this.presentationSnapshot = useSharedPresentation
            ? createGameSceneSharedPresentationSnapshot(
                this.sharedPresentationTransport,
                bootstrapSnapshot?.scene?.sceneState ?? null
            )
            : null;
        this.status.hasPresentationSnapshot = false;

        return this._postMessage(SIMULATION_WORKER_MESSAGE_TYPES.BOOTSTRAP, {
            snapshot: bootstrapSnapshot,
            sharedPresentationBuffers
        });
    }

    /**
     * 한 프레임 분량의 시뮬레이션 상태를 워커로 전달합니다.
     * @param {{frameContext?: object, executionPolicy?: object, frameSnapshot?: object|null, commands?: object[]}} [payload={}]
     * @returns {boolean}
     */
    syncFrame(payload = {}) {
        if (!this.worker || !payload.frameSnapshot) {
            return false;
        }

        this._syncSharedPresentationStatus();
        const nextFramePayload = this._createFrameSyncPayload(payload, this.frameSequenceId + 1);
        this.frameSequenceId = nextFramePayload.frameId;
        return this._queueFrameSyncPayload(nextFramePayload);
    }

    /**
     * 워커를 중지하고 상태를 정리합니다.
     * @returns {boolean}
     */
    stop() {
        if (!this.worker) {
            this.status.running = false;
            this.status.ready = false;
            return false;
        }

        try {
            this._postMessage(SIMULATION_WORKER_MESSAGE_TYPES.SHUTDOWN);
        } catch {
            // 종료 직전 오류는 무시하고 terminate로 정리합니다.
        }

        this.worker.removeEventListener('message', this._boundHandleMessage);
        this.worker.removeEventListener('error', this._boundHandleWorkerError);
        this.worker.removeEventListener('messageerror', this._boundHandleMessageError);
        this.worker.terminate();
        this.worker = null;
        this.status.running = false;
        this.status.ready = false;
        this.status.lastFrameId = 0;
        this.status.lastAckFrameId = 0;
        this.status.lastCommandCount = 0;
        this.status.hasPresentationSnapshot = false;
        this.status.workerSnapshot = null;
        this.presentationSnapshot = null;
        this.sharedPresentationTransport = null;
        this.frameSequenceId = 0;
        this.pendingFrameSyncPayload = null;
        return true;
    }

    /**
     * @private
     * @param {object|null|undefined} bootstrapSnapshot
     * @returns {object|null}
     */
    _prepareSharedPresentationBootstrap(bootstrapSnapshot) {
        const sceneSnapshot = bootstrapSnapshot?.scene?.scene ?? null;
        const isGameScene = sceneSnapshot?.sceneType === 'game';
        if (!isGameScene || !isGameSceneSharedPresentationSupported()) {
            this.sharedPresentationTransport = null;
            return null;
        }

        if (!this.sharedPresentationTransport) {
            this.sharedPresentationTransport = createGameSceneSharedPresentationTransport();
        }
        if (!this.sharedPresentationTransport) {
            return null;
        }

        return exportGameSceneSharedPresentationBuffers(this.sharedPresentationTransport);
    }

    /**
     * @private
     * 메인 스레드 프레임 정보를 워커 메시지용 구조화 복제 가능 payload로 정규화합니다.
     * @param {{frameContext?: object, executionPolicy?: object, frameSnapshot?: object|null, commands?: object[]}} payload
     * @param {number} frameId
     * @returns {{frameId: number, frameContext: {frameDeltaSeconds: number, fixedStepSeconds: number, fixedStepCount: number, fixedAlpha: number}, executionPolicy: {keepLoopRunning: boolean, runFixedStep: boolean, runObjectUpdate: boolean, runSceneUpdate: boolean, renderFrame: boolean}, frameSnapshot: object|null, commands: object[]}}
     */
    _createFrameSyncPayload(payload, frameId) {
        return {
            frameId,
            frameContext: normalizeSimulationFrameContext(payload.frameContext),
            executionPolicy: normalizeSimulationExecutionPolicy(payload.executionPolicy),
            frameSnapshot: payload.frameSnapshot ?? null,
            commands: Array.isArray(payload.commands) ? payload.commands : []
        };
    }

    /**
     * @private
     * 워커에 아직 반영되지 않은 프레임이 있는지 반환합니다.
     * @returns {boolean}
     */
    _hasInflightFrameSync() {
        return this.status.lastFrameId > this.status.lastAckFrameId;
    }

    /**
     * @private
     * 백프레셔 상황에서 새 프레임 payload를 최신 상태 기준으로 병합합니다.
     * 오래된 렌더 스냅샷은 최신 것으로 덮고, 시간/고정 스텝/명령 배치는 누적합니다.
     * @param {{frameId: number, frameContext: {frameDeltaSeconds: number, fixedStepSeconds: number, fixedStepCount: number, fixedAlpha: number}, executionPolicy: {keepLoopRunning: boolean, runFixedStep: boolean, runObjectUpdate: boolean, runSceneUpdate: boolean, renderFrame: boolean}, frameSnapshot: object|null, commands: object[]}|null} currentPayload
     * @param {{frameId: number, frameContext: {frameDeltaSeconds: number, fixedStepSeconds: number, fixedStepCount: number, fixedAlpha: number}, executionPolicy: {keepLoopRunning: boolean, runFixedStep: boolean, runObjectUpdate: boolean, runSceneUpdate: boolean, renderFrame: boolean}, frameSnapshot: object|null, commands: object[]}} nextPayload
     * @returns {{frameId: number, frameContext: {frameDeltaSeconds: number, fixedStepSeconds: number, fixedStepCount: number, fixedAlpha: number}, executionPolicy: {keepLoopRunning: boolean, runFixedStep: boolean, runObjectUpdate: boolean, runSceneUpdate: boolean, renderFrame: boolean}, frameSnapshot: object|null, commands: object[]}}
     */
    _mergeFrameSyncPayload(currentPayload, nextPayload) {
        if (!currentPayload) {
            return nextPayload;
        }

        currentPayload.frameId = nextPayload.frameId;
        currentPayload.frameContext.frameDeltaSeconds = nextPayload.frameContext.frameDeltaSeconds;
        if (nextPayload.frameContext.fixedStepSeconds > 0) {
            currentPayload.frameContext.fixedStepSeconds = nextPayload.frameContext.fixedStepSeconds;
        }
        currentPayload.frameContext.fixedStepCount = mergePendingFixedStepCount(
            currentPayload.frameContext.fixedStepCount,
            nextPayload.frameContext.fixedStepCount
        );
        currentPayload.frameContext.fixedAlpha = nextPayload.frameContext.fixedAlpha;
        currentPayload.executionPolicy.keepLoopRunning = currentPayload.executionPolicy.keepLoopRunning
            || nextPayload.executionPolicy.keepLoopRunning;
        currentPayload.executionPolicy.runFixedStep = currentPayload.executionPolicy.runFixedStep
            || nextPayload.executionPolicy.runFixedStep
            || currentPayload.frameContext.fixedStepCount > 0;
        currentPayload.executionPolicy.runObjectUpdate = currentPayload.executionPolicy.runObjectUpdate
            || nextPayload.executionPolicy.runObjectUpdate;
        currentPayload.executionPolicy.runSceneUpdate = currentPayload.executionPolicy.runSceneUpdate
            || nextPayload.executionPolicy.runSceneUpdate;
        currentPayload.executionPolicy.renderFrame = currentPayload.executionPolicy.renderFrame
            || nextPayload.executionPolicy.renderFrame;
        currentPayload.frameSnapshot = nextPayload.frameSnapshot;
        if (nextPayload.commands.length > 0) {
            currentPayload.commands = currentPayload.commands.length > 0
                ? [...currentPayload.commands, ...nextPayload.commands]
                : [...nextPayload.commands];
        }

        return currentPayload;
    }

    /**
     * @private
     * 프레임 payload를 즉시 전송하거나, 이미 처리 중인 프레임이 있으면 pending 슬롯에 합칩니다.
     * @param {{frameId: number, frameContext: {frameDeltaSeconds: number, fixedStepSeconds: number, fixedStepCount: number, fixedAlpha: number}, executionPolicy: {keepLoopRunning: boolean, runFixedStep: boolean, runObjectUpdate: boolean, runSceneUpdate: boolean, renderFrame: boolean}, frameSnapshot: object|null, commands: object[]}} framePayload
     * @returns {boolean}
     */
    _queueFrameSyncPayload(framePayload) {
        if (!this.worker) {
            return false;
        }

        if (this._hasInflightFrameSync()) {
            this.pendingFrameSyncPayload = this._mergeFrameSyncPayload(this.pendingFrameSyncPayload, framePayload);
            return true;
        }

        if (this.pendingFrameSyncPayload) {
            this.pendingFrameSyncPayload = this._mergeFrameSyncPayload(this.pendingFrameSyncPayload, framePayload);
            return this._flushPendingFrameSync();
        }

        return this._postFrameSyncPayload(framePayload);
    }

    /**
     * @private
     * pending 슬롯에 누적된 최신 프레임 payload를 워커로 전송합니다.
     * @returns {boolean}
     */
    _flushPendingFrameSync() {
        if (!this.pendingFrameSyncPayload || this._hasInflightFrameSync()) {
            return false;
        }

        const framePayload = this.pendingFrameSyncPayload;
        this.pendingFrameSyncPayload = null;
        return this._postFrameSyncPayload(framePayload);
    }

    /**
     * @private
     * 정규화된 프레임 payload를 워커로 전송하고, 브리지 추적 상태를 갱신합니다.
     * @param {{frameId: number, frameContext: {frameDeltaSeconds: number, fixedStepSeconds: number, fixedStepCount: number, fixedAlpha: number}, executionPolicy: {keepLoopRunning: boolean, runFixedStep: boolean, runObjectUpdate: boolean, runSceneUpdate: boolean, renderFrame: boolean}, frameSnapshot: object|null, commands: object[]}} framePayload
     * @returns {boolean}
     */
    _postFrameSyncPayload(framePayload) {
        this.status.lastFrameId = framePayload.frameId;
        this.status.lastCommandCount = framePayload.commands.length;
        return this._postMessage(SIMULATION_WORKER_MESSAGE_TYPES.FRAME_SYNC, framePayload);
    }

    /**
     * @private
     * @param {string} type
     * @param {object} [payload={}]
     * @returns {boolean}
     */
    _postMessage(type, payload = {}) {
        if (!this.worker) {
            return false;
        }

        this.worker.postMessage(createSimulationWorkerMessage(type, payload));
        return true;
    }

    /**
     * @private
     */
    _syncSharedPresentationStatus() {
        if (!this.sharedPresentationTransport
            || this.presentationSnapshot?.scene?.storageType !== GAME_SCENE_SHARED_PRESENTATION_STORAGE_TYPE) {
            return;
        }

        const previousAckFrameId = this.status.lastAckFrameId;
        const sharedState = readGameSceneSharedPresentationState(this.sharedPresentationTransport);
        if (!sharedState) {
            return;
        }

        if (sharedState.version > 0) {
            this.status.hasPresentationSnapshot = true;
        }
        if (sharedState.lastFrameId > this.status.lastAckFrameId) {
            this.status.lastAckFrameId = sharedState.lastFrameId;
        }

        const currentWorkerSnapshot = this.status.workerSnapshot ?? {};
        const currentFrameCounter = Number.isInteger(currentWorkerSnapshot.frameCounter)
            ? currentWorkerSnapshot.frameCounter
            : 0;
        const currentFixedStepCount = Number.isInteger(currentWorkerSnapshot.fixedStepCount)
            ? currentWorkerSnapshot.fixedStepCount
            : 0;
        const currentFixedAlpha = Number.isFinite(currentWorkerSnapshot.fixedAlpha)
            ? currentWorkerSnapshot.fixedAlpha
            : 0;

        this.status.workerSnapshot = {
            ...currentWorkerSnapshot,
            ready: this.status.ready,
            bootstrapped: currentWorkerSnapshot.bootstrapped === true || this.status.ready === true,
            frameCounter: Math.max(currentFrameCounter, sharedState.lastFrameId),
            lastFrameId: sharedState.lastFrameId,
            lastCommandCount: this.status.lastCommandCount,
            sceneState: typeof this.presentationSnapshot?.sceneState === 'string'
                ? this.presentationSnapshot.sceneState
                : (currentWorkerSnapshot.sceneState ?? null),
            sceneType: 'game',
            enemyCount: sharedState.enemyCount,
            projectileCount: sharedState.projectileCount,
            wallCount: sharedState.staticWallCount + sharedState.boxWallCount,
            fixedStepCount: currentFixedStepCount,
            fixedAlpha: currentFixedAlpha,
            mirroredAt: sharedState.lastFrameId > 0
                ? performance.now()
                : (currentWorkerSnapshot.mirroredAt ?? 0)
        };
        if (this.status.lastAckFrameId > previousAckFrameId) {
            this._flushPendingFrameSync();
        }
    }

    /**
     * @private
     * @param {MessageEvent} event
     */
    _handleMessage(event) {
        const message = event.data;
        if (!isSimulationWorkerMessage(message)) {
            return;
        }

        this.status.lastMessageAt = performance.now();
        if (message.workerSnapshot && typeof message.workerSnapshot === 'object') {
            this.status.workerSnapshot = { ...message.workerSnapshot };
            recordWorkerProfileSamples(message.workerSnapshot, this.status.lastMessageAt);
        }
        if (message.presentationSharedState && this.sharedPresentationTransport) {
            const sceneState = typeof message.presentationSharedState.sceneState === 'string'
                ? message.presentationSharedState.sceneState
                : null;
            if (!this.presentationSnapshot
                || this.presentationSnapshot?.scene?.storageType !== GAME_SCENE_SHARED_PRESENTATION_STORAGE_TYPE) {
                this.presentationSnapshot = createGameSceneSharedPresentationSnapshot(
                    this.sharedPresentationTransport,
                    sceneState
                );
            } else {
                this.presentationSnapshot.sceneState = sceneState;
            }
            this.status.hasPresentationSnapshot = true;
        }
        if (message.presentationSnapshot && typeof message.presentationSnapshot === 'object') {
            this.presentationSnapshot = message.presentationSnapshot;
            this.status.hasPresentationSnapshot = true;
        }

        switch (message.type) {
            case SIMULATION_WORKER_MESSAGE_TYPES.READY:
                this.status.ready = true;
                this.status.lastReadyAt = this.status.lastMessageAt;
                this._flushPendingFrameSync();
                break;
            case SIMULATION_WORKER_MESSAGE_TYPES.FRAME_ACK:
                this.status.ready = true;
                this.status.lastAckFrameId = Number.isInteger(message.frameId)
                    ? message.frameId
                    : this.status.lastAckFrameId;
                this._flushPendingFrameSync();
                break;
            case SIMULATION_WORKER_MESSAGE_TYPES.ERROR:
                this.status.lastError = typeof message.error === 'string'
                    ? message.error
                    : '시뮬레이션 워커에서 알 수 없는 오류가 보고되었습니다.';
                reportSimulationWorkerBridgeError(
                    typeof message.stack === 'string' && message.stack.length > 0
                        ? Object.assign(new Error(this.status.lastError), { stack: message.stack })
                        : new Error(this.status.lastError),
                    this.status.lastError
                );
                break;
        }
    }

    /**
     * @private
     * @param {ErrorEvent} event
     */
    _handleWorkerError(event) {
        const baseMessage = typeof event?.message === 'string' && event.message.length > 0
            ? event.message
            : '시뮬레이션 워커 실행 중 오류가 발생했습니다.';
        const fileName = typeof event?.filename === 'string' && event.filename.length > 0
            ? event.filename
            : null;
        const lineNumber = Number.isInteger(event?.lineno) && event.lineno > 0
            ? event.lineno
            : null;
        const columnNumber = Number.isInteger(event?.colno) && event.colno > 0
            ? event.colno
            : null;
        this.status.lastError = fileName
            ? `${baseMessage} (${fileName}${lineNumber !== null ? `:${lineNumber}` : ''}${columnNumber !== null ? `:${columnNumber}` : ''})`
            : baseMessage;
        reportSimulationWorkerBridgeError(event?.error instanceof Error ? event.error : null, this.status.lastError);
    }

    /**
     * @private
     */
    _handleMessageError() {
        this.status.lastError = '시뮬레이션 워커 메시지를 역직렬화하지 못했습니다.';
        reportSimulationWorkerBridgeError(null, this.status.lastError);
    }
}
