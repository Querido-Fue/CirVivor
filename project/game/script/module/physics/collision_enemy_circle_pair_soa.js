import { areCollisionEnemyPairAnchors } from './_collision_resolve_tuning.js';
import { writeCollisionCircleOverlapManifold } from './collision_manifold_writer.js';
import { applyCollisionPairResolution } from './collision_pair_resolver.js';
import { COLLISION_RELATION_INDEX as RELATION_INDEX } from './collision_soa_layout.js';

/**
 * 적-적 원형 pair 처리 카운터를 양쪽 body에 누적합니다.
 * @param {object} bodyA - 첫 번째 body입니다.
 * @param {object} bodyB - 두 번째 body입니다.
 * @param {string} fieldName - 누적할 카운터 필드명입니다.
 */
function incrementCollisionEnemyCirclePairCounter(bodyA, bodyB, fieldName) {
    bodyA[fieldName] = (bodyA[fieldName] || 0) + 1;
    bodyB[fieldName] = (bodyB[fieldName] || 0) + 1;
}

/**
 * enemy 원형 쌍을 SoA 중심/반경으로 직접 판정하고 해소합니다.
 * @param {object} options - 처리 옵션입니다.
 * @param {object} options.bodyA - 첫 번째 body입니다.
 * @param {object} options.bodyB - 두 번째 body입니다.
 * @param {Float64Array} options.relationData - broad-phase relation SoA입니다.
 * @param {number} options.relationOffsetA - 첫 번째 body relation offset입니다.
 * @param {number} options.relationOffsetB - 두 번째 body relation offset입니다.
 * @param {boolean} options.resolvePositions - 위치 해소 여부입니다.
 * @param {number} options.resolveBoost - 현재 패스 해소 가중치입니다.
 * @param {object} options.detector - 충돌 detector입니다.
 * @param {object} options.scratchManifold - 재사용 manifold 객체입니다.
 * @param {object} options.broadphaseBuffer - 위치 이동 후 동기화할 broad-phase buffer입니다.
 * @returns {number} 처리된 pair 수입니다.
 */
export function processCollisionEnemyCirclePairSoA({
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
}) {
    if (resolvePositions) {
        incrementCollisionEnemyCirclePairCounter(bodyA, bodyB, '_candidatePairCount');
    }

    const ax = relationData[relationOffsetA + RELATION_INDEX.CENTER_X];
    const ay = relationData[relationOffsetA + RELATION_INDEX.CENTER_Y];
    const bx = relationData[relationOffsetB + RELATION_INDEX.CENTER_X];
    const by = relationData[relationOffsetB + RELATION_INDEX.CENTER_Y];
    const radiusA = relationData[relationOffsetA + RELATION_INDEX.ENEMY_PAIR_RADIUS];
    const radiusB = relationData[relationOffsetB + RELATION_INDEX.ENEMY_PAIR_RADIUS];
    const manifold = writeCollisionCircleOverlapManifold(
        ax,
        ay,
        radiusA,
        bx,
        by,
        radiusB,
        scratchManifold
    );
    if (!manifold) {
        return 0;
    }

    if (resolvePositions) {
        incrementCollisionEnemyCirclePairCounter(bodyA, bodyB, '_resolvedPairCount');
    }

    if (!resolvePositions) return 1;

    if (areCollisionEnemyPairAnchors(bodyA, bodyB)) {
        return 0;
    }

    applyCollisionPairResolution(detector, manifold, bodyA, bodyB, {
        movableA: null,
        movableB: null,
        resolveBoost,
        broadphaseBuffer
    });

    return 1;
}
