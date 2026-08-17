import {
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_SIMULATION_FLAG,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM
} from './gpu_circle_body_abi.js';
import {
    GPU_SPAWN_PROGRAM_ABI_VERSION,
    GPU_SPAWN_PROGRAM_MODE,
    GPU_SPAWN_PROGRAM_REQUEST_FLAGS,
    GPU_SPAWN_PROGRAM_RESULT
} from './gpu_fixed_primitive_abi.js';
import { GAMEPLAY_TEAM_ID } from '../../contract/gameplay_team_contract.js';
import {
    GPU_TOWER_GROUP_ABI_VERSION,
    GPU_TOWER_GROUP_INVALID_COMPONENT,
    GPU_TOWER_GROUP_MEMBER_FLAG
} from './gpu_tower_group_abi.js';
import {
    GPU_TOWER_TARGET_QUERY_ABI_VERSION,
    GPU_TOWER_TARGET_QUERY_FLAG,
    GPU_TOWER_TARGET_QUERY_STATUS
} from './gpu_tower_target_query_abi.js';

export const GPU_TOWER_TARGET_QUERY_WORKGROUP_SIZE = 64;

export const GPU_TOWER_TARGET_QUERY_WGSL = /* wgsl */`
const BODY_ABI_VERSION: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;
const TOWER_GROUP_ABI_VERSION: u32 = ${GPU_TOWER_GROUP_ABI_VERSION}u;
const QUERY_ABI_VERSION: u32 = ${GPU_TOWER_TARGET_QUERY_ABI_VERSION}u;
const SPAWN_ABI_VERSION: u32 = ${GPU_SPAWN_PROGRAM_ABI_VERSION}u;
const INVALID_COMPONENT: u32 = ${GPU_TOWER_GROUP_INVALID_COMPONENT}u;
const BODY_FLAG_ALIVE: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE}u;
const PLAYER_TEAM_ID: u32 = ${GAMEPLAY_TEAM_ID.PLAYER}u;
const HOSTILE_TEAM_ID: u32 = ${GAMEPLAY_TEAM_ID.HOSTILE}u;
const PLAYER_DAMAGEABLE_LAYER: u32 = ${GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE}u;
const MEMBER_FLAG_TOWER_NOUN: u32 = ${GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN}u;
const MEMBER_FLAG_LIVING: u32 = ${GPU_TOWER_GROUP_MEMBER_FLAG.LIVING}u;
const OCTAGON_PROGRAM: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT}u;
const QUERY_FLAG_VALID: u32 = ${GPU_TOWER_TARGET_QUERY_FLAG.VALID}u;
const QUERY_FLAG_SOURCE_VALID: u32 = ${GPU_TOWER_TARGET_QUERY_FLAG.SOURCE_VALID}u;
const QUERY_FLAG_ROSTER_CHANGED: u32 = ${GPU_TOWER_TARGET_QUERY_FLAG.ROSTER_CHANGED}u;
const QUERY_FLAG_TARGET_CHANGED: u32 = ${GPU_TOWER_TARGET_QUERY_FLAG.TARGET_CHANGED}u;
const QUERY_FLAG_IDENTITY_POLICY: u32 = ${GPU_TOWER_TARGET_QUERY_FLAG.IDENTITY_POLICY}u;
const QUERY_FLAG_COMPATIBILITY_EXACT: u32 = ${GPU_TOWER_TARGET_QUERY_FLAG.COMPATIBILITY_EXACT}u;
const STATUS_BODY_ABI_MISMATCH: u32 = ${GPU_TOWER_TARGET_QUERY_STATUS.BODY_ABI_MISMATCH}u;
const STATUS_QUERY_ABI_MISMATCH: u32 = ${GPU_TOWER_TARGET_QUERY_STATUS.QUERY_ABI_MISMATCH}u;
const STATUS_ROSTER_INVALID: u32 = ${GPU_TOWER_TARGET_QUERY_STATUS.ROSTER_INVALID}u;
const SPAWN_MODE_SOURCE_RELATIVE_TARGET_ENTITY: u32 = ${GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY}u;
const SPAWN_REQUEST_TOWER_DAMAGE_CHANNEL: u32 = ${GPU_SPAWN_PROGRAM_REQUEST_FLAGS.TOWER_DAMAGE_CHANNEL}u;
const SPAWN_RESULT_NO_TARGET: u32 = ${GPU_SPAWN_PROGRAM_RESULT.NO_TARGET}u;

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
    health: i32,
    gameplay_meta: u32,
    flags: u32,
    flow_field_index: u32,
    flow_speed: f32,
    entity_id: u32,
    incarnation: u32,
}

struct EnemyBehaviorState {
    program_id: u32,
    state: u32,
    flags: u32,
    target_slot: u32,
    target_entity_id: u32,
    target_incarnation: u32,
    state_entered_fixed_tick: u32,
    state_expires_at_fixed_tick: u32,
    charge_direction: vec2f,
    windup_range: f32,
    charge_speed: f32,
    recoil_impulse: f32,
    telegraph_radius_scale: f32,
    windup_ticks: u32,
    charge_max_ticks: u32,
    recoil_ticks: u32,
    recover_ticks: u32,
    telegraph_color_rgba8: u32,
    telegraph_style_code: u32,
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

struct TowerGameplayTargetConfig {
    target_slot: u32,
    entity_id: u32,
    incarnation: u32,
    enabled: u32,
}

struct TowerTargetQueryResult {
    source_entity_id: u32,
    source_incarnation: u32,
    target_slot: u32,
    target_entity_id: u32,
    target_incarnation: u32,
    share_units: u32,
    group_revision: u32,
    roster_fingerprint: u32,
    distance_squared: f32,
    flags: u32,
}

struct TowerTargetQueryStats {
    abi_version: u32,
    status: atomic<u32>,
    query_count: atomic<u32>,
    valid_count: atomic<u32>,
    group_revision: u32,
    roster_fingerprint: u32,
    body_count: u32,
    reserved: u32,
}

struct FixedProgramHeader {
    abi_version: u32,
    count: u32,
    capacity: u32,
    status: atomic<u32>,
}

struct SpawnProgramRecord {
    destination_slot: u32,
    destination_entity_id: u32,
    destination_incarnation: u32,
    source_slot: u32,
    source_entity_id: u32,
    source_incarnation: u32,
    target_slot: u32,
    target_entity_id: u32,
    target_incarnation: u32,
    mode_flags: u32,
    result: u32,
    source_tick: u32,
    position_offset: vec2f,
    target_offset: vec2f,
    vector: vec2f,
    scalar: f32,
    reserved_0: u32,
    selection_sequence: u32,
    attack_fingerprint: u32,
    selected_target_kind: u32,
    request_flags: u32,
}

struct SpawnProgram {
    header: FixedProgramHeader,
    records: array<SpawnProgramRecord>,
}

struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct EnemyBehaviorStateBuffer { values: array<EnemyBehaviorState> }
struct TowerMemberBuffer { values: array<TowerMemberState> }
struct TowerTargetQueryResultBuffer { values: array<TowerTargetQueryResult> }

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read> simulations: SimulationBuffer;
@group(0) @binding(3) var<storage, read> enemy_behaviors: EnemyBehaviorStateBuffer;
@group(0) @binding(4) var<storage, read> members: TowerMemberBuffer;
@group(0) @binding(5) var<storage, read> roster: TowerRoster;
@group(0) @binding(6) var<storage, read_write> results: TowerTargetQueryResultBuffer;
@group(0) @binding(7) var<storage, read_write> stats: TowerTargetQueryStats;
@group(0) @binding(8) var<storage, read> compatibility_target: TowerGameplayTargetConfig;

fn body_is_alive(slot: u32) -> bool {
    return slot < counts.body_count
        && slot < arrayLength(&simulations.values)
        && (simulations.values[slot].flags & BODY_FLAG_ALIVE) != 0u;
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
    return simulations.values[slot].entity_id == member.entity_id
        && simulations.values[slot].incarnation == member.incarnation
        && body_is_alive(slot)
        && (simulations.values[slot].gameplay_meta & 0xffu) == PLAYER_TEAM_ID
        && (physics.values[slot].interaction_meta & 0xffffu)
            == PLAYER_DAMAGEABLE_LAYER;
}

fn exact_compatibility_target_is_valid() -> bool {
    let slot = compatibility_target.target_slot;
    return compatibility_target.enabled != 0u
        && slot < counts.body_count
        && slot < arrayLength(&physics.values)
        && slot < arrayLength(&simulations.values)
        && simulations.values[slot].entity_id == compatibility_target.entity_id
        && simulations.values[slot].incarnation == compatibility_target.incarnation
        && body_is_alive(slot)
        && (simulations.values[slot].gameplay_meta & 0xffu) == PLAYER_TEAM_ID
        && (physics.values[slot].interaction_meta & 0xffffu)
            == PLAYER_DAMAGEABLE_LAYER;
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

@compute @workgroup_size(1)
fn reset_query_stats() {
    stats.abi_version = QUERY_ABI_VERSION;
    atomicStore(&stats.status, 0u);
    atomicStore(&stats.query_count, 0u);
    atomicStore(&stats.valid_count, 0u);
    stats.group_revision = roster.group_revision;
    stats.roster_fingerprint = roster.fingerprint;
    stats.body_count = counts.body_count;
    stats.reserved = 0u;
    if (counts.abi_version != BODY_ABI_VERSION) {
        atomicOr(&stats.status, STATUS_BODY_ABI_MISMATCH);
    }
    if (stats.abi_version != QUERY_ABI_VERSION) {
        atomicOr(&stats.status, STATUS_QUERY_ABI_MISMATCH);
    }
}

@compute @workgroup_size(${GPU_TOWER_TARGET_QUERY_WORKGROUP_SIZE})
fn query_tower_targets(@builtin(global_invocation_id) global_id: vec3u) {
    let source_slot = global_id.x;
    if (source_slot >= arrayLength(&results.values)) { return; }
    let previous = results.values[source_slot];
    var output = TowerTargetQueryResult(
        0u,
        0u,
        INVALID_COMPONENT,
        INVALID_COMPONENT,
        INVALID_COMPONENT,
        0u,
        roster.group_revision,
        roster.fingerprint,
        3.402823466e+38,
        0u
    );
    if (source_slot >= counts.body_count
        || source_slot >= arrayLength(&physics.values)
        || source_slot >= arrayLength(&simulations.values)
        || !body_is_alive(source_slot)
        || (simulations.values[source_slot].gameplay_meta & 0xffu)
            != HOSTILE_TEAM_ID) {
        results.values[source_slot] = output;
        return;
    }
    output.source_entity_id = simulations.values[source_slot].entity_id;
    output.source_incarnation = simulations.values[source_slot].incarnation;
    output.flags = QUERY_FLAG_SOURCE_VALID;
    atomicAdd(&stats.query_count, 1u);

    let roster_valid = roster.abi_version == TOWER_GROUP_ABI_VERSION
        && roster.capacity == arrayLength(&members.values)
        && roster.capacity == arrayLength(&roster.slots)
        && roster.member_count <= roster.capacity
        && roster.member_count <= counts.body_count
        && roster.group_revision != 0u
        && roster.fingerprint != 0u;
    let identity_policy = source_slot < arrayLength(&enemy_behaviors.values)
        && enemy_behaviors.values[source_slot].program_id == OCTAGON_PROGRAM;
    if (identity_policy) { output.flags |= QUERY_FLAG_IDENTITY_POLICY; }

    var found = false;
    if (roster_valid) {
        var rank = 0u;
        loop {
            if (rank >= roster.member_count) { break; }
            let slot = roster.slots[rank];
            if (slot < arrayLength(&members.values)) {
                let member = members.values[slot];
                if (member.roster_rank == rank && member_matches_body(slot, member)) {
                    let delta = physics.values[slot].position
                        - physics.values[source_slot].position;
                    let distance_squared = dot(delta, delta);
                    let better_identity = identity_less(
                        member.entity_id,
                        member.incarnation,
                        output.target_entity_id,
                        output.target_incarnation
                    );
                    let better_default = distance_squared < output.distance_squared
                        || (distance_squared == output.distance_squared
                            && (member.share_units > output.share_units
                                || (member.share_units == output.share_units
                                    && better_identity)));
                    if (!found || select(better_default, better_identity, identity_policy)) {
                        found = true;
                        output.target_slot = slot;
                        output.target_entity_id = member.entity_id;
                        output.target_incarnation = member.incarnation;
                        output.share_units = member.share_units;
                        output.distance_squared = distance_squared;
                    }
                }
            }
            rank += 1u;
        }
    } else {
        atomicOr(&stats.status, STATUS_ROSTER_INVALID);
        if (exact_compatibility_target_is_valid()) {
            found = true;
            output.target_slot = compatibility_target.target_slot;
            output.target_entity_id = compatibility_target.entity_id;
            output.target_incarnation = compatibility_target.incarnation;
            let delta = physics.values[output.target_slot].position
                - physics.values[source_slot].position;
            output.distance_squared = dot(delta, delta);
            output.flags |= QUERY_FLAG_COMPATIBILITY_EXACT;
        }
    }
    if (found) {
        output.flags |= QUERY_FLAG_VALID;
        atomicAdd(&stats.valid_count, 1u);
    }
    if (previous.source_entity_id == output.source_entity_id
        && previous.source_incarnation == output.source_incarnation
        && previous.group_revision != output.group_revision) {
        output.flags |= QUERY_FLAG_ROSTER_CHANGED;
    } else if (previous.source_entity_id != output.source_entity_id
        || previous.source_incarnation != output.source_incarnation) {
        output.flags |= QUERY_FLAG_ROSTER_CHANGED;
    }
    if (previous.target_slot != output.target_slot
        || previous.target_entity_id != output.target_entity_id
        || previous.target_incarnation != output.target_incarnation) {
        output.flags |= QUERY_FLAG_TARGET_CHANGED;
    }
    results.values[source_slot] = output;
}

@group(1) @binding(0) var<storage, read> rewrite_counts: BodyCounts;
@group(1) @binding(1) var<storage, read> rewrite_simulations: SimulationBuffer;
@group(1) @binding(2) var<storage, read> rewrite_results: TowerTargetQueryResultBuffer;
@group(1) @binding(3) var<storage, read_write> spawn_program: SpawnProgram;

@compute @workgroup_size(${GPU_TOWER_TARGET_QUERY_WORKGROUP_SIZE})
fn rewrite_tower_target_spawns(@builtin(global_invocation_id) global_id: vec3u) {
    if (spawn_program.header.abi_version != SPAWN_ABI_VERSION
        || spawn_program.header.count > spawn_program.header.capacity
        || spawn_program.header.capacity != arrayLength(&spawn_program.records)) {
        return;
    }
    let index = global_id.x;
    if (index >= spawn_program.header.count) { return; }
    let record = spawn_program.records[index];
    if (record.mode_flags != SPAWN_MODE_SOURCE_RELATIVE_TARGET_ENTITY
        || (record.request_flags & SPAWN_REQUEST_TOWER_DAMAGE_CHANNEL) == 0u
        || record.source_slot >= rewrite_counts.body_count
        || record.source_slot >= arrayLength(&rewrite_simulations.values)
        || record.source_slot >= arrayLength(&rewrite_results.values)) {
        return;
    }
    let query = rewrite_results.values[record.source_slot];
    let source_matches = query.source_entity_id == record.source_entity_id
        && query.source_incarnation == record.source_incarnation;
    if ((query.flags & QUERY_FLAG_VALID) != 0u && source_matches) {
        spawn_program.records[index].target_slot = query.target_slot;
        spawn_program.records[index].target_entity_id = query.target_entity_id;
        spawn_program.records[index].target_incarnation = query.target_incarnation;
    } else if ((query.flags & QUERY_FLAG_SOURCE_VALID) != 0u && source_matches) {
        spawn_program.records[index].target_slot = INVALID_COMPONENT;
        spawn_program.records[index].target_entity_id = INVALID_COMPONENT;
        spawn_program.records[index].target_incarnation = INVALID_COMPONENT;
        spawn_program.records[index].result = SPAWN_RESULT_NO_TARGET;
    }
}
`;
