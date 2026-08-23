import {
    ABILITY_ENTITY_METADATA_ABI_VERSION,
    ABILITY_EXECUTION_COMMAND_ABI_VERSION,
    ABILITY_SUBJECT_SNAPSHOT_ERROR_FLAG,
    ABILITY_SUBJECT_SNAPSHOT_STATUS
} from '../../contract/ability_execution_contract.js';
import {
    computeTowerMergeSnapshotIdentityFingerprint
} from '../../contract/tower_merge_identity_proof_contract.js';
import { GPU_CIRCLE_BODY_ABI_VERSION } from './gpu_circle_body_abi.js';

const LITTLE_ENDIAN = true;

export const GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION = 1;

export const GPU_ABILITY_SUBJECT_SNAPSHOT_ABI = Object.freeze({
    ENTITY_METADATA: Object.freeze({
        STRIDE: 48,
        ABI_VERSION: 0,
        NOUN_MASK: 4,
        DEFINITION_CODE: 8,
        OWNER_ENTITY_ID: 12,
        OWNER_INCARNATION: 16,
        SOURCE_ABILITY_CODE: 20,
        SOURCE_EXECUTION_FINGERPRINT: 24,
        SOURCE_EXECUTION_ORDINAL: 28,
        GENERATION: 32,
        VISIBLE_FROM_EXECUTION_ORDINAL: 36,
        CREATION_ORIGIN_CODE: 40,
        POWER_FIXED_POINT: 44
    }),
    COMMAND: Object.freeze({
        STRIDE: 96,
        ABI_VERSION: 0,
        SESSION_GENERATION: 4,
        DEVICE_GENERATION: 8,
        AUTHORITATIVE_EPOCH: 12,
        TARGET_FIXED_TICK: 16,
        EXECUTION_ORDINAL: 20,
        SELECTOR_CODE: 24,
        NOUN_MASK: 28,
        TEAM_ID: 32,
        SUBJECT_LIMIT: 36,
        GENERATION_LIMIT: 40,
        COMPILED_ABILITY_CODE: 44,
        EXECUTION_ID_FINGERPRINT: 48,
        COMMAND_FINGERPRINT: 52,
        ACTION_CODE: 56,
        PAYLOAD_CODE: 60,
        TARGET_POLICY_CODE: 64,
        AIM_POINT_X: 68,
        AIM_POINT_Y: 72,
        OUTPUT_SLOT: 76,
        SNAPSHOT_CAPACITY: 80,
        AGGREGATE_WORD_OFFSET: 84,
        SNAPSHOT_WORD_OFFSET: 88,
        IDENTITY_WORD_OFFSET: 92
    }),
    AGGREGATE: Object.freeze({
        STRIDE: 64,
        ABI_VERSION: 0,
        BODY_ABI_VERSION: 4,
        SESSION_GENERATION: 8,
        DEVICE_GENERATION: 12,
        AUTHORITATIVE_EPOCH: 16,
        SOURCE_TICK: 20,
        EXECUTION_ORDINAL: 24,
        STATUS: 28,
        SUBJECT_COUNT: 32,
        CAPACITY_DEMAND: 36,
        SUBJECT_LIMIT: 40,
        COMMAND_FINGERPRINT: 44,
        SNAPSHOT_FINGERPRINT: 48,
        ERROR_FLAGS: 52,
        OUTPUT_SLOT: 56,
        GENERATION_LIMIT: 60
    }),
    SNAPSHOT_RECORD: Object.freeze({
        STRIDE: 112,
        PRIVATE_SLOT: 0,
        ENTITY_ID: 4,
        INCARNATION: 8,
        TEAM_ID: 12,
        POSITION_X: 16,
        POSITION_Y: 20,
        VELOCITY_X: 24,
        VELOCITY_Y: 28,
        FACING_X: 32,
        FACING_Y: 36,
        FLOW_FIELD_INDEX: 40,
        ROUTE_PATH_INDEX: 44,
        ROUTE_SET_INDEX: 48,
        DEFINITION_CODE: 52,
        GENERATION: 56,
        OWNER_ENTITY_ID: 60,
        OWNER_INCARNATION: 64,
        DAMAGE_INPUT_BITS: 68,
        HEALTH_FIXED_POINT: 72,
        SOURCE_EXECUTION_ORDINAL: 76,
        POWER_FIXED_POINT: 80,
        SOURCE_EXECUTION_FINGERPRINT: 84,
        SOURCE_ABILITY_CODE: 88,
        CREATION_ORIGIN_CODE: 92,
        RADIUS: 96,
        FLOW_SPEED: 100,
        ROUTE_META: 104,
        ROUTE_PROFILE_CODE: 108
    }),
    IDENTITY_RECORD: Object.freeze({
        STRIDE: 12,
        PRIVATE_SLOT: 0,
        ENTITY_ID: 4,
        INCARNATION: 8
    })
});

function requireUint32(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
        throw new RangeError(`${label}은 uint32여야 합니다.`);
    }
    return number >>> 0;
}

function requireSlot(slot, capacity, label = 'slot') {
    const index = requireUint32(slot, label);
    if (index >= capacity) {
        throw new RangeError(`${label}이 capacity를 벗어났습니다.`);
    }
    return index;
}

export function writeGpuAbilityEntityMetadata(
    storage,
    capacity,
    slot,
    metadata
) {
    if (!(storage instanceof ArrayBuffer)
        || storage.byteLength
            !== GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA.STRIDE
                * capacity) {
        throw new RangeError('ability entity metadata storage 크기가 다릅니다.');
    }
    const index = requireSlot(slot, capacity, 'metadata slot');
    const layout = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA;
    const offset = index * layout.STRIDE;
    const view = new DataView(storage);
    const values = [
        [layout.ABI_VERSION, metadata.abiVersion],
        [layout.NOUN_MASK, metadata.nounMask],
        [layout.DEFINITION_CODE, metadata.definitionCode],
        [layout.OWNER_ENTITY_ID, metadata.ownerEntityId],
        [layout.OWNER_INCARNATION, metadata.ownerIncarnation],
        [layout.SOURCE_ABILITY_CODE, metadata.sourceAbilityCode],
        [layout.SOURCE_EXECUTION_FINGERPRINT,
            metadata.sourceExecutionFingerprint],
        [layout.SOURCE_EXECUTION_ORDINAL, metadata.sourceExecutionOrdinal],
        [layout.GENERATION, metadata.generation],
        [layout.VISIBLE_FROM_EXECUTION_ORDINAL,
            metadata.visibleFromExecutionOrdinal],
        [layout.CREATION_ORIGIN_CODE, metadata.creationOriginCode],
        [layout.POWER_FIXED_POINT, metadata.powerFixedPoint]
    ];
    for (const [fieldOffset, value] of values) {
        view.setUint32(
            offset + fieldOffset,
            requireUint32(value, `metadata@${fieldOffset}`),
            LITTLE_ENDIAN
        );
    }
    if (view.getUint32(offset + layout.ABI_VERSION, LITTLE_ENDIAN)
        !== ABILITY_ENTITY_METADATA_ABI_VERSION) {
        throw new RangeError('ability entity metadata ABI version이 다릅니다.');
    }
    return storage;
}

export function clearGpuAbilityEntityMetadata(storage, capacity, slot) {
    const index = requireSlot(slot, capacity, 'metadata slot');
    new Uint8Array(
        storage,
        index * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA.STRIDE,
        GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA.STRIDE
    ).fill(0);
}

export function writeGpuAbilityExecutionCommand(
    storage,
    commandIndex,
    command,
    protocol,
    output
) {
    const layout = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.COMMAND;
    const offset = requireUint32(commandIndex, 'commandIndex') * layout.STRIDE;
    if (!(storage instanceof ArrayBuffer)
        || offset + layout.STRIDE > storage.byteLength) {
        throw new RangeError('ability command storage가 작습니다.');
    }
    const view = new DataView(storage);
    const uintValues = [
        [layout.ABI_VERSION, ABILITY_EXECUTION_COMMAND_ABI_VERSION],
        [layout.SESSION_GENERATION, protocol.sessionGeneration],
        [layout.DEVICE_GENERATION, protocol.deviceGeneration],
        [layout.AUTHORITATIVE_EPOCH, protocol.authoritativeEpoch],
        [layout.TARGET_FIXED_TICK, command.targetFixedTick],
        [layout.EXECUTION_ORDINAL, command.executionOrdinal],
        [layout.SELECTOR_CODE, command.selectorCode],
        [layout.NOUN_MASK, command.nounMask],
        [layout.TEAM_ID, command.teamId],
        [layout.SUBJECT_LIMIT, command.subjectLimit],
        [layout.GENERATION_LIMIT, command.generationLimit],
        [layout.COMPILED_ABILITY_CODE, command.compiledAbilityCode],
        [layout.EXECUTION_ID_FINGERPRINT, command.executionIdFingerprint],
        [layout.COMMAND_FINGERPRINT, command.fingerprint],
        [layout.ACTION_CODE, command.actionCode],
        [layout.PAYLOAD_CODE, command.payloadCode],
        [layout.TARGET_POLICY_CODE, command.targetPolicyCode],
        [layout.OUTPUT_SLOT, output.outputSlot],
        [layout.SNAPSHOT_CAPACITY, output.snapshotCapacity],
        [layout.AGGREGATE_WORD_OFFSET, output.aggregateWordOffset],
        [layout.SNAPSHOT_WORD_OFFSET, output.snapshotWordOffset],
        [layout.IDENTITY_WORD_OFFSET, output.identityWordOffset]
    ];
    for (const [fieldOffset, value] of uintValues) {
        view.setUint32(
            offset + fieldOffset,
            requireUint32(value, `command@${fieldOffset}`),
            LITTLE_ENDIAN
        );
    }
    view.setFloat32(offset + layout.AIM_POINT_X, command.aimPoint.x, LITTLE_ENDIAN);
    view.setFloat32(offset + layout.AIM_POINT_Y, command.aimPoint.y, LITTLE_ENDIAN);
    return storage;
}

export function readGpuAbilitySubjectAggregate(buffer) {
    if (!(buffer instanceof ArrayBuffer)
        || buffer.byteLength
            < GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.AGGREGATE.STRIDE) {
        throw new RangeError('ability aggregate readback이 짧습니다.');
    }
    const layout = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.AGGREGATE;
    const view = new DataView(buffer);
    const result = Object.freeze({
        abiVersion: view.getUint32(layout.ABI_VERSION, LITTLE_ENDIAN),
        bodyAbiVersion: view.getUint32(layout.BODY_ABI_VERSION, LITTLE_ENDIAN),
        sessionGeneration: view.getUint32(
            layout.SESSION_GENERATION,
            LITTLE_ENDIAN
        ),
        deviceGeneration: view.getUint32(
            layout.DEVICE_GENERATION,
            LITTLE_ENDIAN
        ),
        authoritativeEpoch: view.getUint32(
            layout.AUTHORITATIVE_EPOCH,
            LITTLE_ENDIAN
        ),
        sourceTick: view.getUint32(layout.SOURCE_TICK, LITTLE_ENDIAN),
        executionOrdinal: view.getUint32(
            layout.EXECUTION_ORDINAL,
            LITTLE_ENDIAN
        ),
        status: view.getUint32(layout.STATUS, LITTLE_ENDIAN),
        subjectCount: view.getUint32(layout.SUBJECT_COUNT, LITTLE_ENDIAN),
        capacityDemand: view.getUint32(
            layout.CAPACITY_DEMAND,
            LITTLE_ENDIAN
        ),
        subjectLimit: view.getUint32(layout.SUBJECT_LIMIT, LITTLE_ENDIAN),
        commandFingerprint: view.getUint32(
            layout.COMMAND_FINGERPRINT,
            LITTLE_ENDIAN
        ),
        snapshotFingerprint: view.getUint32(
            layout.SNAPSHOT_FINGERPRINT,
            LITTLE_ENDIAN
        ),
        errorFlags: view.getUint32(layout.ERROR_FLAGS, LITTLE_ENDIAN),
        outputSlot: view.getUint32(layout.OUTPUT_SLOT, LITTLE_ENDIAN),
        generationLimit: view.getUint32(
            layout.GENERATION_LIMIT,
            LITTLE_ENDIAN
        )
    });
    const knownStatuses = new Set(Object.values(ABILITY_SUBJECT_SNAPSHOT_STATUS));
    const knownErrors = Object.values(ABILITY_SUBJECT_SNAPSHOT_ERROR_FLAG)
        .reduce((mask, value) => mask | value, 0);
    if (result.abiVersion !== GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION
        || result.bodyAbiVersion !== GPU_CIRCLE_BODY_ABI_VERSION
        || !knownStatuses.has(result.status)
        || (result.errorFlags & ~knownErrors) !== 0) {
        throw new RangeError('ability aggregate ABI/status가 올바르지 않습니다.');
    }
    return result;
}

/** Tower Merge 전용 bounded identity-only readback을 exact 원소 배열로 해석합니다. */
export function readGpuAbilitySubjectIdentities(
    buffer,
    subjectCount,
    options = {}
) {
    if (!(buffer instanceof ArrayBuffer) && !ArrayBuffer.isView(buffer)) {
        throw new TypeError('ability subject identity readback이 필요합니다.');
    }
    const source = buffer instanceof ArrayBuffer
        ? buffer
        : buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
        );
    const count = requireUint32(subjectCount, 'ability subject identity count');
    const byteOffset = requireUint32(
        options.byteOffset
            ?? GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.AGGREGATE.STRIDE,
        'ability subject identity byteOffset'
    );
    const bodyCapacity = requireUint32(
        options.bodyCapacity,
        'ability subject identity bodyCapacity'
    );
    const layout = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.IDENTITY_RECORD;
    if (bodyCapacity === 0
        || byteOffset + count * layout.STRIDE > source.byteLength) {
        throw new RangeError('ability subject identity readback 범위가 짧습니다.');
    }
    const view = new DataView(source);
    const identities = [];
    const slots = new Set();
    const handles = new Set();
    for (let index = 0; index < count; index++) {
        const offset = byteOffset + index * layout.STRIDE;
        const privateSlot = view.getUint32(
            offset + layout.PRIVATE_SLOT,
            LITTLE_ENDIAN
        );
        const entityId = view.getUint32(
            offset + layout.ENTITY_ID,
            LITTLE_ENDIAN
        );
        const incarnation = view.getUint32(
            offset + layout.INCARNATION,
            LITTLE_ENDIAN
        );
        const handle = `${entityId}:${incarnation}`;
        if (privateSlot >= bodyCapacity
            || entityId === 0
            || incarnation === 0
            || slots.has(privateSlot)
            || handles.has(handle)) {
            throw new RangeError('ability subject exact identity가 중복되거나 잘못됐습니다.');
        }
        slots.add(privateSlot);
        handles.add(handle);
        identities.push(Object.freeze({
            privateSlot,
            entityId,
            incarnation
        }));
    }
    for (let index = 1; index < identities.length; index++) {
        if (identities[index - 1].privateSlot >= identities[index].privateSlot) {
            throw new RangeError('ability subject exact identity slot 순서가 다릅니다.');
        }
    }
    const commandFingerprint = requireUint32(
        options.commandFingerprint,
        'ability subject identity commandFingerprint'
    );
    const snapshotFingerprint = requireUint32(
        options.snapshotFingerprint,
        'ability subject identity snapshotFingerprint'
    );
    if (commandFingerprint === 0
        || computeTowerMergeSnapshotIdentityFingerprint(
            commandFingerprint,
            identities
        ) !== snapshotFingerprint) {
        throw new RangeError('ability subject exact identity fingerprint가 다릅니다.');
    }
    return Object.freeze(identities);
}

export {
    ABILITY_ENTITY_METADATA_ABI_VERSION,
    ABILITY_EXECUTION_COMMAND_ABI_VERSION,
    ABILITY_SUBJECT_SNAPSHOT_ERROR_FLAG,
    ABILITY_SUBJECT_SNAPSHOT_STATUS
};
