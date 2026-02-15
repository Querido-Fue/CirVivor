import { TitleBackGround } from './title_background.js';
import { TitleImage } from './title_image.js';
import { TitleMenu } from './title_menu.js';
import { BaseScene } from 'scene/base_scene.js';
import { getWW, getWH } from 'display/_display_system.js';
import { setMouseFocus } from 'input/_input_system.js';
import { animate } from 'animation/_animation_system.js';

import { CollectionOverlay } from './overlay/collection.js';
import { SettingsOverlay } from './overlay/settings.js';
import { CreditsOverlay } from './overlay/credits.js';
import { showExitConfirmation } from 'ui/_ui_system.js';


export class TitleScene extends BaseScene {
    /**
     * @param {object} sceneHandler - 씬 핸들러
     */
    constructor(sceneHandler) {
        super(sceneHandler);
        this.titleBackGround = new TitleBackGround(this);
        this.titleImage = new TitleImage(this);
        this.titleMenu = new TitleMenu(this);
        this.menu = null;
        this.menuOpened = false;
        this.menuOpenAnimationInit = false;
        this.menuOpenAnimation = 0;
        this.WW = getWW();
        this.WH = getWH();
    }

    update() {
        const logoMagneticPoint = this.titleImage.getMagneticPoint();
        this.titleBackGround.update(logoMagneticPoint);
        this.titleImage.update();
        this.titleMenu.update();
        if (this.menuOpened && this.menu) {
            this.menu.update();
            if (!this.menuOpenAnimationInit) {
                this.menuOpenAnimationInit = true;
                animate(this, { variable: 'menuOpenAnimation', startValue: 0, endValue: 1, type: "easeOutExpo", duration: 0.5 });
            }
        }
    }

    /**
     * 씬을 닫고 정리를 수행합니다.
     */
    close() {
        animate(this, { variable: 'menuOpenAnimation', startValue: 1, endValue: 0, type: "easeOutExpo", duration: 0.3 }).promise.then(() => {
            setMouseFocus('main');
            this.menuOpened = false;
            this.menuOpenAnimationInit = false;
            if (this.menu) {
                this.menu.destroy();
                this.menu = null;
            }
        });
    }

    destroy() {
        this.titleMenu.destroy();
        if (this.menu) {
            this.menu.destroy();
        }
    }

    draw() {
        this.titleBackGround.draw();
        this.titleImage.draw();
        this.titleMenu.draw();
        if (this.menuOpened && this.menu) {
            this.menu.draw();
        }
    }

    /**
     * 게임 시작 로직을 수행합니다.
     */
    gameStart() {
        if (this.menuOpened) {
            return;
        }
        this.titleBackGround.titleEnemies.forEach((c) => animate(c, { variable: 'alpha', startValue: "current", endValue: 0, type: "easeIn", duration: 0.8 }));
        animate(this.titleImage, { variable: 'imageX', startValue: "current", endValue: -this.WW * 0.4, type: "easeIn", duration: 1.1 });
        this.titleMenu.buttons.forEach((b) => animate(b, { variable: 'x', startValue: "current", endValue: this.WW * 1.2, type: "easeIn", duration: 0.8 }));
        this.titleMenu.buttons.forEach((b) => b.clickAble = false);
        animate(this.titleMenu.line, { variable: 'x1', startValue: "current", endValue: this.WW * 1.2, type: "easeIn", duration: 0.8, delay: 0.1 });
        animate(this.titleMenu.line, { variable: 'x2', startValue: "current", endValue: this.WW * 1.2, type: "easeIn", duration: 0.8, delay: 0.1 });
        animate(this.titleMenu.selector, { variable: 'x', startValue: "current", endValue: this.WW * 1.2, type: "easeIn", duration: 0.8, delay: 0.2 }).promise.then(() => {
            this.destroy(); // 전환 전 UI 정리
            this.sceneHandler.gameStart()
        });
    }

    /**
     * 컬렉션 메뉴를 엽니다.
     */
    collection() {
        if (this.menuOpened) return;
        this.menu = new CollectionOverlay(this);
        this.menuOpened = true;
    }

    /**
     * 설정 메뉴를 엽니다.
     */
    setting() {
        if (this.menuOpened) return;
        this.menu = new SettingsOverlay(this);
        this.menuOpened = true;
    }

    /**
     * 크레딧 메뉴를 엽니다.
     */
    credits() {
        if (this.menuOpened) return;
        this.menu = new CreditsOverlay(this);
        this.menuOpened = true;
    }

    /**
     * 게임을 종료합니다.
     */
    exit() {
        showExitConfirmation();
    }
}
