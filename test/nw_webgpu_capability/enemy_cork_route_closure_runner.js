import {
    BASIC_CORK_ENEMY_DATA
} from './production/script/data/object/enemy/basic_cork_enemy_data.js';
import {
    BASIC_ARROW_ENEMY_DATA,
    BASIC_HEXA_ENEMY_DATA,
    BASIC_OCTA_ENEMY_DATA,
    BASIC_PENTA_ENEMY_DATA,
    BASIC_RHOM_ENEMY_DATA,
    BASIC_RING_ENEMY_DATA,
    BASIC_SQUARE_ENEMY_DATA
} from './production/script/data/object/enemy/basic_circle_enemy_data.js';
import {
    BASIC_JORANG_ENEMY_DATA
} from './production/script/data/object/enemy/basic_jorang_enemy_data.js';
import {
    PENTA_BOOST_EFFECT_DEFINITION,
    PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE
} from './production/script/data/object/enemy/enemy_effect_catalog_data.js';
import {
    CORK_DUAL_ROUTE_MAP_DATA,
    CORK_DUAL_ROUTE_LOWER_PATH_ID,
    CORK_DUAL_ROUTE_ROUTE_SET_ID,
    CORK_DUAL_ROUTE_UPPER_CLOSURE_ID,
    CORK_DUAL_ROUTE_UPPER_PATH_ID
} from './production/script/data/scene/game/cork_dual_route_map_data.js';
import {
    CORK_DUAL_ROUTE_FOLLOWUP_WAIT_SECONDS,
    CORK_DUAL_ROUTE_WAVE_01_DATA
} from './production/script/data/scene/game/cork_dual_route_wave_01_data.js';
import {
    BASIC_BULLET_PROJECTILE_DATA
} from './production/script/data/object/projectile/basic_bullet_data.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} from './production/script/module/ingame/contract/gameplay_team_contract.js';
import {
    ROUTE_AVAILABILITY_MAX_CORK_ROSTER
} from './production/script/module/ingame/contract/route_availability_contract.js';
import {
    WaveDirector
} from './production/script/module/ingame/flow/wave_director.js';
import {
    AUTHORED_FORMATION_COORDINATE_SYSTEM,
    AUTHORED_FORMATION_SPAWN_MODE,
    AUTHORED_WAVE_TIMELINE_COMMAND_TYPE
} from './production/script/module/ingame/flow/authored_wave_timeline_contract.js';
import {
    TileMap
} from './production/script/module/ingame/map/tile_map.js';
import {
    createRouteFlowFieldAtlas
} from './production/script/module/ingame/navigation/route_flow_field_atlas.js';
import {
    CorkRouteClosureDirector
} from './production/script/module/ingame/object/enemy/cork_route_closure_director.js';
import {
    EnemySimulationBackend
} from './production/script/module/ingame/object/enemy/enemy_simulation_backend.js';
import {
    GpuEnemySimulationEndpoint
} from './production/script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js';
import {
    createGpuEnemySpawnIntent
} from './production/script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js';
import {
    createGpuProjectileSpawnIntent
} from './production/script/module/ingame/object/projectile/gpu_projectile_spawn_adapter.js';
import {
    createGpuTowerSpawnIntent
} from './production/script/module/ingame/object/tower/gpu_tower_spawn_adapter.js';
import {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_INTERACTION_LAYER,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM,
    GPU_CIRCLE_SELECTED_TARGET_PROJECTILE_STATE_ABI,
    createGpuCircleBodyAbiStorage,
    GPU_PROJECTILE_CAPTURE_PHASE,
    GPU_PROJECTILE_CAPTURE_ROLE,
    readGpuProjectileCaptureState,
    unpackGpuCircleInteractionMeta,
    unpackGpuCirclePhysicsMeta
} from './production/script/module/ingame/physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_EFFECT_EVENT_TYPE,
    GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
    GPU_EFFECT_PULSE_PROGRAM_FLAG,
    GPU_EFFECT_RUNTIME_ABI,
    GPU_EFFECT_RUNTIME_STATUS,
    GPU_EFFECT_TARGET_POLICY
} from './production/script/module/ingame/physics/gpu/gpu_effect_runtime_abi.js';
import {
    GPU_FORMATION_BODY_STATE_FLAG,
    GPU_FORMATION_RUNTIME_ABI,
    readGpuFormationBodyState
} from './production/script/module/ingame/physics/gpu/gpu_formation_runtime_abi.js';
import {
    GPU_ROUTE_AVAILABILITY_STATE,
    GPU_ROUTE_RUNTIME_ABI,
    GPU_ROUTE_RUNTIME_FLAG,
    GPU_ROUTE_RUNTIME_MAX_CLOSERS,
    GPU_ROUTE_RUNTIME_PHASE,
    GPU_ROUTE_RUNTIME_ROLE,
    readGpuRouteRuntimeState,
    writeGpuRouteRuntimeState
} from './production/script/module/ingame/physics/gpu/gpu_route_runtime_abi.js';
import {
    GPU_ROUTE_RUNTIME_STORAGE_PROFILE
} from './production/script/module/ingame/physics/gpu/gpu_route_runtime_shaders.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const REQUIRED_STORAGE_BUFFER_LIMIT = 9;
const FIXED_DELTA = 1 / 60;
const CORK_EXPANSION_CLOSE_SUBMIT_TICK = 62;
const CORK_CLOSE_COMPLETION_TICK = 63;
const TOWER_BLOCKER_PROBE_START_DISTANCE = 3.51;
const PENTA_BLOCKING_PROBE_DISTANCE = 4.5;
const MAIN_HARNESS_CAPACITY = 20;
const MAIN_EXPECTED_PEAK_ACTIVE_COUNT = 13;
const MIXED_CHURN_CONTRACT_VERSION = 2;
const MIXED_CHURN_DEFAULT_CYCLES = 3;
const MIXED_CHURN_MAXIMUM_CYCLES = 12;
const MIXED_CHURN_HARNESS_CAPACITY = 12;
let flowRebuildRenderFrameId = 0;
const CROSS_ACTOR_LANE_OFFSETS = Object.freeze([-1.5, -0.75, 0.75]);
const REQUIRED_EFFECT_FLAGS = GPU_EFFECT_PULSE_PROGRAM_FLAG.PENTA_TARGET_ALLOWED
    | GPU_EFFECT_PULSE_PROGRAM_FLAG.TOWER_CONTACT_DAMAGE_MODIFIABLE
    | GPU_EFFECT_PULSE_PROGRAM_FLAG.PROJECTILE_TOWER_DAMAGE_MODIFIABLE
    | GPU_EFFECT_PULSE_PROGRAM_FLAG.DIRECT_CORE_IMPACT_DAMAGE_MODIFIABLE
    | GPU_EFFECT_PULSE_PROGRAM_FLAG.PROJECTILE_CORE_DAMAGE_MODIFIABLE;
const BRANCH_REROUTE_BEHAVIOR_ACTORS = Object.freeze([
    Object.freeze({
        key: 'arrow',
        definition: BASIC_ARROW_ENEMY_DATA,
        programId: GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.ARROW_TOWER_CHARGE
    }),
    Object.freeze({
        key: 'rhom',
        definition: BASIC_RHOM_ENEMY_DATA,
        programId: GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.SELECTED_TARGET_PROJECTILE
    }),
    Object.freeze({
        key: 'octagon',
        definition: BASIC_OCTA_ENEMY_DATA,
        programId: GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT
    })
]);
const BRANCH_REROUTE_SIDE_PLANE_ACTORS = Object.freeze([
    Object.freeze({ key: 'ring', definition: BASIC_RING_ENEMY_DATA }),
    Object.freeze({ key: 'jorang', definition: BASIC_JORANG_ENEMY_DATA }),
    Object.freeze({ key: 'hexa', definition: BASIC_HEXA_ENEMY_DATA })
]);
const MIXED_CHURN_ENEMY_ACTORS = Object.freeze([
    Object.freeze({ key: 'octagon', definition: BASIC_OCTA_ENEMY_DATA }),
    Object.freeze({ key: 'jorang', definition: BASIC_JORANG_ENEMY_DATA }),
    Object.freeze({ key: 'ring', definition: BASIC_RING_ENEMY_DATA }),
    Object.freeze({ key: 'cork', definition: BASIC_CORK_ENEMY_DATA }),
    Object.freeze({ key: 'hexa', definition: BASIC_HEXA_ENEMY_DATA }),
    Object.freeze({ key: 'penta', definition: BASIC_PENTA_ENEMY_DATA })
]);
const MIXED_CHURN_ROSTER = Object.freeze([
    ...MIXED_CHURN_ENEMY_ACTORS.map(({ key }) => key),
    'projectile'
]);

const ROUTE_ACTOR_DEFINITION = Object.freeze({
    id: 'nw-cork-route-actor',
    collisionRadiusTiles: 0.28,
    collisionWeight: 1,
    maxHealth: 100,
    moveSpeedTilesPerSecond: 30,
    towerContactDamage: 0,
    coreImpactDamage: 0,
    bountyBudget: 0,
    colorRgba: Object.freeze([0.15, 0.75, 1, 1]),
    radiusScale: 1
});

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function exactHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

function copyHandle(handle) {
    return Object.freeze({
        entityId: handle.entityId,
        incarnation: handle.incarnation
    });
}

function readMixedChurnCycleCount() {
    const raw = process.env.CIRVIVOR_R2_CHURN_CYCLES;
    if (raw === undefined || raw === '') {
        return MIXED_CHURN_DEFAULT_CYCLES;
    }
    if (!/^[1-9][0-9]*$/u.test(raw)) {
        throw new RangeError(
            'CIRVIVOR_R2_CHURN_CYCLES 형식은 1 이상의 정수여야 합니다.'
        );
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value > MIXED_CHURN_MAXIMUM_CYCLES) {
        throw new RangeError(
            `CIRVIVOR_R2_CHURN_CYCLES는 1..${MIXED_CHURN_MAXIMUM_CYCLES} 범위여야 합니다.`
        );
    }
    return value;
}

function createPlatformPort(device, format) {
    return Object.freeze({
        getState: () => Object.freeze({ ready: true, status: 'ready' }),
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => 1,
        acquireFrameTarget: () => null,
        clearCanvas: () => true,
        markCanvasDrawn() {},
        markCanvasCleared() {}
    });
}

function createEndpoint(device, format, capacity) {
    return new GpuEnemySimulationEndpoint({
        webGpuPlatformPort: createPlatformPort(device, format),
        enemySimulationBackendFactory: (dependencies, options) => (
            new EnemySimulationBackend(dependencies, options)
        )
    }, { capacity });
}

function createRouteHarness(device, format, capacity) {
    const tileMap = new TileMap(CORK_DUAL_ROUTE_MAP_DATA);
    const endpoint = createEndpoint(device, format, capacity);
    const ready = endpoint.init(tileMap);
    const backend = endpoint.getBackend();
    const runtimeState = backend.getRuntimeState();
    assert(backend.simulation
        && ((ready === true && runtimeState === 'gpu-ready')
            || (ready === false && runtimeState === 'gpu-deferred')),
    `Cork endpoint init state mismatch: ${JSON.stringify({
        ready,
        runtimeState
    })}`);
    if (runtimeState === 'gpu-deferred') {
        assert(backend.simulation.init() === true
            && backend.getRuntimeState() === 'gpu-ready',
        'Cork deferred GPU bootstrap failed');
    }
    const runtime = endpoint.getRouteAvailabilityRuntimeStatus();
    assert(runtime.graphEnabled === true
        && runtime.closureCount === tileMap.getRouteGraph().closures.length
        && runtime.availabilityVersion === 1
        && runtime.closedPathIds.length === 0,
    `Cork initial route status mismatch: ${JSON.stringify(runtime)}`);
    const director = new CorkRouteClosureDirector({
        routeGraph: tileMap.getRouteGraph(),
        graphContentKey: runtime.graphContentKey,
        sessionGeneration: runtime.sessionGeneration,
        deviceGeneration: runtime.deviceGeneration,
        authoritativeEpoch: runtime.authoritativeEpoch,
        capacity: runtime.capacity,
        runtimeStatus: runtime
    });
    const atlas = endpoint.getBackend().getFlowFieldAtlas();
    const upperRoute = tileMap.getSpawnRoutes().find(
        ({ pathId }) => pathId === CORK_DUAL_ROUTE_UPPER_PATH_ID
    );
    const lowerRoute = tileMap.getSpawnRoutes().find(
        ({ pathId }) => pathId === CORK_DUAL_ROUTE_LOWER_PATH_ID
    );
    assert(upperRoute && lowerRoute && atlas?.routeGraph,
        'Cork compiled route graph missing');
    return Object.freeze({
        tileMap,
        endpoint,
        director,
        atlas,
        upperRoute,
        lowerRoute,
        initialRuntime: runtime
    });
}

function createDynamicRouteIntent({
    definition,
    route,
    position,
    spawnSequence,
    availability,
    graphContentKey
}) {
    return Object.freeze({
        ...createGpuEnemySpawnIntent({
            definition,
            route,
            routeSetId: CORK_DUAL_ROUTE_ROUTE_SET_ID,
            routeAvailabilityVersion: availability.availabilityVersion,
            routeGraphContentKey: graphContentKey,
            spawnSequence,
            waveId: 'nw-cork-route-closure',
            policyId: 'hardware-fixture'
        }),
        position: Object.freeze({ x: position.x, y: position.y })
    });
}

function createCorkIntent(harness, spawnSequence, position) {
    return createDynamicRouteIntent({
        definition: BASIC_CORK_ENEMY_DATA,
        route: harness.upperRoute,
        position,
        spawnSequence,
        availability: harness.director.getAvailabilitySnapshot(),
        graphContentKey: harness.initialRuntime.graphContentKey
    });
}

function createPentaIntent(harness, spawnSequence, position) {
    return Object.freeze({
        ...createDynamicRouteIntent({
            definition: BASIC_PENTA_ENEMY_DATA,
            route: harness.upperRoute,
            position,
            spawnSequence,
            availability: harness.director.getAvailabilitySnapshot(),
            graphContentKey: harness.initialRuntime.graphContentKey
        }),
        velocity: Object.freeze({ x: 0, y: 0 }),
        contactHandler: null
    });
}

function createCrossSystemRouteIntent({
    harness,
    definition,
    position,
    spawnSequence
}) {
    return createDynamicRouteIntent({
        definition,
        route: harness.upperRoute,
        position,
        spawnSequence,
        availability: harness.director.getAvailabilitySnapshot(),
        graphContentKey: harness.initialRuntime.graphContentKey
    });
}

function createBlockingCorkBoostPulse(sourceHandle, sourceTick) {
    return Object.freeze({
        sourceEntityId: sourceHandle.entityId,
        sourceIncarnation: sourceHandle.incarnation,
        effectDefinitionCode: PENTA_BOOST_EFFECT_DEFINITION.effectDefinitionCode,
        emitterDefinitionCode:
            PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.emitterDefinitionCode,
        sourceTick,
        pulseSequence: 0,
        radiusTiles: PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.pulseRadiusTiles,
        targetLayerMask: GPU_CIRCLE_BODY_INTERACTION_LAYER.ENEMY,
        targetPolicy: GPU_EFFECT_TARGET_POLICY.HOSTILE_ENEMY,
        fingerprint: 0x7c0c003f,
        flags: REQUIRED_EFFECT_FLAGS,
        retargetIntervalTicks:
            PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.retargetIntervalTicks
    });
}

function createProjectileIntent(position, velocity, spawnSequence) {
    const definition = Object.freeze({
        ...BASIC_BULLET_PROJECTILE_DATA,
        id: 'nw-cork-penetrating-bullet',
        damage: 2,
        penetration: 2,
        killOnTerrain: false
    });
    return createGpuProjectileSpawnIntent({
        definition,
        position,
        velocity,
        spawnSequence,
        ownerHandle: null,
        sourceHandle: null,
        targetHandle: null,
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        producerId: 'nw-cork-projectile-producer',
        sourceAbilityId: 'nw-cork-projectile-ability'
    });
}

function requireSpawnHandle(lifecycle, commandId) {
    const handle = lifecycle?.spawned?.find(
        (entry) => entry.commandId === commandId
    )?.handle;
    assert(handle, `spawn handle missing: ${commandId}`);
    return copyHandle(handle);
}

function findBody(bodies, handle) {
    return bodies.find((body) => exactHandle(body.handle, handle)) ?? null;
}

async function waitForGpuBoundary(endpoint, label, timeoutMs = 8_000) {
    const simulation = endpoint.getBackend().simulation;
    assert(simulation, `${label}: production simulation missing`);
    await simulation.device.queue.onSubmittedWorkDone();
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        const route = endpoint.getRouteAvailabilityRuntimeStatus();
        const capture = endpoint.getProjectileCaptureRuntimeStatus();
        const events = simulation.getStatus().events;
        if (route.pendingReadbackCount === 0
            && capture.pendingCaptureReadbackCount === 0
            && capture.pendingReleaseReadbackCount === 0
            && events.pendingReadbacks === 0) {
            return Object.freeze({ route, capture, events });
        }
        await new Promise((resolve) => setTimeout(resolve, 4));
    }
    throw new Error(`${label}: GPU completion timeout ${JSON.stringify({
        route: endpoint.getRouteAvailabilityRuntimeStatus(),
        capture: endpoint.getProjectileCaptureRuntimeStatus(),
        events: endpoint.getBackend().simulation.getStatus().events
    })}`);
}

async function readBodies(endpoint) {
    const simulation = endpoint.getBackend().simulation;
    const promise = simulation.readbackBodies();
    await simulation.device.queue.onSubmittedWorkDone();
    return promise;
}

function seedGpuBodyPose(endpoint, evidence, handle, position, label) {
    const entry = routeEntryFor(evidence, handle);
    assert(entry, `${label}: exact body가 없습니다.`);
    const bytes = new ArrayBuffer(16);
    const view = new DataView(bytes);
    view.setFloat32(0, position.x, true);
    view.setFloat32(4, position.y, true);
    view.setFloat32(8, 0, true);
    view.setFloat32(12, 0, true);
    endpoint.getBackend().simulation.device.queue.writeBuffer(
        endpoint.getBackend().simulation.buffers.physics,
        entry.body.index * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE,
        bytes
    );
}

async function readProjectileCaptureState(endpoint, body, handle, label) {
    assert(body && exactHandle(body.handle, handle),
        `${label}: exact Ring body missing`);
    const simulation = endpoint.getBackend().simulation;
    const abi = GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE;
    const readback = simulation.device.createBuffer({
        label: `cirvivor-nw-cork-capture-state-${label}`,
        size: abi.STRIDE,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = simulation.device.createCommandEncoder({
            label: `cirvivor-nw-cork-capture-state-copy-${label}`
        });
        encoder.copyBufferToBuffer(
            simulation.buffers.projectileCaptureStates,
            body.index * abi.STRIDE,
            readback,
            0,
            abi.STRIDE
        );
        simulation.device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const storage = createGpuCircleBodyAbiStorage(1);
        new Uint8Array(storage.projectileCaptureStateBuffer).set(
            new Uint8Array(readback.getMappedRange())
        );
        const state = readGpuProjectileCaptureState(storage, 0);
        assert(state.selfEntityId === handle.entityId
            && state.selfIncarnation === handle.incarnation,
        `${label}: capture state identity mismatch ${JSON.stringify({
            expected: handle,
            actual: state
        })}`);
        return state;
    } finally {
        try {
            readback.unmap();
        } catch {
            // already unmapped
        }
        readback.destroy();
    }
}

async function waitForEffectCompletion(endpoint, label, timeoutMs = 8_000) {
    const backend = endpoint.getBackend();
    await backend.simulation.device.queue.onSubmittedWorkDone();
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        const completed = backend.drainCompletedEffectProgramBatches([]);
        if (completed.length > 0) {
            const result = completed[0];
            assert(result.status === GPU_EFFECT_RUNTIME_STATUS.OK,
                `${label}: Effect status ${JSON.stringify(result)}`);
            return result;
        }
        await new Promise((resolve) => setTimeout(resolve, 4));
    }
    throw new Error(`${label}: Effect completion timeout ${JSON.stringify(
        backend.getEffectRuntimeStatus()
    )}`);
}

async function readEffectSummary(endpoint, body, handle, label) {
    const simulation = endpoint.getBackend().simulation;
    const abi = GPU_EFFECT_RUNTIME_ABI.SUMMARY;
    const readback = simulation.device.createBuffer({
        label: `cirvivor-nw-cork-effect-summary-${label}`,
        size: abi.STRIDE,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = simulation.device.createCommandEncoder({
            label: `cirvivor-nw-cork-effect-summary-copy-${label}`
        });
        encoder.copyBufferToBuffer(
            simulation.buffers.effectSummaries,
            body.index * abi.STRIDE,
            readback,
            0,
            abi.STRIDE
        );
        simulation.device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const view = new DataView(readback.getMappedRange());
        const entityId = view.getUint32(abi.ENTITY_ID, true);
        const incarnation = view.getUint32(abi.INCARNATION, true);
        assert(entityId === handle.entityId && incarnation === handle.incarnation,
            `${label}: Effect summary exact identity mismatch`);
        return Object.freeze({
            entityId,
            incarnation,
            activeFamilyMask: view.getUint32(abi.ACTIVE_FAMILY_MASK, true),
            boostStackCount: view.getUint32(abi.BOOST_STACK_COUNT, true),
            summaryTick: view.getUint32(abi.SUMMARY_TICK, true)
        });
    } finally {
        try { readback.unmap(); } catch { /* already unmapped */ }
        readback.destroy();
    }
}

async function readEffectEmitterState(endpoint, body, handle, label) {
    const simulation = endpoint.getBackend().simulation;
    const abi = GPU_EFFECT_RUNTIME_ABI.EMITTER_STATE;
    const readback = simulation.device.createBuffer({
        label: `cirvivor-nw-cork-effect-emitter-${label}`,
        size: abi.STRIDE,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = simulation.device.createCommandEncoder({
            label: `cirvivor-nw-cork-effect-emitter-copy-${label}`
        });
        encoder.copyBufferToBuffer(
            simulation.buffers.effectEmitterStates,
            body.index * abi.STRIDE,
            readback,
            0,
            abi.STRIDE
        );
        simulation.device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const view = new DataView(readback.getMappedRange());
        const state = Object.freeze({
            entityId: view.getUint32(abi.ENTITY_ID, true),
            incarnation: view.getUint32(abi.INCARNATION, true),
            emitterDefinitionCode: view.getUint32(
                abi.EMITTER_DEFINITION_CODE,
                true
            ),
            effectDefinitionCode: view.getUint32(
                abi.EFFECT_DEFINITION_CODE,
                true
            ),
            flags: view.getUint32(abi.FLAGS, true)
        });
        assert(state.entityId === handle.entityId
            && state.incarnation === handle.incarnation,
        `${label}: Effect emitter exact identity mismatch ${JSON.stringify({
            expected: handle,
            actual: state
        })}`);
        return state;
    } finally {
        try { readback.unmap(); } catch { /* already unmapped */ }
        readback.destroy();
    }
}

async function readFormationState(endpoint, body, handle, label) {
    const simulation = endpoint.getBackend().simulation;
    const stride = GPU_FORMATION_RUNTIME_ABI.BODY_STATE.STRIDE;
    const readback = simulation.device.createBuffer({
        label: `cirvivor-nw-cork-formation-state-${label}`,
        size: stride,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = simulation.device.createCommandEncoder({
            label: `cirvivor-nw-cork-formation-copy-${label}`
        });
        encoder.copyBufferToBuffer(
            simulation.buffers.formationStates,
            body.index * stride,
            readback,
            0,
            stride
        );
        simulation.device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const bytes = new Uint8Array(readback.getMappedRange()).slice();
        const state = readGpuFormationBodyState(bytes.buffer, 0);
        assert(state.entityId === handle.entityId
            && state.incarnation === handle.incarnation,
        `${label}: Formation exact identity mismatch ${JSON.stringify(state)}`);
        return state;
    } finally {
        try { readback.unmap(); } catch { /* already unmapped */ }
        readback.destroy();
    }
}

async function readRouteStateAtSlot(endpoint, bodySlot, label) {
    const simulation = endpoint.getBackend().simulation;
    const stride = GPU_ROUTE_RUNTIME_ABI.BODY_STATE.STRIDE;
    const readback = simulation.device.createBuffer({
        label: `cirvivor-nw-cork-route-state-${label}`,
        size: stride,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = simulation.device.createCommandEncoder({
            label: `cirvivor-nw-cork-route-copy-${label}`
        });
        encoder.copyBufferToBuffer(
            simulation.buffers.routeRuntimeStates,
            bodySlot * stride,
            readback,
            0,
            stride
        );
        simulation.device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const bytes = new Uint8Array(readback.getMappedRange()).slice();
        return readGpuRouteRuntimeState(bytes.buffer, 1, 0);
    } finally {
        try { readback.unmap(); } catch { /* already unmapped */ }
        readback.destroy();
    }
}

async function readRouteAvailabilityGpuEvidence(endpoint, closureCount, label) {
    const simulation = endpoint.getBackend().simulation;
    const header = GPU_ROUTE_RUNTIME_ABI.AVAILABILITY_HEADER;
    const record = GPU_ROUTE_RUNTIME_ABI.AVAILABILITY_RECORD;
    const byteLength = header.STRIDE + (closureCount * record.STRIDE);
    const readback = simulation.device.createBuffer({
        label: `cirvivor-nw-cork-route-availability-${label}`,
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = simulation.device.createCommandEncoder({
            label: `cirvivor-nw-cork-route-availability-copy-${label}`
        });
        encoder.copyBufferToBuffer(
            simulation.buffers.routeAvailability,
            0,
            readback,
            0,
            byteLength
        );
        simulation.device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const view = new DataView(readback.getMappedRange());
        const records = Array.from({ length: closureCount }, (_, index) => {
            const offset = header.STRIDE + (index * record.STRIDE);
            return Object.freeze({
                closureIndex: index,
                state: view.getUint32(offset + record.STATE, true),
                ownerSlot: view.getUint32(offset + record.OWNER_SLOT, true),
                ownerEntityId: view.getUint32(
                    offset + record.OWNER_ENTITY_ID,
                    true
                ),
                ownerIncarnation: view.getUint32(
                    offset + record.OWNER_INCARNATION,
                    true
                ),
                leaseGeneration: view.getUint32(
                    offset + record.LEASE_GENERATION,
                    true
                ),
                changedAtFixedTick: view.getUint32(
                    offset + record.CHANGED_AT_FIXED_TICK,
                    true
                ),
                changedAvailabilityVersion: view.getUint32(
                    offset + record.CHANGED_AVAILABILITY_VERSION,
                    true
                )
            });
        });
        return Object.freeze({
            status: view.getUint32(header.STATUS, true),
            availabilityVersion: view.getUint32(
                header.AVAILABILITY_VERSION,
                true
            ),
            flowReadyAvailabilityVersion: view.getUint32(
                header.FLOW_READY_AVAILABILITY_VERSION,
                true
            ),
            sourceTick: view.getUint32(header.SOURCE_TICK, true),
            completedThroughTick: view.getUint32(
                header.COMPLETED_THROUGH_TICK,
                true
            ),
            records: Object.freeze(records)
        });
    } finally {
        try { readback.unmap(); } catch { /* already unmapped */ }
        readback.destroy();
    }
}

async function pumpRouteFlowFieldUntilReady(
    endpoint,
    closureCount,
    expectedAvailabilityVersion,
    label
) {
    const simulation = endpoint.getBackend().simulation;
    const maximumFrames = 240;
    for (let frame = 1; frame <= maximumFrames; frame++) {
        endpoint.updatePresentation({
            frameDelta: FIXED_DELTA,
            fixedDelta: FIXED_DELTA,
            fixedAlpha: 0,
            renderFrameId: ++flowRebuildRenderFrameId,
            previousFrameCpuSeconds: 0,
            targetFrameSeconds: FIXED_DELTA
        });
        if (frame % 10 !== 0 && frame !== maximumFrames) continue;
        await simulation.device.queue.onSubmittedWorkDone();
        const evidence = await readRouteAvailabilityGpuEvidence(
            endpoint,
            closureCount,
            `${label}-frame-${frame}`
        );
        if (evidence.flowReadyAvailabilityVersion
            >= expectedAvailabilityVersion) {
            return Object.freeze({ evidence, frameCount: frame });
        }
    }
    throw new Error(`${label}: flow-field publication timeout`);
}

async function readRouteEvidence(endpoint, label) {
    const bodies = await readBodies(endpoint);
    const entries = [];
    for (const body of bodies) {
        entries.push(Object.freeze({
            body,
            routeState: await readRouteStateAtSlot(
                endpoint,
                body.index,
                `${label}-${body.index}`
            )
        }));
    }
    return Object.freeze({ bodies: Object.freeze(bodies), entries: Object.freeze(entries) });
}

function routeEntryFor(evidence, handle) {
    return evidence.entries.find(
        ({ body }) => exactHandle(body.handle, handle)
    ) ?? null;
}

function seedGpuRouteActorPrecondition({
    harness,
    evidence,
    handle,
    pathIndex,
    fieldIndex,
    availabilityVersion,
    selectedTargetProgram = false,
    positionOffset = Object.freeze({ x: 0, y: 0 }),
    label
}) {
    const entry = routeEntryFor(evidence, handle);
    const stage = harness.atlas.stages[fieldIndex];
    assert(entry?.routeState.role === GPU_ROUTE_RUNTIME_ROLE.ACTOR
        && stage?.goalPosition
        && Number.isSafeInteger(entry.routeState.routeSetIndex),
    `${label}: route actor seed source missing ${JSON.stringify({
        entry,
        fieldIndex,
        stage
    })}`);
    const simulation = harness.endpoint.getBackend().simulation;
    const bodySlot = entry.body.index;
    const seededPosition = Object.freeze({
        x: stage.goalPosition.x + positionOffset.x,
        y: stage.goalPosition.y + positionOffset.y
    });
    const routeAbi = GPU_ROUTE_RUNTIME_ABI.BODY_STATE;
    const routeBytes = new ArrayBuffer(routeAbi.STRIDE);
    writeGpuRouteRuntimeState(routeBytes, 1, 0, {
        role: GPU_ROUTE_RUNTIME_ROLE.ACTOR,
        phase: GPU_ROUTE_RUNTIME_PHASE.TRAVEL,
        flags: GPU_ROUTE_RUNTIME_FLAG.GRAPH_ENABLED,
        selfEntityId: handle.entityId,
        selfIncarnation: handle.incarnation,
        currentPathIndex: pathIndex,
        routeSetIndex: entry.routeState.routeSetIndex,
        closureIndex: 0xffffffff,
        observedAvailabilityVersion: availabilityVersion,
        phaseEnteredFixedTick: 0,
        pendingFieldIndex: 0xffffffff,
        leaseGeneration: 0,
        profileCode: 0
    });
    simulation.device.queue.writeBuffer(
        simulation.buffers.routeRuntimeStates,
        bodySlot * routeAbi.STRIDE,
        routeBytes
    );

    const physicsAbi = GPU_CIRCLE_BODY_ABI.PHYSICS;
    const physicsBytes = new ArrayBuffer(28);
    const physicsView = new DataView(physicsBytes);
    physicsView.setFloat32(0, seededPosition.x, true);
    physicsView.setFloat32(4, seededPosition.y, true);
    physicsView.setFloat32(8, 0, true);
    physicsView.setFloat32(12, 0, true);
    physicsView.setFloat32(16, entry.body.radius, true);
    physicsView.setFloat32(20, entry.body.inverseMass, true);
    // Route/capability interaction is the fixture subject. Keep the actors at
    // their exact transition goal without allowing the generic body solver to
    // move the deliberately co-located cross-system probes before RouteRuntime
    // consumes that precondition.
    physicsView.setUint32(
        24,
        GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        true
    );
    simulation.device.queue.writeBuffer(
        simulation.buffers.physics,
        bodySlot * physicsAbi.STRIDE,
        physicsBytes
    );

    const flowFieldBytes = new ArrayBuffer(4);
    new DataView(flowFieldBytes).setUint32(0, fieldIndex, true);
    simulation.device.queue.writeBuffer(
        simulation.buffers.simulation,
        bodySlot * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE
            + GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_FIELD_INDEX,
        flowFieldBytes
    );

    const temporaryAbi = GPU_CIRCLE_BODY_ABI.TEMPORARY;
    const temporaryBytes = new ArrayBuffer(temporaryAbi.STRIDE);
    const temporaryView = new DataView(temporaryBytes);
    temporaryView.setFloat32(
        temporaryAbi.PREVIOUS_X,
        seededPosition.x,
        true
    );
    temporaryView.setFloat32(
        temporaryAbi.PREVIOUS_Y,
        seededPosition.y,
        true
    );
    temporaryView.setFloat32(
        temporaryAbi.PREDICTED_X,
        seededPosition.x,
        true
    );
    temporaryView.setFloat32(
        temporaryAbi.PREDICTED_Y,
        seededPosition.y,
        true
    );
    temporaryView.setInt32(temporaryAbi.GRID_INDEX, -1, true);
    temporaryView.setUint32(
        temporaryAbi.PREVIOUS_FLOW_FIELD_INDEX,
        fieldIndex,
        true
    );
    simulation.device.queue.writeBuffer(
        simulation.buffers.temporary,
        bodySlot * temporaryAbi.STRIDE,
        temporaryBytes
    );

    if (selectedTargetProgram) {
        const behaviorAbi = GPU_CIRCLE_SELECTED_TARGET_PROJECTILE_STATE_ABI;
        const behaviorBytes = new ArrayBuffer(behaviorAbi.STRIDE);
        const behaviorView = new DataView(behaviorBytes);
        behaviorView.setUint32(
            behaviorAbi.PROGRAM_ID,
            GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.SELECTED_TARGET_PROJECTILE,
            true
        );
        behaviorView.setUint32(behaviorAbi.TARGET_SLOT, 0xffffffff, true);
        behaviorView.setUint32(
            behaviorAbi.TARGET_ENTITY_ID,
            0xffffffff,
            true
        );
        behaviorView.setUint32(
            behaviorAbi.TARGET_INCARNATION,
            0xffffffff,
            true
        );
        behaviorView.setInt32(behaviorAbi.CORE_DAMAGE_FIXED_POINT, 100, true);
        simulation.device.queue.writeBuffer(
            simulation.buffers.enemyBehaviorStates,
            bodySlot * behaviorAbi.STRIDE,
            behaviorBytes
        );
    }
}

async function seedGpuRouteClosureCrossSystemPreconditions({
    harness,
    evidence,
    trappedHandle,
    activeHandle,
    crossHandles,
    upperPathIndex,
    upperClosure,
    availabilityVersion
}) {
    const waitingEntries = [
        ['trapped', trappedHandle],
        ...BRANCH_REROUTE_BEHAVIOR_ACTORS.map(
            ({ key }) => [key, crossHandles.get(key)]
        )
    ];
    const exactGoalOffset = Object.freeze({ x: 0, y: 0 });
    for (let index = 0; index < waitingEntries.length; index++) {
        const [label, handle] = waitingEntries[index];
        seedGpuRouteActorPrecondition({
            harness,
            evidence,
            handle,
            pathIndex: upperPathIndex,
            fieldIndex: upperClosure.clearanceFieldIndex,
            availabilityVersion,
            selectedTargetProgram: label === 'rhom',
            positionOffset: exactGoalOffset,
            label: `${label} WAIT precondition`
        });
    }
    const upperCompiledPath = harness.atlas.routes.find(
        ({ pathId }) => pathId === CORK_DUAL_ROUTE_UPPER_PATH_ID
    );
    assert(Number.isSafeInteger(upperCompiledPath?.firstFieldIndex),
        'upper route first flow field missing');
    const rerouteEntries = [
        ['active', activeHandle],
        ...BRANCH_REROUTE_SIDE_PLANE_ACTORS.map(
            ({ key }) => [key, crossHandles.get(key)]
        )
    ];
    for (let index = 0; index < rerouteEntries.length; index++) {
        const [label, handle] = rerouteEntries[index];
        seedGpuRouteActorPrecondition({
            harness,
            evidence,
            handle,
            pathIndex: upperPathIndex,
            fieldIndex: upperCompiledPath.firstFieldIndex,
            availabilityVersion,
            positionOffset: exactGoalOffset,
            label: `${label} reroute precondition`
        });
    }
    await harness.endpoint.getBackend().simulation.device.queue
        .onSubmittedWorkDone();
}

async function drainNormalBoundary(endpoint, director, tick, label) {
    const deadline = performance.now() + 8_000;
    while (performance.now() < deadline) {
        const capture = endpoint
            .commitCompletedProjectileCaptureProgramsAtFixedBoundary(tick);
        if (capture.pending === true) {
            await new Promise((resolve) => setTimeout(resolve, 4));
            continue;
        }
        assert(capture.protocolFailure == null,
            `${label}: capture protocol ${JSON.stringify(capture)}`);
        const releases = endpoint
            .commitCompletedProjectileCaptureReleaseProgramsAtFixedBoundary(tick);
        if (releases.pending === true) {
            await new Promise((resolve) => setTimeout(resolve, 4));
            continue;
        }
        assert(releases.protocolFailure == null,
            `${label}: release protocol ${JSON.stringify(releases)}`);
        const route = endpoint
            .commitCompletedRouteAvailabilityProgramsAtFixedBoundary(tick);
        if (route.pending === true) {
            await new Promise((resolve) => setTimeout(resolve, 4));
            continue;
        }
        assert(route.protocolFailure == null,
            `${label}: route protocol ${JSON.stringify(route)}`);
        const observed = director.observeCompletedPrograms(route);
        assert(observed?.accepted === true && !director.requiresRecovery(),
            `${label}: route observe ${JSON.stringify(director.getStatus())}`);
        const runtime = endpoint.getRouteAvailabilityRuntimeStatus();
        const status = director.getStatus();
        if (runtime.deviceGeneration === status.deviceGeneration
            && runtime.authoritativeEpoch === status.authoritativeEpoch) {
            director.observeRuntimeStatus(runtime);
        } else {
            assert(status.rosterCount === 0
                && runtime.rosterCount === 0
                && runtime.leaseCount === 0
                && runtime.closedPathIds.length === 0
                && director.resetGpuBinding({
                    graphContentKey: runtime.graphContentKey,
                    sessionGeneration: runtime.sessionGeneration,
                    deviceGeneration: runtime.deviceGeneration,
                    authoritativeEpoch: runtime.authoritativeEpoch,
                    availabilityVersion: runtime.availabilityVersion
                }), `${label}: idle route rebind failed`);
        }
        assert(!director.requiresRecovery(),
            `${label}: runtime observe ${JSON.stringify(director.getStatus())}`);
        return Object.freeze({
            capture,
            releases,
            route,
            events: endpoint.getLastCompletedSimulationEvents()
        });
    }
    throw new Error(`${label}: boundary drain timeout`);
}

async function advanceTick({
    harness,
    tick,
    label,
    beforeCommit = null,
    afterCommit = null
}) {
    const { endpoint, director } = harness;
    const boundary = await drainNormalBoundary(endpoint, director, tick, label);
    await beforeCommit?.(boundary);
    const lifecycle = endpoint.commitAtFixedBoundary(tick);
    assert(lifecycle?.recoveryRequired !== true,
        `${label}: lifecycle recovery ${JSON.stringify(lifecycle)}`);
    director.observeFixedCommit(lifecycle, tick);
    director.observeLifecycle(lifecycle, tick);
    assert(!director.requiresRecovery(),
        `${label}: lifecycle observe ${JSON.stringify(director.getStatus())}`);
    await afterCommit?.(lifecycle, boundary);
    assert(endpoint.fixedUpdate(FIXED_DELTA, tick),
        `${label}: fixed submit failed`);
    await waitForGpuBoundary(endpoint, label);
    return Object.freeze({
        boundary,
        lifecycle,
        evidence: await readRouteEvidence(endpoint, label)
    });
}

function getCompiledPathIndex(harness, pathId) {
    const path = harness.atlas.routeGraph.paths.find(
        (entry) => entry.pathId === pathId
    );
    assert(path, `compiled path missing: ${pathId}`);
    return path.pathIndex;
}

function getCompiledUpperClosure(harness) {
    const closure = harness.atlas.routeGraph.closures.find(
        (entry) => entry.id === CORK_DUAL_ROUTE_UPPER_CLOSURE_ID
    );
    assert(closure, 'compiled upper closure missing');
    return closure;
}

function createPreSwitchArrivalPosition(
    harness,
    direction,
    routeNormal,
    laneOffset
) {
    const compiledPath = harness.atlas.routes.find(
        ({ pathId }) => pathId === CORK_DUAL_ROUTE_UPPER_PATH_ID
    );
    const firstStage = Number.isSafeInteger(compiledPath?.firstFieldIndex)
        ? harness.atlas.stages[compiledPath.firstFieldIndex]
        : null;
    const cellSize = harness.atlas.cellSize;
    const cellSizeX = typeof cellSize === 'number' ? cellSize : cellSize?.x;
    const cellSizeY = typeof cellSize === 'number' ? cellSize : cellSize?.y;
    const transitionRadius = firstStage?.transitionRadius
        ?? harness.atlas.transitionRadius
        ?? Math.min(cellSizeX, cellSizeY) * 0.75;
    assert(firstStage?.goalPosition
        && Number.isFinite(transitionRadius)
        && transitionRadius > 0,
    `upper switch transition geometry missing: ${JSON.stringify({
        compiledPath,
        firstStage,
        cellSize,
        transitionRadius
    })}`);
    // Spawn one small movement step outside the actual transition circle. The
    // open T62 submit moves the actor into it without advancing the field; the
    // closed T63 route pass therefore exercises the forward-switch reroute.
    const outsideMargin = Math.min(transitionRadius * 0.05, 0.01);
    return Object.freeze({
        x: firstStage.goalPosition.x
            - direction.x * (transitionRadius + outsideMargin)
            + routeNormal.x * laneOffset,
        y: firstStage.goalPosition.y
            - direction.y * (transitionRadius + outsideMargin)
            + routeNormal.y * laneOffset
    });
}

function routeNavigationRemainsActive(entry) {
    return entry?.routeState.phase === GPU_ROUTE_RUNTIME_PHASE.TRAVEL
        && entry.routeState.pendingFieldIndex === 0xffffffff
        && (((entry.body.simulationMeta ?? 0) & 2) !== 0
            || Math.hypot(entry.body.velocity.x, entry.body.velocity.y) > 0.001);
}

function allBlockedBranchActorsKeepNavigating(
    evidence,
    trappedHandle,
    crossHandles
) {
    const handles = [
        trappedHandle,
        ...BRANCH_REROUTE_BEHAVIOR_ACTORS.map(
            ({ key }) => crossHandles.get(key)
        )
    ];
    return handles.every((handle) => {
        const entry = routeEntryFor(evidence, handle);
        return routeNavigationRemainsActive(entry);
    });
}

function validateFutureWaveSelection(harness, closedAvailability) {
    const wave = new WaveDirector({
        waveDefinition: CORK_DUAL_ROUTE_WAVE_01_DATA
    });
    wave.init(harness.tileMap);
    const requests = [];
    const futureQueueTick = 2 + Math.round(
        CORK_DUAL_ROUTE_FOLLOWUP_WAIT_SECONDS / FIXED_DELTA
    );
    const queued = wave.queueSpawnsForFixedTick(futureQueueTick, {
        requestSpawnBatch(batch) {
            requests.push(...batch);
            return Object.freeze({
                accepted: true,
                requestedCount: batch.length,
                queuedCount: batch.length
            });
        }
    }, closedAvailability);
    const futureFollowers = requests.filter(
        ({ commandId }) => commandId.includes(':future-route-followers:')
    );
    return queued === 3
        && requests.length === 3
        && futureFollowers.length === 2
        && futureFollowers.every(
            ({ intent }) => intent.pathId === CORK_DUAL_ROUTE_LOWER_PATH_ID
                && intent.routeAvailabilityVersion
                    === closedAvailability.availabilityVersion
        );
}

function runFormationRouteClosurePolicy() {
    const tileMap = new TileMap(CORK_DUAL_ROUTE_MAP_DATA);
    const graphContentKey = createRouteFlowFieldAtlas(tileMap).contentKey;
    const wave = new WaveDirector({
        waveDefinition: Object.freeze({
            waveId: 'nw-cork-formation-mid-spawn-policy',
            mapId: CORK_DUAL_ROUTE_MAP_DATA.id,
            timeline: Object.freeze([Object.freeze({
                timelineEntryId: 'sequential-two-row-formation',
                type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
                formation: Object.freeze({
                    groupId: 'cork-pinned-route-formation',
                    memberCount: 4,
                    coordinateSystem:
                        AUTHORED_FORMATION_COORDINATE_SYSTEM.PATH_RELATIVE,
                    spawnMode:
                        AUTHORED_FORMATION_SPAWN_MODE.SEQUENTIAL_ROWS,
                    rowDelayTicks: 1,
                    keepFormation: false,
                    layout: Object.freeze(['SS', 'SS']),
                    symbolMap: Object.freeze({
                        S: BASIC_SQUARE_ENEMY_DATA.id
                    }),
                    routeBinding: Object.freeze({
                        routeSetId: CORK_DUAL_ROUTE_ROUTE_SET_ID
                    }),
                    policyId: 'corebound',
                    rowSpacingTiles: 1,
                    columnSpacingTiles: 1
                })
            })])
        })
    });
    assert(wave.init(tileMap), 'formation route policy WaveDirector init failed');
    const batches = [];
    const sink = Object.freeze({
        requestSpawnBatch(batch) {
            batches.push(Object.freeze([...batch]));
            return Object.freeze({
                accepted: true,
                requestedCount: batch.length,
                queuedCount: batch.length
            });
        }
    });
    const availability = (availabilityVersion, closedPathIds) => Object.freeze({
        graphContentKey,
        availabilityVersion,
        closedPathIds: Object.freeze([...closedPathIds])
    });
    try {
        const firstQueued = wave.queueSpawnsForFixedTick(
            1,
            sink,
            availability(1, [])
        );
        const closeSinkCountBefore = batches.length;
        const closedQueued = wave.queueSpawnsForFixedTick(
            2,
            sink,
            availability(2, [CORK_DUAL_ROUTE_UPPER_PATH_ID])
        );
        const closedStatus = wave.getStatus();
        const closeSinkCallCount = batches.length - closeSinkCountBefore;
        const reopenBatchCountBefore = batches.length;
        const reopenedQueued = wave.queueSpawnsForFixedTick(
            3,
            sink,
            availability(3, [])
        );
        const reopenedBatches = batches.slice(reopenBatchCountBefore);
        const firstBatch = batches[0] ?? [];
        const reopenedBatch = reopenedBatches[0] ?? [];
        const firstCommandTails = firstBatch.map(({ commandId }) => (
            commandId.slice(commandId.lastIndexOf(':') + 1)
        ));
        const reopenedCommandTails = reopenedBatch.map(({ commandId }) => (
            commandId.slice(commandId.lastIndexOf(':') + 1)
        ));
        const originalRoutePreserved = firstBatch.every(
            ({ intent }) => intent.pathId === CORK_DUAL_ROUTE_UPPER_PATH_ID
        ) && reopenedBatch.every(
            ({ intent }) => intent.pathId === CORK_DUAL_ROUTE_UPPER_PATH_ID
        );
        const noArbitrarySplit = reopenedBatches.length === 1
            && reopenedBatch.length === 2
            && reopenedCommandTails.join(',') === 'member-1-0,member-1-1';
        assert(firstQueued === 2
            && firstCommandTails.join(',') === 'member-0-0,member-0-1'
            && closedQueued === 0
            && closeSinkCallCount === 0
            && closedStatus.blockedSpawnCount === 2
            && closedStatus.remainingSpawnCount === 2
            && reopenedQueued === 2
            && originalRoutePreserved
            && noArbitrarySplit
            && wave.getStatus().blockedSpawnCount === 0
            && wave.getStatus().remainingSpawnCount === 0,
        `formation route closure policy mismatch ${JSON.stringify({
            firstQueued,
            closedQueued,
            closedStatus,
            reopenedQueued,
            batches
        })}`);
        return Object.freeze({
            firstRowMemberCount: firstQueued,
            originalPathId: CORK_DUAL_ROUTE_UPPER_PATH_ID,
            closeQueuedMemberCount: closedQueued,
            closeSinkCallCount,
            backlogMemberCount: closedStatus.blockedSpawnCount,
            backlogRetained: closedStatus.blockedSpawnCount === 2,
            reopenBatchCount: reopenedBatches.length,
            reopenedMemberCount: reopenedQueued,
            reopenedOnOriginalPath: originalRoutePreserved,
            partialRowCount: noArbitrarySplit ? 0 : 1,
            arbitraryRowSplit: !noArbitrarySplit,
            finalBacklogMemberCount: wave.getStatus().blockedSpawnCount
        });
    } finally {
        wave.destroy();
    }
}

async function runClosureRoutingAndInteraction(device, format) {
    const harness = createRouteHarness(device, format, MAIN_HARNESS_CAPACITY);
    const {
        endpoint,
        director,
        upperRoute,
        initialRuntime
    } = harness;
    const directionLength = Math.hypot(
        upperRoute.waypoints[1].x - upperRoute.waypoints[0].x,
        upperRoute.waypoints[1].y - upperRoute.waypoints[0].y
    );
    const direction = Object.freeze({
        x: (upperRoute.waypoints[1].x - upperRoute.waypoints[0].x)
            / directionLength,
        y: (upperRoute.waypoints[1].y - upperRoute.waypoints[0].y)
            / directionLength
    });
    const routeNormal = Object.freeze({ x: -direction.y, y: direction.x });
    const closurePosition = upperRoute.waypoints[4];
    const upperClosure = getCompiledUpperClosure(harness);
    const upperPathIndex = getCompiledPathIndex(
        harness,
        CORK_DUAL_ROUTE_UPPER_PATH_ID
    );
    const lowerPathIndex = getCompiledPathIndex(
        harness,
        CORK_DUAL_ROUTE_LOWER_PATH_ID
    );
    const upperCompiledPath = harness.atlas.routes.find(
        ({ pathId }) => pathId === CORK_DUAL_ROUTE_UPPER_PATH_ID
    );
    const routeSetCoreFieldIndex = upperCompiledPath.firstFieldIndex
        + upperCompiledPath.fieldCount - 1;
    let corkHandle;
    let trappedHandle;
    let activeHandle;
    let towerHandle;
    let pentaHandle;
    let futureHandle;
    let projectileHandle;
    let assignmentCompletion = null;
    let closeCompletion = null;
    let reopenCompletion = null;
    let cleanupCompletion = null;
    let tick62Evidence = null;
    let tick63Evidence = null;
    let tick64Evidence = null;
    let precloseEvidence = null;
    let precloseGpuAvailability = null;
    let closeSubmitGpuAvailability = null;
    let closeFlowPublication = null;
    let reopenFlowPublication = null;
    let effectStage = null;
    let effectCompletion = null;
    let corkEffectSummary = null;
    let towerSurfaceContactEvent = null;
    let towerBeforeBlock = null;
    let futureSpawnSelectedAlternative = false;
    let registryCountAtClose = 0;
    const crossHandles = new Map();
    let crossSystemEvidence = null;

    try {
        assert(endpoint.requestSpawnBatch([{
            intent: createCorkIntent(harness, 1, upperRoute.waypoints[1]),
            targetFixedTick: 1,
            commandId: 'cork-main:owner'
        }]).accepted, 'Cork owner spawn rejected');
        const tick1 = await advanceTick({
            harness,
            tick: 1,
            label: 'Cork main T1',
            afterCommit(lifecycle) {
                corkHandle = requireSpawnHandle(lifecycle, 'cork-main:owner');
            }
        });

        const tick2 = await advanceTick({
            harness,
            tick: 2,
            label: 'Cork main T2',
            beforeCommit() {
                seedGpuBodyPose(
                    endpoint,
                    tick1.evidence,
                    corkHandle,
                    closurePosition,
                    'Cork main natural switch assignment'
                );
            }
        });
        assignmentCompletion = tick2.boundary.route;
        assert(assignmentCompletion.assignments.some(
            ({ ownerHandle }) => exactHandle(ownerHandle, corkHandle)
        ), 'Cork assignment completion missing');

        for (let tick = 3; tick <= 60; tick++) {
            await advanceTick({
                harness,
                tick,
                label: `Cork expansion T${tick}`,
                beforeCommit() {
                    const actorPlan = tick === 29
                        ? Object.freeze({
                            commandId: 'cork-main:trapped',
                            spawnSequence: 29,
                            crossActors: BRANCH_REROUTE_BEHAVIOR_ACTORS
                        })
                        : null;
                    if (!actorPlan) return;
                    const upperSwitchPosition = upperRoute.waypoints[1];
                    const requests = [{
                        intent: createDynamicRouteIntent({
                            definition: ROUTE_ACTOR_DEFINITION,
                            route: upperRoute,
                            position: upperSwitchPosition,
                            spawnSequence: actorPlan.spawnSequence,
                            availability: director.getAvailabilitySnapshot(),
                            graphContentKey: initialRuntime.graphContentKey
                        }),
                        targetFixedTick: tick,
                        commandId: actorPlan.commandId
                    }, ...actorPlan.crossActors.map((actor, index) => ({
                        intent: createCrossSystemRouteIntent({
                            harness,
                            definition: actor.definition,
                            position: Object.freeze({
                                x: upperSwitchPosition.x
                                    + routeNormal.x
                                        * CROSS_ACTOR_LANE_OFFSETS[index],
                                y: upperSwitchPosition.y
                                    + routeNormal.y
                                        * CROSS_ACTOR_LANE_OFFSETS[index]
                            }),
                            spawnSequence: actorPlan.spawnSequence + index + 1
                        }),
                        targetFixedTick: tick,
                        commandId: `cork-cross:${actor.key}`
                    }))];
                    assert(endpoint.requestSpawnBatch(requests).accepted,
                        `${actorPlan.commandId} cross-system spawn rejected`);
                },
                afterCommit(lifecycle) {
                    if (tick === 29) {
                        trappedHandle = requireSpawnHandle(
                            lifecycle,
                            'cork-main:trapped'
                        );
                    }
                    const actors = tick === 29
                        ? BRANCH_REROUTE_BEHAVIOR_ACTORS
                        : [];
                    for (const actor of actors) {
                        crossHandles.set(actor.key, requireSpawnHandle(
                            lifecycle,
                            `cork-cross:${actor.key}`
                        ));
                    }
                }
            });
        }

        const tick61 = await advanceTick({
            harness,
            tick: 61,
            label: 'Cork routed actors approach T61'
        });
        precloseEvidence = tick61.evidence;
        precloseGpuAvailability = await readRouteAvailabilityGpuEvidence(
            endpoint,
            harness.atlas.routeGraph.closures.length,
            'preclose-t61'
        );
        const corkBeforeClose = routeEntryFor(precloseEvidence, corkHandle);
        const preclosePhysics = corkBeforeClose
            ? unpackGpuCirclePhysicsMeta(corkBeforeClose.body.physicsMeta)
            : null;
        const precloseInteraction = corkBeforeClose
            ? unpackGpuCircleInteractionMeta(corkBeforeClose.body.interactionMeta)
            : null;
        assert(corkBeforeClose?.routeState.phase === GPU_ROUTE_RUNTIME_PHASE.EXPAND
            && corkBeforeClose.body.radius < 3
            && preclosePhysics?.bodyLayer
                === GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            && preclosePhysics.collisionMask === 0
            && precloseInteraction?.interactionLayer
                === GPU_CIRCLE_BODY_INTERACTION_LAYER.ENEMY
            && precloseGpuAvailability.status === 0
            && precloseGpuAvailability.sourceTick === 61
            && precloseGpuAvailability.completedThroughTick === 61
            && precloseGpuAvailability.availabilityVersion
                === director.getAvailabilitySnapshot().availabilityVersion
            && !director.getAvailabilitySnapshot().closedPathIds.includes(
                CORK_DUAL_ROUTE_UPPER_PATH_ID
            )
            && precloseGpuAvailability.records[upperClosure.closureIndex]
                .state === GPU_ROUTE_AVAILABILITY_STATE.LEASED,
        `Cork preclose EXPAND/open/nonblocking mismatch: ${JSON.stringify({
            corkBeforeClose,
            preclosePhysics,
            precloseInteraction,
            precloseGpuAvailability
        })}`);

        const tick62 = await advanceTick({
            harness,
            tick: CORK_EXPANSION_CLOSE_SUBMIT_TICK,
            label: 'Cork close submit T62',
            beforeCommit() {
                const towerPosition = Object.freeze({
                    x: closurePosition.x
                        - direction.x * TOWER_BLOCKER_PROBE_START_DISTANCE,
                    y: closurePosition.y
                        - direction.y * TOWER_BLOCKER_PROBE_START_DISTANCE
                });
                const pentaPosition = Object.freeze({
                    x: closurePosition.x
                        - direction.x * PENTA_BLOCKING_PROBE_DISTANCE
                        + routeNormal.x * 1.5,
                    y: closurePosition.y
                        - direction.y * PENTA_BLOCKING_PROBE_DISTANCE
                        + routeNormal.y * 1.5
                });
                const activePosition = createPreSwitchArrivalPosition(
                    harness,
                    direction,
                    routeNormal,
                    0
                );
                const rerouteRequests = BRANCH_REROUTE_SIDE_PLANE_ACTORS.map(
                    (actor, index) => Object.freeze({
                        intent: createCrossSystemRouteIntent({
                            harness,
                            definition: actor.definition,
                            position: createPreSwitchArrivalPosition(
                                harness,
                                direction,
                                routeNormal,
                                CROSS_ACTOR_LANE_OFFSETS[index]
                            ),
                            spawnSequence: 63 + index
                        }),
                        targetFixedTick: 62,
                        commandId: `cork-cross:${actor.key}`
                    })
                );
                assert(endpoint.requestSpawnBatch([{
                    intent: createGpuTowerSpawnIntent({ position: towerPosition }),
                    targetFixedTick: 62,
                    commandId: 'cork-main:tower'
                }, {
                    intent: createPentaIntent(harness, 62, pentaPosition),
                    targetFixedTick: 62,
                    commandId: 'cork-main:penta'
                }, {
                    intent: createDynamicRouteIntent({
                        definition: ROUTE_ACTOR_DEFINITION,
                        route: upperRoute,
                        position: activePosition,
                        spawnSequence: 62,
                        availability: director.getAvailabilitySnapshot(),
                        graphContentKey: initialRuntime.graphContentKey
                    }),
                    targetFixedTick: 62,
                    commandId: 'cork-main:active'
                }, ...rerouteRequests]).accepted,
                'Tower/P/reroute cross-system spawn rejected');
            },
            afterCommit(lifecycle) {
                towerHandle = requireSpawnHandle(lifecycle, 'cork-main:tower');
                pentaHandle = requireSpawnHandle(lifecycle, 'cork-main:penta');
                activeHandle = requireSpawnHandle(
                    lifecycle,
                    'cork-main:active'
                );
                for (const actor of BRANCH_REROUTE_SIDE_PLANE_ACTORS) {
                    crossHandles.set(actor.key, requireSpawnHandle(
                        lifecycle,
                        `cork-cross:${actor.key}`
                    ));
                }
            }
        });
        tick62Evidence = tick62.evidence;
        closeSubmitGpuAvailability = await readRouteAvailabilityGpuEvidence(
            endpoint,
            harness.atlas.routeGraph.closures.length,
            'close-submit-t62'
        );
        registryCountAtClose = endpoint.getRegistry().getActiveCount();
        const corkAtClose = routeEntryFor(tick62Evidence, corkHandle);
        towerBeforeBlock = findBody(tick62Evidence.bodies, towerHandle);
        const closePhysics = corkAtClose
            ? unpackGpuCirclePhysicsMeta(corkAtClose.body.physicsMeta)
            : null;
        const closeInteraction = corkAtClose
            ? unpackGpuCircleInteractionMeta(corkAtClose.body.interactionMeta)
            : null;
        assert(corkAtClose?.routeState.phase === GPU_ROUTE_RUNTIME_PHASE.BLOCKING
            && Math.abs(corkAtClose.body.radius - 3) <= 0.0001
            && closePhysics?.bodyLayer
                === GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            && closePhysics.collisionMask === 0
            && corkAtClose.body.inverseMass === 0
            && closeInteraction?.interactionLayer
                === GPU_CIRCLE_BODY_INTERACTION_LAYER.ENEMY
            && closeSubmitGpuAvailability.status === 0
            && closeSubmitGpuAvailability.sourceTick
                === CORK_EXPANSION_CLOSE_SUBMIT_TICK
            && closeSubmitGpuAvailability.completedThroughTick
                === CORK_EXPANSION_CLOSE_SUBMIT_TICK
            && closeSubmitGpuAvailability.availabilityVersion
                === precloseGpuAvailability.availabilityVersion + 1
            && closeSubmitGpuAvailability.records[upperClosure.closureIndex]
                .state === GPU_ROUTE_AVAILABILITY_STATE.CLOSED
            && closeSubmitGpuAvailability.records[upperClosure.closureIndex]
                .ownerEntityId === corkHandle.entityId
            && closeSubmitGpuAvailability.records[upperClosure.closureIndex]
                .ownerIncarnation === corkHandle.incarnation
            && closeSubmitGpuAvailability.flowReadyAvailabilityVersion
                < closeSubmitGpuAvailability.records[
                    upperClosure.closureIndex
                ].changedAvailabilityVersion,
        `Cork staged close was not anchored/nonblocking: ${JSON.stringify({
            corkAtClose,
            closePhysics,
            closeInteraction,
            closeSubmitGpuAvailability
        })}`);
        await seedGpuRouteClosureCrossSystemPreconditions({
            harness,
            evidence: tick62Evidence,
            trappedHandle,
            activeHandle,
            crossHandles,
            upperPathIndex,
            upperClosure,
            availabilityVersion:
                closeSubmitGpuAvailability.availabilityVersion
        });
        const tick63 = await advanceTick({
            harness,
            tick: CORK_CLOSE_COMPLETION_TICK,
            label: 'Cork closed interaction T63',
            async beforeCommit(boundary) {
                closeCompletion = boundary.route;
                assert(closeCompletion.closures.some(
                    ({ ownerHandle }) => exactHandle(ownerHandle, corkHandle)
                ) && closeCompletion.closedPathIds.length === 1
                    && closeCompletion.sourceTick
                        === CORK_EXPANSION_CLOSE_SUBMIT_TICK
                    && closeCompletion.availabilityVersion
                        === closeSubmitGpuAvailability.availabilityVersion,
                `Cork close completion missing: ${JSON.stringify(closeCompletion)}`);
                closeFlowPublication = await pumpRouteFlowFieldUntilReady(
                    endpoint,
                    harness.atlas.routeGraph.closures.length,
                    closeSubmitGpuAvailability.records[
                        upperClosure.closureIndex
                    ].changedAvailabilityVersion,
                    'close-flow-publication'
                );
                assert(closeFlowPublication.evidence
                        .flowReadyAvailabilityVersion
                    === closeSubmitGpuAvailability.availabilityVersion,
                `closed flow field version did not publish: ${JSON.stringify({
                    closeSubmitGpuAvailability,
                    closeFlowPublication
                })}`);
                futureSpawnSelectedAlternative = validateFutureWaveSelection(
                    harness,
                    director.getAvailabilitySnapshot()
                );
                const futureIntent = createDynamicRouteIntent({
                    definition: ROUTE_ACTOR_DEFINITION,
                    route: upperRoute,
                    position: upperRoute.waypoints[0],
                    spawnSequence: 63,
                    availability: director.getAvailabilitySnapshot(),
                    graphContentKey: initialRuntime.graphContentKey
                });
                assert(endpoint.requestSpawnBatch([{
                    intent: futureIntent,
                    targetFixedTick: 63,
                    commandId: 'cork-main:future'
                }]).accepted, 'future actor/projectile spawn rejected');
                const control = endpoint.requestBodyControl({
                    handle: towerHandle,
                    moveIntentX: direction.x,
                    moveIntentY: direction.y
                }, 63, 'cork-main:tower-control');
                assert(control.accepted, `Tower control rejected: ${JSON.stringify(control)}`);
            },
            afterCommit(lifecycle) {
                futureHandle = requireSpawnHandle(lifecycle, 'cork-main:future');
                effectStage = endpoint.getBackend().stageEffectPulseProgramBatch({
                    abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
                    sourceTick: CORK_CLOSE_COMPLETION_TICK,
                    batchIdFingerprint: 0x7c0c103f,
                    records: [createBlockingCorkBoostPulse(
                        pentaHandle,
                        CORK_CLOSE_COMPLETION_TICK
                    )]
                });
                assert(effectStage.accepted === true
                    && effectStage.stagedCount === 1,
                `P Effect pulse stage rejected: ${JSON.stringify(effectStage)}`);
            }
        });
        tick63Evidence = tick63.evidence;
        const blockingCorkEntry = routeEntryFor(tick63Evidence, corkHandle);
        const publishedBlockingPhysics = blockingCorkEntry
            ? unpackGpuCirclePhysicsMeta(blockingCorkEntry.body.physicsMeta)
            : null;
        const publishedBlockingInteraction = blockingCorkEntry
            ? unpackGpuCircleInteractionMeta(
                blockingCorkEntry.body.interactionMeta
            )
            : null;
        assert(blockingCorkEntry?.routeState.phase
                === GPU_ROUTE_RUNTIME_PHASE.BLOCKING
            && publishedBlockingPhysics?.bodyLayer
                === GPU_CIRCLE_BODY_COLLISION_LAYER.ROUTE_BLOCKER
            && (publishedBlockingPhysics.collisionMask
                & GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY) !== 0
            && blockingCorkEntry.body.inverseMass === 0
            && publishedBlockingInteraction?.interactionLayer
                === GPU_CIRCLE_BODY_INTERACTION_LAYER.ENEMY,
        `published Cork is not an anchored damageable blocker: ${JSON.stringify({
            blockingCorkEntry,
            publishedBlockingPhysics,
            publishedBlockingInteraction,
            closeFlowPublication
        })}`);
        effectCompletion = await waitForEffectCompletion(
            endpoint,
            'P Boost on BLOCKING Cork'
        );
        const blockingCorkBody = blockingCorkEntry?.body ?? null;
        assert(blockingCorkBody, 'P Effect target Cork body missing');
        corkEffectSummary = await readEffectSummary(
            endpoint,
            blockingCorkBody,
            corkHandle,
            'blocking-cork'
        );
        const corkBoostEvent = effectCompletion.events.find((event) => (
            event.type === GPU_EFFECT_EVENT_TYPE.INSTANCE_APPLIED
            && event.sourceEntityId === pentaHandle.entityId
            && event.sourceIncarnation === pentaHandle.incarnation
            && event.targetEntityId === corkHandle.entityId
            && event.targetIncarnation === corkHandle.incarnation
            && event.effectDefinitionCode
                === PENTA_BOOST_EFFECT_DEFINITION.effectDefinitionCode
        ));
        assert(effectCompletion.sourceTick === CORK_CLOSE_COMPLETION_TICK
            && effectCompletion.appliedInstanceCount >= 1
            && Boolean(corkBoostEvent)
            && corkEffectSummary.boostStackCount === 1,
        `P Boost did not target BLOCKING Cork: ${JSON.stringify({
            effectCompletion,
            corkEffectSummary
        })}`);

        const routingEvidenceTick = CORK_CLOSE_COMPLETION_TICK;
        const routingEvidence = tick63Evidence;
        assert(allBlockedBranchActorsKeepNavigating(
            routingEvidence,
            trappedHandle,
            crossHandles
        ), `blocked-branch actors stopped navigating: ${JSON.stringify({
            routingEvidenceTick,
            actors: [
                ['trapped', trappedHandle],
                ...BRANCH_REROUTE_BEHAVIOR_ACTORS.map(
                    ({ key }) => [key, crossHandles.get(key)]
                )
            ].map(([key, handle]) => Object.freeze({
                key,
                entry: routeEntryFor(routingEvidence, handle)
            }))
        })}`);

        const activeBefore = routeEntryFor(tick62Evidence, activeHandle);
        const activeAfter = routeEntryFor(tick63Evidence, activeHandle);
        const trappedAfter = routeEntryFor(routingEvidence, trappedHandle);
        const futureAfter = routeEntryFor(tick63Evidence, futureHandle);
        const towerAfterBlock = findBody(tick63Evidence.bodies, towerHandle);
        assert(activeBefore?.routeState.currentPathIndex === upperPathIndex,
            'active actor did not start on upper path');
        assert(routeNavigationRemainsActive(activeAfter),
            `active actor stopped on rebuilt flow: ${JSON.stringify(activeAfter)}`);
        assert(activeAfter.body.flowFieldIndex === routeSetCoreFieldIndex,
            `active actor did not adopt route-set Core field: ${JSON.stringify(activeAfter)}`);
        assert(routeNavigationRemainsActive(trappedAfter)
            && trappedAfter.body.flowFieldIndex === routeSetCoreFieldIndex,
            `blocked-branch actor stopped on rebuilt flow: ${JSON.stringify(trappedAfter)}`);
        assert(futureAfter?.routeState.currentPathIndex === lowerPathIndex,
            `future actor did not select alternative: ${JSON.stringify(futureAfter)}`);

        const behaviorRerouteEvidence = BRANCH_REROUTE_BEHAVIOR_ACTORS.map((actor) => {
            const handle = crossHandles.get(actor.key);
            const before = routeEntryFor(tick62Evidence, handle);
            const after = routeEntryFor(routingEvidence, handle);
            const velocityMagnitude = after
                ? Math.hypot(after.body.velocity.x, after.body.velocity.y)
                : Number.POSITIVE_INFINITY;
            const programId = after?.body.enemyBehaviorState?.programId;
            const navigationActive = routeNavigationRemainsActive(after);
            assert(before?.routeState.currentPathIndex === upperPathIndex
                && programId === actor.programId
                && navigationActive
                && after.body.flowFieldIndex === routeSetCoreFieldIndex,
            `${actor.key} rebuilt-flow navigation mismatch ${JSON.stringify({
                before,
                after,
                velocityMagnitude,
                expectedProgramId: actor.programId
            })}`);
            return Object.freeze({
                key: actor.key,
                definitionId: actor.definition.id,
                programId,
                routePhase: after.routeState.phase,
                pendingFieldIndex: after.routeState.pendingFieldIndex,
                velocityMagnitude,
                navigationActive,
                routeOwnedWait: false,
                reachedAtFixedTick: routingEvidenceTick,
                recoveryRequired: false
            });
        });
        const flowRerouteEvidence = BRANCH_REROUTE_SIDE_PLANE_ACTORS.map((actor) => {
            const handle = crossHandles.get(actor.key);
            const before = routeEntryFor(tick62Evidence, handle);
            const after = routeEntryFor(tick63Evidence, handle);
            const navigationActive = routeNavigationRemainsActive(after);
            assert(before?.routeState.currentPathIndex === upperPathIndex
                && navigationActive
                && after.body.flowFieldIndex === routeSetCoreFieldIndex,
            `${actor.key} stopped instead of following rebuilt flow ${JSON.stringify({
                before,
                after
            })}`);
            return Object.freeze({
                key: actor.key,
                definitionId: actor.definition.id,
                routePhase: after.routeState.phase,
                currentPathIndex: after.routeState.currentPathIndex,
                navigationActive,
                waited: false,
                recoveryRequired: false
            });
        });
        const ringBody = routeEntryFor(
            tick63Evidence,
            crossHandles.get('ring')
        )?.body;
        const jorangBody = routeEntryFor(
            tick63Evidence,
            crossHandles.get('jorang')
        )?.body;
        const hexaBody = routeEntryFor(
            tick63Evidence,
            crossHandles.get('hexa')
        )?.body;
        assert(ringBody && jorangBody && hexaBody,
            'cross-system R/J/H body evidence missing');
        const hexaFormationState = await readFormationState(
            endpoint,
            hexaBody,
            crossHandles.get('hexa'),
            'route-closure-hexa'
        );
        const ringCaptureState = await readProjectileCaptureState(
            endpoint,
            ringBody,
            crossHandles.get('ring'),
            'route-closure-ring'
        );
        const ringCaptureStatePreserved
            = ringCaptureState.role
                === GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR
            && ringCaptureState.phase
                === GPU_PROJECTILE_CAPTURE_PHASE.IDLE;
        const jorangAtomicStatePreserved
            = jorangBody.atomicTransformState.phase
                === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.ARMED;
        const hexaFormationStateActive = (hexaFormationState.flags
            & GPU_FORMATION_BODY_STATE_FLAG.ACTIVE) !== 0;
        assert(ringCaptureStatePreserved
            && jorangAtomicStatePreserved
            && hexaFormationStateActive
            && hexaFormationState.memberCount === 1
            && !endpoint.requiresRecovery()
            && !director.requiresRecovery(),
        `cross-system side-plane state mismatch ${JSON.stringify({
            ring: ringCaptureState,
            jorang: jorangBody?.atomicTransformState,
            hexaFormationState,
            endpoint: endpoint.getStatus(),
            director: director.getStatus()
        })}`);
        crossSystemEvidence = Object.freeze({
            behaviorRerouteActors: Object.freeze(behaviorRerouteEvidence),
            flowRerouteActors: Object.freeze(flowRerouteEvidence),
            behaviorActorsAvoidedWait: behaviorRerouteEvidence.every(
                (entry) => entry.routeOwnedWait === false
                    && entry.navigationActive === true
            ),
            ringCaptureRole: ringCaptureState.role,
            ringCapturePhase: ringCaptureState.phase,
            ringCaptureStatePreserved,
            jorangAtomicPhase: jorangBody.atomicTransformState.phase,
            jorangAtomicStatePreserved,
            hexaFormationFlags: hexaFormationState.flags,
            hexaFormationStateActive,
            hexaFormationMemberCount: hexaFormationState.memberCount,
            recoveryRequired: false
        });

        const projectileSubmitTick = routingEvidenceTick + 1;
        const deathCommitTick = projectileSubmitTick + 1;
        const cleanupCommitTick = deathCommitTick + 1;
        const replacementSpawnTick = cleanupCommitTick + 1;
        const replacementLeaseTick = replacementSpawnTick + 1;
        const staleProbeTick = replacementLeaseTick + 1;
        const projectileSubmit = await advanceTick({
            harness,
            tick: projectileSubmitTick,
            label: `Cork projectile crossing T${projectileSubmitTick}`,
            beforeCommit(boundary) {
                towerSurfaceContactEvent = boundary.events.events.find(
                    (event) => event.eventType === 'damage-applied'
                        && event.entityId === corkHandle.entityId
                        && event.incarnation === corkHandle.incarnation
                        && event.otherEntityId === towerHandle.entityId
                        && event.otherIncarnation === towerHandle.incarnation
                        && event.damageFixedPoint > 0
                ) ?? null;
                const projectilePosition = Object.freeze({
                    x: closurePosition.x - direction.x * 4,
                    y: closurePosition.y - direction.y * 4
                });
                assert(endpoint.requestSpawnBatch([{
                    intent: createProjectileIntent(
                        projectilePosition,
                        { x: direction.x * 360, y: direction.y * 360 },
                        projectileSubmitTick
                    ),
                    targetFixedTick: projectileSubmitTick,
                    commandId: 'cork-main:projectile'
                }]).accepted, 'projectile spawn rejected');
                const control = endpoint.requestBodyControl({
                    handle: towerHandle,
                    moveIntentX: direction.x,
                    moveIntentY: direction.y
                }, projectileSubmitTick, 'cork-main:tower-control-2');
                assert(control.accepted,
                    `Tower second control rejected: ${JSON.stringify(control)}`);
            },
            afterCommit(lifecycle) {
                projectileHandle = requireSpawnHandle(
                    lifecycle,
                    'cork-main:projectile'
                );
            }
        });
        tick64Evidence = projectileSubmit.evidence;
        const peakActiveCount = endpoint.getRegistry().getActiveCount();
        assert(MAIN_HARNESS_CAPACITY >= MAIN_EXPECTED_PEAK_ACTIVE_COUNT
            && peakActiveCount === MAIN_EXPECTED_PEAK_ACTIVE_COUNT,
        `Cork main peak capacity mismatch ${JSON.stringify({
            capacity: MAIN_HARNESS_CAPACITY,
            expectedPeak: MAIN_EXPECTED_PEAK_ACTIVE_COUNT,
            peakActiveCount
        })}`);
        const projectileAfter = findBody(
            tick64Evidence.bodies,
            projectileHandle
        );
        const projectileRouteRuntimeStatus
            = endpoint.getRouteAvailabilityRuntimeStatus();
        assert(projectileRouteRuntimeStatus.projectileThreatBodyCount > 0,
            'player projectile route-runtime diagnostic count가 발행되지 않았습니다.');
        assert(towerSurfaceContactEvent
            && towerBeforeBlock
            && towerAfterBlock
            && towerAfterBlock.healthFixedPoint
                < towerBeforeBlock.healthFixedPoint,
        'physical tangent의 Cork/Tower surface contact가 Tower 피해를 발행하지 않았습니다.');
        const deathCommit = await advanceTick({
            harness,
            tick: deathCommitTick,
            label: `Cork owner death/reopen T${deathCommitTick}`,
            beforeCommit(boundary) {
                reopenCompletion = boundary.route;
            }
        });
        const cleanupCommit = await advanceTick({
            harness,
            tick: cleanupCommitTick,
            label: `Cork cleanup T${cleanupCommitTick}`,
            beforeCommit(boundary) {
                cleanupCompletion = boundary.route;
            }
        });
        const reopenSubmitGpuAvailability
            = await readRouteAvailabilityGpuEvidence(
                endpoint,
                harness.atlas.routeGraph.closures.length,
                'reopen-submit'
            );
        reopenFlowPublication = await pumpRouteFlowFieldUntilReady(
            endpoint,
            harness.atlas.routeGraph.closures.length,
            reopenSubmitGpuAvailability.availabilityVersion,
            'reopen-flow-publication'
        );
        assert(reopenSubmitGpuAvailability.records[
                upperClosure.closureIndex
            ].state === GPU_ROUTE_AVAILABILITY_STATE.OPEN
            && reopenFlowPublication.evidence.flowReadyAvailabilityVersion
                === reopenSubmitGpuAvailability.availabilityVersion,
        `reopened flow field version did not publish: ${JSON.stringify({
            reopenSubmitGpuAvailability,
            reopenFlowPublication
        })}`);

        const damageEvent = deathCommit.boundary.events.events.find((event) => (
            event.eventType === 'damage-applied'
                && event.entityId === projectileHandle.entityId
                && event.incarnation === projectileHandle.incarnation
                && event.otherEntityId === corkHandle.entityId
                && event.otherIncarnation === corkHandle.incarnation
                && event.damageFixedPoint > 0
        ));
        const deathEvent = deathCommit.boundary.events.deathEvents.find(
            (event) => exactHandle(event, corkHandle)
        );
        const exactDeathDespawn = deathCommit.lifecycle.despawned.find(
            (entry) => exactHandle(entry.handle, corkHandle)
        );
        const reopened = cleanupCompletion.reopens.find(
            ({ ownerHandle }) => exactHandle(ownerHandle, corkHandle)
        );
        const cleaned = cleanupCompletion.cleanups.find(
            ({ ownerHandle }) => exactHandle(ownerHandle, corkHandle)
        );
        const projectileRouteReadbackBypassed
            = projectileRouteRuntimeStatus.projectileThreatBodyCount > 0
                && reopenCompletion.readbackBypassed === true
                && reopenCompletion.reopens.length === 0
                && reopenCompletion.cleanups.length === 0;
        assert(projectileRouteReadbackBypassed,
            'player projectile가 closed RouteRuntime readback fast-path를 해제했습니다.');
        const routeActorCountAtClose = tick62Evidence.entries.filter(
            ({ routeState }) => routeState.role !== GPU_ROUTE_RUNTIME_ROLE.NONE
        ).length;
        const closerCountAtClose = tick62Evidence.entries.filter(
            ({ routeState }) => routeState.role === GPU_ROUTE_RUNTIME_ROLE.CLOSER
        ).length;
        const helperBodyCount = Math.max(
            0,
            tick62Evidence.bodies.length - registryCountAtClose
        );
        const towerDistanceAlongRoute = towerAfterBlock
            ? (towerAfterBlock.position.x - closurePosition.x) * direction.x
                + (towerAfterBlock.position.y - closurePosition.y) * direction.y
            : Number.POSITIVE_INFINITY;
        const minimumTowerSeparation = towerAfterBlock
            ? 3 + towerAfterBlock.radius
            : 0;
        const projectileDistanceAlongRoute = projectileAfter
            ? (projectileAfter.position.x - closurePosition.x) * direction.x
                + (projectileAfter.position.y - closurePosition.y) * direction.y
            : Number.NEGATIVE_INFINITY;
        const oldCorkBodyAtClose = findBody(tick62Evidence.bodies, corkHandle);
        assert(endpoint.requestSpawnBatch([{
            intent: createCorkIntent(
                harness,
                replacementSpawnTick,
                upperRoute.waypoints[1]
            ),
            targetFixedTick: replacementSpawnTick,
            commandId: 'cork-main:aba-replacement'
        }]).accepted, 'ABA replacement spawn rejected');
        let replacementHandle;
        const replacementSpawn = await advanceTick({
            harness,
            tick: replacementSpawnTick,
            label: `Cork exact-slot replacement T${replacementSpawnTick}`,
            afterCommit(lifecycle) {
                replacementHandle = requireSpawnHandle(
                    lifecycle,
                    'cork-main:aba-replacement'
                );
            }
        });
        const replacementBody = findBody(
            replacementSpawn.evidence.bodies,
            replacementHandle
        );
        const trappedAfterReopen = routeEntryFor(
            replacementSpawn.evidence,
            trappedHandle
        );
        const exactSlotIncarnationReused = Boolean(
            oldCorkBodyAtClose
            && replacementBody
            && replacementBody.index === oldCorkBodyAtClose.index
            && replacementHandle.entityId === corkHandle.entityId
            && replacementHandle.incarnation > corkHandle.incarnation
        );
        const replacementLeaseCommit = await advanceTick({
            harness,
            tick: replacementLeaseTick,
            label: `Cork replacement lease T${replacementLeaseTick}`
        });
        const replacementLease = replacementLeaseCommit
            .boundary.route.assignments.find(
            ({ ownerHandle }) => exactHandle(ownerHandle, replacementHandle)
        );
        const originalLease = assignmentCompletion.assignments.find(
            ({ ownerHandle }) => exactHandle(ownerHandle, corkHandle)
        );
        const leaseGenerationAdvanced = Boolean(
            originalLease
            && replacementLease
            && replacementLease.leaseGeneration > originalLease.leaseGeneration
        );
        const staleBefore = director.getAvailabilitySnapshot();
        const rosterBeforeStale = director.getStatus();
        const staleRequest = endpoint.requestDespawn(
            corkHandle,
            'stale-route-owner',
            staleProbeTick,
            'cork-main:stale-owner'
        );
        assert(staleRequest.accepted === true,
            `stale ABA request queue failed: ${JSON.stringify(staleRequest)}`);
        const staleProbeCommit = await advanceTick({
            harness,
            tick: staleProbeTick,
            label: `Cork stale owner ABA T${staleProbeTick}`
        });
        const staleLifecycle = staleProbeCommit.lifecycle;
        const staleAfter = director.getAvailabilitySnapshot();
        const rosterAfterStale = director.getStatus();
        const abaOldIncarnationDidNotReopen = exactSlotIncarnationReused
            && Boolean(replacementLease)
            && leaseGenerationAdvanced
            && !endpoint.requiresRecovery()
            && staleAfter.availabilityVersion === staleBefore.availabilityVersion
            && JSON.stringify(staleAfter.closedPathIds)
                === JSON.stringify(staleBefore.closedPathIds)
            && rosterAfterStale.rosterCount === rosterBeforeStale.rosterCount
            && rosterAfterStale.assignedLeaseCount
                === rosterBeforeStale.assignedLeaseCount
            && staleLifecycle.state === 'committed-with-rejections'
            && staleLifecycle.recoveryRequired === false
            && staleLifecycle.spawned.length === 0
            && staleLifecycle.despawned.length === 0
            && staleLifecycle.rejected.length === 1
            && staleLifecycle.rejected[0].commandId
                === 'cork-main:stale-owner'
            && staleLifecycle.rejected[0].code === 'stale-handle';

        const simulationStatus = endpoint.getBackend().simulation.getStatus();
        const captureStorageValues = Object.values(
            endpoint.getProjectileCaptureRuntimeStatus().storageProfile ?? {}
        );
        const priorProfiles = [
            simulationStatus.fixedPrimitives?.enemyBehavior
                ?.storageBuffersPerStage,
            simulationStatus.fixedPrimitives?.atomicTransformFirstHit
                ?.storageBuffersPerStage,
            simulationStatus.effects?.storageBuffersPerStage,
            simulationStatus.formations?.maximumStorageBuffersPerStage,
            Math.max(...captureStorageValues)
        ];

        return Object.freeze({
            lifecycle: Object.freeze({
                helperBodyCount,
                assigned: assignmentCompletion.assignments.some(
                    ({ ownerHandle }) => exactHandle(ownerHandle, corkHandle)
                ),
                expanded: corkAtClose.routeState.phase
                        === GPU_ROUTE_RUNTIME_PHASE.BLOCKING
                    && Math.abs(corkAtClose.body.radius - 3) <= 0.0001,
                precloseExpandNonblockingOpen:
                    routeEntryFor(precloseEvidence, corkHandle)?.routeState.phase
                        === GPU_ROUTE_RUNTIME_PHASE.EXPAND
                    && preclosePhysics.bodyLayer
                        === GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
                    && preclosePhysics.collisionMask === 0
                    && precloseGpuAvailability.records[
                        upperClosure.closureIndex
                    ].state === GPU_ROUTE_AVAILABILITY_STATE.LEASED,
                stagedCloseAnchoredNonblocking:
                    corkAtClose.routeState.phase
                        === GPU_ROUTE_RUNTIME_PHASE.BLOCKING
                    && closePhysics.bodyLayer
                        === GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
                    && closePhysics.collisionMask === 0
                    && corkAtClose.body.inverseMass === 0
                    && closeSubmitGpuAvailability.records[
                        upperClosure.closureIndex
                    ].state === GPU_ROUTE_AVAILABILITY_STATE.CLOSED
                    && closeSubmitGpuAvailability.flowReadyAvailabilityVersion
                        < closeSubmitGpuAvailability.availabilityVersion,
                flowPublishedBlocking:
                    publishedBlockingPhysics.bodyLayer
                        === GPU_CIRCLE_BODY_COLLISION_LAYER.ROUTE_BLOCKER
                    && blockingCorkEntry.body.inverseMass === 0
                    && closeFlowPublication.evidence
                        .flowReadyAvailabilityVersion
                        === closeSubmitGpuAvailability.availabilityVersion,
                closed: closeCompletion.closures.some(
                    ({ ownerHandle }) => exactHandle(ownerHandle, corkHandle)
                ),
                reopened: Boolean(reopened),
                exactOwnerDeath: Boolean(
                    damageEvent && deathEvent && exactDeathDespawn && cleaned
                ),
                closerCountAtClose,
                routeActorCountAtClose
            }),
            route: Object.freeze({
                futureSpawnSelectedAlternative:
                    futureSpawnSelectedAlternative
                    && futureAfter.routeState.currentPathIndex === lowerPathIndex,
                activeActorFollowedRebuiltFlow:
                    activeBefore.routeState.currentPathIndex === upperPathIndex
                    && routeNavigationRemainsActive(activeAfter)
                    && activeAfter.body.flowFieldIndex
                        === routeSetCoreFieldIndex,
                blockedBranchActorDidNotWait:
                    trappedAfter.routeState.phase
                        === GPU_ROUTE_RUNTIME_PHASE.TRAVEL
                    && trappedAfter.routeState.pendingFieldIndex === 0xffffffff,
                blockedBranchActorStayedTraveling:
                    routeNavigationRemainsActive(trappedAfterReopen),
                closeSourceTick: closeCompletion.sourceTick,
                closeAvailabilityVersion: closeCompletion.availabilityVersion,
                closeCompletedVersionMatch:
                    closeCompletion.availabilityVersion
                        === closeSubmitGpuAvailability.availabilityVersion,
                closeFlowReadyVersionMatch:
                    closeFlowPublication.evidence
                        .flowReadyAvailabilityVersion
                        === closeSubmitGpuAvailability.availabilityVersion,
                closeFlowPublicationFrameCount:
                    closeFlowPublication.frameCount,
                reopenFlowReadyVersionMatch:
                    reopenFlowPublication.evidence
                        .flowReadyAvailabilityVersion
                        === reopenSubmitGpuAvailability.availabilityVersion,
                reopenFlowPublicationFrameCount:
                    reopenFlowPublication.frameCount,
                projectileTickReadbackBypassed:
                    projectileRouteReadbackBypassed,
                projectileThreatBodyCount:
                    projectileRouteRuntimeStatus.projectileThreatBodyCount,
                precloseGpuSourceTick: precloseGpuAvailability.sourceTick,
                precloseGpuAvailabilityState:
                    precloseGpuAvailability.records[
                        upperClosure.closureIndex
                    ].state,
                closeSubmitGpuSourceTick:
                    closeSubmitGpuAvailability.sourceTick,
                closeSubmitGpuClosedState:
                    closeSubmitGpuAvailability.records[
                        upperClosure.closureIndex
                    ].state,
                closedPathCount: closeCompletion.closedPathIds.length,
                finalClosedPathCount: cleanupCompletion.closedPathIds.length
            }),
            effect: Object.freeze({
                sourceDefinitionId: BASIC_PENTA_ENEMY_DATA.id,
                blockingCorkBoostApplied: Boolean(corkBoostEvent),
                exactTarget: Boolean(corkBoostEvent),
                appliedInstanceCount: effectCompletion.appliedInstanceCount,
                boostStackCount: corkEffectSummary.boostStackCount,
                targetPhysicalLayer: publishedBlockingPhysics.bodyLayer,
                targetInteractionLayer:
                    publishedBlockingInteraction.interactionLayer,
                recoveryRequired: endpoint.requiresRecovery()
                    || endpoint.getBackend().getEffectRuntimeStatus()
                        .requiresRecovery === true
            }),
            crossSystem: crossSystemEvidence,
            interaction: Object.freeze({
                towerSurfaceContactDamaged: Boolean(
                    towerSurfaceContactEvent
                        && towerAfterBlock.healthFixedPoint
                            < towerBeforeBlock.healthFixedPoint
                ),
                towerBlocked: Boolean(
                    towerBeforeBlock
                    && towerAfterBlock
                    && TOWER_BLOCKER_PROBE_START_DISTANCE
                        > minimumTowerSeparation
                    && towerDistanceAlongRoute
                        <= -minimumTowerSeparation + 0.15
                    && towerDistanceAlongRoute < 0
                ),
                projectilePhysicallyPassed: Boolean(
                    projectileAfter && projectileDistanceAlongRoute > 0
                ),
                projectileDamagedCork: Boolean(damageEvent),
                blockingCorkInverseMass: blockingCorkEntry.body.inverseMass,
                projectilePenetrationRemaining: Boolean(
                    projectileAfter && projectileAfter.healthFixedPoint > 0
                )
            }),
            leaseGenerationAdvanced,
            abaOldIncarnationDidNotReopen,
            coexistence: Object.freeze({
                bodyAbiVersion: simulationStatus.abiVersion,
                mainHarnessCapacity: MAIN_HARNESS_CAPACITY,
                peakActiveCount,
                peakCapacityHeadroom:
                    MAIN_HARNESS_CAPACITY - peakActiveCount,
                previousDomainsPreserved: priorProfiles.every(
                    (value) => Number.isSafeInteger(value)
                        && value > 0 && value <= 9
                ) && !endpoint.requiresRecovery()
            })
        });
    } finally {
        director.destroy();
        endpoint.destroy();
    }
}

async function runCapacity(device, format) {
    const harness = createRouteHarness(device, format, 12);
    const { endpoint, director, upperRoute, initialRuntime } = harness;
    try {
        const requests = [];
        for (let index = 0; index < ROUTE_AVAILABILITY_MAX_CORK_ROSTER; index++) {
            const position = Object.freeze({
                x: upperRoute.waypoints[1].x,
                y: upperRoute.waypoints[1].y + (index * 0.02)
            });
            requests.push(Object.freeze({
                intent: createCorkIntent(harness, index + 1, position),
                targetFixedTick: 1,
                commandId: `cork-capacity:${index}`
            }));
        }
        assert(endpoint.requestSpawnBatch(requests).accepted,
            '8-Cork capacity batch rejected');
        const tick1 = await advanceTick({
            harness,
            tick: 1,
            label: 'Cork capacity T1'
        });
        assert(tick1.lifecycle.spawned.length
            === ROUTE_AVAILABILITY_MAX_CORK_ROSTER,
        '8-Cork body batch did not publish atomically');
        const tick1Evidence = await readRouteEvidence(
            endpoint,
            'cork-capacity-t1'
        );
        const specializedAtTick1 = tick1Evidence.entries.filter(
            ({ routeState }) => (
                routeState.role === GPU_ROUTE_RUNTIME_ROLE.CLOSER
            )
        );
        const normalAtTick1 = tick1Evidence.entries.filter(
            ({ routeState }) => (
                routeState.role === GPU_ROUTE_RUNTIME_ROLE.NORMALIZED
            )
        );
        const tick2 = await advanceTick({
            harness,
            tick: 2,
            label: 'Cork capacity T2',
            beforeCommit() {
                // Production GameObjectSystem과 같은 순서로 T1 route completion을
                // director가 관찰한 뒤 최신 availability version을 스폰에 고정합니다.
                const ninthIntent = createDynamicRouteIntent({
                    definition: BASIC_CORK_ENEMY_DATA,
                    route: upperRoute,
                    position: upperRoute.waypoints[1],
                    spawnSequence: 9,
                    availability: director.getAvailabilitySnapshot(),
                    graphContentKey: initialRuntime.graphContentKey
                });
                assert(endpoint.requestSpawnBatch([{
                    intent: ninthIntent,
                    targetFixedTick: 2,
                    commandId: 'cork-capacity:ninth'
                }]).accepted, 'ninth Cork ingress should reach route preflight');
            }
        });
        const ninthSpawn = tick2.lifecycle.spawned.find(
            ({ commandId }) => commandId === 'cork-capacity:ninth'
        );
        await drainNormalBoundary(
            endpoint,
            director,
            3,
            'Cork capacity T3 completion'
        );
        const tick2Evidence = await readRouteEvidence(
            endpoint,
            'cork-capacity-t2'
        );
        const ninthEntry = ninthSpawn
            ? routeEntryFor(tick2Evidence, ninthSpawn.handle)
            : null;
        const runtime = endpoint.getRouteAvailabilityRuntimeStatus();
        return Object.freeze({
            maximumCloserCount: GPU_ROUTE_RUNTIME_MAX_CLOSERS,
            branchSpecializationLimit: 1,
            excessCorksSpawnedAsNormal:
                specializedAtTick1.length === 1
                && normalAtTick1.length
                    === ROUTE_AVAILABILITY_MAX_CORK_ROSTER - 1,
            ninthSpawnedAsNormal: ninthSpawn !== undefined
                && ninthEntry?.routeState.role
                    === GPU_ROUTE_RUNTIME_ROLE.NORMALIZED
                && tick2.lifecycle.rejected.length === 0
                && tick2.lifecycle.recoveryRequired === false
                && runtime.rosterCount === 1,
            normalFallbackRecoveryRequired:
                tick2.lifecycle.recoveryRequired === true
                    || endpoint.requiresRecovery(),
            activeCloserCount: runtime.rosterCount
        });
    } finally {
        director.destroy();
        endpoint.destroy();
    }
}

async function runProspectiveDeathBeforeBranch(device, format) {
    const harness = createRouteHarness(device, format, 4);
    const { endpoint, director, upperRoute, initialRuntime } = harness;
    try {
        const firstIntent = createDynamicRouteIntent({
            definition: BASIC_CORK_ENEMY_DATA,
            route: upperRoute,
            position: upperRoute.waypoints[0],
            spawnSequence: 1,
            availability: director.getAvailabilitySnapshot(),
            graphContentKey: initialRuntime.graphContentKey
        });
        assert(endpoint.requestSpawnBatch([{
            intent: firstIntent,
            targetFixedTick: 1,
            commandId: 'cork-prospective-death:first'
        }]).accepted, 'first prospective Cork spawn rejected');
        const tick1 = await advanceTick({
            harness,
            tick: 1,
            label: 'Prospective Cork death T1'
        });
        const firstSpawn = tick1.lifecycle.spawned.find(
            ({ commandId }) => commandId === 'cork-prospective-death:first'
        );
        const firstEntry = firstSpawn
            ? routeEntryFor(tick1.evidence, firstSpawn.handle)
            : null;
        assert(firstEntry?.routeState.role === GPU_ROUTE_RUNTIME_ROLE.CLOSER
            && firstEntry.routeState.leaseGeneration === 0,
        'first Cork must remain prospective before reaching the branch');

        assert(endpoint.requestDespawn(
            firstSpawn.handle,
            'prospective-before-branch-death',
            2,
            'cork-prospective-death:cleanup-first'
        ).accepted, 'first prospective Cork cleanup rejected');
        const secondIntent = createDynamicRouteIntent({
            definition: BASIC_CORK_ENEMY_DATA,
            route: upperRoute,
            position: upperRoute.waypoints[1],
            spawnSequence: 2,
            availability: director.getAvailabilitySnapshot(),
            graphContentKey: initialRuntime.graphContentKey
        });
        assert(endpoint.requestSpawnBatch([{
            intent: secondIntent,
            targetFixedTick: 2,
            commandId: 'cork-prospective-death:second'
        }]).accepted, 'second prospective Cork spawn rejected');
        const tick2 = await advanceTick({
            harness,
            tick: 2,
            label: 'Prospective Cork death T2'
        });
        const secondSpawn = tick2.lifecycle.spawned.find(
            ({ commandId }) => commandId === 'cork-prospective-death:second'
        );
        await drainNormalBoundary(
            endpoint,
            director,
            3,
            'Prospective Cork death T3 completion'
        );
        const evidence = await readRouteEvidence(
            endpoint,
            'cork-prospective-death-t2'
        );
        const secondEntry = secondSpawn
            ? routeEntryFor(evidence, secondSpawn.handle)
            : null;
        const status = director.getStatus();
        const runtime = endpoint.getRouteAvailabilityRuntimeStatus();
        return Object.freeze({
            prospectiveDeathReleasedAdmission: Boolean(
                firstSpawn
                && secondSpawn
                && !endpoint.hasBody(firstSpawn.handle)
                && secondEntry?.routeState.role
                    === GPU_ROUTE_RUNTIME_ROLE.CLOSER
                && secondEntry.routeState.leaseGeneration > 0
                && status.assignedLeaseCount === 1
                && status.pendingAssignmentCount === 0
                && runtime.rosterCount === 1
                && runtime.leaseCount === 1
                && !endpoint.requiresRecovery()
            )
        });
    } finally {
        director.destroy();
        endpoint.destroy();
    }
}

async function drainTerminalBoundary(endpoint, director, tick, label) {
    const deadline = performance.now() + 8_000;
    while (performance.now() < deadline) {
        const capture = endpoint
            .commitCompletedProjectileCaptureProgramsAtFixedBoundary(tick);
        if (capture.pending === true) {
            await new Promise((resolve) => setTimeout(resolve, 4));
            continue;
        }
        assert(capture.protocolFailure == null,
            `${label}: terminal capture protocol ${JSON.stringify(capture)}`);
        const releases = endpoint
            .commitCompletedProjectileCaptureReleaseProgramsAtFixedBoundary(tick);
        if (releases.pending === true) {
            await new Promise((resolve) => setTimeout(resolve, 4));
            continue;
        }
        assert(releases.protocolFailure == null,
            `${label}: terminal release protocol ${JSON.stringify(releases)}`);
        const route = endpoint
            .commitCompletedRouteAvailabilityProgramsAtFixedBoundary(tick);
        if (route.pending === true) {
            await new Promise((resolve) => setTimeout(resolve, 4));
            continue;
        }
        assert(route.protocolFailure == null,
            `${label}: terminal route protocol ${JSON.stringify(route)}`);
        const observed = director.observeCompletedPrograms(route);
        assert(observed?.accepted === true && !director.requiresRecovery(),
            `${label}: terminal route observe ${JSON.stringify(director.getStatus())}`);
        return Object.freeze({ capture, releases, route });
    }
    throw new Error(`${label}: terminal boundary timeout`);
}

async function runTerminalAndReplacement(device, format) {
    const harness = createRouteHarness(device, format, 4);
    const { endpoint, director, upperRoute } = harness;
    const oldSessionGeneration = harness.initialRuntime.sessionGeneration;
    let corkHandle;
    let terminalStatus;
    try {
        assert(endpoint.requestSpawnBatch([{
            intent: createCorkIntent(harness, 1, upperRoute.waypoints[1]),
            targetFixedTick: 1,
            commandId: 'cork-terminal:owner'
        }]).accepted, 'terminal Cork spawn rejected');
        await advanceTick({
            harness,
            tick: 1,
            label: 'Cork terminal T1',
            afterCommit(lifecycle) {
                corkHandle = requireSpawnHandle(
                    lifecycle,
                    'cork-terminal:owner'
                );
            }
        });

        await drainNormalBoundary(endpoint, director, 2, 'Cork terminal T2 preclose');
        director.closeForTerminal(2, 'nw-cork-terminal');
        const close = endpoint.closeGameplayIngress('nw-cork-terminal', 2);
        assert(close.closed === true,
            `Cork terminal ingress close failed: ${JSON.stringify(close)}`);
        const lifecycle = endpoint.commitAtFixedBoundary(2);
        assert(lifecycle.recoveryRequired !== true
            && lifecycle.despawned.some(
                (entry) => exactHandle(entry.handle, corkHandle)
            ), `Cork terminal cleanup missing: ${JSON.stringify(lifecycle)}`);
        director.observeFixedCommit(lifecycle, 2);
        director.observeLifecycle(lifecycle, 2);
        assert(endpoint.fixedUpdate(FIXED_DELTA, 2),
            'Cork terminal final submit failed');
        await waitForGpuBoundary(endpoint, 'Cork terminal final T2');
        const terminalBoundary = await drainTerminalBoundary(
            endpoint,
            director,
            2,
            'Cork terminal settle'
        );
        terminalStatus = endpoint
            .getTerminalRouteAvailabilityProgramCancelStatus();
        const directorTerminal = director.getStatus().terminal;
        assert(terminalStatus?.state === 'settled'
            && terminalStatus.owner?.rosterSealed === true
            && directorTerminal?.rosterSealed === true,
        `Cork terminal did not settle: ${JSON.stringify({
            terminalStatus,
            director: director.getStatus()
        })}`);

        const replacement = createRouteHarness(device, format, 4);
        try {
            const replacementRuntime = replacement.endpoint
                .getRouteAvailabilityRuntimeStatus();
            const staleProbe = new CorkRouteClosureDirector({
                routeGraph: replacement.tileMap.getRouteGraph(),
                graphContentKey: replacementRuntime.graphContentKey,
                sessionGeneration: replacementRuntime.sessionGeneration,
                deviceGeneration: replacementRuntime.deviceGeneration,
                authoritativeEpoch: replacementRuntime.authoritativeEpoch,
                capacity: replacementRuntime.capacity,
                runtimeStatus: replacementRuntime
            });
            const staleObservation = staleProbe.observeCompletedPrograms(
                terminalBoundary.route
            );
            const staleAuthorityRejected = staleObservation.accepted !== true
                && staleProbe.requiresRecovery()
                && replacement.director.requiresRecovery() === false
                && replacement.endpoint.requiresRecovery() === false;
            staleProbe.destroy();
            return Object.freeze({
                terminal: Object.freeze({
                    allOpen: terminalStatus.backend?.allOpen === true
                        && terminalStatus.backend?.leaseCount === 0
                        && terminalStatus.backend?.closedPathIds.length === 0,
                    rosterCount: terminalStatus.backend?.rosterCount,
                    pendingReadbackCount:
                        terminalStatus.backend?.pendingReadbackCount,
                    rosterSealed: terminalStatus.owner?.rosterSealed === true
                        && terminalStatus.lifecycleCleanup?.pendingCount === 0
                }),
                replacement: Object.freeze({
                    sessionGenerationAdvanced:
                        replacementRuntime.sessionGeneration
                            > oldSessionGeneration,
                    allOpen: replacementRuntime.closedPathIds.length === 0
                        && replacementRuntime.leaseCount === 0,
                    rosterCount: replacementRuntime.rosterCount,
                    staleAuthorityRejected
                })
            });
        } finally {
            replacement.director.destroy();
            replacement.endpoint.destroy();
        }
    } finally {
        director.destroy();
        endpoint.destroy();
    }
}

function createMixedChurnSpawnRequests(
    harness,
    cycle,
    targetFixedTick,
    includePersistentTower
) {
    const route = harness.upperRoute;
    const start = route.waypoints[0];
    const availability = harness.director.getAvailabilitySnapshot();
    const enemyRequests = MIXED_CHURN_ENEMY_ACTORS.map(
        ({ key, definition }, index) => Object.freeze({
            intent: createDynamicRouteIntent({
                definition,
                route,
                position: definition === BASIC_CORK_ENEMY_DATA
                    ? route.waypoints[1]
                    : Object.freeze({
                        x: start.x + 0.8 + (index * 0.7),
                        y: start.y + ((index % 2 === 0 ? -1 : 1) * 1.25)
                    }),
                spawnSequence: (cycle * 100) + index,
                availability,
                graphContentKey: harness.initialRuntime.graphContentKey
            }),
            targetFixedTick,
            commandId: `mixed-churn:${cycle}:${key}`
        })
    );
    return Object.freeze([
        ...(includePersistentTower ? [Object.freeze({
            intent: createGpuTowerSpawnIntent({
                position: Object.freeze({
                    x: start.x + 6,
                    y: start.y + 4
                })
            }),
            targetFixedTick,
            commandId: 'mixed-churn:persistent-tower'
        })] : []),
        ...enemyRequests,
        Object.freeze({
            intent: createProjectileIntent(
                Object.freeze({
                    x: start.x + 0.8,
                    y: start.y + 2.5
                }),
                Object.freeze({ x: 0, y: 0 }),
                (cycle * 100) + MIXED_CHURN_ENEMY_ACTORS.length
            ),
            targetFixedTick,
            commandId: `mixed-churn:${cycle}:projectile`
        })
    ]);
}

function collectMixedChurnHandles(lifecycle, cycle) {
    return new Map(MIXED_CHURN_ROSTER.map((key) => [
        key,
        requireSpawnHandle(lifecycle, `mixed-churn:${cycle}:${key}`)
    ]));
}

function mixedChurnRuntimeTuple(endpoint) {
    const route = endpoint.getRouteAvailabilityRuntimeStatus();
    const capture = endpoint.getProjectileCaptureRuntimeStatus();
    return Object.freeze({
        sessionGeneration: route.sessionGeneration,
        deviceGeneration: route.deviceGeneration,
        authoritativeEpoch: route.authoritativeEpoch,
        captureSessionGeneration: capture.sessionGeneration,
        captureDeviceGeneration: capture.deviceGeneration,
        captureAuthoritativeEpoch: capture.authoritativeEpoch
    });
}

function mixedChurnRuntimePending(endpoint) {
    const backend = endpoint.getBackend();
    const effect = backend.getEffectRuntimeStatus();
    const formation = backend.getFormationRuntimeStatus();
    const atomic = backend.getAtomicTransformRuntimeStatus();
    const capture = backend.getProjectileCaptureRuntimeStatus();
    const route = backend.getRouteAvailabilityRuntimeStatus();
    const simulation = backend.simulation.getStatus();
    return Object.freeze({
        effect: Object.freeze({
            staged: effect.stagedProgramCount,
            pulse: effect.pendingPulseProgramCount,
            readback: effect.pendingEffectReadbackCount
        }),
        formation: Object.freeze({
            staged: formation.stagedPrepareProgramCount,
            prepare: formation.pendingPrepareProgramCount,
            prepareReadback: formation.pendingPrepareReadbackCount,
            armed: formation.armedTransformCount,
            transformReadback: formation.pendingTransformReadbackCount
        }),
        atomic: Object.freeze({
            prepare: atomic.pendingPrepareCount,
            transform: atomic.pendingTransformCount,
            readback: atomic.pendingReadbackCount
        }),
        capture: Object.freeze({
            captureReadback: capture.pendingCaptureReadbackCount,
            releaseReadback: capture.pendingReleaseReadbackCount,
            captureBatch: capture.pendingCaptureBatchCount,
            releaseBatch: capture.pendingReleaseBatchCount,
            prepared: capture.preparedBatchCount,
            armed: capture.armedReleaseCount,
            staged: capture.stagedReleaseCount
        }),
        route: Object.freeze({
            lifecycleReservations: route.lifecycleReservationCount,
            staged: route.stagedCount,
            readback: route.pendingReadbackCount,
            queued: route.queuedBatchCount
        }),
        events: Object.freeze({
            readback: simulation.events.pendingReadbacks,
            queued: simulation.events.queuedBatches
        })
    });
}

function mixedChurnPendingIsZero(pending) {
    return Object.values(pending).every((domain) => (
        Object.values(domain).every((value) => value === 0)
    ));
}

async function runMixedSingleSessionChurn(device, format) {
    const requestedCycles = readMixedChurnCycleCount();
    const harness = createRouteHarness(
        device,
        format,
        MIXED_CHURN_HARNESS_CAPACITY
    );
    const { endpoint, director } = harness;
    const initialTuple = mixedChurnRuntimeTuple(endpoint);
    assert(initialTuple.sessionGeneration
            === initialTuple.captureSessionGeneration
        && initialTuple.deviceGeneration
            === initialTuple.captureDeviceGeneration,
    `mixed churn initial runtime tuple mismatch ${JSON.stringify(initialTuple)}`);
    const cycleEvidence = [];
    let cycleTupleBaseline = null;
    let previousHandles = null;
    let persistentTowerHandle = null;
    let previousCorkLeaseGeneration = 0;
    let tick = 0;
    let peakActiveCount = 0;
    try {
        for (let cycle = 1; cycle <= requestedCycles; cycle++) {
            const spawnTick = ++tick;
            const beforeSubmitCount = endpoint.getBackend().simulation
                .getStatus().submittedTickCount;
            const requests = createMixedChurnSpawnRequests(
                harness,
                cycle,
                spawnTick,
                cycle === 1
            );
            assert(endpoint.requestSpawnBatch(requests).accepted,
                `mixed churn cycle ${cycle} spawn ingress rejected`);
            const spawn = await advanceTick({
                harness,
                tick: spawnTick,
                label: `Mixed churn C${cycle} spawn T${spawnTick}`
            });
            const handles = collectMixedChurnHandles(spawn.lifecycle, cycle);
            if (cycle === 1) {
                persistentTowerHandle = requireSpawnHandle(
                    spawn.lifecycle,
                    'mixed-churn:persistent-tower'
                );
            }
            const bodies = spawn.evidence.bodies;
            const registry = endpoint.getRegistry();
            const activeCount = registry.getActiveCount();
            peakActiveCount = Math.max(peakActiveCount, activeCount);
            assert(activeCount === MIXED_CHURN_ROSTER.length + 1
                && registry.getReservedCount() === 0,
            `mixed churn cycle ${cycle} active roster mismatch ${JSON.stringify({
                activeCount,
                reservedCount: registry.getReservedCount()
            })}`);
            const incarnationEvidence = MIXED_CHURN_ROSTER.map((key) => {
                const handle = handles.get(key);
                const previous = previousHandles?.get(key) ?? null;
                const reusedEntityId = previous === null
                    ? null
                    : handle.entityId === previous.entityId;
                const incarnationAdvanced = previous === null
                    ? null
                    : handle.incarnation > previous.incarnation;
                assert(previous === null
                    || (reusedEntityId && incarnationAdvanced),
                `mixed churn ${key} exact incarnation did not advance`);
                return Object.freeze({
                    key,
                    handle: copyHandle(handle),
                    reusedEntityId,
                    incarnationAdvanced
                });
            });
            const byKey = new Map(incarnationEvidence.map((entry) => [
                entry.key,
                entry
            ]));
            const pentaBody = findBody(bodies, handles.get('penta'));
            const hexaBody = findBody(bodies, handles.get('hexa'));
            const ringBody = findBody(bodies, handles.get('ring'));
            const jorangBody = findBody(bodies, handles.get('jorang'));
            const octagonBody = findBody(bodies, handles.get('octagon'));
            const corkBody = findBody(bodies, handles.get('cork'));
            const corkEntry = routeEntryFor(
                spawn.evidence,
                handles.get('cork')
            );
            const projectileBody = findBody(bodies, handles.get('projectile'));
            const octagonOrbitSlotIndex = registry.copyEntityView(
                handles.get('octagon'),
                {}
            )?.metadata?.orbitSlotIndex;
            assert(pentaBody && hexaBody && ringBody && jorangBody
                && octagonBody && corkBody && projectileBody,
            `mixed churn cycle ${cycle} GPU body set incomplete`);
            const [pentaEmitter, hexaFormation, ringCapture] = await Promise.all([
                readEffectEmitterState(
                    endpoint,
                    pentaBody,
                    handles.get('penta'),
                    `mixed-churn-${cycle}-penta`
                ),
                readFormationState(
                    endpoint,
                    hexaBody,
                    handles.get('hexa'),
                    `mixed-churn-${cycle}-hexa`
                ),
                readProjectileCaptureState(
                    endpoint,
                    ringBody,
                    handles.get('ring'),
                    `mixed-churn-${cycle}-ring`
                )
            ]);
            const sidePlanesValid = pentaEmitter.emitterDefinitionCode
                    === PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE
                        .emitterDefinitionCode
                && pentaEmitter.effectDefinitionCode
                    === PENTA_BOOST_EFFECT_DEFINITION.effectDefinitionCode
                && (hexaFormation.flags
                    & GPU_FORMATION_BODY_STATE_FLAG.ACTIVE) !== 0
                && hexaFormation.memberCount === 1
                && ringCapture.role === GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR
                && ringCapture.phase === GPU_PROJECTILE_CAPTURE_PHASE.IDLE
                && jorangBody.atomicTransformState.phase
                    === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.ARMED
                && octagonBody.enemyBehaviorState.programId
                    === GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT
                && octagonOrbitSlotIndex === 0
                && corkEntry?.routeState.role
                    === GPU_ROUTE_RUNTIME_ROLE.CLOSER
                && corkEntry.routeState.leaseGeneration
                    > previousCorkLeaseGeneration
                && projectileBody.handle.entityId
                    === handles.get('projectile').entityId;
            assert(sidePlanesValid,
                `mixed churn cycle ${cycle} side-plane initialization drift`);

            const cleanupTick = ++tick;
            for (const key of [...MIXED_CHURN_ROSTER].reverse()) {
                const accepted = endpoint.requestDespawn(
                    handles.get(key),
                    'r2-mixed-churn-cycle-cleanup',
                    cleanupTick,
                    `mixed-churn:${cycle}:cleanup:${key}`
                );
                assert(accepted.accepted === true,
                    `mixed churn ${key} cleanup ingress rejected`);
            }
            const cleanup = await advanceTick({
                harness,
                tick: cleanupTick,
                label: `Mixed churn C${cycle} cleanup T${cleanupTick}`
            });
            assert(cleanup.lifecycle.despawned.length
                === MIXED_CHURN_ROSTER.length,
            `mixed churn cycle ${cycle} exact cleanup incomplete`);
            const cleanupBodies = cleanup.evidence.bodies;
            await drainNormalBoundary(
                endpoint,
                director,
                cleanupTick + 1,
                `Mixed churn C${cycle} settle boundary`
            );
            const pending = mixedChurnRuntimePending(endpoint);
            const route = endpoint.getRouteAvailabilityRuntimeStatus();
            const submittedTickCount = endpoint.getBackend().simulation
                .getStatus().submittedTickCount;
            const tuple = mixedChurnRuntimeTuple(endpoint);
            if (cycleTupleBaseline === null) {
                cycleTupleBaseline = tuple;
            }
            const tupleStable = tuple.sessionGeneration
                    === cycleTupleBaseline.sessionGeneration
                && tuple.deviceGeneration === cycleTupleBaseline.deviceGeneration
                && tuple.authoritativeEpoch
                    === cycleTupleBaseline.authoritativeEpoch
                && tuple.captureSessionGeneration
                    === cycleTupleBaseline.captureSessionGeneration
                && tuple.captureDeviceGeneration
                    === cycleTupleBaseline.captureDeviceGeneration
                && tuple.captureAuthoritativeEpoch
                    === cycleTupleBaseline.captureAuthoritativeEpoch
                && tuple.sessionGeneration === initialTuple.sessionGeneration
                && tuple.deviceGeneration === initialTuple.deviceGeneration;
            assert(tupleStable
                && registry.getActiveCount() === 1
                && registry.getReservedCount() === 0
                && cleanupBodies.length === 1
                && registry.has(persistentTowerHandle)
                && route.closedPathIds.length === 0
                && route.rosterCount === 0
                && route.leaseCount === 0
                && route.requiresRecovery === false
                && mixedChurnPendingIsZero(pending)
                && submittedTickCount - beforeSubmitCount === 2
                && !endpoint.requiresRecovery()
                && !director.requiresRecovery(),
            `mixed churn cycle ${cycle} did not settle ${JSON.stringify({
                tuple,
                initialTuple,
                registry: registry.getStatus(),
                route,
                pending,
                submittedTickCount,
                beforeSubmitCount,
                endpoint: endpoint.getStatus(),
                director: director.getStatus()
            })}`);
            cycleEvidence.push(Object.freeze({
                cycle,
                spawnTick,
                cleanupTick,
                tuple,
                tupleStable,
                roster: Object.freeze(incarnationEvidence),
                reusedEntityIds: cycle === 1
                    ? true
                    : incarnationEvidence.every(
                        ({ reusedEntityId }) => reusedEntityId === true
                    ),
                incarnationAdvanced: cycle === 1
                    ? true
                    : incarnationEvidence.every(
                        ({ incarnationAdvanced }) => incarnationAdvanced === true
                    ),
                activeCountAtPeak: activeCount,
                activeCountAfterCleanup: registry.getActiveCount(),
                reservedCountAfterCleanup: registry.getReservedCount(),
                gpuBodyCountAfterCleanup: cleanupBodies.length,
                sidePlanesValid,
                pentaEmitterDefinitionCode: pentaEmitter.emitterDefinitionCode,
                hexaFormationMemberCount: hexaFormation.memberCount,
                ringCaptureRole: ringCapture.role,
                ringCapturePhase: ringCapture.phase,
                jorangAtomicPhase: jorangBody.atomicTransformState.phase,
                octagonProgramId: octagonBody.enemyBehaviorState.programId,
                octagonOrbitSlotIndex,
                corkRouteRole: corkEntry.routeState.role,
                corkLeaseGeneration: corkEntry.routeState.leaseGeneration,
                projectileEntityId: byKey.get('projectile').handle.entityId,
                routeAllOpen: route.closedPathIds.length === 0,
                routeRosterCount: route.rosterCount,
                routeLeaseCount: route.leaseCount,
                pending,
                pendingAllZero: mixedChurnPendingIsZero(pending),
                fixedTickDelta: cleanupTick - spawnTick + 1,
                submittedTickDelta: submittedTickCount - beforeSubmitCount,
                recoveryRequired: false
            }));
            previousCorkLeaseGeneration = corkEntry.routeState.leaseGeneration;
            previousHandles = handles;
        }
        const simulationStatus = endpoint.getBackend().simulation.getStatus();
        const finalRoute = endpoint.getRouteAvailabilityRuntimeStatus();
        const finalPending = mixedChurnRuntimePending(endpoint);
        const storageValues = [
            ...Object.values(simulationStatus.fixedPrimitives.storageProfile),
            simulationStatus.effects.storageBuffersPerStage,
            simulationStatus.formations.maximumStorageBuffersPerStage,
            GPU_ROUTE_RUNTIME_STORAGE_PROFILE.maximum,
            GPU_ROUTE_RUNTIME_STORAGE_PROFILE.render
        ].filter(Number.isFinite);
        return Object.freeze({
            contractVersion: MIXED_CHURN_CONTRACT_VERSION,
            scenario: 'single-device-single-session-mixed-o-j-r-z-h-p-projectile-churn',
            requestedCycles,
            completedCycles: cycleEvidence.length,
            oneEndpoint: true,
            initialTuple,
            cycleTuple: cycleTupleBaseline,
            stableTuple: cycleEvidence.every(({ tupleStable }) => tupleStable),
            exactIncarnationChurn: cycleEvidence.every(
                ({ reusedEntityIds, incarnationAdvanced }) => (
                    reusedEntityIds && incarnationAdvanced
                )
            ),
            roster: MIXED_CHURN_ROSTER,
            capacity: MIXED_CHURN_HARNESS_CAPACITY,
            peakActiveCount,
            boundedHighWater: peakActiveCount === MIXED_CHURN_ROSTER.length + 1
                && peakActiveCount <= MIXED_CHURN_HARNESS_CAPACITY,
            lifetimeSentinelActive: endpoint.getRegistry().has(
                persistentTowerHandle
            ),
            finalActiveCount: endpoint.getRegistry().getActiveCount(),
            finalChurnActiveCount: endpoint.getRegistry().getActiveCount() - 1,
            finalReservedCount: endpoint.getRegistry().getReservedCount(),
            finalGpuBodyCount: simulationStatus.activeBodyCount,
            finalChurnGpuBodyCount: simulationStatus.activeBodyCount - 1,
            finalRouteAllOpen: finalRoute.closedPathIds.length === 0,
            finalRouteRosterCount: finalRoute.rosterCount,
            finalRouteLeaseCount: finalRoute.leaseCount,
            finalPending,
            finalPendingAllZero: mixedChurnPendingIsZero(finalPending),
            submittedTickCount: simulationStatus.submittedTickCount,
            expectedSubmittedTickCount: requestedCycles * 2,
            storageMaximum: Math.max(...storageValues),
            recoveryRequired: endpoint.requiresRecovery()
                || director.requiresRecovery(),
            cycles: Object.freeze(cycleEvidence)
        });
    } finally {
        director.destroy();
        endpoint.destroy();
    }
}

async function runFixture(device, format) {
    const formation = runFormationRouteClosurePolicy();
    const main = await runClosureRoutingAndInteraction(device, format);
    const capacity = await runCapacity(device, format);
    const prospectiveDeath = await runProspectiveDeathBeforeBranch(
        device,
        format
    );
    const terminalReplacement = await runTerminalAndReplacement(device, format);
    const mixedChurn = await runMixedSingleSessionChurn(device, format);
    return Object.freeze({
        scenario: 'cork-dynamic-route-closure',
        lifecycle: main.lifecycle,
        route: main.route,
        effect: main.effect,
        formation,
        crossSystem: main.crossSystem,
        interaction: main.interaction,
        capacity: Object.freeze({
            ...capacity,
            ...prospectiveDeath,
            leaseGenerationAdvanced: main.leaseGenerationAdvanced,
            abaOldIncarnationDidNotReopen: main.abaOldIncarnationDidNotReopen
        }),
        terminal: terminalReplacement.terminal,
        replacement: terminalReplacement.replacement,
        mixedChurn,
        coexistence: Object.freeze({
            bodyAbiVersion: GPU_CIRCLE_BODY_ABI_VERSION,
            mainHarnessCapacity: main.coexistence.mainHarnessCapacity,
            peakActiveCount: main.coexistence.peakActiveCount,
            peakCapacityHeadroom: main.coexistence.peakCapacityHeadroom,
            previousDomainsPreserved:
                main.coexistence.bodyAbiVersion === GPU_CIRCLE_BODY_ABI_VERSION
                && main.coexistence.previousDomainsPreserved
        }),
        storageProfile: Object.freeze({
            ...GPU_ROUTE_RUNTIME_STORAGE_PROFILE.byEntryPoint,
            maximum: GPU_ROUTE_RUNTIME_STORAGE_PROFILE.maximum,
            render: GPU_ROUTE_RUNTIME_STORAGE_PROFILE.render
        })
    });
}

async function run() {
    const result = {
        status: 'fail',
        runtime: {
            nw: process.versions.nw || '',
            chrome: process.versions.chrome || '',
            protocol: location.protocol,
            secureContext: isSecureContext
        }
    };
    let device = null;
    try {
        assert(resultPath, 'CIRVIVOR_WEBGPU_RESULT_PATH missing');
        assert(isSecureContext, `secure context required: ${location.protocol}`);
        assert(navigator.gpu, 'navigator.gpu unavailable');
        const adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance'
        });
        assert(adapter, 'WebGPU adapter unavailable');
        assert(adapter.limits.maxStorageBuffersPerShaderStage
            >= REQUIRED_STORAGE_BUFFER_LIMIT,
        'WebGPU storage buffer limit below 9');
        result.adapterMaxStorageBuffersPerShaderStage
            = adapter.limits.maxStorageBuffersPerShaderStage;
        result.requestedMaxStorageBuffersPerShaderStage
            = REQUIRED_STORAGE_BUFFER_LIMIT;
        device = await adapter.requestDevice({
            requiredLimits: {
                maxStorageBuffersPerShaderStage:
                    REQUIRED_STORAGE_BUFFER_LIMIT
            }
        });
        result.deviceMaxStorageBuffersPerShaderStage
            = device.limits.maxStorageBuffersPerShaderStage;
        const uncapturedErrors = [];
        device.addEventListener('uncapturederror', (event) => {
            uncapturedErrors.push(event.error?.message ?? String(event.error));
        });
        result.productionEnemyCorkRouteClosure = await runFixture(
            device,
            navigator.gpu.getPreferredCanvasFormat()
        );
        await device.queue.onSubmittedWorkDone();
        result.uncapturedErrorCount = uncapturedErrors.length;
        assert(uncapturedErrors.length === 0,
            `uncaptured WebGPU error: ${uncapturedErrors.join(' | ')}`);
        const lostPromise = device.lost;
        device.destroy();
        const lost = await lostPromise;
        result.deviceLostReason = lost.reason;
        assert(lost.reason === 'destroyed',
            `device lost reason: ${lost.reason}`);
        result.status = 'pass';
    } catch (error) {
        result.error = error?.stack ?? String(error);
        try { device?.destroy(); } catch { /* best effort */ }
    }
    require('node:fs').writeFileSync(
        resultPath,
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8'
    );
    nw.App.quit();
}

run();
