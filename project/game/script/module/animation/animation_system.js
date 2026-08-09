import { StandardAnimation, standardAnimationPool } from './_standard_animation.js';
import { PersistentAnimation } from './_persistent_animation.js';
import { MixedAnimation } from './_mixed_animation.js';
import {
    ANIMATION_CATEGORY,
    ANIMATION_STATE,
    isAnimationCategory
} from './_constants.js';
import { getDelta, getFixedDelta } from 'game/time_handler.js';
import { errThrow } from 'debug/debug_system.js';
import { clampFiniteNumber } from 'util/number_util.js';

const ANIMATOR_POOL_WARMUP_COUNT = 500;
const DEFAULT_UI_ANIMATION_DURATION_SCALE = 1;
const MIN_UI_ANIMATION_DURATION_SCALE = 0.1;
const MAX_UI_ANIMATION_DURATION_SCALE = 4;

let animationSystemInstance = null;

/**
 * 풀 객체 재사용과 분리된 표준 애니메이션 핸들을 생성합니다.
 * @param {AnimationSystem} system - 애니메이션을 소유한 시스템입니다.
 * @param {number} id - 애니메이션 ID입니다.
 * @param {StandardAnimation} animation - 생성 시점의 표준 애니메이션입니다.
 * @returns {{id:number,promise:Promise,retarget:(properties:object,speedEasing?:boolean)=>boolean,remove:()=>void,isActive:()=>boolean}} 안전한 핸들입니다.
 */
function createStandardAnimationHandle(system, id, animation) {
    let cachedPromise = null;
    return Object.freeze({
        id,
        get promise() {
            if (!cachedPromise) {
                cachedPromise = system.animationsById.get(id) === animation
                    ? animation.promise
                    : Promise.resolve();
            }
            return cachedPromise;
        },
        retarget(properties, speedEasing = false) {
            return system.retarget(id, properties, speedEasing);
        },
        remove() {
            return system.remove(id);
        },
        isActive() {
            return system.animationsById.get(id) === animation
                && animation.state === ANIMATION_STATE.RUNNING;
        }
    });
}

/**
 * 검증 실패 시 사용하는 무동작 애니메이션 핸들입니다.
 */
const INVALID_ANIMATION_HANDLE = Object.freeze({
    id: -1,
    get promise() {
        return Promise.resolve();
    },
    retarget() {
        return false;
    },
    remove() {
    },
    isActive() {
        return false;
    }
});

/**
 * @class AnimationSystem
 * @description 애니메이션 생성/업데이트/제거와 객체 풀 워밍업을 담당하는 시스템입니다.
 */
export class AnimationSystem {
    #getUiAnimationDurationScale;
    #resolvedUiAnimationDurationScale;

    /**
     * @param {object} [options={}] - 애니메이션 런타임 의존성입니다.
     * @param {()=>number} [options.getUiAnimationDurationScale] - 현재 UI duration scale resolver입니다.
     */
    constructor(options = {}) {
        animationSystemInstance = this;
        this.idCounter = 0;
        this.animationsById = new Map();
        this.activeAnimations = [];
        this.#getUiAnimationDurationScale = typeof options?.getUiAnimationDurationScale === 'function'
            ? options.getUiAnimationDurationScale
            : null;
        this.#resolvedUiAnimationDurationScale = DEFAULT_UI_ANIMATION_DURATION_SCALE;
    }

    async init() {
    }

    /**
     * 활성화된 모든 애니메이션을 업데이트합니다.
     * 완료된 애니메이션은 제거하고 풀로 반환합니다.
     * @param {object} [options={}] - 업데이트 옵션
     * @param {boolean} [options.useFixedTick=false] - 고정 틱 업데이트 모드 여부
     * @param {number} [options.delta] - 외부에서 주입하는 델타(초)
     * UI category만 같은 update에서 한 번 해석한 duration scale로 base delta를 나눕니다.
     */
    update(options = {}) {
        const useFixedTick = options.useFixedTick === true;
        const baseDelta = this.#resolveUpdateDelta(options.delta, useFixedTick);
        const uiAnimationDurationScale = this.#resolveUiAnimationDurationScale();
        this.#resolvedUiAnimationDurationScale = uiAnimationDurationScale;
        const uiDelta = baseDelta / uiAnimationDurationScale;

        // 안전한 제거를 위해 역순으로 순회
        for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
            const anim = this.activeAnimations[i];

            if (anim.state === ANIMATION_STATE.FINISHED) {
                this.#removeAnimationAtIndex(i, anim);
                continue;
            }

            if ((anim.useFixedTick === true) !== useFixedTick) {
                continue;
            }

            if (baseDelta <= 0) {
                continue;
            }

            const animationDelta = anim.animationCategory === ANIMATION_CATEGORY.UI
                ? uiDelta
                : baseDelta;
            anim.update(animationDelta);

            if (anim.state === ANIMATION_STATE.FINISHED) {
                this.#removeAnimationAtIndex(i, anim);
            }
        }
    }

    /**
     * 애니메이션 풀을 미리 워밍업합니다.
     */
    async warmup() {
        // 애니메이션 풀 미리 할당
        for (let i = 0; i < ANIMATOR_POOL_WARMUP_COUNT; i++) {
            standardAnimationPool.release(standardAnimationPool.get());
        }
    }

    /**
     * 단일 변수에 대한 표준 애니메이션을 생성합니다.
     * @param {object} owner - 애니메이션 대상 객체
     * @param {object} properties - animationCategory와 variable을 포함하는 애니메이션 속성입니다.
     * @returns {{id:number,promise:Promise,retarget:(properties:object,speedEasing?:boolean)=>boolean,remove:()=>void,isActive:()=>boolean}} 풀 객체와 분리된 표준 animation handle입니다.
     */
    animate(owner, properties) {
        if (!this.#validateProperties(properties, ['variable'])
            || !this.#validateAnimationCategory(properties.animationCategory)) {
            return INVALID_ANIMATION_HANDLE;
        }

        const id = this.idCounter++;
        const variable = properties.variable;
        const startValue = properties.startValue !== undefined ? properties.startValue : 'current';
        const endValue = properties.endValue !== undefined ? properties.endValue : 'current';
        const type = properties.type || 'linear';
        const duration = properties.duration !== undefined
            ? clampFiniteNumber(Number(properties.duration), 0, Infinity, 1)
            : 1;
        const delay = properties.delay !== undefined
            ? clampFiniteNumber(Number(properties.delay), 0, Infinity, 0)
            : 0;
        const animationCategory = properties.animationCategory;
        const useFixedTick = properties.useFixedTick === true;

        // 객체 풀 사용
        const animation = standardAnimationPool.get();
        animation.init(
            id,
            owner,
            variable,
            animationCategory,
            startValue,
            endValue,
            type,
            duration,
            delay,
            useFixedTick
        );

        this.activeAnimations.push(animation);
        this.animationsById.set(id, animation);

        return createStandardAnimationHandle(this, id, animation);
    }

    /**
     * 실행 중인 StandardAnimation을 현재 표시값에서 새 목표로 재지정합니다.
     * 같은 ID와 완료 Promise를 유지하며 완료·제거 대기 상태나 다른 animation 종류는 거부합니다.
     * @param {number} id - 재지정할 표준 애니메이션 ID입니다.
     * @param {object} properties - endValue와 선택적인 duration, delay, type, 기존과 같은 animationCategory입니다.
     * @param {boolean} [speedEasing=false] - 직전 순간 속도를 유지하는 Hermite 보간을 사용할지 여부입니다.
     * @returns {boolean} 재지정 성공 여부입니다.
     */
    retarget(id, properties, speedEasing = false) {
        if (!Number.isInteger(id) || id < 0
            || !this.#validateProperties(properties, ['endValue'])) {
            return false;
        }
        const animation = this.animationsById.get(id);
        if (!(animation instanceof StandardAnimation)
            || animation.state !== ANIMATION_STATE.RUNNING) {
            return false;
        }
        if (Object.prototype.hasOwnProperty.call(properties, 'animationCategory')
            && (!this.#validateAnimationCategory(properties.animationCategory)
                || properties.animationCategory !== animation.animationCategory)) {
            return false;
        }

        const duration = properties.duration !== undefined
            ? clampFiniteNumber(
                Number(properties.duration),
                0,
                Infinity,
                animation.duration
            )
            : animation.duration;
        const delay = properties.delay !== undefined
            ? clampFiniteNumber(Number(properties.delay), 0, Infinity, 0)
            : 0;
        return animation.retarget(
            {
                endValue: properties.endValue,
                duration,
                delay,
                type: properties.type
            },
            speedEasing === true
        );
    }

    /**
     * 병렬로 실행되는 혼합 애니메이션을 생성합니다.
     * @param {object} owner - 애니메이션 대상 객체
     * @param {Array} mixedDefs - 애니메이션 정의 배열
     * @param {object} properties - 필수 animationCategory와 공통 속성입니다.
     * @param {boolean} [properties.useFixedTick=false] - 고정 틱 업데이트 사용 여부
     * @returns {{id:null, ids:number[], promise:Promise}} 생성된 하위 ID와 완료 Promise입니다.
     */
    animateMixed(owner, mixedDefs, properties = {}) {
        const promises = [];
        const ids = [];
        if (!properties
            || !this.#validateAnimationCategory(properties.animationCategory)) {
            return { id: null, ids, promise: Promise.resolve() };
        }
        const animationCategory = properties.animationCategory;
        const useFixedTick = properties.useFixedTick === true;

        if (!Array.isArray(mixedDefs)) {
            errThrow(null, 'Animator: mixedDefs 는 배열이어야 합니다', 'error');
            return { id: null, ids, promise: Promise.resolve() };
        }

        mixedDefs.forEach(def => {

            if (!def.variable || !def.animations) return;

            const subId = this.idCounter++;
            const anim = new MixedAnimation();
            anim.init(
                subId,
                owner,
                def.variable,
                animationCategory,
                def.animations,
                useFixedTick
            );

            this.activeAnimations.push(anim);
            this.animationsById.set(subId, anim);
            ids.push(subId);
            promises.push(anim.promise);
        });

        return { id: null, ids, promise: Promise.all(promises) };
    }

    /**
     * 지속적인(Persistent) 애니메이션을 생성합니다.
     * @param {object} owner - 애니메이션 대상 객체
     * @param {object} properties - animationCategory를 포함하는 애니메이션 속성입니다.
     * @param {boolean} [properties.useFixedTick=false] - 고정 틱 업데이트 사용 여부
     * @returns {number} 애니메이션 ID
     */
    animatePersist(owner, properties) {
        if (!this.#validateProperties(properties, ['variable', 'easings', 'duration'])
            || !this.#validateAnimationCategory(properties.animationCategory)) return -1;

        const id = this.idCounter++;
        const variable = properties.variable;
        const startValue = properties.startValue !== undefined ? properties.startValue : 0;
        const endValue = properties.endValue !== undefined ? properties.endValue : 0;
        const easings = properties.easings;
        const duration = properties.duration;
        const onCompleteAction = properties.onCompleteAction || 'stop';
        const animationCategory = properties.animationCategory;
        const useFixedTick = properties.useFixedTick === true;

        const animation = new PersistentAnimation();
        animation.init(
            id,
            owner,
            variable,
            animationCategory,
            startValue,
            endValue,
            easings,
            duration,
            onCompleteAction,
            useFixedTick
        );

        this.activeAnimations.push(animation);
        this.animationsById.set(id, animation);

        return id;
    }

    /**
     * PersistentAnimation을 전진 방향으로 트리거합니다.
     * @param {number} id - 애니메이션 ID
     * @param {number} duration - 지속 시간
     * @param {number} [speed=1] - 속도 배율
     * @param {boolean} [cancelOldProgress=false] - 기존 진행 취소 여부
     */
    forward(id, duration, speed = 1, cancelOldProgress = false) {
        const anim = this.animationsById.get(id);
        if (anim && anim instanceof PersistentAnimation) {
            anim.trigger('forward', duration, speed, cancelOldProgress);
        }
    }

    /**
     * PersistentAnimation을 후진 방향으로 트리거합니다.
     * @param {number} id - 애니메이션 ID
     * @param {number} duration - 지속 시간
     * @param {number} [speed=1] - 속도 배율
     * @param {boolean} [cancelOldProgress=false] - 기존 진행 취소 여부
     */
    backward(id, duration, speed = 1, cancelOldProgress = false) {
        const anim = this.animationsById.get(id);
        if (anim && anim instanceof PersistentAnimation) {
            anim.trigger('backward', duration, speed, cancelOldProgress);
        }
    }

    /**
     * 특정 ID의 등록된 애니메이션을 완료 상태로 전환합니다.
     * `complete()`를 동기 호출하므로 이미 획득한 완료 Promise는 해결되지만 반응 콜백은 마이크로태스크에서 실행됩니다.
     * 소유 속성을 endValue로 강제하지 않으며 Map·activeAnimations 정리와 표준 애니메이션 풀 반환도 즉시 수행하지 않습니다.
     * 정리는 delta 해석에 성공해 애니메이션 순회에 도달한 현재 또는 다음 `update()`에서 수행됩니다.
     * `update()`가 호출되지 않거나 순회 전에 예외가 발생하면 등록과 풀 반환은 보류됩니다.
     * @param {*} id - `id < 0` 비교를 통과한 뒤 `Map`의 exact key로 조회할 애니메이션 ID입니다.
     * @returns {void}
     * @throws {*} ID 비교, ID `Map` 접근·조회, `complete` 접근·호출 예외를 그대로 전파합니다.
     */
    remove(id) {
        if (id < 0) return;
        const anim = this.animationsById.get(id);
        if (!anim) return;
        anim.complete();
    }

    /**
     * @private
     * 활성 애니메이션 목록에서 지정 인덱스의 애니메이션을 제거합니다.
     * @param {number} index - 제거할 활성 목록 인덱스
     * @param {StandardAnimation|PersistentAnimation|MixedAnimation} anim - 제거 대상 애니메이션
     */
    #removeAnimationAtIndex(index, anim) {
        // 활성 목록에서 제거
        // 상수 시간 제거를 위한 끝 요소 치환 방식(순서 비보장)
        const lastIdx = this.activeAnimations.length - 1;
        if (index !== lastIdx) {
            this.activeAnimations[index] = this.activeAnimations[lastIdx];
        }
        this.activeAnimations.pop();

        // 맵 정리
        this.animationsById.delete(anim.id);

        // 가능하다면 풀로 반환
        if (anim instanceof StandardAnimation) {
            standardAnimationPool.release(anim);
        }
    }

    /**
     * @private
     * 속성 객체의 필수 필드 존재 여부를 검증합니다.
     * @param {object} properties - 검증할 속성 객체
     * @param {string[]} required - 필수 필드 이름 배열
     * @returns {boolean} 유효성 여부
     */
    #validateProperties(properties, required) {
        if (!properties) {
            errThrow(null, 'Animator: properties 객체가 없습니다', 'error');
            return false;
        }
        for (const field of required) {
            if (properties[field] === undefined || properties[field] === null || properties[field] === 'error') {
                errThrow(null, `Animator: 필수 속성 '${field}'이(가) 없습니다`, 'error');
                return false;
            }
        }
        return true;
    }

    /**
     * 애니메이션 생성 또는 retarget 요청의 카테고리를 검증합니다.
     * @param {*} animationCategory - 검증할 카테고리 ID입니다.
     * @returns {boolean} 지원되는 카테고리이면 true입니다.
     * @private
     */
    #validateAnimationCategory(animationCategory) {
        return isAnimationCategory(animationCategory);
    }

    /**
     * 주입된 델타 또는 현재 프레임 델타를 애니메이션 갱신에 사용할 값으로 정규화합니다.
     * @param {number|undefined} injectedDelta - 외부에서 주입한 델타입니다.
     * @param {boolean} useFixedTick - 고정 틱 델타 사용 여부입니다.
     * @returns {number} 0 이상의 유한 델타입니다.
     * @private
     */
    #resolveUpdateDelta(injectedDelta, useFixedTick) {
        const safeInjectedDelta = clampFiniteNumber(injectedDelta, 0, Infinity, 0);
        if (safeInjectedDelta > 0) {
            return safeInjectedDelta;
        }

        const frameDelta = useFixedTick ? getFixedDelta() : getDelta();
        return clampFiniteNumber(frameDelta, 0, Infinity, 0);
    }

    /**
     * 현재 UI duration scale을 한 번 읽어 안전한 런타임 범위로 정규화합니다.
     * @returns {number} 0.1 이상 4 이하의 UI duration scale입니다.
     * @private
     */
    #resolveUiAnimationDurationScale() {
        if (!this.#getUiAnimationDurationScale) {
            return DEFAULT_UI_ANIMATION_DURATION_SCALE;
        }

        let scale;
        try {
            scale = this.#getUiAnimationDurationScale();
        } catch (error) {
            return DEFAULT_UI_ANIMATION_DURATION_SCALE;
        }

        if (typeof scale !== 'number' || !Number.isFinite(scale)) {
            return DEFAULT_UI_ANIMATION_DURATION_SCALE;
        }
        return Math.min(
            MAX_UI_ANIMATION_DURATION_SCALE,
            Math.max(MIN_UI_ANIMATION_DURATION_SCALE, scale)
        );
    }

    /**
     * 마지막 update에서 해석한 UI duration scale을 반환합니다.
     * @returns {number} 안전한 UI duration scale입니다.
     */
    getResolvedUiAnimationDurationScale() {
        return this.#resolvedUiAnimationDurationScale;
    }
}

export { ANIMATION_CATEGORY };

/**
 * 단일 변수에 대한 표준 애니메이션을 실행합니다.
 * @param {object} owner - 애니메이션 대상 객체
 * @param {object} properties - animationCategory와 variable을 포함하는 애니메이션 속성입니다.
 * @returns {{id:number,promise:Promise,retarget:(properties:object,speedEasing?:boolean)=>boolean,remove:()=>void,isActive:()=>boolean}} 풀 객체와 분리된 표준 animation handle입니다.
 */
export const animate = (owner, properties) => animationSystemInstance.animate(owner, properties);

/**
 * 가장 최근 AnimationSystem의 실행 중인 표준 애니메이션을 현재 값에서 새 목표로 재지정합니다.
 * @param {number} id - 표준 애니메이션 ID입니다.
 * @param {object} properties - endValue와 선택적인 duration, delay, type, 기존과 같은 animationCategory입니다.
 * @param {boolean} [speedEasing=false] - 직전 순간 속도를 유지하는 Hermite 보간을 사용할지 여부입니다.
 * @returns {boolean} 재지정 성공 여부입니다.
 */
export const retarget = (id, properties, speedEasing = false) => (
    animationSystemInstance.retarget(id, properties, speedEasing)
);

/**
 * 여러 변수에 대한 혼합(병렬) 애니메이션을 실행합니다.
 * @param {object} owner - 애니메이션 대상 객체
 * @param {Array} mixedDefs - 각 변수별 애니메이션 정의 배열
 * @param {object} properties - 필수 animationCategory와 공통 애니메이션 속성입니다.
 * @returns {{id:null, ids:number[], promise:Promise}} 하위 애니메이션 ID와 전체 완료 Promise입니다.
 */
export const animateMixed = (owner, mixedDefs, properties = {}) => animationSystemInstance.animateMixed(owner, mixedDefs, properties);

/**
 * 지속형 애니메이션을 등록합니다. forward()/backward()로 재생 방향을 제어할 수 있습니다.
 * @param {object} owner - 애니메이션 대상 객체
 * @param {object} properties - animationCategory를 포함하는 애니메이션 속성입니다.
 * @returns {number} 애니메이션 ID
 */
export const animatePersist = (owner, properties) => animationSystemInstance.animatePersist(owner, properties);

/**
 * 가장 최근에 생성된 AnimationSystem의 애니메이션을 완료 처리해 후속 `update()` 순회의 정리 대상으로 만듭니다.
 * AnimationSystem 생성 전 호출하면 인스턴스 접근에서 TypeError가 발생합니다.
 * @param {*} id - 시스템 메서드의 비교·exact key 조회에 전달할 애니메이션 ID입니다.
 * @returns {*} 정상 AnimationSystem 구현에서는 `undefined`이며 교체된 `remove` 메서드의 반환값을 그대로 전달합니다.
 * @throws {*} 인스턴스·메서드 접근이나 시스템 메서드 호출 예외를 그대로 전파합니다.
 */
export const remove = (id) => animationSystemInstance.remove(id);

/**
 * PersistentAnimation을 전진 방향으로 트리거합니다.
 * @param {number} id - 애니메이션 ID
 * @param {number} duration - 지속 시간
 * @param {number} [speed=1] - 속도 배율
 * @param {boolean} [cancelOldProgress=false] - 기존 진행 취소 여부
 * @returns {void}
 */
export const forward = (id, duration, speed = 1, cancelOldProgress = false) => animationSystemInstance.forward(id, duration, speed, cancelOldProgress);

/**
 * PersistentAnimation을 후진 방향으로 트리거합니다.
 * @param {number} id - 애니메이션 ID
 * @param {number} duration - 지속 시간
 * @param {number} [speed=1] - 속도 배율
 * @param {boolean} [cancelOldProgress=false] - 기존 진행 취소 여부
 * @returns {void}
 */
export const backward = (id, duration, speed = 1, cancelOldProgress = false) => animationSystemInstance.backward(id, duration, speed, cancelOldProgress);

/**
 * 가장 최근 AnimationSystem update가 해석한 UI duration scale을 반환합니다.
 * AnimationSystem 생성 전에는 authored duration과 같은 1을 반환합니다.
 * @returns {number} 안전한 UI duration scale입니다.
 */
export const getResolvedUiAnimationDurationScale = () => (
    animationSystemInstance?.getResolvedUiAnimationDurationScale()
    ?? DEFAULT_UI_ANIMATION_DURATION_SCALE
);
