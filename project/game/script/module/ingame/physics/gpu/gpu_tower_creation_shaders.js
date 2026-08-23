import {
    ABILITY_CREATION_ORIGIN_CODE,
    ABILITY_ENTITY_METADATA_ABI_VERSION
} from '../../contract/ability_execution_contract.js';
import {
    ACTOR_PAYLOAD_CODE,
    GAMEPLAY_NOUN_MASK,
    SENTENCE_ACTION_CODE
} from '../../contract/word_sentence_contract.js';
import { GAMEPLAY_TEAM_ID } from '../../contract/gameplay_team_contract.js';
import {
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_SIMULATION_FLAG
} from './gpu_circle_body_abi.js';
import {
    GPU_TOWER_CREATION_ABI,
    GPU_TOWER_CREATION_ABI_VERSION,
    GPU_TOWER_CREATION_ERROR_FLAG,
    GPU_TOWER_CREATION_METADATA_COMMIT_ABI_VERSION,
    GPU_TOWER_CREATION_MODE,
    GPU_TOWER_CREATION_RECORD_KIND,
    GPU_TOWER_CREATION_STATUS
} from './gpu_tower_creation_abi.js';
import {
    GPU_ACTOR_ACTION_PLACEMENT_ABI,
    GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION,
    GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS,
    GPU_ACTOR_ACTION_PLACEMENT_STATUS,
    GPU_ACTOR_ACTION_TRANSIT_FLAG,
    GPU_ACTOR_ACTION_TRANSIT_PHASE
} from './gpu_actor_action_placement_abi.js';
import {
    GPU_ACTOR_TRANSIT_ABI,
    GPU_ACTOR_TRANSIT_ABI_VERSION,
    GPU_ACTOR_TRANSIT_PHASE
} from './gpu_actor_transit_abi.js';
import {
    GPU_TOWER_GROUP_ABI_VERSION,
    GPU_TOWER_GROUP_MEMBER_FLAG
} from './gpu_tower_group_abi.js';

export const GPU_TOWER_CREATION_WORKGROUP_SIZE = 64;

const ACTOR_TRANSIT_RECORD_WORDS = GPU_ACTOR_TRANSIT_ABI.RECORD.STRIDE / 4;
const ACTOR_ACTION_ALL_TRANSIT_FLAGS = Object.values(
    GPU_ACTOR_ACTION_TRANSIT_FLAG
).reduce((mask, value) => mask | value, 0);
const TR = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_TRANSIT_ABI.RECORD)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));

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
const ERROR_ACTOR_ACTION_PLACEMENT_INVALID: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.ACTOR_ACTION_PLACEMENT_INVALID}u;
const ERROR_METADATA_COMMIT_INVALID: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.METADATA_COMMIT_INVALID}u;
const ERROR_DESTINATION_BODY_CHANGED: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.DESTINATION_BODY_CHANGED}u;
const ERROR_DESTINATION_ALIVE_CHANGED: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.DESTINATION_ALIVE_CHANGED}u;
const ERROR_DESTINATION_HEALTH_CHANGED: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.DESTINATION_HEALTH_CHANGED}u;
const ERROR_DESTINATION_MEMBER_CHANGED: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.DESTINATION_MEMBER_CHANGED}u;
const HARD_FAILURE_MASK: u32 = ERROR_BODY_ABI_MISMATCH
    | ERROR_GROUP_ABI_MISMATCH
    | ERROR_PROTOCOL_MISMATCH
    | ERROR_PROGRAM_INVALID
    | ERROR_TARGET_FINGERPRINT_INVALID
    | ERROR_PARTIAL_APPLY
    | ERROR_METADATA_COMMIT_INVALID;
const BODY_FLAG_ALIVE: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE}u;
const PLAYER_TEAM_ID: u32 = ${GAMEPLAY_TEAM_ID.PLAYER}u;
const PLAYER_DAMAGEABLE_LAYER: u32 = ${GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE}u;
const MEMBER_FLAGS: u32 = ${GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
    | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING}u;
const TOWER_NOUN_MASK: u32 = ${GAMEPLAY_NOUN_MASK.TOWER}u;
const NATURAL_CREATION_ORIGIN: u32 = ${ABILITY_CREATION_ORIGIN_CODE.NATURAL}u;
const SENTENCE_PAYLOAD_CREATION_ORIGIN: u32 = ${ABILITY_CREATION_ORIGIN_CODE.SENTENCE_PAYLOAD}u;
const MODE_CPU_EXPLICIT_DESCRIPTORS: u32 = ${GPU_TOWER_CREATION_MODE.CPU_EXPLICIT_DESCRIPTORS}u;
const MODE_GPU_SUBJECT_ACTOR_ACTION: u32 = ${GPU_TOWER_CREATION_MODE.GPU_SUBJECT_ACTOR_ACTION}u;
const ACTOR_ACTION_PLACEMENT_ABI: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION}u;
const METADATA_COMMIT_ABI: u32 = ${GPU_TOWER_CREATION_METADATA_COMMIT_ABI_VERSION}u;
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
    mode: u32,
    actor_action_placement_abi_version: u32,
    execution_ordinal: u32,
    command_fingerprint: u32,
    snapshot_fingerprint: u32,
    destination_fingerprint: u32,
    placement_fingerprint: u32,
    actor_action_profile_fingerprint: u32,
    source_ability_code: u32,
    source_execution_fingerprint: u32,
    action_code: u32,
    payload_code: u32,
    creation_origin_code: u32,
    visible_from_execution_ordinal: u32,
    snapshot_source_tick: u32,
    metadata_commit_abi_version: u32,
    subject_count: u32,
    copies_per_subject: u32,
    modifier_set_fingerprint: u32,
    reserved_0: u32,
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
    mode: u32,
    execution_ordinal: u32,
    command_fingerprint: u32,
    snapshot_fingerprint: u32,
    placement_fingerprint: u32,
    actor_action_profile_fingerprint: u32,
    metadata_commit_count: atomic<u32>,
    metadata_commit_fingerprint: u32,
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
    hash = hash_word(hash, result.mode);
    hash = hash_word(hash, result.execution_ordinal);
    hash = hash_word(hash, result.command_fingerprint);
    hash = hash_word(hash, result.snapshot_fingerprint);
    hash = hash_word(hash, result.placement_fingerprint);
    hash = hash_word(hash, result.actor_action_profile_fingerprint);
    hash = hash_word(hash, atomicLoad(&result.metadata_commit_count));
    hash = hash_word(hash, result.metadata_commit_fingerprint);
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
    let cpu_mode = program.mode == MODE_CPU_EXPLICIT_DESCRIPTORS;
    let actor_mode = program.mode == MODE_GPU_SUBJECT_ACTOR_ACTION;
    if (!cpu_mode && !actor_mode) {
        errors |= ERROR_PROGRAM_INVALID;
    }
    if (cpu_mode
        && (program.actor_action_placement_abi_version != 0u
            || program.execution_ordinal != 0u
            || program.command_fingerprint != 0u
            || program.snapshot_fingerprint != 0u
            || program.destination_fingerprint != 0u
            || program.placement_fingerprint != 0u
            || program.actor_action_profile_fingerprint != 0u
            || program.source_ability_code != 0u
            || program.source_execution_fingerprint != 0u
            || program.action_code != 0u
            || program.payload_code != 0u
            || program.creation_origin_code != NATURAL_CREATION_ORIGIN
            || program.visible_from_execution_ordinal != 0u
            || program.snapshot_source_tick != 0u
            || program.metadata_commit_abi_version != 0u
            || program.subject_count != 0u
            || program.copies_per_subject != 0u
            || program.modifier_set_fingerprint != 0u)) {
        errors |= ERROR_PROGRAM_INVALID;
    }
    if (actor_mode
        && (program.actor_action_placement_abi_version
                != ACTOR_ACTION_PLACEMENT_ABI
            || program.execution_ordinal == 0u
            || program.command_fingerprint == 0u
            || program.snapshot_fingerprint == 0u
            || program.destination_fingerprint == 0u
            || program.placement_fingerprint == 0u
            || program.actor_action_profile_fingerprint == 0u
            || program.source_ability_code == 0u
            || program.source_execution_fingerprint == 0u
            || program.action_code == 0u
            || program.payload_code == 0u
            || program.creation_origin_code
                != SENTENCE_PAYLOAD_CREATION_ORIGIN
            || program.visible_from_execution_ordinal == 0u
            || program.snapshot_source_tick == 0u
            || program.snapshot_source_tick > program.source_tick
            || program.metadata_commit_abi_version
                != METADATA_COMMIT_ABI
            || program.subject_count == 0u
            || program.copies_per_subject == 0u
            || program.child_count
                != program.subject_count * program.copies_per_subject)) {
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
    result.mode = program.mode;
    result.execution_ordinal = program.execution_ordinal;
    result.command_fingerprint = program.command_fingerprint;
    result.snapshot_fingerprint = program.snapshot_fingerprint;
    result.placement_fingerprint = program.placement_fingerprint;
    result.actor_action_profile_fingerprint
        = program.actor_action_profile_fingerprint;
    atomicStore(&result.metadata_commit_count, 0u);
    result.metadata_commit_fingerprint = 0u;
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
            let destination_body_changed = !exact_body;
            let destination_alive_changed
                = (atomicLoad(&simulation.flags) & BODY_FLAG_ALIVE) != 0u;
            let destination_member_changed = member.entity_id != 0u
                || member.incarnation != 0u
                || member.logical_ordinal != 0u
                || member.share_units != 0u
                || member.max_hp_fixed_point != 0u
                || member.power_fixed_point != 0u
                || member.group_revision != 0u
                || member.flags != 0u
                || member.roster_rank != 0u
                || member.reserved != 0u;
            if (index < program.existing_count
                || record.source_current_hp_fixed_point != 0u
                || record.source_share_units != 0u
                || record.source_max_hp_fixed_point != 0u
                || record.source_power_fixed_point != 0u
                || record.source_group_revision != 0u
                || destination_body_changed
                || destination_alive_changed
                || destination_member_changed) {
                errors |= ERROR_DESTINATION_CHANGED;
            }
            if (destination_body_changed) {
                errors |= ERROR_DESTINATION_BODY_CHANGED;
            }
            if (destination_alive_changed) {
                errors |= ERROR_DESTINATION_ALIVE_CHANGED;
            }
            if (destination_member_changed) {
                errors |= ERROR_DESTINATION_MEMBER_CHANGED;
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
        let actor_mode = program.mode == MODE_GPU_SUBJECT_ACTOR_ACTION;
        ability_metadata.values[record.slot] = AbilityMetadata(
            ABILITY_METADATA_ABI_VERSION,
            TOWER_NOUN_MASK,
            program.tower_definition_code,
            0u,
            0u,
            select(0u, program.source_ability_code, actor_mode),
            select(0u, program.source_execution_fingerprint, actor_mode),
            select(0u, program.execution_ordinal, actor_mode),
            0u,
            select(
                0u,
                program.visible_from_execution_ordinal,
                actor_mode
            ),
            select(
                NATURAL_CREATION_ORIGIN,
                program.creation_origin_code,
                actor_mode
            ),
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

/**
 * Placement output과 persistent transit을 결합하는 별도 9-storage pass입니다.
 * Main 9-binding validation/apply layout에 열 번째 binding을 추가하지 않습니다.
 */
export const GPU_TOWER_CREATION_ACTOR_ACTION_WGSL = /* wgsl */`
const CREATION_ABI: u32 = ${GPU_TOWER_CREATION_ABI_VERSION}u;
const PLACEMENT_ABI: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION}u;
const ACTOR_TRANSIT_ABI: u32 = ${GPU_ACTOR_TRANSIT_ABI_VERSION}u;
const METADATA_ABI: u32 = ${ABILITY_ENTITY_METADATA_ABI_VERSION}u;
const METADATA_COMMIT_ABI: u32 = ${GPU_TOWER_CREATION_METADATA_COMMIT_ABI_VERSION}u;
const MODE_GPU_SUBJECT_ACTOR_ACTION: u32 = ${GPU_TOWER_CREATION_MODE.GPU_SUBJECT_ACTOR_ACTION}u;
const STATUS_READY_TO_APPLY: u32 = ${GPU_TOWER_CREATION_STATUS.READY_TO_APPLY}u;
const STATUS_PROTOCOL_FAILURE: u32 = ${GPU_TOWER_CREATION_STATUS.PROTOCOL_FAILURE}u;
const PLACEMENT_COMPLETE: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_STATUS.COMPLETE}u;
const PLACEMENT_RECORD_VALID: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS.VALID}u;
const PLACEMENT_TRANSIT_PENDING: u32 = ${GPU_ACTOR_ACTION_TRANSIT_PHASE.ACTIVATION_PENDING}u;
const PLACEMENT_TRANSIT_AIRBORNE: u32 = ${GPU_ACTOR_ACTION_TRANSIT_PHASE.AIRBORNE}u;
const PERSISTENT_TRANSIT_AIRBORNE: u32 = ${GPU_ACTOR_TRANSIT_PHASE.AIRBORNE}u;
const REQUIRED_TRANSIT_FLAGS: u32 = ${ACTOR_ACTION_ALL_TRANSIT_FLAGS}u;
const ACTOR_SHOOT: u32 = ${SENTENCE_ACTION_CODE.SHOOT}u;
const ACTOR_THROW: u32 = ${SENTENCE_ACTION_CODE.THROW}u;
const ACTOR_EMIT: u32 = ${SENTENCE_ACTION_CODE.EMIT}u;
const ACTOR_SUMMON: u32 = ${SENTENCE_ACTION_CODE.SUMMON}u;
const ACTOR_TOWER_PAYLOAD: u32 = ${ACTOR_PAYLOAD_CODE.TOWER}u;
const ACTOR_CONTROLLED: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.CONTROLLED_THIS_TICK}u;
const ACTOR_EXTERNAL_MOTION: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.EXTERNAL_MOTION_OWNER_THIS_TICK}u;
const ERROR_PLACEMENT_INVALID: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.ACTOR_ACTION_PLACEMENT_INVALID}u;
const ERROR_METADATA_COMMIT_INVALID: u32 = ${GPU_TOWER_CREATION_ERROR_FLAG.METADATA_COMMIT_INVALID}u;
const FNV_OFFSET: u32 = 0x811c9dc5u;
const FNV_PRIME: u32 = 0x01000193u;

const PROGRAM_MODE: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.MODE / 4}u;
const PROGRAM_SOURCE_TICK: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.SOURCE_TICK / 4}u;
const PROGRAM_EXISTING_COUNT: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.EXISTING_COUNT / 4}u;
const PROGRAM_CHILD_COUNT: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.CHILD_COUNT / 4}u;
const PROGRAM_EXECUTION_ORDINAL: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.EXECUTION_ORDINAL / 4}u;
const PROGRAM_COMMAND_FINGERPRINT: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.COMMAND_FINGERPRINT / 4}u;
const PROGRAM_SNAPSHOT_FINGERPRINT: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.SNAPSHOT_FINGERPRINT / 4}u;
const PROGRAM_DESTINATION_FINGERPRINT: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.DESTINATION_FINGERPRINT / 4}u;
const PROGRAM_PLACEMENT_FINGERPRINT: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.PLACEMENT_FINGERPRINT / 4}u;
const PROGRAM_PROFILE_FINGERPRINT: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.ACTOR_ACTION_PROFILE_FINGERPRINT / 4}u;
const PROGRAM_SOURCE_EXECUTION_FINGERPRINT: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.SOURCE_EXECUTION_FINGERPRINT / 4}u;
const PROGRAM_ACTION_CODE: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.ACTION_CODE / 4}u;
const PROGRAM_PAYLOAD_CODE: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.PAYLOAD_CODE / 4}u;
const PROGRAM_SUBJECT_COUNT: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.SUBJECT_COUNT / 4}u;
const PROGRAM_COPIES_PER_SUBJECT: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.COPIES_PER_SUBJECT / 4}u;
const PROGRAM_MODIFIER_SET_FINGERPRINT: u32 = ${GPU_TOWER_CREATION_ABI.PROGRAM.MODIFIER_SET_FINGERPRINT / 4}u;

const RESULT_STATUS: u32 = ${GPU_TOWER_CREATION_ABI.RESULT.STATUS / 4}u;
const RESULT_ERROR_FLAGS: u32 = ${GPU_TOWER_CREATION_ABI.RESULT.ERROR_FLAGS / 4}u;
const RESULT_METADATA_COUNT: u32 = ${GPU_TOWER_CREATION_ABI.RESULT.METADATA_COMMIT_COUNT / 4}u;
const RESULT_METADATA_FINGERPRINT: u32 = ${GPU_TOWER_CREATION_ABI.RESULT.METADATA_COMMIT_FINGERPRINT / 4}u;

const RECORD_WORDS: u32 = ${GPU_TOWER_CREATION_ABI.RECORD.STRIDE / 4}u;
const RECORD_SLOT: u32 = ${GPU_TOWER_CREATION_ABI.RECORD.SLOT / 4}u;
const RECORD_ENTITY_ID: u32 = ${GPU_TOWER_CREATION_ABI.RECORD.ENTITY_ID / 4}u;
const RECORD_INCARNATION: u32 = ${GPU_TOWER_CREATION_ABI.RECORD.INCARNATION / 4}u;
const RECORD_LOGICAL_ORDINAL: u32 = ${GPU_TOWER_CREATION_ABI.RECORD.LOGICAL_ORDINAL / 4}u;

const AGGREGATE_WORDS: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.STRIDE / 4}u;
const AGGREGATE_ABI: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.ABI_VERSION / 4}u;
const AGGREGATE_EXECUTION_ORDINAL: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.EXECUTION_ORDINAL / 4}u;
const AGGREGATE_STATUS: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.STATUS / 4}u;
const AGGREGATE_SUBJECT_COUNT: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.SUBJECT_COUNT / 4}u;
const AGGREGATE_DESTINATION_COUNT: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.DESTINATION_COUNT / 4}u;
const AGGREGATE_VALID_COUNT: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.VALID_COUNT / 4}u;
const AGGREGATE_COMMAND_FINGERPRINT: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.COMMAND_FINGERPRINT / 4}u;
const AGGREGATE_SNAPSHOT_FINGERPRINT: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.SNAPSHOT_FINGERPRINT / 4}u;
const AGGREGATE_DESTINATION_FINGERPRINT: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.DESTINATION_FINGERPRINT / 4}u;
const AGGREGATE_PLACEMENT_FINGERPRINT: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.PLACEMENT_FINGERPRINT / 4}u;
const AGGREGATE_ERROR_FLAGS: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.ERROR_FLAGS / 4}u;
const AGGREGATE_ACTION_CODE: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.ACTION_CODE / 4}u;
const AGGREGATE_PAYLOAD_CODE: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.PAYLOAD_CODE / 4}u;
const AGGREGATE_PROFILE_FINGERPRINT: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.PROFILE_FINGERPRINT / 4}u;
const AGGREGATE_PLACEMENT_TARGET_TICK: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.PLACEMENT_TARGET_TICK / 4}u;
const AGGREGATE_COPIES_PER_SUBJECT: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.COPIES_PER_SUBJECT / 4}u;
const AGGREGATE_MODIFIER_SET_FINGERPRINT: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.MODIFIER_SET_FINGERPRINT / 4}u;

const PLACEMENT_WORDS: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.STRIDE / 4}u;
const PLACEMENT_RECORD_ABI: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.ABI_VERSION / 4}u;
const PLACEMENT_RECORD_STATUS: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.STATUS / 4}u;
const PLACEMENT_RECORD_ERROR_FLAGS: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.ERROR_FLAGS / 4}u;
const PLACEMENT_SOURCE_RANK: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.SOURCE_RANK / 4}u;
const PLACEMENT_SOURCE_ENTITY_ID: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.SOURCE_ENTITY_ID / 4}u;
const PLACEMENT_SOURCE_INCARNATION: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.SOURCE_INCARNATION / 4}u;
const PLACEMENT_DESTINATION_RANK: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.DESTINATION_RANK / 4}u;
const PLACEMENT_DESTINATION_SLOT: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.DESTINATION_SLOT / 4}u;
const PLACEMENT_DESTINATION_ENTITY_ID: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.DESTINATION_ENTITY_ID / 4}u;
const PLACEMENT_DESTINATION_INCARNATION: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.DESTINATION_INCARNATION / 4}u;
const PLACEMENT_ACTION_CODE: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.ACTION_CODE / 4}u;
const PLACEMENT_PROFILE_CODE: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.PROFILE_CODE / 4}u;
const PLACEMENT_PAYLOAD_CODE: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.PAYLOAD_CODE / 4}u;
const PLACEMENT_SPAWN_X: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.SPAWN_X / 4}u;
const PLACEMENT_SPAWN_Y: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.SPAWN_Y / 4}u;
const PLACEMENT_VELOCITY_X: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.INITIAL_VELOCITY_X / 4}u;
const PLACEMENT_VELOCITY_Y: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.INITIAL_VELOCITY_Y / 4}u;
const PLACEMENT_ACTIVATION_TICK: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.ACTIVATION_TICK / 4}u;
const PLACEMENT_DURATION_FIXED_TICKS: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.TRANSIT_DURATION_FIXED_TICKS / 4}u;
const PLACEMENT_SOURCE_GENERATION: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.SOURCE_GENERATION / 4}u;
const PLACEMENT_CHILD_GENERATION: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.CHILD_GENERATION / 4}u;
const PLACEMENT_RECORD_FINGERPRINT: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.PLACEMENT_FINGERPRINT / 4}u;
const PLACEMENT_COPY_INDEX: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.COPY_INDEX / 4}u;
const PLACEMENT_MODIFIER_SET_FINGERPRINT: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.MODIFIER_SET_FINGERPRINT / 4}u;

const PLACEMENT_TRANSIT_WORDS: u32 = ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.STRIDE / 4}u;
const TRANSIT_RECORD_WORDS: u32 = ${ACTOR_TRANSIT_RECORD_WORDS}u;

const METADATA_WORDS: u32 = ${GPU_TOWER_CREATION_ABI.METADATA_COMMIT.STRIDE / 4}u;
const METADATA_DESTINATION_RANK: u32 = ${GPU_TOWER_CREATION_ABI.METADATA_COMMIT.DESTINATION_RANK / 4}u;
const METADATA_ENTITY_ID: u32 = ${GPU_TOWER_CREATION_ABI.METADATA_COMMIT.ENTITY_ID / 4}u;
const METADATA_INCARNATION: u32 = ${GPU_TOWER_CREATION_ABI.METADATA_COMMIT.INCARNATION / 4}u;
const METADATA_LOGICAL_ORDINAL: u32 = ${GPU_TOWER_CREATION_ABI.METADATA_COMMIT.LOGICAL_ORDINAL / 4}u;
const METADATA_GENERATION: u32 = ${GPU_TOWER_CREATION_ABI.METADATA_COMMIT.GENERATION / 4}u;
const METADATA_ACTION_CODE: u32 = ${GPU_TOWER_CREATION_ABI.METADATA_COMMIT.ACTION_CODE / 4}u;
const METADATA_RECORD_FINGERPRINT: u32 = ${GPU_TOWER_CREATION_ABI.METADATA_COMMIT.RECORD_FINGERPRINT / 4}u;

struct RawU32Buffer { values: array<u32> }
struct RawAtomicBuffer { values: array<atomic<u32>> }
struct BodyPhysics {
    position: vec2f,
    velocity: vec2f,
    radius: f32,
    inverse_mass: f32,
    physical_meta: u32,
    interaction_meta: u32,
}
struct PhysicsBuffer { values: array<BodyPhysics> }
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
struct SimulationBuffer { values: array<BodySimulation> }
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
struct AbilityMetadataBuffer { values: array<AbilityMetadata> }

@group(0) @binding(0) var<storage, read> actor_program: RawU32Buffer;
@group(0) @binding(1) var<storage, read> actor_records: RawU32Buffer;
@group(0) @binding(2) var<storage, read_write> actor_result: RawAtomicBuffer;
@group(0) @binding(3) var<storage, read> actor_placement: RawU32Buffer;
@group(0) @binding(4) var<storage, read_write> actor_physics: PhysicsBuffer;
@group(0) @binding(5) var<storage, read_write> actor_simulations: SimulationBuffer;
@group(0) @binding(6) var<storage, read_write> actor_metadata: AbilityMetadataBuffer;
@group(0) @binding(7) var<storage, read_write> actor_transits: RawU32Buffer;
@group(0) @binding(8) var<storage, read_write> metadata_commits: RawU32Buffer;

fn hash_word(hash: u32, word: u32) -> u32 {
    return (hash ^ word) * FNV_PRIME;
}

fn nonzero_hash(hash: u32) -> u32 {
    return select(hash, 1u, hash == 0u);
}

fn finite_scalar(value: f32) -> bool {
    return value == value && abs(value) <= 3.402823466e+38;
}

fn creation_record_word(rank: u32, field: u32) -> u32 {
    let index = actor_program.values[PROGRAM_EXISTING_COUNT] + rank;
    return actor_records.values[index * RECORD_WORDS + field];
}

fn placement_word(rank: u32, field: u32) -> u32 {
    return actor_placement.values[AGGREGATE_WORDS + rank * PLACEMENT_WORDS + field];
}

fn placement_transit_word(rank: u32, field: u32) -> u32 {
    return actor_placement.values[
        AGGREGATE_WORDS
            + actor_program.values[PROGRAM_CHILD_COUNT] * PLACEMENT_WORDS
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

fn metadata_word(rank: u32, field: u32) -> u32 {
    return metadata_commits.values[rank * METADATA_WORDS + field];
}

fn set_metadata_word(rank: u32, field: u32, value: u32) {
    metadata_commits.values[rank * METADATA_WORDS + field] = value;
}

fn metadata_record_fingerprint(rank: u32) -> u32 {
    var hash = hash_word(FNV_OFFSET, METADATA_COMMIT_ABI);
    var field = METADATA_DESTINATION_RANK;
    loop {
        if (field >= METADATA_RECORD_FINGERPRINT) { break; }
        hash = hash_word(hash, metadata_word(rank, field));
        field += 1u;
    }
    return nonzero_hash(hash);
}

fn transit_record_fingerprint(slot: u32) -> u32 {
    var hash = hash_word(FNV_OFFSET, transit_word(slot, ${TR.ABI_VERSION}u));
    for (var field = ${TR.FLAGS}u; field <= ${TR.DURATION_FIXED_TICKS}u;
        field += 1u) {
        hash = hash_word(hash, transit_word(slot, field));
    }
    for (var field = ${TR.START_X}u;
        field <= ${TR.PRESENTATION_ARC_HEIGHT}u; field += 1u) {
        hash = hash_word(hash, transit_word(slot, field));
    }
    for (var field = ${TR.BASELINE_PHYSICAL_META}u;
        field <= ${TR.BASELINE_VELOCITY_Y}u; field += 1u) {
        hash = hash_word(hash, transit_word(slot, field));
    }
    hash = hash_word(hash, transit_word(slot, ${TR.SOURCE_RANK}u));
    return nonzero_hash(hash);
}

@compute @workgroup_size(${GPU_TOWER_CREATION_WORKGROUP_SIZE})
fn validate_actor_action_placement(
    @builtin(global_invocation_id) invocation: vec3u
) {
    let rank = invocation.x;
    let child_count = actor_program.values[PROGRAM_CHILD_COUNT];
    let subject_count = actor_program.values[PROGRAM_SUBJECT_COUNT];
    let copies_per_subject
        = actor_program.values[PROGRAM_COPIES_PER_SUBJECT];
    if (rank == 0u) {
        let action_code = actor_program.values[PROGRAM_ACTION_CODE];
        var header_invalid = actor_program.values[PROGRAM_MODE]
                != MODE_GPU_SUBJECT_ACTOR_ACTION
            || actor_placement.values[AGGREGATE_ABI] != PLACEMENT_ABI
            || actor_placement.values[AGGREGATE_STATUS] != PLACEMENT_COMPLETE
            || actor_placement.values[AGGREGATE_SUBJECT_COUNT]
                != subject_count
            || actor_placement.values[AGGREGATE_DESTINATION_COUNT]
                != child_count
            || actor_placement.values[AGGREGATE_VALID_COUNT] != child_count
            || actor_placement.values[AGGREGATE_COPIES_PER_SUBJECT]
                != copies_per_subject
            || actor_placement.values[AGGREGATE_MODIFIER_SET_FINGERPRINT]
                != actor_program.values[PROGRAM_MODIFIER_SET_FINGERPRINT]
            || actor_placement.values[AGGREGATE_ERROR_FLAGS] != 0u
            || actor_placement.values[AGGREGATE_EXECUTION_ORDINAL]
                != actor_program.values[PROGRAM_EXECUTION_ORDINAL]
            || actor_placement.values[AGGREGATE_COMMAND_FINGERPRINT]
                != actor_program.values[PROGRAM_COMMAND_FINGERPRINT]
            || actor_placement.values[AGGREGATE_SNAPSHOT_FINGERPRINT]
                != actor_program.values[PROGRAM_SNAPSHOT_FINGERPRINT]
            || actor_placement.values[AGGREGATE_DESTINATION_FINGERPRINT]
                != actor_program.values[PROGRAM_DESTINATION_FINGERPRINT]
            || actor_placement.values[AGGREGATE_PLACEMENT_FINGERPRINT]
                != actor_program.values[PROGRAM_PLACEMENT_FINGERPRINT]
            || actor_placement.values[AGGREGATE_PROFILE_FINGERPRINT]
                != actor_program.values[PROGRAM_PROFILE_FINGERPRINT]
            || actor_placement.values[AGGREGATE_ACTION_CODE]
                != actor_program.values[PROGRAM_ACTION_CODE]
            || actor_placement.values[AGGREGATE_PAYLOAD_CODE]
                != actor_program.values[PROGRAM_PAYLOAD_CODE]
            || actor_program.values[PROGRAM_PAYLOAD_CODE]
                != ACTOR_TOWER_PAYLOAD
            || (action_code != ACTOR_SHOOT && action_code != ACTOR_THROW
                && action_code != ACTOR_EMIT && action_code != ACTOR_SUMMON)
            || actor_placement.values[AGGREGATE_PLACEMENT_TARGET_TICK] == 0u
            || actor_placement.values[AGGREGATE_PLACEMENT_TARGET_TICK]
                > actor_program.values[PROGRAM_SOURCE_TICK];
        if (header_invalid) {
            atomicOr(
                &actor_result.values[RESULT_ERROR_FLAGS],
                ERROR_PLACEMENT_INVALID
            );
        }
    }
    if (rank >= child_count) { return; }
    let slot = creation_record_word(rank, RECORD_SLOT);
    let entity_id = creation_record_word(rank, RECORD_ENTITY_ID);
    let incarnation = creation_record_word(rank, RECORD_INCARNATION);
    let source_rank = placement_word(rank, PLACEMENT_SOURCE_RANK);
    let copy_index = placement_word(rank, PLACEMENT_COPY_INDEX);
    let spawn_x = bitcast<f32>(placement_word(rank, PLACEMENT_SPAWN_X));
    let spawn_y = bitcast<f32>(placement_word(rank, PLACEMENT_SPAWN_Y));
    let velocity_x = bitcast<f32>(placement_word(rank, PLACEMENT_VELOCITY_X));
    let velocity_y = bitcast<f32>(placement_word(rank, PLACEMENT_VELOCITY_Y));
    let action_code = actor_program.values[PROGRAM_ACTION_CODE];
    let throw_action = action_code == ACTOR_THROW;
    let zero_velocity_action = action_code == ACTOR_EMIT
        || action_code == ACTOR_SUMMON;
    let duration = placement_word(rank, PLACEMENT_DURATION_FIXED_TICKS);
    let target_tick = actor_placement.values[AGGREGATE_PLACEMENT_TARGET_TICK];
    let activation_tick = placement_word(rank, PLACEMENT_ACTIVATION_TICK);
    let landing = vec2f(
        bitcast<f32>(placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.LANDING_X / 4}u)),
        bitcast<f32>(placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.LANDING_Y / 4}u))
    );
    let transit_velocity = vec2f(
        bitcast<f32>(placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.VELOCITY_X / 4}u)),
        bitcast<f32>(placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.VELOCITY_Y / 4}u))
    );
    let arc_height = bitcast<f32>(placement_transit_word(
        rank,
        ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.PRESENTATION_ARC_HEIGHT / 4}u
    ));
    let derived_velocity = (landing - vec2f(spawn_x, spawn_y))
        * (60.0 / select(1.0, f32(duration), duration > 0u));
    let transit_common_invalid = placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.ABI_VERSION / 4}u)
            != PLACEMENT_ABI
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.SOURCE_RANK / 4}u) != source_rank
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.DESTINATION_SLOT / 4}u) != slot
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.DESTINATION_ENTITY_ID / 4}u) != entity_id
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.DESTINATION_INCARNATION / 4}u) != incarnation
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.ACTION_CODE / 4}u) != action_code
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.PROFILE_CODE / 4}u)
            != placement_word(rank, PLACEMENT_PROFILE_CODE)
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.ACTIVATION_TICK / 4}u) != activation_tick
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.DURATION_FIXED_TICKS / 4}u) != duration
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.PROGRESS_FIXED_TICKS / 4}u) != 0u
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.FINGERPRINT / 4}u) == 0u
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.COPY_INDEX / 4}u) != copy_index
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.MODIFIER_SET_FINGERPRINT / 4}u)
            != actor_program.values[PROGRAM_MODIFIER_SET_FINGERPRINT]
        || placement_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.TARGET_X / 4}u)
            != placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.LANDING_X / 4}u)
        || placement_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.TARGET_Y / 4}u)
            != placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.LANDING_Y / 4}u)
        || placement_word(rank, PLACEMENT_VELOCITY_X)
            != placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.VELOCITY_X / 4}u)
        || placement_word(rank, PLACEMENT_VELOCITY_Y)
            != placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.VELOCITY_Y / 4}u)
        || !finite_scalar(landing.x) || !finite_scalar(landing.y)
        || !finite_scalar(transit_velocity.x)
        || !finite_scalar(transit_velocity.y)
        || !finite_scalar(arc_height)
        || (slot + 1u) * TRANSIT_RECORD_WORDS
            > arrayLength(&actor_transits.values);
    let throw_transit_invalid = throw_action && (
        duration == 0u
        || duration > 0xffffffffu - target_tick
        || activation_tick != target_tick + duration
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.PHASE / 4}u)
            != PLACEMENT_TRANSIT_AIRBORNE
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.FLAGS / 4}u)
            != REQUIRED_TRANSIT_FLAGS
        || !(arc_height > 0.0)
        || any(derived_velocity != transit_velocity)
    );
    let immediate_transit_invalid = !throw_action && (
        duration != 0u
        || target_tick == 0xffffffffu
        || activation_tick != target_tick + 1u
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.PHASE / 4}u)
            != PLACEMENT_TRANSIT_PENDING
        || placement_transit_word(rank, ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.FLAGS / 4}u) != 0u
        || arc_height != 0.0
        || (zero_velocity_action && any(transit_velocity != vec2f(0.0)))
    );
    let invalid = placement_word(rank, PLACEMENT_RECORD_ABI) != PLACEMENT_ABI
        || placement_word(rank, PLACEMENT_RECORD_STATUS)
            != PLACEMENT_RECORD_VALID
        || placement_word(rank, PLACEMENT_RECORD_ERROR_FLAGS) != 0u
        || source_rank >= subject_count
        || copy_index >= copies_per_subject
        || source_rank * copies_per_subject + copy_index != rank
        || placement_word(rank, PLACEMENT_DESTINATION_RANK) != rank
        || placement_word(rank, PLACEMENT_MODIFIER_SET_FINGERPRINT)
            != actor_program.values[PROGRAM_MODIFIER_SET_FINGERPRINT]
        || placement_word(rank, PLACEMENT_DESTINATION_SLOT) != slot
        || placement_word(rank, PLACEMENT_DESTINATION_ENTITY_ID) != entity_id
        || placement_word(rank, PLACEMENT_DESTINATION_INCARNATION)
            != incarnation
        || placement_word(rank, PLACEMENT_ACTION_CODE)
            != actor_program.values[PROGRAM_ACTION_CODE]
        || placement_word(rank, PLACEMENT_PAYLOAD_CODE)
            != actor_program.values[PROGRAM_PAYLOAD_CODE]
        || placement_word(rank, PLACEMENT_ACTIVATION_TICK) == 0u
        || placement_word(rank, PLACEMENT_CHILD_GENERATION)
            != placement_word(rank, PLACEMENT_SOURCE_GENERATION) + 1u
        || placement_word(rank, PLACEMENT_RECORD_FINGERPRINT) == 0u
        || !finite_scalar(spawn_x) || !finite_scalar(spawn_y)
        || !finite_scalar(velocity_x) || !finite_scalar(velocity_y)
        || transit_common_invalid
        || throw_transit_invalid
        || immediate_transit_invalid;
    if (invalid) {
        atomicOr(
            &actor_result.values[RESULT_ERROR_FLAGS],
            ERROR_PLACEMENT_INVALID
        );
    }
}

@compute @workgroup_size(${GPU_TOWER_CREATION_WORKGROUP_SIZE})
fn apply_actor_action_placement(
    @builtin(global_invocation_id) invocation: vec3u
) {
    let rank = invocation.x;
    let child_count = actor_program.values[PROGRAM_CHILD_COUNT];
    if (rank >= child_count
        || atomicLoad(&actor_result.values[RESULT_STATUS])
            != STATUS_READY_TO_APPLY) {
        return;
    }
    let slot = creation_record_word(rank, RECORD_SLOT);
    let entity_id = creation_record_word(rank, RECORD_ENTITY_ID);
    let incarnation = creation_record_word(rank, RECORD_INCARNATION);
    let logical_ordinal = creation_record_word(rank, RECORD_LOGICAL_ORDINAL);
    let generation = placement_word(rank, PLACEMENT_CHILD_GENERATION);
    let baseline_velocity = actor_physics.values[slot].velocity;
    let baseline_physical_meta = actor_physics.values[slot].physical_meta;
    let baseline_interaction_meta
        = actor_physics.values[slot].interaction_meta;
    let baseline_noun_mask = actor_metadata.values[slot].noun_mask;
    let baseline_flow_field_index
        = actor_simulations.values[slot].flow_field_index;
    let baseline_flow_speed = actor_simulations.values[slot].flow_speed;
    actor_physics.values[slot].position = vec2f(
        bitcast<f32>(placement_word(rank, PLACEMENT_SPAWN_X)),
        bitcast<f32>(placement_word(rank, PLACEMENT_SPAWN_Y))
    );
    actor_metadata.values[slot].generation = generation;
    if (actor_program.values[PROGRAM_ACTION_CODE] == ACTOR_THROW) {
        let target_tick
            = actor_placement.values[AGGREGATE_PLACEMENT_TARGET_TICK];
        set_transit_word(slot, ${TR.ABI_VERSION}u, ACTOR_TRANSIT_ABI);
        set_transit_word(
            slot,
            ${TR.PHASE}u,
            PERSISTENT_TRANSIT_AIRBORNE
        );
        set_transit_word(
            slot,
            ${TR.FLAGS}u,
            placement_transit_word(
                rank,
                ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.FLAGS / 4}u
            )
        );
        set_transit_word(slot, ${TR.PAYLOAD_CODE}u, ACTOR_TOWER_PAYLOAD);
        set_transit_word(slot, ${TR.ENTITY_ID}u, entity_id);
        set_transit_word(slot, ${TR.INCARNATION}u, incarnation);
        set_transit_word(
            slot,
            ${TR.SOURCE_ENTITY_ID}u,
            placement_word(rank, PLACEMENT_SOURCE_ENTITY_ID)
        );
        set_transit_word(
            slot,
            ${TR.SOURCE_INCARNATION}u,
            placement_word(rank, PLACEMENT_SOURCE_INCARNATION)
        );
        set_transit_word(slot, ${TR.ACTION_CODE}u, ACTOR_THROW);
        set_transit_word(
            slot,
            ${TR.PROFILE_CODE}u,
            placement_word(rank, PLACEMENT_PROFILE_CODE)
        );
        set_transit_word(
            slot,
            ${TR.PROFILE_FINGERPRINT}u,
            actor_program.values[PROGRAM_PROFILE_FINGERPRINT]
        );
        set_transit_word(
            slot,
            ${TR.EXECUTION_ORDINAL}u,
            actor_program.values[PROGRAM_EXECUTION_ORDINAL]
        );
        set_transit_word(
            slot,
            ${TR.EXECUTION_FINGERPRINT}u,
            actor_program.values[PROGRAM_SOURCE_EXECUTION_FINGERPRINT]
        );
        set_transit_word(
            slot,
            ${TR.PLACEMENT_FINGERPRINT}u,
            actor_program.values[PROGRAM_PLACEMENT_FINGERPRINT]
        );
        set_transit_word(slot, ${TR.START_TICK}u, target_tick);
        set_transit_word(
            slot,
            ${TR.ACTIVATION_TICK}u,
            placement_word(rank, PLACEMENT_ACTIVATION_TICK)
        );
        set_transit_word(
            slot,
            ${TR.DURATION_FIXED_TICKS}u,
            placement_word(rank, PLACEMENT_DURATION_FIXED_TICKS)
        );
        set_transit_word(slot, ${TR.PROGRESS_FIXED_TICKS}u, 0u);
        set_transit_word(
            slot,
            ${TR.START_X}u,
            placement_word(rank, PLACEMENT_SPAWN_X)
        );
        set_transit_word(
            slot,
            ${TR.START_Y}u,
            placement_word(rank, PLACEMENT_SPAWN_Y)
        );
        set_transit_word(
            slot,
            ${TR.LANDING_X}u,
            placement_transit_word(
                rank,
                ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.LANDING_X / 4}u
            )
        );
        set_transit_word(
            slot,
            ${TR.LANDING_Y}u,
            placement_transit_word(
                rank,
                ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.LANDING_Y / 4}u
            )
        );
        set_transit_word(
            slot,
            ${TR.GROUND_VELOCITY_X}u,
            placement_transit_word(
                rank,
                ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.VELOCITY_X / 4}u
            )
        );
        set_transit_word(
            slot,
            ${TR.GROUND_VELOCITY_Y}u,
            placement_transit_word(
                rank,
                ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.VELOCITY_Y / 4}u
            )
        );
        set_transit_word(
            slot,
            ${TR.PRESENTATION_ARC_HEIGHT}u,
            placement_transit_word(
                rank,
                ${GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.PRESENTATION_ARC_HEIGHT / 4}u
            )
        );
        set_transit_word(
            slot,
            ${TR.CURRENT_PRESENTATION_ARC_HEIGHT}u,
            0u
        );
        set_transit_word(
            slot,
            ${TR.BASELINE_PHYSICAL_META}u,
            baseline_physical_meta
        );
        set_transit_word(
            slot,
            ${TR.BASELINE_INTERACTION_META}u,
            baseline_interaction_meta
        );
        set_transit_word(
            slot,
            ${TR.BASELINE_NOUN_MASK}u,
            baseline_noun_mask
        );
        set_transit_word(
            slot,
            ${TR.BASELINE_FLOW_FIELD_INDEX}u,
            baseline_flow_field_index
        );
        set_transit_word(
            slot,
            ${TR.BASELINE_FLOW_SPEED}u,
            bitcast<u32>(baseline_flow_speed)
        );
        set_transit_word(
            slot,
            ${TR.BASELINE_VELOCITY_X}u,
            bitcast<u32>(baseline_velocity.x)
        );
        set_transit_word(
            slot,
            ${TR.BASELINE_VELOCITY_Y}u,
            bitcast<u32>(baseline_velocity.y)
        );
        set_transit_word(
            slot,
            ${TR.SOURCE_RANK}u,
            placement_word(rank, PLACEMENT_SOURCE_RANK)
        );
        set_transit_word(slot, ${TR.RESERVED_0}u, 0u);
        set_transit_word(slot, ${TR.RESERVED_1}u, 0u);
        set_transit_word(slot, ${TR.RESERVED_2}u, 0u);
        set_transit_word(slot, ${TR.RESERVED_3}u, 0u);
        set_transit_word(slot, ${TR.RESERVED_4}u, 0u);
        set_transit_word(
            slot,
            ${TR.RECORD_FINGERPRINT}u,
            transit_record_fingerprint(slot)
        );
        actor_physics.values[slot].velocity = vec2f(0.0);
        actor_physics.values[slot].physical_meta = 0u;
        actor_physics.values[slot].interaction_meta = 0u;
        actor_metadata.values[slot].noun_mask = 0u;
        actor_simulations.values[slot].flow_speed = 0.0;
        atomicOr(
            &actor_simulations.values[slot].flags,
            ACTOR_CONTROLLED | ACTOR_EXTERNAL_MOTION
        );
    } else {
        for (var word = 0u; word < TRANSIT_RECORD_WORDS; word += 1u) {
            set_transit_word(slot, word, 0u);
        }
        actor_physics.values[slot].velocity = vec2f(
            bitcast<f32>(placement_word(rank, PLACEMENT_VELOCITY_X)),
            bitcast<f32>(placement_word(rank, PLACEMENT_VELOCITY_Y))
        );
    }
    set_metadata_word(rank, 0u, METADATA_COMMIT_ABI);
    set_metadata_word(rank, METADATA_DESTINATION_RANK, rank);
    set_metadata_word(rank, METADATA_ENTITY_ID, entity_id);
    set_metadata_word(rank, METADATA_INCARNATION, incarnation);
    set_metadata_word(rank, METADATA_LOGICAL_ORDINAL, logical_ordinal);
    set_metadata_word(rank, METADATA_GENERATION, generation);
    set_metadata_word(
        rank,
        METADATA_ACTION_CODE,
        actor_program.values[PROGRAM_ACTION_CODE]
    );
    set_metadata_word(
        rank,
        METADATA_RECORD_FINGERPRINT,
        metadata_record_fingerprint(rank)
    );
    atomicAdd(&actor_result.values[RESULT_METADATA_COUNT], 1u);
}

@compute @workgroup_size(1)
fn seal_actor_action_metadata() {
    if (atomicLoad(&actor_result.values[RESULT_STATUS])
            != STATUS_READY_TO_APPLY) {
        atomicStore(
            &actor_result.values[RESULT_METADATA_FINGERPRINT],
            0u
        );
        return;
    }
    let child_count = actor_program.values[PROGRAM_CHILD_COUNT];
    var hash = hash_word(FNV_OFFSET, METADATA_COMMIT_ABI);
    hash = hash_word(hash, child_count);
    var invalid = atomicLoad(&actor_result.values[RESULT_METADATA_COUNT])
        != child_count;
    var rank = 0u;
    loop {
        if (rank >= child_count) { break; }
        let fingerprint = metadata_word(rank, METADATA_RECORD_FINGERPRINT);
        if (fingerprint == 0u
            || fingerprint != metadata_record_fingerprint(rank)) {
            invalid = true;
        }
        hash = hash_word(hash, fingerprint);
        rank += 1u;
    }
    if (invalid) {
        atomicOr(
            &actor_result.values[RESULT_ERROR_FLAGS],
            ERROR_METADATA_COMMIT_INVALID
        );
        atomicStore(
            &actor_result.values[RESULT_STATUS],
            STATUS_PROTOCOL_FAILURE
        );
        atomicStore(
            &actor_result.values[RESULT_METADATA_FINGERPRINT],
            0u
        );
    } else {
        atomicStore(
            &actor_result.values[RESULT_METADATA_FINGERPRINT],
            nonzero_hash(hash)
        );
    }
}
`;
