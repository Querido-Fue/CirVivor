/**
 * 플레이어 입력을 받을 수 있는 제어 문맥입니다.
 * 배열의 뒤쪽 문맥일수록 더 높은 입력 우선권을 가집니다.
 * @type {Readonly<Record<string, string>>}
 */
export const PLAYER_CONTROL_CONTEXTS = Object.freeze({
    GAMEPLAY: 'gameplay',
    STATUS_OVERLAY: 'statusOverlay',
    SHOP: 'shop',
    MODAL: 'modal',
    PAUSE_MENU: 'pauseMenu',
    SYSTEM: 'system'
});

/**
 * 물리 키와 분리된 플레이어 의미 입력 종류입니다.
 * @type {Readonly<Record<string, string>>}
 */
export const PLAYER_ACTION_TYPES = Object.freeze({
    MOVE_VECTOR: 'moveVector',
    PRIMARY_POINTER_FIRE: 'primaryPointerFire',
    CAMERA_ZOOM: 'cameraZoom'
});

/**
 * 제어 대상의 입력 처리 결과입니다.
 * @type {Readonly<Record<string, string>>}
 */
export const INPUT_DISPOSITIONS = Object.freeze({
    PASS: 'pass',
    HANDLED: 'handled',
    CONSUMED: 'consumed'
});

/**
 * 값이 PlayerAction의 최소 계약을 만족하는지 확인합니다.
 * @param {*} action - 검사할 의미 입력입니다.
 * @returns {boolean} 유효한 PlayerAction 여부입니다.
 */
export function isPlayerAction(action) {
    return Boolean(
        action
        && typeof action === 'object'
        && typeof action.type === 'string'
        && action.type.length > 0
    );
}

/**
 * 값이 IPlayerControllable 런타임 계약을 만족하는지 확인합니다.
 * @param {*} target - 검사할 제어 대상입니다.
 * @returns {boolean} 인터페이스 충족 여부입니다.
 */
export function isPlayerControllable(target) {
    return Boolean(
        target
        && typeof target === 'object'
        && typeof target.controlTargetId === 'string'
        && target.controlTargetId.length > 0
        && typeof target.getControlContext === 'function'
        && typeof target.getInputPriority === 'function'
        && typeof target.isControlEnabled === 'function'
        && typeof target.handlePlayerAction === 'function'
    );
}

/**
 * IPlayerControllable 계약을 확인하고 같은 대상을 반환합니다.
 * @param {*} target - 확인할 제어 대상입니다.
 * @returns {*} 확인을 통과한 원본 대상입니다.
 * @throws {TypeError} 대상이 인터페이스 계약을 만족하지 않을 때 발생합니다.
 */
export function assertPlayerControllable(target) {
    if (!isPlayerControllable(target)) {
        throw new TypeError('IPlayerControllable 계약을 만족하지 않는 제어 대상입니다.');
    }
    return target;
}

/**
 * 초기 외부 명칭과의 호환을 위한 검사 함수 별칭입니다.
 */
export const isPlayerControllerable = isPlayerControllable;
