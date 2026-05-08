const COLLISION_STAT_FIELD_NAMES = Object.freeze([
    'collisionCheckCount',
    'aabbPassCount',
    'aabbRejectCount',
    'circlePassCount',
    'circleRejectCount',
    'partChecks',
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
    'solveBudgetSkipCount',
    'solveLargePopulationMode'
]);

/**
 * 충돌 통계 기본값을 생성합니다.
 * @returns {object}
 */
export function createDefaultCollisionStats() {
    const stats = {};
    for (let i = 0; i < COLLISION_STAT_FIELD_NAMES.length; i++) {
        stats[COLLISION_STAT_FIELD_NAMES[i]] = 0;
    }
    return stats;
}

/**
 * AI 디버그 통계 기본값을 생성합니다.
 * @returns {object}
 */
export function createDefaultAIStats() {
    return {
        enabled: false,
        totalMs: 0,
        enemyUpdateCount: 0,
        heavyDecisionCount: 0,
        localDirectPathReuseCount: 0,
        sharedDirectPathCacheHitCount: 0,
        sharedFlowFieldCacheHitCount: 0,
        sharedDensityFieldCacheHitCount: 0,
        sharedPolicyTargetCacheHitCount: 0,
        densityFieldBuildCount: 0,
        flowRefreshCount: 0,
        policyCounts: {
            chase: 0,
            chargeChase: 0,
            keepRange: 0,
            clusterJoin: 0,
            allyDensitySeek: 0,
            formationFollow: 0
        },
        policyMs: {
            chase: 0,
            chargeChase: 0,
            keepRange: 0,
            clusterJoin: 0,
            allyDensitySeek: 0,
            formationFollow: 0
        }
    };
}

/**
 * AI 통계를 현재 프레임 기준으로 초기화합니다.
 * @param {object|null|undefined} aiStats
 * @param {boolean} enabled
 * @returns {object}
 */
export function resetShadowAIStats(aiStats, enabled) {
    const nextAIStats = aiStats && typeof aiStats === 'object'
        ? aiStats
        : createDefaultAIStats();

    nextAIStats.enabled = enabled === true;
    nextAIStats.totalMs = 0;
    nextAIStats.enemyUpdateCount = 0;
    nextAIStats.heavyDecisionCount = 0;
    nextAIStats.localDirectPathReuseCount = 0;
    nextAIStats.sharedDirectPathCacheHitCount = 0;
    nextAIStats.sharedFlowFieldCacheHitCount = 0;
    nextAIStats.sharedDensityFieldCacheHitCount = 0;
    nextAIStats.sharedPolicyTargetCacheHitCount = 0;
    nextAIStats.densityFieldBuildCount = 0;
    nextAIStats.flowRefreshCount = 0;
    nextAIStats.policyCounts = nextAIStats.policyCounts && typeof nextAIStats.policyCounts === 'object'
        ? nextAIStats.policyCounts
        : createDefaultAIStats().policyCounts;
    nextAIStats.policyMs = nextAIStats.policyMs && typeof nextAIStats.policyMs === 'object'
        ? nextAIStats.policyMs
        : createDefaultAIStats().policyMs;

    nextAIStats.policyCounts.chase = 0;
    nextAIStats.policyCounts.chargeChase = 0;
    nextAIStats.policyCounts.keepRange = 0;
    nextAIStats.policyCounts.clusterJoin = 0;
    nextAIStats.policyCounts.allyDensitySeek = 0;
    nextAIStats.policyCounts.formationFollow = 0;

    nextAIStats.policyMs.chase = 0;
    nextAIStats.policyMs.chargeChase = 0;
    nextAIStats.policyMs.keepRange = 0;
    nextAIStats.policyMs.clusterJoin = 0;
    nextAIStats.policyMs.allyDensitySeek = 0;
    nextAIStats.policyMs.formationFollow = 0;

    return nextAIStats;
}

/**
 * AI 통계를 얕은 읽기 전용 스냅샷으로 복제합니다.
 * @param {object|null|undefined} aiStats
 * @returns {object}
 */
export function cloneShadowAIStats(aiStats) {
    const defaults = createDefaultAIStats();
    return {
        enabled: aiStats?.enabled === true,
        totalMs: Number.isFinite(aiStats?.totalMs) ? aiStats.totalMs : defaults.totalMs,
        enemyUpdateCount: Number.isFinite(aiStats?.enemyUpdateCount) ? aiStats.enemyUpdateCount : defaults.enemyUpdateCount,
        heavyDecisionCount: Number.isFinite(aiStats?.heavyDecisionCount) ? aiStats.heavyDecisionCount : defaults.heavyDecisionCount,
        localDirectPathReuseCount: Number.isFinite(aiStats?.localDirectPathReuseCount)
            ? aiStats.localDirectPathReuseCount
            : defaults.localDirectPathReuseCount,
        sharedDirectPathCacheHitCount: Number.isFinite(aiStats?.sharedDirectPathCacheHitCount)
            ? aiStats.sharedDirectPathCacheHitCount
            : defaults.sharedDirectPathCacheHitCount,
        sharedFlowFieldCacheHitCount: Number.isFinite(aiStats?.sharedFlowFieldCacheHitCount)
            ? aiStats.sharedFlowFieldCacheHitCount
            : defaults.sharedFlowFieldCacheHitCount,
        sharedDensityFieldCacheHitCount: Number.isFinite(aiStats?.sharedDensityFieldCacheHitCount)
            ? aiStats.sharedDensityFieldCacheHitCount
            : defaults.sharedDensityFieldCacheHitCount,
        sharedPolicyTargetCacheHitCount: Number.isFinite(aiStats?.sharedPolicyTargetCacheHitCount)
            ? aiStats.sharedPolicyTargetCacheHitCount
            : defaults.sharedPolicyTargetCacheHitCount,
        densityFieldBuildCount: Number.isFinite(aiStats?.densityFieldBuildCount)
            ? aiStats.densityFieldBuildCount
            : defaults.densityFieldBuildCount,
        flowRefreshCount: Number.isFinite(aiStats?.flowRefreshCount) ? aiStats.flowRefreshCount : defaults.flowRefreshCount,
        policyCounts: {
            ...defaults.policyCounts,
            ...(aiStats?.policyCounts && typeof aiStats.policyCounts === 'object' ? aiStats.policyCounts : {})
        },
        policyMs: {
            ...defaults.policyMs,
            ...(aiStats?.policyMs && typeof aiStats.policyMs === 'object' ? aiStats.policyMs : {})
        }
    };
}

/**
 * 충돌 통계를 기존 객체에 in-place로 반영합니다.
 * @param {object} targetStats
 * @param {object|null|undefined} sourceStats
 */
export function assignShadowCollisionStats(targetStats, sourceStats) {
    if (!targetStats || !sourceStats || typeof sourceStats !== 'object') {
        return;
    }

    for (let i = 0; i < COLLISION_STAT_FIELD_NAMES.length; i++) {
        const fieldName = COLLISION_STAT_FIELD_NAMES[i];
        if (Number.isFinite(sourceStats[fieldName])) {
            targetStats[fieldName] = sourceStats[fieldName];
        }
    }
    for (const [fieldName, value] of Object.entries(sourceStats)) {
        if (Number.isFinite(value)) {
            targetStats[fieldName] = value;
        }
    }
}
