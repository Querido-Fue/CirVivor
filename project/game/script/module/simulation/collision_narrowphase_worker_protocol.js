export const COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES = Object.freeze({
    BOOTSTRAP: 'collisionNarrowphaseWorker.bootstrap',
    COMPUTE_RANGE: 'collisionNarrowphaseWorker.computeRange',
    RESULT_RANGE: 'collisionNarrowphaseWorker.resultRange',
    READY: 'collisionNarrowphaseWorker.ready',
    ERROR: 'collisionNarrowphaseWorker.error',
    SHUTDOWN: 'collisionNarrowphaseWorker.shutdown'
});

export const COLLISION_NARROWPHASE_COMPLETION_STRIDE = 6;

export const COLLISION_NARROWPHASE_COMPLETION_INDEX = Object.freeze({
    STATE: 0,
    REQUEST_ID: 1,
    RESULT_COUNT: 2,
    OVERFLOW: 3,
    DURATION_US: 4,
    SKIPPED_PAIR_COUNT: 5
});

export const COLLISION_NARROWPHASE_COMPLETION_STATE = Object.freeze({
    IDLE: 0,
    RUNNING: 1,
    DONE: 2,
    ERROR: 3
});

/**
 * 충돌 narrowphase 워커 메시지 형태인지 검사합니다.
 * @param {object|null|undefined} message
 * @returns {boolean}
 */
export function isCollisionNarrowphaseWorkerMessage(message) {
    return !!message && typeof message.type === 'string' && message.type.length > 0;
}

/**
 * 표준 충돌 narrowphase 워커 메시지 객체를 생성합니다.
 * @param {string} type
 * @param {object} [payload={}]
 * @returns {{type: string} & object}
 */
export function createCollisionNarrowphaseWorkerMessage(type, payload = {}) {
    return {
        type,
        ...payload
    };
}
