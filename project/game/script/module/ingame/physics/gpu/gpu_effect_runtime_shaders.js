import {
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_GAMEPLAY_META,
    GPU_CIRCLE_BODY_LAYER
} from './gpu_circle_body_abi.js';
import {
    GPU_EFFECT_EMITTER_FLAG,
    GPU_EFFECT_EMITTER_NAVIGATION_CONFIG,
    GPU_EFFECT_DAMAGE_CHANNEL_FLAG,
    GPU_EFFECT_EVENT_TYPE,
    GPU_EFFECT_FAMILY_CODE,
    GPU_EFFECT_INSTANCE_FLAG,
    GPU_EFFECT_LAST_PULSE_TICK_INVALID,
    GPU_EFFECT_PRESENTATION_TAG,
    GPU_EFFECT_PULSE_PROGRAM_FLAG,
    GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
    GPU_EFFECT_PULSE_PROGRAM_RESULT,
    GPU_EFFECT_RUNTIME_ABI_VERSION,
    GPU_EFFECT_RUNTIME_STATUS,
    GPU_EFFECT_SUMMARY_FLAG,
    GPU_EFFECT_TARGET_POLICY
} from './gpu_effect_runtime_abi.js';
import {
    GPU_ENEMY_EFFECT_DEFINITION_CODE,
    GPU_ENEMY_EFFECT_EMITTER_DEFINITION_CODE,
    PENTA_BOOST_EFFECT_DEFINITION,
    PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE
} from '../../../../data/object/enemy/enemy_effect_catalog_data.js';
import { GAMEPLAY_TEAM_ID } from '../../contract/gameplay_team_contract.js';

const toWgslFloat = (value) => {
    const normalized = Math.fround(Number(value));
    if (!Number.isFinite(normalized)) {
        throw new TypeError('Effect WGSL 상수는 유한 float32여야 합니다.');
    }
    const literal = String(Object.is(normalized, -0) ? 0 : normalized);
    return /[.eE]/.test(literal) ? literal : `${literal}.0`;
};

const EXPECTED_PULSE_POLICY_FLAGS = (
    (PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.selfTargetAllowed
        ? GPU_EFFECT_PULSE_PROGRAM_FLAG.SELF_TARGET_ALLOWED
        : 0)
    | (PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.pentaTargetAllowed
        ? GPU_EFFECT_PULSE_PROGRAM_FLAG.PENTA_TARGET_ALLOWED
        : 0)
    | (PENTA_BOOST_EFFECT_DEFINITION.towerContactDamageEffectModifiable
        ? GPU_EFFECT_PULSE_PROGRAM_FLAG.TOWER_CONTACT_DAMAGE_MODIFIABLE
        : 0)
    | (PENTA_BOOST_EFFECT_DEFINITION.projectileTowerDamageEffectModifiable
        ? GPU_EFFECT_PULSE_PROGRAM_FLAG.PROJECTILE_TOWER_DAMAGE_MODIFIABLE
        : 0)
    | (PENTA_BOOST_EFFECT_DEFINITION.directCoreImpactDamageEffectModifiable
        ? GPU_EFFECT_PULSE_PROGRAM_FLAG.DIRECT_CORE_IMPACT_DAMAGE_MODIFIABLE
        : 0)
    | (PENTA_BOOST_EFFECT_DEFINITION.typedProjectileCoreDamageEffectModifiable
        ? GPU_EFFECT_PULSE_PROGRAM_FLAG.PROJECTILE_CORE_DAMAGE_MODIFIABLE
        : 0)
) >>> 0;

if (!PENTA_BOOST_EFFECT_DEFINITION.towerContactDamageEffectModifiable
    || !PENTA_BOOST_EFFECT_DEFINITION.projectileTowerDamageEffectModifiable
    || PENTA_BOOST_EFFECT_DEFINITION.directCoreImpactDamageEffectModifiable
    || PENTA_BOOST_EFFECT_DEFINITION.typedProjectileCoreDamageEffectModifiable) {
    throw new RangeError('PENTA Boost damage-channel policy가 Turn 3 LOCK과 다릅니다.');
}
if (PENTA_BOOST_EFFECT_DEFINITION.moveSpeedMultiplier !== 1) {
    throw new RangeError('Turn 3 P navigation은 catalog moveSpeedMultiplier=1을 요구합니다.');
}

/**
 * Body ABI v8의 독립 80B EnemyBehaviorState/capture side-plane과 별개인 EffectInstance A/B pool,
 * per-body summary/emitter 및 독립 AtomicTransformState side-plane을 유지하며,
 * tick-start grid pulse scan 및 Pentagon cluster navigation shader입니다.
 */
export const GPU_EFFECT_RUNTIME_COMPUTE_WGSL = /* wgsl */`
const BODY_ABI_VERSION: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;
const EFFECT_RUNTIME_ABI_VERSION: u32 = ${GPU_EFFECT_RUNTIME_ABI_VERSION}u;
const EFFECT_PULSE_PROGRAM_ABI_VERSION: u32 = ${GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION}u;
const INVALID_IDENTITY_COMPONENT: u32 = 0xffffffffu;
const BODY_FLAG_ALIVE: u32 = 1u;
const BODY_LAYER_ENEMY: u32 = ${GPU_CIRCLE_BODY_LAYER.ENEMY}u;
const GAMEPLAY_TEAM_HOSTILE: u32 = ${GAMEPLAY_TEAM_ID.HOSTILE}u;
const GAMEPLAY_META_TEAM_SHIFT: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_SHIFT}u;
const GAMEPLAY_META_TEAM_MASK: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_MASK}u;
const EFFECT_EMITTER_FLAG_ENABLED: u32 = ${GPU_EFFECT_EMITTER_FLAG.ENABLED}u;
const EFFECT_EMITTER_FLAG_GRID_OVERFLOW_OBSERVED: u32 = ${GPU_EFFECT_EMITTER_FLAG.GRID_OVERFLOW_OBSERVED}u;
const EFFECT_INSTANCE_FLAG_ACTIVE: u32 = ${GPU_EFFECT_INSTANCE_FLAG.ACTIVE}u;
const EFFECT_INSTANCE_FLAG_PERSIST_AFTER_SOURCE_LOSS: u32 = ${GPU_EFFECT_INSTANCE_FLAG.PERSIST_AFTER_SOURCE_LOSS}u;
const EFFECT_INSTANCE_FLAG_TOWER_CONTACT_DAMAGE_MODIFIABLE: u32 = ${GPU_EFFECT_INSTANCE_FLAG.TOWER_CONTACT_DAMAGE_MODIFIABLE}u;
const EFFECT_INSTANCE_FLAG_PROJECTILE_TOWER_DAMAGE_MODIFIABLE: u32 = ${GPU_EFFECT_INSTANCE_FLAG.PROJECTILE_TOWER_DAMAGE_MODIFIABLE}u;
const EFFECT_INSTANCE_FLAG_DIRECT_CORE_IMPACT_DAMAGE_MODIFIABLE: u32 = ${GPU_EFFECT_INSTANCE_FLAG.DIRECT_CORE_IMPACT_DAMAGE_MODIFIABLE}u;
const EFFECT_INSTANCE_FLAG_PROJECTILE_CORE_DAMAGE_MODIFIABLE: u32 = ${GPU_EFFECT_INSTANCE_FLAG.PROJECTILE_CORE_DAMAGE_MODIFIABLE}u;
const EFFECT_PULSE_FLAG_SELF_TARGET_ALLOWED: u32 = ${GPU_EFFECT_PULSE_PROGRAM_FLAG.SELF_TARGET_ALLOWED}u;
const EFFECT_PULSE_FLAG_PENTA_TARGET_ALLOWED: u32 = ${GPU_EFFECT_PULSE_PROGRAM_FLAG.PENTA_TARGET_ALLOWED}u;
const EFFECT_PULSE_FLAG_TOWER_CONTACT_DAMAGE_MODIFIABLE: u32 = ${GPU_EFFECT_PULSE_PROGRAM_FLAG.TOWER_CONTACT_DAMAGE_MODIFIABLE}u;
const EFFECT_PULSE_FLAG_PROJECTILE_TOWER_DAMAGE_MODIFIABLE: u32 = ${GPU_EFFECT_PULSE_PROGRAM_FLAG.PROJECTILE_TOWER_DAMAGE_MODIFIABLE}u;
const EFFECT_PULSE_FLAG_DIRECT_CORE_IMPACT_DAMAGE_MODIFIABLE: u32 = ${GPU_EFFECT_PULSE_PROGRAM_FLAG.DIRECT_CORE_IMPACT_DAMAGE_MODIFIABLE}u;
const EFFECT_PULSE_FLAG_PROJECTILE_CORE_DAMAGE_MODIFIABLE: u32 = ${GPU_EFFECT_PULSE_PROGRAM_FLAG.PROJECTILE_CORE_DAMAGE_MODIFIABLE}u;
const EFFECT_PULSE_FLAG_ALLOW_SOURCE_INVALID: u32 = ${GPU_EFFECT_PULSE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID}u;
const EXPECTED_PULSE_POLICY_FLAGS: u32 = ${EXPECTED_PULSE_POLICY_FLAGS}u;
const EFFECT_DAMAGE_CHANNEL_TOWER_CONTACT: u32 = ${GPU_EFFECT_DAMAGE_CHANNEL_FLAG.TOWER_CONTACT}u;
const EFFECT_DAMAGE_CHANNEL_PROJECTILE_TOWER: u32 = ${GPU_EFFECT_DAMAGE_CHANNEL_FLAG.PROJECTILE_TOWER}u;
const EFFECT_DAMAGE_CHANNEL_DIRECT_CORE_IMPACT: u32 = ${GPU_EFFECT_DAMAGE_CHANNEL_FLAG.DIRECT_CORE_IMPACT}u;
const EFFECT_DAMAGE_CHANNEL_PROJECTILE_CORE: u32 = ${GPU_EFFECT_DAMAGE_CHANNEL_FLAG.PROJECTILE_CORE}u;
const EFFECT_SUMMARY_FLAG_PROJECTILE_ATTACK_SNAPSHOT: u32 = ${GPU_EFFECT_SUMMARY_FLAG.PROJECTILE_ATTACK_SNAPSHOT}u;
const EFFECT_FAMILY_BOOST: u32 = ${GPU_EFFECT_FAMILY_CODE.BOOST}u;
const EFFECT_FAMILY_BOOST_MASK: u32 = ${1 << GPU_EFFECT_FAMILY_CODE.BOOST}u;
const EFFECT_PRESENTATION_TAG_BOOST: u32 = ${GPU_EFFECT_PRESENTATION_TAG.BOOST}u;
const EFFECT_PRESENTATION_TAG_PULSE: u32 = ${GPU_EFFECT_PRESENTATION_TAG.PULSE}u;
const EFFECT_EVENT_PULSE_EMITTED: u32 = ${GPU_EFFECT_EVENT_TYPE.PULSE_EMITTED}u;
const EFFECT_EVENT_INSTANCE_APPLIED: u32 = ${GPU_EFFECT_EVENT_TYPE.INSTANCE_APPLIED}u;
const EFFECT_TARGET_POLICY_HOSTILE_ENEMY: u32 = ${GPU_EFFECT_TARGET_POLICY.HOSTILE_ENEMY}u;
const EFFECT_RESULT_PENDING: u32 = ${GPU_EFFECT_PULSE_PROGRAM_RESULT.PENDING}u;
const EFFECT_RESULT_APPLIED: u32 = ${GPU_EFFECT_PULSE_PROGRAM_RESULT.APPLIED}u;
const EFFECT_RESULT_ZERO_TARGET: u32 = ${GPU_EFFECT_PULSE_PROGRAM_RESULT.ZERO_TARGET}u;
const EFFECT_RESULT_SOURCE_INVALID: u32 = ${GPU_EFFECT_PULSE_PROGRAM_RESULT.SOURCE_INVALID}u;
const EFFECT_RESULT_CAPACITY_REJECTED: u32 = ${GPU_EFFECT_PULSE_PROGRAM_RESULT.CAPACITY_REJECTED}u;
const EFFECT_RESULT_POLICY_REJECTED: u32 = ${GPU_EFFECT_PULSE_PROGRAM_RESULT.POLICY_REJECTED}u;
const EFFECT_STATUS_ABI_MISMATCH: u32 = ${GPU_EFFECT_RUNTIME_STATUS.ABI_MISMATCH}u;
const EFFECT_STATUS_PROGRAM_CAPACITY_EXCEEDED: u32 = ${GPU_EFFECT_RUNTIME_STATUS.PROGRAM_CAPACITY_EXCEEDED}u;
const EFFECT_STATUS_CANDIDATE_CAPACITY_EXCEEDED: u32 = ${GPU_EFFECT_RUNTIME_STATUS.CANDIDATE_CAPACITY_EXCEEDED}u;
const EFFECT_STATUS_INSTANCE_CAPACITY_EXCEEDED: u32 = ${GPU_EFFECT_RUNTIME_STATUS.INSTANCE_CAPACITY_EXCEEDED}u;
const EFFECT_STATUS_EVENT_CAPACITY_EXCEEDED: u32 = ${GPU_EFFECT_RUNTIME_STATUS.EVENT_CAPACITY_EXCEEDED}u;
const EFFECT_STATUS_INSTANCE_ID_EXHAUSTED: u32 = ${GPU_EFFECT_RUNTIME_STATUS.INSTANCE_ID_EXHAUSTED}u;
const EFFECT_STATUS_RECORD_INVALID: u32 = ${GPU_EFFECT_RUNTIME_STATUS.RECORD_INVALID}u;
const EFFECT_STATUS_GRID_OVERFLOW: u32 = ${GPU_EFFECT_RUNTIME_STATUS.GRID_OVERFLOW}u;
const PENTA_BOOST_EFFECT_CODE: u32 = ${GPU_ENEMY_EFFECT_DEFINITION_CODE.PENTA_BOOST}u;
const PENTA_EMITTER_CODE: u32 = ${GPU_ENEMY_EFFECT_EMITTER_DEFINITION_CODE.PENTA_CLUSTER_BOOST_PULSE}u;
const PENTA_BOOST_DURATION_TICKS: u32 = ${PENTA_BOOST_EFFECT_DEFINITION.durationTicks}u;
const PENTA_BOOST_REGEN_FIXED_PER_TICK: i32 = ${PENTA_BOOST_EFFECT_DEFINITION.healthDeltaFixedPerTick};
const PENTA_BOOST_REGEN_MINIMUM_STACKS: u32 = ${PENTA_BOOST_EFFECT_DEFINITION.healthDeltaMinimumStackCount}u;
const PENTA_BOOST_ATTACK_MULTIPLIER: f32 = ${toWgslFloat(PENTA_BOOST_EFFECT_DEFINITION.attackMultiplier)};
const PENTA_BOOST_ATTACK_MINIMUM_STACKS: u32 = ${PENTA_BOOST_EFFECT_DEFINITION.attackMinimumStackCount}u;
const PENTA_BOOST_MOVE_SPEED_MULTIPLIER: f32 = ${toWgslFloat(PENTA_BOOST_EFFECT_DEFINITION.moveSpeedMultiplier)};
const PENTA_SEEK_RADIUS_TILES: f32 = ${toWgslFloat(PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.seekRadiusTiles)};
const PENTA_CLUSTER_RADIUS_TILES: f32 = ${toWgslFloat(PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.clusterRadiusTiles)};
const PENTA_CLUSTER_MINIMUM_MEMBERS: u32 = ${PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.minimumClusterMemberCount}u;
const PENTA_HOLD_RADIUS_TILES: f32 = ${toWgslFloat(PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.holdRadiusTiles)};
const EFFECT_NAV_RETARGET_INTERVAL_MASK: u32 = ${GPU_EFFECT_EMITTER_NAVIGATION_CONFIG.RETARGET_INTERVAL_MASK}u;
const EFFECT_NAV_ROUTE_FIRST_FIELD_SHIFT: u32 = ${GPU_EFFECT_EMITTER_NAVIGATION_CONFIG.ROUTE_FIRST_FIELD_SHIFT}u;
const EFFECT_NAV_ROUTE_FIRST_FIELD_MASK: u32 = ${GPU_EFFECT_EMITTER_NAVIGATION_CONFIG.ROUTE_FIRST_FIELD_MASK}u;
const EFFECT_NAV_ROUTE_FIELD_COUNT_SHIFT: u32 = ${GPU_EFFECT_EMITTER_NAVIGATION_CONFIG.ROUTE_FIELD_COUNT_MINUS_ONE_SHIFT}u;
const EFFECT_NAV_ROUTE_FIELD_COUNT_MASK: u32 = ${GPU_EFFECT_EMITTER_NAVIGATION_CONFIG.ROUTE_FIELD_COUNT_MINUS_ONE_MASK}u;
const EFFECT_NAV_RESERVED_MASK: u32 = ${GPU_EFFECT_EMITTER_NAVIGATION_CONFIG.RESERVED_MASK}u;
const MAX_PENTA_ROUTE_LOOKAHEAD_FIELDS: u32 = 32u;
const MAX_PENTA_SDF_SEGMENT_SAMPLES: u32 = 64u;
const FLOW_INTEGRATION_UNREACHABLE_COST: f32 = 10000000000000000000.0;
const EPSILON: f32 = 0.000001;

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

struct EffectProgramHeader {
    abi_version: u32,
    count: u32,
    capacity: u32,
    status: atomic<u32>,
}

struct EffectPulseRecord {
    source_slot: u32,
    source_entity_id: u32,
    source_incarnation: u32,
    effect_definition_code: u32,
    source_tick: u32,
    pulse_sequence: u32,
    radius_tiles: f32,
    target_layer_mask: u32,
    target_policy: u32,
    fingerprint: u32,
    result: u32,
    candidate_count: u32,
    applied_count: u32,
    emitter_definition_code: u32,
    flags: u32,
    retarget_interval_ticks: u32,
}

struct EffectPulseProgram {
    header: EffectProgramHeader,
    records: array<EffectPulseRecord>,
}

struct EffectCandidate {
    pulse_index: u32,
    source_entity_id: u32,
    source_incarnation: u32,
    target_slot: u32,
    target_entity_id: u32,
    target_incarnation: u32,
    effect_definition_code: u32,
    flags: u32,
}

struct EffectEvent {
    event_type: u32,
    flags: u32,
    effect_instance_id: u32,
    instance_incarnation: u32,
    source_entity_id: u32,
    source_incarnation: u32,
    target_entity_id: u32,
    target_incarnation: u32,
    effect_definition_code: u32,
    value_fixed_point: i32,
    world_position: vec2f,
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

struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct TemporaryBuffer { values: array<BodyTemporary> }
struct ContactHandlerBuffer { values: array<ContactHandler> }
struct EffectSummaryBuffer { values: array<EffectSummary> }
struct EffectEmitterStateBuffer { values: array<EffectEmitterState> }
struct EffectInstanceBuffer { values: array<EffectInstance> }
struct EffectCandidateBuffer { values: array<EffectCandidate> }
struct EffectEventBuffer { values: array<EffectEvent> }
struct AtomicGridCounts { values: array<atomic<u32>> }
struct GridBodyBuffer { values: array<GridBody> }
struct SdfBuffer { values: array<f32> }

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read_write> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(3) var<storage, read_write> temporaries: TemporaryBuffer;
@group(0) @binding(4) var<storage, read_write> contact_handlers: ContactHandlerBuffer;
@group(0) @binding(5) var<storage, read_write> effect_summaries: EffectSummaryBuffer;
@group(0) @binding(6) var<storage, read_write> effect_emitters: EffectEmitterStateBuffer;
@group(0) @binding(7) var<storage, read_write> pulse_program: EffectPulseProgram;
@group(0) @binding(8) var<storage, read_write> pool_state: EffectPoolState;
@group(0) @binding(9) var<storage, read> effect_instances_input: EffectInstanceBuffer;
@group(0) @binding(10) var<storage, read_write> effect_instances_output: EffectInstanceBuffer;
@group(0) @binding(11) var<storage, read_write> effect_candidates: EffectCandidateBuffer;
@group(0) @binding(12) var<storage, read_write> effect_events: EffectEventBuffer;
@group(1) @binding(0) var<storage, read_write> grid_counts: AtomicGridCounts;
@group(1) @binding(1) var<storage, read> grid_bodies: GridBodyBuffer;
@group(1) @binding(2) var<storage, read_write> grid_overflow: GridOverflow;
@group(1) @binding(4) var<storage, read> sdf_values: SdfBuffer;
@group(1) @binding(5) var world_flow: texture_2d_array<f32>;
@group(1) @binding(6) var world_flow_integration: texture_2d_array<f32>;
@group(2) @binding(0) var<uniform> params: SimulationParams;

fn body_layer(physical_meta: u32) -> u32 {
    return physical_meta & 65535u;
}

fn gameplay_team_id(gameplay_meta: u32) -> u32 {
    return (gameplay_meta >> GAMEPLAY_META_TEAM_SHIFT) & GAMEPLAY_META_TEAM_MASK;
}

fn body_is_alive(body_id: u32) -> bool {
    return body_id < arrayLength(&simulations.values)
        && (atomicLoad(&simulations.values[body_id].flags) & BODY_FLAG_ALIVE) != 0u;
}

fn identities_match(body_id: u32, entity_id: u32, incarnation: u32) -> bool {
    return body_id < arrayLength(&simulations.values)
        && simulations.values[body_id].entity_id == entity_id
        && simulations.values[body_id].incarnation == incarnation;
}

fn grid_cell_total() -> u32 {
    return params.grid_cell_count.x * params.grid_cell_count.y;
}

fn grid_cell_for_position(position: vec2f) -> vec2i {
    return vec2i(floor(position / params.grid_cell_size));
}

fn grid_bucket_offset(cell_index: u32, bucket: u32) -> u32 {
    return ((cell_index * 2u) + bucket) * params.max_bodies_per_cell;
}

fn big_grid_body_is_canonical_in_cell(grid_body: GridBody, cell_index: u32) -> bool {
    let center_cell = grid_cell_for_position(grid_body.predicted_position);
    if (center_cell.x < 0 || center_cell.y < 0
        || center_cell.x >= i32(params.grid_cell_count.x)
        || center_cell.y >= i32(params.grid_cell_count.y)) {
        return false;
    }
    return u32(center_cell.y) * params.grid_cell_count.x + u32(center_cell.x)
        == cell_index;
}

fn identity_is_after(
    entity_id: u32,
    incarnation: u32,
    previous_entity_id: u32,
    previous_incarnation: u32
) -> bool {
    return entity_id > previous_entity_id
        || (entity_id == previous_entity_id && incarnation > previous_incarnation);
}

fn identity_is_before(
    entity_id: u32,
    incarnation: u32,
    best_entity_id: u32,
    best_incarnation: u32
) -> bool {
    return best_entity_id == INVALID_IDENTITY_COMPONENT
        || entity_id < best_entity_id
        || (entity_id == best_entity_id && incarnation < best_incarnation);
}

fn emitter_retarget_interval(emitter: EffectEmitterState) -> u32 {
    return emitter.navigation_config & EFFECT_NAV_RETARGET_INTERVAL_MASK;
}

fn emitter_route_first_field(emitter: EffectEmitterState) -> u32 {
    return (emitter.navigation_config & EFFECT_NAV_ROUTE_FIRST_FIELD_MASK)
        >> EFFECT_NAV_ROUTE_FIRST_FIELD_SHIFT;
}

fn emitter_route_field_count(emitter: EffectEmitterState) -> u32 {
    return ((emitter.navigation_config & EFFECT_NAV_ROUTE_FIELD_COUNT_MASK)
        >> EFFECT_NAV_ROUTE_FIELD_COUNT_SHIFT) + 1u;
}

fn effect_source_is_valid(record: EffectPulseRecord) -> bool {
    if (record.source_slot == INVALID_IDENTITY_COMPONENT
        || !identities_match(
            record.source_slot,
            record.source_entity_id,
            record.source_incarnation
        )
        || !body_is_alive(record.source_slot)) {
        return false;
    }
    let emitter = effect_emitters.values[record.source_slot];
    return emitter.entity_id == record.source_entity_id
        && emitter.incarnation == record.source_incarnation
        && emitter.emitter_definition_code == record.emitter_definition_code
        && emitter.effect_definition_code == record.effect_definition_code
        && (emitter.navigation_config & EFFECT_NAV_RESERVED_MASK) == 0u
        && emitter_retarget_interval(emitter) == record.retarget_interval_ticks
        && (emitter.flags & EFFECT_EMITTER_FLAG_ENABLED) != 0u;
}

fn effect_target_is_valid(record: EffectPulseRecord, body_id: u32) -> bool {
    if (!body_is_alive(body_id)
        || (body_id == record.source_slot
            && (record.flags & EFFECT_PULSE_FLAG_SELF_TARGET_ALLOWED) == 0u)) {
        return false;
    }
    let physical_layer = body_layer(physics.values[body_id].physical_meta);
    if ((physical_layer & record.target_layer_mask) == 0u
        || record.target_policy != EFFECT_TARGET_POLICY_HOSTILE_ENEMY) {
        return false;
    }
    if (physical_layer != BODY_LAYER_ENEMY
        || gameplay_team_id(simulations.values[body_id].gameplay_meta)
            != GAMEPLAY_TEAM_HOSTILE) {
        return false;
    }
    let target_is_penta = effect_emitters.values[body_id].emitter_definition_code
        == PENTA_EMITTER_CODE;
    return !target_is_penta
        || (record.flags & EFFECT_PULSE_FLAG_PENTA_TARGET_ALLOWED) != 0u;
}

@compute @workgroup_size(1)
fn reset_effect_tick(@builtin(global_invocation_id) global_id: vec3u) {
    if (global_id.x != 0u) {
        return;
    }
    atomicStore(&pool_state.retained_count, 0u);
    atomicStore(&pool_state.candidate_count, 0u);
    atomicStore(&pool_state.valid_pulse_count, 0u);
    atomicStore(&pool_state.event_count, 0u);
    atomicStore(&pool_state.status, 0u);
    atomicStore(&pool_state.batch_accepted, 0u);
    atomicStore(&pool_state.materialized_count, 0u);
    atomicStore(&pool_state.candidate_overflow, 0u);
    atomicStore(&pool_state.event_overflow, 0u);
    atomicStore(&pool_state.pulse_result_count, 0u);
    pool_state.source_tick = params.fixed_tick;
    atomicStore(&pulse_program.header.status, 0u);
    if (counts.abi_version != BODY_ABI_VERSION
        || pool_state.abi_version != EFFECT_RUNTIME_ABI_VERSION
        || pulse_program.header.abi_version != EFFECT_PULSE_PROGRAM_ABI_VERSION) {
        atomicOr(&pool_state.status, EFFECT_STATUS_ABI_MISMATCH);
        atomicOr(&pulse_program.header.status, EFFECT_STATUS_ABI_MISMATCH);
    }
    if (pulse_program.header.count > pulse_program.header.capacity
        || pulse_program.header.count > arrayLength(&pulse_program.records)) {
        atomicOr(&pool_state.status, EFFECT_STATUS_PROGRAM_CAPACITY_EXCEEDED);
        atomicOr(&pulse_program.header.status, EFFECT_STATUS_PROGRAM_CAPACITY_EXCEEDED);
    }
}

@compute @workgroup_size(256)
fn retain_effect_instances(@builtin(global_invocation_id) global_id: vec3u) {
    let index = global_id.x;
    if (index >= pool_state.input_count
        || index >= arrayLength(&effect_instances_input.values)) {
        return;
    }
    let instance = effect_instances_input.values[index];
    if ((instance.flags & EFFECT_INSTANCE_FLAG_ACTIVE) == 0u
        || params.fixed_tick < instance.applied_tick
        || params.fixed_tick >= instance.expires_at_tick
        || !identities_match(
            instance.target_slot,
            instance.target_entity_id,
            instance.target_incarnation
        )
        || !body_is_alive(instance.target_slot)) {
        return;
    }
    let output_index = atomicAdd(&pool_state.retained_count, 1u);
    if (output_index >= arrayLength(&effect_instances_output.values)) {
        atomicOr(&pool_state.status, EFFECT_STATUS_INSTANCE_CAPACITY_EXCEEDED);
        return;
    }
    effect_instances_output.values[output_index] = instance;
}

fn append_effect_candidate(
    pulse_index: u32,
    record: EffectPulseRecord,
    target_slot: u32
) {
    let index = atomicAdd(&pool_state.candidate_count, 1u);
    if (index >= arrayLength(&effect_candidates.values)) {
        atomicStore(&pool_state.candidate_overflow, 1u);
        return;
    }
    effect_candidates.values[index] = EffectCandidate(
        pulse_index,
        record.source_entity_id,
        record.source_incarnation,
        target_slot,
        simulations.values[target_slot].entity_id,
        simulations.values[target_slot].incarnation,
        record.effect_definition_code,
        0u
    );
}

@compute @workgroup_size(1)
fn scan_effect_pulse_candidates(@builtin(global_invocation_id) global_id: vec3u) {
    if (global_id.x != 0u) {
        return;
    }
    let safe_program_count = min(
        pulse_program.header.count,
        min(pulse_program.header.capacity, arrayLength(&pulse_program.records))
    );
    if (atomicLoad(&grid_overflow.small_count) != 0u
        || atomicLoad(&grid_overflow.big_count) != 0u) {
        atomicOr(&pool_state.status, EFFECT_STATUS_GRID_OVERFLOW);
    }
    if (safe_program_count == 0u) {
        atomicStore(&pool_state.batch_accepted, 1u);
        return;
    }
    for (var pulse_index = 0u; pulse_index < safe_program_count; pulse_index += 1u) {
        var record = pulse_program.records[pulse_index];
        record.result = EFFECT_RESULT_PENDING;
        record.candidate_count = 0u;
        record.applied_count = 0u;
        pulse_program.records[pulse_index] = record;
        if (!effect_source_is_valid(record)) {
            let source_invalid_is_authorized = (record.flags
                & EFFECT_PULSE_FLAG_ALLOW_SOURCE_INVALID) != 0u;
            pulse_program.records[pulse_index].result = select(
                EFFECT_RESULT_POLICY_REJECTED,
                EFFECT_RESULT_SOURCE_INVALID,
                source_invalid_is_authorized
            );
            if (!source_invalid_is_authorized) {
                atomicOr(&pool_state.status, EFFECT_STATUS_RECORD_INVALID);
            }
            atomicAdd(&pool_state.pulse_result_count, 1u);
            continue;
        }
        if (record.effect_definition_code != PENTA_BOOST_EFFECT_CODE
            || record.emitter_definition_code != PENTA_EMITTER_CODE
            || record.target_policy != EFFECT_TARGET_POLICY_HOSTILE_ENEMY
            || record.flags != EXPECTED_PULSE_POLICY_FLAGS
            || record.retarget_interval_ticks == 0u
            || record.radius_tiles <= 0.0
            || record.source_tick != params.fixed_tick) {
            pulse_program.records[pulse_index].result = EFFECT_RESULT_POLICY_REJECTED;
            atomicOr(&pool_state.status, EFFECT_STATUS_RECORD_INVALID);
            atomicAdd(&pool_state.pulse_result_count, 1u);
            continue;
        }
        atomicAdd(&pool_state.valid_pulse_count, 1u);
        let candidate_start = atomicLoad(&pool_state.candidate_count);
        let source_position = physics.values[record.source_slot].position;
        let min_cell = clamp(
            grid_cell_for_position(source_position - vec2f(record.radius_tiles)),
            vec2i(0),
            vec2i(params.grid_cell_count) - vec2i(1)
        );
        let max_cell = clamp(
            grid_cell_for_position(source_position + vec2f(record.radius_tiles)),
            vec2i(0),
            vec2i(params.grid_cell_count) - vec2i(1)
        );
        let radius_squared = record.radius_tiles * record.radius_tiles;
        for (var y = min_cell.y; y <= max_cell.y; y += 1) {
            for (var x = min_cell.x; x <= max_cell.x; x += 1) {
                let cell_index = u32(y) * params.grid_cell_count.x + u32(x);
                let small_count = min(
                    atomicLoad(&grid_counts.values[cell_index * 2u]),
                    params.max_bodies_per_cell
                );
                let big_count = min(
                    atomicLoad(&grid_counts.values[(cell_index * 2u) + 1u]),
                    params.max_bodies_per_cell
                );
                let bucket_count = small_count + big_count;
                var previous_entity_id = 0u;
                var previous_incarnation = 0u;
                var has_previous = false;
                for (var ordinal = 0u; ordinal < bucket_count; ordinal += 1u) {
                    var best_slot = INVALID_IDENTITY_COMPONENT;
                    var best_entity_id = INVALID_IDENTITY_COMPONENT;
                    var best_incarnation = INVALID_IDENTITY_COMPONENT;
                    for (var bucket_slot = 0u; bucket_slot < bucket_count; bucket_slot += 1u) {
                        var bucket = 0u;
                        var index_in_bucket = bucket_slot;
                        if (bucket_slot >= small_count) {
                            bucket = 1u;
                            index_in_bucket = bucket_slot - small_count;
                        }
                        let storage_index = grid_bucket_offset(cell_index, bucket)
                            + index_in_bucket;
                        let grid_body = grid_bodies.values[storage_index];
                        if (bucket == 1u
                            && !big_grid_body_is_canonical_in_cell(
                                grid_body,
                                cell_index
                            )) {
                            continue;
                        }
                        let body_id = grid_body.body_id;
                        if (!effect_target_is_valid(record, body_id)) {
                            continue;
                        }
                        let delta = physics.values[body_id].position - source_position;
                        if (dot(delta, delta) > radius_squared) {
                            continue;
                        }
                        let entity_id = simulations.values[body_id].entity_id;
                        let incarnation = simulations.values[body_id].incarnation;
                        if (has_previous && !identity_is_after(
                            entity_id,
                            incarnation,
                            previous_entity_id,
                            previous_incarnation
                        )) {
                            continue;
                        }
                        if (identity_is_before(
                            entity_id,
                            incarnation,
                            best_entity_id,
                            best_incarnation
                        )) {
                            best_slot = body_id;
                            best_entity_id = entity_id;
                            best_incarnation = incarnation;
                        }
                    }
                    if (best_slot == INVALID_IDENTITY_COMPONENT) {
                        break;
                    }
                    append_effect_candidate(pulse_index, record, best_slot);
                    previous_entity_id = best_entity_id;
                    previous_incarnation = best_incarnation;
                    has_previous = true;
                }
            }
        }
        pulse_program.records[pulse_index].candidate_count =
            atomicLoad(&pool_state.candidate_count) - candidate_start;
    }

}

fn write_effect_event(
    index: u32,
    event_type: u32,
    instance_id: u32,
    instance_incarnation: u32,
    source_entity_id: u32,
    source_incarnation: u32,
    target_entity_id: u32,
    target_incarnation: u32,
    effect_definition_code: u32,
    value_fixed_point: i32,
    position: vec2f
) {
    effect_events.values[index] = EffectEvent(
        event_type,
        0u,
        instance_id,
        instance_incarnation,
        source_entity_id,
        source_incarnation,
        target_entity_id,
        target_incarnation,
        effect_definition_code,
        value_fixed_point,
        position
    );
}

@compute @workgroup_size(1)
fn materialize_effect_batch(@builtin(global_invocation_id) global_id: vec3u) {
    if (global_id.x != 0u) {
        return;
    }
    // Candidate scan과 mutation을 분리해 이 serial pass의 기존 8-storage
    // binding set에서 전역 capacity/identity preflight를 먼저 seal합니다.
    let safe_program_count = min(
        pulse_program.header.count,
        min(pulse_program.header.capacity, arrayLength(&pulse_program.records))
    );
    let retained_count = atomicLoad(&pool_state.retained_count);
    let candidate_count = atomicLoad(&pool_state.candidate_count);
    let valid_pulse_count = atomicLoad(&pool_state.valid_pulse_count);
    if (atomicLoad(&pool_state.candidate_overflow) != 0u
        || candidate_count > arrayLength(&effect_candidates.values)) {
        atomicOr(&pool_state.status, EFFECT_STATUS_CANDIDATE_CAPACITY_EXCEEDED);
    }
    if (retained_count + candidate_count
        > arrayLength(&effect_instances_output.values)) {
        atomicOr(&pool_state.status, EFFECT_STATUS_INSTANCE_CAPACITY_EXCEEDED);
    }
    if (valid_pulse_count + candidate_count > arrayLength(&effect_events.values)) {
        atomicStore(&pool_state.event_overflow, 1u);
        atomicOr(&pool_state.status, EFFECT_STATUS_EVENT_CAPACITY_EXCEEDED);
    }
    if (candidate_count > 0u
        && (pool_state.next_instance_id == 0u
            || pool_state.next_instance_id == INVALID_IDENTITY_COMPONENT
            || candidate_count - 1u
                > INVALID_IDENTITY_COMPONENT - 1u - pool_state.next_instance_id)) {
        atomicOr(&pool_state.status, EFFECT_STATUS_INSTANCE_ID_EXHAUSTED);
    }
    if (params.fixed_tick > INVALID_IDENTITY_COMPONENT - PENTA_BOOST_DURATION_TICKS) {
        atomicOr(&pool_state.status, EFFECT_STATUS_RECORD_INVALID);
    }
    let accepted = select(1u, 0u, atomicLoad(&pool_state.status) != 0u);
    atomicStore(&pool_state.batch_accepted, accepted);
    if (accepted == 0u) {
        for (var index = 0u; index < safe_program_count; index += 1u) {
            // A whole-tick preflight failure is represented as one atomic
            // zero-partial batch.  Source/order-specific intermediate results
            // are deliberately erased so the host cannot mistake a prefix for
            // consumed cadence.
            pulse_program.records[index].result = EFFECT_RESULT_CAPACITY_REJECTED;
            pulse_program.records[index].candidate_count = 0u;
            pulse_program.records[index].applied_count = 0u;
        }
        atomicStore(&pool_state.pulse_result_count, safe_program_count);
        atomicStore(&pool_state.candidate_count, 0u);
        atomicStore(&pool_state.materialized_count, 0u);
        atomicStore(&pool_state.event_count, 0u);
        atomicOr(&pulse_program.header.status, atomicLoad(&pool_state.status));
        return;
    }
    let program_count = safe_program_count;
    var event_index = 0u;
    for (var pulse_index = 0u; pulse_index < program_count; pulse_index += 1u) {
        let current_result = pulse_program.records[pulse_index].result;
        if (current_result != EFFECT_RESULT_PENDING) {
            continue;
        }
        let record = pulse_program.records[pulse_index];
        let applied_count = record.candidate_count;
        pulse_program.records[pulse_index].applied_count = applied_count;
        pulse_program.records[pulse_index].result = select(
            EFFECT_RESULT_ZERO_TARGET,
            EFFECT_RESULT_APPLIED,
            applied_count > 0u
        );
        atomicAdd(&pool_state.pulse_result_count, 1u);
        effect_emitters.values[record.source_slot].last_pulse_tick = params.fixed_tick;
        effect_summaries.values[record.source_slot].last_pulse_tick = params.fixed_tick;
        effect_summaries.values[record.source_slot].pulse_style_code =
            record.emitter_definition_code;
        effect_summaries.values[record.source_slot].presentation_magnitude = 1.0;
        atomicOr(
            &effect_summaries.values[record.source_slot].presentation_tags,
            EFFECT_PRESENTATION_TAG_PULSE
        );
        let source_position = physics.values[record.source_slot].position;
        write_effect_event(
            event_index,
            EFFECT_EVENT_PULSE_EMITTED,
            record.fingerprint,
            pool_state.instance_epoch,
            record.source_entity_id,
            record.source_incarnation,
            record.source_entity_id,
            record.source_incarnation,
            record.effect_definition_code,
            i32(applied_count),
            source_position
        );
        event_index += 1u;
    }

    for (var candidate_index = 0u; candidate_index < candidate_count; candidate_index += 1u) {
        let candidate = effect_candidates.values[candidate_index];
        let record = pulse_program.records[candidate.pulse_index];
        let instance_id = pool_state.next_instance_id + candidate_index;
        let output_index = retained_count + candidate_index;
        effect_instances_output.values[output_index] = EffectInstance(
            instance_id,
            pool_state.instance_epoch,
            candidate.effect_definition_code,
            EFFECT_FAMILY_BOOST,
            EFFECT_INSTANCE_FLAG_ACTIVE
                | EFFECT_INSTANCE_FLAG_PERSIST_AFTER_SOURCE_LOSS
                | select(
                    0u,
                    EFFECT_INSTANCE_FLAG_TOWER_CONTACT_DAMAGE_MODIFIABLE,
                    (record.flags
                        & EFFECT_PULSE_FLAG_TOWER_CONTACT_DAMAGE_MODIFIABLE) != 0u
                )
                | select(
                    0u,
                    EFFECT_INSTANCE_FLAG_PROJECTILE_TOWER_DAMAGE_MODIFIABLE,
                    (record.flags
                        & EFFECT_PULSE_FLAG_PROJECTILE_TOWER_DAMAGE_MODIFIABLE) != 0u
                )
                | select(
                    0u,
                    EFFECT_INSTANCE_FLAG_DIRECT_CORE_IMPACT_DAMAGE_MODIFIABLE,
                    (record.flags
                        & EFFECT_PULSE_FLAG_DIRECT_CORE_IMPACT_DAMAGE_MODIFIABLE) != 0u
                )
                | select(
                    0u,
                    EFFECT_INSTANCE_FLAG_PROJECTILE_CORE_DAMAGE_MODIFIABLE,
                    (record.flags
                        & EFFECT_PULSE_FLAG_PROJECTILE_CORE_DAMAGE_MODIFIABLE) != 0u
                ),
            record.source_slot,
            candidate.source_entity_id,
            candidate.source_incarnation,
            candidate.target_slot,
            candidate.target_entity_id,
            candidate.target_incarnation,
            params.fixed_tick,
            params.fixed_tick + PENTA_BOOST_DURATION_TICKS,
            PENTA_BOOST_ATTACK_MULTIPLIER,
            PENTA_BOOST_REGEN_FIXED_PER_TICK,
            EFFECT_PRESENTATION_TAG_BOOST
        );
        write_effect_event(
            event_index,
            EFFECT_EVENT_INSTANCE_APPLIED,
            instance_id,
            pool_state.instance_epoch,
            candidate.source_entity_id,
            candidate.source_incarnation,
            candidate.target_entity_id,
            candidate.target_incarnation,
            candidate.effect_definition_code,
            PENTA_BOOST_REGEN_FIXED_PER_TICK,
            physics.values[candidate.target_slot].position
        );
        event_index += 1u;
    }
    if (candidate_count > 0u) {
        pool_state.next_instance_id += candidate_count;
    }
    atomicStore(&pool_state.materialized_count, candidate_count);
    atomicStore(&pool_state.event_count, event_index);
    pool_state.input_count = retained_count + candidate_count;
}

@compute @workgroup_size(1)
fn finish_effect_tick(@builtin(global_invocation_id) global_id: vec3u) {
    if (global_id.x != 0u) {
        return;
    }
    // Global preflight failure에도 retained A→B set만 다음 tick authority가 됩니다.
    pool_state.input_count = atomicLoad(&pool_state.retained_count)
        + atomicLoad(&pool_state.materialized_count);
}

@compute @workgroup_size(256)
fn clear_effect_summaries(@builtin(global_invocation_id) global_id: vec3u) {
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }
    let summary_identity_valid = effect_summaries.values[body_id].entity_id
            == simulations.values[body_id].entity_id
        && effect_summaries.values[body_id].incarnation
            == simulations.values[body_id].incarnation;
    if (!summary_identity_valid) {
        return;
    }
    let previous_flags = atomicLoad(&effect_summaries.values[body_id].flags);
    let preserve_projectile_snapshot = (previous_flags
        & EFFECT_SUMMARY_FLAG_PROJECTILE_ATTACK_SNAPSHOT) != 0u;
    let preserved_base_damage = effect_summaries.values[body_id]
        .resolved_base_damage_other;
    let preserved_snapshot_tick = effect_summaries.values[body_id]
        .source_snapshot_tick;
    effect_summaries.values[body_id].resolved_base_damage_other = select(
        effect_summaries.values[body_id].authored_damage_other,
        preserved_base_damage,
        preserve_projectile_snapshot
    );
    atomicStore(&effect_summaries.values[body_id].active_family_mask, 0u);
    atomicStore(&effect_summaries.values[body_id].boost_stack_count, 0u);
    effect_summaries.values[body_id].regen_per_tick_fixed_point = 0;
    effect_summaries.values[body_id].attack_multiplier = 1.0;
    effect_summaries.values[body_id].move_speed_multiplier = 1.0;
    atomicStore(&effect_summaries.values[body_id].presentation_tags, 0u);
    effect_summaries.values[body_id].presentation_magnitude = 0.0;
    effect_summaries.values[body_id].summary_tick = params.fixed_tick;
    effect_summaries.values[body_id].source_snapshot_tick = select(
        0u,
        preserved_snapshot_tick,
        preserve_projectile_snapshot
    );
    effect_summaries.values[body_id].damage_taken_multiplier = 1.0;
    atomicStore(
        &effect_summaries.values[body_id].flags,
        select(
            0u,
            EFFECT_SUMMARY_FLAG_PROJECTILE_ATTACK_SNAPSHOT,
            preserve_projectile_snapshot
        )
    );
}

@compute @workgroup_size(256)
fn accumulate_effect_summaries(@builtin(global_invocation_id) global_id: vec3u) {
    let index = global_id.x;
    let active_count = atomicLoad(&pool_state.retained_count)
        + atomicLoad(&pool_state.materialized_count);
    if (index >= active_count || index >= arrayLength(&effect_instances_output.values)) {
        return;
    }
    let instance = effect_instances_output.values[index];
    if ((instance.flags & EFFECT_INSTANCE_FLAG_ACTIVE) == 0u
        || params.fixed_tick < instance.applied_tick
        || params.fixed_tick >= instance.expires_at_tick
        || !identities_match(
            instance.target_slot,
            instance.target_entity_id,
            instance.target_incarnation
        )
        || !body_is_alive(instance.target_slot)) {
        return;
    }
    if (instance.family_code == EFFECT_FAMILY_BOOST) {
        atomicOr(
            &effect_summaries.values[instance.target_slot].active_family_mask,
            EFFECT_FAMILY_BOOST_MASK
        );
        atomicAdd(
            &effect_summaries.values[instance.target_slot].boost_stack_count,
            1u
        );
        atomicOr(
            &effect_summaries.values[instance.target_slot].presentation_tags,
            EFFECT_PRESENTATION_TAG_BOOST
        );
        var damage_channel_flags = 0u;
        if ((instance.flags
            & EFFECT_INSTANCE_FLAG_TOWER_CONTACT_DAMAGE_MODIFIABLE) != 0u) {
            damage_channel_flags |= EFFECT_DAMAGE_CHANNEL_TOWER_CONTACT;
        }
        if ((instance.flags
            & EFFECT_INSTANCE_FLAG_PROJECTILE_TOWER_DAMAGE_MODIFIABLE) != 0u) {
            damage_channel_flags |= EFFECT_DAMAGE_CHANNEL_PROJECTILE_TOWER;
        }
        if ((instance.flags
            & EFFECT_INSTANCE_FLAG_DIRECT_CORE_IMPACT_DAMAGE_MODIFIABLE) != 0u) {
            damage_channel_flags |= EFFECT_DAMAGE_CHANNEL_DIRECT_CORE_IMPACT;
        }
        if ((instance.flags
            & EFFECT_INSTANCE_FLAG_PROJECTILE_CORE_DAMAGE_MODIFIABLE) != 0u) {
            damage_channel_flags |= EFFECT_DAMAGE_CHANNEL_PROJECTILE_CORE;
        }
        atomicOr(
            &effect_summaries.values[instance.target_slot].flags,
            damage_channel_flags
        );
    }
}

@compute @workgroup_size(256)
fn finalize_effect_summaries(@builtin(global_invocation_id) global_id: vec3u) {
    let body_id = global_id.x;
    if (body_id >= counts.body_count || !body_is_alive(body_id)) {
        return;
    }
    let stack_count = atomicLoad(
        &effect_summaries.values[body_id].boost_stack_count
    );
    if (stack_count >= PENTA_BOOST_REGEN_MINIMUM_STACKS) {
        effect_summaries.values[body_id].regen_per_tick_fixed_point =
            PENTA_BOOST_REGEN_FIXED_PER_TICK;
        effect_summaries.values[body_id].presentation_magnitude =
            max(effect_summaries.values[body_id].presentation_magnitude, 1.0);
    }
    if (stack_count >= PENTA_BOOST_ATTACK_MINIMUM_STACKS) {
        effect_summaries.values[body_id].attack_multiplier =
            PENTA_BOOST_ATTACK_MULTIPLIER;
    }
    effect_summaries.values[body_id].move_speed_multiplier =
        PENTA_BOOST_MOVE_SPEED_MULTIPLIER;
}

@compute @workgroup_size(256)
fn apply_effect_regeneration(@builtin(global_invocation_id) global_id: vec3u) {
    let body_id = global_id.x;
    if (body_id >= counts.body_count || !body_is_alive(body_id)) {
        return;
    }
    let delta = effect_summaries.values[body_id].regen_per_tick_fixed_point;
    let maximum = effect_summaries.values[body_id].max_health_fixed_point;
    if (delta <= 0 || maximum <= 0) {
        return;
    }
    var observed = atomicLoad(&simulations.values[body_id].health);
    loop {
        if (observed <= 0 || observed >= maximum) {
            break;
        }
        let desired = min(observed + delta, maximum);
        let exchanged = atomicCompareExchangeWeak(
            &simulations.values[body_id].health,
            observed,
            desired
        );
        if (exchanged.exchanged) {
            break;
        }
        observed = exchanged.old_value;
    }
}

@compute @workgroup_size(256)
fn materialize_effect_contact_damage(@builtin(global_invocation_id) global_id: vec3u) {
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }
    let base_damage = max(
        effect_summaries.values[body_id].resolved_base_damage_other,
        0.0
    );
    let tower_contact_is_modifiable =
        (atomicLoad(&effect_summaries.values[body_id].flags)
            & EFFECT_DAMAGE_CHANNEL_TOWER_CONTACT) != 0u;
    let attack_multiplier = select(
        1.0,
        max(effect_summaries.values[body_id].attack_multiplier, 0.0),
        tower_contact_is_modifiable
    );
    // 매 tick immutable authored/resolved base에서 다시 산출하므로 compounding이 없습니다.
    contact_handlers.values[body_id].damage_other = base_damage * attack_multiplier;
}

fn cluster_member_count(center: vec2i, flow_field_index: u32) -> u32 {
    let center_position = (vec2f(center) + vec2f(0.5)) * params.grid_cell_size;
    let radius_cells = vec2i(ceil(
        vec2f(PENTA_CLUSTER_RADIUS_TILES) / params.grid_cell_size
    ));
    let min_cell = clamp(
        center - radius_cells,
        vec2i(0),
        vec2i(params.grid_cell_count) - vec2i(1)
    );
    let max_cell = clamp(
        center + radius_cells,
        vec2i(0),
        vec2i(params.grid_cell_count) - vec2i(1)
    );
    var count = 0u;
    for (var y = min_cell.y; y <= max_cell.y; y += 1) {
        for (var x = min_cell.x; x <= max_cell.x; x += 1) {
            let cell_index = u32(y) * params.grid_cell_count.x + u32(x);
            for (var bucket = 0u; bucket < 2u; bucket += 1u) {
                let bucket_count = min(
                    atomicLoad(&grid_counts.values[(cell_index * 2u) + bucket]),
                    params.max_bodies_per_cell
                );
                let bucket_offset = grid_bucket_offset(cell_index, bucket);
                for (var slot = 0u; slot < bucket_count; slot += 1u) {
                    let grid_body = grid_bodies.values[bucket_offset + slot];
                    if (bucket == 1u
                        && !big_grid_body_is_canonical_in_cell(
                            grid_body,
                            cell_index
                        )) {
                        continue;
                    }
                    let body_id = grid_body.body_id;
                    if (body_id >= counts.body_count || !body_is_alive(body_id)) {
                        continue;
                    }
                    let member_delta = physics.values[body_id].position - center_position;
                    if (dot(member_delta, member_delta)
                            <= PENTA_CLUSTER_RADIUS_TILES * PENTA_CLUSTER_RADIUS_TILES
                        && body_layer(physics.values[body_id].physical_meta)
                            == BODY_LAYER_ENEMY
                        && gameplay_team_id(simulations.values[body_id].gameplay_meta)
                            == GAMEPLAY_TEAM_HOSTILE
                        && temporaries.values[body_id].previous_flow_field_index
                            == flow_field_index) {
                        count += 1u;
                    }
                }
            }
        }
    }
    return count;
}

fn sdf_value_at(texel: vec2i) -> f32 {
    let clamped = clamp(texel, vec2i(0), vec2i(params.sdf_size) - vec2i(1));
    let index = u32(clamped.y) * params.sdf_size.x + u32(clamped.x);
    return sdf_values.values[index];
}

fn sample_terrain_sdf(world_position: vec2f) -> f32 {
    let uv = world_position / params.world_size;
    let coordinate = clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(params.sdf_size)
        - vec2f(0.5);
    let base = vec2i(floor(coordinate));
    let fraction = fract(coordinate);
    let top = mix(sdf_value_at(base), sdf_value_at(base + vec2i(1, 0)), fraction.x);
    let bottom = mix(
        sdf_value_at(base + vec2i(0, 1)),
        sdf_value_at(base + vec2i(1, 1)),
        fraction.x
    );
    return mix(top, bottom, fraction.y);
}

fn world_boundary_sdf(world_position: vec2f) -> f32 {
    let half_size = params.world_size * 0.5;
    let box_delta = abs(world_position - half_size) - half_size;
    let outside_distance = length(max(box_delta, vec2f(0.0)));
    let inside_distance = min(max(box_delta.x, box_delta.y), 0.0);
    return -(outside_distance + inside_distance);
}

fn sample_world_sdf(world_position: vec2f) -> f32 {
    let boundary = world_boundary_sdf(world_position);
    return select(
        boundary,
        min(sample_terrain_sdf(world_position), boundary),
        params.sdf_enabled != 0u
    );
}

fn segment_has_route_clearance(start: vec2f, end: vec2f, radius: f32) -> bool {
    let delta = end - start;
    let distance = length(delta);
    let sample_spacing = max(
        min(params.grid_cell_size.x, params.grid_cell_size.y) * 0.5,
        0.25
    );
    let required_step_count = max(u32(ceil(distance / sample_spacing)), 1u);
    if (required_step_count > MAX_PENTA_SDF_SEGMENT_SAMPLES) {
        return false;
    }
    let step_count = required_step_count;
    for (var step = 0u; step <= step_count; step += 1u) {
        let position = start + delta * (f32(step) / f32(step_count));
        if (sample_world_sdf(position) < radius) {
            return false;
        }
    }
    return true;
}

fn route_flow_direction(position: vec2f, flow_field_index: u32) -> vec2f {
    let raw_cell = vec2i(floor(
        (position - params.flow_origin) / params.flow_cell_size
    ));
    let cell = clamp(raw_cell, vec2i(0), vec2i(params.flow_size) - vec2i(1));
    return textureLoad(world_flow, cell, i32(flow_field_index), 0).xy;
}

fn route_integration_cost(position: vec2f, flow_field_index: u32) -> f32 {
    let raw_cell = vec2i(floor(
        (position - params.flow_origin) / params.flow_cell_size
    ));
    let cell = clamp(raw_cell, vec2i(0), vec2i(params.flow_size) - vec2i(1));
    return textureLoad(world_flow_integration, cell, i32(flow_field_index), 0).x;
}

@compute @workgroup_size(256)
fn advance_penta_cluster_navigation(@builtin(global_invocation_id) global_id: vec3u) {
    let body_id = global_id.x;
    if (body_id >= counts.body_count || !body_is_alive(body_id)) {
        return;
    }
    let emitter = effect_emitters.values[body_id];
    if (emitter.entity_id != simulations.values[body_id].entity_id
        || emitter.incarnation != simulations.values[body_id].incarnation
        || emitter.emitter_definition_code != PENTA_EMITTER_CODE
        || (emitter.flags & EFFECT_EMITTER_FLAG_ENABLED) == 0u) {
        return;
    }
    if ((emitter.navigation_config & EFFECT_NAV_RESERVED_MASK) != 0u) {
        return;
    }
    // Tick-start grid가 partial이면 밀도/anchor 선택 자체가 권위적이지 않습니다.
    // last_retarget_tick/velocity를 건드리기 전에 pure-flow로 fail-close하고,
    // sticky grid totals + emitter state에 recovery evidence를 남깁니다.
    if ((emitter.flags & EFFECT_EMITTER_FLAG_GRID_OVERFLOW_OBSERVED) != 0u) {
        return;
    }
    if (atomicLoad(&grid_overflow.small_count) != 0u
        || atomicLoad(&grid_overflow.big_count) != 0u) {
        effect_emitters.values[body_id].flags = emitter.flags
            | EFFECT_EMITTER_FLAG_GRID_OVERFLOW_OBSERVED;
        return;
    }
    let retarget_interval = emitter_retarget_interval(emitter);
    if (retarget_interval == 0u) {
        return;
    }
    let last_retarget_tick = emitter.last_retarget_tick;
    if (last_retarget_tick != INVALID_IDENTITY_COMPONENT
        && params.fixed_tick >= last_retarget_tick
        && params.fixed_tick - last_retarget_tick < retarget_interval) {
        return;
    }
    effect_emitters.values[body_id].last_retarget_tick = params.fixed_tick;
    let position = physics.values[body_id].position;
    let flow_field_index = temporaries.values[body_id].previous_flow_field_index;
    if (params.flow_enabled == 0u
        || flow_field_index >= params.flow_field_count) {
        return;
    }
    let route_first_field = emitter_route_first_field(emitter);
    let route_field_count = emitter_route_field_count(emitter);
    let route_end_exclusive = route_first_field + route_field_count;
    if (route_end_exclusive > params.flow_field_count
        || flow_field_index < route_first_field
        || flow_field_index >= route_end_exclusive) {
        return;
    }
    let candidate_field_end = min(
        route_end_exclusive - 1u,
        flow_field_index + MAX_PENTA_ROUTE_LOOKAHEAD_FIELDS - 1u
    );
    let prepared_velocity = (temporaries.values[body_id].predicted_position - position)
        * params.inverse_dt;
    let prepared_speed = length(prepared_velocity);
    var forward = vec2f(0.0);
    if (prepared_speed > EPSILON) {
        forward = prepared_velocity / prepared_speed;
    } else {
        let current_speed = length(physics.values[body_id].velocity);
        if (current_speed <= EPSILON) {
            return;
        }
        forward = physics.values[body_id].velocity / current_speed;
    }
    let source_cell = grid_cell_for_position(position);
    let seek_cells = vec2i(ceil(
        vec2f(PENTA_SEEK_RADIUS_TILES) / params.grid_cell_size
    ));
    let min_cell = clamp(
        source_cell - seek_cells,
        vec2i(0),
        vec2i(params.grid_cell_count) - vec2i(1)
    );
    let max_cell = clamp(
        source_cell + seek_cells,
        vec2i(0),
        vec2i(params.grid_cell_count) - vec2i(1)
    );
    var best_count = 0u;
    var best_distance_squared = 0.0;
    var best_cell_index = INVALID_IDENTITY_COMPONENT;
    var best_field_index = INVALID_IDENTITY_COMPONENT;
    var best_position = position;
    let source_integration_cost = route_integration_cost(position, flow_field_index);
    if (!(source_integration_cost >= 0.0)
        || source_integration_cost >= FLOW_INTEGRATION_UNREACHABLE_COST) {
        return;
    }
    for (var y = min_cell.y; y <= max_cell.y; y += 1) {
        for (var x = min_cell.x; x <= max_cell.x; x += 1) {
            let center = (vec2f(f32(x) + 0.5, f32(y) + 0.5)
                * params.grid_cell_size);
            let delta = center - position;
            let distance_squared = dot(delta, delta);
            if (distance_squared > PENTA_SEEK_RADIUS_TILES * PENTA_SEEK_RADIUS_TILES
                || (distance_squared > EPSILON && dot(delta, forward) < 0.0)) {
                continue;
            }
            if (!segment_has_route_clearance(
                    position,
                    center,
                    physics.values[body_id].radius
                )) {
                continue;
            }
            let cell_index = u32(y) * params.grid_cell_count.x + u32(x);
            for (var candidate_field = flow_field_index;
                candidate_field <= candidate_field_end;
                candidate_field += 1u) {
                let candidate_integration_cost = route_integration_cost(
                    center,
                    candidate_field
                );
                if (!(candidate_integration_cost >= 0.0)
                    || candidate_integration_cost >= FLOW_INTEGRATION_UNREACHABLE_COST
                    || (candidate_field == flow_field_index
                        && candidate_integration_cost
                            > source_integration_cost + EPSILON)) {
                    continue;
                }
                if (dot(
                    route_flow_direction(center, candidate_field),
                    forward
                ) < 0.0) {
                    continue;
                }
                let count = cluster_member_count(
                    vec2i(x, y),
                    candidate_field
                );
                if (count > best_count
                    || (count == best_count
                        && (best_cell_index == INVALID_IDENTITY_COMPONENT
                            || distance_squared < best_distance_squared
                            || (distance_squared == best_distance_squared
                                && (candidate_field < best_field_index
                                    || (candidate_field == best_field_index
                                        && cell_index < best_cell_index)))))) {
                    best_count = count;
                    best_distance_squared = distance_squared;
                    best_cell_index = cell_index;
                    best_field_index = candidate_field;
                    best_position = center;
                }
            }
        }
    }
    if (best_count < PENTA_CLUSTER_MINIMUM_MEMBERS
        || best_cell_index == INVALID_IDENTITY_COMPONENT
        || best_field_index == INVALID_IDENTITY_COMPONENT) {
        return;
    }
    var velocity = prepared_velocity;
    if (best_distance_squared <= PENTA_HOLD_RADIUS_TILES * PENTA_HOLD_RADIUS_TILES) {
        velocity = vec2f(0.0);
    } else {
        let direction = normalize(best_position - position);
        if (dot(direction, forward) < 0.0) {
            return;
        }
        let maximum_speed = max(simulations.values[body_id].flow_speed, 0.0);
        velocity = direction * min(max(prepared_speed, maximum_speed), maximum_speed);
    }
    physics.values[body_id].velocity = velocity;
    temporaries.values[body_id].predicted_position = position + velocity * params.dt;
}
`;

export const GPU_EFFECT_RUNTIME_ENTRY_POINT = Object.freeze({
    RESET_TICK: 'reset_effect_tick',
    RETAIN_INSTANCES: 'retain_effect_instances',
    SCAN_PULSES: 'scan_effect_pulse_candidates',
    MATERIALIZE_BATCH: 'materialize_effect_batch',
    FINISH_TICK: 'finish_effect_tick',
    CLEAR_SUMMARIES: 'clear_effect_summaries',
    ACCUMULATE_SUMMARIES: 'accumulate_effect_summaries',
    FINALIZE_SUMMARIES: 'finalize_effect_summaries',
    APPLY_REGENERATION: 'apply_effect_regeneration',
    MATERIALIZE_CONTACT_DAMAGE: 'materialize_effect_contact_damage',
    ADVANCE_PENTA_NAVIGATION: 'advance_penta_cluster_navigation'
});
