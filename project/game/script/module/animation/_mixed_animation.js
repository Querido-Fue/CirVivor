import { AnimationBase } from './_animation_base.js';
import { Easing } from './_easing.js';
import { ANIMATION_STATE } from './_constants.js';
import { clampFiniteNumber, lerpNumber } from 'util/number_util.js';

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
     * @param {boolean} [useFixedTick=false] - 고정 틱 업데이트 사용 여부
     */
    init(id, owner, variable, animationDefs, useFixedTick = false) {
        super.init(id, owner, variable, useFixedTick);
        this.animationDefs = animationDefs;

        try {
            const initialValue = this.owner[this.variable];
            this.baseValue = initialValue;

            this.animationDefs.forEach(def => {
                def.currentTime = 0;
                if (typeof def.startValue === 'function') def.startValue = def.startValue(initialValue);
                else if (def.startValue === 'current' || def.startValue === undefined) def.startValue = initialValue;

                if (typeof def.endValue === 'function') def.endValue = def.endValue(initialValue);

                // 이징 함수 미리 바인딩
                def.easingFn = Easing[def.type] || Easing.linear;
            });
        } catch (e) {
            console.error('MixedAnimation 초기화 실패:', e);
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
            const duration = clampFiniteNumber(Number(def.duration), 0, Infinity, 0);
            const delay = clampFiniteNumber(Number(def.delay), 0, Infinity, 0);

            if (def.currentTime >= delay + duration) {
                totalContribution += (def.endValue - def.startValue);
                return;
            }

            allAnimationsFinished = false;
            def.currentTime += delta;

            if (def.currentTime >= delay) {
                const progress = duration > 0
                    ? clampFiniteNumber((def.currentTime - delay) / duration, 0, 1, 1)
                    : 1;
                const easedProgress = def.easingFn(progress);
                const currentValue = lerpNumber(def.startValue, def.endValue, easedProgress);
                totalContribution += (currentValue - def.startValue);
            }
        });

        this.owner[this.variable] = this.baseValue + totalContribution;

        if (allAnimationsFinished) {
            this.complete();
        }
    }
}
