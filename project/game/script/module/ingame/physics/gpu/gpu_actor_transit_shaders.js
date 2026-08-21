import { ACTOR_PAYLOAD_CODE } from '../../contract/word_sentence_contract.js';
import {
    GPU_ACTOR_TRANSIT_ABI,
    GPU_ACTOR_TRANSIT_ABI_VERSION,
    GPU_ACTOR_TRANSIT_ERROR_FLAG,
    GPU_ACTOR_TRANSIT_PHASE,
    GPU_ACTOR_TRANSIT_STATUS
} from './gpu_actor_transit_abi.js';

export const GPU_ACTOR_TRANSIT_WORKGROUP_SIZE = 64;
export const GPU_ACTOR_TRANSIT_STORAGE_BINDING_COUNT = 7;

const C = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_TRANSIT_ABI.COMMAND)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));
const A = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_TRANSIT_ABI.AGGREGATE)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));
const R = Object.freeze(Object.fromEntries(
    Object.entries(GPU_ACTOR_TRANSIT_ABI.RECORD)
        .filter(([key]) => key !== 'STRIDE')
        .map(([key, value]) => [key, value / 4])
));

const RECORD_WORD_COUNT = GPU_ACTOR_TRANSIT_ABI.RECORD.STRIDE / 4;
const AGGREGATE_WORD_COUNT = GPU_ACTOR_TRANSIT_ABI.AGGREGATE.STRIDE / 4;

export const GPU_ACTOR_TRANSIT_WGSL = /* wgsl */`
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

struct EnemyBehaviorState {
    program_id: u32,
    state: u32,
    state_entered_fixed_tick: u32,
    state_expires_at_fixed_tick: u32,
    target_slot: u32,
    target_entity_id: u32,
    target_incarnation: u32,
    flags: u32,
    facing_x: f32,
    facing_y: f32,
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

struct RawReadBuffer { values: array<u32> }
struct RawWriteBuffer { values: array<u32> }
struct RawAtomicBuffer { values: array<atomic<u32>> }
struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct AbilityMetadataBuffer { values: array<AbilityEntityMetadata> }
struct EnemyBehaviorBuffer { values: array<EnemyBehaviorState> }

@group(0) @binding(0) var<storage, read> command: RawReadBuffer;
@group(0) @binding(1) var<storage, read_write> records: RawWriteBuffer;
@group(0) @binding(2) var<storage, read_write> physics: PhysicsBuffer;
@group(0) @binding(3) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(4) var<storage, read_write> metadata: AbilityMetadataBuffer;
@group(0) @binding(5) var<storage, read_write> enemy_behaviors: EnemyBehaviorBuffer;
@group(0) @binding(6) var<storage, read_write> aggregate: RawAtomicBuffer;

const TRANSIT_ABI: u32 = ${GPU_ACTOR_TRANSIT_ABI_VERSION}u;
const RECORD_WORDS: u32 = ${RECORD_WORD_COUNT}u;
const AGGREGATE_WORDS: u32 = ${AGGREGATE_WORD_COUNT}u;
const PHASE_EMPTY: u32 = ${GPU_ACTOR_TRANSIT_PHASE.EMPTY}u;
const PHASE_AIRBORNE: u32 = ${GPU_ACTOR_TRANSIT_PHASE.AIRBORNE}u;
const PHASE_ACTIVE: u32 = ${GPU_ACTOR_TRANSIT_PHASE.ACTIVE}u;
const PHASE_CANCELLED: u32 = ${GPU_ACTOR_TRANSIT_PHASE.CANCELLED}u;
const STATUS_COMPLETE: u32 = ${GPU_ACTOR_TRANSIT_STATUS.COMPLETE}u;
const STATUS_PROTOCOL_REJECTED: u32 = ${GPU_ACTOR_TRANSIT_STATUS.PROTOCOL_REJECTED}u;
const ENEMY_PAYLOAD: u32 = ${ACTOR_PAYLOAD_CODE.ENEMY}u;
const FNV_OFFSET: u32 = 2166136261u;
const FNV_PRIME: u32 = 16777619u;
const ERROR_COMMAND_ABI: u32 = ${GPU_ACTOR_TRANSIT_ERROR_FLAG.COMMAND_ABI}u;
const ERROR_RECORD_ABI: u32 = ${GPU_ACTOR_TRANSIT_ERROR_FLAG.RECORD_ABI}u;
const ERROR_IDENTITY: u32 = ${GPU_ACTOR_TRANSIT_ERROR_FLAG.DESTINATION_IDENTITY}u;
const ERROR_FINGERPRINT: u32 = ${GPU_ACTOR_TRANSIT_ERROR_FLAG.RECORD_FINGERPRINT}u;
const ERROR_FIXED_TICK: u32 = ${GPU_ACTOR_TRANSIT_ERROR_FLAG.FIXED_TICK}u;
const ERROR_NON_FINITE: u32 = ${GPU_ACTOR_TRANSIT_ERROR_FLAG.NON_FINITE}u;
const ERROR_PROFILE: u32 = ${GPU_ACTOR_TRANSIT_ERROR_FLAG.PROFILE_CONTRACT}u;

fn command_word(field: u32) -> u32 {
    return command.values[field];
}

fn record_base(slot: u32) -> u32 {
    return slot * RECORD_WORDS;
}

fn record_word(slot: u32, field: u32) -> u32 {
    return records.values[record_base(slot) + field];
}

fn set_record_word(slot: u32, field: u32, value: u32) {
    records.values[record_base(slot) + field] = value;
}

fn hash_word(hash: u32, word: u32) -> u32 {
    return (hash ^ word) * FNV_PRIME;
}

fn nonzero_hash(hash: u32) -> u32 {
    return select(hash, FNV_OFFSET, hash == 0u);
}

fn immutable_record_fingerprint(slot: u32) -> u32 {
    var hash = hash_word(FNV_OFFSET, record_word(slot, ${R.ABI_VERSION}u));
    for (var field = ${R.FLAGS}u; field <= ${R.DURATION_FIXED_TICKS}u;
        field += 1u) {
        hash = hash_word(hash, record_word(slot, field));
    }
    for (var field = ${R.START_X}u; field <= ${R.PRESENTATION_ARC_HEIGHT}u;
        field += 1u) {
        hash = hash_word(hash, record_word(slot, field));
    }
    for (var field = ${R.BASELINE_PHYSICAL_META}u;
        field <= ${R.BASELINE_VELOCITY_Y}u; field += 1u) {
        hash = hash_word(hash, record_word(slot, field));
    }
    hash = hash_word(hash, record_word(slot, ${R.SOURCE_RANK}u));
    return nonzero_hash(hash);
}

fn finite_scalar(value: f32) -> bool {
    return value == value && abs(value) <= 3.402823466e+38;
}

fn finite_vector(value: vec2f) -> bool {
    return finite_scalar(value.x) && finite_scalar(value.y);
}

fn flag_error(error: u32) {
    atomicOr(&aggregate.values[${A.ERROR_FLAGS}u], error);
    atomicAdd(&aggregate.values[${A.INVALID_COUNT}u], 1u);
}

@compute @workgroup_size(1)
fn initialize_actor_transit_aggregate() {
    for (var word = 0u; word < AGGREGATE_WORDS; word += 1u) {
        atomicStore(&aggregate.values[word], 0u);
    }
    atomicStore(&aggregate.values[${A.ABI_VERSION}u], TRANSIT_ABI);
    atomicStore(&aggregate.values[${A.SESSION_GENERATION}u],
        command_word(${C.SESSION_GENERATION}u));
    atomicStore(&aggregate.values[${A.DEVICE_GENERATION}u],
        command_word(${C.DEVICE_GENERATION}u));
    atomicStore(&aggregate.values[${A.AUTHORITATIVE_EPOCH}u],
        command_word(${C.AUTHORITATIVE_EPOCH}u));
    atomicStore(&aggregate.values[${A.SOURCE_TICK}u],
        command_word(${C.SOURCE_TICK}u));
    atomicStore(&aggregate.values[${A.STATUS}u], STATUS_COMPLETE);
    atomicStore(&aggregate.values[${A.BODY_CAPACITY}u],
        command_word(${C.BODY_CAPACITY}u));
    let capacity = command_word(${C.BODY_CAPACITY}u);
    if (command_word(${C.ABI_VERSION}u) != TRANSIT_ABI
        || capacity == 0u
        || capacity != arrayLength(&physics.values)
        || capacity != arrayLength(&simulations.values)
        || capacity != arrayLength(&metadata.values)
        || capacity != arrayLength(&enemy_behaviors.values)
        || capacity * RECORD_WORDS != arrayLength(&records.values)) {
        atomicStore(&aggregate.values[${A.STATUS}u],
            STATUS_PROTOCOL_REJECTED);
        atomicStore(&aggregate.values[${A.ERROR_FLAGS}u], ERROR_COMMAND_ABI);
    }
}

@compute @workgroup_size(${GPU_ACTOR_TRANSIT_WORKGROUP_SIZE})
fn advance_actor_transits(@builtin(global_invocation_id) invocation: vec3u) {
    let slot = invocation.x;
    if (slot >= command_word(${C.BODY_CAPACITY}u)
        || atomicLoad(&aggregate.values[${A.STATUS}u])
            != STATUS_COMPLETE) {
        return;
    }
    let phase = record_word(slot, ${R.PHASE}u);
    if (phase == PHASE_EMPTY) { return; }
    atomicAdd(&aggregate.values[${A.PROCESSED_COUNT}u], 1u);

    let entity_id = record_word(slot, ${R.ENTITY_ID}u);
    let incarnation = record_word(slot, ${R.INCARNATION}u);
    let exact_identity = entity_id != 0u && incarnation != 0u
        && simulations.values[slot].entity_id == entity_id
        && simulations.values[slot].incarnation == incarnation;
    if (phase == PHASE_ACTIVE) {
        if (!exact_identity) {
            set_record_word(slot, ${R.PHASE}u, PHASE_EMPTY);
            return;
        }
        atomicAdd(&aggregate.values[${A.ACTIVE_RECORD_COUNT}u], 1u);
        atomicXor(&aggregate.values[${A.RECORD_FINGERPRINT_XOR}u],
            record_word(slot, ${R.RECORD_FINGERPRINT}u));
        return;
    }
    if (phase == PHASE_CANCELLED) {
        atomicAdd(&aggregate.values[${A.CANCELLED_COUNT}u], 1u);
        flag_error(ERROR_IDENTITY);
        return;
    }
    if (phase != PHASE_AIRBORNE
        || record_word(slot, ${R.ABI_VERSION}u) != TRANSIT_ABI) {
        set_record_word(slot, ${R.PHASE}u, PHASE_CANCELLED);
        atomicAdd(&aggregate.values[${A.CANCELLED_COUNT}u], 1u);
        flag_error(ERROR_RECORD_ABI);
        return;
    }
    if (!exact_identity) {
        set_record_word(slot, ${R.PHASE}u, PHASE_CANCELLED);
        atomicAdd(&aggregate.values[${A.CANCELLED_COUNT}u], 1u);
        flag_error(ERROR_IDENTITY);
        return;
    }
    let fingerprint = record_word(slot, ${R.RECORD_FINGERPRINT}u);
    if (fingerprint == 0u || fingerprint != immutable_record_fingerprint(slot)) {
        set_record_word(slot, ${R.PHASE}u, PHASE_CANCELLED);
        atomicAdd(&aggregate.values[${A.CANCELLED_COUNT}u], 1u);
        flag_error(ERROR_FINGERPRINT);
        return;
    }

    let start_tick = record_word(slot, ${R.START_TICK}u);
    let activation_tick = record_word(slot, ${R.ACTIVATION_TICK}u);
    let duration = record_word(slot, ${R.DURATION_FIXED_TICKS}u);
    let tick = command_word(${C.SOURCE_TICK}u);
    if (duration == 0u || duration > 0xffffffffu - start_tick
        || activation_tick != start_tick + duration) {
        set_record_word(slot, ${R.PHASE}u, PHASE_CANCELLED);
        atomicAdd(&aggregate.values[${A.CANCELLED_COUNT}u], 1u);
        flag_error(ERROR_FIXED_TICK | ERROR_PROFILE);
        return;
    }
    let start = vec2f(
        bitcast<f32>(record_word(slot, ${R.START_X}u)),
        bitcast<f32>(record_word(slot, ${R.START_Y}u))
    );
    let landing = vec2f(
        bitcast<f32>(record_word(slot, ${R.LANDING_X}u)),
        bitcast<f32>(record_word(slot, ${R.LANDING_Y}u))
    );
    let ground_velocity = vec2f(
        bitcast<f32>(record_word(slot, ${R.GROUND_VELOCITY_X}u)),
        bitcast<f32>(record_word(slot, ${R.GROUND_VELOCITY_Y}u))
    );
    let arc_height = bitcast<f32>(
        record_word(slot, ${R.PRESENTATION_ARC_HEIGHT}u)
    );
    if (!finite_vector(start) || !finite_vector(landing)
        || !finite_vector(ground_velocity) || !finite_scalar(arc_height)
        || !(arc_height > 0.0)) {
        set_record_word(slot, ${R.PHASE}u, PHASE_CANCELLED);
        atomicAdd(&aggregate.values[${A.CANCELLED_COUNT}u], 1u);
        flag_error(ERROR_NON_FINITE);
        return;
    }

    let elapsed = select(0u, tick - start_tick, tick > start_tick);
    let progress = min(duration, elapsed);
    let ratio = f32(progress) / f32(duration);
    let position = mix(start, landing, ratio);
    let presentation_height = select(
        4.0 * arc_height * ratio * (1.0 - ratio),
        0.0,
        progress == duration
    );
    physics.values[slot].position = position;
    physics.values[slot].velocity = vec2f(0.0);
    physics.values[slot].physical_meta = 0u;
    physics.values[slot].interaction_meta = 0u;
    metadata.values[slot].noun_mask = 0u;
    simulations.values[slot].flow_speed = 0.0;
    set_record_word(slot, ${R.PROGRESS_FIXED_TICKS}u, progress);
    set_record_word(slot, ${R.CURRENT_PRESENTATION_ARC_HEIGHT}u,
        bitcast<u32>(presentation_height));
    atomicMax(
        &aggregate.values[${A.MAX_PRESENTATION_ARC_HEIGHT}u],
        bitcast<u32>(presentation_height)
    );

    if (tick >= activation_tick) {
        physics.values[slot].position = landing;
        physics.values[slot].velocity = vec2f(
            bitcast<f32>(record_word(slot, ${R.BASELINE_VELOCITY_X}u)),
            bitcast<f32>(record_word(slot, ${R.BASELINE_VELOCITY_Y}u))
        );
        physics.values[slot].physical_meta
            = record_word(slot, ${R.BASELINE_PHYSICAL_META}u);
        physics.values[slot].interaction_meta
            = record_word(slot, ${R.BASELINE_INTERACTION_META}u);
        metadata.values[slot].noun_mask
            = record_word(slot, ${R.BASELINE_NOUN_MASK}u);
        simulations.values[slot].flow_field_index
            = record_word(slot, ${R.BASELINE_FLOW_FIELD_INDEX}u);
        simulations.values[slot].flow_speed = bitcast<f32>(
            record_word(slot, ${R.BASELINE_FLOW_SPEED}u)
        );
        if (record_word(slot, ${R.PAYLOAD_CODE}u) == ENEMY_PAYLOAD) {
            let speed_squared = dot(ground_velocity, ground_velocity);
            if (speed_squared > 0.000001) {
                let facing = ground_velocity * inverseSqrt(speed_squared);
                enemy_behaviors.values[slot].facing_x = facing.x;
                enemy_behaviors.values[slot].facing_y = facing.y;
            }
        }
        set_record_word(slot, ${R.PHASE}u, PHASE_ACTIVE);
        set_record_word(slot, ${R.CURRENT_PRESENTATION_ARC_HEIGHT}u, 0u);
        atomicAdd(&aggregate.values[${A.ACTIVE_RECORD_COUNT}u], 1u);
        atomicAdd(&aggregate.values[${A.LANDED_COUNT}u], 1u);
    } else {
        atomicAdd(&aggregate.values[${A.AIRBORNE_COUNT}u], 1u);
    }
    atomicXor(&aggregate.values[${A.RECORD_FINGERPRINT_XOR}u], fingerprint);
}

@compute @workgroup_size(1)
fn seal_actor_transit_aggregate() {
    let errors = atomicLoad(&aggregate.values[${A.ERROR_FLAGS}u]);
    let invalid = atomicLoad(&aggregate.values[${A.INVALID_COUNT}u]);
    let cancelled = atomicLoad(&aggregate.values[${A.CANCELLED_COUNT}u]);
    if (errors != 0u || invalid != 0u || cancelled != 0u) {
        atomicStore(&aggregate.values[${A.STATUS}u],
            STATUS_PROTOCOL_REJECTED);
    }
}
`;
