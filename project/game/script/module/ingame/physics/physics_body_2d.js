import { PHYSICS_BODY_TYPES } from '../contract/physics_body_contract.js';

const DEFAULT_MASS = 1;
const DEFAULT_LINEAR_FRICTION = 0;
const DEFAULT_SLEEP_SPEED = 0;
const DEFAULT_MAX_LINEAR_SPEED = Infinity;

/**
 * 유한한 숫자 또는 fallback을 반환합니다.
 * @param {*} value - 정규화할 값입니다.
 * @param {number} fallback - 유효하지 않을 때 사용할 값입니다.
 * @returns {number} 정규화된 숫자입니다.
 */
function resolveFiniteNumber(value, fallback) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

/**
 * 0 이상 유한 숫자 또는 fallback을 반환합니다.
 * @param {*} value - 정규화할 값입니다.
 * @param {number} fallback - 유효하지 않을 때 사용할 값입니다.
 * @returns {number} 정규화된 숫자입니다.
 */
function resolveNonNegativeNumber(value, fallback) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0
        ? numberValue
        : fallback;
}

/**
 * 지원하는 물리 바디 종류를 반환합니다.
 * @param {*} value - 원본 바디 종류입니다.
 * @returns {string} 정규화된 PHYSICS_BODY_TYPES 값입니다.
 */
function normalizeBodyType(value) {
    if (value === PHYSICS_BODY_TYPES.STATIC || value === PHYSICS_BODY_TYPES.KINEMATIC) {
        return value;
    }
    return PHYSICS_BODY_TYPES.DYNAMIC;
}

/**
 * 벡터 크기를 최대값으로 제한합니다.
 * @param {{x:number,y:number}} vector - 제자리 수정할 벡터입니다.
 * @param {number} maxMagnitude - 허용할 최대 크기입니다.
 * @returns {void}
 */
function clampVectorMagnitude(vector, maxMagnitude) {
    if (!Number.isFinite(maxMagnitude)) {
        return;
    }
    const magnitude = Math.hypot(vector.x, vector.y);
    if (magnitude <= maxMagnitude || magnitude === 0) {
        return;
    }
    const scale = maxMagnitude / magnitude;
    vector.x *= scale;
    vector.y *= scale;
}

/**
 * @class PhysicsBody2D
 * @description 힘·가속도·충격량·충돌 위치 보정을 하나의 fixed-step 운동 상태로 합성합니다.
 */
export class PhysicsBody2D {
    /**
     * @param {object} [options={}] - 물리 바디 생성 옵션입니다.
     * @param {string} [options.physicsBodyId='physics-body'] - 안정적인 바디 ID입니다.
     * @param {'static'|'kinematic'|'dynamic'} [options.bodyType='dynamic'] - 이동 권한 종류입니다.
     * @param {number} [options.x=0] - 초기 X 위치입니다.
     * @param {number} [options.y=0] - 초기 Y 위치입니다.
     * @param {number} [options.mass=1] - dynamic 바디 질량입니다.
     * @param {number} [options.linearFriction=0] - 초 단위 지수 감쇠 마찰 계수입니다.
     * @param {number} [options.sleepSpeed=0] - 외력이 없을 때 정지로 간주할 속도입니다.
     * @param {number} [options.maxLinearSpeed=Infinity] - 폭주 방지용 최대 물리 속도입니다.
     */
    constructor(options = {}) {
        const bodyType = normalizeBodyType(options.bodyType);
        const mass = resolveFiniteNumber(options.mass, DEFAULT_MASS);
        const maxLinearSpeed = Number(options.maxLinearSpeed);

        this.physicsBodyId = typeof options.physicsBodyId === 'string'
            && options.physicsBodyId.length > 0
            ? options.physicsBodyId
            : 'physics-body';
        this.bodyType = bodyType;
        this.enabled = true;
        this.mass = bodyType === PHYSICS_BODY_TYPES.DYNAMIC && mass > 0
            ? mass
            : Infinity;
        this.inverseMass = Number.isFinite(this.mass) ? 1 / this.mass : 0;
        this.linearFriction = resolveNonNegativeNumber(
            options.linearFriction,
            DEFAULT_LINEAR_FRICTION
        );
        this.sleepSpeed = resolveNonNegativeNumber(options.sleepSpeed, DEFAULT_SLEEP_SPEED);
        this.maxLinearSpeed = (Number.isFinite(maxLinearSpeed) && maxLinearSpeed > 0)
            ? maxLinearSpeed
            : DEFAULT_MAX_LINEAR_SPEED;
        this.position = {
            x: resolveFiniteNumber(options.x, 0),
            y: resolveFiniteNumber(options.y, 0)
        };
        this.previousPosition = { ...this.position };
        this.velocity = { x: 0, y: 0 };
        this.accelerationAccumulator = { x: 0, y: 0 };
        this.forceAccumulator = { x: 0, y: 0 };
        this.stepBegun = false;
    }

    /**
     * 바디 이동 권한 종류를 반환합니다.
     * @returns {string} PHYSICS_BODY_TYPES 값입니다.
     */
    getBodyType() {
        return this.bodyType;
    }

    /**
     * 현재 바디가 물리 단계에 참여할 수 있는지 반환합니다.
     * @returns {boolean} 활성 여부입니다.
     */
    isPhysicsEnabled() {
        return this.enabled;
    }

    /**
     * 현재 위치의 동일한 읽기 전용 참조를 반환합니다.
     * 호출자는 직접 변경하지 않고 공개 mutator를 사용해야 합니다.
     * @returns {{x:number,y:number}} 현재 위치입니다.
     */
    getPosition() {
        return this.position;
    }

    /**
     * fixed step 시작 위치의 동일한 읽기 전용 참조를 반환합니다.
     * @returns {{x:number,y:number}} 이전 위치입니다.
     */
    getPreviousPosition() {
        return this.previousPosition;
    }

    /**
     * 현재 속도의 동일한 읽기 전용 참조를 반환합니다.
     * 호출자는 직접 변경하지 않고 setVelocity/applyImpulse를 사용해야 합니다.
     * @returns {{x:number,y:number}} 현재 속도입니다.
     */
    getVelocity() {
        return this.velocity;
    }

    /**
     * 바디 질량을 반환합니다. static/kinematic 바디는 Infinity입니다.
     * @returns {number} 질량입니다.
     */
    getMass() {
        return this.mass;
    }

    /**
     * 충격량과 충돌 해소에 사용할 역질량을 반환합니다.
     * @returns {number} 역질량입니다.
     */
    getInverseMass() {
        return this.inverseMass;
    }

    /**
     * fixed step의 이전 위치를 한 번 캡처합니다.
     * @returns {boolean} 이번 호출에서 새 step을 시작했는지 여부입니다.
     */
    beginStep() {
        if (!this.enabled || this.stepBegun) {
            return false;
        }
        this.previousPosition.x = this.position.x;
        this.previousPosition.y = this.position.y;
        this.stepBegun = true;
        return true;
    }

    /**
     * 질량과 무관한 연속 가속도를 현재 step accumulator에 더합니다.
     * 플레이어 입력과 중력 같은 운동 의도에 사용합니다.
     * @param {*} x - X축 가속도입니다.
     * @param {*} y - Y축 가속도입니다.
     * @returns {boolean} 가속도가 반영되었는지 여부입니다.
     */
    addAcceleration(x, y) {
        if (!this.#canReceiveDynamicEffect()) {
            return false;
        }
        this.accelerationAccumulator.x += resolveFiniteNumber(x, 0);
        this.accelerationAccumulator.y += resolveFiniteNumber(y, 0);
        return true;
    }

    /**
     * 질량에 따라 가속도로 변환할 연속 힘을 현재 step accumulator에 더합니다.
     * @param {*} x - X축 힘입니다.
     * @param {*} y - Y축 힘입니다.
     * @returns {boolean} 힘이 반영되었는지 여부입니다.
     */
    applyForce(x, y) {
        if (!this.#canReceiveDynamicEffect()) {
            return false;
        }
        this.forceAccumulator.x += resolveFiniteNumber(x, 0);
        this.forceAccumulator.y += resolveFiniteNumber(y, 0);
        return true;
    }

    /**
     * 순간 충격량을 역질량으로 속도에 즉시 반영합니다.
     * 스킬 반동과 충돌 impulse가 같은 경로를 사용합니다.
     * @param {*} x - X축 충격량입니다.
     * @param {*} y - Y축 충격량입니다.
     * @returns {boolean} 충격량이 반영되었는지 여부입니다.
     */
    applyImpulse(x, y) {
        if (!this.#canReceiveDynamicEffect()) {
            return false;
        }
        this.velocity.x += resolveFiniteNumber(x, 0) * this.inverseMass;
        this.velocity.y += resolveFiniteNumber(y, 0) * this.inverseMass;
        return true;
    }

    /**
     * 충돌 solver의 침투 해소량을 현재 위치에만 반영합니다.
     * 이전 위치는 유지하므로 렌더 보간에서 실제 보정이 관찰됩니다.
     * @param {*} x - X축 위치 보정량입니다.
     * @param {*} y - Y축 위치 보정량입니다.
     * @returns {boolean} 위치 보정이 반영되었는지 여부입니다.
     */
    applyPositionCorrection(x, y) {
        if (!this.enabled || this.bodyType === PHYSICS_BODY_TYPES.STATIC) {
            return false;
        }
        this.position.x += resolveFiniteNumber(x, 0);
        this.position.y += resolveFiniteNumber(y, 0);
        return true;
    }

    /**
     * 현재 위치를 설정하고 선택적으로 이전 위치를 동기화합니다.
     * spawn/teleport/resize 같은 비물리 변환 경계에서만 사용합니다.
     * @param {*} x - 새 X 위치입니다.
     * @param {*} y - 새 Y 위치입니다.
     * @param {boolean} [synchronizePrevious=false] - 이전 위치도 같은 값으로 맞출지 여부입니다.
     * @returns {void}
     */
    setPosition(x, y, synchronizePrevious = false) {
        this.position.x = resolveFiniteNumber(x, this.position.x);
        this.position.y = resolveFiniteNumber(y, this.position.y);
        if (synchronizePrevious) {
            this.previousPosition.x = this.position.x;
            this.previousPosition.y = this.position.y;
        }
    }

    /**
     * 현재 속도를 명시적으로 설정합니다.
     * 경계 constraint나 collision solver의 법선 속도 제거에 사용합니다.
     * @param {*} x - 새 X 속도입니다.
     * @param {*} y - 새 Y 속도입니다.
     * @returns {void}
     */
    setVelocity(x, y) {
        this.velocity.x = resolveFiniteNumber(x, 0);
        this.velocity.y = resolveFiniteNumber(y, 0);
        clampVectorMagnitude(this.velocity, this.maxLinearSpeed);
    }

    /**
     * 누적 가속도·힘과 선형 마찰을 fixed delta로 적분합니다.
     * 지수 감쇠의 해석식을 사용하여 같은 총 시간에서 frame 분할 오차를 줄입니다.
     * @param {*} delta - 초 단위 fixed delta입니다.
     * @returns {boolean} 유효한 적분을 수행했는지 여부입니다.
     */
    integrate(delta) {
        if (!this.enabled || this.bodyType === PHYSICS_BODY_TYPES.STATIC) {
            this.#clearAccumulators();
            this.stepBegun = false;
            return false;
        }
        const safeDelta = Number(delta);
        if (!Number.isFinite(safeDelta) || safeDelta <= 0) {
            return false;
        }
        if (!this.stepBegun) {
            this.beginStep();
        }

        if (this.bodyType === PHYSICS_BODY_TYPES.DYNAMIC) {
            const accelerationX = this.accelerationAccumulator.x
                + (this.forceAccumulator.x * this.inverseMass);
            const accelerationY = this.accelerationAccumulator.y
                + (this.forceAccumulator.y * this.inverseMass);
            this.#integrateDynamicVelocity(accelerationX, accelerationY, safeDelta);
        }

        this.position.x += this.velocity.x * safeDelta;
        this.position.y += this.velocity.y * safeDelta;
        this.#clearAccumulators();
        this.stepBegun = false;
        return true;
    }

    /**
     * 모든 운동량과 누적 외력을 제거합니다.
     * 일반적인 키 해제에는 사용하지 않고 lifecycle/명시적 정지에만 사용합니다.
     * @returns {void}
     */
    stop() {
        this.velocity.x = 0;
        this.velocity.y = 0;
        this.#clearAccumulators();
    }

    /**
     * 바디를 비활성화하고 운동 상태를 정리합니다.
     * @returns {void}
     */
    destroy() {
        if (!this.enabled) {
            return;
        }
        this.enabled = false;
        this.stop();
        this.stepBegun = false;
    }

    /**
     * dynamic effect를 받을 수 있는지 반환합니다.
     * @returns {boolean} dynamic 활성 바디 여부입니다.
     * @private
     */
    #canReceiveDynamicEffect() {
        return this.enabled && this.bodyType === PHYSICS_BODY_TYPES.DYNAMIC;
    }

    /**
     * 마찰과 가속도의 해석식을 속도에 적용합니다.
     * @param {number} accelerationX - 합성 X 가속도입니다.
     * @param {number} accelerationY - 합성 Y 가속도입니다.
     * @param {number} delta - 초 단위 fixed delta입니다.
     * @returns {void}
     * @private
     */
    #integrateDynamicVelocity(accelerationX, accelerationY, delta) {
        if (this.linearFriction > 0) {
            const decay = Math.exp(-this.linearFriction * delta);
            const accelerationScale = (1 - decay) / this.linearFriction;
            this.velocity.x = (this.velocity.x * decay) + (accelerationX * accelerationScale);
            this.velocity.y = (this.velocity.y * decay) + (accelerationY * accelerationScale);
        } else {
            this.velocity.x += accelerationX * delta;
            this.velocity.y += accelerationY * delta;
        }

        clampVectorMagnitude(this.velocity, this.maxLinearSpeed);
        if (accelerationX === 0 && accelerationY === 0
            && Math.hypot(this.velocity.x, this.velocity.y) <= this.sleepSpeed) {
            this.velocity.x = 0;
            this.velocity.y = 0;
        }
    }

    /**
     * 연속 effect accumulator를 비웁니다.
     * @returns {void}
     * @private
     */
    #clearAccumulators() {
        this.accelerationAccumulator.x = 0;
        this.accelerationAccumulator.y = 0;
        this.forceAccumulator.x = 0;
        this.forceAccumulator.y = 0;
    }
}
