import { TitleMenuCardAnimator } from './_title_menu_card_animator.js';

/**
 * @class TitleMenuCard
 * @description 타이틀 카드 한 장의 상태를 보관하는 클래스입니다.
 */
export class TitleMenuCard {
    /**
     * @param {object} cardDefinition - 카드 정의입니다.
     * @param {{x:number, y:number, w:number, h:number, radius:number}|null} [layoutRect=null] - 초기 레이아웃 rect입니다.
     */
    constructor(cardDefinition, layoutRect = null) {
        this.cardDefinition = cardDefinition;
        this.layoutRect = layoutRect;
        this.animator = new TitleMenuCardAnimator();
    }

    /**
     * 카드 레이아웃 rect를 갱신합니다.
     * @param {{x:number, y:number, w:number, h:number, radius:number}} layoutRect - 새 레이아웃 rect입니다.
     */
    resize(layoutRect) {
        this.layoutRect = layoutRect;
    }

    /**
     * 카드 호버 상태를 갱신합니다.
     * @param {boolean} hovered - 호버 여부입니다.
     */
    setHovered(hovered) {
        this.animator.setHovered(hovered);
    }

    /**
     * 카드 상태를 갱신합니다.
     * @param {number} deltaSeconds - 프레임 델타 초입니다.
     */
    update(deltaSeconds) {
        this.animator.update(deltaSeconds);
    }

    /**
     * 현재 카드 렌더 모델을 반환합니다.
     * @returns {object} 렌더용 모델입니다.
     */
    getRenderModel() {
        return {
            definition: this.cardDefinition,
            layoutRect: this.layoutRect,
            animationState: this.animator.getState()
        };
    }
}
