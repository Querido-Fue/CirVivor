import { TitleScene } from './title/_title_scene.js';
import { GameScene } from './game/_game_scene.js';
import { clearSimulationCommands } from 'simulation/simulation_command_queue.js';

const SCENE_STATES = Object.freeze({
    TITLE: 'title',
    IN_GAME: 'inGame'
});

/**
 * 씬에 지정한 메서드가 있으면 호출합니다.
 * @param {object|null|undefined} scene - 대상 씬 인스턴스입니다.
 * @param {string} methodName - 호출할 메서드 이름입니다.
 * @param {Array} [args=[]] - 메서드 인자 목록입니다.
 * @returns {*} 씬 메서드 반환값입니다.
 */
function callSceneMethod(scene, methodName, args = []) {
    if (scene && typeof scene[methodName] === 'function') {
        return scene[methodName](...args);
    }
    return undefined;
}

/**
 * @class SceneSystem
 * @description 현재 활성 씬을 보관하고 씬 전환을 관리합니다.
 */
export class SceneSystem {
    /**
     * @param {object} systemHandler - 상위 시스템 핸들러입니다.
     */
    constructor(systemHandler) {
        this.systemHandler = systemHandler;
        this.scene = null;
        this.sceneState = SCENE_STATES.TITLE;
    }

    /**
     * 씬 시스템을 초기화합니다.
     * 글로벌 배경과 타이틀 씬을 로드합니다.
     */
    async init() {
        this.#setScene(new TitleScene(this), SCENE_STATES.TITLE);
    }

    /**
     * 현재 씬을 업데이트합니다.
     * @param {object} [options={}] - 현재 프레임의 실행 보조 옵션입니다.
     */
    update(options = {}) {
        this.#callActiveScene('update', [options]);
    }

    /**
     * 현재 씬의 고정 틱 업데이트를 호출합니다.
     */
    fixedUpdate() {
        this.#callActiveScene('fixedUpdate');
    }

    /**
     * 현재 씬을 그립니다.
     */
    draw() {
        this.#callActiveScene('draw');
    }

    /**
     * 창 크기 변경 이벤트를 현재 활성화된 씬에 전달합니다.
     */
    resize() {
        this.#callActiveScene('resize');
    }

    /**
     * 현재 활성 씬에 런타임 설정 변경을 전달합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        this.#callActiveScene('applyRuntimeSettings', [changedSettings]);
    }

    /**
     * 현재 활성 씬에 시뮬레이션 명령 목록을 전달합니다.
     * @param {object[]} [commands=[]] - 전달할 시뮬레이션 명령 목록입니다.
     */
    applySimulationCommands(commands = []) {
        if (!Array.isArray(commands) || commands.length === 0) {
            return;
        }

        this.#callActiveScene('applySimulationCommands', [commands]);
    }

    /**
     * 게임을 시작합니다.
     * 타이틀 씬에서 게임 씬으로 전환합니다.
     */
    gameStart() {
        clearSimulationCommands();
        this.#destroyActiveScene();
        this.#setScene(new GameScene(this), SCENE_STATES.IN_GAME);
    }

    /**
     * 현재 활성 씬의 메서드를 안전하게 호출합니다.
     * @param {string} methodName - 호출할 메서드 이름입니다.
     * @param {Array} [args=[]] - 메서드 인자 목록입니다.
     * @returns {*} 씬 메서드 반환값입니다.
     * @private
     */
    #callActiveScene(methodName, args = []) {
        return callSceneMethod(this.scene, methodName, args);
    }

    /**
     * 현재 활성 씬을 정리합니다.
     * @returns {void}
     * @private
     */
    #destroyActiveScene() {
        this.#callActiveScene('destroy');
    }

    /**
     * 활성 씬과 씬 상태 값을 갱신합니다.
     * @param {object} scene - 새 활성 씬입니다.
     * @param {string} sceneState - 새 씬 상태입니다.
     * @returns {void}
     * @private
     */
    #setScene(scene, sceneState) {
        this.scene = scene;
        this.sceneState = sceneState;
    }
}
