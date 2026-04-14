import { TitleScene } from './title/_title_scene.js';
import { GameScene } from './game/_game_scene.js';
import { clearSimulationCommands } from 'simulation/simulation_command_queue.js';

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
     * @param {object} [options={}] - 현재 프레임의 실행 보조 옵션입니다.
     */
    update(options = {}) {
        this.scene.update(options);
    }

    /**
     * 현재 씬의 고정 틱 업데이트를 호출합니다.
     */
    fixedUpdate() {
        if (this.scene && typeof this.scene.fixedUpdate === 'function') {
            this.scene.fixedUpdate();
        }
    }

    /**
     * 현재 씬을 그립니다.
     */
    draw() {
        this.scene.draw();
    }

    /**
     * 현재 활성 씬을 읽기 전용 시뮬레이션 스냅샷으로 그립니다.
     * @param {{sceneState?: string, scene?: object|null}|null} [sceneWrapper=null]
     * @param {object} [options={}]
     * @returns {boolean}
     */
    drawSimulationSnapshot(sceneWrapper = null, options = {}) {
        if (!this.scene || typeof this.scene.drawSimulationSnapshot !== 'function') {
            return false;
        }

        if (sceneWrapper?.sceneState && sceneWrapper.sceneState !== this.sceneState) {
            return false;
        }

        return this.scene.drawSimulationSnapshot(sceneWrapper?.scene ?? null, options);
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
     * 현재 활성 씬에 런타임 설정 변경을 전달합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        if (this.scene && typeof this.scene.applyRuntimeSettings === 'function') {
            this.scene.applyRuntimeSettings(changedSettings);
        }
    }

    /**
     * 현재 활성 씬에 시뮬레이션 명령 목록을 전달합니다.
     * @param {object[]} [commands=[]]
     */
    applySimulationCommands(commands = []) {
        if (!Array.isArray(commands) || commands.length === 0) {
            return;
        }

        if (this.scene && typeof this.scene.applySimulationCommands === 'function') {
            this.scene.applySimulationCommands(commands);
        }
    }

    /**
     * 현재 활성 씬의 읽기 전용 시뮬레이션 스냅샷을 반환합니다.
     * @returns {{sceneState: string, scene: object|null}}
     */
    createSimulationSnapshot() {
        return {
            sceneState: this.sceneState,
            scene: this.scene && typeof this.scene.createSimulationSnapshot === 'function'
                ? this.scene.createSimulationSnapshot()
                : null
        };
    }

    /**
     * 현재 활성 씬의 프레임 동기화용 동적 스냅샷을 반환합니다.
     * @returns {{sceneState: string, scene: object|null}}
     */
    createSimulationFrameSnapshot() {
        return {
            sceneState: this.sceneState,
            scene: this.scene && typeof this.scene.createSimulationFrameSnapshot === 'function'
                ? this.scene.createSimulationFrameSnapshot()
                : null
        };
    }

    /**
     * 현재 활성 씬이 내부적으로 생성한 시뮬레이션 명령을 반환합니다.
     * @returns {object[]}
     */
    consumeSimulationCommands() {
        if (!this.scene || typeof this.scene.consumeSimulationCommands !== 'function') {
            return [];
        }

        return this.scene.consumeSimulationCommands();
    }

    /**
     * 게임을 시작합니다.
     * 타이틀 씬에서 게임 씬으로 전환합니다.
     */
    gameStart() {
        clearSimulationCommands();
        if (this.scene && this.scene.destroy) {
            this.scene.destroy();
        }
        this.scene = new GameScene(this);
        this.sceneState = "inGame";
    }
}
