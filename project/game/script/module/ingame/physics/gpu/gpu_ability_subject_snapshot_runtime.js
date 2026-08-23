import {
    GAMEPLAY_NOUN_MASK,
    SUBJECT_SELECTOR_CODE
} from '../../contract/word_sentence_contract.js';
import { GAMEPLAY_TEAM_ID } from '../../contract/gameplay_team_contract.js';
import {
    normalizeAbilityExecutionCommand
} from '../../contract/ability_execution_contract.js';
import {
    TOWER_GROUP_OPERATION_KIND
} from '../../contract/tower_group_operation_contract.js';
import {
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI,
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION,
    ABILITY_ENTITY_METADATA_ABI_VERSION,
    ABILITY_EXECUTION_COMMAND_ABI_VERSION,
    ABILITY_SUBJECT_SNAPSHOT_ERROR_FLAG,
    ABILITY_SUBJECT_SNAPSHOT_STATUS,
    clearGpuAbilityEntityMetadata,
    readGpuAbilitySubjectAggregate,
    readGpuAbilitySubjectIdentities,
    writeGpuAbilityEntityMetadata,
    writeGpuAbilityExecutionCommand
} from './gpu_ability_subject_snapshot_abi.js';
import {
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_GAMEPLAY_META,
    GPU_CIRCLE_BODY_META
} from './gpu_circle_body_abi.js';

export const GPU_ABILITY_SUBJECT_SNAPSHOT_STORAGE_BINDING_COUNT = 9;
export const GPU_ABILITY_SUBJECT_SNAPSHOT_DEFAULT_COMMAND_CAPACITY = 32;
export const GPU_ABILITY_SUBJECT_SNAPSHOT_DEFAULT_SUBJECT_CAPACITY = 1000;
export const GPU_ABILITY_SUBJECT_SNAPSHOT_DEFAULT_READBACK_SLOTS = 4;

const AGGREGATE_WORD_COUNT
    = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.AGGREGATE.STRIDE / 4;
const SNAPSHOT_WORD_COUNT
    = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE / 4;
const IDENTITY_WORD_COUNT
    = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.IDENTITY_RECORD.STRIDE / 4;
const COMMAND_WORD_COUNT
    = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.COMMAND.STRIDE / 4;
const INVALID_INDEX = 0xffffffff;
const LITTLE_ENDIAN = true;
const PIPELINES_BY_DEVICE = new WeakMap();

function requiresTowerMergeExactIdentityReadback(command) {
    return command?.compiledAbility?.operationKind
        === TOWER_GROUP_OPERATION_KIND.MERGE;
}

export const GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL = /* wgsl */`
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

struct ContactHandler {
    damage_self: f32,
    damage_other: f32,
    damage_falloff: f32,
    fire_timer: f32,
    flags: u32,
    chaining: u32,
    damage_report_id: u32,
    slow_timer: f32,
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

struct RouteRuntimeState {
    route_meta: u32,
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

struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct ContactHandlerBuffer { values: array<ContactHandler> }
struct EnemyBehaviorBuffer { values: array<EnemyBehaviorState> }
struct RouteRuntimeBuffer { values: array<RouteRuntimeState> }
struct AbilityMetadataBuffer { values: array<AbilityEntityMetadata> }
struct RawReadBuffer { values: array<u32> }
struct RawAtomicBuffer { values: array<atomic<u32>> }

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(3) var<storage, read> contact_handlers: ContactHandlerBuffer;
@group(0) @binding(4) var<storage, read> enemy_behaviors: EnemyBehaviorBuffer;
@group(0) @binding(5) var<storage, read> route_states: RouteRuntimeBuffer;
@group(0) @binding(6) var<storage, read> ability_metadata: AbilityMetadataBuffer;
@group(0) @binding(7) var<storage, read> commands: RawReadBuffer;
@group(0) @binding(8) var<storage, read_write> output: RawAtomicBuffer;

const BODY_ABI_VERSION: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;
const METADATA_ABI_VERSION: u32 = ${ABILITY_ENTITY_METADATA_ABI_VERSION}u;
const COMMAND_ABI_VERSION: u32 = ${ABILITY_EXECUTION_COMMAND_ABI_VERSION}u;
const SNAPSHOT_ABI_VERSION: u32 = ${GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION}u;
const COMMAND_WORD_COUNT: u32 = ${COMMAND_WORD_COUNT}u;
const AGGREGATE_WORD_COUNT: u32 = ${AGGREGATE_WORD_COUNT}u;
const SNAPSHOT_WORD_COUNT: u32 = ${SNAPSHOT_WORD_COUNT}u;
const IDENTITY_WORD_COUNT: u32 = ${IDENTITY_WORD_COUNT}u;
const ALIVE_FLAG: u32 = ${GPU_CIRCLE_BODY_META.ALIVE_BIT}u;
const TEAM_SHIFT: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_SHIFT}u;
const TEAM_MASK: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_MASK}u;
const TOWER_SELECTOR: u32 = ${SUBJECT_SELECTOR_CODE.TOWER}u;
const ENEMY_SELECTOR: u32 = ${SUBJECT_SELECTOR_CODE.ENEMY}u;
const TOWER_NOUN: u32 = ${GAMEPLAY_NOUN_MASK.TOWER}u;
const ENEMY_NOUN: u32 = ${GAMEPLAY_NOUN_MASK.ENEMY}u;
const PLAYER_TEAM: u32 = ${GAMEPLAY_TEAM_ID.PLAYER}u;
const HOSTILE_TEAM: u32 = ${GAMEPLAY_TEAM_ID.HOSTILE}u;
const STATUS_COMPLETE: u32 = ${ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE}u;
const STATUS_ZERO_SUBJECT: u32 = ${ABILITY_SUBJECT_SNAPSHOT_STATUS.ZERO_SUBJECT}u;
const STATUS_CAPACITY_REJECTED: u32 = ${ABILITY_SUBJECT_SNAPSHOT_STATUS.CAPACITY_REJECTED}u;
const STATUS_PROTOCOL_REJECTED: u32 = ${ABILITY_SUBJECT_SNAPSHOT_STATUS.PROTOCOL_REJECTED}u;
const ERROR_BODY_ABI: u32 = ${ABILITY_SUBJECT_SNAPSHOT_ERROR_FLAG.BODY_ABI}u;
const ERROR_COMMAND_ABI: u32 = ${ABILITY_SUBJECT_SNAPSHOT_ERROR_FLAG.COMMAND_ABI}u;
const ERROR_SUBJECT_CAPACITY: u32 = ${ABILITY_SUBJECT_SNAPSHOT_ERROR_FLAG.SUBJECT_CAPACITY}u;
const ERROR_STALE_PROTOCOL: u32 = ${ABILITY_SUBJECT_SNAPSHOT_ERROR_FLAG.STALE_PROTOCOL}u;
const FNV_OFFSET: u32 = 2166136261u;
const FNV_PRIME: u32 = 16777619u;

fn command_word(command_index: u32, field: u32) -> u32 {
    return commands.values[command_index * COMMAND_WORD_COUNT + field];
}

fn store_aggregate(base: u32, field: u32, value: u32) {
    atomicStore(&output.values[base + field], value);
}

fn hash_word(current: u32, value: u32) -> u32 {
    return (current ^ value) * FNV_PRIME;
}

fn write_snapshot(base: u32, body_slot: u32, ordinal: u32) {
    let simulation = &simulations.values[body_slot];
    let body_physics = physics.values[body_slot];
    let metadata = ability_metadata.values[body_slot];
    let behavior = enemy_behaviors.values[body_slot];
    let route = route_states.values[body_slot];
    let team_id = (simulation.gameplay_meta >> TEAM_SHIFT) & TEAM_MASK;
    var facing = vec2f(behavior.facing_x, behavior.facing_y);
    if (dot(facing, facing) <= 0.000001) {
        facing = body_physics.velocity;
    }
    if (dot(facing, facing) <= 0.000001) {
        facing = vec2f(1.0, 0.0);
    } else {
        facing = normalize(facing);
    }
    let values = array<u32, ${SNAPSHOT_WORD_COUNT}>(
        body_slot,
        simulation.entity_id,
        simulation.incarnation,
        team_id,
        bitcast<u32>(body_physics.position.x),
        bitcast<u32>(body_physics.position.y),
        bitcast<u32>(body_physics.velocity.x),
        bitcast<u32>(body_physics.velocity.y),
        bitcast<u32>(facing.x),
        bitcast<u32>(facing.y),
        simulation.flow_field_index,
        route.current_path_index,
        route.route_set_index,
        metadata.definition_code,
        metadata.generation,
        metadata.owner_entity_id,
        metadata.owner_incarnation,
        bitcast<u32>(contact_handlers.values[body_slot].damage_other),
        bitcast<u32>(atomicLoad(&simulation.health)),
        metadata.source_execution_ordinal,
        metadata.power_fixed_point,
        metadata.source_execution_fingerprint,
        metadata.source_ability_code,
        metadata.creation_origin_code,
        bitcast<u32>(body_physics.radius),
        bitcast<u32>(simulation.flow_speed),
        route.route_meta,
        route.profile_code
    );
    let record_base = base + ordinal * SNAPSHOT_WORD_COUNT;
    for (var word = 0u; word < SNAPSHOT_WORD_COUNT; word++) {
        atomicStore(&output.values[record_base + word], values[word]);
    }
}

fn write_identity(base: u32, body_slot: u32, ordinal: u32) {
    let simulation = &simulations.values[body_slot];
    let record_base = base + ordinal * IDENTITY_WORD_COUNT;
    atomicStore(&output.values[record_base], body_slot);
    atomicStore(&output.values[record_base + 1u], simulation.entity_id);
    atomicStore(&output.values[record_base + 2u], simulation.incarnation);
}

@compute @workgroup_size(1)
fn snapshot_subjects(@builtin(global_invocation_id) gid: vec3u) {
    let command_index = gid.x;
    let command_abi = command_word(command_index, 0u);
    let session_generation = command_word(command_index, 1u);
    let device_generation = command_word(command_index, 2u);
    let authoritative_epoch = command_word(command_index, 3u);
    let source_tick = command_word(command_index, 4u);
    let execution_ordinal = command_word(command_index, 5u);
    let selector_code = command_word(command_index, 6u);
    let noun_mask = command_word(command_index, 7u);
    let team_id = command_word(command_index, 8u);
    let subject_limit = command_word(command_index, 9u);
    let generation_limit = command_word(command_index, 10u);
    let command_fingerprint = command_word(command_index, 13u);
    let output_slot = command_word(command_index, 19u);
    let snapshot_capacity = command_word(command_index, 20u);
    let aggregate_base = command_word(command_index, 21u);
    let snapshot_base = command_word(command_index, 22u);
    let identity_base = command_word(command_index, 23u);

    for (var word = 0u; word < AGGREGATE_WORD_COUNT; word++) {
        store_aggregate(aggregate_base, word, 0u);
    }
    store_aggregate(aggregate_base, 0u, SNAPSHOT_ABI_VERSION);
    store_aggregate(aggregate_base, 1u, counts.abi_version);
    store_aggregate(aggregate_base, 2u, session_generation);
    store_aggregate(aggregate_base, 3u, device_generation);
    store_aggregate(aggregate_base, 4u, authoritative_epoch);
    store_aggregate(aggregate_base, 5u, source_tick);
    store_aggregate(aggregate_base, 6u, execution_ordinal);
    store_aggregate(aggregate_base, 10u, subject_limit);
    store_aggregate(aggregate_base, 11u, command_fingerprint);
    store_aggregate(aggregate_base, 14u, output_slot);
    store_aggregate(aggregate_base, 15u, generation_limit);

    let exact_selector = (selector_code == TOWER_SELECTOR
            && noun_mask == TOWER_NOUN && team_id == PLAYER_TEAM)
        || (selector_code == ENEMY_SELECTOR
            && noun_mask == ENEMY_NOUN && team_id == HOSTILE_TEAM);
    if (counts.abi_version != BODY_ABI_VERSION) {
        store_aggregate(aggregate_base, 7u, STATUS_PROTOCOL_REJECTED);
        store_aggregate(aggregate_base, 13u, ERROR_BODY_ABI);
        return;
    }
    if (command_abi != COMMAND_ABI_VERSION || !exact_selector
        || subject_limit == 0u || snapshot_capacity == 0u
        || subject_limit > snapshot_capacity || execution_ordinal == 0u) {
        store_aggregate(aggregate_base, 7u, STATUS_PROTOCOL_REJECTED);
        store_aggregate(aggregate_base, 13u, ERROR_COMMAND_ABI);
        return;
    }

    var demand = 0u;
    var fingerprint = hash_word(FNV_OFFSET, command_fingerprint);
    for (var body_slot = 0u; body_slot < counts.body_count; body_slot++) {
        let simulation = &simulations.values[body_slot];
        let flags = atomicLoad(&simulation.flags);
        if ((flags & ALIVE_FLAG) == 0u) {
            continue;
        }
        let metadata = ability_metadata.values[body_slot];
        if (metadata.abi_version != METADATA_ABI_VERSION) {
            store_aggregate(aggregate_base, 7u, STATUS_PROTOCOL_REJECTED);
            store_aggregate(aggregate_base, 13u, ERROR_STALE_PROTOCOL);
            return;
        }
        let owner_pair_valid = (metadata.owner_entity_id == 0u)
            == (metadata.owner_incarnation == 0u);
        if (!owner_pair_valid || (metadata.noun_mask != 0u
                && metadata.definition_code == 0u)) {
            store_aggregate(aggregate_base, 7u, STATUS_PROTOCOL_REJECTED);
            store_aggregate(aggregate_base, 13u, ERROR_STALE_PROTOCOL);
            return;
        }
        let body_team = (simulation.gameplay_meta >> TEAM_SHIFT) & TEAM_MASK;
        let selected = body_team == team_id
            && (metadata.noun_mask & noun_mask) == noun_mask
            && metadata.generation < generation_limit
            && metadata.visible_from_execution_ordinal <= execution_ordinal;
        if (!selected) {
            continue;
        }
        let ordinal = demand;
        demand += 1u;
        fingerprint = hash_word(fingerprint, body_slot);
        fingerprint = hash_word(fingerprint, simulation.entity_id);
        fingerprint = hash_word(fingerprint, simulation.incarnation);
        if (ordinal < snapshot_capacity) {
            write_snapshot(snapshot_base, body_slot, ordinal);
            write_identity(identity_base, body_slot, ordinal);
        }
    }
    store_aggregate(aggregate_base, 9u, demand);
    store_aggregate(aggregate_base, 12u, fingerprint);
    if (demand == 0u) {
        store_aggregate(aggregate_base, 7u, STATUS_ZERO_SUBJECT);
        return;
    }
    if (demand > subject_limit || demand > snapshot_capacity) {
        store_aggregate(aggregate_base, 7u, STATUS_CAPACITY_REJECTED);
        store_aggregate(aggregate_base, 13u, ERROR_SUBJECT_CAPACITY);
        return;
    }
    store_aggregate(aggregate_base, 7u, STATUS_COMPLETE);
    store_aggregate(aggregate_base, 8u, demand);
}
`;

function requirePositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number > 0xffffffff) {
        throw new RangeError(`${label}은 양의 uint32 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
        throw new RangeError(`${label}은 uint32 정수여야 합니다.`);
    }
    return number;
}

function captureFailure(stage, error) {
    return Object.freeze({
        stage,
        name: String(error?.name ?? 'Error'),
        message: String(error?.message ?? error)
    });
}

function requireGpuGlobals() {
    const usage = globalThis.GPUBufferUsage;
    const stage = globalThis.GPUShaderStage;
    const mapMode = globalThis.GPUMapMode;
    if (!usage || !stage || !mapMode
        || !Number.isSafeInteger(usage.STORAGE)
        || !Number.isSafeInteger(usage.COPY_SRC)
        || !Number.isSafeInteger(usage.COPY_DST)
        || !Number.isSafeInteger(usage.MAP_READ)
        || !Number.isSafeInteger(stage.COMPUTE)
        || !Number.isSafeInteger(mapMode.READ)) {
        throw new Error('AbilitySubjectSnapshot에 필요한 WebGPU 상수가 없습니다.');
    }
    return { usage, stage, mapMode };
}

function createBuffer(device, label, size, usage) {
    return device.createBuffer({ label, size: Math.max(4, size), usage });
}

function getPipelines(device, stage) {
    let cached = PIPELINES_BY_DEVICE.get(device);
    if (cached) return cached;
    const layout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-ability-subject-snapshot-layout',
        entries: [
            { binding: 0, visibility: stage.COMPUTE,
                buffer: { type: 'read-only-storage' } },
            { binding: 1, visibility: stage.COMPUTE,
                buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: stage.COMPUTE,
                buffer: { type: 'storage' } },
            { binding: 3, visibility: stage.COMPUTE,
                buffer: { type: 'read-only-storage' } },
            { binding: 4, visibility: stage.COMPUTE,
                buffer: { type: 'read-only-storage' } },
            { binding: 5, visibility: stage.COMPUTE,
                buffer: { type: 'read-only-storage' } },
            { binding: 6, visibility: stage.COMPUTE,
                buffer: { type: 'read-only-storage' } },
            { binding: 7, visibility: stage.COMPUTE,
                buffer: { type: 'read-only-storage' } },
            { binding: 8, visibility: stage.COMPUTE,
                buffer: { type: 'storage' } }
        ]
    });
    const module = device.createShaderModule({
        label: 'cirvivor-gpu-ability-subject-snapshot-shader',
        code: GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL
    });
    const pipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-ability-subject-snapshot-pipeline-layout',
        bindGroupLayouts: [layout]
    });
    cached = Object.freeze({
        layout,
        pipeline: device.createComputePipeline({
            label: 'cirvivor-gpu-ability-subject-snapshot-pipeline',
            layout: pipelineLayout,
            compute: { module, entryPoint: 'snapshot_subjects' }
        })
    });
    PIPELINES_BY_DEVICE.set(device, cached);
    return cached;
}

function sameResources(left, right) {
    return left?.counts === right?.counts
        && left?.physics === right?.physics
        && left?.simulation === right?.simulation
        && left?.contactHandlers === right?.contactHandlers
        && left?.enemyBehaviorStates === right?.enemyBehaviorStates
        && left?.routeRuntimeStates === right?.routeRuntimeStates;
}

/**
 * GPU-only subject record와 aggregate readback ring을 소유합니다. Tower Merge만
 * bounded identity triple을 함께 읽고, 다른 Ability는 aggregate-only를 유지합니다.
 * Snapshot token은 후속 payload pass가 release할 때까지 output slot을 고정합니다.
 */
export class GpuAbilitySubjectSnapshotRuntime {
    constructor(options = {}) {
        this.capacity = requirePositiveInteger(options.capacity, 'capacity');
        this.sessionGeneration = requirePositiveInteger(
            options.sessionGeneration ?? 1,
            'sessionGeneration'
        );
        this.commandCapacity = requirePositiveInteger(
            options.commandCapacity
                ?? GPU_ABILITY_SUBJECT_SNAPSHOT_DEFAULT_COMMAND_CAPACITY,
            'commandCapacity'
        );
        this.subjectCapacity = requirePositiveInteger(
            options.subjectCapacity
                ?? GPU_ABILITY_SUBJECT_SNAPSHOT_DEFAULT_SUBJECT_CAPACITY,
            'subjectCapacity'
        );
        this.readbackSlotCount = requirePositiveInteger(
            options.readbackSlotCount
                ?? GPU_ABILITY_SUBJECT_SNAPSHOT_DEFAULT_READBACK_SLOTS,
            'readbackSlotCount'
        );
        if (this.readbackSlotCount > this.commandCapacity) {
            throw new RangeError('readbackSlotCount는 commandCapacity 이하여야 합니다.');
        }
        this.aggregateRegionByteSize = this.commandCapacity
            * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.AGGREGATE.STRIDE;
        this.snapshotRegionByteSize = this.commandCapacity
            * this.subjectCapacity
            * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE;
        this.identityRegionByteSize = this.commandCapacity
            * this.subjectCapacity
            * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.IDENTITY_RECORD.STRIDE;
        this.outputByteSize = this.aggregateRegionByteSize
            + this.snapshotRegionByteSize
            + this.identityRegionByteSize;
        this.metadataBytes = new ArrayBuffer(
            this.capacity
                * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA.STRIDE
        );
        this.commandBytes = new ArrayBuffer(
            this.commandCapacity
                * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.COMMAND.STRIDE
        );
        this.pendingCommands = [];
        this.pendingExecutionIds = new Set();
        this.completed = [];
        this.snapshotRecords = new WeakMap();
        this.retainedSnapshotTokens = new Set();
        this.freeOutputSlots = [];
        this.readbackSlots = [];
        this.readbackCursor = 0;
        this.resourceLease = 0;
        this.pendingReadbacks = 0;
        this.device = null;
        this.deviceGeneration = 0;
        this.authoritativeEpoch = 0;
        this.sourceResources = null;
        this.buffers = null;
        this.bindGroup = null;
        this.pipelines = null;
        this.mapReadMode = null;
        this.state = 'idle';
        this.failure = null;
        this.destroyed = false;
        this.lastSubmittedTick = 0;
        this.lastCompletedTick = 0;
        this.submittedExecutionCount = 0;
        this.completedExecutionCount = 0;
        this.zeroSubjectCount = 0;
        this.capacityRejectedCount = 0;
        this.protocolRejectedCount = 0;
        this.ringDeferredCount = 0;
        this.aggregateReadbackByteSize
            = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.AGGREGATE.STRIDE;
        this.maximumReadbackByteSize = this.aggregateReadbackByteSize
            + this.subjectCapacity
                * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.IDENTITY_RECORD.STRIDE;
    }

    initialize(device, resources, protocol = {}) {
        if (this.destroyed) return false;
        if (!device || typeof device.createBuffer !== 'function') {
            throw new TypeError('AbilitySubjectSnapshot에 GPUDevice가 필요합니다.');
        }
        for (const key of [
            'counts',
            'physics',
            'simulation',
            'contactHandlers',
            'enemyBehaviorStates',
            'routeRuntimeStates'
        ]) {
            if (!resources?.[key]) {
                throw new TypeError(`AbilitySubjectSnapshot ${key} buffer가 없습니다.`);
            }
        }
        const deviceGeneration = requireNonNegativeInteger(
            protocol.deviceGeneration ?? 0,
            'deviceGeneration'
        );
        const authoritativeEpoch = requireNonNegativeInteger(
            protocol.authoritativeEpoch ?? 0,
            'authoritativeEpoch'
        );
        if (this.device === device
            && this.deviceGeneration === deviceGeneration
            && sameResources(this.sourceResources, resources)
            && this.state === 'ready') {
            // Body resource identity가 같은 ordinary idle/respawn epoch 전환은
            // accepted frozen snapshot token을 폐기하지 않습니다. 새 command만
            // 갱신된 authoritative epoch을 사용합니다.
            this.authoritativeEpoch = authoritativeEpoch;
            return true;
        }
        const { usage, stage, mapMode } = requireGpuGlobals();
        const maximumBufferSize = Number(device.limits?.maxBufferSize ?? Infinity);
        const maximumStorageSize = Number(
            device.limits?.maxStorageBufferBindingSize ?? Infinity
        );
        if (this.outputByteSize > maximumBufferSize
            || this.outputByteSize > maximumStorageSize
            || this.metadataBytes.byteLength > maximumStorageSize
            || Number(device.limits?.maxStorageBuffersPerShaderStage ?? Infinity)
                < GPU_ABILITY_SUBJECT_SNAPSHOT_STORAGE_BINDING_COUNT) {
            throw new RangeError('AbilitySubjectSnapshot WebGPU storage limit가 부족합니다.');
        }
        this.#retireResources('resource-rebind');
        this.device = device;
        this.deviceGeneration = deviceGeneration;
        this.authoritativeEpoch = authoritativeEpoch;
        this.sourceResources = Object.freeze({ ...resources });
        this.mapReadMode = mapMode.READ;
        this.pipelines = getPipelines(device, stage);
        const storageUsage = usage.STORAGE | usage.COPY_DST | usage.COPY_SRC;
        this.buffers = Object.freeze({
            metadata: createBuffer(
                device,
                'cirvivor-gpu-ability-entity-metadata',
                this.metadataBytes.byteLength,
                storageUsage
            ),
            commands: createBuffer(
                device,
                'cirvivor-gpu-ability-execution-commands',
                this.commandBytes.byteLength,
                usage.STORAGE | usage.COPY_DST
            ),
            output: createBuffer(
                device,
                'cirvivor-gpu-ability-subject-snapshots',
                this.outputByteSize,
                storageUsage
            )
        });
        device.queue.writeBuffer(this.buffers.metadata, 0, this.metadataBytes);
        this.bindGroup = device.createBindGroup({
            label: 'cirvivor-gpu-ability-subject-snapshot-bind-group',
            layout: this.pipelines.layout,
            entries: [
                { binding: 0, resource: { buffer: resources.counts } },
                { binding: 1, resource: { buffer: resources.physics } },
                { binding: 2, resource: { buffer: resources.simulation } },
                { binding: 3, resource: { buffer: resources.contactHandlers } },
                { binding: 4, resource: { buffer: resources.enemyBehaviorStates } },
                { binding: 5, resource: { buffer: resources.routeRuntimeStates } },
                { binding: 6, resource: { buffer: this.buffers.metadata } },
                { binding: 7, resource: { buffer: this.buffers.commands } },
                { binding: 8, resource: { buffer: this.buffers.output } }
            ]
        });
        const lease = ++this.resourceLease;
        this.readbackSlots = Array.from(
            { length: this.readbackSlotCount },
            (_, index) => ({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-ability-subject-readback-${index}`,
                    this.maximumReadbackByteSize,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                lease,
                envelope: null
            })
        );
        this.freeOutputSlots = Array.from(
            { length: this.commandCapacity },
            (_, index) => this.commandCapacity - 1 - index
        );
        this.readbackCursor = 0;
        this.pendingReadbacks = 0;
        this.state = 'ready';
        this.failure = null;
        return true;
    }

    synchronizeEntityMetadata(entries) {
        if (this.destroyed || this.state !== 'ready' || !this.buffers) {
            return Object.freeze({ accepted: false, reason: 'runtime-unavailable' });
        }
        if (!Array.isArray(entries)) {
            throw new TypeError('ability metadata entries는 배열이어야 합니다.');
        }
        const slots = new Set();
        const normalized = entries.map((entry, index) => {
            const slot = requireNonNegativeInteger(entry?.slot, `entries[${index}].slot`);
            if (slot >= this.capacity || slots.has(slot)) {
                throw new RangeError('ability metadata slot이 중복되거나 capacity를 벗어났습니다.');
            }
            slots.add(slot);
            if (entry.metadata === null) {
                clearGpuAbilityEntityMetadata(this.metadataBytes, this.capacity, slot);
            } else {
                writeGpuAbilityEntityMetadata(
                    this.metadataBytes,
                    this.capacity,
                    slot,
                    entry.metadata
                );
            }
            return { slot, metadata: entry.metadata };
        }).sort((left, right) => left.slot - right.slot);
        const stride = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA.STRIDE;
        let rangeStart = 0;
        while (rangeStart < normalized.length) {
            let rangeEnd = rangeStart + 1;
            while (rangeEnd < normalized.length
                && normalized[rangeEnd].slot
                    === normalized[rangeEnd - 1].slot + 1) {
                rangeEnd++;
            }
            const firstSlot = normalized[rangeStart].slot;
            const byteLength = (rangeEnd - rangeStart) * stride;
            this.device.queue.writeBuffer(
                this.buffers.metadata,
                firstSlot * stride,
                this.metadataBytes,
                firstSlot * stride,
                byteLength
            );
            rangeStart = rangeEnd;
        }
        return Object.freeze({ accepted: true, updatedCount: normalized.length });
    }

    stageExecution(command) {
        if (this.destroyed) {
            return Object.freeze({ accepted: false, reason: 'destroyed' });
        }
        let normalized;
        try {
            normalized = normalizeAbilityExecutionCommand(command);
        } catch (error) {
            return Object.freeze({
                accepted: false,
                reason: 'ability-execution-command-contract',
                message: String(error?.message ?? error)
            });
        }
        if (normalized.subjectLimit > this.subjectCapacity) {
            return Object.freeze({
                accepted: false,
                reason: 'ability-subject-limit-capacity',
                capacity: this.subjectCapacity,
                requested: normalized.subjectLimit
            });
        }
        if (this.pendingExecutionIds.has(normalized.executionId)) {
            return Object.freeze({ accepted: false, reason: 'duplicate-execution' });
        }
        const occupied = this.pendingCommands.length + this.pendingReadbacks
            + this.retainedSnapshotTokens.size;
        if (occupied >= this.commandCapacity) {
            return Object.freeze({
                accepted: false,
                reason: 'ability-command-capacity',
                retryable: true
            });
        }
        this.pendingCommands.push(normalized);
        this.pendingExecutionIds.add(normalized.executionId);
        return Object.freeze({
            accepted: true,
            executionId: normalized.executionId,
            executionOrdinal: normalized.executionOrdinal,
            targetFixedTick: normalized.targetFixedTick,
            fingerprint: normalized.fingerprint
        });
    }

    submitPendingForFixedTick(sourceTick) {
        const tick = requireNonNegativeInteger(sourceTick, 'sourceTick');
        if (this.destroyed || this.state !== 'ready' || !this.device
            || !this.bindGroup || this.pendingCommands.length === 0) {
            return Object.freeze({ submittedCount: 0, deferredCount: 0 });
        }
        const claims = [];
        for (let index = 0; index < this.pendingCommands.length;) {
            const command = this.pendingCommands[index];
            if (command.targetFixedTick > tick) {
                index++;
                continue;
            }
            const readback = this.#claimReadbackSlot();
            const outputSlot = this.freeOutputSlots.pop();
            if (!readback || outputSlot === undefined) {
                if (readback) this.#releaseReadbackSlot(readback);
                if (outputSlot !== undefined) this.freeOutputSlots.push(outputSlot);
                break;
            }
            this.pendingCommands.splice(index, 1);
            claims.push({ command, readback, outputSlot });
            if (claims.length >= this.readbackSlotCount) break;
        }
        const eligibleRemaining = this.pendingCommands.filter(
            (command) => command.targetFixedTick <= tick
        ).length;
        if (eligibleRemaining > 0) {
            this.ringDeferredCount += eligibleRemaining;
        }
        if (claims.length === 0) {
            return Object.freeze({
                submittedCount: 0,
                deferredCount: eligibleRemaining
            });
        }

        new Uint8Array(
            this.commandBytes,
            0,
            claims.length * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.COMMAND.STRIDE
        ).fill(0);
        for (let index = 0; index < claims.length; index++) {
            const claim = claims[index];
            const aggregateWordOffset = claim.outputSlot * AGGREGATE_WORD_COUNT;
            const snapshotWordOffset = this.aggregateRegionByteSize / 4
                + claim.outputSlot * this.subjectCapacity * SNAPSHOT_WORD_COUNT;
            const identityWordOffset = (
                this.aggregateRegionByteSize + this.snapshotRegionByteSize
            ) / 4 + claim.outputSlot
                * this.subjectCapacity * IDENTITY_WORD_COUNT;
            const exactIdentityReadback
                = requiresTowerMergeExactIdentityReadback(claim.command);
            const envelope = Object.freeze({
                command: claim.command,
                sourceTick: tick,
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: this.deviceGeneration,
                authoritativeEpoch: this.authoritativeEpoch,
                resourceLease: this.resourceLease,
                outputSlot: claim.outputSlot,
                aggregateWordOffset,
                snapshotWordOffset,
                identityWordOffset,
                exactIdentityReadback,
                exactIdentityCapacity: claim.command.subjectLimit,
                readbackByteLength: this.aggregateReadbackByteSize
                    + (exactIdentityReadback
                        ? claim.command.subjectLimit
                            * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI
                                .IDENTITY_RECORD.STRIDE
                        : 0)
            });
            claim.envelope = envelope;
            claim.readback.envelope = envelope;
            writeGpuAbilityExecutionCommand(
                this.commandBytes,
                index,
                { ...claim.command, targetFixedTick: tick },
                envelope,
                {
                    outputSlot: claim.outputSlot,
                    snapshotCapacity: this.subjectCapacity,
                    aggregateWordOffset,
                    snapshotWordOffset,
                    identityWordOffset
                }
            );
        }

        try {
            this.device.queue.writeBuffer(
                this.buffers.commands,
                0,
                this.commandBytes,
                0,
                claims.length
                    * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.COMMAND.STRIDE
            );
            const encoder = this.device.createCommandEncoder({
                label: `cirvivor-gpu-ability-subject-snapshot-${tick}`
            });
            const pass = encoder.beginComputePass({
                label: 'cirvivor-gpu-ability-subject-snapshot-pass'
            });
            pass.setPipeline(this.pipelines.pipeline);
            pass.setBindGroup(0, this.bindGroup);
            pass.dispatchWorkgroups(claims.length);
            pass.end();
            for (const claim of claims) {
                encoder.copyBufferToBuffer(
                    this.buffers.output,
                    claim.envelope.aggregateWordOffset * 4,
                    claim.readback.buffer,
                    0,
                    this.aggregateReadbackByteSize
                );
                if (claim.envelope.exactIdentityReadback) {
                    encoder.copyBufferToBuffer(
                        this.buffers.output,
                        claim.envelope.identityWordOffset * 4,
                        claim.readback.buffer,
                        this.aggregateReadbackByteSize,
                        claim.envelope.exactIdentityCapacity
                            * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI
                                .IDENTITY_RECORD.STRIDE
                    );
                }
            }
            this.device.queue.submit([encoder.finish()]);
            this.lastSubmittedTick = Math.max(this.lastSubmittedTick, tick);
            this.submittedExecutionCount += claims.length;
            for (const claim of claims) {
                this.#beginReadback(claim.readback);
            }
        } catch (error) {
            for (let index = claims.length - 1; index >= 0; index--) {
                const claim = claims[index];
                this.#releaseReadbackSlot(claim.readback);
                this.freeOutputSlots.push(claim.outputSlot);
                this.pendingCommands.unshift(claim.command);
            }
            this.failure = captureFailure('ability-subject-submit', error);
            this.state = 'failed';
            return Object.freeze({
                submittedCount: 0,
                deferredCount: eligibleRemaining + claims.length,
                failure: this.failure
            });
        }
        return Object.freeze({
            submittedCount: claims.length,
            deferredCount: eligibleRemaining
        });
    }

    drainCompleted(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('ability subject completion output은 배열이어야 합니다.');
        }
        out.push(...this.completed);
        this.completed.length = 0;
        return out;
    }

    getSnapshotGpuBinding(token) {
        const record = token && typeof token === 'object'
            ? this.snapshotRecords.get(token)
            : null;
        if (!record || record.resourceLease !== this.resourceLease
            || !this.buffers || this.destroyed) {
            return null;
        }
        return Object.freeze({
            abiVersion: GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION,
            buffer: this.buffers.output,
            byteOffset: record.snapshotWordOffset * 4,
            wordOffset: record.snapshotWordOffset,
            byteLength: record.subjectCount
                * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE,
            recordStride:
                GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE,
            subjectCount: record.subjectCount,
            executionOrdinal: record.executionOrdinal,
            commandFingerprint: record.commandFingerprint,
            snapshotFingerprint: record.snapshotFingerprint,
            sessionGeneration: record.sessionGeneration,
            deviceGeneration: record.deviceGeneration,
            authoritativeEpoch: record.authoritativeEpoch,
            sourceTick: record.sourceTick,
            outputSlot: record.outputSlot
        });
    }

    releaseSnapshot(token) {
        const record = token && typeof token === 'object'
            ? this.snapshotRecords.get(token)
            : null;
        if (!record) return false;
        this.snapshotRecords.delete(token);
        this.retainedSnapshotTokens.delete(token);
        if (record.resourceLease === this.resourceLease) {
            this.freeOutputSlots.push(record.outputSlot);
        }
        return true;
    }

    cancelAll(reason = 'cancelled') {
        const cancellationReason = String(reason || 'cancelled');
        for (const command of this.pendingCommands) {
            this.pendingExecutionIds.delete(command.executionId);
            this.completed.push(Object.freeze({
                abiVersion: GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION,
                executionId: command.executionId,
                executionOrdinal: command.executionOrdinal,
                targetFixedTick: command.targetFixedTick,
                sourceTick: 0,
                status: ABILITY_SUBJECT_SNAPSHOT_STATUS.CANCELLED,
                subjectCount: 0,
                capacityDemand: 0,
                commandFingerprint: command.fingerprint,
                snapshotFingerprint: 0,
                errorFlags: 0,
                snapshotToken: null,
                reason: cancellationReason
            }));
        }
        const cancelledCount = this.pendingCommands.length;
        this.pendingCommands.length = 0;
        return Object.freeze({ cancelledCount, reason: cancellationReason });
    }

    requiresRecovery() {
        return this.state === 'failed';
    }

    getStatus() {
        return Object.freeze({
            abiVersion: GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION,
            state: this.destroyed ? 'destroyed' : this.state,
            failure: this.failure,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: this.deviceGeneration,
            authoritativeEpoch: this.authoritativeEpoch,
            capacity: this.capacity,
            commandCapacity: this.commandCapacity,
            subjectCapacity: this.subjectCapacity,
            readbackSlotCount: this.readbackSlotCount,
            aggregateReadbackByteSize: this.aggregateReadbackByteSize,
            maximumReadbackByteSize: this.maximumReadbackByteSize,
            outputByteSize: this.outputByteSize,
            identityRegionByteSize: this.identityRegionByteSize,
            storageBindingCount:
                GPU_ABILITY_SUBJECT_SNAPSHOT_STORAGE_BINDING_COUNT,
            pendingCommandCount: this.pendingCommands.length,
            pendingReadbackCount: this.pendingReadbacks,
            retainedSnapshotCount: this.retainedSnapshotTokens.size,
            completedQueueCount: this.completed.length,
            submittedExecutionCount: this.submittedExecutionCount,
            completedExecutionCount: this.completedExecutionCount,
            zeroSubjectCount: this.zeroSubjectCount,
            capacityRejectedCount: this.capacityRejectedCount,
            protocolRejectedCount: this.protocolRejectedCount,
            ringDeferredCount: this.ringDeferredCount,
            lastSubmittedTick: this.lastSubmittedTick,
            lastCompletedTick: this.lastCompletedTick,
            requiresRecovery: this.requiresRecovery(),
            subjectReadbackPolicy:
                'aggregate-only-except-tower-merge-exact-identity'
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.cancelAll('destroyed');
        this.#retireResources('destroyed');
        this.completed.length = 0;
        this.pendingExecutionIds.clear();
        this.state = 'destroyed';
    }

    #claimReadbackSlot() {
        for (let offset = 0; offset < this.readbackSlots.length; offset++) {
            const index = (this.readbackCursor + offset)
                % this.readbackSlots.length;
            const slot = this.readbackSlots[index];
            if (!slot.inFlight) {
                slot.inFlight = true;
                slot.lease = this.resourceLease;
                slot.envelope = null;
                this.readbackCursor = (index + 1) % this.readbackSlots.length;
                this.pendingReadbacks++;
                return slot;
            }
        }
        return null;
    }

    #releaseReadbackSlot(slot) {
        if (!slot?.inFlight) return;
        slot.inFlight = false;
        slot.envelope = null;
        this.pendingReadbacks = Math.max(0, this.pendingReadbacks - 1);
    }

    #beginReadback(slot) {
        const envelope = slot.envelope;
        slot.buffer.mapAsync(
            this.mapReadMode,
            0,
            envelope.readbackByteLength
        ).then(() => {
            const authentic = !this.destroyed
                && this.state === 'ready'
                && slot.inFlight
                && slot.lease === this.resourceLease
                && envelope.resourceLease === this.resourceLease;
            if (!authentic) {
                try { slot.buffer.unmap(); } catch { /* retired */ }
                this.#releaseReadbackSlot(slot);
                return;
            }
            try {
                const copied = slot.buffer.getMappedRange(
                    0,
                    envelope.readbackByteLength
                ).slice(0);
                const aggregate = readGpuAbilitySubjectAggregate(copied);
                const command = envelope.command;
                const exactEnvelope = aggregate.sessionGeneration
                        === envelope.sessionGeneration
                    && aggregate.deviceGeneration === envelope.deviceGeneration
                    && aggregate.authoritativeEpoch
                        === envelope.authoritativeEpoch
                    && aggregate.sourceTick === envelope.sourceTick
                    && aggregate.executionOrdinal === command.executionOrdinal
                    && aggregate.subjectLimit === command.subjectLimit
                    && aggregate.commandFingerprint === command.fingerprint
                    && aggregate.outputSlot === envelope.outputSlot
                    && aggregate.generationLimit === command.generationLimit;
                if (!exactEnvelope) {
                    throw new RangeError('ability aggregate provenance가 command와 다릅니다.');
                }
                let snapshotToken = null;
                let subjectIdentities = null;
                if (aggregate.status
                    === ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE) {
                    if (aggregate.subjectCount <= 0
                        || aggregate.subjectCount !== aggregate.capacityDemand
                        || aggregate.errorFlags !== 0) {
                        throw new RangeError('complete ability aggregate count가 잘못됐습니다.');
                    }
                    if (envelope.exactIdentityReadback) {
                        subjectIdentities = readGpuAbilitySubjectIdentities(
                            copied,
                            aggregate.subjectCount,
                            {
                                byteOffset: this.aggregateReadbackByteSize,
                                bodyCapacity: this.capacity,
                                commandFingerprint: command.fingerprint,
                                snapshotFingerprint:
                                    aggregate.snapshotFingerprint
                            }
                        );
                    }
                    snapshotToken = Object.freeze({});
                    this.snapshotRecords.set(snapshotToken, Object.freeze({
                        ...aggregate,
                        executionId: command.executionId,
                        resourceLease: this.resourceLease,
                        snapshotWordOffset: envelope.snapshotWordOffset
                    }));
                    this.retainedSnapshotTokens.add(snapshotToken);
                } else {
                    this.freeOutputSlots.push(envelope.outputSlot);
                    if (envelope.exactIdentityReadback
                        && aggregate.status
                            === ABILITY_SUBJECT_SNAPSHOT_STATUS.ZERO_SUBJECT) {
                        subjectIdentities = Object.freeze([]);
                    }
                }
                if (aggregate.status
                    === ABILITY_SUBJECT_SNAPSHOT_STATUS.ZERO_SUBJECT) {
                    this.zeroSubjectCount++;
                } else if (aggregate.status
                    === ABILITY_SUBJECT_SNAPSHOT_STATUS.CAPACITY_REJECTED) {
                    this.capacityRejectedCount++;
                } else if (aggregate.status
                    === ABILITY_SUBJECT_SNAPSHOT_STATUS.PROTOCOL_REJECTED) {
                    this.protocolRejectedCount++;
                }
                this.pendingExecutionIds.delete(command.executionId);
                this.completed.push(Object.freeze({
                    ...aggregate,
                    executionId: command.executionId,
                    targetFixedTick: command.targetFixedTick,
                    compiledAbilityCode: command.compiledAbilityCode,
                    snapshotToken,
                    ...(subjectIdentities !== null
                        ? { subjectIdentities }
                        : {}),
                    reason: null
                }));
                this.completedExecutionCount++;
                this.lastCompletedTick = Math.max(
                    this.lastCompletedTick,
                    aggregate.sourceTick
                );
            } catch (error) {
                this.pendingExecutionIds.delete(envelope.command.executionId);
                this.freeOutputSlots.push(envelope.outputSlot);
                this.protocolRejectedCount++;
                this.failure = captureFailure('ability-subject-readback', error);
                this.state = 'failed';
            } finally {
                slot.buffer.unmap();
                this.#releaseReadbackSlot(slot);
            }
        }).catch((error) => {
            const authentic = slot.lease === this.resourceLease
                && envelope.resourceLease === this.resourceLease;
            if (authentic) {
                this.pendingExecutionIds.delete(envelope.command.executionId);
                this.freeOutputSlots.push(envelope.outputSlot);
                this.failure = captureFailure('ability-subject-map', error);
                this.state = 'failed';
            }
            this.#releaseReadbackSlot(slot);
        });
    }

    #retireResources(reason) {
        this.resourceLease++;
        for (const slot of this.readbackSlots) {
            const envelope = slot.envelope;
            if (slot.inFlight && envelope?.command) {
                this.pendingExecutionIds.delete(envelope.command.executionId);
                this.completed.push(Object.freeze({
                    abiVersion: GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION,
                    executionId: envelope.command.executionId,
                    executionOrdinal: envelope.command.executionOrdinal,
                    targetFixedTick: envelope.command.targetFixedTick,
                    sourceTick: envelope.sourceTick,
                    status: ABILITY_SUBJECT_SNAPSHOT_STATUS.CANCELLED,
                    subjectCount: 0,
                    capacityDemand: 0,
                    commandFingerprint: envelope.command.fingerprint,
                    snapshotFingerprint: 0,
                    errorFlags: 0,
                    snapshotToken: null,
                    reason
                }));
            }
            slot.inFlight = false;
            slot.envelope = null;
            try { slot.buffer?.unmap?.(); } catch { /* retired */ }
            try { slot.buffer?.destroy?.(); } catch { /* retired */ }
        }
        this.readbackSlots = [];
        this.pendingReadbacks = 0;
        for (const token of this.retainedSnapshotTokens) {
            this.snapshotRecords.delete(token);
        }
        this.retainedSnapshotTokens.clear();
        this.freeOutputSlots.length = 0;
        if (this.buffers) {
            for (const buffer of Object.values(this.buffers)) {
                try { buffer?.destroy?.(); } catch { /* retired */ }
            }
        }
        this.buffers = null;
        this.bindGroup = null;
        this.pipelines = null;
        this.sourceResources = null;
        this.device = null;
        this.mapReadMode = null;
        if (!this.destroyed) this.state = 'idle';
    }
}
