import {
    GPU_COLLISION_COMPUTE_WGSL,
    GPU_COLLISION_INDIRECT_WGSL,
    GPU_COLLISION_RENDER_WGSL
} from './production/gpu_collision_shaders.js';
import { GpuCircleBodySimulation } from './production/gpu_circle_body_simulation.js';
import {
    BASIC_CIRCLE_ENEMY_DATA
} from './production/script/data/object/enemy/basic_circle_enemy_data.js';
import { createTileMap } from './production/script/module/ingame/map/tile_map.js';
import {
    createRouteFlowFieldAtlas
} from './production/script/module/ingame/navigation/route_flow_field_atlas.js';
import {
    createGpuEnemySpawnIntent
} from './production/script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const canvas = document.getElementById('gpu');

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
    const directions = new Float32Array([
        // layer 0: every cell steers right.
        1, 0, 1, 0,
        1, 0, 1, 0,
        // layer 1: every cell steers down in the +Y world axis.
        0, 1, 0, 1,
        0, 1, 0, 1
    ]);
    const simulation = new GpuCircleBodySimulation(platformPort, {
        capacity: 2,
        worldSize: { x: 2, y: 2 },
        gridCellSize: { x: 1, y: 1 },
        flowFieldAtlas: {
            cols: 2,
            rows: 2,
            fieldCount: 2,
            origin: { x: 0, y: 0 },
            cellSize: { x: 1, y: 1 },
            directions,
            stages: [
                {
                    goalCell: { column: 1, row: 0 },
                    nextFieldIndex: 1
                },
                {
                    goalCell: { column: 1, row: 1 },
                    nextFieldIndex: -1
                }
            ]
        }
    });
    const fixedDelta = 1 / 60;
    const flowSpeed = 6;
    const initialBodies = [
        {
            position: { x: 0.5, y: 0.5 },
            velocity: { x: 0, y: 0 },
            radius: 0.1,
            inverseMass: 1,
            layerMask: 1,
            collisionMask: 0,
            alive: true,
            useFlow: true,
            flowFieldIndex: 0,
            flowSpeed
        },
        {
            position: { x: 1.5, y: 0.5 },
            velocity: { x: 0, y: 0 },
            radius: 0.1,
            inverseMass: 1,
            layerMask: 1,
            collisionMask: 0,
            alive: true,
            useFlow: true,
            flowFieldIndex: 0,
            flowSpeed
        }
    ];
    try {
        assert(simulation.init(), 'flow atlas production GPU circle simulation init 실패');
        const replaceResult = simulation.replaceBodies(initialBodies);
        assert(
            replaceResult.accepted === 2 && replaceResult.rejected === 0,
            `flow atlas body 교체 실패: ${JSON.stringify(replaceResult)}`
        );
        const initialStatus = simulation.getStatus();
        assert(
            initialStatus.flowFieldEnabled && initialStatus.flowFieldCount === 2,
            `flow atlas 상태가 올바르지 않습니다: ${JSON.stringify(initialStatus)}`
        );
        assert(simulation.fixedUpdate(fixedDelta), 'flow atlas fixed tick 제출 실패');
        const bodiesPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const bodies = await bodiesPromise;
        assert(bodies.length === 2, `flow atlas readback body 수 불일치: ${bodies.length}`);

        const expectedVelocity = flowSpeed * fixedDelta;
        const expectedDisplacement = expectedVelocity * fixedDelta;
        const steeringBody = bodies[0];
        assertNear(
            steeringBody.velocity.x,
            expectedVelocity,
            0.00001,
            'zero velocity body의 source flow 조향 x 속도가 다릅니다'
        );
        assertNear(
            steeringBody.velocity.y,
            0,
            0.00001,
            'zero velocity body의 source flow 조향 y 속도가 다릅니다'
        );
        assertNear(
            steeringBody.position.x,
            initialBodies[0].position.x + expectedDisplacement,
            0.00001,
            'zero velocity body의 source flow 적분 x 위치가 다릅니다'
        );
        assertNear(
            steeringBody.position.y,
            initialBodies[0].position.y,
            0.00001,
            'zero velocity body의 source flow 적분 y 위치가 다릅니다'
        );
        assert(
            steeringBody.flowFieldIndex === 0,
            `goal 밖 body의 flowFieldIndex가 변경되었습니다: ${steeringBody.flowFieldIndex}`
        );

        const transitionedBody = bodies[1];
        assert(
            transitionedBody.flowFieldIndex === 1,
            `goal cell에서 다음 flow layer로 전환되지 않았습니다: ${transitionedBody.flowFieldIndex}`
        );
        assertNear(
            transitionedBody.velocity.x,
            0,
            0.00001,
            '전환 body가 이전 layer의 x 방향으로 조향되었습니다'
        );
        assertNear(
            transitionedBody.velocity.y,
            expectedVelocity,
            0.00001,
            '전환 body가 새 layer의 y 방향으로 조향되지 않았습니다'
        );
        assertNear(
            transitionedBody.position.x,
            initialBodies[1].position.x,
            0.00001,
            '전환 body의 x 위치가 새 layer 방향과 다릅니다'
        );
        assertNear(
            transitionedBody.position.y,
            initialBodies[1].position.y + expectedDisplacement,
            0.00001,
            '전환 body의 y 위치가 새 layer 방향과 다릅니다'
        );
        const completedStatus = await waitForSimulationStatus(
            simulation,
            (status) => status.overflow.pendingReadbacks === 0,
            'flow atlas overflow telemetry completion'
        );
        return {
            atlas: {
                cols: 2,
                rows: 2,
                fieldCount: 2,
                layerDirections: [
                    { x: 1, y: 0 },
                    { x: 0, y: 1 }
                ]
            },
            fixedDelta,
            flowSpeed,
            expectedVelocity,
            expectedDisplacement,
            steering: {
                before: { ...initialBodies[0].position },
                after: { ...steeringBody.position },
                velocity: { ...steeringBody.velocity },
                flowFieldIndex: steeringBody.flowFieldIndex
            },
            stageTransition: {
                before: { ...initialBodies[1].position },
                after: { ...transitionedBody.position },
                velocity: { ...transitionedBody.velocity },
                flowFieldIndexBefore: initialBodies[1].flowFieldIndex,
                flowFieldIndexAfter: transitionedBody.flowFieldIndex
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
    const stages = Array.from({ length: fieldCount }, () => ({
        goalCell: { column: 0, row: 0 },
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
            drainedStatus.state === 'ready'
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
                    nextFieldIndex: 1
                },
                {
                    goalCell: { column: 3, row: 3 },
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
        const device = await adapter.requestDevice();
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
