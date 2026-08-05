import {
    GPU_COLLISION_COMPUTE_WGSL,
    GPU_COLLISION_INDIRECT_WGSL,
    GPU_COLLISION_RENDER_WGSL
} from './production/script/module/ingame/physics/gpu/gpu_collision_shaders.js';
import {
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG
} from './production/script/module/ingame/physics/gpu/gpu_circle_body_abi.js';
import { GpuCircleBodySimulation } from './production/script/module/ingame/physics/gpu/gpu_circle_body_simulation.js';
import {
    BASIC_ARROW_ENEMY_DATA,
    BASIC_CIRCLE_ENEMY_DATA,
    BASIC_GEN_ENEMY_DATA,
    BASIC_HEXA_ENEMY_DATA,
    BASIC_PENTA_ENEMY_DATA,
    BASIC_SQUARE_ENEMY_DATA,
    BASIC_TRIANGLE_ENEMY_DATA
} from './production/script/data/object/enemy/basic_circle_enemy_data.js';
import { createTileMap } from './production/script/module/ingame/map/tile_map.js';
import {
    createRouteFlowFieldAtlas
} from './production/script/module/ingame/navigation/route_flow_field_atlas.js';
import {
    createGpuEnemySpawnIntent
} from './production/script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js';
import {
    createGpuEnemySimulationEndpoint,
    createGpuProjectileSpawnIntent
} from './production/script/module/ingame/gpu_simulation_endpoint.js';
import {
    requestGpuBenchmarkEnemyBatch
} from './production/script/module/scene/benchmark/gpu_benchmark_enemy_spawn_adapter.js';
import {
    createGpuBenchmarkNavigationSource
} from './production/script/module/scene/benchmark/gpu_benchmark_navigation_source.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const canvas = document.getElementById('gpu');
const REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE = 9;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertNear(actual, expected, tolerance, message) {
    assert(
        Math.abs(actual - expected) <= tolerance,
        `${message}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`
    );
}

async function waitForSimulationStatus(simulation, predicate, label, timeoutMs = 5_000) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        const status = simulation.getStatus();
        if (predicate(status)) {
            return status;
        }
        await new Promise((resolve) => setTimeout(resolve, 4));
    }
    const status = simulation.getStatus();
    throw new Error(`${label} 대기 제한시간 초과: ${JSON.stringify(status)}`);
}

function serializeAdapterInfo(adapter) {
    const info = adapter?.info;
    if (!info) return null;
    return {
        vendor: info.vendor || '',
        architecture: info.architecture || '',
        device: info.device || '',
        description: info.description || ''
    };
}

function serializeLimits(limits) {
    const keys = [
        'maxBufferSize',
        'maxStorageBufferBindingSize',
        'maxStorageBuffersPerShaderStage',
        'maxStorageTexturesPerShaderStage',
        'maxBindGroups',
        'maxBindingsPerBindGroup',
        'maxComputeWorkgroupSizeX',
        'maxComputeInvocationsPerWorkgroup',
        'maxComputeWorkgroupsPerDimension',
        'maxComputeWorkgroupStorageSize',
        'maxTextureDimension2D',
        'minStorageBufferOffsetAlignment',
        'minUniformBufferOffsetAlignment'
    ];
    return Object.fromEntries(keys.map((key) => [key, Number(limits[key])]));
}

async function assertShaderValid(shaderModule, label) {
    const info = await shaderModule.getCompilationInfo();
    const errors = info.messages.filter(({ type }) => type === 'error');
    assert(
        errors.length === 0,
        `${label} WGSL validation 실패: ${errors.map(({ message }) => message).join(' | ')}`
    );
}

async function runAtomicIndirectCompute(device) {
    const module = device.createShaderModule({
        label: 'capability-atomic-indirect',
        code: `
            struct State { value: atomic<u32> }
            @group(0) @binding(0) var<storage, read_write> state: State;

            @compute @workgroup_size(256)
            fn main() {
                atomicAdd(&state.value, 1u);
            }
        `
    });
    await assertShaderValid(module, 'atomic-indirect');
    const pipeline = await device.createComputePipelineAsync({
        label: 'capability-atomic-indirect',
        layout: 'auto',
        compute: { module, entryPoint: 'main' }
    });
    const stateBuffer = device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
    const indirectBuffer = device.createBuffer({
        size: 12,
        usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST
    });
    const readbackBuffer = device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    device.queue.writeBuffer(stateBuffer, 0, new Uint32Array([0]));
    device.queue.writeBuffer(indirectBuffer, 0, new Uint32Array([1, 1, 1]));

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: stateBuffer } }]
    });
    const encoder = device.createCommandEncoder({ label: 'capability-compute-encoder' });
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroupsIndirect(indirectBuffer, 0);
    pass.end();
    encoder.copyBufferToBuffer(stateBuffer, 0, readbackBuffer, 0, 4);
    device.queue.submit([encoder.finish()]);

    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const value = new Uint32Array(readbackBuffer.getMappedRange().slice(0))[0];
    readbackBuffer.unmap();
    assert(value === 256, `atomic indirect compute 결과가 256이 아닙니다: ${value}`);

    stateBuffer.destroy();
    indirectBuffer.destroy();
    readbackBuffer.destroy();
    return value;
}

async function runStorageTextureSmoke(device) {
    const formats = ['r32float', 'rg32float', 'rgba16float'];
    const textures = formats.map((format) => device.createTexture({
        label: `capability-${format}`,
        size: [1, 1],
        format,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }));
    const module = device.createShaderModule({
        label: 'capability-storage-textures',
        code: `
            @group(0) @binding(0) var r_tex: texture_storage_2d<r32float, write>;
            @group(0) @binding(1) var rg_tex: texture_storage_2d<rg32float, write>;
            @group(0) @binding(2) var rgba_tex: texture_storage_2d<rgba16float, write>;

            @compute @workgroup_size(1)
            fn main() {
                textureStore(r_tex, vec2i(0), vec4f(1.0, 0.0, 0.0, 0.0));
                textureStore(rg_tex, vec2i(0), vec4f(1.0, 2.0, 0.0, 0.0));
                textureStore(rgba_tex, vec2i(0), vec4f(1.0, 2.0, 3.0, 4.0));
            }
        `
    });
    await assertShaderValid(module, 'storage-textures');
    const pipeline = await device.createComputePipelineAsync({
        label: 'capability-storage-textures',
        layout: 'auto',
        compute: { module, entryPoint: 'main' }
    });
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: textures.map((texture, binding) => ({
            binding,
            resource: texture.createView()
        }))
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    for (const texture of textures) texture.destroy();
    return formats;
}

async function runProductionShaderSmoke(device, format) {
    const computeModule = device.createShaderModule({
        label: 'cirvivor-gpu-collision-compute',
        code: GPU_COLLISION_COMPUTE_WGSL
    });
    const indirectModule = device.createShaderModule({
        label: 'cirvivor-gpu-collision-indirect',
        code: GPU_COLLISION_INDIRECT_WGSL
    });
    const renderModule = device.createShaderModule({
        label: 'cirvivor-gpu-collision-render',
        code: GPU_COLLISION_RENDER_WGSL
    });
    await Promise.all([
        assertShaderValid(computeModule, 'production-compute'),
        assertShaderValid(indirectModule, 'production-indirect'),
        assertShaderValid(renderModule, 'production-render')
    ]);

    const computeEntryPoints = [
        'prepare_bodies',
        'clear_grid',
        'build_grid',
        'clear_contact_state',
        'generate_body_contacts',
        'generate_world_contacts',
        'handle_contacts',
        'mark_dead',
        'clear_position_deltas',
        'solve_body_body',
        'solve_body_world',
        'apply_position_deltas',
        'rebuild_velocities',
        'finalize_velocities'
    ];
    await Promise.all(computeEntryPoints.map((entryPoint) => (
        device.createComputePipelineAsync({
            label: `cirvivor-gpu-collision-${entryPoint}`,
            layout: 'auto',
            compute: { module: computeModule, entryPoint }
        })
    )));
    await device.createComputePipelineAsync({
        label: 'cirvivor-gpu-collision-update-indirect-args',
        layout: 'auto',
        compute: { module: indirectModule, entryPoint: 'update_indirect_args' }
    });
    await device.createRenderPipelineAsync({
        label: 'cirvivor-gpu-collision-render',
        layout: 'auto',
        vertex: { module: renderModule, entryPoint: 'vertex_main' },
        fragment: {
            module: renderModule,
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
    });

    return {
        computeEntryPoints,
        indirectEntryPoint: 'update_indirect_args',
        renderEntryPoints: ['vertex_main', 'fragment_main']
    };
}

async function runCanvasIndirectDraw(device) {
    const context = canvas.getContext('webgpu');
    assert(context, 'canvas.getContext(webgpu)가 null입니다.');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format,
        alphaMode: 'premultiplied',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    const module = device.createShaderModule({
        label: 'capability-indirect-draw',
        code: `
            @vertex
            fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
                var positions = array<vec2f, 3>(
                    vec2f(-1.0, -1.0),
                    vec2f(3.0, -1.0),
                    vec2f(-1.0, 3.0)
                );
                return vec4f(positions[index], 0.0, 1.0);
            }

            @fragment
            fn fs() -> @location(0) vec4f {
                return vec4f(0.25, 0.5, 0.75, 1.0);
            }
        `
    });
    await assertShaderValid(module, 'indirect-draw');
    const pipeline = await device.createRenderPipelineAsync({
        label: 'capability-indirect-draw',
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' }
    });
    const indirectBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST
    });
    const bytesPerRow = 256;
    const readbackBuffer = device.createBuffer({
        size: bytesPerRow * canvas.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    device.queue.writeBuffer(indirectBuffer, 0, new Uint32Array([3, 1, 0, 0]));

    const texture = context.getCurrentTexture();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: texture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store'
        }]
    });
    pass.setPipeline(pipeline);
    pass.drawIndirect(indirectBuffer, 0);
    pass.end();
    encoder.copyTextureToBuffer(
        { texture },
        { buffer: readbackBuffer, bytesPerRow, rowsPerImage: canvas.height },
        [canvas.width, canvas.height]
    );
    device.queue.submit([encoder.finish()]);

    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const pixels = new Uint8Array(readbackBuffer.getMappedRange());
    const offset = (Math.floor(canvas.height / 2) * bytesPerRow)
        + (Math.floor(canvas.width / 2) * 4);
    const pixel = Array.from(pixels.slice(offset, offset + 4));
    readbackBuffer.unmap();
    const expected = format.startsWith('bgra')
        ? [191, 128, 64, 255]
        : [64, 128, 191, 255];
    for (let index = 0; index < 4; index += 1) {
        assert(Math.abs(pixel[index] - expected[index]) <= 1, `indirect draw pixel 불일치: ${pixel}`);
    }

    indirectBuffer.destroy();
    readbackBuffer.destroy();
    context.unconfigure();
    return { format, pixel };
}

async function runProductionSimulationSmoke(device) {
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format,
        alphaMode: 'premultiplied',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    let drawMarks = 0;
    let clearMarks = 0;
    let deviceGeneration = 1;
    const platformPort = {
        getState: () => 'ready',
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => deviceGeneration,
        acquireFrameTarget() {
            const texture = context.getCurrentTexture();
            return {
                device,
                context,
                texture,
                view: texture.createView(),
                format,
                deviceGeneration,
                width: canvas.width,
                height: canvas.height
            };
        },
        clearCanvas(clearValue = { r: 0, g: 0, b: 0, a: 0 }) {
            const target = this.acquireFrameTarget();
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: target.view,
                    clearValue,
                    loadOp: 'clear',
                    storeOp: 'store'
                }]
            });
            pass.end();
            device.queue.submit([encoder.finish()]);
            return true;
        },
        markCanvasDrawn() {
            drawMarks++;
            return true;
        },
        markCanvasCleared() {
            clearMarks++;
            return true;
        }
    };
    const simulation = new GpuCircleBodySimulation(platformPort, {
        capacity: 8,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 2, y: 2 },
        sdf: {
            cols: 4,
            rows: 4,
            values: new Float32Array(16).fill(100)
        }
    });
    assert(simulation.init(), 'production GPU circle simulation init 실패');
    const replaceResult = simulation.replaceBodies([
        {
            position: { x: 3.75, y: 4 },
            velocity: { x: 0, y: 0 },
            radius: 0.5,
            inverseMass: 1,
            layerMask: 1,
            collisionMask: 1,
            alive: true
        },
        {
            position: { x: 4.25, y: 4 },
            velocity: { x: 0, y: 0 },
            radius: 0.5,
            inverseMass: 1,
            layerMask: 1,
            collisionMask: 1,
            alive: true
        },
        {
            position: { x: 0.25, y: 1 },
            velocity: { x: 0, y: 0 },
            radius: 0.5,
            inverseMass: 1,
            layerMask: 1,
            collisionMask: 128,
            alive: true
        },
        {
            position: { x: 6, y: 6 },
            velocity: { x: 7, y: -5 },
            radius: 0.5,
            inverseMass: 0,
            layerMask: 1,
            collisionMask: 1,
            alive: true
        }
    ]);
    assert(
        replaceResult.accepted === 4
            && replaceResult.rejected === 0
            && replaceResult.capacity === 8,
        `production GPU circle body 교체 실패: ${JSON.stringify(replaceResult)}`
    );
    assert(simulation.fixedUpdate(1 / 60), 'production GPU circle fixed submit 실패');
    await device.queue.onSubmittedWorkDone();
    const bodies = await simulation.readbackBodies();
    const distance = Math.hypot(
        bodies[0].position.x - bodies[1].position.x,
        bodies[0].position.y - bodies[1].position.y
    );
    assert(distance >= 0.999, `production GPU circle collision 미해소: ${distance}`);
    const boundaryBodyX = bodies[2].position.x;
    assert(
        boundaryBodyX >= 0.499,
        `production GPU world-boundary SDF 미해소: ${boundaryBodyX}`
    );
    const staticBody = bodies[3];
    assertNear(staticBody.position.x, 6, 0.000001, '정적 body의 x 위치가 이동했습니다');
    assertNear(staticBody.position.y, 6, 0.000001, '정적 body의 y 위치가 이동했습니다');
    assertNear(staticBody.velocity.x, 0, 0.000001, '정적 body의 x 속도가 남았습니다');
    assertNear(staticBody.velocity.y, 0, 0.000001, '정적 body의 y 속도가 남았습니다');
    const sourceWorldUnitScale = simulation.getStatus().sourceWorldUnitScale;
    assertNear(
        sourceWorldUnitScale,
        0.25,
        0.000001,
        'production GPU SDF source world unit scale이 다릅니다'
    );
    simulation.updatePresentation({
        frameDelta: 1 / 120,
        fixedAlpha: 0.5,
        renderFrameId: 1
    });
    assert(simulation.draw({
        worldToViewport(x, y, out) {
            out.x = x * 8;
            out.y = y * 8;
            return out;
        },
        getScale: () => 8
    }), 'production GPU circle indirect draw 실패');
    await device.queue.onSubmittedWorkDone();
    assert(drawMarks === 1, `markCanvasDrawn 호출 수 불일치: ${drawMarks}`);
    const positions = bodies.map(({ position }) => ({ ...position }));
    deviceGeneration = 2;
    assert(
        simulation.fixedUpdate(1 / 60) === false,
        'device generation 변경 뒤 authoritative fixed tick이 제출되었습니다.'
    );
    const generationStatus = simulation.getStatus();
    assert(
        generationStatus.state === 'requires-rebuild'
            && generationStatus.requiresAuthoritativeRebuild
            && generationStatus.failure?.stage === 'device-generation-change',
        `device generation 변경이 requires-rebuild로 전파되지 않았습니다: ${JSON.stringify(generationStatus)}`
    );
    simulation.destroy();
    await device.queue.onSubmittedWorkDone();
    context.unconfigure();
    return {
        distance,
        boundaryBodyX,
        sourceWorldUnitScale,
        staticBody: {
            position: { ...staticBody.position },
            velocity: { ...staticBody.velocity }
        },
        positions,
        drawMarks,
        clearMarks,
        generationStatus
    };
}

async function runProductionFlowAtlasSmoke(device) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    const platformPort = {
        getState: () => 'ready',
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => 1,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    };
    const flowAtlasCols = 2;
    const flowAtlasRows = 2;
    const fieldCount = 2;
    const fixedDelta = 1 / 60;
    const transitionRadius = 0.15;
    const immediateGoal = Object.freeze({ x: 1, y: 1 });
    const finalGoal = Object.freeze({ x: 6.5, y: 1.5 });
    const directions = new Float32Array(
        flowAtlasCols * flowAtlasRows * fieldCount * 2
    );
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
        for (let cellIndex = 0; cellIndex < flowAtlasCols * flowAtlasRows; cellIndex++) {
            directions[((fieldIndex * flowAtlasCols * flowAtlasRows) + cellIndex) * 2] = 1;
        }
    }
    const simulation = new GpuCircleBodySimulation(platformPort, {
        capacity: 3,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 },
        flowFieldAtlas: {
            cols: flowAtlasCols,
            rows: flowAtlasRows,
            fieldCount,
            origin: { x: 0, y: 0 },
            cellSize: { x: 4, y: 4 },
            directions,
            stages: [
                {
                    goalCell: { column: 0, row: 0 },
                    goalPosition: immediateGoal,
                    transitionRadius,
                    nextFieldIndex: 1
                },
                {
                    goalCell: { column: 1, row: 0 },
                    goalPosition: finalGoal,
                    transitionRadius,
                    nextFieldIndex: -1
                }
            ]
        }
    });
    const initialBodies = [
        {
            entityId: 6101,
            incarnation: 1,
            position: immediateGoal,
            velocity: { x: 0, y: 0 },
            radius: 0.1,
            inverseMass: 1,
            layerMask: 1,
            collisionMask: 0,
            alive: true,
            useFlow: true,
            flowFieldIndex: 0,
            flowSpeed: 6
        },
        {
            entityId: 6102,
            incarnation: 1,
            position: { x: 0, y: immediateGoal.y },
            velocity: { x: 120, y: 0 },
            radius: 0.1,
            inverseMass: 1,
            layerMask: 1,
            collisionMask: 0,
            alive: true,
            useFlow: true,
            flowFieldIndex: 0,
            flowSpeed: 120
        },
        {
            entityId: 6103,
            incarnation: 1,
            position: finalGoal,
            velocity: { x: 4, y: -3 },
            radius: 0.1,
            inverseMass: 1,
            layerMask: 1,
            collisionMask: 0,
            alive: true,
            useFlow: true,
            flowFieldIndex: 1,
            flowSpeed: 6
        }
    ];
    const findBody = (bodies, entityId, label) => {
        const body = bodies.find((candidate) => candidate.entityId === entityId);
        assert(body, `flow atlas ${label} body를 찾지 못했습니다: entityId=${entityId}`);
        return body;
    };
    try {
        assert(simulation.init(), 'flow atlas production GPU circle simulation init 실패');
        const replaceResult = simulation.replaceBodies(initialBodies);
        assert(
            replaceResult.accepted === initialBodies.length && replaceResult.rejected === 0,
            `flow atlas body 교체 실패: ${JSON.stringify(replaceResult)}`
        );
        const initialStatus = simulation.getStatus();
        assert(
            initialStatus.flowFieldEnabled && initialStatus.flowFieldCount === fieldCount,
            `flow atlas 상태가 올바르지 않습니다: ${JSON.stringify(initialStatus)}`
        );
        assert(simulation.fixedUpdate(fixedDelta), 'flow atlas 첫 fixed tick 제출 실패');
        const firstBodiesPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const firstBodies = await firstBodiesPromise;
        assert(
            firstBodies.length === initialBodies.length,
            `flow atlas 첫 readback body 수 불일치: ${firstBodies.length}`
        );
        const immediateBody = findBody(firstBodies, initialBodies[0].entityId, 'immediate');
        assert(
            immediateBody.flowFieldIndex === 1
                && immediateBody.previousFlowFieldIndex === 0,
            `authored goal 내부 즉시 flow layer 전환이 실패했습니다: ${JSON.stringify(immediateBody)}`
        );
        const sweepAfterFirstTick = findBody(firstBodies, initialBodies[1].entityId, 'sweep');
        assert(
            sweepAfterFirstTick.flowFieldIndex === 0
                && sweepAfterFirstTick.previousFlowFieldIndex === 0,
            `sweep 첫 tick이 stage를 미리 전환했습니다: ${JSON.stringify(sweepAfterFirstTick)}`
        );
        assertNear(
            sweepAfterFirstTick.previousPosition.x,
            initialBodies[1].position.x,
            0.00001,
            'sweep 첫 tick previous x가 authored 시작점과 다릅니다'
        );
        assertNear(
            sweepAfterFirstTick.previousPosition.y,
            initialBodies[1].position.y,
            0.00001,
            'sweep 첫 tick previous y가 authored 시작점과 다릅니다'
        );
        assert(
            sweepAfterFirstTick.position.x > immediateGoal.x + transitionRadius,
            `sweep 첫 tick이 goal circle을 실제로 가로지르지 않았습니다: ${JSON.stringify(sweepAfterFirstTick)}`
        );
        const finalAfterFirstTick = findBody(firstBodies, initialBodies[2].entityId, 'final');
        assertNear(
            finalAfterFirstTick.position.x,
            finalGoal.x,
            0.00001,
            '최종 goal 내부 body의 x 위치가 이동했습니다'
        );
        assertNear(
            finalAfterFirstTick.position.y,
            finalGoal.y,
            0.00001,
            '최종 goal 내부 body의 y 위치가 이동했습니다'
        );
        assertNear(
            finalAfterFirstTick.velocity.x,
            0,
            0.00001,
            '최종 goal 내부 body의 x 속도가 정지하지 않았습니다'
        );
        assertNear(
            finalAfterFirstTick.velocity.y,
            0,
            0.00001,
            '최종 goal 내부 body의 y 속도가 정지하지 않았습니다'
        );
        assert(
            finalAfterFirstTick.flowFieldIndex === 1,
            `최종 goal 내부 body가 terminal stage를 벗어났습니다: ${JSON.stringify(finalAfterFirstTick)}`
        );

        assert(simulation.fixedUpdate(fixedDelta), 'flow atlas 두 번째 fixed tick 제출 실패');
        const secondBodiesPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const secondBodies = await secondBodiesPromise;
        assert(
            secondBodies.length === initialBodies.length,
            `flow atlas 두 번째 readback body 수 불일치: ${secondBodies.length}`
        );
        const sweepAfterSecondTick = findBody(secondBodies, initialBodies[1].entityId, 'sweep second');
        assert(
            sweepAfterSecondTick.previousFlowFieldIndex === 0
                && sweepAfterSecondTick.flowFieldIndex === 1,
            `previous→current sweep이 다음 tick에 정확히 한 stage만 전환하지 않았습니다: ${JSON.stringify(sweepAfterSecondTick)}`
        );
        const finalAfterSecondTick = findBody(secondBodies, initialBodies[2].entityId, 'final second');
        assertNear(
            finalAfterSecondTick.position.x,
            finalGoal.x,
            0.00001,
            '최종 goal 정지 x가 다음 tick에도 유지되지 않았습니다'
        );
        assertNear(
            finalAfterSecondTick.position.y,
            finalGoal.y,
            0.00001,
            '최종 goal 정지 y가 다음 tick에도 유지되지 않았습니다'
        );
        const completedStatus = await waitForSimulationStatus(
            simulation,
            (status) => status.overflow.pendingReadbacks === 0,
            'flow atlas overflow telemetry completion'
        );
        return {
            atlas: {
                cols: flowAtlasCols,
                rows: flowAtlasRows,
                fieldCount,
                transitionRadius,
                stages: [
                    { goalPosition: immediateGoal, nextFieldIndex: 1 },
                    { goalPosition: finalGoal, nextFieldIndex: -1 }
                ]
            },
            fixedDelta,
            immediateTransition: {
                before: { ...initialBodies[0].position },
                after: { ...immediateBody.position },
                flowFieldIndexBefore: initialBodies[0].flowFieldIndex,
                flowFieldIndexAfter: immediateBody.flowFieldIndex
            },
            sweptTransition: {
                before: { ...initialBodies[1].position },
                firstTick: {
                    previous: { ...sweepAfterFirstTick.previousPosition },
                    current: { ...sweepAfterFirstTick.position },
                    flowFieldIndex: sweepAfterFirstTick.flowFieldIndex
                },
                secondTick: {
                    previousFlowFieldIndex: sweepAfterSecondTick.previousFlowFieldIndex,
                    flowFieldIndex: sweepAfterSecondTick.flowFieldIndex,
                    position: { ...sweepAfterSecondTick.position }
                }
            },
            finalGoalStop: {
                position: { ...finalAfterSecondTick.position },
                velocity: { ...finalAfterSecondTick.velocity },
                flowFieldIndex: finalAfterSecondTick.flowFieldIndex
            },
            status: {
                state: completedStatus.state,
                flowFieldEnabled: completedStatus.flowFieldEnabled,
                flowFieldCount: completedStatus.flowFieldCount,
                submittedTickCount: completedStatus.submittedTickCount
            }
        };
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionShapeFlowAtlasSmoke(device) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    const cols = 54;
    const rows = 30;
    const fieldCount = 24;
    const componentsPerCell = 2;
    const layerCellCount = cols * rows;
    const directions = new Float32Array(
        layerCellCount * fieldCount * componentsPerCell
    );
    const sampledCell = Object.freeze({ column: cols - 1, row: rows - 1 });
    const sampledFieldIndex = fieldCount - 1;
    const sampledDirectionOffset = (
        (sampledFieldIndex * layerCellCount)
        + (sampledCell.row * cols)
        + sampledCell.column
    ) * componentsPerCell;
    directions[sampledDirectionOffset] = 0;
    directions[sampledDirectionOffset + 1] = 1;
    const shapeGoalPosition = Object.freeze({ x: 0.5, y: 0.5 });
    const stages = Array.from({ length: fieldCount }, () => ({
        goalCell: { column: 0, row: 0 },
        goalPosition: shapeGoalPosition,
        transitionRadius: 0.25,
        nextFieldIndex: -1
    }));

    const actualQueue = device.queue;
    const writeTextureCalls = [];
    const queueMethodCache = new Map();
    const wrappedQueue = new Proxy(actualQueue, {
        get(target, property) {
            if (property === 'writeTexture') {
                return (destination, data, dataLayout, size) => {
                    writeTextureCalls.push(Object.freeze({
                        dataByteLength: data.byteLength,
                        bytesPerRow: Number(dataLayout.bytesPerRow),
                        rowsPerImage: Number(dataLayout.rowsPerImage),
                        width: Number(size.width),
                        height: Number(size.height),
                        depthOrArrayLayers: Number(size.depthOrArrayLayers)
                    }));
                    return Reflect.apply(target.writeTexture, target, [
                        destination,
                        data,
                        dataLayout,
                        size
                    ]);
                };
            }
            const value = Reflect.get(target, property, target);
            if (typeof value !== 'function') {
                return value;
            }
            if (!queueMethodCache.has(property)) {
                queueMethodCache.set(property, value.bind(target));
            }
            return queueMethodCache.get(property);
        }
    });
    const deviceMethodCache = new Map();
    const wrappedDevice = new Proxy(device, {
        get(target, property) {
            if (property === 'queue') {
                return wrappedQueue;
            }
            const value = Reflect.get(target, property, target);
            if (typeof value !== 'function') {
                return value;
            }
            if (!deviceMethodCache.has(property)) {
                deviceMethodCache.set(property, value.bind(target));
            }
            return deviceMethodCache.get(property);
        }
    });
    const platformPort = {
        getState: () => 'ready',
        getDevice: () => wrappedDevice,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => 1,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    };
    const simulation = new GpuCircleBodySimulation(platformPort, {
        capacity: 1,
        worldSize: { x: cols, y: rows },
        gridCellSize: { x: cols, y: rows },
        flowFieldAtlas: {
            cols,
            rows,
            fieldCount,
            origin: { x: 0, y: 0 },
            cellSize: { x: 1, y: 1 },
            directions,
            stages
        }
    });
    const fixedDelta = 1 / 60;
    const flowSpeed = 6;
    const spawn = {
        entityId: 6001,
        incarnation: 1,
        position: {
            x: sampledCell.column + 0.5,
            y: sampledCell.row + 0.5
        },
        velocity: { x: 0, y: 0 },
        radius: 0.1,
        inverseMass: 1,
        layerMask: 1,
        collisionMask: 0,
        alive: true,
        useFlow: true,
        flowFieldIndex: sampledFieldIndex,
        flowSpeed
    };

    try {
        assert(simulation.init(), 'production-shape flow atlas simulation init 실패');
        assert(
            writeTextureCalls.length === 1,
            `production-shape atlas writeTexture 호출 수 불일치: ${writeTextureCalls.length}`
        );
        const upload = writeTextureCalls[0];
        assert(
            upload.dataByteLength === directions.byteLength
                && upload.bytesPerRow === cols * componentsPerCell * Float32Array.BYTES_PER_ELEMENT
                && upload.rowsPerImage === rows
                && upload.width === cols
                && upload.height === rows
                && upload.depthOrArrayLayers === fieldCount,
            `production-shape atlas upload layout 불일치: ${JSON.stringify(upload)}`
        );
        const spawnResult = simulation.spawnBodies([spawn]);
        assert(
            spawnResult.accepted === 1
                && spawnResult.rejected === 0
                && spawnResult.handles?.length === 1,
            `production-shape flow body spawn 실패: ${JSON.stringify(spawnResult)}`
        );
        const initialStatus = simulation.getStatus();
        assert(
            initialStatus.flowFieldEnabled
                && initialStatus.flowFieldCount === fieldCount,
            `production-shape flow atlas 상태 불일치: ${JSON.stringify(initialStatus)}`
        );
        assert(
            simulation.fixedUpdate(fixedDelta),
            'production-shape flow atlas fixed tick 제출 실패'
        );
        const bodiesPromise = simulation.readbackBodies();
        await actualQueue.onSubmittedWorkDone();
        const bodies = await bodiesPromise;
        assert(bodies.length === 1, `production-shape flow readback body 수 불일치: ${bodies.length}`);
        const body = bodies[0];
        const expectedVelocity = flowSpeed * fixedDelta;
        const expectedDisplacement = expectedVelocity * fixedDelta;
        assert(
            body.handle?.entityId === spawn.entityId
                && body.handle?.incarnation === spawn.incarnation,
            `production-shape flow readback handle 불일치: ${JSON.stringify(body)}`
        );
        assert(
            body.flowFieldIndex === sampledFieldIndex
                && body.previousFlowFieldIndex === sampledFieldIndex,
            `production-shape flow layer index 불일치: ${JSON.stringify(body)}`
        );
        assertNear(
            body.velocity.x,
            0,
            0.00001,
            'production-shape last-layer x 조향 불일치'
        );
        assertNear(
            body.velocity.y,
            expectedVelocity,
            0.00005,
            'production-shape last-layer y 조향 불일치'
        );
        assertNear(
            body.position.x,
            spawn.position.x,
            0.00001,
            'production-shape last-row x 위치 불일치'
        );
        assertNear(
            body.position.y,
            spawn.position.y + expectedDisplacement,
            0.00001,
            'production-shape last-row y 위치 불일치'
        );
        const completedStatus = await waitForSimulationStatus(
            simulation,
            (status) => status.overflow.pendingReadbacks === 0,
            'production-shape flow telemetry completion'
        );
        assert(
            completedStatus.state === 'ready'
                && completedStatus.overflow.totalSmallCount === 0
                && completedStatus.overflow.totalBigCount === 0,
            `production-shape flow tick 상태 불일치: ${JSON.stringify(completedStatus)}`
        );
        return {
            atlas: {
                cols,
                rows,
                fieldCount,
                directionFloatCount: directions.length,
                directionByteLength: directions.byteLength
            },
            upload,
            sample: {
                fieldIndex: sampledFieldIndex,
                cell: sampledCell,
                direction: { x: 0, y: 1 },
                positionBefore: { ...spawn.position },
                positionAfter: { ...body.position },
                velocityAfter: { ...body.velocity }
            },
            status: {
                state: completedStatus.state,
                flowFieldCount: completedStatus.flowFieldCount,
                submittedTickCount: completedStatus.submittedTickCount
            }
        };
    } finally {
        simulation.destroy();
        await actualQueue.onSubmittedWorkDone();
    }
}

async function runProductionEnemyAdapterGpuSmoke(device) {
    const context = canvas.getContext('webgpu');
    assert(context, 'production enemy adapter canvas WebGPU context가 없습니다.');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format,
        alphaMode: 'premultiplied',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    let lastFrameTexture = null;
    let drawMarks = 0;
    const platformPort = {
        getState: () => 'ready',
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => 1,
        acquireFrameTarget() {
            const texture = context.getCurrentTexture();
            lastFrameTexture = texture;
            return {
                device,
                context,
                texture,
                view: texture.createView(),
                format,
                deviceGeneration: 1,
                width: canvas.width,
                height: canvas.height
            };
        },
        clearCanvas: () => false,
        markCanvasDrawn() {
            drawMarks++;
            return true;
        },
        markCanvasCleared: () => false
    };
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const routeAtlas = atlas.routes.find(({ pathId }) => pathId === route.pathId);
    assert(routeAtlas, `production enemy route atlas binding이 없습니다: ${route.pathId}`);
    assert(
        routeAtlas.firstTargetWaypointIndex === 1
            && routeAtlas.firstFieldIndex >= 0
            && routeAtlas.firstFieldIndex < atlas.fieldCount,
        `production enemy route atlas 첫 stage가 유효하지 않습니다: ${JSON.stringify(routeAtlas)}`
    );
    const worldBounds = tileMap.getWorldBounds();
    const simulation = new GpuCircleBodySimulation(platformPort, {
        capacity: 3,
        worldSize: { x: worldBounds.width, y: worldBounds.height },
        gridCellSize: { x: 2, y: 2 },
        flowFieldAtlas: atlas
    });
    const waveId = 'nw-production-enemy-adapter-smoke';
    const policyId = 'fixed-route';
    const intents = [0, -0.25, 0.25].map((laneOffsetTiles, spawnSequence) => (
        createGpuEnemySpawnIntent({
            definition: BASIC_CIRCLE_ENEMY_DATA,
            route,
            spawnSequence,
            laneOffsetTiles,
            waveId,
            policyId
        })
    ));
    const identities = Object.freeze([
        Object.freeze({ entityId: 7101, incarnation: 3 }),
        Object.freeze({ entityId: 7102, incarnation: 5 }),
        Object.freeze({ entityId: 7103, incarnation: 7 })
    ]);
    const pairForwardOffset = 3;
    const bodies = intents.map((intent, index) => ({
        ...intent,
        ...identities[index],
        position: index === 0
            ? { ...intent.position }
            : {
                x: intent.position.x,
                y: intent.position.y + pairForwardOffset
            },
        useFlow: true,
        flowFieldIndex: routeAtlas.firstFieldIndex
    }));
    const flowCellSizeX = typeof atlas.cellSize === 'number'
        ? atlas.cellSize
        : atlas.cellSize.x;
    const flowCellSizeY = typeof atlas.cellSize === 'number'
        ? atlas.cellSize
        : atlas.cellSize.y;
    const sampleColumn = Math.floor(
        (bodies[0].position.x - atlas.origin.x) / flowCellSizeX
    );
    const sampleRow = Math.floor(
        (bodies[0].position.y - atlas.origin.y) / flowCellSizeY
    );
    assert(
        sampleColumn >= 0
            && sampleColumn < atlas.cols
            && sampleRow >= 0
            && sampleRow < atlas.rows,
        `production enemy flow sample cell이 atlas 밖입니다: ${sampleColumn},${sampleRow}`
    );
    const sampleOffset = (
        (routeAtlas.firstFieldIndex * atlas.size)
        + (sampleRow * atlas.cols)
        + sampleColumn
    ) * 2;
    const sampledFlowDirection = Object.freeze({
        x: atlas.directions[sampleOffset],
        y: atlas.directions[sampleOffset + 1]
    });
    const sampledFlowMagnitude = Math.hypot(
        sampledFlowDirection.x,
        sampledFlowDirection.y
    );
    assert(
        sampledFlowMagnitude > 0,
        `production enemy entry의 실제 flow 방향이 0입니다: ${JSON.stringify(sampledFlowDirection)}`
    );
    const pairDistanceBefore = Math.hypot(
        bodies[1].position.x - bodies[2].position.x,
        bodies[1].position.y - bodies[2].position.y
    );
    const pairMinimumDistance = bodies[1].radius + bodies[2].radius;
    assert(
        pairDistanceBefore < pairMinimumDistance,
        `production enemy collision pair가 처음부터 겹치지 않습니다: ${pairDistanceBefore}`
    );
    const fixedDelta = 1 / 60;
    const findBody = (readbackBodies, handle, label) => {
        const body = readbackBodies.find((candidate) => (
            candidate.handle?.entityId === handle.entityId
            && candidate.handle?.incarnation === handle.incarnation
        ));
        assert(body, `${label} stable handle을 readback에서 찾지 못했습니다: ${JSON.stringify(handle)}`);
        return body;
    };

    try {
        assert(simulation.init(), 'production enemy adapter simulation init 실패');
        const spawnResult = simulation.spawnBodies(bodies);
        assert(
            spawnResult.accepted === bodies.length
                && spawnResult.rejected === 0
                && spawnResult.handles?.length === bodies.length,
            `production enemy adapter stable spawn 실패: ${JSON.stringify(spawnResult)}`
        );
        for (let index = 0; index < identities.length; index++) {
            assert(
                spawnResult.handles[index].entityId === identities[index].entityId
                    && spawnResult.handles[index].incarnation === identities[index].incarnation
                    && simulation.hasBody(identities[index]),
                `production enemy adapter spawn handle 불일치: index=${index}`
            );
        }
        assert(
            simulation.fixedUpdate(fixedDelta),
            `production enemy adapter fixed tick 제출 실패: ${JSON.stringify(simulation.getStatus())}`
        );
        const readbackPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const readbackBodies = await readbackPromise;
        assert(
            readbackBodies.length === bodies.length,
            `production enemy adapter readback body 수 불일치: ${readbackBodies.length}`
        );
        const flowProbe = findBody(readbackBodies, identities[0], 'flow probe');
        const pairA = findBody(readbackBodies, identities[1], 'collision pair A');
        const pairB = findBody(readbackBodies, identities[2], 'collision pair B');
        const flowVelocityDot = (
            (flowProbe.velocity.x * sampledFlowDirection.x)
            + (flowProbe.velocity.y * sampledFlowDirection.y)
        );
        const flowDisplacementDot = (
            ((flowProbe.position.x - bodies[0].position.x) * sampledFlowDirection.x)
            + ((flowProbe.position.y - bodies[0].position.y) * sampledFlowDirection.y)
        );
        assert(
            flowVelocityDot > 0 && flowDisplacementDot > 0,
            `production enemy flow가 sampled atlas 방향으로 진행하지 않았습니다: velocityDot=${flowVelocityDot}, displacementDot=${flowDisplacementDot}`
        );
        const pairDistanceAfter = Math.hypot(
            pairA.position.x - pairB.position.x,
            pairA.position.y - pairB.position.y
        );
        assert(
            pairDistanceAfter >= pairMinimumDistance - 0.001,
            `production enemy collision pair 해소가 부족합니다: before=${pairDistanceBefore}, after=${pairDistanceAfter}, minimum=${pairMinimumDistance}`
        );
        const completedStatus = await waitForSimulationStatus(
            simulation,
            (status) => status.overflow.pendingReadbacks === 0,
            'production enemy adapter overflow telemetry'
        );
        assert(
            completedStatus.state === 'ready'
                && completedStatus.failure === null
                && completedStatus.activeBodyCount === bodies.length
                && completedStatus.overflow.lastSmallCount === 0
                && completedStatus.overflow.lastBigCount === 0
                && completedStatus.overflow.totalSmallCount === 0
                && completedStatus.overflow.totalBigCount === 0,
            `production enemy adapter GPU 상태/overflow 불일치: ${JSON.stringify(completedStatus)}`
        );

        const cameraScale = 8;
        const camera = {
            worldToViewport(x, y, out) {
                out.x = x * cameraScale;
                out.y = y * cameraScale;
                return out;
            },
            getScale: () => cameraScale
        };
        simulation.updatePresentation({
            frameDelta: 1 / 120,
            fixedDelta,
            fixedAlpha: 1,
            renderFrameId: 101
        });
        lastFrameTexture = null;
        assert(simulation.draw(camera), 'production enemy adapter indirect draw 실패');
        assert(lastFrameTexture, 'production enemy adapter draw texture가 없습니다.');
        const bytesPerRow = 256;
        const readbackBuffer = device.createBuffer({
            label: 'production-enemy-adapter-render-readback',
            size: bytesPerRow * canvas.height,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        let nonTransparentPixelCount = 0;
        try {
            const encoder = device.createCommandEncoder({
                label: 'production-enemy-adapter-render-copy'
            });
            encoder.copyTextureToBuffer(
                { texture: lastFrameTexture },
                { buffer: readbackBuffer, bytesPerRow, rowsPerImage: canvas.height },
                [canvas.width, canvas.height]
            );
            device.queue.submit([encoder.finish()]);
            await readbackBuffer.mapAsync(GPUMapMode.READ);
            const pixels = new Uint8Array(readbackBuffer.getMappedRange());
            for (let y = 0; y < canvas.height; y++) {
                for (let x = 0; x < canvas.width; x++) {
                    if (pixels[(y * bytesPerRow) + (x * 4) + 3] !== 0) {
                        nonTransparentPixelCount++;
                    }
                }
            }
        } finally {
            try {
                readbackBuffer.unmap();
            } catch {
                // map 실패 또는 이미 unmap된 진단 buffer입니다.
            }
            readbackBuffer.destroy();
        }
        assert(
            drawMarks === 1 && nonTransparentPixelCount > 0,
            `production enemy adapter draw 결과가 비었습니다: drawMarks=${drawMarks}, pixels=${nonTransparentPixelCount}`
        );

        return {
            definitionId: BASIC_CIRCLE_ENEMY_DATA.id,
            route: {
                gateId: route.gateId,
                pathId: route.pathId,
                atlasContentKey: atlas.contentKey,
                fieldCount: atlas.fieldCount,
                firstFieldIndex: routeAtlas.firstFieldIndex
            },
            handles: spawnResult.handles,
            sampledFlow: {
                cell: { column: sampleColumn, row: sampleRow },
                direction: sampledFlowDirection,
                velocityDot: flowVelocityDot,
                displacementDot: flowDisplacementDot
            },
            collisionPair: {
                distanceBefore: pairDistanceBefore,
                distanceAfter: pairDistanceAfter,
                minimumDistance: pairMinimumDistance
            },
            overflow: completedStatus.overflow,
            render: {
                drawMarks,
                nonTransparentPixelCount
            }
        };
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
        context.unconfigure();
    }
}

async function runProductionEnemyShapePixelSmoke(device) {
    const context = canvas.getContext('webgpu');
    assert(context, 'production enemy shape canvas WebGPU context가 없습니다.');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format,
        alphaMode: 'premultiplied',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    let lastFrameTexture = null;
    let drawMarks = 0;
    const platformPort = {
        getState: () => 'ready',
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => 1,
        acquireFrameTarget() {
            const texture = context.getCurrentTexture();
            lastFrameTexture = texture;
            return {
                device,
                context,
                texture,
                view: texture.createView(),
                format,
                deviceGeneration: 1,
                width: canvas.width,
                height: canvas.height
            };
        },
        clearCanvas: () => false,
        markCanvasDrawn() {
            drawMarks++;
            return true;
        },
        markCanvasCleared: () => false
    };
    const cameraScale = 30;
    const definitions = Object.freeze([
        BASIC_SQUARE_ENEMY_DATA,
        BASIC_TRIANGLE_ENEMY_DATA,
        BASIC_ARROW_ENEMY_DATA,
        BASIC_PENTA_ENEMY_DATA,
        BASIC_HEXA_ENEMY_DATA,
        BASIC_GEN_ENEMY_DATA
    ]);
    const centers = Object.freeze([
        Object.freeze({ x: 10.5, y: 16.5 }),
        Object.freeze({ x: 31.5, y: 16.5 }),
        Object.freeze({ x: 52.5, y: 16.5 }),
        Object.freeze({ x: 10.5, y: 48.5 }),
        Object.freeze({ x: 31.5, y: 48.5 }),
        Object.freeze({ x: 52.5, y: 48.5 })
    ]);
    const route = Object.freeze({
        gateId: 'nw-shape-gate',
        pathId: 'nw-shape-path',
        waypoints: Object.freeze([
            Object.freeze({ x: 0, y: 0 }),
            Object.freeze({ x: 1, y: 0 })
        ])
    });
    const bodies = definitions.map((definition, index) => {
        const intent = createGpuEnemySpawnIntent({
            definition,
            route,
            spawnSequence: index,
            waveId: 'nw-production-enemy-shape-pixels',
            policyId: 'fixed-fixture'
        });
        return {
            ...intent,
            entityId: 7201 + index,
            incarnation: 1,
            position: {
                x: centers[index].x / cameraScale,
                y: centers[index].y / cameraScale
            },
            velocity: definition === BASIC_ARROW_ENEMY_DATA
                ? { x: 1, y: 0 }
                : { x: 0, y: 0 },
            collisionMask: 0
        };
    });
    const radiusPixels = BASIC_SQUARE_ENEMY_DATA.collisionRadiusTiles * cameraScale;
    const simulation = new GpuCircleBodySimulation(platformPort, {
        capacity: definitions.length,
        worldSize: {
            x: canvas.width / cameraScale,
            y: canvas.height / cameraScale
        },
        gridCellSize: { x: 1, y: 1 }
    });
    const camera = {
        worldToViewport(x, y, out) {
            out.x = x * cameraScale;
            out.y = y * cameraScale;
            return out;
        },
        getScale: () => cameraScale
    };

    try {
        assert(simulation.init(), 'production enemy shape simulation init 실패');
        const spawnResult = simulation.spawnBodies(bodies);
        assert(
            spawnResult.accepted === definitions.length
                && spawnResult.rejected === 0,
            `production enemy shape spawn 실패: ${JSON.stringify(spawnResult)}`
        );
        simulation.updatePresentation({
            frameDelta: 0,
            fixedDelta: 1 / 60,
            fixedAlpha: 0,
            renderFrameId: 102
        });
        assert(simulation.draw(camera), 'production enemy shape indirect draw 실패');
        assert(lastFrameTexture, 'production enemy shape draw texture가 없습니다.');

        const bytesPerRow = 256;
        const readbackBuffer = device.createBuffer({
            label: 'production-enemy-shape-render-readback',
            size: bytesPerRow * canvas.height,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        try {
            const encoder = device.createCommandEncoder({
                label: 'production-enemy-shape-render-copy'
            });
            encoder.copyTextureToBuffer(
                { texture: lastFrameTexture },
                { buffer: readbackBuffer, bytesPerRow, rowsPerImage: canvas.height },
                [canvas.width, canvas.height]
            );
            device.queue.submit([encoder.finish()]);
            await readbackBuffer.mapAsync(GPUMapMode.READ);
            const pixels = new Uint8Array(readbackBuffer.getMappedRange());
            const readAlpha = (x, y) => pixels[(y * bytesPerRow) + (x * 4) + 3];
            let outsideCircumcirclePixelCount = 0;
            for (let y = 0; y < canvas.height; y++) {
                for (let x = 0; x < canvas.width; x++) {
                    if (readAlpha(x, y) === 0) {
                        continue;
                    }
                    const pixelCenterX = x + 0.5;
                    const pixelCenterY = y + 0.5;
                    const insideAnyCircumcircle = centers.some((center) => (
                        Math.hypot(
                            pixelCenterX - center.x,
                            pixelCenterY - center.y
                        ) <= radiusPixels + 0.01
                    ));
                    if (!insideAnyCircumcircle) {
                        outsideCircumcirclePixelCount++;
                    }
                }
            }
            assert(
                outsideCircumcirclePixelCount === 0,
                `enemy shape가 collider circumcircle 밖에 alpha를 만들었습니다: ${outsideCircumcirclePixelCount}`
            );

            const maskRadius = Math.ceil(radiusPixels) + 1;
            const masks = definitions.map((definition, index) => {
                const centerPixelX = Math.floor(centers[index].x);
                const centerPixelY = Math.floor(centers[index].y);
                let opaquePixelCount = 0;
                let hash = 2166136261;
                for (let offsetY = -maskRadius; offsetY <= maskRadius; offsetY++) {
                    for (let offsetX = -maskRadius; offsetX <= maskRadius; offsetX++) {
                        const opaque = readAlpha(
                            centerPixelX + offsetX,
                            centerPixelY + offsetY
                        ) >= 128;
                        opaquePixelCount += opaque ? 1 : 0;
                        hash ^= opaque ? 1 : 0;
                        hash = Math.imul(hash, 16777619);
                    }
                }
                assert(
                    opaquePixelCount > 0,
                    `${definition.shapeType} silhouette가 비었습니다.`
                );
                return Object.freeze({
                    shapeType: definition.shapeType,
                    opaquePixelCount,
                    maskHash: (hash >>> 0).toString(16).padStart(8, '0')
                });
            });
            assert(
                new Set(masks.map(({ maskHash }) => maskHash)).size === definitions.length,
                `enemy shape silhouette mask가 서로 다르지 않습니다: ${JSON.stringify(masks)}`
            );

            const arrowCenter = centers[2];
            const arrowSampleOffset = 7;
            const arrowForwardAlpha = readAlpha(
                Math.floor(arrowCenter.x) + arrowSampleOffset,
                Math.floor(arrowCenter.y)
            );
            const arrowBackwardAlpha = readAlpha(
                Math.floor(arrowCenter.x) - arrowSampleOffset,
                Math.floor(arrowCenter.y)
            );
            assert(
                arrowForwardAlpha >= 128 && arrowBackwardAlpha === 0,
                `arrow velocity 방향 silhouette가 반대입니다: forward=${arrowForwardAlpha}, backward=${arrowBackwardAlpha}`
            );

            const generatorCenter = centers[5];
            const generatorRingOffset = Object.freeze({ x: 5, y: 0 });
            const generatorTerminalOffset = Object.freeze({ x: -7, y: -7 });
            const generatorTerminalGapOffset = Object.freeze({ x: -7, y: -5 });
            const generatorCenterAlpha = readAlpha(
                Math.floor(generatorCenter.x),
                Math.floor(generatorCenter.y)
            );
            const generatorRingAlpha = readAlpha(
                Math.floor(generatorCenter.x) + generatorRingOffset.x,
                Math.floor(generatorCenter.y) + generatorRingOffset.y
            );
            const generatorTerminalAlpha = readAlpha(
                Math.floor(generatorCenter.x) + generatorTerminalOffset.x,
                Math.floor(generatorCenter.y) + generatorTerminalOffset.y
            );
            const generatorTerminalGapAlpha = readAlpha(
                Math.floor(generatorCenter.x) + generatorTerminalGapOffset.x,
                Math.floor(generatorCenter.y) + generatorTerminalGapOffset.y
            );
            assert(
                generatorCenterAlpha < 16
                    && generatorRingAlpha >= 128
                    && generatorTerminalAlpha >= 128
                    && generatorTerminalGapAlpha < 16,
                `generator square hole/ring/terminal topology가 잘못됐습니다: center=${generatorCenterAlpha}, ring=${generatorRingAlpha}, terminal=${generatorTerminalAlpha}, terminalGap=${generatorTerminalGapAlpha}`
            );
            assert(drawMarks === 1, `production enemy shape draw mark 불일치: ${drawMarks}`);

            return {
                radiusPixels,
                drawMarks,
                outsideCircumcirclePixelCount,
                masks,
                arrow: {
                    sampleOffset: arrowSampleOffset,
                    forwardAlpha: arrowForwardAlpha,
                    backwardAlpha: arrowBackwardAlpha
                },
                generator: {
                    ringOffset: generatorRingOffset,
                    terminalOffset: generatorTerminalOffset,
                    terminalGapOffset: generatorTerminalGapOffset,
                    centerAlpha: generatorCenterAlpha,
                    ringAlpha: generatorRingAlpha,
                    terminalAlpha: generatorTerminalAlpha,
                    terminalGapAlpha: generatorTerminalGapAlpha
                }
            };
        } finally {
            try {
                readbackBuffer.unmap();
            } catch {
                // map 실패 또는 이미 unmap된 진단 buffer입니다.
            }
            readbackBuffer.destroy();
        }
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
        context.unconfigure();
    }
}

async function runProductionMixedBodyContactEventSmoke(device) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    const platformPort = {
        getState: () => 'ready',
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => 1,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    };
    const simulation = new GpuCircleBodySimulation(platformPort, {
        capacity: 4,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 2, y: 2 },
        sdf: {
            cols: 4,
            rows: 4,
            values: new Float32Array(16).fill(100)
        }
    });
    const fixedDelta = 1 / 60;
    const sourceTick = 37;
    const enemyHandle = Object.freeze({ entityId: 8101, incarnation: 3 });
    const projectileHandle = Object.freeze({ entityId: 8102, incarnation: 5 });
    const enemy = {
        ...enemyHandle,
        position: { x: 4, y: 4 },
        velocity: { x: 0, y: 0 },
        radius: 0.25,
        inverseMass: 1,
        layerMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        collisionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN,
        sensorMask: 0,
        health: 0.57,
        lifetime: -1,
        alive: true
    };
    const projectile = {
        ...projectileHandle,
        position: { x: 3.25, y: 4 },
        velocity: { x: 24, y: 0 },
        radius: 0.2,
        inverseMass: 1,
        layerMask: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
        collisionMask: 0,
        sensorMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN,
        health: 0.29,
        lifetime: 2,
        contactHandler: {
            damageSelf: 0.29,
            damageOther: 0.57,
            flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY
        },
        alive: true
    };
    const minimumDistance = enemy.radius + projectile.radius;
    const distanceBefore = Math.hypot(
        enemy.position.x - projectile.position.x,
        enemy.position.y - projectile.position.y
    );
    const predictedProjectilePosition = Object.freeze({
        x: projectile.position.x + (projectile.velocity.x * fixedDelta),
        y: projectile.position.y + (projectile.velocity.y * fixedDelta)
    });
    const predictedDistance = Math.hypot(
        enemy.position.x - predictedProjectilePosition.x,
        enemy.position.y - predictedProjectilePosition.y
    );
    assert(
        distanceBefore > minimumDistance && predictedDistance < minimumDistance,
        `mixed-body contact fixture가 새 overlap을 만들지 않습니다: before=${distanceBefore}, predicted=${predictedDistance}, minimum=${minimumDistance}`
    );

    try {
        assert(simulation.init(), 'mixed-body contact/event simulation init 실패');
        const replaceResult = simulation.replaceBodies([enemy, projectile]);
        assert(
            replaceResult.accepted === 2
                && replaceResult.rejected === 0
                && replaceResult.capacity === 4,
            `mixed-body contact/event body 교체 실패: ${JSON.stringify(replaceResult)}`
        );
        const beforeTickStatus = simulation.getStatus();
        assert(
            beforeTickStatus.events.eventProducingBodyCount === 1,
            `mixed-body event-producing body 수 불일치: ${JSON.stringify(beforeTickStatus.events)}`
        );
        assert(
            simulation.fixedUpdate(fixedDelta, sourceTick),
            `mixed-body contact/event fixed tick 제출 실패: ${JSON.stringify(simulation.getStatus())}`
        );
        const aliveBodiesPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const aliveBodies = await aliveBodiesPromise;
        assert(
            aliveBodies.length === 0,
            `contact damage 뒤 GPU ALIVE body가 남았습니다: ${JSON.stringify(aliveBodies)}`
        );

        const completedStatus = await waitForSimulationStatus(
            simulation,
            (status) => status.events.pendingReadbacks === 0
                && status.events.queuedBatches >= 1
                && status.events.completedThroughTick >= sourceTick,
            'mixed-body contact/event readback completion'
        );
        const batches = simulation.drainCompletedEventBatches([]);
        assert(
            batches.length === 1,
            `mixed-body 완료 event batch 수 불일치: ${JSON.stringify(batches)}`
        );
        const [batch] = batches;
        assert(
            batch.sourceTick === sourceTick
                && batch.submittedTick === 1
                && batch.completedThroughTick === sourceTick
                && batch.deviceGeneration === 1,
            `mixed-body event tick/watermark 불일치: ${JSON.stringify(batch)}`
        );
        const contactEvents = batch.events.filter(({ type }) => type === 'contact');
        const deathEvents = batch.events.filter(({ type }) => type === 'death');
        const appliedContact = contactEvents.find((event) => (
            event.entityId === projectileHandle.entityId
            && event.incarnation === projectileHandle.incarnation
            && event.otherEntityId === enemyHandle.entityId
            && event.otherIncarnation === enemyHandle.incarnation
        ));
        assert(
            contactEvents.length >= 1 && appliedContact,
            `projectile→enemy applied contact가 없습니다: ${JSON.stringify(contactEvents)}`
        );
        assert(
            appliedContact.damageFixedPoint === 57,
            `applied contact damage 단위가 다릅니다: ${JSON.stringify(appliedContact)}`
        );
        assertNear(
            appliedContact.damage,
            0.57,
            0.000001,
            'applied contact fractional damage가 다릅니다'
        );
        const expectedDeathKeys = new Set([
            `${enemyHandle.entityId}:${enemyHandle.incarnation}`,
            `${projectileHandle.entityId}:${projectileHandle.incarnation}`
        ]);
        const deathKeys = new Set(deathEvents.map((event) => (
            `${event.entityId}:${event.incarnation}`
        )));
        assert(
            deathEvents.length === 2
                && deathKeys.size === expectedDeathKeys.size
                && [...expectedDeathKeys].every((key) => deathKeys.has(key)),
            `mixed-body death identity 불일치: ${JSON.stringify(deathEvents)}`
        );
        assert(
            completedStatus.contact.lastCount >= 1
                && completedStatus.contact.lastOverflowCount === 0
                && completedStatus.events.lastAppliedCount >= 1
                && completedStatus.events.lastAppliedOverflowCount === 0
                && completedStatus.events.lastDeathCount === 2
                && completedStatus.events.lastDeathOverflowCount === 0
                && completedStatus.events.lastSubmittedTick === 1
                && completedStatus.events.lastCompletedTick === 1
                && completedStatus.events.completedThroughTick === sourceTick,
            `mixed-body contact/event telemetry 불일치: ${JSON.stringify(completedStatus)}`
        );

        return {
            fixedDelta,
            sourceTick,
            fixture: {
                distanceBefore,
                predictedDistance,
                minimumDistance,
                predictedProjectilePosition,
                authored: {
                    enemyHealth: enemy.health,
                    projectileHealth: projectile.health,
                    projectileDamageSelf: projectile.contactHandler.damageSelf,
                    projectileDamageOther: projectile.contactHandler.damageOther
                },
                expectedAppliedDamageFixedPoint: 57
            },
            aliveBodyCountAfterTick: aliveBodies.length,
            batch: {
                sourceTick: batch.sourceTick,
                submittedTick: batch.submittedTick,
                completedThroughTick: batch.completedThroughTick,
                deviceGeneration: batch.deviceGeneration
            },
            appliedContact,
            deaths: deathEvents,
            contact: completedStatus.contact,
            events: completedStatus.events
        };
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionBenchmarkEndpointSmoke(device) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    const platformState = Object.freeze({
        ready: true,
        status: 'ready',
        deviceGeneration: 1
    });
    const platformPort = {
        getState: () => platformState,
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => platformState.deviceGeneration,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    };
    const navigationSource = createGpuBenchmarkNavigationSource();
    const endpoint = createGpuEnemySimulationEndpoint({
        webGpuPlatformPort: platformPort
    }, {
        capacity: 256
    });
    const endpointIdentity = endpoint;
    const registryIdentity = endpoint.getRegistry();
    const backendIdentity = endpoint.getBackend();
    let fixedTick = 0;
    const gameObjectSystem = Object.freeze({
        getEnemySpawnRoutes: () => navigationSource.getSpawnRoutes()
    });
    const gameSystem = Object.freeze({
        getFixedTick: () => fixedTick,
        getObjectSystem: () => gameObjectSystem
    });
    const gameScene = Object.freeze({
        getGameSystem: () => gameSystem,
        getNextGpuLifecycleFixedTick: () => fixedTick + 1,
        getGpuSimulationEndpoint: () => endpoint,
        getEnemySimulationEndpoint: () => endpoint
    });
    const fixedDelta = 1 / 60;
    const requestedCount = 100;
    // overflow telemetry는 tick 1 이후 4-tick 간격이므로 tick 5까지 제출해
    // 첫 세 tick뿐 아니라 후속 sticky overflow도 실제 readback으로 확인합니다.
    const fixedTickTarget = 5;

    try {
        assert(
            endpoint.init(navigationSource) === false,
            'GPU benchmark endpoint는 첫 spawn 전 deferred 상태여야 합니다.'
        );
        const initializedStatus = endpoint.getStatus();
        assert(
            initializedStatus.state === 'gpu-deferred'
                && initializedStatus.initialized
                && initializedStatus.activeCount === 0
                && initializedStatus.pendingCommandCount === 0
                && !initializedStatus.recoveryRequired,
            `GPU benchmark endpoint 초기 상태 불일치: ${JSON.stringify(initializedStatus)}`
        );

        const batchResult = requestGpuBenchmarkEnemyBatch({
            gameScene,
            count: requestedCount,
            sessionGeneration: 1,
            batchSequence: 0,
            spawnSequence: 0
        });
        assert(
            batchResult.accepted
                && batchResult.requestedCount === requestedCount
                && batchResult.queuedCount === requestedCount
                && batchResult.targetFixedTick === 1
                && batchResult.nextSpawnSequence === requestedCount,
            `GPU benchmark batch 예약 실패: ${JSON.stringify(batchResult)}`
        );
        const queuedStatus = endpoint.getStatus();
        assert(
            queuedStatus.activeCount === 0
                && queuedStatus.reservedCount === 0
                && queuedStatus.pendingCommandCount === requestedCount
                && !queuedStatus.recoveryRequired,
            `GPU benchmark batch next-fixed 대기 상태 불일치: ${JSON.stringify(queuedStatus)}`
        );

        const commitSummaries = [];
        for (let tick = 1; tick <= fixedTickTarget; tick++) {
            const commit = endpoint.commitAtFixedBoundary(tick);
            assert(
                commit.state === 'committed'
                    && !commit.recoveryRequired
                    && commit.rejected.length === 0
                    && commit.spawned.length === (tick === 1 ? requestedCount : 0),
                `GPU benchmark endpoint lifecycle commit 실패: tick=${tick}, result=${JSON.stringify(commit)}`
            );
            assert(
                endpoint.fixedUpdate(fixedDelta),
                `GPU benchmark endpoint fixed tick 제출 실패: tick=${tick}, status=${JSON.stringify(endpoint.getStatus())}`
            );
            fixedTick = tick;
            commitSummaries.push(Object.freeze({
                fixedTick: tick,
                spawnedCount: commit.spawned.length,
                rejectedCount: commit.rejected.length,
                state: commit.state
            }));
        }

        const simulation = endpoint.getBackend().simulation;
        assert(
            simulation && typeof simulation.readbackBodies === 'function',
            'GPU benchmark endpoint 진단용 simulation readback 경계가 없습니다.'
        );
        const bodiesPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const bodies = await bodiesPromise;
        const gpuStatus = await waitForSimulationStatus(
            simulation,
            (status) => status.submittedTickCount >= fixedTickTarget
                && status.overflow.pendingReadbacks === 0,
            'GPU benchmark endpoint multi-tick overflow telemetry'
        );
        const endpointStatus = endpoint.getStatus();
        assert(
            endpoint === endpointIdentity
                && endpoint.getRegistry() === registryIdentity
                && endpoint.getBackend() === backendIdentity,
            'GPU benchmark endpoint session identity가 fixed tick 중 교체되었습니다.'
        );
        assert(
            endpointStatus.state === 'gpu-ready'
                && endpointStatus.initialized
                && !endpointStatus.destroyed
                && endpointStatus.activeCount === requestedCount
                && endpointStatus.reservedCount === 0
                && endpointStatus.pendingCommandCount === 0
                && !endpointStatus.recoveryRequired
                && endpoint.hasActiveBodies()
                && !endpoint.requiresRecovery(),
            `GPU benchmark endpoint session 상태 불일치: ${JSON.stringify(endpointStatus)}`
        );
        assert(
            gpuStatus.state === 'ready'
                && gpuStatus.failure === null
                && gpuStatus.bodyCount === requestedCount
                && gpuStatus.activeBodyCount === requestedCount
                && gpuStatus.submittedTickCount === fixedTickTarget
                && gpuStatus.hasGpuAuthoritativeState
                && !gpuStatus.requiresAuthoritativeRebuild
                && gpuStatus.overflow.lastSmallCount === 0
                && gpuStatus.overflow.lastBigCount === 0
                && gpuStatus.overflow.totalSmallCount === 0
                && gpuStatus.overflow.totalBigCount === 0,
            `GPU benchmark endpoint overflow/recovery 상태 불일치: ${JSON.stringify(gpuStatus)}`
        );
        assert(
            bodies.length === requestedCount,
            `GPU benchmark endpoint readback body 수 불일치: ${bodies.length}`
        );

        const bounds = navigationSource.getWorldBounds();
        const handleKeys = new Set();
        const observedBounds = {
            minX: Number.POSITIVE_INFINITY,
            minY: Number.POSITIVE_INFINITY,
            maxX: Number.NEGATIVE_INFINITY,
            maxY: Number.NEGATIVE_INFINITY
        };
        const assertFiniteVector = (value, label, index) => {
            assert(
                Number.isFinite(value?.x) && Number.isFinite(value?.y),
                `GPU benchmark ${label}가 finite가 아닙니다: index=${index}, value=${JSON.stringify(value)}`
            );
        };
        const assertInsideWorld = (value, label, index) => {
            assert(
                value.x >= bounds.minX
                    && value.x < bounds.maxX
                    && value.y >= bounds.minY
                    && value.y < bounds.maxY,
                `GPU benchmark ${label}가 world 밖입니다: index=${index}, value=${JSON.stringify(value)}`
            );
        };
        for (let index = 0; index < bodies.length; index++) {
            const body = bodies[index];
            assertFiniteVector(body.position, 'position', index);
            assertFiniteVector(body.previousPosition, 'previousPosition', index);
            assertFiniteVector(body.predictedPosition, 'predictedPosition', index);
            assertFiniteVector(body.velocity, 'velocity', index);
            assertFiniteVector(body.positionDelta, 'positionDelta', index);
            assertInsideWorld(body.position, 'position', index);
            assertInsideWorld(body.previousPosition, 'previousPosition', index);
            assertInsideWorld(body.predictedPosition, 'predictedPosition', index);
            assert(
                Number.isFinite(body.radius)
                    && body.radius > 0
                    && Number.isFinite(body.inverseMass)
                    && body.inverseMass > 0
                    && Number.isSafeInteger(body.flowFieldIndex)
                    && Number.isSafeInteger(body.previousFlowFieldIndex),
                `GPU benchmark body scalar 상태가 유효하지 않습니다: index=${index}, body=${JSON.stringify(body)}`
            );
            const handle = body.handle;
            assert(
                Number.isSafeInteger(handle?.entityId)
                    && Number.isSafeInteger(handle?.incarnation),
                `GPU benchmark body handle이 유효하지 않습니다: index=${index}`
            );
            handleKeys.add(`${handle.entityId}:${handle.incarnation}`);
            observedBounds.minX = Math.min(observedBounds.minX, body.position.x);
            observedBounds.minY = Math.min(observedBounds.minY, body.position.y);
            observedBounds.maxX = Math.max(observedBounds.maxX, body.position.x);
            observedBounds.maxY = Math.max(observedBounds.maxY, body.position.y);
        }
        assert(
            handleKeys.size === requestedCount,
            `GPU benchmark stable handle 중복이 있습니다: unique=${handleKeys.size}`
        );

        return {
            arenaId: navigationSource.mapId,
            routeCount: navigationSource.getSpawnRoutes().length,
            requestedCount,
            batch: batchResult,
            fixedTickCount: fixedTick,
            commitSummaries,
            sessionPreserved: true,
            status: {
                state: endpointStatus.state,
                activeCount: endpointStatus.activeCount,
                reservedCount: endpointStatus.reservedCount,
                pendingCommandCount: endpointStatus.pendingCommandCount,
                recoveryRequired: endpointStatus.recoveryRequired,
                backendState: endpointStatus.backend.state,
                submittedTickCount: gpuStatus.submittedTickCount,
                overflow: gpuStatus.overflow
            },
            readback: {
                bodyCount: bodies.length,
                uniqueHandleCount: handleKeys.size,
                allFiniteAndInsideWorld: true,
                observedBounds
            }
        };
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionEndpointDeathLifecycleSmoke(device) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    const platformState = Object.freeze({
        ready: true,
        status: 'ready',
        deviceGeneration: 1
    });
    const platformPort = {
        getState: () => platformState,
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => platformState.deviceGeneration,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    };
    const navigationSource = createGpuBenchmarkNavigationSource();
    const endpoint = createGpuEnemySimulationEndpoint({
        webGpuPlatformPort: platformPort
    }, {
        capacity: 4
    });
    const fixedDelta = 1 / 60;
    const sourceTick = 1;
    const spawnFixedTick = 1;
    const deathCommitFixedTick = 2;
    const enemyCommandId = 'nw-contact-lifecycle-enemy';
    const projectileCommandId = 'nw-contact-lifecycle-projectile';
    const route = navigationSource.getSpawnRoutes()[0];
    const baseEnemyIntent = createGpuEnemySpawnIntent({
        definition: BASIC_CIRCLE_ENEMY_DATA,
        route,
        spawnSequence: 0,
        waveId: 'nw-contact-lifecycle',
        policyId: 'fixed-fixture'
    });
    const enemyIntent = Object.freeze({
        ...baseEnemyIntent,
        position: Object.freeze({ x: 32, y: 10 }),
        velocity: Object.freeze({ x: 0, y: 0 }),
        health: 1,
        lifetime: -1
    });
    const projectileIntent = createGpuProjectileSpawnIntent({
        definition: Object.freeze({
            id: 'nw_contact_projectile_01',
            collisionRadius: 0.2,
            inverseMass: 1,
            damage: 1,
            damageSelf: 1,
            penetration: 1,
            lifetimeSeconds: 2,
            closestOnly: true,
            killOnTerrain: true
        }),
        // main enemy collider가 절반으로 줄어도 fixed tick 안에서 새 overlap을 만듭니다.
        position: { x: 31.4, y: 10 },
        velocity: { x: 24, y: 0 },
        spawnSequence: 1
    });
    const minimumDistance = enemyIntent.radius + projectileIntent.radius;
    const distanceBefore = Math.hypot(
        enemyIntent.position.x - projectileIntent.position.x,
        enemyIntent.position.y - projectileIntent.position.y
    );
    const projectilePredictedX = projectileIntent.position.x
        + (projectileIntent.velocity.x * fixedDelta);
    assert(
        distanceBefore > minimumDistance
            && Math.abs(enemyIntent.position.x - projectilePredictedX) < minimumDistance,
        `endpoint death lifecycle fixture가 새 overlap을 만들지 않습니다: before=${distanceBefore}, predictedX=${projectilePredictedX}, minimum=${minimumDistance}`
    );

    try {
        assert(
            endpoint.init(navigationSource) === false,
            'endpoint death lifecycle은 첫 spawn 전 deferred 상태여야 합니다.'
        );
        const enemyRequest = endpoint.requestSpawn(
            enemyIntent,
            spawnFixedTick,
            enemyCommandId
        );
        const projectileRequest = endpoint.requestSpawn(
            projectileIntent,
            spawnFixedTick,
            projectileCommandId
        );
        assert(
            enemyRequest.accepted && projectileRequest.accepted,
            `endpoint mixed-body spawn 예약 실패: enemy=${JSON.stringify(enemyRequest)}, projectile=${JSON.stringify(projectileRequest)}`
        );
        const spawnCommit = endpoint.commitAtFixedBoundary(spawnFixedTick);
        assert(
            spawnCommit.state === 'committed'
                && spawnCommit.spawned.length === 2
                && spawnCommit.rejected.length === 0,
            `endpoint mixed-body spawn commit 실패: ${JSON.stringify(spawnCommit)}`
        );
        const enemyHandle = spawnCommit.spawned.find(
            ({ commandId }) => commandId === enemyCommandId
        )?.handle;
        const projectileHandle = spawnCommit.spawned.find(
            ({ commandId }) => commandId === projectileCommandId
        )?.handle;
        assert(
            enemyHandle && projectileHandle,
            `endpoint mixed-body handle을 찾지 못했습니다: ${JSON.stringify(spawnCommit.spawned)}`
        );
        const spawnedStatus = endpoint.getStatus();
        assert(
            spawnedStatus.activeCount === 2
                && spawnedStatus.activeEnemyCount === 1
                && spawnedStatus.activeProjectileCount === 1
                && spawnedStatus.pendingCommandCount === 0,
            `endpoint mixed-body registry kind count 불일치: ${JSON.stringify(spawnedStatus)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, sourceTick),
            `endpoint mixed-body fixed tick 제출 실패: ${JSON.stringify(endpoint.getStatus())}`
        );
        const simulation = endpoint.getBackend().simulation;
        assert(
            simulation && typeof simulation.readbackBodies === 'function',
            'endpoint death lifecycle 진단용 simulation readback 경계가 없습니다.'
        );
        const aliveBodiesPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const aliveBodies = await aliveBodiesPromise;
        assert(
            aliveBodies.length === 0,
            `endpoint contact 뒤 GPU ALIVE body가 남았습니다: ${JSON.stringify(aliveBodies)}`
        );
        const completedGpuStatus = await waitForSimulationStatus(
            simulation,
            (status) => status.events.pendingReadbacks === 0
                && status.events.queuedBatches >= 1
                && status.events.completedThroughTick >= sourceTick,
            'endpoint death lifecycle event completion'
        );
        assert(
            completedGpuStatus.events.completedThroughTick === sourceTick,
            `endpoint GPU gameplay watermark 불일치: ${JSON.stringify(completedGpuStatus.events)}`
        );

        const completedEvents = endpoint.commitCompletedEventsAtFixedBoundary(
            deathCommitFixedTick
        );
        const deathEvents = completedEvents.deathEvents;
        const expectedDeathKeys = new Set([
            `${enemyHandle.entityId}:${enemyHandle.incarnation}`,
            `${projectileHandle.entityId}:${projectileHandle.incarnation}`
        ]);
        const observedDeathKeys = new Set(deathEvents.map((event) => (
            `${event.entityId}:${event.incarnation}`
        )));
        assert(
            completedEvents.batchCount === 1
                && completedEvents.completedThroughTick === sourceTick
                && completedEvents.contactEvents.length >= 1
                && deathEvents.length === 2
                && observedDeathKeys.size === expectedDeathKeys.size
                && [...expectedDeathKeys].every((key) => observedDeathKeys.has(key))
                && deathEvents.every(({ disposition }) => disposition === 'despawn-requested'),
            `endpoint 완료 event snapshot 불일치: ${JSON.stringify(completedEvents)}`
        );
        const scheduledStatus = endpoint.getStatus();
        assert(
            scheduledStatus.activeCount === 2
                && scheduledStatus.activeEnemyCount === 1
                && scheduledStatus.activeProjectileCount === 1
                && scheduledStatus.pendingCommandCount === 2
                && scheduledStatus.events.applied >= 1
                && scheduledStatus.events.death === 2
                && endpoint.getRegistry().has(enemyHandle)
                && endpoint.getRegistry().has(projectileHandle)
                && endpoint.hasBody(enemyHandle)
                && endpoint.hasBody(projectileHandle),
            `GPU death는 예약만 하고 fixed commit 전 registry를 보존해야 합니다: ${JSON.stringify(scheduledStatus)}`
        );

        const deathCommit = endpoint.commitAtFixedBoundary(deathCommitFixedTick);
        assert(
            deathCommit.state === 'committed'
                && deathCommit.despawned.length === 2
                && deathCommit.rejected.length === 0,
            `endpoint GPU death despawn commit 실패: ${JSON.stringify(deathCommit)}`
        );
        const reclaimedStatus = endpoint.getStatus();
        assert(
            reclaimedStatus.activeCount === 0
                && reclaimedStatus.activeEnemyCount === 0
                && reclaimedStatus.activeProjectileCount === 0
                && reclaimedStatus.pendingCommandCount === 0
                && !endpoint.getRegistry().has(enemyHandle)
                && !endpoint.getRegistry().has(projectileHandle)
                && !endpoint.hasBody(enemyHandle)
                && !endpoint.hasBody(projectileHandle),
            `endpoint death fixed commit 뒤 registry kind count가 회수되지 않았습니다: ${JSON.stringify(reclaimedStatus)}`
        );

        return {
            fixedDelta,
            sourceTick,
            spawnFixedTick,
            deathCommitFixedTick,
            handles: {
                enemy: enemyHandle,
                projectile: projectileHandle
            },
            fixture: {
                distanceBefore,
                minimumDistance,
                projectilePredictedX
            },
            aliveBodyCountAfterTick: aliveBodies.length,
            completedEvents,
            scheduled: {
                activeCount: scheduledStatus.activeCount,
                activeEnemyCount: scheduledStatus.activeEnemyCount,
                activeProjectileCount: scheduledStatus.activeProjectileCount,
                pendingCommandCount: scheduledStatus.pendingCommandCount
            },
            deathCommit,
            reclaimed: {
                activeCount: reclaimedStatus.activeCount,
                activeEnemyCount: reclaimedStatus.activeEnemyCount,
                activeProjectileCount: reclaimedStatus.activeProjectileCount,
                pendingCommandCount: reclaimedStatus.pendingCommandCount
            }
        };
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionStableSlotLifecycleSmoke(device) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    let lifecycleDeviceGeneration = 1;
    const platformPort = {
        getState: () => 'ready',
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => lifecycleDeviceGeneration,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    };
    const simulation = new GpuCircleBodySimulation(platformPort, {
        capacity: 3,
        worldSize: { x: 16, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    const fixedDelta = 1 / 60;
    const initialBodies = [
        {
            entityId: 1001,
            incarnation: 3,
            position: { x: 2, y: 2 },
            velocity: { x: 0, y: 0 },
            radius: 0.2,
            inverseMass: 1,
            layerMask: 1,
            collisionMask: 0,
            alive: true
        },
        {
            entityId: 1002,
            incarnation: 7,
            position: { x: 6, y: 4 },
            velocity: { x: 2, y: 0 },
            radius: 0.2,
            inverseMass: 1,
            layerMask: 1,
            collisionMask: 0,
            alive: true
        }
    ];
    const cSpawn = {
        entityId: 1003,
        incarnation: 11,
        position: { x: 10, y: 6 },
        velocity: { x: 0, y: 0 },
        radius: 0.2,
        inverseMass: 1,
        layerMask: 1,
        collisionMask: 0,
        alive: true
    };
    const dSpawn = {
        entityId: 1004,
        incarnation: 17,
        position: { x: 12, y: 3 },
        velocity: { x: 1.5, y: 0 },
        radius: 0.2,
        inverseMass: 1,
        layerMask: 1,
        collisionMask: 0,
        alive: true
    };
    const matchesHandle = (body, handle) => (
        body?.entityId === handle.entityId
        && body?.incarnation === handle.incarnation
        && body?.handle?.entityId === handle.entityId
        && body?.handle?.incarnation === handle.incarnation
    );
    const findBody = (bodies, handle, label) => {
        const body = bodies.find((candidate) => matchesHandle(candidate, handle));
        assert(body, `${label} readback handle을 찾지 못했습니다: ${JSON.stringify(handle)}`);
        return body;
    };
    const compactStatus = (status) => ({
        state: status.state,
        bodyCount: status.bodyCount,
        activeBodyCount: status.activeBodyCount,
        freeSlotCount: status.freeSlotCount,
        submittedTickCount: status.submittedTickCount,
        deviceGeneration: status.deviceGeneration,
        hasGpuAuthoritativeState: status.hasGpuAuthoritativeState,
        authoritativeEpoch: status.authoritativeEpoch,
        requiresAuthoritativeRebuild: status.requiresAuthoritativeRebuild
    });

    try {
        assert(simulation.init(), 'stable-slot production GPU circle simulation init 실패');
        const spawnAB = simulation.spawnBodies(initialBodies);
        assert(
            spawnAB.accepted === 2
                && spawnAB.rejected === 0
                && spawnAB.capacity === 3
                && spawnAB.handles?.length === 2,
            `A/B incremental spawn 실패: ${JSON.stringify(spawnAB)}`
        );
        const [handleA, handleB] = spawnAB.handles;
        assert(
            handleA.entityId === initialBodies[0].entityId
                && handleA.incarnation === initialBodies[0].incarnation
                && handleB.entityId === initialBodies[1].entityId
                && handleB.incarnation === initialBodies[1].incarnation,
            `spawn 반환 handle 불일치: ${JSON.stringify(spawnAB.handles)}`
        );
        const spawnedStatus = simulation.getStatus();
        assert(
            spawnedStatus.bodyCount === 2
                && spawnedStatus.activeBodyCount === 2
                && spawnedStatus.freeSlotCount === 0
                && Number.isSafeInteger(spawnedStatus.authoritativeEpoch)
                && spawnedStatus.authoritativeEpoch > 0,
            `A/B spawn 후 stable-slot 상태 불일치: ${JSON.stringify(spawnedStatus)}`
        );
        const initialAuthoritativeEpoch = spawnedStatus.authoritativeEpoch;

        assert(simulation.fixedUpdate(fixedDelta), 'stable-slot fixed tick 제출 실패');
        const advancedBodiesPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const advancedBodies = await advancedBodiesPromise;
        assert(advancedBodies.length === 2, `A/B readback body 수 불일치: ${advancedBodies.length}`);
        const advancedA = findBody(advancedBodies, handleA, 'A');
        const advancedB = findBody(advancedBodies, handleB, 'B');
        assert(
            advancedB.position.x > initialBodies[1].position.x,
            `fixed tick 뒤 B가 전진하지 않았습니다: ${JSON.stringify(advancedB)}`
        );

        const despawnA = simulation.despawnBodies([handleA]);
        assert(
            despawnA.removed === 1
                && despawnA.rejected === 0
                && despawnA.capacity === 3,
            `A despawn 실패: ${JSON.stringify(despawnA)}`
        );
        assert(!simulation.hasBody(handleA), 'A despawn 뒤 handle이 남았습니다.');
        assert(simulation.hasBody(handleB), 'A despawn이 B handle까지 제거했습니다.');
        const despawnedStatus = simulation.getStatus();
        assert(
            despawnedStatus.bodyCount === 2
                && despawnedStatus.activeBodyCount === 1
                && despawnedStatus.freeSlotCount === 1
                && despawnedStatus.authoritativeEpoch === initialAuthoritativeEpoch,
            `A despawn 후 stable-slot 상태 불일치: ${JSON.stringify(despawnedStatus)}`
        );

        const spawnC = simulation.spawnBodies([cSpawn]);
        assert(
            spawnC.accepted === 1
                && spawnC.rejected === 0
                && spawnC.capacity === 3
                && spawnC.handles?.length === 1,
            `C incremental spawn 실패: ${JSON.stringify(spawnC)}`
        );
        const [handleC] = spawnC.handles;
        assert(
            handleC.entityId === cSpawn.entityId
                && handleC.incarnation === cSpawn.incarnation,
            `C spawn 반환 handle 불일치: ${JSON.stringify(handleC)}`
        );
        const reusedStatus = simulation.getStatus();
        assert(
            reusedStatus.bodyCount === 2
                && reusedStatus.activeBodyCount === 2
                && reusedStatus.freeSlotCount === 0
                && reusedStatus.authoritativeEpoch === initialAuthoritativeEpoch,
            `C slot 재사용 후 stable-slot 상태 불일치: ${JSON.stringify(reusedStatus)}`
        );

        const reusedBodiesPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const reusedBodies = await reusedBodiesPromise;
        assert(reusedBodies.length === 2, `B/C readback body 수 불일치: ${reusedBodies.length}`);
        const preservedB = findBody(reusedBodies, handleB, 'B');
        const spawnedC = findBody(reusedBodies, handleC, 'C');
        assert(
            spawnedC.index === advancedA.index,
            `C가 A의 빈 slot을 재사용하지 않았습니다: A=${advancedA.index}, C=${spawnedC.index}`
        );
        assert(
            preservedB.index === advancedB.index,
            `B stable slot이 변경되었습니다: before=${advancedB.index}, after=${preservedB.index}`
        );
        assertNear(
            preservedB.position.x,
            advancedB.position.x,
            0.000001,
            'C spawn이 B의 GPU 권위 x 위치를 host 초기값으로 되감았습니다'
        );
        assertNear(
            preservedB.position.y,
            advancedB.position.y,
            0.000001,
            'C spawn이 B의 GPU 권위 y 위치를 host 초기값으로 되감았습니다'
        );
        assert(
            preservedB.position.x > initialBodies[1].position.x,
            `C spawn 뒤 B가 host 초기 위치로 돌아갔습니다: ${JSON.stringify(preservedB)}`
        );
        assertNear(spawnedC.position.x, cSpawn.position.x, 0.000001, 'C current x 초기화 불일치');
        assertNear(spawnedC.position.y, cSpawn.position.y, 0.000001, 'C current y 초기화 불일치');
        assertNear(
            spawnedC.previousPosition.x,
            cSpawn.position.x,
            0.000001,
            'C previous x 초기화 불일치'
        );
        assertNear(
            spawnedC.previousPosition.y,
            cSpawn.position.y,
            0.000001,
            'C previous y 초기화 불일치'
        );

        const staleBHandle = {
            entityId: handleB.entityId,
            incarnation: handleB.incarnation - 1
        };
        const staleDespawn = simulation.despawnBodies([staleBHandle]);
        assert(
            staleDespawn.removed === 0
                && staleDespawn.rejected === 1
                && staleDespawn.capacity === 3
                && staleDespawn.reason === 'stale-handle',
            `stale incarnation despawn이 거부되지 않았습니다: ${JSON.stringify(staleDespawn)}`
        );
        assert(!simulation.hasBody(staleBHandle), 'stale B handle이 활성 상태로 조회됩니다.');
        assert(simulation.hasBody(handleB), 'stale despawn이 현재 B incarnation을 제거했습니다.');
        assert(simulation.hasBody(handleC), 'stale despawn이 C를 제거했습니다.');

        const finalBodiesPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const finalBodies = await finalBodiesPromise;
        assert(finalBodies.length === 2, `stale despawn 후 body 수 불일치: ${finalBodies.length}`);
        const finalB = findBody(finalBodies, handleB, 'stale despawn 후 B');
        const finalC = findBody(finalBodies, handleC, 'stale despawn 후 C');
        assertNear(
            finalB.position.x,
            preservedB.position.x,
            0.000001,
            'stale despawn이 B의 x 위치를 변경했습니다'
        );
        assertNear(
            finalB.position.y,
            preservedB.position.y,
            0.000001,
            'stale despawn이 B의 y 위치를 변경했습니다'
        );
        assert(
            matchesHandle(finalB, handleB) && matchesHandle(finalC, handleC),
            `최종 readback handle 불일치: ${JSON.stringify(finalBodies)}`
        );
        const finalStatus = simulation.getStatus();
        assert(
            finalStatus.bodyCount === 2
                && finalStatus.activeBodyCount === 2
                && finalStatus.freeSlotCount === 0
                && finalStatus.hasGpuAuthoritativeState
                && finalStatus.authoritativeEpoch === initialAuthoritativeEpoch,
            `stale despawn 후 stable-slot 상태 불일치: ${JSON.stringify(finalStatus)}`
        );

        const despawnBC = simulation.despawnBodies([handleB, handleC]);
        assert(
            despawnBC.removed === 2
                && despawnBC.rejected === 0
                && despawnBC.capacity === 3,
            `B/C 전체 despawn 실패: ${JSON.stringify(despawnBC)}`
        );
        await device.queue.onSubmittedWorkDone();
        assert(!simulation.hasBody(handleB), '전체 despawn 뒤 B handle이 남았습니다.');
        assert(!simulation.hasBody(handleC), '전체 despawn 뒤 C handle이 남았습니다.');
        assert(
            (await simulation.readbackBodies()).length === 0,
            '전체 despawn 뒤 readback에 활성 body가 남았습니다.'
        );
        const drainedStatus = simulation.getStatus();
        assert(
            drainedStatus.state === 'idle'
                && drainedStatus.bodyCount === 0
                && drainedStatus.activeBodyCount === 0
                && drainedStatus.freeSlotCount === 0
                && drainedStatus.submittedTickCount === 1
                && !drainedStatus.hasGpuAuthoritativeState
                && drainedStatus.authoritativeEpoch > finalStatus.authoritativeEpoch
                && !drainedStatus.requiresAuthoritativeRebuild,
            `전체 despawn 뒤 GPU 권위 상태가 비워지지 않았습니다: ${JSON.stringify(drainedStatus)}`
        );

        const spawnD = simulation.spawnBodies([dSpawn]);
        assert(
            spawnD.accepted === 1
                && spawnD.rejected === 0
                && spawnD.capacity === 3
                && spawnD.handles?.length === 1,
            `D incremental spawn 실패: ${JSON.stringify(spawnD)}`
        );
        const [handleD] = spawnD.handles;
        assert(
            handleD.entityId === dSpawn.entityId
                && handleD.incarnation === dSpawn.incarnation
                && simulation.hasBody(handleD),
            `D spawn handle 불일치: ${JSON.stringify(handleD)}`
        );
        await device.queue.onSubmittedWorkDone();
        const preGenerationChangeStatus = simulation.getStatus();
        assert(
            preGenerationChangeStatus.bodyCount === 1
                && preGenerationChangeStatus.activeBodyCount === 1
                && preGenerationChangeStatus.submittedTickCount === 1
                && !preGenerationChangeStatus.hasGpuAuthoritativeState
                && preGenerationChangeStatus.authoritativeEpoch
                    > drainedStatus.authoritativeEpoch
                && !preGenerationChangeStatus.requiresAuthoritativeRebuild,
            `D pre-tick 상태가 host-authoritative가 아닙니다: ${JSON.stringify(preGenerationChangeStatus)}`
        );

        const generationBeforeChange = lifecycleDeviceGeneration;
        lifecycleDeviceGeneration++;
        assert(
            simulation.init(),
            `host-authoritative D가 generation 변경에서 stale-state rebuild로 차단됐습니다: ${JSON.stringify(simulation.getStatus())}`
        );
        const reinitializedStatus = simulation.getStatus();
        assert(
            reinitializedStatus.state === 'ready'
                && reinitializedStatus.deviceGeneration === lifecycleDeviceGeneration
                && reinitializedStatus.bodyCount === 1
                && reinitializedStatus.activeBodyCount === 1
                && !reinitializedStatus.hasGpuAuthoritativeState
                && reinitializedStatus.authoritativeEpoch
                    === preGenerationChangeStatus.authoritativeEpoch
                && !reinitializedStatus.requiresAuthoritativeRebuild
                && reinitializedStatus.failure === null,
            `D generation 재초기화 상태 불일치: ${JSON.stringify(reinitializedStatus)}`
        );
        assert(
            simulation.fixedUpdate(fixedDelta),
            `D generation 재초기화 뒤 fixed tick이 차단됐습니다: ${JSON.stringify(simulation.getStatus())}`
        );
        const dBodiesPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const dBodies = await dBodiesPromise;
        assert(dBodies.length === 1, `D fixed tick readback body 수 불일치: ${dBodies.length}`);
        const advancedD = findBody(dBodies, handleD, 'generation 재초기화 후 D');
        assert(
            advancedD.position.x > dSpawn.position.x,
            `generation 재초기화 뒤 D가 전진하지 않았습니다: ${JSON.stringify(advancedD)}`
        );
        const postGenerationTickStatus = simulation.getStatus();
        assert(
            postGenerationTickStatus.state === 'ready'
                && postGenerationTickStatus.deviceGeneration === lifecycleDeviceGeneration
                && postGenerationTickStatus.bodyCount === 1
                && postGenerationTickStatus.activeBodyCount === 1
                && postGenerationTickStatus.hasGpuAuthoritativeState
                && postGenerationTickStatus.authoritativeEpoch
                    === reinitializedStatus.authoritativeEpoch
                && !postGenerationTickStatus.requiresAuthoritativeRebuild,
            `generation 재초기화 뒤 D GPU 권위 상태 불일치: ${JSON.stringify(postGenerationTickStatus)}`
        );

        return {
            fixedDelta,
            handles: {
                a: handleA,
                b: handleB,
                c: handleC,
                d: handleD,
                staleB: staleBHandle
            },
            slots: {
                a: advancedA.index,
                b: advancedB.index,
                c: spawnedC.index,
                d: advancedD.index
            },
            bPosition: {
                initial: { ...initialBodies[1].position },
                afterFixedTick: { ...advancedB.position },
                afterCSpawn: { ...preservedB.position },
                afterStaleDespawn: { ...finalB.position }
            },
            cPosition: {
                current: { ...spawnedC.position },
                previous: { ...spawnedC.previousPosition }
            },
            dGenerationRecovery: {
                generationBeforeChange,
                generationAfterChange: lifecycleDeviceGeneration,
                positionBeforeFixedTick: { ...dSpawn.position },
                positionAfterFixedTick: { ...advancedD.position }
            },
            authoritativeEpochs: {
                initial: initialAuthoritativeEpoch,
                afterDrain: drainedStatus.authoritativeEpoch,
                afterDSpawn: preGenerationChangeStatus.authoritativeEpoch,
                afterGenerationInit: reinitializedStatus.authoritativeEpoch,
                afterDFixedTick: postGenerationTickStatus.authoritativeEpoch
            },
            staleDespawn,
            despawnBC,
            status: {
                spawned: compactStatus(spawnedStatus),
                despawnedA: compactStatus(despawnedStatus),
                reusedByC: compactStatus(reusedStatus),
                beforeDrain: compactStatus(finalStatus),
                drained: compactStatus(drainedStatus),
                dBeforeGenerationChange: compactStatus(preGenerationChangeStatus),
                dAfterGenerationInit: compactStatus(reinitializedStatus),
                dAfterFixedTick: compactStatus(postGenerationTickStatus)
            }
        };
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionFixedSubmitFailureSmoke(device) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    const actualQueue = device.queue;
    const fault = {
        failNextSubmit: false,
        submitAttempts: 0,
        successfulSubmits: 0,
        faultedSubmits: 0,
        writeBufferCalls: 0,
        writeTextureCalls: 0
    };
    const queueMethodCache = new Map();
    const wrappedQueue = new Proxy(actualQueue, {
        get(target, property) {
            if (property === 'submit') {
                return (commandBuffers) => {
                    fault.submitAttempts++;
                    if (fault.failNextSubmit) {
                        fault.failNextSubmit = false;
                        fault.faultedSubmits++;
                        throw new Error('injected second physics submit failure');
                    }
                    fault.successfulSubmits++;
                    return Reflect.apply(target.submit, target, [commandBuffers]);
                };
            }
            if (property === 'writeBuffer') {
                return (...args) => {
                    fault.writeBufferCalls++;
                    return Reflect.apply(target.writeBuffer, target, args);
                };
            }
            if (property === 'writeTexture') {
                return (...args) => {
                    fault.writeTextureCalls++;
                    return Reflect.apply(target.writeTexture, target, args);
                };
            }
            const value = Reflect.get(target, property, target);
            if (typeof value !== 'function') {
                return value;
            }
            if (!queueMethodCache.has(property)) {
                queueMethodCache.set(property, value.bind(target));
            }
            return queueMethodCache.get(property);
        }
    });
    const deviceMethodCache = new Map();
    const wrappedDevice = new Proxy(device, {
        get(target, property) {
            if (property === 'queue') {
                return wrappedQueue;
            }
            const value = Reflect.get(target, property, target);
            if (typeof value !== 'function') {
                return value;
            }
            if (!deviceMethodCache.has(property)) {
                deviceMethodCache.set(property, value.bind(target));
            }
            return deviceMethodCache.get(property);
        }
    });
    const platformPort = {
        getState: () => 'ready',
        getDevice: () => wrappedDevice,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => 1,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    };
    const simulation = new GpuCircleBodySimulation(platformPort, {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    const fixedDelta = 1 / 60;
    const body = {
        entityId: 3001,
        incarnation: 19,
        position: { x: 4, y: 4 },
        velocity: { x: 1, y: 0 },
        radius: 0.2,
        inverseMass: 1,
        layerMask: 1,
        collisionMask: 0,
        alive: true
    };
    const compactStatus = (status) => ({
        state: status.state,
        failure: status.failure,
        bodyCount: status.bodyCount,
        activeBodyCount: status.activeBodyCount,
        submittedTickCount: status.submittedTickCount,
        hasGpuAuthoritativeState: status.hasGpuAuthoritativeState,
        requiresAuthoritativeRebuild: status.requiresAuthoritativeRebuild
    });
    const snapshotCalls = () => ({
        submitAttempts: fault.submitAttempts,
        successfulSubmits: fault.successfulSubmits,
        faultedSubmits: fault.faultedSubmits,
        writeBufferCalls: fault.writeBufferCalls,
        writeTextureCalls: fault.writeTextureCalls
    });

    try {
        assert(simulation.init(), 'fixed-submit fault simulation init 실패');
        const spawnResult = simulation.spawnBodies([body]);
        assert(
            spawnResult.accepted === 1
                && spawnResult.rejected === 0
                && spawnResult.handles?.length === 1,
            `fixed-submit fault body spawn 실패: ${JSON.stringify(spawnResult)}`
        );
        assert(simulation.fixedUpdate(fixedDelta), '첫 physics submit이 실패했습니다.');
        await actualQueue.onSubmittedWorkDone();
        const firstTickStatus = await waitForSimulationStatus(
            simulation,
            (status) => status.overflow.pendingReadbacks === 0,
            'fixed-submit fault first tick telemetry'
        );
        assert(
            firstTickStatus.state === 'ready'
                && firstTickStatus.submittedTickCount === 1
                && firstTickStatus.hasGpuAuthoritativeState
                && !firstTickStatus.requiresAuthoritativeRebuild,
            `첫 tick이 GPU authoritative 상태가 아닙니다: ${JSON.stringify(firstTickStatus)}`
        );
        assert(
            fault.submitAttempts === 1
                && fault.successfulSubmits === 1
                && fault.faultedSubmits === 0,
            `첫 physics submit 호출 수 불일치: ${JSON.stringify(snapshotCalls())}`
        );

        // readback submit을 사이에 넣지 않아 다음 호출이 정확히 두 번째 physics submit입니다.
        fault.failNextSubmit = true;
        assert(
            simulation.fixedUpdate(fixedDelta) === false,
            '동기 queue.submit fault 뒤 fixedUpdate가 성공으로 보고되었습니다.'
        );
        assert(
            !fault.failNextSubmit
                && fault.submitAttempts === 2
                && fault.successfulSubmits === 1
                && fault.faultedSubmits === 1,
            `두 번째 physics submit fault가 정확히 한 번 발생하지 않았습니다: ${JSON.stringify(snapshotCalls())}`
        );
        const failedStatus = simulation.getStatus();
        assert(
            failedStatus.state === 'requires-rebuild'
                && failedStatus.failure?.stage === 'fixed-submit'
                && failedStatus.failure?.message.includes('injected second physics submit failure')
                && failedStatus.submittedTickCount === 1
                && failedStatus.hasGpuAuthoritativeState
                && failedStatus.requiresAuthoritativeRebuild,
            `fixed-submit failure가 stale-state rebuild로 전파되지 않았습니다: ${JSON.stringify(failedStatus)}`
        );

        const callsAtFailure = snapshotCalls();
        assert(
            simulation.init() === false,
            'fixed-submit failure 뒤 init이 stale host snapshot을 자동 재업로드했습니다.'
        );
        assert(
            simulation.fixedUpdate(fixedDelta) === false,
            'fixed-submit failure 뒤 fixedUpdate가 자동 retry되었습니다.'
        );
        assert(
            (await simulation.readbackBodies()).length === 0,
            'fixed-submit failure 뒤 readback이 backend를 자동 복구했습니다.'
        );
        const callsAfterBlockedRetry = snapshotCalls();
        assert(
            JSON.stringify(callsAfterBlockedRetry) === JSON.stringify(callsAtFailure),
            `requires-rebuild 상태에서 submit/upload 호출이 추가되었습니다: before=${JSON.stringify(callsAtFailure)}, after=${JSON.stringify(callsAfterBlockedRetry)}`
        );
        const blockedRetryStatus = simulation.getStatus();
        assert(
            blockedRetryStatus.state === 'requires-rebuild'
                && blockedRetryStatus.submittedTickCount === 1
                && blockedRetryStatus.hasGpuAuthoritativeState
                && blockedRetryStatus.requiresAuthoritativeRebuild,
            `차단된 retry 뒤 상태가 변경되었습니다: ${JSON.stringify(blockedRetryStatus)}`
        );

        return {
            injectedFailure: 'second-physics-submit',
            handle: spawnResult.handles[0],
            callsAtFailure,
            callsAfterBlockedRetry,
            status: {
                firstTick: compactStatus(firstTickStatus),
                afterFailure: compactStatus(failedStatus),
                afterBlockedRetry: compactStatus(blockedRetryStatus)
            }
        };
    } finally {
        fault.failNextSubmit = false;
        simulation.destroy();
        await actualQueue.onSubmittedWorkDone();
    }
}

async function runProductionSparseCollisionHoleSmoke(device) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    const platformPort = {
        getState: () => 'ready',
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => 1,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    };
    const simulation = new GpuCircleBodySimulation(platformPort, {
        capacity: 65,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 2, y: 2 }
    });
    const spawns = Array.from({ length: 65 }, (_, index) => ({
        entityId: 4000 + index,
        incarnation: 1,
        position: {
            x: 3 + ((index % 8) * 0.001),
            y: 3 + (Math.floor(index / 8) * 0.001)
        },
        velocity: { x: 0, y: 0 },
        radius: 0.05,
        inverseMass: 1,
        layerMask: 1,
        collisionMask: 1,
        alive: true
    }));

    try {
        assert(simulation.init(), 'sparse collision-hole simulation init 실패');
        const spawnResult = simulation.spawnBodies(spawns);
        assert(
            spawnResult.accepted === 65
                && spawnResult.rejected === 0
                && spawnResult.handles?.length === 65,
            `sparse collision-hole spawn 실패: ${JSON.stringify(spawnResult)}`
        );
        const holeHandle = spawnResult.handles[1];
        const despawnResult = simulation.despawnBodies([holeHandle]);
        assert(
            despawnResult.removed === 1 && despawnResult.rejected === 0,
            `sparse collision-hole 내부 slot despawn 실패: ${JSON.stringify(despawnResult)}`
        );
        const beforeTickStatus = simulation.getStatus();
        assert(
            beforeTickStatus.state === 'ready'
                && beforeTickStatus.bodyCount === 65
                && beforeTickStatus.activeBodyCount === 64
                && beforeTickStatus.freeSlotCount === 1
                && !beforeTickStatus.hasGpuAuthoritativeState,
            `sparse collision-hole high-water 상태 불일치: ${JSON.stringify(beforeTickStatus)}`
        );

        assert(
            simulation.fixedUpdate(1 / 60),
            `sparse collision-hole fixed tick 제출 실패: ${JSON.stringify(simulation.getStatus())}`
        );
        const bodiesPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const bodies = await bodiesPromise;
        assert(bodies.length === 64, `sparse collision-hole readback body 수 불일치: ${bodies.length}`);
        assert(
            !bodies.some((body) => (
                body.handle?.entityId === holeHandle.entityId
                && body.handle?.incarnation === holeHandle.incarnation
            )),
            `sparse collision-hole tombstone이 readback에 포함됐습니다: ${JSON.stringify(holeHandle)}`
        );
        const completedStatus = await waitForSimulationStatus(
            simulation,
            (status) => status.overflow.pendingReadbacks === 0,
            'sparse collision-hole overflow telemetry'
        );
        assert(
            completedStatus.state === 'ready'
                && completedStatus.failure === null
                && completedStatus.bodyCount === 65
                && completedStatus.activeBodyCount === 64
                && completedStatus.freeSlotCount === 1
                && completedStatus.hasGpuAuthoritativeState
                && !completedStatus.requiresAuthoritativeRebuild,
            `sparse collision-hole tick이 false overflow를 만들었습니다: ${JSON.stringify(completedStatus)}`
        );
        assert(
            completedStatus.overflow.lastSmallCount === 0
                && completedStatus.overflow.lastBigCount === 0
                && completedStatus.overflow.totalSmallCount === 0
                && completedStatus.overflow.totalBigCount === 0,
            `sparse collision-hole overflow count가 0이 아닙니다: ${JSON.stringify(completedStatus.overflow)}`
        );
        return {
            highWaterBodyCount: completedStatus.bodyCount,
            activeBodyCount: completedStatus.activeBodyCount,
            freeSlotCount: completedStatus.freeSlotCount,
            hole: {
                slot: 1,
                handle: holeHandle
            },
            overflow: completedStatus.overflow,
            state: completedStatus.state
        };
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionSparseRenderHoleSmoke(device) {
    const context = canvas.getContext('webgpu');
    assert(context, 'sparse render-hole canvas WebGPU context가 없습니다.');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format,
        alphaMode: 'premultiplied',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    let lastFrameTexture = null;
    let drawMarks = 0;
    const platformPort = {
        getState: () => 'ready',
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => 1,
        acquireFrameTarget() {
            const texture = context.getCurrentTexture();
            lastFrameTexture = texture;
            return {
                device,
                context,
                texture,
                view: texture.createView(),
                format,
                deviceGeneration: 1,
                width: canvas.width,
                height: canvas.height
            };
        },
        clearCanvas: () => false,
        markCanvasDrawn() {
            drawMarks++;
            return true;
        },
        markCanvasCleared: () => false
    };
    const simulation = new GpuCircleBodySimulation(platformPort, {
        capacity: 2,
        worldSize: { x: canvas.width, y: canvas.height },
        gridCellSize: { x: 8, y: 8 }
    });
    const bodyA = {
        entityId: 5001,
        incarnation: 1,
        position: { x: 16, y: 16 },
        velocity: { x: 0, y: 0 },
        radius: 4,
        inverseMass: 1,
        layerMask: 1,
        collisionMask: 0,
        alive: true,
        renderStyle: { color: [1, 0, 0, 1] }
    };
    const bodyB = {
        entityId: 5002,
        incarnation: 1,
        position: { x: 48, y: 48 },
        velocity: { x: 0, y: 0 },
        radius: 4,
        inverseMass: 1,
        layerMask: 1,
        collisionMask: 0,
        alive: true,
        renderStyle: { color: [0, 1, 0, 1] }
    };
    const camera = {
        worldToViewport(x, y, out) {
            out.x = x;
            out.y = y;
            return out;
        },
        getScale: () => 1
    };
    const drawAndReadPixels = async (renderFrameId) => {
        simulation.updatePresentation({
            frameDelta: 0,
            fixedDelta: 1 / 60,
            fixedAlpha: 0,
            renderFrameId
        });
        lastFrameTexture = null;
        assert(simulation.draw(camera), `sparse render-hole draw 실패: frame=${renderFrameId}`);
        assert(lastFrameTexture, `sparse render-hole frame texture가 없습니다: frame=${renderFrameId}`);
        const bytesPerRow = 256;
        const readbackBuffer = device.createBuffer({
            label: `sparse-render-hole-readback-${renderFrameId}`,
            size: bytesPerRow * canvas.height,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        try {
            const encoder = device.createCommandEncoder({
                label: `sparse-render-hole-copy-${renderFrameId}`
            });
            encoder.copyTextureToBuffer(
                { texture: lastFrameTexture },
                { buffer: readbackBuffer, bytesPerRow, rowsPerImage: canvas.height },
                [canvas.width, canvas.height]
            );
            device.queue.submit([encoder.finish()]);
            await readbackBuffer.mapAsync(GPUMapMode.READ);
            const pixels = new Uint8Array(readbackBuffer.getMappedRange());
            const readPixel = (position) => {
                const x = Math.floor(position.x);
                const y = Math.floor(position.y);
                const offset = (y * bytesPerRow) + (x * 4);
                return Array.from(pixels.slice(offset, offset + 4));
            };
            return {
                a: readPixel(bodyA.position),
                b: readPixel(bodyB.position)
            };
        } finally {
            try {
                readbackBuffer.unmap();
            } catch {
                // map 실패 또는 이미 unmap된 진단 buffer입니다.
            }
            readbackBuffer.destroy();
        }
    };

    try {
        assert(simulation.init(), 'sparse render-hole simulation init 실패');
        const spawnResult = simulation.spawnBodies([bodyA, bodyB]);
        assert(
            spawnResult.accepted === 2
                && spawnResult.rejected === 0
                && spawnResult.handles?.length === 2,
            `sparse render-hole spawn 실패: ${JSON.stringify(spawnResult)}`
        );
        const [handleA, handleB] = spawnResult.handles;
        const beforeDespawnPixels = await drawAndReadPixels(1);
        assert(
            beforeDespawnPixels.a[3] >= 250 && beforeDespawnPixels.b[3] >= 250,
            `sparse render-hole 양성 대조 pixel alpha 불일치: ${JSON.stringify(beforeDespawnPixels)}`
        );

        const despawnResult = simulation.despawnBodies([handleA]);
        assert(
            despawnResult.removed === 1 && despawnResult.rejected === 0,
            `sparse render-hole A despawn 실패: ${JSON.stringify(despawnResult)}`
        );
        const holeStatus = simulation.getStatus();
        assert(
            holeStatus.bodyCount === 2
                && holeStatus.activeBodyCount === 1
                && holeStatus.freeSlotCount === 1
                && !simulation.hasBody(handleA)
                && simulation.hasBody(handleB),
            `sparse render-hole 상태 불일치: ${JSON.stringify(holeStatus)}`
        );
        const afterDespawnPixels = await drawAndReadPixels(2);
        assert(
            afterDespawnPixels.a[3] === 0,
            `tombstone A 위치에 alpha가 남았습니다: ${JSON.stringify(afterDespawnPixels.a)}`
        );
        assert(
            afterDespawnPixels.b[3] >= 250,
            `내부 hole 뒤 활성 B가 렌더되지 않았습니다: ${JSON.stringify(afterDespawnPixels.b)}`
        );
        const bodies = await simulation.readbackBodies();
        assert(
            bodies.length === 1
                && bodies[0].index === 1
                && bodies[0].handle?.entityId === handleB.entityId
                && bodies[0].handle?.incarnation === handleB.incarnation,
            `sparse render-hole readback이 B stable slot을 보존하지 않았습니다: ${JSON.stringify(bodies)}`
        );
        assert(drawMarks === 2, `sparse render-hole draw mark 수 불일치: ${drawMarks}`);
        return {
            highWaterBodyCount: holeStatus.bodyCount,
            activeBodyCount: holeStatus.activeBodyCount,
            freeSlotCount: holeStatus.freeSlotCount,
            slots: { a: 0, b: bodies[0].index },
            pixels: {
                beforeDespawn: beforeDespawnPixels,
                afterDespawn: afterDespawnPixels
            },
            drawMarks
        };
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
        context.unconfigure();
    }
}

async function runProductionOverflowSmoke(device) {
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format,
        alphaMode: 'premultiplied',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    const platformPort = {
        getState: () => 'ready',
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => 1,
        acquireFrameTarget() {
            const texture = context.getCurrentTexture();
            return {
                device,
                context,
                texture,
                view: texture.createView(),
                format,
                deviceGeneration: 1,
                width: canvas.width,
                height: canvas.height
            };
        },
        clearCanvas() {
            return true;
        },
        markCanvasDrawn() {
            return true;
        },
        markCanvasCleared() {
            return true;
        }
    };
    const flowAtlasCols = 4;
    const flowAtlasRows = 4;
    const flowCellCount = flowAtlasCols * flowAtlasRows;
    const flowDirections = new Float32Array(flowCellCount * 2 * 2);
    for (let cellIndex = 0; cellIndex < flowCellCount; cellIndex++) {
        flowDirections[cellIndex * 2] = 1;
        flowDirections[((flowCellCount + cellIndex) * 2) + 1] = 1;
    }
    const flowGoalCell = Object.freeze({ column: 1, row: 1 });
    const flowGoalPosition = Object.freeze({ x: 3, y: 3 });
    const finalFlowGoalPosition = Object.freeze({ x: 7, y: 7 });
    const simulation = new GpuCircleBodySimulation(platformPort, {
        capacity: 65,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 2, y: 2 },
        sdf: {
            cols: 4,
            rows: 4,
            values: new Float32Array(16).fill(100)
        },
        flowFieldAtlas: {
            cols: flowAtlasCols,
            rows: flowAtlasRows,
            fieldCount: 2,
            origin: { x: 0, y: 0 },
            cellSize: { x: 2, y: 2 },
            directions: flowDirections,
            stages: [
                {
                    goalCell: flowGoalCell,
                    goalPosition: flowGoalPosition,
                    transitionRadius: 0.25,
                    nextFieldIndex: 1
                },
                {
                    goalCell: { column: 3, row: 3 },
                    goalPosition: finalFlowGoalPosition,
                    transitionRadius: 0.25,
                    nextFieldIndex: -1
                }
            ]
        }
    });
    const flowProbeHandle = Object.freeze({ entityId: 2001, incarnation: 13 });
    const spawns = Array.from({ length: 65 }, (_, index) => {
        const isFlowRollbackProbe = index === 0;
        return {
            position: {
                x: 3 + ((index % 8) * 0.001),
                y: 3 + (Math.floor(index / 8) * 0.001)
            },
            velocity: isFlowRollbackProbe ? { x: 0, y: 0 } : { x: 0.75, y: 0.25 },
            radius: 0.05,
            inverseMass: 1,
            layerMask: 1,
            collisionMask: 1,
            alive: true,
            ...(isFlowRollbackProbe ? {
                ...flowProbeHandle,
                useFlow: true,
                flowFieldIndex: 0,
                flowSpeed: 6
            } : {})
        };
    });
    try {
        assert(simulation.init(), 'overflow production GPU circle simulation init 실패');
        const replaceResult = simulation.replaceBodies(spawns);
        assert(
            replaceResult.accepted === 65 && replaceResult.rejected === 0,
            `overflow body 교체 실패: ${JSON.stringify(replaceResult)}`
        );
        assert(simulation.fixedUpdate(1 / 60), 'overflow fixed tick 제출 실패');

        // readback을 telemetry map 완료 전에 예약해 overflow-degraded 전환과의 경합을 피합니다.
        const bodiesPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const bodies = await bodiesPromise;
        assert(bodies.length === spawns.length, `overflow readback body 수 불일치: ${bodies.length}`);
        const flowRollbackBody = bodies.find((body) => (
            body.entityId === flowProbeHandle.entityId
            && body.incarnation === flowProbeHandle.incarnation
        ));
        assert(
            flowRollbackBody
                && flowRollbackBody.handle?.entityId === flowProbeHandle.entityId
                && flowRollbackBody.handle?.incarnation === flowProbeHandle.incarnation,
            `overflow flow probe의 GPU identity/readback handle 불일치: ${JSON.stringify(flowRollbackBody)}`
        );
        assert(
            flowRollbackBody.previousFlowFieldIndex === spawns[0].flowFieldIndex,
            `overflow flow probe의 previousFlowFieldIndex 불일치: ${JSON.stringify(flowRollbackBody)}`
        );
        assert(
            flowRollbackBody.flowFieldIndex === spawns[0].flowFieldIndex
                && flowRollbackBody.flowFieldIndex !== 1,
            `goal-cell flow index가 overflow 뒤 이전 layer로 rollback되지 않았습니다: ${JSON.stringify(flowRollbackBody)}`
        );
        for (let index = 0; index < bodies.length; index++) {
            assertNear(
                bodies[index].position.x,
                Math.fround(spawns[index].position.x),
                0.000001,
                `overflow rollback x 불일치: index=${index}`
            );
            assertNear(
                bodies[index].position.y,
                Math.fround(spawns[index].position.y),
                0.000001,
                `overflow rollback y 불일치: index=${index}`
            );
        }

        const overflowStatus = await waitForSimulationStatus(
            simulation,
            (status) => status.state === 'overflow-degraded',
            'overflow telemetry'
        );
        assert(
            overflowStatus.requiresAuthoritativeRebuild
                && overflowStatus.failure?.stage === 'grid-overflow',
            `overflow가 authoritative rebuild를 요구하지 않습니다: ${JSON.stringify(overflowStatus)}`
        );
        assert(
            overflowStatus.overflow.lastSmallCount >= 1
                && overflowStatus.overflow.totalSmallCount >= 1
                && overflowStatus.overflow.lastBigCount === 0
                && overflowStatus.overflow.totalBigCount === 0
                && overflowStatus.overflow.pendingReadbacks === 0,
            `overflow telemetry 값이 올바르지 않습니다: ${JSON.stringify(overflowStatus.overflow)}`
        );
        return {
            bodyCount: bodies.length,
            rollbackSample: {
                before: { ...spawns[0].position },
                after: { ...bodies[0].position }
            },
            flowIndexRollback: {
                handle: flowRollbackBody.handle,
                goalCell: flowGoalCell,
                goalPosition: flowGoalPosition,
                initialFlowFieldIndex: spawns[0].flowFieldIndex,
                configuredNextFieldIndex: 1,
                previousFlowFieldIndex: flowRollbackBody.previousFlowFieldIndex,
                finalFlowFieldIndex: flowRollbackBody.flowFieldIndex
            },
            status: overflowStatus
        };
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
        context.unconfigure();
    }
}

async function run() {
    assert(resultPath, 'CIRVIVOR_WEBGPU_RESULT_PATH가 없습니다.');
    const result = {
        status: 'fail',
        runtime: {
            nw: process.versions.nw || '',
            chrome: process.versions.chrome || '',
            protocol: location.protocol,
            secureContext: isSecureContext,
            userAgent: navigator.userAgent
        }
    };

    try {
        assert(isSecureContext, `secure context가 아닙니다: ${location.protocol}`);
        assert(navigator.gpu, 'navigator.gpu가 없습니다.');
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        assert(adapter, 'WebGPU adapter를 얻지 못했습니다.');
        assert(
            adapter.limits.maxStorageBuffersPerShaderStage
                >= REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE,
            `production WebGPU storage buffer limit이 부족합니다: required=${REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE}, adapter=${adapter.limits.maxStorageBuffersPerShaderStage}`
        );
        const device = await adapter.requestDevice({
            requiredLimits: {
                maxStorageBuffersPerShaderStage:
                    REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE
            }
        });
        const uncapturedErrors = [];
        device.addEventListener('uncapturederror', (event) => {
            uncapturedErrors.push(event.error?.message || String(event.error));
        });

        result.adapter = serializeAdapterInfo(adapter);
        result.limits = serializeLimits(adapter.limits);
        result.features = Array.from(adapter.features.values()).sort();
        result.atomicIndirectValue = await runAtomicIndirectCompute(device);
        result.storageTextureFormats = await runStorageTextureSmoke(device);
        result.canvas = await runCanvasIndirectDraw(device);
        result.productionShaders = await runProductionShaderSmoke(
            device,
            navigator.gpu.getPreferredCanvasFormat()
        );
        result.productionSimulation = await runProductionSimulationSmoke(device);
        result.productionFlowAtlas = await runProductionFlowAtlasSmoke(device);
        result.productionShapeFlowAtlas = await runProductionShapeFlowAtlasSmoke(device);
        result.productionEnemyAdapter = await runProductionEnemyAdapterGpuSmoke(device);
        result.productionEnemyShapePixels = await runProductionEnemyShapePixelSmoke(device);
        result.productionMixedBodyContactEvent = await runProductionMixedBodyContactEventSmoke(device);
        result.productionBenchmarkEndpoint = await runProductionBenchmarkEndpointSmoke(device);
        result.productionEndpointDeathLifecycle = await runProductionEndpointDeathLifecycleSmoke(device);
        result.productionStableSlotLifecycle = await runProductionStableSlotLifecycleSmoke(device);
        result.productionFixedSubmitFailure = await runProductionFixedSubmitFailureSmoke(device);
        result.productionSparseCollisionHole = await runProductionSparseCollisionHoleSmoke(device);
        result.productionSparseRenderHole = await runProductionSparseRenderHoleSmoke(device);
        result.productionOverflow = await runProductionOverflowSmoke(device);
        await device.queue.onSubmittedWorkDone();
        result.uncapturedErrorCount = uncapturedErrors.length;
        assert(uncapturedErrors.length === 0, `uncaptured WebGPU error: ${uncapturedErrors.join(' | ')}`);

        const lostPromise = device.lost;
        device.destroy();
        const lost = await lostPromise;
        result.deviceLostReason = lost.reason;
        result.status = 'pass';
    } catch (error) {
        result.error = error?.stack ?? String(error);
    }

    require('node:fs').writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    nw.App.quit();
}

run();
