import {
    ABILITY_CREATION_ORIGIN_CODE,
    ABILITY_ENTITY_METADATA_ABI_VERSION
} from '../../contract/ability_execution_contract.js';
import { GAMEPLAY_NOUN_MASK } from '../../contract/word_sentence_contract.js';
import { GAMEPLAY_TEAM_ID } from '../../contract/gameplay_team_contract.js';
import {
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_SIMULATION_FLAG
} from './gpu_circle_body_abi.js';
import {
    GPU_TOWER_CREATION_ABI_VERSION,
    GPU_TOWER_CREATION_ERROR_FLAG,
    GPU_TOWER_CREATION_RECORD_KIND,
    GPU_TOWER_CREATION_STATUS
} from './gpu_tower_creation_abi.js';
import {
    GPU_TOWER_GROUP_ABI_VERSION,
    GPU_TOWER_GROUP_MEMBER_FLAG
} from './gpu_tower_group_abi.js';

export const GPU_TOWER_CREATION_WORKGROUP_SIZE = 64;

export const GPU_TOWER_CREATION_WGSL = /* wgsl */`
const BODY_ABI_VERSION: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;
const GROUP_ABI_VERSION: u32 = ${GPU_TOWER_GROUP_ABI_VERSION}u;
const CREATION_ABI_VERSION: u32 = ${GPU_TOWER_CREATION_ABI_VERSION}u;
const ABILITY_METADATA_ABI_VERSION: u32 = ${ABILITY_ENTITY_METADATA_ABI_VERSION}u;
const RECORD_EXISTING: u32 = ${GPU_TOWER_CREATION_RECORD_KIND.EXISTING}u;
const RECORD_CHILD: u32 = ${GPU_TOWER_CREATION_RECORD_KIND.CHILD}u;
const STATUS_PENDING: u32 = ${GPU_TOWER_CREATION_STATUS.PENDING}u;
const STATUS_COMMITTED: u32 = ${GPU_TOWER_CREATION_STATUS.COMMITTED}u;
const STATUS_REJECTED_SOURCE_CHANGED: u32 = ${GPU_TOWER_CREATION_STATUS.REJECTED_SOURCE_CHANGED}u;
const STATUS_PROTOCOL_FAILURE: u32 = ${GPU_TOWER_CREATION_STATUS.PROTOCOL_FAILURE}u;
const STATUS_READY_TO_APPLY: u32 = ${GPU_TOWER_CREATION_STATUS.READY_TO_APPLY}u;
const ERROR_BODY_ABI_MISMATCH: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.BODY_ABI_MISMATCH}u;
const ERROR_GROUP_ABI_MISMATCH: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.GROUP_ABI_MISMATCH}u;
const ERROR_PROTOCOL_MISMATCH: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.PROTOCOL_MISMATCH}u;
const ERROR_PROGRAM_INVALID: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.PROGRAM_INVALID}u;
const ERROR_SOURCE_ROSTER_CHANGED: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.SOURCE_ROSTER_CHANGED}u;
const ERROR_SOURCE_BODY_CHANGED: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.SOURCE_BODY_CHANGED}u;
const ERROR_DESTINATION_CHANGED: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.DESTINATION_CHANGED}u;
const ERROR_ABILITY_METADATA_CHANGED: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.ABILITY_METADATA_CHANGED}u;
const ERROR_TARGET_FINGERPRINT_INVALID: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.TARGET_FINGERPRINT_INVALID}u;
const ERROR_PARTIAL_APPLY: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.PARTIAL_APPLY}u;
const HARD_FAILURE_MASK: u32 = ERROR_BODY_ABI_MISMATCH
    | ERROR_GROUP_ABI_MISMATCH
    | ERROR_PROTOCOL_MISMATCH
    | ERROR_PROGRAM_INVALID
    | ERROR_TARGET_FINGERPRINT_INVALID
    | ERROR_PARTIAL_APPLY;
const BODY_FLAG_ALIVE: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE}u;
const PLAYER_TEAM_ID: u32 = ${GAMEPLAY_TEAM_ID.PLAYER}u;
const PLAYER_DAMAGEABLE_LAYER: u32 = ${GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE}u;
const MEMBER_FLAGS: u32 = ${GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
    | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING}u;
const TOWER_NOUN_MASK: u32 = ${GAMEPLAY_NOUN_MASK.TOWER}u;
const NATURAL_CREATION_ORIGIN: u32 = ${ABILITY_CREATION_ORIGIN_CODE.NATURAL}u;
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

struct AbilityMetadata {
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

struct TowerCreationProgram {
    abi_version: u32,
    body_abi_version: u32,
    group_abi_version: u32,
    session_generation: u32,
    device_generation: u32,
    authoritative_epoch: u32,
    source_tick: u32,
    transaction_fingerprint: u32,
    record_count: u32,
    existing_count: u32,
    child_count: u32,
    body_capacity: u32,
    source_group_revision: u32,
    target_group_revision: u32,
    source_roster_fingerprint: u32,
    target_roster_fingerprint: u32,
    tower_definition_code: u32,
    ability_metadata_abi_version: u32,
    roster_capacity: u32,
    record_fingerprint: u32,
}

struct TowerCreationRecord {
    kind: u32,
    slot: u32,
    entity_id: u32,
    incarnation: u32,
    logical_ordinal: u32,
    source_current_hp_fixed_point: u32,
    target_current_hp_fixed_point: u32,
    source_share_units: u32,
    target_share_units: u32,
    source_max_hp_fixed_point: u32,
    target_max_hp_fixed_point: u32,
    source_power_fixed_point: u32,
    target_power_fixed_point: u32,
    source_group_revision: u32,
    target_group_revision: u32,
    roster_rank: u32,
}

struct TowerCreationResult {
    abi_version: u32,
    status: atomic<u32>,
    error_flags: atomic<u32>,
    session_generation: u32,
    device_generation: u32,
    authoritative_epoch: u32,
    source_tick: u32,
    transaction_fingerprint: u32,
    record_count: u32,
    validated_count: atomic<u32>,
    applied_count: atomic<u32>,
    created_count: atomic<u32>,
    source_group_revision: u32,
    target_group_revision: u32,
    target_roster_fingerprint: u32,
    result_fingerprint: u32,
}

struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct AbilityMetadataBuffer { values: array<AbilityMetadata> }
struct TowerMemberBuffer { values: array<TowerMemberState> }
struct CreationRecordBuffer { values: array<TowerCreationRecord> }

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(3) var<storage, read_write> ability_metadata: AbilityMetadataBuffer;
@group(0) @binding(4) var<storage, read_write> members: TowerMemberBuffer;
@group(0) @binding(5) var<storage, read_write> roster: TowerRoster;
@group(0) @binding(6) var<storage, read> program: TowerCreationProgram;
@group(0) @binding(7) var<storage, read> records: CreationRecordBuffer;
@group(0) @binding(8) var<storage, read_write> result: TowerCreationResult;

fn hash_word(hash: u32, word: u32) -> u32 {
    return (hash ^ word) * FNV_PRIME;
}

fn non_zero_hash(hash: u32) -> u32 {
    return select(hash, 1u, hash == 0u);
}

fn compute_source_roster_fingerprint() -> u32 {
    if (roster.capacity != arrayLength(&members.values)
        || roster.capacity != arrayLength(&roster.slots)
        || roster.member_count > roster.capacity) {
        return 0u;
    }
    var hash = FNV_OFFSET;
    hash = hash_word(hash, GROUP_ABI_VERSION);
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
    return non_zero_hash(hash);
}

fn compute_record_fingerprint() -> u32 {
    if (program.record_count == 0u
        || program.record_count > arrayLength(&records.values)) {
        return 0u;
    }
    var hash = FNV_OFFSET;
    hash = hash_word(hash, CREATION_ABI_VERSION);
    hash = hash_word(hash, program.record_count);
    var index = 0u;
    loop {
        if (index >= program.record_count) { break; }
        let record = records.values[index];
        hash = hash_word(hash, record.kind);
        hash = hash_word(hash, record.slot);
        hash = hash_word(hash, record.entity_id);
        hash = hash_word(hash, record.incarnation);
        hash = hash_word(hash, record.logical_ordinal);
        hash = hash_word(hash, record.source_current_hp_fixed_point);
        hash = hash_word(hash, record.target_current_hp_fixed_point);
        hash = hash_word(hash, record.source_share_units);
        hash = hash_word(hash, record.target_share_units);
        hash = hash_word(hash, record.source_max_hp_fixed_point);
        hash = hash_word(hash, record.target_max_hp_fixed_point);
        hash = hash_word(hash, record.source_power_fixed_point);
        hash = hash_word(hash, record.target_power_fixed_point);
        hash = hash_word(hash, record.source_group_revision);
        hash = hash_word(hash, record.target_group_revision);
        hash = hash_word(hash, record.roster_rank);
        index += 1u;
    }
    return non_zero_hash(hash);
}

fn compute_target_roster_fingerprint() -> u32 {
    if (program.record_count == 0u
        || program.record_count > arrayLength(&records.values)) {
        return 0u;
    }
    var hash = FNV_OFFSET;
    hash = hash_word(hash, GROUP_ABI_VERSION);
    hash = hash_word(hash, program.session_generation);
    hash = hash_word(hash, program.device_generation);
    hash = hash_word(hash, program.authoritative_epoch);
    hash = hash_word(hash, program.target_group_revision);
    hash = hash_word(hash, program.record_count);
    var index = 0u;
    loop {
        if (index >= program.record_count) { break; }
        let record = records.values[index];
        hash = hash_word(hash, record.slot);
        hash = hash_word(hash, record.entity_id);
        hash = hash_word(hash, record.incarnation);
        hash = hash_word(hash, record.logical_ordinal);
        hash = hash_word(hash, record.target_share_units);
        hash = hash_word(hash, record.target_max_hp_fixed_point);
        hash = hash_word(hash, record.target_power_fixed_point);
        hash = hash_word(hash, program.target_group_revision);
        hash = hash_word(hash, MEMBER_FLAGS);
        hash = hash_word(hash, index);
        index += 1u;
    }
    return non_zero_hash(hash);
}

fn result_fingerprint(status: u32, error_flags: u32) -> u32 {
    var hash = FNV_OFFSET;
    hash = hash_word(hash, CREATION_ABI_VERSION);
    hash = hash_word(hash, status);
    hash = hash_word(hash, error_flags);
    hash = hash_word(hash, result.session_generation);
    hash = hash_word(hash, result.device_generation);
    hash = hash_word(hash, result.authoritative_epoch);
    hash = hash_word(hash, result.source_tick);
    hash = hash_word(hash, result.transaction_fingerprint);
    hash = hash_word(hash, result.record_count);
    hash = hash_word(hash, atomicLoad(&result.validated_count));
    hash = hash_word(hash, atomicLoad(&result.applied_count));
    hash = hash_word(hash, atomicLoad(&result.created_count));
    hash = hash_word(hash, result.source_group_revision);
    hash = hash_word(hash, result.target_group_revision);
    hash = hash_word(hash, result.target_roster_fingerprint);
    return non_zero_hash(hash);
}

fn metadata_is_zero(metadata: AbilityMetadata) -> bool {
    return metadata.abi_version == 0u
        && metadata.noun_mask == 0u
        && metadata.definition_code == 0u
        && metadata.owner_entity_id == 0u
        && metadata.owner_incarnation == 0u
        && metadata.source_ability_code == 0u
        && metadata.source_execution_fingerprint == 0u
        && metadata.source_execution_ordinal == 0u
        && metadata.generation == 0u
        && metadata.visible_from_execution_ordinal == 0u
        && metadata.creation_origin_code == 0u
        && metadata.power_fixed_point == 0u;
}

fn validate_program_header() -> u32 {
    var errors = 0u;
    if (counts.abi_version != BODY_ABI_VERSION
        || program.body_abi_version != BODY_ABI_VERSION) {
        errors |= ERROR_BODY_ABI_MISMATCH;
    }
    if (program.group_abi_version != GROUP_ABI_VERSION
        || roster.abi_version != GROUP_ABI_VERSION) {
        errors |= ERROR_GROUP_ABI_MISMATCH;
    }
    if (program.abi_version != CREATION_ABI_VERSION
        || program.ability_metadata_abi_version
            != ABILITY_METADATA_ABI_VERSION
        || program.record_fingerprint == 0u
        || program.transaction_fingerprint == 0u
        || program.source_tick == 0u) {
        errors |= ERROR_PROGRAM_INVALID;
    }
    if (program.session_generation != roster.session_generation
        || program.device_generation != roster.device_generation
        || program.authoritative_epoch != roster.authoritative_epoch) {
        errors |= ERROR_PROTOCOL_MISMATCH;
    }
    if (program.body_capacity != arrayLength(&simulations.values)
        || program.body_capacity != arrayLength(&physics.values)
        || program.body_capacity != arrayLength(&ability_metadata.values)
        || program.body_capacity != arrayLength(&members.values)
        || program.roster_capacity != arrayLength(&roster.slots)
        || program.roster_capacity != roster.capacity
        || program.record_count == 0u
        || program.record_count > arrayLength(&records.values)
        || program.record_count > program.roster_capacity
        || program.existing_count == 0u
        || program.child_count == 0u
        || program.existing_count + program.child_count
            != program.record_count
        || program.target_group_revision
            != program.source_group_revision + 1u) {
        errors |= ERROR_PROGRAM_INVALID;
    }
    let record_fingerprint = compute_record_fingerprint();
    if (record_fingerprint == 0u
        || record_fingerprint != program.record_fingerprint) {
        errors |= ERROR_PROGRAM_INVALID;
    }
    let source_fingerprint = compute_source_roster_fingerprint();
    if (roster.member_count != program.existing_count
        || roster.group_revision != program.source_group_revision
        || roster.fingerprint != program.source_roster_fingerprint
        || source_fingerprint == 0u
        || source_fingerprint != program.source_roster_fingerprint) {
        errors |= ERROR_SOURCE_ROSTER_CHANGED;
    }
    let target_fingerprint = compute_target_roster_fingerprint();
    if (program.target_roster_fingerprint == 0u
        || program.target_roster_fingerprint
            == program.source_roster_fingerprint
        || target_fingerprint == 0u
        || target_fingerprint != program.target_roster_fingerprint) {
        errors |= ERROR_TARGET_FINGERPRINT_INVALID;
    }
    return errors;
}

@compute @workgroup_size(1)
fn clear_creation() {
    result.abi_version = CREATION_ABI_VERSION;
    atomicStore(&result.status, STATUS_PENDING);
    atomicStore(&result.error_flags, 0u);
    result.session_generation = program.session_generation;
    result.device_generation = program.device_generation;
    result.authoritative_epoch = program.authoritative_epoch;
    result.source_tick = program.source_tick;
    result.transaction_fingerprint = program.transaction_fingerprint;
    result.record_count = program.record_count;
    atomicStore(&result.validated_count, 0u);
    atomicStore(&result.applied_count, 0u);
    atomicStore(&result.created_count, 0u);
    result.source_group_revision = program.source_group_revision;
    result.target_group_revision = program.target_group_revision;
    result.target_roster_fingerprint = program.target_roster_fingerprint;
    result.result_fingerprint = 0u;
}

@compute @workgroup_size(${GPU_TOWER_CREATION_WORKGROUP_SIZE})
fn validate_creation(@builtin(global_invocation_id) invocation: vec3u) {
    let index = invocation.x;
    if (index == 0u) {
        atomicOr(&result.error_flags, validate_program_header());
    }
    if (index >= program.record_count) { return; }
    let record = records.values[index];
    var errors = 0u;
    if (record.slot >= counts.body_count
        || record.slot >= program.body_capacity
        || record.entity_id == 0u
        || record.incarnation == 0u
        || record.logical_ordinal == 0u
        || record.target_current_hp_fixed_point == 0u
        || record.target_share_units == 0u
        || record.target_max_hp_fixed_point == 0u
        || record.target_group_revision != program.target_group_revision
        || record.roster_rank != index) {
        errors |= ERROR_PROGRAM_INVALID;
    } else {
        let simulation = &simulations.values[record.slot];
        let metadata = ability_metadata.values[record.slot];
        let member = members.values[record.slot];
        let team_id = simulation.gameplay_meta & 0xffu;
        let interaction_layer = physics.values[record.slot].interaction_meta
            & 0xffffu;
        let exact_body = simulation.entity_id == record.entity_id
            && simulation.incarnation == record.incarnation
            && team_id == PLAYER_TEAM_ID
            && interaction_layer == PLAYER_DAMAGEABLE_LAYER;
        if (record.kind == RECORD_EXISTING) {
            if (index >= program.existing_count
                || roster.slots[index] != record.slot
                || record.source_group_revision
                    != program.source_group_revision
                || record.source_current_hp_fixed_point == 0u
                || record.source_share_units == 0u
                || record.source_max_hp_fixed_point == 0u
                || !exact_body
                || (atomicLoad(&simulation.flags) & BODY_FLAG_ALIVE) == 0u
                || bitcast<u32>(atomicLoad(&simulation.health))
                    != record.source_current_hp_fixed_point
                || member.entity_id != record.entity_id
                || member.incarnation != record.incarnation
                || member.logical_ordinal != record.logical_ordinal
                || member.share_units != record.source_share_units
                || member.max_hp_fixed_point
                    != record.source_max_hp_fixed_point
                || member.power_fixed_point
                    != record.source_power_fixed_point
                || member.group_revision
                    != program.source_group_revision
                || member.flags != MEMBER_FLAGS
                || member.roster_rank != index
                || member.reserved != 0u) {
                errors |= ERROR_SOURCE_BODY_CHANGED;
            }
            if (metadata.abi_version != ABILITY_METADATA_ABI_VERSION
                || (metadata.noun_mask & TOWER_NOUN_MASK)
                    != TOWER_NOUN_MASK
                || metadata.power_fixed_point
                    != record.source_power_fixed_point) {
                errors |= ERROR_ABILITY_METADATA_CHANGED;
            }
        } else if (record.kind == RECORD_CHILD) {
            if (index < program.existing_count
                || record.source_current_hp_fixed_point != 0u
                || record.source_share_units != 0u
                || record.source_max_hp_fixed_point != 0u
                || record.source_power_fixed_point != 0u
                || record.source_group_revision != 0u
                || !exact_body
                || (atomicLoad(&simulation.flags) & BODY_FLAG_ALIVE) != 0u
                || bitcast<u32>(atomicLoad(&simulation.health))
                    != record.target_current_hp_fixed_point
                || member.entity_id != 0u
                || member.incarnation != 0u
                || member.logical_ordinal != 0u
                || member.share_units != 0u
                || member.max_hp_fixed_point != 0u
                || member.power_fixed_point != 0u
                || member.group_revision != 0u
                || member.flags != 0u
                || member.roster_rank != 0u
                || member.reserved != 0u) {
                errors |= ERROR_DESTINATION_CHANGED;
            }
            if (!metadata_is_zero(metadata)) {
                errors |= ERROR_ABILITY_METADATA_CHANGED;
            }
        } else {
            errors |= ERROR_PROGRAM_INVALID;
        }
    }
    if (errors == 0u) {
        atomicAdd(&result.validated_count, 1u);
    } else {
        atomicOr(&result.error_flags, errors);
    }
}

@compute @workgroup_size(1)
fn seal_creation() {
    let errors = atomicLoad(&result.error_flags);
    if (errors == 0u
        && atomicLoad(&result.validated_count) == program.record_count) {
        atomicStore(&result.status, STATUS_READY_TO_APPLY);
    } else if ((errors & HARD_FAILURE_MASK) != 0u) {
        atomicStore(&result.status, STATUS_PROTOCOL_FAILURE);
    } else {
        atomicStore(&result.status, STATUS_REJECTED_SOURCE_CHANGED);
    }
}

@compute @workgroup_size(${GPU_TOWER_CREATION_WORKGROUP_SIZE})
fn apply_creation(@builtin(global_invocation_id) invocation: vec3u) {
    let index = invocation.x;
    if (index >= program.record_count
        || atomicLoad(&result.status) != STATUS_READY_TO_APPLY) {
        return;
    }
    let record = records.values[index];
    atomicStore(
        &simulations.values[record.slot].health,
        bitcast<i32>(record.target_current_hp_fixed_point)
    );
    members.values[record.slot] = TowerMemberState(
        record.entity_id,
        record.incarnation,
        record.logical_ordinal,
        record.target_share_units,
        record.target_max_hp_fixed_point,
        record.target_power_fixed_point,
        program.target_group_revision,
        MEMBER_FLAGS,
        index,
        0u
    );
    if (record.kind == RECORD_EXISTING) {
        ability_metadata.values[record.slot].power_fixed_point
            = record.target_power_fixed_point;
    } else {
        ability_metadata.values[record.slot] = AbilityMetadata(
            ABILITY_METADATA_ABI_VERSION,
            TOWER_NOUN_MASK,
            program.tower_definition_code,
            0u,
            0u,
            0u,
            0u,
            0u,
            0u,
            0u,
            NATURAL_CREATION_ORIGIN,
            record.target_power_fixed_point
        );
    }
    atomicAdd(&result.applied_count, 1u);
}

@compute @workgroup_size(${GPU_TOWER_CREATION_WORKGROUP_SIZE})
fn publish_creation_children(@builtin(global_invocation_id) invocation: vec3u) {
    let child_index = invocation.x;
    if (child_index >= program.child_count
        || atomicLoad(&result.status) != STATUS_READY_TO_APPLY) {
        return;
    }
    let record_index = program.existing_count + child_index;
    let record = records.values[record_index];
    atomicOr(&simulations.values[record.slot].flags, BODY_FLAG_ALIVE);
    atomicAdd(&result.created_count, 1u);
}

@compute @workgroup_size(1)
fn finalize_creation() {
    if (atomicLoad(&result.status) == STATUS_READY_TO_APPLY) {
        if (atomicLoad(&result.applied_count) != program.record_count
            || atomicLoad(&result.created_count) != program.child_count) {
            atomicOr(&result.error_flags, ERROR_PARTIAL_APPLY);
            atomicStore(&result.status, STATUS_PROTOCOL_FAILURE);
        } else {
            var index = 0u;
            loop {
                if (index >= program.record_count) { break; }
                roster.slots[index] = records.values[index].slot;
                index += 1u;
            }
            roster.abi_version = GROUP_ABI_VERSION;
            roster.member_count = program.record_count;
            roster.capacity = program.roster_capacity;
            roster.fingerprint = program.target_roster_fingerprint;
            roster.group_revision = program.target_group_revision;
            roster.session_generation = program.session_generation;
            roster.device_generation = program.device_generation;
            roster.authoritative_epoch = program.authoritative_epoch;
            atomicStore(&result.status, STATUS_COMMITTED);
        }
    }
    let status = atomicLoad(&result.status);
    let errors = atomicLoad(&result.error_flags);
    result.result_fingerprint = result_fingerprint(status, errors);
}
`;
