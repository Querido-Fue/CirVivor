/**
 * @class TitleMenuCardAnimator
 * @description 타이틀 카드의 등장과 호버 상태를 관리하는 스캐폴드 클래스입니다.
 */
export class TitleMenuCardAnimator {
    /**
     * 타이틀 카드 애니메이터를 생성합니다.
     */
    constructor() {
        this.revealProgress = 0;
        this.revealTarget = 0;
        this.hoverProgress = 0;
        this.hoverTarget = 0;
        this.revealOrder = 0;
    }

    /**
     * 카드 등장 순서를 설정합니다.
     * @param {number} revealOrder - 좌상단부터의 등장 순서입니다.
     */
    setRevealOrder(revealOrder) {
        this.revealOrder = Number.isFinite(revealOrder) ? revealOrder : 0;
    }

    /**
     * 카드 등장 목표를 켭니다.
     */
    show() {
        this.revealTarget = 1;
    }

    /**
     * 카드 호버 목표를 갱신합니다.
     * @param {boolean} hovered - 호버 여부입니다.
     */
    setHovered(hovered) {
        this.hoverTarget = hovered ? 1 : 0;
    }

    /**
     * 현재 애니메이션 상태를 갱신합니다.
     * @param {number} deltaSeconds - 프레임 델타 초입니다.
     */
    update(deltaSeconds) {
        const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
        const blend = Math.min(1, delta * 10);

        this.revealProgress = this._approach(this.revealProgress, this.revealTarget, blend);
        this.hoverProgress = this._approach(this.hoverProgress, this.hoverTarget, blend);
    }

    /**
     * 현재 렌더 상태를 반환합니다.
     * @returns {{revealProgress:number, hoverProgress:number, revealOrder:number}} 렌더 상태입니다.
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
        return currentValue + ((targetValue - currentValue) * blend);
    }
}
