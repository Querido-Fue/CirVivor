import { ColorSchemes } from 'display/_theme_handler.js';
import { TITLE_CONSTANTS } from 'data/title/title_constants.js';
import { getWW, getWH, shadowOn, shadowOff } from 'display/display_system.js';
import { getLangString } from 'ui/ui_system.js';
import { showExitConfirmation } from 'overlay/overlay_system.js';
import { TitleSelector } from './_title_selector.js';
import { animate } from 'animation/animation_system.js';
import { UIPool, releaseUIItem } from 'ui/_ui_pool.js';

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

        this.buttonHeight = this.WW * TITLE_CONSTANTS.TITLE_MENU.BUTTON_HEIGHT;

        this.selector = new TitleSelector(
            this.WW * 0.7,
            this.WH * 0.5 - this.buttonHeight * 2,
            this.WW * 0.015,
            ColorSchemes.Title.TextDark
        );

        this.line = UIPool.line_element.get();
        this.line.init({
            parent: this,
            layer: "ui",
            x1: this.WW,
            y1: this.WH * 0.5 - this.buttonHeight * 2.5,
            x2: this.WW,
            y2: this.WH * 0.5 + this.buttonHeight * 2.5,
            width: 1.5,
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
                size: this.WW * 0.02,
                color: ColorSchemes.Title.Button.Text,
                align: 'left'
            });

            const button = UIPool.button.get();
            button.init({
                parent: this,
                onClick: buttonData[i][2],
                onHover: null,
                layer: "ui",
                x: this.WW * 2,
                y: this.WH * 0.5 - this.buttonHeight * (2 - i) - this.buttonHeight / 2,
                width: this.WW * 0.23,
                height: this.buttonHeight,
                idleColor: ColorSchemes.Title.Button.Background.Normal,
                hoverColor: ColorSchemes.Title.Button.Background.Hover,
                left: align === 'left' ? [textElem] : [],
                center: align !== 'left' ? [textElem] : [],
                alpha: 1,
                margin: this.WW * 0.01,
                radius: 0
            });
            button.onHover = this.hover.bind(this, button.y + button.height / 2);
            animate(button, { variable: 'x', startValue: this.WW * 1.2, endValue: this.WW * 0.79, type: "easeOutExpo", duration: 0.8 + i * 0.1, delay: 0.5 });
            this.buttons.push(button);
        }
        this.selector.animateInitial(this.WW * 0.77);
        animate(this.line, { variable: 'x1', startValue: this.WW * 0.85, endValue: this.WW * 0.79, type: "easeOutExpo", duration: 0.6, delay: 0.4 });
        animate(this.line, { variable: 'x2', startValue: this.WW * 0.85, endValue: this.WW * 0.79, type: "easeOutExpo", duration: 0.6, delay: 0.4 });
        animate(this.line, { variable: 'width', startValue: 10, endValue: 1.5, type: "easeOutExpo", duration: 0.6, delay: 0.3 });
        animate(this.line, { variable: 'alpha', startValue: 0, endValue: 1, type: "easeOutExpo", duration: 0.6, delay: 0.3 });
    }


    /**
     * 버튼에 호버했을 때 호출되어 선택 커서를 이동시킵니다.
     * @param {number} y - 호버된 버튼의 Y 중심 좌표
     */
    hover(y) {
        this.selector.moveTo(y);
    }

    update() {
        this.selector.update();
        this.line.update();
        this.buttons.forEach((b) => b.update());
    }

    draw() {
        shadowOn('ui', 20, ColorSchemes.Title.Shadow);
        this.selector.draw();
        this.line.draw();
        this.buttons.forEach((b) => b.draw());
        shadowOff('ui');
    }

    destroy() {
        this.selector.destroy();
        releaseUIItem(this.line);
        this.buttons.forEach((b) => releaseUIItem(b));
    }
}
