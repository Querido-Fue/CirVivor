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
    reserved_0: u32,
    reserved_1: u32,
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
    if (id.x >= params.cols || id.y >= params.rows
        || id.z >= params.source_layer_count) {
        return;
    }
    let cell_index = id.y * params.cols + id.x;
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
    if (id.x >= params.cols || id.y >= params.rows
        || id.z >= params.source_layer_count) {
        return;
    }
    let cell = vec2i(id.xy);
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
    if (id.x >= params.cols || id.y >= params.rows
        || id.z >= params.stage_layer_count) {
        return;
    }
    let source_layer = stage_layer_indices[id.z];
    let output_cell = vec2i(id.xy);
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
    device.queue.writeBuffer(buffer, 0, source);
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
