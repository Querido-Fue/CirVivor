import { resolveFiniteNumber } from 'util/number_util.js';
import { COLLISION_EPSILON } from './collision_math_constants.js';

/**
 * 이전 위치 축 값을 조회하거나 현재 위치와 속도로 역산합니다.
 * @param {object} player - 원본 플레이어 객체입니다.
 * @param {'x'|'y'} axis - 조회할 축입니다.
 * @param {number} currentValue - 현재 위치 축 값입니다.
 * @param {number} delta - fixed step delta입니다.
 * @returns {number} 이전 위치 축 값입니다.
 */
function getCollisionPlayerPreviousAxisValue(player, axis, currentValue, delta) {
    const previousValue = player.prevPosition?.[axis];
    if (Number.isFinite(previousValue)) {
        return previousValue;
    }

    return currentValue - (resolveFiniteNumber(player.speed?.[axis], 0) * delta);
}

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

    const epsilon = resolveFiniteNumber(options?.epsilon, COLLISION_EPSILON);
    const frameResolveMinMax = resolveFiniteNumber(options?.frameResolveMinMax, 0);
    const frameResolveMaxRatio = resolveFiniteNumber(options?.frameResolveMaxRatio, 0);
    const x = resolveFiniteNumber(player.position?.x, 0);
    const y = resolveFiniteNumber(player.position?.y, 0);
    const prevX = getCollisionPlayerPreviousAxisValue(player, 'x', x, delta);
    const prevY = getCollisionPlayerPreviousAxisValue(player, 'y', y, delta);
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
