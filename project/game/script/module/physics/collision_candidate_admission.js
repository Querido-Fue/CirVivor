export const COLLISION_CURRENT_CANDIDATE_LIMIT = 12;
export const COLLISION_PREDICTIVE_CANDIDATE_LIMIT = 2;
export const COLLISION_CANDIDATE_VISIT_LIMIT = 32;
export const COLLISION_ANCHOR_CANDIDATE_MULTIPLIER = 2;

/**
 * 실제 후보 rebuild epoch를 raw 후보 방문 창의 bucket 시작 token으로 변환합니다.
 * body별 방문 상한 단위로 이동해 normal과 anchor가 각각 다음 page를 방문하게 합니다.
 * @param {number} scanEpoch - 실제 후보 목록을 재구성할 때마다 증가하는 epoch입니다.
 * @param {number} visitLimit - 현재 low body의 고유 후보 방문 상한입니다.
 * @param {number} [cellCount=1] - 현재 low body가 순회할 grid cell 수입니다.
 * @param {number} [lowOffset=0] - low body별 cell 시작 위상입니다.
 * @returns {number} uint32 bucket 시작 token입니다.
 */
export function getCollisionEnemyCandidateBucketScanToken(
    scanEpoch,
    visitLimit,
    cellCount = 1,
    lowOffset = 0
) {
    const safeScanEpoch = Number.isFinite(scanEpoch) ? Math.floor(scanEpoch) >>> 0 : 0;
    const safeVisitLimit = Number.isFinite(visitLimit) && visitLimit > 0
        ? Math.floor(visitLimit) >>> 0
        : COLLISION_CANDIDATE_VISIT_LIMIT;
    const safeCellCount = Number.isFinite(cellCount) && cellCount > 0
        ? Math.floor(cellCount) >>> 0
        : 1;
    const safeLowOffset = Number.isFinite(lowOffset) ? Math.floor(lowOffset) >>> 0 : 0;
    const cellScanPhase = (safeScanEpoch + safeLowOffset) >>> 0;
    const bucketPageEpoch = Math.floor(cellScanPhase / safeCellCount) >>> 0;
    return Math.imul(bucketPageEpoch, safeVisitLimit) >>> 0;
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
