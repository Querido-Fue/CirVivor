import { TitleScene } from './title/title_scene.js';
import { GameScene } from './game/game_scene.js';

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
     * 게임을 시작합니다.
     * 타이틀 씬에서 게임 씬으로 전환합니다.
     */
    gameStart() {
        console.log('gameStart!');
        if (this.scene && this.scene.destroy) {
            this.scene.destroy();
        }
        this.scene = new GameScene(this);
        this.sceneState = "inGame";
    }
}