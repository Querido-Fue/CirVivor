import {
    INPUT_DISPOSITIONS,
    PLAYER_ACTION_TYPES,
    PLAYER_CONTROL_CONTEXTS
} from '../contract/player_controllable_contract.js';
import {
    CAMERA_ZOOM_LIMITS,
    assertCameraControl2D,
    assertCameraFollowTarget2D
} from '../contract/camera_control_contract.js';

const ZOOM_RATIO_PER_WHEEL_UNIT = 1.16;
const ZOOM_ANIMATION_DURATION_SECONDS = 0.4;
const ZOOM_ANIMATION_EASING = 'easeOutExpo';
const CAMERA_ZOOM_INPUT_PRIORITY = 100;
const CAMERA_FOLLOW_ZOOM_EPSILON = 1e-9;

/**
 * 값을 카메라 zoom 범위로 제한합니다.
 * @param {*} value - 제한할 값입니다.
 * @param {number} fallback - 유효하지 않을 때의 값입니다.
 * @returns {number} 제한된 zoom입니다.
 */
function clampCameraZoom(value, fallback) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return fallback;
    }
    return Math.max(
        CAMERA_ZOOM_LIMITS.MIN,
        Math.min(CAMERA_ZOOM_LIMITS.MAX, numericValue)
    );
}

/**
 * @class CameraZoomController
 * @description CAMERA_ZOOM을 Tower 추종 WorldCamera2D retarget 애니메이션으로 변환합니다.
 */
export class CameraZoomController {
    /**
     * @param {object} camera - ICameraControl2D입니다.
     * @param {{animate:(owner:object,properties:object)=>object}} animationPort - 애니메이션 포트입니다.
     * @param {object} followTarget - 보간 월드 좌표를 제공하는 ICameraFollowTarget2D입니다.
     */
    constructor(camera, animationPort, followTarget) {
        if (!animationPort
            || typeof animationPort.animate !== 'function') {
            throw new TypeError('CameraZoomController 필수 port가 누락되었습니다.');
        }

        this.controlTargetId = 'game-camera-zoom';
        this.camera = assertCameraControl2D(camera);
        this.followTarget = assertCameraFollowTarget2D(followTarget);
        this.animationPort = animationPort;
        this.animationHandle = null;
        this.followPosition = { x: 0, y: 0 };
        this.following = false;
        this.targetZoom = clampCameraZoom(
            camera.getZoom(),
            CAMERA_ZOOM_LIMITS.DEFAULT
        );
        this.enabled = true;
        this.animationProperties = {
            variable: 'zoom',
            startValue: 'current',
            endValue: this.targetZoom,
            duration: ZOOM_ANIMATION_DURATION_SECONDS,
            type: ZOOM_ANIMATION_EASING
        };
    }

    /** @returns {string} gameplay 제어 문맥입니다. */
    getControlContext() {
        return PLAYER_CONTROL_CONTEXTS.GAMEPLAY;
    }

    /** @returns {number} Tower 이동보다 먼저 zoom action을 소비할 우선순위입니다. */
    getInputPriority() {
        return CAMERA_ZOOM_INPUT_PRIORITY;
    }

    /** @returns {boolean} 현재 입력 처리 가능 여부입니다. */
    isControlEnabled() {
        return this.enabled;
    }

    /**
     * wheel 방향을 누적 목표 zoom으로 변환하고 현재 애니메이션을 제자리 retarget합니다.
     * @param {object} action - PlayerAction입니다.
     * @returns {string} INPUT_DISPOSITIONS 값입니다.
     */
    handlePlayerAction(action) {
        if (!this.enabled || action?.type !== PLAYER_ACTION_TYPES.CAMERA_ZOOM) {
            return INPUT_DISPOSITIONS.PASS;
        }

        const wheelDelta = Number(action.payload?.wheelDelta);
        if (!Number.isFinite(wheelDelta) || wheelDelta === 0) {
            return INPUT_DISPOSITIONS.PASS;
        }

        const nextTargetZoom = clampCameraZoom(
            this.targetZoom * Math.pow(ZOOM_RATIO_PER_WHEEL_UNIT, -wheelDelta),
            this.targetZoom
        );
        if (Object.is(nextTargetZoom, this.targetZoom)) {
            return INPUT_DISPOSITIONS.CONSUMED;
        }

        this.targetZoom = nextTargetZoom;
        this.animationProperties.endValue = nextTargetZoom;
        this.updateFollowTarget();

        if (this.animationHandle?.retarget?.(this.animationProperties) !== true) {
            this.animationHandle?.remove?.();
            this.animationHandle = this.animationPort.animate(
                this.camera,
                this.animationProperties
            );
        }
        return INPUT_DISPOSITIONS.CONSUMED;
    }

    /** @returns {number} 연속 wheel 입력이 누적되는 최신 목표 zoom입니다. */
    getTargetZoom() {
        return this.targetZoom;
    }

    /**
     * 확대 중 활성 follow target의 보간 좌표를 viewport 중앙에 배치합니다.
     * 기본 zoom으로 복귀하면 맵 중심으로 되돌립니다.
     * @returns {boolean} 카메라 중심 변경 여부입니다.
     */
    updateFollowTarget() {
        if (!this.enabled) {
            return false;
        }

        const currentZoom = clampCameraZoom(
            this.camera.getZoom(),
            CAMERA_ZOOM_LIMITS.DEFAULT
        );
        const shouldFollow = currentZoom
            > CAMERA_ZOOM_LIMITS.DEFAULT + CAMERA_FOLLOW_ZOOM_EPSILON
            || this.targetZoom
            > CAMERA_ZOOM_LIMITS.DEFAULT + CAMERA_FOLLOW_ZOOM_EPSILON;
        if (!shouldFollow) {
            if (!this.following) {
                return false;
            }
            this.following = false;
            return this.camera.resetViewCenter();
        }
        if (this.followTarget.isCameraFollowEnabled() !== true) {
            return false;
        }

        const positionResult = this.followTarget.copyCameraFollowPositionInto(
            this.followPosition
        );
        if (positionResult && positionResult !== this.followPosition) {
            this.followPosition.x = positionResult.x;
            this.followPosition.y = positionResult.y;
        }
        const worldX = Number(this.followPosition.x);
        const worldY = Number(this.followPosition.y);
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) {
            return false;
        }

        this.following = true;
        return this.camera.centerOnWorldPoint(worldX, worldY);
    }

    /**
     * 진행 중 애니메이션과 참조를 정리합니다.
     * 반복 호출해도 안전합니다.
     * @returns {void}
     */
    destroy() {
        if (!this.enabled) {
            return;
        }
        this.enabled = false;
        this.animationHandle?.remove?.();
        this.animationHandle = null;
        this.camera = null;
        this.followTarget = null;
        this.followPosition = null;
        this.animationPort = null;
    }
}
