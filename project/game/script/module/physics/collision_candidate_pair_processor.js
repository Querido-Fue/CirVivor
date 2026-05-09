import {
    areCollisionBodyAabbsOverlapping,
    areCollisionBodyBroadCirclesOverlapping,
    shouldUseCollisionBroadCircleFilter
} from './collision_broad_phase_filter.js';
import { processCollisionEnemyCirclePairSoA } from './collision_enemy_circle_pair_soa.js';
import {
    markCollisionEnemyPairProcessAttempt,
    shouldSkipCollisionEnemyPairByBudget
} from './collision_enemy_pair_budget.js';
import { areCollisionBodiesSameEntity, getCollisionPassRule } from './collision_pair_rule_guard.js';
import { COLLISION_RULE_DYNAMIC_RESOLVE } from './_collision_rules.js';
import {
    COLLISION_BODY_KIND_ENEMY as BODY_KIND_ENEMY,
    COLLISION_BODY_SHAPE_CIRCLE as BODY_SHAPE_CIRCLE,
    COLLISION_RELATION_INDEX as RELATION_INDEX,
    COLLISION_RELATION_BROAD_STRIDE as RELATION_BROAD_STRIDE
} from './collision_soa_layout.js';

/**
 * 후보 pair 목록을 broad-phase 데이터 기준으로 판정하고 해소합니다.
 * @param {object} options - pair 처리 옵션입니다.
 * @param {object[]} options.bodies - 충돌 body 목록입니다.
 * @param {object} options.candidatePairs - 후보 pair 버퍼입니다.
 * @param {object} options.broadphaseBuffer - broad-phase SoA 버퍼입니다.
 * @param {object} options.frameStats - 프레임 통계 객체입니다.
 * @param {object} options.profileRecorder - 충돌 프로파일 레코더입니다.
 * @param {number} options.pairBudget - 적-적 pair 처리 예산입니다.
 * @param {boolean} options.resolvePositions - 위치 해소 여부입니다.
 * @param {boolean} options.applyNonPosition - 비위치 효과 적용 여부입니다.
 * @param {number} options.resolveBoost - 위치 해소 강화 배율입니다.
 * @param {object} options.detector - 충돌 detector입니다.
 * @param {object} options.scratchManifold - 재사용 manifold 객체입니다.
 * @param {Function} options.processObjectPair - object narrowphase 처리 콜백입니다.
 * @param {number} options.epsilon - 원형 broad-phase 보정값입니다.
 * @returns {number} 해소된 pair 수입니다.
 */
export function processCollisionCandidatePairs({
    bodies,
    candidatePairs,
    broadphaseBuffer,
    frameStats,
    profileRecorder,
    pairBudget,
    resolvePositions,
    applyNonPosition,
    resolveBoost,
    detector,
    scratchManifold,
    processObjectPair,
    epsilon
}) {
    let resolvedCount = 0;
    const relationData = broadphaseBuffer.relationData;
    const kindCodes = broadphaseBuffer.bodyKindCodes;
    const shapeCodes = broadphaseBuffer.bodyShapeCodes;
    const lowIndices = candidatePairs.lowIndices;
    const highIndices = candidatePairs.highIndices;

    for (let pairIndex = 0; pairIndex < candidatePairs.count; pairIndex++) {
        const low = lowIndices[pairIndex];
        const high = highIndices[pairIndex];
        const bodyA = bodies[low];
        const bodyB = bodies[high];

        if (kindCodes[low] === BODY_KIND_ENEMY && kindCodes[high] === BODY_KIND_ENEMY) {
            resolvedCount += processCollisionEnemyCandidatePair({
                low,
                high,
                bodyA,
                bodyB,
                relationData,
                shapeCodes,
                frameStats,
                profileRecorder,
                pairBudget,
                resolvePositions,
                applyNonPosition,
                resolveBoost,
                detector,
                scratchManifold,
                broadphaseBuffer,
                processObjectPair,
                epsilon
            });
            continue;
        }

        resolvedCount += processCollisionObjectCandidatePair({
            bodyA,
            bodyB,
            frameStats,
            profileRecorder,
            pairBudget,
            resolvePositions,
            applyNonPosition,
            resolveBoost,
            processObjectPair,
            epsilon
        });
    }

    return resolvedCount;
}

/**
 * 적-적 후보 pair를 처리합니다.
 * @param {object} options - 적-적 후보 pair 처리 옵션입니다.
 * @returns {number} 해소된 pair 수입니다.
 */
function processCollisionEnemyCandidatePair({
    low,
    high,
    bodyA,
    bodyB,
    relationData,
    shapeCodes,
    frameStats,
    profileRecorder,
    pairBudget,
    resolvePositions,
    applyNonPosition,
    resolveBoost,
    detector,
    scratchManifold,
    broadphaseBuffer,
    processObjectPair,
    epsilon
}) {
    if (!bodyA || !bodyB || areCollisionBodiesSameEntity(bodyA, bodyB)) {
        return 0;
    }

    if (shouldSkipCollisionEnemyPairByBudget(bodyA, bodyB, pairBudget)) {
        profileRecorder.recordCount('solveBudgetSkipCount');
        return 0;
    }

    frameStats.collisionCheckCount++;
    const relationOffsetA = low * RELATION_BROAD_STRIDE;
    const relationOffsetB = high * RELATION_BROAD_STRIDE;
    if (isCollisionRelationAabbSeparated(relationData, relationOffsetA, relationOffsetB)) {
        frameStats.aabbRejectCount++;
        return 0;
    }

    frameStats.aabbPassCount++;
    profileRecorder.recordCount('solveAabbPassCount');
    const isCirclePair = shapeCodes[low] === BODY_SHAPE_CIRCLE && shapeCodes[high] === BODY_SHAPE_CIRCLE;
    if (!isCirclePair && isCollisionRelationCircleSeparated(relationData, relationOffsetA, relationOffsetB, epsilon)) {
        frameStats.circleRejectCount++;
        return 0;
    }
    if (!isCirclePair) {
        frameStats.circlePassCount++;
        profileRecorder.recordCount('solveCirclePassCount');
    }

    markCollisionEnemyPairProcessAttempt(bodyA, bodyB);

    const narrowphaseStart = profileRecorder.startTimer();
    const pairResolved = processCollisionEnemyNarrowphase({
        low,
        high,
        bodyA,
        bodyB,
        relationData,
        relationOffsetA,
        relationOffsetB,
        isCirclePair,
        resolvePositions,
        applyNonPosition,
        resolveBoost,
        detector,
        scratchManifold,
        broadphaseBuffer,
        processObjectPair
    });
    profileRecorder.recordCount(
        isCirclePair ? 'solveSoACirclePairCount' : 'solveObjectNarrowphasePairCount'
    );
    profileRecorder.recordDuration('solveNarrowphaseMs', narrowphaseStart);
    if (pairResolved > 0) {
        profileRecorder.recordCount('solveResolvedPairCount', pairResolved);
    }
    return pairResolved;
}

/**
 * 일반 후보 pair를 처리합니다.
 * @param {object} options - 일반 후보 pair 처리 옵션입니다.
 * @returns {number} 해소된 pair 수입니다.
 */
function processCollisionObjectCandidatePair({
    bodyA,
    bodyB,
    frameStats,
    profileRecorder,
    pairBudget,
    resolvePositions,
    applyNonPosition,
    resolveBoost,
    processObjectPair,
    epsilon
}) {
    const rule = getCollisionPassRule(bodyA, bodyB, applyNonPosition);
    if (!rule) return 0;

    if (shouldSkipCollisionEnemyPairByBudget(bodyA, bodyB, pairBudget)) {
        profileRecorder.recordCount('solveBudgetSkipCount');
        return 0;
    }

    frameStats.collisionCheckCount++;
    if (!areCollisionBodyAabbsOverlapping(bodyA, bodyB)) {
        frameStats.aabbRejectCount++;
        return 0;
    }
    frameStats.aabbPassCount++;
    profileRecorder.recordCount('solveAabbPassCount');
    if (shouldUseCollisionBroadCircleFilter(bodyA, bodyB)) {
        if (!areCollisionBodyBroadCirclesOverlapping(bodyA, bodyB, epsilon)) {
            frameStats.circleRejectCount++;
            return 0;
        }
        frameStats.circlePassCount++;
        profileRecorder.recordCount('solveCirclePassCount');
    }

    markCollisionEnemyPairProcessAttempt(bodyA, bodyB);

    const narrowphaseStart = profileRecorder.startTimer();
    const pairResolved = processObjectPair(
        bodyA,
        bodyB,
        resolvePositions,
        applyNonPosition,
        resolveBoost,
        rule
    );
    profileRecorder.recordCount('solveObjectNarrowphasePairCount');
    profileRecorder.recordDuration('solveNarrowphaseMs', narrowphaseStart);
    if (pairResolved > 0) {
        profileRecorder.recordCount('solveResolvedPairCount', pairResolved);
    }
    return pairResolved;
}

/**
 * 적-적 narrowphase를 실행합니다.
 * @param {object} options - narrowphase 옵션입니다.
 * @returns {number} 해소된 pair 수입니다.
 */
function processCollisionEnemyNarrowphase({
    low,
    high,
    bodyA,
    bodyB,
    relationData,
    relationOffsetA,
    relationOffsetB,
    isCirclePair,
    resolvePositions,
    applyNonPosition,
    resolveBoost,
    detector,
    scratchManifold,
    broadphaseBuffer,
    processObjectPair
}) {
    if (isCirclePair) {
        return processCollisionEnemyCirclePairSoA({
            bodyA,
            bodyB,
            relationData,
            relationOffsetA,
            relationOffsetB,
            resolvePositions,
            resolveBoost,
            detector,
            scratchManifold,
            broadphaseBuffer
        });
    }

    return processObjectPair(
        bodyA,
        bodyB,
        resolvePositions,
        applyNonPosition,
        resolveBoost,
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
