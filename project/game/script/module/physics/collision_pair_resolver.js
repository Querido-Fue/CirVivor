import {
    getCollisionPairEscapeBoost,
    getCollisionPairResolveWeight,
    isCollisionPairResolveMovable,
    tuneCollisionResolutionMoves
} from './_collision_resolve_tuning.js';
import { applyCollisionBodyTranslation } from './collision_body_translation.js';

/**
 * 조정된 해소 이동량을 body와 broad-phase 버퍼에 반영합니다.
 * @param {object} body - 이동할 충돌 body입니다.
 * @param {number} moveX - X 이동량입니다.
 * @param {number} moveY - Y 이동량입니다.
 * @param {number} pairResolveBoost - pair별 해소 가중치입니다.
 * @param {object|null} broadphaseBuffer - 좌표 이동 후 동기화할 broad-phase buffer입니다.
 * @returns {void}
 */
function applyCollisionResolvedMove(body, moveX, moveY, pairResolveBoost, broadphaseBuffer) {
    if (!moveX && !moveY) {
        return;
    }

    applyCollisionBodyTranslation(body, moveX, moveY, pairResolveBoost, broadphaseBuffer);
}

/**
 * 두 body의 충돌 위치 해소량을 계산하고 실제 좌표 이동까지 적용합니다.
 * @param {{addResolutionScalars: function(object, number, boolean, number, boolean): object}} detector
 * @param {object} manifold
 * @param {object} bodyA
 * @param {object} bodyB
 * @param {boolean|null} [movableA=null] - A body 이동 가능성 override입니다.
 * @param {boolean|null} [movableB=null] - B body 이동 가능성 override입니다.
 * @param {number} [resolveBoost=1] - 현재 패스 해소 가중치입니다.
 * @param {object|null} [broadphaseBuffer=null] - 좌표 이동 후 동기화할 broad-phase buffer입니다.
 * @returns {object|null} 이동량이 기록된 manifold입니다.
 */
export function applyCollisionPairResolution(
    detector,
    manifold,
    bodyA,
    bodyB,
    movableA = null,
    movableB = null,
    resolveBoost = 1,
    broadphaseBuffer = null
) {
    const safeResolveBoost = Number.isFinite(resolveBoost) && resolveBoost > 0 ? resolveBoost : 1;
    const pairResolveBoost = safeResolveBoost * getCollisionPairEscapeBoost(bodyA, bodyB);
    const resolved = detector.addResolutionScalars(
        manifold,
        getCollisionPairResolveWeight(bodyA, bodyB),
        isCollisionPairResolveMovable(bodyA, bodyB, movableA),
        getCollisionPairResolveWeight(bodyB, bodyA),
        isCollisionPairResolveMovable(bodyB, bodyA, movableB)
    );
    const tunedResolve = tuneCollisionResolutionMoves(
        resolved,
        manifold,
        bodyA,
        bodyB,
        pairResolveBoost
    );
    if (!tunedResolve) {
        return null;
    }

    applyCollisionResolvedMove(bodyA, tunedResolve.moveAX, tunedResolve.moveAY, pairResolveBoost, broadphaseBuffer);
    applyCollisionResolvedMove(bodyB, tunedResolve.moveBX, tunedResolve.moveBY, pairResolveBoost, broadphaseBuffer);
    return tunedResolve;
}
