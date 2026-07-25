import {
    INPUT_DISPOSITIONS,
    PLAYER_ACTION_TYPES,
    PLAYER_CONTROL_CONTEXTS
} from '../contract/player_controllable_contract.js';

/**
 * @class TowerPlayerController
 * @description The Tower에 부착되어 PlayerAction을 이동 의도로 변환하는 IPlayerControllable 구현입니다.
 */
export class TowerPlayerController {
    /**
     * @param {import('./the_tower.js').TheTower} tower - 제어할 Tower입니다.
     */
    constructor(tower) {
        if (!tower || typeof tower.setMoveIntent !== 'function') {
            throw new TypeError('TowerPlayerController에는 이동 가능한 Tower가 필요합니다.');
        }
        this.controlTargetId = 'tower.primary';
        this.tower = tower;
        this.enabled = true;
    }

    /**
     * 이 제어 대상이 속한 입력 문맥을 반환합니다.
     * @returns {string} gameplay 문맥입니다.
     */
    getControlContext() {
        return PLAYER_CONTROL_CONTEXTS.GAMEPLAY;
    }

    /**
     * 같은 문맥 안에서의 입력 우선순위를 반환합니다.
     * @returns {number} 입력 우선순위입니다.
     */
    getInputPriority() {
        return 0;
    }

    /**
     * 현재 Tower가 플레이어 입력을 받을 수 있는지 반환합니다.
     * @returns {boolean} 제어 가능 여부입니다.
     */
    isControlEnabled() {
        return this.enabled && this.tower?.active === true;
    }

    /**
     * MOVE_VECTOR action을 Tower의 이동 의도로 기록합니다.
     * @param {{type:string,payload?:{x?:number,y?:number}}} action - 의미 입력입니다.
     * @returns {string} INPUT_DISPOSITIONS 값입니다.
     */
    handlePlayerAction(action) {
        if (action?.type !== PLAYER_ACTION_TYPES.MOVE_VECTOR) {
            return INPUT_DISPOSITIONS.PASS;
        }
        this.tower.setMoveIntent(action.payload?.x, action.payload?.y);
        return INPUT_DISPOSITIONS.CONSUMED;
    }

    /**
     * 제어를 해제하고 Tower에 남은 이동 의도를 제거합니다.
     * @returns {void}
     */
    destroy() {
        if (!this.tower) {
            return;
        }
        this.enabled = false;
        this.tower.setMoveIntent(0, 0);
        this.tower = null;
    }
}
