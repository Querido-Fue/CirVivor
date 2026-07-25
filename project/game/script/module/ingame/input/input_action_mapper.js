import { PLAYER_ACTION_TYPES } from '../contract/player_controllable_contract.js';
import { INPUT_ACTION_IDS } from 'input/_input_binding_constants.js';

const DIAGONAL_AXIS_SCALE = Math.SQRT1_2;
const MAX_WHEEL_ACTION_DELTA = 12;

/**
 * 입력 소스에서 지정한 의미 방향의 현재 눌림 상태를 읽습니다.
 * @param {{isPressed:(actionId:string)=>boolean}|((actionId:string)=>boolean)} inputSource - 입력 소스입니다.
 * @param {string} actionId - 조회할 의미 action ID입니다.
 * @returns {boolean} 현재 눌림 여부입니다.
 */
function isInputPressed(inputSource, actionId) {
    if (typeof inputSource === 'function') {
        return inputSource(actionId) === true;
    }
    return inputSource?.isPressed?.(actionId) === true;
}

/**
 * @class InputActionMapper
 * @description 의미 action과 누적 wheel을 재사용 가능한 PlayerAction으로 변환합니다.
 */
export class InputActionMapper {
    constructor() {
        this.moveAction = {
            type: PLAYER_ACTION_TYPES.MOVE_VECTOR,
            payload: { x: 0, y: 0 }
        };
        this.cameraZoomAction = {
            type: PLAYER_ACTION_TYPES.CAMERA_ZOOM,
            payload: {
                wheelDelta: 0
            }
        };
        this.wheelTotals = { x: 0, y: 0 };
        this.lastWheelY = 0;
        this.wheelBaselineInitialized = false;
    }

    /**
     * 방향 입력을 합성하고 대각선 속도를 정규화합니다.
     * 반환 객체와 payload는 fixed tick마다 재사용됩니다.
     * @param {{isPressed:(actionId:string)=>boolean}|((actionId:string)=>boolean)} inputSource - 입력 소스입니다.
     * @returns {{type:string, payload:{x:number,y:number}}} MOVE_VECTOR action입니다.
     */
    mapMoveAction(inputSource) {
        let x = Number(isInputPressed(inputSource, INPUT_ACTION_IDS.MOVE_RIGHT))
            - Number(isInputPressed(inputSource, INPUT_ACTION_IDS.MOVE_LEFT));
        let y = Number(isInputPressed(inputSource, INPUT_ACTION_IDS.MOVE_DOWN))
            - Number(isInputPressed(inputSource, INPUT_ACTION_IDS.MOVE_UP));

        if (x !== 0 && y !== 0) {
            x *= DIAGONAL_AXIS_SCALE;
            y *= DIAGONAL_AXIS_SCALE;
        }

        this.moveAction.payload.x = x;
        this.moveAction.payload.y = y;
        return this.moveAction;
    }

    /**
     * 현재 누적 wheel 값을 기준점으로 삼아 씬 진입 전 스크롤을 무시합니다.
     * @param {{getWheelTotals?:(out:object)=>object}} inputSource - 입력 소스입니다.
     * @returns {void}
     */
    primeWheelBaseline(inputSource) {
        this.#readWheelTotals(inputSource);
        this.lastWheelY = this.wheelTotals.y;
        this.wheelBaselineInitialized = true;
    }

    /**
     * 누적 wheel 차이를 CAMERA_ZOOM 의미 입력으로 변환합니다.
     * @param {{getWheelTotals?:(out:object)=>object}} inputSource - 입력 소스입니다.
     * @returns {{type:string,payload:{wheelDelta:number}}|null} 새 wheel 입력이 없으면 null입니다.
     */
    mapCameraZoomAction(inputSource) {
        this.#readWheelTotals(inputSource);
        if (!this.wheelBaselineInitialized) {
            this.lastWheelY = this.wheelTotals.y;
            this.wheelBaselineInitialized = true;
            return null;
        }

        const rawWheelDelta = this.wheelTotals.y - this.lastWheelY;
        this.lastWheelY = this.wheelTotals.y;
        if (!Number.isFinite(rawWheelDelta) || rawWheelDelta === 0) {
            return null;
        }

        this.cameraZoomAction.payload.wheelDelta = Math.max(
            -MAX_WHEEL_ACTION_DELTA,
            Math.min(MAX_WHEEL_ACTION_DELTA, rawWheelDelta)
        );
        return this.cameraZoomAction;
    }

    /**
     * 입력 소스의 누적 wheel 값을 재사용 scratch에 기록합니다.
     * @param {{getWheelTotals?:(out:object)=>object}} inputSource - 입력 소스입니다.
     * @returns {void}
     * @private
     */
    #readWheelTotals(inputSource) {
        const wheelResult = inputSource?.getWheelTotals?.(this.wheelTotals);
        if (wheelResult && wheelResult !== this.wheelTotals) {
            this.wheelTotals.x = wheelResult.x;
            this.wheelTotals.y = wheelResult.y;
        }
        const wheelX = Number(this.wheelTotals.x);
        const wheelY = Number(this.wheelTotals.y);
        this.wheelTotals.x = Number.isFinite(wheelX) ? wheelX : this.lastWheelX;
        this.wheelTotals.y = Number.isFinite(wheelY) ? wheelY : this.lastWheelY;
    }
}
