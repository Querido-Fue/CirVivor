import { THE_CORE_DATA } from 'data/object/core/the_core_data.js';
import { InputActionMapper } from './input/input_action_mapper.js';
import { CameraZoomController } from './input/camera_zoom_controller.js';
import { PlayerControlRouter } from './input/player_control_router.js';
import { GameObjectSystem } from './object/game_object_system.js';
import { TowerCombatRoster } from './object/tower/tower_combat_roster.js';
import { CoreIntegrity } from './state/core_integrity.js';
import {
    GAME_WORLD_SESSION_MODE,
    selectGameWorldSessionMode
} from './game_world_session_mode.js';

/**
 * @class GameSystem
 * @description 한 인게임 세션의 현재 최소 구현을 소유하고 입력·오브젝트 실행 순서를 조정합니다.
 */
export class GameSystem {
    /**
     * @param {object} dependencies - 엔진 adapter로부터 주입된 의존성입니다.
     * @param {{isPressed:(actionId:string)=>boolean,getPointerPosition:(out:{x:number,y:number})=>{x:number,y:number},isPrimaryPointerPressed:()=>boolean,getWheelTotals:(out:object)=>object}} dependencies.inputActionSource - 의미 입력 소스입니다.
     * @param {{animate:(owner:object,properties:object)=>object}} dependencies.animationPort - 표현 애니메이션 포트입니다.
     * @param {{getDelta?:()=>number,getFixedDelta:()=>number,getFixedInterpolationAlpha:()=>number}} dependencies.timePort - 시간 포트입니다.
     * @param {{getSnapshot:(out?:object)=>object}} dependencies.viewportPort - 표시 뷰포트 포트입니다.
     * @param {{drawCircle:(options:object)=>void,drawSquareInstances:(options:object)=>void}} dependencies.worldRenderPort - 월드 렌더 포트입니다.
     * @param {{mapId?:string|null,tileNavigationSource?:object|null,enemyWaveEnabled?:boolean,gameplayWorldActorsEnabled?:boolean,waveDefinition?:object,enemyPresentationProfile?:string,initialCameraZoom?:number}} [options={}] - 세션 시작 옵션입니다.
     */
    constructor(dependencies, options = {}) {
        if (!dependencies?.inputActionSource
            || typeof dependencies.inputActionSource.isPressed !== 'function'
            || typeof dependencies.inputActionSource.getPointerPosition !== 'function'
            || typeof dependencies.inputActionSource.isPrimaryPointerPressed !== 'function'
            || typeof dependencies.inputActionSource.getWheelTotals !== 'function'
            || typeof dependencies?.animationPort?.animate !== 'function'
            || typeof dependencies?.timePort?.getFixedDelta !== 'function'
            || typeof dependencies?.timePort?.getFixedInterpolationAlpha !== 'function'
            || typeof dependencies?.viewportPort?.getSnapshot !== 'function'
            || typeof dependencies?.worldRenderPort?.drawCircle !== 'function'
            || typeof dependencies?.worldRenderPort?.drawSquareInstances !== 'function') {
            throw new TypeError('GameSystem 필수 dependency port가 누락되었습니다.');
        }

        this.dependencies = dependencies;
        this.inputActionMapper = new InputActionMapper();
        this.playerControlRouter = new PlayerControlRouter();
        this.coreIntegrity = new CoreIntegrity({
            maxIntegrity: THE_CORE_DATA.MAX_INTEGRITY
        });
        this.initialCameraZoom = options.initialCameraZoom;
        this.objectSystemOptions = Object.freeze({
            mapId: options.mapId,
            tileNavigationSource: options.tileNavigationSource,
            coreIntegrity: this.coreIntegrity,
            enemyWaveEnabled: options.enemyWaveEnabled,
            gameplayWorldActorsEnabled: options.gameplayWorldActorsEnabled,
            waveDefinition: options.waveDefinition,
            enemyPresentationProfile: options.enemyPresentationProfile
        });
        this.objectSystem = null;
        this.towerCombatRoster = null;
        this.sessionMode = null;
        this.cameraZoomController = null;
        this.registrationTokens = [];
        this.viewportSnapshot = { ww: 0, wh: 0 };
        this.fixedTick = 0;
        this.entered = false;
        this.destroyed = false;
    }

    /**
     * 월드를 생성하고 오브젝트의 IPlayerControllable 컴포넌트를 라우터에 등록합니다.
     * @returns {boolean} 최초 진입을 수행했는지 여부입니다.
     */
    enter() {
        if (this.entered || this.destroyed) {
            return false;
        }
        const sessionMode = selectGameWorldSessionMode(
            this.dependencies.webGpuPlatformPort
        );
        Object.defineProperty(this, 'sessionMode', {
            value: sessionMode,
            writable: false,
            configurable: false,
            enumerable: true
        });
        this.towerCombatRoster = sessionMode === GAME_WORLD_SESSION_MODE.GPU_WORLD
            ? new TowerCombatRoster()
            : null;
        this.objectSystem = new GameObjectSystem(this.dependencies, {
            ...this.objectSystemOptions,
            sessionMode,
            towerCombatRoster: this.towerCombatRoster
        });
        this.#syncViewportSnapshot();
        this.objectSystem.init(this.viewportSnapshot);
        if (this.initialCameraZoom !== undefined) {
            this.objectSystem.getWorldViewProjection().zoom
                = this.initialCameraZoom;
        }
        this.cameraZoomController = new CameraZoomController(
            this.objectSystem.getWorldViewProjection(),
            this.dependencies.animationPort,
            this.objectSystem.getCameraFollowTarget()
        );

        const controllables = this.objectSystem.getPlayerControllables();
        for (let index = 0; index < controllables.length; index++) {
            this.registrationTokens.push(this.playerControlRouter.register(controllables[index]));
        }
        this.registrationTokens.push(
            this.playerControlRouter.register(this.cameraZoomController)
        );
        this.inputActionMapper.primeWheelBaseline(
            this.dependencies.inputActionSource
        );
        this.entered = true;
        return true;
    }

    /**
     * 같은 fixed input snapshot에서 이동·primary pointer 의미 입력을 순서대로 전달한 뒤
     * 오브젝트 fixed-step을 실행합니다.
     * @returns {boolean} GPU 적과 플레이어가 같은 fixed tick을 완료했는지 여부입니다.
     */
    fixedUpdate() {
        if (!this.entered || this.destroyed) {
            return false;
        }
        const moveAction = this.inputActionMapper.mapMoveAction(
            this.dependencies.inputActionSource
        );
        const primaryPointerFireAction = this.inputActionMapper
            .mapPrimaryPointerFireAction(this.dependencies.inputActionSource);
        this.playerControlRouter.dispatch(moveAction);
        this.playerControlRouter.dispatch(primaryPointerFireAction);
        const proposedFixedTick = this.fixedTick + 1;
        const advanced = this.objectSystem.fixedUpdate(
            this.dependencies.timePort.getFixedDelta(),
            proposedFixedTick
        );
        if (advanced) {
            this.fixedTick = proposedFixedTick;
        }
        return advanced;
    }

    /**
     * 현재 보간 계수로 표현 좌표만 갱신합니다.
     * @returns {void}
     */
    update() {
        if (!this.entered || this.destroyed) {
            return;
        }
        const cameraZoomAction = this.inputActionMapper.mapCameraZoomAction(
            this.dependencies.inputActionSource
        );
        if (cameraZoomAction) {
            this.playerControlRouter.dispatch(cameraZoomAction);
        }
        const frameDelta = typeof this.dependencies.timePort.getDelta === 'function'
            ? this.dependencies.timePort.getDelta()
            : 0;
        this.objectSystem.update(
            this.dependencies.timePort.getFixedInterpolationAlpha(),
            frameDelta,
            this.dependencies.timePort.getFixedDelta()
        );
        this.cameraZoomController.updateFollowTarget();
    }

    /**
     * 월드 렌더 명령을 제출합니다.
     * @returns {void}
     */
    draw() {
        if (!this.entered || this.destroyed) {
            return;
        }
        this.objectSystem.draw();
    }

    /**
     * map·Core·Tower 합성 없이 GPU 적 layer만 오브젝트 소유자에게 위임합니다.
     * @returns {boolean} GPU draw 제출 여부입니다.
     */
    drawEnemySimulation() {
        if (!this.entered || this.destroyed) {
            return false;
        }
        return this.objectSystem.drawEnemySimulation();
    }

    /**
     * 현재 월드를 초기화하지 않고 뷰포트 경계만 동기화합니다.
     * @returns {void}
     */
    resize() {
        if (!this.entered || this.destroyed) {
            return;
        }
        this.#syncViewportSnapshot();
        this.objectSystem.resize(this.viewportSnapshot);
    }

    /**
     * 현재 단계에서 아직 지원하지 않는 외부 시뮬레이션 command를 안전하게 무시합니다.
     * @param {object[]} [commands=[]] - 전달된 command 목록입니다.
     * @returns {object[]} 현재는 항상 빈 처리 결과입니다.
     */
    handleCommands(commands = []) {
        void commands;
        return [];
    }

    /**
     * 테스트·디버그용으로 현재 오브젝트 시스템 참조를 반환합니다.
     * @returns {GameObjectSystem} 세션 오브젝트 시스템입니다.
     */
    getObjectSystem() {
        return this.objectSystem;
    }

    /** @returns {string|null} enter에서 고정한 world authority mode입니다. */
    getSessionMode() {
        return this.sessionMode;
    }

    /**
     * gameplay adapter가 mixed-body GPU lifecycle request와 상태를 연결할 공개 endpoint입니다.
     * commit/tick/presentation/draw는 이 GameSystem의 실행 경로가 소유합니다.
     * @returns {import('./object/enemy/gpu_enemy_simulation_endpoint.js').GpuSimulationEndpoint}
     */
    getGpuSimulationEndpoint() {
        return this.objectSystem.getGpuSimulationEndpoint();
    }

    /** @returns {import('./object/enemy/gpu_enemy_simulation_endpoint.js').GpuSimulationEndpoint} 기존 enemy API 호환 alias입니다. */
    getEnemySimulationEndpoint() {
        return this.getGpuSimulationEndpoint();
    }

    /**
     * 세션 생존 자원인 ICoreIntegrity를 반환합니다.
     * @returns {CoreIntegrity} Core Integrity component입니다.
     */
    getCoreIntegrity() {
        return this.coreIntegrity;
    }

    /**
     * HUD·테스트가 읽을 수 있는 불변 GPU Tower combat snapshot입니다.
     * CPU fallback의 Tower HP 정책은 아직 OPEN이므로 해당 mode에서는 null입니다.
     * @returns {object|null} GPU_WORLD의 bounded Tower combat status입니다.
     */
    getTowerCombatStatus() {
        return this.towerCombatRoster?.getStatus() ?? null;
    }

    /** GPU_WORLD의 lifecycle 기반 hostile attack producer 상태입니다. */
    getHostileAttackStatus() {
        return this.objectSystem?.getHostileAttackStatus() ?? null;
    }

    /** @returns {number} 세션 전체가 완료한 fixed tick입니다. */
    getFixedTick() {
        return this.fixedTick;
    }

    /**
     * gameplay adapter가 새 GPU spawn/despawn을 예약할 수 있는 가장 이른 fixed tick입니다.
     * @returns {number} 현재 열린 다음 GPU lifecycle 경계입니다.
     */
    getNextGpuLifecycleFixedTick() {
        return this.objectSystem.getNextGpuLifecycleFixedTick();
    }

    /** @returns {number} 기존 enemy lifecycle tick API 호환 alias입니다. */
    getNextEnemyLifecycleFixedTick() {
        return this.getNextGpuLifecycleFixedTick();
    }

    /**
     * 테스트·디버그용으로 카메라 의미 입력 제어기를 반환합니다.
     * @returns {CameraZoomController|null} 진입 후 생성된 카메라 zoom 제어기입니다.
     */
    getCameraZoomController() {
        return this.cameraZoomController;
    }

    /** pause/resume 경계에서 GPU 적 표현 clock의 남은 예측 시간을 제거합니다. */
    synchronizePresentation() {
        this.objectSystem.synchronizeEnemyPresentation();
    }

    /** @returns {boolean} 현재 wave를 안전 경계에서 재시작해야 하는 hard GPU failure 여부입니다. */
    isEnemySimulationRecoveryRequired() {
        return this.objectSystem?.isEnemySimulationRecoveryRequired() ?? false;
    }

    /** @returns {boolean} canonical GPU world recovery 상태입니다. */
    isGpuWorldRecoveryRequired() {
        return this.isEnemySimulationRecoveryRequired();
    }

    /** CPU domain을 유지한 채 restartable GPU world만 safe boundary에서 교체합니다. */
    restartGpuWorldAtSafeWaveBoundary() {
        if (!this.entered || this.destroyed) {
            return false;
        }
        return this.objectSystem.restartGpuWorldAtSafeWaveBoundary();
    }

    /** 기존 enemy 명칭 호환 alias입니다. */
    restartEnemyGpuWorldAtSafeWaveBoundary() {
        return this.restartGpuWorldAtSafeWaveBoundary();
    }

    /**
     * 입력 등록과 세션 오브젝트를 역순으로 정리합니다.
     * 반복 호출해도 안전합니다.
     * @returns {void}
     */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        for (let index = this.registrationTokens.length - 1; index >= 0; index--) {
            this.registrationTokens[index].dispose();
        }
        this.registrationTokens.length = 0;
        this.playerControlRouter.destroy();
        this.cameraZoomController?.destroy();
        this.cameraZoomController = null;
        this.objectSystem?.destroy();
        this.objectSystem = null;
        this.towerCombatRoster?.destroy();
        this.towerCombatRoster = null;
        this.fixedTick = 0;
        this.entered = false;
    }

    /**
     * viewport port의 값을 재사용 snapshot에 기록합니다.
     * @returns {void}
     * @private
     */
    #syncViewportSnapshot() {
        const snapshot = this.dependencies.viewportPort.getSnapshot(this.viewportSnapshot);
        if (snapshot && snapshot !== this.viewportSnapshot) {
            this.viewportSnapshot.ww = snapshot.ww;
            this.viewportSnapshot.wh = snapshot.wh;
        }
    }
}
