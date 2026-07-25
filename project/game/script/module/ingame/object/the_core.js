import { THE_CORE_DATA } from 'data/object/core/the_core_data.js';
import {
    COLLISION_LAYERS
} from '../contract/collidable_contract.js';
import { assertCoreIntegrity } from '../contract/core_integrity_contract.js';
import { PHYSICS_BODY_TYPES } from '../contract/physics_body_contract.js';
import { CircleCollider2D } from '../physics/circle_collider_2d.js';
import { PhysicsBody2D } from '../physics/physics_body_2d.js';

/**
 * @class TheCore
 * @description GameSystem 소유 ICoreIntegrity를 표시하는 고정형 Core entity입니다.
 */
export class TheCore {
    /**
     * @param {object} options - 생성 옵션입니다.
     * @param {number} options.x - 월드 X입니다.
     * @param {number} options.y - 월드 Y입니다.
     * @param {object} options.integrity - ICoreIntegrity component입니다.
     */
    constructor(options) {
        const x = Number(options?.x);
        const y = Number(options?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new TypeError('TheCore에는 유한한 월드 위치가 필요합니다.');
        }

        this.id = 'the-core';
        this.kind = 'core';
        this.active = true;
        this.radius = THE_CORE_DATA.RADIUS_TILES;
        this.integrity = assertCoreIntegrity(options.integrity);
        this.physicsBody = new PhysicsBody2D({
            physicsBodyId: `${this.id}:physics`,
            bodyType: PHYSICS_BODY_TYPES.STATIC,
            x,
            y
        });
        this.position = this.physicsBody.getPosition();
        this.collider = new CircleCollider2D({
            colliderId: `${this.id}:collider`,
            physicsBody: this.physicsBody,
            radius: this.radius,
            collisionLayer: COLLISION_LAYERS.CORE,
            collisionMask: COLLISION_LAYERS.TOWER | COLLISION_LAYERS.ENEMY
        });
    }

    /** @returns {object} Core의 ICoreIntegrity component입니다. */
    getCoreIntegrity() {
        return this.integrity;
    }

    /** @returns {PhysicsBody2D} Core의 static IPhysicsBody2D입니다. */
    getPhysicsBody() {
        return this.physicsBody;
    }

    /** @returns {CircleCollider2D} Core의 ICollidable2D입니다. */
    getCollider() {
        return this.collider;
    }

    /** @returns {void} Core entity를 비활성화합니다. */
    destroy() {
        if (!this.active) {
            return;
        }
        this.active = false;
        this.collider.destroy();
        this.physicsBody.destroy();
    }
}
