import { ColorSchemes } from 'display/_theme_handler.js';
import { TITLE_CONSTANTS } from 'data/title/title_constants.js';
import { getWW, getWH, getUIWW, shadowOn, shadowOff } from 'display/display_system.js';
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
        this.UIWW = getUIWW();
        this.buttonHeight = this.UIWW * TITLE_CONSTANTS.TITLE_MENU.BUTTON_HEIGHT;
        this.menuAnchorX = this.WW - this.UIWW * 0.21;
        this.selectorAnchorX = this.WW - this.UIWW * 0.23;
        this.menuEnterStartX = this.WW + this.UIWW * 0.2;
        this.lineEnterStartX = this.menuAnchorX + this.UIWW * 0.06;

        this.selector = new TitleSelector(
            this.selectorAnchorX - this.UIWW * 0.07,
            this.WH * 0.5 - this.buttonHeight * 2,
            this.UIWW * 0.015,
            ColorSchemes.Title.TextDark
        );

        this.line = UIPool.line_element.get();
        this.line.init({
            parent: this,
            layer: "ui",
            x1: this.menuEnterStartX,
            y1: this.WH * 0.5 - this.buttonHeight * 2.5,
            x2: this.menuEnterStartX,
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
                size: this.UIWW * 0.02,
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
                y: this.WH * 0.5 - this.buttonHeight * (2 - i) - this.buttonHeight / 2,
                width: this.UIWW * 0.23,
                height: this.buttonHeight,
                idleColor: ColorSchemes.Title.Button.Background.Normal,
                hoverColor: ColorSchemes.Title.Button.Background.Hover,
                left: align === 'left' ? [textElem] : [],
                center: align !== 'left' ? [textElem] : [],
                alpha: 1,
                margin: this.UIWW * 0.01,
                radius: 0
            });
            button.onHover = this.hover.bind(this, button.y + button.height / 2);
            animate(button, { variable: 'x', startValue: this.menuEnterStartX, endValue: this.menuAnchorX, type: "easeOutExpo", duration: 0.8 + i * 0.1, delay: 0.5 });
            this.buttons.push(button);
        }
        this.selector.animateInitial(this.selectorAnchorX);
        animate(this.line, { variable: 'x1', startValue: this.lineEnterStartX, endValue: this.menuAnchorX, type: "easeOutExpo", duration: 0.6, delay: 0.4 });
        animate(this.line, { variable: 'x2', startValue: this.lineEnterStartX, endValue: this.menuAnchorX, type: "easeOutExpo", duration: 0.6, delay: 0.4 });
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

    getOffscreenRightX() {
        return this.WW + this.UIWW * 0.2;
    }

    resize() {
        const prevWH = this.WH || 1;
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.buttonHeight = this.UIWW * TITLE_CONSTANTS.TITLE_MENU.BUTTON_HEIGHT;
        this.menuAnchorX = this.WW - this.UIWW * 0.21;
        this.selectorAnchorX = this.WW - this.UIWW * 0.23;
        this.menuEnterStartX = this.WW + this.UIWW * 0.2;
        this.lineEnterStartX = this.menuAnchorX + this.UIWW * 0.06;

        this.line.x1 = this.menuAnchorX;
        this.line.x2 = this.menuAnchorX;
        this.line.y1 = this.WH * 0.5 - this.buttonHeight * 2.5;
        this.line.y2 = this.WH * 0.5 + this.buttonHeight * 2.5;
        this.line.width = 1.5;

        this.selector.x = this.selectorAnchorX - this.UIWW * 0.07;
        this.selector.y = (this.selector.y / Math.max(1, prevWH)) * this.WH;
        this.selector.w = this.UIWW * 0.015;
        this.selector.h = this.UIWW * 0.015;

        for (let i = 0; i < this.buttons.length; i++) {
            const button = this.buttons[i];
            button.x = this.menuAnchorX;
            button.y = this.WH * 0.5 - this.buttonHeight * (2 - i) - this.buttonHeight / 2;
            button.width = this.UIWW * 0.23;
            button.height = this.buttonHeight;
            button.margin = this.UIWW * 0.01;
            button.onHover = this.hover.bind(this, button.y + button.height / 2);

            const textElem = button.left[0] || button.center[0];
            if (textElem) {
                textElem.size = this.UIWW * 0.02;
            }
        }
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
