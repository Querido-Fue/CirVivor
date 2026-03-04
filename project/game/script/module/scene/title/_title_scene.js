import { TitleBackGround } from './_title_background.js';
import { TitleImage } from './_title_image.js';
import { TitleMenu } from './_title_menu.js';
import { BaseScene } from 'scene/_base_scene.js';
import { getWW, getWH } from 'display/display_system.js';
import { animate } from 'animation/animation_system.js';
import { getData } from 'data/data_handler.js';
import { titleMenuOpen, titleMenuClose, hasMenuOverlay } from 'overlay/overlay_system.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');

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

    /**
         * @override
         * 씬의 상태(배경 이펙트, 이미지, 메뉴 배치 등)를 갱신합니다.
         */
    update() {
        const logoMagneticPoint = this.titleImage.getMagneticPoint();
        this.titleBackGround.update(logoMagneticPoint);
        this.titleImage.update();
        this.titleMenu.update();
    }

    /**
     * @override
     * 타이틀 배경 물리/충돌을 고정 틱으로 갱신합니다.
     */
    fixedUpdate() {
        if (this.titleBackGround && typeof this.titleBackGround.fixedUpdate === 'function') {
            this.titleBackGround.fixedUpdate();
        }
    }

    /**
         * 씬을 닫거나 게임 시작 시 호출되어 타이틀 관련 리소스와 요소를 정리합니다.
         */
    destroy() {
        if (this.titleBackGround && typeof this.titleBackGround.destroy === 'function') {
            this.titleBackGround.destroy();
        }
        this.titleMenu.destroy();
        titleMenuClose();
    }

    /**
         * @override
         * 씬을 구성하는 시각적 객체들을 순차적으로 그립니다.
         */
    draw() {
        this.titleBackGround.draw();
        this.titleImage.draw();
        this.titleMenu.draw();
    }

    /**
         * @override
         * 화면 크기가 변할 때 배경, 로고, 메뉴의 위치와 크기를 갱신합니다.
         */
    resize() {
        this.WW = getWW();
        this.WH = getWH();
        if (this.titleBackGround && typeof this.titleBackGround.resize === 'function') {
            this.titleBackGround.resize();
        }
        if (this.titleImage && typeof this.titleImage.resize === 'function') {
            this.titleImage.resize();
        }
        if (this.titleMenu && typeof this.titleMenu.resize === 'function') {
            this.titleMenu.resize();
        }
    }

    /**
     * 게임 시작 로직을 수행합니다.
     */
    gameStart() {
        if (hasMenuOverlay()) {
            return;
        }
        const menuOffscreenX = this.titleMenu.getOffscreenRightX();
        const logoOffscreenX = -this.titleImage.UIWW * TITLE_CONSTANTS.TITLE_IMAGE.EXIT_LEFT_WIDTH_RATIO;
        this.titleBackGround.titleEnemies.forEach((c) => animate(c, {
            variable: 'alpha',
            startValue: "current",
            endValue: 0,
            type: "easeIn",
            duration: TITLE_CONSTANTS.TITLE_TRANSITION.ENEMY_FADE_DURATION
        }));
        animate(this.titleImage, {
            variable: 'imageX',
            startValue: "current",
            endValue: logoOffscreenX,
            type: "easeIn",
            duration: TITLE_CONSTANTS.TITLE_TRANSITION.LOGO_EXIT_DURATION
        });
        this.titleMenu.buttons.forEach((b) => animate(b, {
            variable: 'x',
            startValue: "current",
            endValue: menuOffscreenX,
            type: "easeIn",
            duration: TITLE_CONSTANTS.TITLE_TRANSITION.MENU_EXIT_DURATION
        }));
        this.titleMenu.buttons.forEach((b) => b.clickAble = false);
        animate(this.titleMenu.line, {
            variable: 'x1',
            startValue: "current",
            endValue: menuOffscreenX,
            type: "easeIn",
            duration: TITLE_CONSTANTS.TITLE_TRANSITION.MENU_EXIT_DURATION,
            delay: TITLE_CONSTANTS.TITLE_TRANSITION.MENU_LINE_EXIT_DELAY
        });
        animate(this.titleMenu.line, {
            variable: 'x2',
            startValue: "current",
            endValue: menuOffscreenX,
            type: "easeIn",
            duration: TITLE_CONSTANTS.TITLE_TRANSITION.MENU_EXIT_DURATION,
            delay: TITLE_CONSTANTS.TITLE_TRANSITION.MENU_LINE_EXIT_DELAY
        });
        animate(this.titleMenu.selector, {
            variable: 'x',
            startValue: "current",
            endValue: menuOffscreenX,
            type: "easeIn",
            duration: TITLE_CONSTANTS.TITLE_TRANSITION.MENU_EXIT_DURATION,
            delay: TITLE_CONSTANTS.TITLE_TRANSITION.SELECTOR_EXIT_DELAY
        }).promise.then(() => {
            this.destroy(); // 전환 전 UI 정리
            this.sceneSystem.gameStart()
        });
    }

    /**
         * 타이틀 메뉴 항목 중 오버레이 팝업(설정 등)을 요청합니다.
         * @param {string} menu 오버레이 이름
         */
    menuOpen(menu) {
        titleMenuOpen(menu, this);
    }

    /**
         * 현재 열려있는 타이틀 메뉴 팝업을 닫습니다.
         */
    menuClose() {
        titleMenuClose();
    }
}
