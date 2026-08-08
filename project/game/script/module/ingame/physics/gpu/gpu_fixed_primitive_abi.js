const UINT32_MAX = 0xffffffff;
const LITTLE_ENDIAN = true;

/** Body ABI와 독립적으로 versioning되는 next-fixed control program ABI입니다. */
export const GPU_BODY_CONTROL_PROGRAM_ABI_VERSION = 1;

/** Source-relative destination materialization 전용 SpawnProgram ABI version입니다. */
export const GPU_SPAWN_PROGRAM_ABI_VERSION = 3;

/**
 * Phase 3 fixed primitive의 host/WGSL 공용 byte layout입니다.
 * Body/event ABI v2의 stride나 offset에는 영향을 주지 않습니다.
 */
export const GPU_FIXED_PRIMITIVE_ABI = Object.freeze({
    PROGRAM_HEADER: Object.freeze({
        STRIDE: 16,
        ABI_VERSION: 0,
        COUNT: 4,
        CAPACITY: 8,
        STATUS: 12
    }),
    BODY_CONTROL_RECORD: Object.freeze({
        STRIDE: 32,
        DESTINATION_SLOT: 0,
        ENTITY_ID: 4,
        INCARNATION: 8,
        FLAGS: 12,
        MOVE_INTENT_X: 16,
        MOVE_INTENT_Y: 20,
        RESERVED_0: 24,
        RESERVED_1: 28
    }),
    BODY_CONTROL_STATE: Object.freeze({
        STRIDE: 16,
        MOVE_INTENT_X: 0,
        MOVE_INTENT_Y: 4,
        ENTITY_ID: 8,
        INCARNATION: 12
    }),
    SPAWN_PROGRAM_RECORD: Object.freeze({
        STRIDE: 80,
        DESTINATION_SLOT: 0,
        DESTINATION_ENTITY_ID: 4,
        DESTINATION_INCARNATION: 8,
        SOURCE_SLOT: 12,
        SOURCE_ENTITY_ID: 16,
        SOURCE_INCARNATION: 20,
        TARGET_SLOT: 24,
        TARGET_ENTITY_ID: 28,
        TARGET_INCARNATION: 32,
        MODE_FLAGS: 36,
        RESULT: 40,
        SOURCE_TICK: 44,
        POSITION_OFFSET_X: 48,
        POSITION_OFFSET_Y: 52,
        TARGET_OFFSET_X: 56,
        TARGET_OFFSET_Y: 60,
        MODE_VECTOR_X: 64,
        MODE_VECTOR_Y: 68,
        MODE_SCALAR: 72,
        VECTOR_X: 64,
        VECTOR_Y: 68,
        SCALAR: 72,
        LAUNCH_VELOCITY_X: 64,
        LAUNCH_VELOCITY_Y: 68,
        SOURCE_VELOCITY_SCALE: 72,
        RESERVED_0: 76
    }),
    TRACKED_POSE_CONFIG: Object.freeze({
        STRIDE: 16,
        SOURCE_SLOT: 0,
        ENTITY_ID: 4,
        INCARNATION: 8,
        ENABLED: 12
    }),
    TRACKED_POSE_RECORD: Object.freeze({
        STRIDE: 32,
        POSITION_X: 0,
        POSITION_Y: 4,
        VELOCITY_X: 8,
        VELOCITY_Y: 12,
        PREVIOUS_POSITION_X: 16,
        PREVIOUS_POSITION_Y: 20,
        ENTITY_ID: 24,
        INCARNATION: 28
    })
});

export const GPU_FIXED_PRIMITIVE_IDENTITY = Object.freeze({
    INVALID_COMPONENT: UINT32_MAX
});

export const GPU_FIXED_PROGRAM_STATUS = Object.freeze({
    OK: 0,
    ABI_MISMATCH: 1 << 0,
    CAPACITY_EXCEEDED: 1 << 1,
    RECORD_INVALID: 1 << 2
});

export const GPU_SPAWN_PROGRAM_MODE = Object.freeze({
    SOURCE_RELATIVE_VELOCITY: 1,
    SOURCE_RELATIVE_TICK_START: 1,
    SOURCE_RELATIVE_AIM_POINT: 2,
    SOURCE_RELATIVE_TARGET_ENTITY: 3
});

export const GPU_SPAWN_PROGRAM_RESULT = Object.freeze({
    PENDING: 0,
    RESOLVED: 1,
    SOURCE_INVALID: 2,
    DESTINATION_INVALID: 3,
    TARGET_INVALID: 4
});

function requireCapacity(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number >= UINT32_MAX) {
        throw new RangeError(`${label}은 reserved sentinel보다 작은 양의 정수여야 합니다.`);
    }
    return number;
}

function requireUint32(value, label, allowInvalid = false) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number < 0
        || number > UINT32_MAX
        || (!allowInvalid && number === UINT32_MAX)) {
        throw new RangeError(`${label}은 유효한 uint32 정수여야 합니다.`);
    }
    return number >>> 0;
}

function requireFloat32(value, label) {
    const number = Number(value);
    const rounded = Math.fround(number);
    if (!Number.isFinite(number) || !Number.isFinite(rounded)) {
        throw new RangeError(`${label}은 유한한 float32여야 합니다.`);
    }
    return rounded;
}

function requireProgramStorage(storage, recordStride, version, label) {
    if (!storage || typeof storage !== 'object') {
        throw new TypeError(`${label} storage가 필요합니다.`);
    }
    const capacity = requireCapacity(storage.capacity, `${label}.capacity`);
    const expectedByteLength = GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STRIDE
        + (capacity * recordStride);
    if (!(storage.buffer instanceof ArrayBuffer)
        || storage.buffer.byteLength !== expectedByteLength) {
        throw new TypeError(`${label} buffer 크기가 ABI/capacity와 다릅니다.`);
    }
    const actualVersion = new DataView(storage.buffer).getUint32(
        GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.ABI_VERSION,
        LITTLE_ENDIAN
    );
    if (actualVersion !== version) {
        throw new RangeError(
            `${label} ABI version mismatch: expected=${version}, actual=${actualVersion}`
        );
    }
    return capacity;
}

function createProgramStorage(capacity, recordStride, version) {
    const safeCapacity = requireCapacity(capacity, 'program.capacity');
    const buffer = new ArrayBuffer(
        GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STRIDE
            + (safeCapacity * recordStride)
    );
    const storage = { capacity: safeCapacity, buffer };
    const view = new DataView(buffer);
    view.setUint32(
        GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.ABI_VERSION,
        version,
        LITTLE_ENDIAN
    );
    view.setUint32(
        GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.CAPACITY,
        safeCapacity,
        LITTLE_ENDIAN
    );
    return storage;
}

function writeProgramHeader(storage, recordStride, version, count, status, label) {
    const capacity = requireProgramStorage(
        storage,
        recordStride,
        version,
        label
    );
    const safeCount = requireUint32(count, `${label}.count`, true);
    if (safeCount > capacity) {
        throw new RangeError(`${label}.count가 capacity를 초과했습니다.`);
    }
    const view = new DataView(storage.buffer);
    view.setUint32(
        GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.ABI_VERSION,
        version,
        LITTLE_ENDIAN
    );
    view.setUint32(
        GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.COUNT,
        safeCount,
        LITTLE_ENDIAN
    );
    view.setUint32(
        GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.CAPACITY,
        capacity,
        LITTLE_ENDIAN
    );
    view.setUint32(
        GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STATUS,
        requireUint32(status, `${label}.status`, true),
        LITTLE_ENDIAN
    );
}

function readProgramHeader(storage, recordStride, version, label) {
    requireProgramStorage(storage, recordStride, version, label);
    const view = new DataView(storage.buffer);
    return Object.freeze({
        abiVersion: view.getUint32(
            GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.ABI_VERSION,
            LITTLE_ENDIAN
        ),
        count: view.getUint32(
            GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.COUNT,
            LITTLE_ENDIAN
        ),
        capacity: view.getUint32(
            GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.CAPACITY,
            LITTLE_ENDIAN
        ),
        status: view.getUint32(
            GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STATUS,
            LITTLE_ENDIAN
        )
    });
}

export function createGpuBodyControlProgramStorage(capacity) {
    return createProgramStorage(
        capacity,
        GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_RECORD.STRIDE,
        GPU_BODY_CONTROL_PROGRAM_ABI_VERSION
    );
}

export function writeGpuBodyControlProgramHeader(storage, count, status = 0) {
    writeProgramHeader(
        storage,
        GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_RECORD.STRIDE,
        GPU_BODY_CONTROL_PROGRAM_ABI_VERSION,
        count,
        status,
        'bodyControlProgram'
    );
}

export function readGpuBodyControlProgramHeader(storage) {
    return readProgramHeader(
        storage,
        GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_RECORD.STRIDE,
        GPU_BODY_CONTROL_PROGRAM_ABI_VERSION,
        'bodyControlProgram'
    );
}

export function writeGpuBodyControlProgramRecord(storage, index, command) {
    const capacity = requireProgramStorage(
        storage,
        GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_RECORD.STRIDE,
        GPU_BODY_CONTROL_PROGRAM_ABI_VERSION,
        'bodyControlProgram'
    );
    const slot = requireUint32(index, 'bodyControlProgram.index', true);
    if (slot >= capacity) {
        throw new RangeError('bodyControlProgram.index가 capacity를 벗어났습니다.');
    }
    const moveX = requireFloat32(command?.moveIntentX, 'command.moveIntentX');
    const moveY = requireFloat32(command?.moveIntentY, 'command.moveIntentY');
    if (Math.hypot(moveX, moveY) > 1.000001) {
        throw new RangeError('body control move intent의 크기는 1 이하여야 합니다.');
    }
    const abi = GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_RECORD;
    const offset = GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STRIDE
        + (slot * abi.STRIDE);
    const view = new DataView(storage.buffer);
    view.setUint32(offset + abi.DESTINATION_SLOT, requireUint32(
        command.destinationSlot,
        'command.destinationSlot'
    ), LITTLE_ENDIAN);
    view.setUint32(offset + abi.ENTITY_ID, requireUint32(
        command.entityId,
        'command.entityId'
    ), LITTLE_ENDIAN);
    view.setUint32(offset + abi.INCARNATION, requireUint32(
        command.incarnation,
        'command.incarnation'
    ), LITTLE_ENDIAN);
    const flags = requireUint32(
        command.flags ?? 0,
        'command.flags',
        true
    );
    if (flags !== 0
        || requireUint32(command.reserved0 ?? 0, 'command.reserved0', true) !== 0
        || requireUint32(command.reserved1 ?? 0, 'command.reserved1', true) !== 0) {
        throw new RangeError('body control flags/reserved는 Phase 3에서 0이어야 합니다.');
    }
    view.setUint32(offset + abi.FLAGS, flags, LITTLE_ENDIAN);
    view.setFloat32(offset + abi.MOVE_INTENT_X, moveX, LITTLE_ENDIAN);
    view.setFloat32(offset + abi.MOVE_INTENT_Y, moveY, LITTLE_ENDIAN);
    view.setUint32(offset + abi.RESERVED_0, 0, LITTLE_ENDIAN);
    view.setUint32(offset + abi.RESERVED_1, 0, LITTLE_ENDIAN);
}

export function createGpuSpawnProgramStorage(capacity) {
    return createProgramStorage(
        capacity,
        GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.STRIDE,
        GPU_SPAWN_PROGRAM_ABI_VERSION
    );
}

export function writeGpuSpawnProgramHeader(storage, count, status = 0) {
    writeProgramHeader(
        storage,
        GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.STRIDE,
        GPU_SPAWN_PROGRAM_ABI_VERSION,
        count,
        status,
        'spawnProgram'
    );
}

export function readGpuSpawnProgramHeader(storage) {
    return readProgramHeader(
        storage,
        GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.STRIDE,
        GPU_SPAWN_PROGRAM_ABI_VERSION,
        'spawnProgram'
    );
}

export function writeGpuSpawnProgramRecord(storage, index, record) {
    const capacity = requireProgramStorage(
        storage,
        GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.STRIDE,
        GPU_SPAWN_PROGRAM_ABI_VERSION,
        'spawnProgram'
    );
    const recordIndex = requireUint32(index, 'spawnProgram.index', true);
    if (recordIndex >= capacity) {
        throw new RangeError('spawnProgram.index가 capacity를 벗어났습니다.');
    }
    const abi = GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD;
    const offset = GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STRIDE
        + (recordIndex * abi.STRIDE);
    const view = new DataView(storage.buffer);
    view.setUint32(offset + abi.DESTINATION_SLOT, requireUint32(
        record.destinationSlot,
        'spawnProgram.destinationSlot'
    ), LITTLE_ENDIAN);
    view.setUint32(offset + abi.DESTINATION_ENTITY_ID, requireUint32(
        record.destinationEntityId,
        'spawnProgram.destinationEntityId'
    ), LITTLE_ENDIAN);
    view.setUint32(offset + abi.DESTINATION_INCARNATION, requireUint32(
        record.destinationIncarnation,
        'spawnProgram.destinationIncarnation'
    ), LITTLE_ENDIAN);
    view.setUint32(offset + abi.SOURCE_SLOT, requireUint32(
        record.sourceSlot,
        'spawnProgram.sourceSlot'
    ), LITTLE_ENDIAN);
    view.setUint32(offset + abi.SOURCE_ENTITY_ID, requireUint32(
        record.sourceEntityId,
        'spawnProgram.sourceEntityId'
    ), LITTLE_ENDIAN);
    view.setUint32(offset + abi.SOURCE_INCARNATION, requireUint32(
        record.sourceIncarnation,
        'spawnProgram.sourceIncarnation'
    ), LITTLE_ENDIAN);
    const modeFlags = requireUint32(
        record.modeFlags ?? GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TICK_START,
        'spawnProgram.modeFlags',
        true
    );
    const result = requireUint32(
        record.result ?? GPU_SPAWN_PROGRAM_RESULT.PENDING,
        'spawnProgram.result',
        true
    );
    const reserved0 = requireUint32(
        record.reserved0 ?? 0,
        'spawnProgram.reserved0',
        true
    );
    const reserved1 = requireUint32(
        record.reserved1 ?? 0,
        'spawnProgram.reserved1',
        true
    );
    if ((modeFlags !== GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY
            && modeFlags !== GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT
            && modeFlags !== GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY)
        || result !== GPU_SPAWN_PROGRAM_RESULT.PENDING
        || reserved0 !== 0
        || reserved1 !== 0) {
        throw new RangeError(
            'SpawnProgram mode/result/reserved가 v3 ingress 계약과 다릅니다.'
        );
    }
    const isAimPoint = modeFlags === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT;
    const isTargetEntity = modeFlags
        === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY;
    if (isAimPoint
        && (record.launchVelocity !== undefined
            || record.launchVelocityX !== undefined
            || record.launchVelocityY !== undefined
            || record.sourceVelocityScale !== undefined)) {
        throw new TypeError('aim-point SpawnProgram에는 launchVelocity/sourceVelocityScale을 사용할 수 없습니다.');
    }
    if (!isAimPoint && !isTargetEntity
        && (record.aimWorldPoint !== undefined
            || record.aimWorldPointX !== undefined
            || record.aimWorldPointY !== undefined
            || record.launchSpeed !== undefined)) {
        throw new TypeError('velocity SpawnProgram에는 aimWorldPoint/launchSpeed를 사용할 수 없습니다.');
    }
    if (isTargetEntity
        && (record.launchVelocity !== undefined
            || record.launchVelocityX !== undefined
            || record.launchVelocityY !== undefined
            || record.sourceVelocityScale !== undefined
            || record.aimWorldPoint !== undefined
            || record.aimWorldPointX !== undefined
            || record.aimWorldPointY !== undefined)) {
        throw new TypeError('target-entity SpawnProgram에는 velocity/aim-point payload를 사용할 수 없습니다.');
    }
    const targetSlot = requireUint32(
        record.targetSlot ?? UINT32_MAX,
        'spawnProgram.targetSlot',
        true
    );
    const targetEntityId = requireUint32(
        record.targetEntityId ?? UINT32_MAX,
        'spawnProgram.targetEntityId',
        true
    );
    const targetIncarnation = requireUint32(
        record.targetIncarnation ?? UINT32_MAX,
        'spawnProgram.targetIncarnation',
        true
    );
    const targetOffsetX = requireFloat32(
        record.targetOffset?.x ?? record.targetOffsetX ?? 0,
        'spawnProgram.targetOffset.x'
    );
    const targetOffsetY = requireFloat32(
        record.targetOffset?.y ?? record.targetOffsetY ?? 0,
        'spawnProgram.targetOffset.y'
    );
    if (isTargetEntity) {
        if (targetSlot === UINT32_MAX
            || targetEntityId === 0
            || targetEntityId === UINT32_MAX
            || targetIncarnation === 0
            || targetIncarnation === UINT32_MAX) {
            throw new RangeError(
                'target-entity SpawnProgram에는 exact target identity가 필요합니다.'
            );
        }
    } else if (targetSlot !== UINT32_MAX
        || targetEntityId !== UINT32_MAX
        || targetIncarnation !== UINT32_MAX
        || targetOffsetX !== 0
        || targetOffsetY !== 0) {
        throw new RangeError(
            'non-target SpawnProgram의 target identity/offset은 sentinel/zero여야 합니다.'
        );
    }
    const vector = isTargetEntity
        ? (record.vector ?? record.modeVector)
        : (isAimPoint
            ? (record.vector ?? record.modeVector ?? record.aimWorldPoint)
            : (record.vector ?? record.modeVector ?? record.launchVelocity));
    const scalar = (isAimPoint || isTargetEntity)
        ? (record.scalar ?? record.modeScalar ?? record.launchSpeed)
        : (record.scalar ?? record.modeScalar ?? record.sourceVelocityScale ?? 0);
    const vectorX = requireFloat32(
        vector?.x
            ?? (isAimPoint ? record.aimWorldPointX : record.launchVelocityX)
            ?? 0,
        isTargetEntity
            ? 'spawnProgram.modeVector.x'
            : (isAimPoint
                ? 'spawnProgram.aimWorldPoint.x'
                : 'spawnProgram.launchVelocity.x')
    );
    const vectorY = requireFloat32(
        vector?.y
            ?? (isAimPoint ? record.aimWorldPointY : record.launchVelocityY)
            ?? 0,
        isTargetEntity
            ? 'spawnProgram.modeVector.y'
            : (isAimPoint
                ? 'spawnProgram.aimWorldPoint.y'
                : 'spawnProgram.launchVelocity.y')
    );
    const scalarValue = requireFloat32(
        scalar,
        (isAimPoint || isTargetEntity)
            ? 'spawnProgram.launchSpeed'
            : 'spawnProgram.sourceVelocityScale'
    );
    if ((isAimPoint || isTargetEntity) && scalarValue <= 0) {
        throw new RangeError('aim SpawnProgram launchSpeed는 양의 float32여야 합니다.');
    }
    if (isTargetEntity && (vectorX !== 0 || vectorY !== 0)) {
        throw new RangeError('target-entity SpawnProgram modeVector는 zero여야 합니다.');
    }
    const encodedTargetOffsetX = isTargetEntity ? targetOffsetX : 0;
    const encodedTargetOffsetY = isTargetEntity ? targetOffsetY : 0;
    const encodedVectorX = isTargetEntity ? 0 : vectorX;
    const encodedVectorY = isTargetEntity ? 0 : vectorY;
    view.setUint32(offset + abi.TARGET_SLOT, targetSlot, LITTLE_ENDIAN);
    view.setUint32(offset + abi.TARGET_ENTITY_ID, targetEntityId, LITTLE_ENDIAN);
    view.setUint32(offset + abi.TARGET_INCARNATION, targetIncarnation, LITTLE_ENDIAN);
    view.setUint32(offset + abi.MODE_FLAGS, modeFlags, LITTLE_ENDIAN);
    view.setUint32(offset + abi.RESULT, result, LITTLE_ENDIAN);
    const sourceTick = requireUint32(
        record.sourceTick,
        'spawnProgram.sourceTick',
        true
    );
    if (sourceTick === 0) {
        throw new RangeError('spawnProgram.sourceTick은 양의 fixed tick이어야 합니다.');
    }
    view.setUint32(offset + abi.SOURCE_TICK, sourceTick, LITTLE_ENDIAN);
    view.setFloat32(offset + abi.POSITION_OFFSET_X, requireFloat32(
        record.positionOffset?.x ?? record.positionOffsetX ?? 0,
        'spawnProgram.positionOffset.x'
    ), LITTLE_ENDIAN);
    view.setFloat32(offset + abi.POSITION_OFFSET_Y, requireFloat32(
        record.positionOffset?.y ?? record.positionOffsetY ?? 0,
        'spawnProgram.positionOffset.y'
    ), LITTLE_ENDIAN);
    view.setFloat32(
        offset + abi.TARGET_OFFSET_X,
        encodedTargetOffsetX,
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + abi.TARGET_OFFSET_Y,
        encodedTargetOffsetY,
        LITTLE_ENDIAN
    );
    view.setFloat32(offset + abi.MODE_VECTOR_X, encodedVectorX, LITTLE_ENDIAN);
    view.setFloat32(offset + abi.MODE_VECTOR_Y, encodedVectorY, LITTLE_ENDIAN);
    view.setFloat32(offset + abi.MODE_SCALAR, scalarValue, LITTLE_ENDIAN);
    view.setUint32(offset + abi.RESERVED_0, 0, LITTLE_ENDIAN);
}

export function readGpuSpawnProgramRecord(storage, index) {
    const capacity = requireProgramStorage(
        storage,
        GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.STRIDE,
        GPU_SPAWN_PROGRAM_ABI_VERSION,
        'spawnProgram'
    );
    const recordIndex = requireUint32(index, 'spawnProgram.index', true);
    if (recordIndex >= capacity) {
        throw new RangeError('spawnProgram.index가 capacity를 벗어났습니다.');
    }
    const abi = GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD;
    const offset = GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STRIDE
        + (recordIndex * abi.STRIDE);
    const view = new DataView(storage.buffer);
    const modeFlags = view.getUint32(offset + abi.MODE_FLAGS, LITTLE_ENDIAN);
    const targetOffset = Object.freeze({
        x: view.getFloat32(offset + abi.TARGET_OFFSET_X, LITTLE_ENDIAN),
        y: view.getFloat32(offset + abi.TARGET_OFFSET_Y, LITTLE_ENDIAN)
    });
    const vector = Object.freeze({
        x: view.getFloat32(offset + abi.MODE_VECTOR_X, LITTLE_ENDIAN),
        y: view.getFloat32(offset + abi.MODE_VECTOR_Y, LITTLE_ENDIAN)
    });
    const scalar = view.getFloat32(offset + abi.MODE_SCALAR, LITTLE_ENDIAN);
    let modePayload;
    if (modeFlags === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT) {
        modePayload = {
            aimWorldPoint: vector,
            launchSpeed: scalar
        };
    } else if (modeFlags === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY) {
        modePayload = {
            targetOffset,
            launchSpeed: scalar
        };
    } else {
        modePayload = {
            launchVelocity: vector,
            sourceVelocityScale: scalar
        };
    }
    return Object.freeze({
        destinationSlot: view.getUint32(offset + abi.DESTINATION_SLOT, LITTLE_ENDIAN),
        destinationEntityId: view.getUint32(
            offset + abi.DESTINATION_ENTITY_ID,
            LITTLE_ENDIAN
        ),
        destinationIncarnation: view.getUint32(
            offset + abi.DESTINATION_INCARNATION,
            LITTLE_ENDIAN
        ),
        sourceSlot: view.getUint32(offset + abi.SOURCE_SLOT, LITTLE_ENDIAN),
        sourceEntityId: view.getUint32(offset + abi.SOURCE_ENTITY_ID, LITTLE_ENDIAN),
        sourceIncarnation: view.getUint32(
            offset + abi.SOURCE_INCARNATION,
            LITTLE_ENDIAN
        ),
        targetSlot: view.getUint32(offset + abi.TARGET_SLOT, LITTLE_ENDIAN),
        targetEntityId: view.getUint32(offset + abi.TARGET_ENTITY_ID, LITTLE_ENDIAN),
        targetIncarnation: view.getUint32(
            offset + abi.TARGET_INCARNATION,
            LITTLE_ENDIAN
        ),
        modeFlags,
        result: view.getUint32(offset + abi.RESULT, LITTLE_ENDIAN),
        sourceTick: view.getUint32(offset + abi.SOURCE_TICK, LITTLE_ENDIAN),
        positionOffset: Object.freeze({
            x: view.getFloat32(offset + abi.POSITION_OFFSET_X, LITTLE_ENDIAN),
            y: view.getFloat32(offset + abi.POSITION_OFFSET_Y, LITTLE_ENDIAN)
        }),
        targetOffset,
        vector,
        scalar,
        ...modePayload,
        reserved0: view.getUint32(offset + abi.RESERVED_0, LITTLE_ENDIAN)
    });
}
