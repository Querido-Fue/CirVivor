import {
    FORMATION_COORDINATE_SYSTEM_CODE,
    ENEMY_FORMATION_POLICY_CODE
} from '../../contract/enemy_formation_contract.js';

const LITTLE_ENDIAN = true;
const UINT32_MAX = 0xffffffff;
const INT32_MAX = 0x7fffffff;

/** Body ABI/behavior union과 독립적으로 versioning되는 Formation ABI입니다. */
export const GPU_FORMATION_RUNTIME_ABI_VERSION = 1;
export const GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION = 1;
export const GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION = 1;
export const GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION = 1;

export const GPU_FORMATION_IDENTITY_INVALID = UINT32_MAX;
export const GPU_FORMATION_PROGRAM_INDEX_INVALID = UINT32_MAX;

export const GPU_FORMATION_BODY_STATE_FLAG = Object.freeze({
    ACTIVE: 1 << 0,
    TRANSFORMED: 1 << 1,
    PRESENTATION_MERGE_PULSE: 1 << 2,
    GRID_OVERFLOW_OBSERVED: 1 << 3,
    PRESENTATION_RESERVATION: 1 << 4
});

/** Transient motion pass diagnostics; never identity or gameplay authority. */
export const GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG = Object.freeze({
    ROUTE_SPAN_REJECTED: 1 << 0,
    REVERSE_PROGRESS_REJECTED: 1 << 1,
    SDF_SEGMENT_REJECTED: 1 << 2,
    CANDIDATE_ACCEPTED: 1 << 3,
    NO_REVERSE_CLAMPED: 1 << 4,
    SDF_STEERING_REJECTED: 1 << 5,
    STEERING_APPLIED: 1 << 6,
    PURE_FLOW_FALLBACK: 1 << 7,
    GRID_OVERFLOW_FALLBACK: 1 << 8
});

export const GPU_FORMATION_PREPARE_PROGRAM_FLAG = Object.freeze({
    /** Endpoint-authenticated same-boundary lifecycle removal proof only. */
    ALLOW_SOURCE_INVALID: 1 << 0
});

export const GPU_FORMATION_PREPARE_RESULT = Object.freeze({
    PENDING: 0,
    NO_PAIR: 1,
    MUTUAL_PAIR: 2,
    SOURCE_INVALID: 3,
    GRID_OVERFLOW: 4,
    POLICY_REJECTED: 5
});

export const GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON = Object.freeze({
    NONE: 0,
    LIFECYCLE_REMOVED: 1,
    DIED_AFTER_STAGE: 2
});

export const GPU_FORMATION_TRANSFORM_RESULT = Object.freeze({
    PENDING: 0,
    COMMITTED: 1,
    BATCH_REJECTED: 2
});

export const GPU_FORMATION_RUNTIME_STATUS = Object.freeze({
    OK: 0,
    ABI_MISMATCH: 1 << 0,
    PROGRAM_CAPACITY_EXCEEDED: 1 << 1,
    RECORD_INVALID: 1 << 2,
    GRID_OVERFLOW: 1 << 3,
    SOURCE_CONFLICT: 1 << 4,
    DESTINATION_CONFLICT: 1 << 5,
    HP_OVERFLOW: 1 << 6,
    EFFECT_CONFLICT: 1 << 7,
    GENERATION_EXHAUSTED: 1 << 8
});

export const GPU_FORMATION_HEX_RING = Object.freeze({
    SLOT_COUNT: 6,
    OCCUPIED_MASK: 0x3f,
    /**
     * 이 순서에서 axial +60도 `(q,r)->(-r,q+r)`의 source->destination
     * slot mapping이 정확히 `[5,0,1,2,3,4]`가 됩니다.
     */
    AXIAL_SLOTS: Object.freeze([
        Object.freeze({ q: 1, r: 0 }),
        Object.freeze({ q: 1, r: -1 }),
        Object.freeze({ q: 0, r: -1 }),
        Object.freeze({ q: -1, r: 0 }),
        Object.freeze({ q: -1, r: 1 }),
        Object.freeze({ q: 0, r: 1 })
    ]),
    ROTATE_PLUS_60_SOURCE_TO_DESTINATION: Object.freeze([5, 0, 1, 2, 3, 4])
});

/** Formation state/program byte layout의 단일 host/WGSL 권위입니다. */
export const GPU_FORMATION_RUNTIME_ABI = Object.freeze({
    BODY_STATE: Object.freeze({
        STRIDE: 80,
        ENTITY_ID: 0,
        INCARNATION: 4,
        DEFINITION_CODE: 8,
        COORDINATE_SYSTEM_CODE: 12,
        POLICY_CODE: 16,
        MEMBER_COUNT: 20,
        OCCUPIED_SLOT_MASK: 24,
        ROTATION_STEP: 28,
        GENERATION: 32,
        FLAGS: 36,
        LINEAGE_HASH: 40,
        ROUTE_FIRST_FIELD_INDEX: 44,
        ROUTE_FIELD_COUNT: 48,
        LAST_MERGE_TICK: 52,
        PRESENTATION_FLAGS: 56,
        PRESENTATION_TICK: 60,
        PARTNER_ENTITY_ID: 64,
        PARTNER_INCARNATION: 68,
        RESERVED_0: 72,
        RESERVED_1: 76
    }),
    CANDIDATE_STATE: Object.freeze({
        STRIDE: 48,
        PROGRAM_INDEX: 0,
        CANDIDATE_PROGRAM_INDEX: 4,
        CANDIDATE_SLOT: 8,
        CANDIDATE_ENTITY_ID: 12,
        CANDIDATE_INCARNATION: 16,
        ROOT_PROGRAM_INDEX: 20,
        MOTION_FORWARD_STAGE_DELTA: 20,
        DESTINATION_MEMBER_COUNT: 24,
        MOTION_FORWARD_COST_DELTA_BITS: 24,
        DESTINATION_OCCUPIED_SLOT_MASK: 28,
        DESTINATION_ROTATION_STEP: 32,
        DISTANCE_SQUARED: 36,
        STATUS: 40,
        RESERVED_0: 44,
        MOTION_DIAGNOSTIC_FLAGS: 44
    }),
    PREPARE_HEADER: Object.freeze({
        STRIDE: 48,
        ABI_VERSION: 0,
        COUNT: 4,
        CAPACITY: 8,
        STATUS: 12,
        BATCH_ID_FINGERPRINT: 16,
        SOURCE_TICK: 20,
        RESULT_COUNT: 24,
        PAIR_COUNT: 28,
        GRID_SMALL_OVERFLOW: 32,
        GRID_BIG_OVERFLOW: 36,
        RESERVED_0: 40,
        RESERVED_1: 44
    }),
    PREPARE_RECORD: Object.freeze({
        STRIDE: 144,
        SOURCE_SLOT: 0,
        SOURCE_ENTITY_ID: 4,
        SOURCE_INCARNATION: 8,
        SOURCE_TICK: 12,
        PREPARE_SEQUENCE: 16,
        FINGERPRINT: 20,
        RESULT: 24,
        PAIR_PROGRAM_INDEX: 28,
        PAIR_ENTITY_ID: 32,
        PAIR_INCARNATION: 36,
        ROOT_PROGRAM_INDEX: 40,
        SOURCE_DEFINITION_CODE: 44,
        SOURCE_COORDINATE_SYSTEM_CODE: 48,
        SOURCE_POLICY_CODE: 52,
        SOURCE_MEMBER_COUNT: 56,
        SOURCE_OCCUPIED_SLOT_MASK: 60,
        SOURCE_ROTATION_STEP: 64,
        SOURCE_GENERATION: 68,
        SOURCE_LINEAGE_HASH: 72,
        SOURCE_CURRENT_HEALTH_CENTI: 76,
        SOURCE_MAX_HEALTH_CENTI: 80,
        PAIR_MEMBER_COUNT: 84,
        PAIR_OCCUPIED_SLOT_MASK: 88,
        PAIR_ROTATION_STEP: 92,
        PAIR_GENERATION: 96,
        PAIR_LINEAGE_HASH: 100,
        PAIR_CURRENT_HEALTH_CENTI: 104,
        PAIR_MAX_HEALTH_CENTI: 108,
        DESTINATION_MEMBER_COUNT: 112,
        DESTINATION_OCCUPIED_SLOT_MASK: 116,
        DESTINATION_ROTATION_STEP: 120,
        EXPECTED_MERGED_CURRENT_HEALTH_CENTI: 124,
        EXPECTED_MERGED_MAX_HEALTH_CENTI: 128,
        FLAGS: 132,
        MOTION_ROOT_PROGRAM_INDEX: 136,
        SOURCE_INVALID_REASON: 140
    }),
    TRANSFORM_HEADER: Object.freeze({
        STRIDE: 64,
        ABI_VERSION: 0,
        COUNT: 4,
        CAPACITY: 8,
        STATUS: 12,
        BATCH_ID_FINGERPRINT: 16,
        PREPARED_SOURCE_TICK: 20,
        TARGET_FIXED_TICK: 24,
        BATCH_ACCEPTED: 28,
        COMMITTED_COUNT: 32,
        EFFECT_REKEY_COUNT: 36,
        FAILURE_RECORD_INDEX: 40,
        SOURCE_COUNT: 44,
        PREPARED_EFFECT_REKEY_COUNT: 48,
        RESERVED_0: 52,
        RESERVED_1: 56,
        RESERVED_2: 60
    }),
    TRANSFORM_RECORD: Object.freeze({
        STRIDE: 192,
        SOURCE_A_SLOT: 0,
        SOURCE_A_ENTITY_ID: 4,
        SOURCE_A_INCARNATION: 8,
        SOURCE_B_SLOT: 12,
        SOURCE_B_ENTITY_ID: 16,
        SOURCE_B_INCARNATION: 20,
        DESTINATION_ENTITY_ID: 24,
        DESTINATION_INCARNATION: 28,
        PREPARED_SOURCE_TICK: 32,
        TARGET_FIXED_TICK: 36,
        PREPARE_BATCH_FINGERPRINT: 40,
        FINGERPRINT: 44,
        SOURCE_A_MEMBER_COUNT: 48,
        SOURCE_A_OCCUPIED_SLOT_MASK: 52,
        SOURCE_A_ROTATION_STEP: 56,
        SOURCE_A_GENERATION: 60,
        SOURCE_A_LINEAGE_HASH: 64,
        SOURCE_A_CURRENT_HEALTH_CENTI: 68,
        SOURCE_A_MAX_HEALTH_CENTI: 72,
        SOURCE_B_MEMBER_COUNT: 76,
        SOURCE_B_OCCUPIED_SLOT_MASK: 80,
        SOURCE_B_ROTATION_STEP: 84,
        SOURCE_B_GENERATION: 88,
        SOURCE_B_LINEAGE_HASH: 92,
        SOURCE_B_CURRENT_HEALTH_CENTI: 96,
        SOURCE_B_MAX_HEALTH_CENTI: 100,
        DESTINATION_DEFINITION_CODE: 104,
        DESTINATION_COORDINATE_SYSTEM_CODE: 108,
        DESTINATION_POLICY_CODE: 112,
        DESTINATION_MEMBER_COUNT: 116,
        DESTINATION_OCCUPIED_SLOT_MASK: 120,
        DESTINATION_ROTATION_STEP: 124,
        DESTINATION_GENERATION: 128,
        DESTINATION_FLAGS: 132,
        DESTINATION_LINEAGE_HASH: 136,
        EXPECTED_CURRENT_HEALTH_CENTI: 140,
        EXPECTED_MAX_HEALTH_CENTI: 144,
        DESTINATION_RADIUS: 148,
        DESTINATION_INVERSE_MASS: 152,
        DESTINATION_FLOW_SPEED: 156,
        DESTINATION_TOWER_CONTACT_DAMAGE: 160,
        RESULT: 164,
        EFFECT_REKEY_COUNT: 168,
        MOTION_SOURCE_INDEX: 172,
        PREPARED_EFFECT_REKEY_COUNT: 176,
        RESERVED_0: 180,
        RESERVED_1: 184,
        RESERVED_2: 188
    })
});

function requireUint32(value, label, { positive = false, allowSentinel = false } = {}) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number < (positive ? 1 : 0)
        || number > UINT32_MAX
        || (!allowSentinel && number === UINT32_MAX)) {
        throw new RangeError(`${label}은 유효한 uint32여야 합니다.`);
    }
    return number >>> 0;
}

function requirePositiveInt32(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number > INT32_MAX) {
        throw new RangeError(`${label}은 양의 int32여야 합니다.`);
    }
    return number;
}

function requireFiniteFloat32(value, label, { positive = false } = {}) {
    const number = Math.fround(Number(value));
    if (!Number.isFinite(number) || (positive && !(number > 0))) {
        throw new RangeError(`${label}은 ${positive ? '양의 ' : ''}유한 float32여야 합니다.`);
    }
    return number;
}

function popcount6(value) {
    let bits = value & GPU_FORMATION_HEX_RING.OCCUPIED_MASK;
    let count = 0;
    while (bits !== 0) {
        count += bits & 1;
        bits >>>= 1;
    }
    return count;
}

function requireMemberCount(value, label) {
    const count = requireUint32(value, label, { positive: true });
    if (count > GPU_FORMATION_HEX_RING.SLOT_COUNT) {
        throw new RangeError(`${label}은 1..6이어야 합니다.`);
    }
    return count;
}

function requireOccupiedMask(value, memberCount, label) {
    const mask = requireUint32(value, label);
    if ((mask & ~GPU_FORMATION_HEX_RING.OCCUPIED_MASK) !== 0
        || popcount6(mask) !== memberCount) {
        throw new RangeError(`${label}은 memberCount와 일치하는 6-slot mask여야 합니다.`);
    }
    return mask;
}

function requireRotationStep(value, label) {
    const step = requireUint32(value, label);
    if (step >= GPU_FORMATION_HEX_RING.SLOT_COUNT) {
        throw new RangeError(`${label}은 0..5여야 합니다.`);
    }
    return step;
}

function requireKnownCoordinateCode(value, label) {
    const code = requireUint32(value, label, { positive: true });
    if (code !== FORMATION_COORDINATE_SYSTEM_CODE.HEX_AXIAL) {
        throw new RangeError(`${label}은 HEX_AXIAL이어야 합니다.`);
    }
    return code;
}

function requireKnownPolicyCode(value, label) {
    const code = requireUint32(value, label, { positive: true });
    if (code !== ENEMY_FORMATION_POLICY_CODE.SEEK_FORMATION
        && code !== ENEMY_FORMATION_POLICY_CODE.KEEP_FORMATION) {
        throw new RangeError(`${label}은 실제 Formation runtime policy여야 합니다.`);
    }
    return code;
}

function requireHandle(source, label) {
    return Object.freeze({
        entityId: requireUint32(
            source?.entityId ?? source?.handle?.entityId,
            `${label}.entityId`,
            { positive: true }
        ),
        incarnation: requireUint32(
            source?.incarnation ?? source?.handle?.incarnation,
            `${label}.incarnation`,
            { positive: true }
        )
    });
}

function readStateSource(body) {
    return body?.formationState ?? body;
}

export function createGpuFormationBodyStateStorage(capacity) {
    const safeCapacity = requireUint32(capacity, 'formation body capacity', {
        positive: true
    });
    return new ArrayBuffer(GPU_FORMATION_RUNTIME_ABI.BODY_STATE.STRIDE * safeCapacity);
}

export function writeGpuFormationBodyStateSpawn(storage, index, body = {}) {
    if (!(storage instanceof ArrayBuffer)) {
        throw new TypeError('Formation body state storage는 ArrayBuffer여야 합니다.');
    }
    const abi = GPU_FORMATION_RUNTIME_ABI.BODY_STATE;
    const capacity = storage.byteLength / abi.STRIDE;
    const safeIndex = requireUint32(index, 'formation body index');
    if (!Number.isInteger(capacity) || safeIndex >= capacity) {
        throw new RangeError('formation body index가 capacity를 벗어났습니다.');
    }
    const offset = safeIndex * abi.STRIDE;
    new Uint8Array(storage, offset, abi.STRIDE).fill(0);
    const view = new DataView(storage);
    const source = readStateSource(body);
    const hasFormation = source?.definitionCode !== undefined
        || body?.formationDefinitionCode !== undefined;
    if (!hasFormation) {
        view.setUint32(offset + abi.ENTITY_ID, UINT32_MAX, LITTLE_ENDIAN);
        view.setUint32(offset + abi.INCARNATION, UINT32_MAX, LITTLE_ENDIAN);
        view.setUint32(offset + abi.PARTNER_ENTITY_ID, UINT32_MAX, LITTLE_ENDIAN);
        view.setUint32(offset + abi.PARTNER_INCARNATION, UINT32_MAX, LITTLE_ENDIAN);
        return storage;
    }
    const handle = requireHandle(body, 'formation body');
    const definitionCode = requireUint32(
        source.definitionCode ?? body.formationDefinitionCode,
        'formationState.definitionCode',
        { positive: true }
    );
    const coordinateSystemCode = requireKnownCoordinateCode(
        source.coordinateSystemCode ?? body.formationCoordinateSystemCode,
        'formationState.coordinateSystemCode'
    );
    const policyCode = requireKnownPolicyCode(
        source.policyCode ?? body.formationPolicyCode,
        'formationState.policyCode'
    );
    const memberCount = requireMemberCount(
        source.memberCount ?? body.formationMemberCount ?? 1,
        'formationState.memberCount'
    );
    const occupiedSlotMask = requireOccupiedMask(
        source.occupiedSlotMask ?? body.formationOccupiedSlotMask ?? 1,
        memberCount,
        'formationState.occupiedSlotMask'
    );
    const rotationStep = requireRotationStep(
        source.rotationStep ?? body.formationRotationStep ?? 0,
        'formationState.rotationStep'
    );
    const generation = requireUint32(
        source.generation ?? body.formationGeneration ?? 1,
        'formationState.generation',
        { positive: true }
    );
    const flags = requireUint32(
        source.flags ?? GPU_FORMATION_BODY_STATE_FLAG.ACTIVE,
        'formationState.flags'
    );
    if ((flags & ~GPU_FORMATION_BODY_STATE_FLAG.ACTIVE) !== 0
        || (flags & GPU_FORMATION_BODY_STATE_FLAG.ACTIVE) === 0) {
        throw new RangeError('spawn Formation flags에는 ACTIVE만 필요합니다.');
    }
    const lineageHash = requireUint32(
        source.lineageHash ?? body.formationLineageHash,
        'formationState.lineageHash',
        { positive: true }
    );
    const routeFirstFieldIndex = requireUint32(
        source.routeFirstFieldIndex
            ?? body.formationRouteFirstFieldIndex
            ?? body.routeFirstFieldIndex
            ?? body.effectRouteFirstFieldIndex,
        'formationState.routeFirstFieldIndex'
    );
    const routeFieldCount = requireUint32(
        source.routeFieldCount
            ?? body.formationRouteFieldCount
            ?? body.routeFieldCount
            ?? body.effectRouteFieldCount,
        'formationState.routeFieldCount',
        { positive: true }
    );
    view.setUint32(offset + abi.ENTITY_ID, handle.entityId, LITTLE_ENDIAN);
    view.setUint32(offset + abi.INCARNATION, handle.incarnation, LITTLE_ENDIAN);
    view.setUint32(offset + abi.DEFINITION_CODE, definitionCode, LITTLE_ENDIAN);
    view.setUint32(
        offset + abi.COORDINATE_SYSTEM_CODE,
        coordinateSystemCode,
        LITTLE_ENDIAN
    );
    view.setUint32(offset + abi.POLICY_CODE, policyCode, LITTLE_ENDIAN);
    view.setUint32(offset + abi.MEMBER_COUNT, memberCount, LITTLE_ENDIAN);
    view.setUint32(offset + abi.OCCUPIED_SLOT_MASK, occupiedSlotMask, LITTLE_ENDIAN);
    view.setUint32(offset + abi.ROTATION_STEP, rotationStep, LITTLE_ENDIAN);
    view.setUint32(offset + abi.GENERATION, generation, LITTLE_ENDIAN);
    view.setUint32(offset + abi.FLAGS, flags, LITTLE_ENDIAN);
    view.setUint32(offset + abi.LINEAGE_HASH, lineageHash, LITTLE_ENDIAN);
    view.setUint32(
        offset + abi.ROUTE_FIRST_FIELD_INDEX,
        routeFirstFieldIndex,
        LITTLE_ENDIAN
    );
    view.setUint32(offset + abi.ROUTE_FIELD_COUNT, routeFieldCount, LITTLE_ENDIAN);
    view.setUint32(offset + abi.PARTNER_ENTITY_ID, UINT32_MAX, LITTLE_ENDIAN);
    view.setUint32(offset + abi.PARTNER_INCARNATION, UINT32_MAX, LITTLE_ENDIAN);
    return storage;
}

export function readGpuFormationBodyState(storage, index) {
    const abi = GPU_FORMATION_RUNTIME_ABI.BODY_STATE;
    const view = storage instanceof DataView ? storage : new DataView(storage);
    const safeIndex = requireUint32(index, 'formation body read index');
    const offset = safeIndex * abi.STRIDE;
    if (offset + abi.STRIDE > view.byteLength) {
        throw new RangeError('formation body read index가 storage를 벗어났습니다.');
    }
    return Object.freeze({
        entityId: view.getUint32(offset + abi.ENTITY_ID, LITTLE_ENDIAN),
        incarnation: view.getUint32(offset + abi.INCARNATION, LITTLE_ENDIAN),
        definitionCode: view.getUint32(offset + abi.DEFINITION_CODE, LITTLE_ENDIAN),
        coordinateSystemCode: view.getUint32(
            offset + abi.COORDINATE_SYSTEM_CODE,
            LITTLE_ENDIAN
        ),
        policyCode: view.getUint32(offset + abi.POLICY_CODE, LITTLE_ENDIAN),
        memberCount: view.getUint32(offset + abi.MEMBER_COUNT, LITTLE_ENDIAN),
        occupiedSlotMask: view.getUint32(
            offset + abi.OCCUPIED_SLOT_MASK,
            LITTLE_ENDIAN
        ),
        rotationStep: view.getUint32(offset + abi.ROTATION_STEP, LITTLE_ENDIAN),
        generation: view.getUint32(offset + abi.GENERATION, LITTLE_ENDIAN),
        flags: view.getUint32(offset + abi.FLAGS, LITTLE_ENDIAN),
        lineageHash: view.getUint32(offset + abi.LINEAGE_HASH, LITTLE_ENDIAN),
        routeFirstFieldIndex: view.getUint32(
            offset + abi.ROUTE_FIRST_FIELD_INDEX,
            LITTLE_ENDIAN
        ),
        routeFieldCount: view.getUint32(
            offset + abi.ROUTE_FIELD_COUNT,
            LITTLE_ENDIAN
        ),
        lastMergeTick: view.getUint32(offset + abi.LAST_MERGE_TICK, LITTLE_ENDIAN),
        presentationFlags: view.getUint32(
            offset + abi.PRESENTATION_FLAGS,
            LITTLE_ENDIAN
        ),
        presentationTick: view.getUint32(
            offset + abi.PRESENTATION_TICK,
            LITTLE_ENDIAN
        )
    });
}

function createProgramStorage(header, record, capacity, label) {
    const safeCapacity = requireUint32(capacity, `${label} capacity`, {
        positive: true
    });
    const buffer = new ArrayBuffer(header.STRIDE + (record.STRIDE * safeCapacity));
    return { buffer, view: new DataView(buffer), capacity: safeCapacity };
}

export function createGpuFormationPrepareProgramStorage(capacity) {
    const abi = GPU_FORMATION_RUNTIME_ABI;
    const storage = createProgramStorage(
        abi.PREPARE_HEADER,
        abi.PREPARE_RECORD,
        capacity,
        'formation prepare'
    );
    writeGpuFormationPrepareProgramHeader(storage, {
        count: 0,
        batchIdFingerprint: 0,
        sourceTick: 0
    });
    return storage;
}

export function writeGpuFormationPrepareProgramHeader(storage, source = {}) {
    const abi = GPU_FORMATION_RUNTIME_ABI.PREPARE_HEADER;
    const count = requireUint32(source.count ?? 0, 'formation prepare count');
    if (count > storage.capacity) {
        throw new RangeError('formation prepare count가 capacity를 초과했습니다.');
    }
    storage.view.setUint32(
        abi.ABI_VERSION,
        GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
        LITTLE_ENDIAN
    );
    storage.view.setUint32(abi.COUNT, count, LITTLE_ENDIAN);
    storage.view.setUint32(abi.CAPACITY, storage.capacity, LITTLE_ENDIAN);
    storage.view.setUint32(
        abi.STATUS,
        requireUint32(source.status ?? 0, 'formation prepare status'),
        LITTLE_ENDIAN
    );
    storage.view.setUint32(
        abi.BATCH_ID_FINGERPRINT,
        requireUint32(
            source.batchIdFingerprint ?? 0,
            'formation prepare batchIdFingerprint'
        ),
        LITTLE_ENDIAN
    );
    storage.view.setUint32(
        abi.SOURCE_TICK,
        requireUint32(source.sourceTick ?? 0, 'formation prepare sourceTick'),
        LITTLE_ENDIAN
    );
    storage.view.setUint32(abi.RESULT_COUNT, 0, LITTLE_ENDIAN);
    storage.view.setUint32(abi.PAIR_COUNT, 0, LITTLE_ENDIAN);
    storage.view.setUint32(abi.GRID_SMALL_OVERFLOW, 0, LITTLE_ENDIAN);
    storage.view.setUint32(abi.GRID_BIG_OVERFLOW, 0, LITTLE_ENDIAN);
    return storage;
}

export function writeGpuFormationPrepareProgramRecord(storage, index, source) {
    const abi = GPU_FORMATION_RUNTIME_ABI;
    const record = abi.PREPARE_RECORD;
    const safeIndex = requireUint32(index, 'formation prepare index');
    if (safeIndex >= storage.capacity) {
        throw new RangeError('formation prepare index가 capacity를 벗어났습니다.');
    }
    const offset = abi.PREPARE_HEADER.STRIDE + (safeIndex * record.STRIDE);
    new Uint8Array(storage.buffer, offset, record.STRIDE).fill(0);
    storage.view.setUint32(
        offset + record.SOURCE_SLOT,
        requireUint32(source.sourceSlot, 'formation prepare sourceSlot'),
        LITTLE_ENDIAN
    );
    storage.view.setUint32(
        offset + record.SOURCE_ENTITY_ID,
        requireUint32(source.sourceEntityId, 'formation prepare sourceEntityId', {
            positive: true
        }),
        LITTLE_ENDIAN
    );
    storage.view.setUint32(
        offset + record.SOURCE_INCARNATION,
        requireUint32(
            source.sourceIncarnation,
            'formation prepare sourceIncarnation',
            { positive: true }
        ),
        LITTLE_ENDIAN
    );
    storage.view.setUint32(
        offset + record.SOURCE_TICK,
        requireUint32(source.sourceTick, 'formation prepare sourceTick', {
            positive: true
        }),
        LITTLE_ENDIAN
    );
    storage.view.setUint32(
        offset + record.PREPARE_SEQUENCE,
        requireUint32(source.prepareSequence, 'formation prepare sequence'),
        LITTLE_ENDIAN
    );
    storage.view.setUint32(
        offset + record.FINGERPRINT,
        requireUint32(source.fingerprint, 'formation prepare fingerprint', {
            positive: true
        }),
        LITTLE_ENDIAN
    );
    storage.view.setUint32(
        offset + record.RESULT,
        GPU_FORMATION_PREPARE_RESULT.PENDING,
        LITTLE_ENDIAN
    );
    const flags = requireUint32(source.flags ?? 0, 'formation prepare flags');
    if ((flags & ~GPU_FORMATION_PREPARE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID) !== 0) {
        throw new RangeError('formation prepare flags에 unknown bit가 있습니다.');
    }
    storage.view.setUint32(offset + record.FLAGS, flags, LITTLE_ENDIAN);
    for (const field of [
        record.PAIR_PROGRAM_INDEX,
        record.PAIR_ENTITY_ID,
        record.PAIR_INCARNATION,
        record.ROOT_PROGRAM_INDEX,
        record.MOTION_ROOT_PROGRAM_INDEX
    ]) {
        storage.view.setUint32(offset + field, UINT32_MAX, LITTLE_ENDIAN);
    }
    storage.view.setUint32(
        offset + record.SOURCE_INVALID_REASON,
        GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.NONE,
        LITTLE_ENDIAN
    );
    return storage;
}

export function readGpuFormationPrepareProgramHeader(storage) {
    const abi = GPU_FORMATION_RUNTIME_ABI.PREPARE_HEADER;
    const view = storage.view ?? new DataView(storage.buffer ?? storage);
    return Object.freeze({
        abiVersion: view.getUint32(abi.ABI_VERSION, LITTLE_ENDIAN),
        count: view.getUint32(abi.COUNT, LITTLE_ENDIAN),
        capacity: view.getUint32(abi.CAPACITY, LITTLE_ENDIAN),
        status: view.getUint32(abi.STATUS, LITTLE_ENDIAN),
        batchIdFingerprint: view.getUint32(
            abi.BATCH_ID_FINGERPRINT,
            LITTLE_ENDIAN
        ),
        sourceTick: view.getUint32(abi.SOURCE_TICK, LITTLE_ENDIAN),
        resultCount: view.getUint32(abi.RESULT_COUNT, LITTLE_ENDIAN),
        pairCount: view.getUint32(abi.PAIR_COUNT, LITTLE_ENDIAN),
        gridSmallOverflow: view.getUint32(
            abi.GRID_SMALL_OVERFLOW,
            LITTLE_ENDIAN
        ),
        gridBigOverflow: view.getUint32(abi.GRID_BIG_OVERFLOW, LITTLE_ENDIAN)
    });
}

export function readGpuFormationPrepareProgramRecord(storage, index) {
    const abi = GPU_FORMATION_RUNTIME_ABI;
    const record = abi.PREPARE_RECORD;
    const view = storage.view ?? new DataView(storage.buffer ?? storage);
    const capacity = Math.floor((view.byteLength - abi.PREPARE_HEADER.STRIDE)
        / record.STRIDE);
    const safeIndex = requireUint32(index, 'formation prepare read index');
    if (safeIndex >= capacity) {
        throw new RangeError('formation prepare read index가 capacity를 벗어났습니다.');
    }
    const offset = abi.PREPARE_HEADER.STRIDE + (safeIndex * record.STRIDE);
    const u32 = (field) => view.getUint32(offset + field, LITTLE_ENDIAN);
    const i32 = (field) => view.getInt32(offset + field, LITTLE_ENDIAN);
    return Object.freeze({
        sourceSlot: u32(record.SOURCE_SLOT),
        sourceEntityId: u32(record.SOURCE_ENTITY_ID),
        sourceIncarnation: u32(record.SOURCE_INCARNATION),
        sourceTick: u32(record.SOURCE_TICK),
        prepareSequence: u32(record.PREPARE_SEQUENCE),
        fingerprint: u32(record.FINGERPRINT),
        result: u32(record.RESULT),
        pairProgramIndex: u32(record.PAIR_PROGRAM_INDEX),
        pairEntityId: u32(record.PAIR_ENTITY_ID),
        pairIncarnation: u32(record.PAIR_INCARNATION),
        rootProgramIndex: u32(record.ROOT_PROGRAM_INDEX),
        definitionCode: u32(record.SOURCE_DEFINITION_CODE),
        coordinateSystemCode: u32(record.SOURCE_COORDINATE_SYSTEM_CODE),
        policyCode: u32(record.SOURCE_POLICY_CODE),
        memberCount: u32(record.SOURCE_MEMBER_COUNT),
        occupiedSlotMask: u32(record.SOURCE_OCCUPIED_SLOT_MASK),
        rotationStep: u32(record.SOURCE_ROTATION_STEP),
        generation: u32(record.SOURCE_GENERATION),
        lineageHash: u32(record.SOURCE_LINEAGE_HASH),
        currentHealthCenti: i32(record.SOURCE_CURRENT_HEALTH_CENTI),
        maxHealthCenti: i32(record.SOURCE_MAX_HEALTH_CENTI),
        pairMemberCount: u32(record.PAIR_MEMBER_COUNT),
        pairOccupiedSlotMask: u32(record.PAIR_OCCUPIED_SLOT_MASK),
        pairRotationStep: u32(record.PAIR_ROTATION_STEP),
        pairGeneration: u32(record.PAIR_GENERATION),
        pairLineageHash: u32(record.PAIR_LINEAGE_HASH),
        pairCurrentHealthCenti: i32(record.PAIR_CURRENT_HEALTH_CENTI),
        pairMaxHealthCenti: i32(record.PAIR_MAX_HEALTH_CENTI),
        destinationMemberCount: u32(record.DESTINATION_MEMBER_COUNT),
        destinationOccupiedSlotMask: u32(
            record.DESTINATION_OCCUPIED_SLOT_MASK
        ),
        destinationRotationStep: u32(record.DESTINATION_ROTATION_STEP),
        expectedMergedCurrentHealthCenti: i32(
            record.EXPECTED_MERGED_CURRENT_HEALTH_CENTI
        ),
        expectedMergedMaxHealthCenti: i32(
            record.EXPECTED_MERGED_MAX_HEALTH_CENTI
        ),
        flags: u32(record.FLAGS),
        motionRootProgramIndex: u32(record.MOTION_ROOT_PROGRAM_INDEX),
        sourceInvalidReason: u32(record.SOURCE_INVALID_REASON)
    });
}

export function createGpuFormationTransformProgramStorage(capacity) {
    const abi = GPU_FORMATION_RUNTIME_ABI;
    const storage = createProgramStorage(
        abi.TRANSFORM_HEADER,
        abi.TRANSFORM_RECORD,
        capacity,
        'formation transform'
    );
    writeGpuFormationTransformProgramHeader(storage, {
        count: 0,
        batchIdFingerprint: 0,
        preparedSourceTick: 0,
        targetFixedTick: 0
    });
    return storage;
}

export function writeGpuFormationTransformProgramHeader(storage, source = {}) {
    const abi = GPU_FORMATION_RUNTIME_ABI.TRANSFORM_HEADER;
    const count = requireUint32(source.count ?? 0, 'formation transform count');
    if (count > storage.capacity) {
        throw new RangeError('formation transform count가 capacity를 초과했습니다.');
    }
    storage.view.setUint32(
        abi.ABI_VERSION,
        GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
        LITTLE_ENDIAN
    );
    storage.view.setUint32(abi.COUNT, count, LITTLE_ENDIAN);
    storage.view.setUint32(abi.CAPACITY, storage.capacity, LITTLE_ENDIAN);
    storage.view.setUint32(abi.STATUS, 0, LITTLE_ENDIAN);
    storage.view.setUint32(
        abi.BATCH_ID_FINGERPRINT,
        requireUint32(
            source.batchIdFingerprint ?? 0,
            'formation transform batchIdFingerprint'
        ),
        LITTLE_ENDIAN
    );
    storage.view.setUint32(
        abi.PREPARED_SOURCE_TICK,
        requireUint32(
            source.preparedSourceTick ?? 0,
            'formation transform preparedSourceTick'
        ),
        LITTLE_ENDIAN
    );
    storage.view.setUint32(
        abi.TARGET_FIXED_TICK,
        requireUint32(
            source.targetFixedTick ?? 0,
            'formation transform targetFixedTick'
        ),
        LITTLE_ENDIAN
    );
    storage.view.setUint32(abi.BATCH_ACCEPTED, 0, LITTLE_ENDIAN);
    storage.view.setUint32(abi.COMMITTED_COUNT, 0, LITTLE_ENDIAN);
    storage.view.setUint32(abi.EFFECT_REKEY_COUNT, 0, LITTLE_ENDIAN);
    storage.view.setUint32(abi.FAILURE_RECORD_INDEX, UINT32_MAX, LITTLE_ENDIAN);
    storage.view.setUint32(abi.SOURCE_COUNT, count * 2, LITTLE_ENDIAN);
    storage.view.setUint32(abi.PREPARED_EFFECT_REKEY_COUNT, 0, LITTLE_ENDIAN);
    storage.view.setUint32(abi.RESERVED_0, 0, LITTLE_ENDIAN);
    storage.view.setUint32(abi.RESERVED_1, 0, LITTLE_ENDIAN);
    storage.view.setUint32(abi.RESERVED_2, 0, LITTLE_ENDIAN);
    return storage;
}

function writeTransformSource(view, offset, record, prefix, source) {
    const label = `formation transform source${prefix}`;
    view.setUint32(
        offset + record[`SOURCE_${prefix}_SLOT`],
        requireUint32(source.slot, `${label}.slot`),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + record[`SOURCE_${prefix}_ENTITY_ID`],
        requireUint32(source.entityId, `${label}.entityId`, { positive: true }),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + record[`SOURCE_${prefix}_INCARNATION`],
        requireUint32(source.incarnation, `${label}.incarnation`, {
            positive: true
        }),
        LITTLE_ENDIAN
    );
    const memberCount = requireMemberCount(source.memberCount, `${label}.memberCount`);
    view.setUint32(
        offset + record[`SOURCE_${prefix}_MEMBER_COUNT`],
        memberCount,
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + record[`SOURCE_${prefix}_OCCUPIED_SLOT_MASK`],
        requireOccupiedMask(
            source.occupiedSlotMask,
            memberCount,
            `${label}.occupiedSlotMask`
        ),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + record[`SOURCE_${prefix}_ROTATION_STEP`],
        requireRotationStep(source.rotationStep, `${label}.rotationStep`),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + record[`SOURCE_${prefix}_GENERATION`],
        requireUint32(source.generation, `${label}.generation`, { positive: true }),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + record[`SOURCE_${prefix}_LINEAGE_HASH`],
        requireUint32(source.lineageHash, `${label}.lineageHash`, { positive: true }),
        LITTLE_ENDIAN
    );
    view.setInt32(
        offset + record[`SOURCE_${prefix}_CURRENT_HEALTH_CENTI`],
        requirePositiveInt32(source.currentHealthCenti, `${label}.currentHealthCenti`),
        LITTLE_ENDIAN
    );
    view.setInt32(
        offset + record[`SOURCE_${prefix}_MAX_HEALTH_CENTI`],
        requirePositiveInt32(source.maxHealthCenti, `${label}.maxHealthCenti`),
        LITTLE_ENDIAN
    );
}

export function writeGpuFormationTransformProgramRecord(storage, index, source) {
    const abi = GPU_FORMATION_RUNTIME_ABI;
    const record = abi.TRANSFORM_RECORD;
    const safeIndex = requireUint32(index, 'formation transform index');
    if (safeIndex >= storage.capacity) {
        throw new RangeError('formation transform index가 capacity를 벗어났습니다.');
    }
    const offset = abi.TRANSFORM_HEADER.STRIDE + (safeIndex * record.STRIDE);
    new Uint8Array(storage.buffer, offset, record.STRIDE).fill(0);
    const sourceA = source.sourceA;
    const sourceB = source.sourceB;
    writeTransformSource(storage.view, offset, record, 'A', sourceA);
    writeTransformSource(storage.view, offset, record, 'B', sourceB);
    const destination = requireHandle(source.destination, 'formation destination');
    storage.view.setUint32(
        offset + record.DESTINATION_ENTITY_ID,
        destination.entityId,
        LITTLE_ENDIAN
    );
    storage.view.setUint32(
        offset + record.DESTINATION_INCARNATION,
        destination.incarnation,
        LITTLE_ENDIAN
    );
    for (const [field, value, label] of [
        [record.PREPARED_SOURCE_TICK, source.preparedSourceTick, 'preparedSourceTick'],
        [record.TARGET_FIXED_TICK, source.targetFixedTick, 'targetFixedTick'],
        [
            record.PREPARE_BATCH_FINGERPRINT,
            source.prepareBatchFingerprint,
            'prepareBatchFingerprint'
        ],
        [record.FINGERPRINT, source.fingerprint, 'fingerprint']
    ]) {
        storage.view.setUint32(
            offset + field,
            requireUint32(value, `formation transform ${label}`, { positive: true }),
            LITTLE_ENDIAN
        );
    }
    const state = source.destinationState ?? source.destination;
    const destinationMemberCount = requireMemberCount(
        state.memberCount,
        'formation destination memberCount'
    );
    const destinationGeneration = requireUint32(
        state.generation,
        'formation destination generation',
        { positive: true }
    );
    const expectedGeneration = Math.max(sourceA.generation, sourceB.generation) + 1;
    if (expectedGeneration >= UINT32_MAX
        || destinationGeneration !== expectedGeneration) {
        throw new RangeError('formation destination generation이 source max+1이 아닙니다.');
    }
    const destinationFlags = requireUint32(
        state.flags ?? GPU_FORMATION_BODY_STATE_FLAG.ACTIVE,
        'formation destination flags'
    );
    if ((destinationFlags & ~GPU_FORMATION_BODY_STATE_FLAG.ACTIVE) !== 0
        || (destinationFlags & GPU_FORMATION_BODY_STATE_FLAG.ACTIVE) === 0) {
        throw new RangeError('formation destination flags에는 ACTIVE만 필요합니다.');
    }
    for (const [field, value] of [
        [record.DESTINATION_DEFINITION_CODE, requireUint32(
            state.definitionCode,
            'formation destination definitionCode',
            { positive: true }
        )],
        [record.DESTINATION_COORDINATE_SYSTEM_CODE, requireKnownCoordinateCode(
            state.coordinateSystemCode,
            'formation destination coordinateSystemCode'
        )],
        [record.DESTINATION_POLICY_CODE, requireKnownPolicyCode(
            state.policyCode,
            'formation destination policyCode'
        )],
        [record.DESTINATION_MEMBER_COUNT, destinationMemberCount],
        [record.DESTINATION_OCCUPIED_SLOT_MASK, requireOccupiedMask(
            state.occupiedSlotMask,
            destinationMemberCount,
            'formation destination occupiedSlotMask'
        )],
        [record.DESTINATION_ROTATION_STEP, requireRotationStep(
            state.rotationStep,
            'formation destination rotationStep'
        )],
        [record.DESTINATION_GENERATION, destinationGeneration],
        [record.DESTINATION_FLAGS, destinationFlags],
        [record.DESTINATION_LINEAGE_HASH, requireUint32(
            state.lineageHash,
            'formation destination lineageHash',
            { positive: true }
        )]
    ]) {
        storage.view.setUint32(offset + field, value, LITTLE_ENDIAN);
    }
    storage.view.setInt32(
        offset + record.EXPECTED_CURRENT_HEALTH_CENTI,
        requirePositiveInt32(
            source.expectedCurrentHealthCenti,
            'formation destination expectedCurrentHealthCenti'
        ),
        LITTLE_ENDIAN
    );
    storage.view.setInt32(
        offset + record.EXPECTED_MAX_HEALTH_CENTI,
        requirePositiveInt32(
            source.expectedMaxHealthCenti,
            'formation destination expectedMaxHealthCenti'
        ),
        LITTLE_ENDIAN
    );
    storage.view.setFloat32(
        offset + record.DESTINATION_RADIUS,
        requireFiniteFloat32(source.destinationRadius, 'destinationRadius', {
            positive: true
        }),
        LITTLE_ENDIAN
    );
    storage.view.setFloat32(
        offset + record.DESTINATION_INVERSE_MASS,
        requireFiniteFloat32(
            source.destinationInverseMass,
            'destinationInverseMass',
            { positive: true }
        ),
        LITTLE_ENDIAN
    );
    storage.view.setFloat32(
        offset + record.DESTINATION_FLOW_SPEED,
        requireFiniteFloat32(
            source.destinationFlowSpeed,
            'destinationFlowSpeed',
            { positive: true }
        ),
        LITTLE_ENDIAN
    );
    storage.view.setFloat32(
        offset + record.DESTINATION_TOWER_CONTACT_DAMAGE,
        requireFiniteFloat32(
            source.destinationTowerContactDamage,
            'destinationTowerContactDamage',
            { positive: true }
        ),
        LITTLE_ENDIAN
    );
    storage.view.setUint32(
        offset + record.RESULT,
        GPU_FORMATION_TRANSFORM_RESULT.PENDING,
        LITTLE_ENDIAN
    );
    const motionSourceIndex = requireUint32(
        source.motionSourceIndex,
        'formation transform motionSourceIndex'
    );
    if (motionSourceIndex > 1) {
        throw new RangeError('formation transform motionSourceIndex는 0 또는 1이어야 합니다.');
    }
    storage.view.setUint32(
        offset + record.MOTION_SOURCE_INDEX,
        motionSourceIndex,
        LITTLE_ENDIAN
    );
    storage.view.setUint32(
        offset + record.PREPARED_EFFECT_REKEY_COUNT,
        0,
        LITTLE_ENDIAN
    );
    return storage;
}

export function readGpuFormationTransformProgramHeader(storage) {
    const abi = GPU_FORMATION_RUNTIME_ABI.TRANSFORM_HEADER;
    const view = storage.view ?? new DataView(storage.buffer ?? storage);
    return Object.freeze({
        abiVersion: view.getUint32(abi.ABI_VERSION, LITTLE_ENDIAN),
        count: view.getUint32(abi.COUNT, LITTLE_ENDIAN),
        capacity: view.getUint32(abi.CAPACITY, LITTLE_ENDIAN),
        status: view.getUint32(abi.STATUS, LITTLE_ENDIAN),
        batchIdFingerprint: view.getUint32(
            abi.BATCH_ID_FINGERPRINT,
            LITTLE_ENDIAN
        ),
        preparedSourceTick: view.getUint32(
            abi.PREPARED_SOURCE_TICK,
            LITTLE_ENDIAN
        ),
        targetFixedTick: view.getUint32(abi.TARGET_FIXED_TICK, LITTLE_ENDIAN),
        batchAccepted: view.getUint32(abi.BATCH_ACCEPTED, LITTLE_ENDIAN),
        committedCount: view.getUint32(abi.COMMITTED_COUNT, LITTLE_ENDIAN),
        effectRekeyCount: view.getUint32(abi.EFFECT_REKEY_COUNT, LITTLE_ENDIAN),
        preparedEffectRekeyCount: view.getUint32(
            abi.PREPARED_EFFECT_REKEY_COUNT,
            LITTLE_ENDIAN
        ),
        failureRecordIndex: view.getUint32(
            abi.FAILURE_RECORD_INDEX,
            LITTLE_ENDIAN
        ),
        sourceCount: view.getUint32(abi.SOURCE_COUNT, LITTLE_ENDIAN)
    });
}

export function readGpuFormationTransformProgramRecord(storage, index) {
    const abi = GPU_FORMATION_RUNTIME_ABI;
    const record = abi.TRANSFORM_RECORD;
    const view = storage.view ?? new DataView(storage.buffer ?? storage);
    const capacity = Math.floor((view.byteLength - abi.TRANSFORM_HEADER.STRIDE)
        / record.STRIDE);
    const safeIndex = requireUint32(index, 'formation transform read index');
    if (safeIndex >= capacity) {
        throw new RangeError('formation transform read index가 capacity를 벗어났습니다.');
    }
    const offset = abi.TRANSFORM_HEADER.STRIDE + (safeIndex * record.STRIDE);
    const u32 = (field) => view.getUint32(offset + field, LITTLE_ENDIAN);
    const i32 = (field) => view.getInt32(offset + field, LITTLE_ENDIAN);
    const f32 = (field) => view.getFloat32(offset + field, LITTLE_ENDIAN);
    const readSource = (prefix) => Object.freeze({
        slot: u32(record[`SOURCE_${prefix}_SLOT`]),
        entityId: u32(record[`SOURCE_${prefix}_ENTITY_ID`]),
        incarnation: u32(record[`SOURCE_${prefix}_INCARNATION`]),
        memberCount: u32(record[`SOURCE_${prefix}_MEMBER_COUNT`]),
        occupiedSlotMask: u32(record[`SOURCE_${prefix}_OCCUPIED_SLOT_MASK`]),
        rotationStep: u32(record[`SOURCE_${prefix}_ROTATION_STEP`]),
        generation: u32(record[`SOURCE_${prefix}_GENERATION`]),
        lineageHash: u32(record[`SOURCE_${prefix}_LINEAGE_HASH`]),
        currentHealthCenti: i32(record[`SOURCE_${prefix}_CURRENT_HEALTH_CENTI`]),
        maxHealthCenti: i32(record[`SOURCE_${prefix}_MAX_HEALTH_CENTI`])
    });
    return Object.freeze({
        sourceA: readSource('A'),
        sourceB: readSource('B'),
        destination: Object.freeze({
            entityId: u32(record.DESTINATION_ENTITY_ID),
            incarnation: u32(record.DESTINATION_INCARNATION),
            definitionCode: u32(record.DESTINATION_DEFINITION_CODE),
            coordinateSystemCode: u32(record.DESTINATION_COORDINATE_SYSTEM_CODE),
            policyCode: u32(record.DESTINATION_POLICY_CODE),
            memberCount: u32(record.DESTINATION_MEMBER_COUNT),
            occupiedSlotMask: u32(record.DESTINATION_OCCUPIED_SLOT_MASK),
            rotationStep: u32(record.DESTINATION_ROTATION_STEP),
            generation: u32(record.DESTINATION_GENERATION),
            flags: u32(record.DESTINATION_FLAGS),
            lineageHash: u32(record.DESTINATION_LINEAGE_HASH)
        }),
        preparedSourceTick: u32(record.PREPARED_SOURCE_TICK),
        targetFixedTick: u32(record.TARGET_FIXED_TICK),
        prepareBatchFingerprint: u32(record.PREPARE_BATCH_FINGERPRINT),
        fingerprint: u32(record.FINGERPRINT),
        expectedCurrentHealthCenti: i32(
            record.EXPECTED_CURRENT_HEALTH_CENTI
        ),
        expectedMaxHealthCenti: i32(record.EXPECTED_MAX_HEALTH_CENTI),
        destinationRadius: f32(record.DESTINATION_RADIUS),
        destinationInverseMass: f32(record.DESTINATION_INVERSE_MASS),
        destinationFlowSpeed: f32(record.DESTINATION_FLOW_SPEED),
        destinationTowerContactDamage: f32(
            record.DESTINATION_TOWER_CONTACT_DAMAGE
        ),
        result: u32(record.RESULT),
        effectRekeyCount: u32(record.EFFECT_REKEY_COUNT),
        preparedEffectRekeyCount: u32(
            record.PREPARED_EFFECT_REKEY_COUNT
        ),
        motionSourceIndex: u32(record.MOTION_SOURCE_INDEX)
    });
}

/** 양의 centi HP 두 값을 overflow 없이 `sum + floor(sum/10)`으로 합칩니다. */
export function mergeGpuFormationHealthCenti(left, right, label = 'formation HP') {
    const leftValue = requirePositiveInt32(left, `${label}.left`);
    const rightValue = requirePositiveInt32(right, `${label}.right`);
    const sum = leftValue + rightValue;
    const merged = sum + Math.floor(sum / 10);
    if (!Number.isSafeInteger(merged) || merged > INT32_MAX) {
        throw new RangeError(`${label} merge가 int32를 초과했습니다.`);
    }
    return merged;
}

/**
 * Exact live handle에서 correlation-only nonzero lineage hash를 만듭니다.
 * 이 hash는 host가 보존하는 exact consumed lineage identity를 대체하지 않습니다.
 */
export function hashGpuFormationHandle(source, label = 'formation handle') {
    const handle = requireHandle(source, label);
    let hash = 0x811c9dc5;
    hash = Math.imul((hash ^ handle.entityId) >>> 0, 0x01000193) >>> 0;
    hash = Math.imul((hash ^ handle.incarnation) >>> 0, 0x01000193) >>> 0;
    if (hash === 0 || hash === UINT32_MAX) {
        hash = (hash ^ 0x9e3779b9) >>> 0;
    }
    return hash === 0 || hash === UINT32_MAX ? 1 : hash;
}
