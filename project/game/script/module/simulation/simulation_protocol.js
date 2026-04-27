export const SIMULATION_WORKER_MESSAGE_TYPES = Object.freeze({
    BOOTSTRAP: 'simulationWorker.bootstrap',
    FRAME_SYNC: 'simulationWorker.frameSync',
    SHUTDOWN: 'simulationWorker.shutdown',
    READY: 'simulationWorker.ready',
    FRAME_ACK: 'simulationWorker.frameAck',
    ERROR: 'simulationWorker.error'
});

/**
 * 워커 메시지 형태인지 검사합니다.
 * @param {object|null|undefined} message
 * @returns {boolean}
 */
export function isSimulationWorkerMessage(message) {
    return !!message && typeof message.type === 'string' && message.type.length > 0;
}

/**
 * 표준 시뮬레이션 워커 메시지 객체를 생성합니다.
 * @param {string} type
 * @param {object} [payload={}]
 * @returns {{type: string} & object}
 */
export function createSimulationWorkerMessage(type, payload = {}) {
    return {
        type,
        ...payload
    };
}

/**
 * 프레임 컨텍스트를 구조화 복제 가능한 숫자 중심 객체로 정규화합니다.
 * @param {object} [frameContext={}]
 * @returns {{frameDeltaSeconds: number, fixedStepSeconds: number, fixedStepCount: number, fixedAlpha: number}}
 */
export function normalizeSimulationFrameContext(frameContext = {}) {
    return {
        frameDeltaSeconds: Number.isFinite(frameContext.frameDeltaSeconds) ? frameContext.frameDeltaSeconds : 0,
        fixedStepSeconds: Number.isFinite(frameContext.fixedStepSeconds) ? frameContext.fixedStepSeconds : 0,
        fixedStepCount: Number.isInteger(frameContext.fixedStepCount) ? frameContext.fixedStepCount : 0,
        fixedAlpha: Number.isFinite(frameContext.fixedAlpha) ? frameContext.fixedAlpha : 0
    };
}

/**
 * 실행 정책 중 워커가 추적할 최소 필드를 정규화합니다.
 * @param {object} [executionPolicy={}]
 * @returns {{keepLoopRunning: boolean, runFixedStep: boolean, runObjectUpdate: boolean, runSceneUpdate: boolean, renderFrame: boolean}}
 */
export function normalizeSimulationExecutionPolicy(executionPolicy = {}) {
    return {
        keepLoopRunning: executionPolicy.keepLoopRunning === true,
        runFixedStep: executionPolicy.runFixedStep === true,
        runObjectUpdate: executionPolicy.runObjectUpdate === true,
        runSceneUpdate: executionPolicy.runSceneUpdate === true,
        renderFrame: executionPolicy.renderFrame === true
    };
}

/**
 * 단순 숫자 필드 중심 통계 객체를 구조화 복제 가능한 형태로 복제합니다.
 * @param {object|null|undefined} stats
 * @returns {object|null}
 */
function cloneFlatStats(stats) {
    if (!stats || typeof stats !== 'object') {
        return null;
    }

    const clonedStats = {};
    for (const [key, value] of Object.entries(stats)) {
        clonedStats[key] = Number.isFinite(value) || typeof value === 'boolean' || typeof value === 'string'
            ? value
            : (value === null ? null : value);
    }
    return clonedStats;
}

/**
 * 워커 상태를 읽기 쉬운 경량 스냅샷으로 변환합니다.
 * @param {object} [state={}]
 * @returns {{ready: boolean, shadowMode: boolean, bootstrapped: boolean, frameCounter: number, lastFrameId: number, lastCommandCount: number, sceneState: string|null, sceneType: string|null, enemyCount: number, projectileCount: number, wallCount: number, fixedStepCount: number, fixedAlpha: number, mirroredAt: number, aiStats: object|null, enemyAIWorker: object|null, collisionStats: object|null, profileStats: object|null}}
 */
export function createSimulationWorkerSnapshot(state = {}) {
    const sceneState = typeof state.sceneState === 'string' ? state.sceneState : null;
    const sceneType = typeof state.sceneType === 'string' ? state.sceneType : null;
    const aiStats = state.aiStats && typeof state.aiStats === 'object'
        ? {
            ...state.aiStats,
            policyCounts: state.aiStats.policyCounts && typeof state.aiStats.policyCounts === 'object'
                ? { ...state.aiStats.policyCounts }
                : {},
            policyMs: state.aiStats.policyMs && typeof state.aiStats.policyMs === 'object'
                ? { ...state.aiStats.policyMs }
                : {}
        }
        : null;

    return {
        ready: state.ready === true,
        shadowMode: true,
        bootstrapped: state.bootstrapped === true,
        frameCounter: Number.isInteger(state.frameCounter) ? state.frameCounter : 0,
        lastFrameId: Number.isInteger(state.lastFrameId) ? state.lastFrameId : 0,
        lastCommandCount: Number.isInteger(state.lastCommandCount) ? state.lastCommandCount : 0,
        sceneState,
        sceneType,
        enemyCount: Number.isInteger(state.enemyCount) ? state.enemyCount : 0,
        projectileCount: Number.isInteger(state.projectileCount) ? state.projectileCount : 0,
        wallCount: Number.isInteger(state.wallCount) ? state.wallCount : 0,
        fixedStepCount: Number.isInteger(state.fixedStepCount) ? state.fixedStepCount : 0,
        fixedAlpha: Number.isFinite(state.fixedAlpha) ? state.fixedAlpha : 0,
        mirroredAt: Number.isFinite(state.mirroredAt) ? state.mirroredAt : 0,
        aiStats,
        collisionStats: cloneFlatStats(state.collisionStats),
        profileStats: cloneFlatStats(state.profileStats),
        enemyAIWorker: state.enemyAIWorker && typeof state.enemyAIWorker === 'object'
            ? { ...state.enemyAIWorker }
            : null
    };
}
