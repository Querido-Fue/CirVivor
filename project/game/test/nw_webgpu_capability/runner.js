import {
    GPU_COLLISION_COMPUTE_WGSL,
    GPU_COLLISION_INDIRECT_WGSL,
    GPU_COLLISION_RENDER_WGSL
} from './production/script/module/ingame/physics/gpu/gpu_collision_shaders.js';
import {
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    GPU_CIRCLE_BODY_GAMEPLAY_META,
    packGpuCircleGameplayMeta,
    unpackGpuCircleInteractionMeta,
    unpackGpuCircleGameplayMeta
} from './production/script/module/ingame/physics/gpu/gpu_circle_body_abi.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_TEAM_ID,
    isGameplayDamageAllowed
} from './production/script/module/ingame/contract/gameplay_team_contract.js';
import {
    PROJECTILE_TARGET_POLICY_ID
} from './production/script/module/ingame/contract/projectile_target_policy_contract.js';
import {
    PLAYER_ACTION_TYPES
} from './production/script/module/ingame/contract/player_controllable_contract.js';
import {
    GPU_FIXED_PRIMITIVE_ABI,
    GPU_SPAWN_PROGRAM_MODE,
    GPU_SPAWN_PROGRAM_RESULT
} from './production/script/module/ingame/physics/gpu/gpu_fixed_primitive_abi.js';
import { GpuCircleBodySimulation } from './production/script/module/ingame/physics/gpu/gpu_circle_body_simulation.js';
import {
    createGpuSignedDistanceField,
    sampleGpuSignedDistanceField
} from './production/script/module/ingame/physics/gpu/gpu_signed_distance_field.js';
import {
    THE_TOWER_COMBAT_DATA,
    THE_TOWER_DATA
} from './production/script/data/object/tower/the_tower_data.js';
import {
    BASIC_BULLET_PRODUCER_ID,
    BASIC_BULLET_PROJECTILE_DATA,
    BASIC_BULLET_WEAPON_DATA
} from './production/script/data/object/projectile/basic_bullet_data.js';
import {
    BASIC_ARROW_ENEMY_DATA,
    BASIC_CIRCLE_ENEMY_DATA,
    BASIC_GEN_ENEMY_DATA,
    BASIC_HEXA_ENEMY_DATA,
    MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE,
    BASIC_PENTA_ENEMY_DATA,
    BASIC_SQUARE_ENEMY_DATA,
    BASIC_TRIANGLE_ENEMY_DATA
} from './production/script/data/object/enemy/basic_circle_enemy_data.js';
import {
    ARCHER_ENEMY_DATA
} from './production/script/data/object/enemy/archer_enemy_data.js';
import {
    ARCHER_ATTACK_DATA
} from './production/script/data/object/enemy/archer_attack_data.js';
import {
    HOSTILE_BASIC_BULLET_DATA
} from './production/script/data/object/projectile/hostile_basic_bullet_data.js';
import {
    CORRIDOR_EIGHT_WAVE_01_DATA
} from './production/script/data/scene/game/corridor_eight_wave_01_data.js';
import { createTileMap } from './production/script/module/ingame/map/tile_map.js';
import {
    WorldCamera2D
} from './production/script/module/ingame/map/world_camera_2d.js';
import {
    WaveDirector
} from './production/script/module/ingame/flow/wave_director.js';
import {
    createRouteFlowFieldAtlas
} from './production/script/module/ingame/navigation/route_flow_field_atlas.js';
import {
    createGpuEnemySpawnIntent
} from './production/script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js';
import {
    HostileAttackDirector,
    computeHostileAttackPhaseOffset
} from './production/script/module/ingame/object/enemy/hostile_attack_director.js';
import {
    GpuPrimaryProjectileController
} from './production/script/module/ingame/object/projectile/gpu_primary_projectile_controller.js';
import {
    createGpuCoreProxySpawnIntent
} from './production/script/module/ingame/object/core/gpu_core_proxy_spawn_adapter.js';
import {
    createGpuTowerSpawnIntent
} from './production/script/module/ingame/object/tower/gpu_tower_spawn_adapter.js';
import {
    GpuTowerActorFacade
} from './production/script/module/ingame/object/tower/gpu_tower_actor_facade.js';
import {
    TOWER_COMBAT_FACT_TYPE,
    TowerCombatRoster
} from './production/script/module/ingame/object/tower/tower_combat_roster.js';
import {
    TowerCoreCameraFollowTarget
} from './production/script/module/ingame/object/tower_core_camera_follow_target.js';
import {
    createGpuSimulationEndpoint,
    createGpuEnemySimulationEndpoint,
    createGpuProjectileSpawnIntent,
    GPU_PROJECTILE_SPAWN_MODE,
    GpuProjectileSpawnAdapter
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
        'clear_body_control_states',
        'validate_body_control_commands',
        'apply_body_control_commands',
        'apply_controlled_motion',
        'validate_source_relative_spawns',
        'resolve_source_relative_spawns',
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
        'finalize_velocities',
        'finalize_controlled_motion',
        'pack_tracked_pose'
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
            teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
            alive: true
        },
        {
            position: { x: 4.25, y: 4 },
            velocity: { x: 0, y: 0 },
            radius: 0.5,
            inverseMass: 1,
            layerMask: 1,
            collisionMask: 1,
            teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
            alive: true
        },
        {
            position: { x: 0.25, y: 1 },
            velocity: { x: 0, y: 0 },
            radius: 0.5,
            inverseMass: 1,
            layerMask: 1,
            collisionMask: 128,
            teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
            alive: true
        },
        {
            position: { x: 6, y: 6 },
            velocity: { x: 7, y: -5 },
            radius: 0.5,
            inverseMass: 0,
            layerMask: 1,
            collisionMask: 1,
            teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
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
    const pairVisualRadiusSum = bodies[0].radius + bodies[1].radius;
    const pairEffectiveMinimumDistance = pairVisualRadiusSum
        * MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE;
    assert(
        distance >= pairEffectiveMinimumDistance - 0.001
            && distance < pairVisualRadiusSum - 0.001,
        `production GPU enemy-pair 유효 반경 해소가 잘못됐습니다: distance=${distance}, effectiveMinimum=${pairEffectiveMinimumDistance}, visualRadiusSum=${pairVisualRadiusSum}`
    );
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
        collisionPair: {
            visualRadiusSum: pairVisualRadiusSum,
            effectiveMinimumDistance: pairEffectiveMinimumDistance,
            radiusScale: MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE
        },
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
            teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
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
            teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
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
            teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
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
        teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
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
    const intents = [0, -0.2, 0.2].map((laneOffsetTiles, spawnSequence) => (
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
    const pairVisualRadiusSum = bodies[1].radius + bodies[2].radius;
    const pairMinimumDistance = pairVisualRadiusSum
        * MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE;
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
            pairDistanceAfter >= pairMinimumDistance - 0.001
                && pairDistanceAfter < pairVisualRadiusSum - 0.001,
            `production enemy collision pair 유효 반경 해소가 잘못됐습니다: before=${pairDistanceBefore}, after=${pairDistanceAfter}, effectiveMinimum=${pairMinimumDistance}, visualRadiusSum=${pairVisualRadiusSum}`
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
                minimumDistance: pairMinimumDistance,
                effectiveMinimumDistance: pairMinimumDistance,
                visualRadiusSum: pairVisualRadiusSum,
                radiusScale: MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE
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
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
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
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
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
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
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
            teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
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
            teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
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
        teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
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
        teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
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
        teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
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
        teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
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
        teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
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
        teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
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
            teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
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

function createPhase3PlatformPort(device) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    return Object.freeze({
        getState: () => Object.freeze({ ready: true, status: 'ready' }),
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => 1,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    });
}

function createPhase3Body(overrides = {}) {
    return {
        position: { x: 1, y: 1 },
        velocity: { x: 0, y: 0 },
        radius: 0.2,
        inverseMass: 1,
        bodyLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
        collisionMask: 0,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
        interactionMask: 0,
        teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
        damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        health: 1,
        penetration: 1,
        lifetime: -1,
        alive: true,
        ...overrides
    };
}

function createPhase3SpawnIntent(definitionId, overrides = {}) {
    return Object.freeze({
        kindId: 'projectile',
        definitionId,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        ...createPhase3Body(overrides)
    });
}

function integrateTowerControlOracle(state, authoredIntent, fixedDelta) {
    let moveIntentX = Number(authoredIntent.x);
    let moveIntentY = Number(authoredIntent.y);
    const magnitude = Math.hypot(moveIntentX, moveIntentY);
    if (magnitude > 1) {
        moveIntentX = Math.fround(moveIntentX / magnitude);
        moveIntentY = Math.fround(moveIntentY / magnitude);
    }
    const decay = Math.exp(
        -THE_TOWER_DATA.LINEAR_FRICTION_PER_SECOND * fixedDelta
    );
    const accelerationScale = (1 - decay)
        / THE_TOWER_DATA.LINEAR_FRICTION_PER_SECOND;
    let velocityX = (state.velocity.x * decay)
        + (moveIntentX
            * THE_TOWER_DATA.CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED
            * accelerationScale);
    let velocityY = (state.velocity.y * decay)
        + (moveIntentY
            * THE_TOWER_DATA.CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED
            * accelerationScale);
    const speed = Math.hypot(velocityX, velocityY);
    if (speed > THE_TOWER_DATA.MAX_LINEAR_SPEED_TILES_PER_SECOND) {
        const scale = THE_TOWER_DATA.MAX_LINEAR_SPEED_TILES_PER_SECOND / speed;
        velocityX *= scale;
        velocityY *= scale;
    }
    if (moveIntentX === 0
        && moveIntentY === 0
        && Math.hypot(velocityX, velocityY)
            <= THE_TOWER_DATA.SLEEP_SPEED_TILES_PER_SECOND) {
        velocityX = 0;
        velocityY = 0;
    }
    return Object.freeze({
        position: Object.freeze({
            x: state.position.x + (velocityX * fixedDelta),
            y: state.position.y + (velocityY * fixedDelta)
        }),
        velocity: Object.freeze({ x: velocityX, y: velocityY })
    });
}

function assertPhase3PoseNear(actual, expected, label, tolerance = 0.0003) {
    assert(actual?.valid, `${label} observed pose가 valid가 아닙니다: ${JSON.stringify(actual)}`);
    assertNear(actual.position.x, expected.position.x, tolerance, `${label} position.x`);
    assertNear(actual.position.y, expected.position.y, tolerance, `${label} position.y`);
    assertNear(actual.velocity.x, expected.velocity.x, tolerance, `${label} velocity.x`);
    assertNear(actual.velocity.y, expected.velocity.y, tolerance, `${label} velocity.y`);
}

async function waitForPhase3ObservedPose(endpoint, sourceTick, label) {
    const simulation = endpoint.getBackend().simulation;
    assert(simulation, `${label} production simulation이 없습니다.`);
    await deviceQueueDone(simulation);
    await waitForSimulationStatus(
        simulation,
        (status) => status.fixedPrimitives.trackedPose.pendingReadbacks === 0
            && status.fixedPrimitives.trackedPose.latest?.valid
            && status.fixedPrimitives.trackedPose.latest.sourceTick >= sourceTick,
        `${label} tracked pose`
    );
    const observed = endpoint.getObservedTrackedPose();
    assert(
        observed.valid
            && observed.sourceTick === sourceTick
            && observed.observedThroughTick === sourceTick,
        `${label} observed tick/identity 불일치: ${JSON.stringify(observed)}`
    );
    return observed;
}

async function deviceQueueDone(simulation) {
    const device = simulation?.device;
    assert(device?.queue, 'Phase 3 simulation device queue가 없습니다.');
    await device.queue.onSubmittedWorkDone();
}

async function runProductionFixedPrimitiveEndpointSmoke(device) {
    const platformPort = createPhase3PlatformPort(device);
    const columns = 32;
    const rows = 16;
    const navigationGrid = Object.freeze({
        cols: columns,
        rows,
        size: columns * rows,
        cellSize: 1,
        blocked: new Uint8Array(columns * rows)
    });
    const navigationSource = Object.freeze({
        getNavigationGrid: () => navigationGrid,
        getWorldBounds: () => Object.freeze({
            minX: 0,
            minY: 0,
            maxX: columns,
            maxY: rows,
            width: columns,
            height: rows
        })
    });
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: platformPort
    }, {
        capacity: 12,
        controlCommandCapacity: 8,
        spawnProgramCapacity: 2
    });
    const fixedDelta = 1 / 60;
    const spawnDefinitions = Object.freeze([
        Object.freeze({
            commandId: 'phase3:spawn:primary',
            intent: createPhase3SpawnIntent('phase3_controlled_primary', {
                position: { x: 4, y: 4 }
            })
        }),
        Object.freeze({
            commandId: 'phase3:spawn:max-clamp',
            intent: createPhase3SpawnIntent('phase3_max_clamp', {
                position: { x: 8, y: 4 },
                velocity: { x: 100, y: 0 }
            })
        }),
        Object.freeze({
            commandId: 'phase3:spawn:sleep',
            intent: createPhase3SpawnIntent('phase3_sleep_threshold', {
                position: { x: 4, y: 8 },
                velocity: { x: 0.005, y: 0 }
            })
        })
    ]);
    const movementSamples = [];

    try {
        assert(
            endpoint.init(navigationSource) === false,
            'Phase 3 endpoint는 첫 spawn 전 deferred여야 합니다.'
        );
        for (const spawn of spawnDefinitions) {
            const receipt = endpoint.requestSpawn(spawn.intent, 1, spawn.commandId);
            assert(receipt.accepted, `Phase 3 fixture spawn request 실패: ${JSON.stringify(receipt)}`);
        }
        const spawnCommit = endpoint.commitAtFixedBoundary(1);
        assert(
            spawnCommit.state === 'committed'
                && spawnCommit.spawned.length === spawnDefinitions.length,
            `Phase 3 fixture spawn commit 실패: ${JSON.stringify(spawnCommit)}`
        );
        const handleByCommandId = new Map(
            spawnCommit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        const primaryHandle = handleByCommandId.get('phase3:spawn:primary');
        const maxClampHandle = handleByCommandId.get('phase3:spawn:max-clamp');
        const sleepHandle = handleByCommandId.get('phase3:spawn:sleep');
        assert(primaryHandle && maxClampHandle && sleepHandle, 'Phase 3 fixture handle 누락');

        assert(
            endpoint.configureTrackedBody(primaryHandle).accepted,
            'Phase 3 primary tracking 구성 실패'
        );
        assert(endpoint.fixedUpdate(fixedDelta, 1), 'Phase 3 initial fixed submit 실패');
        const initialPose = await waitForPhase3ObservedPose(
            endpoint,
            1,
            'Phase 3 initial'
        );
        let primaryOracle = Object.freeze({
            position: Object.freeze({ ...initialPose.position }),
            velocity: Object.freeze({ ...initialPose.velocity })
        });
        const controlCases = Object.freeze([
            Object.freeze({ tick: 2, label: 'zero', intent: Object.freeze({ x: 0, y: 0 }) }),
            Object.freeze({ tick: 3, label: 'cardinal', intent: Object.freeze({ x: 1, y: 0 }) }),
            Object.freeze({ tick: 4, label: 'reversal', intent: Object.freeze({ x: -1, y: 0 }) }),
            Object.freeze({ tick: 5, label: 'diagonal', intent: Object.freeze({ x: 1, y: 1 }) }),
            Object.freeze({ tick: 6, label: 'idle-friction', intent: Object.freeze({ x: 0, y: 0 }) })
        ]);
        for (const fixture of controlCases) {
            const receipt = endpoint.requestBodyControl({
                handle: primaryHandle,
                moveIntentX: fixture.intent.x,
                moveIntentY: fixture.intent.y
            }, fixture.tick, `phase3:control:${fixture.label}`);
            assert(receipt.accepted, `${fixture.label} control request 실패: ${JSON.stringify(receipt)}`);
            const commit = endpoint.commitAtFixedBoundary(fixture.tick);
            assert(
                commit.state === 'committed'
                    && commit.fixedCommands.controls.length === 1,
                `${fixture.label} control commit 실패: ${JSON.stringify(commit)}`
            );
            assert(
                endpoint.fixedUpdate(fixedDelta, fixture.tick),
                `${fixture.label} fixed submit 실패: ${JSON.stringify(endpoint.getStatus())}`
            );
            const observed = await waitForPhase3ObservedPose(
                endpoint,
                fixture.tick,
                `Phase 3 ${fixture.label}`
            );
            primaryOracle = integrateTowerControlOracle(
                primaryOracle,
                fixture.intent,
                fixedDelta
            );
            assertPhase3PoseNear(observed, primaryOracle, fixture.label);
            if (fixture.label === 'reversal') {
                assert(
                    observed.velocity.x < 0,
                    `reversal input 뒤 x velocity가 방향을 바꾸지 않았습니다: ${observed.velocity.x}`
                );
            }
            movementSamples.push(Object.freeze({
                tick: fixture.tick,
                label: fixture.label,
                position: Object.freeze({ ...observed.position }),
                velocity: Object.freeze({ ...observed.velocity })
            }));
        }

        assert(endpoint.configureTrackedBody(sleepHandle).accepted, 'sleep tracking 구성 실패');
        const sleepReceipt = endpoint.requestBodyControl({
            handle: sleepHandle,
            moveIntentX: 0,
            moveIntentY: 0
        }, 7, 'phase3:control:sleep');
        assert(sleepReceipt.accepted, `sleep control request 실패: ${JSON.stringify(sleepReceipt)}`);
        assert(endpoint.commitAtFixedBoundary(7).fixedCommands.controls.length === 1,
            'sleep control commit 수 불일치');
        assert(endpoint.fixedUpdate(fixedDelta, 7), 'sleep fixed submit 실패');
        const sleepPose = await waitForPhase3ObservedPose(endpoint, 7, 'Phase 3 sleep');
        assertNear(sleepPose.velocity.x, 0, 0.000001, 'sleep threshold velocity.x');
        assertNear(sleepPose.velocity.y, 0, 0.000001, 'sleep threshold velocity.y');

        assert(endpoint.configureTrackedBody(maxClampHandle).accepted, 'max clamp tracking 구성 실패');
        const maxReceipt = endpoint.requestBodyControl({
            handle: maxClampHandle,
            moveIntentX: 1,
            moveIntentY: 0
        }, 8, 'phase3:control:max-clamp');
        assert(maxReceipt.accepted, `max clamp request 실패: ${JSON.stringify(maxReceipt)}`);
        assert(endpoint.commitAtFixedBoundary(8).fixedCommands.controls.length === 1,
            'max clamp control commit 수 불일치');
        assert(endpoint.fixedUpdate(fixedDelta, 8), 'max clamp fixed submit 실패');
        const maxClampPose = await waitForPhase3ObservedPose(endpoint, 8, 'Phase 3 max clamp');
        assertNear(
            Math.hypot(maxClampPose.velocity.x, maxClampPose.velocity.y),
            THE_TOWER_DATA.MAX_LINEAR_SPEED_TILES_PER_SECOND,
            0.0001,
            'controlled max-speed clamp'
        );
        const expectedMaxClampX = 8 + (100 * fixedDelta * 7)
            + (THE_TOWER_DATA.MAX_LINEAR_SPEED_TILES_PER_SECOND * fixedDelta);
        assertNear(
            maxClampPose.position.x,
            expectedMaxClampX,
            0.0005,
            'uncommanded ballistic ticks + controlled clamp position'
        );

        primaryOracle = Object.freeze({
            position: Object.freeze({
                x: primaryOracle.position.x + (primaryOracle.velocity.x * fixedDelta * 2),
                y: primaryOracle.position.y + (primaryOracle.velocity.y * fixedDelta * 2)
            }),
            velocity: primaryOracle.velocity
        });
        assert(endpoint.configureTrackedBody(primaryHandle).accepted,
            'source-relative preflight tracking 구성 실패');
        const preflightReceipt = endpoint.requestBodyControl({
            handle: primaryHandle,
            moveIntentX: 0,
            moveIntentY: 0
        }, 9, 'phase3:control:source-preflight');
        assert(preflightReceipt.accepted, 'source-relative preflight control request 실패');
        assert(endpoint.commitAtFixedBoundary(9).fixedCommands.controls.length === 1,
            'source-relative preflight commit 실패');
        assert(endpoint.fixedUpdate(fixedDelta, 9), 'source-relative preflight submit 실패');
        const sourceTickStartPose = await waitForPhase3ObservedPose(
            endpoint,
            9,
            'Phase 3 source tick-start'
        );
        primaryOracle = integrateTowerControlOracle(
            primaryOracle,
            { x: 0, y: 0 },
            fixedDelta
        );
        assertPhase3PoseNear(
            sourceTickStartPose,
            primaryOracle,
            'source tick-start oracle'
        );

        const positionOffset = Object.freeze({ x: 0.75, y: -0.5 });
        const launchVelocity = Object.freeze({ x: 3, y: -2 });
        const sourceVelocityScale = 0.5;
        const sourceRelativeReceipt = endpoint.requestSourceRelativeSpawn({
            sourceHandle: primaryHandle,
            destinationSpawn: createPhase3SpawnIntent(
                'phase3_source_relative_destination',
                { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } }
            ),
            positionOffset,
            launchVelocity,
            sourceVelocityScale
        }, 10, 'phase3:source-relative:resolved');
        const sameTickControl = endpoint.requestBodyControl({
            handle: primaryHandle,
            moveIntentX: 0,
            moveIntentY: 1
        }, 10, 'phase3:control:same-tick-source');
        assert(sourceRelativeReceipt.accepted && sameTickControl.accepted,
            `source-relative/control 동시 request 실패: ${JSON.stringify({ sourceRelativeReceipt, sameTickControl })}`);
        const sourceRelativeCommit = endpoint.commitAtFixedBoundary(10);
        assert(
            sourceRelativeCommit.fixedCommands.controls.length === 1
                && sourceRelativeCommit.fixedCommands.sourceRelativeSpawns.length === 1,
            `source-relative/control 동시 commit 실패: ${JSON.stringify(sourceRelativeCommit)}`
        );
        const destinationHandle = sourceRelativeCommit
            .fixedCommands.sourceRelativeSpawns[0].handle;
        assert(endpoint.fixedUpdate(fixedDelta, 10), 'source-relative fixed submit 실패');
        const controlledSourceAfterTick = await waitForPhase3ObservedPose(
            endpoint,
            10,
            'Phase 3 same-tick controlled source'
        );
        const simulation = endpoint.getBackend().simulation;
        await waitForSimulationStatus(
            simulation,
            (status) => status.fixedPrimitives.spawnProgram.pendingReadbacks === 0
                && status.fixedPrimitives.spawnProgram.queuedBatches >= 1,
            'Phase 3 SpawnProgram completion'
        );
        const completed = endpoint.commitCompletedEventsAtFixedBoundary(11);
        assert(completed.protocolFailure === null,
            `source-relative completion protocol 실패: ${JSON.stringify(completed)}`);
        assert(endpoint.getRegistry().has(destinationHandle),
            'resolved destination이 registry에서 활성화되지 않았습니다.');
        const bodiesPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const bodies = await bodiesPromise;
        const destination = bodies.find((body) => (
            body.handle?.entityId === destinationHandle.entityId
            && body.handle?.incarnation === destinationHandle.incarnation
        ));
        assert(destination, `resolved destination readback 누락: ${JSON.stringify(bodies)}`);
        const expectedMaterializedPosition = Object.freeze({
            x: sourceTickStartPose.position.x + positionOffset.x,
            y: sourceTickStartPose.position.y + positionOffset.y
        });
        const expectedLaunchVelocity = Object.freeze({
            x: launchVelocity.x
                + (sourceTickStartPose.velocity.x * sourceVelocityScale),
            y: launchVelocity.y
                + (sourceTickStartPose.velocity.y * sourceVelocityScale)
        });
        assertNear(destination.previousPosition.x, expectedMaterializedPosition.x,
            0.0004, 'source-relative tick-start previousPosition.x');
        assertNear(destination.previousPosition.y, expectedMaterializedPosition.y,
            0.0004, 'source-relative tick-start previousPosition.y');
        assertNear(destination.velocity.x, expectedLaunchVelocity.x,
            0.0004, 'source-relative tick-start velocity.x');
        assertNear(destination.velocity.y, expectedLaunchVelocity.y,
            0.0004, 'source-relative tick-start velocity.y');
        assertNear(destination.position.x,
            expectedMaterializedPosition.x + (expectedLaunchVelocity.x * fixedDelta),
            0.0005, 'source-relative integrated position.x');
        assertNear(destination.position.y,
            expectedMaterializedPosition.y + (expectedLaunchVelocity.y * fixedDelta),
            0.0005, 'source-relative integrated position.y');
        const postControlLaunchY = launchVelocity.y
            + (controlledSourceAfterTick.velocity.y * sourceVelocityScale);
        assert(
            Math.abs(destination.velocity.y - postControlLaunchY) > 0.01,
            `source-relative spawn이 same-tick post-control velocity를 사용했습니다: destination=${destination.velocity.y}, postControl=${postControlLaunchY}`
        );

        assert(endpoint.configureTrackedBody(primaryHandle).accepted,
            'pose ring saturation tracking 구성 실패');
        const droppedBefore = simulation.getStatus()
            .fixedPrimitives.trackedPose.droppedSamples;
        for (let tick = 11; tick <= 16; tick++) {
            const receipt = endpoint.requestBodyControl({
                handle: primaryHandle,
                moveIntentX: 0,
                moveIntentY: 0
            }, tick, `phase3:control:ring:${tick}`);
            assert(receipt.accepted, `pose ring tick ${tick} request 실패`);
            assert(endpoint.commitAtFixedBoundary(tick).fixedCommands.controls.length === 1,
                `pose ring tick ${tick} commit 실패`);
            assert(endpoint.fixedUpdate(fixedDelta, tick),
                `pose ring saturation 중 fixed submit 중단: tick=${tick}`);
        }
        await device.queue.onSubmittedWorkDone();
        const saturatedStatus = await waitForSimulationStatus(
            simulation,
            (status) => status.fixedPrimitives.trackedPose.pendingReadbacks === 0,
            'Phase 3 pose ring saturation completion'
        );
        const trackedTelemetry = saturatedStatus.fixedPrimitives.trackedPose;
        assert(
            trackedTelemetry.ringSlotCount === 4
                && trackedTelemetry.recordByteSize
                    === GPU_FIXED_PRIMITIVE_ABI.TRACKED_POSE_RECORD.STRIDE
                && trackedTelemetry.maximumBytesPerTick === 32
                && trackedTelemetry.droppedSamples - droppedBefore >= 2
                && saturatedStatus.submittedTickCount === 16
                && saturatedStatus.state === 'ready',
            `tracked pose bounded/ring saturation telemetry 불일치: ${JSON.stringify(trackedTelemetry)}`
        );

        const activeBeforeCapacityReject = endpoint.getStatus().activeCount;
        for (let index = 0; index < 3; index++) {
            const receipt = endpoint.requestSourceRelativeSpawn({
                sourceHandle: primaryHandle,
                destinationSpawn: createPhase3SpawnIntent(
                    `phase3_capacity_destination_${index}`,
                    { position: { x: 0, y: 0 } }
                ),
                positionOffset: { x: index, y: 0 },
                launchVelocity: { x: 0, y: 0 },
                sourceVelocityScale: 0
            }, 17, `phase3:source-relative:capacity:${index}`);
            assert(receipt.accepted, `SpawnProgram capacity request ${index} enqueue 실패`);
        }
        const capacityReject = endpoint.commitAtFixedBoundary(17);
        assert(
            capacityReject.state === 'committed-with-rejections'
                && capacityReject.fixedCommands.rejected.length === 3
                && capacityReject.fixedCommands.sourceRelativeSpawns.length === 0
                && !capacityReject.recoveryRequired
                && endpoint.getStatus().activeCount === activeBeforeCapacityReject
                && endpoint.getStatus().reservedCount === 0,
            `SpawnProgram capacity zero-partial 실패: ${JSON.stringify(capacityReject)}`
        );
        const finalStatus = simulation.getStatus();
        const fixedPrimitives = finalStatus.fixedPrimitives;
        assert(
            fixedPrimitives.storageProfile.fixedControl === 5
                && fixedPrimitives.storageProfile.sourceResolve === 5
                && fixedPrimitives.storageProfile.trackedPose === 6
                && fixedPrimitives.storageProfile.requiredMaximum === 9
                && fixedPrimitives.spawnProgram.capacity === 2
                && fixedPrimitives.spawnProgram.overflowCount === 1,
            `Phase 3 storage/capacity telemetry 불일치: ${JSON.stringify(fixedPrimitives)}`
        );

        return {
            fixedDelta,
            handles: {
                primary: primaryHandle,
                maxClamp: maxClampHandle,
                sleep: sleepHandle,
                destination: destinationHandle
            },
            movementSamples,
            sleepVelocity: { ...sleepPose.velocity },
            maxClamp: {
                position: { ...maxClampPose.position },
                velocity: { ...maxClampPose.velocity }
            },
            sourceRelative: {
                tickStartSource: {
                    position: { ...sourceTickStartPose.position },
                    velocity: { ...sourceTickStartPose.velocity }
                },
                postControlSourceVelocity: { ...controlledSourceAfterTick.velocity },
                materializedPreviousPosition: { ...destination.previousPosition },
                destinationPosition: { ...destination.position },
                destinationVelocity: { ...destination.velocity }
            },
            trackedPose: {
                ringSlotCount: trackedTelemetry.ringSlotCount,
                recordByteSize: trackedTelemetry.recordByteSize,
                maximumBytesPerTick: trackedTelemetry.maximumBytesPerTick,
                droppedSamples: trackedTelemetry.droppedSamples,
                publishedSamples: trackedTelemetry.publishedSamples,
                pendingReadbacks: trackedTelemetry.pendingReadbacks
            },
            spawnProgram: {
                capacity: fixedPrimitives.spawnProgram.capacity,
                overflowCount: fixedPrimitives.spawnProgram.overflowCount,
                backpressureCount: fixedPrimitives.spawnProgram.backpressureCount,
                resolvedCount: fixedPrimitives.spawnProgram.resolvedCount,
                capacityRejectCount: capacityReject.fixedCommands.rejected.length,
                zeroPartial: true
            },
            storageProfile: fixedPrimitives.storageProfile
        };
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionFixedPrimitiveIsolationSmoke(device) {
    const platformPort = createPhase3PlatformPort(device);
    const directions = new Float32Array(2 * 2 * 2);
    for (let cellIndex = 0; cellIndex < 4; cellIndex++) {
        directions[(cellIndex * 2) + 1] = 1;
    }
    const simulation = new GpuCircleBodySimulation(platformPort, {
        capacity: 3,
        worldSize: { x: 16, y: 16 },
        gridCellSize: { x: 2, y: 2 },
        flowFieldAtlas: {
            cols: 2,
            rows: 2,
            fieldCount: 1,
            origin: { x: 0, y: 0 },
            cellSize: { x: 8, y: 8 },
            directions,
            stages: [{
                goalCell: { column: 1, row: 1 },
                goalPosition: { x: 15, y: 15 },
                transitionRadius: 0.1,
                nextFieldIndex: -1
            }]
        }
    });
    const fixedDelta = 1 / 60;
    const controlled = createPhase3Body({
        entityId: 9101,
        incarnation: 1,
        position: { x: 2, y: 2 }
    });
    const ballistic = createPhase3Body({
        entityId: 9102,
        incarnation: 1,
        position: { x: 6, y: 4 },
        velocity: { x: 2, y: -1 }
    });
    const flow = createPhase3Body({
        entityId: 9103,
        incarnation: 1,
        position: { x: 10, y: 4 },
        useFlow: true,
        flowFieldIndex: 0,
        flowSpeed: 6
    });
    try {
        assert(simulation.init(), 'Phase 3 isolation simulation init 실패');
        assert(simulation.spawnBodies([controlled, ballistic, flow]).accepted === 3,
            'Phase 3 isolation spawn 실패');
        assert(simulation.canControlBody(controlled), 'controlled body가 controllable이 아닙니다.');
        assert(!simulation.canControlBody(flow), 'FLOW_FIELD body가 controllable로 분류되었습니다.');
        const staged = simulation.stageFixedPrograms({
            targetFixedTick: 1,
            controls: [{
                entityId: controlled.entityId,
                incarnation: controlled.incarnation,
                moveIntentX: 1,
                moveIntentY: 0
            }],
            sourceRelativeSpawns: []
        });
        assert(staged.accepted === 1 && staged.rejected === 0,
            `Phase 3 isolation control stage 실패: ${JSON.stringify(staged)}`);
        assert(simulation.fixedUpdate(fixedDelta, 1), 'Phase 3 isolation fixed submit 실패');
        const bodiesPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const bodies = await bodiesPromise;
        const byId = new Map(bodies.map((body) => [body.entityId, body]));
        const controlledAfter = byId.get(controlled.entityId);
        const ballisticAfter = byId.get(ballistic.entityId);
        const flowAfter = byId.get(flow.entityId);
        const controlledOracle = integrateTowerControlOracle({
            position: controlled.position,
            velocity: controlled.velocity
        }, { x: 1, y: 0 }, fixedDelta);
        assertPhase3PoseNear({ ...controlledAfter, valid: true }, controlledOracle,
            'isolation controlled');
        assertNear(ballisticAfter.velocity.x, ballistic.velocity.x, 0.00001,
            'ballistic velocity.x 보존');
        assertNear(ballisticAfter.velocity.y, ballistic.velocity.y, 0.00001,
            'ballistic velocity.y 보존');
        assertNear(ballisticAfter.position.x,
            ballistic.position.x + (ballistic.velocity.x * fixedDelta),
            0.00002, 'ballistic position.x 보존');
        assertNear(ballisticAfter.position.y,
            ballistic.position.y + (ballistic.velocity.y * fixedDelta),
            0.00002, 'ballistic position.y 보존');
        assertNear(flowAfter.velocity.x, 0, 0.00002, 'FLOW velocity.x 보존');
        assertNear(flowAfter.velocity.y, flow.flowSpeed * fixedDelta, 0.00005,
            'FLOW steering velocity.y 보존');
        assert(flowAfter.flowFieldIndex === 0,
            `FLOW stage가 control pass로 변경됐습니다: ${JSON.stringify(flowAfter)}`);
        return {
            controlled: {
                position: { ...controlledAfter.position },
                velocity: { ...controlledAfter.velocity }
            },
            ballistic: {
                position: { ...ballisticAfter.position },
                velocity: { ...ballisticAfter.velocity }
            },
            flow: {
                position: { ...flowAfter.position },
                velocity: { ...flowAfter.velocity },
                flowFieldIndex: flowAfter.flowFieldIndex,
                controllable: false
            }
        };
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionSourceInvalidCleanupSmoke(device) {
    const simulation = new GpuCircleBodySimulation(
        createPhase3PlatformPort(device),
        {
            capacity: 3,
            worldSize: { x: 8, y: 8 },
            gridCellSize: { x: 1, y: 1 },
            spawnProgramCapacity: 2,
            sessionGeneration: 41
        }
    );
    const fixedDelta = 1 / 60;
    const source = createPhase3Body({
        entityId: 9201,
        incarnation: 3,
        position: { x: 3, y: 3 },
        health: 0
    });
    const destinationHandle = Object.freeze({ entityId: 9202, incarnation: 5 });
    try {
        assert(simulation.init(), 'source-invalid simulation init 실패');
        assert(simulation.spawnBodies([source]).accepted === 1,
            'source-invalid source spawn 실패');
        assert(simulation.fixedUpdate(fixedDelta, 1), 'source death tick submit 실패');
        await device.queue.onSubmittedWorkDone();
        assert(simulation.hasBody(source),
            'GPU death readback 전 host exact source handle이 조기 제거되었습니다.');
        const staged = simulation.stageFixedPrograms({
            targetFixedTick: 2,
            controls: [],
            sourceRelativeSpawns: [{
                sourceHandle: source,
                destinationHandle,
                destinationSpawn: createPhase3Body({
                    position: { x: 0, y: 0 },
                    velocity: { x: 0, y: 0 }
                }),
                positionOffset: { x: 0.5, y: 0 },
                launchVelocity: { x: 2, y: 0 },
                sourceVelocityScale: 1
            }]
        });
        assert(staged.accepted === 1 && staged.sourceRelativeSpawnCount === 1,
            `source-invalid SpawnProgram stage 실패: ${JSON.stringify(staged)}`);
        const pendingStatus = simulation.getStatus();
        assert(
            pendingStatus.pendingBodyCount === 1
                && !simulation.hasBody(destinationHandle),
            `source-invalid destination이 resolve 전에 활성화됐습니다: ${JSON.stringify(pendingStatus)}`
        );
        assert(simulation.fixedUpdate(fixedDelta, 2), 'source-invalid resolve submit 실패');
        await device.queue.onSubmittedWorkDone();
        await waitForSimulationStatus(
            simulation,
            (status) => status.fixedPrimitives.spawnProgram.pendingReadbacks === 0
                && status.fixedPrimitives.spawnProgram.queuedBatches === 1,
            'source-invalid SpawnProgram readback'
        );
        const batches = simulation.drainCompletedSpawnProgramBatches([]);
        assert(
            batches.length === 1
                && batches[0].failure === null
                && batches[0].outcomes.length === 1
                && batches[0].outcomes[0].reason === 'source-invalid',
            `source-invalid typed outcome 불일치: ${JSON.stringify(batches)}`
        );
        const cleanedStatus = simulation.getStatus();
        assert(
            !simulation.hasBody(destinationHandle)
                && cleanedStatus.pendingBodyCount === 0
                && cleanedStatus.bodyCount === 1
                && cleanedStatus.fixedPrimitives.spawnProgram.invalidCount === 1
                && cleanedStatus.fixedPrimitives.spawnProgram.overflowCount === 0,
            `source-invalid destination stable-slot cleanup 실패: ${JSON.stringify(cleanedStatus)}`
        );
        const aliveBodies = await simulation.readbackBodies();
        assert(aliveBodies.length === 0,
            `source-invalid fixture에 GPU ALIVE body가 남았습니다: ${JSON.stringify(aliveBodies)}`);
        return {
            sourceHandle: Object.freeze({
                entityId: source.entityId,
                incarnation: source.incarnation
            }),
            destinationHandle,
            outcome: batches[0].outcomes[0].reason,
            pendingBodyCountBeforeResolve: pendingStatus.pendingBodyCount,
            pendingBodyCountAfterCleanup: cleanedStatus.pendingBodyCount,
            highWaterBodyCountAfterCleanup: cleanedStatus.bodyCount,
            aliveBodyCountAfterCleanup: aliveBodies.length,
            invalidCount: cleanedStatus.fixedPrimitives.spawnProgram.invalidCount,
            overflowCount: cleanedStatus.fixedPrimitives.spawnProgram.overflowCount
        };
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionFixedPrimitiveGeometrySmoke(device) {
    const columns = 8;
    const rows = 8;
    const blocked = new Uint8Array(columns * rows);
    blocked[(4 * columns) + 4] = 1;
    const sdf = createGpuSignedDistanceField({
        cols: columns,
        rows,
        size: columns * rows,
        cellSize: 1,
        sdfSubdivisions: 8,
        blocked
    });
    const simulation = new GpuCircleBodySimulation(
        createPhase3PlatformPort(device),
        {
            capacity: 6,
            worldSize: { x: columns, y: rows },
            gridCellSize: { x: 1, y: 1 },
            sdf,
            solverIterations: 6
        }
    );
    const terrainMask = GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN;
    const wall = {
        ...createGpuTowerSpawnIntent({ position: { x: 3.5, y: 4.5 } }),
        entityId: 9301,
        incarnation: 1,
        velocity: { x: 20, y: 0 },
        collisionMask: terrainMask
    };
    const corner = {
        ...createGpuTowerSpawnIntent({ position: { x: 3.5, y: 3.5 } }),
        entityId: 9302,
        incarnation: 1,
        velocity: { x: 20, y: 20 },
        collisionMask: terrainMask
    };
    const outside = {
        ...createGpuTowerSpawnIntent({ position: { x: 0.3, y: 2 } }),
        entityId: 9303,
        incarnation: 1,
        velocity: { x: -20, y: 0 },
        collisionMask: terrainMask
    };
    const largeStatic = createPhase3Body({
        entityId: 9304,
        incarnation: 1,
        position: { x: 6.3, y: 6 },
        radius: 0.7,
        inverseMass: 0,
        bodyLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        collisionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
    });
    const boundaryDynamic = createPhase3Body({
        entityId: 9305,
        incarnation: 1,
        position: { x: 5.2, y: 6 },
        radius: 0.5,
        bodyLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
        collisionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE
    });
    const fixedDelta = 1 / 60;
    try {
        assert(simulation.init(), 'Phase 3 geometry simulation init 실패');
        assert(
            simulation.spawnBodies([
                wall,
                corner,
                outside,
                largeStatic,
                boundaryDynamic
            ]).accepted === 5,
            'Phase 3 geometry body spawn 실패'
        );
        const staged = simulation.stageFixedPrograms({
            targetFixedTick: 1,
            controls: [
                { ...wall, moveIntentX: 1, moveIntentY: 0 },
                { ...corner, moveIntentX: 1 / Math.sqrt(2), moveIntentY: 1 / Math.sqrt(2) },
                { ...outside, moveIntentX: -1, moveIntentY: 0 }
            ],
            sourceRelativeSpawns: []
        });
        assert(staged.accepted === 3 && staged.rejected === 0,
            `Phase 3 geometry control stage 실패: ${JSON.stringify(staged)}`);
        const minimumPairDistance = largeStatic.radius + boundaryDynamic.radius;
        const pairDistanceBefore = Math.hypot(
            largeStatic.position.x - boundaryDynamic.position.x,
            largeStatic.position.y - boundaryDynamic.position.y
        );
        assert(pairDistanceBefore < minimumPairDistance,
            'large-static/small-dynamic fixture가 겹치지 않습니다.');
        assert(simulation.fixedUpdate(fixedDelta, 1), 'Phase 3 geometry fixed submit 실패');
        const bodiesPromise = simulation.readbackBodies();
        await device.queue.onSubmittedWorkDone();
        const bodies = await bodiesPromise;
        const byId = new Map(bodies.map((body) => [body.entityId, body]));
        const wallAfter = byId.get(wall.entityId);
        const cornerAfter = byId.get(corner.entityId);
        const outsideAfter = byId.get(outside.entityId);
        const largeStaticAfter = byId.get(largeStatic.entityId);
        const boundaryDynamicAfter = byId.get(boundaryDynamic.entityId);
        const wallDistance = sampleGpuSignedDistanceField(
            sdf,
            wallAfter.position.x,
            wallAfter.position.y
        );
        const cornerDistance = sampleGpuSignedDistanceField(
            sdf,
            cornerAfter.position.x,
            cornerAfter.position.y
        );
        assert(wallDistance >= wall.radius - 0.035,
            `controlled wall 접촉 penetration 과다: distance=${wallDistance}`);
        assert(cornerDistance >= corner.radius - 0.04,
            `controlled corner 접촉 penetration 과다: distance=${cornerDistance}`);
        assert(outsideAfter.position.x >= outside.radius - 0.002,
            `controlled out-of-map boundary 미해소: x=${outsideAfter.position.x}`);
        const pairDistanceAfter = Math.hypot(
            largeStaticAfter.position.x - boundaryDynamicAfter.position.x,
            largeStaticAfter.position.y - boundaryDynamicAfter.position.y
        );
        assert(pairDistanceAfter >= minimumPairDistance - 0.002,
            `large-static/small-dynamic 경계 collision 미해소: ${pairDistanceAfter}/${minimumPairDistance}`);
        assertNear(largeStaticAfter.position.x, largeStatic.position.x, 0.00001,
            'large static position.x 이동');
        assertNear(largeStaticAfter.position.y, largeStatic.position.y, 0.00001,
            'large static position.y 이동');
        const completedStatus = await waitForSimulationStatus(
            simulation,
            (status) => status.overflow.pendingReadbacks === 0,
            'Phase 3 geometry overflow telemetry'
        );
        assert(
            completedStatus.state === 'ready'
                && completedStatus.overflow.lastSmallCount === 0
                && completedStatus.overflow.lastBigCount === 0
                && completedStatus.overflow.totalSmallCount === 0
                && completedStatus.overflow.totalBigCount === 0,
            `Phase 3 geometry grid overflow: ${JSON.stringify(completedStatus.overflow)}`
        );
        return {
            sdf: {
                subdivisions: 8,
                wallDistance,
                cornerDistance,
                wallRadius: wall.radius,
                cornerRadius: corner.radius
            },
            worldBoundary: {
                radius: outside.radius,
                positionAfter: { ...outsideAfter.position }
            },
            largeStaticSmallDynamic: {
                gridCellSize: 1,
                largeStaticDiameter: largeStatic.radius * 2,
                smallDynamicDiameter: boundaryDynamic.radius * 2,
                exactSmallBoundary: boundaryDynamic.radius * 2 === 1,
                distanceBefore: pairDistanceBefore,
                distanceAfter: pairDistanceAfter,
                minimumDistance: minimumPairDistance
            },
            overflow: completedStatus.overflow
        };
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

function createTowerCoreHardwareNavigationSource() {
    const columns = 16;
    const rows = 16;
    const cellSize = 1;
    const corePosition = Object.freeze({ x: 8, y: 8, row: 8, column: 8 });
    const entryPosition = Object.freeze({ x: 2, y: 8, row: 8, column: 2 });
    const worldBounds = Object.freeze({
        minX: 0,
        minY: 0,
        maxX: columns * cellSize,
        maxY: rows * cellSize,
        width: columns * cellSize,
        height: rows * cellSize
    });
    const navigationGrid = Object.freeze({
        cols: columns,
        rows,
        size: columns * rows,
        cellSize,
        sdfSubdivisions: 8,
        blocked: new Uint8Array(columns * rows)
    });
    const route = Object.freeze({
        gateId: 'nw-phase4-core-gate',
        pathId: 'nw-phase4-core-route',
        waypoints: Object.freeze([entryPosition, corePosition])
    });
    return Object.freeze({
        corePosition,
        route,
        getNavigationGrid: () => navigationGrid,
        getSpawnRoutes: () => Object.freeze([route]),
        getWorldBounds: () => worldBounds
    });
}

async function runProductionTowerCoreWorldHardwareSmoke(device) {
    const context = canvas.getContext('webgpu');
    assert(context, 'Phase 4 Tower/Core canvas WebGPU context가 없습니다.');
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
        getState: () => Object.freeze({ ready: true, status: 'ready' }),
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
    const navigationSource = createTowerCoreHardwareNavigationSource();
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: platformPort
    }, {
        capacity: 3,
        controlCommandCapacity: 2
    });
    const fixedDelta = 1 / 60;
    const towerIntent = createGpuTowerSpawnIntent({
        position: { x: 4, y: 4 }
    });
    const coreIntent = createGpuCoreProxySpawnIntent({
        position: navigationSource.corePosition
    });
    const enemyIntent = Object.freeze({
        ...createGpuEnemySpawnIntent({
            definition: {
                id: 'nw_phase4_core_enemy',
                collisionWeight: 1,
                moveSpeedTilesPerSecond: 1,
                collisionRadiusTiles: 0.25,
                maxHealth: 3,
                colorRgba: [1, 0.2, 0.2, 1]
            },
            route: navigationSource.route,
            spawnSequence: 0,
            waveId: 'nw-phase4-disabled-wave',
            policyId: 'hardware-fixture'
        }),
        position: Object.freeze({ x: 8.75005, y: 8 }),
        velocity: Object.freeze({ x: 0, y: 0 })
    });
    const minimumCoreEnemyDistance = coreIntent.radius + enemyIntent.radius;
    const initialCoreEnemyDistance = Math.hypot(
        enemyIntent.position.x - coreIntent.position.x,
        enemyIntent.position.y - coreIntent.position.y
    );
    assert(
        initialCoreEnemyDistance > minimumCoreEnemyDistance
            && initialCoreEnemyDistance - minimumCoreEnemyDistance < 0.001
            && initialCoreEnemyDistance > enemyIntent.radius,
        `Phase 4 Core/Enemy fixture가 enter/hidden pixel 조건을 만족하지 않습니다: distance=${initialCoreEnemyDistance}, minimum=${minimumCoreEnemyDistance}`
    );
    const findBody = (bodies, handle, label) => {
        const body = bodies.find((candidate) => (
            candidate.handle?.entityId === handle.entityId
            && candidate.handle?.incarnation === handle.incarnation
        ));
        assert(body, `Phase 4 ${label} body가 없습니다: ${JSON.stringify(handle)}`);
        return body;
    };

    try {
        assert(
            endpoint.init(navigationSource) === false,
            'Phase 4 generic endpoint는 첫 spawn 전 deferred여야 합니다.'
        );
        const spawnRequests = [
            ['phase4:tower', towerIntent],
            ['phase4:core-proxy', coreIntent],
            ['phase4:enemy', enemyIntent]
        ].map(([commandId, intent]) => endpoint.requestSpawn(intent, 1, commandId));
        assert(
            spawnRequests.every(({ accepted }) => accepted),
            `Phase 4 wave 없는 generic spawn 예약 실패: ${JSON.stringify(spawnRequests)}`
        );
        const spawnCommit = endpoint.commitAtFixedBoundary(1);
        assert(
            spawnCommit.state === 'committed'
                && spawnCommit.spawned.length === 3
                && spawnCommit.rejected.length === 0,
            `Phase 4 Tower/Core/Enemy spawn commit 실패: ${JSON.stringify(spawnCommit)}`
        );
        const handleByCommandId = new Map(
            spawnCommit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        const towerHandle = handleByCommandId.get('phase4:tower');
        const coreHandle = handleByCommandId.get('phase4:core-proxy');
        const enemyHandle = handleByCommandId.get('phase4:enemy');
        assert(
            towerHandle && coreHandle && enemyHandle
                && endpoint.getRegistry().has(towerHandle)
                && endpoint.getRegistry().has(coreHandle)
                && endpoint.getRegistry().has(enemyHandle)
                && endpoint.hasBody(towerHandle)
                && endpoint.hasBody(coreHandle)
                && endpoint.hasBody(enemyHandle),
            `Phase 4 exact spawn handle/registry가 불일치합니다: ${JSON.stringify(spawnCommit.spawned)}`
        );
        assert(
            endpoint.configureTrackedBody(towerHandle).accepted,
            'Phase 4 Tower tracked body 구성 실패'
        );
        assert(endpoint.fixedUpdate(fixedDelta, 1), 'Phase 4 initial fixed submit 실패');
        const initialTowerPose = await waitForPhase3ObservedPose(
            endpoint,
            1,
            'Phase 4 Tower initial'
        );
        assert(
            initialTowerPose.entityId === towerHandle.entityId
                && initialTowerPose.incarnation === towerHandle.incarnation,
            `Phase 4 tracked Tower identity가 publish되지 않았습니다: ${JSON.stringify(initialTowerPose)}`
        );
        const simulation = endpoint.getBackend().simulation;
        assert(simulation, 'Phase 4 generic endpoint production simulation이 없습니다.');
        const initialBodies = await simulation.readbackBodies();
        const coreAfterInitial = findBody(initialBodies, coreHandle, 'Core initial');
        const enemyAfterInitial = findBody(initialBodies, enemyHandle, 'Enemy initial');
        assertNear(coreAfterInitial.position.x, coreIntent.position.x, 0.00001,
            'Phase 4 static Core x가 이동했습니다');
        assertNear(coreAfterInitial.position.y, coreIntent.position.y, 0.00001,
            'Phase 4 static Core y가 이동했습니다');

        await waitForSimulationStatus(
            simulation,
            (status) => status.events.pendingReadbacks === 0
                && status.events.completedThroughTick >= 1,
            'Phase 4 Core enter event completion'
        );
        const initialEvents = endpoint.commitCompletedEventsAtFixedBoundary(2);
        assert(
            initialEvents.contactEvents.length === 1
                && initialEvents.deathEvents.length === 0,
            `Phase 4 Core enter event 수가 정확하지 않습니다: ${JSON.stringify(initialEvents)}`
        );
        const [coreEnterEvent] = initialEvents.contactEvents;
        assert(
            coreEnterEvent.type === 'contact'
                && coreEnterEvent.eventType === 'interaction-enter'
                && coreEnterEvent.entityId === coreHandle.entityId
                && coreEnterEvent.incarnation === coreHandle.incarnation
                && coreEnterEvent.otherEntityId === enemyHandle.entityId
                && coreEnterEvent.otherIncarnation === enemyHandle.incarnation
                && coreEnterEvent.valueFixedPoint === 0
                && coreEnterEvent.damage === 0
                && coreEnterEvent.disposition === 'applied',
            `Phase 4 Core-origin enter event 내용이 잘못되었습니다: ${JSON.stringify(coreEnterEvent)}`
        );

        const cardinalReceipt = endpoint.requestBodyControl({
            handle: towerHandle,
            moveIntentX: 1,
            moveIntentY: 0
        }, 2, 'phase4:tower:cardinal');
        assert(cardinalReceipt.accepted, `Phase 4 cardinal control 예약 실패: ${JSON.stringify(cardinalReceipt)}`);
        const cardinalCommit = endpoint.commitAtFixedBoundary(2);
        assert(
            cardinalCommit.state === 'committed'
                && cardinalCommit.fixedCommands.controls.length === 1,
            `Phase 4 cardinal control commit 실패: ${JSON.stringify(cardinalCommit)}`
        );
        assert(endpoint.fixedUpdate(fixedDelta, 2), 'Phase 4 cardinal fixed submit 실패');
        const cardinalTowerPose = await waitForPhase3ObservedPose(
            endpoint,
            2,
            'Phase 4 Tower cardinal'
        );
        const cardinalOracle = integrateTowerControlOracle({
            position: initialTowerPose.position,
            velocity: initialTowerPose.velocity
        }, { x: 1, y: 0 }, fixedDelta);
        assertPhase3PoseNear(cardinalTowerPose, cardinalOracle, 'Phase 4 cardinal Tower');

        await waitForSimulationStatus(
            simulation,
            (status) => status.events.pendingReadbacks === 0
                && status.events.completedThroughTick >= 2,
            'Phase 4 sustained Core overlap completion'
        );
        const sustainedEvents = endpoint.commitCompletedEventsAtFixedBoundary(3);
        assert(
            sustainedEvents.contactEvents.length === 0
                && sustainedEvents.deathEvents.length === 0,
            `Phase 4 sustained Core overlap이 enter event를 중복했습니다: ${JSON.stringify(sustainedEvents)}`
        );

        const releaseReceipt = endpoint.requestBodyControl({
            handle: towerHandle,
            moveIntentX: 0,
            moveIntentY: 0
        }, 3, 'phase4:tower:release');
        assert(releaseReceipt.accepted, `Phase 4 release control 예약 실패: ${JSON.stringify(releaseReceipt)}`);
        const releaseCommit = endpoint.commitAtFixedBoundary(3);
        assert(
            releaseCommit.state === 'committed'
                && releaseCommit.fixedCommands.controls.length === 1,
            `Phase 4 release control commit 실패: ${JSON.stringify(releaseCommit)}`
        );
        assert(endpoint.fixedUpdate(fixedDelta, 3), 'Phase 4 release fixed submit 실패');
        const releaseTowerPose = await waitForPhase3ObservedPose(
            endpoint,
            3,
            'Phase 4 Tower release'
        );
        const releaseOracle = integrateTowerControlOracle(
            cardinalOracle,
            { x: 0, y: 0 },
            fixedDelta
        );
        assertPhase3PoseNear(releaseTowerPose, releaseOracle, 'Phase 4 release Tower');
        assert(
            releaseTowerPose.velocity.x > 0
                && releaseTowerPose.velocity.x < cardinalTowerPose.velocity.x,
            `Phase 4 release가 Tower friction을 적용하지 않았습니다: ${JSON.stringify(releaseTowerPose)}`
        );

        const releasedBodies = await simulation.readbackBodies();
        const coreAfterRelease = findBody(releasedBodies, coreHandle, 'Core release');
        const enemyAfterRelease = findBody(releasedBodies, enemyHandle, 'Enemy release');
        const releasedCoreEnemyDistance = Math.hypot(
            enemyAfterRelease.position.x - coreAfterRelease.position.x,
            enemyAfterRelease.position.y - coreAfterRelease.position.y
        );
        const enemyTravelDuringSustainedOverlap = Math.hypot(
            enemyAfterRelease.position.x - enemyAfterInitial.position.x,
            enemyAfterRelease.position.y - enemyAfterInitial.position.y
        );
        assertNear(coreAfterRelease.position.x, coreAfterInitial.position.x, 0.00001,
            'Phase 4 Core가 physical response로 x 이동했습니다');
        assertNear(coreAfterRelease.position.y, coreAfterInitial.position.y, 0.00001,
            'Phase 4 Core가 physical response로 y 이동했습니다');
        assert(
            releasedCoreEnemyDistance < minimumCoreEnemyDistance
                && enemyTravelDuringSustainedOverlap < 0.001
                && coreAfterRelease.health > 0
                && enemyAfterRelease.health > 0,
            `Phase 4 Core/Enemy physical displacement 또는 zero-damage 계약이 깨졌습니다: ${JSON.stringify({
                releasedCoreEnemyDistance,
                minimumCoreEnemyDistance,
                enemyTravelDuringSustainedOverlap,
                core: coreAfterRelease,
                enemy: enemyAfterRelease
            })}`
        );

        const cameraScale = 4;
        const camera = {
            worldToViewport(x, y, out) {
                out.x = x * cameraScale;
                out.y = y * cameraScale;
                return out;
            },
            getScale: () => cameraScale
        };
        endpoint.updatePresentation({
            frameDelta: 0,
            fixedDelta,
            fixedAlpha: 1,
            renderFrameId: 4101
        });
        assert(endpoint.draw(camera), 'Phase 4 Tower/Core production draw 실패');
        assert(lastFrameTexture, 'Phase 4 Tower/Core production draw texture가 없습니다.');
        const bytesPerRow = 256;
        const renderReadback = device.createBuffer({
            label: 'phase4-tower-core-render-readback',
            size: bytesPerRow * canvas.height,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        let towerCenterAlpha = 0;
        let coreCenterAlpha = 0;
        try {
            const encoder = device.createCommandEncoder({
                label: 'phase4-tower-core-render-copy'
            });
            encoder.copyTextureToBuffer(
                { texture: lastFrameTexture },
                { buffer: renderReadback, bytesPerRow, rowsPerImage: canvas.height },
                [canvas.width, canvas.height]
            );
            device.queue.submit([encoder.finish()]);
            await renderReadback.mapAsync(GPUMapMode.READ);
            const pixels = new Uint8Array(renderReadback.getMappedRange());
            const readWorldAlpha = (position) => {
                const x = Math.floor(position.x * cameraScale);
                const y = Math.floor(position.y * cameraScale);
                return pixels[(y * bytesPerRow) + (x * 4) + 3];
            };
            towerCenterAlpha = readWorldAlpha(releaseTowerPose.position);
            coreCenterAlpha = readWorldAlpha(coreAfterRelease.position);
        } finally {
            try {
                renderReadback.unmap();
            } catch {
                // map 실패 또는 이미 unmap된 진단 buffer입니다.
            }
            renderReadback.destroy();
        }
        assert(
            drawMarks === 1 && towerCenterAlpha > 0 && coreCenterAlpha === 0,
            `Phase 4 Tower visible/Core invisible render style이 잘못됐습니다: ${JSON.stringify({
                drawMarks,
                towerCenterAlpha,
                coreCenterAlpha
            })}`
        );

        const fixedPrimitives = simulation.getStatus().fixedPrimitives;
        const storageProfile = fixedPrimitives.storageProfile;
        const storageProfileValues = Object.values(storageProfile)
            .filter((value) => typeof value === 'number');
        assert(
            storageProfile.requiredMaximum === REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE
                && storageProfileValues.every(
                    (value) => value <= REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE
                ),
            `Phase 4 storage profile이 max=9를 초과했습니다: ${JSON.stringify(storageProfile)}`
        );

        return {
            waveEnabled: false,
            handles: {
                tower: towerHandle,
                core: coreHandle,
                enemy: enemyHandle
            },
            tower: {
                initial: {
                    position: { ...initialTowerPose.position },
                    velocity: { ...initialTowerPose.velocity }
                },
                cardinal: {
                    position: { ...cardinalTowerPose.position },
                    velocity: { ...cardinalTowerPose.velocity }
                },
                release: {
                    position: { ...releaseTowerPose.position },
                    velocity: { ...releaseTowerPose.velocity }
                }
            },
            coreEnemy: {
                initialDistance: initialCoreEnemyDistance,
                distanceAfterRelease: releasedCoreEnemyDistance,
                enemyTravelDuringSustainedOverlap,
                enterEvent: coreEnterEvent,
                sustainedContactEventCount: sustainedEvents.contactEvents.length
            },
            render: {
                drawMarks,
                towerCenterAlpha,
                coreCenterAlpha
            },
            storageProfile,
            uncapturedErrorsCheckedAtRunEnd: true
        };
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
        context.unconfigure();
    }
}

function createPhase5ProjectileNavigationSource(options = {}) {
    const columns = 16;
    const rows = 16;
    const blocked = options.blocked instanceof Uint8Array
        ? options.blocked
        : new Uint8Array(columns * rows);
    assert(
        blocked.length === columns * rows,
        `Phase 5 navigation blocked size 불일치: ${blocked.length}`
    );
    const corePosition = Object.freeze({ x: 12, y: 8, row: 8, column: 12 });
    const entryPosition = Object.freeze({ x: 2, y: 8, row: 8, column: 2 });
    const route = Object.freeze({
        gateId: 'nw-phase5-projectile-gate',
        pathId: 'nw-phase5-projectile-route',
        waypoints: Object.freeze([entryPosition, corePosition])
    });
    return Object.freeze({
        corePosition,
        route,
        getNavigationGrid: () => Object.freeze({
            cols: columns,
            rows,
            size: columns * rows,
            cellSize: 1,
            sdfSubdivisions: 8,
            blocked
        }),
        getSpawnRoutes: () => Object.freeze([route]),
        getWorldBounds: () => Object.freeze({
            minX: 0,
            minY: 0,
            maxX: columns,
            maxY: rows,
            width: columns,
            height: rows
        })
    });
}

function findPhase5Body(bodies, handle, label) {
    const body = bodies.find((candidate) => (
        candidate.handle?.entityId === handle.entityId
        && candidate.handle?.incarnation === handle.incarnation
    ));
    assert(body, `Phase 5 ${label} body가 없습니다: ${JSON.stringify(handle)}`);
    return body;
}

async function settlePhase5Endpoint(endpoint, label, options = {}) {
    const simulation = endpoint.getBackend().simulation;
    assert(simulation, `${label} production simulation이 없습니다.`);
    await deviceQueueDone(simulation);
    return waitForSimulationStatus(
        simulation,
        (status) => status.overflow.pendingReadbacks === 0
            && status.events.pendingReadbacks === 0
            && (!options.spawnProgram
                || status.fixedPrimitives.spawnProgram.pendingReadbacks === 0),
        label
    );
}

async function readPhase5Bodies(endpoint) {
    const simulation = endpoint.getBackend().simulation;
    assert(
        simulation && typeof simulation.readbackBodies === 'function',
        'Phase 5 diagnostic readback 경계가 없습니다.'
    );
    const bodiesPromise = simulation.readbackBodies();
    await deviceQueueDone(simulation);
    return bodiesPromise;
}

async function readPhase5WorldAlpha(
    device,
    texture,
    worldPosition,
    cameraScale,
    label,
    viewportOrigin = null
) {
    const bytesPerRow = 256;
    const readback = device.createBuffer({
        label,
        size: bytesPerRow * canvas.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = device.createCommandEncoder({ label: `${label}-copy` });
        encoder.copyTextureToBuffer(
            { texture },
            { buffer: readback, bytesPerRow, rowsPerImage: canvas.height },
            [canvas.width, canvas.height]
        );
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const pixels = new Uint8Array(readback.getMappedRange());
        const originX = Number(viewportOrigin?.x ?? 0);
        const originY = Number(viewportOrigin?.y ?? 0);
        const x = Math.floor(originX + (worldPosition.x * cameraScale));
        const y = Math.floor(originY + (worldPosition.y * cameraScale));
        assert(
            Number.isFinite(originX)
                && Number.isFinite(originY)
                && x >= 0
                && x < canvas.width
                && y >= 0
                && y < canvas.height,
            `${label} alpha sample이 canvas bounds 밖입니다: ${JSON.stringify({ x, y, width: canvas.width, height: canvas.height, worldPosition, cameraScale, viewportOrigin })}`
        );
        return pixels[(y * bytesPerRow) + (x * 4) + 3];
    } finally {
        try {
            readback.unmap();
        } catch {
            // map 실패 또는 이미 unmap된 diagnostic buffer입니다.
        }
        readback.destroy();
    }
}

async function readPhase5CanvasAlphaPlane(device, texture, label) {
    const bytesPerRow = 256;
    const readback = device.createBuffer({
        label,
        size: bytesPerRow * canvas.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = device.createCommandEncoder({ label: `${label}-copy` });
        encoder.copyTextureToBuffer(
            { texture },
            { buffer: readback, bytesPerRow, rowsPerImage: canvas.height },
            [canvas.width, canvas.height]
        );
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const pixels = new Uint8Array(readback.getMappedRange());
        const alpha = new Uint8Array(canvas.width * canvas.height);
        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                alpha[(y * canvas.width) + x] =
                    pixels[(y * bytesPerRow) + (x * 4) + 3];
            }
        }
        return alpha;
    } finally {
        try {
            readback.unmap();
        } catch {
            // map 실패 또는 이미 unmap된 diagnostic buffer입니다.
        }
        readback.destroy();
    }
}

async function runProductionPhase5AimHardwareSmoke(device) {
    const context = canvas.getContext('webgpu');
    assert(context, 'Phase 5 projectile aim canvas WebGPU context가 없습니다.');
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
        getState: () => Object.freeze({ ready: true, status: 'ready' }),
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
    const navigationSource = createPhase5ProjectileNavigationSource();
    const endpoint = createGpuSimulationEndpoint({ webGpuPlatformPort: platformPort }, {
        capacity: 12,
        controlCommandCapacity: 4,
        sourceRelativeSpawnCommandCapacity: 8,
        spawnProgramCapacity: 4
    });
    const projectileAdapter = new GpuProjectileSpawnAdapter(endpoint, {
        commandNamespace: 'nw-phase5-basic-bullet'
    });
    const fixedDelta = 1 / 60;
    const primaryTowerPosition = Object.freeze({ x: 2, y: 2 });
    const stationaryTowerPosition = Object.freeze({ x: 2, y: 10 });
    const cardinalAim = Object.freeze({ x: 2, y: 6 });
    const cardinalOffset = Object.freeze({ x: 0.6, y: 0 });
    const commandIds = Object.freeze({
        cardinal: 'phase5:aim:cardinal',
        movingDegenerate: 'phase5:aim:moving-degenerate',
        zeroDegenerate: 'phase5:aim:zero-degenerate',
        behind: 'phase5:aim:behind',
        diagonal: 'phase5:aim:diagonal'
    });

    try {
        assert(endpoint.init(navigationSource) === false,
            'Phase 5 aim endpoint는 첫 spawn 전 deferred여야 합니다.');
        assert(endpoint.requestSpawn(
            createGpuTowerSpawnIntent({ position: primaryTowerPosition }),
            1,
            'phase5:tower:primary'
        ).accepted, 'Phase 5 primary Tower spawn request 실패');
        assert(endpoint.requestSpawn(
            createGpuTowerSpawnIntent({ position: stationaryTowerPosition }),
            1,
            'phase5:tower:stationary'
        ).accepted, 'Phase 5 stationary Tower spawn request 실패');
        const spawnCommit = endpoint.commitAtFixedBoundary(1);
        assert(
            spawnCommit.state === 'committed'
                && spawnCommit.spawned.length === 2,
            `Phase 5 Tower spawn commit 실패: ${JSON.stringify(spawnCommit)}`
        );
        const handleByCommandId = new Map(
            spawnCommit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        const primaryTowerHandle = handleByCommandId.get('phase5:tower:primary');
        const stationaryTowerHandle = handleByCommandId.get('phase5:tower:stationary');
        assert(primaryTowerHandle && stationaryTowerHandle,
            'Phase 5 Tower exact handle이 없습니다.');
        assert(endpoint.fixedUpdate(fixedDelta, 1), 'Phase 5 Tower initial submit 실패');
        await settlePhase5Endpoint(endpoint, 'Phase 5 Tower initial completion');
        const initialBodies = await readPhase5Bodies(endpoint);
        const primaryTickStart = findPhase5Body(
            initialBodies,
            primaryTowerHandle,
            'primary Tower tick-start'
        );
        const stationaryTickStart = findPhase5Body(
            initialBodies,
            stationaryTowerHandle,
            'stationary Tower tick-start'
        );

        endpoint.commitCompletedEventsAtFixedBoundary(2);
        const cardinalRequest = projectileAdapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
            definition: BASIC_BULLET_PROJECTILE_DATA,
            sourceHandle: primaryTowerHandle,
            positionOffset: cardinalOffset,
            aimWorldPoint: cardinalAim,
            launchSpeed: BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
            producerId: BASIC_BULLET_PRODUCER_ID,
            targetFixedTick: 2,
            spawnSequence: 0,
            commandId: commandIds.cardinal
        });
        const sameTickControl = endpoint.requestBodyControl({
            handle: primaryTowerHandle,
            moveIntentX: 1,
            moveIntentY: 0
        }, 2, 'phase5:control:same-tick-cardinal');
        assert(cardinalRequest.accepted && sameTickControl.accepted,
            `Phase 5 same-tick aim/control request 실패: ${JSON.stringify({ cardinalRequest, sameTickControl })}`);
        const cardinalCommit = endpoint.commitAtFixedBoundary(2);
        assert(
            cardinalCommit.state === 'committed'
                && cardinalCommit.fixedCommands.controls.length === 1
                && cardinalCommit.fixedCommands.sourceRelativeSpawns.length === 1
                && cardinalCommit.fixedCommands.rejected.length === 0,
            `Phase 5 same-tick aim/control commit 실패: ${JSON.stringify(cardinalCommit)}`
        );
        const cardinalHandle = cardinalCommit.fixedCommands
            .sourceRelativeSpawns[0].handle;
        assert(endpoint.fixedUpdate(fixedDelta, 2),
            'Phase 5 same-tick aim/control submit 실패');
        await settlePhase5Endpoint(
            endpoint,
            'Phase 5 cardinal SpawnProgram completion',
            { spawnProgram: true }
        );
        const cardinalBodies = await readPhase5Bodies(endpoint);
        const primaryAfterControl = findPhase5Body(
            cardinalBodies,
            primaryTowerHandle,
            'primary Tower after control'
        );
        const cardinalBullet = findPhase5Body(
            cardinalBodies,
            cardinalHandle,
            'cardinal Basic Bullet'
        );
        const expectedCardinalOrigin = Object.freeze({
            x: primaryTickStart.position.x + cardinalOffset.x,
            y: primaryTickStart.position.y + cardinalOffset.y
        });
        assertNear(cardinalBullet.previousPosition.x, expectedCardinalOrigin.x,
            0.00002, 'Phase 5 cardinal origin.x');
        assertNear(cardinalBullet.previousPosition.y, expectedCardinalOrigin.y,
            0.00002, 'Phase 5 cardinal origin.y');
        assertNear(cardinalBullet.velocity.x, 0, 0.00002,
            'Phase 5 cardinal velocity.x');
        assertNear(
            cardinalBullet.velocity.y,
            BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
            0.00002,
            'Phase 5 cardinal velocity.y'
        );
        const cardinalSpeed = Math.hypot(
            cardinalBullet.velocity.x,
            cardinalBullet.velocity.y
        );
        assertNear(
            cardinalSpeed,
            BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
            0.00002,
            'Phase 5 cardinal Basic Bullet speed'
        );
        const controlMovementDelta = Object.freeze({
            x: primaryAfterControl.position.x - primaryTickStart.position.x,
            y: primaryAfterControl.position.y - primaryTickStart.position.y
        });
        assert(controlMovementDelta.x > 0,
            `Phase 5 same submit Tower control이 이동하지 않았습니다: ${JSON.stringify(controlMovementDelta)}`);
        const postControlAimDeltaX = cardinalAim.x - primaryAfterControl.position.x;
        assert(
            postControlAimDeltaX < 0 && Math.abs(cardinalBullet.velocity.x) < 0.00002,
            `Basic Bullet aim이 post-control Tower 위치를 사용했습니다: ${JSON.stringify({ postControlAimDeltaX, bulletVelocityX: cardinalBullet.velocity.x })}`
        );

        endpoint.commitCompletedEventsAtFixedBoundary(3);
        const cardinalView = endpoint.getRegistry().copyEntityView(cardinalHandle, {});
        const defaultBasicBulletInteractionMask =
            GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN;
        const cardinalInteractionMask = unpackGpuCircleInteractionMeta(
            cardinalBullet.interactionMeta
        ).interactionMask;
        assert(
            cardinalView?.metadata?.sourceEntityId === primaryTowerHandle.entityId
                && cardinalView.metadata.sourceIncarnation
                    === primaryTowerHandle.incarnation
                && cardinalView.metadata.producerId === BASIC_BULLET_PRODUCER_ID
                && cardinalView.metadata.targetPolicyId
                    === PROJECTILE_TARGET_POLICY_ID.ENEMY_AND_TERRAIN
                && cardinalInteractionMask
                    === defaultBasicBulletInteractionMask,
            `Phase 5 exact source provenance가 registry에 없습니다: ${JSON.stringify(cardinalView)}`
        );

        const movingDegenerateRequest = projectileAdapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
            definition: BASIC_BULLET_PROJECTILE_DATA,
            sourceHandle: primaryTowerHandle,
            positionOffset: { x: 0.6, y: -0.6 },
            aimWorldPoint: { ...primaryAfterControl.position },
            launchSpeed: BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
            producerId: BASIC_BULLET_PRODUCER_ID,
            targetFixedTick: 3,
            spawnSequence: 1,
            commandId: commandIds.movingDegenerate
        });
        const zeroDegenerateRequest = projectileAdapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
            definition: BASIC_BULLET_PROJECTILE_DATA,
            sourceHandle: stationaryTowerHandle,
            positionOffset: { x: 0, y: 0.6 },
            aimWorldPoint: { ...stationaryTickStart.position },
            launchSpeed: BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
            producerId: BASIC_BULLET_PRODUCER_ID,
            targetFixedTick: 3,
            spawnSequence: 2,
            commandId: commandIds.zeroDegenerate
        });
        const behindRequest = projectileAdapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
            definition: BASIC_BULLET_PROJECTILE_DATA,
            sourceHandle: stationaryTowerHandle,
            positionOffset: { x: 0, y: -0.6 },
            aimWorldPoint: { x: 0, y: stationaryTickStart.position.y },
            launchSpeed: BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
            producerId: BASIC_BULLET_PRODUCER_ID,
            targetFixedTick: 3,
            spawnSequence: 3,
            commandId: commandIds.behind
        });
        const diagonalRequest = projectileAdapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
            definition: BASIC_BULLET_PROJECTILE_DATA,
            sourceHandle: stationaryTowerHandle,
            positionOffset: { x: 0.6, y: 0.6 },
            aimWorldPoint: { x: 6, y: 14 },
            launchSpeed: BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
            producerId: BASIC_BULLET_PRODUCER_ID,
            targetFixedTick: 3,
            spawnSequence: 4,
            commandId: commandIds.diagonal
        });
        assert([
            movingDegenerateRequest,
            zeroDegenerateRequest,
            behindRequest,
            diagonalRequest
        ].every(({ accepted }) => accepted),
        'Phase 5 degenerate/behind/diagonal request 중 하나가 거부되었습니다.');
        const fallbackCommit = endpoint.commitAtFixedBoundary(3);
        assert(
            fallbackCommit.fixedCommands.sourceRelativeSpawns.length === 4
                && fallbackCommit.fixedCommands.rejected.length === 0,
            `Phase 5 aim fallback batch commit 실패: ${JSON.stringify(fallbackCommit)}`
        );
        const fallbackHandleByCommandId = new Map(
            fallbackCommit.fixedCommands.sourceRelativeSpawns.map(
                ({ commandId, handle }) => [commandId, handle]
            )
        );
        assert(endpoint.fixedUpdate(fixedDelta, 3),
            'Phase 5 aim fallback submit 실패');
        await settlePhase5Endpoint(
            endpoint,
            'Phase 5 aim fallback completion',
            { spawnProgram: true }
        );
        const fallbackBodies = await readPhase5Bodies(endpoint);
        const movingDegenerateBullet = findPhase5Body(
            fallbackBodies,
            fallbackHandleByCommandId.get(commandIds.movingDegenerate),
            'moving degenerate Basic Bullet'
        );
        const zeroDegenerateBullet = findPhase5Body(
            fallbackBodies,
            fallbackHandleByCommandId.get(commandIds.zeroDegenerate),
            'zero degenerate Basic Bullet'
        );
        const behindBullet = findPhase5Body(
            fallbackBodies,
            fallbackHandleByCommandId.get(commandIds.behind),
            'behind Basic Bullet'
        );
        const diagonalBullet = findPhase5Body(
            fallbackBodies,
            fallbackHandleByCommandId.get(commandIds.diagonal),
            'diagonal Basic Bullet'
        );
        const cardinalBulletAtDraw = findPhase5Body(
            fallbackBodies,
            cardinalHandle,
            'cardinal Basic Bullet at draw tick'
        );
        const sourceVelocityMagnitude = Math.hypot(
            primaryAfterControl.velocity.x,
            primaryAfterControl.velocity.y
        );
        const expectedMovingFallback = Object.freeze({
            x: (primaryAfterControl.velocity.x / sourceVelocityMagnitude)
                * BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
            y: (primaryAfterControl.velocity.y / sourceVelocityMagnitude)
                * BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond
        });
        assertNear(movingDegenerateBullet.velocity.x, expectedMovingFallback.x,
            0.00003, 'Phase 5 moving-degenerate velocity.x');
        assertNear(movingDegenerateBullet.velocity.y, expectedMovingFallback.y,
            0.00003, 'Phase 5 moving-degenerate velocity.y');
        assertNear(zeroDegenerateBullet.velocity.x,
            BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
            0.00002, 'Phase 5 zero-degenerate +X velocity.x');
        assertNear(zeroDegenerateBullet.velocity.y, 0, 0.00002,
            'Phase 5 zero-degenerate +X velocity.y');
        assertNear(behindBullet.velocity.x,
            -BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
            0.00002, 'Phase 5 behind velocity.x');
        assertNear(behindBullet.velocity.y, 0, 0.00002,
            'Phase 5 behind velocity.y');
        const diagonalComponent = BASIC_BULLET_WEAPON_DATA
            .projectileSpeedTilesPerSecond / Math.sqrt(2);
        assertNear(diagonalBullet.velocity.x, diagonalComponent, 0.00003,
            'Phase 5 diagonal velocity.x');
        assertNear(diagonalBullet.velocity.y, diagonalComponent, 0.00003,
            'Phase 5 diagonal velocity.y');

        const cameraScale = 4;
        endpoint.updatePresentation({
            frameDelta: 0,
            fixedDelta,
            fixedAlpha: 1,
            renderFrameId: 5101
        });
        assert(endpoint.draw({
            worldToViewport(x, y, out) {
                out.x = x * cameraScale;
                out.y = y * cameraScale;
                return out;
            },
            getScale: () => cameraScale
        }), 'Phase 5 Basic Bullet direct draw 실패');
        assert(lastFrameTexture, 'Phase 5 Basic Bullet draw texture가 없습니다.');
        const bulletCenterAlpha = await readPhase5WorldAlpha(
            device,
            lastFrameTexture,
            cardinalBulletAtDraw.position,
            cameraScale,
            'phase5-basic-bullet-render-readback'
        );
        assert(
            drawMarks === 1 && bulletCenterAlpha > 0,
            `Phase 5 Basic Bullet visible render 실패: drawMarks=${drawMarks}, alpha=${bulletCenterAlpha}`
        );
        const finalStatus = endpoint.getStatus();
        assert(
            !finalStatus.recoveryRequired
                && finalStatus.backend.gpu.fixedPrimitives.storageProfile.requiredMaximum
                    === REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE,
            `Phase 5 aim endpoint recovery/storage 상태 불일치: ${JSON.stringify(finalStatus)}`
        );
        return {
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
            basicBulletDefinitionId: BASIC_BULLET_PROJECTILE_DATA.id,
            producerId: BASIC_BULLET_PRODUCER_ID,
            handles: {
                primaryTower: primaryTowerHandle,
                stationaryTower: stationaryTowerHandle,
                cardinalBullet: cardinalHandle
            },
            sameTick: {
                towerTickStartPosition: { ...primaryTickStart.position },
                towerCurrentPosition: { ...primaryAfterControl.position },
                towerCurrentVelocity: { ...primaryAfterControl.velocity },
                controlMovementDelta,
                aimWorldPoint: cardinalAim,
                positionOffset: cardinalOffset,
                bulletMaterializedOrigin: { ...cardinalBullet.previousPosition },
                bulletIntegratedPosition: { ...cardinalBullet.position },
                bulletVelocity: { ...cardinalBullet.velocity },
                bulletSpeed: cardinalSpeed,
                cpuProjectilePositionAuthored: false
            },
            degenerate: {
                movingSourceVelocity: { ...primaryAfterControl.velocity },
                movingFallbackVelocity: { ...movingDegenerateBullet.velocity },
                zeroVelocityFallback: { ...zeroDegenerateBullet.velocity }
            },
            behindVelocity: { ...behindBullet.velocity },
            diagonalVelocity: { ...diagonalBullet.velocity },
            provenance: cardinalView.metadata,
            defaultTargetPolicy: {
                id: cardinalView.metadata.targetPolicyId,
                interactionMask: cardinalInteractionMask
            },
            render: { drawMarks, bulletCenterAlpha },
            storageProfile: finalStatus.backend.gpu.fixedPrimitives.storageProfile
        };
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
        context.unconfigure();
    }
}

function createTargetEntityHardwareProjectileDefinition(id, overrides = {}) {
    return Object.freeze({
        id,
        collisionRadius: 0.18,
        inverseMass: 1,
        penetration: 9,
        damage: 5,
        damageSelf: 5,
        lifetimeSeconds: 5,
        killOnTerrain: false,
        closestOnly: true,
        continuousInteraction: true,
        colorRgba: [1, 0.25, 0.1, 1],
        radiusScale: 1,
        visible: true,
        ...overrides
    });
}

async function runProductionTargetEntityMovingAimHardwareSmoke(device) {
    const navigationSource = createPhase5ProjectileNavigationSource();
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPhase3PlatformPort(device)
    }, {
        capacity: 4,
        controlCommandCapacity: 2,
        sourceRelativeSpawnCommandCapacity: 2,
        spawnProgramCapacity: 2
    });
    const adapter = new GpuProjectileSpawnAdapter(endpoint, {
        commandNamespace: 'nw-target-entity-moving-aim'
    });
    const fixedDelta = 1 / 60;
    const sourcePosition = Object.freeze({ x: 2, y: 8 });
    const targetPosition = Object.freeze({ x: 7, y: 10 });
    const positionOffset = Object.freeze({ x: 0.35, y: 0.1 });
    const targetOffset = Object.freeze({ x: 0.5, y: -0.25 });
    const launchSpeed = 12;
    const projectileDefinition = createTargetEntityHardwareProjectileDefinition(
        'nw_target_entity_moving_aim',
        { penetration: 3, damage: 1, damageSelf: 1 }
    );

    try {
        assert(
            endpoint.init(navigationSource) === false,
            'Target-entity moving aim endpoint는 첫 spawn 전 deferred여야 합니다.'
        );
        const sourceIntent = Object.freeze({
            ...createGpuEnemySpawnIntent({
                definition: {
                    ...BASIC_CIRCLE_ENEMY_DATA,
                    id: 'nw_target_entity_moving_source',
                    maxHealth: 20
                },
                route: navigationSource.route,
                spawnSequence: 0,
                waveId: 'nw-target-entity-moving-aim',
                policyId: 'hardware-fixture'
            }),
            position: sourcePosition
        });
        const requests = [
            endpoint.requestSpawn(
                sourceIntent,
                1,
                'target-entity:moving:source'
            ),
            endpoint.requestSpawn(
                createGpuTowerSpawnIntent({ position: targetPosition }),
                1,
                'target-entity:moving:target'
            )
        ];
        assert(
            requests.every(({ accepted }) => accepted),
            `Target-entity moving source/target request 실패: ${JSON.stringify(requests)}`
        );
        const initialCommit = endpoint.commitAtFixedBoundary(1);
        const handleByCommandId = new Map(
            initialCommit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        const sourceHandle = handleByCommandId.get('target-entity:moving:source');
        const targetHandle = handleByCommandId.get('target-entity:moving:target');
        assert(
            initialCommit.state === 'committed'
                && initialCommit.spawned.length === 2
                && sourceHandle
                && targetHandle,
            `Target-entity moving initial commit 실패: ${JSON.stringify(initialCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, 1),
            'Target-entity moving initial fixed submit 실패'
        );
        await settlePhase5Endpoint(endpoint, 'Target-entity moving initial completion');
        const tickStartBodies = await readPhase5Bodies(endpoint);
        const sourceTickStart = findPhase5Body(
            tickStartBodies,
            sourceHandle,
            'target-entity moving source tick-start'
        );
        const targetTickStart = findPhase5Body(
            tickStartBodies,
            targetHandle,
            'target-entity moving target tick-start'
        );
        assert(
            Math.hypot(sourceTickStart.velocity.x, sourceTickStart.velocity.y) > 0,
            `Target-entity Enemy-like source가 움직이지 않습니다: ${JSON.stringify(sourceTickStart)}`
        );

        endpoint.commitCompletedEventsAtFixedBoundary(2);
        const shotRequest = adapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
            definition: projectileDefinition,
            sourceHandle,
            targetHandle,
            positionOffset,
            targetOffset,
            launchSpeed,
            allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
            targetPolicyId:
                PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
            producerId: 'nw-target-entity-moving-producer',
            sourceAbilityId: 'target-entity-moving-shot',
            targetFixedTick: 2,
            spawnSequence: 0,
            commandId: 'target-entity:moving:shot'
        });
        const targetControl = endpoint.requestBodyControl({
            handle: targetHandle,
            moveIntentX: 0,
            moveIntentY: 1
        }, 2, 'target-entity:moving:target-control');
        assert(
            shotRequest.accepted && targetControl.accepted,
            `Target-entity moving shot/control request 실패: ${JSON.stringify({ shotRequest, targetControl })}`
        );
        const shotCommit = endpoint.commitAtFixedBoundary(2);
        const projectileHandle = shotCommit.fixedCommands
            .sourceRelativeSpawns[0]?.handle;
        assert(
            shotCommit.state === 'committed'
                && shotCommit.fixedCommands.controls.length === 1
                && shotCommit.fixedCommands.sourceRelativeSpawns.length === 1
                && shotCommit.fixedCommands.rejected.length === 0
                && projectileHandle,
            `Target-entity moving shot commit 실패: ${JSON.stringify(shotCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, 2),
            'Target-entity moving shot fixed submit 실패'
        );
        await settlePhase5Endpoint(
            endpoint,
            'Target-entity moving SpawnProgram completion',
            { spawnProgram: true }
        );
        const afterBodies = await readPhase5Bodies(endpoint);
        const sourceAfter = findPhase5Body(
            afterBodies,
            sourceHandle,
            'target-entity moving source after submit'
        );
        const targetAfter = findPhase5Body(
            afterBodies,
            targetHandle,
            'target-entity moving target after submit'
        );
        const projectile = findPhase5Body(
            afterBodies,
            projectileHandle,
            'target-entity moving projectile'
        );
        const delta = Object.freeze({
            x: targetTickStart.position.x
                + targetOffset.x
                - sourceTickStart.position.x,
            y: targetTickStart.position.y
                + targetOffset.y
                - sourceTickStart.position.y
        });
        const deltaMagnitude = Math.hypot(delta.x, delta.y);
        const expectedOrigin = Object.freeze({
            x: sourceTickStart.position.x + positionOffset.x,
            y: sourceTickStart.position.y + positionOffset.y
        });
        const expectedVelocity = Object.freeze({
            x: (delta.x / deltaMagnitude) * launchSpeed,
            y: (delta.y / deltaMagnitude) * launchSpeed
        });
        assertNear(
            projectile.previousPosition.x,
            expectedOrigin.x,
            0.00003,
            'Target-entity moving origin.x'
        );
        assertNear(
            projectile.previousPosition.y,
            expectedOrigin.y,
            0.00003,
            'Target-entity moving origin.y'
        );
        assertNear(
            projectile.velocity.x,
            expectedVelocity.x,
            0.00004,
            'Target-entity moving velocity.x'
        );
        assertNear(
            projectile.velocity.y,
            expectedVelocity.y,
            0.00004,
            'Target-entity moving velocity.y'
        );
        assertNear(
            projectile.position.x,
            expectedOrigin.x + (expectedVelocity.x * fixedDelta),
            0.00005,
            'Target-entity moving integrated position.x'
        );
        assertNear(
            projectile.position.y,
            expectedOrigin.y + (expectedVelocity.y * fixedDelta),
            0.00005,
            'Target-entity moving integrated position.y'
        );
        const sourceMovement = Math.hypot(
            sourceAfter.position.x - sourceTickStart.position.x,
            sourceAfter.position.y - sourceTickStart.position.y
        );
        const targetMovement = Math.hypot(
            targetAfter.position.x - targetTickStart.position.x,
            targetAfter.position.y - targetTickStart.position.y
        );
        assert(
            sourceMovement > 0 && targetMovement > 0,
            `Target-entity same-tick source/target 이동 증거가 없습니다: ${JSON.stringify({ sourceMovement, targetMovement })}`
        );

        endpoint.commitCompletedEventsAtFixedBoundary(3);
        const projectileView = endpoint.getRegistry().copyEntityView(
            projectileHandle,
            {}
        );
        const completion = endpoint.getStatus().fixedCommands.lastCompletionResult;
        assert(
            completion.protocolFailure === null
                && completion.completed.length === 1
                && completion.completed[0].outcome === 'resolved'
                && projectileView?.metadata?.sourceEntityId === sourceHandle.entityId
                && projectileView.metadata.sourceIncarnation
                    === sourceHandle.incarnation
                && projectileView.metadata.targetEntityId === targetHandle.entityId
                && projectileView.metadata.targetIncarnation
                    === targetHandle.incarnation
                && projectileView.metadata.teamId === GAMEPLAY_TEAM_ID.HOSTILE
                && projectileView.metadata.targetPolicyId
                    === PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
            `Target-entity moving completion/provenance 불일치: ${JSON.stringify({ completion, projectileView })}`
        );
        const status = endpoint.getStatus();
        assert(
            !status.recoveryRequired
                && status.reservedCount === 0
                && status.backend.gpu.fixedPrimitives.spawnProgram.abiVersion === 3
                && GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.STRIDE === 80
                && status.backend.gpu.fixedPrimitives.storageProfile.requiredMaximum
                    === REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE,
            `Target-entity moving recovery/storage 불일치: ${JSON.stringify(status)}`
        );
        return Object.freeze({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
            handles: Object.freeze({ source: sourceHandle, target: targetHandle }),
            targetProvenance: Object.freeze({
                targetEntityId: projectileView.metadata.targetEntityId,
                targetIncarnation: projectileView.metadata.targetIncarnation
            }),
            fixedDelta,
            launchSpeed,
            positionOffset,
            targetOffset,
            tickStart: Object.freeze({
                sourcePosition: Object.freeze({ ...sourceTickStart.position }),
                sourceVelocity: Object.freeze({ ...sourceTickStart.velocity }),
                targetPosition: Object.freeze({ ...targetTickStart.position }),
                targetVelocity: Object.freeze({ ...targetTickStart.velocity })
            }),
            afterSameTickMotion: Object.freeze({
                sourcePosition: Object.freeze({ ...sourceAfter.position }),
                sourceVelocity: Object.freeze({ ...sourceAfter.velocity }),
                targetPosition: Object.freeze({ ...targetAfter.position }),
                targetVelocity: Object.freeze({ ...targetAfter.velocity }),
                sourceMovement,
                targetMovement
            }),
            projectile: Object.freeze({
                origin: Object.freeze({ ...projectile.previousPosition }),
                integratedPosition: Object.freeze({ ...projectile.position }),
                velocity: Object.freeze({ ...projectile.velocity }),
                expectedOrigin,
                expectedVelocity
            }),
            completion: completion.completed[0],
            spawnProgramAbi: Object.freeze({
                version: status.backend.gpu.fixedPrimitives.spawnProgram.abiVersion,
                recordStride: GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.STRIDE
            }),
            storageProfile:
                status.backend.gpu.fixedPrimitives.storageProfile
        });
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionTargetEntityFallbackHardwareSmoke(device) {
    const simulation = new GpuCircleBodySimulation(
        createPhase3PlatformPort(device),
        {
            capacity: 9,
            worldSize: { x: 16, y: 16 },
            gridCellSize: { x: 2, y: 2 },
            spawnProgramCapacity: 3,
            sessionGeneration: 71
        }
    );
    const fixedDelta = 1 / 60;
    const launchSpeed = 12;
    const movingSource = createPhase3Body({
        entityId: 9901,
        incarnation: 1,
        position: { x: 3, y: 3 },
        velocity: { x: 3, y: 4 }
    });
    const movingTarget = createPhase3Body({
        entityId: 9902,
        incarnation: 1,
        position: { x: 3, y: 3 }
    });
    const zeroSource = createPhase3Body({
        entityId: 9903,
        incarnation: 1,
        position: { x: 9, y: 9 },
        velocity: { x: 0, y: 0 }
    });
    const zeroTarget = createPhase3Body({
        entityId: 9904,
        incarnation: 1,
        position: { x: 9, y: 9 }
    });
    const behindSource = createPhase3Body({
        entityId: 9907,
        incarnation: 1,
        position: { x: 12, y: 6 },
        velocity: { x: 0, y: 0 }
    });
    const behindTarget = createPhase3Body({
        entityId: 9908,
        incarnation: 1,
        position: { x: 8, y: 6 }
    });
    const movingDestination = Object.freeze({ entityId: 9905, incarnation: 1 });
    const zeroDestination = Object.freeze({ entityId: 9906, incarnation: 1 });
    const behindDestination = Object.freeze({ entityId: 9909, incarnation: 1 });
    const targetOffset = Object.freeze({ x: 0, y: 0 });

    try {
        assert(simulation.init(), 'Target-entity fallback simulation init 실패');
        const spawned = simulation.spawnBodies([
            movingSource,
            movingTarget,
            zeroSource,
            zeroTarget,
            behindSource,
            behindTarget
        ]);
        assert(
            spawned.accepted === 6 && spawned.rejected === 0,
            `Target-entity fallback source/target spawn 실패: ${JSON.stringify(spawned)}`
        );
        const staged = simulation.stageFixedPrograms({
            targetFixedTick: 1,
            controls: [],
            sourceRelativeSpawns: [
                {
                    sourceHandle: movingSource,
                    targetHandle: movingTarget,
                    destinationHandle: movingDestination,
                    destinationSpawn: createPhase3Body({
                        position: { x: 0, y: 0 },
                        velocity: { x: 0, y: 0 }
                    }),
                    modeFlags:
                        GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
                    positionOffset: { x: 0, y: 0 },
                    targetOffset,
                    launchSpeed
                },
                {
                    sourceHandle: zeroSource,
                    targetHandle: zeroTarget,
                    destinationHandle: zeroDestination,
                    destinationSpawn: createPhase3Body({
                        position: { x: 0, y: 0 },
                        velocity: { x: 0, y: 0 }
                    }),
                    modeFlags:
                        GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
                    positionOffset: { x: 0, y: 0 },
                    targetOffset,
                    launchSpeed
                },
                {
                    sourceHandle: behindSource,
                    targetHandle: behindTarget,
                    destinationHandle: behindDestination,
                    destinationSpawn: createPhase3Body({
                        position: { x: 0, y: 0 },
                        velocity: { x: 0, y: 0 }
                    }),
                    modeFlags:
                        GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
                    positionOffset: { x: 0, y: 0 },
                    targetOffset,
                    launchSpeed
                }
            ]
        });
        assert(
            staged.sourceRelativeSpawns.accepted === 3
                && staged.sourceRelativeSpawns.rejected === 0
                && !staged.requiresRecovery,
            `Target-entity fallback program stage 실패: ${JSON.stringify(staged)}`
        );
        assert(
            simulation.fixedUpdate(fixedDelta, 1),
            'Target-entity fallback fixed submit 실패'
        );
        await device.queue.onSubmittedWorkDone();
        await waitForSimulationStatus(
            simulation,
            (status) => status.fixedPrimitives.spawnProgram.pendingReadbacks === 0
                && status.fixedPrimitives.spawnProgram.queuedBatches === 1,
            'Target-entity fallback SpawnProgram completion'
        );
        const completedBatches = simulation.drainCompletedSpawnProgramBatches([]);
        assert(
            completedBatches.length === 1
                && completedBatches[0].failure === null
                && completedBatches[0].outcomes.length === 3
                && completedBatches[0].outcomes.every((outcome) => (
                    outcome.reason === 'resolved'
                        && outcome.result === GPU_SPAWN_PROGRAM_RESULT.RESOLVED
                )),
            `Target-entity fallback outcome 불일치: ${JSON.stringify(completedBatches)}`
        );
        const bodies = await simulation.readbackBodies();
        const movingProjectile = findPhase5Body(
            bodies,
            movingDestination,
            'target-entity moving-source fallback projectile'
        );
        const zeroProjectile = findPhase5Body(
            bodies,
            zeroDestination,
            'target-entity +X fallback projectile'
        );
        const behindProjectile = findPhase5Body(
            bodies,
            behindDestination,
            'target-entity target-behind-source projectile'
        );
        const expectedMovingVelocity = Object.freeze({ x: 7.2, y: 9.6 });
        const expectedZeroVelocity = Object.freeze({ x: 12, y: 0 });
        const expectedBehindVelocity = Object.freeze({ x: -12, y: 0 });
        assertNear(
            movingProjectile.velocity.x,
            expectedMovingVelocity.x,
            0.00003,
            'Target-entity moving-source fallback velocity.x'
        );
        assertNear(
            movingProjectile.velocity.y,
            expectedMovingVelocity.y,
            0.00003,
            'Target-entity moving-source fallback velocity.y'
        );
        assertNear(
            zeroProjectile.velocity.x,
            expectedZeroVelocity.x,
            0.00003,
            'Target-entity +X fallback velocity.x'
        );
        assertNear(
            zeroProjectile.velocity.y,
            expectedZeroVelocity.y,
            0.00003,
            'Target-entity +X fallback velocity.y'
        );
        assertNear(
            behindProjectile.velocity.x,
            expectedBehindVelocity.x,
            0.00003,
            'Target-entity target-behind-source velocity.x'
        );
        assertNear(
            behindProjectile.velocity.y,
            expectedBehindVelocity.y,
            0.00003,
            'Target-entity target-behind-source velocity.y'
        );
        assertNear(
            movingProjectile.previousPosition.x,
            movingSource.position.x,
            0.00002,
            'Target-entity moving fallback origin.x'
        );
        assertNear(
            movingProjectile.previousPosition.y,
            movingSource.position.y,
            0.00002,
            'Target-entity moving fallback origin.y'
        );
        assertNear(
            zeroProjectile.previousPosition.x,
            zeroSource.position.x,
            0.00002,
            'Target-entity +X fallback origin.x'
        );
        assertNear(
            zeroProjectile.previousPosition.y,
            zeroSource.position.y,
            0.00002,
            'Target-entity +X fallback origin.y'
        );
        assertNear(
            behindProjectile.previousPosition.x,
            behindSource.position.x,
            0.00002,
            'Target-entity target-behind-source origin.x'
        );
        assertNear(
            behindProjectile.previousPosition.y,
            behindSource.position.y,
            0.00002,
            'Target-entity target-behind-source origin.y'
        );
        const status = simulation.getStatus();
        assert(
            status.fixedPrimitives.spawnProgram.resolvedCount >= 3
                && status.fixedPrimitives.storageProfile.requiredMaximum
                    === REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE
                && !status.requiresAuthoritativeRebuild,
            `Target-entity fallback telemetry/storage 불일치: ${JSON.stringify(status)}`
        );
        return Object.freeze({
            launchSpeed,
            movingSource: Object.freeze({
                sourceHandle: Object.freeze({
                    entityId: movingSource.entityId,
                    incarnation: movingSource.incarnation
                }),
                targetHandle: Object.freeze({
                    entityId: movingTarget.entityId,
                    incarnation: movingTarget.incarnation
                }),
                sourcePosition: Object.freeze({ ...movingSource.position }),
                sourceVelocity: Object.freeze({ ...movingSource.velocity }),
                projectileOrigin:
                    Object.freeze({ ...movingProjectile.previousPosition }),
                projectileVelocity: Object.freeze({ ...movingProjectile.velocity }),
                expectedVelocity: expectedMovingVelocity
            }),
            fullyDegenerate: Object.freeze({
                sourceHandle: Object.freeze({
                    entityId: zeroSource.entityId,
                    incarnation: zeroSource.incarnation
                }),
                targetHandle: Object.freeze({
                    entityId: zeroTarget.entityId,
                    incarnation: zeroTarget.incarnation
                }),
                sourcePosition: Object.freeze({ ...zeroSource.position }),
                sourceVelocity: Object.freeze({ ...zeroSource.velocity }),
                projectileOrigin:
                    Object.freeze({ ...zeroProjectile.previousPosition }),
                projectileVelocity: Object.freeze({ ...zeroProjectile.velocity }),
                expectedVelocity: expectedZeroVelocity
            }),
            targetBehindSource: Object.freeze({
                sourceHandle: Object.freeze({
                    entityId: behindSource.entityId,
                    incarnation: behindSource.incarnation
                }),
                targetHandle: Object.freeze({
                    entityId: behindTarget.entityId,
                    incarnation: behindTarget.incarnation
                }),
                sourcePosition: Object.freeze({ ...behindSource.position }),
                targetPosition: Object.freeze({ ...behindTarget.position }),
                projectileOrigin:
                    Object.freeze({ ...behindProjectile.previousPosition }),
                projectileVelocity: Object.freeze({ ...behindProjectile.velocity }),
                expectedVelocity: expectedBehindVelocity
            }),
            completedOutcomeCount: completedBatches[0].outcomes.length,
            storageProfile: status.fixedPrimitives.storageProfile
        });
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionTargetEntityDamageCaseHardwareSmoke(
    device,
    options
) {
    const hostile = options.hostile === true;
    const caseId = hostile ? 'hostile-to-player' : 'player-to-player';
    const navigationSource = createPhase5ProjectileNavigationSource();
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPhase3PlatformPort(device)
    }, {
        capacity: 3,
        controlCommandCapacity: 1,
        sourceRelativeSpawnCommandCapacity: 1,
        spawnProgramCapacity: 1
    });
    const adapter = new GpuProjectileSpawnAdapter(endpoint, {
        commandNamespace: `nw-target-entity-${caseId}`
    });
    const fixedDelta = 1 / 60;
    const y = hostile ? 8 : 4;
    const sourcePosition = Object.freeze({ x: 2, y });
    const targetPosition = Object.freeze({ x: 4, y });
    const positionOffset = Object.freeze({ x: hostile ? 1.35 : 1.4, y: 0 });
    const launchSpeed = 12;
    const projectileDefinition = createTargetEntityHardwareProjectileDefinition(
        `nw_target_entity_${caseId.replaceAll('-', '_')}`
    );

    try {
        assert(
            endpoint.init(navigationSource) === false,
            `Target-entity ${caseId} endpoint는 첫 spawn 전 deferred여야 합니다.`
        );
        const sourceIntent = hostile
            ? Object.freeze({
                ...createGpuEnemySpawnIntent({
                    definition: {
                        ...BASIC_CIRCLE_ENEMY_DATA,
                        id: 'nw_target_entity_hostile_source',
                        maxHealth: 20
                    },
                    route: navigationSource.route,
                    spawnSequence: 0,
                    waveId: 'nw-target-entity-hostile-damage',
                    policyId: 'hardware-fixture'
                }),
                position: sourcePosition
            })
            : createGpuTowerSpawnIntent({ position: sourcePosition });
        const spawnRequests = [
            endpoint.requestSpawn(
                sourceIntent,
                1,
                `target-entity:${caseId}:source`
            ),
            endpoint.requestSpawn(
                createGpuTowerSpawnIntent({ position: targetPosition }),
                1,
                `target-entity:${caseId}:target`
            )
        ];
        assert(
            spawnRequests.every(({ accepted }) => accepted),
            `Target-entity ${caseId} source/target request 실패: ${JSON.stringify(spawnRequests)}`
        );
        const spawnCommit = endpoint.commitAtFixedBoundary(1);
        const handles = new Map(
            spawnCommit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        const sourceHandle = handles.get(`target-entity:${caseId}:source`);
        const targetHandle = handles.get(`target-entity:${caseId}:target`);
        assert(
            sourceHandle && targetHandle && spawnCommit.spawned.length === 2,
            `Target-entity ${caseId} exact handles 누락: ${JSON.stringify(spawnCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, 1),
            `Target-entity ${caseId} initial fixed submit 실패`
        );
        await settlePhase5Endpoint(
            endpoint,
            `Target-entity ${caseId} initial completion`
        );
        const beforeBodies = await readPhase5Bodies(endpoint);
        const sourceBefore = findPhase5Body(
            beforeBodies,
            sourceHandle,
            `${caseId} source before target shot`
        );
        const targetBefore = findPhase5Body(
            beforeBodies,
            targetHandle,
            `${caseId} target before target shot`
        );
        endpoint.commitCompletedEventsAtFixedBoundary(2);

        const shotRequest = adapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
            definition: projectileDefinition,
            sourceHandle,
            targetHandle,
            positionOffset,
            targetOffset: { x: 0, y: 0 },
            launchSpeed,
            allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
            targetPolicyId:
                PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
            producerId: `nw-target-entity-${caseId}-producer`,
            sourceAbilityId: `target-entity-${caseId}-shot`,
            targetFixedTick: 2,
            spawnSequence: 0,
            commandId: `target-entity:${caseId}:shot`
        });
        assert(
            shotRequest.accepted,
            `Target-entity ${caseId} shot request 실패: ${JSON.stringify(shotRequest)}`
        );
        const shotCommit = endpoint.commitAtFixedBoundary(2);
        const projectileHandle = shotCommit.fixedCommands
            .sourceRelativeSpawns[0]?.handle;
        assert(
            projectileHandle
                && shotCommit.fixedCommands.sourceRelativeSpawns.length === 1
                && shotCommit.fixedCommands.rejected.length === 0,
            `Target-entity ${caseId} shot commit 실패: ${JSON.stringify(shotCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, 2),
            `Target-entity ${caseId} shot fixed submit 실패`
        );
        await settlePhase5Endpoint(
            endpoint,
            `Target-entity ${caseId} shot completion`,
            { spawnProgram: true }
        );
        const afterBodies = await readPhase5Bodies(endpoint);
        const targetAfter = findPhase5Body(
            afterBodies,
            targetHandle,
            `${caseId} target after contact`
        );
        const projectileAfter = findPhase5Body(
            afterBodies,
            projectileHandle,
            `${caseId} projectile after contact`
        );
        const completedEvents = endpoint.commitCompletedEventsAtFixedBoundary(3);
        const completion = endpoint.getStatus().fixedCommands.lastCompletionResult;
        const projectileView = endpoint.getRegistry().copyEntityView(
            projectileHandle,
            {}
        );
        const exactContacts = completedEvents.contactEvents.filter((event) => (
            event.entityId === projectileHandle.entityId
                && event.incarnation === projectileHandle.incarnation
                && event.otherEntityId === targetHandle.entityId
                && event.otherIncarnation === targetHandle.incarnation
        ));
        const damageEvents = exactContacts.filter(
            ({ eventType }) => eventType === 'damage-applied'
        );
        const interactionEvents = exactContacts.filter(
            ({ eventType }) => eventType === 'interaction-continuous'
        );
        assert(
            completion.protocolFailure === null
                && completion.completed.length === 1
                && completion.completed[0].outcome === 'resolved'
                && projectileView?.metadata?.sourceEntityId === sourceHandle.entityId
                && projectileView.metadata.sourceIncarnation
                    === sourceHandle.incarnation
                && projectileView.metadata.targetEntityId === targetHandle.entityId
                && projectileView.metadata.targetIncarnation
                    === targetHandle.incarnation
                && projectileView.metadata.teamId === (
                    hostile ? GAMEPLAY_TEAM_ID.HOSTILE : GAMEPLAY_TEAM_ID.PLAYER
                )
                && projectileView.metadata.targetPolicyId
                    === PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
            `Target-entity ${caseId} completion/provenance 불일치: ${JSON.stringify({ completion, projectileView })}`
        );
        if (hostile) {
            assert(
                damageEvents.length === 1
                    && interactionEvents.length === 0
                    && damageEvents[0].damageFixedPoint === 500
                    && damageEvents[0].damage === 5,
                `Target-entity hostile→Player damage event 불일치: ${JSON.stringify(exactContacts)}`
            );
            assertNear(
                targetAfter.health,
                targetBefore.health - projectileDefinition.damage,
                0.000001,
                'Target-entity hostile→Player target HP'
            );
            assertNear(
                projectileAfter.health,
                projectileDefinition.penetration - projectileDefinition.damageSelf,
                0.000001,
                'Target-entity hostile→Player penetration'
            );
        } else {
            assert(
                damageEvents.length === 0
                    && interactionEvents.length === 1
                    && interactionEvents[0].damageFixedPoint === 0
                    && interactionEvents[0].damage === 0,
                `Target-entity same-team block event 불일치: ${JSON.stringify(exactContacts)}`
            );
            assertNear(
                targetAfter.health,
                targetBefore.health,
                0.000001,
                'Target-entity same-team target HP 보존'
            );
            assertNear(
                projectileAfter.health,
                projectileDefinition.penetration,
                0.000001,
                'Target-entity same-team penetration 보존'
            );
        }
        assert(
            completedEvents.deathEvents.length === 0
                && !endpoint.getStatus().recoveryRequired,
            `Target-entity ${caseId} death/recovery가 발생했습니다: ${JSON.stringify(completedEvents)}`
        );
        return Object.freeze({
            id: caseId,
            sourceTeamId: projectileView.metadata.teamId,
            targetTeamId: GAMEPLAY_TEAM_ID.PLAYER,
            targetPolicyId: projectileView.metadata.targetPolicyId,
            handles: Object.freeze({ source: sourceHandle, target: targetHandle }),
            tickStart: Object.freeze({
                sourcePosition: Object.freeze({ ...sourceBefore.position }),
                sourceVelocity: Object.freeze({ ...sourceBefore.velocity }),
                targetPosition: Object.freeze({ ...targetBefore.position }),
                targetVelocity: Object.freeze({ ...targetBefore.velocity })
            }),
            projectile: Object.freeze({
                positionOffset,
                launchSpeed,
                penetrationBefore: projectileDefinition.penetration,
                penetrationAfter: projectileAfter.health
            }),
            targetHealth: Object.freeze({
                before: targetBefore.health,
                after: targetAfter.health
            }),
            outcome: completion.completed[0].outcome,
            damageAppliedCount: damageEvents.length,
            interactionCount: interactionEvents.length,
            deathCount: completedEvents.deathEvents.length,
            recoveryRequired: endpoint.getStatus().recoveryRequired
        });
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionTargetEntityAimHardwareSmoke(device) {
    assert(
        GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY
                === 'source-relative-target-entity'
            && GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY === 3
            && GPU_SPAWN_PROGRAM_RESULT.TARGET_INVALID === 4
            && GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.STRIDE === 80,
        'Target-entity public/SpawnProgram canonical protocol 불일치'
    );
    const moving = await runProductionTargetEntityMovingAimHardwareSmoke(device);
    const fallback = await runProductionTargetEntityFallbackHardwareSmoke(device);
    const sameTeam = await runProductionTargetEntityDamageCaseHardwareSmoke(
        device,
        { hostile: false }
    );
    const hostile = await runProductionTargetEntityDamageCaseHardwareSmoke(
        device,
        { hostile: true }
    );
    assert(
        sameTeam.outcome === 'resolved'
            && sameTeam.damageAppliedCount === 0
            && hostile.outcome === 'resolved'
            && hostile.damageAppliedCount === 1,
        `Target-entity aim/damage authorization 분리 실패: ${JSON.stringify({ sameTeam, hostile })}`
    );
    return Object.freeze({
        protocol: Object.freeze({
            publicMode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
            modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
            targetInvalidResult: GPU_SPAWN_PROGRAM_RESULT.TARGET_INVALID,
            spawnProgramAbiVersion: moving.spawnProgramAbi.version,
            spawnProgramRecordStride: moving.spawnProgramAbi.recordStride
        }),
        moving,
        fallback,
        damageAuthorization: Object.freeze({ sameTeam, hostile })
    });
}

async function runProductionTargetEntityDeathBeforeResolveHardwareSmoke(device) {
    const navigationSource = createPhase5ProjectileNavigationSource();
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPhase3PlatformPort(device)
    }, {
        capacity: 3,
        controlCommandCapacity: 1,
        sourceRelativeSpawnCommandCapacity: 1,
        spawnProgramCapacity: 1
    });
    const adapter = new GpuProjectileSpawnAdapter(endpoint, {
        commandNamespace: 'nw-target-entity-death-before-resolve'
    });
    const fixedDelta = 1 / 60;
    const sourcePosition = Object.freeze({ x: 2, y: 2 });
    const targetPosition = Object.freeze({ x: 6, y: 2 });
    const projectileDefinition = createTargetEntityHardwareProjectileDefinition(
        'nw_target_entity_death_before_resolve',
        { penetration: 2, damage: 1, damageSelf: 1 }
    );

    try {
        assert(
            endpoint.init(navigationSource) === false,
            'Target-invalid endpoint는 첫 spawn 전 deferred여야 합니다.'
        );
        const sourceRequest = endpoint.requestSpawn(
            createGpuTowerSpawnIntent({ position: sourcePosition }),
            1,
            'target-invalid:source'
        );
        const targetRequest = endpoint.requestSpawn(
            createPhase3SpawnIntent('target_invalid_dead_target', {
                kindId: 'target-probe',
                position: targetPosition,
                teamId: GAMEPLAY_TEAM_ID.PLAYER,
                interactionLayer:
                    GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE,
                interactionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
                health: 0
            }),
            1,
            'target-invalid:target'
        );
        assert(
            sourceRequest.accepted && targetRequest.accepted,
            `Target-invalid source/target request 실패: ${JSON.stringify({ sourceRequest, targetRequest })}`
        );
        const spawnCommit = endpoint.commitAtFixedBoundary(1);
        const handles = new Map(
            spawnCommit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        const sourceHandle = handles.get('target-invalid:source');
        const targetHandle = handles.get('target-invalid:target');
        assert(
            sourceHandle && targetHandle && spawnCommit.spawned.length === 2,
            `Target-invalid exact handles 누락: ${JSON.stringify(spawnCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, 1),
            'Target-invalid target death fixed submit 실패'
        );
        await settlePhase5Endpoint(endpoint, 'Target-invalid target death completion');
        const bodiesAfterDeath = await readPhase5Bodies(endpoint);
        const sourceBeforeControl = findPhase5Body(
            bodiesAfterDeath,
            sourceHandle,
            'target-invalid source before control'
        );
        assert(
            !bodiesAfterDeath.some((body) => (
                body.handle?.entityId === targetHandle.entityId
                    && body.handle?.incarnation === targetHandle.incarnation
            ))
                && endpoint.getRegistry().has(targetHandle)
                && endpoint.hasBody(targetHandle),
            `Target-invalid fixture는 GPU dead/host exact-live race가 아닙니다: ${JSON.stringify({ bodiesAfterDeath, targetHandle })}`
        );

        const shotRequest = adapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
            definition: projectileDefinition,
            sourceHandle,
            targetHandle,
            positionOffset: { x: 0.6, y: 0 },
            targetOffset: { x: 0, y: 0 },
            launchSpeed: 12,
            allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
            targetPolicyId:
                PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
            producerId: 'nw-target-invalid-producer',
            sourceAbilityId: 'target-invalid-shot',
            targetFixedTick: 2,
            spawnSequence: 0,
            commandId: 'target-invalid:shot'
        });
        const controlRequest = endpoint.requestBodyControl({
            handle: sourceHandle,
            moveIntentX: 1,
            moveIntentY: 0
        }, 2, 'target-invalid:source-control');
        assert(
            shotRequest.accepted && controlRequest.accepted,
            `Target-invalid shot/control request 실패: ${JSON.stringify({ shotRequest, controlRequest })}`
        );
        const targetCommit = endpoint.commitAtFixedBoundary(2);
        const destinationHandle = targetCommit.fixedCommands
            .sourceRelativeSpawns[0]?.handle;
        assert(
            targetCommit.fixedCommands.controls.length === 1
                && targetCommit.fixedCommands.sourceRelativeSpawns.length === 1
                && targetCommit.fixedCommands.rejected.length === 0
                && destinationHandle
                && endpoint.getStatus().reservedCount === 1,
            `Target-invalid pending reservation/commit 불일치: ${JSON.stringify(targetCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, 2),
            'Target-invalid resolve/control fixed submit 실패'
        );
        await settlePhase5Endpoint(
            endpoint,
            'Target-invalid SpawnProgram completion',
            { spawnProgram: true }
        );
        const bodiesAfterResolve = await readPhase5Bodies(endpoint);
        const sourceAfterControl = findPhase5Body(
            bodiesAfterResolve,
            sourceHandle,
            'target-invalid source after control'
        );
        assert(
            sourceAfterControl.position.x > sourceBeforeControl.position.x,
            `Target-invalid와 같은 submit의 Tower control이 진행되지 않았습니다: ${JSON.stringify({ sourceBeforeControl, sourceAfterControl })}`
        );
        assert(
            !bodiesAfterResolve.some((body) => (
                body.handle?.entityId === destinationHandle.entityId
                    && body.handle?.incarnation === destinationHandle.incarnation
            )),
            `TARGET_INVALID destination이 GPU ALIVE로 활성화됐습니다: ${JSON.stringify(bodiesAfterResolve)}`
        );

        const completedEvents = endpoint.commitCompletedEventsAtFixedBoundary(3);
        const completionStatus = endpoint.getStatus();
        const completion = completionStatus.fixedCommands.lastCompletionResult;
        assert(
            completion.protocolFailure === null
                && completion.completed.length === 1
                && completion.completed[0].commandId === 'target-invalid:shot'
                && completion.completed[0].handle.entityId
                    === destinationHandle.entityId
                && completion.completed[0].handle.incarnation
                    === destinationHandle.incarnation
                && completion.completed[0].outcome === 'target-invalid'
                && completionStatus.fixedCommands.telemetry.completedTargetInvalid >= 1
                && !endpoint.getRegistry().has(destinationHandle)
                && endpoint.getRegistry().copyEntityView(destinationHandle, {}) === null
                && !endpoint.hasBody(destinationHandle)
                && completionStatus.reservedCount === 0
                && completionStatus.pendingSourceRelativeDestinationCount === 0
                && !completionStatus.recoveryRequired,
            `Target-invalid exact completion/cleanup 불일치: ${JSON.stringify({ completion, completionStatus })}`
        );
        const targetDeathEvents = completedEvents.deathEvents.filter((event) => (
            event.entityId === targetHandle.entityId
                && event.incarnation === targetHandle.incarnation
        ));
        assert(
            completedEvents.protocolFailure === null
                && targetDeathEvents.length === 1
                && targetDeathEvents[0].sourceTick === 1
                && targetDeathEvents[0].disposition === 'despawn-requested',
            `Target-invalid target death event 불일치: ${JSON.stringify(completedEvents)}`
        );
        const cleanupCommit = endpoint.commitAtFixedBoundary(3);
        const cleanupStatus = endpoint.getStatus();
        const gpuCleanupStatus = endpoint.getBackend().simulation.getStatus();
        assert(
            cleanupCommit.despawned.length === 1
                && cleanupCommit.despawned[0].handle.entityId
                    === targetHandle.entityId
                && cleanupCommit.despawned[0].handle.incarnation
                    === targetHandle.incarnation
                && cleanupCommit.fixedCommands.completed.length === 1
                && cleanupCommit.fixedCommands.completed[0].outcome
                    === 'target-invalid'
                && cleanupStatus.activeCount === 1
                && cleanupStatus.reservedCount === 0
                && cleanupStatus.pendingCommandCount === 0
                && gpuCleanupStatus.pendingBodyCount === 0
                && !cleanupStatus.recoveryRequired,
            `Target-invalid next-boundary cleanup 불일치: ${JSON.stringify({ cleanupCommit, cleanupStatus, gpuCleanupStatus })}`
        );
        return Object.freeze({
            sourceHandle,
            targetHandle,
            destinationHandle,
            targetDeathSourceTick: targetDeathEvents[0].sourceTick,
            completion: Object.freeze({
                commandId: completion.completed[0].commandId,
                handle: completion.completed[0].handle,
                outcome: completion.completed[0].outcome
            }),
            towerControl: Object.freeze({
                acceptedCount: targetCommit.fixedCommands.controls.length,
                positionBefore: Object.freeze({ ...sourceBeforeControl.position }),
                positionAfter: Object.freeze({ ...sourceAfterControl.position })
            }),
            cleanup: Object.freeze({
                targetDespawnCount: cleanupCommit.despawned.length,
                activeCount: cleanupStatus.activeCount,
                reservedCount: cleanupStatus.reservedCount,
                pendingCommandCount: cleanupStatus.pendingCommandCount,
                pendingDestinationCount:
                    cleanupStatus.pendingSourceRelativeDestinationCount,
                pendingBodyCount: gpuCleanupStatus.pendingBodyCount,
                recoveryRequired: cleanupStatus.recoveryRequired
            }),
            completedTargetInvalid:
                completionStatus.fixedCommands.telemetry.completedTargetInvalid,
            fixedSubmitContinued: true
        });
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionTargetEntitySlotAbaHardwareSmoke(device) {
    const simulation = new GpuCircleBodySimulation(
        createPhase3PlatformPort(device),
        {
            capacity: 3,
            worldSize: { x: 8, y: 8 },
            gridCellSize: { x: 1, y: 1 },
            spawnProgramCapacity: 1,
            sessionGeneration: 72
        }
    );
    const fixedDelta = 1 / 60;
    const source = createPhase3Body({
        entityId: 9911,
        incarnation: 1,
        position: { x: 2, y: 2 },
        velocity: { x: 1, y: 0 }
    });
    const targetA = createPhase3Body({
        entityId: 9912,
        incarnation: 3,
        position: { x: 6, y: 2 }
    });
    const targetB = createPhase3Body({
        entityId: 9913,
        incarnation: 5,
        position: { x: 6, y: 2 }
    });
    const destinationHandle = Object.freeze({ entityId: 9914, incarnation: 7 });

    try {
        assert(simulation.init(), 'Target ABA simulation init 실패');
        const initialSpawn = simulation.spawnBodies([source, targetA]);
        assert(
            initialSpawn.accepted === 2 && initialSpawn.rejected === 0,
            `Target ABA source/target A spawn 실패: ${JSON.stringify(initialSpawn)}`
        );
        const initialBodies = await simulation.readbackBodies();
        const targetABody = findPhase5Body(
            initialBodies,
            targetA,
            'target ABA original target A'
        );
        const staged = simulation.stageFixedPrograms({
            targetFixedTick: 1,
            controls: [],
            sourceRelativeSpawns: [{
                sourceHandle: source,
                targetHandle: targetA,
                destinationHandle,
                destinationSpawn: createPhase3Body({
                    position: { x: 0, y: 0 },
                    velocity: { x: 0, y: 0 }
                }),
                modeFlags:
                    GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
                positionOffset: { x: 0, y: 0 },
                targetOffset: { x: 0, y: 0 },
                launchSpeed: 12
            }]
        });
        assert(
            staged.sourceRelativeSpawns.accepted === 1
                && staged.sourceRelativeSpawns.rejected === 0
                && simulation.getStatus().pendingBodyCount === 1,
            `Target ABA program stage 실패: ${JSON.stringify(staged)}`
        );
        const removedA = simulation.despawnBodies([targetA]);
        const spawnedB = simulation.spawnBodies([targetB]);
        assert(
            removedA.removed === 1
                && removedA.rejected === 0
                && spawnedB.accepted === 1
                && spawnedB.rejected === 0
                && !simulation.hasBody(targetA)
                && simulation.hasBody(targetB),
            `Target ABA replacement 실패: ${JSON.stringify({ removedA, spawnedB })}`
        );
        const replacementBodies = await simulation.readbackBodies();
        const targetBBody = findPhase5Body(
            replacementBodies,
            targetB,
            'target ABA replacement target B'
        );
        assert(
            targetBBody.index === targetABody.index,
            `Target ABA fixture가 동일 private slot을 재사용하지 않았습니다: A=${targetABody.index}, B=${targetBBody.index}`
        );

        assert(
            simulation.fixedUpdate(fixedDelta, 1),
            'Target ABA resolve fixed submit 실패'
        );
        await device.queue.onSubmittedWorkDone();
        await waitForSimulationStatus(
            simulation,
            (status) => status.fixedPrimitives.spawnProgram.pendingReadbacks === 0
                && status.fixedPrimitives.spawnProgram.queuedBatches === 1,
            'Target ABA SpawnProgram completion'
        );
        const completedBatches = simulation.drainCompletedSpawnProgramBatches([]);
        assert(
            completedBatches.length === 1
                && completedBatches[0].failure === null
                && completedBatches[0].outcomes.length === 1
                && completedBatches[0].outcomes[0].result
                    === GPU_SPAWN_PROGRAM_RESULT.TARGET_INVALID
                && completedBatches[0].outcomes[0].reason === 'target-invalid'
                && completedBatches[0].outcomes[0].targetHandle.entityId
                    === targetA.entityId
                && completedBatches[0].outcomes[0].targetHandle.incarnation
                    === targetA.incarnation,
            `Target ABA outcome 불일치: ${JSON.stringify(completedBatches)}`
        );
        const finalBodies = await simulation.readbackBodies();
        const finalTargetB = findPhase5Body(
            finalBodies,
            targetB,
            'target ABA surviving replacement B'
        );
        const finalStatus = simulation.getStatus();
        assert(
            finalTargetB.handle?.entityId === targetB.entityId
                && finalTargetB.handle?.incarnation === targetB.incarnation
                && !simulation.hasBody(targetA)
                && simulation.hasBody(targetB)
                && !simulation.hasBody(destinationHandle)
                && finalStatus.pendingBodyCount === 0
                && finalStatus.activeBodyCount === 2
                && !finalStatus.requiresAuthoritativeRebuild,
            `Target ABA destination/replacement cleanup 불일치: ${JSON.stringify({ finalBodies, finalStatus })}`
        );
        return Object.freeze({
            sourceHandle: Object.freeze({
                entityId: source.entityId,
                incarnation: source.incarnation
            }),
            originalTargetHandle: Object.freeze({
                entityId: targetA.entityId,
                incarnation: targetA.incarnation
            }),
            replacementTargetHandle: Object.freeze({
                entityId: targetB.entityId,
                incarnation: targetB.incarnation
            }),
            destinationHandle,
            outcome: Object.freeze({
                result: completedBatches[0].outcomes[0].result,
                reason: completedBatches[0].outcomes[0].reason
            }),
            replacementAlive: true,
            destinationActivated: false,
            pendingBodyCount: finalStatus.pendingBodyCount,
            recoveryRequired: finalStatus.requiresAuthoritativeRebuild
        });
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionTargetEntityInvalidHardwareSmoke(device) {
    const deathBeforeResolve =
        await runProductionTargetEntityDeathBeforeResolveHardwareSmoke(device);
    const slotAba = await runProductionTargetEntitySlotAbaHardwareSmoke(device);
    assert(
        deathBeforeResolve.completion.outcome === 'target-invalid'
            && deathBeforeResolve.cleanup.recoveryRequired === false
            && slotAba.outcome.reason === 'target-invalid'
            && slotAba.destinationActivated === false
            && slotAba.replacementAlive
            && slotAba.recoveryRequired === false,
        `Target-invalid/ABA actual gate 실패: ${JSON.stringify({ deathBeforeResolve, slotAba })}`
    );
    return Object.freeze({ deathBeforeResolve, slotAba });
}

async function runProductionPhase5TeamDamageMatrixHardwareSmoke(device) {
    const fixedDelta = 1 / 60;
    const sourceTick = 1;
    const damagePolicyId = GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX;
    const authoredHealth = 2;
    const authoredDamage = 1;
    const cases = Object.freeze([
        Object.freeze({
            id: 'player-to-hostile',
            sourceTeamId: GAMEPLAY_TEAM_ID.PLAYER,
            targetTeamId: GAMEPLAY_TEAM_ID.HOSTILE,
            damageAllowed: true
        }),
        Object.freeze({
            id: 'hostile-to-player',
            sourceTeamId: GAMEPLAY_TEAM_ID.HOSTILE,
            targetTeamId: GAMEPLAY_TEAM_ID.PLAYER,
            damageAllowed: true
        }),
        Object.freeze({
            id: 'player-to-player',
            sourceTeamId: GAMEPLAY_TEAM_ID.PLAYER,
            targetTeamId: GAMEPLAY_TEAM_ID.PLAYER,
            damageAllowed: false
        }),
        Object.freeze({
            id: 'hostile-to-hostile',
            sourceTeamId: GAMEPLAY_TEAM_ID.HOSTILE,
            targetTeamId: GAMEPLAY_TEAM_ID.HOSTILE,
            damageAllowed: false
        }),
        Object.freeze({
            id: 'neutral-to-player',
            sourceTeamId: GAMEPLAY_TEAM_ID.NEUTRAL,
            targetTeamId: GAMEPLAY_TEAM_ID.PLAYER,
            damageAllowed: false
        }),
        Object.freeze({
            id: 'player-to-neutral',
            sourceTeamId: GAMEPLAY_TEAM_ID.PLAYER,
            targetTeamId: GAMEPLAY_TEAM_ID.NEUTRAL,
            damageAllowed: false
        })
    ]);
    const results = [];

    for (let index = 0; index < cases.length; index++) {
        const fixture = cases[index];
        const expectedDamageAllowed = isGameplayDamageAllowed(
            fixture.sourceTeamId,
            fixture.targetTeamId,
            damagePolicyId
        );
        assert(
            expectedDamageAllowed === fixture.damageAllowed,
            `team damage matrix host oracle 불일치: ${fixture.id}`
        );
        const projectileHandle = Object.freeze({
            entityId: 9811 + (index * 2),
            incarnation: 101 + index
        });
        const targetHandle = Object.freeze({
            entityId: projectileHandle.entityId + 1,
            incarnation: 201 + index
        });
        const projectileGameplayMeta = packGpuCircleGameplayMeta(
            fixture.sourceTeamId,
            damagePolicyId
        );
        const targetGameplayMeta = packGpuCircleGameplayMeta(
            fixture.targetTeamId,
            damagePolicyId
        );
        assert(
            (projectileGameplayMeta & GPU_CIRCLE_BODY_GAMEPLAY_META.RESERVED_MASK) === 0
                && (targetGameplayMeta & GPU_CIRCLE_BODY_GAMEPLAY_META.RESERVED_MASK) === 0,
            `team damage matrix gameplayMeta reserved bit가 설정되었습니다: ${fixture.id}`
        );
        const projectile = Object.freeze({
            ...projectileHandle,
            position: Object.freeze({ x: 4, y: 4 }),
            velocity: Object.freeze({ x: 0, y: 0 }),
            radius: 0.2,
            inverseMass: 1,
            bodyLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
            collisionMask: 0,
            interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
            interactionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
            teamId: fixture.sourceTeamId,
            damagePolicyId,
            gameplayMeta: projectileGameplayMeta,
            health: authoredHealth,
            lifetime: -1,
            contactHandler: Object.freeze({
                damageSelf: authoredDamage,
                damageOther: authoredDamage,
                flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY
                    | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS
            }),
            alive: true
        });
        const target = Object.freeze({
            ...targetHandle,
            position: Object.freeze({ x: 4, y: 4 }),
            velocity: Object.freeze({ x: 0, y: 0 }),
            radius: 0.25,
            inverseMass: 0,
            bodyLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
            collisionMask: 0,
            interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
            interactionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
            teamId: fixture.targetTeamId,
            damagePolicyId,
            gameplayMeta: targetGameplayMeta,
            health: authoredHealth,
            lifetime: -1,
            alive: true
        });
        const simulation = new GpuCircleBodySimulation(
            createPhase3PlatformPort(device),
            {
                capacity: 2,
                worldSize: { x: 8, y: 8 },
                gridCellSize: { x: 2, y: 2 }
            }
        );
        const findBody = (bodies, handle, label) => {
            const body = bodies.find((candidate) => (
                candidate.handle?.entityId === handle.entityId
                && candidate.handle?.incarnation === handle.incarnation
            ));
            assert(
                body,
                `team damage matrix ${fixture.id} ${label} body identity 누락: ${JSON.stringify(handle)}`
            );
            return body;
        };
        const assertGameplayMeta = (body, expectedMeta, expectedTeamId, label) => {
            const unpacked = unpackGpuCircleGameplayMeta(body.gameplayMeta);
            assert(
                body.gameplayMeta === expectedMeta
                    && body.teamId === expectedTeamId
                    && body.damagePolicyId === damagePolicyId
                    && unpacked.teamId === expectedTeamId
                    && unpacked.damagePolicyId === damagePolicyId,
                `team damage matrix ${fixture.id} ${label} gameplay metadata 불일치: ${JSON.stringify({ body, unpacked })}`
            );
        };

        try {
            assert(simulation.init(), `team damage matrix ${fixture.id} simulation init 실패`);
            const spawnResult = simulation.spawnBodies([projectile, target]);
            assert(
                spawnResult.accepted === 2
                    && spawnResult.rejected === 0
                    && spawnResult.handles?.length === 2
                    && spawnResult.handles[0].entityId === projectileHandle.entityId
                    && spawnResult.handles[0].incarnation === projectileHandle.incarnation
                    && spawnResult.handles[1].entityId === targetHandle.entityId
                    && spawnResult.handles[1].incarnation === targetHandle.incarnation,
                `team damage matrix ${fixture.id} exact spawn identity 불일치: ${JSON.stringify(spawnResult)}`
            );
            assert(
                simulation.fixedUpdate(fixedDelta, sourceTick),
                `team damage matrix ${fixture.id} fixed submit 실패: ${JSON.stringify(simulation.getStatus())}`
            );
            const bodiesPromise = simulation.readbackBodies();
            await device.queue.onSubmittedWorkDone();
            const bodies = await bodiesPromise;
            assert(
                bodies.length === 2,
                `team damage matrix ${fixture.id} readback body 수 불일치: ${JSON.stringify(bodies)}`
            );
            const projectileAfter = findBody(bodies, projectileHandle, 'projectile');
            const targetAfter = findBody(bodies, targetHandle, 'target');
            assertGameplayMeta(
                projectileAfter,
                projectileGameplayMeta,
                fixture.sourceTeamId,
                'projectile'
            );
            assertGameplayMeta(
                targetAfter,
                targetGameplayMeta,
                fixture.targetTeamId,
                'target'
            );
            assertNear(
                projectileAfter.position.x,
                projectile.position.x,
                0.000001,
                `team damage matrix ${fixture.id} projectile physical displacement x`
            );
            assertNear(
                projectileAfter.position.y,
                projectile.position.y,
                0.000001,
                `team damage matrix ${fixture.id} projectile physical displacement y`
            );
            assertNear(
                projectileAfter.previousPosition.x,
                projectile.position.x,
                0.000001,
                `team damage matrix ${fixture.id} projectile previous physical displacement x`
            );
            assertNear(
                projectileAfter.previousPosition.y,
                projectile.position.y,
                0.000001,
                `team damage matrix ${fixture.id} projectile previous physical displacement y`
            );
            assertNear(
                projectileAfter.positionDelta.x,
                0,
                0.000001,
                `team damage matrix ${fixture.id} projectile positionDelta.x`
            );
            assertNear(
                projectileAfter.positionDelta.y,
                0,
                0.000001,
                `team damage matrix ${fixture.id} projectile positionDelta.y`
            );

            const completedStatus = await waitForSimulationStatus(
                simulation,
                (status) => status.events.pendingReadbacks === 0
                    && status.events.queuedBatches >= 1
                    && status.events.completedThroughTick >= sourceTick,
                `team damage matrix ${fixture.id} event completion`
            );
            const batches = simulation.drainCompletedEventBatches([]);
            assert(
                batches.length === 1
                    && batches[0].sourceTick === sourceTick
                    && batches[0].completedThroughTick === sourceTick,
                `team damage matrix ${fixture.id} event batch tick 불일치: ${JSON.stringify(batches)}`
            );
            const [batch] = batches;
            const contactEvents = batch.events.filter(({ type }) => type === 'contact');
            const damageEvents = contactEvents.filter(
                ({ eventType }) => eventType === 'damage-applied'
            );
            const deathEvents = batch.events.filter(({ type }) => type === 'death');
            assert(
                contactEvents.length === 1
                    && contactEvents[0].entityId === projectileHandle.entityId
                    && contactEvents[0].incarnation === projectileHandle.incarnation
                    && contactEvents[0].otherEntityId === targetHandle.entityId
                    && contactEvents[0].otherIncarnation === targetHandle.incarnation,
                `team damage matrix ${fixture.id} contact exact identity 불일치: ${JSON.stringify(contactEvents)}`
            );
            assert(
                deathEvents.length === 0,
                `team damage matrix ${fixture.id} death event가 발생했습니다: ${JSON.stringify(deathEvents)}`
            );
            if (fixture.damageAllowed) {
                const [damageEvent] = damageEvents;
                assert(
                    damageEvents.length === 1
                        && damageEvent.damageFixedPoint === authoredDamage * 100
                        && damageEvent.damage === authoredDamage,
                    `team damage matrix ${fixture.id} DAMAGE_APPLIED가 정확하지 않습니다: ${JSON.stringify(damageEvents)}`
                );
                assertNear(
                    targetAfter.health,
                    authoredHealth - authoredDamage,
                    0.000001,
                    `team damage matrix ${fixture.id} target HP 적용`
                );
                assertNear(
                    projectileAfter.health,
                    authoredHealth - authoredDamage,
                    0.000001,
                    `team damage matrix ${fixture.id} projectile penetration 적용`
                );
            } else {
                assert(
                    damageEvents.length === 0
                        && contactEvents[0].eventType === 'interaction-continuous',
                    `team damage matrix ${fixture.id} blocked DAMAGE_APPLIED가 발생했습니다: ${JSON.stringify(contactEvents)}`
                );
                assertNear(
                    targetAfter.health,
                    authoredHealth,
                    0.000001,
                    `team damage matrix ${fixture.id} blocked target HP 보존`
                );
                assertNear(
                    projectileAfter.health,
                    authoredHealth,
                    0.000001,
                    `team damage matrix ${fixture.id} blocked projectile penetration 보존`
                );
            }
            assert(
                completedStatus.events.lastDeathCount === 0
                    && completedStatus.events.lastAppliedOverflowCount === 0
                    && completedStatus.events.lastDeathOverflowCount === 0,
                `team damage matrix ${fixture.id} event telemetry 불일치: ${JSON.stringify(completedStatus.events)}`
            );
            results.push(Object.freeze({
                id: fixture.id,
                sourceTeamId: fixture.sourceTeamId,
                targetTeamId: fixture.targetTeamId,
                damageAllowed: fixture.damageAllowed,
                handles: Object.freeze({ projectile: projectileHandle, target: targetHandle }),
                targetHealth: Object.freeze({
                    before: authoredHealth,
                    after: targetAfter.health
                }),
                projectile: Object.freeze({
                    penetrationBefore: authoredHealth,
                    penetrationAfter: projectileAfter.health,
                    positionBefore: Object.freeze({ ...projectile.position }),
                    positionAfter: Object.freeze({ ...projectileAfter.position })
                }),
                event: Object.freeze({
                    type: contactEvents[0].eventType,
                    damageAppliedCount: damageEvents.length,
                    deathCount: deathEvents.length
                })
            }));
        } finally {
            simulation.destroy();
            await device.queue.onSubmittedWorkDone();
        }
    }

    return Object.freeze({
        damagePolicyId,
        sourceTick,
        cases: results
    });
}

async function runProductionTowerCombatAliveReplacementHardwareSmoke(
    device,
    navigationSource,
    currentHp
) {
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPhase3PlatformPort(device)
    }, {
        capacity: 2,
        controlCommandCapacity: 1,
        sourceRelativeSpawnCommandCapacity: 1,
        spawnProgramCapacity: 1
    });
    const fixedDelta = 1 / 60;
    try {
        assert(
            endpoint.init(navigationSource) === false,
            'Tower combat alive replacement endpoint는 첫 spawn 전 deferred여야 합니다.'
        );
        assert(
            endpoint.requestSpawn(
                createGpuCoreProxySpawnIntent({
                    position: navigationSource.corePosition
                }),
                1,
                'tower-combat:alive-replacement:core'
            ).accepted,
            'Tower combat alive replacement Core spawn request 실패'
        );
        assert(
            endpoint.requestSpawn(
                createGpuTowerSpawnIntent({
                    position: { x: 4, y: 6 },
                    currentHp
                }),
                1,
                'tower-combat:alive-replacement:tower'
            ).accepted,
            'Tower combat alive replacement Tower spawn request 실패'
        );
        const commit = endpoint.commitAtFixedBoundary(1);
        assert(
            commit.state === 'committed'
                && commit.spawned.length === 2
                && commit.rejected.length === 0,
            'Tower combat alive replacement spawn commit 실패: '
                + JSON.stringify(commit)
        );
        const handles = new Map(
            commit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        const coreHandle = handles.get('tower-combat:alive-replacement:core');
        const towerHandle = handles.get('tower-combat:alive-replacement:tower');
        assert(coreHandle && towerHandle,
            'Tower combat alive replacement exact handle 누락');
        assert(
            endpoint.fixedUpdate(fixedDelta, 1),
            'Tower combat alive replacement fixed submit 실패'
        );
        await settlePhase5Endpoint(endpoint, 'Tower combat alive replacement completion');
        const bodies = await readPhase5Bodies(endpoint);
        const tower = findPhase5Body(
            bodies,
            towerHandle,
            'alive replacement Tower'
        );
        const core = findPhase5Body(bodies, coreHandle, 'alive replacement Core');
        const status = endpoint.getStatus();
        assertNear(tower.health, currentHp, 0.000001,
            'Tower combat alive replacement GPU HP');
        assert(
            endpoint.getRegistry().has(towerHandle)
                && endpoint.hasBody(towerHandle)
                && endpoint.getRegistry().has(coreHandle)
                && endpoint.hasBody(coreHandle)
                && !status.recoveryRequired,
            'Tower combat alive replacement registry/body/recovery 불일치: '
                + JSON.stringify(status)
        );
        return Object.freeze({
            requestedCurrentHp: currentHp,
            handles: Object.freeze({ tower: towerHandle, core: coreHandle }),
            towerHealth: tower.health,
            corePosition: Object.freeze({ ...core.position }),
            recoveryRequired: status.recoveryRequired
        });
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionTowerCombatDeadReplacementHardwareSmoke(
    device,
    navigationSource,
    deadRosterStatus
) {
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPhase3PlatformPort(device)
    }, {
        capacity: 2,
        controlCommandCapacity: 1,
        sourceRelativeSpawnCommandCapacity: 1,
        spawnProgramCapacity: 1
    });
    const fixedDelta = 1 / 60;
    const towerRequestCount = deadRosterStatus?.livingTowerCount === 0 ? 0 : 1;
    try {
        assert(
            deadRosterStatus?.alive === false
                && deadRosterStatus.livingTowerCount === 0
                && deadRosterStatus.currentHp === 0
                && deadRosterStatus.boundGpuBody === null
                && towerRequestCount === 0,
            'Tower combat dead replacement는 dead roster의 Tower request 0 상태여야 합니다: '
                + JSON.stringify(deadRosterStatus)
        );
        assert(
            endpoint.init(navigationSource) === false,
            'Tower combat dead replacement endpoint는 첫 spawn 전 deferred여야 합니다.'
        );
        assert(
            endpoint.requestSpawn(
                createGpuCoreProxySpawnIntent({
                    position: navigationSource.corePosition
                }),
                1,
                'tower-combat:dead-replacement:core'
            ).accepted,
            'Tower combat dead replacement Core-only spawn request 실패'
        );
        const commit = endpoint.commitAtFixedBoundary(1);
        assert(
            commit.state === 'committed'
                && commit.spawned.length === 1
                && commit.rejected.length === 0
                && !commit.recoveryRequired,
            'Tower combat dead replacement Core-only spawn commit 실패: '
                + JSON.stringify(commit)
        );
        const coreHandle = commit.spawned[0]?.handle;
        assert(coreHandle,
            'Tower combat dead replacement exact Core handle 누락');
        assert(
            endpoint.fixedUpdate(fixedDelta, 1),
            'Tower combat dead replacement fixed submit 실패'
        );
        await settlePhase5Endpoint(endpoint, 'Tower combat dead replacement completion');
        const bodies = await readPhase5Bodies(endpoint);
        const core = findPhase5Body(
            bodies,
            coreHandle,
            'dead replacement Core'
        );
        const registry = endpoint.getRegistry();
        const status = endpoint.getStatus();
        const towerRegistryCount = registry.getActiveCount('tower');
        const towerBodyCount = bodies.length - 1;
        assert(
            bodies.length === 1
                && core.handle?.entityId === coreHandle.entityId
                && core.handle?.incarnation === coreHandle.incarnation
                && registry.has(coreHandle)
                && endpoint.hasBody(coreHandle)
                && towerRegistryCount === 0
                && towerBodyCount === 0
                && !status.recoveryRequired,
            'Tower combat dead replacement Tower absence/Core-only recovery 불일치: '
                + JSON.stringify({
                    bodies,
                    coreHandle,
                    towerRegistryCount,
                    towerBodyCount,
                    status
                })
        );
        return Object.freeze({
            coreHandle,
            corePosition: Object.freeze({ ...core.position }),
            roster: Object.freeze({
                alive: deadRosterStatus.alive,
                livingTowerCount: deadRosterStatus.livingTowerCount,
                currentHp: deadRosterStatus.currentHp,
                boundGpuBody: deadRosterStatus.boundGpuBody
            }),
            towerRequestCount,
            towerRegistryCount,
            towerBodyCount,
            recoveryRequired: status.recoveryRequired
        });
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionTowerCombatHardwareSmoke(device) {
    const context = canvas.getContext('webgpu');
    assert(context, 'Tower combat canvas WebGPU context가 없습니다.');
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
        getState: () => Object.freeze({ ready: true, status: 'ready' }),
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
    const navigationSource = createPhase5ProjectileNavigationSource();
    const endpoint = createGpuSimulationEndpoint({ webGpuPlatformPort: platformPort }, {
        capacity: 8,
        controlCommandCapacity: 1,
        sourceRelativeSpawnCommandCapacity: 2,
        spawnProgramCapacity: 2
    });
    const playerProjectileAdapter = new GpuProjectileSpawnAdapter(endpoint, {
        commandNamespace: 'nw-tower-combat-player'
    });
    const fixedDelta = 1 / 60;
    const towerPosition = Object.freeze({ x: 4, y: 6 });
    const enemyPosition = Object.freeze({ x: 6.5, y: 6 });
    const playerDamageDefinition = Object.freeze({
        id: 'nw_tower_combat_existing_player_projectile',
        collisionRadius: 0.18,
        inverseMass: 1,
        penetration: 10,
        damage: 1,
        damageSelf: 1,
        lifetimeSeconds: 5,
        killOnTerrain: false,
        closestOnly: true,
        colorRgba: [1, 0.86, 0.22, 1],
        radiusScale: 1,
        visible: true
    });
    const hostileThirteenDefinition = Object.freeze({
        id: 'nw_tower_combat_hostile_thirteen',
        collisionRadius: 0.18,
        inverseMass: 1,
        penetration: 14,
        damage: 13,
        damageSelf: 13,
        lifetimeSeconds: 5,
        killOnTerrain: false,
        closestOnly: true,
        continuousInteraction: true,
        colorRgba: [1, 0.15, 0.15, 1],
        radiusScale: 1,
        visible: true
    });
    const friendlyBlockDefinition = Object.freeze({
        id: 'nw_tower_combat_player_friendly_block',
        collisionRadius: 0.18,
        inverseMass: 1,
        penetration: 9,
        damage: 5,
        damageSelf: 5,
        lifetimeSeconds: 5,
        killOnTerrain: false,
        closestOnly: true,
        continuousInteraction: true,
        colorRgba: [0.2, 0.9, 1, 1],
        radiusScale: 1,
        visible: true
    });
    const hostileLethalDefinition = Object.freeze({
        id: 'nw_tower_combat_hostile_lethal',
        collisionRadius: 0.18,
        inverseMass: 1,
        penetration: 17,
        damage: 17,
        damageSelf: 17,
        lifetimeSeconds: 5,
        killOnTerrain: false,
        closestOnly: true,
        continuousInteraction: true,
        colorRgba: [1, 0.05, 0.05, 1],
        radiusScale: 1,
        visible: true
    });
    const coreIntegrity = { current: 100, max: 100 };
    const domainSentinel = {
        coreIntegrity,
        reward: 0,
        runFailed: 0
    };
    const domainSentinelBefore = JSON.stringify(domainSentinel);
    const domainSentinelValuesBefore = Object.freeze({
        coreIntegrityCurrent: coreIntegrity.current,
        coreIntegrityMax: coreIntegrity.max,
        reward: domainSentinel.reward,
        runFailed: domainSentinel.runFailed
    });
    const eventMatches = (event, subject, other) => (
        event?.entityId === subject.entityId
        && event?.incarnation === subject.incarnation
        && event?.otherEntityId === other.entityId
        && event?.otherIncarnation === other.incarnation
    );
    const exactHandleMatches = (entry, handle) => (
        entry?.handle?.entityId === handle.entityId
        && entry?.handle?.incarnation === handle.incarnation
    );
    const createHostileIntent = (
        definition,
        position,
        velocity,
        enemyHandle,
        producerId,
        sourceAbilityId,
        spawnSequence
    ) => createGpuProjectileSpawnIntent({
        definition,
        position,
        velocity,
        sourceHandle: enemyHandle,
        ownerHandle: enemyHandle,
        producerId,
        sourceAbilityId,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        targetPolicyId: PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
        spawnSequence
    });

    try {
        assert(
            endpoint.init(navigationSource) === false,
            'Tower combat endpoint는 첫 spawn 전 deferred여야 합니다.'
        );
        const enemyIntent = Object.freeze({
            ...createGpuEnemySpawnIntent({
                definition: {
                    ...BASIC_CIRCLE_ENEMY_DATA,
                    id: 'nw_tower_combat_enemy',
                    maxHealth: 20
                },
                route: navigationSource.route,
                spawnSequence: 0,
                waveId: 'nw-tower-combat',
                policyId: 'hardware-fixture'
            }),
            position: enemyPosition,
            velocity: Object.freeze({ x: 0, y: 0 })
        });
        const initialRequests = [
            endpoint.requestSpawn(
                createGpuTowerSpawnIntent({ position: towerPosition }),
                1,
                'tower-combat:initial:tower'
            ),
            endpoint.requestSpawn(
                createGpuCoreProxySpawnIntent({
                    position: navigationSource.corePosition
                }),
                1,
                'tower-combat:initial:core'
            ),
            endpoint.requestSpawn(
                enemyIntent,
                1,
                'tower-combat:initial:enemy'
            )
        ];
        assert(
            initialRequests.every(({ accepted }) => accepted),
            'Tower combat initial spawn request 실패: '
                + JSON.stringify(initialRequests)
        );
        const initialCommit = endpoint.commitAtFixedBoundary(1);
        assert(
            initialCommit.state === 'committed'
                && initialCommit.spawned.length === 3
                && initialCommit.rejected.length === 0
                && !initialCommit.recoveryRequired,
            'Tower combat initial spawn commit 실패: '
                + JSON.stringify(initialCommit)
        );
        const initialHandles = new Map(
            initialCommit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        const towerHandle = initialHandles.get('tower-combat:initial:tower');
        const coreHandle = initialHandles.get('tower-combat:initial:core');
        const enemyHandle = initialHandles.get('tower-combat:initial:enemy');
        assert(towerHandle && coreHandle && enemyHandle,
            'Tower combat initial exact handle 누락');
        assert(
            endpoint.fixedUpdate(fixedDelta, 1),
            'Tower combat initial fixed submit 실패'
        );
        await settlePhase5Endpoint(endpoint, 'Tower combat initial completion');
        const initialBodies = await readPhase5Bodies(endpoint);
        const initialTower = findPhase5Body(initialBodies, towerHandle, 'initial Tower');
        const initialCore = findPhase5Body(initialBodies, coreHandle, 'initial Core');
        const initialEnemy = findPhase5Body(initialBodies, enemyHandle, 'initial Enemy');
        assertNear(initialTower.health, THE_TOWER_COMBAT_DATA.MAX_HEALTH, 0.000001,
            'Tower combat initial GPU HP');
        assertNear(initialEnemy.health, 20, 0.000001,
            'Tower combat initial Enemy GPU HP');
        assertNear(initialCore.position.x, navigationSource.corePosition.x, 0.000001,
            'Tower combat initial Core x');
        assertNear(initialCore.position.y, navigationSource.corePosition.y, 0.000001,
            'Tower combat initial Core y');

        const initialCompleted = endpoint.commitCompletedEventsAtFixedBoundary(2);
        assert(
            initialCompleted.protocolFailure === null,
            'Tower combat initial completed-event protocol 실패: '
                + JSON.stringify(initialCompleted)
        );
        const existingPlayerRequest = playerProjectileAdapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
            definition: playerDamageDefinition,
            sourceHandle: towerHandle,
            positionOffset: { x: 0.65, y: 0 },
            aimWorldPoint: { x: 12, y: towerPosition.y },
            launchSpeed: 18,
            producerId: 'nw-tower-existing-player-projectile',
            sourceAbilityId: 'tower-basic-shot',
            targetFixedTick: 2,
            spawnSequence: 0,
            commandId: 'tower-combat:existing-player-projectile'
        });
        const hostileThirteenRequest = endpoint.requestSpawn(
            createHostileIntent(
                hostileThirteenDefinition,
                towerPosition,
                { x: 20, y: 0 },
                enemyHandle,
                'nw-hostile-tower-producer',
                'hostile-tower-shot-13',
                1
            ),
            2,
            'tower-combat:hostile-thirteen'
        );
        const friendlyBlockRequest = endpoint.requestSpawn(
            createGpuProjectileSpawnIntent({
                definition: friendlyBlockDefinition,
                position: { x: towerPosition.x + 0.65, y: towerPosition.y },
                velocity: { x: 0, y: 0 },
                sourceHandle: towerHandle,
                ownerHandle: towerHandle,
                producerId: 'nw-player-friendly-fire-probe',
                sourceAbilityId: 'player-friendly-fire-probe',
                teamId: GAMEPLAY_TEAM_ID.PLAYER,
                allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
                damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
                targetPolicyId:
                    PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
                spawnSequence: 2
            }),
            2,
            'tower-combat:player-friendly-block'
        );
        assert(
            existingPlayerRequest.accepted
                && hostileThirteenRequest.accepted
                && friendlyBlockRequest.accepted,
            'Tower combat tick 2 projectile request 실패: '
                + JSON.stringify({
                    existingPlayerRequest,
                    hostileThirteenRequest,
                    friendlyBlockRequest
                })
        );
        const damageCommit = endpoint.commitAtFixedBoundary(2);
        assert(
            damageCommit.state === 'committed'
                && damageCommit.spawned.length === 2
                && damageCommit.fixedCommands.sourceRelativeSpawns.length === 1
                && damageCommit.fixedCommands.rejected.length === 0
                && !damageCommit.recoveryRequired,
            'Tower combat tick 2 spawn/program commit 실패: '
                + JSON.stringify(damageCommit)
        );
        const damageHandles = new Map(
            damageCommit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        const hostileThirteenHandle = damageHandles.get('tower-combat:hostile-thirteen');
        const friendlyBlockHandle = damageHandles.get('tower-combat:player-friendly-block');
        const existingPlayerHandle = damageCommit.fixedCommands.sourceRelativeSpawns.find(
            ({ commandId }) => commandId === 'tower-combat:existing-player-projectile'
        )?.handle;
        assert(hostileThirteenHandle && friendlyBlockHandle && existingPlayerHandle,
            'Tower combat tick 2 projectile exact handle 누락');
        assert(
            endpoint.fixedUpdate(fixedDelta, 2),
            'Tower combat tick 2 fixed submit 실패'
        );
        await settlePhase5Endpoint(
            endpoint,
            'Tower combat initial damage completion',
            { spawnProgram: true }
        );
        const afterThirteenBodies = await readPhase5Bodies(endpoint);
        const towerAfterThirteen = findPhase5Body(
            afterThirteenBodies,
            towerHandle,
            'Tower after hostile 13'
        );
        const hostileThirteenAfter = findPhase5Body(
            afterThirteenBodies,
            hostileThirteenHandle,
            'hostile 13 projectile after hit'
        );
        const friendlyBlockAfter = findPhase5Body(
            afterThirteenBodies,
            friendlyBlockHandle,
            'friendly-fire blocked projectile'
        );
        const existingPlayerBeforeDeath = findPhase5Body(
            afterThirteenBodies,
            existingPlayerHandle,
            'existing player projectile before Tower death'
        );
        assertNear(towerAfterThirteen.health, 17, 0.000001,
            'hostile 13 Tower HP 30→17');
        assertNear(hostileThirteenAfter.health, 1, 0.000001,
            'hostile 13 projectile penetration 14→1');
        assertNear(friendlyBlockAfter.health, 9, 0.000001,
            'PLAYER friendly-fire blocked projectile penetration 보존');

        const firstCompleted = endpoint.commitCompletedEventsAtFixedBoundary(3);
        const hostileThirteenContact = firstCompleted.contactEvents.find((event) => (
            eventMatches(event, hostileThirteenHandle, towerHandle)
        ));
        const friendlyBlockContact = firstCompleted.contactEvents.find((event) => (
            eventMatches(event, friendlyBlockHandle, towerHandle)
        ));
        assert(
            firstCompleted.protocolFailure === null
                && hostileThirteenContact?.eventType === 'damage-applied'
                && hostileThirteenContact.disposition === 'applied'
                && hostileThirteenContact.damageFixedPoint === 1300
                && hostileThirteenContact.damage === 13
                && friendlyBlockContact?.eventType === 'interaction-continuous'
                && friendlyBlockContact.disposition === 'applied'
                && friendlyBlockContact.damageFixedPoint === 0
                && friendlyBlockContact.damage === 0
                && friendlyBlockContact.reason === 'interaction'
                && !firstCompleted.contactEvents.some((event) => (
                    eventMatches(event, friendlyBlockHandle, towerHandle)
                    && event.eventType === 'damage-applied'
                ))
                && !firstCompleted.deathEvents.some((event) => (
                    (event.entityId === towerHandle.entityId
                        && event.incarnation === towerHandle.incarnation)
                    || (event.entityId === friendlyBlockHandle.entityId
                        && event.incarnation === friendlyBlockHandle.incarnation)
                )),
            'Tower combat hostile/friendly event contract 불일치: '
                + JSON.stringify(firstCompleted)
        );
        const roster = new TowerCombatRoster({
            maxHp: THE_TOWER_COMBAT_DATA.MAX_HEALTH
        });
        roster.bindGpuBody(towerHandle, {
            sessionGeneration: hostileThirteenContact.sessionGeneration,
            deviceGeneration: hostileThirteenContact.deviceGeneration,
            authoritativeEpoch: hostileThirteenContact.authoritativeEpoch
        });
        const firstRosterFacts = roster.commitCompletedEvents(
            firstCompleted,
            endpoint.getRegistry()
        );
        assert(
            firstRosterFacts.length === 1
                && firstRosterFacts[0].type
                    === TOWER_COMBAT_FACT_TYPE.DAMAGE_APPLIED
                && firstRosterFacts[0].damageFixedPoint === 1300
                && firstRosterFacts[0].currentHp === 17
                && firstRosterFacts[0].sourceHandle.entityId
                    === hostileThirteenHandle.entityId
                && firstRosterFacts[0].sourceHandle.incarnation
                    === hostileThirteenHandle.incarnation
                && firstRosterFacts[0].targetHandle.entityId === towerHandle.entityId
                && firstRosterFacts[0].targetHandle.incarnation
                    === towerHandle.incarnation
                && firstRosterFacts[0].producerId
                    === 'nw-hostile-tower-producer'
                && firstRosterFacts[0].sourceAbilityId
                    === 'hostile-tower-shot-13'
                && roster.getPrimaryTowerCurrentHp() === 17,
            'Tower combat roster first damage/provenance 불일치: '
                + JSON.stringify(firstRosterFacts)
        );
        const duplicateFacts = roster.commitCompletedEvents(
            firstCompleted,
            endpoint.getRegistry()
        );
        const oldGenerationFacts = roster.commitCompletedEvents({
            events: [{
                ...hostileThirteenContact,
                sessionGeneration: hostileThirteenContact.sessionGeneration - 1
            }]
        }, endpoint.getRegistry());
        const oldIncarnationFacts = roster.commitCompletedEvents({
            events: [{
                ...hostileThirteenContact,
                other: {
                    entityId: towerHandle.entityId,
                    incarnation: towerHandle.incarnation + 1
                },
                otherIncarnation: towerHandle.incarnation + 1
            }]
        }, endpoint.getRegistry());
        assert(
            duplicateFacts.length === 0
                && oldGenerationFacts.length === 0
                && oldIncarnationFacts.length === 0
                && roster.getPrimaryTowerCurrentHp() === 17,
            'Tower combat roster duplicate/stale generation/incarnation 무시 실패'
        );
        const aliveReplacement =
            await runProductionTowerCombatAliveReplacementHardwareSmoke(
                device,
                navigationSource,
                towerAfterThirteen.health
            );

        const lethalRequest = endpoint.requestSpawn(
            createHostileIntent(
                hostileLethalDefinition,
                towerPosition,
                { x: 0, y: 0 },
                enemyHandle,
                'nw-hostile-tower-producer',
                'hostile-tower-shot-lethal',
                3
            ),
            3,
            'tower-combat:hostile-lethal'
        );
        assert(lethalRequest.accepted,
            'Tower combat lethal projectile request 실패: '
                + JSON.stringify(lethalRequest));
        const lethalCommit = endpoint.commitAtFixedBoundary(3);
        const lethalHandle = lethalCommit.spawned.find(
            ({ commandId }) => commandId === 'tower-combat:hostile-lethal'
        )?.handle;
        assert(
            lethalCommit.state === 'committed'
                && lethalCommit.despawned.length === 0
                && lethalHandle
                && !lethalCommit.recoveryRequired,
            'Tower combat lethal spawn commit 실패: '
                + JSON.stringify(lethalCommit)
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, 3),
            'Tower combat lethal fixed submit 실패'
        );
        await settlePhase5Endpoint(endpoint, 'Tower combat lethal completion');
        const afterLethalBodies = await readPhase5Bodies(endpoint);
        assert(
            !afterLethalBodies.some((body) => (
                body.handle?.entityId === towerHandle.entityId
                && body.handle?.incarnation === towerHandle.incarnation
            ))
                && !afterLethalBodies.some((body) => (
                    body.handle?.entityId === lethalHandle.entityId
                    && body.handle?.incarnation === lethalHandle.incarnation
                ))
                && endpoint.getRegistry().has(towerHandle)
                && endpoint.hasBody(towerHandle),
            'Tower combat lethal GPU alive/endpoint pre-cleanup 상태 불일치: '
                + JSON.stringify(afterLethalBodies)
        );
        const cameraScale = 8;
        endpoint.updatePresentation({
            frameDelta: 0,
            fixedDelta,
            fixedAlpha: 1,
            renderFrameId: 5801
        });
        assert(endpoint.draw({
            worldToViewport(x, y, out) {
                out.x = x * cameraScale;
                out.y = y * cameraScale;
                return out;
            },
            getScale: () => cameraScale
        }), 'Tower combat lethal render submit 실패');
        assert(lastFrameTexture, 'Tower combat lethal render texture가 없습니다.');
        const towerAlphaAfterLethal = await readPhase5WorldAlpha(
            device,
            lastFrameTexture,
            towerPosition,
            cameraScale,
            'tower-combat-lethal-render-readback'
        );
        assert(
            drawMarks === 1 && towerAlphaAfterLethal === 0,
            'Tower combat lethal Tower render exclusion 실패: '
                + JSON.stringify({ drawMarks, towerAlphaAfterLethal })
        );

        const lethalCompleted = endpoint.commitCompletedEventsAtFixedBoundary(4);
        const lethalContact = lethalCompleted.contactEvents.find((event) => (
            eventMatches(event, lethalHandle, towerHandle)
        ));
        const lethalTowerDeathEvents = lethalCompleted.deathEvents.filter((event) => (
            event.entityId === towerHandle.entityId
            && event.incarnation === towerHandle.incarnation
            && event.disposition === 'despawn-requested'
        ));
        assert(
            lethalCompleted.protocolFailure === null
                && lethalContact?.eventType === 'damage-applied'
                && lethalContact.disposition === 'applied'
                && lethalContact.damageFixedPoint === 1700
                && lethalContact.reason === 'target-died'
                && lethalTowerDeathEvents.length === 1,
            'Tower combat lethal event/death contract 불일치: '
                + JSON.stringify(lethalCompleted)
        );
        const lethalRosterFacts = roster.commitCompletedEvents(
            lethalCompleted,
            endpoint.getRegistry()
        );
        const rosterDeath = lethalRosterFacts.find(
            ({ type }) => type === TOWER_COMBAT_FACT_TYPE.DIED
        );
        const noLiving = lethalRosterFacts.find(
            ({ type }) => type === TOWER_COMBAT_FACT_TYPE.NO_LIVING_TOWERS
        );
        const deadRosterStatus = roster.getStatus();
        assert(
            lethalRosterFacts.filter(
                ({ type }) => type === TOWER_COMBAT_FACT_TYPE.DAMAGE_APPLIED
            ).length === 1
                && rosterDeath
                && noLiving
                && rosterDeath.sourceHandle?.entityId === lethalHandle.entityId
                && rosterDeath.sourceHandle?.incarnation === lethalHandle.incarnation
                && rosterDeath.producerId === 'nw-hostile-tower-producer'
                && rosterDeath.sourceAbilityId === 'hostile-tower-shot-lethal'
                && noLiving.livingTowerCount === 0
                && roster.getPrimaryTowerCurrentHp() === 0
                && roster.getLivingTowerCount() === 0
                && deadRosterStatus.alive === false
                && deadRosterStatus.currentHp === 0
                && deadRosterStatus.livingTowerCount === 0
                && deadRosterStatus.boundGpuBody === null,
            'Tower combat roster lethal/death/NoLiving provenance 불일치: '
                + JSON.stringify(lethalRosterFacts)
        );
        const deadReplacement =
            await runProductionTowerCombatDeadReplacementHardwareSmoke(
                device,
                navigationSource,
                deadRosterStatus
            );
        const towerCleanup = endpoint.commitAtFixedBoundary(4);
        assert(
            towerCleanup.state === 'committed'
                && towerCleanup.despawned.length === 2
                && towerCleanup.despawned.some((entry) => (
                    exactHandleMatches(entry, towerHandle)
                ))
                && towerCleanup.despawned.some((entry) => (
                    exactHandleMatches(entry, lethalHandle)
                ))
                && towerCleanup.rejected.length === 0,
            'Tower combat next-boundary Tower/projectile cleanup 실패: '
                + JSON.stringify(towerCleanup)
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, 4),
            'Tower combat zero-Tower 첫 fixed submit 실패'
        );
        await settlePhase5Endpoint(endpoint, 'Tower combat zero-Tower first completion');
        const zeroTowerStartBodies = await readPhase5Bodies(endpoint);
        const existingPlayerAfterDeath = findPhase5Body(
            zeroTowerStartBodies,
            existingPlayerHandle,
            'existing player projectile after Tower death'
        );
        const enemyAtZeroTowerStart = findPhase5Body(
            zeroTowerStartBodies,
            enemyHandle,
            'Enemy after Tower death'
        );
        const sourceViewAfterTowerDeath = endpoint.getRegistry().copyEntityView(
            existingPlayerHandle,
            {}
        );
        const cleanupStatus = endpoint.getStatus();
        const deadTowerTargetRequest = playerProjectileAdapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
            definition: hostileLethalDefinition,
            sourceHandle: enemyHandle,
            targetHandle: towerHandle,
            positionOffset: { x: 0.6, y: 0 },
            targetOffset: { x: 0, y: 0 },
            launchSpeed: 12,
            allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
            targetPolicyId:
                PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
            producerId: 'nw-dead-tower-target-probe',
            sourceAbilityId: 'dead-tower-target-probe',
            targetFixedTick: 5,
            spawnSequence: 4,
            commandId: 'tower-combat:dead-tower-target-probe'
        });
        assert(
            !endpoint.getRegistry().has(towerHandle)
                && !endpoint.hasBody(towerHandle)
                && endpoint.getRegistry().has(coreHandle)
                && endpoint.hasBody(coreHandle)
                && endpoint.getRegistry().has(enemyHandle)
                && endpoint.hasBody(enemyHandle)
                && endpoint.getRegistry().has(existingPlayerHandle)
                && endpoint.hasBody(existingPlayerHandle)
                && sourceViewAfterTowerDeath?.metadata?.sourceEntityId
                    === towerHandle.entityId
                && sourceViewAfterTowerDeath.metadata.sourceIncarnation
                    === towerHandle.incarnation
                && !deadTowerTargetRequest.accepted
                && deadTowerTargetRequest.reason === 'stale-target'
                && !cleanupStatus.recoveryRequired,
            'Tower combat dead replacement/Core/existing projectile cleanup 불일치: '
                + JSON.stringify({
                    cleanupStatus,
                    sourceViewAfterTowerDeath,
                    deadTowerTargetRequest
                })
        );

        let zeroTowerSubmissionCount = 1;
        const postDeathPlayerDamageEvents = [];
        for (let tick = 5; tick <= 13; tick++) {
            const completed = endpoint.commitCompletedEventsAtFixedBoundary(tick);
            assert(
                completed.protocolFailure === null,
                'Tower combat zero-Tower completed-event protocol 실패: tick='
                    + tick + ', result=' + JSON.stringify(completed)
            );
            for (const event of completed.contactEvents) {
                if (eventMatches(event, existingPlayerHandle, enemyHandle)
                    && event.eventType === 'damage-applied') {
                    postDeathPlayerDamageEvents.push(event);
                }
            }
            const commit = endpoint.commitAtFixedBoundary(tick);
            assert(
                commit.state === 'committed'
                    && commit.rejected.length === 0
                    && !commit.recoveryRequired,
                'Tower combat zero-Tower lifecycle commit 실패: tick='
                    + tick + ', result=' + JSON.stringify(commit)
            );
            assert(
                endpoint.fixedUpdate(fixedDelta, tick),
                'Tower combat zero-Tower fixed submit 실패: tick=' + tick
            );
            zeroTowerSubmissionCount++;
            await settlePhase5Endpoint(
                endpoint,
                'Tower combat zero-Tower tick ' + tick
            );
        }
        const finalCompleted = endpoint.commitCompletedEventsAtFixedBoundary(14);
        assert(
            finalCompleted.protocolFailure === null,
            'Tower combat final completed-event protocol 실패: '
                + JSON.stringify(finalCompleted)
        );
        for (const event of finalCompleted.contactEvents) {
            if (eventMatches(event, existingPlayerHandle, enemyHandle)
                && event.eventType === 'damage-applied') {
                postDeathPlayerDamageEvents.push(event);
            }
        }
        const zeroTowerFinalBodies = await readPhase5Bodies(endpoint);
        const coreAfterZeroTower = findPhase5Body(
            zeroTowerFinalBodies,
            coreHandle,
            'Core after zero-Tower submissions'
        );
        const enemyAfterZeroTower = findPhase5Body(
            zeroTowerFinalBodies,
            enemyHandle,
            'Enemy after zero-Tower submissions'
        );
        const existingPlayerAfterZeroTower = findPhase5Body(
            zeroTowerFinalBodies,
            existingPlayerHandle,
            'existing player projectile after zero-Tower submissions'
        );
        const finalStatus = endpoint.getStatus();
        const storageProfile = finalStatus.backend.gpu.fixedPrimitives.storageProfile;
        assert(
            zeroTowerSubmissionCount >= 10
                && postDeathPlayerDamageEvents.length >= 1
                && postDeathPlayerDamageEvents.every((event) => (
                    event.disposition === 'applied'
                    && event.damageFixedPoint === 100
                ))
                && existingPlayerAfterZeroTower.position.x
                    > existingPlayerAfterDeath.position.x
                && existingPlayerAfterZeroTower.lifetime
                    < existingPlayerAfterDeath.lifetime
                && enemyAfterZeroTower.health < initialEnemy.health
                && Math.hypot(
                    enemyAfterZeroTower.position.x - enemyAtZeroTowerStart.position.x,
                    enemyAfterZeroTower.position.y - enemyAtZeroTowerStart.position.y
                ) > 0
                && coreAfterZeroTower.handle?.entityId === coreHandle.entityId
                && coreAfterZeroTower.handle?.incarnation === coreHandle.incarnation
                && !endpoint.getRegistry().has(towerHandle)
                && !endpoint.hasBody(towerHandle)
                && !finalStatus.recoveryRequired
                && !endpoint.requiresRecovery()
                && storageProfile.requiredMaximum
                    === REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE,
            'Tower combat zero-Tower progress/recovery/storage 불일치: '
                + JSON.stringify({
                    zeroTowerSubmissionCount,
                    postDeathPlayerDamageEvents,
                    enemyAtZeroTowerStart,
                    enemyAfterZeroTower,
                    existingPlayerAfterDeath,
                    existingPlayerAfterZeroTower,
                    finalStatus,
                    storageProfile
                })
        );
        assert(
            JSON.stringify(domainSentinel) === domainSentinelBefore,
            'Tower combat GPU fixture가 CoreIntegrity/reward/RunFailed sentinel을 변경했습니다.'
        );
        return Object.freeze({
            handles: Object.freeze({
                tower: towerHandle,
                core: coreHandle,
                enemy: enemyHandle,
                hostileThirteen: hostileThirteenHandle,
                friendlyBlock: friendlyBlockHandle,
                lethal: lethalHandle,
                existingPlayerProjectile: existingPlayerHandle
            }),
            towerDamage: Object.freeze({
                maxHp: THE_TOWER_COMBAT_DATA.MAX_HEALTH,
                initialReadbackHp: initialTower.health,
                afterHostileThirteen: towerAfterThirteen.health,
                hostilePenetrationBefore: hostileThirteenDefinition.penetration,
                hostilePenetrationAfter: hostileThirteenAfter.health,
                contact: hostileThirteenContact
            }),
            friendlyFireBlock: Object.freeze({
                targetPolicyId:
                    PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
                towerHpBefore: 17,
                towerHpAfter: towerAfterThirteen.health,
                projectilePenetrationBefore: friendlyBlockDefinition.penetration,
                projectilePenetrationAfter: friendlyBlockAfter.health,
                contact: friendlyBlockContact
            }),
            lethal: Object.freeze({
                contact: lethalContact,
                towerDeathEventCount: lethalTowerDeathEvents.length,
                towerRenderAlpha: towerAlphaAfterLethal,
                cleanup: towerCleanup,
                rosterFacts: lethalRosterFacts,
                deadTowerTargetRequest
            }),
            roster: Object.freeze({
                initialFacts: firstRosterFacts,
                duplicateIgnored: duplicateFacts.length === 0,
                oldGenerationIgnored: oldGenerationFacts.length === 0,
                oldIncarnationIgnored: oldIncarnationFacts.length === 0
            }),
            replacements: Object.freeze({
                alive: aliveReplacement,
                dead: deadReplacement
            }),
            zeroTower: Object.freeze({
                submittedFixedTicks: zeroTowerSubmissionCount,
                corePresent: endpoint.hasBody(coreHandle),
                enemyPresent: endpoint.hasBody(enemyHandle),
                existingProjectilePresent: endpoint.hasBody(existingPlayerHandle),
                postDeathPlayerDamageEvents,
                enemyPositionBefore: Object.freeze({ ...enemyAtZeroTowerStart.position }),
                enemyPositionAfter: Object.freeze({ ...enemyAfterZeroTower.position }),
                enemyHealth: Object.freeze({
                    initial: initialEnemy.health,
                    final: enemyAfterZeroTower.health
                }),
                projectilePositionBefore:
                    Object.freeze({ ...existingPlayerAfterDeath.position }),
                projectilePositionAfter:
                    Object.freeze({ ...existingPlayerAfterZeroTower.position }),
                existingProjectileLifetime: Object.freeze({
                    afterTowerDeath: existingPlayerAfterDeath.lifetime,
                    afterZeroTowerTicks: existingPlayerAfterZeroTower.lifetime
                }),
                originalTowerPresentAfterCleanup: endpoint.hasBody(towerHandle)
            }),
            diagnostics: Object.freeze({
                coreIntegrityCurrentMutation: 0,
                coreIntegrityMaxMutation: 0,
                rewardMutation: 0,
                runFailedMutation: 0
            }),
            storageProfile,
        });
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
        context.unconfigure();
    }
}

async function runProductionPhase5ContactHardwareSmoke(device, domainSentinel) {
    const navigationSource = createPhase5ProjectileNavigationSource();
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPhase3PlatformPort(device)
    }, {
        capacity: 6,
        controlCommandCapacity: 2,
        sourceRelativeSpawnCommandCapacity: 2,
        spawnProgramCapacity: 2
    });
    const adapter = new GpuProjectileSpawnAdapter(endpoint, {
        commandNamespace: 'nw-phase5-contact'
    });
    const fixedDelta = 1 / 60;
    const towerPosition = Object.freeze({ x: 3.5, y: 4 });
    const enemyPosition = Object.freeze({ x: 4.7, y: 4 });
    const bulletOffset = Object.freeze({ x: 0.6, y: 0 });
    const sentinelBefore = JSON.stringify(domainSentinel);
    try {
        assert(endpoint.init(navigationSource) === false,
            'Phase 5 contact endpoint는 첫 spawn 전 deferred여야 합니다.');
        const contactEnemyDefinition = Object.freeze({
            ...BASIC_CIRCLE_ENEMY_DATA,
            id: 'nw_phase5_basic_bullet_exact_damage_enemy',
            maxHealth: BASIC_BULLET_PROJECTILE_DATA.damage
        });
        const enemyIntent = Object.freeze({
            ...createGpuEnemySpawnIntent({
                definition: contactEnemyDefinition,
                route: navigationSource.route,
                spawnSequence: 0,
                waveId: 'nw-phase5-contact-disabled-wave',
                policyId: 'hardware-fixture'
            }),
            position: enemyPosition,
            velocity: Object.freeze({ x: 0, y: 0 })
        });
        assert(endpoint.requestSpawn(
            createGpuTowerSpawnIntent({ position: towerPosition }),
            1,
            'phase5:contact:tower'
        ).accepted, 'Phase 5 contact Tower spawn request 실패');
        assert(endpoint.requestSpawn(
            enemyIntent,
            1,
            'phase5:contact:enemy'
        ).accepted, 'Phase 5 contact Enemy spawn request 실패');
        const spawnCommit = endpoint.commitAtFixedBoundary(1);
        assert(
            spawnCommit.spawned.length === 2 && spawnCommit.rejected.length === 0,
            `Phase 5 contact actor spawn commit 실패: ${JSON.stringify(spawnCommit)}`
        );
        const actorHandles = new Map(
            spawnCommit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        const towerHandle = actorHandles.get('phase5:contact:tower');
        const enemyHandle = actorHandles.get('phase5:contact:enemy');
        assert(towerHandle && enemyHandle, 'Phase 5 contact actor handle 누락');
        assert(endpoint.fixedUpdate(fixedDelta, 1),
            'Phase 5 contact actor initial submit 실패');
        await settlePhase5Endpoint(endpoint, 'Phase 5 contact actor initial completion');
        const preShotBodies = await readPhase5Bodies(endpoint);
        const enemyBeforeShot = findPhase5Body(
            preShotBodies,
            enemyHandle,
            'Enemy before Basic Bullet'
        );

        endpoint.commitCompletedEventsAtFixedBoundary(2);
        const shotReceipt = adapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
            definition: BASIC_BULLET_PROJECTILE_DATA,
            sourceHandle: towerHandle,
            positionOffset: bulletOffset,
            aimWorldPoint: { x: 8, y: towerPosition.y },
            launchSpeed: BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
            producerId: BASIC_BULLET_PRODUCER_ID,
            targetFixedTick: 2,
            spawnSequence: 0,
            commandId: 'phase5:contact:basic-bullet'
        });
        const controlReceipt = endpoint.requestBodyControl({
            handle: towerHandle,
            moveIntentX: 0,
            moveIntentY: 0
        }, 2, 'phase5:contact:tower-control');
        assert(shotReceipt.accepted && controlReceipt.accepted,
            'Phase 5 contact shot/control request 실패');
        const shotCommit = endpoint.commitAtFixedBoundary(2);
        assert(
            shotCommit.fixedCommands.controls.length === 1
                && shotCommit.fixedCommands.sourceRelativeSpawns.length === 1,
            `Phase 5 contact shot commit 실패: ${JSON.stringify(shotCommit)}`
        );
        const bulletHandle = shotCommit.fixedCommands
            .sourceRelativeSpawns[0].handle;
        assert(endpoint.fixedUpdate(fixedDelta, 2),
            'Phase 5 contact shot submit 실패');
        await settlePhase5Endpoint(
            endpoint,
            'Phase 5 contact/death completion',
            { spawnProgram: true }
        );
        const afterContactBodies = await readPhase5Bodies(endpoint);
        assert(
            !afterContactBodies.some((body) => (
                body.handle?.entityId === bulletHandle.entityId
                    && body.handle?.incarnation === bulletHandle.incarnation
            ))
                && !afterContactBodies.some((body) => (
                    body.handle?.entityId === enemyHandle.entityId
                    && body.handle?.incarnation === enemyHandle.incarnation
                )),
            `Phase 5 contact 뒤 dead body가 ALIVE readback에 남았습니다: ${JSON.stringify(afterContactBodies)}`
        );
        const completed = endpoint.commitCompletedEventsAtFixedBoundary(3);
        const appliedContact = completed.contactEvents.find((event) => (
            event.entityId === bulletHandle.entityId
                && event.incarnation === bulletHandle.incarnation
                && event.otherEntityId === enemyHandle.entityId
                && event.otherIncarnation === enemyHandle.incarnation
        ));
        const expectedDamageFixedPoint = Math.trunc(Math.fround(
            Math.fround(BASIC_BULLET_PROJECTILE_DATA.damage) * Math.fround(100)
        ));
        assert(
            appliedContact
                && appliedContact.damageFixedPoint === expectedDamageFixedPoint,
            `Phase 5 Basic Bullet→Enemy exact damage가 없습니다: ${JSON.stringify(completed.contactEvents)}`
        );
        assertNear(
            appliedContact.damage,
            BASIC_BULLET_PROJECTILE_DATA.damage,
            0.000001,
            'Phase 5 Basic Bullet gameplay damage'
        );
        const deathKeys = new Set(completed.deathEvents.map((event) => (
            `${event.entityId}:${event.incarnation}`
        )));
        assert(
            completed.deathEvents.length === 2
                && deathKeys.has(`${bulletHandle.entityId}:${bulletHandle.incarnation}`)
                && deathKeys.has(`${enemyHandle.entityId}:${enemyHandle.incarnation}`),
            `Phase 5 contact death identity 불일치: ${JSON.stringify(completed.deathEvents)}`
        );
        const cleanupCommit = endpoint.commitAtFixedBoundary(3);
        assert(
            cleanupCommit.despawned.length === 2
                && cleanupCommit.rejected.length === 0,
            `Phase 5 contact death cleanup commit 실패: ${JSON.stringify(cleanupCommit)}`
        );
        const cleanupBodies = await readPhase5Bodies(endpoint);
        const cleanupStatus = endpoint.getStatus();
        const gpuCleanupStatus = endpoint.getBackend().simulation.getStatus();
        assert(
            cleanupBodies.length === 1
                && cleanupStatus.activeCount === 1
                && cleanupStatus.activeEnemyCount === 0
                && cleanupStatus.activeProjectileCount === 0
                && cleanupStatus.reservedCount === 0
                && cleanupStatus.pendingCommandCount === 0
                && gpuCleanupStatus.pendingBodyCount === 0
                && !cleanupStatus.recoveryRequired,
            `Phase 5 contact cleanup 상태 불일치: ${JSON.stringify({ cleanupStatus, gpuCleanupStatus })}`
        );
        assert(JSON.stringify(domainSentinel) === sentinelBefore,
            'Phase 5 contact가 CPU domain sentinel을 변경했습니다.');
        const teamDamageMatrix = await runProductionPhase5TeamDamageMatrixHardwareSmoke(
            device
        );
        return {
            handles: { tower: towerHandle, enemy: enemyHandle, bullet: bulletHandle },
            enemyBeforeShot: {
                position: { ...enemyBeforeShot.position },
                health: enemyBeforeShot.health
            },
            damageFixedPoint: appliedContact.damageFixedPoint,
            damage: appliedContact.damage,
            contactEvent: appliedContact,
            enemyDeathCount: completed.deathEvents.filter((event) => (
                event.entityId === enemyHandle.entityId
            )).length,
            projectileDeathCount: completed.deathEvents.filter((event) => (
                event.entityId === bulletHandle.entityId
            )).length,
            cleanup: {
                activeCount: cleanupStatus.activeCount,
                activeEnemyCount: cleanupStatus.activeEnemyCount,
                activeProjectileCount: cleanupStatus.activeProjectileCount,
                reservedCount: cleanupStatus.reservedCount,
                pendingCommandCount: cleanupStatus.pendingCommandCount,
                pendingBodyCount: gpuCleanupStatus.pendingBodyCount
            },
            teamDamageMatrix
        };
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionPhase5TerrainHardwareSmoke(device, domainSentinel) {
    const blocked = new Uint8Array(16 * 16);
    const blockedCell = Object.freeze({ column: 4, row: 4 });
    blocked[(blockedCell.row * 16) + blockedCell.column] = 1;
    const navigationSource = createPhase5ProjectileNavigationSource({ blocked });
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPhase3PlatformPort(device)
    }, {
        capacity: 4,
        controlCommandCapacity: 2,
        sourceRelativeSpawnCommandCapacity: 2,
        spawnProgramCapacity: 2
    });
    const adapter = new GpuProjectileSpawnAdapter(endpoint, {
        commandNamespace: 'nw-phase5-terrain'
    });
    const fixedDelta = 1 / 60;
    const towerPosition = Object.freeze({ x: 2, y: 4.5 });
    const sentinelBefore = JSON.stringify(domainSentinel);
    let submittedTickCount = 0;
    try {
        assert(endpoint.init(navigationSource) === false,
            'Phase 5 terrain endpoint는 첫 spawn 전 deferred여야 합니다.');
        assert(endpoint.requestSpawn(
            createGpuTowerSpawnIntent({ position: towerPosition }),
            1,
            'phase5:terrain:tower'
        ).accepted, 'Phase 5 terrain Tower spawn request 실패');
        const towerCommit = endpoint.commitAtFixedBoundary(1);
        const towerHandle = towerCommit.spawned[0]?.handle;
        assert(towerHandle, 'Phase 5 terrain Tower handle 누락');
        assert(endpoint.fixedUpdate(fixedDelta, 1),
            'Phase 5 terrain Tower initial submit 실패');
        submittedTickCount = 1;
        await settlePhase5Endpoint(endpoint, 'Phase 5 terrain Tower completion');

        endpoint.commitCompletedEventsAtFixedBoundary(2);
        const shotReceipt = adapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
            definition: BASIC_BULLET_PROJECTILE_DATA,
            sourceHandle: towerHandle,
            positionOffset: { x: 0.6, y: 0 },
            aimWorldPoint: { x: 8, y: towerPosition.y },
            launchSpeed: BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
            producerId: BASIC_BULLET_PRODUCER_ID,
            targetFixedTick: 2,
            spawnSequence: 0,
            commandId: 'phase5:terrain:basic-bullet'
        });
        assert(shotReceipt.accepted, 'Phase 5 terrain shot request 실패');
        assert(endpoint.requestBodyControl({
            handle: towerHandle,
            moveIntentX: 0,
            moveIntentY: 0
        }, 2, 'phase5:terrain:control:2').accepted,
        'Phase 5 terrain tick 2 control request 실패');
        const shotCommit = endpoint.commitAtFixedBoundary(2);
        const bulletHandle = shotCommit.fixedCommands
            .sourceRelativeSpawns[0]?.handle;
        assert(bulletHandle, `Phase 5 terrain bullet handle 누락: ${JSON.stringify(shotCommit)}`);
        assert(endpoint.fixedUpdate(fixedDelta, 2),
            'Phase 5 terrain shot submit 실패');
        submittedTickCount = 2;
        await settlePhase5Endpoint(
            endpoint,
            'Phase 5 terrain shot completion',
            { spawnProgram: true }
        );

        let terrainDeath = null;
        let terrainContact = null;
        let cleanupCommit = null;
        for (let tick = 3; tick <= 16; tick++) {
            const completed = endpoint.commitCompletedEventsAtFixedBoundary(tick);
            terrainDeath = completed.deathEvents.find((event) => (
                event.entityId === bulletHandle.entityId
                    && event.incarnation === bulletHandle.incarnation
            )) ?? null;
            terrainContact = completed.contactEvents.find((event) => (
                event.entityId === bulletHandle.entityId
                    && event.incarnation === bulletHandle.incarnation
            )) ?? terrainContact;
            if (terrainDeath) {
                cleanupCommit = endpoint.commitAtFixedBoundary(tick);
                break;
            }
            assert(endpoint.requestBodyControl({
                handle: towerHandle,
                moveIntentX: 0,
                moveIntentY: 0
            }, tick, `phase5:terrain:control:${tick}`).accepted,
            `Phase 5 terrain control request 실패: tick=${tick}`);
            const commit = endpoint.commitAtFixedBoundary(tick);
            assert(
                commit.fixedCommands.controls.length === 1
                    && !commit.recoveryRequired,
                `Phase 5 terrain control commit 실패: tick=${tick}, result=${JSON.stringify(commit)}`
            );
            assert(endpoint.fixedUpdate(fixedDelta, tick),
                `Phase 5 terrain fixed submit 실패: tick=${tick}`);
            submittedTickCount = tick;
            await settlePhase5Endpoint(endpoint, `Phase 5 terrain tick ${tick}`);
        }
        assert(
            terrainDeath && cleanupCommit?.despawned.length === 1,
            `Phase 5 terrain death/cleanup가 완료되지 않았습니다: ${JSON.stringify({ terrainDeath, cleanupCommit })}`
        );
        const status = endpoint.getStatus();
        const gpuStatus = endpoint.getBackend().simulation.getStatus();
        assert(
            status.activeCount === 1
                && status.activeProjectileCount === 0
                && status.reservedCount === 0
                && status.pendingCommandCount === 0
                && gpuStatus.pendingBodyCount === 0
                && !status.recoveryRequired,
            `Phase 5 terrain cleanup 상태 불일치: ${JSON.stringify({ status, gpuStatus })}`
        );
        assert(JSON.stringify(domainSentinel) === sentinelBefore,
            'Phase 5 terrain contact가 CPU domain sentinel을 변경했습니다.');
        return {
            blockedCell,
            bulletHandle,
            submittedTickCount,
            terrainContact,
            terrainDeath,
            cleanup: {
                activeCount: status.activeCount,
                activeProjectileCount: status.activeProjectileCount,
                reservedCount: status.reservedCount,
                pendingCommandCount: status.pendingCommandCount,
                pendingBodyCount: gpuStatus.pendingBodyCount
            }
        };
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

function createPhase5LifetimeF32Oracle(authoredLifetime, fixedDelta) {
    const dt = Math.fround(fixedDelta);
    let lifetime = Math.fround(authoredLifetime);
    assert(
        Number.isFinite(lifetime) && lifetime >= 0 && dt > 0,
        `Phase 5 lifetime f32 oracle 입력이 유효하지 않습니다: ${JSON.stringify({
            authoredLifetime,
            fixedDelta,
            lifetime,
            dt
        })}`
    );
    let fixedTick = 0;
    let lifetimeBeforeZero = lifetime;
    do {
        lifetimeBeforeZero = lifetime;
        lifetime = Math.fround(Math.max(Math.fround(lifetime - dt), 0));
        fixedTick++;
        assert(fixedTick <= 10_000, 'Phase 5 lifetime f32 oracle 반복 상한을 초과했습니다.');
    } while (lifetime !== 0);
    return Object.freeze({
        authoredLifetime: Math.fround(authoredLifetime),
        fixedDelta: dt,
        firstZeroFixedTick: fixedTick,
        lifetimeBeforeZero
    });
}

async function runProductionPhase5LifetimeHardwareSmoke(device, domainSentinel) {
    const navigationSource = createPhase5ProjectileNavigationSource();
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPhase3PlatformPort(device)
    }, {
        capacity: 4,
        controlCommandCapacity: 1,
        sourceRelativeSpawnCommandCapacity: 1,
        spawnProgramCapacity: 1
    });
    const adapter = new GpuProjectileSpawnAdapter(endpoint, {
        commandNamespace: 'nw-phase5-lifetime'
    });
    const fixedDelta = 1 / 60;
    const lifetimeDeathFlag = 1 << 1;
    const lifetimeOracle = createPhase5LifetimeF32Oracle(
        BASIC_BULLET_PROJECTILE_DATA.lifetimeSeconds,
        fixedDelta
    );
    const halfDeltaLifetime = Math.fround(Math.fround(fixedDelta) * 0.5);
    const observationTick = Math.max(130, lifetimeOracle.firstZeroFixedTick);
    const explicitCleanupBoundaryTick = observationTick + 1;
    assert(
        lifetimeOracle.firstZeroFixedTick === 121,
        `Basic Bullet 2초 f32 first-zero tick이 121이 아닙니다: ${JSON.stringify(lifetimeOracle)}`
    );
    const sentinelBefore = JSON.stringify(domainSentinel);
    const coreIntegrityIdentity = domainSentinel.coreIntegrity;
    let submittedTickCount = 0;
    try {
        assert(endpoint.init(navigationSource) === false,
            'Phase 5 lifetime endpoint는 첫 spawn 전 deferred여야 합니다.');
        const finiteRequest = adapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.ABSOLUTE,
            definition: BASIC_BULLET_PROJECTILE_DATA,
            position: { x: 8, y: 8 },
            velocity: { x: 0, y: 0 },
            teamId: GAMEPLAY_TEAM_ID.PLAYER,
            allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
            damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
            targetFixedTick: 1,
            spawnSequence: 0,
            commandId: 'phase5:lifetime:basic-bullet'
        });
        const zeroLifetimeRequest = endpoint.requestSpawn(
            createPhase3SpawnIntent('phase5_zero_lifetime_probe', {
                position: { x: 4, y: 4 },
                lifetime: 0
            }),
            1,
            'phase5:lifetime:zero'
        );
        const halfDeltaRequest = endpoint.requestSpawn(
            createPhase3SpawnIntent('phase5_half_delta_lifetime_probe', {
                position: { x: 6, y: 4 },
                lifetime: halfDeltaLifetime
            }),
            1,
            'phase5:lifetime:half-dt'
        );
        const immortalRequest = endpoint.requestSpawn(
            createPhase3SpawnIntent('phase5_immortal_lifetime_probe', {
                position: { x: 10, y: 8 },
                lifetime: -1
            }),
            1,
            'phase5:lifetime:immortal'
        );
        assert(
            finiteRequest.accepted
                && zeroLifetimeRequest.accepted
                && halfDeltaRequest.accepted
                && immortalRequest.accepted,
            `Phase 5 lifetime fixture request 실패: ${JSON.stringify({
                finiteRequest,
                zeroLifetimeRequest,
                halfDeltaRequest,
                immortalRequest
            })}`
        );
        const spawnCommit = endpoint.commitAtFixedBoundary(1);
        assert(
            spawnCommit.spawned.length === 4
                && spawnCommit.rejected.length === 0
                && !spawnCommit.recoveryRequired,
            `Phase 5 lifetime fixture spawn commit 실패: ${JSON.stringify(spawnCommit)}`
        );
        const handleByCommandId = new Map(
            spawnCommit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        const bulletHandle = handleByCommandId.get('phase5:lifetime:basic-bullet');
        const zeroLifetimeHandle = handleByCommandId.get('phase5:lifetime:zero');
        const halfDeltaHandle = handleByCommandId.get('phase5:lifetime:half-dt');
        const immortalHandle = handleByCommandId.get('phase5:lifetime:immortal');
        assert(
            bulletHandle && zeroLifetimeHandle && halfDeltaHandle && immortalHandle,
            `Phase 5 lifetime exact handles 누락: ${JSON.stringify(spawnCommit.spawned)}`
        );
        assert(endpoint.fixedUpdate(fixedDelta, 1),
            'Phase 5 lifetime first submit 실패');
        submittedTickCount = 1;
        await settlePhase5Endpoint(endpoint, 'Phase 5 lifetime tick 1');

        const exactHandleMatches = (eventOrEntry, handle) => {
            const candidate = eventOrEntry?.handle ?? eventOrEntry;
            return candidate?.entityId === handle.entityId
                && candidate?.incarnation === handle.incarnation;
        };
        const expectedDeathHandles = [
            bulletHandle,
            zeroLifetimeHandle,
            halfDeltaHandle
        ];
        const deathObservations = [];
        let finiteSlotCleanup = null;
        let basicBodyBeforeExpiry = null;
        let immortalBodyAfterObservation = null;
        for (let boundaryTick = 2;
            boundaryTick <= explicitCleanupBoundaryTick;
            boundaryTick++) {
            const completed = endpoint.commitCompletedEventsAtFixedBoundary(boundaryTick);
            assert(
                completed.protocolFailure === null
                    && completed.contactEvents.length === 0,
                `Phase 5 lifetime event protocol/contact 불일치: boundary=${boundaryTick}, result=${JSON.stringify(completed)}`
            );
            for (const event of completed.deathEvents) {
                assert(
                    expectedDeathHandles.some((handle) => exactHandleMatches(event, handle)),
                    `Phase 5 lifetime fixture 외 death event가 발생했습니다: ${JSON.stringify(event)}`
                );
                assert(
                    event.reason === 'lifetime'
                        && event.flags === lifetimeDeathFlag
                        && event.reasonFlags === lifetimeDeathFlag
                        && event.disposition === 'despawn-requested',
                    `Phase 5 lifetime death reason/flags가 정확하지 않습니다: ${JSON.stringify(event)}`
                );
                deathObservations.push(Object.freeze({ boundaryTick, event }));
            }

            if (boundaryTick === explicitCleanupBoundaryTick) {
                const cleanupRequest = endpoint.requestDespawn(
                    immortalHandle,
                    'phase5-lifetime-fixture-cleanup',
                    boundaryTick,
                    'phase5:lifetime:immortal:cleanup'
                );
                assert(
                    cleanupRequest.accepted,
                    `Phase 5 immortal explicit cleanup request 실패: ${JSON.stringify(cleanupRequest)}`
                );
            }
            const commit = endpoint.commitAtFixedBoundary(boundaryTick);
            const expectedDespawnCount = boundaryTick === 2
                ? 2
                : boundaryTick === lifetimeOracle.firstZeroFixedTick + 1
                    ? 1
                    : boundaryTick === explicitCleanupBoundaryTick
                        ? 1
                        : 0;
            assert(
                !commit.recoveryRequired
                    && commit.rejected.length === 0
                    && commit.despawned.length === expectedDespawnCount,
                `Phase 5 lifetime lifecycle commit 불일치: boundary=${boundaryTick}, expectedDespawnCount=${expectedDespawnCount}, result=${JSON.stringify(commit)}`
            );
            if (boundaryTick === 2) {
                assert(
                    commit.despawned.some((entry) => exactHandleMatches(entry, zeroLifetimeHandle))
                        && commit.despawned.some((entry) => exactHandleMatches(entry, halfDeltaHandle)),
                    `Phase 5 zero/half-dt next-boundary cleanup identity 불일치: ${JSON.stringify(commit.despawned)}`
                );
            }
            if (boundaryTick === lifetimeOracle.firstZeroFixedTick + 1) {
                assert(
                    commit.despawned.some((entry) => exactHandleMatches(entry, bulletHandle)),
                    `Phase 5 Basic Bullet next-boundary cleanup identity 불일치: ${JSON.stringify(commit.despawned)}`
                );
                const endpointStatus = endpoint.getStatus();
                const gpuStatus = endpoint.getBackend().simulation.getStatus();
                assert(
                    endpointStatus.activeCount === 1
                        && endpointStatus.activeProjectileCount === 1
                        && endpointStatus.reservedCount === 0
                        && endpointStatus.pendingCommandCount === 0
                        && endpointStatus.registry.activeCount === 1
                        && endpointStatus.registry.reservedCount === 0
                        && !endpoint.getRegistry().has(bulletHandle)
                        && !endpoint.hasBody(bulletHandle)
                        && endpoint.getRegistry().has(immortalHandle)
                        && endpoint.hasBody(immortalHandle)
                        && gpuStatus.activeBodyCount === 1
                        && gpuStatus.pendingBodyCount === 0
                        && gpuStatus.freeSlotCount === gpuStatus.bodyCount - 1
                        && !endpointStatus.recoveryRequired,
                    `Phase 5 Basic Bullet registry/body/slot cleanup 불일치: ${JSON.stringify({ endpointStatus, gpuStatus })}`
                );
                finiteSlotCleanup = Object.freeze({
                    boundaryTick,
                    bodyCount: gpuStatus.bodyCount,
                    activeBodyCount: gpuStatus.activeBodyCount,
                    freeSlotCount: gpuStatus.freeSlotCount,
                    pendingBodyCount: gpuStatus.pendingBodyCount,
                    registryActiveCount: endpointStatus.registry.activeCount,
                    registryReservedCount: endpointStatus.registry.reservedCount
                });
            }
            if (boundaryTick === explicitCleanupBoundaryTick) {
                assert(
                    commit.despawned.length === 1
                        && exactHandleMatches(commit.despawned[0], immortalHandle)
                        && commit.despawned[0].reason === 'phase5-lifetime-fixture-cleanup',
                    `Phase 5 immortal explicit cleanup identity 불일치: ${JSON.stringify(commit.despawned)}`
                );
                break;
            }

            assert(
                endpoint.fixedUpdate(fixedDelta, boundaryTick),
                `Phase 5 lifetime fixed submit 실패: tick=${boundaryTick}`
            );
            submittedTickCount = boundaryTick;
            const settledStatus = await settlePhase5Endpoint(
                endpoint,
                `Phase 5 lifetime tick ${boundaryTick}`
            );
            assert(
                settledStatus.state === 'ready'
                    && !settledStatus.requiresAuthoritativeRebuild
                    && !endpoint.requiresRecovery(),
                `Phase 5 lifetime tick recovery 발생: tick=${boundaryTick}, status=${JSON.stringify(settledStatus)}`
            );
            if (boundaryTick === lifetimeOracle.firstZeroFixedTick - 1) {
                const bodies = await readPhase5Bodies(endpoint);
                basicBodyBeforeExpiry = findPhase5Body(
                    bodies,
                    bulletHandle,
                    'Basic Bullet before exact lifetime expiry'
                );
                assert(
                    basicBodyBeforeExpiry.lifetime === lifetimeOracle.lifetimeBeforeZero,
                    `Phase 5 Basic Bullet expiry 직전 f32 lifetime 불일치: ${JSON.stringify({
                        actual: basicBodyBeforeExpiry.lifetime,
                        expected: lifetimeOracle.lifetimeBeforeZero
                    })}`
                );
            }
            if (boundaryTick === lifetimeOracle.firstZeroFixedTick) {
                const bodies = await readPhase5Bodies(endpoint);
                assert(
                    !bodies.some((body) => exactHandleMatches(body, bulletHandle))
                        && bodies.some((body) => exactHandleMatches(body, immortalHandle)),
                    `Phase 5 exact expiry tick ALIVE body 상태 불일치: ${JSON.stringify(bodies)}`
                );
            }
            if (boundaryTick === observationTick) {
                const bodies = await readPhase5Bodies(endpoint);
                immortalBodyAfterObservation = findPhase5Body(
                    bodies,
                    immortalHandle,
                    'immortal body after 130 ticks'
                );
                assert(
                    immortalBodyAfterObservation.lifetime === -1,
                    `Phase 5 immortal sentinel이 변경되었습니다: ${JSON.stringify(immortalBodyAfterObservation)}`
                );
            }
        }

        const deathsForHandle = (handle) => deathObservations.filter(({ event }) => (
            exactHandleMatches(event, handle)
        ));
        const basicDeaths = deathsForHandle(bulletHandle);
        const zeroDeaths = deathsForHandle(zeroLifetimeHandle);
        const halfDeltaDeaths = deathsForHandle(halfDeltaHandle);
        const immortalDeaths = deathsForHandle(immortalHandle);
        assert(
            basicDeaths.length === 1
                && basicDeaths[0].boundaryTick
                    === lifetimeOracle.firstZeroFixedTick + 1
                && basicDeaths[0].event.sourceTick
                    === lifetimeOracle.firstZeroFixedTick
                && zeroDeaths.length === 1
                && zeroDeaths[0].boundaryTick === 2
                && zeroDeaths[0].event.sourceTick === 1
                && halfDeltaDeaths.length === 1
                && halfDeltaDeaths[0].boundaryTick === 2
                && halfDeltaDeaths[0].event.sourceTick === 1
                && immortalDeaths.length === 0
                && deathObservations.length === 3,
            `Phase 5 finite/edge/immortal death count 또는 tick 불일치: ${JSON.stringify(deathObservations)}`
        );
        assert(
            basicBodyBeforeExpiry
                && immortalBodyAfterObservation
                && finiteSlotCleanup
                && submittedTickCount === observationTick,
            `Phase 5 lifetime observation 증거가 완성되지 않았습니다: ${JSON.stringify({
                submittedTickCount,
                observationTick,
                hasBasicBodyBeforeExpiry: !!basicBodyBeforeExpiry,
                hasImmortalBodyAfterObservation: !!immortalBodyAfterObservation,
                hasFiniteSlotCleanup: !!finiteSlotCleanup
            })}`
        );
        const remainingBodies = await endpoint.getBackend().simulation.readbackBodies();
        const status = endpoint.getStatus();
        const gpuStatus = endpoint.getBackend().simulation.getStatus();
        assert(
            remainingBodies.length === 0
                && status.activeCount === 0
                && status.activeProjectileCount === 0
                && status.reservedCount === 0
                && status.pendingCommandCount === 0
                && status.registry.activeCount === 0
                && status.registry.reservedCount === 0
                && gpuStatus.bodyCount === 0
                && gpuStatus.activeBodyCount === 0
                && gpuStatus.pendingBodyCount === 0
                && gpuStatus.freeSlotCount === 0
                && !endpoint.getRegistry().has(immortalHandle)
                && !endpoint.hasBody(immortalHandle)
                && !status.recoveryRequired,
            `Phase 5 lifetime cleanup 상태 불일치: ${JSON.stringify({ status, gpuStatus })}`
        );
        assert(
            domainSentinel.coreIntegrity === coreIntegrityIdentity
                && JSON.stringify(domainSentinel) === sentinelBefore,
            'Phase 5 lifetime가 CPU domain sentinel을 변경했습니다.');
        return {
            authoredLifetimeSeconds: BASIC_BULLET_PROJECTILE_DATA.lifetimeSeconds,
            lifetimeOracle,
            fixedDelta: Math.fround(fixedDelta),
            submittedTickCount,
            observationTick,
            expectedDeathSourceTick: lifetimeOracle.firstZeroFixedTick,
            deathSourceTick: basicDeaths[0].event.sourceTick,
            deathObservedBoundaryTick: basicDeaths[0].boundaryTick,
            handles: {
                finiteBasicBullet: bulletHandle,
                zeroLifetime: zeroLifetimeHandle,
                halfDeltaLifetime: halfDeltaHandle,
                immortal: immortalHandle
            },
            finite: {
                lifetimeBeforeZero: basicBodyBeforeExpiry.lifetime,
                deathReason: basicDeaths[0].event.reason,
                deathFlags: basicDeaths[0].event.flags,
                deathCount: basicDeaths.length,
                cleanup: finiteSlotCleanup
            },
            edgeCases: {
                zeroLifetime: {
                    authoredLifetime: 0,
                    deathSourceTick: zeroDeaths[0].event.sourceTick,
                    deathReason: zeroDeaths[0].event.reason,
                    deathCount: zeroDeaths.length
                },
                halfDeltaLifetime: {
                    authoredLifetime: halfDeltaLifetime,
                    deathSourceTick: halfDeltaDeaths[0].event.sourceTick,
                    deathReason: halfDeltaDeaths[0].event.reason,
                    deathCount: halfDeltaDeaths.length
                }
            },
            immortal: {
                authoredLifetime: -1,
                observedThroughTick: observationTick,
                lifetimeAfterObservation: immortalBodyAfterObservation.lifetime,
                lifetimeDeathCount: immortalDeaths.length,
                explicitCleanupBoundaryTick
            },
            cleanup: {
                activeCount: status.activeCount,
                activeProjectileCount: status.activeProjectileCount,
                reservedCount: status.reservedCount,
                pendingCommandCount: status.pendingCommandCount,
                registryActiveCount: status.registry.activeCount,
                registryReservedCount: status.registry.reservedCount,
                bodyCount: gpuStatus.bodyCount,
                activeBodyCount: gpuStatus.activeBodyCount,
                pendingBodyCount: gpuStatus.pendingBodyCount,
                freeSlotCount: gpuStatus.freeSlotCount,
                recoveryRequired: status.recoveryRequired
            },
            cpuDomainSentinel: {
                coreIntegrityIdentityPreserved:
                    domainSentinel.coreIntegrity === coreIntegrityIdentity,
                unchanged: JSON.stringify(domainSentinel) === sentinelBefore
            }
        };
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionPhase5ProjectileLifecycleHardwareSmoke(device) {
    const coreIntegrity = { current: 100, max: 100 };
    const domainSentinel = {
        coreIntegrity,
        gold: 0,
        reward: 0
    };
    const before = JSON.stringify(domainSentinel);
    const contact = await runProductionPhase5ContactHardwareSmoke(
        device,
        domainSentinel
    );
    const terrain = await runProductionPhase5TerrainHardwareSmoke(
        device,
        domainSentinel
    );
    const lifetime = await runProductionPhase5LifetimeHardwareSmoke(
        device,
        domainSentinel
    );
    assert(
        domainSentinel.coreIntegrity === coreIntegrity
            && JSON.stringify(domainSentinel) === before,
        `Phase 5 projectile lifecycle가 CPU domain sentinel을 변경했습니다: ${JSON.stringify(domainSentinel)}`
    );
    return {
        contact,
        terrain,
        lifetime,
        cpuDomainSentinel: {
            coreIntegrityIdentityPreserved: domainSentinel.coreIntegrity === coreIntegrity,
            coreIntegrityCurrentMutation: 0,
            coreIntegrityMaxMutation: 0,
            goldMutation: domainSentinel.gold,
            rewardMutation: domainSentinel.reward
        }
    };
}

function createPhase5PressureSpawn(sourceHandle, destinationHandle, index = 0) {
    return {
        sourceHandle,
        destinationHandle,
        destinationSpawn: createPhase3Body({
            position: { x: 0, y: 0 },
            velocity: { x: 0, y: 0 },
            definitionId: `phase5_pressure_destination_${index}`
        }),
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY,
        positionOffset: { x: 0.5 + (index * 0.25), y: 0 },
        launchVelocity: { x: 1, y: 0 },
        sourceVelocityScale: 0
    };
}

function createTargetEntityPressureSpawn(
    sourceHandle,
    targetHandle,
    destinationHandle,
    index = 0
) {
    return {
        sourceHandle,
        targetHandle,
        destinationHandle,
        destinationSpawn: createPhase3Body({
            position: { x: 0, y: 0 },
            velocity: { x: 0, y: 0 },
            definitionId: `target_entity_pressure_destination_${index}`
        }),
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        positionOffset: { x: 0.5 + (index * 0.1), y: 0 },
        targetOffset: { x: 0, y: 0 },
        launchSpeed: 12
    };
}

async function runProductionTargetEntitySinglePressureHardwareSmoke(device, mode) {
    const bodyCapacity = mode === 'body-capacity';
    const simulation = new GpuCircleBodySimulation(
        createPhase3PlatformPort(device),
        {
            capacity: bodyCapacity ? 2 : 6,
            worldSize: { x: 8, y: 8 },
            gridCellSize: { x: 1, y: 1 },
            controlCommandCapacity: 1,
            spawnProgramCapacity: bodyCapacity ? 2 : 1,
            sessionGeneration: bodyCapacity ? 81 : 82
        }
    );
    const fixedDelta = 1 / 60;
    const source = Object.freeze({
        ...createGpuTowerSpawnIntent({ position: { x: 2, y: 2 } }),
        entityId: bodyCapacity ? 9921 : 9931,
        incarnation: 1
    });
    const target = Object.freeze({
        ...createGpuTowerSpawnIntent({ position: { x: 6, y: 2 } }),
        entityId: bodyCapacity ? 9922 : 9932,
        incarnation: 1
    });
    const requestedSpawnCount = bodyCapacity ? 1 : 2;
    const pressureSpawns = Array.from(
        { length: requestedSpawnCount },
        (_, index) => createTargetEntityPressureSpawn(
            source,
            target,
            {
                entityId: (bodyCapacity ? 9941 : 9951) + index,
                incarnation: 1
            },
            index
        )
    );

    try {
        assert(simulation.init(), `Target-entity ${mode} simulation init 실패`);
        assert(
            simulation.spawnBodies([source, target]).accepted === 2,
            `Target-entity ${mode} Tower source/target spawn 실패`
        );
        const staged = simulation.stageFixedPrograms({
            targetFixedTick: 1,
            controls: [{
                entityId: source.entityId,
                incarnation: source.incarnation,
                moveIntentX: 1,
                moveIntentY: 0
            }],
            sourceRelativeSpawns: pressureSpawns
        });
        assert(
            staged.controls.accepted === 1
                && staged.controls.rejected === 0
                && staged.sourceRelativeSpawns.accepted === 0
                && staged.sourceRelativeSpawns.rejected === requestedSpawnCount
                && staged.sourceRelativeSpawns.reason === mode
                && !staged.requiresRecovery,
            `Target-entity ${mode} pressure/control 분리 실패: ${JSON.stringify(staged)}`
        );
        assert(
            simulation.fixedUpdate(fixedDelta, 1),
            `Target-entity ${mode} control-only fixed submit 실패`
        );
        await device.queue.onSubmittedWorkDone();
        const settledStatus = await waitForSimulationStatus(
            simulation,
            (status) => status.overflow.pendingReadbacks === 0,
            `Target-entity ${mode} telemetry completion`
        );
        const bodies = await simulation.readbackBodies();
        const sourceAfter = findPhase5Body(
            bodies,
            source,
            `target-entity ${mode} Tower after control`
        );
        assert(
            sourceAfter.position.x > source.position.x
                && settledStatus.pendingBodyCount === 0
                && !settledStatus.requiresAuthoritativeRebuild,
            `Target-entity ${mode} Tower progress/cleanup 불일치: ${JSON.stringify({ sourceAfter, settledStatus })}`
        );
        return Object.freeze({
            reason: staged.sourceRelativeSpawns.reason,
            requestedSpawnCount,
            controlAcceptedCount: staged.controls.accepted,
            spawnAcceptedCount: staged.sourceRelativeSpawns.accepted,
            spawnRejectedCount: staged.sourceRelativeSpawns.rejected,
            fixedSubmitContinued: true,
            towerPositionBefore: Object.freeze({ ...source.position }),
            towerPositionAfter: Object.freeze({ ...sourceAfter.position }),
            pendingBodyCount: settledStatus.pendingBodyCount,
            recoveryRequired: settledStatus.requiresAuthoritativeRebuild
        });
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionTargetEntitySpawnRingPressureHardwareSmoke(device) {
    const simulation = new GpuCircleBodySimulation(
        createPhase3PlatformPort(device),
        {
            capacity: 8,
            worldSize: { x: 8, y: 8 },
            gridCellSize: { x: 1, y: 1 },
            controlCommandCapacity: 1,
            spawnProgramCapacity: 1,
            sessionGeneration: 83
        }
    );
    const fixedDelta = 1 / 60;
    const source = Object.freeze({
        ...createGpuTowerSpawnIntent({ position: { x: 2, y: 2 } }),
        entityId: 9961,
        incarnation: 1
    });
    const target = Object.freeze({
        ...createGpuTowerSpawnIntent({ position: { x: 6, y: 2 } }),
        entityId: 9962,
        incarnation: 1
    });
    let acceptedSpawnCount = 0;
    let controlAcceptedCount = 0;

    try {
        assert(simulation.init(), 'Target-entity result-ring simulation init 실패');
        assert(
            simulation.spawnBodies([source, target]).accepted === 2,
            'Target-entity result-ring Tower source/target spawn 실패'
        );
        for (let tick = 1; tick <= 4; tick++) {
            const staged = simulation.stageFixedPrograms({
                targetFixedTick: tick,
                controls: [{
                    entityId: source.entityId,
                    incarnation: source.incarnation,
                    moveIntentX: 1,
                    moveIntentY: 0
                }],
                sourceRelativeSpawns: [createTargetEntityPressureSpawn(
                    source,
                    target,
                    { entityId: 9970 + tick, incarnation: 1 },
                    tick
                )]
            });
            assert(
                staged.controls.accepted === 1
                    && staged.sourceRelativeSpawns.accepted === 1
                    && !staged.requiresRecovery,
                `Target-entity result-ring prefill 실패: tick=${tick}, result=${JSON.stringify(staged)}`
            );
            controlAcceptedCount += staged.controls.accepted;
            acceptedSpawnCount += staged.sourceRelativeSpawns.accepted;
            assert(
                simulation.fixedUpdate(fixedDelta, tick),
                `Target-entity result-ring prefill submit 실패: tick=${tick}`
            );
        }
        const rejectedStage = simulation.stageFixedPrograms({
            targetFixedTick: 5,
            controls: [{
                entityId: source.entityId,
                incarnation: source.incarnation,
                moveIntentX: 1,
                moveIntentY: 0
            }],
            sourceRelativeSpawns: [createTargetEntityPressureSpawn(
                source,
                target,
                { entityId: 9975, incarnation: 1 },
                5
            )]
        });
        assert(
            rejectedStage.controls.accepted === 1
                && rejectedStage.controls.rejected === 0
                && rejectedStage.sourceRelativeSpawns.accepted === 0
                && rejectedStage.sourceRelativeSpawns.rejected === 1
                && rejectedStage.sourceRelativeSpawns.reason
                    === 'spawn-program-readback-capacity'
                && !rejectedStage.requiresRecovery,
            `Target-entity result-ring pressure/control 분리 실패: ${JSON.stringify(rejectedStage)}`
        );
        controlAcceptedCount += rejectedStage.controls.accepted;
        assert(
            simulation.fixedUpdate(fixedDelta, 5),
            'Target-entity result-ring control-only submit 실패'
        );
        await device.queue.onSubmittedWorkDone();
        await waitForSimulationStatus(
            simulation,
            (status) => status.overflow.pendingReadbacks === 0
                && status.fixedPrimitives.spawnProgram.pendingReadbacks === 0,
            'Target-entity result-ring completion'
        );
        const completedBatches = simulation.drainCompletedSpawnProgramBatches([]);
        const finalStatus = simulation.getStatus();
        const bodies = await simulation.readbackBodies();
        const sourceAfter = findPhase5Body(
            bodies,
            source,
            'target-entity result-ring Tower after control'
        );
        assert(
            completedBatches.length === 4
                && completedBatches.every((batch) => (
                    batch.failure === null
                        && batch.outcomes.length === 1
                        && batch.outcomes[0].reason === 'resolved'
                ))
                && sourceAfter.position.x > source.position.x
                && finalStatus.submittedTickCount === 5
                && finalStatus.pendingBodyCount === 0
                && finalStatus.fixedPrimitives.spawnProgram.backpressureCount >= 1
                && !finalStatus.requiresAuthoritativeRebuild,
            `Target-entity result-ring completion/cleanup 불일치: ${JSON.stringify({ completedBatches, finalStatus, sourceAfter })}`
        );
        return Object.freeze({
            ringSlotCount: finalStatus.fixedPrimitives.spawnProgram.ringSlotCount,
            acceptedSpawnCount,
            rejectedSpawnCount: rejectedStage.sourceRelativeSpawns.rejected,
            rejectionReason: rejectedStage.sourceRelativeSpawns.reason,
            controlAcceptedCount,
            submittedTickCount: finalStatus.submittedTickCount,
            completedBatchCount: completedBatches.length,
            towerPositionBefore: Object.freeze({ ...source.position }),
            towerPositionAfter: Object.freeze({ ...sourceAfter.position }),
            pendingBodyCount: finalStatus.pendingBodyCount,
            recoveryRequired: finalStatus.requiresAuthoritativeRebuild
        });
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionPhase5SinglePressureHardwareSmoke(device, mode) {
    const isBodyCapacity = mode === 'body-capacity';
    const simulation = new GpuCircleBodySimulation(
        createPhase3PlatformPort(device),
        {
            capacity: isBodyCapacity ? 2 : 5,
            worldSize: { x: 8, y: 8 },
            gridCellSize: { x: 1, y: 1 },
            controlCommandCapacity: 2,
            spawnProgramCapacity: isBodyCapacity ? 2 : 1
        }
    );
    const fixedDelta = 1 / 60;
    const source = createPhase3Body({
        entityId: isBodyCapacity ? 9601 : 9611,
        incarnation: 1,
        definitionId: `phase5_${mode}_source`,
        position: { x: 2, y: 2 }
    });
    const initialBodies = [source];
    if (isBodyCapacity) {
        initialBodies.push(createPhase3Body({
            entityId: 9602,
            incarnation: 1,
            definitionId: 'phase5_body_capacity_filler',
            position: { x: 4, y: 4 }
        }));
    }
    const requestedSpawnCount = isBodyCapacity ? 1 : 2;
    const pressureSpawns = Array.from({ length: requestedSpawnCount }, (_, index) => (
        createPhase5PressureSpawn(
            source,
            { entityId: 9701 + index, incarnation: 1 },
            index
        )
    ));
    try {
        assert(simulation.init(), `Phase 5 ${mode} simulation init 실패`);
        assert(simulation.spawnBodies(initialBodies).accepted === initialBodies.length,
            `Phase 5 ${mode} initial spawn 실패`);
        const staged = simulation.stageFixedPrograms({
            targetFixedTick: 1,
            controls: [{
                ...source,
                moveIntentX: 1,
                moveIntentY: 0
            }],
            sourceRelativeSpawns: pressureSpawns
        });
        assert(
            staged.controls.accepted === 1
                && staged.controls.rejected === 0
                && staged.sourceRelativeSpawns.accepted === 0
                && staged.sourceRelativeSpawns.rejected === requestedSpawnCount
                && staged.sourceRelativeSpawns.reason === mode
                && !staged.requiresRecovery,
            `Phase 5 ${mode} domain 분리 실패: ${JSON.stringify(staged)}`
        );
        assert(simulation.fixedUpdate(fixedDelta, 1),
            `Phase 5 ${mode} control-only fixed submit 실패`);
        await device.queue.onSubmittedWorkDone();
        const completedStatus = await waitForSimulationStatus(
            simulation,
            (status) => status.overflow.pendingReadbacks === 0,
            `Phase 5 ${mode} telemetry completion`
        );
        const bodies = await simulation.readbackBodies();
        const sourceAfter = findPhase5Body(bodies, source, `${mode} source after control`);
        assert(
            sourceAfter.position.x > source.position.x
                && completedStatus.state === 'ready'
                && !completedStatus.requiresAuthoritativeRebuild
                && completedStatus.pendingBodyCount === 0,
            `Phase 5 ${mode} control 진행/cleanup 불일치: ${JSON.stringify({ sourceAfter, completedStatus })}`
        );
        return {
            reason: staged.sourceRelativeSpawns.reason,
            requestedSpawnCount,
            controlAcceptedCount: staged.controls.accepted,
            spawnAcceptedCount: staged.sourceRelativeSpawns.accepted,
            spawnRejectedCount: staged.sourceRelativeSpawns.rejected,
            fixedSubmitContinued: true,
            sourcePositionBefore: { ...source.position },
            sourcePositionAfter: { ...sourceAfter.position },
            pendingBodyCount: completedStatus.pendingBodyCount,
            recoveryRequired: completedStatus.requiresAuthoritativeRebuild
        };
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionPhase5SpawnRingPressureHardwareSmoke(device) {
    const simulation = new GpuCircleBodySimulation(
        createPhase3PlatformPort(device),
        {
            capacity: 8,
            worldSize: { x: 8, y: 8 },
            gridCellSize: { x: 1, y: 1 },
            controlCommandCapacity: 1,
            spawnProgramCapacity: 1
        }
    );
    const fixedDelta = 1 / 60;
    const source = createPhase3Body({
        entityId: 9621,
        incarnation: 1,
        definitionId: 'phase5_spawn_ring_source',
        position: { x: 2, y: 2 }
    });
    const acceptedStages = [];
    try {
        assert(simulation.init(), 'Phase 5 spawn ring simulation init 실패');
        assert(simulation.spawnBodies([source]).accepted === 1,
            'Phase 5 spawn ring source spawn 실패');
        for (let tick = 1; tick <= 4; tick++) {
            const staged = simulation.stageFixedPrograms({
                targetFixedTick: tick,
                controls: [{ ...source, moveIntentX: 1, moveIntentY: 0 }],
                sourceRelativeSpawns: [createPhase5PressureSpawn(
                    source,
                    { entityId: 9720 + tick, incarnation: 1 },
                    tick
                )]
            });
            assert(
                staged.controls.accepted === 1
                    && staged.sourceRelativeSpawns.accepted === 1
                    && !staged.requiresRecovery,
                `Phase 5 spawn ring prefill stage 실패: tick=${tick}, result=${JSON.stringify(staged)}`
            );
            acceptedStages.push(staged);
            assert(simulation.fixedUpdate(fixedDelta, tick),
                `Phase 5 spawn ring prefill submit 실패: tick=${tick}`);
        }

        const rejectedStage = simulation.stageFixedPrograms({
            targetFixedTick: 5,
            controls: [{ ...source, moveIntentX: 1, moveIntentY: 0 }],
            sourceRelativeSpawns: [createPhase5PressureSpawn(
                source,
                { entityId: 9725, incarnation: 1 },
                5
            )]
        });
        assert(
            rejectedStage.controls.accepted === 1
                && rejectedStage.controls.rejected === 0
                && rejectedStage.sourceRelativeSpawns.accepted === 0
                && rejectedStage.sourceRelativeSpawns.rejected === 1
                && rejectedStage.sourceRelativeSpawns.reason
                    === 'spawn-program-readback-capacity'
                && !rejectedStage.requiresRecovery,
            `Phase 5 actual SpawnProgram ring pressure domain 분리 실패: ${JSON.stringify(rejectedStage)}`
        );
        assert(simulation.fixedUpdate(fixedDelta, 5),
            'Phase 5 spawn ring pressure control-only submit 실패');
        await device.queue.onSubmittedWorkDone();
        const settledStatus = await waitForSimulationStatus(
            simulation,
            (status) => status.overflow.pendingReadbacks === 0
                && status.fixedPrimitives.spawnProgram.pendingReadbacks === 0,
            'Phase 5 SpawnProgram ring completion'
        );
        const completedBatches = simulation.drainCompletedSpawnProgramBatches([]);
        assert(
            completedBatches.length === 4
                && completedBatches.every((batch) => (
                    batch.failure === null
                        && batch.outcomes.length === 1
                        && batch.outcomes[0].reason === 'resolved'
                )),
            `Phase 5 SpawnProgram ring accepted batch completion 불일치: ${JSON.stringify(completedBatches)}`
        );
        const cleanedStatus = simulation.getStatus();
        const bodies = await simulation.readbackBodies();
        const sourceAfter = findPhase5Body(bodies, source, 'spawn ring source after control');
        assert(
            sourceAfter.position.x > source.position.x
                && cleanedStatus.state === 'ready'
                && cleanedStatus.submittedTickCount === 5
                && cleanedStatus.pendingBodyCount === 0
                && cleanedStatus.fixedPrimitives.spawnProgram.backpressureCount >= 1
                && !cleanedStatus.requiresAuthoritativeRebuild,
            `Phase 5 SpawnProgram ring cleanup/recovery 불일치: ${JSON.stringify(cleanedStatus)}`
        );
        return {
            ringSlotCount: cleanedStatus.fixedPrimitives.spawnProgram.ringSlotCount,
            acceptedSpawnCount: acceptedStages.length,
            rejectedSpawnCount: rejectedStage.sourceRelativeSpawns.rejected,
            rejectionReason: rejectedStage.sourceRelativeSpawns.reason,
            controlAcceptedCount: acceptedStages.length
                + rejectedStage.controls.accepted,
            submittedTickCount: cleanedStatus.submittedTickCount,
            backpressureCount:
                cleanedStatus.fixedPrimitives.spawnProgram.backpressureCount,
            sourcePositionBefore: { ...source.position },
            sourcePositionAfter: { ...sourceAfter.position },
            completedBatchCount: completedBatches.length,
            pendingBodyCount: cleanedStatus.pendingBodyCount,
            recoveryRequired: cleanedStatus.requiresAuthoritativeRebuild
        };
    } finally {
        simulation.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionPhase5RegistryPressureHardwareSmoke(device) {
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPhase3PlatformPort(device)
    }, {
        capacity: 1,
        controlCommandCapacity: 1,
        sourceRelativeSpawnCommandCapacity: 2,
        spawnProgramCapacity: 1
    });
    const navigationSource = createPhase5ProjectileNavigationSource();
    const adapter = new GpuProjectileSpawnAdapter(endpoint, {
        commandNamespace: 'nw-phase5-registry-pressure'
    });
    const fixedDelta = 1 / 60;
    const towerPosition = Object.freeze({ x: 2, y: 2 });
    try {
        assert(endpoint.init(navigationSource) === false,
            'Phase 5 registry pressure endpoint는 deferred여야 합니다.');
        assert(endpoint.requestSpawn(
            createGpuTowerSpawnIntent({ position: towerPosition }),
            1,
            'phase5:registry-pressure:tower'
        ).accepted, 'Phase 5 registry pressure Tower request 실패');
        const towerCommit = endpoint.commitAtFixedBoundary(1);
        const towerHandle = towerCommit.spawned[0]?.handle;
        assert(towerHandle, 'Phase 5 registry pressure Tower handle 누락');
        assert(endpoint.fixedUpdate(fixedDelta, 1),
            'Phase 5 registry pressure initial submit 실패');
        await settlePhase5Endpoint(endpoint, 'Phase 5 registry pressure initial completion');
        endpoint.commitCompletedEventsAtFixedBoundary(2);

        const shotRequest = adapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
            definition: BASIC_BULLET_PROJECTILE_DATA,
            sourceHandle: towerHandle,
            positionOffset: { x: 0.6, y: 0 },
            aimWorldPoint: { x: 8, y: 2 },
            launchSpeed: BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
            producerId: BASIC_BULLET_PRODUCER_ID,
            targetFixedTick: 2,
            spawnSequence: 0,
            commandId: 'phase5:registry-pressure:shot'
        });
        const controlRequest = endpoint.requestBodyControl({
            handle: towerHandle,
            moveIntentX: 1,
            moveIntentY: 0
        }, 2, 'phase5:registry-pressure:control');
        assert(shotRequest.accepted && controlRequest.accepted,
            'Phase 5 registry pressure request enqueue 실패');
        const commit = endpoint.commitAtFixedBoundary(2);
        const spawnRejection = commit.fixedCommands.rejected.find(
            ({ domain }) => domain === 'spawn'
        );
        assert(
            commit.state === 'committed-with-rejections'
                && commit.fixedCommands.controls.length === 1
                && commit.fixedCommands.sourceRelativeSpawns.length === 0
                && spawnRejection?.code === 'registry-capacity'
                && !commit.recoveryRequired,
            `Phase 5 registry pressure domain 분리 실패: ${JSON.stringify(commit)}`
        );
        assert(endpoint.fixedUpdate(fixedDelta, 2),
            'Phase 5 registry pressure control submit 실패');
        await settlePhase5Endpoint(endpoint, 'Phase 5 registry pressure completion');
        const bodies = await readPhase5Bodies(endpoint);
        const towerAfter = findPhase5Body(bodies, towerHandle,
            'registry pressure Tower after control');
        const status = endpoint.getStatus();
        const gpuStatus = endpoint.getBackend().simulation.getStatus();
        assert(
            towerAfter.position.x > towerPosition.x
                && status.activeCount === 1
                && status.reservedCount === 0
                && status.pendingCommandCount === 0
                && gpuStatus.pendingBodyCount === 0
                && !status.recoveryRequired,
            `Phase 5 registry pressure cleanup/recovery 불일치: ${JSON.stringify({ status, gpuStatus })}`
        );
        return {
            rejectionReason: spawnRejection.code,
            controlAcceptedCount: commit.fixedCommands.controls.length,
            spawnRejectedCount: commit.fixedCommands.rejected.filter(
                ({ domain }) => domain === 'spawn'
            ).length,
            fixedSubmitContinued: true,
            towerPositionBefore: towerPosition,
            towerPositionAfter: { ...towerAfter.position },
            activeCount: status.activeCount,
            reservedCount: status.reservedCount,
            pendingCommandCount: status.pendingCommandCount,
            pendingBodyCount: gpuStatus.pendingBodyCount,
            recoveryRequired: status.recoveryRequired
        };
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionPhase5FailureDomainHardwareSmoke(device) {
    const spawnProgramCapacity = await runProductionPhase5SinglePressureHardwareSmoke(
        device,
        'spawn-program-capacity'
    );
    const bodyCapacity = await runProductionPhase5SinglePressureHardwareSmoke(
        device,
        'body-capacity'
    );
    const resultRing = await runProductionPhase5SpawnRingPressureHardwareSmoke(device);
    const registryCapacity = await runProductionPhase5RegistryPressureHardwareSmoke(device);
    return {
        spawnProgramCapacity,
        bodyCapacity,
        resultRing,
        registryCapacity,
        totalSpawnRejectedCount: spawnProgramCapacity.spawnRejectedCount
            + bodyCapacity.spawnRejectedCount
            + resultRing.rejectedSpawnCount
            + registryCapacity.spawnRejectedCount,
        totalControlAcceptedCount: spawnProgramCapacity.controlAcceptedCount
            + bodyCapacity.controlAcceptedCount
            + resultRing.controlAcceptedCount
            + registryCapacity.controlAcceptedCount,
        allFixedSubmitsContinued: true,
        allRecoveryFalse: [
            spawnProgramCapacity,
            bodyCapacity,
            resultRing,
            registryCapacity
        ].every(({ recoveryRequired }) => recoveryRequired === false),
        allReservationAndPendingLeaksZero:
            registryCapacity.reservedCount === 0
            && registryCapacity.pendingCommandCount === 0
            && registryCapacity.pendingBodyCount === 0
            && spawnProgramCapacity.pendingBodyCount === 0
            && bodyCapacity.pendingBodyCount === 0
            && resultRing.pendingBodyCount === 0
    };
}

async function runProductionTargetEntityRegistryPressureHardwareSmoke(device) {
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPhase3PlatformPort(device)
    }, {
        capacity: 2,
        controlCommandCapacity: 1,
        sourceRelativeSpawnCommandCapacity: 1,
        spawnProgramCapacity: 1
    });
    const navigationSource = createPhase5ProjectileNavigationSource();
    const adapter = new GpuProjectileSpawnAdapter(endpoint, {
        commandNamespace: 'nw-target-entity-registry-pressure'
    });
    const fixedDelta = 1 / 60;
    const sourcePosition = Object.freeze({ x: 2, y: 2 });
    const targetPosition = Object.freeze({ x: 6, y: 2 });

    try {
        assert(
            endpoint.init(navigationSource) === false,
            'Target-entity registry pressure endpoint는 deferred여야 합니다.'
        );
        const spawnRequests = [
            endpoint.requestSpawn(
                createGpuTowerSpawnIntent({ position: sourcePosition }),
                1,
                'target-entity:registry:source'
            ),
            endpoint.requestSpawn(
                createGpuTowerSpawnIntent({ position: targetPosition }),
                1,
                'target-entity:registry:target'
            )
        ];
        assert(
            spawnRequests.every(({ accepted }) => accepted),
            `Target-entity registry source/target request 실패: ${JSON.stringify(spawnRequests)}`
        );
        const spawnCommit = endpoint.commitAtFixedBoundary(1);
        const handles = new Map(
            spawnCommit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        const sourceHandle = handles.get('target-entity:registry:source');
        const targetHandle = handles.get('target-entity:registry:target');
        assert(
            sourceHandle && targetHandle && spawnCommit.spawned.length === 2,
            `Target-entity registry handles 누락: ${JSON.stringify(spawnCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, 1),
            'Target-entity registry initial fixed submit 실패'
        );
        await settlePhase5Endpoint(endpoint, 'Target-entity registry initial completion');
        endpoint.commitCompletedEventsAtFixedBoundary(2);

        const shotRequest = adapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
            definition: createTargetEntityHardwareProjectileDefinition(
                'nw_target_entity_registry_pressure'
            ),
            sourceHandle,
            targetHandle,
            positionOffset: { x: 0.6, y: 0 },
            targetOffset: { x: 0, y: 0 },
            launchSpeed: 12,
            allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
            targetPolicyId:
                PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
            targetFixedTick: 2,
            spawnSequence: 0,
            commandId: 'target-entity:registry:shot'
        });
        const controlRequest = endpoint.requestBodyControl({
            handle: sourceHandle,
            moveIntentX: 1,
            moveIntentY: 0
        }, 2, 'target-entity:registry:control');
        assert(
            shotRequest.accepted && controlRequest.accepted,
            `Target-entity registry shot/control enqueue 실패: ${JSON.stringify({ shotRequest, controlRequest })}`
        );
        const commit = endpoint.commitAtFixedBoundary(2);
        const spawnRejection = commit.fixedCommands.rejected.find(
            ({ domain }) => domain === 'spawn'
        );
        assert(
            commit.state === 'committed-with-rejections'
                && commit.fixedCommands.controls.length === 1
                && commit.fixedCommands.sourceRelativeSpawns.length === 0
                && spawnRejection?.code === 'registry-capacity'
                && !commit.recoveryRequired,
            `Target-entity registry pressure/control 분리 실패: ${JSON.stringify(commit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, 2),
            'Target-entity registry pressure control submit 실패'
        );
        await settlePhase5Endpoint(endpoint, 'Target-entity registry completion');
        const bodies = await readPhase5Bodies(endpoint);
        const sourceAfter = findPhase5Body(
            bodies,
            sourceHandle,
            'target-entity registry Tower after control'
        );
        const status = endpoint.getStatus();
        const gpuStatus = endpoint.getBackend().simulation.getStatus();
        assert(
            sourceAfter.position.x > sourcePosition.x
                && status.activeCount === 2
                && status.reservedCount === 0
                && status.pendingCommandCount === 0
                && gpuStatus.pendingBodyCount === 0
                && !status.recoveryRequired,
            `Target-entity registry cleanup/recovery 불일치: ${JSON.stringify({ sourceAfter, status, gpuStatus })}`
        );
        return Object.freeze({
            rejectionReason: spawnRejection.code,
            controlAcceptedCount: commit.fixedCommands.controls.length,
            spawnRejectedCount: commit.fixedCommands.rejected.filter(
                ({ domain }) => domain === 'spawn'
            ).length,
            fixedSubmitContinued: true,
            towerPositionBefore: sourcePosition,
            towerPositionAfter: Object.freeze({ ...sourceAfter.position }),
            activeCount: status.activeCount,
            reservedCount: status.reservedCount,
            pendingCommandCount: status.pendingCommandCount,
            pendingBodyCount: gpuStatus.pendingBodyCount,
            recoveryRequired: status.recoveryRequired
        });
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionTargetEntityStaleTargetHardwareSmoke(device) {
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPhase3PlatformPort(device)
    }, {
        capacity: 3,
        controlCommandCapacity: 2,
        sourceRelativeSpawnCommandCapacity: 2,
        spawnProgramCapacity: 2
    });
    const navigationSource = createPhase5ProjectileNavigationSource();
    const adapter = new GpuProjectileSpawnAdapter(endpoint, {
        commandNamespace: 'nw-target-entity-stale-target'
    });
    const definition = createTargetEntityHardwareProjectileDefinition(
        'nw_target_entity_stale_target'
    );
    const fixedDelta = 1 / 60;
    const sourcePosition = Object.freeze({ x: 2, y: 2 });
    const targetPosition = Object.freeze({ x: 6, y: 2 });
    const makeRequest = (targetHandle, targetFixedTick, commandId, spawnSequence) => (
        adapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
            definition,
            sourceHandle,
            targetHandle,
            positionOffset: { x: 0.6, y: 0 },
            targetOffset: { x: 0, y: 0 },
            launchSpeed: 12,
            allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
            targetPolicyId:
                PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
            targetFixedTick,
            spawnSequence,
            commandId
        })
    );
    let sourceHandle = null;

    try {
        assert(
            endpoint.init(navigationSource) === false,
            'Target-entity stale-target endpoint는 deferred여야 합니다.'
        );
        const requests = [
            endpoint.requestSpawn(
                createGpuTowerSpawnIntent({ position: sourcePosition }),
                1,
                'target-entity:stale:source'
            ),
            endpoint.requestSpawn(
                createGpuTowerSpawnIntent({ position: targetPosition }),
                1,
                'target-entity:stale:target'
            )
        ];
        assert(
            requests.every(({ accepted }) => accepted),
            `Target-entity stale source/target request 실패: ${JSON.stringify(requests)}`
        );
        const spawnCommit = endpoint.commitAtFixedBoundary(1);
        const handles = new Map(
            spawnCommit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        sourceHandle = handles.get('target-entity:stale:source');
        const targetHandle = handles.get('target-entity:stale:target');
        assert(
            sourceHandle && targetHandle,
            `Target-entity stale exact handles 누락: ${JSON.stringify(spawnCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, 1),
            'Target-entity stale initial fixed submit 실패'
        );
        await settlePhase5Endpoint(endpoint, 'Target-entity stale initial completion');
        endpoint.commitCompletedEventsAtFixedBoundary(2);

        const staleHandle = Object.freeze({
            entityId: targetHandle.entityId,
            incarnation: targetHandle.incarnation + 1
        });
        const requestTimeReject = makeRequest(
            staleHandle,
            2,
            'target-entity:stale:request-time',
            0
        );
        const requestTimeControl = endpoint.requestBodyControl({
            handle: sourceHandle,
            moveIntentX: 1,
            moveIntentY: 0
        }, 2, 'target-entity:stale:request-control');
        assert(
            !requestTimeReject.accepted
                && requestTimeReject.reason === 'stale-target'
                && requestTimeControl.accepted,
            `Target-entity request-time stale/control 불일치: ${JSON.stringify({ requestTimeReject, requestTimeControl })}`
        );
        const requestTimeCommit = endpoint.commitAtFixedBoundary(2);
        assert(
            requestTimeCommit.fixedCommands.controls.length === 1
                && requestTimeCommit.fixedCommands.sourceRelativeSpawns.length === 0
                && !requestTimeCommit.recoveryRequired,
            `Target-entity request-time stale commit 불일치: ${JSON.stringify(requestTimeCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, 2),
            'Target-entity request-time stale control submit 실패'
        );
        await settlePhase5Endpoint(endpoint, 'Target-entity request-time stale completion');
        endpoint.commitCompletedEventsAtFixedBoundary(3);

        const commitTimeRequest = makeRequest(
            targetHandle,
            3,
            'target-entity:stale:commit-time',
            1
        );
        const commitTimeControl = endpoint.requestBodyControl({
            handle: sourceHandle,
            moveIntentX: 1,
            moveIntentY: 0
        }, 3, 'target-entity:stale:commit-control');
        const targetDespawnRequest = endpoint.requestDespawn(
            targetHandle,
            'target-entity-stale-race',
            3,
            'target-entity:stale:target-despawn'
        );
        assert(
            commitTimeRequest.accepted
                && commitTimeControl.accepted
                && targetDespawnRequest.accepted,
            `Target-entity commit-time stale setup 실패: ${JSON.stringify({ commitTimeRequest, commitTimeControl, targetDespawnRequest })}`
        );
        const commitTimeCommit = endpoint.commitAtFixedBoundary(3);
        const staleRejection = commitTimeCommit.fixedCommands.rejected.find(
            ({ domain, code }) => domain === 'spawn' && code === 'stale-target'
        );
        assert(
            commitTimeCommit.despawned.length === 1
                && commitTimeCommit.fixedCommands.controls.length === 1
                && commitTimeCommit.fixedCommands.sourceRelativeSpawns.length === 0
                && staleRejection
                && !commitTimeCommit.recoveryRequired,
            `Target-entity commit-time stale/control 분리 실패: ${JSON.stringify(commitTimeCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, 3),
            'Target-entity commit-time stale control submit 실패'
        );
        await settlePhase5Endpoint(endpoint, 'Target-entity commit-time stale completion');
        const bodies = await readPhase5Bodies(endpoint);
        const sourceAfter = findPhase5Body(
            bodies,
            sourceHandle,
            'target-entity stale Tower after controls'
        );
        const status = endpoint.getStatus();
        const gpuStatus = endpoint.getBackend().simulation.getStatus();
        assert(
            sourceAfter.position.x > sourcePosition.x
                && !endpoint.getRegistry().has(targetHandle)
                && !endpoint.hasBody(targetHandle)
                && status.activeCount === 1
                && status.reservedCount === 0
                && status.pendingCommandCount === 0
                && gpuStatus.pendingBodyCount === 0
                && !status.recoveryRequired,
            `Target-entity stale cleanup/recovery 불일치: ${JSON.stringify({ sourceAfter, status, gpuStatus })}`
        );
        return Object.freeze({
            requestTime: Object.freeze({
                reason: requestTimeReject.reason,
                controlAcceptedCount:
                    requestTimeCommit.fixedCommands.controls.length,
                fixedSubmitContinued: true
            }),
            commitTime: Object.freeze({
                reason: staleRejection.code,
                controlAcceptedCount:
                    commitTimeCommit.fixedCommands.controls.length,
                targetDespawnCount: commitTimeCommit.despawned.length,
                fixedSubmitContinued: true
            }),
            towerPositionBefore: sourcePosition,
            towerPositionAfter: Object.freeze({ ...sourceAfter.position }),
            activeCount: status.activeCount,
            reservedCount: status.reservedCount,
            pendingCommandCount: status.pendingCommandCount,
            pendingBodyCount: gpuStatus.pendingBodyCount,
            recoveryRequired: status.recoveryRequired
        });
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionTargetEntityFailureDomainHardwareSmoke(
    device,
    targetInvalidEvidence
) {
    const spawnProgramCapacity =
        await runProductionTargetEntitySinglePressureHardwareSmoke(
            device,
            'spawn-program-capacity'
        );
    const bodyCapacity =
        await runProductionTargetEntitySinglePressureHardwareSmoke(
            device,
            'body-capacity'
        );
    const resultRing =
        await runProductionTargetEntitySpawnRingPressureHardwareSmoke(device);
    const registryCapacity =
        await runProductionTargetEntityRegistryPressureHardwareSmoke(device);
    const staleTarget =
        await runProductionTargetEntityStaleTargetHardwareSmoke(device);
    const gpuTargetInvalid = targetInvalidEvidence.deathBeforeResolve;
    const cases = [
        spawnProgramCapacity,
        bodyCapacity,
        resultRing,
        registryCapacity,
        staleTarget,
        gpuTargetInvalid.cleanup
    ];
    assert(
        gpuTargetInvalid.towerControl.acceptedCount === 1
            && gpuTargetInvalid.fixedSubmitContinued
            && gpuTargetInvalid.cleanup.reservedCount === 0
            && gpuTargetInvalid.cleanup.pendingDestinationCount === 0
            && gpuTargetInvalid.cleanup.pendingBodyCount === 0
            && gpuTargetInvalid.cleanup.recoveryRequired === false
            && cases.every(({ recoveryRequired }) => recoveryRequired === false),
        `Target-entity failure domain recovery/control 불일치: ${JSON.stringify({ cases, gpuTargetInvalid })}`
    );
    return Object.freeze({
        spawnProgramCapacity,
        bodyCapacity,
        resultRing,
        registryCapacity,
        staleTarget,
        gpuTargetInvalid: Object.freeze({
            outcome: gpuTargetInvalid.completion.outcome,
            controlAcceptedCount: gpuTargetInvalid.towerControl.acceptedCount,
            fixedSubmitContinued: gpuTargetInvalid.fixedSubmitContinued,
            reservedCount: gpuTargetInvalid.cleanup.reservedCount,
            pendingDestinationCount:
                gpuTargetInvalid.cleanup.pendingDestinationCount,
            pendingBodyCount: gpuTargetInvalid.cleanup.pendingBodyCount,
            recoveryRequired: gpuTargetInvalid.cleanup.recoveryRequired
        }),
        allTowerControlsAccepted: true,
        allFixedSubmitsContinued: true,
        allRecoveryFalse: cases.every(
            ({ recoveryRequired }) => recoveryRequired === false
        ),
        allReservationAndPendingLeaksZero:
            spawnProgramCapacity.pendingBodyCount === 0
            && bodyCapacity.pendingBodyCount === 0
            && resultRing.pendingBodyCount === 0
            && registryCapacity.reservedCount === 0
            && registryCapacity.pendingCommandCount === 0
            && registryCapacity.pendingBodyCount === 0
            && staleTarget.reservedCount === 0
            && staleTarget.pendingCommandCount === 0
            && staleTarget.pendingBodyCount === 0
            && gpuTargetInvalid.cleanup.reservedCount === 0
            && gpuTargetInvalid.cleanup.pendingDestinationCount === 0
            && gpuTargetInvalid.cleanup.pendingBodyCount === 0
    });
}

async function runProductionPhase5GenerationRecoveryHardwareSmoke(device) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    const generation = { value: 1 };
    const platformPort = Object.freeze({
        getState: () => Object.freeze({ ready: true, status: 'ready' }),
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => generation.value,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    });
    const navigationSource = createPhase5ProjectileNavigationSource();
    const fixedDelta = 1 / 60;
    const coreIntegrity = { current: 100, max: 100 };
    const coreIntegrityIdentity = coreIntegrity;
    const heldInput = { primaryPressed: true };
    const oldEndpoint = createGpuSimulationEndpoint({ webGpuPlatformPort: platformPort }, {
        capacity: 4,
        controlCommandCapacity: 2,
        sourceRelativeSpawnCommandCapacity: 2,
        spawnProgramCapacity: 2
    });
    const oldAdapter = new GpuProjectileSpawnAdapter(oldEndpoint, {
        commandNamespace: 'nw-phase5-old-generation'
    });
    let oldEndpointDestroyed = false;
    let replacementEndpoint = null;
    try {
        assert(oldEndpoint.init(navigationSource) === false,
            'Phase 5 old generation endpoint는 deferred여야 합니다.');
        assert(oldEndpoint.requestSpawn(
            createGpuTowerSpawnIntent({ position: { x: 2, y: 2 } }),
            1,
            'phase5:generation:old-tower'
        ).accepted, 'Phase 5 old Tower spawn request 실패');
        const oldTowerCommit = oldEndpoint.commitAtFixedBoundary(1);
        const oldTowerHandle = oldTowerCommit.spawned[0]?.handle;
        assert(oldTowerHandle, 'Phase 5 old Tower handle 누락');
        assert(oldEndpoint.fixedUpdate(fixedDelta, 1),
            'Phase 5 old Tower initial submit 실패');
        await settlePhase5Endpoint(oldEndpoint, 'Phase 5 old Tower completion');
        oldEndpoint.commitCompletedEventsAtFixedBoundary(2);

        assert(heldInput.primaryPressed, 'Phase 5 held input fixture가 release되었습니다.');
        const oldShotRequest = oldAdapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
            definition: BASIC_BULLET_PROJECTILE_DATA,
            sourceHandle: oldTowerHandle,
            positionOffset: { x: 0.6, y: 0 },
            aimWorldPoint: { x: 8, y: 2 },
            launchSpeed: BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
            producerId: BASIC_BULLET_PRODUCER_ID,
            targetFixedTick: 2,
            spawnSequence: 0,
            commandId: 'phase5:generation:old-shot'
        });
        const oldControlRequest = oldEndpoint.requestBodyControl({
            handle: oldTowerHandle,
            moveIntentX: 0,
            moveIntentY: 0
        }, 2, 'phase5:generation:old-control');
        assert(oldShotRequest.accepted && oldControlRequest.accepted,
            'Phase 5 old generation shot/control request 실패');
        const oldShotCommit = oldEndpoint.commitAtFixedBoundary(2);
        const oldBulletHandle = oldShotCommit.fixedCommands
            .sourceRelativeSpawns[0]?.handle;
        assert(oldBulletHandle, `Phase 5 old generation bullet handle 누락: ${JSON.stringify(oldShotCommit)}`);
        assert(oldEndpoint.fixedUpdate(fixedDelta, 2),
            'Phase 5 old generation shot submit 실패');
        const oldSimulation = oldEndpoint.getBackend().simulation;
        const oldRegistry = oldEndpoint.getRegistry();
        const beforeGenerationRetire = oldSimulation.getStatus();
        const oldEndpointBeforeRetire = oldEndpoint.getStatus();
        assert(
            beforeGenerationRetire.fixedPrimitives.spawnProgram.pendingReadbacks === 1
                && beforeGenerationRetire.pendingBodyCount === 1
                && oldEndpointBeforeRetire.reservedCount === 1
                && oldEndpointBeforeRetire.pendingSourceRelativeDestinationCount === 1,
            `Phase 5 old generation in-flight envelope가 없습니다: ${JSON.stringify({ beforeGenerationRetire, oldEndpointBeforeRetire })}`
        );

        generation.value = 2;
        assert(
            oldSimulation.init() === false,
            'Phase 5 generation change가 GPU-authoritative old session을 차단하지 않았습니다.'
        );
        await device.queue.onSubmittedWorkDone();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const afterGenerationRetire = oldSimulation.getStatus();
        const staleCompletions = oldSimulation.drainCompletedSpawnProgramBatches([]);
        assert(
            afterGenerationRetire.state === 'requires-rebuild'
                && afterGenerationRetire.failure?.stage === 'device-generation-change'
                && afterGenerationRetire.fixedPrimitives.spawnProgram.pendingReadbacks === 0
                && afterGenerationRetire.fixedPrimitives.spawnProgram.queuedBatches === 0
                && staleCompletions.length === 0
                && !oldRegistry.has(oldBulletHandle)
                && oldRegistry.copyEntityView(oldBulletHandle, {}) === null,
            `Phase 5 old SpawnProgram generation envelope drop 실패: ${JSON.stringify({ afterGenerationRetire, staleCompletions })}`
        );
        const oldSessionGeneration = oldEndpointBeforeRetire.sessionGeneration;
        oldEndpoint.destroy();
        oldEndpointDestroyed = true;
        const oldRegistryAfterDestroy = oldRegistry.getStatus();
        assert(
            oldRegistryAfterDestroy.activeCount === 0
                && oldRegistryAfterDestroy.reservedCount === 0,
            `Phase 5 old endpoint destroy가 pending reservation을 정리하지 않았습니다: ${JSON.stringify(oldRegistryAfterDestroy)}`
        );

        replacementEndpoint = createGpuSimulationEndpoint({ webGpuPlatformPort: platformPort }, {
            capacity: 5,
            controlCommandCapacity: 2,
            sourceRelativeSpawnCommandCapacity: 2,
            spawnProgramCapacity: 2
        });
        const replacementAdapter = new GpuProjectileSpawnAdapter(replacementEndpoint, {
            commandNamespace: 'nw-phase5-new-generation'
        });
        assert(replacementEndpoint.init(navigationSource) === false,
            'Phase 5 replacement endpoint는 deferred여야 합니다.');
        assert(replacementEndpoint.requestSpawn(
            createGpuCoreProxySpawnIntent({ position: navigationSource.corePosition }),
            3,
            'phase5:generation:new-core'
        ).accepted, 'Phase 5 replacement Core proxy request 실패');
        assert(replacementEndpoint.requestSpawn(
            createGpuTowerSpawnIntent({ position: { x: 2, y: 2 } }),
            3,
            'phase5:generation:new-tower'
        ).accepted, 'Phase 5 replacement Tower request 실패');
        const replacementActorCommit = replacementEndpoint.commitAtFixedBoundary(3);
        const replacementHandles = new Map(
            replacementActorCommit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        const newCoreHandle = replacementHandles.get('phase5:generation:new-core');
        const newTowerHandle = replacementHandles.get('phase5:generation:new-tower');
        assert(
            newCoreHandle && newTowerHandle
                && (newTowerHandle.entityId !== oldTowerHandle.entityId
                    || newTowerHandle.incarnation !== oldTowerHandle.incarnation),
            `Phase 5 replacement source handle이 old source와 구분되지 않습니다: ${JSON.stringify({ oldTowerHandle, newTowerHandle })}`
        );
        assert(replacementEndpoint.fixedUpdate(fixedDelta, 3),
            'Phase 5 replacement actor submit 실패');
        await settlePhase5Endpoint(replacementEndpoint,
            'Phase 5 replacement actor completion');
        replacementEndpoint.commitCompletedEventsAtFixedBoundary(4);

        assert(heldInput.primaryPressed,
            'Phase 5 held input이 endpoint replacement 중 보존되지 않았습니다.');
        const newShotRequest = replacementAdapter.requestProjectile({
            mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
            definition: BASIC_BULLET_PROJECTILE_DATA,
            sourceHandle: newTowerHandle,
            positionOffset: { x: 0.6, y: 0 },
            aimWorldPoint: { x: 8, y: 2 },
            launchSpeed: BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
            producerId: BASIC_BULLET_PRODUCER_ID,
            targetFixedTick: 4,
            spawnSequence: 0,
            commandId: 'phase5:generation:new-held-shot'
        });
        const newControlRequest = replacementEndpoint.requestBodyControl({
            handle: newTowerHandle,
            moveIntentX: 0,
            moveIntentY: 0
        }, 4, 'phase5:generation:new-control');
        assert(newShotRequest.accepted && newControlRequest.accepted,
            'Phase 5 replacement held shot/control request 실패');
        const newShotCommit = replacementEndpoint.commitAtFixedBoundary(4);
        const newBulletHandle = newShotCommit.fixedCommands
            .sourceRelativeSpawns[0]?.handle;
        assert(newBulletHandle, `Phase 5 replacement held shot commit 실패: ${JSON.stringify(newShotCommit)}`);
        assert(replacementEndpoint.fixedUpdate(fixedDelta, 4),
            'Phase 5 replacement held shot submit 실패');
        await settlePhase5Endpoint(
            replacementEndpoint,
            'Phase 5 replacement held shot completion',
            { spawnProgram: true }
        );
        replacementEndpoint.commitCompletedEventsAtFixedBoundary(5);
        const newBulletView = replacementEndpoint.getRegistry()
            .copyEntityView(newBulletHandle, {});
        const replacementStatus = replacementEndpoint.getStatus();
        assert(
            newBulletView?.metadata?.sourceEntityId === newTowerHandle.entityId
                && newBulletView.metadata.sourceIncarnation
                    === newTowerHandle.incarnation
                && replacementStatus.sessionGeneration !== oldSessionGeneration
                && replacementStatus.activeProjectileCount === 1
                && replacementStatus.reservedCount === 0
                && replacementStatus.pendingCommandCount === 0
                && !replacementStatus.recoveryRequired
                && coreIntegrity === coreIntegrityIdentity
                && coreIntegrity.current === 100
                && coreIntegrity.max === 100,
            `Phase 5 replacement held fire/CoreIntegrity 보존 실패: ${JSON.stringify({ newBulletView, replacementStatus, coreIntegrity })}`
        );
        return {
            generationBefore: 1,
            generationAfter: generation.value,
            oldSessionGeneration,
            newSessionGeneration: replacementStatus.sessionGeneration,
            oldSourceHandle: oldTowerHandle,
            oldPendingBulletHandle: oldBulletHandle,
            oldEnvelopeBeforeRetire: {
                pendingReadbacks: beforeGenerationRetire.fixedPrimitives
                    .spawnProgram.pendingReadbacks,
                queuedBatches: beforeGenerationRetire.fixedPrimitives
                    .spawnProgram.queuedBatches,
                pendingBodyCount: beforeGenerationRetire.pendingBodyCount,
                reservedCount: oldEndpointBeforeRetire.reservedCount
            },
            oldEnvelopeAfterRetire: {
                state: afterGenerationRetire.state,
                failureStage: afterGenerationRetire.failure.stage,
                pendingReadbacks: afterGenerationRetire.fixedPrimitives
                    .spawnProgram.pendingReadbacks,
                queuedBatches: afterGenerationRetire.fixedPrimitives
                    .spawnProgram.queuedBatches,
                completedBatchCount: staleCompletions.length,
                reservedCountAfterDestroy: oldRegistryAfterDestroy.reservedCount
            },
            newSourceHandle: newTowerHandle,
            newCoreHandle,
            newBulletHandle,
            heldInputPreserved: heldInput.primaryPressed,
            newProjectileSourceMetadata: newBulletView.metadata,
            coreIntegrityIdentityPreserved: coreIntegrity === coreIntegrityIdentity,
            coreIntegrityCurrent: coreIntegrity.current,
            coreIntegrityMax: coreIntegrity.max,
            replacement: {
                activeCount: replacementStatus.activeCount,
                activeProjectileCount: replacementStatus.activeProjectileCount,
                reservedCount: replacementStatus.reservedCount,
                pendingCommandCount: replacementStatus.pendingCommandCount,
                recoveryRequired: replacementStatus.recoveryRequired
            }
        };
    } finally {
        if (!oldEndpointDestroyed) {
            oldEndpoint.destroy();
        }
        replacementEndpoint?.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

function hostileAttackLifecycleHandleMatches(value, handle) {
    const candidate = value?.handle ?? value;
    return candidate?.entityId === handle.entityId
        && candidate?.incarnation === handle.incarnation;
}

function hostileAttackLifecycleHandleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function hostileAttackLifecyclePairMatches(event, sourceHandle, targetHandle) {
    return event?.entityId === sourceHandle.entityId
        && event?.incarnation === sourceHandle.incarnation
        && event?.otherEntityId === targetHandle.entityId
        && event?.otherIncarnation === targetHandle.incarnation;
}

function readHostileAttackLifecycleProtocol(endpoint) {
    const endpointStatus = endpoint.getStatus();
    const protocol = endpoint.getBackend().getEventProtocolState?.() ?? null;
    const result = Object.freeze({
        sessionGeneration: Number(
            protocol?.sessionGeneration ?? endpointStatus.sessionGeneration
        ),
        deviceGeneration: Number(protocol?.deviceGeneration),
        authoritativeEpoch: Number(protocol?.authoritativeEpoch)
    });
    assert(
        Number.isSafeInteger(result.sessionGeneration)
            && result.sessionGeneration === endpointStatus.sessionGeneration
            && Number.isSafeInteger(result.deviceGeneration)
            && result.deviceGeneration >= 0
            && Number.isSafeInteger(result.authoritativeEpoch)
            && result.authoritativeEpoch >= 0,
        `Hostile attack event protocol이 유효하지 않습니다: ${JSON.stringify({ protocol, endpointStatus })}`
    );
    return result;
}

const HOSTILE_ATTACK_DIRECT_PROJECTILE_DATA = Object.freeze({
    ...HOSTILE_BASIC_BULLET_DATA,
    id: 'nw_hostile_attack_direct_projectile',
    continuousInteraction: true
});

function createHostileAttackDirectProjectileIntent(
    sourceHandle,
    position,
    velocity,
    spawnSequence
) {
    return createGpuProjectileSpawnIntent({
        definition: HOSTILE_ATTACK_DIRECT_PROJECTILE_DATA,
        position,
        velocity,
        sourceHandle,
        ownerHandle: sourceHandle,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        targetPolicyId:
            PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
        producerId: ARCHER_ATTACK_DATA.producerId,
        sourceAbilityId: ARCHER_ATTACK_DATA.sourceAbilityId,
        spawnSequence
    });
}

async function runProductionHostileAttackTargetInvalidHardwareSmoke(device) {
    const navigationSource = createPhase5ProjectileNavigationSource();
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPhase3PlatformPort(device)
    }, {
        capacity: 4,
        controlCommandCapacity: 1,
        sourceRelativeSpawnCommandCapacity: 1,
        spawnProgramCapacity: 1
    });
    const director = new HostileAttackDirector({ endpoint });
    const fixedDelta = 1 / 60;
    const archerPosition = Object.freeze({ x: 2, y: 8 });
    const targetPosition = Object.freeze({ x: 8, y: 8 });
    let archerHandle = null;
    let targetHandle = null;
    let destinationHandle = null;
    let fixedSubmitCount = 0;

    try {
        assert(
            endpoint.init(navigationSource) === false,
            'Hostile attack TARGET_INVALID endpoint는 첫 spawn 전 deferred여야 합니다.'
        );
        const archerIntent = Object.freeze({
            ...createGpuEnemySpawnIntent({
                definition: ARCHER_ENEMY_DATA,
                route: navigationSource.route,
                spawnSequence: 0,
                waveId: 'nw-hostile-attack-target-invalid',
                policyId: 'hardware-fixture'
            }),
            position: archerPosition
        });
        assert(
            endpoint.requestSpawn(
                archerIntent,
                1,
                'hostile-attack:target-invalid:archer'
            ).accepted,
            'Hostile attack TARGET_INVALID Archer request 실패'
        );
        const initialCommit = endpoint.commitAtFixedBoundary(1);
        archerHandle = initialCommit.spawned[0]?.handle;
        assert(
            archerHandle
                && initialCommit.spawned.length === 1
                && initialCommit.rejected.length === 0,
            `Hostile attack TARGET_INVALID Archer commit 실패: ${JSON.stringify(initialCommit)}`
        );
        const initialObservation = director.observeFixedCommit(initialCommit, 1);
        assert(
            initialObservation.spawnedArcherCount === 1
                && !initialObservation.recoveryRequired,
            `Hostile attack TARGET_INVALID Archer registration 실패: ${JSON.stringify(initialObservation)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, 1),
            'Hostile attack TARGET_INVALID initial fixed submit 실패'
        );
        fixedSubmitCount = 1;
        await settlePhase5Endpoint(
            endpoint,
            'Hostile attack TARGET_INVALID initial completion'
        );

        const initialArcherStatus = director.getStatus().archers[0];
        const firstEligibleFixedTick = initialArcherStatus.nextEligibleFixedTick;
        const targetSpawnFixedTick = firstEligibleFixedTick - 1;
        assert(
            firstEligibleFixedTick === 1
                + ARCHER_ATTACK_DATA.initialDelayTicks
                + computeHostileAttackPhaseOffset({
                    ...archerHandle,
                    phaseSpreadTicks: ARCHER_ATTACK_DATA.phaseSpreadTicks
                }),
            `Hostile attack TARGET_INVALID first eligibility가 deterministic하지 않습니다: ${JSON.stringify(initialArcherStatus)}`
        );

        for (let tick = 2; tick < targetSpawnFixedTick; tick++) {
            const completed = endpoint.commitCompletedEventsAtFixedBoundary(tick);
            const completedObservation = director.observeCompletedEvents(completed);
            const stage = director.stageForFixedTick({
                targetFixedTick: tick,
                targetHandle: null
            });
            const commit = endpoint.commitAtFixedBoundary(tick);
            const commitObservation = director.observeFixedCommit(commit, tick);
            assert(
                completed.protocolFailure === null
                    && !completedObservation.recoveryRequired
                    && stage.attemptedCount === 0
                    && !commit.recoveryRequired
                    && !commitObservation.recoveryRequired,
                `Hostile attack TARGET_INVALID pre-target lifecycle 실패: tick=${tick}, result=${JSON.stringify({ completed, stage, commit })}`
            );
            assert(
                endpoint.fixedUpdate(fixedDelta, tick),
                `Hostile attack TARGET_INVALID pre-target fixed submit 실패: tick=${tick}`
            );
            fixedSubmitCount++;
            await settlePhase5Endpoint(
                endpoint,
                `Hostile attack TARGET_INVALID pre-target tick ${tick}`
            );
        }

        const targetSpawnCompleted = endpoint.commitCompletedEventsAtFixedBoundary(
            targetSpawnFixedTick
        );
        assert(
            targetSpawnCompleted.protocolFailure === null
                && !director.observeCompletedEvents(targetSpawnCompleted)
                    .recoveryRequired,
            `Hostile attack TARGET_INVALID target-spawn completed event 실패: ${JSON.stringify(targetSpawnCompleted)}`
        );
        const preTargetStage = director.stageForFixedTick({
            targetFixedTick: targetSpawnFixedTick,
            targetHandle: null
        });
        const deadTargetIntent = createPhase3SpawnIntent(
            'nw_hostile_attack_gpu_dead_tower_target',
            {
                kindId: 'tower',
                position: targetPosition,
                velocity: { x: 0, y: 0 },
                radius: THE_TOWER_DATA.RADIUS_TILES,
                inverseMass: 1 / THE_TOWER_DATA.MASS,
                bodyLayer:
                    GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE,
                collisionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN,
                interactionLayer:
                    GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE,
                interactionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
                teamId: GAMEPLAY_TEAM_ID.PLAYER,
                health: 0,
                lifetime: -1
            }
        );
        const targetReceipt = endpoint.requestSpawn(
            deadTargetIntent,
            targetSpawnFixedTick,
            'hostile-attack:target-invalid:dead-tower'
        );
        assert(
            preTargetStage.attemptedCount === 0 && targetReceipt.accepted,
            `Hostile attack TARGET_INVALID dead target request 실패: ${JSON.stringify({ preTargetStage, targetReceipt })}`
        );
        const targetSpawnCommit = endpoint.commitAtFixedBoundary(
            targetSpawnFixedTick
        );
        targetHandle = targetSpawnCommit.spawned.find(({ commandId }) => (
            commandId === 'hostile-attack:target-invalid:dead-tower'
        ))?.handle;
        const targetSpawnObservation = director.observeFixedCommit(
            targetSpawnCommit,
            targetSpawnFixedTick
        );
        assert(
            targetHandle
                && targetSpawnCommit.spawned.length === 1
                && !targetSpawnCommit.recoveryRequired
                && !targetSpawnObservation.recoveryRequired,
            `Hostile attack TARGET_INVALID dead target commit 실패: ${JSON.stringify(targetSpawnCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, targetSpawnFixedTick),
            'Hostile attack TARGET_INVALID dead target fixed submit 실패'
        );
        fixedSubmitCount++;
        await settlePhase5Endpoint(
            endpoint,
            'Hostile attack TARGET_INVALID dead target completion'
        );
        const gpuDeadBodies = await readPhase5Bodies(endpoint);
        assert(
            !gpuDeadBodies.some((body) => (
                hostileAttackLifecycleHandleMatches(body, targetHandle)
            ))
                && endpoint.getRegistry().has(targetHandle)
                && endpoint.hasBody(targetHandle),
            `Hostile attack TARGET_INVALID fixture가 GPU-dead/host-live가 아닙니다: ${JSON.stringify({ targetHandle, gpuDeadBodies })}`
        );

        const targetInvalidStage = director.stageForFixedTick({
            targetFixedTick: firstEligibleFixedTick,
            targetHandle
        });
        assert(
            targetInvalidStage.acceptedCount === 1
                && targetInvalidStage.commandIds.length === 1,
            `Hostile attack TARGET_INVALID shot request 실패: ${JSON.stringify(targetInvalidStage)}`
        );
        const targetInvalidCommandId = targetInvalidStage.commandIds[0];
        const targetInvalidCommit = endpoint.commitAtFixedBoundary(
            firstEligibleFixedTick
        );
        destinationHandle = targetInvalidCommit.fixedCommands
            .sourceRelativeSpawns.find(({ commandId }) => (
                commandId === targetInvalidCommandId
            ))?.handle;
        const targetInvalidAcceptance = director.observeFixedCommit(
            targetInvalidCommit,
            firstEligibleFixedTick
        );
        assert(
            destinationHandle
                && targetInvalidCommit.fixedCommands.sourceRelativeSpawns.length === 1
                && targetInvalidCommit.fixedCommands.rejected.length === 0
                && targetInvalidAcceptance.fixedAcceptedCount === 1
                && !targetInvalidAcceptance.recoveryRequired,
            `Hostile attack TARGET_INVALID fixed acceptance 실패: ${JSON.stringify(targetInvalidCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, firstEligibleFixedTick),
            'Hostile attack TARGET_INVALID resolve fixed submit 실패'
        );
        fixedSubmitCount++;
        await settlePhase5Endpoint(
            endpoint,
            'Hostile attack TARGET_INVALID SpawnProgram completion',
            { spawnProgram: true }
        );
        const bodiesAfterResolve = await readPhase5Bodies(endpoint);
        assert(
            !bodiesAfterResolve.some((body) => (
                hostileAttackLifecycleHandleMatches(body, destinationHandle)
            )),
            `Hostile attack TARGET_INVALID destination이 GPU ALIVE가 됐습니다: ${JSON.stringify(bodiesAfterResolve)}`
        );

        const completionBoundaryTick = firstEligibleFixedTick + 1;
        const completed = endpoint.commitCompletedEventsAtFixedBoundary(
            completionBoundaryTick
        );
        const completedObservation = director.observeCompletedEvents(completed);
        const pendingStage = director.stageForFixedTick({
            targetFixedTick: completionBoundaryTick,
            targetHandle
        });
        const completionCommit = endpoint.commitAtFixedBoundary(
            completionBoundaryTick
        );
        const completionObservation = director.observeFixedCommit(
            completionCommit,
            completionBoundaryTick
        );
        const completion = completionCommit.fixedCommands.completed.find(
            ({ commandId }) => commandId === targetInvalidCommandId
        );
        const targetDeath = completed.deathEvents.find((event) => (
            hostileAttackLifecycleHandleMatches(event, targetHandle)
        ));
        const statusAfterTargetInvalid = director.getStatus();
        const archerAfterTargetInvalid = statusAfterTargetInvalid.archers[0];
        assert(
            completed.protocolFailure === null
                && targetDeath
                && !completedObservation.recoveryRequired
                && pendingStage.attemptedCount === 0
                && completionCommit.despawned.some((entry) => (
                    hostileAttackLifecycleHandleMatches(entry, targetHandle)
                ))
                && completion?.outcome === 'target-invalid'
                && hostileAttackLifecycleHandleMatches(
                    completion.handle,
                    destinationHandle
                )
                && completionObservation.completedCount === 1
                && !completionObservation.recoveryRequired
                && statusAfterTargetInvalid.pendingShotCount === 0
                && archerAfterTargetInvalid.shotSequence === 0
                && archerAfterTargetInvalid.nextEligibleFixedTick
                    === firstEligibleFixedTick
                && statusAfterTargetInvalid.telemetry.completedTargetInvalid === 1,
            `Hostile attack TARGET_INVALID completion/cooldown 실패: ${JSON.stringify({ completed, completionCommit, completionObservation, statusAfterTargetInvalid })}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, completionBoundaryTick),
            'Hostile attack TARGET_INVALID post-completion fixed submit 실패'
        );
        fixedSubmitCount++;
        await settlePhase5Endpoint(
            endpoint,
            'Hostile attack TARGET_INVALID post-completion tick'
        );

        const cleanupTick = completionBoundaryTick + 1;
        const cleanupCompleted = endpoint.commitCompletedEventsAtFixedBoundary(
            cleanupTick
        );
        const cleanupCompletedObservation = director.observeCompletedEvents(
            cleanupCompleted
        );
        const noTargetRetry = director.stageForFixedTick({
            targetFixedTick: cleanupTick,
            targetHandle: null
        });
        const archerCleanupReceipt = endpoint.requestDespawn(
            archerHandle,
            'hostile-attack-target-invalid-fixture-cleanup',
            cleanupTick,
            'hostile-attack:target-invalid:archer-cleanup'
        );
        const cleanupCommit = endpoint.commitAtFixedBoundary(cleanupTick);
        const cleanupObservation = director.observeFixedCommit(
            cleanupCommit,
            cleanupTick
        );
        await device.queue.onSubmittedWorkDone();
        const cleanupStatus = endpoint.getStatus();
        const gpuCleanupStatus = endpoint.getBackend().simulation.getStatus();
        const cleanupDirectorStatus = director.getStatus();
        assert(
            cleanupCompleted.protocolFailure === null
                && !cleanupCompletedObservation.recoveryRequired
                && noTargetRetry.attemptedCount === 0
                && archerCleanupReceipt.accepted
                && cleanupCommit.despawned.length === 1
                && cleanupCommit.despawned.some((entry) => (
                    hostileAttackLifecycleHandleMatches(entry, archerHandle)
                ))
                && cleanupCommit.rejected.length === 0
                && cleanupObservation.removedArcherCount === 1
                && cleanupStatus.activeCount === 0
                && cleanupStatus.activeEnemyCount === 0
                && cleanupStatus.activeProjectileCount === 0
                && cleanupStatus.reservedCount === 0
                && cleanupStatus.pendingCommandCount === 0
                && cleanupStatus.pendingSourceRelativeDestinationCount === 0
                && gpuCleanupStatus.activeBodyCount === 0
                && gpuCleanupStatus.pendingBodyCount === 0
                && cleanupDirectorStatus.activeArcherCount === 0
                && cleanupDirectorStatus.pendingShotCount === 0
                && !cleanupStatus.recoveryRequired
                && !director.requiresRecovery(),
            `Hostile attack TARGET_INVALID cleanup/leak 실패: ${JSON.stringify({ cleanupCommit, cleanupStatus, gpuCleanupStatus, cleanupDirectorStatus })}`
        );
        return Object.freeze({
            firstEligibleFixedTick,
            requestFixedTick: firstEligibleFixedTick,
            completionBoundaryTick,
            outcome: completion.outcome,
            cooldownConsumed: false,
            shotSequence: archerAfterTargetInvalid.shotSequence,
            nextEligibleFixedTick:
                archerAfterTargetInvalid.nextEligibleFixedTick,
            targetDeathSourceTick: targetDeath.sourceTick,
            fixedSubmitCount,
            cleanup: Object.freeze({
                activeCount: cleanupStatus.activeCount,
                activeEnemyCount: cleanupStatus.activeEnemyCount,
                activeProjectileCount: cleanupStatus.activeProjectileCount,
                reservedCount: cleanupStatus.reservedCount,
                pendingCommandCount: cleanupStatus.pendingCommandCount,
                pendingDestinationCount:
                    cleanupStatus.pendingSourceRelativeDestinationCount,
                activeBodyCount: gpuCleanupStatus.activeBodyCount,
                pendingBodyCount: gpuCleanupStatus.pendingBodyCount,
                directorActiveArcherCount:
                    cleanupDirectorStatus.activeArcherCount,
                directorPendingShotCount:
                    cleanupDirectorStatus.pendingShotCount,
                recoveryRequired: cleanupStatus.recoveryRequired
            })
        });
    } finally {
        director.destroy();
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function runProductionHostileAttackLifecycleMainHardwareSmoke(device) {
    const blocked = new Uint8Array(16 * 16);
    const blockedCell = Object.freeze({ column: 4, row: 4 });
    blocked[(blockedCell.row * 16) + blockedCell.column] = 1;
    const navigationSource = createPhase5ProjectileNavigationSource({ blocked });
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPhase3PlatformPort(device)
    }, {
        capacity: 16,
        controlCommandCapacity: 2,
        sourceRelativeSpawnCommandCapacity: 2,
        spawnProgramCapacity: 2
    });
    const director = new HostileAttackDirector({ endpoint });
    const towerRoster = new TowerCombatRoster({
        maxHp: THE_TOWER_COMBAT_DATA.MAX_HEALTH
    });
    const fixedDelta = 1 / 60;
    const archerPosition = Object.freeze({ x: 2, y: 8 });
    // Repeat shot 전에 flow Archer가 Tower obstacle과 겹치지 않게 target lane을 분리합니다.
    const towerPosition = Object.freeze({ x: 8, y: 10 });
    const hostileProbePosition = Object.freeze({ x: 4, y: 3 });
    const coreIntegrity = { current: 100, max: 100 };
    const domainSentinel = {
        coreIntegrity,
        reward: 0,
        runFailed: 0
    };
    const domainSentinelBefore = JSON.stringify(domainSentinel);
    const domainSentinelValuesBefore = Object.freeze({
        coreIntegrityCurrent: coreIntegrity.current,
        coreIntegrityMax: coreIntegrity.max,
        reward: domainSentinel.reward,
        runFailed: domainSentinel.runFailed
    });
    const observedContactEvents = [];
    const observedDeathEvents = [];
    const towerDamageFacts = [];
    const towerDeathFacts = [];
    const towerHpSequence = [THE_TOWER_COMBAT_DATA.MAX_HEALTH];
    let archerHandle = null;
    let towerHandle = null;
    let coreHandle = null;
    let hostileProbeHandle = null;
    let fixedSubmitCount = 0;

    const collectCompleted = (completed) => {
        observedContactEvents.push(...completed.contactEvents);
        observedDeathEvents.push(...completed.deathEvents);
    };
    const collectTowerFacts = (facts) => {
        for (const fact of facts) {
            if (fact.type === TOWER_COMBAT_FACT_TYPE.DAMAGE_APPLIED) {
                towerDamageFacts.push(fact);
                towerHpSequence.push(fact.currentHp);
            } else if (fact.type === TOWER_COMBAT_FACT_TYPE.DIED) {
                towerDeathFacts.push(fact);
            }
        }
    };

    try {
        assert(
            endpoint.init(navigationSource) === false,
            'Hostile attack lifecycle endpoint는 첫 spawn 전 deferred여야 합니다.'
        );
        const archerIntent = Object.freeze({
            ...createGpuEnemySpawnIntent({
                definition: ARCHER_ENEMY_DATA,
                route: navigationSource.route,
                spawnSequence: 0,
                waveId: 'nw-hostile-attack-direct-archer',
                policyId: 'hardware-fixture'
            }),
            position: archerPosition
        });
        const hostileProbeIntent = Object.freeze({
            ...createGpuEnemySpawnIntent({
                definition: Object.freeze({
                    ...BASIC_CIRCLE_ENEMY_DATA,
                    id: 'nw_hostile_attack_non_archer_probe',
                    maxHealth: 10
                }),
                route: navigationSource.route,
                spawnSequence: 1,
                waveId: 'nw-hostile-attack-direct-archer',
                policyId: 'hardware-fixture'
            }),
            position: hostileProbePosition,
            // 실제 hostile team matrix를 통과시키기 위한 technical target probe입니다.
            interactionLayer:
                GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
        });
        const initialRequests = [
            endpoint.requestSpawn(
                archerIntent,
                1,
                'hostile-attack:initial:archer'
            ),
            endpoint.requestSpawn(
                createGpuTowerSpawnIntent({ position: towerPosition }),
                1,
                'hostile-attack:initial:tower'
            ),
            endpoint.requestSpawn(
                createGpuCoreProxySpawnIntent({
                    position: navigationSource.corePosition
                }),
                1,
                'hostile-attack:initial:core'
            ),
            endpoint.requestSpawn(
                hostileProbeIntent,
                1,
                'hostile-attack:initial:hostile-probe'
            )
        ];
        assert(
            initialRequests.every(({ accepted }) => accepted),
            `Hostile attack lifecycle initial requests 실패: ${JSON.stringify(initialRequests)}`
        );
        const initialCommit = endpoint.commitAtFixedBoundary(1);
        const initialHandles = new Map(
            initialCommit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        archerHandle = initialHandles.get('hostile-attack:initial:archer');
        towerHandle = initialHandles.get('hostile-attack:initial:tower');
        coreHandle = initialHandles.get('hostile-attack:initial:core');
        hostileProbeHandle = initialHandles.get(
            'hostile-attack:initial:hostile-probe'
        );
        assert(
            initialCommit.state === 'committed'
                && initialCommit.spawned.length === 4
                && initialCommit.rejected.length === 0
                && archerHandle
                && towerHandle
                && coreHandle
                && hostileProbeHandle,
            `Hostile attack lifecycle initial commit 실패: ${JSON.stringify(initialCommit)}`
        );
        const initialDirectorObservation = director.observeFixedCommit(
            initialCommit,
            1
        );
        assert(
            initialDirectorObservation.spawnedArcherCount === 1
                && !initialDirectorObservation.recoveryRequired
                && director.getStatus().activeArcherCount === 1,
            `Hostile attack lifecycle exact Archer registration 실패: ${JSON.stringify(initialDirectorObservation)}`
        );
        towerRoster.bindGpuBody(
            towerHandle,
            readHostileAttackLifecycleProtocol(endpoint)
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, 1),
            'Hostile attack lifecycle initial fixed submit 실패'
        );
        fixedSubmitCount = 1;
        await settlePhase5Endpoint(
            endpoint,
            'Hostile attack lifecycle initial completion'
        );
        const initialBodies = await readPhase5Bodies(endpoint);
        const initialArcher = findPhase5Body(
            initialBodies,
            archerHandle,
            'Hostile attack initial Archer'
        );
        const initialTower = findPhase5Body(
            initialBodies,
            towerHandle,
            'Hostile attack initial Tower'
        );
        const initialCore = findPhase5Body(
            initialBodies,
            coreHandle,
            'Hostile attack initial Core'
        );
        const initialHostileProbe = findPhase5Body(
            initialBodies,
            hostileProbeHandle,
            'Hostile attack initial hostile probe'
        );
        assert(
            Math.hypot(initialArcher.velocity.x, initialArcher.velocity.y) > 0
                && initialTower.health === THE_TOWER_COMBAT_DATA.MAX_HEALTH
                && initialHostileProbe.health === 10,
            `Hostile attack initial actor numeric 불일치: ${JSON.stringify({ initialArcher, initialTower, initialHostileProbe })}`
        );

        const advanceFixedTick = async (tick, options = {}) => {
            const completed = endpoint.commitCompletedEventsAtFixedBoundary(tick);
            assert(
                completed.protocolFailure === null,
                `Hostile attack completed event protocol 실패: tick=${tick}, result=${JSON.stringify(completed)}`
            );
            collectCompleted(completed);
            const towerFacts = towerRoster.commitCompletedEvents(
                completed,
                endpoint.getRegistry()
            );
            collectTowerFacts(towerFacts);
            const completedObservation = director.observeCompletedEvents(completed);
            assert(
                !completedObservation.recoveryRequired,
                `Hostile attack Director completed observation 실패: tick=${tick}, result=${JSON.stringify(completedObservation)}`
            );

            const liveTowerTarget = towerRoster.isPrimaryTowerAlive()
                && endpoint.getRegistry().has(towerHandle)
                && endpoint.hasBody(towerHandle)
                ? towerHandle
                : null;
            const queued = options.beforeStage?.({
                tick,
                liveTowerTarget
            }) ?? null;
            let controlReceipt = null;
            if (liveTowerTarget) {
                const controlIntent = options.controlIntent ?? { x: 0, y: 0 };
                controlReceipt = endpoint.requestBodyControl({
                    handle: towerHandle,
                    moveIntentX: controlIntent.x,
                    moveIntentY: controlIntent.y
                }, tick, `hostile-attack:tower-control:${tick}`);
                assert(
                    controlReceipt.accepted,
                    `Hostile attack Tower control request 실패: tick=${tick}, receipt=${JSON.stringify(controlReceipt)}`
                );
            }
            const stage = director.stageForFixedTick({
                targetFixedTick: tick,
                targetHandle: liveTowerTarget
            });
            assert(
                !stage.recoveryRequired,
                `Hostile attack shot stage recovery 발생: tick=${tick}, result=${JSON.stringify(stage)}`
            );
            const commit = endpoint.commitAtFixedBoundary(tick);
            assert(
                !commit.recoveryRequired
                    && commit.fixedCommands
                    && commit.fixedCommands.rejected.length === 0,
                `Hostile attack lifecycle/fixed commit 실패: tick=${tick}, result=${JSON.stringify(commit)}`
            );
            if (controlReceipt) {
                assert(
                    commit.fixedCommands.controls.filter(({ commandId }) => (
                        commandId === controlReceipt.commandId
                    )).length === 1,
                    `Hostile attack pressure에서 Tower control이 commit되지 않았습니다: tick=${tick}, result=${JSON.stringify(commit)}`
                );
            }
            const commitObservation = director.observeFixedCommit(commit, tick);
            assert(
                !commitObservation.recoveryRequired,
                `Hostile attack Director fixed observation 실패: tick=${tick}, result=${JSON.stringify(commitObservation)}`
            );
            assert(
                endpoint.fixedUpdate(fixedDelta, tick),
                `Hostile attack fixed submit 실패: tick=${tick}`
            );
            fixedSubmitCount++;
            await settlePhase5Endpoint(
                endpoint,
                `Hostile attack lifecycle tick ${tick}`,
                {
                    spawnProgram:
                        commit.fixedCommands.sourceRelativeSpawns.length > 0
                }
            );
            return Object.freeze({
                completed,
                towerFacts,
                completedObservation,
                queued,
                controlReceipt,
                stage,
                commit,
                commitObservation
            });
        };

        const auxiliaryCommandIds = Object.freeze({
            hostileBlock: 'hostile-attack:aux:hostile-block',
            coreNoInteraction: 'hostile-attack:aux:core-no-interaction',
            terrain: 'hostile-attack:aux:terrain',
            lifetime: 'hostile-attack:aux:lifetime'
        });
        const auxiliaryAdvance = await advanceFixedTick(2, {
            beforeStage() {
                const requests = [
                    endpoint.requestSpawn(
                        createHostileAttackDirectProjectileIntent(
                            archerHandle,
                            initialHostileProbe.position,
                            initialHostileProbe.velocity,
                            10
                        ),
                        2,
                        auxiliaryCommandIds.hostileBlock
                    ),
                    endpoint.requestSpawn(
                        createHostileAttackDirectProjectileIntent(
                            archerHandle,
                            initialCore.position,
                            { x: 0, y: 0 },
                            11
                        ),
                        2,
                        auxiliaryCommandIds.coreNoInteraction
                    ),
                    endpoint.requestSpawn(
                        createHostileAttackDirectProjectileIntent(
                            archerHandle,
                            { x: 2.6, y: 4.5 },
                            { x: 12, y: 0 },
                            12
                        ),
                        2,
                        auxiliaryCommandIds.terrain
                    ),
                    endpoint.requestSpawn(
                        createHostileAttackDirectProjectileIntent(
                            archerHandle,
                            { x: 2, y: 14 },
                            { x: 0, y: 0 },
                            13
                        ),
                        2,
                        auxiliaryCommandIds.lifetime
                    )
                ];
                assert(
                    requests.every(({ accepted }) => accepted),
                    `Hostile attack auxiliary projectile requests 실패: ${JSON.stringify(requests)}`
                );
                return requests;
            }
        });
        const auxiliaryHandles = new Map(
            auxiliaryAdvance.commit.spawned.map(({ commandId, handle }) => (
                [commandId, handle]
            ))
        );
        const hostileBlockHandle = auxiliaryHandles.get(
            auxiliaryCommandIds.hostileBlock
        );
        const coreNoInteractionHandle = auxiliaryHandles.get(
            auxiliaryCommandIds.coreNoInteraction
        );
        const terrainHandle = auxiliaryHandles.get(auxiliaryCommandIds.terrain);
        const lifetimeHandle = auxiliaryHandles.get(auxiliaryCommandIds.lifetime);
        assert(
            auxiliaryAdvance.commit.spawned.length === 4
                && hostileBlockHandle
                && coreNoInteractionHandle
                && terrainHandle
                && lifetimeHandle,
            `Hostile attack auxiliary exact handles 누락: ${JSON.stringify(auxiliaryAdvance.commit)}`
        );
        const auxiliaryBodies = await readPhase5Bodies(endpoint);
        const hostileBlockAfterSpawn = findPhase5Body(
            auxiliaryBodies,
            hostileBlockHandle,
            'Hostile attack hostile-block projectile'
        );
        const hostileProbeAfterBlock = findPhase5Body(
            auxiliaryBodies,
            hostileProbeHandle,
            'Hostile attack hostile probe after block'
        );
        const coreBulletAfterSpawn = findPhase5Body(
            auxiliaryBodies,
            coreNoInteractionHandle,
            'Hostile attack Core non-interaction projectile'
        );
        assert(
            hostileBlockAfterSpawn.health
                === HOSTILE_BASIC_BULLET_DATA.penetration
                && hostileProbeAfterBlock.health === initialHostileProbe.health
                && coreBulletAfterSpawn.health
                    === HOSTILE_BASIC_BULLET_DATA.penetration,
            `Hostile attack auxiliary initial penetration/HP 불일치: ${JSON.stringify({ hostileBlockAfterSpawn, hostileProbeAfterBlock, coreBulletAfterSpawn })}`
        );

        const initialDirectorStatus = director.getStatus();
        const initialArcherRecord = initialDirectorStatus.archers[0];
        const firstEligibleFixedTick = initialArcherRecord.nextEligibleFixedTick;
        const expectedPhaseOffset = computeHostileAttackPhaseOffset({
            ...archerHandle,
            phaseSpreadTicks: ARCHER_ATTACK_DATA.phaseSpreadTicks
        });
        assert(
            initialArcherRecord.createdAtTick === 1
                && initialArcherRecord.phaseOffsetTicks === expectedPhaseOffset
                && firstEligibleFixedTick === 1
                    + ARCHER_ATTACK_DATA.initialDelayTicks
                    + expectedPhaseOffset,
            `Hostile attack deterministic eligibility 불일치: ${JSON.stringify(initialArcherRecord)}`
        );

        for (let tick = 3; tick < firstEligibleFixedTick - 1; tick++) {
            const advance = await advanceFixedTick(tick);
            assert(
                advance.stage.attemptedCount === 0,
                `Hostile attack first eligibility 이전에 shot이 시작됐습니다: tick=${tick}, result=${JSON.stringify(advance.stage)}`
            );
        }
        const firstMotionPrime = await advanceFixedTick(
            firstEligibleFixedTick - 1,
            { controlIntent: { x: 1, y: 0 } }
        );
        assert(
            firstMotionPrime.stage.attemptedCount === 0
                && firstMotionPrime.commit.fixedCommands.controls.length === 1,
            `Hostile attack moving Tower priming 실패: ${JSON.stringify(firstMotionPrime)}`
        );
        const firstTickStartBodies = await readPhase5Bodies(endpoint);
        const sourceTickStart = findPhase5Body(
            firstTickStartBodies,
            archerHandle,
            'Hostile attack Archer source tick-start'
        );
        const targetTickStart = findPhase5Body(
            firstTickStartBodies,
            towerHandle,
            'Hostile attack Tower target tick-start'
        );
        assert(
            Math.hypot(sourceTickStart.velocity.x, sourceTickStart.velocity.y) > 0
                && Math.hypot(targetTickStart.velocity.x, targetTickStart.velocity.y) > 0,
            `Hostile attack source/target tick-start가 moving이 아닙니다: ${JSON.stringify({ sourceTickStart, targetTickStart })}`
        );

        const firstShotAdvance = await advanceFixedTick(firstEligibleFixedTick);
        const firstShotCommandId = firstShotAdvance.stage.commandIds[0];
        const firstProjectileHandle = firstShotAdvance.commit.fixedCommands
            .sourceRelativeSpawns.find(({ commandId }) => (
                commandId === firstShotCommandId
            ))?.handle;
        assert(
            firstShotAdvance.stage.eligibleCount === 1
                && firstShotAdvance.stage.acceptedCount === 1
                && firstShotAdvance.commit.fixedCommands.controls.length === 1
                && firstShotAdvance.commit.fixedCommands
                    .sourceRelativeSpawns.length === 1
                && firstProjectileHandle,
            `Hostile attack first shot/control commit 실패: ${JSON.stringify(firstShotAdvance)}`
        );
        const firstShotBodies = await readPhase5Bodies(endpoint);
        const sourceAfterFirstShot = findPhase5Body(
            firstShotBodies,
            archerHandle,
            'Hostile attack Archer after first shot'
        );
        const targetAfterFirstShot = findPhase5Body(
            firstShotBodies,
            towerHandle,
            'Hostile attack Tower after first shot'
        );
        const firstProjectile = findPhase5Body(
            firstShotBodies,
            firstProjectileHandle,
            'Hostile attack first Archer projectile'
        );
        const aimDelta = Object.freeze({
            x: targetTickStart.position.x
                + ARCHER_ATTACK_DATA.targetOffset.x
                - sourceTickStart.position.x,
            y: targetTickStart.position.y
                + ARCHER_ATTACK_DATA.targetOffset.y
                - sourceTickStart.position.y
        });
        const aimMagnitude = Math.hypot(aimDelta.x, aimDelta.y);
        const expectedOrigin = Object.freeze({
            x: sourceTickStart.position.x + ARCHER_ATTACK_DATA.positionOffset.x,
            y: sourceTickStart.position.y + ARCHER_ATTACK_DATA.positionOffset.y
        });
        const expectedVelocity = Object.freeze({
            x: (aimDelta.x / aimMagnitude) * ARCHER_ATTACK_DATA.launchSpeed,
            y: (aimDelta.y / aimMagnitude) * ARCHER_ATTACK_DATA.launchSpeed
        });
        const firstProjectileSpeed = Math.hypot(
            firstProjectile.velocity.x,
            firstProjectile.velocity.y
        );
        assertNear(
            firstProjectile.previousPosition.x,
            expectedOrigin.x,
            0.00004,
            'Hostile attack targeted origin.x'
        );
        assertNear(
            firstProjectile.previousPosition.y,
            expectedOrigin.y,
            0.00004,
            'Hostile attack targeted origin.y'
        );
        assertNear(
            firstProjectile.velocity.x,
            expectedVelocity.x,
            0.00005,
            'Hostile attack targeted velocity.x'
        );
        assertNear(
            firstProjectile.velocity.y,
            expectedVelocity.y,
            0.00005,
            'Hostile attack targeted velocity.y'
        );
        assertNear(
            firstProjectileSpeed,
            ARCHER_ATTACK_DATA.launchSpeed,
            0.00005,
            'Hostile attack targeted speed'
        );
        assert(
            sourceAfterFirstShot.position.x > sourceTickStart.position.x
                && targetAfterFirstShot.position.x
                    > targetTickStart.position.x,
            `Hostile attack same-tick moving source/target 증거가 없습니다: ${JSON.stringify({ sourceTickStart, sourceAfterFirstShot, targetTickStart, targetAfterFirstShot })}`
        );

        const firstResolvedBoundaryTick = firstEligibleFixedTick + 1;
        const firstResolvedAdvance = await advanceFixedTick(
            firstResolvedBoundaryTick
        );
        const firstCompletion = firstResolvedAdvance.commit.fixedCommands
            .completed.find(({ commandId }) => commandId === firstShotCommandId);
        const firstProjectileView = endpoint.getRegistry().copyEntityView(
            firstProjectileHandle,
            {}
        );
        const firstInteractionMask = unpackGpuCircleInteractionMeta(
            firstProjectile.interactionMeta
        ).interactionMask;
        const firstResolvedDirectorStatus = director.getStatus();
        const firstResolvedArcherRecord = firstResolvedDirectorStatus.archers[0];
        const secondEligibleFixedTick = firstEligibleFixedTick
            + ARCHER_ATTACK_DATA.intervalTicks;
        assert(
            firstCompletion?.outcome === 'resolved'
                && hostileAttackLifecycleHandleMatches(
                    firstCompletion.handle,
                    firstProjectileHandle
                )
                && firstResolvedAdvance.commitObservation.completedCount === 1
                && firstProjectileView?.metadata?.teamId
                    === GAMEPLAY_TEAM_ID.HOSTILE
                && firstProjectileView.metadata.targetPolicyId
                    === PROJECTILE_TARGET_POLICY_ID
                        .PLAYER_DAMAGEABLE_AND_TERRAIN
                && firstProjectileView.metadata.sourceEntityId
                    === archerHandle.entityId
                && firstProjectileView.metadata.sourceIncarnation
                    === archerHandle.incarnation
                && firstProjectileView.metadata.targetEntityId
                    === towerHandle.entityId
                && firstProjectileView.metadata.targetIncarnation
                    === towerHandle.incarnation
                && firstProjectileView.metadata.producerId
                    === ARCHER_ATTACK_DATA.producerId
                && firstProjectileView.metadata.sourceAbilityId
                    === ARCHER_ATTACK_DATA.sourceAbilityId
                && firstInteractionMask === (
                    GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
                    | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN
                )
                && firstResolvedArcherRecord.shotSequence === 1
                && firstResolvedArcherRecord.nextEligibleFixedTick
                    === secondEligibleFixedTick,
            `Hostile attack first resolved/provenance/cooldown 실패: ${JSON.stringify({ firstCompletion, firstProjectileView, firstResolvedDirectorStatus })}`
        );

        for (let tick = firstResolvedBoundaryTick + 1;
            tick < secondEligibleFixedTick - 1;
            tick++) {
            const advance = await advanceFixedTick(tick);
            assert(
                advance.stage.attemptedCount === 0,
                `Hostile attack repeat interval 이전에 shot이 시작됐습니다: tick=${tick}, result=${JSON.stringify(advance.stage)}`
            );
        }
        assert(
            JSON.stringify(towerHpSequence.slice(0, 2))
                === JSON.stringify([THE_TOWER_COMBAT_DATA.MAX_HEALTH, 25]),
            `Hostile attack first bullet Tower HP 30→25 실패: ${JSON.stringify(towerHpSequence)}`
        );
        const secondMotionPrime = await advanceFixedTick(
            secondEligibleFixedTick - 1,
            { controlIntent: { x: 1, y: 0 } }
        );
        assert(
            secondMotionPrime.stage.attemptedCount === 0
                && secondMotionPrime.commit.fixedCommands.controls.length === 1,
            `Hostile attack second moving Tower priming 실패: ${JSON.stringify(secondMotionPrime)}`
        );
        const secondShotAdvance = await advanceFixedTick(secondEligibleFixedTick);
        const secondShotCommandId = secondShotAdvance.stage.commandIds[0];
        const secondProjectileHandle = secondShotAdvance.commit.fixedCommands
            .sourceRelativeSpawns.find(({ commandId }) => (
                commandId === secondShotCommandId
            ))?.handle;
        assert(
            secondShotAdvance.stage.acceptedCount === 1
                && secondShotAdvance.commit.fixedCommands.controls.length === 1
                && secondProjectileHandle
                && secondEligibleFixedTick - firstEligibleFixedTick
                    === ARCHER_ATTACK_DATA.intervalTicks,
            `Hostile attack exact repeat interval shot 실패: ${JSON.stringify(secondShotAdvance)}`
        );
        const secondResolvedBoundaryTick = secondEligibleFixedTick + 1;
        const secondResolvedAdvance = await advanceFixedTick(
            secondResolvedBoundaryTick
        );
        const secondCompletion = secondResolvedAdvance.commit.fixedCommands
            .completed.find(({ commandId }) => commandId === secondShotCommandId);
        const secondResolvedDirectorStatus = director.getStatus();
        const secondResolvedArcherRecord = secondResolvedDirectorStatus.archers[0];
        const postSecondNextEligibleFixedTick = secondEligibleFixedTick
            + ARCHER_ATTACK_DATA.intervalTicks;
        assert(
            secondCompletion?.outcome === 'resolved'
                && hostileAttackLifecycleHandleMatches(
                    secondCompletion.handle,
                    secondProjectileHandle
                )
                && secondResolvedArcherRecord.shotSequence === 2
                && secondResolvedArcherRecord.nextEligibleFixedTick
                    === postSecondNextEligibleFixedTick,
            `Hostile attack second resolved/cooldown 실패: ${JSON.stringify({ secondCompletion, secondResolvedDirectorStatus })}`
        );

        let currentTick = secondResolvedBoundaryTick;
        while (towerHpSequence.length < 3
            && currentTick < secondEligibleFixedTick + 60) {
            currentTick++;
            await advanceFixedTick(currentTick);
        }
        assert(
            JSON.stringify(towerHpSequence.slice(0, 3))
                === JSON.stringify([THE_TOWER_COMBAT_DATA.MAX_HEALTH, 25, 20]),
            `Hostile attack repeated bullet Tower HP sequence 실패: ${JSON.stringify(towerHpSequence)}`
        );
        const bodiesBeforeLethal = await readPhase5Bodies(endpoint);
        const towerBeforeLethal = findPhase5Body(
            bodiesBeforeLethal,
            towerHandle,
            'Hostile attack Tower before lethal burst'
        );
        assertNear(
            towerBeforeLethal.health,
            20,
            0.000001,
            'Hostile attack Tower HP before lethal burst'
        );

        const lethalFixedTick = currentTick + 1;
        const lethalCommandIds = Object.freeze(Array.from(
            { length: 4 },
            (_, index) => `hostile-attack:lethal:${index}`
        ));
        const lethalAdvance = await advanceFixedTick(lethalFixedTick, {
            beforeStage() {
                const requests = lethalCommandIds.map((commandId, index) => (
                    endpoint.requestSpawn(
                        createHostileAttackDirectProjectileIntent(
                            archerHandle,
                            towerBeforeLethal.position,
                            { x: 0, y: 0 },
                            100 + index
                        ),
                        lethalFixedTick,
                        commandId
                    )
                ));
                assert(
                    requests.every(({ accepted }) => accepted),
                    `Hostile attack lethal burst requests 실패: ${JSON.stringify(requests)}`
                );
                return requests;
            }
        });
        const lethalHandles = lethalCommandIds.map((commandId) => (
            lethalAdvance.commit.spawned.find((entry) => (
                entry.commandId === commandId
            ))?.handle
        ));
        assert(
            lethalAdvance.stage.attemptedCount === 0
                && lethalAdvance.commit.fixedCommands.controls.length === 1
                && lethalHandles.every(Boolean),
            `Hostile attack lethal pressure/control commit 실패: ${JSON.stringify(lethalAdvance)}`
        );
        const bodiesAfterLethal = await readPhase5Bodies(endpoint);
        assert(
            !bodiesAfterLethal.some((body) => (
                hostileAttackLifecycleHandleMatches(body, towerHandle)
            ))
                && lethalHandles.every((handle) => !bodiesAfterLethal.some((body) => (
                    hostileAttackLifecycleHandleMatches(body, handle)
                ))),
            `Hostile attack lethal GPU death가 완료되지 않았습니다: ${JSON.stringify(bodiesAfterLethal)}`
        );

        const towerDeathBoundaryTick = lethalFixedTick + 1;
        const towerDeathAdvance = await advanceFixedTick(
            towerDeathBoundaryTick
        );
        assert(
            towerDeathAdvance.completed.deathEvents.some((event) => (
                hostileAttackLifecycleHandleMatches(event, towerHandle)
            ))
                && towerDeathAdvance.stage.attemptedCount === 0
                && towerDeathAdvance.controlReceipt === null
                && !towerRoster.isPrimaryTowerAlive()
                && towerRoster.getLivingTowerCount() === 0
                && towerDeathFacts.length === 1
                && towerDeathFacts[0].sourceHandle
                && lethalHandles.some((handle) => (
                    hostileAttackLifecycleHandleMatches(
                        towerDeathFacts[0].sourceHandle,
                        handle
                    )
                ))
                && JSON.stringify(towerHpSequence)
                    === JSON.stringify([30, 25, 20, 15, 10, 5, 0]),
            `Hostile attack Tower lethal/death ordering 실패: ${JSON.stringify({ towerDeathAdvance, towerHpSequence, towerDeathFacts })}`
        );
        const archerAfterTowerDeathStart = findPhase5Body(
            await readPhase5Bodies(endpoint),
            archerHandle,
            'Hostile attack Archer after Tower death start'
        );
        const acceptedShotCountAtTowerDeath = director.getStatus()
            .shotRequestAcceptedCount;
        const postDeathSampleFixedTick = towerDeathBoundaryTick + 6;
        const postDeathEndFixedTick = Math.max(
            postSecondNextEligibleFixedTick + 1,
            postDeathSampleFixedTick
        );
        let archerAfterTowerDeathSample = null;
        let postDeathStageAttemptCount = 0;
        for (let tick = towerDeathBoundaryTick + 1;
            tick <= postDeathEndFixedTick;
            tick++) {
            const advance = await advanceFixedTick(tick);
            postDeathStageAttemptCount += advance.stage.attemptedCount;
            assert(
                advance.stage.acceptedCount === 0
                    && advance.controlReceipt === null,
                `Hostile attack Tower death 후 shot/control이 발생했습니다: tick=${tick}, result=${JSON.stringify(advance)}`
            );
            if (tick === postDeathSampleFixedTick) {
                archerAfterTowerDeathSample = findPhase5Body(
                    await readPhase5Bodies(endpoint),
                    archerHandle,
                    'Hostile attack Archer after Tower death displacement'
                );
            }
        }
        const archerPostDeathDisplacement = Object.freeze({
            x: archerAfterTowerDeathSample.position.x
                - archerAfterTowerDeathStart.position.x,
            y: archerAfterTowerDeathSample.position.y
                - archerAfterTowerDeathStart.position.y
        });
        const acceptedShotCountAfterTowerDeath = director.getStatus()
            .shotRequestAcceptedCount;
        assert(
            Math.hypot(
                archerPostDeathDisplacement.x,
                archerPostDeathDisplacement.y
            ) > 0
                && postDeathStageAttemptCount === 0
                && acceptedShotCountAfterTowerDeath
                    === acceptedShotCountAtTowerDeath
                && acceptedShotCountAfterTowerDeath === 2,
            `Hostile attack Tower death 후 Archer flow/no-shot 실패: ${JSON.stringify({ archerAfterTowerDeathStart, archerAfterTowerDeathSample, archerPostDeathDisplacement, acceptedShotCountAtTowerDeath, acceptedShotCountAfterTowerDeath, postDeathStageAttemptCount })}`
        );

        const firstDamageContact = observedContactEvents.find((event) => (
            hostileAttackLifecyclePairMatches(
                event,
                firstProjectileHandle,
                towerHandle
            )
            && event.eventType === 'damage-applied'
        ));
        const firstProjectileDeath = observedDeathEvents.find((event) => (
            hostileAttackLifecycleHandleMatches(event, firstProjectileHandle)
        ));
        const firstDamageFact = towerDamageFacts.find((fact) => (
            hostileAttackLifecycleHandleMatches(
                fact.sourceHandle,
                firstProjectileHandle
            )
        ));
        const hostileProbeDamageEvents = observedContactEvents.filter((event) => (
            hostileAttackLifecyclePairMatches(
                event,
                hostileBlockHandle,
                hostileProbeHandle
            )
            && event.eventType === 'damage-applied'
        ));
        const hostileProbeInteractionEvents = observedContactEvents.filter((event) => (
            hostileAttackLifecyclePairMatches(
                event,
                hostileBlockHandle,
                hostileProbeHandle
            )
        ));
        const coreInteractionEvents = observedContactEvents.filter((event) => (
            hostileAttackLifecyclePairMatches(
                event,
                coreNoInteractionHandle,
                coreHandle
            )
        ));
        const terrainDeath = observedDeathEvents.find((event) => (
            hostileAttackLifecycleHandleMatches(event, terrainHandle)
        ));
        const lifetimeDeath = observedDeathEvents.find((event) => (
            hostileAttackLifecycleHandleMatches(event, lifetimeHandle)
        ));
        const preCleanupBodies = await readPhase5Bodies(endpoint);
        const coreBeforeCleanup = findPhase5Body(
            preCleanupBodies,
            coreHandle,
            'Hostile attack Core before cleanup'
        );
        assert(
            firstDamageContact?.damageFixedPoint === 500
                && firstDamageContact.damage === 5
                && firstProjectileDeath
                && firstProjectileDeath.sourceTick
                    === firstDamageContact.sourceTick
                && firstProjectileDeath.reason !== 'lifetime'
                && firstDamageFact?.damageFixedPoint === 500
                && firstDamageFact.damage === 5
                && firstDamageFact.producerId === ARCHER_ATTACK_DATA.producerId
                && firstDamageFact.sourceAbilityId
                    === ARCHER_ATTACK_DATA.sourceAbilityId
                && hostileAttackLifecycleHandleMatches(
                    firstDamageFact.targetHandle,
                    towerHandle
                ),
            `Hostile attack Tower damage/provenance contract 실패: ${JSON.stringify({ firstDamageContact, firstProjectileDeath, firstDamageFact })}`
        );
        assert(
            hostileProbeDamageEvents.length === 0
                && hostileProbeInteractionEvents.length > 0
                && hostileProbeInteractionEvents.every((event) => (
                    event.eventType === 'interaction-continuous'
                    && event.damageFixedPoint === 0
                    && event.damage === 0
                    && event.valueFixedPoint === 0
                    && event.reason === 'interaction'
                    && event.disposition === 'applied'
                ))
                && hostileBlockAfterSpawn.health
                    === HOSTILE_BASIC_BULLET_DATA.penetration
                && hostileProbeAfterBlock.health === initialHostileProbe.health,
            `Hostile attack hostile-on-hostile isolation contract 실패: ${JSON.stringify({ hostileProbeDamageEvents, hostileProbeInteractionEvents, hostileBlockAfterSpawn, hostileProbeAfterBlock })}`
        );
        assert(
            coreInteractionEvents.length === 0
                && coreBeforeCleanup.health === initialCore.health,
            `Hostile attack Core isolation contract 실패: ${JSON.stringify({ coreInteractionEvents, initialCore, coreBeforeCleanup })}`
        );
        assert(
            terrainDeath?.reason === 'health'
                && terrainDeath.flags === 1
                && terrainDeath.reasonFlags === 1
                && terrainDeath.disposition === 'despawn-requested'
                && lifetimeDeath?.reason === 'lifetime'
                && lifetimeDeath.flags === 2
                && lifetimeDeath.reasonFlags === 2
                && lifetimeDeath.disposition === 'despawn-requested',
            `Hostile attack terrain/lifetime cleanup contract 실패: ${JSON.stringify({ terrainDeath, lifetimeDeath })}`
        );

        const preCleanupStatus = endpoint.getStatus();
        assert(
            preCleanupStatus.activeCount === 3
                && preCleanupStatus.activeEnemyCount === 2
                && preCleanupStatus.activeProjectileCount === 0
                && preCleanupStatus.reservedCount === 0
                && preCleanupStatus.pendingCommandCount === 0
                && !preCleanupStatus.recoveryRequired,
            `Hostile attack pre-cleanup active/pending 상태 불일치: ${JSON.stringify(preCleanupStatus)}`
        );
        const cleanupFixedTick = postDeathEndFixedTick + 1;
        const cleanupCompleted = endpoint.commitCompletedEventsAtFixedBoundary(
            cleanupFixedTick
        );
        collectCompleted(cleanupCompleted);
        collectTowerFacts(towerRoster.commitCompletedEvents(
            cleanupCompleted,
            endpoint.getRegistry()
        ));
        const cleanupCompletedObservation = director.observeCompletedEvents(
            cleanupCompleted
        );
        const cleanupStage = director.stageForFixedTick({
            targetFixedTick: cleanupFixedTick,
            targetHandle: null
        });
        const cleanupHandles = [archerHandle, coreHandle, hostileProbeHandle];
        const cleanupReceipts = cleanupHandles.map((handle, index) => (
            endpoint.requestDespawn(
                handle,
                'hostile-attack-lifecycle-fixture-cleanup',
                cleanupFixedTick,
                `hostile-attack:cleanup:${index}`
            )
        ));
        assert(
            cleanupCompleted.protocolFailure === null
                && !cleanupCompletedObservation.recoveryRequired
                && cleanupStage.attemptedCount === 0
                && cleanupReceipts.every(({ accepted }) => accepted),
            `Hostile attack final cleanup requests 실패: ${JSON.stringify({ cleanupCompleted, cleanupStage, cleanupReceipts })}`
        );
        const cleanupCommit = endpoint.commitAtFixedBoundary(cleanupFixedTick);
        const cleanupObservation = director.observeFixedCommit(
            cleanupCommit,
            cleanupFixedTick
        );
        await device.queue.onSubmittedWorkDone();
        const cleanupStatus = endpoint.getStatus();
        const gpuCleanupStatus = endpoint.getBackend().simulation.getStatus();
        const storageProfile = cleanupStatus.backend.gpu.fixedPrimitives
            .storageProfile;
        assert(
            cleanupCommit.despawned.length === cleanupHandles.length
                && cleanupHandles.every((handle) => (
                    cleanupCommit.despawned.some((entry) => (
                        hostileAttackLifecycleHandleMatches(entry, handle)
                    ))
                ))
                && cleanupObservation.removedArcherCount === 1
                && cleanupStatus.activeCount === 0
                && cleanupStatus.activeEnemyCount === 0
                && cleanupStatus.activeProjectileCount === 0
                && cleanupStatus.reservedCount === 0
                && cleanupStatus.pendingCommandCount === 0
                && cleanupStatus.pendingSourceRelativeDestinationCount === 0
                && gpuCleanupStatus.activeBodyCount === 0
                && gpuCleanupStatus.pendingBodyCount === 0
                && director.getStatus().activeArcherCount === 0
                && director.getStatus().pendingShotCount === 0
                && !cleanupStatus.recoveryRequired
                && !director.requiresRecovery()
                && storageProfile.requiredMaximum
                    === REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE,
            `Hostile attack final cleanup/recovery/storage 실패: ${JSON.stringify({ cleanupCommit, cleanupStatus, gpuCleanupStatus, directorStatus: director.getStatus() })}`
        );
        assert(
            domainSentinel.coreIntegrity === coreIntegrity
                && JSON.stringify(domainSentinel) === domainSentinelBefore,
            'Hostile attack lifecycle가 CoreIntegrity/reward/RunFailed sentinel을 변경했습니다.'
        );

        return Object.freeze({
            definitionIds: Object.freeze({
                archer: ARCHER_ENEMY_DATA.id,
                attack: ARCHER_ATTACK_DATA.id,
                projectile: HOSTILE_BASIC_BULLET_DATA.id
            }),
            timeline: Object.freeze({
                createdAtTick: initialArcherRecord.createdAtTick,
                phaseOffsetTicks: expectedPhaseOffset,
                firstEligibleFixedTick,
                firstResolvedBoundaryTick,
                firstNextEligibleFixedTick: secondEligibleFixedTick,
                secondEligibleFixedTick,
                secondResolvedBoundaryTick,
                secondNextEligibleFixedTick:
                    postSecondNextEligibleFixedTick,
                towerDeathBoundaryTick,
                observedThroughFixedTick: postDeathEndFixedTick
            }),
            targetedShot: Object.freeze({
                sourceHandle: Object.freeze({ ...archerHandle }),
                targetHandle: Object.freeze({ ...towerHandle }),
                projectileHandle: Object.freeze({ ...firstProjectileHandle }),
                sourceTickStart: Object.freeze({
                    position: Object.freeze({ ...sourceTickStart.position }),
                    velocity: Object.freeze({ ...sourceTickStart.velocity })
                }),
                targetTickStart: Object.freeze({
                    position: Object.freeze({ ...targetTickStart.position }),
                    velocity: Object.freeze({ ...targetTickStart.velocity })
                }),
                positionOffset: ARCHER_ATTACK_DATA.positionOffset,
                targetOffset: ARCHER_ATTACK_DATA.targetOffset,
                origin: Object.freeze({ ...firstProjectile.previousPosition }),
                integratedPosition:
                    Object.freeze({ ...firstProjectile.position }),
                velocity: Object.freeze({ ...firstProjectile.velocity }),
                expectedOrigin,
                expectedVelocity,
                speed: firstProjectileSpeed,
                launchSpeed: ARCHER_ATTACK_DATA.launchSpeed,
                sourceMovement: Object.freeze({
                    x: sourceAfterFirstShot.position.x
                        - sourceTickStart.position.x,
                    y: sourceAfterFirstShot.position.y
                        - sourceTickStart.position.y
                }),
                targetMovement: Object.freeze({
                    x: targetAfterFirstShot.position.x
                        - targetTickStart.position.x,
                    y: targetAfterFirstShot.position.y
                        - targetTickStart.position.y
                })
            }),
            combat: Object.freeze({
                allegiancePolicy: ARCHER_ATTACK_DATA.allegiancePolicy,
                projectileTeamId: firstProjectileView.metadata.teamId,
                targetPolicyId: firstProjectileView.metadata.targetPolicyId,
                damage: firstDamageContact.damage,
                damageFixedPoint: firstDamageContact.damageFixedPoint,
                penetrationBefore: HOSTILE_BASIC_BULLET_DATA.penetration,
                penetrationAfter: 0,
                projectileDeathCount: observedDeathEvents.filter((event) => (
                    hostileAttackLifecycleHandleMatches(
                        event,
                        firstProjectileHandle
                    )
                )).length,
                towerHpSequence: Object.freeze([...towerHpSequence]),
                producerId: firstDamageFact.producerId,
                sourceAbilityId: firstDamageFact.sourceAbilityId
            }),
            isolation: Object.freeze({
                hostileOnHostile: Object.freeze({
                    damageAppliedCount: hostileProbeDamageEvents.length,
                    interactionCount: hostileProbeInteractionEvents.length,
                    targetHealthBefore: initialHostileProbe.health,
                    targetHealthAfter: hostileProbeAfterBlock.health,
                    penetrationBefore: HOSTILE_BASIC_BULLET_DATA.penetration,
                    penetrationAfter: hostileBlockAfterSpawn.health
                }),
                core: Object.freeze({
                    interactionCount: coreInteractionEvents.length,
                    damageAppliedCount: coreInteractionEvents.filter(
                        ({ eventType }) => eventType === 'damage-applied'
                    ).length,
                    healthBefore: initialCore.health,
                    healthAfter: coreBeforeCleanup.health,
                    healthMutation:
                        coreBeforeCleanup.health - initialCore.health
                })
            }),
            projectileCleanup: Object.freeze({
                terrain: Object.freeze({
                    blockedCell,
                    deathSourceTick: terrainDeath.sourceTick,
                    deathReason: terrainDeath.reason
                }),
                lifetime: Object.freeze({
                    authoredSeconds:
                        HOSTILE_BASIC_BULLET_DATA.lifetimeSeconds,
                    deathSourceTick: lifetimeDeath.sourceTick,
                    deathReason: lifetimeDeath.reason
                })
            }),
            towerDeath: Object.freeze({
                newShotCount: acceptedShotCountAfterTowerDeath
                    - acceptedShotCountAtTowerDeath,
                postDeathStageAttemptCount,
                archerPositionStart: Object.freeze({
                    ...archerAfterTowerDeathStart.position
                }),
                archerPositionAfter: Object.freeze({
                    ...archerAfterTowerDeathSample.position
                }),
                archerFlowDisplacement: archerPostDeathDisplacement,
                livingTowerCount: towerRoster.getLivingTowerCount()
            }),
            pressure: Object.freeze({
                firstShotControlAcceptedCount:
                    firstShotAdvance.commit.fixedCommands.controls.length,
                secondShotControlAcceptedCount:
                    secondShotAdvance.commit.fixedCommands.controls.length,
                lethalBurstControlAcceptedCount:
                    lethalAdvance.commit.fixedCommands.controls.length,
                fixedSubmitCount,
                fixedSubmitsContinued: true,
                recoveryRequired: cleanupStatus.recoveryRequired
            }),
            cleanup: Object.freeze({
                activeCount: cleanupStatus.activeCount,
                reservedCount: cleanupStatus.reservedCount,
                pendingCommandCount: cleanupStatus.pendingCommandCount,
                pendingDestinationCount:
                    cleanupStatus.pendingSourceRelativeDestinationCount,
                pendingBodyCount: gpuCleanupStatus.pendingBodyCount,
                recoveryRequired: cleanupStatus.recoveryRequired
            }),
            diagnostics: Object.freeze({
                cpuDomainSentinelRuntimeBound: false,
                coreIntegrityIdentityPreserved:
                    domainSentinel.coreIntegrity === coreIntegrity,
                coreIntegrityCurrentMutation: coreIntegrity.current
                    - domainSentinelValuesBefore.coreIntegrityCurrent,
                coreIntegrityMaxMutation: coreIntegrity.max
                    - domainSentinelValuesBefore.coreIntegrityMax,
                rewardMutation: domainSentinel.reward
                    - domainSentinelValuesBefore.reward,
                runFailedMutation: domainSentinel.runFailed
                    - domainSentinelValuesBefore.runFailed
            }),
            storageProfile
        });
    } finally {
        towerRoster.destroy();
        director.destroy();
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

function createProductionWaveHostileProjectileIntent(
    sourceHandle,
    position,
    velocity,
    spawnSequence
) {
    return createGpuProjectileSpawnIntent({
        definition: HOSTILE_BASIC_BULLET_DATA,
        position,
        velocity,
        sourceHandle,
        ownerHandle: sourceHandle,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        targetPolicyId:
            PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
        producerId: ARCHER_ATTACK_DATA.producerId,
        sourceAbilityId: ARCHER_ATTACK_DATA.sourceAbilityId,
        spawnSequence
    });
}

function parseProductionWaveHostileCommandId(commandId) {
    const parts = String(commandId).split(':');
    assert(
        parts.length === 9 && parts[0] === 'gpu-hostile-archer-shot',
        `Production-wave hostile command ID가 유효하지 않습니다: ${commandId}`
    );
    const result = Object.freeze({
        sessionGeneration: Number(parts[1]),
        sourceHandle: Object.freeze({
            entityId: Number(parts[2]),
            incarnation: Number(parts[3])
        }),
        targetHandle: Object.freeze({
            entityId: Number(parts[4]),
            incarnation: Number(parts[5])
        }),
        targetFixedTick: Number(parts[6]),
        shotSequence: Number(parts[7]),
        attackDefinitionId: parts[8]
    });
    assert(
        Number.isSafeInteger(result.sessionGeneration)
            && result.sessionGeneration > 0
            && Number.isSafeInteger(result.sourceHandle.entityId)
            && result.sourceHandle.entityId > 0
            && Number.isSafeInteger(result.sourceHandle.incarnation)
            && result.sourceHandle.incarnation > 0
            && Number.isSafeInteger(result.targetHandle.entityId)
            && result.targetHandle.entityId > 0
            && Number.isSafeInteger(result.targetHandle.incarnation)
            && result.targetHandle.incarnation > 0
            && Number.isSafeInteger(result.targetFixedTick)
            && result.targetFixedTick > 0
            && Number.isSafeInteger(result.shotSequence)
            && result.shotSequence >= 0
            && result.attackDefinitionId === ARCHER_ATTACK_DATA.id,
        `Production-wave hostile command provenance가 유효하지 않습니다: ${commandId}`
    );
    return result;
}

async function runProductionHostileAttackProductionWaveHardwareSmoke(device) {
    const context = canvas.getContext('webgpu');
    assert(context, 'Production-wave Archer canvas WebGPU context가 없습니다.');
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
        getState: () => Object.freeze({ ready: true, status: 'ready' }),
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
    const tileMap = createTileMap(CORRIDOR_EIGHT_WAVE_01_DATA.mapId);
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: platformPort
    }, {
        capacity: 128,
        controlCommandCapacity: 2,
        sourceRelativeSpawnCommandCapacity: 4,
        spawnProgramCapacity: 4
    });
    const director = new HostileAttackDirector({ endpoint });
    const waveDirector = new WaveDirector({
        waveDefinition: CORRIDOR_EIGHT_WAVE_01_DATA
    });
    const towerRoster = new TowerCombatRoster({
        maxHp: THE_TOWER_COMBAT_DATA.MAX_HEALTH
    });
    const fixedDelta = 1 / 60;
    const maximumFixedTick = 600;
    const towerPosition = Object.freeze({ x: 3, y: 12 });
    const productionTowerSpawnPosition = Object.freeze({
        ...tileMap.getTowerSpawnPosition()
    });
    const usesProductionTowerSpawnPosition =
        towerPosition.x === productionTowerSpawnPosition.x
        && towerPosition.y === productionTowerSpawnPosition.y;
    const towerRenderCameraScale = 16;
    const towerRenderCenterPixel = Object.freeze({
        x: Math.floor(canvas.width / 2),
        y: Math.floor(canvas.height / 2)
    });
    const towerRenderCenterViewport = Object.freeze({
        x: towerRenderCenterPixel.x + 0.5,
        y: towerRenderCenterPixel.y + 0.5
    });
    const corePosition = tileMap.getCorePosition();
    const cameraTowerFacade = new GpuTowerActorFacade();
    const cameraCorePresentation = {
        active: true,
        position: corePosition
    };
    const towerCoreCameraTarget = new TowerCoreCameraFollowTarget({
        tower: cameraTowerFacade,
        core: cameraCorePresentation,
        towerCombatRoster: towerRoster
    });
    const productionCamera = new WorldCamera2D();
    productionCamera.init(tileMap.getWorldBounds(), {
        ww: canvas.width,
        wh: canvas.height
    });
    productionCamera.zoom = 3;
    const expectedCycle = Object.freeze([
        BASIC_SQUARE_ENEMY_DATA.id,
        BASIC_TRIANGLE_ENEMY_DATA.id,
        BASIC_ARROW_ENEMY_DATA.id,
        BASIC_PENTA_ENEMY_DATA.id,
        BASIC_HEXA_ENEMY_DATA.id,
        BASIC_GEN_ENEMY_DATA.id,
        ARCHER_ENEMY_DATA.id
    ]);
    const expectedArcherSpawnIndexes = Object.freeze([6, 13, 20, 27]);
    const expectedArcherSpawnTicks = Object.freeze([31, 66, 101, 136]);
    const domainSentinel = {
        coreIntegrity: { current: 100, max: 100 },
        gold: 0,
        reward: 0,
        waveCompletion: 0,
        runFailed: 0
    };
    const domainSentinelBefore = JSON.stringify(domainSentinel);
    const observedContactEvents = [];
    const observedDeathEvents = [];
    const towerDamageFacts = [];
    const towerDeathFacts = [];
    const noLivingTowerFacts = [];
    const towerHpTimeline = [THE_TOWER_COMBAT_DATA.MAX_HEALTH];
    const productionSpawnRecords = [];
    const archerRecords = new Map();
    const resolvedShotRecords = [];
    const auxiliaryCommandIds = Object.freeze({
        hostileIsolation: 'production-wave:aux:hostile-isolation',
        coreIsolation: 'production-wave:aux:core-isolation',
        terrain: 'production-wave:aux:terrain',
        lifetime: 'production-wave:aux:lifetime'
    });
    const auxiliaryHandles = new Map();
    let towerHandle = null;
    let coreHandle = null;
    let firstArcherHandle = null;
    let firstTargetedShot = null;
    let firstTargetedShotPending = null;
    let primaryController = null;
    let primaryProjectileHandle = null;
    let primaryProjectileMaterialized = null;
    let primaryShotCommittedCount = 0;
    let firstResolvedArcherPosition = null;
    let initialTowerBody = null;
    let initialCoreBody = null;
    let hostileIsolationBefore = null;
    let hostileIsolationAfter = null;
    let coreIsolationAfter = null;
    let terrainDeath = null;
    let lifetimeDeath = null;
    let towerDeathBoundaryTick = null;
    let towerDeathSourceTick = null;
    let towerAlphaAfterLethal = null;
    let towerRenderExclusion = null;
    let towerPreLethalRenderCapture = null;
    let selectedEnemyRenderBeforeDeath = null;
    let selectedEnemyRenderAfterDeath = null;
    let selectedEnemyRenderAfterThirtyTicks = null;
    let productionCameraBeforeDeath = null;
    let towerDeathCameraFallback = null;
    let towerRemovedAtDeathBoundary = false;
    let trackedDisableReceipt = null;
    let firstArcherAtTowerDeath = null;
    let firstArcherPostDeath = null;
    let postDeathFixedTick = null;
    let fixedSubmitCount = 0;
    let controlRequestCount = 0;
    let controlRequestCountAtTowerDeath = null;
    let playerShotRequestCount = 0;
    let playerShotRequestCountAtTowerDeath = null;
    let acceptedShotCountAtTowerDeath = null;
    let postDeathStageAttemptCount = 0;
    let commitRejectedCount = 0;
    let fixedRejectedCount = 0;
    let peakActiveCount = 0;
    let peakReservedCount = 0;
    let finalObservedFixedTick = 0;
    let cleanup = null;
    let result = null;
    let teardown = null;

    const captureSelectedEnemyRender = async (
        handle,
        body,
        phase,
        renderFrameId
    ) => {
        const cameraScale = 16;
        const viewportCenter = Object.freeze({
            x: Math.floor(canvas.width / 2) + 0.5,
            y: Math.floor(canvas.height / 2) + 0.5
        });
        const viewportOrigin = Object.freeze({
            x: viewportCenter.x - (body.position.x * cameraScale),
            y: viewportCenter.y - (body.position.y * cameraScale)
        });
        const registryView = endpoint.getRegistry().copyEntityView(handle, {});
        assert(
            registryView?.kindId === 'enemy'
                && endpoint.getRegistry().has(handle)
                && endpoint.hasBody(handle),
            `Production-wave selected Enemy exact liveness 실패: ${JSON.stringify({ phase, handle, registryView })}`
        );
        const drawMarksBefore = drawMarks;
        endpoint.updatePresentation({
            frameDelta: 0,
            fixedDelta,
            fixedAlpha: 1,
            renderFrameId
        });
        assert(endpoint.draw({
            worldToViewport(x, y, out) {
                out.x = viewportOrigin.x + (x * cameraScale);
                out.y = viewportOrigin.y + (y * cameraScale);
                return out;
            },
            getScale: () => cameraScale
        }), `Production-wave selected Enemy ${phase} render submit 실패`);
        assert(lastFrameTexture, `Production-wave selected Enemy ${phase} texture가 없습니다.`);
        const alpha = await readPhase5WorldAlpha(
            device,
            lastFrameTexture,
            body.position,
            cameraScale,
            `production-wave-selected-enemy-${phase}-readback`,
            viewportOrigin
        );
        const endpointStatus = endpoint.getStatus();
        const capture = Object.freeze({
            phase,
            handle: Object.freeze({ ...handle }),
            definitionId: registryView.definitionId,
            position: Object.freeze({ ...body.position }),
            viewportCenter,
            viewportOrigin,
            viewBounds: Object.freeze({
                left: (0 - viewportOrigin.x) / cameraScale,
                top: (0 - viewportOrigin.y) / cameraScale,
                right: (canvas.width - viewportOrigin.x) / cameraScale,
                bottom: (canvas.height - viewportOrigin.y) / cameraScale
            }),
            cameraScale,
            drawCount: drawMarks - drawMarksBefore,
            alpha,
            activeEnemyCount: endpointStatus.activeEnemyCount,
            registryHas: endpoint.getRegistry().has(handle),
            backendHas: endpoint.hasBody(handle)
        });
        assert(
            capture.drawCount === 1
                && capture.alpha > 0
                && capture.activeEnemyCount > 0
                && capture.registryHas
                && capture.backendHas,
            `Production-wave selected Enemy ${phase} render/liveness 실패: ${JSON.stringify(capture)}`
        );
        return capture;
    };

    try {
        const phase = CORRIDOR_EIGHT_WAVE_01_DATA.phases[0];
        const group = phase.spawnGroups[0];
        assert(
            phase.startTick === 1
                && phase.durationTicks === 156
                && group.count === 32
                && group.intervalTicks === 5
                && JSON.stringify(group.enemyDefinitionIds)
                    === JSON.stringify(expectedCycle)
                && group.enemyDefinitionId === BASIC_SQUARE_ENEMY_DATA.id
                && !Object.hasOwn(BASIC_ARROW_ENEMY_DATA, 'attackDefinitionId'),
            `Production-wave authored cycle이 정확하지 않습니다: ${JSON.stringify({ phase, group, expectedCycle })}`
        );
        assert(
            waveDirector.init(tileMap),
            'Production-wave WaveDirector init 실패'
        );
        const scheduledArcherEntries = waveDirector.schedule
            .map((entry, spawnIndex) => ({ entry, spawnIndex }))
            .filter(({ entry }) => (
                entry.intent.definitionId === ARCHER_ENEMY_DATA.id
            ));
        assert(
            waveDirector.schedule.length === 32
                && JSON.stringify(scheduledArcherEntries.map(({ spawnIndex }) => (
                    spawnIndex
                ))) === JSON.stringify(expectedArcherSpawnIndexes)
                && JSON.stringify(scheduledArcherEntries.map(({ entry }) => (
                    entry.targetFixedTick
                ))) === JSON.stringify(expectedArcherSpawnTicks)
                && waveDirector.schedule.every((entry, spawnIndex) => (
                    entry.commandId
                        === `corridor_eight_wave_01:0:0:${spawnIndex}`
                )),
            `Production-wave deterministic schedule 불일치: ${JSON.stringify(waveDirector.schedule)}`
        );
        assert(
            endpoint.init(tileMap) === false,
            'Production-wave endpoint는 첫 spawn 전 deferred여야 합니다.'
        );

        for (let tick = 1; tick <= maximumFixedTick; tick++) {
            const completed = endpoint.commitCompletedEventsAtFixedBoundary(tick);
            assert(
                completed.protocolFailure === null,
                `Production-wave completed event protocol 실패: tick=${tick}, result=${JSON.stringify(completed)}`
            );
            observedContactEvents.push(...completed.contactEvents);
            observedDeathEvents.push(...completed.deathEvents);
            const towerFacts = towerRoster.commitCompletedEvents(
                completed,
                endpoint.getRegistry()
            );
            for (const fact of towerFacts) {
                if (fact.type === TOWER_COMBAT_FACT_TYPE.DAMAGE_APPLIED) {
                    towerDamageFacts.push(fact);
                    towerHpTimeline.push(fact.currentHp);
                } else if (fact.type === TOWER_COMBAT_FACT_TYPE.DIED) {
                    towerDeathFacts.push(fact);
                } else if (fact.type
                    === TOWER_COMBAT_FACT_TYPE.NO_LIVING_TOWERS) {
                    noLivingTowerFacts.push(fact);
                }
            }
            const terrainHandle = auxiliaryHandles.get(
                auxiliaryCommandIds.terrain
            );
            if (!terrainDeath && terrainHandle) {
                terrainDeath = observedDeathEvents.find((event) => (
                    hostileAttackLifecycleHandleMatches(event, terrainHandle)
                )) ?? null;
            }
            const lifetimeHandle = auxiliaryHandles.get(
                auxiliaryCommandIds.lifetime
            );
            if (!lifetimeDeath && lifetimeHandle) {
                lifetimeDeath = observedDeathEvents.find((event) => (
                    hostileAttackLifecycleHandleMatches(event, lifetimeHandle)
                )) ?? null;
            }

            if (towerDeathFacts.length > 0 && towerDeathBoundaryTick === null) {
                towerDeathBoundaryTick = tick;
                towerDeathSourceTick = completed.deathEvents.find((event) => (
                    hostileAttackLifecycleHandleMatches(event, towerHandle)
                ))?.sourceTick ?? null;
                controlRequestCountAtTowerDeath = controlRequestCount;
                playerShotRequestCountAtTowerDeath = playerShotRequestCount;
                acceptedShotCountAtTowerDeath = director.getStatus()
                    .shotRequestAcceptedCount;
                assert(
                    primaryController?.deactivateForTowerDeath() === true,
                    'Production-wave Tower death primary controller cutover 실패'
                );
                trackedDisableReceipt = endpoint.configureTrackedBody(null);
                assert(
                    trackedDisableReceipt.accepted
                        && trackedDisableReceipt.tracked === false,
                    `Production-wave Tower tracking 해제 실패: ${JSON.stringify(trackedDisableReceipt)}`
                );
                const deathBodies = await readPhase5Bodies(endpoint);
                firstArcherAtTowerDeath = Object.freeze({
                    ...findPhase5Body(
                        deathBodies,
                        firstArcherHandle,
                        'Production-wave Archer at Tower death'
                    ).position
                });
                assert(
                    towerPreLethalRenderCapture,
                    'Production-wave pre-lethal Tower alpha plane이 없습니다.'
                );
                const towerRadiusPixels = THE_TOWER_DATA.RADIUS_TILES
                    * towerRenderCameraScale;
                const requiredInteriorMarginPixels = 2;
                const maximumOffsetPixels = Math.floor(
                    towerRadiusPixels - requiredInteriorMarginPixels
                );
                let towerRenderSample = null;
                for (let offsetY = -maximumOffsetPixels;
                    offsetY <= maximumOffsetPixels;
                    offsetY++) {
                    for (let offsetX = -maximumOffsetPixels;
                        offsetX <= maximumOffsetPixels;
                        offsetX++) {
                        const distanceFromTowerCenterPixels = Math.hypot(
                            offsetX,
                            offsetY
                        );
                        const towerInteriorMarginPixels = towerRadiusPixels
                            - distanceFromTowerCenterPixels;
                        if (towerInteriorMarginPixels
                            < requiredInteriorMarginPixels) {
                            continue;
                        }
                        const worldPosition = {
                            x: towerPosition.x
                                + (offsetX / towerRenderCameraScale),
                            y: towerPosition.y
                                + (offsetY / towerRenderCameraScale)
                        };
                        let nearestActiveBody = null;
                        let nearestActiveBodyClearance =
                            Number.POSITIVE_INFINITY;
                        for (const body of deathBodies) {
                            const clearance = Math.hypot(
                                body.position.x - worldPosition.x,
                                body.position.y - worldPosition.y
                            ) - body.radius;
                            if (clearance < nearestActiveBodyClearance) {
                                nearestActiveBodyClearance = clearance;
                                nearestActiveBody = body;
                            }
                        }
                        const nearestActiveBodyClearancePixels =
                            nearestActiveBodyClearance
                                * towerRenderCameraScale;
                        if (!towerRenderSample
                            || nearestActiveBodyClearancePixels
                                > towerRenderSample
                                    .nearestActiveBodyClearancePixels) {
                            towerRenderSample = {
                                offsetPixels: { x: offsetX, y: offsetY },
                                worldPosition,
                                towerInteriorMarginPixels,
                                nearestActiveBody,
                                nearestActiveBodyClearance,
                                nearestActiveBodyClearancePixels
                            };
                        }
                    }
                }
                assert(
                    towerRenderSample?.nearestActiveBody
                        && towerRenderSample.towerInteriorMarginPixels
                            >= requiredInteriorMarginPixels
                        && towerRenderSample.nearestActiveBodyClearancePixels
                            >= 2,
                    `Production-wave Tower 내부 render sample을 다른 active body와 분리할 수 없습니다: ${JSON.stringify(towerRenderSample)}`
                );
                const preLethalSamplePixel = Object.freeze({
                    x: towerRenderCenterPixel.x
                        + towerRenderSample.offsetPixels.x,
                    y: towerRenderCenterPixel.y
                        + towerRenderSample.offsetPixels.y
                });
                const preLethalAlpha = towerPreLethalRenderCapture.alphaPlane[
                    (preLethalSamplePixel.y * canvas.width)
                        + preLethalSamplePixel.x
                ];
                assert(
                    towerPreLethalRenderCapture.drawCount === 1
                        && preLethalAlpha > 0,
                    `Production-wave selected Tower sample의 pre-lethal alpha가 없습니다: ${JSON.stringify({ preLethalSamplePixel, preLethalAlpha, towerRenderSample })}`
                );
                const viewportOrigin = Object.freeze({
                    x: towerRenderCenterViewport.x
                        - (towerRenderSample.worldPosition.x
                            * towerRenderCameraScale),
                    y: towerRenderCenterViewport.y
                        - (towerRenderSample.worldPosition.y
                            * towerRenderCameraScale)
                });
                const drawMarksBefore = drawMarks;
                endpoint.updatePresentation({
                    frameDelta: 0,
                    fixedDelta,
                    fixedAlpha: 1,
                    renderFrameId: 91_000 + tick
                });
                assert(endpoint.draw({
                    worldToViewport(x, y, out) {
                        out.x = viewportOrigin.x
                            + (x * towerRenderCameraScale);
                        out.y = viewportOrigin.y
                            + (y * towerRenderCameraScale);
                        return out;
                    },
                    getScale: () => towerRenderCameraScale
                }), 'Production-wave lethal render submit 실패');
                assert(lastFrameTexture, 'Production-wave lethal render texture가 없습니다.');
                towerAlphaAfterLethal = await readPhase5WorldAlpha(
                    device,
                    lastFrameTexture,
                    towerRenderSample.worldPosition,
                    towerRenderCameraScale,
                    'production-wave-tower-lethal-render-readback',
                    viewportOrigin
                );
                towerRenderExclusion = Object.freeze({
                    sampleWorldPosition: Object.freeze({
                        ...towerRenderSample.worldPosition
                    }),
                    sampleOffsetPixels: Object.freeze({
                        ...towerRenderSample.offsetPixels
                    }),
                    towerInteriorMarginPixels:
                        towerRenderSample.towerInteriorMarginPixels,
                    samplePixel: towerRenderCenterPixel,
                    viewportCenter: towerRenderCenterViewport,
                    viewportOrigin,
                    cameraScale: towerRenderCameraScale,
                    nearestActiveBody: Object.freeze({
                        handle: towerRenderSample.nearestActiveBody.handle,
                        position: Object.freeze({
                            ...towerRenderSample.nearestActiveBody.position
                        }),
                        radius: towerRenderSample.nearestActiveBody.radius
                    }),
                    nearestActiveBodyClearance:
                        towerRenderSample.nearestActiveBodyClearance,
                    nearestActiveBodyClearancePixels:
                        towerRenderSample.nearestActiveBodyClearancePixels,
                    preLethal: Object.freeze({
                        boundaryTick:
                            towerPreLethalRenderCapture.boundaryTick,
                        towerHp: towerPreLethalRenderCapture.towerHp,
                        samplePixel: preLethalSamplePixel,
                        drawCount: towerPreLethalRenderCapture.drawCount,
                        alpha: preLethalAlpha
                    }),
                    drawCount: drawMarks - drawMarksBefore,
                    alpha: towerAlphaAfterLethal
                });
                assert(
                    towerRenderExclusion.preLethal.alpha > 0
                        && towerRenderExclusion.drawCount === 1
                        && towerAlphaAfterLethal === 0,
                    `Production-wave dead Tower exact render exclusion 실패: ${JSON.stringify(towerRenderExclusion)}`
                );
                assert(
                    cameraTowerFacade.deactivateForDeath() === true
                        && towerCoreCameraTarget.isCameraFollowEnabled(),
                    'Production-wave Tower death Core camera fallback 활성화 실패'
                );
                const fallbackPosition = towerCoreCameraTarget
                    .copyCameraFollowPositionInto({});
                productionCamera.centerOnWorldPoint(
                    fallbackPosition.x,
                    fallbackPosition.y,
                    1
                );
                const fallbackCenter = productionCamera.viewportToWorld(
                    canvas.width * 0.5,
                    canvas.height * 0.5,
                    {}
                );
                const fallbackViewBounds = {
                    ...productionCamera.getViewBounds()
                };
                towerDeathCameraFallback = Object.freeze({
                    followTargetId: towerCoreCameraTarget.cameraFollowTargetId,
                    position: Object.freeze({ ...fallbackPosition }),
                    center: Object.freeze({ ...fallbackCenter }),
                    viewBounds: Object.freeze(fallbackViewBounds),
                    zoom: productionCamera.getZoom()
                });
                assert(
                    productionCameraBeforeDeath,
                    'Production-wave pre-death production camera snapshot이 없습니다.'
                );
                assertNear(
                    towerDeathCameraFallback.center.x,
                    corePosition.x,
                    0.000001,
                    'Production-wave Tower death camera center.x'
                );
                assertNear(
                    towerDeathCameraFallback.center.y,
                    corePosition.y,
                    0.000001,
                    'Production-wave Tower death camera center.y'
                );
                assert(
                    fallbackViewBounds.left <= corePosition.x
                        && fallbackViewBounds.right >= corePosition.x
                        && fallbackViewBounds.top <= corePosition.y
                        && fallbackViewBounds.bottom >= corePosition.y,
                    `Production-wave Tower death Core camera bounds 실패: ${JSON.stringify(towerDeathCameraFallback)}`
                );
                assert(
                    Math.hypot(
                        towerDeathCameraFallback.center.x
                            - productionCameraBeforeDeath.center.x,
                        towerDeathCameraFallback.center.y
                            - productionCameraBeforeDeath.center.y
                    ) > 0
                        && JSON.stringify(towerDeathCameraFallback.viewBounds)
                            !== JSON.stringify(
                                productionCameraBeforeDeath.viewBounds
                            ),
                    `Production-wave Tower→Core camera 전환 실패: ${JSON.stringify({ productionCameraBeforeDeath, towerDeathCameraFallback })}`
                );
                const selectedEnemyAfterDeath = findPhase5Body(
                    deathBodies,
                    firstArcherHandle,
                    'Production-wave selected Enemy after death'
                );
                selectedEnemyRenderAfterDeath = await captureSelectedEnemyRender(
                    firstArcherHandle,
                    selectedEnemyAfterDeath,
                    'after-death',
                    93_000 + tick
                );
            }

            if (!towerPreLethalRenderCapture
                && towerDeathBoundaryTick === null
                && towerHpTimeline[towerHpTimeline.length - 1] === 5) {
                assert(
                    towerRoster.isPrimaryTowerAlive(),
                    'Production-wave pre-lethal render에서 Tower가 살아 있지 않습니다.'
                );
                const viewportOrigin = Object.freeze({
                    x: towerRenderCenterViewport.x
                        - (towerPosition.x * towerRenderCameraScale),
                    y: towerRenderCenterViewport.y
                        - (towerPosition.y * towerRenderCameraScale)
                });
                const drawMarksBefore = drawMarks;
                endpoint.updatePresentation({
                    frameDelta: 0,
                    fixedDelta,
                    fixedAlpha: 1,
                    renderFrameId: 90_000 + tick
                });
                assert(endpoint.draw({
                    worldToViewport(x, y, out) {
                        out.x = viewportOrigin.x
                            + (x * towerRenderCameraScale);
                        out.y = viewportOrigin.y
                            + (y * towerRenderCameraScale);
                        return out;
                    },
                    getScale: () => towerRenderCameraScale
                }), 'Production-wave pre-lethal render submit 실패');
                assert(
                    lastFrameTexture,
                    'Production-wave pre-lethal render texture가 없습니다.'
                );
                const alphaPlane = await readPhase5CanvasAlphaPlane(
                    device,
                    lastFrameTexture,
                    'production-wave-tower-pre-lethal-render-readback'
                );
                towerPreLethalRenderCapture = Object.freeze({
                    boundaryTick: tick,
                    towerHp: towerHpTimeline[towerHpTimeline.length - 1],
                    viewportOrigin,
                    cameraScale: towerRenderCameraScale,
                    drawCount: drawMarks - drawMarksBefore,
                    alphaPlane
                });
                assert(
                    towerPreLethalRenderCapture.drawCount === 1,
                    `Production-wave pre-lethal draw count 불일치: ${JSON.stringify({ drawMarksBefore, drawMarks })}`
                );
                productionCamera.centerOnWorldPoint(
                    productionTowerSpawnPosition.x,
                    productionTowerSpawnPosition.y,
                    1
                );
                const productionCameraCenterBeforeDeath =
                    productionCamera.viewportToWorld(
                        canvas.width * 0.5,
                        canvas.height * 0.5,
                        {}
                    );
                const productionCameraViewBoundsBeforeDeath = {
                    ...productionCamera.getViewBounds()
                };
                productionCameraBeforeDeath = Object.freeze({
                    authority: 'production-tower-spawn',
                    position: Object.freeze({
                        ...productionTowerSpawnPosition
                    }),
                    center: Object.freeze({
                        ...productionCameraCenterBeforeDeath
                    }),
                    viewBounds: Object.freeze(
                        productionCameraViewBoundsBeforeDeath
                    ),
                    zoom: productionCamera.getZoom()
                });
                assertNear(
                    productionCameraBeforeDeath.center.x,
                    productionTowerSpawnPosition.x,
                    0.000001,
                    'Production-wave pre-death camera center.x'
                );
                assertNear(
                    productionCameraBeforeDeath.center.y,
                    productionTowerSpawnPosition.y,
                    0.000001,
                    'Production-wave pre-death camera center.y'
                );
                assert(
                    productionCameraViewBoundsBeforeDeath.left
                            <= productionTowerSpawnPosition.x
                        && productionCameraViewBoundsBeforeDeath.right
                            >= productionTowerSpawnPosition.x
                        && productionCameraViewBoundsBeforeDeath.top
                            <= productionTowerSpawnPosition.y
                        && productionCameraViewBoundsBeforeDeath.bottom
                            >= productionTowerSpawnPosition.y,
                    `Production-wave pre-death Tower camera bounds 실패: ${JSON.stringify(productionCameraBeforeDeath)}`
                );
                const selectedEnemyBodies = await readPhase5Bodies(endpoint);
                const selectedEnemy = findPhase5Body(
                    selectedEnemyBodies,
                    firstArcherHandle,
                    'Production-wave selected Enemy pre-death'
                );
                selectedEnemyRenderBeforeDeath = await captureSelectedEnemyRender(
                    firstArcherHandle,
                    selectedEnemy,
                    'before-death',
                    92_000 + tick
                );
            }

            const completedObservation = director.observeCompletedEvents(completed);
            assert(
                !completedObservation.recoveryRequired,
                `Production-wave Director completed observation 실패: tick=${tick}, result=${JSON.stringify(completedObservation)}`
            );
            const queuedWaveSpawnCount = waveDirector.queueSpawnsForFixedTick(
                tick,
                endpoint
            );
            if (tick === 1) {
                const actorRequests = [
                    endpoint.requestSpawn(
                        createGpuTowerSpawnIntent({ position: towerPosition }),
                        tick,
                        'production-wave:actor:tower'
                    ),
                    endpoint.requestSpawn(
                        createGpuCoreProxySpawnIntent({ position: corePosition }),
                        tick,
                        'production-wave:actor:core'
                    )
                ];
                assert(
                    queuedWaveSpawnCount === 1
                        && actorRequests.every(({ accepted }) => accepted),
                    `Production-wave initial actor request 실패: ${JSON.stringify(actorRequests)}`
                );
            }

            if (tick === 32) {
                assert(firstArcherHandle, 'Production-wave tick 32 Archer가 없습니다.');
                const bodiesBeforeAuxiliary = await readPhase5Bodies(endpoint);
                const ordinaryEnemyHandle = endpoint.getRegistry()
                    .copyActiveHandlesInto([], { kindId: 'enemy' })
                    .find((handle) => (
                        !hostileAttackLifecycleHandleMatches(
                            handle,
                            firstArcherHandle
                        )
                    ));
                const ordinaryEnemy = findPhase5Body(
                    bodiesBeforeAuxiliary,
                    ordinaryEnemyHandle,
                    'Production-wave hostile-isolation target'
                );
                const coreBody = findPhase5Body(
                    bodiesBeforeAuxiliary,
                    coreHandle,
                    'Production-wave Core isolation target'
                );
                hostileIsolationBefore = Object.freeze({
                    targetHandle: Object.freeze({ ...ordinaryEnemyHandle }),
                    targetHealth: ordinaryEnemy.health
                });
                const requests = [
                    [
                        auxiliaryCommandIds.hostileIsolation,
                        createProductionWaveHostileProjectileIntent(
                            firstArcherHandle,
                            ordinaryEnemy.position,
                            ordinaryEnemy.velocity,
                            1_000
                        )
                    ],
                    [
                        auxiliaryCommandIds.coreIsolation,
                        createProductionWaveHostileProjectileIntent(
                            firstArcherHandle,
                            coreBody.position,
                            { x: 0, y: 0 },
                            1_001
                        )
                    ],
                    [
                        auxiliaryCommandIds.terrain,
                        createProductionWaveHostileProjectileIntent(
                            firstArcherHandle,
                            { x: 5.5, y: 3 },
                            { x: 12, y: 0 },
                            1_002
                        )
                    ],
                    [
                        auxiliaryCommandIds.lifetime,
                        createProductionWaveHostileProjectileIntent(
                            firstArcherHandle,
                            { x: 3, y: 15.5 },
                            { x: 0, y: 0 },
                            1_003
                        )
                    ]
                ].map(([commandId, intent]) => ({
                    commandId,
                    receipt: endpoint.requestSpawn(intent, tick, commandId)
                }));
                assert(
                    requests.every(({ receipt }) => receipt.accepted),
                    `Production-wave auxiliary projectile request 실패: ${JSON.stringify(requests)}`
                );
            }

            const liveTowerTarget = towerRoster.isPrimaryTowerAlive()
                && towerHandle
                && endpoint.getRegistry().has(towerHandle)
                && endpoint.hasBody(towerHandle)
                ? towerHandle
                : null;
            let controlReceipt = null;
            if (liveTowerTarget) {
                controlReceipt = endpoint.requestBodyControl({
                    handle: towerHandle,
                    moveIntentX: 0,
                    moveIntentY: 0
                }, tick, `production-wave:tower-control:${tick}`);
                assert(
                    controlReceipt.accepted,
                    `Production-wave Tower control request 실패: tick=${tick}`
                );
                controlRequestCount++;
            }
            if (tick === 2) {
                assert(
                    primaryController?.handlePlayerAction({
                        type: PLAYER_ACTION_TYPES.PRIMARY_POINTER_FIRE,
                        payload: {
                            pressed: true,
                            viewportX: 5.5,
                            viewportY: 12
                        }
                    }) === 'consumed',
                    'Production-wave pre-death LMB semantic action 실패'
                );
            }
            const primaryShotReceipt = primaryController
                ?.stageShotForFixedTick(tick) ?? null;
            if (primaryShotReceipt?.accepted === true) {
                playerShotRequestCount++;
            }
            if (towerDeathBoundaryTick !== null) {
                assert(
                    primaryShotReceipt === null,
                    `Production-wave Tower death 후 LMB shot이 stage됐습니다: ${JSON.stringify(primaryShotReceipt)}`
                );
            }
            const directorBeforeStage = director.getStatus();
            let tickStartBodies = null;
            if (liveTowerTarget && directorBeforeStage.archers.some((record) => (
                record.state === 'IDLE'
                    && record.nextEligibleFixedTick <= tick
            ))) {
                tickStartBodies = await readPhase5Bodies(endpoint);
            }
            const stage = director.stageForFixedTick({
                targetFixedTick: tick,
                targetHandle: liveTowerTarget
            });
            assert(
                !stage.recoveryRequired,
                `Production-wave hostile stage recovery: tick=${tick}, result=${JSON.stringify(stage)}`
            );
            if (towerDeathBoundaryTick !== null) {
                postDeathStageAttemptCount += stage.attemptedCount;
            }
            const commit = endpoint.commitAtFixedBoundary(tick);
            commitRejectedCount += commit.rejected.length;
            fixedRejectedCount += commit.fixedCommands?.rejected?.length ?? 0;
            assert(
                !commit.recoveryRequired
                    && commit.rejected.length === 0
                    && commit.fixedCommands
                    && commit.fixedCommands.rejected.length === 0,
                `Production-wave lifecycle/fixed commit 실패: tick=${tick}, result=${JSON.stringify(commit)}`
            );

            if (tick === 1) {
                const initialHandles = new Map(
                    commit.spawned.map(({ commandId, handle }) => (
                        [commandId, handle]
                    ))
                );
                towerHandle = initialHandles.get('production-wave:actor:tower');
                coreHandle = initialHandles.get('production-wave:actor:core');
                assert(
                    towerHandle && coreHandle,
                    `Production-wave initial actor handle 누락: ${JSON.stringify(commit)}`
                );
                towerRoster.bindGpuBody(
                    towerHandle,
                    readHostileAttackLifecycleProtocol(endpoint)
                );
                cameraTowerFacade.bindGpuBody(
                    towerHandle,
                    endpoint.getStatus().sessionGeneration
                );
                assert(
                    endpoint.configureTrackedBody(towerHandle).accepted,
                    'Production-wave Tower tracking bind 실패'
                );
                const towerFacade = {
                    getGpuBodyHandle() {
                        return towerRoster.isPrimaryTowerAlive()
                            ? towerHandle
                            : null;
                    },
                    getStatus() {
                        return {
                            sessionGeneration:
                                endpoint.getStatus().sessionGeneration
                        };
                    }
                };
                primaryController = new GpuPrimaryProjectileController({
                    tower: towerFacade,
                    camera: {
                        viewportToWorld(viewportX, viewportY, out) {
                            out.x = viewportX;
                            out.y = viewportY;
                            return out;
                        }
                    },
                    endpoint
                });
            }
            if (controlReceipt) {
                assert(
                    commit.fixedCommands.controls.filter(({ commandId }) => (
                        commandId === controlReceipt.commandId
                    )).length === 1,
                    `Production-wave Tower control commit 누락: tick=${tick}`
                );
            }
            if (primaryShotReceipt?.accepted === true) {
                const committedPrimary = primaryController.finalizeFixedCommit(
                    commit.fixedCommands,
                    tick
                );
                const primarySpawn = commit.fixedCommands
                    .sourceRelativeSpawns.find(({ commandId }) => (
                        commandId === primaryShotReceipt.commandId
                    ));
                assert(
                    committedPrimary && primarySpawn,
                    `Production-wave pre-death LMB fixed commit 실패: ${JSON.stringify({ primaryShotReceipt, commit })}`
                );
                primaryShotCommittedCount++;
                primaryProjectileHandle = Object.freeze({
                    ...primarySpawn.handle
                });
                assert(
                    primaryController.handlePlayerAction({
                        type: PLAYER_ACTION_TYPES.PRIMARY_POINTER_FIRE,
                        payload: {
                            pressed: false,
                            viewportX: 5.5,
                            viewportY: 12
                        }
                    }) === 'consumed',
                    'Production-wave pre-death LMB release 실패'
                );
            }

            const commitObservation = director.observeFixedCommit(commit, tick);
            assert(
                !commitObservation.recoveryRequired,
                `Production-wave Director fixed observation 실패: tick=${tick}, result=${JSON.stringify(commitObservation)}`
            );
            const scheduledByCommandId = new Map(
                waveDirector.schedule.map((entry, spawnIndex) => (
                    [entry.commandId, { entry, spawnIndex }]
                ))
            );
            const spawnedArchersThisTick = [];
            for (const spawned of commit.spawned) {
                if (Object.values(auxiliaryCommandIds).includes(
                    spawned.commandId
                )) {
                    auxiliaryHandles.set(spawned.commandId, spawned.handle);
                }
                const scheduled = scheduledByCommandId.get(spawned.commandId);
                if (!scheduled) {
                    continue;
                }
                const view = endpoint.getRegistry().copyEntityView(
                    spawned.handle,
                    {}
                );
                productionSpawnRecords.push(Object.freeze({
                    spawnIndex: scheduled.spawnIndex,
                    targetFixedTick: scheduled.entry.targetFixedTick,
                    commandId: spawned.commandId,
                    definitionId: view.definitionId,
                    handle: Object.freeze({ ...spawned.handle })
                }));
                if (view.definitionId === ARCHER_ENEMY_DATA.id) {
                    spawnedArchersThisTick.push(spawned.handle);
                    firstArcherHandle ??= Object.freeze({ ...spawned.handle });
                    const status = director.getStatus().archers.find((record) => (
                        hostileAttackLifecycleHandleMatches(
                            record,
                            spawned.handle
                        )
                    ));
                    const expectedPhaseOffset = computeHostileAttackPhaseOffset({
                        ...spawned.handle,
                        phaseSpreadTicks: ARCHER_ATTACK_DATA.phaseSpreadTicks
                    });
                    assert(
                        status
                            && status.createdAtTick === tick
                            && status.phaseOffsetTicks === expectedPhaseOffset
                            && status.nextEligibleFixedTick === tick
                                + ARCHER_ATTACK_DATA.initialDelayTicks
                                + expectedPhaseOffset,
                        `Production-wave Archer deterministic registration 실패: ${JSON.stringify({ spawned, status })}`
                    );
                    archerRecords.set(hostileAttackLifecycleHandleKey(spawned.handle), {
                        handle: Object.freeze({ ...spawned.handle }),
                        spawnIndex: scheduled.spawnIndex,
                        createdAtTick: tick,
                        phaseOffsetTicks: expectedPhaseOffset,
                        firstEligibleFixedTick: status.nextEligibleFixedTick,
                        positionAfterSpawnFixed: null,
                        resolvedShots: []
                    });
                }
            }
            for (const completion of commit.fixedCommands.completed) {
                if (completion.outcome !== 'resolved'
                    || !String(completion.commandId).startsWith(
                        'gpu-hostile-archer-shot:'
                    )) {
                    continue;
                }
                const parsed = parseProductionWaveHostileCommandId(
                    completion.commandId
                );
                const archerRecord = archerRecords.get(
                    hostileAttackLifecycleHandleKey(parsed.sourceHandle)
                );
                assert(
                    archerRecord
                        && Number.isSafeInteger(completion.handle?.entityId)
                        && completion.handle.entityId > 0
                        && Number.isSafeInteger(
                            completion.handle?.incarnation
                        )
                        && completion.handle.incarnation > 0,
                    `Production-wave resolved shot source가 roster에 없습니다: ${JSON.stringify(completion)}`
                );
                const resolvedRecord = Object.freeze({
                    commandId: completion.commandId,
                    sourceHandle: parsed.sourceHandle,
                    targetHandle: parsed.targetHandle,
                    projectileHandle: Object.freeze({ ...completion.handle }),
                    targetFixedTick: parsed.targetFixedTick,
                    completionBoundaryTick: tick,
                    shotSequence: parsed.shotSequence
                });
                archerRecord.resolvedShots.push(resolvedRecord);
                resolvedShotRecords.push(resolvedRecord);
                if (!firstTargetedShot
                    && completion.commandId
                        === firstTargetedShotPending?.commandId) {
                    const projectileView = endpoint.getRegistry()
                        .copyEntityView(completion.handle, {});
                    const materialized = firstTargetedShotPending.materialized;
                    assert(
                        materialized
                            && projectileView?.metadata?.teamId
                                === GAMEPLAY_TEAM_ID.HOSTILE
                            && projectileView.metadata.targetPolicyId
                                === PROJECTILE_TARGET_POLICY_ID
                                    .PLAYER_DAMAGEABLE_AND_TERRAIN
                            && projectileView.metadata.sourceEntityId
                                === parsed.sourceHandle.entityId
                            && projectileView.metadata.sourceIncarnation
                                === parsed.sourceHandle.incarnation
                            && projectileView.metadata.targetEntityId
                                === towerHandle.entityId
                            && projectileView.metadata.targetIncarnation
                                === towerHandle.incarnation,
                        `Production-wave targeted projectile completion provenance 실패: ${JSON.stringify({ completion, projectileView, materialized })}`
                    );
                    firstTargetedShot = Object.freeze({
                        commandId: firstTargetedShotPending.commandId,
                        sourceHandle: parsed.sourceHandle,
                        targetHandle: parsed.targetHandle,
                        projectileHandle: Object.freeze({
                            ...completion.handle
                        }),
                        targetFixedTick: parsed.targetFixedTick,
                        completionBoundaryTick: tick,
                        sourceTickStart:
                            firstTargetedShotPending.sourceTickStart,
                        targetTickStart:
                            firstTargetedShotPending.targetTickStart,
                        origin: materialized.origin,
                        velocity: materialized.velocity,
                        speed: materialized.speed,
                        launchSpeed: ARCHER_ATTACK_DATA.launchSpeed,
                        projectileTeamId: projectileView.metadata.teamId,
                        targetPolicyId: projectileView.metadata.targetPolicyId
                    });
                }
                if (!firstResolvedArcherPosition
                    && hostileAttackLifecycleHandleMatches(
                        parsed.sourceHandle,
                        firstArcherHandle
                    )) {
                    firstResolvedArcherPosition = 'pending-readback';
                }
            }

            if (!firstTargetedShotPending && stage.commandIds.length > 0) {
                const commandId = stage.commandIds[0];
                const parsed = parseProductionWaveHostileCommandId(commandId);
                const spawnEntry = commit.fixedCommands.sourceRelativeSpawns
                    .find((entry) => entry.commandId === commandId);
                const sourceTickStart = findPhase5Body(
                    tickStartBodies,
                    parsed.sourceHandle,
                    'Production-wave targeted source tick-start'
                );
                const targetTickStart = findPhase5Body(
                    tickStartBodies,
                    parsed.targetHandle,
                    'Production-wave targeted Tower tick-start'
                );
                assert(
                    spawnEntry
                        && hostileAttackLifecycleHandleMatches(
                            parsed.targetHandle,
                            towerHandle
                        ),
                    `Production-wave targeted fixed acceptance 실패: ${JSON.stringify({ stage, commit })}`
                );
                firstTargetedShotPending = {
                    commandId,
                    parsed,
                    projectileHandle: Object.freeze({ ...spawnEntry.handle }),
                    sourceTickStart: Object.freeze({
                        position: Object.freeze({ ...sourceTickStart.position }),
                        velocity: Object.freeze({ ...sourceTickStart.velocity })
                    }),
                    targetTickStart: Object.freeze({
                        position: Object.freeze({ ...targetTickStart.position }),
                        velocity: Object.freeze({ ...targetTickStart.velocity })
                    })
                };
            }

            if (towerDeathBoundaryTick !== null) {
                towerRemovedAtDeathBoundary = !endpoint.getRegistry().has(
                    towerHandle
                ) && !endpoint.hasBody(towerHandle);
            }
            assert(
                endpoint.fixedUpdate(fixedDelta, tick),
                `Production-wave fixed submit 실패: tick=${tick}`
            );
            fixedSubmitCount++;
            await settlePhase5Endpoint(
                endpoint,
                `Production-wave fixed tick ${tick}`,
                {
                    spawnProgram:
                        commit.fixedCommands.sourceRelativeSpawns.length > 0
                }
            );
            finalObservedFixedTick = tick;

            const endpointStatus = endpoint.getStatus();
            peakActiveCount = Math.max(
                peakActiveCount,
                endpointStatus.activeCount
            );
            peakReservedCount = Math.max(
                peakReservedCount,
                endpointStatus.reservedCount
            );
            assert(
                !endpointStatus.recoveryRequired
                    && !director.requiresRecovery(),
                `Production-wave normal load가 recovery를 요구합니다: tick=${tick}, status=${JSON.stringify({ endpointStatus, director: director.getStatus() })}`
            );

            if (tick === 1) {
                const initialBodies = await readPhase5Bodies(endpoint);
                initialTowerBody = Object.freeze({
                    ...findPhase5Body(
                        initialBodies,
                        towerHandle,
                        'Production-wave initial Tower'
                    )
                });
                initialCoreBody = Object.freeze({
                    ...findPhase5Body(
                        initialBodies,
                        coreHandle,
                        'Production-wave initial Core'
                    )
                });
                assert(
                    initialTowerBody.health
                        === THE_TOWER_COMBAT_DATA.MAX_HEALTH,
                    `Production-wave Tower initial HP 불일치: ${JSON.stringify(initialTowerBody)}`
                );
            }
            if (tick === 2) {
                const bodiesAfterPrimaryShot = await readPhase5Bodies(endpoint);
                const primaryProjectile = findPhase5Body(
                    bodiesAfterPrimaryShot,
                    primaryProjectileHandle,
                    'Production-wave pre-death LMB Basic Bullet'
                );
                primaryProjectileMaterialized = Object.freeze({
                    commandId: primaryShotReceipt.commandId,
                    targetFixedTick: tick,
                    handle: primaryProjectileHandle,
                    previousPosition: Object.freeze({
                        ...primaryProjectile.previousPosition
                    }),
                    velocity: Object.freeze({ ...primaryProjectile.velocity }),
                    speed: Math.hypot(
                        primaryProjectile.velocity.x,
                        primaryProjectile.velocity.y
                    )
                });
                assert(
                    playerShotRequestCount === 1
                        && primaryShotCommittedCount === 1
                        && primaryProjectileMaterialized.speed > 0,
                    `Production-wave pre-death LMB materialization 실패: ${JSON.stringify(primaryProjectileMaterialized)}`
                );
                assertNear(
                    primaryProjectileMaterialized.previousPosition.x,
                    initialTowerBody.position.x
                        + BASIC_BULLET_WEAPON_DATA.positionOffsetTiles,
                    0.00005,
                    'Production-wave pre-death LMB origin.x'
                );
                assertNear(
                    primaryProjectileMaterialized.previousPosition.y,
                    initialTowerBody.position.y,
                    0.00005,
                    'Production-wave pre-death LMB origin.y'
                );
                assertNear(
                    primaryProjectileMaterialized.velocity.x,
                    BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
                    0.00005,
                    'Production-wave pre-death LMB velocity.x'
                );
                assertNear(
                    primaryProjectileMaterialized.velocity.y,
                    0,
                    0.00005,
                    'Production-wave pre-death LMB velocity.y'
                );
            }
            if (spawnedArchersThisTick.length > 0) {
                const bodiesAfterArcherSpawn = await readPhase5Bodies(endpoint);
                for (const handle of spawnedArchersThisTick) {
                    const record = archerRecords.get(
                        hostileAttackLifecycleHandleKey(handle)
                    );
                    record.positionAfterSpawnFixed = Object.freeze({
                        ...findPhase5Body(
                            bodiesAfterArcherSpawn,
                            handle,
                            'Production-wave spawned Archer'
                        ).position
                    });
                }
            }
            if (tick === 32) {
                const bodiesAfterAuxiliary = await readPhase5Bodies(endpoint);
                const hostileTargetAfter = findPhase5Body(
                    bodiesAfterAuxiliary,
                    hostileIsolationBefore.targetHandle,
                    'Production-wave hostile target after isolation probe'
                );
                const hostileBulletAfter = findPhase5Body(
                    bodiesAfterAuxiliary,
                    auxiliaryHandles.get(auxiliaryCommandIds.hostileIsolation),
                    'Production-wave hostile-isolation Bullet'
                );
                const coreAfter = findPhase5Body(
                    bodiesAfterAuxiliary,
                    coreHandle,
                    'Production-wave Core after isolation probe'
                );
                const coreBulletAfter = findPhase5Body(
                    bodiesAfterAuxiliary,
                    auxiliaryHandles.get(auxiliaryCommandIds.coreIsolation),
                    'Production-wave Core-isolation Bullet'
                );
                hostileIsolationAfter = Object.freeze({
                    targetHealth: hostileTargetAfter.health,
                    projectilePenetration: hostileBulletAfter.health
                });
                coreIsolationAfter = Object.freeze({
                    coreHealth: coreAfter.health,
                    projectilePenetration: coreBulletAfter.health
                });
            }
            if (firstTargetedShotPending
                && !firstTargetedShotPending.materialized) {
                const bodiesAfterShot = await readPhase5Bodies(endpoint);
                const projectile = findPhase5Body(
                    bodiesAfterShot,
                    firstTargetedShotPending.projectileHandle,
                    'Production-wave first targeted Bullet'
                );
                const aimX = firstTargetedShotPending.targetTickStart.position.x
                    + ARCHER_ATTACK_DATA.targetOffset.x
                    - firstTargetedShotPending.sourceTickStart.position.x
                    - ARCHER_ATTACK_DATA.positionOffset.x;
                const aimY = firstTargetedShotPending.targetTickStart.position.y
                    + ARCHER_ATTACK_DATA.targetOffset.y
                    - firstTargetedShotPending.sourceTickStart.position.y
                    - ARCHER_ATTACK_DATA.positionOffset.y;
                const aimLength = Math.hypot(aimX, aimY);
                const expectedOrigin = Object.freeze({
                    x: firstTargetedShotPending.sourceTickStart.position.x
                        + ARCHER_ATTACK_DATA.positionOffset.x,
                    y: firstTargetedShotPending.sourceTickStart.position.y
                        + ARCHER_ATTACK_DATA.positionOffset.y
                });
                const expectedVelocity = Object.freeze({
                    x: (aimX / aimLength) * ARCHER_ATTACK_DATA.launchSpeed,
                    y: (aimY / aimLength) * ARCHER_ATTACK_DATA.launchSpeed
                });
                assertNear(
                    projectile.previousPosition.x,
                    expectedOrigin.x,
                    0.00005,
                    'Production-wave targeted origin.x'
                );
                assertNear(
                    projectile.previousPosition.y,
                    expectedOrigin.y,
                    0.00005,
                    'Production-wave targeted origin.y'
                );
                assertNear(
                    projectile.velocity.x,
                    expectedVelocity.x,
                    0.00005,
                    'Production-wave targeted velocity.x'
                );
                assertNear(
                    projectile.velocity.y,
                    expectedVelocity.y,
                    0.00005,
                    'Production-wave targeted velocity.y'
                );
                assertNear(
                    Math.hypot(projectile.velocity.x, projectile.velocity.y),
                    ARCHER_ATTACK_DATA.launchSpeed,
                    0.00005,
                    'Production-wave targeted speed'
                );
                firstTargetedShotPending.materialized = Object.freeze({
                    origin: Object.freeze({ ...projectile.previousPosition }),
                    velocity: Object.freeze({ ...projectile.velocity }),
                    speed: Math.hypot(
                        projectile.velocity.x,
                        projectile.velocity.y
                    )
                });
            }
            if (firstResolvedArcherPosition === 'pending-readback') {
                const bodiesAfterFirstResolved = await readPhase5Bodies(endpoint);
                firstResolvedArcherPosition = Object.freeze({
                    ...findPhase5Body(
                        bodiesAfterFirstResolved,
                        firstArcherHandle,
                        'Production-wave first Archer after resolved attack'
                    ).position
                });
            }
            if (towerDeathBoundaryTick !== null
                && tick === towerDeathBoundaryTick + 30) {
                const postDeathBodies = await readPhase5Bodies(endpoint);
                firstArcherPostDeath = Object.freeze({
                    ...findPhase5Body(
                        postDeathBodies,
                        firstArcherHandle,
                        'Production-wave first Archer post-death'
                    ).position
                });
                const selectedEnemyPostDeath = findPhase5Body(
                    postDeathBodies,
                    firstArcherHandle,
                    'Production-wave selected Enemy post-death render'
                );
                selectedEnemyRenderAfterThirtyTicks =
                    await captureSelectedEnemyRender(
                        firstArcherHandle,
                        selectedEnemyPostDeath,
                        'after-30-ticks',
                        94_000 + tick
                    );
                postDeathFixedTick = tick;
            }

            const repeatedResolved = Array.from(archerRecords.values())
                .some(({ resolvedShots }) => (
                    resolvedShots.length >= 2
                        && resolvedShots[1].targetFixedTick
                            - resolvedShots[0].targetFixedTick
                            === ARCHER_ATTACK_DATA.intervalTicks
                ));
            if (towerDeathBoundaryTick !== null
                && tick >= towerDeathBoundaryTick + 30
                && waveDirector.getStatus().allSpawnsQueued
                && terrainDeath
                && lifetimeDeath
                && repeatedResolved
                && director.getStatus().pendingShotCount === 0) {
                break;
            }
        }

        const waveStatus = waveDirector.getStatus();
        const directorStatus = director.getStatus();
        const endpointStatusBeforeCleanup = endpoint.getStatus();
        const bodiesBeforeCleanup = await readPhase5Bodies(endpoint);
        const coreBeforeCleanup = findPhase5Body(
            bodiesBeforeCleanup,
            coreHandle,
            'Production-wave final Core'
        );
        const firstArcherRecord = archerRecords.get(
            hostileAttackLifecycleHandleKey(firstArcherHandle)
        );
        const repeatedArcherRecord = Array.from(archerRecords.values())
            .find(({ resolvedShots }) => resolvedShots.length >= 2);
        const hostileIsolationDamageEvents = observedContactEvents.filter((event) => (
            hostileAttackLifecyclePairMatches(
                event,
                auxiliaryHandles.get(auxiliaryCommandIds.hostileIsolation),
                hostileIsolationBefore.targetHandle
            )
            && event.eventType === 'damage-applied'
        ));
        const coreIsolationEvents = observedContactEvents.filter((event) => (
            hostileAttackLifecyclePairMatches(
                event,
                auxiliaryHandles.get(auxiliaryCommandIds.coreIsolation),
                coreHandle
            )
        ));
        const firstDamageContact = observedContactEvents.find((event) => (
            firstTargetedShot
                && hostileAttackLifecyclePairMatches(
                    event,
                    firstTargetedShot.projectileHandle,
                    towerHandle
                )
                && event.eventType === 'damage-applied'
        ));
        const firstDamageFact = towerDamageFacts.find((fact) => (
            firstTargetedShot
                && hostileAttackLifecycleHandleMatches(
                    fact.sourceHandle,
                    firstTargetedShot.projectileHandle
                )
        ));
        const archerFlowBeforeAttack = firstArcherRecord.positionAfterSpawnFixed;
        const archerFlowThroughAttack = Object.freeze({
            x: firstResolvedArcherPosition.x - archerFlowBeforeAttack.x,
            y: firstResolvedArcherPosition.y - archerFlowBeforeAttack.y
        });
        const archerPostDeathDisplacement = Object.freeze({
            x: firstArcherPostDeath.x - firstArcherAtTowerDeath.x,
            y: firstArcherPostDeath.y - firstArcherAtTowerDeath.y
        });
        const primaryControllerStatusAfterDeath = primaryController.getStatus();
        assert(
            productionSpawnRecords.length === 32
                && archerRecords.size === 4
                && JSON.stringify(Array.from(
                    archerRecords.values(),
                    ({ spawnIndex }) => spawnIndex
                )) === JSON.stringify(expectedArcherSpawnIndexes)
                && JSON.stringify(Array.from(
                    archerRecords.values(),
                    ({ createdAtTick }) => createdAtTick
                )) === JSON.stringify(expectedArcherSpawnTicks)
                && waveStatus.totalSpawnCount === 32
                && waveStatus.queuedSpawnCount === 32
                && waveStatus.remainingSpawnCount === 0
                && directorStatus.activeArcherCount === 4,
            `Production-wave 32/4 lifecycle 결과 불일치: ${JSON.stringify({ productionSpawnRecords, archers: Array.from(archerRecords.values()), waveStatus })}`
        );
        assert(
            playerShotRequestCount === 1
                && primaryShotCommittedCount === 1
                && primaryProjectileMaterialized
                && hostileAttackLifecycleHandleMatches(
                    primaryProjectileMaterialized.handle,
                    primaryProjectileHandle
                )
                && playerShotRequestCountAtTowerDeath === 1
                && primaryControllerStatusAfterDeath.enabled === false
                && primaryControllerStatusAfterDeath.primaryPressed === false
                && primaryControllerStatusAfterDeath.pendingShot === null
                && primaryController.isControlEnabled() === false,
            `Production-wave actual LMB/death cutover 실패: ${JSON.stringify({ playerShotRequestCount, primaryShotCommittedCount, primaryProjectileMaterialized, playerShotRequestCountAtTowerDeath, primaryControllerStatusAfterDeath })}`
        );
        assert(
            firstTargetedShot
                && firstTargetedShot.completionBoundaryTick
                    === firstTargetedShot.targetFixedTick + 1
                && firstDamageContact?.damage === 5
                && firstDamageContact.damageFixedPoint === 500
                && firstDamageFact?.damage === 5
                && firstDamageFact.damageFixedPoint === 500
                && JSON.stringify(towerHpTimeline)
                    === JSON.stringify([30, 25, 20, 15, 10, 5, 0])
                && towerDeathFacts.length === 1
                && noLivingTowerFacts.length === 1
                && towerRoster.getLivingTowerCount() === 0
                && !towerRoster.isPrimaryTowerAlive()
                && towerDeathSourceTick !== null
                && towerDeathBoundaryTick === towerDeathSourceTick + 1
                && towerAlphaAfterLethal === 0
                && towerRenderExclusion?.drawCount === 1
                && towerRenderExclusion.alpha === 0
                && towerRemovedAtDeathBoundary
                && trackedDisableReceipt?.accepted === true
                && trackedDisableReceipt.tracked === false,
            `Production-wave Tower damage/death contract 실패: ${JSON.stringify({ firstTargetedShot, firstDamageContact, firstDamageFact, towerHpTimeline, towerDeathFacts, noLivingTowerFacts, towerDeathSourceTick, towerDeathBoundaryTick, towerAlphaAfterLethal, towerRemovedAtDeathBoundary })}`
        );
        assert(
            repeatedArcherRecord
                && repeatedArcherRecord.resolvedShots[1].targetFixedTick
                    - repeatedArcherRecord.resolvedShots[0].targetFixedTick
                    === ARCHER_ATTACK_DATA.intervalTicks
                && Math.hypot(
                    archerFlowThroughAttack.x,
                    archerFlowThroughAttack.y
                ) > 0
                && Math.hypot(
                    archerPostDeathDisplacement.x,
                    archerPostDeathDisplacement.y
                ) > 0
                && postDeathFixedTick >= towerDeathBoundaryTick + 30
                && postDeathStageAttemptCount === 0
                && directorStatus.shotRequestAcceptedCount
                    === acceptedShotCountAtTowerDeath
                && controlRequestCount === controlRequestCountAtTowerDeath
                && playerShotRequestCount === playerShotRequestCountAtTowerDeath,
            `Production-wave repeat/zero-Tower continuation 실패: ${JSON.stringify({ repeatedArcherRecord, archerFlowThroughAttack, archerPostDeathDisplacement, postDeathFixedTick, towerDeathBoundaryTick, postDeathStageAttemptCount, directorStatus, acceptedShotCountAtTowerDeath, controlRequestCount, controlRequestCountAtTowerDeath, playerShotRequestCount, playerShotRequestCountAtTowerDeath })}`
        );
        assert(
            selectedEnemyRenderBeforeDeath?.alpha > 0
                && selectedEnemyRenderAfterDeath?.alpha > 0
                && selectedEnemyRenderAfterThirtyTicks?.alpha > 0
                && hostileAttackLifecycleHandleMatches(
                    selectedEnemyRenderBeforeDeath.handle,
                    firstArcherHandle
                )
                && hostileAttackLifecycleHandleMatches(
                    selectedEnemyRenderAfterDeath.handle,
                    firstArcherHandle
                )
                && hostileAttackLifecycleHandleMatches(
                    selectedEnemyRenderAfterThirtyTicks.handle,
                    firstArcherHandle
                )
                && selectedEnemyRenderBeforeDeath.activeEnemyCount
                    === selectedEnemyRenderAfterDeath.activeEnemyCount
                && selectedEnemyRenderAfterDeath.activeEnemyCount
                    === selectedEnemyRenderAfterThirtyTicks.activeEnemyCount
                && productionCameraBeforeDeath?.authority
                    === 'production-tower-spawn'
                && Math.abs(
                    productionCameraBeforeDeath.center.x
                        - productionTowerSpawnPosition.x
                ) <= 0.000001
                && Math.abs(
                    productionCameraBeforeDeath.center.y
                        - productionTowerSpawnPosition.y
                ) <= 0.000001
                && towerDeathCameraFallback?.followTargetId
                    === 'tower-core-camera-follow'
                && Math.abs(
                    towerDeathCameraFallback.center.x - corePosition.x
                ) <= 0.000001
                && Math.abs(
                    towerDeathCameraFallback.center.y - corePosition.y
                ) <= 0.000001
                && JSON.stringify(productionCameraBeforeDeath.viewBounds)
                    !== JSON.stringify(towerDeathCameraFallback.viewBounds),
            `Production-wave selected Enemy render isolation/camera transition 실패: ${JSON.stringify({ selectedEnemyRenderBeforeDeath, selectedEnemyRenderAfterDeath, selectedEnemyRenderAfterThirtyTicks, productionCameraBeforeDeath, towerDeathCameraFallback })}`
        );
        assert(
            hostileIsolationDamageEvents.length === 0
                && hostileIsolationAfter.targetHealth
                    === hostileIsolationBefore.targetHealth
                && hostileIsolationAfter.projectilePenetration
                    === HOSTILE_BASIC_BULLET_DATA.penetration
                && coreIsolationEvents.length === 0
                && coreIsolationAfter.coreHealth === initialCoreBody.health
                && coreIsolationAfter.projectilePenetration
                    === HOSTILE_BASIC_BULLET_DATA.penetration
                && coreBeforeCleanup.health === initialCoreBody.health
                && endpoint.getRegistry().has(coreHandle)
                && endpoint.hasBody(coreHandle)
                && terrainDeath?.reason === 'health'
                && lifetimeDeath?.reason === 'lifetime',
            `Production-wave isolation/Core/cleanup contract 실패: ${JSON.stringify({ hostileIsolationDamageEvents, hostileIsolationBefore, hostileIsolationAfter, coreIsolationEvents, coreIsolationAfter, initialCoreBody, coreBeforeCleanup, terrainDeath, lifetimeDeath })}`
        );
        assert(
            JSON.stringify(domainSentinel) === domainSentinelBefore
                && domainSentinel.coreIntegrity.current === 100
                && domainSentinel.coreIntegrity.max === 100
                && domainSentinel.gold === 0
                && domainSentinel.reward === 0
                && domainSentinel.waveCompletion === 0
                && domainSentinel.runFailed === 0
                && waveStatus.completionOwned === false
                && commitRejectedCount === 0
                && fixedRejectedCount === 0
                && endpointStatusBeforeCleanup.reservedCount === 0
                && endpointStatusBeforeCleanup
                    .pendingSourceRelativeDestinationCount === 0
                && !endpointStatusBeforeCleanup.recoveryRequired
                && !directorStatus.recoveryRequired,
            `Production-wave domain/pressure 상태 실패: ${JSON.stringify({ domainSentinel, waveStatus, commitRejectedCount, fixedRejectedCount, endpointStatusBeforeCleanup, directorStatus })}`
        );

        const cleanupFixedTick = finalObservedFixedTick + 1;
        const cleanupCompleted = endpoint.commitCompletedEventsAtFixedBoundary(
            cleanupFixedTick
        );
        assert(
            cleanupCompleted.protocolFailure === null
                && !director.observeCompletedEvents(cleanupCompleted)
                    .recoveryRequired,
            `Production-wave cleanup completion 실패: ${JSON.stringify(cleanupCompleted)}`
        );
        const cleanupStage = director.stageForFixedTick({
            targetFixedTick: cleanupFixedTick,
            targetHandle: null
        });
        const cleanupHandles = endpoint.getRegistry().copyActiveHandlesInto([]);
        const cleanupReceipts = cleanupHandles.map((handle, index) => (
            endpoint.requestDespawn(
                handle,
                'production-wave-hardware-cleanup',
                cleanupFixedTick,
                `production-wave:cleanup:${index}`
            )
        ));
        assert(
            cleanupStage.attemptedCount === 0
                && cleanupReceipts.every(({ accepted }) => accepted),
            `Production-wave cleanup request 실패: ${JSON.stringify({ cleanupStage, cleanupReceipts })}`
        );
        const cleanupCommit = endpoint.commitAtFixedBoundary(cleanupFixedTick);
        const cleanupObservation = director.observeFixedCommit(
            cleanupCommit,
            cleanupFixedTick
        );
        await device.queue.onSubmittedWorkDone();
        const cleanupStatus = endpoint.getStatus();
        const gpuCleanupStatus = endpoint.getBackend().simulation.getStatus();
        const storageProfile = cleanupStatus.backend.gpu.fixedPrimitives
            .storageProfile;
        cleanup = Object.freeze({
            activeCount: cleanupStatus.activeCount,
            activeEnemyCount: cleanupStatus.activeEnemyCount,
            activeProjectileCount: cleanupStatus.activeProjectileCount,
            reservedCount: cleanupStatus.reservedCount,
            pendingCommandCount: cleanupStatus.pendingCommandCount,
            pendingDestinationCount:
                cleanupStatus.pendingSourceRelativeDestinationCount,
            activeBodyCount: gpuCleanupStatus.activeBodyCount,
            pendingBodyCount: gpuCleanupStatus.pendingBodyCount,
            directorActiveArcherCount:
                director.getStatus().activeArcherCount,
            directorPendingShotCount: director.getStatus().pendingShotCount,
            recoveryRequired: cleanupStatus.recoveryRequired
        });
        assert(
            cleanupCommit.despawned.length === cleanupHandles.length
                && cleanupObservation.removedArcherCount === 4
                && cleanup.activeCount === 0
                && cleanup.activeEnemyCount === 0
                && cleanup.activeProjectileCount === 0
                && cleanup.reservedCount === 0
                && cleanup.pendingCommandCount === 0
                && cleanup.pendingDestinationCount === 0
                && cleanup.activeBodyCount === 0
                && cleanup.pendingBodyCount === 0
                && cleanup.directorActiveArcherCount === 0
                && cleanup.directorPendingShotCount === 0
                && !cleanup.recoveryRequired
                && storageProfile.requiredMaximum
                    === REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE,
            `Production-wave final cleanup/leak/storage 실패: ${JSON.stringify({ cleanupCommit, cleanupObservation, cleanup, storageProfile })}`
        );

        result = Object.freeze({
            wave: Object.freeze({
                waveId: waveStatus.waveId,
                totalSpawnCount: waveStatus.totalSpawnCount,
                queuedSpawnCount: waveStatus.queuedSpawnCount,
                remainingSpawnCount: waveStatus.remainingSpawnCount,
                completionOwned: waveStatus.completionOwned,
                definitionIdCycle: expectedCycle,
                archerSpawnIndexes: expectedArcherSpawnIndexes,
                archerSpawnTicks: expectedArcherSpawnTicks,
                commandIds: Object.freeze(productionSpawnRecords.map(
                    ({ commandId }) => commandId
                ))
            }),
            fixtureGeometry: Object.freeze({
                towerPlacement: 'technical-corridor-contact-fixture',
                towerPosition,
                productionTowerSpawnPosition,
                usesProductionTowerSpawnPosition
            }),
            archers: Object.freeze(Array.from(
                archerRecords.values(),
                (record) => Object.freeze({
                    handle: record.handle,
                    spawnIndex: record.spawnIndex,
                    createdAtTick: record.createdAtTick,
                    phaseOffsetTicks: record.phaseOffsetTicks,
                    firstEligibleFixedTick: record.firstEligibleFixedTick,
                    positionAfterSpawnFixed:
                        record.positionAfterSpawnFixed,
                    resolvedShots: Object.freeze([...record.resolvedShots])
                })
            )),
            targetedShot: firstTargetedShot,
            playerPrimaryShot: Object.freeze({
                commandId: primaryProjectileMaterialized.commandId,
                targetFixedTick: primaryProjectileMaterialized.targetFixedTick,
                projectileHandle: primaryProjectileMaterialized.handle,
                requestCount: playerShotRequestCount,
                committedCount: primaryShotCommittedCount,
                origin: primaryProjectileMaterialized.previousPosition,
                velocity: primaryProjectileMaterialized.velocity,
                speed: primaryProjectileMaterialized.speed,
                launchSpeed:
                    BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond,
                requestCountAtTowerDeath: playerShotRequestCountAtTowerDeath,
                requestCountAfterDeath: playerShotRequestCount
                    - playerShotRequestCountAtTowerDeath,
                controllerEnabledAfterDeath:
                    primaryControllerStatusAfterDeath.enabled,
                primaryPressedAfterDeath:
                    primaryControllerStatusAfterDeath.primaryPressed,
                pendingShotAfterDeath:
                    primaryControllerStatusAfterDeath.pendingShot
            }),
            combat: Object.freeze({
                towerInitialHp: initialTowerBody.health,
                towerHpTimeline: Object.freeze([...towerHpTimeline]),
                damage: firstDamageContact.damage,
                damageFixedPoint: firstDamageContact.damageFixedPoint,
                towerDiedCount: towerDeathFacts.length,
                noLivingTowersCount: noLivingTowerFacts.length,
                hostileOnHostileDamageCount:
                    hostileIsolationDamageEvents.length,
                hostileTargetHealthBefore:
                    hostileIsolationBefore.targetHealth,
                hostileTargetHealthAfter:
                    hostileIsolationAfter.targetHealth,
                hostileProjectilePenetrationAfter:
                    hostileIsolationAfter.projectilePenetration,
                coreInteractionCount: coreIsolationEvents.length,
                coreHealthBefore: initialCoreBody.health,
                coreHealthAfter: coreBeforeCleanup.health
            }),
            towerDeath: Object.freeze({
                sourceTick: towerDeathSourceTick,
                boundaryTick: towerDeathBoundaryTick,
                renderAlphaAfterLethal: towerAlphaAfterLethal,
                renderExclusion: towerRenderExclusion,
                removedAtNextBoundary: towerRemovedAtDeathBoundary,
                livingTowerCount: towerRoster.getLivingTowerCount(),
                postDeathFixedTick,
                fixedProgressAfterDeath:
                    postDeathFixedTick - towerDeathBoundaryTick,
                newShotCount: directorStatus.shotRequestAcceptedCount
                    - acceptedShotCountAtTowerDeath,
                postDeathStageAttemptCount,
                controlRequestCountAfterDeath: controlRequestCount
                    - controlRequestCountAtTowerDeath,
                playerShotRequestCountAfterDeath: playerShotRequestCount
                    - playerShotRequestCountAtTowerDeath,
                trackedTowerEnabled: trackedDisableReceipt.tracked,
                cameraFallback: towerDeathCameraFallback,
                productionCameraTransition: Object.freeze({
                    beforeDeath: productionCameraBeforeDeath,
                    afterDeath: towerDeathCameraFallback
                })
            }),
            enemyPersistence: Object.freeze({
                renderEvidence: 'selected-enemy-centered-camera-isolation',
                selectedHandle: Object.freeze({ ...firstArcherHandle }),
                beforeDeath: selectedEnemyRenderBeforeDeath,
                afterDeath: selectedEnemyRenderAfterDeath,
                afterThirtyTicks: selectedEnemyRenderAfterThirtyTicks
            }),
            flow: Object.freeze({
                firstArcherHandle,
                positionAfterSpawnFixed: archerFlowBeforeAttack,
                positionAfterResolvedAttack: firstResolvedArcherPosition,
                displacementThroughAttack: archerFlowThroughAttack,
                positionAtTowerDeath: firstArcherAtTowerDeath,
                positionPostDeath: firstArcherPostDeath,
                postDeathDisplacement: archerPostDeathDisplacement
            }),
            projectileCleanup: Object.freeze({
                terrain: Object.freeze({
                    handle: auxiliaryHandles.get(auxiliaryCommandIds.terrain),
                    deathSourceTick: terrainDeath.sourceTick,
                    reason: terrainDeath.reason
                }),
                lifetime: Object.freeze({
                    handle: auxiliaryHandles.get(auxiliaryCommandIds.lifetime),
                    authoredSeconds:
                        HOSTILE_BASIC_BULLET_DATA.lifetimeSeconds,
                    deathSourceTick: lifetimeDeath.sourceTick,
                    reason: lifetimeDeath.reason
                })
            }),
            domain: Object.freeze({
                coreProxyHandle: Object.freeze({ ...coreHandle }),
                coreProxyRemainedThroughPostDeath: true,
                coreIntegrityRuntimeBound: false,
                coreIntegrityCurrentMutation: 0,
                coreIntegrityMaxMutation: 0,
                goldMutation: domainSentinel.gold,
                rewardMutation: domainSentinel.reward,
                waveCompletionMutation: domainSentinel.waveCompletion,
                runFailedMutation: domainSentinel.runFailed
            }),
            pressure: Object.freeze({
                capacity: endpointStatusBeforeCleanup.capacity,
                peakActiveCount,
                peakReservedCount,
                lifecycleRejectedCount: commitRejectedCount,
                fixedRejectedCount,
                controlRequestCount,
                fixedSubmitCount,
                fixedProgressContinued: fixedSubmitCount
                    === finalObservedFixedTick,
                recoveryRequired:
                    endpointStatusBeforeCleanup.recoveryRequired
                        || directorStatus.recoveryRequired
            }),
            cleanup,
            storageProfile
        });
    } finally {
        primaryController?.destroy();
        towerCoreCameraTarget.destroy();
        cameraTowerFacade.destroy();
        cameraCorePresentation.active = false;
        towerRoster.destroy();
        waveDirector.destroy();
        director.destroy();
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
        const endpointAfterDestroy = endpoint.getStatus();
        teardown = Object.freeze({
            endpointDestroyed: endpointAfterDestroy.destroyed,
            directorDestroyed: director.getStatus().destroyed,
            waveDestroyed: waveDirector.getStatus().initialized === false,
            activeCount: endpointAfterDestroy.activeCount,
            reservedCount: endpointAfterDestroy.reservedCount,
            pendingCommandCount: endpointAfterDestroy.pendingCommandCount
        });
        context.unconfigure();
    }
    return Object.freeze({ ...result, teardown });
}

async function runProductionHostileAttackLifecycleHardwareSmoke(device) {
    const main = await runProductionHostileAttackLifecycleMainHardwareSmoke(device);
    const targetInvalid =
        await runProductionHostileAttackTargetInvalidHardwareSmoke(device);
    const productionWave =
        await runProductionHostileAttackProductionWaveHardwareSmoke(device);
    assert(
        main.timeline.secondEligibleFixedTick
                - main.timeline.firstEligibleFixedTick
            === ARCHER_ATTACK_DATA.intervalTicks
            && main.towerDeath.newShotCount === 0
            && main.cleanup.activeCount === 0
            && main.cleanup.reservedCount === 0
            && main.cleanup.pendingCommandCount === 0
            && main.cleanup.pendingDestinationCount === 0
            && main.cleanup.pendingBodyCount === 0
            && targetInvalid.outcome === 'target-invalid'
            && targetInvalid.cooldownConsumed === false
            && targetInvalid.cleanup.activeCount === 0
            && targetInvalid.cleanup.reservedCount === 0
            && targetInvalid.cleanup.pendingCommandCount === 0
            && targetInvalid.cleanup.pendingDestinationCount === 0
            && targetInvalid.cleanup.pendingBodyCount === 0
            && productionWave.wave.totalSpawnCount === 32
            && productionWave.archers.length === 4
            && productionWave.fixtureGeometry.towerPlacement
                === 'technical-corridor-contact-fixture'
            && !productionWave.fixtureGeometry.usesProductionTowerSpawnPosition
            && productionWave.combat.towerDiedCount === 1
            && productionWave.combat.noLivingTowersCount === 1
            && productionWave.playerPrimaryShot.requestCount === 1
            && productionWave.playerPrimaryShot.committedCount === 1
            && Math.abs(
                productionWave.playerPrimaryShot.speed
                    - productionWave.playerPrimaryShot.launchSpeed
            ) <= 0.00005
            && productionWave.playerPrimaryShot.requestCountAtTowerDeath === 1
            && productionWave.playerPrimaryShot.requestCountAfterDeath === 0
            && !productionWave.playerPrimaryShot.controllerEnabledAfterDeath
            && !productionWave.playerPrimaryShot.primaryPressedAfterDeath
            && productionWave.playerPrimaryShot.pendingShotAfterDeath === null
            && productionWave.towerDeath.newShotCount === 0
            && productionWave.towerDeath.renderExclusion.drawCount === 1
            && productionWave.towerDeath.renderExclusion.alpha === 0
            && productionWave.towerDeath.renderExclusion.preLethal.alpha > 0
            && productionWave.towerDeath.renderExclusion
                .towerInteriorMarginPixels >= 2
            && productionWave.towerDeath.renderExclusion
                .nearestActiveBodyClearancePixels >= 2
            && productionWave.towerDeath.fixedProgressAfterDeath >= 30
            && productionWave.towerDeath.productionCameraTransition.beforeDeath
                .authority === 'production-tower-spawn'
            && Math.abs(
                productionWave.towerDeath.productionCameraTransition.beforeDeath
                    .center.x
                    - productionWave.towerDeath.productionCameraTransition
                        .beforeDeath.position.x
            ) <= 0.000001
            && Math.abs(
                productionWave.towerDeath.productionCameraTransition.beforeDeath
                    .center.y
                    - productionWave.towerDeath.productionCameraTransition
                        .beforeDeath.position.y
            ) <= 0.000001
            && productionWave.towerDeath.cameraFallback.followTargetId
                === 'tower-core-camera-follow'
            && Math.abs(
                productionWave.towerDeath.cameraFallback.center.x
                    - productionWave.towerDeath.cameraFallback.position.x
            ) <= 0.000001
            && Math.abs(
                productionWave.towerDeath.cameraFallback.center.y
                    - productionWave.towerDeath.cameraFallback.position.y
            ) <= 0.000001
            && JSON.stringify(
                productionWave.towerDeath.productionCameraTransition.beforeDeath
                    .viewBounds
            ) !== JSON.stringify(
                productionWave.towerDeath.productionCameraTransition.afterDeath
                    .viewBounds
            )
            && productionWave.enemyPersistence.renderEvidence
                === 'selected-enemy-centered-camera-isolation'
            && productionWave.enemyPersistence.beforeDeath.alpha > 0
            && productionWave.enemyPersistence.afterDeath.alpha > 0
            && productionWave.enemyPersistence.afterThirtyTicks.alpha > 0
            && productionWave.enemyPersistence.beforeDeath.activeEnemyCount
                === productionWave.enemyPersistence.afterDeath.activeEnemyCount
            && productionWave.enemyPersistence.afterDeath.activeEnemyCount
                === productionWave.enemyPersistence.afterThirtyTicks
                    .activeEnemyCount
            && productionWave.cleanup.activeCount === 0
            && productionWave.cleanup.reservedCount === 0
            && productionWave.cleanup.pendingCommandCount === 0
            && productionWave.cleanup.pendingDestinationCount === 0
            && productionWave.cleanup.pendingBodyCount === 0
            && !main.cleanup.recoveryRequired
            && !targetInvalid.cleanup.recoveryRequired
            && !productionWave.cleanup.recoveryRequired,
        `Hostile attack actual lifecycle aggregate gate 실패: ${JSON.stringify({ main, targetInvalid, productionWave })}`
    );
    return Object.freeze({ main, targetInvalid, productionWave });
}

async function runProductionDeadControlRaceHardwareSmoke(device) {
    const context = canvas.getContext('webgpu');
    assert(context, 'Dead-control race canvas WebGPU context가 없습니다.');
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
        getState: () => Object.freeze({ ready: true, status: 'ready' }),
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
    const navigationSource = createPhase5ProjectileNavigationSource();
    const endpoint = createGpuSimulationEndpoint({ webGpuPlatformPort: platformPort }, {
        capacity: 8,
        controlCommandCapacity: 2,
        sourceRelativeSpawnCommandCapacity: 1,
        spawnProgramCapacity: 1
    });
    const towerRoster = new TowerCombatRoster({
        maxHp: THE_TOWER_COMBAT_DATA.MAX_HEALTH
    });
    const fixedDelta = 1 / 60;
    const initialFixedTick = 1;
    const lethalSourceTick = 2;
    const deadControlSourceTick = 3;
    const cleanupFixedTick = 4;
    const towerPosition = Object.freeze({ x: 5, y: 8 });
    const liveControlPosition = Object.freeze({ x: 9, y: 8 });
    const enemyPosition = Object.freeze({ x: 2, y: 8 });
    const lethalDefinition = Object.freeze({
        id: 'nw_dead_control_race_lethal_projectile',
        collisionRadius: 0.18,
        inverseMass: 1,
        penetration: THE_TOWER_COMBAT_DATA.MAX_HEALTH,
        damage: THE_TOWER_COMBAT_DATA.MAX_HEALTH,
        damageSelf: THE_TOWER_COMBAT_DATA.MAX_HEALTH,
        lifetimeSeconds: 5,
        killOnTerrain: false,
        closestOnly: true,
        continuousInteraction: true,
        colorRgba: [1, 0.05, 0.05, 1],
        radiusScale: 1,
        visible: true
    });
    const exactHandleMatches = (value, handle) => {
        const candidate = value?.handle ?? value;
        return candidate?.entityId === handle.entityId
            && candidate?.incarnation === handle.incarnation;
    };
    const requestControlPair = (fixedTick, phase, towerHandle, liveHandle) => {
        const deadCandidate = endpoint.requestBodyControl({
            handle: towerHandle,
            moveIntentX: 0,
            moveIntentY: 0
        }, fixedTick, `dead-control-race:${phase}:tower`);
        const live = endpoint.requestBodyControl({
            handle: liveHandle,
            moveIntentX: 1,
            moveIntentY: 0
        }, fixedTick, `dead-control-race:${phase}:live`);
        assert(
            deadCandidate.accepted && live.accepted,
            `Dead-control race ${phase} control request 실패: ${JSON.stringify({ deadCandidate, live })}`
        );
        return Object.freeze({ deadCandidate, live });
    };

    try {
        assert(
            endpoint.init(navigationSource) === false,
            'Dead-control race endpoint는 첫 spawn 전 deferred여야 합니다.'
        );
        const enemyIntent = Object.freeze({
            ...createGpuEnemySpawnIntent({
                definition: {
                    ...BASIC_CIRCLE_ENEMY_DATA,
                    id: 'nw_dead_control_race_enemy',
                    maxHealth: 100
                },
                route: navigationSource.route,
                spawnSequence: 0,
                waveId: 'nw-dead-control-race',
                policyId: 'hardware-fixture'
            }),
            position: enemyPosition,
            velocity: Object.freeze({ x: 0, y: 0 })
        });
        const initialRequests = [
            endpoint.requestSpawn(
                createGpuTowerSpawnIntent({ position: towerPosition }),
                initialFixedTick,
                'dead-control-race:initial:tower'
            ),
            endpoint.requestSpawn(
                createGpuTowerSpawnIntent({ position: liveControlPosition }),
                initialFixedTick,
                'dead-control-race:initial:live-control'
            ),
            endpoint.requestSpawn(
                enemyIntent,
                initialFixedTick,
                'dead-control-race:initial:enemy'
            )
        ];
        assert(
            initialRequests.every(({ accepted }) => accepted),
            `Dead-control race initial request 실패: ${JSON.stringify(initialRequests)}`
        );
        const initialCommit = endpoint.commitAtFixedBoundary(initialFixedTick);
        const initialHandles = new Map(
            initialCommit.spawned.map(({ commandId, handle }) => [commandId, handle])
        );
        const towerHandle = initialHandles.get('dead-control-race:initial:tower');
        const liveControlHandle = initialHandles.get(
            'dead-control-race:initial:live-control'
        );
        const enemyHandle = initialHandles.get('dead-control-race:initial:enemy');
        assert(
            initialCommit.state === 'committed'
                && initialCommit.spawned.length === 3
                && initialCommit.rejected.length === 0
                && towerHandle
                && liveControlHandle
                && enemyHandle,
            `Dead-control race initial commit 실패: ${JSON.stringify(initialCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, initialFixedTick),
            'Dead-control race initial fixed submit 실패'
        );
        await settlePhase5Endpoint(endpoint, 'Dead-control race initial completion');
        const initialBodies = await readPhase5Bodies(endpoint);
        const initialTower = findPhase5Body(
            initialBodies,
            towerHandle,
            'dead-control race initial Tower'
        );
        const initialLiveControl = findPhase5Body(
            initialBodies,
            liveControlHandle,
            'dead-control race initial live control'
        );
        const initialEnemy = findPhase5Body(
            initialBodies,
            enemyHandle,
            'dead-control race initial Enemy'
        );
        assertNear(
            initialTower.health,
            THE_TOWER_COMBAT_DATA.MAX_HEALTH,
            0.000001,
            'Dead-control race initial Tower HP'
        );
        towerRoster.bindGpuBody(
            towerHandle,
            readHostileAttackLifecycleProtocol(endpoint)
        );
        const initialCompleted = endpoint.commitCompletedEventsAtFixedBoundary(
            lethalSourceTick
        );
        assert(
            initialCompleted.protocolFailure === null
                && initialCompleted.deathEvents.length === 0,
            `Dead-control race initial completed event 실패: ${JSON.stringify(initialCompleted)}`
        );

        const lethalRequest = endpoint.requestSpawn(
            createGpuProjectileSpawnIntent({
                definition: lethalDefinition,
                position: towerPosition,
                velocity: { x: 0, y: 0 },
                sourceHandle: enemyHandle,
                ownerHandle: enemyHandle,
                producerId: 'nw-dead-control-race-producer',
                sourceAbilityId: 'dead-control-race-lethal',
                teamId: GAMEPLAY_TEAM_ID.HOSTILE,
                allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
                damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
                targetPolicyId:
                    PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
                spawnSequence: 1
            }),
            lethalSourceTick,
            'dead-control-race:lethal-projectile'
        );
        const lethalControls = requestControlPair(
            lethalSourceTick,
            'lethal',
            towerHandle,
            liveControlHandle
        );
        assert(
            lethalRequest.accepted,
            `Dead-control race lethal request 실패: ${JSON.stringify(lethalRequest)}`
        );
        const lethalCommit = endpoint.commitAtFixedBoundary(lethalSourceTick);
        const lethalHandle = lethalCommit.spawned.find(
            ({ commandId }) => commandId === 'dead-control-race:lethal-projectile'
        )?.handle;
        assert(
            lethalCommit.state === 'committed'
                && lethalHandle
                && lethalCommit.fixedCommands.controls.length === 2
                && lethalCommit.fixedCommands.rejected.length === 0
                && !lethalCommit.recoveryRequired,
            `Dead-control race lethal commit 실패: ${JSON.stringify(lethalCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, lethalSourceTick),
            'Dead-control race lethal fixed submit 실패'
        );

        // 의도적으로 await/queue settle을 두지 않습니다. CPU는 아직 Tower를
        // exact-active로 보지만 GPU는 앞 submit에서 ALIVE를 끌 수 있습니다.
        const beforeDeadControlCompleted = endpoint
            .commitCompletedEventsAtFixedBoundary(deadControlSourceTick);
        assert(
            beforeDeadControlCompleted.protocolFailure === null
                && beforeDeadControlCompleted.batchCount === 0
                && endpoint.getRegistry().has(towerHandle)
                && endpoint.hasBody(towerHandle),
            `Dead-control race no-settle 경계가 깨졌습니다: ${JSON.stringify(beforeDeadControlCompleted)}`
        );
        const deadControls = requestControlPair(
            deadControlSourceTick,
            'gpu-dead-in-flight',
            towerHandle,
            liveControlHandle
        );
        const deadControlCommit = endpoint.commitAtFixedBoundary(
            deadControlSourceTick
        );
        assert(
            deadControlCommit.state === 'committed'
                && deadControlCommit.fixedCommands.controls.length === 2
                && deadControlCommit.fixedCommands.controls.some(({ commandId }) => (
                    commandId === deadControls.deadCandidate.commandId
                ))
                && deadControlCommit.fixedCommands.controls.some(({ commandId }) => (
                    commandId === deadControls.live.commandId
                ))
                && deadControlCommit.fixedCommands.rejected.length === 0
                && !deadControlCommit.recoveryRequired,
            `Dead-control race in-flight control commit 실패: ${JSON.stringify(deadControlCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, deadControlSourceTick),
            'Dead-control race second fixed submit 실패'
        );

        const settledGpuStatus = await settlePhase5Endpoint(
            endpoint,
            'Dead-control race two-submit completion'
        );
        const raceStatus = endpoint.getStatus();
        assert(
            settledGpuStatus.state === 'ready'
                && settledGpuStatus.failure === null
                && !settledGpuStatus.requiresAuthoritativeRebuild
                && raceStatus.state === 'gpu-ready'
                && raceStatus.backend.gpu.failure === null
                && !raceStatus.recoveryRequired
                && !endpoint.requiresRecovery(),
            `Dead-control race가 recovery로 전이했습니다: ${JSON.stringify({ settledGpuStatus, raceStatus })}`
        );
        const raceBodies = await readPhase5Bodies(endpoint);
        const liveControlAfterRace = findPhase5Body(
            raceBodies,
            liveControlHandle,
            'dead-control race live control after race'
        );
        const enemyAfterRace = findPhase5Body(
            raceBodies,
            enemyHandle,
            'dead-control race Enemy after race'
        );
        assert(
            !raceBodies.some((body) => exactHandleMatches(body, towerHandle))
                && !raceBodies.some((body) => exactHandleMatches(body, lethalHandle))
                && endpoint.getRegistry().has(towerHandle)
                && endpoint.hasBody(towerHandle)
                && liveControlAfterRace.position.x > initialLiveControl.position.x
                && liveControlAfterRace.velocity.x > 0
                && enemyAfterRace.flowFieldIndex >= 0
                && Math.hypot(
                    enemyAfterRace.position.x - initialEnemy.position.x,
                    enemyAfterRace.position.y - initialEnemy.position.y
                ) > 0,
            `Dead-control race live/Enemy 진행 불일치: ${JSON.stringify({ initialLiveControl, liveControlAfterRace, initialEnemy, enemyAfterRace, raceBodies })}`
        );

        const cameraScale = 4;
        const camera = {
            worldToViewport(x, y, out) {
                out.x = x * cameraScale;
                out.y = y * cameraScale;
                return out;
            },
            getScale: () => cameraScale
        };
        endpoint.updatePresentation({
            frameDelta: 0,
            fixedDelta,
            fixedAlpha: 1,
            renderFrameId: 95_001
        });
        assert(endpoint.draw(camera), 'Dead-control race post-death draw 실패');
        assert(lastFrameTexture, 'Dead-control race post-death texture가 없습니다.');
        const enemyAlphaAfterRace = await readPhase5WorldAlpha(
            device,
            lastFrameTexture,
            enemyAfterRace.position,
            cameraScale,
            'dead-control-race-enemy-after-race'
        );
        assert(
            drawMarks === 1 && enemyAlphaAfterRace > 0,
            `Dead-control race Enemy render가 사라졌습니다: ${JSON.stringify({ drawMarks, enemyAlphaAfterRace })}`
        );

        const completed = endpoint.commitCompletedEventsAtFixedBoundary(
            cleanupFixedTick
        );
        const towerDeath = completed.deathEvents.find((event) => (
            event.entityId === towerHandle.entityId
            && event.incarnation === towerHandle.incarnation
            && event.disposition === 'despawn-requested'
        ));
        const lethalDeath = completed.deathEvents.find((event) => (
            event.entityId === lethalHandle.entityId
            && event.incarnation === lethalHandle.incarnation
            && event.disposition === 'despawn-requested'
        ));
        const lethalContact = completed.contactEvents.find((event) => (
            hostileAttackLifecyclePairMatches(event, lethalHandle, towerHandle)
            && event.eventType === 'damage-applied'
        ));
        assert(
            completed.protocolFailure === null
                && completed.batchCount === 2
                && towerDeath
                && lethalDeath
                && lethalContact?.reason === 'target-died'
                && lethalContact.damageFixedPoint
                    === THE_TOWER_COMBAT_DATA.MAX_HEALTH * 100,
            `Dead-control race death event 불일치: ${JSON.stringify(completed)}`
        );
        const towerFacts = towerRoster.commitCompletedEvents(
            completed,
            endpoint.getRegistry()
        );
        assert(
            towerFacts.some(({ type }) => type === TOWER_COMBAT_FACT_TYPE.DIED)
                && towerFacts.some(
                    ({ type }) => type === TOWER_COMBAT_FACT_TYPE.NO_LIVING_TOWERS
                )
                && towerRoster.getPrimaryTowerCurrentHp() === 0
                && towerRoster.getLivingTowerCount() === 0,
            `Dead-control race Tower roster death 실패: ${JSON.stringify(towerFacts)}`
        );
        const cleanupCommit = endpoint.commitAtFixedBoundary(cleanupFixedTick);
        assert(
            cleanupCommit.state === 'committed'
                && cleanupCommit.despawned.length === 2
                && cleanupCommit.despawned.some((entry) => (
                    exactHandleMatches(entry, towerHandle)
                ))
                && cleanupCommit.despawned.some((entry) => (
                    exactHandleMatches(entry, lethalHandle)
                ))
                && cleanupCommit.rejected.length === 0
                && !cleanupCommit.recoveryRequired,
            `Dead-control race cleanup commit 실패: ${JSON.stringify(cleanupCommit)}`
        );
        assert(
            endpoint.fixedUpdate(fixedDelta, cleanupFixedTick),
            'Dead-control race cleanup fixed submit 실패'
        );
        await settlePhase5Endpoint(endpoint, 'Dead-control race cleanup completion');
        const finalBodies = await readPhase5Bodies(endpoint);
        const finalEnemy = findPhase5Body(
            finalBodies,
            enemyHandle,
            'dead-control race final Enemy'
        );
        const finalLiveControl = findPhase5Body(
            finalBodies,
            liveControlHandle,
            'dead-control race final live control'
        );
        endpoint.updatePresentation({
            frameDelta: 0,
            fixedDelta,
            fixedAlpha: 1,
            renderFrameId: 95_002
        });
        assert(endpoint.draw(camera), 'Dead-control race post-cleanup draw 실패');
        assert(lastFrameTexture, 'Dead-control race post-cleanup texture가 없습니다.');
        const enemyAlphaAfterCleanup = await readPhase5WorldAlpha(
            device,
            lastFrameTexture,
            finalEnemy.position,
            cameraScale,
            'dead-control-race-enemy-after-cleanup'
        );
        const finalStatus = endpoint.getStatus();
        const storageProfile = finalStatus.backend.gpu.fixedPrimitives.storageProfile;
        assert(
            !endpoint.getRegistry().has(towerHandle)
                && !endpoint.hasBody(towerHandle)
                && !endpoint.getRegistry().has(lethalHandle)
                && !endpoint.hasBody(lethalHandle)
                && endpoint.getRegistry().has(enemyHandle)
                && endpoint.hasBody(enemyHandle)
                && endpoint.getRegistry().has(liveControlHandle)
                && endpoint.hasBody(liveControlHandle)
                && exactHandleMatches(finalEnemy, enemyHandle)
                && exactHandleMatches(finalLiveControl, liveControlHandle)
                && drawMarks === 2
                && enemyAlphaAfterCleanup > 0
                && finalStatus.activeEnemyCount === 1
                && finalStatus.activeCount === 2
                && finalStatus.reservedCount === 0
                && finalStatus.pendingCommandCount === 0
                && finalStatus.backend.gpu.failure === null
                && !finalStatus.backend.gpu.requiresAuthoritativeRebuild
                && !finalStatus.recoveryRequired
                && !endpoint.requiresRecovery()
                && storageProfile.requiredMaximum
                    === REQUIRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE,
            `Dead-control race final invariant 실패: ${JSON.stringify({ finalStatus, finalBodies, storageProfile, drawMarks, enemyAlphaAfterCleanup })}`
        );

        return Object.freeze({
            scenario: 'tower-lethal-then-exact-dead-control-two-submit',
            settledBetweenSubmits: false,
            deadControlSubmitted: true,
            handles: Object.freeze({
                tower: Object.freeze({ ...towerHandle }),
                liveControl: Object.freeze({ ...liveControlHandle }),
                enemy: Object.freeze({ ...enemyHandle }),
                lethalProjectile: Object.freeze({ ...lethalHandle })
            }),
            sourceTicks: Object.freeze({
                initial: initialFixedTick,
                lethal: lethalSourceTick,
                deadControl: deadControlSourceTick,
                cleanup: cleanupFixedTick
            }),
            submissions: Object.freeze({
                lethal: Object.freeze({
                    towerControlCommandId: lethalControls.deadCandidate.commandId,
                    liveControlCommandId: lethalControls.live.commandId,
                    fixedCommandCount: lethalCommit.fixedCommands.controls.length
                }),
                deadControl: Object.freeze({
                    towerControlCommandId: deadControls.deadCandidate.commandId,
                    liveControlCommandId: deadControls.live.commandId,
                    fixedCommandCount:
                        deadControlCommit.fixedCommands.controls.length,
                    completedBatchCountBeforeSubmit:
                        beforeDeadControlCompleted.batchCount
                })
            }),
            towerDeath: Object.freeze({
                observed: true,
                contact: lethalContact,
                towerEvent: towerDeath,
                projectileEvent: lethalDeath,
                rosterFacts: towerFacts,
                cleanup: cleanupCommit,
                towerRegistryPresentAfterCleanup:
                    endpoint.getRegistry().has(towerHandle),
                towerBackendPresentAfterCleanup: endpoint.hasBody(towerHandle)
            }),
            liveControl: Object.freeze({
                handle: Object.freeze({ ...liveControlHandle }),
                positionBefore: Object.freeze({ ...initialLiveControl.position }),
                positionAfterRace: Object.freeze({ ...liveControlAfterRace.position }),
                velocityAfterRace: Object.freeze({ ...liveControlAfterRace.velocity }),
                moved: liveControlAfterRace.position.x > initialLiveControl.position.x
            }),
            enemyPersistence: Object.freeze({
                handle: Object.freeze({ ...enemyHandle }),
                identityPreserved: exactHandleMatches(finalEnemy, enemyHandle),
                flowFieldIndexBefore: initialEnemy.flowFieldIndex,
                flowFieldIndexAfter: finalEnemy.flowFieldIndex,
                positionBefore: Object.freeze({ ...initialEnemy.position }),
                positionAfterRace: Object.freeze({ ...enemyAfterRace.position }),
                positionAfterCleanup: Object.freeze({ ...finalEnemy.position }),
                flowProgressed: Math.hypot(
                    finalEnemy.position.x - initialEnemy.position.x,
                    finalEnemy.position.y - initialEnemy.position.y
                ) > 0,
                renderAlphaAfterRace: enemyAlphaAfterRace,
                renderAlphaAfterCleanup: enemyAlphaAfterCleanup
            }),
            backend: Object.freeze({
                state: finalStatus.state,
                gpuState: finalStatus.backend.gpu.state,
                failure: finalStatus.backend.gpu.failure,
                recoveryRequired: finalStatus.recoveryRequired,
                requiresAuthoritativeRebuild:
                    finalStatus.backend.gpu.requiresAuthoritativeRebuild
            }),
            storageProfile
        });
    } finally {
        towerRoster.destroy();
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
        context.unconfigure();
    }
}

async function runProductionFixedPrimitiveSmoke(device) {
    const endpoint = await runProductionFixedPrimitiveEndpointSmoke(device);
    const isolation = await runProductionFixedPrimitiveIsolationSmoke(device);
    const sourceInvalid = await runProductionSourceInvalidCleanupSmoke(device);
    const geometry = await runProductionFixedPrimitiveGeometrySmoke(device);
    const towerCoreWorld = await runProductionTowerCoreWorldHardwareSmoke(device);
    const phase5ProjectileAim = await runProductionPhase5AimHardwareSmoke(device);
    const targetEntityAim = await runProductionTargetEntityAimHardwareSmoke(device);
    const targetEntityInvalid =
        await runProductionTargetEntityInvalidHardwareSmoke(device);
    const towerCombat = await runProductionTowerCombatHardwareSmoke(device);
    const deadControlRace =
        await runProductionDeadControlRaceHardwareSmoke(device);
    const hostileAttackLifecycle =
        await runProductionHostileAttackLifecycleHardwareSmoke(device);
    const phase5ProjectileLifecycle =
        await runProductionPhase5ProjectileLifecycleHardwareSmoke(device);
    const phase5FailureDomains =
        await runProductionPhase5FailureDomainHardwareSmoke(device);
    const targetEntityFailureDomains =
        await runProductionTargetEntityFailureDomainHardwareSmoke(
            device,
            targetEntityInvalid
        );
    const phase5GenerationRecovery =
        await runProductionPhase5GenerationRecoveryHardwareSmoke(device);
    return {
        endpoint,
        isolation,
        sourceInvalid,
        geometry,
        towerCoreWorld,
        phase5ProjectileAim,
        targetEntityAim,
        targetEntityInvalid,
        towerCombat,
        deadControlRace,
        hostileAttackLifecycle,
        phase5ProjectileLifecycle,
        phase5FailureDomains,
        targetEntityFailureDomains,
        phase5GenerationRecovery
    };
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
        result.productionFixedPrimitives = await runProductionFixedPrimitiveSmoke(device);
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
        assert(
            lost.reason === 'destroyed',
            `WebGPU device lost reason이 destroyed가 아닙니다: ${lost.reason}`
        );
        result.status = 'pass';
    } catch (error) {
        result.error = error?.stack ?? String(error);
    }

    require('node:fs').writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    nw.App.quit();
}

run();
