import {
    ENEMY_EFFECT_TARGET_POLICY_CODE
} from '../../contract/enemy_effect_contract.js';

const LITTLE_ENDIAN = true;
const UINT32_MAX = 0xffffffff;
const INT32_MAX = 0x7fffffff;

/** Body ABI와 독립적으로 versioning되는 GPU Effect Runtime ABI입니다. */
export const GPU_EFFECT_RUNTIME_ABI_VERSION = 1;
export const GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION = 1;
export const GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION = 1;

export const GPU_EFFECT_LAST_PULSE_TICK_INVALID = UINT32_MAX;

export const GPU_EFFECT_EMITTER_NAVIGATION_CONFIG = Object.freeze({
    RETARGET_INTERVAL_MASK: 0x00000fff,
    ROUTE_FIRST_FIELD_SHIFT: 12,
    ROUTE_FIRST_FIELD_MASK: 0x000ff000,
    ROUTE_FIELD_COUNT_MINUS_ONE_SHIFT: 20,
    ROUTE_FIELD_COUNT_MINUS_ONE_MASK: 0x1ff00000,
    RESERVED_MASK: 0xe0000000,
    MAX_RETARGET_INTERVAL_TICKS: 0x0fff,
    MAX_ROUTE_FIRST_FIELD_INDEX: 0xff,
    MAX_ROUTE_FIELD_COUNT: 0x1ff,
    MAX_ROUTE_ATLAS_FIELD_COUNT: 0x100
});

export const GPU_EFFECT_EMITTER_FLAG = Object.freeze({
    ENABLED: 1 << 0,
    GRID_OVERFLOW_OBSERVED: 1 << 1
});

export const GPU_EFFECT_INSTANCE_FLAG = Object.freeze({
    ACTIVE: 1 << 0,
    PERSIST_AFTER_SOURCE_LOSS: 1 << 1,
    TOWER_CONTACT_DAMAGE_MODIFIABLE: 1 << 8,
    PROJECTILE_TOWER_DAMAGE_MODIFIABLE: 1 << 9,
    DIRECT_CORE_IMPACT_DAMAGE_MODIFIABLE: 1 << 10,
    PROJECTILE_CORE_DAMAGE_MODIFIABLE: 1 << 11
});

export const GPU_EFFECT_PULSE_PROGRAM_FLAG = Object.freeze({
    SELF_TARGET_ALLOWED: 1 << 0,
    PENTA_TARGET_ALLOWED: 1 << 1,
    TOWER_CONTACT_DAMAGE_MODIFIABLE: 1 << 2,
    PROJECTILE_TOWER_DAMAGE_MODIFIABLE: 1 << 3,
    DIRECT_CORE_IMPACT_DAMAGE_MODIFIABLE: 1 << 4,
    PROJECTILE_CORE_DAMAGE_MODIFIABLE: 1 << 5,
    ALLOW_SOURCE_INVALID: 1 << 6
});

export const GPU_EFFECT_DAMAGE_CHANNEL_FLAG = Object.freeze({
    TOWER_CONTACT: 1 << 0,
    PROJECTILE_TOWER: 1 << 1,
    DIRECT_CORE_IMPACT: 1 << 2,
    PROJECTILE_CORE: 1 << 3
});

export const GPU_EFFECT_SUMMARY_FLAG = Object.freeze({
    PROJECTILE_ATTACK_SNAPSHOT: 1 << 16
});

export const GPU_EFFECT_PULSE_PROGRAM_RESULT = Object.freeze({
    PENDING: 0,
    APPLIED: 1,
    ZERO_TARGET: 2,
    SOURCE_INVALID: 3,
    CAPACITY_REJECTED: 4,
    POLICY_REJECTED: 5
});

export const GPU_EFFECT_RUNTIME_STATUS = Object.freeze({
    OK: 0,
    ABI_MISMATCH: 1 << 0,
    PROGRAM_CAPACITY_EXCEEDED: 1 << 1,
    CANDIDATE_CAPACITY_EXCEEDED: 1 << 2,
    INSTANCE_CAPACITY_EXCEEDED: 1 << 3,
    EVENT_CAPACITY_EXCEEDED: 1 << 4,
    INSTANCE_ID_EXHAUSTED: 1 << 5,
    RECORD_INVALID: 1 << 6,
    GRID_OVERFLOW: 1 << 7
});

export const GPU_EFFECT_EVENT_TYPE = Object.freeze({
    PULSE_EMITTED: 1,
    INSTANCE_APPLIED: 2
});

export const GPU_EFFECT_TARGET_POLICY = Object.freeze({
    NONE: 0,
    HOSTILE_ENEMY: ENEMY_EFFECT_TARGET_POLICY_CODE.HOSTILE_ENEMY
});

export const GPU_EFFECT_FAMILY_CODE = Object.freeze({
    NONE: 0,
    BOOST: 1
});

export const GPU_EFFECT_PRESENTATION_TAG = Object.freeze({
    BOOST: 1 << 0,
    PULSE: 1 << 1
});

/** 독립 Effect instance/summary/emitter/pulse/event byte layout입니다. */
export const GPU_EFFECT_RUNTIME_ABI = Object.freeze({
    INSTANCE: Object.freeze({
        STRIDE: 64,
        EFFECT_INSTANCE_ID: 0,
        INSTANCE_INCARNATION: 4,
        EFFECT_DEFINITION_CODE: 8,
        FAMILY_CODE: 12,
        FLAGS: 16,
        SOURCE_SLOT: 20,
        SOURCE_ENTITY_ID: 24,
        SOURCE_INCARNATION: 28,
        TARGET_SLOT: 32,
        TARGET_ENTITY_ID: 36,
        TARGET_INCARNATION: 40,
        APPLIED_TICK: 44,
        EXPIRES_AT_TICK: 48,
        MAGNITUDE: 52,
        PAYLOAD_0: 56,
        TAGS: 60
    }),
    SUMMARY: Object.freeze({
        STRIDE: 80,
        ENTITY_ID: 0,
        INCARNATION: 4,
        MAX_HEALTH_FIXED_POINT: 8,
        AUTHORED_DAMAGE_OTHER: 12,
        RESOLVED_BASE_DAMAGE_OTHER: 16,
        ACTIVE_FAMILY_MASK: 20,
        BOOST_STACK_COUNT: 24,
        REGEN_PER_TICK_FIXED_POINT: 28,
        ATTACK_MULTIPLIER: 32,
        MOVE_SPEED_MULTIPLIER: 36,
        PRESENTATION_TAGS: 40,
        PRESENTATION_MAGNITUDE: 44,
        LAST_PULSE_TICK: 48,
        PULSE_STYLE_CODE: 52,
        SUMMARY_TICK: 56,
        SOURCE_SNAPSHOT_TICK: 60,
        DAMAGE_TAKEN_MULTIPLIER: 64,
        RESERVED_0: 68,
        RESERVED_1: 72,
        FLAGS: 76
    }),
    EMITTER_STATE: Object.freeze({
        STRIDE: 32,
        ENTITY_ID: 0,
        INCARNATION: 4,
        EMITTER_DEFINITION_CODE: 8,
        EFFECT_DEFINITION_CODE: 12,
        LAST_PULSE_TICK: 16,
        FLAGS: 20,
        NAVIGATION_CONFIG: 24,
        RETARGET_INTERVAL_TICKS: 24,
        LAST_RETARGET_TICK: 28
    }),
    PROGRAM_HEADER: Object.freeze({
        STRIDE: 16,
        ABI_VERSION: 0,
        COUNT: 4,
        CAPACITY: 8,
        STATUS: 12
    }),
    PULSE_PROGRAM_RECORD: Object.freeze({
        STRIDE: 64,
        SOURCE_SLOT: 0,
        SOURCE_ENTITY_ID: 4,
        SOURCE_INCARNATION: 8,
        EFFECT_DEFINITION_CODE: 12,
        SOURCE_TICK: 16,
        PULSE_SEQUENCE: 20,
        RADIUS_TILES: 24,
        TARGET_LAYER_MASK: 28,
        TARGET_POLICY: 32,
        FINGERPRINT: 36,
        RESULT: 40,
        CANDIDATE_COUNT: 44,
        APPLIED_COUNT: 48,
        EMITTER_DEFINITION_CODE: 52,
        FLAGS: 56,
        RETARGET_INTERVAL_TICKS: 60
    }),
    CANDIDATE: Object.freeze({
        STRIDE: 32,
        PULSE_INDEX: 0,
        SOURCE_ENTITY_ID: 4,
        SOURCE_INCARNATION: 8,
        TARGET_SLOT: 12,
        TARGET_ENTITY_ID: 16,
        TARGET_INCARNATION: 20,
        EFFECT_DEFINITION_CODE: 24,
        FLAGS: 28
    }),
    EVENT: Object.freeze({
        STRIDE: 48,
        TYPE: 0,
        FLAGS: 4,
        EFFECT_INSTANCE_ID: 8,
        INSTANCE_INCARNATION: 12,
        SOURCE_ENTITY_ID: 16,
        SOURCE_INCARNATION: 20,
        TARGET_ENTITY_ID: 24,
        TARGET_INCARNATION: 28,
        EFFECT_DEFINITION_CODE: 32,
        VALUE_FIXED_POINT: 36,
        WORLD_POSITION_X: 40,
        WORLD_POSITION_Y: 44
    }),
    POOL_STATE: Object.freeze({
        STRIDE: 64,
        ABI_VERSION: 0,
        INPUT_COUNT: 4,
        RETAINED_COUNT: 8,
        CANDIDATE_COUNT: 12,
        VALID_PULSE_COUNT: 16,
        EVENT_COUNT: 20,
        STATUS: 24,
        BATCH_ACCEPTED: 28,
        NEXT_INSTANCE_ID: 32,
        INSTANCE_EPOCH: 36,
        MATERIALIZED_COUNT: 40,
        SOURCE_TICK: 44,
        CANDIDATE_OVERFLOW: 48,
        EVENT_OVERFLOW: 52,
        PULSE_RESULT_COUNT: 56,
        RESERVED_0: 60
    })
});

function requireUint32(value, label, { allowSentinel = true } = {}) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number < 0
        || number > UINT32_MAX
        || (!allowSentinel && number === UINT32_MAX)) {
        throw new RangeError(`${label}은 유효한 uint32 정수여야 합니다.`);
    }
    return number >>> 0;
}

function requirePositiveUint32(value, label) {
    const number = requireUint32(value, label, { allowSentinel: false });
    if (number === 0) {
        throw new RangeError(`${label}은 양의 uint32 정수여야 합니다.`);
    }
    return number;
}

function requireFiniteFloat32(value, label) {
    const number = Math.fround(Number(value));
    if (!Number.isFinite(number)) {
        throw new TypeError(`${label}은 유한 float32여야 합니다.`);
    }
    return number;
}

function encodeHealthFixedPoint(value, label) {
    const number = requireFiniteFloat32(value, label);
    if (number < 0) {
        throw new RangeError(`${label}은 0 이상이어야 합니다.`);
    }
    const fixed = Math.trunc(Math.fround(number * Math.fround(100)));
    if (!Number.isSafeInteger(fixed) || fixed < 0 || fixed > INT32_MAX) {
        throw new RangeError(`${label} fixed-point가 int32 범위를 벗어났습니다.`);
    }
    return fixed;
}

function writeIdentity(view, offset, body) {
    const entityId = body?.entityId ?? body?.handle?.entityId;
    const incarnation = body?.incarnation ?? body?.handle?.incarnation;
    const hasIdentity = entityId !== undefined && incarnation !== undefined;
    view.setUint32(
        offset,
        hasIdentity
            ? requirePositiveUint32(entityId, 'effect body entityId')
            : UINT32_MAX,
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + 4,
        hasIdentity
            ? requirePositiveUint32(incarnation, 'effect body incarnation')
            : UINT32_MAX,
        LITTLE_ENDIAN
    );
    return hasIdentity;
}

export function normalizeGpuEffectEmitterState(
    source,
    label = 'effectEmitterState'
) {
    if (source === undefined || source === null) {
        return Object.freeze({
            emitterDefinitionCode: 0,
            effectDefinitionCode: 0,
            lastPulseTick: GPU_EFFECT_LAST_PULSE_TICK_INVALID,
            flags: 0
        });
    }
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label}은 객체여야 합니다.`);
    }
    const emitterDefinitionCode = requirePositiveUint32(
        source.emitterDefinitionCode,
        `${label}.emitterDefinitionCode`
    );
    const effectDefinitionCode = requirePositiveUint32(
        source.effectDefinitionCode,
        `${label}.effectDefinitionCode`
    );
    const lastPulseTick = requireUint32(
        source.lastPulseTick ?? GPU_EFFECT_LAST_PULSE_TICK_INVALID,
        `${label}.lastPulseTick`
    );
    const flags = requireUint32(
        source.flags ?? GPU_EFFECT_EMITTER_FLAG.ENABLED,
        `${label}.flags`
    );
    if ((flags & ~GPU_EFFECT_EMITTER_FLAG.ENABLED) !== 0
        || (flags & GPU_EFFECT_EMITTER_FLAG.ENABLED) === 0) {
        throw new RangeError(`${label}.flags에는 ENABLED만 필요합니다.`);
    }
    return Object.freeze({
        emitterDefinitionCode,
        effectDefinitionCode,
        lastPulseTick,
        flags
    });
}

export function createGpuEffectBodyStateStorage(capacity) {
    const safeCapacity = requirePositiveUint32(capacity, 'effect body capacity');
    return Object.freeze({
        summaryBuffer: new ArrayBuffer(
            GPU_EFFECT_RUNTIME_ABI.SUMMARY.STRIDE * safeCapacity
        ),
        emitterStateBuffer: new ArrayBuffer(
            GPU_EFFECT_RUNTIME_ABI.EMITTER_STATE.STRIDE * safeCapacity
        )
    });
}

export function writeGpuEffectBodyStateSpawn(storage, index, body = {}) {
    const summary = GPU_EFFECT_RUNTIME_ABI.SUMMARY;
    const emitter = GPU_EFFECT_RUNTIME_ABI.EMITTER_STATE;
    const summaryView = new DataView(storage.summaryBuffer);
    const emitterView = new DataView(storage.emitterStateBuffer);
    const summaryOffset = requireUint32(index, 'effect body index') * summary.STRIDE;
    const emitterOffset = index * emitter.STRIDE;
    if (summaryOffset + summary.STRIDE > storage.summaryBuffer.byteLength
        || emitterOffset + emitter.STRIDE > storage.emitterStateBuffer.byteLength) {
        throw new RangeError('effect body index가 storage capacity를 벗어났습니다.');
    }
    new Uint8Array(storage.summaryBuffer, summaryOffset, summary.STRIDE).fill(0);
    new Uint8Array(storage.emitterStateBuffer, emitterOffset, emitter.STRIDE).fill(0);
    const hasIdentity = writeIdentity(summaryView, summaryOffset, body);
    writeIdentity(emitterView, emitterOffset, body);
    const maxHealthFixedPoint = body.maxHealthFixedPoint === undefined
        ? encodeHealthFixedPoint(
            body.maxHealth ?? body.health ?? 0,
            'effect body maxHealth'
        )
        : Number(body.maxHealthFixedPoint);
    if (!Number.isSafeInteger(maxHealthFixedPoint)
        || maxHealthFixedPoint < 0
        || maxHealthFixedPoint > INT32_MAX) {
        throw new RangeError(
            'effect body maxHealthFixedPoint는 nonnegative int32여야 합니다.'
        );
    }
    summaryView.setInt32(
        summaryOffset + summary.MAX_HEALTH_FIXED_POINT,
        hasIdentity ? maxHealthFixedPoint : 0,
        LITTLE_ENDIAN
    );
    const authoredDamageOther = hasIdentity
        ? requireFiniteFloat32(
            body.contactHandler?.damageOther ?? 0,
            'effect body contactHandler.damageOther'
        )
        : 0;
    summaryView.setFloat32(
        summaryOffset + summary.AUTHORED_DAMAGE_OTHER,
        authoredDamageOther,
        LITTLE_ENDIAN
    );
    summaryView.setFloat32(
        summaryOffset + summary.RESOLVED_BASE_DAMAGE_OTHER,
        authoredDamageOther,
        LITTLE_ENDIAN
    );
    summaryView.setFloat32(
        summaryOffset + summary.ATTACK_MULTIPLIER,
        1,
        LITTLE_ENDIAN
    );
    summaryView.setFloat32(
        summaryOffset + summary.MOVE_SPEED_MULTIPLIER,
        1,
        LITTLE_ENDIAN
    );
    summaryView.setUint32(
        summaryOffset + summary.LAST_PULSE_TICK,
        GPU_EFFECT_LAST_PULSE_TICK_INVALID,
        LITTLE_ENDIAN
    );
    summaryView.setFloat32(
        summaryOffset + summary.DAMAGE_TAKEN_MULTIPLIER,
        1,
        LITTLE_ENDIAN
    );

    const normalizedEmitter = normalizeGpuEffectEmitterState(
        body.effectEmitterState ?? null
    );
    emitterView.setUint32(
        emitterOffset + emitter.EMITTER_DEFINITION_CODE,
        normalizedEmitter.emitterDefinitionCode,
        LITTLE_ENDIAN
    );
    emitterView.setUint32(
        emitterOffset + emitter.EFFECT_DEFINITION_CODE,
        normalizedEmitter.effectDefinitionCode,
        LITTLE_ENDIAN
    );
    emitterView.setUint32(
        emitterOffset + emitter.LAST_PULSE_TICK,
        normalizedEmitter.lastPulseTick,
        LITTLE_ENDIAN
    );
    emitterView.setUint32(
        emitterOffset + emitter.FLAGS,
        normalizedEmitter.flags,
        LITTLE_ENDIAN
    );
    let navigationConfig = 0;
    if (normalizedEmitter.flags !== 0) {
        const config = GPU_EFFECT_EMITTER_NAVIGATION_CONFIG;
        const interval = requirePositiveUint32(
            body.effectClusterRetargetIntervalTicks,
            'effect body effectClusterRetargetIntervalTicks'
        );
        const routeFirstFieldIndex = requireUint32(
            body.effectRouteFirstFieldIndex,
            'effect body effectRouteFirstFieldIndex',
            { allowSentinel: false }
        );
        const routeFieldCount = requirePositiveUint32(
            body.effectRouteFieldCount,
            'effect body effectRouteFieldCount'
        );
        if (interval > config.MAX_RETARGET_INTERVAL_TICKS
            || routeFirstFieldIndex > config.MAX_ROUTE_FIRST_FIELD_INDEX
            || routeFieldCount > config.MAX_ROUTE_FIELD_COUNT
            || routeFirstFieldIndex + routeFieldCount
                > config.MAX_ROUTE_ATLAS_FIELD_COUNT) {
            throw new RangeError('effect emitter navigation config가 packed 범위를 벗어났습니다.');
        }
        navigationConfig = (
            interval
            | (routeFirstFieldIndex << config.ROUTE_FIRST_FIELD_SHIFT)
            | ((routeFieldCount - 1)
                << config.ROUTE_FIELD_COUNT_MINUS_ONE_SHIFT)
        ) >>> 0;
    }
    emitterView.setUint32(
        emitterOffset + emitter.NAVIGATION_CONFIG,
        navigationConfig,
        LITTLE_ENDIAN
    );
    emitterView.setUint32(
        emitterOffset + emitter.LAST_RETARGET_TICK,
        GPU_EFFECT_LAST_PULSE_TICK_INVALID,
        LITTLE_ENDIAN
    );
    return storage;
}

export function createGpuEffectPulseProgramStorage(capacity) {
    const safeCapacity = requirePositiveUint32(capacity, 'effect pulse capacity');
    const abi = GPU_EFFECT_RUNTIME_ABI;
    const buffer = new ArrayBuffer(
        abi.PROGRAM_HEADER.STRIDE
            + (abi.PULSE_PROGRAM_RECORD.STRIDE * safeCapacity)
    );
    const storage = { buffer, view: new DataView(buffer), capacity: safeCapacity };
    writeGpuEffectPulseProgramHeader(storage, 0);
    return storage;
}

export function writeGpuEffectPulseProgramHeader(storage, count, status = 0) {
    const abi = GPU_EFFECT_RUNTIME_ABI.PROGRAM_HEADER;
    const safeCount = requireUint32(count, 'effect pulse count', {
        allowSentinel: false
    });
    if (safeCount > storage.capacity) {
        throw new RangeError('effect pulse count가 capacity를 초과했습니다.');
    }
    storage.view.setUint32(
        abi.ABI_VERSION,
        GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        LITTLE_ENDIAN
    );
    storage.view.setUint32(abi.COUNT, safeCount, LITTLE_ENDIAN);
    storage.view.setUint32(abi.CAPACITY, storage.capacity, LITTLE_ENDIAN);
    storage.view.setUint32(
        abi.STATUS,
        requireUint32(status, 'effect pulse status'),
        LITTLE_ENDIAN
    );
    return storage;
}

export function writeGpuEffectPulseProgramRecord(storage, index, source) {
    const abi = GPU_EFFECT_RUNTIME_ABI;
    const record = abi.PULSE_PROGRAM_RECORD;
    const safeIndex = requireUint32(index, 'effect pulse index', {
        allowSentinel: false
    });
    if (safeIndex >= storage.capacity) {
        throw new RangeError('effect pulse index가 capacity를 벗어났습니다.');
    }
    const offset = abi.PROGRAM_HEADER.STRIDE + (safeIndex * record.STRIDE);
    new Uint8Array(storage.buffer, offset, record.STRIDE).fill(0);
    const view = storage.view;
    view.setUint32(offset + record.SOURCE_SLOT, requireUint32(
        source.sourceSlot,
        'effect pulse sourceSlot'
    ), LITTLE_ENDIAN);
    view.setUint32(offset + record.SOURCE_ENTITY_ID, requirePositiveUint32(
        source.sourceEntityId,
        'effect pulse sourceEntityId'
    ), LITTLE_ENDIAN);
    view.setUint32(offset + record.SOURCE_INCARNATION, requirePositiveUint32(
        source.sourceIncarnation,
        'effect pulse sourceIncarnation'
    ), LITTLE_ENDIAN);
    view.setUint32(offset + record.EFFECT_DEFINITION_CODE, requirePositiveUint32(
        source.effectDefinitionCode,
        'effect pulse effectDefinitionCode'
    ), LITTLE_ENDIAN);
    view.setUint32(offset + record.SOURCE_TICK, requirePositiveUint32(
        source.sourceTick,
        'effect pulse sourceTick'
    ), LITTLE_ENDIAN);
    view.setUint32(offset + record.PULSE_SEQUENCE, requireUint32(
        source.pulseSequence,
        'effect pulse pulseSequence',
        { allowSentinel: false }
    ), LITTLE_ENDIAN);
    const radius = requireFiniteFloat32(source.radiusTiles, 'effect pulse radiusTiles');
    if (!(radius > 0)) {
        throw new RangeError('effect pulse radiusTiles는 양수여야 합니다.');
    }
    view.setFloat32(offset + record.RADIUS_TILES, radius, LITTLE_ENDIAN);
    view.setUint32(offset + record.TARGET_LAYER_MASK, requireUint32(
        source.targetLayerMask,
        'effect pulse targetLayerMask',
        { allowSentinel: false }
    ), LITTLE_ENDIAN);
    view.setUint32(offset + record.TARGET_POLICY, requirePositiveUint32(
        source.targetPolicy,
        'effect pulse targetPolicy'
    ), LITTLE_ENDIAN);
    view.setUint32(offset + record.FINGERPRINT, requirePositiveUint32(
        source.fingerprint,
        'effect pulse fingerprint'
    ), LITTLE_ENDIAN);
    view.setUint32(
        offset + record.RESULT,
        GPU_EFFECT_PULSE_PROGRAM_RESULT.PENDING,
        LITTLE_ENDIAN
    );
    view.setUint32(offset + record.CANDIDATE_COUNT, 0, LITTLE_ENDIAN);
    view.setUint32(offset + record.APPLIED_COUNT, 0, LITTLE_ENDIAN);
    view.setUint32(offset + record.EMITTER_DEFINITION_CODE, requirePositiveUint32(
        source.emitterDefinitionCode,
        'effect pulse emitterDefinitionCode'
    ), LITTLE_ENDIAN);
    view.setUint32(offset + record.FLAGS, requireUint32(
        source.flags ?? 0,
        'effect pulse flags'
    ), LITTLE_ENDIAN);
    view.setUint32(
        offset + record.RETARGET_INTERVAL_TICKS,
        requirePositiveUint32(
            source.retargetIntervalTicks,
            'effect pulse retargetIntervalTicks'
        ),
        LITTLE_ENDIAN
    );
    return storage;
}

export function readGpuEffectPulseProgramHeader(storage) {
    const abi = GPU_EFFECT_RUNTIME_ABI.PROGRAM_HEADER;
    const view = storage.view ?? new DataView(storage.buffer ?? storage);
    return Object.freeze({
        abiVersion: view.getUint32(abi.ABI_VERSION, LITTLE_ENDIAN),
        count: view.getUint32(abi.COUNT, LITTLE_ENDIAN),
        capacity: view.getUint32(abi.CAPACITY, LITTLE_ENDIAN),
        status: view.getUint32(abi.STATUS, LITTLE_ENDIAN)
    });
}

export function readGpuEffectPulseProgramRecord(storage, index) {
    const abi = GPU_EFFECT_RUNTIME_ABI;
    const record = abi.PULSE_PROGRAM_RECORD;
    const view = storage.view ?? new DataView(storage.buffer ?? storage);
    const capacity = Math.floor(
        (view.byteLength - abi.PROGRAM_HEADER.STRIDE) / record.STRIDE
    );
    const safeIndex = requireUint32(index, 'effect pulse read index', {
        allowSentinel: false
    });
    if (safeIndex >= capacity) {
        throw new RangeError('effect pulse read index가 capacity를 벗어났습니다.');
    }
    const offset = abi.PROGRAM_HEADER.STRIDE + (safeIndex * record.STRIDE);
    return Object.freeze({
        sourceSlot: view.getUint32(offset + record.SOURCE_SLOT, LITTLE_ENDIAN),
        sourceEntityId: view.getUint32(
            offset + record.SOURCE_ENTITY_ID,
            LITTLE_ENDIAN
        ),
        sourceIncarnation: view.getUint32(
            offset + record.SOURCE_INCARNATION,
            LITTLE_ENDIAN
        ),
        effectDefinitionCode: view.getUint32(
            offset + record.EFFECT_DEFINITION_CODE,
            LITTLE_ENDIAN
        ),
        sourceTick: view.getUint32(offset + record.SOURCE_TICK, LITTLE_ENDIAN),
        pulseSequence: view.getUint32(
            offset + record.PULSE_SEQUENCE,
            LITTLE_ENDIAN
        ),
        radiusTiles: view.getFloat32(offset + record.RADIUS_TILES, LITTLE_ENDIAN),
        targetLayerMask: view.getUint32(
            offset + record.TARGET_LAYER_MASK,
            LITTLE_ENDIAN
        ),
        targetPolicy: view.getUint32(
            offset + record.TARGET_POLICY,
            LITTLE_ENDIAN
        ),
        fingerprint: view.getUint32(offset + record.FINGERPRINT, LITTLE_ENDIAN),
        result: view.getUint32(offset + record.RESULT, LITTLE_ENDIAN),
        candidateCount: view.getUint32(
            offset + record.CANDIDATE_COUNT,
            LITTLE_ENDIAN
        ),
        appliedCount: view.getUint32(
            offset + record.APPLIED_COUNT,
            LITTLE_ENDIAN
        ),
        emitterDefinitionCode: view.getUint32(
            offset + record.EMITTER_DEFINITION_CODE,
            LITTLE_ENDIAN
        ),
        flags: view.getUint32(offset + record.FLAGS, LITTLE_ENDIAN),
        retargetIntervalTicks: view.getUint32(
            offset + record.RETARGET_INTERVAL_TICKS,
            LITTLE_ENDIAN
        )
    });
}

export function createGpuEffectPoolStateStorage(instanceEpoch = 1) {
    const abi = GPU_EFFECT_RUNTIME_ABI.POOL_STATE;
    const buffer = new ArrayBuffer(abi.STRIDE);
    const view = new DataView(buffer);
    view.setUint32(abi.ABI_VERSION, GPU_EFFECT_RUNTIME_ABI_VERSION, LITTLE_ENDIAN);
    view.setUint32(abi.NEXT_INSTANCE_ID, 1, LITTLE_ENDIAN);
    view.setUint32(
        abi.INSTANCE_EPOCH,
        requirePositiveUint32(instanceEpoch, 'effect instanceEpoch'),
        LITTLE_ENDIAN
    );
    return buffer;
}

export function readGpuEffectPoolState(source) {
    const abi = GPU_EFFECT_RUNTIME_ABI.POOL_STATE;
    const view = source instanceof DataView ? source : new DataView(source);
    return Object.freeze({
        abiVersion: view.getUint32(abi.ABI_VERSION, LITTLE_ENDIAN),
        inputCount: view.getUint32(abi.INPUT_COUNT, LITTLE_ENDIAN),
        retainedCount: view.getUint32(abi.RETAINED_COUNT, LITTLE_ENDIAN),
        candidateCount: view.getUint32(abi.CANDIDATE_COUNT, LITTLE_ENDIAN),
        validPulseCount: view.getUint32(abi.VALID_PULSE_COUNT, LITTLE_ENDIAN),
        eventCount: view.getUint32(abi.EVENT_COUNT, LITTLE_ENDIAN),
        status: view.getUint32(abi.STATUS, LITTLE_ENDIAN),
        batchAccepted: view.getUint32(abi.BATCH_ACCEPTED, LITTLE_ENDIAN),
        nextInstanceId: view.getUint32(abi.NEXT_INSTANCE_ID, LITTLE_ENDIAN),
        instanceEpoch: view.getUint32(abi.INSTANCE_EPOCH, LITTLE_ENDIAN),
        materializedCount: view.getUint32(abi.MATERIALIZED_COUNT, LITTLE_ENDIAN),
        sourceTick: view.getUint32(abi.SOURCE_TICK, LITTLE_ENDIAN),
        candidateOverflow: view.getUint32(
            abi.CANDIDATE_OVERFLOW,
            LITTLE_ENDIAN
        ),
        eventOverflow: view.getUint32(abi.EVENT_OVERFLOW, LITTLE_ENDIAN),
        pulseResultCount: view.getUint32(
            abi.PULSE_RESULT_COUNT,
            LITTLE_ENDIAN
        )
    });
}

export function readGpuEffectEvent(source, index) {
    const abi = GPU_EFFECT_RUNTIME_ABI.EVENT;
    const view = source instanceof DataView ? source : new DataView(source);
    const safeIndex = requireUint32(index, 'effect event index', {
        allowSentinel: false
    });
    const offset = safeIndex * abi.STRIDE;
    if (offset + abi.STRIDE > view.byteLength) {
        throw new RangeError('effect event index가 buffer를 벗어났습니다.');
    }
    return Object.freeze({
        type: view.getUint32(offset + abi.TYPE, LITTLE_ENDIAN),
        flags: view.getUint32(offset + abi.FLAGS, LITTLE_ENDIAN),
        effectInstanceId: view.getUint32(
            offset + abi.EFFECT_INSTANCE_ID,
            LITTLE_ENDIAN
        ),
        instanceIncarnation: view.getUint32(
            offset + abi.INSTANCE_INCARNATION,
            LITTLE_ENDIAN
        ),
        sourceEntityId: view.getUint32(
            offset + abi.SOURCE_ENTITY_ID,
            LITTLE_ENDIAN
        ),
        sourceIncarnation: view.getUint32(
            offset + abi.SOURCE_INCARNATION,
            LITTLE_ENDIAN
        ),
        targetEntityId: view.getUint32(
            offset + abi.TARGET_ENTITY_ID,
            LITTLE_ENDIAN
        ),
        targetIncarnation: view.getUint32(
            offset + abi.TARGET_INCARNATION,
            LITTLE_ENDIAN
        ),
        effectDefinitionCode: view.getUint32(
            offset + abi.EFFECT_DEFINITION_CODE,
            LITTLE_ENDIAN
        ),
        valueFixedPoint: view.getInt32(
            offset + abi.VALUE_FIXED_POINT,
            LITTLE_ENDIAN
        ),
        position: Object.freeze({
            x: view.getFloat32(offset + abi.WORLD_POSITION_X, LITTLE_ENDIAN),
            y: view.getFloat32(offset + abi.WORLD_POSITION_Y, LITTLE_ENDIAN)
        })
    });
}
