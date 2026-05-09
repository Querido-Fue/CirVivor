/**
 * 투사체 충돌 검사에 재사용할 scratch body를 생성합니다.
 * @returns {object}
 */
export function createCollisionScratchProjectileBody() {
    return {
        kind: 'projectile', shape: 'circle',
        x: 0, y: 0, centerX: 0, centerY: 0, radius: 0,
        weight: 1, movable: false, ref: null, id: -1,
        minX: 0, maxX: 0, minY: 0, maxY: 0,
        sweepMinX: 0, sweepMaxX: 0, sweepMinY: 0, sweepMaxY: 0,
        boundRadius: 0, broadRadius: 0, velocityX: 0, velocityY: 0,
        enemyPairMinX: 0, enemyPairMaxX: 0, enemyPairMinY: 0, enemyPairMaxY: 0,
        projectileMinX: 0, projectileMaxX: 0, projectileMinY: 0, projectileMaxY: 0,
        enemyPairBroadRadius: 0, projectileBroadRadius: 0,
        circleParts: null, circlePartCount: 0, mergeLock: false,
        _broadDataIndex: -1,
        _candidatePairCount: 0, _resolvedPairCount: 0, _passPairProcessCount: 0,
        _frameResolveMoved: 0, _frameResolveMax: Infinity
    };
}

/**
 * 충돌 body pool에서 새로 사용할 기본 body 객체를 생성합니다.
 * @returns {object}
 */
export function createCollisionBody() {
    return {
        id: -1, kind: '', shape: '', circleParts: null, circlePartCount: 0, ref: null,
        weight: 1, movable: true,
        centerX: 0, centerY: 0, x: 0, y: 0, radius: 0,
        minX: 0, maxX: 0, minY: 0, maxY: 0,
        sweepMinX: 0, sweepMaxX: 0, sweepMinY: 0, sweepMaxY: 0,
        boundRadius: 0, broadRadius: 0, resolveRadius: 0, velocityX: 0, velocityY: 0,
        enemyPairMinX: 0, enemyPairMaxX: 0, enemyPairMinY: 0, enemyPairMaxY: 0,
        projectileMinX: 0, projectileMaxX: 0, projectileMinY: 0, projectileMaxY: 0,
        enemyPairBroadRadius: 0, projectileBroadRadius: 0,
        mergeLock: false,
        _broadDataIndex: -1,
        _candidatePairCount: 0, _resolvedPairCount: 0, _passPairProcessCount: 0,
        _frameResolveMoved: 0, _frameResolveMax: Infinity
    };
}

/**
 * 벽 충돌 rect에서 정적 wall body 객체를 생성합니다.
 * @param {object} rect - 벽 충돌 rect입니다.
 * @param {object} wall - 원본 벽 객체입니다.
 * @returns {object}
 */
export function createCollisionWallBody(rect, wall) {
    const w = Number.isFinite(rect.w) ? rect.w : 0;
    const h = Number.isFinite(rect.h) ? rect.h : 0;
    const isCenter = rect.origin === 'center' || rect.isCenter === true;
    const cx = isCenter ? rect.x : (rect.x + (w * 0.5));
    const cy = isCenter ? rect.y : (rect.y + (h * 0.5));
    const hw = w * 0.5;
    const hh = h * 0.5;

    return {
        id: Number.isInteger(rect.id) ? rect.id : -1,
        kind: 'wall',
        shape: 'rect',
        circleParts: null,
        circlePartCount: 0,
        ref: wall,
        weight: Number.MAX_SAFE_INTEGER,
        movable: false,
        mergeLock: false,
        centerX: cx,
        centerY: cy,
        x: cx,
        y: cy,
        minX: cx - hw,
        maxX: cx + hw,
        minY: cy - hh,
        maxY: cy + hh,
        sweepMinX: cx - hw,
        sweepMaxX: cx + hw,
        sweepMinY: cy - hh,
        sweepMaxY: cy + hh,
        boundRadius: Math.max(hw, hh),
        broadRadius: Math.hypot(hw, hh),
        velocityX: 0,
        velocityY: 0,
        _candidatePairCount: 0,
        _resolvedPairCount: 0,
        _passPairProcessCount: 0
    };
}

/**
 * 충돌 grid bucket 기본 객체를 생성합니다.
 * @param {number} initialCapacity - 인덱스 버퍼 초기 용량입니다.
 * @returns {object}
 */
export function createCollisionGridBucket(initialCapacity) {
    return {
        indices: new Int32Array(initialCapacity),
        count: 0
    };
}

/**
 * narrowphase 결과를 재사용해 기록할 scratch manifold를 생성합니다.
 * @returns {object}
 */
export function createCollisionManifold() {
    return {
        collided: false,
        normalX: 1, normalY: 0, penetration: 0, pointX: 0, pointY: 0,
        moveAX: 0, moveAY: 0, moveBX: 0, moveBY: 0
    };
}
