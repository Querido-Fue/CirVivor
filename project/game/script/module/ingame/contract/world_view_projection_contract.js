/**
 * 값이 IWorldViewProjection2D 런타임 계약을 만족하는지 확인합니다.
 *
 * 시뮬레이션 월드 단위와 렌더 타깃 좌표를 분리하며, 구현체는 화면 크기에서
 * projection을 계산해야 합니다. 렌더러는 고정 픽셀 배율을 보유하지 않습니다.
 * @param {*} projection - 검사할 projection입니다.
 * @returns {boolean} 인터페이스 충족 여부입니다.
 */
export function isWorldViewProjection2D(projection) {
    return Boolean(
        projection
        && typeof projection === 'object'
        && typeof projection.getViewBounds === 'function'
        && typeof projection.getProjectionRevision === 'function'
        && typeof projection.getScale === 'function'
        && typeof projection.worldToViewport === 'function'
        && typeof projection.viewportToWorld === 'function'
        && typeof projection.worldLengthToViewport === 'function'
        && typeof projection.isCircleVisible === 'function'
    );
}

/**
 * IWorldViewProjection2D 계약을 확인하고 같은 값을 반환합니다.
 * @param {*} projection - 확인할 projection입니다.
 * @returns {*} 확인을 통과한 원본 projection입니다.
 * @throws {TypeError} 계약을 만족하지 않을 때 발생합니다.
 */
export function assertWorldViewProjection2D(projection) {
    if (!isWorldViewProjection2D(projection)) {
        throw new TypeError(
            'IWorldViewProjection2D 계약을 만족하지 않는 projection입니다.'
        );
    }
    return projection;
}
