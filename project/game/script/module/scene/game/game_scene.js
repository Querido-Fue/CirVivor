import { ColorSchemes } from '../../display/theme_handler.js';
import { getWW, getWH, render } from '../../display/_display_system.js';
import { BaseScene } from '../base_scene.js';

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

    draw() {
        const fontSize = this.WW * 0.008;
        render('main', {
            shape: 'text', text: "Game!",
            x: this.WW * 0.5, y: this.WH * 0.5,
            font: `300 ${fontSize}px "Pretendard Variable"`, fill: ColorSchemes.Game.Font, align: 'left', baseline: 'middle'
        });
    }
}