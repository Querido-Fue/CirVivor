import {
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_GAMEPLAY_META,
    GPU_CIRCLE_BODY_META
} from './gpu_circle_body_abi.js';
import { GAMEPLAY_TEAM_ID } from '../../contract/gameplay_team_contract.js';

export const GPU_CROWD_DENSITY_ABI_VERSION = 1;
export const GPU_CROWD_DENSITY_GRID = Object.freeze({ columns: 16, rows: 16 });

const WORKGROUP_SIZE = 256;
const HEADER_WORD_COUNT = 4;
const DEFAULT_SAMPLE_INTERVAL_TICKS = 8;
const DEFAULT_READBACK_SLOT_COUNT = 3;
const PARAM_BYTE_SIZE = 32;
const LITTLE_ENDIAN = true;
const PIPELINES_BY_DEVICE = new WeakMap();

const GPU_CROWD_DENSITY_WGSL = /* wgsl */`
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

struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct DensityBuffer { values: array<atomic<u32>> }

struct DensityParams {
    source_tick: u32,
    columns: u32,
    rows: u32,
    reserved: u32,
    world_size: vec2f,
    padding: vec2f,
}

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(3) var<uniform> params: DensityParams;
@group(0) @binding(4) var<storage, read_write> density: DensityBuffer;

const BODY_ABI_VERSION: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;
const DENSITY_ABI_VERSION: u32 = ${GPU_CROWD_DENSITY_ABI_VERSION}u;
const HEADER_WORD_COUNT: u32 = ${HEADER_WORD_COUNT}u;
const ALIVE_FLAG: u32 = ${GPU_CIRCLE_BODY_META.ALIVE_BIT}u;
const ENEMY_LAYER: u32 = ${GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY}u;
const BODY_LAYER_MASK: u32 = ${GPU_CIRCLE_BODY_META.FIELD_MASK}u;
const TEAM_MASK: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_MASK}u;
const TEAM_SHIFT: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_SHIFT}u;
const HOSTILE_TEAM: u32 = ${GAMEPLAY_TEAM_ID.HOSTILE}u;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn clear_density(@builtin(global_invocation_id) gid: vec3u) {
    let index = gid.x;
    let word_count = HEADER_WORD_COUNT + params.columns * params.rows;
    if (index >= word_count) {
        return;
    }
    if (index == 0u) {
        atomicStore(&density.values[index], DENSITY_ABI_VERSION);
    } else if (index == 1u) {
        atomicStore(&density.values[index], params.source_tick);
    } else {
        atomicStore(&density.values[index], 0u);
    }
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn accumulate_density(@builtin(global_invocation_id) gid: vec3u) {
    let body_id = gid.x;
    if (counts.abi_version != BODY_ABI_VERSION || body_id >= counts.body_count) {
        return;
    }
    let simulation_flags = atomicLoad(&simulations.values[body_id].flags);
    let body_layer = physics.values[body_id].physical_meta & BODY_LAYER_MASK;
    let team_id = (simulations.values[body_id].gameplay_meta >> TEAM_SHIFT) & TEAM_MASK;
    if ((simulation_flags & ALIVE_FLAG) == 0u
        || body_layer != ENEMY_LAYER
        || team_id != HOSTILE_TEAM) {
        return;
    }

    let position = physics.values[body_id].position;
    if (!all(position >= vec2f(0.0))
        || !all(position < params.world_size)
        || !all(params.world_size > vec2f(0.0))) {
        atomicAdd(&density.values[3], 1u);
        return;
    }
    let normalized = position / params.world_size;
    let cell = min(
        vec2u(normalized * vec2f(f32(params.columns), f32(params.rows))),
        vec2u(params.columns - 1u, params.rows - 1u)
    );
    let cell_index = cell.y * params.columns + cell.x;
    atomicAdd(&density.values[2], 1u);
    atomicAdd(&density.values[HEADER_WORD_COUNT + cell_index], 1u);
}
`;

function requirePositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}는 양의 정수여야 합니다.`);
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

function normalizeWorldSize(value) {
    const x = Number(value?.x);
    const y = Number(value?.y);
    if (!Number.isFinite(x) || x <= 0 || !Number.isFinite(y) || y <= 0) {
        throw new RangeError('crowd density worldSize는 양의 finite vec2여야 합니다.');
    }
    return Object.freeze({ x, y });
}

function captureFailure(stage, error) {
    return Object.freeze({
        stage,
        name: String(error?.name ?? 'Error'),
        message: String(error?.message ?? error)
    });
}

function freezeLevel(columns, rows, cells) {
    return Object.freeze({
        columns,
        rows,
        cells: Object.freeze(Array.from(cells, (value) => Number(value)))
    });
}

export function buildCrowdDensityMipChain(cells, columns, rows) {
    const width = requirePositiveInteger(columns, 'columns');
    const height = requirePositiveInteger(rows, 'rows');
    if (!cells || cells.length !== width * height) {
        throw new RangeError('density cell 수가 grid 크기와 다릅니다.');
    }
    const levels = [];
    let currentWidth = width;
    let currentHeight = height;
    let current = Uint32Array.from(cells, (value) => (
        requireNonNegativeInteger(value, 'density cell')
    ));
    levels.push(freezeLevel(currentWidth, currentHeight, current));
    while (currentWidth > 1 || currentHeight > 1) {
        const nextWidth = Math.ceil(currentWidth / 2);
        const nextHeight = Math.ceil(currentHeight / 2);
        const next = new Uint32Array(nextWidth * nextHeight);
        for (let y = 0; y < currentHeight; y++) {
            for (let x = 0; x < currentWidth; x++) {
                next[Math.floor(y / 2) * nextWidth + Math.floor(x / 2)]
                    += current[y * currentWidth + x];
            }
        }
        current = next;
        currentWidth = nextWidth;
        currentHeight = nextHeight;
        levels.push(freezeLevel(currentWidth, currentHeight, current));
    }
    return Object.freeze(levels);
}

export function sampleCrowdDensity(snapshot, worldPosition, mipLevel = 0) {
    if (!snapshot?.valid) {
        return 0;
    }
    const x = Number(worldPosition?.x);
    const y = Number(worldPosition?.y);
    const levelIndex = Math.min(
        requireNonNegativeInteger(mipLevel, 'mipLevel'),
        snapshot.mipLevels.length - 1
    );
    if (!Number.isFinite(x) || !Number.isFinite(y)
        || x < 0 || y < 0
        || x >= snapshot.worldSize.x || y >= snapshot.worldSize.y) {
        return 0;
    }
    const level = snapshot.mipLevels[levelIndex];
    const column = Math.min(
        level.columns - 1,
        Math.floor((x / snapshot.worldSize.x) * level.columns)
    );
    const row = Math.min(
        level.rows - 1,
        Math.floor((y / snapshot.worldSize.y) * level.rows)
    );
    return level.cells[row * level.columns + column];
}

function createInvalidSnapshot(worldSize, reason = 'not-sampled') {
    return Object.freeze({
        valid: false,
        reason,
        abiVersion: GPU_CROWD_DENSITY_ABI_VERSION,
        sourceTick: 0,
        submittedTick: 0,
        deviceGeneration: -1,
        authoritativeEpoch: 0,
        columns: GPU_CROWD_DENSITY_GRID.columns,
        rows: GPU_CROWD_DENSITY_GRID.rows,
        worldSize,
        totalCount: 0,
        outOfBoundsCount: 0,
        cells: Object.freeze([]),
        mipLevels: Object.freeze([])
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
        || !Number.isSafeInteger(usage.UNIFORM)
        || !Number.isSafeInteger(usage.MAP_READ)
        || !Number.isSafeInteger(stage.COMPUTE)
        || !Number.isSafeInteger(mapMode.READ)) {
        throw new Error('crowd density에 필요한 WebGPU 상수가 없습니다.');
    }
    return { usage, stage, mapMode };
}

function createBuffer(device, label, size, usage) {
    return device.createBuffer({ label, size: Math.max(4, size), usage });
}

function getPipelines(device, stage) {
    let cached = PIPELINES_BY_DEVICE.get(device);
    if (cached) {
        return cached;
    }
    const layout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-crowd-density-layout',
        entries: [
            { binding: 0, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 1, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 3, visibility: stage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 4, visibility: stage.COMPUTE, buffer: { type: 'storage' } }
        ]
    });
    const pipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-crowd-density-pipeline-layout',
        bindGroupLayouts: [layout]
    });
    const module = device.createShaderModule({
        label: 'cirvivor-gpu-crowd-density-shader',
        code: GPU_CROWD_DENSITY_WGSL
    });
    cached = Object.freeze({
        layout,
        clear: device.createComputePipeline({
            label: 'cirvivor-gpu-crowd-density-clear',
            layout: pipelineLayout,
            compute: { module, entryPoint: 'clear_density' }
        }),
        accumulate: device.createComputePipeline({
            label: 'cirvivor-gpu-crowd-density-accumulate',
            layout: pipelineLayout,
            compute: { module, entryPoint: 'accumulate_density' }
        })
    });
    PIPELINES_BY_DEVICE.set(device, cached);
    return cached;
}

export class GpuCrowdDensityRuntime {
    constructor(options = {}) {
        this.worldSize = normalizeWorldSize(options.worldSize);
        this.columns = requirePositiveInteger(
            options.columns ?? GPU_CROWD_DENSITY_GRID.columns,
            'columns'
        );
        this.rows = requirePositiveInteger(
            options.rows ?? GPU_CROWD_DENSITY_GRID.rows,
            'rows'
        );
        this.sampleIntervalTicks = requirePositiveInteger(
            options.sampleIntervalTicks ?? DEFAULT_SAMPLE_INTERVAL_TICKS,
            'sampleIntervalTicks'
        );
        this.readbackSlotCount = requirePositiveInteger(
            options.readbackSlotCount ?? DEFAULT_READBACK_SLOT_COUNT,
            'readbackSlotCount'
        );
        this.outputByteSize = (HEADER_WORD_COUNT + this.columns * this.rows)
            * Uint32Array.BYTES_PER_ELEMENT;
        this.paramsBytes = new ArrayBuffer(PARAM_BYTE_SIZE);
        this.device = null;
        this.deviceGeneration = -1;
        this.authoritativeEpoch = 0;
        this.buffers = null;
        this.bindGroup = null;
        this.pipelines = null;
        this.mapReadMode = null;
        this.readbackSlots = [];
        this.readbackCursor = 0;
        this.resourceLease = 0;
        this.pendingReadbacks = 0;
        this.lastSubmittedTick = 0;
        this.lastCompletedTick = 0;
        this.droppedSampleCount = 0;
        this.readbackFailureCount = 0;
        this.state = 'idle';
        this.failure = null;
        this.latestSnapshot = createInvalidSnapshot(this.worldSize);
    }

    initialize(device, resources, protocol = {}) {
        if (!device || typeof device.createBuffer !== 'function') {
            throw new TypeError('crowd density에는 GPUDevice가 필요합니다.');
        }
        for (const key of ['counts', 'physics', 'simulation']) {
            if (!resources?.[key]) {
                throw new TypeError(`crowd density ${key} buffer가 없습니다.`);
            }
        }
        const { usage, stage, mapMode } = requireGpuGlobals();
        const largestBuffer = Math.max(this.outputByteSize, PARAM_BYTE_SIZE);
        if (largestBuffer > Number(device.limits?.maxBufferSize ?? Infinity)
            || this.outputByteSize
                > Number(device.limits?.maxStorageBufferBindingSize ?? Infinity)
            || Number(device.limits?.maxStorageBuffersPerShaderStage ?? Infinity) < 4) {
            throw new RangeError('crowd density buffer/storage limit가 부족합니다.');
        }
        this.retire('reinitialize');
        this.device = device;
        this.deviceGeneration = requireNonNegativeInteger(
            protocol.deviceGeneration ?? 0,
            'deviceGeneration'
        );
        this.authoritativeEpoch = requireNonNegativeInteger(
            protocol.authoritativeEpoch ?? 0,
            'authoritativeEpoch'
        );
        this.mapReadMode = mapMode.READ;
        this.pipelines = getPipelines(device, stage);
        this.buffers = {
            output: createBuffer(
                device,
                'cirvivor-gpu-crowd-density-output',
                this.outputByteSize,
                usage.STORAGE | usage.COPY_SRC | usage.COPY_DST
            ),
            params: createBuffer(
                device,
                'cirvivor-gpu-crowd-density-params',
                PARAM_BYTE_SIZE,
                usage.UNIFORM | usage.COPY_DST
            )
        };
        this.bindGroup = device.createBindGroup({
            label: 'cirvivor-gpu-crowd-density-bind-group',
            layout: this.pipelines.layout,
            entries: [
                { binding: 0, resource: { buffer: resources.counts } },
                { binding: 1, resource: { buffer: resources.physics } },
                { binding: 2, resource: { buffer: resources.simulation } },
                { binding: 3, resource: { buffer: this.buffers.params } },
                { binding: 4, resource: { buffer: this.buffers.output } }
            ]
        });
        const lease = ++this.resourceLease;
        this.readbackSlots = Array.from(
            { length: this.readbackSlotCount },
            (_, index) => ({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-crowd-density-readback-${index}`,
                    this.outputByteSize,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                lease,
                envelope: null
            })
        );
        this.readbackCursor = 0;
        this.pendingReadbacks = 0;
        this.lastSubmittedTick = 0;
        this.lastCompletedTick = 0;
        this.state = 'ready';
        this.failure = null;
        this.latestSnapshot = createInvalidSnapshot(this.worldSize, 'awaiting-sample');
        return true;
    }

    claimSample(envelope) {
        if (this.state !== 'ready' || !this.device || !this.buffers) {
            return null;
        }
        const sourceTick = requireNonNegativeInteger(envelope?.sourceTick, 'sourceTick');
        const submittedTick = requireNonNegativeInteger(
            envelope?.submittedTick,
            'submittedTick'
        );
        if (submittedTick !== 1
            && submittedTick - this.lastSubmittedTick < this.sampleIntervalTicks) {
            return null;
        }
        let slot = null;
        for (let offset = 0; offset < this.readbackSlots.length; offset++) {
            const index = (this.readbackCursor + offset) % this.readbackSlots.length;
            if (!this.readbackSlots[index].inFlight) {
                slot = this.readbackSlots[index];
                this.readbackCursor = (index + 1) % this.readbackSlots.length;
                break;
            }
        }
        if (!slot) {
            this.droppedSampleCount++;
            return null;
        }
        const normalized = Object.freeze({
            sourceTick,
            submittedTick,
            deviceGeneration: requireNonNegativeInteger(
                envelope?.deviceGeneration,
                'deviceGeneration'
            ),
            authoritativeEpoch: requireNonNegativeInteger(
                envelope?.authoritativeEpoch,
                'authoritativeEpoch'
            ),
            resourceLease: this.resourceLease
        });
        const view = new DataView(this.paramsBytes);
        view.setUint32(0, sourceTick, LITTLE_ENDIAN);
        view.setUint32(4, this.columns, LITTLE_ENDIAN);
        view.setUint32(8, this.rows, LITTLE_ENDIAN);
        view.setUint32(12, 0, LITTLE_ENDIAN);
        view.setFloat32(16, this.worldSize.x, LITTLE_ENDIAN);
        view.setFloat32(20, this.worldSize.y, LITTLE_ENDIAN);
        view.setFloat32(24, 0, LITTLE_ENDIAN);
        view.setFloat32(28, 0, LITTLE_ENDIAN);
        this.device.queue.writeBuffer(this.buffers.params, 0, this.paramsBytes);
        slot.inFlight = true;
        slot.lease = this.resourceLease;
        slot.envelope = normalized;
        this.pendingReadbacks++;
        this.lastSubmittedTick = submittedTick;
        return slot;
    }

    encodeSample(encoder, slot, dispatchIndirectBuffer) {
        if (!slot?.inFlight || slot.lease !== this.resourceLease
            || !encoder || !dispatchIndirectBuffer) {
            throw new Error('crowd density sample encode 상태가 유효하지 않습니다.');
        }
        const pass = encoder.beginComputePass({
            label: 'cirvivor-gpu-crowd-density-pass'
        });
        pass.setBindGroup(0, this.bindGroup);
        pass.setPipeline(this.pipelines.clear);
        pass.dispatchWorkgroups(Math.ceil(
            (HEADER_WORD_COUNT + this.columns * this.rows) / WORKGROUP_SIZE
        ));
        pass.setPipeline(this.pipelines.accumulate);
        pass.dispatchWorkgroupsIndirect(dispatchIndirectBuffer, 0);
        pass.end();
        encoder.copyBufferToBuffer(
            this.buffers.output,
            0,
            slot.buffer,
            0,
            this.outputByteSize
        );
    }

    cancelSample(slot) {
        this.#releaseSlot(slot);
    }

    beginReadback(slot) {
        const envelope = slot?.envelope;
        if (!slot?.inFlight || !envelope) {
            return;
        }
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            const authentic = this.state === 'ready'
                && slot.inFlight
                && slot.lease === this.resourceLease
                && envelope.resourceLease === this.resourceLease
                && envelope.deviceGeneration === this.deviceGeneration
                && envelope.authoritativeEpoch === this.authoritativeEpoch;
            if (!authentic) {
                try { slot.buffer.unmap(); } catch { /* retired */ }
                this.#releaseSlot(slot);
                return;
            }
            try {
                const view = new DataView(slot.buffer.getMappedRange());
                const abiVersion = view.getUint32(0, LITTLE_ENDIAN);
                const sourceTick = view.getUint32(4, LITTLE_ENDIAN);
                const totalCount = view.getUint32(8, LITTLE_ENDIAN);
                const outOfBoundsCount = view.getUint32(12, LITTLE_ENDIAN);
                if (abiVersion !== GPU_CROWD_DENSITY_ABI_VERSION
                    || sourceTick !== envelope.sourceTick) {
                    throw new RangeError('crowd density readback provenance가 다릅니다.');
                }
                const cells = new Uint32Array(this.columns * this.rows);
                let sum = 0;
                for (let index = 0; index < cells.length; index++) {
                    cells[index] = view.getUint32(
                        (HEADER_WORD_COUNT + index) * Uint32Array.BYTES_PER_ELEMENT,
                        LITTLE_ENDIAN
                    );
                    sum += cells[index];
                }
                if (!Number.isSafeInteger(sum) || sum !== totalCount) {
                    throw new RangeError('crowd density cell 합계가 header와 다릅니다.');
                }
                const mipLevels = buildCrowdDensityMipChain(
                    cells,
                    this.columns,
                    this.rows
                );
                if (envelope.submittedTick >= this.lastCompletedTick) {
                    this.latestSnapshot = Object.freeze({
                        valid: true,
                        reason: null,
                        abiVersion,
                        sourceTick,
                        submittedTick: envelope.submittedTick,
                        deviceGeneration: envelope.deviceGeneration,
                        authoritativeEpoch: envelope.authoritativeEpoch,
                        columns: this.columns,
                        rows: this.rows,
                        worldSize: this.worldSize,
                        totalCount,
                        outOfBoundsCount,
                        cells: mipLevels[0].cells,
                        mipLevels
                    });
                    this.lastCompletedTick = envelope.submittedTick;
                }
            } catch (error) {
                this.readbackFailureCount++;
                this.failure = captureFailure('crowd-density-readback', error);
            } finally {
                slot.buffer.unmap();
                this.#releaseSlot(slot);
            }
        }).catch((error) => {
            const authentic = slot.lease === this.resourceLease
                && envelope.resourceLease === this.resourceLease;
            if (authentic) {
                this.readbackFailureCount++;
                this.failure = captureFailure('crowd-density-map', error);
            }
            this.#releaseSlot(slot);
        });
    }

    getLatestSnapshot() {
        return this.latestSnapshot;
    }

    getStatus() {
        return Object.freeze({
            state: this.state,
            failure: this.failure,
            abiVersion: GPU_CROWD_DENSITY_ABI_VERSION,
            columns: this.columns,
            rows: this.rows,
            outputByteSize: this.outputByteSize,
            sampleIntervalTicks: this.sampleIntervalTicks,
            readbackSlotCount: this.readbackSlotCount,
            pendingReadbacks: this.pendingReadbacks,
            droppedSampleCount: this.droppedSampleCount,
            readbackFailureCount: this.readbackFailureCount,
            lastSubmittedTick: this.lastSubmittedTick,
            lastCompletedTick: this.lastCompletedTick,
            gameplayAuthority: false,
            backpressurePolicy: 'drop-sample'
        });
    }

    disable(error) {
        this.retire('disabled');
        this.state = 'disabled';
        this.failure = captureFailure('crowd-density-disabled', error);
    }

    retire(reason = 'resource-retired') {
        this.resourceLease++;
        for (const slot of this.readbackSlots) {
            slot.inFlight = false;
            slot.envelope = null;
            try { slot.buffer?.unmap?.(); } catch { /* not mapped */ }
            try { slot.buffer?.destroy?.(); } catch { /* retired */ }
        }
        this.readbackSlots = [];
        this.pendingReadbacks = 0;
        if (this.buffers) {
            for (const buffer of Object.values(this.buffers)) {
                try { buffer?.destroy?.(); } catch { /* retired */ }
            }
        }
        this.buffers = null;
        this.bindGroup = null;
        this.pipelines = null;
        this.device = null;
        this.deviceGeneration = -1;
        this.authoritativeEpoch = 0;
        this.mapReadMode = null;
        this.state = 'idle';
        this.latestSnapshot = createInvalidSnapshot(this.worldSize, reason);
    }

    #releaseSlot(slot) {
        if (!slot?.inFlight) {
            return;
        }
        slot.inFlight = false;
        slot.envelope = null;
        this.pendingReadbacks = Math.max(0, this.pendingReadbacks - 1);
    }
}

export { GPU_CROWD_DENSITY_WGSL };
