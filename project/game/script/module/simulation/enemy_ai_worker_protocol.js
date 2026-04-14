export const ENEMY_AI_WORKER_MESSAGE_TYPES = Object.freeze({
    BOOTSTRAP: 'enemyAIWorker.bootstrap',
    COMPUTE_BATCH: 'enemyAIWorker.computeBatch',
    RESULT_BATCH: 'enemyAIWorker.resultBatch',
    READY: 'enemyAIWorker.ready',
    ERROR: 'enemyAIWorker.error',
    SHUTDOWN: 'enemyAIWorker.shutdown'
});

/**
 * 적 AI 워커 메시지 형태인지 검사합니다.
 * @param {object|null|undefined} message
 * @returns {boolean}
 */
export function isEnemyAIWorkerMessage(message) {
    return !!message && typeof message.type === 'string' && message.type.length > 0;
}

/**
 * 표준 적 AI 워커 메시지 객체를 생성합니다.
 * @param {string} type
 * @param {object} [payload={}]
 * @returns {{type: string} & object}
 */
export function createEnemyAIWorkerMessage(type, payload = {}) {
    return {
        type,
        ...payload
    };
}
