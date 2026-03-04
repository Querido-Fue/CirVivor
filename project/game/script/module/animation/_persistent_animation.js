import { AnimationBase } from './_animation_base.js';
import { Easing } from './_easing.js';
import { ANIMATION_STATE, OVERFLOW_TYPES } from './_constants.js';

/**
 * @class PersistentAnimation
 * @description 전진/후진 트리거를 큐로 받아 연속적으로 진행되는 지속형 애니메이션입니다.
 */
export class PersistentAnimation extends AnimationBase {
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
        this.easings = [];
        this.totalDuration = 0;
        this.onCompleteAction = 'stop';
        this.progress = 0;
        this.commandQueue = [];
    }

    /**
     * 지속형 애니메이션을 초기화합니다.
     * @param {number} id - 애니메이션 ID
     * @param {object} owner - 대상 객체
     * @param {string} variable - 대상 속성 이름
     * @param {number} startValue - 시작 값
     * @param {number} endValue - 종료 값
     * @param {string|string[]} easings - 사용할 이징 함수 이름 또는 배열
     * @param {number} duration - 전체 지속 시간 (초)
     * @param {string} onCompleteAction - 완료 시 동작 ('stop', 'reset', 'return')
     */
    init(id, owner, variable, startValue, endValue, easings, duration, onCompleteAction) {
        super.init(id, owner, variable);
        this.startValue = startValue;
        this.endValue = endValue;
        this.easings = Array.isArray(easings) ? easings : [easings];
        this.totalDuration = duration;
        this.onCompleteAction = onCompleteAction || 'stop';
        this.progress = 0;
        this.commandQueue = [];
    }

    /**
     * 애니메이션 동작을 트리거합니다.
     * @param {string} direction - 방향 ('forward', 'backward')
     * @param {number} duration - 지속 시간
     * @param {number} speed - 속도 배율
     * @param {boolean} cancelOldProgress - 기존 진행 취소 여부
     */
    trigger(direction, duration, speed, cancelOldProgress) {
        if (cancelOldProgress) this.commandQueue = [];
        this.commandQueue.push({
            direction,
            duration,
            speed,
            isInfinite: duration < 0
        });
    }

    /**
     * 애니메이션을 업데이트합니다.
     * @param {number} delta - 델타 타임
     */
    update(delta) {
        if (this.state !== ANIMATION_STATE.RUNNING) return;

        try {
            if (this.owner[this.variable] === undefined) {
                this.complete();
                return;
            }
        } catch (e) {
            this.complete();
            return;
        }

        let totalProgressDelta = 0;
        for (let i = this.commandQueue.length - 1; i >= 0; i--) {
            const cmd = this.commandQueue[i];
            totalProgressDelta += (cmd.direction === 'forward' ? 1 : -1) * (delta / this.totalDuration) * cmd.speed;
            if (!cmd.isInfinite) {
                cmd.duration -= delta;
                if (cmd.duration <= 0) this.commandQueue.splice(i, 1);
            }
        }

        const wasAtEnd = this.progress >= 1;
        if (totalProgressDelta !== 0) this.progress += totalProgressDelta;
        this.progress = Math.max(0, Math.min(1, this.progress));

        let totalValue = 0;
        this.easings.forEach(type => {
            const easingFn = Easing[type] || Easing.linear;
            const easedProgress = easingFn(this.progress);
            totalValue += this.startValue + (this.endValue - this.startValue) * easedProgress;
        });
        let finalValue = totalValue / this.easings.length;

        const hasOverflow = this.easings.some(e => OVERFLOW_TYPES.includes(e));
        if (!hasOverflow) {
            const min = Math.min(this.startValue, this.endValue);
            const max = Math.max(this.startValue, this.endValue);
            finalValue = Math.max(min, Math.min(max, finalValue));
        }

        this.owner[this.variable] = finalValue;

        if (!wasAtEnd && this.progress >= 1 && this.commandQueue.length === 0) {
            switch (this.onCompleteAction) {
                case 'reset':
                    this.progress = 0;
                    this.owner[this.variable] = this.startValue;
                    break;
                case 'return':
                    this.trigger('backward', this.totalDuration, 1, true);
                    break;
                case 'stop':
                default: break;
            }
        }
    }
}
