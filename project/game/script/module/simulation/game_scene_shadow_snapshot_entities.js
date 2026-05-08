/**
 * 좌표 객체를 단순 스냅샷으로 복제합니다.
 * @param {{x?: number, y?: number}|null|undefined} point - 원본 좌표입니다.
 * @returns {{x: number, y: number}}
 */
export function clonePointSnapshot(point) {
    return {
        x: Number.isFinite(point?.x) ? point.x : 0,
        y: Number.isFinite(point?.y) ? point.y : 0
    };
}

/**
 * 좌표 스냅샷을 기존 객체에 in-place로 반영합니다.
 * @param {{x: number, y: number}} targetPoint - 갱신할 좌표 객체입니다.
 * @param {{x?: number, y?: number}|null|undefined} sourcePoint - 원본 좌표입니다.
 * @returns {{x: number, y: number}}
 */
export function assignPointSnapshot(targetPoint, sourcePoint) {
    if (!targetPoint || typeof targetPoint !== 'object') {
        return clonePointSnapshot(sourcePoint);
    }

    targetPoint.x = Number.isFinite(sourcePoint?.x) ? sourcePoint.x : 0;
    targetPoint.y = Number.isFinite(sourcePoint?.y) ? sourcePoint.y : 0;
    return targetPoint;
}

/**
 * 플레이어 스냅샷을 정규화합니다.
 * @param {object|null|undefined} player - 원본 플레이어 데이터입니다.
 * @returns {object|null}
 */
export function createShadowPlayerFromData(player) {
    if (!player || typeof player !== 'object') {
        return null;
    }

    const position = clonePointSnapshot(player.position);
    const prevPosition = player.prevPosition ? clonePointSnapshot(player.prevPosition) : { ...position };
    return {
        id: Number.isInteger(player.id) ? player.id : null,
        active: player.active !== false,
        radius: Number.isFinite(player.radius) ? player.radius : 0,
        weight: Number.isFinite(player.weight) ? player.weight : 0,
        position,
        prevPosition,
        speed: clonePointSnapshot(player.speed)
    };
}

/**
 * 플레이어 스냅샷을 기존 미러 객체에 in-place로 반영합니다.
 * @param {object|null|undefined} currentPlayer - 현재 미러 플레이어입니다.
 * @param {object|null|undefined} player - 원본 플레이어 데이터입니다.
 * @returns {object|null}
 */
export function assignShadowPlayerFromData(currentPlayer, player) {
    if (!player || typeof player !== 'object') {
        return null;
    }

    const nextPlayer = currentPlayer && typeof currentPlayer === 'object'
        ? currentPlayer
        : createShadowPlayerFromData(player);
    if (!nextPlayer) {
        return null;
    }

    nextPlayer.id = Number.isInteger(player.id) ? player.id : null;
    nextPlayer.active = player.active !== false;
    nextPlayer.radius = Number.isFinite(player.radius) ? player.radius : 0;
    nextPlayer.weight = Number.isFinite(player.weight) ? player.weight : 0;
    nextPlayer.position = assignPointSnapshot(nextPlayer.position, player.position);
    nextPlayer.prevPosition = assignPointSnapshot(nextPlayer.prevPosition, player.prevPosition ?? player.position);
    nextPlayer.speed = assignPointSnapshot(nextPlayer.speed, player.speed);
    return nextPlayer;
}

/**
 * 벽 스냅샷을 정규화합니다.
 * @param {object|null|undefined} wall - 원본 벽 데이터입니다.
 * @returns {object|null}
 */
export function createShadowWallFromData(wall) {
    if (!wall || typeof wall !== 'object') {
        return null;
    }

    return {
        id: Number.isInteger(wall.id) ? wall.id : null,
        active: wall.active !== false,
        x: Number.isFinite(wall.x) ? wall.x : 0,
        y: Number.isFinite(wall.y) ? wall.y : 0,
        w: Number.isFinite(wall.w) ? wall.w : 0,
        h: Number.isFinite(wall.h) ? wall.h : 0,
        origin: typeof wall.origin === 'string' ? wall.origin : 'center'
    };
}

/**
 * 투사체 스냅샷을 정규화합니다.
 * @param {object|null|undefined} projectile - 원본 투사체 데이터입니다.
 * @returns {object|null}
 */
export function createShadowProjectileFromData(projectile) {
    if (!projectile || typeof projectile !== 'object') {
        return null;
    }

    const position = clonePointSnapshot(projectile.position);
    const prevPosition = projectile.prevPosition ? clonePointSnapshot(projectile.prevPosition) : { ...position };
    return {
        id: Number.isInteger(projectile.id) ? projectile.id : null,
        active: projectile.active !== false,
        radius: Number.isFinite(projectile.radius) ? projectile.radius : 0,
        weight: Number.isFinite(projectile.weight) ? projectile.weight : 0,
        impactForce: Number.isFinite(projectile.impactForce) ? projectile.impactForce : 0,
        piercing: projectile.piercing === true,
        position,
        prevPosition,
        speed: clonePointSnapshot(projectile.speed)
    };
}
