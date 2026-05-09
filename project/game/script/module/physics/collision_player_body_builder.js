/**
 * 플레이어 충돌 body 필드를 현재 프레임 상태로 채웁니다.
 * @param {object} body - 값을 채울 충돌 body입니다.
 * @param {object} player - 원본 플레이어 객체입니다.
 * @param {number} delta - fixed step delta입니다.
 * @param {{epsilon:number, frameResolveMinMax:number, frameResolveMaxRatio:number}} options - 계산 상수입니다.
 * @returns {boolean} 유효한 플레이어 body를 구성했는지 여부입니다.
 */
export function writeCollisionPlayerBody(body, player, delta, options) {
    const radius = Number.isFinite(player.radius) ? player.radius : 0;
    if (radius <= 0) {
        return false;
    }

    const epsilon = Number.isFinite(options?.epsilon) ? options.epsilon : 1e-6;
    const frameResolveMinMax = Number.isFinite(options?.frameResolveMinMax) ? options.frameResolveMinMax : 0;
    const frameResolveMaxRatio = Number.isFinite(options?.frameResolveMaxRatio) ? options.frameResolveMaxRatio : 0;
    const x = Number.isFinite(player.position?.x) ? player.position.x : 0;
    const y = Number.isFinite(player.position?.y) ? player.position.y : 0;
    const prevX = Number.isFinite(player.prevPosition?.x)
        ? player.prevPosition.x
        : (x - ((Number.isFinite(player.speed?.x) ? player.speed.x : 0) * delta));
    const prevY = Number.isFinite(player.prevPosition?.y)
        ? player.prevPosition.y
        : (y - ((Number.isFinite(player.speed?.y) ? player.speed.y : 0) * delta));
    const invDelta = 1 / Math.max(epsilon, delta);
    const velX = (x - prevX) * invDelta;
    const velY = (y - prevY) * invDelta;
    const frameResolvePad = Math.max(frameResolveMinMax, radius * frameResolveMaxRatio);
    const sweepPadX = (Math.abs(velX) * delta) + frameResolvePad;
    const sweepPadY = (Math.abs(velY) * delta) + frameResolvePad;

    body.id = Number.isInteger(player.id) ? player.id : -1;
    body.kind = 'player';
    body.shape = 'circle';
    body.x = x;
    body.y = y;
    body.centerX = x;
    body.centerY = y;
    body.radius = radius;
    body.ref = player;
    body.weight = Math.max(epsilon, Number.isFinite(player.weight) ? player.weight : 1);
    body.movable = true;
    body.circleParts = null;
    body.circlePartCount = 0;
    body.mergeLock = false;
    body.minX = x - radius;
    body.maxX = x + radius;
    body.minY = y - radius;
    body.maxY = y + radius;
    body.enemyPairMinX = body.minX;
    body.enemyPairMaxX = body.maxX;
    body.enemyPairMinY = body.minY;
    body.enemyPairMaxY = body.maxY;
    body.projectileMinX = body.minX;
    body.projectileMaxX = body.maxX;
    body.projectileMinY = body.minY;
    body.projectileMaxY = body.maxY;
    body.sweepMinX = x - radius - sweepPadX;
    body.sweepMaxX = x + radius + sweepPadX;
    body.sweepMinY = y - radius - sweepPadY;
    body.sweepMaxY = y + radius + sweepPadY;
    body.boundRadius = radius;
    body.broadRadius = radius;
    body.enemyPairBroadRadius = radius;
    body.projectileBroadRadius = radius;
    body.velocityX = velX;
    body.velocityY = velY;
    body._candidatePairCount = 0;
    body._resolvedPairCount = 0;
    body._passPairProcessCount = 0;
    body._frameResolveMoved = 0;
    body._frameResolveMax = frameResolvePad;
    return true;
}
