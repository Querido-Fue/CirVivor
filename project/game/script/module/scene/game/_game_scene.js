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
     * @param {{mapId?:string,dependencies?:object,tileNavigationSource?:object|null,enemyWaveEnabled?:boolean,gameplayWorldActorsEnabled?:boolean,enemyRecoveryEnabled?:boolean,waveDefinition?:object,enemyPresentationProfile?:string,initialCameraZoom?:number,towerMaxHp?:number,coreMaxIntegrity?:number}} [options={}] - 플레이 진입 옵션입니다.
     */
    constructor(sceneHandler, options = {}) {
        super(sceneHandler);
        this.mode = GAME_SCENE_MODES.PLAY;
        this.mapId = typeof options.mapId === 'string' ? options.mapId : null;
        this.dependencies = options.dependencies || createGameSceneDependencies();
        this.tileNavigationSource = options.tileNavigationSource ?? null;
        this.enemyWaveEnabled = options.enemyWaveEnabled;
        this.gameplayWorldActorsEnabled = options.gameplayWorldActorsEnabled;
        this.enemyRecoveryEnabled = options.enemyRecoveryEnabled !== false;
        this.waveDefinition = options.waveDefinition;
        this.enemyPresentationProfile = options.enemyPresentationProfile;
        this.initialCameraZoom = options.initialCameraZoom;
        this.towerMaxHp = options.towerMaxHp;
        this.coreMaxIntegrity = options.coreMaxIntegrity;
        this.recoveryRestartGeneration = null;
        this.recoveryRestartCount = 0;
        this.destroyed = false;

        this.dependencies.legacyWorldPort?.clear?.();
        this.gameSystem = this.#createGameSystem();
    }

    /**
     * @override
     * @returns {boolean} GameSystem fixed tick이 실제로 전진했는지 여부입니다.
     */
    fixedUpdate() {
        const advanced = this.gameSystem.fixedUpdate();
        if (advanced) {
            this.recoveryRestartGeneration = null;
            return true;
        }
        if (this.enemyRecoveryEnabled
            && this.gameSystem.isEnemySimulationRecoveryRequired()) {
            this.#restartAtSafeWaveBoundary();
        }
        return false;
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
     * benchmark/tool이 Level map·Core·Tower 없이 GPU 적만 그릴 때 사용하는 owner-preserving 경계입니다.
     * @returns {boolean} GPU draw 제출 여부입니다.
     */
    drawEnemySimulation() {
        return this.gameSystem.drawEnemySimulation();
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
     * @override
     * pause/resume 경계에서 세션의 GPU 적 presentation clock을 즉시 동기화합니다.
     * @returns {void}
     */
    synchronizePresentation() {
        this.gameSystem.synchronizePresentation();
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
        this.recoveryRestartGeneration = null;
        this.dependencies.legacyWorldPort?.clear?.();
    }

    /**
     * 테스트·진단용 safe-boundary recovery snapshot입니다.
     * @returns {{restartCount:number,restartGeneration:number|null}}
     */
    getEnemyRecoveryStatus() {
        return Object.freeze({
            restartCount: this.recoveryRestartCount,
            restartGeneration: this.recoveryRestartGeneration
        });
    }

    /**
     * 실제 게임 씬에서 mixed-body spawn/despawn request와 GPU 상태를 연결할 공개 endpoint입니다.
     * commit/tick/presentation/draw는 내부 GameSystem이 소유합니다.
     * @returns {import('../../ingame/object/enemy/gpu_enemy_simulation_endpoint.js').GpuSimulationEndpoint}
     */
    getGpuSimulationEndpoint() {
        return this.gameSystem.getGpuSimulationEndpoint();
    }

    /** @returns {import('../../ingame/object/enemy/gpu_enemy_simulation_endpoint.js').GpuSimulationEndpoint} 기존 enemy API 호환 alias입니다. */
    getEnemySimulationEndpoint() {
        return this.getGpuSimulationEndpoint();
    }

    /**
     * gameplay adapter가 mixed-body lifecycle request를 예약할 가장 이른 fixed tick입니다.
     * @returns {number} 현재 열린 다음 GPU lifecycle 경계입니다.
     */
    getNextGpuLifecycleFixedTick() {
        return this.gameSystem.getNextGpuLifecycleFixedTick();
    }

    /** @returns {number} 기존 enemy lifecycle tick API 호환 alias입니다. */
    getNextEnemyLifecycleFixedTick() {
        return this.getNextGpuLifecycleFixedTick();
    }

    /** @returns {GameSystem} 벤치마크·진단용 현재 session system입니다. */
    getGameSystem() {
        return this.gameSystem;
    }

    /** @returns {string|null} enter에서 불변으로 선택된 world authority mode입니다. */
    getSessionMode() {
        return this.gameSystem.getSessionMode();
    }

    #createGameSystem() {
        const gameSystem = new GameSystem(this.dependencies, {
            mapId: this.mapId,
            tileNavigationSource: this.tileNavigationSource,
            enemyWaveEnabled: this.enemyWaveEnabled,
            gameplayWorldActorsEnabled: this.gameplayWorldActorsEnabled,
            waveDefinition: this.waveDefinition,
            enemyPresentationProfile: this.enemyPresentationProfile,
            initialCameraZoom: this.initialCameraZoom,
            towerMaxHp: this.towerMaxHp,
            coreMaxIntegrity: this.coreMaxIntegrity
        });
        gameSystem.enter();
        return gameSystem;
    }

    /**
     * GPU 권위 상태를 snapshot으로 되감지 않고 restartable GPU world만 재시작합니다.
     * 같은 device generation에서 새 session이 한 tick도 성공하지 못하면 재시작을 반복하지 않습니다.
     * @returns {boolean} 새 session으로 교체했는지 여부입니다.
     */
    #restartAtSafeWaveBoundary() {
        const platformState = this.dependencies.webGpuPlatformPort?.getState?.();
        if (!platformState?.ready) {
            return false;
        }
        const deviceGeneration = Number.isSafeInteger(platformState.deviceGeneration)
            ? platformState.deviceGeneration
            : 0;
        if (this.recoveryRestartGeneration === deviceGeneration) {
            return false;
        }
        let recoveryDiagnostic = null;
        try {
            recoveryDiagnostic = this.dependencies.recoveryLogPort?.capture?.({
                gameSystem: this.gameSystem,
                mapId: this.mapId,
                deviceGeneration,
                sceneRecovery: this.getEnemyRecoveryStatus()
            }) ?? null;
        } catch (error) {
            console.error('GPU world reset diagnostic capture failed:', error);
        }
        if (!this.gameSystem.restartGpuWorldAtSafeWaveBoundary()) {
            return false;
        }
        this.recoveryRestartGeneration = deviceGeneration;
        this.recoveryRestartCount++;
        if (recoveryDiagnostic) {
            try {
                this.dependencies.recoveryLogPort?.write?.(Object.freeze({
                    ...recoveryDiagnostic,
                    reset: Object.freeze({
                        succeeded: true,
                        deviceGeneration,
                        restartCount: this.recoveryRestartCount
                    })
                }));
            } catch (error) {
                console.error('GPU world reset diagnostic write failed:', error);
            }
        }
        return true;
    }
}
