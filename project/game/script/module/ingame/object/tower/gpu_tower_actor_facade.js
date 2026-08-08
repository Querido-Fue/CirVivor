import {
    INPUT_DISPOSITIONS,
    PLAYER_ACTION_TYPES,
    PLAYER_CONTROL_CONTEXTS
} from '../../contract/player_controllable_contract.js';

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

    /** observed pose를 exact protocol/freshness로 검증해 camera 전용 좌표로 투영합니다. */
    updateObservedPose(pose, frame) {
        this.followEnabled = false;
        if (!this.active || !this.bodyHandle || pose?.valid !== true) {
            this.lastPoseRejection = pose?.reason ?? 'invalid-sample';
            return false;
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
            this.lastPoseRejection = 'identity-or-generation-mismatch';
            return false;
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
            this.lastPoseRejection = 'invalid-or-out-of-order-tick';
            return false;
        }
        const ageTicks = currentFixedTick - observedThroughTick;
        if (ageTicks > GPU_TOWER_TRACKED_POSE_MAX_AGE_TICKS) {
            this.lastPoseRejection = 'stale-sample';
            return false;
        }
        const position = finitePoint(pose.position);
        const previous = finitePoint(pose.previousPosition);
        const velocity = finitePoint(pose.velocity);
        if (!position || !previous || !velocity) {
            this.lastPoseRejection = 'non-finite-pose';
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
        if (ageTicks === 0) {
            this.followPosition.x = previous.x + ((position.x - previous.x) * alpha);
            this.followPosition.y = previous.y + ((position.y - previous.y) * alpha);
        } else {
            const predictionSeconds = (ageTicks - 1 + alpha) * fixedDelta;
            this.followPosition.x = position.x + (velocity.x * predictionSeconds);
            this.followPosition.y = position.y + (velocity.y * predictionSeconds);
        }
        this.lastObservedSourceTick = sourceTick;
        this.followEnabled = true;
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
