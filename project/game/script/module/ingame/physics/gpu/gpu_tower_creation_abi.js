import { ABILITY_ENTITY_METADATA_ABI_VERSION } from '../../contract/ability_execution_contract.js';
import { GPU_CIRCLE_BODY_ABI_VERSION } from './gpu_circle_body_abi.js';
import {
    GPU_TOWER_GROUP_ABI_VERSION,
    GPU_TOWER_GROUP_INVALID_COMPONENT,
    GPU_TOWER_GROUP_MEMBER_FLAG,
    computeGpuTowerGroupRosterFingerprint
} from './gpu_tower_group_abi.js';

const LITTLE_ENDIAN = true;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export const GPU_TOWER_CREATION_ABI_VERSION = 1;

export const GPU_TOWER_CREATION_RECORD_KIND = Object.freeze({
    EXISTING: 1,
    CHILD: 2
});

export const GPU_TOWER_CREATION_STATUS = Object.freeze({
    PENDING: 0,
    COMMITTED: 1,
    REJECTED_SOURCE_CHANGED: 2,
    PROTOCOL_FAILURE: 3,
    READY_TO_APPLY: 4
});

export const GPU_TOWER_CREATION_ERROR_FLAG = Object.freeze({
    BODY_ABI_MISMATCH: 1 << 0,
    GROUP_ABI_MISMATCH: 1 << 1,
    PROTOCOL_MISMATCH: 1 << 2,
    PROGRAM_INVALID: 1 << 3,
    SOURCE_ROSTER_CHANGED: 1 << 4,
    SOURCE_BODY_CHANGED: 1 << 5,
    DESTINATION_CHANGED: 1 << 6,
    ABILITY_METADATA_CHANGED: 1 << 7,
    TARGET_FINGERPRINT_INVALID: 1 << 8,
    PARTIAL_APPLY: 1 << 9
});

export const GPU_TOWER_CREATION_HARD_FAILURE_MASK = (
    GPU_TOWER_CREATION_ERROR_FLAG.BODY_ABI_MISMATCH
    | GPU_TOWER_CREATION_ERROR_FLAG.GROUP_ABI_MISMATCH
    | GPU_TOWER_CREATION_ERROR_FLAG.PROTOCOL_MISMATCH
    | GPU_TOWER_CREATION_ERROR_FLAG.PROGRAM_INVALID
    | GPU_TOWER_CREATION_ERROR_FLAG.TARGET_FINGERPRINT_INVALID
    | GPU_TOWER_CREATION_ERROR_FLAG.PARTIAL_APPLY
);

export const GPU_TOWER_CREATION_STORAGE_PROFILE = Object.freeze({
    validateStorageBuffersPerStage: 9,
    applyStorageBuffersPerStage: 9,
    maximumStorageBuffersPerStage: 9
});

export const GPU_TOWER_CREATION_ABI = Object.freeze({
    PROGRAM: Object.freeze({
        STRIDE: 80,
        ABI_VERSION: 0,
        BODY_ABI_VERSION: 4,
        GROUP_ABI_VERSION: 8,
        SESSION_GENERATION: 12,
        DEVICE_GENERATION: 16,
        AUTHORITATIVE_EPOCH: 20,
        SOURCE_TICK: 24,
        TRANSACTION_FINGERPRINT: 28,
        RECORD_COUNT: 32,
        EXISTING_COUNT: 36,
        CHILD_COUNT: 40,
        BODY_CAPACITY: 44,
        SOURCE_GROUP_REVISION: 48,
        TARGET_GROUP_REVISION: 52,
        SOURCE_ROSTER_FINGERPRINT: 56,
        TARGET_ROSTER_FINGERPRINT: 60,
        TOWER_DEFINITION_CODE: 64,
        ABILITY_METADATA_ABI_VERSION: 68,
        ROSTER_CAPACITY: 72,
        RECORD_FINGERPRINT: 76,
        RESERVED: 76
    }),
    RECORD: Object.freeze({
        STRIDE: 64,
        KIND: 0,
        SLOT: 4,
        ENTITY_ID: 8,
        INCARNATION: 12,
        LOGICAL_ORDINAL: 16,
        SOURCE_CURRENT_HP_FIXED_POINT: 20,
        TARGET_CURRENT_HP_FIXED_POINT: 24,
        SOURCE_SHARE_UNITS: 28,
        TARGET_SHARE_UNITS: 32,
        SOURCE_MAX_HP_FIXED_POINT: 36,
        TARGET_MAX_HP_FIXED_POINT: 40,
        SOURCE_POWER_FIXED_POINT: 44,
        TARGET_POWER_FIXED_POINT: 48,
        SOURCE_GROUP_REVISION: 52,
        TARGET_GROUP_REVISION: 56,
        ROSTER_RANK: 60
    }),
    RESULT: Object.freeze({
        STRIDE: 64,
        ABI_VERSION: 0,
        STATUS: 4,
        ERROR_FLAGS: 8,
        SESSION_GENERATION: 12,
        DEVICE_GENERATION: 16,
        AUTHORITATIVE_EPOCH: 20,
        SOURCE_TICK: 24,
        TRANSACTION_FINGERPRINT: 28,
        RECORD_COUNT: 32,
        VALIDATED_COUNT: 36,
        APPLIED_COUNT: 40,
        CREATED_COUNT: 44,
        SOURCE_GROUP_REVISION: 48,
        TARGET_GROUP_REVISION: 52,
        TARGET_ROSTER_FINGERPRINT: 56,
        RESULT_FINGERPRINT: 60
    })
});

function requireUint32(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
        throw new RangeError(`${label}은 uint32여야 합니다.`);
    }
    return number >>> 0;
}

function requirePositiveUint32(value, label) {
    const number = requireUint32(value, label);
    if (number === 0 || number === GPU_TOWER_GROUP_INVALID_COMPONENT) {
        throw new RangeError(`${label}은 reserved sentinel이 아닌 양의 uint32여야 합니다.`);
    }
    return number;
}

function hashWord(hash, value) {
    return Math.imul((hash ^ (Number(value) >>> 0)) >>> 0, FNV_PRIME) >>> 0;
}

function nonZeroHash(value) {
    return value === 0 ? 1 : value >>> 0;
}

export function fingerprintGpuTowerCreationTransaction(...parts) {
    let hash = FNV_OFFSET;
    const text = parts.map((part) => String(part)).join('|');
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        hash = hashWord(hash, code & 0xff);
        if ((code >>> 8) !== 0) hash = hashWord(hash, code >>> 8);
    }
    return nonZeroHash(hash);
}

function normalizeProtocol(source = {}) {
    return Object.freeze({
        sessionGeneration: requirePositiveUint32(
            source.sessionGeneration,
            'Tower creation sessionGeneration'
        ),
        deviceGeneration: requireUint32(
            source.deviceGeneration,
            'Tower creation deviceGeneration'
        ),
        authoritativeEpoch: requireUint32(
            source.authoritativeEpoch,
            'Tower creation authoritativeEpoch'
        )
    });
}

function normalizeRecord(source, index, sourceRevision, targetRevision) {
    const kind = requireUint32(source?.kind, `records[${index}].kind`);
    if (kind !== GPU_TOWER_CREATION_RECORD_KIND.EXISTING
        && kind !== GPU_TOWER_CREATION_RECORD_KIND.CHILD) {
        throw new RangeError(`records[${index}].kind가 유효하지 않습니다.`);
    }
    const normalized = Object.freeze({
        kind,
        slot: requireUint32(source.slot, `records[${index}].slot`),
        entityId: requirePositiveUint32(
            source.entityId,
            `records[${index}].entityId`
        ),
        incarnation: requirePositiveUint32(
            source.incarnation,
            `records[${index}].incarnation`
        ),
        logicalTowerOrdinal: requirePositiveUint32(
            source.logicalTowerOrdinal,
            `records[${index}].logicalTowerOrdinal`
        ),
        sourceCurrentHpFixedPoint: requireUint32(
            source.sourceCurrentHpFixedPoint ?? 0,
            `records[${index}].sourceCurrentHpFixedPoint`
        ),
        targetCurrentHpFixedPoint: requirePositiveUint32(
            source.targetCurrentHpFixedPoint,
            `records[${index}].targetCurrentHpFixedPoint`
        ),
        sourceShareUnits: requireUint32(
            source.sourceShareUnits ?? 0,
            `records[${index}].sourceShareUnits`
        ),
        targetShareUnits: requirePositiveUint32(
            source.targetShareUnits,
            `records[${index}].targetShareUnits`
        ),
        sourceMaxHpFixedPoint: requireUint32(
            source.sourceMaxHpFixedPoint ?? 0,
            `records[${index}].sourceMaxHpFixedPoint`
        ),
        targetMaxHpFixedPoint: requirePositiveUint32(
            source.targetMaxHpFixedPoint,
            `records[${index}].targetMaxHpFixedPoint`
        ),
        sourcePowerFixedPoint: requireUint32(
            source.sourcePowerFixedPoint ?? 0,
            `records[${index}].sourcePowerFixedPoint`
        ),
        targetPowerFixedPoint: requireUint32(
            source.targetPowerFixedPoint,
            `records[${index}].targetPowerFixedPoint`
        ),
        sourceGroupRevision: requireUint32(
            source.sourceGroupRevision
                ?? (kind === GPU_TOWER_CREATION_RECORD_KIND.EXISTING
                    ? sourceRevision
                    : 0),
            `records[${index}].sourceGroupRevision`
        ),
        targetGroupRevision: requirePositiveUint32(
            source.targetGroupRevision ?? targetRevision,
            `records[${index}].targetGroupRevision`
        ),
        rosterRank: requireUint32(
            source.rosterRank ?? index,
            `records[${index}].rosterRank`
        )
    });
    if (kind === GPU_TOWER_CREATION_RECORD_KIND.EXISTING
        && (normalized.sourceCurrentHpFixedPoint === 0
            || normalized.sourceShareUnits === 0
            || normalized.sourceMaxHpFixedPoint === 0
            || normalized.sourceGroupRevision !== sourceRevision)) {
        throw new RangeError(`records[${index}] existing source가 유효하지 않습니다.`);
    }
    if (kind === GPU_TOWER_CREATION_RECORD_KIND.CHILD
        && (normalized.sourceCurrentHpFixedPoint !== 0
            || normalized.sourceShareUnits !== 0
            || normalized.sourceMaxHpFixedPoint !== 0
            || normalized.sourcePowerFixedPoint !== 0
            || normalized.sourceGroupRevision !== 0)) {
        throw new RangeError(`records[${index}] child source는 zero여야 합니다.`);
    }
    return normalized;
}

export function computeGpuTowerCreationRecordFingerprint(records) {
    if (!Array.isArray(records) || records.length === 0) {
        throw new TypeError('Tower creation record fingerprint 배열이 필요합니다.');
    }
    let hash = hashWord(FNV_OFFSET, GPU_TOWER_CREATION_ABI_VERSION);
    hash = hashWord(hash, records.length);
    for (const record of records) {
        for (const value of [
            record.kind,
            record.slot,
            record.entityId,
            record.incarnation,
            record.logicalTowerOrdinal,
            record.sourceCurrentHpFixedPoint,
            record.targetCurrentHpFixedPoint,
            record.sourceShareUnits,
            record.targetShareUnits,
            record.sourceMaxHpFixedPoint,
            record.targetMaxHpFixedPoint,
            record.sourcePowerFixedPoint,
            record.targetPowerFixedPoint,
            record.sourceGroupRevision,
            record.targetGroupRevision,
            record.rosterRank
        ]) {
            hash = hashWord(
                hash,
                requireUint32(value, 'Tower creation record fingerprint word')
            );
        }
    }
    return nonZeroHash(hash);
}

export function createGpuTowerCreationHostStorage(recordCapacity) {
    const capacity = requirePositiveUint32(
        recordCapacity,
        'Tower creation recordCapacity'
    );
    return Object.seal({
        recordCapacity: capacity,
        program: new ArrayBuffer(GPU_TOWER_CREATION_ABI.PROGRAM.STRIDE),
        records: new ArrayBuffer(
            capacity * GPU_TOWER_CREATION_ABI.RECORD.STRIDE
        ),
        result: new ArrayBuffer(GPU_TOWER_CREATION_ABI.RESULT.STRIDE)
    });
}

export function writeGpuTowerCreationProgram(storage, source = {}) {
    if (!storage?.program || !storage?.records) {
        throw new TypeError('Tower creation host storage가 필요합니다.');
    }
    const protocol = normalizeProtocol(source.protocol);
    const sourceGroupRevision = requirePositiveUint32(
        source.sourceGroupRevision,
        'Tower creation sourceGroupRevision'
    );
    const targetGroupRevision = requirePositiveUint32(
        source.targetGroupRevision,
        'Tower creation targetGroupRevision'
    );
    if (targetGroupRevision !== sourceGroupRevision + 1) {
        throw new RangeError('Tower creation target revision은 source + 1이어야 합니다.');
    }
    if (!Array.isArray(source.records)
        || source.records.length === 0
        || source.records.length > storage.recordCapacity) {
        throw new RangeError('Tower creation records가 비었거나 capacity를 초과했습니다.');
    }
    const existingCount = requirePositiveUint32(
        source.existingCount,
        'Tower creation existingCount'
    );
    const childCount = requirePositiveUint32(
        source.childCount,
        'Tower creation childCount'
    );
    if (existingCount + childCount !== source.records.length) {
        throw new RangeError('Tower creation record count가 existing + child와 다릅니다.');
    }
    const records = source.records.map((record, index) => normalizeRecord(
        record,
        index,
        sourceGroupRevision,
        targetGroupRevision
    ));
    if (records.slice(0, existingCount).some((record) => (
        record.kind !== GPU_TOWER_CREATION_RECORD_KIND.EXISTING
    )) || records.slice(existingCount).some((record) => (
        record.kind !== GPU_TOWER_CREATION_RECORD_KIND.CHILD
    ))) {
        throw new RangeError('Tower creation records는 existing 다음 child 순서여야 합니다.');
    }
    const slots = new Set(records.map((record) => record.slot));
    const identities = new Set(records.map((record) => (
        `${record.entityId}:${record.incarnation}`
    )));
    const ordinals = new Set(records.map((record) => record.logicalTowerOrdinal));
    if (slots.size !== records.length
        || identities.size !== records.length
        || ordinals.size !== records.length
        || records.some((record, index) => record.rosterRank !== index)) {
        throw new RangeError('Tower creation slot/identity/ordinal/rank가 고유하지 않습니다.');
    }
    const bodyCapacity = requirePositiveUint32(
        source.bodyCapacity,
        'Tower creation bodyCapacity'
    );
    const rosterCapacity = requirePositiveUint32(
        source.rosterCapacity,
        'Tower creation rosterCapacity'
    );
    if (records.length > rosterCapacity
        || records.some((record) => record.slot >= bodyCapacity)) {
        throw new RangeError('Tower creation record가 body/roster capacity를 벗어났습니다.');
    }
    const memberFlags = GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
        | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING;
    const sourceRosterFingerprint = requirePositiveUint32(
        source.sourceRosterFingerprint,
        'Tower creation sourceRosterFingerprint'
    );
    const targetRosterFingerprint = requirePositiveUint32(
        source.targetRosterFingerprint,
        'Tower creation targetRosterFingerprint'
    );
    const sourceMembers = records.slice(0, existingCount).map((record) => ({
        slot: record.slot,
        entityId: record.entityId,
        incarnation: record.incarnation,
        logicalTowerOrdinal: record.logicalTowerOrdinal,
        shareUnits: record.sourceShareUnits,
        maxHpFixedPoint: record.sourceMaxHpFixedPoint,
        powerFixedPoint: record.sourcePowerFixedPoint,
        groupRevision: sourceGroupRevision,
        flags: memberFlags,
        rosterRank: record.rosterRank
    }));
    const targetMembers = records.map((record) => ({
        slot: record.slot,
        entityId: record.entityId,
        incarnation: record.incarnation,
        logicalTowerOrdinal: record.logicalTowerOrdinal,
        shareUnits: record.targetShareUnits,
        maxHpFixedPoint: record.targetMaxHpFixedPoint,
        powerFixedPoint: record.targetPowerFixedPoint,
        groupRevision: targetGroupRevision,
        flags: memberFlags,
        rosterRank: record.rosterRank
    }));
    if (sourceRosterFingerprint !== computeGpuTowerGroupRosterFingerprint({
        protocol,
        groupRevision: sourceGroupRevision,
        members: sourceMembers
    }) || targetRosterFingerprint !== computeGpuTowerGroupRosterFingerprint({
        protocol,
        groupRevision: targetGroupRevision,
        members: targetMembers
    })) {
        throw new RangeError('Tower creation source/target roster fingerprint가 records와 다릅니다.');
    }
    const recordFingerprint = computeGpuTowerCreationRecordFingerprint(records);
    const program = Object.freeze({
        protocol,
        sourceTick: requirePositiveUint32(
            source.sourceTick,
            'Tower creation sourceTick'
        ),
        transactionFingerprint: requirePositiveUint32(
            source.transactionFingerprint,
            'Tower creation transactionFingerprint'
        ),
        recordCount: records.length,
        existingCount,
        childCount,
        bodyCapacity,
        sourceGroupRevision,
        targetGroupRevision,
        sourceRosterFingerprint,
        targetRosterFingerprint,
        towerDefinitionCode: requirePositiveUint32(
            source.towerDefinitionCode,
            'Tower creation towerDefinitionCode'
        ),
        rosterCapacity,
        recordFingerprint,
        records: Object.freeze(records)
    });
    new Uint8Array(storage.program).fill(0);
    new Uint8Array(storage.records).fill(0);
    new Uint8Array(storage.result).fill(0);
    const programView = new DataView(storage.program);
    const p = GPU_TOWER_CREATION_ABI.PROGRAM;
    const programWords = [
        [p.ABI_VERSION, GPU_TOWER_CREATION_ABI_VERSION],
        [p.BODY_ABI_VERSION, GPU_CIRCLE_BODY_ABI_VERSION],
        [p.GROUP_ABI_VERSION, GPU_TOWER_GROUP_ABI_VERSION],
        [p.SESSION_GENERATION, protocol.sessionGeneration],
        [p.DEVICE_GENERATION, protocol.deviceGeneration],
        [p.AUTHORITATIVE_EPOCH, protocol.authoritativeEpoch],
        [p.SOURCE_TICK, program.sourceTick],
        [p.TRANSACTION_FINGERPRINT, program.transactionFingerprint],
        [p.RECORD_COUNT, program.recordCount],
        [p.EXISTING_COUNT, existingCount],
        [p.CHILD_COUNT, childCount],
        [p.BODY_CAPACITY, bodyCapacity],
        [p.SOURCE_GROUP_REVISION, sourceGroupRevision],
        [p.TARGET_GROUP_REVISION, targetGroupRevision],
        [p.SOURCE_ROSTER_FINGERPRINT, program.sourceRosterFingerprint],
        [p.TARGET_ROSTER_FINGERPRINT, program.targetRosterFingerprint],
        [p.TOWER_DEFINITION_CODE, program.towerDefinitionCode],
        [p.ABILITY_METADATA_ABI_VERSION,
            ABILITY_ENTITY_METADATA_ABI_VERSION],
        [p.ROSTER_CAPACITY, rosterCapacity],
        [p.RECORD_FINGERPRINT, recordFingerprint]
    ];
    for (const [offset, value] of programWords) {
        programView.setUint32(offset, value, LITTLE_ENDIAN);
    }
    const recordView = new DataView(storage.records);
    const r = GPU_TOWER_CREATION_ABI.RECORD;
    records.forEach((record, index) => {
        const base = index * r.STRIDE;
        const words = [
            [r.KIND, record.kind],
            [r.SLOT, record.slot],
            [r.ENTITY_ID, record.entityId],
            [r.INCARNATION, record.incarnation],
            [r.LOGICAL_ORDINAL, record.logicalTowerOrdinal],
            [r.SOURCE_CURRENT_HP_FIXED_POINT,
                record.sourceCurrentHpFixedPoint],
            [r.TARGET_CURRENT_HP_FIXED_POINT,
                record.targetCurrentHpFixedPoint],
            [r.SOURCE_SHARE_UNITS, record.sourceShareUnits],
            [r.TARGET_SHARE_UNITS, record.targetShareUnits],
            [r.SOURCE_MAX_HP_FIXED_POINT, record.sourceMaxHpFixedPoint],
            [r.TARGET_MAX_HP_FIXED_POINT, record.targetMaxHpFixedPoint],
            [r.SOURCE_POWER_FIXED_POINT, record.sourcePowerFixedPoint],
            [r.TARGET_POWER_FIXED_POINT, record.targetPowerFixedPoint],
            [r.SOURCE_GROUP_REVISION, record.sourceGroupRevision],
            [r.TARGET_GROUP_REVISION, record.targetGroupRevision],
            [r.ROSTER_RANK, record.rosterRank]
        ];
        for (const [offset, value] of words) {
            recordView.setUint32(base + offset, value, LITTLE_ENDIAN);
        }
    });
    return program;
}

export function computeGpuTowerCreationResultFingerprint(source = {}) {
    let hash = FNV_OFFSET;
    for (const value of [
        GPU_TOWER_CREATION_ABI_VERSION,
        source.status,
        source.errorFlags,
        source.sessionGeneration,
        source.deviceGeneration,
        source.authoritativeEpoch,
        source.sourceTick,
        source.transactionFingerprint,
        source.recordCount,
        source.validatedCount,
        source.appliedCount,
        source.createdCount,
        source.sourceGroupRevision,
        source.targetGroupRevision,
        source.targetRosterFingerprint
    ]) {
        hash = hashWord(hash, requireUint32(value, 'Tower creation result word'));
    }
    return nonZeroHash(hash);
}

export function readGpuTowerCreationResult(buffer) {
    if (!(buffer instanceof ArrayBuffer) && !ArrayBuffer.isView(buffer)) {
        throw new TypeError('Tower creation result ArrayBuffer가 필요합니다.');
    }
    const source = buffer instanceof ArrayBuffer
        ? buffer
        : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    if (source.byteLength < GPU_TOWER_CREATION_ABI.RESULT.STRIDE) {
        throw new RangeError('Tower creation result byteLength가 ABI보다 작습니다.');
    }
    const view = new DataView(source);
    const r = GPU_TOWER_CREATION_ABI.RESULT;
    const result = {
        abiVersion: view.getUint32(r.ABI_VERSION, LITTLE_ENDIAN),
        status: view.getUint32(r.STATUS, LITTLE_ENDIAN),
        errorFlags: view.getUint32(r.ERROR_FLAGS, LITTLE_ENDIAN),
        sessionGeneration: view.getUint32(r.SESSION_GENERATION, LITTLE_ENDIAN),
        deviceGeneration: view.getUint32(r.DEVICE_GENERATION, LITTLE_ENDIAN),
        authoritativeEpoch: view.getUint32(r.AUTHORITATIVE_EPOCH, LITTLE_ENDIAN),
        sourceTick: view.getUint32(r.SOURCE_TICK, LITTLE_ENDIAN),
        transactionFingerprint: view.getUint32(
            r.TRANSACTION_FINGERPRINT,
            LITTLE_ENDIAN
        ),
        recordCount: view.getUint32(r.RECORD_COUNT, LITTLE_ENDIAN),
        validatedCount: view.getUint32(r.VALIDATED_COUNT, LITTLE_ENDIAN),
        appliedCount: view.getUint32(r.APPLIED_COUNT, LITTLE_ENDIAN),
        createdCount: view.getUint32(r.CREATED_COUNT, LITTLE_ENDIAN),
        sourceGroupRevision: view.getUint32(
            r.SOURCE_GROUP_REVISION,
            LITTLE_ENDIAN
        ),
        targetGroupRevision: view.getUint32(
            r.TARGET_GROUP_REVISION,
            LITTLE_ENDIAN
        ),
        targetRosterFingerprint: view.getUint32(
            r.TARGET_ROSTER_FINGERPRINT,
            LITTLE_ENDIAN
        ),
        resultFingerprint: view.getUint32(r.RESULT_FINGERPRINT, LITTLE_ENDIAN)
    };
    return Object.freeze({
        ...result,
        fingerprintValid: result.resultFingerprint
            === computeGpuTowerCreationResultFingerprint(result),
        committed: result.status === GPU_TOWER_CREATION_STATUS.COMMITTED,
        recoveryRequired: result.status
                === GPU_TOWER_CREATION_STATUS.PROTOCOL_FAILURE
            || (result.errorFlags & GPU_TOWER_CREATION_HARD_FAILURE_MASK) !== 0
    });
}

export {
    ABILITY_ENTITY_METADATA_ABI_VERSION,
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_TOWER_GROUP_ABI_VERSION,
    LITTLE_ENDIAN as GPU_TOWER_CREATION_LITTLE_ENDIAN
};
