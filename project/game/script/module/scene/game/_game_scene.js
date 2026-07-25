import { BaseScene } from 'scene/_base_scene.js';
import { GameSystem } from 'ingame/game_system.js';
import { createGameSceneDependencies } from './game_scene_dependency_factory.js';

/**
 * SceneSystem이 사용하는 게임 진입 모드입니다.
 * BENCHMARK는 별도 BenchmarkScene으로 라우팅됩니다.
 * @type {Readonly<Record<string, string>>}
 */
export const GAME_SCENE_MODES = Object.freeze({
    PLAY: 'play',
    BENCHMARK: 'benchmark'
});

/**
 * @class GameScene
 * @description 엔진 lifecycle을 세션 단위 GameSystem에 전달하는 플레이 전용 adapter입니다.
 */
export class GameScene extends BaseScene {
    /**
     * @param {object} sceneHandler - 상위 SceneSystem입니다.
     * @param {{mapId?:string,dependencies?:object}} [options={}] - 플레이 진입 옵션입니다.
     */
    constructor(sceneHandler, options = {}) {
        super(sceneHandler);
        this.mode = GAME_SCENE_MODES.PLAY;
        this.mapId = typeof options.mapId === 'string' ? options.mapId : null;
        this.dependencies = options.dependencies || createGameSceneDependencies();
        this.destroyed = false;

        this.dependencies.legacyWorldPort?.clear?.();
        this.gameSystem = new GameSystem(this.dependencies);
        this.gameSystem.enter();
    }

    /**
     * @override
     * @returns {void}
     */
    fixedUpdate() {
        this.gameSystem.fixedUpdate();
    }

    /**
     * @override
     * @returns {void}
     */
    update() {
        this.gameSystem.update();
    }

    /**
     * @override
     * @returns {void}
     */
    draw() {
        this.gameSystem.draw();
    }

    /**
     * @override
     * 월드를 재생성하지 않고 GameSystem에 새 viewport만 전달합니다.
     * @returns {void}
     */
    resize() {
        this.gameSystem.resize();
    }

    /**
     * @override
     * @param {object[]} [commands=[]] - 현재 세션에 전달할 command 목록입니다.
     * @returns {void}
     */
    applySimulationCommands(commands = []) {
        this.gameSystem.handleCommands(commands);
    }

    /**
     * 세션 리소스와 임시 legacy world를 정리합니다.
     * @returns {void}
     */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.gameSystem.destroy();
        this.dependencies.legacyWorldPort?.clear?.();
    }
}
