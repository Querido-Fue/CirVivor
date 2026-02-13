import { StandardAnimation } from './standard_animation.js';
import { PersistentAnimation } from './persistent_animation.js';
import { MixedAnimation } from './mixed_animation.js';
import { ANIMATION_STATE } from './constants.js';
import { GLOBAL_CONSTANTS } from '../../data/global/global_constants.js';
import { getDelta } from '../../time_handler.js';

let animationSystemInstance = null;

export class AnimationSystem {
    constructor() {
        animationSystemInstance = this;
        this.idCounter = 0;
        this.animationsById = new Map();
        this.activeAnimations = [];
    }

    async init() {
        await this._warmup();
    }

    /**
     * @private
     * 활성화된 모든 애니메이션을 업데이트합니다.
     * 완료된 애니메이션은 제거하고 풀로 반환합니다.
     */
    _update() {
        const delta = getDelta();

        // 안전한 제거를 위해 역순으로 순회
        for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
            const anim = this.activeAnimations[i];
            anim.update(delta);

            if (anim.state === ANIMATION_STATE.FINISHED) {
                // 활성 목록에서 제거
                // O(1) 제거를 위한 Swap-and-pop (순서는 상관없음)
                const lastIdx = this.activeAnimations.length - 1;
                if (i !== lastIdx) {
                    this.activeAnimations[i] = this.activeAnimations[lastIdx];
                }
                this.activeAnimations.pop();

                // 맵 정리
                this.animationsById.delete(anim.id);

                // 가능하다면 풀로 반환
                if (anim instanceof StandardAnimation) {
                    StandardAnimation.release(anim);
                }
            }
        }
    }

    /**
     * @private
     * 애니메이션 풀을 미리 워밍업합니다.
     */
    async _warmup() {
        // 애니메이션 풀 미리 할당
        for (let i = 0; i < GLOBAL_CONSTANTS.POOL_WARMUP.ANIMATOR; i++) {
            const anim = new StandardAnimation();
            StandardAnimation.release(anim); // 풀에 넣기
        }
    }

    /**
     * 단일 변수에 대한 표준 애니메이션을 생성합니다.
     * @param {object} owner - 애니메이션 대상 객체
     * @param {object} properties - 애니메이션 속성 (variable, startValue, endValue, duration, type 등)
     * @returns {object} { id, promise } 형태의 결과 객체
     */
    animate(owner, properties) {
        if (!this._validateProperties(properties, ['variable'])) {
            return {
                id: -1,
                get promise() { return Promise.resolve(); }
            };
        }

        const id = this.idCounter++;
        const variable = properties.variable;
        const startValue = properties.startValue !== undefined ? properties.startValue : 'current';
        const endValue = properties.endValue !== undefined ? properties.endValue : 'current';
        const type = properties.type || 'linear';
        const duration = properties.duration || 1;
        const delay = properties.delay || 0;

        // 객체 풀 사용
        const animation = StandardAnimation.create();
        animation.init(id, owner, variable, startValue, endValue, type, duration, delay);

        this.activeAnimations.push(animation);
        this.animationsById.set(id, animation);

        return {
            id,
            get promise() { return animation.promise; }
        };
    }

    /**
     * 병렬로 실행되는 혼합 애니메이션을 생성합니다.
     * @param {object} owner - 애니메이션 대상 객체
     * @param {Array} mixedDefs - 애니메이션 정의 배열
     * @returns {object} { id, promise } 형태의 결과 객체
     */
    animateMixed(owner, mixedDefs) {
        const promises = [];

        if (!Array.isArray(mixedDefs)) {
            this.utilities.errorHandler.errThrow(null, 'Animator: mixedDefs must be an array', 'error');
            return { id: null, promise: Promise.resolve() };
        }

        mixedDefs.forEach(def => {

            if (!def.variable || !def.animations) return;

            const subId = this.idCounter++;
            const anim = new MixedAnimation();
            anim.init(subId, owner, def.variable, def.animations);

            this.activeAnimations.push(anim);
            this.animationsById.set(subId, anim);
            promises.push(anim.promise);
        });

        return { id: null, promise: Promise.all(promises) };
    }

    /**
     * 지속적인(Persistent) 애니메이션을 생성합니다.
     * @param {object} owner - 애니메이션 대상 객체
     * @param {object} properties - 애니메이션 속성
     * @returns {number} 애니메이션 ID
     */
    animatePersist(owner, properties) {
        if (!this._validateProperties(properties, ['variable', 'easings', 'duration'])) return -1;

        const id = this.idCounter++;
        const variable = properties.variable;
        const startValue = properties.startValue !== undefined ? properties.startValue : 0;
        const endValue = properties.endValue !== undefined ? properties.endValue : 0;
        const easings = properties.easings;
        const duration = properties.duration;
        const onCompleteAction = properties.onCompleteAction || 'stop';

        const animation = new PersistentAnimation();
        animation.init(id, owner, variable, startValue, endValue, easings, duration, onCompleteAction);

        this.activeAnimations.push(animation);
        this.animationsById.set(id, animation);

        return id;
    }

    _forward(id, duration, speed = 1, cancelOldProgress = false) {
        const anim = this.animationsById.get(id);
        if (anim && anim instanceof PersistentAnimation) {
            anim.trigger('forward', duration, speed, cancelOldProgress);
        }
    }

    _backward(id, duration, speed = 1, cancelOldProgress = false) {
        const anim = this.animationsById.get(id);
        if (anim && anim instanceof PersistentAnimation) {
            anim.trigger('backward', duration, speed, cancelOldProgress);
        }
    }

    remove(id) {
        if (id < 0) return;
        const anim = this.animationsById.get(id);
        if (!anim) return;
        anim.complete();
    }

    /**
     * @private
     * 속성 객체의 필수 필드 존재 여부를 검증합니다.
     * @param {object} properties - 검증할 속성 객체
     * @param {string[]} required - 필수 필드 이름 배열
     * @returns {boolean} 유효성 여부
     */
    _validateProperties(properties, required) {
        if (!properties) {
            this.utilities.errorHandler.errThrow(null, 'Animator: properties object is missing', 'error');
            return false;
        }
        for (const field of required) {
            if (properties[field] === undefined || properties[field] === null || properties[field] === 'error') {
                this.utilities.errorHandler.errThrow(null, `Animator: Missing required property '${field}'`, 'error');
                return false;
            }
        }
        return true;
    }
}

export const animate = (owner, properties) => animationSystemInstance.animate(owner, properties);
export const animateMixed = (owner, mixedDefs) => animationSystemInstance.animateMixed(owner, mixedDefs);
export const animatePersist = (owner, properties) => animationSystemInstance.animatePersist(owner, properties);
export const remove = (id) => animationSystemInstance.remove(id);
