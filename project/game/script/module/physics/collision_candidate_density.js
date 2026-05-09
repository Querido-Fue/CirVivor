/**
 * 국소 과밀도를 판단하기 위해 body별 후보/해결 pair 수의 최대값을 반환합니다.
 * @param {object[]} bodies - 현재 solve 대상 body 목록입니다.
 * @returns {number} body 하나에 몰린 최대 후보 pair 수입니다.
 */
export function getCollisionPeakCandidatePairs(bodies) {
    if (!Array.isArray(bodies) || bodies.length === 0) {
        return 0;
    }

    let peak = 0;
    for (let i = 0; i < bodies.length; i++) {
        const candidateCount = Number.isFinite(bodies[i]?._candidatePairCount) ? bodies[i]._candidatePairCount : 0;
        const resolvedCount = Number.isFinite(bodies[i]?._resolvedPairCount) ? bodies[i]._resolvedPairCount : 0;
        const count = Math.max(candidateCount, resolvedCount);
        if (count > peak) {
            peak = count;
        }
    }
    return peak;
}
