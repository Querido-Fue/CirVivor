import {
    GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE,
    GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM,
    GPU_CIRCLE_BODY_ABI_VERSION,
    encodeGpuCircleBodyFixedPoint
} from './gpu_circle_body_abi.js';
import {
    GPU_ATOMIC_TRANSFORM_PREPARE_PROGRAM_ABI_VERSION,
    GPU_ATOMIC_TRANSFORM_PREPARE_RESULT,
    GPU_ATOMIC_TRANSFORM_PROGRAM_ABI_VERSION,
    GPU_ATOMIC_TRANSFORM_RESULT,
    GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS,
    GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE
} from './gpu_atomic_transform_runtime_abi.js';
import {
    JORANG_RETURN_DELAY_FIXED_TICKS
} from '../../../../data/object/enemy/enemy_jorang_split_runtime_data.js';
import {
    ENEMY_COMBAT_PROFILE_BY_ID,
    MAIN_GPU_ENEMY_COMBAT_PROFILE_ID
} from '../../../../data/object/enemy/enemy_profile_catalog_data.js';
import {
    GPU_EFFECT_RUNTIME_ABI_VERSION
} from './gpu_effect_runtime_abi.js';

const CIRCLE_PRIME_FRESH_HEALTH_FIXED_POINT = encodeGpuCircleBodyFixedPoint(
    ENEMY_COMBAT_PROFILE_BY_ID[MAIN_GPU_ENEMY_COMBAT_PROFILE_ID].maxHealth
);

/**
 * 각 entrypoint의 transitive storage set은 최대 9입니다. Prepare는 fixed tick의
 * mark_dead 뒤에 실행되어 live/pending/due state를 GPU에서 직접 인증합니다.
 */
export const GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL = /* wgsl */`
const BODY_ABI_VERSION: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;
const PREPARE_ABI_VERSION: u32 = ${GPU_ATOMIC_TRANSFORM_PREPARE_PROGRAM_ABI_VERSION}u;
const TRANSFORM_ABI_VERSION: u32 = ${GPU_ATOMIC_TRANSFORM_PROGRAM_ABI_VERSION}u;
const INVALID_U32: u32 = 0xffffffffu;
const BODY_FLAG_ALIVE: u32 = 1u;
const BODY_FLAG_USE_FLOW: u32 = 2u;
const EFFECT_RUNTIME_ABI_VERSION: u32 = ${GPU_EFFECT_RUNTIME_ABI_VERSION}u;
const PROGRAM_J_SPLIT: u32 = ${GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.J_SPLIT_FIRST_HIT}u;
const PROGRAM_C_PRIME_RETURN: u32 = ${GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.C_PRIME_DELAYED_RECOMBINE}u;
const PHASE_SPLIT_PENDING: u32 = ${GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.SPLIT_PENDING}u;
const PHASE_CHILD_DELAYED: u32 = ${GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.CHILD_DELAYED}u;
const PHASE_ARMED: u32 = ${GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.ARMED}u;
const RETURN_DELAY_FIXED_TICKS: u32 = ${JORANG_RETURN_DELAY_FIXED_TICKS}u;
const CIRCLE_PRIME_FRESH_HEALTH_FIXED_POINT: i32 = ${CIRCLE_PRIME_FRESH_HEALTH_FIXED_POINT};
const TOPOLOGY_ONE_TO_MANY: u32 = ${GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_MANY}u;
const TOPOLOGY_ONE_TO_ONE_DELAYED: u32 = ${GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_ONE_DELAYED}u;
const PREPARE_RESULT_AUTHENTIC: u32 = ${GPU_ATOMIC_TRANSFORM_PREPARE_RESULT.AUTHENTIC}u;
const TRANSFORM_RESULT_PENDING: u32 = ${GPU_ATOMIC_TRANSFORM_RESULT.PENDING}u;
const TRANSFORM_RESULT_COMMITTED: u32 = ${GPU_ATOMIC_TRANSFORM_RESULT.COMMITTED}u;
const TRANSFORM_RESULT_BATCH_REJECTED: u32 = ${GPU_ATOMIC_TRANSFORM_RESULT.BATCH_REJECTED}u;
const STATUS_ABI_MISMATCH: u32 = ${GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.ABI_MISMATCH}u;
const STATUS_CAPACITY_EXCEEDED: u32 = ${GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.CAPACITY_EXCEEDED}u;
const STATUS_RECORD_INVALID: u32 = ${GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.RECORD_INVALID}u;
const STATUS_SOURCE_CONFLICT: u32 = ${GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.SOURCE_CONFLICT}u;
const STATUS_DESTINATION_CONFLICT: u32 = ${GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.DESTINATION_CONFLICT}u;
const STATUS_EFFECT_REKEY_MISMATCH: u32 = ${GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.EFFECT_REKEY_MISMATCH}u;
const STATUS_COMMIT_COUNT_MISMATCH: u32 = ${GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.COMMIT_COUNT_MISMATCH}u;

struct BodyCounts { body_count: u32, addition_count: u32, removal_count: u32, abi_version: u32 }
struct BodyPhysics {
    position: vec2f, velocity: vec2f, radius: f32, inverse_mass: f32,
    physical_meta: u32, interaction_meta: u32,
}
struct BodySimulation {
    lifetime: f32, health: atomic<i32>, gameplay_meta: u32, flags: atomic<u32>,
    flow_field_index: u32, flow_speed: f32, entity_id: u32, incarnation: u32,
}
struct BodyTemporary {
    previous_position: vec2f, predicted_position: vec2f, position_delta: vec2f,
    grid_index: i32, previous_flow_field_index: u32,
}
struct ContactHandler {
    damage_self: f32, damage_other: f32, damage_falloff: f32, fire_timer: f32,
    flags: u32, chaining: i32, damage_report_id: i32, slow_timer: f32,
}
struct CombatState {
    target_interaction_layer_mask: u32,
    maximum_damage_window_duration_fixed_ticks: u32,
    peak_final_damage_fixed_point: atomic<i32>, expires_at_fixed_tick: atomic<u32>,
    peak_source_entity_id: atomic<u32>, peak_source_incarnation: atomic<u32>,
    reserved_0: u32, reserved_1: u32, reserved_2: u32, reserved_3: u32,
}
struct AtomicTransformState {
    program_id: u32, phase: atomic<u32>, entity_id: u32, incarnation: u32,
    due_fixed_tick: u32, lineage_root_entity_id: u32,
    lineage_root_incarnation: u32, branch_index: u32, bounty_budget: u32,
    trigger_source_tick: atomic<u32>, trigger_sequence: atomic<u32>,
    command_generation: atomic<u32>,
}
struct TemplateBodySimulation {
    lifetime: f32, health: i32, gameplay_meta: u32, flags: u32,
    flow_field_index: u32, flow_speed: f32, entity_id: u32, incarnation: u32,
}
struct TemplateCombatState {
    target_interaction_layer_mask: u32,
    maximum_damage_window_duration_fixed_ticks: u32,
    peak_final_damage_fixed_point: i32, expires_at_fixed_tick: u32,
    peak_source_entity_id: u32, peak_source_incarnation: u32,
    reserved_0: u32, reserved_1: u32, reserved_2: u32, reserved_3: u32,
}
struct TemplateAtomicTransformState {
    program_id: u32, phase: u32, entity_id: u32, incarnation: u32,
    due_fixed_tick: u32, lineage_root_entity_id: u32,
    lineage_root_incarnation: u32, branch_index: u32, bounty_budget: u32,
    trigger_source_tick: u32, trigger_sequence: u32, command_generation: u32,
}
struct EffectSummary {
    entity_id: u32, incarnation: u32, max_health_fixed_point: i32,
    authored_damage_other: f32, resolved_base_damage_other: f32,
    active_family_mask: atomic<u32>, boost_stack_count: atomic<u32>,
    regen_per_tick_fixed_point: i32, attack_multiplier: f32,
    move_speed_multiplier: f32, presentation_tags: atomic<u32>,
    presentation_magnitude: f32, last_pulse_tick: u32, pulse_style_code: u32,
    summary_tick: u32, source_snapshot_tick: u32,
    damage_taken_multiplier: f32, reserved_0: u32, reserved_1: u32,
    flags: atomic<u32>,
}
struct PrepareHeader {
    abi_version: u32, source_tick: u32, target_fixed_tick: u32,
    batch_id_fingerprint: u32, capacity: u32, record_count: atomic<u32>,
    status: atomic<u32>, reserved_0: u32,
}
struct PrepareRecord {
    topology_code: u32, source_slot: u32, source_entity_id: u32,
    source_incarnation: u32, due_fixed_tick: u32,
    lineage_root_entity_id: u32,
    lineage_root_incarnation: u32, branch_index: u32, bounty_budget: u32,
    command_generation: u32, current_health_fixed_point: i32,
    max_health_fixed_point: i32, trigger_source_tick: u32,
    trigger_sequence: u32, result: u32, record_fingerprint: u32,
}
struct PrepareProgram { header: PrepareHeader, records: array<PrepareRecord> }
struct TransformHeader {
    abi_version: u32, count: u32, capacity: u32, batch_id_fingerprint: u32,
    prepared_source_tick: u32, target_fixed_tick: u32, status: atomic<u32>,
    batch_accepted: atomic<u32>, committed_count: atomic<u32>,
    effect_rekey_count: atomic<u32>, expected_effect_rekey_count: atomic<u32>,
    failure_record_index: atomic<u32>,
}
struct TransformRecord {
    topology_code: u32, source_slot: u32, source_entity_id: u32,
    source_incarnation: u32, destination_0_slot: u32,
    destination_0_entity_id: u32, destination_0_incarnation: u32,
    destination_1_slot: u32, destination_1_entity_id: u32,
    destination_1_incarnation: u32, destination_count: u32,
    effect_transfer_destination_index: u32, prepare_record_fingerprint: u32,
    command_generation: u32, result: u32, effect_rekey_count: u32,
    source_current_health_fixed_point: i32,
    source_max_health_fixed_point: i32, trigger_source_tick: u32,
    trigger_sequence: u32,
}
struct TransformProgram { header: TransformHeader, records: array<TransformRecord> }
struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct TemporaryBuffer { values: array<BodyTemporary> }
struct ContactHandlerBuffer { values: array<ContactHandler> }
struct CombatStateBuffer { values: array<CombatState> }
struct AtomicTransformStateBuffer { values: array<AtomicTransformState> }
struct TemplateSimulationBuffer { values: array<TemplateBodySimulation> }
struct TemplateCombatStateBuffer { values: array<TemplateCombatState> }
struct TemplateAtomicTransformStateBuffer {
    values: array<TemplateAtomicTransformState>
}
struct EffectSummaryBuffer { values: array<EffectSummary> }
struct RawU32Buffer { values: array<u32> }
struct AtomicRawU32Buffer { values: array<atomic<u32>> }

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read_write> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(3) var<storage, read_write> temporaries: TemporaryBuffer;
@group(0) @binding(4) var<storage, read_write> contact_handlers: ContactHandlerBuffer;
@group(0) @binding(5) var<storage, read_write> combat_states: CombatStateBuffer;
@group(0) @binding(6) var<storage, read_write> atomic_transform_states: AtomicTransformStateBuffer;
@group(0) @binding(7) var<storage, read_write> prepare_program: PrepareProgram;
@group(0) @binding(8) var<storage, read_write> transform_program: TransformProgram;
@group(0) @binding(9) var<storage, read_write> effect_summaries: EffectSummaryBuffer;
@group(0) @binding(17) var<storage, read> template_physics: PhysicsBuffer;
@group(0) @binding(18) var<storage, read> template_simulations: TemplateSimulationBuffer;
@group(0) @binding(19) var<storage, read> template_temporaries: TemporaryBuffer;
@group(0) @binding(20) var<storage, read> template_contact_handlers: ContactHandlerBuffer;
@group(0) @binding(21) var<storage, read> template_combat_states: TemplateCombatStateBuffer;
@group(0) @binding(22) var<storage, read> template_atomic_transform_states: TemplateAtomicTransformStateBuffer;
@group(0) @binding(10) var<storage, read_write> effect_summary_words: RawU32Buffer;
@group(0) @binding(11) var<storage, read_write> effect_emitter_words: RawU32Buffer;
@group(0) @binding(12) var<storage, read_write> formation_words: RawU32Buffer;
@group(0) @binding(13) var<storage, read_write> render_style_words: RawU32Buffer;
@group(0) @binding(14) var<storage, read_write> enemy_behavior_words: RawU32Buffer;
@group(0) @binding(15) var<storage, read_write> body_control_words: RawU32Buffer;
@group(0) @binding(16) var<storage, read_write> effect_instance_words: RawU32Buffer;
@group(0) @binding(23) var<storage, read> template_effect_summary_words: RawU32Buffer;
@group(0) @binding(24) var<storage, read> template_effect_emitter_words: RawU32Buffer;
@group(0) @binding(25) var<storage, read> template_formation_words: RawU32Buffer;
@group(0) @binding(26) var<storage, read> template_render_style_words: RawU32Buffer;
@group(0) @binding(27) var<storage, read> template_enemy_behavior_words: RawU32Buffer;
@group(0) @binding(28) var<storage, read> template_body_control_words: RawU32Buffer;
@group(0) @binding(29) var<storage, read_write> effect_pool_words: AtomicRawU32Buffer;

fn mix_fingerprint(value: u32, next: u32) -> u32 {
    return (value ^ (next + 0x9e3779b9u + (value << 6u) + (value >> 2u)));
}

fn canonical_program_for_topology(topology_code: u32) -> u32 {
    if (topology_code == TOPOLOGY_ONE_TO_MANY) { return PROGRAM_J_SPLIT; }
    if (topology_code == TOPOLOGY_ONE_TO_ONE_DELAYED) {
        return PROGRAM_C_PRIME_RETURN;
    }
    return 0u;
}

fn canonical_phase_for_topology(topology_code: u32) -> u32 {
    if (topology_code == TOPOLOGY_ONE_TO_MANY) {
        return PHASE_SPLIT_PENDING;
    }
    if (topology_code == TOPOLOGY_ONE_TO_ONE_DELAYED) {
        return PHASE_CHILD_DELAYED;
    }
    return 0u;
}

fn authentic_record_fingerprint(record: PrepareRecord) -> u32 {
    var value = prepare_program.header.batch_id_fingerprint;
    value = mix_fingerprint(value, record.topology_code);
    value = mix_fingerprint(value, record.source_slot);
    value = mix_fingerprint(value, record.source_entity_id);
    value = mix_fingerprint(value, record.source_incarnation);
    value = mix_fingerprint(
        value,
        canonical_program_for_topology(record.topology_code)
    );
    value = mix_fingerprint(
        value,
        canonical_phase_for_topology(record.topology_code)
    );
    value = mix_fingerprint(value, record.due_fixed_tick);
    value = mix_fingerprint(value, record.lineage_root_entity_id);
    value = mix_fingerprint(value, record.lineage_root_incarnation);
    value = mix_fingerprint(value, record.branch_index);
    value = mix_fingerprint(value, record.bounty_budget);
    value = mix_fingerprint(value, record.command_generation);
    value = mix_fingerprint(
        value,
        bitcast<u32>(record.current_health_fixed_point)
    );
    value = mix_fingerprint(
        value,
        bitcast<u32>(record.max_health_fixed_point)
    );
    value = mix_fingerprint(value, record.trigger_source_tick);
    value = mix_fingerprint(value, record.trigger_sequence);
    if (value == 0u || value == INVALID_U32) { return value ^ 0xa511e9b3u; }
    return value;
}

fn transform_source_fingerprint(record: PrepareRecord) -> u32 {
    var value = transform_program.header.batch_id_fingerprint;
    value = mix_fingerprint(value, record.topology_code);
    value = mix_fingerprint(value, record.source_slot);
    value = mix_fingerprint(value, record.source_entity_id);
    value = mix_fingerprint(value, record.source_incarnation);
    value = mix_fingerprint(
        value,
        canonical_program_for_topology(record.topology_code)
    );
    value = mix_fingerprint(
        value,
        canonical_phase_for_topology(record.topology_code)
    );
    value = mix_fingerprint(value, record.due_fixed_tick);
    value = mix_fingerprint(value, record.lineage_root_entity_id);
    value = mix_fingerprint(value, record.lineage_root_incarnation);
    value = mix_fingerprint(value, record.branch_index);
    value = mix_fingerprint(value, record.bounty_budget);
    value = mix_fingerprint(value, record.command_generation);
    value = mix_fingerprint(
        value,
        bitcast<u32>(record.current_health_fixed_point)
    );
    value = mix_fingerprint(
        value,
        bitcast<u32>(record.max_health_fixed_point)
    );
    value = mix_fingerprint(value, record.trigger_source_tick);
    value = mix_fingerprint(value, record.trigger_sequence);
    if (value == 0u || value == INVALID_U32) { return value ^ 0xa511e9b3u; }
    return value;
}

@compute @workgroup_size(1)
fn clear_atomic_transform_prepare() {
    atomicStore(&prepare_program.header.record_count, 0u);
    atomicStore(&prepare_program.header.status, 0u);
    if (counts.abi_version != BODY_ABI_VERSION
        || prepare_program.header.abi_version != PREPARE_ABI_VERSION
        || prepare_program.header.target_fixed_tick
            != prepare_program.header.source_tick + 1u) {
        atomicOr(&prepare_program.header.status, STATUS_ABI_MISMATCH);
    }
}

@compute @workgroup_size(256)
fn prepare_atomic_transforms(@builtin(global_invocation_id) id: vec3u) {
    let slot = id.x;
    if (atomicLoad(&prepare_program.header.status) != 0u
        || slot >= counts.body_count) { return; }
    let entity_id = simulations.values[slot].entity_id;
    let incarnation = simulations.values[slot].incarnation;
    let flags = atomicLoad(&simulations.values[slot].flags);
    let health = atomicLoad(&simulations.values[slot].health);
    let program_id = atomic_transform_states.values[slot].program_id;
    let phase = atomicLoad(&atomic_transform_states.values[slot].phase);
    let stored_due = atomic_transform_states.values[slot].due_fixed_tick;
    let lineage_root_entity_id
        = atomic_transform_states.values[slot].lineage_root_entity_id;
    let lineage_root_incarnation
        = atomic_transform_states.values[slot].lineage_root_incarnation;
    let branch_index = atomic_transform_states.values[slot].branch_index;
    let command_generation = atomicLoad(
        &atomic_transform_states.values[slot].command_generation
    );
    let trigger_source_tick = atomicLoad(
        &atomic_transform_states.values[slot].trigger_source_tick
    );
    let trigger_sequence = atomicLoad(
        &atomic_transform_states.values[slot].trigger_sequence
    );
    var topology = 0u;
    var record_due = stored_due;
    let split_candidate
        = program_id == PROGRAM_J_SPLIT && phase == PHASE_SPLIT_PENDING;
    let delayed_candidate = program_id == PROGRAM_C_PRIME_RETURN
        && phase == PHASE_CHILD_DELAYED;
    if (!split_candidate && !delayed_candidate) { return; }
    // Death between host scheduling and this mark_dead-tail scan is a normal
    // zero-record outcome; malformed live transform state is protocol failure.
    if ((flags & BODY_FLAG_ALIVE) == 0u || health <= 0) { return; }
    if (program_id == PROGRAM_J_SPLIT && phase == PHASE_SPLIT_PENDING) {
        topology = TOPOLOGY_ONE_TO_MANY;
        record_due = prepare_program.header.target_fixed_tick;
    } else if (stored_due > 0u && stored_due != INVALID_U32
        && stored_due <= prepare_program.header.target_fixed_tick) {
        topology = TOPOLOGY_ONE_TO_ONE_DELAYED;
    } else if (stored_due > prepare_program.header.target_fixed_tick
        && stored_due != INVALID_U32) {
        return;
    }
    if (topology == 0u
        || entity_id == 0u || entity_id == INVALID_U32
        || incarnation == 0u || incarnation == INVALID_U32
        || atomic_transform_states.values[slot].entity_id != entity_id
        || atomic_transform_states.values[slot].incarnation != incarnation
        || lineage_root_entity_id == 0u
        || lineage_root_entity_id == INVALID_U32
        || lineage_root_incarnation == 0u
        || lineage_root_incarnation == INVALID_U32
        || branch_index > 1u
        || command_generation == 0u
        || command_generation == INVALID_U32
        || (split_candidate && (stored_due != 0u
            || trigger_source_tick == 0u
            || trigger_source_tick == INVALID_U32
            || trigger_sequence == INVALID_U32))
        || (delayed_candidate && (stored_due == 0u
            || stored_due == INVALID_U32
            || trigger_source_tick != 0u
            || trigger_sequence != 0u))) {
        atomicOr(&prepare_program.header.status, STATUS_RECORD_INVALID);
        return;
    }
    let max_health = effect_summaries.values[slot].max_health_fixed_point;
    if (effect_summaries.values[slot].entity_id != entity_id
        || effect_summaries.values[slot].incarnation != incarnation
        || max_health <= 0 || health > max_health) {
        atomicOr(&prepare_program.header.status, STATUS_RECORD_INVALID);
        return;
    }
    let index = atomicAdd(&prepare_program.header.record_count, 1u);
    if (index >= prepare_program.header.capacity
        || index >= arrayLength(&prepare_program.records)) {
        atomicOr(&prepare_program.header.status, STATUS_CAPACITY_EXCEEDED);
        return;
    }
    var record = PrepareRecord(
        topology, slot, entity_id, incarnation, record_due,
        lineage_root_entity_id,
        lineage_root_incarnation,
        branch_index,
        atomic_transform_states.values[slot].bounty_budget,
        command_generation,
        health, max_health, trigger_source_tick, trigger_sequence,
        PREPARE_RESULT_AUTHENTIC, 0u
    );
    record.record_fingerprint = authentic_record_fingerprint(record);
    prepare_program.records[index] = record;
}

fn fail_transform(index: u32, status: u32) {
    atomicOr(&transform_program.header.status, status);
    atomicMin(&transform_program.header.failure_record_index, index);
}

fn live_identity_component(value: u32) -> bool {
    return value > 0u && value != INVALID_U32;
}

fn inactive_identity_pair(entity_id: u32, incarnation: u32) -> bool {
    return (entity_id == 0u && incarnation == 0u)
        || (entity_id == INVALID_U32 && incarnation == INVALID_U32);
}

fn transform_record_is_disjoint(index: u32, record: TransformRecord) -> bool {
    for (var other_index = 0u;
        other_index < transform_program.header.count;
        other_index += 1u) {
        if (other_index == index) { continue; }
        let other = transform_program.records[other_index];
        if (record.source_slot == other.source_slot
            || record.source_entity_id == other.source_entity_id
            || (record.destination_count == 2u
                && (record.destination_1_slot == other.source_slot
                    || (other.destination_count == 2u
                        && record.destination_1_slot
                            == other.destination_1_slot)))
            || (other.destination_count == 2u
                && other.destination_1_slot == record.source_slot)
            || record.destination_0_entity_id
                == other.destination_0_entity_id
            || (record.destination_count == 2u
                && (record.destination_1_entity_id
                        == other.source_entity_id
                    || record.destination_1_entity_id
                        == other.destination_0_entity_id
                    || (other.destination_count == 2u
                        && record.destination_1_entity_id
                            == other.destination_1_entity_id)))
            || (other.destination_count == 2u
                && (record.source_entity_id
                        == other.destination_1_entity_id
                    || record.destination_0_entity_id
                        == other.destination_1_entity_id))) {
            return false;
        }
    }
    return true;
}

fn destination_1_entity_id_is_unoccupied(record: TransformRecord) -> bool {
    if (record.destination_count != 2u) { return true; }
    for (var slot = 0u; slot < counts.body_count; slot += 1u) {
        if ((atomicLoad(&simulations.values[slot].flags) & BODY_FLAG_ALIVE) != 0u
            && simulations.values[slot].entity_id
                == record.destination_1_entity_id) {
            return false;
        }
    }
    return true;
}

fn template_destination_is_exact(record: TransformRecord,
    destination_index: u32) -> bool {
    var slot = record.destination_0_slot;
    var entity_id = record.destination_0_entity_id;
    var incarnation = record.destination_0_incarnation;
    if (destination_index == 1u) {
        slot = record.destination_1_slot;
        entity_id = record.destination_1_entity_id;
        incarnation = record.destination_1_incarnation;
    }
    let template_health = template_simulations.values[slot].health;
    let template_flags = template_simulations.values[slot].flags;
    let template_max_health = bitcast<i32>(
        template_effect_summary_words.values[slot * 20u + 2u]
    );
    if (!live_identity_component(entity_id)
        || !live_identity_component(incarnation)
        || template_simulations.values[slot].entity_id != entity_id
        || template_simulations.values[slot].incarnation != incarnation
        || (template_flags & BODY_FLAG_ALIVE) == 0u
        || template_health <= 0 || template_max_health <= 0
        || template_health > template_max_health
        || template_effect_summary_words.values[slot * 20u] != entity_id
        || template_effect_summary_words.values[slot * 20u + 1u]
            != incarnation
        || template_atomic_transform_states.values[slot].entity_id != entity_id
        || template_atomic_transform_states.values[slot].incarnation
            != incarnation
        || template_atomic_transform_states.values[slot].trigger_source_tick
            != 0u
        || template_atomic_transform_states.values[slot].trigger_sequence
            != 0u
        || record.command_generation >= INVALID_U32 - 1u
        || template_atomic_transform_states.values[slot].command_generation
            != record.command_generation + 1u) {
        return false;
    }
    let source_slot = record.source_slot;
    let source_root_entity
        = atomic_transform_states.values[source_slot].lineage_root_entity_id;
    let source_root_incarnation
        = atomic_transform_states.values[source_slot].lineage_root_incarnation;
    let source_branch = atomic_transform_states.values[source_slot].branch_index;
    let source_bounty = atomic_transform_states.values[source_slot].bounty_budget;
    let split = record.topology_code == TOPOLOGY_ONE_TO_MANY;
    if (split) {
        let expected_bounty = select(
            source_bounty / 2u + source_bounty % 2u,
            source_bounty / 2u,
            destination_index == 1u
        );
        return transform_program.header.target_fixed_tick
                < INVALID_U32 - RETURN_DELAY_FIXED_TICKS
            && template_health == CIRCLE_PRIME_FRESH_HEALTH_FIXED_POINT
            && template_max_health == CIRCLE_PRIME_FRESH_HEALTH_FIXED_POINT
            && template_atomic_transform_states.values[slot].program_id
                == PROGRAM_C_PRIME_RETURN
            && template_atomic_transform_states.values[slot].phase
                == PHASE_CHILD_DELAYED
            && template_atomic_transform_states.values[slot].due_fixed_tick
                == transform_program.header.target_fixed_tick
                    + RETURN_DELAY_FIXED_TICKS
            && template_atomic_transform_states.values[slot]
                .lineage_root_entity_id == source_root_entity
            && template_atomic_transform_states.values[slot]
                .lineage_root_incarnation == source_root_incarnation
            && template_atomic_transform_states.values[slot].branch_index
                == destination_index
            && template_atomic_transform_states.values[slot].bounty_budget
                == expected_bounty;
    }
    return destination_index == 0u
        && template_health == record.source_current_health_fixed_point
        && template_max_health == record.source_max_health_fixed_point
        && template_atomic_transform_states.values[slot].program_id
            == PROGRAM_J_SPLIT
        && template_atomic_transform_states.values[slot].phase == PHASE_ARMED
        && template_atomic_transform_states.values[slot].due_fixed_tick == 0u
        && template_atomic_transform_states.values[slot]
            .lineage_root_entity_id == source_root_entity
        && template_atomic_transform_states.values[slot]
            .lineage_root_incarnation == source_root_incarnation
        && template_atomic_transform_states.values[slot].branch_index
            == source_branch
        && template_atomic_transform_states.values[slot].bounty_budget
            == source_bounty;
}

@compute @workgroup_size(1)
fn clear_atomic_transform_program() {
    atomicStore(&transform_program.header.status, 0u);
    atomicStore(&transform_program.header.batch_accepted, 0u);
    atomicStore(&transform_program.header.committed_count, 0u);
    atomicStore(&transform_program.header.effect_rekey_count, 0u);
    atomicStore(&transform_program.header.expected_effect_rekey_count, 0u);
    atomicStore(&transform_program.header.failure_record_index, INVALID_U32);
    if (counts.abi_version != BODY_ABI_VERSION
        || transform_program.header.abi_version != TRANSFORM_ABI_VERSION
        || transform_program.header.target_fixed_tick
            != transform_program.header.prepared_source_tick + 1u
        || transform_program.header.count > transform_program.header.capacity
        || transform_program.header.count > arrayLength(&transform_program.records)) {
        atomicOr(&transform_program.header.status, STATUS_ABI_MISMATCH);
    }
}

@compute @workgroup_size(256)
fn preflight_atomic_transform_records(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    if (index >= transform_program.header.count) { return; }
    transform_program.records[index].result = TRANSFORM_RESULT_PENDING;
    transform_program.records[index].effect_rekey_count = 0u;
    let record = transform_program.records[index];
    if (record.source_slot >= counts.body_count) {
        fail_transform(index, STATUS_SOURCE_CONFLICT);
        return;
    }
    let source_health = atomicLoad(
        &simulations.values[record.source_slot].health
    );
    let source_trigger_tick = atomicLoad(
        &atomic_transform_states.values[record.source_slot].trigger_source_tick
    );
    let source_trigger_sequence = atomicLoad(
        &atomic_transform_states.values[record.source_slot].trigger_sequence
    );
    if (simulations.values[record.source_slot].entity_id != record.source_entity_id
        || simulations.values[record.source_slot].incarnation != record.source_incarnation
        || atomic_transform_states.values[record.source_slot].entity_id
            != record.source_entity_id
        || atomic_transform_states.values[record.source_slot].incarnation
            != record.source_incarnation
        || (atomicLoad(&simulations.values[record.source_slot].flags)
            & BODY_FLAG_ALIVE) == 0u
        || source_health <= 0
        || source_health != record.source_current_health_fixed_point
        || effect_summaries.values[record.source_slot].entity_id
            != record.source_entity_id
        || effect_summaries.values[record.source_slot].incarnation
            != record.source_incarnation
        || effect_summaries.values[record.source_slot].max_health_fixed_point
            != record.source_max_health_fixed_point
        || record.source_current_health_fixed_point
            > record.source_max_health_fixed_point
        || atomicLoad(&atomic_transform_states.values[record.source_slot].command_generation)
            != record.command_generation
        || !live_identity_component(
            atomic_transform_states.values[record.source_slot]
                .lineage_root_entity_id
        )
        || !live_identity_component(
            atomic_transform_states.values[record.source_slot]
                .lineage_root_incarnation
        )
        || atomic_transform_states.values[record.source_slot].branch_index > 1u
        || record.command_generation == 0u
        || record.command_generation >= INVALID_U32 - 1u
        || source_trigger_tick != record.trigger_source_tick
        || source_trigger_sequence != record.trigger_sequence) {
        fail_transform(index, STATUS_SOURCE_CONFLICT);
        return;
    }
    let split = record.topology_code == TOPOLOGY_ONE_TO_MANY;
    let delayed = record.topology_code == TOPOLOGY_ONE_TO_ONE_DELAYED;
    let source_program = atomic_transform_states.values[record.source_slot].program_id;
    let source_phase = atomicLoad(
        &atomic_transform_states.values[record.source_slot].phase
    );
    let source_due = select(
        atomic_transform_states.values[record.source_slot].due_fixed_tick,
        transform_program.header.target_fixed_tick,
        split
    );
    var proof = PrepareRecord(
        record.topology_code,
        record.source_slot,
        record.source_entity_id,
        record.source_incarnation,
        source_due,
        atomic_transform_states.values[record.source_slot].lineage_root_entity_id,
        atomic_transform_states.values[record.source_slot].lineage_root_incarnation,
        atomic_transform_states.values[record.source_slot].branch_index,
        atomic_transform_states.values[record.source_slot].bounty_budget,
        record.command_generation,
        source_health,
        effect_summaries.values[record.source_slot].max_health_fixed_point,
        source_trigger_tick,
        source_trigger_sequence,
        PREPARE_RESULT_AUTHENTIC,
        0u
    );
    let proof_fingerprint = transform_source_fingerprint(proof);
    if ((!split && !delayed)
        || (split && (source_program != PROGRAM_J_SPLIT
            || source_phase != PHASE_SPLIT_PENDING
            || source_trigger_tick == 0u
            || source_trigger_tick == INVALID_U32
            || source_trigger_sequence == INVALID_U32))
        || (delayed && (source_program != PROGRAM_C_PRIME_RETURN
            || source_phase != PHASE_CHILD_DELAYED
            || source_due == 0u || source_due == INVALID_U32
            || source_due > transform_program.header.target_fixed_tick
            || source_trigger_tick != 0u
            || source_trigger_sequence != 0u))
        || proof_fingerprint != record.prepare_record_fingerprint
        || record.destination_count != select(1u, 2u, split)
        || record.effect_transfer_destination_index != 0u
        || record.destination_0_slot != record.source_slot
        || record.destination_0_entity_id != record.source_entity_id
        || record.destination_0_incarnation != record.source_incarnation + 1u
        || !live_identity_component(record.destination_0_incarnation)
        || (!split && (record.destination_1_slot != INVALID_U32
            || record.destination_1_entity_id != INVALID_U32
            || record.destination_1_incarnation != INVALID_U32))
        || (split && (record.destination_1_slot == record.source_slot
            || record.destination_1_slot >= counts.body_count
            || record.destination_1_entity_id == 0u
            || record.destination_1_entity_id == INVALID_U32
            || record.destination_1_entity_id == record.source_entity_id
            || record.destination_1_incarnation == 0u
            || record.destination_1_incarnation == INVALID_U32
            || (atomicLoad(&simulations.values[record.destination_1_slot].flags)
                & BODY_FLAG_ALIVE) != 0u
            || !inactive_identity_pair(
                simulations.values[record.destination_1_slot].entity_id,
                simulations.values[record.destination_1_slot].incarnation
            )))
        || !destination_1_entity_id_is_unoccupied(record)
        || !transform_record_is_disjoint(index, record)
        || !template_destination_is_exact(record, 0u)
        || (split && !template_destination_is_exact(record, 1u))) {
        fail_transform(index, STATUS_DESTINATION_CONFLICT);
    }
}

@compute @workgroup_size(1)
fn seal_atomic_transform_program() {
    if (atomicLoad(&transform_program.header.status) == 0u) {
        atomicStore(&transform_program.header.batch_accepted, 1u);
        return;
    }
    for (var index = 0u; index < transform_program.header.count; index += 1u) {
        transform_program.records[index].result = TRANSFORM_RESULT_BATCH_REJECTED;
    }
}

@compute @workgroup_size(1)
fn preflight_atomic_transform_effect_rekeys() {
    if (atomicLoad(&transform_program.header.status) != 0u) { return; }
    for (var record_index = 0u;
        record_index < transform_program.header.count;
        record_index += 1u) {
        transform_program.records[record_index].effect_rekey_count = 0u;
    }
    var expected = 0u;
    if (arrayLength(&effect_pool_words.values) < 16u
        || atomicLoad(&effect_pool_words.values[0])
            != EFFECT_RUNTIME_ABI_VERSION) {
        atomicOr(
            &transform_program.header.status,
            STATUS_EFFECT_REKEY_MISMATCH
        );
        return;
    }
    let input_count = atomicLoad(&effect_pool_words.values[1]);
    if (input_count > arrayLength(&effect_instance_words.values) / 16u) {
        atomicOr(
            &transform_program.header.status,
            STATUS_EFFECT_REKEY_MISMATCH
        );
        return;
    }
    for (var instance_index = 0u; instance_index < input_count;
        instance_index += 1u) {
        let base = instance_index * 16u;
        if ((effect_instance_words.values[base + 4u] & 1u) == 0u) {
            continue;
        }
        let applied_tick = effect_instance_words.values[base + 11u];
        let expires_at_tick = effect_instance_words.values[base + 12u];
        if (applied_tick > transform_program.header.target_fixed_tick
            || transform_program.header.target_fixed_tick
                >= expires_at_tick) {
            continue;
        }
        let target_slot = effect_instance_words.values[base + 8u];
        let target_entity_id = effect_instance_words.values[base + 9u];
        let target_incarnation = effect_instance_words.values[base + 10u];
        for (var record_index = 0u;
            record_index < transform_program.header.count;
            record_index += 1u) {
            if (transform_program.records[record_index].source_entity_id
                    == target_entity_id
                && transform_program.records[record_index].source_incarnation
                    == target_incarnation) {
                if (target_slot
                        != transform_program.records[record_index].source_slot) {
                    atomicOr(
                        &transform_program.header.status,
                        STATUS_EFFECT_REKEY_MISMATCH
                    );
                    return;
                }
                expected += 1u;
                break;
            }
        }
    }
    atomicStore(
        &transform_program.header.expected_effect_rekey_count,
        expected
    );
}

fn write_body_destination(record: TransformRecord, destination_slot: u32,
    template_slot: u32, source_position: vec2f, source_velocity: vec2f,
    source_previous_position: vec2f, source_predicted_position: vec2f,
    source_position_delta: vec2f, source_grid_index: i32,
    source_previous_flow_field_index: u32, source_flow_field_index: u32,
    source_flow_speed: f32, source_flags: u32) {
    physics.values[destination_slot].position = source_position;
    physics.values[destination_slot].velocity = source_velocity;
    physics.values[destination_slot].radius = template_physics.values[template_slot].radius;
    physics.values[destination_slot].inverse_mass = template_physics.values[template_slot].inverse_mass;
    physics.values[destination_slot].physical_meta = template_physics.values[template_slot].physical_meta;
    physics.values[destination_slot].interaction_meta = template_physics.values[template_slot].interaction_meta;
    temporaries.values[destination_slot].previous_position = source_previous_position;
    temporaries.values[destination_slot].predicted_position = source_predicted_position;
    temporaries.values[destination_slot].position_delta = source_position_delta;
    temporaries.values[destination_slot].grid_index = source_grid_index;
    temporaries.values[destination_slot].previous_flow_field_index = source_previous_flow_field_index;
    simulations.values[destination_slot].lifetime = template_simulations.values[template_slot].lifetime;
    atomicStore(&simulations.values[destination_slot].health,
        template_simulations.values[template_slot].health);
    simulations.values[destination_slot].gameplay_meta = template_simulations.values[template_slot].gameplay_meta;
    atomicStore(&simulations.values[destination_slot].flags,
        (template_simulations.values[template_slot].flags
            & ~BODY_FLAG_USE_FLOW) | (source_flags & BODY_FLAG_USE_FLOW));
    simulations.values[destination_slot].flow_field_index = source_flow_field_index;
    simulations.values[destination_slot].flow_speed = source_flow_speed;
    simulations.values[destination_slot].entity_id = template_simulations.values[template_slot].entity_id;
    simulations.values[destination_slot].incarnation = template_simulations.values[template_slot].incarnation;
}

@compute @workgroup_size(256)
fn commit_atomic_transform_bodies(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    if (atomicLoad(&transform_program.header.batch_accepted) == 0u
        || index >= transform_program.header.count) { return; }
    let record = transform_program.records[index];
    let source_slot = record.source_slot;
    let source_position = physics.values[source_slot].position;
    let source_velocity = physics.values[source_slot].velocity;
    let source_previous_position = temporaries.values[source_slot].previous_position;
    let source_predicted_position = temporaries.values[source_slot].predicted_position;
    let source_position_delta = temporaries.values[source_slot].position_delta;
    let source_grid_index = temporaries.values[source_slot].grid_index;
    let source_previous_flow_field_index = temporaries.values[source_slot].previous_flow_field_index;
    let source_flow_field_index = simulations.values[source_slot].flow_field_index;
    let source_flow_speed = simulations.values[source_slot].flow_speed;
    let source_flags = atomicLoad(&simulations.values[source_slot].flags);
    write_body_destination(record, record.destination_0_slot,
        record.destination_0_slot, source_position, source_velocity,
        source_previous_position, source_predicted_position, source_position_delta,
        source_grid_index, source_previous_flow_field_index,
        source_flow_field_index, source_flow_speed, source_flags);
    if (record.destination_count == 2u) {
        write_body_destination(record, record.destination_1_slot,
            record.destination_1_slot, source_position, source_velocity,
            source_previous_position, source_predicted_position, source_position_delta,
            source_grid_index, source_previous_flow_field_index,
            source_flow_field_index, source_flow_speed, source_flags);
    }
}

fn write_state_destination(destination_slot: u32, template_slot: u32) {
    contact_handlers.values[destination_slot] = template_contact_handlers.values[template_slot];
    combat_states.values[destination_slot].target_interaction_layer_mask
        = template_combat_states.values[template_slot].target_interaction_layer_mask;
    combat_states.values[destination_slot].maximum_damage_window_duration_fixed_ticks
        = template_combat_states.values[template_slot].maximum_damage_window_duration_fixed_ticks;
    atomicStore(&combat_states.values[destination_slot].peak_final_damage_fixed_point,
        template_combat_states.values[template_slot].peak_final_damage_fixed_point);
    atomicStore(&combat_states.values[destination_slot].expires_at_fixed_tick,
        template_combat_states.values[template_slot].expires_at_fixed_tick);
    atomicStore(&combat_states.values[destination_slot].peak_source_entity_id,
        template_combat_states.values[template_slot].peak_source_entity_id);
    atomicStore(&combat_states.values[destination_slot].peak_source_incarnation,
        template_combat_states.values[template_slot].peak_source_incarnation);
    combat_states.values[destination_slot].reserved_0 = 0u;
    combat_states.values[destination_slot].reserved_1 = 0u;
    combat_states.values[destination_slot].reserved_2 = 0u;
    combat_states.values[destination_slot].reserved_3 = 0u;
    atomic_transform_states.values[destination_slot].program_id
        = template_atomic_transform_states.values[template_slot].program_id;
    atomicStore(&atomic_transform_states.values[destination_slot].phase,
        template_atomic_transform_states.values[template_slot].phase);
    atomic_transform_states.values[destination_slot].entity_id
        = template_atomic_transform_states.values[template_slot].entity_id;
    atomic_transform_states.values[destination_slot].incarnation
        = template_atomic_transform_states.values[template_slot].incarnation;
    atomic_transform_states.values[destination_slot].due_fixed_tick
        = template_atomic_transform_states.values[template_slot].due_fixed_tick;
    atomic_transform_states.values[destination_slot].lineage_root_entity_id
        = template_atomic_transform_states.values[template_slot].lineage_root_entity_id;
    atomic_transform_states.values[destination_slot].lineage_root_incarnation
        = template_atomic_transform_states.values[template_slot].lineage_root_incarnation;
    atomic_transform_states.values[destination_slot].branch_index
        = template_atomic_transform_states.values[template_slot].branch_index;
    atomic_transform_states.values[destination_slot].bounty_budget
        = template_atomic_transform_states.values[template_slot].bounty_budget;
    atomicStore(&atomic_transform_states.values[destination_slot].trigger_source_tick, 0u);
    atomicStore(&atomic_transform_states.values[destination_slot].trigger_sequence, 0u);
    atomicStore(&atomic_transform_states.values[destination_slot].command_generation,
        template_atomic_transform_states.values[template_slot].command_generation);
}

@compute @workgroup_size(256)
fn commit_atomic_transform_state(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    if (atomicLoad(&transform_program.header.batch_accepted) == 0u
        || index >= transform_program.header.count) { return; }
    let record = transform_program.records[index];
    write_state_destination(record.destination_0_slot, record.destination_0_slot);
    if (record.destination_count == 2u) {
        write_state_destination(record.destination_1_slot, record.destination_1_slot);
    }
    transform_program.records[index].result = TRANSFORM_RESULT_COMMITTED;
    atomicAdd(&transform_program.header.committed_count, 1u);
}

fn copy_words(destination_slot: u32, template_slot: u32, stride_words: u32,
    destination: ptr<storage, array<u32>, read_write>,
    template: ptr<storage, array<u32>, read>) {
    let destination_base = destination_slot * stride_words;
    let template_base = template_slot * stride_words;
    for (var word = 0u; word < stride_words; word += 1u) {
        (*destination)[destination_base + word] = (*template)[template_base + word];
    }
}

fn commit_aux_destination(destination_slot: u32, template_slot: u32) {
    copy_words(destination_slot, template_slot, 20u,
        &effect_summary_words.values, &template_effect_summary_words.values);
    copy_words(destination_slot, template_slot, 8u,
        &effect_emitter_words.values, &template_effect_emitter_words.values);
    copy_words(destination_slot, template_slot, 20u,
        &formation_words.values, &template_formation_words.values);
    copy_words(destination_slot, template_slot, 8u,
        &render_style_words.values, &template_render_style_words.values);
}

@compute @workgroup_size(256)
fn commit_atomic_transform_auxiliary(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    if (atomicLoad(&transform_program.header.batch_accepted) == 0u
        || index >= transform_program.header.count) { return; }
    let record = transform_program.records[index];
    commit_aux_destination(record.destination_0_slot, record.destination_0_slot);
    if (record.destination_count == 2u) {
        commit_aux_destination(record.destination_1_slot, record.destination_1_slot);
    }
}

fn commit_control_destination(destination_slot: u32, template_slot: u32) {
    copy_words(destination_slot, template_slot, 20u,
        &enemy_behavior_words.values, &template_enemy_behavior_words.values);
    copy_words(destination_slot, template_slot, 16u,
        &body_control_words.values, &template_body_control_words.values);
}

@compute @workgroup_size(256)
fn commit_atomic_transform_control(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    if (atomicLoad(&transform_program.header.batch_accepted) == 0u
        || index >= transform_program.header.count) { return; }
    let record = transform_program.records[index];
    commit_control_destination(record.destination_0_slot, record.destination_0_slot);
    if (record.destination_count == 2u) {
        commit_control_destination(record.destination_1_slot, record.destination_1_slot);
    }
}

@compute @workgroup_size(1)
fn rekey_atomic_transform_effect_instances() {
    // EffectPoolState input_count is u32 word 1. This pass runs before retain.
    if (atomicLoad(&transform_program.header.batch_accepted) == 0u) { return; }
    if (arrayLength(&effect_pool_words.values) < 16u
        || atomicLoad(&effect_pool_words.values[0])
            != EFFECT_RUNTIME_ABI_VERSION) {
        atomicOr(
            &transform_program.header.status,
            STATUS_EFFECT_REKEY_MISMATCH
        );
        return;
    }
    let input_count = atomicLoad(&effect_pool_words.values[1]);
    if (input_count > arrayLength(&effect_instance_words.values) / 16u) {
        atomicOr(
            &transform_program.header.status,
            STATUS_EFFECT_REKEY_MISMATCH
        );
        return;
    }
    var actual = 0u;
    for (var instance_index = 0u; instance_index < input_count;
        instance_index += 1u) {
        let base = instance_index * 16u;
        if ((effect_instance_words.values[base + 4u] & 1u) == 0u) {
            continue;
        }
        let applied_tick = effect_instance_words.values[base + 11u];
        let expires_at_tick = effect_instance_words.values[base + 12u];
        if (applied_tick > transform_program.header.target_fixed_tick
            || transform_program.header.target_fixed_tick
                >= expires_at_tick) {
            continue;
        }
        let target_slot = effect_instance_words.values[base + 8u];
        let target_entity_id = effect_instance_words.values[base + 9u];
        let target_incarnation = effect_instance_words.values[base + 10u];
        for (var index = 0u; index < transform_program.header.count;
            index += 1u) {
            if (transform_program.records[index].source_entity_id
                    == target_entity_id
                && transform_program.records[index].source_incarnation
                    == target_incarnation) {
                if (target_slot != transform_program.records[index].source_slot) {
                    atomicOr(
                        &transform_program.header.status,
                        STATUS_EFFECT_REKEY_MISMATCH
                    );
                    return;
                }
                effect_instance_words.values[base + 8u]
                    = transform_program.records[index].destination_0_slot;
                effect_instance_words.values[base + 9u]
                    = transform_program.records[index].destination_0_entity_id;
                effect_instance_words.values[base + 10u]
                    = transform_program.records[index].destination_0_incarnation;
                transform_program.records[index].effect_rekey_count += 1u;
                actual += 1u;
                break;
            }
        }
    }
    atomicStore(&transform_program.header.effect_rekey_count, actual);
}

@compute @workgroup_size(1)
fn finalize_atomic_transform_program() {
    if (atomicLoad(&transform_program.header.batch_accepted) != 0u
        && atomicLoad(&transform_program.header.committed_count)
            != transform_program.header.count) {
        atomicOr(&transform_program.header.status, STATUS_COMMIT_COUNT_MISMATCH);
    }
    let expected_effects = atomicLoad(
        &transform_program.header.expected_effect_rekey_count
    );
    let actual_effects = atomicLoad(
        &transform_program.header.effect_rekey_count
    );
    var record_effects = 0u;
    for (var index = 0u; index < transform_program.header.count; index += 1u) {
        record_effects += transform_program.records[index].effect_rekey_count;
    }
    if (expected_effects != actual_effects || record_effects != actual_effects) {
        atomicOr(
            &transform_program.header.status,
            STATUS_EFFECT_REKEY_MISMATCH
        );
    }
}
`;

export const GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT = Object.freeze({
    CLEAR_PREPARE: 'clear_atomic_transform_prepare',
    PREPARE: 'prepare_atomic_transforms',
    CLEAR_TRANSFORM: 'clear_atomic_transform_program',
    PREFLIGHT_TRANSFORM: 'preflight_atomic_transform_records',
    PREFLIGHT_EFFECT_REKEYS: 'preflight_atomic_transform_effect_rekeys',
    SEAL_TRANSFORM: 'seal_atomic_transform_program',
    COMMIT_BODIES: 'commit_atomic_transform_bodies',
    COMMIT_STATE: 'commit_atomic_transform_state',
    COMMIT_AUXILIARY: 'commit_atomic_transform_auxiliary',
    COMMIT_CONTROL: 'commit_atomic_transform_control',
    REKEY_EFFECTS: 'rekey_atomic_transform_effect_instances',
    FINALIZE_TRANSFORM: 'finalize_atomic_transform_program'
});
