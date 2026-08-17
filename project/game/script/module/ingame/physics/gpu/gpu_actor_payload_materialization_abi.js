import {
    ACTOR_PAYLOAD_MATERIALIZATION_STATUS,
    hasOnlyKnownActorPayloadErrorFlags,
    isKnownActorPayloadMaterializationStatus
} from '../../contract/actor_payload_contract.js';
import { GPU_CIRCLE_BODY_ABI_VERSION } from './gpu_circle_body_abi.js';
import {
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION
} from './gpu_ability_subject_snapshot_abi.js';

const LITTLE_ENDIAN = true;

export const GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI_VERSION = 2;

export const GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI = Object.freeze({
    LEASE_HEADER: Object.freeze({
        STRIDE: 176,
        ABI_VERSION: 0,
        SNAPSHOT_ABI_VERSION: 4,
        BODY_ABI_VERSION: 8,
        SESSION_GENERATION: 12,
        DEVICE_GENERATION: 16,
        AUTHORITATIVE_EPOCH: 20,
        SNAPSHOT_SOURCE_TICK: 24,
        MATERIALIZATION_TARGET_TICK: 28,
        EXECUTION_ORDINAL: 32,
        COMMAND_FINGERPRINT: 36,
        SNAPSHOT_FINGERPRINT: 40,
        SUBJECT_COUNT: 44,
        PAYLOAD_DEFINITION_CODE: 48,
        PAYLOAD_NOUN_MASK: 52,
        PAYLOAD_TEAM_ID: 56,
        CREATION_ORIGIN_CODE: 60,
        SOURCE_ABILITY_CODE: 64,
        SOURCE_EXECUTION_FINGERPRINT: 68,
        SOURCE_SELECTOR_CODE: 72,
        ACTION_CODE: 76,
        PAYLOAD_CODE: 80,
        TARGET_POLICY_CODE: 84,
        TOWER_SLOT: 88,
        TOWER_ENTITY_ID: 92,
        TOWER_INCARNATION: 96,
        CORE_SLOT: 100,
        CORE_ENTITY_ID: 104,
        CORE_INCARNATION: 108,
        SDF_COLS: 112,
        SDF_ROWS: 116,
        SDF_ENABLED: 120,
        WORLD_WIDTH: 124,
        WORLD_HEIGHT: 128,
        AIM_POINT_X: 132,
        AIM_POINT_Y: 136,
        LAUNCH_SPEED: 140,
        SURFACE_GAP: 144,
        DEFAULT_FLOW_FIELD_INDEX: 148,
        GENERATION_LIMIT: 152,
        SNAPSHOT_WORD_OFFSET: 156,
        DEFAULT_CURRENT_PATH_INDEX: 160,
        DEFAULT_ROUTE_SET_INDEX: 164,
        RESERVED: 168,
        RESERVED_1: 172
    }),
    DESTINATION_LEASE: Object.freeze({
        STRIDE: 32,
        DESTINATION_SLOT: 0,
        DESTINATION_ENTITY_ID: 4,
        DESTINATION_INCARNATION: 8,
        SNAPSHOT_RANK: 12,
        BASELINE_FLAGS: 16,
        DEFAULT_ROUTE_META: 20,
        DEFAULT_ROUTE_PROFILE_CODE: 24,
        RESERVED: 28
    }),
    AGGREGATE: Object.freeze({
        STRIDE: 64,
        ABI_VERSION: 0,
        BODY_ABI_VERSION: 4,
        SESSION_GENERATION: 8,
        DEVICE_GENERATION: 12,
        AUTHORITATIVE_EPOCH: 16,
        SNAPSHOT_SOURCE_TICK: 20,
        MATERIALIZATION_TARGET_TICK: 24,
        EXECUTION_ORDINAL: 28,
        STATUS: 32,
        SUBJECT_COUNT: 36,
        MATERIALIZED_COUNT: 40,
        COMMAND_FINGERPRINT: 44,
        SNAPSHOT_FINGERPRINT: 48,
        DESTINATION_FINGERPRINT: 52,
        ERROR_FLAGS: 56,
        RESERVED: 60
    }),
    VALIDATION_RECORD: Object.freeze({
        STRIDE: 32,
        ERROR_FLAGS: 0,
        POSITION_X: 4,
        POSITION_Y: 8,
        DIRECTION_X: 12,
        DIRECTION_Y: 16,
        RESERVED_0: 20,
        RESERVED_1: 24,
        RESERVED_2: 28
    })
});

function requireUint32(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
        throw new RangeError(`${label}은 uint32여야 합니다.`);
    }
    return number >>> 0;
}

function requirePositiveFloat32(value, label) {
    const number = Math.fround(Number(value));
    if (!Number.isFinite(number) || !(number > 0)) {
        throw new RangeError(`${label}은 양의 finite float32여야 합니다.`);
    }
    return number;
}

function requireFiniteFloat32(value, label) {
    const number = Math.fround(Number(value));
    if (!Number.isFinite(number)) {
        throw new RangeError(`${label}은 finite float32여야 합니다.`);
    }
    return number;
}

export function createGpuActorPayloadLeaseStorage(destinationCount) {
    const count = requireUint32(destinationCount, 'destinationCount');
    if (count <= 0) {
        throw new RangeError('destinationCount는 양수여야 합니다.');
    }
    return new ArrayBuffer(
        GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.LEASE_HEADER.STRIDE
            + count
                * GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI
                    .DESTINATION_LEASE.STRIDE
    );
}

export function writeGpuActorPayloadLeaseHeader(storage, source) {
    const h = GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.LEASE_HEADER;
    if (!(storage instanceof ArrayBuffer) || storage.byteLength < h.STRIDE) {
        throw new RangeError('actor payload lease storage가 짧습니다.');
    }
    const view = new DataView(storage);
    const uintValues = [
        [h.ABI_VERSION, GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI_VERSION],
        [h.SNAPSHOT_ABI_VERSION, GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION],
        [h.BODY_ABI_VERSION, GPU_CIRCLE_BODY_ABI_VERSION],
        [h.SESSION_GENERATION, source.sessionGeneration],
        [h.DEVICE_GENERATION, source.deviceGeneration],
        [h.AUTHORITATIVE_EPOCH, source.authoritativeEpoch],
        [h.SNAPSHOT_SOURCE_TICK, source.snapshotSourceTick],
        [h.MATERIALIZATION_TARGET_TICK, source.materializationTargetTick],
        [h.EXECUTION_ORDINAL, source.executionOrdinal],
        [h.COMMAND_FINGERPRINT, source.commandFingerprint],
        [h.SNAPSHOT_FINGERPRINT, source.snapshotFingerprint],
        [h.SUBJECT_COUNT, source.subjectCount],
        [h.PAYLOAD_DEFINITION_CODE, source.payloadDefinitionCode],
        [h.PAYLOAD_NOUN_MASK, source.payloadNounMask],
        [h.PAYLOAD_TEAM_ID, source.payloadTeamId],
        [h.CREATION_ORIGIN_CODE, source.creationOriginCode],
        [h.SOURCE_ABILITY_CODE, source.sourceAbilityCode],
        [h.SOURCE_EXECUTION_FINGERPRINT,
            source.sourceExecutionFingerprint],
        [h.SOURCE_SELECTOR_CODE, source.sourceSelectorCode],
        [h.ACTION_CODE, source.actionCode],
        [h.PAYLOAD_CODE, source.payloadCode],
        [h.TARGET_POLICY_CODE, source.targetPolicyCode],
        [h.TOWER_SLOT, source.towerSlot ?? 0xffffffff],
        [h.TOWER_ENTITY_ID, source.towerEntityId ?? 0xffffffff],
        [h.TOWER_INCARNATION, source.towerIncarnation ?? 0xffffffff],
        [h.CORE_SLOT, source.coreSlot ?? 0xffffffff],
        [h.CORE_ENTITY_ID, source.coreEntityId ?? 0xffffffff],
        [h.CORE_INCARNATION, source.coreIncarnation ?? 0xffffffff],
        [h.SDF_COLS, source.sdfCols],
        [h.SDF_ROWS, source.sdfRows],
        [h.SDF_ENABLED, source.sdfEnabled === true ? 1 : 0],
        [h.DEFAULT_FLOW_FIELD_INDEX, source.defaultFlowFieldIndex],
        [h.GENERATION_LIMIT, source.generationLimit],
        [h.SNAPSHOT_WORD_OFFSET, source.snapshotWordOffset],
        [h.DEFAULT_CURRENT_PATH_INDEX, source.defaultCurrentPathIndex],
        [h.DEFAULT_ROUTE_SET_INDEX, source.defaultRouteSetIndex],
        [h.RESERVED, 0],
        [h.RESERVED_1, 0]
    ];
    for (const [offset, value] of uintValues) {
        view.setUint32(
            offset,
            requireUint32(value, `actorPayload.header@${offset}`),
            LITTLE_ENDIAN
        );
    }
    const floatValues = [
        [h.WORLD_WIDTH, requirePositiveFloat32(source.worldWidth, 'worldWidth')],
        [h.WORLD_HEIGHT,
            requirePositiveFloat32(source.worldHeight, 'worldHeight')],
        [h.AIM_POINT_X, requireFiniteFloat32(source.aimPoint?.x, 'aimPoint.x')],
        [h.AIM_POINT_Y, requireFiniteFloat32(source.aimPoint?.y, 'aimPoint.y')],
        [h.LAUNCH_SPEED,
            requirePositiveFloat32(source.launchSpeed, 'launchSpeed')],
        [h.SURFACE_GAP,
            requirePositiveFloat32(source.surfaceGap, 'surfaceGap')]
    ];
    for (const [offset, value] of floatValues) {
        view.setFloat32(offset, value, LITTLE_ENDIAN);
    }
    return storage;
}

export function writeGpuActorPayloadDestinationLease(
    storage,
    destinationCount,
    index,
    source
) {
    const count = requireUint32(destinationCount, 'destinationCount');
    const rank = requireUint32(index, 'destinationLease index');
    const h = GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.LEASE_HEADER;
    const r = GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.DESTINATION_LEASE;
    if (rank >= count
        || !(storage instanceof ArrayBuffer)
        || storage.byteLength !== h.STRIDE + count * r.STRIDE) {
        throw new RangeError('actor payload destination lease storage가 다릅니다.');
    }
    const base = h.STRIDE + rank * r.STRIDE;
    const view = new DataView(storage);
    const values = [
        [r.DESTINATION_SLOT, source.destinationSlot],
        [r.DESTINATION_ENTITY_ID, source.destinationEntityId],
        [r.DESTINATION_INCARNATION, source.destinationIncarnation],
        [r.SNAPSHOT_RANK, source.snapshotRank],
        [r.BASELINE_FLAGS, source.baselineFlags],
        [r.DEFAULT_ROUTE_META, source.defaultRouteMeta ?? 0],
        [r.DEFAULT_ROUTE_PROFILE_CODE,
            source.defaultRouteProfileCode ?? 0],
        [r.RESERVED, 0]
    ];
    for (const [offset, value] of values) {
        view.setUint32(
            base + offset,
            requireUint32(value, `actorPayload.lease[${rank}]@${offset}`),
            LITTLE_ENDIAN
        );
    }
    return storage;
}

export function readGpuActorPayloadMaterializationAggregate(buffer) {
    const a = GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.AGGREGATE;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < a.STRIDE) {
        throw new RangeError('actor payload aggregate readback이 짧습니다.');
    }
    const view = new DataView(buffer);
    const result = Object.freeze({
        abiVersion: view.getUint32(a.ABI_VERSION, LITTLE_ENDIAN),
        bodyAbiVersion: view.getUint32(a.BODY_ABI_VERSION, LITTLE_ENDIAN),
        sessionGeneration: view.getUint32(a.SESSION_GENERATION, LITTLE_ENDIAN),
        deviceGeneration: view.getUint32(a.DEVICE_GENERATION, LITTLE_ENDIAN),
        authoritativeEpoch: view.getUint32(
            a.AUTHORITATIVE_EPOCH,
            LITTLE_ENDIAN
        ),
        snapshotSourceTick: view.getUint32(
            a.SNAPSHOT_SOURCE_TICK,
            LITTLE_ENDIAN
        ),
        materializationTargetTick: view.getUint32(
            a.MATERIALIZATION_TARGET_TICK,
            LITTLE_ENDIAN
        ),
        executionOrdinal: view.getUint32(a.EXECUTION_ORDINAL, LITTLE_ENDIAN),
        status: view.getUint32(a.STATUS, LITTLE_ENDIAN),
        subjectCount: view.getUint32(a.SUBJECT_COUNT, LITTLE_ENDIAN),
        materializedCount: view.getUint32(
            a.MATERIALIZED_COUNT,
            LITTLE_ENDIAN
        ),
        commandFingerprint: view.getUint32(
            a.COMMAND_FINGERPRINT,
            LITTLE_ENDIAN
        ),
        snapshotFingerprint: view.getUint32(
            a.SNAPSHOT_FINGERPRINT,
            LITTLE_ENDIAN
        ),
        destinationFingerprint: view.getUint32(
            a.DESTINATION_FINGERPRINT,
            LITTLE_ENDIAN
        ),
        errorFlags: view.getUint32(a.ERROR_FLAGS, LITTLE_ENDIAN)
    });
    if (result.abiVersion
            !== GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI_VERSION
        || result.bodyAbiVersion !== GPU_CIRCLE_BODY_ABI_VERSION
        || !isKnownActorPayloadMaterializationStatus(result.status)
        || !hasOnlyKnownActorPayloadErrorFlags(result.errorFlags)) {
        throw new RangeError('actor payload aggregate ABI/status가 잘못됐습니다.');
    }
    if (result.status === ACTOR_PAYLOAD_MATERIALIZATION_STATUS.COMPLETE
        && (result.subjectCount <= 0
            || result.materializedCount !== result.subjectCount
            || result.errorFlags !== 0)) {
        throw new RangeError('complete actor payload aggregate가 일관되지 않습니다.');
    }
    return result;
}
