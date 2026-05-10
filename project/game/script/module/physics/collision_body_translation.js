import { getData } from 'data/data_handler.js';
import { getCollisionDenseFrameScale } from './_collision_resolve_tuning.js';

const COLLISION_CONSTANTS = getData('COLLISION_CONSTANTS');
const COLLISION_BODY_TRANSLATION = COLLISION_CONSTANTS.BODY_TRANSLATION;
const COLLISION_BODY_BUILDER = COLLISION_CONSTANTS.BODY_BUILDER;
const EPSILON = COLLISION_CONSTANTS.EPSILON;
const COLLISION_AXIS_RESISTANCE_MIN = COLLISION_BODY_TRANSLATION.AXIS_RESISTANCE_MIN;
const COLLISION_AXIS_RESISTANCE_GAIN = COLLISION_BODY_TRANSLATION.AXIS_RESISTANCE_GAIN;
const COLLISION_AXIS_RESISTANCE_RADIUS_RATIO = COLLISION_BODY_TRANSLATION.AXIS_RESISTANCE_RADIUS_RATIO;
const COLLISION_AXIS_RESISTANCE_RADIUS_MIN = COLLISION_BODY_TRANSLATION.AXIS_RESISTANCE_RADIUS_MIN;
const CIRCLE_PART_STRIDE = COLLISION_BODY_BUILDER.CIRCLE_PART_STRIDE;

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
        const limit = Math.max(0, Math.floor(body.circlePartCount || 0)) * CIRCLE_PART_STRIDE;
        for (let i = 0; i < limit; i += CIRCLE_PART_STRIDE) {
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
 * 축 저항 계산에 사용할 body 반경 기준 범위를 반환합니다.
 * @param {object} body - 이동한 충돌 body입니다.
 * @returns {number} 축 저항 기준 거리입니다.
 */
function getCollisionAxisResistanceRange(body) {
    const radius = Math.max(
        COLLISION_AXIS_RESISTANCE_RADIUS_MIN,
        Number.isFinite(body.boundRadius) ? body.boundRadius : COLLISION_AXIS_RESISTANCE_RADIUS_MIN
    );
    return Math.max(
        COLLISION_AXIS_RESISTANCE_RADIUS_MIN,
        radius * COLLISION_AXIS_RESISTANCE_RADIUS_RATIO
    );
}

/**
 * body 속도 축 값을 유한 숫자로 조회합니다.
 * @param {object} body - 이동한 충돌 body입니다.
 * @param {'x'|'y'} axis - 조회할 축입니다.
 * @returns {number} 유효하지 않으면 0으로 보정한 속도입니다.
 */
function getCollisionBodyVelocityAxis(body, axis) {
    const fieldName = axis === 'x' ? 'velocityX' : 'velocityY';
    const value = body[fieldName];
    return Number.isFinite(value) ? value : 0;
}

/**
 * 이동량과 속도가 반대 방향일 때 적용할 축 저항 배율을 반환합니다.
 * @param {number} move - 축 이동량입니다.
 * @param {number} velocity - 축 속도입니다.
 * @param {number} axisRange - 축 저항 기준 거리입니다.
 * @returns {number} 적용할 축 저항 배율입니다.
 */
function getCollisionAxisResistanceScale(move, velocity, axisRange) {
    if ((move * velocity) >= -EPSILON) {
        return 1;
    }

    const ratio = Math.min(1, Math.abs(move) / axisRange);
    return Math.max(COLLISION_AXIS_RESISTANCE_MIN, 1 - (ratio * COLLISION_AXIS_RESISTANCE_GAIN));
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

    const axisRange = getCollisionAxisResistanceRange(body);
    const resistX = getCollisionAxisResistanceScale(dx, getCollisionBodyVelocityAxis(body, 'x'), axisRange);
    const resistY = getCollisionAxisResistanceScale(dy, getCollisionBodyVelocityAxis(body, 'y'), axisRange);

    if (resistX < 1 || resistY < 1) {
        body.ref.applyAxisResistance(resistX, resistY);
    }
}
