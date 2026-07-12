import {
    areCollisionBodyAabbsOverlapping,
    areCollisionBodyBroadCirclesOverlapping,
    shouldUseCollisionNarrowphaseBroadCircleFilter
} from './collision_broad_phase_filter.js';
import { processCollisionEnemyCirclePairSoA } from './collision_enemy_circle_pair_soa.js';
import {
    markCollisionEnemyPairProcessAttempt,
    shouldSkipCollisionEnemyPairByBudget
} from './collision_enemy_pair_budget.js';
import { areCollisionBodiesSameEntity, getCollisionPassRule } from './collision_pair_rule_guard.js';
import { COLLISION_RULE_DYNAMIC_RESOLVE } from './_collision_rules.js';
import { markCollisionEnemySleepObservationIncomplete } from './collision_enemy_sleep_state.js';
import {
    COLLISION_BODY_KIND_ENEMY as BODY_KIND_ENEMY,
    COLLISION_BODY_SHAPE_CIRCLE as BODY_SHAPE_CIRCLE,
    COLLISION_RELATION_INDEX as RELATION_INDEX,
    COLLISION_RELATION_BROAD_STRIDE as RELATION_BROAD_STRIDE
} from './collision_soa_layout.js';

/**
 * 후보 pair 목록을 broad-phase 데이터 기준으로 판정하고 해소합니다.
 * context는 CollisionHandler가 소유한 재사용 레코드입니다.
 * @param {object} context - pair 처리 문맥입니다.
 * @returns {number} 해소된 pair 수입니다.
 */
export function processCollisionCandidatePairs(context) {
    const candidatePairs = context.candidatePairs;
    let resolvedCount = processCollisionCandidatePairRange(
        candidatePairs.priorityLowIndices,
        candidatePairs.priorityHighIndices,
        candidatePairs.priorityCount,
        context.pairStartToken,
        context
    );
    resolvedCount += processCollisionCandidatePairRange(
        candidatePairs.lowIndices,
        candidatePairs.highIndices,
        candidatePairs.count,
        context.pairStartToken + candidatePairs.priorityCount,
        context
    );
    return resolvedCount;
}

/**
 * 하나의 연속 pair 구간을 회전 시작점부터 결정적으로 처리합니다.
 * @param {Int32Array} lowIndices - 낮은 body 인덱스 버퍼입니다.
 * @param {Int32Array} highIndices - 높은 body 인덱스 버퍼입니다.
 * @param {number} count - 유효 pair 수입니다.
 * @param {number} startToken - fixed frame 기반 회전 token입니다.
 * @param {object} context - pair 처리 문맥입니다.
 * @returns {number} 처리된 pair 수입니다.
 */
function processCollisionCandidatePairRange(
    lowIndices,
    highIndices,
    count,
    startToken,
    context
) {
    if (count <= 0) {
        return 0;
    }

    let resolvedCount = 0;
    const bodies = context.bodies;
    const broadphaseBuffer = context.broadphaseBuffer;
    const relationData = broadphaseBuffer.relationData;
    const kindCodes = broadphaseBuffer.bodyKindCodes;
    const shapeCodes = broadphaseBuffer.bodyShapeCodes;
    const startIndex = Math.abs(startToken) % count;
    let pairIndex = startIndex;

    for (let offset = 0; offset < count; offset++) {
        const low = lowIndices[pairIndex];
        const high = highIndices[pairIndex];
        const bodyA = bodies[low];
        const bodyB = bodies[high];

        if (kindCodes[low] === BODY_KIND_ENEMY && kindCodes[high] === BODY_KIND_ENEMY) {
            resolvedCount += processCollisionEnemyCandidatePair(
                low,
                high,
                bodyA,
                bodyB,
                relationData,
                shapeCodes,
                context
            );
        } else {
            resolvedCount += processCollisionObjectCandidatePair(bodyA, bodyB, context);
        }
        pairIndex++;
        if (pairIndex === count) pairIndex = 0;
    }

    return resolvedCount;
}

/**
 * 적-적 후보 pair를 처리합니다.
 * @param {number} low - 낮은 body 인덱스입니다.
 * @param {number} high - 높은 body 인덱스입니다.
 * @param {object} bodyA - 첫 번째 body입니다.
 * @param {object} bodyB - 두 번째 body입니다.
 * @param {Float64Array} relationData - enemy relation SoA입니다.
 * @param {Uint8Array} shapeCodes - body shape 코드 배열입니다.
 * @param {object} context - pair 처리 문맥입니다.
 * @returns {number} 해소된 pair 수입니다.
 */
function processCollisionEnemyCandidatePair(
    low,
    high,
    bodyA,
    bodyB,
    relationData,
    shapeCodes,
    context
) {
    if (!bodyA || !bodyB || areCollisionBodiesSameEntity(bodyA, bodyB)) {
        return 0;
    }

    if (shouldSkipCollisionEnemyPairByBudget(bodyA, bodyB, context.pairBudget)) {
        markCollisionEnemySleepObservationIncomplete(bodyA, bodyB);
        context.profileRecorder.recordCount('solveBudgetSkipCount');
        return 0;
    }

    context.frameStats.collisionCheckCount++;
    const relationOffsetA = low * RELATION_BROAD_STRIDE;
    const relationOffsetB = high * RELATION_BROAD_STRIDE;
    if (isCollisionRelationAabbSeparated(relationData, relationOffsetA, relationOffsetB)) {
        context.frameStats.aabbRejectCount++;
        return 0;
    }

    context.frameStats.aabbPassCount++;
    context.profileRecorder.recordCount('solveAabbPassCount');
    const isCirclePair = shapeCodes[low] === BODY_SHAPE_CIRCLE
        && shapeCodes[high] === BODY_SHAPE_CIRCLE;
    const useNarrowphaseBroadCircle = shouldUseCollisionNarrowphaseBroadCircleFilter(bodyA, bodyB);
    if (useNarrowphaseBroadCircle && isCollisionRelationCircleSeparated(
        relationData,
        relationOffsetA,
        relationOffsetB,
        context.epsilon
    )) {
        context.frameStats.circleRejectCount++;
        return 0;
    }
    if (useNarrowphaseBroadCircle) {
        context.frameStats.circlePassCount++;
        context.profileRecorder.recordCount('solveCirclePassCount');
    }

    markCollisionEnemyPairProcessAttempt(bodyA, bodyB);
    const narrowphaseStart = context.profileRecorder.startTimer();
    const pairResolved = processCollisionEnemyNarrowphase(
        bodyA,
        bodyB,
        relationData,
        relationOffsetA,
        relationOffsetB,
        isCirclePair,
        context
    );
    context.profileRecorder.recordCount(
        isCirclePair ? 'solveSoACirclePairCount' : 'solveObjectNarrowphasePairCount'
    );
    context.profileRecorder.recordDuration('solveNarrowphaseMs', narrowphaseStart);
    if (pairResolved > 0) {
        context.profileRecorder.recordCount('solveResolvedPairCount', pairResolved);
    }
    return pairResolved;
}

/**
 * 일반 후보 pair를 처리합니다.
 * @param {object} bodyA - 첫 번째 body입니다.
 * @param {object} bodyB - 두 번째 body입니다.
 * @param {object} context - pair 처리 문맥입니다.
 * @returns {number} 해소된 pair 수입니다.
 */
function processCollisionObjectCandidatePair(bodyA, bodyB, context) {
    const rule = getCollisionPassRule(bodyA, bodyB, context.applyNonPosition);
    if (!rule) return 0;

    if (shouldSkipCollisionEnemyPairByBudget(bodyA, bodyB, context.pairBudget)) {
        markCollisionEnemySleepObservationIncomplete(bodyA, bodyB);
        context.profileRecorder.recordCount('solveBudgetSkipCount');
        return 0;
    }

    context.frameStats.collisionCheckCount++;
    if (!areCollisionBodyAabbsOverlapping(bodyA, bodyB)) {
        context.frameStats.aabbRejectCount++;
        return 0;
    }
    context.frameStats.aabbPassCount++;
    context.profileRecorder.recordCount('solveAabbPassCount');
    if (shouldUseCollisionNarrowphaseBroadCircleFilter(bodyA, bodyB)) {
        if (!areCollisionBodyBroadCirclesOverlapping(bodyA, bodyB, context.epsilon)) {
            context.frameStats.circleRejectCount++;
            return 0;
        }
        context.frameStats.circlePassCount++;
        context.profileRecorder.recordCount('solveCirclePassCount');
    }

    markCollisionEnemyPairProcessAttempt(bodyA, bodyB);
    const narrowphaseStart = context.profileRecorder.startTimer();
    const pairResolved = context.processObjectPair(
        bodyA,
        bodyB,
        context.resolvePositions,
        context.applyNonPosition,
        context.resolveBoost,
        rule
    );
    context.profileRecorder.recordCount('solveObjectNarrowphasePairCount');
    context.profileRecorder.recordDuration('solveNarrowphaseMs', narrowphaseStart);
    if (pairResolved > 0) {
        context.profileRecorder.recordCount('solveResolvedPairCount', pairResolved);
    }
    return pairResolved;
}

/**
 * 적-적 narrowphase를 실행합니다.
 * @param {object} bodyA - 첫 번째 body입니다.
 * @param {object} bodyB - 두 번째 body입니다.
 * @param {Float64Array} relationData - enemy relation SoA입니다.
 * @param {number} relationOffsetA - 첫 번째 body relation offset입니다.
 * @param {number} relationOffsetB - 두 번째 body relation offset입니다.
 * @param {boolean} isCirclePair - 원형 fast path 여부입니다.
 * @param {object} context - pair 처리 문맥입니다.
 * @returns {number} 해소된 pair 수입니다.
 */
function processCollisionEnemyNarrowphase(
    bodyA,
    bodyB,
    relationData,
    relationOffsetA,
    relationOffsetB,
    isCirclePair,
    context
) {
    if (isCirclePair) {
        return processCollisionEnemyCirclePairSoA(
            bodyA,
            bodyB,
            relationData,
            relationOffsetA,
            relationOffsetB,
            context.resolvePositions,
            context.resolveBoost,
            context.detector,
            context.scratchManifold,
            context.broadphaseBuffer
        );
    }

    return context.processObjectPair(
        bodyA,
        bodyB,
        context.resolvePositions,
        context.applyNonPosition,
        context.resolveBoost,
        COLLISION_RULE_DYNAMIC_RESOLVE
    );
}

/**
 * relation SoA에 저장된 AABB가 분리되어 있는지 반환합니다.
 * @param {Float64Array} relationData - relation SoA입니다.
 * @param {number} relationOffsetA - 첫 번째 body relation offset입니다.
 * @param {number} relationOffsetB - 두 번째 body relation offset입니다.
 * @returns {boolean} 분리되어 있으면 true입니다.
 */
function isCollisionRelationAabbSeparated(relationData, relationOffsetA, relationOffsetB) {
    return (
        relationData[relationOffsetA + RELATION_INDEX.MIN_X] > relationData[relationOffsetB + RELATION_INDEX.MAX_X] ||
        relationData[relationOffsetA + RELATION_INDEX.MAX_X] < relationData[relationOffsetB + RELATION_INDEX.MIN_X] ||
        relationData[relationOffsetA + RELATION_INDEX.MIN_Y] > relationData[relationOffsetB + RELATION_INDEX.MAX_Y] ||
        relationData[relationOffsetA + RELATION_INDEX.MAX_Y] < relationData[relationOffsetB + RELATION_INDEX.MIN_Y]
    );
}

/**
 * relation SoA의 원형 broad-phase가 분리되어 있는지 반환합니다.
 * @param {Float64Array} relationData - relation SoA입니다.
 * @param {number} relationOffsetA - 첫 번째 body relation offset입니다.
 * @param {number} relationOffsetB - 두 번째 body relation offset입니다.
 * @param {number} epsilon - 반경 보정값입니다.
 * @returns {boolean} 분리되어 있으면 true입니다.
 */
function isCollisionRelationCircleSeparated(relationData, relationOffsetA, relationOffsetB, epsilon) {
    const ax = relationData[relationOffsetA + RELATION_INDEX.CENTER_X];
    const ay = relationData[relationOffsetA + RELATION_INDEX.CENTER_Y];
    const bx = relationData[relationOffsetB + RELATION_INDEX.CENTER_X];
    const by = relationData[relationOffsetB + RELATION_INDEX.CENTER_Y];
    const ra = relationData[relationOffsetA + RELATION_INDEX.ENEMY_PAIR_RADIUS];
    const rb = relationData[relationOffsetB + RELATION_INDEX.ENEMY_PAIR_RADIUS];
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
        return false;
    }
    if (!Number.isFinite(ra) || !Number.isFinite(rb) || ra <= 0 || rb <= 0) {
        return false;
    }

    const radiusSum = ra + rb + epsilon;
    const dx = bx - ax;
    const dy = by - ay;
    return ((dx * dx) + (dy * dy)) > (radiusSum * radiusSum);
}
