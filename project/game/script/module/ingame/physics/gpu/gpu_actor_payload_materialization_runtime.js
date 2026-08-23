import {
    ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG,
    ACTOR_PAYLOAD_MATERIALIZATION_STATUS,
    ACTOR_PAYLOAD_MATERIALIZER_ABI_VERSION,
    ACTOR_PAYLOAD_PLACEMENT_FAILURE_CLASS,
    R3_ENEMY_ACTOR_PAYLOAD_SAFE_PLACEMENT_CANDIDATES,
    R3_ENEMY_ACTOR_PAYLOAD_SAFE_PLACEMENT_RESOLVER,
    normalizeActorPayloadDefinition
} from '../../contract/actor_payload_contract.js';
import {
    ABILITY_ENTITY_METADATA_ABI_VERSION
} from '../../contract/ability_execution_contract.js';
import {
    ACTOR_PAYLOAD_CODE,
    GAMEPLAY_NOUN_MASK,
    SENTENCE_ACTION_CODE,
    SUBJECT_SELECTOR_CODE
} from '../../contract/word_sentence_contract.js';
import { GAMEPLAY_TEAM_ID } from '../../contract/gameplay_team_contract.js';
import {
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI,
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION
} from './gpu_ability_subject_snapshot_abi.js';
import {
    GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI,
    GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI_VERSION,
    GPU_ACTOR_PAYLOAD_PLACEMENT_TELEMETRY,
    createGpuActorPayloadLeaseStorage,
    readGpuActorPayloadMaterializationAggregate,
    writeGpuActorPayloadDestinationLease,
    writeGpuActorPayloadLeaseHeader
} from './gpu_actor_payload_materialization_abi.js';
import {
    GPU_ACTOR_ACTION_PLACEMENT_ABI,
    GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION,
    GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS,
    GPU_ACTOR_ACTION_PLACEMENT_STATUS,
    GPU_ACTOR_ACTION_TRANSIT_FLAG,
    GPU_ACTOR_ACTION_TRANSIT_PHASE
} from './gpu_actor_action_placement_abi.js';
import {
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_GAMEPLAY_META,
    GPU_CIRCLE_BODY_META,
    GPU_CIRCLE_BODY_SIMULATION_FLAG
} from './gpu_circle_body_abi.js';
import {
    GPU_ACTOR_TRANSIT_ABI,
    GPU_ACTOR_TRANSIT_ABI_VERSION,
    GPU_ACTOR_TRANSIT_PHASE
} from './gpu_actor_transit_abi.js';
import {
    GPU_TOWER_GROUP_ABI_VERSION,
    GPU_TOWER_GROUP_INVALID_COMPONENT,
    GPU_TOWER_GROUP_MEMBER_FLAG
} from './gpu_tower_group_abi.js';
import {
    GPU_SPAWN_ADMISSION_GRID_TYPES_WGSL,
    GPU_SPAWN_ADMISSION_SHARED_WGSL,
    GPU_SPAWN_ADMISSION_STORAGE_BINDING_COUNT
} from './gpu_spawn_admission_shaders.js';

export const GPU_ACTOR_PAYLOAD_MATERIALIZATION_STORAGE_BINDING_COUNT = 9;
export const GPU_ACTOR_PAYLOAD_MATERIALIZATION_DEFAULT_COMMAND_CAPACITY = 4;
export const GPU_ACTOR_PAYLOAD_MATERIALIZATION_DEFAULT_READBACK_SLOTS = 4;
export const GPU_ACTOR_PAYLOAD_MATERIALIZATION_WORKGROUP_SIZE = 64;

const INVALID_COMPONENT = 0xffffffff;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const LITTLE_ENDIAN = true;
const PIPELINES_BY_DEVICE = new WeakMap();
const ACTOR_ACTION_PLACEMENT_ACTION_CODES = new Set([
    SENTENCE_ACTION_CODE.THROW,
    SENTENCE_ACTION_CODE.EMIT,
    SENTENCE_ACTION_CODE.SUMMON
]);

function wgslFloat32(value) {
    return Math.fround(value).toPrecision(9);
}

const SAFE_PLACEMENT_CANDIDATE_COUNT
    = R3_ENEMY_ACTOR_PAYLOAD_SAFE_PLACEMENT_CANDIDATES.length;
const SAFE_PLACEMENT_ROTATION_COS_WGSL
    = R3_ENEMY_ACTOR_PAYLOAD_SAFE_PLACEMENT_CANDIDATES
        .map((candidate) => wgslFloat32(candidate.rotationCos)).join(', ');
const SAFE_PLACEMENT_ROTATION_SIN_WGSL
    = R3_ENEMY_ACTOR_PAYLOAD_SAFE_PLACEMENT_CANDIDATES
        .map((candidate) => wgslFloat32(candidate.rotationSin)).join(', ');
const SAFE_PLACEMENT_RADIUS_SUM_SCALE_WGSL
    = R3_ENEMY_ACTOR_PAYLOAD_SAFE_PLACEMENT_CANDIDATES
        .map((candidate) => wgslFloat32(candidate.radiusSumScale)).join(', ');
const SAFE_PLACEMENT_SURFACE_GAP_SCALE_WGSL
    = R3_ENEMY_ACTOR_PAYLOAD_SAFE_PLACEMENT_CANDIDATES
        .map((candidate) => wgslFloat32(candidate.surfaceGapScale)).join(', ');
const EXPANDING_RING_COUNT
    = R3_ENEMY_ACTOR_PAYLOAD_SAFE_PLACEMENT_RESOLVER.expandingRingCount;
const EXPANDING_RING_SLOT_COUNT
    = R3_ENEMY_ACTOR_PAYLOAD_SAFE_PLACEMENT_RESOLVER.expandingRingSlotCount;
const EXPANDING_RING_STEP_RADIUS_SCALE
    = R3_ENEMY_ACTOR_PAYLOAD_SAFE_PLACEMENT_RESOLVER
        .expandingRingStepRadiusScale;
const EXPANDING_DIRECTION_COS_WGSL = Array.from(
    { length: EXPANDING_RING_SLOT_COUNT },
    (_, index) => wgslFloat32(Math.cos(
        (index * Math.PI * 2) / EXPANDING_RING_SLOT_COUNT
    ))
).join(', ');
const EXPANDING_DIRECTION_SIN_WGSL = Array.from(
    { length: EXPANDING_RING_SLOT_COUNT },
    (_, index) => wgslFloat32(Math.sin(
        (index * Math.PI * 2) / EXPANDING_RING_SLOT_COUNT
    ))
).join(', ');
const SAFE_PLACEMENT_TOTAL_CANDIDATE_COUNT
    = SAFE_PLACEMENT_CANDIDATE_COUNT
        + EXPANDING_RING_COUNT * EXPANDING_RING_SLOT_COUNT;

const HEADER_WORD_COUNT
    = GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.LEASE_HEADER.STRIDE / 4;
const LEASE_WORD_COUNT
    = GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.DESTINATION_LEASE.STRIDE / 4;
const SNAPSHOT_WORD_COUNT
    = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE / 4;
const AGGREGATE_WORD_COUNT
    = GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.AGGREGATE.STRIDE / 4;
const VALIDATION_WORD_COUNT
    = GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.VALIDATION_RECORD.STRIDE / 4;

const H = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.LEASE_HEADER)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));
const R = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.DESTINATION_LEASE)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));
const S = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));
const V = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.VALIDATION_RECORD)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));
const A = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.AGGREGATE)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));
const AP = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));
const AA = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));
const AT = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));
const TR = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_TRANSIT_ABI.RECORD)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));

export const GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL = /* wgsl */`
struct BodyPhysics {
    position: vec2f,
    velocity: vec2f,
    radius: f32,
    inverse_mass: f32,
    physical_meta: u32,
    interaction_meta: u32,
}

struct BodySimulation {
    lifetime: f32,
    health: atomic<i32>,
    gameplay_meta: u32,
    flags: atomic<u32>,
    flow_field_index: u32,
    flow_speed: f32,
    entity_id: u32,
    incarnation: u32,
}

struct AbilityEntityMetadata {
    abi_version: u32,
    noun_mask: u32,
    definition_code: u32,
    owner_entity_id: u32,
    owner_incarnation: u32,
    source_ability_code: u32,
    source_execution_fingerprint: u32,
    source_execution_ordinal: u32,
    generation: u32,
    visible_from_execution_ordinal: u32,
    creation_origin_code: u32,
    power_fixed_point: u32,
}

struct RouteRuntimeState {
    route_meta: u32,
    self_entity_id: u32,
    self_incarnation: u32,
    current_path_index: u32,
    route_set_index: u32,
    closure_index: u32,
    observed_availability_version: u32,
    phase_entered_fixed_tick: u32,
    travel_radius: f32,
    blocker_radius: f32,
    expansion_duration_fixed_ticks: u32,
    pending_field_index: u32,
    lease_generation: u32,
    profile_code: u32,
    reserved_0: u32,
    reserved_1: u32,
}

struct EnemyBehaviorState {
    program_id: u32,
    state: u32,
    state_entered_fixed_tick: u32,
    state_expires_at_fixed_tick: u32,
    target_slot: u32,
    target_entity_id: u32,
    target_incarnation: u32,
    flags: u32,
    facing_x: f32,
    facing_y: f32,
    windup_range: f32,
    charge_speed: f32,
    recoil_impulse: f32,
    windup_ticks: u32,
    charge_max_ticks: u32,
    recoil_ticks: u32,
    recover_ticks: u32,
    telegraph_style_code: u32,
    telegraph_color_rgba8: u32,
    telegraph_radius_scale: f32,
    charge_acceleration: f32,
    reserved_0: u32,
    reserved_1: u32,
    reserved_2: u32,
}

struct RawReadBuffer { values: array<u32> }
struct RawAtomicBuffer { values: array<atomic<u32>> }
struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct AbilityMetadataBuffer { values: array<AbilityEntityMetadata> }
struct RouteRuntimeBuffer { values: array<RouteRuntimeState> }
struct EnemyBehaviorBuffer { values: array<EnemyBehaviorState> }
struct SdfBuffer { values: array<f32> }

@group(0) @binding(0) var<storage, read> snapshots: RawReadBuffer;
@group(0) @binding(1) var<storage, read> leases: RawReadBuffer;
@group(0) @binding(2) var<storage, read_write> physics: PhysicsBuffer;
@group(0) @binding(3) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(4) var<storage, read_write> ability_metadata: AbilityMetadataBuffer;
@group(0) @binding(5) var<storage, read_write> route_states: RouteRuntimeBuffer;
@group(0) @binding(6) var<storage, read_write> enemy_behaviors: EnemyBehaviorBuffer;
@group(0) @binding(7) var<storage, read> sdf: SdfBuffer;
@group(0) @binding(8) var<storage, read_write> aggregate: RawAtomicBuffer;

const MATERIALIZER_ABI: u32 = ${GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI_VERSION}u;
const SNAPSHOT_ABI: u32 = ${GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION}u;
const BODY_ABI: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;
const METADATA_ABI: u32 = ${ABILITY_ENTITY_METADATA_ABI_VERSION}u;
const HEADER_WORDS: u32 = ${HEADER_WORD_COUNT}u;
const LEASE_WORDS: u32 = ${LEASE_WORD_COUNT}u;
const SNAPSHOT_WORDS: u32 = ${SNAPSHOT_WORD_COUNT}u;
const AGGREGATE_WORDS: u32 = ${AGGREGATE_WORD_COUNT}u;
const VALIDATION_WORDS: u32 = ${VALIDATION_WORD_COUNT}u;
const INVALID: u32 = 0xffffffffu;
const FNV_OFFSET: u32 = ${FNV_OFFSET}u;
const FNV_PRIME: u32 = ${FNV_PRIME}u;
const ALIVE_FLAG: u32 = ${GPU_CIRCLE_BODY_META.ALIVE_BIT}u;
const CONTROLLED_FLAG: u32 =
    ${GPU_CIRCLE_BODY_SIMULATION_FLAG.CONTROLLED_THIS_TICK}u;
const EXTERNAL_MOTION_FLAG: u32 =
    ${GPU_CIRCLE_BODY_SIMULATION_FLAG.EXTERNAL_MOTION_OWNER_THIS_TICK}u;
const TEAM_SHIFT: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_SHIFT}u;
const TEAM_MASK: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_MASK}u;
const TOWER_SELECTOR: u32 = ${SUBJECT_SELECTOR_CODE.TOWER}u;
const ENEMY_SELECTOR: u32 = ${SUBJECT_SELECTOR_CODE.ENEMY}u;
const TOWER_NOUN: u32 = ${GAMEPLAY_NOUN_MASK.TOWER}u;
const ENEMY_NOUN: u32 = ${GAMEPLAY_NOUN_MASK.ENEMY}u;
const NEUTRAL_TEAM: u32 = ${GAMEPLAY_TEAM_ID.NEUTRAL}u;
const PLAYER_TEAM: u32 = ${GAMEPLAY_TEAM_ID.PLAYER}u;
const HOSTILE_TEAM: u32 = ${GAMEPLAY_TEAM_ID.HOSTILE}u;
const STATUS_COMPLETE: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_STATUS.COMPLETE}u;
const STATUS_PENDING: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_STATUS.PENDING}u;
const STATUS_SDF_REJECTED: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_STATUS.SDF_REJECTED}u;
const STATUS_PROTOCOL_REJECTED: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_STATUS.PROTOCOL_REJECTED}u;
const ERROR_BODY_ABI: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.BODY_ABI}u;
const ERROR_SNAPSHOT_ABI: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.SNAPSHOT_ABI}u;
const ERROR_LEASE_ABI: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.LEASE_ABI}u;
const ERROR_DESTINATION_IDENTITY: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.DESTINATION_IDENTITY}u;
const ERROR_SOURCE_RECORD: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.SOURCE_RECORD}u;
const ERROR_SDF_PLACEMENT: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.SDF_PLACEMENT}u;
const ERROR_GENERATION: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.GENERATION}u;
const ERROR_STALE_PROTOCOL: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.STALE_PROTOCOL}u;
const ERROR_DYNAMIC_BODY_OVERLAP: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.DYNAMIC_BODY_OVERLAP}u;
const ERROR_SIBLING_BODY_OVERLAP: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.SIBLING_BODY_OVERLAP}u;
const ERROR_GRID_CELL_CAPACITY: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.GRID_CELL_CAPACITY}u;
const ERROR_NO_VALID_GLOBAL_PLACEMENT: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.NO_VALID_GLOBAL_PLACEMENT}u;
const PLACEMENT_FAILURE_NONE: u32 =
    ${ACTOR_PAYLOAD_PLACEMENT_FAILURE_CLASS.NONE}u;
const PLACEMENT_FAILURE_STATIC_SDF: u32 =
    ${ACTOR_PAYLOAD_PLACEMENT_FAILURE_CLASS.STATIC_SDF}u;
const PLACEMENT_FAILURE_DYNAMIC_BODY_OVERLAP: u32 =
    ${ACTOR_PAYLOAD_PLACEMENT_FAILURE_CLASS.DYNAMIC_BODY_OVERLAP}u;
const PLACEMENT_FAILURE_STATIC_AND_DYNAMIC: u32 =
    ${ACTOR_PAYLOAD_PLACEMENT_FAILURE_CLASS
        .STATIC_SDF_AND_DYNAMIC_BODY_OVERLAP}u;
const PLACEMENT_RANK_NONE: u32 =
    ${GPU_ACTOR_PAYLOAD_PLACEMENT_TELEMETRY.RANK_NONE}u;
const SAFE_PLACEMENT_CANDIDATE_COUNT: u32 =
    ${SAFE_PLACEMENT_CANDIDATE_COUNT}u;
const SAFE_PLACEMENT_ROTATION_COS = array<f32,
    ${SAFE_PLACEMENT_CANDIDATE_COUNT}>(
    ${SAFE_PLACEMENT_ROTATION_COS_WGSL}
);
const SAFE_PLACEMENT_ROTATION_SIN = array<f32,
    ${SAFE_PLACEMENT_CANDIDATE_COUNT}>(
    ${SAFE_PLACEMENT_ROTATION_SIN_WGSL}
);
const SAFE_PLACEMENT_RADIUS_SUM_SCALE = array<f32,
    ${SAFE_PLACEMENT_CANDIDATE_COUNT}>(
    ${SAFE_PLACEMENT_RADIUS_SUM_SCALE_WGSL}
);
const SAFE_PLACEMENT_SURFACE_GAP_SCALE = array<f32,
    ${SAFE_PLACEMENT_CANDIDATE_COUNT}>(
    ${SAFE_PLACEMENT_SURFACE_GAP_SCALE_WGSL}
);
fn header(field: u32) -> u32 {
    return leases.values[field];
}

fn lease_word(rank: u32, field: u32) -> u32 {
    return leases.values[HEADER_WORDS + rank * LEASE_WORDS + field];
}

fn snapshot_word(rank: u32, field: u32) -> u32 {
    return snapshots.values[
        header(${H.SNAPSHOT_WORD_OFFSET}u) + rank * SNAPSHOT_WORDS + field
    ];
}

fn store_aggregate(field: u32, value: u32) {
    atomicStore(&aggregate.values[field], value);
}

fn store_validation(rank: u32, field: u32, value: u32) {
    atomicStore(
        &aggregate.values[AGGREGATE_WORDS + rank * VALIDATION_WORDS + field],
        value
    );
}

fn validation_word(rank: u32, field: u32) -> u32 {
    return atomicLoad(
        &aggregate.values[AGGREGATE_WORDS + rank * VALIDATION_WORDS + field]
    );
}

fn hash_word(current: u32, value: u32) -> u32 {
    return (current ^ value) * FNV_PRIME;
}

fn normalized_or_fallback(value: vec2f, fallback: vec2f) -> vec2f {
    let length_squared = dot(value, value);
    if (length_squared > 0.000001) {
        return normalize(value);
    }
    let fallback_length_squared = dot(fallback, fallback);
    if (fallback_length_squared > 0.000001) {
        return normalize(fallback);
    }
    return vec2f(1.0, 0.0);
}

fn is_alive(slot: u32) -> bool {
    return slot < arrayLength(&simulations.values)
        && (atomicLoad(&simulations.values[slot].flags) & ALIVE_FLAG) != 0u;
}

fn body_team(slot: u32) -> u32 {
    return (simulations.values[slot].gameplay_meta >> TEAM_SHIFT) & TEAM_MASK;
}

fn source_position(rank: u32) -> vec2f {
    return vec2f(
        bitcast<f32>(snapshot_word(rank, ${S.POSITION_X}u)),
        bitcast<f32>(snapshot_word(rank, ${S.POSITION_Y}u))
    );
}

fn source_facing(rank: u32) -> vec2f {
    return normalized_or_fallback(vec2f(
        bitcast<f32>(snapshot_word(rank, ${S.FACING_X}u)),
        bitcast<f32>(snapshot_word(rank, ${S.FACING_Y}u))
    ), vec2f(1.0, 0.0));
}

fn exact_player_target(
    slot: u32,
    entity_id: u32,
    incarnation: u32,
    expected_team: u32,
    noun_mask: u32
) -> bool {
    return slot < arrayLength(&simulations.values)
        && is_alive(slot)
        && body_team(slot) == expected_team
        && simulations.values[slot].entity_id == entity_id
        && simulations.values[slot].incarnation == incarnation
        && (noun_mask == 0u
            || (ability_metadata.values[slot].abi_version == METADATA_ABI
                && (ability_metadata.values[slot].noun_mask & noun_mask)
                    == noun_mask));
}

fn resolve_launch_direction(rank: u32) -> vec2f {
    let position = source_position(rank);
    let facing = source_facing(rank);
    if (header(${H.SOURCE_SELECTOR_CODE}u) == TOWER_SELECTOR) {
        let aim = vec2f(
            bitcast<f32>(header(${H.AIM_POINT_X}u)),
            bitcast<f32>(header(${H.AIM_POINT_Y}u))
        );
        return normalized_or_fallback(aim - position, facing);
    }

    let tower_slot = header(${H.TOWER_SLOT}u);
    if (exact_player_target(
        tower_slot,
        header(${H.TOWER_ENTITY_ID}u),
        header(${H.TOWER_INCARNATION}u),
        PLAYER_TEAM,
        TOWER_NOUN
    )) {
        return normalized_or_fallback(
            physics.values[tower_slot].position - position,
            facing
        );
    }

    let core_slot = header(${H.CORE_SLOT}u);
    if (exact_player_target(
        core_slot,
        header(${H.CORE_ENTITY_ID}u),
        header(${H.CORE_INCARNATION}u),
        NEUTRAL_TEAM,
        0u
    )) {
        return normalized_or_fallback(
            physics.values[core_slot].position - position,
            facing
        );
    }
    return facing;
}

fn read_sdf(column: i32, row: i32) -> f32 {
    let cols = i32(header(${H.SDF_COLS}u));
    let rows = i32(header(${H.SDF_ROWS}u));
    let x = clamp(column, 0, cols - 1);
    let y = clamp(row, 0, rows - 1);
    return sdf.values[u32(y * cols + x)];
}

fn sample_sdf(position: vec2f) -> f32 {
    let world_width = bitcast<f32>(header(${H.WORLD_WIDTH}u));
    let world_height = bitcast<f32>(header(${H.WORLD_HEIGHT}u));
    let cols = f32(header(${H.SDF_COLS}u));
    let rows = f32(header(${H.SDF_ROWS}u));
    let uv = clamp(
        vec2f(position.x / world_width, position.y / world_height),
        vec2f(0.0),
        vec2f(1.0)
    );
    let coordinate = vec2f(uv.x * cols - 0.5, uv.y * rows - 0.5);
    let base = vec2i(floor(coordinate));
    let fraction = fract(coordinate);
    let top = mix(
        read_sdf(base.x, base.y),
        read_sdf(base.x + 1, base.y),
        fraction.x
    );
    let bottom = mix(
        read_sdf(base.x, base.y + 1),
        read_sdf(base.x + 1, base.y + 1),
        fraction.x
    );
    return mix(top, bottom, fraction.y);
}

fn valid_spawn_point(position: vec2f, radius: f32) -> bool {
    let world_width = bitcast<f32>(header(${H.WORLD_WIDTH}u));
    let world_height = bitcast<f32>(header(${H.WORLD_HEIGHT}u));
    let inside = position.x >= radius
        && position.y >= radius
        && position.x <= world_width - radius
        && position.y <= world_height - radius;
    if (!inside) {
        return false;
    }
    if (header(${H.SDF_ENABLED}u) == 0u) {
        return true;
    }
    return sample_sdf(position) >= radius;
}

fn safe_placement_direction(
    authored_direction: vec2f,
    candidate_index: u32
) -> vec2f {
    let cosine = SAFE_PLACEMENT_ROTATION_COS[candidate_index];
    let sine = SAFE_PLACEMENT_ROTATION_SIN[candidate_index];
    return normalized_or_fallback(vec2f(
        authored_direction.x * cosine - authored_direction.y * sine,
        authored_direction.x * sine + authored_direction.y * cosine
    ), authored_direction);
}

fn safe_placement_candidate_position(
    rank: u32,
    destination_slot: u32,
    direction: vec2f,
    candidate_index: u32
) -> vec2f {
    let source_rank = lease_word(rank, ${R.SNAPSHOT_RANK}u);
    let source_radius = bitcast<f32>(
        snapshot_word(source_rank, ${S.RADIUS}u)
    );
    let destination_radius = physics.values[destination_slot].radius;
    let surface_gap = bitcast<f32>(header(${H.SURFACE_GAP}u));
    return source_position(source_rank)
        + direction * (
            (source_radius + destination_radius)
                * SAFE_PLACEMENT_RADIUS_SUM_SCALE[candidate_index]
            + surface_gap
                * SAFE_PLACEMENT_SURFACE_GAP_SCALE[candidate_index]
        );
}

fn pack_placement_telemetry(
    rank: u32,
    attempted_candidate_count: u32,
    failure_class: u32
) -> u32 {
    return (rank & 0xffffu)
        | ((attempted_candidate_count & 0xffu) << 16u)
        | ((failure_class & 0xffu) << 24u);
}

fn reject(status: u32, errors: u32) {
    store_aggregate(${A.STATUS}u, status);
    store_aggregate(${A.ERROR_FLAGS}u, errors);
}

fn u32_multiplication_overflows(left: u32, right: u32) -> bool {
    let left_low = left & 0xffffu;
    let left_high = left >> 16u;
    let right_low = right & 0xffffu;
    let right_high = right >> 16u;
    if (left_high * right_high != 0u) { return true; }
    let cross_left = left_high * right_low;
    let cross_right = left_low * right_high;
    if (cross_left > 0xffffu || cross_right > 0xffffu) { return true; }
    let low_carry = (left_low * right_low) >> 16u;
    return cross_left + cross_right + low_carry > 0xffffu;
}

@compute @workgroup_size(1)
fn initialize_actor_payload() {
    for (var word = 0u; word < AGGREGATE_WORDS; word++) {
        store_aggregate(word, 0u);
    }
    store_aggregate(${A.ABI_VERSION}u, MATERIALIZER_ABI);
    store_aggregate(${A.BODY_ABI_VERSION}u, BODY_ABI);
    store_aggregate(${A.SESSION_GENERATION}u,
        header(${H.SESSION_GENERATION}u));
    store_aggregate(${A.DEVICE_GENERATION}u,
        header(${H.DEVICE_GENERATION}u));
    store_aggregate(${A.AUTHORITATIVE_EPOCH}u,
        header(${H.AUTHORITATIVE_EPOCH}u));
    store_aggregate(${A.SNAPSHOT_SOURCE_TICK}u,
        header(${H.SNAPSHOT_SOURCE_TICK}u));
    store_aggregate(${A.MATERIALIZATION_TARGET_TICK}u,
        header(${H.MATERIALIZATION_TARGET_TICK}u));
    store_aggregate(${A.EXECUTION_ORDINAL}u,
        header(${H.EXECUTION_ORDINAL}u));
    store_aggregate(${A.SUBJECT_COUNT}u, header(${H.SUBJECT_COUNT}u));
    store_aggregate(${A.DESTINATION_COUNT}u,
        header(${H.DESTINATION_COUNT}u));
    store_aggregate(${A.COMMAND_FINGERPRINT}u,
        header(${H.COMMAND_FINGERPRINT}u));
    store_aggregate(${A.SNAPSHOT_FINGERPRINT}u,
        header(${H.SNAPSHOT_FINGERPRINT}u));
    store_aggregate(${A.ACTOR_ACTION_PROFILE_FINGERPRINT}u,
        header(${H.ACTOR_ACTION_PROFILE_FINGERPRINT}u));
    store_aggregate(${A.PLACEMENT_FINGERPRINT}u,
        header(${H.PLACEMENT_FINGERPRINT}u));
    store_aggregate(${A.PLACEMENT_TELEMETRY}u, pack_placement_telemetry(
        PLACEMENT_RANK_NONE,
        0u,
        PLACEMENT_FAILURE_NONE
    ));
    store_aggregate(${A.COPIES_PER_SUBJECT}u,
        header(${H.COPIES_PER_SUBJECT}u));
    store_aggregate(${A.MODIFIER_SET_FINGERPRINT}u,
        header(${H.MODIFIER_SET_FINGERPRINT}u));

    if (header(${H.ABI_VERSION}u) != MATERIALIZER_ABI) {
        reject(STATUS_PROTOCOL_REJECTED, ERROR_LEASE_ABI);
        return;
    }
    if (header(${H.SNAPSHOT_ABI_VERSION}u) != SNAPSHOT_ABI) {
        reject(STATUS_PROTOCOL_REJECTED, ERROR_SNAPSHOT_ABI);
        return;
    }
    if (header(${H.BODY_ABI_VERSION}u) != BODY_ABI) {
        reject(STATUS_PROTOCOL_REJECTED, ERROR_BODY_ABI);
        return;
    }
    let subject_count = header(${H.SUBJECT_COUNT}u);
    let destination_count = header(${H.DESTINATION_COUNT}u);
    let copies_per_subject = header(${H.COPIES_PER_SUBJECT}u);
    let selector = header(${H.SOURCE_SELECTOR_CODE}u);
    let exact_selector = selector == TOWER_SELECTOR
        || selector == ENEMY_SELECTOR;
    if (subject_count == 0u || destination_count == 0u
        || copies_per_subject == 0u
        || u32_multiplication_overflows(
            subject_count,
            copies_per_subject
        )
        || subject_count * copies_per_subject != destination_count
        || !exact_selector
        || header(${H.PAYLOAD_NOUN_MASK}u) != ENEMY_NOUN
        || header(${H.PAYLOAD_TEAM_ID}u) != HOSTILE_TEAM
        || header(${H.EXECUTION_ORDINAL}u) == 0u
        || header(${H.EXECUTION_ORDINAL}u) == INVALID
        || header(${H.GENERATION_LIMIT}u) == 0u
        || header(${H.GENERATION_LIMIT}u) == INVALID) {
        reject(STATUS_PROTOCOL_REJECTED, ERROR_STALE_PROTOCOL);
        return;
    }
}

@compute @workgroup_size(64)
fn validate_actor_payload(@builtin(global_invocation_id) invocation: vec3u) {
    let rank = invocation.x;
    let destination_count = header(${H.DESTINATION_COUNT}u);
    if (rank >= destination_count) {
        return;
    }
    if (atomicLoad(&aggregate.values[${A.STATUS}u]) != STATUS_PENDING) {
        return;
    }

    var errors = 0u;
    let selector = header(${H.SOURCE_SELECTOR_CODE}u);
    let source_rank = lease_word(rank, ${R.SNAPSHOT_RANK}u);
    let copy_index = lease_word(rank, ${R.COPY_INDEX}u);
    let copies_per_subject = header(${H.COPIES_PER_SUBJECT}u);
    let source_entity_id = snapshot_word(source_rank, ${S.ENTITY_ID}u);
    let source_incarnation = snapshot_word(source_rank, ${S.INCARNATION}u);
    let source_team = snapshot_word(source_rank, ${S.TEAM_ID}u);
    let source_generation = snapshot_word(source_rank, ${S.GENERATION}u);
    let source_radius = bitcast<f32>(snapshot_word(source_rank, ${S.RADIUS}u));
    var source_team_valid = source_team == HOSTILE_TEAM;
    if (selector == TOWER_SELECTOR) {
        source_team_valid = source_team == PLAYER_TEAM;
    }
    if (source_entity_id == 0u || source_entity_id == INVALID
        || source_incarnation == 0u || source_incarnation == INVALID
        || !source_team_valid || !(source_radius > 0.0)) {
        errors = errors | ERROR_SOURCE_RECORD;
    }
    if (source_generation >= header(${H.GENERATION_LIMIT}u)) {
        errors = errors | ERROR_GENERATION;
    }

    let destination_slot = lease_word(rank, ${R.DESTINATION_SLOT}u);
    let destination_entity_id = lease_word(rank, ${R.DESTINATION_ENTITY_ID}u);
    let destination_incarnation = lease_word(
        rank,
        ${R.DESTINATION_INCARNATION}u
    );
    let body_capacity = arrayLength(&simulations.values);
    if (source_rank != rank / copies_per_subject
        || copy_index != rank % copies_per_subject
        || destination_slot >= body_capacity
        || destination_entity_id == 0u
        || destination_entity_id == INVALID
        || destination_incarnation == 0u
        || destination_incarnation == INVALID) {
        errors = errors | ERROR_DESTINATION_IDENTITY;
    }
    if (destination_slot < body_capacity) {
        let destination_flags = atomicLoad(
            &simulations.values[destination_slot].flags
        );
        if (simulations.values[destination_slot].entity_id
                != destination_entity_id
            || simulations.values[destination_slot].incarnation
                != destination_incarnation
            || (destination_flags & ALIVE_FLAG) != 0u
            || body_team(destination_slot) != HOSTILE_TEAM) {
            errors = errors | ERROR_DESTINATION_IDENTITY;
        }
    }

    let chosen_candidate_index = INVALID;
    let attempted_candidate_count = 0u;
    let placement_failure_class = PLACEMENT_FAILURE_NONE;
    if (errors == 0u) {
        let destination_radius = physics.values[destination_slot].radius;
        let authored_direction = normalized_or_fallback(vec2f(
            bitcast<f32>(validation_word(rank, ${V.DIRECTION_X}u)),
            bitcast<f32>(validation_word(rank, ${V.DIRECTION_Y}u))
        ), source_facing(source_rank));
        if (!(destination_radius > 0.0)) {
            errors = errors | ERROR_SDF_PLACEMENT;
        }
        store_validation(rank, ${V.POSITION_X}u,
            bitcast<u32>(source_position(source_rank).x));
        store_validation(rank, ${V.POSITION_Y}u,
            bitcast<u32>(source_position(source_rank).y));
        store_validation(rank, ${V.DIRECTION_X}u,
            bitcast<u32>(authored_direction.x));
        store_validation(rank, ${V.DIRECTION_Y}u,
            bitcast<u32>(authored_direction.y));
    }
    store_validation(rank, ${V.CHOSEN_CANDIDATE_INDEX}u,
        chosen_candidate_index);
    store_validation(rank, ${V.ATTEMPTED_CANDIDATE_COUNT}u,
        attempted_candidate_count);
    store_validation(rank, ${V.PLACEMENT_FAILURE_CLASS}u,
        placement_failure_class);
    store_validation(rank, ${V.ERROR_FLAGS}u, errors);
}

@compute @workgroup_size(1)
fn aggregate_actor_payload_validation() {
    if (atomicLoad(&aggregate.values[${A.STATUS}u]) != STATUS_PENDING) {
        return;
    }
    let subject_count = header(${H.SUBJECT_COUNT}u);
    let destination_count = header(${H.DESTINATION_COUNT}u);
    let copies_per_subject = header(${H.COPIES_PER_SUBJECT}u);
    var errors = 0u;
    var first_placement_rank = PLACEMENT_RANK_NONE;
    var placement_attempted_candidate_count = 0u;
    var placement_failure_class = PLACEMENT_FAILURE_NONE;
    var destination_fingerprint = hash_word(
        FNV_OFFSET,
        header(${H.COMMAND_FINGERPRINT}u)
    );
    destination_fingerprint = hash_word(destination_fingerprint, subject_count);
    destination_fingerprint = hash_word(
        destination_fingerprint,
        destination_count
    );
    destination_fingerprint = hash_word(
        destination_fingerprint,
        copies_per_subject
    );
    destination_fingerprint = hash_word(
        destination_fingerprint,
        header(${H.MODIFIER_SET_FINGERPRINT}u)
    );
    for (var rank = 0u; rank < destination_count; rank++) {
        let rank_errors = validation_word(rank, ${V.ERROR_FLAGS}u);
        let rank_attempted_candidate_count = validation_word(
            rank,
            ${V.ATTEMPTED_CANDIDATE_COUNT}u
        );
        errors = errors | rank_errors;
        if ((rank_errors
                & (ERROR_SDF_PLACEMENT | ERROR_DYNAMIC_BODY_OVERLAP)) != 0u
            && placement_failure_class == PLACEMENT_FAILURE_NONE) {
            first_placement_rank = rank;
            placement_attempted_candidate_count
                = rank_attempted_candidate_count;
            placement_failure_class = validation_word(
                rank,
                ${V.PLACEMENT_FAILURE_CLASS}u
            );
        } else if (rank_errors == 0u) {
            placement_attempted_candidate_count = max(
                placement_attempted_candidate_count,
                rank_attempted_candidate_count
            );
            if (first_placement_rank == PLACEMENT_RANK_NONE
                && validation_word(rank, ${V.CHOSEN_CANDIDATE_INDEX}u) > 0u) {
                first_placement_rank = rank;
            }
        }
        let destination_slot = lease_word(rank, ${R.DESTINATION_SLOT}u);
        let destination_entity_id = lease_word(
            rank,
            ${R.DESTINATION_ENTITY_ID}u
        );
        let destination_incarnation = lease_word(
            rank,
            ${R.DESTINATION_INCARNATION}u
        );
        destination_fingerprint = hash_word(
            destination_fingerprint,
            destination_slot
        );
        destination_fingerprint = hash_word(
            destination_fingerprint,
            destination_entity_id
        );
        destination_fingerprint = hash_word(
            destination_fingerprint,
            destination_incarnation
        );
        destination_fingerprint = hash_word(
            destination_fingerprint,
            lease_word(rank, ${R.SNAPSHOT_RANK}u)
        );
        destination_fingerprint = hash_word(destination_fingerprint, rank);
        destination_fingerprint = hash_word(
            destination_fingerprint,
            lease_word(rank, ${R.COPY_INDEX}u)
        );
    }
    destination_fingerprint = select(
        destination_fingerprint,
        FNV_OFFSET,
        destination_fingerprint == 0u
    );
    store_aggregate(${A.DESTINATION_FINGERPRINT}u,
        destination_fingerprint);
    store_aggregate(${A.ERROR_FLAGS}u, errors);
    store_aggregate(${A.PLACEMENT_TELEMETRY}u, pack_placement_telemetry(
        first_placement_rank,
        placement_attempted_candidate_count,
        placement_failure_class
    ));
    if (errors == 0u) {
        store_aggregate(${A.STATUS}u, STATUS_COMPLETE);
    } else if ((errors
        & ~(ERROR_SDF_PLACEMENT
            | ERROR_DYNAMIC_BODY_OVERLAP
            | ERROR_SIBLING_BODY_OVERLAP
            | ERROR_GRID_CELL_CAPACITY
            | ERROR_NO_VALID_GLOBAL_PLACEMENT)) == 0u) {
        store_aggregate(${A.STATUS}u, STATUS_SDF_REJECTED);
    } else {
        store_aggregate(${A.STATUS}u, STATUS_PROTOCOL_REJECTED);
    }
}

@compute @workgroup_size(64)
fn materialize_actor_payload(@builtin(global_invocation_id) invocation: vec3u) {
    let rank = invocation.x;
    let destination_count = header(${H.DESTINATION_COUNT}u);
    if (rank >= destination_count
        || atomicLoad(&aggregate.values[${A.STATUS}u]) != STATUS_COMPLETE
        || atomicLoad(&aggregate.values[${A.ERROR_FLAGS}u]) != 0u) {
        return;
    }
    let source_rank = lease_word(rank, ${R.SNAPSHOT_RANK}u);
    let destination_slot = lease_word(rank, ${R.DESTINATION_SLOT}u);
    let destination_entity_id = lease_word(rank, ${R.DESTINATION_ENTITY_ID}u);
    let destination_incarnation = lease_word(
        rank,
        ${R.DESTINATION_INCARNATION}u
    );
    let direction = vec2f(
        bitcast<f32>(validation_word(rank, ${V.DIRECTION_X}u)),
        bitcast<f32>(validation_word(rank, ${V.DIRECTION_Y}u))
    );
    physics.values[destination_slot].position = vec2f(
        bitcast<f32>(validation_word(rank, ${V.POSITION_X}u)),
        bitcast<f32>(validation_word(rank, ${V.POSITION_Y}u))
    );
        physics.values[destination_slot].velocity = direction
            * bitcast<f32>(header(${H.LAUNCH_SPEED}u));

    let selector = header(${H.SOURCE_SELECTOR_CODE}u);
    if (selector == ENEMY_SELECTOR) {
        simulations.values[destination_slot].flow_field_index
            = snapshot_word(source_rank, ${S.FLOW_FIELD_INDEX}u);
        simulations.values[destination_slot].flow_speed = bitcast<f32>(
            snapshot_word(source_rank, ${S.FLOW_SPEED}u)
        );
        route_states.values[destination_slot].route_meta
            = snapshot_word(source_rank, ${S.ROUTE_META}u);
        route_states.values[destination_slot].current_path_index
            = snapshot_word(source_rank, ${S.ROUTE_PATH_INDEX}u);
        route_states.values[destination_slot].route_set_index
            = snapshot_word(source_rank, ${S.ROUTE_SET_INDEX}u);
        route_states.values[destination_slot].profile_code
            = snapshot_word(source_rank, ${S.ROUTE_PROFILE_CODE}u);
    } else {
        simulations.values[destination_slot].flow_field_index
            = header(${H.DEFAULT_FLOW_FIELD_INDEX}u);
        route_states.values[destination_slot].route_meta
            = lease_word(rank, ${R.DEFAULT_ROUTE_META}u);
        route_states.values[destination_slot].current_path_index
            = header(${H.DEFAULT_CURRENT_PATH_INDEX}u);
        route_states.values[destination_slot].route_set_index
            = header(${H.DEFAULT_ROUTE_SET_INDEX}u);
        route_states.values[destination_slot].profile_code
            = lease_word(rank, ${R.DEFAULT_ROUTE_PROFILE_CODE}u);
    }
    route_states.values[destination_slot].self_entity_id = destination_entity_id;
    route_states.values[destination_slot].self_incarnation = destination_incarnation;
    enemy_behaviors.values[destination_slot].facing_x = direction.x;
    enemy_behaviors.values[destination_slot].facing_y = direction.y;

    ability_metadata.values[destination_slot].abi_version = METADATA_ABI;
    ability_metadata.values[destination_slot].noun_mask
        = header(${H.PAYLOAD_NOUN_MASK}u);
    ability_metadata.values[destination_slot].definition_code
        = header(${H.PAYLOAD_DEFINITION_CODE}u);
    ability_metadata.values[destination_slot].owner_entity_id
        = snapshot_word(source_rank, ${S.ENTITY_ID}u);
    ability_metadata.values[destination_slot].owner_incarnation
        = snapshot_word(source_rank, ${S.INCARNATION}u);
    ability_metadata.values[destination_slot].source_ability_code
        = header(${H.SOURCE_ABILITY_CODE}u);
    ability_metadata.values[destination_slot].source_execution_fingerprint
        = header(${H.SOURCE_EXECUTION_FINGERPRINT}u);
    ability_metadata.values[destination_slot].source_execution_ordinal
        = header(${H.EXECUTION_ORDINAL}u);
    ability_metadata.values[destination_slot].generation
        = snapshot_word(source_rank, ${S.GENERATION}u) + 1u;
    ability_metadata.values[destination_slot].visible_from_execution_ordinal
        = header(${H.EXECUTION_ORDINAL}u) + 1u;
    ability_metadata.values[destination_slot].creation_origin_code
        = header(${H.CREATION_ORIGIN_CODE}u);
    ability_metadata.values[destination_slot].power_fixed_point
        = snapshot_word(source_rank, ${S.POWER_FIXED_POINT}u);

    let baseline_flags = lease_word(rank, ${R.BASELINE_FLAGS}u) & ~ALIVE_FLAG;
    atomicStore(
        &simulations.values[destination_slot].flags,
        baseline_flags | CONTROLLED_FLAG | EXTERNAL_MOTION_FLAG
    );
    atomicAdd(&aggregate.values[${A.MATERIALIZED_COUNT}u], 1u);
}
`;

export const GPU_ACTOR_PAYLOAD_SPAWN_ADMISSION_WGSL = /* wgsl */`
struct BodyPhysics {
    position: vec2f,
    velocity: vec2f,
    radius: f32,
    inverse_mass: f32,
    physical_meta: u32,
    interaction_meta: u32,
}

struct BodySimulation {
    lifetime: f32,
    health: i32,
    gameplay_meta: u32,
    flags: u32,
    flow_field_index: u32,
    flow_speed: f32,
    entity_id: u32,
    incarnation: u32,
}

struct RawReadBuffer { values: array<u32> }
struct RawAtomicBuffer { values: array<atomic<u32>> }
struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct SdfBuffer { values: array<f32> }
${GPU_SPAWN_ADMISSION_GRID_TYPES_WGSL}

@group(0) @binding(0) var<storage, read> admission_snapshots: RawReadBuffer;
@group(0) @binding(1) var<storage, read> admission_leases: RawReadBuffer;
@group(0) @binding(2) var<storage, read> admission_physics: PhysicsBuffer;
@group(0) @binding(3) var<storage, read> admission_simulations: SimulationBuffer;
@group(0) @binding(4) var<storage, read> admission_sdf: SdfBuffer;
@group(0) @binding(5) var<storage, read_write> admission_output: RawAtomicBuffer;
@group(0) @binding(6) var<storage, read_write> admission_grid_counts: AtomicGridCounts;
@group(0) @binding(7) var<storage, read> admission_grid_bodies: GridBodyBuffer;
@group(1) @binding(0) var<uniform> params: SimulationParams;

const SPAWN_ADMISSION_ALIVE_FLAG: u32 = ${GPU_CIRCLE_BODY_META.ALIVE_BIT}u;
const ADMISSION_INVALID: u32 = 0xffffffffu;
const ADMISSION_FNV_OFFSET: u32 = 0x811c9dc5u;
const ADMISSION_FNV_PRIME: u32 = 0x01000193u;
const ADMISSION_AGGREGATE_WORDS: u32 = ${AGGREGATE_WORD_COUNT}u;
const ADMISSION_VALIDATION_WORDS: u32 = ${VALIDATION_WORD_COUNT}u;
const ADMISSION_HEADER_WORDS: u32 = ${HEADER_WORD_COUNT}u;
const ADMISSION_LEASE_WORDS: u32 = ${LEASE_WORD_COUNT}u;
const ADMISSION_SNAPSHOT_WORDS: u32 = ${SNAPSHOT_WORD_COUNT}u;
const LOCAL_CANDIDATE_COUNT: u32 = ${SAFE_PLACEMENT_CANDIDATE_COUNT}u;
const EXPANDING_SLOT_COUNT: u32 = ${EXPANDING_RING_SLOT_COUNT}u;
const TOTAL_CANDIDATE_COUNT: u32 =
    ${SAFE_PLACEMENT_TOTAL_CANDIDATE_COUNT}u;
const ADMISSION_ERROR_SDF: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.SDF_PLACEMENT}u;
const ADMISSION_ERROR_EXISTING: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.DYNAMIC_BODY_OVERLAP}u;
const ADMISSION_ERROR_SIBLING: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.SIBLING_BODY_OVERLAP}u;
const ADMISSION_ERROR_CELL: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.GRID_CELL_CAPACITY}u;
const ADMISSION_ERROR_GLOBAL: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.NO_VALID_GLOBAL_PLACEMENT}u;

const LOCAL_ROTATION_COS = array<f32, ${SAFE_PLACEMENT_CANDIDATE_COUNT}>(
    ${SAFE_PLACEMENT_ROTATION_COS_WGSL}
);
const LOCAL_ROTATION_SIN = array<f32, ${SAFE_PLACEMENT_CANDIDATE_COUNT}>(
    ${SAFE_PLACEMENT_ROTATION_SIN_WGSL}
);
const LOCAL_RADIUS_SUM_SCALE = array<f32,
    ${SAFE_PLACEMENT_CANDIDATE_COUNT}>(
    ${SAFE_PLACEMENT_RADIUS_SUM_SCALE_WGSL}
);
const LOCAL_SURFACE_GAP_SCALE = array<f32,
    ${SAFE_PLACEMENT_CANDIDATE_COUNT}>(
    ${SAFE_PLACEMENT_SURFACE_GAP_SCALE_WGSL}
);
const EXPANDING_DIRECTION_COS = array<f32, ${EXPANDING_RING_SLOT_COUNT}>(
    ${EXPANDING_DIRECTION_COS_WGSL}
);
const EXPANDING_DIRECTION_SIN = array<f32, ${EXPANDING_RING_SLOT_COUNT}>(
    ${EXPANDING_DIRECTION_SIN_WGSL}
);

struct EnemyPayloadCandidate {
    position: vec2f,
    direction: vec2f,
}

fn admission_header(field: u32) -> u32 {
    return admission_leases.values[field];
}

fn admission_lease_word(rank: u32, field: u32) -> u32 {
    return admission_leases.values[
        ADMISSION_HEADER_WORDS + rank * ADMISSION_LEASE_WORDS + field
    ];
}

fn admission_snapshot_word(rank: u32, field: u32) -> u32 {
    return admission_snapshots.values[
        admission_header(${H.SNAPSHOT_WORD_OFFSET}u)
            + rank * ADMISSION_SNAPSHOT_WORDS + field
    ];
}

fn admission_validation_index(rank: u32, field: u32) -> u32 {
    return ADMISSION_AGGREGATE_WORDS
        + rank * ADMISSION_VALIDATION_WORDS + field;
}

fn admission_validation_word(rank: u32, field: u32) -> u32 {
    return atomicLoad(&admission_output.values[
        admission_validation_index(rank, field)
    ]);
}

fn admission_store_validation(rank: u32, field: u32, value: u32) {
    atomicStore(&admission_output.values[
        admission_validation_index(rank, field)
    ], value);
}

fn admission_hash_word(hash: u32, word: u32) -> u32 {
    return (hash ^ word) * ADMISSION_FNV_PRIME;
}

fn admission_candidate_seed(rank: u32) -> u32 {
    var hash = admission_hash_word(
        ADMISSION_FNV_OFFSET,
        admission_header(${H.COMMAND_FINGERPRINT}u)
    );
    hash = admission_hash_word(
        hash,
        admission_header(${H.MODIFIER_SET_FINGERPRINT}u)
    );
    hash = admission_hash_word(
        hash,
        admission_lease_word(rank, ${R.SNAPSHOT_RANK}u)
    );
    hash = admission_hash_word(
        hash,
        admission_lease_word(rank, ${R.COPY_INDEX}u)
    );
    hash = admission_hash_word(hash, rank);
    hash = admission_hash_word(
        hash,
        admission_lease_word(rank, ${R.DESTINATION_SLOT}u)
    );
    hash = admission_hash_word(
        hash,
        admission_lease_word(rank, ${R.DESTINATION_ENTITY_ID}u)
    );
    return admission_hash_word(
        hash,
        admission_lease_word(rank, ${R.DESTINATION_INCARNATION}u)
    );
}

fn admission_normalized(value: vec2f) -> vec2f {
    let length_squared = dot(value, value);
    return select(vec2f(1.0, 0.0), value * inverseSqrt(length_squared),
        length_squared > 0.000000000001);
}

fn admission_read_sdf(column: i32, row: i32) -> f32 {
    let columns = i32(admission_header(${H.SDF_COLS}u));
    let rows = i32(admission_header(${H.SDF_ROWS}u));
    let x = clamp(column, 0, columns - 1);
    let y = clamp(row, 0, rows - 1);
    return admission_sdf.values[u32(y * columns + x)];
}

fn admission_sample_sdf(position: vec2f) -> f32 {
    let width = bitcast<f32>(admission_header(${H.WORLD_WIDTH}u));
    let height = bitcast<f32>(admission_header(${H.WORLD_HEIGHT}u));
    let columns = f32(admission_header(${H.SDF_COLS}u));
    let rows = f32(admission_header(${H.SDF_ROWS}u));
    let uv = clamp(position / vec2f(width, height), vec2f(0.0), vec2f(1.0));
    let coordinate = uv * vec2f(columns, rows) - vec2f(0.5);
    let base = vec2i(floor(coordinate));
    let fraction = fract(coordinate);
    let top = mix(
        admission_read_sdf(base.x, base.y),
        admission_read_sdf(base.x + 1, base.y),
        fraction.x
    );
    let bottom = mix(
        admission_read_sdf(base.x, base.y + 1),
        admission_read_sdf(base.x + 1, base.y + 1),
        fraction.x
    );
    return mix(top, bottom, fraction.y);
}

fn admission_static_valid(position: vec2f, radius: f32) -> bool {
    let width = bitcast<f32>(admission_header(${H.WORLD_WIDTH}u));
    let height = bitcast<f32>(admission_header(${H.WORLD_HEIGHT}u));
    if (!(position.x >= radius && position.y >= radius
        && position.x <= width - radius
        && position.y <= height - radius)) {
        return false;
    }
    return admission_header(${H.SDF_ENABLED}u) == 0u
        || admission_sample_sdf(position) >= radius;
}

fn spawn_admission_claim_is_committed(rank: u32) -> bool {
    return admission_validation_word(
            rank,
            ${V.CHOSEN_CANDIDATE_INDEX}u
        ) != ADMISSION_INVALID
        && admission_validation_word(rank, ${V.ERROR_FLAGS}u) == 0u;
}

fn spawn_admission_claim_position(rank: u32) -> vec2f {
    return vec2f(
        bitcast<f32>(admission_validation_word(rank, ${V.POSITION_X}u)),
        bitcast<f32>(admission_validation_word(rank, ${V.POSITION_Y}u))
    );
}

fn spawn_admission_claim_radius(rank: u32) -> f32 {
    let slot = admission_lease_word(rank, ${R.DESTINATION_SLOT}u);
    return admission_physics.values[slot].radius;
}

${GPU_SPAWN_ADMISSION_SHARED_WGSL}

fn enemy_payload_candidate(
    rank: u32,
    candidate_index: u32,
    destination_radius: f32,
    authored_direction: vec2f
) -> EnemyPayloadCandidate {
    let source_rank = admission_lease_word(rank, ${R.SNAPSHOT_RANK}u);
    let source_position = vec2f(
        bitcast<f32>(admission_snapshot_word(source_rank, ${S.POSITION_X}u)),
        bitcast<f32>(admission_snapshot_word(source_rank, ${S.POSITION_Y}u))
    );
    let source_radius = bitcast<f32>(
        admission_snapshot_word(source_rank, ${S.RADIUS}u)
    );
    let surface_gap = bitcast<f32>(
        admission_header(${H.SURFACE_GAP}u)
    );
    if (candidate_index < LOCAL_CANDIDATE_COUNT) {
        let cosine = LOCAL_ROTATION_COS[candidate_index];
        let sine = LOCAL_ROTATION_SIN[candidate_index];
        let direction = admission_normalized(vec2f(
            authored_direction.x * cosine - authored_direction.y * sine,
            authored_direction.x * sine + authored_direction.y * cosine
        ));
        let distance = (source_radius + destination_radius)
                * LOCAL_RADIUS_SUM_SCALE[candidate_index]
            + surface_gap * LOCAL_SURFACE_GAP_SCALE[candidate_index];
        return EnemyPayloadCandidate(
            source_position + direction * distance,
            direction
        );
    }
    let expanded = candidate_index - LOCAL_CANDIDATE_COUNT;
    let ring = expanded / EXPANDING_SLOT_COUNT + 1u;
    let slot = expanded % EXPANDING_SLOT_COUNT;
    let cosine = EXPANDING_DIRECTION_COS[slot];
    let sine = EXPANDING_DIRECTION_SIN[slot];
    let direction = admission_normalized(vec2f(
        authored_direction.x * cosine - authored_direction.y * sine,
        authored_direction.x * sine + authored_direction.y * cosine
    ));
    let base_distance = source_radius + destination_radius + surface_gap;
    let ring_step = max(
        destination_radius * ${wgslFloat32(EXPANDING_RING_STEP_RADIUS_SCALE)},
        destination_radius + surface_gap
    );
    return EnemyPayloadCandidate(
        source_position + direction
            * (base_distance + f32(ring) * ring_step),
        direction
    );
}

@compute @workgroup_size(1)
fn admit_actor_payload_spawns() {
    if (atomicLoad(&admission_output.values[${A.STATUS}u])
            != ${ACTOR_PAYLOAD_MATERIALIZATION_STATUS.PENDING}u) {
        return;
    }
    let destination_count = admission_header(${H.DESTINATION_COUNT}u);
    for (var rank = 0u; rank < destination_count; rank += 1u) {
        var errors = admission_validation_word(rank, ${V.ERROR_FLAGS}u);
        if (errors != 0u) {
            continue;
        }
        let destination_slot = admission_lease_word(
            rank,
            ${R.DESTINATION_SLOT}u
        );
        let destination_radius = admission_physics.values[
            destination_slot
        ].radius;
        let authored_direction = admission_normalized(vec2f(
            bitcast<f32>(admission_validation_word(rank, ${V.DIRECTION_X}u)),
            bitcast<f32>(admission_validation_word(rank, ${V.DIRECTION_Y}u))
        ));
        var chosen = ADMISSION_INVALID;
        var attempted = 0u;
        var rejection_class = 0u;
        var selected = EnemyPayloadCandidate(vec2f(0.0), authored_direction);
        let candidate_offset = select(
            0u,
            admission_candidate_seed(rank) % TOTAL_CANDIDATE_COUNT,
            admission_header(${H.COPIES_PER_SUBJECT}u) > 1u
        );
        for (var candidate_attempt = 0u;
            candidate_attempt < TOTAL_CANDIDATE_COUNT;
            candidate_attempt += 1u) {
            let candidate_index = (candidate_attempt + candidate_offset)
                % TOTAL_CANDIDATE_COUNT;
            attempted += 1u;
            let candidate = enemy_payload_candidate(
                rank,
                candidate_index,
                destination_radius,
                authored_direction
            );
            let verdict = spawn_admission_claim(
                admission_static_valid(candidate.position, destination_radius),
                candidate.position,
                destination_radius,
                destination_slot,
                rank
            );
            rejection_class |= verdict.rejection_class;
            if (verdict.accepted != 0u) {
                chosen = candidate_index;
                selected = candidate;
                break;
            }
        }
        if (chosen == ADMISSION_INVALID) {
            errors |= ADMISSION_ERROR_SDF | ADMISSION_ERROR_GLOBAL;
            if ((rejection_class & 2u) != 0u) {
                errors |= ADMISSION_ERROR_EXISTING;
            }
            if ((rejection_class & 4u) != 0u) {
                errors |= ADMISSION_ERROR_SIBLING;
            }
            if ((rejection_class & 8u) != 0u) {
                errors |= ADMISSION_ERROR_CELL;
            }
        } else {
            admission_store_validation(
                rank,
                ${V.POSITION_X}u,
                bitcast<u32>(selected.position.x)
            );
            admission_store_validation(
                rank,
                ${V.POSITION_Y}u,
                bitcast<u32>(selected.position.y)
            );
            admission_store_validation(
                rank,
                ${V.DIRECTION_X}u,
                bitcast<u32>(selected.direction.x)
            );
            admission_store_validation(
                rank,
                ${V.DIRECTION_Y}u,
                bitcast<u32>(selected.direction.y)
            );
            rejection_class = 0u;
        }
        admission_store_validation(
            rank,
            ${V.CHOSEN_CANDIDATE_INDEX}u,
            chosen
        );
        admission_store_validation(
            rank,
            ${V.ATTEMPTED_CANDIDATE_COUNT}u,
            attempted
        );
        admission_store_validation(
            rank,
            ${V.PLACEMENT_FAILURE_CLASS}u,
            rejection_class
        );
        admission_store_validation(rank, ${V.ERROR_FLAGS}u, errors);
    }
}
`;

export const GPU_ACTOR_PAYLOAD_TOWER_TARGET_QUERY_WGSL = /* wgsl */`
struct QueryBodyPhysics {
    position: vec2f,
    velocity: vec2f,
    radius: f32,
    inverse_mass: f32,
    physical_meta: u32,
    interaction_meta: u32,
}

struct QueryBodySimulation {
    lifetime: f32,
    health: i32,
    gameplay_meta: u32,
    flags: u32,
    flow_field_index: u32,
    flow_speed: f32,
    entity_id: u32,
    incarnation: u32,
}

struct QueryAbilityMetadata {
    abi_version: u32,
    noun_mask: u32,
    definition_code: u32,
    owner_entity_id: u32,
    owner_incarnation: u32,
    source_ability_code: u32,
    source_execution_fingerprint: u32,
    source_execution_ordinal: u32,
    generation: u32,
    visible_from_execution_ordinal: u32,
    creation_origin_code: u32,
    power_fixed_point: u32,
}

struct QueryTowerMember {
    entity_id: u32,
    incarnation: u32,
    logical_ordinal: u32,
    share_units: u32,
    max_hp_fixed_point: u32,
    power_fixed_point: u32,
    group_revision: u32,
    flags: u32,
    roster_rank: u32,
    reserved: u32,
}

struct QueryTowerRoster {
    abi_version: u32,
    member_count: u32,
    capacity: u32,
    fingerprint: u32,
    group_revision: u32,
    session_generation: u32,
    device_generation: u32,
    authoritative_epoch: u32,
    slots: array<u32>,
}

struct QueryRawReadBuffer { values: array<u32> }
struct QueryRawAtomicBuffer { values: array<atomic<u32>> }
struct QueryPhysicsBuffer { values: array<QueryBodyPhysics> }
struct QuerySimulationBuffer { values: array<QueryBodySimulation> }
struct QueryAbilityMetadataBuffer { values: array<QueryAbilityMetadata> }
struct QueryTowerMemberBuffer { values: array<QueryTowerMember> }

@group(0) @binding(0) var<storage, read> query_snapshots: QueryRawReadBuffer;
@group(0) @binding(1) var<storage, read> query_leases: QueryRawReadBuffer;
@group(0) @binding(2) var<storage, read> query_physics: QueryPhysicsBuffer;
@group(0) @binding(3) var<storage, read> query_simulations: QuerySimulationBuffer;
@group(0) @binding(4) var<storage, read> query_metadata: QueryAbilityMetadataBuffer;
@group(0) @binding(5) var<storage, read> query_members: QueryTowerMemberBuffer;
@group(0) @binding(6) var<storage, read> query_roster: QueryTowerRoster;
@group(0) @binding(7) var<storage, read_write> query_aggregate: QueryRawAtomicBuffer;

const QUERY_HEADER_WORDS: u32 = ${HEADER_WORD_COUNT}u;
const QUERY_LEASE_WORDS: u32 = ${LEASE_WORD_COUNT}u;
const QUERY_SNAPSHOT_WORDS: u32 = ${SNAPSHOT_WORD_COUNT}u;
const QUERY_AGGREGATE_WORDS: u32 = ${AGGREGATE_WORD_COUNT}u;
const QUERY_VALIDATION_WORDS: u32 = ${VALIDATION_WORD_COUNT}u;
const QUERY_INVALID: u32 = ${GPU_TOWER_GROUP_INVALID_COMPONENT}u;
const QUERY_BODY_ALIVE: u32 = ${GPU_CIRCLE_BODY_META.ALIVE_BIT}u;
const QUERY_TEAM_SHIFT: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_SHIFT}u;
const QUERY_TEAM_MASK: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_MASK}u;
const QUERY_PLAYER_TEAM: u32 = ${GAMEPLAY_TEAM_ID.PLAYER}u;
const QUERY_NEUTRAL_TEAM: u32 = ${GAMEPLAY_TEAM_ID.NEUTRAL}u;
const QUERY_TOWER_SELECTOR: u32 = ${SUBJECT_SELECTOR_CODE.TOWER}u;
const QUERY_TOWER_NOUN: u32 = ${GAMEPLAY_NOUN_MASK.TOWER}u;
const QUERY_METADATA_ABI: u32 = ${ABILITY_ENTITY_METADATA_ABI_VERSION}u;
const QUERY_GROUP_ABI: u32 = ${GPU_TOWER_GROUP_ABI_VERSION}u;
const QUERY_TOWER_FLAG: u32 = ${GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN}u;
const QUERY_LIVING_FLAG: u32 = ${GPU_TOWER_GROUP_MEMBER_FLAG.LIVING}u;
const QUERY_PLAYER_DAMAGEABLE_LAYER: u32 = ${GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE}u;

fn query_header(field: u32) -> u32 {
    return query_leases.values[field];
}

fn query_lease_word(rank: u32, field: u32) -> u32 {
    return query_leases.values[
        QUERY_HEADER_WORDS + rank * QUERY_LEASE_WORDS + field
    ];
}

fn query_snapshot_word(rank: u32, field: u32) -> u32 {
    return query_snapshots.values[
        query_header(${H.SNAPSHOT_WORD_OFFSET}u)
            + rank * QUERY_SNAPSHOT_WORDS + field
    ];
}

fn query_store_validation(rank: u32, field: u32, value: u32) {
    atomicStore(
        &query_aggregate.values[
            QUERY_AGGREGATE_WORDS + rank * QUERY_VALIDATION_WORDS + field
        ],
        value
    );
}

fn query_normalized_or_fallback(value: vec2f, fallback: vec2f) -> vec2f {
    let value_squared = dot(value, value);
    if (value_squared > 0.000001) {
        return value * inverseSqrt(value_squared);
    }
    let fallback_squared = dot(fallback, fallback);
    if (fallback_squared > 0.000001) {
        return fallback * inverseSqrt(fallback_squared);
    }
    return vec2f(1.0, 0.0);
}

fn query_source_position(rank: u32) -> vec2f {
    return vec2f(
        bitcast<f32>(query_snapshot_word(rank, ${S.POSITION_X}u)),
        bitcast<f32>(query_snapshot_word(rank, ${S.POSITION_Y}u))
    );
}

fn query_source_facing(rank: u32) -> vec2f {
    return query_normalized_or_fallback(vec2f(
        bitcast<f32>(query_snapshot_word(rank, ${S.FACING_X}u)),
        bitcast<f32>(query_snapshot_word(rank, ${S.FACING_Y}u))
    ), vec2f(1.0, 0.0));
}

fn query_body_team(slot: u32) -> u32 {
    return (query_simulations.values[slot].gameplay_meta
        >> QUERY_TEAM_SHIFT) & QUERY_TEAM_MASK;
}

fn query_exact_target(
    slot: u32,
    entity_id: u32,
    incarnation: u32,
    team_id: u32,
    noun_mask: u32
) -> bool {
    return slot < arrayLength(&query_simulations.values)
        && slot < arrayLength(&query_physics.values)
        && slot < arrayLength(&query_metadata.values)
        && entity_id != 0u && entity_id != QUERY_INVALID
        && incarnation != 0u && incarnation != QUERY_INVALID
        && (query_simulations.values[slot].flags & QUERY_BODY_ALIVE) != 0u
        && query_body_team(slot) == team_id
        && query_simulations.values[slot].entity_id == entity_id
        && query_simulations.values[slot].incarnation == incarnation
        && (noun_mask == 0u
            || (query_metadata.values[slot].abi_version == QUERY_METADATA_ABI
                && (query_metadata.values[slot].noun_mask & noun_mask)
                    == noun_mask));
}

fn query_member_matches(slot: u32, member: QueryTowerMember) -> bool {
    return slot < arrayLength(&query_simulations.values)
        && slot < arrayLength(&query_physics.values)
        && slot < arrayLength(&query_metadata.values)
        && member.group_revision == query_roster.group_revision
        && (member.flags & QUERY_TOWER_FLAG) != 0u
        && (member.flags & QUERY_LIVING_FLAG) != 0u
        && query_exact_target(
            slot,
            member.entity_id,
            member.incarnation,
            QUERY_PLAYER_TEAM,
            QUERY_TOWER_NOUN
        )
        && (query_physics.values[slot].interaction_meta & 0xffffu)
            == QUERY_PLAYER_DAMAGEABLE_LAYER;
}

fn query_identity_less(
    entity_id: u32,
    incarnation: u32,
    selected_entity_id: u32,
    selected_incarnation: u32
) -> bool {
    return entity_id < selected_entity_id
        || (entity_id == selected_entity_id
            && incarnation < selected_incarnation);
}

@compute @workgroup_size(${GPU_ACTOR_PAYLOAD_MATERIALIZATION_WORKGROUP_SIZE})
fn query_actor_payload_tower_target(
    @builtin(global_invocation_id) invocation: vec3u
) {
    let rank = invocation.x;
    if (rank >= query_header(${H.DESTINATION_COUNT}u)) { return; }
    for (var word = 0u; word < QUERY_VALIDATION_WORDS; word++) {
        query_store_validation(rank, word, 0u);
    }
    let source_rank = query_lease_word(rank, ${R.SNAPSHOT_RANK}u);
    let position = query_source_position(source_rank);
    let facing = query_source_facing(source_rank);
    var direction = facing;
    if (query_header(${H.SOURCE_SELECTOR_CODE}u) == QUERY_TOWER_SELECTOR) {
        let aim = vec2f(
            bitcast<f32>(query_header(${H.AIM_POINT_X}u)),
            bitcast<f32>(query_header(${H.AIM_POINT_Y}u))
        );
        direction = query_normalized_or_fallback(aim - position, facing);
    } else {
        let roster_valid = query_roster.abi_version == QUERY_GROUP_ABI
            && query_roster.capacity == arrayLength(&query_members.values)
            && query_roster.capacity == arrayLength(&query_roster.slots)
            && query_roster.member_count <= query_roster.capacity
            && query_roster.group_revision != 0u
            && query_roster.fingerprint != 0u;
        var found = false;
        var selected_slot = QUERY_INVALID;
        var selected_entity_id = QUERY_INVALID;
        var selected_incarnation = QUERY_INVALID;
        var selected_share = 0u;
        var selected_distance_squared = 3.402823466e+38;
        if (roster_valid) {
            var roster_rank = 0u;
            loop {
                if (roster_rank >= query_roster.member_count) { break; }
                let slot = query_roster.slots[roster_rank];
                if (slot < arrayLength(&query_members.values)) {
                    let member = query_members.values[slot];
                    if (member.roster_rank == roster_rank
                        && query_member_matches(slot, member)) {
                        let delta = query_physics.values[slot].position - position;
                        let distance_squared = dot(delta, delta);
                        let better_identity = query_identity_less(
                            member.entity_id,
                            member.incarnation,
                            selected_entity_id,
                            selected_incarnation
                        );
                        let better = distance_squared
                                < selected_distance_squared
                            || (distance_squared == selected_distance_squared
                                && (member.share_units > selected_share
                                    || (member.share_units == selected_share
                                        && better_identity)));
                        if (!found || better) {
                            found = true;
                            selected_slot = slot;
                            selected_entity_id = member.entity_id;
                            selected_incarnation = member.incarnation;
                            selected_share = member.share_units;
                            selected_distance_squared = distance_squared;
                        }
                    }
                }
                roster_rank += 1u;
            }
        } else {
            let exact_slot = query_header(${H.TOWER_SLOT}u);
            if (query_exact_target(
                exact_slot,
                query_header(${H.TOWER_ENTITY_ID}u),
                query_header(${H.TOWER_INCARNATION}u),
                QUERY_PLAYER_TEAM,
                QUERY_TOWER_NOUN
            )) {
                found = true;
                selected_slot = exact_slot;
            }
        }
        if (found) {
            direction = query_normalized_or_fallback(
                query_physics.values[selected_slot].position - position,
                facing
            );
        } else {
            let core_slot = query_header(${H.CORE_SLOT}u);
            if (query_exact_target(
                core_slot,
                query_header(${H.CORE_ENTITY_ID}u),
                query_header(${H.CORE_INCARNATION}u),
                QUERY_NEUTRAL_TEAM,
                0u
            )) {
                direction = query_normalized_or_fallback(
                    query_physics.values[core_slot].position - position,
                    facing
                );
            }
        }
    }
    query_store_validation(
        rank,
        ${V.DIRECTION_X}u,
        bitcast<u32>(direction.x)
    );
    query_store_validation(
        rank,
        ${V.DIRECTION_Y}u,
        bitcast<u32>(direction.y)
    );
}
`;

const ACTOR_ACTION_PLACEMENT_AGGREGATE_WORDS
    = GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.STRIDE / 4;
const ACTOR_ACTION_PLACEMENT_RECORD_WORDS
    = GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.STRIDE / 4;
const ACTOR_ACTION_PLACEMENT_TRANSIT_WORDS
    = GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.STRIDE / 4;
const ACTOR_TRANSIT_RECORD_WORDS = GPU_ACTOR_TRANSIT_ABI.RECORD.STRIDE / 4;
const ACTOR_ACTION_ALL_TRANSIT_FLAGS = Object.values(
    GPU_ACTOR_ACTION_TRANSIT_FLAG
).reduce((mask, value) => mask | value, 0);

export const GPU_ACTOR_ACTION_ENEMY_MATERIALIZATION_WGSL = /* wgsl */`
struct ActorBodyPhysics {
    position: vec2f,
    velocity: vec2f,
    radius: f32,
    inverse_mass: f32,
    physical_meta: u32,
    interaction_meta: u32,
}

struct ActorBodySimulation {
    lifetime: f32,
    health: atomic<i32>,
    gameplay_meta: u32,
    flags: atomic<u32>,
    flow_field_index: u32,
    flow_speed: f32,
    entity_id: u32,
    incarnation: u32,
}

struct ActorAbilityMetadata {
    abi_version: u32,
    noun_mask: u32,
    definition_code: u32,
    owner_entity_id: u32,
    owner_incarnation: u32,
    source_ability_code: u32,
    source_execution_fingerprint: u32,
    source_execution_ordinal: u32,
    generation: u32,
    visible_from_execution_ordinal: u32,
    creation_origin_code: u32,
    power_fixed_point: u32,
}

struct ActorRouteRuntimeState {
    route_meta: u32,
    self_entity_id: u32,
    self_incarnation: u32,
    current_path_index: u32,
    route_set_index: u32,
    closure_index: u32,
    observed_availability_version: u32,
    phase_entered_fixed_tick: u32,
    travel_radius: f32,
    blocker_radius: f32,
    expansion_duration_fixed_ticks: u32,
    pending_field_index: u32,
    lease_generation: u32,
    profile_code: u32,
    reserved_0: u32,
    reserved_1: u32,
}

struct ActorRawReadBuffer { values: array<u32> }
struct ActorRawWriteBuffer { values: array<u32> }
struct ActorRawAtomicBuffer { values: array<atomic<u32>> }
struct ActorPhysicsBuffer { values: array<ActorBodyPhysics> }
struct ActorSimulationBuffer { values: array<ActorBodySimulation> }
struct ActorMetadataBuffer { values: array<ActorAbilityMetadata> }
struct ActorRouteBuffer { values: array<ActorRouteRuntimeState> }

@group(0) @binding(0) var<storage, read> actor_snapshots: ActorRawReadBuffer;
@group(0) @binding(1) var<storage, read> actor_leases: ActorRawReadBuffer;
@group(0) @binding(2) var<storage, read> actor_placement: ActorRawReadBuffer;
@group(0) @binding(3) var<storage, read_write> actor_physics: ActorPhysicsBuffer;
@group(0) @binding(4) var<storage, read_write> actor_simulations: ActorSimulationBuffer;
@group(0) @binding(5) var<storage, read_write> actor_metadata: ActorMetadataBuffer;
@group(0) @binding(6) var<storage, read_write> actor_routes: ActorRouteBuffer;
@group(0) @binding(7) var<storage, read_write> actor_transits: ActorRawWriteBuffer;
@group(0) @binding(8) var<storage, read_write> actor_aggregate: ActorRawAtomicBuffer;

const ACTOR_MATERIALIZER_ABI: u32 = ${GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI_VERSION}u;
const ACTOR_PLACEMENT_ABI: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION}u;
const ACTOR_TRANSIT_ABI: u32 = ${GPU_ACTOR_TRANSIT_ABI_VERSION}u;
const ACTOR_BODY_ABI: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;
const ACTOR_METADATA_ABI: u32 = ${ABILITY_ENTITY_METADATA_ABI_VERSION}u;
const ACTOR_HEADER_WORDS: u32 = ${HEADER_WORD_COUNT}u;
const ACTOR_LEASE_WORDS: u32 = ${LEASE_WORD_COUNT}u;
const ACTOR_SNAPSHOT_WORDS: u32 = ${SNAPSHOT_WORD_COUNT}u;
const ACTOR_AGGREGATE_WORDS: u32 = ${AGGREGATE_WORD_COUNT}u;
const ACTOR_VALIDATION_WORDS: u32 = ${VALIDATION_WORD_COUNT}u;
const PLACEMENT_AGGREGATE_WORDS: u32 = ${ACTOR_ACTION_PLACEMENT_AGGREGATE_WORDS}u;
const PLACEMENT_RECORD_WORDS: u32 = ${ACTOR_ACTION_PLACEMENT_RECORD_WORDS}u;
const PLACEMENT_TRANSIT_WORDS: u32 = ${ACTOR_ACTION_PLACEMENT_TRANSIT_WORDS}u;
const TRANSIT_RECORD_WORDS: u32 = ${ACTOR_TRANSIT_RECORD_WORDS}u;
const ACTOR_INVALID: u32 = 0xffffffffu;
const ACTOR_FNV_OFFSET: u32 = ${FNV_OFFSET}u;
const ACTOR_FNV_PRIME: u32 = ${FNV_PRIME}u;
const ACTOR_ALIVE: u32 = ${GPU_CIRCLE_BODY_META.ALIVE_BIT}u;
const ACTOR_CONTROLLED: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.CONTROLLED_THIS_TICK}u;
const ACTOR_EXTERNAL_MOTION: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.EXTERNAL_MOTION_OWNER_THIS_TICK}u;
const ACTOR_TEAM_SHIFT: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_SHIFT}u;
const ACTOR_TEAM_MASK: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_MASK}u;
const ACTOR_HOSTILE_TEAM: u32 = ${GAMEPLAY_TEAM_ID.HOSTILE}u;
const ACTOR_ENEMY_NOUN: u32 = ${GAMEPLAY_NOUN_MASK.ENEMY}u;
const ACTOR_THROW: u32 = ${SENTENCE_ACTION_CODE.THROW}u;
const ACTOR_EMIT: u32 = ${SENTENCE_ACTION_CODE.EMIT}u;
const ACTOR_SUMMON: u32 = ${SENTENCE_ACTION_CODE.SUMMON}u;
const ACTOR_ENEMY_PAYLOAD: u32 = ${ACTOR_PAYLOAD_CODE.ENEMY}u;
const ACTOR_STATUS_PENDING: u32 = ${ACTOR_PAYLOAD_MATERIALIZATION_STATUS.PENDING}u;
const ACTOR_STATUS_COMPLETE: u32 = ${ACTOR_PAYLOAD_MATERIALIZATION_STATUS.COMPLETE}u;
const ACTOR_STATUS_PROTOCOL: u32 = ${ACTOR_PAYLOAD_MATERIALIZATION_STATUS.PROTOCOL_REJECTED}u;
const PLACEMENT_COMPLETE: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_STATUS.COMPLETE}u;
const PLACEMENT_RECORD_VALID: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS.VALID}u;
const PLACEMENT_TRANSIT_PENDING: u32 = ${GPU_ACTOR_ACTION_TRANSIT_PHASE.ACTIVATION_PENDING}u;
const PLACEMENT_TRANSIT_AIRBORNE: u32 = ${GPU_ACTOR_ACTION_TRANSIT_PHASE.AIRBORNE}u;
const PERSISTENT_TRANSIT_AIRBORNE: u32 = ${GPU_ACTOR_TRANSIT_PHASE.AIRBORNE}u;
const REQUIRED_TRANSIT_FLAGS: u32 = ${ACTOR_ACTION_ALL_TRANSIT_FLAGS}u;
const ACTOR_ERROR_BODY_ABI: u32 = ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.BODY_ABI}u;
const ACTOR_ERROR_DESTINATION: u32 = ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.DESTINATION_IDENTITY}u;
const ACTOR_ERROR_SOURCE: u32 = ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.SOURCE_RECORD}u;
const ACTOR_ERROR_GENERATION: u32 = ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.GENERATION}u;
const ACTOR_ERROR_STALE: u32 = ${ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.STALE_PROTOCOL}u;

fn actor_header(field: u32) -> u32 {
    return actor_leases.values[field];
}

fn actor_lease(rank: u32, field: u32) -> u32 {
    return actor_leases.values[ACTOR_HEADER_WORDS + rank * ACTOR_LEASE_WORDS + field];
}

fn actor_snapshot(rank: u32, field: u32) -> u32 {
    return actor_snapshots.values[
        actor_header(${H.SNAPSHOT_WORD_OFFSET}u) + rank * ACTOR_SNAPSHOT_WORDS + field
    ];
}

fn actor_store_aggregate(field: u32, value: u32) {
    atomicStore(&actor_aggregate.values[field], value);
}

fn actor_store_validation(rank: u32, field: u32, value: u32) {
    atomicStore(&actor_aggregate.values[
        ACTOR_AGGREGATE_WORDS + rank * ACTOR_VALIDATION_WORDS + field
    ], value);
}

fn actor_validation(rank: u32, field: u32) -> u32 {
    return atomicLoad(&actor_aggregate.values[
        ACTOR_AGGREGATE_WORDS + rank * ACTOR_VALIDATION_WORDS + field
    ]);
}

fn placement_word(rank: u32, field: u32) -> u32 {
    return actor_placement.values[
        PLACEMENT_AGGREGATE_WORDS + rank * PLACEMENT_RECORD_WORDS + field
    ];
}

fn placement_transit_word(rank: u32, field: u32) -> u32 {
    return actor_placement.values[
        PLACEMENT_AGGREGATE_WORDS
            + actor_header(${H.DESTINATION_COUNT}u) * PLACEMENT_RECORD_WORDS
            + rank * PLACEMENT_TRANSIT_WORDS + field
    ];
}

fn transit_base(slot: u32) -> u32 {
    return slot * TRANSIT_RECORD_WORDS;
}

fn transit_word(slot: u32, field: u32) -> u32 {
    return actor_transits.values[transit_base(slot) + field];
}

fn set_transit_word(slot: u32, field: u32, value: u32) {
    actor_transits.values[transit_base(slot) + field] = value;
}

fn actor_hash_word(hash: u32, word: u32) -> u32 {
    return (hash ^ word) * ACTOR_FNV_PRIME;
}

fn actor_nonzero_hash(hash: u32) -> u32 {
    return select(hash, ACTOR_FNV_OFFSET, hash == 0u);
}

fn transit_record_fingerprint(slot: u32) -> u32 {
    var hash = actor_hash_word(ACTOR_FNV_OFFSET,
        transit_word(slot, ${TR.ABI_VERSION}u));
    for (var field = ${TR.FLAGS}u; field <= ${TR.DURATION_FIXED_TICKS}u;
        field += 1u) {
        hash = actor_hash_word(hash, transit_word(slot, field));
    }
    for (var field = ${TR.START_X}u;
        field <= ${TR.PRESENTATION_ARC_HEIGHT}u; field += 1u) {
        hash = actor_hash_word(hash, transit_word(slot, field));
    }
    for (var field = ${TR.BASELINE_PHYSICAL_META}u;
        field <= ${TR.BASELINE_VELOCITY_Y}u; field += 1u) {
        hash = actor_hash_word(hash, transit_word(slot, field));
    }
    hash = actor_hash_word(hash, transit_word(slot, ${TR.SOURCE_RANK}u));
    return actor_nonzero_hash(hash);
}

fn actor_body_team(slot: u32) -> u32 {
    return (actor_simulations.values[slot].gameplay_meta
        >> ACTOR_TEAM_SHIFT) & ACTOR_TEAM_MASK;
}

fn actor_finite(value: f32) -> bool {
    return value == value && abs(value) <= 3.402823466e+38;
}

fn actor_u32_multiplication_overflows(left: u32, right: u32) -> bool {
    let left_low = left & 0xffffu;
    let left_high = left >> 16u;
    let right_low = right & 0xffffu;
    let right_high = right >> 16u;
    if (left_high * right_high != 0u) { return true; }
    let cross_left = left_high * right_low;
    let cross_right = left_low * right_high;
    if (cross_left > 0xffffu || cross_right > 0xffffu) { return true; }
    let low_carry = (left_low * right_low) >> 16u;
    return cross_left + cross_right + low_carry > 0xffffu;
}

@compute @workgroup_size(1)
fn initialize_actor_action_enemy_payload() {
    for (var word = 0u; word < ACTOR_AGGREGATE_WORDS; word += 1u) {
        actor_store_aggregate(word, 0u);
    }
    actor_store_aggregate(${A.ABI_VERSION}u, ACTOR_MATERIALIZER_ABI);
    actor_store_aggregate(${A.BODY_ABI_VERSION}u, ACTOR_BODY_ABI);
    actor_store_aggregate(${A.SESSION_GENERATION}u,
        actor_header(${H.SESSION_GENERATION}u));
    actor_store_aggregate(${A.DEVICE_GENERATION}u,
        actor_header(${H.DEVICE_GENERATION}u));
    actor_store_aggregate(${A.AUTHORITATIVE_EPOCH}u,
        actor_header(${H.AUTHORITATIVE_EPOCH}u));
    actor_store_aggregate(${A.SNAPSHOT_SOURCE_TICK}u,
        actor_header(${H.SNAPSHOT_SOURCE_TICK}u));
    actor_store_aggregate(${A.MATERIALIZATION_TARGET_TICK}u,
        actor_header(${H.MATERIALIZATION_TARGET_TICK}u));
    actor_store_aggregate(${A.EXECUTION_ORDINAL}u,
        actor_header(${H.EXECUTION_ORDINAL}u));
    actor_store_aggregate(${A.STATUS}u, ACTOR_STATUS_PENDING);
    actor_store_aggregate(${A.SUBJECT_COUNT}u,
        actor_header(${H.SUBJECT_COUNT}u));
    actor_store_aggregate(${A.DESTINATION_COUNT}u,
        actor_header(${H.DESTINATION_COUNT}u));
    actor_store_aggregate(${A.COMMAND_FINGERPRINT}u,
        actor_header(${H.COMMAND_FINGERPRINT}u));
    actor_store_aggregate(${A.SNAPSHOT_FINGERPRINT}u,
        actor_header(${H.SNAPSHOT_FINGERPRINT}u));
    actor_store_aggregate(${A.ACTOR_ACTION_PROFILE_FINGERPRINT}u,
        actor_header(${H.ACTOR_ACTION_PROFILE_FINGERPRINT}u));
    actor_store_aggregate(${A.PLACEMENT_FINGERPRINT}u,
        actor_header(${H.PLACEMENT_FINGERPRINT}u));
    actor_store_aggregate(${A.PLACEMENT_TELEMETRY}u,
        ${GPU_ACTOR_PAYLOAD_PLACEMENT_TELEMETRY.RANK_NONE}u);
    actor_store_aggregate(${A.COPIES_PER_SUBJECT}u,
        actor_header(${H.COPIES_PER_SUBJECT}u));
    actor_store_aggregate(${A.MODIFIER_SET_FINGERPRINT}u,
        actor_header(${H.MODIFIER_SET_FINGERPRINT}u));
    let subject_count = actor_header(${H.SUBJECT_COUNT}u);
    let destination_count = actor_header(${H.DESTINATION_COUNT}u);
    let copies_per_subject = actor_header(${H.COPIES_PER_SUBJECT}u);
    let placement_exact = actor_placement.values[${AA.ABI_VERSION}u]
            == ACTOR_PLACEMENT_ABI
        && actor_placement.values[${AA.STATUS}u] == PLACEMENT_COMPLETE
        && actor_placement.values[${AA.SUBJECT_COUNT}u] == subject_count
        && actor_placement.values[${AA.DESTINATION_COUNT}u]
            == destination_count
        && actor_placement.values[${AA.VALID_COUNT}u] == destination_count
        && actor_placement.values[${AA.COPIES_PER_SUBJECT}u]
            == copies_per_subject
        && actor_placement.values[${AA.MODIFIER_SET_FINGERPRINT}u]
            == actor_header(${H.MODIFIER_SET_FINGERPRINT}u)
        && actor_placement.values[${AA.ERROR_FLAGS}u] == 0u
        && actor_placement.values[${AA.EXECUTION_ORDINAL}u]
            == actor_header(${H.EXECUTION_ORDINAL}u)
        && actor_placement.values[${AA.COMMAND_FINGERPRINT}u]
            == actor_header(${H.COMMAND_FINGERPRINT}u)
        && actor_placement.values[${AA.SNAPSHOT_FINGERPRINT}u]
            == actor_header(${H.SNAPSHOT_FINGERPRINT}u)
        && actor_placement.values[${AA.PLACEMENT_FINGERPRINT}u]
            == actor_header(${H.PLACEMENT_FINGERPRINT}u)
        && actor_placement.values[${AA.PROFILE_FINGERPRINT}u]
            == actor_header(${H.ACTOR_ACTION_PROFILE_FINGERPRINT}u)
        && actor_placement.values[${AA.ACTION_CODE}u]
            == actor_header(${H.ACTION_CODE}u)
        && actor_placement.values[${AA.PAYLOAD_CODE}u] == ACTOR_ENEMY_PAYLOAD;
    let action = actor_header(${H.ACTION_CODE}u);
    let placement_action = action == ACTOR_THROW
        || action == ACTOR_EMIT || action == ACTOR_SUMMON;
    if (actor_header(${H.ABI_VERSION}u) != ACTOR_MATERIALIZER_ABI
        || actor_header(${H.BODY_ABI_VERSION}u) != ACTOR_BODY_ABI
        || subject_count == 0u
        || destination_count == 0u
        || copies_per_subject == 0u
        || actor_u32_multiplication_overflows(
            subject_count,
            copies_per_subject
        )
        || subject_count * copies_per_subject != destination_count
        || !placement_action
        || actor_header(${H.PAYLOAD_CODE}u) != ACTOR_ENEMY_PAYLOAD
        || actor_header(${H.PAYLOAD_NOUN_MASK}u) != ACTOR_ENEMY_NOUN
        || actor_header(${H.PAYLOAD_TEAM_ID}u) != ACTOR_HOSTILE_TEAM
        || actor_header(${H.ACTOR_ACTION_PROFILE_FINGERPRINT}u) == 0u
        || actor_header(${H.PLACEMENT_FINGERPRINT}u) == 0u
        || !placement_exact) {
        actor_store_aggregate(${A.STATUS}u, ACTOR_STATUS_PROTOCOL);
        actor_store_aggregate(${A.ERROR_FLAGS}u,
            ACTOR_ERROR_STALE | ACTOR_ERROR_BODY_ABI);
    }
}

@compute @workgroup_size(${GPU_ACTOR_PAYLOAD_MATERIALIZATION_WORKGROUP_SIZE})
fn validate_actor_action_enemy_payload(
    @builtin(global_invocation_id) invocation: vec3u
) {
    let rank = invocation.x;
    let destination_count = actor_header(${H.DESTINATION_COUNT}u);
    if (rank >= destination_count
        || atomicLoad(&actor_aggregate.values[${A.STATUS}u])
        != ACTOR_STATUS_PENDING) { return; }
    for (var word = 0u; word < ACTOR_VALIDATION_WORDS; word += 1u) {
        actor_store_validation(rank, word, 0u);
    }
    var errors = 0u;
    let slot = actor_lease(rank, ${R.DESTINATION_SLOT}u);
    let source_rank = actor_lease(rank, ${R.SNAPSHOT_RANK}u);
    let copy_index = actor_lease(rank, ${R.COPY_INDEX}u);
    let copies_per_subject = actor_header(${H.COPIES_PER_SUBJECT}u);
    let entity_id = actor_lease(rank, ${R.DESTINATION_ENTITY_ID}u);
    let incarnation = actor_lease(rank, ${R.DESTINATION_INCARNATION}u);
    let slot_valid = slot < arrayLength(&actor_simulations.values)
        && slot < arrayLength(&actor_physics.values)
        && slot < arrayLength(&actor_metadata.values)
        && slot * TRANSIT_RECORD_WORDS < arrayLength(&actor_transits.values);
    if (source_rank != rank / copies_per_subject
        || copy_index != rank % copies_per_subject
        || !slot_valid || entity_id == 0u || entity_id == ACTOR_INVALID
        || incarnation == 0u || incarnation == ACTOR_INVALID) {
        errors |= ACTOR_ERROR_DESTINATION;
    }
    if (slot_valid
        && (actor_simulations.values[slot].entity_id != entity_id
            || actor_simulations.values[slot].incarnation != incarnation
            || (atomicLoad(&actor_simulations.values[slot].flags)
                & ACTOR_ALIVE) != 0u
            || actor_body_team(slot) != ACTOR_HOSTILE_TEAM)) {
        errors |= ACTOR_ERROR_DESTINATION;
    }
    let source_generation = actor_snapshot(source_rank, ${S.GENERATION}u);
    if (source_generation >= actor_header(${H.GENERATION_LIMIT}u)) {
        errors |= ACTOR_ERROR_GENERATION;
    }
    let duration = placement_word(rank, ${AP.TRANSIT_DURATION_FIXED_TICKS}u);
    let start = vec2f(
        bitcast<f32>(placement_word(rank, ${AP.SPAWN_X}u)),
        bitcast<f32>(placement_word(rank, ${AP.SPAWN_Y}u))
    );
    let landing = vec2f(
        bitcast<f32>(placement_transit_word(rank, ${AT.LANDING_X}u)),
        bitcast<f32>(placement_transit_word(rank, ${AT.LANDING_Y}u))
    );
    let velocity = vec2f(
        bitcast<f32>(placement_transit_word(rank, ${AT.VELOCITY_X}u)),
        bitcast<f32>(placement_transit_word(rank, ${AT.VELOCITY_Y}u))
    );
    let placement_velocity = vec2f(
        bitcast<f32>(placement_word(rank, ${AP.INITIAL_VELOCITY_X}u)),
        bitcast<f32>(placement_word(rank, ${AP.INITIAL_VELOCITY_Y}u))
    );
    let action = actor_header(${H.ACTION_CODE}u);
    let throw_action = action == ACTOR_THROW;
    let immediate_action = action == ACTOR_EMIT || action == ACTOR_SUMMON;
    let target_tick = actor_header(${H.MATERIALIZATION_TARGET_TICK}u);
    let activation_tick = placement_word(rank, ${AP.ACTIVATION_TICK}u);
    let safe_duration = select(1u, duration, duration > 0u);
    let derived_velocity = (landing - start)
        * (60.0 / f32(safe_duration));
    let common_transit_invalid = placement_transit_word(
            rank,
            ${AT.ABI_VERSION}u
        ) != ACTOR_PLACEMENT_ABI
        || placement_transit_word(rank, ${AT.SOURCE_RANK}u) != source_rank
        || placement_transit_word(rank, ${AT.COPY_INDEX}u) != copy_index
        || placement_transit_word(rank, ${AT.MODIFIER_SET_FINGERPRINT}u)
            != actor_header(${H.MODIFIER_SET_FINGERPRINT}u)
        || placement_transit_word(rank, ${AT.DESTINATION_SLOT}u) != slot
        || placement_transit_word(rank, ${AT.DESTINATION_ENTITY_ID}u)
            != entity_id
        || placement_transit_word(rank, ${AT.DESTINATION_INCARNATION}u)
            != incarnation
        || placement_transit_word(rank, ${AT.ACTION_CODE}u) != action
        || placement_transit_word(rank, ${AT.PROFILE_CODE}u)
            != placement_word(rank, ${AP.PROFILE_CODE}u)
        || placement_transit_word(rank, ${AT.ACTIVATION_TICK}u)
            != activation_tick
        || placement_transit_word(rank, ${AT.DURATION_FIXED_TICKS}u)
            != duration
        || placement_transit_word(rank, ${AT.PROGRESS_FIXED_TICKS}u) != 0u
        || placement_transit_word(rank, ${AT.FINGERPRINT}u) == 0u
        || placement_word(rank, ${AP.TARGET_X}u)
            != placement_transit_word(rank, ${AT.LANDING_X}u)
        || placement_word(rank, ${AP.TARGET_Y}u)
            != placement_transit_word(rank, ${AT.LANDING_Y}u)
        || placement_word(rank, ${AP.INITIAL_VELOCITY_X}u)
            != placement_transit_word(rank, ${AT.VELOCITY_X}u)
        || placement_word(rank, ${AP.INITIAL_VELOCITY_Y}u)
            != placement_transit_word(rank, ${AT.VELOCITY_Y}u);
    let throw_transit_invalid = throw_action && (
        duration == 0u
        || duration > ACTOR_INVALID - target_tick
        || activation_tick != target_tick + duration
        || placement_transit_word(rank, ${AT.PHASE}u)
            != PLACEMENT_TRANSIT_AIRBORNE
        || placement_transit_word(rank, ${AT.FLAGS}u)
            != REQUIRED_TRANSIT_FLAGS
        || any(derived_velocity != velocity)
        || !(bitcast<f32>(placement_transit_word(
            rank,
            ${AT.PRESENTATION_ARC_HEIGHT}u
        )) > 0.0)
    );
    let immediate_transit_invalid = immediate_action && (
        duration != 0u
        || target_tick == ACTOR_INVALID
        || activation_tick != target_tick + 1u
        || placement_transit_word(rank, ${AT.PHASE}u)
            != PLACEMENT_TRANSIT_PENDING
        || placement_transit_word(rank, ${AT.FLAGS}u) != 0u
        || any(velocity != vec2f(0.0))
        || bitcast<f32>(placement_transit_word(
            rank,
            ${AT.PRESENTATION_ARC_HEIGHT}u
        )) != 0.0
    );
    if (placement_word(rank, ${AP.ABI_VERSION}u) != ACTOR_PLACEMENT_ABI
        || placement_word(rank, ${AP.STATUS}u) != PLACEMENT_RECORD_VALID
        || placement_word(rank, ${AP.ERROR_FLAGS}u) != 0u
        || placement_word(rank, ${AP.SOURCE_RANK}u) != source_rank
        || placement_word(rank, ${AP.DESTINATION_RANK}u) != rank
        || placement_word(rank, ${AP.COPY_INDEX}u) != copy_index
        || placement_word(rank, ${AP.MODIFIER_SET_FINGERPRINT}u)
            != actor_header(${H.MODIFIER_SET_FINGERPRINT}u)
        || placement_word(rank, ${AP.DESTINATION_SLOT}u) != slot
        || placement_word(rank, ${AP.DESTINATION_ENTITY_ID}u) != entity_id
        || placement_word(rank, ${AP.DESTINATION_INCARNATION}u) != incarnation
        || placement_word(rank, ${AP.ACTION_CODE}u) != action
        || placement_word(rank, ${AP.PAYLOAD_CODE}u) != ACTOR_ENEMY_PAYLOAD
        || placement_word(rank, ${AP.PLACEMENT_FINGERPRINT}u) == 0u
        || placement_word(rank, ${AP.CHILD_GENERATION}u)
            != source_generation + 1u
        || (!throw_action && !immediate_action)
        || common_transit_invalid
        || throw_transit_invalid
        || immediate_transit_invalid
        || !actor_finite(start.x) || !actor_finite(start.y)
        || !actor_finite(landing.x) || !actor_finite(landing.y)
        || !actor_finite(velocity.x) || !actor_finite(velocity.y)
        || !actor_finite(placement_velocity.x)
        || !actor_finite(placement_velocity.y)) {
        errors |= ACTOR_ERROR_SOURCE | ACTOR_ERROR_STALE;
    }
    actor_store_validation(rank, ${V.ERROR_FLAGS}u, errors);
}

@compute @workgroup_size(1)
fn aggregate_actor_action_enemy_payload() {
    if (atomicLoad(&actor_aggregate.values[${A.STATUS}u])
        != ACTOR_STATUS_PENDING) { return; }
    let subject_count = actor_header(${H.SUBJECT_COUNT}u);
    let destination_count = actor_header(${H.DESTINATION_COUNT}u);
    let copies_per_subject = actor_header(${H.COPIES_PER_SUBJECT}u);
    var errors = 0u;
    var destination_fingerprint = actor_hash_word(
        ACTOR_FNV_OFFSET,
        actor_header(${H.COMMAND_FINGERPRINT}u)
    );
    destination_fingerprint = actor_hash_word(
        destination_fingerprint,
        subject_count
    );
    destination_fingerprint = actor_hash_word(
        destination_fingerprint,
        destination_count
    );
    destination_fingerprint = actor_hash_word(
        destination_fingerprint,
        copies_per_subject
    );
    destination_fingerprint = actor_hash_word(
        destination_fingerprint,
        actor_header(${H.MODIFIER_SET_FINGERPRINT}u)
    );
    for (var rank = 0u; rank < destination_count; rank += 1u) {
        errors |= actor_validation(rank, ${V.ERROR_FLAGS}u);
        destination_fingerprint = actor_hash_word(
            destination_fingerprint,
            actor_lease(rank, ${R.DESTINATION_SLOT}u)
        );
        destination_fingerprint = actor_hash_word(
            destination_fingerprint,
            actor_lease(rank, ${R.DESTINATION_ENTITY_ID}u)
        );
        destination_fingerprint = actor_hash_word(
            destination_fingerprint,
            actor_lease(rank, ${R.DESTINATION_INCARNATION}u)
        );
        destination_fingerprint = actor_hash_word(
            destination_fingerprint,
            actor_lease(rank, ${R.SNAPSHOT_RANK}u)
        );
        destination_fingerprint = actor_hash_word(
            destination_fingerprint,
            rank
        );
        destination_fingerprint = actor_hash_word(
            destination_fingerprint,
            actor_lease(rank, ${R.COPY_INDEX}u)
        );
    }
    destination_fingerprint = actor_nonzero_hash(destination_fingerprint);
    if (destination_fingerprint
        != actor_placement.values[${AA.DESTINATION_FINGERPRINT}u]) {
        errors |= ACTOR_ERROR_STALE;
    }
    actor_store_aggregate(${A.DESTINATION_FINGERPRINT}u,
        destination_fingerprint);
    actor_store_aggregate(${A.ERROR_FLAGS}u, errors);
    actor_store_aggregate(${A.STATUS}u,
        select(ACTOR_STATUS_COMPLETE, ACTOR_STATUS_PROTOCOL, errors != 0u));
}

@compute @workgroup_size(${GPU_ACTOR_PAYLOAD_MATERIALIZATION_WORKGROUP_SIZE})
fn materialize_actor_action_enemy_payload(
    @builtin(global_invocation_id) invocation: vec3u
) {
    let rank = invocation.x;
    let destination_count = actor_header(${H.DESTINATION_COUNT}u);
    if (rank >= destination_count
        || atomicLoad(&actor_aggregate.values[${A.STATUS}u])
        != ACTOR_STATUS_COMPLETE) { return; }
    let slot = actor_lease(rank, ${R.DESTINATION_SLOT}u);
    let source_rank = actor_lease(rank, ${R.SNAPSHOT_RANK}u);
    let entity_id = actor_lease(rank, ${R.DESTINATION_ENTITY_ID}u);
    let incarnation = actor_lease(rank, ${R.DESTINATION_INCARNATION}u);
    let start = vec2f(
        bitcast<f32>(placement_word(rank, ${AP.SPAWN_X}u)),
        bitcast<f32>(placement_word(rank, ${AP.SPAWN_Y}u))
    );
    actor_physics.values[slot].position = start;

    if (actor_header(${H.SOURCE_SELECTOR_CODE}u) == ${SUBJECT_SELECTOR_CODE.ENEMY}u) {
        actor_simulations.values[slot].flow_field_index
            = actor_snapshot(source_rank, ${S.FLOW_FIELD_INDEX}u);
        actor_simulations.values[slot].flow_speed = bitcast<f32>(
            actor_snapshot(source_rank, ${S.FLOW_SPEED}u)
        );
        actor_routes.values[slot].route_meta
            = actor_snapshot(source_rank, ${S.ROUTE_META}u);
        actor_routes.values[slot].current_path_index
            = actor_snapshot(source_rank, ${S.ROUTE_PATH_INDEX}u);
        actor_routes.values[slot].route_set_index
            = actor_snapshot(source_rank, ${S.ROUTE_SET_INDEX}u);
        actor_routes.values[slot].profile_code
            = actor_snapshot(source_rank, ${S.ROUTE_PROFILE_CODE}u);
    } else {
        actor_simulations.values[slot].flow_field_index
            = actor_header(${H.DEFAULT_FLOW_FIELD_INDEX}u);
        actor_routes.values[slot].route_meta
            = actor_lease(rank, ${R.DEFAULT_ROUTE_META}u);
        actor_routes.values[slot].current_path_index
            = actor_header(${H.DEFAULT_CURRENT_PATH_INDEX}u);
        actor_routes.values[slot].route_set_index
            = actor_header(${H.DEFAULT_ROUTE_SET_INDEX}u);
        actor_routes.values[slot].profile_code
            = actor_lease(rank, ${R.DEFAULT_ROUTE_PROFILE_CODE}u);
    }
    actor_routes.values[slot].self_entity_id = entity_id;
    actor_routes.values[slot].self_incarnation = incarnation;

    actor_metadata.values[slot].abi_version = ACTOR_METADATA_ABI;
    actor_metadata.values[slot].noun_mask
        = actor_header(${H.PAYLOAD_NOUN_MASK}u);
    actor_metadata.values[slot].definition_code
        = actor_header(${H.PAYLOAD_DEFINITION_CODE}u);
    actor_metadata.values[slot].owner_entity_id
        = actor_snapshot(source_rank, ${S.ENTITY_ID}u);
    actor_metadata.values[slot].owner_incarnation
        = actor_snapshot(source_rank, ${S.INCARNATION}u);
    actor_metadata.values[slot].source_ability_code
        = actor_header(${H.SOURCE_ABILITY_CODE}u);
    actor_metadata.values[slot].source_execution_fingerprint
        = actor_header(${H.SOURCE_EXECUTION_FINGERPRINT}u);
    actor_metadata.values[slot].source_execution_ordinal
        = actor_header(${H.EXECUTION_ORDINAL}u);
    actor_metadata.values[slot].generation
        = placement_word(rank, ${AP.CHILD_GENERATION}u);
    actor_metadata.values[slot].visible_from_execution_ordinal
        = actor_header(${H.EXECUTION_ORDINAL}u) + 1u;
    actor_metadata.values[slot].creation_origin_code
        = actor_header(${H.CREATION_ORIGIN_CODE}u);
    actor_metadata.values[slot].power_fixed_point
        = actor_snapshot(source_rank, ${S.POWER_FIXED_POINT}u);

    if (actor_header(${H.ACTION_CODE}u) != ACTOR_THROW) {
        for (var word = 0u; word < TRANSIT_RECORD_WORDS; word += 1u) {
            set_transit_word(slot, word, 0u);
        }
        actor_physics.values[slot].velocity = vec2f(
            bitcast<f32>(placement_word(rank, ${AP.INITIAL_VELOCITY_X}u)),
            bitcast<f32>(placement_word(rank, ${AP.INITIAL_VELOCITY_Y}u))
        );
        let baseline_flags = actor_lease(rank, ${R.BASELINE_FLAGS}u)
            & ~ACTOR_ALIVE;
        atomicStore(&actor_simulations.values[slot].flags, baseline_flags);
        atomicAdd(&actor_aggregate.values[${A.MATERIALIZED_COUNT}u], 1u);
        return;
    }

    set_transit_word(slot, ${TR.ABI_VERSION}u, ACTOR_TRANSIT_ABI);
    set_transit_word(slot, ${TR.PHASE}u, PERSISTENT_TRANSIT_AIRBORNE);
    set_transit_word(slot, ${TR.FLAGS}u,
        placement_transit_word(rank, ${AT.FLAGS}u));
    set_transit_word(slot, ${TR.PAYLOAD_CODE}u, ACTOR_ENEMY_PAYLOAD);
    set_transit_word(slot, ${TR.ENTITY_ID}u, entity_id);
    set_transit_word(slot, ${TR.INCARNATION}u, incarnation);
    set_transit_word(slot, ${TR.SOURCE_ENTITY_ID}u,
        placement_word(rank, ${AP.SOURCE_ENTITY_ID}u));
    set_transit_word(slot, ${TR.SOURCE_INCARNATION}u,
        placement_word(rank, ${AP.SOURCE_INCARNATION}u));
    set_transit_word(slot, ${TR.ACTION_CODE}u, ACTOR_THROW);
    set_transit_word(slot, ${TR.PROFILE_CODE}u,
        placement_word(rank, ${AP.PROFILE_CODE}u));
    set_transit_word(slot, ${TR.PROFILE_FINGERPRINT}u,
        actor_header(${H.ACTOR_ACTION_PROFILE_FINGERPRINT}u));
    set_transit_word(slot, ${TR.EXECUTION_ORDINAL}u,
        actor_header(${H.EXECUTION_ORDINAL}u));
    set_transit_word(slot, ${TR.EXECUTION_FINGERPRINT}u,
        actor_header(${H.SOURCE_EXECUTION_FINGERPRINT}u));
    set_transit_word(slot, ${TR.PLACEMENT_FINGERPRINT}u,
        actor_header(${H.PLACEMENT_FINGERPRINT}u));
    set_transit_word(slot, ${TR.START_TICK}u,
        actor_header(${H.MATERIALIZATION_TARGET_TICK}u));
    set_transit_word(slot, ${TR.ACTIVATION_TICK}u,
        placement_word(rank, ${AP.ACTIVATION_TICK}u));
    set_transit_word(slot, ${TR.DURATION_FIXED_TICKS}u,
        placement_word(rank, ${AP.TRANSIT_DURATION_FIXED_TICKS}u));
    set_transit_word(slot, ${TR.PROGRESS_FIXED_TICKS}u, 0u);
    set_transit_word(slot, ${TR.START_X}u,
        placement_word(rank, ${AP.SPAWN_X}u));
    set_transit_word(slot, ${TR.START_Y}u,
        placement_word(rank, ${AP.SPAWN_Y}u));
    set_transit_word(slot, ${TR.LANDING_X}u,
        placement_transit_word(rank, ${AT.LANDING_X}u));
    set_transit_word(slot, ${TR.LANDING_Y}u,
        placement_transit_word(rank, ${AT.LANDING_Y}u));
    set_transit_word(slot, ${TR.GROUND_VELOCITY_X}u,
        placement_transit_word(rank, ${AT.VELOCITY_X}u));
    set_transit_word(slot, ${TR.GROUND_VELOCITY_Y}u,
        placement_transit_word(rank, ${AT.VELOCITY_Y}u));
    set_transit_word(slot, ${TR.PRESENTATION_ARC_HEIGHT}u,
        placement_transit_word(rank, ${AT.PRESENTATION_ARC_HEIGHT}u));
    set_transit_word(slot, ${TR.CURRENT_PRESENTATION_ARC_HEIGHT}u, 0u);
    set_transit_word(slot, ${TR.BASELINE_PHYSICAL_META}u,
        actor_physics.values[slot].physical_meta);
    set_transit_word(slot, ${TR.BASELINE_INTERACTION_META}u,
        actor_physics.values[slot].interaction_meta);
    set_transit_word(slot, ${TR.BASELINE_NOUN_MASK}u,
        actor_metadata.values[slot].noun_mask);
    set_transit_word(slot, ${TR.BASELINE_FLOW_FIELD_INDEX}u,
        actor_simulations.values[slot].flow_field_index);
    set_transit_word(slot, ${TR.BASELINE_FLOW_SPEED}u,
        bitcast<u32>(actor_simulations.values[slot].flow_speed));
    set_transit_word(slot, ${TR.BASELINE_VELOCITY_X}u,
        bitcast<u32>(actor_physics.values[slot].velocity.x));
    set_transit_word(slot, ${TR.BASELINE_VELOCITY_Y}u,
        bitcast<u32>(actor_physics.values[slot].velocity.y));
    set_transit_word(slot, ${TR.SOURCE_RANK}u, source_rank);
    set_transit_word(slot, ${TR.RESERVED_0}u, 0u);
    set_transit_word(slot, ${TR.RESERVED_1}u, 0u);
    set_transit_word(slot, ${TR.RESERVED_2}u, 0u);
    set_transit_word(slot, ${TR.RESERVED_3}u, 0u);
    set_transit_word(slot, ${TR.RESERVED_4}u, 0u);
    set_transit_word(slot, ${TR.RECORD_FINGERPRINT}u,
        transit_record_fingerprint(slot));

    actor_physics.values[slot].velocity = vec2f(0.0);
    actor_physics.values[slot].physical_meta = 0u;
    actor_physics.values[slot].interaction_meta = 0u;
    actor_metadata.values[slot].noun_mask = 0u;
    actor_simulations.values[slot].flow_speed = 0.0;
    let baseline_flags = actor_lease(rank, ${R.BASELINE_FLAGS}u)
        & ~ACTOR_ALIVE;
    atomicStore(&actor_simulations.values[slot].flags,
        baseline_flags | ACTOR_CONTROLLED | ACTOR_EXTERNAL_MOTION);
    atomicAdd(&actor_aggregate.values[${A.MATERIALIZED_COUNT}u], 1u);
}
`;

function requirePositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number > 0xffffffff) {
        throw new RangeError(`${label}은 양의 uint32여야 합니다.`);
    }
    return number;
}

function requireNonNegativeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
        throw new RangeError(`${label}은 uint32여야 합니다.`);
    }
    return number;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function captureFailure(stage, error) {
    return Object.freeze({
        stage,
        name: String(error?.name ?? 'Error'),
        message: String(error?.message ?? error)
    });
}

function requireGpuGlobals() {
    const usage = globalThis.GPUBufferUsage;
    const stage = globalThis.GPUShaderStage;
    const mapMode = globalThis.GPUMapMode;
    if (!usage || !stage || !mapMode
        || !Number.isSafeInteger(usage.STORAGE)
        || !Number.isSafeInteger(usage.COPY_SRC)
        || !Number.isSafeInteger(usage.COPY_DST)
        || !Number.isSafeInteger(usage.MAP_READ)
        || !Number.isSafeInteger(stage.COMPUTE)
        || !Number.isSafeInteger(mapMode.READ)) {
        throw new Error('ActorPayloadMaterialization에 필요한 WebGPU 상수가 없습니다.');
    }
    return { usage, stage, mapMode };
}

function createBuffer(device, label, size, usage) {
    return device.createBuffer({ label, size: Math.max(4, size), usage });
}

function getPipelines(device, stage) {
    let cached = PIPELINES_BY_DEVICE.get(device);
    if (cached) return cached;
    const layout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-actor-payload-materialization-layout',
        entries: Array.from(
            { length: GPU_ACTOR_PAYLOAD_MATERIALIZATION_STORAGE_BINDING_COUNT },
            (_, binding) => ({
                binding,
                visibility: stage.COMPUTE,
                buffer: {
                    type: [0, 1, 7].includes(binding)
                        ? 'read-only-storage'
                        : 'storage'
                }
            })
        )
    });
    const module = device.createShaderModule({
        label: 'cirvivor-gpu-actor-payload-materialization-shader',
        code: GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL
    });
    const admissionLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-actor-payload-admission-layout',
        entries: Array.from(
            { length: GPU_SPAWN_ADMISSION_STORAGE_BINDING_COUNT },
            (_, binding) => ({
                binding,
                visibility: stage.COMPUTE,
                buffer: {
                    type: binding === 5 || binding === 6
                        ? 'storage'
                        : 'read-only-storage'
                }
            })
        )
    });
    const admissionParamsLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-actor-payload-admission-params-layout',
        entries: [{
            binding: 0,
            visibility: stage.COMPUTE,
            buffer: { type: 'uniform' }
        }]
    });
    const admissionModule = device.createShaderModule({
        label: 'cirvivor-gpu-actor-payload-admission-shader',
        code: GPU_ACTOR_PAYLOAD_SPAWN_ADMISSION_WGSL
    });
    const queryLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-actor-payload-tower-target-query-layout',
        entries: Array.from({ length: 8 }, (_, binding) => ({
            binding,
            visibility: stage.COMPUTE,
            buffer: {
                type: binding === 7 ? 'storage' : 'read-only-storage'
            }
        }))
    });
    const queryModule = device.createShaderModule({
        label: 'cirvivor-gpu-actor-payload-tower-target-query-shader',
        code: GPU_ACTOR_PAYLOAD_TOWER_TARGET_QUERY_WGSL
    });
    const actorActionLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-actor-action-enemy-materialization-layout',
        entries: Array.from({ length: 9 }, (_, binding) => ({
            binding,
            visibility: stage.COMPUTE,
            buffer: {
                type: binding <= 2 ? 'read-only-storage' : 'storage'
            }
        }))
    });
    const actorActionModule = device.createShaderModule({
        label: 'cirvivor-gpu-actor-action-enemy-materialization-shader',
        code: GPU_ACTOR_ACTION_ENEMY_MATERIALIZATION_WGSL
    });
    const pipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-actor-payload-materialization-pipeline-layout',
        bindGroupLayouts: [layout]
    });
    const createPipeline = (entryPoint, label) => device.createComputePipeline({
        label,
        layout: pipelineLayout,
        compute: { module, entryPoint }
    });
    const actorActionPipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-actor-action-enemy-materialization-pipeline-layout',
        bindGroupLayouts: [actorActionLayout]
    });
    const createActorActionPipeline = (entryPoint) => (
        device.createComputePipeline({
            label: `cirvivor-gpu-actor-action-enemy-${entryPoint}`,
            layout: actorActionPipelineLayout,
            compute: { module: actorActionModule, entryPoint }
        })
    );
    cached = Object.freeze({
        layout,
        admissionLayout,
        admissionParamsLayout,
        queryLayout,
        actorActionLayout,
        query: device.createComputePipeline({
            label: 'cirvivor-gpu-actor-payload-tower-target-query-pipeline',
            layout: device.createPipelineLayout({
                label: 'cirvivor-gpu-actor-payload-tower-target-query-pipeline-layout',
                bindGroupLayouts: [queryLayout]
            }),
            compute: {
                module: queryModule,
                entryPoint: 'query_actor_payload_tower_target'
            }
        }),
        initialize: createPipeline(
            'initialize_actor_payload',
            'cirvivor-gpu-actor-payload-initialize-pipeline'
        ),
        validate: createPipeline(
            'validate_actor_payload',
            'cirvivor-gpu-actor-payload-validate-pipeline'
        ),
        admission: device.createComputePipeline({
            label: 'cirvivor-gpu-actor-payload-admission-pipeline',
            layout: device.createPipelineLayout({
                label: 'cirvivor-gpu-actor-payload-admission-pipeline-layout',
                bindGroupLayouts: [admissionLayout, admissionParamsLayout]
            }),
            compute: {
                module: admissionModule,
                entryPoint: 'admit_actor_payload_spawns'
            }
        }),
        aggregate: createPipeline(
            'aggregate_actor_payload_validation',
            'cirvivor-gpu-actor-payload-aggregate-pipeline'
        ),
        materialize: createPipeline(
            'materialize_actor_payload',
            'cirvivor-gpu-actor-payload-materialize-pipeline'
        ),
        initializeActorAction: createActorActionPipeline(
            'initialize_actor_action_enemy_payload'
        ),
        validateActorAction: createActorActionPipeline(
            'validate_actor_action_enemy_payload'
        ),
        aggregateActorAction: createActorActionPipeline(
            'aggregate_actor_action_enemy_payload'
        ),
        materializeActorAction: createActorActionPipeline(
            'materialize_actor_action_enemy_payload'
        )
    });
    PIPELINES_BY_DEVICE.set(device, cached);
    return cached;
}

function sameResources(left, right) {
    return left?.snapshot === right?.snapshot
        && left?.physics === right?.physics
        && left?.simulation === right?.simulation
        && left?.abilityMetadata === right?.abilityMetadata
        && left?.routeRuntimeStates === right?.routeRuntimeStates
        && left?.enemyBehaviorStates === right?.enemyBehaviorStates
        && left?.sdf === right?.sdf
        && left?.params === right?.params
        && left?.gridCounts === right?.gridCounts
        && left?.gridBodies === right?.gridBodies
        && left?.towerMembers === right?.towerMembers
        && left?.towerRoster === right?.towerRoster
        && left?.actorTransit === right?.actorTransit;
}

function normalizeActorActionPlacementBinding(
    binding,
    command,
    completion,
    destinationCount,
    copiesPerSubject,
    modifierSetFingerprint,
    destinationFingerprint
) {
    if (binding === undefined || binding === null) return null;
    const exact = binding && typeof binding === 'object'
        && binding.buffer
        && binding.abiVersion === GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION
        && binding.subjectCount === completion.subjectCount
        && binding.destinationCount === destinationCount
        && binding.copiesPerSubject === copiesPerSubject
        && binding.modifierSetFingerprint === modifierSetFingerprint
        && binding.executionOrdinal === command.executionOrdinal
        && binding.commandFingerprint === command.fingerprint
        && binding.snapshotFingerprint === completion.snapshotFingerprint
        && binding.destinationFingerprint === destinationFingerprint
        && binding.actorActionProfileFingerprint
            === command.actorActionProfileFingerprint
        && Number.isSafeInteger(binding.placementFingerprint)
        && binding.placementFingerprint > 0
        && binding.placementRecordStride
            === GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.STRIDE
        && binding.transitRecordStride
            === GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.STRIDE
        && Number.isSafeInteger(binding.aggregateByteOffset)
        && binding.aggregateByteOffset >= 0
        && Number.isSafeInteger(binding.byteLength)
        && binding.byteLength > 0
        && binding.placementByteLength === destinationCount
            * GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.STRIDE
        && binding.transitByteLength === destinationCount
            * GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.STRIDE;
    if (!exact) {
        throw new RangeError('Enemy ActorAction placement binding이 exact하지 않습니다.');
    }
    return Object.freeze({ ...binding });
}

function placementFailureClassName(value) {
    if (value === ACTOR_PAYLOAD_PLACEMENT_FAILURE_CLASS.NONE) {
        return 'NONE';
    }
    const names = [];
    if ((value & 1) !== 0) names.push('STATIC_SDF');
    if ((value & 2) !== 0) names.push('EXISTING_BODY');
    if ((value & 4) !== 0) names.push('SIBLING_BODY');
    if ((value & 8) !== 0) names.push('GRID_CELL_CAPACITY');
    return names.join('_AND_');
}

function freezeCompletion(entry, aggregate, extra = {}) {
    const placementReason = aggregate.status
            === ACTOR_PAYLOAD_MATERIALIZATION_STATUS.SDF_REJECTED
        ? Object.freeze({
            code: 'NO_VALID_GLOBAL_PLACEMENT',
            firstFailingRank: aggregate.firstFailingRank ?? null,
            attemptedCandidateCount:
                aggregate.attemptedCandidateCount ?? 0,
            candidateRound: aggregate.attemptedCandidateCount
                    <= SAFE_PLACEMENT_CANDIDATE_COUNT
                ? 0
                : Math.ceil(
                    (aggregate.attemptedCandidateCount
                        - SAFE_PLACEMENT_CANDIDATE_COUNT)
                    / EXPANDING_RING_SLOT_COUNT
                ),
            failureClass: placementFailureClassName(
                aggregate.placementFailureClass
            )
        })
        : null;
    return Object.freeze({
        abiVersion: GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI_VERSION,
        materializerAbiVersion: ACTOR_PAYLOAD_MATERIALIZER_ABI_VERSION,
        transactionId: entry.transactionId,
        ...aggregate,
        ...(placementReason ? { reason: placementReason } : {}),
        ...extra
    });
}

/**
 * GPU snapshot rank i를 CPU가 prelease한 destination rank i로 원자 물질화합니다.
 * CPU는 destination handle/slot과 고정 aggregate만 소유하며 Subject transform을
 * readback하지 않습니다.
 */
export class GpuActorPayloadMaterializationRuntime {
    constructor(options = {}) {
        this.sessionGeneration = requirePositiveInteger(
            options.sessionGeneration ?? 1,
            'sessionGeneration'
        );
        this.commandCapacity = requirePositiveInteger(
            options.commandCapacity
                ?? GPU_ACTOR_PAYLOAD_MATERIALIZATION_DEFAULT_COMMAND_CAPACITY,
            'commandCapacity'
        );
        this.readbackSlotCount = requirePositiveInteger(
            options.readbackSlotCount
                ?? GPU_ACTOR_PAYLOAD_MATERIALIZATION_DEFAULT_READBACK_SLOTS,
            'readbackSlotCount'
        );
        if (this.readbackSlotCount > this.commandCapacity) {
            throw new RangeError('payload readback slot은 command capacity 이하여야 합니다.');
        }
        this.pending = [];
        this.knownTransactionIds = new Set();
        this.completed = [];
        this.inFlight = new Set();
        this.readbackSlots = [];
        this.readbackCursor = 0;
        this.resourceLease = 0;
        this.device = null;
        this.deviceGeneration = 0;
        this.authoritativeEpoch = 0;
        this.resources = null;
        this.pipeline = null;
        this.mapReadMode = null;
        this.state = 'idle';
        this.failure = null;
        this.destroyed = false;
        this.submittedCount = 0;
        this.completedCount = 0;
        this.cancelledCount = 0;
        this.sdfRejectedCount = 0;
        this.protocolRejectedCount = 0;
        this.ringDeferredCount = 0;
        this.aggregateReadbackByteSize
            = GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.AGGREGATE.STRIDE;
    }

    initialize(device, resources, protocol = {}) {
        if (this.destroyed) return false;
        if (!device || typeof device.createBuffer !== 'function') {
            throw new TypeError('ActorPayloadMaterialization에 GPUDevice가 필요합니다.');
        }
        for (const key of [
            'snapshot',
            'physics',
            'simulation',
            'abilityMetadata',
            'routeRuntimeStates',
            'enemyBehaviorStates',
            'sdf',
            'params',
            'gridCounts',
            'gridBodies',
            'towerMembers',
            'towerRoster',
            'actorTransit'
        ]) {
            if (!resources?.[key]) {
                throw new TypeError(`ActorPayloadMaterialization ${key} buffer가 없습니다.`);
            }
        }
        const deviceGeneration = requireNonNegativeInteger(
            protocol.deviceGeneration ?? 0,
            'deviceGeneration'
        );
        const authoritativeEpoch = requireNonNegativeInteger(
            protocol.authoritativeEpoch ?? 0,
            'authoritativeEpoch'
        );
        if (this.device === device
            && this.deviceGeneration === deviceGeneration
            && this.authoritativeEpoch === authoritativeEpoch
            && sameResources(this.resources, resources)
            && this.state === 'ready') {
            return true;
        }
        const { usage, stage, mapMode } = requireGpuGlobals();
        if (Number(device.limits?.maxStorageBuffersPerShaderStage ?? Infinity)
            < GPU_ACTOR_PAYLOAD_MATERIALIZATION_STORAGE_BINDING_COUNT) {
            throw new RangeError('ActorPayloadMaterialization storage binding limit가 부족합니다.');
        }
        this.#retireResources('resource-rebind');
        this.device = device;
        this.deviceGeneration = deviceGeneration;
        this.authoritativeEpoch = authoritativeEpoch;
        this.resources = Object.freeze({ ...resources });
        this.pipeline = getPipelines(device, stage);
        this.mapReadMode = mapMode.READ;
        const lease = ++this.resourceLease;
        this.readbackSlots = Array.from(
            { length: this.readbackSlotCount },
            (_, index) => ({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-actor-payload-readback-${index}`,
                    this.aggregateReadbackByteSize,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                entry: null,
                lease
            })
        );
        this.readbackCursor = 0;
        this.state = 'ready';
        this.failure = null;
        return true;
    }

    canAccept() {
        return !this.destroyed
            && this.state === 'ready'
            && this.pending.length + this.inFlight.size
                < this.commandCapacity;
    }

    stage(request = {}) {
        if (!this.canAccept()) {
            return Object.freeze({
                accepted: false,
                retryable: this.state === 'ready',
                reason: this.destroyed
                    ? 'destroyed'
                    : 'actor-payload-command-capacity'
            });
        }
        const transactionId = requireNonEmptyString(
            request.transactionId,
            'transactionId'
        );
        if (this.knownTransactionIds.has(transactionId)) {
            return Object.freeze({
                accepted: false,
                reason: 'duplicate-actor-payload-transaction'
            });
        }
        const payloadDefinition = normalizeActorPayloadDefinition(
            request.payloadDefinition
        );
        const command = request.command;
        const completion = request.subjectCompletion;
        const snapshotBinding = request.snapshotBinding;
        const destinationLeases = request.destinationLeases;
        const copiesPerSubject = Number(command?.copiesPerSubject ?? 1);
        const modifierSetFingerprint = Number(
            command?.modifierSetFingerprint ?? 0
        );
        const subjectCount = Number(completion?.subjectCount);
        const cardinalityValid = Number.isSafeInteger(subjectCount)
            && subjectCount > 0
            && Number.isSafeInteger(copiesPerSubject)
            && copiesPerSubject > 0
            && copiesPerSubject <= 0xffffffff
            && subjectCount <= Math.floor(0xffffffff / copiesPerSubject);
        const destinationCount = cardinalityValid
            ? subjectCount * copiesPerSubject
            : 0;
        const destinationFingerprint = Number(
            request.destinationFingerprint
        );
        if (!command || !completion || !snapshotBinding
            || !Array.isArray(destinationLeases)
            || destinationLeases.length === 0
            || !cardinalityValid
            || destinationLeases.length !== destinationCount
            || !Number.isSafeInteger(modifierSetFingerprint)
            || modifierSetFingerprint < 0
            || modifierSetFingerprint > 0xffffffff
            || !Number.isSafeInteger(destinationFingerprint)
            || destinationFingerprint <= 0
            || destinationFingerprint >= 0xffffffff
            || snapshotBinding.buffer !== this.resources.snapshot
            || snapshotBinding.abiVersion
                !== GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION
            || snapshotBinding.subjectCount !== completion.subjectCount
            || snapshotBinding.executionOrdinal !== command.executionOrdinal
            || snapshotBinding.commandFingerprint !== command.fingerprint
            || snapshotBinding.snapshotFingerprint
                !== completion.snapshotFingerprint
            || snapshotBinding.sessionGeneration !== this.sessionGeneration
            || snapshotBinding.deviceGeneration !== this.deviceGeneration
            || !Number.isSafeInteger(snapshotBinding.wordOffset)
            || snapshotBinding.wordOffset < 0) {
            return Object.freeze({
                accepted: false,
                reason: 'actor-payload-snapshot-contract'
            });
        }
        let actorActionPlacementBinding;
        try {
            actorActionPlacementBinding = normalizeActorActionPlacementBinding(
                request.actorActionPlacementBinding,
                command,
                completion,
                destinationCount,
                copiesPerSubject,
                modifierSetFingerprint,
                destinationFingerprint
            );
        } catch (error) {
            return Object.freeze({
                accepted: false,
                reason: 'actor-payload-placement-contract',
                message: String(error?.message ?? error)
            });
        }
        const actorActionMode = actorActionPlacementBinding !== null;
        if (ACTOR_ACTION_PLACEMENT_ACTION_CODES.has(command.actionCode)
            !== actorActionMode
            || (actorActionMode
                && command.payloadCode !== ACTOR_PAYLOAD_CODE.ENEMY)) {
            return Object.freeze({
                accepted: false,
                reason: 'actor-payload-action-mode-contract'
            });
        }
        const leaseBytes = createGpuActorPayloadLeaseStorage(
            destinationLeases.length
        );
        writeGpuActorPayloadLeaseHeader(leaseBytes, {
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: this.deviceGeneration,
            authoritativeEpoch: this.authoritativeEpoch,
            snapshotSourceTick: completion.sourceTick,
            materializationTargetTick: request.targetFixedTick,
            executionOrdinal: command.executionOrdinal,
            commandFingerprint: command.fingerprint,
            snapshotFingerprint: completion.snapshotFingerprint,
            subjectCount,
            destinationCount,
            copiesPerSubject,
            modifierSetFingerprint,
            payloadDefinitionCode: payloadDefinition.definitionCode,
            payloadNounMask: payloadDefinition.nounMask,
            payloadTeamId: payloadDefinition.teamId,
            creationOriginCode: payloadDefinition.creationOriginCode,
            sourceAbilityCode: command.compiledAbilityCode,
            sourceExecutionFingerprint: command.executionIdFingerprint,
            sourceSelectorCode: command.selectorCode,
            actionCode: command.actionCode,
            payloadCode: command.payloadCode,
            targetPolicyCode: command.targetPolicyCode,
            towerSlot: request.towerTarget?.slot,
            towerEntityId: request.towerTarget?.entityId,
            towerIncarnation: request.towerTarget?.incarnation,
            coreSlot: request.coreTarget?.slot,
            coreEntityId: request.coreTarget?.entityId,
            coreIncarnation: request.coreTarget?.incarnation,
            sdfCols: request.sdf.cols,
            sdfRows: request.sdf.rows,
            sdfEnabled: request.sdf.enabled,
            worldWidth: request.sdf.worldWidth,
            worldHeight: request.sdf.worldHeight,
            aimPoint: command.aimPoint,
            launchSpeed: payloadDefinition.launchSpeed,
            surfaceGap: payloadDefinition.surfaceGap,
            defaultFlowFieldIndex: request.defaultRoute.flowFieldIndex,
            generationLimit: command.generationLimit,
            snapshotWordOffset: snapshotBinding.wordOffset,
            defaultCurrentPathIndex: request.defaultRoute.currentPathIndex,
            defaultRouteSetIndex: request.defaultRoute.routeSetIndex,
            actorActionProfileFingerprint: actorActionMode
                ? command.actorActionProfileFingerprint
                : 0,
            placementFingerprint: actorActionMode
                ? actorActionPlacementBinding.placementFingerprint
                : 0
        });
        for (let index = 0; index < destinationLeases.length; index++) {
            const lease = destinationLeases[index];
            if (Number(lease?.snapshotRank)
                    !== Math.floor(index / copiesPerSubject)
                || Number(lease?.copyIndex ?? 0)
                    !== index % copiesPerSubject) {
                return Object.freeze({
                    accepted: false,
                    reason: 'actor-payload-destination-rank-contract'
                });
            }
            writeGpuActorPayloadDestinationLease(
                leaseBytes,
                destinationLeases.length,
                index,
                lease
            );
        }
        const usage = globalThis.GPUBufferUsage;
        const leaseBuffer = createBuffer(
            this.device,
            `cirvivor-gpu-actor-payload-leases-${transactionId}`,
            leaseBytes.byteLength,
            usage.STORAGE | usage.COPY_DST
        );
        const aggregateStorageByteSize = this.aggregateReadbackByteSize
            + destinationLeases.length
                * GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI
                    .VALIDATION_RECORD.STRIDE;
        const aggregateBuffer = createBuffer(
            this.device,
            `cirvivor-gpu-actor-payload-aggregate-${transactionId}`,
            aggregateStorageByteSize,
            usage.STORAGE | usage.COPY_SRC
        );
        this.device.queue.writeBuffer(leaseBuffer, 0, leaseBytes);
        const entry = {
            transactionId,
            command,
            completion,
            targetFixedTick: requirePositiveInteger(
                request.targetFixedTick,
                'targetFixedTick'
            ),
            subjectCount,
            destinationCount,
            copiesPerSubject,
            modifierSetFingerprint,
            destinationFingerprint: destinationFingerprint >>> 0,
            actorActionPlacementBinding,
            actorActionProfileFingerprint: actorActionMode
                ? command.actorActionProfileFingerprint
                : 0,
            placementFingerprint: actorActionMode
                ? actorActionPlacementBinding.placementFingerprint
                : 0,
            leaseBuffer,
            aggregateBuffer,
            aggregateStorageByteSize,
            resourceLease: this.resourceLease,
            state: 'pending'
        };
        this.pending.push(entry);
        this.knownTransactionIds.add(transactionId);
        return Object.freeze({
            accepted: true,
            transactionId,
            subjectCount,
            destinationCount,
            copiesPerSubject,
            modifierSetFingerprint,
            destinationFingerprint: destinationFingerprint >>> 0,
            placementFingerprint: actorActionMode
                ? actorActionPlacementBinding.placementFingerprint
                : 0
        });
    }

    submitPendingForFixedTick(sourceTick) {
        const tick = requireNonNegativeInteger(sourceTick, 'sourceTick');
        if (this.destroyed || this.state !== 'ready'
            || this.pending.length === 0) {
            return Object.freeze({ submittedCount: 0, deferredCount: 0 });
        }
        const claims = [];
        for (let index = 0; index < this.pending.length;) {
            const entry = this.pending[index];
            if (entry.targetFixedTick > tick) {
                index++;
                continue;
            }
            const readback = this.#claimReadbackSlot();
            if (!readback) break;
            this.pending.splice(index, 1);
            entry.state = 'in-flight';
            entry.readback = readback;
            readback.entry = entry;
            this.inFlight.add(entry);
            claims.push(entry);
        }
        const deferredCount = this.pending.filter(
            (entry) => entry.targetFixedTick <= tick
        ).length;
        this.ringDeferredCount += deferredCount;
        if (claims.length === 0) {
            return Object.freeze({ submittedCount: 0, deferredCount });
        }
        try {
            const encoder = this.device.createCommandEncoder({
                label: `cirvivor-gpu-actor-payload-materialization-${tick}`
            });
            for (const entry of claims) {
                const bindGroup = entry.actorActionPlacementBinding
                    ? null
                    : this.device.createBindGroup({
                    label: `cirvivor-gpu-actor-payload-bind-${entry.transactionId}`,
                    layout: this.pipeline.layout,
                    entries: [
                        { binding: 0, resource: { buffer: this.resources.snapshot } },
                        { binding: 1, resource: { buffer: entry.leaseBuffer } },
                        { binding: 2, resource: { buffer: this.resources.physics } },
                        { binding: 3, resource: { buffer: this.resources.simulation } },
                        { binding: 4, resource: { buffer: this.resources.abilityMetadata } },
                        { binding: 5, resource: { buffer: this.resources.routeRuntimeStates } },
                        { binding: 6, resource: { buffer: this.resources.enemyBehaviorStates } },
                        { binding: 7, resource: { buffer: this.resources.sdf } },
                        { binding: 8, resource: { buffer: entry.aggregateBuffer } }
                    ]
                });
                const targetQueryBindGroup = entry.actorActionPlacementBinding
                    ? null
                    : this.device.createBindGroup({
                    label: `cirvivor-gpu-actor-payload-target-query-bind-${entry.transactionId}`,
                    layout: this.pipeline.queryLayout,
                    entries: [
                        { binding: 0, resource: { buffer: this.resources.snapshot } },
                        { binding: 1, resource: { buffer: entry.leaseBuffer } },
                        { binding: 2, resource: { buffer: this.resources.physics } },
                        { binding: 3, resource: { buffer: this.resources.simulation } },
                        { binding: 4, resource: { buffer: this.resources.abilityMetadata } },
                        { binding: 5, resource: { buffer: this.resources.towerMembers } },
                        { binding: 6, resource: { buffer: this.resources.towerRoster } },
                        { binding: 7, resource: { buffer: entry.aggregateBuffer } }
                    ]
                });
                const admissionBindGroup = entry.actorActionPlacementBinding
                    ? null
                    : this.device.createBindGroup({
                    label: `cirvivor-gpu-actor-payload-admission-bind-${entry.transactionId}`,
                    layout: this.pipeline.admissionLayout,
                    entries: [
                        { binding: 0, resource: { buffer: this.resources.snapshot } },
                        { binding: 1, resource: { buffer: entry.leaseBuffer } },
                        { binding: 2, resource: { buffer: this.resources.physics } },
                        { binding: 3, resource: { buffer: this.resources.simulation } },
                        { binding: 4, resource: { buffer: this.resources.sdf } },
                        { binding: 5, resource: { buffer: entry.aggregateBuffer } },
                        { binding: 6, resource: { buffer: this.resources.gridCounts } },
                        { binding: 7, resource: { buffer: this.resources.gridBodies } }
                    ]
                });
                const admissionParamsBindGroup
                    = entry.actorActionPlacementBinding
                        ? null
                        : this.device.createBindGroup({
                        label: `cirvivor-gpu-actor-payload-admission-params-bind-${entry.transactionId}`,
                        layout: this.pipeline.admissionParamsLayout,
                        entries: [{
                            binding: 0,
                            resource: { buffer: this.resources.params }
                        }]
                    });
                const actorActionBindGroup = entry.actorActionPlacementBinding
                    ? this.device.createBindGroup({
                        label: `cirvivor-gpu-actor-action-enemy-bind-${entry.transactionId}`,
                        layout: this.pipeline.actorActionLayout,
                        entries: [
                            { binding: 0, resource: { buffer: this.resources.snapshot } },
                            { binding: 1, resource: { buffer: entry.leaseBuffer } },
                            {
                                binding: 2,
                                resource: {
                                    buffer: entry.actorActionPlacementBinding.buffer,
                                    offset: entry.actorActionPlacementBinding
                                        .aggregateByteOffset,
                                    size: entry.actorActionPlacementBinding.byteLength
                                }
                            },
                            { binding: 3, resource: { buffer: this.resources.physics } },
                            { binding: 4, resource: { buffer: this.resources.simulation } },
                            { binding: 5, resource: { buffer: this.resources.abilityMetadata } },
                            { binding: 6, resource: { buffer: this.resources.routeRuntimeStates } },
                            { binding: 7, resource: { buffer: this.resources.actorTransit } },
                            { binding: 8, resource: { buffer: entry.aggregateBuffer } }
                        ]
                    })
                    : null;
                const dispatch = (
                    pipeline,
                    workgroupCount,
                    phase,
                    activeBindGroup = bindGroup,
                    secondaryBindGroup = null
                ) => {
                    const pass = encoder.beginComputePass({
                        label: `cirvivor-gpu-actor-payload-${phase}-pass`
                    });
                    pass.setPipeline(pipeline);
                    pass.setBindGroup(0, activeBindGroup);
                    if (secondaryBindGroup) {
                        pass.setBindGroup(1, secondaryBindGroup);
                    }
                    pass.dispatchWorkgroups(workgroupCount);
                    pass.end();
                };
                const parallelWorkgroupCount = Math.ceil(
                    entry.destinationCount
                        / GPU_ACTOR_PAYLOAD_MATERIALIZATION_WORKGROUP_SIZE
                );
                if (actorActionBindGroup) {
                    dispatch(
                        this.pipeline.initializeActorAction,
                        1,
                        'actor-action-initialize',
                        actorActionBindGroup
                    );
                    dispatch(
                        this.pipeline.validateActorAction,
                        parallelWorkgroupCount,
                        'actor-action-validate',
                        actorActionBindGroup
                    );
                    dispatch(
                        this.pipeline.aggregateActorAction,
                        1,
                        'actor-action-aggregate',
                        actorActionBindGroup
                    );
                    dispatch(
                        this.pipeline.materializeActorAction,
                        parallelWorkgroupCount,
                        'actor-action-materialize',
                        actorActionBindGroup
                    );
                } else {
                    dispatch(this.pipeline.initialize, 1, 'initialize');
                    dispatch(
                        this.pipeline.query,
                        parallelWorkgroupCount,
                        'tower-target-query',
                        targetQueryBindGroup
                    );
                    dispatch(
                        this.pipeline.validate,
                        parallelWorkgroupCount,
                        'validate'
                    );
                    dispatch(
                        this.pipeline.admission,
                        1,
                        'spawn-admission',
                        admissionBindGroup,
                        admissionParamsBindGroup
                    );
                    dispatch(this.pipeline.aggregate, 1, 'aggregate');
                    dispatch(
                        this.pipeline.materialize,
                        parallelWorkgroupCount,
                        'materialize'
                    );
                }
                encoder.copyBufferToBuffer(
                    entry.aggregateBuffer,
                    0,
                    entry.readback.buffer,
                    0,
                    this.aggregateReadbackByteSize
                );
            }
            this.device.queue.submit([encoder.finish()]);
            this.submittedCount += claims.length;
            for (const entry of claims) {
                this.#beginReadback(entry);
            }
        } catch (error) {
            this.failure = captureFailure('actor-payload-submit', error);
            this.state = 'failed';
            for (const entry of claims) {
                this.inFlight.delete(entry);
                this.#releaseReadbackSlot(entry.readback);
                this.#destroyEntryBuffers(entry);
                this.knownTransactionIds.delete(entry.transactionId);
                this.completed.push(freezeCompletion(entry, {
                    sessionGeneration: this.sessionGeneration,
                    deviceGeneration: this.deviceGeneration,
                    authoritativeEpoch: this.authoritativeEpoch,
                    snapshotSourceTick: entry.completion.sourceTick,
                    materializationTargetTick: entry.targetFixedTick,
                    executionOrdinal: entry.command.executionOrdinal,
                    status:
                        ACTOR_PAYLOAD_MATERIALIZATION_STATUS.PROTOCOL_REJECTED,
                    subjectCount: entry.subjectCount,
                    destinationCount: entry.destinationCount,
                    materializedCount: 0,
                    commandFingerprint: entry.command.fingerprint,
                    snapshotFingerprint:
                        entry.completion.snapshotFingerprint,
                    destinationFingerprint: entry.destinationFingerprint,
                    actorActionProfileFingerprint:
                        entry.actorActionProfileFingerprint,
                    placementFingerprint: entry.placementFingerprint,
                    copiesPerSubject: entry.copiesPerSubject,
                    modifierSetFingerprint:
                        entry.modifierSetFingerprint,
                    errorFlags:
                        ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.STALE_PROTOCOL
                }, { failure: this.failure }));
            }
            return Object.freeze({
                submittedCount: 0,
                deferredCount,
                failure: this.failure
            });
        }
        return Object.freeze({
            submittedCount: claims.length,
            deferredCount
        });
    }

    drainCompleted(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('actor payload completion output은 배열이어야 합니다.');
        }
        out.push(...this.completed);
        this.completed.length = 0;
        return out;
    }

    cancelAll(reason = 'cancelled') {
        const cancellationReason = String(reason || 'cancelled');
        let cancelledCount = 0;
        for (const entry of this.pending.splice(0)) {
            this.knownTransactionIds.delete(entry.transactionId);
            this.#destroyEntryBuffers(entry);
            this.completed.push(this.#cancelledCompletion(
                entry,
                cancellationReason
            ));
            cancelledCount++;
        }
        for (const entry of [...this.inFlight]) {
            this.inFlight.delete(entry);
            this.knownTransactionIds.delete(entry.transactionId);
            this.#releaseReadbackSlot(entry.readback);
            this.#destroyEntryBuffers(entry);
            this.completed.push(this.#cancelledCompletion(
                entry,
                cancellationReason
            ));
            cancelledCount++;
        }
        this.cancelledCount += cancelledCount;
        if (cancelledCount > 0) {
            this.resourceLease++;
        }
        return Object.freeze({ cancelledCount, reason: cancellationReason });
    }

    requiresRecovery() {
        return this.state === 'failed';
    }

    getStatus() {
        return Object.freeze({
            abiVersion: GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI_VERSION,
            state: this.destroyed ? 'destroyed' : this.state,
            failure: this.failure,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: this.deviceGeneration,
            authoritativeEpoch: this.authoritativeEpoch,
            commandCapacity: this.commandCapacity,
            readbackSlotCount: this.readbackSlotCount,
            aggregateReadbackByteSize: this.aggregateReadbackByteSize,
            validationScratchStride:
                GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI
                    .VALIDATION_RECORD.STRIDE,
            workgroupSize: GPU_ACTOR_PAYLOAD_MATERIALIZATION_WORKGROUP_SIZE,
            dispatchModel: 'parallel-multi-pass',
            storageBindingCount:
                GPU_ACTOR_PAYLOAD_MATERIALIZATION_STORAGE_BINDING_COUNT,
            towerTargetQueryStorageBindingCount: 8,
            towerTargetPolicy:
                'source-local-distance-share-identity-then-core-then-facing',
            safePlacementPolicy:
                'enemy-local-14-then-bounded-expanding-rings/shared-grid-admission',
            safePlacementCandidateCount:
                SAFE_PLACEMENT_TOTAL_CANDIDATE_COUNT,
            safePlacementLocalCandidateCount:
                SAFE_PLACEMENT_CANDIDATE_COUNT,
            safePlacementExpandingRingCount: EXPANDING_RING_COUNT,
            spawnAdmissionStorageBindingCount:
                GPU_SPAWN_ADMISSION_STORAGE_BINDING_COUNT,
            targetReadbackPolicy: 'none',
            pendingCount: this.pending.length,
            inFlightCount: this.inFlight.size,
            completedQueueCount: this.completed.length,
            submittedCount: this.submittedCount,
            completedCount: this.completedCount,
            cancelledCount: this.cancelledCount,
            sdfRejectedCount: this.sdfRejectedCount,
            protocolRejectedCount: this.protocolRejectedCount,
            ringDeferredCount: this.ringDeferredCount,
            requiresRecovery: this.requiresRecovery(),
            subjectReadbackPolicy: 'aggregate-only',
            perSubjectCpuCommandCount: 0
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.cancelAll('destroyed');
        this.destroyed = true;
        this.#retireResources('destroyed');
        this.completed.length = 0;
        this.knownTransactionIds.clear();
        this.state = 'destroyed';
    }

    #claimReadbackSlot() {
        for (let offset = 0; offset < this.readbackSlots.length; offset++) {
            const index = (this.readbackCursor + offset)
                % this.readbackSlots.length;
            const slot = this.readbackSlots[index];
            if (!slot.inFlight) {
                slot.inFlight = true;
                slot.entry = null;
                slot.lease = this.resourceLease;
                this.readbackCursor = (index + 1) % this.readbackSlots.length;
                return slot;
            }
        }
        return null;
    }

    #releaseReadbackSlot(slot) {
        if (!slot?.inFlight) return;
        slot.inFlight = false;
        slot.entry = null;
    }

    #beginReadback(entry) {
        const slot = entry.readback;
        const lease = this.resourceLease;
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            const authentic = !this.destroyed
                && this.state === 'ready'
                && entry.state === 'in-flight'
                && this.inFlight.has(entry)
                && entry.resourceLease === lease
                && slot.lease === lease
                && slot.entry === entry;
            if (!authentic) {
                try { slot.buffer.unmap(); } catch { /* retired */ }
                this.#releaseReadbackSlot(slot);
                return;
            }
            try {
                const aggregate = readGpuActorPayloadMaterializationAggregate(
                    slot.buffer.getMappedRange().slice(0)
                );
                const exact = aggregate.sessionGeneration
                        === this.sessionGeneration
                    && aggregate.deviceGeneration === this.deviceGeneration
                    && aggregate.authoritativeEpoch === this.authoritativeEpoch
                    && aggregate.snapshotSourceTick
                        === entry.completion.sourceTick
                    && aggregate.materializationTargetTick
                        === entry.targetFixedTick
                    && aggregate.executionOrdinal
                        === entry.command.executionOrdinal
                    && aggregate.subjectCount === entry.subjectCount
                    && aggregate.destinationCount === entry.destinationCount
                    && aggregate.copiesPerSubject === entry.copiesPerSubject
                    && aggregate.modifierSetFingerprint
                        === entry.modifierSetFingerprint
                    && aggregate.commandFingerprint
                        === entry.command.fingerprint
                    && aggregate.snapshotFingerprint
                        === entry.completion.snapshotFingerprint
                    && aggregate.actorActionProfileFingerprint
                        === entry.actorActionProfileFingerprint
                    && aggregate.placementFingerprint
                        === entry.placementFingerprint;
                if (!exact) {
                    throw new RangeError('actor payload aggregate provenance가 다릅니다.');
                }
                if (aggregate.status
                    === ACTOR_PAYLOAD_MATERIALIZATION_STATUS.COMPLETE
                    && aggregate.destinationFingerprint
                        !== entry.destinationFingerprint) {
                    throw new RangeError('actor payload destination fingerprint가 다릅니다.');
                }
                if (aggregate.status
                    === ACTOR_PAYLOAD_MATERIALIZATION_STATUS.SDF_REJECTED) {
                    this.sdfRejectedCount++;
                } else if (aggregate.status
                    === ACTOR_PAYLOAD_MATERIALIZATION_STATUS.PROTOCOL_REJECTED) {
                    this.protocolRejectedCount++;
                }
                this.completed.push(freezeCompletion(entry, aggregate));
                this.completedCount++;
            } catch (error) {
                this.failure = captureFailure(
                    'actor-payload-readback',
                    error
                );
                this.state = 'failed';
                this.protocolRejectedCount++;
                this.completed.push(freezeCompletion(entry, {
                    sessionGeneration: this.sessionGeneration,
                    deviceGeneration: this.deviceGeneration,
                    authoritativeEpoch: this.authoritativeEpoch,
                    snapshotSourceTick: entry.completion.sourceTick,
                    materializationTargetTick: entry.targetFixedTick,
                    executionOrdinal: entry.command.executionOrdinal,
                    status:
                        ACTOR_PAYLOAD_MATERIALIZATION_STATUS.PROTOCOL_REJECTED,
                    subjectCount: entry.subjectCount,
                    destinationCount: entry.destinationCount,
                    materializedCount: 0,
                    commandFingerprint: entry.command.fingerprint,
                    snapshotFingerprint:
                        entry.completion.snapshotFingerprint,
                    destinationFingerprint: entry.destinationFingerprint,
                    actorActionProfileFingerprint:
                        entry.actorActionProfileFingerprint,
                    placementFingerprint: entry.placementFingerprint,
                    copiesPerSubject: entry.copiesPerSubject,
                    modifierSetFingerprint:
                        entry.modifierSetFingerprint,
                    errorFlags:
                        ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG.STALE_PROTOCOL
                }, { failure: this.failure }));
            } finally {
                entry.state = 'complete';
                this.inFlight.delete(entry);
                this.knownTransactionIds.delete(entry.transactionId);
                this.#destroyEntryBuffers(entry);
                slot.buffer.unmap();
                this.#releaseReadbackSlot(slot);
            }
        }).catch((error) => {
            const authentic = entry.resourceLease === this.resourceLease
                && this.inFlight.has(entry);
            if (authentic) {
                this.failure = captureFailure('actor-payload-map', error);
                this.state = 'failed';
                this.inFlight.delete(entry);
                this.knownTransactionIds.delete(entry.transactionId);
                this.#destroyEntryBuffers(entry);
            }
            this.#releaseReadbackSlot(slot);
        });
    }

    #cancelledCompletion(entry, reason) {
        return freezeCompletion(entry, {
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: this.deviceGeneration,
            authoritativeEpoch: this.authoritativeEpoch,
            snapshotSourceTick: entry.completion.sourceTick,
            materializationTargetTick: entry.targetFixedTick,
            executionOrdinal: entry.command.executionOrdinal,
            status: ACTOR_PAYLOAD_MATERIALIZATION_STATUS.CANCELLED,
            subjectCount: entry.subjectCount,
            destinationCount: entry.destinationCount,
            materializedCount: 0,
            commandFingerprint: entry.command.fingerprint,
            snapshotFingerprint: entry.completion.snapshotFingerprint,
            destinationFingerprint: entry.destinationFingerprint,
            actorActionProfileFingerprint:
                entry.actorActionProfileFingerprint,
            placementFingerprint: entry.placementFingerprint,
            copiesPerSubject: entry.copiesPerSubject,
            modifierSetFingerprint: entry.modifierSetFingerprint,
            errorFlags: 0
        }, { reason });
    }

    #destroyEntryBuffers(entry) {
        try { entry.leaseBuffer?.destroy?.(); } catch { /* retired */ }
        try { entry.aggregateBuffer?.destroy?.(); } catch { /* retired */ }
        entry.leaseBuffer = null;
        entry.aggregateBuffer = null;
    }

    #retireResources(reason) {
        this.resourceLease++;
        let retiredCount = 0;
        for (const entry of this.pending.splice(0)) {
            this.knownTransactionIds.delete(entry.transactionId);
            this.completed.push(this.#cancelledCompletion(entry, reason));
            this.#destroyEntryBuffers(entry);
            retiredCount++;
        }
        for (const entry of [...this.inFlight]) {
            this.inFlight.delete(entry);
            this.knownTransactionIds.delete(entry.transactionId);
            this.completed.push(this.#cancelledCompletion(entry, reason));
            this.#destroyEntryBuffers(entry);
            retiredCount++;
        }
        this.cancelledCount += retiredCount;
        for (const slot of this.readbackSlots) {
            slot.inFlight = false;
            slot.entry = null;
            try { slot.buffer?.unmap?.(); } catch { /* retired */ }
            try { slot.buffer?.destroy?.(); } catch { /* retired */ }
        }
        this.readbackSlots = [];
        this.readbackCursor = 0;
        this.resources = null;
        this.pipeline = null;
        this.device = null;
        this.mapReadMode = null;
        if (!this.destroyed) this.state = 'idle';
    }
}
