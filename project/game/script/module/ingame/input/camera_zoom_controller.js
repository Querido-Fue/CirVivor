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
import { ANIMATION_CATEGORY } from 'animation/_constants.js';

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
 * 값을 맵 중심과 follow target 사이의 보간 범위로 제한합니다.
 * @param {*} value - 제한할 blend 값입니다.
 * @param {number} fallback - 유효하지 않을 때의 값입니다.
 * @returns {number} 제한된 blend 값입니다.
 */
function clampCameraFollowBlend(value, fallback) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return fallback;
    }
    return Math.max(0, Math.min(1, numericValue));
}

/**
 * @class CameraZoomController
 * @description CAMERA_ZOOM과 맵 중심↔Tower 중심 전환을 별도 retarget 애니메이션으로 변환합니다.
 */
export class CameraZoomController {
    /**
     * @param {object} camera - ICameraControl2D입니다.
     * @param {{animate:(owner:object,properties:{animationCategory:string})=>object}} animationPort - 카테고리 포함 속성을 받는 애니메이션 포트입니다.
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
        this.followAnimationHandle = null;
        this.followPosition = { x: 0, y: 0 };
        this.followPositionCandidate = { x: 0, y: 0 };
        this.hasFollowPosition = false;
        this.targetZoom = clampCameraZoom(
            camera.getZoom(),
            CAMERA_ZOOM_LIMITS.DEFAULT
        );
        this.followBlend = this.targetZoom
            > CAMERA_ZOOM_LIMITS.DEFAULT + CAMERA_FOLLOW_ZOOM_EPSILON
            ? 1
            : 0;
        this.targetFollowBlend = this.followBlend;
        this.enabled = true;
        this.animationProperties = {
            animationCategory: ANIMATION_CATEGORY.GAME_MECHANIC,
            variable: 'zoom',
            startValue: 'current',
            endValue: this.targetZoom,
            duration: ZOOM_ANIMATION_DURATION_SECONDS,
            type: ZOOM_ANIMATION_EASING
        };
        this.followAnimationProperties = {
            animationCategory: ANIMATION_CATEGORY.GAME_MECHANIC,
            variable: 'followBlend',
            startValue: 'current',
            endValue: this.targetFollowBlend,
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

        if (this.animationHandle?.retarget?.(this.animationProperties) !== true) {
            this.animationHandle?.remove?.();
            this.animationHandle = this.animationPort.animate(
                this.camera,
                this.animationProperties
            );
        }
        this.updateFollowTarget();
        return INPUT_DISPOSITIONS.CONSUMED;
    }

    /** @returns {number} 연속 wheel 입력이 누적되는 최신 목표 zoom입니다. */
    getTargetZoom() {
        return this.targetZoom;
    }

    /**
     * target zoom 상태에 따라 맵 중심↔Tower 중심 전환을 한 번만 retarget합니다.
     * blend=1 이후에는 Tower의 보간 renderPosition을 기존처럼 즉시 추종합니다.
     * @returns {boolean} 카메라 중심 변경 여부입니다.
     */
    updateFollowTarget() {
        if (!this.enabled) {
            return false;
        }

        const targetRequestsFollow = this.targetZoom
            > CAMERA_ZOOM_LIMITS.DEFAULT + CAMERA_FOLLOW_ZOOM_EPSILON;
        let hasActiveFollowTarget = false;
        if (targetRequestsFollow
            && this.followTarget.isCameraFollowEnabled() === true) {
            this.followPositionCandidate.x = Number.NaN;
            this.followPositionCandidate.y = Number.NaN;
            const positionResult = this.followTarget.copyCameraFollowPositionInto(
                this.followPositionCandidate
            );
            const positionSource = positionResult
                && positionResult !== this.followPositionCandidate
                ? positionResult
                : this.followPositionCandidate;
            const worldX = Number(positionSource.x);
            const worldY = Number(positionSource.y);
            if (Number.isFinite(worldX) && Number.isFinite(worldY)) {
                this.followPosition.x = worldX;
                this.followPosition.y = worldY;
                this.hasFollowPosition = true;
                hasActiveFollowTarget = true;
            }
        }

        this.#retargetFollowBlend(hasActiveFollowTarget ? 1 : 0);
        if (!this.hasFollowPosition) {
            return false;
        }

        return this.camera.centerOnWorldPoint(
            this.followPosition.x,
            this.followPosition.y,
            clampCameraFollowBlend(this.followBlend, this.targetFollowBlend)
        );
    }

    /**
     * 맵 중심(0)과 Tower 중심(1) 사이의 전환 목표가 바뀔 때만 한 개의 handle을 재지정합니다.
     * @param {*} value - 새 follow blend 목표입니다.
     * @returns {boolean} 목표 또는 handle이 실제로 갱신됐는지 여부입니다.
     * @private
     */
    #retargetFollowBlend(value) {
        const nextTarget = clampCameraFollowBlend(value, this.targetFollowBlend);
        if (Object.is(nextTarget, this.targetFollowBlend)) {
            return false;
        }

        this.targetFollowBlend = nextTarget;
        this.followAnimationProperties.endValue = nextTarget;
        if (this.followAnimationHandle?.retarget?.(
            this.followAnimationProperties
        ) !== true) {
            this.followAnimationHandle?.remove?.();
            this.followAnimationHandle = this.animationPort.animate(
                this,
                this.followAnimationProperties
            );
        }
        return true;
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
        this.followAnimationHandle?.remove?.();
        this.followAnimationHandle = null;
        this.camera = null;
        this.followTarget = null;
        this.followPosition = null;
        this.followPositionCandidate = null;
        this.followAnimationProperties = null;
        this.animationPort = null;
    }
}
