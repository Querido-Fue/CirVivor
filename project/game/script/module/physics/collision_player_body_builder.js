import { getData } from 'data/data_handler.js';

const DEFAULT_EPSILON = getData('COLLISION_CONSTANTS').EPSILON;

/**
 * 플레이어 body 생성 옵션에서 유한 숫자 값을 조회합니다.
 * @param {object|null|undefined} options - body 생성 옵션입니다.
 * @param {string} key - 조회할 옵션 키입니다.
 * @param {number} fallback - 값이 유효하지 않을 때 사용할 기본값입니다.
 * @returns {number} 유한 숫자로 보정한 옵션 값입니다.
 */
function getCollisionPlayerBodyOption(options, key, fallback) {
    const value = options?.[key];
    return Number.isFinite(value) ? value : fallback;
}

/**
 * 벡터 객체에서 축 값을 유한 숫자로 조회합니다.
 * @param {object|null|undefined} vector - X/Y 축을 가진 벡터 객체입니다.
 * @param {'x'|'y'} axis - 조회할 축입니다.
 * @param {number} fallback - 값이 유효하지 않을 때 사용할 기본값입니다.
 * @returns {number} 유한 숫자로 보정한 축 값입니다.
 */
function getCollisionVectorAxisValue(vector, axis, fallback) {
    const value = vector?.[axis];
    return Number.isFinite(value) ? value : fallback;
}

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

    return currentValue - (getCollisionVectorAxisValue(player.speed, axis, 0) * delta);
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

    const epsilon = getCollisionPlayerBodyOption(options, 'epsilon', DEFAULT_EPSILON);
    const frameResolveMinMax = getCollisionPlayerBodyOption(options, 'frameResolveMinMax', 0);
    const frameResolveMaxRatio = getCollisionPlayerBodyOption(options, 'frameResolveMaxRatio', 0);
    const x = getCollisionVectorAxisValue(player.position, 'x', 0);
    const y = getCollisionVectorAxisValue(player.position, 'y', 0);
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
