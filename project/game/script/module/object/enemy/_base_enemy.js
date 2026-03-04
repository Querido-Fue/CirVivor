import { getObjectWH } from 'display/display_system.js';
import { getData } from 'data/data_handler.js';

const ENEMY_DRAW_HEIGHT_RATIO = getData('ENEMY_DRAW_HEIGHT_RATIO');
const ENEMY_DEFAULT_WEIGHT = getData('ENEMY_DEFAULT_WEIGHT');
const MAX_ANGULAR_VELOCITY = 720;
const AXIS_RESISTANCE_RECOVERY_SECONDS = 1;
const AXIS_RESISTANCE_RECOVER_DELAY_SECONDS = 0.08;
const AXIS_RESISTANCE_EPSILON = 1e-4;

/**
 * @typedef {Object} EnemyVector2
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} EnemyStatus
 * @property {string|number|null} id
 * @property {string} type
 * @property {number} time
 * @property {number} remainingTime
 * @property {Object.<string, number>} factor
 */

/**
 * @class BaseEnemy
 * @description 적 공통 데이터를 관리하는 기본 클래스입니다.
 * 풀링 재사용을 위해 `init()` / `reset()` / `release()` 흐름을 기준으로 작성되었습니다.
 */
export class BaseEnemy {
    constructor() {
        this.active = false;

        // 풀링 재사용 시 객체 재할당을 줄이기 위해 벡터/상태 객체는 1회 생성 후 재사용합니다.
        /** @type {EnemyVector2} 화면 좌표계 기준 중심점(x, y) */
        this.position = { x: 0, y: 0 };
        /** @type {EnemyVector2} 고정 틱 직전 물리 좌표 */
        this.prevPosition = { x: 0, y: 0 };
        /** @type {EnemyVector2} 렌더 보간 좌표 */
        this.renderPosition = { x: 0, y: 0 };
        /** @type {EnemyVector2} */
        this.speed = { x: 0, y: 0 };
        /** @type {EnemyVector2} */
        this.acc = { x: 0, y: 0 };
        /** @type {EnemyStatus} */
        this.status = {
            id: null,
            type: 'none',
            time: 0,
            remainingTime: 0,
            factor: {}
        };

        this.reset();
    }

    /**
     * 풀에서 꺼낸 뒤 사용할 상태로 초기화합니다.
     * @param {Object} [data={}]
     */
    init(data = {}) {
        this.reset();
        this.active = true;

        this.id = data.id ?? null;
        this.type = data.type ?? 'normal';
        this.maxHp = data.maxHp ?? 0;
        this.hp = data.hp ?? this.maxHp;
        this.atk = data.atk ?? 0;
        this.moveSpeed = data.moveSpeed ?? 0;
        this.accSpeed = data.accSpeed ?? 0;
        this.size = data.size ?? 1;
        this.weight = data.weight ?? 1;
        this.projectileHitsToKill = Number.isFinite(data.projectileHitsToKill)
            ? Math.max(0, Math.floor(data.projectileHitsToKill))
            : 0;
        this.projectileHitCount = 0;
        if (data.weight === undefined || data.weight === null) {
            this.weight = ENEMY_DEFAULT_WEIGHT[this.type] ?? this.weight;
        }


        this.setPosition(data.position?.x ?? 0, data.position?.y ?? 0);
        this.prevPosition.x = this.position.x;
        this.prevPosition.y = this.position.y;
        this.renderPosition.x = this.position.x;
        this.renderPosition.y = this.position.y;
        this.setSpeed(data.speed?.x ?? 0, data.speed?.y ?? 0);
        this.setAcc(data.acc?.x ?? 0, data.acc?.y ?? 0);
        this.setStatus(data.status);
        this.setAI(data.ai ?? null);

        return this;
    }

    /**
     * 풀 반납 전/생성 직후 공통 초기화 상태로 되돌립니다.
     */
    reset() {
        this.active = false;
        this.id = null;
        this.type = 'none';
        this.hp = 0;
        this.maxHp = 0;
        this.atk = 0;
        this.moveSpeed = 0;
        this.accSpeed = 0;
        this.size = 1;
        this.weight = 1;
        this.projectileHitsToKill = 0;
        this.projectileHitCount = 0;
        this.clearAI();
        this.angularVelocity = 0;
        this.angularDeceleration = 0;

        this.position.x = 0;
        this.position.y = 0;
        this.prevPosition.x = 0;
        this.prevPosition.y = 0;
        this.renderPosition.x = 0;
        this.renderPosition.y = 0;
        this.speed.x = 0;
        this.speed.y = 0;
        this.acc.x = 0;
        this.acc.y = 0;
        this.axisResistanceX = 1;
        this.axisResistanceY = 1;
        this.axisResistanceRecoverySeconds = AXIS_RESISTANCE_RECOVERY_SECONDS;
        this.axisResistanceRecoverDelaySeconds = AXIS_RESISTANCE_RECOVER_DELAY_SECONDS;
        this.axisResistanceRecoverHoldX = 0;
        this.axisResistanceRecoverHoldY = 0;
        this.axisResistanceRecoverElapsedX = AXIS_RESISTANCE_RECOVERY_SECONDS;
        this.axisResistanceRecoverElapsedY = AXIS_RESISTANCE_RECOVERY_SECONDS;
        this.axisResistanceRecoverStartX = 1;
        this.axisResistanceRecoverStartY = 1;

        this.clearStatus();
    }

    /**
     * 풀에 반납할 때 호출하기 위한 헬퍼입니다.
     */
    release() {
        this.reset();
    }

    /**
     * 중심점 좌표를 설정합니다.
     * @param {number} x
     * @param {number} y
     */
    setPosition(x, y) {
        this.position.x = x;
        this.position.y = y;
    }

    /**
     * 고정 틱 이동 전에 이전 물리 좌표를 기록합니다.
     */
    beginFixedStep() {
        this.prevPosition.x = this.position.x;
        this.prevPosition.y = this.position.y;
    }

    /**
     * 렌더 프레임에서 물리 좌표를 보간합니다.
     * @param {number} alpha
     */
    interpolatePosition(alpha) {
        const t = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
        this.renderPosition.x = this.prevPosition.x + ((this.position.x - this.prevPosition.x) * t);
        this.renderPosition.y = this.prevPosition.y + ((this.position.y - this.prevPosition.y) * t);
    }

    /**
     * 렌더 좌표를 현재 물리 좌표에 즉시 동기화합니다.
     */
    snapRenderPosition() {
        this.renderPosition.x = this.position.x;
        this.renderPosition.y = this.position.y;
    }

    /**
         * 현재 유지될 속도 벡터를 지정합니다.
         * @param {number} x x축 속도
         * @param {number} y y축 속도
         */
    setSpeed(x, y) {
        this.speed.x = x;
        this.speed.y = y;
    }

    /**
         * 초당 누적될 가속도 벡터를 결정합니다.
         * @param {number} x x축 가속도
         * @param {number} y y축 가속도
         */
    setAcc(x, y) {
        this.acc.x = x;
        this.acc.y = y;
    }

    /**
     * 충돌 저항으로 축별 이동 효율을 낮춥니다. (0~1, 낮을수록 강한 저항)
     * @param {number} [factorX=1]
     * @param {number} [factorY=1]
     */
    applyAxisResistance(factorX = 1, factorY = 1) {
        const fx = Number.isFinite(factorX) ? Math.max(0, Math.min(1, factorX)) : 1;
        const fy = Number.isFinite(factorY) ? Math.max(0, Math.min(1, factorY)) : 1;
        const nextX = Math.min(this.axisResistanceX, fx);
        const nextY = Math.min(this.axisResistanceY, fy);
        const recoverSeconds = Number.isFinite(this.axisResistanceRecoverySeconds) && this.axisResistanceRecoverySeconds > 0
            ? this.axisResistanceRecoverySeconds
            : AXIS_RESISTANCE_RECOVERY_SECONDS;
        const recoverDelay = Number.isFinite(this.axisResistanceRecoverDelaySeconds) && this.axisResistanceRecoverDelaySeconds > 0
            ? this.axisResistanceRecoverDelaySeconds
            : AXIS_RESISTANCE_RECOVER_DELAY_SECONDS;

        if (nextX < (this.axisResistanceX - AXIS_RESISTANCE_EPSILON)) {
            this.axisResistanceX = nextX;
            this.axisResistanceRecoverStartX = nextX;
            this.axisResistanceRecoverElapsedX = 0;
        }
        if (nextY < (this.axisResistanceY - AXIS_RESISTANCE_EPSILON)) {
            this.axisResistanceY = nextY;
            this.axisResistanceRecoverStartY = nextY;
            this.axisResistanceRecoverElapsedY = 0;
        }

        // 충돌 해제 직후 즉시 튀는 복원을 막기 위해 짧은 홀드 타임을 둡니다.
        if (nextX < (1 - AXIS_RESISTANCE_EPSILON)) {
            this.axisResistanceRecoverHoldX = recoverDelay;
            this.axisResistanceRecoverElapsedX = Math.min(this.axisResistanceRecoverElapsedX, recoverSeconds);
        }
        if (nextY < (1 - AXIS_RESISTANCE_EPSILON)) {
            this.axisResistanceRecoverHoldY = recoverDelay;
            this.axisResistanceRecoverElapsedY = Math.min(this.axisResistanceRecoverElapsedY, recoverSeconds);
        }
    }

    /**
     * 축 저항을 서서히 1로 복원합니다.
     * @param {number} delta
     */
    recoverAxisResistance(delta) {
        if (!Number.isFinite(delta) || delta <= 0) return;
        const recoverySeconds = Number.isFinite(this.axisResistanceRecoverySeconds) && this.axisResistanceRecoverySeconds > 0
            ? this.axisResistanceRecoverySeconds
            : AXIS_RESISTANCE_RECOVERY_SECONDS;
        // X 축 복구
        if ((1 - this.axisResistanceX) <= AXIS_RESISTANCE_EPSILON) {
            this.axisResistanceX = 1;
            this.axisResistanceRecoverStartX = 1;
            this.axisResistanceRecoverElapsedX = recoverySeconds;
            this.axisResistanceRecoverHoldX = 0;
        } else if (this.axisResistanceRecoverHoldX > 0) {
            this.axisResistanceRecoverHoldX = Math.max(0, this.axisResistanceRecoverHoldX - delta);
        } else {
            const nextElapsedX = Math.min(recoverySeconds, this.axisResistanceRecoverElapsedX + delta);
            this.axisResistanceRecoverElapsedX = nextElapsedX;
            const tx = recoverySeconds <= AXIS_RESISTANCE_EPSILON ? 1 : (nextElapsedX / recoverySeconds);
            const smoothX = tx * tx * (3 - (2 * tx)); // smoothstep
            const startX = Number.isFinite(this.axisResistanceRecoverStartX) ? this.axisResistanceRecoverStartX : this.axisResistanceX;
            this.axisResistanceX = startX + ((1 - startX) * smoothX);
            if ((1 - this.axisResistanceX) <= AXIS_RESISTANCE_EPSILON || tx >= 1) {
                this.axisResistanceX = 1;
                this.axisResistanceRecoverStartX = 1;
                this.axisResistanceRecoverElapsedX = recoverySeconds;
            }
        }

        // Y 축 복구
        if ((1 - this.axisResistanceY) <= AXIS_RESISTANCE_EPSILON) {
            this.axisResistanceY = 1;
            this.axisResistanceRecoverStartY = 1;
            this.axisResistanceRecoverElapsedY = recoverySeconds;
            this.axisResistanceRecoverHoldY = 0;
        } else if (this.axisResistanceRecoverHoldY > 0) {
            this.axisResistanceRecoverHoldY = Math.max(0, this.axisResistanceRecoverHoldY - delta);
        } else {
            const nextElapsedY = Math.min(recoverySeconds, this.axisResistanceRecoverElapsedY + delta);
            this.axisResistanceRecoverElapsedY = nextElapsedY;
            const ty = recoverySeconds <= AXIS_RESISTANCE_EPSILON ? 1 : (nextElapsedY / recoverySeconds);
            const smoothY = ty * ty * (3 - (2 * ty)); // smoothstep
            const startY = Number.isFinite(this.axisResistanceRecoverStartY) ? this.axisResistanceRecoverStartY : this.axisResistanceY;
            this.axisResistanceY = startY + ((1 - startY) * smoothY);
            if ((1 - this.axisResistanceY) <= AXIS_RESISTANCE_EPSILON || ty >= 1) {
                this.axisResistanceY = 1;
                this.axisResistanceRecoverStartY = 1;
                this.axisResistanceRecoverElapsedY = recoverySeconds;
            }
        }
    }

    /**
     * 적에 사용할 AI를 설정합니다.
     * 표준 인터페이스: `{ fixedUpdate(enemy, delta, context), init?, reset?, resize? }`
     * @param {Object|null|undefined} ai
     */
    setAI(ai) {
        this.clearAI();
        if (!ai) return;

        const hasFixedUpdateHook = typeof ai === 'object'
            && typeof ai.fixedUpdate === 'function';
        if (!hasFixedUpdateHook) return;

        this.ai = ai;
        if (typeof ai.init === 'function') {
            ai.init(this);
        }
    }

    /**
         * 적에게 할당된 AI를 초기화 및 해제합니다.
         */
    clearAI() {
        if (this.ai && typeof this.ai.reset === 'function') {
            this.ai.reset(this);
        }
        this.ai = null;
    }

    /**
         * 고정 틱 기반 AI 훅을 실행하고 결과를 반환합니다.
         * 표준 인터페이스는 `ai.fixedUpdate(enemy, delta, context)`입니다.
         * @param {number} stepDelta
         * @param {Object|null} [context=null]
         * @returns {Object|null}
         */
    runAIFixed(stepDelta, context = null) {
        if (!this.ai) return null;
        if (typeof this.ai.fixedUpdate === 'function') {
            return this.ai.fixedUpdate(this, stepDelta, context) ?? null;
        }
        return null;
    }

    /**
         * 화면 크기 변경 시, AI의 벡터 배율 등을 상황에 맞게 재정렬합니다.
         * @param {Object} context 재정렬 비율 정보
         */
    resizeAI(context) {
        if (!this.ai || typeof this.ai.resize !== 'function') return;
        this.ai.resize(this, context);
    }

    /**
     * 넉백 벡터를 현재 속도에 반영합니다.
     * @param {number} x
     * @param {number} y
     * @returns {EnemyVector2}
     */
    speedFromKnockBack(x, y) {
        const knockBackX = Number.isFinite(x) ? x : 0;
        const knockBackY = Number.isFinite(y) ? y : 0;

        this.speed.x += knockBackX;
        this.speed.y += knockBackY;
        return this.speed;
    }

    /**
     * 투사체 피격 카운트를 누적하고, 임계치 도달 시 비활성화합니다.
     * @returns {boolean} 비활성화 여부
     */
    registerProjectileHit() {
        const threshold = Number.isFinite(this.projectileHitsToKill)
            ? Math.max(0, Math.floor(this.projectileHitsToKill))
            : 0;
        if (threshold <= 0) return false;

        this.projectileHitCount = (Number.isFinite(this.projectileHitCount) ? this.projectileHitCount : 0) + 1;
        if (this.projectileHitCount < threshold) return false;

        this.active = false;
        return true;
    }

    /**
     * 회전 반동(각속도)을 더합니다. 기본 1초 내 0으로 감쇠되도록 선형 감쇠량을 갱신합니다.
     * @param {number} impulse
     * @param {number} [decaySeconds=1]
     */
    addAngularImpulse(impulse, decaySeconds = 1) {
        if (!Number.isFinite(impulse) || impulse === 0) return;

        this.angularVelocity += impulse;
        if (this.angularVelocity > MAX_ANGULAR_VELOCITY) this.angularVelocity = MAX_ANGULAR_VELOCITY;
        if (this.angularVelocity < -MAX_ANGULAR_VELOCITY) this.angularVelocity = -MAX_ANGULAR_VELOCITY;
        const safeDecay = Math.max(0.016, Number.isFinite(decaySeconds) ? decaySeconds : 1);
        this.angularDeceleration = Math.abs(this.angularVelocity) / safeDecay;
    }

    /**
     * 각속도를 회전에 반영하고 감쇠를 적용합니다.
     * @param {number} delta
     */
    updateAngularMotion(delta) {
        if (!Number.isFinite(delta) || delta <= 0) return;
        if (!Number.isFinite(this.angularVelocity) || this.angularVelocity === 0) return;

        if (Number.isFinite(this.rotation)) {
            this.rotation += this.angularVelocity * delta;
        }

        const decel = Math.max(0, Number.isFinite(this.angularDeceleration) ? this.angularDeceleration : 0);
        const step = decel * delta;
        if (step <= 0) return;

        if (Math.abs(this.angularVelocity) <= step) {
            this.angularVelocity = 0;
            this.angularDeceleration = 0;
            return;
        }

        this.angularVelocity -= Math.sign(this.angularVelocity) * step;
    }

    /**
     * size=1일 때 화면 높이의 3%가 됩니다.
     * @returns {number}
     */
    getRenderHeightPx() {
        return getObjectWH() * ENEMY_DRAW_HEIGHT_RATIO * this.size;
    }

    /**
     * 화면 기준으로 적이 제거 범위를 벗어났는지 판정합니다.
     * @param {number} ww
     * @param {number} wh
     * @param {number} [outsideRatio=0]
     * @returns {boolean}
     */
    isOutsideScreen(ww, wh, outsideRatio = 0) {
        const marginX = ww * outsideRatio;
        const marginY = wh * outsideRatio;
        return (
            this.position.x < -marginX ||
            this.position.x > ww + marginX ||
            this.position.y < -marginY ||
            this.position.y > wh + marginY
        );
    }

    /**
         * 적의 내부 상태 이펙트 객체를 적용/덮어씁니다.
         * @param {EnemyStatus|Object|null|undefined} status 새로운 상태(빙결, 발화 등) 정보
         */
    setStatus(status) {
        const nextStatus = status || {};
        this.status.id = nextStatus.id ?? null;
        this.status.type = nextStatus.type ?? 'none';
        this.status.time = nextStatus.time ?? 0;
        this.status.remainingTime = nextStatus.remainingTime ?? this.status.time;
        this.#setStatusFactor(nextStatus.factor);
    }

    /**
         * 적에게 부여된 모든 상태 이상 수치 및 시간을 초기화합니다.
         */
    clearStatus() {
        this.status.id = null;
        this.status.type = 'none';
        this.status.time = 0;
        this.status.remainingTime = 0;
        this.#setStatusFactor({});
    }

    /**
     * @private
     * @param {Object.<string, number>|undefined} factor
     */
    #setStatusFactor(factor) {
        for (const key of Object.keys(this.status.factor)) {
            delete this.status.factor[key];
        }

        if (!factor || typeof factor !== 'object') return;

        for (const [key, value] of Object.entries(factor)) {
            this.status.factor[key] = value;
        }
    }
}
