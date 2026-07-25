import { THE_TOWER_DATA } from 'data/object/tower/the_tower_data.js';
import {
    COLLISION_LAYERS
} from '../contract/collidable_contract.js';
import { PHYSICS_BODY_TYPES } from '../contract/physics_body_contract.js';
import { CircleCollider2D } from '../physics/circle_collider_2d.js';
import { PhysicsBody2D } from '../physics/physics_body_2d.js';

/**
 * @class TheTower
 * @description HP 없이 이동 의도와 IPhysicsBody2D 컴포넌트를 소유하는 파란 Tower 엔티티입니다.
 */
export class TheTower {
    /**
     * @param {{x?:number,y?:number,radius?:number,moveSpeed?:number,controlAcceleration?:number,linearFriction?:number,sleepSpeed?:number,mass?:number,maxLinearSpeed?:number}} [options={}] - 생성 옵션입니다.
     */
    constructor(options = {}) {
        const radius = Number(options.radius);
        const moveSpeed = Number(options.moveSpeed);
        const controlAcceleration = Number(options.controlAcceleration);
        const linearFriction = Number(options.linearFriction);
        const sleepSpeed = Number(options.sleepSpeed);
        const mass = Number(options.mass);
        const maxLinearSpeed = Number(options.maxLinearSpeed);
        const x = Number(options.x);
        const y = Number(options.y);

        this.id = 'the-tower';
        this.kind = 'tower';
        this.active = true;
        this.radius = Number.isFinite(radius) && radius > 0
            ? radius
            : THE_TOWER_DATA.RADIUS_TILES;
        this.moveSpeed = Number.isFinite(moveSpeed) && moveSpeed >= 0
            ? moveSpeed
            : THE_TOWER_DATA.MOVE_SPEED_TILES_PER_SECOND;
        this.linearFriction = Number.isFinite(linearFriction) && linearFriction >= 0
            ? linearFriction
            : THE_TOWER_DATA.LINEAR_FRICTION_PER_SECOND;
        this.controlAcceleration = Number.isFinite(controlAcceleration)
            && controlAcceleration >= 0
            ? controlAcceleration
            : THE_TOWER_DATA.CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED;
        this.physicsBody = new PhysicsBody2D({
            physicsBodyId: `${this.id}:physics`,
            bodyType: PHYSICS_BODY_TYPES.DYNAMIC,
            x: Number.isFinite(x) ? x : 0,
            y: Number.isFinite(y) ? y : 0,
            mass: Number.isFinite(mass) && mass > 0 ? mass : THE_TOWER_DATA.MASS,
            linearFriction: this.linearFriction,
            sleepSpeed: Number.isFinite(sleepSpeed) && sleepSpeed >= 0
                ? sleepSpeed
                : THE_TOWER_DATA.SLEEP_SPEED_TILES_PER_SECOND,
            maxLinearSpeed: Number.isFinite(maxLinearSpeed) && maxLinearSpeed > 0
                ? maxLinearSpeed
                : THE_TOWER_DATA.MAX_LINEAR_SPEED_TILES_PER_SECOND
        });
        this.collider = new CircleCollider2D({
            colliderId: `${this.id}:collider`,
            physicsBody: this.physicsBody,
            radius: this.radius,
            collisionLayer: COLLISION_LAYERS.TOWER,
            collisionMask: COLLISION_LAYERS.WORLD
                | COLLISION_LAYERS.CORE
                | COLLISION_LAYERS.ENEMY
        });
        this.position = this.physicsBody.getPosition();
        this.previousPosition = this.physicsBody.getPreviousPosition();
        this.renderPosition = { ...this.position };
        this.moveIntent = { x: 0, y: 0 };
    }

    /**
     * Tower에 부착된 IPhysicsBody2D 컴포넌트를 반환합니다.
     * 향후 Collider는 이 메서드로 같은 바디를 참조합니다.
     * @returns {PhysicsBody2D} Tower 물리 바디입니다.
     */
    getPhysicsBody() {
        return this.physicsBody;
    }

    /**
     * Tower에 부착된 원형 ICollidable2D를 반환합니다.
     * @returns {CircleCollider2D} Tower collider입니다.
     */
    getCollider() {
        return this.collider;
    }

    /**
     * 다음 fixed tick에 적용할 정규화된 이동 의도를 기록합니다.
     * @param {*} x - X축 이동 의도입니다.
     * @param {*} y - Y축 이동 의도입니다.
     * @returns {void}
     */
    setMoveIntent(x, y) {
        const nextX = Number(x);
        const nextY = Number(y);
        let safeX = Number.isFinite(nextX) ? nextX : 0;
        let safeY = Number.isFinite(nextY) ? nextY : 0;
        const magnitude = Math.hypot(safeX, safeY);
        if (magnitude > 1) {
            safeX /= magnitude;
            safeY /= magnitude;
        }
        this.moveIntent.x = safeX;
        this.moveIntent.y = safeY;
    }

    /**
     * 이동 의도를 가속도로 물리 바디에 전달하고 fixed-step 운동을 적분합니다.
     * @param {number} delta - 초 단위 fixed delta입니다.
     * @returns {void}
     */
    fixedUpdate(delta) {
        if (!this.active) {
            return;
        }

        const safeDelta = Number(delta);
        if (!Number.isFinite(safeDelta) || safeDelta <= 0) {
            return;
        }

        this.physicsBody.beginStep();
        this.physicsBody.addAcceleration(
            this.moveIntent.x * this.controlAcceleration,
            this.moveIntent.y * this.controlAcceleration
        );
        this.physicsBody.integrate(safeDelta);
    }

    /**
     * 이전 fixed 위치와 현재 위치 사이의 렌더 좌표를 계산합니다.
     * @param {number} alpha - 0~1 보간 계수입니다.
     * @returns {void}
     */
    updateRenderPosition(alpha) {
        const numericAlpha = Number(alpha);
        const safeAlpha = Number.isFinite(numericAlpha)
            ? Math.min(1, Math.max(0, numericAlpha))
            : 0;
        this.renderPosition.x = this.previousPosition.x
            + ((this.position.x - this.previousPosition.x) * safeAlpha);
        this.renderPosition.y = this.previousPosition.y
            + ((this.position.y - this.previousPosition.y) * safeAlpha);
    }

    /**
     * 엔티티를 비활성화하고 남은 이동 의도를 제거합니다.
     * @returns {void}
     */
    destroy() {
        this.active = false;
        this.setMoveIntent(0, 0);
        this.collider.destroy();
        this.physicsBody.destroy();
    }
}
