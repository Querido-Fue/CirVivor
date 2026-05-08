/**
 * 계층별 활성 타이틀 적 수를 반환합니다.
 * @param {object[]} titleEnemies - 타이틀 적 목록입니다.
 * @param {object[]} parallaxLayers - 페럴렉스 계층 목록입니다.
 * @returns {number[]} 계층 인덱스별 적 수 배열입니다.
 */
export function countTitleParallaxLayerEnemies(titleEnemies, parallaxLayers) {
    if (!Array.isArray(parallaxLayers) || parallaxLayers.length === 0) {
        return [];
    }

    const counts = new Array(parallaxLayers.length).fill(0);
    for (let i = 0; i < titleEnemies.length; i++) {
        const enemy = titleEnemies[i];
        if (!enemy?.active) {
            continue;
        }
        const layerIndex = Number.isInteger(enemy._titleParallaxLayerIndex)
            ? Math.max(0, Math.min(parallaxLayers.length - 1, enemy._titleParallaxLayerIndex))
            : 0;
        counts[layerIndex] += 1;
    }

    return counts;
}

/**
 * 현재 활성화된 타이틀 적 수를 반환합니다.
 * @param {object[]} titleEnemies - 타이틀 적 목록입니다.
 * @returns {number} 활성 적 수입니다.
 */
export function countActiveTitleEnemies(titleEnemies) {
    let count = 0;
    for (let i = 0; i < titleEnemies.length; i++) {
        if (titleEnemies[i]?.active) {
            count += 1;
        }
    }
    return count;
}

/**
 * 계층별 최대 적 수 제한을 반환합니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @returns {number} 계층별 최대 적 수입니다.
 */
export function getTitlePerLayerEnemyLimit(titleEnemiesConfig) {
    const limit = titleEnemiesConfig.ENEMY_LIMIT_PER_LAYER;
    if (Number.isFinite(limit) && limit > 0) {
        return Math.floor(limit);
    }

    const fallbackLimit = titleEnemiesConfig.ENEMY_LIMIT;
    return Number.isFinite(fallbackLimit) && fallbackLimit > 0
        ? Math.floor(fallbackLimit)
        : 0;
}

/**
 * 계층별 목표 점유율 비율을 반환합니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @returns {number} 0~1 범위의 목표 점유율 비율입니다.
 */
export function getTitleTargetLayerOccupancyRatio(titleEnemiesConfig) {
    const ratio = titleEnemiesConfig.ENEMY_TARGET_OCCUPANCY_RATIO;
    if (Number.isFinite(ratio)) {
        return Math.max(0, Math.min(1, ratio));
    }

    return 1;
}

/**
 * 초기 버스트 목표 점유율 비율을 반환합니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @returns {number} 0~1 범위의 초기 버스트 점유율 비율입니다.
 */
export function getTitleInitialBurstFillRatio(titleEnemiesConfig) {
    const ratio = titleEnemiesConfig.INITIAL_BURST_FILL_RATIO;
    if (Number.isFinite(ratio)) {
        return Math.max(0, Math.min(1, ratio));
    }

    return 0;
}

/**
 * 계층별 목표 적 수를 반환합니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @returns {number} 계층별 목표 적 수입니다.
 */
export function getTitleTargetLayerEnemyCount(titleEnemiesConfig) {
    const perLayerLimit = getTitlePerLayerEnemyLimit(titleEnemiesConfig);
    if (perLayerLimit <= 0) {
        return 0;
    }

    const targetCount = Math.round(perLayerLimit * getTitleTargetLayerOccupancyRatio(titleEnemiesConfig));
    return Math.max(0, Math.min(perLayerLimit, targetCount));
}

/**
 * 계층별 초기 버스트 목표 적 수를 반환합니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @returns {number} 계층별 초기 버스트 목표 적 수입니다.
 */
export function getTitleInitialBurstTargetCount(titleEnemiesConfig) {
    const perLayerLimit = getTitlePerLayerEnemyLimit(titleEnemiesConfig);
    if (perLayerLimit <= 0) {
        return 0;
    }

    const burstCount = Math.round(perLayerLimit * getTitleInitialBurstFillRatio(titleEnemiesConfig));
    return Math.max(0, Math.min(perLayerLimit, burstCount));
}

/**
 * 초기 버스트 전체 지속 시간을 반환합니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @returns {number} 초기 버스트 지속 시간(초)입니다.
 */
export function getTitleInitialBurstDurationSeconds(titleEnemiesConfig) {
    const burstDuration = titleEnemiesConfig.INITIAL_BURST_DURATION_SECONDS;
    if (Number.isFinite(burstDuration) && burstDuration > 0) {
        return burstDuration;
    }

    return 0;
}

/**
 * 초기 버스트 적에게 적용할 충돌 유예 시간을 반환합니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @returns {number} 충돌 유예 시간(초)입니다.
 */
export function getTitleInitialBurstCollisionGraceSeconds(titleEnemiesConfig) {
    const collisionGraceSeconds = titleEnemiesConfig.INITIAL_BURST_COLLISION_GRACE_SECONDS;
    if (Number.isFinite(collisionGraceSeconds) && collisionGraceSeconds > 0) {
        return collisionGraceSeconds;
    }

    return 0;
}

/**
 * 초기 버스트 한 틱당 최대 스폰 수를 반환합니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @returns {number} 한 틱당 최대 스폰 수입니다.
 */
export function getTitleInitialBurstMaxSpawnPerStep(titleEnemiesConfig) {
    const maxSpawnPerStep = titleEnemiesConfig.INITIAL_BURST_MAX_SPAWN_PER_STEP;
    if (Number.isFinite(maxSpawnPerStep) && maxSpawnPerStep > 0) {
        return Math.max(1, Math.floor(maxSpawnPerStep));
    }

    return 0;
}

/**
 * 특정 계층의 평균 수평 이동속도를 픽셀/초 단위로 반환합니다.
 * @param {object} layerProfile - 계층 프로필입니다.
 * @param {number} uiww - UI 기준 너비입니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @returns {number} 평균 수평 이동속도(px/s)입니다.
 */
export function getTitleLayerAverageAxisSpeedPx(layerProfile, uiww, titleEnemiesConfig) {
    const minRatio = titleEnemiesConfig.AXIS_SPEED_MIN_RATIO;
    const maxRatio = titleEnemiesConfig.AXIS_SPEED_MAX_RATIO;
    const leftMultiplier = Number.isFinite(titleEnemiesConfig.AXIS_SPEED_LEFT_MULTIPLIER)
        ? titleEnemiesConfig.AXIS_SPEED_LEFT_MULTIPLIER
        : 1;
    const averageRatio = (minRatio + maxRatio) * 0.5;
    const speedScale = Number.isFinite(layerProfile.SpeedScale) ? layerProfile.SpeedScale : 1;
    const averageSpeedPx = uiww * averageRatio * speedScale * leftMultiplier;
    return Number.isFinite(averageSpeedPx) ? Math.max(0, averageSpeedPx) : 0;
}

/**
 * 타이틀 적이 좌측 컬링 지점까지 이동해야 하는 평균 수평 거리를 반환합니다.
 * @param {number} ww - 화면 너비입니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @param {number} spawnCullGuardPx - 스폰 위치 컬링 보호값입니다.
 * @returns {number} 수평 이동 거리(px)입니다.
 */
export function getTitleHorizontalTravelDistancePx(ww, titleEnemiesConfig, spawnCullGuardPx) {
    const cullRatio = titleEnemiesConfig.ENEMY_CULL_OUTSIDE_RATIO;
    const marginX = ww * cullRatio;
    const spawnXByRatio = ww * titleEnemiesConfig.ENEMY_SPAWN_X_RATIO;
    const spawnX = Math.min(spawnXByRatio, (ww + marginX) - spawnCullGuardPx);
    return Math.max(0, spawnX + marginX);
}

/**
 * 목표 유지 스폰 레이트를 반환합니다.
 * @param {number} targetCount - 목표 적 수입니다.
 * @param {number} averageAxisSpeedPx - 평균 수평 이동속도(px/s)입니다.
 * @param {number} travelDistancePx - 평균 수평 이동 거리(px)입니다.
 * @returns {number} 초당 스폰 수입니다.
 */
export function getTitleLayerSpawnRate(targetCount, averageAxisSpeedPx, travelDistancePx) {
    if (targetCount <= 0 || !(averageAxisSpeedPx > 0) || !(travelDistancePx > 0)) {
        return 0;
    }

    const travelSeconds = travelDistancePx / averageAxisSpeedPx;
    if (!(travelSeconds > 0)) {
        return 0;
    }

    return targetCount / travelSeconds;
}
