import {
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_LAYER,
    GPU_CIRCLE_BODY_SIMULATION_FLAG,
    GPU_PROJECTILE_CAPTURE_PHASE,
    GPU_PROJECTILE_CAPTURE_POLICY_CODE,
    GPU_PROJECTILE_CAPTURE_ROLE,
    GPU_PROJECTILE_CAPTURE_STATE_META
} from './gpu_circle_body_abi.js';
import {
    GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE,
    GPU_PROJECTILE_CAPTURE_RELEASE_REASON,
    GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
    GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG,
    GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR,
    GPU_PROJECTILE_CAPTURE_TICK_STATUS
} from './gpu_projectile_capture_runtime_abi.js';
import {
    GAMEPLAY_TEAM_ID
} from '../../contract/gameplay_team_contract.js';

const w = (value) => `${value >>> 0}u`;

/**
 * storage profile (9): counts/physics/simulation/temporary/contact-state/contacts/
 * capture-state/candidate/runtime. Profile/target inputs are uniforms and do not
 * consume maxStorageBuffersPerShaderStage.
 */
export const GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL = /* wgsl */`
const BODY_ABI_VERSION: u32 = ${w(GPU_CIRCLE_BODY_ABI_VERSION)};
const CAPTURE_ABI_VERSION: u32 = ${w(GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION)};
const INVALID: u32 = 0xffffffffu;
const BODY_FLAG_ALIVE: u32 = ${w(GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE)};
const BODY_FLAG_CAPTURED: u32 = ${w(
    GPU_CIRCLE_BODY_SIMULATION_FLAG.PROJECTILE_CAPTURED
)};
const BODY_LAYER_PROJECTILE: u32 = ${w(GPU_CIRCLE_BODY_LAYER.PROJECTILE)};
const BODY_LAYER_ENEMY: u32 = ${w(GPU_CIRCLE_BODY_LAYER.ENEMY)};
const BODY_LAYER_CORE_PROXY: u32 = ${w(GPU_CIRCLE_BODY_LAYER.CORE_PROXY)};
const TEAM_PLAYER: u32 = ${w(GAMEPLAY_TEAM_ID.PLAYER)};
const TEAM_HOSTILE: u32 = ${w(GAMEPLAY_TEAM_ID.HOSTILE)};
const TEAM_NEUTRAL: u32 = ${w(GAMEPLAY_TEAM_ID.NEUTRAL)};
const ROLE_CAPTOR: u32 = ${w(GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR)};
const ROLE_PROJECTILE: u32 = ${w(GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE)};
const PHASE_IDLE: u32 = ${w(GPU_PROJECTILE_CAPTURE_PHASE.IDLE)};
const PHASE_HELD: u32 = ${w(GPU_PROJECTILE_CAPTURE_PHASE.HELD)};
const PHASE_PREPARED: u32 = ${w(GPU_PROJECTILE_CAPTURE_PHASE.RELEASE_PREPARED)};
const PHASE_TOMBSTONED: u32 = ${w(GPU_PROJECTILE_CAPTURE_PHASE.TOMBSTONED)};
const POLICY_CAPTURABLE: u32 = ${w(GPU_PROJECTILE_CAPTURE_POLICY_CODE.CAPTURABLE)};
const ROLE_SHIFT: u32 = ${w(GPU_PROJECTILE_CAPTURE_STATE_META.ROLE_SHIFT)};
const ROLE_MASK: u32 = ${w(GPU_PROJECTILE_CAPTURE_STATE_META.ROLE_MASK)};
const PHASE_SHIFT: u32 = ${w(GPU_PROJECTILE_CAPTURE_STATE_META.PHASE_SHIFT)};
const PHASE_MASK: u32 = ${w(GPU_PROJECTILE_CAPTURE_STATE_META.PHASE_MASK)};
const PROFILE_SHIFT: u32 = ${w(GPU_PROJECTILE_CAPTURE_STATE_META.PROFILE_SHIFT)};
const PROFILE_MASK: u32 = ${w(GPU_PROJECTILE_CAPTURE_STATE_META.PROFILE_MASK)};
const POLICY_SHIFT: u32 = ${w(GPU_PROJECTILE_CAPTURE_STATE_META.POLICY_SHIFT)};
const POLICY_MASK: u32 = ${w(GPU_PROJECTILE_CAPTURE_STATE_META.POLICY_MASK)};
const STATE_FLAGS_MASK: u32 = ${w(GPU_PROJECTILE_CAPTURE_STATE_META.FLAGS_MASK)};
const STATUS_RESET: u32 = ${w(GPU_PROJECTILE_CAPTURE_TICK_STATUS.RESET)};
const STATUS_SEALED: u32 = ${w(GPU_PROJECTILE_CAPTURE_TICK_STATUS.SEALED)};
const STATUS_COMPLETE: u32 = ${w(GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE)};
const STATUS_REJECTED: u32 = ${w(GPU_PROJECTILE_CAPTURE_TICK_STATUS.REJECTED)};
const ERROR_ABI: u32 = ${w(GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG.ABI_MISMATCH)};
const ERROR_CONTACT_OVERFLOW: u32 = ${w(
    GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG.CONTACT_OVERFLOW
)};
const ERROR_CAPACITY: u32 = ${w(
    GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG.COMPLETION_CAPACITY
)};
const ERROR_BILATERAL: u32 = ${w(
    GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG.BILATERAL_STATE_MISMATCH
)};
const ERROR_TICK_OVERFLOW: u32 = ${w(
    GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG.FIXED_TICK_OVERFLOW
)};
const ERROR_SEQUENCE_EXHAUSTED: u32 = ${w(
    GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG.CAPTURE_SEQUENCE_EXHAUSTED
)};
const TYPE_CAPTURED: u32 = ${w(GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE.CAPTURED)};
const TYPE_RELEASE_NORMAL: u32 = ${w(
    GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE.RELEASE_PREPARED_NORMAL
)};
const TYPE_RELEASE_DEATH: u32 = ${w(
    GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE.RELEASE_PREPARED_CAPTOR_DEATH
)};
const TYPE_RELEASE_CORE: u32 = ${w(
    GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE.RELEASE_PREPARED_CAPTOR_CORE_IMPACT
)};
const TYPE_EXPIRED: u32 = ${w(
    GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE.HELD_PROJECTILE_EXPIRED
)};
const RELEASE_NORMAL: u32 = ${w(GPU_PROJECTILE_CAPTURE_RELEASE_REASON.NORMAL_DUE)};
const RELEASE_DEATH: u32 = ${w(GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_DEATH)};
const RELEASE_CORE: u32 = ${w(
    GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT
)};
const CANDIDATE_CORE_IMPACT: u32 = 0x100u;
const TARGET_FORWARD: u32 = ${w(
    GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD
)};
const TARGET_TOWER: u32 = ${w(GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.TOWER)};
const HEADER_WORDS: u32 = 16u;
const COMPLETION_WORDS: u32 = 24u;
const H_ABI: u32 = 0u;
const H_SESSION: u32 = 1u;
const H_DEVICE: u32 = 2u;
const H_EPOCH: u32 = 3u;
const H_SOURCE_TICK: u32 = 4u;
const H_COMPLETED_TICK: u32 = 5u;
const H_STATUS: u32 = 6u;
const H_ERRORS: u32 = 7u;
const H_CANDIDATES: u32 = 8u;
const H_SELECTED: u32 = 9u;
const H_CAPTURES: u32 = 10u;
const H_RELEASES: u32 = 11u;
const H_CLEANUPS: u32 = 12u;
const H_OVERFLOW: u32 = 13u;
const H_FINGERPRINT: u32 = 14u;
const H_RESERVED: u32 = 15u;

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
struct CaptureState {
    meta: atomic<u32>,
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
struct CaptureCandidate {
    distance_squared_bits: atomic<u32>,
    peer_entity_id: atomic<u32>,
    peer_incarnation: u32,
    status: atomic<u32>,
}
struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct TemporaryBuffer { values: array<BodyTemporary> }
struct ContactBuffer { values: array<Contact> }
struct CaptureStateBuffer { values: array<CaptureState> }
struct CaptureCandidateBuffer { values: array<CaptureCandidate> }
struct AtomicWords { values: array<atomic<u32>> }
struct CaptureParams {
    fixed_tick: u32,
    max_contacts: u32,
    capture_capacity: u32,
    release_capacity: u32,
    cleanup_capacity: u32,
    profile_code: u32,
    capture_delay_fixed_ticks: u32,
    session_generation: u32,
    device_generation: u32,
    authoritative_epoch: u32,
    funnel_cos_half_angle: f32,
    exit_clearance_tiles: f32,
}
struct CaptureTargetConfig {
    body_slot: u32,
    entity_id: u32,
    incarnation: u32,
    selector: u32,
}

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read_write> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(3) var<storage, read_write> temporaries: TemporaryBuffer;
@group(0) @binding(4) var<storage, read_write> contact_state: ContactState;
@group(0) @binding(5) var<storage, read> contacts: ContactBuffer;
@group(0) @binding(6) var<storage, read_write> capture_states: CaptureStateBuffer;
@group(0) @binding(7) var<storage, read_write> candidates: CaptureCandidateBuffer;
@group(0) @binding(8) var<storage, read_write> runtime: AtomicWords;
@group(1) @binding(0) var<uniform> params: CaptureParams;
@group(1) @binding(1) var<uniform> target_config: CaptureTargetConfig;

fn role(meta: u32) -> u32 { return (meta & ROLE_MASK) >> ROLE_SHIFT; }
fn phase(meta: u32) -> u32 { return (meta & PHASE_MASK) >> PHASE_SHIFT; }
fn profile(meta: u32) -> u32 { return (meta & PROFILE_MASK) >> PROFILE_SHIFT; }
fn policy(meta: u32) -> u32 { return (meta & POLICY_MASK) >> POLICY_SHIFT; }
fn with_phase(meta: u32, next: u32) -> u32 {
    return (meta & ~PHASE_MASK) | ((next << PHASE_SHIFT) & PHASE_MASK);
}
fn alive(slot: u32) -> bool {
    return slot < counts.body_count
        && (atomicLoad(&simulations.values[slot].flags) & BODY_FLAG_ALIVE) != 0u;
}
fn captured(slot: u32) -> bool {
    return (atomicLoad(&simulations.values[slot].flags) & BODY_FLAG_CAPTURED) != 0u;
}
fn identity_matches(slot: u32, entity: u32, incarnation: u32) -> bool {
    return slot < counts.body_count
        && simulations.values[slot].entity_id == entity
        && simulations.values[slot].incarnation == incarnation
        && capture_states.values[slot].self_entity_id == entity
        && capture_states.values[slot].self_incarnation == incarnation;
}
fn finite_vec2(value: vec2f) -> bool {
    return all(isFinite(value));
}
fn candidate_is_exact(contact: Contact) -> bool {
    if (contact.other_body_id < 0) { return false; }
    let captor_slot = contact.self_body_id;
    let projectile_slot = u32(contact.other_body_id);
    if (captor_slot >= counts.body_count || projectile_slot >= counts.body_count
        || captor_slot == projectile_slot
        || !identity_matches(
            captor_slot,
            simulations.values[captor_slot].entity_id,
            contact.self_incarnation
        )
        || !identity_matches(
            projectile_slot,
            simulations.values[projectile_slot].entity_id,
            contact.other_incarnation
        )
        || !alive(captor_slot) || !alive(projectile_slot) || captured(projectile_slot)
        || atomicLoad(&simulations.values[projectile_slot].health) <= 0
        || simulations.values[projectile_slot].lifetime == 0.0) {
        return false;
    }
    let captor_meta = atomicLoad(&capture_states.values[captor_slot].meta);
    let projectile_meta = atomicLoad(&capture_states.values[projectile_slot].meta);
    if (role(captor_meta) != ROLE_CAPTOR || phase(captor_meta) != PHASE_IDLE
        || profile(captor_meta) != params.profile_code
        || role(projectile_meta) != ROLE_PROJECTILE
        || phase(projectile_meta) != PHASE_IDLE
        || policy(projectile_meta) != POLICY_CAPTURABLE
        || (physics.values[captor_slot].interaction_meta & 0xffffu)
            != BODY_LAYER_ENEMY
        || (simulations.values[captor_slot].gameplay_meta & 0xffu)
            != TEAM_HOSTILE
        || (physics.values[projectile_slot].interaction_meta & 0xffffu)
            != BODY_LAYER_PROJECTILE
        || (simulations.values[projectile_slot].gameplay_meta & 0xffu)
            != TEAM_PLAYER) {
        return false;
    }
    let projectile_velocity = physics.values[projectile_slot].velocity;
    let projectile_speed_squared = dot(projectile_velocity, projectile_velocity);
    let predicted_delta = temporaries.values[projectile_slot].predicted_position
        - temporaries.values[captor_slot].predicted_position;
    let predicted_distance_squared = dot(predicted_delta, predicted_delta);
    let facing = capture_states.values[captor_slot].facing;
    let facing_length_squared = dot(facing, facing);
    return finite_vec2(projectile_velocity)
        && isFinite(projectile_speed_squared)
        && projectile_speed_squared > 0.0
        && finite_vec2(predicted_delta)
        && isFinite(predicted_distance_squared)
        && predicted_distance_squared > 0.000001
        && finite_vec2(facing)
        && isFinite(facing_length_squared)
        && facing_length_squared > 0.000001
        && dot(
            predicted_delta * inverseSqrt(predicted_distance_squared),
            facing * inverseSqrt(facing_length_squared)
        )
            >= params.funnel_cos_half_angle;
}
fn mutually_selected(contact: Contact) -> bool {
    if (!candidate_is_exact(contact)) { return false; }
    let captor_slot = contact.self_body_id;
    let projectile_slot = u32(contact.other_body_id);
    return atomicLoad(&candidates.values[projectile_slot].peer_entity_id)
            == simulations.values[captor_slot].entity_id
        && atomicLoad(&candidates.values[captor_slot].peer_entity_id)
            == simulations.values[projectile_slot].entity_id;
}
fn contact_distance_squared_bits(contact: Contact) -> u32 {
    let delta = temporaries.values[u32(contact.other_body_id)].predicted_position
        - temporaries.values[contact.self_body_id].predicted_position;
    let distance_squared = dot(delta, delta);
    if (!finite_vec2(delta) || !isFinite(distance_squared)
        || distance_squared < 0.0) {
        return 0x7f800000u;
    }
    return bitcast<u32>(distance_squared);
}
fn mix_fingerprint(a: u32, b: u32, c: u32) -> u32 {
    var value = (a * 0x9e3779b1u) ^ (b * 0x85ebca6bu) ^ (c * 0xc2b2ae35u);
    value ^= value >> 16u;
    value *= 0x7feb352du;
    value ^= value >> 15u;
    return select(value, 1u, value == 0u || value == INVALID);
}
fn completion_base(partition: u32, index: u32) -> u32 {
    var base = HEADER_WORDS;
    if (partition >= 1u) { base += params.capture_capacity * COMPLETION_WORDS; }
    if (partition >= 2u) { base += params.release_capacity * COMPLETION_WORDS; }
    return base + index * COMPLETION_WORDS;
}
fn store_word(base: u32, word: u32, value: u32) {
    atomicStore(&runtime.values[base + word], value);
}
fn store_float(base: u32, word: u32, value: f32) {
    store_word(base, word, bitcast<u32>(value));
}
fn write_completion(
    base: u32,
    type_code: u32,
    captor_slot: u32,
    projectile_slot: u32,
    sequence: u32,
    fingerprint: u32,
    anchor: vec2f,
    facing: vec2f,
    speed: f32,
    target_selector: u32,
    target_slot: u32,
    target_entity: u32,
    target_incarnation: u32,
    reason: u32
) {
    store_word(base, 0u, type_code);
    store_word(base, 1u, 0u);
    store_word(base, 2u, captor_slot);
    store_word(base, 3u, simulations.values[captor_slot].entity_id);
    store_word(base, 4u, simulations.values[captor_slot].incarnation);
    store_word(base, 5u, projectile_slot);
    store_word(base, 6u, simulations.values[projectile_slot].entity_id);
    store_word(base, 7u, simulations.values[projectile_slot].incarnation);
    store_word(base, 8u, capture_states.values[projectile_slot].captured_at_fixed_tick);
    store_word(base, 9u, capture_states.values[projectile_slot].release_due_fixed_tick);
    store_word(base, 10u, sequence);
    store_word(base, 11u, fingerprint);
    store_float(base, 12u, anchor.x);
    store_float(base, 13u, anchor.y);
    store_float(base, 14u, facing.x);
    store_float(base, 15u, facing.y);
    store_float(base, 16u, speed);
    store_word(base, 17u, target_selector);
    store_word(base, 18u, target_slot);
    store_word(base, 19u, target_entity);
    store_word(base, 20u, target_incarnation);
    store_word(base, 21u, params.profile_code);
    store_word(base, 22u, reason);
    store_word(base, 23u, 0u);
}
fn bilateral_held(captor_slot: u32) -> bool {
    let captor_meta = atomicLoad(&capture_states.values[captor_slot].meta);
    if (role(captor_meta) != ROLE_CAPTOR
        || (phase(captor_meta) != PHASE_HELD && phase(captor_meta) != PHASE_PREPARED)) {
        return false;
    }
    let projectile_slot = capture_states.values[captor_slot].peer_body_slot;
    if (!identity_matches(
            projectile_slot,
            capture_states.values[captor_slot].peer_entity_id,
            capture_states.values[captor_slot].peer_incarnation
        )) {
        return false;
    }
    let projectile_meta = atomicLoad(&capture_states.values[projectile_slot].meta);
    return role(projectile_meta) == ROLE_PROJECTILE
        && phase(projectile_meta) == phase(captor_meta)
        && capture_states.values[projectile_slot].peer_body_slot == captor_slot
        && capture_states.values[projectile_slot].peer_entity_id
            == simulations.values[captor_slot].entity_id
        && capture_states.values[projectile_slot].peer_incarnation
            == simulations.values[captor_slot].incarnation
        && capture_states.values[projectile_slot].capture_sequence
            == capture_states.values[captor_slot].capture_sequence
        && captured(projectile_slot);
}
fn bilateral_projectile(projectile_slot: u32) -> bool {
    let projectile_meta = atomicLoad(&capture_states.values[projectile_slot].meta);
    if (role(projectile_meta) != ROLE_PROJECTILE
        || (phase(projectile_meta) != PHASE_HELD
            && phase(projectile_meta) != PHASE_PREPARED)) {
        return false;
    }
    let captor_slot = capture_states.values[projectile_slot].peer_body_slot;
    if (!identity_matches(
            captor_slot,
            capture_states.values[projectile_slot].peer_entity_id,
            capture_states.values[projectile_slot].peer_incarnation
        )) {
        return false;
    }
    let captor_meta = atomicLoad(&capture_states.values[captor_slot].meta);
    return role(captor_meta) == ROLE_CAPTOR
        && phase(captor_meta) == phase(projectile_meta)
        && capture_states.values[captor_slot].peer_body_slot == projectile_slot
        && capture_states.values[captor_slot].peer_entity_id
            == simulations.values[projectile_slot].entity_id
        && capture_states.values[captor_slot].peer_incarnation
            == simulations.values[projectile_slot].incarnation
        && capture_states.values[captor_slot].capture_sequence
            == capture_states.values[projectile_slot].capture_sequence;
}
fn release_kind(captor_slot: u32) -> u32 {
    if (!bilateral_held(captor_slot)) { return 0u; }
    let projectile_slot = capture_states.values[captor_slot].peer_body_slot;
    if (!alive(projectile_slot)
        || atomicLoad(&simulations.values[projectile_slot].health) <= 0
        || simulations.values[projectile_slot].lifetime == 0.0) {
        return 3u;
    }
    if ((atomicLoad(&candidates.values[captor_slot].status)
        & CANDIDATE_CORE_IMPACT) != 0u) { return 4u; }
    if (!alive(captor_slot)) { return 2u; }
    let due = capture_states.values[captor_slot].release_due_fixed_tick;
    if (due <= params.fixed_tick
        || (params.fixed_tick < INVALID && due == params.fixed_tick + 1u)) {
        return 1u;
    }
    return 0u;
}

@compute @workgroup_size(256)
fn clear_projectile_capture_tick(@builtin(global_invocation_id) id: vec3u) {
    let slot = id.x;
    if (slot < counts.body_count) {
        atomicStore(&candidates.values[slot].distance_squared_bits, 0x7f800000u);
        atomicStore(&candidates.values[slot].peer_entity_id, INVALID);
        candidates.values[slot].peer_incarnation = INVALID;
        atomicStore(&candidates.values[slot].status, 0u);
    }
    if (slot == 0u) {
        atomicStore(&runtime.values[H_ABI], CAPTURE_ABI_VERSION);
        atomicStore(&runtime.values[H_SESSION], params.session_generation);
        atomicStore(&runtime.values[H_DEVICE], params.device_generation);
        atomicStore(&runtime.values[H_EPOCH], params.authoritative_epoch);
        atomicStore(&runtime.values[H_SOURCE_TICK], params.fixed_tick);
        atomicStore(&runtime.values[H_COMPLETED_TICK], 0u);
        atomicStore(&runtime.values[H_STATUS], STATUS_RESET);
        atomicStore(
            &runtime.values[H_ERRORS],
            select(0u, ERROR_ABI, counts.abi_version != BODY_ABI_VERSION)
        );
        if (params.fixed_tick == 0u
            || params.capture_delay_fixed_ticks == 0u
            || params.capture_delay_fixed_ticks >= INVALID - params.fixed_tick) {
            atomicOr(&runtime.values[H_ERRORS], ERROR_TICK_OVERFLOW);
        }
        atomicStore(&runtime.values[H_CANDIDATES], 0u);
        atomicStore(&runtime.values[H_SELECTED], 0u);
        atomicStore(&runtime.values[H_CAPTURES], 0u);
        atomicStore(&runtime.values[H_RELEASES], 0u);
        atomicStore(&runtime.values[H_CLEANUPS], 0u);
        atomicStore(&runtime.values[H_OVERFLOW], 0u);
        atomicStore(&runtime.values[H_FINGERPRINT], 0u);
        atomicStore(&runtime.values[H_RESERVED], 0u);
    }
}

@compute @workgroup_size(256)
fn update_projectile_capture_facing(@builtin(global_invocation_id) id: vec3u) {
    let captor_slot = id.x;
    if (captor_slot >= counts.body_count || !alive(captor_slot)
        || !identity_matches(
            captor_slot,
            simulations.values[captor_slot].entity_id,
            simulations.values[captor_slot].incarnation
        )) {
        return;
    }
    let captor_meta = atomicLoad(&capture_states.values[captor_slot].meta);
    if (role(captor_meta) != ROLE_CAPTOR
        || (phase(captor_meta) != PHASE_IDLE
            && phase(captor_meta) != PHASE_HELD
            && phase(captor_meta) != PHASE_PREPARED)) {
        return;
    }
    let velocity = physics.values[captor_slot].velocity;
    let speed_squared = dot(velocity, velocity);
    if (!finite_vec2(velocity) || !isFinite(speed_squared)
        || speed_squared <= 0.0) {
        return;
    }
    let facing = velocity * inverseSqrt(speed_squared);
    capture_states.values[captor_slot].facing = facing;
    if (bilateral_held(captor_slot)) {
        let projectile_slot = capture_states.values[captor_slot].peer_body_slot;
        capture_states.values[projectile_slot].facing = facing;
    }
}

@compute @workgroup_size(256)
fn validate_projectile_capture_holds(@builtin(global_invocation_id) id: vec3u) {
    let slot = id.x;
    if (slot >= counts.body_count || !alive(slot)) { return; }
    let meta = atomicLoad(&capture_states.values[slot].meta);
    let state_phase = phase(meta);
    let state_role = role(meta);
    let mirror = captured(slot);
    let self_exact = capture_states.values[slot].self_entity_id
            == simulations.values[slot].entity_id
        && capture_states.values[slot].self_incarnation
            == simulations.values[slot].incarnation;
    let active_projectile_phase = state_phase == PHASE_HELD
        || state_phase == PHASE_PREPARED;
    let invalid = !self_exact
        || (state_role == ROLE_PROJECTILE
            && (mirror != active_projectile_phase
                || (active_projectile_phase && !bilateral_projectile(slot))))
        || (state_role == ROLE_CAPTOR
            && (mirror
                || (active_projectile_phase && !bilateral_held(slot))))
        || (state_role != ROLE_PROJECTILE && state_role != ROLE_CAPTOR && mirror)
        || ((state_phase == PHASE_IDLE || state_phase == PHASE_TOMBSTONED)
            && mirror);
    if (invalid) {
        atomicOr(&runtime.values[H_ERRORS], ERROR_BILATERAL);
    }
}

@compute @workgroup_size(256)
fn select_projectile_capture_distances(@builtin(global_invocation_id) id: vec3u) {
    if (atomicLoad(&contact_state.contact_overflow) != 0u) {
        if (id.x == 0u) { atomicOr(&runtime.values[H_ERRORS], ERROR_CONTACT_OVERFLOW); }
        return;
    }
    let index = id.x;
    let count = min(atomicLoad(&contact_state.contact_count), params.max_contacts);
    if (index >= count) { return; }
    let contact = contacts.values[index];
    if (!candidate_is_exact(contact)) { return; }
    let projectile_slot = u32(contact.other_body_id);
    atomicMin(
        &candidates.values[projectile_slot].distance_squared_bits,
        contact_distance_squared_bits(contact)
    );
}

@compute @workgroup_size(256)
fn select_projectile_capture_captors(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    let count = min(atomicLoad(&contact_state.contact_count), params.max_contacts);
    if (index >= count) { return; }
    let contact = contacts.values[index];
    if (!candidate_is_exact(contact)) { return; }
    let projectile_slot = u32(contact.other_body_id);
    if (contact_distance_squared_bits(contact)
        != atomicLoad(&candidates.values[projectile_slot].distance_squared_bits)) {
        return;
    }
    atomicMin(
        &candidates.values[projectile_slot].peer_entity_id,
        simulations.values[contact.self_body_id].entity_id
    );
    atomicAdd(&runtime.values[H_CANDIDATES], 1u);
}

@compute @workgroup_size(256)
fn select_ring_capture_distances(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    let count = min(atomicLoad(&contact_state.contact_count), params.max_contacts);
    if (index >= count) { return; }
    let contact = contacts.values[index];
    if (!candidate_is_exact(contact)) { return; }
    let projectile_slot = u32(contact.other_body_id);
    if (atomicLoad(&candidates.values[projectile_slot].peer_entity_id)
        != simulations.values[contact.self_body_id].entity_id) { return; }
    atomicMin(
        &candidates.values[contact.self_body_id].distance_squared_bits,
        contact_distance_squared_bits(contact)
    );
}

@compute @workgroup_size(256)
fn select_ring_capture_projectiles(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    let count = min(atomicLoad(&contact_state.contact_count), params.max_contacts);
    if (index >= count) { return; }
    let contact = contacts.values[index];
    if (!candidate_is_exact(contact)) { return; }
    let projectile_slot = u32(contact.other_body_id);
    if (atomicLoad(&candidates.values[projectile_slot].peer_entity_id)
            != simulations.values[contact.self_body_id].entity_id
        || contact_distance_squared_bits(contact)
            != atomicLoad(
                &candidates.values[contact.self_body_id].distance_squared_bits
            )) { return; }
    atomicMin(
        &candidates.values[contact.self_body_id].peer_entity_id,
        simulations.values[projectile_slot].entity_id
    );
}

@compute @workgroup_size(256)
fn preflight_projectile_capture_batch(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    let count = min(atomicLoad(&contact_state.contact_count), params.max_contacts);
    if (index < count && mutually_selected(contacts.values[index])) {
        let contact = contacts.values[index];
        let projectile_slot = u32(contact.other_body_id);
        let previous = atomicExchange(&candidates.values[projectile_slot].status, 1u);
        if (previous != 0u) { return; }
        let captor_slot = contact.self_body_id;
        let prior_sequence = max(
            capture_states.values[captor_slot].capture_sequence,
            capture_states.values[projectile_slot].capture_sequence
        );
        if (prior_sequence >= INVALID - 1u) {
            atomicOr(&runtime.values[H_ERRORS], ERROR_SEQUENCE_EXHAUSTED);
            return;
        }
        atomicAdd(&runtime.values[H_SELECTED], 1u);
    }
}

@compute @workgroup_size(1)
fn seal_projectile_capture_batch() {
    let selected = atomicLoad(&runtime.values[H_SELECTED]);
    let errors = atomicLoad(&runtime.values[H_ERRORS]);
    if (selected > params.capture_capacity) {
        errors |= ERROR_CAPACITY;
        atomicStore(&runtime.values[H_ERRORS], errors);
    }
    atomicStore(
        &runtime.values[H_STATUS],
        select(STATUS_SEALED, STATUS_REJECTED, errors != 0u)
    );
}

@compute @workgroup_size(256)
fn commit_projectile_capture_batch(@builtin(global_invocation_id) id: vec3u) {
    if (atomicLoad(&runtime.values[H_STATUS]) != STATUS_SEALED) { return; }
    let index = id.x;
    let count = min(atomicLoad(&contact_state.contact_count), params.max_contacts);
    if (index >= count) { return; }
    let contact = contacts.values[index];
    if (!mutually_selected(contact)) { return; }
    let captor_slot = contact.self_body_id;
    let projectile_slot = u32(contact.other_body_id);
    if (atomicExchange(&candidates.values[projectile_slot].status, 2u) != 1u) {
        return;
    }
    let captor_meta = atomicLoad(&capture_states.values[captor_slot].meta);
    let projectile_meta = atomicLoad(&capture_states.values[projectile_slot].meta);
    let sequence = max(
        capture_states.values[captor_slot].capture_sequence,
        capture_states.values[projectile_slot].capture_sequence
    ) + 1u;
    let speed = length(physics.values[projectile_slot].velocity);
    let facing = normalize(capture_states.values[captor_slot].facing);
    let anchor = temporaries.values[captor_slot].predicted_position;
    let due = params.fixed_tick + params.capture_delay_fixed_ticks;
    capture_states.values[captor_slot].peer_body_slot = projectile_slot;
    capture_states.values[captor_slot].peer_entity_id
        = simulations.values[projectile_slot].entity_id;
    capture_states.values[captor_slot].peer_incarnation
        = simulations.values[projectile_slot].incarnation;
    capture_states.values[captor_slot].captured_at_fixed_tick = params.fixed_tick;
    capture_states.values[captor_slot].release_due_fixed_tick = due;
    capture_states.values[captor_slot].capture_sequence = sequence;
    capture_states.values[captor_slot].captured_speed = speed;
    capture_states.values[captor_slot].facing = facing;
    capture_states.values[projectile_slot].peer_body_slot = captor_slot;
    capture_states.values[projectile_slot].peer_entity_id
        = simulations.values[captor_slot].entity_id;
    capture_states.values[projectile_slot].peer_incarnation
        = simulations.values[captor_slot].incarnation;
    capture_states.values[projectile_slot].captured_at_fixed_tick = params.fixed_tick;
    capture_states.values[projectile_slot].release_due_fixed_tick = due;
    capture_states.values[projectile_slot].capture_sequence = sequence;
    capture_states.values[projectile_slot].captured_speed = speed;
    capture_states.values[projectile_slot].facing = facing;
    atomicStore(&capture_states.values[captor_slot].meta, with_phase(captor_meta, PHASE_HELD));
    atomicStore(
        &capture_states.values[projectile_slot].meta,
        with_phase(projectile_meta, PHASE_HELD)
    );
    physics.values[projectile_slot].position = anchor;
    physics.values[projectile_slot].velocity = vec2f(0.0);
    temporaries.values[projectile_slot].previous_position = anchor;
    temporaries.values[projectile_slot].predicted_position = anchor;
    temporaries.values[projectile_slot].position_delta = vec2f(0.0);
    temporaries.values[projectile_slot].grid_index = -1;
    candidates.values[captor_slot].peer_incarnation
        = simulations.values[projectile_slot].incarnation;
    candidates.values[projectile_slot].peer_incarnation
        = simulations.values[captor_slot].incarnation;
    let fingerprint = mix_fingerprint(
        simulations.values[captor_slot].entity_id,
        simulations.values[projectile_slot].entity_id,
        sequence
    );
    let output = atomicAdd(&runtime.values[H_CAPTURES], 1u);
    write_completion(
        completion_base(0u, output), TYPE_CAPTURED, captor_slot, projectile_slot,
        sequence, fingerprint, anchor, facing, speed, TARGET_FORWARD, INVALID,
        INVALID, INVALID, 0u
    );
    atomicXor(&runtime.values[H_FINGERPRINT], fingerprint);
    // Persistent bilateral state와 pose를 모두 쓴 뒤 exact mirror bit를 마지막에 세웁니다.
    atomicOr(&simulations.values[projectile_slot].flags, BODY_FLAG_CAPTURED);
}

@compute @workgroup_size(1)
fn finalize_projectile_capture_batch() {
    if (atomicLoad(&runtime.values[H_STATUS]) == STATUS_SEALED) {
        atomicStore(&runtime.values[H_STATUS], STATUS_COMPLETE);
    }
}

@compute @workgroup_size(256)
fn mark_projectile_capture_core_impacts(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    let count = min(atomicLoad(&contact_state.contact_count), params.max_contacts);
    if (index >= count) { return; }
    let contact = contacts.values[index];
    if (contact.other_body_id < 0) { return; }
    let captor_slot = contact.self_body_id;
    let core_slot = u32(contact.other_body_id);
    if (captor_slot >= counts.body_count || core_slot >= counts.body_count
        || !identity_matches(
            captor_slot,
            simulations.values[captor_slot].entity_id,
            contact.self_incarnation
        )
        || !identity_matches(
            core_slot,
            simulations.values[core_slot].entity_id,
            contact.other_incarnation
        )
        || !alive(core_slot)
        || !bilateral_held(captor_slot)
        || (physics.values[captor_slot].interaction_meta & 0xffffu)
            != BODY_LAYER_ENEMY
        || (simulations.values[captor_slot].gameplay_meta & 0xffu)
            != TEAM_HOSTILE
        || (physics.values[core_slot].interaction_meta & 0xffffu)
            != BODY_LAYER_CORE_PROXY
        || (simulations.values[core_slot].gameplay_meta & 0xffu)
            != TEAM_NEUTRAL) {
        return;
    }
    atomicOr(&candidates.values[captor_slot].status, CANDIDATE_CORE_IMPACT);
}

@compute @workgroup_size(256)
fn attach_projectile_capture_holds(@builtin(global_invocation_id) id: vec3u) {
    let captor_slot = id.x;
    if (captor_slot >= counts.body_count || !bilateral_held(captor_slot)) { return; }
    let projectile_slot = capture_states.values[captor_slot].peer_body_slot;
    let anchor = physics.values[captor_slot].position;
    physics.values[projectile_slot].position = anchor;
    physics.values[projectile_slot].velocity = vec2f(0.0);
    temporaries.values[projectile_slot].previous_position = anchor;
    temporaries.values[projectile_slot].predicted_position = anchor;
    temporaries.values[projectile_slot].position_delta = vec2f(0.0);
    temporaries.values[projectile_slot].grid_index = -1;
}

@compute @workgroup_size(1)
fn clear_projectile_capture_release_preparations() {
    atomicStore(&runtime.values[H_SELECTED], 0u);
    atomicStore(&runtime.values[H_RELEASES], 0u);
    atomicStore(&runtime.values[H_CLEANUPS], 0u);
    // The public batch fingerprint authenticates this tick's release-prepare
    // partition only. Capture/cleanup records never enter a release command.
    atomicStore(&runtime.values[H_FINGERPRINT], 0u);
    if (atomicLoad(&runtime.values[H_ERRORS]) == 0u) {
        atomicStore(&runtime.values[H_STATUS], STATUS_RESET);
    }
}

@compute @workgroup_size(256)
fn preflight_projectile_capture_release_preparations(
    @builtin(global_invocation_id) id: vec3u
) {
    let captor_slot = id.x;
    if (captor_slot >= counts.body_count) { return; }
    let kind = release_kind(captor_slot);
    if (kind == 1u || kind == 2u || kind == 4u) {
        atomicAdd(&runtime.values[H_RELEASES], 1u);
        atomicAdd(&runtime.values[H_SELECTED], 1u);
    } else if (kind == 3u) {
        atomicAdd(&runtime.values[H_CLEANUPS], 1u);
        atomicAdd(&runtime.values[H_SELECTED], 1u);
    }
}

@compute @workgroup_size(1)
fn seal_projectile_capture_release_preparations() {
    let release_count = atomicLoad(&runtime.values[H_RELEASES]);
    let cleanup_count = atomicLoad(&runtime.values[H_CLEANUPS]);
    var errors = atomicLoad(&runtime.values[H_ERRORS]);
    if (release_count > params.release_capacity
        || cleanup_count > params.cleanup_capacity) { errors |= ERROR_CAPACITY; }
    atomicStore(&runtime.values[H_ERRORS], errors);
    atomicStore(&runtime.values[H_RELEASES], 0u);
    atomicStore(&runtime.values[H_CLEANUPS], 0u);
    atomicStore(
        &runtime.values[H_STATUS],
        select(STATUS_SEALED, STATUS_REJECTED, errors != 0u)
    );
}

@compute @workgroup_size(256)
fn commit_projectile_capture_release_preparations(
    @builtin(global_invocation_id) id: vec3u
) {
    if (atomicLoad(&runtime.values[H_STATUS]) != STATUS_SEALED) { return; }
    let captor_slot = id.x;
    if (captor_slot >= counts.body_count) { return; }
    let kind = release_kind(captor_slot);
    if (kind == 0u) { return; }
    let projectile_slot = capture_states.values[captor_slot].peer_body_slot;
    let sequence = capture_states.values[captor_slot].capture_sequence;
    let fingerprint = mix_fingerprint(
        simulations.values[captor_slot].entity_id,
        simulations.values[projectile_slot].entity_id,
        sequence ^ params.fixed_tick
    );
    if (kind == 3u) {
        let output = atomicAdd(&runtime.values[H_CLEANUPS], 1u);
        write_completion(
            completion_base(2u, output), TYPE_EXPIRED, captor_slot,
            projectile_slot, sequence, fingerprint,
            physics.values[captor_slot].position,
            capture_states.values[captor_slot].facing,
            capture_states.values[captor_slot].captured_speed,
            TARGET_FORWARD, INVALID, INVALID, INVALID, 0u
        );
        let captor_meta = atomicLoad(&capture_states.values[captor_slot].meta);
        let projectile_meta = atomicLoad(&capture_states.values[projectile_slot].meta);
        capture_states.values[captor_slot].peer_body_slot = INVALID;
        capture_states.values[captor_slot].peer_entity_id = INVALID;
        capture_states.values[captor_slot].peer_incarnation = INVALID;
        atomicStore(&capture_states.values[captor_slot].meta, with_phase(captor_meta, PHASE_IDLE));
        capture_states.values[projectile_slot].peer_body_slot = INVALID;
        capture_states.values[projectile_slot].peer_entity_id = INVALID;
        capture_states.values[projectile_slot].peer_incarnation = INVALID;
        atomicStore(
            &capture_states.values[projectile_slot].meta,
            with_phase(projectile_meta, PHASE_TOMBSTONED)
        );
        atomicAnd(&simulations.values[projectile_slot].flags, ~BODY_FLAG_CAPTURED);
        return;
    }
    let stored_facing = normalize(capture_states.values[captor_slot].facing);
    let exit_position = physics.values[captor_slot].position
        + stored_facing * (
            physics.values[captor_slot].radius
            + physics.values[projectile_slot].radius
            + params.exit_clearance_tiles
        );
    var direction = stored_facing;
    var target_selector = TARGET_FORWARD;
    var target_slot = INVALID;
    var target_entity = INVALID;
    var target_incarnation = INVALID;
    if (kind == 1u && target_config.selector == TARGET_TOWER
        && identity_matches(
            target_config.body_slot,
            target_config.entity_id,
            target_config.incarnation
        ) && alive(target_config.body_slot)) {
        let delta = physics.values[target_config.body_slot].position - exit_position;
        if (dot(delta, delta) > 0.000001) {
            direction = normalize(delta);
            target_selector = TARGET_TOWER;
            target_slot = target_config.body_slot;
            target_entity = target_config.entity_id;
            target_incarnation = target_config.incarnation;
        }
    }
    let captor_meta = atomicLoad(&capture_states.values[captor_slot].meta);
    let projectile_meta = atomicLoad(&capture_states.values[projectile_slot].meta);
    atomicStore(
        &capture_states.values[captor_slot].meta,
        with_phase(captor_meta, PHASE_PREPARED)
    );
    atomicStore(
        &capture_states.values[projectile_slot].meta,
        with_phase(projectile_meta, PHASE_PREPARED)
    );
    let output = atomicAdd(&runtime.values[H_RELEASES], 1u);
    write_completion(
        completion_base(1u, output),
        select(
            select(TYPE_RELEASE_NORMAL, TYPE_RELEASE_DEATH, kind == 2u),
            TYPE_RELEASE_CORE,
            kind == 4u
        ),
        captor_slot, projectile_slot, sequence, fingerprint, exit_position,
        direction, capture_states.values[captor_slot].captured_speed,
        target_selector, target_slot, target_entity, target_incarnation,
        select(
            select(RELEASE_NORMAL, RELEASE_DEATH, kind == 2u),
            RELEASE_CORE,
            kind == 4u
        )
    );
    atomicXor(&runtime.values[H_FINGERPRINT], fingerprint);
}

@compute @workgroup_size(1)
fn finalize_projectile_capture_release_preparations() {
    if (atomicLoad(&runtime.values[H_STATUS]) == STATUS_SEALED) {
        let fingerprint = atomicLoad(&runtime.values[H_FINGERPRINT]);
        if (atomicLoad(&runtime.values[H_RELEASES]) > 0u
            && (fingerprint == 0u || fingerprint == INVALID)) {
            atomicStore(&runtime.values[H_FINGERPRINT], 1u);
        }
        atomicStore(&runtime.values[H_COMPLETED_TICK], params.fixed_tick);
        atomicStore(&runtime.values[H_STATUS], STATUS_COMPLETE);
    }
}
`;

/**
 * submit-start release program. storage profile (7): counts/physics/simulation/
 * temporary/combat/capture-state/release-program.
 */
export const GPU_PROJECTILE_CAPTURE_RELEASE_WGSL = /* wgsl */`
const BODY_ABI_VERSION: u32 = ${w(GPU_CIRCLE_BODY_ABI_VERSION)};
const CAPTURE_ABI_VERSION: u32 = ${w(GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION)};
const INVALID: u32 = 0xffffffffu;
const BODY_FLAG_ALIVE: u32 = ${w(GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE)};
const BODY_FLAG_CAPTURED: u32 = ${w(
    GPU_CIRCLE_BODY_SIMULATION_FLAG.PROJECTILE_CAPTURED
)};
const ROLE_SHIFT: u32 = ${w(GPU_PROJECTILE_CAPTURE_STATE_META.ROLE_SHIFT)};
const ROLE_MASK: u32 = ${w(GPU_PROJECTILE_CAPTURE_STATE_META.ROLE_MASK)};
const PHASE_SHIFT: u32 = ${w(GPU_PROJECTILE_CAPTURE_STATE_META.PHASE_SHIFT)};
const PHASE_MASK: u32 = ${w(GPU_PROJECTILE_CAPTURE_STATE_META.PHASE_MASK)};
const PHASE_IDLE: u32 = ${w(GPU_PROJECTILE_CAPTURE_PHASE.IDLE)};
const PHASE_PREPARED: u32 = ${w(GPU_PROJECTILE_CAPTURE_PHASE.RELEASE_PREPARED)};
const ROLE_CAPTOR: u32 = ${w(GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR)};
const ROLE_PROJECTILE: u32 = ${w(GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE)};
const STATUS_RESET: u32 = ${w(GPU_PROJECTILE_CAPTURE_TICK_STATUS.RESET)};
const STATUS_SEALED: u32 = ${w(GPU_PROJECTILE_CAPTURE_TICK_STATUS.SEALED)};
const STATUS_COMPLETE: u32 = ${w(GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE)};
const STATUS_REJECTED: u32 = ${w(GPU_PROJECTILE_CAPTURE_TICK_STATUS.REJECTED)};
const ERROR_ABI: u32 = ${w(GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG.ABI_MISMATCH)};
const ERROR_STALE: u32 = ${w(GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG.STALE_IDENTITY)};
const ERROR_TARGET: u32 = ${w(GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG.UNSUPPORTED_TARGET)};
const FLAG_COMMIT_REQUESTED: u32 = 1u;
const RELEASE_NORMAL: u32 = ${w(GPU_PROJECTILE_CAPTURE_RELEASE_REASON.NORMAL_DUE)};
const RELEASE_DEATH: u32 = ${w(GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_DEATH)};
const RELEASE_CORE: u32 = ${w(GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT)};
const TARGET_FORWARD: u32 = ${w(
    GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD
)};
const TARGET_TOWER: u32 = ${w(GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.TOWER)};
const HEADER_WORDS: u32 = 16u;
const RECORD_WORDS: u32 = 24u;

struct BodyCounts { body_count: u32, addition_count: u32, removal_count: u32, abi_version: u32 }
struct BodyPhysics { position: vec2f, velocity: vec2f, radius: f32, inverse_mass: f32, physical_meta: u32, interaction_meta: u32 }
struct BodySimulation { lifetime: f32, health: atomic<i32>, gameplay_meta: u32, flags: atomic<u32>, flow_field_index: u32, flow_speed: f32, entity_id: u32, incarnation: u32 }
struct BodyTemporary { previous_position: vec2f, predicted_position: vec2f, position_delta: vec2f, grid_index: i32, previous_flow_field_index: u32 }
struct CombatState { target_interaction_layer_mask: u32, duration: u32, peak_damage: atomic<i32>, expires: atomic<u32>, peak_entity: atomic<u32>, peak_incarnation: atomic<u32>, reserved_0: u32, reserved_1: u32, reserved_2: u32, reserved_3: u32 }
struct CaptureState { meta: atomic<u32>, self_entity_id: u32, self_incarnation: u32, peer_body_slot: u32, peer_entity_id: u32, peer_incarnation: u32, captured_at_fixed_tick: u32, release_due_fixed_tick: u32, capture_sequence: u32, captured_speed: f32, facing: vec2f }
struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct TemporaryBuffer { values: array<BodyTemporary> }
struct CombatBuffer { values: array<CombatState> }
struct CaptureStateBuffer { values: array<CaptureState> }
struct AtomicWords { values: array<atomic<u32>> }
@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read_write> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(3) var<storage, read_write> temporaries: TemporaryBuffer;
@group(0) @binding(4) var<storage, read_write> combat: CombatBuffer;
@group(0) @binding(5) var<storage, read_write> capture_states: CaptureStateBuffer;
@group(0) @binding(6) var<storage, read_write> program: AtomicWords;

fn role(meta: u32) -> u32 { return (meta & ROLE_MASK) >> ROLE_SHIFT; }
fn phase(meta: u32) -> u32 { return (meta & PHASE_MASK) >> PHASE_SHIFT; }
fn with_phase(meta: u32, next: u32) -> u32 {
    return (meta & ~PHASE_MASK) | ((next << PHASE_SHIFT) & PHASE_MASK);
}
fn load_record(index: u32, word: u32) -> u32 {
    return atomicLoad(&program.values[HEADER_WORDS + index * RECORD_WORDS + word]);
}
fn exact(slot: u32, entity: u32, incarnation: u32) -> bool {
    return slot < counts.body_count
        && simulations.values[slot].entity_id == entity
        && simulations.values[slot].incarnation == incarnation
        && capture_states.values[slot].self_entity_id == entity
        && capture_states.values[slot].self_incarnation == incarnation;
}
fn finite_vec2(value: vec2f) -> bool { return all(isFinite(value)); }
fn mix_fingerprint(a: u32, b: u32, c: u32) -> u32 {
    var value = (a * 0x9e3779b1u) ^ (b * 0x85ebca6bu) ^ (c * 0xc2b2ae35u);
    value ^= value >> 16u;
    value *= 0x7feb352du;
    value ^= value >> 15u;
    return select(value, 1u, value == 0u || value == INVALID);
}
fn retained_captor_matches(index: u32) -> bool {
    let captor_slot = load_record(index, 2u);
    let projectile_slot = load_record(index, 5u);
    if (!exact(captor_slot, load_record(index, 3u), load_record(index, 4u))) {
        return false;
    }
    let captor_meta = atomicLoad(&capture_states.values[captor_slot].meta);
    return role(captor_meta) == ROLE_CAPTOR
        && phase(captor_meta) == PHASE_PREPARED
        && capture_states.values[captor_slot].peer_body_slot == projectile_slot
        && capture_states.values[captor_slot].peer_entity_id == load_record(index, 6u)
        && capture_states.values[captor_slot].peer_incarnation == load_record(index, 7u)
        && capture_states.values[captor_slot].capture_sequence == load_record(index, 8u);
}
fn record_valid(index: u32) -> bool {
    let captor_slot = load_record(index, 2u);
    let projectile_slot = load_record(index, 5u);
    if (projectile_slot >= counts.body_count) { return false; }
    let projectile_meta = atomicLoad(&capture_states.values[projectile_slot].meta);
    if (!exact(projectile_slot, load_record(index, 6u), load_record(index, 7u))
        || role(atomicLoad(&capture_states.values[projectile_slot].meta)) != ROLE_PROJECTILE
        || phase(projectile_meta) != PHASE_PREPARED
        || capture_states.values[projectile_slot].peer_body_slot != captor_slot
        || capture_states.values[projectile_slot].peer_entity_id != load_record(index, 3u)
        || capture_states.values[projectile_slot].peer_incarnation != load_record(index, 4u)
        || capture_states.values[projectile_slot].capture_sequence != load_record(index, 8u)
        || capture_states.values[projectile_slot].captured_at_fixed_tick
            != load_record(index, 9u)
        || bitcast<u32>(capture_states.values[projectile_slot].captured_speed)
            != load_record(index, 16u)
        || (atomicLoad(&simulations.values[projectile_slot].flags)
            & (BODY_FLAG_ALIVE | BODY_FLAG_CAPTURED))
                != (BODY_FLAG_ALIVE | BODY_FLAG_CAPTURED)
        || atomicLoad(&simulations.values[projectile_slot].health) <= 0
        || simulations.values[projectile_slot].lifetime == 0.0) {
        return false;
    }
    let prepared_at = load_record(index, 10u);
    let reason = load_record(index, 11u);
    let position = vec2f(
        bitcast<f32>(load_record(index, 12u)),
        bitcast<f32>(load_record(index, 13u))
    );
    let velocity = vec2f(
        bitcast<f32>(load_record(index, 14u)),
        bitcast<f32>(load_record(index, 15u))
    );
    let speed = bitcast<f32>(load_record(index, 16u));
    let velocity_length_squared = dot(velocity, velocity);
    if (prepared_at <= load_record(index, 9u)
        || prepared_at == INVALID
        || atomicLoad(&program.values[4u]) != prepared_at + 1u
        || load_record(index, 1u) != mix_fingerprint(
            load_record(index, 3u),
            load_record(index, 6u),
            load_record(index, 8u) ^ prepared_at
        )
        || !finite_vec2(position) || !finite_vec2(velocity)
        || !isFinite(speed) || speed <= 0.0
        || !isFinite(velocity_length_squared) || velocity_length_squared <= 0.0
        || abs(sqrt(velocity_length_squared) - speed) > max(0.0001, speed * 0.0001)) {
        return false;
    }
    let target_selector = load_record(index, 17u);
    if (reason == RELEASE_NORMAL) {
        if (!retained_captor_matches(index)
            || (atomicLoad(&simulations.values[captor_slot].flags)
                & BODY_FLAG_ALIVE) == 0u) { return false; }
        if (target_selector == TARGET_FORWARD) {
            let stored_facing = capture_states.values[projectile_slot].facing;
            let stored_facing_length_squared = dot(stored_facing, stored_facing);
            return finite_vec2(stored_facing)
                && isFinite(stored_facing_length_squared)
                && stored_facing_length_squared > 0.000001
                && dot(normalize(velocity), normalize(stored_facing)) >= 0.9999
                && load_record(index, 18u) == INVALID
                && load_record(index, 19u) == INVALID
                && load_record(index, 20u) == INVALID;
        }
        return target_selector == TARGET_TOWER
            && exact(
                load_record(index, 18u),
                load_record(index, 19u),
                load_record(index, 20u)
            )
            && (atomicLoad(&simulations.values[load_record(index, 18u)].flags)
                & BODY_FLAG_ALIVE) != 0u;
    }
    let stored_facing = capture_states.values[projectile_slot].facing;
    let stored_facing_length_squared = dot(stored_facing, stored_facing);
    return (reason == RELEASE_DEATH || reason == RELEASE_CORE)
        && target_selector == TARGET_FORWARD
        && finite_vec2(stored_facing)
        && isFinite(stored_facing_length_squared)
        && stored_facing_length_squared > 0.000001
        && dot(normalize(velocity), normalize(stored_facing)) >= 0.9999
        && load_record(index, 18u) == INVALID
        && load_record(index, 19u) == INVALID
        && load_record(index, 20u) == INVALID;
}

@compute @workgroup_size(1)
fn clear_projectile_capture_releases() {
    atomicStore(&program.values[8u], 0u);
    atomicStore(&program.values[9u], 0u);
    atomicStore(&program.values[11u], 0u);
    atomicStore(&program.values[7u], select(0u, ERROR_ABI, counts.abi_version != BODY_ABI_VERSION));
    atomicStore(&program.values[6u], STATUS_RESET);
}
@compute @workgroup_size(256)
fn preflight_projectile_capture_releases(@builtin(global_invocation_id) id: vec3u) {
    let index = id.x;
    let count = atomicLoad(&program.values[5u]);
    if (index >= count) { return; }
    if (!record_valid(index)) {
        atomicOr(&program.values[7u], ERROR_STALE);
        return;
    }
    atomicAdd(&program.values[8u], 1u);
    atomicXor(&program.values[11u], load_record(index, 1u));
}
@compute @workgroup_size(1)
fn seal_projectile_capture_releases() {
    let count = atomicLoad(&program.values[5u]);
    let valid = atomicLoad(&program.values[8u]);
    let flags = atomicLoad(&program.values[12u]);
    var errors = atomicLoad(&program.values[7u]);
    let raw_result_fingerprint = atomicLoad(&program.values[11u]);
    let result_fingerprint = select(
        raw_result_fingerprint,
        1u,
        count > 0u && (
            raw_result_fingerprint == 0u
            || raw_result_fingerprint == INVALID
        )
    );
    atomicStore(&program.values[11u], result_fingerprint);
    if (valid != count
        || result_fingerprint != atomicLoad(&program.values[10u])
        || (flags & FLAG_COMMIT_REQUESTED) == 0u) { errors |= ERROR_STALE; }
    atomicStore(&program.values[7u], errors);
    atomicStore(&program.values[6u], select(STATUS_SEALED, STATUS_REJECTED, errors != 0u));
}
@compute @workgroup_size(256)
fn commit_projectile_capture_releases(@builtin(global_invocation_id) id: vec3u) {
    if (atomicLoad(&program.values[6u]) != STATUS_SEALED) { return; }
    let index = id.x;
    if (index >= atomicLoad(&program.values[5u])) { return; }
    let captor_slot = load_record(index, 2u);
    let projectile_slot = load_record(index, 5u);
    let position = vec2f(
        bitcast<f32>(load_record(index, 12u)),
        bitcast<f32>(load_record(index, 13u))
    );
    let velocity = vec2f(
        bitcast<f32>(load_record(index, 14u)),
        bitcast<f32>(load_record(index, 15u))
    );
    physics.values[projectile_slot].position = position;
    physics.values[projectile_slot].velocity = velocity;
    physics.values[projectile_slot].interaction_meta = load_record(index, 22u);
    simulations.values[projectile_slot].gameplay_meta = load_record(index, 21u);
    temporaries.values[projectile_slot].previous_position = position;
    temporaries.values[projectile_slot].predicted_position = position;
    temporaries.values[projectile_slot].position_delta = vec2f(0.0);
    temporaries.values[projectile_slot].grid_index = -1;
    combat.values[projectile_slot].target_interaction_layer_mask = load_record(index, 23u);
    let projectile_meta = atomicLoad(&capture_states.values[projectile_slot].meta);
    if (retained_captor_matches(index)) {
        let captor_meta = atomicLoad(&capture_states.values[captor_slot].meta);
        capture_states.values[captor_slot].peer_body_slot = INVALID;
        capture_states.values[captor_slot].peer_entity_id = INVALID;
        capture_states.values[captor_slot].peer_incarnation = INVALID;
        atomicStore(
            &capture_states.values[captor_slot].meta,
            with_phase(captor_meta, PHASE_IDLE)
        );
    }
    capture_states.values[projectile_slot].peer_body_slot = INVALID;
    capture_states.values[projectile_slot].peer_entity_id = INVALID;
    capture_states.values[projectile_slot].peer_incarnation = INVALID;
    capture_states.values[projectile_slot].facing = vec2f(0.0);
    atomicStore(&capture_states.values[projectile_slot].meta, with_phase(projectile_meta, PHASE_IDLE));
    // pose/team/mask/bilateral state를 전부 쓴 뒤 mirror bit를 마지막에 내립니다.
    atomicAnd(&simulations.values[projectile_slot].flags, ~BODY_FLAG_CAPTURED);
    atomicAdd(&program.values[9u], 1u);
}
@compute @workgroup_size(1)
fn finalize_projectile_capture_releases() {
    if (atomicLoad(&program.values[6u]) == STATUS_SEALED) {
        atomicStore(&program.values[6u], STATUS_COMPLETE);
    }
}
`;

export const GPU_PROJECTILE_CAPTURE_STORAGE_PROFILE = Object.freeze({
    clear_projectile_capture_tick: 2,
    update_projectile_capture_facing: 4,
    validate_projectile_capture_holds: 4,
    select_projectile_capture_distances: 7,
    select_projectile_capture_captors: 7,
    select_ring_capture_distances: 7,
    select_ring_capture_projectiles: 7,
    preflight_projectile_capture_batch: 7,
    seal_projectile_capture_batch: 1,
    commit_projectile_capture_batch: 7,
    finalize_projectile_capture_batch: 1,
    mark_projectile_capture_core_impacts: 7,
    attach_projectile_capture_holds: 5,
    clear_projectile_capture_release_preparations: 1,
    preflight_projectile_capture_release_preparations: 5,
    seal_projectile_capture_release_preparations: 1,
    commit_projectile_capture_release_preparations: 6,
    finalize_projectile_capture_release_preparations: 1,
    clear_projectile_capture_releases: 1,
    preflight_projectile_capture_releases: 4,
    seal_projectile_capture_releases: 1,
    commit_projectile_capture_releases: 7,
    finalize_projectile_capture_releases: 1
});
