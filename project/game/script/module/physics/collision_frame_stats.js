const COLLISION_BASE_STAT_FIELDS = Object.freeze([
    'collisionCheckCount',
    'aabbPassCount',
    'aabbRejectCount',
    'circlePassCount',
    'circleRejectCount',
    'partChecks'
]);

const COLLISION_PROFILE_STAT_FIELDS = Object.freeze([
    'enemyTotalMs',
    'enemyBodyBuildMs',
    'playerBodyBuildMs',
    'wallBodyBuildMs',
    'enemyPositionSolveMs',
    'enemyStabilizeMs',
    'enemyNonPositionMs',
    'solveGridMs',
    'solvePairScanMs',
    'solveCandidateBuildMs',
    'solvePairProcessMs',
    'solveNarrowphaseMs',
    'projectileTotalMs',
    'projectileEnemyBodyBuildMs',
    'projectileGridBuildMs',
    'projectileScanMs',
    'projectileCandidateQueryMs',
    'projectileNarrowphaseMs',
    'contactTotalMs',
    'contactBodyBuildMs',
    'contactGridBuildMs',
    'contactPairScanMs',
    'solveBucketPairCount',
    'solveCandidatePairCount',
    'solveDuplicatePairSkipCount',
    'solveRuleRejectCount',
    'solveAabbPassCount',
    'solveCirclePassCount',
    'solveResolvedPairCount',
    'solveSoACirclePairCount',
    'solveObjectNarrowphasePairCount',
    'solveBudgetSkipCount',
    'solveLargePopulationMode'
]);

/**
 * 충돌 프레임 통계 기본 객체를 생성합니다.
 * @returns {object}
 */
export function createCollisionFrameStats() {
    const stats = {};
    resetCollisionFrameStats(stats);
    return stats;
}

/**
 * 충돌 프레임 통계를 0으로 초기화합니다.
 * @param {object} stats - 초기화할 통계 객체입니다.
 */
export function resetCollisionFrameStats(stats) {
    for (let i = 0; i < COLLISION_BASE_STAT_FIELDS.length; i++) {
        stats[COLLISION_BASE_STAT_FIELDS[i]] = 0;
    }
    for (let i = 0; i < COLLISION_PROFILE_STAT_FIELDS.length; i++) {
        stats[COLLISION_PROFILE_STAT_FIELDS[i]] = 0;
    }
}

/**
 * 충돌 프레임 통계의 외부 노출용 스냅샷을 생성합니다.
 * @param {object} frameStats - 내부 프레임 통계 객체입니다.
 * @returns {object}
 */
export function createCollisionFrameStatsSnapshot(frameStats) {
    const stats = {};
    for (let i = 0; i < COLLISION_BASE_STAT_FIELDS.length; i++) {
        const fieldName = COLLISION_BASE_STAT_FIELDS[i];
        stats[fieldName] = Number.isFinite(frameStats[fieldName]) ? frameStats[fieldName] : 0;
    }
    for (let i = 0; i < COLLISION_PROFILE_STAT_FIELDS.length; i++) {
        const fieldName = COLLISION_PROFILE_STAT_FIELDS[i];
        stats[fieldName] = Number.isFinite(frameStats[fieldName]) ? frameStats[fieldName] : 0;
    }
    return stats;
}
