import {
    getCollisionPairEscapeBoost,
    getCollisionPairResolveWeights,
    isCollisionPairResolveMovable,
    tuneCollisionResolutionMoves
} from './_collision_resolve_tuning.js';
import { applyCollisionBodyTranslation } from './collision_body_translation.js';

/**
 * @typedef {object} CollisionPairResolutionOptions
 * @property {boolean|null} [movableA=null] A body 이동 가능성 override
 * @property {boolean|null} [movableB=null] B body 이동 가능성 override
 * @property {number} [resolveBoost=1] 현재 패스의 해소 가중치
 * @property {object|null} [broadphaseBuffer=null] 좌표 이동 후 동기화할 broad-phase buffer
 */

/**
 * pair 해소 가중치 옵션을 양수로 보정합니다.
 * @param {CollisionPairResolutionOptions} options - pair 해소 옵션입니다.
 * @returns {number} 보정된 해소 가중치입니다.
 */
function resolveCollisionPairBoostOption(options) {
    return Number.isFinite(options.resolveBoost) && options.resolveBoost > 0
        ? options.resolveBoost
        : 1;
}

/**
 * detector.addResolution에 전달할 한쪽 body 옵션을 생성합니다.
 * @param {object} body - 현재 body입니다.
 * @param {object} otherBody - 상대 body입니다.
 * @param {number} weight - 해소 계산 weight입니다.
 * @param {boolean|null|undefined} movableOverride - 이동 가능성 override입니다.
 * @returns {{weight:number, movable:boolean}} 해소 계산용 body 옵션입니다.
 */
function createCollisionResolutionSide(body, otherBody, weight, movableOverride) {
    return {
        weight,
        movable: isCollisionPairResolveMovable(body, otherBody, movableOverride ?? null)
    };
}

/**
 * 조정된 해소 이동량을 body와 broad-phase 버퍼에 반영합니다.
 * @param {object} body - 이동할 충돌 body입니다.
 * @param {number} moveX - X 이동량입니다.
 * @param {number} moveY - Y 이동량입니다.
 * @param {number} pairResolveBoost - pair별 해소 가중치입니다.
 * @param {object|null} broadphaseBuffer - 좌표 이동 후 동기화할 broad-phase buffer입니다.
 */
function applyCollisionResolvedMove(body, moveX, moveY, pairResolveBoost, broadphaseBuffer) {
    if (!moveX && !moveY) {
        return;
    }

    applyCollisionBodyTranslation(body, moveX, moveY, {
        resolveBoost: pairResolveBoost,
        broadphaseBuffer
    });
}

/**
 * 두 body의 충돌 위치 해소량을 계산하고 실제 좌표 이동까지 적용합니다.
 * @param {{addResolution: function(object, object, object): object}} detector
 * @param {object} manifold
 * @param {object} bodyA
 * @param {object} bodyB
 * @param {CollisionPairResolutionOptions} [options]
 * @returns {{resolved: object, tunedResolve: object, pairResolveBoost: number}}
 */
export function applyCollisionPairResolution(detector, manifold, bodyA, bodyB, options = {}) {
    const resolveBoost = resolveCollisionPairBoostOption(options);
    const pairWeights = getCollisionPairResolveWeights(bodyA, bodyB);
    const pairResolveBoost = resolveBoost * getCollisionPairEscapeBoost(bodyA, bodyB);
    const broadphaseBuffer = options.broadphaseBuffer ?? null;
    const resolved = detector.addResolution(
        manifold,
        createCollisionResolutionSide(bodyA, bodyB, pairWeights.weightA, options.movableA),
        createCollisionResolutionSide(bodyB, bodyA, pairWeights.weightB, options.movableB)
    );
    const tunedResolve = tuneCollisionResolutionMoves(resolved, manifold, bodyA, bodyB, pairResolveBoost);
    applyCollisionResolvedMove(bodyA, tunedResolve.moveAX, tunedResolve.moveAY, pairResolveBoost, broadphaseBuffer);
    applyCollisionResolvedMove(bodyB, tunedResolve.moveBX, tunedResolve.moveBY, pairResolveBoost, broadphaseBuffer);

    return {
        resolved,
        tunedResolve,
        pairResolveBoost
    };
}
