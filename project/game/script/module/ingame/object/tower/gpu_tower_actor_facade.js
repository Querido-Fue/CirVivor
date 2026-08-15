import {
    INPUT_DISPOSITIONS,
    PLAYER_ACTION_TYPES,
    PLAYER_CONTROL_CONTEXTS
} from '../../contract/player_controllable_contract.js';
import {
    GPU_BODY_PRESENTATION_PROFILE
} from '../../physics/gpu/gpu_body_presentation_clock.js';

export const GPU_TOWER_TRACKED_POSE_MAX_AGE_TICKS = 4;

function normalizeMoveIntent(x, y) {
    let safeX = Number(x);
    let safeY = Number(y);
    safeX = Number.isFinite(safeX) ? safeX : 0;
    safeY = Number.isFinite(safeY) ? safeY : 0;
    const magnitude = Math.hypot(safeX, safeY);
    if (magnitude > 1) {
        safeX /= magnitude;
        safeY /= magnitude;
    }
    return { x: Math.fround(safeX), y: Math.fround(safeY) };
}

function finitePoint(source) {
    const x = Number(source?.x);
    const y = Number(source?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * GPU Tower의 의미 입력 sink와 bounded observed camera pose만 소유합니다.
 * IPhysicsBody2D/ICollidable2D 또는 synchronous authoritative pose API는 제공하지 않습니다.
 */
export class GpuTowerActorFacade {
    constructor() {
        this.id = 'the-tower';
        this.kind = 'tower';
        this.controlTargetId = 'tower.primary';
        this.cameraFollowTargetId = `${this.id}:camera-follow`;
        this.active = true;
        this.moveIntent = { x: 0, y: 0 };
        this.bodyHandle = null;
        this.sessionGeneration = null;
        this.lastControlTick = 0;
        this.lastControlReceipt = null;
        this.lastObservedSourceTick = 0;
        this.hasObservedPose = false;
        this.observedPosition = { x: 0, y: 0 };
        this.observedPreviousPosition = { x: 0, y: 0 };
        this.observedVelocity = { x: 0, y: 0 };
        this.followPosition = { x: 0, y: 0 };
        this.followEnabled = false;
        this.lastPoseRejection = 'unbound';
        this.destroyed = false;
    }

    getControlContext() {
        return PLAYER_CONTROL_CONTEXTS.GAMEPLAY;
    }

    getInputPriority() {
        return 0;
    }

    isControlEnabled() {
        return this.active;
    }

    handlePlayerAction(action) {
        if (!this.active || action?.type !== PLAYER_ACTION_TYPES.MOVE_VECTOR) {
            return INPUT_DISPOSITIONS.PASS;
        }
        const intent = normalizeMoveIntent(action.payload?.x, action.payload?.y);
        this.moveIntent.x = intent.x;
        this.moveIntent.y = intent.y;
        return INPUT_DISPOSITIONS.CONSUMED;
    }

    /** lifecycle owner가 활성화한 exact handle을 새 GPU session에 결합합니다. */
    bindGpuBody(handle, sessionGeneration) {
        if (!this.active || this.destroyed) {
            throw new Error('비활성 Tower facade는 GPU body에 결합할 수 없습니다.');
        }
        const entityId = Number(handle?.entityId);
        const incarnation = Number(handle?.incarnation);
        const generation = Number(sessionGeneration);
        if (!Number.isSafeInteger(entityId) || entityId <= 0
            || !Number.isSafeInteger(incarnation) || incarnation <= 0
            || !Number.isSafeInteger(generation) || generation <= 0) {
            throw new TypeError('GPU Tower binding에는 exact handle/session generation이 필요합니다.');
        }
        this.bodyHandle = Object.freeze({ entityId, incarnation });
        this.sessionGeneration = generation;
        this.lastControlTick = 0;
        this.lastControlReceipt = null;
        this.lastObservedSourceTick = 0;
        this.hasObservedPose = false;
        this.followEnabled = false;
        this.lastPoseRejection = 'awaiting-sample';
        return this.bodyHandle;
    }

    /** device/session 교체 시 stale control/pose authority를 즉시 폐기합니다. */
    resetGpuBinding() {
        this.bodyHandle = null;
        this.sessionGeneration = null;
        this.lastControlTick = 0;
        this.lastControlReceipt = null;
        this.lastObservedSourceTick = 0;
        this.hasObservedPose = false;
        this.followEnabled = false;
        this.lastPoseRejection = 'unbound';
    }

    /** Committed exact death 뒤 control/tracking/follow를 영구 중단합니다. */
    deactivateForDeath() {
        if (this.destroyed || !this.active) {
            return false;
        }
        this.active = false;
        this.moveIntent.x = 0;
        this.moveIntent.y = 0;
        this.resetGpuBinding();
        this.lastPoseRejection = 'tower-dead';
        return true;
    }

    getGpuBodyHandle() {
        return this.bodyHandle;
    }

    /** exact active body에 해당 tick의 control을 최대 한 번 request합니다. */
    stageControlForFixedTick(endpoint, targetFixedTick) {
        if (!this.active || !this.bodyHandle) {
            return Object.freeze({ accepted: false, reason: 'body-not-active' });
        }
        const tick = Number(targetFixedTick);
        if (!Number.isSafeInteger(tick) || tick <= 0) {
            throw new RangeError('Tower control targetFixedTick은 양의 안전한 정수여야 합니다.');
        }
        if (tick === this.lastControlTick) {
            return this.lastControlReceipt;
        }
        if (tick < this.lastControlTick) {
            throw new RangeError('Tower control tick은 단조 증가해야 합니다.');
        }
        const commandId = [
            'gpu-tower-control',
            this.sessionGeneration,
            this.bodyHandle.entityId,
            this.bodyHandle.incarnation,
            tick
        ].join(':');
        const receipt = endpoint.requestBodyControl({
            handle: this.bodyHandle,
            moveIntentX: this.moveIntent.x,
            moveIntentY: this.moveIntent.y
        }, tick, commandId);
        this.lastControlTick = tick;
        this.lastControlReceipt = receipt;
        return receipt;
    }

    /** 마지막 exact observed pose를 GPU draw와 같은 presentation 시각으로 투영합니다. */
    #projectObservedPose(frame) {
        if (!this.hasObservedPose) {
            return false;
        }
        const currentFixedTick = Number(frame?.currentFixedTick);
        if (!Number.isSafeInteger(currentFixedTick)
            || currentFixedTick < this.lastObservedSourceTick) {
            return false;
        }
        const rawAlpha = Number(frame?.fixedAlpha);
        const alpha = Number.isFinite(rawAlpha)
            ? Math.max(0, Math.min(1, rawAlpha))
            : 0;
        const rawFixedDelta = Number(frame?.fixedDelta);
        const fixedDelta = Number.isFinite(rawFixedDelta) && rawFixedDelta > 0
            ? rawFixedDelta
            : 0;
        const ageTicks = currentFixedTick - this.lastObservedSourceTick;
        const profile = frame?.presentationProfile
            ?? GPU_BODY_PRESENTATION_PROFILE.REFERENCE_CLOCK_EXTRAPOLATION;

        if (profile === GPU_BODY_PRESENTATION_PROFILE.STRICT_INTERPOLATION) {
            if (ageTicks === 0) {
                this.followPosition.x = this.observedPreviousPosition.x
                    + ((this.observedPosition.x - this.observedPreviousPosition.x) * alpha);
                this.followPosition.y = this.observedPreviousPosition.y
                    + ((this.observedPosition.y - this.observedPreviousPosition.y) * alpha);
            } else {
                const predictionSeconds = (ageTicks - 1 + alpha) * fixedDelta;
                this.followPosition.x = this.observedPosition.x
                    + (this.observedVelocity.x * predictionSeconds);
                this.followPosition.y = this.observedPosition.y
                    + (this.observedVelocity.y * predictionSeconds);
            }
        } else {
            const rawPredictionDelta = Number(frame?.predictionDelta);
            const fallbackPredictionDelta = alpha * fixedDelta;
            const predictionDelta = Number.isFinite(rawPredictionDelta)
                ? Math.max(0, Math.min(fixedDelta, rawPredictionDelta))
                : fallbackPredictionDelta;
            const predictionSeconds = (ageTicks * fixedDelta) + predictionDelta;
            this.followPosition.x = this.observedPosition.x
                + (this.observedVelocity.x * predictionSeconds);
            this.followPosition.y = this.observedPosition.y
                + (this.observedVelocity.y * predictionSeconds);
        }
        if (!Number.isFinite(this.followPosition.x)
            || !Number.isFinite(this.followPosition.y)) {
            return false;
        }
        this.followEnabled = true;
        return true;
    }

    /** reject 중에도 기존 exact pose를 전진시켜 카메라 authority 토글을 막습니다. */
    #rejectObservedPose(reason, frame) {
        this.lastPoseRejection = reason;
        this.#projectObservedPose(frame);
        return false;
    }

    /** observed pose를 exact protocol/freshness로 검증해 camera 전용 좌표로 투영합니다. */
    updateObservedPose(pose, frame) {
        if (!this.active || !this.bodyHandle) {
            this.followEnabled = false;
            this.lastPoseRejection = pose?.reason ?? 'invalid-sample';
            return false;
        }
        if (pose?.valid !== true) {
            return this.#rejectObservedPose(
                pose?.reason ?? 'invalid-sample',
                frame
            );
        }
        const expectedSession = Number(frame?.sessionGeneration);
        const expectedDevice = Number(frame?.deviceGeneration);
        const expectedEpoch = Number(frame?.authoritativeEpoch);
        if (pose.entityId !== this.bodyHandle.entityId
            || pose.incarnation !== this.bodyHandle.incarnation
            || pose.sessionGeneration !== this.sessionGeneration
            || (Number.isSafeInteger(expectedSession)
                && pose.sessionGeneration !== expectedSession)
            || (Number.isSafeInteger(expectedDevice)
                && pose.deviceGeneration !== expectedDevice)
            || (Number.isSafeInteger(expectedEpoch)
                && pose.authoritativeEpoch !== expectedEpoch)) {
            return this.#rejectObservedPose(
                'identity-or-generation-mismatch',
                frame
            );
        }
        const sourceTick = Number(pose.sourceTick);
        const observedThroughTick = Number(pose.observedThroughTick);
        const currentFixedTick = Number(frame?.currentFixedTick);
        if (!Number.isSafeInteger(sourceTick) || sourceTick <= 0
            || !Number.isSafeInteger(observedThroughTick)
            || observedThroughTick !== sourceTick
            || !Number.isSafeInteger(currentFixedTick)
            || currentFixedTick < observedThroughTick
            || sourceTick < this.lastObservedSourceTick) {
            return this.#rejectObservedPose(
                'invalid-or-out-of-order-tick',
                frame
            );
        }
        const ageTicks = currentFixedTick - observedThroughTick;
        if (ageTicks > GPU_TOWER_TRACKED_POSE_MAX_AGE_TICKS) {
            return this.#rejectObservedPose('stale-sample', frame);
        }
        const position = finitePoint(pose.position);
        const previous = finitePoint(pose.previousPosition);
        const velocity = finitePoint(pose.velocity);
        if (!position || !previous || !velocity) {
            return this.#rejectObservedPose('non-finite-pose', frame);
        }
        this.lastObservedSourceTick = sourceTick;
        this.observedPosition.x = position.x;
        this.observedPosition.y = position.y;
        this.observedPreviousPosition.x = previous.x;
        this.observedPreviousPosition.y = previous.y;
        this.observedVelocity.x = velocity.x;
        this.observedVelocity.y = velocity.y;
        this.hasObservedPose = true;
        if (!this.#projectObservedPose(frame)) {
            this.followEnabled = false;
            this.lastPoseRejection = 'non-finite-presentation';
            return false;
        }
        this.lastPoseRejection = null;
        return true;
    }

    isCameraFollowEnabled() {
        return this.active && this.followEnabled;
    }

    copyCameraFollowPositionInto(out = {}) {
        const target = out && typeof out === 'object' ? out : {};
        target.x = this.followPosition.x;
        target.y = this.followPosition.y;
        return target;
    }

    getStatus() {
        return Object.freeze({
            active: this.active,
            bodyHandle: this.bodyHandle,
            sessionGeneration: this.sessionGeneration,
            lastControlTick: this.lastControlTick,
            lastObservedSourceTick: this.lastObservedSourceTick,
            followEnabled: this.followEnabled,
            lastPoseRejection: this.lastPoseRejection
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.active = false;
        this.moveIntent.x = 0;
        this.moveIntent.y = 0;
        this.resetGpuBinding();
    }
}
