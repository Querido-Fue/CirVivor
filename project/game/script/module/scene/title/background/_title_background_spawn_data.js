import { mathUtil } from 'util/math_util.js';
import { clampFiniteNumber, clampNumber, resolveFiniteNumber } from 'util/number_util.js';
import { getTitleDefaultParallaxLayerProfile } from './_title_background_parallax.js';
import { getTitlePerLayerEnemyLimit } from './_title_background_spawn_metrics.js';

/**
 * 타이틀 배경 적 생성에 필요한 위치, 속도, 계층 정보를 계산합니다.
 * @param {object} options - 스폰 데이터 계산 옵션입니다.
 * @param {object} options.titleEnemiesConfig - 타이틀 적 설정입니다.
 * @param {object} options.titleAiConfig - 타이틀 AI 설정입니다.
 * @param {object[]} options.parallaxLayers - 페럴렉스 계층 설정 목록입니다.
 * @param {number} options.ww - 시뮬레이션 화면 너비입니다.
 * @param {number} options.objectWH - 오브젝트 좌표계 높이입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @param {number} options.spawnCullGuardPx - 스폰 위치 컬링 보호값입니다.
 * @param {number[]|null} [options.layerCounts=null] - 계층별 현재 적 수 캐시입니다.
 * @param {number|null} [options.preferredLayerIndex=null] - 우선 스폰할 계층 인덱스입니다.
 * @param {'standard'|'initialBurst'} [options.spawnMode='standard'] - 생성 방식입니다.
 * @param {{burstSpawnIndex?: number, burstTargetCount?: number}|null} [options.spawnOptions=null] - 초기 버스트 옵션입니다.
 * @returns {object|null} 위치 및 속도 데이터입니다.
 */
export function buildTitleBackgroundSpawnData({
    titleEnemiesConfig,
    titleAiConfig,
    parallaxLayers,
    ww,
    objectWH,
    uiww,
    spawnCullGuardPx,
    layerCounts = null,
    preferredLayerIndex = null,
    spawnMode = 'standard',
    spawnOptions = null
}) {
    const cullRatio = titleEnemiesConfig.ENEMY_CULL_OUTSIDE_RATIO;
    const marginY = objectWH * cullRatio;
    const marginX = ww * cullRatio;
    const layerData = _pickTitleParallaxLayer({
        titleEnemiesConfig,
        parallaxLayers,
        layerCounts,
        preferredLayerIndex
    });
    if (!layerData) {
        return null;
    }

    const isInitialBurst = spawnMode === 'initialBurst';
    const spawnX = isInitialBurst
        ? _getInitialBurstSpawnX(titleEnemiesConfig, ww, marginX, spawnCullGuardPx)
        : _getStandardSpawnX(titleEnemiesConfig, ww, marginX, spawnCullGuardPx);
    const baseAxisSpeed = uiww * mathUtil().random(
        titleEnemiesConfig.AXIS_SPEED_MIN_RATIO,
        titleEnemiesConfig.AXIS_SPEED_MAX_RATIO
    ) * layerData.profile.SpeedScale * resolveFiniteNumber(
        titleEnemiesConfig.AXIS_SPEED_LEFT_MULTIPLIER,
        1
    );
    const baseDriftSpeed = uiww * mathUtil().random(
        titleEnemiesConfig.DRIFT_SPEED_MIN_RATIO,
        titleEnemiesConfig.DRIFT_SPEED_MAX_RATIO
    ) * layerData.profile.SpeedScale;
    const initialAxisSpeed = isInitialBurst
        ? _getInitialBurstAxisSpeed(titleEnemiesConfig, baseAxisSpeed, layerData.profile)
        : baseAxisSpeed;
    const initialDriftSpeed = isInitialBurst
        ? _getInitialBurstDriftSpeed(titleEnemiesConfig, baseDriftSpeed)
        : baseDriftSpeed;
    const spawnY = isInitialBurst
        ? _getInitialBurstSpawnY(
            titleEnemiesConfig,
            objectWH,
            spawnOptions?.burstSpawnIndex,
            spawnOptions?.burstTargetCount
        )
        : mathUtil().random(-marginY, objectWH + marginY);

    return {
        layerIndex: layerData.index,
        layerProfile: layerData.profile,
        position: {
            x: spawnX,
            y: spawnY
        },
        speed: { x: -initialAxisSpeed, y: initialDriftSpeed },
        baseSpeed: { x: -baseAxisSpeed, y: baseDriftSpeed },
        burstVelocity: isInitialBurst
            ? {
                x: -(initialAxisSpeed - baseAxisSpeed),
                y: initialDriftSpeed - baseDriftSpeed
            }
            : null,
        burstDecayRate: isInitialBurst
            ? titleAiConfig.BURST_VELOCITY_EASEOUT_EXPO_RATE
            : 0
    };
}

/**
 * 스폰에 사용할 페럴렉스 레이어를 하나 고릅니다.
 * @param {object} options - 레이어 선택 옵션입니다.
 * @param {object} options.titleEnemiesConfig - 타이틀 적 설정입니다.
 * @param {object[]} options.parallaxLayers - 페럴렉스 계층 설정 목록입니다.
 * @param {number[]|null} options.layerCounts - 계층별 현재 적 수 캐시입니다.
 * @param {number|null} options.preferredLayerIndex - 우선 스폰할 계층 인덱스입니다.
 * @returns {{index:number, profile:object}|null} 레이어 인덱스와 설정값입니다.
 */
function _pickTitleParallaxLayer({
    titleEnemiesConfig,
    parallaxLayers,
    layerCounts,
    preferredLayerIndex
}) {
    if (!Array.isArray(parallaxLayers) || parallaxLayers.length === 0) {
        return {
            index: 0,
            profile: getTitleDefaultParallaxLayerProfile(titleEnemiesConfig)
        };
    }

    const perLayerLimit = getTitlePerLayerEnemyLimit(titleEnemiesConfig);
    const resolvedPreferredLayerIndex = Number.isInteger(preferredLayerIndex)
        ? clampNumber(preferredLayerIndex, 0, parallaxLayers.length - 1)
        : null;
    if (resolvedPreferredLayerIndex !== null) {
        const layerCount = Array.isArray(layerCounts) ? layerCounts[resolvedPreferredLayerIndex] : 0;
        if (layerCount >= perLayerLimit) {
            return null;
        }
        return {
            index: resolvedPreferredLayerIndex,
            profile: parallaxLayers[resolvedPreferredLayerIndex]
        };
    }

    const availableLayerIndexes = [];
    for (let layerIndex = 0; layerIndex < parallaxLayers.length; layerIndex++) {
        const layerCount = Array.isArray(layerCounts) ? layerCounts[layerIndex] : 0;
        if (layerCount < perLayerLimit) {
            availableLayerIndexes.push(layerIndex);
        }
    }
    if (availableLayerIndexes.length === 0) {
        return null;
    }

    const randomIndex = Math.floor(mathUtil().random(0, availableLayerIndexes.length));
    const layerIndex = availableLayerIndexes[randomIndex];
    return {
        index: layerIndex,
        profile: parallaxLayers[layerIndex]
    };
}

/**
 * 일반 유지 스폰의 기본 x 좌표를 반환합니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @param {number} ww - 시뮬레이션 화면 너비입니다.
 * @param {number} marginX - 컬링 마진 x값입니다.
 * @param {number} spawnCullGuardPx - 스폰 위치 컬링 보호값입니다.
 * @returns {number} 스폰 x 좌표입니다.
 */
function _getStandardSpawnX(titleEnemiesConfig, ww, marginX, spawnCullGuardPx) {
    const spawnXByRatio = ww * titleEnemiesConfig.ENEMY_SPAWN_X_RATIO;
    return Math.max(
        ww,
        Math.min(spawnXByRatio, (ww + marginX) - spawnCullGuardPx)
    );
}

/**
 * 초기 버스트 스폰의 x 좌표를 반환합니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @param {number} ww - 시뮬레이션 화면 너비입니다.
 * @param {number} marginX - 컬링 마진 x값입니다.
 * @param {number} spawnCullGuardPx - 스폰 위치 컬링 보호값입니다.
 * @returns {number} 스폰 x 좌표입니다.
 */
function _getInitialBurstSpawnX(titleEnemiesConfig, ww, marginX, spawnCullGuardPx) {
    const maxSpawnX = Math.min(
        ww + marginX - spawnCullGuardPx,
        ww * titleEnemiesConfig.INITIAL_BURST_SPAWN_X_MAX_RATIO
    );
    const minSpawnX = Math.max(
        ww,
        Math.min(
            maxSpawnX,
            ww * titleEnemiesConfig.INITIAL_BURST_SPAWN_X_MIN_RATIO
        )
    );
    return mathUtil().random(minSpawnX, maxSpawnX);
}

/**
 * 초기 버스트 스폰의 y 좌표를 반환합니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @param {number} objectWH - 오브젝트 좌표계 높이입니다.
 * @param {number} [burstSpawnIndex=0] - 현재 초기 버스트 누적 스폰 인덱스입니다.
 * @param {number} [burstTargetCount=1] - 초기 버스트 전체 목표 수량입니다.
 * @returns {number} 스폰 y 좌표입니다.
 */
function _getInitialBurstSpawnY(titleEnemiesConfig, objectWH, burstSpawnIndex = 0, burstTargetCount = 1) {
    const minY = objectWH * titleEnemiesConfig.SPAWN_Y_MIN_RATIO;
    const maxY = objectWH * titleEnemiesConfig.SPAWN_Y_MAX_RATIO;
    const totalRange = Math.max(1, maxY - minY);
    const safeTargetCount = Math.floor(clampFiniteNumber(burstTargetCount, 1, Infinity, 1));
    const sequentialIndex = Math.floor(clampFiniteNumber(burstSpawnIndex, 0, Infinity, 0)) % safeTargetCount;
    const slotIndex = ((sequentialIndex * 37) + 17) % safeTargetCount;
    const slotHeight = totalRange / safeTargetCount;
    const slotCenter = minY + ((slotIndex + 0.5) * slotHeight);
    const jitterRatio = clampFiniteNumber(titleEnemiesConfig.INITIAL_BURST_Y_JITTER_RATIO, 0, 1, 0.78);
    const jitterAmplitude = slotHeight * 0.5 * jitterRatio;
    return clampNumber(slotCenter + mathUtil().random(-jitterAmplitude, jitterAmplitude), minY, maxY);
}

/**
 * 초기 버스트용 수평 속도를 계산합니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @param {number} baseAxisSpeed - 정상 상태 기준 수평 속도입니다.
 * @param {object} layerProfile - 현재 계층 프로필입니다.
 * @returns {number} 초기 버스트 수평 속도입니다.
 */
function _getInitialBurstAxisSpeed(titleEnemiesConfig, baseAxisSpeed, layerProfile) {
    const speedScale = resolveFiniteNumber(layerProfile?.SpeedScale, 1);
    const compensationMin = clampFiniteNumber(
        titleEnemiesConfig.INITIAL_BURST_LAYER_COMPENSATION_MIN,
        0.01,
        Infinity,
        0.4
    );
    const layerCompensation = 1 / Math.max(compensationMin, Math.sqrt(Math.max(0, speedScale)));
    const burstMultiplier = mathUtil().random(
        titleEnemiesConfig.INITIAL_BURST_AXIS_SPEED_MIN_MULTIPLIER,
        titleEnemiesConfig.INITIAL_BURST_AXIS_SPEED_MAX_MULTIPLIER
    );
    return baseAxisSpeed * burstMultiplier * layerCompensation;
}

/**
 * 초기 버스트용 수직 속도를 계산합니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @param {number} baseDriftSpeed - 정상 상태 기준 수직 속도입니다.
 * @returns {number} 초기 버스트 수직 속도입니다.
 */
function _getInitialBurstDriftSpeed(titleEnemiesConfig, baseDriftSpeed) {
    const driftMultiplier = mathUtil().random(
        titleEnemiesConfig.INITIAL_BURST_DRIFT_SPEED_MIN_MULTIPLIER,
        titleEnemiesConfig.INITIAL_BURST_DRIFT_SPEED_MAX_MULTIPLIER
    );
    return baseDriftSpeed * driftMultiplier;
}
