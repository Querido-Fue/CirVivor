import { getData } from 'data/data_handler.js';
import { isCollisionEnemyPairAnchorBody } from './_collision_resolve_tuning.js';

const COLLISION_ENEMY_PAIR_PROCESS_BUDGET = getData('COLLISION_CONSTANTS').ENEMY_PAIR_PROCESS_BUDGET;

/**
 * 두 충돌 body가 적-적 pair인지 반환합니다.
 * @param {object|null|undefined} bodyA - 첫 번째 충돌 body입니다.
 * @param {object|null|undefined} bodyB - 두 번째 충돌 body입니다.
 * @returns {boolean} 두 body 모두 적이면 true입니다.
 */
function areCollisionEnemyBodies(bodyA, bodyB) {
    return bodyA?.kind === 'enemy' && bodyB?.kind === 'enemy';
}

/**
 * 현재 패스에서 body가 narrowphase 처리된 횟수를 반환합니다.
 * @param {object|null|undefined} body - 충돌 body입니다.
 * @returns {number} 유효하지 않으면 0으로 보정한 처리 횟수입니다.
 */
function getCollisionBodyPassPairProcessCount(body) {
    return Number.isFinite(body?._passPairProcessCount) ? body._passPairProcessCount : 0;
}

/**
 * 적-적 처리 예산이 실제 제한값인지 반환합니다.
 * @param {number} budget - 현재 패스 처리 예산입니다.
 * @returns {boolean} 유한한 양수 예산이면 true입니다.
 */
function hasCollisionEnemyPairProcessBudget(budget) {
    return Number.isFinite(budget) && budget > 0;
}

/**
 * 현재 패스에서 적-적 narrowphase 처리에 적용할 상한을 반환합니다.
 * @param {boolean} resolvePositions - 위치 해소 패스 여부입니다.
 * @param {boolean} applyNonPosition - 비위치 효과 적용 패스 여부입니다.
 * @param {number} resolveBoost - 위치 해소 강화 배율입니다.
 * @returns {number} 적-적 pair 처리 예산입니다.
 */
export function getCollisionEnemyPairProcessBudget(resolvePositions, applyNonPosition, resolveBoost) {
    if (applyNonPosition) {
        return COLLISION_ENEMY_PAIR_PROCESS_BUDGET.NON_POSITION;
    }
    if (!resolvePositions) {
        return Number.POSITIVE_INFINITY;
    }
    return resolveBoost > 1
        ? COLLISION_ENEMY_PAIR_PROCESS_BUDGET.STABILIZE
        : COLLISION_ENEMY_PAIR_PROCESS_BUDGET.POSITION;
}

/**
 * 패스 단위 적-적 처리 카운터를 초기화합니다.
 * @param {object[]} bodies - 충돌 body 목록입니다.
 */
export function resetCollisionPassPairProcessCounts(bodies) {
    for (let i = 0; i < bodies.length; i++) {
        if (bodies[i]) {
            bodies[i]._passPairProcessCount = 0;
        }
    }
}

/**
 * 과밀 적-적 후보가 현재 패스 처리 예산을 초과했는지 반환합니다.
 * @param {object} bodyA - 첫 번째 충돌 body입니다.
 * @param {object} bodyB - 두 번째 충돌 body입니다.
 * @param {number} budget - 현재 패스 처리 예산입니다.
 * @returns {boolean} 예산 초과로 건너뛰어야 하면 true입니다.
 */
export function shouldSkipCollisionEnemyPairByBudget(bodyA, bodyB, budget) {
    if (!areCollisionEnemyBodies(bodyA, bodyB)) {
        return false;
    }
    if (isCollisionEnemyPairAnchorBody(bodyA, bodyB) || isCollisionEnemyPairAnchorBody(bodyB, bodyA)) {
        return false;
    }
    if (!hasCollisionEnemyPairProcessBudget(budget)) {
        return false;
    }

    const passCountA = getCollisionBodyPassPairProcessCount(bodyA);
    const passCountB = getCollisionBodyPassPairProcessCount(bodyB);
    return passCountA >= budget || passCountB >= budget;
}

/**
 * 현재 패스에서 적-적 narrowphase 시도 횟수를 누적합니다.
 * @param {object} bodyA - 첫 번째 충돌 body입니다.
 * @param {object} bodyB - 두 번째 충돌 body입니다.
 */
export function markCollisionEnemyPairProcessAttempt(bodyA, bodyB) {
    if (!areCollisionEnemyBodies(bodyA, bodyB)) {
        return;
    }
    bodyA._passPairProcessCount = (bodyA._passPairProcessCount || 0) + 1;
    bodyB._passPairProcessCount = (bodyB._passPairProcessCount || 0) + 1;
}
