import {
    COLLIDER_SHAPES,
    assertCollidable2D
} from '../contract/collidable_contract.js';
import { assertPhysicsBody2D } from '../contract/physics_body_contract.js';

/**
 * @class CircleCollider2D
 * @description 원형 충돌 형상과 필터를 소유하고 운동 상태는 IPhysicsBody2D를 참조합니다.
 */
export class CircleCollider2D {
    /**
     * @param {object} options - collider 생성 옵션입니다.
     * @param {string} options.colliderId - 안정적인 collider ID입니다.
     * @param {object} options.physicsBody - 참조할 IPhysicsBody2D입니다.
     * @param {number} options.radius - 원 반지름입니다.
     * @param {number} options.collisionLayer - 소속 충돌 layer 비트입니다.
     * @param {number} options.collisionMask - 접촉을 허용할 layer mask입니다.
     */
    constructor(options) {
        const colliderId = typeof options?.colliderId === 'string'
            ? options.colliderId.trim()
            : '';
        const radius = Number(options?.radius);
        const collisionLayer = Number(options?.collisionLayer);
        const collisionMask = Number(options?.collisionMask);
        if (colliderId.length === 0) {
            throw new TypeError('CircleCollider2D에는 colliderId가 필요합니다.');
        }
        if (!Number.isFinite(radius) || radius <= 0) {
            throw new RangeError('CircleCollider2D radius는 양의 유한수여야 합니다.');
        }

        this.colliderId = colliderId;
        this.physicsBody = assertPhysicsBody2D(options.physicsBody);
        this.radius = radius;
        this.collisionLayer = Number.isInteger(collisionLayer) && collisionLayer >= 0
            ? collisionLayer
            : 0;
        this.collisionMask = Number.isInteger(collisionMask) && collisionMask >= 0
            ? collisionMask
            : 0;
        this.enabled = true;
        assertCollidable2D(this);
    }

    /** @returns {string} 원형 shape ID입니다. */
    getShapeType() {
        return COLLIDER_SHAPES.CIRCLE;
    }

    /** @returns {boolean} 충돌 단계 참여 여부입니다. */
    isCollisionEnabled() {
        return this.enabled && this.physicsBody.isPhysicsEnabled();
    }

    /** @returns {number} 충돌 layer 비트입니다. */
    getCollisionLayer() {
        return this.collisionLayer;
    }

    /** @returns {number} 충돌 mask입니다. */
    getCollisionMask() {
        return this.collisionMask;
    }

    /** @returns {object} 같은 entity의 IPhysicsBody2D입니다. */
    getPhysicsBody() {
        return this.physicsBody;
    }

    /** @returns {number} 원 반지름입니다. */
    getRadius() {
        return this.radius;
    }

    /** @returns {void} collider를 비활성화합니다. */
    destroy() {
        this.enabled = false;
    }
}
