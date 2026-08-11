import {
    GPU_CIRCLE_APPLIED_EVENT_FLAG,
    GPU_CIRCLE_APPLIED_EVENT_TYPE,
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    GPU_CIRCLE_BODY_LAYER,
    GPU_CIRCLE_BODY_GAMEPLAY_META,
    GPU_CIRCLE_BODY_RENDER_SHAPE,
    GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM,
    GPU_CIRCLE_ENEMY_BEHAVIOR_STATE
} from './gpu_circle_body_abi.js';
import {
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID,
    GAMEPLAY_TEAM_ID
} from '../../contract/gameplay_team_contract.js';
import {
    ENEMY_ORBIT_PHASE_Q32_SCALE,
    ENEMY_ORBIT_SLOT_CAPACITY
} from '../../contract/enemy_orbit_directional_defense_contract.js';
import {
    FORMATION_COORDINATE_SYSTEM_CODE
} from '../../contract/enemy_formation_contract.js';
import { THE_TOWER_DATA } from '../../../../data/object/tower/the_tower_data.js';
import {
    GPU_BODY_CONTROL_PROGRAM_ABI_VERSION,
    GPU_BODY_CONTROL_PROGRAM_MODE,
    GPU_BODY_CONTROL_PROGRAM_RESULT,
    GPU_BODY_CONTROL_SELECTED_TARGET_KIND,
    GPU_BODY_CONTROL_SELECTION_POLICY,
    GPU_BODY_CONTROL_STATE_FLAGS,
    GPU_FIXED_PRIMITIVE_IDENTITY,
    GPU_FIXED_PROGRAM_STATUS,
    GPU_SPAWN_PROGRAM_ABI_VERSION,
    GPU_SPAWN_PROGRAM_MODE,
    GPU_SPAWN_PROGRAM_REQUEST_FLAGS,
    GPU_SPAWN_PROGRAM_RESULT
} from './gpu_fixed_primitive_abi.js';
import {
    GPU_EFFECT_DAMAGE_CHANNEL_FLAG,
    GPU_EFFECT_SUMMARY_FLAG
} from './gpu_effect_runtime_abi.js';
import {
    GPU_FORMATION_BODY_STATE_FLAG
} from './gpu_formation_runtime_abi.js';
import {
    ENEMY_NORMALIZED_RENDER_GEOMETRY
} from '../../../../data/object/enemy/enemy_shape_geometry_data.js';
import {
    MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE
} from '../../../../data/object/enemy/basic_circle_enemy_data.js';

const WGSL_POLYGON_POINT_CAPACITY = 8;

/** Contact normal을 handler 전용 flat-reduction payload로 재사용하는 transient marker입니다. */
export const GPU_DIRECTIONAL_DEFENSE_CONTACT_MARKER = Object.freeze({
    MAGIC: 0x7fc00040,
    MAGIC_MASK: 0xfffffff0
});

const toWgslFloat = (value) => {
    if (!Number.isFinite(value)) {
        throw new TypeError('WGSL enemy shape 좌표는 유한한 숫자여야 합니다.');
    }
    const normalized = Object.is(value, -0) ? 0 : value;
    const literal = String(normalized);
    return /[.eE]/.test(literal) ? literal : `${literal}.0`;
};

const toWgslVec2 = ({ x, y }) => (
    `vec2f(${toWgslFloat(x)}, ${toWgslFloat(y)})`
);

const toWgslPointArray = (
    points,
    capacity = WGSL_POLYGON_POINT_CAPACITY
) => {
    if (points.length > capacity) {
        throw new RangeError(`WGSL enemy shape point capacity를 초과했습니다: ${points.length}`);
    }
    const padded = Array.from(points);
    while (padded.length < capacity) {
        padded.push({ x: 0, y: 0 });
    }
    return `array<vec2f, ${capacity}>(\n        ${padded.map(toWgslVec2).join(',\n        ')}\n    )`;
};

const ENEMY_RENDER_GEOMETRY = ENEMY_NORMALIZED_RENDER_GEOMETRY;

export const GPU_COLLISION_COMPUTE_WGSL = /* wgsl */`
const BODY_ABI_VERSION: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;
const BODY_CONTROL_PROGRAM_ABI_VERSION: u32 = ${GPU_BODY_CONTROL_PROGRAM_ABI_VERSION}u;
const SPAWN_PROGRAM_ABI_VERSION: u32 = ${GPU_SPAWN_PROGRAM_ABI_VERSION}u;
const FIXED_PROGRAM_STATUS_ABI_MISMATCH: u32 = ${GPU_FIXED_PROGRAM_STATUS.ABI_MISMATCH}u;
const FIXED_PROGRAM_STATUS_CAPACITY_EXCEEDED: u32 = ${GPU_FIXED_PROGRAM_STATUS.CAPACITY_EXCEEDED}u;
const FIXED_PROGRAM_STATUS_RECORD_INVALID: u32 = ${GPU_FIXED_PROGRAM_STATUS.RECORD_INVALID}u;
const BODY_CONTROL_PROGRAM_MODE_MOVE_INTENT: u32 = ${GPU_BODY_CONTROL_PROGRAM_MODE.MOVE_INTENT}u;
const BODY_CONTROL_PROGRAM_MODE_PRIORITY_TARGET_IN_RANGE: u32 = ${GPU_BODY_CONTROL_PROGRAM_MODE.PRIORITY_TARGET_IN_RANGE}u;
const BODY_CONTROL_SELECTION_POLICY_NONE: u32 = ${GPU_BODY_CONTROL_SELECTION_POLICY.NONE}u;
const BODY_CONTROL_SELECTION_POLICY_CORE_FIRST_IN_RANGE_THEN_TOWER: u32 = ${GPU_BODY_CONTROL_SELECTION_POLICY.CORE_FIRST_IN_RANGE_THEN_TOWER}u;
const BODY_CONTROL_RESULT_PENDING: u32 = ${GPU_BODY_CONTROL_PROGRAM_RESULT.PENDING}u;
const BODY_CONTROL_RESULT_NO_TARGET: u32 = ${GPU_BODY_CONTROL_PROGRAM_RESULT.NO_TARGET}u;
const BODY_CONTROL_RESULT_CORE_SELECTED: u32 = ${GPU_BODY_CONTROL_PROGRAM_RESULT.CORE_SELECTED}u;
const BODY_CONTROL_RESULT_TOWER_SELECTED: u32 = ${GPU_BODY_CONTROL_PROGRAM_RESULT.TOWER_SELECTED}u;
const BODY_CONTROL_RESULT_SOURCE_INVALID: u32 = ${GPU_BODY_CONTROL_PROGRAM_RESULT.SOURCE_INVALID}u;
const BODY_CONTROL_RESULT_CORE_INVALID: u32 = ${GPU_BODY_CONTROL_PROGRAM_RESULT.CORE_INVALID}u;
const BODY_CONTROL_SELECTED_TARGET_NONE: u32 = ${GPU_BODY_CONTROL_SELECTED_TARGET_KIND.NONE}u;
const BODY_CONTROL_SELECTED_TARGET_CORE: u32 = ${GPU_BODY_CONTROL_SELECTED_TARGET_KIND.CORE}u;
const BODY_CONTROL_SELECTED_TARGET_TOWER: u32 = ${GPU_BODY_CONTROL_SELECTED_TARGET_KIND.TOWER}u;
const BODY_CONTROL_STATE_FLAG_STOP: u32 = ${GPU_BODY_CONTROL_STATE_FLAGS.STOP}u;
const BODY_CONTROL_STATE_FLAG_ROUTE_FLOW: u32 = ${GPU_BODY_CONTROL_STATE_FLAGS.ROUTE_FLOW}u;
const BODY_CONTROL_STATE_FLAG_CORE_SELECTED: u32 = ${GPU_BODY_CONTROL_STATE_FLAGS.CORE_SELECTED}u;
const BODY_CONTROL_STATE_FLAG_TOWER_SELECTED: u32 = ${GPU_BODY_CONTROL_STATE_FLAGS.TOWER_SELECTED}u;
const SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_VELOCITY: u32 = ${GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY}u;
const SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_AIM_POINT: u32 = ${GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT}u;
const SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY: u32 = ${GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY}u;
const SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET: u32 = ${GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET}u;
const SPAWN_PROGRAM_REQUEST_REQUIRE_EXACT_SELECTED_TARGET: u32 = ${GPU_SPAWN_PROGRAM_REQUEST_FLAGS.REQUIRE_EXACT_SELECTED_TARGET}u;
const SPAWN_PROGRAM_REQUEST_TOWER_DAMAGE_CHANNEL: u32 = ${GPU_SPAWN_PROGRAM_REQUEST_FLAGS.TOWER_DAMAGE_CHANNEL}u;
const SPAWN_PROGRAM_RESULT_PENDING: u32 = ${GPU_SPAWN_PROGRAM_RESULT.PENDING}u;
const SPAWN_PROGRAM_RESULT_RESOLVED: u32 = ${GPU_SPAWN_PROGRAM_RESULT.RESOLVED}u;
const SPAWN_PROGRAM_RESULT_SOURCE_INVALID: u32 = ${GPU_SPAWN_PROGRAM_RESULT.SOURCE_INVALID}u;
const SPAWN_PROGRAM_RESULT_DESTINATION_INVALID: u32 = ${GPU_SPAWN_PROGRAM_RESULT.DESTINATION_INVALID}u;
const SPAWN_PROGRAM_RESULT_TARGET_INVALID: u32 = ${GPU_SPAWN_PROGRAM_RESULT.TARGET_INVALID}u;
const SPAWN_PROGRAM_RESULT_NO_TARGET: u32 = ${GPU_SPAWN_PROGRAM_RESULT.NO_TARGET}u;
const SPAWN_PROGRAM_RESULT_CONTROL_STATE_MISMATCH: u32 = ${GPU_SPAWN_PROGRAM_RESULT.CONTROL_STATE_MISMATCH}u;
const SPAWN_PROGRAM_RESULT_CORE_TARGET_INVALID: u32 = ${GPU_SPAWN_PROGRAM_RESULT.CORE_TARGET_INVALID}u;
const INVALID_IDENTITY_COMPONENT: u32 = ${GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT}u;
const CONTROL_ACCELERATION: f32 = ${toWgslFloat(
    THE_TOWER_DATA.CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED
)};
const CONTROL_LINEAR_FRICTION: f32 = ${toWgslFloat(
    THE_TOWER_DATA.LINEAR_FRICTION_PER_SECOND
)};
const CONTROL_SLEEP_SPEED: f32 = ${toWgslFloat(
    THE_TOWER_DATA.SLEEP_SPEED_TILES_PER_SECOND
)};
const CONTROL_MAX_LINEAR_SPEED: f32 = ${toWgslFloat(
    THE_TOWER_DATA.MAX_LINEAR_SPEED_TILES_PER_SECOND
)};
const CONTACT_ABI_STATUS_OK: u32 = 1u;
const CONTACT_ABI_STATUS_MISMATCH: u32 = 2u;
const BODY_FLAG_ALIVE: u32 = 1u;
const BODY_FLAG_USE_FLOW: u32 = 2u;
// GPU fixed journal에서만 쓰는 한-tick marker입니다. Body ABI stride는 바꾸지 않습니다.
const BODY_FLAG_CONTROLLED_THIS_TICK: u32 = 65536u;
const BODY_FLAG_INTERACTION_ENTER_ONLY: u32 = 256u;
const BODY_FLAG_INTERACTION_CONTINUOUS: u32 = 512u;
const BODY_LAYER_ENEMY: u32 = 1u;
const BODY_LAYER_PROJECTILE: u32 = ${GPU_CIRCLE_BODY_LAYER.PROJECTILE}u;
const BODY_LAYER_TERRAIN: u32 = ${GPU_CIRCLE_BODY_LAYER.TERRAIN}u;
const BODY_LAYER_CORE_PROXY: u32 = ${GPU_CIRCLE_BODY_LAYER.CORE_PROXY}u;
const BODY_LAYER_PLAYER_DAMAGEABLE: u32 = ${GPU_CIRCLE_BODY_LAYER.PLAYER_DAMAGEABLE}u;
const GAMEPLAY_TEAM_NEUTRAL: u32 = ${GAMEPLAY_TEAM_ID.NEUTRAL}u;
const GAMEPLAY_TEAM_PLAYER: u32 = ${GAMEPLAY_TEAM_ID.PLAYER}u;
const GAMEPLAY_TEAM_HOSTILE: u32 = ${GAMEPLAY_TEAM_ID.HOSTILE}u;
const GAMEPLAY_DAMAGE_POLICY_DEFAULT_TEAM_MATRIX: u32 = ${GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX}u;
const GAMEPLAY_DAMAGE_RESOLUTION_POLICY_DIRECT: u32 = ${GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID.DIRECT}u;
const GAMEPLAY_DAMAGE_RESOLUTION_POLICY_MAXIMUM_DAMAGE_WINDOW: u32 = ${GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID.MAXIMUM_DAMAGE_WINDOW}u;
const GAMEPLAY_META_TEAM_SHIFT: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_SHIFT}u;
const GAMEPLAY_META_TEAM_MASK: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_MASK}u;
const GAMEPLAY_META_DAMAGE_POLICY_SHIFT: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.DAMAGE_POLICY_SHIFT}u;
const GAMEPLAY_META_DAMAGE_POLICY_MASK: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.DAMAGE_POLICY_MASK}u;
const GAMEPLAY_META_DAMAGE_RESOLUTION_POLICY_SHIFT: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.DAMAGE_RESOLUTION_POLICY_SHIFT}u;
const GAMEPLAY_META_DAMAGE_RESOLUTION_POLICY_MASK: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.DAMAGE_RESOLUTION_POLICY_MASK}u;
const GAMEPLAY_META_RESERVED_MASK: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.RESERVED_MASK}u;
const ENEMY_PAIR_COLLISION_RADIUS_SCALE: f32 = ${toWgslFloat(
    MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE
)};
const CONTACT_HANDLER_FLAG_KILL_IF_OTHER_TERRAIN: u32 = 1u;
const CONTACT_HANDLER_FLAG_CLOSEST_ONLY: u32 = 2u;
const CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY: u32 = 8u;
const CONTACT_HANDLER_FLAG_INTERACTION_CONTINUOUS: u32 = 16u;
const CONTACT_HANDLER_FLAG_CORE_DAMAGE_REQUEST: u32 = ${GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CORE_DAMAGE_REQUEST}u;
const MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_OK: u32 = 0u;
const MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_FAILURE: u32 = 1u;
// contact.normal은 handle_contacts 이후 physical solver가 다시 읽지 않습니다. 이 marker는
// finite normalized normal과 구조적으로 겹치지 않는 quiet-NaN namespace를 사용합니다.
const MAXIMUM_DAMAGE_WINDOW_MARKER_MAGIC: u32 = 0x7fc00000u;
const MAXIMUM_DAMAGE_WINDOW_MARKER_MAGIC_MASK: u32 = 0xfffffff0u;
const MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_MASK: u32 = 0x0000000fu;
const MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_ENTER: u32 = 1u;
const MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_CONTINUOUS: u32 = 2u;
const CORE_DAMAGE_REQUEST_MARKER_MAGIC: u32 = 0x7fc00020u;
const CORE_DAMAGE_REQUEST_MARKER_MAGIC_MASK: u32 = 0xfffffff0u;
const SELECTED_TARGET_TOWER_MARKER_MAGIC: u32 = 0x7fc00030u;
const SELECTED_TARGET_TOWER_MARKER_MAGIC_MASK: u32 = 0xfffffff0u;
const DIRECTIONAL_DEFENSE_MARKER_MAGIC: u32 = ${GPU_DIRECTIONAL_DEFENSE_CONTACT_MARKER.MAGIC}u;
const DIRECTIONAL_DEFENSE_MARKER_MAGIC_MASK: u32 = ${GPU_DIRECTIONAL_DEFENSE_CONTACT_MARKER.MAGIC_MASK}u;
const CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_OK: u32 = 0u;
const CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_FAILURE: u32 = 1u;
const APPLIED_EVENT_TYPE_DAMAGE_APPLIED: u32 = ${GPU_CIRCLE_APPLIED_EVENT_TYPE.DAMAGE_APPLIED}u;
const APPLIED_EVENT_TYPE_INTERACTION_ENTER: u32 = ${GPU_CIRCLE_APPLIED_EVENT_TYPE.INTERACTION_ENTER}u;
const APPLIED_EVENT_TYPE_INTERACTION_CONTINUOUS: u32 = ${GPU_CIRCLE_APPLIED_EVENT_TYPE.INTERACTION_CONTINUOUS}u;
const APPLIED_EVENT_TYPE_ENEMY_CHARGE_WINDUP_STARTED: u32 = ${GPU_CIRCLE_APPLIED_EVENT_TYPE.ENEMY_CHARGE_WINDUP_STARTED}u;
const APPLIED_EVENT_TYPE_ENEMY_CHARGE_CONTACT_RECOIL_STARTED: u32 = ${GPU_CIRCLE_APPLIED_EVENT_TYPE.ENEMY_CHARGE_CONTACT_RECOIL_STARTED}u;
const APPLIED_EVENT_TYPE_CORE_DAMAGE_REQUEST: u32 = ${GPU_CIRCLE_APPLIED_EVENT_TYPE.CORE_DAMAGE_REQUEST}u;
const APPLIED_EVENT_FLAG_TARGET_DIED: u32 = ${GPU_CIRCLE_APPLIED_EVENT_FLAG.TARGET_DIED}u;
const APPLIED_EVENT_FLAG_TERRAIN_KILL: u32 = ${GPU_CIRCLE_APPLIED_EVENT_FLAG.TERRAIN_KILL}u;
const APPLIED_EVENT_FLAG_ENTER_POLICY: u32 = ${GPU_CIRCLE_APPLIED_EVENT_FLAG.ENTER_POLICY}u;
const APPLIED_EVENT_FLAG_CONTINUOUS_POLICY: u32 = ${GPU_CIRCLE_APPLIED_EVENT_FLAG.CONTINUOUS_POLICY}u;
const APPLIED_EVENT_FLAG_TERRAIN_CONTACT: u32 = ${GPU_CIRCLE_APPLIED_EVENT_FLAG.TERRAIN_CONTACT}u;
const APPLIED_EVENT_FLAG_MAXIMUM_DAMAGE_WINDOW: u32 = ${GPU_CIRCLE_APPLIED_EVENT_FLAG.MAXIMUM_DAMAGE_WINDOW}u;
const APPLIED_EVENT_FLAG_DIRECTIONAL_DEFENSE: u32 = ${GPU_CIRCLE_APPLIED_EVENT_FLAG.DIRECTIONAL_DEFENSE}u;
const ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.ARROW_TOWER_CHARGE}u;
const ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.SELECTED_TARGET_PROJECTILE}u;
const ENEMY_BEHAVIOR_PROGRAM_OCTAGON_TOWER_ORBIT: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT}u;
const ENEMY_BEHAVIOR_STATE_SEEK_TOWER: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.SEEK_TOWER}u;
const ENEMY_BEHAVIOR_STATE_WINDUP: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.WINDUP}u;
const ENEMY_BEHAVIOR_STATE_CHARGE: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.CHARGE}u;
const ENEMY_BEHAVIOR_STATE_CONTACT_RECOIL: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.CONTACT_RECOIL}u;
const ENEMY_BEHAVIOR_STATE_RECOVER: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.RECOVER}u;
const ENEMY_BEHAVIOR_STATE_CORE_FALLBACK: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.CORE_FALLBACK}u;
const ENEMY_BEHAVIOR_STATE_ORBIT_TOWER: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.ORBIT_TOWER}u;
const ENEMY_BEHAVIOR_FLAG_TARGET_VALID: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.TARGET_VALID}u;
const ENEMY_BEHAVIOR_FLAG_TELEGRAPH_PENDING: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.TELEGRAPH_PENDING}u;
const ENEMY_BEHAVIOR_FLAG_RECOIL_PENDING: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.RECOIL_PENDING}u;
const ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_VALID: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.SELECTED_TARGET_VALID}u;
const ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_CORE: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.SELECTED_TARGET_CORE}u;
const ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_TOWER: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.SELECTED_TARGET_TOWER}u;
const ENEMY_BEHAVIOR_FLAG_DIRECTIONAL_DEFENSE_ACTIVE: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.DIRECTIONAL_DEFENSE_ACTIVE}u;
const ENEMY_ORBIT_COORDINATE_SYSTEM_RING_SLOTS: u32 = ${FORMATION_COORDINATE_SYSTEM_CODE.RING_SLOTS}u;
const ENEMY_ORBIT_SLOT_CAPACITY: u32 = ${ENEMY_ORBIT_SLOT_CAPACITY}u;
const ENEMY_ORBIT_PHASE_RADIANS_PER_Q32: f32 = ${toWgslFloat(
    (Math.PI * 2) / ENEMY_ORBIT_PHASE_Q32_SCALE
)};
// RING_SLOTS global clock의 phase 0에서 slot 0을 서쪽 기준 반경에 둡니다.
// 이후 모든 slot은 같은 fixed-tick Q32 phase로 함께 회전합니다.
const ENEMY_ORBIT_SLOT_ZERO_PHASE_Q32: u32 = 0x80000000u;
const EFFECT_DAMAGE_CHANNEL_PROJECTILE_TOWER: u32 = ${GPU_EFFECT_DAMAGE_CHANNEL_FLAG.PROJECTILE_TOWER}u;
const EFFECT_SUMMARY_FLAG_PROJECTILE_ATTACK_SNAPSHOT: u32 = ${GPU_EFFECT_SUMMARY_FLAG.PROJECTILE_ATTACK_SNAPSHOT}u;
const DEATH_EVENT_FLAG_HEALTH: u32 = 1u;
const DEATH_EVENT_FLAG_LIFETIME: u32 = 2u;
const EPSILON_MASS: f32 = 0.000001;
const EPSILON_DISTANCE_SQUARED: f32 = 0.000000000001;
const SOLVER_WORKGROUP_SIZE: u32 = 64u;

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

struct GridBody {
    predicted_position: vec2f,
    physical_meta: u32,
    flags: u32,
    inverse_mass: f32,
    radius: f32,
    body_id: u32,
    interaction_meta: u32,
}

struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }

struct TemporaryBuffer { values: array<BodyTemporary> }
struct AtomicGridCounts { values: array<atomic<u32>> }
struct GridBodyBuffer { values: array<GridBody> }
struct SdfBuffer { values: array<f32> }

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

struct ContactHandlerBuffer { values: array<ContactHandler> }

struct CombatState {
    target_interaction_layer_mask: u32,
    maximum_damage_window_duration_fixed_ticks: u32,
    peak_final_damage_fixed_point: atomic<i32>,
    expires_at_fixed_tick: atomic<u32>,
    peak_source_entity_id: atomic<u32>,
    peak_source_incarnation: atomic<u32>,
    reserved_0: u32,
    reserved_1: u32,
    reserved_2: u32,
    reserved_3: u32,
}

struct CombatStateBuffer { values: array<CombatState> }

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
}

struct EnemyBehaviorStateBuffer { values: array<EnemyBehaviorState> }

// ENEMY_BEHAVIOR_STATE와 독립적인 per-body Effect capability plane입니다.
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

struct EffectSummaryBuffer { values: array<EffectSummary> }
struct FormationStateBuffer { values: array<FormationState> }

struct ContactState {
    contact_count: atomic<u32>,
    contact_overflow: atomic<u32>,
    event_count: atomic<u32>,
    event_overflow: atomic<u32>,
    death_count: atomic<u32>,
    death_overflow: atomic<u32>,
    abi_status: atomic<u32>,
    event_encoding_version: atomic<u32>,
    maximum_damage_window_event_count: atomic<u32>,
    maximum_damage_window_protocol_status: atomic<u32>,
    core_damage_request_event_count: atomic<u32>,
    core_damage_request_protocol_status: atomic<u32>,
}

struct Contact {
    self_body_id: u32,
    self_incarnation: u32,
    other_body_id: i32,
    other_incarnation: u32,
    world_position: vec2f,
    normal: vec2f,
}

struct ContactBuffer { values: array<Contact> }

struct AppliedEvent {
    subject_entity_id: u32,
    subject_incarnation: u32,
    other_entity_id: u32,
    other_incarnation: u32,
    value_fixed_point: i32,
    event_meta: u32,
    world_position: vec2f,
}

struct AppliedEventBuffer { values: array<AppliedEvent> }

struct DeathEvent {
    entity_id: u32,
    incarnation: u32,
    body_id: u32,
    reason_flags: u32,
}

struct DeathEventBuffer { values: array<DeathEvent> }

struct FixedProgramHeader {
    abi_version: u32,
    count: u32,
    capacity: u32,
    status: atomic<u32>,
}

struct BodyControlRecord {
    destination_slot: u32,
    entity_id: u32,
    incarnation: u32,
    mode_flags: u32,
    move_intent: vec2f,
    source_tick: u32,
    selection_sequence: u32,
    core_target_slot: u32,
    core_target_entity_id: u32,
    core_target_incarnation: u32,
    tower_target_slot: u32,
    tower_target_entity_id: u32,
    tower_target_incarnation: u32,
    attack_range: f32,
    result: u32,
    selected_target_kind: u32,
    selected_target_slot: u32,
    selected_target_entity_id: u32,
    selected_target_incarnation: u32,
    state_flags: u32,
    attack_fingerprint: u32,
    selection_policy: u32,
    reserved_0: u32,
}

struct BodyControlProgram {
    header: FixedProgramHeader,
    records: array<BodyControlRecord>,
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

struct BodyControlStateBuffer { values: array<BodyControlState> }

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

struct TrackedPoseConfig {
    source_slot: u32,
    entity_id: u32,
    incarnation: u32,
    enabled: u32,
}

struct TowerGameplayTargetConfig {
    target_slot: u32,
    entity_id: u32,
    incarnation: u32,
    enabled: u32,
}

struct TrackedPoseRecord {
    position: vec2f,
    velocity: vec2f,
    previous_position: vec2f,
    entity_id: u32,
    incarnation: u32,
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

@group(0) @binding(0) var<storage, read_write> counts: BodyCounts;
@group(0) @binding(1) var<storage, read_write> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(3) var<storage, read_write> temporaries: TemporaryBuffer;
@group(0) @binding(4) var<storage, read> contact_handlers: ContactHandlerBuffer;
@group(0) @binding(5) var<storage, read_write> body_control_states: BodyControlStateBuffer;
@group(0) @binding(6) var<storage, read_write> body_control_program: BodyControlProgram;
@group(0) @binding(7) var<storage, read_write> spawn_program: SpawnProgram;
@group(0) @binding(8) var<storage, read> tracked_pose_config: TrackedPoseConfig;
@group(0) @binding(9) var<storage, read_write> tracked_pose_output: TrackedPoseRecord;
@group(0) @binding(10) var<storage, read_write> combat_states: CombatStateBuffer;
@group(0) @binding(11) var<storage, read_write> enemy_behavior_states: EnemyBehaviorStateBuffer;
@group(0) @binding(12) var<storage, read_write> effect_summaries: EffectSummaryBuffer;
@group(0) @binding(13) var<storage, read> tower_gameplay_target: TowerGameplayTargetConfig;
@group(1) @binding(0) var<storage, read_write> grid_counts: AtomicGridCounts;
@group(1) @binding(1) var<storage, read_write> grid_bodies: GridBodyBuffer;
@group(1) @binding(2) var<storage, read> sdf_values: SdfBuffer;
@group(1) @binding(3) var<storage, read_write> grid_overflow: GridOverflow;
@group(1) @binding(4) var world_flow: texture_2d_array<f32>;
@group(2) @binding(0) var<uniform> params: SimulationParams;
@group(3) @binding(0) var<storage, read_write> contact_state: ContactState;
@group(3) @binding(1) var<storage, read_write> contacts: ContactBuffer;
@group(3) @binding(2) var<storage, read_write> applied_events: AppliedEventBuffer;
@group(3) @binding(3) var<storage, read_write> death_events: DeathEventBuffer;

const NEIGHBOR_OFFSETS = array<vec2i, 9>(
    vec2i(-1, -1), vec2i(0, -1), vec2i(1, -1),
    vec2i(-1, 0), vec2i(0, 0), vec2i(1, 0),
    vec2i(-1, 1), vec2i(0, 1), vec2i(1, 1)
);

var<workgroup> neighbor_cell_counts: array<u32, 9>;
var<workgroup> neighbor_cell_indices: array<u32, 9>;
var<workgroup> current_cell_count: u32;
var<workgroup> current_big_count: u32;

fn abi_is_current() -> bool {
    return counts.abi_version == BODY_ABI_VERSION;
}

fn body_layer(physical_meta: u32) -> u32 {
    return physical_meta & 65535u;
}

fn body_collision_mask(physical_meta: u32) -> u32 {
    return (physical_meta >> 16u) & 65535u;
}

fn body_interaction_layer(interaction_meta: u32) -> u32 {
    return interaction_meta & 65535u;
}

fn body_interaction_mask(interaction_meta: u32) -> u32 {
    return (interaction_meta >> 16u) & 65535u;
}

fn gameplay_team_id(gameplay_meta: u32) -> u32 {
    return (gameplay_meta >> GAMEPLAY_META_TEAM_SHIFT)
        & GAMEPLAY_META_TEAM_MASK;
}

fn gameplay_damage_policy_id(gameplay_meta: u32) -> u32 {
    return (gameplay_meta >> GAMEPLAY_META_DAMAGE_POLICY_SHIFT)
        & GAMEPLAY_META_DAMAGE_POLICY_MASK;
}

fn gameplay_damage_resolution_policy_id(gameplay_meta: u32) -> u32 {
    return (gameplay_meta >> GAMEPLAY_META_DAMAGE_RESOLUTION_POLICY_SHIFT)
        & GAMEPLAY_META_DAMAGE_RESOLUTION_POLICY_MASK;
}

fn gameplay_meta_is_valid(gameplay_meta: u32) -> bool {
    let team_id = gameplay_team_id(gameplay_meta);
    return (gameplay_meta & GAMEPLAY_META_RESERVED_MASK) == 0u
        && team_id >= GAMEPLAY_TEAM_NEUTRAL
        && team_id <= GAMEPLAY_TEAM_HOSTILE
        && gameplay_damage_policy_id(gameplay_meta)
            == GAMEPLAY_DAMAGE_POLICY_DEFAULT_TEAM_MATRIX
        && (gameplay_damage_resolution_policy_id(gameplay_meta)
                == GAMEPLAY_DAMAGE_RESOLUTION_POLICY_DIRECT
            || gameplay_damage_resolution_policy_id(gameplay_meta)
                == GAMEPLAY_DAMAGE_RESOLUTION_POLICY_MAXIMUM_DAMAGE_WINDOW);
}

fn gameplay_damage_is_allowed(source_meta: u32, target_meta: u32) -> bool {
    if (!gameplay_meta_is_valid(source_meta)
        || !gameplay_meta_is_valid(target_meta)) {
        return false;
    }
    let source_team = gameplay_team_id(source_meta);
    let target_team = gameplay_team_id(target_meta);
    return (source_team == GAMEPLAY_TEAM_PLAYER
            && target_team == GAMEPLAY_TEAM_HOSTILE)
        || (source_team == GAMEPLAY_TEAM_HOSTILE
            && target_team == GAMEPLAY_TEAM_PLAYER);
}

fn body_is_alive(flags: u32) -> bool {
    return (flags & BODY_FLAG_ALIVE) == BODY_FLAG_ALIVE;
}

fn body_has_flag(flags: u32, flag: u32) -> bool {
    return (flags & flag) == flag;
}

fn load_simulation_flags(body_id: u32) -> u32 {
    return atomicLoad(&simulations.values[body_id].flags);
}

fn body_id_is_alive(body_id: u32) -> bool {
    return body_is_alive(load_simulation_flags(body_id));
}

fn snapshot_tower_attack_damage(source_slot: u32, destination_slot: u32) {
    let source_identity_matches = effect_summaries.values[source_slot].entity_id
            == simulations.values[source_slot].entity_id
        && effect_summaries.values[source_slot].incarnation
            == simulations.values[source_slot].incarnation;
    let destination_identity_matches =
        effect_summaries.values[destination_slot].entity_id
            == simulations.values[destination_slot].entity_id
        && effect_summaries.values[destination_slot].incarnation
            == simulations.values[destination_slot].incarnation;
    if (!source_identity_matches || !destination_identity_matches) {
        return;
    }
    let projectile_tower_damage_is_modifiable =
        (atomicLoad(&effect_summaries.values[source_slot].flags)
            & EFFECT_DAMAGE_CHANNEL_PROJECTILE_TOWER) != 0u;
    let source_attack_multiplier = select(
        1.0,
        max(effect_summaries.values[source_slot].attack_multiplier, 0.0),
        projectile_tower_damage_is_modifiable
    );
    effect_summaries.values[destination_slot].resolved_base_damage_other = max(
        effect_summaries.values[destination_slot].authored_damage_other
            * source_attack_multiplier,
        0.0
    );
    effect_summaries.values[destination_slot].source_snapshot_tick
        = params.fixed_tick;
    atomicOr(
        &effect_summaries.values[destination_slot].flags,
        EFFECT_SUMMARY_FLAG_PROJECTILE_ATTACK_SNAPSHOT
    );
}

fn flow_cell_for_position(position: vec2f) -> vec2i {
    let raw_cell = vec2i(floor((position - params.flow_origin) / params.flow_cell_size));
    return clamp(raw_cell, vec2i(0), vec2i(params.flow_size) - vec2i(1));
}

fn flow_direction(field_index: u32, cell: vec2i) -> vec2f {
    return textureLoad(world_flow, cell, i32(field_index), 0).xy;
}

fn segment_intersects_transition_circle(
    start: vec2f,
    end: vec2f,
    center: vec2f,
    radius: f32
) -> bool {
    let radius_squared = radius * radius;
    let from_center = start - center;
    if (dot(from_center, from_center) <= radius_squared) {
        return true;
    }
    let to_center = end - center;
    if (dot(to_center, to_center) <= radius_squared) {
        return true;
    }
    let segment = end - start;
    let segment_length_squared = dot(segment, segment);
    if (segment_length_squared <= EPSILON_DISTANCE_SQUARED) {
        return false;
    }
    let nearest_t = clamp(
        -dot(from_center, segment) / segment_length_squared,
        0.0,
        1.0
    );
    let nearest_delta = from_center + (segment * nearest_t);
    return dot(nearest_delta, nearest_delta) <= radius_squared;
}

fn grid_cell_total() -> u32 {
    return params.grid_cell_count.x * params.grid_cell_count.y;
}

fn grid_bucket_offset(cell_index: u32, bucket: u32) -> u32 {
    return ((cell_index * 2u) + bucket) * params.max_bodies_per_cell;
}

fn grid_has_overflow() -> bool {
    return atomicLoad(&grid_overflow.small_count) > 0u
        || atomicLoad(&grid_overflow.big_count) > 0u;
}

fn body_uses_small_grid(radius: f32) -> bool {
    return radius * 2.0
        <= min(params.grid_cell_size.x, params.grid_cell_size.y);
}

fn deterministic_separation_normal(self_body_id: u32, other_body_id: u32) -> vec2f {
    let self_entity_id = simulations.values[self_body_id].entity_id;
    let other_entity_id = simulations.values[other_body_id].entity_id;
    let self_is_first = self_entity_id < other_entity_id
        || (self_entity_id == other_entity_id && self_body_id < other_body_id);
    let low_id = min(self_entity_id, other_entity_id);
    let high_id = max(self_entity_id, other_entity_id);
    var mixed = low_id * 1664525u + high_id * 1013904223u;
    mixed ^= mixed >> 16u;
    let selector = mixed & 3u;
    var base = vec2f(1.0, 0.0);
    if (selector == 1u) {
        base = vec2f(0.0, 1.0);
    } else if (selector == 2u) {
        base = normalize(vec2f(1.0, 1.0));
    } else if (selector == 3u) {
        base = normalize(vec2f(1.0, -1.0));
    }
    return select(-base, base, self_is_first);
}

fn make_grid_body(body_id: u32, predicted_position: vec2f) -> GridBody {
    return GridBody(
        predicted_position,
        physics.values[body_id].physical_meta,
        load_simulation_flags(body_id),
        physics.values[body_id].inverse_mass,
        physics.values[body_id].radius,
        body_id,
        physics.values[body_id].interaction_meta
    );
}

fn invalidate_tracked_pose_output() {
    tracked_pose_output.position = vec2f(0.0);
    tracked_pose_output.velocity = vec2f(0.0);
    tracked_pose_output.previous_position = vec2f(0.0);
    tracked_pose_output.entity_id = INVALID_IDENTITY_COMPONENT;
    tracked_pose_output.incarnation = INVALID_IDENTITY_COMPONENT;
}

fn exact_living_body(slot: u32, entity_id: u32, incarnation: u32) -> bool {
    return slot < counts.body_count
        && slot < arrayLength(&simulations.values)
        && entity_id != INVALID_IDENTITY_COMPONENT
        && incarnation != INVALID_IDENTITY_COMPONENT
        && simulations.values[slot].entity_id == entity_id
        && simulations.values[slot].incarnation == incarnation
        && body_id_is_alive(slot);
}

fn exact_target_is_in_range(source_slot: u32, target_slot: u32, range: f32) -> bool {
    let delta = physics.values[target_slot].position
        - physics.values[source_slot].position;
    return dot(delta, delta) <= range * range;
}

fn store_body_control_state(
    body_id: u32,
    command: BodyControlRecord,
    result: u32,
    selected_target_kind: u32,
    selected_target_slot: u32,
    selected_target_entity_id: u32,
    selected_target_incarnation: u32,
    state_flags: u32
) {
    body_control_states.values[body_id] = BodyControlState(
        command.move_intent,
        command.entity_id,
        command.incarnation,
        command.source_tick,
        command.selection_sequence,
        command.attack_fingerprint,
        result,
        selected_target_kind,
        selected_target_slot,
        selected_target_entity_id,
        selected_target_incarnation,
        state_flags,
        command.selection_policy,
        command.attack_range,
        0u
    );
}

@compute @workgroup_size(256)
fn clear_body_control_states(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }
    body_control_states.values[body_id] = BodyControlState(
        vec2f(0.0),
        INVALID_IDENTITY_COMPONENT,
        INVALID_IDENTITY_COMPONENT,
        0u,
        0u,
        0u,
        BODY_CONTROL_RESULT_PENDING,
        BODY_CONTROL_SELECTED_TARGET_NONE,
        INVALID_IDENTITY_COMPONENT,
        INVALID_IDENTITY_COMPONENT,
        INVALID_IDENTITY_COMPONENT,
        0u,
        BODY_CONTROL_SELECTION_POLICY_NONE,
        0.0,
        0u
    );
    atomicAnd(
        &simulations.values[body_id].flags,
        ~BODY_FLAG_CONTROLLED_THIS_TICK
    );
}

@compute @workgroup_size(256)
fn validate_body_control_commands(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        if (global_id.x == 0u) {
            atomicOr(
                &body_control_program.header.status,
                FIXED_PROGRAM_STATUS_ABI_MISMATCH
            );
        }
        return;
    }
    let runtime_capacity = arrayLength(&body_control_program.records);
    if (body_control_program.header.abi_version != BODY_CONTROL_PROGRAM_ABI_VERSION) {
        if (global_id.x == 0u) {
            atomicOr(
                &body_control_program.header.status,
                FIXED_PROGRAM_STATUS_ABI_MISMATCH
            );
        }
        return;
    }
    if (body_control_program.header.capacity != runtime_capacity
        || body_control_program.header.count > runtime_capacity) {
        if (global_id.x == 0u) {
            atomicOr(
                &body_control_program.header.status,
                FIXED_PROGRAM_STATUS_CAPACITY_EXCEEDED
            );
        }
        return;
    }
    let command_index = global_id.x;
    if (command_index >= body_control_program.header.count) {
        return;
    }
    let command = body_control_program.records[command_index];
    let body_capacity = arrayLength(&simulations.values);
    let supported_mode = command.mode_flags
            == BODY_CONTROL_PROGRAM_MODE_MOVE_INTENT
        || command.mode_flags
            == BODY_CONTROL_PROGRAM_MODE_PRIORITY_TARGET_IN_RANGE;
    let output_is_initial = command.result == BODY_CONTROL_RESULT_PENDING
        && command.selected_target_kind == BODY_CONTROL_SELECTED_TARGET_NONE
        && command.selected_target_slot == INVALID_IDENTITY_COMPONENT
        && command.selected_target_entity_id == INVALID_IDENTITY_COMPONENT
        && command.selected_target_incarnation == INVALID_IDENTITY_COMPONENT
        && command.state_flags == 0u;
    let finite_move = all(command.move_intent <= vec2f(3.402823466e+38))
        && all(command.move_intent >= vec2f(-3.402823466e+38));
    let core_payload_structural = command.core_target_slot < body_capacity
        && command.core_target_entity_id != 0u
        && command.core_target_entity_id != INVALID_IDENTITY_COMPONENT
        && command.core_target_incarnation != 0u
        && command.core_target_incarnation != INVALID_IDENTITY_COMPONENT;
    let tower_absent = command.tower_target_slot == INVALID_IDENTITY_COMPONENT
        && command.tower_target_entity_id == INVALID_IDENTITY_COMPONENT
        && command.tower_target_incarnation == INVALID_IDENTITY_COMPONENT;
    let tower_exact = command.tower_target_slot < body_capacity
        && command.tower_target_entity_id != 0u
        && command.tower_target_entity_id != INVALID_IDENTITY_COMPONENT
        && command.tower_target_incarnation != 0u
        && command.tower_target_incarnation != INVALID_IDENTITY_COMPONENT;
    let priority_payload_valid = command.mode_flags
            != BODY_CONTROL_PROGRAM_MODE_PRIORITY_TARGET_IN_RANGE
        || (all(command.move_intent == vec2f(0.0))
            && command.source_tick == params.fixed_tick
            && command.source_tick != 0u
            && command.attack_fingerprint != 0u
            && command.selection_policy
                == BODY_CONTROL_SELECTION_POLICY_CORE_FIRST_IN_RANGE_THEN_TOWER
            && command.attack_range > 0.0
            && command.attack_range <= 3.402823466e+38
            && core_payload_structural
            && (tower_absent || tower_exact));
    let move_payload_valid = command.mode_flags
            != BODY_CONTROL_PROGRAM_MODE_MOVE_INTENT
        || (command.source_tick == 0u
            && command.selection_sequence == 0u
            && command.attack_fingerprint == 0u
            && command.selection_policy == BODY_CONTROL_SELECTION_POLICY_NONE
            && command.attack_range == 0.0
            && command.core_target_slot == INVALID_IDENTITY_COMPONENT
            && command.core_target_entity_id == INVALID_IDENTITY_COMPONENT
            && command.core_target_incarnation == INVALID_IDENTITY_COMPONENT
            && tower_absent
            && dot(command.move_intent, command.move_intent) <= 1.000002);
    if (!supported_mode
        || !output_is_initial
        || !finite_move
        || !priority_payload_valid
        || !move_payload_valid
        || command.reserved_0 != 0u
        || command.destination_slot >= body_capacity) {
        atomicOr(
            &body_control_program.header.status,
            FIXED_PROGRAM_STATUS_RECORD_INVALID
        );
        return;
    }
    if (command.destination_slot >= counts.body_count
        || simulations.values[command.destination_slot].entity_id
            != command.entity_id
        || simulations.values[command.destination_slot].incarnation
            != command.incarnation) {
        atomicOr(
            &body_control_program.header.status,
            FIXED_PROGRAM_STATUS_RECORD_INVALID
        );
        return;
    }
    if (command.mode_flags == BODY_CONTROL_PROGRAM_MODE_MOVE_INTENT
        && body_has_flag(
            load_simulation_flags(command.destination_slot),
            BODY_FLAG_USE_FLOW
        )) {
        atomicOr(
            &body_control_program.header.status,
            FIXED_PROGRAM_STATUS_RECORD_INVALID
        );
        return;
    }
    // GPU death와 async death-event commit 사이에는 host exact handle이 잠시
    // active일 수 있습니다. 같은 identity의 dead target은 bounded no-op입니다.
    if (!body_id_is_alive(command.destination_slot)) {
        return;
    }
}

@compute @workgroup_size(256)
fn apply_body_control_commands(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()
        || body_control_program.header.abi_version
            != BODY_CONTROL_PROGRAM_ABI_VERSION
        || atomicLoad(&body_control_program.header.status) != 0u
        || body_control_program.header.capacity
            != arrayLength(&body_control_program.records)) {
        return;
    }
    let command_index = global_id.x;
    if (command_index >= body_control_program.header.count) {
        return;
    }
    let command = body_control_program.records[command_index];
    if (!exact_living_body(
        command.destination_slot,
        command.entity_id,
        command.incarnation
    )) {
        let exact_dead_move = command.mode_flags
                == BODY_CONTROL_PROGRAM_MODE_MOVE_INTENT
            && command.destination_slot < counts.body_count
            && command.destination_slot < arrayLength(&simulations.values)
            && simulations.values[command.destination_slot].entity_id
                == command.entity_id
            && simulations.values[command.destination_slot].incarnation
                == command.incarnation
            && !body_id_is_alive(command.destination_slot);
        if (exact_dead_move) {
            // GPU death readback 전의 exact MOVE는 ingress PENDING record를
            // 그대로 보존하는 bounded no-op이다.
            return;
        }
        body_control_program.records[command_index].result
            = BODY_CONTROL_RESULT_SOURCE_INVALID;
        return;
    }
    if (command.mode_flags == BODY_CONTROL_PROGRAM_MODE_MOVE_INTENT) {
        store_body_control_state(
            command.destination_slot,
            command,
            BODY_CONTROL_RESULT_PENDING,
            BODY_CONTROL_SELECTED_TARGET_NONE,
            INVALID_IDENTITY_COMPONENT,
            INVALID_IDENTITY_COMPONENT,
            INVALID_IDENTITY_COMPONENT,
            0u
        );
        atomicOr(
            &simulations.values[command.destination_slot].flags,
            BODY_FLAG_CONTROLLED_THIS_TICK
        );
        return;
    }

    if (!exact_living_body(
        command.core_target_slot,
        command.core_target_entity_id,
        command.core_target_incarnation
    )) {
        body_control_program.records[command_index].result
            = BODY_CONTROL_RESULT_CORE_INVALID;
        store_body_control_state(
            command.destination_slot,
            command,
            BODY_CONTROL_RESULT_CORE_INVALID,
            BODY_CONTROL_SELECTED_TARGET_NONE,
            INVALID_IDENTITY_COMPONENT,
            INVALID_IDENTITY_COMPONENT,
            INVALID_IDENTITY_COMPONENT,
            0u
        );
        return;
    }

    var result = BODY_CONTROL_RESULT_NO_TARGET;
    var selected_kind = BODY_CONTROL_SELECTED_TARGET_NONE;
    var selected_slot = INVALID_IDENTITY_COMPONENT;
    var selected_entity_id = INVALID_IDENTITY_COMPONENT;
    var selected_incarnation = INVALID_IDENTITY_COMPONENT;
    var state_flags = BODY_CONTROL_STATE_FLAG_ROUTE_FLOW;
    if (exact_target_is_in_range(
        command.destination_slot,
        command.core_target_slot,
        command.attack_range
    )) {
        result = BODY_CONTROL_RESULT_CORE_SELECTED;
        selected_kind = BODY_CONTROL_SELECTED_TARGET_CORE;
        selected_slot = command.core_target_slot;
        selected_entity_id = command.core_target_entity_id;
        selected_incarnation = command.core_target_incarnation;
        state_flags = BODY_CONTROL_STATE_FLAG_STOP
            | BODY_CONTROL_STATE_FLAG_CORE_SELECTED;
    } else if (exact_living_body(
            command.tower_target_slot,
            command.tower_target_entity_id,
            command.tower_target_incarnation
        ) && exact_target_is_in_range(
            command.destination_slot,
            command.tower_target_slot,
            command.attack_range
        )) {
        result = BODY_CONTROL_RESULT_TOWER_SELECTED;
        selected_kind = BODY_CONTROL_SELECTED_TARGET_TOWER;
        selected_slot = command.tower_target_slot;
        selected_entity_id = command.tower_target_entity_id;
        selected_incarnation = command.tower_target_incarnation;
        state_flags = BODY_CONTROL_STATE_FLAG_STOP
            | BODY_CONTROL_STATE_FLAG_TOWER_SELECTED;
    }
    body_control_program.records[command_index].result = result;
    body_control_program.records[command_index].selected_target_kind
        = selected_kind;
    body_control_program.records[command_index].selected_target_slot
        = selected_slot;
    body_control_program.records[command_index].selected_target_entity_id
        = selected_entity_id;
    body_control_program.records[command_index].selected_target_incarnation
        = selected_incarnation;
    body_control_program.records[command_index].state_flags = state_flags;
    store_body_control_state(
        command.destination_slot,
        command,
        result,
        selected_kind,
        selected_slot,
        selected_entity_id,
        selected_incarnation,
        state_flags
    );
    if ((state_flags & BODY_CONTROL_STATE_FLAG_STOP) != 0u) {
        physics.values[command.destination_slot].velocity = vec2f(0.0);
        atomicOr(
            &simulations.values[command.destination_slot].flags,
            BODY_FLAG_CONTROLLED_THIS_TICK
        );
    }
}

@compute @workgroup_size(256)
fn apply_controlled_motion(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count || !body_id_is_alive(body_id)) {
        return;
    }
    let control_state = body_control_states.values[body_id];
    if (control_state.entity_id != simulations.values[body_id].entity_id
        || control_state.incarnation != simulations.values[body_id].incarnation) {
        return;
    }
    if ((control_state.state_flags & BODY_CONTROL_STATE_FLAG_STOP) != 0u) {
        physics.values[body_id].velocity = vec2f(0.0);
        return;
    }
    if (control_state.source_tick != 0u) {
        return;
    }
    var velocity = physics.values[body_id].velocity;
    let decay = exp(-CONTROL_LINEAR_FRICTION * params.dt);
    let acceleration_scale = (1.0 - decay) / CONTROL_LINEAR_FRICTION;
    velocity = (velocity * decay)
        + (control_state.move_intent
            * CONTROL_ACCELERATION
            * acceleration_scale);
    let controlled_speed = length(velocity);
    if (controlled_speed > CONTROL_MAX_LINEAR_SPEED) {
        velocity = (velocity / controlled_speed) * CONTROL_MAX_LINEAR_SPEED;
    }
    if (control_state.move_intent.x == 0.0
        && control_state.move_intent.y == 0.0
        && length(velocity) <= CONTROL_SLEEP_SPEED) {
        velocity = vec2f(0.0);
    }
    physics.values[body_id].velocity = velocity;
}

@compute @workgroup_size(256)
fn validate_source_relative_spawns(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        if (global_id.x == 0u) {
            atomicOr(
                &spawn_program.header.status,
                FIXED_PROGRAM_STATUS_ABI_MISMATCH
            );
        }
        return;
    }
    let runtime_capacity = arrayLength(&spawn_program.records);
    if (spawn_program.header.abi_version != SPAWN_PROGRAM_ABI_VERSION) {
        if (global_id.x == 0u) {
            atomicOr(
                &spawn_program.header.status,
                FIXED_PROGRAM_STATUS_ABI_MISMATCH
            );
        }
        return;
    }
    if (spawn_program.header.capacity != runtime_capacity
        || spawn_program.header.count > runtime_capacity) {
        if (global_id.x == 0u) {
            atomicOr(
                &spawn_program.header.status,
                FIXED_PROGRAM_STATUS_CAPACITY_EXCEEDED
            );
        }
        return;
    }
    let program_index = global_id.x;
    if (program_index >= spawn_program.header.count) {
        return;
    }
    let body_capacity = arrayLength(&simulations.values);
    let program = spawn_program.records[program_index];
    let supported_mode = program.mode_flags
            == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_VELOCITY
        || program.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_AIM_POINT
        || program.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY
        || program.mode_flags
            == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET;
    let finite_payload = all(program.position_offset <= vec2f(3.402823466e+38))
        && all(program.position_offset >= vec2f(-3.402823466e+38))
        && all(program.target_offset <= vec2f(3.402823466e+38))
        && all(program.target_offset >= vec2f(-3.402823466e+38))
        && all(program.vector <= vec2f(3.402823466e+38))
        && all(program.vector >= vec2f(-3.402823466e+38))
        && program.scalar <= 3.402823466e+38
        && program.scalar >= -3.402823466e+38;
    let target_mode = program.mode_flags
        == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY;
    let selected_target_mode = program.mode_flags
        == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET;
    // Legacy modes 1-3 keep their pre-control tick-start resolve. Mode 4 is
    // validated only by the post-priority-control entrypoint below.
    if (selected_target_mode) {
        return;
    }
    let non_target_payload_valid = target_mode || selected_target_mode
        || (program.target_slot == INVALID_IDENTITY_COMPONENT
            && program.target_entity_id == INVALID_IDENTITY_COMPONENT
            && program.target_incarnation == INVALID_IDENTITY_COMPONENT
            && all(program.target_offset == vec2f(0.0)));
    let target_payload_valid = !target_mode
        || (program.target_slot < body_capacity
            && program.target_entity_id != INVALID_IDENTITY_COMPONENT
            && program.target_incarnation != INVALID_IDENTITY_COMPONENT
            && all(program.vector == vec2f(0.0)));
    let selected_payload_valid = !selected_target_mode
        || (program.source_slot < body_capacity
            && program.target_slot == INVALID_IDENTITY_COMPONENT
            && program.target_entity_id == INVALID_IDENTITY_COMPONENT
            && program.target_incarnation == INVALID_IDENTITY_COMPONENT
            && all(program.vector == vec2f(0.0))
            && program.attack_fingerprint != 0u
            && program.selected_target_kind
                == BODY_CONTROL_SELECTED_TARGET_NONE
            && program.request_flags
                == SPAWN_PROGRAM_REQUEST_REQUIRE_EXACT_SELECTED_TARGET);
    let legacy_request_flags_valid = program.request_flags == 0u
        || (target_mode
            && program.request_flags
                == SPAWN_PROGRAM_REQUEST_TOWER_DAMAGE_CHANNEL);
    let legacy_selection_payload_valid = selected_target_mode
        || (program.selection_sequence == 0u
            && program.attack_fingerprint == 0u
            && program.selected_target_kind
                == BODY_CONTROL_SELECTED_TARGET_NONE
            && legacy_request_flags_valid);
    let selected_destination_config_valid = !selected_target_mode
        || (program.destination_slot < body_capacity
            && enemy_behavior_states.values[program.destination_slot].program_id
                == ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE
            && bitcast<i32>(enemy_behavior_states.values[program.destination_slot]
                .windup_range) > 0
            && atomicLoad(&enemy_behavior_states.values[program.destination_slot].state)
                == BODY_CONTROL_SELECTED_TARGET_NONE
            && enemy_behavior_states.values[program.destination_slot].target_slot
                == INVALID_IDENTITY_COMPONENT
            && enemy_behavior_states.values[program.destination_slot].target_entity_id
                == INVALID_IDENTITY_COMPONENT
            && enemy_behavior_states.values[program.destination_slot].target_incarnation
                == INVALID_IDENTITY_COMPONENT);
    if (program.result != SPAWN_PROGRAM_RESULT_PENDING
        || !supported_mode
        || !finite_payload
        || !non_target_payload_valid
        || !target_payload_valid
        || !selected_payload_valid
        || !legacy_selection_payload_valid
        || !selected_destination_config_valid
        || ((program.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_AIM_POINT
                || target_mode
                || selected_target_mode)
            && !(program.scalar > 0.0))
        || program.source_tick == 0u
        || program.source_tick != params.fixed_tick
        || program.reserved_0 != 0u
        || program.destination_slot >= counts.body_count
        || program.destination_slot >= body_capacity
        || program.source_slot >= body_capacity
        || program.destination_slot == program.source_slot
        || simulations.values[program.destination_slot].entity_id
            != program.destination_entity_id
        || simulations.values[program.destination_slot].incarnation
            != program.destination_incarnation
        || body_id_is_alive(program.destination_slot)) {
        atomicOr(
            &spawn_program.header.status,
            FIXED_PROGRAM_STATUS_RECORD_INVALID
        );
        return;
    }
}

@compute @workgroup_size(256)
fn validate_selected_target_spawns(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        if (global_id.x == 0u) {
            atomicOr(
                &spawn_program.header.status,
                FIXED_PROGRAM_STATUS_ABI_MISMATCH
            );
        }
        return;
    }
    let runtime_capacity = arrayLength(&spawn_program.records);
    if (spawn_program.header.abi_version != SPAWN_PROGRAM_ABI_VERSION) {
        if (global_id.x == 0u) {
            atomicOr(
                &spawn_program.header.status,
                FIXED_PROGRAM_STATUS_ABI_MISMATCH
            );
        }
        return;
    }
    if (spawn_program.header.capacity != runtime_capacity
        || spawn_program.header.count > runtime_capacity) {
        if (global_id.x == 0u) {
            atomicOr(
                &spawn_program.header.status,
                FIXED_PROGRAM_STATUS_CAPACITY_EXCEEDED
            );
        }
        return;
    }
    let program_index = global_id.x;
    if (program_index >= spawn_program.header.count) {
        return;
    }
    let program = spawn_program.records[program_index];
    if (program.mode_flags
        != SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET) {
        return;
    }
    let body_capacity = arrayLength(&simulations.values);
    let finite_payload = all(program.position_offset <= vec2f(3.402823466e+38))
        && all(program.position_offset >= vec2f(-3.402823466e+38))
        && all(program.target_offset <= vec2f(3.402823466e+38))
        && all(program.target_offset >= vec2f(-3.402823466e+38))
        && all(program.vector <= vec2f(3.402823466e+38))
        && all(program.vector >= vec2f(-3.402823466e+38))
        && program.scalar <= 3.402823466e+38
        && program.scalar >= -3.402823466e+38;
    let slots_in_bounds = program.destination_slot < body_capacity
        && program.source_slot < body_capacity;
    if (program.result != SPAWN_PROGRAM_RESULT_PENDING
        || !finite_payload
        || !slots_in_bounds
        || program.target_slot != INVALID_IDENTITY_COMPONENT
        || program.target_entity_id != INVALID_IDENTITY_COMPONENT
        || program.target_incarnation != INVALID_IDENTITY_COMPONENT
        || any(program.vector != vec2f(0.0))
        || !(program.scalar > 0.0)
        || program.source_tick == 0u
        || program.source_tick != params.fixed_tick
        || program.attack_fingerprint == 0u
        || program.selected_target_kind != BODY_CONTROL_SELECTED_TARGET_NONE
        || program.request_flags
            != SPAWN_PROGRAM_REQUEST_REQUIRE_EXACT_SELECTED_TARGET
        || program.reserved_0 != 0u
        || program.destination_slot >= counts.body_count
        || program.destination_slot == program.source_slot) {
        atomicOr(
            &spawn_program.header.status,
            FIXED_PROGRAM_STATUS_RECORD_INVALID
        );
        return;
    }
    // Bounds를 확인한 뒤에만 destination side-plane을 읽습니다.
    if (simulations.values[program.destination_slot].entity_id
            != program.destination_entity_id
        || simulations.values[program.destination_slot].incarnation
            != program.destination_incarnation
        || body_id_is_alive(program.destination_slot)
        || enemy_behavior_states.values[program.destination_slot].program_id
            != ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE
        || bitcast<i32>(enemy_behavior_states.values[program.destination_slot]
            .windup_range) <= 0
        || atomicLoad(&enemy_behavior_states.values[program.destination_slot].state)
            != BODY_CONTROL_SELECTED_TARGET_NONE
        || enemy_behavior_states.values[program.destination_slot].target_slot
            != INVALID_IDENTITY_COMPONENT
        || enemy_behavior_states.values[program.destination_slot].target_entity_id
            != INVALID_IDENTITY_COMPONENT
        || enemy_behavior_states.values[program.destination_slot].target_incarnation
            != INVALID_IDENTITY_COMPONENT) {
        atomicOr(
            &spawn_program.header.status,
            FIXED_PROGRAM_STATUS_RECORD_INVALID
        );
        return;
    }
}

@compute @workgroup_size(256)
fn resolve_source_relative_spawns(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()
        || spawn_program.header.abi_version != SPAWN_PROGRAM_ABI_VERSION
        || atomicLoad(&spawn_program.header.status) != 0u) {
        return;
    }
    let runtime_capacity = arrayLength(&spawn_program.records);
    if (spawn_program.header.capacity != runtime_capacity
        || spawn_program.header.count > runtime_capacity) {
        return;
    }
    let program_index = global_id.x;
    if (program_index >= spawn_program.header.count) {
        return;
    }
    let body_capacity = arrayLength(&simulations.values);
    let program = spawn_program.records[program_index];
    // Mode 4 is resolved only after the same-tick priority control state exists.
    if (program.mode_flags
        == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET) {
        return;
    }
    if (program.destination_slot >= counts.body_count
        || program.destination_slot >= body_capacity
        || simulations.values[program.destination_slot].entity_id
            != program.destination_entity_id
        || simulations.values[program.destination_slot].incarnation
            != program.destination_incarnation
        || body_id_is_alive(program.destination_slot)) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_DESTINATION_INVALID;
        return;
    }
    if (program.source_slot >= body_capacity
        || simulations.values[program.source_slot].entity_id != program.source_entity_id
        || simulations.values[program.source_slot].incarnation
            != program.source_incarnation
        || !body_id_is_alive(program.source_slot)) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_SOURCE_INVALID;
        return;
    }
    if (program.mode_flags
        == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET) {
        let control_state = body_control_states.values[program.source_slot];
        if (control_state.entity_id != program.source_entity_id
            || control_state.incarnation != program.source_incarnation
            || control_state.source_tick != program.source_tick
            || control_state.selection_sequence != program.selection_sequence
            || control_state.attack_fingerprint != program.attack_fingerprint
            || control_state.selection_policy
                != BODY_CONTROL_SELECTION_POLICY_CORE_FIRST_IN_RANGE_THEN_TOWER
            || control_state.reserved_0 != 0u) {
            spawn_program.records[program_index].result
                = SPAWN_PROGRAM_RESULT_CONTROL_STATE_MISMATCH;
            return;
        }
        if (control_state.result == BODY_CONTROL_RESULT_CORE_INVALID) {
            spawn_program.records[program_index].result
                = SPAWN_PROGRAM_RESULT_CORE_TARGET_INVALID;
            return;
        }
        if (control_state.result == BODY_CONTROL_RESULT_NO_TARGET) {
            spawn_program.records[program_index].result
                = SPAWN_PROGRAM_RESULT_NO_TARGET;
            return;
        }
        let selected_is_core = control_state.result
                == BODY_CONTROL_RESULT_CORE_SELECTED
            && control_state.selected_target_kind
                == BODY_CONTROL_SELECTED_TARGET_CORE
            && (control_state.state_flags & (
                BODY_CONTROL_STATE_FLAG_STOP
                | BODY_CONTROL_STATE_FLAG_CORE_SELECTED
            )) == (
                BODY_CONTROL_STATE_FLAG_STOP
                | BODY_CONTROL_STATE_FLAG_CORE_SELECTED
            );
        let selected_is_tower = control_state.result
                == BODY_CONTROL_RESULT_TOWER_SELECTED
            && control_state.selected_target_kind
                == BODY_CONTROL_SELECTED_TARGET_TOWER
            && (control_state.state_flags & (
                BODY_CONTROL_STATE_FLAG_STOP
                | BODY_CONTROL_STATE_FLAG_TOWER_SELECTED
            )) == (
                BODY_CONTROL_STATE_FLAG_STOP
                | BODY_CONTROL_STATE_FLAG_TOWER_SELECTED
            );
        if (!selected_is_core && !selected_is_tower) {
            spawn_program.records[program_index].result
                = SPAWN_PROGRAM_RESULT_CONTROL_STATE_MISMATCH;
            return;
        }
        if (!exact_living_body(
            control_state.selected_target_slot,
            control_state.selected_target_entity_id,
            control_state.selected_target_incarnation
        )) {
            spawn_program.records[program_index].result = select(
                SPAWN_PROGRAM_RESULT_NO_TARGET,
                SPAWN_PROGRAM_RESULT_CORE_TARGET_INVALID,
                selected_is_core
            );
            return;
        }
        let core_damage_fixed_point = bitcast<i32>(
            enemy_behavior_states.values[program.destination_slot].windup_range
        );
        if (enemy_behavior_states.values[program.destination_slot].program_id
                != ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE
            || core_damage_fixed_point <= 0
            || body_interaction_layer(
                physics.values[program.destination_slot].interaction_meta
            ) != BODY_LAYER_PROJECTILE) {
            spawn_program.records[program_index].result
                = SPAWN_PROGRAM_RESULT_CONTROL_STATE_MISMATCH;
            return;
        }

        let source_physics = physics.values[program.source_slot];
        let target_physics = physics.values[control_state.selected_target_slot];
        let destination_position = source_physics.position + program.position_offset;
        var launch_direction = (target_physics.position + program.target_offset)
            - destination_position;
        var launch_direction_length_squared = dot(launch_direction, launch_direction);
        if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
            launch_direction = source_physics.velocity;
            launch_direction_length_squared = dot(launch_direction, launch_direction);
        }
        if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
            launch_direction = vec2f(1.0, 0.0);
        } else {
            launch_direction *= inverseSqrt(launch_direction_length_squared);
        }
        let destination_velocity = launch_direction * program.scalar;
        physics.values[program.destination_slot].position = destination_position;
        physics.values[program.destination_slot].velocity = destination_velocity;
        let selected_interaction_layer = select(
            BODY_LAYER_PLAYER_DAMAGEABLE,
            BODY_LAYER_CORE_PROXY,
            selected_is_core
        );
        let destination_interaction_layer = body_interaction_layer(
            physics.values[program.destination_slot].interaction_meta
        );
        physics.values[program.destination_slot].interaction_meta
            = destination_interaction_layer
                | ((BODY_LAYER_TERRAIN | selected_interaction_layer) << 16u);
        combat_states.values[program.destination_slot]
            .target_interaction_layer_mask = selected_interaction_layer;
        temporaries.values[program.destination_slot].previous_position
            = destination_position;
        temporaries.values[program.destination_slot].predicted_position
            = destination_position;
        temporaries.values[program.destination_slot].position_delta = vec2f(0.0);
        temporaries.values[program.destination_slot].grid_index = -1;
        temporaries.values[program.destination_slot].previous_flow_field_index
            = simulations.values[program.destination_slot].flow_field_index;
        atomicStore(
            &enemy_behavior_states.values[program.destination_slot].state,
            control_state.selected_target_kind
        );
        enemy_behavior_states.values[program.destination_slot]
            .state_entered_fixed_tick = program.source_tick;
        enemy_behavior_states.values[program.destination_slot]
            .state_expires_at_fixed_tick = program.selection_sequence;
        enemy_behavior_states.values[program.destination_slot].target_slot
            = control_state.selected_target_slot;
        enemy_behavior_states.values[program.destination_slot].target_entity_id
            = control_state.selected_target_entity_id;
        enemy_behavior_states.values[program.destination_slot].target_incarnation
            = control_state.selected_target_incarnation;
        atomicStore(
            &enemy_behavior_states.values[program.destination_slot].flags,
            ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_VALID
                | select(
                    ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_TOWER,
                    ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_CORE,
                    selected_is_core
                )
        );
        enemy_behavior_states.values[program.destination_slot].charge_direction.x
            = bitcast<f32>(program.attack_fingerprint);
        enemy_behavior_states.values[program.destination_slot].charge_direction.y = 0.0;
        spawn_program.records[program_index].target_slot
            = control_state.selected_target_slot;
        spawn_program.records[program_index].target_entity_id
            = control_state.selected_target_entity_id;
        spawn_program.records[program_index].target_incarnation
            = control_state.selected_target_incarnation;
        spawn_program.records[program_index].selected_target_kind
            = control_state.selected_target_kind;
        if (selected_is_tower) {
            snapshot_tower_attack_damage(
                program.source_slot,
                program.destination_slot
            );
        }
        atomicOr(
            &simulations.values[program.destination_slot].flags,
            BODY_FLAG_ALIVE
        );
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_RESOLVED;
        return;
    }
    if (program.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY
        && (program.target_slot >= body_capacity
            || simulations.values[program.target_slot].entity_id
                != program.target_entity_id
            || simulations.values[program.target_slot].incarnation
                != program.target_incarnation
            || !body_id_is_alive(program.target_slot))) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_TARGET_INVALID;
        return;
    }

    let source_physics = physics.values[program.source_slot];
    let destination_position = source_physics.position + program.position_offset;
    var destination_velocity = program.vector
        + (source_physics.velocity * program.scalar);
    if (program.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_AIM_POINT) {
        var launch_direction = program.vector - source_physics.position;
        var launch_direction_length_squared = dot(launch_direction, launch_direction);
        if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
            launch_direction = source_physics.velocity;
            launch_direction_length_squared = dot(launch_direction, launch_direction);
        }
        if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
            launch_direction = vec2f(1.0, 0.0);
        } else {
            launch_direction *= inverseSqrt(launch_direction_length_squared);
        }
        destination_velocity = launch_direction * program.scalar;
    } else if (program.mode_flags
            == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY) {
        let target_physics = physics.values[program.target_slot];
        var launch_direction = (target_physics.position + program.target_offset)
            - source_physics.position;
        var launch_direction_length_squared = dot(launch_direction, launch_direction);
        if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
            launch_direction = source_physics.velocity;
            launch_direction_length_squared = dot(launch_direction, launch_direction);
        }
        if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
            launch_direction = vec2f(1.0, 0.0);
        } else {
            launch_direction *= inverseSqrt(launch_direction_length_squared);
        }
        destination_velocity = launch_direction * program.scalar;
    }
    physics.values[program.destination_slot].position = destination_position;
    physics.values[program.destination_slot].velocity = destination_velocity;
    temporaries.values[program.destination_slot].previous_position
        = destination_position;
    temporaries.values[program.destination_slot].predicted_position
        = destination_position;
    temporaries.values[program.destination_slot].position_delta = vec2f(0.0);
    temporaries.values[program.destination_slot].grid_index = -1;
    temporaries.values[program.destination_slot].previous_flow_field_index
        = simulations.values[program.destination_slot].flow_field_index;
    // Host가 exact Tower roster + projectile channel을 증명한 target-entity
    // request에만 source Boost를 한 번 snapshot합니다. PLAYER_DAMAGEABLE layer
    // 자체는 Tower 권한 증거가 아니며 aim/core/other projectile은 원본 damage를 유지합니다.
    if (program.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY
        && program.request_flags == SPAWN_PROGRAM_REQUEST_TOWER_DAMAGE_CHANNEL) {
        snapshot_tower_attack_damage(
            program.source_slot,
            program.destination_slot
        );
    }
    atomicOr(
        &simulations.values[program.destination_slot].flags,
        BODY_FLAG_ALIVE
    );
    spawn_program.records[program_index].result = SPAWN_PROGRAM_RESULT_RESOLVED;
}

@compute @workgroup_size(256)
fn resolve_selected_target_spawns(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()
        || spawn_program.header.abi_version != SPAWN_PROGRAM_ABI_VERSION
        || atomicLoad(&spawn_program.header.status) != 0u) {
        return;
    }
    let runtime_capacity = arrayLength(&spawn_program.records);
    if (spawn_program.header.capacity != runtime_capacity
        || spawn_program.header.count > runtime_capacity) {
        return;
    }
    let program_index = global_id.x;
    if (program_index >= spawn_program.header.count) {
        return;
    }
    let body_capacity = arrayLength(&simulations.values);
    let program = spawn_program.records[program_index];
    if (program.mode_flags
        != SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET) {
        return;
    }
    if (program.destination_slot >= counts.body_count
        || program.destination_slot >= body_capacity
        || simulations.values[program.destination_slot].entity_id
            != program.destination_entity_id
        || simulations.values[program.destination_slot].incarnation
            != program.destination_incarnation
        || body_id_is_alive(program.destination_slot)) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_DESTINATION_INVALID;
        return;
    }
    if (program.source_slot >= body_capacity
        || simulations.values[program.source_slot].entity_id != program.source_entity_id
        || simulations.values[program.source_slot].incarnation
            != program.source_incarnation
        || !body_id_is_alive(program.source_slot)) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_SOURCE_INVALID;
        return;
    }

    let control_state = body_control_states.values[program.source_slot];
    if (control_state.entity_id != program.source_entity_id
        || control_state.incarnation != program.source_incarnation
        || control_state.source_tick != program.source_tick
        || control_state.selection_sequence != program.selection_sequence
        || control_state.attack_fingerprint != program.attack_fingerprint
        || control_state.selection_policy
            != BODY_CONTROL_SELECTION_POLICY_CORE_FIRST_IN_RANGE_THEN_TOWER
        || control_state.reserved_0 != 0u) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_CONTROL_STATE_MISMATCH;
        return;
    }
    if (control_state.result == BODY_CONTROL_RESULT_CORE_INVALID) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_CORE_TARGET_INVALID;
        return;
    }
    if (control_state.result == BODY_CONTROL_RESULT_NO_TARGET) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_NO_TARGET;
        return;
    }
    let selected_is_core = control_state.result
            == BODY_CONTROL_RESULT_CORE_SELECTED
        && control_state.selected_target_kind
            == BODY_CONTROL_SELECTED_TARGET_CORE
        && (control_state.state_flags & (
            BODY_CONTROL_STATE_FLAG_STOP
            | BODY_CONTROL_STATE_FLAG_CORE_SELECTED
        )) == (
            BODY_CONTROL_STATE_FLAG_STOP
            | BODY_CONTROL_STATE_FLAG_CORE_SELECTED
        );
    let selected_is_tower = control_state.result
            == BODY_CONTROL_RESULT_TOWER_SELECTED
        && control_state.selected_target_kind
            == BODY_CONTROL_SELECTED_TARGET_TOWER
        && (control_state.state_flags & (
            BODY_CONTROL_STATE_FLAG_STOP
            | BODY_CONTROL_STATE_FLAG_TOWER_SELECTED
        )) == (
            BODY_CONTROL_STATE_FLAG_STOP
            | BODY_CONTROL_STATE_FLAG_TOWER_SELECTED
        );
    if (!selected_is_core && !selected_is_tower) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_CONTROL_STATE_MISMATCH;
        return;
    }
    if (!exact_living_body(
        control_state.selected_target_slot,
        control_state.selected_target_entity_id,
        control_state.selected_target_incarnation
    )) {
        spawn_program.records[program_index].result = select(
            SPAWN_PROGRAM_RESULT_NO_TARGET,
            SPAWN_PROGRAM_RESULT_CORE_TARGET_INVALID,
            selected_is_core
        );
        return;
    }
    let core_damage_fixed_point = bitcast<i32>(
        enemy_behavior_states.values[program.destination_slot].windup_range
    );
    if (enemy_behavior_states.values[program.destination_slot].program_id
            != ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE
        || core_damage_fixed_point <= 0
        || body_interaction_layer(
            physics.values[program.destination_slot].interaction_meta
        ) != BODY_LAYER_PROJECTILE) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_CONTROL_STATE_MISMATCH;
        return;
    }

    let source_physics = physics.values[program.source_slot];
    let target_physics = physics.values[control_state.selected_target_slot];
    let destination_position = source_physics.position + program.position_offset;
    var launch_direction = (target_physics.position + program.target_offset)
        - destination_position;
    var launch_direction_length_squared = dot(launch_direction, launch_direction);
    if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
        launch_direction = source_physics.velocity;
        launch_direction_length_squared = dot(launch_direction, launch_direction);
    }
    if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
        launch_direction = vec2f(1.0, 0.0);
    } else {
        launch_direction *= inverseSqrt(launch_direction_length_squared);
    }
    let destination_velocity = launch_direction * program.scalar;
    physics.values[program.destination_slot].position = destination_position;
    physics.values[program.destination_slot].velocity = destination_velocity;
    let selected_interaction_layer = select(
        BODY_LAYER_PLAYER_DAMAGEABLE,
        BODY_LAYER_CORE_PROXY,
        selected_is_core
    );
    let destination_interaction_layer = body_interaction_layer(
        physics.values[program.destination_slot].interaction_meta
    );
    physics.values[program.destination_slot].interaction_meta
        = destination_interaction_layer
            | ((BODY_LAYER_TERRAIN | selected_interaction_layer) << 16u);
    combat_states.values[program.destination_slot]
        .target_interaction_layer_mask = selected_interaction_layer;
    temporaries.values[program.destination_slot].previous_position
        = destination_position;
    temporaries.values[program.destination_slot].predicted_position
        = destination_position;
    temporaries.values[program.destination_slot].position_delta = vec2f(0.0);
    temporaries.values[program.destination_slot].grid_index = -1;
    temporaries.values[program.destination_slot].previous_flow_field_index
        = simulations.values[program.destination_slot].flow_field_index;
    atomicStore(
        &enemy_behavior_states.values[program.destination_slot].state,
        control_state.selected_target_kind
    );
    enemy_behavior_states.values[program.destination_slot]
        .state_entered_fixed_tick = program.source_tick;
    enemy_behavior_states.values[program.destination_slot]
        .state_expires_at_fixed_tick = program.selection_sequence;
    enemy_behavior_states.values[program.destination_slot].target_slot
        = control_state.selected_target_slot;
    enemy_behavior_states.values[program.destination_slot].target_entity_id
        = control_state.selected_target_entity_id;
    enemy_behavior_states.values[program.destination_slot].target_incarnation
        = control_state.selected_target_incarnation;
    atomicStore(
        &enemy_behavior_states.values[program.destination_slot].flags,
        ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_VALID
            | select(
                ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_TOWER,
                ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_CORE,
                selected_is_core
            )
    );
    enemy_behavior_states.values[program.destination_slot].charge_direction.x
        = bitcast<f32>(program.attack_fingerprint);
    enemy_behavior_states.values[program.destination_slot].charge_direction.y = 0.0;
    spawn_program.records[program_index].target_slot
        = control_state.selected_target_slot;
    spawn_program.records[program_index].target_entity_id
        = control_state.selected_target_entity_id;
    spawn_program.records[program_index].target_incarnation
        = control_state.selected_target_incarnation;
    spawn_program.records[program_index].selected_target_kind
        = control_state.selected_target_kind;
    if (selected_is_tower) {
        snapshot_tower_attack_damage(
            program.source_slot,
            program.destination_slot
        );
    }
    atomicOr(
        &simulations.values[program.destination_slot].flags,
        BODY_FLAG_ALIVE
    );
    spawn_program.records[program_index].result
        = SPAWN_PROGRAM_RESULT_RESOLVED;
}

fn tower_gameplay_target_is_valid() -> bool {
    if (tower_gameplay_target.enabled == 0u
        || tower_gameplay_target.target_slot >= counts.body_count) {
        return false;
    }
    let target_slot = tower_gameplay_target.target_slot;
    return simulations.values[target_slot].entity_id
            == tower_gameplay_target.entity_id
        && simulations.values[target_slot].incarnation
            == tower_gameplay_target.incarnation
        && body_id_is_alive(target_slot)
        && body_interaction_layer(physics.values[target_slot].interaction_meta)
            == BODY_LAYER_PLAYER_DAMAGEABLE
        && gameplay_meta_is_valid(simulations.values[target_slot].gameplay_meta)
        && gameplay_team_id(simulations.values[target_slot].gameplay_meta)
            == GAMEPLAY_TEAM_PLAYER;
}

fn behavior_target_matches_gameplay_tower(body_id: u32) -> bool {
    let flags = atomicLoad(&enemy_behavior_states.values[body_id].flags);
    return (flags & ENEMY_BEHAVIOR_FLAG_TARGET_VALID) != 0u
        && tower_gameplay_target_is_valid()
        && enemy_behavior_states.values[body_id].target_slot
            == tower_gameplay_target.target_slot
        && enemy_behavior_states.values[body_id].target_entity_id
            == tower_gameplay_target.entity_id
        && enemy_behavior_states.values[body_id].target_incarnation
            == tower_gameplay_target.incarnation;
}

fn bind_behavior_target_to_gameplay_tower(body_id: u32) {
    enemy_behavior_states.values[body_id].target_slot
        = tower_gameplay_target.target_slot;
    enemy_behavior_states.values[body_id].target_entity_id
        = tower_gameplay_target.entity_id;
    enemy_behavior_states.values[body_id].target_incarnation
        = tower_gameplay_target.incarnation;
    atomicOr(
        &enemy_behavior_states.values[body_id].flags,
        ENEMY_BEHAVIOR_FLAG_TARGET_VALID
    );
}

fn set_enemy_behavior_state(
    body_id: u32,
    state: u32,
    expires_at_fixed_tick: u32
) {
    atomicStore(&enemy_behavior_states.values[body_id].state, state);
    enemy_behavior_states.values[body_id].state_entered_fixed_tick
        = params.fixed_tick;
    enemy_behavior_states.values[body_id].state_expires_at_fixed_tick
        = expires_at_fixed_tick;
}

fn enter_enemy_core_fallback(body_id: u32) {
    if (atomicLoad(&enemy_behavior_states.values[body_id].state)
        != ENEMY_BEHAVIOR_STATE_CORE_FALLBACK) {
        set_enemy_behavior_state(
            body_id,
            ENEMY_BEHAVIOR_STATE_CORE_FALLBACK,
            0u
        );
    }
    enemy_behavior_states.values[body_id].target_slot = 0u;
    enemy_behavior_states.values[body_id].target_entity_id = 0u;
    enemy_behavior_states.values[body_id].target_incarnation = 0u;
    enemy_behavior_states.values[body_id].charge_direction = vec2f(0.0);
    atomicStore(&enemy_behavior_states.values[body_id].flags, 0u);
    atomicOr(&simulations.values[body_id].flags, BODY_FLAG_USE_FLOW);
}

fn disable_enemy_flow(body_id: u32) {
    atomicAnd(&simulations.values[body_id].flags, ~BODY_FLAG_USE_FLOW);
}

fn octagon_orbit_config_is_valid(body_id: u32) -> bool {
    let facet_config = enemy_behavior_states.values[body_id].telegraph_color_rgba8;
    let armored_facet_count = facet_config & 65535u;
    let total_facet_count = (facet_config >> 16u) & 65535u;
    return enemy_behavior_states.values[body_id].windup_range > 0.0
        && enemy_behavior_states.values[body_id].windup_range
            <= 3.402823466e+38
        && enemy_behavior_states.values[body_id].windup_ticks
            == ENEMY_ORBIT_COORDINATE_SYSTEM_RING_SLOTS
        && enemy_behavior_states.values[body_id].charge_max_ticks
            < enemy_behavior_states.values[body_id].recoil_ticks
        && enemy_behavior_states.values[body_id].recoil_ticks
            == ENEMY_ORBIT_SLOT_CAPACITY
        && enemy_behavior_states.values[body_id].recover_ticks != 0u
        && bitcast<i32>(enemy_behavior_states.values[body_id]
            .telegraph_style_code) > 0
        && armored_facet_count == 3u
        && total_facet_count == ENEMY_ORBIT_SLOT_CAPACITY
        && enemy_behavior_states.values[body_id].charge_speed == 0.0
        && enemy_behavior_states.values[body_id].recoil_impulse == 0.0
        && enemy_behavior_states.values[body_id].telegraph_radius_scale == 0.0;
}

fn rotate_octagon_orbit_radial(radial: vec2f, angle: f32) -> vec2f {
    let cosine = cos(angle);
    let sine = sin(angle);
    return vec2f(
        radial.x * cosine - radial.y * sine,
        radial.x * sine + radial.y * cosine
    );
}

@compute @workgroup_size(256)
fn advance_octagon_orbit(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || enemy_behavior_states.values[body_id].program_id
            != ENEMY_BEHAVIOR_PROGRAM_OCTAGON_TOWER_ORBIT
        || !body_id_is_alive(body_id)) {
        return;
    }
    let state = atomicLoad(&enemy_behavior_states.values[body_id].state);
    // Tower loss is a same-world latch. A later exact Tower config cannot re-enter orbit.
    if (state == ENEMY_BEHAVIOR_STATE_CORE_FALLBACK) {
        enter_enemy_core_fallback(body_id);
        return;
    }
    if ((state != ENEMY_BEHAVIOR_STATE_SEEK_TOWER
            && state != ENEMY_BEHAVIOR_STATE_ORBIT_TOWER)
        || !octagon_orbit_config_is_valid(body_id)
        || !tower_gameplay_target_is_valid()) {
        enter_enemy_core_fallback(body_id);
        return;
    }
    let previous_flags = atomicLoad(&enemy_behavior_states.values[body_id].flags);
    let allowed_seek_flags = ENEMY_BEHAVIOR_FLAG_TARGET_VALID;
    let allowed_active_flags = ENEMY_BEHAVIOR_FLAG_TARGET_VALID
        | ENEMY_BEHAVIOR_FLAG_DIRECTIONAL_DEFENSE_ACTIVE;
    let flags_match_state = select(
        previous_flags == allowed_active_flags,
        previous_flags == 0u || previous_flags == allowed_seek_flags,
        state == ENEMY_BEHAVIOR_STATE_SEEK_TOWER
    );
    if (!flags_match_state
        || ((previous_flags & ENEMY_BEHAVIOR_FLAG_TARGET_VALID) != 0u
            && !behavior_target_matches_gameplay_tower(body_id))) {
        enter_enemy_core_fallback(body_id);
        return;
    }
    bind_behavior_target_to_gameplay_tower(body_id);

    let phase_word = ENEMY_ORBIT_SLOT_ZERO_PHASE_Q32
        + (enemy_behavior_states.values[body_id].charge_max_ticks << 29u)
        + (params.fixed_tick
            * enemy_behavior_states.values[body_id].recover_ticks);
    let angle = f32(phase_word) * ENEMY_ORBIT_PHASE_RADIANS_PER_Q32;
    let desired_radial = vec2f(cos(angle), sin(angle));
    let target_position = physics.values[tower_gameplay_target.target_slot].position;
    var facing = target_position - physics.values[body_id].position;
    let facing_length_squared = dot(facing, facing);
    if (facing_length_squared <= EPSILON_DISTANCE_SQUARED) {
        facing = -desired_radial;
    } else {
        facing *= inverseSqrt(facing_length_squared);
    }
    enemy_behavior_states.values[body_id].charge_direction = facing;

    let orbit_radius = enemy_behavior_states.values[body_id].windup_range;
    if (state == ENEMY_BEHAVIOR_STATE_SEEK_TOWER) {
        // 접근 중에는 route flow와 exact Tower-facing만 유지합니다. 방어는 실제
        // radius capture 뒤에만 활성화되어 멀리서 생기는 가짜 armored hit를 막습니다.
        atomicStore(
            &enemy_behavior_states.values[body_id].flags,
            allowed_seek_flags
        );
        atomicOr(&simulations.values[body_id].flags, BODY_FLAG_USE_FLOW);
        if (facing_length_squared > orbit_radius * orbit_radius) {
            return;
        }
        set_enemy_behavior_state(
            body_id,
            ENEMY_BEHAVIOR_STATE_ORBIT_TOWER,
            0u
        );
    }

    // Capture 뒤에는 exact Tower orbit이 velocity를 소유합니다.
    disable_enemy_flow(body_id);
    atomicStore(
        &enemy_behavior_states.values[body_id].flags,
        allowed_active_flags
    );

    let body_position = physics.values[body_id].position;
    let current_delta = body_position - target_position;
    let current_distance_squared = dot(current_delta, current_delta);
    var current_radial = desired_radial;
    if (current_distance_squared > EPSILON_DISTANCE_SQUARED) {
        current_radial = current_delta * inverseSqrt(current_distance_squared);
    }
    let radial_dot = clamp(dot(current_radial, desired_radial), -1.0, 1.0);
    let radial_cross = current_radial.x * desired_radial.y
        - current_radial.y * desired_radial.x;
    var turn_direction = select(-1.0, 1.0, radial_cross >= 0.0);
    if (abs(radial_cross) <= EPSILON_MASS && radial_dot < 0.0) {
        // Exact opposite slot은 entity/order와 무관한 slot parity로 tie-break합니다.
        turn_direction = select(
            -1.0,
            1.0,
            (enemy_behavior_states.values[body_id].charge_max_ticks & 1u) == 0u
        );
    }
    let signed_angle_error = acos(radial_dot) * turn_direction;
    let maximum_speed = max(simulations.values[body_id].flow_speed, 0.0);
    let maximum_angular_step = select(
        0.0,
        maximum_speed * max(params.dt, 0.0) / orbit_radius,
        orbit_radius > EPSILON_MASS
    );
    let settle_angle = clamp(
        signed_angle_error,
        -maximum_angular_step,
        maximum_angular_step
    );
    let settle_radial = rotate_octagon_orbit_radial(
        current_radial,
        settle_angle
    );
    let desired_position = target_position + settle_radial * orbit_radius;
    let position_error = desired_position - body_position;
    var desired_velocity = position_error * max(params.inverse_dt, 0.0);
    let desired_speed_squared = dot(desired_velocity, desired_velocity);
    if (maximum_speed <= 0.0) {
        desired_velocity = vec2f(0.0);
    } else if (desired_speed_squared > maximum_speed * maximum_speed) {
        desired_velocity *= maximum_speed * inverseSqrt(desired_speed_squared);
    }
    physics.values[body_id].velocity = desired_velocity;
}

@compute @workgroup_size(256)
fn advance_enemy_charge(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || enemy_behavior_states.values[body_id].program_id
            != ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE
        || !body_id_is_alive(body_id)) {
        return;
    }
    let state = atomicLoad(&enemy_behavior_states.values[body_id].state);
    if (!tower_gameplay_target_is_valid()) {
        enter_enemy_core_fallback(body_id);
        return;
    }
    if (state == ENEMY_BEHAVIOR_STATE_CORE_FALLBACK) {
        bind_behavior_target_to_gameplay_tower(body_id);
        disable_enemy_flow(body_id);
        physics.values[body_id].velocity = vec2f(0.0);
        set_enemy_behavior_state(body_id, ENEMY_BEHAVIOR_STATE_SEEK_TOWER, 0u);
        return;
    }
    if (state == ENEMY_BEHAVIOR_STATE_SEEK_TOWER) {
        let flags = atomicLoad(&enemy_behavior_states.values[body_id].flags);
        if ((flags & ENEMY_BEHAVIOR_FLAG_TARGET_VALID) != 0u
            && !behavior_target_matches_gameplay_tower(body_id)) {
            enter_enemy_core_fallback(body_id);
            return;
        }
        bind_behavior_target_to_gameplay_tower(body_id);
        disable_enemy_flow(body_id);
        let target_slot = tower_gameplay_target.target_slot;
        let to_target = physics.values[target_slot].position
            - physics.values[body_id].position;
        let distance_squared = dot(to_target, to_target);
        let windup_range = enemy_behavior_states.values[body_id].windup_range;
        if (distance_squared <= windup_range * windup_range) {
            physics.values[body_id].velocity = vec2f(0.0);
            atomicStore(
                &enemy_behavior_states.values[body_id].flags,
                ENEMY_BEHAVIOR_FLAG_TARGET_VALID
                    | ENEMY_BEHAVIOR_FLAG_TELEGRAPH_PENDING
            );
            set_enemy_behavior_state(
                body_id,
                ENEMY_BEHAVIOR_STATE_WINDUP,
                params.fixed_tick
                    + enemy_behavior_states.values[body_id].windup_ticks
            );
            return;
        }
        if (distance_squared > EPSILON_DISTANCE_SQUARED) {
            physics.values[body_id].velocity = to_target
                * inverseSqrt(distance_squared)
                * max(simulations.values[body_id].flow_speed, 0.0);
        } else {
            physics.values[body_id].velocity = vec2f(0.0);
        }
        return;
    }
    if (!behavior_target_matches_gameplay_tower(body_id)) {
        enter_enemy_core_fallback(body_id);
        return;
    }
    disable_enemy_flow(body_id);
    if (state == ENEMY_BEHAVIOR_STATE_WINDUP) {
        physics.values[body_id].velocity = vec2f(0.0);
        if (params.fixed_tick
            < enemy_behavior_states.values[body_id].state_expires_at_fixed_tick) {
            return;
        }
        let target_slot = enemy_behavior_states.values[body_id].target_slot;
        var direction = physics.values[target_slot].position
            - physics.values[body_id].position;
        let direction_squared = dot(direction, direction);
        if (direction_squared <= EPSILON_DISTANCE_SQUARED) {
            direction = deterministic_separation_normal(body_id, target_slot);
        } else {
            direction *= inverseSqrt(direction_squared);
        }
        enemy_behavior_states.values[body_id].charge_direction = direction;
        atomicStore(
            &enemy_behavior_states.values[body_id].flags,
            ENEMY_BEHAVIOR_FLAG_TARGET_VALID
        );
        physics.values[body_id].velocity = direction
            * enemy_behavior_states.values[body_id].charge_speed;
        set_enemy_behavior_state(
            body_id,
            ENEMY_BEHAVIOR_STATE_CHARGE,
            params.fixed_tick
                + enemy_behavior_states.values[body_id].charge_max_ticks
        );
        return;
    }
    if (state == ENEMY_BEHAVIOR_STATE_CHARGE) {
        if (params.fixed_tick
            >= enemy_behavior_states.values[body_id].state_expires_at_fixed_tick) {
            physics.values[body_id].velocity = vec2f(0.0);
            set_enemy_behavior_state(
                body_id,
                ENEMY_BEHAVIOR_STATE_RECOVER,
                params.fixed_tick
                    + enemy_behavior_states.values[body_id].recover_ticks
            );
            return;
        }
        physics.values[body_id].velocity
            = enemy_behavior_states.values[body_id].charge_direction
                * enemy_behavior_states.values[body_id].charge_speed;
        return;
    }
    if (state == ENEMY_BEHAVIOR_STATE_CONTACT_RECOIL) {
        if (params.fixed_tick
            >= enemy_behavior_states.values[body_id].state_expires_at_fixed_tick) {
            physics.values[body_id].velocity = vec2f(0.0);
            set_enemy_behavior_state(
                body_id,
                ENEMY_BEHAVIOR_STATE_RECOVER,
                params.fixed_tick
                    + enemy_behavior_states.values[body_id].recover_ticks
            );
        }
        return;
    }
    if (state == ENEMY_BEHAVIOR_STATE_RECOVER) {
        physics.values[body_id].velocity = vec2f(0.0);
        if (params.fixed_tick
            >= enemy_behavior_states.values[body_id].state_expires_at_fixed_tick) {
            set_enemy_behavior_state(
                body_id,
                ENEMY_BEHAVIOR_STATE_SEEK_TOWER,
                0u
            );
        }
        return;
    }
    enter_enemy_core_fallback(body_id);
}

@compute @workgroup_size(256)
fn prepare_bodies(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }
    let current = physics.values[body_id].position;
    var velocity = physics.values[body_id].velocity;
    let simulation_flags = load_simulation_flags(body_id);
    temporaries.values[body_id].previous_flow_field_index
        = simulations.values[body_id].flow_field_index;
    if (!body_is_alive(simulation_flags)) {
        temporaries.values[body_id].previous_position = current;
        temporaries.values[body_id].predicted_position = current;
        temporaries.values[body_id].position_delta = vec2f(0.0);
        temporaries.values[body_id].grid_index = -1;
        return;
    }
    let lifetime = simulations.values[body_id].lifetime;
    if (lifetime >= 0.0) {
        simulations.values[body_id].lifetime = max(lifetime - params.dt, 0.0);
    }
    if (params.flow_enabled != 0u
        && params.flow_field_count > 0u
        && body_has_flag(simulation_flags, BODY_FLAG_USE_FLOW)
        && !body_has_flag(simulation_flags, BODY_FLAG_CONTROLLED_THIS_TICK)
        && simulations.values[body_id].flow_field_index < params.flow_field_count) {
        let cell = flow_cell_for_position(current);
        var field_index = simulations.values[body_id].flow_field_index;
        var stage = params.flow_stages[field_index];
        var reached_final_goal = false;
        if (segment_intersects_transition_circle(
            temporaries.values[body_id].previous_position,
            current,
            stage.goal_position,
            stage.transition_radius
        )) {
            if (stage.next_field_index >= 0
                && u32(stage.next_field_index) < params.flow_field_count) {
                field_index = u32(stage.next_field_index);
                simulations.values[body_id].flow_field_index = field_index;
                stage = params.flow_stages[field_index];
            } else {
                reached_final_goal = true;
            }
        }

        if (reached_final_goal) {
            velocity = vec2f(0.0);
        } else {
            var direction = flow_direction(field_index, cell);
            if (abs(direction.x) < EPSILON_MASS && abs(direction.y) < EPSILON_MASS) {
                direction = stage.goal_position - current;
            }
            let direction_length = length(direction);
            if (direction_length >= EPSILON_MASS) {
                direction /= direction_length;
                let maximum_speed = max(simulations.values[body_id].flow_speed, 0.0);
                let adjustment_factor = min(params.dt, 1.0);
                velocity = mix(
                    velocity,
                    direction * maximum_speed,
                    vec2f(adjustment_factor)
                );
                let speed = length(velocity);
                if (speed > maximum_speed) {
                    velocity = (velocity / speed) * maximum_speed;
                }
            }
        }
    }
    if (velocity.x != velocity.x) {
        velocity.x = 0.0;
    }
    if (velocity.y != velocity.y) {
        velocity.y = 0.0;
    }
    temporaries.values[body_id].previous_position = current;
    temporaries.values[body_id].predicted_position = current;
    if (physics.values[body_id].inverse_mass > EPSILON_MASS) {
        temporaries.values[body_id].predicted_position = current
            + (velocity * params.dt);
    }
    temporaries.values[body_id].position_delta = vec2f(0.0);
    temporaries.values[body_id].grid_index = -1;
}

@compute @workgroup_size(256)
fn clear_grid(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let index = global_id.x;
    let total_bucket_count = grid_cell_total() * 2u;
    if (index < total_bucket_count) {
        atomicStore(&grid_counts.values[index], 0u);
    }
    if (index == 0u) {
        atomicStore(&grid_overflow.small_count, 0u);
        atomicStore(&grid_overflow.big_count, 0u);
    }
}

// Effect pulse/Formation 계열 capability가 movement 전의 exact tick-start world를
// 공유하도록 physics.position에서 기존 grid ABI를 재사용합니다.
@compute @workgroup_size(256)
fn build_tick_start_grid(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count || !body_id_is_alive(body_id)) {
        return;
    }
    let position = physics.values[body_id].position;
    let cell = vec2i(floor(position / params.grid_cell_size));
    if (cell.x < 0 || cell.y < 0
        || cell.x >= i32(params.grid_cell_count.x)
        || cell.y >= i32(params.grid_cell_count.y)) {
        return;
    }

    let body = physics.values[body_id];
    let grid_body = make_grid_body(body_id, position);
    let max_per_cell = params.max_bodies_per_cell;
    if (body_uses_small_grid(body.radius)) {
        let cell_index = (u32(cell.y) * params.grid_cell_count.x) + u32(cell.x);
        let counter_index = cell_index * 2u;
        let slot = atomicAdd(&grid_counts.values[counter_index], 1u);
        if (slot >= max_per_cell) {
            atomicAdd(&grid_overflow.small_count, 1u);
            atomicAdd(&grid_overflow.total_small_count, 1u);
            return;
        }
        let storage_index = (counter_index * max_per_cell) + slot;
        grid_bodies.values[storage_index] = grid_body;
        return;
    }

    let maximum_small_radius = 0.5
        * min(params.grid_cell_size.x, params.grid_cell_size.y);
    let padding = vec2f(body.radius + maximum_small_radius);
    let max_cell = vec2i(params.grid_cell_count) - vec2i(1);
    let min_covered = clamp(
        vec2i(floor((position - padding) / params.grid_cell_size)),
        vec2i(0),
        max_cell
    );
    let max_covered = clamp(
        vec2i(floor((position + padding) / params.grid_cell_size)),
        vec2i(0),
        max_cell
    );
    for (var y = min_covered.y; y <= max_covered.y; y += 1) {
        for (var x = min_covered.x; x <= max_covered.x; x += 1) {
            let cell_index = (u32(y) * params.grid_cell_count.x) + u32(x);
            let counter_index = (cell_index * 2u) + 1u;
            let slot = atomicAdd(&grid_counts.values[counter_index], 1u);
            if (slot >= max_per_cell) {
                atomicAdd(&grid_overflow.big_count, 1u);
                atomicAdd(&grid_overflow.total_big_count, 1u);
                continue;
            }
            grid_bodies.values[(counter_index * max_per_cell) + slot] = grid_body;
        }
    }
}

@compute @workgroup_size(256)
fn build_grid(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }

    temporaries.values[body_id].grid_index = -1;
    if (!body_id_is_alive(body_id)) {
        return;
    }
    let predicted = temporaries.values[body_id].predicted_position;
    let cell = vec2i(floor(predicted / params.grid_cell_size));
    if (cell.x < 0 || cell.y < 0
        || cell.x >= i32(params.grid_cell_count.x)
        || cell.y >= i32(params.grid_cell_count.y)) {
        return;
    }

    let body = physics.values[body_id];
    let grid_body = make_grid_body(body_id, predicted);
    let max_per_cell = params.max_bodies_per_cell;
    if (body_uses_small_grid(body.radius)) {
        let cell_index = (u32(cell.y) * params.grid_cell_count.x) + u32(cell.x);
        let counter_index = cell_index * 2u;
        let slot = atomicAdd(&grid_counts.values[counter_index], 1u);
        if (slot >= max_per_cell) {
            atomicAdd(&grid_overflow.small_count, 1u);
            atomicAdd(&grid_overflow.total_small_count, 1u);
            return;
        }
        let storage_index = (counter_index * max_per_cell) + slot;
        grid_bodies.values[storage_index] = grid_body;
        temporaries.values[body_id].grid_index = i32(storage_index);
        return;
    }

    let maximum_small_radius = 0.5
        * min(params.grid_cell_size.x, params.grid_cell_size.y);
    let padding = vec2f(body.radius + maximum_small_radius);
    let max_cell = vec2i(params.grid_cell_count) - vec2i(1);
    let min_covered = clamp(
        vec2i(floor((predicted - padding) / params.grid_cell_size)),
        vec2i(0),
        max_cell
    );
    let max_covered = clamp(
        vec2i(floor((predicted + padding) / params.grid_cell_size)),
        vec2i(0),
        max_cell
    );
    for (var y = min_covered.y; y <= max_covered.y; y += 1) {
        for (var x = min_covered.x; x <= max_covered.x; x += 1) {
            let cell_index = (u32(y) * params.grid_cell_count.x) + u32(x);
            let counter_index = (cell_index * 2u) + 1u;
            let slot = atomicAdd(&grid_counts.values[counter_index], 1u);
            if (slot >= max_per_cell) {
                atomicAdd(&grid_overflow.big_count, 1u);
                atomicAdd(&grid_overflow.total_big_count, 1u);
                continue;
            }
            grid_bodies.values[(counter_index * max_per_cell) + slot] = grid_body;
        }
    }
}

struct ContactSelection {
    found: u32,
    distance_squared: f32,
    contact: Contact,
}

fn empty_contact_selection() -> ContactSelection {
    return ContactSelection(
        0u,
        0.0,
        Contact(0u, 0u, -1, 0u, vec2f(0.0), vec2f(0.0))
    );
}

fn contact_handler_has_flag(flags: u32, flag: u32) -> bool {
    return (flags & flag) == flag;
}

fn contact_handler_has_interaction_policy(flags: u32) -> bool {
    let policy = flags & (
        CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY
        | CONTACT_HANDLER_FLAG_INTERACTION_CONTINUOUS
    );
    return policy == CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY
        || policy == CONTACT_HANDLER_FLAG_INTERACTION_CONTINUOUS;
}

fn interaction_policy_event_type(flags: u32) -> u32 {
    return select(
        APPLIED_EVENT_TYPE_INTERACTION_CONTINUOUS,
        APPLIED_EVENT_TYPE_INTERACTION_ENTER,
        contact_handler_has_flag(
            flags,
            CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY
        )
    );
}

fn interaction_policy_event_flag(flags: u32) -> u32 {
    return select(
        APPLIED_EVENT_FLAG_CONTINUOUS_POLICY,
        APPLIED_EVENT_FLAG_ENTER_POLICY,
        contact_handler_has_flag(
            flags,
            CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY
        )
    );
}

fn append_contact(contact: Contact) {
    let contact_index = atomicAdd(&contact_state.contact_count, 1u);
    if (contact_index >= params.max_contacts) {
        atomicAdd(&contact_state.contact_overflow, 1u);
        return;
    }
    contacts.values[contact_index] = contact;
}

fn mark_core_damage_request_candidate(contact_index: u32) {
    var marker_bits: u32 = CORE_DAMAGE_REQUEST_MARKER_MAGIC;
    contacts.values[contact_index].normal.y
        = bitcast<f32>(marker_bits);
}

fn contact_is_core_damage_request_candidate(contact: Contact) -> bool {
    return (bitcast<u32>(contact.normal.y)
            & CORE_DAMAGE_REQUEST_MARKER_MAGIC_MASK)
        == CORE_DAMAGE_REQUEST_MARKER_MAGIC;
}

fn directional_defense_flat_reduction(contact: Contact) -> i32 {
    if ((bitcast<u32>(contact.normal.y)
            & DIRECTIONAL_DEFENSE_MARKER_MAGIC_MASK)
        != DIRECTIONAL_DEFENSE_MARKER_MAGIC) {
        return 0;
    }
    return max(bitcast<i32>(contact.normal.x), 0);
}

fn selected_target_tower_marker_for_policy(policy_event_flag: u32) -> u32 {
    if (policy_event_flag == APPLIED_EVENT_FLAG_ENTER_POLICY) {
        return SELECTED_TARGET_TOWER_MARKER_MAGIC
            | MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_ENTER;
    }
    if (policy_event_flag == APPLIED_EVENT_FLAG_CONTINUOUS_POLICY) {
        return SELECTED_TARGET_TOWER_MARKER_MAGIC
            | MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_CONTINUOUS;
    }
    return 0u;
}

fn selected_target_tower_policy_from_marker(marker: u32) -> u32 {
    if ((marker & SELECTED_TARGET_TOWER_MARKER_MAGIC_MASK)
        != SELECTED_TARGET_TOWER_MARKER_MAGIC) {
        return 0u;
    }
    let policy = marker & MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_MASK;
    if (policy == MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_ENTER) {
        return APPLIED_EVENT_FLAG_ENTER_POLICY;
    }
    if (policy == MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_CONTINUOUS) {
        return APPLIED_EVENT_FLAG_CONTINUOUS_POLICY;
    }
    return 0u;
}

fn mark_selected_target_tower_candidate(
    contact_index: u32,
    final_damage: i32,
    policy_event_flag: u32
) {
    contacts.values[contact_index].normal = vec2f(
        bitcast<f32>(final_damage),
        bitcast<f32>(selected_target_tower_marker_for_policy(
            policy_event_flag
        ))
    );
}

fn consider_body_contact(
    self_body: GridBody,
    other_body: GridBody,
    closest_only: bool,
    suppress_previous_overlap: bool,
    selection: ContactSelection
) -> ContactSelection {
    if (self_body.body_id == other_body.body_id
        || !body_id_is_alive(other_body.body_id)) {
        return selection;
    }
    let self_mask = body_interaction_mask(self_body.interaction_meta);
    let self_layer = body_interaction_layer(self_body.interaction_meta);
    let other_mask = body_interaction_mask(other_body.interaction_meta);
    let other_layer = body_interaction_layer(other_body.interaction_meta);
    if ((self_mask & other_layer) == 0u
        || (other_mask & self_layer) == 0u) {
        return selection;
    }

    let delta = other_body.predicted_position - self_body.predicted_position;
    let distance_squared = dot(delta, delta);
    let minimum_distance = self_body.radius + other_body.radius;
    let minimum_distance_squared = minimum_distance * minimum_distance;
    if (distance_squared >= minimum_distance_squared) {
        return selection;
    }

    if (suppress_previous_overlap) {
        let previous_delta = temporaries.values[other_body.body_id].previous_position
            - temporaries.values[self_body.body_id].previous_position;
        if (dot(previous_delta, previous_delta) < minimum_distance_squared) {
            return selection;
        }
    }

    var normal = -deterministic_separation_normal(
        self_body.body_id,
        other_body.body_id
    );
    var distance = 0.0;
    if (distance_squared > EPSILON_DISTANCE_SQUARED) {
        let inverse_distance = inverseSqrt(distance_squared);
        normal = delta * inverse_distance;
        distance = distance_squared * inverse_distance;
    }
    let contact = Contact(
        self_body.body_id,
        simulations.values[self_body.body_id].incarnation,
        i32(other_body.body_id),
        simulations.values[other_body.body_id].incarnation,
        self_body.predicted_position + normal * (distance - other_body.radius),
        normal
    );
    if (!closest_only) {
        append_contact(contact);
        return selection;
    }
    if (selection.found == 0u
        || distance_squared < selection.distance_squared
        || (distance_squared == selection.distance_squared
            && other_body.body_id < u32(selection.contact.other_body_id))) {
        return ContactSelection(1u, distance_squared, contact);
    }
    return selection;
}

fn scan_contact_bucket(
    self_body: GridBody,
    bucket_offset: u32,
    bucket_count: u32,
    closest_only: bool,
    suppress_previous_overlap: bool,
    selection: ContactSelection
) -> ContactSelection {
    var result = selection;
    for (var index = 0u; index < bucket_count; index += 1u) {
        result = consider_body_contact(
            self_body,
            grid_bodies.values[bucket_offset + index],
            closest_only,
            suppress_previous_overlap,
            result
        );
    }
    return result;
}

fn scan_canonical_big_contact_bucket(
    self_body: GridBody,
    cell_index: u32,
    closest_only: bool,
    suppress_previous_overlap: bool,
    selection: ContactSelection
) -> ContactSelection {
    var result = selection;
    let count = min(
        atomicLoad(&grid_counts.values[(cell_index * 2u) + 1u]),
        params.max_bodies_per_cell
    );
    let offset = grid_bucket_offset(cell_index, 1u);
    for (var index = 0u; index < count; index += 1u) {
        let other_body = grid_bodies.values[offset + index];
        let center_cell = vec2i(floor(
            other_body.predicted_position / params.grid_cell_size
        ));
        if (center_cell.x < 0 || center_cell.y < 0
            || center_cell.x >= i32(params.grid_cell_count.x)
            || center_cell.y >= i32(params.grid_cell_count.y)) {
            continue;
        }
        let center_cell_index = u32(center_cell.y) * params.grid_cell_count.x
            + u32(center_cell.x);
        if (center_cell_index != cell_index) {
            continue;
        }
        result = consider_body_contact(
            self_body,
            other_body,
            closest_only,
            suppress_previous_overlap,
            result
        );
    }
    return result;
}

@compute @workgroup_size(1)
fn clear_contact_state() {
    atomicStore(&contact_state.contact_count, 0u);
    atomicStore(&contact_state.contact_overflow, 0u);
    atomicStore(&contact_state.event_count, 0u);
    atomicStore(&contact_state.event_overflow, 0u);
    atomicStore(&contact_state.death_count, 0u);
    atomicStore(&contact_state.death_overflow, 0u);
    atomicStore(&contact_state.maximum_damage_window_event_count, 0u);
    atomicStore(
        &contact_state.maximum_damage_window_protocol_status,
        MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_OK
    );
    atomicStore(&contact_state.core_damage_request_event_count, 0u);
    atomicStore(
        &contact_state.core_damage_request_protocol_status,
        CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_OK
    );
    atomicStore(
        &contact_state.abi_status,
        select(CONTACT_ABI_STATUS_MISMATCH, CONTACT_ABI_STATUS_OK, abi_is_current())
    );
    atomicStore(&contact_state.event_encoding_version, BODY_ABI_VERSION);
}

@compute @workgroup_size(256)
fn generate_body_contacts(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let self_body_id = global_id.x;
    if (self_body_id >= counts.body_count || !body_id_is_alive(self_body_id)) {
        return;
    }
    let self_physics = physics.values[self_body_id];
    let handler_flags = contact_handlers.values[self_body_id].flags;
    if (self_physics.radius <= 0.0
        || body_interaction_mask(self_physics.interaction_meta) == 0u
        || !contact_handler_has_interaction_policy(handler_flags)) {
        return;
    }
    let predicted = temporaries.values[self_body_id].predicted_position;
    let self_body = make_grid_body(self_body_id, predicted);
    let closest_only = contact_handler_has_flag(
        handler_flags,
        CONTACT_HANDLER_FLAG_CLOSEST_ONLY
    );
    let suppress_previous_overlap = contact_handler_has_flag(
        handler_flags,
        CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY
    );
    var selection = empty_contact_selection();

    if (body_uses_small_grid(self_physics.radius)) {
        let center = vec2i(floor(predicted / params.grid_cell_size));
        if (center.x < 0 || center.y < 0
            || center.x >= i32(params.grid_cell_count.x)
            || center.y >= i32(params.grid_cell_count.y)) {
            return;
        }
        for (var neighbor_index = 0u; neighbor_index < 9u; neighbor_index += 1u) {
            let neighbor = center + NEIGHBOR_OFFSETS[neighbor_index];
            if (neighbor.x < 0 || neighbor.y < 0
                || neighbor.x >= i32(params.grid_cell_count.x)
                || neighbor.y >= i32(params.grid_cell_count.y)) {
                continue;
            }
            let cell_index = u32(neighbor.y) * params.grid_cell_count.x
                + u32(neighbor.x);
            let count = min(
                atomicLoad(&grid_counts.values[cell_index * 2u]),
                params.max_bodies_per_cell
            );
            selection = scan_contact_bucket(
                self_body,
                grid_bucket_offset(cell_index, 0u),
                count,
                closest_only,
                suppress_previous_overlap,
                selection
            );
        }
        let center_index = u32(center.y) * params.grid_cell_count.x + u32(center.x);
        let big_count = min(
            atomicLoad(&grid_counts.values[(center_index * 2u) + 1u]),
            params.max_bodies_per_cell
        );
        selection = scan_contact_bucket(
            self_body,
            grid_bucket_offset(center_index, 1u),
            big_count,
            closest_only,
            suppress_previous_overlap,
            selection
        );
    } else {
        let interaction_radius = self_physics.radius
            + max(params.maximum_body_radius, 0.0);
        let raw_min = vec2i(floor(
            (predicted - vec2f(interaction_radius)) / params.grid_cell_size
        ));
        let raw_max = vec2i(floor(
            (predicted + vec2f(interaction_radius)) / params.grid_cell_size
        ));
        if (raw_max.x < 0 || raw_max.y < 0
            || raw_min.x >= i32(params.grid_cell_count.x)
            || raw_min.y >= i32(params.grid_cell_count.y)) {
            return;
        }
        let maximum_cell = vec2i(params.grid_cell_count) - vec2i(1);
        let minimum_covered = clamp(raw_min, vec2i(0), maximum_cell);
        let maximum_covered = clamp(raw_max, vec2i(0), maximum_cell);
        for (var y = minimum_covered.y; y <= maximum_covered.y; y += 1) {
            for (var x = minimum_covered.x; x <= maximum_covered.x; x += 1) {
                let cell_index = u32(y) * params.grid_cell_count.x + u32(x);
                let small_count = min(
                    atomicLoad(&grid_counts.values[cell_index * 2u]),
                    params.max_bodies_per_cell
                );
                selection = scan_contact_bucket(
                    self_body,
                    grid_bucket_offset(cell_index, 0u),
                    small_count,
                    closest_only,
                    suppress_previous_overlap,
                    selection
                );
                selection = scan_canonical_big_contact_bucket(
                    self_body,
                    cell_index,
                    closest_only,
                    suppress_previous_overlap,
                    selection
                );
            }
        }
    }
    if (closest_only && selection.found != 0u) {
        append_contact(selection.contact);
    }
}

fn sdf_value_at(texel: vec2i) -> f32 {
    let clamped = clamp(texel, vec2i(0), vec2i(params.sdf_size) - vec2i(1));
    let index = (u32(clamped.y) * params.sdf_size.x) + u32(clamped.x);
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
    return min(
        sample_terrain_sdf(world_position),
        world_boundary_sdf(world_position)
    );
}

fn world_contact_normal(body_id: u32, predicted: vec2f) -> vec2f {
    let gradient_step = max(params.source_world_unit_scale, 0.0001);
    var normal = vec2f(
        sample_world_sdf(predicted + vec2f(gradient_step, 0.0))
            - sample_world_sdf(predicted - vec2f(gradient_step, 0.0)),
        sample_world_sdf(predicted + vec2f(0.0, gradient_step))
            - sample_world_sdf(predicted - vec2f(0.0, gradient_step))
    );
    let normal_length = length(normal);
    if (normal_length >= EPSILON_MASS) {
        return normal / normal_length;
    }
    let center_delta = (params.world_size * 0.5) - predicted;
    let center_distance = length(center_delta);
    if (center_distance >= EPSILON_MASS) {
        return center_delta / center_distance;
    }
    let entity_id = simulations.values[body_id].entity_id;
    return select(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), (entity_id & 1u) == 0u);
}

@compute @workgroup_size(256)
fn generate_world_contacts(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || params.sdf_enabled == 0u
        || !body_id_is_alive(body_id)) {
        return;
    }
    let body = physics.values[body_id];
    let simulation_flags = load_simulation_flags(body_id);
    if ((body_interaction_mask(body.interaction_meta) & BODY_LAYER_TERRAIN) == 0u
        || ((simulation_flags & (
            BODY_FLAG_INTERACTION_ENTER_ONLY
            | BODY_FLAG_INTERACTION_CONTINUOUS
        )) == 0u)) {
        return;
    }
    let predicted = temporaries.values[body_id].predicted_position;
    let previous = temporaries.values[body_id].previous_position;
    let penetration = body.radius - sample_world_sdf(predicted);
    let previous_penetration = body.radius - sample_world_sdf(previous);
    let suppress_previous_overlap = (
        simulation_flags & BODY_FLAG_INTERACTION_ENTER_ONLY
    ) != 0u;
    if (penetration <= 0.0
        || (suppress_previous_overlap && previous_penetration > 0.0)) {
        return;
    }
    let normal = world_contact_normal(body_id, predicted);
    append_contact(Contact(
        body_id,
        simulations.values[body_id].incarnation,
        -1,
        0u,
        predicted + normal * penetration,
        normal
    ));
}

@compute @workgroup_size(256)
fn classify_directional_defense_contacts(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u) {
        return;
    }
    let contact_index = global_id.x;
    let contact_count = min(
        atomicLoad(&contact_state.contact_count),
        params.max_contacts
    );
    if (contact_index >= contact_count) {
        return;
    }
    let contact = contacts.values[contact_index];
    if (contact.other_body_id < 0) {
        return;
    }
    let source_body_id = contact.self_body_id;
    let target_body_id = u32(contact.other_body_id);
    if (source_body_id >= counts.body_count
        || target_body_id >= counts.body_count
        || source_body_id == target_body_id
        || simulations.values[source_body_id].incarnation
            != contact.self_incarnation
        || simulations.values[target_body_id].incarnation
            != contact.other_incarnation
        || !body_id_is_alive(source_body_id)
        || !body_id_is_alive(target_body_id)
        || enemy_behavior_states.values[target_body_id].program_id
            != ENEMY_BEHAVIOR_PROGRAM_OCTAGON_TOWER_ORBIT
        || atomicLoad(&enemy_behavior_states.values[target_body_id].state)
            != ENEMY_BEHAVIOR_STATE_ORBIT_TOWER
        || !octagon_orbit_config_is_valid(target_body_id)
        || !behavior_target_matches_gameplay_tower(target_body_id)) {
        return;
    }
    let target_flags = atomicLoad(
        &enemy_behavior_states.values[target_body_id].flags
    );
    if ((target_flags & (
            ENEMY_BEHAVIOR_FLAG_TARGET_VALID
            | ENEMY_BEHAVIOR_FLAG_DIRECTIONAL_DEFENSE_ACTIVE
        )) != (
            ENEMY_BEHAVIOR_FLAG_TARGET_VALID
            | ENEMY_BEHAVIOR_FLAG_DIRECTIONAL_DEFENSE_ACTIVE
        )) {
        return;
    }
    // Contact generation substitutes an identity-derived unit normal for an exact
    // center overlap. Directional defense must instead honor the authored
    // zero-direction policy from the same predicted positions used by the grid.
    let incoming_delta = temporaries.values[source_body_id].predicted_position
        - temporaries.values[target_body_id].predicted_position;
    let incoming_distance_squared = dot(incoming_delta, incoming_delta);
    let facing = enemy_behavior_states.values[target_body_id].charge_direction;
    let facing_length_squared = dot(facing, facing);
    if (incoming_distance_squared <= EPSILON_DISTANCE_SQUARED
        || facing_length_squared <= EPSILON_DISTANCE_SQUARED) {
        return;
    }
    let incoming_direction = incoming_delta
        * inverseSqrt(incoming_distance_squared);
    let target_facing = facing * inverseSqrt(facing_length_squared);
    let facet_config = enemy_behavior_states.values[target_body_id]
        .telegraph_color_rgba8;
    let armored_facet_count = facet_config & 65535u;
    let total_facet_count = (facet_config >> 16u) & 65535u;
    let armored_half_angle = 3.141592653589793
        * f32(armored_facet_count)
        / f32(total_facet_count);
    if (dot(target_facing, incoming_direction) < cos(armored_half_angle)) {
        return;
    }
    let flat_reduction = bitcast<i32>(
        enemy_behavior_states.values[target_body_id].telegraph_style_code
    );
    contacts.values[contact_index].normal = vec2f(
        bitcast<f32>(flat_reduction),
        bitcast<f32>(DIRECTIONAL_DEFENSE_MARKER_MAGIC)
    );
}

struct DamageResult {
    applied: i32,
    target_died: u32,
}

fn reserve_self_hit_budget(body_id: u32, amount: i32) -> bool {
    if (amount <= 0) {
        return true;
    }
    loop {
        let health_before = atomicLoad(&simulations.values[body_id].health);
        if (health_before < amount) {
            return false;
        }
        let reservation = atomicCompareExchangeWeak(
            &simulations.values[body_id].health,
            health_before,
            health_before - amount
        );
        if (reservation.exchanged) {
            return true;
        }
    }
}

fn apply_target_damage(body_id: u32, amount: i32) -> DamageResult {
    if (amount <= 0) {
        return DamageResult(0, 0u);
    }
    loop {
        let health_before = atomicLoad(&simulations.values[body_id].health);
        if (health_before <= 0) {
            return DamageResult(0, 1u);
        }
        let applied_amount = min(health_before, amount);
        let health_after = health_before - applied_amount;
        let exchange = atomicCompareExchangeWeak(
            &simulations.values[body_id].health,
            health_before,
            health_after
        );
        if (exchange.exchanged) {
            return DamageResult(
                applied_amount,
                select(0u, 1u, health_after == 0)
            );
        }
    }
}

fn clear_alive_once(body_id: u32) -> bool {
    let alive_bit = BODY_FLAG_ALIVE;
    let previous_meta = atomicAnd(
        &simulations.values[body_id].flags,
        ~alive_bit
    );
    return (previous_meta & alive_bit) != 0u;
}

fn append_applied_event(event: AppliedEvent) {
    let event_index = atomicAdd(&contact_state.event_count, 1u);
    if (event_index >= params.max_events) {
        atomicAdd(&contact_state.event_overflow, 1u);
        return;
    }
    applied_events.values[event_index] = event;
}

fn append_death_event(body_id: u32, reason_flags: u32) {
    let death_index = atomicAdd(&contact_state.death_count, 1u);
    if (death_index >= params.max_death_events) {
        atomicAdd(&contact_state.death_overflow, 1u);
        return;
    }
    death_events.values[death_index] = DeathEvent(
        simulations.values[body_id].entity_id,
        simulations.values[body_id].incarnation,
        body_id,
        reason_flags
    );
}

fn contact_handler_accepts_target(self_body_id: u32, other_body_id: u32) -> bool {
    let target_interaction_layer = body_interaction_layer(
        physics.values[other_body_id].interaction_meta
    );
    let target_mask = combat_states.values[self_body_id]
        .target_interaction_layer_mask;
    return target_mask != 0u
        && (target_mask & target_interaction_layer) != 0u;
}

fn resolve_contact_source_modified_damage(
    self_body_id: u32,
    contact: Contact,
    handler: ContactHandler
) -> i32 {
    var source_modified_damage = handler.damage_other;
    if (handler.damage_falloff > 0.0) {
        let self_radius = physics.values[self_body_id].radius;
        if (self_radius > EPSILON_MASS) {
            let distance_from_self = length(
                contact.world_position - physics.values[self_body_id].position
            );
            let falloff_t = clamp(distance_from_self / self_radius, 0.0, 1.0);
            source_modified_damage *= 1.0 - pow(falloff_t, handler.damage_falloff);
        }
    }
    return max(i32(source_modified_damage * 100.0), 0);
}

fn resolve_contact_target_mitigation(
    contact: Contact,
    source_modified_damage: i32
) -> i32 {
    return max(
        source_modified_damage - directional_defense_flat_reduction(contact),
        0
    );
}

fn mark_maximum_damage_window_candidate(
    contact_index: u32,
    final_damage: i32,
    policy_event_flag: u32
) {
    // handle_contacts 뒤에는 contact.normal을 physical solve가 읽지 않습니다. 따라서
    // final damage와 quiet-NaN namespace marker를 이 tick 한정으로 재사용해 window
    // pass가 contact-handler storage를 추가로 bind하지 않게 합니다.
    let policy_marker = maximum_damage_window_marker_for_policy(policy_event_flag);
    contacts.values[contact_index].normal = vec2f(
        bitcast<f32>(final_damage),
        bitcast<f32>(policy_marker)
    );
}

fn maximum_damage_window_marker_for_policy(policy_event_flag: u32) -> u32 {
    if (policy_event_flag == APPLIED_EVENT_FLAG_ENTER_POLICY) {
        return MAXIMUM_DAMAGE_WINDOW_MARKER_MAGIC
            | MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_ENTER;
    }
    if (policy_event_flag == APPLIED_EVENT_FLAG_CONTINUOUS_POLICY) {
        return MAXIMUM_DAMAGE_WINDOW_MARKER_MAGIC
            | MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_CONTINUOUS;
    }
    return 0u;
}

fn maximum_damage_window_policy_from_marker(marker: u32) -> u32 {
    if ((marker & MAXIMUM_DAMAGE_WINDOW_MARKER_MAGIC_MASK)
        != MAXIMUM_DAMAGE_WINDOW_MARKER_MAGIC) {
        return 0u;
    }
    let policy = marker & MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_MASK;
    if (policy == MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_ENTER) {
        return APPLIED_EVENT_FLAG_ENTER_POLICY;
    }
    if (policy == MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_CONTINUOUS) {
        return APPLIED_EVENT_FLAG_CONTINUOUS_POLICY;
    }
    return 0u;
}

struct MaximumDamageWindowCandidate {
    found: u32,
    final_damage: i32,
    source_entity_id: u32,
    source_incarnation: u32,
    policy_event_flag: u32,
}

fn empty_maximum_damage_window_candidate() -> MaximumDamageWindowCandidate {
    return MaximumDamageWindowCandidate(
        0u,
        0,
        INVALID_IDENTITY_COMPONENT,
        INVALID_IDENTITY_COMPONENT,
        0u
    );
}

fn maximum_damage_window_candidate_is_better(
    candidate: MaximumDamageWindowCandidate,
    current: MaximumDamageWindowCandidate
) -> bool {
    return current.found == 0u
        || candidate.final_damage > current.final_damage
        || (candidate.final_damage == current.final_damage
            && (candidate.source_entity_id < current.source_entity_id
                || (candidate.source_entity_id == current.source_entity_id
                    && candidate.source_incarnation < current.source_incarnation)));
}

fn find_maximum_damage_window_candidate(
    target_body_id: u32
) -> MaximumDamageWindowCandidate {
    var result = empty_maximum_damage_window_candidate();
    let contact_count = min(
        atomicLoad(&contact_state.contact_count),
        params.max_contacts
    );
    for (var contact_index = 0u;
        contact_index < contact_count;
        contact_index += 1u) {
        let contact = contacts.values[contact_index];
        let marker = bitcast<u32>(contact.normal.y);
        var policy_event_flag = maximum_damage_window_policy_from_marker(marker);
        if (policy_event_flag == 0u) {
            policy_event_flag = selected_target_tower_policy_from_marker(marker);
            if (policy_event_flag == 0u
                || !selected_target_tower_candidate_is_valid(contact)) {
                continue;
            }
        }
        if (policy_event_flag == 0u
            || contact.other_body_id < 0
            || u32(contact.other_body_id) != target_body_id
            || contact.other_incarnation
                != simulations.values[target_body_id].incarnation) {
            continue;
        }
        let source_body_id = contact.self_body_id;
        if (source_body_id >= counts.body_count
            || simulations.values[source_body_id].incarnation
                != contact.self_incarnation) {
            continue;
        }
        let final_damage = bitcast<i32>(contact.normal.x);
        if (final_damage <= 0) {
            continue;
        }
        let candidate = MaximumDamageWindowCandidate(
            1u,
            final_damage,
            simulations.values[source_body_id].entity_id,
            contact.self_incarnation,
            policy_event_flag
        );
        if (maximum_damage_window_candidate_is_better(candidate, result)) {
            result = candidate;
        }
    }
    return result;
}

fn maximum_damage_window_target_is_configured(body_id: u32) -> bool {
    return gameplay_damage_resolution_policy_id(
        simulations.values[body_id].gameplay_meta
    ) == GAMEPLAY_DAMAGE_RESOLUTION_POLICY_MAXIMUM_DAMAGE_WINDOW;
}

fn clear_maximum_damage_window_state(body_id: u32) {
    atomicStore(
        &combat_states.values[body_id].peak_final_damage_fixed_point,
        0
    );
    atomicStore(&combat_states.values[body_id].expires_at_fixed_tick, 0u);
    atomicStore(
        &combat_states.values[body_id].peak_source_entity_id,
        INVALID_IDENTITY_COMPONENT
    );
    atomicStore(
        &combat_states.values[body_id].peak_source_incarnation,
        INVALID_IDENTITY_COMPONENT
    );
}

fn maximum_damage_window_tick_is_representable(duration: u32) -> bool {
    return duration > 0u && params.fixed_tick <= (0xffffffffu - duration);
}

@compute @workgroup_size(256)
fn preflight_maximum_damage_window(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u
        || atomicLoad(&contact_state.event_overflow) != 0u
        || atomicLoad(&contact_state.maximum_damage_window_protocol_status)
            != MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_OK) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || !body_id_is_alive(body_id)
        || !maximum_damage_window_target_is_configured(body_id)) {
        return;
    }
    let duration = combat_states.values[body_id]
        .maximum_damage_window_duration_fixed_ticks;
    let expires_at_fixed_tick = atomicLoad(
        &combat_states.values[body_id].expires_at_fixed_tick
    );
    let window_is_active = params.fixed_tick < expires_at_fixed_tick;
    if (!window_is_active
        && !maximum_damage_window_tick_is_representable(duration)) {
        atomicStore(
            &contact_state.maximum_damage_window_protocol_status,
            MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_FAILURE
        );
        return;
    }
    let candidate = find_maximum_damage_window_candidate(body_id);
    if (candidate.found == 0u) {
        return;
    }
    // 유효 winner는 delta가 0이어도 exact provenance의 DAMAGE_APPLIED fact를 남긴다.
    if (atomicLoad(&simulations.values[body_id].health) > 0) {
        atomicAdd(&contact_state.maximum_damage_window_event_count, 1u);
    }
}

// preflight의 body-parallel count가 모두 끝난 뒤 단 한 invocation이 global event
// capacity를 확정합니다. resolver는 이 barrier 뒤에는 HP/window만 mutate하므로
// 여러 Tower가 같은 tick에 있어도 late failure가 부분 mutation을 만들 수 없습니다.
@compute @workgroup_size(1)
fn finalize_maximum_damage_window_preflight() {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u
        || atomicLoad(&contact_state.event_overflow) != 0u
        || atomicLoad(&contact_state.maximum_damage_window_protocol_status)
            != MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_OK) {
        atomicStore(
            &contact_state.maximum_damage_window_protocol_status,
            MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_FAILURE
        );
        return;
    }
    let existing_event_count = atomicLoad(&contact_state.event_count);
    let maximum_damage_window_event_count = atomicLoad(
        &contact_state.maximum_damage_window_event_count
    );
    let core_damage_request_event_count = atomicLoad(
        &contact_state.core_damage_request_event_count
    );
    if (maximum_damage_window_event_count > params.max_events
        || core_damage_request_event_count
            > params.max_events - maximum_damage_window_event_count
        || existing_event_count > params.max_events
            - maximum_damage_window_event_count
            - core_damage_request_event_count) {
        atomicStore(
            &contact_state.maximum_damage_window_protocol_status,
            MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_FAILURE
        );
        atomicStore(
            &contact_state.core_damage_request_protocol_status,
            CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_FAILURE
        );
        atomicAdd(&contact_state.event_overflow, 1u);
    }
}

@compute @workgroup_size(256)
fn resolve_maximum_damage_window(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u
        || atomicLoad(&contact_state.event_overflow) != 0u
        || atomicLoad(&contact_state.maximum_damage_window_protocol_status)
            != MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_OK) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || !body_id_is_alive(body_id)
        || !maximum_damage_window_target_is_configured(body_id)) {
        return;
    }
    let duration = combat_states.values[body_id]
        .maximum_damage_window_duration_fixed_ticks;
    let expires_at_fixed_tick = atomicLoad(
        &combat_states.values[body_id].expires_at_fixed_tick
    );
    let window_is_active = params.fixed_tick < expires_at_fixed_tick;
    if (!window_is_active) {
        clear_maximum_damage_window_state(body_id);
    }
    let candidate = find_maximum_damage_window_candidate(body_id);
    if (candidate.found == 0u) {
        return;
    }
    if (atomicLoad(&simulations.values[body_id].health) <= 0) {
        return;
    }
    let current_peak = select(
        0,
        atomicLoad(&combat_states.values[body_id].peak_final_damage_fixed_point),
        window_is_active
    );
    let requested_damage = select(
        candidate.final_damage,
        max(candidate.final_damage - current_peak, 0),
        window_is_active
    );
    if (!window_is_active) {
        atomicStore(
            &combat_states.values[body_id].peak_final_damage_fixed_point,
            candidate.final_damage
        );
        atomicStore(
            &combat_states.values[body_id].expires_at_fixed_tick,
            params.fixed_tick + duration
        );
        atomicStore(
            &combat_states.values[body_id].peak_source_entity_id,
            candidate.source_entity_id
        );
        atomicStore(
            &combat_states.values[body_id].peak_source_incarnation,
            candidate.source_incarnation
        );
    } else if (candidate.final_damage > current_peak) {
        // Maximum Damage Window는 최초 active 시작 N+duration에 고정된다.
        // 더 큰 peak/provenance는 갱신하되 expiry를 T+duration으로 연장하지 않는다.
        atomicStore(
            &combat_states.values[body_id].peak_final_damage_fixed_point,
            candidate.final_damage
        );
        atomicStore(
            &combat_states.values[body_id].peak_source_entity_id,
            candidate.source_entity_id
        );
        atomicStore(
            &combat_states.values[body_id].peak_source_incarnation,
            candidate.source_incarnation
        );
    }
    let damage = apply_target_damage(body_id, requested_damage);
    let target_died_flag = select(
        0u,
        APPLIED_EVENT_FLAG_TARGET_DIED,
        damage.target_died != 0u
    );
    append_applied_event(AppliedEvent(
        candidate.source_entity_id,
        candidate.source_incarnation,
        simulations.values[body_id].entity_id,
        simulations.values[body_id].incarnation,
        damage.applied,
        APPLIED_EVENT_TYPE_DAMAGE_APPLIED
            | candidate.policy_event_flag
            | APPLIED_EVENT_FLAG_MAXIMUM_DAMAGE_WINDOW
            | target_died_flag,
        physics.values[body_id].position
    ));
}

@compute @workgroup_size(256)
fn handle_contacts(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    if (atomicLoad(&contact_state.contact_overflow) != 0u) {
        return;
    }
    let contact_index = global_id.x;
    let contact_count = min(
        atomicLoad(&contact_state.contact_count),
        params.max_contacts
    );
    if (contact_index >= contact_count) {
        return;
    }
    let contact = contacts.values[contact_index];
    let self_body_id = contact.self_body_id;
    if (self_body_id >= counts.body_count
        || simulations.values[self_body_id].incarnation != contact.self_incarnation
        || !body_id_is_alive(self_body_id)) {
        return;
    }
    let handler = contact_handlers.values[self_body_id];
    if (!contact_handler_has_interaction_policy(handler.flags)) {
        return;
    }
    let policy_event_type = interaction_policy_event_type(handler.flags);
    let policy_event_flag = interaction_policy_event_flag(handler.flags);

    if (contact.other_body_id < 0) {
        if (contact.other_body_id != -1) {
            return;
        }
        let kill_on_terrain = contact_handler_has_flag(
            handler.flags,
            CONTACT_HANDLER_FLAG_KILL_IF_OTHER_TERRAIN
        );
        if (kill_on_terrain && !clear_alive_once(self_body_id)) {
            return;
        }
        append_applied_event(AppliedEvent(
            simulations.values[self_body_id].entity_id,
            contact.self_incarnation,
            0u,
            0u,
            0,
            policy_event_type
                | policy_event_flag
                | APPLIED_EVENT_FLAG_TERRAIN_CONTACT
                | select(0u, APPLIED_EVENT_FLAG_TERRAIN_KILL, kill_on_terrain),
            contact.world_position
        ));
        if (kill_on_terrain) {
            append_death_event(self_body_id, DEATH_EVENT_FLAG_HEALTH);
        }
        return;
    }

    let other_body_id = u32(contact.other_body_id);
    if (other_body_id >= counts.body_count
        || other_body_id == self_body_id
        || simulations.values[other_body_id].incarnation != contact.other_incarnation
        || !body_id_is_alive(other_body_id)) {
        return;
    }
    if (body_interaction_layer(physics.values[self_body_id].interaction_meta)
            == BODY_LAYER_CORE_PROXY
        && body_interaction_layer(physics.values[other_body_id].interaction_meta)
            == BODY_LAYER_PROJECTILE
        && contact_handler_has_flag(
            contact_handlers.values[other_body_id].flags,
            CONTACT_HANDLER_FLAG_CORE_DAMAGE_REQUEST
        )) {
        // Projectile 방향의 typed request만 event authority를 갖습니다.
        return;
    }
    if (contact_handler_has_flag(
            handler.flags,
            CONTACT_HANDLER_FLAG_CORE_DAMAGE_REQUEST
        ) && body_interaction_layer(
            physics.values[other_body_id].interaction_meta
        ) == BODY_LAYER_CORE_PROXY) {
        // 전용 pass가 exact selected target/team/policy/budget/event capacity를
        // 모두 검증한 뒤 mutation하므로 generic handler에서는 marker만 남깁니다.
        mark_core_damage_request_candidate(contact_index);
        return;
    }
    if (contact_handler_has_flag(
            handler.flags,
            CONTACT_HANDLER_FLAG_CORE_DAMAGE_REQUEST
        ) && body_interaction_layer(
            physics.values[other_body_id].interaction_meta
        ) == BODY_LAYER_PLAYER_DAMAGEABLE) {
        // Tower 후보는 여기서 program state를 읽지 않고 marker만 남깁니다.
        // 전용 <=9-storage pass가 program/team/identity/policy/budget을 exact
        // 검증한 뒤에만 standard window marker로 승격합니다.
        mark_selected_target_tower_candidate(
            contact_index,
            resolve_contact_source_modified_damage(
                self_body_id,
                contact,
                handler
            ),
            policy_event_flag
        );
        return;
    }
    let damage_self = max(i32(handler.damage_self * 100.0), 0);
    let source_modified_damage = resolve_contact_source_modified_damage(
        self_body_id,
        contact,
        handler
    );
    if (source_modified_damage <= 0) {
        append_applied_event(AppliedEvent(
            simulations.values[self_body_id].entity_id,
            contact.self_incarnation,
            simulations.values[other_body_id].entity_id,
            contact.other_incarnation,
            0,
            policy_event_type | policy_event_flag,
            contact.world_position
        ));
        return;
    }

    if (!contact_handler_accepts_target(self_body_id, other_body_id)) {
        append_applied_event(AppliedEvent(
            simulations.values[self_body_id].entity_id,
            contact.self_incarnation,
            simulations.values[other_body_id].entity_id,
            contact.other_incarnation,
            0,
            policy_event_type | policy_event_flag,
            contact.world_position
        ));
        return;
    }

    if (!gameplay_damage_is_allowed(
        simulations.values[self_body_id].gameplay_meta,
        simulations.values[other_body_id].gameplay_meta
    )) {
        append_applied_event(AppliedEvent(
            simulations.values[self_body_id].entity_id,
            contact.self_incarnation,
            simulations.values[other_body_id].entity_id,
            contact.other_incarnation,
            0,
            policy_event_type | policy_event_flag,
            contact.world_position
        ));
        return;
    }

    let self_budget_reserved = reserve_self_hit_budget(
        self_body_id,
        damage_self
    );
    if (!self_budget_reserved) {
        return;
    }
    let directional_flat_reduction = directional_defense_flat_reduction(contact);
    let final_damage = resolve_contact_target_mitigation(
        contact,
        source_modified_damage
    );
    let directional_defense_event_flag = select(
        0u,
        APPLIED_EVENT_FLAG_DIRECTIONAL_DEFENSE,
        directional_flat_reduction > 0
    );
    if (final_damage <= 0) {
        // Valid fully absorbed hits consume the source/self budget and remain observable.
        append_applied_event(AppliedEvent(
            simulations.values[self_body_id].entity_id,
            contact.self_incarnation,
            simulations.values[other_body_id].entity_id,
            contact.other_incarnation,
            0,
            APPLIED_EVENT_TYPE_DAMAGE_APPLIED
                | policy_event_flag
                | directional_defense_event_flag,
            contact.world_position
        ));
        return;
    }
    if (gameplay_damage_resolution_policy_id(
            simulations.values[other_body_id].gameplay_meta
        ) == GAMEPLAY_DAMAGE_RESOLUTION_POLICY_MAXIMUM_DAMAGE_WINDOW) {
        // Valid hit의 source budget은 이미 reserve되어 window가 0을 적용해도 소모됩니다.
        mark_maximum_damage_window_candidate(
            contact_index,
            final_damage,
            policy_event_flag
        );
        return;
    }
    let damage = apply_target_damage(other_body_id, final_damage);
    if (damage.applied <= 0) {
        if (damage_self > 0) {
            atomicAdd(&simulations.values[self_body_id].health, damage_self);
        }
        return;
    }

    let target_died_flag = select(
        0u,
        APPLIED_EVENT_FLAG_TARGET_DIED,
        damage.target_died != 0u
    );
    append_applied_event(AppliedEvent(
        simulations.values[self_body_id].entity_id,
        contact.self_incarnation,
        simulations.values[other_body_id].entity_id,
        contact.other_incarnation,
        damage.applied,
        APPLIED_EVENT_TYPE_DAMAGE_APPLIED
            | policy_event_flag
            | directional_defense_event_flag
            | target_died_flag,
        contact.world_position
    ));
}

fn core_damage_request_candidate_is_valid(contact: Contact) -> bool {
    if (!contact_is_core_damage_request_candidate(contact)
        || contact.other_body_id < 0) {
        return false;
    }
    let self_body_id = contact.self_body_id;
    let other_body_id = u32(contact.other_body_id);
    if (self_body_id >= counts.body_count
        || other_body_id >= counts.body_count
        || self_body_id == other_body_id
        || simulations.values[self_body_id].incarnation
            != contact.self_incarnation
        || simulations.values[other_body_id].incarnation
            != contact.other_incarnation
        || !body_id_is_alive(self_body_id)
        || !body_id_is_alive(other_body_id)) {
        return false;
    }
    let handler = contact_handlers.values[self_body_id];
    let required_handler_flags = CONTACT_HANDLER_FLAG_CORE_DAMAGE_REQUEST
        | CONTACT_HANDLER_FLAG_CLOSEST_ONLY
        | CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY;
    if ((handler.flags & required_handler_flags) != required_handler_flags
        || (handler.flags & CONTACT_HANDLER_FLAG_INTERACTION_CONTINUOUS) != 0u
        || body_interaction_layer(
            physics.values[self_body_id].interaction_meta
        ) != BODY_LAYER_PROJECTILE
        || body_interaction_layer(
            physics.values[other_body_id].interaction_meta
        ) != BODY_LAYER_CORE_PROXY
        || combat_states.values[self_body_id].target_interaction_layer_mask
            != BODY_LAYER_CORE_PROXY
        || gameplay_team_id(simulations.values[self_body_id].gameplay_meta)
            != GAMEPLAY_TEAM_HOSTILE
        || enemy_behavior_states.values[self_body_id].program_id
            != ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE) {
        return false;
    }
    let selected_flags = atomicLoad(
        &enemy_behavior_states.values[self_body_id].flags
    );
    if (atomicLoad(&enemy_behavior_states.values[self_body_id].state)
            != BODY_CONTROL_SELECTED_TARGET_CORE
        || (selected_flags & (
            ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_VALID
            | ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_CORE
        )) != (
            ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_VALID
            | ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_CORE
        )
        || (selected_flags & ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_TOWER) != 0u
        || enemy_behavior_states.values[self_body_id].target_slot
            != other_body_id
        || enemy_behavior_states.values[self_body_id].target_entity_id
            != simulations.values[other_body_id].entity_id
        || enemy_behavior_states.values[self_body_id].target_incarnation
            != contact.other_incarnation
        || enemy_behavior_states.values[self_body_id].state_entered_fixed_tick
            == 0u
        || bitcast<u32>(enemy_behavior_states.values[self_body_id]
            .charge_direction.x) == 0u
        || bitcast<i32>(enemy_behavior_states.values[self_body_id].windup_range)
            <= 0) {
        return false;
    }
    let damage_self = max(i32(handler.damage_self * 100.0), 0);
    return damage_self > 0
        && atomicLoad(&simulations.values[self_body_id].health) >= damage_self;
}

fn selected_target_tower_candidate_is_valid(contact: Contact) -> bool {
    let policy_event_flag = selected_target_tower_policy_from_marker(
        bitcast<u32>(contact.normal.y)
    );
    if (policy_event_flag == 0u || contact.other_body_id < 0) {
        return false;
    }
    let self_body_id = contact.self_body_id;
    let other_body_id = u32(contact.other_body_id);
    if (self_body_id >= counts.body_count
        || other_body_id >= counts.body_count
        || self_body_id == other_body_id
        || simulations.values[self_body_id].incarnation
            != contact.self_incarnation
        || simulations.values[other_body_id].incarnation
            != contact.other_incarnation
        || !body_id_is_alive(self_body_id)
        || !body_id_is_alive(other_body_id)) {
        return false;
    }
    let handler = contact_handlers.values[self_body_id];
    let required_handler_flags = CONTACT_HANDLER_FLAG_CORE_DAMAGE_REQUEST
        | CONTACT_HANDLER_FLAG_CLOSEST_ONLY
        | CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY;
    if ((handler.flags & required_handler_flags) != required_handler_flags
        || (handler.flags & CONTACT_HANDLER_FLAG_INTERACTION_CONTINUOUS) != 0u
        || body_interaction_layer(
            physics.values[self_body_id].interaction_meta
        ) != BODY_LAYER_PROJECTILE
        || body_interaction_layer(
            physics.values[other_body_id].interaction_meta
        ) != BODY_LAYER_PLAYER_DAMAGEABLE
        || combat_states.values[self_body_id].target_interaction_layer_mask
            != BODY_LAYER_PLAYER_DAMAGEABLE
        || gameplay_team_id(simulations.values[self_body_id].gameplay_meta)
            != GAMEPLAY_TEAM_HOSTILE
        || enemy_behavior_states.values[self_body_id].program_id
            != ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE
        || !maximum_damage_window_target_is_configured(other_body_id)
        || !contact_handler_accepts_target(self_body_id, other_body_id)
        || !gameplay_damage_is_allowed(
            simulations.values[self_body_id].gameplay_meta,
            simulations.values[other_body_id].gameplay_meta
        )
        || bitcast<i32>(contact.normal.x) <= 0) {
        return false;
    }
    let selected_flags = atomicLoad(
        &enemy_behavior_states.values[self_body_id].flags
    );
    if (atomicLoad(&enemy_behavior_states.values[self_body_id].state)
            != BODY_CONTROL_SELECTED_TARGET_TOWER
        || (selected_flags & (
            ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_VALID
            | ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_TOWER
        )) != (
            ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_VALID
            | ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_TOWER
        )
        || (selected_flags & ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_CORE) != 0u
        || enemy_behavior_states.values[self_body_id].target_slot
            != other_body_id
        || enemy_behavior_states.values[self_body_id].target_entity_id
            != simulations.values[other_body_id].entity_id
        || enemy_behavior_states.values[self_body_id].target_incarnation
            != contact.other_incarnation
        || enemy_behavior_states.values[self_body_id].state_entered_fixed_tick
            == 0u
        || bitcast<u32>(enemy_behavior_states.values[self_body_id]
            .charge_direction.x) == 0u) {
        return false;
    }
    let damage_self = max(i32(handler.damage_self * 100.0), 0);
    return damage_self > 0
        && atomicLoad(&simulations.values[self_body_id].health) >= damage_self;
}

@compute @workgroup_size(256)
fn preflight_core_damage_requests(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u
        || atomicLoad(&contact_state.event_overflow) != 0u
        || atomicLoad(&contact_state.core_damage_request_protocol_status)
            != CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_OK) {
        return;
    }
    let contact_index = global_id.x;
    let contact_count = min(
        atomicLoad(&contact_state.contact_count),
        params.max_contacts
    );
    if (contact_index >= contact_count) {
        return;
    }
    if (core_damage_request_candidate_is_valid(
        contacts.values[contact_index]
    )) {
        atomicAdd(&contact_state.core_damage_request_event_count, 1u);
    }
}

@compute @workgroup_size(1)
fn finalize_core_damage_request_preflight() {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u
        || atomicLoad(&contact_state.event_overflow) != 0u) {
        atomicStore(
            &contact_state.core_damage_request_protocol_status,
            CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_FAILURE
        );
        return;
    }
    let existing_event_count = atomicLoad(&contact_state.event_count);
    let request_count = atomicLoad(
        &contact_state.core_damage_request_event_count
    );
    let maximum_window_count = atomicLoad(
        &contact_state.maximum_damage_window_event_count
    );
    if (request_count > params.max_events
        || maximum_window_count > params.max_events - request_count
        || existing_event_count
            > params.max_events - request_count - maximum_window_count) {
        atomicStore(
            &contact_state.core_damage_request_protocol_status,
            CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_FAILURE
        );
        atomicAdd(&contact_state.event_overflow, 1u);
    }
}

@compute @workgroup_size(256)
fn resolve_core_damage_requests(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u
        || atomicLoad(&contact_state.event_overflow) != 0u
        || atomicLoad(&contact_state.core_damage_request_protocol_status)
            != CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_OK) {
        return;
    }
    let contact_index = global_id.x;
    let contact_count = min(
        atomicLoad(&contact_state.contact_count),
        params.max_contacts
    );
    if (contact_index >= contact_count) {
        return;
    }
    let contact = contacts.values[contact_index];
    if (selected_target_tower_candidate_is_valid(contact)) {
        let self_body_id = contact.self_body_id;
        let handler = contact_handlers.values[self_body_id];
        let damage_self = max(i32(handler.damage_self * 100.0), 0);
        if (!reserve_self_hit_budget(self_body_id, damage_self)) {
            return;
        }
        mark_maximum_damage_window_candidate(
            contact_index,
            bitcast<i32>(contact.normal.x),
            selected_target_tower_policy_from_marker(
                bitcast<u32>(contact.normal.y)
            )
        );
        return;
    }
    if (!core_damage_request_candidate_is_valid(contact)) {
        return;
    }
    let self_body_id = contact.self_body_id;
    let other_body_id = u32(contact.other_body_id);
    let handler = contact_handlers.values[self_body_id];
    let damage_self = max(i32(handler.damage_self * 100.0), 0);
    if (!reserve_self_hit_budget(self_body_id, damage_self)) {
        return;
    }
    let core_damage_fixed_point = bitcast<i32>(
        enemy_behavior_states.values[self_body_id].windup_range
    );
    append_applied_event(AppliedEvent(
        simulations.values[self_body_id].entity_id,
        contact.self_incarnation,
        simulations.values[other_body_id].entity_id,
        contact.other_incarnation,
        core_damage_fixed_point,
        APPLIED_EVENT_TYPE_CORE_DAMAGE_REQUEST,
        contact.world_position
    ));
}

@compute @workgroup_size(256)
fn emit_enemy_charge_telegraphs(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || enemy_behavior_states.values[body_id].program_id
            != ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE
        || !body_id_is_alive(body_id)) {
        return;
    }
    let previous_flags = atomicAnd(
        &enemy_behavior_states.values[body_id].flags,
        ~ENEMY_BEHAVIOR_FLAG_TELEGRAPH_PENDING
    );
    if ((previous_flags & ENEMY_BEHAVIOR_FLAG_TELEGRAPH_PENDING) == 0u
        || atomicLoad(&enemy_behavior_states.values[body_id].state)
            != ENEMY_BEHAVIOR_STATE_WINDUP
        || !behavior_target_matches_gameplay_tower(body_id)) {
        return;
    }
    append_applied_event(AppliedEvent(
        simulations.values[body_id].entity_id,
        simulations.values[body_id].incarnation,
        enemy_behavior_states.values[body_id].target_entity_id,
        enemy_behavior_states.values[body_id].target_incarnation,
        0,
        APPLIED_EVENT_TYPE_ENEMY_CHARGE_WINDUP_STARTED,
        physics.values[body_id].position
    ));
}

@compute @workgroup_size(256)
fn resolve_enemy_charge_contacts(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u) {
        return;
    }
    let contact_index = global_id.x;
    let contact_count = min(
        atomicLoad(&contact_state.contact_count),
        params.max_contacts
    );
    if (contact_index >= contact_count) {
        return;
    }
    let contact = contacts.values[contact_index];
    let policy_event_flag = maximum_damage_window_policy_from_marker(
        bitcast<u32>(contact.normal.y)
    );
    if (policy_event_flag == 0u
        || contact.other_body_id < 0) {
        return;
    }
    let body_id = contact.self_body_id;
    let target_slot = u32(contact.other_body_id);
    if (body_id >= counts.body_count
        || target_slot >= counts.body_count
        || enemy_behavior_states.values[body_id].program_id
            != ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE
        || simulations.values[body_id].incarnation != contact.self_incarnation
        || simulations.values[target_slot].incarnation != contact.other_incarnation
        || !behavior_target_matches_gameplay_tower(body_id)
        || target_slot != enemy_behavior_states.values[body_id].target_slot
        || simulations.values[target_slot].entity_id
            != enemy_behavior_states.values[body_id].target_entity_id
        || contact.other_incarnation
            != enemy_behavior_states.values[body_id].target_incarnation) {
        return;
    }
    if (atomicLoad(&enemy_behavior_states.values[body_id].state)
        != ENEMY_BEHAVIOR_STATE_CHARGE) {
        return;
    }
    let previous_state = atomicExchange(
        &enemy_behavior_states.values[body_id].state,
        ENEMY_BEHAVIOR_STATE_CONTACT_RECOIL
    );
    if (previous_state != ENEMY_BEHAVIOR_STATE_CHARGE) {
        return;
    }
    enemy_behavior_states.values[body_id].state_entered_fixed_tick
        = params.fixed_tick;
    enemy_behavior_states.values[body_id].state_expires_at_fixed_tick
        = params.fixed_tick + enemy_behavior_states.values[body_id].recoil_ticks;
    atomicStore(
        &enemy_behavior_states.values[body_id].flags,
        ENEMY_BEHAVIOR_FLAG_TARGET_VALID | ENEMY_BEHAVIOR_FLAG_RECOIL_PENDING
    );
    append_applied_event(AppliedEvent(
        simulations.values[body_id].entity_id,
        contact.self_incarnation,
        simulations.values[target_slot].entity_id,
        contact.other_incarnation,
        0,
        APPLIED_EVENT_TYPE_ENEMY_CHARGE_CONTACT_RECOIL_STARTED,
        contact.world_position
    ));
}

@compute @workgroup_size(256)
fn mark_dead(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count || !body_id_is_alive(body_id)) {
        return;
    }
    var reason_flags = 0u;
    if (atomicLoad(&simulations.values[body_id].health) <= 0) {
        reason_flags |= DEATH_EVENT_FLAG_HEALTH;
    }
    let lifetime = simulations.values[body_id].lifetime;
    if (lifetime == 0.0) {
        reason_flags |= DEATH_EVENT_FLAG_LIFETIME;
    }
    if (reason_flags == 0u || !clear_alive_once(body_id)) {
        return;
    }
    append_death_event(body_id, reason_flags);
}

@compute @workgroup_size(256)
fn clear_position_deltas(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id < counts.body_count) {
        temporaries.values[body_id].position_delta = vec2f(0.0);
    }
}

fn physical_pair_minimum_distance(self_body: GridBody, other_body: GridBody) -> f32 {
    let radius_sum = self_body.radius + other_body.radius;
    let self_is_enemy = (body_layer(self_body.physical_meta) & BODY_LAYER_ENEMY) != 0u;
    let other_is_enemy = (body_layer(other_body.physical_meta) & BODY_LAYER_ENEMY) != 0u;
    if (self_is_enemy && other_is_enemy) {
        return radius_sum * ENEMY_PAIR_COLLISION_RADIUS_SCALE;
    }
    return radius_sum;
}

fn pair_correction(self_body: GridBody, other_body: GridBody, alpha: f32, big_pair: bool) -> vec2f {
    if (self_body.body_id == other_body.body_id) {
        return vec2f(0.0);
    }
    if (!body_id_is_alive(other_body.body_id)) {
        return vec2f(0.0);
    }
    if ((body_collision_mask(self_body.physical_meta)
            & body_layer(other_body.physical_meta)) == 0u
        || (body_collision_mask(other_body.physical_meta)
            & body_layer(self_body.physical_meta)) == 0u) {
        return vec2f(0.0);
    }

    let delta = self_body.predicted_position - other_body.predicted_position;
    let distance_squared = dot(delta, delta);
    let minimum_distance = physical_pair_minimum_distance(self_body, other_body);
    if (distance_squared >= minimum_distance * minimum_distance) {
        return vec2f(0.0);
    }

    var normal = deterministic_separation_normal(
        self_body.body_id,
        other_body.body_id
    );
    var distance = 0.0;
    if (distance_squared > EPSILON_DISTANCE_SQUARED) {
        let inverse_distance = inverseSqrt(distance_squared);
        normal = delta * inverse_distance;
        distance = distance_squared * inverse_distance;
    }
    let penetration = minimum_distance - distance;
    let inverse_mass_sum = self_body.inverse_mass + other_body.inverse_mass;
    if (inverse_mass_sum <= EPSILON_MASS) {
        return vec2f(0.0);
    }
    let delta_lambda = penetration / (inverse_mass_sum + alpha);
    return normal * delta_lambda * self_body.inverse_mass;
}

@compute @workgroup_size(64)
fn solve_body_body(
    @builtin(local_invocation_id) local_id: vec3u,
    @builtin(workgroup_id) workgroup_id: vec3u
) {
    let local = local_id.x;
    let cell_index = workgroup_id.x;
    if (cell_index >= grid_cell_total()) {
        return;
    }

    if (local < 9u) {
        let cell = vec2i(
            i32(cell_index % params.grid_cell_count.x),
            i32(cell_index / params.grid_cell_count.x)
        );
        let neighbor = cell + NEIGHBOR_OFFSETS[local];
        if (neighbor.x < 0 || neighbor.y < 0
            || neighbor.x >= i32(params.grid_cell_count.x)
            || neighbor.y >= i32(params.grid_cell_count.y)) {
            neighbor_cell_counts[local] = 0u;
            neighbor_cell_indices[local] = 0u;
        } else {
            let neighbor_index = (u32(neighbor.y) * params.grid_cell_count.x) + u32(neighbor.x);
            neighbor_cell_counts[local] = min(
                atomicLoad(&grid_counts.values[neighbor_index * 2u]),
                params.max_bodies_per_cell
            );
            neighbor_cell_indices[local] = neighbor_index;
        }
        if (local == 4u) {
            current_cell_count = neighbor_cell_counts[local];
            current_big_count = min(
                atomicLoad(&grid_counts.values[(cell_index * 2u) + 1u]),
                params.max_bodies_per_cell
            );
        }
    }
    workgroupBarrier();

    // ABI version은 storage load이므로 WGSL uniformity analysis가 barrier 앞의
    // early-return 조건으로 인정하지 않습니다. 이 pass는 barrier 전에는
    // workgroup scratch만 쓰고, version 확인 뒤에만 body storage를 변경합니다.
    if (!abi_is_current()) {
        return;
    }

    if (local >= current_cell_count) {
        return;
    }
    let self_index = grid_bucket_offset(cell_index, 0u) + local;
    let self_body = grid_bodies.values[self_index];
    let collision_mask = body_collision_mask(self_body.physical_meta);
    if (self_body.inverse_mass <= EPSILON_MASS
        || self_body.radius <= 0.0
        || collision_mask == 0u
        || !body_id_is_alive(self_body.body_id)) {
        return;
    }

    let soft_border = 8.0 * params.source_world_unit_scale;
    let distance_x = min(
        self_body.predicted_position.x,
        params.world_size.x - self_body.predicted_position.x
    );
    let distance_y = min(
        self_body.predicted_position.y,
        params.world_size.y - self_body.predicted_position.y
    );
    let border_factor = max(
        1.0 - smoothstep(0.0, soft_border, distance_x),
        1.0 - smoothstep(0.0, soft_border, distance_y)
    );
    let compliance = mix(0.000001, 0.001, border_factor);
    let alpha = compliance
        / (params.dt * params.dt * f32(max(params.solver_iterations, 1u)));
    var accumulated_delta = vec2f(0.0);

    for (var neighbor_slot = 0u; neighbor_slot < 9u; neighbor_slot += 1u) {
        let neighbor_index = neighbor_cell_indices[neighbor_slot];
        let neighbor_count = neighbor_cell_counts[neighbor_slot];
        let neighbor_offset = grid_bucket_offset(neighbor_index, 0u);
        for (var index = 0u; index < neighbor_count; index += 1u) {
            accumulated_delta += pair_correction(
                self_body,
                grid_bodies.values[neighbor_offset + index],
                alpha,
                false
            );
        }
    }

    let big_offset = grid_bucket_offset(cell_index, 1u);
    for (var index = 0u; index < current_big_count; index += 1u) {
        accumulated_delta += pair_correction(
            self_body,
            grid_bodies.values[big_offset + index],
            alpha,
            true
        );
    }
    temporaries.values[self_body.body_id].position_delta += accumulated_delta;
}

@compute @workgroup_size(256)
fn solve_body_world(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || params.sdf_enabled == 0u
        || !body_id_is_alive(body_id)) {
        return;
    }
    let body = physics.values[body_id];
    if ((body_collision_mask(body.physical_meta) & BODY_LAYER_TERRAIN) == 0u
        || body.inverse_mass <= EPSILON_MASS) {
        return;
    }

    let predicted = temporaries.values[body_id].predicted_position;
    let candidate = predicted + temporaries.values[body_id].position_delta;
    let distance = sample_world_sdf(candidate);
    let penetration = body.radius - distance;
    if (penetration <= 0.0) {
        return;
    }

    let gradient_step = max(params.source_world_unit_scale, 0.0001);
    let gradient_uv_epsilon = vec2f(gradient_step) / params.world_size;
    var normal = vec2f(
        sample_world_sdf(candidate + vec2f(gradient_step, 0.0))
            - sample_world_sdf(candidate - vec2f(gradient_step, 0.0)),
        sample_world_sdf(candidate + vec2f(0.0, gradient_step))
            - sample_world_sdf(candidate - vec2f(0.0, gradient_step))
    ) / (gradient_uv_epsilon * 2.0);
    let normal_length = length(normal);
    if (normal_length < EPSILON_MASS) {
        let center_delta = (params.world_size * 0.5) - candidate;
        let center_distance = length(center_delta);
        normal = select(
            vec2f(1.0, 0.0),
            center_delta / center_distance,
            center_distance >= EPSILON_MASS
        );
    } else {
        normal /= normal_length;
    }
    temporaries.values[body_id].position_delta += normal * min(penetration, body.radius);
}

@compute @workgroup_size(256)
fn apply_position_deltas(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }
    if (!body_id_is_alive(body_id)) {
        return;
    }
    temporaries.values[body_id].predicted_position += temporaries.values[body_id].position_delta;
    let grid_index = temporaries.values[body_id].grid_index;
    if (grid_index >= 0) {
        grid_bodies.values[u32(grid_index)].predicted_position
            = temporaries.values[body_id].predicted_position;
    }
}

fn is_inside_world(position: vec2f) -> bool {
    return position.x >= 0.0 && position.x < params.world_size.x
        && position.y >= 0.0 && position.y < params.world_size.y;
}

@compute @workgroup_size(256)
fn rebuild_velocities(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }
    if (!body_id_is_alive(body_id)) {
        return;
    }
    if (grid_has_overflow()) {
        temporaries.values[body_id].predicted_position
            = temporaries.values[body_id].previous_position;
        temporaries.values[body_id].position_delta = vec2f(0.0);
        physics.values[body_id].position = temporaries.values[body_id].previous_position;
        simulations.values[body_id].flow_field_index
            = temporaries.values[body_id].previous_flow_field_index;
        return;
    }
    var predicted = temporaries.values[body_id].predicted_position;
    var previous = temporaries.values[body_id].previous_position;
    if (!is_inside_world(predicted)
        && (body_layer(physics.values[body_id].physical_meta) & BODY_LAYER_ENEMY) != 0u
        && is_inside_world(previous)) {
        let clamp_margin = 0.1 * params.source_world_unit_scale;
        predicted = clamp(predicted, vec2f(0.0), params.world_size - vec2f(clamp_margin));
        previous = predicted;
    }
    physics.values[body_id].position = predicted;
    physics.values[body_id].velocity = (predicted - previous) * params.inverse_dt;
}

@compute @workgroup_size(256)
fn finalize_velocities(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || grid_has_overflow()
        || !body_id_is_alive(body_id)) {
        return;
    }
    if (body_has_flag(
        load_simulation_flags(body_id),
        BODY_FLAG_CONTROLLED_THIS_TICK
    )) {
        return;
    }
    var velocity = physics.values[body_id].velocity
        * clamp(1.0 - (params.velocity_damping * params.dt), 0.0, 1.0);
    let speed_squared = dot(velocity, velocity);
    if (params.max_speed > 0.0 && speed_squared > params.max_speed * params.max_speed) {
        velocity = normalize(velocity) * params.max_speed;
    }
    physics.values[body_id].velocity = velocity;
}

@compute @workgroup_size(256)
fn finalize_controlled_motion(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count || !body_id_is_alive(body_id)) {
        return;
    }
    let control_state = body_control_states.values[body_id];
    if (control_state.entity_id != simulations.values[body_id].entity_id
        || control_state.incarnation != simulations.values[body_id].incarnation) {
        return;
    }
    if ((control_state.state_flags & BODY_CONTROL_STATE_FLAG_STOP) != 0u) {
        physics.values[body_id].velocity = vec2f(0.0);
        return;
    }
    if (!body_has_flag(
        load_simulation_flags(body_id),
        BODY_FLAG_CONTROLLED_THIS_TICK
    )) {
        return;
    }
    var velocity = physics.values[body_id].velocity;
    let controlled_speed = length(velocity);
    if (controlled_speed > CONTROL_MAX_LINEAR_SPEED) {
        velocity = (velocity / controlled_speed) * CONTROL_MAX_LINEAR_SPEED;
    }
    physics.values[body_id].velocity = velocity;
}

@compute @workgroup_size(256)
fn apply_enemy_charge_recoil(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || enemy_behavior_states.values[body_id].program_id
            != ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE
        || !body_id_is_alive(body_id)) {
        return;
    }
    let previous_flags = atomicAnd(
        &enemy_behavior_states.values[body_id].flags,
        ~ENEMY_BEHAVIOR_FLAG_RECOIL_PENDING
    );
    if ((previous_flags & ENEMY_BEHAVIOR_FLAG_RECOIL_PENDING) == 0u
        || atomicLoad(&enemy_behavior_states.values[body_id].state)
            != ENEMY_BEHAVIOR_STATE_CONTACT_RECOIL) {
        return;
    }
    // solver/rebuild/final velocity 뒤에 한 번만 cached charge 반대 속도를 부여합니다.
    physics.values[body_id].velocity
        = -enemy_behavior_states.values[body_id].charge_direction
            * enemy_behavior_states.values[body_id].recoil_impulse;
}

@compute @workgroup_size(1)
fn pack_tracked_pose() {
    if (!abi_is_current()
        || tracked_pose_config.enabled == 0u
        || tracked_pose_config.source_slot >= counts.body_count) {
        invalidate_tracked_pose_output();
        return;
    }
    let source_slot = tracked_pose_config.source_slot;
    if (simulations.values[source_slot].entity_id != tracked_pose_config.entity_id
        || simulations.values[source_slot].incarnation
            != tracked_pose_config.incarnation
        || !body_id_is_alive(source_slot)) {
        invalidate_tracked_pose_output();
        return;
    }
    tracked_pose_output.position = physics.values[source_slot].position;
    tracked_pose_output.velocity = physics.values[source_slot].velocity;
    tracked_pose_output.previous_position
        = temporaries.values[source_slot].previous_position;
    tracked_pose_output.entity_id = tracked_pose_config.entity_id;
    tracked_pose_output.incarnation = tracked_pose_config.incarnation;
}
`;

export const GPU_COLLISION_INDIRECT_WGSL = /* wgsl */`
const BODY_ABI_VERSION: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;

struct BodyCounts {
    body_count: u32,
    addition_count: u32,
    removal_count: u32,
    abi_version: u32,
}

struct DispatchArgs {
    x: u32,
    y: u32,
    z: u32,
}

struct DrawArgs {
    vertex_count: u32,
    instance_count: u32,
    first_vertex: u32,
    first_instance: u32,
}

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read_write> dispatch_args: DispatchArgs;
@group(0) @binding(2) var<storage, read_write> draw_args: DrawArgs;

@compute @workgroup_size(1)
fn update_indirect_args() {
    if (counts.abi_version != BODY_ABI_VERSION) {
        dispatch_args.x = 0u;
        dispatch_args.y = 0u;
        dispatch_args.z = 0u;
        draw_args.vertex_count = 0u;
        draw_args.instance_count = 0u;
        draw_args.first_vertex = 0u;
        draw_args.first_instance = 0u;
        return;
    }
    dispatch_args.x = (counts.body_count + 255u) / 256u;
    dispatch_args.y = 1u;
    dispatch_args.z = 1u;
    draw_args.vertex_count = 6u;
    draw_args.instance_count = counts.body_count;
    draw_args.first_vertex = 0u;
    draw_args.first_instance = 0u;
}
`;

export const GPU_COLLISION_RENDER_WGSL = /* wgsl */`
const BODY_ABI_VERSION: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;

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
    state_entered_fixed_tick: u32,
    state_expires_at_fixed_tick: u32,
    target_slot: u32,
    target_entity_id: u32,
    target_incarnation: u32,
    flags: u32,
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
}

struct EffectSummary {
    entity_id: u32,
    incarnation: u32,
    max_health_fixed_point: i32,
    authored_damage_other: f32,
    resolved_base_damage_other: f32,
    active_family_mask: u32,
    boost_stack_count: u32,
    regen_per_tick_fixed_point: i32,
    attack_multiplier: f32,
    move_speed_multiplier: f32,
    presentation_tags: u32,
    presentation_magnitude: f32,
    last_pulse_tick: u32,
    pulse_style_code: u32,
    summary_tick: u32,
    source_snapshot_tick: u32,
    damage_taken_multiplier: f32,
    reserved_0: u32,
    reserved_1: u32,
    flags: u32,
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

struct BodyTemporary {
    previous_position: vec2f,
    predicted_position: vec2f,
    position_delta: vec2f,
    grid_index: i32,
    previous_flow_field_index: u32,
}

struct BodyRenderStyle {
    color: vec4f,
    radius_scale: f32,
    visible: u32,
    shape_code: u32,
    reserved_1: u32,
}

struct PhysicsBuffer { values: array<BodyPhysics> }
struct TemporaryBuffer { values: array<BodyTemporary> }
struct RenderStyleBuffer { values: array<BodyRenderStyle> }
struct SimulationBuffer { values: array<BodySimulation> }
struct EnemyBehaviorStateBuffer { values: array<EnemyBehaviorState> }
struct EffectSummaryBuffer { values: array<EffectSummary> }
struct FormationStateBuffer { values: array<FormationState> }

struct RenderParams {
    viewport_origin: vec2f,
    viewport_size: vec2f,
    world_scale: f32,
    prediction_dt: f32,
    interpolation_alpha: f32,
    presentation_mode: u32,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) local_position: vec2f,
    @location(1) color: vec4f,
    @location(2) @interpolate(flat) shape_code: u32,
    @location(3) velocity: vec2f,
    @location(4) @interpolate(flat) formation_member_count: u32,
    @location(5) @interpolate(flat) formation_occupied_mask: u32,
    @location(6) @interpolate(flat) formation_presentation_flags: u32,
    @location(7) @interpolate(flat) health_ratio: f32,
    @location(8) @interpolate(flat) directional_defense_active: u32,
}

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read> temporaries: TemporaryBuffer;
@group(0) @binding(3) var<storage, read> styles: RenderStyleBuffer;
@group(0) @binding(4) var<storage, read> simulations: SimulationBuffer;
@group(0) @binding(5) var<storage, read> enemy_behavior_states: EnemyBehaviorStateBuffer;
@group(0) @binding(6) var<storage, read> effect_summaries: EffectSummaryBuffer;
@group(0) @binding(7) var<storage, read> formation_states: FormationStateBuffer;
@group(1) @binding(0) var<uniform> params: RenderParams;

const QUAD_VERTICES = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0)
);
const RENDER_SHAPE_CIRCLE: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE}u;
const RENDER_SHAPE_SQUARE: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.SQUARE}u;
const RENDER_SHAPE_TRIANGLE: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.TRIANGLE}u;
const RENDER_SHAPE_ARROW: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.ARROW}u;
const RENDER_SHAPE_PENTA: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.PENTA}u;
const RENDER_SHAPE_HEXA: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.HEXA}u;
const RENDER_SHAPE_GEN: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.GEN}u;
const RENDER_SHAPE_RHOM: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.RHOM}u;
const RENDER_SHAPE_OCTA: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.OCTA}u;
const ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.ARROW_TOWER_CHARGE}u;
const ENEMY_BEHAVIOR_PROGRAM_OCTAGON_TOWER_ORBIT: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT}u;
const ENEMY_BEHAVIOR_STATE_WINDUP: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.WINDUP}u;
const ENEMY_BEHAVIOR_STATE_ORBIT_TOWER: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.ORBIT_TOWER}u;
const ENEMY_BEHAVIOR_FLAG_TARGET_VALID: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.TARGET_VALID}u;
const ENEMY_BEHAVIOR_FLAG_DIRECTIONAL_DEFENSE_ACTIVE: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.DIRECTIONAL_DEFENSE_ACTIVE}u;
const EFFECT_PRESENTATION_TAG_BOOST: u32 = 1u;
const EFFECT_PRESENTATION_TAG_PULSE: u32 = 2u;
const FORMATION_FLAG_ACTIVE: u32 = ${GPU_FORMATION_BODY_STATE_FLAG.ACTIVE}u;
const FORMATION_FLAG_MERGE_PULSE: u32 = ${GPU_FORMATION_BODY_STATE_FLAG.PRESENTATION_MERGE_PULSE}u;
const FORMATION_FLAG_RESERVATION: u32 = ${GPU_FORMATION_BODY_STATE_FLAG.PRESENTATION_RESERVATION}u;
const FORMATION_OCCUPIED_MASK: u32 = 63u;
const FORMATION_HEX_CELL_RADIUS: f32 = 0.285;
const FORMATION_RING_RADIUS: f32 = 0.54;
const FORMATION_HEX_DIRECTIONS = array<vec2f, 6>(
    vec2f(1.0, 0.0),
    vec2f(0.5, -0.8660254037844386),
    vec2f(-0.5, -0.8660254037844386),
    vec2f(-1.0, 0.0),
    vec2f(-0.5, 0.8660254037844386),
    vec2f(0.5, 0.8660254037844386)
);
const SHAPE_DIRECTION_EPSILON: f32 = 0.000001;
const SQUARE_CENTER: vec2f = ${toWgslVec2(ENEMY_RENDER_GEOMETRY.square.box.center)};
const SQUARE_HALF_SIZE: vec2f = ${toWgslVec2(ENEMY_RENDER_GEOMETRY.square.box.halfSize)};
const TRIANGLE_POINTS = ${toWgslPointArray(ENEMY_RENDER_GEOMETRY.triangle.points)};
const ARROW_POINTS = ${toWgslPointArray(ENEMY_RENDER_GEOMETRY.arrow.points)};
const PENTA_POINTS = ${toWgslPointArray(ENEMY_RENDER_GEOMETRY.penta.points)};
const HEXA_POINTS = ${toWgslPointArray(ENEMY_RENDER_GEOMETRY.hexa.points)};
const RHOM_POINTS = ${toWgslPointArray(ENEMY_RENDER_GEOMETRY.rhom.points)};
const OCTA_POINTS = ${toWgslPointArray(ENEMY_RENDER_GEOMETRY.octa.points)};
const GENERATOR_OUTER_CENTER: vec2f = ${toWgslVec2(ENEMY_RENDER_GEOMETRY.gen.outerBox.center)};
const GENERATOR_OUTER_HALF_SIZE: vec2f = ${toWgslVec2(ENEMY_RENDER_GEOMETRY.gen.outerBox.halfSize)};
const GENERATOR_INNER_CENTER: vec2f = ${toWgslVec2(ENEMY_RENDER_GEOMETRY.gen.innerBox.center)};
const GENERATOR_INNER_HALF_SIZE: vec2f = ${toWgslVec2(ENEMY_RENDER_GEOMETRY.gen.innerBox.halfSize)};
const GENERATOR_TERMINAL_CENTERS = ${toWgslPointArray(
    ENEMY_RENDER_GEOMETRY.gen.terminalBoxes.map(({ center }) => center),
    4
)};
const GENERATOR_TERMINAL_HALF_SIZES = ${toWgslPointArray(
    ENEMY_RENDER_GEOMETRY.gen.terminalBoxes.map(({ halfSize }) => halfSize),
    4
)};

fn directional_local_position(point: vec2f, velocity: vec2f) -> vec2f {
    var forward = vec2f(0.0, -1.0);
    let velocity_length_squared = dot(velocity, velocity);
    if (velocity_length_squared > SHAPE_DIRECTION_EPSILON) {
        forward = velocity * inverseSqrt(velocity_length_squared);
    }
    let right = vec2f(forward.y, -forward.x);
    return vec2f(dot(point, right), dot(point, forward));
}

fn box_distance(point: vec2f, center: vec2f, half_size: vec2f) -> f32 {
    let delta = abs(point - center) - half_size;
    return length(max(delta, vec2f(0.0))) + min(max(delta.x, delta.y), 0.0);
}

fn polygon_distance(
    point: vec2f,
    vertices: array<vec2f, ${WGSL_POLYGON_POINT_CAPACITY}>,
    vertex_count: u32
) -> f32 {
    var distance_squared = 3.402823466e+38;
    var inside = false;
    var previous_index = vertex_count - 1u;
    for (var index = 0u; index < vertex_count; index += 1u) {
        let current = vertices[index];
        let previous = vertices[previous_index];
        let edge = previous - current;
        let relative = point - current;
        let edge_length_squared = max(dot(edge, edge), 0.000000000001);
        let nearest = relative - edge * clamp(
            dot(relative, edge) / edge_length_squared,
            0.0,
            1.0
        );
        distance_squared = min(distance_squared, dot(nearest, nearest));

        let crosses_scanline = (current.y > point.y) != (previous.y > point.y);
        if (crosses_scanline) {
            let crossing_x = current.x
                + ((point.y - current.y) * (previous.x - current.x)
                    / (previous.y - current.y));
            if (point.x < crossing_x) {
                inside = !inside;
            }
        }
        previous_index = index;
    }
    let distance = sqrt(max(distance_squared, 0.0));
    return select(distance, -distance, inside);
}

fn arrow_distance(point: vec2f) -> f32 {
    return polygon_distance(point, ARROW_POINTS, 4u);
}

fn generator_distance(point: vec2f) -> f32 {
    let outer = box_distance(
        point,
        GENERATOR_OUTER_CENTER,
        GENERATOR_OUTER_HALF_SIZE
    );
    let inner = box_distance(
        point,
        GENERATOR_INNER_CENTER,
        GENERATOR_INNER_HALF_SIZE
    );
    var distance = max(outer, -inner);
    for (var index = 0u; index < 4u; index += 1u) {
        distance = min(distance, box_distance(
            point,
            GENERATOR_TERMINAL_CENTERS[index],
            GENERATOR_TERMINAL_HALF_SIZES[index]
        ));
    }
    return distance;
}

fn shape_distance(point: vec2f, velocity: vec2f, shape_code: u32) -> f32 {
    if (shape_code == RENDER_SHAPE_SQUARE) {
        return box_distance(point, SQUARE_CENTER, SQUARE_HALF_SIZE);
    }
    if (shape_code == RENDER_SHAPE_TRIANGLE) {
        return polygon_distance(
            directional_local_position(point, velocity),
            TRIANGLE_POINTS,
            3u
        );
    }
    if (shape_code == RENDER_SHAPE_ARROW) {
        return arrow_distance(directional_local_position(point, velocity));
    }
    if (shape_code == RENDER_SHAPE_PENTA) {
        return polygon_distance(point, PENTA_POINTS, 5u);
    }
    if (shape_code == RENDER_SHAPE_HEXA) {
        return polygon_distance(point, HEXA_POINTS, 6u);
    }
    if (shape_code == RENDER_SHAPE_RHOM) {
        return polygon_distance(point, RHOM_POINTS, 4u);
    }
    if (shape_code == RENDER_SHAPE_OCTA) {
        return polygon_distance(
            directional_local_position(point, velocity),
            OCTA_POINTS,
            8u
        );
    }
    if (shape_code == RENDER_SHAPE_GEN) {
        return generator_distance(point);
    }
    return length(point) - 1.0;
}

fn formation_cell_distance(point: vec2f, slot: u32) -> f32 {
    let center = FORMATION_HEX_DIRECTIONS[slot] * FORMATION_RING_RADIUS;
    return polygon_distance(
        (point - center) / FORMATION_HEX_CELL_RADIUS,
        HEXA_POINTS,
        6u
    ) * FORMATION_HEX_CELL_RADIUS;
}

fn formation_mask_distance(point: vec2f, mask: u32) -> f32 {
    var distance = 3.402823466e+38;
    for (var slot = 0u; slot < 6u; slot += 1u) {
        if ((mask & (1u << slot)) != 0u) {
            distance = min(distance, formation_cell_distance(point, slot));
        }
    }
    return distance;
}

fn formation_empty_boundary_distance(point: vec2f, mask: u32) -> f32 {
    var distance = 3.402823466e+38;
    for (var slot = 0u; slot < 6u; slot += 1u) {
        if ((mask & (1u << slot)) == 0u) {
            distance = min(
                distance,
                abs(formation_cell_distance(point, slot))
            );
        }
    }
    return distance;
}

fn segment_distance(point: vec2f, start: vec2f, end: vec2f) -> f32 {
    let edge = end - start;
    let length_squared = max(dot(edge, edge), 0.000001);
    return length(point - (start + edge * clamp(
        dot(point - start, edge) / length_squared,
        0.0,
        1.0
    )));
}

fn formation_member_link_distance(point: vec2f, mask: u32) -> f32 {
    var distance = 3.402823466e+38;
    for (var slot = 0u; slot < 6u; slot += 1u) {
        let next = (slot + 1u) % 6u;
        if ((mask & (1u << slot)) != 0u
            && (mask & (1u << next)) != 0u) {
            distance = min(distance, segment_distance(
                point,
                FORMATION_HEX_DIRECTIONS[slot] * FORMATION_RING_RADIUS,
                FORMATION_HEX_DIRECTIONS[next] * FORMATION_RING_RADIUS
            ));
        }
    }
    return distance;
}

fn unpack_rgba8(packed: u32) -> vec4f {
    return vec4f(
        f32(packed & 255u),
        f32((packed >> 8u) & 255u),
        f32((packed >> 16u) & 255u),
        f32((packed >> 24u) & 255u)
    ) / 255.0;
}

@vertex
fn vertex_main(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32
) -> VertexOutput {
    var output: VertexOutput;
    if (counts.abi_version != BODY_ABI_VERSION) {
        output.position = vec4f(2.0, 2.0, 0.0, 1.0);
        output.local_position = vec2f(0.0);
        output.color = vec4f(0.0);
        output.shape_code = RENDER_SHAPE_CIRCLE;
        output.velocity = vec2f(0.0);
        output.formation_member_count = 0u;
        output.formation_occupied_mask = 0u;
        output.formation_presentation_flags = 0u;
        output.health_ratio = 0.0;
        output.directional_defense_active = 0u;
        return output;
    }
    let simulation_flags = simulations.values[instance_index].flags;
    if ((simulation_flags & 1u) == 0u) {
        output.position = vec4f(2.0, 2.0, 0.0, 1.0);
        output.local_position = vec2f(0.0);
        output.color = vec4f(0.0);
        output.shape_code = RENDER_SHAPE_CIRCLE;
        output.velocity = vec2f(0.0);
        output.formation_member_count = 0u;
        output.formation_occupied_mask = 0u;
        output.formation_presentation_flags = 0u;
        output.health_ratio = 0.0;
        output.directional_defense_active = 0u;
        return output;
    }
    let body = physics.values[instance_index];
    let temporary = temporaries.values[instance_index];
    let style = styles.values[instance_index];
    let behavior = enemy_behavior_states.values[instance_index];
    let effect_summary = effect_summaries.values[instance_index];
    let formation = formation_states.values[instance_index];
    var body_position = mix(
        temporary.previous_position,
        body.position,
        clamp(params.interpolation_alpha, 0.0, 1.0)
    );
    if (params.presentation_mode == 1u) {
        body_position = body.position + (body.velocity * max(params.prediction_dt, 0.0));
    }

    var presentation_velocity = body.velocity;
    var presentation_color = style.color;
    var presentation_radius_scale = style.radius_scale;
    let effect_identity_matches = effect_summary.entity_id
            == simulations.values[instance_index].entity_id
        && effect_summary.incarnation
            == simulations.values[instance_index].incarnation;
    if (effect_identity_matches
        && (effect_summary.presentation_tags & EFFECT_PRESENTATION_TAG_BOOST) != 0u) {
        presentation_color = vec4f(
            mix(
                presentation_color.rgb,
                vec3f(0.28, 0.92, 1.0),
                0.35
            ),
            presentation_color.a
        );
    }
    if (effect_identity_matches
        && (effect_summary.presentation_tags & EFFECT_PRESENTATION_TAG_PULSE) != 0u) {
        presentation_color = vec4f(
            mix(
                presentation_color.rgb,
                vec3f(0.72, 1.0, 0.95),
                0.55
            ),
            presentation_color.a
        );
        presentation_radius_scale *= 1.0
            + (0.16 * clamp(effect_summary.presentation_magnitude, 0.0, 1.0));
    }
    if (behavior.program_id == ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE
        && behavior.state == ENEMY_BEHAVIOR_STATE_WINDUP) {
        if (behavior.telegraph_style_code != 0u) {
            presentation_color = unpack_rgba8(behavior.telegraph_color_rgba8);
            presentation_radius_scale *= behavior.telegraph_radius_scale;
        }
        if ((behavior.flags & ENEMY_BEHAVIOR_FLAG_TARGET_VALID) != 0u
            && behavior.target_slot < counts.body_count
            && simulations.values[behavior.target_slot].entity_id
                == behavior.target_entity_id
            && simulations.values[behavior.target_slot].incarnation
                == behavior.target_incarnation
            && (simulations.values[behavior.target_slot].flags & 1u) != 0u) {
            presentation_velocity = physics.values[behavior.target_slot].position
                - body.position;
        }
    }
    let directional_defense_active = behavior.program_id
            == ENEMY_BEHAVIOR_PROGRAM_OCTAGON_TOWER_ORBIT
        && behavior.state == ENEMY_BEHAVIOR_STATE_ORBIT_TOWER
        && (behavior.flags & ENEMY_BEHAVIOR_FLAG_DIRECTIONAL_DEFENSE_ACTIVE) != 0u;
    if (directional_defense_active) {
        // The same +32/+36 facing drives presentation and contact classification.
        presentation_velocity = behavior.charge_direction;
    }
    let local = QUAD_VERTICES[vertex_index];
    let world_position = body_position
        + (local * body.radius * presentation_radius_scale);
    let viewport_position = params.viewport_origin + (world_position * params.world_scale);
    let clip_position = vec2f(
        (viewport_position.x / params.viewport_size.x) * 2.0 - 1.0,
        1.0 - (viewport_position.y / params.viewport_size.y) * 2.0
    );
    output.position = vec4f(clip_position, 0.0, 1.0);
    output.local_position = local;
    output.color = presentation_color * f32(style.visible != 0u);
    output.shape_code = style.shape_code;
    output.velocity = presentation_velocity;
    let formation_identity_matches = formation.entity_id
            == simulations.values[instance_index].entity_id
        && formation.incarnation
            == simulations.values[instance_index].incarnation
        && (formation.flags & FORMATION_FLAG_ACTIVE) != 0u
        && formation.member_count >= 1u
        && formation.member_count <= 6u
        && (formation.occupied_slot_mask & ~FORMATION_OCCUPIED_MASK) == 0u;
    output.formation_member_count = select(
        0u,
        formation.member_count,
        formation_identity_matches
    );
    output.formation_occupied_mask = select(
        0u,
        formation.occupied_slot_mask,
        formation_identity_matches
    );
    output.formation_presentation_flags = select(
        0u,
        formation.presentation_flags,
        formation_identity_matches
    );
    output.health_ratio = select(
        0.0,
        clamp(
            f32(max(simulations.values[instance_index].health, 0))
                / f32(max(effect_summary.max_health_fixed_point, 1)),
            0.0,
            1.0
        ),
        formation_identity_matches && effect_identity_matches
    );
    output.directional_defense_active = select(
        0u,
        1u,
        directional_defense_active
    );
    return output;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let occupied_distance = formation_mask_distance(
        input.local_position,
        input.formation_occupied_mask
    );
    let occupied_aa = max(fwidth(occupied_distance), 0.002);
    let link_distance = formation_member_link_distance(
        input.local_position,
        input.formation_occupied_mask
    );
    let link_aa = max(fwidth(link_distance), 0.002);
    let empty_distance = formation_empty_boundary_distance(
        input.local_position,
        input.formation_occupied_mask
    );
    let empty_aa = max(fwidth(empty_distance), 0.002);
    let pulse_distance = abs(length(input.local_position) - 0.92);
    let pulse_aa = max(fwidth(pulse_distance), 0.002);
    let bar_center = vec2f(0.0, 0.86);
    let bar_half = vec2f(0.68, 0.065);
    let outer_distance = box_distance(
        input.local_position,
        bar_center,
        bar_half
    );
    let bar_aa = max(fwidth(outer_distance), 0.002);
    let distance = shape_distance(
        input.local_position,
        input.velocity,
        input.shape_code
    );
    let anti_alias_width = max(fwidth(distance), 0.002);
    if (length(input.local_position) > 1.0) {
        discard;
    }
    if (input.shape_code == RENDER_SHAPE_HEXA
        && input.formation_member_count > 0u) {
        let occupied_coverage = 1.0 - smoothstep(
            -occupied_aa,
            occupied_aa,
            occupied_distance
        );
        let progress = f32(input.formation_member_count) / 6.0;
        var rgb = mix(
            input.color.rgb,
            vec3f(1.0, 0.72, 0.22),
            progress * 0.28
        );
        var alpha = input.color.a * occupied_coverage;

        let link = 1.0 - smoothstep(
            0.032 - link_aa,
            0.032 + link_aa,
            link_distance
        );
        if (link > alpha) {
            rgb = mix(rgb, vec3f(1.0, 0.78, 0.32), 0.46);
        }
        alpha = max(alpha, link * input.color.a * 0.78);

        let empty_outline = 1.0 - smoothstep(
            0.018 - empty_aa,
            0.018 + empty_aa,
            empty_distance
        );
        let reservation_active = (input.formation_presentation_flags
            & FORMATION_FLAG_RESERVATION) != 0u;
        let empty_alpha_scale = select(0.2, 0.72, reservation_active);
        if (empty_outline * empty_alpha_scale > alpha) {
            rgb = mix(
                rgb,
                vec3f(0.25, 0.95, 1.0),
                select(0.28, 0.72, reservation_active)
            );
        }
        alpha = max(
            alpha,
            empty_outline * input.color.a * empty_alpha_scale
        );

        if ((input.formation_presentation_flags
                & FORMATION_FLAG_MERGE_PULSE) != 0u) {
            let pulse = 1.0 - smoothstep(
                0.025 - pulse_aa,
                0.025 + pulse_aa,
                pulse_distance
            );
            if (pulse > alpha) {
                rgb = mix(rgb, vec3f(1.0, 0.92, 0.48), 0.8);
            }
            alpha = max(alpha, pulse * input.color.a);
        }

        if (input.formation_member_count == 6u) {
            let outer = 1.0 - smoothstep(-bar_aa, bar_aa, outer_distance);
            let fill_half_x = max(0.0, bar_half.x * input.health_ratio);
            let fill_center = vec2f(
                bar_center.x - bar_half.x + fill_half_x,
                bar_center.y
            );
            let fill_distance = box_distance(
                input.local_position,
                fill_center,
                vec2f(fill_half_x, bar_half.y * 0.62)
            );
            let fill = select(
                0.0,
                1.0 - smoothstep(-bar_aa, bar_aa, fill_distance),
                input.health_ratio > 0.0
            );
            if (outer > 0.0) {
                rgb = mix(
                    vec3f(0.08, 0.055, 0.04),
                    vec3f(0.3, 1.0, 0.38),
                    fill
                );
                alpha = max(alpha, outer * input.color.a);
            }
        }
        if (alpha <= 0.0) { discard; }
        return vec4f(rgb * alpha, alpha);
    }
    let coverage = 1.0 - smoothstep(-anti_alias_width, anti_alias_width, distance);
    let alpha = input.color.a * coverage;
    var rgb = input.color.rgb;
    if (input.shape_code == RENDER_SHAPE_OCTA
        && input.directional_defense_active != 0u) {
        let oriented = directional_local_position(
            input.local_position,
            input.velocity
        );
        let oriented_length_squared = dot(oriented, oriented);
        let armored_half_angle = 3.0 * 3.141592653589793 / 8.0;
        let armored_sector = oriented_length_squared > SHAPE_DIRECTION_EPSILON
            && dot(
                oriented * inverseSqrt(oriented_length_squared),
                vec2f(0.0, 1.0)
            ) >= cos(armored_half_angle);
        let armor_rim = 1.0 - smoothstep(
            0.09 - anti_alias_width,
            0.09 + anti_alias_width,
            abs(distance)
        );
        if (armored_sector && armor_rim > 0.0) {
            rgb = mix(rgb, vec3f(0.38, 0.94, 1.0), 0.72 * armor_rim);
        }
    }
    return vec4f(rgb * alpha, alpha);
}
`;
