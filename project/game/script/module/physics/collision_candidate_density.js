/**
 * body 하나에 기록된 후보/해결 pair 부하를 반환합니다.
 * @param {object|null|undefined} body - 충돌 body입니다.
 * @returns {number} 후보 pair 수와 해결 pair 수 중 큰 값입니다.
 */
function getCollisionBodyPairLoad(body) {
    const candidateCount = Number.isFinite(body?._candidatePairCount) ? body._candidatePairCount : 0;
    const resolvedCount = Number.isFinite(body?._resolvedPairCount) ? body._resolvedPairCount : 0;
    return Math.max(candidateCount, resolvedCount);
}

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
        const count = getCollisionBodyPairLoad(bodies[i]);
        if (count > peak) {
            peak = count;
        }
    }
    return peak;
}
