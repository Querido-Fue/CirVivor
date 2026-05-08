import {
    COLLISION_BODY_KIND_ENEMY,
    COLLISION_BODY_SHAPE_CIRCLE,
    COLLISION_CONTACT_RESULT_INDEX,
    COLLISION_CONTACT_RESULT_STRIDE,
    COLLISION_RELATION_BROAD_STRIDE,
    COLLISION_RELATION_INDEX
} from '../physics/collision_soa_layout.js';
import {
    COLLISION_NARROWPHASE_COMPLETION_INDEX,
    COLLISION_NARROWPHASE_COMPLETION_STATE,
    COLLISION_NARROWPHASE_COMPLETION_STRIDE,
    COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES,
    createCollisionNarrowphaseWorkerMessage,
    isCollisionNarrowphaseWorkerMessage
} from './collision_narrowphase_worker_protocol.js';

const EPSILON = 1e-6;

let collisionNarrowphaseWorkerIndex = -1;
let relationData = null;
let bodyKindCodes = null;
let bodyShapeCodes = null;
let pairLowIndices = null;
let pairHighIndices = null;
let contactResultData = null;

/**
 * ArrayBuffer 또는 SharedArrayBuffer 인스턴스인지 검사합니다.
 * @param {unknown} buffer
 * @returns {boolean}
 */
function isBufferLike(buffer) {
    return buffer instanceof ArrayBuffer
        || (typeof SharedArrayBuffer === 'function' && buffer instanceof SharedArrayBuffer);
}

/**
 * 숫자를 정수 범위로 정규화합니다.
 * @param {number|null|undefined} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function normalizeIntRange(value, fallback, min, max) {
    const safeValue = Number.isInteger(value) ? value : fallback;
    return Math.max(min, Math.min(max, safeValue));
}

/**
 * 공유 버퍼를 워커 내부 typed array view로 연결합니다.
 * @param {object|null|undefined} sharedBuffers
 */
function attachCollisionNarrowphaseSharedBuffers(sharedBuffers) {
    if (!sharedBuffers || typeof sharedBuffers !== 'object') {
        throw new Error('충돌 narrowphase 공유 버퍼가 없습니다.');
    }

    if (!isBufferLike(sharedBuffers.relationBuffer)
        || !isBufferLike(sharedBuffers.bodyKindBuffer)
        || !isBufferLike(sharedBuffers.bodyShapeBuffer)
        || !isBufferLike(sharedBuffers.pairLowBuffer)
        || !isBufferLike(sharedBuffers.pairHighBuffer)
        || !isBufferLike(sharedBuffers.contactResultBuffer)) {
        throw new Error('충돌 narrowphase 공유 버퍼 형식이 올바르지 않습니다.');
    }

    relationData = new Float64Array(sharedBuffers.relationBuffer);
    bodyKindCodes = new Uint8Array(sharedBuffers.bodyKindBuffer);
    bodyShapeCodes = new Uint8Array(sharedBuffers.bodyShapeBuffer);
    pairLowIndices = new Int32Array(sharedBuffers.pairLowBuffer);
    pairHighIndices = new Int32Array(sharedBuffers.pairHighBuffer);
    contactResultData = new Float64Array(sharedBuffers.contactResultBuffer);
}

/**
 * 현재 메시지를 계산할 수 있는 공유 view가 준비되었는지 반환합니다.
 * @returns {boolean}
 */
function hasCollisionNarrowphaseViews() {
    return relationData instanceof Float64Array
        && bodyKindCodes instanceof Uint8Array
        && bodyShapeCodes instanceof Uint8Array
        && pairLowIndices instanceof Int32Array
        && pairHighIndices instanceof Int32Array
        && contactResultData instanceof Float64Array;
}

/**
 * enemy circle pair contact 결과 한 줄을 기록합니다.
 * @param {number} rowIndex
 * @param {number} pairIndex
 * @param {number} bodyAIndex
 * @param {number} bodyBIndex
 * @param {number} normalX
 * @param {number} normalY
 * @param {number} penetration
 * @param {number} pointX
 * @param {number} pointY
 */
function writeContactResult(
    rowIndex,
    pairIndex,
    bodyAIndex,
    bodyBIndex,
    normalX,
    normalY,
    penetration,
    pointX,
    pointY
) {
    const offset = rowIndex * COLLISION_CONTACT_RESULT_STRIDE;
    contactResultData[offset + COLLISION_CONTACT_RESULT_INDEX.PAIR_INDEX] = pairIndex;
    contactResultData[offset + COLLISION_CONTACT_RESULT_INDEX.BODY_A_INDEX] = bodyAIndex;
    contactResultData[offset + COLLISION_CONTACT_RESULT_INDEX.BODY_B_INDEX] = bodyBIndex;
    contactResultData[offset + COLLISION_CONTACT_RESULT_INDEX.NORMAL_X] = normalX;
    contactResultData[offset + COLLISION_CONTACT_RESULT_INDEX.NORMAL_Y] = normalY;
    contactResultData[offset + COLLISION_CONTACT_RESULT_INDEX.PENETRATION] = penetration;
    contactResultData[offset + COLLISION_CONTACT_RESULT_INDEX.POINT_X] = pointX;
    contactResultData[offset + COLLISION_CONTACT_RESULT_INDEX.POINT_Y] = pointY;
}

/**
 * enemy circle pair 하나의 contact를 생성합니다.
 * @param {number} pairIndex
 * @param {number} low
 * @param {number} high
 * @returns {{normalX: number, normalY: number, penetration: number, pointX: number, pointY: number}|null}
 */
function computeEnemyCircleContact(pairIndex, low, high) {
    if (bodyKindCodes[low] !== COLLISION_BODY_KIND_ENEMY
        || bodyKindCodes[high] !== COLLISION_BODY_KIND_ENEMY
        || bodyShapeCodes[low] !== COLLISION_BODY_SHAPE_CIRCLE
        || bodyShapeCodes[high] !== COLLISION_BODY_SHAPE_CIRCLE) {
        return null;
    }

    const relationOffsetA = low * COLLISION_RELATION_BROAD_STRIDE;
    const relationOffsetB = high * COLLISION_RELATION_BROAD_STRIDE;
    if (
        relationData[relationOffsetA + COLLISION_RELATION_INDEX.MIN_X]
            > relationData[relationOffsetB + COLLISION_RELATION_INDEX.MAX_X]
        || relationData[relationOffsetA + COLLISION_RELATION_INDEX.MAX_X]
            < relationData[relationOffsetB + COLLISION_RELATION_INDEX.MIN_X]
        || relationData[relationOffsetA + COLLISION_RELATION_INDEX.MIN_Y]
            > relationData[relationOffsetB + COLLISION_RELATION_INDEX.MAX_Y]
        || relationData[relationOffsetA + COLLISION_RELATION_INDEX.MAX_Y]
            < relationData[relationOffsetB + COLLISION_RELATION_INDEX.MIN_Y]
    ) {
        return null;
    }

    const ax = relationData[relationOffsetA + COLLISION_RELATION_INDEX.CENTER_X];
    const ay = relationData[relationOffsetA + COLLISION_RELATION_INDEX.CENTER_Y];
    const bx = relationData[relationOffsetB + COLLISION_RELATION_INDEX.CENTER_X];
    const by = relationData[relationOffsetB + COLLISION_RELATION_INDEX.CENTER_Y];
    const radiusA = relationData[relationOffsetA + COLLISION_RELATION_INDEX.ENEMY_PAIR_RADIUS];
    const radiusB = relationData[relationOffsetB + COLLISION_RELATION_INDEX.ENEMY_PAIR_RADIUS];
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(radiusA) || radiusA <= 0
        || !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(radiusB) || radiusB <= 0) {
        return null;
    }

    const dx = bx - ax;
    const dy = by - ay;
    const radiusSum = radiusA + radiusB;
    const distSq = (dx * dx) + (dy * dy);
    if (distSq >= (radiusSum * radiusSum)) {
        return null;
    }

    let distance = Math.sqrt(distSq);
    let normalX = 1;
    let normalY = 0;
    if (distance > EPSILON) {
        normalX = dx / distance;
        normalY = dy / distance;
    } else {
        distance = 0;
    }

    const penetration = radiusSum - distance;
    return {
        normalX,
        normalY,
        penetration,
        pointX: ax + (normalX * radiusA),
        pointY: ay + (normalY * radiusA),
        pairIndex
    };
}

/**
 * 전달된 pair range의 enemy circle contact 결과를 공유 결과 버퍼에 기록합니다.
 * @param {object} message
 * @returns {object}
 */
function computeCollisionNarrowphaseRange(message) {
    if (!hasCollisionNarrowphaseViews()) {
        throw new Error('충돌 narrowphase 워커가 bootstrap되지 않았습니다.');
    }

    const startTime = performance.now();
    const bodyCount = normalizeIntRange(message.bodyCount, 0, 0, bodyKindCodes.length);
    const maxPairCount = normalizeIntRange(
        message.maxPairCount,
        Math.min(pairLowIndices.length, pairHighIndices.length),
        0,
        Math.min(pairLowIndices.length, pairHighIndices.length)
    );
    const pairStart = normalizeIntRange(message.pairStart, 0, 0, maxPairCount);
    const requestedPairCount = normalizeIntRange(message.pairCount, 0, 0, maxPairCount - pairStart);
    const pairEnd = Math.min(maxPairCount, pairStart + requestedPairCount);
    const maxResultRows = Math.floor(contactResultData.length / COLLISION_CONTACT_RESULT_STRIDE);
    const resultOffset = normalizeIntRange(message.resultOffset, 0, 0, maxResultRows);
    const resultCapacity = normalizeIntRange(message.resultCapacity, 0, 0, maxResultRows - resultOffset);

    let resultCount = 0;
    let overflow = false;
    let skippedPairCount = 0;
    for (let pairIndex = pairStart; pairIndex < pairEnd; pairIndex++) {
        const low = pairLowIndices[pairIndex];
        const high = pairHighIndices[pairIndex];
        if (low < 0 || high < 0 || low >= bodyCount || high >= bodyCount || low === high) {
            skippedPairCount++;
            continue;
        }

        const contact = computeEnemyCircleContact(pairIndex, low, high);
        if (!contact) {
            continue;
        }

        if (resultCount >= resultCapacity) {
            overflow = true;
            break;
        }

        writeContactResult(
            resultOffset + resultCount,
            pairIndex,
            low,
            high,
            contact.normalX,
            contact.normalY,
            contact.penetration,
            contact.pointX,
            contact.pointY
        );
        resultCount++;
    }

    return {
        requestId: Number.isInteger(message.requestId) ? message.requestId : 0,
        requestGroupId: Number.isInteger(message.requestGroupId) ? message.requestGroupId : 0,
        chunkIndex: Number.isInteger(message.chunkIndex) ? message.chunkIndex : 0,
        chunkCount: Number.isInteger(message.chunkCount) ? message.chunkCount : 1,
        workerIndex: Number.isInteger(message.workerIndex) ? message.workerIndex : collisionNarrowphaseWorkerIndex,
        pairStart,
        pairCount: Math.max(0, pairEnd - pairStart),
        resultOffset,
        resultCapacity,
        resultCount,
        skippedPairCount,
        overflow,
        durationMs: Math.max(0, performance.now() - startTime)
    };
}

/**
 * 동기 대기 호출자를 깨우기 위해 completion buffer에 결과를 기록합니다.
 * @param {object|null|undefined} message
 * @param {object|null|undefined} result
 * @param {number} state
 */
function signalCollisionNarrowphaseCompletion(message, result, state) {
    if (typeof Atomics !== 'object' || !isBufferLike(message?.completionBuffer)) {
        return;
    }

    const completionOffset = Number.isInteger(message.completionOffset) ? message.completionOffset : -1;
    const completionState = new Int32Array(message.completionBuffer);
    if (completionOffset < 0 || completionOffset + COLLISION_NARROWPHASE_COMPLETION_STRIDE > completionState.length) {
        return;
    }

    Atomics.store(
        completionState,
        completionOffset + COLLISION_NARROWPHASE_COMPLETION_INDEX.REQUEST_ID,
        Number.isInteger(result?.requestId) ? result.requestId : (Number.isInteger(message.requestId) ? message.requestId : 0)
    );
    Atomics.store(
        completionState,
        completionOffset + COLLISION_NARROWPHASE_COMPLETION_INDEX.RESULT_COUNT,
        Number.isInteger(result?.resultCount) ? Math.max(0, result.resultCount) : 0
    );
    Atomics.store(
        completionState,
        completionOffset + COLLISION_NARROWPHASE_COMPLETION_INDEX.OVERFLOW,
        result?.overflow === true ? 1 : 0
    );
    Atomics.store(
        completionState,
        completionOffset + COLLISION_NARROWPHASE_COMPLETION_INDEX.DURATION_US,
        Number.isFinite(result?.durationMs) ? Math.max(0, Math.round(result.durationMs * 1000)) : 0
    );
    Atomics.store(
        completionState,
        completionOffset + COLLISION_NARROWPHASE_COMPLETION_INDEX.SKIPPED_PAIR_COUNT,
        Number.isInteger(result?.skippedPairCount) ? Math.max(0, result.skippedPairCount) : 0
    );
    Atomics.store(completionState, completionOffset + COLLISION_NARROWPHASE_COMPLETION_INDEX.STATE, state);
    Atomics.notify(completionState, completionOffset + COLLISION_NARROWPHASE_COMPLETION_INDEX.STATE, 1);
}

/**
 * 워커 내부 오류를 상위 워커에 보고합니다.
 * @param {unknown} error
 */
function reportCollisionNarrowphaseWorkerError(error) {
    const message = error instanceof Error
        ? error.message
        : String(error);
    const stack = error instanceof Error && typeof error.stack === 'string'
        ? error.stack
        : null;
    console.error('[collision-narrowphase-worker]', message, error);
    self.postMessage(createCollisionNarrowphaseWorkerMessage(COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES.ERROR, {
        error: message,
        stack,
        workerIndex: collisionNarrowphaseWorkerIndex
    }));
}

self.addEventListener('message', (event) => {
    let message = null;
    try {
        message = event.data;
        if (!isCollisionNarrowphaseWorkerMessage(message)) {
            return;
        }

        switch (message.type) {
            case COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES.BOOTSTRAP:
                collisionNarrowphaseWorkerIndex = Number.isInteger(message.workerIndex)
                    ? message.workerIndex
                    : collisionNarrowphaseWorkerIndex;
                attachCollisionNarrowphaseSharedBuffers(message.sharedBuffers);
                self.postMessage(createCollisionNarrowphaseWorkerMessage(COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES.READY, {
                    bootstrapped: true,
                    workerIndex: collisionNarrowphaseWorkerIndex
                }));
                break;
            case COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES.COMPUTE_RANGE:
                {
                    const result = computeCollisionNarrowphaseRange(message);
                    signalCollisionNarrowphaseCompletion(
                        message,
                        result,
                        COLLISION_NARROWPHASE_COMPLETION_STATE.DONE
                    );
                    if (message.suppressResultMessage !== true) {
                        self.postMessage(createCollisionNarrowphaseWorkerMessage(
                            COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES.RESULT_RANGE,
                            result
                        ));
                    }
                }
                break;
            case COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES.SHUTDOWN:
                self.close();
                break;
        }
    } catch (error) {
        signalCollisionNarrowphaseCompletion(
            message,
            null,
            COLLISION_NARROWPHASE_COMPLETION_STATE.ERROR
        );
        reportCollisionNarrowphaseWorkerError(error);
    }
});

self.postMessage(createCollisionNarrowphaseWorkerMessage(COLLISION_NARROWPHASE_WORKER_MESSAGE_TYPES.READY, {
    bootstrapped: false,
    workerIndex: collisionNarrowphaseWorkerIndex
}));
