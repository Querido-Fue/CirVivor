import {
    GPU_CIRCLE_BODY_ABI_VERSION
} from './gpu_circle_body_abi.js';
import {
    GPU_TOWER_GROUP_ABI_VERSION,
    GPU_TOWER_GROUP_MEMBER_FLAG
} from './gpu_tower_group_abi.js';

const LITTLE_ENDIAN = true;
const UINT32_MAX = 0xffffffff;
const INT32_MAX = 0x7fffffff;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export const GPU_TOWER_MERGE_ABI_VERSION = 1;
export const GPU_TOWER_MERGE_MAX_SOURCE_COUNT = 256;

export const GPU_TOWER_MERGE_RECORD_ROLE = Object.freeze({
    SURVIVOR: 1,
    CONSUMED: 2
});

export const GPU_TOWER_MERGE_STATUS = Object.freeze({
    EMPTY: 0,
    SEALED: 1,
    COMMITTED: 2,
    REJECTED_SOURCE_CHANGED: 3,
    PROTOCOL_FAILURE: 4
});

export const GPU_TOWER_MERGE_ERROR_FLAG = Object.freeze({
    BODY_ABI_MISMATCH: 1 << 0,
    GROUP_ABI_MISMATCH: 1 << 1,
    MERGE_ABI_MISMATCH: 1 << 2,
    PROTOCOL_MISMATCH: 1 << 3,
    PROGRAM_FINGERPRINT_MISMATCH: 1 << 4,
    ROSTER_MISMATCH: 1 << 5,
    RECORD_FINGERPRINT_MISMATCH: 1 << 6,
    SOURCE_CHANGED: 1 << 7,
    SURVIVOR_INVALID: 1 << 8,
    APPLY_PARTIAL: 1 << 9,
    RESULT_MALFORMED: 1 << 10
});

export const GPU_TOWER_MERGE_HARD_FAILURE_MASK = (
    GPU_TOWER_MERGE_ERROR_FLAG.BODY_ABI_MISMATCH
    | GPU_TOWER_MERGE_ERROR_FLAG.GROUP_ABI_MISMATCH
    | GPU_TOWER_MERGE_ERROR_FLAG.MERGE_ABI_MISMATCH
    | GPU_TOWER_MERGE_ERROR_FLAG.PROTOCOL_MISMATCH
    | GPU_TOWER_MERGE_ERROR_FLAG.PROGRAM_FINGERPRINT_MISMATCH
    | GPU_TOWER_MERGE_ERROR_FLAG.ROSTER_MISMATCH
    | GPU_TOWER_MERGE_ERROR_FLAG.RECORD_FINGERPRINT_MISMATCH
    | GPU_TOWER_MERGE_ERROR_FLAG.SURVIVOR_INVALID
    | GPU_TOWER_MERGE_ERROR_FLAG.APPLY_PARTIAL
    | GPU_TOWER_MERGE_ERROR_FLAG.RESULT_MALFORMED
);

export const GPU_TOWER_MERGE_STORAGE_PROFILE = Object.freeze({
    clearStorageBuffersPerStage: 9,
    validateStorageBuffersPerStage: 9,
    sealStorageBuffersPerStage: 9,
    applyStorageBuffersPerStage: 9,
    finalizeStorageBuffersPerStage: 9,
    maximumStorageBuffersPerStage: 9
});

export const GPU_TOWER_MERGE_ABI = Object.freeze({
    PROGRAM: Object.freeze({
        STRIDE: 128,
        ABI_VERSION: 0,
        BODY_ABI_VERSION: 4,
        GROUP_ABI_VERSION: 8,
        STATUS: 12,
        ERROR_FLAGS: 16,
        SESSION_GENERATION: 20,
        DEVICE_GENERATION: 24,
        AUTHORITATIVE_EPOCH: 28,
        SOURCE_TICK: 32,
        SOURCE_COUNT: 36,
        SURVIVOR_RANK: 40,
        BODY_CAPACITY: 44,
        SOURCE_GROUP_REVISION: 48,
        TARGET_GROUP_REVISION: 52,
        SOURCE_ROSTER_FINGERPRINT: 56,
        TARGET_ROSTER_FINGERPRINT: 60,
        PLAN_FINGERPRINT_0: 64,
        PLAN_FINGERPRINT_1: 68,
        TRANSACTION_FINGERPRINT: 72,
        SOURCE_IDENTITY_FINGERPRINT: 76,
        TARGET_CURRENT_HP_FIXED_POINT: 80,
        TARGET_MAX_HP_FIXED_POINT: 84,
        TARGET_POWER_FIXED_POINT: 88,
        TARGET_SHARE_UNITS: 92,
        PROGRAM_FINGERPRINT: 96,
        VALIDATED_COUNT: 100,
        APPLIED_COUNT: 104,
        SURVIVOR_ENTITY_ID: 108,
        SURVIVOR_INCARNATION: 112,
        LIVE_CURRENT_HP_SUM: 116,
        RESERVED_1: 120,
        RESERVED_2: 124
    }),
    RECORD: Object.freeze({
        STRIDE: 80,
        SLOT: 0,
        ENTITY_ID: 4,
        INCARNATION: 8,
        LOGICAL_ORDINAL: 12,
        EXPECTED_CURRENT_HP_FIXED_POINT: 16,
        SOURCE_SHARE_UNITS: 20,
        SOURCE_MAX_HP_FIXED_POINT: 24,
        SOURCE_POWER_FIXED_POINT: 28,
        SOURCE_GROUP_REVISION: 32,
        SOURCE_FLAGS: 36,
        SOURCE_ROSTER_RANK: 40,
        ROLE: 44,
        TARGET_CURRENT_HP_FIXED_POINT: 48,
        TARGET_SHARE_UNITS: 52,
        TARGET_MAX_HP_FIXED_POINT: 56,
        TARGET_POWER_FIXED_POINT: 60,
        RECORD_FINGERPRINT: 64,
        RESERVED_0: 68,
        RESERVED_1: 72,
        RESERVED_2: 76
    }),
    RESULT: Object.freeze({
        STRIDE: 112,
        ABI_VERSION: 0,
        BODY_ABI_VERSION: 4,
        GROUP_ABI_VERSION: 8,
        STATUS: 12,
        ERROR_FLAGS: 16,
        SESSION_GENERATION: 20,
        DEVICE_GENERATION: 24,
        AUTHORITATIVE_EPOCH: 28,
        SOURCE_TICK: 32,
        SOURCE_COUNT: 36,
        SURVIVOR_RANK: 40,
        VALIDATED_COUNT: 44,
        APPLIED_COUNT: 48,
        SOURCE_GROUP_REVISION: 52,
        TARGET_GROUP_REVISION: 56,
        SOURCE_ROSTER_FINGERPRINT: 60,
        TARGET_ROSTER_FINGERPRINT: 64,
        PLAN_FINGERPRINT_0: 68,
        PLAN_FINGERPRINT_1: 72,
        TRANSACTION_FINGERPRINT: 76,
        SOURCE_IDENTITY_FINGERPRINT: 80,
        SURVIVOR_ENTITY_ID: 84,
        SURVIVOR_INCARNATION: 88,
        SURVIVOR_SLOT: 92,
        COMMITTED_COUNT: 96,
        CONSUMED_COUNT: 100,
        RESULT_FINGERPRINT: 104,
        TARGET_CURRENT_HP_FIXED_POINT: 108
    })
});

function requireUint32(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > UINT32_MAX) {
        throw new RangeError(`${label}은 uint32 범위여야 합니다.`);
    }
    return number;
}

function requirePositiveUint32(value, label) {
    const number = requireUint32(value, label);
    if (number === 0 || number === UINT32_MAX) {
        throw new RangeError(`${label}은 reserved sentinel이 아닌 양수여야 합니다.`);
    }
    return number;
}

function requirePositiveInt32(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number > INT32_MAX) {
        throw new RangeError(`${label}은 양의 int32여야 합니다.`);
    }
    return number;
}

function normalizeProtocol(source = {}) {
    return Object.freeze({
        sessionGeneration: requirePositiveUint32(
            source.sessionGeneration,
            'Tower merge sessionGeneration'
        ),
        deviceGeneration: requireUint32(
            source.deviceGeneration,
            'Tower merge deviceGeneration'
        ),
        authoritativeEpoch: requireUint32(
            source.authoritativeEpoch,
            'Tower merge authoritativeEpoch'
        )
    });
}

function hashWord(hash, word) {
    return Math.imul((hash ^ (Number(word) >>> 0)) >>> 0, FNV_PRIME) >>> 0;
}

function nonZeroHash(hash) {
    return hash === 0 ? 1 : hash >>> 0;
}

function hashText(text) {
    let hash = FNV_OFFSET;
    const value = String(text ?? '');
    if (value.length === 0) {
        throw new TypeError('Tower merge transactionId가 필요합니다.');
    }
    for (let index = 0; index < value.length; index++) {
        hash = hashWord(hash, value.charCodeAt(index));
    }
    return nonZeroHash(hash);
}

function parsePlanFingerprint(value) {
    if (typeof value !== 'string' || !/^[0-9a-fA-F]{16}$/.test(value)) {
        throw new TypeError('Tower merge plan fingerprint는 16자리 hex여야 합니다.');
    }
    return Object.freeze({
        lane0: Number.parseInt(value.slice(0, 8), 16) >>> 0,
        lane1: Number.parseInt(value.slice(8, 16), 16) >>> 0,
        text: value.toLowerCase()
    });
}

function normalizeRecord(source, rank, sourceGroupRevision) {
    const role = requireUint32(source.role, `records[${rank}].role`);
    if (role !== GPU_TOWER_MERGE_RECORD_ROLE.SURVIVOR
        && role !== GPU_TOWER_MERGE_RECORD_ROLE.CONSUMED) {
        throw new RangeError(`records[${rank}].role이 올바르지 않습니다.`);
    }
    const record = {
        slot: requireUint32(source.slot, `records[${rank}].slot`),
        entityId: requirePositiveUint32(
            source.entityId,
            `records[${rank}].entityId`
        ),
        incarnation: requirePositiveUint32(
            source.incarnation,
            `records[${rank}].incarnation`
        ),
        logicalTowerOrdinal: requirePositiveUint32(
            source.logicalTowerOrdinal,
            `records[${rank}].logicalTowerOrdinal`
        ),
        expectedCurrentHpFixedPoint: requirePositiveInt32(
            source.expectedCurrentHpFixedPoint,
            `records[${rank}].expectedCurrentHpFixedPoint`
        ),
        sourceShareUnits: requirePositiveUint32(
            source.sourceShareUnits,
            `records[${rank}].sourceShareUnits`
        ),
        sourceMaxHpFixedPoint: requirePositiveUint32(
            source.sourceMaxHpFixedPoint,
            `records[${rank}].sourceMaxHpFixedPoint`
        ),
        sourcePowerFixedPoint: requireUint32(
            source.sourcePowerFixedPoint,
            `records[${rank}].sourcePowerFixedPoint`
        ),
        sourceGroupRevision: requirePositiveUint32(
            source.sourceGroupRevision,
            `records[${rank}].sourceGroupRevision`
        ),
        sourceFlags: requireUint32(
            source.sourceFlags,
            `records[${rank}].sourceFlags`
        ),
        sourceRosterRank: requireUint32(
            source.sourceRosterRank,
            `records[${rank}].sourceRosterRank`
        ),
        role,
        targetCurrentHpFixedPoint: requireUint32(
            source.targetCurrentHpFixedPoint ?? 0,
            `records[${rank}].targetCurrentHpFixedPoint`
        ),
        targetShareUnits: requireUint32(
            source.targetShareUnits ?? 0,
            `records[${rank}].targetShareUnits`
        ),
        targetMaxHpFixedPoint: requireUint32(
            source.targetMaxHpFixedPoint ?? 0,
            `records[${rank}].targetMaxHpFixedPoint`
        ),
        targetPowerFixedPoint: requireUint32(
            source.targetPowerFixedPoint ?? 0,
            `records[${rank}].targetPowerFixedPoint`
        )
    };
    if (record.sourceGroupRevision !== sourceGroupRevision
        || record.sourceRosterRank !== rank
        || (record.sourceFlags & (
            GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
            | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING
        )) !== (
            GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
            | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING
        )) {
        throw new RangeError(`records[${rank}] source roster provenance가 다릅니다.`);
    }
    if (role === GPU_TOWER_MERGE_RECORD_ROLE.SURVIVOR) {
        requirePositiveInt32(
            record.targetCurrentHpFixedPoint,
            `records[${rank}].targetCurrentHpFixedPoint`
        );
        requirePositiveUint32(
            record.targetShareUnits,
            `records[${rank}].targetShareUnits`
        );
        requirePositiveUint32(
            record.targetMaxHpFixedPoint,
            `records[${rank}].targetMaxHpFixedPoint`
        );
        if (record.targetCurrentHpFixedPoint > record.targetMaxHpFixedPoint) {
            throw new RangeError('Tower merge target current HP가 max HP를 넘습니다.');
        }
    } else if (record.targetCurrentHpFixedPoint !== 0
        || record.targetShareUnits !== 0
        || record.targetMaxHpFixedPoint !== 0
        || record.targetPowerFixedPoint !== 0) {
        throw new RangeError('Consumed Tower merge record target 값은 모두 0이어야 합니다.');
    }
    return Object.freeze(record);
}

function computeRecordFingerprint(record) {
    let hash = FNV_OFFSET;
    for (const word of [
        record.slot,
        record.entityId,
        record.incarnation,
        record.logicalTowerOrdinal,
        record.expectedCurrentHpFixedPoint,
        record.sourceShareUnits,
        record.sourceMaxHpFixedPoint,
        record.sourcePowerFixedPoint,
        record.sourceGroupRevision,
        record.sourceFlags,
        record.sourceRosterRank,
        record.role,
        record.targetCurrentHpFixedPoint,
        record.targetShareUnits,
        record.targetMaxHpFixedPoint,
        record.targetPowerFixedPoint
    ]) {
        hash = hashWord(hash, word);
    }
    return nonZeroHash(hash);
}

function computeSourceIdentityFingerprint(records) {
    let hash = FNV_OFFSET;
    for (const record of records) {
        for (const word of [
            record.slot,
            record.entityId,
            record.incarnation,
            record.logicalTowerOrdinal,
            record.role
        ]) {
            hash = hashWord(hash, word);
        }
    }
    return nonZeroHash(hash);
}

function computeProgramFingerprint(program, records) {
    let hash = FNV_OFFSET;
    for (const word of [
        GPU_TOWER_MERGE_ABI_VERSION,
        GPU_CIRCLE_BODY_ABI_VERSION,
        GPU_TOWER_GROUP_ABI_VERSION,
        program.protocol.sessionGeneration,
        program.protocol.deviceGeneration,
        program.protocol.authoritativeEpoch,
        program.sourceTick,
        program.sourceCount,
        program.survivorRank,
        program.bodyCapacity,
        program.sourceGroupRevision,
        program.targetGroupRevision,
        program.sourceRosterFingerprint,
        program.targetRosterFingerprint,
        program.planFingerprintLane0,
        program.planFingerprintLane1,
        program.transactionFingerprint,
        program.sourceIdentityFingerprint,
        program.targetCurrentHpFixedPoint,
        program.targetMaxHpFixedPoint,
        program.targetPowerFixedPoint,
        program.targetShareUnits
    ]) {
        hash = hashWord(hash, word);
    }
    for (const record of records) {
        hash = hashWord(hash, record.recordFingerprint);
    }
    return nonZeroHash(hash);
}

export function createGpuTowerMergeHostStorage(recordCapacity = 256) {
    const capacity = requirePositiveUint32(
        recordCapacity,
        'Tower merge recordCapacity'
    );
    if (capacity > GPU_TOWER_MERGE_MAX_SOURCE_COUNT) {
        throw new RangeError('Tower merge recordCapacity는 256 이하여야 합니다.');
    }
    return Object.seal({
        recordCapacity: capacity,
        program: new ArrayBuffer(GPU_TOWER_MERGE_ABI.PROGRAM.STRIDE),
        records: new ArrayBuffer(
            capacity * GPU_TOWER_MERGE_ABI.RECORD.STRIDE
        ),
        result: new ArrayBuffer(GPU_TOWER_MERGE_ABI.RESULT.STRIDE)
    });
}

export function writeGpuTowerMergeProgram(storage, source = {}) {
    if (!storage?.program || !storage?.records || !storage?.result) {
        throw new TypeError('Tower merge host storage가 필요합니다.');
    }
    const protocol = normalizeProtocol(source.protocol);
    const sourceTick = requirePositiveUint32(
        source.sourceTick,
        'Tower merge sourceTick'
    );
    const bodyCapacity = requirePositiveUint32(
        source.bodyCapacity,
        'Tower merge bodyCapacity'
    );
    const sourceGroupRevision = requirePositiveUint32(
        source.sourceGroupRevision,
        'Tower merge sourceGroupRevision'
    );
    const targetGroupRevision = requirePositiveUint32(
        source.targetGroupRevision,
        'Tower merge targetGroupRevision'
    );
    if (targetGroupRevision !== sourceGroupRevision + 1) {
        throw new RangeError('Tower merge target revision은 source + 1이어야 합니다.');
    }
    if (!Array.isArray(source.records)
        || source.records.length < 2
        || source.records.length > storage.recordCapacity
        || source.records.length > GPU_TOWER_MERGE_MAX_SOURCE_COUNT) {
        throw new RangeError('Tower merge records는 2~256 bounded 배열이어야 합니다.');
    }
    const records = source.records.map((record, rank) => normalizeRecord(
        record,
        rank,
        sourceGroupRevision
    ));
    const slots = new Set();
    const identities = new Set();
    const ordinals = new Set();
    let survivorRank = -1;
    for (let rank = 0; rank < records.length; rank++) {
        const record = records[rank];
        const identity = `${record.entityId}:${record.incarnation}`;
        if (record.slot >= bodyCapacity || slots.has(record.slot)
            || identities.has(identity)
            || ordinals.has(record.logicalTowerOrdinal)) {
            throw new RangeError('Tower merge source slot/identity/ordinal이 중복되거나 범위를 벗어났습니다.');
        }
        slots.add(record.slot);
        identities.add(identity);
        ordinals.add(record.logicalTowerOrdinal);
        if (record.role === GPU_TOWER_MERGE_RECORD_ROLE.SURVIVOR) {
            if (survivorRank !== -1) {
                throw new RangeError('Tower merge survivor는 정확히 하나여야 합니다.');
            }
            survivorRank = rank;
        }
    }
    if (survivorRank < 0) {
        throw new RangeError('Tower merge survivor가 없습니다.');
    }
    const survivor = records[survivorRank];
    const planFingerprint = parsePlanFingerprint(source.planFingerprint);
    const sourceRosterFingerprint = requirePositiveUint32(
        source.sourceRosterFingerprint,
        'Tower merge sourceRosterFingerprint'
    );
    const targetRosterFingerprint = requirePositiveUint32(
        source.targetRosterFingerprint,
        'Tower merge targetRosterFingerprint'
    );
    const transactionId = String(source.transactionId ?? '');
    const transactionFingerprint = hashText(transactionId);
    const sourceIdentityFingerprint = computeSourceIdentityFingerprint(records);
    const fingerprintedRecords = Object.freeze(records.map((record) => (
        Object.freeze({
            ...record,
            recordFingerprint: computeRecordFingerprint(record)
        })
    )));
    const programBase = {
        protocol,
        transactionId,
        transactionFingerprint,
        planFingerprint: planFingerprint.text,
        planFingerprintLane0: planFingerprint.lane0,
        planFingerprintLane1: planFingerprint.lane1,
        sourceTick,
        sourceCount: fingerprintedRecords.length,
        survivorRank,
        bodyCapacity,
        sourceGroupRevision,
        targetGroupRevision,
        sourceRosterFingerprint,
        targetRosterFingerprint,
        sourceIdentityFingerprint,
        targetCurrentHpFixedPoint: survivor.targetCurrentHpFixedPoint,
        targetMaxHpFixedPoint: survivor.targetMaxHpFixedPoint,
        targetPowerFixedPoint: survivor.targetPowerFixedPoint,
        targetShareUnits: survivor.targetShareUnits,
        survivorEntityId: survivor.entityId,
        survivorIncarnation: survivor.incarnation,
        survivorSlot: survivor.slot
    };
    const programFingerprint = computeProgramFingerprint(
        programBase,
        fingerprintedRecords
    );
    const program = Object.freeze({
        ...programBase,
        programFingerprint,
        records: fingerprintedRecords
    });

    new Uint8Array(storage.program).fill(0);
    new Uint8Array(storage.records).fill(0);
    new Uint8Array(storage.result).fill(0);
    const programView = new DataView(storage.program);
    const p = GPU_TOWER_MERGE_ABI.PROGRAM;
    const programWords = [
        [p.ABI_VERSION, GPU_TOWER_MERGE_ABI_VERSION],
        [p.BODY_ABI_VERSION, GPU_CIRCLE_BODY_ABI_VERSION],
        [p.GROUP_ABI_VERSION, GPU_TOWER_GROUP_ABI_VERSION],
        [p.STATUS, GPU_TOWER_MERGE_STATUS.EMPTY],
        [p.ERROR_FLAGS, 0],
        [p.SESSION_GENERATION, protocol.sessionGeneration],
        [p.DEVICE_GENERATION, protocol.deviceGeneration],
        [p.AUTHORITATIVE_EPOCH, protocol.authoritativeEpoch],
        [p.SOURCE_TICK, sourceTick],
        [p.SOURCE_COUNT, program.sourceCount],
        [p.SURVIVOR_RANK, survivorRank],
        [p.BODY_CAPACITY, bodyCapacity],
        [p.SOURCE_GROUP_REVISION, sourceGroupRevision],
        [p.TARGET_GROUP_REVISION, targetGroupRevision],
        [p.SOURCE_ROSTER_FINGERPRINT, sourceRosterFingerprint],
        [p.TARGET_ROSTER_FINGERPRINT, targetRosterFingerprint],
        [p.PLAN_FINGERPRINT_0, planFingerprint.lane0],
        [p.PLAN_FINGERPRINT_1, planFingerprint.lane1],
        [p.TRANSACTION_FINGERPRINT, transactionFingerprint],
        [p.SOURCE_IDENTITY_FINGERPRINT, sourceIdentityFingerprint],
        [p.TARGET_CURRENT_HP_FIXED_POINT,
            program.targetCurrentHpFixedPoint],
        [p.TARGET_MAX_HP_FIXED_POINT, program.targetMaxHpFixedPoint],
        [p.TARGET_POWER_FIXED_POINT, program.targetPowerFixedPoint],
        [p.TARGET_SHARE_UNITS, program.targetShareUnits],
        [p.PROGRAM_FINGERPRINT, programFingerprint],
        [p.VALIDATED_COUNT, 0],
        [p.APPLIED_COUNT, 0],
        [p.SURVIVOR_ENTITY_ID, survivor.entityId],
        [p.SURVIVOR_INCARNATION, survivor.incarnation]
    ];
    for (const [offset, value] of programWords) {
        programView.setUint32(offset, value, LITTLE_ENDIAN);
    }

    const recordView = new DataView(storage.records);
    const r = GPU_TOWER_MERGE_ABI.RECORD;
    for (let rank = 0; rank < fingerprintedRecords.length; rank++) {
        const record = fingerprintedRecords[rank];
        const offset = rank * r.STRIDE;
        for (const [field, value] of [
            [r.SLOT, record.slot],
            [r.ENTITY_ID, record.entityId],
            [r.INCARNATION, record.incarnation],
            [r.LOGICAL_ORDINAL, record.logicalTowerOrdinal],
            [r.SOURCE_SHARE_UNITS, record.sourceShareUnits],
            [r.SOURCE_MAX_HP_FIXED_POINT, record.sourceMaxHpFixedPoint],
            [r.SOURCE_POWER_FIXED_POINT, record.sourcePowerFixedPoint],
            [r.SOURCE_GROUP_REVISION, record.sourceGroupRevision],
            [r.SOURCE_FLAGS, record.sourceFlags],
            [r.SOURCE_ROSTER_RANK, record.sourceRosterRank],
            [r.ROLE, record.role],
            [r.TARGET_CURRENT_HP_FIXED_POINT,
                record.targetCurrentHpFixedPoint],
            [r.TARGET_SHARE_UNITS, record.targetShareUnits],
            [r.TARGET_MAX_HP_FIXED_POINT, record.targetMaxHpFixedPoint],
            [r.TARGET_POWER_FIXED_POINT, record.targetPowerFixedPoint],
            [r.RECORD_FINGERPRINT, record.recordFingerprint]
        ]) {
            recordView.setUint32(offset + field, value, LITTLE_ENDIAN);
        }
        recordView.setInt32(
            offset + r.EXPECTED_CURRENT_HP_FIXED_POINT,
            record.expectedCurrentHpFixedPoint,
            LITTLE_ENDIAN
        );
    }
    return program;
}

function resultFingerprint(result) {
    let hash = FNV_OFFSET;
    for (const word of [
        result.abiVersion,
        result.bodyAbiVersion,
        result.groupAbiVersion,
        result.status,
        result.errorFlags,
        result.sessionGeneration,
        result.deviceGeneration,
        result.authoritativeEpoch,
        result.sourceTick,
        result.sourceCount,
        result.survivorRank,
        result.validatedCount,
        result.appliedCount,
        result.sourceGroupRevision,
        result.targetGroupRevision,
        result.sourceRosterFingerprint,
        result.targetRosterFingerprint,
        result.planFingerprintLane0,
        result.planFingerprintLane1,
        result.transactionFingerprint,
        result.sourceIdentityFingerprint,
        result.survivorEntityId,
        result.survivorIncarnation,
        result.survivorSlot,
        result.committedCount,
        result.consumedCount,
        result.targetCurrentHpFixedPoint
    ]) {
        hash = hashWord(hash, word);
    }
    return nonZeroHash(hash);
}

export function readGpuTowerMergeResult(buffer) {
    if (!(buffer instanceof ArrayBuffer) && !ArrayBuffer.isView(buffer)) {
        throw new TypeError('Tower merge result ArrayBuffer가 필요합니다.');
    }
    const source = buffer instanceof ArrayBuffer
        ? buffer
        : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    if (source.byteLength < GPU_TOWER_MERGE_ABI.RESULT.STRIDE) {
        throw new RangeError('Tower merge result가 ABI보다 짧습니다.');
    }
    const view = new DataView(source);
    const r = GPU_TOWER_MERGE_ABI.RESULT;
    const result = {
        abiVersion: view.getUint32(r.ABI_VERSION, LITTLE_ENDIAN),
        bodyAbiVersion: view.getUint32(r.BODY_ABI_VERSION, LITTLE_ENDIAN),
        groupAbiVersion: view.getUint32(r.GROUP_ABI_VERSION, LITTLE_ENDIAN),
        status: view.getUint32(r.STATUS, LITTLE_ENDIAN),
        errorFlags: view.getUint32(r.ERROR_FLAGS, LITTLE_ENDIAN),
        sessionGeneration: view.getUint32(r.SESSION_GENERATION, LITTLE_ENDIAN),
        deviceGeneration: view.getUint32(r.DEVICE_GENERATION, LITTLE_ENDIAN),
        authoritativeEpoch: view.getUint32(r.AUTHORITATIVE_EPOCH, LITTLE_ENDIAN),
        sourceTick: view.getUint32(r.SOURCE_TICK, LITTLE_ENDIAN),
        sourceCount: view.getUint32(r.SOURCE_COUNT, LITTLE_ENDIAN),
        survivorRank: view.getUint32(r.SURVIVOR_RANK, LITTLE_ENDIAN),
        validatedCount: view.getUint32(r.VALIDATED_COUNT, LITTLE_ENDIAN),
        appliedCount: view.getUint32(r.APPLIED_COUNT, LITTLE_ENDIAN),
        sourceGroupRevision: view.getUint32(
            r.SOURCE_GROUP_REVISION,
            LITTLE_ENDIAN
        ),
        targetGroupRevision: view.getUint32(
            r.TARGET_GROUP_REVISION,
            LITTLE_ENDIAN
        ),
        sourceRosterFingerprint: view.getUint32(
            r.SOURCE_ROSTER_FINGERPRINT,
            LITTLE_ENDIAN
        ),
        targetRosterFingerprint: view.getUint32(
            r.TARGET_ROSTER_FINGERPRINT,
            LITTLE_ENDIAN
        ),
        planFingerprintLane0: view.getUint32(
            r.PLAN_FINGERPRINT_0,
            LITTLE_ENDIAN
        ),
        planFingerprintLane1: view.getUint32(
            r.PLAN_FINGERPRINT_1,
            LITTLE_ENDIAN
        ),
        transactionFingerprint: view.getUint32(
            r.TRANSACTION_FINGERPRINT,
            LITTLE_ENDIAN
        ),
        sourceIdentityFingerprint: view.getUint32(
            r.SOURCE_IDENTITY_FINGERPRINT,
            LITTLE_ENDIAN
        ),
        survivorEntityId: view.getUint32(r.SURVIVOR_ENTITY_ID, LITTLE_ENDIAN),
        survivorIncarnation: view.getUint32(
            r.SURVIVOR_INCARNATION,
            LITTLE_ENDIAN
        ),
        survivorSlot: view.getUint32(r.SURVIVOR_SLOT, LITTLE_ENDIAN),
        committedCount: view.getUint32(r.COMMITTED_COUNT, LITTLE_ENDIAN),
        consumedCount: view.getUint32(r.CONSUMED_COUNT, LITTLE_ENDIAN),
        resultFingerprint: view.getUint32(r.RESULT_FINGERPRINT, LITTLE_ENDIAN),
        targetCurrentHpFixedPoint: view.getUint32(
            r.TARGET_CURRENT_HP_FIXED_POINT,
            LITTLE_ENDIAN
        )
    };
    return Object.freeze({
        ...result,
        planFingerprint: [
            result.planFingerprintLane0,
            result.planFingerprintLane1
        ].map((value) => value.toString(16).padStart(8, '0')).join(''),
        resultFingerprintValid: result.resultFingerprint
            === resultFingerprint(result)
    });
}

export {
    LITTLE_ENDIAN as GPU_TOWER_MERGE_LITTLE_ENDIAN,
    computeRecordFingerprint as computeGpuTowerMergeRecordFingerprint,
    computeSourceIdentityFingerprint as computeGpuTowerMergeSourceIdentityFingerprint,
    computeProgramFingerprint as computeGpuTowerMergeProgramFingerprint,
    resultFingerprint as computeGpuTowerMergeResultFingerprint
};
