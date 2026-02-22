import { TitleBackGround } from './title_background.js';
import { TitleImage } from './title_image.js';
import { TitleMenu } from './title_menu.js';
import { BaseScene } from 'scene/base_scene.js';
import { getWW, getWH } from 'display/_display_system.js';
import { animate } from 'animation/_animation_system.js';
import { CollectionOverlay } from './overlay/collection.js';
import { SettingsOverlay } from './overlay/settings.js';
import { CreditsOverlay } from './overlay/credits.js';


export class TitleScene extends BaseScene {
    /**
     * @param {object} sceneSystem - 씬 핸들러
     */
    constructor(sceneSystem) {
        super(sceneSystem);
        this.titleBackGround = new TitleBackGround(this);
        this.titleImage = new TitleImage(this);
        this.titleMenu = new TitleMenu(this);
        this.overlayMenu = null;
        this.overlayMenuOpened = false;
        this.WW = getWW();
        this.WH = getWH();
    }

    update() {
        const logoMagneticPoint = this.titleImage.getMagneticPoint();
        this.titleBackGround.update(logoMagneticPoint);
        this.titleImage.update();
        this.titleMenu.update();
        if (this.overlayMenuOpened && this.overlayMenu) {
            this.overlayMenu.update();
        }
    }

    destroy() {
        this.titleMenu.destroy();
        if (this.overlayMenu) {
            this.overlayMenu.destroy();
        }
    }

    draw() {
        this.titleBackGround.draw();
        this.titleImage.draw();
        this.titleMenu.draw();
        if (this.overlayMenuOpened && this.overlayMenu) {
            this.overlayMenu.draw();
        }
    }

    /**
     * 게임 시작 로직을 수행합니다.
     */
    gameStart() {
        if (this.overlayMenuOpened) {
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
            this.sceneSystem.gameStart()
        });
    }

    menuOpen(menu) {
        if (this.overlayMenuOpened) return;
        this.overlayMenuOpened = true;
        switch (menu) {
            case "collection":
                this.overlayMenu = new CollectionOverlay(this);
                break;
            case "setting":
                this.overlayMenu = new SettingsOverlay(this);
                break;
            case "credits":
                this.overlayMenu = new CreditsOverlay(this);
                break;
            default:
                console.warn(`메뉴 열림 처리 중 오류가 발생했습니다. ${menu} 메뉴가 없습니다.`);
                break;
        }
    }

    menuClose() {
        if (!this.overlayMenuOpened) return;
        this.overlayMenuOpened = false;
        this.overlayMenu = null;
    }
}
