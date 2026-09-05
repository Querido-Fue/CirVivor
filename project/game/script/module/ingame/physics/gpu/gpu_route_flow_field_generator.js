const LITTLE_ENDIAN = true;
const WORKGROUP_SIZE = 8;
const PARAMS_BYTE_SIZE = 32;
const COST_INFINITY = 0xffffffff;
const UINT32_MAXIMUM = 0xffffffff;
const PIPELINES_BY_DEVICE = new WeakMap();

export const GPU_ROUTE_FLOW_FIELD_GENERATOR_VERSION = 2;
export const GPU_ROUTE_FLOW_FIELD_GENERATOR_STORAGE_BUFFER_MAXIMUM = 3;

export const GPU_ROUTE_FLOW_FIELD_GENERATOR_WGSL = /* wgsl */`
struct GeneratorParams {
    cols: u32,
    rows: u32,
    source_layer_count: u32,
    stage_layer_count: u32,
    cell_count: u32,
    row_offset: u32,
    row_count: u32,
    reserved_2: u32,
}

@group(0) @binding(0) var<uniform> params: GeneratorParams;
@group(0) @binding(1) var<storage, read> blocked_layers: array<u32>;
@group(0) @binding(2) var<storage, read> goal_cell_indices: array<u32>;
@group(0) @binding(3) var<storage, read> stage_layer_indices: array<u32>;
@group(0) @binding(4) var<storage, read> cost_read: array<u32>;
@group(0) @binding(5) var<storage, read_write> cost_write: array<u32>;
@group(0) @binding(6) var flow_output:
    texture_storage_2d_array<rgba32float, write>;
@group(0) @binding(7) var integration_output:
    texture_storage_2d_array<r32float, write>;

const COST_INFINITY: u32 = 0xffffffffu;
const CARDINAL_COST: u32 = 1000u;
const DIAGONAL_COST: u32 = 1414u;
const UNREACHABLE_FLOAT: f32 = 1e20;
const NEIGHBOR_OFFSETS = array<vec2i, 8>(
    vec2i(0, -1),
    vec2i(-1, 0),
    vec2i(1, 0),
    vec2i(0, 1),
    vec2i(-1, -1),
    vec2i(1, -1),
    vec2i(-1, 1),
    vec2i(1, 1)
);

fn cell_inside(cell: vec2i) -> bool {
    return cell.x >= 0 && cell.y >= 0
        && cell.x < i32(params.cols) && cell.y < i32(params.rows);
}

fn layer_cell_index(layer: u32, cell: vec2i) -> u32 {
    return layer * params.cell_count
        + u32(cell.y) * params.cols + u32(cell.x);
}

fn cell_is_walkable(layer: u32, cell: vec2i) -> bool {
    return cell_inside(cell)
        && blocked_layers[layer_cell_index(layer, cell)] == 0u;
}

fn diagonal_is_open(layer: u32, cell: vec2i, offset: vec2i) -> bool {
    if (offset.x == 0 || offset.y == 0) {
        return true;
    }
    return cell_is_walkable(layer, cell + vec2i(offset.x, 0))
        && cell_is_walkable(layer, cell + vec2i(0, offset.y));
}

@compute @workgroup_size(8, 8, 1)
fn seed_flow_cost(@builtin(global_invocation_id) id: vec3u) {
    let output_row = id.y + params.row_offset;
    if (id.x >= params.cols || id.y >= params.row_count
        || output_row >= params.rows
        || id.z >= params.source_layer_count) {
        return;
    }
    let cell_index = output_row * params.cols + id.x;
    let index = id.z * params.cell_count + cell_index;
    if (blocked_layers[index] != 0u) {
        cost_write[index] = COST_INFINITY;
        return;
    }
    cost_write[index] = select(
        COST_INFINITY,
        0u,
        goal_cell_indices[id.z] == cell_index
    );
}

@compute @workgroup_size(8, 8, 1)
fn relax_flow_cost(@builtin(global_invocation_id) id: vec3u) {
    let output_row = id.y + params.row_offset;
    if (id.x >= params.cols || id.y >= params.row_count
        || output_row >= params.rows
        || id.z >= params.source_layer_count) {
        return;
    }
    let cell = vec2i(i32(id.x), i32(output_row));
    let index = layer_cell_index(id.z, cell);
    if (blocked_layers[index] != 0u) {
        cost_write[index] = COST_INFINITY;
        return;
    }
    var best = cost_read[index];
    for (var neighbor_index = 0u; neighbor_index < 8u; neighbor_index += 1u) {
        let offset = NEIGHBOR_OFFSETS[neighbor_index];
        let neighbor = cell + offset;
        if (!cell_is_walkable(id.z, neighbor)
            || !diagonal_is_open(id.z, cell, offset)) {
            continue;
        }
        let neighbor_cost = cost_read[layer_cell_index(id.z, neighbor)];
        if (neighbor_cost == COST_INFINITY) {
            continue;
        }
        let step_cost = select(CARDINAL_COST, DIAGONAL_COST,
            offset.x != 0 && offset.y != 0);
        if (neighbor_cost > COST_INFINITY - step_cost) {
            continue;
        }
        best = min(best, neighbor_cost + step_cost);
    }
    cost_write[index] = best;
}

@compute @workgroup_size(8, 8, 1)
fn finalize_flow_field(@builtin(global_invocation_id) id: vec3u) {
    let output_row = id.y + params.row_offset;
    if (id.x >= params.cols || id.y >= params.row_count
        || output_row >= params.rows
        || id.z >= params.stage_layer_count) {
        return;
    }
    let source_layer = stage_layer_indices[id.z];
    let output_cell = vec2i(i32(id.x), i32(output_row));
    if (source_layer >= params.source_layer_count) {
        textureStore(flow_output, output_cell, i32(id.z),
            vec4f(0.0, 0.0, UNREACHABLE_FLOAT, 0.0));
        textureStore(integration_output, output_cell, i32(id.z),
            vec4f(UNREACHABLE_FLOAT, 0.0, 0.0, 0.0));
        return;
    }
    let index = layer_cell_index(source_layer, output_cell);
    let current_cost = cost_read[index];
    if (blocked_layers[index] != 0u || current_cost == COST_INFINITY) {
        textureStore(flow_output, output_cell, i32(id.z),
            vec4f(0.0, 0.0, UNREACHABLE_FLOAT, 0.0));
        textureStore(integration_output, output_cell, i32(id.z),
            vec4f(UNREACHABLE_FLOAT, 0.0, 0.0, 0.0));
        return;
    }
    var best_candidate_cost = COST_INFINITY;
    var best_offset = vec2i(0);
    for (var neighbor_index = 0u; neighbor_index < 8u; neighbor_index += 1u) {
        let offset = NEIGHBOR_OFFSETS[neighbor_index];
        let neighbor = output_cell + offset;
        if (!cell_is_walkable(source_layer, neighbor)
            || !diagonal_is_open(source_layer, output_cell, offset)) {
            continue;
        }
        let neighbor_cost = cost_read[layer_cell_index(source_layer, neighbor)];
        if (neighbor_cost == COST_INFINITY) {
            continue;
        }
        let step_cost = select(CARDINAL_COST, DIAGONAL_COST,
            offset.x != 0 && offset.y != 0);
        if (neighbor_cost > COST_INFINITY - step_cost) {
            continue;
        }
        let candidate_cost = neighbor_cost + step_cost;
        if (candidate_cost < best_candidate_cost) {
            best_candidate_cost = candidate_cost;
            best_offset = offset;
        }
    }
    var direction = vec2f(0.0);
    if (best_candidate_cost <= current_cost
        && (best_offset.x != 0 || best_offset.y != 0)) {
        direction = normalize(vec2f(best_offset));
    }
    let integration = f32(current_cost) / f32(CARDINAL_COST);
    textureStore(flow_output, output_cell, i32(id.z),
        vec4f(direction, integration, 1.0));
    textureStore(integration_output, output_cell, i32(id.z),
        vec4f(integration, 0.0, 0.0, 0.0));
}
`;

function requireGeneration(atlas) {
    const generation = atlas?.gpuGeneration;
    const cols = Number(atlas?.cols);
    const rows = Number(atlas?.rows);
    const fieldCount = Number(atlas?.fieldCount);
    const cellCount = cols * rows;
    if (!Number.isSafeInteger(cols) || cols <= 0 || cols > UINT32_MAXIMUM
        || !Number.isSafeInteger(rows) || rows <= 0 || rows > UINT32_MAXIMUM
        || !Number.isSafeInteger(fieldCount)
        || fieldCount <= 0
        || fieldCount > UINT32_MAXIMUM
        || !Number.isSafeInteger(cellCount)
        || cellCount <= 0
        || cellCount > UINT32_MAXIMUM
        || !generation
        || generation.version !== 2
        || !Number.isSafeInteger(generation.sourceLayerCount)
        || generation.sourceLayerCount <= 0
        || !(generation.blockedLayers instanceof Uint32Array)
        || !(generation.goalCellIndices instanceof Uint32Array)
        || !(generation.stageLayerIndices instanceof Uint32Array)
        || generation.blockedLayers.length
            !== generation.sourceLayerCount * atlas.cols * atlas.rows
        || generation.goalCellIndices.length !== generation.sourceLayerCount
        || generation.stageLayerIndices.length !== atlas.fieldCount
        || !Number.isSafeInteger(generation.relaxationPassCount)
        || generation.relaxationPassCount <= 0
        || generation.relaxationPassCount > cellCount) {
        throw new TypeError('GPU route flow generation recipe가 유효하지 않습니다.');
    }
    for (let index = 0; index < generation.blockedLayers.length; index++) {
        if (generation.blockedLayers[index] !== 0
            && generation.blockedLayers[index] !== 1) {
            throw new RangeError(
                `GPU route flow blocked plane은 0/1이어야 합니다: index=${index}`
            );
        }
    }
    for (let layerIndex = 0;
        layerIndex < generation.sourceLayerCount;
        layerIndex++) {
        const goalCellIndex = generation.goalCellIndices[layerIndex];
        const goalStorageIndex = (layerIndex * cellCount) + goalCellIndex;
        if (goalCellIndex >= cellCount
            || generation.blockedLayers[goalStorageIndex] !== 0) {
            throw new RangeError(
                `GPU route flow goal은 범위 안의 walkable cell이어야 합니다: layer=${layerIndex}`
            );
        }
    }
    for (let stageIndex = 0;
        stageIndex < generation.stageLayerIndices.length;
        stageIndex++) {
        if (generation.stageLayerIndices[stageIndex]
            >= generation.sourceLayerCount) {
            throw new RangeError(
                `GPU route flow stage source가 범위를 벗어났습니다: stage=${stageIndex}`
            );
        }
    }
    return generation;
}

function requireGpuCapabilities(device, generation, atlas) {
    const textureUsage = globalThis.GPUTextureUsage;
    if (!textureUsage
        || !Number.isSafeInteger(textureUsage.STORAGE_BINDING)
        || textureUsage.STORAGE_BINDING <= 0) {
        throw new Error(
            'GPUTextureUsage.STORAGE_BINDING이 없어 route flow를 생성할 수 없습니다.'
        );
    }
    const cellCount = atlas.cols * atlas.rows;
    const costByteSize = generation.sourceLayerCount
        * cellCount * Uint32Array.BYTES_PER_ELEMENT;
    const maxStorageBufferBindingSize = Number(
        device?.limits?.maxStorageBufferBindingSize ?? Number.POSITIVE_INFINITY
    );
    const maxBufferSize = Number(
        device?.limits?.maxBufferSize ?? Number.POSITIVE_INFINITY
    );
    if (costByteSize > maxStorageBufferBindingSize
        || costByteSize > maxBufferSize) {
        throw new RangeError(
            'GPU route flow cost buffer가 device storage 한도를 초과합니다.'
        );
    }
    const maxTextureDimension2D = Number(
        device?.limits?.maxTextureDimension2D ?? Number.POSITIVE_INFINITY
    );
    const maxTextureArrayLayers = Number(
        device?.limits?.maxTextureArrayLayers ?? Number.POSITIVE_INFINITY
    );
    if (atlas.cols > maxTextureDimension2D
        || atlas.rows > maxTextureDimension2D
        || atlas.fieldCount > maxTextureArrayLayers) {
        throw new RangeError(
            'GPU route flow texture가 device dimension 한도를 초과합니다.'
        );
    }
    const maxComputeWorkgroupsPerDimension = Number(
        device?.limits?.maxComputeWorkgroupsPerDimension
            ?? Number.POSITIVE_INFINITY
    );
    if (Math.ceil(atlas.cols / WORKGROUP_SIZE)
            > maxComputeWorkgroupsPerDimension
        || Math.ceil(atlas.rows / WORKGROUP_SIZE)
            > maxComputeWorkgroupsPerDimension
        || generation.sourceLayerCount > maxComputeWorkgroupsPerDimension
        || atlas.fieldCount > maxComputeWorkgroupsPerDimension) {
        throw new RangeError(
            'GPU route flow dispatch가 device workgroup 한도를 초과합니다.'
        );
    }
    return costByteSize;
}

function getGeneratorPipelines(device) {
    const cached = PIPELINES_BY_DEVICE.get(device);
    if (cached) {
        return cached;
    }
    const module = device.createShaderModule({
        label: 'cirvivor-route-flow-generator-shader',
        code: GPU_ROUTE_FLOW_FIELD_GENERATOR_WGSL
    });
    const pipelines = Object.freeze({
        seed: device.createComputePipeline({
            label: 'cirvivor-route-flow-generator-seed',
            layout: 'auto',
            compute: { module, entryPoint: 'seed_flow_cost' }
        }),
        relax: device.createComputePipeline({
            label: 'cirvivor-route-flow-generator-relax',
            layout: 'auto',
            compute: { module, entryPoint: 'relax_flow_cost' }
        }),
        finalize: device.createComputePipeline({
            label: 'cirvivor-route-flow-generator-finalize',
            layout: 'auto',
            compute: { module, entryPoint: 'finalize_flow_field' }
        })
    });
    PIPELINES_BY_DEVICE.set(device, pipelines);
    return pipelines;
}

function createStorageBuffer(device, usage, label, source) {
    const buffer = device.createBuffer({
        label,
        size: Math.max(Uint32Array.BYTES_PER_ELEMENT, source.byteLength),
        usage: usage.STORAGE | usage.COPY_DST
    });
    try {
        device.queue.writeBuffer(buffer, 0, source);
    } catch (error) {
        try { buffer.destroy?.(); } catch { /* retired device */ }
        throw error;
    }
    return buffer;
}

/** GPU seed→bounded relax→finalize를 한 번 encode하고 immutable runtime texture를 채웁니다. */
export function generateGpuRouteFlowFieldTextures(
    device,
    atlas,
    flowTexture,
    integrationTexture
) {
    const generation = requireGeneration(atlas);
    const usage = globalThis.GPUBufferUsage;
    if (!usage) {
        throw new Error('GPUBufferUsage가 없어 route flow를 생성할 수 없습니다.');
    }
    if (!device
        || typeof device !== 'object'
        || typeof device.createBuffer !== 'function'
        || typeof device.createBindGroup !== 'function'
        || typeof device.createCommandEncoder !== 'function'
        || typeof device.queue?.writeBuffer !== 'function'
        || typeof device.queue?.submit !== 'function'
        || typeof flowTexture?.createView !== 'function'
        || typeof integrationTexture?.createView !== 'function') {
        throw new TypeError('GPU route flow generator device/texture 계약이 유효하지 않습니다.');
    }
    const costByteSize = requireGpuCapabilities(device, generation, atlas);
    const pipelines = getGeneratorPipelines(device);
    const paramsBytes = new ArrayBuffer(PARAMS_BYTE_SIZE);
    const paramsView = new DataView(paramsBytes);
    paramsView.setUint32(0, atlas.cols, LITTLE_ENDIAN);
    paramsView.setUint32(4, atlas.rows, LITTLE_ENDIAN);
    paramsView.setUint32(8, generation.sourceLayerCount, LITTLE_ENDIAN);
    paramsView.setUint32(12, atlas.fieldCount, LITTLE_ENDIAN);
    paramsView.setUint32(16, atlas.cols * atlas.rows, LITTLE_ENDIAN);
    paramsView.setUint32(20, 0, LITTLE_ENDIAN);
    paramsView.setUint32(24, atlas.rows, LITTLE_ENDIAN);
    const buffers = [];
    let buffersDestroyed = false;
    const destroyBuffers = () => {
        if (buffersDestroyed) {
            return;
        }
        buffersDestroyed = true;
        for (const buffer of buffers) {
            try { buffer.destroy?.(); } catch { /* retired device */ }
        }
    };
    try {
        const params = device.createBuffer({
            label: 'cirvivor-route-flow-generator-params',
            size: PARAMS_BYTE_SIZE,
            usage: usage.UNIFORM | usage.COPY_DST
        });
        buffers.push(params);
        device.queue.writeBuffer(params, 0, paramsBytes);
        const blocked = createStorageBuffer(
            device,
            usage,
            'cirvivor-route-flow-generator-blocked',
            generation.blockedLayers
        );
        buffers.push(blocked);
        const goals = createStorageBuffer(
            device,
            usage,
            'cirvivor-route-flow-generator-goals',
            generation.goalCellIndices
        );
        buffers.push(goals);
        const stageLayers = createStorageBuffer(
            device,
            usage,
            'cirvivor-route-flow-generator-stage-layers',
            generation.stageLayerIndices
        );
        buffers.push(stageLayers);
        const costsA = device.createBuffer({
            label: 'cirvivor-route-flow-generator-cost-a',
            size: costByteSize,
            usage: usage.STORAGE
        });
        buffers.push(costsA);
        const costsB = device.createBuffer({
            label: 'cirvivor-route-flow-generator-cost-b',
            size: costByteSize,
            usage: usage.STORAGE
        });
        buffers.push(costsB);
        const resource = (buffer) => ({ buffer });
        const seedBindGroup = device.createBindGroup({
            label: 'cirvivor-route-flow-generator-seed-bind-group',
            layout: pipelines.seed.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: resource(params) },
                { binding: 1, resource: resource(blocked) },
                { binding: 2, resource: resource(goals) },
                { binding: 5, resource: resource(costsA) }
            ]
        });
        const makeRelaxBindGroup = (label, read, write) => (
            device.createBindGroup({
                label,
                layout: pipelines.relax.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: resource(params) },
                    { binding: 1, resource: resource(blocked) },
                    { binding: 4, resource: resource(read) },
                    { binding: 5, resource: resource(write) }
                ]
            })
        );
        const relaxAB = makeRelaxBindGroup(
            'cirvivor-route-flow-generator-relax-a-b',
            costsA,
            costsB
        );
        const relaxBA = makeRelaxBindGroup(
            'cirvivor-route-flow-generator-relax-b-a',
            costsB,
            costsA
        );
        const finalCosts = generation.relaxationPassCount % 2 === 0
            ? costsA
            : costsB;
        const finalizeBindGroup = device.createBindGroup({
            label: 'cirvivor-route-flow-generator-finalize-bind-group',
            layout: pipelines.finalize.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: resource(params) },
                { binding: 1, resource: resource(blocked) },
                { binding: 3, resource: resource(stageLayers) },
                { binding: 4, resource: resource(finalCosts) },
                {
                    binding: 6,
                    resource: flowTexture.createView({ dimension: '2d-array' })
                },
                {
                    binding: 7,
                    resource: integrationTexture.createView({
                        dimension: '2d-array'
                    })
                }
            ]
        });
        const encoder = device.createCommandEncoder({
            label: 'cirvivor-route-flow-generator-encoder'
        });
        const pass = encoder.beginComputePass({
            label: 'cirvivor-route-flow-generator-pass'
        });
        const workgroupsX = Math.ceil(atlas.cols / WORKGROUP_SIZE);
        const workgroupsY = Math.ceil(atlas.rows / WORKGROUP_SIZE);
        pass.setPipeline(pipelines.seed);
        pass.setBindGroup(0, seedBindGroup);
        pass.dispatchWorkgroups(
            workgroupsX,
            workgroupsY,
            generation.sourceLayerCount
        );
        for (let passIndex = 0;
            passIndex < generation.relaxationPassCount;
            passIndex++) {
            pass.setPipeline(pipelines.relax);
            pass.setBindGroup(0, passIndex % 2 === 0 ? relaxAB : relaxBA);
            pass.dispatchWorkgroups(
                workgroupsX,
                workgroupsY,
                generation.sourceLayerCount
            );
        }
        pass.setPipeline(pipelines.finalize);
        pass.setBindGroup(0, finalizeBindGroup);
        pass.dispatchWorkgroups(workgroupsX, workgroupsY, atlas.fieldCount);
        pass.end();
        device.queue.submit([encoder.finish()]);
        let retirementPromise = null;
        if (typeof device.queue.onSubmittedWorkDone === 'function') {
            try {
                retirementPromise = Promise.resolve(
                    device.queue.onSubmittedWorkDone()
                ).then(destroyBuffers, destroyBuffers);
            } catch {
                retirementPromise = null;
            }
        }
        return Object.freeze({
            backend: 'gpu-seed-relax-finalize',
            sourceLayerCount: generation.sourceLayerCount,
            stageLayerCount: atlas.fieldCount,
            relaxationPassCount: generation.relaxationPassCount,
            storageBufferMaximum:
                GPU_ROUTE_FLOW_FIELD_GENERATOR_STORAGE_BUFFER_MAXIMUM,
            buffers: Object.freeze(buffers),
            retirementPromise,
            destroy() {
                destroyBuffers();
            }
        });
    } catch (error) {
        destroyBuffers();
        throw error;
    }
}

export const GPU_ROUTE_FLOW_FIELD_MINIMUM_REBUILD_RATE_PER_SECOND = 0.30;
const INCREMENTAL_BASE_DISPATCHES_PER_PUMP = 12;

/**
 * 활성 texture와 분리된 staging texture에서 rebuild를 조금씩 수행합니다.
 * `pump()`의 30%/초 credit은 어떤 CPU에서도 누적되고, 직전 frame의 CPU
 * headroom만 추가 credit으로 바뀝니다. 완성된 두 texture는 한 queue submission에서
 * 통째로 복사된 뒤에만 caller의 publication callback을 실행합니다.
 */
export function createGpuRouteFlowFieldRebuildJob(
    device,
    atlas,
    flowTexture,
    integrationTexture,
    options = {}
) {
    const generation = requireGeneration(atlas);
    const usage = globalThis.GPUBufferUsage;
    const textureUsage = globalThis.GPUTextureUsage;
    if (!usage || !textureUsage
        || !Number.isSafeInteger(textureUsage.STORAGE_BINDING)
        || !Number.isSafeInteger(textureUsage.COPY_SRC)) {
        throw new Error('incremental route flow rebuild GPU usage가 없습니다.');
    }
    const availabilityVersion = Number(options.availabilityVersion);
    if (!Number.isSafeInteger(availabilityVersion)
        || availabilityVersion <= 0
        || availabilityVersion >= UINT32_MAXIMUM) {
        throw new RangeError('rebuild availabilityVersion이 유효하지 않습니다.');
    }
    const onCommitted = options.onCommitted;
    if (onCommitted !== undefined && typeof onCommitted !== 'function') {
        throw new TypeError('rebuild onCommitted는 함수여야 합니다.');
    }
    const costByteSize = requireGpuCapabilities(device, generation, atlas);
    const pipelines = getGeneratorPipelines(device);
    const resources = [];
    let params;
    let stagingFlowTexture;
    let stagingIntegrationTexture;
    let seedBindGroup;
    let relaxAB;
    let relaxBA;
    let finalizeBindGroup;
    try {
        params = device.createBuffer({
            label: 'cirvivor-route-flow-rebuild-params',
            size: PARAMS_BYTE_SIZE,
            usage: usage.UNIFORM | usage.COPY_DST
        });
        resources.push(params);
        const blocked = createStorageBuffer(
            device,
            usage,
            'cirvivor-route-flow-rebuild-blocked',
            generation.blockedLayers
        );
        resources.push(blocked);
        const goals = createStorageBuffer(
            device,
            usage,
            'cirvivor-route-flow-rebuild-goals',
            generation.goalCellIndices
        );
        resources.push(goals);
        const stageLayers = createStorageBuffer(
            device,
            usage,
            'cirvivor-route-flow-rebuild-stage-layers',
            generation.stageLayerIndices
        );
        resources.push(stageLayers);
        const costsA = device.createBuffer({
            label: 'cirvivor-route-flow-rebuild-cost-a',
            size: costByteSize,
            usage: usage.STORAGE
        });
        resources.push(costsA);
        const costsB = device.createBuffer({
            label: 'cirvivor-route-flow-rebuild-cost-b',
            size: costByteSize,
            usage: usage.STORAGE
        });
        resources.push(costsB);
        stagingFlowTexture = device.createTexture({
            label: 'cirvivor-route-flow-rebuild-staging-flow',
            size: {
                width: atlas.cols,
                height: atlas.rows,
                depthOrArrayLayers: atlas.fieldCount
            },
            format: 'rgba32float',
            usage: textureUsage.STORAGE_BINDING | textureUsage.COPY_SRC
        });
        resources.push(stagingFlowTexture);
        stagingIntegrationTexture = device.createTexture({
            label: 'cirvivor-route-flow-rebuild-staging-integration',
            size: {
                width: atlas.cols,
                height: atlas.rows,
                depthOrArrayLayers: atlas.fieldCount
            },
            format: 'r32float',
            usage: textureUsage.STORAGE_BINDING | textureUsage.COPY_SRC
        });
        resources.push(stagingIntegrationTexture);
        const resource = (buffer) => ({ buffer });
        seedBindGroup = device.createBindGroup({
            label: 'cirvivor-route-flow-rebuild-seed-bind-group',
            layout: pipelines.seed.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: resource(params) },
                { binding: 1, resource: resource(blocked) },
                { binding: 2, resource: resource(goals) },
                { binding: 5, resource: resource(costsA) }
            ]
        });
        const makeRelaxBindGroup = (label, read, write) => device.createBindGroup({
            label,
            layout: pipelines.relax.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: resource(params) },
                { binding: 1, resource: resource(blocked) },
                { binding: 4, resource: resource(read) },
                { binding: 5, resource: resource(write) }
            ]
        });
        relaxAB = makeRelaxBindGroup(
            'cirvivor-route-flow-rebuild-relax-a-b',
            costsA,
            costsB
        );
        relaxBA = makeRelaxBindGroup(
            'cirvivor-route-flow-rebuild-relax-b-a',
            costsB,
            costsA
        );
        const finalCosts = generation.relaxationPassCount % 2 === 0
            ? costsA
            : costsB;
        finalizeBindGroup = device.createBindGroup({
            label: 'cirvivor-route-flow-rebuild-finalize-bind-group',
            layout: pipelines.finalize.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: resource(params) },
                { binding: 1, resource: resource(blocked) },
                { binding: 3, resource: resource(stageLayers) },
                { binding: 4, resource: resource(finalCosts) },
                {
                    binding: 6,
                    resource: stagingFlowTexture.createView({ dimension: '2d-array' })
                },
                {
                    binding: 7,
                    resource: stagingIntegrationTexture.createView({
                        dimension: '2d-array'
                    })
                }
            ]
        });
    } catch (error) {
        for (const value of resources) {
            try { value.destroy?.(); } catch { /* retired device */ }
        }
        throw error;
    }
    const totalWorkUnits = atlas.cols * atlas.rows * (
        generation.sourceLayerCount * (1 + generation.relaxationPassCount)
        + atlas.fieldCount
    );
    let completedWorkUnits = 0;
    let credit = 0;
    let stage = 'seed';
    let relaxationPassIndex = 0;
    let rowOffset = 0;
    let complete = false;
    let cancelled = false;
    let retired = false;

    const retire = () => {
        if (retired) return;
        retired = true;
        for (const value of resources) {
            try { value.destroy?.(); } catch { /* retired device */ }
        }
    };
    const retireAfterQueue = () => {
        if (typeof device.queue.onSubmittedWorkDone !== 'function') {
            retire();
            return;
        }
        try {
            Promise.resolve(device.queue.onSubmittedWorkDone()).then(
                retire,
                retire
            );
        } catch {
            retire();
        }
    };
    const layerCountForStage = () => stage === 'finalize'
        ? atlas.fieldCount
        : generation.sourceLayerCount;
    const writeParams = (stripeRowCount) => {
        const bytes = new ArrayBuffer(PARAMS_BYTE_SIZE);
        const view = new DataView(bytes);
        view.setUint32(0, atlas.cols, LITTLE_ENDIAN);
        view.setUint32(4, atlas.rows, LITTLE_ENDIAN);
        view.setUint32(8, generation.sourceLayerCount, LITTLE_ENDIAN);
        view.setUint32(12, atlas.fieldCount, LITTLE_ENDIAN);
        view.setUint32(16, atlas.size, LITTLE_ENDIAN);
        view.setUint32(20, rowOffset, LITTLE_ENDIAN);
        view.setUint32(24, stripeRowCount, LITTLE_ENDIAN);
        device.queue.writeBuffer(params, 0, bytes);
    };
    const advanceStage = () => {
        rowOffset = 0;
        if (stage === 'seed') {
            stage = 'relax';
            return;
        }
        if (stage === 'relax') {
            relaxationPassIndex++;
            if (relaxationPassIndex >= generation.relaxationPassCount) {
                stage = 'finalize';
            }
            return;
        }
        stage = 'copy';
    };
    const submitStripe = (stripeRowCount) => {
        writeParams(stripeRowCount);
        const encoder = device.createCommandEncoder({
            label: `cirvivor-route-flow-rebuild-${stage}`
        });
        const pass = encoder.beginComputePass({
            label: `cirvivor-route-flow-rebuild-${stage}-pass`
        });
        if (stage === 'seed') {
            pass.setPipeline(pipelines.seed);
            pass.setBindGroup(0, seedBindGroup);
        } else if (stage === 'relax') {
            pass.setPipeline(pipelines.relax);
            pass.setBindGroup(
                0,
                relaxationPassIndex % 2 === 0 ? relaxAB : relaxBA
            );
        } else {
            pass.setPipeline(pipelines.finalize);
            pass.setBindGroup(0, finalizeBindGroup);
        }
        pass.dispatchWorkgroups(
            Math.ceil(atlas.cols / WORKGROUP_SIZE),
            Math.ceil(stripeRowCount / WORKGROUP_SIZE),
            layerCountForStage()
        );
        pass.end();
        device.queue.submit([encoder.finish()]);
        const spent = atlas.cols * stripeRowCount * layerCountForStage();
        completedWorkUnits += spent;
        credit -= spent;
        rowOffset += stripeRowCount;
        if (rowOffset >= atlas.rows) advanceStage();
    };
    const commitCopy = () => {
        const encoder = device.createCommandEncoder({
            label: 'cirvivor-route-flow-rebuild-atomic-publish'
        });
        const copySize = {
            width: atlas.cols,
            height: atlas.rows,
            depthOrArrayLayers: atlas.fieldCount
        };
        encoder.copyTextureToTexture(
            { texture: stagingFlowTexture },
            { texture: flowTexture },
            copySize
        );
        encoder.copyTextureToTexture(
            { texture: stagingIntegrationTexture },
            { texture: integrationTexture },
            copySize
        );
        device.queue.submit([encoder.finish()]);
        complete = true;
        try {
            if (!cancelled) onCommitted?.(availabilityVersion);
        } finally {
            retireAfterQueue();
        }
    };

    return Object.freeze({
        availabilityVersion,
        totalWorkUnits,
        pump({
            elapsedSeconds,
            previousFrameCpuSeconds,
            targetFrameSeconds
        } = {}) {
            if (complete || cancelled) return this.getStatus();
            const elapsed = Math.max(Number(elapsedSeconds) || 0, 0);
            const target = Math.max(Number(targetFrameSeconds) || (1 / 60), 1e-6);
            const previousCpu = Math.max(
                Number(previousFrameCpuSeconds) || 0,
                0
            );
            const headroomRatio = Math.min(
                Math.max((target - previousCpu) / target, 0),
                1
            );
            const rate = GPU_ROUTE_FLOW_FIELD_MINIMUM_REBUILD_RATE_PER_SECOND
                + ((1 - GPU_ROUTE_FLOW_FIELD_MINIMUM_REBUILD_RATE_PER_SECOND)
                    * headroomRatio);
            credit = Math.min(
                credit + (elapsed * totalWorkUnits * rate),
                totalWorkUnits
            );
            // 저사양/저프레임에서도 실제 경과 1초당 최소 30% work가 encode되도록
            // 고정 dispatch cap을 baseline 필요량만큼 확장합니다. CPU 여유분으로
            // 생긴 추가 credit은 평상시 cap 안에서만 소비됩니다.
            const stageCount = generation.relaxationPassCount + 2;
            const minimumDispatchesForElapsed = Math.ceil(
                elapsed
                    * GPU_ROUTE_FLOW_FIELD_MINIMUM_REBUILD_RATE_PER_SECOND
                    * stageCount
            ) + 2;
            const dispatchBudget = Math.max(
                INCREMENTAL_BASE_DISPATCHES_PER_PUMP,
                minimumDispatchesForElapsed
            );
            let dispatchCount = 0;
            while (stage !== 'copy'
                && dispatchCount < dispatchBudget) {
                const layerCount = layerCountForStage();
                const affordableRows = Math.floor(
                    credit / (atlas.cols * layerCount)
                );
                if (affordableRows < 1) break;
                const stripeRowCount = Math.min(
                    atlas.rows - rowOffset,
                    affordableRows
                );
                submitStripe(stripeRowCount);
                dispatchCount++;
            }
            if (stage === 'copy' && !cancelled) commitCopy();
            return this.getStatus();
        },
        cancel() {
            if (complete || cancelled) return false;
            cancelled = true;
            retireAfterQueue();
            return true;
        },
        getStatus() {
            return Object.freeze({
                availabilityVersion,
                complete,
                cancelled,
                stage,
                relaxationPassIndex,
                rowOffset,
                progress: totalWorkUnits === 0
                    ? 1
                    : Math.min(completedWorkUnits / totalWorkUnits, 1),
                minimumRatePerSecond:
                    GPU_ROUTE_FLOW_FIELD_MINIMUM_REBUILD_RATE_PER_SECOND
            });
        }
    });
}
