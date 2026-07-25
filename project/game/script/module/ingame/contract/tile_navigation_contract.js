/**
 * 값이 타일 네비게이션 source 계약을 만족하는지 확인합니다.
 * @param {*} source - 검사할 타일 맵입니다.
 * @returns {boolean} 인터페이스 충족 여부입니다.
 */
export function isTileNavigationSource(source) {
    if (!source
        || typeof source !== 'object'
        || typeof source.getNavigationGrid !== 'function'
        || typeof source.getSpawnRoutes !== 'function'
        || typeof source.getCorePosition !== 'function'
        || typeof source.getTowerSpawnPosition !== 'function'
        || typeof source.getWorldBounds !== 'function'
        || typeof source.isWalkableTile !== 'function'
        || typeof source.worldToTile !== 'function'
        || typeof source.tileToWorld !== 'function') {
        return false;
    }

    const grid = source.getNavigationGrid();
    return Boolean(
        grid
        && Number.isInteger(grid.cols)
        && grid.cols > 0
        && Number.isInteger(grid.rows)
        && grid.rows > 0
        && Number.isInteger(grid.size)
        && grid.size === grid.cols * grid.rows
        && Number.isFinite(grid.cellSize)
        && grid.cellSize > 0
        && grid.blocked instanceof Uint8Array
        && grid.blocked.length === grid.size
        && Array.isArray(source.getSpawnRoutes())
    );
}

/**
 * 타일 네비게이션 source 계약을 확인하고 같은 값을 반환합니다.
 * @param {*} source - 확인할 타일 맵입니다.
 * @returns {*} 확인을 통과한 원본 source입니다.
 * @throws {TypeError} 계약을 만족하지 않을 때 발생합니다.
 */
export function assertTileNavigationSource(source) {
    if (!isTileNavigationSource(source)) {
        throw new TypeError('ITileNavigationSource 계약을 만족하지 않는 타일 맵입니다.');
    }
    return source;
}
