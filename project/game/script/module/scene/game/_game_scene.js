import { ColorSchemes } from 'display/_theme_handler.js';
import { getWW, getWH, render } from 'display/display_system.js';
import { BaseScene } from 'scene/_base_scene.js';

/**
 * @class GameScene
 * @description 실제 게임 플레이 화면을 담당하는 씬입니다.
 */
export class GameScene extends BaseScene {
    /**
     * @param {object} sceneHandler - 씬 핸들러
     * @param {object} app - 앱 인스턴스 (필요한 경우)
     */
    constructor(sceneHandler, app) {
        super(sceneHandler, app);
        this.WW = getWW();
        this.WH = getWH();

    }

    update() {
    }

    resize() {
        this.WW = getWW();
        this.WH = getWH();
    }

    draw() {
        const fontSize = this.WW * 0.008;
        render('main', {
            shape: 'text', text: "Game!",
            x: this.WW * 0.5, y: this.WH * 0.5,
            font: `300 ${fontSize}px "Pretendard Variable"`, fill: ColorSchemes.Game.Font, align: 'left', baseline: 'middle'
        });
    }
}
