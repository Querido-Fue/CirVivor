import { isCollisionEnemyPairAnchorBody } from './_collision_resolve_tuning.js';

const ENEMY_PAIR_PROCESS_BUDGET_POSITION = 14;
const ENEMY_PAIR_PROCESS_BUDGET_STABILIZE = 10;
const ENEMY_PAIR_PROCESS_BUDGET_NON_POSITION = 8;

/**
 * 현재 패스에서 적-적 narrowphase 처리에 적용할 상한을 반환합니다.
 * @param {boolean} resolvePositions - 위치 해소 패스 여부입니다.
 * @param {boolean} applyNonPosition - 비위치 효과 적용 패스 여부입니다.
 * @param {number} resolveBoost - 위치 해소 강화 배율입니다.
 * @returns {number} 적-적 pair 처리 예산입니다.
 */
export function getCollisionEnemyPairProcessBudget(resolvePositions, applyNonPosition, resolveBoost) {
    if (applyNonPosition) {
        return ENEMY_PAIR_PROCESS_BUDGET_NON_POSITION;
    }
    if (!resolvePositions) {
        return Number.POSITIVE_INFINITY;
    }
    return resolveBoost > 1
        ? ENEMY_PAIR_PROCESS_BUDGET_STABILIZE
        : ENEMY_PAIR_PROCESS_BUDGET_POSITION;
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
    if (bodyA?.kind !== 'enemy' || bodyB?.kind !== 'enemy') {
        return false;
    }
    if (isCollisionEnemyPairAnchorBody(bodyA, bodyB) || isCollisionEnemyPairAnchorBody(bodyB, bodyA)) {
        return false;
    }
    if (!Number.isFinite(budget) || budget <= 0) {
        return false;
    }

    const passCountA = Number.isFinite(bodyA._passPairProcessCount) ? bodyA._passPairProcessCount : 0;
    const passCountB = Number.isFinite(bodyB._passPairProcessCount) ? bodyB._passPairProcessCount : 0;
    return passCountA >= budget || passCountB >= budget;
}

/**
 * 현재 패스에서 적-적 narrowphase 시도 횟수를 누적합니다.
 * @param {object} bodyA - 첫 번째 충돌 body입니다.
 * @param {object} bodyB - 두 번째 충돌 body입니다.
 */
export function markCollisionEnemyPairProcessAttempt(bodyA, bodyB) {
    if (bodyA?.kind !== 'enemy' || bodyB?.kind !== 'enemy') {
        return;
    }
    bodyA._passPairProcessCount = (bodyA._passPairProcessCount || 0) + 1;
    bodyB._passPairProcessCount = (bodyB._passPairProcessCount || 0) + 1;
}
