import { PLAYER_ACTION_TYPES } from '../contract/player_controllable_contract.js';

const DIAGONAL_AXIS_SCALE = Math.SQRT1_2;

/**
 * 입력 소스에서 지정한 의미 방향의 현재 눌림 상태를 읽습니다.
 * @param {{isPressed:(key:string)=>boolean}|((key:string)=>boolean)} inputSource - 입력 소스입니다.
 * @param {string} key - 조회할 내부 방향 키입니다.
 * @returns {boolean} 현재 눌림 여부입니다.
 */
function isInputPressed(inputSource, key) {
    if (typeof inputSource === 'function') {
        return inputSource(key) === true;
    }
    return inputSource?.isPressed?.(key) === true;
}

/**
 * @class InputActionMapper
 * @description 내부 방향 키 상태를 재사용 가능한 MOVE_VECTOR 의미 입력으로 변환합니다.
 */
export class InputActionMapper {
    constructor() {
        this.moveAction = {
            type: PLAYER_ACTION_TYPES.MOVE_VECTOR,
            payload: { x: 0, y: 0 }
        };
    }

    /**
     * 방향 입력을 합성하고 대각선 속도를 정규화합니다.
     * 반환 객체와 payload는 fixed tick마다 재사용됩니다.
     * @param {{isPressed:(key:string)=>boolean}|((key:string)=>boolean)} inputSource - 입력 소스입니다.
     * @returns {{type:string, payload:{x:number,y:number}}} MOVE_VECTOR action입니다.
     */
    mapMoveAction(inputSource) {
        let x = Number(isInputPressed(inputSource, 'right'))
            - Number(isInputPressed(inputSource, 'left'));
        let y = Number(isInputPressed(inputSource, 'down'))
            - Number(isInputPressed(inputSource, 'up'));

        if (x !== 0 && y !== 0) {
            x *= DIAGONAL_AXIS_SCALE;
            y *= DIAGONAL_AXIS_SCALE;
        }

        this.moveAction.payload.x = x;
        this.moveAction.payload.y = y;
        return this.moveAction;
    }
}
