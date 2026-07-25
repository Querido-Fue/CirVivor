/**
 * 물리 바디의 이동 권한 종류입니다.
 * @type {Readonly<Record<string, string>>}
 */
export const PHYSICS_BODY_TYPES = Object.freeze({
    STATIC: 'static',
    KINEMATIC: 'kinematic',
    DYNAMIC: 'dynamic'
});

/**
 * 값이 IPhysicsBody2D 런타임 계약을 만족하는지 확인합니다.
 *
 * Collider는 형태·필터·접촉 재질만 별도 계약으로 소유하고, 동적 충돌 대상일 때
 * 이 바디를 참조합니다. 충돌 solver는 위치나 속도 객체를 직접 변경하지 않고
 * applyImpulse/applyPositionCorrection을 사용해야 합니다.
 * @param {*} body - 검사할 물리 바디입니다.
 * @returns {boolean} 인터페이스 충족 여부입니다.
 */
export function isPhysicsBody2D(body) {
    return Boolean(
        body
        && typeof body === 'object'
        && typeof body.physicsBodyId === 'string'
        && body.physicsBodyId.length > 0
        && typeof body.getBodyType === 'function'
        && typeof body.isPhysicsEnabled === 'function'
        && typeof body.getPosition === 'function'
        && typeof body.getPreviousPosition === 'function'
        && typeof body.getVelocity === 'function'
        && typeof body.getMass === 'function'
        && typeof body.getInverseMass === 'function'
        && typeof body.beginStep === 'function'
        && typeof body.addAcceleration === 'function'
        && typeof body.applyForce === 'function'
        && typeof body.applyImpulse === 'function'
        && typeof body.applyPositionCorrection === 'function'
        && typeof body.setPosition === 'function'
        && typeof body.setVelocity === 'function'
        && typeof body.integrate === 'function'
    );
}

/**
 * IPhysicsBody2D 계약을 확인하고 같은 바디를 반환합니다.
 * @param {*} body - 확인할 물리 바디입니다.
 * @returns {*} 확인을 통과한 원본 바디입니다.
 * @throws {TypeError} 바디가 인터페이스 계약을 만족하지 않을 때 발생합니다.
 */
export function assertPhysicsBody2D(body) {
    if (!isPhysicsBody2D(body)) {
        throw new TypeError('IPhysicsBody2D 계약을 만족하지 않는 물리 바디입니다.');
    }
    return body;
}

/**
 * 값이 물리 바디를 소유한 entity 계약을 만족하는지 확인합니다.
 * @param {*} owner - 검사할 entity 또는 component owner입니다.
 * @returns {boolean} 유효한 IPhysicsBody2D owner 여부입니다.
 */
export function isPhysicsBodyOwner(owner) {
    return Boolean(
        owner
        && typeof owner === 'object'
        && typeof owner.getPhysicsBody === 'function'
        && isPhysicsBody2D(owner.getPhysicsBody())
    );
}
