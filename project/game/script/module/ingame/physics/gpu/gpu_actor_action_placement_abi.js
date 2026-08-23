import {
    ACTOR_ACTION_ACTIVATION_POLICY,
    ACTOR_ACTION_PLACEMENT_POLICY,
    ACTOR_ACTION_PROFILE_ABI_VERSION,
    ACTOR_ACTION_SPAWN_ANCHOR_POLICY,
    ACTOR_ACTION_TARGET_SNAPSHOT_POLICY,
    ACTOR_ACTION_TRANSIT_POLICY,
    normalizeActorActionProfile
} from '../../contract/actor_action_contract.js';
import {
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION
} from './gpu_ability_subject_snapshot_abi.js';
import { GPU_CIRCLE_BODY_ABI_VERSION } from './gpu_circle_body_abi.js';
import { GPU_TOWER_GROUP_ABI_VERSION } from './gpu_tower_group_abi.js';

const LITTLE_ENDIAN = true;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const UINT32_MAX = 0xffffffff;

export const GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION = 3;

export const GPU_ACTOR_ACTION_PLACEMENT_STATUS = Object.freeze({
    PENDING: 1,
    COMPLETE: 2,
    SDF_REJECTED: 3,
    PROTOCOL_REJECTED: 4,
    CANCELLED: 5
});

export const GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS = Object.freeze({
    UNINITIALIZED: 0,
    RESOLVED: 1,
    VALID: 2,
    INVALID: 3
});

export const GPU_ACTOR_ACTION_TARGET_KIND = Object.freeze({
    AIM: 1,
    TOWER: 2,
    CORE: 3,
    FACING: 4
});

export const GPU_ACTOR_ACTION_TRANSIT_PHASE = Object.freeze({
    ACTIVATION_PENDING: 1,
    AIRBORNE: 2
});

export const GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG = Object.freeze({
    HEADER_ABI: 1 << 0,
    SNAPSHOT_ABI: 1 << 1,
    BODY_ABI: 1 << 2,
    PROFILE_ABI: 1 << 3,
    SOURCE_RECORD: 1 << 4,
    DESTINATION_IDENTITY: 1 << 5,
    PROFILE_CONTRACT: 1 << 6,
    TARGET_IDENTITY: 1 << 7,
    NON_FINITE: 1 << 8,
    SDF_PLACEMENT: 1 << 9,
    GENERATION: 1 << 10,
    TOWER_ROSTER: 1 << 11,
    FINGERPRINT: 1 << 12,
    EXISTING_BODY_OVERLAP: 1 << 13,
    SIBLING_BODY_OVERLAP: 1 << 14,
    GRID_CELL_CAPACITY: 1 << 15,
    NO_VALID_GLOBAL_PLACEMENT: 1 << 16
});

export const GPU_ACTOR_ACTION_SPAWN_ANCHOR_CODE = Object.freeze({
    SOURCE_SURFACE: 1,
    TARGET_POINT: 2
});

export const GPU_ACTOR_ACTION_TARGET_SNAPSHOT_CODE = Object.freeze({
    CAST_START: 1
});

export const GPU_ACTOR_ACTION_ACTIVATION_CODE = Object.freeze({
    NEXT_FIXED_TICK: 1,
    ON_LANDING: 2
});

export const GPU_ACTOR_ACTION_PLACEMENT_POLICY_CODE = Object.freeze({
    SOURCE_SURFACE_ATOMIC_SDF: 1,
    TARGET_LATTICE_ATOMIC_SDF: 2,
    SOURCE_AND_LANDING_ATOMIC_SDF: 3
});

export const GPU_ACTOR_ACTION_TRANSIT_CODE = Object.freeze({
    NONE: 0,
    AIRBORNE_GROUND_PATH: 1
});

export const GPU_ACTOR_ACTION_TRANSIT_FLAG = Object.freeze({
    SUSPEND_CONTROL: 1 << 0,
    SUSPEND_SUBJECT_SELECTION: 1 << 1,
    SUSPEND_TARGET_ACCEPTANCE: 1 << 2,
    SUPPRESS_CONTACT: 1 << 3
});

export const GPU_ACTOR_ACTION_PLACEMENT_ABI = Object.freeze({
    PROGRAM_HEADER: Object.freeze({
        STRIDE: 224,
        ABI_VERSION: 0,
        SNAPSHOT_ABI_VERSION: 4,
        BODY_ABI_VERSION: 8,
        PROFILE_ABI_VERSION: 12,
        SESSION_GENERATION: 16,
        DEVICE_GENERATION: 20,
        AUTHORITATIVE_EPOCH: 24,
        SNAPSHOT_SOURCE_TICK: 28,
        PLACEMENT_TARGET_TICK: 32,
        EXECUTION_ORDINAL: 36,
        COMMAND_FINGERPRINT: 40,
        SNAPSHOT_FINGERPRINT: 44,
        DESTINATION_FINGERPRINT: 48,
        SUBJECT_COUNT: 52,
        SOURCE_SELECTOR_CODE: 56,
        ACTION_CODE: 60,
        PROFILE_CODE: 64,
        PAYLOAD_CODE: 68,
        TARGET_POLICY_CODE: 72,
        SNAPSHOT_WORD_OFFSET: 76,
        GENERATION_LIMIT: 80,
        CORE_SLOT: 84,
        CORE_ENTITY_ID: 88,
        CORE_INCARNATION: 92,
        SDF_COLS: 96,
        SDF_ROWS: 100,
        SDF_ENABLED: 104,
        TOWER_MEMBER_CAPACITY: 108,
        AIM_POINT_X: 112,
        AIM_POINT_Y: 116,
        WORLD_WIDTH: 120,
        WORLD_HEIGHT: 124,
        SPAWN_ANCHOR_CODE: 128,
        TARGET_SNAPSHOT_CODE: 132,
        ACTIVATION_CODE: 136,
        PLACEMENT_POLICY_CODE: 140,
        TRANSIT_CODE: 144,
        TRANSIT_FLAGS: 148,
        LAUNCH_SPEED: 152,
        TRAVEL_SPEED: 156,
        TRAVEL_DURATION_FIXED_TICKS: 160,
        SURFACE_GAP: 164,
        SUMMON_LATTICE_SPACING: 168,
        PRESENTATION_ARC_HEIGHT: 172,
        PROFILE_FINGERPRINT: 176,
        PLACEMENT_WORD_OFFSET: 180,
        TRANSIT_WORD_OFFSET: 184,
        OUTPUT_WORD_CAPACITY: 188,
        TOWER_GROUP_ABI_VERSION: 192,
        FIXED_HZ: 196,
        PLACEMENT_RECORD_WORDS: 200,
        TRANSIT_RECORD_WORDS: 204,
        DESTINATION_COUNT: 208,
        COPIES_PER_SUBJECT: 212,
        MODIFIER_SET_FINGERPRINT: 216,
        RESERVED_3: 220
    }),
    DESTINATION_LEASE: Object.freeze({
        STRIDE: 32,
        DESTINATION_SLOT: 0,
        DESTINATION_ENTITY_ID: 4,
        DESTINATION_INCARNATION: 8,
        SNAPSHOT_RANK: 12,
        DESTINATION_RANK: 16,
        BASELINE_FLAGS: 20,
        COPY_INDEX: 24,
        RESERVED_1: 28
    }),
    AGGREGATE: Object.freeze({
        STRIDE: 112,
        ABI_VERSION: 0,
        SNAPSHOT_ABI_VERSION: 4,
        BODY_ABI_VERSION: 8,
        PROFILE_ABI_VERSION: 12,
        SESSION_GENERATION: 16,
        DEVICE_GENERATION: 20,
        AUTHORITATIVE_EPOCH: 24,
        SNAPSHOT_SOURCE_TICK: 28,
        PLACEMENT_TARGET_TICK: 32,
        EXECUTION_ORDINAL: 36,
        STATUS: 40,
        SUBJECT_COUNT: 44,
        DESTINATION_COUNT: 48,
        VALID_COUNT: 52,
        COMMAND_FINGERPRINT: 56,
        SNAPSHOT_FINGERPRINT: 60,
        DESTINATION_FINGERPRINT: 64,
        PLACEMENT_FINGERPRINT: 68,
        ERROR_FLAGS: 72,
        ACTION_CODE: 76,
        PROFILE_CODE: 80,
        PAYLOAD_CODE: 84,
        PLACEMENT_BYTE_LENGTH: 88,
        TRANSIT_BYTE_LENGTH: 92,
        PROFILE_FINGERPRINT: 96,
        COPIES_PER_SUBJECT: 100,
        MODIFIER_SET_FINGERPRINT: 104,
        RESERVED: 108
    }),
    PLACEMENT_RECORD: Object.freeze({
        STRIDE: 152,
        ABI_VERSION: 0,
        STATUS: 4,
        ERROR_FLAGS: 8,
        SOURCE_RANK: 12,
        SOURCE_SLOT: 16,
        SOURCE_ENTITY_ID: 20,
        SOURCE_INCARNATION: 24,
        DESTINATION_RANK: 28,
        DESTINATION_SLOT: 32,
        DESTINATION_ENTITY_ID: 36,
        DESTINATION_INCARNATION: 40,
        ACTION_CODE: 44,
        PROFILE_CODE: 48,
        PAYLOAD_CODE: 52,
        SPAWN_X: 56,
        SPAWN_Y: 60,
        INITIAL_VELOCITY_X: 64,
        INITIAL_VELOCITY_Y: 68,
        TARGET_X: 72,
        TARGET_Y: 76,
        ACTIVATION_TICK: 80,
        TRANSIT_DURATION_FIXED_TICKS: 84,
        SOURCE_GENERATION: 88,
        CHILD_GENERATION: 92,
        PLACEMENT_FINGERPRINT: 96,
        TARGET_KIND: 100,
        TARGET_SLOT: 104,
        TARGET_ENTITY_ID: 108,
        TARGET_INCARNATION: 112,
        SOURCE_RADIUS: 116,
        DESTINATION_RADIUS: 120,
        DIRECTION_X: 124,
        DIRECTION_Y: 128,
        COPY_INDEX: 132,
        MODIFIER_SET_FINGERPRINT: 136,
        ADMISSION_CHOSEN_CANDIDATE_INDEX: 140,
        ADMISSION_ATTEMPTED_CANDIDATE_COUNT: 144,
        ADMISSION_FAILURE_CLASS: 148
    }),
    TRANSIT_RECORD: Object.freeze({
        STRIDE: 80,
        ABI_VERSION: 0,
        PHASE: 4,
        FLAGS: 8,
        SOURCE_RANK: 12,
        DESTINATION_SLOT: 16,
        DESTINATION_ENTITY_ID: 20,
        DESTINATION_INCARNATION: 24,
        ACTION_CODE: 28,
        PROFILE_CODE: 32,
        ACTIVATION_TICK: 36,
        DURATION_FIXED_TICKS: 40,
        PROGRESS_FIXED_TICKS: 44,
        LANDING_X: 48,
        LANDING_Y: 52,
        PRESENTATION_ARC_HEIGHT: 56,
        VELOCITY_X: 60,
        VELOCITY_Y: 64,
        FINGERPRINT: 68,
        COPY_INDEX: 72,
        MODIFIER_SET_FINGERPRINT: 76
    }),
    DISPATCH_ARGS: Object.freeze({
        STRIDE: 16,
        WORKGROUP_COUNT_X: 0,
        WORKGROUP_COUNT_Y: 4,
        WORKGROUP_COUNT_Z: 8,
        RESERVED: 12
    })
});

const KNOWN_STATUS = new Set(Object.values(
    GPU_ACTOR_ACTION_PLACEMENT_STATUS
));
const KNOWN_RECORD_STATUS = new Set(Object.values(
    GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS
));
const KNOWN_ERROR_MASK = Object.values(
    GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG
).reduce((mask, value) => mask | value, 0);

function requireUint32(value, label, { positive = false } = {}) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > UINT32_MAX
        || (positive && (number === 0 || number === UINT32_MAX))) {
        throw new RangeError(`${label}은 올바른 uint32여야 합니다.`);
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

function requireNonNegativeFloat32(value, label) {
    const number = Math.fround(Number(value));
    if (!Number.isFinite(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 finite float32여야 합니다.`);
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

function enumCode(value, entries, label) {
    const code = entries.get(value);
    if (code === undefined) {
        throw new RangeError(`${label}가 GPU vocabulary에 없습니다.`);
    }
    return code;
}

function hashWord(hash, value) {
    return Math.imul((hash ^ (Number(value) >>> 0)) >>> 0, FNV_PRIME) >>> 0;
}

function nonZeroHash(value) {
    return value === 0 ? FNV_OFFSET : value >>> 0;
}

export function gpuActorActionFloat32Word(value) {
    const bytes = new ArrayBuffer(4);
    const view = new DataView(bytes);
    view.setFloat32(0, requireFiniteFloat32(value, 'float word'), LITTLE_ENDIAN);
    return view.getUint32(0, LITTLE_ENDIAN);
}

const SPAWN_ANCHOR_CODES = new Map([
    [ACTOR_ACTION_SPAWN_ANCHOR_POLICY.SOURCE_SURFACE,
        GPU_ACTOR_ACTION_SPAWN_ANCHOR_CODE.SOURCE_SURFACE],
    [ACTOR_ACTION_SPAWN_ANCHOR_POLICY.TARGET_POINT,
        GPU_ACTOR_ACTION_SPAWN_ANCHOR_CODE.TARGET_POINT]
]);
const TARGET_SNAPSHOT_CODES = new Map([
    [ACTOR_ACTION_TARGET_SNAPSHOT_POLICY.CAST_START,
        GPU_ACTOR_ACTION_TARGET_SNAPSHOT_CODE.CAST_START]
]);
const ACTIVATION_CODES = new Map([
    [ACTOR_ACTION_ACTIVATION_POLICY.NEXT_FIXED_TICK,
        GPU_ACTOR_ACTION_ACTIVATION_CODE.NEXT_FIXED_TICK],
    [ACTOR_ACTION_ACTIVATION_POLICY.ON_LANDING,
        GPU_ACTOR_ACTION_ACTIVATION_CODE.ON_LANDING]
]);
const PLACEMENT_CODES = new Map([
    [ACTOR_ACTION_PLACEMENT_POLICY.SOURCE_SURFACE_ATOMIC_SDF,
        GPU_ACTOR_ACTION_PLACEMENT_POLICY_CODE.SOURCE_SURFACE_ATOMIC_SDF],
    [ACTOR_ACTION_PLACEMENT_POLICY.TARGET_LATTICE_ATOMIC_SDF,
        GPU_ACTOR_ACTION_PLACEMENT_POLICY_CODE.TARGET_LATTICE_ATOMIC_SDF],
    [ACTOR_ACTION_PLACEMENT_POLICY.SOURCE_AND_LANDING_ATOMIC_SDF,
        GPU_ACTOR_ACTION_PLACEMENT_POLICY_CODE.SOURCE_AND_LANDING_ATOMIC_SDF]
]);
const TRANSIT_CODES = new Map([
    [ACTOR_ACTION_TRANSIT_POLICY.NONE,
        GPU_ACTOR_ACTION_TRANSIT_CODE.NONE],
    [ACTOR_ACTION_TRANSIT_POLICY.AIRBORNE_GROUND_PATH,
        GPU_ACTOR_ACTION_TRANSIT_CODE.AIRBORNE_GROUND_PATH]
]);

export function encodeGpuActorActionProfile(source) {
    const profile = normalizeActorActionProfile(source);
    let transitFlags = 0;
    if (profile.transit.suspendControl) {
        transitFlags |= GPU_ACTOR_ACTION_TRANSIT_FLAG.SUSPEND_CONTROL;
    }
    if (profile.transit.suspendSubjectSelection) {
        transitFlags |= GPU_ACTOR_ACTION_TRANSIT_FLAG.SUSPEND_SUBJECT_SELECTION;
    }
    if (profile.transit.suspendTargetAcceptance) {
        transitFlags |= GPU_ACTOR_ACTION_TRANSIT_FLAG.SUSPEND_TARGET_ACCEPTANCE;
    }
    if (profile.transit.suppressContact) {
        transitFlags |= GPU_ACTOR_ACTION_TRANSIT_FLAG.SUPPRESS_CONTACT;
    }
    const encoded = {
        abiVersion: ACTOR_ACTION_PROFILE_ABI_VERSION,
        actionCode: profile.actionCode,
        profileCode: profile.actionCode,
        spawnAnchorCode: enumCode(
            profile.spawnAnchorPolicy,
            SPAWN_ANCHOR_CODES,
            'spawnAnchorPolicy'
        ),
        targetSnapshotCode: enumCode(
            profile.targetSnapshotPolicy,
            TARGET_SNAPSHOT_CODES,
            'targetSnapshotPolicy'
        ),
        activationCode: enumCode(
            profile.activationPolicy,
            ACTIVATION_CODES,
            'activationPolicy'
        ),
        placementPolicyCode: enumCode(
            profile.placementPolicy,
            PLACEMENT_CODES,
            'placementPolicy'
        ),
        transitCode: enumCode(
            profile.transit.policy,
            TRANSIT_CODES,
            'transit.policy'
        ),
        transitFlags: transitFlags >>> 0,
        launchSpeed: profile.launchSpeed,
        travelSpeed: profile.travelSpeed,
        travelDurationFixedTicks: profile.travelDurationFixedTicks,
        surfaceGap: profile.surfaceGap,
        summonLatticeSpacing: profile.summonLatticeSpacing,
        presentationArcHeight: profile.presentationArcHeight
    };
    return Object.freeze({
        profile,
        ...encoded,
        actorActionProfileFingerprint:
            profile.actorActionProfileFingerprint,
        fingerprint: profile.actorActionProfileFingerprint
    });
}

export function computeGpuActorActionDestinationFingerprint(
    destinationLeases,
    commandFingerprint,
    options = {}
) {
    if (!Array.isArray(destinationLeases) || destinationLeases.length === 0) {
        throw new TypeError('destinationLeases는 비어 있지 않은 배열이어야 합니다.');
    }
    const subjectCount = requireUint32(
        options.subjectCount ?? destinationLeases.length,
        'subjectCount',
        { positive: true }
    );
    const copiesPerSubject = requireUint32(
        options.copiesPerSubject ?? 1,
        'copiesPerSubject',
        { positive: true }
    );
    if (subjectCount > Math.floor(UINT32_MAX / copiesPerSubject)
        || subjectCount * copiesPerSubject !== destinationLeases.length) {
        throw new RangeError('destination lease cardinality가 일관되지 않습니다.');
    }
    const modifierSetFingerprint = requireUint32(
        options.modifierSetFingerprint ?? 0,
        'modifierSetFingerprint'
    );
    let hash = hashWord(FNV_OFFSET, requireUint32(
        commandFingerprint,
        'commandFingerprint',
        { positive: true }
    ));
    hash = hashWord(hash, subjectCount);
    hash = hashWord(hash, destinationLeases.length);
    hash = hashWord(hash, copiesPerSubject);
    hash = hashWord(hash, modifierSetFingerprint);
    destinationLeases.forEach((lease, index) => {
        const snapshotRank = requireUint32(
            lease.snapshotRank,
            `destinationLeases[${index}].snapshotRank`
        );
        const destinationRank = requireUint32(
            lease.destinationRank ?? index,
            `destinationLeases[${index}].destinationRank`
        );
        const copyIndex = requireUint32(
            lease.copyIndex ?? 0,
            `destinationLeases[${index}].copyIndex`
        );
        if (snapshotRank !== Math.floor(index / copiesPerSubject)
            || destinationRank !== index
            || copyIndex !== index % copiesPerSubject) {
            throw new RangeError('destination lease multiplicity rank가 일관되지 않습니다.');
        }
        for (const word of [
            requireUint32(lease.destinationSlot,
                `destinationLeases[${index}].destinationSlot`),
            requireUint32(lease.destinationEntityId,
                `destinationLeases[${index}].destinationEntityId`,
                { positive: true }),
            requireUint32(lease.destinationIncarnation,
                `destinationLeases[${index}].destinationIncarnation`,
                { positive: true }),
            snapshotRank,
            destinationRank,
            copyIndex
        ]) {
            hash = hashWord(hash, word);
        }
    });
    return nonZeroHash(hash);
}

export function createGpuActorActionPlacementOutputLayout(
    subjectCount,
    destinationCount = subjectCount
) {
    const count = requireUint32(subjectCount, 'subjectCount', { positive: true });
    const destinations = requireUint32(
        destinationCount,
        'destinationCount',
        { positive: true }
    );
    const aggregateByteOffset = 0;
    const placementByteOffset
        = GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.STRIDE;
    const placementByteLength = destinations
        * GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.STRIDE;
    const transitByteOffset = placementByteOffset + placementByteLength;
    const transitByteLength = destinations
        * GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.STRIDE;
    const byteLength = transitByteOffset + transitByteLength;
    return Object.freeze({
        subjectCount: count,
        destinationCount: destinations,
        aggregateByteOffset,
        placementByteOffset,
        placementByteLength,
        transitByteOffset,
        transitByteLength,
        byteLength,
        placementWordOffset: placementByteOffset / 4,
        transitWordOffset: transitByteOffset / 4,
        outputWordCapacity: byteLength / 4
    });
}

export function createGpuActorActionProgramStorage(destinationCount) {
    const count = requireUint32(
        destinationCount,
        'destinationCount',
        { positive: true }
    );
    return new ArrayBuffer(
        GPU_ACTOR_ACTION_PLACEMENT_ABI.PROGRAM_HEADER.STRIDE
            + count
                * GPU_ACTOR_ACTION_PLACEMENT_ABI.DESTINATION_LEASE.STRIDE
    );
}

export function writeGpuActorActionProgramHeader(storage, source = {}) {
    const h = GPU_ACTOR_ACTION_PLACEMENT_ABI.PROGRAM_HEADER;
    if (!(storage instanceof ArrayBuffer) || storage.byteLength < h.STRIDE) {
        throw new RangeError('actor action program storage가 짧습니다.');
    }
    const subjectCount = requireUint32(
        source.subjectCount,
        'subjectCount',
        { positive: true }
    );
    const copiesPerSubject = requireUint32(
        source.copiesPerSubject ?? 1,
        'copiesPerSubject',
        { positive: true }
    );
    if (subjectCount > Math.floor(UINT32_MAX / copiesPerSubject)) {
        throw new RangeError('actor action destinationCount가 uint32를 넘습니다.');
    }
    const destinationCount = requireUint32(
        source.destinationCount ?? subjectCount,
        'destinationCount',
        { positive: true }
    );
    if (subjectCount * copiesPerSubject !== destinationCount) {
        throw new RangeError('actor action cardinality가 일관되지 않습니다.');
    }
    const modifierSetFingerprint = requireUint32(
        source.modifierSetFingerprint ?? 0,
        'modifierSetFingerprint'
    );
    const expectedByteLength = h.STRIDE + destinationCount
        * GPU_ACTOR_ACTION_PLACEMENT_ABI.DESTINATION_LEASE.STRIDE;
    if (storage.byteLength !== expectedByteLength) {
        throw new RangeError('actor action program storage 크기가 다릅니다.');
    }
    const profile = encodeGpuActorActionProfile(source.actorActionProfile);
    if (profile.actionCode !== requireUint32(source.actionCode, 'actionCode')) {
        throw new RangeError('actor action profile과 command actionCode가 다릅니다.');
    }
    if (profile.fingerprint !== requireUint32(
        source.actorActionProfileFingerprint,
        'actorActionProfileFingerprint',
        { positive: true }
    )) {
        throw new RangeError('actor action profile fingerprint가 command와 다릅니다.');
    }
    const output = createGpuActorActionPlacementOutputLayout(
        subjectCount,
        destinationCount
    );
    const view = new DataView(storage);
    const uintValues = [
        [h.ABI_VERSION, GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION],
        [h.SNAPSHOT_ABI_VERSION, GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION],
        [h.BODY_ABI_VERSION, GPU_CIRCLE_BODY_ABI_VERSION],
        [h.PROFILE_ABI_VERSION, ACTOR_ACTION_PROFILE_ABI_VERSION],
        [h.SESSION_GENERATION, source.sessionGeneration],
        [h.DEVICE_GENERATION, source.deviceGeneration],
        [h.AUTHORITATIVE_EPOCH, source.authoritativeEpoch],
        [h.SNAPSHOT_SOURCE_TICK, source.snapshotSourceTick],
        [h.PLACEMENT_TARGET_TICK, source.placementTargetTick],
        [h.EXECUTION_ORDINAL, source.executionOrdinal],
        [h.COMMAND_FINGERPRINT, source.commandFingerprint],
        [h.SNAPSHOT_FINGERPRINT, source.snapshotFingerprint],
        [h.DESTINATION_FINGERPRINT, source.destinationFingerprint],
        [h.SUBJECT_COUNT, subjectCount],
        [h.SOURCE_SELECTOR_CODE, source.sourceSelectorCode],
        [h.ACTION_CODE, source.actionCode],
        [h.PROFILE_CODE, profile.profileCode],
        [h.PAYLOAD_CODE, source.payloadCode],
        [h.TARGET_POLICY_CODE, source.targetPolicyCode],
        [h.SNAPSHOT_WORD_OFFSET, source.snapshotWordOffset],
        [h.GENERATION_LIMIT, source.generationLimit],
        [h.CORE_SLOT, source.coreTarget?.slot ?? UINT32_MAX],
        [h.CORE_ENTITY_ID, source.coreTarget?.entityId ?? UINT32_MAX],
        [h.CORE_INCARNATION, source.coreTarget?.incarnation ?? UINT32_MAX],
        [h.SDF_COLS, source.sdf.cols],
        [h.SDF_ROWS, source.sdf.rows],
        [h.SDF_ENABLED, source.sdf.enabled === true ? 1 : 0],
        [h.TOWER_MEMBER_CAPACITY, source.towerMemberCapacity],
        [h.SPAWN_ANCHOR_CODE, profile.spawnAnchorCode],
        [h.TARGET_SNAPSHOT_CODE, profile.targetSnapshotCode],
        [h.ACTIVATION_CODE, profile.activationCode],
        [h.PLACEMENT_POLICY_CODE, profile.placementPolicyCode],
        [h.TRANSIT_CODE, profile.transitCode],
        [h.TRANSIT_FLAGS, profile.transitFlags],
        [h.TRAVEL_DURATION_FIXED_TICKS,
            profile.travelDurationFixedTicks],
        [h.PROFILE_FINGERPRINT, profile.fingerprint],
        [h.PLACEMENT_WORD_OFFSET, output.placementWordOffset],
        [h.TRANSIT_WORD_OFFSET, output.transitWordOffset],
        [h.OUTPUT_WORD_CAPACITY, output.outputWordCapacity],
        [h.TOWER_GROUP_ABI_VERSION, GPU_TOWER_GROUP_ABI_VERSION],
        [h.FIXED_HZ, 60],
        [h.PLACEMENT_RECORD_WORDS,
            GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.STRIDE / 4],
        [h.TRANSIT_RECORD_WORDS,
            GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.STRIDE / 4],
        [h.DESTINATION_COUNT, destinationCount],
        [h.COPIES_PER_SUBJECT, copiesPerSubject],
        [h.MODIFIER_SET_FINGERPRINT, modifierSetFingerprint],
        [h.RESERVED_3, 0]
    ];
    for (const [offset, value] of uintValues) {
        view.setUint32(
            offset,
            requireUint32(value, `actorAction.header@${offset}`),
            LITTLE_ENDIAN
        );
    }
    const floatValues = [
        [h.AIM_POINT_X, source.aimPoint?.x],
        [h.AIM_POINT_Y, source.aimPoint?.y],
        [h.WORLD_WIDTH, requirePositiveFloat32(
            source.sdf.worldWidth,
            'sdf.worldWidth'
        )],
        [h.WORLD_HEIGHT, requirePositiveFloat32(
            source.sdf.worldHeight,
            'sdf.worldHeight'
        )],
        [h.LAUNCH_SPEED, requireNonNegativeFloat32(
            profile.launchSpeed,
            'launchSpeed'
        )],
        [h.TRAVEL_SPEED, requireNonNegativeFloat32(
            profile.travelSpeed,
            'travelSpeed'
        )],
        [h.SURFACE_GAP, requireNonNegativeFloat32(
            profile.surfaceGap,
            'surfaceGap'
        )],
        [h.SUMMON_LATTICE_SPACING, requireNonNegativeFloat32(
            profile.summonLatticeSpacing,
            'summonLatticeSpacing'
        )],
        [h.PRESENTATION_ARC_HEIGHT, requireNonNegativeFloat32(
            profile.presentationArcHeight,
            'presentationArcHeight'
        )]
    ];
    for (const [offset, value] of floatValues) {
        view.setFloat32(
            offset,
            requireFiniteFloat32(value, `actorAction.header@${offset}`),
            LITTLE_ENDIAN
        );
    }
    return Object.freeze({ profile, output });
}

export function writeGpuActorActionDestinationLease(
    storage,
    destinationCount,
    index,
    source = {}
) {
    const count = requireUint32(
        destinationCount,
        'destinationCount',
        { positive: true }
    );
    const rank = requireUint32(index, 'destination lease index');
    const h = GPU_ACTOR_ACTION_PLACEMENT_ABI.PROGRAM_HEADER;
    const r = GPU_ACTOR_ACTION_PLACEMENT_ABI.DESTINATION_LEASE;
    if (!(storage instanceof ArrayBuffer)
        || storage.byteLength !== h.STRIDE + count * r.STRIDE
        || rank >= count) {
        throw new RangeError('actor action destination lease storage가 다릅니다.');
    }
    const snapshotRank = requireUint32(
        source.snapshotRank,
        'snapshotRank'
    );
    const destinationRank = requireUint32(
        source.destinationRank ?? rank,
        'destinationRank'
    );
    const copiesPerSubject = requireUint32(
        source.copiesPerSubject ?? 1,
        'copiesPerSubject',
        { positive: true }
    );
    const copyIndex = requireUint32(
        source.copyIndex ?? 0,
        'copyIndex'
    );
    if (snapshotRank !== Math.floor(rank / copiesPerSubject)
        || destinationRank !== rank
        || copyIndex !== rank % copiesPerSubject) {
        throw new RangeError('destination lease multiplicity rank가 다릅니다.');
    }
    const base = h.STRIDE + rank * r.STRIDE;
    const view = new DataView(storage);
    const values = [
        [r.DESTINATION_SLOT, source.destinationSlot],
        [r.DESTINATION_ENTITY_ID, source.destinationEntityId],
        [r.DESTINATION_INCARNATION, source.destinationIncarnation],
        [r.SNAPSHOT_RANK, snapshotRank],
        [r.DESTINATION_RANK, destinationRank],
        [r.BASELINE_FLAGS, source.baselineFlags ?? 0],
        [r.COPY_INDEX, copyIndex],
        [r.RESERVED_1, 0]
    ];
    for (const [offset, value] of values) {
        view.setUint32(
            base + offset,
            requireUint32(value, `actorAction.lease[${rank}]@${offset}`),
            LITTLE_ENDIAN
        );
    }
    return storage;
}

export function readGpuActorActionPlacementAggregate(buffer) {
    const a = GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < a.STRIDE) {
        throw new RangeError('actor action placement aggregate가 짧습니다.');
    }
    const view = new DataView(buffer);
    const result = Object.freeze({
        abiVersion: view.getUint32(a.ABI_VERSION, LITTLE_ENDIAN),
        snapshotAbiVersion: view.getUint32(
            a.SNAPSHOT_ABI_VERSION,
            LITTLE_ENDIAN
        ),
        bodyAbiVersion: view.getUint32(a.BODY_ABI_VERSION, LITTLE_ENDIAN),
        profileAbiVersion: view.getUint32(
            a.PROFILE_ABI_VERSION,
            LITTLE_ENDIAN
        ),
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
        placementTargetTick: view.getUint32(
            a.PLACEMENT_TARGET_TICK,
            LITTLE_ENDIAN
        ),
        executionOrdinal: view.getUint32(a.EXECUTION_ORDINAL, LITTLE_ENDIAN),
        status: view.getUint32(a.STATUS, LITTLE_ENDIAN),
        subjectCount: view.getUint32(a.SUBJECT_COUNT, LITTLE_ENDIAN),
        destinationCount: view.getUint32(
            a.DESTINATION_COUNT,
            LITTLE_ENDIAN
        ),
        validCount: view.getUint32(a.VALID_COUNT, LITTLE_ENDIAN),
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
        placementFingerprint: view.getUint32(
            a.PLACEMENT_FINGERPRINT,
            LITTLE_ENDIAN
        ),
        errorFlags: view.getUint32(a.ERROR_FLAGS, LITTLE_ENDIAN),
        actionCode: view.getUint32(a.ACTION_CODE, LITTLE_ENDIAN),
        profileCode: view.getUint32(a.PROFILE_CODE, LITTLE_ENDIAN),
        payloadCode: view.getUint32(a.PAYLOAD_CODE, LITTLE_ENDIAN),
        placementByteLength: view.getUint32(
            a.PLACEMENT_BYTE_LENGTH,
            LITTLE_ENDIAN
        ),
        transitByteLength: view.getUint32(
            a.TRANSIT_BYTE_LENGTH,
            LITTLE_ENDIAN
        ),
        actorActionProfileFingerprint: view.getUint32(
            a.PROFILE_FINGERPRINT,
            LITTLE_ENDIAN
        ),
        copiesPerSubject: view.getUint32(
            a.COPIES_PER_SUBJECT,
            LITTLE_ENDIAN
        ),
        modifierSetFingerprint: view.getUint32(
            a.MODIFIER_SET_FINGERPRINT,
            LITTLE_ENDIAN
        )
    });
    if (result.abiVersion !== GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION
        || result.snapshotAbiVersion
            !== GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION
        || result.bodyAbiVersion !== GPU_CIRCLE_BODY_ABI_VERSION
        || result.profileAbiVersion !== ACTOR_ACTION_PROFILE_ABI_VERSION
        || !KNOWN_STATUS.has(result.status)
        || (result.errorFlags & ~KNOWN_ERROR_MASK) !== 0) {
        throw new RangeError('actor action placement aggregate ABI가 잘못됐습니다.');
    }
    const exactCardinality = result.subjectCount > 0
        && result.copiesPerSubject > 0
        && result.subjectCount <= Math.floor(
            UINT32_MAX / result.copiesPerSubject
        )
        && result.subjectCount * result.copiesPerSubject
            === result.destinationCount;
    if (!exactCardinality) {
        throw new RangeError('actor action placement cardinality가 잘못됐습니다.');
    }
    if (result.status === GPU_ACTOR_ACTION_PLACEMENT_STATUS.COMPLETE
        && (result.validCount !== result.destinationCount
            || result.errorFlags !== 0
            || result.placementFingerprint === 0
            || result.actorActionProfileFingerprint === 0)) {
        throw new RangeError('complete actor action placement가 일관되지 않습니다.');
    }
    return result;
}

function requireRecordBuffer(buffer, layout, index, label) {
    if (!(buffer instanceof ArrayBuffer)) {
        throw new TypeError(`${label} buffer가 필요합니다.`);
    }
    const rank = requireUint32(index, `${label} index`);
    const offset = rank * layout.STRIDE;
    if (offset + layout.STRIDE > buffer.byteLength) {
        throw new RangeError(`${label} index가 buffer를 벗어났습니다.`);
    }
    return { view: new DataView(buffer), offset };
}

export function readGpuActorActionPlacementRecord(buffer, index = 0) {
    const r = GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD;
    const { view, offset } = requireRecordBuffer(
        buffer,
        r,
        index,
        'placement record'
    );
    const uint = (field) => view.getUint32(offset + field, LITTLE_ENDIAN);
    const float = (field) => view.getFloat32(offset + field, LITTLE_ENDIAN);
    const status = uint(r.STATUS);
    const errorFlags = uint(r.ERROR_FLAGS);
    if (uint(r.ABI_VERSION) !== GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION
        || !KNOWN_RECORD_STATUS.has(status)
        || (errorFlags & ~KNOWN_ERROR_MASK) !== 0) {
        throw new RangeError('placement record ABI/status가 잘못됐습니다.');
    }
    return Object.freeze({
        abiVersion: uint(r.ABI_VERSION),
        status,
        errorFlags,
        sourceRank: uint(r.SOURCE_RANK),
        sourceSlot: uint(r.SOURCE_SLOT),
        sourceEntityId: uint(r.SOURCE_ENTITY_ID),
        sourceIncarnation: uint(r.SOURCE_INCARNATION),
        destinationRank: uint(r.DESTINATION_RANK),
        destinationSlot: uint(r.DESTINATION_SLOT),
        destinationEntityId: uint(r.DESTINATION_ENTITY_ID),
        destinationIncarnation: uint(r.DESTINATION_INCARNATION),
        actionCode: uint(r.ACTION_CODE),
        profileCode: uint(r.PROFILE_CODE),
        payloadCode: uint(r.PAYLOAD_CODE),
        spawnPosition: Object.freeze({
            x: float(r.SPAWN_X),
            y: float(r.SPAWN_Y)
        }),
        initialVelocity: Object.freeze({
            x: float(r.INITIAL_VELOCITY_X),
            y: float(r.INITIAL_VELOCITY_Y)
        }),
        targetPosition: Object.freeze({
            x: float(r.TARGET_X),
            y: float(r.TARGET_Y)
        }),
        activationTick: uint(r.ACTIVATION_TICK),
        transitDurationFixedTicks: uint(r.TRANSIT_DURATION_FIXED_TICKS),
        sourceGeneration: uint(r.SOURCE_GENERATION),
        childGeneration: uint(r.CHILD_GENERATION),
        placementFingerprint: uint(r.PLACEMENT_FINGERPRINT),
        targetKind: uint(r.TARGET_KIND),
        targetSlot: uint(r.TARGET_SLOT),
        targetEntityId: uint(r.TARGET_ENTITY_ID),
        targetIncarnation: uint(r.TARGET_INCARNATION),
        sourceRadius: float(r.SOURCE_RADIUS),
        destinationRadius: float(r.DESTINATION_RADIUS),
        direction: Object.freeze({
            x: float(r.DIRECTION_X),
            y: float(r.DIRECTION_Y)
        }),
        copyIndex: uint(r.COPY_INDEX),
        modifierSetFingerprint: uint(r.MODIFIER_SET_FINGERPRINT),
        admissionChosenCandidateIndex:
            uint(r.ADMISSION_CHOSEN_CANDIDATE_INDEX),
        admissionAttemptedCandidateCount:
            uint(r.ADMISSION_ATTEMPTED_CANDIDATE_COUNT),
        admissionFailureClass: uint(r.ADMISSION_FAILURE_CLASS)
    });
}

export function readGpuActorActionTransitRecord(buffer, index = 0) {
    const r = GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD;
    const { view, offset } = requireRecordBuffer(
        buffer,
        r,
        index,
        'transit record'
    );
    const uint = (field) => view.getUint32(offset + field, LITTLE_ENDIAN);
    const float = (field) => view.getFloat32(offset + field, LITTLE_ENDIAN);
    if (uint(r.ABI_VERSION) !== GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION) {
        throw new RangeError('transit record ABI가 잘못됐습니다.');
    }
    return Object.freeze({
        abiVersion: uint(r.ABI_VERSION),
        phase: uint(r.PHASE),
        flags: uint(r.FLAGS),
        sourceRank: uint(r.SOURCE_RANK),
        destinationSlot: uint(r.DESTINATION_SLOT),
        destinationEntityId: uint(r.DESTINATION_ENTITY_ID),
        destinationIncarnation: uint(r.DESTINATION_INCARNATION),
        actionCode: uint(r.ACTION_CODE),
        profileCode: uint(r.PROFILE_CODE),
        activationTick: uint(r.ACTIVATION_TICK),
        durationFixedTicks: uint(r.DURATION_FIXED_TICKS),
        progressFixedTicks: uint(r.PROGRESS_FIXED_TICKS),
        landingPosition: Object.freeze({
            x: float(r.LANDING_X),
            y: float(r.LANDING_Y)
        }),
        presentationArcHeight: float(r.PRESENTATION_ARC_HEIGHT),
        velocity: Object.freeze({
            x: float(r.VELOCITY_X),
            y: float(r.VELOCITY_Y)
        }),
        fingerprint: uint(r.FINGERPRINT),
        copyIndex: uint(r.COPY_INDEX),
        modifierSetFingerprint: uint(r.MODIFIER_SET_FINGERPRINT)
    });
}

export function computeActorActionSummonLatticeOffset(rank) {
    const index = requireUint32(rank, 'summon rank');
    if (index === 0) return Object.freeze({ x: 0, y: 0 });
    let ring = 1;
    while ((2 * ring + 1) ** 2 <= index) ring++;
    const side = ring * 2;
    const maximum = (ring * 2 + 1) ** 2 - 1;
    const offset = maximum - index;
    if (offset < side) {
        return Object.freeze({ x: ring - offset, y: -ring });
    }
    if (offset < side * 2) {
        return Object.freeze({ x: -ring, y: -ring + offset - side });
    }
    if (offset < side * 3) {
        return Object.freeze({
            x: -ring + offset - side * 2,
            y: ring
        });
    }
    return Object.freeze({
        x: ring,
        y: ring - (offset - side * 3)
    });
}

function finiteVector(value, label) {
    return Object.freeze({
        x: requireFiniteFloat32(value?.x, `${label}.x`),
        y: requireFiniteFloat32(value?.y, `${label}.y`)
    });
}

/** WGSL integer-rank lattice와 같은 float32 world placement oracle입니다. */
export function computeActorActionSummonLatticePosition(
    anchor,
    rank,
    spacing
) {
    const point = finiteVector(anchor, 'summon anchor');
    const distance = requireFiniteFloat32(spacing, 'summon spacing');
    if (!(distance > 0)) {
        throw new RangeError('summon spacing은 양의 finite float32여야 합니다.');
    }
    const offset = computeActorActionSummonLatticeOffset(rank);
    return Object.freeze({
        x: Math.fround(point.x + Math.fround(offset.x * distance)),
        y: Math.fround(point.y + Math.fround(offset.y * distance))
    });
}

/** Summon anchor가 source surface 밖인지 판정하는 host/reference oracle입니다. */
export function isActorActionSummonAnchorDistanceValid(source = {}) {
    const position = finiteVector(source.sourcePosition, 'sourcePosition');
    const anchor = finiteVector(source.anchorPosition, 'anchorPosition');
    const sourceRadius = requireFiniteFloat32(
        source.sourceRadius,
        'sourceRadius'
    );
    const destinationRadius = requireFiniteFloat32(
        source.destinationRadius,
        'destinationRadius'
    );
    if (!(sourceRadius > 0) || !(destinationRadius > 0)) {
        throw new RangeError('Summon source/destination radius는 양수여야 합니다.');
    }
    const dx = Math.fround(anchor.x - position.x);
    const dy = Math.fround(anchor.y - position.y);
    const distanceSquared = Math.fround(
        Math.fround(dx * dx) + Math.fround(dy * dy)
    );
    const minimumDistance = Math.fround(sourceRadius + destinationRadius);
    const minimumDistanceSquared = Math.fround(
        minimumDistance * minimumDistance
    );
    return distanceSquared >= minimumDistanceSquared;
}

export function resolveActorActionDegenerateDirection(source = {}) {
    const position = finiteVector(source.sourcePosition, 'sourcePosition');
    const target = finiteVector(source.targetPosition, 'targetPosition');
    const velocity = finiteVector(source.sourceVelocity, 'sourceVelocity');
    const facing = finiteVector(source.sourceFacing, 'sourceFacing');
    const candidates = [
        { x: Math.fround(target.x - position.x),
            y: Math.fround(target.y - position.y) },
        velocity,
        facing,
        { x: 1, y: 0 }
    ];
    for (const candidate of candidates) {
        const lengthSquared = Math.fround(
            Math.fround(candidate.x * candidate.x)
                + Math.fround(candidate.y * candidate.y)
        );
        if (lengthSquared > 0.000001) {
            const length = Math.sqrt(lengthSquared);
            return Object.freeze({
                x: Math.fround(candidate.x / length),
                y: Math.fround(candidate.y / length)
            });
        }
    }
    return Object.freeze({ x: 1, y: 0 });
}
