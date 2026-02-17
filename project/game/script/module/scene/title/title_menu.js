import { ColorSchemes } from 'display/theme_handler.js';
import { LineElement } from 'ui/element/line.js';
import { ButtonElement } from 'ui/element/button.js';
import { getWW, getWH, render, shadowOn, shadowOff } from 'display/_display_system.js';
import { getLangString, showExitConfirmation } from 'ui/_ui_system.js';
import { animate, remove } from 'animation/_animation_system.js';

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

        this.selectorAnimId = -1;

        this.WW = getWW();
        this.WH = getWH();

        const initialY = this.WH * 0.4875 - this.WW * 0.032 * 2 + this.WW * 0.025 / 2;
        const arrowSize = this.WW * 0.018;

        this.selector = {
            x: this.WW * 0.7,
            y: initialY,
            w: arrowSize * 0.8,
            h: arrowSize * 0.8,
            rotation: 90,
            color: ColorSchemes.Title.TextDark,
            alpha: 0,
            update: function () { },
            draw: () => {
                render('ui', {
                    shape: 'arrow',
                    x: this.selector.x,
                    y: this.selector.y,
                    w: this.selector.w,
                    h: this.selector.h,
                    rotation: this.selector.rotation,
                    fill: this.selector.color,
                    alpha: this.selector.alpha
                });
            }
        };

        this.line = new LineElement({
            parent: this,
            layer: "ui",
            x1: this.WW,
            y1: this.WH * 0.4875 - this.WW * 0.07,
            x2: this.WW,
            y2: this.WH * 0.4875 + this.WW * 0.095,
            width: 1.5,
            color: ColorSchemes.Title.Line,
            alpha: 0
        });

        this.buttons = [];
        const buttonData = [
            [getLangString("title_menu_start"), "left", this.TitleScene.gameStart.bind(this.TitleScene)],
            [getLangString("title_menu_collection"), "left", this.TitleScene.collection.bind(this.TitleScene)],
            [getLangString("title_menu_settings"), "left", this.TitleScene.setting.bind(this.TitleScene)],
            [getLangString("title_menu_credits"), "left", this.TitleScene.credits.bind(this.TitleScene)],
            [getLangString("title_menu_exit"), "left", showExitConfirmation]
        ];
        for (let i = 0; i < buttonData.length; i++) {
            const button = new ButtonElement({
                parent: this,
                onClick: buttonData[i][2],
                onHover: null,
                layer: "ui",
                x: this.WW * 2,
                y: this.WH * 0.4875 - this.WW * 0.032 * (2 - i),
                width: this.WW * 0.13,
                height: this.WW * 0.025,
                idleColor: ColorSchemes.Title.Button.Background.Normal,
                hoverColor: ColorSchemes.Title.Button.Background.Hover,
                text: buttonData[i][0],
                align: buttonData[i][1],
                font: "Pretendard Variable",
                fontWeight: 700,
                size: this.WW * 0.02,
                color: ColorSchemes.Title.Button.Text,
                alpha: 1,
                margin: 10
            });
            button.onHover = this.hover.bind(this, button.y + button.height / 2);
            animate(button, { variable: 'x', startValue: this.WW * 1.2, endValue: this.WW * 0.8, type: "easeOutExpo", duration: 0.8 + i * 0.1, delay: 0.5 });
            this.buttons.push(button);
        }
        animate(this.selector, { variable: 'x', startValue: this.WW * 0.74, endValue: this.WW * 0.77, type: "easeOutExpo", duration: 1, delay: 0.5 });
        animate(this.selector, { variable: 'alpha', startValue: 0, endValue: 1, type: "easeOutExpo", duration: 0.6, delay: 0.5 });
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
        if (this.selectorAnimId !== -1) {
            remove(this.selectorAnimId);
        }
        this.selectorAnimId = animate(this.selector, { variable: 'y', startValue: this.selector.y, endValue: y, type: "easeOutExpo", duration: 0.3 }).id;
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
        if (this.selectorAnimId !== -1) {
            remove(this.selectorAnimId);
        }
        this.line.destroy();
        this.buttons.forEach((b) => b.destroy());
    }
}
