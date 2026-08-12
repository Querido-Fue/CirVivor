import {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_APPLIED_EVENT_FLAG,
    GPU_CIRCLE_APPLIED_EVENT_TYPE,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_FLOW,
    GPU_CIRCLE_BODY_IDENTITY,
    GPU_CIRCLE_BODY_META,
    GPU_CIRCLE_BODY_RENDER_SHAPE,
    GPU_CIRCLE_BODY_SIMULATION_FLAG,
    GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM,
    GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM,
    GPU_PROJECTILE_CAPTURE_PHASE,
    GPU_PROJECTILE_CAPTURE_POLICY_CODE,
    GPU_PROJECTILE_CAPTURE_ROLE,
    assertGpuCircleBodyAbiVersion,
    createGpuCircleBodyAbiStorage,
    decodeGpuCircleBodyFixedPoint,
    normalizeGpuCircleBodyRenderShapeCode,
    packGpuCircleGameplayMeta,
    packGpuCircleInteractionMeta,
    readGpuCircleBody,
    readGpuProjectileCaptureState,
    unpackGpuCircleInteractionMeta,
    unpackGpuCircleGameplayMeta,
    unpackGpuCircleAppliedEventMeta,
    unpackGpuProjectileCaptureStateMeta,
    writeGpuCircleBodyCounts,
    writeGpuCircleBodySpawn,
    writeGpuProjectileCaptureState
} from './gpu_circle_body_abi.js';
import {
    GPU_BODY_CONTROL_PROGRAM_ABI_VERSION,
    GPU_BODY_CONTROL_PROGRAM_MODE,
    GPU_BODY_CONTROL_PROGRAM_RESULT,
    GPU_BODY_CONTROL_SELECTED_TARGET_KIND,
    GPU_BODY_CONTROL_SELECTION_POLICY,
    GPU_BODY_CONTROL_STATE_FLAGS,
    GPU_FIXED_PRIMITIVE_ABI,
    GPU_FIXED_PRIMITIVE_IDENTITY,
    GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION,
    GPU_FIXED_PROGRAM_STATUS,
    GPU_SPAWN_PROGRAM_ABI_VERSION,
    GPU_SPAWN_PROGRAM_MODE,
    GPU_SPAWN_PROGRAM_REQUEST_FLAGS,
    GPU_SPAWN_PROGRAM_RESULT,
    GPU_TOWER_GAMEPLAY_TARGET_CONFIG_ABI_VERSION,
    createGpuBodyControlProgramStorage,
    createGpuSpawnProgramStorage,
    readGpuBodyControlProgramHeader,
    readGpuBodyControlProgramRecord,
    readGpuSpawnProgramHeader,
    readGpuSpawnProgramRecord,
    writeGpuBodyControlProgramHeader,
    writeGpuBodyControlProgramRecord,
    writeGpuSpawnProgramHeader,
    writeGpuSpawnProgramRecord
} from './gpu_fixed_primitive_abi.js';
import {
    GPU_BODY_PRESENTATION_PROFILE,
    GpuBodyPresentationClock
} from './gpu_body_presentation_clock.js';
import {
    GPU_COLLISION_COMPUTE_WGSL,
    GPU_COLLISION_INDIRECT_WGSL,
    GPU_COLLISION_RENDER_WGSL
} from './gpu_collision_shaders.js';
import {
    GPU_EFFECT_EVENT_TYPE,
    GPU_EFFECT_PULSE_PROGRAM_FLAG,
    GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
    GPU_EFFECT_PULSE_PROGRAM_RESULT,
    GPU_EFFECT_RUNTIME_ABI,
    GPU_EFFECT_RUNTIME_ABI_VERSION,
    GPU_EFFECT_RUNTIME_STATUS,
    GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION,
    createGpuEffectBodyStateStorage,
    createGpuEffectPoolStateStorage,
    createGpuEffectPulseProgramStorage,
    readGpuEffectEvent,
    readGpuEffectPoolState,
    readGpuEffectPulseProgramHeader,
    readGpuEffectPulseProgramRecord,
    writeGpuEffectBodyStateSpawn,
    writeGpuEffectPulseProgramHeader,
    writeGpuEffectPulseProgramRecord
} from './gpu_effect_runtime_abi.js';
import {
    GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
    GPU_EFFECT_RUNTIME_ENTRY_POINT
} from './gpu_effect_runtime_shaders.js';
import {
    GPU_FORMATION_IDENTITY_INVALID,
    GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
    GPU_FORMATION_PREPARE_PROGRAM_FLAG,
    GPU_FORMATION_PREPARE_RESULT,
    GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON,
    GPU_FORMATION_RUNTIME_ABI,
    GPU_FORMATION_RUNTIME_ABI_VERSION,
    GPU_FORMATION_RUNTIME_STATUS,
    GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION,
    GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
    GPU_FORMATION_TRANSFORM_RESULT,
    createGpuFormationBodyStateStorage,
    createGpuFormationPrepareProgramStorage,
    createGpuFormationTransformProgramStorage,
    readGpuFormationPrepareProgramHeader,
    readGpuFormationPrepareProgramRecord,
    readGpuFormationTransformProgramHeader,
    readGpuFormationTransformProgramRecord,
    writeGpuFormationBodyStateSpawn,
    writeGpuFormationPrepareProgramHeader,
    writeGpuFormationPrepareProgramRecord,
    writeGpuFormationTransformProgramHeader,
    writeGpuFormationTransformProgramRecord
} from './gpu_formation_runtime_abi.js';
import {
    GPU_FORMATION_RUNTIME_COMPUTE_WGSL,
    GPU_FORMATION_RUNTIME_ENTRY_POINT,
    GPU_FORMATION_RUNTIME_STORAGE_PROFILE
} from './gpu_formation_runtime_shaders.js';
import {
    GPU_ATOMIC_TRANSFORM_PREPARE_PROGRAM_ABI_VERSION,
    GPU_ATOMIC_TRANSFORM_PREPARE_RESULT,
    GPU_ATOMIC_TRANSFORM_PROGRAM_ABI_VERSION,
    GPU_ATOMIC_TRANSFORM_RUNTIME_ABI,
    GPU_ATOMIC_TRANSFORM_RUNTIME_ABI_VERSION,
    GPU_ATOMIC_TRANSFORM_RESULT,
    GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS,
    GPU_ATOMIC_TRANSFORM_RUNTIME_STORAGE_PROFILE,
    GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION,
    GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE,
    createGpuAtomicTransformPrepareStorage,
    createGpuAtomicTransformProgramStorage,
    readGpuAtomicTransformPrepareHeader,
    readGpuAtomicTransformPrepareRecord,
    readGpuAtomicTransformProgramHeader,
    readGpuAtomicTransformProgramRecord,
    writeGpuAtomicTransformPrepareHeader,
    writeGpuAtomicTransformProgramHeader,
    writeGpuAtomicTransformProgramRecord
} from './gpu_atomic_transform_runtime_abi.js';
import {
    GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL,
    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT
} from './gpu_atomic_transform_runtime_shaders.js';
import {
    GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE,
    GPU_PROJECTILE_CAPTURE_RELEASE_REASON,
    GPU_PROJECTILE_CAPTURE_RELEASE_PROGRAM_FLAG,
    GPU_PROJECTILE_CAPTURE_RUNTIME_ABI,
    GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT,
    GPU_PROJECTILE_CAPTURE_TICK_STATUS,
    GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR,
    createGpuProjectileCaptureReleaseProgramStorage,
    createGpuProjectileCaptureTickStorage,
    decodeGpuProjectileCaptureCompletion,
    readGpuProjectileCaptureReleaseHeader,
    readGpuProjectileCaptureReleaseRecord,
    readGpuProjectileCaptureTickHeader,
    writeGpuProjectileCaptureReleaseHeader,
    writeGpuProjectileCaptureReleaseRecord
} from './gpu_projectile_capture_runtime_abi.js';
import {
    GPU_PROJECTILE_CAPTURE_RELEASE_WGSL,
    GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL,
    GPU_PROJECTILE_CAPTURE_STORAGE_PROFILE
} from './gpu_projectile_capture_runtime_shaders.js';
import {
    RING_PROJECTILE_CAPTURE_PROFILE
} from 'data/object/enemy/enemy_projectile_capture_catalog_data.js';
import {
    GPU_ROUTE_AVAILABILITY_STATE,
    GPU_ROUTE_LIFECYCLE_ABI_VERSION,
    GPU_ROUTE_RUNTIME_ABI,
    GPU_ROUTE_RUNTIME_ABI_VERSION,
    GPU_ROUTE_RUNTIME_INVALID_INDEX,
    GPU_ROUTE_RUNTIME_MAX_CLOSERS,
    GPU_ROUTE_RUNTIME_ROLE,
    GPU_ROUTE_RUNTIME_STATUS,
    copyGpuRouteRuntimeStateSlot,
    createGpuRouteAvailabilityBuffer,
    createGpuRouteCleanupProgram,
    createGpuRouteRuntimeStateBuffer,
    createGpuRouteRuntimeTopology,
    readGpuRouteRuntimeState,
    writeGpuRouteCleanupProgram,
    writeGpuRouteRuntimeParams,
    writeGpuRouteRuntimeState
} from './gpu_route_runtime_abi.js';
import {
    GPU_ROUTE_RUNTIME_ENTRY_POINT,
    GPU_ROUTE_RUNTIME_STORAGE_PROFILE,
    GPU_ROUTE_RUNTIME_WGSL
} from './gpu_route_runtime_shaders.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} from '../../contract/gameplay_team_contract.js';

const GRID_BUCKET_COUNT = 2;
const SOURCE_GRID_CELL_WORLD_UNITS = 12;
const SOURCE_SDF_CELL_WORLD_UNITS = 8;
const SOURCE_MAX_BODIES_PER_CELL = 64;
const SOURCE_SOLVER_ITERATIONS = 6;
const BODY_WORKGROUP_SIZE = 256;
const OVERFLOW_READBACK_SLOT_COUNT = 4;
const EVENT_READBACK_SLOT_COUNT = 8;
const SPAWN_PROGRAM_READBACK_SLOT_COUNT = 4;
const TRACKED_POSE_READBACK_SLOT_COUNT = 4;
const EFFECT_PROGRAM_READBACK_SLOT_COUNT = 4;
const FORMATION_PROGRAM_READBACK_SLOT_COUNT = 4;
const PROJECTILE_CAPTURE_READBACK_SLOT_COUNT = 8;
const ROUTE_RUNTIME_READBACK_SLOT_COUNT = 4;
const PROJECTILE_CAPTURE_PARAMS_BYTE_SIZE = 48;
const PROJECTILE_CAPTURE_TARGET_CONFIG_BYTE_SIZE = 16;
const DEFAULT_PROJECTILE_CAPTURE_COMPLETION_CAPACITY = 256;
const OVERFLOW_READBACK_INTERVAL_TICKS = 4;
const OVERFLOW_TELEMETRY_MAX_AGE_TICKS = 60;
const DEFAULT_MIN_CONTACT_CAPACITY = 1024;
const DEFAULT_MAX_CONTACT_CAPACITY = 65536;
const DEFAULT_MAX_EVENT_CAPACITY = 8192;
const DEFAULT_MAX_EFFECT_INSTANCE_CAPACITY = 65536;
const DEFAULT_MAX_EFFECT_CANDIDATE_CAPACITY = 8192;
const DEFAULT_MAX_EFFECT_EVENT_CAPACITY = 8192;
const FLOW_INTEGRATION_UNREACHABLE_COST = Math.fround(1e20);
const COMPUTE_PARAMS_FLOW_STAGE_OFFSET = 96;
const COMPUTE_PARAMS_FLOW_STAGE_STRIDE = 16;
const COMPUTE_PARAMS_MAX_CONTACTS_OFFSET = COMPUTE_PARAMS_FLOW_STAGE_OFFSET
    + (GPU_CIRCLE_BODY_FLOW.MAX_FIELD_COUNT * COMPUTE_PARAMS_FLOW_STAGE_STRIDE);

function fingerprintProjectileCaptureCommandId(value) {
    const text = String(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash === 0 || hash === UINT32_MAX ? 1 : hash;
}

function projectileCapturePreparationKey(
    batchIdFingerprint,
    projectileHandle,
    captureSequence,
    prepareFingerprint
) {
    return [
        batchIdFingerprint,
        projectileHandle?.entityId,
        projectileHandle?.incarnation,
        captureSequence,
        prepareFingerprint
    ].join(':');
}

function mixProjectileCaptureFingerprint(a, b, c) {
    let value = (
        Math.imul(a >>> 0, 0x9e3779b1)
        ^ Math.imul(b >>> 0, 0x85ebca6b)
        ^ Math.imul(c >>> 0, 0xc2b2ae35)
    ) >>> 0;
    value = (value ^ (value >>> 16)) >>> 0;
    value = Math.imul(value, 0x7feb352d) >>> 0;
    value = (value ^ (value >>> 15)) >>> 0;
    return value === 0 || value === UINT32_MAX ? 1 : value;
}

function projectileCaptureFloat32Bits(value) {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setFloat32(0, Math.fround(value), LITTLE_ENDIAN);
    return view.getUint32(0, LITTLE_ENDIAN);
}
const COMPUTE_PARAMS_MAX_EVENTS_OFFSET = COMPUTE_PARAMS_MAX_CONTACTS_OFFSET + 4;
const COMPUTE_PARAMS_MAX_DEATH_EVENTS_OFFSET = COMPUTE_PARAMS_MAX_EVENTS_OFFSET + 4;
const COMPUTE_PARAMS_MAXIMUM_BODY_RADIUS_OFFSET
    = COMPUTE_PARAMS_MAX_DEATH_EVENTS_OFFSET + 4;
const COMPUTE_PARAMS_FIXED_TICK_OFFSET = COMPUTE_PARAMS_MAXIMUM_BODY_RADIUS_OFFSET + 4;
const COMPUTE_PARAMS_BYTE_SIZE = COMPUTE_PARAMS_FIXED_TICK_OFFSET + 16;
const RENDER_PARAMS_BYTE_SIZE = 32;
const GRID_OVERFLOW_BYTE_SIZE = 16;
const CONTACT_STATE_BYTE_SIZE = 64;
const CONTACT_RECORD_BYTE_SIZE = 32;
const APPLIED_EVENT_BYTE_SIZE = GPU_CIRCLE_BODY_ABI.APPLIED_EVENT.STRIDE;
const DEATH_EVENT_BYTE_SIZE = GPU_CIRCLE_BODY_ABI.DEATH_EVENT.STRIDE;
const EVENT_READBACK_HEADER_BYTE_SIZE = 256;
const DISPATCH_INDIRECT_BYTE_SIZE = 12;
const DRAW_INDIRECT_BYTE_SIZE = 16;
const BODY_RENDER_STYLE_STRIDE = GPU_CIRCLE_BODY_ABI.RENDER_STYLE.STRIDE;
const BODY_CONTROL_STATE_STRIDE
    = GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_STATE.STRIDE;
const TRACKED_POSE_RECORD_BYTE_SIZE
    = GPU_FIXED_PRIMITIVE_ABI.TRACKED_POSE_RECORD.STRIDE;
const TRACKED_POSE_CONFIG_BYTE_SIZE
    = GPU_FIXED_PRIMITIVE_ABI.TRACKED_POSE_CONFIG.STRIDE;
const TOWER_GAMEPLAY_TARGET_CONFIG_BYTE_SIZE
    = GPU_FIXED_PRIMITIVE_ABI.TOWER_GAMEPLAY_TARGET_CONFIG.STRIDE;
const FLOAT32_BYTES = 4;
const MASS_EPSILON = 0.000001;
const UINT32_MAX = 0xffffffff;
const LITTLE_ENDIAN = true;
const DEATH_EVENT_FLAG_HEALTH = 1 << 0;
const DEATH_EVENT_FLAG_LIFETIME = 1 << 1;
const CONTACT_STATE_ABI_STATUS_OFFSET = 24;
const CONTACT_STATE_EVENT_ENCODING_VERSION_OFFSET = 28;
const CONTACT_STATE_MAXIMUM_DAMAGE_WINDOW_EVENT_COUNT_OFFSET = 32;
const CONTACT_STATE_MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_OFFSET = 36;
const CONTACT_STATE_CORE_DAMAGE_REQUEST_EVENT_COUNT_OFFSET = 40;
const CONTACT_STATE_CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_OFFSET = 44;
const CONTACT_STATE_ATOMIC_TRANSFORM_CANDIDATE_COUNT_OFFSET = 48;
const CONTACT_STATE_ATOMIC_TRANSFORM_EVENT_BASE_OFFSET = 52;
const CONTACT_STATE_ATOMIC_TRANSFORM_PROTOCOL_STATUS_OFFSET = 56;
const CONTACT_STATE_ATOMIC_TRANSFORM_COMMITTED_COUNT_OFFSET = 60;
const CONTACT_STATE_ABI_STATUS_OK = 1;
const MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_OK = 0;
const CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_OK = 0;
const EFFECT_RETRYABLE_CAPACITY_STATUS_MASK
    = GPU_EFFECT_RUNTIME_STATUS.CANDIDATE_CAPACITY_EXCEEDED
    | GPU_EFFECT_RUNTIME_STATUS.INSTANCE_CAPACITY_EXCEEDED
    | GPU_EFFECT_RUNTIME_STATUS.EVENT_CAPACITY_EXCEEDED
    | GPU_EFFECT_RUNTIME_STATUS.GRID_OVERFLOW;
const APPLIED_EVENT_POLICY_FLAGS = GPU_CIRCLE_APPLIED_EVENT_FLAG.ENTER_POLICY
    | GPU_CIRCLE_APPLIED_EVENT_FLAG.CONTINUOUS_POLICY;
const APPLIED_EVENT_KNOWN_FLAGS = GPU_CIRCLE_APPLIED_EVENT_FLAG.TARGET_DIED
    | GPU_CIRCLE_APPLIED_EVENT_FLAG.TERRAIN_KILL
    | APPLIED_EVENT_POLICY_FLAGS
    | GPU_CIRCLE_APPLIED_EVENT_FLAG.TERRAIN_CONTACT
    | GPU_CIRCLE_APPLIED_EVENT_FLAG.MAXIMUM_DAMAGE_WINDOW
    | GPU_CIRCLE_APPLIED_EVENT_FLAG.DIRECTIONAL_DEFENSE
    | GPU_CIRCLE_APPLIED_EVENT_FLAG.ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT;

const EFFECT_READBACK_POOL_STATE_OFFSET = 0;
const EFFECT_READBACK_PROGRAM_OFFSET = GPU_EFFECT_RUNTIME_ABI.POOL_STATE.STRIDE;
const EFFECT_PULSE_PROGRAM_KNOWN_FLAGS = Object.values(
    GPU_EFFECT_PULSE_PROGRAM_FLAG
).reduce((mask, flag) => mask | flag, 0) >>> 0;

const COMPUTE_ENTRY_POINTS = Object.freeze([
    'validate_source_relative_spawns',
    'resolve_source_relative_spawns',
    'validate_selected_target_spawns',
    'resolve_selected_target_spawns',
    'clear_body_control_states',
    'validate_body_control_commands',
    'apply_body_control_commands',
    'apply_controlled_motion',
    'advance_octagon_orbit',
    'advance_enemy_charge',
    'prepare_bodies',
    'clear_grid',
    'build_tick_start_grid',
    'build_grid',
    'clear_contact_state',
    'emit_enemy_charge_telegraphs',
    'generate_body_contacts',
    'generate_world_contacts',
    'classify_directional_defense_contacts',
    'clear_atomic_transform_first_hit_candidates',
    'select_atomic_transform_first_hit_source',
    'resolve_atomic_transform_first_hit_contact',
    'seal_atomic_transform_first_hits',
    'commit_atomic_transform_first_hits',
    'finalize_atomic_transform_first_hits',
    'shield_atomic_transform_first_hit_contacts',
    'handle_contacts',
    'preflight_core_damage_requests',
    'finalize_core_damage_request_preflight',
    'resolve_core_damage_requests',
    'resolve_enemy_charge_contacts',
    'preflight_maximum_damage_window',
    'finalize_maximum_damage_window_preflight',
    'resolve_maximum_damage_window',
    'mark_dead',
    'clear_position_deltas',
    'solve_body_body',
    'solve_body_world',
    'apply_position_deltas',
    'rebuild_velocities',
    'finalize_velocities',
    'finalize_controlled_motion',
    'apply_enemy_charge_recoil',
    'pack_tracked_pose'
]);
const COMPUTE_PIPELINE_PROFILE = Object.freeze({
    PHYSICS: 'physics',
    BODY_CONTACTS: 'body-contacts',
    WORLD_CONTACTS: 'world-contacts',
    CONTACT_HANDLING: 'contact-handling',
    MAXIMUM_DAMAGE_WINDOW: 'maximum-damage-window',
    CORE_DAMAGE_REQUEST: 'core-damage-request',
    FIXED_CONTROL: 'fixed-control',
    SOURCE_RESOLVE: 'source-resolve',
    ENEMY_BEHAVIOR: 'enemy-behavior',
    DIRECTIONAL_DEFENSE_CLASSIFIER: 'directional-defense-classifier',
    ATOMIC_TRANSFORM_FIRST_HIT: 'atomic-transform-first-hit',
    TRACKED_POSE: 'tracked-pose'
});
const COMPUTE_PIPELINE_PROFILE_BY_ENTRY_POINT = Object.freeze({
    validate_source_relative_spawns: COMPUTE_PIPELINE_PROFILE.SOURCE_RESOLVE,
    resolve_source_relative_spawns: COMPUTE_PIPELINE_PROFILE.SOURCE_RESOLVE,
    validate_selected_target_spawns: COMPUTE_PIPELINE_PROFILE.SOURCE_RESOLVE,
    resolve_selected_target_spawns: COMPUTE_PIPELINE_PROFILE.SOURCE_RESOLVE,
    clear_body_control_states: COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL,
    validate_body_control_commands: COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL,
    apply_body_control_commands: COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL,
    apply_controlled_motion: COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL,
    advance_octagon_orbit: COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR,
    advance_enemy_charge: COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR,
    prepare_bodies: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    clear_grid: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    build_tick_start_grid: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    build_grid: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    clear_contact_state: COMPUTE_PIPELINE_PROFILE.CONTACT_HANDLING,
    emit_enemy_charge_telegraphs: COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR,
    generate_body_contacts: COMPUTE_PIPELINE_PROFILE.BODY_CONTACTS,
    generate_world_contacts: COMPUTE_PIPELINE_PROFILE.WORLD_CONTACTS,
    classify_directional_defense_contacts:
        COMPUTE_PIPELINE_PROFILE.DIRECTIONAL_DEFENSE_CLASSIFIER,
    clear_atomic_transform_first_hit_candidates:
        COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT,
    select_atomic_transform_first_hit_source:
        COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT,
    resolve_atomic_transform_first_hit_contact:
        COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT,
    seal_atomic_transform_first_hits:
        COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT,
    commit_atomic_transform_first_hits:
        COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT,
    finalize_atomic_transform_first_hits:
        COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT,
    shield_atomic_transform_first_hit_contacts:
        COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT,
    handle_contacts: COMPUTE_PIPELINE_PROFILE.CONTACT_HANDLING,
    preflight_core_damage_requests:
        COMPUTE_PIPELINE_PROFILE.CORE_DAMAGE_REQUEST,
    finalize_core_damage_request_preflight:
        COMPUTE_PIPELINE_PROFILE.CORE_DAMAGE_REQUEST,
    resolve_core_damage_requests:
        COMPUTE_PIPELINE_PROFILE.CORE_DAMAGE_REQUEST,
    resolve_enemy_charge_contacts: COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR,
    preflight_maximum_damage_window: COMPUTE_PIPELINE_PROFILE.MAXIMUM_DAMAGE_WINDOW,
    finalize_maximum_damage_window_preflight:
        COMPUTE_PIPELINE_PROFILE.MAXIMUM_DAMAGE_WINDOW,
    resolve_maximum_damage_window: COMPUTE_PIPELINE_PROFILE.MAXIMUM_DAMAGE_WINDOW,
    mark_dead: COMPUTE_PIPELINE_PROFILE.CONTACT_HANDLING,
    clear_position_deltas: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    solve_body_body: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    solve_body_world: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    apply_position_deltas: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    rebuild_velocities: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    finalize_velocities: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    finalize_controlled_motion: COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL,
    apply_enemy_charge_recoil: COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR,
    pack_tracked_pose: COMPUTE_PIPELINE_PROFILE.TRACKED_POSE
});
const REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE = 9;

function eventReadbackControlProgramOffset(eventCapacity, deathEventCapacity) {
    return EVENT_READBACK_HEADER_BYTE_SIZE
        + (eventCapacity * APPLIED_EVENT_BYTE_SIZE)
        + (deathEventCapacity * DEATH_EVENT_BYTE_SIZE);
}

function effectReadbackEventOffset(pulseCapacity) {
    return EFFECT_READBACK_PROGRAM_OFFSET
        + GPU_EFFECT_RUNTIME_ABI.PROGRAM_HEADER.STRIDE
        + (pulseCapacity * GPU_EFFECT_RUNTIME_ABI.PULSE_PROGRAM_RECORD.STRIDE);
}

function effectReadbackByteSize(pulseCapacity, eventCapacity) {
    return effectReadbackEventOffset(pulseCapacity)
        + (eventCapacity * GPU_EFFECT_RUNTIME_ABI.EVENT.STRIDE);
}

function isRetryableEffectCapacityStatus(status) {
    const normalized = Number(status) >>> 0;
    return normalized !== GPU_EFFECT_RUNTIME_STATUS.OK
        && (normalized & ~EFFECT_RETRYABLE_CAPACITY_STATUS_MASK) === 0;
}

function requirePositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은(는) 양의 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은(는) 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireEffectUint32(value, label, { positive = false } = {}) {
    return requireNonSentinelUint32(value, label, { positive });
}

function requireNonSentinelUint32(value, label, { positive = false } = {}) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number < (positive ? 1 : 0)
        || number >= UINT32_MAX) {
        throw new RangeError(`${label}은 reserved sentinel보다 작은 uint32여야 합니다.`);
    }
    return number >>> 0;
}

function resolveCapacityOption(options, names, fallback, maximum, label) {
    let value = fallback;
    for (const name of names) {
        if (options[name] !== undefined) {
            value = options[name];
            break;
        }
    }
    const capacity = requirePositiveInteger(value, label);
    if (capacity > maximum) {
        throw new RangeError(`${label}은(는) ${maximum} 이하여야 합니다.`);
    }
    return capacity;
}

function requirePositiveFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new RangeError(`${label}은(는) 양의 유한 숫자여야 합니다.`);
    }
    return number;
}

function requirePositiveFloat32(value, label) {
    const number = requirePositiveFinite(value, label);
    if (!Number.isFinite(Math.fround(number))) {
        throw new RangeError(`${label}은(는) float32 범위 안이어야 합니다.`);
    }
    return number;
}

function normalizeNonNegativeFinite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function normalizeSize2(value, label) {
    const x = requirePositiveFinite(value?.x ?? value?.width ?? value, `${label}.x`);
    const y = requirePositiveFinite(value?.y ?? value?.height ?? value, `${label}.y`);
    return Object.freeze({ x, y });
}

function captureFailure(stage, error) {
    let name = 'Error';
    let message = 'Unknown error';
    try {
        if (typeof error?.name === 'string' && error.name.length > 0) {
            name = error.name;
        }
    } catch {
        // hostile diagnostics are reduced to stable fallback text
    }
    try {
        if (typeof error?.message === 'string' && error.message.length > 0) {
            message = error.message;
        }
    } catch {
        // hostile diagnostics are reduced to stable fallback text
    }
    return Object.freeze({ stage, name, message });
}

function appliedEventTypeName(type) {
    switch (type) {
        case GPU_CIRCLE_APPLIED_EVENT_TYPE.DAMAGE_APPLIED:
            return 'damage-applied';
        case GPU_CIRCLE_APPLIED_EVENT_TYPE.INTERACTION_ENTER:
            return 'interaction-enter';
        case GPU_CIRCLE_APPLIED_EVENT_TYPE.INTERACTION_CONTINUOUS:
            return 'interaction-continuous';
        case GPU_CIRCLE_APPLIED_EVENT_TYPE.ENEMY_CHARGE_WINDUP_STARTED:
            return 'enemy-charge-windup-started';
        case GPU_CIRCLE_APPLIED_EVENT_TYPE.ENEMY_CHARGE_CONTACT_RECOIL_STARTED:
            return 'enemy-charge-contact-recoil-started';
        case GPU_CIRCLE_APPLIED_EVENT_TYPE.CORE_DAMAGE_REQUEST:
            return 'core-damage-request';
        case GPU_CIRCLE_APPLIED_EVENT_TYPE.ROUTE_ASSIGNED:
            return 'route-assigned';
        case GPU_CIRCLE_APPLIED_EVENT_TYPE.ROUTE_CLOSED:
            return 'route-closed';
        case GPU_CIRCLE_APPLIED_EVENT_TYPE.ROUTE_REOPENED:
            return 'route-reopened';
        case GPU_CIRCLE_APPLIED_EVENT_TYPE.ROUTE_CLEANED:
            return 'route-cleaned';
        default:
            throw new RangeError(`알 수 없는 GPU applied event type입니다: ${type}`);
    }
}

function appliedEventReason(type, flags) {
    if ((flags
            & GPU_CIRCLE_APPLIED_EVENT_FLAG.ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT)
        !== 0) {
        return 'atomic-transform-trigger-first-hit';
    }
    if ((flags & GPU_CIRCLE_APPLIED_EVENT_FLAG.TERRAIN_KILL) !== 0) {
        return 'terrain-kill';
    }
    if ((flags & GPU_CIRCLE_APPLIED_EVENT_FLAG.TERRAIN_CONTACT) !== 0) {
        return 'terrain-interaction';
    }
    if ((flags & GPU_CIRCLE_APPLIED_EVENT_FLAG.TARGET_DIED) !== 0) {
        return 'target-died';
    }
    if (type === GPU_CIRCLE_APPLIED_EVENT_TYPE.ENEMY_CHARGE_WINDUP_STARTED) {
        return 'enemy-charge-windup';
    }
    if (type
        === GPU_CIRCLE_APPLIED_EVENT_TYPE.ENEMY_CHARGE_CONTACT_RECOIL_STARTED) {
        return 'enemy-charge-contact-recoil';
    }
    if (type === GPU_CIRCLE_APPLIED_EVENT_TYPE.CORE_DAMAGE_REQUEST) {
        return 'core-damage-request';
    }
    return type === GPU_CIRCLE_APPLIED_EVENT_TYPE.DAMAGE_APPLIED
        ? 'damage'
        : 'interaction';
}

function deathEventReason(flags) {
    const health = (flags & DEATH_EVENT_FLAG_HEALTH) !== 0;
    const lifetime = (flags & DEATH_EVENT_FLAG_LIFETIME) !== 0;
    if (health && lifetime) {
        return 'health-and-lifetime';
    }
    if (health) {
        return 'health';
    }
    if (lifetime) {
        return 'lifetime';
    }
    return 'unknown';
}

function decodeAppliedEvent(view, offset, sequence) {
    const entityId = view.getUint32(offset, LITTLE_ENDIAN);
    const incarnation = view.getUint32(offset + 4, LITTLE_ENDIAN);
    const otherEntityId = view.getUint32(offset + 8, LITTLE_ENDIAN);
    const otherIncarnation = view.getUint32(offset + 12, LITTLE_ENDIAN);
    const valueFixedPoint = view.getInt32(offset + 16, LITTLE_ENDIAN);
    const eventMeta = view.getUint32(offset + 20, LITTLE_ENDIAN);
    const { type: eventTypeCode, flags } = unpackGpuCircleAppliedEventMeta(eventMeta);
    const eventType = appliedEventTypeName(eventTypeCode);
    const isRouteEvent = eventTypeCode
            === GPU_CIRCLE_APPLIED_EVENT_TYPE.ROUTE_ASSIGNED
        || eventTypeCode === GPU_CIRCLE_APPLIED_EVENT_TYPE.ROUTE_CLOSED
        || eventTypeCode === GPU_CIRCLE_APPLIED_EVENT_TYPE.ROUTE_REOPENED
        || eventTypeCode === GPU_CIRCLE_APPLIED_EVENT_TYPE.ROUTE_CLEANED;
    if (isRouteEvent) {
        const position = Object.freeze({
            x: view.getFloat32(offset + 24, LITTLE_ENDIAN),
            y: view.getFloat32(offset + 28, LITTLE_ENDIAN)
        });
        if (flags !== 0
            || entityId === 0 || entityId === UINT32_MAX
            || incarnation === 0 || incarnation === UINT32_MAX
            || otherEntityId === UINT32_MAX
            || otherIncarnation === 0 || otherIncarnation === UINT32_MAX
            || valueFixedPoint <= 0
            || !Number.isFinite(position.x)
            || !Number.isFinite(position.y)) {
            throw new RangeError('GPU route applied event 계약이 잘못되었습니다.');
        }
        return Object.freeze({
            type: 'route',
            eventType,
            eventTypeCode,
            sequence,
            entityId,
            incarnation,
            ownerHandle: Object.freeze({ entityId, incarnation }),
            routeIndex: otherEntityId,
            leaseGeneration: otherIncarnation,
            availabilityVersion: valueFixedPoint,
            position,
            valueFixedPoint,
            eventMeta,
            flags,
            reason: eventType
        });
    }
    const isDamage = eventTypeCode === GPU_CIRCLE_APPLIED_EVENT_TYPE.DAMAGE_APPLIED;
    const isChargeBehavior = eventTypeCode
            === GPU_CIRCLE_APPLIED_EVENT_TYPE.ENEMY_CHARGE_WINDUP_STARTED
        || eventTypeCode
            === GPU_CIRCLE_APPLIED_EVENT_TYPE.ENEMY_CHARGE_CONTACT_RECOIL_STARTED;
    const isCoreDamageRequest = eventTypeCode
        === GPU_CIRCLE_APPLIED_EVENT_TYPE.CORE_DAMAGE_REQUEST;
    const maximumDamageWindow = (
        flags & GPU_CIRCLE_APPLIED_EVENT_FLAG.MAXIMUM_DAMAGE_WINDOW
    ) !== 0;
    const directionalDefense = (
        flags & GPU_CIRCLE_APPLIED_EVENT_FLAG.DIRECTIONAL_DEFENSE
    ) !== 0;
    const atomicTransformTriggerFirstHit = (
        flags
            & GPU_CIRCLE_APPLIED_EVENT_FLAG.ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT
    ) !== 0;
    const policyFlags = flags & APPLIED_EVENT_POLICY_FLAGS;
    const expectedPolicyFlags = eventTypeCode
        === GPU_CIRCLE_APPLIED_EVENT_TYPE.INTERACTION_ENTER
        ? GPU_CIRCLE_APPLIED_EVENT_FLAG.ENTER_POLICY
        : eventTypeCode === GPU_CIRCLE_APPLIED_EVENT_TYPE.INTERACTION_CONTINUOUS
            ? GPU_CIRCLE_APPLIED_EVENT_FLAG.CONTINUOUS_POLICY
            : policyFlags;
    const unknownFlags = (flags & ~APPLIED_EVENT_KNOWN_FLAGS) >>> 0;
    const contactFlagsInvalid = !isChargeBehavior && !isCoreDamageRequest && (
        (policyFlags !== GPU_CIRCLE_APPLIED_EVENT_FLAG.ENTER_POLICY
            && policyFlags !== GPU_CIRCLE_APPLIED_EVENT_FLAG.CONTINUOUS_POLICY)
        || policyFlags !== expectedPolicyFlags
        || (Number(maximumDamageWindow)
            + Number(directionalDefense)
            + Number(atomicTransformTriggerFirstHit) > 1)
        || (!isDamage
            && ((flags & GPU_CIRCLE_APPLIED_EVENT_FLAG.TARGET_DIED) !== 0
                || maximumDamageWindow
                || directionalDefense
                || atomicTransformTriggerFirstHit))
    );
    if (unknownFlags !== 0
        || contactFlagsInvalid
        || ((isChargeBehavior || isCoreDamageRequest) && flags !== 0)) {
        throw new RangeError(
            `GPU applied event type/flags contract가 잘못되었습니다: type=${eventTypeCode}, flags=${flags}`
        );
    }
    if ((!isDamage && !isCoreDamageRequest && valueFixedPoint !== 0)
        || (isCoreDamageRequest && valueFixedPoint <= 0)
        || (atomicTransformTriggerFirstHit && valueFixedPoint !== 0)
        || (isDamage && (valueFixedPoint < 0
            || (valueFixedPoint === 0
                && (flags & GPU_CIRCLE_APPLIED_EVENT_FLAG.TARGET_DIED) !== 0)
            || (valueFixedPoint === 0
                && !maximumDamageWindow
                && !directionalDefense
                && !atomicTransformTriggerFirstHit)))) {
        throw new RangeError(
            `GPU applied event value/type contract가 잘못되었습니다: type=${eventTypeCode}, value=${valueFixedPoint}`
        );
    }
    const terrain = (flags & GPU_CIRCLE_APPLIED_EVENT_FLAG.TERRAIN_CONTACT) !== 0;
    const terrainKill = (flags & GPU_CIRCLE_APPLIED_EVENT_FLAG.TERRAIN_KILL) !== 0;
    if ((terrainKill && !terrain)
        || (terrain && isDamage)
        || (terrain && (otherEntityId !== 0 || otherIncarnation !== 0))
        || (!terrain && (otherEntityId === 0 || otherIncarnation === 0))) {
        throw new RangeError(
            `GPU applied event terrain/other contract가 잘못되었습니다: flags=${flags}, other=${otherEntityId}:${otherIncarnation}`
        );
    }
    const other = terrain
        ? null
        : Object.freeze({ entityId: otherEntityId, incarnation: otherIncarnation });
    return Object.freeze({
        type: 'contact',
        eventType,
        eventTypeCode,
        sequence,
        entityId,
        incarnation,
        other,
        otherEntityId: terrain ? null : otherEntityId,
        otherIncarnation: terrain ? null : otherIncarnation,
        position: Object.freeze({
            x: view.getFloat32(offset + 24, LITTLE_ENDIAN),
            y: view.getFloat32(offset + 28, LITTLE_ENDIAN)
        }),
        valueFixedPoint,
        damageFixedPoint: isDamage ? valueFixedPoint : 0,
        damage: isDamage ? decodeGpuCircleBodyFixedPoint(valueFixedPoint) : 0,
        eventMeta,
        flags,
        maximumDamageWindow,
        directionalDefense,
        atomicTransformTriggerFirstHit,
        reason: appliedEventReason(eventTypeCode, flags)
    });
}

function decodeDeathEvent(view, offset, sequence) {
    const flags = view.getUint32(offset + 12, LITTLE_ENDIAN);
    return Object.freeze({
        type: 'death',
        eventType: 'death',
        sequence,
        entityId: view.getUint32(offset, LITTLE_ENDIAN),
        incarnation: view.getUint32(offset + 4, LITTLE_ENDIAN),
        bodyId: view.getUint32(offset + 8, LITTLE_ENDIAN),
        other: null,
        otherEntityId: null,
        otherIncarnation: null,
        position: null,
        damageFixedPoint: 0,
        valueFixedPoint: 0,
        damage: 0,
        flags,
        reason: deathEventReason(flags)
    });
}

function requirePlatformPort(port) {
    const methods = [
        'getState',
        'getDevice',
        'getCanvasFormat',
        'getDeviceGeneration',
        'acquireFrameTarget',
        'clearCanvas',
        'markCanvasDrawn',
        'markCanvasCleared'
    ];
    if (!port || methods.some((method) => typeof port[method] !== 'function')) {
        throw new TypeError('GpuCircleBodySimulation에 유효한 WebGPU platform port가 필요합니다.');
    }
    return port;
}

function normalizeSignedDistanceField(sdf) {
    if (!sdf) {
        return Object.freeze({
            enabled: false,
            cols: 1,
            rows: 1,
            values: new Float32Array([3.4028234663852886e38])
        });
    }
    const cols = requirePositiveInteger(sdf.cols ?? sdf.width, 'sdf.cols');
    const rows = requirePositiveInteger(sdf.rows ?? sdf.height, 'sdf.rows');
    const source = sdf.values ?? sdf.data;
    if (!(source instanceof Float32Array) || source.length !== cols * rows) {
        throw new TypeError('SDF values는 cols*rows 길이의 Float32Array여야 합니다.');
    }
    const values = source.slice();
    for (let index = 0; index < values.length; index++) {
        if (!Number.isFinite(values[index])) {
            throw new TypeError(`SDF 값은 모두 유한해야 합니다: index=${index}`);
        }
    }
    return Object.freeze({ enabled: true, cols, rows, values });
}

function normalizeFlowFieldAtlas(atlas) {
    if (!atlas) {
        return Object.freeze({
            enabled: false,
            cols: 1,
            rows: 1,
            fieldCount: 0,
            origin: Object.freeze({ x: 0, y: 0 }),
            cellSize: Object.freeze({ x: 1, y: 1 }),
            directions: new Float32Array([0, 0]),
            integrationCosts: new Float32Array([
                FLOW_INTEGRATION_UNREACHABLE_COST
            ]),
            stages: Object.freeze([]),
            contentKey: null,
            routeGraph: null
        });
    }
    const cols = requirePositiveInteger(atlas.cols ?? atlas.width, 'flowFieldAtlas.cols');
    const rows = requirePositiveInteger(atlas.rows ?? atlas.height, 'flowFieldAtlas.rows');
    const fieldCount = requirePositiveInteger(
        atlas.fieldCount ?? atlas.stages?.length,
        'flowFieldAtlas.fieldCount'
    );
    if (fieldCount > GPU_CIRCLE_BODY_FLOW.MAX_FIELD_COUNT) {
        throw new RangeError(
            `flow field atlas는 ${GPU_CIRCLE_BODY_FLOW.MAX_FIELD_COUNT} layer 이하여야 합니다.`
        );
    }
    const sourceDirections = atlas.directions ?? atlas.values;
    if (!(sourceDirections instanceof Float32Array)
        || sourceDirections.length !== cols * rows * fieldCount * 2) {
        throw new TypeError('flow field directions는 cols*rows*fieldCount*2 길이여야 합니다.');
    }
    const directions = sourceDirections.slice();
    for (let index = 0; index < directions.length; index++) {
        if (!Number.isFinite(directions[index])) {
            throw new TypeError(`flow field 방향은 모두 유한해야 합니다: index=${index}`);
        }
    }
    const sourceIntegrationCosts = atlas.integrationCosts;
    let integrationCosts;
    if (sourceIntegrationCosts === undefined) {
        // Legacy/test atlases can still drive ordinary flow. Pentagon steering
        // sees unreachable costs and therefore falls back to prepared flow.
        integrationCosts = new Float32Array(cols * rows * fieldCount);
        integrationCosts.fill(FLOW_INTEGRATION_UNREACHABLE_COST);
    } else {
        if (!(sourceIntegrationCosts instanceof Float32Array)
            || sourceIntegrationCosts.length !== cols * rows * fieldCount) {
            throw new TypeError(
                'flow field integrationCosts는 cols*rows*fieldCount 길이여야 합니다.'
            );
        }
        integrationCosts = sourceIntegrationCosts.slice();
        for (let index = 0; index < integrationCosts.length; index++) {
            if (!Number.isFinite(integrationCosts[index])) {
                throw new TypeError(
                    `flow field integration cost는 모두 유한해야 합니다: index=${index}`
                );
            }
        }
    }
    if (!Array.isArray(atlas.stages) || atlas.stages.length !== fieldCount) {
        throw new TypeError('flow field stages는 fieldCount 길이의 배열이어야 합니다.');
    }
    const cellSize = normalizeSize2(atlas.cellSize, 'flowFieldAtlas.cellSize');
    const defaultTransitionRadius = Math.min(cellSize.x, cellSize.y) * 0.75;
    const atlasTransitionRadius = atlas.transitionRadius === undefined
        ? defaultTransitionRadius
        : requirePositiveFloat32(
            atlas.transitionRadius,
            'flowFieldAtlas.transitionRadius'
        );
    const stages = atlas.stages.map((stage, index) => {
        const column = stage?.goalCell?.column ?? stage?.goalCell?.x;
        const row = stage?.goalCell?.row ?? stage?.goalCell?.y;
        const goalX = Number(stage?.goalPosition?.x);
        const goalY = Number(stage?.goalPosition?.y);
        const nextFieldIndex = Number(stage?.nextFieldIndex ?? -1);
        if (!Number.isInteger(column)
            || !Number.isInteger(row)
            || column < 0
            || column >= cols
            || row < 0
            || row >= rows) {
            throw new RangeError(`flow field goalCell이 atlas 범위를 벗어났습니다: index=${index}`);
        }
        if (!Number.isFinite(goalX)
            || !Number.isFinite(goalY)
            || !Number.isFinite(Math.fround(goalX))
            || !Number.isFinite(Math.fround(goalY))) {
            throw new TypeError(
                `flow field goalPosition은 유한한 float32여야 합니다: index=${index}`
            );
        }
        if (!Number.isInteger(nextFieldIndex)
            || nextFieldIndex < -1
            || nextFieldIndex >= fieldCount) {
            throw new RangeError(`flow field nextFieldIndex가 유효하지 않습니다: index=${index}`);
        }
        const transitionRadius = stage?.transitionRadius === undefined
            ? atlasTransitionRadius
            : requirePositiveFloat32(
                stage.transitionRadius,
                `flowFieldAtlas.stages[${index}].transitionRadius`
            );
        return Object.freeze({
            column,
            row,
            goalPosition: Object.freeze({ x: goalX, y: goalY }),
            nextFieldIndex,
            transitionRadius
        });
    });
    const originX = Number(atlas.origin?.x ?? 0);
    const originY = Number(atlas.origin?.y ?? 0);
    if (!Number.isFinite(originX) || !Number.isFinite(originY)) {
        throw new TypeError('flow field origin은 유한해야 합니다.');
    }
    return Object.freeze({
        enabled: true,
        cols,
        rows,
        fieldCount,
        origin: Object.freeze({ x: originX, y: originY }),
        cellSize,
        directions,
        integrationCosts,
        stages: Object.freeze(stages),
        contentKey: String(atlas.contentKey ?? ''),
        routeGraph: atlas.routeGraph ?? null
    });
}

function createBuffer(device, label, size, usage) {
    return device.createBuffer({ label, size, usage });
}

function writeRenderStyle(view, index, body) {
    const offset = index * BODY_RENDER_STYLE_STRIDE;
    const sourceColor = body.renderStyle?.color ?? body.color ?? [1, 0.24, 0.18, 1];
    const components = Array.isArray(sourceColor) || ArrayBuffer.isView(sourceColor)
        ? sourceColor
        : [sourceColor.r, sourceColor.g, sourceColor.b, sourceColor.a];
    for (let component = 0; component < 4; component++) {
        const fallback = component === 3 ? 1 : 0;
        const value = Math.min(1, normalizeNonNegativeFinite(components[component], fallback));
        view.setFloat32(
            offset + GPU_CIRCLE_BODY_ABI.RENDER_STYLE.COLOR_RED
                + (component * FLOAT32_BYTES),
            value,
            LITTLE_ENDIAN
        );
    }
    const radiusScale = requirePositiveFinite(
        body.renderStyle?.radiusScale ?? body.radiusScale ?? 1,
        'renderStyle.radiusScale'
    );
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.RENDER_STYLE.RADIUS_SCALE,
        radiusScale,
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.RENDER_STYLE.VISIBLE,
        body.renderStyle?.visible === false || body.visible === false ? 0 : 1,
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.RENDER_STYLE.SHAPE_CODE,
        normalizeGpuCircleBodyRenderShapeCode(
            body.renderStyle?.shapeCode
                ?? body.shapeCode
                ?? GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE
        ),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.RENDER_STYLE.RESERVED,
        0,
        LITTLE_ENDIAN
    );
}

const TOMBSTONE_BODY = Object.freeze({
    position: Object.freeze({ x: 0, y: 0 }),
    velocity: Object.freeze({ x: 0, y: 0 }),
    radius: 0,
    inverseMass: 0,
    bodyLayer: 0,
    collisionMask: 0,
    interactionLayer: 0,
    interactionMask: 0,
    teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
    allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
    alive: false,
    visible: false
});

function normalizeEntityHandle(source, label, required = true) {
    const entityIdValue = source?.entityId ?? source?.handle?.entityId;
    const incarnationValue = source?.incarnation ?? source?.handle?.incarnation;
    const hasEntityId = entityIdValue !== undefined && entityIdValue !== null;
    const hasIncarnation = incarnationValue !== undefined && incarnationValue !== null;
    if (!hasEntityId && !hasIncarnation && !required) {
        return null;
    }
    if (!hasEntityId || !hasIncarnation) {
        throw new TypeError(`${label}에는 entityId와 incarnation이 모두 필요합니다.`);
    }
    const entityId = Number(entityIdValue);
    const incarnation = Number(incarnationValue);
    if (!Number.isSafeInteger(entityId) || entityId < 0 || entityId >= UINT32_MAX) {
        throw new RangeError(`${label}.entityId는 reserved sentinel 미만의 uint32 정수여야 합니다.`);
    }
    if (!Number.isSafeInteger(incarnation) || incarnation < 0 || incarnation >= UINT32_MAX) {
        throw new RangeError(`${label}.incarnation은 reserved sentinel 미만의 uint32 정수여야 합니다.`);
    }
    return Object.freeze({ entityId: entityId >>> 0, incarnation: incarnation >>> 0 });
}

function entityHandleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function copyBodySlot(sourceStorage, sourceIndex, targetStorage, targetIndex) {
    for (const [bufferName, stride] of [
        ['physicsBuffer', GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE],
        ['simulationBuffer', GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE],
        ['temporaryBuffer', GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE],
        ['contactHandlerBuffer', GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE],
        ['combatStateBuffer', GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE],
        [
            'atomicTransformStateBuffer',
            GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE.STRIDE
        ],
        [
            'projectileCaptureStateBuffer',
            GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE.STRIDE
        ],
        [
            'projectileCaptureCandidateBuffer',
            GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_CANDIDATE.STRIDE
        ],
        [
            'enemyBehaviorStateBuffer',
            GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE
        ]
    ]) {
        new Uint8Array(targetStorage[bufferName], targetIndex * stride, stride).set(
            new Uint8Array(sourceStorage[bufferName], sourceIndex * stride, stride)
        );
    }
}

function copyEffectBodySlot(sourceStorage, sourceIndex, targetStorage, targetIndex) {
    for (const [bufferName, stride] of [
        ['summaryBuffer', GPU_EFFECT_RUNTIME_ABI.SUMMARY.STRIDE],
        ['emitterStateBuffer', GPU_EFFECT_RUNTIME_ABI.EMITTER_STATE.STRIDE]
    ]) {
        new Uint8Array(targetStorage[bufferName], targetIndex * stride, stride).set(
            new Uint8Array(sourceStorage[bufferName], sourceIndex * stride, stride)
        );
    }
}

function copyFormationBodySlot(source, sourceIndex, target, targetIndex) {
    const stride = GPU_FORMATION_RUNTIME_ABI.BODY_STATE.STRIDE;
    new Uint8Array(target, targetIndex * stride, stride).set(
        new Uint8Array(source, sourceIndex * stride, stride)
    );
}

function copyRenderStyleSlot(source, sourceIndex, target, targetIndex) {
    new Uint8Array(target, targetIndex * BODY_RENDER_STYLE_STRIDE, BODY_RENDER_STYLE_STRIDE).set(
        new Uint8Array(source, sourceIndex * BODY_RENDER_STYLE_STRIDE, BODY_RENDER_STYLE_STRIDE)
    );
}

function clearBodyControlStateSlot(buffer, index) {
    const abi = GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_STATE;
    const view = new DataView(buffer);
    const offset = index * abi.STRIDE;
    new Uint8Array(buffer, offset, abi.STRIDE).fill(0);
    view.setFloat32(offset + abi.MOVE_INTENT_X, 0, LITTLE_ENDIAN);
    view.setFloat32(offset + abi.MOVE_INTENT_Y, 0, LITTLE_ENDIAN);
    view.setUint32(
        offset + abi.ENTITY_ID,
        GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT,
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + abi.INCARNATION,
        GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT,
        LITTLE_ENDIAN
    );
    for (const field of [
        abi.SELECTED_TARGET_SLOT,
        abi.SELECTED_TARGET_ENTITY_ID,
        abi.SELECTED_TARGET_INCARNATION
    ]) {
        view.setUint32(
            offset + field,
            GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT,
            LITTLE_ENDIAN
        );
    }
}

function createInvalidTrackedPoseSnapshot(reason = 'unconfigured') {
    return Object.freeze({
        valid: false,
        entityId: null,
        incarnation: null,
        sourceTick: 0,
        submittedTick: 0,
        observedThroughTick: 0,
        position: null,
        previousPosition: null,
        velocity: null,
        sessionGeneration: null,
        deviceGeneration: null,
        authoritativeEpoch: null,
        ageTicks: null,
        reason
    });
}

function freezeTrackedPoseSnapshot(values) {
    const position = Object.freeze({
        x: values.position.x,
        y: values.position.y
    });
    const previousPosition = Object.freeze({
        x: values.previousPosition.x,
        y: values.previousPosition.y
    });
    const velocity = Object.freeze({
        x: values.velocity.x,
        y: values.velocity.y
    });
    return Object.freeze({
        valid: true,
        entityId: values.entityId,
        incarnation: values.incarnation,
        sourceTick: values.sourceTick,
        submittedTick: values.submittedTick,
        observedThroughTick: values.sourceTick,
        position,
        previousPosition,
        velocity,
        sessionGeneration: values.sessionGeneration,
        deviceGeneration: values.deviceGeneration,
        authoritativeEpoch: values.authoritativeEpoch,
        ageTicks: 0,
        reason: null
    });
}

function freezeFixedProgramStageResult({
    controlAccepted = 0,
    controlRejected = 0,
    spawnAccepted = 0,
    spawnRejected = 0,
    controlReason = null,
    spawnReason = null,
    reason = controlReason ?? spawnReason ?? null,
    requiresRecovery = false,
    destinationHandles = Object.freeze([])
}) {
    return Object.freeze({
        accepted: controlAccepted + spawnAccepted,
        rejected: controlRejected + spawnRejected,
        reason,
        requiresRecovery,
        controlCount: controlAccepted,
        sourceRelativeSpawnCount: spawnAccepted,
        controls: Object.freeze({
            accepted: controlAccepted,
            rejected: controlRejected,
            reason: controlReason
        }),
        sourceRelativeSpawns: Object.freeze({
            accepted: spawnAccepted,
            rejected: spawnRejected,
            reason: spawnReason
        }),
        destinationHandles
    });
}

/**
 * @class GpuCircleBodySimulation
 * @description 원본 GPU circle flow/solver pass와 stable-slot indirect presentation을 소유합니다.
 */
export class GpuCircleBodySimulation {
    /**
     * @param {object} webGpuPlatformPort - DisplaySystem이 소유한 WebGPU 플랫폼 port입니다.
     * @param {object} options - session 고정 설정입니다.
     */
    constructor(webGpuPlatformPort, options = {}) {
        this.platform = requirePlatformPort(webGpuPlatformPort);
        this.sessionGeneration = options.sessionGeneration === undefined
            ? 1
            : requirePositiveInteger(options.sessionGeneration, 'sessionGeneration');
        this.capacity = requirePositiveInteger(options.capacity ?? 16384, 'capacity');
        const defaultContactCapacity = Math.min(
            Math.max(this.capacity * 4, DEFAULT_MIN_CONTACT_CAPACITY),
            DEFAULT_MAX_CONTACT_CAPACITY
        );
        this.contactCapacity = resolveCapacityOption(
            options,
            ['contactCapacity', 'maxContacts'],
            defaultContactCapacity,
            DEFAULT_MAX_CONTACT_CAPACITY,
            'contactCapacity'
        );
        this.eventCapacity = resolveCapacityOption(
            options,
            ['eventCapacity', 'maxEvents'],
            Math.min(this.contactCapacity, DEFAULT_MAX_EVENT_CAPACITY),
            this.contactCapacity,
            'eventCapacity'
        );
        this.deathEventCapacity = resolveCapacityOption(
            options,
            ['deathEventCapacity', 'maxDeathEvents'],
            this.capacity,
            this.capacity,
            'deathEventCapacity'
        );
        this.controlCommandCapacity = resolveCapacityOption(
            options,
            ['controlCommandCapacity'],
            Math.min(this.capacity, 256),
            this.capacity,
            'controlCommandCapacity'
        );
        this.spawnProgramCapacity = resolveCapacityOption(
            options,
            ['spawnProgramCapacity'],
            Math.min(this.capacity, 64),
            this.capacity,
            'spawnProgramCapacity'
        );
        this.effectPulseProgramCapacity = resolveCapacityOption(
            options,
            ['effectPulseProgramCapacity'],
            Math.min(this.capacity, 256),
            this.capacity,
            'effectPulseProgramCapacity'
        );
        this.formationPrepareCapacity = resolveCapacityOption(
            options,
            ['formationPrepareCapacity', 'formationCommandCapacity'],
            Math.min(this.capacity, 256),
            this.capacity,
            'formationPrepareCapacity'
        );
        this.formationTransformCapacity = resolveCapacityOption(
            options,
            ['formationTransformCapacity'],
            Math.max(1, Math.min(Math.floor(this.capacity / 2), 128)),
            Math.max(1, Math.floor(this.capacity / 2)),
            'formationTransformCapacity'
        );
        this.atomicTransformPrepareCapacity = this.capacity;
        this.atomicTransformCapacity = resolveCapacityOption(
            options,
            ['atomicTransformCapacity', 'atomicTransformCommandCapacity'],
            Math.min(this.capacity, 4),
            Math.min(this.capacity, 4),
            'atomicTransformCapacity'
        );
        this.effectInstanceCapacity = resolveCapacityOption(
            options,
            ['effectInstanceCapacity'],
            Math.min(this.capacity * 4, DEFAULT_MAX_EFFECT_INSTANCE_CAPACITY),
            DEFAULT_MAX_EFFECT_INSTANCE_CAPACITY,
            'effectInstanceCapacity'
        );
        this.effectCandidateCapacity = resolveCapacityOption(
            options,
            ['effectCandidateCapacity'],
            Math.min(this.capacity * 2, DEFAULT_MAX_EFFECT_CANDIDATE_CAPACITY),
            DEFAULT_MAX_EFFECT_CANDIDATE_CAPACITY,
            'effectCandidateCapacity'
        );
        this.effectEventCapacity = resolveCapacityOption(
            options,
            ['effectEventCapacity'],
            Math.min(
                this.effectCandidateCapacity + this.effectPulseProgramCapacity,
                DEFAULT_MAX_EFFECT_EVENT_CAPACITY
            ),
            DEFAULT_MAX_EFFECT_EVENT_CAPACITY,
            'effectEventCapacity'
        );
        this.projectileCaptureCompletionCapacity = resolveCapacityOption(
            options,
            ['projectileCaptureCompletionCapacity'],
            Math.min(this.capacity, DEFAULT_PROJECTILE_CAPTURE_COMPLETION_CAPACITY),
            this.capacity,
            'projectileCaptureCompletionCapacity'
        );
        this.projectileCaptureReleasePreparationCapacity = resolveCapacityOption(
            options,
            ['projectileCaptureReleasePreparationCapacity'],
            this.projectileCaptureCompletionCapacity,
            this.capacity,
            'projectileCaptureReleasePreparationCapacity'
        );
        this.projectileCaptureCleanupCapacity = resolveCapacityOption(
            options,
            ['projectileCaptureCleanupCapacity'],
            this.projectileCaptureCompletionCapacity,
            this.capacity,
            'projectileCaptureCleanupCapacity'
        );
        this.worldSize = normalizeSize2(options.worldSize, 'worldSize');
        this.gridCellSize = normalizeSize2(options.gridCellSize ?? 1, 'gridCellSize');
        this.maxBodiesPerCell = requirePositiveInteger(
            options.maxBodiesPerCell ?? SOURCE_MAX_BODIES_PER_CELL,
            'maxBodiesPerCell'
        );
        if (this.maxBodiesPerCell !== SOURCE_MAX_BODIES_PER_CELL) {
            throw new RangeError(
                `원본 GPU grid bucket capacity는 ${SOURCE_MAX_BODIES_PER_CELL}로 고정됩니다.`
            );
        }
        this.solverIterations = requirePositiveInteger(
            options.solverIterations ?? SOURCE_SOLVER_ITERATIONS,
            'solverIterations'
        );
        this.velocityDamping = normalizeNonNegativeFinite(options.velocityDamping, 0);
        this.maxSpeed = normalizeNonNegativeFinite(options.maxSpeed, 0);
        this.sdf = normalizeSignedDistanceField(options.sdf);
        this.flowFieldAtlas = normalizeFlowFieldAtlas(options.flowFieldAtlas);
        this.routeRuntimeTopology = createGpuRouteRuntimeTopology(
            this.flowFieldAtlas
        );
        const inferredSourceWorldUnitScale = this.sdf.enabled
            ? Math.min(
                this.worldSize.x / this.sdf.cols,
                this.worldSize.y / this.sdf.rows
            ) / SOURCE_SDF_CELL_WORLD_UNITS
            : Math.min(this.gridCellSize.x, this.gridCellSize.y)
                / SOURCE_GRID_CELL_WORLD_UNITS;
        this.sourceWorldUnitScale = requirePositiveFinite(
            options.sourceWorldUnitScale ?? inferredSourceWorldUnitScale,
            'sourceWorldUnitScale'
        );
        this.gridCellCount = Object.freeze({
            x: Math.ceil(this.worldSize.x / this.gridCellSize.x),
            y: Math.ceil(this.worldSize.y / this.gridCellSize.y)
        });
        this.gridCellTotal = this.gridCellCount.x * this.gridCellCount.y;
        this.gridEntryCapacity = this.gridCellTotal
            * GRID_BUCKET_COUNT
            * this.maxBodiesPerCell;
        this.presentationClock = new GpuBodyPresentationClock({
            profile: options.presentationProfile
                ?? GPU_BODY_PRESENTATION_PROFILE.REFERENCE_CLOCK_EXTRAPOLATION
        });
        this.hostStorage = createGpuCircleBodyAbiStorage(this.capacity);
        this.hostRouteRuntimeStates = createGpuRouteRuntimeStateBuffer(
            this.capacity
        );
        this.hostRouteAvailability = createGpuRouteAvailabilityBuffer(
            this.routeRuntimeTopology,
            {
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: 0,
                authoritativeEpoch: 1
            }
        );
        this.hostRouteCleanupProgram = createGpuRouteCleanupProgram(
            GPU_ROUTE_RUNTIME_MAX_CLOSERS
        );
        this.routeRuntimeParamsBytes = new ArrayBuffer(
            GPU_ROUTE_RUNTIME_ABI.PARAMS.STRIDE
        );
        this.hostEffectBodyState = createGpuEffectBodyStateStorage(this.capacity);
        this.hostEffectPoolState = createGpuEffectPoolStateStorage(
            this.sessionGeneration
        );
        this.hostEffectPulseProgram = createGpuEffectPulseProgramStorage(
            this.effectPulseProgramCapacity
        );
        this.hostFormationBodyState = createGpuFormationBodyStateStorage(
            this.capacity
        );
        this.hostFormationPrepareProgram = createGpuFormationPrepareProgramStorage(
            this.formationPrepareCapacity
        );
        this.hostFormationTransformProgram
            = createGpuFormationTransformProgramStorage(
                this.formationTransformCapacity
            );
        this.hostAtomicTransformPrepareProgram
            = createGpuAtomicTransformPrepareStorage(
                this.atomicTransformPrepareCapacity
            );
        this.hostAtomicTransformProgram = createGpuAtomicTransformProgramStorage(
            this.atomicTransformCapacity
        );
        this.hostAtomicTransformTemplateStorage
            = createGpuCircleBodyAbiStorage(this.capacity);
        this.hostAtomicTransformTemplateEffectBodyState
            = createGpuEffectBodyStateStorage(this.capacity);
        this.hostAtomicTransformTemplateFormationBodyState
            = createGpuFormationBodyStateStorage(this.capacity);
        this.hostAtomicTransformTemplateRouteRuntimeStates
            = createGpuRouteRuntimeStateBuffer(this.capacity);
        this.hostAtomicTransformTemplateRenderStyles = new ArrayBuffer(
            BODY_RENDER_STYLE_STRIDE * this.capacity
        );
        this.hostAtomicTransformTemplateBodyControlStates = new ArrayBuffer(
            BODY_CONTROL_STATE_STRIDE * this.capacity
        );
        this.hostRenderStyles = new ArrayBuffer(BODY_RENDER_STYLE_STRIDE * this.capacity);
        this.hostBodyControlStates = new ArrayBuffer(
            BODY_CONTROL_STATE_STRIDE * this.capacity
        );
        for (let slot = 0; slot < this.capacity; slot++) {
            clearBodyControlStateSlot(this.hostBodyControlStates, slot);
        }
        this.hostBodyControlProgram = createGpuBodyControlProgramStorage(
            this.controlCommandCapacity
        );
        this.hostSpawnProgram = createGpuSpawnProgramStorage(
            this.spawnProgramCapacity
        );
        this.hostProjectileCaptureTick = createGpuProjectileCaptureTickStorage(
            this.projectileCaptureCompletionCapacity,
            this.projectileCaptureReleasePreparationCapacity,
            this.projectileCaptureCleanupCapacity
        );
        this.hostProjectileCaptureReleaseProgram
            = createGpuProjectileCaptureReleaseProgramStorage(
                this.projectileCaptureReleasePreparationCapacity
            );
        this.projectileCaptureParamsBytes = new ArrayBuffer(
            PROJECTILE_CAPTURE_PARAMS_BYTE_SIZE
        );
        this.projectileCaptureTargetConfigBytes = new ArrayBuffer(
            PROJECTILE_CAPTURE_TARGET_CONFIG_BYTE_SIZE
        );
        writeGpuCircleBodyCounts(this.hostStorage, { bodyCount: 0 });
        this.bodyCount = 0;
        this.activeBodyCount = 0;
        this.pendingBodyCount = 0;
        this.slotActive = new Uint8Array(this.capacity);
        this.slotEventProducing = new Uint8Array(this.capacity);
        this.slotProjectileCaptureDomain = new Uint8Array(this.capacity);
        this.slotRouteRuntimeDomain = new Uint8Array(this.capacity);
        this.slotHandles = new Array(this.capacity).fill(null);
        this.handleToSlot = new Map();
        this.pendingSlotHandles = new Array(this.capacity).fill(null);
        this.pendingHandleToSlot = new Map();
        this.freeSlots = [];
        this.stagedFixedPrograms = null;
        this.stagedEffectPulseBatch = null;
        this.stagedFormationPrepareBatch = null;
        this.armedFormationTransform = null;
        this.stagedAtomicTransformPrepareBatch = null;
        this.armedAtomicTransform = null;
        this.armedProjectileCaptureRelease = null;
        this.fixedProgramIngressOpen = true;
        this.effectProgramIngressOpen = true;
        this.formationProgramIngressOpen = true;
        this.atomicTransformProgramIngressOpen = true;
        this.projectileCaptureProgramIngressOpen = true;
        this.routeRuntimeIngressOpen = true;
        this.terminalFixedProgramCancelStatus = null;
        this.terminalEffectProgramCancelStatus = null;
        this.terminalFormationProgramCancelStatus = null;
        this.terminalAtomicTransformProgramCancelStatus = null;
        this.terminalProjectileCaptureProgramCancelStatus = null;
        this.terminalRouteAvailabilityProgramCancelStatus = null;
        this.device = null;
        this.deviceGeneration = -1;
        this.canvasFormat = null;
        this.buffers = null;
        this.flowTexture = null;
        this.flowIntegrationTexture = null;
        this.bindGroups = null;
        this.pipelines = null;
        this.state = 'idle';
        this.failure = null;
        this.destroyed = false;
        this.submittedTickCount = 0;
        this.lastSubmittedSourceTick = 0;
        this.hasGpuAuthoritativeState = false;
        this.authoritativeEpoch = 0;
        this.routeAuthoritativeEpoch = 1;
        this.requiresAuthoritativeRebuild = false;
        this.overflowReadbackSlots = [];
        this.overflowReadbackLease = 0;
        this.overflowReadbackCursor = 0;
        this.pendingOverflowReadbacks = 0;
        this.lastOverflowTick = 0;
        this.lastSmallOverflowCount = 0;
        this.lastBigOverflowCount = 0;
        this.totalSmallOverflowCount = 0;
        this.totalBigOverflowCount = 0;
        this.telemetryBackpressureCount = 0;
        this.lastOverflowSampleSubmittedTick = 0;
        this.lastOverflowSampleCompletedTick = 0;
        this.overflowSampleOverdue = false;
        this.eventProducingBodyCount = 0;
        this.atomicTransformFirstHitBodyCount = 0;
        this.maximumBodyRadius = 0;
        this.eventReadbackSlots = [];
        this.eventReadbackLease = 0;
        this.eventReadbackCursor = 0;
        this.pendingEventReadbacks = 0;
        this.eventBatchQueue = [];
        this.bodyControlProgramBatchQueue = [];
        this.eventCompletedThroughTick = 0;
        this.idleReleasePending = false;
        this.eventBackpressureCount = 0;
        this.projectileCaptureDomainBodyCount = 0;
        this.projectileCaptureReadbackSlots = [];
        this.projectileCaptureReadbackLease = 0;
        this.projectileCaptureReadbackCursor = 0;
        this.pendingProjectileCaptureReadbacks = 0;
        this.pendingProjectileCaptureReleaseReadbacks = 0;
        this.projectileCaptureBatchQueue = [];
        this.projectileCaptureReleaseBatchQueue = [];
        this.authenticProjectileCapturePreparationByKey = new Map();
        this.authenticProjectileCaptureCoreImpactReceipts = new WeakSet();
        this.lastProjectileCaptureSourceTick = 0;
        this.projectileCaptureCompletedThroughTick = 0;
        this.lastProjectileCaptureReleaseCommittedTick = 0;
        this.lastProjectileCaptureRuntimeStatus
            = GPU_PROJECTILE_CAPTURE_TICK_STATUS.RESET;
        this.lastProjectileCaptureErrorFlags = 0;
        this.routeRuntimeReadbackSlots = [];
        this.routeRuntimeReadbackLease = 0;
        this.routeRuntimeReadbackCursor = 0;
        this.pendingRouteRuntimeReadbacks = 0;
        this.routeRuntimeBatchQueue = [];
        this.routeRuntimeCompletedThroughTick = 0;
        this.lastRouteRuntimeSourceTick = 0;
        this.lastRouteAvailabilityVersion = 1;
        this.lastRouteRuntimeStatus = 0;
        this.routeRuntimeRosterCount = 0;
        this.stagedRouteCleanupBatch = null;
        this.routeLifecycleReservations = new Map();
        this.nextRouteLifecycleReceiptId = 1;
        this.lastEventReadbackSourceTick = 0;
        this.lastEventReadbackSubmittedTick = 0;
        this.lastEventReadbackCompletedTick = 0;
        this.lastEventStatsTick = 0;
        this.lastContactCount = 0;
        this.lastContactOverflowCount = 0;
        this.lastAppliedEventCount = 0;
        this.lastAppliedEventOverflowCount = 0;
        this.lastDeathEventCount = 0;
        this.lastDeathEventOverflowCount = 0;
        this.lastBodyControlOutcomeCount = 0;
        this.spawnProgramReadbackSlots = [];
        this.spawnProgramReadbackLease = 0;
        this.spawnProgramReadbackCursor = 0;
        this.pendingSpawnProgramReadbacks = 0;
        this.spawnProgramBatchQueue = [];
        this.spawnProgramBackpressureCount = 0;
        this.lastSpawnProgramSourceTick = 0;
        this.lastSpawnProgramResolvedCount = 0;
        this.lastSpawnProgramInvalidCount = 0;
        this.lastSpawnProgramSourceInvalidCount = 0;
        this.lastSpawnProgramTargetInvalidCount = 0;
        this.lastSpawnProgramNoTargetCount = 0;
        this.lastSpawnProgramCoreInvalidCount = 0;
        this.spawnProgramOverflowCount = 0;
        this.effectProgramReadbackSlots = [];
        this.effectProgramReadbackLease = 0;
        this.effectProgramReadbackCursor = 0;
        this.pendingEffectReadbacks = 0;
        this.effectProgramBatchQueue = [];
        this.effectProgramBackpressureCount = 0;
        this.effectActivePoolIndex = 0;
        this.lastEffectProgramSourceTick = 0;
        this.lastEffectProgramSubmittedTick = 0;
        this.lastEffectProgramCompletedTick = 0;
        this.lastEffectProtocolKey = null;
        this.lastEffectProgramCount = 0;
        this.lastEffectCandidateCount = 0;
        this.lastEffectAppliedInstanceCount = 0;
        this.lastEffectEventCount = 0;
        this.lastEffectRuntimeStatus = GPU_EFFECT_RUNTIME_STATUS.OK;
        this.formationPrepareReadbackSlots = [];
        this.formationPrepareReadbackLease = 0;
        this.formationPrepareReadbackCursor = 0;
        this.pendingFormationPrepareReadbacks = 0;
        this.formationTransformReadbackSlots = [];
        this.formationTransformReadbackLease = 0;
        this.formationTransformReadbackCursor = 0;
        this.pendingFormationTransformReadbacks = 0;
        this.formationPrepareBatchQueue = [];
        this.lastFormationProtocolKey = null;
        this.lastFormationPrepareSourceTick = 0;
        this.lastFormationPrepareSubmittedTick = 0;
        this.lastFormationPrepareCompletedTick = 0;
        this.lastFormationTransformCommittedTick = 0;
        this.lastFormationCommittedCount = 0;
        this.lastFormationEffectRekeyCount = 0;
        this.lastFormationRuntimeStatus = GPU_FORMATION_RUNTIME_STATUS.OK;
        this.lastFormationTransformCompletion = null;
        this.authenticFormationPrepareByKey = new Map();
        this.atomicTransformPrepareReadbackSlots = [];
        this.atomicTransformPrepareReadbackLease = 0;
        this.atomicTransformPrepareReadbackCursor = 0;
        this.pendingAtomicTransformPrepareReadbacks = 0;
        this.atomicTransformPrepareBatchQueue = [];
        this.atomicTransformReadbackSlots = [];
        this.atomicTransformReadbackLease = 0;
        this.atomicTransformReadbackCursor = 0;
        this.pendingAtomicTransformReadbacks = 0;
        this.authenticAtomicTransformPrepareByFingerprint = new Map();
        this.lastAtomicTransformPrepareSourceTick = 0;
        this.lastAtomicTransformCommittedCount = 0;
        this.lastAtomicTransformEffectRekeyCount = 0;
        this.lastAtomicTransformRuntimeStatus
            = GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.OK;
        this.towerGameplayTargetConfigBytes = new ArrayBuffer(
            TOWER_GAMEPLAY_TARGET_CONFIG_BYTE_SIZE
        );
        this.towerGameplayTargetHandle = null;
        this.towerGameplayTargetSlot = -1;
        this.trackedPoseConfigBytes = new ArrayBuffer(TRACKED_POSE_CONFIG_BYTE_SIZE);
        this.trackedPoseHandle = null;
        this.trackedPoseSlot = -1;
        this.trackedPoseRevision = 0;
        this.trackedPoseReadbackSlots = [];
        this.trackedPoseReadbackLease = 0;
        this.trackedPoseReadbackCursor = 0;
        this.pendingTrackedPoseReadbacks = 0;
        this.trackedPoseDroppedSamples = 0;
        this.trackedPosePublishedSamples = 0;
        this.latestTrackedPose = createInvalidTrackedPoseSnapshot();
        this.#writeTowerGameplayTargetConfig();
        this.#writeTrackedPoseConfig();
        this.canvasHasDrawnBodies = false;
        this.canvasNeedsInitialClear = true;
        this.pendingComposerCanvasTransition = null;
        this.lastFixedDelta = 1 / 60;
        this.renderOriginScratch = { x: 0, y: 0 };
        this.shaderStateScratch = {};
        this.presentationFrameScratch = {
            frameDelta: 0,
            fixedDelta: this.lastFixedDelta,
            fixedAlpha: 0,
            renderFrameId: undefined
        };
        this.computeParamsBytes = new ArrayBuffer(COMPUTE_PARAMS_BYTE_SIZE);
        this.computeParamsView = new DataView(this.computeParamsBytes);
        this.renderParamsBytes = new ArrayBuffer(RENDER_PARAMS_BYTE_SIZE);
        this.renderParamsView = new DataView(this.renderParamsBytes);
        this.dispatchIndirectArgs = new Uint32Array(3);
        this.drawIndirectArgs = new Uint32Array(4);
        this.overflowResetData = new Uint32Array(4);
        this.uploadedComputeFixedDelta = NaN;
        this.uploadedMaximumBodyRadius = NaN;
        this.uploadedComputeFixedTick = -1;
    }

    /**
     * 현재 Display device generation에 GPU 자원을 생성합니다. 미지원은 non-fatal false입니다.
     * @returns {boolean} 사용 가능한 GPU backend인지 여부입니다.
     */
    init() {
        if (this.destroyed
            || this.requiresAuthoritativeRebuild
            || this.#isOverflowDegradedState()) {
            return false;
        }
        const device = this.platform.getDevice();
        const generation = Number(this.platform.getDeviceGeneration());
        const format = this.platform.getCanvasFormat();
        if (!device || !Number.isSafeInteger(generation) || generation < 0 || !format) {
            this.state = 'unavailable';
            return false;
        }
        if (this.device === device
            && this.deviceGeneration === generation
            && (this.state === 'ready'
                || this.state === 'telemetry-backpressure'
                || this.state === 'event-backpressure')) {
            return true;
        }

        if (this.device
            && (this.device !== device || this.deviceGeneration !== generation)
            && this.hasGpuAuthoritativeState
            && this.bodyCount > 0) {
            this.requiresAuthoritativeRebuild = true;
            this.failure = Object.freeze({
                stage: 'device-generation-change',
                name: 'AuthoritativeStateLost',
                message: 'GPU authoritative body 상태를 새 device에서 자동 재생할 수 없습니다.'
            });
            this.state = 'requires-rebuild';
            this.#releaseGpuResources();
            return false;
        }

        this.#releaseGpuResources();
        this.device = device;
        this.deviceGeneration = generation;
        this.canvasFormat = format;
        try {
            this.#validateDeviceLimits(device);
            this.#createGpuResources(device, format);
            this.#uploadHostState();
            this.state = 'ready';
            this.failure = null;
            return true;
        } catch (error) {
            this.failure = captureFailure('initialization', error);
            this.state = 'failed';
            this.#releaseGpuResources();
            return false;
        }
    }

    /**
     * 진입/authoritative rebuild 전용으로 dense body set을 원자적으로 교체합니다.
     * live spawn에는 사용하지 않으며 capacity 초과는 기존 상태를 보존하고 전부 거부합니다.
     * @param {object[]} bodies - collision body spawn 목록입니다.
     * @returns {{accepted:number,rejected:number,capacity:number}} 반영 결과입니다.
     */
    replaceBodies(bodies) {
        if (!Array.isArray(bodies)) {
            throw new TypeError('GPU circle body 목록은 배열이어야 합니다.');
        }
        if (bodies.length > this.capacity) {
            return Object.freeze({
                accepted: 0,
                rejected: bodies.length,
                capacity: this.capacity
            });
        }
        if (this.routeLifecycleReservations.size !== 0
            || this.stagedRouteCleanupBatch !== null) {
            return Object.freeze({
                accepted: 0,
                rejected: bodies.length,
                capacity: this.capacity,
                reason: 'route-lifecycle-reservation-active'
            });
        }

        const nextStorage = createGpuCircleBodyAbiStorage(this.capacity);
        const nextEffectBodyState = createGpuEffectBodyStateStorage(this.capacity);
        const nextFormationBodyState = createGpuFormationBodyStateStorage(
            this.capacity
        );
        const nextRouteRuntimeStates = createGpuRouteRuntimeStateBuffer(
            this.capacity
        );
        const nextStyles = new ArrayBuffer(BODY_RENDER_STYLE_STRIDE * this.capacity);
        const styleView = new DataView(nextStyles);
        const nextSlotHandles = new Array(this.capacity).fill(null);
        const nextHandleToSlot = new Map();
        const nextEntityIds = new Set();
        for (let index = 0; index < bodies.length; index++) {
            const body = bodies[index];
            this.#validateBody(body, index);
            const routeRuntimeState = this.#resolveRouteRuntimeSpawnState(
                body,
                `body[${index}]`
            );
            const handle = normalizeEntityHandle(body, `body[${index}]`, false);
            if (handle) {
                const key = entityHandleKey(handle);
                if (nextHandleToSlot.has(key)
                    || nextEntityIds.has(handle.entityId)) {
                    throw new RangeError(
                        `활성 body entityId는 incarnation과 무관하게 유일해야 합니다: ${handle.entityId}`
                    );
                }
                nextSlotHandles[index] = handle;
                nextHandleToSlot.set(key, index);
                nextEntityIds.add(handle.entityId);
            }
            writeGpuCircleBodySpawn(nextStorage, index, body);
            writeGpuEffectBodyStateSpawn(nextEffectBodyState, index, body);
            writeGpuFormationBodyStateSpawn(nextFormationBodyState, index, body);
            writeGpuRouteRuntimeState(
                nextRouteRuntimeStates,
                this.capacity,
                index,
                routeRuntimeState
            );
            writeRenderStyle(styleView, index, body);
        }
        writeGpuCircleBodyCounts(nextStorage, { bodyCount: bodies.length });

        if (bodies.length > 0 && !this.requiresAuthoritativeRebuild) {
            if (!this.#ensureReady() && !this.requiresAuthoritativeRebuild) {
                return Object.freeze({
                    accepted: 0,
                    rejected: bodies.length,
                    capacity: this.capacity,
                    reason: this.state
                });
            }
        }

        const replacingSubmittedState = this.submittedTickCount > 0
            || this.pendingOverflowReadbacks > 0
            || this.pendingEventReadbacks > 0
            || this.pendingSpawnProgramReadbacks > 0
            || this.pendingEffectReadbacks > 0
            || this.pendingFormationPrepareReadbacks > 0
            || this.pendingFormationTransformReadbacks > 0
            || this.pendingAtomicTransformPrepareReadbacks > 0
            || this.pendingAtomicTransformReadbacks > 0
            || this.pendingRouteRuntimeReadbacks > 0
            || this.pendingTrackedPoseReadbacks > 0
            || this.eventBatchQueue.length > 0
            || this.bodyControlProgramBatchQueue.length > 0
            || this.spawnProgramBatchQueue.length > 0
            || this.effectProgramBatchQueue.length > 0
            || this.atomicTransformPrepareBatchQueue.length > 0
            || this.routeRuntimeBatchQueue.length > 0
            || this.stagedEffectPulseBatch !== null
            || this.stagedFormationPrepareBatch !== null
            || this.armedFormationTransform !== null
            || this.stagedAtomicTransformPrepareBatch !== null
            || this.armedAtomicTransform !== null
            || this.stagedRouteCleanupBatch !== null
            || this.authenticAtomicTransformPrepareByFingerprint.size > 0
            || this.requiresAuthoritativeRebuild;
        this.hostStorage = nextStorage;
        this.hostEffectBodyState = nextEffectBodyState;
        this.hostFormationBodyState = nextFormationBodyState;
        this.hostRouteRuntimeStates = nextRouteRuntimeStates;
        this.hostRouteAvailability = createGpuRouteAvailabilityBuffer(
            this.routeRuntimeTopology,
            {
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: Math.max(0, this.deviceGeneration),
                authoritativeEpoch: this.routeAuthoritativeEpoch + 1
            }
        );
        this.hostRouteCleanupProgram = createGpuRouteCleanupProgram(
            GPU_ROUTE_RUNTIME_MAX_CLOSERS
        );
        this.hostEffectPoolState = createGpuEffectPoolStateStorage(
            this.authoritativeEpoch + 1
        );
        this.hostEffectPulseProgram = createGpuEffectPulseProgramStorage(
            this.effectPulseProgramCapacity
        );
        this.hostFormationPrepareProgram = createGpuFormationPrepareProgramStorage(
            this.formationPrepareCapacity
        );
        this.hostFormationTransformProgram
            = createGpuFormationTransformProgramStorage(
                this.formationTransformCapacity
            );
        this.hostAtomicTransformPrepareProgram
            = createGpuAtomicTransformPrepareStorage(
                this.atomicTransformPrepareCapacity
            );
        this.hostAtomicTransformProgram = createGpuAtomicTransformProgramStorage(
            this.atomicTransformCapacity
        );
        this.hostAtomicTransformTemplateStorage
            = createGpuCircleBodyAbiStorage(this.capacity);
        this.hostAtomicTransformTemplateEffectBodyState
            = createGpuEffectBodyStateStorage(this.capacity);
        this.hostAtomicTransformTemplateFormationBodyState
            = createGpuFormationBodyStateStorage(this.capacity);
        this.hostAtomicTransformTemplateRouteRuntimeStates
            = createGpuRouteRuntimeStateBuffer(this.capacity);
        this.hostAtomicTransformTemplateRenderStyles = new ArrayBuffer(
            BODY_RENDER_STYLE_STRIDE * this.capacity
        );
        this.hostAtomicTransformTemplateBodyControlStates = new ArrayBuffer(
            BODY_CONTROL_STATE_STRIDE * this.capacity
        );
        this.effectActivePoolIndex = 0;
        this.hostRenderStyles = nextStyles;
        this.bodyCount = bodies.length;
        this.activeBodyCount = bodies.length;
        this.slotActive.fill(0);
        this.slotActive.fill(1, 0, bodies.length);
        this.slotRouteRuntimeDomain.fill(0);
        for (let slot = 0; slot < bodies.length; slot++) {
            this.slotRouteRuntimeDomain[slot]
                = bodies[slot].routeRuntimeState ? 1 : 0;
        }
        this.slotHandles = nextSlotHandles;
        this.handleToSlot = nextHandleToSlot;
        this.pendingSlotHandles.fill(null);
        this.pendingHandleToSlot.clear();
        this.pendingBodyCount = 0;
        this.freeSlots.length = 0;
        for (let slot = 0; slot < this.capacity; slot++) {
            clearBodyControlStateSlot(this.hostBodyControlStates, slot);
        }
        this.stagedFixedPrograms = null;
        this.stagedEffectPulseBatch = null;
        this.stagedFormationPrepareBatch = null;
        this.armedFormationTransform = null;
        this.stagedAtomicTransformPrepareBatch = null;
        this.armedAtomicTransform = null;
        this.effectProgramBatchQueue.length = 0;
        this.pendingEffectReadbacks = 0;
        this.lastEffectProtocolKey = null;
        this.lastEffectProgramSourceTick = 0;
        this.lastEffectProgramSubmittedTick = 0;
        this.lastEffectProgramCompletedTick = 0;
        this.lastEffectProgramCount = 0;
        this.lastEffectCandidateCount = 0;
        this.lastEffectAppliedInstanceCount = 0;
        this.lastEffectEventCount = 0;
        this.lastEffectRuntimeStatus = GPU_EFFECT_RUNTIME_STATUS.OK;
        this.effectProgramBackpressureCount = 0;
        this.formationPrepareBatchQueue.length = 0;
        this.authenticFormationPrepareByKey.clear();
        this.pendingFormationPrepareReadbacks = 0;
        this.pendingFormationTransformReadbacks = 0;
        this.lastFormationProtocolKey = null;
        this.lastFormationPrepareSourceTick = 0;
        this.lastFormationPrepareSubmittedTick = 0;
        this.lastFormationPrepareCompletedTick = 0;
        this.lastFormationTransformCommittedTick = 0;
        this.lastFormationCommittedCount = 0;
        this.lastFormationEffectRekeyCount = 0;
        this.lastFormationRuntimeStatus = GPU_FORMATION_RUNTIME_STATUS.OK;
        this.lastFormationTransformCompletion = null;
        this.atomicTransformPrepareBatchQueue.length = 0;
        this.authenticAtomicTransformPrepareByFingerprint.clear();
        this.pendingAtomicTransformPrepareReadbacks = 0;
        this.pendingAtomicTransformReadbacks = 0;
        this.lastAtomicTransformPrepareSourceTick = 0;
        this.lastAtomicTransformCommittedCount = 0;
        this.lastAtomicTransformEffectRekeyCount = 0;
        this.lastAtomicTransformRuntimeStatus
            = GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.OK;
        this.routeRuntimeReadbackLease++;
        this.routeRuntimeBatchQueue.length = 0;
        this.pendingRouteRuntimeReadbacks = 0;
        this.routeRuntimeReadbackCursor = 0;
        this.routeRuntimeCompletedThroughTick = 0;
        this.lastRouteRuntimeSourceTick = 0;
        this.lastRouteAvailabilityVersion = 1;
        this.lastRouteRuntimeStatus = GPU_ROUTE_RUNTIME_STATUS.OK;
        this.stagedRouteCleanupBatch = null;
        this.routeLifecycleReservations.clear();
        if (this.terminalRouteAvailabilityProgramCancelStatus === null) {
            this.routeRuntimeIngressOpen = true;
        }
        if (this.terminalEffectProgramCancelStatus === null) {
            this.effectProgramIngressOpen = true;
        }
        if (this.terminalFormationProgramCancelStatus === null) {
            this.formationProgramIngressOpen = true;
        }
        if (this.terminalAtomicTransformProgramCancelStatus === null) {
            this.atomicTransformProgramIngressOpen = true;
        }
        this.#invalidateTowerGameplayTarget();
        this.#invalidateTrackedPose('authoritative-replace');
        this.#refreshHostBodyDerivedState();
        this.submittedTickCount = 0;
        this.lastSubmittedSourceTick = 0;
        this.hasGpuAuthoritativeState = false;
        this.authoritativeEpoch++;
        this.routeAuthoritativeEpoch++;
        this.requiresAuthoritativeRebuild = false;
        this.#resetOverflowTelemetry();
        this.#resetContactEventTelemetry();
        if (replacingSubmittedState && this.device) {
            this.#releaseGpuResources();
        }
        if (this.state === 'requires-rebuild'
            || this.#isOverflowDegradedState()
            || this.state === 'telemetry-backpressure'
            || this.state === 'event-backpressure'
            || replacingSubmittedState) {
            this.state = 'idle';
        }

        if (bodies.length === 0) {
            if (this.state === 'ready') {
                this.#uploadHostState();
            }
        } else if (this.#ensureReady()) {
            this.#uploadHostState();
        } else {
            this.bodyCount = 0;
            this.activeBodyCount = 0;
            this.slotActive.fill(0);
            this.slotHandles.fill(null);
            this.handleToSlot.clear();
            this.freeSlots.length = 0;
            writeGpuCircleBodyCounts(this.hostStorage, { bodyCount: 0 });
            this.#refreshHostBodyDerivedState();
            return Object.freeze({
                accepted: 0,
                rejected: bodies.length,
                capacity: this.capacity,
                reason: this.state
            });
        }
        return Object.freeze({
            accepted: bodies.length,
            rejected: 0,
            capacity: this.capacity
        });
    }

    /**
     * GPU가 소유한 기존 body 위치를 건드리지 않고 빈 stable slot에 새 body를 추가합니다.
     * 상위 lifecycle owner가 다음 fixed-step command commit 경계에서만 호출해야 합니다.
     * @param {object[]} bodies - entityId/incarnation을 포함한 spawn batch입니다.
     * @returns {{accepted:number,rejected:number,capacity:number,handles?:object[],reason?:string}}
     * 반영 결과입니다.
     */
    spawnBodies(bodies) {
        if (!Array.isArray(bodies)) {
            throw new TypeError('GPU circle spawn batch는 배열이어야 합니다.');
        }
        if (bodies.length === 0) {
            return Object.freeze({ accepted: 0, rejected: 0, capacity: this.capacity });
        }
        if (bodies.length > this.capacity - this.activeBodyCount - this.pendingBodyCount) {
            return Object.freeze({
                accepted: 0,
                rejected: bodies.length,
                capacity: this.capacity,
                reason: 'capacity'
            });
        }

        const stagingStorage = createGpuCircleBodyAbiStorage(bodies.length);
        const stagingEffectBodyState = createGpuEffectBodyStateStorage(bodies.length);
        const stagingFormationBodyState = createGpuFormationBodyStateStorage(
            bodies.length
        );
        const stagingRouteRuntimeStates = createGpuRouteRuntimeStateBuffer(
            bodies.length
        );
        const stagingStyles = new ArrayBuffer(BODY_RENDER_STYLE_STRIDE * bodies.length);
        const stagingStyleView = new DataView(stagingStyles);
        const handles = new Array(bodies.length);
        const batchKeys = new Set();
        const occupiedEntityIds = new Set();
        for (let slot = 0; slot < this.bodyCount; slot++) {
            const handle = this.slotActive[slot] === 1
                ? this.slotHandles[slot]
                : this.slotActive[slot] === 2
                    ? this.pendingSlotHandles[slot]
                    : null;
            if (!handle) {
                continue;
            }
            if (occupiedEntityIds.has(handle.entityId)) {
                throw new Error(
                    `GPU active/pending entityId mapping이 중복되었습니다: ${handle.entityId}`
                );
            }
            occupiedEntityIds.add(handle.entityId);
        }
        const batchEntityIds = new Set();
        const startsNewAuthoritativeEpoch = this.activeBodyCount === 0;
        for (let index = 0; index < bodies.length; index++) {
            const body = bodies[index];
            this.#validateBody(body, index);
            const routeRuntimeState = this.#resolveRouteRuntimeSpawnState(
                body,
                `spawn[${index}]`
            );
            const handle = normalizeEntityHandle(body, `spawn[${index}]`);
            const key = entityHandleKey(handle);
            if (batchKeys.has(key)
                || this.handleToSlot.has(key)
                || this.pendingHandleToSlot.has(key)
                || batchEntityIds.has(handle.entityId)
                || occupiedEntityIds.has(handle.entityId)) {
                throw new RangeError(`이미 활성 상태인 enemy handle입니다: ${key}`);
            }
            batchKeys.add(key);
            batchEntityIds.add(handle.entityId);
            handles[index] = handle;
            writeGpuCircleBodySpawn(stagingStorage, index, body);
            writeGpuEffectBodyStateSpawn(stagingEffectBodyState, index, body);
            writeGpuFormationBodyStateSpawn(
                stagingFormationBodyState,
                index,
                body
            );
            writeGpuRouteRuntimeState(
                stagingRouteRuntimeStates,
                bodies.length,
                index,
                routeRuntimeState
            );
            writeRenderStyle(stagingStyleView, index, body);
        }

        if (!this.#ensureReady()) {
            return Object.freeze({
                accepted: 0,
                rejected: bodies.length,
                capacity: this.capacity,
                reason: this.state
            });
        }

        const continuesDeferredAuthoritativeEpoch = startsNewAuthoritativeEpoch
            && this.idleReleasePending;
        const reusedCount = Math.min(this.freeSlots.length, bodies.length);
        const selectedSlots = new Array(bodies.length);
        for (let index = 0; index < reusedCount; index++) {
            selectedSlots[index] = this.freeSlots[this.freeSlots.length - 1 - index];
        }
        for (let index = reusedCount; index < bodies.length; index++) {
            selectedSlots[index] = this.bodyCount + (index - reusedCount);
        }

        for (let index = 0; index < bodies.length; index++) {
            const slot = selectedSlots[index];
            copyBodySlot(stagingStorage, index, this.hostStorage, slot);
            copyEffectBodySlot(
                stagingEffectBodyState,
                index,
                this.hostEffectBodyState,
                slot
            );
            copyFormationBodySlot(
                stagingFormationBodyState,
                index,
                this.hostFormationBodyState,
                slot
            );
            copyGpuRouteRuntimeStateSlot(
                stagingRouteRuntimeStates,
                bodies.length,
                index,
                this.hostRouteRuntimeStates,
                this.capacity,
                slot
            );
            copyRenderStyleSlot(stagingStyles, index, this.hostRenderStyles, slot);
            this.slotActive[slot] = 1;
            this.slotHandles[slot] = handles[index];
            this.handleToSlot.set(entityHandleKey(handles[index]), slot);
            this.slotRouteRuntimeDomain[slot]
                = bodies[index].routeRuntimeState ? 1 : 0;
            clearBodyControlStateSlot(this.hostBodyControlStates, slot);
        }
        this.freeSlots.length -= reusedCount;
        this.bodyCount += bodies.length - reusedCount;
        this.activeBodyCount += bodies.length;
        if (startsNewAuthoritativeEpoch) {
            if (continuesDeferredAuthoritativeEpoch) {
                this.idleReleasePending = false;
            } else {
                this.authoritativeEpoch++;
                this.#resetContactEventTelemetry();
                this.#bindRouteAvailabilityProtocolTuple(true);
            }
        }
        writeGpuCircleBodyCounts(this.hostStorage, { bodyCount: this.bodyCount });
        this.#refreshHostBodyDerivedState();

        try {
            this.#uploadSlotRanges(selectedSlots);
            this.#uploadBodyCountState();
        } catch (error) {
            if (continuesDeferredAuthoritativeEpoch) {
                this.authoritativeEpoch++;
                this.#resetContactEventTelemetry();
            }
            this.idleReleasePending = false;
            this.requiresAuthoritativeRebuild = true;
            this.failure = captureFailure('spawn-upload', error);
            this.state = 'requires-rebuild';
            return Object.freeze({
                accepted: bodies.length,
                rejected: 0,
                capacity: this.capacity,
                reason: this.state,
                requiresRecovery: true,
                handles: Object.freeze(handles)
            });
        }
        return Object.freeze({
            accepted: bodies.length,
            rejected: 0,
            capacity: this.capacity,
            handles: Object.freeze(handles)
        });
    }

    /**
     * stable handle을 tombstone으로 바꾸고 slot을 재사용 목록에 돌려놓습니다.
     * 상위 lifecycle owner가 다음 fixed-step command commit 경계에서만 호출해야 합니다.
     * @param {object[]} handles - entityId/incarnation handle batch입니다.
     * @returns {{removed:number,rejected:number,capacity:number,reason?:string}} 반영 결과입니다.
     */
    despawnBodies(handles) {
        if (!Array.isArray(handles)) {
            throw new TypeError('GPU circle despawn batch는 배열이어야 합니다.');
        }
        if (handles.length === 0) {
            return Object.freeze({ removed: 0, rejected: 0, capacity: this.capacity });
        }

        const batchKeys = new Set();
        const selectedSlots = [];
        const selectedKeys = [];
        let rejected = 0;
        for (let index = 0; index < handles.length; index++) {
            const handle = normalizeEntityHandle(handles[index], `despawn[${index}]`);
            const key = entityHandleKey(handle);
            if (batchKeys.has(key)) {
                throw new RangeError(`despawn batch에 중복 handle이 있습니다: ${key}`);
            }
            batchKeys.add(key);
            const slot = this.handleToSlot.get(key);
            if (slot === undefined) {
                rejected++;
                continue;
            }
            selectedSlots.push(slot);
            selectedKeys.push(key);
        }
        if (selectedSlots.length === 0) {
            return Object.freeze({
                removed: 0,
                rejected,
                capacity: this.capacity,
                reason: 'stale-handle'
            });
        }
        if (!this.#ensureReady()) {
            return Object.freeze({
                removed: 0,
                rejected: handles.length,
                capacity: this.capacity,
                reason: this.state
            });
        }

        const stagingStorage = createGpuCircleBodyAbiStorage(selectedSlots.length);
        const stagingEffectBodyState = createGpuEffectBodyStateStorage(
            selectedSlots.length
        );
        const stagingFormationBodyState = createGpuFormationBodyStateStorage(
            selectedSlots.length
        );
        const stagingRouteRuntimeStates = createGpuRouteRuntimeStateBuffer(
            selectedSlots.length
        );
        const stagingStyles = new ArrayBuffer(
            BODY_RENDER_STYLE_STRIDE * selectedSlots.length
        );
        const stagingStyleView = new DataView(stagingStyles);
        for (let index = 0; index < selectedSlots.length; index++) {
            writeGpuCircleBodySpawn(stagingStorage, index, TOMBSTONE_BODY);
            writeGpuEffectBodyStateSpawn(
                stagingEffectBodyState,
                index,
                TOMBSTONE_BODY
            );
            writeGpuFormationBodyStateSpawn(
                stagingFormationBodyState,
                index,
                TOMBSTONE_BODY
            );
            writeGpuRouteRuntimeState(
                stagingRouteRuntimeStates,
                selectedSlots.length,
                index,
                null
            );
            writeRenderStyle(stagingStyleView, index, TOMBSTONE_BODY);
        }
        for (let index = 0; index < selectedSlots.length; index++) {
            const slot = selectedSlots[index];
            copyBodySlot(stagingStorage, index, this.hostStorage, slot);
            copyEffectBodySlot(
                stagingEffectBodyState,
                index,
                this.hostEffectBodyState,
                slot
            );
            copyFormationBodySlot(
                stagingFormationBodyState,
                index,
                this.hostFormationBodyState,
                slot
            );
            copyGpuRouteRuntimeStateSlot(
                stagingRouteRuntimeStates,
                selectedSlots.length,
                index,
                this.hostRouteRuntimeStates,
                this.capacity,
                slot
            );
            copyRenderStyleSlot(stagingStyles, index, this.hostRenderStyles, slot);
            this.slotActive[slot] = 0;
            this.slotHandles[slot] = null;
            this.handleToSlot.delete(selectedKeys[index]);
            this.slotRouteRuntimeDomain[slot] = 0;
            clearBodyControlStateSlot(this.hostBodyControlStates, slot);
            this.freeSlots.push(slot);
        }
        this.activeBodyCount -= selectedSlots.length;
        if (this.trackedPoseHandle
            && selectedKeys.includes(entityHandleKey(this.trackedPoseHandle))) {
            this.#invalidateTrackedPose('tracked-body-despawned');
        }
        if (this.towerGameplayTargetHandle
            && selectedKeys.includes(
                entityHandleKey(this.towerGameplayTargetHandle)
            )) {
            this.#invalidateTowerGameplayTarget();
        }
        if (this.activeBodyCount === 0 && this.pendingBodyCount === 0) {
            this.hasGpuAuthoritativeState = false;
            this.idleReleasePending = true;
        }
        while (this.bodyCount > 0 && this.slotActive[this.bodyCount - 1] === 0) {
            this.bodyCount--;
        }
        if (this.freeSlots.length > 0) {
            this.freeSlots = this.freeSlots.filter((slot) => slot < this.bodyCount);
        }
        writeGpuCircleBodyCounts(this.hostStorage, { bodyCount: this.bodyCount });
        this.#refreshHostBodyDerivedState();

        try {
            this.#uploadSlotRanges(selectedSlots);
            this.#uploadBodyCountState();
        } catch (error) {
            if (this.idleReleasePending) {
                this.idleReleasePending = false;
                this.authoritativeEpoch++;
            }
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            this.failure = captureFailure('despawn-upload', error);
            this.state = this.requiresAuthoritativeRebuild ? 'requires-rebuild' : 'failed';
            return Object.freeze({
                removed: selectedSlots.length,
                rejected,
                capacity: this.capacity,
                reason: this.state,
                requiresRecovery: true
            });
        }
        if (this.activeBodyCount === 0 && this.pendingBodyCount === 0) {
            this.#completeDeferredIdleRelease();
        }
        return Object.freeze({
            removed: selectedSlots.length,
            rejected,
            capacity: this.capacity
        });
    }

    /** @param {object} handle - entityId/incarnation handle입니다. */
    hasBody(handle) {
        const normalized = normalizeEntityHandle(handle, 'handle');
        return this.handleToSlot.has(entityHandleKey(normalized));
    }

    /** Exact active non-flow body가 move-only control command를 받을 수 있는지 확인합니다. */
    canControlBody(handle) {
        const normalized = normalizeEntityHandle(handle, 'controlHandle');
        const slot = this.handleToSlot.get(entityHandleKey(normalized));
        if (slot === undefined || this.slotActive[slot] !== 1) {
            return false;
        }
        const simulationOffset = slot * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
        const flags = new DataView(this.hostStorage.simulationBuffer).getUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
            LITTLE_ENDIAN
        );
        return (flags & GPU_CIRCLE_BODY_META.USE_FLOW_FLAG) === 0;
    }

    /**
     * lifecycle commit 뒤, 다음 fixed submit 한 번에 사용할 bounded programs를 준비합니다.
     * public handle을 private slot으로 해석하는 마지막 CPU 경계입니다.
     */
    stageFixedPrograms(plan = {}) {
        const targetFixedTick = requirePositiveInteger(
            plan.targetFixedTick,
            'targetFixedTick'
        );
        const controls = plan.controls ?? [];
        const sourceRelativeSpawns = plan.sourceRelativeSpawns ?? [];
        if (!Array.isArray(controls) || !Array.isArray(sourceRelativeSpawns)) {
            throw new TypeError('fixed program controls/sourceRelativeSpawns 배열이 필요합니다.');
        }
        const hardReject = (reason) => freezeFixedProgramStageResult({
            controlRejected: controls.length,
            spawnRejected: sourceRelativeSpawns.length,
            controlReason: reason,
            spawnReason: reason,
            reason,
            requiresRecovery: true
        });
        if (!this.fixedProgramIngressOpen) {
            return freezeFixedProgramStageResult({
                controlRejected: controls.length,
                spawnRejected: sourceRelativeSpawns.length,
                controlReason: 'fixed-program-ingress-closed',
                spawnReason: 'fixed-program-ingress-closed',
                reason: 'fixed-program-ingress-closed',
                requiresRecovery: false
            });
        }
        if (this.stagedFixedPrograms) {
            return hardReject('fixed-program-already-staged');
        }
        if (controls.length > this.controlCommandCapacity) {
            return hardReject('control-program-capacity');
        }
        if (!this.#ensureReady()) {
            return hardReject(this.state);
        }

        const controlProgram = createGpuBodyControlProgramStorage(
            this.controlCommandCapacity
        );
        const controlKeys = new Set();
        const normalizedControls = new Array(controls.length);
        for (let index = 0; index < controls.length; index++) {
            const source = controls[index];
            const modeFlags = source.modeFlags
                ?? GPU_BODY_CONTROL_PROGRAM_MODE.MOVE_INTENT;
            const isPriority = modeFlags
                === GPU_BODY_CONTROL_PROGRAM_MODE.PRIORITY_TARGET_IN_RANGE;
            if (!isPriority
                && modeFlags !== GPU_BODY_CONTROL_PROGRAM_MODE.MOVE_INTENT) {
                return hardReject('control-mode');
            }
            const handle = normalizeEntityHandle(
                isPriority ? source.sourceHandle : source,
                `controls[${index}]`
            );
            const key = entityHandleKey(handle);
            const slot = this.handleToSlot.get(key);
            if (slot === undefined
                || this.slotActive[slot] !== 1
                || (!isPriority && !this.canControlBody(handle))
                || controlKeys.has(key)) {
                return hardReject(
                    slot === undefined ? 'stale-handle' : 'control-contract'
                );
            }
            controlKeys.add(key);
            let normalized = {
                destinationSlot: slot,
                entityId: handle.entityId,
                incarnation: handle.incarnation,
                modeFlags,
                moveIntentX: source.moveIntentX,
                moveIntentY: source.moveIntentY
            };
            let towerTargetHandle = null;
            if (isPriority) {
                const coreTargetHandle = normalizeEntityHandle(
                    source.coreTargetHandle,
                    `controls[${index}].coreTargetHandle`
                );
                const coreTargetSlot = this.handleToSlot.get(
                    entityHandleKey(coreTargetHandle)
                );
                if (coreTargetSlot === undefined
                    || this.slotActive[coreTargetSlot] !== 1) {
                    return hardReject('core-target-invalid');
                }
                towerTargetHandle = normalizeEntityHandle(
                    source.towerTargetHandle,
                    `controls[${index}].towerTargetHandle`,
                    false
                );
                const authoredTowerSlot = towerTargetHandle
                    ? this.handleToSlot.get(entityHandleKey(towerTargetHandle))
                    : undefined;
                const towerTargetSlot = authoredTowerSlot !== undefined
                    && this.slotActive[authoredTowerSlot] === 1
                    ? authoredTowerSlot
                    : GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT;
                const towerIsPresent = towerTargetSlot
                    !== GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT;
                normalized = {
                    ...normalized,
                    moveIntentX: 0,
                    moveIntentY: 0,
                    sourceTick: targetFixedTick,
                    selectionSequence: source.selectionSequence,
                    coreTargetSlot,
                    coreTargetEntityId: coreTargetHandle.entityId,
                    coreTargetIncarnation: coreTargetHandle.incarnation,
                    towerTargetSlot,
                    towerTargetEntityId: towerIsPresent
                        ? towerTargetHandle.entityId
                        : GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT,
                    towerTargetIncarnation: towerIsPresent
                        ? towerTargetHandle.incarnation
                        : GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT,
                    attackRange: source.attackRangeTiles,
                    attackFingerprint: source.attackFingerprint,
                    selectionPolicy:
                        GPU_BODY_CONTROL_SELECTION_POLICY
                            .CORE_FIRST_IN_RANGE_THEN_TOWER
                };
            }
            writeGpuBodyControlProgramRecord(controlProgram, index, normalized);
            normalizedControls[index] = Object.freeze({
                ...normalized,
                handle,
                ...(isPriority ? {
                    sourceHandle: handle,
                    attackRangeTiles: source.attackRangeTiles,
                    coreTargetHandle: Object.freeze({
                        entityId: normalized.coreTargetEntityId,
                        incarnation: normalized.coreTargetIncarnation
                    }),
                    towerTargetHandle:
                        normalized.towerTargetSlot
                            === GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT
                            ? null
                            : towerTargetHandle
                } : {})
            });
        }
        writeGpuBodyControlProgramHeader(controlProgram, controls.length);

        let spawnProgram = createGpuSpawnProgramStorage(this.spawnProgramCapacity);
        let normalizedSpawns = [];
        let selectedSlots = [];
        let stagingStorage = null;
        let stagingEffectBodyState = null;
        let stagingFormationBodyState = null;
        let stagingRouteRuntimeStates = null;
        let stagingStyles = null;
        let reusableCount = 0;
        let readbackSlot = null;
        let spawnRejectionReason = null;
        if (sourceRelativeSpawns.length > this.spawnProgramCapacity) {
            this.spawnProgramOverflowCount += sourceRelativeSpawns.length
                - this.spawnProgramCapacity;
            spawnRejectionReason = 'spawn-program-capacity';
        } else if (sourceRelativeSpawns.length
            > this.capacity - this.activeBodyCount - this.pendingBodyCount) {
            spawnRejectionReason = 'body-capacity';
        }

        if (!spawnRejectionReason && sourceRelativeSpawns.length > 0) {
            const destinationKeys = new Set();
            normalizedSpawns = new Array(sourceRelativeSpawns.length);
            stagingStorage = createGpuCircleBodyAbiStorage(sourceRelativeSpawns.length);
            stagingEffectBodyState = createGpuEffectBodyStateStorage(
                sourceRelativeSpawns.length
            );
            stagingFormationBodyState = createGpuFormationBodyStateStorage(
                sourceRelativeSpawns.length
            );
            stagingRouteRuntimeStates = createGpuRouteRuntimeStateBuffer(
                sourceRelativeSpawns.length
            );
            stagingStyles = new ArrayBuffer(
                BODY_RENDER_STYLE_STRIDE * sourceRelativeSpawns.length
            );
            const stagingStyleView = new DataView(stagingStyles);
            selectedSlots = new Array(sourceRelativeSpawns.length);
            reusableCount = Math.min(
                this.freeSlots.length,
                sourceRelativeSpawns.length
            );
            for (let index = 0; index < reusableCount; index++) {
                selectedSlots[index] = this.freeSlots[this.freeSlots.length - 1 - index];
            }
            for (let index = reusableCount; index < sourceRelativeSpawns.length; index++) {
                selectedSlots[index] = this.bodyCount + (index - reusableCount);
            }
            for (let index = 0; index < sourceRelativeSpawns.length; index++) {
                const source = sourceRelativeSpawns[index];
                const sourceHandle = normalizeEntityHandle(
                    source.sourceHandle,
                    `sourceRelativeSpawns[${index}].sourceHandle`
                );
                const destinationHandle = normalizeEntityHandle(
                    source.destinationHandle,
                    `sourceRelativeSpawns[${index}].destinationHandle`
                );
                const sourceKey = entityHandleKey(sourceHandle);
                const destinationKey = entityHandleKey(destinationHandle);
                const sourceSlot = this.handleToSlot.get(sourceKey);
                if (sourceSlot === undefined || this.slotActive[sourceSlot] !== 1) {
                    return hardReject('stale-source');
                }
                const modeFlags = source.modeFlags
                    ?? GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY;
                const isAimPoint = modeFlags
                    === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT;
                const isTargetEntity = modeFlags
                    === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY;
                const isSelectedTarget = modeFlags
                    === GPU_SPAWN_PROGRAM_MODE
                        .SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET;
                let targetHandle = null;
                let targetSlot = GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT;
                if (isTargetEntity) {
                    targetHandle = normalizeEntityHandle(
                        source.targetHandle,
                        `sourceRelativeSpawns[${index}].targetHandle`
                    );
                    targetSlot = this.handleToSlot.get(entityHandleKey(targetHandle));
                    if (targetSlot === undefined || this.slotActive[targetSlot] !== 1) {
                        return hardReject('stale-target');
                    }
                }
                let coreTargetHandle = null;
                let towerTargetHandle = null;
                let coreTargetSlot = GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT;
                let towerTargetSlot = GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT;
                if (isSelectedTarget) {
                    if (source.requestFlags
                        !== GPU_SPAWN_PROGRAM_REQUEST_FLAGS
                            .REQUIRE_EXACT_SELECTED_TARGET) {
                        return hardReject('selected-target-request-flags');
                    }
                    coreTargetHandle = normalizeEntityHandle(
                        source.coreTargetHandle,
                        `sourceRelativeSpawns[${index}].coreTargetHandle`
                    );
                    coreTargetSlot = this.handleToSlot.get(
                        entityHandleKey(coreTargetHandle)
                    );
                    if (coreTargetSlot === undefined
                        || this.slotActive[coreTargetSlot] !== 1) {
                        return hardReject('core-target-invalid');
                    }
                    towerTargetHandle = normalizeEntityHandle(
                        source.towerTargetHandle,
                        `sourceRelativeSpawns[${index}].towerTargetHandle`,
                        false
                    );
                    if (towerTargetHandle) {
                        const authoredTowerSlot = this.handleToSlot.get(
                            entityHandleKey(towerTargetHandle)
                        );
                        if (authoredTowerSlot !== undefined
                            && this.slotActive[authoredTowerSlot] === 1) {
                            towerTargetSlot = authoredTowerSlot;
                        }
                    }
                }
                if (destinationKeys.has(destinationKey)
                    || this.handleToSlot.has(destinationKey)
                    || this.pendingHandleToSlot.has(destinationKey)) {
                    return hardReject('destination-identity-conflict');
                }
                destinationKeys.add(destinationKey);
                const body = {
                    ...source.destinationSpawn,
                    entityId: destinationHandle.entityId,
                    incarnation: destinationHandle.incarnation
                };
                this.#validateBody(body, index);
                const routeRuntimeState = this.#resolveRouteRuntimeSpawnState(
                    body,
                    `sourceRelativeSpawn[${index}]`
                );
                writeGpuCircleBodySpawn(stagingStorage, index, body);
                writeGpuEffectBodyStateSpawn(stagingEffectBodyState, index, body);
                writeGpuFormationBodyStateSpawn(
                    stagingFormationBodyState,
                    index,
                    body
                );
                writeGpuRouteRuntimeState(
                    stagingRouteRuntimeStates,
                    sourceRelativeSpawns.length,
                    index,
                    routeRuntimeState
                );
                writeRenderStyle(stagingStyleView, index, body);
                const simulationView = new DataView(stagingStorage.simulationBuffer);
                const simulationOffset = index * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
                const finalFlags = simulationView.getUint32(
                    simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
                    LITTLE_ENDIAN
                );
                simulationView.setUint32(
                    simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
                    finalFlags & ~GPU_CIRCLE_BODY_META.ALIVE_FLAG,
                    LITTLE_ENDIAN
                );
                let modePayload;
                if (isTargetEntity || isSelectedTarget) {
                    modePayload = {
                        launchSpeed: source.launchSpeed
                    };
                } else if (isAimPoint) {
                    modePayload = {
                        aimWorldPoint: source.aimWorldPoint,
                        launchSpeed: source.launchSpeed
                    };
                } else {
                    modePayload = {
                        launchVelocity: source.launchVelocity,
                        sourceVelocityScale: source.sourceVelocityScale
                    };
                }
                const programRecord = {
                    destinationSlot: selectedSlots[index],
                    destinationEntityId: destinationHandle.entityId,
                    destinationIncarnation: destinationHandle.incarnation,
                    sourceSlot,
                    sourceEntityId: sourceHandle.entityId,
                    sourceIncarnation: sourceHandle.incarnation,
                    targetSlot,
                    targetEntityId: targetHandle?.entityId
                        ?? GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT,
                    targetIncarnation: targetHandle?.incarnation
                        ?? GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT,
                    modeFlags,
                    positionOffset: source.positionOffset,
                    targetOffset: isTargetEntity
                        || isSelectedTarget
                        ? source.targetOffset
                        : Object.freeze({ x: 0, y: 0 }),
                    ...modePayload,
                    sourceTick: targetFixedTick,
                    requestFlags: source.requestFlags ?? 0,
                    ...(isSelectedTarget ? {
                        selectionSequence: source.selectionSequence,
                        attackFingerprint: source.attackFingerprint
                    } : {})
                };
                writeGpuSpawnProgramRecord(spawnProgram, index, programRecord);
                normalizedSpawns[index] = Object.freeze({
                    ...programRecord,
                    destinationHandle,
                    sourceHandle,
                    ...(targetHandle ? { targetHandle } : {}),
                    ...(isSelectedTarget ? {
                        coreTargetHandle,
                        towerTargetHandle,
                        coreTargetSlot,
                        towerTargetSlot
                    } : {}),
                    finalFlags
                });
            }
            writeGpuSpawnProgramHeader(spawnProgram, sourceRelativeSpawns.length);
            readbackSlot = this.#claimSpawnProgramReadbackSlot();
            if (!readbackSlot) {
                this.spawnProgramBackpressureCount++;
                spawnRejectionReason = 'spawn-program-readback-capacity';
                normalizedSpawns = [];
                selectedSlots = [];
                stagingStorage = null;
                stagingEffectBodyState = null;
                stagingRouteRuntimeStates = null;
                stagingStyles = null;
                reusableCount = 0;
                spawnProgram = createGpuSpawnProgramStorage(this.spawnProgramCapacity);
            }
        }
        if (normalizedSpawns.length === 0) {
            writeGpuSpawnProgramHeader(spawnProgram, 0);
        }

        try {
            for (let index = 0; index < normalizedSpawns.length; index++) {
                const slot = selectedSlots[index];
                const spawn = normalizedSpawns[index];
                copyBodySlot(stagingStorage, index, this.hostStorage, slot);
                copyEffectBodySlot(
                    stagingEffectBodyState,
                    index,
                    this.hostEffectBodyState,
                    slot
                );
                copyFormationBodySlot(
                    stagingFormationBodyState,
                    index,
                    this.hostFormationBodyState,
                    slot
                );
                copyGpuRouteRuntimeStateSlot(
                    stagingRouteRuntimeStates,
                    normalizedSpawns.length,
                    index,
                    this.hostRouteRuntimeStates,
                    this.capacity,
                    slot
                );
                copyRenderStyleSlot(stagingStyles, index, this.hostRenderStyles, slot);
                clearBodyControlStateSlot(this.hostBodyControlStates, slot);
                this.slotActive[slot] = 2;
                this.slotRouteRuntimeDomain[slot]
                    = sourceRelativeSpawns[index].destinationSpawn
                        ?.routeRuntimeState ? 1 : 0;
                this.pendingSlotHandles[slot] = spawn.destinationHandle;
                this.pendingHandleToSlot.set(
                    entityHandleKey(spawn.destinationHandle),
                    slot
                );
            }
            this.freeSlots.length -= reusableCount;
            this.bodyCount += normalizedSpawns.length - reusableCount;
            this.pendingBodyCount += normalizedSpawns.length;
            writeGpuCircleBodyCounts(this.hostStorage, { bodyCount: this.bodyCount });
            this.#refreshHostBodyDerivedState();
            if (selectedSlots.length > 0) {
                this.#uploadSlotRanges(selectedSlots);
                this.#uploadBodyCountState();
            }
        } catch (error) {
            this.#releaseClaimedSpawnProgramReadbackSlot(readbackSlot);
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            this.failure = captureFailure('fixed-program-stage-upload', error);
            this.state = this.requiresAuthoritativeRebuild
                ? 'requires-rebuild'
                : 'failed';
            return Object.freeze({
                ...freezeFixedProgramStageResult({
                    controlAccepted: normalizedControls.length,
                    spawnAccepted: normalizedSpawns.length,
                    reason: this.state,
                    requiresRecovery: true
                }),
                reason: this.state
            });
        }

        this.hostBodyControlProgram = controlProgram;
        this.hostSpawnProgram = spawnProgram;
        this.stagedFixedPrograms = {
            targetFixedTick,
            controls: Object.freeze(normalizedControls),
            sourceRelativeSpawns: Object.freeze(normalizedSpawns),
            selectedSlots: Object.freeze(selectedSlots),
            readbackSlot
        };
        return freezeFixedProgramStageResult({
            controlAccepted: normalizedControls.length,
            spawnAccepted: normalizedSpawns.length,
            spawnRejected: sourceRelativeSpawns.length - normalizedSpawns.length,
            spawnReason: spawnRejectionReason,
            reason: spawnRejectionReason,
            destinationHandles: Object.freeze(
                normalizedSpawns.map((spawn) => spawn.destinationHandle)
            )
        });
    }

    /**
     * 같은 sourceTick의 due emitter 전체를 하나의 atomic GPU pulse batch로 stage합니다.
     * source slot은 public ABI에 노출하지 않고 exact handle을 private slot map으로
     * 재검증한 뒤에만 packed record에 materialize합니다.
     */
    stageEffectPulseProgramBatch(request = {}) {
        let rejectedSourceTick = 0;
        try {
            rejectedSourceTick = requireEffectUint32(
                request?.sourceTick,
                'effectBatch.sourceTick'
            );
        } catch {
            // malformed diagnostics remain a non-throwing zero sentinel
        }
        const hardReject = (reason, requiresRecovery = false) => Object.freeze({
            abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
            accepted: false,
            sourceTick: rejectedSourceTick,
            stagedCount: 0,
            reason,
            requiresRecovery
        });
        if (!this.effectProgramIngressOpen) {
            return hardReject('effect-program-ingress-closed');
        }
        if (this.requiresAuthoritativeRebuild) {
            return hardReject('requires-rebuild', true);
        }
        let sourceTick;
        let batchIdFingerprint;
        let records;
        try {
            if (Number(request?.abiVersion)
                !== GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION) {
                return hardReject('effect-program-abi');
            }
            sourceTick = requireEffectUint32(
                request.sourceTick,
                'effectBatch.sourceTick',
                { positive: true }
            );
            batchIdFingerprint = requireEffectUint32(
                request.batchIdFingerprint,
                'effectBatch.batchIdFingerprint',
                { positive: true }
            );
            if (!Array.isArray(request.records) || request.records.length === 0) {
                return hardReject('effect-program-records');
            }
            if (request.records.length > this.effectPulseProgramCapacity) {
                return hardReject('effect-program-capacity');
            }
            records = request.records;
        } catch {
            return hardReject('effect-program-contract');
        }
        if (!this.#ensureReady()) {
            return hardReject(this.state, this.requiresAuthoritativeRebuild);
        }
        const programStorage = createGpuEffectPulseProgramStorage(
            this.effectPulseProgramCapacity
        );
        const normalizedRecords = new Array(records.length);
        const sourceKeys = new Set();
        try {
            for (let index = 0; index < records.length; index++) {
                const source = records[index];
                const sourceHandle = normalizeEntityHandle(
                    {
                        entityId: requireEffectUint32(
                            source?.sourceEntityId,
                            `effectBatch.records[${index}].sourceEntityId`,
                            { positive: true }
                        ),
                        incarnation: requireEffectUint32(
                            source?.sourceIncarnation,
                            `effectBatch.records[${index}].sourceIncarnation`,
                            { positive: true }
                        )
                    },
                    `effectBatch.records[${index}].source`
                );
                const key = entityHandleKey(sourceHandle);
                if (sourceKeys.has(key)) {
                    throw new RangeError('Effect batch에는 source exact identity가 중복될 수 없습니다.');
                }
                sourceKeys.add(key);
                const flags = requireEffectUint32(
                    source?.flags,
                    `effectBatch.records[${index}].flags`
                );
                if ((flags & ~EFFECT_PULSE_PROGRAM_KNOWN_FLAGS) !== 0) {
                    throw new RangeError('Effect pulse flags에 unknown bit가 있습니다.');
                }
                const allowsSourceInvalid = (flags
                    & GPU_EFFECT_PULSE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID) !== 0;
                const sourceSlot = this.handleToSlot.get(key);
                if (sourceSlot !== undefined) {
                    const residentHandle = this.slotHandles[sourceSlot];
                    if (this.slotActive[sourceSlot] !== 1
                        || !residentHandle
                        || entityHandleKey(residentHandle) !== key) {
                        throw new Error('Effect source slot/identity mapping이 모순됩니다.');
                    }
                } else {
                    for (let slot = 0; slot < this.bodyCount; slot++) {
                        const residentHandle = this.slotHandles[slot];
                        if (this.slotActive[slot] === 1
                            && residentHandle
                            && entityHandleKey(residentHandle) === key) {
                            throw new Error('Effect source slot/identity mapping이 모순됩니다.');
                        }
                    }
                    // Owner가 exact same-boundary lifecycle stale proof로 승인한
                    // command만 sentinel을 pack합니다. 일반 missing source는 batch
                    // 전체를 mutation/readback claim 전에 zero-partial reject합니다.
                    if (!allowsSourceInvalid) {
                        return hardReject('effect-source-invalid');
                    }
                }
                const record = Object.freeze({
                    sourceSlot: sourceSlot
                        ?? GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT,
                    sourceEntityId: sourceHandle.entityId,
                    sourceIncarnation: sourceHandle.incarnation,
                    effectDefinitionCode: requireEffectUint32(
                        source?.effectDefinitionCode,
                        `effectBatch.records[${index}].effectDefinitionCode`,
                        { positive: true }
                    ),
                    emitterDefinitionCode: requireEffectUint32(
                        source?.emitterDefinitionCode,
                        `effectBatch.records[${index}].emitterDefinitionCode`,
                        { positive: true }
                    ),
                    sourceTick: requireEffectUint32(
                        source?.sourceTick,
                        `effectBatch.records[${index}].sourceTick`,
                        { positive: true }
                    ),
                    pulseSequence: requireEffectUint32(
                        source?.pulseSequence,
                        `effectBatch.records[${index}].pulseSequence`
                    ),
                    radiusTiles: Math.fround(Number(source?.radiusTiles)),
                    targetLayerMask: requireEffectUint32(
                        source?.targetLayerMask,
                        `effectBatch.records[${index}].targetLayerMask`,
                        { positive: true }
                    ),
                    targetPolicy: requireEffectUint32(
                        source?.targetPolicy,
                        `effectBatch.records[${index}].targetPolicy`,
                        { positive: true }
                    ),
                    fingerprint: requireEffectUint32(
                        source?.fingerprint,
                        `effectBatch.records[${index}].fingerprint`,
                        { positive: true }
                    ),
                    flags,
                    retargetIntervalTicks: requireEffectUint32(
                        source?.retargetIntervalTicks,
                        `effectBatch.records[${index}].retargetIntervalTicks`,
                        { positive: true }
                    )
                });
                if (!Number.isFinite(record.radiusTiles)
                    || !(record.radiusTiles > 0)
                    || record.sourceTick !== sourceTick) {
                    throw new RangeError('Effect pulse tick/radius contract가 올바르지 않습니다.');
                }
                const previous = normalizedRecords[index - 1];
                if (previous && (
                    previous.sourceEntityId > record.sourceEntityId
                    || (previous.sourceEntityId === record.sourceEntityId
                        && previous.sourceIncarnation > record.sourceIncarnation)
                    || (previous.sourceEntityId === record.sourceEntityId
                        && previous.sourceIncarnation === record.sourceIncarnation
                        && previous.pulseSequence >= record.pulseSequence)
                )) {
                    throw new RangeError('Effect pulse records가 canonical order가 아닙니다.');
                }
                writeGpuEffectPulseProgramRecord(programStorage, index, record);
                normalizedRecords[index] = record;
            }
            writeGpuEffectPulseProgramHeader(programStorage, records.length);
        } catch (error) {
            const contradiction = error?.message?.includes('mapping이 모순');
            if (contradiction) {
                this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
                this.failure = captureFailure('effect-source-slot-identity', error);
                this.state = this.requiresAuthoritativeRebuild
                    ? 'requires-rebuild'
                    : 'failed';
            }
            return hardReject(
                contradiction ? 'effect-source-identity-conflict' : 'effect-program-record',
                contradiction
            );
        }
        if (this.stagedEffectPulseBatch) {
            const prior = this.stagedEffectPulseBatch;
            const recordsMatch = prior.records.length === normalizedRecords.length
                && prior.records.every((record, index) => {
                    const candidate = normalizedRecords[index];
                    return Object.keys(record).every(
                        (key) => Object.is(record[key], candidate[key])
                    ) && Object.keys(candidate).length === Object.keys(record).length;
                });
            if (prior.sourceTick === sourceTick
                && prior.batchIdFingerprint === batchIdFingerprint
                && recordsMatch) {
                return Object.freeze({
                    abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
                    accepted: true,
                    sourceTick,
                    stagedCount: normalizedRecords.length,
                    replayed: true,
                    reason: null
                });
            }
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            this.failure = captureFailure(
                'effect-program-stage-conflict',
                new Error('같은 fixed boundary에 서로 다른 Effect batch가 stage되었습니다.')
            );
            this.state = this.requiresAuthoritativeRebuild
                ? 'requires-rebuild'
                : 'failed';
            return hardReject('effect-program-stage-conflict', true);
        }
        const readbackSlot = this.#claimEffectProgramReadbackSlot();
        if (!readbackSlot) {
            this.effectProgramBackpressureCount++;
            return hardReject('effect-program-readback-capacity');
        }
        this.hostEffectPulseProgram = programStorage;
        this.stagedEffectPulseBatch = Object.freeze({
            abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
            batchIdFingerprint,
            sourceTick,
            records: Object.freeze(normalizedRecords),
            readbackSlot
        });
        return Object.freeze({
            abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
            accepted: true,
            sourceTick,
            stagedCount: normalizedRecords.length,
            replayed: false,
            reason: null
        });
    }

    /** 완료된 whole-tick Effect batch를 authored program order로 drain합니다. */
    drainCompletedEffectProgramBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('Effect 완료 batch 출력은 배열이어야 합니다.');
        }
        while (this.effectProgramBatchQueue[0]?.completed === true) {
            const entry = this.effectProgramBatchQueue.shift();
            if (entry.failure) {
                this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
                this.failure = entry.failure;
                this.state = this.requiresAuthoritativeRebuild
                    ? 'requires-rebuild'
                    : 'failed';
                continue;
            }
            this.lastEffectProgramCompletedTick = Math.max(
                this.lastEffectProgramCompletedTick,
                entry.sourceTick
            );
            out.push(entry.completion);
        }
        if (this.idleReleasePending
            && this.pendingEffectReadbacks === 0
            && this.effectProgramBatchQueue.length === 0) {
            this.#completeDeferredIdleRelease();
        }
        return out;
    }

    /** Terminal final submit 전 Effect ingress/readback leases를 모두 퇴역시킵니다. */
    cancelPendingEffectProgramsForTerminal(request = {}) {
        let abiVersion = NaN;
        let requestedFinalFixedTick = NaN;
        try {
            abiVersion = Number(request?.abiVersion);
            requestedFinalFixedTick = Number(request?.finalFixedTick);
        } catch {
            // malformed terminal requests return failed evidence without mutation
        }
        const finalFixedTick = Number.isSafeInteger(requestedFinalFixedTick)
            && requestedFinalFixedTick > 0
            ? requestedFinalFixedTick
            : 0;
        const failureResult = (failure) => {
            const result = Object.freeze({
                abiVersion: GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION,
                state: 'failed',
                finalFixedTick,
                submittedTick: 0,
                pulseProgramCount: 0,
                pendingPulseProgramCount:
                    this.stagedEffectPulseBatch?.records.length ?? 0,
                pendingEffectReadbackCount: this.pendingEffectReadbacks,
                failure
            });
            this.terminalEffectProgramCancelStatus = result;
            return result;
        };
        if (abiVersion !== GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION
            || finalFixedTick === 0) {
            return failureResult('effect-terminal-cancel-contract');
        }
        if (this.terminalEffectProgramCancelStatus) {
            const prior = this.terminalEffectProgramCancelStatus;
            return prior.finalFixedTick === finalFixedTick
                ? prior
                : failureResult('effect-terminal-cancel-replay-mismatch');
        }
        this.effectProgramIngressOpen = false;
        const pulseProgramCount = (
            this.stagedEffectPulseBatch?.records.length ?? 0
        ) + this.effectProgramBatchQueue.reduce((count, entry) => (
            count + (entry.records?.length ?? 0)
        ), 0);
        this.#retireTerminalEffectReadbacks();
        writeGpuEffectPulseProgramHeader(this.hostEffectPulseProgram, 0);
        if (this.device && this.buffers?.effectPulseProgram) {
            this.device.queue.writeBuffer(
                this.buffers.effectPulseProgram,
                0,
                this.hostEffectPulseProgram.buffer,
                0,
                GPU_EFFECT_RUNTIME_ABI.PROGRAM_HEADER.STRIDE
            );
        }
        const result = Object.freeze({
            abiVersion: GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION,
            state: 'armed',
            finalFixedTick,
            submittedTick: 0,
            pulseProgramCount,
            pendingPulseProgramCount: 0,
            pendingEffectReadbackCount: 0,
            failure: null
        });
        this.terminalEffectProgramCancelStatus = result;
        return result;
    }

    getEffectRuntimeStatus() {
        const retryableCapacityRejected
            = isRetryableEffectCapacityStatus(this.lastEffectRuntimeStatus);
        return Object.freeze({
            abiVersion: GPU_EFFECT_RUNTIME_ABI_VERSION,
            state: this.state,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: this.deviceGeneration,
            authoritativeEpoch: this.authoritativeEpoch,
            ingressOpen: this.effectProgramIngressOpen,
            stagedProgramCount: this.stagedEffectPulseBatch?.records.length ?? 0,
            pendingPulseProgramCount: this.effectProgramBatchQueue.reduce(
                (count, entry) => count + (entry.records?.length ?? 0),
                this.stagedEffectPulseBatch?.records.length ?? 0
            ),
            pendingEffectReadbackCount: this.pendingEffectReadbacks,
            completedThroughTick: this.lastEffectProgramCompletedTick,
            activePoolIndex: this.effectActivePoolIndex,
            sourceTick: this.lastEffectProgramSourceTick,
            lastSubmittedTick: this.lastEffectProgramSubmittedTick,
            runtimeStatus: this.lastEffectRuntimeStatus,
            retryableCapacityRejected,
            requiresRecovery: this.requiresAuthoritativeRebuild
                || (this.lastEffectRuntimeStatus !== GPU_EFFECT_RUNTIME_STATUS.OK
                    && !retryableCapacityRejected)
                || this.terminalEffectProgramCancelStatus?.state === 'failed',
            failure: this.failure,
            terminal: this.terminalEffectProgramCancelStatus
        });
    }

    /** 같은 source tick의 모든 Formation prepare request를 원자적으로 stage합니다. */
    stageFormationPrepareBatch(request = {}) {
        const reject = (reason, requiresRecovery = false) => Object.freeze({
            abiVersion: GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
            accepted: false,
            targetFixedTick: Number.isSafeInteger(request.targetFixedTick)
                ? request.targetFixedTick
                : 0,
            stagedCount: 0,
            replayed: false,
            reason,
            requiresRecovery
        });
        if (!this.formationProgramIngressOpen
            || this.terminalFormationProgramCancelStatus) {
            return reject('formation-ingress-closed');
        }
        if (request.abiVersion !== GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION
            || !Array.isArray(request.records)) {
            return reject('formation-prepare-contract', true);
        }
        let targetFixedTick;
        let batchIdFingerprint;
        const normalized = [];
        try {
            targetFixedTick = requireEffectUint32(
                request.targetFixedTick,
                'formationPrepare.targetFixedTick',
                { positive: true }
            );
            batchIdFingerprint = requireEffectUint32(
                request.batchIdFingerprint,
                'formationPrepare.batchIdFingerprint',
                { positive: true }
            );
            if (batchIdFingerprint === UINT32_MAX
                || request.records.length === 0
                || request.records.length > this.formationPrepareCapacity) {
                return reject(request.records.length === 0
                    ? 'formation-prepare-empty'
                    : 'formation-prepare-capacity');
            }
            const seen = new Set();
            for (let index = 0; index < request.records.length; index++) {
                const source = request.records[index];
                const handle = normalizeEntityHandle({
                    entityId: source?.sourceEntityId,
                    incarnation: source?.sourceIncarnation
                }, `formationPrepare[${index}]`);
                const key = entityHandleKey(handle);
                if (seen.has(key)) {
                    return reject('formation-prepare-source-duplicate', true);
                }
                seen.add(key);
                const flags = requireEffectUint32(
                    source.flags ?? 0,
                    `formationPrepare[${index}].flags`
                );
                if ((flags & ~GPU_FORMATION_PREPARE_PROGRAM_FLAG
                    .ALLOW_SOURCE_INVALID) !== 0) {
                    return reject('formation-prepare-flags', true);
                }
                const sourceSlot = this.handleToSlot.get(key);
                if (sourceSlot === undefined || this.slotActive[sourceSlot] !== 1) {
                    if ((flags & GPU_FORMATION_PREPARE_PROGRAM_FLAG
                        .ALLOW_SOURCE_INVALID) === 0) {
                        return reject('formation-prepare-source-missing');
                    }
                } else {
                    const live = this.slotHandles[sourceSlot];
                    if (!live || live.entityId !== handle.entityId
                        || live.incarnation !== handle.incarnation) {
                        return reject('formation-prepare-source-map-conflict', true);
                    }
                }
                normalized.push(Object.freeze({
                    sourceSlot: sourceSlot ?? GPU_FORMATION_IDENTITY_INVALID,
                    sourceEntityId: handle.entityId,
                    sourceIncarnation: handle.incarnation,
                    sourceTick: targetFixedTick,
                    prepareSequence: requireEffectUint32(
                        source.prepareSequence,
                        `formationPrepare[${index}].prepareSequence`
                    ),
                    fingerprint: requireEffectUint32(
                        source.fingerprint,
                        `formationPrepare[${index}].fingerprint`,
                        { positive: true }
                    ),
                    flags
                }));
            }
            normalized.sort((left, right) => (
                left.sourceEntityId - right.sourceEntityId
                || left.sourceIncarnation - right.sourceIncarnation
                || left.prepareSequence - right.prepareSequence
            ));
        } catch (error) {
            return reject(`formation-prepare-invalid:${error.message}`, true);
        }
        const replayKey = JSON.stringify({
            batchIdFingerprint,
            targetFixedTick,
            records: normalized
        });
        if (this.stagedFormationPrepareBatch) {
            const prior = this.stagedFormationPrepareBatch;
            if (prior.replayKey === replayKey) {
                return Object.freeze({
                    abiVersion: GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
                    accepted: true,
                    targetFixedTick,
                    stagedCount: normalized.length,
                    replayed: true,
                    reason: null,
                    requiresRecovery: false
                });
            }
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            return reject('formation-prepare-replay-conflict', true);
        }
        const readbackSlot = this.#claimFormationPrepareReadbackSlot();
        if (!readbackSlot) {
            return reject('formation-prepare-readback-capacity');
        }
        const storage = createGpuFormationPrepareProgramStorage(
            this.formationPrepareCapacity
        );
        writeGpuFormationPrepareProgramHeader(storage, {
            count: normalized.length,
            batchIdFingerprint,
            sourceTick: targetFixedTick
        });
        normalized.forEach((record, index) => {
            writeGpuFormationPrepareProgramRecord(storage, index, record);
        });
        this.hostFormationPrepareProgram = storage;
        this.stagedFormationPrepareBatch = Object.freeze({
            batchIdFingerprint,
            sourceTick: targetFixedTick,
            records: Object.freeze(normalized),
            replayKey,
            readbackSlot
        });
        return Object.freeze({
            abiVersion: GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
            accepted: true,
            targetFixedTick,
            stagedCount: normalized.length,
            replayed: false,
            reason: null,
            requiresRecovery: false
        });
    }

    drainCompletedFormationPrepareBatches(out = []) {
        if (!out || typeof out.push !== 'function') {
            throw new TypeError('Formation prepare drain 대상은 push 가능해야 합니다.');
        }
        while (this.formationPrepareBatchQueue[0]?.completed === true) {
            const entry = this.formationPrepareBatchQueue.shift();
            if (entry.failure) {
                this.lastFormationRuntimeStatus |= GPU_FORMATION_RUNTIME_STATUS
                    .RECORD_INVALID;
                this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
                continue;
            }
            out.push(entry.completion);
        }
        this.#completeDeferredIdleRelease();
        return out;
    }

    /** Authenticated N prepare 결과를 오직 N+1 transform으로 arm합니다. */
    armPreparedFormationTransformBatch(request = {}) {
        const reject = (reason, requiresRecovery = false) => Object.freeze({
            abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
            accepted: false,
            preparedSourceTick: Number(request.preparedSourceTick) || 0,
            targetFixedTick: Number(request.targetFixedTick) || 0,
            armedCount: 0,
            replayed: false,
            receipt: null,
            evidence: null,
            reason,
            requiresRecovery
        });
        if (!this.formationProgramIngressOpen
            || this.terminalFormationProgramCancelStatus) {
            return reject('formation-ingress-closed');
        }
        if (request.abiVersion !== GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION
            || !Array.isArray(request.records)) {
            return reject('formation-transform-contract', true);
        }
        let preparedSourceTick;
        let targetFixedTick;
        let batchIdFingerprint;
        let prepareBatchFingerprint;
        try {
            preparedSourceTick = requireEffectUint32(
                request.preparedSourceTick,
                'formationTransform.preparedSourceTick',
                { positive: true }
            );
            targetFixedTick = requireEffectUint32(
                request.targetFixedTick,
                'formationTransform.targetFixedTick',
                { positive: true }
            );
            batchIdFingerprint = requireEffectUint32(
                request.batchIdFingerprint,
                'formationTransform.batchIdFingerprint',
                { positive: true }
            );
            prepareBatchFingerprint = requireEffectUint32(
                request.prepareBatchIdFingerprint,
                'formationTransform.prepareBatchIdFingerprint',
                { positive: true }
            );
        } catch (error) {
            return reject(`formation-transform-invalid:${error.message}`, true);
        }
        if (targetFixedTick !== preparedSourceTick + 1
            || this.lastSubmittedSourceTick !== preparedSourceTick) {
            return reject('formation-transform-stale');
        }
        if (request.records.length > this.formationTransformCapacity) {
            return reject('formation-transform-capacity');
        }
        if (request.records.length === 0) {
            return reject('formation-transform-empty');
        }
        const authenticKey = `${prepareBatchFingerprint}:${preparedSourceTick}`;
        const authentic = this.authenticFormationPrepareByKey.get(authenticKey);
        if (!authentic
            || authentic.sessionGeneration !== this.sessionGeneration
            || authentic.deviceGeneration !== this.deviceGeneration
            || authentic.authoritativeEpoch !== this.authoritativeEpoch) {
            return reject('formation-transform-prepare-stale');
        }
        const prepareProtocol = request.prepareProtocol;
        if (!prepareProtocol
            || prepareProtocol.sessionGeneration !== authentic.sessionGeneration
            || prepareProtocol.deviceGeneration !== authentic.deviceGeneration
            || prepareProtocol.authoritativeEpoch !== authentic.authoritativeEpoch
            || prepareProtocol.submittedTickCount + 1 !== authentic.submittedTick) {
            return reject('formation-transform-prepare-protocol', true);
        }
        const outcomeByHandle = new Map(authentic.results.map((result) => [
            `${result.sourceEntityId}:${result.sourceIncarnation}`,
            result
        ]));
        const normalized = [];
        const consumed = new Set();
        try {
            for (let index = 0; index < request.records.length; index++) {
                const source = request.records[index];
                const destinationSource = source.destination;
                const destinationHandleSource = Object.freeze({
                    entityId: destinationSource?.entityId,
                    incarnation: destinationSource?.incarnation
                });
                const destinationState = Object.freeze({
                    definitionCode: destinationSource?.definitionCode,
                    coordinateSystemCode:
                        destinationSource?.coordinateSystemCode,
                    policyCode: destinationSource?.policyCode,
                    memberCount: destinationSource?.memberCount,
                    occupiedSlotMask: destinationSource?.occupiedSlotMask,
                    rotationStep: destinationSource?.rotationStep,
                    generation: destinationSource?.generation,
                    flags: destinationSource?.flags,
                    lineageHash: destinationSource?.lineageHash
                });
                const sourceAHandle = normalizeEntityHandle(
                    source.sourceA,
                    `formationTransform[${index}].sourceA`
                );
                const sourceBHandle = normalizeEntityHandle(
                    source.sourceB,
                    `formationTransform[${index}].sourceB`
                );
                const keyA = entityHandleKey(sourceAHandle);
                const keyB = entityHandleKey(sourceBHandle);
                if (consumed.has(keyA) || consumed.has(keyB)
                    || sourceAHandle.entityId > sourceBHandle.entityId
                    || (sourceAHandle.entityId === sourceBHandle.entityId
                        && sourceAHandle.incarnation >= sourceBHandle.incarnation)) {
                    throw new RangeError('Formation transform source root/order conflict');
                }
                consumed.add(keyA);
                consumed.add(keyB);
                const slotA = this.handleToSlot.get(keyA);
                const slotB = this.handleToSlot.get(keyB);
                if (slotA === undefined || slotB === undefined
                    || this.slotActive[slotA] !== 1
                    || this.slotActive[slotB] !== 1) {
                    throw new RangeError('Formation transform source가 live가 아닙니다.');
                }
                const preparedA = outcomeByHandle.get(keyA);
                const preparedB = outcomeByHandle.get(keyB);
                if (!preparedA || !preparedB
                    || preparedA.result !== GPU_FORMATION_PREPARE_RESULT.MUTUAL_PAIR
                    || preparedB.result !== GPU_FORMATION_PREPARE_RESULT.MUTUAL_PAIR
                    || preparedA.pairEntityId !== sourceBHandle.entityId
                    || preparedA.pairIncarnation !== sourceBHandle.incarnation
                    || preparedB.pairEntityId !== sourceAHandle.entityId
                    || preparedB.pairIncarnation !== sourceAHandle.incarnation) {
                    throw new RangeError('Formation reciprocal prepare 증거가 없습니다.');
                }
                const exactFields = [
                    ['memberCount', 'memberCount'],
                    ['occupiedSlotMask', 'occupiedSlotMask'],
                    ['rotationStep', 'rotationStep'],
                    ['generation', 'generation'],
                    ['lineageHash', 'lineageHash'],
                    ['currentHealthCenti', 'currentHealthCenti'],
                    ['maxHealthCenti', 'maxHealthCenti']
                ];
                for (const [sourceField, preparedField] of exactFields) {
                    if (source.sourceA[sourceField] !== preparedA[preparedField]
                        || source.sourceB[sourceField] !== preparedB[preparedField]) {
                        throw new RangeError(`Formation prepared ${sourceField} mismatch`);
                    }
                }
                if (source.expectedCurrentHealthCenti
                        !== preparedA.expectedMergedCurrentHealthCenti
                    || source.expectedMaxHealthCenti
                        !== preparedA.expectedMergedMaxHealthCenti
                    || destinationState.memberCount
                        !== preparedA.destinationMemberCount
                    || destinationState.occupiedSlotMask
                        !== preparedA.destinationOccupiedSlotMask
                    || destinationState.rotationStep
                        !== preparedA.destinationRotationStep) {
                    throw new RangeError('Formation destination prepare facts mismatch');
                }
                const destination = normalizeEntityHandle(
                    destinationHandleSource,
                    `formationTransform[${index}].destination`
                );
                if (destination.entityId !== sourceAHandle.entityId
                    || destination.incarnation !== sourceAHandle.incarnation + 1) {
                    throw new RangeError('Formation destination root identity mismatch');
                }
                const motionSourceIndex = preparedA.motionRootProgramIndex
                    === preparedA.rootProgramIndex
                    ? 0
                    : (preparedA.motionRootProgramIndex
                        === preparedA.pairProgramIndex ? 1 : -1);
                if (source.motionSourceIndex !== motionSourceIndex) {
                    throw new RangeError('Formation motion root mismatch');
                }
                normalized.push(Object.freeze({
                    ...source,
                    sourceA: Object.freeze({ ...source.sourceA, slot: slotA }),
                    sourceB: Object.freeze({ ...source.sourceB, slot: slotB }),
                    destination,
                    destinationState,
                    preparedSourceTick,
                    targetFixedTick,
                    prepareBatchFingerprint
                }));
            }
        } catch (error) {
            return reject(`formation-transform-auth:${error.message}`, true);
        }
        const replayKey = JSON.stringify({
            batchIdFingerprint,
            prepareBatchFingerprint,
            preparedSourceTick,
            targetFixedTick,
            records: normalized
        });
        if (this.armedFormationTransform) {
            const prior = this.armedFormationTransform;
            if (prior.replayKey === replayKey) {
                return Object.freeze({
                    abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
                    accepted: true,
                    preparedSourceTick,
                    targetFixedTick,
                    armedCount: normalized.length,
                    replayed: true,
                    receipt: prior.receipt,
                    evidence: prior.evidence,
                    reason: null,
                    requiresRecovery: false
                });
            }
            return reject('formation-transform-replay-conflict', true);
        }
        const readbackSlot = this.#claimFormationTransformReadbackSlot();
        if (!readbackSlot) {
            return reject('formation-transform-readback-capacity');
        }
        const storage = createGpuFormationTransformProgramStorage(
            this.formationTransformCapacity
        );
        writeGpuFormationTransformProgramHeader(storage, {
            count: normalized.length,
            batchIdFingerprint,
            preparedSourceTick,
            targetFixedTick
        });
        normalized.forEach((record, index) => {
            writeGpuFormationTransformProgramRecord(storage, index, record);
        });
        const evidence = Object.freeze({
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: this.deviceGeneration,
            authoritativeEpoch: this.authoritativeEpoch,
            batchIdFingerprint
        });
        const receipt = Object.freeze({
            abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
            receiptId: Object.freeze({}),
            targetFixedTick
        });
        this.hostFormationTransformProgram = storage;
        this.armedFormationTransform = {
            batchIdFingerprint,
            prepareBatchFingerprint,
            preparedSourceTick,
            targetFixedTick,
            records: Object.freeze(normalized),
            replayKey,
            receipt,
            evidence,
            readbackSlot,
            commitRequested: false
        };
        return Object.freeze({
            abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
            accepted: true,
            preparedSourceTick,
            targetFixedTick,
            armedCount: normalized.length,
            replayed: false,
            receipt,
            evidence,
            reason: null,
            requiresRecovery: false
        });
    }

    commitArmedFormationTransformBatch(receipt) {
        const armed = this.armedFormationTransform;
        if (!armed || armed.receipt !== receipt) {
            return Object.freeze({
                abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
                accepted: false,
                targetFixedTick: 0,
                armedCount: 0,
                commitRequested: false,
                reason: 'formation-receipt-invalid'
            });
        }
        armed.commitRequested = true;
        return Object.freeze({
            abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
            accepted: true,
            targetFixedTick: armed.targetFixedTick,
            armedCount: armed.records.length,
            commitRequested: true
        });
    }

    cancelArmedFormationTransformBatch(receipt) {
        const armed = this.armedFormationTransform;
        if (!armed || armed.receipt !== receipt || armed.commitRequested) {
            return Object.freeze({
                abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
                accepted: false,
                targetFixedTick: 0,
                cancelledCount: 0,
                canceled: false,
                reason: 'formation-receipt-invalid'
            });
        }
        this.#releaseClaimedFormationTransformReadbackSlot(armed.readbackSlot);
        this.armedFormationTransform = null;
        writeGpuFormationTransformProgramHeader(
            this.hostFormationTransformProgram,
            { count: 0 }
        );
        return Object.freeze({
            abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
            accepted: true,
            targetFixedTick: armed.targetFixedTick,
            cancelledCount: armed.records.length,
            canceled: true,
            reason: null
        });
    }

    cancelPendingFormationProgramsForTerminal(request = {}) {
        let finalFixedTick;
        if (request.abiVersion !== GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION) {
            return Object.freeze({
                abiVersion: GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION,
                state: 'failed',
                finalFixedTick: 0,
                submittedTick: 0,
                prepareProgramCount: 0,
                armedTransformCount: 0,
                pendingPrepareProgramCount: 0,
                pendingPrepareReadbackCount: 0,
                failure: 'formation-terminal-abi'
            });
        }
        try {
            finalFixedTick = requireEffectUint32(
                request.finalFixedTick,
                'formationTerminal.finalFixedTick',
                { positive: true }
            );
        } catch {
            return Object.freeze({
                abiVersion: GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION,
                state: 'failed',
                finalFixedTick: 0,
                submittedTick: 0,
                prepareProgramCount: 0,
                armedTransformCount: 0,
                pendingPrepareProgramCount: 0,
                pendingPrepareReadbackCount: 0,
                failure: 'formation-terminal-tick'
            });
        }
        if (this.terminalFormationProgramCancelStatus) {
            return this.terminalFormationProgramCancelStatus.finalFixedTick
                === finalFixedTick
                ? this.terminalFormationProgramCancelStatus
                : Object.freeze({
                    ...this.terminalFormationProgramCancelStatus,
                    state: 'failed',
                    failure: 'formation-terminal-replay-mismatch'
                });
        }
        // Terminal evidence counts the exact pending program authority before
        // any lease/queue is retired.  Queue entries already include every
        // submitted readback, while staged contains the not-yet-submitted batch.
        const prepareProgramCount = this.formationPrepareBatchQueue.reduce(
            (count, entry) => count + (entry.records?.length ?? 0),
            this.stagedFormationPrepareBatch?.records.length ?? 0
        );
        const armedTransformCount
            = this.armedFormationTransform?.records.length ?? 0;
        this.formationProgramIngressOpen = false;
        if (this.stagedFormationPrepareBatch) {
            this.#releaseClaimedFormationPrepareReadbackSlot(
                this.stagedFormationPrepareBatch.readbackSlot
            );
        }
        if (this.armedFormationTransform) {
            this.#releaseClaimedFormationTransformReadbackSlot(
                this.armedFormationTransform.readbackSlot
            );
        }
        this.stagedFormationPrepareBatch = null;
        this.armedFormationTransform = null;
        this.#retireFormationReadbacks();
        writeGpuFormationPrepareProgramHeader(
            this.hostFormationPrepareProgram,
            { count: 0 }
        );
        writeGpuFormationTransformProgramHeader(
            this.hostFormationTransformProgram,
            { count: 0 }
        );
        this.terminalFormationProgramCancelStatus = Object.freeze({
            abiVersion: GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION,
            state: 'armed',
            finalFixedTick,
            submittedTick: 0,
            prepareProgramCount,
            armedTransformCount,
            pendingPrepareProgramCount: 0,
            pendingPrepareReadbackCount: 0,
            failure: null
        });
        return this.terminalFormationProgramCancelStatus;
    }

    getFormationRuntimeStatus() {
        const armed = this.armedFormationTransform;
        return Object.freeze({
            abiVersion: GPU_FORMATION_RUNTIME_ABI_VERSION,
            state: this.state,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: this.deviceGeneration,
            authoritativeEpoch: this.authoritativeEpoch,
            ingressOpen: this.formationProgramIngressOpen,
            prepareCapacity: this.formationPrepareCapacity,
            transformCapacity: this.formationTransformCapacity,
            stagedPrepareProgramCount:
                this.stagedFormationPrepareBatch?.records.length ?? 0,
            pendingPrepareProgramCount: this.formationPrepareBatchQueue.reduce(
                (count, entry) => count + (entry.records?.length ?? 0),
                this.stagedFormationPrepareBatch?.records.length ?? 0
            ),
            pendingPrepareReadbackCount: this.pendingFormationPrepareReadbacks,
            pendingTransformReadbackCount: this.pendingFormationTransformReadbacks,
            lastPrepareSourceTick: this.lastFormationPrepareSourceTick,
            lastPrepareSubmittedTick: this.lastFormationPrepareSubmittedTick,
            lastPrepareCompletedTick: this.lastFormationPrepareCompletedTick,
            armedTransformCount: armed?.records.length ?? 0,
            commitRequested: armed?.commitRequested === true,
            targetFixedTick: armed?.targetFixedTick ?? 0,
            lastCommittedTransformCount: this.lastFormationCommittedCount,
            lastCommittedSourceTick: this.lastFormationTransformCommittedTick,
            lastEffectRekeyCount: this.lastFormationEffectRekeyCount,
            lastTransformCompletion: this.lastFormationTransformCompletion,
            storageProfile: GPU_FORMATION_RUNTIME_STORAGE_PROFILE,
            runtimeStatus: this.lastFormationRuntimeStatus,
            requiresRecovery: this.requiresAuthoritativeRebuild
                || this.lastFormationRuntimeStatus !== GPU_FORMATION_RUNTIME_STATUS.OK
                || this.terminalFormationProgramCancelStatus?.state === 'failed',
            failure: this.failure,
            terminal: this.terminalFormationProgramCancelStatus
        });
    }

    /** T submit 말단 GPU scan을 위한 bounded prepare program을 stage합니다. */
    stageAtomicTransformPrepareBatch(request = {}) {
        const reject = (reason, requiresRecovery = false) => Object.freeze({
            abiVersion: GPU_ATOMIC_TRANSFORM_PREPARE_PROGRAM_ABI_VERSION,
            accepted: false,
            reason,
            requiresRecovery
        });
        if (!this.atomicTransformProgramIngressOpen
            || this.terminalAtomicTransformProgramCancelStatus) {
            return reject('atomic-transform-ingress-closed');
        }
        if (request.abiVersion
                !== GPU_ATOMIC_TRANSFORM_PREPARE_PROGRAM_ABI_VERSION
            || !Array.isArray(request.records)
            || request.records.length > this.atomicTransformPrepareCapacity) {
            return reject('atomic-transform-prepare-contract', true);
        }
        let sourceTick;
        let targetFixedTick;
        let batchIdFingerprint;
        try {
            sourceTick = requirePositiveInteger(request.sourceTick, 'sourceTick');
            targetFixedTick = requirePositiveInteger(
                request.targetFixedTick,
                'targetFixedTick'
            );
            batchIdFingerprint = requirePositiveInteger(
                request.batchIdFingerprint,
                'batchIdFingerprint'
            );
        } catch (error) {
            return reject(`atomic-transform-prepare-contract:${error.message}`, true);
        }
        if (targetFixedTick !== sourceTick + 1) {
            return reject('atomic-transform-prepare-deadline', true);
        }
        const replayKey = JSON.stringify({
            sourceTick,
            targetFixedTick,
            batchIdFingerprint,
            records: request.records
        });
        if (this.stagedAtomicTransformPrepareBatch) {
            return this.stagedAtomicTransformPrepareBatch.replayKey === replayKey
                ? Object.freeze({
                    accepted: true,
                    sourceTick,
                    targetFixedTick,
                    batchIdFingerprint,
                    replayed: true,
                    requiresRecovery: false
                })
                : reject('atomic-transform-prepare-replay-conflict', true);
        }
        const readbackSlot = this.#claimAtomicTransformPrepareReadbackSlot();
        if (!readbackSlot) {
            return reject('atomic-transform-prepare-readback-capacity');
        }
        writeGpuAtomicTransformPrepareHeader(
            this.hostAtomicTransformPrepareProgram,
            { sourceTick, targetFixedTick, batchIdFingerprint }
        );
        this.stagedAtomicTransformPrepareBatch = Object.freeze({
            sourceTick,
            targetFixedTick,
            batchIdFingerprint,
            records: Object.freeze([...request.records]),
            replayKey,
            readbackSlot
        });
        return Object.freeze({
            accepted: true,
            sourceTick,
            targetFixedTick,
            batchIdFingerprint,
            replayed: false,
            requiresRecovery: false
        });
    }

    drainCompletedAtomicTransformPrepareBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('AtomicTransform prepare drain 대상은 배열이어야 합니다.');
        }
        while (this.atomicTransformPrepareBatchQueue[0]?.completed === true) {
            const entry = this.atomicTransformPrepareBatchQueue.shift();
            if (entry.failure) {
                this.requiresAuthoritativeRebuild = true;
                out.push(Object.freeze({
                    abiVersion:
                        GPU_ATOMIC_TRANSFORM_PREPARE_PROGRAM_ABI_VERSION,
                    sessionGeneration: entry.sessionGeneration,
                    deviceGeneration: entry.deviceGeneration,
                    authoritativeEpoch: entry.authoritativeEpoch,
                    submittedTick: entry.submittedTick,
                    sourceTick: entry.sourceTick,
                    targetFixedTick: entry.targetFixedTick,
                    batchIdFingerprint: entry.batchIdFingerprint,
                    status: UINT32_MAX,
                    records: Object.freeze([]),
                    failure: entry.failure
                }));
                continue;
            }
            out.push(entry.completion);
        }
        return out;
    }

    discardPreparedAtomicTransformBatch({ batchIdFingerprint } = {}) {
        const fingerprint = Number(batchIdFingerprint);
        if (!Number.isSafeInteger(fingerprint)
            || fingerprint <= 0 || fingerprint >= UINT32_MAX) {
            return Object.freeze({
                accepted: false,
                reason: 'atomic-transform-discard-contract',
                requiresRecovery: true
            });
        }
        if (this.armedAtomicTransform?.batchIdFingerprint === fingerprint) {
            return Object.freeze({
                accepted: false,
                reason: 'atomic-transform-discard-armed',
                requiresRecovery: true
            });
        }
        this.authenticAtomicTransformPrepareByFingerprint.delete(fingerprint);
        this.#completeDeferredIdleRelease();
        return Object.freeze({
            accepted: true,
            batchIdFingerprint: fingerprint,
            requiresRecovery: false
        });
    }

    /** Lifecycle registry preflight 뒤 authentic T-1 subset을 GPU transform으로 arm합니다. */
    armPreparedAtomicTransformBatch(request = {}) {
        const reject = (reason, requiresRecovery = false, retryable = false) => (
            Object.freeze({
                abiVersion: GPU_ATOMIC_TRANSFORM_PROGRAM_ABI_VERSION,
                accepted: false,
                reason,
                requiresRecovery,
                retryable,
                receipt: null
            })
        );
        if (!this.atomicTransformProgramIngressOpen
            || this.terminalAtomicTransformProgramCancelStatus) {
            return reject('atomic-transform-ingress-closed');
        }
        if (!Array.isArray(request.records)
            || request.records.length === 0
            || request.records.length > this.atomicTransformCapacity) {
            return reject('atomic-transform-arm-contract', true);
        }
        let sourceTick;
        let targetFixedTick;
        let fingerprint;
        try {
            sourceTick = requirePositiveInteger(
                request.prepareSourceTick,
                'prepareSourceTick'
            );
            targetFixedTick = requirePositiveInteger(
                request.targetFixedTick,
                'targetFixedTick'
            );
            fingerprint = requirePositiveInteger(
                request.batchIdFingerprint,
                'batchIdFingerprint'
            );
        } catch (error) {
            return reject(`atomic-transform-arm-contract:${error.message}`, true);
        }
        if (targetFixedTick !== sourceTick + 1
            || request.transformFixedTick !== targetFixedTick
            || this.lastSubmittedSourceTick !== sourceTick) {
            return reject('atomic-transform-arm-stale');
        }
        const authentic = this.authenticAtomicTransformPrepareByFingerprint.get(
            fingerprint
        );
        if (!authentic
            || authentic.sourceTick !== sourceTick
            || authentic.targetFixedTick !== targetFixedTick
            || authentic.sessionGeneration !== this.sessionGeneration
            || authentic.deviceGeneration !== this.deviceGeneration
            || authentic.authoritativeEpoch !== this.authoritativeEpoch) {
            return reject('atomic-transform-prepare-stale');
        }
        const occupiedEntityIdToSlot = new Map();
        for (let slot = 0; slot < this.bodyCount; slot++) {
            const handle = this.slotActive[slot] === 1
                ? this.slotHandles[slot]
                : this.slotActive[slot] === 2
                    ? this.pendingSlotHandles[slot]
                    : null;
            if (!handle) {
                continue;
            }
            if (occupiedEntityIdToSlot.has(handle.entityId)) {
                this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
                return reject(
                    `atomic-transform-active-entity-id-conflict:${handle.entityId}`,
                    true
                );
            }
            occupiedEntityIdToSlot.set(handle.entityId, slot);
        }
        this.authenticAtomicTransformPrepareByFingerprint.delete(fingerprint);
        if (this.armedAtomicTransform) {
            return reject('atomic-transform-already-armed', true);
        }
        const readbackSlot = this.#claimAtomicTransformReadbackSlot();
        if (!readbackSlot) {
            return reject('atomic-transform-readback-capacity', false, true);
        }
        const preparedByKey = new Map(authentic.records.map((record) => [
            `${record.sourceEntityId}:${record.sourceIncarnation}`,
            record
        ]));
        const claimedNewSlots = [];
        const normalized = [];
        const usedSlots = new Set();
        const usedSourceEntityIds = new Set();
        const claimedDestinationEntityIds = new Set();
        const freeSlotsBeforeArm = [...this.freeSlots];
        const availableFreeSlots = [...freeSlotsBeforeArm].sort(
            (left, right) => left - right
        );
        try {
            for (let index = 0; index < request.records.length; index++) {
                const input = request.records[index];
                const sourceHandle = normalizeEntityHandle(
                    input.sourceHandles?.[0],
                    `atomicTransform[${index}].source`
                );
                const sourceKey = entityHandleKey(sourceHandle);
                const sourceSlot = this.handleToSlot.get(sourceKey);
                const prepared = preparedByKey.get(sourceKey);
                const evidence = input.prepareEvidence;
                if (sourceSlot === undefined || this.slotActive[sourceSlot] !== 1
                    || !prepared || !evidence
                    || evidence.recordFingerprint !== prepared.recordFingerprint
                    || evidence.commandGeneration !== prepared.commandGeneration
                    || evidence.batchIdFingerprint !== fingerprint
                    || evidence.triggerSourceTick
                        !== prepared.triggerSourceTick
                    || evidence.triggerSequence !== prepared.triggerSequence
                    || usedSlots.has(sourceSlot)
                    || usedSourceEntityIds.has(sourceHandle.entityId)
                    || occupiedEntityIdToSlot.get(sourceHandle.entityId)
                        !== sourceSlot) {
                    throw new RangeError('authentic prepare/source slot이 일치하지 않습니다.');
                }
                usedSlots.add(sourceSlot);
                usedSourceEntityIds.add(sourceHandle.entityId);
                const split = input.topologyId === 'ONE_TO_MANY';
                const delayed = input.topologyId === 'ONE_TO_ONE_DELAYED';
                const sourceRouteState = readGpuRouteRuntimeState(
                    this.hostRouteRuntimeStates,
                    this.capacity,
                    sourceSlot
                );
                if ((!split && !delayed)
                    || !Array.isArray(input.destinationHandles)
                    || !Array.isArray(input.destinationIntents)
                    || input.destinationHandles.length !== (split ? 2 : 1)
                    || input.destinationIntents.length !== (split ? 2 : 1)
                    || input.effectTransferDestinationIndex !== 0
                    || sourceRouteState.role === GPU_ROUTE_RUNTIME_ROLE.CLOSER) {
                    throw new RangeError('atomic transform topology/cardinality가 다릅니다.');
                }
                const destinationHandles = input.destinationHandles.map(
                    (handle, destinationIndex) => normalizeEntityHandle(
                        handle,
                        `atomicTransform[${index}].destination[${destinationIndex}]`
                    )
                );
                if (destinationHandles[0].entityId !== sourceHandle.entityId
                    || destinationHandles[0].incarnation
                        !== sourceHandle.incarnation + 1) {
                    throw new RangeError('child0/return은 source slot incarnation+1이어야 합니다.');
                }
                if (split && (
                    destinationHandles[1].entityId === sourceHandle.entityId
                    || occupiedEntityIdToSlot.has(destinationHandles[1].entityId)
                    || claimedDestinationEntityIds.has(
                        destinationHandles[1].entityId
                    )
                )) {
                    throw new RangeError(
                        'child1 entityId는 모든 active/pending/source/destination ID와 달라야 합니다.'
                    );
                }
                claimedDestinationEntityIds.add(destinationHandles[0].entityId);
                if (split) {
                    claimedDestinationEntityIds.add(
                        destinationHandles[1].entityId
                    );
                }
                const destinationSlots = [sourceSlot];
                if (split) {
                    let slot = availableFreeSlots.shift();
                    if (slot === undefined) {
                        if (this.bodyCount >= this.capacity) {
                            throw new RangeError('atomic-transform-capacity');
                        }
                        slot = this.bodyCount++;
                    }
                    if (usedSlots.has(slot) || this.slotActive[slot] !== 0) {
                        throw new RangeError('atomic transform free slot conflict');
                    }
                    usedSlots.add(slot);
                    destinationSlots.push(slot);
                    claimedNewSlots.push(slot);
                    this.slotActive[slot] = 2;
                    this.pendingSlotHandles[slot] = destinationHandles[1];
                    this.pendingHandleToSlot.set(
                        entityHandleKey(destinationHandles[1]),
                        slot
                    );
                    this.pendingBodyCount++;
                }
                for (let destinationIndex = 0;
                    destinationIndex < destinationSlots.length;
                    destinationIndex++) {
                    const slot = destinationSlots[destinationIndex];
                    const handle = destinationHandles[destinationIndex];
                    const intent = input.destinationIntents[destinationIndex];
                    const routeRuntimeState = sourceRouteState.role
                            === GPU_ROUTE_RUNTIME_ROLE.NONE
                        ? null
                        : Object.freeze({
                            ...sourceRouteState,
                            selfEntityId: handle.entityId,
                            selfIncarnation: handle.incarnation
                        });
                    const template = Object.freeze({
                        ...intent,
                        entityId: handle.entityId,
                        incarnation: handle.incarnation,
                        ...(routeRuntimeState ? { routeRuntimeState } : {}),
                        atomicTransformState: Object.freeze({
                            ...intent.atomicTransformState,
                            entityId: handle.entityId,
                            incarnation: handle.incarnation
                        })
                    });
                    writeGpuCircleBodySpawn(
                        this.hostAtomicTransformTemplateStorage,
                        slot,
                        template
                    );
                    writeGpuEffectBodyStateSpawn(
                        this.hostAtomicTransformTemplateEffectBodyState,
                        slot,
                        template
                    );
                    writeGpuFormationBodyStateSpawn(
                        this.hostAtomicTransformTemplateFormationBodyState,
                        slot,
                        template
                    );
                    writeGpuRouteRuntimeState(
                        this.hostAtomicTransformTemplateRouteRuntimeStates,
                        this.capacity,
                        slot,
                        routeRuntimeState
                    );
                    writeRenderStyle(
                        new DataView(this.hostAtomicTransformTemplateRenderStyles),
                        slot,
                        template
                    );
                    clearBodyControlStateSlot(
                        this.hostAtomicTransformTemplateBodyControlStates,
                        slot
                    );
                }
                normalized.push(Object.freeze({
                    topologyCode: split
                        ? GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_MANY
                        : GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_ONE_DELAYED,
                    sourceSlot,
                    sourceEntityId: sourceHandle.entityId,
                    sourceIncarnation: sourceHandle.incarnation,
                    sourceHandle,
                    destinationHandles: Object.freeze(destinationHandles.map(
                        (handle, destinationIndex) => Object.freeze({
                            ...handle,
                            slot: destinationSlots[destinationIndex]
                        })
                    )),
                    destinationSlots: Object.freeze(destinationSlots),
                    prepareRecordFingerprint: prepared.recordFingerprint,
                    commandGeneration: prepared.commandGeneration,
                    sourceCurrentHealthFixedPoint:
                        prepared.currentHealthFixedPoint,
                    sourceMaxHealthFixedPoint: prepared.maxHealthFixedPoint,
                    triggerSourceTick: prepared.triggerSourceTick,
                    triggerSequence: prepared.triggerSequence,
                    effectTransferDestinationIndex: 0
                }));
            }
        } catch (error) {
            for (const slot of claimedNewSlots) {
                const handle = this.pendingSlotHandles[slot];
                if (handle) this.pendingHandleToSlot.delete(entityHandleKey(handle));
                this.pendingSlotHandles[slot] = null;
                this.slotActive[slot] = 0;
                this.pendingBodyCount--;
            }
            this.freeSlots = freeSlotsBeforeArm;
            this.#releaseClaimedAtomicTransformReadbackSlot(readbackSlot);
            while (this.bodyCount > 0 && this.slotActive[this.bodyCount - 1] === 0) {
                this.bodyCount--;
            }
            return error.message === 'atomic-transform-capacity'
                ? reject('atomic-transform-capacity', false, true)
                : reject(`atomic-transform-arm-auth:${error.message}`, true);
        }
        const claimedSlotSet = new Set(claimedNewSlots);
        this.freeSlots = freeSlotsBeforeArm.filter(
            (slot) => !claimedSlotSet.has(slot)
        );
        let storage;
        try {
            storage = createGpuAtomicTransformProgramStorage(
                this.atomicTransformCapacity
            );
            writeGpuAtomicTransformProgramHeader(storage, {
                count: normalized.length,
                batchIdFingerprint: fingerprint,
                preparedSourceTick: sourceTick,
                targetFixedTick
            });
            normalized.forEach((record, index) => (
                writeGpuAtomicTransformProgramRecord(storage, index, record)
            ));
        } catch (error) {
            for (const slot of claimedNewSlots) {
                const handle = this.pendingSlotHandles[slot];
                if (handle) {
                    this.pendingHandleToSlot.delete(entityHandleKey(handle));
                }
                this.pendingSlotHandles[slot] = null;
                this.slotActive[slot] = 0;
                this.pendingBodyCount--;
            }
            this.freeSlots = freeSlotsBeforeArm;
            this.#releaseClaimedAtomicTransformReadbackSlot(readbackSlot);
            while (this.bodyCount > 0
                && this.slotActive[this.bodyCount - 1] === 0) {
                this.bodyCount--;
            }
            return reject(
                `atomic-transform-program-materialize:${error.message}`,
                true
            );
        }
        const receipt = Object.freeze({
            receiptId: Object.freeze({}),
            targetFixedTick,
            batchIdFingerprint: fingerprint
        });
        this.hostAtomicTransformProgram = storage;
        this.armedAtomicTransform = {
            commandId: request.commandId,
            sourceTick,
            targetFixedTick,
            batchIdFingerprint: fingerprint,
            records: Object.freeze(normalized),
            claimedNewSlots: Object.freeze(claimedNewSlots),
            freeSlotsBeforeArm: Object.freeze(freeSlotsBeforeArm),
            readbackSlot,
            receipt,
            commitRequested: false
        };
        return Object.freeze({
            abiVersion: GPU_ATOMIC_TRANSFORM_PROGRAM_ABI_VERSION,
            accepted: true,
            receipt,
            armedCount: normalized.length,
            requiresRecovery: false
        });
    }

    commitArmedAtomicTransformBatch(receipt) {
        const armed = this.armedAtomicTransform;
        if (!armed || armed.receipt !== receipt || armed.commitRequested) {
            return Object.freeze({
                accepted: false,
                reason: 'atomic-transform-receipt-invalid',
                requiresRecovery: true
            });
        }
        for (const record of armed.records) {
            const sourceKey = `${record.sourceEntityId}:${record.sourceIncarnation}`;
            this.handleToSlot.delete(sourceKey);
            for (let index = 0; index < record.destinationHandles.length; index++) {
                const destination = record.destinationHandles[index];
                const slot = destination.slot;
                copyBodySlot(
                    this.hostAtomicTransformTemplateStorage,
                    slot,
                    this.hostStorage,
                    slot
                );
                copyEffectBodySlot(
                    this.hostAtomicTransformTemplateEffectBodyState,
                    slot,
                    this.hostEffectBodyState,
                    slot
                );
                copyFormationBodySlot(
                    this.hostAtomicTransformTemplateFormationBodyState,
                    slot,
                    this.hostFormationBodyState,
                    slot
                );
                copyGpuRouteRuntimeStateSlot(
                    this.hostAtomicTransformTemplateRouteRuntimeStates,
                    this.capacity,
                    slot,
                    this.hostRouteRuntimeStates,
                    this.capacity,
                    slot
                );
                copyRenderStyleSlot(
                    this.hostAtomicTransformTemplateRenderStyles,
                    slot,
                    this.hostRenderStyles,
                    slot
                );
                clearBodyControlStateSlot(this.hostBodyControlStates, slot);
                this.slotActive[slot] = 1;
                this.slotRouteRuntimeDomain[slot] = readGpuRouteRuntimeState(
                    this.hostRouteRuntimeStates,
                    this.capacity,
                    slot
                ).role === GPU_ROUTE_RUNTIME_ROLE.NONE ? 0 : 1;
                this.slotHandles[slot] = Object.freeze({
                    entityId: destination.entityId,
                    incarnation: destination.incarnation
                });
                this.handleToSlot.set(
                    `${destination.entityId}:${destination.incarnation}`,
                    slot
                );
                if (index > 0) {
                    this.pendingHandleToSlot.delete(
                        `${destination.entityId}:${destination.incarnation}`
                    );
                    this.pendingSlotHandles[slot] = null;
                    this.pendingBodyCount--;
                    this.activeBodyCount++;
                }
            }
        }
        writeGpuCircleBodyCounts(this.hostStorage, { bodyCount: this.bodyCount });
        this.#refreshHostBodyDerivedState();
        // RouteState의 current path/lease/version은 GPU 권위입니다. Host template
        // mirror는 role/identity bookkeeping에만 쓰고, submit 초기에 전용 WGSL
        // rekey가 live source state를 destination들로 복제합니다.
        armed.commitRequested = true;
        return Object.freeze({
            abiVersion: GPU_ATOMIC_TRANSFORM_PROGRAM_ABI_VERSION,
            accepted: true,
            targetFixedTick: armed.targetFixedTick,
            committedCount: armed.records.length,
            requiresRecovery: false
        });
    }

    cancelArmedAtomicTransformBatch(receipt) {
        const armed = this.armedAtomicTransform;
        if (!armed || armed.receipt !== receipt || armed.commitRequested) {
            return Object.freeze({
                accepted: false,
                reason: 'atomic-transform-receipt-invalid',
                requiresRecovery: false
            });
        }
        for (const slot of armed.claimedNewSlots) {
            const handle = this.pendingSlotHandles[slot];
            if (handle) this.pendingHandleToSlot.delete(entityHandleKey(handle));
            this.pendingSlotHandles[slot] = null;
            this.slotActive[slot] = 0;
            this.pendingBodyCount--;
        }
        this.freeSlots = [...armed.freeSlotsBeforeArm];
        this.#releaseClaimedAtomicTransformReadbackSlot(armed.readbackSlot);
        this.armedAtomicTransform = null;
        while (this.bodyCount > 0 && this.slotActive[this.bodyCount - 1] === 0) {
            this.bodyCount--;
        }
        return Object.freeze({ accepted: true, cancelled: true });
    }

    cancelPendingAtomicTransformProgramsForTerminal(request = {}) {
        const finalFixedTick = Number(request.finalFixedTick);
        if (request.abiVersion
                !== GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION
            || !Number.isSafeInteger(finalFixedTick) || finalFixedTick <= 0) {
            return Object.freeze({
                abiVersion: GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION,
                state: 'failed',
                finalFixedTick: 0,
                pendingPrepareCount: 0,
                pendingTransformCount: 0,
                pendingReadbackCount: 0,
                failure: 'atomic-transform-terminal-contract'
            });
        }
        this.atomicTransformProgramIngressOpen = false;
        if (this.stagedAtomicTransformPrepareBatch) {
            this.#releaseClaimedAtomicTransformPrepareReadbackSlot(
                this.stagedAtomicTransformPrepareBatch.readbackSlot
            );
        }
        if (this.armedAtomicTransform && !this.armedAtomicTransform.commitRequested) {
            this.cancelArmedAtomicTransformBatch(
                this.armedAtomicTransform.receipt,
                'terminal'
            );
        }
        const committedReadbackSlot = this.armedAtomicTransform?.commitRequested
            ? this.armedAtomicTransform.readbackSlot
            : null;
        this.#retireAtomicTransformReadbacks(committedReadbackSlot);
        this.stagedAtomicTransformPrepareBatch = null;
        this.authenticAtomicTransformPrepareByFingerprint.clear();
        this.terminalAtomicTransformProgramCancelStatus = Object.freeze({
            abiVersion: GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION,
            state: 'armed',
            finalFixedTick,
            submittedTick: 0,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: Math.max(0, this.deviceGeneration),
            authoritativeEpoch: this.authoritativeEpoch,
            pendingPrepareCount: 0,
            pendingTransformCount:
                this.armedAtomicTransform?.commitRequested === true ? 1 : 0,
            pendingReadbackCount:
                this.pendingAtomicTransformPrepareReadbacks
                + this.pendingAtomicTransformReadbacks,
            failure: null
        });
        return this.terminalAtomicTransformProgramCancelStatus;
    }

    getAtomicTransformRuntimeStatus() {
        return Object.freeze({
            abiVersion: GPU_ATOMIC_TRANSFORM_RUNTIME_ABI_VERSION,
            state: this.state,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: this.deviceGeneration,
            authoritativeEpoch: this.authoritativeEpoch,
            ingressOpen: this.atomicTransformProgramIngressOpen,
            pendingPrepareCount:
                Number(this.stagedAtomicTransformPrepareBatch !== null)
                + this.atomicTransformPrepareBatchQueue.length
                + this.authenticAtomicTransformPrepareByFingerprint.size,
            pendingTransformCount: Number(this.armedAtomicTransform !== null),
            pendingReadbackCount:
                this.pendingAtomicTransformPrepareReadbacks
                + this.pendingAtomicTransformReadbacks,
            lastPrepareSourceTick: this.lastAtomicTransformPrepareSourceTick,
            lastCommittedTransformCount:
                this.lastAtomicTransformCommittedCount,
            lastEffectRekeyCount: this.lastAtomicTransformEffectRekeyCount,
            runtimeStatus: this.lastAtomicTransformRuntimeStatus,
            storageProfile: GPU_ATOMIC_TRANSFORM_RUNTIME_STORAGE_PROFILE,
            requiresRecovery: this.requiresAuthoritativeRebuild
                || this.lastAtomicTransformRuntimeStatus
                    !== GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.OK
                || this.terminalAtomicTransformProgramCancelStatus
                    ?.state === 'failed',
            failure: this.failure,
            terminal: this.terminalAtomicTransformProgramCancelStatus
        });
    }

    /** Authenticated T-1 release preparation을 same-slot T submit용으로 arm합니다. */
    armPreparedProjectileCaptureReleaseBatch(request = {}) {
        const reject = (reason, requiresRecovery = false, retryable = false) => (
            Object.freeze({
                abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                accepted: false,
                reason,
                requiresRecovery,
                retryable,
                receipt: null
            })
        );
        if (!this.projectileCaptureProgramIngressOpen
            || this.terminalProjectileCaptureProgramCancelStatus) {
            return reject('projectile-capture-release-ingress-closed');
        }
        if (!Array.isArray(request.records)
            || request.records.length === 0
            || request.records.length
                > this.projectileCaptureReleasePreparationCapacity
            || this.armedProjectileCaptureRelease) {
            return reject(
                this.armedProjectileCaptureRelease
                    ? 'projectile-capture-release-already-armed'
                    : 'projectile-capture-release-arm-contract',
                this.armedProjectileCaptureRelease !== null
            );
        }
        let prepareSourceTick;
        let targetFixedTick;
        let batchIdFingerprint;
        let requestedCommandIdFingerprint;
        try {
            prepareSourceTick = requireNonSentinelUint32(
                request.prepareSourceTick,
                'prepareSourceTick',
                { positive: true }
            );
            targetFixedTick = requireNonSentinelUint32(
                request.targetFixedTick,
                'targetFixedTick',
                { positive: true }
            );
            batchIdFingerprint = requireNonSentinelUint32(
                request.batchIdFingerprint,
                'batchIdFingerprint',
                { positive: true }
            );
            requestedCommandIdFingerprint = requireNonSentinelUint32(
                request.commandIdFingerprint,
                'commandIdFingerprint',
                { positive: true }
            );
        } catch (error) {
            return reject(
                `projectile-capture-release-arm-contract:${error.message}`,
                true
            );
        }
        if (targetFixedTick !== prepareSourceTick + 1
            || this.lastSubmittedSourceTick !== prepareSourceTick) {
            return reject('projectile-capture-release-arm-stale', false, true);
        }
        const commandIdFingerprint = fingerprintProjectileCaptureCommandId(
            request.commandId
        );
        if (requestedCommandIdFingerprint !== commandIdFingerprint) {
            return reject(
                'projectile-capture-release-command-fingerprint',
                false,
                true
            );
        }
        const invalid = GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT;
        const normalized = [];
        const seenProjectiles = new Set();
        try {
            for (let index = 0; index < request.records.length; index++) {
                const input = request.records[index];
                const projectileHandle = normalizeEntityHandle(
                    input.projectileHandle,
                    `projectileCaptureRelease[${index}].projectileHandle`
                );
                const captorHandle = normalizeEntityHandle(
                    input.captorHandle,
                    `projectileCaptureRelease[${index}].captorHandle`
                );
                const projectileKey = entityHandleKey(projectileHandle);
                const projectileBodySlot = this.handleToSlot.get(projectileKey);
                const captureSequence = requireNonSentinelUint32(
                    input.captureSequence,
                    `projectileCaptureRelease[${index}].captureSequence`,
                    { positive: true }
                );
                const releaseReason = requireNonSentinelUint32(
                    input.releaseReason,
                    `projectileCaptureRelease[${index}].releaseReason`,
                    { positive: true }
                );
                const evidence = input.prepareEvidence;
                if (seenProjectiles.has(projectileKey)
                    || projectileBodySlot === undefined
                    || this.slotActive[projectileBodySlot] !== 1
                    || releaseReason
                        < GPU_PROJECTILE_CAPTURE_RELEASE_REASON.NORMAL_DUE
                    || releaseReason
                        > GPU_PROJECTILE_CAPTURE_RELEASE_REASON
                            .CAPTOR_CORE_IMPACT
                    || !evidence || typeof evidence !== 'object'
                    || evidence.baseReason !== releaseReason
                    || evidence.projectileBodySlot !== projectileBodySlot
                    || evidence.captureSequence !== captureSequence) {
                    throw new RangeError('release projectile/evidence가 stale입니다.');
                }
                seenProjectiles.add(projectileKey);
                const captorBodySlot = requireNonSentinelUint32(
                    evidence.captorBodySlot,
                    `projectileCaptureRelease[${index}].captorBodySlot`
                );
                const capturedAtFixedTick = requireNonSentinelUint32(
                    evidence.capturedAtFixedTick,
                    `projectileCaptureRelease[${index}].capturedAtFixedTick`,
                    { positive: true }
                );
                const prepareFingerprint = requireNonSentinelUint32(
                    evidence.prepareFingerprint,
                    `projectileCaptureRelease[${index}].prepareFingerprint`,
                    { positive: true }
                );
                const authenticKey = projectileCapturePreparationKey(
                    batchIdFingerprint,
                    projectileHandle,
                    captureSequence,
                    prepareFingerprint
                );
                const authentic
                    = this.authenticProjectileCapturePreparationByKey.get(
                        authenticKey
                    );
                if (!authentic
                    || authentic.prepareSourceTick !== prepareSourceTick
                    || authentic.releaseReason !== releaseReason
                    || authentic.captorHandle.entityId !== captorHandle.entityId
                    || authentic.captorHandle.incarnation
                        !== captorHandle.incarnation
                    || authentic.projectileBodySlot !== projectileBodySlot
                    || authentic.captorBodySlot !== captorBodySlot
                    || evidence !== authentic.prepareEvidence
                    || authentic.prepareEvidence.prepareFingerprint
                        !== prepareFingerprint) {
                    throw new RangeError('authentic release preparation이 없습니다.');
                }
                const state = readGpuProjectileCaptureState(
                    this.hostStorage,
                    projectileBodySlot
                );
                if (state.role !== GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE
                    || state.phase
                        !== GPU_PROJECTILE_CAPTURE_PHASE.RELEASE_PREPARED
                    || state.captureSequence !== captureSequence
                    || state.peerEntityId !== captorHandle.entityId
                    || state.peerIncarnation !== captorHandle.incarnation
                    || state.peerBodySlot !== captorBodySlot) {
                    throw new RangeError('host capture state가 release proof와 다릅니다.');
                }
                const facingX = Math.fround(Number(evidence.facing?.x));
                const facingY = Math.fround(Number(evidence.facing?.y));
                const capturedSpeed = Math.fround(
                    Number(evidence.capturedSpeed)
                );
                const anchorX = Math.fround(Number(evidence.anchor?.x));
                const anchorY = Math.fround(Number(evidence.anchor?.y));
                const facingLength = Math.hypot(facingX, facingY);
                if (!Number.isFinite(facingLength)
                    || Math.abs(facingLength - 1) > 1e-4
                    || !Number.isFinite(capturedSpeed) || capturedSpeed <= 0
                    || !Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
                    throw new RangeError('release pose/speed proof가 손상됐습니다.');
                }
                const targetSelector = requireNonSentinelUint32(
                    evidence.targetSelector,
                    `projectileCaptureRelease[${index}].targetSelector`
                );
                let targetBodySlot = invalid;
                let targetHandle = Object.freeze({
                    entityId: invalid,
                    incarnation: invalid
                });
                if (targetSelector
                        === GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.TOWER) {
                    const exactTarget = normalizeEntityHandle(
                        input.targetHandle,
                        `projectileCaptureRelease[${index}].targetHandle`
                    );
                    targetBodySlot = this.handleToSlot.get(
                        entityHandleKey(exactTarget)
                    );
                    if (releaseReason
                            !== GPU_PROJECTILE_CAPTURE_RELEASE_REASON.NORMAL_DUE
                        || targetBodySlot === undefined
                        || this.slotActive[targetBodySlot] !== 1
                        || evidence.targetBodySlot !== targetBodySlot
                        || evidence.targetHandle?.entityId
                            !== exactTarget.entityId
                        || evidence.targetHandle?.incarnation
                            !== exactTarget.incarnation) {
                        throw new RangeError('release Tower proof가 stale입니다.');
                    }
                    targetHandle = Object.freeze({ ...exactTarget });
                } else if (targetSelector
                        !== GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR
                            .INVALID_FORWARD
                    || input.targetHandle !== null
                    || evidence.targetHandle !== null
                    || releaseReason
                        !== GPU_PROJECTILE_CAPTURE_RELEASE_REASON.NORMAL_DUE
                        && targetSelector
                            !== GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR
                                .INVALID_FORWARD) {
                    throw new RangeError('release forward proof가 잘못됐습니다.');
                }
                const currentBody = readGpuCircleBody(
                    this.hostStorage,
                    projectileBodySlot
                );
                const gameplay = unpackGpuCircleGameplayMeta(
                    currentBody.gameplayMeta
                );
                const interaction = unpackGpuCircleInteractionMeta(
                    currentBody.interactionMeta
                );
                const nextMetadata = input.nextMetadata;
                const coreImpactReceipt = input.coreImpactReceipt;
                const coreReceiptNamesCaptor = coreImpactReceipt
                    && ((coreImpactReceipt.entityId === captorHandle.entityId
                            && coreImpactReceipt.incarnation
                                === captorHandle.incarnation)
                        || (coreImpactReceipt.otherEntityId
                                === captorHandle.entityId
                            && coreImpactReceipt.otherIncarnation
                                === captorHandle.incarnation));
                const coreReceiptAuthentic = releaseReason
                        === GPU_PROJECTILE_CAPTURE_RELEASE_REASON
                            .CAPTOR_CORE_IMPACT
                    ? this.authenticProjectileCaptureCoreImpactReceipts
                        .has(coreImpactReceipt)
                        && coreImpactReceipt.sessionGeneration
                            === this.sessionGeneration
                        && coreImpactReceipt.deviceGeneration
                            === this.deviceGeneration
                        && coreImpactReceipt.authoritativeEpoch
                            === this.authoritativeEpoch
                        && coreImpactReceipt.sourceTick === prepareSourceTick
                        && coreImpactReceipt.type === 'contact'
                        && coreImpactReceipt.eventType === 'interaction-enter'
                        && coreImpactReceipt.disposition === 'applied'
                        && coreReceiptNamesCaptor
                    : coreImpactReceipt === null;
                if (!nextMetadata
                    || nextMetadata.teamId !== GAMEPLAY_TEAM_ID.HOSTILE
                    || nextMetadata.allegiancePolicy
                        !== GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE
                    || nextMetadata.damagePolicyId
                        !== gameplay.damagePolicyId
                    || nextMetadata.targetPolicyId
                        !== RING_PROJECTILE_CAPTURE_PROFILE
                            .releaseTargetPolicyId
                    || !coreReceiptAuthentic) {
                    throw new RangeError('release metadata materialization이 잘못됐습니다.');
                }
                const nextMetadataRevision = requireNonSentinelUint32(
                    input.nextMetadataRevision,
                    `projectileCaptureRelease[${index}].nextMetadataRevision`,
                    { positive: true }
                );
                normalized.push(Object.freeze({
                    commandIdFingerprint,
                    prepareFingerprint,
                    captorBodySlot,
                    captorHandle: Object.freeze({ ...captorHandle }),
                    projectileBodySlot,
                    projectileHandle: Object.freeze({ ...projectileHandle }),
                    captureSequence,
                    capturedAtFixedTick,
                    preparedAtFixedTick: prepareSourceTick,
                    releaseReason,
                    position: Object.freeze({ x: anchorX, y: anchorY }),
                    velocity: Object.freeze({
                        x: Math.fround(facingX * capturedSpeed),
                        y: Math.fround(facingY * capturedSpeed)
                    }),
                    capturedSpeed,
                    targetSelector,
                    targetBodySlot,
                    targetHandle,
                    nextGameplayMeta: packGpuCircleGameplayMeta(
                        GAMEPLAY_TEAM_ID.HOSTILE,
                        gameplay.damagePolicyId,
                        gameplay.damageResolutionPolicyId
                    ),
                    nextInteractionMeta: packGpuCircleInteractionMeta(
                        interaction.interactionLayer,
                        GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
                            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN
                    ),
                    nextTargetLayerMask:
                        GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
                        | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN,
                    teamId: nextMetadata.teamId,
                    allegiancePolicy: nextMetadata.allegiancePolicy,
                    damagePolicyId: nextMetadata.damagePolicyId,
                    targetPolicyId: nextMetadata.targetPolicyId,
                    metadataRevision: nextMetadataRevision,
                    authenticKey
                }));
            }
        } catch (error) {
            return reject(
                `projectile-capture-release-arm-auth:${error.message}`,
                false,
                true
            );
        }
        const storage = createGpuProjectileCaptureReleaseProgramStorage(
            this.projectileCaptureReleasePreparationCapacity
        );
        const view = new DataView(storage.buffer);
        try {
            writeGpuProjectileCaptureReleaseHeader(view, {
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: Math.max(0, this.deviceGeneration),
                authoritativeEpoch: this.authoritativeEpoch,
                publicationFixedTick: targetFixedTick,
                recordCount: normalized.length,
                batchIdFingerprint,
                flags: 0
            });
            normalized.forEach((record, index) => (
                writeGpuProjectileCaptureReleaseRecord(view, index, record)
            ));
        } catch (error) {
            return reject(
                `projectile-capture-release-program:${error.message}`,
                true
            );
        }
        for (const record of normalized) {
            this.authenticProjectileCapturePreparationByKey.delete(
                record.authenticKey
            );
        }
        for (const input of request.records) {
            if (input.releaseReason
                    === GPU_PROJECTILE_CAPTURE_RELEASE_REASON
                        .CAPTOR_CORE_IMPACT) {
                this.authenticProjectileCaptureCoreImpactReceipts.delete(
                    input.coreImpactReceipt
                );
            }
        }
        const receipt = Object.freeze({
            receiptId: Object.freeze({}),
            targetFixedTick,
            batchIdFingerprint,
            commandIdFingerprint
        });
        this.hostProjectileCaptureReleaseProgram = storage;
        this.armedProjectileCaptureRelease = {
            commandId: request.commandId,
            commandIdFingerprint,
            prepareSourceTick,
            targetFixedTick,
            batchIdFingerprint,
            records: Object.freeze(normalized),
            receipt,
            commitRequested: false
        };
        return Object.freeze({
            abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
            accepted: true,
            receipt,
            armedCount: normalized.length,
            commandIdFingerprint,
            requiresRecovery: false
        });
    }

    /** Registry metadata CAS 성공 뒤 submit-start release commit을 요청합니다. */
    commitArmedProjectileCaptureReleaseBatch(receipt) {
        const armed = this.armedProjectileCaptureRelease;
        if (!armed || armed.receipt !== receipt || armed.commitRequested) {
            return Object.freeze({
                accepted: false,
                reason: 'projectile-capture-release-receipt-invalid',
                requiresRecovery: true
            });
        }
        writeGpuProjectileCaptureReleaseHeader(
            new DataView(this.hostProjectileCaptureReleaseProgram.buffer),
            {
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: Math.max(0, this.deviceGeneration),
                authoritativeEpoch: this.authoritativeEpoch,
                publicationFixedTick: armed.targetFixedTick,
                recordCount: armed.records.length,
                batchIdFingerprint: armed.batchIdFingerprint,
                flags: GPU_PROJECTILE_CAPTURE_RELEASE_PROGRAM_FLAG
                    .COMMIT_REQUESTED
            }
        );
        armed.commitRequested = true;
        return Object.freeze({
            abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
            accepted: true,
            targetFixedTick: armed.targetFixedTick,
            committedCount: armed.records.length,
            commandIdFingerprint: armed.commandIdFingerprint,
            requiresRecovery: false
        });
    }

    cancelArmedProjectileCaptureReleaseBatch(receipt, reason = 'cancelled') {
        const armed = this.armedProjectileCaptureRelease;
        if (!armed || armed.receipt !== receipt || armed.commitRequested) {
            return Object.freeze({
                accepted: false,
                reason: 'projectile-capture-release-receipt-invalid',
                requiresRecovery: false
            });
        }
        this.armedProjectileCaptureRelease = null;
        return Object.freeze({
            accepted: true,
            cancelled: true,
            reason: String(reason)
        });
    }

    drainCompletedProjectileCaptureBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('ProjectileCapture drain 대상은 배열이어야 합니다.');
        }
        const entry = this.projectileCaptureBatchQueue[0];
        if (entry?.completed === true) {
            this.projectileCaptureBatchQueue.shift();
            out.push(entry.completion ?? Object.freeze({
                abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                sessionGeneration: entry.sessionGeneration,
                deviceGeneration: entry.deviceGeneration,
                authoritativeEpoch: entry.authoritativeEpoch,
                sourceTick: entry.sourceTick,
                completedThroughTick: this.projectileCaptureCompletedThroughTick,
                pending: false,
                captures: Object.freeze([]),
                releasePreparations: Object.freeze([]),
                cleanups: Object.freeze([]),
                failure: entry.failure
            }));
        }
        this.#completeDeferredIdleRelease();
        return out;
    }

    drainCompletedProjectileCaptureReleaseBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('ProjectileCapture release drain 대상은 배열이어야 합니다.');
        }
        const entry = this.projectileCaptureReleaseBatchQueue[0];
        if (entry?.completed === true) {
            this.projectileCaptureReleaseBatchQueue.shift();
            out.push(entry.completion ?? Object.freeze({
                abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                sessionGeneration: entry.sessionGeneration,
                deviceGeneration: entry.deviceGeneration,
                authoritativeEpoch: entry.authoritativeEpoch,
                sourceTick: entry.sourceTick,
                completedThroughTick: entry.sourceTick,
                pending: false,
                releaseCompletions: Object.freeze([]),
                failure: entry.failure
            }));
        }
        this.#completeDeferredIdleRelease();
        return out;
    }

    discardPreparedProjectileCaptureBatch({ batchIdFingerprint } = {}) {
        const fingerprint = Number(batchIdFingerprint);
        if (!Number.isSafeInteger(fingerprint)
            || fingerprint <= 0 || fingerprint >= UINT32_MAX) {
            return Object.freeze({
                accepted: false,
                reason: 'projectile-capture-discard-contract'
            });
        }
        if (this.armedProjectileCaptureRelease?.batchIdFingerprint
            === fingerprint) {
            return Object.freeze({
                accepted: false,
                reason: 'projectile-capture-discard-armed'
            });
        }
        for (const [key, record] of this
            .authenticProjectileCapturePreparationByKey) {
            if (record.batchIdFingerprint === fingerprint) {
                this.authenticProjectileCapturePreparationByKey.delete(key);
            }
        }
        return Object.freeze({
            accepted: true,
            batchIdFingerprint: fingerprint
        });
    }

    cancelPendingProjectileCaptureProgramsForTerminal(request = {}) {
        const finalFixedTick = Number(request.finalFixedTick);
        if (!Number.isSafeInteger(finalFixedTick) || finalFixedTick <= 0) {
            this.terminalProjectileCaptureProgramCancelStatus = Object.freeze({
                abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                state: 'failed',
                finalFixedTick: 0,
                failure: 'projectile-capture-terminal-contract'
            });
            return this.terminalProjectileCaptureProgramCancelStatus;
        }
        this.projectileCaptureProgramIngressOpen = false;
        let unpublishedCancelledCount
            = this.authenticProjectileCapturePreparationByKey.size;
        this.authenticProjectileCapturePreparationByKey.clear();
        if (this.armedProjectileCaptureRelease
            && !this.armedProjectileCaptureRelease.commitRequested) {
            unpublishedCancelledCount
                += this.armedProjectileCaptureRelease.records.length;
            this.armedProjectileCaptureRelease = null;
        }
        this.terminalProjectileCaptureProgramCancelStatus = Object.freeze({
            abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
            state: 'armed',
            finalFixedTick,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: Math.max(0, this.deviceGeneration),
            authoritativeEpoch: this.authoritativeEpoch,
            unpublishedCancelledCount,
            publishedCommitRequestedCount:
                this.armedProjectileCaptureRelease?.commitRequested === true
                    ? this.armedProjectileCaptureRelease.records.length
                    : 0,
            commitRequested:
                this.armedProjectileCaptureRelease?.commitRequested === true,
            failure: null
        });
        return this.getTerminalProjectileCaptureProgramCancelStatus();
    }

    getTerminalProjectileCaptureProgramCancelStatus() {
        const terminal = this.terminalProjectileCaptureProgramCancelStatus;
        if (!terminal) return null;
        const pendingCompletionBatchCount
            = this.projectileCaptureBatchQueue.length
                + this.projectileCaptureReleaseBatchQueue.length;
        const pendingReadbackCount = this.pendingProjectileCaptureReadbacks
            + this.pendingProjectileCaptureReleaseReadbacks;
        const settled = terminal.state === 'submitted'
            && this.armedProjectileCaptureRelease === null
            && this.pendingProjectileCaptureReadbacks === 0
            && this.pendingProjectileCaptureReleaseReadbacks === 0
            && pendingCompletionBatchCount === 0
            && this.authenticProjectileCapturePreparationByKey.size === 0;
        return Object.freeze({
            ...terminal,
            accepted: terminal.state !== 'failed',
            state: terminal.state === 'failed'
                ? 'failed'
                : settled ? 'settled' : 'armed',
            stagedReleaseCount:
                this.armedProjectileCaptureRelease?.records.length ?? 0,
            commitRequested: terminal.commitRequested === true,
            pendingCaptureReadbackCount:
                this.pendingProjectileCaptureReadbacks,
            pendingReadbackCount,
            pendingReleaseReadbackCount:
                this.pendingProjectileCaptureReleaseReadbacks,
            pendingCompletionBatchCount,
            unpublishedPreparedProofCount:
                this.authenticProjectileCapturePreparationByKey.size,
            completedThroughTick: terminal.completedThroughTick
                ?? this.projectileCaptureCompletedThroughTick,
            lastReleaseCommittedTick: terminal.lastReleaseCommittedTick
                ?? this.lastProjectileCaptureReleaseCommittedTick,
            failure: terminal.failure ?? this.failure
        });
    }

    getProjectileCaptureRuntimeStatus() {
        const armed = this.armedProjectileCaptureRelease;
        const terminal = this.terminalProjectileCaptureProgramCancelStatus;
        const terminalSnapshot = terminal?.state === 'submitted'
                && terminal.failure === null
                && terminal.sessionGeneration === this.sessionGeneration
                && Number.isSafeInteger(terminal.deviceGeneration)
                && terminal.deviceGeneration >= 0
                && Number.isSafeInteger(terminal.authoritativeEpoch)
                && terminal.authoritativeEpoch >= 0
                && Number.isSafeInteger(terminal.finalFixedTick)
                && terminal.finalFixedTick > 0
                && terminal.submittedTick === terminal.finalFixedTick
                && terminal.completedThroughTick === terminal.finalFixedTick
                && Number.isSafeInteger(terminal.lastReleaseCommittedTick)
                && terminal.lastReleaseCommittedTick >= 0
                && terminal.lastReleaseCommittedTick
                    <= terminal.completedThroughTick
            ? terminal
            : null;
        return Object.freeze({
            abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
            state: this.state,
            sessionGeneration:
                terminalSnapshot?.sessionGeneration ?? this.sessionGeneration,
            deviceGeneration: terminalSnapshot?.deviceGeneration
                ?? Math.max(0, this.deviceGeneration),
            authoritativeEpoch: terminalSnapshot?.authoritativeEpoch
                ?? this.authoritativeEpoch,
            ingressOpen: this.projectileCaptureProgramIngressOpen,
            captureCapacity: this.projectileCaptureCompletionCapacity,
            releasePreparationCapacity:
                this.projectileCaptureReleasePreparationCapacity,
            cleanupCapacity: this.projectileCaptureCleanupCapacity,
            activeDomainBodyCount: this.projectileCaptureDomainBodyCount,
            pendingCaptureReadbackCount: this.pendingProjectileCaptureReadbacks,
            pendingReleaseReadbackCount:
                this.pendingProjectileCaptureReleaseReadbacks,
            pendingCaptureBatchCount: this.projectileCaptureBatchQueue.length,
            pendingReleaseBatchCount:
                this.projectileCaptureReleaseBatchQueue.length,
            preparedBatchCount:
                this.authenticProjectileCapturePreparationByKey.size,
            armedReleaseCount: armed?.records.length ?? 0,
            stagedReleaseCount: armed?.records.length ?? 0,
            commitRequested: armed?.commitRequested === true,
            targetFixedTick: armed?.targetFixedTick ?? 0,
            sourceTick: this.lastProjectileCaptureSourceTick,
            completedThroughTick: terminalSnapshot?.completedThroughTick
                ?? this.projectileCaptureCompletedThroughTick,
            lastReleaseCommittedTick: terminalSnapshot?.lastReleaseCommittedTick
                ?? this.lastProjectileCaptureReleaseCommittedTick,
            runtimeStatus: this.lastProjectileCaptureRuntimeStatus,
            errorFlags: this.lastProjectileCaptureErrorFlags,
            storageProfile: GPU_PROJECTILE_CAPTURE_STORAGE_PROFILE,
            requiresRecovery: this.requiresAuthoritativeRebuild
                || this.state === 'failed'
                || this.failure !== null
                || this.lastProjectileCaptureErrorFlags !== 0
                || this.terminalProjectileCaptureProgramCancelStatus
                    ?.state === 'failed',
            failure: this.failure,
            terminal: this.getTerminalProjectileCaptureProgramCancelStatus()
        });
    }

    drainCompletedRouteAvailabilityBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('RouteAvailability drain 대상은 배열이어야 합니다.');
        }
        while (this.routeRuntimeBatchQueue[0]?.completed === true) {
            const entry = this.routeRuntimeBatchQueue.shift();
            if (entry.completion && entry.readbackBytes instanceof ArrayBuffer) {
                if (entry.sourceTick <= this.routeRuntimeCompletedThroughTick
                    || entry.completion.completedThroughTick !== entry.sourceTick
                    || entry.completion.availabilityVersion
                        < this.lastRouteAvailabilityVersion) {
                    this.failure = captureFailure(
                        'route-runtime-readback-order',
                        new Error('route availability queue-front가 회귀했습니다.')
                    );
                    this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
                    this.state = this.requiresAuthoritativeRebuild
                        ? 'requires-rebuild'
                        : 'failed';
                    entry.failure = this.failure;
                } else {
                    new Uint8Array(this.hostRouteAvailability).set(
                        new Uint8Array(entry.readbackBytes)
                    );
                    this.routeRuntimeCompletedThroughTick = entry.sourceTick;
                    this.lastRouteAvailabilityVersion
                        = entry.completion.availabilityVersion;
                    this.lastRouteRuntimeStatus = GPU_ROUTE_RUNTIME_STATUS.OK;
                    if (entry.expectedTerminalFinalSubmit
                        && this.terminalRouteAvailabilityProgramCancelStatus
                            ?.state === 'submitted') {
                        const snapshot = this.#readHostRouteAvailabilitySnapshot();
                        this.terminalRouteAvailabilityProgramCancelStatus
                            = Object.freeze({
                                ...this.terminalRouteAvailabilityProgramCancelStatus,
                                completedThroughTick: entry.sourceTick,
                                availabilityVersion: snapshot.availabilityVersion,
                                closedPathIds: snapshot.closedPathIds,
                                failure: null
                            });
                    }
                }
            }
            out.push(entry.failure ? Object.freeze({
                abiVersion: GPU_ROUTE_RUNTIME_ABI_VERSION,
                sessionGeneration: entry.sessionGeneration,
                deviceGeneration: entry.deviceGeneration,
                authoritativeEpoch: entry.authoritativeEpoch,
                sourceTick: entry.sourceTick,
                completedThroughTick: this.routeRuntimeCompletedThroughTick,
                availabilityVersion: this.lastRouteAvailabilityVersion,
                pending: false,
                records: Object.freeze([]),
                closedPathIndices: Object.freeze([]),
                failure: entry.failure
            }) : entry.completion ?? Object.freeze({
                abiVersion: GPU_ROUTE_RUNTIME_ABI_VERSION,
                sessionGeneration: entry.sessionGeneration,
                deviceGeneration: entry.deviceGeneration,
                authoritativeEpoch: entry.authoritativeEpoch,
                sourceTick: entry.sourceTick,
                completedThroughTick: this.routeRuntimeCompletedThroughTick,
                availabilityVersion: this.lastRouteAvailabilityVersion,
                pending: false,
                records: Object.freeze([]),
                closedPathIndices: Object.freeze([]),
                failure: entry.failure
            }));
        }
        this.#completeDeferredIdleRelease();
        return out;
    }

    getRouteAvailabilityRuntimeStatus() {
        const terminal = this.terminalRouteAvailabilityProgramCancelStatus;
        const snapshot = this.#readHostRouteAvailabilitySnapshot();
        return Object.freeze({
            abiVersion: GPU_ROUTE_RUNTIME_ABI_VERSION,
            state: this.state,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: Math.max(0, this.deviceGeneration),
            authoritativeEpoch: this.routeAuthoritativeEpoch,
            ingressOpen: this.routeRuntimeIngressOpen,
            graphEnabled: this.routeRuntimeTopology.enabled,
            graphContentKey: this.routeRuntimeTopology.contentKey,
            closureCount: this.routeRuntimeTopology.graph?.closures.length ?? 0,
            availabilityVersion: snapshot.availabilityVersion,
            closedPathIds: snapshot.closedPathIds,
            rosterCount: this.routeRuntimeRosterCount,
            capacity: GPU_ROUTE_RUNTIME_MAX_CLOSERS,
            leaseCount: snapshot.leaseCount,
            lifecycleReservationCount: this.routeLifecycleReservations.size,
            stagedCount: this.stagedRouteCleanupBatch?.records.length ?? 0,
            commitRequested: this.stagedRouteCleanupBatch !== null,
            pendingReadbackCount: this.pendingRouteRuntimeReadbacks,
            queuedBatchCount: this.routeRuntimeBatchQueue.length,
            completedThroughTick: this.routeRuntimeCompletedThroughTick,
            runtimeStatus: this.lastRouteRuntimeStatus,
            storageBuffersPerStage: 9,
            requiresRecovery: this.requiresAuthoritativeRebuild
                || this.state === 'failed'
                || this.failure !== null
                || this.lastRouteRuntimeStatus !== GPU_ROUTE_RUNTIME_STATUS.OK
                || terminal?.state === 'failed',
            failure: terminal?.failure ?? this.failure,
            terminal: this.getTerminalRouteAvailabilityProgramCancelStatus()
        });
    }

    cancelPendingRouteAvailabilityProgramsForTerminal(request = {}) {
        let finalFixedTick;
        try {
            finalFixedTick = requireNonSentinelUint32(
                request.finalFixedTick,
                'routeTerminal.finalFixedTick',
                { positive: true }
            );
        } catch (error) {
            this.terminalRouteAvailabilityProgramCancelStatus = Object.freeze({
                abiVersion: GPU_ROUTE_RUNTIME_ABI_VERSION,
                state: 'failed',
                accepted: false,
                finalFixedTick: 0,
                failure: `route-terminal-contract:${error.message}`
            });
            return this.getTerminalRouteAvailabilityProgramCancelStatus();
        }
        this.routeRuntimeIngressOpen = false;
        if (!this.routeRuntimeTopology.enabled) {
            this.terminalRouteAvailabilityProgramCancelStatus = Object.freeze({
                abiVersion: GPU_ROUTE_RUNTIME_ABI_VERSION,
                state: 'submitted',
                accepted: true,
                finalFixedTick,
                submittedTick: finalFixedTick,
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: Math.max(0, this.deviceGeneration),
                authoritativeEpoch: this.routeAuthoritativeEpoch,
                availabilityVersion: 1,
                closedPathIds: Object.freeze([]),
                completedThroughTick: finalFixedTick,
                failure: null
            });
            return this.getTerminalRouteAvailabilityProgramCancelStatus();
        }
        if (this.routeRuntimeRosterCount !== 0
            || this.routeLifecycleReservations.size !== 0) {
            this.terminalRouteAvailabilityProgramCancelStatus = Object.freeze({
                abiVersion: GPU_ROUTE_RUNTIME_ABI_VERSION,
                state: 'failed',
                accepted: false,
                finalFixedTick,
                failure: 'route-terminal-roster-not-sealed'
            });
            return this.getTerminalRouteAvailabilityProgramCancelStatus();
        }
        const snapshot = this.#readHostRouteAvailabilitySnapshot();
        this.terminalRouteAvailabilityProgramCancelStatus = Object.freeze({
            abiVersion: GPU_ROUTE_RUNTIME_ABI_VERSION,
            state: 'armed',
            accepted: true,
            finalFixedTick,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: Math.max(0, this.deviceGeneration),
            authoritativeEpoch: this.routeAuthoritativeEpoch,
            availabilityVersion: snapshot.availabilityVersion,
            closedPathIds: snapshot.closedPathIds,
            failure: null
        });
        return this.getTerminalRouteAvailabilityProgramCancelStatus();
    }

    getTerminalRouteAvailabilityProgramCancelStatus() {
        const terminal = this.terminalRouteAvailabilityProgramCancelStatus;
        if (!terminal) return null;
        const snapshot = this.#readHostRouteAvailabilitySnapshot();
        const allOpen = snapshot.closedPathIds.length === 0
            && snapshot.records.every(
                (record) => record.state === GPU_ROUTE_AVAILABILITY_STATE.OPEN
                    && record.ownerSlot === UINT32_MAX
                    && record.ownerHandle === null
                    && record.leaseGeneration === 0
            );
        const settled = terminal.state === 'submitted'
            && this.routeRuntimeRosterCount === 0
            && this.routeLifecycleReservations.size === 0
            && this.stagedRouteCleanupBatch === null
            && this.pendingRouteRuntimeReadbacks === 0
            && this.routeRuntimeBatchQueue.length === 0
            && allOpen
            && (terminal.completedThroughTick
                ?? this.routeRuntimeCompletedThroughTick) >= terminal.finalFixedTick;
        return Object.freeze({
            ...terminal,
            accepted: terminal.state !== 'failed',
            state: terminal.state === 'failed'
                ? 'failed'
                : settled ? 'settled' : terminal.state,
            finalFixedTick: terminal.finalFixedTick,
            completedThroughTick: terminal.completedThroughTick
                ?? this.routeRuntimeCompletedThroughTick,
            availabilityVersion: terminal.availabilityVersion
                ?? snapshot.availabilityVersion,
            rosterCount: this.routeRuntimeRosterCount,
            closedPathIds: terminal.closedPathIds ?? snapshot.closedPathIds,
            allOpen,
            leaseCount: snapshot.leaseCount,
            stagedCount: this.stagedRouteCleanupBatch?.records.length ?? 0,
            commitRequested: this.stagedRouteCleanupBatch !== null,
            pendingReadbackCount: this.pendingRouteRuntimeReadbacks,
            pendingCompletionBatchCount: this.routeRuntimeBatchQueue.length,
            lifecycleReservationCount: this.routeLifecycleReservations.size,
            failure: terminal.failure ?? this.failure
        });
    }

    resolveExactRouteBodySlot(handle) {
        let exact;
        try {
            exact = normalizeEntityHandle(handle, 'routeBodyHandle');
        } catch {
            return null;
        }
        if (exact.entityId === 0 || exact.incarnation === 0) return null;
        const bodySlot = this.handleToSlot.get(entityHandleKey(exact));
        if (bodySlot === undefined || this.slotActive[bodySlot] !== 1) return null;
        const routeState = readGpuRouteRuntimeState(
            this.hostRouteRuntimeStates,
            this.capacity,
            bodySlot
        );
        if (routeState.role === GPU_ROUTE_RUNTIME_ROLE.NONE
            || routeState.selfEntityId !== exact.entityId
            || routeState.selfIncarnation !== exact.incarnation) {
            return null;
        }
        const availability = this.#readHostRouteAvailabilitySnapshot();
        const availabilityRecord = availability.records.find((record) => (
            record.ownerHandle?.entityId === exact.entityId
                && record.ownerHandle?.incarnation === exact.incarnation
        )) ?? null;
        return Object.freeze({
            bodySlot,
            handle: Object.freeze({ ...exact }),
            role: routeState.role,
            routeSetIndex: routeState.routeSetIndex,
            profileCode: routeState.profileCode,
            availabilityVersion: availability.availabilityVersion,
            closureIndex: availabilityRecord?.closureIndex
                ?? GPU_ROUTE_RUNTIME_INVALID_INDEX,
            leaseGeneration: availabilityRecord?.leaseGeneration ?? 0,
            availabilityState: availabilityRecord?.state
                ?? GPU_ROUTE_AVAILABILITY_STATE.OPEN
        });
    }

    preflightRouteLifecycleBatch(request = {}) {
        const reject = (reason, requiresRecovery = false) => Object.freeze({
            abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
            accepted: false,
            reason,
            requiresRecovery,
            targetFixedTick: Number.isSafeInteger(Number(request.targetFixedTick))
                ? Number(request.targetFixedTick)
                : 0,
            batchIdFingerprint:
                Number.isSafeInteger(Number(request.batchIdFingerprint))
                    ? Number(request.batchIdFingerprint)
                    : 0,
            spawnReservationCount: 0,
            cleanupReservationCount: 0,
            receipt: null
        });
        if (!this.routeRuntimeIngressOpen) {
            return reject('route-lifecycle-ingress-closed');
        }
        let targetFixedTick;
        let batchIdFingerprint;
        let spawnPlans;
        let despawnPlans;
        try {
            if (request.abiVersion !== GPU_ROUTE_LIFECYCLE_ABI_VERSION) {
                throw new RangeError('route lifecycle ABI version mismatch');
            }
            targetFixedTick = requireNonSentinelUint32(
                request.targetFixedTick,
                'routeLifecycle.targetFixedTick',
                { positive: true }
            );
            batchIdFingerprint = requireNonSentinelUint32(
                request.batchIdFingerprint,
                'routeLifecycle.batchIdFingerprint',
                { positive: true }
            );
            spawnPlans = request.spawnPlans ?? [];
            despawnPlans = request.despawnPlans ?? [];
            if (!Array.isArray(spawnPlans) || !Array.isArray(despawnPlans)
                || (spawnPlans.length === 0) === (despawnPlans.length === 0)
                || spawnPlans.length > GPU_ROUTE_RUNTIME_MAX_CLOSERS
                || despawnPlans.length > GPU_ROUTE_RUNTIME_MAX_CLOSERS) {
                throw new RangeError('route lifecycle은 exact 단일 sub-batch여야 합니다.');
            }
        } catch (error) {
            return reject(`route-lifecycle-contract:${error.message}`);
        }
        const kind = spawnPlans.length > 0 ? 'spawn' : 'despawn';
        const normalizedPlans = [];
        const cleanupRecords = [];
        const seenHandles = new Set();
        const seenCommandFingerprints = new Set();
        try {
            const plans = kind === 'spawn' ? spawnPlans : despawnPlans;
            for (let index = 0; index < plans.length; index++) {
                const plan = plans[index];
                if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
                    throw new TypeError(`routeLifecycle.${kind}[${index}]가 객체가 아닙니다.`);
                }
                const commandIdFingerprint = requireNonSentinelUint32(
                    plan.commandIdFingerprint,
                    `routeLifecycle.${kind}[${index}].commandIdFingerprint`,
                    { positive: true }
                );
                const exactHandle = normalizeEntityHandle(
                    plan.handle,
                    `routeLifecycle.${kind}[${index}].handle`
                );
                if (exactHandle.entityId === 0 || exactHandle.incarnation === 0) {
                    throw new RangeError('route lifecycle handle은 positive여야 합니다.');
                }
                const handleKey = entityHandleKey(exactHandle);
                if (seenHandles.has(handleKey)
                    || seenCommandFingerprints.has(commandIdFingerprint)) {
                    throw new RangeError('route lifecycle identity가 중복되었습니다.');
                }
                seenHandles.add(handleKey);
                seenCommandFingerprints.add(commandIdFingerprint);
                if (kind === 'spawn') {
                    const sequence = requireNonSentinelUint32(
                        plan.sequence,
                        `routeLifecycle.spawn[${index}].sequence`
                    );
                    if (typeof plan.definitionId !== 'string'
                        || plan.definitionId.length === 0
                        || typeof plan.routeClosureProfileId !== 'string'
                        || plan.routeClosureProfileId.length === 0
                        || requireNonSentinelUint32(
                            plan.routeClosureProfileCode,
                            `routeLifecycle.spawn[${index}].profileCode`,
                            { positive: true }
                        ) !== 1
                        || this.handleToSlot.has(handleKey)) {
                        throw new RangeError('route lifecycle spawn plan이 canonical하지 않습니다.');
                    }
                    normalizedPlans.push(Object.freeze({
                        commandId: String(plan.commandId),
                        commandIdFingerprint,
                        sequence,
                        definitionId: plan.definitionId,
                        routeClosureProfileId: plan.routeClosureProfileId,
                        routeClosureProfileCode: plan.routeClosureProfileCode,
                        handle: Object.freeze({ ...exactHandle })
                    }));
                } else {
                    const exactBody = this.resolveExactRouteBodySlot(exactHandle);
                    if (!exactBody
                        || exactBody.role !== GPU_ROUTE_RUNTIME_ROLE.CLOSER) {
                        throw new RangeError('despawn 대상이 active exact Cork가 아닙니다.');
                    }
                    normalizedPlans.push(Object.freeze({
                        commandId: String(plan.commandId),
                        commandIdFingerprint,
                        handle: Object.freeze({ ...exactHandle }),
                        reason: String(plan.reason),
                        disposition: String(plan.disposition),
                        exactBody
                    }));
                    if (exactBody.closureIndex !== GPU_ROUTE_RUNTIME_INVALID_INDEX
                        && exactBody.leaseGeneration > 0) {
                        cleanupRecords.push(Object.freeze({
                            bodySlot: exactBody.bodySlot,
                            entityId: exactHandle.entityId,
                            incarnation: exactHandle.incarnation,
                            closureIndex: exactBody.closureIndex,
                            leaseGeneration: exactBody.leaseGeneration,
                            observedAvailabilityVersion:
                                exactBody.availabilityVersion,
                            commandIdFingerprint
                        }));
                    }
                }
            }
        } catch (error) {
            return reject(`route-lifecycle-contract:${error.message}`);
        }
        if (kind === 'spawn') {
            let pendingSpawnCount = 0;
            for (const reservation of this.routeLifecycleReservations.values()) {
                if (reservation.kind === 'spawn') {
                    pendingSpawnCount += reservation.plans.length;
                }
            }
            if (this.routeRuntimeRosterCount
                + pendingSpawnCount + normalizedPlans.length
                > GPU_ROUTE_RUNTIME_MAX_CLOSERS) {
                return reject('route-roster-capacity');
            }
        } else if (this.stagedRouteCleanupBatch !== null
            || [...this.routeLifecycleReservations.values()].some(
                (reservation) => reservation.kind === 'despawn'
            )) {
            return reject('route-cleanup-reservation-busy');
        }
        const receipt = Object.freeze({
            receiptId: this.nextRouteLifecycleReceiptId++,
            token: Object.freeze({})
        });
        this.routeLifecycleReservations.set(receipt, Object.freeze({
            kind,
            targetFixedTick,
            batchIdFingerprint,
            plans: Object.freeze(normalizedPlans),
            cleanupRecords: Object.freeze(cleanupRecords),
            rosterCountBefore: this.routeRuntimeRosterCount
        }));
        return Object.freeze({
            abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
            accepted: true,
            reason: null,
            requiresRecovery: false,
            targetFixedTick,
            batchIdFingerprint,
            spawnReservationCount: kind === 'spawn' ? normalizedPlans.length : 0,
            cleanupReservationCount: kind === 'despawn'
                ? normalizedPlans.length
                : 0,
            receipt
        });
    }

    commitRouteLifecycleBatch(receipt, publication = {}) {
        const reservation = this.routeLifecycleReservations.get(receipt);
        const reject = (reason) => {
            const error = new Error(reason);
            this.failure = captureFailure('route-lifecycle-commit', error);
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            this.state = this.requiresAuthoritativeRebuild
                ? 'requires-rebuild'
                : 'failed';
            return Object.freeze({
                abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
                accepted: false,
                reason,
                requiresRecovery: true,
                targetFixedTick: reservation?.targetFixedTick ?? 0,
                batchIdFingerprint: reservation?.batchIdFingerprint ?? 0,
                spawnedCount: 0,
                cleanedCount: 0,
                runtimeBinding: null
            });
        };
        if (!reservation) return reject('route-lifecycle-receipt-invalid');
        let records;
        try {
            if (publication.abiVersion !== GPU_ROUTE_LIFECYCLE_ABI_VERSION
                || publication.targetFixedTick !== reservation.targetFixedTick
                || publication.batchIdFingerprint
                    !== reservation.batchIdFingerprint) {
                throw new RangeError('route lifecycle publication header mismatch');
            }
            const expectedKey = reservation.kind === 'spawn'
                ? 'spawned'
                : 'despawned';
            const emptyKey = reservation.kind === 'spawn'
                ? 'despawned'
                : 'spawned';
            records = publication[expectedKey];
            if (!Array.isArray(records)
                || records.length !== reservation.plans.length
                || !Array.isArray(publication[emptyKey])
                || publication[emptyKey].length !== 0) {
                throw new RangeError('route lifecycle publication cardinality mismatch');
            }
            for (let index = 0; index < records.length; index++) {
                const record = records[index];
                const plan = reservation.plans[index];
                const exactHandle = normalizeEntityHandle(
                    record.handle,
                    `routeLifecycle.publication[${index}].handle`
                );
                if (record.commandIdFingerprint !== plan.commandIdFingerprint
                    || String(record.commandId) !== plan.commandId
                    || exactHandle.entityId !== plan.handle.entityId
                    || exactHandle.incarnation !== plan.handle.incarnation) {
                    throw new RangeError('route lifecycle publication identity mismatch');
                }
            }
            if (reservation.kind === 'spawn') {
                for (const plan of reservation.plans) {
                    const exactBody = this.resolveExactRouteBodySlot(plan.handle);
                    if (!exactBody
                        || exactBody.role !== GPU_ROUTE_RUNTIME_ROLE.CLOSER
                        || exactBody.profileCode !== plan.routeClosureProfileCode) {
                        throw new RangeError('spawned Cork body binding mismatch');
                    }
                }
                if (this.routeRuntimeRosterCount
                    > GPU_ROUTE_RUNTIME_MAX_CLOSERS) {
                    throw new RangeError('route roster capacity exceeded after publication');
                }
            } else {
                for (const plan of reservation.plans) {
                    if (this.resolveExactRouteBodySlot(plan.handle) !== null) {
                        throw new RangeError('despawned Cork body가 아직 active입니다.');
                    }
                }
                if (reservation.cleanupRecords.length > 0) {
                    this.stageRouteLifecycleCleanupBatch({
                        targetFixedTick: reservation.targetFixedTick,
                        batchIdFingerprint: reservation.batchIdFingerprint,
                        records: reservation.cleanupRecords
                    });
                }
            }
        } catch (error) {
            return reject(`route-lifecycle-publication:${error.message}`);
        }
        this.routeLifecycleReservations.delete(receipt);
        const runtimeBinding = this.#getRouteRuntimeBinding();
        return Object.freeze({
            abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
            accepted: true,
            reason: null,
            requiresRecovery: false,
            targetFixedTick: reservation.targetFixedTick,
            batchIdFingerprint: reservation.batchIdFingerprint,
            spawnedCount: reservation.kind === 'spawn' ? records.length : 0,
            cleanedCount: reservation.kind === 'despawn' ? records.length : 0,
            rosterCount: this.routeRuntimeRosterCount,
            runtimeBinding
        });
    }

    cancelRouteLifecycleBatch(receipt, reason = 'cancelled') {
        const reservation = this.routeLifecycleReservations.get(receipt);
        if (!reservation) {
            return Object.freeze({
                abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
                accepted: false,
                reason: 'route-lifecycle-receipt-invalid',
                cancelledSpawnReservationCount: 0,
                cancelledCleanupReservationCount: 0
            });
        }
        this.routeLifecycleReservations.delete(receipt);
        return Object.freeze({
            abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
            accepted: true,
            reason: String(reason),
            cancelledSpawnReservationCount: reservation.kind === 'spawn'
                ? reservation.plans.length
                : 0,
            cancelledCleanupReservationCount: reservation.kind === 'despawn'
                ? reservation.plans.length
                : 0
        });
    }

    stageRouteLifecycleCleanupBatch(request = {}) {
        if (this.stagedRouteCleanupBatch !== null) {
            throw new Error('route cleanup batch가 이미 staged 상태입니다.');
        }
        const targetFixedTick = requireNonSentinelUint32(
            request.targetFixedTick,
            'routeCleanup.targetFixedTick',
            { positive: true }
        );
        const batchIdFingerprint = requireNonSentinelUint32(
            request.batchIdFingerprint,
            'routeCleanup.batchIdFingerprint',
            { positive: true }
        );
        const records = request.records ?? [];
        if (!Array.isArray(records)
            || records.length === 0
            || records.length > GPU_ROUTE_RUNTIME_MAX_CLOSERS) {
            throw new RangeError('route cleanup batch cardinality가 유효하지 않습니다.');
        }
        writeGpuRouteCleanupProgram(this.hostRouteCleanupProgram, {
            targetFixedTick,
            batchIdFingerprint,
            records
        });
        this.stagedRouteCleanupBatch = Object.freeze({
            targetFixedTick,
            batchIdFingerprint,
            records: Object.freeze([...records])
        });
        return Object.freeze({
            accepted: true,
            targetFixedTick,
            batchIdFingerprint,
            stagedCount: records.length
        });
    }

    #getRouteRuntimeBinding() {
        const snapshot = this.#readHostRouteAvailabilitySnapshot();
        return Object.freeze({
            abiVersion: GPU_ROUTE_RUNTIME_ABI_VERSION,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: Math.max(0, this.deviceGeneration),
            authoritativeEpoch: this.routeAuthoritativeEpoch,
            graphContentKey: this.routeRuntimeTopology.contentKey,
            availabilityVersion: snapshot.availabilityVersion,
            rosterCount: this.routeRuntimeRosterCount
        });
    }

    /** Endpoint coherent generic-event publication만 authentic Core receipt를 등록합니다. */
    registerProjectileCaptureCoreImpactReceipt(receipt) {
        if (!receipt || typeof receipt !== 'object' || !Object.isFrozen(receipt)
            || receipt.sessionGeneration !== this.sessionGeneration
            || receipt.deviceGeneration !== this.deviceGeneration
            || receipt.authoritativeEpoch !== this.authoritativeEpoch
            || receipt.sourceTick !== this.projectileCaptureCompletedThroughTick
            || receipt.type !== 'contact'
            || receipt.eventType !== 'interaction-enter'
            || receipt.disposition !== 'applied'
            || !Number.isSafeInteger(receipt.entityId)
            || receipt.entityId <= 0
            || !Number.isSafeInteger(receipt.incarnation)
            || receipt.incarnation <= 0
            || !Number.isSafeInteger(receipt.otherEntityId)
            || receipt.otherEntityId <= 0
            || !Number.isSafeInteger(receipt.otherIncarnation)
            || receipt.otherIncarnation <= 0) {
            return false;
        }
        this.authenticProjectileCaptureCoreImpactReceipts.add(receipt);
        return true;
    }

    getProjectileCaptureBodyState(handle) {
        const exact = normalizeEntityHandle(handle, 'projectileCaptureHandle');
        const slot = this.handleToSlot.get(entityHandleKey(exact));
        if (slot === undefined || this.slotActive[slot] !== 1) return null;
        const simulationOffset = slot * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
        const flags = new DataView(this.hostStorage.simulationBuffer).getUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
            LITTLE_ENDIAN
        );
        return Object.freeze({
            handle: Object.freeze({ ...exact }),
            bodySlot: slot,
            state: readGpuProjectileCaptureState(this.hostStorage, slot),
            capturedMirror: (
                flags & GPU_CIRCLE_BODY_SIMULATION_FLAG.PROJECTILE_CAPTURED
            ) !== 0,
            releaseCommitRequested: this.armedProjectileCaptureRelease
                ?.commitRequested === true
                && this.armedProjectileCaptureRelease.records.some((record) => (
                    record.projectileHandle.entityId === exact.entityId
                    && record.projectileHandle.incarnation === exact.incarnation
                ))
        });
    }

    /**
     * Terminal final submit 앞에서 unresolved destination programs를 exact-set으로
     * tombstone하고 모든 fixed-program/readback lease를 퇴역시킵니다. queue.writeBuffer
     * 호출은 이전 submit 뒤, caller의 마지막 fixed submit 앞에 FIFO로 배치됩니다.
     */
    cancelPendingFixedProgramsForTerminal(request = {}) {
        const abiVersion = Number(request.abiVersion);
        const finalFixedTick = requirePositiveInteger(
            request.finalFixedTick,
            'terminalCancel.finalFixedTick'
        );
        const destinationHandles = request.destinationHandles ?? [];
        const priorityControls = request.priorityControls ?? [];
        this.fixedProgramIngressOpen = false;

        const failure = (reason) => {
            const result = Object.freeze({
                abiVersion: GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION,
                finalFixedTick,
                accepted: false,
                state: 'failed',
                reason,
                destinationCount: this.pendingHandleToSlot.size,
                priorityControlCount: this.#collectPendingPriorityControls().size
            });
            this.terminalFixedProgramCancelStatus = result;
            return result;
        };
        if (abiVersion !== GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION
            || !Array.isArray(destinationHandles)
            || !Array.isArray(priorityControls)) {
            return failure('terminal-fixed-program-cancel-contract');
        }
        if (this.terminalFixedProgramCancelStatus) {
            const prior = this.terminalFixedProgramCancelStatus;
            return prior.finalFixedTick === finalFixedTick
                && prior.abiVersion === abiVersion
                ? prior
                : failure('terminal-fixed-program-cancel-replay-mismatch');
        }

        const requestedDestinations = new Map();
        try {
            for (let index = 0; index < destinationHandles.length; index++) {
                const handle = normalizeEntityHandle(
                    destinationHandles[index],
                    `terminalCancel.destinationHandles[${index}]`
                );
                const key = entityHandleKey(handle);
                if (requestedDestinations.has(key)) {
                    return failure('terminal-destination-duplicate');
                }
                requestedDestinations.set(key, handle);
            }
        } catch {
            return failure('terminal-destination-contract');
        }
        if (requestedDestinations.size !== this.pendingHandleToSlot.size) {
            return failure('terminal-destination-exact-set-mismatch');
        }
        const pendingSpawnPrograms = this.#collectPendingSpawnPrograms();
        if (pendingSpawnPrograms.size !== this.pendingHandleToSlot.size) {
            return failure('terminal-spawn-program-exact-set-mismatch');
        }
        for (const [key, slot] of this.pendingHandleToSlot) {
            const requested = requestedDestinations.get(key);
            const pendingHandle = this.pendingSlotHandles[slot];
            const pendingProgram = pendingSpawnPrograms.get(key);
            if (!requested
                || !pendingProgram
                || pendingProgram.destinationSlot !== slot
                || this.slotActive[slot] !== 2
                || !pendingHandle
                || entityHandleKey(pendingHandle) !== key) {
                return failure('terminal-destination-exact-set-mismatch');
            }
        }

        const pendingPriorities = this.#collectPendingPriorityControls();
        const requestedPriorities = new Map();
        try {
            for (let index = 0; index < priorityControls.length; index++) {
                const sourceTick = requirePositiveInteger(
                    priorityControls[index]?.sourceTick,
                    `terminalCancel.priorityControls[${index}].sourceTick`
                );
                const sourceHandle = normalizeEntityHandle(
                    priorityControls[index]?.sourceHandle,
                    `terminalCancel.priorityControls[${index}].sourceHandle`
                );
                const key = `${sourceTick}:${entityHandleKey(sourceHandle)}`;
                if (requestedPriorities.has(key)) {
                    return failure('terminal-priority-control-duplicate');
                }
                requestedPriorities.set(key, Object.freeze({
                    sourceTick,
                    sourceHandle
                }));
            }
        } catch {
            return failure('terminal-priority-control-contract');
        }
        if (requestedPriorities.size !== pendingPriorities.size) {
            return failure('terminal-priority-control-exact-set-mismatch');
        }
        for (const key of pendingPriorities.keys()) {
            if (!requestedPriorities.has(key)) {
                return failure('terminal-priority-control-exact-set-mismatch');
            }
        }
        const pendingSourceTicks = [
            ...pendingSpawnPrograms.values(),
            ...pendingPriorities.values()
        ].map((program) => Number(program.sourceTick));
        if (pendingSourceTicks.some((sourceTick) => (
            !Number.isSafeInteger(sourceTick)
            || sourceTick <= 0
            || sourceTick >= finalFixedTick
        ))) {
            return failure('terminal-final-fixed-tick-not-after-pending');
        }
        if (!this.#ensureReady() || !this.#hasCurrentGpuResources()) {
            return failure('terminal-fixed-program-gpu-unavailable');
        }

        const destinationSlots = [...this.pendingHandleToSlot.values()]
            .sort((left, right) => left - right);
        const prioritySourceSlots = new Set();
        for (const pending of pendingPriorities.values()) {
            if (Number.isInteger(pending.destinationSlot)
                && pending.destinationSlot >= 0
                && this.slotActive[pending.destinationSlot] === 1) {
                prioritySourceSlots.add(pending.destinationSlot);
            }
        }
        try {
            const renderStyleView = new DataView(this.hostRenderStyles);
            for (const slot of destinationSlots) {
                writeGpuCircleBodySpawn(this.hostStorage, slot, TOMBSTONE_BODY);
                writeGpuEffectBodyStateSpawn(
                    this.hostEffectBodyState,
                    slot,
                    TOMBSTONE_BODY
                );
                writeGpuFormationBodyStateSpawn(
                    this.hostFormationBodyState,
                    slot,
                    TOMBSTONE_BODY
                );
                writeRenderStyle(renderStyleView, slot, TOMBSTONE_BODY);
                clearBodyControlStateSlot(this.hostBodyControlStates, slot);
            }
            for (const slot of prioritySourceSlots) {
                clearBodyControlStateSlot(this.hostBodyControlStates, slot);
            }
            if (destinationSlots.length > 0) {
                this.#uploadSlotRanges(destinationSlots);
            }
            for (const slot of prioritySourceSlots) {
                this.device.queue.writeBuffer(
                    this.buffers.bodyControlStates,
                    slot * BODY_CONTROL_STATE_STRIDE,
                    this.hostBodyControlStates,
                    slot * BODY_CONTROL_STATE_STRIDE,
                    BODY_CONTROL_STATE_STRIDE
                );
            }
            writeGpuBodyControlProgramHeader(this.hostBodyControlProgram, 0);
            writeGpuSpawnProgramHeader(this.hostSpawnProgram, 0);
            this.device.queue.writeBuffer(
                this.buffers.bodyControlProgram,
                0,
                this.hostBodyControlProgram.buffer,
                0,
                GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STRIDE
            );
            this.device.queue.writeBuffer(
                this.buffers.spawnProgram,
                0,
                this.hostSpawnProgram.buffer,
                0,
                GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STRIDE
            );
        } catch {
            return failure('terminal-fixed-program-tombstone-upload');
        }

        for (const [key, slot] of this.pendingHandleToSlot) {
            this.pendingSlotHandles[slot] = null;
            this.slotActive[slot] = 0;
            this.slotHandles[slot] = null;
            this.freeSlots.push(slot);
            void key;
        }
        this.pendingHandleToSlot.clear();
        this.pendingBodyCount = 0;
        while (this.bodyCount > 0 && this.slotActive[this.bodyCount - 1] === 0) {
            this.bodyCount--;
        }
        if (this.freeSlots.length > 0) {
            this.freeSlots = [...new Set(this.freeSlots)]
                .filter((slot) => slot < this.bodyCount)
                .sort((left, right) => left - right);
        }
        writeGpuCircleBodyCounts(this.hostStorage, { bodyCount: this.bodyCount });
        this.#refreshHostBodyDerivedState();
        this.#uploadBodyCountState();
        this.stagedFixedPrograms = null;
        this.#retireTerminalReadbacks();

        const result = Object.freeze({
            abiVersion: GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION,
            finalFixedTick,
            accepted: true,
            state: 'armed',
            reason: null,
            destinationCount: destinationHandles.length,
            priorityControlCount: priorityControls.length,
            pendingBodyCount: this.pendingBodyCount,
            pendingSpawnProgramReadbacks: this.pendingSpawnProgramReadbacks
        });
        this.terminalFixedProgramCancelStatus = result;
        return result;
    }

    getTerminalFixedProgramCancelStatus() {
        return this.terminalFixedProgramCancelStatus;
    }

    /** 완료된 SpawnProgram batch를 순서대로 반환하고 pending slot을 확정/회수합니다. */
    drainCompletedSpawnProgramBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('SpawnProgram 완료 batch 출력은 배열이어야 합니다.');
        }
        while (this.spawnProgramBatchQueue[0]?.completed === true) {
            const entry = this.spawnProgramBatchQueue.shift();
            if (entry.failure) {
                out.push(Object.freeze({
                    sourceTick: entry.sourceTick,
                    submittedTick: entry.submittedTick,
                    sessionGeneration: entry.sessionGeneration,
                    deviceGeneration: entry.deviceGeneration,
                    authoritativeEpoch: entry.authoritativeEpoch,
                    failure: entry.failure,
                    outcomes: Object.freeze([])
                }));
                continue;
            }
            const outcomes = [];
            const cleanupSlots = [];
            let batchFailure = null;
            for (const outcome of entry.outcomes) {
                const handle = outcome.destinationHandle;
                const key = entityHandleKey(handle);
                const slot = this.pendingHandleToSlot.get(key);
                const pendingHandle = Number.isInteger(slot)
                    ? this.pendingSlotHandles[slot]
                    : null;
                if (slot !== outcome.destinationSlot
                    || this.slotActive[slot] !== 2
                    || !pendingHandle
                    || entityHandleKey(pendingHandle) !== key) {
                    this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
                    batchFailure = captureFailure(
                        'spawn-program-outcome',
                        new Error(`pending destination slot contract mismatch: ${key}`)
                    );
                    this.failure = batchFailure;
                    this.state = this.requiresAuthoritativeRebuild
                        ? 'requires-rebuild'
                        : 'failed';
                    break;
                }
                this.pendingHandleToSlot.delete(key);
                this.pendingSlotHandles[slot] = null;
                this.pendingBodyCount--;
                if (outcome.result === GPU_SPAWN_PROGRAM_RESULT.RESOLVED) {
                    const simulationOffset = slot
                        * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
                    const simulationView = new DataView(
                        this.hostStorage.simulationBuffer
                    );
                    const flags = simulationView.getUint32(
                        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
                        LITTLE_ENDIAN
                    );
                    simulationView.setUint32(
                        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
                        flags | GPU_CIRCLE_BODY_META.ALIVE_FLAG,
                        LITTLE_ENDIAN
                    );
                    this.slotActive[slot] = 1;
                    this.slotHandles[slot] = handle;
                    this.handleToSlot.set(key, slot);
                    this.activeBodyCount++;
                    this.lastSpawnProgramResolvedCount++;
                } else {
                    writeGpuCircleBodySpawn(this.hostStorage, slot, TOMBSTONE_BODY);
                    writeGpuEffectBodyStateSpawn(
                        this.hostEffectBodyState,
                        slot,
                        TOMBSTONE_BODY
                    );
                    writeGpuFormationBodyStateSpawn(
                        this.hostFormationBodyState,
                        slot,
                        TOMBSTONE_BODY
                    );
                    writeRenderStyle(
                        new DataView(this.hostRenderStyles),
                        slot,
                        TOMBSTONE_BODY
                    );
                    clearBodyControlStateSlot(this.hostBodyControlStates, slot);
                    this.slotActive[slot] = 0;
                    this.slotHandles[slot] = null;
                    this.freeSlots.push(slot);
                    cleanupSlots.push(slot);
                    this.lastSpawnProgramInvalidCount++;
                    if (outcome.result === GPU_SPAWN_PROGRAM_RESULT.SOURCE_INVALID) {
                        this.lastSpawnProgramSourceInvalidCount++;
                    } else if (outcome.result
                        === GPU_SPAWN_PROGRAM_RESULT.TARGET_INVALID) {
                        this.lastSpawnProgramTargetInvalidCount++;
                    } else if (outcome.result
                        === GPU_SPAWN_PROGRAM_RESULT.NO_TARGET) {
                        this.lastSpawnProgramNoTargetCount++;
                    } else if (outcome.result
                        === GPU_SPAWN_PROGRAM_RESULT.CORE_TARGET_INVALID) {
                        this.lastSpawnProgramCoreInvalidCount++;
                    }
                }
                outcomes.push(Object.freeze({ ...outcome }));
            }
            if (batchFailure) {
                out.push(Object.freeze({
                    sourceTick: entry.sourceTick,
                    submittedTick: entry.submittedTick,
                    sessionGeneration: entry.sessionGeneration,
                    deviceGeneration: entry.deviceGeneration,
                    authoritativeEpoch: entry.authoritativeEpoch,
                    failure: batchFailure,
                    outcomes: Object.freeze([])
                }));
                continue;
            }
            while (this.bodyCount > 0 && this.slotActive[this.bodyCount - 1] === 0) {
                this.bodyCount--;
            }
            if (this.freeSlots.length > 0) {
                this.freeSlots = this.freeSlots.filter((slot) => slot < this.bodyCount);
            }
            writeGpuCircleBodyCounts(this.hostStorage, { bodyCount: this.bodyCount });
            this.#refreshHostBodyDerivedState();
            if (cleanupSlots.length > 0 && this.#hasCurrentGpuResources()) {
                this.#uploadSlotRanges(cleanupSlots);
                this.#uploadBodyCountState();
            }
            if (this.activeBodyCount === 0 && this.pendingBodyCount === 0) {
                this.hasGpuAuthoritativeState = false;
                this.idleReleasePending = true;
            }
            out.push(Object.freeze({
                sourceTick: entry.sourceTick,
                submittedTick: entry.submittedTick,
                sessionGeneration: entry.sessionGeneration,
                deviceGeneration: entry.deviceGeneration,
                authoritativeEpoch: entry.authoritativeEpoch,
                failure: null,
                outcomes: Object.freeze(outcomes)
            }));
        }
        this.#completeDeferredIdleRelease();
        return out;
    }

    /** event facade가 program outcome보다 앞서 같은 tick event를 소비하지 않게 합니다. */
    hasPendingSpawnProgramThroughTick(sourceTick) {
        const tick = requireNonNegativeInteger(sourceTick, 'sourceTick');
        return this.spawnProgramBatchQueue.some((entry) => entry.sourceTick <= tick);
    }

    /** 완료된 priority BodyControl v2 결과 batch를 제출 순서대로 이동합니다. */
    drainCompletedBodyControlProgramBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('BodyControlProgram 완료 batch 출력은 배열이어야 합니다.');
        }
        while (this.bodyControlProgramBatchQueue[0]?.completed === true) {
            const entry = this.bodyControlProgramBatchQueue.shift();
            out.push(Object.freeze({
                sourceTick: entry.sourceTick,
                submittedTick: entry.submittedTick,
                sessionGeneration: entry.sessionGeneration,
                deviceGeneration: entry.deviceGeneration,
                authoritativeEpoch: entry.authoritativeEpoch,
                failure: entry.failure,
                outcomes: entry.outcomes ?? Object.freeze([])
            }));
        }
        this.#completeDeferredIdleRelease();
        return out;
    }

    /** Arrow gameplay이 사용할 exact Tower target을 presentation tracking과 독립 설정합니다. */
    configureTowerGameplayTarget(handle = null) {
        if (handle === null || handle === undefined) {
            this.#invalidateTowerGameplayTarget();
            return Object.freeze({ accepted: true, configured: false });
        }
        const normalized = normalizeEntityHandle(
            handle,
            'towerGameplayTargetHandle'
        );
        const slot = this.handleToSlot.get(entityHandleKey(normalized));
        if (slot === undefined || this.slotActive[slot] !== 1) {
            return Object.freeze({ accepted: false, reason: 'stale-handle' });
        }
        if (this.towerGameplayTargetHandle
            && entityHandleKey(this.towerGameplayTargetHandle)
                === entityHandleKey(normalized)
            && this.towerGameplayTargetSlot === slot) {
            return Object.freeze({
                accepted: true,
                configured: true,
                replay: true
            });
        }
        this.towerGameplayTargetHandle = normalized;
        this.towerGameplayTargetSlot = slot;
        this.#writeTowerGameplayTargetConfig();
        return Object.freeze({ accepted: true, configured: true });
    }

    /** Session당 exact body 하나의 lossy observed-pose tracking을 설정합니다. */
    configureTrackedBody(handle = null) {
        if (handle === null || handle === undefined) {
            this.#invalidateTrackedPose('unconfigured');
            this.#writeTrackedPoseConfig();
            return Object.freeze({ accepted: true, tracked: false });
        }
        const normalized = normalizeEntityHandle(handle, 'trackedPoseHandle');
        const slot = this.handleToSlot.get(entityHandleKey(normalized));
        if (slot === undefined || this.slotActive[slot] !== 1) {
            return Object.freeze({ accepted: false, reason: 'stale-handle' });
        }
        if (this.trackedPoseHandle
            && entityHandleKey(this.trackedPoseHandle) === entityHandleKey(normalized)
            && this.trackedPoseSlot === slot) {
            return Object.freeze({ accepted: true, tracked: true, replay: true });
        }
        this.trackedPoseRevision++;
        this.trackedPoseHandle = normalized;
        this.trackedPoseSlot = slot;
        this.latestTrackedPose = createInvalidTrackedPoseSnapshot('awaiting-sample');
        this.#writeTrackedPoseConfig();
        return Object.freeze({ accepted: true, tracked: true });
    }

    /** GPU authority가 아니라 비동기 observed snapshot을 반환합니다. */
    getLatestTrackedPose() {
        const snapshot = this.latestTrackedPose;
        if (!snapshot.valid) {
            return snapshot;
        }
        return Object.freeze({
            ...snapshot,
            position: Object.freeze({ ...snapshot.position }),
            previousPosition: Object.freeze({ ...snapshot.previousPosition }),
            velocity: Object.freeze({ ...snapshot.velocity }),
            ageTicks: Math.max(0, this.submittedTickCount - snapshot.submittedTick)
        });
    }

    /** Generic facade가 사용하는 observed-pose 명칭입니다. */
    getObservedTrackedPose() {
        return this.getLatestTrackedPose();
    }

    /**
     * contact/event 생성과 6회 위치 solver를 포함한 fixed tick을 GPU에 제출합니다.
     * @param {number} fixedDelta - 초 단위 fixed delta입니다.
     * @param {number} [sourceTick] - 상위 fixed-step source tick입니다.
     * @returns {boolean} command 제출 여부입니다.
     */
    fixedUpdate(fixedDelta, sourceTick) {
        const delta = requirePositiveFinite(fixedDelta, 'fixedDelta');
        const requestedSourceTick = sourceTick === undefined
            ? null
            : requireNonNegativeInteger(sourceTick, 'sourceTick');
        const terminalCancel = this.terminalFixedProgramCancelStatus;
        const terminalEffectCancel = this.terminalEffectProgramCancelStatus;
        const terminalFormationCancel
            = this.terminalFormationProgramCancelStatus;
        const terminalAtomicTransformCancel
            = this.terminalAtomicTransformProgramCancelStatus;
        const terminalProjectileCaptureCancel
            = this.terminalProjectileCaptureProgramCancelStatus;
        const terminalRouteAvailabilityCancel
            = this.terminalRouteAvailabilityProgramCancelStatus;
        const terminalFinalSubmit = terminalCancel?.state === 'armed'
            || terminalEffectCancel?.state === 'armed'
            || terminalFormationCancel?.state === 'armed'
            || terminalAtomicTransformCancel?.state === 'armed'
            || terminalProjectileCaptureCancel?.state === 'armed'
            || terminalRouteAvailabilityCancel?.state === 'armed';
        if (terminalCancel?.state === 'submitted'
            || terminalCancel?.state === 'failed'
            || terminalEffectCancel?.state === 'submitted'
            || terminalEffectCancel?.state === 'failed'
            || terminalFormationCancel?.state === 'submitted'
            || terminalFormationCancel?.state === 'failed'
            || terminalAtomicTransformCancel?.state === 'submitted'
            || terminalAtomicTransformCancel?.state === 'failed'
            || terminalProjectileCaptureCancel?.state === 'submitted'
            || terminalProjectileCaptureCancel?.state === 'failed'
            || terminalRouteAvailabilityCancel?.state === 'submitted'
            || terminalRouteAvailabilityCancel?.state === 'failed') {
            return false;
        }
        if (terminalCancel?.state === 'armed'
            && requestedSourceTick !== terminalCancel.finalFixedTick) {
            this.terminalFixedProgramCancelStatus = Object.freeze({
                ...terminalCancel,
                accepted: false,
                state: 'failed',
                reason: 'terminal-final-fixed-tick-mismatch'
            });
            return false;
        }
        if (terminalEffectCancel?.state === 'armed'
            && requestedSourceTick !== terminalEffectCancel.finalFixedTick) {
            this.terminalEffectProgramCancelStatus = Object.freeze({
                ...terminalEffectCancel,
                state: 'failed',
                failure: 'terminal-final-fixed-tick-mismatch'
            });
            return false;
        }
        if (terminalFormationCancel?.state === 'armed'
            && requestedSourceTick !== terminalFormationCancel.finalFixedTick) {
            this.terminalFormationProgramCancelStatus = Object.freeze({
                ...terminalFormationCancel,
                state: 'failed',
                failure: 'terminal-final-fixed-tick-mismatch'
            });
            return false;
        }
        if (terminalAtomicTransformCancel?.state === 'armed'
            && requestedSourceTick
                !== terminalAtomicTransformCancel.finalFixedTick) {
            this.terminalAtomicTransformProgramCancelStatus = Object.freeze({
                ...terminalAtomicTransformCancel,
                state: 'failed',
                failure: 'terminal-final-fixed-tick-mismatch'
            });
            return false;
        }
        if (terminalProjectileCaptureCancel?.state === 'armed'
            && requestedSourceTick
                !== terminalProjectileCaptureCancel.finalFixedTick) {
            this.terminalProjectileCaptureProgramCancelStatus = Object.freeze({
                ...terminalProjectileCaptureCancel,
                state: 'failed',
                failure: 'terminal-final-fixed-tick-mismatch'
            });
            return false;
        }
        if (terminalRouteAvailabilityCancel?.state === 'armed'
            && requestedSourceTick
                !== terminalRouteAvailabilityCancel.finalFixedTick) {
            this.terminalRouteAvailabilityProgramCancelStatus = Object.freeze({
                ...terminalRouteAvailabilityCancel,
                state: 'failed',
                failure: 'terminal-final-fixed-tick-mismatch'
            });
            return false;
        }
        const stagedPrograms = this.stagedFixedPrograms;
        const stagedEffectBatch = this.stagedEffectPulseBatch;
        const stagedFormationPrepare = this.stagedFormationPrepareBatch;
        const armedFormationTransform = this.armedFormationTransform;
        const stagedAtomicTransformPrepare
            = this.stagedAtomicTransformPrepareBatch;
        const armedAtomicTransform = this.armedAtomicTransform;
        const armedProjectileCaptureRelease
            = this.armedProjectileCaptureRelease;
        const stagedRouteCleanup = this.stagedRouteCleanupBatch;
        if (stagedPrograms
            && requestedSourceTick !== stagedPrograms.targetFixedTick) {
            this.failure = captureFailure(
                'fixed-program-tick',
                new Error(
                    `staged fixed program tick mismatch: staged=${stagedPrograms.targetFixedTick}, submitted=${requestedSourceTick}`
                )
            );
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            this.state = this.requiresAuthoritativeRebuild
                ? 'requires-rebuild'
                : 'failed';
            return false;
        }
        if (stagedEffectBatch
            && requestedSourceTick !== stagedEffectBatch.sourceTick) {
            this.failure = captureFailure(
                'effect-program-tick',
                new Error(
                    `staged Effect tick mismatch: staged=${stagedEffectBatch.sourceTick}, submitted=${requestedSourceTick}`
                )
            );
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            this.state = this.requiresAuthoritativeRebuild
                ? 'requires-rebuild'
                : 'failed';
            return false;
        }
        if (stagedFormationPrepare
            && requestedSourceTick !== stagedFormationPrepare.sourceTick) {
            this.failure = captureFailure(
                'formation-prepare-tick',
                new Error('staged Formation prepare tick mismatch')
            );
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            return false;
        }
        if (armedFormationTransform?.commitRequested
            && requestedSourceTick !== armedFormationTransform.targetFixedTick) {
            this.failure = captureFailure(
                'formation-transform-tick',
                new Error('armed Formation transform tick mismatch')
            );
            this.requiresAuthoritativeRebuild = true;
            return false;
        }
        if (stagedAtomicTransformPrepare
            && requestedSourceTick
                !== stagedAtomicTransformPrepare.sourceTick) {
            this.failure = captureFailure(
                'atomic-transform-prepare-tick',
                new Error('staged AtomicTransform prepare tick mismatch')
            );
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            return false;
        }
        if (armedAtomicTransform?.commitRequested
            && requestedSourceTick !== armedAtomicTransform.targetFixedTick) {
            this.failure = captureFailure(
                'atomic-transform-commit-tick',
                new Error('armed AtomicTransform tick mismatch')
            );
            this.requiresAuthoritativeRebuild = true;
            return false;
        }
        if (armedProjectileCaptureRelease?.commitRequested
            && requestedSourceTick
                !== armedProjectileCaptureRelease.targetFixedTick) {
            this.failure = captureFailure(
                'projectile-capture-release-tick',
                new Error('armed projectile capture release tick mismatch')
            );
            this.requiresAuthoritativeRebuild = true;
            return false;
        }
        if (stagedRouteCleanup
            && requestedSourceTick !== stagedRouteCleanup.targetFixedTick) {
            this.failure = captureFailure(
                'route-cleanup-tick',
                new Error('staged route cleanup tick mismatch')
            );
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            return false;
        }
        this.lastFixedDelta = delta;
        try {
            assertGpuCircleBodyAbiVersion(this.hostStorage);
        } catch (error) {
            this.failure = captureFailure('abi-version', error);
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            this.state = this.requiresAuthoritativeRebuild
                ? 'requires-rebuild'
                : 'failed';
            return false;
        }
        // 마지막 body가 같은 boundary에 despawn되어도 이미 accepted 된 Effect
        // pulse는 GPU에서 SOURCE_INVALID completion을 만들고 readback lease를
        // 끝내야 합니다. 빈 world fast-path가 staged batch를 삼키면 안 됩니다.
        if (this.activeBodyCount === 0
            && !terminalFinalSubmit
            && !stagedEffectBatch
            && !stagedFormationPrepare
            && !armedFormationTransform?.commitRequested
            && !stagedAtomicTransformPrepare
            && !armedAtomicTransform?.commitRequested
            && !armedProjectileCaptureRelease?.commitRequested
            && !stagedRouteCleanup
            && terminalRouteAvailabilityCancel?.state !== 'armed') {
            return false;
        }
        if (this.state === 'telemetry-backpressure') {
            if (!this.#hasFreeOverflowReadbackSlot()) {
                return false;
            }
            this.state = 'ready';
            this.failure = null;
        }
        if (!this.#ensureReady()) {
            return false;
        }

        const stagedSpawnCount = stagedPrograms?.sourceRelativeSpawns.length ?? 0;
        const stagedControlCount = stagedPrograms?.controls.length ?? 0;
        const stagedSelectedSpawnCount = stagedPrograms?.sourceRelativeSpawns.reduce(
            (count, program) => count + Number(
                program.modeFlags
                    === GPU_SPAWN_PROGRAM_MODE
                        .SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET
            ),
            0
        ) ?? 0;
        const stagedLegacySpawnCount = stagedSpawnCount - stagedSelectedSpawnCount;
        const needsRouteRuntimeReadback = this.routeRuntimeTopology.enabled
            && (this.routeRuntimeRosterCount > 0
                || stagedRouteCleanup !== null
                || terminalRouteAvailabilityCancel?.state === 'armed');
        const needsEventReadback = needsRouteRuntimeReadback
            || (!terminalFinalSubmit && (
                this.eventProducingBodyCount > 0
                || stagedSpawnCount > 0
                || stagedControlCount > 0
            ));
        const needsProjectileCaptureReadback
            = this.projectileCaptureDomainBodyCount > 0
                || armedProjectileCaptureRelease?.commitRequested === true
                || terminalProjectileCaptureCancel?.state === 'armed';
        if (this.state === 'event-backpressure') {
            if (needsEventReadback && !this.#hasFreeEventReadbackSlot()) {
                return false;
            }
            this.state = 'ready';
            this.failure = null;
        }
        const eventSlot = needsEventReadback
            ? this.#claimEventReadbackSlot()
            : null;
        if (needsEventReadback && !eventSlot) {
            this.eventBackpressureCount++;
            this.state = 'event-backpressure';
            this.failure = Object.freeze({
                stage: 'event-readback-backpressure',
                name: 'EventBackpressure',
                message: 'GPU contact event staging ring에 빈 slot이 없습니다.'
            });
            return false;
        }
        const projectileCaptureSlot = needsProjectileCaptureReadback
            ? this.#claimProjectileCaptureReadbackSlot()
            : null;
        if (needsProjectileCaptureReadback && !projectileCaptureSlot) {
            this.#releaseClaimedEventReadbackSlot(eventSlot);
            this.state = 'event-backpressure';
            this.failure = Object.freeze({
                stage: 'projectile-capture-readback-backpressure',
                name: 'ProjectileCaptureBackpressure',
                message: 'GPU projectile capture staging ring에 빈 slot이 없습니다.'
            });
            return false;
        }
        const routeRuntimeSlot = needsRouteRuntimeReadback
            ? this.#claimRouteRuntimeReadbackSlot()
            : null;
        if (needsRouteRuntimeReadback && !routeRuntimeSlot) {
            this.#releaseClaimedEventReadbackSlot(eventSlot);
            this.#releaseClaimedProjectileCaptureReadbackSlot(
                projectileCaptureSlot
            );
            this.state = 'event-backpressure';
            this.failure = Object.freeze({
                stage: 'route-runtime-readback-backpressure',
                name: 'RouteRuntimeBackpressure',
                message: 'GPU route availability staging ring에 빈 slot이 없습니다.'
            });
            return false;
        }

        const trackedPoseSlot = !terminalFinalSubmit && this.trackedPoseHandle
            ? this.#claimTrackedPoseReadbackSlot()
            : null;
        if (!terminalFinalSubmit && this.trackedPoseHandle && !trackedPoseSlot) {
            this.trackedPoseDroppedSamples++;
        }

        const tick = this.submittedTickCount + 1;
        const resolvedSourceTick = requestedSourceTick ?? tick;
        const shouldSampleOverflow = !terminalFinalSubmit && (
            this.overflowSampleOverdue
            || tick === 1
            || (tick - this.lastOverflowSampleSubmittedTick)
                >= OVERFLOW_READBACK_INTERVAL_TICKS
        );
        const overflowSlot = shouldSampleOverflow
            ? this.#claimOverflowReadbackSlot()
            : null;
        if (shouldSampleOverflow && !overflowSlot) {
            this.telemetryBackpressureCount++;
            this.overflowSampleOverdue = true;
            if ((tick - this.lastOverflowSampleCompletedTick)
                >= OVERFLOW_TELEMETRY_MAX_AGE_TICKS) {
                this.#releaseClaimedEventReadbackSlot(eventSlot);
                this.#releaseClaimedProjectileCaptureReadbackSlot(
                    projectileCaptureSlot
                );
                this.#releaseClaimedRouteRuntimeReadbackSlot(
                    routeRuntimeSlot
                );
                this.#releaseClaimedTrackedPoseReadbackSlot(trackedPoseSlot);
                this.state = 'telemetry-backpressure';
                this.failure = Object.freeze({
                    stage: 'overflow-readback-backpressure',
                    name: 'TelemetryBackpressure',
                    message: 'GPU grid overflow telemetry가 안전 age 한계를 넘었습니다.'
                });
                return false;
            }
        }

        const device = this.device;
        const generation = this.deviceGeneration;
        const authoritativeEpoch = this.authoritativeEpoch;
        const routeAuthoritativeEpoch = this.routeAuthoritativeEpoch;
        const overflowLease = this.overflowReadbackLease;
        const eventLease = this.eventReadbackLease;
        const projectileCaptureLease = this.projectileCaptureReadbackLease;
        const routeRuntimeLease = this.routeRuntimeReadbackLease;
        const spawnProgramLease = this.spawnProgramReadbackLease;
        const effectProgramLease = this.effectProgramReadbackLease;
        const formationPrepareLease = this.formationPrepareReadbackLease;
        const formationTransformLease = this.formationTransformReadbackLease;
        const atomicTransformPrepareLease
            = this.atomicTransformPrepareReadbackLease;
        const atomicTransformLease = this.atomicTransformReadbackLease;
        const trackedPoseLease = this.trackedPoseReadbackLease;
        let encoder;
        try {
            this.#writeComputeParams(delta, resolvedSourceTick);
            this.#writeProjectileCaptureParams(resolvedSourceTick);
            this.#writeRouteRuntimeParams(
                resolvedSourceTick,
                terminalFinalSubmit
            );
            if (stagedRouteCleanup) {
                this.device.queue.writeBuffer(
                    this.buffers.routeCleanupProgram,
                    0,
                    this.hostRouteCleanupProgram.buffer
                );
            } else {
                writeGpuRouteCleanupProgram(
                    this.hostRouteCleanupProgram,
                    {
                        targetFixedTick: resolvedSourceTick,
                        batchIdFingerprint: 1,
                        records: []
                    }
                );
                this.device.queue.writeBuffer(
                    this.buffers.routeCleanupProgram,
                    0,
                    this.hostRouteCleanupProgram.buffer,
                    0,
                    GPU_ROUTE_RUNTIME_ABI.CLEANUP_HEADER.STRIDE
                );
            }
            if (armedProjectileCaptureRelease?.commitRequested) {
                this.device.queue.writeBuffer(
                    this.buffers.projectileCaptureReleaseProgram,
                    0,
                    this.hostProjectileCaptureReleaseProgram.buffer
                );
            }
            if (stagedPrograms) {
                this.device.queue.writeBuffer(
                    this.buffers.bodyControlProgram,
                    0,
                    this.hostBodyControlProgram.buffer
                );
                this.device.queue.writeBuffer(
                    this.buffers.spawnProgram,
                    0,
                    this.hostSpawnProgram.buffer
                );
            } else {
                writeGpuBodyControlProgramHeader(this.hostBodyControlProgram, 0);
                writeGpuSpawnProgramHeader(this.hostSpawnProgram, 0);
                this.device.queue.writeBuffer(
                    this.buffers.bodyControlProgram,
                    0,
                    this.hostBodyControlProgram.buffer,
                    0,
                    GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STRIDE
                );
                this.device.queue.writeBuffer(
                    this.buffers.spawnProgram,
                    0,
                    this.hostSpawnProgram.buffer,
                    0,
                    GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STRIDE
                );
            }
            if (!terminalFinalSubmit && stagedEffectBatch) {
                this.device.queue.writeBuffer(
                    this.buffers.effectPulseProgram,
                    0,
                    this.hostEffectPulseProgram.buffer
                );
            } else {
                writeGpuEffectPulseProgramHeader(this.hostEffectPulseProgram, 0);
                this.device.queue.writeBuffer(
                    this.buffers.effectPulseProgram,
                    0,
                    this.hostEffectPulseProgram.buffer,
                    0,
                    GPU_EFFECT_RUNTIME_ABI.PROGRAM_HEADER.STRIDE
                );
            }
            if (!terminalFinalSubmit && stagedFormationPrepare) {
                this.device.queue.writeBuffer(
                    this.buffers.formationPrepareProgram,
                    0,
                    this.hostFormationPrepareProgram.buffer
                );
            } else {
                writeGpuFormationPrepareProgramHeader(
                    this.hostFormationPrepareProgram,
                    { count: 0 }
                );
                this.device.queue.writeBuffer(
                    this.buffers.formationPrepareProgram,
                    0,
                    this.hostFormationPrepareProgram.buffer,
                    0,
                    GPU_FORMATION_RUNTIME_ABI.PREPARE_HEADER.STRIDE
                );
            }
            if (!terminalFinalSubmit && armedFormationTransform?.commitRequested) {
                this.device.queue.writeBuffer(
                    this.buffers.formationTransformProgram,
                    0,
                    this.hostFormationTransformProgram.buffer
                );
            } else {
                writeGpuFormationTransformProgramHeader(
                    this.hostFormationTransformProgram,
                    { count: 0 }
                );
                this.device.queue.writeBuffer(
                    this.buffers.formationTransformProgram,
                    0,
                    this.hostFormationTransformProgram.buffer,
                    0,
                    GPU_FORMATION_RUNTIME_ABI.TRANSFORM_HEADER.STRIDE
                );
            }
            if (!terminalFinalSubmit && stagedAtomicTransformPrepare) {
                this.device.queue.writeBuffer(
                    this.buffers.atomicTransformPrepareProgram,
                    0,
                    this.hostAtomicTransformPrepareProgram.buffer
                );
            } else {
                writeGpuAtomicTransformPrepareHeader(
                    this.hostAtomicTransformPrepareProgram,
                    {}
                );
                this.device.queue.writeBuffer(
                    this.buffers.atomicTransformPrepareProgram,
                    0,
                    this.hostAtomicTransformPrepareProgram.buffer,
                    0,
                    GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_HEADER.STRIDE
                );
            }
            if (armedAtomicTransform?.commitRequested) {
                // commitArmed already published registry/host identities. Only the
                // counts/indirect headers and template-owned side planes may be
                // uploaded here; a bulk live-plane upload would overwrite the
                // still-authoritative GPU pose.
                this.#uploadBodyCountState();
                this.device.queue.writeBuffer(
                    this.buffers.atomicTransformProgram,
                    0,
                    this.hostAtomicTransformProgram.buffer
                );
                for (const [bufferKey, source] of [
                    ['atomicTransformTemplatePhysics', this.hostAtomicTransformTemplateStorage.physicsBuffer],
                    ['atomicTransformTemplateSimulation', this.hostAtomicTransformTemplateStorage.simulationBuffer],
                    ['atomicTransformTemplateTemporary', this.hostAtomicTransformTemplateStorage.temporaryBuffer],
                    ['atomicTransformTemplateContactHandlers', this.hostAtomicTransformTemplateStorage.contactHandlerBuffer],
                    ['atomicTransformTemplateCombatStates', this.hostAtomicTransformTemplateStorage.combatStateBuffer],
                    ['atomicTransformTemplateStates', this.hostAtomicTransformTemplateStorage.atomicTransformStateBuffer],
                    ['atomicTransformTemplateEffectSummaries', this.hostAtomicTransformTemplateEffectBodyState.summaryBuffer],
                    ['atomicTransformTemplateEffectEmitters', this.hostAtomicTransformTemplateEffectBodyState.emitterStateBuffer],
                    ['atomicTransformTemplateFormationStates', this.hostAtomicTransformTemplateFormationBodyState],
                    ['atomicTransformTemplateRenderStyles', this.hostAtomicTransformTemplateRenderStyles],
                    ['atomicTransformTemplateEnemyBehaviorStates', this.hostAtomicTransformTemplateStorage.enemyBehaviorStateBuffer],
                    ['atomicTransformTemplateBodyControlStates', this.hostAtomicTransformTemplateBodyControlStates]
                ]) {
                    this.device.queue.writeBuffer(this.buffers[bufferKey], 0, source);
                }
                for (const record of armedAtomicTransform.records) {
                    for (const destinationSlot of record.destinationSlots) {
                        for (const [bufferKey, source, stride] of [
                            [
                                'projectileCaptureStates',
                                this.hostAtomicTransformTemplateStorage
                                    .projectileCaptureStateBuffer,
                                GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE.STRIDE
                            ],
                            [
                                'projectileCaptureCandidates',
                                this.hostAtomicTransformTemplateStorage
                                    .projectileCaptureCandidateBuffer,
                                GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_CANDIDATE
                                    .STRIDE
                            ]
                        ]) {
                            const offset = destinationSlot * stride;
                            this.device.queue.writeBuffer(
                                this.buffers[bufferKey],
                                offset,
                                source,
                                offset,
                                stride
                            );
                        }
                    }
                }
            } else {
                writeGpuAtomicTransformProgramHeader(
                    this.hostAtomicTransformProgram,
                    {}
                );
                this.device.queue.writeBuffer(
                    this.buffers.atomicTransformProgram,
                    0,
                    this.hostAtomicTransformProgram.buffer,
                    0,
                    GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_HEADER.STRIDE
                );
            }
            encoder = device.createCommandEncoder({
                label: 'cirvivor-gpu-circle-fixed-step'
            });
            const pass = encoder.beginComputePass({
                label: 'cirvivor-gpu-circle-collision-contact'
            });

            pass.setPipeline(this.pipelines.updateIndirectArgs);
            pass.setBindGroup(0, this.bindGroups.indirect);
            pass.dispatchWorkgroups(1);

            if (armedProjectileCaptureRelease?.commitRequested) {
                for (const entryPoint of [
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.CLEAR_RELEASES,
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.PREFLIGHT_RELEASES,
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.SEAL_RELEASES,
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.COMMIT_RELEASES,
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.FINALIZE_RELEASES
                ]) {
                    this.#setProjectileCaptureReleaseEntry(pass, entryPoint);
                    const oneWorkgroup = entryPoint
                        === GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.CLEAR_RELEASES
                        || entryPoint
                            === GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.SEAL_RELEASES
                        || entryPoint
                            === GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.FINALIZE_RELEASES;
                    pass.dispatchWorkgroups(oneWorkgroup
                        ? 1
                        : Math.ceil(
                            armedProjectileCaptureRelease.records.length
                                / BODY_WORKGROUP_SIZE
                        ));
                }
            }

            if (armedAtomicTransform?.commitRequested) {
                this.#setAtomicTransformEntry(
                    pass,
                    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.CLEAR_TRANSFORM
                );
                pass.dispatchWorkgroups(1);
                this.#setAtomicTransformEntry(
                    pass,
                    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.PREFLIGHT_TRANSFORM
                );
                pass.dispatchWorkgroups(Math.ceil(
                    armedAtomicTransform.records.length / BODY_WORKGROUP_SIZE
                ));
                this.#setAtomicTransformEntry(
                    pass,
                    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT
                        .PREFLIGHT_EFFECT_REKEYS
                );
                pass.dispatchWorkgroups(1);
                this.#setAtomicTransformEntry(
                    pass,
                    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.SEAL_TRANSFORM
                );
                pass.dispatchWorkgroups(1);
                this.#setAtomicTransformEntry(
                    pass,
                    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.REKEY_EFFECTS
                );
                pass.dispatchWorkgroups(1);
                for (const entryPoint of [
                    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.COMMIT_BODIES,
                    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.COMMIT_STATE,
                    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.COMMIT_AUXILIARY,
                    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.COMMIT_CONTROL,
                    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.COMMIT_ROUTE_STATE
                ]) {
                    this.#setAtomicTransformEntry(pass, entryPoint);
                    pass.dispatchWorkgroups(Math.ceil(
                        armedAtomicTransform.records.length
                            / BODY_WORKGROUP_SIZE
                    ));
                }
                this.#setAtomicTransformEntry(
                    pass,
                    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.FINALIZE_TRANSFORM
                );
                pass.dispatchWorkgroups(1);
            }

            // Authenticated N prepare는 N+1 submit 시작에서 Effect retain보다
            // 먼저 exact rekey/body transform으로 원자 commit됩니다.
            if (!terminalFinalSubmit
                && armedFormationTransform?.commitRequested) {
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.CLEAR_CANDIDATES
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.RESET_TRANSFORM
                );
                pass.dispatchWorkgroups(1);
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.PREFLIGHT_TRANSFORMS
                );
                pass.dispatchWorkgroups(Math.ceil(
                    armedFormationTransform.records.length / BODY_WORKGROUP_SIZE
                ));
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.PREFLIGHT_ROUTE_REKEYS
                );
                pass.dispatchWorkgroups(Math.ceil(
                    armedFormationTransform.records.length / BODY_WORKGROUP_SIZE
                ));
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.PREFLIGHT_EFFECT_REKEYS
                );
                pass.dispatchWorkgroups(Math.ceil(
                    this.effectInstanceCapacity / BODY_WORKGROUP_SIZE
                ));
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.SEAL_TRANSFORM
                );
                pass.dispatchWorkgroups(1);
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.REKEY_EFFECTS
                );
                pass.dispatchWorkgroups(Math.ceil(
                    this.effectInstanceCapacity / BODY_WORKGROUP_SIZE
                ));
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.COMMIT_ROUTE_STATE
                );
                pass.dispatchWorkgroups(Math.ceil(
                    armedFormationTransform.records.length / BODY_WORKGROUP_SIZE
                ));
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.COMMIT_BODIES
                );
                pass.dispatchWorkgroups(Math.ceil(
                    armedFormationTransform.records.length / BODY_WORKGROUP_SIZE
                ));
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.COMMIT_AUXILIARY
                );
                pass.dispatchWorkgroups(Math.ceil(
                    armedFormationTransform.records.length / BODY_WORKGROUP_SIZE
                ));
            }

            // 모든 independent capability는 movement 전 exact tick-start grid를 공유합니다.
            this.#setComputeProfile(pass, COMPUTE_PIPELINE_PROFILE.PHYSICS);
            pass.setPipeline(this.pipelines.compute.clear_grid);
            pass.dispatchWorkgroups(Math.ceil(
                (this.gridCellTotal * GRID_BUCKET_COUNT) / BODY_WORKGROUP_SIZE
            ));
            this.#dispatchBodies(pass, 'build_tick_start_grid');

            if (!terminalFinalSubmit) {
                this.#setEffectEntry(
                    pass,
                    GPU_EFFECT_RUNTIME_ENTRY_POINT.RESET_TICK
                );
                pass.dispatchWorkgroups(1);
                this.#setEffectEntry(
                    pass,
                    GPU_EFFECT_RUNTIME_ENTRY_POINT.CLEAR_SUMMARIES
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
                this.#setEffectEntry(
                    pass,
                    GPU_EFFECT_RUNTIME_ENTRY_POINT.RETAIN_INSTANCES
                );
                pass.dispatchWorkgroups(Math.ceil(
                    this.effectInstanceCapacity / BODY_WORKGROUP_SIZE
                ));
                this.#setEffectEntry(
                    pass,
                    GPU_EFFECT_RUNTIME_ENTRY_POINT.SCAN_PULSES
                );
                pass.dispatchWorkgroups(1);
                this.#setEffectEntry(
                    pass,
                    GPU_EFFECT_RUNTIME_ENTRY_POINT.MATERIALIZE_BATCH
                );
                pass.dispatchWorkgroups(1);
                this.#setEffectEntry(
                    pass,
                    GPU_EFFECT_RUNTIME_ENTRY_POINT.FINISH_TICK
                );
                pass.dispatchWorkgroups(1);
                this.#setEffectEntry(
                    pass,
                    GPU_EFFECT_RUNTIME_ENTRY_POINT.ACCUMULATE_SUMMARIES
                );
                pass.dispatchWorkgroups(Math.ceil(
                    this.effectInstanceCapacity / BODY_WORKGROUP_SIZE
                ));
                this.#setEffectEntry(
                    pass,
                    GPU_EFFECT_RUNTIME_ENTRY_POINT.FINALIZE_SUMMARIES
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
                this.#setEffectEntry(
                    pass,
                    GPU_EFFECT_RUNTIME_ENTRY_POINT.APPLY_REGENERATION
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
            }

            if (stagedLegacySpawnCount > 0) {
                this.#setComputeProfile(pass, COMPUTE_PIPELINE_PROFILE.SOURCE_RESOLVE);
                pass.setPipeline(
                    this.pipelines.compute.validate_source_relative_spawns
                );
                pass.dispatchWorkgroups(Math.ceil(
                    stagedSpawnCount / BODY_WORKGROUP_SIZE
                ));
                pass.setPipeline(
                    this.pipelines.compute.resolve_source_relative_spawns
                );
                pass.dispatchWorkgroups(Math.ceil(
                    stagedSpawnCount / BODY_WORKGROUP_SIZE
                ));
            }
            this.#setComputeProfile(pass, COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL);
            this.#dispatchBodies(pass, 'clear_body_control_states');
            if (stagedControlCount > 0) {
                pass.setPipeline(this.pipelines.compute.validate_body_control_commands);
                pass.dispatchWorkgroups(Math.ceil(
                    stagedControlCount / BODY_WORKGROUP_SIZE
                ));
                pass.setPipeline(this.pipelines.compute.apply_body_control_commands);
                pass.dispatchWorkgroups(Math.ceil(
                    stagedControlCount / BODY_WORKGROUP_SIZE
                ));
            }
            if (stagedSelectedSpawnCount > 0) {
                this.#setComputeProfile(pass, COMPUTE_PIPELINE_PROFILE.SOURCE_RESOLVE);
                pass.setPipeline(
                    this.pipelines.compute.validate_selected_target_spawns
                );
                pass.dispatchWorkgroups(Math.ceil(
                    stagedSpawnCount / BODY_WORKGROUP_SIZE
                ));
                pass.setPipeline(
                    this.pipelines.compute.resolve_selected_target_spawns
                );
                pass.dispatchWorkgroups(Math.ceil(
                    stagedSpawnCount / BODY_WORKGROUP_SIZE
                ));
            }
            if (!terminalFinalSubmit) {
                this.#setEffectEntry(
                    pass,
                    GPU_EFFECT_RUNTIME_ENTRY_POINT.MATERIALIZE_CONTACT_DAMAGE
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
            }
            this.#setComputeProfile(pass, COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL);
            this.#dispatchBodies(pass, 'apply_controlled_motion');
            if (!terminalFinalSubmit) {
                this.#setComputeProfile(
                    pass,
                    COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR
                );
                this.#dispatchBodies(pass, 'advance_octagon_orbit');
                this.#dispatchBodies(pass, 'advance_enemy_charge');
            }
            if (this.routeRuntimeTopology.enabled) {
                pass.setPipeline(this.pipelines.routeRuntime.advance);
                pass.setBindGroup(0, this.bindGroups.routeRuntime);
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
            }
            this.#setComputeProfile(pass, COMPUTE_PIPELINE_PROFILE.PHYSICS);
            this.#dispatchBodies(pass, 'prepare_bodies');
            if (!terminalFinalSubmit) {
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.CLEAR_CANDIDATES
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.SEED_MOTION
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.SELECT_MOTION
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.ADVANCE_MOTION
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
                this.#setEffectEntry(
                    pass,
                    GPU_EFFECT_RUNTIME_ENTRY_POINT.ADVANCE_PENTA_NAVIGATION
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
            }
            if (this.routeRuntimeTopology.enabled) {
                // Route WAIT is enforced only after Formation/Penta had a chance
                // to claim this tick's external motion ownership.
                pass.setPipeline(this.pipelines.routeRuntime.enforceWait);
                pass.setBindGroup(0, this.bindGroups.routeRuntimeWait);
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
            }
            if (needsProjectileCaptureReadback) {
                this.#setProjectileCaptureEntry(
                    pass,
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.CLEAR_TICK
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
                this.#setProjectileCaptureEntry(
                    pass,
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.VALIDATE_HELD
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
                this.#setProjectileCaptureEntry(
                    pass,
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.UPDATE_FACING
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
            }
            this.#setComputeProfile(pass, COMPUTE_PIPELINE_PROFILE.PHYSICS);
            pass.setPipeline(this.pipelines.compute.clear_grid);
            pass.dispatchWorkgroups(Math.ceil(
                (this.gridCellTotal * GRID_BUCKET_COUNT) / BODY_WORKGROUP_SIZE
            ));
            this.#dispatchBodies(pass, 'build_grid');

            this.#setComputeProfile(pass, COMPUTE_PIPELINE_PROFILE.CONTACT_HANDLING);
            pass.setPipeline(this.pipelines.compute.clear_contact_state);
            pass.dispatchWorkgroups(1);
            if (!terminalFinalSubmit) {
                this.#setComputeProfile(
                    pass,
                    COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR
                );
                this.#dispatchBodies(pass, 'emit_enemy_charge_telegraphs');
                this.#setComputeProfile(
                    pass,
                    COMPUTE_PIPELINE_PROFILE.BODY_CONTACTS
                );
                this.#dispatchBodies(pass, 'generate_body_contacts');
                this.#setComputeProfile(
                    pass,
                    COMPUTE_PIPELINE_PROFILE.WORLD_CONTACTS
                );
                this.#dispatchBodies(pass, 'generate_world_contacts');
                if (needsProjectileCaptureReadback) {
                    for (const entryPoint of [
                        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT
                            .SELECT_PROJECTILE_DISTANCES,
                        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.SELECT_CAPTORS,
                        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT
                            .SELECT_RING_DISTANCES,
                        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.SELECT_PROJECTILES,
                        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.PREFLIGHT_CAPTURE
                    ]) {
                        this.#setProjectileCaptureEntry(pass, entryPoint);
                        pass.dispatchWorkgroups(Math.ceil(
                            this.contactCapacity / BODY_WORKGROUP_SIZE
                        ));
                    }
                    this.#setProjectileCaptureEntry(
                        pass,
                        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.SEAL_CAPTURE
                    );
                    pass.dispatchWorkgroups(1);
                    this.#setProjectileCaptureEntry(
                        pass,
                        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.COMMIT_CAPTURE
                    );
                    pass.dispatchWorkgroups(Math.ceil(
                        this.contactCapacity / BODY_WORKGROUP_SIZE
                    ));
                    this.#setProjectileCaptureEntry(
                        pass,
                        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.FINALIZE_CAPTURE
                    );
                    pass.dispatchWorkgroups(1);
                    this.#setProjectileCaptureEntry(
                        pass,
                        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.MARK_CORE_IMPACTS
                    );
                    pass.dispatchWorkgroups(Math.ceil(
                        this.contactCapacity / BODY_WORKGROUP_SIZE
                    ));
                }
                this.#setComputeProfile(
                    pass,
                    COMPUTE_PIPELINE_PROFILE.DIRECTIONAL_DEFENSE_CLASSIFIER
                );
                pass.setPipeline(
                    this.pipelines.compute.classify_directional_defense_contacts
                );
                pass.dispatchWorkgroups(Math.ceil(
                    this.contactCapacity / BODY_WORKGROUP_SIZE
                ));
                if (this.atomicTransformFirstHitBodyCount > 0) {
                    this.#setComputeProfile(
                        pass,
                        COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT
                    );
                    this.#dispatchBodies(
                        pass,
                        'clear_atomic_transform_first_hit_candidates'
                    );
                    pass.setPipeline(
                        this.pipelines.compute.select_atomic_transform_first_hit_source
                    );
                    pass.dispatchWorkgroups(Math.ceil(
                        this.contactCapacity / BODY_WORKGROUP_SIZE
                    ));
                    pass.setPipeline(
                        this.pipelines.compute.resolve_atomic_transform_first_hit_contact
                    );
                    pass.dispatchWorkgroups(Math.ceil(
                        this.contactCapacity / BODY_WORKGROUP_SIZE
                    ));
                    pass.setPipeline(
                        this.pipelines.compute.seal_atomic_transform_first_hits
                    );
                    pass.dispatchWorkgroups(1);
                    this.#dispatchBodies(
                        pass,
                        'commit_atomic_transform_first_hits'
                    );
                    pass.setPipeline(
                        this.pipelines.compute.finalize_atomic_transform_first_hits
                    );
                    pass.dispatchWorkgroups(1);
                    pass.setPipeline(
                        this.pipelines.compute.shield_atomic_transform_first_hit_contacts
                    );
                    pass.dispatchWorkgroups(Math.ceil(
                        this.contactCapacity / BODY_WORKGROUP_SIZE
                    ));
                }
                this.#setComputeProfile(
                    pass,
                    COMPUTE_PIPELINE_PROFILE.CONTACT_HANDLING
                );
                pass.setPipeline(this.pipelines.compute.handle_contacts);
                pass.dispatchWorkgroups(Math.ceil(
                    this.contactCapacity / BODY_WORKGROUP_SIZE
                ));
                this.#setComputeProfile(
                    pass,
                    COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR
                );
                pass.setPipeline(
                    this.pipelines.compute.resolve_enemy_charge_contacts
                );
                pass.dispatchWorkgroups(Math.ceil(
                    this.contactCapacity / BODY_WORKGROUP_SIZE
                ));
                this.#setComputeProfile(
                    pass,
                    COMPUTE_PIPELINE_PROFILE.CORE_DAMAGE_REQUEST
                );
                pass.setPipeline(
                    this.pipelines.compute.preflight_core_damage_requests
                );
                pass.dispatchWorkgroups(Math.ceil(
                    this.contactCapacity / BODY_WORKGROUP_SIZE
                ));
                this.#setComputeProfile(
                    pass,
                    COMPUTE_PIPELINE_PROFILE.MAXIMUM_DAMAGE_WINDOW
                );
                this.#dispatchBodies(pass, 'preflight_maximum_damage_window');
                this.#setComputeProfile(
                    pass,
                    COMPUTE_PIPELINE_PROFILE.CORE_DAMAGE_REQUEST
                );
                pass.setPipeline(
                    this.pipelines.compute.finalize_core_damage_request_preflight
                );
                pass.dispatchWorkgroups(1);
                this.#setComputeProfile(
                    pass,
                    COMPUTE_PIPELINE_PROFILE.MAXIMUM_DAMAGE_WINDOW
                );
                pass.setPipeline(
                    this.pipelines.compute.finalize_maximum_damage_window_preflight
                );
                pass.dispatchWorkgroups(1);
                this.#setComputeProfile(
                    pass,
                    COMPUTE_PIPELINE_PROFILE.CORE_DAMAGE_REQUEST
                );
                pass.setPipeline(
                    this.pipelines.compute.resolve_core_damage_requests
                );
                pass.dispatchWorkgroups(Math.ceil(
                    this.contactCapacity / BODY_WORKGROUP_SIZE
                ));
                this.#setComputeProfile(
                    pass,
                    COMPUTE_PIPELINE_PROFILE.MAXIMUM_DAMAGE_WINDOW
                );
                this.#dispatchBodies(pass, 'resolve_maximum_damage_window');
                this.#setComputeProfile(
                    pass,
                    COMPUTE_PIPELINE_PROFILE.CONTACT_HANDLING
                );
                this.#dispatchBodies(pass, 'mark_dead');
            }
            if (this.routeRuntimeTopology.enabled) {
                pass.setPipeline(this.pipelines.routeRuntime.finalize);
                pass.setBindGroup(0, this.bindGroups.routeRuntime);
                pass.dispatchWorkgroups(1);
            }

            this.#setComputeProfile(pass, COMPUTE_PIPELINE_PROFILE.PHYSICS);
            for (let iteration = 0; iteration < this.solverIterations; iteration++) {
                this.#dispatchBodies(pass, 'clear_position_deltas');
                pass.setPipeline(this.pipelines.compute.solve_body_body);
                pass.dispatchWorkgroups(this.gridCellTotal);
                this.#dispatchBodies(pass, 'solve_body_world');
                this.#dispatchBodies(pass, 'apply_position_deltas');
            }
            this.#dispatchBodies(pass, 'rebuild_velocities');
            this.#dispatchBodies(pass, 'finalize_velocities');
            this.#setComputeProfile(pass, COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL);
            this.#dispatchBodies(pass, 'finalize_controlled_motion');
            if (!terminalFinalSubmit) {
                this.#setComputeProfile(
                    pass,
                    COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR
                );
                this.#dispatchBodies(pass, 'apply_enemy_charge_recoil');
            }
            if (needsProjectileCaptureReadback) {
                this.#setProjectileCaptureEntry(
                    pass,
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.ATTACH_HELD
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
                this.#setProjectileCaptureEntry(
                    pass,
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT
                        .CLEAR_RELEASE_PREPARATIONS
                );
                pass.dispatchWorkgroups(1);
                if (!terminalFinalSubmit) {
                    this.#setProjectileCaptureEntry(
                        pass,
                        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT
                            .PREFLIGHT_RELEASE_PREPARATIONS
                    );
                    pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
                }
                this.#setProjectileCaptureEntry(
                    pass,
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT
                        .SEAL_RELEASE_PREPARATIONS
                );
                pass.dispatchWorkgroups(1);
                if (!terminalFinalSubmit) {
                    this.#setProjectileCaptureEntry(
                        pass,
                        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT
                            .COMMIT_RELEASE_PREPARATIONS
                    );
                    pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
                }
                this.#setProjectileCaptureEntry(
                    pass,
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT
                        .FINALIZE_RELEASE_PREPARATIONS
                );
                pass.dispatchWorkgroups(1);
            }
            if (!terminalFinalSubmit && stagedFormationPrepare) {
                this.#setComputeProfile(pass, COMPUTE_PIPELINE_PROFILE.PHYSICS);
                pass.setPipeline(this.pipelines.compute.clear_grid);
                pass.dispatchWorkgroups(Math.ceil(
                    (this.gridCellTotal * GRID_BUCKET_COUNT)
                        / BODY_WORKGROUP_SIZE
                ));
                this.#dispatchBodies(pass, 'build_tick_start_grid');
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.CLEAR_CANDIDATES
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.SEED_PREPARE
                );
                pass.dispatchWorkgroups(1);
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.SELECT_PREPARE
                );
                pass.dispatchWorkgroups(Math.ceil(
                    stagedFormationPrepare.records.length / BODY_WORKGROUP_SIZE
                ));
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.FINALIZE_PREPARE
                );
                pass.dispatchWorkgroups(Math.ceil(
                    stagedFormationPrepare.records.length / BODY_WORKGROUP_SIZE
                ));
                this.#setFormationEntry(
                    pass,
                    GPU_FORMATION_RUNTIME_ENTRY_POINT.SEAL_PREPARE
                );
                pass.dispatchWorkgroups(1);
            }
            // T submit의 모든 damage/death/transform mutation 뒤 live GPU state를
            // scan하여 T+1 publication proof를 만듭니다. Host candidate 목록은
            // fingerprint seed일 뿐 eligibility authority가 아닙니다.
            if (!terminalFinalSubmit && stagedAtomicTransformPrepare) {
                this.#setAtomicTransformEntry(
                    pass,
                    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.CLEAR_PREPARE
                );
                pass.dispatchWorkgroups(1);
                this.#setAtomicTransformEntry(
                    pass,
                    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.PREPARE
                );
                pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
            }
            if (trackedPoseSlot) {
                this.#setComputeProfile(pass, COMPUTE_PIPELINE_PROFILE.TRACKED_POSE);
                pass.setPipeline(this.pipelines.compute.pack_tracked_pose);
                pass.dispatchWorkgroups(1);
            }
            pass.end();

            if (overflowSlot) {
                encoder.copyBufferToBuffer(
                    this.buffers.gridOverflow,
                    0,
                    overflowSlot.buffer,
                    0,
                    GRID_OVERFLOW_BYTE_SIZE
                );
            }
            if (!terminalFinalSubmit && stagedAtomicTransformPrepare) {
                encoder.copyBufferToBuffer(
                    this.buffers.atomicTransformPrepareProgram,
                    0,
                    stagedAtomicTransformPrepare.readbackSlot.buffer,
                    0,
                    this.hostAtomicTransformPrepareProgram.buffer.byteLength
                );
            }
            if (armedAtomicTransform?.commitRequested) {
                encoder.copyBufferToBuffer(
                    this.buffers.atomicTransformProgram,
                    0,
                    armedAtomicTransform.readbackSlot.buffer,
                    0,
                    this.hostAtomicTransformProgram.buffer.byteLength
                );
            }
            if (projectileCaptureSlot) {
                const releaseOffset = this.hostProjectileCaptureTick.buffer.byteLength;
                encoder.copyBufferToBuffer(
                    this.buffers.projectileCaptureRuntime,
                    0,
                    projectileCaptureSlot.buffer,
                    0,
                    this.hostProjectileCaptureTick.buffer.byteLength
                );
                encoder.copyBufferToBuffer(
                    this.buffers.projectileCaptureReleaseProgram,
                    0,
                    projectileCaptureSlot.buffer,
                    releaseOffset,
                    this.hostProjectileCaptureReleaseProgram.buffer.byteLength
                );
            }
            if (routeRuntimeSlot) {
                encoder.copyBufferToBuffer(
                    this.buffers.routeAvailability,
                    0,
                    routeRuntimeSlot.buffer,
                    0,
                    this.hostRouteAvailability.byteLength
                );
            }
            if (eventSlot) {
                const deathOffset = EVENT_READBACK_HEADER_BYTE_SIZE
                    + (this.eventCapacity * APPLIED_EVENT_BYTE_SIZE);
                encoder.copyBufferToBuffer(
                    this.buffers.contactState,
                    0,
                    eventSlot.buffer,
                    0,
                    CONTACT_STATE_BYTE_SIZE
                );
                encoder.copyBufferToBuffer(
                    this.buffers.appliedEvents,
                    0,
                    eventSlot.buffer,
                    EVENT_READBACK_HEADER_BYTE_SIZE,
                    this.eventCapacity * APPLIED_EVENT_BYTE_SIZE
                );
                encoder.copyBufferToBuffer(
                    this.buffers.deathEvents,
                    0,
                    eventSlot.buffer,
                    deathOffset,
                    this.deathEventCapacity * DEATH_EVENT_BYTE_SIZE
                );
                if (stagedControlCount > 0) {
                    const controlProgramOffset
                        = eventReadbackControlProgramOffset(
                            this.eventCapacity,
                            this.deathEventCapacity
                        );
                    encoder.copyBufferToBuffer(
                        this.buffers.bodyControlProgram,
                        0,
                        eventSlot.buffer,
                        controlProgramOffset,
                        this.hostBodyControlProgram.buffer.byteLength
                    );
                }
            }
            if (stagedSpawnCount > 0) {
                encoder.copyBufferToBuffer(
                    this.buffers.spawnProgram,
                    0,
                    stagedPrograms.readbackSlot.buffer,
                    0,
                    this.hostSpawnProgram.buffer.byteLength
                );
            }
            if (!terminalFinalSubmit && stagedEffectBatch) {
                encoder.copyBufferToBuffer(
                    this.buffers.effectPoolState,
                    0,
                    stagedEffectBatch.readbackSlot.buffer,
                    EFFECT_READBACK_POOL_STATE_OFFSET,
                    GPU_EFFECT_RUNTIME_ABI.POOL_STATE.STRIDE
                );
                encoder.copyBufferToBuffer(
                    this.buffers.effectPulseProgram,
                    0,
                    stagedEffectBatch.readbackSlot.buffer,
                    EFFECT_READBACK_PROGRAM_OFFSET,
                    this.hostEffectPulseProgram.buffer.byteLength
                );
                encoder.copyBufferToBuffer(
                    this.buffers.effectEvents,
                    0,
                    stagedEffectBatch.readbackSlot.buffer,
                    effectReadbackEventOffset(this.effectPulseProgramCapacity),
                    this.effectEventCapacity * GPU_EFFECT_RUNTIME_ABI.EVENT.STRIDE
                );
            }
            // Formation result copies are ordered after their compute passes on
            // the same encoder, so readback can never observe the staged input.
            if (!terminalFinalSubmit && stagedFormationPrepare) {
                encoder.copyBufferToBuffer(
                    this.buffers.formationPrepareProgram,
                    0,
                    stagedFormationPrepare.readbackSlot.buffer,
                    0,
                    this.hostFormationPrepareProgram.buffer.byteLength
                );
            }
            if (!terminalFinalSubmit
                && armedFormationTransform?.commitRequested) {
                encoder.copyBufferToBuffer(
                    this.buffers.formationTransformProgram,
                    0,
                    armedFormationTransform.readbackSlot.buffer,
                    0,
                    this.hostFormationTransformProgram.buffer.byteLength
                );
            }
            if (trackedPoseSlot) {
                encoder.copyBufferToBuffer(
                    this.buffers.trackedPoseOutput,
                    0,
                    trackedPoseSlot.buffer,
                    0,
                    TRACKED_POSE_RECORD_BYTE_SIZE
                );
            }
            device.queue.submit([encoder.finish()]);
        } catch (error) {
            this.#releaseClaimedOverflowReadbackSlot(overflowSlot);
            this.#releaseClaimedEventReadbackSlot(eventSlot);
            this.#releaseClaimedProjectileCaptureReadbackSlot(
                projectileCaptureSlot
            );
            this.#releaseClaimedRouteRuntimeReadbackSlot(routeRuntimeSlot);
            this.#releaseClaimedTrackedPoseReadbackSlot(trackedPoseSlot);
            this.#releaseClaimedSpawnProgramReadbackSlot(
                stagedPrograms?.readbackSlot ?? null
            );
            this.#releaseClaimedEffectProgramReadbackSlot(
                stagedEffectBatch?.readbackSlot ?? null
            );
            this.#releaseClaimedFormationPrepareReadbackSlot(
                stagedFormationPrepare?.readbackSlot ?? null
            );
            if (armedFormationTransform?.commitRequested) {
                this.#releaseClaimedFormationTransformReadbackSlot(
                    armedFormationTransform.readbackSlot
                );
            }
            this.#releaseClaimedAtomicTransformPrepareReadbackSlot(
                stagedAtomicTransformPrepare?.readbackSlot ?? null
            );
            if (armedAtomicTransform?.commitRequested) {
                this.#releaseClaimedAtomicTransformReadbackSlot(
                    armedAtomicTransform.readbackSlot
                );
            }
            this.failure = captureFailure('fixed-submit', error);
            if (terminalCancel?.state === 'armed') {
                this.terminalFixedProgramCancelStatus = Object.freeze({
                    ...terminalCancel,
                    accepted: false,
                    state: 'failed',
                    reason: 'terminal-final-fixed-submit-failed'
                });
            }
            if (terminalEffectCancel?.state === 'armed') {
                this.terminalEffectProgramCancelStatus = Object.freeze({
                    ...terminalEffectCancel,
                    state: 'failed',
                    failure: 'terminal-final-fixed-submit-failed'
                });
            }
            if (terminalFormationCancel?.state === 'armed') {
                this.terminalFormationProgramCancelStatus = Object.freeze({
                    ...terminalFormationCancel,
                    state: 'failed',
                    failure: 'terminal-final-fixed-submit-failed'
                });
            }
            if (terminalAtomicTransformCancel?.state === 'armed') {
                this.terminalAtomicTransformProgramCancelStatus = Object.freeze({
                    ...terminalAtomicTransformCancel,
                    state: 'failed',
                    failure: 'terminal-final-fixed-submit-failed'
                });
            }
            if (terminalProjectileCaptureCancel?.state === 'armed') {
                this.terminalProjectileCaptureProgramCancelStatus
                    = Object.freeze({
                        ...terminalProjectileCaptureCancel,
                        state: 'failed',
                        failure: 'terminal-final-fixed-submit-failed'
                    });
            }
            if (terminalRouteAvailabilityCancel?.state === 'armed') {
                this.terminalRouteAvailabilityProgramCancelStatus
                    = Object.freeze({
                        ...terminalRouteAvailabilityCancel,
                        state: 'failed',
                        accepted: false,
                        failure: 'terminal-final-fixed-submit-failed'
                    });
            }
            this.requiresAuthoritativeRebuild = this.hasGpuAuthoritativeState
                && this.activeBodyCount > 0;
            if (this.requiresAuthoritativeRebuild) {
                this.presentationClock.synchronize();
                this.state = 'requires-rebuild';
                this.#releaseGpuResources();
            } else {
                this.state = 'failed';
            }
            return false;
        }

        this.submittedTickCount = tick;
        this.lastSubmittedSourceTick = resolvedSourceTick;
        this.hasGpuAuthoritativeState = true;
        this.presentationClock.advancePhysics(delta);
        if (overflowSlot) {
            this.lastOverflowSampleSubmittedTick = tick;
            this.overflowSampleOverdue = false;
            this.#beginOverflowReadback(
                overflowSlot,
                tick,
                generation,
                overflowLease,
                authoritativeEpoch
            );
        }
        if (projectileCaptureSlot) {
            const captureQueueEntry = {
                sessionGeneration: this.sessionGeneration,
                sourceTick: resolvedSourceTick,
                submittedTick: tick,
                deviceGeneration: generation,
                authoritativeEpoch,
                completed: false,
                completion: null,
                failure: null
            };
            const releaseQueueEntry = armedProjectileCaptureRelease
                ?.commitRequested === true
                ? {
                    sessionGeneration: this.sessionGeneration,
                    sourceTick: resolvedSourceTick,
                    submittedTick: tick,
                    deviceGeneration: generation,
                    authoritativeEpoch,
                    batchIdFingerprint:
                        armedProjectileCaptureRelease.batchIdFingerprint,
                    records: armedProjectileCaptureRelease.records,
                    completed: false,
                    completion: null,
                    failure: null
                }
                : null;
            this.projectileCaptureBatchQueue.push(captureQueueEntry);
            if (releaseQueueEntry) {
                this.projectileCaptureReleaseBatchQueue.push(releaseQueueEntry);
            }
            this.lastProjectileCaptureSourceTick = resolvedSourceTick;
            this.#beginProjectileCaptureReadback(
                projectileCaptureSlot,
                captureQueueEntry,
                releaseQueueEntry,
                projectileCaptureLease
            );
        }
        if (routeRuntimeSlot) {
            const routeQueueEntry = {
                sessionGeneration: this.sessionGeneration,
                sourceTick: resolvedSourceTick,
                submittedTick: tick,
                deviceGeneration: generation,
                authoritativeEpoch: routeAuthoritativeEpoch,
                expectedGraphContentFingerprint:
                    this.routeRuntimeTopology.contentFingerprint,
                expectedTerminalFinalSubmit: terminalFinalSubmit,
                completed: false,
                completion: null,
                failure: null
            };
            this.routeRuntimeBatchQueue.push(routeQueueEntry);
            this.lastRouteRuntimeSourceTick = resolvedSourceTick;
            this.#beginRouteRuntimeReadback(
                routeRuntimeSlot,
                routeQueueEntry,
                routeRuntimeLease
            );
        }
        if (eventSlot) {
            const queueEntry = {
                sessionGeneration: this.sessionGeneration,
                previousSourceTick: this.lastEventReadbackSourceTick,
                previousSubmittedTick: this.lastEventReadbackSubmittedTick,
                sourceTick: resolvedSourceTick,
                submittedTick: tick,
                deviceGeneration: generation,
                authoritativeEpoch,
                expectedControlCount: stagedControlCount,
                expectedControls: stagedPrograms?.controls ?? Object.freeze([]),
                completed: false,
                events: null
            };
            this.eventBatchQueue.push(queueEntry);
            const priorityControls = (stagedPrograms?.controls ?? []).filter(
                (control) => control.modeFlags
                    === GPU_BODY_CONTROL_PROGRAM_MODE.PRIORITY_TARGET_IN_RANGE
            );
            if (priorityControls.length > 0) {
                const controlQueueEntry = {
                    sourceTick: resolvedSourceTick,
                    submittedTick: tick,
                    sessionGeneration: this.sessionGeneration,
                    deviceGeneration: generation,
                    authoritativeEpoch,
                    programs: Object.freeze(priorityControls),
                    completed: false,
                    outcomes: null,
                    failure: null
                };
                queueEntry.controlQueueEntry = controlQueueEntry;
                this.bodyControlProgramBatchQueue.push(controlQueueEntry);
            }
            this.lastEventReadbackSourceTick = resolvedSourceTick;
            this.lastEventReadbackSubmittedTick = tick;
            this.#beginEventReadback(eventSlot, queueEntry, eventLease);
        }
        if (stagedSpawnCount > 0) {
            const spawnQueueEntry = {
                sourceTick: resolvedSourceTick,
                submittedTick: tick,
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: generation,
                authoritativeEpoch,
                lease: spawnProgramLease,
                programs: stagedPrograms.sourceRelativeSpawns,
                completed: false,
                outcomes: null,
                failure: null
            };
            this.spawnProgramBatchQueue.push(spawnQueueEntry);
            this.lastSpawnProgramSourceTick = resolvedSourceTick;
            this.#beginSpawnProgramReadback(
                stagedPrograms.readbackSlot,
                spawnQueueEntry,
                spawnProgramLease
            );
        }
        if (!terminalFinalSubmit && stagedEffectBatch) {
            const protocolKey = [
                this.sessionGeneration,
                generation,
                authoritativeEpoch
            ].join(':');
            const predecessorMatches = this.lastEffectProtocolKey === protocolKey;
            const effectQueueEntry = {
                sessionGeneration: this.sessionGeneration,
                previousSourceTick: predecessorMatches
                    ? this.lastEffectProgramSourceTick
                    : 0,
                previousSubmittedTick: predecessorMatches
                    ? this.lastEffectProgramSubmittedTick
                    : 0,
                sourceTick: resolvedSourceTick,
                submittedTick: tick,
                deviceGeneration: generation,
                authoritativeEpoch,
                batchIdFingerprint: stagedEffectBatch.batchIdFingerprint,
                records: stagedEffectBatch.records,
                completed: false,
                completion: null,
                failure: null
            };
            this.effectProgramBatchQueue.push(effectQueueEntry);
            this.lastEffectProtocolKey = protocolKey;
            this.lastEffectProgramSourceTick = resolvedSourceTick;
            this.lastEffectProgramSubmittedTick = tick;
            this.#beginEffectProgramReadback(
                stagedEffectBatch.readbackSlot,
                effectQueueEntry,
                effectProgramLease
            );
        }
        if (!terminalFinalSubmit && stagedFormationPrepare) {
            const protocolKey = [
                this.sessionGeneration,
                generation,
                authoritativeEpoch
            ].join(':');
            const predecessorMatches
                = this.lastFormationProtocolKey === protocolKey;
            const prepareQueueEntry = {
                sessionGeneration: this.sessionGeneration,
                previousSourceTick: predecessorMatches
                    ? this.lastFormationPrepareSourceTick
                    : 0,
                previousSubmittedTick: predecessorMatches
                    ? this.lastFormationPrepareSubmittedTick
                    : 0,
                sourceTick: resolvedSourceTick,
                submittedTick: tick,
                deviceGeneration: generation,
                authoritativeEpoch,
                batchIdFingerprint:
                    stagedFormationPrepare.batchIdFingerprint,
                records: stagedFormationPrepare.records,
                completed: false,
                completion: null,
                failure: null
            };
            this.formationPrepareBatchQueue.push(prepareQueueEntry);
            this.lastFormationProtocolKey = protocolKey;
            this.lastFormationPrepareSourceTick = resolvedSourceTick;
            this.lastFormationPrepareSubmittedTick = tick;
            this.#beginFormationPrepareReadback(
                stagedFormationPrepare.readbackSlot,
                prepareQueueEntry,
                formationPrepareLease
            );
        }
        if (!terminalFinalSubmit && stagedAtomicTransformPrepare) {
            const prepareQueueEntry = {
                sessionGeneration: this.sessionGeneration,
                sourceTick: resolvedSourceTick,
                targetFixedTick: stagedAtomicTransformPrepare.targetFixedTick,
                submittedTick: tick,
                deviceGeneration: generation,
                authoritativeEpoch,
                batchIdFingerprint:
                    stagedAtomicTransformPrepare.batchIdFingerprint,
                completed: false,
                completion: null,
                failure: null
            };
            this.atomicTransformPrepareBatchQueue.push(prepareQueueEntry);
            this.lastAtomicTransformPrepareSourceTick = resolvedSourceTick;
            this.#beginAtomicTransformPrepareReadback(
                stagedAtomicTransformPrepare.readbackSlot,
                prepareQueueEntry,
                atomicTransformPrepareLease
            );
        }
        if (!terminalFinalSubmit
            && armedFormationTransform?.commitRequested) {
            const transformQueueEntry = {
                sessionGeneration: this.sessionGeneration,
                preparedSourceTick:
                    armedFormationTransform.preparedSourceTick,
                targetFixedTick: armedFormationTransform.targetFixedTick,
                submittedTick: tick,
                deviceGeneration: generation,
                authoritativeEpoch,
                batchIdFingerprint:
                    armedFormationTransform.batchIdFingerprint,
                records: armedFormationTransform.records
            };
            this.#beginFormationTransformReadback(
                armedFormationTransform.readbackSlot,
                transformQueueEntry,
                formationTransformLease
            );
            for (const record of armedFormationTransform.records) {
                const sourceAKey = entityHandleKey(record.sourceA);
                const sourceBKey = entityHandleKey(record.sourceB);
                this.handleToSlot.delete(sourceAKey);
                this.handleToSlot.delete(sourceBKey);
                this.slotHandles[record.sourceA.slot] = record.destination;
                this.slotActive[record.sourceA.slot] = 1;
                this.handleToSlot.set(
                    entityHandleKey(record.destination),
                    record.sourceA.slot
                );
                this.slotHandles[record.sourceB.slot] = null;
                this.slotActive[record.sourceB.slot] = 0;
                this.freeSlots.push(record.sourceB.slot);
                this.activeBodyCount--;
            }
        }
        if (armedAtomicTransform?.commitRequested) {
            this.#beginAtomicTransformReadback(
                armedAtomicTransform.readbackSlot,
                {
                    sourceTick: armedAtomicTransform.sourceTick,
                    targetFixedTick: armedAtomicTransform.targetFixedTick,
                    submittedTick: tick,
                    sessionGeneration: this.sessionGeneration,
                    deviceGeneration: generation,
                    authoritativeEpoch,
                    expectedCount: armedAtomicTransform.records.length,
                    batchIdFingerprint:
                        armedAtomicTransform.batchIdFingerprint,
                    records: armedAtomicTransform.records
                },
                atomicTransformLease
            );
        }
        if (trackedPoseSlot) {
            this.#beginTrackedPoseReadback(trackedPoseSlot, {
                sourceTick: resolvedSourceTick,
                submittedTick: tick,
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: generation,
                authoritativeEpoch,
                resourceLease: trackedPoseLease,
                trackingRevision: this.trackedPoseRevision,
                expectedHandle: this.trackedPoseHandle,
                expectedSlot: this.trackedPoseSlot
            });
        }
        this.stagedFixedPrograms = null;
        this.stagedEffectPulseBatch = null;
        this.stagedFormationPrepareBatch = null;
        this.stagedAtomicTransformPrepareBatch = null;
        this.stagedRouteCleanupBatch = null;
        if (armedFormationTransform?.commitRequested) {
            this.armedFormationTransform = null;
        } else if (armedFormationTransform
            && resolvedSourceTick >= armedFormationTransform.targetFixedTick) {
            this.#releaseClaimedFormationTransformReadbackSlot(
                armedFormationTransform.readbackSlot
            );
            this.armedFormationTransform = null;
        }
        if (armedAtomicTransform?.commitRequested) {
            this.armedAtomicTransform = null;
        } else if (armedAtomicTransform
            && resolvedSourceTick >= armedAtomicTransform.targetFixedTick) {
            this.#releaseClaimedAtomicTransformReadbackSlot(
                armedAtomicTransform.readbackSlot
            );
            this.armedAtomicTransform = null;
        }
        if (armedProjectileCaptureRelease?.commitRequested) {
            this.armedProjectileCaptureRelease = null;
        } else if (armedProjectileCaptureRelease
            && resolvedSourceTick
                >= armedProjectileCaptureRelease.targetFixedTick) {
            this.armedProjectileCaptureRelease = null;
        }
        if (!terminalFinalSubmit) {
            this.effectActivePoolIndex = this.effectActivePoolIndex === 0 ? 1 : 0;
        }
        if (terminalCancel?.state === 'armed') {
            this.terminalFixedProgramCancelStatus = Object.freeze({
                ...terminalCancel,
                state: 'submitted',
                submittedSourceTick: resolvedSourceTick,
                submittedTick: tick,
                pendingBodyCount: this.pendingBodyCount,
                pendingSpawnProgramReadbacks:
                    this.pendingSpawnProgramReadbacks
            });
        }
        if (terminalEffectCancel?.state === 'armed') {
                this.terminalEffectProgramCancelStatus = Object.freeze({
                    ...terminalEffectCancel,
                    state: 'submitted',
                    submittedTick: resolvedSourceTick,
                    pendingPulseProgramCount: 0,
                    pendingEffectReadbackCount: 0,
                    failure: null
                });
        }
        if (terminalFormationCancel?.state === 'armed') {
            this.terminalFormationProgramCancelStatus = Object.freeze({
                ...terminalFormationCancel,
                state: 'submitted',
                submittedTick: resolvedSourceTick,
                pendingPrepareProgramCount: 0,
                pendingPrepareReadbackCount: 0,
                failure: null
            });
        }
        if (terminalAtomicTransformCancel?.state === 'armed') {
            const terminalTransformReadbackPending
                = this.pendingAtomicTransformReadbacks;
            this.terminalAtomicTransformProgramCancelStatus = Object.freeze({
                ...terminalAtomicTransformCancel,
                state: 'submitted',
                submittedTick: resolvedSourceTick,
                pendingPrepareCount: 0,
                pendingTransformCount: 0,
                pendingReadbackCount: terminalTransformReadbackPending,
                failure: null
            });
        }
        if (terminalProjectileCaptureCancel?.state === 'armed') {
            this.terminalProjectileCaptureProgramCancelStatus = Object.freeze({
                ...terminalProjectileCaptureCancel,
                state: 'submitted',
                submittedTick: resolvedSourceTick,
                failure: null
            });
        }
        if (terminalRouteAvailabilityCancel?.state === 'armed') {
            this.terminalRouteAvailabilityProgramCancelStatus = Object.freeze({
                ...terminalRouteAvailabilityCancel,
                state: 'submitted',
                accepted: true,
                submittedTick: resolvedSourceTick,
                pendingReadbackCount: this.pendingRouteRuntimeReadbacks,
                failure: null
            });
        }
        return true;
    }

    /**
     * 제출 순서상 선두부터 연속 완료된 contact/death batch만 방출합니다.
     * @param {object[]} [out=[]] - batch를 추가할 호출자 소유 배열입니다.
     * @returns {object[]} 전달받은 out입니다.
     */
    drainCompletedEventBatches(out = []) {
        if (!out || typeof out.push !== 'function') {
            throw new TypeError('event batch 출력 대상은 push 가능한 배열이어야 합니다.');
        }
        while (this.eventBatchQueue[0]?.completed === true) {
            const entry = this.eventBatchQueue.shift();
            out.push(Object.freeze({
                sessionGeneration: entry.sessionGeneration,
                previousSourceTick: entry.previousSourceTick,
                previousSubmittedTick: entry.previousSubmittedTick,
                sourceTick: entry.sourceTick,
                submittedTick: entry.submittedTick,
                deviceGeneration: entry.deviceGeneration,
                authoritativeEpoch: entry.authoritativeEpoch,
                completedThroughTick: this.eventCompletedThroughTick,
                events: entry.events
            }));
        }
        this.#completeDeferredIdleRelease();
        return out;
    }

    /**
     * 물리와 독립적인 presentation clock만 진행합니다.
     * @param {{frameDelta?:number,fixedDelta?:number,fixedAlpha?:number,renderFrameId?:number}} frame - 렌더 프레임 값입니다.
     * @returns {object} 셰이더 표현 상태입니다.
     */
    updatePresentation(frame = {}) {
        const scratch = this.presentationFrameScratch;
        scratch.frameDelta = frame.frameDelta;
        scratch.fixedDelta = frame.fixedDelta ?? this.lastFixedDelta;
        scratch.fixedAlpha = frame.fixedAlpha;
        scratch.renderFrameId = frame.renderFrameId;
        if (Number(frame.frameDelta) === 0 || this.requiresAuthoritativeRebuild) {
            this.presentationClock.synchronize(frame.renderFrameId);
        }
        return this.presentationClock.advanceRender(scratch);
    }

    /**
     * pause/resume/teleport 경계에서 남아 있는 render prediction age를 제거합니다.
     * @param {number} [renderFrameId] - 선택적인 렌더 프레임 식별자입니다.
     * @returns {void}
     */
    synchronizePresentation(renderFrameId) {
        return this.presentationClock.synchronize(renderFrameId);
    }

    /**
     * WebGPU 투명 surface에 모든 body를 한 번의 indirect draw로 그립니다.
     * @param {object} camera - WorldCamera2D compatible projection입니다.
     * @returns {boolean} draw 또는 clear 제출 여부입니다.
     */
    draw(camera) {
        const frameComposer = this.#getActiveFrameComposer();
        if (this.requiresAuthoritativeRebuild && !this.#isOverflowDegradedState()) {
            if (!this.canvasHasDrawnBodies && !this.canvasNeedsInitialClear) {
                return false;
            }
            if (frameComposer) {
                return this.#encodeComposerCanvasTransition(
                    frameComposer,
                    false,
                    () => frameComposer.clearCanvas({ r: 0, g: 0, b: 0, a: 0 })
                );
            }
            const cleared = this.platform.clearCanvas({ r: 0, g: 0, b: 0, a: 0 });
            if (cleared) {
                this.canvasHasDrawnBodies = false;
                this.canvasNeedsInitialClear = false;
            }
            return cleared;
        }
        if (this.activeBodyCount === 0) {
            if (!this.canvasHasDrawnBodies && !this.canvasNeedsInitialClear) {
                return false;
            }
            if (frameComposer) {
                return this.#encodeComposerCanvasTransition(
                    frameComposer,
                    false,
                    () => frameComposer.clearCanvas({ r: 0, g: 0, b: 0, a: 0 })
                );
            }
            const cleared = this.platform.clearCanvas({ r: 0, g: 0, b: 0, a: 0 });
            if (cleared) {
                this.canvasHasDrawnBodies = false;
                this.canvasNeedsInitialClear = false;
            }
            return cleared;
        }
        if (!(this.#isOverflowDegradedState() && this.#hasCurrentGpuResources())
            && !this.#ensureReady()) {
            return false;
        }
        if (!camera
            || typeof camera.worldToViewport !== 'function'
            || typeof camera.getScale !== 'function') {
            throw new TypeError('GPU circle body draw에는 WorldCamera2D projection이 필요합니다.');
        }

        if (frameComposer) {
            camera.worldToViewport(0, 0, this.renderOriginScratch);
            return this.#encodeComposerCanvasTransition(
                frameComposer,
                true,
                () => frameComposer.encodeCanvasPass((pass, context) => {
                    if (!this.#isCurrentComposerContext(context)) {
                        throw new Error('GPU circle composer frame context가 현재 자원과 다릅니다.');
                    }
                    this.#writeRenderParams(camera, {
                        width: context.width,
                        height: context.height,
                        format: context.format
                    });
                    pass.setPipeline(this.pipelines.render);
                    pass.setBindGroup(0, this.bindGroups.renderBodies);
                    pass.setBindGroup(1, this.bindGroups.renderParams);
                    pass.drawIndirect(this.buffers.drawIndirect, 0);
                })
            );
        }

        let target = this.platform.acquireFrameTarget();
        if (!target) {
            return false;
        }
        if (target.device !== this.device
            || target.deviceGeneration !== this.deviceGeneration
            || target.format !== this.canvasFormat) {
            if (!this.init()) {
                return false;
            }
            target = this.platform.acquireFrameTarget();
            if (!target || target.device !== this.device) {
                return false;
            }
        }

        camera.worldToViewport(0, 0, this.renderOriginScratch);
        this.#writeRenderParams(camera, target);
        const encoder = this.device.createCommandEncoder({
            label: 'cirvivor-gpu-circle-render'
        });
        const pass = encoder.beginRenderPass({
            label: 'cirvivor-gpu-circle-render-pass',
            colorAttachments: [{
                view: target.view,
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });
        pass.setPipeline(this.pipelines.render);
        pass.setBindGroup(0, this.bindGroups.renderBodies);
        pass.setBindGroup(1, this.bindGroups.renderParams);
        pass.drawIndirect(this.buffers.drawIndirect, 0);
        pass.end();
        this.device.queue.submit([encoder.finish()]);
        this.platform.markCanvasDrawn();
        this.canvasHasDrawnBodies = true;
        this.canvasNeedsInitialClear = false;
        return true;
    }

    #getActiveFrameComposer() {
        const frameComposer = this.platform.getFrameComposer?.();
        return frameComposer?.isFrameActive?.() === true ? frameComposer : null;
    }

    #isCurrentComposerContext(context) {
        return Boolean(
            context
            && context.device === this.device
            && context.deviceGeneration === this.deviceGeneration
            && context.format === this.canvasFormat
            && Number.isFinite(context.width)
            && context.width > 0
            && Number.isFinite(context.height)
            && context.height > 0
            && context.encoder
            && context.target
            && context.target.device === context.device
            && context.target.deviceGeneration === context.deviceGeneration
            && context.target.format === context.format
        );
    }

    #encodeComposerCanvasTransition(frameComposer, nextValue, encode) {
        const pending = this.pendingComposerCanvasTransition;
        if (pending) {
            return pending.frameComposer === frameComposer
                && pending.nextValue === nextValue;
        }

        if (typeof frameComposer.deferFrameCallbacks !== 'function'
            || typeof encode !== 'function') {
            return false;
        }
        const transition = { frameComposer, nextValue };
        this.pendingComposerCanvasTransition = transition;
        let registered = false;
        try {
            registered = frameComposer.deferFrameCallbacks({
                committed: () => {
                    if (this.pendingComposerCanvasTransition !== transition) {
                        return;
                    }
                    this.pendingComposerCanvasTransition = null;
                    if (!this.destroyed) {
                        this.canvasHasDrawnBodies = nextValue;
                        this.canvasNeedsInitialClear = false;
                    }
                },
                aborted: () => {
                    if (this.pendingComposerCanvasTransition === transition) {
                        this.pendingComposerCanvasTransition = null;
                    }
                }
            }) === true;
        } catch {
            registered = false;
        }
        if (!registered) {
            if (this.pendingComposerCanvasTransition === transition) {
                this.pendingComposerCanvasTransition = null;
            }
            return false;
        }

        let encoded = false;
        try {
            encoded = encode() === true;
        } catch {
            encoded = false;
        }
        if (!encoded && this.pendingComposerCanvasTransition === transition) {
            this.pendingComposerCanvasTransition = null;
        }
        return encoded;
    }

    /**
     * 명시적 테스트·진단 시점에만 전체 body를 readback합니다. 프레임 경로에서는 호출하지 않습니다.
     * @returns {Promise<object[]>} unpack된 body snapshot입니다.
     */
    async readbackBodies() {
        if (this.activeBodyCount === 0) {
            return [];
        }
        if (!(this.#isOverflowDegradedState() && this.#hasCurrentGpuResources())
            && !this.#ensureReady()) {
            return [];
        }
        const bodyCount = this.bodyCount;
        const usage = globalThis.GPUBufferUsage;
        const mapMode = globalThis.GPUMapMode;
        if (!usage || !mapMode) {
            throw new Error('WebGPU readback 상수가 없습니다.');
        }
        const planes = [
            ['physicsBuffer', 'physics', GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE],
            ['simulationBuffer', 'simulation', GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE],
            ['temporaryBuffer', 'temporary', GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE],
            ['combatStateBuffer', 'combatStates', GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE],
            [
                'atomicTransformStateBuffer',
                'atomicTransformStates',
                GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE.STRIDE
            ],
            [
                'enemyBehaviorStateBuffer',
                'enemyBehaviorStates',
                GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE
            ]
        ].map(([hostKey, gpuKey, stride]) => ({
            hostKey,
            gpuKey,
            byteSize: stride * bodyCount,
            buffer: createBuffer(
                this.device,
                `cirvivor-gpu-circle-readback-${gpuKey}`,
                stride * bodyCount,
                usage.COPY_DST | usage.MAP_READ
            )
        }));
        try {
            const encoder = this.device.createCommandEncoder({
                label: 'cirvivor-gpu-circle-readback'
            });
            for (const plane of planes) {
                encoder.copyBufferToBuffer(
                    this.buffers[plane.gpuKey],
                    0,
                    plane.buffer,
                    0,
                    plane.byteSize
                );
            }
            this.device.queue.submit([encoder.finish()]);
            await Promise.all(planes.map((plane) => plane.buffer.mapAsync(mapMode.READ)));
            const storage = createGpuCircleBodyAbiStorage(this.capacity);
            writeGpuCircleBodyCounts(storage, { bodyCount });
            const contactHandlerByteSize = bodyCount
                * GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE;
            new Uint8Array(
                storage.contactHandlerBuffer,
                0,
                contactHandlerByteSize
            ).set(new Uint8Array(
                this.hostStorage.contactHandlerBuffer,
                0,
                contactHandlerByteSize
            ));
            for (const plane of planes) {
                new Uint8Array(storage[plane.hostKey], 0, plane.byteSize).set(
                    new Uint8Array(plane.buffer.getMappedRange())
                );
                plane.buffer.unmap();
            }
            const result = [];
            for (let index = 0; index < bodyCount; index++) {
                const body = readGpuCircleBody(storage, index);
                if ((body.simulationMeta & GPU_CIRCLE_BODY_META.ALIVE_BIT) === 0) {
                    continue;
                }
                const hasIdentity = body.entityId !== GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
                    && body.incarnation !== GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT;
                result.push({
                    ...body,
                    handle: hasIdentity
                        ? Object.freeze({
                            entityId: body.entityId,
                            incarnation: body.incarnation
                        })
                        : null
                });
            }
            return result;
        } finally {
            for (const plane of planes) {
                try {
                    plane.buffer.unmap();
                } catch {
                    // already unmapped
                }
                plane.buffer.destroy();
            }
        }
    }

    /** @returns {object} backend 진단 snapshot입니다. */
    getStatus() {
        return Object.freeze({
            state: this.state,
            failure: this.failure,
            abiVersion: GPU_CIRCLE_BODY_ABI_VERSION,
            sessionGeneration: this.sessionGeneration,
            capacity: this.capacity,
            bodyCount: this.bodyCount,
            activeBodyCount: this.activeBodyCount,
            pendingBodyCount: this.pendingBodyCount,
            freeSlotCount: this.freeSlots.length,
            deviceGeneration: this.deviceGeneration,
            gridCellCount: this.gridCellCount,
            maxBodiesPerCell: this.maxBodiesPerCell,
            solverIterations: this.solverIterations,
            sdfEnabled: this.sdf.enabled,
            flowFieldEnabled: this.flowFieldAtlas.enabled,
            flowFieldCount: this.flowFieldAtlas.fieldCount,
            sourceWorldUnitScale: this.sourceWorldUnitScale,
            maximumBodyRadius: this.maximumBodyRadius,
            atomicTransformFirstHitBodyCount:
                this.atomicTransformFirstHitBodyCount,
            atomicTransformFirstHitTriggerScope:
                'positive-damage-closest-only-projectile-contact-with-positive-self-hit-budget',
            uploadedMaximumBodyRadius: this.uploadedMaximumBodyRadius,
            submittedTickCount: this.submittedTickCount,
            hasGpuAuthoritativeState: this.hasGpuAuthoritativeState,
            authoritativeEpoch: this.authoritativeEpoch,
            requiresAuthoritativeRebuild: this.requiresAuthoritativeRebuild,
            contact: Object.freeze({
                capacity: this.contactCapacity,
                lastCount: this.lastContactCount,
                lastOverflowCount: this.lastContactOverflowCount
            }),
            events: Object.freeze({
                capacity: this.eventCapacity,
                deathCapacity: this.deathEventCapacity,
                eventProducingBodyCount: this.eventProducingBodyCount,
                pendingReadbacks: this.pendingEventReadbacks,
                queuedBatches: this.eventBatchQueue.length,
                completedThroughTick: this.eventCompletedThroughTick,
                backpressureCount: this.eventBackpressureCount,
                lastSourceTick: this.lastEventReadbackSourceTick,
                lastSubmittedTick: this.lastEventReadbackSubmittedTick,
                lastCompletedTick: this.lastEventReadbackCompletedTick,
                lastStatsTick: this.lastEventStatsTick,
                lastAppliedCount: this.lastAppliedEventCount,
                lastAppliedOverflowCount: this.lastAppliedEventOverflowCount,
                lastDeathCount: this.lastDeathEventCount,
                lastDeathOverflowCount: this.lastDeathEventOverflowCount
            }),
            fixedPrimitives: Object.freeze({
                ingressOpen: this.fixedProgramIngressOpen,
                terminalCancellation: this.terminalFixedProgramCancelStatus,
                control: Object.freeze({
                    abiVersion: GPU_BODY_CONTROL_PROGRAM_ABI_VERSION,
                    capacity: this.controlCommandCapacity,
                    stagedCount: this.stagedFixedPrograms?.controls.length ?? 0,
                    queuedBatches: this.bodyControlProgramBatchQueue.length,
                    completedOutcomeCount: this.lastBodyControlOutcomeCount,
                    storageBuffersPerStage: 5
                }),
                spawnProgram: Object.freeze({
                    abiVersion: GPU_SPAWN_PROGRAM_ABI_VERSION,
                    capacity: this.spawnProgramCapacity,
                    stagedCount:
                        this.stagedFixedPrograms?.sourceRelativeSpawns.length ?? 0,
                    pendingReadbacks: this.pendingSpawnProgramReadbacks,
                    queuedBatches: this.spawnProgramBatchQueue.length,
                    ringSlotCount: SPAWN_PROGRAM_READBACK_SLOT_COUNT,
                    backpressureCount: this.spawnProgramBackpressureCount,
                    overflowCount: this.spawnProgramOverflowCount,
                    lastSourceTick: this.lastSpawnProgramSourceTick,
                    resolvedCount: this.lastSpawnProgramResolvedCount,
                    invalidCount: this.lastSpawnProgramInvalidCount,
                    completedResolved: this.lastSpawnProgramResolvedCount,
                    completedSourceInvalid:
                        this.lastSpawnProgramSourceInvalidCount,
                    completedTargetInvalid:
                        this.lastSpawnProgramTargetInvalidCount,
                    completedNoTarget: this.lastSpawnProgramNoTargetCount,
                    completedCoreInvalid: this.lastSpawnProgramCoreInvalidCount,
                    storageBuffersPerStage: 9
                }),
                towerGameplayTarget: Object.freeze({
                    abiVersion:
                        GPU_TOWER_GAMEPLAY_TARGET_CONFIG_ABI_VERSION,
                    configured: Boolean(this.towerGameplayTargetHandle),
                    recordByteSize: TOWER_GAMEPLAY_TARGET_CONFIG_BYTE_SIZE,
                    storageBuffersPerStage: 8
                }),
                trackedPose: Object.freeze({
                    configured: Boolean(this.trackedPoseHandle),
                    ringSlotCount: TRACKED_POSE_READBACK_SLOT_COUNT,
                    recordByteSize: TRACKED_POSE_RECORD_BYTE_SIZE,
                    maximumBytesPerTick: TRACKED_POSE_RECORD_BYTE_SIZE,
                    pendingReadbacks: this.pendingTrackedPoseReadbacks,
                    droppedSamples: this.trackedPoseDroppedSamples,
                    publishedSamples: this.trackedPosePublishedSamples,
                    storageBuffersPerStage: 6,
                    latest: this.getLatestTrackedPose()
                }),
                enemyBehavior: Object.freeze({
                    arrowChargeProgramId:
                        GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.ARROW_TOWER_CHARGE,
                    selectedTargetProjectileProgramId:
                        GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM
                            .SELECTED_TARGET_PROJECTILE,
                    octagonTowerOrbitProgramId:
                        GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT,
                    directionalDefenseClassifier: Object.freeze({
                        entryPoint: 'classify_directional_defense_contacts',
                        pipelineProfile:
                            COMPUTE_PIPELINE_PROFILE
                                .DIRECTIONAL_DEFENSE_CLASSIFIER,
                        storageBuffersPerStage: 8
                    }),
                    stateStride:
                        GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE,
                    storageBuffersPerStage: 8
                }),
                coreDamageRequest: Object.freeze({
                    storageBuffersPerStage: 9
                }),
                atomicTransformFirstHit: Object.freeze({
                    entryPoints: Object.freeze([
                        'clear_atomic_transform_first_hit_candidates',
                        'select_atomic_transform_first_hit_source',
                        'resolve_atomic_transform_first_hit_contact',
                        'seal_atomic_transform_first_hits',
                        'commit_atomic_transform_first_hits',
                        'finalize_atomic_transform_first_hits',
                        'shield_atomic_transform_first_hit_contacts'
                    ]),
                    admissionPolicy: 'all-exact-winners-within-event-capacity',
                    winnerIdentityPolicy:
                        'active-entity-id-unique/source-entity-id-asc/exact-contact-unique',
                    triggerScope:
                        'positive-damage-closest-only-projectile-with-positive-self-hit-budget',
                    stateStride:
                        GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE.STRIDE,
                    candidateStride:
                        GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_CANDIDATE.STRIDE,
                    storageBuffersPerStage: 9
                }),
                windowStorageBuffersPerStage: 9,
                storageProfile: Object.freeze({
                    physics: 8,
                    bodyContacts: 9,
                    worldContacts: 7,
                    contactHandling: 9,
                    maximumDamageWindow: 9,
                    fixedControl: 5,
                    sourceResolve: 9,
                    enemyBehavior: 8,
                    directionalDefenseClassifier: 8,
                    coreDamageRequest: 9,
                    atomicTransformFirstHit: 9,
                    trackedPose: 6,
                    requiredMaximum: REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE
                })
            }),
            effects: Object.freeze({
                ...this.getEffectRuntimeStatus(),
                instanceCapacity: this.effectInstanceCapacity,
                pulseProgramCapacity: this.effectPulseProgramCapacity,
                candidateCapacity: this.effectCandidateCapacity,
                eventCapacity: this.effectEventCapacity,
                instanceStride: GPU_EFFECT_RUNTIME_ABI.INSTANCE.STRIDE,
                summaryStride: GPU_EFFECT_RUNTIME_ABI.SUMMARY.STRIDE,
                emitterStride: GPU_EFFECT_RUNTIME_ABI.EMITTER_STATE.STRIDE,
                storageBuffersPerStage: 9
            }),
            formations: Object.freeze({
                ...this.getFormationRuntimeStatus(),
                bodyStateStride: GPU_FORMATION_RUNTIME_ABI.BODY_STATE.STRIDE,
                prepareRecordStride:
                    GPU_FORMATION_RUNTIME_ABI.PREPARE_RECORD.STRIDE,
                transformRecordStride:
                    GPU_FORMATION_RUNTIME_ABI.TRANSFORM_RECORD.STRIDE,
                prepareReadbackRingSlotCount:
                    FORMATION_PROGRAM_READBACK_SLOT_COUNT,
                transformReadbackRingSlotCount:
                    FORMATION_PROGRAM_READBACK_SLOT_COUNT,
                maximumStorageBuffersPerStage: 9
            }),
            overflow: Object.freeze({
                pendingReadbacks: this.pendingOverflowReadbacks,
                lastTick: this.lastOverflowTick,
                lastSmallCount: this.lastSmallOverflowCount,
                lastBigCount: this.lastBigOverflowCount,
                totalSmallCount: this.totalSmallOverflowCount,
                totalBigCount: this.totalBigOverflowCount,
                backpressureCount: this.telemetryBackpressureCount,
                sampleIntervalTicks: OVERFLOW_READBACK_INTERVAL_TICKS,
                lastSampleSubmittedTick: this.lastOverflowSampleSubmittedTick,
                lastSampleCompletedTick: this.lastOverflowSampleCompletedTick
            }),
            presentation: Object.freeze({ ...this.presentationClock.getClockState({}) })
        });
    }

    /** Facade가 readback envelope를 현재 session/device/epoch와 대조하는 작은 상태입니다. */
    getEventProtocolState() {
        return Object.freeze({
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: this.deviceGeneration,
            authoritativeEpoch: this.authoritativeEpoch,
            submittedTickCount: this.submittedTickCount
        });
    }

    /** @returns {string} 할당 없는 runtime state입니다. */
    getRuntimeState() {
        return this.state;
    }

    /** @returns {number} 할당 없는 활성 body 수입니다. */
    getActiveBodyCount() {
        return this.activeBodyCount;
    }

    /**
     * GPU session 자원을 정리하고 투명 surface를 비웁니다. 반복 호출해도 안전합니다.
     * @returns {void}
     */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        try {
            if (this.canvasHasDrawnBodies) {
                this.platform.clearCanvas({ r: 0, g: 0, b: 0, a: 0 });
            }
        } catch {
            // device loss 중 clear 실패는 platform generation 복구가 담당합니다.
        }
        this.#releaseGpuResources();
        this.activeBodyCount = 0;
        this.hasGpuAuthoritativeState = false;
        this.slotActive.fill(0);
        this.slotEventProducing.fill(0);
        this.slotProjectileCaptureDomain.fill(0);
        this.slotRouteRuntimeDomain.fill(0);
        this.eventProducingBodyCount = 0;
        this.projectileCaptureDomainBodyCount = 0;
        this.atomicTransformFirstHitBodyCount = 0;
        this.maximumBodyRadius = 0;
        this.slotHandles.fill(null);
        this.handleToSlot.clear();
        this.pendingSlotHandles.fill(null);
        this.pendingHandleToSlot.clear();
        this.freeSlots.length = 0;
        this.stagedFixedPrograms = null;
        this.#invalidateTrackedPose('destroyed');
        this.pendingComposerCanvasTransition = null;
        this.canvasHasDrawnBodies = false;
        this.canvasNeedsInitialClear = false;
        this.state = 'destroyed';
    }

    #collectPendingPriorityControls() {
        const result = new Map();
        let duplicateSequence = 0;
        const collect = (sourceTick, programs) => {
            for (const program of programs ?? []) {
                if (program.modeFlags
                    !== GPU_BODY_CONTROL_PROGRAM_MODE.PRIORITY_TARGET_IN_RANGE) {
                    continue;
                }
                const handle = program.sourceHandle ?? program.handle;
                const key = `${sourceTick}:${entityHandleKey(handle)}`;
                if (result.has(key)) {
                    result.set(`duplicate:${duplicateSequence++}:${key}`, program);
                    continue;
                }
                result.set(key, program);
            }
        };
        collect(
            this.stagedFixedPrograms?.targetFixedTick,
            this.stagedFixedPrograms?.controls
        );
        for (const batch of this.bodyControlProgramBatchQueue) {
            collect(batch.sourceTick, batch.programs);
        }
        return result;
    }

    #collectPendingSpawnPrograms() {
        const result = new Map();
        let duplicateSequence = 0;
        const collect = (sourceTick, programs) => {
            for (const program of programs ?? []) {
                const key = entityHandleKey(program.destinationHandle);
                const entry = Object.freeze({ ...program, sourceTick });
                if (result.has(key)) {
                    result.set(`duplicate:${duplicateSequence++}:${key}`, entry);
                    continue;
                }
                result.set(key, entry);
            }
        };
        collect(
            this.stagedFixedPrograms?.targetFixedTick,
            this.stagedFixedPrograms?.sourceRelativeSpawns
        );
        for (const batch of this.spawnProgramBatchQueue) {
            collect(batch.sourceTick, batch.programs);
        }
        return result;
    }

    #retireTerminalReadbacks() {
        this.overflowReadbackLease++;
        for (const slot of this.overflowReadbackSlots) {
            slot.inFlight = false;
        }
        this.pendingOverflowReadbacks = 0;
        this.overflowReadbackCursor = 0;

        this.eventReadbackLease++;
        for (const slot of this.eventReadbackSlots) {
            slot.inFlight = false;
        }
        this.pendingEventReadbacks = 0;
        this.eventReadbackCursor = 0;
        this.eventBatchQueue.length = 0;
        this.bodyControlProgramBatchQueue.length = 0;

        this.spawnProgramReadbackLease++;
        for (const slot of this.spawnProgramReadbackSlots) {
            slot.inFlight = false;
        }
        this.pendingSpawnProgramReadbacks = 0;
        this.spawnProgramReadbackCursor = 0;
        this.spawnProgramBatchQueue.length = 0;

        this.trackedPoseReadbackLease++;
        for (const slot of this.trackedPoseReadbackSlots) {
            slot.inFlight = false;
        }
        this.pendingTrackedPoseReadbacks = 0;
        this.trackedPoseReadbackCursor = 0;
    }

    #validateBody(body, index) {
        if (!body || typeof body !== 'object') {
            throw new TypeError(`GPU circle body가 객체가 아닙니다: index=${index}`);
        }
        if (body.alive === false) {
            throw new RangeError(`활성 body spawn에는 alive=false를 사용할 수 없습니다: index=${index}`);
        }
        const radius = Number(body.radius);
        const inverseMass = Number(body.inverseMass ?? body.invMass);
        const usesFlow = body.useFlow === true
            || (body.flowFieldIndex !== undefined && body.flowFieldIndex !== null);
        if (usesFlow) {
            if (!this.flowFieldAtlas.enabled) {
                throw new RangeError(`flow body에는 flowFieldAtlas가 필요합니다: index=${index}`);
            }
            const flowFieldIndex = Number(body.flowFieldIndex);
            if (!Number.isInteger(flowFieldIndex)
                || flowFieldIndex < 0
                || flowFieldIndex >= this.flowFieldAtlas.fieldCount) {
                throw new RangeError(
                    `flowFieldIndex가 atlas 범위를 벗어났습니다: index=${index}`
                );
            }
        }
        if (Number.isFinite(inverseMass)
            && inverseMass > 0
            && inverseMass <= MASS_EPSILON) {
            throw new RangeError(
                `inverseMass는 0 또는 ${MASS_EPSILON}보다 커야 합니다: index=${index}`
            );
        }
        const maximumDynamicDiameter = Math.min(
            this.gridCellSize.x,
            this.gridCellSize.y
        );
        if (Number.isFinite(radius)
            && Number.isFinite(inverseMass)
            && inverseMass > MASS_EPSILON
            && radius * 2 > maximumDynamicDiameter) {
            throw new RangeError(
                `동적 body 지름은 3x3 grid 탐색의 cell 크기를 넘을 수 없습니다: index=${index}`
            );
        }
    }

    #readHostRouteAvailabilitySnapshot() {
        const header = GPU_ROUTE_RUNTIME_ABI.AVAILABILITY_HEADER;
        const recordAbi = GPU_ROUTE_RUNTIME_ABI.AVAILABILITY_RECORD;
        const view = new DataView(this.hostRouteAvailability);
        const availabilityVersion = view.getUint32(
            header.AVAILABILITY_VERSION,
            LITTLE_ENDIAN
        );
        const closureCount = view.getUint32(header.CLOSURE_COUNT, LITTLE_ENDIAN);
        const records = [];
        const closedPathIds = [];
        let leaseCount = 0;
        for (let closureIndex = 0; closureIndex < closureCount; closureIndex++) {
            const offset = header.STRIDE + closureIndex * recordAbi.STRIDE;
            const state = view.getUint32(offset + recordAbi.STATE, LITTLE_ENDIAN);
            const pathIndex = this.routeRuntimeTopology.graph
                ?.closures?.[closureIndex]?.pathIndex ?? GPU_ROUTE_RUNTIME_INVALID_INDEX;
            const pathId = pathIndex === GPU_ROUTE_RUNTIME_INVALID_INDEX
                ? null
                : this.routeRuntimeTopology.pathIds[pathIndex] ?? null;
            const entityId = view.getUint32(
                offset + recordAbi.OWNER_ENTITY_ID,
                LITTLE_ENDIAN
            );
            const incarnation = view.getUint32(
                offset + recordAbi.OWNER_INCARNATION,
                LITTLE_ENDIAN
            );
            if (state === GPU_ROUTE_AVAILABILITY_STATE.CLOSED && pathId !== null) {
                closedPathIds.push(pathId);
            }
            const leaseGeneration = view.getUint32(
                offset + recordAbi.LEASE_GENERATION,
                LITTLE_ENDIAN
            );
            if (leaseGeneration !== 0) leaseCount++;
            records.push(Object.freeze({
                closureIndex,
                pathIndex,
                pathId,
                closureId: this.routeRuntimeTopology.closureIds[closureIndex] ?? null,
                state,
                ownerSlot: view.getUint32(
                    offset + recordAbi.OWNER_SLOT,
                    LITTLE_ENDIAN
                ),
                ownerHandle: entityId === UINT32_MAX
                    && incarnation === UINT32_MAX
                    ? null
                    : Object.freeze({ entityId, incarnation }),
                leaseGeneration,
                changedAtFixedTick: view.getUint32(
                    offset + recordAbi.CHANGED_AT_FIXED_TICK,
                    LITTLE_ENDIAN
                )
            }));
        }
        closedPathIds.sort();
        return Object.freeze({
            availabilityVersion,
            records: Object.freeze(records),
            closedPathIds: Object.freeze(closedPathIds),
            leaseCount
        });
    }

    #resolveRouteRuntimeSpawnState(body, label) {
        const explicit = body?.routeRuntimeState ?? null;
        const routeSetId = explicit?.routeSetId ?? body?.routeSetId ?? null;
        if (routeSetId === null || routeSetId === undefined) {
            if (explicit !== null) {
                throw new TypeError(`${label}.routeRuntimeState에는 routeSetId가 필요합니다.`);
            }
            return null;
        }
        if (!this.routeRuntimeTopology.enabled) {
            throw new RangeError(`${label} route runtime에는 authored routeGraph가 필요합니다.`);
        }
        if (typeof routeSetId !== 'string' || routeSetId.length === 0) {
            throw new TypeError(`${label}.routeSetId는 비어 있지 않은 문자열이어야 합니다.`);
        }
        if (body.routeGraphContentKey !== this.routeRuntimeTopology.contentKey) {
            throw new RangeError(`${label}.routeGraphContentKey가 current atlas와 다릅니다.`);
        }
        const availabilityVersion = requireNonSentinelUint32(
            body.routeAvailabilityVersion,
            `${label}.routeAvailabilityVersion`,
            { positive: true }
        );
        if (availabilityVersion !== this.lastRouteAvailabilityVersion) {
            throw new RangeError(`${label}.routeAvailabilityVersion이 stale입니다.`);
        }
        const routeSetIndex = this.routeRuntimeTopology.routeSetIndexById[routeSetId];
        if (!Number.isSafeInteger(routeSetIndex)) {
            throw new RangeError(`${label}.routeSetId가 current graph에 없습니다.`);
        }
        const exactHandle = normalizeEntityHandle(body, `${label}.handle`);
        if (exactHandle.entityId === 0 || exactHandle.incarnation === 0) {
            throw new RangeError(`${label}.handle은 positive exact identity여야 합니다.`);
        }
        if (explicit !== null) {
            if (explicit.selfEntityId !== exactHandle.entityId
                || explicit.selfIncarnation !== exactHandle.incarnation
                || explicit.observedAvailabilityVersion !== availabilityVersion) {
                throw new RangeError(`${label}.routeRuntimeState identity/version이 다릅니다.`);
            }
            return Object.freeze({
                ...explicit,
                routeSetIndex
            });
        }
        return Object.freeze({
            role: GPU_ROUTE_RUNTIME_ROLE.ACTOR,
            selfEntityId: exactHandle.entityId,
            selfIncarnation: exactHandle.incarnation,
            currentPathIndex: GPU_ROUTE_RUNTIME_INVALID_INDEX,
            routeSetIndex,
            closureIndex: GPU_ROUTE_RUNTIME_INVALID_INDEX,
            observedAvailabilityVersion: availabilityVersion,
            phaseEnteredFixedTick: 0,
            pendingFieldIndex: GPU_ROUTE_RUNTIME_INVALID_INDEX,
            leaseGeneration: 0,
            profileCode: 0
        });
    }

    #refreshHostBodyDerivedState() {
        const physicsView = new DataView(this.hostStorage.physicsBuffer);
        const simulationView = new DataView(this.hostStorage.simulationBuffer);
        const contactHandlerView = new DataView(
            this.hostStorage.contactHandlerBuffer
        );
        let eventProducingBodyCount = 0;
        let atomicTransformFirstHitBodyCount = 0;
        let projectileCaptureDomainBodyCount = 0;
        let routeRuntimeRosterCount = 0;
        let maximumBodyRadius = 0;
        const activeEntityIds = new Set();
        this.slotEventProducing.fill(0);
        this.slotProjectileCaptureDomain.fill(0);
        this.slotRouteRuntimeDomain.fill(0);
        const atomicTransformStateView = new DataView(
            this.hostStorage.atomicTransformStateBuffer
        );
        const projectileCaptureStateView = new DataView(
            this.hostStorage.projectileCaptureStateBuffer
        );
        for (let slot = 0; slot < this.bodyCount; slot++) {
            if (this.slotActive[slot] !== 1) {
                continue;
            }
            const activeHandle = this.slotHandles[slot];
            if (activeHandle) {
                if (activeEntityIds.has(activeHandle.entityId)) {
                    const error = new Error(
                        `GPU active entityId가 둘 이상의 slot에 존재합니다: ${activeHandle.entityId}`
                    );
                    this.requiresAuthoritativeRebuild
                        = this.activeBodyCount > 0;
                    this.failure = captureFailure(
                        'active-entity-id-uniqueness',
                        error
                    );
                    this.state = this.requiresAuthoritativeRebuild
                        ? 'requires-rebuild'
                        : 'failed';
                    throw error;
                }
                activeEntityIds.add(activeHandle.entityId);
            }
            const physicsOffset = slot * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE;
            const simulationOffset = slot * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
            const interactionMeta = physicsView.getUint32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INTERACTION_META,
                LITTLE_ENDIAN
            );
            const lifetime = simulationView.getFloat32(
                simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.LIFETIME,
                LITTLE_ENDIAN
            );
            const healthFixedPoint = simulationView.getInt32(
                simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH,
                LITTLE_ENDIAN
            );
            const handlerFlags = contactHandlerView.getUint32(
                (slot * GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE)
                    + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.FLAGS,
                LITTLE_ENDIAN
            );
            const sourcePolicyMask =
                GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
                | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS;
            const eventProducing = (
                unpackGpuCircleInteractionMeta(interactionMeta).interactionMask !== 0
                && (handlerFlags & sourcePolicyMask) !== 0
            ) || lifetime >= 0 || healthFixedPoint <= 0;
            if (eventProducing) {
                this.slotEventProducing[slot] = 1;
                eventProducingBodyCount++;
            }
            if (atomicTransformStateView.getUint32(
                (slot * GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE.STRIDE)
                    + GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE.PROGRAM_ID,
                LITTLE_ENDIAN
            ) === GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.J_SPLIT_FIRST_HIT) {
                atomicTransformFirstHitBodyCount++;
            }
            const captureMeta = unpackGpuProjectileCaptureStateMeta(
                projectileCaptureStateView.getUint32(
                    (slot * GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE.STRIDE)
                        + GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE
                            .ROLE_PHASE_PROFILE_POLICY,
                    LITTLE_ENDIAN
                )
            );
            // Capture scan/readback는 authored R CAPTOR가 있을 때만 필요합니다.
            // Capturable projectile만 존재하는 default path는 hot passes를 열지 않습니다.
            if (captureMeta.role === GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR) {
                this.slotProjectileCaptureDomain[slot] = 1;
                projectileCaptureDomainBodyCount++;
            }
            const routeState = readGpuRouteRuntimeState(
                this.hostRouteRuntimeStates,
                this.capacity,
                slot
            );
            if (routeState.role !== GPU_ROUTE_RUNTIME_ROLE.NONE) {
                this.slotRouteRuntimeDomain[slot] = 1;
                if (routeState.role === GPU_ROUTE_RUNTIME_ROLE.CLOSER) {
                    routeRuntimeRosterCount++;
                    maximumBodyRadius = Math.max(
                        maximumBodyRadius,
                        routeState.blockerRadius
                    );
                }
            }
            maximumBodyRadius = Math.max(
                maximumBodyRadius,
                physicsView.getFloat32(
                    physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.RADIUS,
                    LITTLE_ENDIAN
                )
            );
        }
        this.eventProducingBodyCount = eventProducingBodyCount;
        this.atomicTransformFirstHitBodyCount
            = atomicTransformFirstHitBodyCount;
        this.projectileCaptureDomainBodyCount = projectileCaptureDomainBodyCount;
        this.routeRuntimeRosterCount = routeRuntimeRosterCount;
        this.maximumBodyRadius = maximumBodyRadius;
        this.uploadedComputeFixedDelta = NaN;
        this.uploadedComputeFixedTick = -1;
    }

    #uploadSlotRanges(slots) {
        const ordered = [...slots].sort((left, right) => left - right);
        let rangeStart = ordered[0];
        let rangeEnd = rangeStart;
        const uploadRange = (start, end) => {
            const count = end - start + 1;
            for (const [gpuKey, hostKey, stride] of [
                ['physics', 'physicsBuffer', GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE],
                ['simulation', 'simulationBuffer', GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE],
                ['temporary', 'temporaryBuffer', GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE],
                [
                    'contactHandlers',
                    'contactHandlerBuffer',
                    GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE
                ],
                [
                    'combatStates',
                    'combatStateBuffer',
                    GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE
                ],
                [
                    'atomicTransformStates',
                    'atomicTransformStateBuffer',
                    GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE.STRIDE
                ],
                [
                    'projectileCaptureStates',
                    'projectileCaptureStateBuffer',
                    GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE.STRIDE
                ],
                [
                    'projectileCaptureCandidates',
                    'projectileCaptureCandidateBuffer',
                    GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_CANDIDATE.STRIDE
                ],
                [
                    'enemyBehaviorStates',
                    'enemyBehaviorStateBuffer',
                    GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE
                ],
                [
                    'bodyControlStates',
                    'hostBodyControlStates',
                    BODY_CONTROL_STATE_STRIDE
                ]
            ]) {
                const hostBuffer = hostKey === 'hostBodyControlStates'
                    ? this.hostBodyControlStates
                    : this.hostStorage[hostKey];
                this.device.queue.writeBuffer(
                    this.buffers[gpuKey],
                    start * stride,
                    hostBuffer,
                    start * stride,
                    count * stride
                );
            }
            for (const [gpuKey, hostKey, stride] of [
                [
                    'effectSummaries',
                    'summaryBuffer',
                    GPU_EFFECT_RUNTIME_ABI.SUMMARY.STRIDE
                ],
                [
                    'effectEmitterStates',
                    'emitterStateBuffer',
                    GPU_EFFECT_RUNTIME_ABI.EMITTER_STATE.STRIDE
                ]
            ]) {
                this.device.queue.writeBuffer(
                    this.buffers[gpuKey],
                    start * stride,
                    this.hostEffectBodyState[hostKey],
                    start * stride,
                    count * stride
                );
            }
            this.device.queue.writeBuffer(
                this.buffers.formationStates,
                start * GPU_FORMATION_RUNTIME_ABI.BODY_STATE.STRIDE,
                this.hostFormationBodyState,
                start * GPU_FORMATION_RUNTIME_ABI.BODY_STATE.STRIDE,
                count * GPU_FORMATION_RUNTIME_ABI.BODY_STATE.STRIDE
            );
            this.device.queue.writeBuffer(
                this.buffers.routeRuntimeStates,
                start * GPU_ROUTE_RUNTIME_ABI.BODY_STATE.STRIDE,
                this.hostRouteRuntimeStates,
                start * GPU_ROUTE_RUNTIME_ABI.BODY_STATE.STRIDE,
                count * GPU_ROUTE_RUNTIME_ABI.BODY_STATE.STRIDE
            );
            this.device.queue.writeBuffer(
                this.buffers.renderStyles,
                start * BODY_RENDER_STYLE_STRIDE,
                this.hostRenderStyles,
                start * BODY_RENDER_STYLE_STRIDE,
                count * BODY_RENDER_STYLE_STRIDE
            );
        };
        for (let index = 1; index < ordered.length; index++) {
            const slot = ordered[index];
            if (slot === rangeEnd + 1) {
                rangeEnd = slot;
                continue;
            }
            uploadRange(rangeStart, rangeEnd);
            rangeStart = slot;
            rangeEnd = slot;
        }
        uploadRange(rangeStart, rangeEnd);
    }

    #uploadBodyCountState() {
        const queue = this.device.queue;
        queue.writeBuffer(this.buffers.counts, 0, this.hostStorage.countsBuffer);
        this.dispatchIndirectArgs[0] = Math.ceil(this.bodyCount / BODY_WORKGROUP_SIZE);
        this.dispatchIndirectArgs[1] = 1;
        this.dispatchIndirectArgs[2] = 1;
        queue.writeBuffer(this.buffers.dispatchIndirect, 0, this.dispatchIndirectArgs);
        this.drawIndirectArgs[0] = 6;
        this.drawIndirectArgs[1] = this.bodyCount;
        this.drawIndirectArgs[2] = 0;
        this.drawIndirectArgs[3] = 0;
        queue.writeBuffer(this.buffers.drawIndirect, 0, this.drawIndirectArgs);
    }

    #uploadRouteRuntimeSlotRanges(slots) {
        if (!this.device || !this.buffers || slots.length === 0) return;
        const stride = GPU_ROUTE_RUNTIME_ABI.BODY_STATE.STRIDE;
        const ordered = [...new Set(slots)].sort((left, right) => left - right);
        let rangeStart = ordered[0];
        let rangeEnd = rangeStart;
        const upload = (start, end) => this.device.queue.writeBuffer(
            this.buffers.routeRuntimeStates,
            start * stride,
            this.hostRouteRuntimeStates,
            start * stride,
            (end - start + 1) * stride
        );
        for (let index = 1; index < ordered.length; index++) {
            const slot = ordered[index];
            if (slot === rangeEnd + 1) {
                rangeEnd = slot;
            } else {
                upload(rangeStart, rangeEnd);
                rangeStart = slot;
                rangeEnd = slot;
            }
        }
        upload(rangeStart, rangeEnd);
    }

    #isOverflowDegradedState() {
        return this.state === 'overflow-degraded'
            || this.state === 'contact-overflow-degraded'
            || this.state === 'event-overflow-degraded';
    }

    #ensureReady() {
        if (this.destroyed
            || this.requiresAuthoritativeRebuild
            || this.#isOverflowDegradedState()) {
            return false;
        }
        return (this.state === 'ready'
            || this.state === 'telemetry-backpressure'
            || this.state === 'event-backpressure')
            && this.#hasCurrentGpuResources()
            ? true
            : this.init();
    }

    #hasCurrentGpuResources() {
        return Boolean(
            this.device
            && this.buffers
            && this.flowTexture
            && this.flowIntegrationTexture
            && this.bindGroups
            && this.pipelines
            && this.device === this.platform.getDevice()
            && this.deviceGeneration === this.platform.getDeviceGeneration()
        );
    }

    #writeTowerGameplayTargetConfig() {
        const abi = GPU_FIXED_PRIMITIVE_ABI.TOWER_GAMEPLAY_TARGET_CONFIG;
        const view = new DataView(this.towerGameplayTargetConfigBytes);
        const enabled = this.towerGameplayTargetHandle
            && this.towerGameplayTargetSlot >= 0;
        view.setUint32(
            abi.TARGET_SLOT,
            enabled
                ? this.towerGameplayTargetSlot
                : GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT,
            LITTLE_ENDIAN
        );
        view.setUint32(
            abi.ENTITY_ID,
            enabled
                ? this.towerGameplayTargetHandle.entityId
                : GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT,
            LITTLE_ENDIAN
        );
        view.setUint32(
            abi.INCARNATION,
            enabled
                ? this.towerGameplayTargetHandle.incarnation
                : GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT,
            LITTLE_ENDIAN
        );
        view.setUint32(abi.ENABLED, enabled ? 1 : 0, LITTLE_ENDIAN);
        if (this.#hasCurrentGpuResources()) {
            this.device.queue.writeBuffer(
                this.buffers.towerGameplayTargetConfig,
                0,
                this.towerGameplayTargetConfigBytes
            );
        }
    }

    #invalidateTowerGameplayTarget() {
        this.towerGameplayTargetHandle = null;
        this.towerGameplayTargetSlot = -1;
        this.#writeTowerGameplayTargetConfig();
    }

    #writeTrackedPoseConfig() {
        const abi = GPU_FIXED_PRIMITIVE_ABI.TRACKED_POSE_CONFIG;
        const view = new DataView(this.trackedPoseConfigBytes);
        const enabled = this.trackedPoseHandle && this.trackedPoseSlot >= 0;
        view.setUint32(
            abi.SOURCE_SLOT,
            enabled ? this.trackedPoseSlot : 0,
            LITTLE_ENDIAN
        );
        view.setUint32(
            abi.ENTITY_ID,
            enabled
                ? this.trackedPoseHandle.entityId
                : GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT,
            LITTLE_ENDIAN
        );
        view.setUint32(
            abi.INCARNATION,
            enabled
                ? this.trackedPoseHandle.incarnation
                : GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT,
            LITTLE_ENDIAN
        );
        view.setUint32(abi.ENABLED, enabled ? 1 : 0, LITTLE_ENDIAN);
        if (this.#hasCurrentGpuResources()) {
            this.device.queue.writeBuffer(
                this.buffers.trackedPoseConfig,
                0,
                this.trackedPoseConfigBytes
            );
        }
    }

    #invalidateTrackedPose(reason) {
        this.trackedPoseRevision++;
        this.trackedPoseHandle = null;
        this.trackedPoseSlot = -1;
        this.latestTrackedPose = createInvalidTrackedPoseSnapshot(reason);
        this.#writeTrackedPoseConfig();
    }

    #hasFreeEventReadbackSlot() {
        return this.eventReadbackSlots.some((slot) => !slot.inFlight);
    }

    #claimSpawnProgramReadbackSlot() {
        const slotCount = this.spawnProgramReadbackSlots.length;
        for (let offset = 0; offset < slotCount; offset++) {
            const index = (this.spawnProgramReadbackCursor + offset) % slotCount;
            const slot = this.spawnProgramReadbackSlots[index];
            if (slot.inFlight) {
                continue;
            }
            slot.inFlight = true;
            this.pendingSpawnProgramReadbacks++;
            this.spawnProgramReadbackCursor = (index + 1) % slotCount;
            return slot;
        }
        return null;
    }

    #releaseClaimedSpawnProgramReadbackSlot(slot) {
        if (!slot?.inFlight) {
            return;
        }
        slot.inFlight = false;
        this.pendingSpawnProgramReadbacks = Math.max(
            0,
            this.pendingSpawnProgramReadbacks - 1
        );
    }

    #beginSpawnProgramReadback(slot, queueEntry, lease) {
        slot.lease = lease;
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            const leaseMatches = !this.destroyed
                && lease === this.spawnProgramReadbackLease
                && slot.lease === lease;
            const generationMatches = queueEntry.deviceGeneration === this.deviceGeneration;
            const epochMatches = queueEntry.authoritativeEpoch === this.authoritativeEpoch;
            if (!leaseMatches || !generationMatches || !epochMatches) {
                try {
                    slot.buffer.unmap();
                } catch {
                    // retired resource may already be unmapped
                }
                if (leaseMatches) {
                    this.#releaseClaimedSpawnProgramReadbackSlot(slot);
                    const index = this.spawnProgramBatchQueue.indexOf(queueEntry);
                    if (index >= 0) {
                        this.spawnProgramBatchQueue.splice(index, 1);
                    }
                    this.#completeDeferredIdleRelease();
                } else {
                    slot.inFlight = false;
                }
                return;
            }

            let outcomes = null;
            let failure = null;
            try {
                const mapped = slot.buffer.getMappedRange();
                const view = new DataView(mapped);
                const headerAbi = GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER;
                const abiVersion = view.getUint32(
                    headerAbi.ABI_VERSION,
                    LITTLE_ENDIAN
                );
                const count = view.getUint32(headerAbi.COUNT, LITTLE_ENDIAN);
                const capacity = view.getUint32(headerAbi.CAPACITY, LITTLE_ENDIAN);
                const status = view.getUint32(headerAbi.STATUS, LITTLE_ENDIAN);
                if (abiVersion !== GPU_SPAWN_PROGRAM_ABI_VERSION
                    || count !== queueEntry.programs.length
                    || capacity !== this.spawnProgramCapacity
                    || status !== GPU_FIXED_PROGRAM_STATUS.OK) {
                    throw new RangeError(
                        `SpawnProgram result header mismatch: version=${abiVersion}, count=${count}, capacity=${capacity}, status=${status}`
                    );
                }
                const mappedStorage = {
                    capacity: this.spawnProgramCapacity,
                    buffer: mapped
                };
                readGpuSpawnProgramHeader(mappedStorage);
                outcomes = new Array(count);
                for (let index = 0; index < count; index++) {
                    const record = readGpuSpawnProgramRecord(mappedStorage, index);
                    const expected = queueEntry.programs[index];
                    const isTargetEntity = expected.modeFlags
                        === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY;
                    const isSelectedTarget = expected.modeFlags
                        === GPU_SPAWN_PROGRAM_MODE
                            .SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET;
                    let expectedTargetSlot = isTargetEntity
                        ? expected.targetSlot
                        : GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT;
                    let expectedTargetEntityId = isTargetEntity
                        ? expected.targetHandle.entityId
                        : GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT;
                    let expectedTargetIncarnation = isTargetEntity
                        ? expected.targetHandle.incarnation
                        : GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT;
                    let selectedTargetKind = 'none';
                    let selectedTargetHandle = null;
                    if (isSelectedTarget
                        && record.result === GPU_SPAWN_PROGRAM_RESULT.RESOLVED) {
                        if (record.selectedTargetKind
                            === GPU_BODY_CONTROL_SELECTED_TARGET_KIND.CORE) {
                            selectedTargetKind = 'core';
                            selectedTargetHandle = expected.coreTargetHandle;
                        } else if (record.selectedTargetKind
                            === GPU_BODY_CONTROL_SELECTED_TARGET_KIND.TOWER) {
                            selectedTargetKind = 'tower';
                            selectedTargetHandle = expected.towerTargetHandle;
                        }
                        if (!selectedTargetHandle) {
                            throw new RangeError(
                                `selected SpawnProgram target kind가 authored candidate와 다릅니다: index=${index}`
                            );
                        }
                        expectedTargetSlot = selectedTargetKind === 'core'
                            ? expected.coreTargetSlot
                            : expected.towerTargetSlot;
                        expectedTargetEntityId = selectedTargetHandle.entityId;
                        expectedTargetIncarnation = selectedTargetHandle.incarnation;
                    }
                    const resultIsAccepted = record.result
                            === GPU_SPAWN_PROGRAM_RESULT.RESOLVED
                        || record.result === GPU_SPAWN_PROGRAM_RESULT.SOURCE_INVALID
                        || (isTargetEntity
                            && record.result
                                === GPU_SPAWN_PROGRAM_RESULT.TARGET_INVALID)
                        || (isSelectedTarget
                            && (record.result === GPU_SPAWN_PROGRAM_RESULT.NO_TARGET
                                || record.result
                                    === GPU_SPAWN_PROGRAM_RESULT
                                        .CORE_TARGET_INVALID));
                    if (record.destinationSlot !== expected.destinationSlot
                        || record.destinationEntityId
                            !== expected.destinationHandle.entityId
                        || record.destinationIncarnation
                            !== expected.destinationHandle.incarnation
                        || record.sourceSlot !== expected.sourceSlot
                        || record.sourceEntityId !== expected.sourceHandle.entityId
                        || record.sourceIncarnation
                            !== expected.sourceHandle.incarnation
                        || record.targetSlot !== expectedTargetSlot
                        || record.targetEntityId !== expectedTargetEntityId
                        || record.targetIncarnation !== expectedTargetIncarnation
                        || record.modeFlags !== expected.modeFlags
                        || record.sourceTick !== queueEntry.sourceTick
                        || (isSelectedTarget
                            && (record.selectionSequence
                                    !== expected.selectionSequence
                                || record.attackFingerprint
                                    !== expected.attackFingerprint
                                || record.requestFlags
                                    !== GPU_SPAWN_PROGRAM_REQUEST_FLAGS
                                        .REQUIRE_EXACT_SELECTED_TARGET))
                        || (!isSelectedTarget
                            && record.selectedTargetKind
                                !== GPU_BODY_CONTROL_SELECTED_TARGET_KIND.NONE)
                        || (!isSelectedTarget
                            && record.requestFlags !== expected.requestFlags)
                        || (isSelectedTarget
                            && record.result !== GPU_SPAWN_PROGRAM_RESULT.RESOLVED
                            && record.selectedTargetKind
                                !== GPU_BODY_CONTROL_SELECTED_TARGET_KIND.NONE)
                        || !resultIsAccepted) {
                        throw new RangeError(
                            `SpawnProgram result record mismatch: index=${index}, result=${record.result}`
                        );
                    }
                    let reason = 'resolved';
                    if (record.result === GPU_SPAWN_PROGRAM_RESULT.SOURCE_INVALID) {
                        reason = 'source-invalid';
                    } else if (record.result
                        === GPU_SPAWN_PROGRAM_RESULT.TARGET_INVALID) {
                        reason = 'target-invalid';
                    } else if (record.result
                        === GPU_SPAWN_PROGRAM_RESULT.NO_TARGET) {
                        reason = 'no-target';
                    } else if (record.result
                        === GPU_SPAWN_PROGRAM_RESULT.CORE_TARGET_INVALID) {
                        reason = 'core-invalid';
                    }
                    outcomes[index] = Object.freeze({
                        destinationSlot: record.destinationSlot,
                        destinationHandle: expected.destinationHandle,
                        sourceHandle: expected.sourceHandle,
                        ...((isTargetEntity || isSelectedTarget)
                            ? { targetHandle: isTargetEntity
                                ? expected.targetHandle
                                : selectedTargetHandle }
                            : {}),
                        ...(isSelectedTarget ? { selectedTargetKind } : {}),
                        result: record.result,
                        reason
                    });
                }
                outcomes = Object.freeze(outcomes);
            } catch (error) {
                failure = captureFailure('spawn-program-readback', error);
            } finally {
                slot.buffer.unmap();
            }
            this.#releaseClaimedSpawnProgramReadbackSlot(slot);
            queueEntry.outcomes = outcomes;
            queueEntry.failure = failure;
            queueEntry.completed = true;
            if (failure) {
                this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
                this.failure = failure;
                this.state = this.requiresAuthoritativeRebuild
                    ? 'requires-rebuild'
                    : 'failed';
            }
            this.#completeDeferredIdleRelease();
        }).catch((error) => {
            if (this.destroyed
                || lease !== this.spawnProgramReadbackLease
                || slot.lease !== lease) {
                slot.inFlight = false;
                return;
            }
            this.#releaseClaimedSpawnProgramReadbackSlot(slot);
            queueEntry.failure = captureFailure('spawn-program-readback', error);
            queueEntry.completed = true;
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            this.failure = queueEntry.failure;
            this.state = this.requiresAuthoritativeRebuild
                ? 'requires-rebuild'
                : 'failed';
            this.#completeDeferredIdleRelease();
        });
    }

    #claimFormationPrepareReadbackSlot() {
        for (let offset = 0;
            offset < this.formationPrepareReadbackSlots.length;
            offset++) {
            const index = (this.formationPrepareReadbackCursor + offset)
                % this.formationPrepareReadbackSlots.length;
            const slot = this.formationPrepareReadbackSlots[index];
            if (slot.inFlight) { continue; }
            slot.inFlight = true;
            this.pendingFormationPrepareReadbacks++;
            this.formationPrepareReadbackCursor = (index + 1)
                % this.formationPrepareReadbackSlots.length;
            return slot;
        }
        return null;
    }

    #releaseClaimedFormationPrepareReadbackSlot(slot) {
        if (!slot?.inFlight) { return; }
        slot.inFlight = false;
        this.pendingFormationPrepareReadbacks = Math.max(
            0,
            this.pendingFormationPrepareReadbacks - 1
        );
    }

    #claimFormationTransformReadbackSlot() {
        for (let offset = 0;
            offset < this.formationTransformReadbackSlots.length;
            offset++) {
            const index = (this.formationTransformReadbackCursor + offset)
                % this.formationTransformReadbackSlots.length;
            const slot = this.formationTransformReadbackSlots[index];
            if (slot.inFlight) { continue; }
            slot.inFlight = true;
            this.pendingFormationTransformReadbacks++;
            this.formationTransformReadbackCursor = (index + 1)
                % this.formationTransformReadbackSlots.length;
            return slot;
        }
        return null;
    }

    #releaseClaimedFormationTransformReadbackSlot(slot) {
        if (!slot?.inFlight) { return; }
        slot.inFlight = false;
        this.pendingFormationTransformReadbacks = Math.max(
            0,
            this.pendingFormationTransformReadbacks - 1
        );
    }

    #retireFormationReadbacks() {
        this.formationPrepareReadbackLease++;
        this.formationTransformReadbackLease++;
        for (const slot of this.formationPrepareReadbackSlots) {
            slot.inFlight = false;
        }
        for (const slot of this.formationTransformReadbackSlots) {
            slot.inFlight = false;
        }
        this.pendingFormationPrepareReadbacks = 0;
        this.pendingFormationTransformReadbacks = 0;
        this.formationPrepareBatchQueue.length = 0;
    }

    #beginFormationPrepareReadback(slot, queueEntry, lease) {
        const generation = queueEntry.deviceGeneration;
        const authoritativeEpoch = queueEntry.authoritativeEpoch;
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            if (!slot.inFlight || slot.lease !== lease
                || this.formationPrepareReadbackLease !== lease
                || this.deviceGeneration !== generation
                || this.authoritativeEpoch !== authoritativeEpoch) {
                try { slot.buffer.unmap(); } catch { /* retired */ }
                this.#releaseClaimedFormationPrepareReadbackSlot(slot);
                return;
            }
            try {
                const bytes = slot.buffer.getMappedRange().slice(0);
                const storage = { buffer: bytes, view: new DataView(bytes) };
                const header = readGpuFormationPrepareProgramHeader(storage);
                if (header.abiVersion !== GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION
                    || header.count !== queueEntry.records.length
                    || header.resultCount !== header.count
                    || header.batchIdFingerprint !== queueEntry.batchIdFingerprint
                    || header.sourceTick !== queueEntry.sourceTick) {
                    throw new RangeError('Formation prepare header provenance mismatch');
                }
                const results = [];
                for (let index = 0; index < header.count; index++) {
                    const result = readGpuFormationPrepareProgramRecord(
                        storage,
                        index
                    );
                    const expected = queueEntry.records[index];
                    if (result.sourceSlot !== expected.sourceSlot
                        || result.sourceEntityId !== expected.sourceEntityId
                        || result.sourceIncarnation !== expected.sourceIncarnation
                        || result.sourceTick !== expected.sourceTick
                        || result.prepareSequence !== expected.prepareSequence
                        || result.fingerprint !== expected.fingerprint
                        || result.flags !== expected.flags) {
                        throw new RangeError(
                            `Formation prepare record provenance mismatch: ${index}`
                        );
                    }
                    const allowsLifecycleRemoval = (expected.flags
                        & GPU_FORMATION_PREPARE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID) !== 0;
                    if (result.result === GPU_FORMATION_PREPARE_RESULT.SOURCE_INVALID) {
                        const expectedReason = allowsLifecycleRemoval
                            ? GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON
                                .LIFECYCLE_REMOVED
                            : GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON
                                .DIED_AFTER_STAGE;
                        if (result.sourceInvalidReason !== expectedReason
                            || (!allowsLifecycleRemoval
                                && expected.sourceSlot
                                    === GPU_FORMATION_IDENTITY_INVALID)) {
                            throw new RangeError(
                                'unauthorized Formation SOURCE_INVALID provenance'
                            );
                        }
                    } else if (result.sourceInvalidReason
                        !== GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.NONE) {
                        throw new RangeError(
                            'live Formation result에 SOURCE_INVALID reason이 있습니다.'
                        );
                    }
                    const { sourceSlot: _privateSlot, ...publicResult } = result;
                    results.push(Object.freeze({
                        programIndex: index,
                        ...publicResult
                    }));
                }
                let pairCount = 0;
                for (const result of results) {
                    if (result.result !== GPU_FORMATION_PREPARE_RESULT.MUTUAL_PAIR) {
                        continue;
                    }
                    const pair = results[result.pairProgramIndex];
                    if (!pair
                        || pair.result !== GPU_FORMATION_PREPARE_RESULT.MUTUAL_PAIR
                        || pair.pairProgramIndex !== result.programIndex
                        || pair.sourceEntityId !== result.pairEntityId
                        || pair.sourceIncarnation !== result.pairIncarnation
                        || pair.pairEntityId !== result.sourceEntityId
                        || pair.pairIncarnation !== result.sourceIncarnation
                        || pair.destinationMemberCount
                            !== result.destinationMemberCount
                        || pair.destinationOccupiedSlotMask
                            !== result.destinationOccupiedSlotMask
                        || pair.destinationRotationStep
                            !== result.destinationRotationStep
                        || pair.expectedMergedCurrentHealthCenti
                            !== result.expectedMergedCurrentHealthCenti
                        || pair.expectedMergedMaxHealthCenti
                            !== result.expectedMergedMaxHealthCenti
                        || pair.rootProgramIndex !== result.rootProgramIndex
                        || pair.motionRootProgramIndex
                            !== result.motionRootProgramIndex) {
                        throw new RangeError('Formation mutual pair mirror mismatch');
                    }
                    if (result.programIndex === result.rootProgramIndex) {
                        pairCount++;
                    }
                }
                if (pairCount !== header.pairCount) {
                    throw new RangeError('Formation prepare pairCount mismatch');
                }
                const completion = Object.freeze({
                    abiVersion: GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
                    sessionGeneration: queueEntry.sessionGeneration,
                    deviceGeneration: generation,
                    authoritativeEpoch,
                    previousSourceTick: queueEntry.previousSourceTick,
                    previousSubmittedTick: queueEntry.previousSubmittedTick,
                    sourceTick: queueEntry.sourceTick,
                    submittedTick: queueEntry.submittedTick,
                    completedThroughTick: queueEntry.sourceTick,
                    batchIdFingerprint: queueEntry.batchIdFingerprint,
                    programCount: header.count,
                    resultCount: header.resultCount,
                    pairCount: header.pairCount,
                    gridSmallOverflow: header.gridSmallOverflow,
                    gridBigOverflow: header.gridBigOverflow,
                    results: Object.freeze(results),
                    status: header.status
                });
                queueEntry.completion = completion;
                queueEntry.completed = true;
                this.lastFormationPrepareCompletedTick = queueEntry.sourceTick;
                this.lastFormationRuntimeStatus = header.status;
                if (header.status === GPU_FORMATION_RUNTIME_STATUS.OK) {
                    this.authenticFormationPrepareByKey.set(
                        `${queueEntry.batchIdFingerprint}:${queueEntry.sourceTick}`,
                        completion
                    );
                } else {
                    this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
                    this.failure = captureFailure(
                        'formation-prepare-status',
                        new Error(`GPU Formation prepare status=${header.status}`)
                    );
                }
            } catch (error) {
                queueEntry.failure = captureFailure(
                    'formation-prepare-readback',
                    error
                );
                queueEntry.completed = true;
                this.requiresAuthoritativeRebuild = true;
                this.failure = queueEntry.failure;
            } finally {
                slot.buffer.unmap();
                this.#releaseClaimedFormationPrepareReadbackSlot(slot);
            }
        }).catch((error) => {
            queueEntry.failure = captureFailure('formation-prepare-map', error);
            queueEntry.completed = true;
            this.#releaseClaimedFormationPrepareReadbackSlot(slot);
        });
    }

    #beginFormationTransformReadback(slot, queueEntry, lease) {
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            if (!slot.inFlight || slot.lease !== lease
                || this.formationTransformReadbackLease !== lease
                || this.deviceGeneration !== queueEntry.deviceGeneration
                || this.authoritativeEpoch !== queueEntry.authoritativeEpoch) {
                try { slot.buffer.unmap(); } catch { /* retired */ }
                this.#releaseClaimedFormationTransformReadbackSlot(slot);
                return;
            }
            try {
                const bytes = slot.buffer.getMappedRange().slice(0);
                const storage = { buffer: bytes, view: new DataView(bytes) };
                const header = readGpuFormationTransformProgramHeader(storage);
                if (header.abiVersion !== GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION
                    || header.count !== queueEntry.records.length
                    || header.batchIdFingerprint !== queueEntry.batchIdFingerprint
                    || header.preparedSourceTick !== queueEntry.preparedSourceTick
                    || header.targetFixedTick !== queueEntry.targetFixedTick) {
                    throw new RangeError('Formation transform header provenance mismatch');
                }
                const results = [];
                let preparedEffectCount = 0;
                let actualEffectCount = 0;
                for (let index = 0; index < header.count; index++) {
                    const result = readGpuFormationTransformProgramRecord(
                        storage,
                        index
                    );
                    const expected = queueEntry.records[index];
                    if (result.fingerprint !== expected.fingerprint
                        || result.prepareBatchFingerprint
                            !== expected.prepareBatchFingerprint
                        || result.sourceA.entityId !== expected.sourceA.entityId
                        || result.sourceA.incarnation
                            !== expected.sourceA.incarnation
                        || result.sourceB.entityId !== expected.sourceB.entityId
                        || result.sourceB.incarnation
                            !== expected.sourceB.incarnation
                        || result.destination.entityId
                            !== expected.destination.entityId
                        || result.destination.incarnation
                            !== expected.destination.incarnation) {
                        throw new RangeError(
                            `Formation transform record provenance mismatch: ${index}`
                        );
                    }
                    preparedEffectCount += result.preparedEffectRekeyCount;
                    actualEffectCount += result.effectRekeyCount;
                    const { slot: _sourceASlot, ...publicSourceA }
                        = result.sourceA;
                    const { slot: _sourceBSlot, ...publicSourceB }
                        = result.sourceB;
                    const publicResult = Object.freeze({
                        ...result,
                        sourceA: Object.freeze(publicSourceA),
                        sourceB: Object.freeze(publicSourceB)
                    });
                    results.push(publicResult);
                }
                if (preparedEffectCount !== actualEffectCount
                    || preparedEffectCount !== header.preparedEffectRekeyCount
                    || actualEffectCount !== header.effectRekeyCount
                    || (header.status === GPU_FORMATION_RUNTIME_STATUS.OK
                        && (header.batchAccepted !== 1
                            || header.committedCount !== header.count
                            || results.some((result) => result.result
                                !== GPU_FORMATION_TRANSFORM_RESULT.COMMITTED)))) {
                    throw new RangeError('Formation transform completion count mismatch');
                }
                const completion = Object.freeze({
                    abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
                    sessionGeneration: queueEntry.sessionGeneration,
                    deviceGeneration: queueEntry.deviceGeneration,
                    authoritativeEpoch: queueEntry.authoritativeEpoch,
                    preparedSourceTick: queueEntry.preparedSourceTick,
                    sourceTick: queueEntry.targetFixedTick,
                    submittedTick: queueEntry.submittedTick,
                    completedThroughTick: queueEntry.targetFixedTick,
                    batchIdFingerprint: queueEntry.batchIdFingerprint,
                    programCount: header.count,
                    committedCount: header.committedCount,
                    preparedEffectRekeyCount: header.preparedEffectRekeyCount,
                    effectRekeyCount: header.effectRekeyCount,
                    status: header.status,
                    results: Object.freeze(results)
                });
                this.lastFormationTransformCompletion = completion;
                this.lastFormationRuntimeStatus = header.status;
                this.lastFormationCommittedCount = header.committedCount;
                this.lastFormationEffectRekeyCount = header.effectRekeyCount;
                this.lastFormationTransformCommittedTick
                    = queueEntry.targetFixedTick;
                if (header.status !== GPU_FORMATION_RUNTIME_STATUS.OK) {
                    this.requiresAuthoritativeRebuild = true;
                    this.failure = captureFailure(
                        'formation-transform-status',
                        new Error(`GPU Formation transform status=${header.status}`)
                    );
                }
            } catch (error) {
                this.requiresAuthoritativeRebuild = true;
                this.failure = captureFailure('formation-transform-readback', error);
            } finally {
                slot.buffer.unmap();
                this.#releaseClaimedFormationTransformReadbackSlot(slot);
            }
        }).catch((error) => {
            this.requiresAuthoritativeRebuild = true;
            this.failure = captureFailure('formation-transform-map', error);
            this.#releaseClaimedFormationTransformReadbackSlot(slot);
        });
    }

    #claimAtomicTransformPrepareReadbackSlot() {
        for (let offset = 0;
            offset < this.atomicTransformPrepareReadbackSlots.length;
            offset++) {
            const index = (this.atomicTransformPrepareReadbackCursor + offset)
                % this.atomicTransformPrepareReadbackSlots.length;
            const slot = this.atomicTransformPrepareReadbackSlots[index];
            if (slot.inFlight) { continue; }
            slot.inFlight = true;
            slot.lease = this.atomicTransformPrepareReadbackLease;
            this.pendingAtomicTransformPrepareReadbacks++;
            this.atomicTransformPrepareReadbackCursor = (index + 1)
                % this.atomicTransformPrepareReadbackSlots.length;
            return slot;
        }
        return null;
    }

    #releaseClaimedAtomicTransformPrepareReadbackSlot(slot) {
        if (!slot?.inFlight) { return; }
        slot.inFlight = false;
        this.pendingAtomicTransformPrepareReadbacks = Math.max(
            0,
            this.pendingAtomicTransformPrepareReadbacks - 1
        );
    }

    #claimAtomicTransformReadbackSlot() {
        for (let offset = 0;
            offset < this.atomicTransformReadbackSlots.length;
            offset++) {
            const index = (this.atomicTransformReadbackCursor + offset)
                % this.atomicTransformReadbackSlots.length;
            const slot = this.atomicTransformReadbackSlots[index];
            if (slot.inFlight) { continue; }
            slot.inFlight = true;
            slot.lease = this.atomicTransformReadbackLease;
            this.pendingAtomicTransformReadbacks++;
            this.atomicTransformReadbackCursor = (index + 1)
                % this.atomicTransformReadbackSlots.length;
            return slot;
        }
        return null;
    }

    #releaseClaimedAtomicTransformReadbackSlot(slot) {
        if (!slot?.inFlight) { return; }
        slot.inFlight = false;
        this.pendingAtomicTransformReadbacks = Math.max(
            0,
            this.pendingAtomicTransformReadbacks - 1
        );
    }

    #retireAtomicTransformReadbacks(preservedTransformSlot = null) {
        this.atomicTransformPrepareReadbackLease++;
        for (const slot of this.atomicTransformPrepareReadbackSlots) {
            slot.inFlight = false;
            slot.lease = this.atomicTransformPrepareReadbackLease;
        }
        this.pendingAtomicTransformPrepareReadbacks = 0;
        this.atomicTransformPrepareBatchQueue.length = 0;
        // Registry/host publication already occurred for every claimed transform
        // slot. Preserve all earlier submitted readbacks across terminal close;
        // otherwise a late GPU mismatch could be hidden behind pending=0.
        if (preservedTransformSlot) {
            preservedTransformSlot.inFlight = true;
            preservedTransformSlot.lease = this.atomicTransformReadbackLease;
        }
        this.pendingAtomicTransformReadbacks
            = this.atomicTransformReadbackSlots.reduce(
                (count, slot) => count + Number(slot.inFlight),
                0
            );
    }

    #beginAtomicTransformPrepareReadback(slot, queueEntry, lease) {
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            if (!slot.inFlight || slot.lease !== lease
                || this.atomicTransformPrepareReadbackLease !== lease
                || this.deviceGeneration !== queueEntry.deviceGeneration
                || this.authoritativeEpoch !== queueEntry.authoritativeEpoch) {
                try { slot.buffer.unmap(); } catch { /* retired */ }
                this.#releaseClaimedAtomicTransformPrepareReadbackSlot(slot);
                return;
            }
            try {
                const bytes = slot.buffer.getMappedRange().slice(0);
                const storage = {
                    capacity: this.atomicTransformPrepareCapacity,
                    buffer: bytes,
                    view: new DataView(bytes)
                };
                const header = readGpuAtomicTransformPrepareHeader(storage);
                if (header.abiVersion
                        !== GPU_ATOMIC_TRANSFORM_PREPARE_PROGRAM_ABI_VERSION
                    || header.capacity !== this.atomicTransformPrepareCapacity
                    || header.sourceTick !== queueEntry.sourceTick
                    || header.targetFixedTick !== queueEntry.targetFixedTick
                    || header.batchIdFingerprint
                        !== queueEntry.batchIdFingerprint
                    || header.recordCount > header.capacity
                    || header.status !== GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.OK) {
                    throw new RangeError(
                        `AtomicTransform prepare header mismatch/status=${header.status}`
                    );
                }
                const records = [];
                const seenSources = new Set();
                for (let index = 0; index < header.recordCount; index++) {
                    const record = readGpuAtomicTransformPrepareRecord(
                        storage,
                        index
                    );
                    const sourceKey = `${record.sourceEntityId}:${record.sourceIncarnation}`;
                    const split = record.topologyCode
                        === GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_MANY;
                    const delayed = record.topologyCode
                        === GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_ONE_DELAYED;
                    const splitStateIsExact = split
                        && record.programId
                            === GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM
                                .J_SPLIT_FIRST_HIT
                        && record.phase
                            === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.SPLIT_PENDING
                        && record.dueFixedTick === 0
                        && record.triggerSourceTick > 0
                        && record.triggerSourceTick < UINT32_MAX
                        && record.triggerSequence < UINT32_MAX;
                    const delayedStateIsExact = delayed
                        && record.programId
                            === GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM
                                .C_PRIME_DELAYED_RECOMBINE
                        && record.phase
                            === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.CHILD_DELAYED
                        && record.dueFixedTick > 0
                        && record.dueFixedTick < UINT32_MAX
                        && record.dueFixedTick <= header.targetFixedTick
                        && record.triggerSourceTick === 0
                        && record.triggerSequence === 0;
                    if ((!split && !delayed)
                        || (!splitStateIsExact && !delayedStateIsExact)
                        || seenSources.has(sourceKey)
                        || record.sourceEntityId <= 0
                        || record.sourceEntityId >= UINT32_MAX
                        || record.sourceIncarnation <= 0
                        || record.sourceIncarnation >= UINT32_MAX
                        || record.lineageRootEntityId <= 0
                        || record.lineageRootEntityId >= UINT32_MAX
                        || record.lineageRootIncarnation <= 0
                        || record.lineageRootIncarnation >= UINT32_MAX
                        || record.branchIndex > 1
                        || record.commandGeneration <= 0
                        || record.commandGeneration >= UINT32_MAX
                        || record.currentHealthFixedPoint <= 0
                        || record.maxHealthFixedPoint <= 0
                        || record.currentHealthFixedPoint
                            > record.maxHealthFixedPoint
                        || record.result
                            !== GPU_ATOMIC_TRANSFORM_PREPARE_RESULT.AUTHENTIC
                        || record.recordFingerprint <= 0
                        || record.recordFingerprint >= UINT32_MAX) {
                        throw new RangeError(
                            `AtomicTransform prepare record invalid: ${index}`
                        );
                    }
                    seenSources.add(sourceKey);
                    records.push(Object.freeze({
                        topologyId: split
                            ? 'ONE_TO_MANY'
                            : 'ONE_TO_ONE_DELAYED',
                        sourceSlot: record.sourceSlot,
                        sourceEntityId: record.sourceEntityId,
                        sourceIncarnation: record.sourceIncarnation,
                        sourceHandle: Object.freeze({
                            entityId: record.sourceEntityId,
                            incarnation: record.sourceIncarnation
                        }),
                        programId: record.programId,
                        phase: record.phase,
                        dueFixedTick: record.dueFixedTick,
                        lineageRootEntityId: record.lineageRootEntityId,
                        lineageRootIncarnation:
                            record.lineageRootIncarnation,
                        branchIndex: record.branchIndex,
                        bountyBudget: record.bountyBudget,
                        commandGeneration: record.commandGeneration,
                        currentHealthFixedPoint:
                            record.currentHealthFixedPoint,
                        maxHealthFixedPoint: record.maxHealthFixedPoint,
                        triggerSourceTick: record.triggerSourceTick,
                        triggerSequence: record.triggerSequence,
                        recordFingerprint: record.recordFingerprint
                    }));
                }
                const completion = Object.freeze({
                    abiVersion:
                        GPU_ATOMIC_TRANSFORM_PREPARE_PROGRAM_ABI_VERSION,
                    sessionGeneration: queueEntry.sessionGeneration,
                    deviceGeneration: queueEntry.deviceGeneration,
                    authoritativeEpoch: queueEntry.authoritativeEpoch,
                    submittedTick: queueEntry.submittedTick,
                    sourceTick: queueEntry.sourceTick,
                    targetFixedTick: queueEntry.targetFixedTick,
                    batchIdFingerprint: queueEntry.batchIdFingerprint,
                    status: header.status,
                    records: Object.freeze(records)
                });
                queueEntry.completion = completion;
                queueEntry.completed = true;
                if (this.authenticAtomicTransformPrepareByFingerprint.size
                        >= this.atomicTransformPrepareCapacity
                    && !this.authenticAtomicTransformPrepareByFingerprint.has(
                        queueEntry.batchIdFingerprint
                    )) {
                    throw new RangeError(
                        'AtomicTransform backend authentic proof capacity를 초과했습니다.'
                    );
                }
                this.authenticAtomicTransformPrepareByFingerprint.set(
                    queueEntry.batchIdFingerprint,
                    completion
                );
                this.lastAtomicTransformPrepareSourceTick
                    = queueEntry.sourceTick;
                this.lastAtomicTransformRuntimeStatus = header.status;
            } catch (error) {
                queueEntry.failure = captureFailure(
                    'atomic-transform-prepare-readback',
                    error
                );
                queueEntry.completed = true;
                this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
                this.failure = queueEntry.failure;
            } finally {
                slot.buffer.unmap();
                this.#releaseClaimedAtomicTransformPrepareReadbackSlot(slot);
            }
        }).catch((error) => {
            if (this.destroyed || slot.lease !== lease
                || this.atomicTransformPrepareReadbackLease !== lease) {
                slot.inFlight = false;
                return;
            }
            queueEntry.failure = captureFailure(
                'atomic-transform-prepare-map',
                error
            );
            queueEntry.completed = true;
            this.requiresAuthoritativeRebuild = true;
            this.failure = queueEntry.failure;
            this.#releaseClaimedAtomicTransformPrepareReadbackSlot(slot);
        });
    }

    #beginAtomicTransformReadback(slot, queueEntry, lease) {
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            let readbackFailure = null;
            if (!slot.inFlight || slot.lease !== lease
                || this.atomicTransformReadbackLease !== lease
                || this.deviceGeneration !== queueEntry.deviceGeneration
                || this.authoritativeEpoch !== queueEntry.authoritativeEpoch) {
                try { slot.buffer.unmap(); } catch { /* retired */ }
                this.#releaseClaimedAtomicTransformReadbackSlot(slot);
                return;
            }
            try {
                const bytes = slot.buffer.getMappedRange().slice(0);
                const storage = {
                    capacity: this.atomicTransformCapacity,
                    buffer: bytes,
                    view: new DataView(bytes)
                };
                const header = readGpuAtomicTransformProgramHeader(storage);
                if (header.abiVersion !== GPU_ATOMIC_TRANSFORM_PROGRAM_ABI_VERSION
                    || header.capacity !== this.atomicTransformCapacity
                    || header.count > header.capacity
                    || header.count !== queueEntry.expectedCount
                    || header.batchIdFingerprint
                        !== queueEntry.batchIdFingerprint
                    || header.preparedSourceTick !== queueEntry.sourceTick
                    || header.targetFixedTick !== queueEntry.targetFixedTick
                    || header.status !== GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.OK
                    || header.batchAccepted !== 1
                    || header.committedCount !== header.count
                    || header.failureRecordIndex !== UINT32_MAX
                    || header.expectedEffectRekeyCount
                        !== header.effectRekeyCount) {
                    throw new RangeError(
                        `AtomicTransform completion header mismatch/status=${header.status}`
                    );
                }
                let recordEffectCount = 0;
                for (let index = 0; index < header.count; index++) {
                    const actual = readGpuAtomicTransformProgramRecord(
                        storage,
                        index
                    );
                    const expected = queueEntry.records[index];
                    if (actual.topologyCode !== expected.topologyCode
                        || actual.sourceSlot !== expected.sourceSlot
                        || actual.sourceEntityId !== expected.sourceEntityId
                        || actual.sourceIncarnation
                            !== expected.sourceIncarnation
                        || actual.destinationCount
                            !== expected.destinationHandles.length
                        || actual.effectTransferDestinationIndex !== 0
                        || actual.prepareRecordFingerprint
                            !== expected.prepareRecordFingerprint
                        || actual.commandGeneration
                            !== expected.commandGeneration
                        || actual.sourceCurrentHealthFixedPoint
                            !== expected.sourceCurrentHealthFixedPoint
                        || actual.sourceMaxHealthFixedPoint
                            !== expected.sourceMaxHealthFixedPoint
                        || actual.triggerSourceTick
                            !== expected.triggerSourceTick
                        || actual.triggerSequence
                            !== expected.triggerSequence
                        || actual.result
                            !== GPU_ATOMIC_TRANSFORM_RESULT.COMMITTED) {
                        throw new RangeError(
                            `AtomicTransform completion record mismatch: ${index}`
                        );
                    }
                    for (let destinationIndex = 0;
                        destinationIndex < expected.destinationHandles.length;
                        destinationIndex++) {
                        const actualHandle = actual.destinationHandles[
                            destinationIndex
                        ];
                        const expectedHandle = expected.destinationHandles[
                            destinationIndex
                        ];
                        if (actualHandle.slot !== expectedHandle.slot
                            || actualHandle.entityId !== expectedHandle.entityId
                            || actualHandle.incarnation
                                !== expectedHandle.incarnation) {
                            throw new RangeError(
                                `AtomicTransform destination mismatch: ${index}:${destinationIndex}`
                            );
                        }
                    }
                    const unusedDestination = actual.destinationHandles[1];
                    if (expected.destinationHandles.length === 1
                        && (unusedDestination.slot !== UINT32_MAX
                            || unusedDestination.entityId !== UINT32_MAX
                            || unusedDestination.incarnation !== UINT32_MAX)) {
                        throw new RangeError(
                            `AtomicTransform unused destination mismatch: ${index}`
                        );
                    }
                    recordEffectCount += actual.effectRekeyCount;
                }
                if (recordEffectCount !== header.effectRekeyCount) {
                    throw new RangeError(
                        'AtomicTransform per-record Effect count mismatch'
                    );
                }
                this.lastAtomicTransformRuntimeStatus = header.status;
                this.lastAtomicTransformCommittedCount = header.committedCount;
                this.lastAtomicTransformEffectRekeyCount
                    = header.effectRekeyCount;
            } catch (error) {
                readbackFailure = captureFailure(
                    'atomic-transform-readback',
                    error
                );
                this.requiresAuthoritativeRebuild = true;
                this.failure = readbackFailure;
            } finally {
                slot.buffer.unmap();
                this.#releaseClaimedAtomicTransformReadbackSlot(slot);
                this.#completeDeferredIdleRelease();
            }
            const terminal = this.terminalAtomicTransformProgramCancelStatus;
            if (terminal?.state === 'submitted' || terminal?.state === 'armed') {
                this.terminalAtomicTransformProgramCancelStatus = Object.freeze({
                    ...terminal,
                    state: readbackFailure ? 'failed' : terminal.state,
                    pendingReadbackCount:
                        this.pendingAtomicTransformReadbacks,
                    failure: readbackFailure
                });
            }
        }).catch((error) => {
            if (this.destroyed || slot.lease !== lease
                || this.atomicTransformReadbackLease !== lease) {
                slot.inFlight = false;
                return;
            }
            const failure = captureFailure('atomic-transform-map', error);
            this.requiresAuthoritativeRebuild = true;
            this.failure = failure;
            this.#releaseClaimedAtomicTransformReadbackSlot(slot);
            this.#completeDeferredIdleRelease();
            const terminal = this.terminalAtomicTransformProgramCancelStatus;
            if (terminal?.state === 'submitted' || terminal?.state === 'armed') {
                this.terminalAtomicTransformProgramCancelStatus = Object.freeze({
                    ...terminal,
                    state: 'failed',
                    pendingReadbackCount:
                        this.pendingAtomicTransformReadbacks,
                    failure
                });
            }
        });
    }

    #claimEffectProgramReadbackSlot() {
        const slotCount = this.effectProgramReadbackSlots.length;
        for (let offset = 0; offset < slotCount; offset++) {
            const index = (this.effectProgramReadbackCursor + offset) % slotCount;
            const slot = this.effectProgramReadbackSlots[index];
            if (slot.inFlight) {
                continue;
            }
            slot.inFlight = true;
            this.pendingEffectReadbacks++;
            this.effectProgramReadbackCursor = (index + 1) % slotCount;
            return slot;
        }
        return null;
    }

    #releaseClaimedEffectProgramReadbackSlot(slot) {
        if (!slot?.inFlight) {
            return;
        }
        slot.inFlight = false;
        this.pendingEffectReadbacks = Math.max(
            0,
            this.pendingEffectReadbacks - 1
        );
    }

    #retireTerminalEffectReadbacks() {
        this.effectProgramReadbackLease++;
        this.stagedEffectPulseBatch = null;
        this.effectProgramBatchQueue.length = 0;
        for (const slot of this.effectProgramReadbackSlots) {
            slot.lease = this.effectProgramReadbackLease;
            slot.inFlight = false;
            try {
                slot.buffer.unmap();
            } catch {
                // already unmapped/retired
            }
        }
        this.pendingEffectReadbacks = 0;
    }

    #beginEffectProgramReadback(slot, queueEntry, lease) {
        slot.lease = lease;
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            const leaseMatches = !this.destroyed
                && lease === this.effectProgramReadbackLease
                && slot.lease === lease;
            const generationMatches = queueEntry.deviceGeneration
                === this.deviceGeneration;
            const epochMatches = queueEntry.authoritativeEpoch
                === this.authoritativeEpoch;
            if (!leaseMatches || !generationMatches || !epochMatches) {
                try {
                    slot.buffer.unmap();
                } catch {
                    // retired resource may already be unmapped
                }
                if (leaseMatches) {
                    this.#releaseClaimedEffectProgramReadbackSlot(slot);
                    const index = this.effectProgramBatchQueue.indexOf(queueEntry);
                    if (index >= 0) {
                        this.effectProgramBatchQueue.splice(index, 1);
                    }
                    this.#completeDeferredIdleRelease();
                } else {
                    slot.inFlight = false;
                }
                return;
            }

            let completion = null;
            let failure = null;
            try {
                const mapped = slot.buffer.getMappedRange();
                const poolBytes = mapped.slice(
                    EFFECT_READBACK_POOL_STATE_OFFSET,
                    EFFECT_READBACK_PROGRAM_OFFSET
                );
                const pool = readGpuEffectPoolState(poolBytes);
                const programByteLength = GPU_EFFECT_RUNTIME_ABI.PROGRAM_HEADER.STRIDE
                    + (this.effectPulseProgramCapacity
                        * GPU_EFFECT_RUNTIME_ABI.PULSE_PROGRAM_RECORD.STRIDE);
                const programView = new DataView(
                    mapped,
                    EFFECT_READBACK_PROGRAM_OFFSET,
                    programByteLength
                );
                const mappedProgram = {
                    buffer: mapped,
                    view: programView,
                    capacity: this.effectPulseProgramCapacity
                };
                const header = readGpuEffectPulseProgramHeader(mappedProgram);
                if (pool.abiVersion !== GPU_EFFECT_RUNTIME_ABI_VERSION
                    || header.abiVersion !== GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION
                    || header.count !== queueEntry.records.length
                    || header.capacity !== this.effectPulseProgramCapacity
                    || pool.sourceTick !== queueEntry.sourceTick
                    || pool.pulseResultCount !== queueEntry.records.length) {
                    throw new RangeError('Effect readback header/pool protocol이 일치하지 않습니다.');
                }
                const status = (pool.status | header.status) >>> 0;
                const retryableCapacityRejected
                    = isRetryableEffectCapacityStatus(status);
                const pulseResults = new Array(header.count);
                let candidateTotal = 0;
                let appliedTotal = 0;
                for (let index = 0; index < header.count; index++) {
                    const record = readGpuEffectPulseProgramRecord(
                        mappedProgram,
                        index
                    );
                    const expected = queueEntry.records[index];
                    if (record.sourceSlot !== expected.sourceSlot
                        || record.sourceEntityId !== expected.sourceEntityId
                        || record.sourceIncarnation !== expected.sourceIncarnation
                        || record.effectDefinitionCode
                            !== expected.effectDefinitionCode
                        || record.emitterDefinitionCode
                            !== expected.emitterDefinitionCode
                        || record.sourceTick !== expected.sourceTick
                        || record.pulseSequence !== expected.pulseSequence
                        || record.targetLayerMask !== expected.targetLayerMask
                        || record.targetPolicy !== expected.targetPolicy
                        || !Object.is(record.radiusTiles, expected.radiusTiles)
                        || record.fingerprint !== expected.fingerprint
                        || record.flags !== expected.flags
                        || record.retargetIntervalTicks
                            !== expected.retargetIntervalTicks) {
                        throw new RangeError(
                            `Effect result record provenance mismatch: index=${index}`
                        );
                    }
                    const normalResult = record.result
                            === GPU_EFFECT_PULSE_PROGRAM_RESULT.APPLIED
                        || record.result
                            === GPU_EFFECT_PULSE_PROGRAM_RESULT.ZERO_TARGET
                        || record.result
                            === GPU_EFFECT_PULSE_PROGRAM_RESULT.SOURCE_INVALID;
                    if (status === GPU_EFFECT_RUNTIME_STATUS.OK
                        && (!normalResult
                            || (record.result
                                === GPU_EFFECT_PULSE_PROGRAM_RESULT.APPLIED
                                && record.appliedCount === 0)
                            || (record.result
                                !== GPU_EFFECT_PULSE_PROGRAM_RESULT.APPLIED
                                && (record.candidateCount !== 0
                                    || record.appliedCount !== 0)))) {
                        throw new RangeError(
                            `Effect normal result/count mismatch: index=${index}, result=${record.result}`
                        );
                    }
                    if (retryableCapacityRejected
                        && (record.result
                                !== GPU_EFFECT_PULSE_PROGRAM_RESULT.CAPACITY_REJECTED
                            || record.candidateCount !== 0
                            || record.appliedCount !== 0)) {
                        throw new RangeError(
                            `Effect retryable capacity result is not zero-partial: index=${index}`
                        );
                    }
                    candidateTotal += record.candidateCount;
                    appliedTotal += record.appliedCount;
                    pulseResults[index] = Object.freeze({
                        programIndex: index,
                        pulseSequence: record.pulseSequence,
                        resultCode: record.result,
                        candidateCount: record.candidateCount,
                        appliedCount: record.appliedCount
                    });
                }
                if (candidateTotal !== pool.candidateCount
                    || appliedTotal !== pool.materializedCount
                    || pool.eventCount > this.effectEventCapacity
                    || (retryableCapacityRejected
                        && (candidateTotal !== 0
                            || appliedTotal !== 0
                            || pool.eventCount !== 0))) {
                    throw new RangeError('Effect aggregate count가 pulse/pool과 다릅니다.');
                }
                const events = new Array(pool.eventCount);
                const eventView = new DataView(
                    mapped,
                    effectReadbackEventOffset(this.effectPulseProgramCapacity),
                    this.effectEventCapacity * GPU_EFFECT_RUNTIME_ABI.EVENT.STRIDE
                );
                for (let index = 0; index < pool.eventCount; index++) {
                    const event = readGpuEffectEvent(eventView, index);
                    if (event.type !== GPU_EFFECT_EVENT_TYPE.PULSE_EMITTED
                        && event.type !== GPU_EFFECT_EVENT_TYPE.INSTANCE_APPLIED) {
                        throw new RangeError(`Effect event type이 유효하지 않습니다: ${event.type}`);
                    }
                    events[index] = event;
                }
                completion = Object.freeze({
                    abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
                    sessionGeneration: queueEntry.sessionGeneration,
                    deviceGeneration: queueEntry.deviceGeneration,
                    authoritativeEpoch: queueEntry.authoritativeEpoch,
                    previousSourceTick: queueEntry.previousSourceTick,
                    previousSubmittedTick: queueEntry.previousSubmittedTick,
                    sourceTick: queueEntry.sourceTick,
                    submittedTick: queueEntry.submittedTick,
                    completedThroughTick: queueEntry.sourceTick,
                    status,
                    candidateCount: candidateTotal,
                    appliedInstanceCount: appliedTotal,
                    eventCount: events.length,
                    pulseResults: Object.freeze(pulseResults),
                    events: Object.freeze(events)
                });
                this.lastEffectRuntimeStatus = status;
                this.lastEffectProgramCount = pulseResults.length;
                this.lastEffectCandidateCount = candidateTotal;
                this.lastEffectAppliedInstanceCount = appliedTotal;
                this.lastEffectEventCount = events.length;
                if (status !== GPU_EFFECT_RUNTIME_STATUS.OK
                    && !retryableCapacityRejected) {
                    this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
                    this.failure = captureFailure(
                        'effect-runtime-capacity',
                        new Error(`GPU Effect runtime status=${status}`)
                    );
                    this.state = this.requiresAuthoritativeRebuild
                        ? 'requires-rebuild'
                        : 'failed';
                } else if (retryableCapacityRejected
                    && !this.requiresAuthoritativeRebuild) {
                    // Authentic capacity-only completion advances protocol
                    // watermarks but remains a normal retry signal.
                    this.failure = null;
                    this.state = 'ready';
                }
            } catch (error) {
                failure = captureFailure('effect-program-readback', error);
            } finally {
                slot.buffer.unmap();
            }
            this.#releaseClaimedEffectProgramReadbackSlot(slot);
            queueEntry.completion = completion;
            queueEntry.failure = failure;
            queueEntry.completed = true;
            if (failure) {
                this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
                this.failure = failure;
                this.state = this.requiresAuthoritativeRebuild
                    ? 'requires-rebuild'
                    : 'failed';
            }
            this.#completeDeferredIdleRelease();
        }).catch((error) => {
            if (this.destroyed
                || lease !== this.effectProgramReadbackLease
                || slot.lease !== lease) {
                slot.inFlight = false;
                return;
            }
            this.#releaseClaimedEffectProgramReadbackSlot(slot);
            queueEntry.failure = captureFailure('effect-program-readback', error);
            queueEntry.completed = true;
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            this.failure = queueEntry.failure;
            this.state = this.requiresAuthoritativeRebuild
                ? 'requires-rebuild'
                : 'failed';
            this.#completeDeferredIdleRelease();
        });
    }

    #claimTrackedPoseReadbackSlot() {
        const slotCount = this.trackedPoseReadbackSlots.length;
        for (let offset = 0; offset < slotCount; offset++) {
            const index = (this.trackedPoseReadbackCursor + offset) % slotCount;
            const slot = this.trackedPoseReadbackSlots[index];
            if (slot.inFlight) {
                continue;
            }
            slot.inFlight = true;
            this.pendingTrackedPoseReadbacks++;
            this.trackedPoseReadbackCursor = (index + 1) % slotCount;
            return slot;
        }
        return null;
    }

    #releaseClaimedTrackedPoseReadbackSlot(slot) {
        if (!slot?.inFlight) {
            return;
        }
        slot.inFlight = false;
        this.pendingTrackedPoseReadbacks = Math.max(
            0,
            this.pendingTrackedPoseReadbacks - 1
        );
    }

    #beginTrackedPoseReadback(slot, envelope) {
        slot.lease = envelope.resourceLease;
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            const leaseMatches = !this.destroyed
                && envelope.resourceLease === this.trackedPoseReadbackLease
                && slot.lease === envelope.resourceLease;
            const generationMatches = envelope.deviceGeneration === this.deviceGeneration;
            const epochMatches = envelope.authoritativeEpoch === this.authoritativeEpoch;
            const revisionMatches = envelope.trackingRevision === this.trackedPoseRevision;
            const handleMatches = this.trackedPoseHandle
                && entityHandleKey(this.trackedPoseHandle)
                    === entityHandleKey(envelope.expectedHandle)
                && this.trackedPoseSlot === envelope.expectedSlot;
            if (!leaseMatches
                || !generationMatches
                || !epochMatches
                || !revisionMatches
                || !handleMatches) {
                try {
                    slot.buffer.unmap();
                } catch {
                    // retired mapping may already be unmapped
                }
                if (leaseMatches) {
                    this.#releaseClaimedTrackedPoseReadbackSlot(slot);
                    this.#completeDeferredIdleRelease();
                } else {
                    slot.inFlight = false;
                }
                return;
            }
            let decoded = null;
            try {
                const view = new DataView(slot.buffer.getMappedRange());
                const abi = GPU_FIXED_PRIMITIVE_ABI.TRACKED_POSE_RECORD;
                const entityId = view.getUint32(abi.ENTITY_ID, LITTLE_ENDIAN);
                const incarnation = view.getUint32(abi.INCARNATION, LITTLE_ENDIAN);
                const invalid = entityId === GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT
                    && incarnation === GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT;
                if ((entityId === GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT)
                    !== (incarnation
                        === GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT)) {
                    throw new RangeError('tracked pose invalid identity pair가 손상되었습니다.');
                }
                if (!invalid) {
                    if (entityId !== envelope.expectedHandle.entityId
                        || incarnation !== envelope.expectedHandle.incarnation
                        || this.handleToSlot.get(entityHandleKey(envelope.expectedHandle))
                            !== envelope.expectedSlot
                        || this.slotActive[envelope.expectedSlot] !== 1) {
                        throw new RangeError('tracked pose exact identity가 현재 body와 다릅니다.');
                    }
                    const values = [
                        view.getFloat32(abi.POSITION_X, LITTLE_ENDIAN),
                        view.getFloat32(abi.POSITION_Y, LITTLE_ENDIAN),
                        view.getFloat32(abi.VELOCITY_X, LITTLE_ENDIAN),
                        view.getFloat32(abi.VELOCITY_Y, LITTLE_ENDIAN),
                        view.getFloat32(abi.PREVIOUS_POSITION_X, LITTLE_ENDIAN),
                        view.getFloat32(abi.PREVIOUS_POSITION_Y, LITTLE_ENDIAN)
                    ];
                    if (values.some((value) => !Number.isFinite(value))) {
                        throw new RangeError('tracked pose에 non-finite 값이 있습니다.');
                    }
                    decoded = freezeTrackedPoseSnapshot({
                        entityId,
                        incarnation,
                        sourceTick: envelope.sourceTick,
                        submittedTick: envelope.submittedTick,
                        sessionGeneration: envelope.sessionGeneration,
                        deviceGeneration: envelope.deviceGeneration,
                        authoritativeEpoch: envelope.authoritativeEpoch,
                        position: { x: values[0], y: values[1] },
                        velocity: { x: values[2], y: values[3] },
                        previousPosition: { x: values[4], y: values[5] }
                    });
                }
            } finally {
                slot.buffer.unmap();
            }
            this.#releaseClaimedTrackedPoseReadbackSlot(slot);
            const current = this.latestTrackedPose;
            const isNewer = envelope.sourceTick > current.sourceTick
                || (envelope.sourceTick === current.sourceTick
                    && envelope.submittedTick > current.submittedTick);
            if (isNewer) {
                if (decoded) {
                    this.latestTrackedPose = decoded;
                    this.trackedPosePublishedSamples++;
                } else {
                    this.latestTrackedPose = Object.freeze({
                        ...createInvalidTrackedPoseSnapshot('gpu-body-inactive'),
                        sourceTick: envelope.sourceTick,
                        submittedTick: envelope.submittedTick,
                        observedThroughTick: envelope.sourceTick,
                        sessionGeneration: envelope.sessionGeneration,
                        deviceGeneration: envelope.deviceGeneration,
                        authoritativeEpoch: envelope.authoritativeEpoch,
                        ageTicks: 0
                    });
                }
            }
            this.#completeDeferredIdleRelease();
        }).catch(() => {
            if (this.destroyed
                || envelope.resourceLease !== this.trackedPoseReadbackLease
                || slot.lease !== envelope.resourceLease) {
                slot.inFlight = false;
                return;
            }
            this.#releaseClaimedTrackedPoseReadbackSlot(slot);
            this.trackedPoseDroppedSamples++;
            this.#completeDeferredIdleRelease();
        });
    }

    #claimProjectileCaptureReadbackSlot() {
        const slotCount = this.projectileCaptureReadbackSlots.length;
        for (let offset = 0; offset < slotCount; offset++) {
            const index = (this.projectileCaptureReadbackCursor + offset)
                % slotCount;
            const slot = this.projectileCaptureReadbackSlots[index];
            if (slot.inFlight) {
                continue;
            }
            slot.inFlight = true;
            this.pendingProjectileCaptureReadbacks++;
            this.projectileCaptureReadbackCursor = (index + 1) % slotCount;
            return slot;
        }
        return null;
    }

    #releaseClaimedProjectileCaptureReadbackSlot(slot, hadRelease = false) {
        if (!slot?.inFlight) {
            return;
        }
        slot.inFlight = false;
        this.pendingProjectileCaptureReadbacks = Math.max(
            0,
            this.pendingProjectileCaptureReadbacks - 1
        );
        if (hadRelease) {
            this.pendingProjectileCaptureReleaseReadbacks = Math.max(
                0,
                this.pendingProjectileCaptureReleaseReadbacks - 1
            );
        }
    }

    #claimRouteRuntimeReadbackSlot() {
        const slotCount = this.routeRuntimeReadbackSlots.length;
        for (let offset = 0; offset < slotCount; offset++) {
            const index = (this.routeRuntimeReadbackCursor + offset) % slotCount;
            const slot = this.routeRuntimeReadbackSlots[index];
            if (slot.inFlight) continue;
            slot.inFlight = true;
            this.pendingRouteRuntimeReadbacks++;
            this.routeRuntimeReadbackCursor = (index + 1) % slotCount;
            return slot;
        }
        return null;
    }

    #releaseClaimedRouteRuntimeReadbackSlot(slot) {
        if (!slot?.inFlight) return;
        slot.inFlight = false;
        this.pendingRouteRuntimeReadbacks = Math.max(
            0,
            this.pendingRouteRuntimeReadbacks - 1
        );
    }

    #normalizeProjectileCaptureCompletion(record, sourceTick, batchIdFingerprint) {
        const invalid = GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT;
        const facingLength = Math.hypot(record?.facing?.x, record?.facing?.y);
        if (!record || record.flags !== 0 || record.reserved !== 0
            || record.captorBodySlot >= this.capacity
            || record.projectileBodySlot >= this.capacity
            || record.captorHandle?.entityId <= 0
            || record.captorHandle?.entityId === invalid
            || record.captorHandle?.incarnation <= 0
            || record.captorHandle?.incarnation === invalid
            || record.projectileHandle?.entityId <= 0
            || record.projectileHandle?.entityId === invalid
            || record.projectileHandle?.incarnation <= 0
            || record.projectileHandle?.incarnation === invalid
            || record.captureSequence === 0
            || record.captureSequence === invalid
            || record.capturedAtFixedTick === 0
            || record.capturedAtFixedTick > sourceTick
            || record.releaseDueFixedTick <= record.capturedAtFixedTick
            || record.profileCode !== RING_PROJECTILE_CAPTURE_PROFILE.definitionCode
            || !Number.isFinite(record.anchor.x)
            || !Number.isFinite(record.anchor.y)
            || !Number.isFinite(record.facing.x)
            || !Number.isFinite(record.facing.y)
            || !Number.isFinite(facingLength)
            || Math.abs(facingLength - 1) > 1e-4
            || !Number.isFinite(record.capturedSpeed)
            || record.capturedSpeed <= 0) {
            throw new RangeError('projectile capture completion record가 손상되었습니다.');
        }
        const captureFingerprint = mixProjectileCaptureFingerprint(
            record.captorHandle.entityId,
            record.projectileHandle.entityId,
            record.captureSequence
        );
        const prepareFingerprint = mixProjectileCaptureFingerprint(
            record.captorHandle.entityId,
            record.projectileHandle.entityId,
            (record.captureSequence ^ sourceTick) >>> 0
        );
        const forwardTarget = record.targetSelector
                === GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD
            && record.targetBodySlot === invalid
            && record.targetHandle.entityId === invalid
            && record.targetHandle.incarnation === invalid;
        const common = {
            projectileHandle: record.projectileHandle,
            captorHandle: record.captorHandle,
            projectileBodySlot: record.projectileBodySlot,
            captorBodySlot: record.captorBodySlot,
            captureSequence: record.captureSequence,
            sourceTick
        };
        if (record.type === GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE.CAPTURED) {
            if (record.reason !== 0 || !forwardTarget
                || record.prepareFingerprint !== captureFingerprint) {
                throw new RangeError('capture completion fingerprint/type이 다릅니다.');
            }
            return Object.freeze({ kind: 'capture', value: Object.freeze(common) });
        }
        if (record.type
                === GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE.HELD_PROJECTILE_EXPIRED) {
            if (record.reason !== 0 || !forwardTarget
                || record.prepareFingerprint !== prepareFingerprint) {
                throw new RangeError('cleanup completion fingerprint/type이 다릅니다.');
            }
            return Object.freeze({
                kind: 'cleanup',
                value: Object.freeze({
                    ...common,
                    reason: record.reason
                })
            });
        }
        const releaseTypes = new Set([
            GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE.RELEASE_PREPARED_NORMAL,
            GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE.RELEASE_PREPARED_CAPTOR_DEATH,
            GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE
                .RELEASE_PREPARED_CAPTOR_CORE_IMPACT
        ]);
        if (!releaseTypes.has(record.type)) {
            throw new RangeError('알 수 없는 projectile capture completion type입니다.');
        }
        const expectedReason = record.type
                === GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE
                    .RELEASE_PREPARED_NORMAL
            ? GPU_PROJECTILE_CAPTURE_RELEASE_REASON.NORMAL_DUE
            : record.type
                    === GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE
                        .RELEASE_PREPARED_CAPTOR_DEATH
                ? GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_DEATH
                : GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT;
        const towerTarget = record.targetSelector
                === GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.TOWER
            && record.targetBodySlot < this.capacity
            && record.targetHandle.entityId > 0
            && record.targetHandle.entityId !== invalid
            && record.targetHandle.incarnation > 0
            && record.targetHandle.incarnation !== invalid;
        if (record.reason !== expectedReason
            || record.prepareFingerprint !== prepareFingerprint
            || (expectedReason === GPU_PROJECTILE_CAPTURE_RELEASE_REASON.NORMAL_DUE
                ? !forwardTarget && !towerTarget
                : !forwardTarget)) {
            throw new RangeError('release preparation fingerprint/type이 다릅니다.');
        }
        const targetHandle = record.targetSelector
                === GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.TOWER
            ? record.targetHandle
            : null;
        return Object.freeze({
            kind: 'releasePreparation',
            value: Object.freeze({
                ...common,
                releaseReason: record.reason,
                prepareSourceTick: sourceTick,
                batchIdFingerprint,
                prepareEvidence: Object.freeze({
                    baseReason: record.reason,
                    prepareFingerprint: record.prepareFingerprint,
                    captorBodySlot: record.captorBodySlot,
                    projectileBodySlot: record.projectileBodySlot,
                    captureSequence: record.captureSequence,
                    anchor: record.anchor,
                    facing: record.facing,
                    capturedSpeed: record.capturedSpeed,
                    targetSelector: record.targetSelector,
                    targetHandle,
                    targetBodySlot: record.targetBodySlot,
                    profileCode: record.profileCode,
                    capturedAtFixedTick: record.capturedAtFixedTick,
                    releaseDueFixedTick: record.releaseDueFixedTick
                })
            })
        });
    }

    #setHostProjectileCapturedFlag(slot, enabled) {
        const layout = GPU_CIRCLE_BODY_ABI.SIMULATION;
        const offset = slot * layout.STRIDE + layout.FLAGS;
        const view = new DataView(this.hostStorage.simulationBuffer);
        const current = view.getUint32(offset, LITTLE_ENDIAN);
        view.setUint32(
            offset,
            enabled
                ? current | GPU_CIRCLE_BODY_SIMULATION_FLAG.PROJECTILE_CAPTURED
                : current & ~GPU_CIRCLE_BODY_SIMULATION_FLAG.PROJECTILE_CAPTURED,
            LITTLE_ENDIAN
        );
    }

    #mirrorProjectileCaptureTickRecords(records) {
        const invalid = GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT;
        for (const record of records) {
            const captorSlot = record.captorBodySlot;
            const projectileSlot = record.projectileBodySlot;
            const captorExact = this.slotActive[captorSlot] === 1
                && this.slotHandles[captorSlot]?.entityId
                    === record.captorHandle.entityId
                && this.slotHandles[captorSlot]?.incarnation
                    === record.captorHandle.incarnation;
            const projectileExact = this.slotActive[projectileSlot] === 1
                && this.slotHandles[projectileSlot]?.entityId
                    === record.projectileHandle.entityId
                && this.slotHandles[projectileSlot]?.incarnation
                    === record.projectileHandle.incarnation;
            if (!projectileExact
                || (!captorExact
                    && record.type
                        !== GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE
                            .HELD_PROJECTILE_EXPIRED)) {
                throw new RangeError('capture completion host identity가 stale입니다.');
            }
            if (record.type
                    === GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE
                        .HELD_PROJECTILE_EXPIRED) {
                if (captorExact) {
                    const current = readGpuProjectileCaptureState(
                        this.hostStorage,
                        captorSlot
                    );
                    writeGpuProjectileCaptureState(this.hostStorage, captorSlot, {
                        ...current,
                        phase: GPU_PROJECTILE_CAPTURE_PHASE.IDLE,
                        peerBodySlot: invalid,
                        peerEntityId: invalid,
                        peerIncarnation: invalid
                    });
                }
                const current = readGpuProjectileCaptureState(
                    this.hostStorage,
                    projectileSlot
                );
                writeGpuProjectileCaptureState(this.hostStorage, projectileSlot, {
                    ...current,
                    phase: GPU_PROJECTILE_CAPTURE_PHASE.TOMBSTONED,
                    peerBodySlot: invalid,
                    peerEntityId: invalid,
                    peerIncarnation: invalid
                });
                this.#setHostProjectileCapturedFlag(projectileSlot, false);
                continue;
            }
            const phase = record.type
                    === GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE.CAPTURED
                ? GPU_PROJECTILE_CAPTURE_PHASE.HELD
                : GPU_PROJECTILE_CAPTURE_PHASE.RELEASE_PREPARED;
            const shared = {
                phase,
                peerBodySlot: projectileSlot,
                peerEntityId: record.projectileHandle.entityId,
                peerIncarnation: record.projectileHandle.incarnation,
                capturedAtFixedTick: record.capturedAtFixedTick,
                releaseDueFixedTick: record.releaseDueFixedTick,
                captureSequence: record.captureSequence,
                capturedSpeed: record.capturedSpeed,
                facingX: record.facing.x,
                facingY: record.facing.y
            };
            writeGpuProjectileCaptureState(this.hostStorage, captorSlot, {
                role: GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR,
                profileCode: record.profileCode,
                policyCode: GPU_PROJECTILE_CAPTURE_POLICY_CODE.NOT_CAPTURABLE,
                flags: 0,
                selfEntityId: record.captorHandle.entityId,
                selfIncarnation: record.captorHandle.incarnation,
                ...shared
            });
            writeGpuProjectileCaptureState(this.hostStorage, projectileSlot, {
                role: GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE,
                profileCode: 0,
                policyCode: GPU_PROJECTILE_CAPTURE_POLICY_CODE.CAPTURABLE,
                flags: 0,
                selfEntityId: record.projectileHandle.entityId,
                selfIncarnation: record.projectileHandle.incarnation,
                ...shared,
                peerBodySlot: captorSlot,
                peerEntityId: record.captorHandle.entityId,
                peerIncarnation: record.captorHandle.incarnation
            });
            this.#setHostProjectileCapturedFlag(projectileSlot, true);
        }
    }

    #mirrorProjectileCaptureReleaseRecords(records) {
        const invalid = GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT;
        const physicsView = new DataView(this.hostStorage.physicsBuffer);
        const simulationView = new DataView(this.hostStorage.simulationBuffer);
        const temporaryView = new DataView(this.hostStorage.temporaryBuffer);
        const combatView = new DataView(this.hostStorage.combatStateBuffer);
        for (const record of records) {
            const projectileSlot = record.projectileBodySlot;
            if (this.slotActive[projectileSlot] !== 1
                || this.slotHandles[projectileSlot]?.entityId
                    !== record.projectileHandle.entityId
                || this.slotHandles[projectileSlot]?.incarnation
                    !== record.projectileHandle.incarnation) {
                throw new RangeError('release completion projectile가 stale입니다.');
            }
            const captorSlot = record.captorBodySlot;
            if (this.slotActive[captorSlot] === 1
                && this.slotHandles[captorSlot]?.entityId
                    === record.captorHandle.entityId
                && this.slotHandles[captorSlot]?.incarnation
                    === record.captorHandle.incarnation) {
                const captor = readGpuProjectileCaptureState(
                    this.hostStorage,
                    captorSlot
                );
                writeGpuProjectileCaptureState(this.hostStorage, captorSlot, {
                    ...captor,
                    phase: GPU_PROJECTILE_CAPTURE_PHASE.IDLE,
                    peerBodySlot: invalid,
                    peerEntityId: invalid,
                    peerIncarnation: invalid
                });
            }
            const projectile = readGpuProjectileCaptureState(
                this.hostStorage,
                projectileSlot
            );
            writeGpuProjectileCaptureState(this.hostStorage, projectileSlot, {
                ...projectile,
                phase: GPU_PROJECTILE_CAPTURE_PHASE.IDLE,
                peerBodySlot: invalid,
                peerEntityId: invalid,
                peerIncarnation: invalid,
                facingX: 0,
                facingY: 0
            });
            const physicsOffset = projectileSlot
                * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE;
            physicsView.setFloat32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_X,
                record.position.x,
                LITTLE_ENDIAN
            );
            physicsView.setFloat32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_Y,
                record.position.y,
                LITTLE_ENDIAN
            );
            physicsView.setFloat32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_X,
                record.velocity.x,
                LITTLE_ENDIAN
            );
            physicsView.setFloat32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_Y,
                record.velocity.y,
                LITTLE_ENDIAN
            );
            physicsView.setUint32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INTERACTION_META,
                record.nextInteractionMeta,
                LITTLE_ENDIAN
            );
            const simulationOffset = projectileSlot
                * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
            simulationView.setUint32(
                simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.GAMEPLAY_META,
                record.nextGameplayMeta,
                LITTLE_ENDIAN
            );
            this.#setHostProjectileCapturedFlag(projectileSlot, false);
            const temporaryOffset = projectileSlot
                * GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE;
            for (const field of [
                GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_X,
                GPU_CIRCLE_BODY_ABI.TEMPORARY.PREDICTED_X
            ]) {
                temporaryView.setFloat32(
                    temporaryOffset + field,
                    record.position.x,
                    LITTLE_ENDIAN
                );
            }
            for (const field of [
                GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_Y,
                GPU_CIRCLE_BODY_ABI.TEMPORARY.PREDICTED_Y
            ]) {
                temporaryView.setFloat32(
                    temporaryOffset + field,
                    record.position.y,
                    LITTLE_ENDIAN
                );
            }
            temporaryView.setFloat32(
                temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.DELTA_X,
                0,
                LITTLE_ENDIAN
            );
            temporaryView.setFloat32(
                temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.DELTA_Y,
                0,
                LITTLE_ENDIAN
            );
            temporaryView.setInt32(
                temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.GRID_INDEX,
                -1,
                LITTLE_ENDIAN
            );
            combatView.setUint32(
                projectileSlot * GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE
                    + GPU_CIRCLE_BODY_ABI.COMBAT_STATE
                        .TARGET_INTERACTION_LAYER_MASK,
                record.nextTargetLayerMask,
                LITTLE_ENDIAN
            );
        }
    }

    #beginProjectileCaptureReadback(
        slot,
        captureQueueEntry,
        releaseQueueEntry,
        lease
    ) {
        if (releaseQueueEntry) {
            this.pendingProjectileCaptureReleaseReadbacks++;
        }
        slot.lease = lease;
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            const authentic = !this.destroyed
                && lease === this.projectileCaptureReadbackLease
                && slot.lease === lease
                && captureQueueEntry.deviceGeneration === this.deviceGeneration
                && captureQueueEntry.authoritativeEpoch === this.authoritativeEpoch;
            if (!authentic) {
                try { slot.buffer.unmap(); } catch { /* retired */ }
                if (lease === this.projectileCaptureReadbackLease) {
                    this.#releaseClaimedProjectileCaptureReadbackSlot(
                        slot,
                        releaseQueueEntry !== null
                    );
                } else {
                    slot.inFlight = false;
                }
                return;
            }
            try {
                const view = new DataView(slot.buffer.getMappedRange());
                const header = readGpuProjectileCaptureTickHeader(view);
                if (header.abiVersion
                        !== GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION
                    || header.sessionGeneration !== this.sessionGeneration
                    || header.deviceGeneration !== captureQueueEntry.deviceGeneration
                    || header.authoritativeEpoch
                        !== captureQueueEntry.authoritativeEpoch
                    || header.sourceTick !== captureQueueEntry.sourceTick
                    || header.completedThroughTick !== captureQueueEntry.sourceTick
                    || header.status !== GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE
                    || header.errorFlags !== 0
                    || header.overflowFlags !== 0
                    || header.reserved !== 0
                    || header.selectedCount
                        !== header.releasePreparationCount + header.cleanupCount
                    || header.captureCount
                        > this.projectileCaptureCompletionCapacity
                    || header.releasePreparationCount
                        > this.projectileCaptureReleasePreparationCapacity
                    || header.cleanupCount > this.projectileCaptureCleanupCapacity) {
                    throw new RangeError('projectile capture tick header 인증에 실패했습니다.');
                }
                const captures = [];
                const releasePreparations = [];
                const cleanups = [];
                const decodedTickRecords = [];
                let releasePreparationFingerprint = 0;
                const completionStride
                    = GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.COMPLETION.STRIDE;
                const captureBase
                    = GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.TICK_HEADER.STRIDE;
                const releaseBase = captureBase
                    + this.projectileCaptureCompletionCapacity * completionStride;
                const cleanupBase = releaseBase
                    + this.projectileCaptureReleasePreparationCapacity
                        * completionStride;
                for (const [count, base, expectedKind] of [
                    [header.captureCount, captureBase, 'capture'],
                    [header.releasePreparationCount, releaseBase, 'releasePreparation'],
                    [header.cleanupCount, cleanupBase, 'cleanup']
                ]) {
                    for (let index = 0; index < count; index++) {
                        const decoded = decodeGpuProjectileCaptureCompletion(
                            view,
                            base + index * completionStride
                        );
                        const normalized = this.#normalizeProjectileCaptureCompletion(
                            decoded,
                            header.sourceTick,
                            header.batchIdFingerprint
                        );
                        decodedTickRecords.push(decoded);
                        if (normalized.kind !== expectedKind) {
                            throw new RangeError(
                                'projectile capture completion partition type이 다릅니다.'
                            );
                        }
                        if (normalized.kind === 'capture') {
                            captures.push(normalized.value);
                        } else if (normalized.kind === 'releasePreparation') {
                            releasePreparations.push(normalized.value);
                            releasePreparationFingerprint = (
                                releasePreparationFingerprint
                                ^ decoded.prepareFingerprint
                            ) >>> 0;
                        } else {
                            cleanups.push(normalized.value);
                        }
                    }
                }
                const expectedReleasePreparationFingerprint
                    = header.releasePreparationCount > 0
                        && (releasePreparationFingerprint === 0
                            || releasePreparationFingerprint === UINT32_MAX)
                        ? 1
                        : releasePreparationFingerprint;
                if (header.batchIdFingerprint
                    !== expectedReleasePreparationFingerprint) {
                    throw new RangeError(
                        'projectile capture release-prepare fingerprint가 다릅니다.'
                    );
                }
                const preparedEntries = [];
                for (const preparation of releasePreparations) {
                    const key = projectileCapturePreparationKey(
                        header.batchIdFingerprint,
                        preparation.projectileHandle,
                        preparation.captureSequence,
                        preparation.prepareEvidence.prepareFingerprint
                    );
                    const prior = this
                        .authenticProjectileCapturePreparationByKey.get(key);
                    if (prior) {
                        throw new RangeError(
                            'projectile capture prepare fingerprint가 충돌했습니다.'
                        );
                    }
                    preparedEntries.push([key, preparation]);
                }
                let releaseHeader = null;
                let releaseCompletion = null;
                if (releaseQueueEntry) {
                    const releaseOffset = this.hostProjectileCaptureTick.buffer.byteLength;
                    const releaseView = new DataView(
                        view.buffer,
                        view.byteOffset + releaseOffset,
                        this.hostProjectileCaptureReleaseProgram.buffer.byteLength
                    );
                    releaseHeader = readGpuProjectileCaptureReleaseHeader(
                        releaseView
                    );
                    if (releaseHeader.abiVersion
                            !== GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION
                        || releaseHeader.sessionGeneration !== this.sessionGeneration
                        || releaseHeader.deviceGeneration
                            !== releaseQueueEntry.deviceGeneration
                        || releaseHeader.authoritativeEpoch
                            !== releaseQueueEntry.authoritativeEpoch
                        || releaseHeader.publicationFixedTick
                            !== releaseQueueEntry.sourceTick
                        || releaseHeader.status
                            !== GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE
                        || releaseHeader.errorFlags !== 0
                        || releaseHeader.recordCount
                            !== releaseQueueEntry.records.length
                        || releaseHeader.validatedCount
                            !== releaseHeader.recordCount
                        || releaseHeader.committedCount !== releaseHeader.recordCount
                        || releaseHeader.batchIdFingerprint
                            !== releaseQueueEntry.batchIdFingerprint
                        || releaseHeader.resultFingerprint
                            !== releaseHeader.batchIdFingerprint
                        || releaseHeader.flags
                            !== GPU_PROJECTILE_CAPTURE_RELEASE_PROGRAM_FLAG
                                .COMMIT_REQUESTED
                        || releaseHeader.reserved0 !== 0
                        || releaseHeader.reserved1 !== 0
                        || releaseHeader.reserved2 !== 0) {
                        throw new RangeError(
                            'projectile capture release header 인증에 실패했습니다.'
                        );
                    }
                    for (let index = 0;
                        index < releaseQueueEntry.records.length;
                        index++) {
                        const expected = releaseQueueEntry.records[index];
                        const actual = readGpuProjectileCaptureReleaseRecord(
                            releaseView,
                            index
                        );
                        if (actual.commandIdFingerprint
                                !== expected.commandIdFingerprint
                            || actual.prepareFingerprint
                                !== expected.prepareFingerprint
                            || actual.captorBodySlot !== expected.captorBodySlot
                            || actual.captorHandle.entityId
                                !== expected.captorHandle.entityId
                            || actual.captorHandle.incarnation
                                !== expected.captorHandle.incarnation
                            || actual.projectileBodySlot
                                !== expected.projectileBodySlot
                            || actual.projectileHandle.entityId
                                !== expected.projectileHandle.entityId
                            || actual.projectileHandle.incarnation
                                !== expected.projectileHandle.incarnation
                            || actual.captureSequence !== expected.captureSequence
                            || actual.capturedAtFixedTick
                                !== expected.capturedAtFixedTick
                            || actual.preparedAtFixedTick
                                !== expected.preparedAtFixedTick
                            || actual.releaseReason !== expected.releaseReason
                            || actual.positionBits.x
                                !== projectileCaptureFloat32Bits(
                                    expected.position.x
                                )
                            || actual.positionBits.y
                                !== projectileCaptureFloat32Bits(
                                    expected.position.y
                                )
                            || actual.velocityBits.x
                                !== projectileCaptureFloat32Bits(
                                    expected.velocity.x
                                )
                            || actual.velocityBits.y
                                !== projectileCaptureFloat32Bits(
                                    expected.velocity.y
                                )
                            || actual.capturedSpeedBits
                                !== projectileCaptureFloat32Bits(
                                    expected.capturedSpeed
                                )
                            || actual.targetSelector !== expected.targetSelector
                            || actual.targetBodySlot !== expected.targetBodySlot
                            || actual.targetHandle.entityId
                                !== expected.targetHandle.entityId
                            || actual.targetHandle.incarnation
                                !== expected.targetHandle.incarnation
                            || actual.nextGameplayMeta
                                !== expected.nextGameplayMeta
                            || actual.nextInteractionMeta
                                !== expected.nextInteractionMeta
                            || actual.nextTargetLayerMask
                                !== expected.nextTargetLayerMask) {
                            throw new RangeError(
                                `projectile capture release record[${index}] 인증에 실패했습니다.`
                            );
                        }
                    }
                    const releaseCompletions = releaseQueueEntry.records.map((record) => (
                        Object.freeze({
                            projectileHandle: record.projectileHandle,
                            captorHandle: record.captorHandle,
                            captureSequence: record.captureSequence,
                            sourceTick: releaseHeader.publicationFixedTick,
                            batchIdFingerprint: releaseHeader.batchIdFingerprint,
                            releaseReason: record.releaseReason,
                            prepareFingerprint: record.prepareFingerprint,
                            commandIdFingerprint: record.commandIdFingerprint,
                            publicationFixedTick:
                                releaseHeader.publicationFixedTick,
                            targetSelector: record.targetSelector,
                            targetHandle: record.targetSelector
                                    === GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.TOWER
                                ? record.targetHandle
                                : null,
                            teamId: record.teamId,
                            allegiancePolicy: record.allegiancePolicy,
                            damagePolicyId: record.damagePolicyId,
                            targetPolicyId: record.targetPolicyId,
                            metadataRevision: record.metadataRevision
                        })
                    ));
                    releaseCompletion = Object.freeze({
                        ...releaseHeader,
                        sourceTick: releaseHeader.publicationFixedTick,
                        completedThroughTick: releaseHeader.publicationFixedTick,
                        pending: false,
                        releaseCompletions: Object.freeze(releaseCompletions)
                    });
                }
                const affectedSlots = new Set();
                for (const record of decodedTickRecords) {
                    affectedSlots.add(record.captorBodySlot);
                    affectedSlots.add(record.projectileBodySlot);
                }
                for (const record of releaseQueueEntry?.records ?? []) {
                    affectedSlots.add(record.captorBodySlot);
                    affectedSlots.add(record.projectileBodySlot);
                }
                const hostPlanes = [
                    [
                        this.hostStorage.projectileCaptureStateBuffer,
                        GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE.STRIDE
                    ],
                    [
                        this.hostStorage.simulationBuffer,
                        GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE
                    ],
                    [
                        this.hostStorage.physicsBuffer,
                        GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE
                    ],
                    [
                        this.hostStorage.temporaryBuffer,
                        GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE
                    ],
                    [
                        this.hostStorage.combatStateBuffer,
                        GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE
                    ]
                ];
                const hostSlotBackups = [];
                for (const bodySlot of affectedSlots) {
                    if (!Number.isInteger(bodySlot)
                        || bodySlot < 0 || bodySlot >= this.capacity) {
                        throw new RangeError(
                            'projectile capture mirror slot이 범위를 벗어났습니다.'
                        );
                    }
                    for (const [buffer, stride] of hostPlanes) {
                        const offset = bodySlot * stride;
                        hostSlotBackups.push({
                            buffer,
                            offset,
                            bytes: buffer.slice(offset, offset + stride)
                        });
                    }
                }
                try {
                    this.#mirrorProjectileCaptureTickRecords(decodedTickRecords);
                    if (releaseQueueEntry) {
                        this.#mirrorProjectileCaptureReleaseRecords(
                            releaseQueueEntry.records
                        );
                    }
                } catch (error) {
                    for (const backup of hostSlotBackups) {
                        new Uint8Array(
                            backup.buffer,
                            backup.offset,
                            backup.bytes.byteLength
                        ).set(new Uint8Array(backup.bytes));
                    }
                    throw error;
                }
                for (const [key, preparation] of preparedEntries) {
                    this.authenticProjectileCapturePreparationByKey.set(
                        key,
                        preparation
                    );
                }
                captureQueueEntry.completion = Object.freeze({
                    ...header,
                    pending: false,
                    captures: Object.freeze(captures),
                    releasePreparations: Object.freeze(releasePreparations),
                    cleanups: Object.freeze(cleanups)
                });
                captureQueueEntry.completed = true;
                this.lastProjectileCaptureRuntimeStatus = header.status;
                this.lastProjectileCaptureErrorFlags = header.errorFlags;
                this.#advanceProjectileCaptureCompletionWatermark();
                if (releaseQueueEntry) {
                    releaseQueueEntry.completion = releaseCompletion;
                    releaseQueueEntry.completed = true;
                    this.lastProjectileCaptureReleaseCommittedTick
                        = releaseHeader.publicationFixedTick;
                }
                slot.buffer.unmap();
                this.#releaseClaimedProjectileCaptureReadbackSlot(
                    slot,
                    releaseQueueEntry !== null
                );
                this.#completeDeferredIdleRelease();
            } catch (error) {
                try { slot.buffer.unmap(); } catch { /* ignored */ }
                this.#releaseClaimedProjectileCaptureReadbackSlot(
                    slot,
                    releaseQueueEntry !== null
                );
                const failure = captureFailure(
                    'projectile-capture-readback',
                    error
                );
                captureQueueEntry.failure = failure;
                captureQueueEntry.completed = true;
                if (releaseQueueEntry) {
                    releaseQueueEntry.failure = failure;
                    releaseQueueEntry.completed = true;
                }
                this.failure = failure;
                this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
                this.state = this.requiresAuthoritativeRebuild
                    ? 'requires-rebuild'
                    : 'failed';
            }
        }).catch((error) => {
            this.#releaseClaimedProjectileCaptureReadbackSlot(
                slot,
                releaseQueueEntry !== null
            );
            const failure = captureFailure('projectile-capture-readback', error);
            captureQueueEntry.failure = failure;
            captureQueueEntry.completed = true;
            if (releaseQueueEntry) {
                releaseQueueEntry.failure = failure;
                releaseQueueEntry.completed = true;
            }
            this.failure = failure;
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            this.state = this.requiresAuthoritativeRebuild
                ? 'requires-rebuild'
                : 'failed';
        });
    }

    #beginRouteRuntimeReadback(slot, queueEntry, lease) {
        slot.tick = queueEntry.submittedTick;
        slot.generation = queueEntry.deviceGeneration;
        slot.authoritativeEpoch = queueEntry.authoritativeEpoch;
        slot.lease = lease;
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            const authentic = !this.destroyed
                && lease === this.routeRuntimeReadbackLease
                && slot.lease === lease
                && queueEntry.deviceGeneration === this.deviceGeneration
                && slot.generation === this.deviceGeneration
                && queueEntry.authoritativeEpoch === this.routeAuthoritativeEpoch
                && slot.authoritativeEpoch === this.routeAuthoritativeEpoch;
            if (!authentic) {
                try { slot.buffer.unmap(); } catch { /* retired */ }
                if (lease === this.routeRuntimeReadbackLease) {
                    this.#releaseClaimedRouteRuntimeReadbackSlot(slot);
                } else {
                    slot.inFlight = false;
                }
                return;
            }
            try {
                const mapped = slot.buffer.getMappedRange();
                const mappedBytes = new Uint8Array(mapped);
                const view = new DataView(
                    mappedBytes.buffer,
                    mappedBytes.byteOffset,
                    mappedBytes.byteLength
                );
                const header = GPU_ROUTE_RUNTIME_ABI.AVAILABILITY_HEADER;
                const recordAbi = GPU_ROUTE_RUNTIME_ABI.AVAILABILITY_RECORD;
                const abiVersion = view.getUint32(
                    header.ABI_VERSION,
                    LITTLE_ENDIAN
                );
                const status = view.getUint32(header.STATUS, LITTLE_ENDIAN);
                const availabilityVersion = view.getUint32(
                    header.AVAILABILITY_VERSION,
                    LITTLE_ENDIAN
                );
                const sourceTick = view.getUint32(header.SOURCE_TICK, LITTLE_ENDIAN);
                const completedThroughTick = view.getUint32(
                    header.COMPLETED_THROUGH_TICK,
                    LITTLE_ENDIAN
                );
                const terminalFlags = view.getUint32(
                    header.TERMINAL_FLAGS,
                    LITTLE_ENDIAN
                );
                const graphContentFingerprint = view.getUint32(
                    header.GRAPH_CONTENT_FINGERPRINT,
                    LITTLE_ENDIAN
                );
                const closureCount = view.getUint32(
                    header.CLOSURE_COUNT,
                    LITTLE_ENDIAN
                );
                const sessionGeneration = view.getUint32(
                    header.SESSION_GENERATION,
                    LITTLE_ENDIAN
                );
                const deviceGeneration = view.getUint32(
                    header.DEVICE_GENERATION,
                    LITTLE_ENDIAN
                );
                const authoritativeEpoch = view.getUint32(
                    header.AUTHORITATIVE_EPOCH,
                    LITTLE_ENDIAN
                );
                const nextLeaseGeneration = view.getUint32(
                    header.NEXT_LEASE_GENERATION,
                    LITTLE_ENDIAN
                );
                const lastEventBase = view.getUint32(
                    header.LAST_EVENT_BASE,
                    LITTLE_ENDIAN
                );
                const lastEventCount = view.getUint32(
                    header.LAST_EVENT_COUNT,
                    LITTLE_ENDIAN
                );
                const expectedClosureCount
                    = this.routeRuntimeTopology.graph?.closures?.length ?? 0;
                if (abiVersion !== GPU_ROUTE_RUNTIME_ABI_VERSION
                    || status !== GPU_ROUTE_RUNTIME_STATUS.OK
                    || availabilityVersion === 0
                    || availabilityVersion === UINT32_MAX
                    || sourceTick !== queueEntry.sourceTick
                    || completedThroughTick !== queueEntry.sourceTick
                    || terminalFlags
                        !== (queueEntry.expectedTerminalFinalSubmit ? 1 : 0)
                    || graphContentFingerprint
                        !== queueEntry.expectedGraphContentFingerprint
                    || closureCount !== expectedClosureCount
                    || sessionGeneration !== queueEntry.sessionGeneration
                    || deviceGeneration !== queueEntry.deviceGeneration
                    || authoritativeEpoch !== queueEntry.authoritativeEpoch
                    || nextLeaseGeneration === 0
                    || nextLeaseGeneration === UINT32_MAX
                    || lastEventBase > this.eventCapacity
                    || lastEventCount > this.eventCapacity - lastEventBase
                    || view.getUint32(header.RESERVED_0, LITTLE_ENDIAN) !== 0
                    || view.getUint32(header.RESERVED_1, LITTLE_ENDIAN) !== 0) {
                    throw new RangeError(
                        'route availability readback header 인증에 실패했습니다.'
                    );
                }
                const records = [];
                const closedPathIndices = [];
                const seenOwnerHandles = new Set();
                for (let index = 0; index < closureCount; index++) {
                    const offset = header.STRIDE + index * recordAbi.STRIDE;
                    const state = view.getUint32(
                        offset + recordAbi.STATE,
                        LITTLE_ENDIAN
                    );
                    const ownerSlot = view.getUint32(
                        offset + recordAbi.OWNER_SLOT,
                        LITTLE_ENDIAN
                    );
                    const entityId = view.getUint32(
                        offset + recordAbi.OWNER_ENTITY_ID,
                        LITTLE_ENDIAN
                    );
                    const incarnation = view.getUint32(
                        offset + recordAbi.OWNER_INCARNATION,
                        LITTLE_ENDIAN
                    );
                    const leaseGeneration = view.getUint32(
                        offset + recordAbi.LEASE_GENERATION,
                        LITTLE_ENDIAN
                    );
                    const changedAtFixedTick = view.getUint32(
                        offset + recordAbi.CHANGED_AT_FIXED_TICK,
                        LITTLE_ENDIAN
                    );
                    if (view.getUint32(
                        offset + recordAbi.RESERVED_0,
                        LITTLE_ENDIAN
                    ) !== 0 || view.getUint32(
                        offset + recordAbi.RESERVED_1,
                        LITTLE_ENDIAN
                    ) !== 0) {
                        throw new RangeError('route availability reserved word가 0이 아닙니다.');
                    }
                    const isOpen = state === GPU_ROUTE_AVAILABILITY_STATE.OPEN;
                    const isUnowned = ownerSlot === UINT32_MAX
                        && entityId === UINT32_MAX
                        && incarnation === UINT32_MAX
                        && leaseGeneration === 0;
                    const isOwned = ownerSlot < this.capacity
                        && entityId !== UINT32_MAX
                        && incarnation !== UINT32_MAX
                        && leaseGeneration !== 0
                        && leaseGeneration !== UINT32_MAX;
                    if ((!isOpen
                            && state !== GPU_ROUTE_AVAILABILITY_STATE.LEASED
                            && state !== GPU_ROUTE_AVAILABILITY_STATE.CLOSED)
                        || (isOpen && !isUnowned && !isOwned)
                        || (!isOpen && !isOwned)
                        || (isOwned && (changedAtFixedTick === 0
                            || changedAtFixedTick > sourceTick))) {
                        throw new RangeError('route availability record 인증에 실패했습니다.');
                    }
                    const ownerHandle = isUnowned
                        ? null
                        : Object.freeze({ entityId, incarnation });
                    if (ownerHandle) {
                        const ownerKey = `${entityId}:${incarnation}`;
                        if (seenOwnerHandles.has(ownerKey)) {
                            throw new RangeError('route availability owner가 중복되었습니다.');
                        }
                        seenOwnerHandles.add(ownerKey);
                    }
                    const closure = this.routeRuntimeTopology.graph.closures[index];
                    if (!isOpen && state === GPU_ROUTE_AVAILABILITY_STATE.CLOSED) {
                        closedPathIndices.push(closure.pathIndex);
                    }
                    records.push(Object.freeze({
                        closureIndex: index,
                        pathIndex: closure.pathIndex,
                        state,
                        ownerSlot: isOpen ? null : ownerSlot,
                        ownerHandle,
                        leaseGeneration,
                        changedAtFixedTick
                    }));
                }
                closedPathIndices.sort((left, right) => left - right);
                const readbackBytes = mappedBytes.slice().buffer;
                const completion = Object.freeze({
                    abiVersion,
                    sessionGeneration,
                    deviceGeneration,
                    authoritativeEpoch,
                    sourceTick,
                    completedThroughTick,
                    availabilityVersion,
                    graphContentFingerprint,
                    terminal: terminalFlags === 1,
                    lastEventBase,
                    lastEventCount,
                    records: Object.freeze(records),
                    closedPathIndices: Object.freeze(closedPathIndices)
                });
                queueEntry.completion = completion;
                queueEntry.readbackBytes = readbackBytes;
                queueEntry.completed = true;
                slot.buffer.unmap();
                this.#releaseClaimedRouteRuntimeReadbackSlot(slot);
                this.#completeDeferredIdleRelease();
            } catch (error) {
                try { slot.buffer.unmap(); } catch { /* ignored */ }
                this.#releaseClaimedRouteRuntimeReadbackSlot(slot);
                const failure = captureFailure('route-runtime-readback', error);
                queueEntry.failure = failure;
                queueEntry.completed = true;
                this.failure = failure;
                this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
                this.state = this.requiresAuthoritativeRebuild
                    ? 'requires-rebuild'
                    : 'failed';
            }
        }).catch((error) => {
            const authentic = !this.destroyed
                && lease === this.routeRuntimeReadbackLease
                && slot.lease === lease
                && queueEntry.deviceGeneration === this.deviceGeneration
                && slot.generation === this.deviceGeneration
                && queueEntry.authoritativeEpoch === this.routeAuthoritativeEpoch
                && slot.authoritativeEpoch === this.routeAuthoritativeEpoch;
            if (!authentic) {
                slot.inFlight = false;
                return;
            }
            this.#releaseClaimedRouteRuntimeReadbackSlot(slot);
            const failure = captureFailure('route-runtime-readback', error);
            queueEntry.failure = failure;
            queueEntry.completed = true;
            this.failure = failure;
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            this.state = this.requiresAuthoritativeRebuild
                ? 'requires-rebuild'
                : 'failed';
        });
    }

    #claimEventReadbackSlot() {
        const slotCount = this.eventReadbackSlots.length;
        for (let offset = 0; offset < slotCount; offset++) {
            const index = (this.eventReadbackCursor + offset) % slotCount;
            const slot = this.eventReadbackSlots[index];
            if (slot.inFlight) {
                continue;
            }
            slot.inFlight = true;
            this.pendingEventReadbacks++;
            this.eventReadbackCursor = (index + 1) % slotCount;
            return slot;
        }
        return null;
    }

    #releaseClaimedEventReadbackSlot(slot) {
        if (!slot?.inFlight) {
            return;
        }
        slot.inFlight = false;
        this.pendingEventReadbacks = Math.max(0, this.pendingEventReadbacks - 1);
    }

    #recoverEventBackpressureIfPossible() {
        if (this.state !== 'event-backpressure'
            || !this.#hasFreeEventReadbackSlot()) {
            return;
        }
        this.state = 'ready';
        this.failure = null;
    }

    #removeEventQueueEntry(entry) {
        const index = this.eventBatchQueue.indexOf(entry);
        if (index >= 0) {
            this.eventBatchQueue.splice(index, 1);
        }
    }

    #advanceEventCompletionWatermark() {
        let completedThroughTick = this.eventCompletedThroughTick;
        for (const entry of this.eventBatchQueue) {
            if (!entry.completed) {
                break;
            }
            completedThroughTick = Math.max(completedThroughTick, entry.sourceTick);
        }
        this.eventCompletedThroughTick = completedThroughTick;
    }

    #advanceProjectileCaptureCompletionWatermark() {
        let completedThroughTick = this.projectileCaptureCompletedThroughTick;
        for (const entry of this.projectileCaptureBatchQueue) {
            if (!entry.completed || entry.failure) {
                break;
            }
            completedThroughTick = Math.max(
                completedThroughTick,
                entry.sourceTick
            );
        }
        this.projectileCaptureCompletedThroughTick = completedThroughTick;
    }

    #completeDeferredIdleRelease() {
        if (!this.idleReleasePending
            || this.activeBodyCount !== 0
            || this.pendingEventReadbacks !== 0
            || this.pendingOverflowReadbacks !== 0
            || this.pendingSpawnProgramReadbacks !== 0
            || this.pendingEffectReadbacks !== 0
            || this.pendingFormationPrepareReadbacks !== 0
            || this.pendingFormationTransformReadbacks !== 0
            || this.pendingAtomicTransformPrepareReadbacks !== 0
            || this.pendingAtomicTransformReadbacks !== 0
            || this.pendingProjectileCaptureReadbacks !== 0
            || this.pendingProjectileCaptureReleaseReadbacks !== 0
            || this.pendingRouteRuntimeReadbacks !== 0
            || this.pendingTrackedPoseReadbacks !== 0
            || this.eventBatchQueue.length !== 0
            || this.bodyControlProgramBatchQueue.length !== 0
            || this.spawnProgramBatchQueue.length !== 0
            || this.effectProgramBatchQueue.length !== 0
            || this.formationPrepareBatchQueue.length !== 0
            || this.atomicTransformPrepareBatchQueue.length !== 0
            || this.projectileCaptureBatchQueue.length !== 0
            || this.projectileCaptureReleaseBatchQueue.length !== 0
            || this.routeRuntimeBatchQueue.length !== 0
            || this.stagedFormationPrepareBatch !== null
            || this.armedFormationTransform !== null
            || this.stagedAtomicTransformPrepareBatch !== null
            || this.armedAtomicTransform !== null
            || this.authenticAtomicTransformPrepareByFingerprint.size !== 0
            || this.armedProjectileCaptureRelease !== null
            || this.authenticProjectileCapturePreparationByKey.size !== 0
            || this.stagedRouteCleanupBatch !== null
            || this.routeLifecycleReservations.size !== 0
            || this.routeRuntimeRosterCount !== 0
            || this.pendingBodyCount !== 0
            || (this.state !== 'ready'
                && this.state !== 'telemetry-backpressure'
                && this.state !== 'event-backpressure')) {
            return false;
        }
        const nextAuthoritativeEpoch = this.authoritativeEpoch + 1;
        const nextEffectPoolState = createGpuEffectPoolStateStorage(
            nextAuthoritativeEpoch
        );
        // 완전히 비어 lease가 끝난 world를 다시 열 때도 prior Effect identity,
        // timers, summary/emitter bits를 재사용하지 않습니다. 다음 spawn은 새
        // nonzero epoch의 instance ID space에서만 시작합니다.
        this.hostEffectBodyState = createGpuEffectBodyStateStorage(this.capacity);
        this.hostEffectPoolState = nextEffectPoolState;
        this.hostEffectPulseProgram = createGpuEffectPulseProgramStorage(
            this.effectPulseProgramCapacity
        );
        this.effectActivePoolIndex = 0;
        this.stagedEffectPulseBatch = null;
        this.effectProgramBatchQueue.length = 0;
        this.pendingEffectReadbacks = 0;
        this.lastEffectProtocolKey = null;
        this.lastEffectProgramSourceTick = 0;
        this.lastEffectProgramSubmittedTick = 0;
        this.lastEffectProgramCompletedTick = 0;
        this.lastEffectProgramCount = 0;
        this.lastEffectCandidateCount = 0;
        this.lastEffectAppliedInstanceCount = 0;
        this.lastEffectEventCount = 0;
        this.lastEffectRuntimeStatus = GPU_EFFECT_RUNTIME_STATUS.OK;
        this.hostFormationBodyState = createGpuFormationBodyStateStorage(
            this.capacity
        );
        this.hostFormationPrepareProgram = createGpuFormationPrepareProgramStorage(
            this.formationPrepareCapacity
        );
        this.hostFormationTransformProgram
            = createGpuFormationTransformProgramStorage(
                this.formationTransformCapacity
            );
        this.stagedFormationPrepareBatch = null;
        this.armedFormationTransform = null;
        this.formationPrepareBatchQueue.length = 0;
        this.pendingFormationPrepareReadbacks = 0;
        this.pendingFormationTransformReadbacks = 0;
        this.lastFormationProtocolKey = null;
        this.lastFormationPrepareSourceTick = 0;
        this.lastFormationPrepareSubmittedTick = 0;
        this.lastFormationPrepareCompletedTick = 0;
        this.lastFormationTransformCommittedTick = 0;
        this.lastFormationCommittedCount = 0;
        this.lastFormationEffectRekeyCount = 0;
        this.lastFormationRuntimeStatus = GPU_FORMATION_RUNTIME_STATUS.OK;
        this.lastFormationTransformCompletion = null;
        this.authenticFormationPrepareByKey.clear();
        this.hostAtomicTransformPrepareProgram
            = createGpuAtomicTransformPrepareStorage(
                this.atomicTransformPrepareCapacity
            );
        this.hostAtomicTransformProgram = createGpuAtomicTransformProgramStorage(
            this.atomicTransformCapacity
        );
        this.hostAtomicTransformTemplateStorage
            = createGpuCircleBodyAbiStorage(this.capacity);
        this.hostAtomicTransformTemplateEffectBodyState
            = createGpuEffectBodyStateStorage(this.capacity);
        this.hostAtomicTransformTemplateFormationBodyState
            = createGpuFormationBodyStateStorage(this.capacity);
        this.hostAtomicTransformTemplateRouteRuntimeStates
            = createGpuRouteRuntimeStateBuffer(this.capacity);
        this.hostAtomicTransformTemplateRenderStyles = new ArrayBuffer(
            BODY_RENDER_STYLE_STRIDE * this.capacity
        );
        this.hostAtomicTransformTemplateBodyControlStates = new ArrayBuffer(
            BODY_CONTROL_STATE_STRIDE * this.capacity
        );
        this.stagedAtomicTransformPrepareBatch = null;
        this.armedAtomicTransform = null;
        this.atomicTransformPrepareBatchQueue.length = 0;
        this.pendingAtomicTransformPrepareReadbacks = 0;
        this.pendingAtomicTransformReadbacks = 0;
        this.authenticAtomicTransformPrepareByFingerprint.clear();
        this.lastAtomicTransformPrepareSourceTick = 0;
        this.lastAtomicTransformCommittedCount = 0;
        this.lastAtomicTransformEffectRekeyCount = 0;
        this.lastAtomicTransformRuntimeStatus
            = GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.OK;
        this.hostProjectileCaptureTick = createGpuProjectileCaptureTickStorage(
            this.projectileCaptureCompletionCapacity,
            this.projectileCaptureReleasePreparationCapacity,
            this.projectileCaptureCleanupCapacity
        );
        this.hostProjectileCaptureReleaseProgram
            = createGpuProjectileCaptureReleaseProgramStorage(
                this.projectileCaptureReleasePreparationCapacity
            );
        if (this.terminalProjectileCaptureProgramCancelStatus
                ?.state === 'submitted') {
            this.terminalProjectileCaptureProgramCancelStatus = Object.freeze({
                ...this.terminalProjectileCaptureProgramCancelStatus,
                completedThroughTick:
                    this.projectileCaptureCompletedThroughTick,
                lastReleaseCommittedTick:
                    this.lastProjectileCaptureReleaseCommittedTick
            });
        }
        this.armedProjectileCaptureRelease = null;
        this.projectileCaptureBatchQueue.length = 0;
        this.projectileCaptureReleaseBatchQueue.length = 0;
        this.authenticProjectileCapturePreparationByKey.clear();
        this.pendingProjectileCaptureReadbacks = 0;
        this.pendingProjectileCaptureReleaseReadbacks = 0;
        this.projectileCaptureReadbackCursor = 0;
        this.lastProjectileCaptureSourceTick = 0;
        this.projectileCaptureCompletedThroughTick = 0;
        this.lastProjectileCaptureReleaseCommittedTick = 0;
        this.lastProjectileCaptureRuntimeStatus
            = GPU_PROJECTILE_CAPTURE_TICK_STATUS.RESET;
        this.lastProjectileCaptureErrorFlags = 0;
        const nextRouteAuthoritativeEpoch = this.routeAuthoritativeEpoch + 1;
        if (this.terminalRouteAvailabilityProgramCancelStatus
                ?.state === 'submitted') {
            const routeSnapshot = this.#readHostRouteAvailabilitySnapshot();
            this.terminalRouteAvailabilityProgramCancelStatus = Object.freeze({
                ...this.terminalRouteAvailabilityProgramCancelStatus,
                completedThroughTick: this.routeRuntimeCompletedThroughTick,
                availabilityVersion: routeSnapshot.availabilityVersion,
                closedPathIds: routeSnapshot.closedPathIds,
                failure: null
            });
        }
        this.hostRouteRuntimeStates = createGpuRouteRuntimeStateBuffer(
            this.capacity
        );
        this.hostRouteAvailability = createGpuRouteAvailabilityBuffer(
            this.routeRuntimeTopology,
            {
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: Math.max(0, this.deviceGeneration),
                authoritativeEpoch: nextRouteAuthoritativeEpoch
            }
        );
        this.hostRouteCleanupProgram = createGpuRouteCleanupProgram(
            GPU_ROUTE_RUNTIME_MAX_CLOSERS
        );
        this.routeRuntimeBatchQueue.length = 0;
        this.pendingRouteRuntimeReadbacks = 0;
        this.routeRuntimeReadbackCursor = 0;
        this.routeRuntimeCompletedThroughTick = 0;
        this.lastRouteRuntimeSourceTick = 0;
        this.lastRouteAvailabilityVersion = 1;
        this.lastRouteRuntimeStatus = GPU_ROUTE_RUNTIME_STATUS.OK;
        this.routeRuntimeRosterCount = 0;
        this.stagedRouteCleanupBatch = null;
        this.routeLifecycleReservations.clear();
        this.slotRouteRuntimeDomain.fill(0);
        this.routeAuthoritativeEpoch = nextRouteAuthoritativeEpoch;
        this.authoritativeEpoch = nextAuthoritativeEpoch;
        this.#releaseGpuResources();
        this.state = 'idle';
        this.failure = null;
        return true;
    }

    #beginEventReadback(slot, queueEntry, lease) {
        slot.tick = queueEntry.submittedTick;
        slot.generation = queueEntry.deviceGeneration;
        slot.authoritativeEpoch = queueEntry.authoritativeEpoch;
        slot.lease = lease;
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            const leaseMatches = !this.destroyed
                && lease === this.eventReadbackLease
                && slot.lease === lease;
            const generationMatches = queueEntry.deviceGeneration === this.deviceGeneration
                && slot.generation === this.deviceGeneration;
            const epochMatches = queueEntry.authoritativeEpoch === this.authoritativeEpoch
                && slot.authoritativeEpoch === this.authoritativeEpoch;
            if (!leaseMatches || !generationMatches || !epochMatches) {
                try {
                    slot.buffer.unmap();
                } catch {
                    // cancelled/destroyed staging buffer may already be unmapped
                }
                if (leaseMatches) {
                    this.#releaseClaimedEventReadbackSlot(slot);
                    this.#removeEventQueueEntry(queueEntry);
                    if (queueEntry.controlQueueEntry) {
                        queueEntry.controlQueueEntry.failure = Object.freeze({
                            stage: 'body-control-program-readback',
                            name: 'BodyControlProgramGenerationMismatch',
                            message: 'BodyControlProgram readback generation/epoch가 현재 session과 다릅니다.'
                        });
                        queueEntry.controlQueueEntry.outcomes = Object.freeze([]);
                        queueEntry.controlQueueEntry.completed = true;
                    }
                    this.#advanceEventCompletionWatermark();
                } else {
                    slot.inFlight = false;
                }
                return;
            }

            let rawContactCount = 0;
            let contactOverflow = 0;
            let rawAppliedCount = 0;
            let appliedOverflow = 0;
            let rawDeathCount = 0;
            let deathOverflow = 0;
            let maximumDamageWindowEventCount = 0;
            let maximumDamageWindowProtocolStatus = MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_OK;
            let coreDamageRequestEventCount = 0;
            let coreDamageRequestProtocolStatus = CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_OK;
            let atomicTransformCandidateCount = 0;
            let atomicTransformEventBase = 0;
            let atomicTransformProtocolStatus = 0;
            let atomicTransformCommittedCount = 0;
            let priorityTargetControlOutcomes = Object.freeze([]);
            let events;
            try {
                const mappedRange = slot.buffer.getMappedRange();
                const view = new DataView(mappedRange);
                const abiStatus = view.getUint32(
                    CONTACT_STATE_ABI_STATUS_OFFSET,
                    LITTLE_ENDIAN
                );
                const eventEncodingVersion = view.getUint32(
                    CONTACT_STATE_EVENT_ENCODING_VERSION_OFFSET,
                    LITTLE_ENDIAN
                );
                if (abiStatus !== CONTACT_STATE_ABI_STATUS_OK
                    || eventEncodingVersion !== GPU_CIRCLE_BODY_ABI_VERSION) {
                    throw new RangeError(
                        `GPU contact ABI status mismatch: status=${abiStatus}, eventVersion=${eventEncodingVersion}, expected=${GPU_CIRCLE_BODY_ABI_VERSION}`
                    );
                }
                maximumDamageWindowEventCount = view.getUint32(
                    CONTACT_STATE_MAXIMUM_DAMAGE_WINDOW_EVENT_COUNT_OFFSET,
                    LITTLE_ENDIAN
                );
                maximumDamageWindowProtocolStatus = view.getUint32(
                    CONTACT_STATE_MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_OFFSET,
                    LITTLE_ENDIAN
                );
                if (maximumDamageWindowProtocolStatus
                    !== MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_OK) {
                    throw new RangeError(
                        `GPU Maximum Damage Window protocol failure: status=${maximumDamageWindowProtocolStatus}, preflightEvents=${maximumDamageWindowEventCount}`
                    );
                }
                coreDamageRequestEventCount = view.getUint32(
                    CONTACT_STATE_CORE_DAMAGE_REQUEST_EVENT_COUNT_OFFSET,
                    LITTLE_ENDIAN
                );
                coreDamageRequestProtocolStatus = view.getUint32(
                    CONTACT_STATE_CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_OFFSET,
                    LITTLE_ENDIAN
                );
                if (coreDamageRequestProtocolStatus
                    !== CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_OK) {
                    throw new RangeError(
                        `GPU Core damage request protocol failure: status=${coreDamageRequestProtocolStatus}, preflightEvents=${coreDamageRequestEventCount}`
                    );
                }
                atomicTransformCandidateCount = view.getUint32(
                    CONTACT_STATE_ATOMIC_TRANSFORM_CANDIDATE_COUNT_OFFSET,
                    LITTLE_ENDIAN
                );
                atomicTransformEventBase = view.getUint32(
                    CONTACT_STATE_ATOMIC_TRANSFORM_EVENT_BASE_OFFSET,
                    LITTLE_ENDIAN
                );
                atomicTransformProtocolStatus = view.getUint32(
                    CONTACT_STATE_ATOMIC_TRANSFORM_PROTOCOL_STATUS_OFFSET,
                    LITTLE_ENDIAN
                );
                atomicTransformCommittedCount = view.getUint32(
                    CONTACT_STATE_ATOMIC_TRANSFORM_COMMITTED_COUNT_OFFSET,
                    LITTLE_ENDIAN
                );
                if (atomicTransformProtocolStatus !== 0
                    || atomicTransformCandidateCount
                        !== atomicTransformCommittedCount
                    || atomicTransformEventBase + atomicTransformCandidateCount
                        > this.eventCapacity) {
                    throw new RangeError(
                        `GPU Atomic Transform first-hit protocol failure: status=${atomicTransformProtocolStatus}, candidates=${atomicTransformCandidateCount}, committed=${atomicTransformCommittedCount}, eventBase=${atomicTransformEventBase}`
                    );
                }
                if (queueEntry.expectedControlCount > 0) {
                    const controlHeader = GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER;
                    const controlProgramOffset
                        = eventReadbackControlProgramOffset(
                            this.eventCapacity,
                            this.deathEventCapacity
                        );
                    const controlAbiVersion = view.getUint32(
                        controlProgramOffset
                            + controlHeader.ABI_VERSION,
                        LITTLE_ENDIAN
                    );
                    const controlCount = view.getUint32(
                        controlProgramOffset + controlHeader.COUNT,
                        LITTLE_ENDIAN
                    );
                    const controlCapacity = view.getUint32(
                        controlProgramOffset + controlHeader.CAPACITY,
                        LITTLE_ENDIAN
                    );
                    const controlStatus = view.getUint32(
                        controlProgramOffset + controlHeader.STATUS,
                        LITTLE_ENDIAN
                    );
                    if (controlAbiVersion !== GPU_BODY_CONTROL_PROGRAM_ABI_VERSION
                        || controlCount !== queueEntry.expectedControlCount
                        || controlCapacity !== this.controlCommandCapacity
                        || controlStatus !== GPU_FIXED_PROGRAM_STATUS.OK) {
                        throw new RangeError(
                            `GPU body control ABI status mismatch: version=${controlAbiVersion}, count=${controlCount}, capacity=${controlCapacity}, status=${controlStatus}`
                        );
                    }
                    const controlProgramBytes = mappedRange.slice(
                        controlProgramOffset,
                        controlProgramOffset
                            + this.hostBodyControlProgram.buffer.byteLength
                    );
                    const controlStorage = {
                        capacity: this.controlCommandCapacity,
                        buffer: controlProgramBytes
                    };
                    readGpuBodyControlProgramHeader(controlStorage);
                    const outcomes = [];
                    for (let index = 0; index < controlCount; index++) {
                        const record = readGpuBodyControlProgramRecord(
                            controlStorage,
                            index
                        );
                        const expected = queueEntry.expectedControls[index];
                        if (!expected
                            || record.destinationSlot !== expected.destinationSlot
                            || record.entityId !== expected.entityId
                            || record.incarnation !== expected.incarnation
                            || record.modeFlags !== expected.modeFlags) {
                            throw new RangeError(
                                `BodyControlProgram immutable result mismatch: index=${index}`
                            );
                        }
                        if (record.modeFlags
                            === GPU_BODY_CONTROL_PROGRAM_MODE.MOVE_INTENT) {
                            if (record.result
                                    !== GPU_BODY_CONTROL_PROGRAM_RESULT.PENDING
                                || record.selectedTargetKind
                                    !== GPU_BODY_CONTROL_SELECTED_TARGET_KIND.NONE
                                || record.selectedTargetSlot
                                    !== GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT
                                || record.stateFlags !== 0) {
                                throw new RangeError(
                                    `move BodyControlProgram output contract mismatch: index=${index}`
                                );
                            }
                            continue;
                        }
                        if (record.sourceTick !== queueEntry.sourceTick
                            || record.selectionSequence
                                !== expected.selectionSequence
                            || record.attackFingerprint
                                !== expected.attackFingerprint
                            || record.attackRange
                                !== Math.fround(expected.attackRange)
                            || record.selectionPolicy
                                !== GPU_BODY_CONTROL_SELECTION_POLICY
                                    .CORE_FIRST_IN_RANGE_THEN_TOWER
                            || record.coreTargetSlot !== expected.coreTargetSlot
                            || record.coreTargetEntityId
                                !== expected.coreTargetEntityId
                            || record.coreTargetIncarnation
                                !== expected.coreTargetIncarnation
                            || record.towerTargetSlot !== expected.towerTargetSlot
                            || record.towerTargetEntityId
                                !== expected.towerTargetEntityId
                            || record.towerTargetIncarnation
                                !== expected.towerTargetIncarnation) {
                            throw new RangeError(
                                `priority BodyControlProgram input echo mismatch: index=${index}`
                            );
                        }
                        let outcome = null;
                        let selectedTargetKind
                            = GPU_BODY_CONTROL_SELECTED_TARGET_KIND.NONE;
                        let selectedTargetHandle = null;
                        let expectedStateFlags = 0;
                        if (record.result
                            === GPU_BODY_CONTROL_PROGRAM_RESULT.NO_TARGET) {
                            outcome = 'no-target';
                            expectedStateFlags =
                                GPU_BODY_CONTROL_STATE_FLAGS.ROUTE_FLOW;
                        } else if (record.result
                            === GPU_BODY_CONTROL_PROGRAM_RESULT.CORE_SELECTED) {
                            outcome = 'core';
                            selectedTargetKind
                                = GPU_BODY_CONTROL_SELECTED_TARGET_KIND.CORE;
                            selectedTargetHandle = expected.coreTargetHandle;
                            expectedStateFlags = GPU_BODY_CONTROL_STATE_FLAGS.STOP
                                | GPU_BODY_CONTROL_STATE_FLAGS.CORE_SELECTED;
                        } else if (record.result
                            === GPU_BODY_CONTROL_PROGRAM_RESULT.TOWER_SELECTED) {
                            outcome = 'tower';
                            selectedTargetKind
                                = GPU_BODY_CONTROL_SELECTED_TARGET_KIND.TOWER;
                            selectedTargetHandle = expected.towerTargetHandle;
                            expectedStateFlags = GPU_BODY_CONTROL_STATE_FLAGS.STOP
                                | GPU_BODY_CONTROL_STATE_FLAGS.TOWER_SELECTED;
                        } else if (record.result
                            === GPU_BODY_CONTROL_PROGRAM_RESULT.SOURCE_INVALID) {
                            outcome = 'source-invalid';
                        } else if (record.result
                            === GPU_BODY_CONTROL_PROGRAM_RESULT.CORE_INVALID) {
                            outcome = 'core-invalid';
                        } else {
                            throw new RangeError(
                                `priority BodyControlProgram result가 올바르지 않습니다: index=${index}, result=${record.result}`
                            );
                        }
                        const expectedTargetSlot = selectedTargetKind
                                === GPU_BODY_CONTROL_SELECTED_TARGET_KIND.CORE
                            ? expected.coreTargetSlot
                            : selectedTargetKind
                                === GPU_BODY_CONTROL_SELECTED_TARGET_KIND.TOWER
                                ? expected.towerTargetSlot
                                : GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT;
                        const expectedTargetEntityId = selectedTargetHandle?.entityId
                            ?? GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT;
                        const expectedTargetIncarnation
                            = selectedTargetHandle?.incarnation
                            ?? GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT;
                        if (record.selectedTargetKind !== selectedTargetKind
                            || record.selectedTargetSlot !== expectedTargetSlot
                            || record.selectedTargetEntityId
                                !== expectedTargetEntityId
                            || record.selectedTargetIncarnation
                                !== expectedTargetIncarnation
                            || record.stateFlags !== expectedStateFlags) {
                            throw new RangeError(
                                `priority BodyControlProgram selected output mismatch: index=${index}`
                            );
                        }
                        outcomes.push(Object.freeze({
                            sourceHandle: expected.sourceHandle,
                            coreTargetHandle: expected.coreTargetHandle,
                            towerTargetHandle: expected.towerTargetHandle,
                            sourceTick: record.sourceTick,
                            selectionSequence: record.selectionSequence,
                            attackFingerprint: record.attackFingerprint,
                            attackRangeTiles: expected.attackRangeTiles,
                            result: record.result,
                            outcome,
                            selectedTargetKind,
                            stateFlags: record.stateFlags,
                            selectedTargetHandle
                        }));
                    }
                    priorityTargetControlOutcomes = Object.freeze(outcomes);
                }
                rawContactCount = view.getUint32(0, LITTLE_ENDIAN);
                contactOverflow = view.getUint32(4, LITTLE_ENDIAN);
                rawAppliedCount = view.getUint32(8, LITTLE_ENDIAN);
                appliedOverflow = view.getUint32(12, LITTLE_ENDIAN);
                rawDeathCount = view.getUint32(16, LITTLE_ENDIAN);
                deathOverflow = view.getUint32(20, LITTLE_ENDIAN);
                const appliedCount = Math.min(rawAppliedCount, this.eventCapacity);
                const deathCount = Math.min(rawDeathCount, this.deathEventCapacity);
                events = new Array(appliedCount + deathCount);
                for (let index = 0; index < appliedCount; index++) {
                    events[index] = decodeAppliedEvent(
                        view,
                        EVENT_READBACK_HEADER_BYTE_SIZE
                            + (index * APPLIED_EVENT_BYTE_SIZE),
                        index
                    );
                }
                const deathOffset = EVENT_READBACK_HEADER_BYTE_SIZE
                    + (this.eventCapacity * APPLIED_EVENT_BYTE_SIZE);
                for (let index = 0; index < deathCount; index++) {
                    events[appliedCount + index] = decodeDeathEvent(
                        view,
                        deathOffset + (index * DEATH_EVENT_BYTE_SIZE),
                        appliedCount + index
                    );
                }
                events = Object.freeze(events);
            } finally {
                slot.buffer.unmap();
            }

            this.#releaseClaimedEventReadbackSlot(slot);
            this.lastEventReadbackCompletedTick = Math.max(
                this.lastEventReadbackCompletedTick,
                queueEntry.submittedTick
            );
            if (queueEntry.submittedTick >= this.lastEventStatsTick) {
                this.lastEventStatsTick = queueEntry.submittedTick;
                this.lastContactCount = Math.min(rawContactCount, this.contactCapacity);
                this.lastContactOverflowCount = contactOverflow;
                this.lastAppliedEventCount = Math.min(rawAppliedCount, this.eventCapacity);
                this.lastAppliedEventOverflowCount = appliedOverflow;
                this.lastDeathEventCount = Math.min(rawDeathCount, this.deathEventCapacity);
                this.lastDeathEventOverflowCount = deathOverflow;
            }

            const contactCapacityExceeded = rawContactCount > this.contactCapacity
                || contactOverflow > 0;
            const eventCapacityExceeded = rawAppliedCount > this.eventCapacity
                || rawDeathCount > this.deathEventCapacity
                || appliedOverflow > 0
                || deathOverflow > 0;
            if (contactCapacityExceeded || eventCapacityExceeded) {
                this.#degradeForContactEventOverflow(
                    contactCapacityExceeded ? 'contact' : 'event',
                    queueEntry.submittedTick,
                    {
                        rawContactCount,
                        contactOverflow,
                        rawAppliedCount,
                        appliedOverflow,
                        rawDeathCount,
                        deathOverflow,
                        maximumDamageWindowEventCount,
                        maximumDamageWindowProtocolStatus,
                        coreDamageRequestEventCount,
                        coreDamageRequestProtocolStatus,
                        atomicTransformCandidateCount,
                        atomicTransformEventBase,
                        atomicTransformProtocolStatus,
                        atomicTransformCommittedCount
                    }
                );
                return;
            }

            queueEntry.events = events;
            queueEntry.completed = true;
            if (queueEntry.controlQueueEntry) {
                queueEntry.controlQueueEntry.outcomes
                    = priorityTargetControlOutcomes;
                queueEntry.controlQueueEntry.completed = true;
                this.lastBodyControlOutcomeCount
                    += priorityTargetControlOutcomes.length;
            }
            this.#advanceEventCompletionWatermark();
            this.#recoverEventBackpressureIfPossible();
        }).catch((error) => {
            if (this.destroyed
                || lease !== this.eventReadbackLease
                || queueEntry.deviceGeneration !== this.deviceGeneration
                || slot.lease !== lease) {
                slot.inFlight = false;
                return;
            }
            this.#releaseClaimedEventReadbackSlot(slot);
            this.#removeEventQueueEntry(queueEntry);
            this.requiresAuthoritativeRebuild = this.activeBodyCount > 0;
            this.failure = captureFailure('event-readback', error);
            if (queueEntry.controlQueueEntry) {
                queueEntry.controlQueueEntry.failure = this.failure;
                queueEntry.controlQueueEntry.outcomes = Object.freeze([]);
                queueEntry.controlQueueEntry.completed = true;
            }
            this.state = this.requiresAuthoritativeRebuild
                ? 'requires-rebuild'
                : 'failed';
            if (this.requiresAuthoritativeRebuild) {
                this.presentationClock.synchronize();
                this.#releaseGpuResources();
            }
        });
    }

    #degradeForContactEventOverflow(kind, tick, counts) {
        this.requiresAuthoritativeRebuild = true;
        this.state = `${kind}-overflow-degraded`;
        this.presentationClock.synchronize();
        this.failure = Object.freeze({
            stage: `${kind}-overflow`,
            name: kind === 'contact' ? 'ContactCapacityExceeded' : 'EventCapacityExceeded',
            message: `GPU ${kind} overflow가 감지되었습니다: tick=${tick}, contact=${counts.rawContactCount}/${this.contactCapacity}, contactOverflow=${counts.contactOverflow}, applied=${counts.rawAppliedCount}/${this.eventCapacity}, appliedOverflow=${counts.appliedOverflow}, death=${counts.rawDeathCount}/${this.deathEventCapacity}, deathOverflow=${counts.deathOverflow}`
        });
        this.#cancelEventReadbacks();
    }

    #cancelEventReadbacks() {
        this.eventReadbackLease++;
        for (const slot of this.eventReadbackSlots) {
            slot.inFlight = false;
            try {
                slot.buffer?.destroy?.();
            } catch {
                // mapping/device loss 중인 staging buffer는 best-effort로 정리합니다.
            }
        }
        this.eventReadbackSlots = [];
        this.pendingEventReadbacks = 0;
        this.eventReadbackCursor = 0;
        this.eventBatchQueue.length = 0;
        this.bodyControlProgramBatchQueue.length = 0;
    }

    #hasFreeOverflowReadbackSlot() {
        return this.overflowReadbackSlots.some((slot) => !slot.inFlight);
    }

    #claimOverflowReadbackSlot() {
        const slotCount = this.overflowReadbackSlots.length;
        for (let offset = 0; offset < slotCount; offset++) {
            const index = (this.overflowReadbackCursor + offset) % slotCount;
            const slot = this.overflowReadbackSlots[index];
            if (slot.inFlight) {
                continue;
            }
            slot.inFlight = true;
            this.pendingOverflowReadbacks++;
            this.overflowReadbackCursor = (index + 1) % slotCount;
            return slot;
        }
        return null;
    }

    #releaseClaimedOverflowReadbackSlot(slot) {
        if (!slot?.inFlight) {
            return;
        }
        slot.inFlight = false;
        this.pendingOverflowReadbacks = Math.max(0, this.pendingOverflowReadbacks - 1);
    }

    #recoverTelemetryBackpressureIfPossible() {
        if (this.state !== 'telemetry-backpressure'
            || !this.#hasFreeOverflowReadbackSlot()) {
            return;
        }
        this.state = 'ready';
        this.failure = null;
    }

    #beginOverflowReadback(slot, tick, generation, lease, authoritativeEpoch) {
        slot.tick = tick;
        slot.generation = generation;
        slot.lease = lease;
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            let smallCount = 0;
            let bigCount = 0;
            let totalSmallCount = 0;
            let totalBigCount = 0;
            try {
                const view = new DataView(slot.buffer.getMappedRange());
                smallCount = view.getUint32(0, LITTLE_ENDIAN);
                bigCount = view.getUint32(4, LITTLE_ENDIAN);
                totalSmallCount = view.getUint32(8, LITTLE_ENDIAN);
                totalBigCount = view.getUint32(12, LITTLE_ENDIAN);
            } finally {
                slot.buffer.unmap();
            }
            if (this.destroyed
                || lease !== this.overflowReadbackLease
                || generation !== this.deviceGeneration
                || slot.lease !== lease) {
                slot.inFlight = false;
                return;
            }
            let recoverTelemetryBackpressure = false;
            try {
                if (authoritativeEpoch !== this.authoritativeEpoch
                    || this.state === 'contact-overflow-degraded'
                    || this.state === 'event-overflow-degraded') {
                    return;
                }
                this.lastOverflowSampleCompletedTick = Math.max(
                    this.lastOverflowSampleCompletedTick,
                    tick
                );
                if (tick >= this.lastOverflowTick) {
                    this.lastOverflowTick = tick;
                    this.lastSmallOverflowCount = smallCount;
                    this.lastBigOverflowCount = bigCount;
                }
                this.totalSmallOverflowCount = Math.max(
                    this.totalSmallOverflowCount,
                    totalSmallCount
                );
                this.totalBigOverflowCount = Math.max(
                    this.totalBigOverflowCount,
                    totalBigCount
                );
                if (totalSmallCount === 0 && totalBigCount === 0) {
                    recoverTelemetryBackpressure = true;
                    return;
                }
                this.requiresAuthoritativeRebuild = true;
                this.state = 'overflow-degraded';
                this.presentationClock.synchronize();
                this.#cancelEventReadbacks();
                this.failure = Object.freeze({
                    stage: 'grid-overflow',
                    name: 'GridCapacityExceeded',
                    message: `GPU grid overflow가 감지되었습니다: tick=${tick}, small=${smallCount}, big=${bigCount}, totalSmall=${totalSmallCount}, totalBig=${totalBigCount}`
                });
            } finally {
                this.#releaseClaimedOverflowReadbackSlot(slot);
                if (recoverTelemetryBackpressure) {
                    this.#recoverTelemetryBackpressureIfPossible();
                }
                this.#completeDeferredIdleRelease();
            }
        }).catch((error) => {
            if (this.destroyed
                || lease !== this.overflowReadbackLease
                || generation !== this.deviceGeneration
                || slot.lease !== lease) {
                slot.inFlight = false;
                return;
            }
            try {
                if (authoritativeEpoch !== this.authoritativeEpoch
                    || this.state === 'contact-overflow-degraded'
                    || this.state === 'event-overflow-degraded') {
                    return;
                }
                this.requiresAuthoritativeRebuild = this.bodyCount > 0;
                this.failure = captureFailure('overflow-readback', error);
                this.state = this.requiresAuthoritativeRebuild
                    ? 'requires-rebuild'
                    : 'failed';
            } finally {
                this.#releaseClaimedOverflowReadbackSlot(slot);
                this.#completeDeferredIdleRelease();
            }
        });
    }

    #resetOverflowTelemetry() {
        this.lastOverflowTick = 0;
        this.lastSmallOverflowCount = 0;
        this.lastBigOverflowCount = 0;
        this.totalSmallOverflowCount = 0;
        this.totalBigOverflowCount = 0;
        this.telemetryBackpressureCount = 0;
        this.lastOverflowSampleSubmittedTick = 0;
        this.lastOverflowSampleCompletedTick = 0;
        this.overflowSampleOverdue = false;
    }

    #resetContactEventTelemetry() {
        this.eventBatchQueue.length = 0;
        this.bodyControlProgramBatchQueue.length = 0;
        this.eventCompletedThroughTick = 0;
        this.eventBackpressureCount = 0;
        this.lastEventReadbackSourceTick = 0;
        this.lastEventReadbackSubmittedTick = 0;
        this.lastEventReadbackCompletedTick = 0;
        this.lastEventStatsTick = 0;
        this.lastContactCount = 0;
        this.lastContactOverflowCount = 0;
        this.lastAppliedEventCount = 0;
        this.lastAppliedEventOverflowCount = 0;
        this.lastDeathEventCount = 0;
        this.lastDeathEventOverflowCount = 0;
        this.lastBodyControlOutcomeCount = 0;
    }

    #validateDeviceLimits(device) {
        const storageBuffersPerStage = Number(
            device.limits.maxStorageBuffersPerShaderStage
        );
        if (!Number.isFinite(storageBuffersPerStage)
            || storageBuffersPerStage < REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE) {
            throw new RangeError(
                `GPU circle compute storage buffer limit가 부족합니다: required=${REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE}, device=${storageBuffersPerStage}`
            );
        }
        const gridBodyBytes = this.gridEntryCapacity * GPU_CIRCLE_BODY_ABI.GRID_BODY.STRIDE;
        const eventReadbackBytes = EVENT_READBACK_HEADER_BYTE_SIZE
            + (this.eventCapacity * APPLIED_EVENT_BYTE_SIZE)
            + (this.deathEventCapacity * DEATH_EVENT_BYTE_SIZE)
            + this.hostBodyControlProgram.buffer.byteLength;
        const spawnProgramBytes = GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STRIDE
            + (this.spawnProgramCapacity
                * GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.STRIDE);
        const effectProgramBytes = GPU_EFFECT_RUNTIME_ABI.PROGRAM_HEADER.STRIDE
            + (this.effectPulseProgramCapacity
                * GPU_EFFECT_RUNTIME_ABI.PULSE_PROGRAM_RECORD.STRIDE);
        const effectReadbackBytes = effectReadbackByteSize(
            this.effectPulseProgramCapacity,
            this.effectEventCapacity
        );
        const largestStorageBinding = Math.max(
            gridBodyBytes,
            this.capacity * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE,
            this.capacity * GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE,
            this.capacity * GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE,
            this.capacity * GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE.STRIDE,
            this.capacity * GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_CANDIDATE.STRIDE,
            this.capacity * GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE,
            this.contactCapacity * CONTACT_RECORD_BYTE_SIZE,
            this.eventCapacity * APPLIED_EVENT_BYTE_SIZE,
            this.deathEventCapacity * DEATH_EVENT_BYTE_SIZE,
            this.sdf.values.byteLength,
            this.capacity * BODY_CONTROL_STATE_STRIDE,
            spawnProgramBytes,
            effectProgramBytes,
            this.capacity * GPU_EFFECT_RUNTIME_ABI.SUMMARY.STRIDE,
            this.effectInstanceCapacity * GPU_EFFECT_RUNTIME_ABI.INSTANCE.STRIDE,
            this.effectCandidateCapacity * GPU_EFFECT_RUNTIME_ABI.CANDIDATE.STRIDE,
            this.effectEventCapacity * GPU_EFFECT_RUNTIME_ABI.EVENT.STRIDE,
            this.capacity * GPU_FORMATION_RUNTIME_ABI.BODY_STATE.STRIDE,
            this.capacity * GPU_FORMATION_RUNTIME_ABI.CANDIDATE_STATE.STRIDE,
            this.hostFormationPrepareProgram.buffer.byteLength,
            this.hostFormationTransformProgram.buffer.byteLength,
            this.hostAtomicTransformPrepareProgram.buffer.byteLength,
            this.hostAtomicTransformProgram.buffer.byteLength,
            this.hostAtomicTransformTemplateStorage.enemyBehaviorStateBuffer
                .byteLength
        );
        if (largestStorageBinding > Number(device.limits.maxStorageBufferBindingSize)
            || Math.max(
                largestStorageBinding,
                eventReadbackBytes,
                effectReadbackBytes
            )
                > Number(device.limits.maxBufferSize)) {
            throw new RangeError(
                `GPU circle buffer가 adapter limit를 초과합니다: ${largestStorageBinding}`
            );
        }
        const largestDirectDispatch = Math.max(
            this.gridCellTotal,
            Math.ceil(this.contactCapacity / BODY_WORKGROUP_SIZE),
            Math.ceil(this.effectInstanceCapacity / BODY_WORKGROUP_SIZE)
        );
        if (largestDirectDispatch > Number(device.limits.maxComputeWorkgroupsPerDimension)) {
            throw new RangeError(
                `compute workgroup 수가 adapter limit를 초과합니다: ${largestDirectDispatch}`
            );
        }
        if (COMPUTE_PARAMS_BYTE_SIZE > Number(device.limits.maxUniformBufferBindingSize)) {
            throw new RangeError(
                `GPU flow-stage uniform이 adapter limit를 초과합니다: ${COMPUTE_PARAMS_BYTE_SIZE}`
            );
        }
        if (this.flowFieldAtlas.cols > Number(device.limits.maxTextureDimension2D)
            || this.flowFieldAtlas.rows > Number(device.limits.maxTextureDimension2D)
            || Math.max(1, this.flowFieldAtlas.fieldCount)
                > Number(device.limits.maxTextureArrayLayers)) {
            throw new RangeError('GPU flow-field atlas가 adapter texture limit를 초과합니다.');
        }
    }

    #createGpuResources(device, format) {
        const usage = globalThis.GPUBufferUsage;
        const textureUsage = globalThis.GPUTextureUsage;
        const stage = globalThis.GPUShaderStage;
        const mapMode = globalThis.GPUMapMode;
        if (!usage || !textureUsage || !stage || !mapMode) {
            throw new Error('WebGPU buffer/texture/shader 상수가 없습니다.');
        }
        this.mapReadMode = mapMode.READ;
        const storageUsage = usage.STORAGE | usage.COPY_DST | usage.COPY_SRC;
        this.buffers = {
            counts: createBuffer(
                device,
                'cirvivor-gpu-circle-counts',
                GPU_CIRCLE_BODY_ABI.COUNTS.STRIDE,
                storageUsage
            ),
            physics: createBuffer(
                device,
                'cirvivor-gpu-circle-physics',
                GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE * this.capacity,
                storageUsage
            ),
            simulation: createBuffer(
                device,
                'cirvivor-gpu-circle-simulation',
                GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE * this.capacity,
                storageUsage
            ),
            temporary: createBuffer(
                device,
                'cirvivor-gpu-circle-temporary',
                GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE * this.capacity,
                storageUsage
            ),
            contactHandlers: createBuffer(
                device,
                'cirvivor-gpu-circle-contact-handlers',
                GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE * this.capacity,
                storageUsage
            ),
            combatStates: createBuffer(
                device,
                'cirvivor-gpu-circle-combat-states',
                GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE * this.capacity,
                storageUsage
            ),
            atomicTransformStates: createBuffer(
                device,
                'cirvivor-gpu-circle-atomic-transform-states',
                GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE.STRIDE * this.capacity,
                storageUsage
            ),
            atomicTransformCandidates: createBuffer(
                device,
                'cirvivor-gpu-circle-atomic-transform-candidates',
                GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_CANDIDATE.STRIDE
                    * this.capacity,
                storageUsage
            ),
            projectileCaptureStates: createBuffer(
                device,
                'cirvivor-gpu-projectile-capture-states',
                GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE.STRIDE * this.capacity,
                storageUsage
            ),
            projectileCaptureCandidates: createBuffer(
                device,
                'cirvivor-gpu-projectile-capture-candidates',
                GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_CANDIDATE.STRIDE
                    * this.capacity,
                storageUsage
            ),
            projectileCaptureRuntime: createBuffer(
                device,
                'cirvivor-gpu-projectile-capture-runtime',
                this.hostProjectileCaptureTick.buffer.byteLength,
                storageUsage
            ),
            projectileCaptureReleaseProgram: createBuffer(
                device,
                'cirvivor-gpu-projectile-capture-release-program',
                this.hostProjectileCaptureReleaseProgram.buffer.byteLength,
                storageUsage
            ),
            projectileCaptureParams: createBuffer(
                device,
                'cirvivor-gpu-projectile-capture-params',
                PROJECTILE_CAPTURE_PARAMS_BYTE_SIZE,
                usage.UNIFORM | usage.COPY_DST
            ),
            projectileCaptureTargetConfig: createBuffer(
                device,
                'cirvivor-gpu-projectile-capture-target-config',
                PROJECTILE_CAPTURE_TARGET_CONFIG_BYTE_SIZE,
                usage.UNIFORM | usage.COPY_DST
            ),
            routeRuntimeStates: createBuffer(
                device,
                'cirvivor-gpu-route-runtime-states',
                GPU_ROUTE_RUNTIME_ABI.BODY_STATE.STRIDE * this.capacity,
                storageUsage
            ),
            routeRuntimeTopology: createBuffer(
                device,
                'cirvivor-gpu-route-runtime-topology',
                this.routeRuntimeTopology.buffer.byteLength,
                usage.STORAGE | usage.COPY_DST
            ),
            routeAvailability: createBuffer(
                device,
                'cirvivor-gpu-route-availability',
                this.hostRouteAvailability.byteLength,
                storageUsage
            ),
            routeCleanupProgram: createBuffer(
                device,
                'cirvivor-gpu-route-cleanup-program',
                this.hostRouteCleanupProgram.buffer.byteLength,
                storageUsage
            ),
            routeRuntimeParams: createBuffer(
                device,
                'cirvivor-gpu-route-runtime-params',
                GPU_ROUTE_RUNTIME_ABI.PARAMS.STRIDE,
                usage.UNIFORM | usage.COPY_DST
            ),
            enemyBehaviorStates: createBuffer(
                device,
                'cirvivor-gpu-circle-enemy-behavior-states',
                GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE * this.capacity,
                storageUsage
            ),
            effectSummaries: createBuffer(
                device,
                'cirvivor-gpu-effect-summaries',
                GPU_EFFECT_RUNTIME_ABI.SUMMARY.STRIDE * this.capacity,
                storageUsage
            ),
            effectEmitterStates: createBuffer(
                device,
                'cirvivor-gpu-effect-emitter-states',
                GPU_EFFECT_RUNTIME_ABI.EMITTER_STATE.STRIDE * this.capacity,
                storageUsage
            ),
            effectInstancesA: createBuffer(
                device,
                'cirvivor-gpu-effect-instances-a',
                GPU_EFFECT_RUNTIME_ABI.INSTANCE.STRIDE
                    * this.effectInstanceCapacity,
                storageUsage
            ),
            effectInstancesB: createBuffer(
                device,
                'cirvivor-gpu-effect-instances-b',
                GPU_EFFECT_RUNTIME_ABI.INSTANCE.STRIDE
                    * this.effectInstanceCapacity,
                storageUsage
            ),
            effectPulseProgram: createBuffer(
                device,
                'cirvivor-gpu-effect-pulse-program',
                this.hostEffectPulseProgram.buffer.byteLength,
                storageUsage
            ),
            effectPoolState: createBuffer(
                device,
                'cirvivor-gpu-effect-pool-state',
                GPU_EFFECT_RUNTIME_ABI.POOL_STATE.STRIDE,
                storageUsage
            ),
            effectCandidates: createBuffer(
                device,
                'cirvivor-gpu-effect-candidates',
                GPU_EFFECT_RUNTIME_ABI.CANDIDATE.STRIDE
                    * this.effectCandidateCapacity,
                storageUsage
            ),
            effectEvents: createBuffer(
                device,
                'cirvivor-gpu-effect-events',
                GPU_EFFECT_RUNTIME_ABI.EVENT.STRIDE * this.effectEventCapacity,
                storageUsage
            ),
            formationStates: createBuffer(
                device,
                'cirvivor-gpu-formation-states',
                GPU_FORMATION_RUNTIME_ABI.BODY_STATE.STRIDE * this.capacity,
                storageUsage
            ),
            formationCandidates: createBuffer(
                device,
                'cirvivor-gpu-formation-candidates',
                GPU_FORMATION_RUNTIME_ABI.CANDIDATE_STATE.STRIDE * this.capacity,
                storageUsage
            ),
            formationPrepareProgram: createBuffer(
                device,
                'cirvivor-gpu-formation-prepare-program',
                this.hostFormationPrepareProgram.buffer.byteLength,
                storageUsage
            ),
            formationTransformProgram: createBuffer(
                device,
                'cirvivor-gpu-formation-transform-program',
                this.hostFormationTransformProgram.buffer.byteLength,
                storageUsage
            ),
            atomicTransformPrepareProgram: createBuffer(
                device,
                'cirvivor-gpu-atomic-transform-prepare-program',
                this.hostAtomicTransformPrepareProgram.buffer.byteLength,
                storageUsage
            ),
            atomicTransformProgram: createBuffer(
                device,
                'cirvivor-gpu-atomic-transform-program',
                this.hostAtomicTransformProgram.buffer.byteLength,
                storageUsage
            ),
            atomicTransformTemplatePhysics: createBuffer(
                device,
                'cirvivor-gpu-atomic-transform-template-physics',
                GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE * this.capacity,
                storageUsage
            ),
            atomicTransformTemplateSimulation: createBuffer(
                device,
                'cirvivor-gpu-atomic-transform-template-simulation',
                GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE * this.capacity,
                storageUsage
            ),
            atomicTransformTemplateTemporary: createBuffer(
                device,
                'cirvivor-gpu-atomic-transform-template-temporary',
                GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE * this.capacity,
                storageUsage
            ),
            atomicTransformTemplateContactHandlers: createBuffer(
                device,
                'cirvivor-gpu-atomic-transform-template-contact-handlers',
                GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE * this.capacity,
                storageUsage
            ),
            atomicTransformTemplateCombatStates: createBuffer(
                device,
                'cirvivor-gpu-atomic-transform-template-combat-states',
                GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE * this.capacity,
                storageUsage
            ),
            atomicTransformTemplateStates: createBuffer(
                device,
                'cirvivor-gpu-atomic-transform-template-states',
                GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE.STRIDE * this.capacity,
                storageUsage
            ),
            atomicTransformTemplateEffectSummaries: createBuffer(
                device,
                'cirvivor-gpu-atomic-transform-template-effect-summaries',
                GPU_EFFECT_RUNTIME_ABI.SUMMARY.STRIDE * this.capacity,
                storageUsage
            ),
            atomicTransformTemplateEffectEmitters: createBuffer(
                device,
                'cirvivor-gpu-atomic-transform-template-effect-emitters',
                GPU_EFFECT_RUNTIME_ABI.EMITTER_STATE.STRIDE * this.capacity,
                storageUsage
            ),
            atomicTransformTemplateFormationStates: createBuffer(
                device,
                'cirvivor-gpu-atomic-transform-template-formation-states',
                GPU_FORMATION_RUNTIME_ABI.BODY_STATE.STRIDE * this.capacity,
                storageUsage
            ),
            atomicTransformTemplateRenderStyles: createBuffer(
                device,
                'cirvivor-gpu-atomic-transform-template-render-styles',
                BODY_RENDER_STYLE_STRIDE * this.capacity,
                storageUsage
            ),
            atomicTransformTemplateEnemyBehaviorStates: createBuffer(
                device,
                'cirvivor-gpu-atomic-transform-template-enemy-behavior',
                GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE * this.capacity,
                storageUsage
            ),
            atomicTransformTemplateBodyControlStates: createBuffer(
                device,
                'cirvivor-gpu-atomic-transform-template-body-control',
                BODY_CONTROL_STATE_STRIDE * this.capacity,
                storageUsage
            ),
            bodyControlStates: createBuffer(
                device,
                'cirvivor-gpu-circle-body-control-states',
                BODY_CONTROL_STATE_STRIDE * this.capacity,
                storageUsage
            ),
            bodyControlProgram: createBuffer(
                device,
                'cirvivor-gpu-circle-body-control-program',
                this.hostBodyControlProgram.buffer.byteLength,
                storageUsage
            ),
            spawnProgram: createBuffer(
                device,
                'cirvivor-gpu-circle-spawn-program',
                this.hostSpawnProgram.buffer.byteLength,
                storageUsage
            ),
            trackedPoseConfig: createBuffer(
                device,
                'cirvivor-gpu-circle-tracked-pose-config',
                TRACKED_POSE_CONFIG_BYTE_SIZE,
                usage.STORAGE | usage.COPY_DST
            ),
            trackedPoseOutput: createBuffer(
                device,
                'cirvivor-gpu-circle-tracked-pose-output',
                TRACKED_POSE_RECORD_BYTE_SIZE,
                usage.STORAGE | usage.COPY_SRC | usage.COPY_DST
            ),
            towerGameplayTargetConfig: createBuffer(
                device,
                'cirvivor-gpu-circle-tower-gameplay-target-config',
                TOWER_GAMEPLAY_TARGET_CONFIG_BYTE_SIZE,
                usage.STORAGE | usage.COPY_DST
            ),
            gridCounts: createBuffer(
                device,
                'cirvivor-gpu-circle-grid-counts',
                this.gridCellTotal * GRID_BUCKET_COUNT * Uint32Array.BYTES_PER_ELEMENT,
                storageUsage
            ),
            gridBodies: createBuffer(
                device,
                'cirvivor-gpu-circle-grid-bodies',
                this.gridEntryCapacity * GPU_CIRCLE_BODY_ABI.GRID_BODY.STRIDE,
                storageUsage
            ),
            sdf: createBuffer(
                device,
                'cirvivor-gpu-circle-sdf',
                this.sdf.values.byteLength,
                usage.STORAGE | usage.COPY_DST
            ),
            gridOverflow: createBuffer(
                device,
                'cirvivor-gpu-circle-grid-overflow',
                GRID_OVERFLOW_BYTE_SIZE,
                storageUsage
            ),
            contactState: createBuffer(
                device,
                'cirvivor-gpu-circle-contact-state',
                CONTACT_STATE_BYTE_SIZE,
                storageUsage
            ),
            contacts: createBuffer(
                device,
                'cirvivor-gpu-circle-contacts',
                CONTACT_RECORD_BYTE_SIZE * this.contactCapacity,
                storageUsage
            ),
            appliedEvents: createBuffer(
                device,
                'cirvivor-gpu-circle-applied-events',
                APPLIED_EVENT_BYTE_SIZE * this.eventCapacity,
                storageUsage
            ),
            deathEvents: createBuffer(
                device,
                'cirvivor-gpu-circle-death-events',
                DEATH_EVENT_BYTE_SIZE * this.deathEventCapacity,
                storageUsage
            ),
            computeParams: createBuffer(
                device,
                'cirvivor-gpu-circle-compute-params',
                COMPUTE_PARAMS_BYTE_SIZE,
                usage.UNIFORM | usage.COPY_DST
            ),
            renderStyles: createBuffer(
                device,
                'cirvivor-gpu-circle-render-styles',
                BODY_RENDER_STYLE_STRIDE * this.capacity,
                usage.STORAGE | usage.COPY_DST
            ),
            renderParams: createBuffer(
                device,
                'cirvivor-gpu-circle-render-params',
                RENDER_PARAMS_BYTE_SIZE,
                usage.UNIFORM | usage.COPY_DST
            ),
            dispatchIndirect: createBuffer(
                device,
                'cirvivor-gpu-circle-dispatch-indirect',
                DISPATCH_INDIRECT_BYTE_SIZE,
                usage.STORAGE | usage.INDIRECT | usage.COPY_DST
            ),
            drawIndirect: createBuffer(
                device,
                'cirvivor-gpu-circle-draw-indirect',
                DRAW_INDIRECT_BYTE_SIZE,
                usage.STORAGE | usage.INDIRECT | usage.COPY_DST
            )
        };
        this.flowTexture = device.createTexture({
            label: 'cirvivor-gpu-circle-route-flow-atlas',
            size: {
                width: this.flowFieldAtlas.cols,
                height: this.flowFieldAtlas.rows,
                depthOrArrayLayers: Math.max(1, this.flowFieldAtlas.fieldCount)
            },
            format: 'rg32float',
            usage: textureUsage.TEXTURE_BINDING | textureUsage.COPY_DST
        });
        this.flowIntegrationTexture = device.createTexture({
            label: 'cirvivor-gpu-circle-route-flow-integration-atlas',
            size: {
                width: this.flowFieldAtlas.cols,
                height: this.flowFieldAtlas.rows,
                depthOrArrayLayers: Math.max(1, this.flowFieldAtlas.fieldCount)
            },
            format: 'r32float',
            usage: textureUsage.TEXTURE_BINDING | textureUsage.COPY_DST
        });
        const overflowLease = ++this.overflowReadbackLease;
        this.overflowReadbackSlots = Array.from(
            { length: OVERFLOW_READBACK_SLOT_COUNT },
            (_, index) => ({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-circle-overflow-readback-${index}`,
                    GRID_OVERFLOW_BYTE_SIZE,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                tick: 0,
                generation: this.deviceGeneration,
                lease: overflowLease
            })
        );
        this.overflowReadbackCursor = 0;
        this.pendingOverflowReadbacks = 0;
        const eventReadbackLease = ++this.eventReadbackLease;
        const eventReadbackByteSize = EVENT_READBACK_HEADER_BYTE_SIZE
            + (this.eventCapacity * APPLIED_EVENT_BYTE_SIZE)
            + (this.deathEventCapacity * DEATH_EVENT_BYTE_SIZE)
            + this.hostBodyControlProgram.buffer.byteLength;
        this.eventReadbackSlots = Array.from(
            { length: EVENT_READBACK_SLOT_COUNT },
            (_, index) => ({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-circle-event-readback-${index}`,
                    eventReadbackByteSize,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                tick: 0,
                generation: this.deviceGeneration,
                authoritativeEpoch: this.authoritativeEpoch,
                lease: eventReadbackLease
            })
        );
        this.eventReadbackCursor = 0;
        this.pendingEventReadbacks = 0;
        const projectileCaptureReadbackLease
            = ++this.projectileCaptureReadbackLease;
        const projectileCaptureReadbackByteSize
            = this.hostProjectileCaptureTick.buffer.byteLength
                + this.hostProjectileCaptureReleaseProgram.buffer.byteLength;
        this.projectileCaptureReadbackSlots = Array.from(
            { length: PROJECTILE_CAPTURE_READBACK_SLOT_COUNT },
            (_, index) => ({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-projectile-capture-readback-${index}`,
                    projectileCaptureReadbackByteSize,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                tick: 0,
                generation: this.deviceGeneration,
                authoritativeEpoch: this.authoritativeEpoch,
                lease: projectileCaptureReadbackLease
            })
        );
        this.projectileCaptureReadbackCursor = 0;
        this.pendingProjectileCaptureReadbacks = 0;
        this.pendingProjectileCaptureReleaseReadbacks = 0;
        const routeRuntimeReadbackLease = ++this.routeRuntimeReadbackLease;
        this.routeRuntimeReadbackSlots = Array.from(
            { length: ROUTE_RUNTIME_READBACK_SLOT_COUNT },
            (_, index) => ({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-route-runtime-readback-${index}`,
                    this.hostRouteAvailability.byteLength,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                tick: 0,
                generation: this.deviceGeneration,
                authoritativeEpoch: this.routeAuthoritativeEpoch,
                lease: routeRuntimeReadbackLease
            })
        );
        this.routeRuntimeReadbackCursor = 0;
        this.pendingRouteRuntimeReadbacks = 0;
        const spawnProgramReadbackLease = ++this.spawnProgramReadbackLease;
        this.spawnProgramReadbackSlots = [];
        for (let index = 0; index < SPAWN_PROGRAM_READBACK_SLOT_COUNT; index++) {
            this.spawnProgramReadbackSlots.push({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-circle-spawn-program-readback-${index}`,
                    this.hostSpawnProgram.buffer.byteLength,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                lease: spawnProgramReadbackLease
            });
        }
        this.spawnProgramReadbackCursor = 0;
        this.pendingSpawnProgramReadbacks = 0;
        const effectProgramReadbackLease = ++this.effectProgramReadbackLease;
        this.effectProgramReadbackSlots = [];
        for (let index = 0; index < EFFECT_PROGRAM_READBACK_SLOT_COUNT; index++) {
            this.effectProgramReadbackSlots.push({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-effect-program-readback-${index}`,
                    effectReadbackByteSize(
                        this.effectPulseProgramCapacity,
                        this.effectEventCapacity
                    ),
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                lease: effectProgramReadbackLease
            });
        }
        this.effectProgramReadbackCursor = 0;
        this.pendingEffectReadbacks = 0;
        const formationPrepareLease = ++this.formationPrepareReadbackLease;
        this.formationPrepareReadbackSlots = Array.from(
            { length: FORMATION_PROGRAM_READBACK_SLOT_COUNT },
            (_, index) => ({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-formation-prepare-readback-${index}`,
                    this.hostFormationPrepareProgram.buffer.byteLength,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                lease: formationPrepareLease
            })
        );
        this.formationPrepareReadbackCursor = 0;
        this.pendingFormationPrepareReadbacks = 0;
        const formationTransformLease = ++this.formationTransformReadbackLease;
        this.formationTransformReadbackSlots = Array.from(
            { length: FORMATION_PROGRAM_READBACK_SLOT_COUNT },
            (_, index) => ({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-formation-transform-readback-${index}`,
                    this.hostFormationTransformProgram.buffer.byteLength,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                lease: formationTransformLease
            })
        );
        this.formationTransformReadbackCursor = 0;
        this.pendingFormationTransformReadbacks = 0;
        const atomicPrepareLease = ++this.atomicTransformPrepareReadbackLease;
        this.atomicTransformPrepareReadbackSlots = Array.from(
            { length: FORMATION_PROGRAM_READBACK_SLOT_COUNT },
            (_, index) => ({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-atomic-transform-prepare-readback-${index}`,
                    this.hostAtomicTransformPrepareProgram.buffer.byteLength,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                lease: atomicPrepareLease
            })
        );
        this.atomicTransformPrepareReadbackCursor = 0;
        this.pendingAtomicTransformPrepareReadbacks = 0;
        const atomicTransformLease = ++this.atomicTransformReadbackLease;
        this.atomicTransformReadbackSlots = Array.from(
            { length: FORMATION_PROGRAM_READBACK_SLOT_COUNT },
            (_, index) => ({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-atomic-transform-readback-${index}`,
                    this.hostAtomicTransformProgram.buffer.byteLength,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                lease: atomicTransformLease
            })
        );
        this.atomicTransformReadbackCursor = 0;
        this.pendingAtomicTransformReadbacks = 0;
        const trackedPoseReadbackLease = ++this.trackedPoseReadbackLease;
        this.trackedPoseReadbackSlots = [];
        for (let index = 0; index < TRACKED_POSE_READBACK_SLOT_COUNT; index++) {
            this.trackedPoseReadbackSlots.push({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-circle-tracked-pose-readback-${index}`,
                    TRACKED_POSE_RECORD_BYTE_SIZE,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                lease: trackedPoseReadbackLease
            });
        }
        this.trackedPoseReadbackCursor = 0;
        this.pendingTrackedPoseReadbacks = 0;

        const storageLayoutEntry = (binding, type = 'storage') => ({
            binding,
            visibility: stage.COMPUTE,
            buffer: { type }
        });
        const computeBodiesBaseLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-bodies-base-layout',
            entries: [0, 1, 2, 3].map((binding) => storageLayoutEntry(binding))
        });
        const computeBodiesWithHandlersLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-bodies-with-handlers-layout',
            entries: [
                ...[0, 1, 2, 3].map((binding) => storageLayoutEntry(binding)),
                storageLayoutEntry(4, 'read-only-storage')
            ]
        });
        const computeContactHandlingBodiesLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-contact-handling-bodies-layout',
            entries: [
                storageLayoutEntry(0),
                storageLayoutEntry(1),
                storageLayoutEntry(2),
                storageLayoutEntry(4, 'read-only-storage'),
                storageLayoutEntry(10)
            ]
        });
        const computeMaximumDamageWindowBodiesLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-maximum-damage-window-bodies-layout',
            entries: [
                storageLayoutEntry(0),
                storageLayoutEntry(1),
                storageLayoutEntry(2),
                storageLayoutEntry(4, 'read-only-storage'),
                storageLayoutEntry(10),
                storageLayoutEntry(11)
            ]
        });
        const computeCoreDamageRequestBodiesLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-core-damage-request-bodies-layout',
            entries: [
                storageLayoutEntry(0),
                storageLayoutEntry(1),
                storageLayoutEntry(2),
                storageLayoutEntry(4, 'read-only-storage'),
                storageLayoutEntry(10),
                storageLayoutEntry(11)
            ]
        });
        const computeEnemyBehaviorBodiesLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-enemy-behavior-bodies-layout',
            entries: [
                storageLayoutEntry(0),
                storageLayoutEntry(1),
                storageLayoutEntry(2),
                storageLayoutEntry(11),
                storageLayoutEntry(13, 'read-only-storage')
            ]
        });
        const computeDirectionalDefenseBodiesLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-directional-defense-bodies-layout',
            entries: [
                storageLayoutEntry(0),
                storageLayoutEntry(1),
                storageLayoutEntry(2),
                storageLayoutEntry(3),
                storageLayoutEntry(11),
                storageLayoutEntry(13, 'read-only-storage')
            ]
        });
        const computeAtomicTransformFirstHitBodiesLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-atomic-transform-first-hit-bodies-layout',
            entries: [
                storageLayoutEntry(0),
                storageLayoutEntry(1),
                storageLayoutEntry(2),
                storageLayoutEntry(4, 'read-only-storage'),
                storageLayoutEntry(14),
                storageLayoutEntry(15)
            ]
        });
        const computeWorldFullLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-world-full-layout',
            entries: [
                storageLayoutEntry(0),
                storageLayoutEntry(1),
                storageLayoutEntry(2, 'read-only-storage'),
                storageLayoutEntry(3),
                {
                    binding: 4,
                    visibility: stage.COMPUTE,
                    texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' }
                }
            ]
        });
        const computeWorldGridLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-world-grid-layout',
            entries: [storageLayoutEntry(0), storageLayoutEntry(1)]
        });
        const computeWorldSdfLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-world-sdf-layout',
            entries: [storageLayoutEntry(2, 'read-only-storage')]
        });
        const computeEmptyLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-empty-layout',
            entries: []
        });
        const computeParamsLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-params-layout',
            entries: [{
                binding: 0,
                visibility: stage.COMPUTE,
                buffer: { type: 'uniform' }
            }]
        });
        const computeContactEventsLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-contact-events-layout',
            entries: [storageLayoutEntry(0), storageLayoutEntry(1)]
        });
        const computeAllEventsLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-all-events-layout',
            entries: [0, 1, 2, 3].map((binding) => storageLayoutEntry(binding))
        });
        const computeMaximumDamageWindowEventsLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-maximum-damage-window-events-layout',
            entries: [0, 1, 2].map((binding) => storageLayoutEntry(binding))
        });
        const computeEnemyBehaviorEventsLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-enemy-behavior-events-layout',
            entries: [0, 1, 2].map((binding) => storageLayoutEntry(binding))
        });
        const computeDirectionalDefenseEventsLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-directional-defense-events-layout',
            entries: [0, 1].map((binding) => storageLayoutEntry(binding))
        });
        const computeFixedControlLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-fixed-control-layout',
            entries: [
                storageLayoutEntry(0),
                storageLayoutEntry(1),
                storageLayoutEntry(2),
                storageLayoutEntry(5),
                storageLayoutEntry(6)
            ]
        });
        const computeSourceResolveLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-source-resolve-layout',
            entries: [
                storageLayoutEntry(0),
                storageLayoutEntry(1),
                storageLayoutEntry(2),
                storageLayoutEntry(3),
                storageLayoutEntry(5),
                storageLayoutEntry(7),
                storageLayoutEntry(10),
                storageLayoutEntry(11),
                storageLayoutEntry(12)
            ]
        });
        const computeTrackedPoseLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-tracked-pose-layout',
            entries: [
                storageLayoutEntry(0),
                storageLayoutEntry(1),
                storageLayoutEntry(2),
                storageLayoutEntry(3),
                storageLayoutEntry(8, 'read-only-storage'),
                storageLayoutEntry(9)
            ]
        });
        const indirectLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-indirect-layout',
            entries: [
                { binding: 0, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 1, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: stage.COMPUTE, buffer: { type: 'storage' } }
            ]
        });
        const renderBodyStorageBindings = Object.freeze([
            0, 1, 2, 3, 4, 5, 6, 7, 8
        ]);
        if (renderBodyStorageBindings.length
            !== GPU_FORMATION_RUNTIME_STORAGE_PROFILE.render) {
            throw new RangeError('Formation render storage profile drift');
        }
        const renderBodiesLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-render-bodies-layout',
            entries: renderBodyStorageBindings.map((binding) => ({
                binding,
                visibility: stage.VERTEX,
                buffer: { type: 'read-only-storage' }
            }))
        });
        const renderParamsLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-render-params-layout',
            entries: [{
                binding: 0,
                visibility: stage.VERTEX,
                buffer: { type: 'uniform' }
            }]
        });
        const computeProfileLayouts = {
            [COMPUTE_PIPELINE_PROFILE.PHYSICS]: [
                computeBodiesBaseLayout,
                computeWorldFullLayout,
                computeParamsLayout
            ],
            [COMPUTE_PIPELINE_PROFILE.BODY_CONTACTS]: [
                computeBodiesWithHandlersLayout,
                computeWorldGridLayout,
                computeParamsLayout,
                computeContactEventsLayout
            ],
            [COMPUTE_PIPELINE_PROFILE.WORLD_CONTACTS]: [
                computeBodiesBaseLayout,
                computeWorldSdfLayout,
                computeParamsLayout,
                computeContactEventsLayout
            ],
            [COMPUTE_PIPELINE_PROFILE.CONTACT_HANDLING]: [
                computeContactHandlingBodiesLayout,
                computeEmptyLayout,
                computeParamsLayout,
                computeAllEventsLayout
            ],
            [COMPUTE_PIPELINE_PROFILE.MAXIMUM_DAMAGE_WINDOW]: [
                computeMaximumDamageWindowBodiesLayout,
                computeEmptyLayout,
                computeParamsLayout,
                computeMaximumDamageWindowEventsLayout
            ],
            [COMPUTE_PIPELINE_PROFILE.CORE_DAMAGE_REQUEST]: [
                computeCoreDamageRequestBodiesLayout,
                computeEmptyLayout,
                computeParamsLayout,
                computeMaximumDamageWindowEventsLayout
            ],
            [COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL]: [
                computeFixedControlLayout,
                computeEmptyLayout,
                computeParamsLayout
            ],
            [COMPUTE_PIPELINE_PROFILE.SOURCE_RESOLVE]: [
                computeSourceResolveLayout,
                computeEmptyLayout,
                computeParamsLayout
            ],
            [COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR]: [
                computeEnemyBehaviorBodiesLayout,
                computeEmptyLayout,
                computeParamsLayout,
                computeEnemyBehaviorEventsLayout
            ],
            [COMPUTE_PIPELINE_PROFILE.DIRECTIONAL_DEFENSE_CLASSIFIER]: [
                computeDirectionalDefenseBodiesLayout,
                computeEmptyLayout,
                computeParamsLayout,
                computeDirectionalDefenseEventsLayout
            ],
            [COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT]: [
                computeAtomicTransformFirstHitBodiesLayout,
                computeEmptyLayout,
                computeParamsLayout,
                computeMaximumDamageWindowEventsLayout
            ],
            [COMPUTE_PIPELINE_PROFILE.TRACKED_POSE]: [
                computeTrackedPoseLayout
            ]
        };
        const computePipelineLayouts = Object.fromEntries(
            Object.entries(computeProfileLayouts).map(([profile, bindGroupLayouts]) => [
                profile,
                device.createPipelineLayout({
                    label: `cirvivor-gpu-circle-compute-${profile}-pipeline-layout`,
                    bindGroupLayouts
                })
            ])
        );
        const indirectPipelineLayout = device.createPipelineLayout({
            label: 'cirvivor-gpu-circle-indirect-pipeline-layout',
            bindGroupLayouts: [indirectLayout]
        });
        const renderPipelineLayout = device.createPipelineLayout({
            label: 'cirvivor-gpu-circle-render-pipeline-layout',
            bindGroupLayouts: [renderBodiesLayout, renderParamsLayout]
        });

        const effectBindingPlan = Object.freeze({
            [GPU_EFFECT_RUNTIME_ENTRY_POINT.RESET_TICK]: [[0, 7, 8], [], true],
            [GPU_EFFECT_RUNTIME_ENTRY_POINT.RETAIN_INSTANCES]: [[2, 8, 9, 10], [], true],
            [GPU_EFFECT_RUNTIME_ENTRY_POINT.SCAN_PULSES]: [
                [1, 2, 6, 7, 8, 11], [0, 1, 2], true
            ],
            [GPU_EFFECT_RUNTIME_ENTRY_POINT.MATERIALIZE_BATCH]: [
                [1, 5, 6, 7, 8, 10, 11, 12], [], true
            ],
            [GPU_EFFECT_RUNTIME_ENTRY_POINT.FINISH_TICK]: [[8], [], false],
            [GPU_EFFECT_RUNTIME_ENTRY_POINT.CLEAR_SUMMARIES]: [[0, 2, 5], [], true],
            [GPU_EFFECT_RUNTIME_ENTRY_POINT.ACCUMULATE_SUMMARIES]: [
                [0, 2, 5, 8, 10], [], true
            ],
            [GPU_EFFECT_RUNTIME_ENTRY_POINT.FINALIZE_SUMMARIES]: [[0, 2, 5], [], true],
            [GPU_EFFECT_RUNTIME_ENTRY_POINT.APPLY_REGENERATION]: [[0, 2, 5], [], true],
            [GPU_EFFECT_RUNTIME_ENTRY_POINT.MATERIALIZE_CONTACT_DAMAGE]: [
                [0, 4, 5], [], false
            ],
            [GPU_EFFECT_RUNTIME_ENTRY_POINT.ADVANCE_PENTA_NAVIGATION]: [
                [0, 1, 2, 3, 6], [0, 1, 2, 4, 5, 6], true
            ]
        });
        const effectReadOnlyBodyBindings = new Set([0, 9]);
        const effectWorldStorageBindings = new Set([0, 1, 2, 4]);
        const effectReadOnlyWorldBindings = new Set([1, 4]);
        const effectPipelineLayouts = Object.fromEntries(Object.entries(
            effectBindingPlan
        ).map(([entryPoint, [bodyBindings, worldBindings, usesParams]]) => {
            const storageBindingCount = bodyBindings.length
                + worldBindings.filter((binding) => (
                    effectWorldStorageBindings.has(binding)
                )).length;
            if (new Set(bodyBindings).size !== bodyBindings.length
                || new Set(worldBindings).size !== worldBindings.length
                || storageBindingCount > REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE) {
                throw new RangeError(
                    `Effect ${entryPoint} binding plan이 exact/<=9 계약을 위반합니다.`
                );
            }
            const bodyLayout = device.createBindGroupLayout({
                label: `cirvivor-gpu-effect-${entryPoint}-bodies-layout`,
                entries: bodyBindings.map((binding) => storageLayoutEntry(
                    binding,
                    effectReadOnlyBodyBindings.has(binding)
                        ? 'read-only-storage'
                        : 'storage'
                ))
            });
            const bindGroupLayouts = [bodyLayout];
            if (worldBindings.length > 0 || usesParams) {
                bindGroupLayouts.push(device.createBindGroupLayout({
                    label: `cirvivor-gpu-effect-${entryPoint}-world-layout`,
                    entries: worldBindings.map((binding) => (
                        effectWorldStorageBindings.has(binding)
                            ? storageLayoutEntry(
                                binding,
                                effectReadOnlyWorldBindings.has(binding)
                                    ? 'read-only-storage'
                                    : 'storage'
                            )
                            : {
                                binding,
                                visibility: stage.COMPUTE,
                                texture: {
                                    sampleType: 'unfilterable-float',
                                    viewDimension: '2d-array'
                                }
                            }
                    ))
                }));
            }
            if (usesParams) {
                bindGroupLayouts.push(computeParamsLayout);
            }
            return [entryPoint, device.createPipelineLayout({
                label: `cirvivor-gpu-effect-${entryPoint}-pipeline-layout`,
                bindGroupLayouts
            })];
        }));

        const formationBindingPlan = Object.freeze({
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.CLEAR_CANDIDATES]: [
                [7], [], false
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.SEED_MOTION]: [
                [0, 2, 6, 7], [2], true
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.SELECT_MOTION]: [
                [0, 1, 2, 6, 7], [0, 1, 4, 6], true
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.ADVANCE_MOTION]: [
                [0, 1, 2, 6, 7], [4, 6], true
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.SEED_PREPARE]: [
                [2, 7, 8], [2], false
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.SELECT_PREPARE]: [
                [1, 2, 6, 7, 8, 10], [0, 1, 4, 6], true
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.FINALIZE_PREPARE]: [
                [2, 6, 7, 8, 10], [], false
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.SEAL_PREPARE]: [
                [8], [], false
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.RESET_TRANSFORM]: [
                [9], [], false
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.PREFLIGHT_TRANSFORMS]: [
                [1, 2, 6, 7, 9, 10], [6], true
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.PREFLIGHT_ROUTE_REKEYS]: [
                [9, 17], [], false
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.PREFLIGHT_EFFECT_REKEYS]: [
                [7, 9, 13, 14], [], false
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.SEAL_TRANSFORM]: [
                [7, 9], [], false
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.REKEY_EFFECTS]: [
                [7, 9, 13, 14], [], false
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.COMMIT_BODIES]: [
                [1, 2, 3, 4, 5, 9], [], false
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.COMMIT_ROUTE_STATE]: [
                [9, 17], [], false
            ],
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.COMMIT_AUXILIARY]: [
                [6, 7, 9, 10, 11, 12, 15, 16], [], false
            ]
        });
        const formationReadOnlyBodyBindings = new Set([0]);
        const formationWorldStorageBindings = new Set([0, 1, 2, 4]);
        const formationReadOnlyWorldBindings = new Set([1, 4]);
        const formationPipelineLayouts = Object.fromEntries(Object.entries(
            formationBindingPlan
        ).map(([entryPoint, [bodyBindings, worldBindings, usesParams]]) => {
            const storageBindingCount = bodyBindings.length
                + worldBindings.filter((binding) => (
                    formationWorldStorageBindings.has(binding)
                )).length;
            const expectedStorageBindingCount
                = GPU_FORMATION_RUNTIME_STORAGE_PROFILE.byEntryPoint[entryPoint];
            if (new Set(bodyBindings).size !== bodyBindings.length
                || new Set(worldBindings).size !== worldBindings.length
                || storageBindingCount > REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE
                || storageBindingCount !== expectedStorageBindingCount) {
                throw new RangeError(
                    `Formation ${entryPoint} binding plan이 exact/<=9 계약을 위반합니다.`
                );
            }
            const bodyLayout = device.createBindGroupLayout({
                label: `cirvivor-gpu-formation-${entryPoint}-bodies-layout`,
                entries: bodyBindings.map((binding) => storageLayoutEntry(
                    binding,
                    formationReadOnlyBodyBindings.has(binding)
                        ? 'read-only-storage'
                        : 'storage'
                ))
            });
            const bindGroupLayouts = [bodyLayout];
            if (worldBindings.length > 0 || usesParams) {
                bindGroupLayouts.push(device.createBindGroupLayout({
                    label: `cirvivor-gpu-formation-${entryPoint}-world-layout`,
                    entries: worldBindings.map((binding) => (
                        formationWorldStorageBindings.has(binding)
                            ? storageLayoutEntry(
                                binding,
                                formationReadOnlyWorldBindings.has(binding)
                                    ? 'read-only-storage'
                                    : 'storage'
                            )
                            : {
                                binding,
                                visibility: stage.COMPUTE,
                                texture: {
                                    sampleType: 'unfilterable-float',
                                    viewDimension: '2d-array'
                                }
                            }
                    ))
                }));
            }
            if (usesParams) {
                bindGroupLayouts.push(computeParamsLayout);
            }
            return [entryPoint, device.createPipelineLayout({
                label: `cirvivor-gpu-formation-${entryPoint}-pipeline-layout`,
                bindGroupLayouts
            })];
        }));

        const atomicTransformBindingPlan = Object.freeze({
            [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.CLEAR_PREPARE]: [7],
            [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.PREPARE]: [0, 2, 6, 7, 9],
            [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.CLEAR_TRANSFORM]: [8],
            [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.PREFLIGHT_TRANSFORM]: [
                0, 2, 6, 8, 9, 18, 22, 23, 30
            ],
            [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.PREFLIGHT_EFFECT_REKEYS]: [
                8, 16, 29
            ],
            [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.SEAL_TRANSFORM]: [8],
            [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.REKEY_EFFECTS]: [8, 16, 29],
            [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.COMMIT_BODIES]: [
                1, 2, 3, 8, 17, 18, 19
            ],
            [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.COMMIT_STATE]: [
                4, 5, 6, 8, 20, 21, 22
            ],
            [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.COMMIT_AUXILIARY]: [
                8, 10, 11, 12, 13, 23, 24, 25, 26
            ],
            [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.COMMIT_CONTROL]: [
                8, 14, 15, 27, 28
            ],
            [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.COMMIT_ROUTE_STATE]: [
                8, 30
            ],
            [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.FINALIZE_TRANSFORM]: [8]
        });
        const atomicTransformReadOnlyBindings = new Set([
            0, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28
        ]);
        const atomicTransformPipelineLayouts = Object.fromEntries(
            Object.entries(atomicTransformBindingPlan).map(([
                entryPoint,
                bindings
            ]) => {
                if (new Set(bindings).size !== bindings.length
                    || bindings.length
                        > REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE) {
                    throw new RangeError(
                        `AtomicTransform ${entryPoint} storage profile이 <=9를 위반합니다.`
                    );
                }
                return [entryPoint, device.createPipelineLayout({
                    label: `cirvivor-gpu-atomic-transform-${entryPoint}-layout`,
                    bindGroupLayouts: [device.createBindGroupLayout({
                        label: `cirvivor-gpu-atomic-transform-${entryPoint}-bindings`,
                        entries: bindings.map((binding) => storageLayoutEntry(
                            binding,
                            atomicTransformReadOnlyBindings.has(binding)
                                ? 'read-only-storage'
                                : 'storage'
                        ))
                    })]
                })];
            })
        );
        const projectileCaptureBodiesLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-projectile-capture-bodies-layout',
            entries: [
                storageLayoutEntry(0, 'read-only-storage'),
                storageLayoutEntry(1),
                storageLayoutEntry(2),
                storageLayoutEntry(3),
                storageLayoutEntry(4),
                storageLayoutEntry(5, 'read-only-storage'),
                storageLayoutEntry(6),
                storageLayoutEntry(7),
                storageLayoutEntry(8)
            ]
        });
        const projectileCaptureParamsLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-projectile-capture-params-layout',
            entries: [
                {
                    binding: 0,
                    visibility: stage.COMPUTE,
                    buffer: { type: 'uniform' }
                },
                {
                    binding: 1,
                    visibility: stage.COMPUTE,
                    buffer: { type: 'uniform' }
                }
            ]
        });
        const projectileCapturePipelineLayout = device.createPipelineLayout({
            label: 'cirvivor-gpu-projectile-capture-pipeline-layout',
            bindGroupLayouts: [
                projectileCaptureBodiesLayout,
                projectileCaptureParamsLayout
            ]
        });
        const projectileCaptureReleaseLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-projectile-capture-release-layout',
            entries: [
                storageLayoutEntry(0, 'read-only-storage'),
                storageLayoutEntry(1),
                storageLayoutEntry(2),
                storageLayoutEntry(3),
                storageLayoutEntry(4),
                storageLayoutEntry(5),
                storageLayoutEntry(6)
            ]
        });
        const projectileCaptureReleasePipelineLayout = device.createPipelineLayout({
            label: 'cirvivor-gpu-projectile-capture-release-pipeline-layout',
            bindGroupLayouts: [projectileCaptureReleaseLayout]
        });
        if (GPU_ROUTE_RUNTIME_STORAGE_PROFILE.maximum
            > REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE) {
            throw new RangeError('RouteRuntime storage profile이 <=9 계약을 위반합니다.');
        }
        const routeRuntimeLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-route-runtime-layout',
            entries: [
                storageLayoutEntry(0, 'read-only-storage'),
                storageLayoutEntry(1),
                storageLayoutEntry(2),
                storageLayoutEntry(3),
                storageLayoutEntry(4, 'read-only-storage'),
                storageLayoutEntry(5),
                storageLayoutEntry(6),
                storageLayoutEntry(7),
                storageLayoutEntry(8),
                {
                    binding: 9,
                    visibility: stage.COMPUTE,
                    buffer: { type: 'uniform' }
                }
            ]
        });
        const routeRuntimePipelineLayout = device.createPipelineLayout({
            label: 'cirvivor-gpu-route-runtime-pipeline-layout',
            bindGroupLayouts: [routeRuntimeLayout]
        });
        const routeRuntimeWaitLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-route-runtime-wait-layout',
            entries: [
                storageLayoutEntry(0, 'read-only-storage'),
                storageLayoutEntry(1),
                storageLayoutEntry(2),
                storageLayoutEntry(3),
                {
                    binding: 9,
                    visibility: stage.COMPUTE,
                    buffer: { type: 'uniform' }
                },
                storageLayoutEntry(10)
            ]
        });
        const routeRuntimeWaitPipelineLayout = device.createPipelineLayout({
            label: 'cirvivor-gpu-route-runtime-wait-pipeline-layout',
            bindGroupLayouts: [routeRuntimeWaitLayout]
        });

        const computeModule = device.createShaderModule({
            label: 'cirvivor-gpu-circle-compute-shader',
            code: GPU_COLLISION_COMPUTE_WGSL
        });
        const effectModule = device.createShaderModule({
            label: 'cirvivor-gpu-effect-runtime-compute-shader',
            code: GPU_EFFECT_RUNTIME_COMPUTE_WGSL
        });
        const formationModule = device.createShaderModule({
            label: 'cirvivor-gpu-formation-runtime-compute-shader',
            code: GPU_FORMATION_RUNTIME_COMPUTE_WGSL
        });
        const atomicTransformModule = device.createShaderModule({
            label: 'cirvivor-gpu-atomic-transform-runtime-compute-shader',
            code: GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL
        });
        const projectileCaptureModule = device.createShaderModule({
            label: 'cirvivor-gpu-projectile-capture-runtime-shader',
            code: GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL
        });
        const projectileCaptureReleaseModule = device.createShaderModule({
            label: 'cirvivor-gpu-projectile-capture-release-shader',
            code: GPU_PROJECTILE_CAPTURE_RELEASE_WGSL
        });
        const routeRuntimeModule = device.createShaderModule({
            label: 'cirvivor-gpu-route-runtime-shader',
            code: GPU_ROUTE_RUNTIME_WGSL
        });
        const indirectModule = device.createShaderModule({
            label: 'cirvivor-gpu-circle-indirect-shader',
            code: GPU_COLLISION_INDIRECT_WGSL
        });
        const renderModule = device.createShaderModule({
            label: 'cirvivor-gpu-circle-render-shader',
            code: GPU_COLLISION_RENDER_WGSL
        });
        const compute = Object.fromEntries(COMPUTE_ENTRY_POINTS.map((entryPoint) => {
            const profile = COMPUTE_PIPELINE_PROFILE_BY_ENTRY_POINT[entryPoint];
            return [
                entryPoint,
                device.createComputePipeline({
                    label: `cirvivor-gpu-circle-${entryPoint}`,
                    layout: computePipelineLayouts[profile],
                    compute: { module: computeModule, entryPoint }
                })
            ];
        }));
        const effect = Object.fromEntries(
            Object.values(GPU_EFFECT_RUNTIME_ENTRY_POINT).map((entryPoint) => [
                entryPoint,
                device.createComputePipeline({
                    label: `cirvivor-gpu-effect-${entryPoint}`,
                    layout: effectPipelineLayouts[entryPoint],
                    compute: { module: effectModule, entryPoint }
                })
            ])
        );
        const formation = Object.fromEntries(
            Object.values(GPU_FORMATION_RUNTIME_ENTRY_POINT).map((entryPoint) => [
                entryPoint,
                device.createComputePipeline({
                    label: `cirvivor-gpu-formation-${entryPoint}`,
                    layout: formationPipelineLayouts[entryPoint],
                    compute: { module: formationModule, entryPoint }
                })
            ])
        );
        const atomicTransform = Object.fromEntries(
            Object.values(GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT).map((
                entryPoint
            ) => [
                entryPoint,
                device.createComputePipeline({
                    label: `cirvivor-gpu-atomic-transform-${entryPoint}`,
                    layout: atomicTransformPipelineLayouts[entryPoint],
                    compute: {
                        module: atomicTransformModule,
                        entryPoint
                    }
                })
            ])
        );
        const projectileCapture = Object.fromEntries(
            Object.values(GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT)
                .filter((entryPoint) => ![
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.CLEAR_RELEASES,
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.PREFLIGHT_RELEASES,
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.SEAL_RELEASES,
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.COMMIT_RELEASES,
                    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.FINALIZE_RELEASES
                ].includes(entryPoint))
                .map((entryPoint) => [
                    entryPoint,
                    device.createComputePipeline({
                        label: `cirvivor-gpu-projectile-capture-${entryPoint}`,
                        layout: projectileCapturePipelineLayout,
                        compute: { module: projectileCaptureModule, entryPoint }
                    })
                ])
        );
        const projectileCaptureRelease = Object.fromEntries([
            GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.CLEAR_RELEASES,
            GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.PREFLIGHT_RELEASES,
            GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.SEAL_RELEASES,
            GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.COMMIT_RELEASES,
            GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.FINALIZE_RELEASES
        ].map((entryPoint) => [
            entryPoint,
            device.createComputePipeline({
                label: `cirvivor-gpu-projectile-capture-release-${entryPoint}`,
                layout: projectileCaptureReleasePipelineLayout,
                compute: { module: projectileCaptureReleaseModule, entryPoint }
            })
        ]));
        const routeRuntime = Object.freeze({
            advance: device.createComputePipeline({
                label: 'cirvivor-gpu-route-runtime-advance',
                layout: routeRuntimePipelineLayout,
                compute: {
                    module: routeRuntimeModule,
                    entryPoint: GPU_ROUTE_RUNTIME_ENTRY_POINT.ADVANCE
                }
            }),
            enforceWait: device.createComputePipeline({
                label: 'cirvivor-gpu-route-runtime-enforce-wait',
                layout: routeRuntimeWaitPipelineLayout,
                compute: {
                    module: routeRuntimeModule,
                    entryPoint: GPU_ROUTE_RUNTIME_ENTRY_POINT.ENFORCE_WAIT
                }
            }),
            finalize: device.createComputePipeline({
                label: 'cirvivor-gpu-route-runtime-finalize',
                layout: routeRuntimePipelineLayout,
                compute: {
                    module: routeRuntimeModule,
                    entryPoint: GPU_ROUTE_RUNTIME_ENTRY_POINT.FINALIZE
                }
            })
        });
        this.pipelines = {
            compute,
            effect,
            formation,
            atomicTransform,
            projectileCapture,
            projectileCaptureRelease,
            routeRuntime,
            updateIndirectArgs: device.createComputePipeline({
                label: 'cirvivor-gpu-circle-update-indirect-args',
                layout: indirectPipelineLayout,
                compute: { module: indirectModule, entryPoint: 'update_indirect_args' }
            }),
            render: device.createRenderPipeline({
                label: 'cirvivor-gpu-circle-render',
                layout: renderPipelineLayout,
                vertex: { module: renderModule, entryPoint: 'vertex_main' },
                fragment: {
                    module: renderModule,
                    entryPoint: 'fragment_main',
                    targets: [{
                        format,
                        blend: {
                            color: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add'
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add'
                            }
                        }
                    }]
                },
                primitive: { topology: 'triangle-list' }
            })
        };

        const resource = (buffer) => ({ buffer });
        const effectCommonBodyBuffers = {
            0: this.buffers.counts,
            1: this.buffers.physics,
            2: this.buffers.simulation,
            3: this.buffers.temporary,
            4: this.buffers.contactHandlers,
            5: this.buffers.effectSummaries,
            6: this.buffers.effectEmitterStates,
            7: this.buffers.effectPulseProgram,
            8: this.buffers.effectPoolState,
            11: this.buffers.effectCandidates,
            12: this.buffers.effectEvents
        };
        const effectWorldBuffers = {
            0: this.buffers.gridCounts,
            1: this.buffers.gridBodies,
            2: this.buffers.gridOverflow,
            4: this.buffers.sdf,
            5: this.flowTexture.createView({ dimension: '2d-array' }),
            6: this.flowIntegrationTexture.createView({ dimension: '2d-array' })
        };
        const createEffectBindGroupsForPool = (poolIndex) => {
            const input = poolIndex === 0
                ? this.buffers.effectInstancesA
                : this.buffers.effectInstancesB;
            const output = poolIndex === 0
                ? this.buffers.effectInstancesB
                : this.buffers.effectInstancesA;
            const bodyBuffers = {
                ...effectCommonBodyBuffers,
                9: input,
                10: output
            };
            return Object.fromEntries(Object.entries(effectBindingPlan).map(([
                entryPoint,
                [bodyBindings, worldBindings, usesParams]
            ]) => {
                const pipeline = effect[entryPoint];
                const groups = [];
                groups.push(device.createBindGroup({
                    label: `cirvivor-gpu-effect-${entryPoint}-bodies-${poolIndex}`,
                    layout: pipeline.getBindGroupLayout(0),
                    entries: bodyBindings.map((binding) => ({
                        binding,
                        resource: resource(bodyBuffers[binding])
                    }))
                }));
                if (worldBindings.length > 0 || usesParams) {
                    groups.push(device.createBindGroup({
                        label: `cirvivor-gpu-effect-${entryPoint}-world-${poolIndex}`,
                        layout: pipeline.getBindGroupLayout(1),
                        entries: worldBindings.map((binding) => ({
                            binding,
                            resource: binding === 5 || binding === 6
                                ? effectWorldBuffers[binding]
                                : resource(effectWorldBuffers[binding])
                        }))
                    }));
                }
                if (usesParams) {
                    groups.push(device.createBindGroup({
                        label: `cirvivor-gpu-effect-${entryPoint}-params-${poolIndex}`,
                        layout: pipeline.getBindGroupLayout(2),
                        entries: [{
                            binding: 0,
                            resource: resource(this.buffers.computeParams)
                        }]
                    }));
                }
                return [entryPoint, groups];
            }));
        };
        const effectByPool = [
            createEffectBindGroupsForPool(0),
            createEffectBindGroupsForPool(1)
        ];
        const formationCommonBodyBuffers = {
            0: this.buffers.counts,
            1: this.buffers.physics,
            2: this.buffers.simulation,
            3: this.buffers.temporary,
            4: this.buffers.contactHandlers,
            5: this.buffers.combatStates,
            6: this.buffers.formationStates,
            7: this.buffers.formationCandidates,
            8: this.buffers.formationPrepareProgram,
            9: this.buffers.formationTransformProgram,
            10: this.buffers.effectSummaries,
            11: this.buffers.effectEmitterStates,
            12: this.buffers.renderStyles,
            14: this.buffers.effectPoolState,
            15: this.buffers.enemyBehaviorStates,
            16: this.buffers.bodyControlStates,
            17: this.buffers.routeRuntimeStates
        };
        const formationWorldBuffers = {
            0: this.buffers.gridCounts,
            1: this.buffers.gridBodies,
            2: this.buffers.gridOverflow,
            4: this.buffers.sdf,
            6: this.flowIntegrationTexture.createView({ dimension: '2d-array' })
        };
        const createFormationBindGroupsForPool = (poolIndex) => {
            const bodyBuffers = {
                ...formationCommonBodyBuffers,
                13: poolIndex === 0
                    ? this.buffers.effectInstancesA
                    : this.buffers.effectInstancesB
            };
            return Object.fromEntries(Object.entries(formationBindingPlan).map(([
                entryPoint,
                [bodyBindings, worldBindings, usesParams]
            ]) => {
                const pipeline = formation[entryPoint];
                const groups = [device.createBindGroup({
                    label: `cirvivor-gpu-formation-${entryPoint}-bodies-${poolIndex}`,
                    layout: pipeline.getBindGroupLayout(0),
                    entries: bodyBindings.map((binding) => ({
                        binding,
                        resource: resource(bodyBuffers[binding])
                    }))
                })];
                if (worldBindings.length > 0 || usesParams) {
                    groups.push(device.createBindGroup({
                        label: `cirvivor-gpu-formation-${entryPoint}-world-${poolIndex}`,
                        layout: pipeline.getBindGroupLayout(1),
                        entries: worldBindings.map((binding) => ({
                            binding,
                            resource: binding === 6
                                ? formationWorldBuffers[binding]
                                : resource(formationWorldBuffers[binding])
                        }))
                    }));
                }
                if (usesParams) {
                    groups.push(device.createBindGroup({
                        label: `cirvivor-gpu-formation-${entryPoint}-params-${poolIndex}`,
                        layout: pipeline.getBindGroupLayout(2),
                        entries: [{
                            binding: 0,
                            resource: resource(this.buffers.computeParams)
                        }]
                    }));
                }
                return [entryPoint, groups];
            }));
        };
        const formationByPool = [
            createFormationBindGroupsForPool(0),
            createFormationBindGroupsForPool(1)
        ];
        const atomicTransformCommonBuffers = {
            0: this.buffers.counts,
            1: this.buffers.physics,
            2: this.buffers.simulation,
            3: this.buffers.temporary,
            4: this.buffers.contactHandlers,
            5: this.buffers.combatStates,
            6: this.buffers.atomicTransformStates,
            7: this.buffers.atomicTransformPrepareProgram,
            8: this.buffers.atomicTransformProgram,
            9: this.buffers.effectSummaries,
            10: this.buffers.effectSummaries,
            11: this.buffers.effectEmitterStates,
            12: this.buffers.formationStates,
            13: this.buffers.renderStyles,
            14: this.buffers.enemyBehaviorStates,
            15: this.buffers.bodyControlStates,
            17: this.buffers.atomicTransformTemplatePhysics,
            18: this.buffers.atomicTransformTemplateSimulation,
            19: this.buffers.atomicTransformTemplateTemporary,
            20: this.buffers.atomicTransformTemplateContactHandlers,
            21: this.buffers.atomicTransformTemplateCombatStates,
            22: this.buffers.atomicTransformTemplateStates,
            23: this.buffers.atomicTransformTemplateEffectSummaries,
            24: this.buffers.atomicTransformTemplateEffectEmitters,
            25: this.buffers.atomicTransformTemplateFormationStates,
            26: this.buffers.atomicTransformTemplateRenderStyles,
            27: this.buffers.atomicTransformTemplateEnemyBehaviorStates,
            28: this.buffers.atomicTransformTemplateBodyControlStates,
            29: this.buffers.effectPoolState,
            30: this.buffers.routeRuntimeStates
        };
        const createAtomicTransformBindGroupsForPool = (poolIndex) => {
            const buffers = {
                ...atomicTransformCommonBuffers,
                16: poolIndex === 0
                    ? this.buffers.effectInstancesA
                    : this.buffers.effectInstancesB
            };
            return Object.fromEntries(Object.entries(
                atomicTransformBindingPlan
            ).map(([entryPoint, bindings]) => [
                entryPoint,
                device.createBindGroup({
                    label: `cirvivor-gpu-atomic-transform-${entryPoint}-${poolIndex}`,
                    layout: atomicTransform[entryPoint].getBindGroupLayout(0),
                    entries: bindings.map((binding) => ({
                        binding,
                        resource: resource(buffers[binding])
                    }))
                })
            ]));
        };
        const atomicTransformByPool = [
            createAtomicTransformBindGroupsForPool(0),
            createAtomicTransformBindGroupsForPool(1)
        ];
        const computeBodiesBase = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-bodies-base',
            layout: computeBodiesBaseLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.counts) },
                { binding: 1, resource: resource(this.buffers.physics) },
                { binding: 2, resource: resource(this.buffers.simulation) },
                { binding: 3, resource: resource(this.buffers.temporary) }
            ]
        });
        const computeBodiesWithHandlers = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-bodies-with-handlers',
            layout: computeBodiesWithHandlersLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.counts) },
                { binding: 1, resource: resource(this.buffers.physics) },
                { binding: 2, resource: resource(this.buffers.simulation) },
                { binding: 3, resource: resource(this.buffers.temporary) },
                { binding: 4, resource: resource(this.buffers.contactHandlers) }
            ]
        });
        const computeContactHandlingBodies = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-contact-handling-bodies',
            layout: computeContactHandlingBodiesLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.counts) },
                { binding: 1, resource: resource(this.buffers.physics) },
                { binding: 2, resource: resource(this.buffers.simulation) },
                { binding: 4, resource: resource(this.buffers.contactHandlers) },
                { binding: 10, resource: resource(this.buffers.combatStates) }
            ]
        });
        const computeMaximumDamageWindowBodies = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-maximum-damage-window-bodies',
            layout: computeMaximumDamageWindowBodiesLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.counts) },
                { binding: 1, resource: resource(this.buffers.physics) },
                { binding: 2, resource: resource(this.buffers.simulation) },
                { binding: 4, resource: resource(this.buffers.contactHandlers) },
                { binding: 10, resource: resource(this.buffers.combatStates) },
                { binding: 11, resource: resource(this.buffers.enemyBehaviorStates) }
            ]
        });
        const computeCoreDamageRequestBodies = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-core-damage-request-bodies',
            layout: computeCoreDamageRequestBodiesLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.counts) },
                { binding: 1, resource: resource(this.buffers.physics) },
                { binding: 2, resource: resource(this.buffers.simulation) },
                { binding: 4, resource: resource(this.buffers.contactHandlers) },
                { binding: 10, resource: resource(this.buffers.combatStates) },
                { binding: 11, resource: resource(this.buffers.enemyBehaviorStates) }
            ]
        });
        const computeEnemyBehaviorBodies = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-enemy-behavior-bodies',
            layout: computeEnemyBehaviorBodiesLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.counts) },
                { binding: 1, resource: resource(this.buffers.physics) },
                { binding: 2, resource: resource(this.buffers.simulation) },
                { binding: 11, resource: resource(this.buffers.enemyBehaviorStates) },
                {
                    binding: 13,
                    resource: resource(this.buffers.towerGameplayTargetConfig)
                }
            ]
        });
        const computeDirectionalDefenseBodies = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-directional-defense-bodies',
            layout: computeDirectionalDefenseBodiesLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.counts) },
                { binding: 1, resource: resource(this.buffers.physics) },
                { binding: 2, resource: resource(this.buffers.simulation) },
                { binding: 3, resource: resource(this.buffers.temporary) },
                { binding: 11, resource: resource(this.buffers.enemyBehaviorStates) },
                {
                    binding: 13,
                    resource: resource(this.buffers.towerGameplayTargetConfig)
                }
            ]
        });
        const computeAtomicTransformFirstHitBodies = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-atomic-transform-first-hit-bodies',
            layout: computeAtomicTransformFirstHitBodiesLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.counts) },
                { binding: 1, resource: resource(this.buffers.physics) },
                { binding: 2, resource: resource(this.buffers.simulation) },
                { binding: 4, resource: resource(this.buffers.contactHandlers) },
                { binding: 14, resource: resource(this.buffers.atomicTransformStates) },
                { binding: 15, resource: resource(this.buffers.atomicTransformCandidates) }
            ]
        });
        const computeWorldFull = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-world-full',
            layout: computeWorldFullLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.gridCounts) },
                { binding: 1, resource: resource(this.buffers.gridBodies) },
                { binding: 2, resource: resource(this.buffers.sdf) },
                { binding: 3, resource: resource(this.buffers.gridOverflow) },
                {
                    binding: 4,
                    resource: this.flowTexture.createView({ dimension: '2d-array' })
                }
            ]
        });
        const computeWorldGrid = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-world-grid',
            layout: computeWorldGridLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.gridCounts) },
                { binding: 1, resource: resource(this.buffers.gridBodies) }
            ]
        });
        const computeWorldSdf = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-world-sdf',
            layout: computeWorldSdfLayout,
            entries: [{ binding: 2, resource: resource(this.buffers.sdf) }]
        });
        const computeEmpty = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-empty',
            layout: computeEmptyLayout,
            entries: []
        });
        const computeParams = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-params',
            layout: computeParamsLayout,
            entries: [{ binding: 0, resource: resource(this.buffers.computeParams) }]
        });
        const computeContactEvents = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-contact-events',
            layout: computeContactEventsLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.contactState) },
                { binding: 1, resource: resource(this.buffers.contacts) }
            ]
        });
        const computeAllEvents = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-all-events',
            layout: computeAllEventsLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.contactState) },
                { binding: 1, resource: resource(this.buffers.contacts) },
                { binding: 2, resource: resource(this.buffers.appliedEvents) },
                { binding: 3, resource: resource(this.buffers.deathEvents) }
            ]
        });
        const computeMaximumDamageWindowEvents = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-maximum-damage-window-events',
            layout: computeMaximumDamageWindowEventsLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.contactState) },
                { binding: 1, resource: resource(this.buffers.contacts) },
                { binding: 2, resource: resource(this.buffers.appliedEvents) }
            ]
        });
        const computeEnemyBehaviorEvents = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-enemy-behavior-events',
            layout: computeEnemyBehaviorEventsLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.contactState) },
                { binding: 1, resource: resource(this.buffers.contacts) },
                { binding: 2, resource: resource(this.buffers.appliedEvents) }
            ]
        });
        const computeDirectionalDefenseEvents = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-directional-defense-events',
            layout: computeDirectionalDefenseEventsLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.contactState) },
                { binding: 1, resource: resource(this.buffers.contacts) }
            ]
        });
        const computeFixedControl = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-fixed-control',
            layout: computeFixedControlLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.counts) },
                { binding: 1, resource: resource(this.buffers.physics) },
                { binding: 2, resource: resource(this.buffers.simulation) },
                { binding: 5, resource: resource(this.buffers.bodyControlStates) },
                { binding: 6, resource: resource(this.buffers.bodyControlProgram) }
            ]
        });
        const computeSourceResolve = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-source-resolve',
            layout: computeSourceResolveLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.counts) },
                { binding: 1, resource: resource(this.buffers.physics) },
                { binding: 2, resource: resource(this.buffers.simulation) },
                { binding: 3, resource: resource(this.buffers.temporary) },
                { binding: 5, resource: resource(this.buffers.bodyControlStates) },
                { binding: 7, resource: resource(this.buffers.spawnProgram) },
                { binding: 10, resource: resource(this.buffers.combatStates) },
                { binding: 11, resource: resource(this.buffers.enemyBehaviorStates) },
                { binding: 12, resource: resource(this.buffers.effectSummaries) }
            ]
        });
        const computeTrackedPose = device.createBindGroup({
            label: 'cirvivor-gpu-circle-compute-tracked-pose',
            layout: computeTrackedPoseLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.counts) },
                { binding: 1, resource: resource(this.buffers.physics) },
                { binding: 2, resource: resource(this.buffers.simulation) },
                { binding: 3, resource: resource(this.buffers.temporary) },
                { binding: 8, resource: resource(this.buffers.trackedPoseConfig) },
                { binding: 9, resource: resource(this.buffers.trackedPoseOutput) }
            ]
        });
        const projectileCaptureBodies = device.createBindGroup({
            label: 'cirvivor-gpu-projectile-capture-bodies',
            layout: projectileCaptureBodiesLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.counts) },
                { binding: 1, resource: resource(this.buffers.physics) },
                { binding: 2, resource: resource(this.buffers.simulation) },
                { binding: 3, resource: resource(this.buffers.temporary) },
                { binding: 4, resource: resource(this.buffers.contactState) },
                { binding: 5, resource: resource(this.buffers.contacts) },
                { binding: 6, resource: resource(this.buffers.projectileCaptureStates) },
                { binding: 7, resource: resource(this.buffers.projectileCaptureCandidates) },
                { binding: 8, resource: resource(this.buffers.projectileCaptureRuntime) }
            ]
        });
        const projectileCaptureParams = device.createBindGroup({
            label: 'cirvivor-gpu-projectile-capture-params',
            layout: projectileCaptureParamsLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.projectileCaptureParams) },
                {
                    binding: 1,
                    resource: resource(this.buffers.projectileCaptureTargetConfig)
                }
            ]
        });
        const projectileCaptureReleaseBindGroup = device.createBindGroup({
            label: 'cirvivor-gpu-projectile-capture-release',
            layout: projectileCaptureReleaseLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.counts) },
                { binding: 1, resource: resource(this.buffers.physics) },
                { binding: 2, resource: resource(this.buffers.simulation) },
                { binding: 3, resource: resource(this.buffers.temporary) },
                { binding: 4, resource: resource(this.buffers.combatStates) },
                { binding: 5, resource: resource(this.buffers.projectileCaptureStates) },
                {
                    binding: 6,
                    resource: resource(this.buffers.projectileCaptureReleaseProgram)
                }
            ]
        });
        const routeRuntimeBindGroup = device.createBindGroup({
            label: 'cirvivor-gpu-route-runtime',
            layout: routeRuntimeLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.counts) },
                { binding: 1, resource: resource(this.buffers.physics) },
                { binding: 2, resource: resource(this.buffers.simulation) },
                { binding: 3, resource: resource(this.buffers.routeRuntimeStates) },
                { binding: 4, resource: resource(this.buffers.routeRuntimeTopology) },
                { binding: 5, resource: resource(this.buffers.routeAvailability) },
                { binding: 6, resource: resource(this.buffers.routeCleanupProgram) },
                { binding: 7, resource: resource(this.buffers.contactState) },
                { binding: 8, resource: resource(this.buffers.appliedEvents) },
                { binding: 9, resource: resource(this.buffers.routeRuntimeParams) }
            ]
        });
        const routeRuntimeWaitBindGroup = device.createBindGroup({
            label: 'cirvivor-gpu-route-runtime-wait',
            layout: routeRuntimeWaitLayout,
            entries: [
                { binding: 0, resource: resource(this.buffers.counts) },
                { binding: 1, resource: resource(this.buffers.physics) },
                { binding: 2, resource: resource(this.buffers.simulation) },
                { binding: 3, resource: resource(this.buffers.routeRuntimeStates) },
                { binding: 9, resource: resource(this.buffers.routeRuntimeParams) },
                { binding: 10, resource: resource(this.buffers.temporary) }
            ]
        });
        this.bindGroups = {
            effectByPool,
            formationByPool,
            atomicTransformByPool,
            projectileCapture: [projectileCaptureBodies, projectileCaptureParams],
            projectileCaptureRelease: projectileCaptureReleaseBindGroup,
            routeRuntime: routeRuntimeBindGroup,
            routeRuntimeWait: routeRuntimeWaitBindGroup,
            computeProfiles: {
                [COMPUTE_PIPELINE_PROFILE.PHYSICS]: [
                    computeBodiesBase,
                    computeWorldFull,
                    computeParams
                ],
                [COMPUTE_PIPELINE_PROFILE.BODY_CONTACTS]: [
                    computeBodiesWithHandlers,
                    computeWorldGrid,
                    computeParams,
                    computeContactEvents
                ],
                [COMPUTE_PIPELINE_PROFILE.WORLD_CONTACTS]: [
                    computeBodiesBase,
                    computeWorldSdf,
                    computeParams,
                    computeContactEvents
                ],
                [COMPUTE_PIPELINE_PROFILE.CONTACT_HANDLING]: [
                    computeContactHandlingBodies,
                    computeEmpty,
                    computeParams,
                    computeAllEvents
                ],
                [COMPUTE_PIPELINE_PROFILE.MAXIMUM_DAMAGE_WINDOW]: [
                    computeMaximumDamageWindowBodies,
                    computeEmpty,
                    computeParams,
                    computeMaximumDamageWindowEvents
                ],
                [COMPUTE_PIPELINE_PROFILE.CORE_DAMAGE_REQUEST]: [
                    computeCoreDamageRequestBodies,
                    computeEmpty,
                    computeParams,
                    computeMaximumDamageWindowEvents
                ],
                [COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL]: [
                    computeFixedControl,
                    computeEmpty,
                    computeParams
                ],
                [COMPUTE_PIPELINE_PROFILE.SOURCE_RESOLVE]: [
                    computeSourceResolve,
                    computeEmpty,
                    computeParams
                ],
                [COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR]: [
                    computeEnemyBehaviorBodies,
                    computeEmpty,
                    computeParams,
                    computeEnemyBehaviorEvents
                ],
                [COMPUTE_PIPELINE_PROFILE.DIRECTIONAL_DEFENSE_CLASSIFIER]: [
                    computeDirectionalDefenseBodies,
                    computeEmpty,
                    computeParams,
                    computeDirectionalDefenseEvents
                ],
                [COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT]: [
                    computeAtomicTransformFirstHitBodies,
                    computeEmpty,
                    computeParams,
                    computeMaximumDamageWindowEvents
                ],
                [COMPUTE_PIPELINE_PROFILE.TRACKED_POSE]: [
                    computeTrackedPose
                ]
            },
            indirect: device.createBindGroup({
                label: 'cirvivor-gpu-circle-indirect',
                layout: indirectLayout,
                entries: [
                    { binding: 0, resource: resource(this.buffers.counts) },
                    { binding: 1, resource: resource(this.buffers.dispatchIndirect) },
                    { binding: 2, resource: resource(this.buffers.drawIndirect) }
                ]
            }),
            renderBodies: device.createBindGroup({
                label: 'cirvivor-gpu-circle-render-bodies',
                layout: renderBodiesLayout,
                entries: [
                    { binding: 0, resource: resource(this.buffers.counts) },
                    { binding: 1, resource: resource(this.buffers.physics) },
                    { binding: 2, resource: resource(this.buffers.temporary) },
                    { binding: 3, resource: resource(this.buffers.renderStyles) },
                    { binding: 4, resource: resource(this.buffers.simulation) },
                    { binding: 5, resource: resource(this.buffers.enemyBehaviorStates) },
                    { binding: 6, resource: resource(this.buffers.effectSummaries) },
                    { binding: 7, resource: resource(this.buffers.formationStates) },
                    {
                        binding: 8,
                        resource: resource(this.buffers.projectileCaptureStates)
                    }
                ]
            }),
            renderParams: device.createBindGroup({
                label: 'cirvivor-gpu-circle-render-params',
                layout: renderParamsLayout,
                entries: [{ binding: 0, resource: resource(this.buffers.renderParams) }]
            })
        };
    }

    #uploadHostState() {
        assertGpuCircleBodyAbiVersion(this.hostStorage);
        this.#bindRouteAvailabilityProtocolTuple(false);
        const queue = this.device.queue;
        const bodyCount = this.bodyCount;
        queue.writeBuffer(this.buffers.counts, 0, this.hostStorage.countsBuffer);
        queue.writeBuffer(this.buffers.gridOverflow, 0, this.overflowResetData);
        queue.writeBuffer(
            this.buffers.bodyControlStates,
            0,
            this.hostBodyControlStates
        );
        queue.writeBuffer(
            this.buffers.bodyControlProgram,
            0,
            this.hostBodyControlProgram.buffer
        );
        queue.writeBuffer(
            this.buffers.spawnProgram,
            0,
            this.hostSpawnProgram.buffer
        );
        queue.writeBuffer(
            this.buffers.routeRuntimeTopology,
            0,
            this.routeRuntimeTopology.buffer
        );
        queue.writeBuffer(
            this.buffers.routeAvailability,
            0,
            this.hostRouteAvailability
        );
        queue.writeBuffer(
            this.buffers.routeCleanupProgram,
            0,
            this.hostRouteCleanupProgram.buffer
        );
        queue.writeBuffer(
            this.buffers.effectPoolState,
            0,
            this.hostEffectPoolState
        );
        queue.writeBuffer(
            this.buffers.effectPulseProgram,
            0,
            this.hostEffectPulseProgram.buffer
        );
        queue.writeBuffer(
            this.buffers.formationPrepareProgram,
            0,
            this.hostFormationPrepareProgram.buffer
        );
        queue.writeBuffer(
            this.buffers.formationTransformProgram,
            0,
            this.hostFormationTransformProgram.buffer
        );
        queue.writeBuffer(
            this.buffers.atomicTransformPrepareProgram,
            0,
            this.hostAtomicTransformPrepareProgram.buffer
        );
        queue.writeBuffer(
            this.buffers.atomicTransformProgram,
            0,
            this.hostAtomicTransformProgram.buffer
        );
        for (const [bufferKey, source] of [
            ['atomicTransformTemplatePhysics', this.hostAtomicTransformTemplateStorage.physicsBuffer],
            ['atomicTransformTemplateSimulation', this.hostAtomicTransformTemplateStorage.simulationBuffer],
            ['atomicTransformTemplateTemporary', this.hostAtomicTransformTemplateStorage.temporaryBuffer],
            ['atomicTransformTemplateContactHandlers', this.hostAtomicTransformTemplateStorage.contactHandlerBuffer],
            ['atomicTransformTemplateCombatStates', this.hostAtomicTransformTemplateStorage.combatStateBuffer],
            ['atomicTransformTemplateStates', this.hostAtomicTransformTemplateStorage.atomicTransformStateBuffer],
            ['atomicTransformTemplateEffectSummaries', this.hostAtomicTransformTemplateEffectBodyState.summaryBuffer],
            ['atomicTransformTemplateEffectEmitters', this.hostAtomicTransformTemplateEffectBodyState.emitterStateBuffer],
            ['atomicTransformTemplateFormationStates', this.hostAtomicTransformTemplateFormationBodyState],
            ['atomicTransformTemplateRenderStyles', this.hostAtomicTransformTemplateRenderStyles],
            ['atomicTransformTemplateEnemyBehaviorStates', this.hostAtomicTransformTemplateStorage.enemyBehaviorStateBuffer],
            ['atomicTransformTemplateBodyControlStates', this.hostAtomicTransformTemplateBodyControlStates]
        ]) {
            queue.writeBuffer(this.buffers[bufferKey], 0, source);
        }
        queue.writeBuffer(
            this.buffers.trackedPoseConfig,
            0,
            this.trackedPoseConfigBytes
        );
        queue.writeBuffer(
            this.buffers.towerGameplayTargetConfig,
            0,
            this.towerGameplayTargetConfigBytes
        );
        if (bodyCount > 0) {
            queue.writeBuffer(
                this.buffers.physics,
                0,
                this.hostStorage.physicsBuffer,
                0,
                bodyCount * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE
            );
            queue.writeBuffer(
                this.buffers.simulation,
                0,
                this.hostStorage.simulationBuffer,
                0,
                bodyCount * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE
            );
            queue.writeBuffer(
                this.buffers.temporary,
                0,
                this.hostStorage.temporaryBuffer,
                0,
                bodyCount * GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE
            );
            queue.writeBuffer(
                this.buffers.contactHandlers,
                0,
                this.hostStorage.contactHandlerBuffer,
                0,
                bodyCount * GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE
            );
            queue.writeBuffer(
                this.buffers.combatStates,
                0,
                this.hostStorage.combatStateBuffer,
                0,
                bodyCount * GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE
            );
            queue.writeBuffer(
                this.buffers.atomicTransformStates,
                0,
                this.hostStorage.atomicTransformStateBuffer,
                0,
                bodyCount * GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE.STRIDE
            );
            queue.writeBuffer(
                this.buffers.projectileCaptureStates,
                0,
                this.hostStorage.projectileCaptureStateBuffer,
                0,
                bodyCount * GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE.STRIDE
            );
            queue.writeBuffer(
                this.buffers.projectileCaptureCandidates,
                0,
                this.hostStorage.projectileCaptureCandidateBuffer,
                0,
                bodyCount * GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_CANDIDATE.STRIDE
            );
            queue.writeBuffer(
                this.buffers.enemyBehaviorStates,
                0,
                this.hostStorage.enemyBehaviorStateBuffer,
                0,
                bodyCount * GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE
            );
            queue.writeBuffer(
                this.buffers.effectSummaries,
                0,
                this.hostEffectBodyState.summaryBuffer,
                0,
                bodyCount * GPU_EFFECT_RUNTIME_ABI.SUMMARY.STRIDE
            );
            queue.writeBuffer(
                this.buffers.effectEmitterStates,
                0,
                this.hostEffectBodyState.emitterStateBuffer,
                0,
                bodyCount * GPU_EFFECT_RUNTIME_ABI.EMITTER_STATE.STRIDE
            );
            queue.writeBuffer(
                this.buffers.formationStates,
                0,
                this.hostFormationBodyState,
                0,
                bodyCount * GPU_FORMATION_RUNTIME_ABI.BODY_STATE.STRIDE
            );
            queue.writeBuffer(
                this.buffers.routeRuntimeStates,
                0,
                this.hostRouteRuntimeStates,
                0,
                bodyCount * GPU_ROUTE_RUNTIME_ABI.BODY_STATE.STRIDE
            );
            queue.writeBuffer(
                this.buffers.renderStyles,
                0,
                this.hostRenderStyles,
                0,
                bodyCount * BODY_RENDER_STYLE_STRIDE
            );
        }
        queue.writeBuffer(this.buffers.sdf, 0, this.sdf.values);
        queue.writeTexture(
            { texture: this.flowTexture },
            this.flowFieldAtlas.directions,
            {
                bytesPerRow: this.flowFieldAtlas.cols * 2 * FLOAT32_BYTES,
                rowsPerImage: this.flowFieldAtlas.rows
            },
            {
                width: this.flowFieldAtlas.cols,
                height: this.flowFieldAtlas.rows,
                depthOrArrayLayers: Math.max(1, this.flowFieldAtlas.fieldCount)
            }
        );
        queue.writeTexture(
            { texture: this.flowIntegrationTexture },
            this.flowFieldAtlas.integrationCosts,
            {
                bytesPerRow: this.flowFieldAtlas.cols * FLOAT32_BYTES,
                rowsPerImage: this.flowFieldAtlas.rows
            },
            {
                width: this.flowFieldAtlas.cols,
                height: this.flowFieldAtlas.rows,
                depthOrArrayLayers: Math.max(1, this.flowFieldAtlas.fieldCount)
            }
        );
        this.dispatchIndirectArgs[0] = Math.ceil(bodyCount / BODY_WORKGROUP_SIZE);
        this.dispatchIndirectArgs[1] = 1;
        this.dispatchIndirectArgs[2] = 1;
        queue.writeBuffer(this.buffers.dispatchIndirect, 0, this.dispatchIndirectArgs);
        this.drawIndirectArgs[0] = 6;
        this.drawIndirectArgs[1] = bodyCount;
        this.drawIndirectArgs[2] = 0;
        this.drawIndirectArgs[3] = 0;
        queue.writeBuffer(this.buffers.drawIndirect, 0, this.drawIndirectArgs);
        this.uploadedComputeFixedDelta = NaN;
        this.uploadedComputeFixedTick = -1;
        this.#writeComputeParams(this.lastFixedDelta, 0);
        this.#writeProjectileCaptureParams(0);
        this.#writeRouteRuntimeParams(0, false);
    }

    #bindRouteAvailabilityProtocolTuple(uploadHeader) {
        const header = GPU_ROUTE_RUNTIME_ABI.AVAILABILITY_HEADER;
        const view = new DataView(this.hostRouteAvailability);
        view.setUint32(
            header.SESSION_GENERATION,
            this.sessionGeneration,
            LITTLE_ENDIAN
        );
        view.setUint32(
            header.DEVICE_GENERATION,
            Math.max(0, this.deviceGeneration),
            LITTLE_ENDIAN
        );
        view.setUint32(
            header.AUTHORITATIVE_EPOCH,
            this.routeAuthoritativeEpoch,
            LITTLE_ENDIAN
        );
        if (uploadHeader && this.device && this.buffers?.routeAvailability) {
            this.device.queue.writeBuffer(
                this.buffers.routeAvailability,
                0,
                this.hostRouteAvailability,
                0,
                header.STRIDE
            );
        }
    }

    #writeRouteRuntimeParams(fixedTick, terminalFinalSubmit = false) {
        writeGpuRouteRuntimeParams(this.routeRuntimeParamsBytes, {
            fixedTick,
            maxEvents: this.eventCapacity,
            terminalFinalSubmit,
            fixedDelta: this.lastFixedDelta
        });
        this.device.queue.writeBuffer(
            this.buffers.routeRuntimeParams,
            0,
            this.routeRuntimeParamsBytes
        );
    }

    #writeComputeParams(fixedDelta, fixedTick = 0) {
        const uploadedDelta = Math.fround(fixedDelta);
        const uploadedMaximumBodyRadius = Math.fround(this.maximumBodyRadius);
        const uploadedFixedTick = requireNonNegativeInteger(fixedTick, 'fixedTick');
        if (Object.is(uploadedDelta, this.uploadedComputeFixedDelta)
            && Object.is(uploadedMaximumBodyRadius, this.uploadedMaximumBodyRadius)
            && uploadedFixedTick === this.uploadedComputeFixedTick) {
            return;
        }
        const view = this.computeParamsView;
        view.setFloat32(0, this.worldSize.x, LITTLE_ENDIAN);
        view.setFloat32(4, this.worldSize.y, LITTLE_ENDIAN);
        view.setFloat32(8, this.gridCellSize.x, LITTLE_ENDIAN);
        view.setFloat32(12, this.gridCellSize.y, LITTLE_ENDIAN);
        view.setUint32(16, this.gridCellCount.x, LITTLE_ENDIAN);
        view.setUint32(20, this.gridCellCount.y, LITTLE_ENDIAN);
        view.setUint32(24, this.maxBodiesPerCell, LITTLE_ENDIAN);
        view.setUint32(28, this.solverIterations, LITTLE_ENDIAN);
        view.setFloat32(32, uploadedDelta, LITTLE_ENDIAN);
        view.setFloat32(36, 1 / uploadedDelta, LITTLE_ENDIAN);
        view.setUint32(40, this.sdf.cols, LITTLE_ENDIAN);
        view.setUint32(44, this.sdf.rows, LITTLE_ENDIAN);
        view.setUint32(48, this.sdf.enabled ? 1 : 0, LITTLE_ENDIAN);
        view.setFloat32(52, this.velocityDamping, LITTLE_ENDIAN);
        view.setFloat32(56, this.maxSpeed, LITTLE_ENDIAN);
        view.setFloat32(60, this.sourceWorldUnitScale, LITTLE_ENDIAN);
        view.setUint32(64, this.flowFieldAtlas.cols, LITTLE_ENDIAN);
        view.setUint32(68, this.flowFieldAtlas.rows, LITTLE_ENDIAN);
        view.setUint32(72, this.flowFieldAtlas.fieldCount, LITTLE_ENDIAN);
        view.setUint32(76, this.flowFieldAtlas.enabled ? 1 : 0, LITTLE_ENDIAN);
        view.setFloat32(80, this.flowFieldAtlas.origin.x, LITTLE_ENDIAN);
        view.setFloat32(84, this.flowFieldAtlas.origin.y, LITTLE_ENDIAN);
        view.setFloat32(88, this.flowFieldAtlas.cellSize.x, LITTLE_ENDIAN);
        view.setFloat32(92, this.flowFieldAtlas.cellSize.y, LITTLE_ENDIAN);
        for (let index = 0; index < GPU_CIRCLE_BODY_FLOW.MAX_FIELD_COUNT; index++) {
            const offset = COMPUTE_PARAMS_FLOW_STAGE_OFFSET
                + (index * COMPUTE_PARAMS_FLOW_STAGE_STRIDE);
            const stage = this.flowFieldAtlas.stages[index];
            view.setFloat32(offset, stage?.goalPosition.x ?? 0, LITTLE_ENDIAN);
            view.setFloat32(offset + 4, stage?.goalPosition.y ?? 0, LITTLE_ENDIAN);
            view.setInt32(offset + 8, stage?.nextFieldIndex ?? -1, LITTLE_ENDIAN);
            view.setFloat32(offset + 12, stage?.transitionRadius ?? 0, LITTLE_ENDIAN);
        }
        view.setUint32(
            COMPUTE_PARAMS_MAX_CONTACTS_OFFSET,
            this.contactCapacity,
            LITTLE_ENDIAN
        );
        view.setUint32(
            COMPUTE_PARAMS_MAX_EVENTS_OFFSET,
            this.eventCapacity,
            LITTLE_ENDIAN
        );
        view.setUint32(
            COMPUTE_PARAMS_MAX_DEATH_EVENTS_OFFSET,
            this.deathEventCapacity,
            LITTLE_ENDIAN
        );
        view.setFloat32(
            COMPUTE_PARAMS_MAXIMUM_BODY_RADIUS_OFFSET,
            uploadedMaximumBodyRadius,
            LITTLE_ENDIAN
        );
        view.setUint32(COMPUTE_PARAMS_FIXED_TICK_OFFSET, uploadedFixedTick, LITTLE_ENDIAN);
        view.setUint32(COMPUTE_PARAMS_FIXED_TICK_OFFSET + 4, 0, LITTLE_ENDIAN);
        view.setUint32(COMPUTE_PARAMS_FIXED_TICK_OFFSET + 8, 0, LITTLE_ENDIAN);
        view.setUint32(COMPUTE_PARAMS_FIXED_TICK_OFFSET + 12, 0, LITTLE_ENDIAN);
        this.device.queue.writeBuffer(this.buffers.computeParams, 0, this.computeParamsBytes);
        this.uploadedComputeFixedDelta = uploadedDelta;
        this.uploadedMaximumBodyRadius = uploadedMaximumBodyRadius;
        this.uploadedComputeFixedTick = uploadedFixedTick;
    }

    #writeProjectileCaptureParams(fixedTick) {
        const tick = requireNonNegativeInteger(fixedTick, 'projectileCapture.fixedTick');
        const view = new DataView(this.projectileCaptureParamsBytes);
        view.setUint32(0, tick, LITTLE_ENDIAN);
        view.setUint32(4, this.contactCapacity, LITTLE_ENDIAN);
        view.setUint32(8, this.projectileCaptureCompletionCapacity, LITTLE_ENDIAN);
        view.setUint32(
            12,
            this.projectileCaptureReleasePreparationCapacity,
            LITTLE_ENDIAN
        );
        view.setUint32(16, this.projectileCaptureCleanupCapacity, LITTLE_ENDIAN);
        view.setUint32(20, RING_PROJECTILE_CAPTURE_PROFILE.definitionCode, LITTLE_ENDIAN);
        view.setUint32(
            24,
            RING_PROJECTILE_CAPTURE_PROFILE.captureDelayFixedTicks,
            LITTLE_ENDIAN
        );
        view.setUint32(28, this.sessionGeneration, LITTLE_ENDIAN);
        view.setUint32(32, Math.max(0, this.deviceGeneration), LITTLE_ENDIAN);
        view.setUint32(36, this.authoritativeEpoch, LITTLE_ENDIAN);
        view.setFloat32(
            40,
            Math.fround(Math.cos(
                RING_PROJECTILE_CAPTURE_PROFILE.funnelHalfAngleRadians
            )),
            LITTLE_ENDIAN
        );
        view.setFloat32(
            44,
            Math.fround(RING_PROJECTILE_CAPTURE_PROFILE.exitClearanceTiles),
            LITTLE_ENDIAN
        );
        const targetView = new DataView(this.projectileCaptureTargetConfigBytes);
        const targetHandle = this.towerGameplayTargetHandle;
        const hasTower = targetHandle !== null && this.towerGameplayTargetSlot >= 0;
        targetView.setUint32(
            0,
            hasTower
                ? this.towerGameplayTargetSlot
                : GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
            LITTLE_ENDIAN
        );
        targetView.setUint32(
            4,
            hasTower
                ? targetHandle.entityId
                : GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
            LITTLE_ENDIAN
        );
        targetView.setUint32(
            8,
            hasTower
                ? targetHandle.incarnation
                : GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
            LITTLE_ENDIAN
        );
        targetView.setUint32(
            12,
            hasTower
                ? GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.TOWER
                : GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD,
            LITTLE_ENDIAN
        );
        this.device.queue.writeBuffer(
            this.buffers.projectileCaptureParams,
            0,
            this.projectileCaptureParamsBytes
        );
        this.device.queue.writeBuffer(
            this.buffers.projectileCaptureTargetConfig,
            0,
            this.projectileCaptureTargetConfigBytes
        );
    }

    #writeRenderParams(camera, target) {
        const state = this.presentationClock.getShaderState(this.shaderStateScratch);
        const view = this.renderParamsView;
        view.setFloat32(0, this.renderOriginScratch.x, LITTLE_ENDIAN);
        view.setFloat32(4, this.renderOriginScratch.y, LITTLE_ENDIAN);
        view.setFloat32(8, target.width, LITTLE_ENDIAN);
        view.setFloat32(12, target.height, LITTLE_ENDIAN);
        view.setFloat32(16, camera.getScale(), LITTLE_ENDIAN);
        view.setFloat32(20, state.predictionDelta, LITTLE_ENDIAN);
        view.setFloat32(24, state.interpolationAlpha, LITTLE_ENDIAN);
        view.setUint32(28, state.presentationMode, LITTLE_ENDIAN);
        this.device.queue.writeBuffer(this.buffers.renderParams, 0, this.renderParamsBytes);
    }

    #setComputeProfile(pass, profile) {
        const bindGroups = this.bindGroups.computeProfiles[profile];
        if (!bindGroups) {
            throw new RangeError(`등록되지 않은 compute pipeline profile입니다: ${profile}`);
        }
        for (let groupIndex = 0; groupIndex < bindGroups.length; groupIndex++) {
            pass.setBindGroup(groupIndex, bindGroups[groupIndex]);
        }
    }

    #dispatchBodies(pass, entryPoint) {
        pass.setPipeline(this.pipelines.compute[entryPoint]);
        pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
    }

    #setEffectEntry(pass, entryPoint) {
        const pipeline = this.pipelines.effect[entryPoint];
        const bindGroups = this.bindGroups.effectByPool[
            this.effectActivePoolIndex
        ]?.[entryPoint];
        if (!pipeline || !bindGroups) {
            throw new RangeError(`등록되지 않은 Effect pipeline입니다: ${entryPoint}`);
        }
        pass.setPipeline(pipeline);
        for (let groupIndex = 0; groupIndex < bindGroups.length; groupIndex++) {
            pass.setBindGroup(groupIndex, bindGroups[groupIndex]);
        }
    }

    #setFormationEntry(pass, entryPoint) {
        const pipeline = this.pipelines.formation[entryPoint];
        const bindGroups = this.bindGroups.formationByPool[
            this.effectActivePoolIndex
        ]?.[entryPoint];
        if (!pipeline || !bindGroups) {
            throw new RangeError(
                `등록되지 않은 Formation pipeline입니다: ${entryPoint}`
            );
        }
        pass.setPipeline(pipeline);
        for (let groupIndex = 0; groupIndex < bindGroups.length; groupIndex++) {
            pass.setBindGroup(groupIndex, bindGroups[groupIndex]);
        }
    }

    #setAtomicTransformEntry(pass, entryPoint) {
        const pipeline = this.pipelines.atomicTransform[entryPoint];
        const bindGroup = this.bindGroups.atomicTransformByPool[
            this.effectActivePoolIndex
        ]?.[entryPoint];
        if (!pipeline || !bindGroup) {
            throw new RangeError(
                `등록되지 않은 AtomicTransform pipeline입니다: ${entryPoint}`
            );
        }
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
    }

    #setProjectileCaptureEntry(pass, entryPoint) {
        const pipeline = this.pipelines.projectileCapture[entryPoint];
        if (!pipeline) {
            throw new RangeError(
                `등록되지 않은 ProjectileCapture pipeline입니다: ${entryPoint}`
            );
        }
        pass.setPipeline(pipeline);
        for (let groupIndex = 0;
            groupIndex < this.bindGroups.projectileCapture.length;
            groupIndex++) {
            pass.setBindGroup(
                groupIndex,
                this.bindGroups.projectileCapture[groupIndex]
            );
        }
    }

    #setProjectileCaptureReleaseEntry(pass, entryPoint) {
        const pipeline = this.pipelines.projectileCaptureRelease[entryPoint];
        if (!pipeline) {
            throw new RangeError(
                `등록되지 않은 ProjectileCaptureRelease pipeline입니다: ${entryPoint}`
            );
        }
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, this.bindGroups.projectileCaptureRelease);
    }

    #releaseGpuResources() {
        this.idleReleasePending = false;
        this.overflowReadbackLease++;
        this.#cancelEventReadbacks();
        this.spawnProgramReadbackLease++;
        for (const slot of this.spawnProgramReadbackSlots) {
            slot.inFlight = false;
            try {
                slot.buffer?.destroy?.();
            } catch {
                // retired mapping/device resources are best-effort cleanup
            }
        }
        this.spawnProgramReadbackSlots = [];
        this.pendingSpawnProgramReadbacks = 0;
        this.spawnProgramReadbackCursor = 0;
        this.spawnProgramBatchQueue.length = 0;
        this.effectProgramReadbackLease++;
        for (const slot of this.effectProgramReadbackSlots) {
            slot.inFlight = false;
            try {
                slot.buffer?.destroy?.();
            } catch {
                // retired mapping/device resources are best-effort cleanup
            }
        }
        this.effectProgramReadbackSlots = [];
        this.pendingEffectReadbacks = 0;
        this.effectProgramReadbackCursor = 0;
        this.effectProgramBatchQueue.length = 0;
        this.stagedEffectPulseBatch = null;
        this.lastEffectProtocolKey = null;
        this.formationPrepareReadbackLease++;
        for (const slot of this.formationPrepareReadbackSlots) {
            slot.inFlight = false;
            try { slot.buffer?.destroy?.(); } catch { /* retired */ }
        }
        this.formationPrepareReadbackSlots = [];
        this.pendingFormationPrepareReadbacks = 0;
        this.formationPrepareBatchQueue.length = 0;
        this.formationTransformReadbackLease++;
        for (const slot of this.formationTransformReadbackSlots) {
            slot.inFlight = false;
            try { slot.buffer?.destroy?.(); } catch { /* retired */ }
        }
        this.formationTransformReadbackSlots = [];
        this.pendingFormationTransformReadbacks = 0;
        this.stagedFormationPrepareBatch = null;
        this.armedFormationTransform = null;
        this.authenticFormationPrepareByKey.clear();
        this.atomicTransformPrepareReadbackLease++;
        for (const slot of this.atomicTransformPrepareReadbackSlots) {
            slot.inFlight = false;
            try { slot.buffer?.destroy?.(); } catch { /* retired */ }
        }
        this.atomicTransformPrepareReadbackSlots = [];
        this.pendingAtomicTransformPrepareReadbacks = 0;
        this.atomicTransformPrepareReadbackCursor = 0;
        this.atomicTransformPrepareBatchQueue.length = 0;
        this.atomicTransformReadbackLease++;
        for (const slot of this.atomicTransformReadbackSlots) {
            slot.inFlight = false;
            try { slot.buffer?.destroy?.(); } catch { /* retired */ }
        }
        this.atomicTransformReadbackSlots = [];
        this.pendingAtomicTransformReadbacks = 0;
        this.atomicTransformReadbackCursor = 0;
        this.stagedAtomicTransformPrepareBatch = null;
        this.armedAtomicTransform = null;
        this.authenticAtomicTransformPrepareByFingerprint.clear();
        this.projectileCaptureReadbackLease++;
        for (const slot of this.projectileCaptureReadbackSlots) {
            slot.inFlight = false;
            try { slot.buffer?.destroy?.(); } catch { /* retired */ }
        }
        this.projectileCaptureReadbackSlots = [];
        this.pendingProjectileCaptureReadbacks = 0;
        this.pendingProjectileCaptureReleaseReadbacks = 0;
        this.projectileCaptureReadbackCursor = 0;
        this.projectileCaptureBatchQueue.length = 0;
        this.projectileCaptureReleaseBatchQueue.length = 0;
        this.armedProjectileCaptureRelease = null;
        this.authenticProjectileCapturePreparationByKey.clear();
        this.authenticProjectileCaptureCoreImpactReceipts = new WeakSet();
        this.routeRuntimeReadbackLease++;
        for (const slot of this.routeRuntimeReadbackSlots) {
            slot.inFlight = false;
            try { slot.buffer?.destroy?.(); } catch { /* retired */ }
        }
        this.routeRuntimeReadbackSlots = [];
        this.pendingRouteRuntimeReadbacks = 0;
        this.routeRuntimeReadbackCursor = 0;
        this.routeRuntimeBatchQueue.length = 0;
        this.trackedPoseReadbackLease++;
        for (const slot of this.trackedPoseReadbackSlots) {
            slot.inFlight = false;
            try {
                slot.buffer?.destroy?.();
            } catch {
                // retired mapping/device resources are best-effort cleanup
            }
        }
        this.trackedPoseReadbackSlots = [];
        this.pendingTrackedPoseReadbacks = 0;
        this.trackedPoseReadbackCursor = 0;
        this.trackedPoseRevision++;
        this.trackedPoseHandle = null;
        this.trackedPoseSlot = -1;
        this.latestTrackedPose = createInvalidTrackedPoseSnapshot('resource-retired');
        this.towerGameplayTargetHandle = null;
        this.towerGameplayTargetSlot = -1;
        this.stagedFixedPrograms = null;
        for (const slot of this.overflowReadbackSlots) {
            slot.inFlight = false;
            try {
                slot.buffer?.destroy?.();
            } catch {
                // mapping/device loss 중인 staging buffer는 best-effort로 정리합니다.
            }
        }
        this.overflowReadbackSlots = [];
        this.pendingOverflowReadbacks = 0;
        this.overflowReadbackCursor = 0;
        if (this.buffers) {
            for (const buffer of Object.values(this.buffers)) {
                try {
                    buffer?.destroy?.();
                } catch {
                    // already lost/destroyed device resources need no further recovery here
                }
            }
        }
        try {
            this.flowTexture?.destroy?.();
        } catch {
            // already lost/destroyed texture needs no further recovery here
        }
        try {
            this.flowIntegrationTexture?.destroy?.();
        } catch {
            // already lost/destroyed texture needs no further recovery here
        }
        this.buffers = null;
        this.flowTexture = null;
        this.flowIntegrationTexture = null;
        this.bindGroups = null;
        this.pipelines = null;
        this.device = null;
        this.deviceGeneration = -1;
        this.canvasFormat = null;
        this.mapReadMode = null;
        this.uploadedComputeFixedDelta = NaN;
        this.uploadedMaximumBodyRadius = NaN;
        this.uploadedComputeFixedTick = -1;
        this.#writeTowerGameplayTargetConfig();
    }
}
