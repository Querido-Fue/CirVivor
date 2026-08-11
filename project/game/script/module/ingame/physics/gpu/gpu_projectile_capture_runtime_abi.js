import {
    GPU_CIRCLE_BODY_IDENTITY
} from './gpu_circle_body_abi.js';

const LITTLE_ENDIAN = true;
const UINT32_MAX = 0xffffffff;

export const GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION = 1;

export const GPU_PROJECTILE_CAPTURE_RUNTIME_ABI = Object.freeze({
    TICK_HEADER: Object.freeze({
        STRIDE: 64,
        ABI_VERSION: 0,
        SESSION_GENERATION: 4,
        DEVICE_GENERATION: 8,
        AUTHORITATIVE_EPOCH: 12,
        SOURCE_FIXED_TICK: 16,
        COMPLETED_THROUGH_TICK: 20,
        STATUS: 24,
        ERROR_FLAGS: 28,
        CANDIDATE_COUNT: 32,
        SELECTED_COUNT: 36,
        CAPTURE_COUNT: 40,
        RELEASE_PREPARATION_COUNT: 44,
        CLEANUP_COUNT: 48,
        OVERFLOW_FLAGS: 52,
        BATCH_FINGERPRINT: 56,
        RESERVED: 60
    }),
    COMPLETION: Object.freeze({
        STRIDE: 96,
        TYPE: 0,
        FLAGS: 4,
        CAPTOR_BODY_SLOT: 8,
        CAPTOR_ENTITY_ID: 12,
        CAPTOR_INCARNATION: 16,
        PROJECTILE_BODY_SLOT: 20,
        PROJECTILE_ENTITY_ID: 24,
        PROJECTILE_INCARNATION: 28,
        CAPTURED_AT_FIXED_TICK: 32,
        RELEASE_DUE_FIXED_TICK: 36,
        CAPTURE_SEQUENCE: 40,
        PREPARE_FINGERPRINT: 44,
        ANCHOR_X: 48,
        ANCHOR_Y: 52,
        FACING_X: 56,
        FACING_Y: 60,
        CAPTURED_SPEED: 64,
        TARGET_SELECTOR: 68,
        TARGET_BODY_SLOT: 72,
        TARGET_ENTITY_ID: 76,
        TARGET_INCARNATION: 80,
        PROFILE_CODE: 84,
        REASON: 88,
        RESERVED: 92
    }),
    RELEASE_HEADER: Object.freeze({
        STRIDE: 64,
        ABI_VERSION: 0,
        SESSION_GENERATION: 4,
        DEVICE_GENERATION: 8,
        AUTHORITATIVE_EPOCH: 12,
        PUBLICATION_FIXED_TICK: 16,
        RECORD_COUNT: 20,
        STATUS: 24,
        ERROR_FLAGS: 28,
        VALIDATED_COUNT: 32,
        COMMITTED_COUNT: 36,
        BATCH_FINGERPRINT: 40,
        RESULT_FINGERPRINT: 44,
        FLAGS: 48,
        RESERVED_0: 52,
        RESERVED_1: 56,
        RESERVED_2: 60
    }),
    RELEASE_RECORD: Object.freeze({
        STRIDE: 96,
        COMMAND_ID_FINGERPRINT: 0,
        PREPARE_FINGERPRINT: 4,
        CAPTOR_BODY_SLOT: 8,
        CAPTOR_ENTITY_ID: 12,
        CAPTOR_INCARNATION: 16,
        PROJECTILE_BODY_SLOT: 20,
        PROJECTILE_ENTITY_ID: 24,
        PROJECTILE_INCARNATION: 28,
        CAPTURE_SEQUENCE: 32,
        CAPTURED_AT_FIXED_TICK: 36,
        PREPARED_AT_FIXED_TICK: 40,
        RELEASE_REASON: 44,
        POSITION_X: 48,
        POSITION_Y: 52,
        VELOCITY_X: 56,
        VELOCITY_Y: 60,
        CAPTURED_SPEED: 64,
        TARGET_SELECTOR: 68,
        TARGET_BODY_SLOT: 72,
        TARGET_ENTITY_ID: 76,
        TARGET_INCARNATION: 80,
        NEXT_GAMEPLAY_META: 84,
        NEXT_INTERACTION_META: 88,
        NEXT_TARGET_LAYER_MASK: 92
    }),
    PROFILE: Object.freeze({
        STRIDE: 32,
        PROFILE_CODE: 0,
        FLAGS: 4,
        SLOT_CAPACITY: 8,
        CAPTURE_DELAY_FIXED_TICKS: 12,
        FUNNEL_COS_HALF_ANGLE: 16,
        EXIT_CLEARANCE_TILES: 20,
        RELEASE_SPEED_SCALE: 24,
        RESERVED: 28
    }),
    TARGET_CONFIG: Object.freeze({
        STRIDE: 16,
        BODY_SLOT: 0,
        ENTITY_ID: 4,
        INCARNATION: 8,
        SELECTOR: 12
    })
});

export const GPU_PROJECTILE_CAPTURE_TICK_STATUS = Object.freeze({
    RESET: 0,
    SEALED: 1,
    COMPLETE: 2,
    REJECTED: 3,
    PROTOCOL_FAILURE: 4
});

export const GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE = Object.freeze({
    CAPTURED: 1,
    RELEASE_PREPARED_NORMAL: 2,
    RELEASE_PREPARED_CAPTOR_DEATH: 3,
    RELEASE_PREPARED_CAPTOR_CORE_IMPACT: 4,
    HELD_PROJECTILE_EXPIRED: 5,
    RELEASE_COMMITTED: 6
});

export const GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR = Object.freeze({
    INVALID_FORWARD: 0,
    TOWER: 1
});

export const GPU_PROJECTILE_CAPTURE_RELEASE_REASON = Object.freeze({
    NORMAL_DUE: 1,
    CAPTOR_DEATH: 2,
    CAPTOR_CORE_IMPACT: 3
});

export const GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG = Object.freeze({
    ABI_MISMATCH: 1 << 0,
    CONTACT_OVERFLOW: 1 << 1,
    COMPLETION_CAPACITY: 1 << 2,
    BILATERAL_STATE_MISMATCH: 1 << 3,
    STALE_IDENTITY: 1 << 4,
    UNSUPPORTED_TARGET: 1 << 5,
    PROGRAM_REJECTED: 1 << 6,
    FIXED_TICK_OVERFLOW: 1 << 7,
    CAPTURE_SEQUENCE_EXHAUSTED: 1 << 8
});

export const GPU_PROJECTILE_CAPTURE_RELEASE_PROGRAM_FLAG = Object.freeze({
    COMMIT_REQUESTED: 1 << 0
});

export const GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT = Object.freeze({
    CLEAR_TICK: 'clear_projectile_capture_tick',
    UPDATE_FACING: 'update_projectile_capture_facing',
    VALIDATE_HELD: 'validate_projectile_capture_holds',
    SELECT_PROJECTILE_DISTANCES:
        'select_projectile_capture_distances',
    SELECT_CAPTORS: 'select_projectile_capture_captors',
    SELECT_RING_DISTANCES: 'select_ring_capture_distances',
    SELECT_PROJECTILES: 'select_ring_capture_projectiles',
    PREFLIGHT_CAPTURE: 'preflight_projectile_capture_batch',
    SEAL_CAPTURE: 'seal_projectile_capture_batch',
    COMMIT_CAPTURE: 'commit_projectile_capture_batch',
    FINALIZE_CAPTURE: 'finalize_projectile_capture_batch',
    MARK_CORE_IMPACTS: 'mark_projectile_capture_core_impacts',
    ATTACH_HELD: 'attach_projectile_capture_holds',
    CLEAR_RELEASE_PREPARATIONS:
        'clear_projectile_capture_release_preparations',
    PREFLIGHT_RELEASE_PREPARATIONS:
        'preflight_projectile_capture_release_preparations',
    SEAL_RELEASE_PREPARATIONS:
        'seal_projectile_capture_release_preparations',
    COMMIT_RELEASE_PREPARATIONS:
        'commit_projectile_capture_release_preparations',
    FINALIZE_RELEASE_PREPARATIONS:
        'finalize_projectile_capture_release_preparations',
    CLEAR_RELEASES: 'clear_projectile_capture_releases',
    PREFLIGHT_RELEASES: 'preflight_projectile_capture_releases',
    SEAL_RELEASES: 'seal_projectile_capture_releases',
    COMMIT_RELEASES: 'commit_projectile_capture_releases',
    FINALIZE_RELEASES: 'finalize_projectile_capture_releases'
});

function requireUint32(value, label) {
    if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
        throw new RangeError(`${label}은 uint32여야 합니다.`);
    }
    return value;
}

function requireFloat32(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new RangeError(`${label}은 유한 숫자여야 합니다.`);
    }
    const result = Math.fround(value);
    if (!Number.isFinite(result)) {
        throw new RangeError(`${label}은 float32 범위여야 합니다.`);
    }
    return result;
}

function writeU32(view, base, offset, value, label) {
    view.setUint32(base + offset, requireUint32(value, label), LITTLE_ENDIAN);
}

function writeF32(view, base, offset, value, label) {
    view.setFloat32(base + offset, requireFloat32(value, label), LITTLE_ENDIAN);
}

function requireDataViewCapacity(view, byteLength, label) {
    if (!(view instanceof DataView) || view.byteLength < byteLength) {
        throw new RangeError(`${label} DataView capacity가 부족합니다.`);
    }
    return view;
}

export function getGpuProjectileCaptureTickByteLength(
    captureCapacity,
    releasePreparationCapacity,
    cleanupCapacity
) {
    const captureCount = requireUint32(captureCapacity, 'captureCapacity');
    const releaseCount = requireUint32(
        releasePreparationCapacity,
        'releasePreparationCapacity'
    );
    const cleanupCount = requireUint32(cleanupCapacity, 'cleanupCapacity');
    return GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.TICK_HEADER.STRIDE
        + ((captureCount + releaseCount + cleanupCount)
            * GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.COMPLETION.STRIDE);
}

export function createGpuProjectileCaptureTickStorage(
    captureCapacity,
    releasePreparationCapacity,
    cleanupCapacity
) {
    const byteLength = getGpuProjectileCaptureTickByteLength(
        captureCapacity,
        releasePreparationCapacity,
        cleanupCapacity
    );
    return Object.freeze({
        buffer: new ArrayBuffer(byteLength),
        captureCapacity,
        releasePreparationCapacity,
        cleanupCapacity
    });
}

export function createGpuProjectileCaptureReleaseProgramStorage(capacity) {
    const recordCapacity = requireUint32(capacity, 'releaseProgramCapacity');
    if (recordCapacity === 0) {
        throw new RangeError('releaseProgramCapacity는 양수여야 합니다.');
    }
    return Object.freeze({
        capacity: recordCapacity,
        buffer: new ArrayBuffer(
            GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.RELEASE_HEADER.STRIDE
                + (recordCapacity
                    * GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.RELEASE_RECORD.STRIDE)
        )
    });
}

export function readGpuProjectileCaptureTickHeader(view, offset = 0) {
    const a = GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.TICK_HEADER;
    requireDataViewCapacity(view, offset + a.STRIDE, 'capture tick header');
    const u = (field) => view.getUint32(offset + field, LITTLE_ENDIAN);
    return Object.freeze({
        abiVersion: u(a.ABI_VERSION),
        sessionGeneration: u(a.SESSION_GENERATION),
        deviceGeneration: u(a.DEVICE_GENERATION),
        authoritativeEpoch: u(a.AUTHORITATIVE_EPOCH),
        sourceTick: u(a.SOURCE_FIXED_TICK),
        completedThroughTick: u(a.COMPLETED_THROUGH_TICK),
        status: u(a.STATUS),
        errorFlags: u(a.ERROR_FLAGS),
        candidateCount: u(a.CANDIDATE_COUNT),
        selectedCount: u(a.SELECTED_COUNT),
        captureCount: u(a.CAPTURE_COUNT),
        releasePreparationCount: u(a.RELEASE_PREPARATION_COUNT),
        cleanupCount: u(a.CLEANUP_COUNT),
        overflowFlags: u(a.OVERFLOW_FLAGS),
        batchIdFingerprint: u(a.BATCH_FINGERPRINT),
        reserved: u(a.RESERVED)
    });
}

export function readGpuProjectileCaptureReleaseHeader(view, offset = 0) {
    const a = GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.RELEASE_HEADER;
    requireDataViewCapacity(view, offset + a.STRIDE, 'capture release header');
    const u = (field) => view.getUint32(offset + field, LITTLE_ENDIAN);
    return Object.freeze({
        abiVersion: u(a.ABI_VERSION),
        sessionGeneration: u(a.SESSION_GENERATION),
        deviceGeneration: u(a.DEVICE_GENERATION),
        authoritativeEpoch: u(a.AUTHORITATIVE_EPOCH),
        publicationFixedTick: u(a.PUBLICATION_FIXED_TICK),
        recordCount: u(a.RECORD_COUNT),
        status: u(a.STATUS),
        errorFlags: u(a.ERROR_FLAGS),
        validatedCount: u(a.VALIDATED_COUNT),
        committedCount: u(a.COMMITTED_COUNT),
        batchIdFingerprint: u(a.BATCH_FINGERPRINT),
        resultFingerprint: u(a.RESULT_FINGERPRINT),
        flags: u(a.FLAGS),
        reserved0: u(a.RESERVED_0),
        reserved1: u(a.RESERVED_1),
        reserved2: u(a.RESERVED_2)
    });
}

export function readGpuProjectileCaptureReleaseRecord(view, index) {
    const a = GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.RELEASE_RECORD;
    const base = GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.RELEASE_HEADER.STRIDE
        + requireUint32(index, 'releaseRecordIndex') * a.STRIDE;
    requireDataViewCapacity(view, base + a.STRIDE, 'capture release record');
    const u = (field) => view.getUint32(base + field, LITTLE_ENDIAN);
    const f = (field) => view.getFloat32(base + field, LITTLE_ENDIAN);
    return Object.freeze({
        commandIdFingerprint: u(a.COMMAND_ID_FINGERPRINT),
        prepareFingerprint: u(a.PREPARE_FINGERPRINT),
        captorBodySlot: u(a.CAPTOR_BODY_SLOT),
        captorHandle: Object.freeze({
            entityId: u(a.CAPTOR_ENTITY_ID),
            incarnation: u(a.CAPTOR_INCARNATION)
        }),
        projectileBodySlot: u(a.PROJECTILE_BODY_SLOT),
        projectileHandle: Object.freeze({
            entityId: u(a.PROJECTILE_ENTITY_ID),
            incarnation: u(a.PROJECTILE_INCARNATION)
        }),
        captureSequence: u(a.CAPTURE_SEQUENCE),
        capturedAtFixedTick: u(a.CAPTURED_AT_FIXED_TICK),
        preparedAtFixedTick: u(a.PREPARED_AT_FIXED_TICK),
        releaseReason: u(a.RELEASE_REASON),
        position: Object.freeze({ x: f(a.POSITION_X), y: f(a.POSITION_Y) }),
        positionBits: Object.freeze({ x: u(a.POSITION_X), y: u(a.POSITION_Y) }),
        velocity: Object.freeze({ x: f(a.VELOCITY_X), y: f(a.VELOCITY_Y) }),
        velocityBits: Object.freeze({ x: u(a.VELOCITY_X), y: u(a.VELOCITY_Y) }),
        capturedSpeed: f(a.CAPTURED_SPEED),
        capturedSpeedBits: u(a.CAPTURED_SPEED),
        targetSelector: u(a.TARGET_SELECTOR),
        targetBodySlot: u(a.TARGET_BODY_SLOT),
        targetHandle: Object.freeze({
            entityId: u(a.TARGET_ENTITY_ID),
            incarnation: u(a.TARGET_INCARNATION)
        }),
        nextGameplayMeta: u(a.NEXT_GAMEPLAY_META),
        nextInteractionMeta: u(a.NEXT_INTERACTION_META),
        nextTargetLayerMask: u(a.NEXT_TARGET_LAYER_MASK)
    });
}

export function writeGpuProjectileCaptureReleaseHeader(view, source) {
    const a = GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.RELEASE_HEADER;
    requireDataViewCapacity(view, a.STRIDE, 'capture release header');
    const put = (field, value, label) => writeU32(view, 0, field, value, label);
    put(a.ABI_VERSION, GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION, 'abiVersion');
    put(a.SESSION_GENERATION, source.sessionGeneration, 'sessionGeneration');
    put(a.DEVICE_GENERATION, source.deviceGeneration, 'deviceGeneration');
    put(a.AUTHORITATIVE_EPOCH, source.authoritativeEpoch, 'authoritativeEpoch');
    put(a.PUBLICATION_FIXED_TICK, source.publicationFixedTick, 'publicationFixedTick');
    put(a.RECORD_COUNT, source.recordCount, 'recordCount');
    put(a.STATUS, GPU_PROJECTILE_CAPTURE_TICK_STATUS.RESET, 'status');
    put(a.ERROR_FLAGS, 0, 'errorFlags');
    put(a.VALIDATED_COUNT, 0, 'validatedCount');
    put(a.COMMITTED_COUNT, 0, 'committedCount');
    put(a.BATCH_FINGERPRINT, source.batchIdFingerprint, 'batchIdFingerprint');
    put(a.RESULT_FINGERPRINT, 0, 'resultFingerprint');
    put(a.FLAGS, source.flags, 'flags');
    put(a.RESERVED_0, 0, 'reserved0');
    put(a.RESERVED_1, 0, 'reserved1');
    put(a.RESERVED_2, 0, 'reserved2');
}

export function writeGpuProjectileCaptureReleaseRecord(view, index, source) {
    const a = GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.RELEASE_RECORD;
    const base = GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.RELEASE_HEADER.STRIDE
        + requireUint32(index, 'releaseRecordIndex') * a.STRIDE;
    requireDataViewCapacity(view, base + a.STRIDE, 'capture release record');
    const put = (field, value, label) => writeU32(view, base, field, value, label);
    const putF = (field, value, label) => writeF32(view, base, field, value, label);
    put(a.COMMAND_ID_FINGERPRINT, source.commandIdFingerprint, 'commandIdFingerprint');
    put(a.PREPARE_FINGERPRINT, source.prepareFingerprint, 'prepareFingerprint');
    put(a.CAPTOR_BODY_SLOT, source.captorBodySlot, 'captorBodySlot');
    put(a.CAPTOR_ENTITY_ID, source.captorHandle?.entityId, 'captorEntityId');
    put(a.CAPTOR_INCARNATION, source.captorHandle?.incarnation, 'captorIncarnation');
    put(a.PROJECTILE_BODY_SLOT, source.projectileBodySlot, 'projectileBodySlot');
    put(a.PROJECTILE_ENTITY_ID, source.projectileHandle?.entityId, 'projectileEntityId');
    put(a.PROJECTILE_INCARNATION, source.projectileHandle?.incarnation, 'projectileIncarnation');
    put(a.CAPTURE_SEQUENCE, source.captureSequence, 'captureSequence');
    put(a.CAPTURED_AT_FIXED_TICK, source.capturedAtFixedTick, 'capturedAtFixedTick');
    put(a.PREPARED_AT_FIXED_TICK, source.preparedAtFixedTick, 'preparedAtFixedTick');
    put(a.RELEASE_REASON, source.releaseReason, 'releaseReason');
    putF(a.POSITION_X, source.position?.x, 'position.x');
    putF(a.POSITION_Y, source.position?.y, 'position.y');
    putF(a.VELOCITY_X, source.velocity?.x, 'velocity.x');
    putF(a.VELOCITY_Y, source.velocity?.y, 'velocity.y');
    putF(a.CAPTURED_SPEED, source.capturedSpeed, 'capturedSpeed');
    put(a.TARGET_SELECTOR, source.targetSelector, 'targetSelector');
    put(a.TARGET_BODY_SLOT, source.targetBodySlot, 'targetBodySlot');
    put(a.TARGET_ENTITY_ID, source.targetHandle?.entityId, 'targetEntityId');
    put(a.TARGET_INCARNATION, source.targetHandle?.incarnation, 'targetIncarnation');
    put(a.NEXT_GAMEPLAY_META, source.nextGameplayMeta, 'nextGameplayMeta');
    put(a.NEXT_INTERACTION_META, source.nextInteractionMeta, 'nextInteractionMeta');
    put(a.NEXT_TARGET_LAYER_MASK, source.nextTargetLayerMask, 'nextTargetLayerMask');
    return index;
}

export function writeGpuProjectileCaptureProfile(view, index, profile) {
    if (!(view instanceof DataView) || !profile || typeof profile !== 'object') {
        throw new TypeError('capture profile DataView/object가 필요합니다.');
    }
    const abi = GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.PROFILE;
    const base = requireUint32(index, 'profileIndex') * abi.STRIDE;
    if (base + abi.STRIDE > view.byteLength) {
        throw new RangeError('capture profile buffer capacity를 초과했습니다.');
    }
    writeU32(view, base, abi.PROFILE_CODE, profile.profileCode, 'profileCode');
    writeU32(view, base, abi.FLAGS, profile.flags ?? 0, 'profile.flags');
    writeU32(
        view,
        base,
        abi.SLOT_CAPACITY,
        profile.slotCapacity,
        'profile.slotCapacity'
    );
    writeU32(
        view,
        base,
        abi.CAPTURE_DELAY_FIXED_TICKS,
        profile.captureDelayFixedTicks,
        'profile.captureDelayFixedTicks'
    );
    writeF32(
        view,
        base,
        abi.FUNNEL_COS_HALF_ANGLE,
        profile.funnelCosHalfAngle,
        'profile.funnelCosHalfAngle'
    );
    writeF32(
        view,
        base,
        abi.EXIT_CLEARANCE_TILES,
        profile.exitClearanceTiles,
        'profile.exitClearanceTiles'
    );
    writeF32(
        view,
        base,
        abi.RELEASE_SPEED_SCALE,
        profile.releaseSpeedScale ?? 1,
        'profile.releaseSpeedScale'
    );
    writeU32(view, base, abi.RESERVED, 0, 'profile.reserved');
    return index;
}

export function writeGpuProjectileCaptureTargetConfig(view, config = null) {
    if (!(view instanceof DataView)
        || view.byteLength < GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.TARGET_CONFIG.STRIDE) {
        throw new TypeError('capture target config DataView가 필요합니다.');
    }
    const abi = GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.TARGET_CONFIG;
    const empty = config === null || config === undefined;
    const invalid = GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT;
    writeU32(view, 0, abi.BODY_SLOT, empty ? invalid : config.bodySlot, 'target.bodySlot');
    writeU32(view, 0, abi.ENTITY_ID, empty ? invalid : config.entityId, 'target.entityId');
    writeU32(
        view,
        0,
        abi.INCARNATION,
        empty ? invalid : config.incarnation,
        'target.incarnation'
    );
    writeU32(
        view,
        0,
        abi.SELECTOR,
        empty
            ? GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD
            : GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.TOWER,
        'target.selector'
    );
}

export function decodeGpuProjectileCaptureCompletion(view, offset = 0) {
    if (!(view instanceof DataView)) {
        throw new TypeError('capture completion DataView가 필요합니다.');
    }
    const a = GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.COMPLETION;
    if (offset < 0 || offset + a.STRIDE > view.byteLength) {
        throw new RangeError('capture completion offset이 범위를 벗어났습니다.');
    }
    const u = (field) => view.getUint32(offset + field, LITTLE_ENDIAN);
    const f = (field) => view.getFloat32(offset + field, LITTLE_ENDIAN);
    return Object.freeze({
        type: u(a.TYPE),
        flags: u(a.FLAGS),
        captorBodySlot: u(a.CAPTOR_BODY_SLOT),
        captorHandle: Object.freeze({
            entityId: u(a.CAPTOR_ENTITY_ID),
            incarnation: u(a.CAPTOR_INCARNATION)
        }),
        projectileBodySlot: u(a.PROJECTILE_BODY_SLOT),
        projectileHandle: Object.freeze({
            entityId: u(a.PROJECTILE_ENTITY_ID),
            incarnation: u(a.PROJECTILE_INCARNATION)
        }),
        capturedAtFixedTick: u(a.CAPTURED_AT_FIXED_TICK),
        releaseDueFixedTick: u(a.RELEASE_DUE_FIXED_TICK),
        captureSequence: u(a.CAPTURE_SEQUENCE),
        prepareFingerprint: u(a.PREPARE_FINGERPRINT),
        anchor: Object.freeze({ x: f(a.ANCHOR_X), y: f(a.ANCHOR_Y) }),
        facing: Object.freeze({ x: f(a.FACING_X), y: f(a.FACING_Y) }),
        capturedSpeed: f(a.CAPTURED_SPEED),
        targetSelector: u(a.TARGET_SELECTOR),
        targetBodySlot: u(a.TARGET_BODY_SLOT),
        targetHandle: Object.freeze({
            entityId: u(a.TARGET_ENTITY_ID),
            incarnation: u(a.TARGET_INCARNATION)
        }),
        profileCode: u(a.PROFILE_CODE),
        reason: u(a.REASON),
        reserved: u(a.RESERVED)
    });
}
