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
 * 두 body의 충돌 위치 해소량을 계산하고 실제 좌표 이동까지 적용합니다.
 * @param {{addResolution: function(object, object, object): object}} detector
 * @param {object} manifold
 * @param {object} bodyA
 * @param {object} bodyB
 * @param {CollisionPairResolutionOptions} [options]
 * @returns {{resolved: object, tunedResolve: object, pairResolveBoost: number}}
 */
export function applyCollisionPairResolution(detector, manifold, bodyA, bodyB, options = {}) {
    const resolveBoost = Number.isFinite(options.resolveBoost) && options.resolveBoost > 0
        ? options.resolveBoost
        : 1;
    const pairWeights = getCollisionPairResolveWeights(bodyA, bodyB);
    const pairResolveBoost = resolveBoost * getCollisionPairEscapeBoost(bodyA, bodyB);
    const resolved = detector.addResolution(
        manifold,
        {
            weight: pairWeights.weightA,
            movable: isCollisionPairResolveMovable(bodyA, bodyB, options.movableA ?? null)
        },
        {
            weight: pairWeights.weightB,
            movable: isCollisionPairResolveMovable(bodyB, bodyA, options.movableB ?? null)
        }
    );
    const tunedResolve = tuneCollisionResolutionMoves(resolved, manifold, bodyA, bodyB, pairResolveBoost);
    if (tunedResolve.moveAX || tunedResolve.moveAY) {
        applyCollisionBodyTranslation(bodyA, tunedResolve.moveAX, tunedResolve.moveAY, {
            resolveBoost: pairResolveBoost,
            broadphaseBuffer: options.broadphaseBuffer ?? null
        });
    }
    if (tunedResolve.moveBX || tunedResolve.moveBY) {
        applyCollisionBodyTranslation(bodyB, tunedResolve.moveBX, tunedResolve.moveBY, {
            resolveBoost: pairResolveBoost,
            broadphaseBuffer: options.broadphaseBuffer ?? null
        });
    }

    return {
        resolved,
        tunedResolve,
        pairResolveBoost
    };
}
