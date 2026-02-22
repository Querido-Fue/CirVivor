import { AnimationBase } from './animation_base.js';
import { Easing } from './easing.js';
import { ANIMATION_STATE } from './constants.js';

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
     */
    init(id, owner, variable, startValue, endValue, type, duration, delay, fixed) {
        super.init(id, owner, variable, fixed);
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
            this._initializeValues();
            if (this.state === ANIMATION_STATE.FINISHED) return; // 초기화 중 오류 발생 시
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
    _initializeValues() {
        try {
            const initialValue = this.owner[this.variable];
            this.startValue = this._evaluate(this.rawStartValue, initialValue);
            this.endValue = this._evaluate(this.rawEndValue, initialValue);
            this.isInitialized = true;
        } catch (e) {
            console.error("Animation initialization failed:", e);
            this.complete();
        }
    }

    /**
     * @private
     * 값을 평가합니다. (함수 또는 'current' 키워드 처리)
     */
    _evaluate(value, initialValue) {
        if (typeof value === 'function') return value(initialValue);
        if (value === 'current') return initialValue;
        return value;
    }

    // 풀링 로직
    static pool = [];

    /**
     * 풀에서 표준 애니메이션 객체를 생성하거나 가져옵니다.
     * @returns {StandardAnimation} 애니메이션 객체
     */
    static create() {
        if (this.pool.length > 0) {
            return this.pool.pop();
        }
        return new StandardAnimation();
    }

    /**
     * 표준 애니메이션 객체를 풀에 반환합니다.
     * @param {StandardAnimation} anim - 반환할 애니메이션 객체
     */
    static release(anim) {
        anim.reset();
        this.pool.push(anim);
    }
}
