import { getCollisionDenseFrameScale } from './_collision_resolve_tuning.js';

const EPSILON = 1e-6;
const COLLISION_AXIS_RESISTANCE_MIN = 0.25;
const COLLISION_AXIS_RESISTANCE_GAIN = 0.85;
const COLLISION_AXIS_RESISTANCE_RADIUS_RATIO = 0.35;

/**
 * resolve 이동량을 body와 원본 객체, broad-phase 버퍼에 반영합니다.
 * @param {object|null|undefined} body - 이동할 충돌 body입니다.
 * @param {number} dx - X 이동량입니다.
 * @param {number} dy - Y 이동량입니다.
 * @param {object} options - 이동 적용 옵션입니다.
 * @param {number} [options.resolveBoost=1] - 과밀 보정 resolve 배율입니다.
 * @param {object|null} [options.broadphaseBuffer=null] - broad-phase SoA 버퍼입니다.
 * @returns {boolean} 이동이 적용되었는지 여부입니다.
 */
export function applyCollisionBodyTranslation(body, dx, dy, { resolveBoost = 1, broadphaseBuffer = null } = {}) {
    if (!body || body.movable === false) {
        return false;
    }
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        return false;
    }
    if (dx === 0 && dy === 0) {
        return false;
    }

    const moveMag = Math.hypot(dx, dy);
    if (moveMag <= EPSILON) {
        return false;
    }

    const clampedMove = clampCollisionBodyTranslation(body, dx, dy, resolveBoost, moveMag);
    if (!clampedMove) {
        return false;
    }

    writeCollisionBodyTranslation(body, clampedMove.dx, clampedMove.dy);
    broadphaseBuffer?.translateBody?.(body, clampedMove.dx, clampedMove.dy);
    writeCollisionBodyReferenceTranslation(body, clampedMove.dx, clampedMove.dy);
    return true;
}

/**
 * 프레임 resolve 한도에 맞춰 이동량을 제한합니다.
 * @param {object} body - 이동할 충돌 body입니다.
 * @param {number} dx - 원본 X 이동량입니다.
 * @param {number} dy - 원본 Y 이동량입니다.
 * @param {number} resolveBoost - resolve 배율입니다.
 * @param {number} moveMag - 원본 이동량 크기입니다.
 * @returns {{dx:number, dy:number}|null} 제한된 이동량입니다.
 */
function clampCollisionBodyTranslation(body, dx, dy, resolveBoost, moveMag) {
    const baseFrameMax = Number.isFinite(body._frameResolveMax)
        ? body._frameResolveMax
        : Number.POSITIVE_INFINITY;
    const frameMax = baseFrameMax * getCollisionDenseFrameScale(body) * resolveBoost;
    const frameMoved = Number.isFinite(body._frameResolveMoved) ? body._frameResolveMoved : 0;
    if (frameMoved >= frameMax) {
        return null;
    }

    const remain = frameMax - frameMoved;
    if (remain < moveMag) {
        const scale = remain / moveMag;
        dx *= scale;
        dy *= scale;
    }

    const appliedMag = Math.hypot(dx, dy);
    if (appliedMag <= EPSILON) {
        return null;
    }

    body._frameResolveMoved = frameMoved + appliedMag;
    return { dx, dy };
}

/**
 * 충돌 body 좌표와 part 좌표를 이동합니다.
 * @param {object} body - 이동할 충돌 body입니다.
 * @param {number} dx - X 이동량입니다.
 * @param {number} dy - Y 이동량입니다.
 */
function writeCollisionBodyTranslation(body, dx, dy) {
    body.centerX += dx;
    body.centerY += dy;
    body.minX += dx;
    body.maxX += dx;
    body.minY += dy;
    body.maxY += dy;
    if (Number.isFinite(body.enemyPairMinX)) body.enemyPairMinX += dx;
    if (Number.isFinite(body.enemyPairMaxX)) body.enemyPairMaxX += dx;
    if (Number.isFinite(body.enemyPairMinY)) body.enemyPairMinY += dy;
    if (Number.isFinite(body.enemyPairMaxY)) body.enemyPairMaxY += dy;
    if (Number.isFinite(body.projectileMinX)) body.projectileMinX += dx;
    if (Number.isFinite(body.projectileMaxX)) body.projectileMaxX += dx;
    if (Number.isFinite(body.projectileMinY)) body.projectileMinY += dy;
    if (Number.isFinite(body.projectileMaxY)) body.projectileMaxY += dy;
    body.x = body.centerX;
    body.y = body.centerY;

    if (body.circleParts instanceof Float32Array) {
        const limit = Math.max(0, Math.floor(body.circlePartCount || 0)) * 3;
        for (let i = 0; i < limit; i += 3) {
            body.circleParts[i] += dx;
            body.circleParts[i + 1] += dy;
        }
    }
}

/**
 * 원본 객체 좌표와 axis resistance를 이동 보정에 맞춰 갱신합니다.
 * @param {object} body - 이동할 충돌 body입니다.
 * @param {number} dx - X 이동량입니다.
 * @param {number} dy - Y 이동량입니다.
 */
function writeCollisionBodyReferenceTranslation(body, dx, dy) {
    if (!body.ref?.position) {
        return;
    }

    body.ref.position.x += dx;
    body.ref.position.y += dy;
    // 고정틱 말미 충돌 보정으로 위치가 이동하면, 보간 시작점도 함께 이동시켜
    // 렌더 프레임에서 과거 위치로 순간 되돌아가는 시각적 점프를 줄입니다.
    if (body.ref.prevPosition) {
        body.ref.prevPosition.x += dx;
        body.ref.prevPosition.y += dy;
    }
    applyCollisionAxisResistance(body, dx, dy);
}

/**
 * 이동 보정이 현재 속도 반대 방향이면 축별 저항을 적용합니다.
 * @param {object} body - 이동한 충돌 body입니다.
 * @param {number} dx - X 이동량입니다.
 * @param {number} dy - Y 이동량입니다.
 */
function applyCollisionAxisResistance(body, dx, dy) {
    if (body.kind !== 'enemy' || typeof body.ref.applyAxisResistance !== 'function') {
        return;
    }

    let resistX = 1;
    let resistY = 1;
    const radius = Math.max(1, Number.isFinite(body.boundRadius) ? body.boundRadius : 1);
    const axisRange = Math.max(1, radius * COLLISION_AXIS_RESISTANCE_RADIUS_RATIO);
    const velX = Number.isFinite(body.velocityX) ? body.velocityX : 0;
    const velY = Number.isFinite(body.velocityY) ? body.velocityY : 0;
    if ((dx * velX) < -EPSILON) {
        const ratioX = Math.min(1, Math.abs(dx) / axisRange);
        resistX = Math.max(COLLISION_AXIS_RESISTANCE_MIN, 1 - (ratioX * COLLISION_AXIS_RESISTANCE_GAIN));
    }
    if ((dy * velY) < -EPSILON) {
        const ratioY = Math.min(1, Math.abs(dy) / axisRange);
        resistY = Math.max(COLLISION_AXIS_RESISTANCE_MIN, 1 - (ratioY * COLLISION_AXIS_RESISTANCE_GAIN));
    }

    if (resistX < 1 || resistY < 1) {
        body.ref.applyAxisResistance(resistX, resistY);
    }
}
