import { getData } from 'data/data_handler.js';

const ENEMY_COLLISION_RADIUS_DATA = getData('ENEMY_COLLISION_RADIUS_DATA');
const ENEMY_COLLISION_RADIUS_TYPES = ENEMY_COLLISION_RADIUS_DATA.TYPES;
const ENEMY_COLLISION_RADIUS_MIN_DIMENSION = ENEMY_COLLISION_RADIUS_DATA.MIN_DIMENSION;
const ENEMY_COLLISION_RADIUS_DEFAULT_TYPE = ENEMY_COLLISION_RADIUS_DATA.DEFAULT_TYPE;

/**
 * 합체 적 충돌 형상 기준 셀 수를 반환합니다.
 * @param {object|null|undefined} enemy - 조회할 적 객체입니다.
 * @returns {number} 충돌 셀 수입니다.
 */
export function getHexaHiveCollisionCellCount(enemy) {
    const candidateCounts = [
        enemy?.hexaHiveLayout?.filledCells?.length,
        enemy?.hexaHiveLayout?.filledLocalCenters?.length,
        enemy?.hexaHiveLayout?.visibleLocalCenters?.length
    ];

    for (let i = 0; i < candidateCounts.length; i++) {
        const count = candidateCounts[i];
        if (Number.isInteger(count) && count > 0) {
            return count;
        }
    }

    return 1;
}

/**
 * 큰 육각 합체 적의 충돌 보정 반경을 계산합니다.
 * @param {object|null|undefined} enemy - 대상 적 객체입니다.
 * @param {number} boundRadius - body 외곽 반경입니다.
 * @param {number} baseHeight - 기준 높이입니다.
 * @param {{minRadius:number, hexaHiveRadiusScale:number, hexaHiveRootScale:number}} tuning - 반경 보정값입니다.
 * @returns {number} 충돌 보정 반경입니다.
 */
export function getEnemyResolveRadius(enemy, boundRadius, baseHeight, tuning) {
    const minRadius = Number.isFinite(tuning?.minRadius)
        ? tuning.minRadius
        : ENEMY_COLLISION_RADIUS_MIN_DIMENSION;
    const hexaHiveRadiusScale = Number.isFinite(tuning?.hexaHiveRadiusScale)
        ? tuning.hexaHiveRadiusScale
        : ENEMY_COLLISION_RADIUS_MIN_DIMENSION;
    const hexaHiveRootScale = Number.isFinite(tuning?.hexaHiveRootScale) ? tuning.hexaHiveRootScale : 0;
    const safeBoundRadius = Number.isFinite(boundRadius) ? Math.max(minRadius, boundRadius) : minRadius;
    if (enemy?.type !== 'hexa_hive') {
        return safeBoundRadius;
    }

    const safeBaseHeight = Number.isFinite(baseHeight) ? Math.max(minRadius, baseHeight) : safeBoundRadius;
    const cellCount = getHexaHiveCollisionCellCount(enemy);
    const rootedCellCount = Math.max(ENEMY_COLLISION_RADIUS_MIN_DIMENSION, Math.sqrt(cellCount));
    const cellDrivenRadius = safeBaseHeight * (
        hexaHiveRadiusScale
        + (
            Math.max(0, rootedCellCount - ENEMY_COLLISION_RADIUS_MIN_DIMENSION)
            * hexaHiveRootScale
        )
    );
    const hybridRadius = Math.sqrt(safeBoundRadius * safeBaseHeight);
    return Math.max(
        minRadius,
        Math.min(
            safeBoundRadius,
            Math.max(
                safeBaseHeight * hexaHiveRadiusScale,
                hybridRadius,
                cellDrivenRadius
            )
        )
    );
}

/**
 * 적 타입별 단일 원 충돌 반지름을 계산합니다.
 * @param {string|null|undefined} enemyType - 적 타입입니다.
 * @param {number} width - 렌더 기준 너비입니다.
 * @param {number} height - 렌더 기준 높이입니다.
 * @returns {number} 충돌 반지름입니다.
 */
export function getEnemyCircleCollisionRadius(enemyType, width, height) {
    const safeWidth = Number.isFinite(width)
        ? Math.max(ENEMY_COLLISION_RADIUS_MIN_DIMENSION, width)
        : ENEMY_COLLISION_RADIUS_MIN_DIMENSION;
    const safeHeight = Number.isFinite(height)
        ? Math.max(ENEMY_COLLISION_RADIUS_MIN_DIMENSION, height)
        : safeWidth;
    const rule = ENEMY_COLLISION_RADIUS_TYPES[enemyType]
        ?? ENEMY_COLLISION_RADIUS_TYPES[ENEMY_COLLISION_RADIUS_DEFAULT_TYPE];
    const radius = calculateEnemyCollisionRadiusFromRule(rule, safeWidth, safeHeight);
    return Math.max(ENEMY_COLLISION_RADIUS_MIN_DIMENSION, radius);
}

/**
 * 적 충돌 반경 데이터 규칙을 실제 반경 값으로 계산합니다.
 * @param {object|null|undefined} rule - 적 형태별 반경 계산 규칙입니다.
 * @param {number} safeWidth - 보정된 너비입니다.
 * @param {number} safeHeight - 보정된 높이입니다.
 * @returns {number} 규칙 기반 충돌 반경입니다.
 */
function calculateEnemyCollisionRadiusFromRule(rule, safeWidth, safeHeight) {
    if (!rule) {
        return ENEMY_COLLISION_RADIUS_MIN_DIMENSION;
    }

    let radius = 0;
    radius = Math.max(radius, calculateScaledAxisMax(rule.widthScales, safeWidth));
    radius = Math.max(radius, calculateScaledAxisMax(rule.heightScales, safeHeight));
    radius = Math.max(radius, calculateVectorRadiusMax(rule.vectors, safeWidth, safeHeight));

    const scale = Number.isFinite(rule.scale)
        ? rule.scale
        : ENEMY_COLLISION_RADIUS_MIN_DIMENSION;
    return radius * scale;
}

/**
 * 축 비율 목록에서 가장 큰 반경 후보를 계산합니다.
 * @param {number[]|undefined} scales - 축 비율 목록입니다.
 * @param {number} axisSize - 축 길이입니다.
 * @returns {number} 가장 큰 축 기반 반경 후보입니다.
 */
function calculateScaledAxisMax(scales, axisSize) {
    if (!Array.isArray(scales)) {
        return 0;
    }

    let radius = 0;
    for (let i = 0; i < scales.length; i++) {
        const scale = scales[i];
        if (Number.isFinite(scale)) {
            radius = Math.max(radius, axisSize * scale);
        }
    }
    return radius;
}

/**
 * 벡터 비율 목록에서 가장 큰 반경 후보를 계산합니다.
 * @param {{x:number, y:number}[]|undefined} vectors - x/y 축 비율 벡터 목록입니다.
 * @param {number} safeWidth - 보정된 너비입니다.
 * @param {number} safeHeight - 보정된 높이입니다.
 * @returns {number} 가장 큰 벡터 기반 반경 후보입니다.
 */
function calculateVectorRadiusMax(vectors, safeWidth, safeHeight) {
    if (!Array.isArray(vectors)) {
        return 0;
    }

    let radius = 0;
    for (let i = 0; i < vectors.length; i++) {
        const vector = vectors[i];
        const scaleX = Number.isFinite(vector?.x) ? vector.x : 0;
        const scaleY = Number.isFinite(vector?.y) ? vector.y : 0;
        radius = Math.max(radius, Math.hypot(safeWidth * scaleX, safeHeight * scaleY));
    }
    return radius;
}
