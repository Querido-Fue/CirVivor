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
    const minRadius = Number.isFinite(tuning?.minRadius) ? tuning.minRadius : 1;
    const hexaHiveRadiusScale = Number.isFinite(tuning?.hexaHiveRadiusScale) ? tuning.hexaHiveRadiusScale : 1;
    const hexaHiveRootScale = Number.isFinite(tuning?.hexaHiveRootScale) ? tuning.hexaHiveRootScale : 0;
    const safeBoundRadius = Number.isFinite(boundRadius) ? Math.max(minRadius, boundRadius) : minRadius;
    if (enemy?.type !== 'hexa_hive') {
        return safeBoundRadius;
    }

    const safeBaseHeight = Number.isFinite(baseHeight) ? Math.max(minRadius, baseHeight) : safeBoundRadius;
    const cellCount = getHexaHiveCollisionCellCount(enemy);
    const rootedCellCount = Math.max(1, Math.sqrt(cellCount));
    const cellDrivenRadius = safeBaseHeight * (
        hexaHiveRadiusScale
        + (Math.max(0, rootedCellCount - 1) * hexaHiveRootScale)
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
    const safeWidth = Number.isFinite(width) ? Math.max(1, width) : 1;
    const safeHeight = Number.isFinite(height) ? Math.max(1, height) : safeWidth;
    let radius = 0;

    switch (enemyType) {
        case 'triangle':
            radius = Math.max(
                safeHeight * 0.5333,
                Math.hypot(safeWidth * 0.462, safeHeight * 0.2667)
            );
            break;
        case 'arrow':
            radius = Math.max(
                safeHeight * 0.5767,
                Math.hypot(safeWidth * 0.46, safeHeight * 0.3733)
            );
            break;
        case 'hexa':
            radius = 0.47 * Math.max(
                safeHeight,
                Math.hypot(safeWidth * 0.8660254037844386, safeHeight * 0.5)
            );
            break;
        case 'penta':
            radius = 0.48 * Math.max(
                safeHeight,
                Math.hypot(safeWidth * 0.9510565162951535, safeHeight * 0.3090169943749474),
                Math.hypot(safeWidth * 0.5877852522924731, safeHeight * 0.8090169943749475)
            );
            break;
        case 'rhom':
            radius = Math.max(safeWidth * 0.34, safeHeight * 0.5);
            break;
        case 'octa':
            radius = 0.47 * Math.max(
                Math.hypot(safeWidth * 0.9238795325112867, safeHeight * 0.3826834323650898),
                Math.hypot(safeWidth * 0.3826834323650898, safeHeight * 0.9238795325112867)
            );
            break;
        case 'gen':
            radius = Math.hypot(safeWidth * 0.44, safeHeight * 0.44);
            break;
        case 'square':
        default:
            radius = Math.hypot(safeWidth * 0.42, safeHeight * 0.42);
            break;
    }

    return Math.max(1, radius);
}
