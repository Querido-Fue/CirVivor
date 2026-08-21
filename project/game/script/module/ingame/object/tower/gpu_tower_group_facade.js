import {
    INPUT_DISPOSITIONS,
    PLAYER_ACTION_TYPES
} from '../../contract/player_controllable_contract.js';
import { GpuTowerActorFacade } from './gpu_tower_actor_facade.js';

function finitePointerValue(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function freezeFailure(reason, extra = {}) {
    return Object.freeze({ accepted: false, reason, ...extra });
}

/**
 * 모든 living Tower의 의미 입력과 bounded group camera summary를 대표하는 facade입니다.
 * primary exact handle은 projectile compatibility에만 유지합니다.
 */
export class GpuTowerGroupFacade extends GpuTowerActorFacade {
    constructor(options = {}) {
        super();
        if (options.towerGroupState
            && (typeof options.towerGroupState.getStatus !== 'function'
                || typeof options.towerGroupState.getTowerRecords !== 'function')) {
            throw new TypeError('GpuTowerGroupFacade에는 TowerGroupState 계약이 필요합니다.');
        }
        if (options.camera
            && typeof options.camera.viewportToWorld !== 'function') {
            throw new TypeError('TowerGroup Aim projection에는 viewportToWorld camera가 필요합니다.');
        }
        this.id = 'tower-group';
        this.kind = 'tower-group';
        this.controlTargetId = 'tower.group';
        this.cameraFollowTargetId = `${this.id}:camera-follow`;
        this.towerGroupState = options.towerGroupState ?? null;
        this.camera = options.camera ?? null;
        this.primaryPressed = false;
        this.viewportPointer = { x: 0, y: 0 };
        this.aimWorldPoint = { x: 0, y: 0 };
        this.lastAimSourceTick = 0;
        this.lastRosterStateRevision = 0;
        this.lastRosterDeviceGeneration = -1;
        this.lastRosterAuthoritativeEpoch = -1;
        this.lastRosterReceipt = null;
        this.lastGroupSummary = null;
        this.groupBounds = {
            minX: 0,
            minY: 0,
            maxX: 0,
            maxY: 0
        };
    }

    handlePlayerAction(action) {
        if (!this.active) return INPUT_DISPOSITIONS.PASS;
        if (action?.type !== PLAYER_ACTION_TYPES.PRIMARY_POINTER_FIRE) {
            return super.handlePlayerAction(action);
        }
        this.primaryPressed = action.payload?.pressed === true;
        this.viewportPointer.x = finitePointerValue(
            action.payload?.viewportX,
            this.viewportPointer.x
        );
        this.viewportPointer.y = finitePointerValue(
            action.payload?.viewportY,
            this.viewportPointer.y
        );
        return INPUT_DISPOSITIONS.CONSUMED;
    }

    synchronizeGpuRoster(backend, force = false) {
        if (!this.towerGroupState
            || typeof backend?.synchronizeTowerGroupRoster !== 'function'
            || typeof backend?.getTowerGroupRuntimeStatus !== 'function') {
            return freezeFailure('tower-group-roster-unavailable');
        }
        const group = this.towerGroupState.getStatus();
        const runtime = backend.getTowerGroupRuntimeStatus();
        // Tower creation은 같은 fixed boundary에 source/target roster를 GPU에
        // 함께 보유합니다. HP event처럼 roster membership과 무관한
        // stateRevision 변화가 그 사이에 발생해도 pending transition의 source
        // revision은 이미 authoritative하므로 host roster를 덮어쓰지 않습니다.
        const transitionSourceCurrent = !force
            && runtime.state === 'ready'
            && runtime.groupRevision === group.groupRevision
            && runtime.pendingRosterTransition?.sourceGroupRevision
                === group.groupRevision
            && this.lastRosterDeviceGeneration === runtime.deviceGeneration
            && this.lastRosterAuthoritativeEpoch === runtime.authoritativeEpoch;
        if (transitionSourceCurrent && this.lastRosterReceipt?.accepted === true) {
            return this.lastRosterReceipt;
        }
        const current = !force
            && runtime.state === 'ready'
            && runtime.groupRevision === group.groupRevision
            && this.lastRosterStateRevision === group.stateRevision
            && this.lastRosterDeviceGeneration === runtime.deviceGeneration
            && this.lastRosterAuthoritativeEpoch === runtime.authoritativeEpoch;
        if (current && this.lastRosterReceipt) {
            return this.lastRosterReceipt;
        }
        const receipt = backend.synchronizeTowerGroupRoster({
            groupRevision: group.groupRevision,
            records: this.towerGroupState.getTowerRecords()
        });
        this.lastRosterReceipt = receipt;
        if (receipt?.accepted === true) {
            const nextRuntime = backend.getTowerGroupRuntimeStatus();
            this.lastRosterStateRevision = group.stateRevision;
            this.lastRosterDeviceGeneration = nextRuntime.deviceGeneration;
            this.lastRosterAuthoritativeEpoch = nextRuntime.authoritativeEpoch;
        }
        return receipt;
    }

    /** fixed tick당 CPU command 하나만 stage하고 GPU가 roster 전체에 broadcast합니다. */
    stageControlForFixedTick(backend, targetFixedTick) {
        if (!this.active) {
            return freezeFailure('body-not-active');
        }
        const tick = Number(targetFixedTick);
        if (!Number.isSafeInteger(tick) || tick <= 0) {
            throw new RangeError('TowerGroup control targetFixedTick은 양의 안전한 정수여야 합니다.');
        }
        if (tick === this.lastControlTick) return this.lastControlReceipt;
        if (tick < this.lastControlTick) {
            throw new RangeError('TowerGroup control tick은 단조 증가해야 합니다.');
        }
        const usesGroupRuntime
            = typeof backend?.stageTowerGroupCommand === 'function'
                && typeof backend?.synchronizeTowerGroupRoster === 'function';
        if (usesGroupRuntime) {
            const roster = this.synchronizeGpuRoster(backend);
            if (roster?.accepted !== true) {
                this.lastControlTick = tick;
                this.lastControlReceipt = roster;
                return roster;
            }
        }
        if (this.camera) {
            const projected = this.camera.viewportToWorld(
                this.viewportPointer.x,
                this.viewportPointer.y,
                this.aimWorldPoint
            );
            const aim = projected && projected !== this.aimWorldPoint
                ? projected
                : this.aimWorldPoint;
            const aimX = Number(aim?.x);
            const aimY = Number(aim?.y);
            if (!Number.isFinite(aimX) || !Number.isFinite(aimY)) {
                return freezeFailure('tower-group-aim-non-finite');
            }
            this.aimWorldPoint.x = Math.fround(aimX);
            this.aimWorldPoint.y = Math.fround(aimY);
        }
        if (!usesGroupRuntime) {
            const receipt = super.stageControlForFixedTick(backend, tick);
            if (receipt?.accepted === true) this.lastAimSourceTick = tick;
            return receipt;
        }
        const commandId = [
            'gpu-tower-group-control',
            this.sessionGeneration,
            this.towerGroupState.getStatus().groupRevision,
            tick
        ].join(':');
        const receipt = backend.stageTowerGroupCommand({
            sourceTick: tick,
            moveIntent: this.moveIntent,
            aimWorldPoint: this.aimWorldPoint,
            commandId
        });
        this.lastControlTick = tick;
        this.lastControlReceipt = receipt;
        if (receipt?.accepted === true) this.lastAimSourceTick = tick;
        return receipt;
    }

    /** primary projectile compatibility controller가 같은 group Aim을 읽습니다. */
    getSharedAimState(targetFixedTick = this.lastAimSourceTick) {
        const tick = Number(targetFixedTick);
        if (!Number.isSafeInteger(tick)
            || tick <= 0
            || tick !== this.lastAimSourceTick) {
            return null;
        }
        return Object.freeze({
            pressed: this.primaryPressed,
            sourceTick: tick,
            aimWorldPoint: Object.freeze({ ...this.aimWorldPoint })
        });
    }

    /** share-weighted centroid를 기존 camera-follow presentation 계약에 투영합니다. */
    updateObservedSummary(summary, frame) {
        if (summary?.valid !== true || summary.livingCount <= 0) {
            return super.updateObservedPose({
                valid: false,
                reason: summary?.reason
                    ?? (summary?.livingCount === 0
                        ? 'no-living-towers'
                        : 'invalid-group-summary')
            }, frame);
        }
        const centroidX = Number(summary.centroid?.x);
        const centroidY = Number(summary.centroid?.y);
        const sourceTick = Number(summary.sourceTick);
        const fixedDelta = Number(frame?.fixedDelta);
        if (!Number.isFinite(centroidX)
            || !Number.isFinite(centroidY)
            || !Number.isSafeInteger(sourceTick)
            || sourceTick <= 0) {
            return super.updateObservedPose({
                valid: false,
                reason: 'invalid-group-centroid'
            }, frame);
        }
        const previous = this.hasObservedPose
            ? { ...this.observedPosition }
            : { x: centroidX, y: centroidY };
        const tickDelta = Math.max(1, sourceTick - this.lastObservedSourceTick);
        const seconds = Number.isFinite(fixedDelta) && fixedDelta > 0
            ? tickDelta * fixedDelta
            : 0;
        const velocity = seconds > 0
            ? {
                x: (centroidX - previous.x) / seconds,
                y: (centroidY - previous.y) / seconds
            }
            : { x: 0, y: 0 };
        const handle = this.bodyHandle ?? summary.primaryHandle;
        if (!handle) {
            return super.updateObservedPose({
                valid: false,
                reason: 'group-primary-unbound'
            }, frame);
        }
        const accepted = super.updateObservedPose({
            valid: true,
            entityId: handle.entityId,
            incarnation: handle.incarnation,
            sessionGeneration: summary.sessionGeneration,
            deviceGeneration: summary.deviceGeneration,
            authoritativeEpoch: summary.authoritativeEpoch,
            sourceTick,
            observedThroughTick: sourceTick,
            position: { x: centroidX, y: centroidY },
            previousPosition: previous,
            velocity
        }, frame);
        if (accepted) {
            this.lastGroupSummary = summary;
            this.groupBounds.minX = summary.bounds.minX;
            this.groupBounds.minY = summary.bounds.minY;
            this.groupBounds.maxX = summary.bounds.maxX;
            this.groupBounds.maxY = summary.bounds.maxY;
        }
        return accepted;
    }

    resetGpuBinding() {
        super.resetGpuBinding();
        this.lastAimSourceTick = 0;
        this.lastRosterStateRevision = 0;
        this.lastRosterDeviceGeneration = -1;
        this.lastRosterAuthoritativeEpoch = -1;
        this.lastRosterReceipt = null;
        this.lastGroupSummary = null;
    }

    deactivateForDeath() {
        this.primaryPressed = false;
        return super.deactivateForDeath();
    }

    getStatus() {
        return Object.freeze({
            ...super.getStatus(),
            primaryPressed: this.primaryPressed,
            lastAimSourceTick: this.lastAimSourceTick,
            lastRosterStateRevision: this.lastRosterStateRevision,
            lastRosterReceipt: this.lastRosterReceipt,
            lastGroupSummary: this.lastGroupSummary,
            groupBounds: Object.freeze({ ...this.groupBounds })
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.primaryPressed = false;
        super.destroy();
        this.towerGroupState = null;
        this.camera = null;
        this.viewportPointer = null;
        this.aimWorldPoint = null;
        this.lastRosterReceipt = null;
        this.lastGroupSummary = null;
    }
}
