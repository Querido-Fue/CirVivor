import { ANIMATION_STATE, isAnimationCategory } from './_constants.js';

/**
 * @class AnimationBase
 * @description 모든 애니메이션 구현체가 공유하는 공통 상태와 생명주기 인터페이스를 정의합니다.
 */
export class AnimationBase {
    #animationCategory;
    #promise;
    #resolve;

    constructor() {
        this.id = -1;
        this.owner = null;
        this.variable = null;
        this.#animationCategory = null;
        this.useFixedTick = false;
        this.state = ANIMATION_STATE.IDLE;
        this.#promise = null;
        this.#resolve = null;

        this.next = null;
        this.prev = null;
    }

    /**
     * 애니메이션을 초기화합니다.
     * @param {number} id - 애니메이션 ID
     * @param {object} owner - 대상 객체
     * @param {string} variable - 대상 속성 이름
     * @param {string} animationCategory - 애니메이션 시간 축 카테고리입니다.
     * @param {boolean} [useFixedTick=false] - 고정 틱 업데이트 사용 여부
     */
    init(id, owner, variable, animationCategory, useFixedTick = false) {
        if (!isAnimationCategory(animationCategory)) {
            throw new TypeError(`지원하지 않는 animationCategory입니다: ${String(animationCategory)}`);
        }
        this.id = id;
        this.owner = owner;
        this.variable = variable;
        this.#animationCategory = animationCategory;
        this.useFixedTick = useFixedTick === true;
        this.state = ANIMATION_STATE.RUNNING;
        this.next = null;
        this.prev = null;

        // 재초기화를 위해 내부 프로미스/resolve 참조 초기화
        this.#promise = null;
        this.#resolve = null;
    }

    /**
     * 풀 재사용 전에 공통 상태와 완료 Promise 참조를 초기화합니다.
     * @returns {void}
     */
    reset() {
        this.id = -1;
        this.owner = null;
        this.variable = null;
        this.#animationCategory = null;
        this.useFixedTick = false;
        this.state = ANIMATION_STATE.IDLE;
        this.#promise = null;
        this.#resolve = null;
        this.next = null;
        this.prev = null;
    }

    /**
     * 애니메이션 생성 시 고정된 시간 축 카테고리를 반환합니다.
     * @returns {string|null} 활성 카테고리 또는 초기화 전 null입니다.
     */
    get animationCategory() {
        return this.#animationCategory;
    }

    /**
     * 애니메이션 완료 시 반환되는 Promise를 가져옵니다.
     * @returns {Promise} 완료 Promise
     */
    get promise() {
        if (!this.#promise) {
            this.#promise = new Promise(resolve => {
                this.#resolve = resolve;
                // 요청 시 이미 완료된 상태라면 즉시 해결
                if (this.state === ANIMATION_STATE.FINISHED) {
                    resolve();
                }
            });
        }
        return this.#promise;
    }

    /**
     * 애니메이션 상태를 업데이트합니다. (서브클래스에서 구현)
     * @param {number} delta - 델타 타임
     */
    update(delta) {
    }

    /**
     * 애니메이션을 완료 상태로 표시하고 Promise를 해결합니다.
     */
    complete() {
        this.state = ANIMATION_STATE.FINISHED;
        if (this.#resolve) {
            this.#resolve();
            this.#resolve = null;
        }
        this.#promise = null; // 다른 곳에서 참조하지 않으면 GC 허용
    }
}
