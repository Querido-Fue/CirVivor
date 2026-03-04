import { render } from 'display/display_system.js';
import { animate, remove } from 'animation/animation_system.js';
import { getData } from 'data/data_handler.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');

/**
 * @class TitleSelector
 * @description 타이틀 화면 메뉴 버튼 좌측에서 현재 포커스된 버튼을 가리키는 커서 화살표를 관리합니다.
 */
export class TitleSelector {
    constructor(x, y, size, color) {
        this.x = x;
        this.y = y;
        this.w = size;
        this.h = size;
        this.rotation = TITLE_CONSTANTS.TITLE_MENU.SELECTOR_ROTATION;
        this.color = color;
        this.alpha = 0;
        this.selectorAnimId = -1;
    }

    /**
     * 초기 등장 애니메이션을 실행합니다.
     * @param {number} endX - 애니메이션이 끝날 x 좌표
     */
    animateInitial(endX) {
        animate(this, {
            variable: 'x',
            startValue: 'current',
            endValue: endX,
            type: "easeOutExpo",
            duration: TITLE_CONSTANTS.TITLE_MENU.SELECTOR_ENTER_DURATION,
            delay: TITLE_CONSTANTS.TITLE_MENU.SELECTOR_ENTER_DELAY
        });
        animate(this, {
            variable: 'alpha',
            startValue: 0,
            endValue: 1,
            type: "easeOutExpo",
            duration: TITLE_CONSTANTS.TITLE_MENU.SELECTOR_ALPHA_ENTER_DURATION,
            delay: TITLE_CONSTANTS.TITLE_MENU.SELECTOR_ENTER_DELAY
        });
    }

    /**
     * 화살표의 Y 위치를 목표 버튼 좌표로 부드럽게 이동시킵니다.
     * @param {number} targetY - 이동할 Y 좌표(버튼의 중심 Y)
     */
    moveTo(targetY) {
        if (this.selectorAnimId !== -1) {
            remove(this.selectorAnimId);
        }
        this.selectorAnimId = animate(this, {
            variable: 'y',
            startValue: "current",
            endValue: targetY,
            type: "easeOutExpo",
            duration: TITLE_CONSTANTS.TITLE_MENU.SELECTOR_MOVE_DURATION
        }).id;
    }

    /**
         * 커서 갱신 로직
         */
    update() { }

    /**
         * 셀렉터(커서) 화살표를 렌더링합니다.
         */
    draw() {
        render('ui', {
            shape: 'arrow',
            x: this.x,
            y: this.y,
            w: this.w,
            h: this.h,
            rotation: this.rotation,
            fill: this.color,
            alpha: this.alpha
        });
    }

    /**
         * 셀렉터 객체를 소멸하고 애니메이션을 해제합니다.
         */
    destroy() {
        if (this.selectorAnimId !== -1) {
            remove(this.selectorAnimId);
            this.selectorAnimId = -1;
        }
    }
}
