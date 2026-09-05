import {
    GPU_CIRCLE_APPLIED_EVENT_FLAG,
    GPU_CIRCLE_APPLIED_EVENT_TYPE,
    GPU_CIRCLE_ATOMIC_TRANSFORM_CANDIDATE_STATUS,
    GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE,
    GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM,
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    GPU_CIRCLE_BODY_LAYER,
    GPU_CIRCLE_BODY_GAMEPLAY_META,
    GPU_CIRCLE_BODY_SIMULATION_FLAG,
    GPU_CIRCLE_ENEMY_CHARGE_IMPACT_STATUS,
    GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM,
    GPU_CIRCLE_ENEMY_BEHAVIOR_STATE
} from '../gpu_circle_body_abi.js';
import {
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID,
    GAMEPLAY_TEAM_ID
} from '../../../contract/gameplay_team_contract.js';
import {
    ENEMY_ORBIT_PHASE_Q32_SCALE,
    ENEMY_ORBIT_SLOT_CAPACITY
} from '../../../contract/enemy_orbit_directional_defense_contract.js';
import {
    FORMATION_COORDINATE_SYSTEM_CODE
} from '../../../contract/enemy_formation_contract.js';
import {
    THE_TOWER_DATA
} from '../../../../../data/object/tower/the_tower_data.js';
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
} from '../gpu_fixed_primitive_abi.js';
import {
    GPU_EFFECT_DAMAGE_CHANNEL_FLAG,
    GPU_EFFECT_SUMMARY_FLAG
} from '../gpu_effect_runtime_abi.js';
import {
    GPU_TOWER_TARGET_QUERY_FLAG
} from '../gpu_tower_target_query_abi.js';
import {
    MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE
} from '../../../../../data/object/enemy/basic_circle_enemy_data.js';
import {
    GPU_ATOMIC_TRANSFORM_POSITIVE_DAMAGE_HIT_WGSL
} from '../gpu_atomic_transform_positive_damage_hit_shaders.js';
import {
    GPU_COLLISION_GRID_AUTHORITY_WGSL
} from '../gpu_collision_grid_contract.js';
import { toWgslFloat } from './collision_wgsl_values.js';

/** Transient contact marker shared with host event decoding. */
export const GPU_DIRECTIONAL_DEFENSE_CONTACT_MARKER = Object.freeze({
    MAGIC: 0x7fc00040,
    MAGIC_MASK: 0xfffffff0
});

export const COLLISION_COMMON_WGSL = /* wgsl */`
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
const BODY_FLAG_PROJECTILE_CAPTURED: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.PROJECTILE_CAPTURED}u;
// GPU fixed journal에서만 쓰는 한-tick marker입니다. Body ABI stride는 바꾸지 않습니다.
const BODY_FLAG_CONTROLLED_THIS_TICK: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.CONTROLLED_THIS_TICK}u;
const BODY_FLAG_EXTERNAL_MOTION_OWNER_THIS_TICK: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.EXTERNAL_MOTION_OWNER_THIS_TICK}u;
const BODY_FLAG_INTERACTION_ENTER_ONLY: u32 = 256u;
const BODY_FLAG_INTERACTION_CONTINUOUS: u32 = 512u;
// Arrow의 Tower direct ownership은 다음 fixed tick 전에 SDF route clearance를
// 통과해야 합니다. 이 상한은 자료/ABI가 아니라 shader-local deterministic budget입니다.
const ENEMY_CHARGE_VISIBILITY_MAX_STEPS: u32 = 48u;
const ENEMY_CHARGE_IMPACT_FIXED_POINT_SCALE: f32 = 65536.0;
const ENEMY_CHARGE_IMPACT_FIXED_POINT_LIMIT: i32 = 2147000000;
const BODY_LAYER_ENEMY: u32 = 1u;
const BODY_LAYER_PROJECTILE: u32 = ${GPU_CIRCLE_BODY_LAYER.PROJECTILE}u;
const BODY_LAYER_TERRAIN: u32 = ${GPU_CIRCLE_BODY_LAYER.TERRAIN}u;
const BODY_LAYER_CORE_PROXY: u32 = ${GPU_CIRCLE_BODY_LAYER.CORE_PROXY}u;
const BODY_LAYER_PLAYER_DAMAGEABLE: u32 = ${GPU_CIRCLE_BODY_LAYER.PLAYER_DAMAGEABLE}u;
const PLAYER_DAMAGEABLE_INTERACTION_RADIUS_SCALE: f32 = ${toWgslFloat(
    THE_TOWER_DATA.DAMAGEABLE_CONTACT_RADIUS_SCALE
)};
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
const APPLIED_EVENT_FLAG_ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT: u32 = ${GPU_CIRCLE_APPLIED_EVENT_FLAG.ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT}u;
const ATOMIC_TRANSFORM_PROGRAM_J_SPLIT_FIRST_HIT: u32 = ${GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.J_SPLIT_FIRST_HIT}u;
const ATOMIC_TRANSFORM_PHASE_ARMED: u32 = ${GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.ARMED}u;
const ATOMIC_TRANSFORM_PHASE_SPLIT_PENDING: u32 = ${GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.SPLIT_PENDING}u;
const ATOMIC_TRANSFORM_CANDIDATE_STATUS_OK: u32 = ${GPU_CIRCLE_ATOMIC_TRANSFORM_CANDIDATE_STATUS.OK}u;
const ATOMIC_TRANSFORM_CANDIDATE_STATUS_SELECTED_RANK_BASE: u32 = ${GPU_CIRCLE_ATOMIC_TRANSFORM_CANDIDATE_STATUS.SELECTED_RANK_BASE}u;
const ATOMIC_TRANSFORM_CANDIDATE_STATUS_DUPLICATE_EXACT_CONTACT: u32 = ${GPU_CIRCLE_ATOMIC_TRANSFORM_CANDIDATE_STATUS.DUPLICATE_EXACT_CONTACT}u;
const ATOMIC_TRANSFORM_CANDIDATE_STATUS_EVENT_CAPACITY_EXCEEDED: u32 = ${GPU_CIRCLE_ATOMIC_TRANSFORM_CANDIDATE_STATUS.EVENT_CAPACITY_EXCEEDED}u;
const ATOMIC_TRANSFORM_CANDIDATE_STATUS_SOURCE_BUDGET_RESERVATION_FAILED: u32 = ${GPU_CIRCLE_ATOMIC_TRANSFORM_CANDIDATE_STATUS.SOURCE_BUDGET_RESERVATION_FAILED}u;
const ATOMIC_TRANSFORM_CANDIDATE_STATUS_PHASE_COMPARE_EXCHANGE_FAILED: u32 = ${GPU_CIRCLE_ATOMIC_TRANSFORM_CANDIDATE_STATUS.PHASE_COMPARE_EXCHANGE_FAILED}u;
const ATOMIC_TRANSFORM_FIRST_HIT_MARKER_WINNER: u32 = 0x7fc00050u;
const ATOMIC_TRANSFORM_FIRST_HIT_MARKER_SHIELD: u32 = 0x7fc00051u;
const PROJECTILE_CAPTURE_PREPARED_SHIELD: u32 = 0x7fc00052u;
const ENEMY_CHARGE_DISARMED_SHIELD: u32 = 0x7fc00053u;
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
const ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_VALID: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.SELECTED_TARGET_VALID}u;
const ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_CORE: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.SELECTED_TARGET_CORE}u;
const ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_TOWER: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.SELECTED_TARGET_TOWER}u;
const ENEMY_BEHAVIOR_FLAG_DIRECTIONAL_DEFENSE_ACTIVE: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.DIRECTIONAL_DEFENSE_ACTIVE}u;
const ENEMY_CHARGE_IMPACT_STATUS_EMPTY: u32 = ${GPU_CIRCLE_ENEMY_CHARGE_IMPACT_STATUS.EMPTY}u;
const ENEMY_CHARGE_IMPACT_STATUS_CAPTURED: u32 = ${GPU_CIRCLE_ENEMY_CHARGE_IMPACT_STATUS.CAPTURED}u;
const ENEMY_CHARGE_IMPACT_STATUS_RESOLVED: u32 = ${GPU_CIRCLE_ENEMY_CHARGE_IMPACT_STATUS.RESOLVED}u;
const TOWER_TARGET_QUERY_FLAG_VALID: u32 = ${GPU_TOWER_TARGET_QUERY_FLAG.VALID}u;
const TOWER_TARGET_QUERY_FLAG_SOURCE_VALID: u32 = ${GPU_TOWER_TARGET_QUERY_FLAG.SOURCE_VALID}u;
const TOWER_TARGET_QUERY_FLAG_ROSTER_CHANGED: u32 = ${GPU_TOWER_TARGET_QUERY_FLAG.ROSTER_CHANGED}u;
// Arrow program-local latch. It intentionally stays out of the public behavior
// flag enum/host input: this private bit is not part of the 96-byte host vocabulary
// only distinguishes the first direct->route handoff from later route ticks.
const ENEMY_BEHAVIOR_FLAG_ARROW_ROUTE_FALLBACK: u32 = 128u;
const ENEMY_ORBIT_COORDINATE_SYSTEM_RING_SLOTS: u32 = ${FORMATION_COORDINATE_SYSTEM_CODE.RING_SLOTS}u;
const ENEMY_ORBIT_SLOT_CAPACITY: u32 = ${ENEMY_ORBIT_SLOT_CAPACITY}u;
const ENEMY_ORBIT_PHASE_RADIANS_PER_Q32: f32 = ${toWgslFloat(
    (Math.PI * 2) / ENEMY_ORBIT_PHASE_Q32_SCALE
)};
// RING_SLOTS global clock의 phase 0에서 slot 0을 서쪽 기준 반경에 둡니다.
// 이후 모든 slot은 같은 fixed-tick Q32 phase로 함께 회전합니다.
const ENEMY_ORBIT_SLOT_ZERO_PHASE_Q32: u32 = 0x80000000u;
const EFFECT_DAMAGE_CHANNEL_PROJECTILE_TOWER: u32 = ${GPU_EFFECT_DAMAGE_CHANNEL_FLAG.PROJECTILE_TOWER}u;
const EFFECT_DAMAGE_CHANNEL_DIRECT_CORE_IMPACT: u32 = ${GPU_EFFECT_DAMAGE_CHANNEL_FLAG.DIRECT_CORE_IMPACT}u;
const EFFECT_DAMAGE_CHANNEL_PROJECTILE_CORE: u32 = ${GPU_EFFECT_DAMAGE_CHANNEL_FLAG.PROJECTILE_CORE}u;
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
    direct_core_damage_fixed_point: i32,
    reserved_1: u32,
    reserved_2: u32,
    reserved_3: u32,
}

struct CombatStateBuffer { values: array<CombatState> }

struct AtomicTransformState {
    program_id: u32,
    phase: atomic<u32>,
    entity_id: u32,
    incarnation: u32,
    due_fixed_tick: u32,
    lineage_root_entity_id: u32,
    lineage_root_incarnation: u32,
    branch_index: u32,
    bounty_budget: u32,
    trigger_source_tick: atomic<u32>,
    trigger_sequence: atomic<u32>,
    command_generation: atomic<u32>,
}

struct AtomicTransformStateBuffer { values: array<AtomicTransformState> }

struct AtomicTransformCandidate {
    source_entity_id: atomic<u32>,
    contact_index: atomic<u32>,
    match_count: atomic<u32>,
    status: atomic<u32>,
}

struct AtomicTransformCandidateBuffer {
    values: array<AtomicTransformCandidate>,
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
    impact_restitution: f32,
    windup_ticks: u32,
    charge_max_ticks: u32,
    recoil_ticks: u32,
    recover_ticks: u32,
    telegraph_style_code: u32,
    telegraph_color_rgba8: u32,
    telegraph_radius_scale: f32,
    deprecated_charge_acceleration: f32,
    impact_tangential_retention: f32,
    recoil_damping: f32,
    recoil_sleep_threshold: f32,
}

struct EnemyBehaviorStateBuffer { values: array<EnemyBehaviorState> }

struct EnemyChargeImpactState {
    selected_contact_index: atomic<u32>,
    status: atomic<u32>,
    captured_fixed_tick: u32,
    arrow_slot: u32,
    tower_slot: u32,
    arrow_entity_id: u32,
    arrow_incarnation: u32,
    tower_entity_id: u32,
    tower_incarnation: u32,
    contact_normal: vec2f,
    pre_impact_relative_velocity: vec2f,
    arrow_inverse_mass: f32,
    tower_inverse_mass: f32,
    velocity_delta_x_fixed_point: atomic<i32>,
    velocity_delta_y_fixed_point: atomic<i32>,
}

struct EnemyChargeImpactStateBuffer {
    values: array<EnemyChargeImpactState>,
}

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

struct ProjectileCaptureState {
    role_phase_profile_policy: u32,
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

struct EffectSummaryBuffer { values: array<EffectSummary> }
struct FormationStateBuffer { values: array<FormationState> }
struct ProjectileCaptureStateBuffer { values: array<ProjectileCaptureState> }

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
    atomic_transform_candidate_count: atomic<u32>,
    atomic_transform_event_base: atomic<u32>,
    atomic_transform_protocol_status: atomic<u32>,
    atomic_transform_committed_count: atomic<u32>,
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

struct TowerTargetQueryResultBuffer { values: array<TowerTargetQueryResult> }

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
@group(0) @binding(13) var<storage, read> tower_target_queries: TowerTargetQueryResultBuffer;
@group(0) @binding(14) var<storage, read_write> atomic_transform_states: AtomicTransformStateBuffer;
@group(0) @binding(15) var<storage, read_write> atomic_transform_candidates: AtomicTransformCandidateBuffer;
@group(0) @binding(16) var<storage, read_write> enemy_charge_impacts: EnemyChargeImpactStateBuffer;
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

fn body_interaction_radius_values(radius: f32, interaction_meta: u32) -> f32 {
    if (body_interaction_layer(interaction_meta)
        == BODY_LAYER_PLAYER_DAMAGEABLE) {
        // 물리 collider는 그대로 유지하고 피해 접촉에만 작은 skin을 둡니다.
        // solver가 정확한 접선으로 분리해도 Enemy/Tower 접촉이 끊기지 않습니다.
        return radius * PLAYER_DAMAGEABLE_INTERACTION_RADIUS_SCALE;
    }
    return radius;
}

fn body_interaction_radius(body: GridBody) -> f32 {
    return body_interaction_radius_values(body.radius, body.interaction_meta);
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

fn body_id_is_simulation_active(body_id: u32) -> bool {
    let flags = load_simulation_flags(body_id);
    return body_is_alive(flags)
        && !body_has_flag(flags, BODY_FLAG_PROJECTILE_CAPTURED);
}

${GPU_ATOMIC_TRANSFORM_POSITIVE_DAMAGE_HIT_WGSL}

fn effect_attack_multiplier_for_channel(
    source_slot: u32,
    damage_channel_flag: u32
) -> f32 {
    let source_identity_matches = effect_summaries.values[source_slot].entity_id
            == simulations.values[source_slot].entity_id
        && effect_summaries.values[source_slot].incarnation
            == simulations.values[source_slot].incarnation;
    if (!source_identity_matches) {
        return 1.0;
    }
    let damage_is_modifiable = (atomicLoad(
        &effect_summaries.values[source_slot].flags
    ) & damage_channel_flag) != 0u;
    return select(
        1.0,
        max(effect_summaries.values[source_slot].attack_multiplier, 0.0),
        damage_is_modifiable
    );
}

fn snapshot_projectile_attack_damage(
    source_slot: u32,
    destination_slot: u32,
    damage_channel_flag: u32
) {
    let destination_identity_matches =
        effect_summaries.values[destination_slot].entity_id
            == simulations.values[destination_slot].entity_id
        && effect_summaries.values[destination_slot].incarnation
            == simulations.values[destination_slot].incarnation;
    if (!destination_identity_matches) {
        return;
    }
    let source_attack_multiplier = effect_attack_multiplier_for_channel(
        source_slot,
        damage_channel_flag
    );
    if (damage_channel_flag == EFFECT_DAMAGE_CHANNEL_PROJECTILE_CORE) {
        let authored_core_damage_fixed_point = max(bitcast<i32>(
            enemy_behavior_states.values[destination_slot].windup_range
        ), 0);
        let resolved_core_damage_fixed_point = max(i32(
            f32(authored_core_damage_fixed_point) * source_attack_multiplier
        ), 0);
        enemy_behavior_states.values[destination_slot].windup_range
            = bitcast<f32>(resolved_core_damage_fixed_point);
    } else {
        effect_summaries.values[destination_slot].resolved_base_damage_other = max(
            effect_summaries.values[destination_slot].authored_damage_other
                * source_attack_multiplier,
            0.0
        );
    }
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

fn flow_integration_cost(field_index: u32, cell: vec2i) -> f32 {
    return textureLoad(world_flow, cell, i32(field_index), 0).z;
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

fn route_stage_transition_reached(
    field_index: u32,
    start: vec2f,
    end: vec2f,
    stage: FlowStage
) -> bool {
    if (stage.next_field_index < 0) {
        return segment_intersects_transition_circle(
            start,
            end,
            stage.goal_position,
            stage.transition_radius
        );
    }
    let current_cost = flow_integration_cost(
        field_index,
        flow_cell_for_position(end)
    );
    let goal_cost = flow_integration_cost(
        field_index,
        flow_cell_for_position(stage.goal_position)
    );
    // Legacy/test atlases without an integration plane retain the prior circle
    // transition. Generated route-wide fields advance on monotonic path cost,
    // so an entire corridor lane crosses a stage without steering to its center.
    if (current_cost >= 1e19 || goal_cost >= 1e19) {
        return segment_intersects_transition_circle(
            start,
            end,
            stage.goal_position,
            stage.transition_radius
        );
    }
    return current_cost <= goal_cost + 0.0001;
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

${GPU_COLLISION_GRID_AUTHORITY_WGSL}

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

`;
