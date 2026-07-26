import { isPhysicsBody2D } from './physics_body_contract.js';

/**
 * 충돌 형상 종류입니다.
 * @type {Readonly<Record<string, string>>}
 */
export const COLLIDER_SHAPES = Object.freeze({
    CIRCLE: 'circle'
});

/**
 * 충돌 필터 비트입니다.
 * @type {Readonly<Record<string, number>>}
 */
export const COLLISION_LAYERS = Object.freeze({
    WORLD: 1,
    TOWER: 2,
    CORE: 4,
    ENEMY: 8,
    PROJECTILE: 16
});

/**
 * 값이 ICollidable2D 런타임 계약을 만족하는지 확인합니다.
 * @param {*} collider - 검사할 collider입니다.
 * @returns {boolean} 인터페이스 충족 여부입니다.
 */
export function isCollidable2D(collider) {
    return Boolean(
        collider
        && typeof collider === 'object'
        && typeof collider.colliderId === 'string'
        && collider.colliderId.length > 0
        && typeof collider.getShapeType === 'function'
        && typeof collider.isCollisionEnabled === 'function'
        && typeof collider.getCollisionLayer === 'function'
        && typeof collider.getCollisionMask === 'function'
        && typeof collider.getPhysicsBody === 'function'
        && isPhysicsBody2D(collider.getPhysicsBody())
    );
}

/**
 * 값이 원형 ICollidable2D 계약을 만족하는지 확인합니다.
 * @param {*} collider - 검사할 collider입니다.
 * @returns {boolean} 원형 collider 여부입니다.
 */
export function isCircleCollidable2D(collider) {
    return isCollidable2D(collider)
        && collider.getShapeType() === COLLIDER_SHAPES.CIRCLE
        && typeof collider.getRadius === 'function'
        && Number.isFinite(collider.getRadius())
        && collider.getRadius() > 0;
}

/**
 * ICollidable2D 계약을 확인하고 같은 collider를 반환합니다.
 * @param {*} collider - 확인할 collider입니다.
 * @returns {*} 확인을 통과한 원본 collider입니다.
 * @throws {TypeError} 계약을 만족하지 않을 때 발생합니다.
 */
export function assertCollidable2D(collider) {
    if (!isCollidable2D(collider)) {
        throw new TypeError('ICollidable2D 계약을 만족하지 않는 collider입니다.');
    }
    return collider;
}

/**
 * 원형 ICollidable2D 계약을 확인하고 같은 collider를 반환합니다.
 * @param {*} collider - 확인할 collider입니다.
 * @returns {*} 확인을 통과한 원본 collider입니다.
 * @throws {TypeError} 계약을 만족하지 않을 때 발생합니다.
 */
export function assertCircleCollidable2D(collider) {
    if (!isCircleCollidable2D(collider)) {
        throw new TypeError('원형 ICollidable2D 계약을 만족하지 않는 collider입니다.');
    }
    return collider;
}
