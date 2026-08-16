import {
    ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG,
    ACTOR_PAYLOAD_MATERIALIZATION_STATUS,
    ACTOR_PAYLOAD_MATERIALIZER_ABI_VERSION,
    normalizeActorPayloadDefinition
} from '../../contract/actor_payload_contract.js';
import {
    ABILITY_ENTITY_METADATA_ABI_VERSION
} from '../../contract/ability_execution_contract.js';
import {
    GAMEPLAY_NOUN_MASK,
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
    createGpuActorPayloadLeaseStorage,
    readGpuActorPayloadMaterializationAggregate,
    writeGpuActorPayloadDestinationLease,
    writeGpuActorPayloadLeaseHeader
} from './gpu_actor_payload_materialization_abi.js';
import {
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_GAMEPLAY_META,
    GPU_CIRCLE_BODY_META,
    GPU_CIRCLE_BODY_SIMULATION_FLAG
} from './gpu_circle_body_abi.js';

export const GPU_ACTOR_PAYLOAD_MATERIALIZATION_STORAGE_BINDING_COUNT = 9;
export const GPU_ACTOR_PAYLOAD_MATERIALIZATION_DEFAULT_COMMAND_CAPACITY = 4;
export const GPU_ACTOR_PAYLOAD_MATERIALIZATION_DEFAULT_READBACK_SLOTS = 4;

const INVALID_COMPONENT = 0xffffffff;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const LITTLE_ENDIAN = true;
const PIPELINES_BY_DEVICE = new WeakMap();

const HEADER_WORD_COUNT
    = GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.LEASE_HEADER.STRIDE / 4;
const LEASE_WORD_COUNT
    = GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.DESTINATION_LEASE.STRIDE / 4;
const SNAPSHOT_WORD_COUNT
    = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE / 4;

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
const PLAYER_TEAM: u32 = ${GAMEPLAY_TEAM_ID.PLAYER}u;
const HOSTILE_TEAM: u32 = ${GAMEPLAY_TEAM_ID.HOSTILE}u;
const STATUS_COMPLETE: u32 =
    ${ACTOR_PAYLOAD_MATERIALIZATION_STATUS.COMPLETE}u;
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

    var nearest_slot = INVALID;
    var nearest_distance_squared = 3.402823466e+38;
    let body_capacity = arrayLength(&simulations.values);
    for (var slot = 0u; slot < body_capacity; slot++) {
        if (!is_alive(slot) || body_team(slot) != PLAYER_TEAM) {
            continue;
        }
        let metadata = ability_metadata.values[slot];
        if (metadata.abi_version != METADATA_ABI
            || (metadata.noun_mask & TOWER_NOUN) != TOWER_NOUN) {
            continue;
        }
        let delta = physics.values[slot].position - position;
        let distance_squared = dot(delta, delta);
        if (distance_squared < nearest_distance_squared) {
            nearest_distance_squared = distance_squared;
            nearest_slot = slot;
        }
    }
    if (nearest_slot != INVALID) {
        return normalized_or_fallback(
            physics.values[nearest_slot].position - position,
            facing
        );
    }

    let core_slot = header(${H.CORE_SLOT}u);
    if (core_slot < body_capacity
        && is_alive(core_slot)
        && simulations.values[core_slot].entity_id
            == header(${H.CORE_ENTITY_ID}u)
        && simulations.values[core_slot].incarnation
            == header(${H.CORE_INCARNATION}u)) {
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

fn candidate_position(rank: u32, destination_slot: u32) -> vec2f {
    let source_radius = bitcast<f32>(
        snapshot_word(rank, ${S.RADIUS}u)
    );
    let destination_radius = physics.values[destination_slot].radius;
    let surface_gap = bitcast<f32>(header(${H.SURFACE_GAP}u));
    return source_position(rank)
        + resolve_launch_direction(rank)
            * (source_radius + destination_radius + surface_gap);
}

fn reject(status: u32, errors: u32) {
    store_aggregate(8u, status);
    store_aggregate(14u, errors);
}

@compute @workgroup_size(1)
fn materialize_actor_payload() {
    for (var word = 0u; word < 16u; word++) {
        store_aggregate(word, 0u);
    }
    store_aggregate(0u, MATERIALIZER_ABI);
    store_aggregate(1u, BODY_ABI);
    store_aggregate(2u, header(${H.SESSION_GENERATION}u));
    store_aggregate(3u, header(${H.DEVICE_GENERATION}u));
    store_aggregate(4u, header(${H.AUTHORITATIVE_EPOCH}u));
    store_aggregate(5u, header(${H.SNAPSHOT_SOURCE_TICK}u));
    store_aggregate(6u, header(${H.MATERIALIZATION_TARGET_TICK}u));
    store_aggregate(7u, header(${H.EXECUTION_ORDINAL}u));
    store_aggregate(9u, header(${H.SUBJECT_COUNT}u));
    store_aggregate(11u, header(${H.COMMAND_FINGERPRINT}u));
    store_aggregate(12u, header(${H.SNAPSHOT_FINGERPRINT}u));

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
    let selector = header(${H.SOURCE_SELECTOR_CODE}u);
    let exact_selector = selector == TOWER_SELECTOR
        || selector == ENEMY_SELECTOR;
    if (subject_count == 0u || !exact_selector
        || header(${H.PAYLOAD_NOUN_MASK}u) != ENEMY_NOUN
        || header(${H.PAYLOAD_TEAM_ID}u) != HOSTILE_TEAM
        || header(${H.EXECUTION_ORDINAL}u) == 0u) {
        reject(STATUS_PROTOCOL_REJECTED, ERROR_STALE_PROTOCOL);
        return;
    }

    var destination_fingerprint = hash_word(
        FNV_OFFSET,
        header(${H.COMMAND_FINGERPRINT}u)
    );
    let body_capacity = arrayLength(&simulations.values);
    for (var rank = 0u; rank < subject_count; rank++) {
        let source_entity_id = snapshot_word(rank, ${S.ENTITY_ID}u);
        let source_incarnation = snapshot_word(rank, ${S.INCARNATION}u);
        let source_team = snapshot_word(rank, ${S.TEAM_ID}u);
        let source_generation = snapshot_word(rank, ${S.GENERATION}u);
        let source_radius = bitcast<f32>(
            snapshot_word(rank, ${S.RADIUS}u)
        );
        var source_team_valid = source_team == HOSTILE_TEAM;
        if (selector == TOWER_SELECTOR) {
            source_team_valid = source_team == PLAYER_TEAM;
        }
        if (source_entity_id == 0u || source_entity_id == INVALID
            || source_incarnation == 0u || source_incarnation == INVALID
            || !source_team_valid || !(source_radius > 0.0)) {
            reject(STATUS_PROTOCOL_REJECTED, ERROR_SOURCE_RECORD);
            return;
        }
        if (source_generation >= header(${H.GENERATION_LIMIT}u)
            || header(${H.EXECUTION_ORDINAL}u) == INVALID) {
            reject(STATUS_PROTOCOL_REJECTED, ERROR_GENERATION);
            return;
        }

        let destination_slot = lease_word(
            rank,
            ${R.DESTINATION_SLOT}u
        );
        let destination_entity_id = lease_word(
            rank,
            ${R.DESTINATION_ENTITY_ID}u
        );
        let destination_incarnation = lease_word(
            rank,
            ${R.DESTINATION_INCARNATION}u
        );
        if (lease_word(rank, ${R.SNAPSHOT_RANK}u) != rank
            || destination_slot >= body_capacity
            || destination_entity_id == 0u
            || destination_incarnation == 0u) {
            reject(STATUS_PROTOCOL_REJECTED, ERROR_DESTINATION_IDENTITY);
            return;
        }
        let destination_flags = atomicLoad(
            &simulations.values[destination_slot].flags
        );
        if (simulations.values[destination_slot].entity_id
                != destination_entity_id
            || simulations.values[destination_slot].incarnation
                != destination_incarnation
            || (destination_flags & ALIVE_FLAG) != 0u
            || body_team(destination_slot) != HOSTILE_TEAM) {
            reject(STATUS_PROTOCOL_REJECTED, ERROR_DESTINATION_IDENTITY);
            return;
        }
        let destination_radius = physics.values[destination_slot].radius;
        let position = candidate_position(rank, destination_slot);
        if (!(destination_radius > 0.0)
            || !valid_spawn_point(position, destination_radius)) {
            reject(STATUS_SDF_REJECTED, ERROR_SDF_PLACEMENT);
            return;
        }
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
    }

    for (var rank = 0u; rank < subject_count; rank++) {
        let destination_slot = lease_word(
            rank,
            ${R.DESTINATION_SLOT}u
        );
        let destination_entity_id = lease_word(
            rank,
            ${R.DESTINATION_ENTITY_ID}u
        );
        let destination_incarnation = lease_word(
            rank,
            ${R.DESTINATION_INCARNATION}u
        );
        let direction = resolve_launch_direction(rank);
        physics.values[destination_slot].position
            = candidate_position(rank, destination_slot);
        physics.values[destination_slot].velocity = direction
            * bitcast<f32>(header(${H.LAUNCH_SPEED}u));

        let selector = header(${H.SOURCE_SELECTOR_CODE}u);
        if (selector == ENEMY_SELECTOR) {
            simulations.values[destination_slot].flow_field_index
                = snapshot_word(rank, ${S.FLOW_FIELD_INDEX}u);
            simulations.values[destination_slot].flow_speed = bitcast<f32>(
                snapshot_word(rank, ${S.FLOW_SPEED}u)
            );
            route_states.values[destination_slot].route_meta
                = snapshot_word(rank, ${S.ROUTE_META}u);
            route_states.values[destination_slot].current_path_index
                = snapshot_word(rank, ${S.ROUTE_PATH_INDEX}u);
            route_states.values[destination_slot].route_set_index
                = snapshot_word(rank, ${S.ROUTE_SET_INDEX}u);
            route_states.values[destination_slot].profile_code
                = snapshot_word(rank, ${S.ROUTE_PROFILE_CODE}u);
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
        route_states.values[destination_slot].self_entity_id
            = destination_entity_id;
        route_states.values[destination_slot].self_incarnation
            = destination_incarnation;
        enemy_behaviors.values[destination_slot].facing_x = direction.x;
        enemy_behaviors.values[destination_slot].facing_y = direction.y;

        ability_metadata.values[destination_slot].abi_version = METADATA_ABI;
        ability_metadata.values[destination_slot].noun_mask
            = header(${H.PAYLOAD_NOUN_MASK}u);
        ability_metadata.values[destination_slot].definition_code
            = header(${H.PAYLOAD_DEFINITION_CODE}u);
        ability_metadata.values[destination_slot].owner_entity_id
            = snapshot_word(rank, ${S.ENTITY_ID}u);
        ability_metadata.values[destination_slot].owner_incarnation
            = snapshot_word(rank, ${S.INCARNATION}u);
        ability_metadata.values[destination_slot].source_ability_code
            = header(${H.SOURCE_ABILITY_CODE}u);
        ability_metadata.values[destination_slot]
            .source_execution_fingerprint
            = header(${H.SOURCE_EXECUTION_FINGERPRINT}u);
        ability_metadata.values[destination_slot].source_execution_ordinal
            = header(${H.EXECUTION_ORDINAL}u);
        ability_metadata.values[destination_slot].generation
            = snapshot_word(rank, ${S.GENERATION}u) + 1u;
        ability_metadata.values[destination_slot]
            .visible_from_execution_ordinal
            = header(${H.EXECUTION_ORDINAL}u) + 1u;
        ability_metadata.values[destination_slot].creation_origin_code
            = header(${H.CREATION_ORIGIN_CODE}u);
        ability_metadata.values[destination_slot].power_fixed_point
            = snapshot_word(rank, ${S.POWER_FIXED_POINT}u);

        let baseline_flags = lease_word(rank, ${R.BASELINE_FLAGS}u)
            & ~ALIVE_FLAG;
        atomicStore(
            &simulations.values[destination_slot].flags,
            baseline_flags | CONTROLLED_FLAG | EXTERNAL_MOTION_FLAG
        );
    }
    store_aggregate(10u, subject_count);
    store_aggregate(13u, destination_fingerprint);
    store_aggregate(8u, STATUS_COMPLETE);
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

function getPipeline(device, stage) {
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
    cached = Object.freeze({
        layout,
        pipeline: device.createComputePipeline({
            label: 'cirvivor-gpu-actor-payload-materialization-pipeline',
            layout: device.createPipelineLayout({
                label: 'cirvivor-gpu-actor-payload-materialization-pipeline-layout',
                bindGroupLayouts: [layout]
            }),
            compute: {
                module,
                entryPoint: 'materialize_actor_payload'
            }
        })
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
        && left?.sdf === right?.sdf;
}

function freezeCompletion(entry, aggregate, extra = {}) {
    return Object.freeze({
        abiVersion: GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI_VERSION,
        materializerAbiVersion: ACTOR_PAYLOAD_MATERIALIZER_ABI_VERSION,
        transactionId: entry.transactionId,
        ...aggregate,
        ...extra
    });
}

/**
 * GPU snapshot rank i를 CPU가 prelease한 destination rank i로 원자 물질화합니다.
 * CPU는 destination handle/slot과 64-byte aggregate만 소유하며 Subject transform을
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
            'sdf'
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
        this.pipeline = getPipeline(device, stage);
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
        if (!command || !completion || !snapshotBinding
            || !Array.isArray(destinationLeases)
            || destinationLeases.length === 0
            || destinationLeases.length !== completion.subjectCount
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
            subjectCount: completion.subjectCount,
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
            defaultRouteSetIndex: request.defaultRoute.routeSetIndex
        });
        for (let index = 0; index < destinationLeases.length; index++) {
            writeGpuActorPayloadDestinationLease(
                leaseBytes,
                destinationLeases.length,
                index,
                destinationLeases[index]
            );
        }
        const usage = globalThis.GPUBufferUsage;
        const leaseBuffer = createBuffer(
            this.device,
            `cirvivor-gpu-actor-payload-leases-${transactionId}`,
            leaseBytes.byteLength,
            usage.STORAGE | usage.COPY_DST
        );
        const aggregateBuffer = createBuffer(
            this.device,
            `cirvivor-gpu-actor-payload-aggregate-${transactionId}`,
            this.aggregateReadbackByteSize,
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
            destinationCount: destinationLeases.length,
            destinationFingerprint: request.destinationFingerprint >>> 0,
            leaseBuffer,
            aggregateBuffer,
            resourceLease: this.resourceLease,
            state: 'pending'
        };
        this.pending.push(entry);
        this.knownTransactionIds.add(transactionId);
        return Object.freeze({
            accepted: true,
            transactionId,
            destinationCount: destinationLeases.length
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
                const bindGroup = this.device.createBindGroup({
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
                const pass = encoder.beginComputePass({
                    label: 'cirvivor-gpu-actor-payload-materialization-pass'
                });
                pass.setPipeline(this.pipeline.pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(1);
                pass.end();
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
                    subjectCount: entry.destinationCount,
                    materializedCount: 0,
                    commandFingerprint: entry.command.fingerprint,
                    snapshotFingerprint:
                        entry.completion.snapshotFingerprint,
                    destinationFingerprint: entry.destinationFingerprint,
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
            storageBindingCount:
                GPU_ACTOR_PAYLOAD_MATERIALIZATION_STORAGE_BINDING_COUNT,
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
                    && aggregate.subjectCount === entry.destinationCount
                    && aggregate.commandFingerprint
                        === entry.command.fingerprint
                    && aggregate.snapshotFingerprint
                        === entry.completion.snapshotFingerprint;
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
                    subjectCount: entry.destinationCount,
                    materializedCount: 0,
                    commandFingerprint: entry.command.fingerprint,
                    snapshotFingerprint:
                        entry.completion.snapshotFingerprint,
                    destinationFingerprint: entry.destinationFingerprint,
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
            subjectCount: entry.destinationCount,
            materializedCount: 0,
            commandFingerprint: entry.command.fingerprint,
            snapshotFingerprint: entry.completion.snapshotFingerprint,
            destinationFingerprint: entry.destinationFingerprint,
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
