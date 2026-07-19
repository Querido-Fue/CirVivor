import { getData } from 'data/data_handler.js';
import { getCollisionBodyCollisionRadiusScale } from './_collision_resolve_tuning.js';

const COLLISION_CONSTANTS = getData('COLLISION_CONSTANTS');
const EPSILON = COLLISION_CONSTANTS.EPSILON;
const CIRCLE_PART_STRIDE = COLLISION_CONSTANTS.BODY_BUILDER.CIRCLE_PART_STRIDE;

/**
 * handler가 준비한 canonical enemy body 두 개의 boolean 접촉 여부만 판정합니다.
 * 공개 narrow-phase와 달리 manifold를 만들거나 part-check recorder를 호출하지 않습니다.
 * @param {object} bodyA - 첫 번째 prepared enemy body입니다.
 * @param {object} bodyB - 두 번째 prepared enemy body입니다.
 * @returns {boolean} 기존 manifold 판정이 truthy인 경우 true입니다.
 */
export function detectCollisionBodiesBooleanContact(bodyA, bodyB) {
    if (!bodyA || !bodyB) {
        return false;
    }

    if (bodyA.shape === 'circle' && bodyB.shape === 'circle') {
        return detectCircleVsCircleContact(bodyA, bodyB);
    }

    if (bodyA.shape === 'circleParts' && bodyB.shape === 'circleParts') {
        return detectCirclePartsVsCirclePartsContact(bodyA, bodyB);
    }

    if (bodyA.shape === 'circleParts' && bodyB.shape === 'circle') {
        return detectCirclePartsVsCircleContact(bodyA, bodyB);
    }

    if (bodyA.shape === 'circle' && bodyB.shape === 'circleParts') {
        return detectCirclePartsVsCircleContact(bodyB, bodyA);
    }

    return false;
}

/**
 * 원형 body 두 개의 기존 manifold truthiness와 같은 결과를 반환합니다.
 * @param {object} bodyA
 * @param {object} bodyB
 * @returns {boolean}
 */
function detectCircleVsCircleContact(bodyA, bodyB) {
    const ax = bodyA.centerX;
    const ay = bodyA.centerY;
    const ar = bodyA.radius * getCollisionBodyCollisionRadiusScale(bodyA, bodyB);
    const bx = bodyB.centerX;
    const by = bodyB.centerY;
    const br = bodyB.radius * getCollisionBodyCollisionRadiusScale(bodyB, bodyA);
    if (!isValidCollisionCircle(ax, ay, ar) || !isValidCollisionCircle(bx, by, br)) {
        return false;
    }

    const dx = bx - ax;
    const dy = by - ay;
    const radiusSum = ar + br;
    const distSq = (dx * dx) + (dy * dy);
    return distSq < (radiusSum * radiusSum);
}

/**
 * 두 원형 part 묶음에서 기존 aggregate manifold가 생성되는 접촉이 하나라도 있는지 확인합니다.
 * @param {object} bodyA
 * @param {object} bodyB
 * @returns {boolean}
 */
function detectCirclePartsVsCirclePartsContact(bodyA, bodyB) {
    const partsA = bodyA?.circleParts;
    const partsB = bodyB?.circleParts;
    if (!(partsA instanceof Float32Array) || !(partsB instanceof Float32Array)) {
        return false;
    }

    const scaleA = getCollisionBodyCollisionRadiusScale(bodyA, bodyB);
    const scaleB = getCollisionBodyCollisionRadiusScale(bodyB, bodyA);
    const countA = Math.max(0, Math.floor(bodyA.circlePartCount || 0));
    const countB = Math.max(0, Math.floor(bodyB.circlePartCount || 0));
    for (let i = 0; i < countA; i++) {
        const offsetA = i * CIRCLE_PART_STRIDE;
        const ax = partsA[offsetA];
        const ay = partsA[offsetA + 1];
        const ar = partsA[offsetA + 2] * scaleA;
        if (!isValidCollisionCircle(ax, ay, ar)) {
            continue;
        }

        for (let j = 0; j < countB; j++) {
            const offsetB = j * CIRCLE_PART_STRIDE;
            const bx = partsB[offsetB];
            const by = partsB[offsetB + 1];
            const br = partsB[offsetB + 2] * scaleB;
            if (!isValidCollisionCircle(bx, by, br)) {
                continue;
            }
            if (detectAggregateCircleContact(ax, ay, ar, bx, by, br)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * 원형 part 묶음과 원형 body에서 기존 aggregate manifold가 생성되는지 확인합니다.
 * @param {object} partBody
 * @param {object} circleBody
 * @returns {boolean}
 */
function detectCirclePartsVsCircleContact(partBody, circleBody) {
    const parts = partBody?.circleParts;
    if (!(parts instanceof Float32Array)) {
        return false;
    }

    const circleX = circleBody.centerX;
    const circleY = circleBody.centerY;
    const circleRadius = circleBody.radius
        * getCollisionBodyCollisionRadiusScale(circleBody, partBody);
    if (!isValidCollisionCircle(circleX, circleY, circleRadius)) {
        return false;
    }

    const partScale = getCollisionBodyCollisionRadiusScale(partBody, circleBody);
    const count = Math.max(0, Math.floor(partBody.circlePartCount || 0));
    for (let i = 0; i < count; i++) {
        const offset = i * CIRCLE_PART_STRIDE;
        const partX = parts[offset];
        const partY = parts[offset + 1];
        const partRadius = parts[offset + 2] * partScale;
        if (!isValidCollisionCircle(partX, partY, partRadius)) {
            continue;
        }
        if (detectAggregateCircleContact(
            partX,
            partY,
            partRadius,
            circleX,
            circleY,
            circleRadius
        )) {
            return true;
        }
    }
    return false;
}

/**
 * aggregate part detector가 유효한 단일 접촉으로 인정하는지 반환합니다.
 * 중심 거리가 EPSILON 이하이면 기존 writer와 같이 거리를 0으로 보정합니다.
 * @param {number} ax
 * @param {number} ay
 * @param {number} ar
 * @param {number} bx
 * @param {number} by
 * @param {number} br
 * @returns {boolean}
 */
function detectAggregateCircleContact(ax, ay, ar, bx, by, br) {
    const dx = bx - ax;
    const dy = by - ay;
    const radiusSum = ar + br;
    const distSq = (dx * dx) + (dy * dy);
    if (distSq >= (radiusSum * radiusSum)) {
        return false;
    }

    let distance = Math.sqrt(distSq);
    if (!(distance > EPSILON)) {
        distance = 0;
    }
    return (radiusSum - distance) > EPSILON;
}

/**
 * 기존 circle manifold writer와 같은 숫자 유효성 조건을 검사합니다.
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @returns {boolean}
 */
function isValidCollisionCircle(x, y, radius) {
    return Number.isFinite(x)
        && Number.isFinite(y)
        && Number.isFinite(radius)
        && radius > 0;
}
