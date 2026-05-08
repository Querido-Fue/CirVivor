import { ENEMY_AI_CONSTANTS } from '../../../../data/object/enemy/enemy_ai_constants.js';

const HEXA_HIVE_TYPE = 'hexa_hive';
const HEXA_HIVE_NAV_CELL_RADIUS_RATIO = ENEMY_AI_CONSTANTS.HEXA_HIVE_NAV_CELL_RADIUS_RATIO;

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

    return 24;
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
 * 양수 픽셀 값을 안전하게 읽습니다.
 * @param {number|null|undefined} value - 검사할 값입니다.
 * @returns {number} 양수 픽셀 값입니다.
 */
export const readPositivePixelValue = (value) => (
    Number.isFinite(value) && value > 0 ? value : 0
);

/**
 * 적의 AI용 footprint 크기를 계산합니다.
 * @param {object|null|undefined} enemy - 검사 대상 적입니다.
 * @param {number|null} [fallbackRadius=null] - 외부에서 계산한 반경입니다.
 * @param {number|null} [fallbackRenderHeightPx=null] - 외부에서 계산한 렌더 높이입니다.
 * @returns {{baseHeight: number, baseRadius: number, halfWidth: number, halfHeight: number, radius: number}} footprint 크기입니다.
 */
export function resolveEnemyAIFootprintMetricsPx(enemy, fallbackRadius = null, fallbackRenderHeightPx = null) {
    const baseHeight = resolveEnemyAIRenderHeightPx(enemy, fallbackRenderHeightPx);
    const baseRadius = Number.isFinite(fallbackRadius) && fallbackRadius > 0
        ? fallbackRadius
        : Math.max(8, baseHeight * 0.45);
    const aspectRatio = Number.isFinite(enemy?.aspectRatio) && enemy.aspectRatio > 0
        ? enemy.aspectRatio
        : 1;
    const heightScale = Number.isFinite(enemy?.heightScale) && enemy.heightScale > 0
        ? enemy.heightScale
        : 1;
    let halfWidth = Math.max(baseRadius, baseHeight * aspectRatio * 0.5);
    let halfHeight = Math.max(baseRadius, baseHeight * heightScale * 0.5);
    let radius = Math.max(baseRadius, readPositivePixelValue(enemy?.navigationRadiusPx));

    if (enemy?.type === HEXA_HIVE_TYPE) {
        const localCenters = getHexaHiveNavigationLocalCenters(enemy);
        if (Array.isArray(localCenters) && localCenters.length > 0) {
            const cellRadius = Math.max(baseRadius, baseHeight * HEXA_HIVE_NAV_CELL_RADIUS_RATIO);
            const rotationRadians = (Number.isFinite(enemy?.rotation) ? enemy.rotation : 0) * (Math.PI / 180);
            const cos = Math.cos(rotationRadians);
            const sin = Math.sin(rotationRadians);

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

    return {
        baseHeight,
        baseRadius,
        halfWidth,
        halfHeight,
        radius
    };
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
        : Math.max(8, baseHeight * 0.45);
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
    return Math.max(baseRadius, Math.min(maxRadius || projectedRadius, projectedRadius));
};
