import {
    formatDebugCount,
    formatDebugMs,
    normalizeSnapshotNumber
} from './game_scene_snapshot_utils.js';

/**
 * 시뮬레이션 worker 상태를 HUD 문자열 목록으로 변환합니다.
 * @param {object|null|undefined} systemHandler - 시스템 핸들러입니다.
 * @returns {string[]} HUD에 표시할 worker 상태 문자열 목록입니다.
 */
export function buildGameSceneSimulationWorkerHudLines(systemHandler) {
    const bridgeStatus = systemHandler?.getSimulationWorkerStatus?.() ?? null;
    const runtimeStatus = systemHandler?.getSimulationWorkerRuntimeStatus?.() ?? null;
    const requested = runtimeStatus?.shadowEnabled === true
        && runtimeStatus?.presentationEnabled === true
        && runtimeStatus?.authorityRequested === true;

    if (!requested) {
        return ['worker: off'];
    }
    if (bridgeStatus?.supported === false) {
        return ['worker: unsupported'];
    }

    const lines = [];
    if (runtimeStatus?.authorityActive === true) {
        lines.push('worker: authority active');
    } else if (bridgeStatus?.lastError) {
        lines.push('worker: error');
    } else if (runtimeStatus?.presentationActive === true) {
        lines.push('worker: presentation only');
    } else if (bridgeStatus?.ready === true) {
        lines.push('worker: ready');
    } else if (bridgeStatus?.running === true) {
        lines.push('worker: booting');
    } else {
        lines.push('worker: not running');
    }

    if (typeof bridgeStatus?.lastError === 'string' && bridgeStatus.lastError.length > 0) {
        const maxErrorLength = 54;
        const errorText = bridgeStatus.lastError.length > maxErrorLength
            ? `${bridgeStatus.lastError.slice(0, maxErrorLength - 3)}...`
            : bridgeStatus.lastError;
        lines.push(`worker err: ${errorText}`);
    }

    if (bridgeStatus) {
        lines.push(`worker ack: ${bridgeStatus.lastAckFrameId}/${bridgeStatus.lastFrameId}`);
    }
    _appendSimulationWorkerProfileHudLines(lines, bridgeStatus);
    _appendSimulationWorkerAIHudLines(lines, bridgeStatus);
    _appendSimulationWorkerEnemyAIWorkerHudLines(lines, bridgeStatus);

    return lines;
}

/**
 * worker profile/collision 계측 HUD 라인을 추가합니다.
 * @param {string[]} lines - 출력 문자열 목록입니다.
 * @param {object|null|undefined} bridgeStatus - worker bridge 상태입니다.
 * @returns {void}
 */
function _appendSimulationWorkerProfileHudLines(lines, bridgeStatus) {
    if (!Array.isArray(lines)) {
        return;
    }

    const profileStats = bridgeStatus?.workerSnapshot?.profileStats;
    if (profileStats?.enabled === true) {
        const publishMs = Number.isFinite(profileStats.publishTotalMs)
            ? profileStats.publishTotalMs
            : profileStats.sharedPublishCallMs;
        lines.push(`worker frame ms: total ${formatDebugMs(profileStats.totalMs)} | scene ${formatDebugMs(profileStats.sceneWrapperMs)} | publish ${formatDebugMs(publishMs)}`);
        lines.push(`worker publish ms: wall ${formatDebugMs(profileStats.publishWallsMs)} | proj ${formatDebugMs(profileStats.publishProjectilesMs)} | enemy ${formatDebugMs(profileStats.publishEnemiesMs)}`);
        if (publishMs > 0) {
            const wallCount = normalizeSnapshotNumber(profileStats.publishStaticWallCount, 0)
                + normalizeSnapshotNumber(profileStats.publishBoxWallCount, 0);
            lines.push(`publish wall detail: static ${formatDebugMs(profileStats.publishStaticWallsMs)} | box ${formatDebugMs(profileStats.publishBoxWallsMs)} | reuse ${formatDebugMs(profileStats.publishWallReuseMs)}`);
            lines.push(`publish actor detail: p ${formatDebugMs(profileStats.publishProjectileDynamicMs)}/${formatDebugMs(profileStats.publishProjectileStaticMs)} | e ${formatDebugMs(profileStats.publishEnemyDynamicMs)}/${formatDebugMs(profileStats.publishEnemyStaticMs)}`);
            lines.push(`publish count: wall ${wallCount} | proj ${normalizeSnapshotNumber(profileStats.publishProjectileCount, 0)} | enemy ${normalizeSnapshotNumber(profileStats.publishEnemyCount, 0)}`);
        }
    }

    const collisionStats = bridgeStatus?.workerSnapshot?.collisionStats;
    if (!collisionStats || typeof collisionStats !== 'object') {
        return;
    }

    const collisionTotalMs = normalizeSnapshotNumber(collisionStats.enemyTotalMs, 0)
        + normalizeSnapshotNumber(collisionStats.projectileTotalMs, 0)
        + normalizeSnapshotNumber(collisionStats.contactTotalMs, 0);
    if (collisionTotalMs <= 0) {
        return;
    }

    lines.push(`collision ms: enemy ${formatDebugMs(collisionStats.enemyTotalMs)} | proj ${formatDebugMs(collisionStats.projectileTotalMs)} | contact ${formatDebugMs(collisionStats.contactTotalMs)}`);
    lines.push(`collision detail ms: grid ${formatDebugMs(collisionStats.solveGridMs)} | build ${formatDebugMs(collisionStats.solveCandidateBuildMs)} | proc ${formatDebugMs(collisionStats.solvePairProcessMs)} | narrow ${formatDebugMs(collisionStats.solveNarrowphaseMs)}`);

    const parallelNarrowphasePairCount = normalizeSnapshotNumber(collisionStats.solveParallelNarrowphasePairCount, 0);
    const parallelNarrowphaseContactCount = normalizeSnapshotNumber(collisionStats.solveParallelNarrowphaseContactCount, 0);
    const parallelNarrowphasePoolSize = normalizeSnapshotNumber(collisionStats.solveParallelNarrowphasePoolSize, 0);
    const parallelNarrowphaseChunkCount = normalizeSnapshotNumber(collisionStats.solveParallelNarrowphaseChunkCount, 0);
    const parallelNarrowphaseWaitMs = normalizeSnapshotNumber(collisionStats.solveParallelNarrowphaseWaitMs, 0);
    const parallelNarrowphaseFallbackCount = normalizeSnapshotNumber(collisionStats.solveParallelNarrowphaseFallbackCount, 0);
    const parallelNarrowphaseFallbackPairCount = normalizeSnapshotNumber(collisionStats.solveParallelNarrowphaseFallbackPairCount, 0);
    const parallelNarrowphaseOverflowCount = normalizeSnapshotNumber(collisionStats.solveParallelNarrowphaseOverflowCount, 0);
    if (parallelNarrowphasePairCount > 0
        || parallelNarrowphasePoolSize > 0
        || parallelNarrowphaseWaitMs > 0
        || parallelNarrowphaseFallbackCount > 0
        || parallelNarrowphaseOverflowCount > 0) {
        lines.push(`narrowphase worker: pool ${formatDebugCount(parallelNarrowphasePoolSize)} | chunks ${formatDebugCount(parallelNarrowphaseChunkCount)} | pairs ${formatDebugCount(parallelNarrowphasePairCount)} | contacts ${formatDebugCount(parallelNarrowphaseContactCount)}`);
        lines.push(`narrowphase worker ms: wait ${formatDebugMs(parallelNarrowphaseWaitMs)} | fallback ${formatDebugCount(parallelNarrowphaseFallbackCount)}/${formatDebugCount(parallelNarrowphaseFallbackPairCount)} | overflow ${formatDebugCount(parallelNarrowphaseOverflowCount)}`);
    }

    const candidatePairCount = normalizeSnapshotNumber(collisionStats.solveCandidatePairCount, 0);
    const budgetSkipCount = normalizeSnapshotNumber(collisionStats.solveBudgetSkipCount, 0);
    if (candidatePairCount > 0 || budgetSkipCount > 0) {
        lines.push(`collision pairs: bucket ${formatDebugCount(collisionStats.solveBucketPairCount)} | cand ${formatDebugCount(candidatePairCount)} | aabb ${formatDebugCount(collisionStats.solveAabbPassCount)} | circle ${formatDebugCount(collisionStats.solveCirclePassCount)}`);
        lines.push(`collision solve: resolved ${formatDebugCount(collisionStats.solveResolvedPairCount)} | budget skip ${formatDebugCount(budgetSkipCount)} | large ${formatDebugCount(collisionStats.solveLargePopulationMode)}`);
    }
}

/**
 * worker AI 계측 HUD 라인을 추가합니다.
 * @param {string[]} lines - 출력 문자열 목록입니다.
 * @param {object|null|undefined} bridgeStatus - worker bridge 상태입니다.
 * @returns {void}
 */
function _appendSimulationWorkerAIHudLines(lines, bridgeStatus) {
    const aiStats = bridgeStatus?.workerSnapshot?.aiStats;
    if (!Array.isArray(lines) || aiStats?.enabled !== true) {
        return;
    }

    const totalMs = Number.isFinite(aiStats.totalMs) ? aiStats.totalMs : 0;
    const enemyUpdateCount = Number.isFinite(aiStats.enemyUpdateCount) ? aiStats.enemyUpdateCount : 0;
    const heavyDecisionCount = Number.isFinite(aiStats.heavyDecisionCount) ? aiStats.heavyDecisionCount : 0;
    const localDirectReuseCount = Number.isFinite(aiStats.localDirectPathReuseCount)
        ? aiStats.localDirectPathReuseCount
        : 0;
    const sharedDirectPathCacheHitCount = Number.isFinite(aiStats.sharedDirectPathCacheHitCount)
        ? aiStats.sharedDirectPathCacheHitCount
        : 0;
    const sharedFlowFieldCacheHitCount = Number.isFinite(aiStats.sharedFlowFieldCacheHitCount)
        ? aiStats.sharedFlowFieldCacheHitCount
        : 0;
    const sharedDensityFieldCacheHitCount = Number.isFinite(aiStats.sharedDensityFieldCacheHitCount)
        ? aiStats.sharedDensityFieldCacheHitCount
        : 0;
    const sharedPolicyTargetCacheHitCount = Number.isFinite(aiStats.sharedPolicyTargetCacheHitCount)
        ? aiStats.sharedPolicyTargetCacheHitCount
        : 0;
    const densityFieldBuildCount = Number.isFinite(aiStats.densityFieldBuildCount)
        ? aiStats.densityFieldBuildCount
        : 0;
    const flowRefreshCount = Number.isFinite(aiStats.flowRefreshCount) ? aiStats.flowRefreshCount : 0;

    lines.push(`ai total: ${totalMs.toFixed(2)}ms | upd: ${enemyUpdateCount} | heavy: ${heavyDecisionCount}`);
    lines.push(`ai direct reuse/hit: ${localDirectReuseCount}/${sharedDirectPathCacheHitCount} | flow hit: ${sharedFlowFieldCacheHitCount}`);
    lines.push(`ai density hit/build: ${sharedDensityFieldCacheHitCount + sharedPolicyTargetCacheHitCount}/${densityFieldBuildCount} | flow refresh: ${flowRefreshCount}`);
}

/**
 * enemyAI worker pool 계측 HUD 라인을 추가합니다.
 * @param {string[]} lines - 출력 문자열 목록입니다.
 * @param {object|null|undefined} bridgeStatus - worker bridge 상태입니다.
 * @returns {void}
 */
function _appendSimulationWorkerEnemyAIWorkerHudLines(lines, bridgeStatus) {
    const enemyAIWorker = bridgeStatus?.workerSnapshot?.enemyAIWorker;
    if (!Array.isArray(lines) || !enemyAIWorker || typeof enemyAIWorker !== 'object') {
        return;
    }

    const transportMode = typeof enemyAIWorker.transportMode === 'string'
        ? enemyAIWorker.transportMode
        : 'message';
    const readiness = enemyAIWorker.ready === true
        ? 'ready'
        : (enemyAIWorker.running === true ? 'booting' : 'off');
    const requestCount = Number.isFinite(enemyAIWorker.requestCount) ? enemyAIWorker.requestCount : 0;
    const responseCount = Number.isFinite(enemyAIWorker.responseCount) ? enemyAIWorker.responseCount : 0;
    const staleDropCount = Number.isFinite(enemyAIWorker.staleDropCount) ? enemyAIWorker.staleDropCount : 0;
    const fallbackCount = Number.isFinite(enemyAIWorker.fallbackCount) ? enemyAIWorker.fallbackCount : 0;
    const lastLatencyMs = Number.isFinite(enemyAIWorker.lastLatencyMs) ? enemyAIWorker.lastLatencyMs : 0;
    const waitMs = Number.isFinite(enemyAIWorker.waitMs) ? enemyAIWorker.waitMs : lastLatencyMs;
    const lastEnemyCount = Number.isFinite(enemyAIWorker.lastEnemyCount) ? enemyAIWorker.lastEnemyCount : 0;
    const poolSize = Number.isFinite(enemyAIWorker.poolSize) ? enemyAIWorker.poolSize : 0;
    const chunkCount = Number.isFinite(enemyAIWorker.chunkCount) ? enemyAIWorker.chunkCount : 0;
    const completedChunkCount = Number.isFinite(enemyAIWorker.completedChunkCount)
        ? enemyAIWorker.completedChunkCount
        : 0;
    const sharedResultRangeCount = Number.isFinite(enemyAIWorker.sharedResultRangeCount)
        ? enemyAIWorker.sharedResultRangeCount
        : 0;
    const latestRequestedWallsVersion = Number.isFinite(enemyAIWorker.latestRequestedWallsVersion)
        ? enemyAIWorker.latestRequestedWallsVersion
        : -1;
    const latestRequestedEnemyTopologyVersion = Number.isFinite(enemyAIWorker.latestRequestedEnemyTopologyVersion)
        ? enemyAIWorker.latestRequestedEnemyTopologyVersion
        : -1;
    const lastWallsVersion = Number.isFinite(enemyAIWorker.lastWallsVersion)
        ? enemyAIWorker.lastWallsVersion
        : -1;
    const lastEnemyTopologyVersion = Number.isFinite(enemyAIWorker.lastEnemyTopologyVersion)
        ? enemyAIWorker.lastEnemyTopologyVersion
        : -1;
    const lastSharedResultVersion = Number.isFinite(enemyAIWorker.lastSharedResultVersion)
        ? enemyAIWorker.lastSharedResultVersion
        : 0;

    lines.push(`enemyAI: ${readiness} | tx: ${transportMode} | req/resp: ${requestCount}/${responseCount}`);
    lines.push(`enemyAI stale/fb: ${staleDropCount}/${fallbackCount} | lat: ${lastLatencyMs.toFixed(2)}ms | batch: ${lastEnemyCount}`);
    lines.push(`enemyAI pool/chunk: ${poolSize} | ${completedChunkCount}/${chunkCount} | sab ranges: ${sharedResultRangeCount} | wait: ${waitMs.toFixed(2)}ms`);
    lines.push(`enemyAI wall/topo req: ${latestRequestedWallsVersion}/${latestRequestedEnemyTopologyVersion} | done: ${lastWallsVersion}/${lastEnemyTopologyVersion} | ver: ${lastSharedResultVersion}`);
}
