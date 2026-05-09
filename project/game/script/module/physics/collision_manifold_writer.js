import { getData } from 'data/data_handler.js';
import { clampNumber } from 'util/number_util.js';

const COLLISION_CONSTANTS = getData('COLLISION_CONSTANTS');
const COLLISION_MANIFOLD = COLLISION_CONSTANTS.MANIFOLD;
const EPSILON = COLLISION_CONSTANTS.EPSILON;
const MULTI_CONTACT_NORMAL_DIVERSITY_SCALE = COLLISION_MANIFOLD.MULTI_CONTACT_NORMAL_DIVERSITY_SCALE;
const MULTI_CONTACT_PENETRATION_MULTIPLIER_MAX = COLLISION_MANIFOLD.MULTI_CONTACT_PENETRATION_MULTIPLIER_MAX;
const MULTI_CONTACT_DIVERSITY_SAMPLE_CAP = COLLISION_MANIFOLD.MULTI_CONTACT_DIVERSITY_SAMPLE_CAP;

/**
 * manifold 출력 객체를 채웁니다.
 * @param {object} out - 출력 manifold 객체입니다.
 * @param {number} normalX - 충돌 법선 X입니다.
 * @param {number} normalY - 충돌 법선 Y입니다.
 * @param {number} penetration - 침투 깊이입니다.
 * @param {number} pointX - 접점 X입니다.
 * @param {number} pointY - 접점 Y입니다.
 * @returns {object} 채워진 manifold 객체입니다.
 */
export function writeCollisionManifold(out, normalX, normalY, penetration, pointX, pointY) {
    out.collided = true;
    out.normalX = normalX;
    out.normalY = normalY;
    out.penetration = penetration;
    out.pointX = pointX;
    out.pointY = pointY;
    out.moveAX = 0;
    out.moveAY = 0;
    out.moveBX = 0;
    out.moveBY = 0;
    return out;
}

/**
 * 원-원 충돌 manifold를 씁니다.
 * @param {number} ax - 첫 번째 원 중심 X입니다.
 * @param {number} ay - 첫 번째 원 중심 Y입니다.
 * @param {number} ar - 첫 번째 원 반지름입니다.
 * @param {number} bx - 두 번째 원 중심 X입니다.
 * @param {number} by - 두 번째 원 중심 Y입니다.
 * @param {number} br - 두 번째 원 반지름입니다.
 * @param {object} out - 출력 manifold 객체입니다.
 * @param {number} [fallbackNormalX=1] - 중심이 같은 경우 사용할 fallback 법선 X입니다.
 * @param {number} [fallbackNormalY=0] - 중심이 같은 경우 사용할 fallback 법선 Y입니다.
 * @returns {object|null} 충돌 manifold입니다.
 */
export function writeCollisionCircleOverlapManifold(
    ax,
    ay,
    ar,
    bx,
    by,
    br,
    out,
    fallbackNormalX = 1,
    fallbackNormalY = 0
) {
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(ar) || ar <= 0
        || !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(br) || br <= 0) {
        return null;
    }

    const dx = bx - ax;
    const dy = by - ay;
    const distSq = (dx * dx) + (dy * dy);
    return writeCollisionCircleOverlapManifoldFromDelta(
        ax,
        ay,
        ar,
        br,
        dx,
        dy,
        distSq,
        out,
        fallbackNormalX,
        fallbackNormalY
    );
}

/**
 * 이미 계산된 중심 차이로 원-원 충돌 manifold를 씁니다.
 * @param {number} ax - 첫 번째 원 중심 X입니다.
 * @param {number} ay - 첫 번째 원 중심 Y입니다.
 * @param {number} ar - 첫 번째 원 반지름입니다.
 * @param {number} br - 두 번째 원 반지름입니다.
 * @param {number} dx - 두 원 중심 X 차이입니다.
 * @param {number} dy - 두 원 중심 Y 차이입니다.
 * @param {number} distSq - 중심 거리 제곱입니다.
 * @param {object} out - 출력 manifold 객체입니다.
 * @param {number} [fallbackNormalX=1] - 중심이 같은 경우 사용할 fallback 법선 X입니다.
 * @param {number} [fallbackNormalY=0] - 중심이 같은 경우 사용할 fallback 법선 Y입니다.
 * @returns {object|null} 충돌 manifold입니다.
 */
export function writeCollisionCircleOverlapManifoldFromDelta(
    ax,
    ay,
    ar,
    br,
    dx,
    dy,
    distSq,
    out,
    fallbackNormalX = 1,
    fallbackNormalY = 0
) {
    const radiusSum = ar + br;
    if (distSq >= (radiusSum * radiusSum)) {
        return null;
    }

    let distance = Math.sqrt(distSq);
    let normalX = 1;
    let normalY = 0;
    if (distance > EPSILON) {
        normalX = dx / distance;
        normalY = dy / distance;
    } else {
        const fallbackLength = Math.hypot(fallbackNormalX, fallbackNormalY);
        if (fallbackLength > EPSILON) {
            normalX = fallbackNormalX / fallbackLength;
            normalY = fallbackNormalY / fallbackLength;
        }
        distance = 0;
    }

    return writeCollisionManifold(
        out,
        normalX,
        normalY,
        radiusSum - distance,
        ax + (normalX * ar),
        ay + (normalY * ar)
    );
}

/**
 * 원-사각형 충돌 manifold를 씁니다.
 * @param {number} circleX - 원 중심 X입니다.
 * @param {number} circleY - 원 중심 Y입니다.
 * @param {number} radius - 원 반지름입니다.
 * @param {object} rectBody - 축 정렬 사각형 body입니다.
 * @param {object} out - 출력 manifold 객체입니다.
 * @returns {object|null} 충돌 manifold입니다.
 */
export function writeCollisionCircleRectOverlapManifold(circleX, circleY, radius, rectBody, out) {
    if (!Number.isFinite(circleX) || !Number.isFinite(circleY) || !Number.isFinite(radius) || radius <= 0) {
        return null;
    }

    const minX = Number.isFinite(rectBody?.minX) ? rectBody.minX : 0;
    const maxX = Number.isFinite(rectBody?.maxX) ? rectBody.maxX : 0;
    const minY = Number.isFinite(rectBody?.minY) ? rectBody.minY : 0;
    const maxY = Number.isFinite(rectBody?.maxY) ? rectBody.maxY : 0;
    const closestX = clampNumber(circleX, minX, maxX);
    const closestY = clampNumber(circleY, minY, maxY);
    const dx = closestX - circleX;
    const dy = closestY - circleY;
    const distSq = (dx * dx) + (dy * dy);
    if (distSq >= (radius * radius)) {
        return null;
    }

    if (distSq > EPSILON) {
        const distance = Math.sqrt(distSq);
        return writeCollisionManifold(
            out,
            dx / distance,
            dy / distance,
            radius - distance,
            closestX,
            closestY
        );
    }

    const leftDistance = Math.max(0, circleX - minX);
    const rightDistance = Math.max(0, maxX - circleX);
    const topDistance = Math.max(0, circleY - minY);
    const bottomDistance = Math.max(0, maxY - circleY);
    const minDistance = Math.min(leftDistance, rightDistance, topDistance, bottomDistance);
    let normalX = 1;
    let normalY = 0;
    let pointX = minX;
    let pointY = circleY;

    if (minDistance === rightDistance) {
        normalX = -1;
        pointX = maxX;
    } else if (minDistance === topDistance) {
        normalX = 0;
        normalY = 1;
        pointX = circleX;
        pointY = minY;
    } else if (minDistance === bottomDistance) {
        normalX = 0;
        normalY = -1;
        pointX = circleX;
        pointY = maxY;
    }

    return writeCollisionManifold(out, normalX, normalY, radius + minDistance, pointX, pointY);
}

/**
 * manifold 법선을 A->B 관점으로 뒤집습니다.
 * @param {object} manifold - 뒤집을 manifold입니다.
 * @returns {object} 법선을 뒤집은 manifold입니다.
 */
export function invertCollisionManifoldNormal(manifold) {
    manifold.normalX = -manifold.normalX;
    manifold.normalY = -manifold.normalY;
    return manifold;
}

/**
 * manifold 값을 대상 스크래치 객체에 복사합니다.
 * @param {object} source - 원본 manifold입니다.
 * @param {object} target - 대상 manifold입니다.
 * @returns {object} 대상 manifold입니다.
 */
export function copyCollisionManifold(source, target) {
    target.collided = source.collided;
    target.normalX = source.normalX;
    target.normalY = source.normalY;
    target.penetration = source.penetration;
    target.pointX = source.pointX;
    target.pointY = source.pointY;
    target.moveAX = source.moveAX || 0;
    target.moveAY = source.moveAY || 0;
    target.moveBX = source.moveBX || 0;
    target.moveBY = source.moveBY || 0;
    return target;
}

/**
 * 다중 part 접촉을 단일 대표 manifold로 누적합니다.
 * @param {object} best - 가장 깊은 단일 접촉 manifold입니다.
 * @param {{contactCount:number, normalSumX:number, normalSumY:number, pointSumX:number, pointSumY:number, penetrationSum:number, maxPenetration:number}} aggregate - 누적 접촉 정보입니다.
 * @returns {object} 대표 manifold입니다.
 */
export function finalizeCollisionAggregatePartManifold(best, aggregate) {
    if (!best || !aggregate || aggregate.contactCount <= 1) {
        return best;
    }

    const normalLen = Math.hypot(aggregate.normalSumX, aggregate.normalSumY);
    if (normalLen <= EPSILON || aggregate.penetrationSum <= EPSILON) {
        return best;
    }

    const alignment = Math.min(1, normalLen / aggregate.penetrationSum);
    const diversity = Math.max(0, 1 - alignment);
    const multiplier = Math.min(
        MULTI_CONTACT_PENETRATION_MULTIPLIER_MAX,
        1 + (
            diversity
            * Math.min(aggregate.contactCount - 1, MULTI_CONTACT_DIVERSITY_SAMPLE_CAP)
            * MULTI_CONTACT_NORMAL_DIVERSITY_SCALE
        )
    );
    const pointWeight = Math.max(EPSILON, aggregate.penetrationSum);

    best.normalX = aggregate.normalSumX / normalLen;
    best.normalY = aggregate.normalSumY / normalLen;
    best.penetration = Math.max(best.penetration, aggregate.maxPenetration * multiplier);
    best.pointX = aggregate.pointSumX / pointWeight;
    best.pointY = aggregate.pointSumY / pointWeight;
    return best;
}
