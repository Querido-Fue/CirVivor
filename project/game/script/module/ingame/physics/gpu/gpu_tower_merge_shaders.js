import {
    ABILITY_ENTITY_METADATA_ABI_VERSION
} from '../../contract/ability_execution_contract.js';
import {
    GAMEPLAY_TEAM_ID
} from '../../contract/gameplay_team_contract.js';
import {
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_SIMULATION_FLAG
} from './gpu_circle_body_abi.js';
import {
    GPU_TOWER_GROUP_ABI_VERSION,
    GPU_TOWER_GROUP_INVALID_COMPONENT,
    GPU_TOWER_GROUP_MEMBER_FLAG
} from './gpu_tower_group_abi.js';
import {
    GPU_TOWER_MERGE_ABI_VERSION,
    GPU_TOWER_MERGE_ERROR_FLAG,
    GPU_TOWER_MERGE_MAX_SOURCE_COUNT,
    GPU_TOWER_MERGE_RECORD_ROLE,
    GPU_TOWER_MERGE_STATUS
} from './gpu_tower_merge_abi.js';

export const GPU_TOWER_MERGE_WORKGROUP_SIZE = 64;

export const GPU_TOWER_MERGE_WGSL = /* wgsl */`
const BODY_ABI_VERSION: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;
const TOWER_GROUP_ABI_VERSION: u32 = ${GPU_TOWER_GROUP_ABI_VERSION}u;
const TOWER_MERGE_ABI_VERSION: u32 = ${GPU_TOWER_MERGE_ABI_VERSION}u;
const ABILITY_METADATA_ABI_VERSION: u32 = ${ABILITY_ENTITY_METADATA_ABI_VERSION}u;
const MAX_SOURCE_COUNT: u32 = ${GPU_TOWER_MERGE_MAX_SOURCE_COUNT}u;
const INVALID_COMPONENT: u32 = ${GPU_TOWER_GROUP_INVALID_COMPONENT}u;
const PLAYER_TEAM_ID: u32 = ${GAMEPLAY_TEAM_ID.PLAYER}u;
const PLAYER_DAMAGEABLE_LAYER: u32 = ${GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE}u;
const BODY_FLAG_ALIVE: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE}u;
const BODY_FLAG_CONTROLLED_THIS_TICK: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.CONTROLLED_THIS_TICK}u;
const MEMBER_FLAG_TOWER_NOUN: u32 = ${GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN}u;
const MEMBER_FLAG_LIVING: u32 = ${GPU_TOWER_GROUP_MEMBER_FLAG.LIVING}u;
const MEMBER_REQUIRED_FLAGS: u32 = MEMBER_FLAG_TOWER_NOUN | MEMBER_FLAG_LIVING;
const ROLE_SURVIVOR: u32 = ${GPU_TOWER_MERGE_RECORD_ROLE.SURVIVOR}u;
const ROLE_CONSUMED: u32 = ${GPU_TOWER_MERGE_RECORD_ROLE.CONSUMED}u;
const STATUS_EMPTY: u32 = ${GPU_TOWER_MERGE_STATUS.EMPTY}u;
const STATUS_SEALED: u32 = ${GPU_TOWER_MERGE_STATUS.SEALED}u;
const STATUS_COMMITTED: u32 = ${GPU_TOWER_MERGE_STATUS.COMMITTED}u;
const STATUS_REJECTED_SOURCE_CHANGED: u32 = ${GPU_TOWER_MERGE_STATUS.REJECTED_SOURCE_CHANGED}u;
const STATUS_PROTOCOL_FAILURE: u32 = ${GPU_TOWER_MERGE_STATUS.PROTOCOL_FAILURE}u;
const ERROR_BODY_ABI_MISMATCH: u32 = ${GPU_TOWER_MERGE_ERROR_FLAG.BODY_ABI_MISMATCH}u;
const ERROR_GROUP_ABI_MISMATCH: u32 = ${GPU_TOWER_MERGE_ERROR_FLAG.GROUP_ABI_MISMATCH}u;
const ERROR_MERGE_ABI_MISMATCH: u32 = ${GPU_TOWER_MERGE_ERROR_FLAG.MERGE_ABI_MISMATCH}u;
const ERROR_PROTOCOL_MISMATCH: u32 = ${GPU_TOWER_MERGE_ERROR_FLAG.PROTOCOL_MISMATCH}u;
const ERROR_PROGRAM_FINGERPRINT_MISMATCH: u32 = ${GPU_TOWER_MERGE_ERROR_FLAG.PROGRAM_FINGERPRINT_MISMATCH}u;
const ERROR_ROSTER_MISMATCH: u32 = ${GPU_TOWER_MERGE_ERROR_FLAG.ROSTER_MISMATCH}u;
const ERROR_RECORD_FINGERPRINT_MISMATCH: u32 = ${GPU_TOWER_MERGE_ERROR_FLAG.RECORD_FINGERPRINT_MISMATCH}u;
const ERROR_SOURCE_CHANGED: u32 = ${GPU_TOWER_MERGE_ERROR_FLAG.SOURCE_CHANGED}u;
const ERROR_SURVIVOR_INVALID: u32 = ${GPU_TOWER_MERGE_ERROR_FLAG.SURVIVOR_INVALID}u;
const ERROR_APPLY_PARTIAL: u32 = ${GPU_TOWER_MERGE_ERROR_FLAG.APPLY_PARTIAL}u;
const HARD_ERROR_MASK: u32 = ERROR_BODY_ABI_MISMATCH
    | ERROR_GROUP_ABI_MISMATCH
    | ERROR_MERGE_ABI_MISMATCH
    | ERROR_PROTOCOL_MISMATCH
    | ERROR_PROGRAM_FINGERPRINT_MISMATCH
    | ERROR_ROSTER_MISMATCH
    | ERROR_RECORD_FINGERPRINT_MISMATCH
    | ERROR_SURVIVOR_INVALID
    | ERROR_APPLY_PARTIAL;
const FNV_OFFSET: u32 = 0x811c9dc5u;
const FNV_PRIME: u32 = 0x01000193u;

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

struct TowerMergeProgram {
    abi_version: u32,
    body_abi_version: u32,
    group_abi_version: u32,
    status: atomic<u32>,
    error_flags: atomic<u32>,
    session_generation: u32,
    device_generation: u32,
    authoritative_epoch: u32,
    source_tick: u32,
    source_count: u32,
    survivor_rank: u32,
    body_capacity: u32,
    source_group_revision: u32,
    target_group_revision: u32,
    source_roster_fingerprint: u32,
    target_roster_fingerprint: u32,
    plan_fingerprint_0: u32,
    plan_fingerprint_1: u32,
    transaction_fingerprint: u32,
    source_identity_fingerprint: u32,
    target_current_hp_fixed_point: u32,
    target_max_hp_fixed_point: u32,
    target_power_fixed_point: u32,
    target_share_units: u32,
    program_fingerprint: u32,
    validated_count: atomic<u32>,
    applied_count: atomic<u32>,
    survivor_entity_id: u32,
    survivor_incarnation: u32,
    live_current_hp_sum: atomic<u32>,
    reserved_1: u32,
    reserved_2: u32,
}

struct TowerMergeRecord {
    slot: u32,
    entity_id: u32,
    incarnation: u32,
    logical_ordinal: u32,
    expected_current_hp_fixed_point: i32,
    source_share_units: u32,
    source_max_hp_fixed_point: u32,
    source_power_fixed_point: u32,
    source_group_revision: u32,
    source_flags: u32,
    source_roster_rank: u32,
    role: u32,
    target_current_hp_fixed_point: u32,
    target_share_units: u32,
    target_max_hp_fixed_point: u32,
    target_power_fixed_point: u32,
    record_fingerprint: u32,
    reserved_0: u32,
    reserved_1: u32,
    reserved_2: u32,
}

struct TowerMergeResult {
    abi_version: u32,
    body_abi_version: u32,
    group_abi_version: u32,
    status: u32,
    error_flags: u32,
    session_generation: u32,
    device_generation: u32,
    authoritative_epoch: u32,
    source_tick: u32,
    source_count: u32,
    survivor_rank: u32,
    validated_count: u32,
    applied_count: u32,
    source_group_revision: u32,
    target_group_revision: u32,
    source_roster_fingerprint: u32,
    target_roster_fingerprint: u32,
    plan_fingerprint_0: u32,
    plan_fingerprint_1: u32,
    transaction_fingerprint: u32,
    source_identity_fingerprint: u32,
    survivor_entity_id: u32,
    survivor_incarnation: u32,
    survivor_slot: u32,
    committed_count: u32,
    consumed_count: u32,
    result_fingerprint: u32,
    target_current_hp_fixed_point: u32,
}

struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct BodyControlBuffer { values: array<BodyControlState> }
struct AbilityMetadataBuffer { values: array<AbilityEntityMetadata> }
struct TowerMemberBuffer { values: array<TowerMemberState> }
struct TowerMergeRecordBuffer { values: array<TowerMergeRecord> }

@group(0) @binding(0) var<storage, read_write> physics: PhysicsBuffer;
@group(0) @binding(1) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(2) var<storage, read_write> body_controls: BodyControlBuffer;
@group(0) @binding(3) var<storage, read_write> ability_metadata: AbilityMetadataBuffer;
@group(0) @binding(4) var<storage, read_write> members: TowerMemberBuffer;
@group(0) @binding(5) var<storage, read_write> roster: TowerRoster;
@group(0) @binding(6) var<storage, read_write> program: TowerMergeProgram;
@group(0) @binding(7) var<storage, read> records: TowerMergeRecordBuffer;
@group(0) @binding(8) var<storage, read_write> result: TowerMergeResult;

fn hash_word(hash: u32, word: u32) -> u32 {
    return (hash ^ word) * FNV_PRIME;
}

fn nonzero_hash(hash: u32) -> u32 {
    return select(hash, 1u, hash == 0u);
}

fn compute_record_fingerprint(record: TowerMergeRecord) -> u32 {
    var hash = FNV_OFFSET;
    hash = hash_word(hash, record.slot);
    hash = hash_word(hash, record.entity_id);
    hash = hash_word(hash, record.incarnation);
    hash = hash_word(hash, record.logical_ordinal);
    hash = hash_word(hash, bitcast<u32>(record.expected_current_hp_fixed_point));
    hash = hash_word(hash, record.source_share_units);
    hash = hash_word(hash, record.source_max_hp_fixed_point);
    hash = hash_word(hash, record.source_power_fixed_point);
    hash = hash_word(hash, record.source_group_revision);
    hash = hash_word(hash, record.source_flags);
    hash = hash_word(hash, record.source_roster_rank);
    hash = hash_word(hash, record.role);
    hash = hash_word(hash, record.target_current_hp_fixed_point);
    hash = hash_word(hash, record.target_share_units);
    hash = hash_word(hash, record.target_max_hp_fixed_point);
    hash = hash_word(hash, record.target_power_fixed_point);
    return nonzero_hash(hash);
}

fn compute_source_identity_fingerprint() -> u32 {
    var hash = FNV_OFFSET;
    var rank = 0u;
    loop {
        if (rank >= program.source_count) { break; }
        let record = records.values[rank];
        hash = hash_word(hash, record.slot);
        hash = hash_word(hash, record.entity_id);
        hash = hash_word(hash, record.incarnation);
        hash = hash_word(hash, record.logical_ordinal);
        hash = hash_word(hash, record.role);
        rank += 1u;
    }
    return nonzero_hash(hash);
}

fn compute_source_roster_fingerprint() -> u32 {
    if (roster.capacity != program.body_capacity
        || roster.capacity != arrayLength(&members.values)
        || roster.capacity != arrayLength(&roster.slots)
        || roster.member_count != program.source_count) {
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
    return nonzero_hash(hash);
}

fn compute_target_roster_fingerprint() -> u32 {
    let survivor = records.values[program.survivor_rank];
    var hash = FNV_OFFSET;
    hash = hash_word(hash, TOWER_GROUP_ABI_VERSION);
    hash = hash_word(hash, program.session_generation);
    hash = hash_word(hash, program.device_generation);
    hash = hash_word(hash, program.authoritative_epoch);
    hash = hash_word(hash, program.target_group_revision);
    hash = hash_word(hash, 1u);
    hash = hash_word(hash, survivor.slot);
    hash = hash_word(hash, survivor.entity_id);
    hash = hash_word(hash, survivor.incarnation);
    hash = hash_word(hash, survivor.logical_ordinal);
    hash = hash_word(hash, survivor.target_share_units);
    hash = hash_word(hash, survivor.target_max_hp_fixed_point);
    hash = hash_word(hash, survivor.target_power_fixed_point);
    hash = hash_word(hash, program.target_group_revision);
    hash = hash_word(hash, MEMBER_REQUIRED_FLAGS);
    hash = hash_word(hash, 0u);
    return nonzero_hash(hash);
}

fn compute_program_fingerprint() -> u32 {
    var hash = FNV_OFFSET;
    hash = hash_word(hash, TOWER_MERGE_ABI_VERSION);
    hash = hash_word(hash, BODY_ABI_VERSION);
    hash = hash_word(hash, TOWER_GROUP_ABI_VERSION);
    hash = hash_word(hash, program.session_generation);
    hash = hash_word(hash, program.device_generation);
    hash = hash_word(hash, program.authoritative_epoch);
    hash = hash_word(hash, program.source_tick);
    hash = hash_word(hash, program.source_count);
    hash = hash_word(hash, program.survivor_rank);
    hash = hash_word(hash, program.body_capacity);
    hash = hash_word(hash, program.source_group_revision);
    hash = hash_word(hash, program.target_group_revision);
    hash = hash_word(hash, program.source_roster_fingerprint);
    hash = hash_word(hash, program.target_roster_fingerprint);
    hash = hash_word(hash, program.plan_fingerprint_0);
    hash = hash_word(hash, program.plan_fingerprint_1);
    hash = hash_word(hash, program.transaction_fingerprint);
    hash = hash_word(hash, program.source_identity_fingerprint);
    hash = hash_word(hash, program.target_current_hp_fixed_point);
    hash = hash_word(hash, program.target_max_hp_fixed_point);
    hash = hash_word(hash, program.target_power_fixed_point);
    hash = hash_word(hash, program.target_share_units);
    var rank = 0u;
    loop {
        if (rank >= program.source_count) { break; }
        hash = hash_word(hash, records.values[rank].record_fingerprint);
        rank += 1u;
    }
    return nonzero_hash(hash);
}

fn compute_result_fingerprint() -> u32 {
    var hash = FNV_OFFSET;
    hash = hash_word(hash, result.abi_version);
    hash = hash_word(hash, result.body_abi_version);
    hash = hash_word(hash, result.group_abi_version);
    hash = hash_word(hash, result.status);
    hash = hash_word(hash, result.error_flags);
    hash = hash_word(hash, result.session_generation);
    hash = hash_word(hash, result.device_generation);
    hash = hash_word(hash, result.authoritative_epoch);
    hash = hash_word(hash, result.source_tick);
    hash = hash_word(hash, result.source_count);
    hash = hash_word(hash, result.survivor_rank);
    hash = hash_word(hash, result.validated_count);
    hash = hash_word(hash, result.applied_count);
    hash = hash_word(hash, result.source_group_revision);
    hash = hash_word(hash, result.target_group_revision);
    hash = hash_word(hash, result.source_roster_fingerprint);
    hash = hash_word(hash, result.target_roster_fingerprint);
    hash = hash_word(hash, result.plan_fingerprint_0);
    hash = hash_word(hash, result.plan_fingerprint_1);
    hash = hash_word(hash, result.transaction_fingerprint);
    hash = hash_word(hash, result.source_identity_fingerprint);
    hash = hash_word(hash, result.survivor_entity_id);
    hash = hash_word(hash, result.survivor_incarnation);
    hash = hash_word(hash, result.survivor_slot);
    hash = hash_word(hash, result.committed_count);
    hash = hash_word(hash, result.consumed_count);
    hash = hash_word(hash, result.target_current_hp_fixed_point);
    return nonzero_hash(hash);
}

fn hard_header_errors() -> u32 {
    var errors = 0u;
    if (program.body_abi_version != BODY_ABI_VERSION) {
        errors |= ERROR_BODY_ABI_MISMATCH;
    }
    if (program.group_abi_version != TOWER_GROUP_ABI_VERSION
        || roster.abi_version != TOWER_GROUP_ABI_VERSION) {
        errors |= ERROR_GROUP_ABI_MISMATCH;
    }
    if (program.abi_version != TOWER_MERGE_ABI_VERSION) {
        errors |= ERROR_MERGE_ABI_MISMATCH;
    }
    if (program.session_generation != roster.session_generation
        || program.device_generation != roster.device_generation
        || program.authoritative_epoch != roster.authoritative_epoch
        || program.source_tick == 0u) {
        errors |= ERROR_PROTOCOL_MISMATCH;
    }
    let capacities_match = program.body_capacity == arrayLength(&physics.values)
        && program.body_capacity == arrayLength(&simulations.values)
        && program.body_capacity == arrayLength(&body_controls.values)
        && program.body_capacity == arrayLength(&ability_metadata.values)
        && program.body_capacity == arrayLength(&members.values)
        && program.body_capacity == arrayLength(&roster.slots);
    if (!capacities_match
        || program.source_count < 2u
        || program.source_count > MAX_SOURCE_COUNT
        || program.source_count > arrayLength(&records.values)
        || program.survivor_rank >= program.source_count
        || program.source_group_revision == 0u
        || program.target_group_revision != program.source_group_revision + 1u
        || program.source_roster_fingerprint == 0u
        || program.target_roster_fingerprint == 0u) {
        errors |= ERROR_MERGE_ABI_MISMATCH;
    }
    if (program.program_fingerprint != compute_program_fingerprint()) {
        errors |= ERROR_PROGRAM_FINGERPRINT_MISMATCH;
    }
    if (roster.group_revision != program.source_group_revision
        || roster.fingerprint != program.source_roster_fingerprint
        || roster.fingerprint != compute_source_roster_fingerprint()
        || program.target_roster_fingerprint
            != compute_target_roster_fingerprint()) {
        errors |= ERROR_ROSTER_MISMATCH;
    }
    if (program.source_identity_fingerprint
        != compute_source_identity_fingerprint()) {
        errors |= ERROR_PROGRAM_FINGERPRINT_MISMATCH;
    }
    let survivor = records.values[program.survivor_rank];
    if (survivor.role != ROLE_SURVIVOR
        || survivor.entity_id != program.survivor_entity_id
        || survivor.incarnation != program.survivor_incarnation
        || survivor.target_current_hp_fixed_point
            != program.target_current_hp_fixed_point
        || survivor.target_max_hp_fixed_point
            != program.target_max_hp_fixed_point
        || survivor.target_power_fixed_point != program.target_power_fixed_point
        || survivor.target_share_units != program.target_share_units
        || survivor.target_current_hp_fixed_point == 0u
        || survivor.target_current_hp_fixed_point
            > survivor.target_max_hp_fixed_point
        || survivor.target_share_units == 0u
        || survivor.target_max_hp_fixed_point == 0u) {
        errors |= ERROR_SURVIVOR_INVALID;
    }
    return errors;
}

@compute @workgroup_size(1)
fn clear_merge() {
    atomicStore(&program.status, STATUS_EMPTY);
    atomicStore(&program.error_flags, 0u);
    atomicStore(&program.validated_count, 0u);
    atomicStore(&program.applied_count, 0u);
    atomicStore(&program.live_current_hp_sum, 0u);
    result = TowerMergeResult(
        0u, 0u, 0u, STATUS_EMPTY, 0u,
        0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u,
        0u, 0u, 0u, 0u, 0u, 0u, 0u, INVALID_COMPONENT,
        INVALID_COMPONENT, INVALID_COMPONENT, 0u, 0u, 0u, 0u
    );
    let errors = hard_header_errors();
    if (errors != 0u) {
        atomicOr(&program.error_flags, errors);
    }
}

@compute @workgroup_size(${GPU_TOWER_MERGE_WORKGROUP_SIZE})
fn validate_sources(@builtin(global_invocation_id) global_id: vec3u) {
    let rank = global_id.x;
    if (rank >= program.source_count) { return; }
    let record = records.values[rank];
    if (record.record_fingerprint != compute_record_fingerprint(record)
        || record.reserved_0 != 0u
        || record.reserved_1 != 0u
        || record.reserved_2 != 0u) {
        atomicOr(
            &program.error_flags,
            ERROR_RECORD_FINGERPRINT_MISMATCH
        );
        return;
    }
    let role_valid = (rank == program.survivor_rank
            && record.role == ROLE_SURVIVOR)
        || (rank != program.survivor_rank
            && record.role == ROLE_CONSUMED);
    let target_valid = record.role == ROLE_SURVIVOR
        || (record.target_current_hp_fixed_point == 0u
            && record.target_share_units == 0u
            && record.target_max_hp_fixed_point == 0u
            && record.target_power_fixed_point == 0u);
    if (record.slot >= program.body_capacity
        || record.source_roster_rank != rank
        || roster.slots[rank] != record.slot
        || !role_valid
        || !target_valid) {
        atomicOr(&program.error_flags, ERROR_SOURCE_CHANGED);
        return;
    }
    let member = members.values[record.slot];
    let physical = physics.values[record.slot];
    let metadata = ability_metadata.values[record.slot];
    let live_current_hp = atomicLoad(&simulations.values[record.slot].health);
    let member_matches = member.entity_id == record.entity_id
        && member.incarnation == record.incarnation
        && member.logical_ordinal == record.logical_ordinal
        && member.share_units == record.source_share_units
        && member.max_hp_fixed_point == record.source_max_hp_fixed_point
        && member.power_fixed_point == record.source_power_fixed_point
        && member.group_revision == record.source_group_revision
        && member.flags == record.source_flags
        && member.roster_rank == rank
        && member.reserved == 0u
        && (member.flags & MEMBER_REQUIRED_FLAGS) == MEMBER_REQUIRED_FLAGS;
    let body_matches = simulations.values[record.slot].entity_id
            == record.entity_id
        && simulations.values[record.slot].incarnation == record.incarnation
        && live_current_hp > 0
        && live_current_hp <= record.expected_current_hp_fixed_point
        && record.expected_current_hp_fixed_point > 0
        && (atomicLoad(&simulations.values[record.slot].flags)
            & BODY_FLAG_ALIVE) != 0u
        && (simulations.values[record.slot].gameplay_meta & 0xffu)
            == PLAYER_TEAM_ID
        && (physical.interaction_meta & 0xffffu) == PLAYER_DAMAGEABLE_LAYER;
    let metadata_matches = metadata.abi_version == 0u
        || (metadata.abi_version == ABILITY_METADATA_ABI_VERSION
            && metadata.owner_entity_id == record.entity_id
            && metadata.owner_incarnation == record.incarnation
            && metadata.power_fixed_point == record.source_power_fixed_point);
    if (!member_matches || !body_matches || !metadata_matches) {
        atomicOr(&program.error_flags, ERROR_SOURCE_CHANGED);
        return;
    }
    atomicAdd(&program.live_current_hp_sum, u32(live_current_hp));
    atomicAdd(&program.validated_count, 1u);
}

@compute @workgroup_size(1)
fn seal_merge() {
    let errors = atomicLoad(&program.error_flags);
    let validated = atomicLoad(&program.validated_count);
    let live_current_hp_sum = atomicLoad(&program.live_current_hp_sum);
    if ((errors & HARD_ERROR_MASK) != 0u) {
        atomicStore(&program.status, STATUS_PROTOCOL_FAILURE);
        return;
    }
    if ((errors & ERROR_SOURCE_CHANGED) != 0u
        || validated != program.source_count
        || live_current_hp_sum == 0u
        || live_current_hp_sum > program.target_current_hp_fixed_point
        || live_current_hp_sum > program.target_max_hp_fixed_point) {
        atomicOr(&program.error_flags, ERROR_SOURCE_CHANGED);
        atomicStore(&program.status, STATUS_REJECTED_SOURCE_CHANGED);
        return;
    }
    atomicStore(&program.status, STATUS_SEALED);
}

@compute @workgroup_size(${GPU_TOWER_MERGE_WORKGROUP_SIZE})
fn apply_merge(@builtin(global_invocation_id) global_id: vec3u) {
    let rank = global_id.x;
    if (rank >= program.source_count
        || atomicLoad(&program.status) != STATUS_SEALED) {
        return;
    }
    let record = records.values[rank];
    let slot = record.slot;
    roster.slots[rank] = INVALID_COMPONENT;
    if (record.role == ROLE_SURVIVOR) {
        atomicStore(
            &simulations.values[slot].health,
            bitcast<i32>(atomicLoad(&program.live_current_hp_sum))
        );
        members.values[slot] = TowerMemberState(
            record.entity_id,
            record.incarnation,
            record.logical_ordinal,
            record.target_share_units,
            record.target_max_hp_fixed_point,
            record.target_power_fixed_point,
            program.target_group_revision,
            MEMBER_REQUIRED_FLAGS,
            0u,
            0u
        );
        if (ability_metadata.values[slot].abi_version != 0u) {
            ability_metadata.values[slot].power_fixed_point
                = record.target_power_fixed_point;
        }
    } else {
        atomicAnd(
            &simulations.values[slot].flags,
            ~(BODY_FLAG_ALIVE | BODY_FLAG_CONTROLLED_THIS_TICK)
        );
        physics.values[slot].physical_meta = 0u;
        physics.values[slot].interaction_meta = 0u;
        body_controls.values[slot] = BodyControlState(
            vec2f(0.0), 0u, 0u, 0u, 0u, 0u, 0u, 0u,
            INVALID_COMPONENT, INVALID_COMPONENT, INVALID_COMPONENT,
            0u, 0u, 0.0, 0u
        );
        ability_metadata.values[slot] = AbilityEntityMetadata(
            0u, 0u, 0u, 0u, 0u, 0u,
            0u, 0u, 0u, 0u, 0u, 0u
        );
        members.values[slot] = TowerMemberState(
            0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u
        );
    }
    atomicAdd(&program.applied_count, 1u);
}

@compute @workgroup_size(1)
fn finalize_merge() {
    var status = atomicLoad(&program.status);
    let validated = atomicLoad(&program.validated_count);
    let applied = atomicLoad(&program.applied_count);
    var errors = atomicLoad(&program.error_flags);
    let survivor = records.values[program.survivor_rank];
    var committed_count = 0u;
    var consumed_count = 0u;
    if (status == STATUS_SEALED) {
        if (validated == program.source_count
            && applied == program.source_count) {
            roster.abi_version = TOWER_GROUP_ABI_VERSION;
            roster.member_count = 1u;
            roster.capacity = program.body_capacity;
            roster.fingerprint = program.target_roster_fingerprint;
            roster.group_revision = program.target_group_revision;
            roster.session_generation = program.session_generation;
            roster.device_generation = program.device_generation;
            roster.authoritative_epoch = program.authoritative_epoch;
            roster.slots[0] = survivor.slot;
            status = STATUS_COMMITTED;
            committed_count = 1u;
            consumed_count = program.source_count - 1u;
            atomicStore(&program.status, status);
        } else {
            errors |= ERROR_APPLY_PARTIAL;
            atomicOr(&program.error_flags, ERROR_APPLY_PARTIAL);
            status = STATUS_PROTOCOL_FAILURE;
            atomicStore(&program.status, status);
        }
    } else if (status == STATUS_REJECTED_SOURCE_CHANGED) {
        if (applied != 0u) {
            errors |= ERROR_APPLY_PARTIAL;
            atomicOr(&program.error_flags, ERROR_APPLY_PARTIAL);
            status = STATUS_PROTOCOL_FAILURE;
            atomicStore(&program.status, status);
        }
    } else if (status != STATUS_PROTOCOL_FAILURE) {
        errors |= ERROR_MERGE_ABI_MISMATCH;
        atomicOr(&program.error_flags, ERROR_MERGE_ABI_MISMATCH);
        status = STATUS_PROTOCOL_FAILURE;
        atomicStore(&program.status, status);
    }
    result.abi_version = TOWER_MERGE_ABI_VERSION;
    result.body_abi_version = BODY_ABI_VERSION;
    result.group_abi_version = TOWER_GROUP_ABI_VERSION;
    result.status = status;
    result.error_flags = atomicLoad(&program.error_flags);
    result.session_generation = program.session_generation;
    result.device_generation = program.device_generation;
    result.authoritative_epoch = program.authoritative_epoch;
    result.source_tick = program.source_tick;
    result.source_count = program.source_count;
    result.survivor_rank = program.survivor_rank;
    result.validated_count = validated;
    result.applied_count = applied;
    result.source_group_revision = program.source_group_revision;
    result.target_group_revision = program.target_group_revision;
    result.source_roster_fingerprint = program.source_roster_fingerprint;
    result.target_roster_fingerprint = program.target_roster_fingerprint;
    result.plan_fingerprint_0 = program.plan_fingerprint_0;
    result.plan_fingerprint_1 = program.plan_fingerprint_1;
    result.transaction_fingerprint = program.transaction_fingerprint;
    result.source_identity_fingerprint = program.source_identity_fingerprint;
    result.survivor_entity_id = program.survivor_entity_id;
    result.survivor_incarnation = program.survivor_incarnation;
    result.survivor_slot = survivor.slot;
    result.committed_count = committed_count;
    result.consumed_count = consumed_count;
    result.target_current_hp_fixed_point
        = atomicLoad(&program.live_current_hp_sum);
    result.result_fingerprint = compute_result_fingerprint();
}
`;
