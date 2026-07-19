import { clampFiniteNumber, clampNumber, lerpNumber, resolveFiniteNumber } from 'util/number_util.js';

/**
 * @class TitleMenuCardAnimator
 * @description 타이틀 메뉴 카드의 등장·호버 목표값을 프레임 단위로 보간하고 등장 순서 메타데이터를 보관합니다.
 */
export class TitleMenuCardAnimator {
    /**
     * 등장·호버 보간값과 등장 순서를 모두 `0`인 초기 상태로 설정합니다.
     */
    constructor() {
        this.revealProgress = 0;
        this.revealTarget = 0;
        this.hoverProgress = 0;
        this.hoverTarget = 0;
        this.revealOrder = 0;
    }

    /**
     * 카드 정렬 및 등장 메타데이터로 사용할 순서를 설정합니다.
     * @param {number} revealOrder - 유한하지 않으면 `0`으로 대체할 등장 순서 값입니다.
     */
    setRevealOrder(revealOrder) {
        this.revealOrder = resolveFiniteNumber(revealOrder, 0);
    }

    /**
     * 카드 등장 보간 목표를 `1`로 설정합니다.
     */
    show() {
        this.revealTarget = 1;
    }

    /**
     * 호버 여부에 따라 카드 호버 보간 목표를 `1` 또는 `0`으로 설정합니다.
     * @param {boolean} hovered - 호버 여부입니다.
     */
    setHovered(hovered) {
        this.hoverTarget = hovered ? 1 : 0;
    }

    /**
     * 비음수 유한 프레임 델타를 기준으로 reveal·hover 진행값을 각 목표값 쪽으로 선형 보간합니다.
     * @param {number} deltaSeconds - 프레임 델타 초입니다.
     */
    update(deltaSeconds) {
        const delta = clampFiniteNumber(deltaSeconds, 0, Infinity, 0);
        const blend = clampNumber(delta * 10, 0, 1);

        this.revealProgress = this._approach(this.revealProgress, this.revealTarget, blend);
        this.hoverProgress = this._approach(this.hoverProgress, this.hoverTarget, blend);
    }

    /**
     * 현재 reveal·hover 진행값과 등장 순서를 새 상태 객체로 반환합니다.
     * @returns {{revealProgress:number, hoverProgress:number, revealOrder:number}} 매 호출 새로 만든 렌더 상태 스냅샷입니다.
     */
    getState() {
        return {
            revealProgress: this.revealProgress,
            hoverProgress: this.hoverProgress,
            revealOrder: this.revealOrder
        };
    }

    /**
     * 현재 값에서 목표 값으로 보간합니다.
     * @param {number} currentValue - 현재 값입니다.
     * @param {number} targetValue - 목표 값입니다.
     * @param {number} blend - 보간 계수입니다.
     * @returns {number} 보간 결과입니다.
     * @private
     */
    _approach(currentValue, targetValue, blend) {
        return lerpNumber(currentValue, targetValue, blend);
    }
}
