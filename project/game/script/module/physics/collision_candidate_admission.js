import { getData } from 'data/data_handler.js';

const CANDIDATE_BUDGET = getData('COLLISION_CONSTANTS').ENEMY_PAIR_CANDIDATE_BUDGET;
export const COLLISION_CURRENT_CANDIDATE_LIMIT = CANDIDATE_BUDGET.CURRENT_OVERLAP_PER_QUERY;
export const COLLISION_PREDICTIVE_CANDIDATE_LIMIT = CANDIDATE_BUDGET.PREDICTIVE_PER_QUERY;
export const COLLISION_CANDIDATE_VISIT_LIMIT = CANDIDATE_BUDGET.UNIQUE_VISITS_PER_QUERY;
export const COLLISION_ANCHOR_CANDIDATE_MULTIPLIER = CANDIDATE_BUDGET.ANCHOR_MULTIPLIER;

/**
 * low body 하나가 한 rebuild에서 방문할 고유 enemy 후보 상한을 반환합니다.
 * @param {boolean} anchorOwner - low body가 hexa hive anchor인지 여부입니다.
 * @returns {number} 고유 후보 방문 상한입니다.
 */
export function getCollisionEnemyCandidateVisitLimit(anchorOwner) {
    return anchorOwner
        ? Math.max(1, Math.floor(
            COLLISION_CANDIDATE_VISIT_LIMIT * COLLISION_ANCHOR_CANDIDATE_MULTIPLIER
        ))
        : COLLISION_CANDIDATE_VISIT_LIMIT;
}

/**
 * low body 하나가 현재 적-적 후보를 추가할 수 있는지 반환합니다.
 * @param {number} priorityCount - 이미 추가한 현재 중첩·anchor 후보 수입니다.
 * @param {number} predictiveCount - 이미 추가한 예측 후보 수입니다.
 * @param {boolean} priority - 현재 중첩 또는 anchor 후보 여부입니다.
 * @param {boolean} anchor - hexa hive anchor pair 여부입니다.
 * @returns {boolean} 후보를 추가할 수 있으면 true입니다.
 */
export function shouldAdmitCollisionEnemyCandidate(
    priorityCount,
    predictiveCount,
    priority,
    anchor
) {
    const baseLimit = priority
        ? COLLISION_CURRENT_CANDIDATE_LIMIT
        : COLLISION_PREDICTIVE_CANDIDATE_LIMIT;
    const limit = anchor
        ? Math.max(1, Math.floor(baseLimit * COLLISION_ANCHOR_CANDIDATE_MULTIPLIER))
        : baseLimit;
    const count = priority ? priorityCount : predictiveCount;
    return count < limit;
}
