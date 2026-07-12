import { getData } from 'data/data_handler.js';

const CANDIDATE_BUDGET = getData('COLLISION_CONSTANTS').ENEMY_PAIR_CANDIDATE_BUDGET;
export const COLLISION_CURRENT_CANDIDATE_LIMIT = CANDIDATE_BUDGET.CURRENT_OVERLAP_PER_QUERY;
export const COLLISION_PREDICTIVE_CANDIDATE_LIMIT = CANDIDATE_BUDGET.PREDICTIVE_PER_QUERY;
export const COLLISION_CANDIDATE_VISIT_LIMIT = CANDIDATE_BUDGET.UNIQUE_VISITS_PER_QUERY;
export const COLLISION_ANCHOR_CANDIDATE_MULTIPLIER = CANDIDATE_BUDGET.ANCHOR_MULTIPLIER;

/**
 * fixed frame과 pass cursor를 raw 후보 방문 창의 bucket 시작 token으로 변환합니다.
 * 방문 상한 단위로 이동해 연속 frame과 rebuild가 같은 앞쪽 후보를 반복하지 않게 합니다.
 * @param {number} frameToken - 현재 fixed frame token입니다.
 * @param {number} passCursor - 현재 pair pass cursor입니다.
 * @returns {number} uint32 bucket 시작 token입니다.
 */
export function getCollisionEnemyCandidateBucketScanToken(frameToken, passCursor) {
    const safeFrameToken = Number.isFinite(frameToken) ? Math.floor(frameToken) : 0;
    const safePassCursor = Number.isFinite(passCursor) ? Math.floor(passCursor) : 0;
    const phase = (safeFrameToken + safePassCursor) >>> 0;
    return Math.imul(phase, COLLISION_CANDIDATE_VISIT_LIMIT) >>> 0;
}

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
