import {
    GPU_CIRCLE_BODY_RENDER_SHAPE,
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_LAYER,
    GPU_CIRCLE_BODY_SIMULATION_FLAG
} from './gpu_circle_body_abi.js';
import {
    GPU_EFFECT_INSTANCE_FLAG,
    GPU_EFFECT_RUNTIME_ABI_VERSION
} from './gpu_effect_runtime_abi.js';
import {
    GPU_FORMATION_BODY_STATE_FLAG,
    GPU_FORMATION_HEX_RING,
    GPU_FORMATION_IDENTITY_INVALID,
    GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG,
    GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
    GPU_FORMATION_PREPARE_PROGRAM_FLAG,
    GPU_FORMATION_PREPARE_RESULT,
    GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON,
    GPU_FORMATION_PROGRAM_INDEX_INVALID,
    GPU_FORMATION_RUNTIME_ABI_VERSION,
    GPU_FORMATION_RUNTIME_STATUS,
    GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
    GPU_FORMATION_TRANSFORM_RESULT
} from './gpu_formation_runtime_abi.js';
import {
    GPU_ENEMY_FORMATION_DEFINITION_CODE,
    HEXA_HIVE_SIX_RING_FORMATION_DEFINITION
} from '../../../../data/object/enemy/enemy_formation_catalog_data.js';
import {
    BASIC_HEXA_MAXIMUM_MEMBER_COUNT,
    resolveBasicHexaFormationStats
} from '../../../../data/object/enemy/basic_hexa_enemy_data.js';
import {
    FORMATION_COORDINATE_SYSTEM_CODE,
    ENEMY_FORMATION_POLICY_CODE
} from '../../contract/enemy_formation_contract.js';
import {
    GPU_ROUTE_RUNTIME_ABI,
    GPU_ROUTE_RUNTIME_ROLE
} from './gpu_route_runtime_abi.js';

const toWgslFloat = (value) => {
    const normalized = Math.fround(Number(value));
    if (!Number.isFinite(normalized)) {
        throw new TypeError('Formation WGSL 상수는 유한 float32여야 합니다.');
    }
    const literal = String(Object.is(normalized, -0) ? 0 : normalized);
    return /[.eE]/.test(literal) ? literal : `${literal}.0`;
};

const statsByMemberCount = Array.from(
    { length: BASIC_HEXA_MAXIMUM_MEMBER_COUNT + 1 },
    (_, memberCount) => memberCount === 0
        ? Object.freeze({
            inverseMass: 0,
            moveSpeedTilesPerSecond: 0,
            towerContactDamage: 0
        })
        : resolveBasicHexaFormationStats(memberCount)
);

const wgslFloatArray = (field) => `array<f32, 7>(${statsByMemberCount
    .map((entry) => toWgslFloat(entry[field]))
    .join(', ')})`;

const axialSlots = HEXA_HIVE_SIX_RING_FORMATION_DEFINITION.slotCoordinates;
const rotationMap = GPU_FORMATION_HEX_RING.ROTATE_PLUS_60_SOURCE_TO_DESTINATION;
if (axialSlots.length !== GPU_FORMATION_HEX_RING.SLOT_COUNT
    || axialSlots.some((slot, index) => (
        slot.q !== GPU_FORMATION_HEX_RING.AXIAL_SLOTS[index].q
        || slot.r !== GPU_FORMATION_HEX_RING.AXIAL_SLOTS[index].r
    ))
    || rotationMap.join(',') !== '5,0,1,2,3,4') {
    throw new RangeError('Formation catalog/ABI HEX_AXIAL ring이 LOCK과 다릅니다.');
}

/**
 * 독립 Formation state, post-solver bounded prepare, next-boundary atomic
 * transform 및 active Effect target rekey shader입니다.
 */
export const GPU_FORMATION_RUNTIME_COMPUTE_WGSL = /* wgsl */`
const BODY_ABI_VERSION: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;
const EFFECT_RUNTIME_ABI_VERSION: u32 = ${GPU_EFFECT_RUNTIME_ABI_VERSION}u;
const FORMATION_RUNTIME_ABI_VERSION: u32 = ${GPU_FORMATION_RUNTIME_ABI_VERSION}u;
const PREPARE_ABI_VERSION: u32 = ${GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION}u;
const TRANSFORM_ABI_VERSION: u32 = ${GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION}u;
const INVALID: u32 = ${GPU_FORMATION_IDENTITY_INVALID}u;
const INVALID_PROGRAM: u32 = ${GPU_FORMATION_PROGRAM_INDEX_INVALID}u;
const BODY_FLAG_ALIVE: u32 = 1u;
const BODY_FLAG_USE_FLOW: u32 = 2u;
const BODY_FLAG_EXTERNAL_MOTION_OWNER_THIS_TICK: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.EXTERNAL_MOTION_OWNER_THIS_TICK}u;
const BODY_FLAG_COUNT_AS_KILL: u32 = 4u;
const DESTINATION_BODY_FLAGS: u32 = BODY_FLAG_ALIVE
    | BODY_FLAG_USE_FLOW | BODY_FLAG_COUNT_AS_KILL;
const BODY_LAYER_ENEMY: u32 = ${GPU_CIRCLE_BODY_LAYER.ENEMY}u;
const RENDER_SHAPE_HEXA: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.HEXA}u;
const FORMATION_FLAG_ACTIVE: u32 = ${GPU_FORMATION_BODY_STATE_FLAG.ACTIVE}u;
const FORMATION_FLAG_TRANSFORMED: u32 = ${GPU_FORMATION_BODY_STATE_FLAG.TRANSFORMED}u;
const FORMATION_FLAG_MERGE_PULSE: u32 = ${GPU_FORMATION_BODY_STATE_FLAG.PRESENTATION_MERGE_PULSE}u;
const FORMATION_FLAG_GRID_OVERFLOW: u32 = ${GPU_FORMATION_BODY_STATE_FLAG.GRID_OVERFLOW_OBSERVED}u;
const FORMATION_FLAG_RESERVATION: u32 = ${GPU_FORMATION_BODY_STATE_FLAG.PRESENTATION_RESERVATION}u;
const MOTION_DIAGNOSTIC_ROUTE_SPAN_REJECTED: u32 = ${GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG.ROUTE_SPAN_REJECTED}u;
const MOTION_DIAGNOSTIC_REVERSE_REJECTED: u32 = ${GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG.REVERSE_PROGRESS_REJECTED}u;
const MOTION_DIAGNOSTIC_SDF_SEGMENT_REJECTED: u32 = ${GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG.SDF_SEGMENT_REJECTED}u;
const MOTION_DIAGNOSTIC_CANDIDATE_ACCEPTED: u32 = ${GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG.CANDIDATE_ACCEPTED}u;
const MOTION_DIAGNOSTIC_NO_REVERSE_CLAMPED: u32 = ${GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG.NO_REVERSE_CLAMPED}u;
const MOTION_DIAGNOSTIC_SDF_STEERING_REJECTED: u32 = ${GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG.SDF_STEERING_REJECTED}u;
const MOTION_DIAGNOSTIC_STEERING_APPLIED: u32 = ${GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG.STEERING_APPLIED}u;
const MOTION_DIAGNOSTIC_PURE_FLOW_FALLBACK: u32 = ${GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG.PURE_FLOW_FALLBACK}u;
const MOTION_DIAGNOSTIC_GRID_OVERFLOW_FALLBACK: u32 = ${GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG.GRID_OVERFLOW_FALLBACK}u;
const PREPARE_FLAG_ALLOW_SOURCE_INVALID: u32 = ${GPU_FORMATION_PREPARE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID}u;
const PREPARE_RESULT_PENDING: u32 = ${GPU_FORMATION_PREPARE_RESULT.PENDING}u;
const PREPARE_RESULT_NO_PAIR: u32 = ${GPU_FORMATION_PREPARE_RESULT.NO_PAIR}u;
const PREPARE_RESULT_MUTUAL_PAIR: u32 = ${GPU_FORMATION_PREPARE_RESULT.MUTUAL_PAIR}u;
const PREPARE_RESULT_SOURCE_INVALID: u32 = ${GPU_FORMATION_PREPARE_RESULT.SOURCE_INVALID}u;
const PREPARE_RESULT_GRID_OVERFLOW: u32 = ${GPU_FORMATION_PREPARE_RESULT.GRID_OVERFLOW}u;
const PREPARE_RESULT_POLICY_REJECTED: u32 = ${GPU_FORMATION_PREPARE_RESULT.POLICY_REJECTED}u;
const SOURCE_INVALID_REASON_NONE: u32 = ${GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.NONE}u;
const SOURCE_INVALID_REASON_LIFECYCLE_REMOVED: u32 = ${GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.LIFECYCLE_REMOVED}u;
const SOURCE_INVALID_REASON_DIED_AFTER_STAGE: u32 = ${GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.DIED_AFTER_STAGE}u;
const TRANSFORM_RESULT_PENDING: u32 = ${GPU_FORMATION_TRANSFORM_RESULT.PENDING}u;
const TRANSFORM_RESULT_COMMITTED: u32 = ${GPU_FORMATION_TRANSFORM_RESULT.COMMITTED}u;
const TRANSFORM_RESULT_BATCH_REJECTED: u32 = ${GPU_FORMATION_TRANSFORM_RESULT.BATCH_REJECTED}u;
const STATUS_ABI_MISMATCH: u32 = ${GPU_FORMATION_RUNTIME_STATUS.ABI_MISMATCH}u;
const STATUS_PROGRAM_CAPACITY: u32 = ${GPU_FORMATION_RUNTIME_STATUS.PROGRAM_CAPACITY_EXCEEDED}u;
const STATUS_RECORD_INVALID: u32 = ${GPU_FORMATION_RUNTIME_STATUS.RECORD_INVALID}u;
const STATUS_GRID_OVERFLOW: u32 = ${GPU_FORMATION_RUNTIME_STATUS.GRID_OVERFLOW}u;
const STATUS_SOURCE_CONFLICT: u32 = ${GPU_FORMATION_RUNTIME_STATUS.SOURCE_CONFLICT}u;
const STATUS_DESTINATION_CONFLICT: u32 = ${GPU_FORMATION_RUNTIME_STATUS.DESTINATION_CONFLICT}u;
const STATUS_HP_OVERFLOW: u32 = ${GPU_FORMATION_RUNTIME_STATUS.HP_OVERFLOW}u;
const STATUS_EFFECT_CONFLICT: u32 = ${GPU_FORMATION_RUNTIME_STATUS.EFFECT_CONFLICT}u;
const STATUS_GENERATION_EXHAUSTED: u32 = ${GPU_FORMATION_RUNTIME_STATUS.GENERATION_EXHAUSTED}u;
const FORMATION_DEFINITION_HEXA_RING: u32 = ${GPU_ENEMY_FORMATION_DEFINITION_CODE.HEXA_HIVE_SIX_RING}u;
const COORDINATE_HEX_AXIAL: u32 = ${FORMATION_COORDINATE_SYSTEM_CODE.HEX_AXIAL}u;
const POLICY_SEEK_FORMATION: u32 = ${ENEMY_FORMATION_POLICY_CODE.SEEK_FORMATION}u;
const POLICY_KEEP_FORMATION: u32 = ${ENEMY_FORMATION_POLICY_CODE.KEEP_FORMATION}u;
const MAX_MEMBERS: u32 = ${BASIC_HEXA_MAXIMUM_MEMBER_COUNT}u;
const OCCUPIED_MASK: u32 = ${GPU_FORMATION_HEX_RING.OCCUPIED_MASK}u;
const MERGE_SEEK_RADIUS: f32 = ${toWgslFloat(
    HEXA_HIVE_SIX_RING_FORMATION_DEFINITION.mergeSeekRadiusTiles
)};
const MERGE_COMMIT_DISTANCE: f32 = ${toWgslFloat(
    HEXA_HIVE_SIX_RING_FORMATION_DEFINITION.mergeCommitDistanceTiles
)};
const MAX_SDF_SAMPLES: u32 = ${HEXA_HIVE_SIX_RING_FORMATION_DEFINITION.maximumSdfSegmentSamples}u;
const CORRIDOR_CLEARANCE_SCALE: f32 = ${toWgslFloat(
    HEXA_HIVE_SIX_RING_FORMATION_DEFINITION.corridorClearanceRadiusScale
)};
const EFFECT_INSTANCE_ACTIVE: u32 = ${GPU_EFFECT_INSTANCE_FLAG.ACTIVE}u;
const ROUTE_ROLE_NONE: u32 = ${GPU_ROUTE_RUNTIME_ROLE.NONE}u;
const ROUTE_ROLE_ACTOR: u32 = ${GPU_ROUTE_RUNTIME_ROLE.ACTOR}u;
const ROUTE_ROLE_CLOSER: u32 = ${GPU_ROUTE_RUNTIME_ROLE.CLOSER}u;
const ROUTE_TOPOLOGY_PATH_COUNT_WORD: u32 = ${GPU_ROUTE_RUNTIME_ABI.TOPOLOGY_HEADER.PATH_COUNT / 4}u;
const ROUTE_TOPOLOGY_PATH_OFFSET_WORD: u32 = ${GPU_ROUTE_RUNTIME_ABI.TOPOLOGY_HEADER.PATH_OFFSET_WORDS / 4}u;
const ROUTE_TOPOLOGY_PATH_STRIDE_WORDS: u32 = ${GPU_ROUTE_RUNTIME_ABI.PATH.STRIDE_WORDS}u;
const INT32_MAX_VALUE: i32 = 2147483647;
const FLOAT_UNREACHABLE: f32 = 10000000000000000000.0;
const EPSILON: f32 = 0.000001;
const HEXA_INVERSE_MASS = ${wgslFloatArray('inverseMass')};
const HEXA_FLOW_SPEED = ${wgslFloatArray('moveSpeedTilesPerSecond')};
const HEXA_TOWER_DAMAGE = ${wgslFloatArray('towerContactDamage')};
const ROTATE_PLUS_60 = array<u32, 6>(5u, 0u, 1u, 2u, 3u, 4u);
const HEX_DIRECTIONS = array<vec2f, 6>(
    vec2f(1.0, 0.0),
    vec2f(0.5, -0.8660254037844386),
    vec2f(-0.5, -0.8660254037844386),
    vec2f(-1.0, 0.0),
    vec2f(-0.5, 0.8660254037844386),
    vec2f(0.5, 0.8660254037844386)
);

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

struct BodyTemporary {
    previous_position: vec2f,
    predicted_position: vec2f,
    position_delta: vec2f,
    grid_index: i32,
    previous_flow_field_index: u32,
}

struct ContactHandler {
    damage_self: f32,
    damage_other: f32,
    damage_falloff: f32,
    fire_timer: f32,
    flags: u32,
    chaining: i32,
    damage_report_id: i32,
    slow_timer: f32,
}

struct CombatState {
    target_interaction_layer_mask: u32,
    maximum_damage_window_duration_fixed_ticks: u32,
    peak_final_damage_fixed_point: i32,
    expires_at_fixed_tick: u32,
    peak_source_entity_id: u32,
    peak_source_incarnation: u32,
    reserved_0: u32,
    reserved_1: u32,
    reserved_2: u32,
    reserved_3: u32,
}

struct FormationState {
    entity_id: u32,
    incarnation: u32,
    definition_code: u32,
    coordinate_system_code: u32,
    policy_code: u32,
    member_count: u32,
    occupied_slot_mask: u32,
    rotation_step: u32,
    generation: u32,
    flags: u32,
    lineage_hash: u32,
    route_first_field_index: u32,
    route_field_count: u32,
    last_merge_tick: u32,
    presentation_flags: u32,
    presentation_tick: u32,
    partner_entity_id: u32,
    partner_incarnation: u32,
    reserved_0: u32,
    reserved_1: u32,
}

struct FormationCandidateState {
    program_index: atomic<u32>,
    candidate_program_index: u32,
    candidate_slot: u32,
    candidate_entity_id: u32,
    candidate_incarnation: u32,
    root_program_index: u32,
    destination_member_count: u32,
    destination_occupied_slot_mask: u32,
    destination_rotation_step: u32,
    distance_squared: f32,
    status: atomic<u32>,
    reserved_0: atomic<u32>,
}

struct FormationCandidateRank {
    slot: u32,
    program_index: u32,
    entity_id: u32,
    incarnation: u32,
    distance_squared: f32,
    forward_stage_delta: u32,
    forward_cost_delta: f32,
    root_entity_id: u32,
    root_incarnation: u32,
    rotation_step: u32,
}

struct EffectSummary {
    entity_id: u32,
    incarnation: u32,
    max_health_fixed_point: i32,
    authored_damage_other: f32,
    resolved_base_damage_other: f32,
    active_family_mask: atomic<u32>,
    boost_stack_count: atomic<u32>,
    regen_per_tick_fixed_point: i32,
    attack_multiplier: f32,
    move_speed_multiplier: f32,
    presentation_tags: atomic<u32>,
    presentation_magnitude: f32,
    last_pulse_tick: u32,
    pulse_style_code: u32,
    summary_tick: u32,
    source_snapshot_tick: u32,
    damage_taken_multiplier: f32,
    reserved_0: u32,
    reserved_1: u32,
    flags: atomic<u32>,
}

struct EffectEmitterState {
    entity_id: u32,
    incarnation: u32,
    emitter_definition_code: u32,
    effect_definition_code: u32,
    last_pulse_tick: u32,
    flags: u32,
    navigation_config: u32,
    last_retarget_tick: u32,
}

struct EffectInstance {
    effect_instance_id: u32,
    instance_incarnation: u32,
    effect_definition_code: u32,
    family_code: u32,
    flags: u32,
    source_slot: u32,
    source_entity_id: u32,
    source_incarnation: u32,
    target_slot: u32,
    target_entity_id: u32,
    target_incarnation: u32,
    applied_tick: u32,
    expires_at_tick: u32,
    magnitude: f32,
    payload_0: i32,
    tags: u32,
}

struct EffectPoolState {
    abi_version: u32,
    input_count: u32,
    retained_count: atomic<u32>,
    candidate_count: atomic<u32>,
    valid_pulse_count: atomic<u32>,
    event_count: atomic<u32>,
    status: atomic<u32>,
    batch_accepted: atomic<u32>,
    next_instance_id: u32,
    instance_epoch: u32,
    materialized_count: atomic<u32>,
    source_tick: u32,
    candidate_overflow: atomic<u32>,
    event_overflow: atomic<u32>,
    pulse_result_count: atomic<u32>,
    reserved_0: u32,
}

struct BodyRenderStyle {
    color: vec4f,
    radius_scale: f32,
    visible: u32,
    shape_code: u32,
    reserved_1: u32,
}

struct EnemyBehaviorState {
    program_id: u32,
    state: atomic<u32>,
    state_entered_fixed_tick: u32,
    state_expires_at_fixed_tick: u32,
    target_slot: u32,
    target_entity_id: u32,
    target_incarnation: u32,
    flags: atomic<u32>,
    charge_direction: vec2f,
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

struct GridBody {
    predicted_position: vec2f,
    physical_meta: u32,
    flags: u32,
    inverse_mass: f32,
    radius: f32,
    body_id: u32,
    interaction_meta: u32,
}

struct GridOverflow {
    small_count: atomic<u32>,
    big_count: atomic<u32>,
    total_small_count: atomic<u32>,
    total_big_count: atomic<u32>,
}

struct FlowStage {
    goal_position: vec2f,
    next_field_index: i32,
    transition_radius: f32,
}

struct SimulationParams {
    world_size: vec2f,
    grid_cell_size: vec2f,
    grid_cell_count: vec2u,
    max_bodies_per_cell: u32,
    solver_iterations: u32,
    dt: f32,
    inverse_dt: f32,
    sdf_size: vec2u,
    sdf_enabled: u32,
    velocity_damping: f32,
    max_speed: f32,
    source_world_unit_scale: f32,
    flow_size: vec2u,
    flow_field_count: u32,
    flow_enabled: u32,
    flow_origin: vec2f,
    flow_cell_size: vec2f,
    flow_stages: array<FlowStage, 256>,
    max_contacts: u32,
    max_events: u32,
    max_death_events: u32,
    maximum_body_radius: f32,
    fixed_tick: u32,
    reserved_0: u32,
    reserved_1: u32,
    reserved_2: u32,
}

struct PrepareHeader {
    abi_version: u32,
    count: u32,
    capacity: u32,
    status: atomic<u32>,
    batch_id_fingerprint: u32,
    source_tick: u32,
    result_count: atomic<u32>,
    pair_count: atomic<u32>,
    grid_small_overflow: u32,
    grid_big_overflow: u32,
    reserved_0: u32,
    reserved_1: u32,
}

struct PrepareRecord {
    source_slot: u32,
    source_entity_id: u32,
    source_incarnation: u32,
    source_tick: u32,
    prepare_sequence: u32,
    fingerprint: u32,
    result: u32,
    pair_program_index: u32,
    pair_entity_id: u32,
    pair_incarnation: u32,
    root_program_index: u32,
    source_definition_code: u32,
    source_coordinate_system_code: u32,
    source_policy_code: u32,
    source_member_count: u32,
    source_occupied_slot_mask: u32,
    source_rotation_step: u32,
    source_generation: u32,
    source_lineage_hash: u32,
    source_current_health_centi: i32,
    source_max_health_centi: i32,
    pair_member_count: u32,
    pair_occupied_slot_mask: u32,
    pair_rotation_step: u32,
    pair_generation: u32,
    pair_lineage_hash: u32,
    pair_current_health_centi: i32,
    pair_max_health_centi: i32,
    destination_member_count: u32,
    destination_occupied_slot_mask: u32,
    destination_rotation_step: u32,
    expected_merged_current_health_centi: i32,
    expected_merged_max_health_centi: i32,
    flags: u32,
    motion_root_program_index: u32,
    source_invalid_reason: u32,
}

struct PrepareProgram {
    header: PrepareHeader,
    records: array<PrepareRecord>,
}

struct TransformHeader {
    abi_version: u32,
    count: u32,
    capacity: u32,
    status: atomic<u32>,
    batch_id_fingerprint: u32,
    prepared_source_tick: u32,
    target_fixed_tick: u32,
    batch_accepted: atomic<u32>,
    committed_count: atomic<u32>,
    effect_rekey_count: atomic<u32>,
    failure_record_index: atomic<u32>,
    source_count: u32,
    prepared_effect_rekey_count: u32,
    reserved_0: u32,
    reserved_1: u32,
    reserved_2: u32,
}

struct TransformRecord {
    source_a_slot: u32,
    source_a_entity_id: u32,
    source_a_incarnation: u32,
    source_b_slot: u32,
    source_b_entity_id: u32,
    source_b_incarnation: u32,
    destination_entity_id: u32,
    destination_incarnation: u32,
    prepared_source_tick: u32,
    target_fixed_tick: u32,
    prepare_batch_fingerprint: u32,
    fingerprint: u32,
    source_a_member_count: u32,
    source_a_occupied_slot_mask: u32,
    source_a_rotation_step: u32,
    source_a_generation: u32,
    source_a_lineage_hash: u32,
    source_a_current_health_centi: i32,
    source_a_max_health_centi: i32,
    source_b_member_count: u32,
    source_b_occupied_slot_mask: u32,
    source_b_rotation_step: u32,
    source_b_generation: u32,
    source_b_lineage_hash: u32,
    source_b_current_health_centi: i32,
    source_b_max_health_centi: i32,
    destination_definition_code: u32,
    destination_coordinate_system_code: u32,
    destination_policy_code: u32,
    destination_member_count: u32,
    destination_occupied_slot_mask: u32,
    destination_rotation_step: u32,
    destination_generation: u32,
    destination_flags: u32,
    destination_lineage_hash: u32,
    expected_current_health_centi: i32,
    expected_max_health_centi: i32,
    destination_radius: f32,
    destination_inverse_mass: f32,
    destination_flow_speed: f32,
    destination_tower_contact_damage: f32,
    result: u32,
    effect_rekey_count: u32,
    motion_source_index: u32,
    prepared_effect_rekey_count: u32,
    reserved_0: u32,
    reserved_1: u32,
    reserved_2: u32,
}

struct TransformProgram {
    header: TransformHeader,
    records: array<TransformRecord>,
}

struct RouteRuntimeState {
    packed_meta: u32, self_entity_id: u32, self_incarnation: u32,
    current_path_index: u32, route_set_index: u32, closure_index: u32,
    observed_availability_version: u32, phase_entered_fixed_tick: u32,
    travel_radius: f32, blocker_radius: f32,
    expansion_duration_fixed_ticks: u32, pending_field_index: u32,
    lease_generation: u32, profile_code: u32, reserved_0: u32, reserved_1: u32,
}

struct ProjectileCaptureState {
    packed_meta: atomic<u32>,
    self_entity_id: u32,
    self_incarnation: u32,
    peer_body_slot: u32,
    peer_entity_id: u32,
    peer_incarnation: u32,
    captured_at_fixed_tick: u32,
    release_due_fixed_tick: u32,
    capture_sequence: u32,
    captured_speed: f32,
    facing: vec2f,
}

struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct TemporaryBuffer { values: array<BodyTemporary> }
struct ContactHandlerBuffer { values: array<ContactHandler> }
struct CombatStateBuffer { values: array<CombatState> }
struct FormationStateBuffer { values: array<FormationState> }
struct FormationCandidateStateBuffer { values: array<FormationCandidateState> }
struct EffectSummaryBuffer { values: array<EffectSummary> }
struct EffectEmitterStateBuffer { values: array<EffectEmitterState> }
struct EffectInstanceBuffer { values: array<EffectInstance> }
struct BodyRenderStyleBuffer { values: array<BodyRenderStyle> }
struct EnemyBehaviorStateBuffer { values: array<EnemyBehaviorState> }
struct BodyControlStateBuffer { values: array<BodyControlState> }
struct RouteRuntimeStateBuffer { values: array<RouteRuntimeState> }
struct ProjectileCaptureStateBuffer { values: array<ProjectileCaptureState> }
struct RawRouteTopologyBuffer { values: array<u32> }
struct AtomicGridCounts { values: array<atomic<u32>> }
struct GridBodyBuffer { values: array<GridBody> }
struct GridOverflowBuffer { value: GridOverflow }
struct SdfBuffer { values: array<f32> }

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read_write> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(3) var<storage, read_write> temporaries: TemporaryBuffer;
@group(0) @binding(4) var<storage, read_write> contact_handlers: ContactHandlerBuffer;
@group(0) @binding(5) var<storage, read_write> combat_states: CombatStateBuffer;
@group(0) @binding(6) var<storage, read_write> formation_states: FormationStateBuffer;
@group(0) @binding(7) var<storage, read_write> candidate_states: FormationCandidateStateBuffer;
@group(0) @binding(8) var<storage, read_write> prepare_program: PrepareProgram;
@group(0) @binding(9) var<storage, read_write> transform_program: TransformProgram;
@group(0) @binding(10) var<storage, read_write> effect_summaries: EffectSummaryBuffer;
@group(0) @binding(11) var<storage, read_write> effect_emitters: EffectEmitterStateBuffer;
@group(0) @binding(12) var<storage, read_write> render_styles: BodyRenderStyleBuffer;
@group(0) @binding(13) var<storage, read_write> effect_instances: EffectInstanceBuffer;
@group(0) @binding(14) var<storage, read_write> effect_pool_state: EffectPoolState;
@group(0) @binding(15) var<storage, read_write> enemy_behavior_states: EnemyBehaviorStateBuffer;
@group(0) @binding(16) var<storage, read_write> body_control_states: BodyControlStateBuffer;
@group(0) @binding(17) var<storage, read_write> route_states: RouteRuntimeStateBuffer;
@group(0) @binding(18) var<storage, read_write> projectile_capture_states: ProjectileCaptureStateBuffer;
@group(0) @binding(19) var<storage, read> route_topology: RawRouteTopologyBuffer;
@group(1) @binding(0) var<storage, read_write> grid_counts: AtomicGridCounts;
@group(1) @binding(1) var<storage, read> grid_bodies: GridBodyBuffer;
@group(1) @binding(2) var<storage, read_write> grid_overflow: GridOverflowBuffer;
@group(1) @binding(4) var<storage, read> sdf_values: SdfBuffer;
@group(1) @binding(6) var flow_integration: texture_2d_array<f32>;
@group(2) @binding(0) var<uniform> params: SimulationParams;

fn alive(slot: u32) -> bool {
    return slot < arrayLength(&simulations.values)
        && (atomicLoad(&simulations.values[slot].flags) & BODY_FLAG_ALIVE) != 0u;
}

fn identity_matches(slot: u32, entity_id: u32, incarnation: u32) -> bool {
    return slot < arrayLength(&simulations.values)
        && simulations.values[slot].entity_id == entity_id
        && simulations.values[slot].incarnation == incarnation;
}

fn formation_identity_matches(slot: u32) -> bool {
    return slot < arrayLength(&formation_states.values)
        && formation_states.values[slot].entity_id
            == simulations.values[slot].entity_id
        && formation_states.values[slot].incarnation
            == simulations.values[slot].incarnation;
}

fn formation_route_role(state: RouteRuntimeState) -> u32 {
    return state.packed_meta & 255u;
}

fn formation_route_actor_identity_matches(slot: u32, state: RouteRuntimeState) -> bool {
    return formation_route_role(state) == ROUTE_ROLE_ACTOR
        && state.self_entity_id == simulations.values[slot].entity_id
        && state.self_incarnation == simulations.values[slot].incarnation
        && state.current_path_index != INVALID
        && state.route_set_index != INVALID;
}

fn synchronize_formation_route_span(slot: u32) -> bool {
    let route_state = route_states.values[slot];
    let role = formation_route_role(route_state);
    if (role == ROUTE_ROLE_NONE) {
        return true;
    }
    if (!formation_route_actor_identity_matches(slot, route_state)
        || arrayLength(&route_topology.values)
            <= ROUTE_TOPOLOGY_PATH_OFFSET_WORD
        || route_state.current_path_index
            >= route_topology.values[ROUTE_TOPOLOGY_PATH_COUNT_WORD]) {
        return false;
    }
    let path_base = route_topology.values[ROUTE_TOPOLOGY_PATH_OFFSET_WORD]
        + route_state.current_path_index * ROUTE_TOPOLOGY_PATH_STRIDE_WORDS;
    if (path_base + 2u >= arrayLength(&route_topology.values)) {
        return false;
    }
    let first_field = route_topology.values[path_base + 1u];
    let field_count = route_topology.values[path_base + 2u];
    if (field_count == 0u
        || first_field >= params.flow_field_count
        || field_count > params.flow_field_count - first_field) {
        return false;
    }
    formation_states.values[slot].route_first_field_index = first_field;
    formation_states.values[slot].route_field_count = field_count;
    return true;
}

fn formation_route_pair_is_compatible(source_slot: u32, candidate_slot: u32) -> bool {
    let source_route = route_states.values[source_slot];
    let candidate_route = route_states.values[candidate_slot];
    let source_role = formation_route_role(source_route);
    if (source_role != formation_route_role(candidate_route)) {
        return false;
    }
    if (source_role == ROUTE_ROLE_ACTOR) {
        return formation_route_actor_identity_matches(source_slot, source_route)
            && formation_route_actor_identity_matches(candidate_slot, candidate_route)
            && source_route.route_set_index == candidate_route.route_set_index
            && source_route.current_path_index == candidate_route.current_path_index;
    }
    if (source_role == ROUTE_ROLE_NONE) {
        let source = formation_states.values[source_slot];
        let candidate = formation_states.values[candidate_slot];
        return source.route_first_field_index == candidate.route_first_field_index
            && source.route_field_count == candidate.route_field_count;
    }
    return false;
}

fn valid_formation_state(slot: u32) -> bool {
    if (!alive(slot) || !formation_identity_matches(slot)) {
        return false;
    }
    let state = formation_states.values[slot];
    return (state.flags & FORMATION_FLAG_ACTIVE) != 0u
        && state.definition_code == FORMATION_DEFINITION_HEXA_RING
        && state.coordinate_system_code == COORDINATE_HEX_AXIAL
        && (state.policy_code == POLICY_SEEK_FORMATION
            || state.policy_code == POLICY_KEEP_FORMATION)
        && state.member_count >= 1u
        && state.member_count <= MAX_MEMBERS
        && state.generation > 0u
        && state.generation != INVALID
        && state.lineage_hash > 0u
        && state.lineage_hash != INVALID
        && countOneBits(state.occupied_slot_mask & OCCUPIED_MASK)
            == state.member_count
        && (state.occupied_slot_mask & ~OCCUPIED_MASK) == 0u
        && state.rotation_step < 6u
        && state.route_field_count > 0u
        && simulations.values[slot].flow_field_index
            >= state.route_first_field_index
        && simulations.values[slot].flow_field_index
            < state.route_first_field_index + state.route_field_count;
}

fn canonical_source_stats(slot: u32) -> bool {
    let member_count = formation_states.values[slot].member_count;
    return member_count >= 1u && member_count <= MAX_MEMBERS
        && physics.values[slot].inverse_mass == HEXA_INVERSE_MASS[member_count]
        && simulations.values[slot].flow_speed == HEXA_FLOW_SPEED[member_count]
        && effect_summaries.values[slot].authored_damage_other
            == HEXA_TOWER_DAMAGE[member_count]
        && effect_summaries.values[slot].resolved_base_damage_other
            == HEXA_TOWER_DAMAGE[member_count];
}

fn grid_cell(position: vec2f) -> vec2i {
    return vec2i(floor(position / params.grid_cell_size));
}

fn grid_cell_index(cell: vec2i) -> u32 {
    return u32(cell.y) * params.grid_cell_count.x + u32(cell.x);
}

fn grid_bucket_offset(cell_index: u32, bucket: u32) -> u32 {
    return ((cell_index * 2u) + bucket) * params.max_bodies_per_cell;
}

fn big_entry_is_canonical(entry: GridBody, cell_index: u32) -> bool {
    let center = grid_cell(entry.predicted_position);
    return center.x >= 0 && center.y >= 0
        && center.x < i32(params.grid_cell_count.x)
        && center.y < i32(params.grid_cell_count.y)
        && grid_cell_index(center) == cell_index;
}

fn world_sdf(position: vec2f) -> f32 {
    let boundary = min(
        min(position.x, params.world_size.x - position.x),
        min(position.y, params.world_size.y - position.y)
    );
    if (params.sdf_enabled == 0u) {
        return boundary;
    }
    let uv = clamp(position / params.world_size, vec2f(0.0), vec2f(0.999999));
    let texel = clamp(
        vec2i(floor(uv * vec2f(params.sdf_size))),
        vec2i(0),
        vec2i(params.sdf_size) - vec2i(1)
    );
    let index = u32(texel.y) * params.sdf_size.x + u32(texel.x);
    return min(boundary, sdf_values.values[index] * params.source_world_unit_scale);
}

fn segment_clear(start: vec2f, end: vec2f, clearance: f32) -> bool {
    let distance = length(end - start);
    let step_size = max(params.source_world_unit_scale, 0.0001);
    let required = max(1u, u32(ceil(distance / step_size)));
    if (required > MAX_SDF_SAMPLES) {
        return false;
    }
    for (var sample = 0u; sample <= MAX_SDF_SAMPLES; sample += 1u) {
        if (sample > required) {
            break;
        }
        let t = f32(sample) / f32(required);
        if (world_sdf(mix(start, end, t)) < clearance) {
            return false;
        }
    }
    return true;
}

fn integration_cost(position: vec2f, field_index: u32) -> f32 {
    if (params.flow_enabled == 0u || field_index >= params.flow_field_count) {
        return FLOAT_UNREACHABLE;
    }
    let cell = clamp(
        vec2i(floor((position - params.flow_origin) / params.flow_cell_size)),
        vec2i(0),
        vec2i(params.flow_size) - vec2i(1)
    );
    return textureLoad(flow_integration, cell, i32(field_index), 0).x;
}

fn identity_before(a: u32, ai: u32, b: u32, bi: u32) -> bool {
    return a < b || (a == b && ai < bi);
}

fn motion_source_is_a(a_slot: u32, b_slot: u32) -> bool {
    let a_field = simulations.values[a_slot].flow_field_index;
    let b_field = simulations.values[b_slot].flow_field_index;
    if (a_field != b_field) {
        return a_field > b_field;
    }
    let a_cost = integration_cost(physics.values[a_slot].position, a_field);
    let b_cost = integration_cost(physics.values[b_slot].position, b_field);
    if (abs(a_cost - b_cost) > EPSILON) {
        return a_cost < b_cost;
    }
    return identity_before(
        simulations.values[a_slot].entity_id,
        simulations.values[a_slot].incarnation,
        simulations.values[b_slot].entity_id,
        simulations.values[b_slot].incarnation
    );
}

fn rotate_mask_plus_60(mask: u32, steps: u32) -> u32 {
    var result = mask & OCCUPIED_MASK;
    for (var step = 0u; step < 6u; step += 1u) {
        if (step >= steps) {
            break;
        }
        var next = 0u;
        for (var source = 0u; source < 6u; source += 1u) {
            if ((result & (1u << source)) != 0u) {
                next |= 1u << ROTATE_PLUS_60[source];
            }
        }
        result = next;
    }
    return result;
}

fn facing_sector(direction: vec2f, seed: u32) -> u32 {
    if (dot(direction, direction) <= EPSILON) {
        return seed % 6u;
    }
    let unit = normalize(direction);
    var best = 0u;
    var best_dot = -2.0;
    for (var index = 0u; index < 6u; index += 1u) {
        let score = dot(unit, HEX_DIRECTIONS[index]);
        if (score > best_dot) {
            best_dot = score;
            best = index;
        }
    }
    return best;
}

fn choose_connected_destination_rotation(
    base_mask: u32,
    destination_member_count: u32,
    approach_direction: vec2f
) -> u32 {
    let canonical_mask = (1u << destination_member_count) - 1u;
    let unit = select(
        HEX_DIRECTIONS[0],
        normalize(approach_direction),
        dot(approach_direction, approach_direction) > EPSILON
    );
    var best_rotation = INVALID;
    var best_facing = -2.0;
    for (var rotation = 0u; rotation < 6u; rotation += 1u) {
        let destination_mask = rotate_mask_plus_60(
            canonical_mask,
            rotation
        );
        if ((base_mask & ~destination_mask) != 0u) {
            continue;
        }
        let added_mask = destination_mask & ~base_mask;
        if (added_mask == 0u) {
            continue;
        }
        var facing = -2.0;
        for (var slot = 0u; slot < 6u; slot += 1u) {
            if ((added_mask & (1u << slot)) != 0u) {
                facing = max(facing, dot(unit, HEX_DIRECTIONS[slot]));
            }
        }
        if (facing > best_facing
            || (facing == best_facing && rotation < best_rotation)) {
            best_facing = facing;
            best_rotation = rotation;
        }
    }
    return best_rotation;
}

fn choose_approach_slot(
    base_mask: u32,
    destination_mask: u32,
    approach_direction: vec2f
) -> u32 {
    let added_mask = destination_mask & ~base_mask;
    if (added_mask == 0u) { return INVALID; }
    let unit = select(
        HEX_DIRECTIONS[0],
        normalize(approach_direction),
        dot(approach_direction, approach_direction) > EPSILON
    );
    var best_slot = INVALID;
    var best_facing = -2.0;
    for (var slot = 0u; slot < 6u; slot += 1u) {
        if ((added_mask & (1u << slot)) == 0u) { continue; }
        let facing = dot(unit, HEX_DIRECTIONS[slot]);
        if (facing > best_facing
            || (facing == best_facing && slot < best_slot)) {
            best_facing = facing;
            best_slot = slot;
        }
    }
    return best_slot;
}

fn merged_health(left: i32, right: i32) -> i32 {
    if (left <= 0 || right <= 0 || left > INT32_MAX_VALUE - right) {
        return -1;
    }
    let sum = left + right;
    let bonus = sum / 10;
    if (sum > INT32_MAX_VALUE - bonus) {
        return -1;
    }
    return sum + bonus;
}

fn invalidate_candidate(slot: u32) {
    atomicStore(&candidate_states.values[slot].program_index, INVALID_PROGRAM);
    candidate_states.values[slot].candidate_program_index = INVALID_PROGRAM;
    candidate_states.values[slot].candidate_slot = INVALID;
    candidate_states.values[slot].candidate_entity_id = INVALID;
    candidate_states.values[slot].candidate_incarnation = INVALID;
    candidate_states.values[slot].root_program_index = INVALID_PROGRAM;
    candidate_states.values[slot].destination_member_count = 0u;
    candidate_states.values[slot].destination_occupied_slot_mask = 0u;
    candidate_states.values[slot].destination_rotation_step = 0u;
    candidate_states.values[slot].distance_squared = FLOAT_UNREACHABLE;
    atomicStore(&candidate_states.values[slot].status, 0u);
    atomicStore(&candidate_states.values[slot].reserved_0, 0u);
}

@compute @workgroup_size(256)
fn clear_formation_candidate_states(@builtin(global_invocation_id) id: vec3u) {
    if (id.x < arrayLength(&candidate_states.values)) {
        invalidate_candidate(id.x);
    }
}

@compute @workgroup_size(1)
fn seed_formation_prepare(@builtin(global_invocation_id) id: vec3u) {
    if (id.x != 0u) {
        return;
    }
    atomicStore(&prepare_program.header.status, 0u);
    atomicStore(&prepare_program.header.result_count, 0u);
    atomicStore(&prepare_program.header.pair_count, 0u);
    let small_overflow = atomicLoad(&grid_overflow.value.small_count);
    let big_overflow = atomicLoad(&grid_overflow.value.big_count);
    prepare_program.header.grid_small_overflow = small_overflow;
    prepare_program.header.grid_big_overflow = big_overflow;
    if (prepare_program.header.abi_version != PREPARE_ABI_VERSION) {
        atomicOr(&prepare_program.header.status, STATUS_ABI_MISMATCH);
        return;
    }
    if (prepare_program.header.count > prepare_program.header.capacity
        || prepare_program.header.count > arrayLength(&prepare_program.records)) {
        atomicOr(&prepare_program.header.status, STATUS_PROGRAM_CAPACITY);
        return;
    }
    if (small_overflow != 0u || big_overflow != 0u) {
        atomicOr(&prepare_program.header.status, STATUS_GRID_OVERFLOW);
    }
    for (var index = 0u; index < prepare_program.header.count; index += 1u) {
        prepare_program.records[index].result = PREPARE_RESULT_PENDING;
        prepare_program.records[index].pair_program_index = INVALID_PROGRAM;
        prepare_program.records[index].pair_entity_id = INVALID;
        prepare_program.records[index].pair_incarnation = INVALID;
        prepare_program.records[index].root_program_index = INVALID_PROGRAM;
        prepare_program.records[index].motion_root_program_index = INVALID_PROGRAM;
        prepare_program.records[index].source_invalid_reason
            = SOURCE_INVALID_REASON_NONE;
        let slot = prepare_program.records[index].source_slot;
        if (slot >= arrayLength(&candidate_states.values)) {
            if ((prepare_program.records[index].flags
                    & PREPARE_FLAG_ALLOW_SOURCE_INVALID) == 0u) {
                atomicOr(
                    &prepare_program.header.status,
                    STATUS_SOURCE_CONFLICT
                );
            }
            continue;
        }
        if (!identity_matches(
            slot,
            prepare_program.records[index].source_entity_id,
            prepare_program.records[index].source_incarnation
        )) {
            if ((prepare_program.records[index].flags
                    & PREPARE_FLAG_ALLOW_SOURCE_INVALID) == 0u) {
                atomicOr(
                    &prepare_program.header.status,
                    STATUS_SOURCE_CONFLICT
                );
            }
            continue;
        }
        loop {
            let exchange = atomicCompareExchangeWeak(
                &candidate_states.values[slot].program_index,
                INVALID_PROGRAM,
                index
            );
            if (exchange.exchanged) { break; }
            if (exchange.old_value != INVALID_PROGRAM) {
                atomicOr(
                    &prepare_program.header.status,
                    STATUS_SOURCE_CONFLICT
                );
                break;
            }
        }
    }
}

fn candidate_is_better(
    distance_squared: f32,
    forward_stage_delta: u32,
    forward_cost_delta: f32,
    root_entity_id: u32,
    root_incarnation: u32,
    slot_index: u32,
    rotation_step: u32,
    best: ptr<function, FormationCandidateRank>
) -> bool {
    if (distance_squared != (*best).distance_squared) {
        return distance_squared < (*best).distance_squared;
    }
    if (forward_stage_delta != (*best).forward_stage_delta) {
        return forward_stage_delta < (*best).forward_stage_delta;
    }
    if (forward_cost_delta != (*best).forward_cost_delta) {
        return forward_cost_delta < (*best).forward_cost_delta;
    }
    if (identity_before(
        root_entity_id,
        root_incarnation,
        (*best).root_entity_id,
        (*best).root_incarnation
    )) {
        return true;
    }
    if (root_entity_id != (*best).root_entity_id
        || root_incarnation != (*best).root_incarnation) {
        return false;
    }
    if (slot_index != (*best).slot) {
        return slot_index < (*best).slot;
    }
    return rotation_step < (*best).rotation_step;
}

fn consider_candidate(
    source_slot: u32,
    entry: GridBody,
    maximum_distance: f32,
    best: ptr<function, FormationCandidateRank>
) {
    let candidate_slot = entry.body_id;
    if (candidate_slot == source_slot
        || candidate_slot >= arrayLength(&candidate_states.values)
        || !valid_formation_state(candidate_slot)) {
        return;
    }
    let candidate_program_index = atomicLoad(
        &candidate_states.values[candidate_slot].program_index
    );
    if (candidate_program_index == INVALID_PROGRAM) {
        return;
    }
    let source = formation_states.values[source_slot];
    let candidate = formation_states.values[candidate_slot];
    if (source.definition_code != candidate.definition_code
        || source.coordinate_system_code != candidate.coordinate_system_code
        || source.member_count + candidate.member_count > MAX_MEMBERS) {
        return;
    }
    if (source.route_first_field_index != candidate.route_first_field_index
        || source.route_field_count != candidate.route_field_count) {
        atomicOr(
            &candidate_states.values[source_slot].reserved_0,
            MOTION_DIAGNOSTIC_ROUTE_SPAN_REJECTED
        );
        return;
    }
    let source_field = simulations.values[source_slot].flow_field_index;
    let candidate_field = simulations.values[candidate_slot].flow_field_index;
    if (candidate_field < source_field) {
        atomicOr(
            &candidate_states.values[source_slot].reserved_0,
            MOTION_DIAGNOSTIC_REVERSE_REJECTED
        );
        return;
    }
    let source_cost = integration_cost(
        physics.values[source_slot].position,
        source_field
    );
    let candidate_cost = integration_cost(
        physics.values[candidate_slot].position,
        candidate_field
    );
    if (!(source_cost >= 0.0) || !(candidate_cost >= 0.0)
        || source_cost >= FLOAT_UNREACHABLE
        || candidate_cost >= FLOAT_UNREACHABLE) {
        return;
    }
    let forward_stage_delta = candidate_field - source_field;
    var forward_cost_delta = 0.0;
    if (forward_stage_delta == 0u) {
        forward_cost_delta = source_cost - candidate_cost;
        if (forward_cost_delta < -EPSILON) {
            atomicOr(
                &candidate_states.values[source_slot].reserved_0,
                MOTION_DIAGNOSTIC_REVERSE_REJECTED
            );
            return;
        }
        forward_cost_delta = max(0.0, forward_cost_delta);
    }
    let delta = physics.values[candidate_slot].position
        - physics.values[source_slot].position;
    let distance_squared = dot(delta, delta);
    if (distance_squared > maximum_distance * maximum_distance) {
        return;
    }
    let clearance = max(
        physics.values[source_slot].radius,
        physics.values[candidate_slot].radius
    ) * CORRIDOR_CLEARANCE_SCALE;
    if (!segment_clear(
        physics.values[source_slot].position,
        physics.values[candidate_slot].position,
        clearance
    )) {
        atomicOr(
            &candidate_states.values[source_slot].reserved_0,
            MOTION_DIAGNOSTIC_SDF_SEGMENT_REJECTED
        );
        return;
    }
    let entity_id = simulations.values[candidate_slot].entity_id;
    let incarnation = simulations.values[candidate_slot].incarnation;
    let source_entity_id = simulations.values[source_slot].entity_id;
    let source_incarnation = simulations.values[source_slot].incarnation;
    let source_is_root = identity_before(
        source_entity_id,
        source_incarnation,
        entity_id,
        incarnation
    );
    let root_entity_id = select(entity_id, source_entity_id, source_is_root);
    let root_incarnation = select(incarnation, source_incarnation, source_is_root);
    let root_slot = select(candidate_slot, source_slot, source_is_root);
    let other_slot = select(source_slot, candidate_slot, source_is_root);
    let motion_root_slot = select(
        other_slot,
        root_slot,
        motion_source_is_a(root_slot, other_slot)
    );
    let incoming_slot = select(
        root_slot,
        other_slot,
        motion_root_slot == root_slot
    );
    let rotation_step = choose_connected_destination_rotation(
        formation_states.values[motion_root_slot].occupied_slot_mask,
        source.member_count + candidate.member_count,
        physics.values[incoming_slot].position
            - physics.values[motion_root_slot].position
    );
    if (rotation_step == INVALID) { return; }
    if (candidate_is_better(
        distance_squared,
        forward_stage_delta,
        forward_cost_delta,
        root_entity_id,
        root_incarnation,
        candidate_slot,
        rotation_step,
        best
    )) {
        atomicOr(
            &candidate_states.values[source_slot].reserved_0,
            MOTION_DIAGNOSTIC_CANDIDATE_ACCEPTED
        );
        (*best).slot = candidate_slot;
        (*best).program_index = candidate_program_index;
        (*best).entity_id = entity_id;
        (*best).incarnation = incarnation;
        (*best).distance_squared = distance_squared;
        (*best).forward_stage_delta = forward_stage_delta;
        (*best).forward_cost_delta = forward_cost_delta;
        (*best).root_entity_id = root_entity_id;
        (*best).root_incarnation = root_incarnation;
        (*best).rotation_step = rotation_step;
    }
}

fn scan_formation_candidate(
    source_slot: u32,
    maximum_distance: f32
) -> FormationCandidateRank {
    let center = grid_cell(physics.values[source_slot].position);
    let cell_radius = i32(ceil(maximum_distance / min(
            params.grid_cell_size.x,
            params.grid_cell_size.y
        )));
    var best = FormationCandidateRank(
        INVALID,
        INVALID_PROGRAM,
        INVALID,
        INVALID,
        FLOAT_UNREACHABLE,
        INVALID,
        FLOAT_UNREACHABLE,
        INVALID,
        INVALID,
        INVALID
    );
    // The scan bound is authored and finite.  A grid configuration requiring
    // a wider scan is uncertain and therefore fail-closes instead of silently
    // inspecting a partial neighborhood.
    if (cell_radius < 0 || cell_radius > 4) {
        return best;
    }
    for (var y = -4; y <= 4; y += 1) {
        if (abs(y) > cell_radius) { continue; }
        for (var x = -4; x <= 4; x += 1) {
            if (abs(x) > cell_radius) { continue; }
            let cell = center + vec2i(x, y);
            if (cell.x < 0 || cell.y < 0
                || cell.x >= i32(params.grid_cell_count.x)
                || cell.y >= i32(params.grid_cell_count.y)) {
                continue;
            }
            let cell_index = grid_cell_index(cell);
            for (var bucket = 0u; bucket < 2u; bucket += 1u) {
                let counter_index = cell_index * 2u + bucket;
                let count = min(
                    atomicLoad(&grid_counts.values[counter_index]),
                    params.max_bodies_per_cell
                );
                let base = grid_bucket_offset(cell_index, bucket);
                for (var item = 0u; item < 64u; item += 1u) {
                    if (item >= count) { break; }
                    let entry = grid_bodies.values[base + item];
                    if (bucket == 1u
                        && !big_entry_is_canonical(entry, cell_index)) {
                        continue;
                    }
                    consider_candidate(
                        source_slot,
                        entry,
                        maximum_distance,
                        &best
                    );
                }
            }
        }
    }
    return best;
}

@compute @workgroup_size(256)
fn seed_formation_motion(@builtin(global_invocation_id) id: vec3u) {
    let slot = id.x;
    if (slot >= counts.body_count
        || !synchronize_formation_route_span(slot)
        || !valid_formation_state(slot)) {
        return;
    }
    if (formation_states.values[slot].presentation_tick < params.fixed_tick) {
        formation_states.values[slot].flags &= ~FORMATION_FLAG_MERGE_PULSE;
        formation_states.values[slot].presentation_flags
            &= ~FORMATION_FLAG_MERGE_PULSE;
    }
    let overflowed = atomicLoad(&grid_overflow.value.small_count) != 0u
        || atomicLoad(&grid_overflow.value.big_count) != 0u;
    if (overflowed) {
        atomicOr(
            &candidate_states.values[slot].reserved_0,
            MOTION_DIAGNOSTIC_GRID_OVERFLOW_FALLBACK
                | MOTION_DIAGNOSTIC_PURE_FLOW_FALLBACK
        );
        formation_states.values[slot].flags |= FORMATION_FLAG_GRID_OVERFLOW;
        formation_states.values[slot].partner_entity_id = INVALID;
        formation_states.values[slot].partner_incarnation = INVALID;
        formation_states.values[slot].presentation_flags
            &= ~FORMATION_FLAG_RESERVATION;
        return;
    }
    let state = formation_states.values[slot];
    if (state.policy_code != POLICY_SEEK_FORMATION
        || state.member_count >= MAX_MEMBERS) {
        return;
    }
    atomicStore(&candidate_states.values[slot].program_index, slot);
}

@compute @workgroup_size(256)
fn select_formation_motion_candidates(@builtin(global_invocation_id) id: vec3u) {
    let slot = id.x;
    if (slot >= counts.body_count
        || atomicLoad(&candidate_states.values[slot].program_index) != slot) {
        return;
    }
    let best = scan_formation_candidate(slot, MERGE_SEEK_RADIUS);
    if (best.slot == INVALID) { return; }
    candidate_states.values[slot].candidate_program_index = best.program_index;
    candidate_states.values[slot].candidate_slot = best.slot;
    candidate_states.values[slot].candidate_entity_id = best.entity_id;
    candidate_states.values[slot].candidate_incarnation = best.incarnation;
    candidate_states.values[slot].root_program_index
        = best.forward_stage_delta;
    candidate_states.values[slot].destination_member_count
        = bitcast<u32>(best.forward_cost_delta);
    candidate_states.values[slot].destination_rotation_step = best.rotation_step;
    candidate_states.values[slot].distance_squared = best.distance_squared;
}

@compute @workgroup_size(256)
fn advance_formation_motion(@builtin(global_invocation_id) id: vec3u) {
    let slot = id.x;
    if (slot >= counts.body_count || !valid_formation_state(slot)) {
        return;
    }
    let candidate_slot = candidate_states.values[slot].candidate_slot;
    let mutual = candidate_slot < counts.body_count
        && candidate_states.values[candidate_slot].candidate_slot == slot
        && candidate_states.values[slot].candidate_entity_id
            == simulations.values[candidate_slot].entity_id
        && candidate_states.values[slot].candidate_incarnation
            == simulations.values[candidate_slot].incarnation;
    if (!mutual) {
        formation_states.values[slot].partner_entity_id = INVALID;
        formation_states.values[slot].partner_incarnation = INVALID;
        formation_states.values[slot].presentation_flags
            &= ~FORMATION_FLAG_RESERVATION;
        return;
    }
    formation_states.values[slot].partner_entity_id
        = simulations.values[candidate_slot].entity_id;
    formation_states.values[slot].partner_incarnation
        = simulations.values[candidate_slot].incarnation;
    formation_states.values[slot].presentation_flags
        |= FORMATION_FLAG_RESERVATION;
    formation_states.values[slot].presentation_tick = params.fixed_tick;

    if (motion_source_is_a(slot, candidate_slot)) {
        return;
    }
    let motion_position = physics.values[candidate_slot].position;
    let rotation_step
        = candidate_states.values[slot].destination_rotation_step;
    let destination_member_count = formation_states.values[slot].member_count
        + formation_states.values[candidate_slot].member_count;
    let destination_mask = rotate_mask_plus_60(
        (1u << destination_member_count) - 1u,
        rotation_step
    );
    let approach_slot = choose_approach_slot(
        formation_states.values[candidate_slot].occupied_slot_mask,
        destination_mask,
        physics.values[slot].position - motion_position
    );
    if (approach_slot == INVALID) { return; }
    let desired_position = motion_position
        + HEX_DIRECTIONS[approach_slot] * MERGE_COMMIT_DISTANCE;
    let delta = desired_position - physics.values[slot].position;
    if (dot(delta, delta) <= EPSILON) { return; }
    let base_velocity = physics.values[slot].velocity;
    let base_speed = length(base_velocity);
    if (!(base_speed > EPSILON)) { return; }
    let forward = base_velocity / base_speed;
    var desired_velocity = normalize(delta)
        * min(simulations.values[slot].flow_speed, base_speed);
    if (dot(desired_velocity, forward) < 0.0) {
        atomicOr(
            &candidate_states.values[slot].reserved_0,
            MOTION_DIAGNOSTIC_NO_REVERSE_CLAMPED
        );
        desired_velocity -= forward * dot(desired_velocity, forward);
    }
    let steered_velocity = mix(base_velocity, desired_velocity, 0.5);
    if (dot(steered_velocity, forward) < 0.0) {
        atomicOr(
            &candidate_states.values[slot].reserved_0,
            MOTION_DIAGNOSTIC_NO_REVERSE_CLAMPED
                | MOTION_DIAGNOSTIC_PURE_FLOW_FALLBACK
        );
        return;
    }
    if (!segment_clear(
            physics.values[slot].position,
            physics.values[slot].position + steered_velocity * params.dt,
            physics.values[slot].radius * CORRIDOR_CLEARANCE_SCALE
        )) {
        atomicOr(
            &candidate_states.values[slot].reserved_0,
            MOTION_DIAGNOSTIC_SDF_STEERING_REJECTED
                | MOTION_DIAGNOSTIC_PURE_FLOW_FALLBACK
        );
        return;
    }
    physics.values[slot].velocity = steered_velocity;
    atomicOr(
        &simulations.values[slot].flags,
        BODY_FLAG_EXTERNAL_MOTION_OWNER_THIS_TICK
    );
    atomicOr(
        &candidate_states.values[slot].reserved_0,
        MOTION_DIAGNOSTIC_STEERING_APPLIED
    );
}

@compute @workgroup_size(256)
fn select_formation_prepare_candidates(@builtin(global_invocation_id) id: vec3u) {
    let program_index = id.x;
    if (program_index >= prepare_program.header.count
        || atomicLoad(&prepare_program.header.status) != 0u) {
        return;
    }
    let record = prepare_program.records[program_index];
    let slot = record.source_slot;
    let allows_invalid = (record.flags & PREPARE_FLAG_ALLOW_SOURCE_INVALID) != 0u;
    let exact_identity = identity_matches(
        slot,
        record.source_entity_id,
        record.source_incarnation
    );
    if (!exact_identity || !alive(slot)) {
        if (!exact_identity && !allows_invalid) {
            atomicOr(&prepare_program.header.status, STATUS_SOURCE_CONFLICT);
        }
        return;
    }
    if (!valid_formation_state(slot) || !canonical_source_stats(slot)) {
        atomicOr(&prepare_program.header.status, STATUS_RECORD_INVALID);
        return;
    }
    let source = formation_states.values[slot];
    if (source.member_count >= MAX_MEMBERS
        || source.policy_code == POLICY_KEEP_FORMATION) {
        return;
    }
    let best = scan_formation_candidate(slot, MERGE_COMMIT_DISTANCE);
    if (best.slot == INVALID) {
        return;
    }
    let candidate = formation_states.values[best.slot];
    let destination_members = source.member_count + candidate.member_count;
    let identity_root = select(
        best.program_index,
        program_index,
        identity_before(
            record.source_entity_id,
            record.source_incarnation,
            best.entity_id,
            best.incarnation
        )
    );
    let sector = best.rotation_step;
    let canonical_mask = (1u << destination_members) - 1u;
    let destination_mask = rotate_mask_plus_60(canonical_mask, sector);
    let motion_root = select(
        best.program_index,
        program_index,
        motion_source_is_a(slot, best.slot)
    );
    candidate_states.values[slot].candidate_program_index = best.program_index;
    candidate_states.values[slot].candidate_slot = best.slot;
    candidate_states.values[slot].candidate_entity_id = best.entity_id;
    candidate_states.values[slot].candidate_incarnation = best.incarnation;
    candidate_states.values[slot].root_program_index = identity_root;
    candidate_states.values[slot].destination_member_count = destination_members;
    candidate_states.values[slot].destination_occupied_slot_mask = destination_mask;
    candidate_states.values[slot].destination_rotation_step = sector;
    candidate_states.values[slot].distance_squared = best.distance_squared;
    atomicStore(&candidate_states.values[slot].status, motion_root);
}

@compute @workgroup_size(256)
fn finalize_formation_prepare(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    if (index >= prepare_program.header.count) {
        return;
    }
    var record = prepare_program.records[index];
    let slot = record.source_slot;
    let allows_invalid = (record.flags & PREPARE_FLAG_ALLOW_SOURCE_INVALID) != 0u;
    let exact_identity = identity_matches(
        slot,
        record.source_entity_id,
        record.source_incarnation
    );
    if (!exact_identity || !alive(slot)) {
        record.result = PREPARE_RESULT_SOURCE_INVALID;
        record.source_invalid_reason = select(
            SOURCE_INVALID_REASON_LIFECYCLE_REMOVED,
            SOURCE_INVALID_REASON_DIED_AFTER_STAGE,
            exact_identity
        );
        if (!exact_identity && !allows_invalid) {
            atomicOr(&prepare_program.header.status, STATUS_SOURCE_CONFLICT);
        }
        prepare_program.records[index] = record;
        atomicAdd(&prepare_program.header.result_count, 1u);
        return;
    }
    if (!valid_formation_state(slot)) {
        record.result = PREPARE_RESULT_POLICY_REJECTED;
        prepare_program.records[index] = record;
        atomicOr(&prepare_program.header.status, STATUS_RECORD_INVALID);
        atomicAdd(&prepare_program.header.result_count, 1u);
        return;
    }
    let state = formation_states.values[slot];
    record.source_definition_code = state.definition_code;
    record.source_coordinate_system_code = state.coordinate_system_code;
    record.source_policy_code = state.policy_code;
    record.source_member_count = state.member_count;
    record.source_occupied_slot_mask = state.occupied_slot_mask;
    record.source_rotation_step = state.rotation_step;
    record.source_generation = state.generation;
    record.source_lineage_hash = state.lineage_hash;
    record.source_current_health_centi = atomicLoad(&simulations.values[slot].health);
    record.source_max_health_centi = effect_summaries.values[slot].max_health_fixed_point;
    let pair_index = candidate_states.values[slot].candidate_program_index;
    var mutual = pair_index < prepare_program.header.count;
    if (mutual) {
        let pair_slot = candidate_states.values[slot].candidate_slot;
        mutual = atomicLoad(&candidate_states.values[pair_slot].program_index)
                == pair_index
            && candidate_states.values[pair_slot].candidate_program_index == index
            && candidate_states.values[pair_slot].candidate_slot == slot
            && candidate_states.values[pair_slot].root_program_index
                == candidate_states.values[slot].root_program_index
            && candidate_states.values[pair_slot].destination_member_count
                == candidate_states.values[slot].destination_member_count
            && candidate_states.values[pair_slot].destination_occupied_slot_mask
                == candidate_states.values[slot].destination_occupied_slot_mask
            && candidate_states.values[pair_slot].destination_rotation_step
                == candidate_states.values[slot].destination_rotation_step;
    }
    if (!mutual) {
        record.result = PREPARE_RESULT_NO_PAIR;
        prepare_program.records[index] = record;
        atomicAdd(&prepare_program.header.result_count, 1u);
        return;
    }
    let pair_slot = candidate_states.values[slot].candidate_slot;
    let pair_state = formation_states.values[pair_slot];
    record.result = PREPARE_RESULT_MUTUAL_PAIR;
    record.pair_program_index = pair_index;
    record.pair_entity_id = simulations.values[pair_slot].entity_id;
    record.pair_incarnation = simulations.values[pair_slot].incarnation;
    record.root_program_index = candidate_states.values[slot].root_program_index;
    record.pair_member_count = pair_state.member_count;
    record.pair_occupied_slot_mask = pair_state.occupied_slot_mask;
    record.pair_rotation_step = pair_state.rotation_step;
    record.pair_generation = pair_state.generation;
    record.pair_lineage_hash = pair_state.lineage_hash;
    record.pair_current_health_centi = atomicLoad(&simulations.values[pair_slot].health);
    record.pair_max_health_centi = effect_summaries.values[pair_slot].max_health_fixed_point;
    record.destination_member_count = candidate_states.values[slot].destination_member_count;
    record.destination_occupied_slot_mask = candidate_states.values[slot].destination_occupied_slot_mask;
    record.destination_rotation_step = candidate_states.values[slot].destination_rotation_step;
    record.expected_merged_current_health_centi = merged_health(
        record.source_current_health_centi,
        record.pair_current_health_centi
    );
    record.expected_merged_max_health_centi = merged_health(
        record.source_max_health_centi,
        record.pair_max_health_centi
    );
    record.motion_root_program_index = atomicLoad(
        &candidate_states.values[slot].status
    );
    if (record.expected_merged_current_health_centi <= 0
        || record.expected_merged_max_health_centi <= 0
        || record.source_current_health_centi > record.source_max_health_centi
        || record.pair_current_health_centi > record.pair_max_health_centi) {
        atomicOr(&prepare_program.header.status, STATUS_HP_OVERFLOW);
    }
    if (index == record.root_program_index) {
        atomicAdd(&prepare_program.header.pair_count, 1u);
    }
    prepare_program.records[index] = record;
    atomicAdd(&prepare_program.header.result_count, 1u);
}

@compute @workgroup_size(1)
fn seal_formation_prepare(@builtin(global_invocation_id) id: vec3u) {
    if (id.x != 0u) { return; }
    let status = atomicLoad(&prepare_program.header.status);
    if (status == 0u) { return; }
    atomicStore(&prepare_program.header.pair_count, 0u);
    for (var index = 0u; index < prepare_program.header.count; index += 1u) {
        if ((status & STATUS_GRID_OVERFLOW) != 0u) {
            prepare_program.records[index].result = PREPARE_RESULT_GRID_OVERFLOW;
        } else if (prepare_program.records[index].result
            != PREPARE_RESULT_SOURCE_INVALID) {
            prepare_program.records[index].result = PREPARE_RESULT_POLICY_REJECTED;
        }
        prepare_program.records[index].pair_program_index = INVALID_PROGRAM;
        prepare_program.records[index].pair_entity_id = INVALID;
        prepare_program.records[index].pair_incarnation = INVALID;
        prepare_program.records[index].root_program_index = INVALID_PROGRAM;
        prepare_program.records[index].motion_root_program_index = INVALID_PROGRAM;
    }
}

fn fail_transform(status: u32, record_index: u32) {
    atomicOr(&transform_program.header.status, status);
    atomicMin(&transform_program.header.failure_record_index, record_index);
}

fn formation_route_source_is_transformable(
    state: RouteRuntimeState,
    entity_id: u32,
    incarnation: u32
) -> bool {
    let role = formation_route_role(state);
    return role != ROUTE_ROLE_CLOSER
        && ((role == ROUTE_ROLE_NONE
                && state.packed_meta == 0u
                && state.self_entity_id == 0u
                && state.self_incarnation == 0u
                && state.current_path_index == 0u
                && state.route_set_index == 0u
                && state.closure_index == 0u
                && state.observed_availability_version == 0u
                && state.phase_entered_fixed_tick == 0u
                && state.travel_radius == 0.0
                && state.blocker_radius == 0.0
                && state.expansion_duration_fixed_ticks == 0u
                && state.pending_field_index == 0u
                && state.lease_generation == 0u
                && state.profile_code == 0u
                && state.reserved_0 == 0u
                && state.reserved_1 == 0u)
            || (role == ROUTE_ROLE_ACTOR
                && state.self_entity_id == entity_id
                && state.self_incarnation == incarnation));
}

@compute @workgroup_size(1)
fn reset_formation_transform(@builtin(global_invocation_id) id: vec3u) {
    if (id.x != 0u) { return; }
    atomicStore(&transform_program.header.status, 0u);
    atomicStore(&transform_program.header.batch_accepted, 0u);
    atomicStore(&transform_program.header.committed_count, 0u);
    atomicStore(&transform_program.header.effect_rekey_count, 0u);
    atomicStore(&transform_program.header.failure_record_index, INVALID_PROGRAM);
    transform_program.header.prepared_effect_rekey_count = 0u;
    if (transform_program.header.abi_version != TRANSFORM_ABI_VERSION) {
        fail_transform(STATUS_ABI_MISMATCH, 0u);
    }
    if (transform_program.header.count > transform_program.header.capacity
        || transform_program.header.count > arrayLength(&transform_program.records)
        || transform_program.header.source_count
            != transform_program.header.count * 2u) {
        fail_transform(STATUS_PROGRAM_CAPACITY, 0u);
    }
}

fn source_state_matches(
    slot: u32,
    entity_id: u32,
    incarnation: u32,
    member_count: u32,
    occupied_mask: u32,
    rotation_step: u32,
    generation: u32,
    lineage_hash: u32,
    current_health: i32,
    max_health: i32
) -> bool {
    if (!identity_matches(slot, entity_id, incarnation)
        || !valid_formation_state(slot)
        || !canonical_source_stats(slot)) {
        return false;
    }
    let state = formation_states.values[slot];
    return state.member_count == member_count
        && state.occupied_slot_mask == occupied_mask
        && state.rotation_step == rotation_step
        && state.generation == generation
        && state.lineage_hash == lineage_hash
        && atomicLoad(&simulations.values[slot].health) == current_health
        && effect_summaries.values[slot].max_health_fixed_point == max_health
        && current_health > 0
        && max_health > 0
        && current_health <= max_health;
}

fn canonical_inactive_projectile_capture_state(
    slot: u32,
    entity_id: u32,
    incarnation: u32
) -> bool {
    if (slot >= arrayLength(&projectile_capture_states.values)) {
        return false;
    }
    return atomicLoad(&projectile_capture_states.values[slot].packed_meta) == 0u
        && projectile_capture_states.values[slot].self_entity_id == entity_id
        && projectile_capture_states.values[slot].self_incarnation == incarnation
        && projectile_capture_states.values[slot].peer_body_slot == INVALID
        && projectile_capture_states.values[slot].peer_entity_id == INVALID
        && projectile_capture_states.values[slot].peer_incarnation == INVALID
        && projectile_capture_states.values[slot].captured_at_fixed_tick == 0u
        && projectile_capture_states.values[slot].release_due_fixed_tick == 0u
        && projectile_capture_states.values[slot].capture_sequence == 0u
        && projectile_capture_states.values[slot].captured_speed == 0.0
        && projectile_capture_states.values[slot].facing.x == 0.0
        && projectile_capture_states.values[slot].facing.y == 0.0;
}

@compute @workgroup_size(256)
fn preflight_formation_transforms(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    if (index >= transform_program.header.count) { return; }
    var record = transform_program.records[index];
    record.result = TRANSFORM_RESULT_PENDING;
    record.effect_rekey_count = 0u;
    transform_program.records[index] = record;
    if (record.prepared_source_tick + 1u != record.target_fixed_tick
        || transform_program.header.prepared_source_tick
            != record.prepared_source_tick
        || transform_program.header.target_fixed_tick != record.target_fixed_tick
        || params.fixed_tick != record.target_fixed_tick
        || record.source_a_slot == record.source_b_slot) {
        fail_transform(STATUS_RECORD_INVALID, index);
        return;
    }
    let sources_match = source_state_matches(
        record.source_a_slot,
        record.source_a_entity_id,
        record.source_a_incarnation,
        record.source_a_member_count,
        record.source_a_occupied_slot_mask,
        record.source_a_rotation_step,
        record.source_a_generation,
        record.source_a_lineage_hash,
        record.source_a_current_health_centi,
        record.source_a_max_health_centi
    ) && source_state_matches(
        record.source_b_slot,
        record.source_b_entity_id,
        record.source_b_incarnation,
        record.source_b_member_count,
        record.source_b_occupied_slot_mask,
        record.source_b_rotation_step,
        record.source_b_generation,
        record.source_b_lineage_hash,
        record.source_b_current_health_centi,
        record.source_b_max_health_centi
    ) && canonical_inactive_projectile_capture_state(
        record.source_a_slot,
        record.source_a_entity_id,
        record.source_a_incarnation
    ) && canonical_inactive_projectile_capture_state(
        record.source_b_slot,
        record.source_b_entity_id,
        record.source_b_incarnation
    );
    if (!sources_match) {
        fail_transform(STATUS_SOURCE_CONFLICT, index);
        return;
    }
    let a_is_identity_root = identity_before(
        record.source_a_entity_id,
        record.source_a_incarnation,
        record.source_b_entity_id,
        record.source_b_incarnation
    );
    if (!a_is_identity_root
        || record.destination_entity_id != record.source_a_entity_id
        || record.source_a_incarnation == INVALID - 1u
        || record.destination_incarnation != record.source_a_incarnation + 1u) {
        fail_transform(STATUS_DESTINATION_CONFLICT, index);
        return;
    }
    let destination_members = record.source_a_member_count
        + record.source_b_member_count;
    let destination_generation = max(
        record.source_a_generation,
        record.source_b_generation
    ) + 1u;
    if (destination_generation == 0u || destination_generation == INVALID) {
        fail_transform(STATUS_GENERATION_EXHAUSTED, index);
        return;
    }
    if (record.destination_definition_code != FORMATION_DEFINITION_HEXA_RING
        || record.destination_coordinate_system_code != COORDINATE_HEX_AXIAL
        || record.destination_policy_code != select(
            POLICY_SEEK_FORMATION,
            POLICY_KEEP_FORMATION,
            destination_members == MAX_MEMBERS
        )
        || record.destination_member_count != destination_members
        || destination_members < 2u || destination_members > MAX_MEMBERS
        || countOneBits(record.destination_occupied_slot_mask & OCCUPIED_MASK)
            != destination_members
        || (record.destination_occupied_slot_mask & ~OCCUPIED_MASK) != 0u
        || record.destination_rotation_step >= 6u
        || record.destination_occupied_slot_mask != rotate_mask_plus_60(
            (1u << destination_members) - 1u,
            record.destination_rotation_step
        )
        || record.destination_generation != destination_generation
        || record.destination_flags != FORMATION_FLAG_ACTIVE
        || record.destination_lineage_hash == 0u
        || record.destination_lineage_hash == INVALID) {
        fail_transform(STATUS_RECORD_INVALID, index);
        return;
    }
    let merged_current = merged_health(
        record.source_a_current_health_centi,
        record.source_b_current_health_centi
    );
    let merged_max = merged_health(
        record.source_a_max_health_centi,
        record.source_b_max_health_centi
    );
    if (merged_current <= 0 || merged_max <= 0 || merged_current > merged_max
        || merged_current != record.expected_current_health_centi
        || merged_max != record.expected_max_health_centi) {
        fail_transform(STATUS_HP_OVERFLOW, index);
        return;
    }
    if (record.destination_inverse_mass
            != HEXA_INVERSE_MASS[destination_members]
        || record.destination_flow_speed != HEXA_FLOW_SPEED[destination_members]
        || record.destination_tower_contact_damage
            != HEXA_TOWER_DAMAGE[destination_members]
        || !(record.destination_radius > 0.0)) {
        fail_transform(STATUS_RECORD_INVALID, index);
        return;
    }
    let expected_motion_source = select(
        1u,
        0u,
        motion_source_is_a(record.source_a_slot, record.source_b_slot)
    );
    if (record.motion_source_index != expected_motion_source) {
        fail_transform(STATUS_RECORD_INVALID, index);
        return;
    }
    for (var source_index = 0u; source_index < 2u; source_index += 1u) {
        let source_slot = select(
            record.source_a_slot,
            record.source_b_slot,
            source_index == 1u
        );
        loop {
            let claim = atomicCompareExchangeWeak(
                &candidate_states.values[source_slot].program_index,
                INVALID_PROGRAM,
                index
            );
            if (claim.exchanged) { break; }
            if (claim.old_value != INVALID_PROGRAM) {
                fail_transform(STATUS_SOURCE_CONFLICT, index);
                break;
            }
        }
    }
}

@compute @workgroup_size(256)
fn preflight_formation_route_rekeys(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    if (index >= transform_program.header.count) { return; }
    let record = transform_program.records[index];
    let source_a_route_state = route_states.values[record.source_a_slot];
    let source_b_route_state = route_states.values[record.source_b_slot];
    if (!formation_route_source_is_transformable(
            source_a_route_state,
            record.source_a_entity_id,
            record.source_a_incarnation
        ) || !formation_route_source_is_transformable(
            source_b_route_state,
            record.source_b_entity_id,
            record.source_b_incarnation
        ) || !formation_route_pair_is_compatible(
            record.source_a_slot,
            record.source_b_slot
        )) {
        fail_transform(STATUS_SOURCE_CONFLICT, index);
    }
}

fn effect_target_transform_index(instance: EffectInstance) -> u32 {
    if (instance.target_slot >= arrayLength(&candidate_states.values)) {
        return INVALID_PROGRAM;
    }
    let index = atomicLoad(&candidate_states.values[instance.target_slot].program_index);
    if (index >= transform_program.header.count) {
        return INVALID_PROGRAM;
    }
    let record = transform_program.records[index];
    let matches_a = instance.target_slot == record.source_a_slot
        && instance.target_entity_id == record.source_a_entity_id
        && instance.target_incarnation == record.source_a_incarnation;
    let matches_b = instance.target_slot == record.source_b_slot
        && instance.target_entity_id == record.source_b_entity_id
        && instance.target_incarnation == record.source_b_incarnation;
    return select(INVALID_PROGRAM, index, matches_a || matches_b);
}

@compute @workgroup_size(256)
fn preflight_formation_effect_rekeys(@builtin(global_invocation_id) id: vec3u) {
    if (effect_pool_state.abi_version != EFFECT_RUNTIME_ABI_VERSION
        || effect_pool_state.input_count > arrayLength(&effect_instances.values)) {
        if (id.x == 0u) { fail_transform(STATUS_EFFECT_CONFLICT, 0u); }
        return;
    }
    let index = id.x;
    if (index >= effect_pool_state.input_count) { return; }
    let instance = effect_instances.values[index];
    if ((instance.flags & EFFECT_INSTANCE_ACTIVE) == 0u) { return; }
    if (instance.applied_tick > transform_program.header.target_fixed_tick
        || transform_program.header.target_fixed_tick
            >= instance.expires_at_tick) {
        return;
    }
    let transform_index = effect_target_transform_index(instance);
    if (transform_index != INVALID_PROGRAM) {
        let root_slot
            = transform_program.records[transform_index].source_a_slot;
        atomicAdd(&candidate_states.values[root_slot].status, 1u);
        atomicAdd(&transform_program.header.effect_rekey_count, 1u);
        return;
    }
    for (var record_index = 0u;
        record_index < transform_program.header.count;
        record_index += 1u) {
        let record = transform_program.records[record_index];
        let identity_matches_source = (
            instance.target_entity_id == record.source_a_entity_id
            && instance.target_incarnation == record.source_a_incarnation
        ) || (
            instance.target_entity_id == record.source_b_entity_id
            && instance.target_incarnation == record.source_b_incarnation
        );
        if (identity_matches_source) {
            fail_transform(STATUS_EFFECT_CONFLICT, record_index);
            return;
        }
    }
}

@compute @workgroup_size(1)
fn seal_formation_transform_preflight(@builtin(global_invocation_id) id: vec3u) {
    if (id.x != 0u) { return; }
    if (atomicLoad(&transform_program.header.status) == 0u) {
        for (var index = 0u;
            index < transform_program.header.count;
            index += 1u) {
            let root_slot = transform_program.records[index].source_a_slot;
            transform_program.records[index].prepared_effect_rekey_count
                = atomicLoad(&candidate_states.values[root_slot].status);
            atomicStore(&candidate_states.values[root_slot].reserved_0, 0u);
        }
        transform_program.header.prepared_effect_rekey_count
            = atomicLoad(&transform_program.header.effect_rekey_count);
        atomicStore(&transform_program.header.effect_rekey_count, 0u);
        atomicStore(&transform_program.header.batch_accepted, 1u);
        return;
    }
    for (var index = 0u; index < transform_program.header.count; index += 1u) {
        transform_program.records[index].result = TRANSFORM_RESULT_BATCH_REJECTED;
    }
}

@compute @workgroup_size(256)
fn rekey_formation_effect_instances(@builtin(global_invocation_id) id: vec3u) {
    if (atomicLoad(&transform_program.header.batch_accepted) == 0u
        || id.x >= effect_pool_state.input_count) {
        return;
    }
    var instance = effect_instances.values[id.x];
    if ((instance.flags & EFFECT_INSTANCE_ACTIVE) == 0u) { return; }
    if (instance.applied_tick > transform_program.header.target_fixed_tick
        || transform_program.header.target_fixed_tick
            >= instance.expires_at_tick) {
        return;
    }
    let transform_index = effect_target_transform_index(instance);
    if (transform_index == INVALID_PROGRAM) { return; }
    let record = transform_program.records[transform_index];
    let root_slot = record.source_a_slot;
    instance.target_slot = root_slot;
    instance.target_entity_id = record.destination_entity_id;
    instance.target_incarnation = record.destination_incarnation;
    effect_instances.values[id.x] = instance;
    atomicAdd(&candidate_states.values[root_slot].reserved_0, 1u);
    atomicAdd(&transform_program.header.effect_rekey_count, 1u);
}

fn clear_combat_state(slot: u32, preserve_policy_from: u32) {
    let preserved = combat_states.values[preserve_policy_from];
    combat_states.values[slot] = CombatState(
        preserved.target_interaction_layer_mask,
        preserved.maximum_damage_window_duration_fixed_ticks,
        0,
        0u,
        INVALID,
        INVALID,
        0u, 0u, 0u, 0u
    );
}

fn tombstone_body(slot: u32) {
    physics.values[slot] = BodyPhysics(
        vec2f(0.0), vec2f(0.0), 0.0, 0.0, 0u, 0u
    );
    simulations.values[slot].lifetime = 0.0;
    atomicStore(&simulations.values[slot].health, 0);
    simulations.values[slot].gameplay_meta = 0u;
    atomicStore(&simulations.values[slot].flags, 0u);
    simulations.values[slot].flow_field_index = INVALID;
    simulations.values[slot].flow_speed = 0.0;
    simulations.values[slot].entity_id = INVALID;
    simulations.values[slot].incarnation = INVALID;
    temporaries.values[slot] = BodyTemporary(
        vec2f(0.0), vec2f(0.0), vec2f(0.0), -1, INVALID
    );
    contact_handlers.values[slot] = ContactHandler(
        0.0, 0.0, 0.0, 0.0, 0u, 0, 0, 0.0
    );
    combat_states.values[slot] = CombatState(
        0u, 0u, 0, 0u, INVALID, INVALID, 0u, 0u, 0u, 0u
    );
}

@compute @workgroup_size(256)
fn commit_formation_transform_bodies(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    if (atomicLoad(&transform_program.header.batch_accepted) == 0u
        || index >= transform_program.header.count) {
        return;
    }
    let record = transform_program.records[index];
    let root_slot = record.source_a_slot;
    let other_slot = record.source_b_slot;
    let motion_slot = select(
        record.source_a_slot,
        record.source_b_slot,
        record.motion_source_index == 1u
    );
    let motion_physics = physics.values[motion_slot];
    let motion_temporary = temporaries.values[motion_slot];
    let destination_field = max(
        simulations.values[root_slot].flow_field_index,
        simulations.values[other_slot].flow_field_index
    );
    physics.values[root_slot] = BodyPhysics(
        motion_physics.position,
        motion_physics.velocity,
        record.destination_radius,
        record.destination_inverse_mass,
        motion_physics.physical_meta,
        motion_physics.interaction_meta
    );
    temporaries.values[root_slot] = motion_temporary;
    atomicStore(
        &simulations.values[root_slot].health,
        record.expected_current_health_centi
    );
    simulations.values[root_slot].flow_field_index = destination_field;
    simulations.values[root_slot].flow_speed = record.destination_flow_speed;
    simulations.values[root_slot].entity_id = record.destination_entity_id;
    simulations.values[root_slot].incarnation = record.destination_incarnation;
    atomicStore(&simulations.values[root_slot].flags, DESTINATION_BODY_FLAGS);
    contact_handlers.values[root_slot].damage_other
        = record.destination_tower_contact_damage;
    clear_combat_state(root_slot, root_slot);
    tombstone_body(other_slot);
}

fn clear_formation_route_state(slot: u32) {
    route_states.values[slot] = RouteRuntimeState(
        0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u,
        0.0, 0.0, 0u, 0u, 0u, 0u, 0u, 0u
    );
}

@compute @workgroup_size(256)
fn commit_formation_route_state(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    if (atomicLoad(&transform_program.header.batch_accepted) == 0u
        || index >= transform_program.header.count) { return; }
    let record = transform_program.records[index];
    let motion_root_slot = select(
        record.source_a_slot,
        record.source_b_slot,
        record.motion_source_index == 1u
    );
    // Snapshot live GPU route authority before sourceB is cleared or sourceA is rekeyed.
    let source_route_state = route_states.values[motion_root_slot];
    let source_route_role = formation_route_role(source_route_state);
    clear_formation_route_state(record.source_b_slot);
    if (source_route_role == ROUTE_ROLE_ACTOR) {
        route_states.values[record.source_a_slot] = source_route_state;
        route_states.values[record.source_a_slot].self_entity_id
            = record.destination_entity_id;
        route_states.values[record.source_a_slot].self_incarnation
            = record.destination_incarnation;
    } else {
        clear_formation_route_state(record.source_a_slot);
    }
}

fn clear_effect_summary(slot: u32) {
    effect_summaries.values[slot].entity_id = INVALID;
    effect_summaries.values[slot].incarnation = INVALID;
    effect_summaries.values[slot].max_health_fixed_point = 0;
    effect_summaries.values[slot].authored_damage_other = 0.0;
    effect_summaries.values[slot].resolved_base_damage_other = 0.0;
    atomicStore(&effect_summaries.values[slot].active_family_mask, 0u);
    atomicStore(&effect_summaries.values[slot].boost_stack_count, 0u);
    effect_summaries.values[slot].regen_per_tick_fixed_point = 0;
    effect_summaries.values[slot].attack_multiplier = 1.0;
    effect_summaries.values[slot].move_speed_multiplier = 1.0;
    atomicStore(&effect_summaries.values[slot].presentation_tags, 0u);
    effect_summaries.values[slot].presentation_magnitude = 0.0;
    effect_summaries.values[slot].last_pulse_tick = INVALID;
    effect_summaries.values[slot].pulse_style_code = 0u;
    effect_summaries.values[slot].summary_tick = 0u;
    effect_summaries.values[slot].source_snapshot_tick = 0u;
    effect_summaries.values[slot].damage_taken_multiplier = 1.0;
    effect_summaries.values[slot].reserved_0 = 0u;
    effect_summaries.values[slot].reserved_1 = 0u;
    atomicStore(&effect_summaries.values[slot].flags, 0u);
}

fn clear_emitter(slot: u32) {
    effect_emitters.values[slot] = EffectEmitterState(
        INVALID, INVALID, 0u, 0u, INVALID, 0u, 0u, INVALID
    );
}

fn clear_enemy_behavior(slot: u32) {
    enemy_behavior_states.values[slot].program_id = 0u;
    atomicStore(&enemy_behavior_states.values[slot].state, 0u);
    enemy_behavior_states.values[slot].state_entered_fixed_tick = 0u;
    enemy_behavior_states.values[slot].state_expires_at_fixed_tick = 0u;
    enemy_behavior_states.values[slot].target_slot = 0u;
    enemy_behavior_states.values[slot].target_entity_id = 0u;
    enemy_behavior_states.values[slot].target_incarnation = 0u;
    atomicStore(&enemy_behavior_states.values[slot].flags, 0u);
    enemy_behavior_states.values[slot].charge_direction = vec2f(0.0);
    enemy_behavior_states.values[slot].windup_range = 0.0;
    enemy_behavior_states.values[slot].charge_speed = 0.0;
    enemy_behavior_states.values[slot].recoil_impulse = 0.0;
    enemy_behavior_states.values[slot].windup_ticks = 0u;
    enemy_behavior_states.values[slot].charge_max_ticks = 0u;
    enemy_behavior_states.values[slot].recoil_ticks = 0u;
    enemy_behavior_states.values[slot].recover_ticks = 0u;
    enemy_behavior_states.values[slot].telegraph_style_code = 0u;
    enemy_behavior_states.values[slot].telegraph_color_rgba8 = 0u;
    enemy_behavior_states.values[slot].telegraph_radius_scale = 0.0;
    enemy_behavior_states.values[slot].charge_acceleration = 0.0;
    enemy_behavior_states.values[slot].reserved_0 = 0u;
    enemy_behavior_states.values[slot].reserved_1 = 0u;
    enemy_behavior_states.values[slot].reserved_2 = 0u;
}

fn clear_body_control(slot: u32) {
    body_control_states.values[slot] = BodyControlState(
        vec2f(0.0),
        INVALID,
        INVALID,
        0u,
        0u,
        0u,
        0u,
        0u,
        INVALID,
        INVALID,
        INVALID,
        0u,
        0u,
        0.0,
        0u
    );
}

fn reset_projectile_capture_state(
    slot: u32,
    self_entity_id: u32,
    self_incarnation: u32
) {
    atomicStore(&projectile_capture_states.values[slot].packed_meta, 0u);
    projectile_capture_states.values[slot].self_entity_id = self_entity_id;
    projectile_capture_states.values[slot].self_incarnation = self_incarnation;
    projectile_capture_states.values[slot].peer_body_slot = INVALID;
    projectile_capture_states.values[slot].peer_entity_id = INVALID;
    projectile_capture_states.values[slot].peer_incarnation = INVALID;
    projectile_capture_states.values[slot].captured_at_fixed_tick = 0u;
    projectile_capture_states.values[slot].release_due_fixed_tick = 0u;
    projectile_capture_states.values[slot].capture_sequence = 0u;
    projectile_capture_states.values[slot].captured_speed = 0.0;
    projectile_capture_states.values[slot].facing = vec2f(0.0);
}

@compute @workgroup_size(256)
fn commit_formation_transform_auxiliary(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    if (atomicLoad(&transform_program.header.batch_accepted) == 0u
        || index >= transform_program.header.count) {
        return;
    }
    let record = transform_program.records[index];
    let root_slot = record.source_a_slot;
    let other_slot = record.source_b_slot;
    let root_route_first = formation_states.values[root_slot].route_first_field_index;
    let root_route_count = formation_states.values[root_slot].route_field_count;
    formation_states.values[root_slot] = FormationState(
        record.destination_entity_id,
        record.destination_incarnation,
        record.destination_definition_code,
        record.destination_coordinate_system_code,
        record.destination_policy_code,
        record.destination_member_count,
        record.destination_occupied_slot_mask,
        record.destination_rotation_step,
        record.destination_generation,
        FORMATION_FLAG_ACTIVE | FORMATION_FLAG_TRANSFORMED
            | FORMATION_FLAG_MERGE_PULSE,
        record.destination_lineage_hash,
        root_route_first,
        root_route_count,
        record.target_fixed_tick,
        FORMATION_FLAG_MERGE_PULSE,
        record.target_fixed_tick,
        INVALID,
        INVALID,
        0u,
        0u
    );
    formation_states.values[other_slot] = FormationState(
        INVALID, INVALID, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u,
        0u, 0u, 0u, 0u, 0u, 0u, INVALID, INVALID, 0u, 0u
    );
    clear_effect_summary(root_slot);
    effect_summaries.values[root_slot].entity_id = record.destination_entity_id;
    effect_summaries.values[root_slot].incarnation = record.destination_incarnation;
    effect_summaries.values[root_slot].max_health_fixed_point
        = record.expected_max_health_centi;
    effect_summaries.values[root_slot].authored_damage_other
        = record.destination_tower_contact_damage;
    effect_summaries.values[root_slot].resolved_base_damage_other
        = record.destination_tower_contact_damage;
    clear_effect_summary(other_slot);
    clear_emitter(root_slot);
    clear_emitter(other_slot);
    clear_enemy_behavior(root_slot);
    clear_enemy_behavior(other_slot);
    clear_body_control(root_slot);
    clear_body_control(other_slot);
    reset_projectile_capture_state(
        root_slot,
        record.destination_entity_id,
        record.destination_incarnation
    );
    reset_projectile_capture_state(other_slot, INVALID, INVALID);
    let destination_color = render_styles.values[root_slot].color;
    render_styles.values[root_slot] = BodyRenderStyle(
        destination_color,
        1.0,
        1u,
        RENDER_SHAPE_HEXA,
        0u
    );
    render_styles.values[other_slot] = BodyRenderStyle(
        vec4f(0.0), 0.0, 0u, RENDER_SHAPE_HEXA, 0u
    );
    transform_program.records[index].effect_rekey_count = atomicLoad(
        &candidate_states.values[root_slot].reserved_0
    );
    transform_program.records[index].result = TRANSFORM_RESULT_COMMITTED;
    atomicAdd(&transform_program.header.committed_count, 1u);
}
`;

export const GPU_FORMATION_RUNTIME_ENTRY_POINT = Object.freeze({
    CLEAR_CANDIDATES: 'clear_formation_candidate_states',
    SEED_MOTION: 'seed_formation_motion',
    SELECT_MOTION: 'select_formation_motion_candidates',
    ADVANCE_MOTION: 'advance_formation_motion',
    SEED_PREPARE: 'seed_formation_prepare',
    SELECT_PREPARE: 'select_formation_prepare_candidates',
    FINALIZE_PREPARE: 'finalize_formation_prepare',
    SEAL_PREPARE: 'seal_formation_prepare',
    RESET_TRANSFORM: 'reset_formation_transform',
    PREFLIGHT_TRANSFORMS: 'preflight_formation_transforms',
    PREFLIGHT_ROUTE_REKEYS: 'preflight_formation_route_rekeys',
    PREFLIGHT_EFFECT_REKEYS: 'preflight_formation_effect_rekeys',
    SEAL_TRANSFORM: 'seal_formation_transform_preflight',
    REKEY_EFFECTS: 'rekey_formation_effect_instances',
    COMMIT_BODIES: 'commit_formation_transform_bodies',
    COMMIT_ROUTE_STATE: 'commit_formation_route_state',
    COMMIT_AUXILIARY: 'commit_formation_transform_auxiliary'
});

/**
 * Explicit pipeline-layout storage counts.  Simulation construction verifies
 * its concrete binding plans against this table before creating pipelines, so
 * runtime/NW evidence is derived from the actual accepted layout vocabulary.
 */
export const GPU_FORMATION_RUNTIME_STORAGE_PROFILE = Object.freeze({
    byEntryPoint: Object.freeze({
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.CLEAR_CANDIDATES]: 1,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.SEED_MOTION]: 7,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.SELECT_MOTION]: 8,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.ADVANCE_MOTION]: 6,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.SEED_PREPARE]: 4,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.SELECT_PREPARE]: 9,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.FINALIZE_PREPARE]: 5,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.SEAL_PREPARE]: 1,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.RESET_TRANSFORM]: 1,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.PREFLIGHT_TRANSFORMS]: 7,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.PREFLIGHT_ROUTE_REKEYS]: 4,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.PREFLIGHT_EFFECT_REKEYS]: 4,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.SEAL_TRANSFORM]: 2,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.REKEY_EFFECTS]: 4,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.COMMIT_BODIES]: 6,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.COMMIT_ROUTE_STATE]: 2,
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.COMMIT_AUXILIARY]: 9
    }),
    maximum: 9,
    render: 9
});
