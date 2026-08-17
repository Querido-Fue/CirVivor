import {
    BASIC_BULLET_PROJECTILE_DATA,
    BASIC_BULLET_WEAPON_DATA
} from 'data/object/projectile/basic_bullet_data.js';
import {
    INPUT_DISPOSITIONS,
    PLAYER_ACTION_TYPES,
    PLAYER_CONTROL_CONTEXTS
} from '../../contract/player_controllable_contract.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY
} from '../../contract/gameplay_team_contract.js';
import {
    PROJECTILE_TARGET_POLICY_ID
} from '../../contract/projectile_target_policy_contract.js';
import {
    GpuProjectileSpawnAdapter,
    GPU_PROJECTILE_SPAWN_MODE
} from '../../gpu_simulation_endpoint.js';

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requirePositiveFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 유한 숫자여야 합니다.`);
    }
    return number;
}

function snapshotHandle(handle) {
    const entityId = requirePositiveSafeInteger(handle?.entityId, 'sourceHandle.entityId');
    const incarnation = requirePositiveSafeInteger(
        handle?.incarnation,
        'sourceHandle.incarnation'
    );
    return Object.freeze({ entityId, incarnation });
}

function copyFiniteViewportValue(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

const FIRE_INTERVAL_TICKS = requirePositiveSafeInteger(
    BASIC_BULLET_WEAPON_DATA.fireIntervalTicks,
    'BASIC_BULLET_WEAPON_DATA.fireIntervalTicks'
);
const LAUNCH_SPEED = requirePositiveFinite(
    BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
    'BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond'
);
const POSITION_OFFSET_X = Number(BASIC_BULLET_WEAPON_DATA.positionOffsetTiles);
if (!Number.isFinite(POSITION_OFFSET_X)) {
    throw new RangeError('BASIC_BULLET_WEAPON_DATA.positionOffsetTiles은 유한 숫자여야 합니다.');
}

/**
 * GPU Tower의 primary pointer 입력을 source-relative aim projectile request로 변환합니다.
 * 이 controller는 endpoint lifecycle을 소유하지 않으며, tracked pose를 읽지 않습니다.
 */
export class GpuPrimaryProjectileController {
    /**
     * @param {{tower:object,camera:{viewportToWorld:(x:number,y:number,out:object)=>object},endpoint:object}} options
     */
    constructor(options = {}) {
        if (!options.tower
            || typeof options.tower.getGpuBodyHandle !== 'function'
            || typeof options.tower.getStatus !== 'function') {
            throw new TypeError('primary projectile controller에는 GPU Tower facade가 필요합니다.');
        }
        if (typeof options.camera?.viewportToWorld !== 'function') {
            throw new TypeError('primary projectile controller에는 viewportToWorld camera가 필요합니다.');
        }

        this.controlTargetId = 'tower.primary.weapon';
        this.tower = options.tower;
        this.camera = options.camera;
        this.enabled = true;
        this.primaryPressed = false;
        this.viewportPointer = { x: 0, y: 0 };
        this.aimWorldPoint = { x: 0, y: 0 };
        this.positionOffset = Object.freeze({ x: POSITION_OFFSET_X, y: 0 });
        this.projectileSpawnAdapter = null;
        this.endpoint = null;
        this.sessionGeneration = null;
        this.shotSequence = 0;
        this.nextEligibleFixedTick = 0;
        this.pendingShot = null;
        this.lastShotReceipt = null;
        this.lastCommittedShot = null;
        this.destroyed = false;
        this.bindGpuEndpoint(options.endpoint);
    }

    getControlContext() {
        return PLAYER_CONTROL_CONTEXTS.GAMEPLAY;
    }

    getInputPriority() {
        return 0;
    }

    isControlEnabled() {
        return this.enabled && !this.destroyed;
    }

    /** PRIMARY_POINTER_FIRE의 reusable payload를 controller-owned scalar state로 복사합니다. */
    handlePlayerAction(action) {
        if (!this.enabled || action?.type !== PLAYER_ACTION_TYPES.PRIMARY_POINTER_FIRE) {
            return INPUT_DISPOSITIONS.PASS;
        }
        this.primaryPressed = action.payload?.pressed === true;
        this.viewportPointer.x = copyFiniteViewportValue(
            action.payload?.viewportX,
            this.viewportPointer.x
        );
        this.viewportPointer.y = copyFiniteViewportValue(
            action.payload?.viewportY,
            this.viewportPointer.y
        );
        return INPUT_DISPOSITIONS.CONSUMED;
    }

    /** replacement endpoint를 controller에 결합하고 old session shot state를 폐기합니다. */
    bindGpuEndpoint(endpoint) {
        if (!this.enabled || this.destroyed) {
            return false;
        }
        this.endpoint = endpoint;
        this.projectileSpawnAdapter = new GpuProjectileSpawnAdapter(endpoint);
        this.#resetShotState();
        return true;
    }

    /** device/session recovery에서 old source, pending shot, sequence를 모두 폐기합니다. */
    resetGpuBinding() {
        this.projectileSpawnAdapter = null;
        this.endpoint = null;
        this.#resetShotState();
    }

    /**
     * active Tower의 exact handle과 current camera projection만 사용해 one-shot request를 예약합니다.
     * endpoint lifecycle commit/fixed submit은 호출하지 않습니다.
     * @param {number} targetFixedTick
     * @returns {object|null} inbox receipt 또는 발사 불가일 때 null입니다.
     */
    stageShotForFixedTick(targetFixedTick) {
        if (!this.enabled || !this.projectileSpawnAdapter) {
            return null;
        }
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const sharedAim = this.tower.getSharedAimState?.(tick) ?? null;
        if ((sharedAim ? sharedAim.pressed : this.primaryPressed) !== true) {
            return null;
        }
        if (this.pendingShot) {
            return this.pendingShot.targetFixedTick === tick
                ? this.pendingShot.receipt
                : null;
        }
        if (tick < this.nextEligibleFixedTick) {
            return null;
        }

        const sourceHandle = this.tower.getGpuBodyHandle();
        const sessionGeneration = Number(this.tower.getStatus()?.sessionGeneration);
        if (!sourceHandle
            || !Number.isSafeInteger(sessionGeneration)
            || sessionGeneration <= 0) {
            return null;
        }
        if (this.sessionGeneration !== sessionGeneration) {
            this.#resetShotState();
            this.sessionGeneration = sessionGeneration;
        }

        const projected = sharedAim
            ? sharedAim.aimWorldPoint
            : this.camera.viewportToWorld(
                this.viewportPointer.x,
                this.viewportPointer.y,
                this.aimWorldPoint
            );
        const aimSource = projected && projected !== this.aimWorldPoint
            ? projected
            : this.aimWorldPoint;
        const aimX = Number(aimSource?.x);
        const aimY = Number(aimSource?.y);
        if (!Number.isFinite(aimX) || !Number.isFinite(aimY)) {
            return null;
        }
        this.aimWorldPoint.x = aimX;
        this.aimWorldPoint.y = aimY;

        const exactSourceHandle = snapshotHandle(sourceHandle);
        const spawnSequence = requireNonNegativeSafeInteger(
            this.shotSequence,
            'shotSequence'
        );
        const commandId = [
            'gpu-primary-bullet',
            sessionGeneration,
            exactSourceHandle.entityId,
            exactSourceHandle.incarnation,
            tick,
            spawnSequence
        ].join(':');
        const receipt = this.projectileSpawnAdapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
            definition: BASIC_BULLET_PROJECTILE_DATA,
            sourceHandle: exactSourceHandle,
            ownerHandle: exactSourceHandle,
            allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
            targetPolicyId: PROJECTILE_TARGET_POLICY_ID.ENEMY_AND_TERRAIN,
            positionOffset: this.positionOffset,
            aimWorldPoint: this.aimWorldPoint,
            launchSpeed: LAUNCH_SPEED,
            targetFixedTick: tick,
            spawnSequence,
            producerId: BASIC_BULLET_WEAPON_DATA.producerId,
            commandId
        });
        this.lastShotReceipt = receipt ?? null;
        if (receipt?.accepted !== true) {
            return receipt ?? null;
        }
        this.pendingShot = Object.freeze({
            commandId,
            targetFixedTick: tick,
            sessionGeneration,
            sourceHandle: exactSourceHandle,
            shotSequence: spawnSequence,
            receipt
        });
        return receipt;
    }

    /**
     * source-relative SpawnProgram이 해당 command를 정확히 하나 stage한 경우에만 cooldown/sequence를 확정합니다.
     * normal spawn rejection은 pending만 비우고 다음 fixed tick 재시도를 허용합니다.
     * @param {{sourceRelativeSpawns?:object[],rejected?:object[]}|null|undefined} fixedCommands
     * @param {number} targetFixedTick
     * @returns {boolean} shot을 확정했는지 여부입니다.
     */
    finalizeFixedCommit(fixedCommands, targetFixedTick) {
        const pending = this.pendingShot;
        if (!pending || Number(targetFixedTick) !== pending.targetFixedTick) {
            return false;
        }
        const accepted = Array.isArray(fixedCommands?.sourceRelativeSpawns)
            ? fixedCommands.sourceRelativeSpawns.filter((entry) => (
                entry?.commandId === pending.commandId
            ))
            : [];
        const rejected = Array.isArray(fixedCommands?.rejected)
            ? fixedCommands.rejected.filter((entry) => (
                entry?.commandId === pending.commandId
            ))
            : [];
        this.pendingShot = null;
        if (accepted.length !== 1 || rejected.length !== 0) {
            return false;
        }
        this.shotSequence = pending.shotSequence + 1;
        this.nextEligibleFixedTick = pending.targetFixedTick + FIRE_INTERVAL_TICKS;
        this.lastCommittedShot = Object.freeze({
            commandId: pending.commandId,
            targetFixedTick: pending.targetFixedTick,
            sessionGeneration: pending.sessionGeneration,
            sourceHandle: pending.sourceHandle,
            shotSequence: pending.shotSequence
        });
        return true;
    }

    getStatus() {
        return Object.freeze({
            enabled: this.enabled,
            primaryPressed: this.primaryPressed,
            sessionGeneration: this.sessionGeneration,
            shotSequence: this.shotSequence,
            nextEligibleFixedTick: this.nextEligibleFixedTick,
            pendingShot: this.pendingShot,
            lastShotReceipt: this.lastShotReceipt,
            lastCommittedShot: this.lastCommittedShot
        });
    }

    /** Committed Tower death 뒤 held input/source/endpoint를 영구 비활성화합니다. */
    deactivateForTowerDeath() {
        if (this.destroyed || !this.enabled) {
            return false;
        }
        this.enabled = false;
        this.primaryPressed = false;
        this.resetGpuBinding();
        return true;
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.enabled = false;
        this.primaryPressed = false;
        this.resetGpuBinding();
        this.tower = null;
        this.camera = null;
        this.viewportPointer = null;
        this.aimWorldPoint = null;
    }

    #resetShotState() {
        this.sessionGeneration = null;
        this.shotSequence = 0;
        this.nextEligibleFixedTick = 0;
        this.pendingShot = null;
        this.lastShotReceipt = null;
        this.lastCommittedShot = null;
    }
}
