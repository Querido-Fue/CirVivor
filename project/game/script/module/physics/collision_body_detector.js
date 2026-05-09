import { getData } from 'data/data_handler.js';
import { getCollisionBodyCollisionRadiusScale } from './_collision_resolve_tuning.js';
import {
    copyCollisionManifold,
    finalizeCollisionAggregatePartManifold,
    invertCollisionManifoldNormal,
    writeCollisionCircleOverlapManifold,
    writeCollisionCircleOverlapManifoldFromDelta,
    writeCollisionCircleRectOverlapManifold
} from './collision_manifold_writer.js';

const COLLISION_CONSTANTS = getData('COLLISION_CONSTANTS');
const EPSILON = COLLISION_CONSTANTS.EPSILON;
const CIRCLE_PART_STRIDE = COLLISION_CONSTANTS.BODY_BUILDER.CIRCLE_PART_STRIDE;

/**
 * @typedef {object} CollisionBodyDetectorContext
 * @property {object} manifold 기본 충돌 결과를 재사용하는 scratch manifold
 * @property {object} candidateManifold 후보 part 접촉을 재사용하는 scratch manifold
 * @property {object} bestManifold part 집계 중 최대 침투 접촉을 보관하는 scratch manifold
 * @property {{recordPartCheck?: function(): void}|null} [profileRecorder] part 판정 계측기
 */

/**
 * body shape 조합에 맞는 narrow-phase 충돌 판정을 수행합니다.
 * @param {object} bodyA
 * @param {object} bodyB
 * @param {CollisionBodyDetectorContext} context
 * @returns {object|null}
 */
export function detectCollisionBodies(bodyA, bodyB, context) {
    if (!bodyA || !bodyB || !context) return null;

    if (bodyA.shape === 'circle' && bodyB.shape === 'circle') {
        return detectCircleVsCircleBody(bodyA, bodyB, context);
    }

    if (bodyA.shape === 'circleParts' && bodyB.shape === 'circleParts') {
        return detectCirclePartsVsCircleParts(bodyA, bodyB, context);
    }

    if (bodyA.shape === 'circleParts' && bodyB.shape === 'circle') {
        return detectCirclePartsVsCircle(bodyA, bodyB, context);
    }

    if (bodyA.shape === 'circle' && bodyB.shape === 'circleParts') {
        const manifold = detectCirclePartsVsCircle(bodyB, bodyA, context);
        if (!manifold) return null;
        return invertCollisionManifoldNormal(manifold);
    }

    if (bodyA.shape === 'circle' && bodyB.shape === 'rect') {
        return detectCircleVsRect(bodyA, bodyB, context);
    }

    if (bodyA.shape === 'rect' && bodyB.shape === 'circle') {
        const manifold = detectCircleVsRect(bodyB, bodyA, context);
        if (!manifold) return null;
        return invertCollisionManifoldNormal(manifold);
    }

    if (bodyA.shape === 'circleParts' && bodyB.shape === 'rect') {
        return detectCirclePartsVsRect(bodyA, bodyB, context);
    }

    if (bodyA.shape === 'rect' && bodyB.shape === 'circleParts') {
        const manifold = detectCirclePartsVsRect(bodyB, bodyA, context);
        if (!manifold) return null;
        return invertCollisionManifoldNormal(manifold);
    }

    return null;
}

/**
 * 원형 body 두 개의 충돌을 판정합니다.
 * @param {object} bodyA
 * @param {object} bodyB
 * @param {CollisionBodyDetectorContext} context
 * @returns {object|null}
 */
function detectCircleVsCircleBody(bodyA, bodyB, context) {
    return writeCollisionCircleOverlapManifold(
        bodyA.centerX,
        bodyA.centerY,
        bodyA.radius * getCollisionBodyCollisionRadiusScale(bodyA, bodyB),
        bodyB.centerX,
        bodyB.centerY,
        bodyB.radius * getCollisionBodyCollisionRadiusScale(bodyB, bodyA),
        context.manifold,
        bodyB.centerX - bodyA.centerX,
        bodyB.centerY - bodyA.centerY
    );
}

/**
 * 원형 part body 두 개의 충돌을 판정합니다.
 * @param {object} bodyA
 * @param {object} bodyB
 * @param {CollisionBodyDetectorContext} context
 * @returns {object|null}
 */
function detectCirclePartsVsCircleParts(bodyA, bodyB, context) {
    const partsA = bodyA?.circleParts;
    const partsB = bodyB?.circleParts;
    if (!(partsA instanceof Float32Array) || !(partsB instanceof Float32Array)) {
        return null;
    }

    const best = context.bestManifold;
    let hasBest = false;
    let contactCount = 0;
    let normalSumX = 0;
    let normalSumY = 0;
    let pointSumX = 0;
    let pointSumY = 0;
    let penetrationSum = 0;
    let maxPenetration = 0;
    const scaleA = getCollisionBodyCollisionRadiusScale(bodyA, bodyB);
    const scaleB = getCollisionBodyCollisionRadiusScale(bodyB, bodyA);
    const countA = Math.max(0, Math.floor(bodyA.circlePartCount || 0));
    const countB = Math.max(0, Math.floor(bodyB.circlePartCount || 0));
    const fallbackNormalX = bodyB.centerX - bodyA.centerX;
    const fallbackNormalY = bodyB.centerY - bodyA.centerY;

    for (let i = 0; i < countA; i++) {
        const offsetA = i * CIRCLE_PART_STRIDE;
        const ax = partsA[offsetA];
        const ay = partsA[offsetA + 1];
        const ar = partsA[offsetA + 2] * scaleA;
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(ar) || ar <= 0) {
            continue;
        }
        for (let j = 0; j < countB; j++) {
            const offsetB = j * CIRCLE_PART_STRIDE;
            recordCollisionPartCheck(context.profileRecorder);
            const bx = partsB[offsetB];
            const by = partsB[offsetB + 1];
            const br = partsB[offsetB + 2] * scaleB;
            if (!Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(br) || br <= 0) {
                continue;
            }
            const dx = bx - ax;
            const dy = by - ay;
            const radiusSum = ar + br;
            const distSq = (dx * dx) + (dy * dy);
            if (distSq >= (radiusSum * radiusSum)) {
                continue;
            }
            const manifold = writeCollisionCircleOverlapManifoldFromDelta(
                ax,
                ay,
                ar,
                br,
                dx,
                dy,
                distSq,
                context.candidateManifold,
                fallbackNormalX,
                fallbackNormalY
            );
            if (!manifold) continue;
            const penetration = Number.isFinite(manifold.penetration) ? manifold.penetration : 0;
            if (penetration <= EPSILON) continue;
            contactCount++;
            normalSumX += manifold.normalX * penetration;
            normalSumY += manifold.normalY * penetration;
            pointSumX += manifold.pointX * penetration;
            pointSumY += manifold.pointY * penetration;
            penetrationSum += penetration;
            if (penetration > maxPenetration) {
                maxPenetration = penetration;
            }
            if (!hasBest || manifold.penetration > best.penetration) {
                copyCollisionManifold(manifold, best);
                hasBest = true;
            }
        }
    }
    return hasBest
        ? finalizeCollisionAggregatePartManifold(best, {
            contactCount,
            normalSumX,
            normalSumY,
            pointSumX,
            pointSumY,
            penetrationSum,
            maxPenetration
        })
        : null;
}

/**
 * 원형 part body와 원형 body의 충돌을 판정합니다.
 * @param {object} partBody
 * @param {object} circleBody
 * @param {CollisionBodyDetectorContext} context
 * @returns {object|null}
 */
function detectCirclePartsVsCircle(partBody, circleBody, context) {
    const parts = partBody?.circleParts;
    if (!(parts instanceof Float32Array)) {
        return null;
    }

    const best = context.bestManifold;
    let hasBest = false;
    let contactCount = 0;
    let normalSumX = 0;
    let normalSumY = 0;
    let pointSumX = 0;
    let pointSumY = 0;
    let penetrationSum = 0;
    let maxPenetration = 0;
    const partScale = getCollisionBodyCollisionRadiusScale(partBody, circleBody);
    const circleX = circleBody.centerX;
    const circleY = circleBody.centerY;
    const circleRadius = circleBody.radius * getCollisionBodyCollisionRadiusScale(circleBody, partBody);
    if (!Number.isFinite(circleX) || !Number.isFinite(circleY) || !Number.isFinite(circleRadius) || circleRadius <= 0) {
        return null;
    }
    const count = Math.max(0, Math.floor(partBody.circlePartCount || 0));
    const fallbackNormalX = circleX - partBody.centerX;
    const fallbackNormalY = circleY - partBody.centerY;

    for (let i = 0; i < count; i++) {
        const offset = i * CIRCLE_PART_STRIDE;
        recordCollisionPartCheck(context.profileRecorder);
        const ax = parts[offset];
        const ay = parts[offset + 1];
        const ar = parts[offset + 2] * partScale;
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(ar) || ar <= 0) {
            continue;
        }
        const dx = circleX - ax;
        const dy = circleY - ay;
        const radiusSum = ar + circleRadius;
        const distSq = (dx * dx) + (dy * dy);
        if (distSq >= (radiusSum * radiusSum)) {
            continue;
        }
        const manifold = writeCollisionCircleOverlapManifoldFromDelta(
            ax,
            ay,
            ar,
            circleRadius,
            dx,
            dy,
            distSq,
            context.candidateManifold,
            fallbackNormalX,
            fallbackNormalY
        );
        if (!manifold) continue;
        const penetration = Number.isFinite(manifold.penetration) ? manifold.penetration : 0;
        if (penetration <= EPSILON) continue;
        contactCount++;
        normalSumX += manifold.normalX * penetration;
        normalSumY += manifold.normalY * penetration;
        pointSumX += manifold.pointX * penetration;
        pointSumY += manifold.pointY * penetration;
        penetrationSum += penetration;
        if (penetration > maxPenetration) {
            maxPenetration = penetration;
        }
        if (!hasBest || manifold.penetration > best.penetration) {
            copyCollisionManifold(manifold, best);
            hasBest = true;
        }
    }

    return hasBest
        ? finalizeCollisionAggregatePartManifold(best, {
            contactCount,
            normalSumX,
            normalSumY,
            pointSumX,
            pointSumY,
            penetrationSum,
            maxPenetration
        })
        : null;
}

/**
 * 원형 body와 축 정렬 사각형 body의 충돌을 판정합니다.
 * @param {object} circleBody
 * @param {object} rectBody
 * @param {CollisionBodyDetectorContext} context
 * @returns {object|null}
 */
function detectCircleVsRect(circleBody, rectBody, context) {
    return writeCollisionCircleRectOverlapManifold(
        circleBody.centerX,
        circleBody.centerY,
        circleBody.radius * getCollisionBodyCollisionRadiusScale(circleBody, rectBody),
        rectBody,
        context.manifold
    );
}

/**
 * 원형 part body와 축 정렬 사각형 body의 충돌을 판정합니다.
 * @param {object} partBody
 * @param {object} rectBody
 * @param {CollisionBodyDetectorContext} context
 * @returns {object|null}
 */
function detectCirclePartsVsRect(partBody, rectBody, context) {
    const parts = partBody?.circleParts;
    if (!(parts instanceof Float32Array)) {
        return null;
    }

    const best = context.bestManifold;
    let hasBest = false;
    let contactCount = 0;
    let normalSumX = 0;
    let normalSumY = 0;
    let pointSumX = 0;
    let pointSumY = 0;
    let penetrationSum = 0;
    let maxPenetration = 0;
    const partScale = getCollisionBodyCollisionRadiusScale(partBody, rectBody);
    const count = Math.max(0, Math.floor(partBody.circlePartCount || 0));
    const rectMinX = Number.isFinite(rectBody?.minX) ? rectBody.minX : 0;
    const rectMaxX = Number.isFinite(rectBody?.maxX) ? rectBody.maxX : 0;
    const rectMinY = Number.isFinite(rectBody?.minY) ? rectBody.minY : 0;
    const rectMaxY = Number.isFinite(rectBody?.maxY) ? rectBody.maxY : 0;

    for (let i = 0; i < count; i++) {
        const offset = i * CIRCLE_PART_STRIDE;
        recordCollisionPartCheck(context.profileRecorder);
        const circleX = parts[offset];
        const circleY = parts[offset + 1];
        const radius = parts[offset + 2] * partScale;
        if (!Number.isFinite(circleX) || !Number.isFinite(circleY) || !Number.isFinite(radius) || radius <= 0) {
            continue;
        }
        if (
            circleX + radius <= rectMinX ||
            circleX - radius >= rectMaxX ||
            circleY + radius <= rectMinY ||
            circleY - radius >= rectMaxY
        ) {
            continue;
        }
        const manifold = writeCollisionCircleRectOverlapManifold(
            circleX,
            circleY,
            radius,
            rectBody,
            context.candidateManifold
        );
        if (!manifold) continue;
        const penetration = Number.isFinite(manifold.penetration) ? manifold.penetration : 0;
        if (penetration <= EPSILON) continue;
        contactCount++;
        normalSumX += manifold.normalX * penetration;
        normalSumY += manifold.normalY * penetration;
        pointSumX += manifold.pointX * penetration;
        pointSumY += manifold.pointY * penetration;
        penetrationSum += penetration;
        if (penetration > maxPenetration) {
            maxPenetration = penetration;
        }
        if (!hasBest || manifold.penetration > best.penetration) {
            copyCollisionManifold(manifold, best);
            hasBest = true;
        }
    }

    return hasBest
        ? finalizeCollisionAggregatePartManifold(best, {
            contactCount,
            normalSumX,
            normalSumY,
            pointSumX,
            pointSumY,
            penetrationSum,
            maxPenetration
        })
        : null;
}

/**
 * part 충돌 판정 계측을 안전하게 기록합니다.
 * @param {{recordPartCheck?: function(): void}|null|undefined} profileRecorder
 */
function recordCollisionPartCheck(profileRecorder) {
    if (typeof profileRecorder?.recordPartCheck === 'function') {
        profileRecorder.recordPartCheck();
    }
}
