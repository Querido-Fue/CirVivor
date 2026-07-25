import { PHYSICS_BODY_TYPES } from '../contract/physics_body_contract.js';
import { PhysicsBody2D } from '../physics/physics_body_2d.js';

/**
 * The Tower의 현재 첫 구현 기본값입니다.
 * @type {Readonly<{RADIUS:number,MOVE_SPEED:number,CONTROL_ACCELERATION:number,LINEAR_FRICTION:number,SLEEP_SPEED:number,MASS:number,MAX_LINEAR_SPEED:number}>}
 */
export const THE_TOWER_DEFAULTS = Object.freeze({
    RADIUS: 24,
    MOVE_SPEED: 260,
    CONTROL_ACCELERATION: 2600,
    LINEAR_FRICTION: 10,
    SLEEP_SPEED: 0.5,
    MASS: 1,
    MAX_LINEAR_SPEED: 1200
});

/**
 * 유한한 0 이상 월드 축 크기를 반환합니다.
 * @param {*} value - 정규화할 크기입니다.
 * @returns {number} 정규화된 크기입니다.
 */
function normalizeWorldSize(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? Math.max(0, numberValue) : 0;
}

/**
 * 원 중심 좌표를 한 월드 축의 내부로 제한합니다.
 * 월드가 지름보다 작으면 축 중앙에 고정합니다.
 * @param {number} value - 제한할 중심 좌표입니다.
 * @param {number} size - 월드 축 크기입니다.
 * @param {number} radius - 원 반지름입니다.
 * @returns {number} 제한된 중심 좌표입니다.
 */
function clampCircleAxis(value, size, radius) {
    if (size <= radius * 2) {
        return size * 0.5;
    }
    return Math.min(size - radius, Math.max(radius, value));
}

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
            : THE_TOWER_DEFAULTS.RADIUS;
        this.moveSpeed = Number.isFinite(moveSpeed) && moveSpeed >= 0
            ? moveSpeed
            : THE_TOWER_DEFAULTS.MOVE_SPEED;
        this.linearFriction = Number.isFinite(linearFriction) && linearFriction >= 0
            ? linearFriction
            : THE_TOWER_DEFAULTS.LINEAR_FRICTION;
        this.controlAcceleration = Number.isFinite(controlAcceleration)
            && controlAcceleration >= 0
            ? controlAcceleration
            : this.moveSpeed * (
                this.linearFriction > 0
                    ? this.linearFriction
                    : THE_TOWER_DEFAULTS.LINEAR_FRICTION
            );
        this.physicsBody = new PhysicsBody2D({
            physicsBodyId: `${this.id}:physics`,
            bodyType: PHYSICS_BODY_TYPES.DYNAMIC,
            x: Number.isFinite(x) ? x : 0,
            y: Number.isFinite(y) ? y : 0,
            mass: Number.isFinite(mass) && mass > 0 ? mass : THE_TOWER_DEFAULTS.MASS,
            linearFriction: this.linearFriction,
            sleepSpeed: Number.isFinite(sleepSpeed) && sleepSpeed >= 0
                ? sleepSpeed
                : THE_TOWER_DEFAULTS.SLEEP_SPEED,
            maxLinearSpeed: Number.isFinite(maxLinearSpeed) && maxLinearSpeed > 0
                ? maxLinearSpeed
                : THE_TOWER_DEFAULTS.MAX_LINEAR_SPEED
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
     * @param {{ww?:number,objectWH?:number}} viewport - 현재 월드 뷰포트입니다.
     * @returns {void}
     */
    fixedUpdate(delta, viewport) {
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
        this.#resolveWorldBounds(viewport);
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
     * resize에서 월드를 재생성하지 않고 현재 위치만 새 경계 안으로 제한합니다.
     * @param {{ww?:number,objectWH?:number}} viewport - 새 월드 뷰포트입니다.
     * @returns {void}
     */
    resize(viewport) {
        this.#resolveWorldBounds(viewport);
        this.physicsBody.setPosition(this.position.x, this.position.y, true);
        this.renderPosition.x = this.position.x;
        this.renderPosition.y = this.position.y;
    }

    /**
     * 엔티티를 비활성화하고 남은 이동 의도를 제거합니다.
     * @returns {void}
     */
    destroy() {
        this.active = false;
        this.setMoveIntent(0, 0);
        this.physicsBody.destroy();
    }

    /**
     * 현재 원을 월드 경계 안으로 위치 보정하고 경계 밖을 향하는 속도만 제거합니다.
     * CollisionHandler 도입 전까지 사용하는 최소 constraint입니다.
     * @param {{ww?:number,objectWH?:number}} viewport - 현재 월드 뷰포트입니다.
     * @returns {void}
     * @private
     */
    #resolveWorldBounds(viewport) {
        const width = normalizeWorldSize(viewport?.ww);
        const height = normalizeWorldSize(viewport?.objectWH);
        const nextX = clampCircleAxis(this.position.x, width, this.radius);
        const nextY = clampCircleAxis(this.position.y, height, this.radius);
        const correctionX = nextX - this.position.x;
        const correctionY = nextY - this.position.y;
        this.physicsBody.applyPositionCorrection(correctionX, correctionY);

        const velocity = this.physicsBody.getVelocity();
        let velocityX = velocity.x;
        let velocityY = velocity.y;
        if (width <= this.radius * 2
            || (correctionX > 0 && velocityX < 0)
            || (correctionX < 0 && velocityX > 0)) {
            velocityX = 0;
        }
        if (height <= this.radius * 2
            || (correctionY > 0 && velocityY < 0)
            || (correctionY < 0 && velocityY > 0)) {
            velocityY = 0;
        }
        this.physicsBody.setVelocity(velocityX, velocityY);
    }
}
