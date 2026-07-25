import { InputActionMapper } from './input/input_action_mapper.js';
import { PlayerControlRouter } from './input/player_control_router.js';
import { GameObjectSystem } from './object/game_object_system.js';

/**
 * @class GameSystem
 * @description 한 인게임 세션의 현재 최소 구현을 소유하고 입력·오브젝트 실행 순서를 조정합니다.
 */
export class GameSystem {
    /**
     * @param {object} dependencies - 엔진 adapter로부터 주입된 의존성입니다.
     * @param {{isPressed:(key:string)=>boolean}} dependencies.inputActionSource - 방향 입력 소스입니다.
     * @param {{getFixedDelta:()=>number,getFixedInterpolationAlpha:()=>number}} dependencies.timePort - 시간 포트입니다.
     * @param {{getSnapshot:(out?:object)=>object}} dependencies.viewportPort - 뷰포트 포트입니다.
     * @param {{drawCircle:(options:object)=>void}} dependencies.worldRenderPort - 월드 렌더 포트입니다.
     */
    constructor(dependencies) {
        if (!dependencies?.inputActionSource
            || typeof dependencies.inputActionSource.isPressed !== 'function'
            || typeof dependencies?.timePort?.getFixedDelta !== 'function'
            || typeof dependencies?.timePort?.getFixedInterpolationAlpha !== 'function'
            || typeof dependencies?.viewportPort?.getSnapshot !== 'function'
            || typeof dependencies?.worldRenderPort?.drawCircle !== 'function') {
            throw new TypeError('GameSystem 필수 dependency port가 누락되었습니다.');
        }

        this.dependencies = dependencies;
        this.inputActionMapper = new InputActionMapper();
        this.playerControlRouter = new PlayerControlRouter();
        this.objectSystem = new GameObjectSystem(dependencies);
        this.registrationTokens = [];
        this.viewportSnapshot = { ww: 0, objectWH: 0, objectOffsetY: 0 };
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
        this.#syncViewportSnapshot();
        this.objectSystem.init(this.viewportSnapshot);

        const controllables = this.objectSystem.getPlayerControllables();
        for (let index = 0; index < controllables.length; index++) {
            this.registrationTokens.push(this.playerControlRouter.register(controllables[index]));
        }
        this.entered = true;
        return true;
    }

    /**
     * 방향 입력을 MOVE_VECTOR로 변환·전달한 뒤 오브젝트 fixed-step을 실행합니다.
     * @returns {void}
     */
    fixedUpdate() {
        if (!this.entered || this.destroyed) {
            return;
        }
        const moveAction = this.inputActionMapper.mapMoveAction(
            this.dependencies.inputActionSource
        );
        this.playerControlRouter.dispatch(moveAction);
        this.objectSystem.fixedUpdate(this.dependencies.timePort.getFixedDelta());
    }

    /**
     * 현재 보간 계수로 표현 좌표만 갱신합니다.
     * @returns {void}
     */
    update() {
        if (!this.entered || this.destroyed) {
            return;
        }
        this.objectSystem.update(this.dependencies.timePort.getFixedInterpolationAlpha());
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
        this.objectSystem.destroy();
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
            this.viewportSnapshot.objectWH = snapshot.objectWH;
            this.viewportSnapshot.objectOffsetY = snapshot.objectOffsetY;
        }
    }
}
