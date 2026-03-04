import { ColorSchemes } from 'display/_theme_handler.js';
import { getWW, getWH, render } from 'display/display_system.js';
import { getObjectSystem } from 'object/object_system.js';
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

        const objectSystem = getObjectSystem();
        if (objectSystem && typeof objectSystem.buildEnemyShowcase === 'function') {
            objectSystem.buildEnemyShowcase();
        }

    }

    /**
         * @override
         * 매 프레임 게임 로직(물리, 적, UI 등)을 업데이트합니다.
         */
    update() {
    }

    /**
         * @override
         * 화면 크기 변경 시 게임 UI 요소들의 비율과 위치를 갱신합니다.
         */
    resize() {
        this.WW = getWW();
        this.WH = getWH();
    }

    /**
         * @override
         * 현재 프레임의 게임 상태를 캔버스에 그립니다.
         */
    draw() {
        const fontSize = this.WW * 0.008;
        render('ui', {
            shape: 'text', text: "Enemy Showcase",
            x: this.WW * 0.03, y: this.WH * 0.05,
            font: `300 ${fontSize}px "Pretendard Variable"`, fill: ColorSchemes.Game.Font, align: 'left', baseline: 'middle'
        });
    }
}
