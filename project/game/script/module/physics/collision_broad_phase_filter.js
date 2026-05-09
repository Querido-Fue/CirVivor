import { getData } from 'data/data_handler.js';

const BOUND_RADIUS_HALF_SCALE = getData('COLLISION_CONSTANTS').BODY_BUILDER.BOUND_RADIUS_HALF_SCALE;

/**
 * 관계별 원형 충돌 반경에 맞춘 AABB 중첩 여부를 반환합니다.
 * @param {object} bodyA - 첫 번째 충돌 body입니다.
 * @param {object} bodyB - 두 번째 충돌 body입니다.
 * @returns {boolean} AABB가 겹치면 true입니다.
 */
export function areCollisionBodyAabbsOverlapping(bodyA, bodyB) {
    if (!bodyA || !bodyB) return false;

    let minAX = bodyA.minX;
    let maxAX = bodyA.maxX;
    let minAY = bodyA.minY;
    let maxAY = bodyA.maxY;
    let minBX = bodyB.minX;
    let maxBX = bodyB.maxX;
    let minBY = bodyB.minY;
    let maxBY = bodyB.maxY;

    if (bodyA.kind === 'enemy' && bodyB.kind === 'enemy') {
        minAX = Number.isFinite(bodyA.enemyPairMinX) ? bodyA.enemyPairMinX : minAX;
        maxAX = Number.isFinite(bodyA.enemyPairMaxX) ? bodyA.enemyPairMaxX : maxAX;
        minAY = Number.isFinite(bodyA.enemyPairMinY) ? bodyA.enemyPairMinY : minAY;
        maxAY = Number.isFinite(bodyA.enemyPairMaxY) ? bodyA.enemyPairMaxY : maxAY;
        minBX = Number.isFinite(bodyB.enemyPairMinX) ? bodyB.enemyPairMinX : minBX;
        maxBX = Number.isFinite(bodyB.enemyPairMaxX) ? bodyB.enemyPairMaxX : maxBX;
        minBY = Number.isFinite(bodyB.enemyPairMinY) ? bodyB.enemyPairMinY : minBY;
        maxBY = Number.isFinite(bodyB.enemyPairMaxY) ? bodyB.enemyPairMaxY : maxBY;
    } else if (bodyA.kind === 'enemy' && bodyB.kind === 'projectile') {
        minAX = Number.isFinite(bodyA.projectileMinX) ? bodyA.projectileMinX : minAX;
        maxAX = Number.isFinite(bodyA.projectileMaxX) ? bodyA.projectileMaxX : maxAX;
        minAY = Number.isFinite(bodyA.projectileMinY) ? bodyA.projectileMinY : minAY;
        maxAY = Number.isFinite(bodyA.projectileMaxY) ? bodyA.projectileMaxY : maxAY;
    } else if (bodyA.kind === 'projectile' && bodyB.kind === 'enemy') {
        minBX = Number.isFinite(bodyB.projectileMinX) ? bodyB.projectileMinX : minBX;
        maxBX = Number.isFinite(bodyB.projectileMaxX) ? bodyB.projectileMaxX : maxBX;
        minBY = Number.isFinite(bodyB.projectileMinY) ? bodyB.projectileMinY : minBY;
        maxBY = Number.isFinite(bodyB.projectileMaxY) ? bodyB.projectileMaxY : maxBY;
    }

    return (
        minAX <= maxBX &&
        maxAX >= minBX &&
        minAY <= maxBY &&
        maxAY >= minBY
    );
}

/**
 * broad circle 필터가 narrowphase와 다른 의미를 갖는 쌍인지 반환합니다.
 * @param {object} bodyA - 첫 번째 충돌 body입니다.
 * @param {object} bodyB - 두 번째 충돌 body입니다.
 * @returns {boolean} 추가 broad circle 필터가 필요하면 true입니다.
 */
export function shouldUseCollisionBroadCircleFilter(bodyA, bodyB) {
    return bodyA?.shape !== 'circle' || bodyB?.shape !== 'circle';
}

/**
 * 관계별 union circle의 중첩 여부를 반환합니다.
 * @param {object} bodyA - 첫 번째 충돌 body입니다.
 * @param {object} bodyB - 두 번째 충돌 body입니다.
 * @param {number} epsilon - 원형 판정 보정값입니다.
 * @returns {boolean} broad circle이 겹치면 true입니다.
 */
export function areCollisionBodyBroadCirclesOverlapping(bodyA, bodyB, epsilon) {
    const ax = Number.isFinite(bodyA?.centerX) ? bodyA.centerX : bodyA?.x;
    const ay = Number.isFinite(bodyA?.centerY) ? bodyA.centerY : bodyA?.y;
    const bx = Number.isFinite(bodyB?.centerX) ? bodyB.centerX : bodyB?.x;
    const by = Number.isFinite(bodyB?.centerY) ? bodyB.centerY : bodyB?.y;
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
        return true;
    }

    const ra = getCollisionBodyRelationBroadRadius(bodyA, bodyB);
    const rb = getCollisionBodyRelationBroadRadius(bodyB, bodyA);
    if (!Number.isFinite(ra) || !Number.isFinite(rb) || ra <= 0 || rb <= 0) {
        return true;
    }

    const radiusSum = ra + rb + (Number.isFinite(epsilon) ? epsilon : 0);
    const dx = bx - ax;
    const dy = by - ay;
    return ((dx * dx) + (dy * dy)) <= (radiusSum * radiusSum);
}

/**
 * 관계별 broad-phase 반경을 반환합니다.
 * @param {object} body - 반경을 읽을 충돌 body입니다.
 * @param {object} otherBody - 관계 판정 대상 body입니다.
 * @returns {number} 관계별 broad-phase 반경입니다.
 */
function getCollisionBodyRelationBroadRadius(body, otherBody) {
    if (!body) return 0;
    if (body.kind === 'enemy' && otherBody?.kind === 'enemy' && Number.isFinite(body.enemyPairBroadRadius)) {
        return body.enemyPairBroadRadius;
    }
    if (body.kind === 'enemy' && otherBody?.kind === 'projectile' && Number.isFinite(body.projectileBroadRadius)) {
        return body.projectileBroadRadius;
    }
    if (body.shape === 'circle') {
        return Number.isFinite(body.radius) ? body.radius : 0;
    }
    if (Number.isFinite(body.broadRadius)) {
        return body.broadRadius;
    }
    if (Number.isFinite(body.boundRadius)) {
        return body.boundRadius;
    }
    const minX = Number.isFinite(body.minX) ? body.minX : 0;
    const maxX = Number.isFinite(body.maxX) ? body.maxX : 0;
    const minY = Number.isFinite(body.minY) ? body.minY : 0;
    const maxY = Number.isFinite(body.maxY) ? body.maxY : 0;
    return Math.hypot((maxX - minX) * BOUND_RADIUS_HALF_SCALE, (maxY - minY) * BOUND_RADIUS_HALF_SCALE);
}
