import { ColorSchemes } from 'display/_theme_handler.js';
import { getData } from 'data/data_handler.js';
import { getWW, getWH, getUIWW, shadowOn, shadowOff } from 'display/display_system.js';
import { getLangString } from 'ui/ui_system.js';
import { showExitConfirmation } from 'overlay/overlay_system.js';
import { TitleSelector } from './_title_selector.js';
import { animate } from 'animation/animation_system.js';
import { UIPool, releaseUIItem } from 'ui/_ui_pool.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');

/**
 * @class TitleMenu
 * @description 타이틀 화면의 메뉴를 관리하는 클래스입니다. 버튼과 선택 커서를 포함합니다.
 */
export class TitleMenu {
    /**
     * @param {TitleScene} TitleScene - 타이틀 씬 인스턴스
     */
    constructor(TitleScene) {
        this.TitleScene = TitleScene;
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this._recalculateAnchors();

        this.selector = new TitleSelector(
            this.selectorAnchorX - (this.UIWW * TITLE_CONSTANTS.TITLE_MENU.SELECTOR_OFFSET_RATIO),
            this.WH * 0.5 - (this.buttonHeight * TITLE_CONSTANTS.TITLE_MENU.BUTTON_STACK_OFFSET),
            this.UIWW * TITLE_CONSTANTS.TITLE_MENU.SELECTOR_SIZE_RATIO,
            ColorSchemes.Title.TextDark
        );

        this.line = UIPool.line_element.get();
        this.line.init({
            parent: this,
            layer: "ui",
            x1: this.menuEnterStartX,
            y1: this.WH * 0.5 - (this.buttonHeight * TITLE_CONSTANTS.TITLE_MENU.LINE_STACK_OFFSET),
            x2: this.menuEnterStartX,
            y2: this.WH * 0.5 + (this.buttonHeight * TITLE_CONSTANTS.TITLE_MENU.LINE_STACK_OFFSET),
            width: TITLE_CONSTANTS.TITLE_MENU.LINE_WIDTH,
            color: ColorSchemes.Title.Line,
            alpha: 0
        });

        this.buttons = [];
        const buttonData = [
            [getLangString("title_menu_start"), "left", this.TitleScene.gameStart.bind(this.TitleScene)],
            [getLangString("title_menu_collection"), "left", this.TitleScene.menuOpen.bind(this.TitleScene, "collection")],
            [getLangString("title_menu_settings"), "left", this.TitleScene.menuOpen.bind(this.TitleScene, "setting")],
            [getLangString("title_menu_credits"), "left", this.TitleScene.menuOpen.bind(this.TitleScene, "credits")],
            [getLangString("title_menu_exit"), "left", showExitConfirmation]
        ];
        for (let i = 0; i < buttonData.length; i++) {
            const align = buttonData[i][1];
            const textElem = UIPool.text_element.get();
            textElem.init({
                parent: this,
                layer: "ui",
                text: buttonData[i][0],
                font: "Pretendard Variable",
                fontWeight: "700",
                size: this.UIWW * TITLE_CONSTANTS.TITLE_MENU.BUTTON_FONT_SIZE_RATIO,
                color: ColorSchemes.Title.Button.Text,
                align: 'left'
            });

            const button = UIPool.button.get();
            button.init({
                parent: this,
                onClick: buttonData[i][2],
                onHover: null,
                layer: "ui",
                x: this.menuEnterStartX,
                y: this.WH * 0.5 - (this.buttonHeight * (TITLE_CONSTANTS.TITLE_MENU.BUTTON_STACK_OFFSET - i)) - (this.buttonHeight / 2),
                width: this.UIWW * TITLE_CONSTANTS.TITLE_MENU.BUTTON_WIDTH_RATIO,
                height: this.buttonHeight,
                idleColor: ColorSchemes.Title.Button.Background.Normal,
                hoverColor: ColorSchemes.Title.Button.Background.Hover,
                left: align === 'left' ? [textElem] : [],
                center: align !== 'left' ? [textElem] : [],
                alpha: 1,
                margin: this.UIWW * TITLE_CONSTANTS.TITLE_MENU.BUTTON_MARGIN_RATIO,
                radius: 0
            });
            button.onHover = this.hover.bind(this, button.y + button.height / 2);
            animate(button, {
                variable: 'x',
                startValue: this.menuEnterStartX,
                endValue: this.menuAnchorX,
                type: "easeOutExpo",
                duration: TITLE_CONSTANTS.TITLE_MENU.BUTTON_ANIM_BASE_DURATION + (i * TITLE_CONSTANTS.TITLE_MENU.BUTTON_ANIM_STEP_DURATION),
                delay: TITLE_CONSTANTS.TITLE_MENU.BUTTON_ANIM_DELAY
            });
            this.buttons.push(button);
        }
        this.selector.animateInitial(this.selectorAnchorX);
        animate(this.line, {
            variable: 'x1',
            startValue: this.lineEnterStartX,
            endValue: this.menuAnchorX,
            type: "easeOutExpo",
            duration: TITLE_CONSTANTS.TITLE_MENU.LINE_ANIM_DURATION,
            delay: TITLE_CONSTANTS.TITLE_MENU.LINE_ANIM_DELAY
        });
        animate(this.line, {
            variable: 'x2',
            startValue: this.lineEnterStartX,
            endValue: this.menuAnchorX,
            type: "easeOutExpo",
            duration: TITLE_CONSTANTS.TITLE_MENU.LINE_ANIM_DURATION,
            delay: TITLE_CONSTANTS.TITLE_MENU.LINE_ANIM_DELAY
        });
        animate(this.line, {
            variable: 'width',
            startValue: TITLE_CONSTANTS.TITLE_MENU.LINE_ANIMATION_START_WIDTH,
            endValue: TITLE_CONSTANTS.TITLE_MENU.LINE_WIDTH,
            type: "easeOutExpo",
            duration: TITLE_CONSTANTS.TITLE_MENU.LINE_ANIM_DURATION,
            delay: TITLE_CONSTANTS.TITLE_MENU.LINE_WIDTH_ANIM_DELAY
        });
        animate(this.line, {
            variable: 'alpha',
            startValue: 0,
            endValue: 1,
            type: "easeOutExpo",
            duration: TITLE_CONSTANTS.TITLE_MENU.LINE_ANIM_DURATION,
            delay: TITLE_CONSTANTS.TITLE_MENU.LINE_ALPHA_ANIM_DELAY
        });
    }


    /**
     * 버튼에 호버했을 때 호출되어 선택 커서를 이동시킵니다.
     * @param {number} y - 호버된 버튼의 Y 중심 좌표
     */
    hover(y) {
        this.selector.moveTo(y);
    }

    /**
         * 화면 우측 바깥 (종료/전환 애니메이션 목적지) X 좌표 계산
         * @returns {number}
         */
    getOffscreenRightX() {
        return this.WW + (this.UIWW * TITLE_CONSTANTS.TITLE_MENU.MENU_ENTER_START_OFFSET_RATIO);
    }

    /**
         * 화면 크기 변화 시 타이틀 메뉴 버튼과 라인 등을 재계산
         */
    resize() {
        const prevWH = this.WH || 1;
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this._recalculateAnchors();

        this.line.x1 = this.menuAnchorX;
        this.line.x2 = this.menuAnchorX;
        this.line.y1 = this.WH * 0.5 - (this.buttonHeight * TITLE_CONSTANTS.TITLE_MENU.LINE_STACK_OFFSET);
        this.line.y2 = this.WH * 0.5 + (this.buttonHeight * TITLE_CONSTANTS.TITLE_MENU.LINE_STACK_OFFSET);
        this.line.width = TITLE_CONSTANTS.TITLE_MENU.LINE_WIDTH;

        this.selector.x = this.selectorAnchorX - (this.UIWW * TITLE_CONSTANTS.TITLE_MENU.SELECTOR_OFFSET_RATIO);
        this.selector.y = (this.selector.y / Math.max(1, prevWH)) * this.WH;
        this.selector.w = this.UIWW * TITLE_CONSTANTS.TITLE_MENU.SELECTOR_SIZE_RATIO;
        this.selector.h = this.UIWW * TITLE_CONSTANTS.TITLE_MENU.SELECTOR_SIZE_RATIO;

        for (let i = 0; i < this.buttons.length; i++) {
            const button = this.buttons[i];
            button.x = this.menuAnchorX;
            button.y = this.WH * 0.5 - (this.buttonHeight * (TITLE_CONSTANTS.TITLE_MENU.BUTTON_STACK_OFFSET - i)) - (this.buttonHeight / 2);
            button.width = this.UIWW * TITLE_CONSTANTS.TITLE_MENU.BUTTON_WIDTH_RATIO;
            button.height = this.buttonHeight;
            button.margin = this.UIWW * TITLE_CONSTANTS.TITLE_MENU.BUTTON_MARGIN_RATIO;
            button.onHover = this.hover.bind(this, button.y + button.height / 2);

            const textElem = button.left[0] || button.center[0];
            if (textElem) {
                textElem.size = this.UIWW * TITLE_CONSTANTS.TITLE_MENU.BUTTON_FONT_SIZE_RATIO;
            }
        }
    }

    /**
         * 메뉴 내 시각 요소(셀렉터, 버튼 애니메이션 상태 등) 갱신
         */
    update() {
        this.selector.update();
        this.line.update();
        this.buttons.forEach((b) => b.update());
    }

    /**
         * 그림자 효과와 함께 메뉴 UI (버튼, 라인 등) 그리기
         */
    draw() {
        shadowOn('ui', TITLE_CONSTANTS.TITLE_MENU.SHADOW_BLUR, ColorSchemes.Title.Shadow);
        this.selector.draw();
        this.line.draw();
        this.buttons.forEach((b) => b.draw());
        shadowOff('ui');
    }

    /**
         * 메뉴 컴포넌트 해제. 사용된 UI 아이템 풀로 반납
         */
    destroy() {
        this.selector.destroy();
        releaseUIItem(this.line);
        this.buttons.forEach((b) => releaseUIItem(b));
    }

    /**
         * 버튼이 존재해야 하는 정확한 X축 앵커 위치 재설정
         * @private
         */
    _recalculateAnchors() {
        this.buttonHeight = this.UIWW * TITLE_CONSTANTS.TITLE_MENU.BUTTON_HEIGHT;
        this.menuAnchorX = this.WW - (this.UIWW * TITLE_CONSTANTS.TITLE_MENU.MENU_ANCHOR_FROM_RIGHT_RATIO);
        this.selectorAnchorX = this.WW - (this.UIWW * TITLE_CONSTANTS.TITLE_MENU.SELECTOR_ANCHOR_FROM_RIGHT_RATIO);
        this.menuEnterStartX = this.WW + (this.UIWW * TITLE_CONSTANTS.TITLE_MENU.MENU_ENTER_START_OFFSET_RATIO);
        this.lineEnterStartX = this.menuAnchorX + (this.UIWW * TITLE_CONSTANTS.TITLE_MENU.LINE_ENTER_OFFSET_RATIO);
    }
}
