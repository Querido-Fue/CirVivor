import { TitleBackGround } from './_title_background.js';
import { TitleImage } from './_title_image.js';
import { TitleMenu } from './_title_menu.js';
import { BaseScene } from 'scene/_base_scene.js';
import { getWW, getWH } from 'display/display_system.js';
import { animate } from 'animation/animation_system.js';
import { titleMenuOpen, titleMenuClose, hasMenuOverlay } from 'overlay/overlay_system.js';

/**
 * @class TitleScene
 * @description 타이틀 배경/이미지/메뉴를 관리하고 게임 시작 전환을 처리합니다.
 */
export class TitleScene extends BaseScene {
    /**
     * @param {object} sceneSystem - 씬 핸들러
     */
    constructor(sceneSystem) {
        super(sceneSystem);
        this.titleBackGround = new TitleBackGround(this);
        this.titleImage = new TitleImage(this);
        this.titleMenu = new TitleMenu(this);
        this.WW = getWW();
        this.WH = getWH();
    }

    update() {
        const logoMagneticPoint = this.titleImage.getMagneticPoint();
        this.titleBackGround.update(logoMagneticPoint);
        this.titleImage.update();
        this.titleMenu.update();
    }

    destroy() {
        this.titleMenu.destroy();
        titleMenuClose();
    }

    draw() {
        this.titleBackGround.draw();
        this.titleImage.draw();
        this.titleMenu.draw();
    }

    /**
     * 게임 시작 로직을 수행합니다.
     */
    gameStart() {
        if (hasMenuOverlay()) {
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
        titleMenuOpen(menu, this);
    }

    menuClose() {
        titleMenuClose();
    }
}
