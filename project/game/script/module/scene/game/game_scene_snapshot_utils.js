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
 * 스냅샷 숫자 필드를 유효 숫자로 정규화합니다.
 * @param {number|null|undefined} value - 원본 값입니다.
 * @param {number} [fallback=0] - 유효하지 않을 때 사용할 값입니다.
 * @returns {number} 정규화된 숫자입니다.
 */
export function normalizeSnapshotNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * 스냅샷 좌표 객체를 복제합니다.
 * @param {{x?:number, y?:number}|null|undefined} point - 원본 좌표입니다.
 * @returns {{x:number, y:number}} 복제된 좌표입니다.
 */
export function cloneSnapshotPoint(point) {
    return {
        x: normalizeSnapshotNumber(point?.x, 0),
        y: normalizeSnapshotNumber(point?.y, 0)
    };
}

/**
 * 충돌 통계 기본값을 생성합니다.
 * @returns {object} 기본 충돌 통계입니다.
 */
export function createDefaultCollisionStats() {
    const stats = {};
    for (let i = 0; i < COLLISION_STAT_FIELD_NAMES.length; i++) {
        stats[COLLISION_STAT_FIELD_NAMES[i]] = 0;
    }
    return stats;
}

/**
 * 충돌 통계를 렌더/워커 전송용 숫자 스냅샷으로 복제합니다.
 * @param {object|null|undefined} sourceStats - 원본 충돌 통계입니다.
 * @returns {object} 복제된 충돌 통계입니다.
 */
export function createCollisionStatsSnapshot(sourceStats) {
    const stats = createDefaultCollisionStats();
    if (!sourceStats || typeof sourceStats !== 'object') {
        return stats;
    }

    for (let i = 0; i < COLLISION_STAT_FIELD_NAMES.length; i++) {
        const fieldName = COLLISION_STAT_FIELD_NAMES[i];
        stats[fieldName] = normalizeSnapshotNumber(sourceStats[fieldName], 0);
    }
    return stats;
}

/**
 * HUD에 표시할 ms 값을 고정 소수점 문자열로 변환합니다.
 * @param {number|null|undefined} value - 원본 시간 값입니다.
 * @returns {string} 표시용 시간 문자열입니다.
 */
export function formatDebugMs(value) {
    return normalizeSnapshotNumber(value, 0).toFixed(2);
}

/**
 * HUD에 표시할 카운터 값을 정수 문자열로 변환합니다.
 * @param {number|null|undefined} value - 원본 카운터 값입니다.
 * @returns {string} 표시용 카운터 문자열입니다.
 */
export function formatDebugCount(value) {
    return `${Math.max(0, Math.round(normalizeSnapshotNumber(value, 0)))}`;
}
