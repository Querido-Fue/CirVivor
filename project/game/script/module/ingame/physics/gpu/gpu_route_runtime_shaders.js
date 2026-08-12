import {
    GPU_CIRCLE_APPLIED_EVENT_TYPE,
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_LAYER,
    GPU_CIRCLE_BODY_SIMULATION_FLAG
} from './gpu_circle_body_abi.js';
import {
    GPU_ROUTE_AVAILABILITY_STATE,
    GPU_ROUTE_LIFECYCLE_ABI_VERSION,
    GPU_ROUTE_RUNTIME_ABI_VERSION,
    GPU_ROUTE_RUNTIME_ACTION,
    GPU_ROUTE_RUNTIME_FLAG,
    GPU_ROUTE_RUNTIME_MAX_CLOSERS,
    GPU_ROUTE_RUNTIME_PHASE,
    GPU_ROUTE_RUNTIME_ROLE,
    GPU_ROUTE_RUNTIME_STATUS
} from './gpu_route_runtime_abi.js';

const w = (value) => `${value >>> 0}u`;

/**
 * RouteRuntime은 기존 flow-field atlas의 numeric topology만 읽습니다. Navigation
 * pass와 single-invocation finalize pass가 같은 9-storage profile을 공유하므로
 * maxStorageBuffersPerShaderStage=9를 넘기지 않습니다.
 */
export const GPU_ROUTE_RUNTIME_WGSL = /* wgsl */`
const BODY_ABI_VERSION: u32 = ${w(GPU_CIRCLE_BODY_ABI_VERSION)};
const ROUTE_ABI_VERSION: u32 = ${w(GPU_ROUTE_RUNTIME_ABI_VERSION)};
const ROUTE_LIFECYCLE_ABI_VERSION: u32 = ${w(GPU_ROUTE_LIFECYCLE_ABI_VERSION)};
const INVALID: u32 = 0xffffffffu;
const INT32_MAX_U32: u32 = 0x7fffffffu;
const MAX_GRAPH_RECORDS: u32 = 256u;
const MAX_CLOSERS: u32 = ${w(GPU_ROUTE_RUNTIME_MAX_CLOSERS)};
const MAX_ACTIONS: u32 = 32u;

const BODY_FLAG_ALIVE: u32 = ${w(GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE)};
const BODY_FLAG_USE_FLOW: u32 = ${w(GPU_CIRCLE_BODY_SIMULATION_FLAG.USE_FLOW)};
const BODY_FLAG_CONTROLLED_THIS_TICK: u32 = ${w(
    GPU_CIRCLE_BODY_SIMULATION_FLAG.CONTROLLED_THIS_TICK
)};
const BODY_FLAG_EXTERNAL_MOTION_OWNER_THIS_TICK: u32 = ${w(
    GPU_CIRCLE_BODY_SIMULATION_FLAG.EXTERNAL_MOTION_OWNER_THIS_TICK
)};
const BODY_LAYER_ENEMY: u32 = ${w(GPU_CIRCLE_BODY_LAYER.ENEMY)};
const BODY_LAYER_KINEMATIC: u32 = ${w(GPU_CIRCLE_BODY_LAYER.KINEMATIC_OBSTACLE)};
const BODY_LAYER_ROUTE_BLOCKER: u32 = ${w(GPU_CIRCLE_BODY_LAYER.ROUTE_BLOCKER)};

const ROLE_NONE: u32 = ${w(GPU_ROUTE_RUNTIME_ROLE.NONE)};
const ROLE_ACTOR: u32 = ${w(GPU_ROUTE_RUNTIME_ROLE.ACTOR)};
const ROLE_CLOSER: u32 = ${w(GPU_ROUTE_RUNTIME_ROLE.CLOSER)};
const PHASE_NONE: u32 = ${w(GPU_ROUTE_RUNTIME_PHASE.NONE)};
const PHASE_SELECT_ROUTE: u32 = ${w(GPU_ROUTE_RUNTIME_PHASE.SELECT_ROUTE)};
const PHASE_TRAVEL: u32 = ${w(GPU_ROUTE_RUNTIME_PHASE.TRAVEL)};
const PHASE_EXPAND: u32 = ${w(GPU_ROUTE_RUNTIME_PHASE.EXPAND)};
const PHASE_READY_TO_CLOSE: u32 = ${w(GPU_ROUTE_RUNTIME_PHASE.READY_TO_CLOSE)};
const PHASE_BLOCKING: u32 = ${w(GPU_ROUTE_RUNTIME_PHASE.BLOCKING)};
const PHASE_WAITING: u32 = ${w(GPU_ROUTE_RUNTIME_PHASE.WAITING)};
const PHASE_DEAD: u32 = ${w(GPU_ROUTE_RUNTIME_PHASE.DEAD)};

const FLAG_GRAPH_ENABLED: u32 = ${w(GPU_ROUTE_RUNTIME_FLAG.GRAPH_ENABLED)};
const FLAG_REROUTE_PENDING: u32 = ${w(GPU_ROUTE_RUNTIME_FLAG.REROUTE_PENDING)};
const FLAG_WAITING_CLEARANCE: u32 = ${w(GPU_ROUTE_RUNTIME_FLAG.WAITING_CLEARANCE)};
const FLAG_BLOCKER_ACTIVE: u32 = ${w(GPU_ROUTE_RUNTIME_FLAG.BLOCKER_ACTIVE)};
const FLAG_DEFERRED_FLOW_RESUME: u32 = ${w(
    GPU_ROUTE_RUNTIME_FLAG.DEFERRED_FLOW_RESUME
)};

const AVAILABILITY_OPEN: u32 = ${w(GPU_ROUTE_AVAILABILITY_STATE.OPEN)};
const AVAILABILITY_LEASED: u32 = ${w(GPU_ROUTE_AVAILABILITY_STATE.LEASED)};
const AVAILABILITY_CLOSED: u32 = ${w(GPU_ROUTE_AVAILABILITY_STATE.CLOSED)};

const ACTION_ASSIGNED: u32 = ${w(GPU_ROUTE_RUNTIME_ACTION.ASSIGNED)};
const ACTION_CLOSED: u32 = ${w(GPU_ROUTE_RUNTIME_ACTION.CLOSED)};
const ACTION_REOPENED: u32 = ${w(GPU_ROUTE_RUNTIME_ACTION.REOPENED)};
const ACTION_CLEANED: u32 = ${w(GPU_ROUTE_RUNTIME_ACTION.CLEANED)};

const STATUS_ABI_MISMATCH: u32 = ${w(GPU_ROUTE_RUNTIME_STATUS.ABI_MISMATCH)};
const STATUS_RECORD_INVALID: u32 = ${w(GPU_ROUTE_RUNTIME_STATUS.RECORD_INVALID)};
const STATUS_CLOSER_CAPACITY: u32 = ${w(
    GPU_ROUTE_RUNTIME_STATUS.CLOSER_CAPACITY_EXCEEDED
)};
const STATUS_EVENT_CAPACITY: u32 = ${w(
    GPU_ROUTE_RUNTIME_STATUS.EVENT_CAPACITY_EXCEEDED
)};
const STATUS_CLEANUP_INVALID: u32 = ${w(GPU_ROUTE_RUNTIME_STATUS.CLEANUP_INVALID)};
const STATUS_VERSION_EXHAUSTED: u32 = ${w(
    GPU_ROUTE_RUNTIME_STATUS.AVAILABILITY_VERSION_EXHAUSTED
)};
const STATUS_LEASE_EXHAUSTED: u32 = ${w(
    GPU_ROUTE_RUNTIME_STATUS.LEASE_GENERATION_EXHAUSTED
)};
const STATUS_TOPOLOGY_INVALID: u32 = ${w(GPU_ROUTE_RUNTIME_STATUS.TOPOLOGY_INVALID)};

const EVENT_ROUTE_ASSIGNED: u32 = ${w(GPU_CIRCLE_APPLIED_EVENT_TYPE.ROUTE_ASSIGNED)};
const EVENT_ROUTE_CLOSED: u32 = ${w(GPU_CIRCLE_APPLIED_EVENT_TYPE.ROUTE_CLOSED)};
const EVENT_ROUTE_REOPENED: u32 = ${w(GPU_CIRCLE_APPLIED_EVENT_TYPE.ROUTE_REOPENED)};
const EVENT_ROUTE_CLEANED: u32 = ${w(GPU_CIRCLE_APPLIED_EVENT_TYPE.ROUTE_CLEANED)};

const TOPOLOGY_ABI_VERSION: u32 = 0u;
const TOPOLOGY_ENABLED: u32 = 1u;
const TOPOLOGY_CONTENT_FINGERPRINT: u32 = 2u;
const TOPOLOGY_PATH_COUNT: u32 = 3u;
const TOPOLOGY_ROUTE_SET_COUNT: u32 = 4u;
const TOPOLOGY_CANDIDATE_COUNT: u32 = 5u;
const TOPOLOGY_FIELD_COUNT: u32 = 6u;
const TOPOLOGY_SWITCH_COUNT: u32 = 7u;
const TOPOLOGY_TRANSITION_COUNT: u32 = 8u;
const TOPOLOGY_CLOSURE_COUNT: u32 = 9u;
const TOPOLOGY_PATH_OFFSET: u32 = 10u;
const TOPOLOGY_ROUTE_SET_OFFSET: u32 = 11u;
const TOPOLOGY_CANDIDATE_OFFSET: u32 = 12u;
const TOPOLOGY_FIELD_OFFSET: u32 = 13u;
const TOPOLOGY_SWITCH_OFFSET: u32 = 14u;
const TOPOLOGY_TRANSITION_OFFSET: u32 = 15u;
const TOPOLOGY_CLOSURE_OFFSET: u32 = 16u;
const PATH_STRIDE: u32 = 8u;
const ROUTE_SET_STRIDE: u32 = 4u;
const CANDIDATE_STRIDE: u32 = 4u;
const FIELD_STRIDE: u32 = 12u;
const SWITCH_STRIDE: u32 = 4u;
const TRANSITION_STRIDE: u32 = 8u;
const CLOSURE_STRIDE: u32 = 16u;

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

struct RouteRuntimeState {
    packed_meta: u32,
    self_entity_id: u32,
    self_incarnation: u32,
    current_path_index: u32,
    route_set_index: u32,
    closure_index: u32,
    observed_availability_version: u32,
    phase_entered_fixed_tick: u32,
    travel_radius: f32,
    blocker_radius: f32,
    expansion_duration_fixed_ticks: u32,
    pending_field_index: u32,
    lease_generation: u32,
    profile_code: u32,
    reserved_0: u32,
    reserved_1: u32,
}

struct RouteAvailabilityRecord {
    state: u32,
    owner_slot: u32,
    owner_entity_id: u32,
    owner_incarnation: u32,
    lease_generation: u32,
    changed_at_fixed_tick: u32,
    reserved_0: u32,
    reserved_1: u32,
}

struct RouteAvailabilityBuffer {
    abi_version: u32,
    status: u32,
    availability_version: u32,
    source_tick: u32,
    completed_through_tick: u32,
    terminal_flags: u32,
    graph_content_fingerprint: u32,
    closure_count: u32,
    session_generation: u32,
    device_generation: u32,
    authoritative_epoch: u32,
    next_lease_generation: u32,
    last_event_base: u32,
    last_event_count: u32,
    reserved_0: u32,
    reserved_1: u32,
    records: array<RouteAvailabilityRecord>,
}

struct RouteCleanupRecord {
    body_slot: u32,
    entity_id: u32,
    incarnation: u32,
    closure_index: u32,
    lease_generation: u32,
    observed_availability_version: u32,
    command_id_fingerprint: u32,
    reserved_0: u32,
}

struct RouteCleanupProgram {
    abi_version: u32,
    target_fixed_tick: u32,
    record_count: u32,
    status: u32,
    batch_id_fingerprint: u32,
    reserved_0: u32,
    reserved_1: u32,
    reserved_2: u32,
    records: array<RouteCleanupRecord>,
}

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

struct AppliedEvent {
    subject_entity_id: u32,
    subject_incarnation: u32,
    other_entity_id: u32,
    other_incarnation: u32,
    value_fixed_point: i32,
    event_meta: u32,
    world_position: vec2f,
}

struct RouteParams {
    abi_version: u32,
    fixed_tick: u32,
    max_events: u32,
    terminal_final_submit: u32,
    fixed_delta: f32,
    reserved_0: u32,
    reserved_1: u32,
    reserved_2: u32,
}

struct RouteAction {
    kind: u32,
    body_slot: u32,
    entity_id: u32,
    incarnation: u32,
    closure_index: u32,
    path_index: u32,
    lease_generation: u32,
    availability_version: u32,
}

struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct TemporaryBuffer { values: array<BodyTemporary> }
struct RouteStateBuffer { values: array<RouteRuntimeState> }
struct RawTopologyBuffer { values: array<u32> }
struct AppliedEventBuffer { values: array<AppliedEvent> }

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read_write> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(3) var<storage, read_write> route_states: RouteStateBuffer;
@group(0) @binding(4) var<storage, read> topology: RawTopologyBuffer;
@group(0) @binding(5) var<storage, read_write> availability: RouteAvailabilityBuffer;
@group(0) @binding(6) var<storage, read_write> cleanup_program: RouteCleanupProgram;
@group(0) @binding(7) var<storage, read_write> contact_state: ContactState;
@group(0) @binding(8) var<storage, read_write> applied_events: AppliedEventBuffer;
@group(0) @binding(9) var<uniform> params: RouteParams;
@group(0) @binding(10) var<storage, read_write> temporaries: TemporaryBuffer;

fn role_of(packed_meta: u32) -> u32 { return packed_meta & 255u; }
fn phase_of(packed_meta: u32) -> u32 { return (packed_meta >> 8u) & 255u; }
fn flags_of(packed_meta: u32) -> u32 { return packed_meta >> 16u; }
fn pack_meta(role: u32, phase: u32, flags: u32) -> u32 {
    return role | (phase << 8u) | (flags << 16u);
}
fn set_phase(state: ptr<storage, RouteRuntimeState, read_write>, phase: u32) {
    (*state).packed_meta = pack_meta(
        role_of((*state).packed_meta),
        phase,
        flags_of((*state).packed_meta)
    );
}
fn set_route_flags(state: ptr<storage, RouteRuntimeState, read_write>, flags: u32) {
    (*state).packed_meta = pack_meta(
        role_of((*state).packed_meta),
        phase_of((*state).packed_meta),
        flags
    );
}
fn is_alive(body_slot: u32) -> bool {
    return body_slot < counts.body_count
        && (atomicLoad(&simulations.values[body_slot].flags) & BODY_FLAG_ALIVE) != 0u;
}
fn exact_body_identity(body_slot: u32, entity_id: u32, incarnation: u32) -> bool {
    return body_slot < counts.body_count
        && simulations.values[body_slot].entity_id == entity_id
        && simulations.values[body_slot].incarnation == incarnation
        && route_states.values[body_slot].self_entity_id == entity_id
        && route_states.values[body_slot].self_incarnation == incarnation;
}
fn path_base(path_index: u32) -> u32 {
    return topology.values[TOPOLOGY_PATH_OFFSET] + path_index * PATH_STRIDE;
}
fn route_set_base(route_set_index: u32) -> u32 {
    return topology.values[TOPOLOGY_ROUTE_SET_OFFSET]
        + route_set_index * ROUTE_SET_STRIDE;
}
fn candidate_base(candidate_index: u32) -> u32 {
    return topology.values[TOPOLOGY_CANDIDATE_OFFSET]
        + candidate_index * CANDIDATE_STRIDE;
}
fn field_base(field_index: u32) -> u32 {
    return topology.values[TOPOLOGY_FIELD_OFFSET] + field_index * FIELD_STRIDE;
}
fn switch_base(switch_index: u32) -> u32 {
    return topology.values[TOPOLOGY_SWITCH_OFFSET] + switch_index * SWITCH_STRIDE;
}
fn transition_base(transition_index: u32) -> u32 {
    return topology.values[TOPOLOGY_TRANSITION_OFFSET]
        + transition_index * TRANSITION_STRIDE;
}
fn closure_base(closure_index: u32) -> u32 {
    return topology.values[TOPOLOGY_CLOSURE_OFFSET]
        + closure_index * CLOSURE_STRIDE;
}
fn closure_position(closure_index: u32) -> vec2f {
    let base = closure_base(closure_index);
    return vec2f(
        bitcast<f32>(topology.values[base + 11u]),
        bitcast<f32>(topology.values[base + 12u])
    );
}
fn field_position(field_index: u32) -> vec2f {
    let base = field_base(field_index);
    return vec2f(
        bitcast<f32>(topology.values[base + 6u]),
        bitcast<f32>(topology.values[base + 7u])
    );
}
fn field_transition_radius(field_index: u32) -> f32 {
    return bitcast<f32>(topology.values[field_base(field_index) + 8u]);
}
fn at_field_goal(body_slot: u32, field_index: u32) -> bool {
    let delta = physics.values[body_slot].position - field_position(field_index);
    let radius = field_transition_radius(field_index);
    return dot(delta, delta) <= radius * radius;
}
fn path_closure(path_index: u32) -> u32 {
    return topology.values[path_base(path_index) + 5u];
}
fn path_available_to_actor(path_index: u32) -> bool {
    let closure_index = path_closure(path_index);
    return closure_index == INVALID
        || availability.records[closure_index].state != AVAILABILITY_CLOSED;
}
fn choose_actor_path(route_set_index: u32) -> u32 {
    if (route_set_index >= topology.values[TOPOLOGY_ROUTE_SET_COUNT]) { return INVALID; }
    let base = route_set_base(route_set_index);
    let first = topology.values[base + 1u];
    let count = topology.values[base + 2u];
    var selected = INVALID;
    var selected_priority = INVALID;
    for (var index = first; index < first + count; index++) {
        let candidate = candidate_base(index);
        let path_index = topology.values[candidate];
        let priority = topology.values[candidate + 1u];
        if (path_available_to_actor(path_index)
            && (selected == INVALID || priority < selected_priority
                || (priority == selected_priority && path_index < selected))) {
            selected = path_index;
            selected_priority = priority;
        }
    }
    return selected;
}
fn first_path_field(path_index: u32) -> u32 {
    return topology.values[path_base(path_index) + 1u];
}
fn set_actor_path(body_slot: u32, path_index: u32, target_field_index: u32) {
    route_states.values[body_slot].current_path_index = path_index;
    route_states.values[body_slot].pending_field_index = INVALID;
    route_states.values[body_slot].reserved_0 = 0u;
    route_states.values[body_slot].reserved_1 = 0u;
    route_states.values[body_slot].observed_availability_version
        = availability.availability_version;
    let old_flags = flags_of(route_states.values[body_slot].packed_meta);
    route_states.values[body_slot].packed_meta = pack_meta(
        ROLE_ACTOR,
        PHASE_TRAVEL,
        (old_flags | FLAG_GRAPH_ENABLED)
            & ~(FLAG_REROUTE_PENDING | FLAG_WAITING_CLEARANCE)
    );
    simulations.values[body_slot].flow_field_index = target_field_index;
    // External fixed/O/Arrow/M control owns this tick's motion. Route state may
    // advance, but flow steering resumes only when that explicit ownership ends.
    if ((atomicLoad(&simulations.values[body_slot].flags)
            & (BODY_FLAG_CONTROLLED_THIS_TICK
                | BODY_FLAG_EXTERNAL_MOTION_OWNER_THIS_TICK)) == 0u) {
        atomicOr(&simulations.values[body_slot].flags, BODY_FLAG_USE_FLOW);
        set_route_flags(
            &route_states.values[body_slot],
            flags_of(route_states.values[body_slot].packed_meta)
                & ~FLAG_DEFERRED_FLOW_RESUME
        );
    } else {
        atomicAnd(&simulations.values[body_slot].flags, ~BODY_FLAG_USE_FLOW);
        set_route_flags(
            &route_states.values[body_slot],
            flags_of(route_states.values[body_slot].packed_meta)
                | FLAG_DEFERRED_FLOW_RESUME
        );
    }
}

fn enter_route_owned_wait(
    body_slot: u32,
    state: ptr<storage, RouteRuntimeState, read_write>,
    pending_field_index: u32
) {
    let base_velocity = physics.values[body_slot].velocity;
    let finite_base_velocity = all(base_velocity == base_velocity)
        && all(abs(base_velocity) <= vec2f(1000000.0));
    (*state).reserved_0 = bitcast<u32>(select(0.0, base_velocity.x, finite_base_velocity));
    (*state).reserved_1 = bitcast<u32>(select(0.0, base_velocity.y, finite_base_velocity));
    (*state).pending_field_index = pending_field_index;
    set_route_flags(
        state,
        flags_of((*state).packed_meta) & ~FLAG_DEFERRED_FLOW_RESUME
    );
    atomicAnd(&simulations.values[body_slot].flags, ~BODY_FLAG_USE_FLOW);
    set_phase(state, PHASE_WAITING);
}

fn restore_route_wait_base_velocity(body_slot: u32, state: RouteRuntimeState) {
    physics.values[body_slot].velocity = vec2f(
        bitcast<f32>(state.reserved_0),
        bitcast<f32>(state.reserved_1)
    );
}
fn choose_open_transition(current_path: u32, switch_index: u32) -> vec2u {
    if (switch_index >= topology.values[TOPOLOGY_SWITCH_COUNT]) {
        return vec2u(INVALID, INVALID);
    }
    let base = switch_base(switch_index);
    let first = topology.values[base + 2u];
    let count = topology.values[base + 3u];
    var selected_path = INVALID;
    var selected_field = INVALID;
    var selected_priority = INVALID;
    for (var index = first; index < first + count; index++) {
        let transition = transition_base(index);
        let from_path = topology.values[transition + 1u];
        let to_path = topology.values[transition + 2u];
        let target_field = topology.values[transition + 4u];
        let priority = topology.values[transition + 5u];
        if (from_path == current_path && path_available_to_actor(to_path)
            && (selected_path == INVALID || priority < selected_priority
                || (priority == selected_priority && to_path < selected_path))) {
            selected_path = to_path;
            selected_field = target_field;
            selected_priority = priority;
        }
    }
    return vec2u(selected_path, selected_field);
}
fn make_nonblocking_enemy(body_slot: u32) {
    physics.values[body_slot].physical_meta = BODY_LAYER_ENEMY;
}
fn make_route_blocker(body_slot: u32) {
    physics.values[body_slot].physical_meta = BODY_LAYER_ROUTE_BLOCKER
        | ((BODY_LAYER_ENEMY | BODY_LAYER_KINEMATIC) << 16u);
}
fn anchor_closer(body_slot: u32, closure_index: u32) {
    let position = closure_position(closure_index);
    physics.values[body_slot].position = position;
    physics.values[body_slot].velocity = vec2f(0.0);
    physics.values[body_slot].inverse_mass = 0.0;
    atomicAnd(&simulations.values[body_slot].flags, ~BODY_FLAG_USE_FLOW);
}

@compute @workgroup_size(256)
fn advance_route_runtime(@builtin(global_invocation_id) global_id: vec3u) {
    let body_slot = global_id.x;
    if (body_slot >= counts.body_count
        || counts.abi_version != BODY_ABI_VERSION
        || params.abi_version != ROUTE_ABI_VERSION
        || topology.values[TOPOLOGY_ABI_VERSION] != ROUTE_ABI_VERSION
        || topology.values[TOPOLOGY_ENABLED] == 0u
        || params.terminal_final_submit != 0u
        || !is_alive(body_slot)) {
        return;
    }
    let state = &route_states.values[body_slot];
    let role = role_of((*state).packed_meta);
    var phase = phase_of((*state).packed_meta);
    if (role == ROLE_NONE
        || (*state).self_entity_id != simulations.values[body_slot].entity_id
        || (*state).self_incarnation != simulations.values[body_slot].incarnation) {
        return;
    }
    if (role == ROLE_ACTOR) {
        let external_control_owns_motion
            = (atomicLoad(&simulations.values[body_slot].flags)
                & (BODY_FLAG_CONTROLLED_THIS_TICK
                    | BODY_FLAG_EXTERNAL_MOTION_OWNER_THIS_TICK)) != 0u;
        if (phase == PHASE_SELECT_ROUTE) {
            let selected = choose_actor_path((*state).route_set_index);
            if (selected == INVALID) {
                enter_route_owned_wait(body_slot, state, INVALID);
                return;
            }
            set_actor_path(body_slot, selected, first_path_field(selected));
            return;
        }
        let path_index = (*state).current_path_index;
        var closure_index = INVALID;
        if (path_index < topology.values[TOPOLOGY_PATH_COUNT]) {
            closure_index = path_closure(path_index);
        }
        if (phase == PHASE_WAITING) {
            if (path_index >= topology.values[TOPOLOGY_PATH_COUNT]) {
                let selected = choose_actor_path((*state).route_set_index);
                if (selected != INVALID) {
                    set_actor_path(body_slot, selected, first_path_field(selected));
                } else {
                    atomicAnd(&simulations.values[body_slot].flags, ~BODY_FLAG_USE_FLOW);
                    if (!external_control_owns_motion) {
                        restore_route_wait_base_velocity(body_slot, (*state));
                    }
                }
            } else if (closure_index != INVALID
                && availability.records[closure_index].state != AVAILABILITY_CLOSED) {
                let entrance_field = topology.values[closure_base(closure_index) + 2u];
                set_actor_path(body_slot, path_index, entrance_field);
            } else {
                atomicAnd(&simulations.values[body_slot].flags, ~BODY_FLAG_USE_FLOW);
                if (!external_control_owns_motion) {
                    restore_route_wait_base_velocity(body_slot, (*state));
                }
            }
            return;
        }
        if (phase == PHASE_TRAVEL
            && (flags_of((*state).packed_meta)
                & FLAG_DEFERRED_FLOW_RESUME) != 0u
            && !external_control_owns_motion) {
            atomicOr(&simulations.values[body_slot].flags, BODY_FLAG_USE_FLOW);
            set_route_flags(
                state,
                flags_of((*state).packed_meta) & ~FLAG_DEFERRED_FLOW_RESUME
            );
        }
        if (phase != PHASE_TRAVEL || closure_index == INVALID
            || availability.records[closure_index].state != AVAILABILITY_CLOSED) {
            (*state).observed_availability_version = availability.availability_version;
            return;
        }
        let field_index = simulations.values[body_slot].flow_field_index;
        if (field_index >= topology.values[TOPOLOGY_FIELD_COUNT]) { return; }
        let field = field_base(field_index);
        let progress = topology.values[field + 2u];
        let switch_index = topology.values[field + 4u];
        let closure = closure_base(closure_index);
        let upstream_progress = topology.values[closure + 9u];
        let clearance_progress = topology.values[closure + 8u];
        let entrance_progress = topology.values[closure + 7u];
        if (progress <= upstream_progress) {
            set_route_flags(
                state,
                flags_of((*state).packed_meta) | FLAG_REROUTE_PENDING
            );
            if (switch_index != INVALID && at_field_goal(body_slot, field_index)) {
                let selected = choose_open_transition(path_index, switch_index);
                if (selected.x != INVALID) {
                    set_actor_path(body_slot, selected.x, selected.y);
                }
            }
            return;
        }
        if (progress < entrance_progress) {
            let clearance_field = topology.values[closure + 3u];
            (*state).pending_field_index = clearance_field;
            simulations.values[body_slot].flow_field_index = clearance_field;
            set_route_flags(
                state,
                flags_of((*state).packed_meta) | FLAG_WAITING_CLEARANCE
            );
            if (progress >= clearance_progress && at_field_goal(body_slot, clearance_field)) {
                enter_route_owned_wait(body_slot, state, clearance_field);
            }
        } else if (progress == entrance_progress) {
            // Exact entrance is already inside the clearance→entrance segment:
            // never reverse; route-owned wait keeps the current entrance field.
            set_route_flags(
                state,
                flags_of((*state).packed_meta) | FLAG_WAITING_CLEARANCE
            );
            enter_route_owned_wait(body_slot, state, field_index);
        }
        return;
    }
    if (role != ROLE_CLOSER) { return; }
    if (phase == PHASE_TRAVEL) {
        let closure_index = (*state).closure_index;
        if (closure_index >= availability.closure_count) { return; }
        let record = availability.records[closure_index];
        if (record.state != AVAILABILITY_LEASED
            || record.owner_entity_id != (*state).self_entity_id
            || record.owner_incarnation != (*state).self_incarnation
            || record.lease_generation != (*state).lease_generation) {
            return;
        }
        let entrance_field = topology.values[closure_base(closure_index) + 2u];
        simulations.values[body_slot].flow_field_index = entrance_field;
        if (at_field_goal(body_slot, entrance_field)) {
            anchor_closer(body_slot, closure_index);
            physics.values[body_slot].radius = (*state).travel_radius;
            make_nonblocking_enemy(body_slot);
            (*state).phase_entered_fixed_tick = params.fixed_tick;
            set_phase(state, PHASE_EXPAND);
        }
        return;
    }
    if (phase == PHASE_EXPAND || phase == PHASE_READY_TO_CLOSE) {
        let closure_index = (*state).closure_index;
        if (closure_index >= availability.closure_count) { return; }
        anchor_closer(body_slot, closure_index);
        make_nonblocking_enemy(body_slot);
        let elapsed = params.fixed_tick - (*state).phase_entered_fixed_tick;
        let duration = max((*state).expansion_duration_fixed_ticks, 1u);
        let ratio = clamp(f32(min(elapsed, duration)) / f32(duration), 0.0, 1.0);
        physics.values[body_slot].radius = mix(
            (*state).travel_radius,
            (*state).blocker_radius,
            ratio
        );
        if (elapsed >= duration) {
            physics.values[body_slot].radius = (*state).blocker_radius;
            set_phase(state, PHASE_READY_TO_CLOSE);
        }
        return;
    }
    if (phase == PHASE_BLOCKING) {
        anchor_closer(body_slot, (*state).closure_index);
        physics.values[body_slot].radius = (*state).blocker_radius;
        make_route_blocker(body_slot);
    }
}


@compute @workgroup_size(256)
fn enforce_route_owned_wait_after_external_motion(
    @builtin(global_invocation_id) global_id: vec3u
) {
    let body_slot = global_id.x;
    if (body_slot >= counts.body_count
        || counts.abi_version != BODY_ABI_VERSION
        || params.abi_version != ROUTE_ABI_VERSION
        || !is_alive(body_slot)) { return; }
    let state = route_states.values[body_slot];
    let exact_route_actor = role_of(state.packed_meta) == ROLE_ACTOR
        && phase_of(state.packed_meta) == PHASE_WAITING
        && state.self_entity_id == simulations.values[body_slot].entity_id
        && state.self_incarnation == simulations.values[body_slot].incarnation;
    if (!exact_route_actor) { return; }
    atomicAnd(&simulations.values[body_slot].flags, ~BODY_FLAG_USE_FLOW);
    let external_motion_owner = (atomicLoad(&simulations.values[body_slot].flags)
        & (BODY_FLAG_CONTROLLED_THIS_TICK
            | BODY_FLAG_EXTERNAL_MOTION_OWNER_THIS_TICK)) != 0u;
    if (external_motion_owner) { return; }
    physics.values[body_slot].velocity = vec2f(0.0);
    temporaries.values[body_slot].predicted_position
        = physics.values[body_slot].position;
    temporaries.values[body_slot].position_delta = vec2f(0.0);
}

fn push_action(
    actions: ptr<function, array<RouteAction, 32>>,
    action_count: ptr<function, u32>,
    action: RouteAction
) -> bool {
    if ((*action_count) >= MAX_ACTIONS) { return false; }
    (*actions)[*action_count] = action;
    (*action_count) = (*action_count) + 1u;
    return true;
}
fn event_type_for_action(kind: u32) -> u32 {
    if (kind == ACTION_ASSIGNED) { return EVENT_ROUTE_ASSIGNED; }
    if (kind == ACTION_CLOSED) { return EVENT_ROUTE_CLOSED; }
    if (kind == ACTION_REOPENED) { return EVENT_ROUTE_REOPENED; }
    return EVENT_ROUTE_CLEANED;
}

@compute @workgroup_size(1)
fn finalize_route_runtime(@builtin(global_invocation_id) global_id: vec3u) {
    if (global_id.x != 0u) { return; }
    if (counts.abi_version != BODY_ABI_VERSION
        || params.abi_version != ROUTE_ABI_VERSION
        || availability.abi_version != ROUTE_ABI_VERSION
        || topology.values[TOPOLOGY_ABI_VERSION] != ROUTE_ABI_VERSION) {
        availability.status |= STATUS_ABI_MISMATCH;
        return;
    }
    if (topology.values[TOPOLOGY_ENABLED] == 0u) {
        availability.source_tick = params.fixed_tick;
        availability.completed_through_tick = params.fixed_tick;
        availability.last_event_base = atomicLoad(&contact_state.event_count);
        availability.last_event_count = 0u;
        return;
    }
    let closure_count = availability.closure_count;
    if (closure_count != topology.values[TOPOLOGY_CLOSURE_COUNT]
        || closure_count > MAX_GRAPH_RECORDS
        || availability.graph_content_fingerprint
            != topology.values[TOPOLOGY_CONTENT_FINGERPRINT]) {
        availability.status |= STATUS_TOPOLOGY_INVALID;
        return;
    }
    var virtual_state: array<u32, 256>;
    var virtual_owner_slot: array<u32, 256>;
    var virtual_owner_entity: array<u32, 256>;
    var virtual_owner_incarnation: array<u32, 256>;
    var virtual_lease: array<u32, 256>;
    for (var closure_index = 0u; closure_index < closure_count; closure_index++) {
        let record = availability.records[closure_index];
        virtual_state[closure_index] = record.state;
        virtual_owner_slot[closure_index] = record.owner_slot;
        virtual_owner_entity[closure_index] = record.owner_entity_id;
        virtual_owner_incarnation[closure_index] = record.owner_incarnation;
        virtual_lease[closure_index] = record.lease_generation;
    }
    var actions: array<RouteAction, 32>;
    var action_count = 0u;
    var failure = 0u;
    var version_cursor = availability.availability_version;
    var lease_cursor = availability.next_lease_generation;
    if (version_cursor == 0u || version_cursor > INT32_MAX_U32) {
        failure |= STATUS_VERSION_EXHAUSTED;
    }
    if (lease_cursor == 0u || lease_cursor == INVALID) {
        failure |= STATUS_LEASE_EXHAUSTED;
    }

    let cleanup_count = cleanup_program.record_count;
    if (cleanup_count > MAX_CLOSERS
        || (cleanup_count > 0u
            && (cleanup_program.abi_version != ROUTE_LIFECYCLE_ABI_VERSION
                || cleanup_program.target_fixed_tick != params.fixed_tick
                || cleanup_program.batch_id_fingerprint == 0u
                || cleanup_program.batch_id_fingerprint == INVALID))) {
        failure |= STATUS_CLEANUP_INVALID;
    }
    for (var cleanup_index = 0u;
        cleanup_index < cleanup_count && failure == 0u;
        cleanup_index++) {
        let cleanup = cleanup_program.records[cleanup_index];
        if (cleanup.closure_index >= closure_count
            || cleanup.entity_id == INVALID
            || cleanup.incarnation == INVALID
            || cleanup.lease_generation == 0u
            || cleanup.lease_generation == INVALID
            || cleanup.command_id_fingerprint == 0u
            || cleanup.command_id_fingerprint == INVALID) {
            failure |= STATUS_CLEANUP_INVALID;
            break;
        }
        for (var prior = 0u; prior < cleanup_index; prior++) {
            let previous = cleanup_program.records[prior];
            if (previous.entity_id == cleanup.entity_id
                && previous.incarnation == cleanup.incarnation) {
                failure |= STATUS_CLEANUP_INVALID;
            }
        }
        let closure_index = cleanup.closure_index;
        if (cleanup.observed_availability_version
                != availability.availability_version
            || virtual_owner_slot[closure_index] != cleanup.body_slot
            || virtual_owner_entity[closure_index] != cleanup.entity_id
            || virtual_owner_incarnation[closure_index] != cleanup.incarnation
            || virtual_lease[closure_index] != cleanup.lease_generation) {
            failure |= STATUS_CLEANUP_INVALID;
            break;
        }
        if (virtual_state[closure_index] != AVAILABILITY_OPEN) {
            if (version_cursor >= INT32_MAX_U32) {
                failure |= STATUS_VERSION_EXHAUSTED;
                break;
            }
            version_cursor++;
            if (!push_action(&actions, &action_count, RouteAction(
                ACTION_REOPENED,
                cleanup.body_slot,
                cleanup.entity_id,
                cleanup.incarnation,
                closure_index,
                topology.values[closure_base(closure_index) + 1u],
                cleanup.lease_generation,
                version_cursor
            ))) { failure |= STATUS_RECORD_INVALID; break; }
            virtual_state[closure_index] = AVAILABILITY_OPEN;
        }
        if (!push_action(&actions, &action_count, RouteAction(
            ACTION_CLEANED,
            cleanup.body_slot,
            cleanup.entity_id,
            cleanup.incarnation,
            closure_index,
            topology.values[closure_base(closure_index) + 1u],
            cleanup.lease_generation,
            version_cursor
        ))) { failure |= STATUS_RECORD_INVALID; break; }
        virtual_owner_slot[closure_index] = INVALID;
        virtual_owner_entity[closure_index] = INVALID;
        virtual_owner_incarnation[closure_index] = INVALID;
        virtual_lease[closure_index] = 0u;
    }

    var closer_count = 0u;
    var closer_slots: array<u32, 8>;
    for (var body_slot = 0u; body_slot < counts.body_count; body_slot++) {
        let state = route_states.values[body_slot];
        if (role_of(state.packed_meta) == ROLE_CLOSER
            && state.self_entity_id == simulations.values[body_slot].entity_id
            && state.self_incarnation == simulations.values[body_slot].incarnation
            && is_alive(body_slot)) {
            if (closer_count >= MAX_CLOSERS) {
                failure |= STATUS_CLOSER_CAPACITY;
                break;
            }
            closer_slots[closer_count] = body_slot;
            closer_count++;
        }
    }
    for (var index = 1u; index < closer_count; index++) {
        let key = closer_slots[index];
        var cursor = index;
        loop {
            if (cursor == 0u) { break; }
            let previous = closer_slots[cursor - 1u];
            let key_entity = simulations.values[key].entity_id;
            let key_incarnation = simulations.values[key].incarnation;
            let previous_entity = simulations.values[previous].entity_id;
            let previous_incarnation = simulations.values[previous].incarnation;
            if (previous_entity < key_entity
                || (previous_entity == key_entity
                    && previous_incarnation <= key_incarnation)) { break; }
            closer_slots[cursor] = previous;
            cursor--;
        }
        closer_slots[cursor] = key;
    }

    for (var closure_index = 0u;
        closure_index < closure_count && failure == 0u;
        closure_index++) {
        if (virtual_state[closure_index] == AVAILABILITY_OPEN) { continue; }
        var exact_alive = false;
        for (var closer_index = 0u; closer_index < closer_count; closer_index++) {
            let body_slot = closer_slots[closer_index];
            let state = route_states.values[body_slot];
            if (state.self_entity_id == virtual_owner_entity[closure_index]
                && state.self_incarnation == virtual_owner_incarnation[closure_index]
                && state.closure_index == closure_index
                && state.lease_generation == virtual_lease[closure_index]) {
                exact_alive = true;
                virtual_owner_slot[closure_index] = body_slot;
                break;
            }
        }
        if (!exact_alive) {
            if (version_cursor >= INT32_MAX_U32) {
                failure |= STATUS_VERSION_EXHAUSTED;
                break;
            }
            version_cursor++;
            if (!push_action(&actions, &action_count, RouteAction(
                ACTION_REOPENED,
                virtual_owner_slot[closure_index],
                virtual_owner_entity[closure_index],
                virtual_owner_incarnation[closure_index],
                closure_index,
                topology.values[closure_base(closure_index) + 1u],
                virtual_lease[closure_index],
                version_cursor
            ))) { failure |= STATUS_RECORD_INVALID; break; }
            virtual_state[closure_index] = AVAILABILITY_OPEN;
        }
    }

    if (params.terminal_final_submit == 0u) {
        for (var closer_index = 0u;
            closer_index < closer_count && failure == 0u;
            closer_index++) {
            let body_slot = closer_slots[closer_index];
            let state = route_states.values[body_slot];
            if (phase_of(state.packed_meta) != PHASE_READY_TO_CLOSE) { continue; }
            let closure_index = state.closure_index;
            if (closure_index >= closure_count
                || virtual_state[closure_index] != AVAILABILITY_LEASED
                || virtual_owner_entity[closure_index] != state.self_entity_id
                || virtual_owner_incarnation[closure_index] != state.self_incarnation
                || virtual_lease[closure_index] != state.lease_generation) {
                failure |= STATUS_RECORD_INVALID;
                break;
            }
            if (version_cursor >= INT32_MAX_U32) {
                failure |= STATUS_VERSION_EXHAUSTED;
                break;
            }
            version_cursor++;
            if (!push_action(&actions, &action_count, RouteAction(
                ACTION_CLOSED,
                body_slot,
                state.self_entity_id,
                state.self_incarnation,
                closure_index,
                topology.values[closure_base(closure_index) + 1u],
                state.lease_generation,
                version_cursor
            ))) { failure |= STATUS_RECORD_INVALID; break; }
            virtual_state[closure_index] = AVAILABILITY_CLOSED;
        }
    }

    if (params.terminal_final_submit == 0u) {
        for (var closer_index = 0u;
            closer_index < closer_count && failure == 0u;
            closer_index++) {
            let body_slot = closer_slots[closer_index];
            let state = route_states.values[body_slot];
            if (phase_of(state.packed_meta) != PHASE_SELECT_ROUTE) { continue; }
            if (state.route_set_index >= topology.values[TOPOLOGY_ROUTE_SET_COUNT]) {
                failure |= STATUS_RECORD_INVALID;
                break;
            }
            let route_set = route_set_base(state.route_set_index);
            let first = topology.values[route_set + 1u];
            let count = topology.values[route_set + 2u];
            var selected_path = INVALID;
            var selected_closure = INVALID;
            var selected_priority = INVALID;
            for (var candidate_index = first;
                candidate_index < first + count;
                candidate_index++) {
                let candidate = candidate_base(candidate_index);
                let path_index = topology.values[candidate];
                let priority = topology.values[candidate + 1u];
                let closure_index = path_closure(path_index);
                if (closure_index != INVALID
                    && virtual_state[closure_index] == AVAILABILITY_OPEN
                    && virtual_owner_slot[closure_index] == INVALID
                    && virtual_owner_entity[closure_index] == INVALID
                    && virtual_owner_incarnation[closure_index] == INVALID
                    && virtual_lease[closure_index] == 0u
                    && (selected_path == INVALID || priority < selected_priority
                        || (priority == selected_priority && path_index < selected_path))) {
                    selected_path = path_index;
                    selected_closure = closure_index;
                    selected_priority = priority;
                }
            }
            if (selected_closure == INVALID) { continue; }
            if (version_cursor >= INT32_MAX_U32) {
                failure |= STATUS_VERSION_EXHAUSTED;
                break;
            }
            if (lease_cursor == 0u || lease_cursor == INVALID) {
                failure |= STATUS_LEASE_EXHAUSTED;
                break;
            }
            let assigned_lease = lease_cursor;
            lease_cursor++;
            if (lease_cursor == INVALID) { lease_cursor = 0u; }
            version_cursor++;
            if (!push_action(&actions, &action_count, RouteAction(
                ACTION_ASSIGNED,
                body_slot,
                state.self_entity_id,
                state.self_incarnation,
                selected_closure,
                selected_path,
                assigned_lease,
                version_cursor
            ))) { failure |= STATUS_RECORD_INVALID; break; }
            virtual_state[selected_closure] = AVAILABILITY_LEASED;
            virtual_owner_slot[selected_closure] = body_slot;
            virtual_owner_entity[selected_closure] = state.self_entity_id;
            virtual_owner_incarnation[selected_closure] = state.self_incarnation;
            virtual_lease[selected_closure] = assigned_lease;
        }
    } else {
        for (var closure_index = 0u;
            closure_index < closure_count && failure == 0u;
            closure_index++) {
            if (virtual_state[closure_index] == AVAILABILITY_OPEN) { continue; }
            if (version_cursor >= INT32_MAX_U32) {
                failure |= STATUS_VERSION_EXHAUSTED;
                break;
            }
            version_cursor++;
            if (!push_action(&actions, &action_count, RouteAction(
                ACTION_REOPENED,
                virtual_owner_slot[closure_index],
                virtual_owner_entity[closure_index],
                virtual_owner_incarnation[closure_index],
                closure_index,
                topology.values[closure_base(closure_index) + 1u],
                virtual_lease[closure_index],
                version_cursor
            ))) { failure |= STATUS_RECORD_INVALID; break; }
            virtual_state[closure_index] = AVAILABILITY_OPEN;
        }
    }

    let event_base = atomicLoad(&contact_state.event_count);
    if (failure == 0u
        && (event_base > params.max_events
            || action_count > params.max_events - event_base)) {
        failure |= STATUS_EVENT_CAPACITY;
    }
    if (failure != 0u) {
        availability.status |= failure;
        cleanup_program.status |= failure;
        if ((failure & STATUS_EVENT_CAPACITY) != 0u) {
            atomicAdd(&contact_state.event_overflow, action_count);
        }
        return;
    }

    for (var action_index = 0u; action_index < action_count; action_index++) {
        let action = actions[action_index];
        applied_events.values[event_base + action_index] = AppliedEvent(
            action.entity_id,
            action.incarnation,
            select(action.closure_index, action.path_index, action.kind == ACTION_ASSIGNED),
            action.lease_generation,
            i32(action.availability_version),
            event_type_for_action(action.kind),
            closure_position(action.closure_index)
        );
        if (action.body_slot < counts.body_count
            && exact_body_identity(action.body_slot, action.entity_id, action.incarnation)) {
            if (action.kind == ACTION_ASSIGNED) {
                route_states.values[action.body_slot].current_path_index = action.path_index;
                route_states.values[action.body_slot].closure_index = action.closure_index;
                route_states.values[action.body_slot].lease_generation = action.lease_generation;
                route_states.values[action.body_slot].observed_availability_version
                    = action.availability_version;
                route_states.values[action.body_slot].phase_entered_fixed_tick
                    = params.fixed_tick;
                set_phase(&route_states.values[action.body_slot], PHASE_TRAVEL);
                simulations.values[action.body_slot].flow_field_index
                    = topology.values[closure_base(action.closure_index) + 2u];
                atomicOr(&simulations.values[action.body_slot].flags, BODY_FLAG_USE_FLOW);
            } else if (action.kind == ACTION_CLOSED) {
                route_states.values[action.body_slot].observed_availability_version
                    = action.availability_version;
                set_route_flags(
                    &route_states.values[action.body_slot],
                    flags_of(route_states.values[action.body_slot].packed_meta)
                        | FLAG_BLOCKER_ACTIVE
                );
                set_phase(&route_states.values[action.body_slot], PHASE_BLOCKING);
                anchor_closer(action.body_slot, action.closure_index);
                physics.values[action.body_slot].radius
                    = route_states.values[action.body_slot].blocker_radius;
                make_route_blocker(action.body_slot);
            } else if (action.kind == ACTION_REOPENED) {
                route_states.values[action.body_slot].observed_availability_version
                    = action.availability_version;
                set_route_flags(
                    &route_states.values[action.body_slot],
                    flags_of(route_states.values[action.body_slot].packed_meta)
                        & ~FLAG_BLOCKER_ACTIVE
                );
                set_phase(&route_states.values[action.body_slot], PHASE_DEAD);
            }
        }
    }
    atomicStore(&contact_state.event_count, event_base + action_count);
    for (var closure_index = 0u; closure_index < closure_count; closure_index++) {
        availability.records[closure_index].state = virtual_state[closure_index];
        availability.records[closure_index].owner_slot = virtual_owner_slot[closure_index];
        availability.records[closure_index].owner_entity_id
            = virtual_owner_entity[closure_index];
        availability.records[closure_index].owner_incarnation
            = virtual_owner_incarnation[closure_index];
        availability.records[closure_index].lease_generation = virtual_lease[closure_index];
        if (availability.records[closure_index].state != AVAILABILITY_OPEN) {
            availability.records[closure_index].changed_at_fixed_tick = params.fixed_tick;
        }
    }
    availability.availability_version = version_cursor;
    availability.next_lease_generation = lease_cursor;
    availability.source_tick = params.fixed_tick;
    availability.completed_through_tick = params.fixed_tick;
    availability.last_event_base = event_base;
    availability.last_event_count = action_count;
    availability.terminal_flags = select(0u, 1u, params.terminal_final_submit != 0u);
    cleanup_program.record_count = 0u;
    cleanup_program.status = 0u;
}
`;

export const GPU_ROUTE_RUNTIME_ENTRY_POINT = Object.freeze({
    ADVANCE: 'advance_route_runtime',
    ENFORCE_WAIT: 'enforce_route_owned_wait_after_external_motion',
    FINALIZE: 'finalize_route_runtime'
});

export const GPU_ROUTE_RUNTIME_STORAGE_PROFILE = Object.freeze({
    byEntryPoint: Object.freeze({
        [GPU_ROUTE_RUNTIME_ENTRY_POINT.ADVANCE]: 9,
        [GPU_ROUTE_RUNTIME_ENTRY_POINT.ENFORCE_WAIT]: 5,
        [GPU_ROUTE_RUNTIME_ENTRY_POINT.FINALIZE]: 9
    }),
    maximum: 9,
    render: 9
});
