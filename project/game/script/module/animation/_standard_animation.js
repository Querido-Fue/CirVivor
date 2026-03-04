import { AnimationBase } from './_animation_base.js';
import { Easing } from './_easing.js';
import { ANIMATION_STATE } from './_constants.js';
import { ObjectPool } from 'object/_object_pool.js';

/**
 * @class StandardAnimation
 * @description 단일 속성의 시작값~종료값 보간을 수행하는 기본 애니메이션입니다.
 */
export class StandardAnimation extends AnimationBase {
    constructor() {
        super();
        this.reset();
    }

    /**
     * 애니메이션 상태를 초기화합니다.
     */
    reset() {
        this.startValue = 0;
        this.endValue = 0;
        this.rawStartValue = null;
        this.rawEndValue = null;
        this.startTime = 0;
        this.duration = 0;
        this.delay = 0;
        this.currentTime = 0;
        this.easingFn = Easing.linear;
        this.isInitialized = false;
    }

    /**
     * 표준 애니메이션을 초기화합니다.
     * @param {number} id - 애니메이션 ID
     * @param {object} owner - 대상 객체
     * @param {string} variable - 대상 속성 이름
     * @param {number|string|Function} startValue - 시작 값 (숫자, 'current', 또는 함수)
     * @param {number|string|Function} endValue - 종료 값
     * @param {string} type - 이징 함수 이름
     * @param {number} duration - 지속 시간 (초)
     * @param {number} delay - 시작 지연 (초)
     */
    init(id, owner, variable, startValue, endValue, type, duration, delay) {
        super.init(id, owner, variable);
        this.rawStartValue = startValue;
        this.rawEndValue = endValue;
        this.duration = duration;
        this.delay = delay || 0;
        this.currentTime = 0;
        this.easingFn = Easing[type] || Easing.linear;
        this.isInitialized = false;
    }

    /**
     * 애니메이션을 업데이트합니다.
     * @param {number} delta - 델타 타임
     */
    update(delta) {
        if (this.state !== ANIMATION_STATE.RUNNING) return;

        if (this.delay > 0) {
            this.delay -= delta;
            return;
        }

        if (!this.isInitialized) {
            this.#initializeValues();
            if (this.state === ANIMATION_STATE.FINISHED) return;
        }

        if (this.currentTime < this.duration) {
            this.currentTime += delta;
            const progress = Math.min(this.currentTime / this.duration, 1);
            this.owner[this.variable] = this.startValue + (this.endValue - this.startValue) * this.easingFn(progress);
        } else {
            this.owner[this.variable] = this.endValue;
            this.complete();
        }
    }

    /**
     * @private
     * 시작 및 종료 값을 초기화합니다.
     */
    #initializeValues() {
        try {
            const initialValue = this.owner[this.variable];
            this.startValue = this.#evaluate(this.rawStartValue, initialValue);
            this.endValue = this.#evaluate(this.rawEndValue, initialValue);
            this.isInitialized = true;
        } catch (e) {
            console.error("애니메이션 초기화 실패:", e);
            this.complete();
        }
    }

    /**
     * @private
     * 값을 평가합니다. (함수 또는 'current' 키워드 처리)
     */
    #evaluate(value, initialValue) {
        if (typeof value === 'function') return value(initialValue);
        if (value === 'current') return initialValue;
        return value;
    }
}

/**
 * StandardAnimation 전용 오브젝트 풀
 * @type {ObjectPool<StandardAnimation>}
 */
export const standardAnimationPool = new ObjectPool(
    () => new StandardAnimation(),
    (anim) => anim.reset(),
    "StandardAnimation"
);
