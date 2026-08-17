import {
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_SIMULATION_FLAG
} from './gpu_circle_body_abi.js';
import { GAMEPLAY_TEAM_ID } from '../../contract/gameplay_team_contract.js';
import {
    GPU_BODY_CONTROL_PROGRAM_RESULT,
    GPU_BODY_CONTROL_SELECTED_TARGET_KIND,
    GPU_BODY_CONTROL_SELECTION_POLICY,
    GPU_FIXED_PRIMITIVE_IDENTITY
} from './gpu_fixed_primitive_abi.js';
import {
    GPU_TOWER_GROUP_ABI_VERSION,
    GPU_TOWER_GROUP_COMMAND_FLAG,
    GPU_TOWER_GROUP_INVALID_COMPONENT,
    GPU_TOWER_GROUP_MEMBER_FLAG,
    GPU_TOWER_GROUP_SUMMARY_STATUS
} from './gpu_tower_group_abi.js';

const COMMON_WGSL = /* wgsl */`
const BODY_ABI_VERSION: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;
const TOWER_GROUP_ABI_VERSION: u32 = ${GPU_TOWER_GROUP_ABI_VERSION}u;
const INVALID_COMPONENT: u32 = ${GPU_TOWER_GROUP_INVALID_COMPONENT}u;
const BODY_FLAG_ALIVE: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE}u;
const BODY_FLAG_CONTROLLED_THIS_TICK: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.CONTROLLED_THIS_TICK}u;
const PLAYER_TEAM_ID: u32 = ${GAMEPLAY_TEAM_ID.PLAYER}u;
const PLAYER_DAMAGEABLE_LAYER: u32 = ${GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE}u;
const MEMBER_FLAG_TOWER_NOUN: u32 = ${GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN}u;
const MEMBER_FLAG_LIVING: u32 = ${GPU_TOWER_GROUP_MEMBER_FLAG.LIVING}u;
const COMMAND_FLAG_VALID: u32 = ${GPU_TOWER_GROUP_COMMAND_FLAG.VALID}u;
const STATUS_BODY_ABI_MISMATCH: u32 = ${GPU_TOWER_GROUP_SUMMARY_STATUS.BODY_ABI_MISMATCH}u;
const STATUS_ABI_MISMATCH: u32 = ${GPU_TOWER_GROUP_SUMMARY_STATUS.ABI_MISMATCH}u;
const STATUS_PROTOCOL_MISMATCH: u32 = ${GPU_TOWER_GROUP_SUMMARY_STATUS.PROTOCOL_MISMATCH}u;
const STATUS_COMMAND_FINGERPRINT_MISMATCH: u32 = ${GPU_TOWER_GROUP_SUMMARY_STATUS.COMMAND_FINGERPRINT_MISMATCH}u;
const STATUS_ROSTER_INVALID: u32 = ${GPU_TOWER_GROUP_SUMMARY_STATUS.ROSTER_INVALID}u;
const FNV_OFFSET: u32 = 0x811c9dc5u;
const FNV_PRIME: u32 = 0x01000193u;

struct BodyCounts {
    body_count: u32,
    addition_count: u32,
    removal_count: u32,
    abi_version: u32,
}

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

struct BodyControlState {
    move_intent: vec2f,
    entity_id: u32,
    incarnation: u32,
    source_tick: u32,
    selection_sequence: u32,
    attack_fingerprint: u32,
    result: u32,
    selected_target_kind: u32,
    selected_target_slot: u32,
    selected_target_entity_id: u32,
    selected_target_incarnation: u32,
    state_flags: u32,
    selection_policy: u32,
    attack_range: f32,
    reserved_0: u32,
}

struct TowerMemberState {
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

struct TowerCommand {
    abi_version: u32,
    status: atomic<u32>,
    session_generation: u32,
    device_generation: u32,
    authoritative_epoch: u32,
    source_tick: u32,
    group_revision: u32,
    roster_fingerprint: u32,
    move_intent: vec2f,
    aim_world_point: vec2f,
    command_fingerprint: u32,
    flags: u32,
    reserved_0: u32,
    reserved_1: u32,
}

struct TowerFixedParams {
    abi_version: u32,
    session_generation: u32,
    device_generation: u32,
    authoritative_epoch: u32,
    source_tick: u32,
    body_abi_version: u32,
    reserved_0: u32,
    reserved_1: u32,
}

struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct BodyControlStateBuffer { values: array<BodyControlState> }
struct TowerMemberBuffer { values: array<TowerMemberState> }

fn hash_word(hash: u32, word: u32) -> u32 {
    return (hash ^ word) * FNV_PRIME;
}

fn compute_roster_fingerprint() -> u32 {
    if (roster.capacity != arrayLength(&members.values)
        || roster.capacity != arrayLength(&roster.slots)
        || roster.member_count > roster.capacity) {
        return 0u;
    }
    var hash = FNV_OFFSET;
    hash = hash_word(hash, TOWER_GROUP_ABI_VERSION);
    hash = hash_word(hash, roster.session_generation);
    hash = hash_word(hash, roster.device_generation);
    hash = hash_word(hash, roster.authoritative_epoch);
    hash = hash_word(hash, roster.group_revision);
    hash = hash_word(hash, roster.member_count);
    var rank = 0u;
    loop {
        if (rank >= roster.member_count) { break; }
        let slot = roster.slots[rank];
        if (slot >= roster.capacity) { return 0u; }
        let member = members.values[slot];
        hash = hash_word(hash, slot);
        hash = hash_word(hash, member.entity_id);
        hash = hash_word(hash, member.incarnation);
        hash = hash_word(hash, member.logical_ordinal);
        hash = hash_word(hash, member.share_units);
        hash = hash_word(hash, member.max_hp_fixed_point);
        hash = hash_word(hash, member.power_fixed_point);
        hash = hash_word(hash, member.group_revision);
        hash = hash_word(hash, member.flags);
        hash = hash_word(hash, member.roster_rank);
        rank += 1u;
    }
    return select(hash, 1u, hash == 0u);
}

fn compute_command_fingerprint() -> u32 {
    var hash = FNV_OFFSET;
    hash = hash_word(hash, TOWER_GROUP_ABI_VERSION);
    hash = hash_word(hash, command.session_generation);
    hash = hash_word(hash, command.device_generation);
    hash = hash_word(hash, command.authoritative_epoch);
    hash = hash_word(hash, command.source_tick);
    hash = hash_word(hash, command.group_revision);
    hash = hash_word(hash, command.roster_fingerprint);
    hash = hash_word(hash, bitcast<u32>(command.move_intent.x));
    hash = hash_word(hash, bitcast<u32>(command.move_intent.y));
    hash = hash_word(hash, bitcast<u32>(command.aim_world_point.x));
    hash = hash_word(hash, bitcast<u32>(command.aim_world_point.y));
    hash = hash_word(hash, command.flags);
    return select(hash, 1u, hash == 0u);
}

fn validate_protocol() -> u32 {
    var status = 0u;
    if (counts.abi_version != BODY_ABI_VERSION
        || fixed_params.body_abi_version != BODY_ABI_VERSION) {
        status |= STATUS_BODY_ABI_MISMATCH;
    }
    if (fixed_params.abi_version != TOWER_GROUP_ABI_VERSION
        || roster.abi_version != TOWER_GROUP_ABI_VERSION
        || command.abi_version != TOWER_GROUP_ABI_VERSION) {
        status |= STATUS_ABI_MISMATCH;
    }
    let protocol_matches = fixed_params.session_generation == roster.session_generation
        && fixed_params.session_generation == command.session_generation
        && fixed_params.device_generation == roster.device_generation
        && fixed_params.device_generation == command.device_generation
        && fixed_params.authoritative_epoch == roster.authoritative_epoch
        && fixed_params.authoritative_epoch == command.authoritative_epoch
        && fixed_params.source_tick == command.source_tick
        && command.source_tick != 0u;
    if (!protocol_matches) { status |= STATUS_PROTOCOL_MISMATCH; }
    let roster_fingerprint = compute_roster_fingerprint();
    if (roster.group_revision == 0u
        || command.group_revision != roster.group_revision
        || roster.fingerprint == 0u
        || roster.fingerprint != roster_fingerprint
        || command.roster_fingerprint != roster.fingerprint
        || roster.member_count > counts.body_count) {
        status |= STATUS_ROSTER_INVALID;
    }
    if ((command.flags & COMMAND_FLAG_VALID) == 0u
        || command.reserved_0 != 0u
        || command.reserved_1 != 0u
        || command.command_fingerprint != compute_command_fingerprint()) {
        status |= STATUS_COMMAND_FINGERPRINT_MISMATCH;
    }
    return status;
}

fn member_matches_body(slot: u32, member: TowerMemberState) -> bool {
    if (slot >= counts.body_count
        || slot >= arrayLength(&physics.values)
        || slot >= arrayLength(&simulations.values)
        || member.entity_id == 0u
        || member.entity_id == INVALID_COMPONENT
        || member.incarnation == 0u
        || member.incarnation == INVALID_COMPONENT
        || member.group_revision != roster.group_revision
        || (member.flags & MEMBER_FLAG_TOWER_NOUN) == 0u
        || (member.flags & MEMBER_FLAG_LIVING) == 0u) {
        return false;
    }
    let team_id = simulations.values[slot].gameplay_meta & 0xffu;
    let interaction_layer = physics.values[slot].interaction_meta & 0xffffu;
    return simulations.values[slot].entity_id == member.entity_id
        && simulations.values[slot].incarnation == member.incarnation
        && (atomicLoad(&simulations.values[slot].flags) & BODY_FLAG_ALIVE) != 0u
        && team_id == PLAYER_TEAM_ID
        && interaction_layer == PLAYER_DAMAGEABLE_LAYER;
}
`;

export const GPU_TOWER_GROUP_CONTROL_WGSL = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(3) var<storage, read_write> body_controls: BodyControlStateBuffer;
@group(0) @binding(4) var<storage, read> members: TowerMemberBuffer;
@group(0) @binding(5) var<storage, read> roster: TowerRoster;
@group(0) @binding(6) var<storage, read_write> command: TowerCommand;
@group(0) @binding(7) var<uniform> fixed_params: TowerFixedParams;

var<workgroup> control_status: u32;

@compute @workgroup_size(256)
fn broadcast_control(@builtin(local_invocation_id) local_id: vec3u) {
    if (local_id.x == 0u) {
        control_status = validate_protocol() | atomicLoad(&command.status);
        if (control_status != 0u) {
            atomicOr(&command.status, control_status);
        }
    }
    workgroupBarrier();
    if (control_status != 0u) { return; }

    var rank = local_id.x;
    loop {
        if (rank >= roster.member_count) { break; }
        let slot = roster.slots[rank];
        let member = members.values[slot];
        if (member.roster_rank == rank && member_matches_body(slot, member)) {
            body_controls.values[slot] = BodyControlState(
                command.move_intent,
                member.entity_id,
                member.incarnation,
                0u,
                0u,
                0u,
                ${GPU_BODY_CONTROL_PROGRAM_RESULT.PENDING}u,
                ${GPU_BODY_CONTROL_SELECTED_TARGET_KIND.NONE}u,
                ${GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT}u,
                ${GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT}u,
                ${GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT}u,
                0u,
                ${GPU_BODY_CONTROL_SELECTION_POLICY.NONE}u,
                0.0,
                0u
            );
            atomicOr(
                &simulations.values[slot].flags,
                BODY_FLAG_CONTROLLED_THIS_TICK
            );
        }
        rank += 256u;
    }
}
`;

export const GPU_TOWER_GROUP_SUMMARY_WGSL = /* wgsl */`
${COMMON_WGSL}

struct TowerSummary {
    abi_version: u32,
    status: atomic<u32>,
    session_generation: u32,
    device_generation: u32,
    authoritative_epoch: u32,
    source_tick: u32,
    group_revision: u32,
    living_count: u32,
    centroid: vec2f,
    bounds_min: vec2f,
    bounds_max: vec2f,
    primary_entity_id: u32,
    primary_incarnation: u32,
    living_share_units: u32,
    roster_fingerprint: u32,
    primary_logical_ordinal: u32,
    excluded_member_count: u32,
}

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(3) var<storage, read> members: TowerMemberBuffer;
@group(0) @binding(4) var<storage, read> roster: TowerRoster;
@group(0) @binding(5) var<storage, read_write> command: TowerCommand;
@group(0) @binding(6) var<storage, read_write> summary: TowerSummary;
@group(0) @binding(7) var<uniform> fixed_params: TowerFixedParams;

@compute @workgroup_size(1)
fn reduce_summary() {
    let status = validate_protocol() | atomicLoad(&command.status);
    summary.abi_version = TOWER_GROUP_ABI_VERSION;
    atomicStore(&summary.status, status);
    summary.session_generation = fixed_params.session_generation;
    summary.device_generation = fixed_params.device_generation;
    summary.authoritative_epoch = fixed_params.authoritative_epoch;
    summary.source_tick = fixed_params.source_tick;
    summary.group_revision = roster.group_revision;
    summary.living_count = 0u;
    summary.centroid = vec2f(0.0);
    summary.bounds_min = vec2f(0.0);
    summary.bounds_max = vec2f(0.0);
    summary.primary_entity_id = INVALID_COMPONENT;
    summary.primary_incarnation = INVALID_COMPONENT;
    summary.living_share_units = 0u;
    summary.roster_fingerprint = roster.fingerprint;
    summary.primary_logical_ordinal = INVALID_COMPONENT;
    summary.excluded_member_count = 0u;
    if (status != 0u) { return; }

    var weighted_position = vec2f(0.0);
    var minimum = vec2f(3.402823466e+38);
    var maximum = vec2f(-3.402823466e+38);
    var rank = 0u;
    loop {
        if (rank >= roster.member_count) { break; }
        let slot = roster.slots[rank];
        let member = members.values[slot];
        if (member.roster_rank != rank || !member_matches_body(slot, member)) {
            summary.excluded_member_count += 1u;
            rank += 1u;
            continue;
        }
        let body = physics.values[slot];
        let share = f32(member.share_units);
        weighted_position += body.position * share;
        summary.living_share_units += member.share_units;
        minimum = min(minimum, body.position - vec2f(body.radius));
        maximum = max(maximum, body.position + vec2f(body.radius));
        if (summary.living_count == 0u) {
            summary.primary_entity_id = member.entity_id;
            summary.primary_incarnation = member.incarnation;
            summary.primary_logical_ordinal = member.logical_ordinal;
        }
        summary.living_count += 1u;
        rank += 1u;
    }
    if (summary.living_count > 0u) {
        summary.bounds_min = minimum;
        summary.bounds_max = maximum;
    }
    if (summary.living_share_units > 0u) {
        summary.centroid = weighted_position / f32(summary.living_share_units);
    }
}
`;
