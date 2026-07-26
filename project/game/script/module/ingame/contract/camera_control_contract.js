/**
 * contain 배율에 곱하는 ICameraControl2D 공통 zoom 범위입니다.
 * 렌더·입력 동작 계약이므로 gameplay data가 아니라 카메라 계약이 소유합니다.
 */
export const CAMERA_ZOOM_LIMITS = Object.freeze({
    MIN: 0.7,
    DEFAULT: 0.7,
    MAX: 3
});

/**
 * 값이 보간된 월드 추종 좌표를 제공하는 ICameraFollowTarget2D인지 확인합니다.
 * @param {*} target - 검사할 대상입니다.
 * @returns {boolean} 인터페이스 충족 여부입니다.
 */
export function isCameraFollowTarget2D(target) {
    return Boolean(
        target
        && typeof target === 'object'
        && typeof target.cameraFollowTargetId === 'string'
        && target.cameraFollowTargetId.length > 0
        && typeof target.isCameraFollowEnabled === 'function'
        && typeof target.copyCameraFollowPositionInto === 'function'
    );
}

/**
 * ICameraFollowTarget2D 계약을 확인하고 같은 대상을 반환합니다.
 * @param {*} target - 확인할 대상입니다.
 * @returns {*} 확인을 통과한 원본 대상입니다.
 * @throws {TypeError} 계약을 만족하지 않을 때 발생합니다.
 */
export function assertCameraFollowTarget2D(target) {
    if (!isCameraFollowTarget2D(target)) {
        throw new TypeError(
            'ICameraFollowTarget2D 계약을 만족하지 않는 대상입니다.'
        );
    }
    return target;
}

/**
 * 값이 zoom과 월드 중심 이동을 제공하는 ICameraControl2D인지 확인합니다.
 * 렌더 전용 IWorldViewProjection2D와 분리해 renderer가 카메라 제어 권한을
 * 요구하지 않도록 합니다.
 * @param {*} camera - 검사할 카메라입니다.
 * @returns {boolean} 인터페이스 충족 여부입니다.
 */
export function isCameraControl2D(camera) {
    return Boolean(
        camera
        && typeof camera === 'object'
        && 'zoom' in camera
        && typeof camera.getZoom === 'function'
        && typeof camera.centerOnWorldPoint === 'function'
        && typeof camera.resetViewCenter === 'function'
    );
}

/**
 * ICameraControl2D 계약을 확인하고 같은 카메라를 반환합니다.
 * @param {*} camera - 확인할 카메라입니다.
 * @returns {*} 확인을 통과한 원본 카메라입니다.
 * @throws {TypeError} 계약을 만족하지 않을 때 발생합니다.
 */
export function assertCameraControl2D(camera) {
    if (!isCameraControl2D(camera)) {
        throw new TypeError('ICameraControl2D 계약을 만족하지 않는 카메라입니다.');
    }
    return camera;
}
