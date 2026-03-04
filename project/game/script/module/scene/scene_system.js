import { TitleScene } from './title/_title_scene.js';
import { GameScene } from './game/_game_scene.js';

/**
 * @class SceneSystem
 * @description 현재 활성 씬을 보관하고 씬 전환을 관리합니다.
 */
export class SceneSystem {
    constructor() {
        this.sceneState = "title";
    }

    /**
     * 씬 시스템을 초기화합니다.
     * 글로벌 배경과 타이틀 씬을 로드합니다.
     */
    async init() {
        this.scene = new TitleScene(this);
    }

    /**
     * 현재 씬을 업데이트합니다.
     */
    update() {
        this.scene.update();
    }

    /**
     * 현재 씬을 그립니다.
     */
    draw() {
        this.scene.draw();
    }

    /**
         * 창 크기 변경 이벤트를 현재 활성화된 씬에 전달합니다.
         */
    resize() {
        if (this.scene && typeof this.scene.resize === 'function') {
            this.scene.resize();
        }
    }

    /**
     * 게임을 시작합니다.
     * 타이틀 씬에서 게임 씬으로 전환합니다.
     */
    gameStart() {
        if (this.scene && this.scene.destroy) {
            this.scene.destroy();
        }
        this.scene = new GameScene(this);
        this.sceneState = "inGame";
    }
}
