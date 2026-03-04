import { AnimationBase } from './_animation_base.js';
import { Easing } from './_easing.js';
import { ANIMATION_STATE } from './_constants.js';

/**
 * @class MixedAnimation
 * @description 하나의 속성에 여러 보간 정의를 합산해 병렬 애니메이션 효과를 만듭니다.
 */
export class MixedAnimation extends AnimationBase {
    constructor() {
        super();
        this.reset();
    }

    /**
     * 애니메이션 상태를 초기화합니다.
     */
    reset() {
        this.animationDefs = [];
        this.baseValue = 0;
    }

    /**
     * 혼합 애니메이션을 초기화합니다.
     * @param {number} id - 애니메이션 ID
     * @param {object} owner - 대상 객체
     * @param {string} variable - 대상 속성 이름
     * @param {Array} animationDefs - 애니메이션 정의 배열
     */
    init(id, owner, variable, animationDefs) {
        super.init(id, owner, variable);
        this.animationDefs = animationDefs;

        try {
            const initialValue = this.owner[this.variable];
            this.baseValue = initialValue;

            this.animationDefs.forEach(def => {
                def.currentTime = 0;
                if (typeof def.startValue === 'function') def.startValue = def.startValue(initialValue);
                else if (def.startValue === 'current' || def.startValue === undefined) def.startValue = initialValue;

                if (typeof def.endValue === 'function') def.endValue = def.endValue(initialValue);

                // 이징 함수 미리 정의
                def.easingFn = Easing[def.type] || Easing.linear;
            });
        } catch (e) {
            console.error("MixedAnimation initialization failed:", e);
            this.complete();
        }
    }

    /**
     * 애니메이션을 업데이트합니다.
     * @param {number} delta - 델타 타임
     */
    update(delta) {
        if (this.state !== ANIMATION_STATE.RUNNING) return;

        let totalContribution = 0;
        let allAnimationsFinished = true;

        this.animationDefs.forEach(def => {
            const duration = def.duration || 0;
            const delay = def.delay || 0;

            if (def.currentTime >= delay + duration) {
                totalContribution += (def.endValue - def.startValue);
                return;
            }

            allAnimationsFinished = false;
            def.currentTime += delta;

            if (def.currentTime >= delay) {
                const progress = Math.min((def.currentTime - delay) / duration, 1);
                const easedProgress = def.easingFn(progress);
                const currentValue = def.startValue + (def.endValue - def.startValue) * easedProgress;
                totalContribution += (currentValue - def.startValue);
            }
        });

        this.owner[this.variable] = this.baseValue + totalContribution;

        if (allAnimationsFinished) {
            this.complete();
        }
    }
}
