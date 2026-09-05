import {
    GPU_CIRCLE_BODY_META,
    GPU_CIRCLE_BODY_SIMULATION_FLAG
} from './gpu_circle_body_abi.js';

export const GPU_TRANSIENT_VFX_ABI_VERSION = 1;
export const GPU_TRANSIENT_VFX_KIND = Object.freeze({
    EXPLOSION_RING: 1,
    CORPSE_DISSOLVE: 2
});

const WORKGROUP_SIZE = 256;
const DEFAULT_CAPACITY = 2048;
const STATE_BYTE_SIZE = 16;
const RECORD_BYTE_SIZE = 48;
const PARAM_BYTE_SIZE = 32;
const DISPATCH_INDIRECT_BYTE_SIZE = 24;
const DRAW_INDIRECT_BYTE_SIZE = 16;
const COMPUTE_PIPELINES_BY_DEVICE = new WeakMap();
const RENDER_PIPELINES_BY_DEVICE = new WeakMap();

const GPU_TRANSIENT_VFX_COMPUTE_WGSL = /* wgsl */`
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

struct DeathEvent {
    entity_id: u32,
    incarnation: u32,
    body_id: u32,
    reason_flags: u32,
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

struct VfxState {
    spawn_cursor: atomic<u32>,
    high_water: atomic<u32>,
    overwrite_count: atomic<u32>,
    abi_version: atomic<u32>,
}

struct VfxRecord {
    position: vec2f,
    base_radius: f32,
    remaining: f32,
    duration: f32,
    kind: u32,
    source_tick: u32,
    reserved: u32,
    color: vec4f,
}

struct VfxParams {
    fixed_delta: f32,
    source_tick: u32,
    max_death_events: u32,
    pool_capacity: u32,
    body_capacity: u32,
    reserved_0: u32,
    reserved_1: u32,
    reserved_2: u32,
}

struct DeathEventBuffer { values: array<DeathEvent> }
struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct VfxRecordBuffer { values: array<VfxRecord> }
struct IndirectBuffer { values: array<atomic<u32>> }

@group(0) @binding(0) var<storage, read_write> contact_state: ContactState;
@group(0) @binding(1) var<storage, read> death_events: DeathEventBuffer;
@group(0) @binding(2) var<storage, read> physics: PhysicsBuffer;
@group(0) @binding(3) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(4) var<storage, read_write> state: VfxState;
@group(0) @binding(5) var<storage, read_write> records: VfxRecordBuffer;
@group(0) @binding(6) var<storage, read_write> dispatch_args: IndirectBuffer;
@group(0) @binding(7) var<storage, read_write> draw_args: IndirectBuffer;
@group(0) @binding(8) var<uniform> params: VfxParams;

const VFX_ABI_VERSION: u32 = ${GPU_TRANSIENT_VFX_ABI_VERSION}u;
const FLAG_COUNT_AS_KILL: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.COUNT_AS_KILL}u;
const FLAG_EXPLODE_ON_DEATH: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.EXPLODE_ON_DEATH}u;
const FLAG_GOLDEN: u32 = ${GPU_CIRCLE_BODY_META.GOLDEN_BIT}u;
const KIND_EXPLOSION_RING: u32 = ${GPU_TRANSIENT_VFX_KIND.EXPLOSION_RING}u;
const KIND_CORPSE_DISSOLVE: u32 = ${GPU_TRANSIENT_VFX_KIND.CORPSE_DISSOLVE}u;

@compute @workgroup_size(1)
fn update_vfx_indirect_args() {
    let death_count = min(
        atomicLoad(&contact_state.death_count),
        min(params.max_death_events, params.pool_capacity)
    );
    let high_water = min(atomicLoad(&state.high_water), params.pool_capacity);
    atomicStore(&dispatch_args.values[0], (death_count + ${WORKGROUP_SIZE - 1}u) / ${WORKGROUP_SIZE}u);
    atomicStore(&dispatch_args.values[1], 1u);
    atomicStore(&dispatch_args.values[2], 1u);
    atomicStore(&dispatch_args.values[3], (high_water + ${WORKGROUP_SIZE - 1}u) / ${WORKGROUP_SIZE}u);
    atomicStore(&dispatch_args.values[4], 1u);
    atomicStore(&dispatch_args.values[5], 1u);
    atomicStore(&draw_args.values[0], 6u);
    atomicStore(&draw_args.values[1], high_water);
    atomicStore(&draw_args.values[2], 0u);
    atomicStore(&draw_args.values[3], 0u);
    atomicStore(&state.abi_version, VFX_ABI_VERSION);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn decay_vfx(@builtin(global_invocation_id) gid: vec3u) {
    let slot = gid.x;
    if (slot >= min(atomicLoad(&state.high_water), params.pool_capacity)) {
        return;
    }
    records.values[slot].remaining = max(
        0.0,
        records.values[slot].remaining - max(params.fixed_delta, 0.0)
    );
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn spawn_death_vfx(@builtin(global_invocation_id) gid: vec3u) {
    let death_index = gid.x;
    let death_count = min(
        atomicLoad(&contact_state.death_count),
        min(params.max_death_events, params.pool_capacity)
    );
    if (death_index >= death_count) {
        return;
    }
    let event = death_events.values[death_index];
    if (event.body_id >= params.body_capacity) {
        return;
    }
    let flags = atomicLoad(&simulations.values[event.body_id].flags);
    let explodes = (flags & FLAG_EXPLODE_ON_DEATH) != 0u;
    let leaves_corpse = (flags & FLAG_COUNT_AS_KILL) != 0u;
    if (!explodes && !leaves_corpse) {
        return;
    }

    let allocation = atomicAdd(&state.spawn_cursor, 1u);
    let slot = allocation % params.pool_capacity;
    if (allocation >= params.pool_capacity) {
        atomicAdd(&state.overwrite_count, 1u);
    }
    let golden = (flags & FLAG_GOLDEN) != 0u;
    let kind = select(KIND_CORPSE_DISSOLVE, KIND_EXPLOSION_RING, explodes);
    let duration = select(0.85, 0.34, explodes);
    var color = select(
        vec4f(0.24, 0.08, 0.04, 0.74),
        vec4f(1.0, 0.31, 0.055, 0.95),
        explodes
    );
    if (golden) {
        color = vec4f(1.0, 0.78, 0.12, 0.98);
    }
    records.values[slot] = VfxRecord(
        physics.values[event.body_id].position,
        max(physics.values[event.body_id].radius, 0.05),
        duration,
        duration,
        kind,
        params.source_tick,
        0u,
        color
    );
    atomicMax(&state.high_water, slot + 1u);
    atomicMax(&draw_args.values[1], slot + 1u);
}
`;

const GPU_TRANSIENT_VFX_RENDER_WGSL = /* wgsl */`
struct VfxRecord {
    position: vec2f,
    base_radius: f32,
    remaining: f32,
    duration: f32,
    kind: u32,
    source_tick: u32,
    reserved: u32,
    color: vec4f,
}

struct VfxRecordBuffer { values: array<VfxRecord> }

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
    @location(2) @interpolate(flat) kind: u32,
    @location(3) progress: f32,
    @location(4) @interpolate(flat) source_tick: u32,
}

@group(0) @binding(0) var<storage, read> records: VfxRecordBuffer;
@group(1) @binding(0) var<uniform> params: RenderParams;

const KIND_EXPLOSION_RING: u32 = ${GPU_TRANSIENT_VFX_KIND.EXPLOSION_RING}u;
const QUAD_VERTICES = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0)
);

@vertex
fn vertex_main(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32
) -> VertexOutput {
    var output: VertexOutput;
    let record = records.values[instance_index];
    if (record.remaining <= 0.0 || record.duration <= 0.0) {
        output.position = vec4f(2.0, 2.0, 0.0, 1.0);
        output.local_position = vec2f(0.0);
        output.color = vec4f(0.0);
        output.kind = 0u;
        output.progress = 1.0;
        output.source_tick = 0u;
        return output;
    }
    let progress = clamp(1.0 - record.remaining / record.duration, 0.0, 1.0);
    let radius_scale = select(1.0 + 0.18 * progress, 1.0 + 2.8 * progress,
        record.kind == KIND_EXPLOSION_RING);
    let local = QUAD_VERTICES[vertex_index];
    let world_position = record.position
        + local * record.base_radius * radius_scale;
    let viewport_position = params.viewport_origin + world_position * params.world_scale;
    let clip_position = vec2f(
        (viewport_position.x / params.viewport_size.x) * 2.0 - 1.0,
        1.0 - (viewport_position.y / params.viewport_size.y) * 2.0
    );
    output.position = vec4f(clip_position, 0.0, 1.0);
    output.local_position = local;
    output.color = record.color;
    output.kind = record.kind;
    output.progress = progress;
    output.source_tick = record.source_tick;
    return output;
}

fn hash_cell(value: vec2f, seed: f32) -> f32 {
    return fract(sin(dot(value, vec2f(12.9898, 78.233)) + seed) * 43758.5453);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let distance = length(input.local_position);
    var coverage = 0.0;
    if (input.kind == KIND_EXPLOSION_RING) {
        let ring_center = mix(0.28, 0.82, input.progress);
        let ring_width = mix(0.28, 0.07, input.progress);
        coverage = 1.0 - smoothstep(
            ring_width * 0.55,
            ring_width,
            abs(distance - ring_center)
        );
        coverage *= 1.0 - smoothstep(0.92, 1.0, distance);
    } else {
        let edge = 1.0 - smoothstep(0.76, 1.0, distance);
        let cell = floor((input.local_position + vec2f(1.0)) * 9.0);
        let noise = hash_cell(cell, f32(input.source_tick & 1023u));
        coverage = edge * step(input.progress * 1.1 - 0.08, noise);
    }
    let alpha = input.color.a * coverage * (1.0 - input.progress);
    return vec4f(input.color.rgb * alpha, alpha);
}
`;

function requirePositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number > 0xffffffff) {
        throw new RangeError(`${label}는 uint32 범위의 양의 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
        throw new RangeError(`${label}는 uint32 범위의 정수여야 합니다.`);
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
    if (!usage || !stage
        || !Number.isSafeInteger(usage.STORAGE)
        || !Number.isSafeInteger(usage.COPY_DST)
        || !Number.isSafeInteger(usage.UNIFORM)
        || !Number.isSafeInteger(usage.INDIRECT)
        || !Number.isSafeInteger(stage.COMPUTE)
        || !Number.isSafeInteger(stage.VERTEX)) {
        throw new Error('transient VFX에 필요한 WebGPU 상수가 없습니다.');
    }
    return { usage, stage };
}

function createBuffer(device, label, size, usage) {
    return device.createBuffer({ label, size: Math.max(4, size), usage });
}

function getComputePipelines(device, stage) {
    let cached = COMPUTE_PIPELINES_BY_DEVICE.get(device);
    if (cached) {
        return cached;
    }
    const entries = [
        { binding: 0, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 6, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 7, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 8, visibility: stage.COMPUTE, buffer: { type: 'uniform' } }
    ];
    const indirectLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-transient-vfx-indirect-layout',
        entries
    });
    const layout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-transient-vfx-compute-layout',
        entries: entries.filter((entry) => entry.binding !== 6)
    });
    const indirectPipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-transient-vfx-indirect-pipeline-layout',
        bindGroupLayouts: [indirectLayout]
    });
    const pipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-transient-vfx-compute-pipeline-layout',
        bindGroupLayouts: [layout]
    });
    const module = device.createShaderModule({
        label: 'cirvivor-gpu-transient-vfx-compute-shader',
        code: GPU_TRANSIENT_VFX_COMPUTE_WGSL
    });
    const create = (entryPoint, selectedLayout = pipelineLayout) => device.createComputePipeline({
        label: `cirvivor-gpu-transient-vfx-${entryPoint}`,
        layout: selectedLayout,
        compute: { module, entryPoint }
    });
    cached = Object.freeze({
        layout,
        indirectLayout,
        updateIndirect: create('update_vfx_indirect_args', indirectPipelineLayout),
        decay: create('decay_vfx'),
        spawn: create('spawn_death_vfx')
    });
    COMPUTE_PIPELINES_BY_DEVICE.set(device, cached);
    return cached;
}

function getRenderPipeline(device, stage, format) {
    let byFormat = RENDER_PIPELINES_BY_DEVICE.get(device);
    if (!byFormat) {
        byFormat = new Map();
        RENDER_PIPELINES_BY_DEVICE.set(device, byFormat);
    }
    if (byFormat.has(format)) {
        return byFormat.get(format);
    }
    const recordLayout = device.createBindGroupLayout({
        label: `cirvivor-gpu-transient-vfx-record-layout-${format}`,
        entries: [{
            binding: 0,
            visibility: stage.VERTEX,
            buffer: { type: 'read-only-storage' }
        }]
    });
    const paramsLayout = device.createBindGroupLayout({
        label: `cirvivor-gpu-transient-vfx-render-params-layout-${format}`,
        entries: [{
            binding: 0,
            visibility: stage.VERTEX,
            buffer: { type: 'uniform' }
        }]
    });
    const pipelineLayout = device.createPipelineLayout({
        label: `cirvivor-gpu-transient-vfx-render-pipeline-layout-${format}`,
        bindGroupLayouts: [recordLayout, paramsLayout]
    });
    const module = device.createShaderModule({
        label: 'cirvivor-gpu-transient-vfx-render-shader',
        code: GPU_TRANSIENT_VFX_RENDER_WGSL
    });
    const cached = Object.freeze({
        recordLayout,
        paramsLayout,
        pipeline: device.createRenderPipeline({
            label: 'cirvivor-gpu-transient-vfx-render',
            layout: pipelineLayout,
            vertex: { module, entryPoint: 'vertex_main' },
            fragment: {
                module,
                entryPoint: 'fragment_main',
                targets: [{
                    format,
                    blend: {
                        color: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add'
                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add'
                        }
                    }
                }]
            },
            primitive: { topology: 'triangle-list' }
        })
    });
    byFormat.set(format, cached);
    return cached;
}

export class GpuTransientVfxRuntime {
    constructor(options = {}) {
        this.capacity = requirePositiveInteger(
            options.capacity ?? DEFAULT_CAPACITY,
            'transientVfx.capacity'
        );
        this.paramsBytes = new ArrayBuffer(PARAM_BYTE_SIZE);
        this.device = null;
        this.buffers = null;
        this.computePipelines = null;
        this.renderPipeline = null;
        this.computeBindGroup = null;
        this.indirectBindGroup = null;
        this.renderBindGroups = null;
        this.bodyCapacity = 0;
        this.deathEventCapacity = 0;
        this.lastEncodedSourceTick = 0;
        this.state = 'idle';
        this.failure = null;
    }

    initialize(device, format, resources) {
        if (!device || typeof device.createBuffer !== 'function' || !format) {
            throw new TypeError('transient VFX에는 GPUDevice와 canvas format이 필요합니다.');
        }
        for (const key of [
            'contactState',
            'deathEvents',
            'physics',
            'simulation',
            'renderParams'
        ]) {
            if (!resources?.[key]) {
                throw new TypeError(`transient VFX ${key} buffer가 없습니다.`);
            }
        }
        const bodyCapacity = requirePositiveInteger(
            resources.bodyCapacity,
            'transientVfx.bodyCapacity'
        );
        const deathEventCapacity = requirePositiveInteger(
            resources.deathEventCapacity,
            'transientVfx.deathEventCapacity'
        );
        const { usage, stage } = requireGpuGlobals();
        const recordBytes = this.capacity * RECORD_BYTE_SIZE;
        if (recordBytes > Number(device.limits?.maxBufferSize ?? Infinity)
            || recordBytes > Number(device.limits?.maxStorageBufferBindingSize ?? Infinity)
            || Number(device.limits?.maxStorageBuffersPerShaderStage ?? Infinity) < 8) {
            throw new RangeError('transient VFX buffer/storage limit가 부족합니다.');
        }
        this.retire();
        this.device = device;
        this.bodyCapacity = bodyCapacity;
        this.deathEventCapacity = deathEventCapacity;
        this.computePipelines = getComputePipelines(device, stage);
        this.renderPipeline = getRenderPipeline(device, stage, format);
        this.buffers = {
            state: createBuffer(
                device,
                'cirvivor-gpu-transient-vfx-state',
                STATE_BYTE_SIZE,
                usage.STORAGE | usage.COPY_DST
            ),
            records: createBuffer(
                device,
                'cirvivor-gpu-transient-vfx-records',
                recordBytes,
                usage.STORAGE | usage.COPY_DST
            ),
            params: createBuffer(
                device,
                'cirvivor-gpu-transient-vfx-params',
                PARAM_BYTE_SIZE,
                usage.UNIFORM | usage.COPY_DST
            ),
            dispatchIndirect: createBuffer(
                device,
                'cirvivor-gpu-transient-vfx-dispatch-indirect',
                DISPATCH_INDIRECT_BYTE_SIZE,
                usage.STORAGE | usage.INDIRECT | usage.COPY_DST
            ),
            drawIndirect: createBuffer(
                device,
                'cirvivor-gpu-transient-vfx-draw-indirect',
                DRAW_INDIRECT_BYTE_SIZE,
                usage.STORAGE | usage.INDIRECT | usage.COPY_DST
            )
        };
        device.queue.writeBuffer(
            this.buffers.state,
            0,
            new Uint32Array([0, 0, 0, GPU_TRANSIENT_VFX_ABI_VERSION])
        );
        device.queue.writeBuffer(
            this.buffers.dispatchIndirect,
            0,
            new Uint32Array([0, 1, 1, 0, 1, 1])
        );
        device.queue.writeBuffer(
            this.buffers.drawIndirect,
            0,
            new Uint32Array([6, 0, 0, 0])
        );
        const resource = (buffer) => ({ buffer });
        const entries = [
            { binding: 0, resource: resource(resources.contactState) },
            { binding: 1, resource: resource(resources.deathEvents) },
            { binding: 2, resource: resource(resources.physics) },
            { binding: 3, resource: resource(resources.simulation) },
            { binding: 4, resource: resource(this.buffers.state) },
            { binding: 5, resource: resource(this.buffers.records) },
            { binding: 6, resource: resource(this.buffers.dispatchIndirect) },
            { binding: 7, resource: resource(this.buffers.drawIndirect) },
            { binding: 8, resource: resource(this.buffers.params) }
        ];
        this.indirectBindGroup = device.createBindGroup({
            label: 'cirvivor-gpu-transient-vfx-indirect-bind-group',
            layout: this.computePipelines.indirectLayout,
            entries
        });
        this.computeBindGroup = device.createBindGroup({
            label: 'cirvivor-gpu-transient-vfx-compute-bind-group',
            layout: this.computePipelines.layout,
            entries: entries.filter((entry) => entry.binding !== 6)
        });
        this.renderBindGroups = [
            device.createBindGroup({
                label: 'cirvivor-gpu-transient-vfx-render-records',
                layout: this.renderPipeline.recordLayout,
                entries: [{ binding: 0, resource: resource(this.buffers.records) }]
            }),
            device.createBindGroup({
                label: 'cirvivor-gpu-transient-vfx-render-params',
                layout: this.renderPipeline.paramsLayout,
                entries: [{ binding: 0, resource: resource(resources.renderParams) }]
            })
        ];
        this.lastEncodedSourceTick = 0;
        this.state = 'ready';
        this.failure = null;
        return true;
    }

    encodeFixedStep(encoder, fixedDelta, sourceTick) {
        if (this.state !== 'ready' || !this.device || !this.buffers) {
            return false;
        }
        const delta = Number(fixedDelta);
        if (!Number.isFinite(delta) || delta <= 0) {
            throw new RangeError('transient VFX fixedDelta는 양수여야 합니다.');
        }
        const tick = requireNonNegativeInteger(sourceTick, 'transientVfx.sourceTick');
        const view = new DataView(this.paramsBytes);
        view.setFloat32(0, delta, true);
        view.setUint32(4, tick, true);
        view.setUint32(8, this.deathEventCapacity, true);
        view.setUint32(12, this.capacity, true);
        view.setUint32(16, this.bodyCapacity, true);
        view.setUint32(20, 0, true);
        view.setUint32(24, 0, true);
        view.setUint32(28, 0, true);
        this.device.queue.writeBuffer(this.buffers.params, 0, this.paramsBytes);
        // 사용하지 않는 WGSL binding도 explicit layout에 있으면 usage에
        // 포함됩니다. 소비 pass에서는 dispatch args의 STORAGE binding 자체를
        // 제거해야 INDIRECT와 writable storage가 충돌하지 않습니다.
        const indirectPass = encoder.beginComputePass({
            label: 'cirvivor-gpu-transient-vfx-indirect-pass'
        });
        indirectPass.setBindGroup(0, this.indirectBindGroup);
        indirectPass.setPipeline(this.computePipelines.updateIndirect);
        indirectPass.dispatchWorkgroups(1);
        indirectPass.end();

        const simulationPass = encoder.beginComputePass({
            label: 'cirvivor-gpu-transient-vfx-simulation-pass'
        });
        simulationPass.setBindGroup(0, this.computeBindGroup);
        simulationPass.setPipeline(this.computePipelines.decay);
        simulationPass.dispatchWorkgroupsIndirect(
            this.buffers.dispatchIndirect,
            12
        );
        simulationPass.setPipeline(this.computePipelines.spawn);
        simulationPass.dispatchWorkgroupsIndirect(
            this.buffers.dispatchIndirect,
            0
        );
        simulationPass.end();
        this.lastEncodedSourceTick = tick;
        return true;
    }

    encodeRender(pass) {
        if (this.state !== 'ready' || !this.buffers) {
            return false;
        }
        pass.setPipeline(this.renderPipeline.pipeline);
        pass.setBindGroup(0, this.renderBindGroups[0]);
        pass.setBindGroup(1, this.renderBindGroups[1]);
        pass.drawIndirect(this.buffers.drawIndirect, 0);
        return true;
    }

    getStatus() {
        return Object.freeze({
            state: this.state,
            failure: this.failure,
            abiVersion: GPU_TRANSIENT_VFX_ABI_VERSION,
            capacity: this.capacity,
            recordStride: RECORD_BYTE_SIZE,
            lastEncodedSourceTick: this.lastEncodedSourceTick,
            allocationPolicy: 'stable-ring-overwrite',
            drawPolicy: 'single-indirect-draw',
            gameplayAuthority: false,
            cpuReadback: false
        });
    }

    disable(error) {
        this.retire();
        this.state = 'disabled';
        this.failure = captureFailure('transient-vfx-disabled', error);
    }

    retire() {
        if (this.buffers) {
            for (const buffer of Object.values(this.buffers)) {
                try { buffer?.destroy?.(); } catch { /* retired */ }
            }
        }
        this.buffers = null;
        this.computePipelines = null;
        this.renderPipeline = null;
        this.computeBindGroup = null;
        this.indirectBindGroup = null;
        this.renderBindGroups = null;
        this.device = null;
        this.bodyCapacity = 0;
        this.deathEventCapacity = 0;
        this.state = 'idle';
    }
}

export {
    GPU_TRANSIENT_VFX_COMPUTE_WGSL,
    GPU_TRANSIENT_VFX_RENDER_WGSL
};
