import { StandardAnimation, standardAnimationPool } from './_standard_animation.js';
import { PersistentAnimation } from './_persistent_animation.js';
import { MixedAnimation } from './_mixed_animation.js';
import { ANIMATION_STATE } from './_constants.js';
import { GLOBAL_CONSTANTS } from 'data/global/global_constants.js';
import { getDelta, getFixedUpdateDelta } from 'game/time_handler.js';
import { errThrow } from 'debug/debug_system.js';

let animationSystemInstance = null;

/**
 * @class AnimationSystem
 * @description 애니메이션 생성/업데이트/제거와 객체 풀 워밍업을 담당하는 시스템입니다.
 */
export class AnimationSystem {
    constructor() {
        animationSystemInstance = this;
        this.idCounter = 0;
        this.animationsById = new Map();
        this.activeAnimations = [];
    }

    async init() {
    }

    /**
     * 활성화된 모든 애니메이션을 업데이트합니다.
     * 완료된 애니메이션은 제거하고 풀로 반환합니다.
     */
    update() {
        const delta = getDelta();

        // 안전한 제거를 위해 역순으로 순회
        for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
            const anim = this.activeAnimations[i];

            if (anim.fixed) continue;

            anim.update(delta);

            if (anim.state === ANIMATION_STATE.FINISHED) {
                // 활성 목록에서 제거
                // 상수 시간 제거를 위한 끝 요소 치환 방식(순서 비보장)
                const lastIdx = this.activeAnimations.length - 1;
                if (i !== lastIdx) {
                    this.activeAnimations[i] = this.activeAnimations[lastIdx];
                }
                this.activeAnimations.pop();

                // 맵 정리
                this.animationsById.delete(anim.id);

                // 가능하다면 풀로 반환
                if (anim instanceof StandardAnimation) {
                    standardAnimationPool.release(anim);
                }
            }
        }
    }

    /**
     * 모든 애니메이션을 고정 프레임으로 업데이트합니다.
     */
    fixedUpdate() {
        const fixedDelta = getFixedUpdateDelta();

        for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
            const anim = this.activeAnimations[i];

            if (!anim.fixed) continue;

            anim.update(fixedDelta);

            if (anim.state === ANIMATION_STATE.FINISHED) {
                const lastIdx = this.activeAnimations.length - 1;
                if (i !== lastIdx) {
                    this.activeAnimations[i] = this.activeAnimations[lastIdx];
                }
                this.activeAnimations.pop();

                this.animationsById.delete(anim.id);

                if (anim instanceof StandardAnimation) {
                    standardAnimationPool.release(anim);
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
            standardAnimationPool.release(standardAnimationPool.get());
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
        const fixed = properties.fixed || false;

        // 객체 풀 사용
        const animation = standardAnimationPool.get();
        animation.init(id, owner, variable, startValue, endValue, type, duration, delay, fixed);

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
    animateMixed(owner, mixedDefs, properties = {}) {
        const promises = [];
        const fixed = properties.fixed || false;

        if (!Array.isArray(mixedDefs)) {
            errThrow(null, 'Animator: mixedDefs must be an array', 'error');
            return { id: null, promise: Promise.resolve() };
        }

        mixedDefs.forEach(def => {

            if (!def.variable || !def.animations) return;

            const subId = this.idCounter++;
            const anim = new MixedAnimation();
            anim.init(subId, owner, def.variable, def.animations, fixed);

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
        const fixed = properties.fixed || false;

        const animation = new PersistentAnimation();
        animation.init(id, owner, variable, startValue, endValue, easings, duration, onCompleteAction, fixed);

        this.activeAnimations.push(animation);
        this.animationsById.set(id, animation);

        return id;
    }

    /**
     * @private
     * PersistentAnimation을 전진 방향으로 트리거합니다.
     * @param {number} id - 애니메이션 ID
     * @param {number} duration - 지속 시간
     * @param {number} [speed=1] - 속도 배율
     * @param {boolean} [cancelOldProgress=false] - 기존 진행 취소 여부
     */
    _forward(id, duration, speed = 1, cancelOldProgress = false) {
        const anim = this.animationsById.get(id);
        if (anim && anim instanceof PersistentAnimation) {
            anim.trigger('forward', duration, speed, cancelOldProgress);
        }
    }

    /**
     * @private
     * PersistentAnimation을 후진 방향으로 트리거합니다.
     * @param {number} id - 애니메이션 ID
     * @param {number} duration - 지속 시간
     * @param {number} [speed=1] - 속도 배율
     * @param {boolean} [cancelOldProgress=false] - 기존 진행 취소 여부
     */
    _backward(id, duration, speed = 1, cancelOldProgress = false) {
        const anim = this.animationsById.get(id);
        if (anim && anim instanceof PersistentAnimation) {
            anim.trigger('backward', duration, speed, cancelOldProgress);
        }
    }

    /**
     * 특정 ID의 애니메이션을 종료합니다.
     * @param {number} id - 완료할 애니메이션 ID
     */
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

/**
 * 단일 변수에 대한 표준 애니메이션을 실행합니다.
 * @param {object} owner - 애니메이션 대상 객체
 * @param {object} properties - 애니메이션 속성 (variable, startValue, endValue, duration, type 등)
 * @returns {{ id: number, promise: Promise }} 애니메이션 ID와 완료 프로미스
 */
export const animate = (owner, properties) => animationSystemInstance.animate(owner, properties);

/**
 * 여러 변수에 대한 혼합(병렬) 애니메이션을 실행합니다.
 * @param {object} owner - 애니메이션 대상 객체
 * @param {Array} mixedDefs - 각 변수별 애니메이션 정의 배열
 * @returns {{ id: null, promise: Promise }} 전체 완료 프로미스
 */
export const animateMixed = (owner, mixedDefs) => animationSystemInstance.animateMixed(owner, mixedDefs);

/**
 * 지속형 애니메이션을 등록합니다. forward()/backward()로 재생 방향을 제어할 수 있습니다.
 * @param {object} owner - 애니메이션 대상 객체
 * @param {object} properties - 애니메이션 속성
 * @returns {number} 애니메이션 ID
 */
export const animatePersist = (owner, properties) => animationSystemInstance.animatePersist(owner, properties);

/**
 * 특정 ID의 애니메이션을 즉시 제거합니다.
 * @param {number} id - 제거할 애니메이션 ID
 */
export const remove = (id) => animationSystemInstance.remove(id);

