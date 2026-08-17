import {
    GPU_TOWER_TARGET_QUERY_ABI,
    GPU_TOWER_TARGET_QUERY_STORAGE_PROFILE
} from './gpu_tower_target_query_abi.js';
import {
    GPU_TOWER_TARGET_QUERY_WGSL,
    GPU_TOWER_TARGET_QUERY_WORKGROUP_SIZE
} from './gpu_tower_target_query_shaders.js';

const PIPELINES_BY_DEVICE = new WeakMap();

function requirePositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number > 0xffffffff) {
        throw new RangeError(`${label}는 양의 uint32 정수여야 합니다.`);
    }
    return number;
}

function normalizeProtocol(source = {}) {
    return Object.freeze({
        sessionGeneration: requirePositiveInteger(
            source.sessionGeneration,
            'Tower target query sessionGeneration'
        ),
        deviceGeneration: Number(source.deviceGeneration) >>> 0,
        authoritativeEpoch: Number(source.authoritativeEpoch) >>> 0
    });
}

function sameProtocol(left, right) {
    return left?.sessionGeneration === right?.sessionGeneration
        && left?.deviceGeneration === right?.deviceGeneration
        && left?.authoritativeEpoch === right?.authoritativeEpoch;
}

function requireGpuGlobals() {
    const usage = globalThis.GPUBufferUsage;
    const stage = globalThis.GPUShaderStage;
    if (!usage || !stage
        || !Number.isSafeInteger(usage.STORAGE)
        || !Number.isSafeInteger(usage.COPY_SRC)
        || !Number.isSafeInteger(usage.COPY_DST)
        || !Number.isSafeInteger(stage.COMPUTE)) {
        throw new Error('Tower target query runtime에 필요한 WebGPU 상수가 없습니다.');
    }
    return { usage, stage };
}

function resource(buffer) {
    return { buffer };
}

function destroyBuffer(buffer) {
    try { buffer?.destroy?.(); } catch { /* retired */ }
}

function getPipelines(device, stage) {
    let cached = PIPELINES_BY_DEVICE.get(device);
    if (cached) return cached;
    const storage = (binding, type = 'read-only-storage') => ({
        binding,
        visibility: stage.COMPUTE,
        buffer: { type }
    });
    const queryLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-tower-target-query-layout',
        entries: Array.from({ length: 9 }, (_, binding) => storage(
            binding,
            binding === 6 || binding === 7 ? 'storage' : 'read-only-storage'
        ))
    });
    const rewriteLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-tower-target-spawn-rewrite-layout',
        entries: [
            storage(0),
            storage(1),
            storage(2),
            storage(3, 'storage')
        ]
    });
    const emptyLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-tower-target-query-empty-layout',
        entries: []
    });
    const module = device.createShaderModule({
        label: 'cirvivor-gpu-tower-target-query-shader',
        code: GPU_TOWER_TARGET_QUERY_WGSL
    });
    const queryPipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-tower-target-query-pipeline-layout',
        bindGroupLayouts: [queryLayout, emptyLayout]
    });
    const rewritePipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-tower-target-spawn-rewrite-pipeline-layout',
        bindGroupLayouts: [emptyLayout, rewriteLayout]
    });
    cached = Object.freeze({
        queryLayout,
        rewriteLayout,
        emptyLayout,
        reset: device.createComputePipeline({
            label: 'cirvivor-gpu-tower-target-query-reset',
            layout: queryPipelineLayout,
            compute: { module, entryPoint: 'reset_query_stats' }
        }),
        query: device.createComputePipeline({
            label: 'cirvivor-gpu-tower-target-query-select',
            layout: queryPipelineLayout,
            compute: { module, entryPoint: 'query_tower_targets' }
        }),
        rewrite: device.createComputePipeline({
            label: 'cirvivor-gpu-tower-target-query-rewrite-spawns',
            layout: rewritePipelineLayout,
            compute: { module, entryPoint: 'rewrite_tower_target_spawns' }
        })
    });
    PIPELINES_BY_DEVICE.set(device, cached);
    return cached;
}

export class GpuTowerTargetQueryRuntime {
    constructor(options = {}) {
        this.capacity = requirePositiveInteger(
            options.capacity,
            'Tower target query capacity'
        );
        this.device = null;
        this.protocol = null;
        this.resources = null;
        this.buffers = null;
        this.pipelines = null;
        this.bindGroups = null;
        this.state = 'idle';
        this.failure = null;
        this.lastEncodedTick = 0;
        this.dispatchCount = 0;
        this.spawnRewriteDispatchCount = 0;
    }

    initialize(device, resources, protocolSource = {}) {
        if (!device || typeof device.createBuffer !== 'function') {
            throw new TypeError('Tower target query runtime에는 GPUDevice가 필요합니다.');
        }
        for (const key of [
            'counts',
            'physics',
            'simulation',
            'enemyBehaviorStates',
            'members',
            'roster',
            'results',
            'compatibilityTarget',
            'spawnProgram'
        ]) {
            if (!resources?.[key]) {
                throw new TypeError(`Tower target query runtime ${key} buffer가 없습니다.`);
            }
        }
        const protocol = normalizeProtocol(protocolSource);
        const sameResources = this.resources
            && Object.keys(resources).every(
                (key) => this.resources[key] === resources[key]
            );
        if (this.state === 'ready'
            && this.device === device
            && sameProtocol(this.protocol, protocol)
            && sameResources) {
            return true;
        }
        const { usage, stage } = requireGpuGlobals();
        const resultBytes = this.capacity
            * GPU_TOWER_TARGET_QUERY_ABI.RESULT.STRIDE;
        if (Number(device.limits?.maxStorageBuffersPerShaderStage ?? Infinity)
                < GPU_TOWER_TARGET_QUERY_STORAGE_PROFILE.maximumStorageBuffersPerStage
            || resultBytes
                > Number(device.limits?.maxStorageBufferBindingSize ?? Infinity)
            || resultBytes > Number(device.limits?.maxBufferSize ?? Infinity)) {
            throw new RangeError('Tower target query runtime buffer/storage limit가 부족합니다.');
        }
        this.retire('reinitialize');
        this.device = device;
        this.protocol = protocol;
        this.resources = Object.freeze({ ...resources });
        this.pipelines = getPipelines(device, stage);
        this.buffers = Object.freeze({
            stats: device.createBuffer({
                label: 'cirvivor-gpu-tower-target-query-stats',
                size: GPU_TOWER_TARGET_QUERY_ABI.STATS.STRIDE,
                usage: usage.STORAGE | usage.COPY_SRC | usage.COPY_DST
            })
        });
        const empty = device.createBindGroup({
            label: 'cirvivor-gpu-tower-target-query-empty',
            layout: this.pipelines.emptyLayout,
            entries: []
        });
        this.bindGroups = Object.freeze({
            query: device.createBindGroup({
                label: 'cirvivor-gpu-tower-target-query-bind-group',
                layout: this.pipelines.queryLayout,
                entries: [
                    { binding: 0, resource: resource(resources.counts) },
                    { binding: 1, resource: resource(resources.physics) },
                    { binding: 2, resource: resource(resources.simulation) },
                    { binding: 3, resource: resource(resources.enemyBehaviorStates) },
                    { binding: 4, resource: resource(resources.members) },
                    { binding: 5, resource: resource(resources.roster) },
                    { binding: 6, resource: resource(resources.results) },
                    { binding: 7, resource: resource(this.buffers.stats) },
                    { binding: 8, resource: resource(resources.compatibilityTarget) }
                ]
            }),
            rewrite: device.createBindGroup({
                label: 'cirvivor-gpu-tower-target-spawn-rewrite-bind-group',
                layout: this.pipelines.rewriteLayout,
                entries: [
                    { binding: 0, resource: resource(resources.counts) },
                    { binding: 1, resource: resource(resources.simulation) },
                    { binding: 2, resource: resource(resources.results) },
                    { binding: 3, resource: resource(resources.spawnProgram) }
                ]
            }),
            empty
        });
        this.state = 'ready';
        this.failure = null;
        this.lastEncodedTick = 0;
        return true;
    }

    encode(pass, sourceTick) {
        const tick = requirePositiveInteger(sourceTick, 'Tower target query sourceTick');
        if (this.state !== 'ready'
            || !pass
            || typeof pass.setPipeline !== 'function'
            || tick <= this.lastEncodedTick) {
            throw new Error('Tower target query encode 순서가 유효하지 않습니다.');
        }
        pass.setBindGroup(0, this.bindGroups.query);
        pass.setBindGroup(1, this.bindGroups.empty);
        pass.setPipeline(this.pipelines.reset);
        pass.dispatchWorkgroups(1);
        pass.setPipeline(this.pipelines.query);
        pass.dispatchWorkgroups(Math.ceil(
            this.capacity / GPU_TOWER_TARGET_QUERY_WORKGROUP_SIZE
        ));
        pass.setBindGroup(0, this.bindGroups.empty);
        pass.setBindGroup(1, this.bindGroups.rewrite);
        pass.setPipeline(this.pipelines.rewrite);
        pass.dispatchWorkgroups(Math.ceil(
            this.capacity / GPU_TOWER_TARGET_QUERY_WORKGROUP_SIZE
        ));
        this.lastEncodedTick = tick;
        this.dispatchCount++;
        this.spawnRewriteDispatchCount++;
        return true;
    }

    getStatus() {
        return Object.freeze({
            state: this.state,
            ...this.protocol,
            capacity: this.capacity,
            resultStride: GPU_TOWER_TARGET_QUERY_ABI.RESULT.STRIDE,
            resultByteSize: this.capacity
                * GPU_TOWER_TARGET_QUERY_ABI.RESULT.STRIDE,
            lastEncodedTick: this.lastEncodedTick,
            dispatchCount: this.dispatchCount,
            spawnRewriteDispatchCount: this.spawnRewriteDispatchCount,
            storageBuffersPerStage:
                GPU_TOWER_TARGET_QUERY_STORAGE_PROFILE.maximumStorageBuffersPerStage,
            noCpuRosterOrPoseReadback: true,
            failure: this.failure
        });
    }

    requiresRecovery() {
        return this.state === 'failed';
    }

    retire(reason = 'retired') {
        destroyBuffer(this.buffers?.stats);
        this.device = null;
        this.protocol = null;
        this.resources = null;
        this.buffers = null;
        this.pipelines = null;
        this.bindGroups = null;
        if (this.state !== 'idle') this.state = reason;
    }

    destroy() {
        this.retire('destroyed');
    }
}
