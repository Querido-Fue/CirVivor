import { getWH } from 'display/display_system.js';
import { getData } from 'data/data_handler.js';

const ENEMY_DRAW_HEIGHT_RATIO = getData('ENEMY_DRAW_HEIGHT_RATIO');

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
        this.Weight = data.Weight ?? data.weight ?? 1;


        this.setPosition(data.position?.x ?? 0, data.position?.y ?? 0);
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
        this.Weight = 1;
        this.clearAI();

        this.position.x = 0;
        this.position.y = 0;
        this.speed.x = 0;
        this.speed.y = 0;
        this.acc.x = 0;
        this.acc.y = 0;

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
     * 적에 사용할 AI를 설정합니다.
     * 함수 형태 또는 update 훅을 가진 객체 형태를 지원합니다.
     * @param {Function|Object|null|undefined} ai
     */
    setAI(ai) {
        this.clearAI();
        if (!ai) return;

        const isFunctionAI = typeof ai === 'function';
        const hasUpdateHook = typeof ai === 'object' && typeof ai.update === 'function';
        if (!isFunctionAI && !hasUpdateHook) return;

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
         * 할당된 AI를 한 스텝 실행하고 변경 내역 혹은 반환 상태를 반환합니다.
         * @param {number} stepDelta 매 틱 델타타임 (보정값 적용)
         * @param {Object|null} [context=null] 플레이어 위치 등 환경 컨텍스트 데이터
         * @returns {Object|null} AI 실행 결과 (skipAcceleration 등)
         */
    runAI(stepDelta, context = null) {
        if (!this.ai) return null;
        if (typeof this.ai === 'function') {
            return this.ai(this, stepDelta, context) ?? null;
        }
        if (typeof this.ai.update === 'function') {
            return this.ai.update(this, stepDelta, context) ?? null;
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
     * Weight는 충돌 판정 단계(밀림/저항 계산)에서 별도로 사용합니다.
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
     * size=1일 때 화면 높이의 3%가 됩니다.
     * @returns {number}
     */
    getRenderHeightPx() {
        return getWH() * ENEMY_DRAW_HEIGHT_RATIO * this.size;
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
        this._setStatusFactor(nextStatus.factor);
    }

    /**
         * 적에게 부여된 모든 상태 이상 수치 및 시간을 초기화합니다.
         */
    clearStatus() {
        this.status.id = null;
        this.status.type = 'none';
        this.status.time = 0;
        this.status.remainingTime = 0;
        this._setStatusFactor({});
    }

    /**
     * @private
     * @param {Object.<string, number>|undefined} factor
     */
    _setStatusFactor(factor) {
        for (const key of Object.keys(this.status.factor)) {
            delete this.status.factor[key];
        }

        if (!factor || typeof factor !== 'object') return;

        for (const [key, value] of Object.entries(factor)) {
            this.status.factor[key] = value;
        }
    }
}
