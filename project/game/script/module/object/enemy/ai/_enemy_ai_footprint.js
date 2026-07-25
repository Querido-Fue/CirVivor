import { ENEMY_AI_DATA } from 'data/object/enemy/enemy_ai_data.js';
import { clampNumber } from 'util/number_util.js';
import { getHexaHiveType } from '../_hexa_hive_layout.js';

const DEFAULT_AI_PROFILE = ENEMY_AI_DATA.QUALITY_PROFILES[ENEMY_AI_DATA.DEFAULT_QUALITY_PROFILE];
const FOOTPRINT_CONSTANTS = ENEMY_AI_DATA.FOOTPRINT;
const HEXA_HIVE_TYPE = getHexaHiveType();
const HEXA_HIVE_NAV_CELL_RADIUS_RATIO = ENEMY_AI_DATA.HEXA_HIVE_NAV_CELL_RADIUS_RATIO;
const AXIS_EPSILON = 1e-6;
const FALLBACK_RENDER_HEIGHT_PX = FOOTPRINT_CONSTANTS.FALLBACK_RENDER_HEIGHT_PX;
const BASE_RADIUS_MIN_PX = FOOTPRINT_CONSTANTS.BASE_RADIUS_MIN_PX;
const BASE_RADIUS_RATIO = FOOTPRINT_CONSTANTS.BASE_RADIUS_RATIO;
const HALF_EXTENT_RATIO = FOOTPRINT_CONSTANTS.HALF_EXTENT_RATIO;
const MIN_AXIS_ANISOTROPY = FOOTPRINT_CONSTANTS.MIN_AXIS_ANISOTROPY;
const MAX_AXIS_ANISOTROPY = FOOTPRINT_CONSTANTS.MAX_AXIS_ANISOTROPY;
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;

/**
 * footprint 결과의 안정적인 필드 순서를 가진 초기 버퍼를 생성합니다.
 * @returns {{baseHeight: number, baseRadius: number, halfWidth: number, halfHeight: number, radius: number, axisLocalDeg: number, axisAnisotropy: number}}
 */
const createEnemyAIFootprintMetricsBuffer = () => ({
    baseHeight: 0,
    baseRadius: 0,
    halfWidth: 0,
    halfHeight: 0,
    radius: 0,
    axisLocalDeg: 0,
    axisAnisotropy: 0
});

/**
 * 적의 렌더 높이를 AI 계산용 픽셀 값으로 정규화합니다.
 * @param {object|null|undefined} enemy - 검사 대상 적입니다.
 * @param {number|null} [fallbackRenderHeightPx=null] - 외부에서 계산한 렌더 높이입니다.
 * @returns {number} AI 계산용 렌더 높이입니다.
 */
export const resolveEnemyAIRenderHeightPx = (enemy, fallbackRenderHeightPx = null) => {
    if (Number.isFinite(fallbackRenderHeightPx) && fallbackRenderHeightPx > 0) {
        return fallbackRenderHeightPx;
    }

    const methodHeight = typeof enemy?.getRenderHeightPx === 'function'
        ? enemy.getRenderHeightPx()
        : Number.NaN;
    if (Number.isFinite(methodHeight) && methodHeight > 0) {
        return methodHeight;
    }

    if (Number.isFinite(enemy?.renderHeightPx) && enemy.renderHeightPx > 0) {
        return enemy.renderHeightPx;
    }

    return FALLBACK_RENDER_HEIGHT_PX;
};

/**
 * 합체 육각형의 네비게이션용 로컬 중심 목록을 반환합니다.
 * @param {object|null|undefined} enemy - 검사 대상 적입니다.
 * @returns {object[]|null} 로컬 중심 목록입니다.
 */
const getHexaHiveNavigationLocalCenters = (enemy) => {
    const layout = enemy?.hexaHiveLayout;
    if (Array.isArray(layout?.filledLocalCenters) && layout.filledLocalCenters.length > 0) {
        return layout.filledLocalCenters;
    }
    if (Array.isArray(layout?.visibleLocalCenters) && layout.visibleLocalCenters.length > 0) {
        return layout.visibleLocalCenters;
    }
    return null;
};

/**
 * 합체 육각형 로컬 중심 분포에서 가장 긴 주축을 계산합니다.
 * @param {object[]|null|undefined} localCenters - 합체 육각형 로컬 중심 목록입니다.
 * @param {object} out - axisLocalDeg와 axisAnisotropy를 기록할 footprint 메트릭입니다.
 * @returns {object} 전달받은 footprint 메트릭입니다.
 */
const resolveHexaHiveNavigationAxisInto = (localCenters, out) => {
    out.axisLocalDeg = 0;
    out.axisAnisotropy = 0;
    if (!Array.isArray(localCenters) || localCenters.length < 2) {
        return out;
    }

    let meanX = 0;
    let meanY = 0;
    let count = 0;
    for (let i = 0; i < localCenters.length; i++) {
        const localCenter = localCenters[i];
        const x = Number.isFinite(localCenter?.x) ? localCenter.x : Number.NaN;
        const y = Number.isFinite(localCenter?.y) ? localCenter.y : Number.NaN;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
        }

        meanX += x;
        meanY += y;
        count++;
    }
    if (count < 2) {
        return out;
    }
    meanX /= count;
    meanY /= count;

    let covXX = 0;
    let covYY = 0;
    let covXY = 0;
    for (let i = 0; i < localCenters.length; i++) {
        const localCenter = localCenters[i];
        const x = Number.isFinite(localCenter?.x) ? localCenter.x : Number.NaN;
        const y = Number.isFinite(localCenter?.y) ? localCenter.y : Number.NaN;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
        }

        const dx = x - meanX;
        const dy = y - meanY;
        covXX += dx * dx;
        covYY += dy * dy;
        covXY += dx * dy;
    }

    const spread = covXX + covYY;
    if (spread <= AXIS_EPSILON) {
        return out;
    }

    const anisotropy = Math.min(MAX_AXIS_ANISOTROPY, Math.hypot(covXX - covYY, 2 * covXY) / spread);
    const localDeg = HALF_EXTENT_RATIO * Math.atan2(2 * covXY, covXX - covYY) * RADIANS_TO_DEGREES;
    out.axisLocalDeg = Number.isFinite(localDeg) ? localDeg : 0;
    out.axisAnisotropy = Number.isFinite(anisotropy) ? anisotropy : 0;
    return out;
};

/**
 * 양수 픽셀 값을 안전하게 읽습니다.
 * @param {number|null|undefined} value - 검사할 값입니다.
 * @returns {number} 양수 픽셀 값입니다.
 */
export const readPositivePixelValue = (value) => (
    Number.isFinite(value) && value > 0 ? value : 0
);

/**
 * 길쭉한 합체 육각형이 통로 탐색에 사용할 두께 기반 clearance를 계산합니다.
 * @param {object|null|undefined} metrics - footprint 메트릭입니다.
 * @param {object|null|undefined} profile - AI 품질 프로필입니다.
 * @returns {number} 통로 탐색용 clearance입니다.
 */
export const resolveEnemyAIFootprintPathClearancePx = (metrics, profile = null) => {
    const baseRadius = readPositivePixelValue(metrics?.baseRadius);
    if (baseRadius <= 0) {
        return 0;
    }

    const halfWidth = readPositivePixelValue(metrics?.halfWidth) || baseRadius;
    const halfHeight = readPositivePixelValue(metrics?.halfHeight) || baseRadius;
    const minHalfExtent = Math.min(halfWidth, halfHeight);
    const multiplier = Number.isFinite(profile?.HEXA_HIVE_PATH_CLEARANCE_BASE_RADIUS_MULTIPLIER)
        ? Math.max(1, profile.HEXA_HIVE_PATH_CLEARANCE_BASE_RADIUS_MULTIPLIER)
        : DEFAULT_AI_PROFILE.HEXA_HIVE_PATH_CLEARANCE_BASE_RADIUS_MULTIPLIER;
    return clampNumber(baseRadius * multiplier, baseRadius, minHalfExtent);
};

/**
 * 적의 AI용 footprint 크기를 계산합니다.
 * @param {object|null|undefined} enemy - 검사 대상 적입니다.
 * @param {number|null} [fallbackRadius=null] - 외부에서 계산한 반경입니다.
 * @param {number|null} [fallbackRenderHeightPx=null] - 외부에서 계산한 렌더 높이입니다.
 * @returns {{baseHeight: number, baseRadius: number, halfWidth: number, halfHeight: number, radius: number, axisLocalDeg: number, axisAnisotropy: number}} footprint 크기입니다.
 */
export function resolveEnemyAIFootprintMetricsPx(enemy, fallbackRadius = null, fallbackRenderHeightPx = null) {
    return resolveEnemyAIFootprintMetricsPxInto(
        enemy,
        fallbackRadius,
        fallbackRenderHeightPx,
        createEnemyAIFootprintMetricsBuffer()
    );
}

/**
 * 적의 AI용 footprint 크기를 재사용 객체에 기록합니다.
 * @param {object|null|undefined} enemy - 검사 대상 적입니다.
 * @param {number|null} [fallbackRadius=null] - 외부에서 계산한 반경입니다.
 * @param {number|null} [fallbackRenderHeightPx=null] - 외부에서 계산한 렌더 높이입니다.
 * @param {object|null|undefined} [out=null] - 결과를 기록할 재사용 객체입니다.
 * @returns {{baseHeight: number, baseRadius: number, halfWidth: number, halfHeight: number, radius: number, axisLocalDeg: number, axisAnisotropy: number}} 채워진 footprint 크기입니다.
 */
export function resolveEnemyAIFootprintMetricsPxInto(
    enemy,
    fallbackRadius = null,
    fallbackRenderHeightPx = null,
    out = null
) {
    const metrics = out && typeof out === 'object'
        ? out
        : createEnemyAIFootprintMetricsBuffer();
    const baseHeight = resolveEnemyAIRenderHeightPx(enemy, fallbackRenderHeightPx);
    const baseRadius = Number.isFinite(fallbackRadius) && fallbackRadius > 0
        ? fallbackRadius
        : Math.max(BASE_RADIUS_MIN_PX, baseHeight * BASE_RADIUS_RATIO);
    const aspectRatio = Number.isFinite(enemy?.aspectRatio) && enemy.aspectRatio > 0
        ? enemy.aspectRatio
        : 1;
    const heightScale = Number.isFinite(enemy?.heightScale) && enemy.heightScale > 0
        ? enemy.heightScale
        : 1;
    let halfWidth = Math.max(baseRadius, baseHeight * aspectRatio * HALF_EXTENT_RATIO);
    let halfHeight = Math.max(baseRadius, baseHeight * heightScale * HALF_EXTENT_RATIO);
    let radius = Math.max(baseRadius, readPositivePixelValue(enemy?.navigationRadiusPx));
    metrics.axisLocalDeg = Number.isFinite(enemy?.navigationAxisLocalDeg) ? enemy.navigationAxisLocalDeg : 0;
    metrics.axisAnisotropy = Number.isFinite(enemy?.navigationAxisAnisotropy)
        ? clampNumber(enemy.navigationAxisAnisotropy, MIN_AXIS_ANISOTROPY, MAX_AXIS_ANISOTROPY)
        : 0;

    if (enemy?.type === HEXA_HIVE_TYPE) {
        const localCenters = getHexaHiveNavigationLocalCenters(enemy);
        if (Array.isArray(localCenters) && localCenters.length > 0) {
            const cellRadius = Math.max(baseRadius, baseHeight * HEXA_HIVE_NAV_CELL_RADIUS_RATIO);
            const rotationRadians = (Number.isFinite(enemy?.rotation) ? enemy.rotation : 0) * DEGREES_TO_RADIANS;
            const cos = Math.cos(rotationRadians);
            const sin = Math.sin(rotationRadians);
            resolveHexaHiveNavigationAxisInto(localCenters, metrics);

            halfWidth = Math.max(halfWidth, cellRadius);
            halfHeight = Math.max(halfHeight, cellRadius);
            radius = Math.max(radius, cellRadius);
            for (let i = 0; i < localCenters.length; i++) {
                const localCenter = localCenters[i];
                const localX = (Number.isFinite(localCenter?.x) ? localCenter.x : 0) * baseHeight;
                const localY = (Number.isFinite(localCenter?.y) ? localCenter.y : 0) * baseHeight;
                const worldLocalX = (localX * cos) - (localY * sin);
                const worldLocalY = (localX * sin) + (localY * cos);
                halfWidth = Math.max(halfWidth, Math.abs(worldLocalX) + cellRadius);
                halfHeight = Math.max(halfHeight, Math.abs(worldLocalY) + cellRadius);
                radius = Math.max(radius, Math.hypot(worldLocalX, worldLocalY) + cellRadius);
            }
        }
    }

    halfWidth = Math.max(halfWidth, readPositivePixelValue(enemy?.navigationHalfWidthPx));
    halfHeight = Math.max(halfHeight, readPositivePixelValue(enemy?.navigationHalfHeightPx));
    radius = Math.max(radius, readPositivePixelValue(enemy?.navigationRadiusPx));

    metrics.baseHeight = baseHeight;
    metrics.baseRadius = baseRadius;
    metrics.halfWidth = halfWidth;
    metrics.halfHeight = halfHeight;
    metrics.radius = radius;
    return metrics;
}

/**
 * 적이 벽을 피할 때 사용할 네비게이션 반경을 계산합니다.
 * @param {object|null|undefined} enemy - 검사 대상 적입니다.
 * @param {number|null} [fallbackRadius=null] - 외부에서 계산한 반경입니다.
 * @param {number|null} [fallbackRenderHeightPx=null] - 외부에서 계산한 렌더 높이입니다.
 * @returns {number} 네비게이션 반경입니다.
 */
export function resolveEnemyAINavigationRadiusPx(enemy, fallbackRadius = null, fallbackRenderHeightPx = null) {
    const baseHeight = resolveEnemyAIRenderHeightPx(enemy, fallbackRenderHeightPx);
    const baseRadius = Number.isFinite(fallbackRadius) && fallbackRadius > 0
        ? fallbackRadius
        : Math.max(BASE_RADIUS_MIN_PX, baseHeight * BASE_RADIUS_RATIO);
    const explicitRadius = readPositivePixelValue(enemy?.navigationRadiusPx);
    if (enemy?.type !== HEXA_HIVE_TYPE) {
        return Math.max(baseRadius, explicitRadius);
    }

    return resolveEnemyAIFootprintMetricsPx(enemy, baseRadius, baseHeight).radius;
}

/**
 * 지정 방향에서 footprint가 차지하는 반지름을 추정합니다.
 * @param {{baseRadius: number, halfWidth: number, halfHeight: number, radius: number}} metrics - footprint 메트릭입니다.
 * @param {number} dirX - 방향 X 성분입니다.
 * @param {number} dirY - 방향 Y 성분입니다.
 * @returns {number} 방향 투영 반경입니다.
 */
export const projectEnemyAIFootprintRadiusForDirection = (metrics, dirX, dirY) => {
    const halfWidth = readPositivePixelValue(metrics?.halfWidth);
    const halfHeight = readPositivePixelValue(metrics?.halfHeight);
    const baseRadius = readPositivePixelValue(metrics?.baseRadius);
    const maxRadius = readPositivePixelValue(metrics?.radius);
    const projectedRadius = (Math.abs(dirX) * halfWidth) + (Math.abs(dirY) * halfHeight);
    return clampNumber(projectedRadius, baseRadius, maxRadius || projectedRadius);
};
