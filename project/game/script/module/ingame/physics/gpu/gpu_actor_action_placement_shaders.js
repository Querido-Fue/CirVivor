import {
    ACTOR_ACTION_PROFILE_ABI_VERSION
} from '../../contract/actor_action_contract.js';
import {
    ACTOR_PAYLOAD_CODE,
    GAMEPLAY_NOUN_MASK,
    SENTENCE_ACTION_CODE,
    SUBJECT_SELECTOR_CODE
} from '../../contract/word_sentence_contract.js';
import { GAMEPLAY_TEAM_ID } from '../../contract/gameplay_team_contract.js';
import {
    ABILITY_ENTITY_METADATA_ABI_VERSION
} from '../../contract/ability_execution_contract.js';
import {
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI,
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION
} from './gpu_ability_subject_snapshot_abi.js';
import {
    GPU_ACTOR_ACTION_ACTIVATION_CODE,
    GPU_ACTOR_ACTION_PLACEMENT_ABI,
    GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION,
    GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG,
    GPU_ACTOR_ACTION_PLACEMENT_POLICY_CODE,
    GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS,
    GPU_ACTOR_ACTION_PLACEMENT_STATUS,
    GPU_ACTOR_ACTION_SPAWN_ANCHOR_CODE,
    GPU_ACTOR_ACTION_TARGET_KIND,
    GPU_ACTOR_ACTION_TARGET_SNAPSHOT_CODE,
    GPU_ACTOR_ACTION_TRANSIT_CODE,
    GPU_ACTOR_ACTION_TRANSIT_FLAG,
    GPU_ACTOR_ACTION_TRANSIT_PHASE
} from './gpu_actor_action_placement_abi.js';
import {
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_GAMEPLAY_META,
    GPU_CIRCLE_BODY_META
} from './gpu_circle_body_abi.js';
import {
    GPU_TOWER_GROUP_ABI_VERSION,
    GPU_TOWER_GROUP_MEMBER_FLAG
} from './gpu_tower_group_abi.js';

export const GPU_ACTOR_ACTION_PLACEMENT_WORKGROUP_SIZE = 64;
export const GPU_ACTOR_ACTION_PLACEMENT_STORAGE_BINDING_COUNT = 9;
export const GPU_ACTOR_ACTION_DISPATCH_STORAGE_BINDING_COUNT = 2;

const H = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_ACTION_PLACEMENT_ABI.PROGRAM_HEADER)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));
const D = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_ACTION_PLACEMENT_ABI.DESTINATION_LEASE)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));
const A = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));
const P = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));
const T = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));
const S = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));

const HEADER_WORD_COUNT
    = GPU_ACTOR_ACTION_PLACEMENT_ABI.PROGRAM_HEADER.STRIDE / 4;
const LEASE_WORD_COUNT
    = GPU_ACTOR_ACTION_PLACEMENT_ABI.DESTINATION_LEASE.STRIDE / 4;
const AGGREGATE_WORD_COUNT
    = GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.STRIDE / 4;
const PLACEMENT_WORD_COUNT
    = GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.STRIDE / 4;
const TRANSIT_WORD_COUNT
    = GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.STRIDE / 4;
const SNAPSHOT_WORD_COUNT
    = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE / 4;

export const GPU_ACTOR_ACTION_DISPATCH_WGSL = /* wgsl */`
struct RawReadBuffer { values: array<u32> }
struct RawWriteBuffer { values: array<u32> }

@group(0) @binding(0) var<storage, read> program: RawReadBuffer;
@group(0) @binding(1) var<storage, read_write> dispatch_args: RawWriteBuffer;

const SUBJECT_COUNT_WORD: u32 = ${H.SUBJECT_COUNT}u;
const WORKGROUP_SIZE: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_WORKGROUP_SIZE}u;

@compute @workgroup_size(1)
fn prepare_actor_action_dispatch() {
    let count = program.values[SUBJECT_COUNT_WORD];
    dispatch_args.values[0] = (count + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;
    dispatch_args.values[1] = 1u;
    dispatch_args.values[2] = 1u;
    dispatch_args.values[3] = 0u;
}
`;

export const GPU_ACTOR_ACTION_PLACEMENT_WGSL = /* wgsl */`
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

struct TowerMember {
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

struct TowerRoster {
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

struct TargetResolution {
    position: vec2f,
    kind: u32,
    slot: u32,
    entity_id: u32,
    incarnation: u32,
    error_flags: u32,
}

struct RawReadBuffer { values: array<u32> }
struct RawAtomicBuffer { values: array<atomic<u32>> }
struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct AbilityMetadataBuffer { values: array<AbilityEntityMetadata> }
struct TowerMemberBuffer { values: array<TowerMember> }
struct SdfBuffer { values: array<f32> }

@group(0) @binding(0) var<storage, read> snapshots: RawReadBuffer;
@group(0) @binding(1) var<storage, read> program: RawReadBuffer;
@group(0) @binding(2) var<storage, read> physics: PhysicsBuffer;
@group(0) @binding(3) var<storage, read> simulations: SimulationBuffer;
@group(0) @binding(4) var<storage, read> ability_metadata: AbilityMetadataBuffer;
@group(0) @binding(5) var<storage, read> tower_members: TowerMemberBuffer;
@group(0) @binding(6) var<storage, read> tower_roster: TowerRoster;
@group(0) @binding(7) var<storage, read> sdf: SdfBuffer;
@group(0) @binding(8) var<storage, read_write> output: RawAtomicBuffer;

const PLACEMENT_ABI: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION}u;
const SNAPSHOT_ABI: u32 = ${GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION}u;
const BODY_ABI: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;
const PROFILE_ABI: u32 = ${ACTOR_ACTION_PROFILE_ABI_VERSION}u;
const TOWER_GROUP_ABI: u32 = ${GPU_TOWER_GROUP_ABI_VERSION}u;
const METADATA_ABI: u32 = ${ABILITY_ENTITY_METADATA_ABI_VERSION}u;
const HEADER_WORDS: u32 = ${HEADER_WORD_COUNT}u;
const LEASE_WORDS: u32 = ${LEASE_WORD_COUNT}u;
const AGGREGATE_WORDS: u32 = ${AGGREGATE_WORD_COUNT}u;
const PLACEMENT_WORDS: u32 = ${PLACEMENT_WORD_COUNT}u;
const TRANSIT_WORDS: u32 = ${TRANSIT_WORD_COUNT}u;
const SNAPSHOT_WORDS: u32 = ${SNAPSHOT_WORD_COUNT}u;
const INVALID: u32 = 0xffffffffu;
const FNV_OFFSET: u32 = 2166136261u;
const FNV_PRIME: u32 = 16777619u;
const ALIVE_FLAG: u32 = ${GPU_CIRCLE_BODY_META.ALIVE_BIT}u;
const TEAM_SHIFT: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_SHIFT}u;
const TEAM_MASK: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_MASK}u;
const PLAYER_TEAM: u32 = ${GAMEPLAY_TEAM_ID.PLAYER}u;
const HOSTILE_TEAM: u32 = ${GAMEPLAY_TEAM_ID.HOSTILE}u;
const NEUTRAL_TEAM: u32 = ${GAMEPLAY_TEAM_ID.NEUTRAL}u;
const TOWER_SELECTOR: u32 = ${SUBJECT_SELECTOR_CODE.TOWER}u;
const ENEMY_SELECTOR: u32 = ${SUBJECT_SELECTOR_CODE.ENEMY}u;
const TOWER_NOUN: u32 = ${GAMEPLAY_NOUN_MASK.TOWER}u;
const PLAYER_DAMAGEABLE: u32 = ${GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE}u;
const TOWER_MEMBER_FLAG: u32 = ${GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN}u;
const LIVING_MEMBER_FLAG: u32 = ${GPU_TOWER_GROUP_MEMBER_FLAG.LIVING}u;
const SHOOT_ACTION: u32 = ${SENTENCE_ACTION_CODE.SHOOT}u;
const THROW_ACTION: u32 = ${SENTENCE_ACTION_CODE.THROW}u;
const EMIT_ACTION: u32 = ${SENTENCE_ACTION_CODE.EMIT}u;
const SUMMON_ACTION: u32 = ${SENTENCE_ACTION_CODE.SUMMON}u;
const ENEMY_PAYLOAD: u32 = ${ACTOR_PAYLOAD_CODE.ENEMY}u;
const TOWER_PAYLOAD: u32 = ${ACTOR_PAYLOAD_CODE.TOWER}u;
const STATUS_PENDING: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_STATUS.PENDING}u;
const STATUS_COMPLETE: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_STATUS.COMPLETE}u;
const STATUS_SDF_REJECTED: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_STATUS.SDF_REJECTED}u;
const STATUS_PROTOCOL_REJECTED: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_STATUS.PROTOCOL_REJECTED}u;
const RECORD_UNINITIALIZED: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS.UNINITIALIZED}u;
const RECORD_RESOLVED: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS.RESOLVED}u;
const RECORD_VALID: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS.VALID}u;
const RECORD_INVALID: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS.INVALID}u;
const TARGET_AIM: u32 = ${GPU_ACTOR_ACTION_TARGET_KIND.AIM}u;
const TARGET_TOWER: u32 = ${GPU_ACTOR_ACTION_TARGET_KIND.TOWER}u;
const TARGET_CORE: u32 = ${GPU_ACTOR_ACTION_TARGET_KIND.CORE}u;
const TARGET_FACING: u32 = ${GPU_ACTOR_ACTION_TARGET_KIND.FACING}u;
const SPAWN_SOURCE_SURFACE: u32 = ${GPU_ACTOR_ACTION_SPAWN_ANCHOR_CODE.SOURCE_SURFACE}u;
const SPAWN_TARGET_POINT: u32 = ${GPU_ACTOR_ACTION_SPAWN_ANCHOR_CODE.TARGET_POINT}u;
const TARGET_CAST_START: u32 = ${GPU_ACTOR_ACTION_TARGET_SNAPSHOT_CODE.CAST_START}u;
const ACTIVATE_NEXT: u32 = ${GPU_ACTOR_ACTION_ACTIVATION_CODE.NEXT_FIXED_TICK}u;
const ACTIVATE_LANDING: u32 = ${GPU_ACTOR_ACTION_ACTIVATION_CODE.ON_LANDING}u;
const PLACE_SOURCE_SURFACE: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_POLICY_CODE.SOURCE_SURFACE_ATOMIC_SDF}u;
const PLACE_TARGET_LATTICE: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_POLICY_CODE.TARGET_LATTICE_ATOMIC_SDF}u;
const PLACE_SOURCE_AND_LANDING: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_POLICY_CODE.SOURCE_AND_LANDING_ATOMIC_SDF}u;
const TRANSIT_NONE: u32 = ${GPU_ACTOR_ACTION_TRANSIT_CODE.NONE}u;
const TRANSIT_AIRBORNE: u32 = ${GPU_ACTOR_ACTION_TRANSIT_CODE.AIRBORNE_GROUND_PATH}u;
const TRANSIT_ALL_FLAGS: u32 = ${Object.values(
    GPU_ACTOR_ACTION_TRANSIT_FLAG
).reduce((mask, value) => mask | value, 0)}u;
const TRANSIT_PHASE_PENDING: u32 = ${GPU_ACTOR_ACTION_TRANSIT_PHASE.ACTIVATION_PENDING}u;
const TRANSIT_PHASE_AIRBORNE: u32 = ${GPU_ACTOR_ACTION_TRANSIT_PHASE.AIRBORNE}u;
const ERROR_HEADER_ABI: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG.HEADER_ABI}u;
const ERROR_SNAPSHOT_ABI: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG.SNAPSHOT_ABI}u;
const ERROR_BODY_ABI: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG.BODY_ABI}u;
const ERROR_PROFILE_ABI: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG.PROFILE_ABI}u;
const ERROR_SOURCE: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG.SOURCE_RECORD}u;
const ERROR_DESTINATION: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG.DESTINATION_IDENTITY}u;
const ERROR_PROFILE: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG.PROFILE_CONTRACT}u;
const ERROR_TARGET: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG.TARGET_IDENTITY}u;
const ERROR_FINITE: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG.NON_FINITE}u;
const ERROR_SDF: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG.SDF_PLACEMENT}u;
const ERROR_GENERATION: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG.GENERATION}u;
const ERROR_ROSTER: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG.TOWER_ROSTER}u;
const ERROR_FINGERPRINT: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG.FINGERPRINT}u;

fn header(field: u32) -> u32 {
    return program.values[field];
}

fn lease_word(rank: u32, field: u32) -> u32 {
    return program.values[HEADER_WORDS + rank * LEASE_WORDS + field];
}

fn snapshot_word(rank: u32, field: u32) -> u32 {
    return snapshots.values[
        header(${H.SNAPSHOT_WORD_OFFSET}u) + rank * SNAPSHOT_WORDS + field
    ];
}

fn placement_base(rank: u32) -> u32 {
    return header(${H.PLACEMENT_WORD_OFFSET}u) + rank * PLACEMENT_WORDS;
}

fn transit_base(rank: u32) -> u32 {
    return header(${H.TRANSIT_WORD_OFFSET}u) + rank * TRANSIT_WORDS;
}

fn store_aggregate(field: u32, value: u32) {
    atomicStore(&output.values[field], value);
}

fn aggregate_word(field: u32) -> u32 {
    return atomicLoad(&output.values[field]);
}

fn store_placement(rank: u32, field: u32, value: u32) {
    atomicStore(&output.values[placement_base(rank) + field], value);
}

fn placement_word(rank: u32, field: u32) -> u32 {
    return atomicLoad(&output.values[placement_base(rank) + field]);
}

fn store_transit(rank: u32, field: u32, value: u32) {
    atomicStore(&output.values[transit_base(rank) + field], value);
}

fn transit_word(rank: u32, field: u32) -> u32 {
    return atomicLoad(&output.values[transit_base(rank) + field]);
}

fn hash_word(current: u32, value: u32) -> u32 {
    return (current ^ value) * FNV_PRIME;
}

fn nonzero_hash(value: u32) -> u32 {
    return select(value, FNV_OFFSET, value == 0u);
}

fn finite_scalar(value: f32) -> bool {
    return value == value && value - value == 0.0;
}

fn finite_vector(value: vec2f) -> bool {
    return finite_scalar(value.x) && finite_scalar(value.y);
}

fn normalized_direction(
    target_delta: vec2f,
    source_velocity: vec2f,
    source_facing: vec2f
) -> vec2f {
    let target_length = dot(target_delta, target_delta);
    if (finite_scalar(target_length) && target_length > 0.000001) {
        return target_delta * inverseSqrt(target_length);
    }
    let velocity_length = dot(source_velocity, source_velocity);
    if (finite_scalar(velocity_length) && velocity_length > 0.000001) {
        return source_velocity * inverseSqrt(velocity_length);
    }
    let facing_length = dot(source_facing, source_facing);
    if (finite_scalar(facing_length) && facing_length > 0.000001) {
        return source_facing * inverseSqrt(facing_length);
    }
    return vec2f(1.0, 0.0);
}

fn body_team(slot: u32) -> u32 {
    return (simulations.values[slot].gameplay_meta >> TEAM_SHIFT) & TEAM_MASK;
}

fn exact_target(
    slot: u32,
    entity_id: u32,
    incarnation: u32,
    team_id: u32,
    noun_mask: u32
) -> bool {
    return slot < arrayLength(&simulations.values)
        && slot < arrayLength(&physics.values)
        && slot < arrayLength(&ability_metadata.values)
        && entity_id != 0u && entity_id != INVALID
        && incarnation != 0u && incarnation != INVALID
        && (simulations.values[slot].flags & ALIVE_FLAG) != 0u
        && simulations.values[slot].entity_id == entity_id
        && simulations.values[slot].incarnation == incarnation
        && body_team(slot) == team_id
        && (noun_mask == 0u
            || (ability_metadata.values[slot].abi_version == METADATA_ABI
                && (ability_metadata.values[slot].noun_mask & noun_mask)
                    == noun_mask));
}

fn member_matches(slot: u32, member: TowerMember) -> bool {
    return member.group_revision == tower_roster.group_revision
        && member.roster_rank < tower_roster.member_count
        && (member.flags & TOWER_MEMBER_FLAG) != 0u
        && (member.flags & LIVING_MEMBER_FLAG) != 0u
        && exact_target(
            slot,
            member.entity_id,
            member.incarnation,
            PLAYER_TEAM,
            TOWER_NOUN
        )
        && (physics.values[slot].interaction_meta & 0xffffu)
            == PLAYER_DAMAGEABLE;
}

fn identity_less(
    entity_id: u32,
    incarnation: u32,
    selected_entity_id: u32,
    selected_incarnation: u32
) -> bool {
    return entity_id < selected_entity_id
        || (entity_id == selected_entity_id
            && incarnation < selected_incarnation);
}

fn resolve_target(rank: u32, position: vec2f) -> TargetResolution {
    if (header(${H.SOURCE_SELECTOR_CODE}u) == TOWER_SELECTOR) {
        return TargetResolution(
            vec2f(
                bitcast<f32>(header(${H.AIM_POINT_X}u)),
                bitcast<f32>(header(${H.AIM_POINT_Y}u))
            ),
            TARGET_AIM,
            INVALID,
            INVALID,
            INVALID,
            0u
        );
    }

    let expected_capacity = header(${H.TOWER_MEMBER_CAPACITY}u);
    let roster_valid = tower_roster.abi_version == TOWER_GROUP_ABI
        && tower_roster.capacity == expected_capacity
        && expected_capacity == arrayLength(&tower_members.values)
        && expected_capacity == arrayLength(&tower_roster.slots)
        && tower_roster.member_count <= expected_capacity
        && tower_roster.group_revision != 0u
        && tower_roster.fingerprint != 0u
        && tower_roster.session_generation
            == header(${H.SESSION_GENERATION}u)
        && tower_roster.device_generation
            == header(${H.DEVICE_GENERATION}u)
        && tower_roster.authoritative_epoch
            == header(${H.AUTHORITATIVE_EPOCH}u);
    if (!roster_valid) {
        return TargetResolution(
            position,
            TARGET_FACING,
            INVALID,
            INVALID,
            INVALID,
            ERROR_ROSTER
        );
    }

    var found = false;
    var selected_slot = INVALID;
    var selected_entity_id = INVALID;
    var selected_incarnation = INVALID;
    var selected_share = 0u;
    var selected_distance = 3.402823466e+38;
    for (var roster_rank = 0u;
        roster_rank < tower_roster.member_count;
        roster_rank += 1u) {
        let slot = tower_roster.slots[roster_rank];
        if (slot >= arrayLength(&tower_members.values)) { continue; }
        let member = tower_members.values[slot];
        if (member.roster_rank != roster_rank
            || !member_matches(slot, member)) { continue; }
        let delta = physics.values[slot].position - position;
        let distance = dot(delta, delta);
        let better_identity = identity_less(
            member.entity_id,
            member.incarnation,
            selected_entity_id,
            selected_incarnation
        );
        let better = distance < selected_distance
            || (distance == selected_distance
                && (member.share_units > selected_share
                    || (member.share_units == selected_share
                        && better_identity)));
        if (!found || better) {
            found = true;
            selected_slot = slot;
            selected_entity_id = member.entity_id;
            selected_incarnation = member.incarnation;
            selected_share = member.share_units;
            selected_distance = distance;
        }
    }
    if (found) {
        return TargetResolution(
            physics.values[selected_slot].position,
            TARGET_TOWER,
            selected_slot,
            selected_entity_id,
            selected_incarnation,
            0u
        );
    }

    let core_slot = header(${H.CORE_SLOT}u);
    let core_entity_id = header(${H.CORE_ENTITY_ID}u);
    let core_incarnation = header(${H.CORE_INCARNATION}u);
    let core_absent = core_slot == INVALID
        && core_entity_id == INVALID
        && core_incarnation == INVALID;
    if (core_absent) {
        return TargetResolution(
            position,
            TARGET_FACING,
            INVALID,
            INVALID,
            INVALID,
            0u
        );
    }
    if (exact_target(
        core_slot,
        core_entity_id,
        core_incarnation,
        NEUTRAL_TEAM,
        0u
    )) {
        return TargetResolution(
            physics.values[core_slot].position,
            TARGET_CORE,
            core_slot,
            core_entity_id,
            core_incarnation,
            0u
        );
    }
    return TargetResolution(
        position,
        TARGET_FACING,
        INVALID,
        INVALID,
        INVALID,
        ERROR_TARGET
    );
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
    if (!finite_vector(position) || !finite_scalar(radius) || !(radius > 0.0)) {
        return false;
    }
    let width = bitcast<f32>(header(${H.WORLD_WIDTH}u));
    let height = bitcast<f32>(header(${H.WORLD_HEIGHT}u));
    let inside = position.x >= radius && position.y >= radius
        && position.x <= width - radius
        && position.y <= height - radius;
    if (!inside) { return false; }
    if (header(${H.SDF_ENABLED}u) == 0u) { return true; }
    return sample_sdf(position) >= radius;
}

fn lattice_offset(rank: u32) -> vec2i {
    if (rank == 0u) { return vec2i(0, 0); }
    var ring = 1u;
    loop {
        let width = ring * 2u + 1u;
        if (width * width > rank) { break; }
        ring += 1u;
    }
    let side = ring * 2u;
    let width = ring * 2u + 1u;
    let maximum = width * width - 1u;
    let offset = maximum - rank;
    if (offset < side) {
        return vec2i(i32(ring - offset), -i32(ring));
    }
    if (offset < side * 2u) {
        return vec2i(-i32(ring), -i32(ring) + i32(offset - side));
    }
    if (offset < side * 3u) {
        return vec2i(-i32(ring) + i32(offset - side * 2u), i32(ring));
    }
    return vec2i(i32(ring), i32(ring) - i32(offset - side * 3u));
}

fn profile_contract_error() -> u32 {
    let action = header(${H.ACTION_CODE}u);
    let profile = header(${H.PROFILE_CODE}u);
    let spawn_anchor = header(${H.SPAWN_ANCHOR_CODE}u);
    let activation = header(${H.ACTIVATION_CODE}u);
    let placement = header(${H.PLACEMENT_POLICY_CODE}u);
    let transit = header(${H.TRANSIT_CODE}u);
    let transit_flags = header(${H.TRANSIT_FLAGS}u);
    let duration = header(${H.TRAVEL_DURATION_FIXED_TICKS}u);
    let launch_speed = bitcast<f32>(header(${H.LAUNCH_SPEED}u));
    let travel_speed = bitcast<f32>(header(${H.TRAVEL_SPEED}u));
    let surface_gap = bitcast<f32>(header(${H.SURFACE_GAP}u));
    let spacing = bitcast<f32>(header(${H.SUMMON_LATTICE_SPACING}u));
    let arc_height = bitcast<f32>(header(${H.PRESENTATION_ARC_HEIGHT}u));
    if (action != profile || header(${H.PROFILE_FINGERPRINT}u) == 0u
        || header(${H.TARGET_SNAPSHOT_CODE}u) != TARGET_CAST_START) {
        return ERROR_PROFILE;
    }
    if (action == THROW_ACTION) {
        return select(ERROR_PROFILE, 0u,
            spawn_anchor == SPAWN_SOURCE_SURFACE
                && activation == ACTIVATE_LANDING
                && placement == PLACE_SOURCE_AND_LANDING
                && transit == TRANSIT_AIRBORNE
                && transit_flags == TRANSIT_ALL_FLAGS
                && duration > 0u
                && launch_speed == 0.0
                && travel_speed == 0.0
                && surface_gap > 0.0
                && spacing == 0.0
                && arc_height > 0.0);
    }
    if (action == SUMMON_ACTION) {
        return select(ERROR_PROFILE, 0u,
            spawn_anchor == SPAWN_TARGET_POINT
                && activation == ACTIVATE_NEXT
                && placement == PLACE_TARGET_LATTICE
                && transit == TRANSIT_NONE
                && transit_flags == 0u
                && duration == 0u
                && launch_speed == 0.0
                && travel_speed == 0.0
                && surface_gap == 0.0
                && spacing > 0.0
                && arc_height == 0.0);
    }
    if (action == SHOOT_ACTION) {
        return select(ERROR_PROFILE, 0u,
            spawn_anchor == SPAWN_SOURCE_SURFACE
                && activation == ACTIVATE_NEXT
                && placement == PLACE_SOURCE_SURFACE
                && transit == TRANSIT_NONE
                && transit_flags == 0u
                && duration == 0u
                && launch_speed > 0.0
                && travel_speed == 0.0
                && surface_gap > 0.0
                && spacing == 0.0
                && arc_height == 0.0);
    }
    if (action == EMIT_ACTION) {
        return select(ERROR_PROFILE, 0u,
            spawn_anchor == SPAWN_SOURCE_SURFACE
                && activation == ACTIVATE_NEXT
                && placement == PLACE_SOURCE_SURFACE
                && transit == TRANSIT_NONE
                && transit_flags == 0u
                && duration == 0u
                && launch_speed == 0.0
                && travel_speed == 0.0
                && surface_gap > 0.0
                && spacing == 0.0
                && arc_height == 0.0);
    }
    return ERROR_PROFILE;
}

fn reject_header(error_flags: u32) {
    store_aggregate(${A.STATUS}u, STATUS_PROTOCOL_REJECTED);
    store_aggregate(${A.ERROR_FLAGS}u, error_flags);
}

@compute @workgroup_size(${GPU_ACTOR_ACTION_PLACEMENT_WORKGROUP_SIZE})
fn initialize_actor_action_program(
    @builtin(global_invocation_id) invocation: vec3u
) {
    let rank = invocation.x;
    let subject_count = header(${H.SUBJECT_COUNT}u);
    if (rank == 0u) {
        for (var word = 0u; word < AGGREGATE_WORDS; word += 1u) {
            store_aggregate(word, 0u);
        }
        store_aggregate(${A.ABI_VERSION}u, PLACEMENT_ABI);
        store_aggregate(${A.SNAPSHOT_ABI_VERSION}u, SNAPSHOT_ABI);
        store_aggregate(${A.BODY_ABI_VERSION}u, BODY_ABI);
        store_aggregate(${A.PROFILE_ABI_VERSION}u, PROFILE_ABI);
        store_aggregate(${A.SESSION_GENERATION}u,
            header(${H.SESSION_GENERATION}u));
        store_aggregate(${A.DEVICE_GENERATION}u,
            header(${H.DEVICE_GENERATION}u));
        store_aggregate(${A.AUTHORITATIVE_EPOCH}u,
            header(${H.AUTHORITATIVE_EPOCH}u));
        store_aggregate(${A.SNAPSHOT_SOURCE_TICK}u,
            header(${H.SNAPSHOT_SOURCE_TICK}u));
        store_aggregate(${A.PLACEMENT_TARGET_TICK}u,
            header(${H.PLACEMENT_TARGET_TICK}u));
        store_aggregate(${A.EXECUTION_ORDINAL}u,
            header(${H.EXECUTION_ORDINAL}u));
        store_aggregate(${A.STATUS}u, STATUS_PENDING);
        store_aggregate(${A.SUBJECT_COUNT}u, subject_count);
        store_aggregate(${A.COMMAND_FINGERPRINT}u,
            header(${H.COMMAND_FINGERPRINT}u));
        store_aggregate(${A.SNAPSHOT_FINGERPRINT}u,
            header(${H.SNAPSHOT_FINGERPRINT}u));
        store_aggregate(${A.DESTINATION_FINGERPRINT}u,
            header(${H.DESTINATION_FINGERPRINT}u));
        store_aggregate(${A.ACTION_CODE}u, header(${H.ACTION_CODE}u));
        store_aggregate(${A.PROFILE_CODE}u, header(${H.PROFILE_CODE}u));
        store_aggregate(${A.PAYLOAD_CODE}u, header(${H.PAYLOAD_CODE}u));
        store_aggregate(${A.PLACEMENT_BYTE_LENGTH}u,
            subject_count * PLACEMENT_WORDS * 4u);
        store_aggregate(${A.TRANSIT_BYTE_LENGTH}u,
            subject_count * TRANSIT_WORDS * 4u);
        store_aggregate(${A.PROFILE_FINGERPRINT}u,
            header(${H.PROFILE_FINGERPRINT}u));

        var header_error = 0u;
        if (header(${H.ABI_VERSION}u) != PLACEMENT_ABI) {
            header_error |= ERROR_HEADER_ABI;
        }
        if (header(${H.SNAPSHOT_ABI_VERSION}u) != SNAPSHOT_ABI) {
            header_error |= ERROR_SNAPSHOT_ABI;
        }
        if (header(${H.BODY_ABI_VERSION}u) != BODY_ABI) {
            header_error |= ERROR_BODY_ABI;
        }
        if (header(${H.PROFILE_ABI_VERSION}u) != PROFILE_ABI) {
            header_error |= ERROR_PROFILE_ABI;
        }
        let expected_transit = AGGREGATE_WORDS
            + subject_count * PLACEMENT_WORDS;
        let expected_capacity = expected_transit
            + subject_count * TRANSIT_WORDS;
        let selector = header(${H.SOURCE_SELECTOR_CODE}u);
        let payload = header(${H.PAYLOAD_CODE}u);
        let sdf_cols = header(${H.SDF_COLS}u);
        let sdf_rows = header(${H.SDF_ROWS}u);
        let sdf_size_valid = sdf_cols > 0u && sdf_rows > 0u
            && sdf_cols <= arrayLength(&sdf.values) / sdf_rows;
        if (subject_count == 0u
            || header(${H.EXECUTION_ORDINAL}u) == 0u
            || header(${H.EXECUTION_ORDINAL}u) == INVALID
            || header(${H.COMMAND_FINGERPRINT}u) == 0u
            || header(${H.SNAPSHOT_FINGERPRINT}u) == 0u
            || header(${H.DESTINATION_FINGERPRINT}u) == 0u
            || header(${H.GENERATION_LIMIT}u) == 0u
            || header(${H.GENERATION_LIMIT}u) == INVALID
            || (selector != TOWER_SELECTOR && selector != ENEMY_SELECTOR)
            || (payload != ENEMY_PAYLOAD && payload != TOWER_PAYLOAD)
            || header(${H.TOWER_GROUP_ABI_VERSION}u) != TOWER_GROUP_ABI
            || header(${H.FIXED_HZ}u) != 60u
            || header(${H.PLACEMENT_RECORD_WORDS}u) != PLACEMENT_WORDS
            || header(${H.TRANSIT_RECORD_WORDS}u) != TRANSIT_WORDS
            || header(${H.PLACEMENT_WORD_OFFSET}u) != AGGREGATE_WORDS
            || header(${H.TRANSIT_WORD_OFFSET}u) != expected_transit
            || header(${H.OUTPUT_WORD_CAPACITY}u) != expected_capacity
            || !sdf_size_valid
            || !finite_scalar(bitcast<f32>(header(${H.WORLD_WIDTH}u)))
            || !finite_scalar(bitcast<f32>(header(${H.WORLD_HEIGHT}u)))
            || !(bitcast<f32>(header(${H.WORLD_WIDTH}u)) > 0.0)
            || !(bitcast<f32>(header(${H.WORLD_HEIGHT}u)) > 0.0)) {
            header_error |= ERROR_PROFILE;
        }
        header_error |= profile_contract_error();
        if (header_error != 0u) { reject_header(header_error); }
    }
    if (rank >= subject_count) { return; }
    for (var word = 0u; word < PLACEMENT_WORDS; word += 1u) {
        store_placement(rank, word, 0u);
    }
    for (var word = 0u; word < TRANSIT_WORDS; word += 1u) {
        store_transit(rank, word, 0u);
    }
    store_placement(rank, ${P.ABI_VERSION}u, PLACEMENT_ABI);
    store_placement(rank, ${P.STATUS}u, RECORD_UNINITIALIZED);
    store_placement(rank, ${P.SOURCE_RANK}u, rank);
    store_placement(rank, ${P.DESTINATION_RANK}u, rank);
    store_transit(rank, ${T.ABI_VERSION}u, PLACEMENT_ABI);
    store_transit(rank, ${T.SOURCE_RANK}u, rank);
}

@compute @workgroup_size(${GPU_ACTOR_ACTION_PLACEMENT_WORKGROUP_SIZE})
fn resolve_actor_action_placement(
    @builtin(global_invocation_id) invocation: vec3u
) {
    let rank = invocation.x;
    let subject_count = header(${H.SUBJECT_COUNT}u);
    if (rank >= subject_count
        || aggregate_word(${A.STATUS}u) != STATUS_PENDING) { return; }

    var errors = 0u;
    let source_slot = snapshot_word(rank, ${S.PRIVATE_SLOT}u);
    let source_entity_id = snapshot_word(rank, ${S.ENTITY_ID}u);
    let source_incarnation = snapshot_word(rank, ${S.INCARNATION}u);
    let source_team = snapshot_word(rank, ${S.TEAM_ID}u);
    let source_generation = snapshot_word(rank, ${S.GENERATION}u);
    let source_position = vec2f(
        bitcast<f32>(snapshot_word(rank, ${S.POSITION_X}u)),
        bitcast<f32>(snapshot_word(rank, ${S.POSITION_Y}u))
    );
    let source_velocity = vec2f(
        bitcast<f32>(snapshot_word(rank, ${S.VELOCITY_X}u)),
        bitcast<f32>(snapshot_word(rank, ${S.VELOCITY_Y}u))
    );
    let source_facing = vec2f(
        bitcast<f32>(snapshot_word(rank, ${S.FACING_X}u)),
        bitcast<f32>(snapshot_word(rank, ${S.FACING_Y}u))
    );
    let source_radius = bitcast<f32>(snapshot_word(rank, ${S.RADIUS}u));
    let expected_source_team = select(
        HOSTILE_TEAM,
        PLAYER_TEAM,
        header(${H.SOURCE_SELECTOR_CODE}u) == TOWER_SELECTOR
    );
    if (source_entity_id == 0u || source_entity_id == INVALID
        || source_incarnation == 0u || source_incarnation == INVALID
        || source_team != expected_source_team
        || !finite_vector(source_position)
        || !finite_vector(source_velocity)
        || !finite_vector(source_facing)
        || !finite_scalar(source_radius) || !(source_radius > 0.0)) {
        errors |= ERROR_SOURCE;
    }
    if (source_generation >= header(${H.GENERATION_LIMIT}u)) {
        errors |= ERROR_GENERATION;
    }

    let destination_slot = lease_word(rank, ${D.DESTINATION_SLOT}u);
    let destination_entity_id = lease_word(
        rank,
        ${D.DESTINATION_ENTITY_ID}u
    );
    let destination_incarnation = lease_word(
        rank,
        ${D.DESTINATION_INCARNATION}u
    );
    let destination_rank = lease_word(rank, ${D.DESTINATION_RANK}u);
    let destination_in_range = destination_slot
        < arrayLength(&simulations.values)
        && destination_slot < arrayLength(&physics.values);
    if (lease_word(rank, ${D.SNAPSHOT_RANK}u) != rank
        || destination_rank != rank
        || destination_entity_id == 0u || destination_entity_id == INVALID
        || destination_incarnation == 0u
        || destination_incarnation == INVALID
        || !destination_in_range) {
        errors |= ERROR_DESTINATION;
    }
    var destination_radius = 0.0;
    if (destination_in_range) {
        destination_radius = physics.values[destination_slot].radius;
        if (simulations.values[destination_slot].entity_id
                != destination_entity_id
            || simulations.values[destination_slot].incarnation
                != destination_incarnation
            || (simulations.values[destination_slot].flags & ALIVE_FLAG) != 0u
            || !finite_scalar(destination_radius)
            || !(destination_radius > 0.0)) {
            errors |= ERROR_DESTINATION;
        }
    }

    var resolved_target = resolve_target(rank, source_position);
    errors |= resolved_target.error_flags;
    var direction = normalized_direction(
        resolved_target.position - source_position,
        source_velocity,
        source_facing
    );
    let surface_gap = bitcast<f32>(header(${H.SURFACE_GAP}u));
    let duration = header(${H.TRAVEL_DURATION_FIXED_TICKS}u);
    let spacing = bitcast<f32>(header(${H.SUMMON_LATTICE_SPACING}u));
    if (resolved_target.kind == TARGET_FACING) {
        let surface_distance = source_radius + destination_radius + surface_gap;
        let fallback_distance = max(surface_distance, spacing);
        resolved_target.position = source_position
            + direction * fallback_distance;
    }

    var spawn_position = source_position + direction
        * (source_radius + destination_radius + surface_gap);
    if (header(${H.SPAWN_ANCHOR_CODE}u) == SPAWN_TARGET_POINT) {
        let lattice = lattice_offset(rank);
        spawn_position = resolved_target.position
            + vec2f(f32(lattice.x), f32(lattice.y)) * spacing;
    }
    var initial_velocity = direction
        * bitcast<f32>(header(${H.LAUNCH_SPEED}u));
    if (header(${H.TRANSIT_CODE}u) == TRANSIT_AIRBORNE) {
        initial_velocity = (resolved_target.position - spawn_position)
            * (f32(header(${H.FIXED_HZ}u)) / f32(duration));
    }
    let target_tick = header(${H.PLACEMENT_TARGET_TICK}u);
    var activation_tick = target_tick + 1u;
    if (header(${H.ACTIVATION_CODE}u) == ACTIVATE_LANDING) {
        if (duration > INVALID - target_tick) {
            errors |= ERROR_PROFILE;
            activation_tick = INVALID;
        } else {
            activation_tick = target_tick + duration;
        }
    }

    store_placement(rank, ${P.STATUS}u, RECORD_RESOLVED);
    store_placement(rank, ${P.ERROR_FLAGS}u, errors);
    store_placement(rank, ${P.SOURCE_SLOT}u, source_slot);
    store_placement(rank, ${P.SOURCE_ENTITY_ID}u, source_entity_id);
    store_placement(rank, ${P.SOURCE_INCARNATION}u, source_incarnation);
    store_placement(rank, ${P.DESTINATION_SLOT}u, destination_slot);
    store_placement(rank, ${P.DESTINATION_ENTITY_ID}u,
        destination_entity_id);
    store_placement(rank, ${P.DESTINATION_INCARNATION}u,
        destination_incarnation);
    store_placement(rank, ${P.ACTION_CODE}u, header(${H.ACTION_CODE}u));
    store_placement(rank, ${P.PROFILE_CODE}u, header(${H.PROFILE_CODE}u));
    store_placement(rank, ${P.PAYLOAD_CODE}u, header(${H.PAYLOAD_CODE}u));
    store_placement(rank, ${P.SPAWN_X}u, bitcast<u32>(spawn_position.x));
    store_placement(rank, ${P.SPAWN_Y}u, bitcast<u32>(spawn_position.y));
    store_placement(rank, ${P.INITIAL_VELOCITY_X}u,
        bitcast<u32>(initial_velocity.x));
    store_placement(rank, ${P.INITIAL_VELOCITY_Y}u,
        bitcast<u32>(initial_velocity.y));
    store_placement(rank, ${P.TARGET_X}u,
        bitcast<u32>(resolved_target.position.x));
    store_placement(rank, ${P.TARGET_Y}u,
        bitcast<u32>(resolved_target.position.y));
    store_placement(rank, ${P.ACTIVATION_TICK}u, activation_tick);
    store_placement(rank, ${P.TRANSIT_DURATION_FIXED_TICKS}u, duration);
    store_placement(rank, ${P.SOURCE_GENERATION}u, source_generation);
    store_placement(rank, ${P.CHILD_GENERATION}u, source_generation + 1u);
    store_placement(rank, ${P.TARGET_KIND}u, resolved_target.kind);
    store_placement(rank, ${P.TARGET_SLOT}u, resolved_target.slot);
    store_placement(rank, ${P.TARGET_ENTITY_ID}u,
        resolved_target.entity_id);
    store_placement(rank, ${P.TARGET_INCARNATION}u,
        resolved_target.incarnation);
    store_placement(rank, ${P.SOURCE_RADIUS}u, bitcast<u32>(source_radius));
    store_placement(rank, ${P.DESTINATION_RADIUS}u,
        bitcast<u32>(destination_radius));
    store_placement(rank, ${P.DIRECTION_X}u, bitcast<u32>(direction.x));
    store_placement(rank, ${P.DIRECTION_Y}u, bitcast<u32>(direction.y));

    let transit_phase = select(
        TRANSIT_PHASE_PENDING,
        TRANSIT_PHASE_AIRBORNE,
        header(${H.TRANSIT_CODE}u) == TRANSIT_AIRBORNE
    );
    store_transit(rank, ${T.PHASE}u, transit_phase);
    store_transit(rank, ${T.FLAGS}u, header(${H.TRANSIT_FLAGS}u));
    store_transit(rank, ${T.DESTINATION_SLOT}u, destination_slot);
    store_transit(rank, ${T.DESTINATION_ENTITY_ID}u,
        destination_entity_id);
    store_transit(rank, ${T.DESTINATION_INCARNATION}u,
        destination_incarnation);
    store_transit(rank, ${T.ACTION_CODE}u, header(${H.ACTION_CODE}u));
    store_transit(rank, ${T.PROFILE_CODE}u, header(${H.PROFILE_CODE}u));
    store_transit(rank, ${T.ACTIVATION_TICK}u, activation_tick);
    store_transit(rank, ${T.DURATION_FIXED_TICKS}u, duration);
    store_transit(rank, ${T.PROGRESS_FIXED_TICKS}u, 0u);
    store_transit(rank, ${T.LANDING_X}u,
        bitcast<u32>(resolved_target.position.x));
    store_transit(rank, ${T.LANDING_Y}u,
        bitcast<u32>(resolved_target.position.y));
    store_transit(rank, ${T.PRESENTATION_ARC_HEIGHT}u,
        header(${H.PRESENTATION_ARC_HEIGHT}u));
    store_transit(rank, ${T.VELOCITY_X}u,
        bitcast<u32>(initial_velocity.x));
    store_transit(rank, ${T.VELOCITY_Y}u,
        bitcast<u32>(initial_velocity.y));
}

@compute @workgroup_size(${GPU_ACTOR_ACTION_PLACEMENT_WORKGROUP_SIZE})
fn validate_actor_action_placement(
    @builtin(global_invocation_id) invocation: vec3u
) {
    let rank = invocation.x;
    if (rank >= header(${H.SUBJECT_COUNT}u)
        || aggregate_word(${A.STATUS}u) != STATUS_PENDING) { return; }
    var errors = placement_word(rank, ${P.ERROR_FLAGS}u);
    if (placement_word(rank, ${P.STATUS}u) != RECORD_RESOLVED) {
        errors |= ERROR_PROFILE;
    }
    let spawn = vec2f(
        bitcast<f32>(placement_word(rank, ${P.SPAWN_X}u)),
        bitcast<f32>(placement_word(rank, ${P.SPAWN_Y}u))
    );
    let velocity = vec2f(
        bitcast<f32>(placement_word(rank, ${P.INITIAL_VELOCITY_X}u)),
        bitcast<f32>(placement_word(rank, ${P.INITIAL_VELOCITY_Y}u))
    );
    let target_position = vec2f(
        bitcast<f32>(placement_word(rank, ${P.TARGET_X}u)),
        bitcast<f32>(placement_word(rank, ${P.TARGET_Y}u))
    );
    let direction = vec2f(
        bitcast<f32>(placement_word(rank, ${P.DIRECTION_X}u)),
        bitcast<f32>(placement_word(rank, ${P.DIRECTION_Y}u))
    );
    let destination_radius = bitcast<f32>(
        placement_word(rank, ${P.DESTINATION_RADIUS}u)
    );
    if (!finite_vector(spawn) || !finite_vector(velocity)
        || !finite_vector(target_position) || !finite_vector(direction)
        || !finite_scalar(destination_radius)
        || !finite_scalar(bitcast<f32>(header(${H.LAUNCH_SPEED}u)))
        || !finite_scalar(bitcast<f32>(header(${H.TRAVEL_SPEED}u)))
        || !finite_scalar(bitcast<f32>(header(${H.SURFACE_GAP}u)))
        || !finite_scalar(bitcast<f32>(header(${H.SUMMON_LATTICE_SPACING}u)))
        || !finite_scalar(bitcast<f32>(header(${H.PRESENTATION_ARC_HEIGHT}u)))) {
        errors |= ERROR_FINITE;
    }
    if (!valid_spawn_point(spawn, destination_radius)) {
        errors |= ERROR_SDF;
    }
    if ((header(${H.PLACEMENT_POLICY_CODE}u) == PLACE_TARGET_LATTICE
            || header(${H.PLACEMENT_POLICY_CODE}u)
                == PLACE_SOURCE_AND_LANDING)
        && !valid_spawn_point(target_position, destination_radius)) {
        errors |= ERROR_SDF;
    }

    var fingerprint = hash_word(
        FNV_OFFSET,
        header(${H.COMMAND_FINGERPRINT}u)
    );
    for (var field = ${P.SOURCE_RANK}u;
        field <= ${P.DIRECTION_Y}u;
        field += 1u) {
        if (field == ${P.PLACEMENT_FINGERPRINT}u) { continue; }
        fingerprint = hash_word(fingerprint, placement_word(rank, field));
    }
    fingerprint = nonzero_hash(fingerprint);
    store_placement(rank, ${P.PLACEMENT_FINGERPRINT}u, fingerprint);
    store_placement(rank, ${P.ERROR_FLAGS}u, errors);
    store_placement(
        rank,
        ${P.STATUS}u,
        select(RECORD_VALID, RECORD_INVALID, errors != 0u)
    );

    var transit_fingerprint = hash_word(
        header(${H.PROFILE_FINGERPRINT}u),
        fingerprint
    );
    for (var field = ${T.PHASE}u; field <= ${T.VELOCITY_Y}u; field += 1u) {
        transit_fingerprint = hash_word(
            transit_fingerprint,
            transit_word(rank, field)
        );
    }
    store_transit(rank, ${T.FINGERPRINT}u,
        nonzero_hash(transit_fingerprint));
}

@compute @workgroup_size(1)
fn aggregate_actor_action_placement() {
    if (aggregate_word(${A.STATUS}u) != STATUS_PENDING) { return; }
    let subject_count = header(${H.SUBJECT_COUNT}u);
    var errors = 0u;
    var valid_count = 0u;
    var destination_fingerprint = hash_word(
        FNV_OFFSET,
        header(${H.COMMAND_FINGERPRINT}u)
    );
    var placement_fingerprint = hash_word(
        header(${H.PROFILE_FINGERPRINT}u),
        header(${H.SNAPSHOT_FINGERPRINT}u)
    );
    for (var rank = 0u; rank < subject_count; rank += 1u) {
        let record_status = placement_word(rank, ${P.STATUS}u);
        var record_errors = placement_word(rank, ${P.ERROR_FLAGS}u);
        if (record_status == RECORD_VALID && record_errors == 0u) {
            valid_count += 1u;
        } else if (record_errors == 0u) {
            record_errors |= ERROR_PROFILE;
        }
        errors |= record_errors;
        for (var field = ${D.DESTINATION_SLOT}u;
            field <= ${D.DESTINATION_RANK}u;
            field += 1u) {
            destination_fingerprint = hash_word(
                destination_fingerprint,
                lease_word(rank, field)
            );
        }
        placement_fingerprint = hash_word(
            placement_fingerprint,
            placement_word(rank, ${P.PLACEMENT_FINGERPRINT}u)
        );
        placement_fingerprint = hash_word(
            placement_fingerprint,
            transit_word(rank, ${T.FINGERPRINT}u)
        );
    }
    destination_fingerprint = nonzero_hash(destination_fingerprint);
    placement_fingerprint = nonzero_hash(placement_fingerprint);
    if (destination_fingerprint
        != header(${H.DESTINATION_FINGERPRINT}u)) {
        errors |= ERROR_FINGERPRINT;
    }
    store_aggregate(${A.VALID_COUNT}u, valid_count);
    store_aggregate(${A.DESTINATION_FINGERPRINT}u,
        destination_fingerprint);
    store_aggregate(${A.PLACEMENT_FINGERPRINT}u,
        placement_fingerprint);
    store_aggregate(${A.ERROR_FLAGS}u, errors);
    if (errors == 0u && valid_count == subject_count) {
        store_aggregate(${A.STATUS}u, STATUS_COMPLETE);
    } else if ((errors & ~ERROR_SDF) == 0u) {
        store_aggregate(${A.STATUS}u, STATUS_SDF_REJECTED);
    } else {
        store_aggregate(${A.STATUS}u, STATUS_PROTOCOL_REJECTED);
    }
}
`;
