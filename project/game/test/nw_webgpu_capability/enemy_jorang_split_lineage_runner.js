import {
    BASIC_PENTA_ENEMY_DATA
} from './production/script/data/object/enemy/basic_circle_enemy_data.js';
import {
    BASIC_JORANG_ENEMY_DATA,
    resolveBasicCirclePrimeTransformPrivateDefinition
} from './production/script/data/object/enemy/basic_jorang_enemy_data.js';
import {
    PENTA_BOOST_EFFECT_DEFINITION,
    PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE
} from './production/script/data/object/enemy/enemy_effect_catalog_data.js';
import {
    JORANG_MAXIMUM_TRANSFORM_STARTS_PER_FIXED_TICK,
    JORANG_NATURAL_BOUNTY_BUDGET,
    JORANG_RETURN_DELAY_FIXED_TICKS
} from './production/script/data/object/enemy/enemy_jorang_split_runtime_data.js';
import {
    ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID
} from './production/script/module/ingame/contract/enemy_atomic_transform_contract.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_TEAM_ID
} from './production/script/module/ingame/contract/gameplay_team_contract.js';
import {
    PROJECTILE_CAPTURE_POLICY_ID,
    PROJECTILE_ORIGIN_PROVENANCE_SCHEMA_VERSION
} from './production/script/module/ingame/contract/projectile_capture_contract.js';
import {
    EnemySimulationBackend
} from './production/script/module/ingame/object/enemy/enemy_simulation_backend.js';
import {
    CORE_IMPACT_FACT_TYPE,
    EnemyCoreImpactDirector
} from './production/script/module/ingame/object/enemy/enemy_core_impact_director.js';
import {
    GpuEnemySimulationEndpoint
} from './production/script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js';
import {
    createGpuEnemySpawnIntent,
    materializeNaturalJorangAtomicTransformActivation
} from './production/script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js';
import {
    JorangSplitLineageDirector
} from './production/script/module/ingame/object/enemy/jorang_split_lineage_director.js';
import {
    createGpuCoreProxySpawnIntent
} from './production/script/module/ingame/object/core/gpu_core_proxy_spawn_adapter.js';
import {
    CoreIntegrity
} from './production/script/module/ingame/state/core_integrity.js';
import {
    GPU_CIRCLE_APPLIED_EVENT_FLAG,
    GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    GPU_CIRCLE_BODY_RENDER_SHAPE,
    GPU_PROJECTILE_CAPTURE_ROLE
} from './production/script/module/ingame/physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS,
    GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION
} from './production/script/module/ingame/physics/gpu/gpu_atomic_transform_runtime_abi.js';
import {
    GPU_EFFECT_INSTANCE_FLAG,
    GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
    GPU_EFFECT_PULSE_PROGRAM_FLAG,
    GPU_EFFECT_RUNTIME_ABI,
    GPU_EFFECT_RUNTIME_STATUS,
    GPU_EFFECT_TARGET_POLICY
} from './production/script/module/ingame/physics/gpu/gpu_effect_runtime_abi.js';
import {
    TileMap
} from './production/script/module/ingame/map/tile_map.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const REQUIRED_STORAGE_BUFFER_LIMIT = 9;
const FIXED_DELTA = 1 / 60;
const OPEN_MAP_DATA = Object.freeze({
    id: 'nw-jorang-split-lineage-open-map',
    macroRows: 1,
    macroColumns: 3,
    pathWidthTiles: 16,
    directionBlueprint: Object.freeze(['abc']),
    coreMacroCell: Object.freeze([0, 2]),
    towerSpawnMacroCell: Object.freeze([0, 1]),
    enemySpawnRoutes: Object.freeze([Object.freeze({
        gateId: 'nw-jorang-open-gate',
        pathId: 'nw-jorang-open-path',
        macroCells: Object.freeze([
            Object.freeze([0, 0]),
            Object.freeze([0, 1]),
            Object.freeze([0, 2])
        ])
    })])
});

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function exactHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
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

function withIdentity(intent, handle, overrides = {}) {
    return Object.freeze({
        ...intent,
        entityId: handle.entityId,
        incarnation: handle.incarnation,
        ...overrides
    });
}

function createProbe(handle, position, { closestOnly = true } = {}) {
    return Object.freeze({
        kindId: 'projectile',
        definitionId: 'nw-jorang-enter-only-probe',
        entityId: handle.entityId,
        incarnation: handle.incarnation,
        position: Object.freeze({ ...position }),
        velocity: Object.freeze({ x: -18, y: 0 }),
        radius: 0.4,
        inverseMass: 1,
        bodyLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
        collisionMask: 0,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
        interactionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
        damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        health: 1,
        lifetime: -1,
        alive: true,
        countAsKill: false,
        renderStyle: Object.freeze({
            color: Object.freeze([1, 1, 1, 1]),
            radiusScale: 1,
            visible: false,
            shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE
        }),
        contactHandler: Object.freeze({
            damageSelf: 1,
            damageOther: 1,
            flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
                | (closestOnly
                    ? GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY
                    : 0)
        })
    });
}

function createProbeIntent(position, {
    closestOnly = true,
    damageSelf = 1,
    damageOther = 1,
    health = 1,
    commandTag = 'probe'
} = {}) {
    return Object.freeze({
        kindId: 'projectile',
        definitionId: `nw-jorang-${commandTag}`,
        projectileCapturePolicyId:
            PROJECTILE_CAPTURE_POLICY_ID.NOT_CAPTURABLE,
        schemaVersion: PROJECTILE_ORIGIN_PROVENANCE_SCHEMA_VERSION,
        archetypeId: `nw-jorang-${commandTag}`,
        wordTagMask: 0,
        modifierSetId: null,
        sourceExecutionId: null,
        projectileGeneration: 1,
        originProducerId: null,
        originSourceAbilityId: null,
        originOwnerEntityId: null,
        originOwnerIncarnation: null,
        originSourceEntityId: null,
        originSourceIncarnation: null,
        originTargetEntityId: null,
        originTargetIncarnation: null,
        projectileCaptureState: Object.freeze({
            role: GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE
        }),
        position: Object.freeze({ x: position.x + 0.9, y: position.y }),
        velocity: Object.freeze({ x: -18, y: 0 }),
        radius: 0.4,
        inverseMass: 1,
        bodyLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
        collisionMask: 0,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
        interactionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
        damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        health,
        lifetime: -1,
        alive: true,
        countAsKill: false,
        renderStyle: Object.freeze({
            color: Object.freeze([1, 1, 1, 1]),
            radiusScale: 1,
            visible: false,
            shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE
        }),
        contactHandler: Object.freeze({
            damageSelf,
            damageOther,
            flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
                | (closestOnly
                    ? GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY
                    : 0)
        })
    });
}

function createNaturalJorangIntent(route, spawnSequence, position) {
    return Object.freeze({
        ...createGpuEnemySpawnIntent({
            definition: BASIC_JORANG_ENEMY_DATA,
            route,
            spawnSequence,
            waveId: 'nw-jorang-split-lineage-actual',
            policyId: 'hardware-fixture'
        }),
        position: Object.freeze({ ...position })
    });
}

function createPentaIntent(route, spawnSequence, position) {
    return Object.freeze({
        ...createGpuEnemySpawnIntent({
            definition: BASIC_PENTA_ENEMY_DATA,
            route,
            spawnSequence,
            waveId: 'nw-jorang-split-lineage-effect-source',
            policyId: 'hardware-fixture'
        }),
        position: Object.freeze({ ...position }),
        velocity: Object.freeze({ x: 0, y: 0 }),
        contactHandler: null
    });
}

function createEffectPulseRecord(
    sourceHandle,
    sourceTick,
    pulseSequence = 0
) {
    return Object.freeze({
        sourceEntityId: sourceHandle.entityId,
        sourceIncarnation: sourceHandle.incarnation,
        effectDefinitionCode: PENTA_BOOST_EFFECT_DEFINITION.effectDefinitionCode,
        emitterDefinitionCode:
            PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.emitterDefinitionCode,
        sourceTick,
        pulseSequence,
        radiusTiles: PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.pulseRadiusTiles,
        targetLayerMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        targetPolicy: GPU_EFFECT_TARGET_POLICY.HOSTILE_ENEMY,
        fingerprint: (
            0x6a0000 + sourceTick + (pulseSequence * 0x100)
        ) >>> 0,
        flags: GPU_EFFECT_PULSE_PROGRAM_FLAG.PENTA_TARGET_ALLOWED
            | GPU_EFFECT_PULSE_PROGRAM_FLAG.TOWER_CONTACT_DAMAGE_MODIFIABLE
            | GPU_EFFECT_PULSE_PROGRAM_FLAG.PROJECTILE_TOWER_DAMAGE_MODIFIABLE,
        retargetIntervalTicks:
            PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.retargetIntervalTicks
    });
}

async function waitForSimulation(backend, label, timeoutMs = 5_000) {
    const simulation = backend.simulation;
    assert(simulation, `${label}: production simulation missing`);
    await simulation.device.queue.onSubmittedWorkDone();
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        const status = simulation.getStatus();
        if (status.events.pendingReadbacks === 0
            && status.overflow.pendingReadbacks === 0) {
            return status;
        }
        await new Promise((resolve) => setTimeout(resolve, 4));
    }
    throw new Error(`${label}: readback timeout ${JSON.stringify(simulation.getStatus())}`);
}

async function readBodies(backend) {
    const promise = backend.simulation.readbackBodies();
    await backend.simulation.device.queue.onSubmittedWorkDone();
    return promise;
}

function findBody(bodies, handle) {
    return bodies.find((body) => exactHandle(body.handle, handle));
}

function findRequiredBody(bodies, handle, label) {
    const body = findBody(bodies, handle);
    assert(body, `${label}: ${JSON.stringify(handle)}`);
    return body;
}

function createActualEndpoint(
    device,
    format,
    capacity,
    corePortReceiver = null,
    endpointOptions = {}
) {
    const dependencies = {
        webGpuPlatformPort: createPlatformPort(device, format),
        enemySimulationBackendFactory: (backendDependencies, backendOptions) => (
            new EnemySimulationBackend(backendDependencies, backendOptions)
        )
    };
    if (corePortReceiver) {
        dependencies.coreImpactCleanupPortReceiver = corePortReceiver;
    }
    return new GpuEnemySimulationEndpoint(dependencies, {
        capacity,
        ...endpointOptions
    });
}

function initializeActualEndpoint(endpoint, tileMap, label) {
    const ready = endpoint.init(tileMap);
    const backend = endpoint.getBackend();
    const runtimeState = backend.getRuntimeState();
    assert(backend.simulation
        && ((ready === true && runtimeState === 'gpu-ready')
            || (ready === false && runtimeState === 'gpu-deferred')),
    `${label}: endpoint init state mismatch ${JSON.stringify({
        ready,
        runtimeState
    })}`);
    if (runtimeState === 'gpu-deferred') {
        assert(backend.simulation.init() === true
            && backend.getRuntimeState() === 'gpu-ready',
        `${label}: deferred GPU bootstrap failed`);
    }
}

function createActualJorangDirector(endpoint) {
    return new JorangSplitLineageDirector({
        registry: endpoint.getRegistry(),
        atomicTransformCommandPort: endpoint.getAtomicTransformCommandPort(),
        sessionGeneration: endpoint.getStatus().sessionGeneration,
        capacity: endpoint.getCapacity()
    });
}

async function readGpuBufferBytes(device, source, byteLength, label) {
    const target = device.createBuffer({
        label,
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = device.createCommandEncoder({ label: `${label}-copy` });
        encoder.copyBufferToBuffer(source, 0, target, 0, byteLength);
        device.queue.submit([encoder.finish()]);
        await target.mapAsync(GPUMapMode.READ);
        return target.getMappedRange().slice(0);
    } finally {
        try { target.unmap(); } catch { /* already unmapped */ }
        target.destroy();
    }
}

async function readActiveEffectInstances(endpoint, device) {
    const backend = endpoint.getBackend();
    const status = backend.getEffectRuntimeStatus();
    const pool = status.activePoolIndex === 0
        ? backend.simulation.buffers.effectInstancesA
        : backend.simulation.buffers.effectInstancesB;
    const capacity = backend.simulation.effectInstanceCapacity;
    const abi = GPU_EFFECT_RUNTIME_ABI.INSTANCE;
    const bytes = await readGpuBufferBytes(
        device,
        pool,
        capacity * abi.STRIDE,
        'cirvivor-nw-jorang-effect-instances'
    );
    const view = new DataView(bytes);
    const records = [];
    for (let index = 0; index < capacity; index++) {
        const offset = index * abi.STRIDE;
        const flags = view.getUint32(offset + abi.FLAGS, true);
        if ((flags & GPU_EFFECT_INSTANCE_FLAG.ACTIVE) === 0) continue;
        records.push(Object.freeze({
            effectInstanceId: view.getUint32(offset + abi.EFFECT_INSTANCE_ID, true),
            instanceIncarnation: view.getUint32(
                offset + abi.INSTANCE_INCARNATION,
                true
            ),
            effectDefinitionCode: view.getUint32(
                offset + abi.EFFECT_DEFINITION_CODE,
                true
            ),
            familyCode: view.getUint32(offset + abi.FAMILY_CODE, true),
            flags,
            sourceSlot: view.getUint32(offset + abi.SOURCE_SLOT, true),
            sourceEntityId: view.getUint32(offset + abi.SOURCE_ENTITY_ID, true),
            sourceIncarnation: view.getUint32(
                offset + abi.SOURCE_INCARNATION,
                true
            ),
            targetSlot: view.getUint32(offset + abi.TARGET_SLOT, true),
            targetEntityId: view.getUint32(offset + abi.TARGET_ENTITY_ID, true),
            targetIncarnation: view.getUint32(
                offset + abi.TARGET_INCARNATION,
                true
            ),
            appliedTick: view.getUint32(offset + abi.APPLIED_TICK, true),
            expiresAtTick: view.getUint32(offset + abi.EXPIRES_AT_TICK, true),
            magnitude: view.getFloat32(offset + abi.MAGNITUDE, true),
            payload0: view.getInt32(offset + abi.PAYLOAD_0, true),
            tags: view.getUint32(offset + abi.TAGS, true)
        }));
    }
    return Object.freeze(records);
}

function exactEffectPayloadEqual(left, right) {
    return left.effectInstanceId === right.effectInstanceId
        && left.instanceIncarnation === right.instanceIncarnation
        && left.effectDefinitionCode === right.effectDefinitionCode
        && left.familyCode === right.familyCode
        && left.flags === right.flags
        && left.sourceSlot === right.sourceSlot
        && left.sourceEntityId === right.sourceEntityId
        && left.sourceIncarnation === right.sourceIncarnation
        && left.appliedTick === right.appliedTick
        && left.expiresAtTick === right.expiresAtTick
        && left.magnitude === right.magnitude
        && Object.is(left.payload0, right.payload0)
        && left.tags === right.tags;
}

async function readMaxHealthFixedPoint(endpoint, device, body) {
    const backend = endpoint.getBackend();
    const abi = GPU_EFFECT_RUNTIME_ABI.SUMMARY;
    const bytes = await readGpuBufferBytes(
        device,
        backend.simulation.buffers.effectSummaries,
        endpoint.getCapacity() * abi.STRIDE,
        'cirvivor-nw-jorang-effect-summaries'
    );
    const view = new DataView(bytes);
    const offset = body.index * abi.STRIDE;
    assert(view.getUint32(offset + abi.ENTITY_ID, true) === body.entityId
        && view.getUint32(offset + abi.INCARNATION, true) === body.incarnation,
    'Effect summary exact identity mismatch');
    return view.getInt32(offset + abi.MAX_HEALTH_FIXED_POINT, true);
}

async function waitForActualRuntime(endpoint, label, timeoutMs = 5_000) {
    const backend = endpoint.getBackend();
    const simulation = backend.simulation;
    assert(simulation, `${label}: production simulation missing`);
    await simulation.device.queue.onSubmittedWorkDone();
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        const status = simulation.getStatus();
        const atomic = backend.getAtomicTransformRuntimeStatus();
        const effect = backend.getEffectRuntimeStatus();
        if (status.events.pendingReadbacks === 0
            && status.overflow.pendingReadbacks === 0
            && atomic.pendingReadbackCount === 0
            && effect.pendingEffectReadbackCount === 0) {
            return Object.freeze({ status, atomic, effect });
        }
        await new Promise((resolve) => setTimeout(resolve, 4));
    }
    throw new Error(`${label}: runtime readback timeout ${JSON.stringify({
        simulation: simulation.getStatus(),
        atomic: backend.getAtomicTransformRuntimeStatus(),
        effect: backend.getEffectRuntimeStatus()
    })}`);
}

async function waitForDirectEffectCompletion(endpoint, label, timeoutMs = 5_000) {
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

function activeEnemyViews(endpoint) {
    const registry = endpoint.getRegistry();
    return registry.copyActiveHandlesInto([], { kindId: 'enemy' })
        .map((handle) => registry.copyEntityView(handle, {}))
        .filter(Boolean);
}

function countDefinition(endpoint, definitionId) {
    return activeEnemyViews(endpoint).filter((view) => (
        view.definitionId === definitionId
    )).length;
}

function assertHealthyBoundary(value, label) {
    assert(value && value.recoveryRequired !== true,
        `${label}: recovery ${JSON.stringify(value)}`);
    return value;
}

function drainActualBoundary(endpoint, director, targetFixedTick, coreDirector = null) {
    const capture = endpoint
        .commitCompletedProjectileCaptureProgramsAtFixedBoundary(
            targetFixedTick
        );
    assert(capture.pending !== true && capture.protocolFailure === null,
        `T${targetFixedTick}: capture protocol ${JSON.stringify(capture)}`);
    const releases = endpoint
        .commitCompletedProjectileCaptureReleaseProgramsAtFixedBoundary(
            targetFixedTick
        );
    assert(releases.pending !== true && releases.protocolFailure === null,
        `T${targetFixedTick}: release protocol ${JSON.stringify(releases)}`);
    const prepare = endpoint
        .commitCompletedAtomicTransformProgramsAtFixedBoundary(targetFixedTick);
    assert(prepare.pending !== true,
        `T${targetFixedTick}: prepare readback still pending`);
    assert(prepare.protocolFailure === null,
        `T${targetFixedTick}: prepare protocol ${JSON.stringify(prepare)}`);
    const preparationObservation = director.observeCompletedPreparations(prepare);
    assert(!director.requiresRecovery(),
        `T${targetFixedTick}: preparation observe ${JSON.stringify(
            director.getStatus()
        )}`);
    const events = endpoint.commitCompletedEventsAtFixedBoundary(targetFixedTick);
    assert(events.protocolFailure === null,
        `T${targetFixedTick}: event protocol ${JSON.stringify(events)}`);
    const triggerObservation = director.observeCompletedEvents(events);
    assert(!director.requiresRecovery(),
        `T${targetFixedTick}: trigger observe ${JSON.stringify(director.getStatus())}`);
    const coreObservation = coreDirector
        ? coreDirector.observeCompletedEvents(events, endpoint.getRegistry())
        : null;
    assert(coreObservation?.recoveryRequired !== true,
        `T${targetFixedTick}: Core observe ${JSON.stringify(coreObservation)}`);
    return Object.freeze({
        capture,
        releases,
        prepare,
        preparationObservation,
        events,
        triggerObservation,
        coreObservation
    });
}

async function advanceActualTick({
    endpoint,
    director,
    tick,
    label,
    coreDirector = null,
    beforeStage = null,
    beforeSubmit = null
}) {
    const boundary = drainActualBoundary(
        endpoint,
        director,
        tick,
        coreDirector
    );
    beforeStage?.(boundary);
    const coreStage = coreDirector?.stageForFixedTick({
        endpoint,
        targetFixedTick: tick
    }) ?? null;
    assert(coreStage?.recoveryRequired !== true,
        `${label}: Core stage ${JSON.stringify(coreStage)}`);
    const atomicStage = director.stageForFixedTick({ targetFixedTick: tick });
    assert(atomicStage.accepted === true && atomicStage.requiresRecovery !== true,
        `${label}: Atomic stage ${JSON.stringify(atomicStage)}`);
    const lifecycle = assertHealthyBoundary(
        endpoint.commitAtFixedBoundary(tick),
        `${label}: lifecycle`
    );
    director.observeFixedCommit(lifecycle, tick);
    director.observeLifecycle(lifecycle, tick);
    coreDirector?.observeFixedCommit(lifecycle, tick);
    assert(!director.requiresRecovery(),
        `${label}: lineage lifecycle ${JSON.stringify(director.getStatus())}`);
    assert(coreDirector?.requiresRecovery?.() !== true,
        `${label}: Core lifecycle ${JSON.stringify(coreDirector?.getStatus?.())}`);
    beforeSubmit?.({ boundary, atomicStage, lifecycle });
    assert(endpoint.fixedUpdate(FIXED_DELTA, tick), `${label}: fixed submit failed`);
    const runtime = await waitForActualRuntime(endpoint, label);
    assert(!endpoint.requiresRecovery()
        && runtime.atomic.requiresRecovery !== true
        && runtime.effect.requiresRecovery !== true,
    `${label}: runtime recovery ${JSON.stringify(runtime)}`);
    const bodies = await readBodies(endpoint.getBackend());
    return Object.freeze({ boundary, atomicStage, lifecycle, runtime, bodies });
}

function createOutwardCorePosition(first, second, coreRadius) {
    let x = second.position.x - first.position.x;
    let y = second.position.y - first.position.y;
    const length = Math.hypot(x, y);
    if (length <= 0.000001) {
        x = 1;
        y = 0;
    } else {
        x /= length;
        y /= length;
    }
    const distance = (second.radius + coreRadius) * 0.5;
    return Object.freeze({
        x: second.position.x + (x * distance),
        y: second.position.y + (y * distance)
    });
}

function createActivatedJ(route, handle, position, phase) {
    const raw = createGpuEnemySpawnIntent({
        definition: BASIC_JORANG_ENEMY_DATA,
        route,
        spawnSequence: handle.entityId,
        waveId: 'nw-jorang-split-lineage',
        policyId: 'hardware-fixture'
    });
    const activated = materializeNaturalJorangAtomicTransformActivation(raw, handle);
    return withIdentity(activated, handle, {
        position: Object.freeze({ ...position }),
        velocity: Object.freeze({ x: 0, y: 0 }),
        flowSpeed: 0,
        atomicTransformState: Object.freeze({
            ...activated.atomicTransformState,
            phase,
            triggerSourceTick: phase
                    === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.SPLIT_PENDING
                ? 1
                : 0,
            triggerSequence: phase
                    === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.SPLIT_PENDING
                ? 1
                : 0
        })
    });
}

async function runFirstHitBatch(device, format, mode = 'admit') {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const pendingOnly = mode === 'pending';
    const nonClosest = mode === 'non-closest';
    const count = pendingOnly ? 1 : 5;
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: count * 2,
        sessionGeneration: pendingOnly ? 92 : nonClosest ? 93 : 91
    });
    const jHandles = Array.from({ length: count }, (_, index) => Object.freeze({
        entityId: index + 1,
        incarnation: 1
    }));
    const probeHandles = Array.from({ length: count }, (_, index) => Object.freeze({
        entityId: count + index + 1,
        incarnation: 1
    }));
    try {
        backend.init(tileMap);
        const bodies = [];
        for (let index = 0; index < count; index++) {
            const center = Object.freeze({ x: 3 + (index * 2), y: 4 });
            bodies.push(createActivatedJ(
                route,
                jHandles[index],
                center,
                pendingOnly
                    ? GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.SPLIT_PENDING
                    : GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.ARMED
            ));
            bodies.push(createProbe(
                probeHandles[index],
                { x: center.x + 0.9, y: center.y },
                { closestOnly: !nonClosest }
            ));
        }
        const replaced = backend.replaceBodies(bodies);
        assert(replaced.accepted === bodies.length,
            `first-hit replace failed ${JSON.stringify(replaced)}`);
        assert(backend.fixedUpdate(FIXED_DELTA, 1), 'first-hit submit failed');
        const status = await waitForSimulation(backend, 'first-hit');
        const after = await readBodies(backend);
        const events = backend.drainCompletedEventBatches([])
            .flatMap(({ events: batchEvents }) => batchEvents);
        const triggerEvents = events.filter((event) => (
            event.eventType === 'damage-applied'
            && (event.flags
                & GPU_CIRCLE_APPLIED_EVENT_FLAG.ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT) !== 0
        ));
        const orientedTriggerEventCount = triggerEvents.filter((event) => {
            const targetIndex = jHandles.findIndex((handle) => (
                handle.entityId === event.otherEntityId
                && handle.incarnation === event.otherIncarnation
            ));
            return targetIndex >= 0
                && probeHandles[targetIndex].entityId === event.entityId
                && probeHandles[targetIndex].incarnation === event.incarnation;
        }).length;
        const pendingCount = jHandles.filter((handle) => (
            findBody(after, handle)?.atomicTransformState?.phase
                === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.SPLIT_PENDING
        )).length;
        const unchangedJHealthCount = jHandles.filter((handle) => (
            findBody(after, handle)?.health === 1
        )).length;
        const consumedSourceBudgetCount = probeHandles.filter((handle) => {
            const body = findBody(after, handle);
            return body === undefined || body.health === 0 || body.alive === false;
        }).length;
        if (pendingOnly) {
            assert(triggerEvents.length === 0
                && pendingCount === 1
                && unchangedJHealthCount === 1
                && consumedSourceBudgetCount === 0,
            `pending shield mismatch ${JSON.stringify({
                events,
                pendingCount,
                unchangedJHealthCount,
                consumedSourceBudgetCount,
                after
            })}`);
        } else if (nonClosest) {
            assert(triggerEvents.length === 0
                && pendingCount === 0
                && unchangedJHealthCount === 0
                && consumedSourceBudgetCount === count,
            `non-CLOSEST generic semantics mismatch ${JSON.stringify({
                events,
                pendingCount,
                unchangedJHealthCount,
                consumedSourceBudgetCount,
                after
            })}`);
        } else {
            assert(triggerEvents.length === count
                && orientedTriggerEventCount === count
                && triggerEvents.every((event) => event.valueFixedPoint === 0)
                && pendingCount === count
                && unchangedJHealthCount === count
                && consumedSourceBudgetCount === count,
            `same-tick admission mismatch ${JSON.stringify({
                triggerEvents,
                pendingCount,
                unchangedJHealthCount,
                consumedSourceBudgetCount,
                after
            })}`);
        }
        return Object.freeze({
            count,
            triggerEventCount: triggerEvents.length,
            orientedTriggerEventCount,
            pendingCount,
            unchangedJHealthCount,
            consumedSourceBudgetCount,
            storageProfile: status.fixedPrimitives.storageProfile
        });
    } finally {
        backend.destroy();
    }
}

function requireAccepted(receipt, label) {
    assert(receipt?.accepted === true, label + ': ' + JSON.stringify(receipt));
    return receipt;
}

function findSpawnHandle(lifecycle, commandId, label) {
    const handle = lifecycle.spawned.find(
        (entry) => entry.commandId === commandId
    )?.handle;
    assert(handle, label + ': missing spawn ' + commandId);
    return handle;
}

function sameVector(left, right) {
    return left?.x === right?.x && left?.y === right?.y;
}

function nearVector(left, right, tolerance = 0.125) {
    return Number.isFinite(left?.x)
        && Number.isFinite(left?.y)
        && Number.isFinite(right?.x)
        && Number.isFinite(right?.y)
        && Math.abs(left.x - right.x) <= tolerance
        && Math.abs(left.y - right.y) <= tolerance;
}

function copyView(endpoint, handle, label) {
    const view = endpoint.getRegistry().copyEntityView(handle, {});
    assert(view, label + ': missing registry view ' + JSON.stringify(handle));
    return view;
}

function copyFirstHitMutationBody(body) {
    return Object.freeze({
        handle: body.handle,
        healthFixedPoint: body.healthFixedPoint,
        alive: body.alive,
        lifetime: body.lifetime,
        position: body.position,
        velocity: body.velocity,
        flowFieldIndex: body.flowFieldIndex,
        flowSpeed: body.flowSpeed,
        atomicTransformState: body.atomicTransformState
    });
}

function stableEffectRecords(records) {
    return [...records].sort((left, right) => (
        left.effectInstanceId - right.effectInstanceId
    ));
}

function stableRegistryView(view) {
    const metadata = view.metadata ?? {};
    return Object.freeze({
        kindId: view.kindId,
        definitionId: view.definitionId,
        metadata: Object.freeze({
            teamId: metadata.teamId,
            damagePolicyId: metadata.damagePolicyId,
            allegiancePolicy: metadata.allegiancePolicy,
            gateId: metadata.gateId,
            pathId: metadata.pathId,
            initialWaypointIndex: metadata.initialWaypointIndex,
            spawnSequence: metadata.spawnSequence,
            waveId: metadata.waveId,
            policyId: metadata.policyId,
            atomicTransformProfileId: metadata.atomicTransformProfileId,
            lineageRootEntityId: metadata.lineageRootEntityId,
            lineageRootIncarnation: metadata.lineageRootIncarnation,
            branchIndex: metadata.branchIndex,
            bountyBudget: metadata.bountyBudget,
            transformAtTick: metadata.transformAtTick
        })
    });
}

async function runActualLineageRoundTrip(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const circlePrime = resolveBasicCirclePrimeTransformPrivateDefinition();
    let coreCleanupBinding = null;
    const endpoint = createActualEndpoint(
        device,
        format,
        12,
        (binding) => { coreCleanupBinding = binding; }
    );
    let director = null;
    let coreDirector = null;
    const coreIntegrity = new CoreIntegrity({ maxIntegrity: 100 });
    try {
        initializeActualEndpoint(endpoint, tileMap, 'actual lineage');
        director = createActualJorangDirector(endpoint);
        assert(coreCleanupBinding?.port,
            'actual lineage Core cleanup binding missing');
        coreDirector = new EnemyCoreImpactDirector({
            coreIntegrity,
            endpoint,
            coreImpactCleanupPort: coreCleanupBinding.port
        });

        requireAccepted(endpoint.requestSpawnBatch([
            {
                intent: createNaturalJorangIntent(route, 1, { x: 4, y: 4 }),
                targetFixedTick: 1,
                commandId: 'actual-lineage:j:spawn'
            },
            {
                intent: createPentaIntent(route, 2, { x: 9, y: 4 }),
                targetFixedTick: 1,
                commandId: 'actual-lineage:penta:spawn'
            },
            {
                intent: createPentaIntent(route, 3, { x: 4, y: 9 }),
                targetFixedTick: 1,
                commandId: 'actual-lineage:second-penta:spawn'
            },
            {
                intent: createProbeIntent({ x: 4, y: 4 }, {
                    closestOnly: false,
                    damageOther: 0.4,
                    commandTag: 'generic-pre-damage'
                }),
                targetFixedTick: 1,
                commandId: 'actual-lineage:pre-damage:spawn'
            }
        ]), 'actual lineage initial spawn batch');
        const tick1 = await advanceActualTick({
            endpoint,
            director,
            coreDirector,
            tick: 1,
            label: 'actual lineage T1'
        });
        const sourceHandle = findSpawnHandle(
            tick1.lifecycle,
            'actual-lineage:j:spawn',
            'actual lineage'
        );
        const pentaHandle = findSpawnHandle(
            tick1.lifecycle,
            'actual-lineage:penta:spawn',
            'actual lineage'
        );
        const secondPentaHandle = findSpawnHandle(
            tick1.lifecycle,
            'actual-lineage:second-penta:spawn',
            'actual lineage'
        );
        const sourceAfterPreDamage = findRequiredBody(
            tick1.bodies,
            sourceHandle,
            'actual lineage pre-damaged J'
        );
        assert(sourceAfterPreDamage.healthFixedPoint === 60,
            'actual lineage generic pre-damage must leave 60 centi HP');

        let effectStage = null;
        await advanceActualTick({
            endpoint,
            director,
            coreDirector,
            tick: 2,
            label: 'actual lineage T2',
            beforeSubmit: () => {
                effectStage = endpoint.getBackend().stageEffectPulseProgramBatch({
                    abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
                    sourceTick: 2,
                    batchIdFingerprint: 0x6a0002,
                    records: [
                        createEffectPulseRecord(pentaHandle, 2),
                        createEffectPulseRecord(secondPentaHandle, 2, 1)
                    ]
                });
                requireAccepted(effectStage, 'actual lineage Effect pulse stage');
            }
        });
        const effectCompletion = await waitForDirectEffectCompletion(
            endpoint,
            'actual lineage Effect pulse'
        );
        assert(effectCompletion.appliedInstanceCount === 2
            && effectCompletion.pulseResults?.length === 2
            && effectCompletion.pulseResults.every(
                (result) => result.appliedCount === 1
            ),
        'actual lineage two Penta pulses must apply exactly once each');
        const sourceEffects = (await readActiveEffectInstances(endpoint, device))
            .filter((entry) => (
                entry.targetEntityId === sourceHandle.entityId
                && entry.targetIncarnation === sourceHandle.incarnation
            ))
            .sort((left, right) => (
                left.effectInstanceId - right.effectInstanceId
            ));
        assert(sourceEffects.length === 2
            && new Set(sourceEffects.map(
                (entry) => entry.effectInstanceId
            )).size === 2
            && new Set(sourceEffects.map(
                (entry) => entry.effectInstanceId % 2
            )).size === 2,
        'actual lineage J must own two opposite-parity stable Effect instances');
        requireAccepted(endpoint.requestSpawn(
            createProbeIntent(sourceAfterPreDamage.position, {
                commandTag: 'first-hit'
            }),
            3,
            'actual-lineage:first-hit:spawn'
        ), 'actual lineage first-hit probe');
        const tick3 = await advanceActualTick({
            endpoint,
            director,
            coreDirector,
            tick: 3,
            label: 'actual lineage T3'
        });
        const preSplitBody = findRequiredBody(
            tick3.bodies,
            sourceHandle,
            'actual lineage pre-split body'
        );

        const tick4 = await advanceActualTick({
            endpoint,
            director,
            coreDirector,
            tick: 4,
            label: 'actual lineage T4'
        });
        assert(tick4.boundary.triggerObservation.triggerCount === 1
            && tick4.atomicStage.candidateCount === 1
            && tick4.boundary.preparationObservation.transformCount === 1
            && tick4.lifecycle.atomicTransforms.length === 1,
        'actual lineage split must publish one transform');
        const splitTransform = tick4.lifecycle.atomicTransforms[0];
        const children = splitTransform.destinationHandles;
        assert(splitTransform.topologyId
                === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
            && splitTransform.effectTransferDestinationIndex === 0
            && children.length === 2
            && children[0].entityId === sourceHandle.entityId
            && children[0].incarnation === sourceHandle.incarnation + 1
            && children[1].entityId !== sourceHandle.entityId
            && !endpoint.getRegistry().has(sourceHandle),
        'actual lineage split identity/topology mismatch');
        const childBodies = children.map((handle, index) => findRequiredBody(
            tick4.bodies,
            handle,
            'actual lineage child ' + index
        ));
        const meanChildVelocity = Object.freeze({
            x: (childBodies[0].velocity.x + childBodies[1].velocity.x) * 0.5,
            y: (childBodies[0].velocity.y + childBodies[1].velocity.y) * 0.5
        });
        const splitPostStepConserved = childBodies.every((body) => (
            sameVector(body.previousPosition, preSplitBody.position)
            && body.flowFieldIndex === preSplitBody.flowFieldIndex
            && body.previousFlowFieldIndex
                === preSplitBody.flowFieldIndex
            && body.flowSpeed === preSplitBody.flowSpeed
        )) && nearVector(meanChildVelocity, preSplitBody.velocity);
        assert(splitPostStepConserved,
            'actual lineage split pose/velocity-conservation/flow copy mismatch');
        const childMaxHealth = await Promise.all(childBodies.map(
            (body) => readMaxHealthFixedPoint(endpoint, device, body)
        ));
        assert(childBodies.every((body) => body.healthFixedPoint === 100)
            && childMaxHealth.every((value) => value === 100),
        'actual lineage children must start at 100/100 HP');
        const childViews = children.map((handle, index) => (
            copyView(endpoint, handle, 'actual lineage child view ' + index)
        ));
        const childBounties = childViews.map(
            (view) => view.metadata?.bountyBudget
        );
        assert(childViews.every((view, index) => (
            view.definitionId === circlePrime.id
            && view.metadata?.lineageRootEntityId === sourceHandle.entityId
            && view.metadata?.lineageRootIncarnation === sourceHandle.incarnation
            && view.metadata?.branchIndex === index
            && view.metadata?.transformAtTick === 64
        )) && childBounties.join(',') === '6,6',
        'actual lineage child metadata mismatch');
        const splitEffects = await readActiveEffectInstances(endpoint, device);
        const child0Effects = splitEffects.filter((entry) => (
            entry.targetEntityId === children[0].entityId
            && entry.targetIncarnation === children[0].incarnation
        ));
        const child1Effects = splitEffects.filter((entry) => (
            entry.targetEntityId === children[1].entityId
            && entry.targetIncarnation === children[1].incarnation
        ));
        const distributedEffects = [child0Effects, child1Effects];
        const effectDestinationIndex = sourceEffects[0].effectInstanceId
            % children.length;
        const transferredEffect = distributedEffects[effectDestinationIndex]
            .find((entry) => (
                entry.effectInstanceId === sourceEffects[0].effectInstanceId
            ));
        const survivingHandle = children[effectDestinationIndex];
        const survivingBody = childBodies[effectDestinationIndex];
        const forfeitedIndex = 1 - effectDestinationIndex;
        const forfeitedHandle = children[forfeitedIndex];
        const forfeitedBody = childBodies[forfeitedIndex];
        const distributedEffectIds = distributedEffects
            .flat()
            .map((entry) => entry.effectInstanceId)
            .sort((left, right) => left - right);
        const sourceEffectIds = sourceEffects
            .map((entry) => entry.effectInstanceId)
            .sort((left, right) => left - right);
        const everyEffectRekeyedExactlyOnce = sourceEffects.every(
            (sourceEffect) => {
                const destinationIndex = sourceEffect.effectInstanceId
                    % children.length;
                const matches = distributedEffects.flat().filter((entry) => (
                    entry.effectInstanceId === sourceEffect.effectInstanceId
                ));
                return matches.length === 1
                    && matches[0].targetSlot
                        === childBodies[destinationIndex].index
                    && matches[0].targetEntityId
                        === children[destinationIndex].entityId
                    && matches[0].targetIncarnation
                        === children[destinationIndex].incarnation
                    && exactEffectPayloadEqual(sourceEffect, matches[0]);
            }
        );
        assert(distributedEffects[0].length === 1
            && distributedEffects[1].length === 1
            && distributedEffectIds.join(',') === sourceEffectIds.join(',')
            && everyEffectRekeyedExactlyOnce
            && transferredEffect.targetSlot === survivingBody.index
            && exactEffectPayloadEqual(sourceEffects[0], transferredEffect)
            && tick4.runtime.atomic.runtimeStatus
                === GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.OK
            && tick4.runtime.atomic.lastCommittedTransformCount === 1
            && tick4.runtime.atomic.lastEffectRekeyCount === 2,
        'actual lineage split Effect/GPU completion mismatch');

        requireAccepted(endpoint.requestDespawn(
            pentaHandle,
            'fixture-retire-effect-source',
            5,
            'actual-lineage:penta:despawn'
        ), 'actual lineage Penta retire');
        requireAccepted(endpoint.requestDespawn(
            secondPentaHandle,
            'fixture-retire-effect-source',
            5,
            'actual-lineage:second-penta:despawn'
        ), 'actual lineage second Penta retire');
        const coreTemplate = createGpuCoreProxySpawnIntent({
            position: { x: 0, y: 0 }
        });
        const corePosition = createOutwardCorePosition(
            survivingBody,
            forfeitedBody,
            coreTemplate.radius
        );
        requireAccepted(endpoint.requestSpawn(
            createGpuCoreProxySpawnIntent({ position: corePosition }),
            5,
            'actual-lineage:core:spawn'
        ), 'actual lineage Core proxy spawn');
        const tick5 = await advanceActualTick({
            endpoint,
            director,
            coreDirector,
            tick: 5,
            label: 'actual lineage T5'
        });
        const coreHandle = findSpawnHandle(
            tick5.lifecycle,
            'actual-lineage:core:spawn',
            'actual lineage'
        );
        const tick6 = await advanceActualTick({
            endpoint,
            director,
            coreDirector,
            tick: 6,
            label: 'actual lineage T6'
        });
        const coreImpact = tick6.boundary.coreObservation.facts.find((fact) => (
            fact.type === CORE_IMPACT_FACT_TYPE.IMPACT
            && exactHandle(fact.enemyHandle, forfeitedHandle)
        ));
        assert(coreImpact
            && coreImpact.bountyBudget === 6
            && coreImpact.bountyEligible === false
            && coreIntegrity.getCurrentIntegrity() === 99
            && tick6.lifecycle.despawned.some(
                (entry) => exactHandle(entry.handle, forfeitedHandle)
            )
            && coreDirector.getStatus().cleanupCommittedCount === 1,
        `actual lineage Core forfeiture mismatch: ${JSON.stringify({
            coreImpact,
            coreObservation: tick6.boundary.coreObservation,
            events: tick6.boundary.events,
            coreIntegrity: coreIntegrity.getCurrentIntegrity(),
            despawned: tick6.lifecycle.despawned,
            corePosition,
            tick5Bodies: tick5.bodies,
            tick6Bodies: tick6.bodies,
            coreStatus: coreDirector.getStatus()
        })}`);
        requireAccepted(endpoint.requestDespawn(
            coreHandle,
            'fixture-retire-core-proxy',
            7,
            'actual-lineage:core:despawn'
        ), 'actual lineage Core proxy retire');
        await advanceActualTick({
            endpoint,
            director,
            coreDirector,
            tick: 7,
            label: 'actual lineage T7'
        });

        let tick62 = null;
        for (let tick = 8; tick <= 62; tick++) {
            tick62 = await advanceActualTick({
                endpoint,
                director,
                coreDirector,
                tick,
                label: 'actual lineage T' + tick
            });
            if (tick % 12 === 0) {
                await endpoint.getBackend().simulation.device.queue
                    .onSubmittedWorkDone();
                await new Promise((resolve) => setTimeout(resolve, 0));
                assert(!endpoint.requiresRecovery(),
                    'actual lineage cadence recovery at T' + tick);
            }
        }
        assert(tick62.atomicStage.candidateCount === 0
            && director.getStatus().circlePrimeDueCount === 1,
        'actual lineage return became eligible before T-1');
        const returnSourceBeforeDamage = findRequiredBody(
            tick62.bodies,
            survivingHandle,
            'actual lineage surviving child'
        );
        requireAccepted(endpoint.requestSpawn(
            createProbeIntent(returnSourceBeforeDamage.position, {
                damageOther: 0.25,
                commandTag: 'delayed-return-damage'
            }),
            63,
            'actual-lineage:return-damage:spawn'
        ), 'actual lineage return damage probe');
        const tick63 = await advanceActualTick({
            endpoint,
            director,
            coreDirector,
            tick: 63,
            label: 'actual lineage T63'
        });
        const damagedSource = findRequiredBody(
            tick63.bodies,
            survivingHandle,
            'actual lineage damaged return source'
        );
        assert(tick63.atomicStage.candidateCount === 1
            && damagedSource.healthFixedPoint < 100,
        'actual lineage T-1 prepare/damage mismatch');

        const tick64 = await advanceActualTick({
            endpoint,
            director,
            coreDirector,
            tick: 64,
            label: 'actual lineage T64'
        });
        const returnPrepare = tick64.boundary.prepare.records.find(
            (record) => exactHandle(record.sourceHandle, survivingHandle)
        );
        assert(returnPrepare
            && returnPrepare.currentHealthFixedPoint
                === damagedSource.healthFixedPoint
            && tick64.boundary.preparationObservation.transformCount === 1
            && tick64.lifecycle.atomicTransforms.length === 1,
        'actual lineage delayed return publication mismatch');
        const returnTransform = tick64.lifecycle.atomicTransforms[0];
        const returnedHandle = returnTransform.destinationHandles[0];
        assert(returnTransform.topologyId
                === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED
            && returnTransform.destinationHandles.length === 1
            && returnedHandle.entityId === survivingHandle.entityId
            && returnedHandle.incarnation === survivingHandle.incarnation + 1,
        'actual lineage delayed return identity mismatch');
        const returnedBody = findRequiredBody(
            tick64.bodies,
            returnedHandle,
            'actual lineage returned J'
        );
        const returnedMaxHealth = await readMaxHealthFixedPoint(
            endpoint,
            device,
            returnedBody
        );
        const expectedReturnedHealth = Math.min(
            returnPrepare.maxHealthFixedPoint,
            returnPrepare.currentHealthFixedPoint
                + PENTA_BOOST_EFFECT_DEFINITION.healthDeltaFixedPerTick
        );
        const returnPostStepPreserved = sameVector(
            returnedBody.previousPosition,
            damagedSource.position
        ) && nearVector(returnedBody.velocity, damagedSource.velocity)
            && returnedBody.flowFieldIndex === damagedSource.flowFieldIndex
            && returnedBody.previousFlowFieldIndex
                === damagedSource.flowFieldIndex
            && returnedBody.flowSpeed === damagedSource.flowSpeed;
        assert(returnPostStepPreserved
            && returnedBody.healthFixedPoint === expectedReturnedHealth
            && returnedMaxHealth === returnPrepare.maxHealthFixedPoint,
        'actual lineage delayed return pose/velocity/flow/HP mismatch');
        const returnedView = copyView(
            endpoint,
            returnedHandle,
            'actual lineage returned J view'
        );
        const returnedEffects = (await readActiveEffectInstances(endpoint, device))
            .filter((entry) => (
                entry.targetEntityId === returnedHandle.entityId
                && entry.targetIncarnation === returnedHandle.incarnation
            ));
        assert(returnedView.definitionId === BASIC_JORANG_ENEMY_DATA.id
            && returnedView.metadata?.lineageRootEntityId === sourceHandle.entityId
            && returnedView.metadata?.lineageRootIncarnation
                === sourceHandle.incarnation
            && returnedView.metadata?.branchIndex === effectDestinationIndex
            && returnedView.metadata?.bountyBudget === 6
            && returnedView.metadata?.transformAtTick === 0
            && countDefinition(endpoint, circlePrime.id) === 0
            && countDefinition(endpoint, BASIC_JORANG_ENEMY_DATA.id) === 1
            && returnedEffects.length === 1
            && returnedEffects[0].targetSlot === returnedBody.index
            && exactEffectPayloadEqual(sourceEffects[0], returnedEffects[0])
            && tick64.runtime.atomic.runtimeStatus
                === GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.OK
            && tick64.runtime.atomic.lastCommittedTransformCount === 1
            && tick64.runtime.atomic.lastEffectRekeyCount === 1,
        'actual lineage delayed return registry/Effect/GPU mismatch');

        return Object.freeze({
            split: Object.freeze({
                publicationTick: 4,
                topologyId: splitTransform.topologyId,
                sourceConsumed: true,
                childCount: 2,
                child0RootIdentity: true,
                child1DistinctIdentity: true,
                postStepPoseFlowAndVelocityConserved:
                    splitPostStepConserved,
                childHealthCenti: Object.freeze(
                    childBodies.map((body) => body.healthFixedPoint)
                ),
                childMaximumHealthCenti: Object.freeze(childMaxHealth),
                childBountyBudgets: Object.freeze(childBounties),
                lineageRootPairPreserved: true,
                branchIndices: Object.freeze(
                    childViews.map((view) => view.metadata.branchIndex)
                ),
                effectTransferDestinationIndex:
                    splitTransform.effectTransferDestinationIndex,
                effectDefinitionTransferDestinationIndex:
                    effectDestinationIndex,
                effectDistributionPolicy:
                    PENTA_BOOST_EFFECT_DEFINITION
                        .atomicTransformTransferPolicy,
                child0EffectInstanceCount: child0Effects.length,
                child1EffectInstanceCount: child1Effects.length,
                sourceEffectInstanceCount: sourceEffects.length,
                sourceEffectInstanceIds: Object.freeze(sourceEffectIds),
                sourceEffectDestinationParity: Object.freeze(
                    sourceEffects.map((entry) => (
                        entry.effectInstanceId % children.length
                    ))
                ),
                distributedEffectInstanceCount:
                    distributedEffects[0].length
                        + distributedEffects[1].length,
                distributedEffectInstanceIds:
                    Object.freeze(distributedEffectIds),
                everyEffectRekeyedExactlyOnce,
                effectCloneCount: 0,
                effectDropCount: 0,
                effectTargetSlotMatchesBody:
                    transferredEffect.targetSlot === survivingBody.index,
                exactEffectPayloadPreserved: true,
                gpuCommittedCount:
                    tick4.runtime.atomic.lastCommittedTransformCount,
                gpuEffectRekeyCount: tick4.runtime.atomic.lastEffectRekeyCount
            }),
            coreForfeiture: Object.freeze({
                impactFactCount: 1,
                cleanupCommitted: true,
                forfeitedBudget: coreImpact.bountyBudget,
                bountyEligible: coreImpact.bountyEligible,
                returnedJCount: 0,
                coreIntegrity: coreIntegrity.getCurrentIntegrity()
            }),
            delayedReturn: Object.freeze({
                notDuePrepareCandidateCount:
                    tick62.atomicStage.candidateCount,
                preparedAtTick: 63,
                publicationTick: 64,
                delayFixedTicks: JORANG_RETURN_DELAY_FIXED_TICKS,
                topologyId: returnTransform.topologyId,
                returnedJCount: 1,
                exactRootIdentity: true,
                postStepPoseFlowVelocityPreserved:
                    returnPostStepPreserved,
                preparedHealthCenti: returnPrepare.currentHealthFixedPoint,
                returnedHealthCenti: returnedBody.healthFixedPoint,
                maximumHealthCenti: returnedMaxHealth,
                effectInstanceCount: returnedEffects.length,
                effectTargetSlotMatchesBody:
                    returnedEffects[0].targetSlot === returnedBody.index,
                exactEffectPayloadPreserved: true,
                bountyBudget: returnedView.metadata.bountyBudget,
                gpuCommittedCount:
                    tick64.runtime.atomic.lastCommittedTransformCount,
                gpuEffectRekeyCount: tick64.runtime.atomic.lastEffectRekeyCount
            }),
            requiresRecovery: endpoint.requiresRecovery()
                || director.requiresRecovery()
                || coreDirector.requiresRecovery()
        });
    } finally {
        coreDirector?.destroy();
        director?.destroy();
        endpoint.destroy();
    }
}

async function runActualFiveToFourPlusOne(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const circlePrime = resolveBasicCirclePrimeTransformPrivateDefinition();
    const endpoint = createActualEndpoint(device, format, 16);
    let director = null;
    try {
        initializeActualEndpoint(endpoint, tileMap, 'actual 5-to-4+1');
        director = createActualJorangDirector(endpoint);
        const requests = [];
        for (let index = 0; index < 5; index++) {
            const center = { x: 3 + (index * 4), y: 4 };
            requests.push({
                intent: createNaturalJorangIntent(route, index + 1, center),
                targetFixedTick: 1,
                commandId: 'actual-burst:j:' + index
            }, {
                intent: createProbeIntent(
                    center,
                    {
                        health: 2,
                        commandTag: 'burst-first-hit-' + index
                    }
                ),
                targetFixedTick: 1,
                commandId: 'actual-burst:probe:' + index
            });
        }
        requireAccepted(
            endpoint.requestSpawnBatch(requests),
            'actual 5-to-4+1 initial batch'
        );
        const tick1 = await advanceActualTick({
            endpoint,
            director,
            tick: 1,
            label: 'actual 5-to-4+1 T1'
        });
        const sources = Array.from({ length: 5 }, (_, index) => (
            findSpawnHandle(
                tick1.lifecycle,
                'actual-burst:j:' + index,
                'actual 5-to-4+1'
            )
        ));

        const tick2 = await advanceActualTick({
            endpoint,
            director,
            tick: 2,
            label: 'actual 5-to-4+1 T2'
        });
        assert(tick2.boundary.triggerObservation.triggerCount === 5
            && tick2.atomicStage.candidateCount === 5,
        'actual 5-to-4+1 did not admit all five first hits');

        const tick3 = await advanceActualTick({
            endpoint,
            director,
            tick: 3,
            label: 'actual 5-to-4+1 T3'
        });
        const firstStartedSources = tick2.lifecycle.atomicTransforms.map(
            (entry) => entry.sourceHandles[0].entityId
        );
        assert(tick2.boundary.prepare.records.length === 5
            && tick2.boundary.preparationObservation.transformCount
                === JORANG_MAXIMUM_TRANSFORM_STARTS_PER_FIXED_TICK
            && tick2.atomicStage.candidateCount === 5
            && tick2.lifecycle.atomicTransforms.length === 4
            && firstStartedSources.join(',')
                === sources.slice(0, 4).map((handle) => handle.entityId).join(',')
            && tick2.runtime.atomic.runtimeStatus
                === GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.OK
            && tick2.runtime.atomic.lastCommittedTransformCount === 4
            && tick3.boundary.prepare.records.length === 1
            && tick3.boundary.preparationObservation.transformCount === 1
            && tick3.lifecycle.atomicTransforms.length === 1
            && exactHandle(
                tick3.lifecycle.atomicTransforms[0].sourceHandles[0],
                sources[4]
            )
            && tick3.runtime.atomic.runtimeStatus
                === GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.OK
            && tick3.runtime.atomic.lastCommittedTransformCount === 1,
        `actual 5-to-4+1 publication cadence mismatch: ${JSON.stringify({
            firstPrepareRecordCount: tick2.boundary.prepare.records.length,
            firstPreparationObservation:
                tick2.boundary.preparationObservation,
            firstStageCandidateCount: tick2.atomicStage.candidateCount,
            firstLifecycleTransformCount:
                tick2.lifecycle.atomicTransforms.length,
            firstStartedSources,
            expectedSources: sources.slice(0, 4).map(
                (handle) => handle.entityId
            ),
            firstGpuCommittedCount:
                tick2.runtime.atomic.lastCommittedTransformCount,
            secondPrepareRecordCount: tick3.boundary.prepare.records.length,
            secondPreparationObservation:
                tick3.boundary.preparationObservation,
            secondLifecycleTransformCount:
                tick3.lifecycle.atomicTransforms.length,
            secondGpuCommittedCount:
                tick3.runtime.atomic.lastCommittedTransformCount,
            directorStatus: director.getStatus()
        })}`);

        assert(countDefinition(endpoint, circlePrime.id) === 10
            && countDefinition(endpoint, BASIC_JORANG_ENEMY_DATA.id) === 0
            && director.getStatus().pendingFirstHitCount === 0,
        'actual 5-to-4+1 final roster mismatch');
        return Object.freeze({
            admittedFirstHitCount: tick2.boundary.triggerObservation.triggerCount,
            firstPrepareCandidateCount: tick2.boundary.prepare.records.length,
            firstLifecycleTransformCount:
                tick2.lifecycle.atomicTransforms.length,
            firstGpuCommittedCount:
                tick2.runtime.atomic.lastCommittedTransformCount,
            secondPrepareCandidateCount: tick3.boundary.prepare.records.length,
            secondLifecycleTransformCount:
                tick3.lifecycle.atomicTransforms.length,
            secondGpuCommittedCount:
                tick3.runtime.atomic.lastCommittedTransformCount,
            sourceOrderExact: true,
            hostStartsByTick: Object.freeze([4, 1]),
            finalCirclePrimeCount: countDefinition(endpoint, circlePrime.id),
            pendingFirstHitCount: director.getStatus().pendingFirstHitCount,
            requiresRecovery: endpoint.requiresRecovery()
                || director.requiresRecovery()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runActualCapacityRestage(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const circlePrime = resolveBasicCirclePrimeTransformPrivateDefinition();
    const endpoint = createActualEndpoint(device, format, 2);
    let director = null;
    try {
        initializeActualEndpoint(endpoint, tileMap, 'actual capacity');
        director = createActualJorangDirector(endpoint);
        requireAccepted(endpoint.requestSpawnBatch([
            {
                intent: createNaturalJorangIntent(route, 1, { x: 4, y: 4 }),
                targetFixedTick: 1,
                commandId: 'actual-capacity:j:spawn'
            },
            {
                intent: createProbeIntent({ x: 4, y: 4 }, {
                    health: 2,
                    commandTag: 'capacity-first-hit'
                }),
                targetFixedTick: 1,
                commandId: 'actual-capacity:probe:spawn'
            }
        ]), 'actual capacity initial spawn batch');
        const tick1 = await advanceActualTick({
            endpoint,
            director,
            tick: 1,
            label: 'actual capacity T1'
        });
        const sourceHandle = findSpawnHandle(
            tick1.lifecycle,
            'actual-capacity:j:spawn',
            'actual capacity'
        );
        const blockerHandle = findSpawnHandle(
            tick1.lifecycle,
            'actual-capacity:probe:spawn',
            'actual capacity'
        );
        const tick2 = await advanceActualTick({
            endpoint,
            director,
            tick: 2,
            label: 'actual capacity T2'
        });
        assert(tick2.boundary.triggerObservation.triggerCount === 1
            && tick2.atomicStage.candidateCount === 1,
        'actual capacity first-hit prepare missing');

        const tick3 = await advanceActualTick({
            endpoint,
            director,
            tick: 3,
            label: 'actual capacity T3'
        });
        const firstCommandId = tick3.boundary.preparationObservation.commandId;
        const rejection = tick3.lifecycle.rejected.find(
            (entry) => entry.commandId === firstCommandId
        );
        const pendingBody = findRequiredBody(
            tick3.bodies,
            sourceHandle,
            'actual capacity pending source'
        );
        const rejectionEffectCount = (await readActiveEffectInstances(
            endpoint,
            device
        )).length;
        assert(rejection?.code === 'atomic-transform-capacity'
            && rejection.retryable === true
            && rejection.retryDisposition === 'restage-next-prepare'
            && rejection.sourcePendingPreserved === true
            && rejection.attemptConsumed === true
            && tick3.atomicStage.candidateCount === 1
            && pendingBody.atomicTransformState?.phase
                === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.SPLIT_PENDING
            && countDefinition(endpoint, circlePrime.id) === 0
            && rejectionEffectCount === 0
            && tick3.runtime.atomic.lastCommittedTransformCount === 0
            && !endpoint.requiresRecovery()
            && !director.requiresRecovery(),
        'actual capacity rejection was not zero-partial restage');

        requireAccepted(endpoint.requestDespawn(
            blockerHandle,
            'fixture-release-capacity',
            4,
            'actual-capacity:probe:despawn'
        ), 'actual capacity blocker retire');
        const tick4 = await advanceActualTick({
            endpoint,
            director,
            tick: 4,
            label: 'actual capacity T4'
        });
        const secondCommandId = tick4.boundary.preparationObservation.commandId;
        assert(tick4.boundary.prepare.records.length === 1
            && tick4.boundary.prepare.batchIdFingerprint
                !== tick3.boundary.prepare.batchIdFingerprint
            && secondCommandId !== firstCommandId
            && tick4.lifecycle.atomicTransforms.length === 1
            && tick4.runtime.atomic.runtimeStatus
                === GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.OK
            && tick4.runtime.atomic.lastCommittedTransformCount === 1
            && countDefinition(endpoint, circlePrime.id) === 2
            && director.getStatus().pendingFirstHitCount === 0
            && !endpoint.requiresRecovery()
            && !director.requiresRecovery(),
        'actual capacity fresh T+1 retry did not commit exactly once');
        return Object.freeze({
            rejectionCode: rejection.code,
            retryable: rejection.retryable,
            retryDisposition: rejection.retryDisposition,
            sourcePendingPreserved: rejection.sourcePendingPreserved,
            attemptConsumed: rejection.attemptConsumed,
            recoveryRequiredAtRejection: false,
            pendingPhasePreserved: true,
            halfChildCount: 0,
            effectInstanceCountAtRejection: rejectionEffectCount,
            firstCommandId,
            secondCommandId,
            freshCommandId: secondCommandId !== firstCommandId,
            freshPrepareFingerprint:
                tick4.boundary.prepare.batchIdFingerprint
                    !== tick3.boundary.prepare.batchIdFingerprint,
            retryLifecycleTransformCount:
                tick4.lifecycle.atomicTransforms.length,
            retryGpuCommittedCount:
                tick4.runtime.atomic.lastCommittedTransformCount,
            finalCirclePrimeCount: countDefinition(endpoint, circlePrime.id),
            requiresRecovery: endpoint.requiresRecovery()
                || director.requiresRecovery()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runActualFirstHitEventCapacityBackoff(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const circlePrime = resolveBasicCirclePrimeTransformPrivateDefinition();
    const endpoint = createActualEndpoint(
        device,
        format,
        8,
        null,
        { eventCapacity: 1 }
    );
    let director = null;
    try {
        initializeActualEndpoint(
            endpoint,
            tileMap,
            'actual first-hit event-capacity'
        );
        director = createActualJorangDirector(endpoint);
        const staticJ = (spawnSequence, position) => Object.freeze({
            ...createNaturalJorangIntent(route, spawnSequence, position),
            velocity: Object.freeze({ x: 0, y: 0 }),
            // The capacity probe isolates the producer-neutral first-hit
            // reservation. Reciprocal generic Enemy contact events would
            // consume the same public event array before the atomic seal.
            contactHandler: null
        });
        requireAccepted(endpoint.requestSpawnBatch([
            {
                intent: staticJ(1, { x: 4, y: 4 }),
                targetFixedTick: 1,
                commandId: 'actual-event-capacity:j:0'
            },
            {
                intent: staticJ(2, { x: 10, y: 4 }),
                targetFixedTick: 1,
                commandId: 'actual-event-capacity:j:1'
            },
            {
                intent: createPentaIntent(route, 3, { x: 7, y: 4 }),
                targetFixedTick: 1,
                commandId: 'actual-event-capacity:penta'
            }
        ]), 'actual first-hit event-capacity seed batch');
        const tick1 = await advanceActualTick({
            endpoint,
            director,
            tick: 1,
            label: 'actual first-hit event-capacity T1'
        });
        const jHandles = [0, 1].map((index) => findSpawnHandle(
            tick1.lifecycle,
            `actual-event-capacity:j:${index}`,
            'actual first-hit event-capacity'
        ));
        const pentaHandle = findSpawnHandle(
            tick1.lifecycle,
            'actual-event-capacity:penta',
            'actual first-hit event-capacity'
        );

        await advanceActualTick({
            endpoint,
            director,
            tick: 2,
            label: 'actual first-hit event-capacity T2',
            beforeSubmit: () => requireAccepted(
                endpoint.getBackend().stageEffectPulseProgramBatch({
                    abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
                    sourceTick: 2,
                    batchIdFingerprint: 0x6b0002,
                    records: [createEffectPulseRecord(pentaHandle, 2)]
                }),
                'actual first-hit event-capacity Effect stage'
            )
        });
        const effectCompletion = await waitForDirectEffectCompletion(
            endpoint,
            'actual first-hit event-capacity Effect pulse'
        );
        assert(effectCompletion.appliedInstanceCount === 2
            && effectCompletion.pulseResults?.[0]?.appliedCount === 2,
        'actual first-hit event-capacity must seed two Effect instances');
        const baselineBodies = await readBodies(endpoint.getBackend());
        const baselineJ = jHandles.map((handle, index) => (
            copyFirstHitMutationBody(findRequiredBody(
                baselineBodies,
                handle,
                `actual first-hit event-capacity baseline J${index}`
            ))
        ));
        const baselineViews = jHandles.map((handle, index) => (
            stableRegistryView(copyView(
                endpoint,
                handle,
                `actual first-hit event-capacity baseline view J${index}`
            ))
        ));
        const baselineEffects = stableEffectRecords(
            await readActiveEffectInstances(endpoint, device)
        );
        assert(baselineEffects.length === 2
            && jHandles.every((handle) => baselineEffects.some((entry) => (
                entry.targetEntityId === handle.entityId
                && entry.targetIncarnation === handle.incarnation
            ))),
        'actual first-hit event-capacity Effect baseline mismatch');

        const probeCommands = jHandles.map((_, index) => (
            `actual-event-capacity:probe:${index}`
        ));
        requireAccepted(endpoint.requestSpawnBatch(jHandles.map(
            (handle, index) => ({
                intent: createProbeIntent(baselineJ[index].position, {
                    health: 2,
                    commandTag: `event-capacity-${index}`
                }),
                targetFixedTick: 3,
                commandId: probeCommands[index]
            })
        )), 'actual first-hit event-capacity probe batch');
        const tick3 = await advanceActualTick({
            endpoint,
            director,
            tick: 3,
            label: 'actual first-hit event-capacity T3'
        });
        const probeHandles = probeCommands.map((commandId) => findSpawnHandle(
            tick3.lifecycle,
            commandId,
            'actual first-hit event-capacity'
        ));
        const rejectedJ = jHandles.map((handle, index) => (
            copyFirstHitMutationBody(findRequiredBody(
                tick3.bodies,
                handle,
                `actual first-hit event-capacity rejected J${index}`
            ))
        ));
        const rejectedProbes = probeHandles.map((handle, index) => (
            copyFirstHitMutationBody(findRequiredBody(
                tick3.bodies,
                handle,
                `actual first-hit event-capacity rejected probe${index}`
            ))
        ));
        const rejectedViews = jHandles.map((handle, index) => (
            stableRegistryView(copyView(
                endpoint,
                handle,
                `actual first-hit event-capacity rejected view J${index}`
            ))
        ));
        const rejectedEffects = stableEffectRecords(
            await readActiveEffectInstances(endpoint, device)
        );
        const exactFirstHitStatePreserved = rejectedJ.every((body, index) => (
            body.healthFixedPoint === baselineJ[index].healthFixedPoint
            && body.alive === baselineJ[index].alive
            && body.lifetime === baselineJ[index].lifetime
            && body.flowFieldIndex === baselineJ[index].flowFieldIndex
            && body.flowSpeed === baselineJ[index].flowSpeed
            && JSON.stringify(body.atomicTransformState)
                === JSON.stringify(baselineJ[index].atomicTransformState)
        ));
        assert(exactFirstHitStatePreserved
            && rejectedProbes.every((body) => body.healthFixedPoint === 200)
            && JSON.stringify(rejectedViews) === JSON.stringify(baselineViews)
            && JSON.stringify(rejectedEffects)
                === JSON.stringify(baselineEffects)
            && jHandles.every((handle) => findRequiredBody(
                tick3.bodies,
                handle,
                'actual first-hit event-capacity armed source'
            ).atomicTransformState?.phase
                === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.ARMED)
            && director.getStatus().pendingFirstHitCount === 0
            && !endpoint.requiresRecovery()
            && !director.requiresRecovery(),
        `actual first-hit event-capacity rejection mutated bilateral state: ${JSON.stringify({
            baselineJ,
            rejectedJ,
            rejectedProbes,
            baselineViews,
            rejectedViews,
            baselineEffects,
            rejectedEffects,
            pendingFirstHitCount: director.getStatus().pendingFirstHitCount,
            endpointRecovery: endpoint.requiresRecovery(),
            directorStatus: director.getStatus()
        })}`);

        let capacityBoundary = null;
        const tick4 = await advanceActualTick({
            endpoint,
            director,
            tick: 4,
            label: 'actual first-hit event-capacity T4',
            beforeStage: (boundary) => {
                capacityBoundary = boundary;
                const snapshot = boundary.events;
                assert(snapshot.atomicTransformFirstHitCapacityRejected === true
                    && snapshot
                        .retryableAtomicTransformFirstHitCapacityRejected
                        === true
                    && snapshot.atomicTransformFirstHitRejectionReason
                        === 'atomic-transform-first-hit-event-capacity'
                    && snapshot.atomicTransformFirstHitCandidateCount === 2
                    && snapshot.atomicTransformFirstHitCommittedCount === 0
                    && snapshot.atomicTransformFirstHitEventBase === 0
                    && snapshot.atomicTransformFirstHitEventCapacity === 1
                    && snapshot.events.length === 0
                    && snapshot.protocolFailure === null
                    && boundary.triggerObservation.accepted === true
                    && boundary.triggerObservation.retryable === true
                    && boundary.triggerObservation.capacityRejectionCount === 1
                    && boundary.triggerObservation.triggerCount === 0,
                'actual first-hit event-capacity public evidence mismatch');
                for (let index = 0; index < probeHandles.length; index++) {
                    requireAccepted(endpoint.requestDespawn(
                        probeHandles[index],
                        'fixture-retry-after-event-capacity',
                        4,
                        `actual-event-capacity:probe-retire:${index}`
                    ), 'actual first-hit event-capacity probe retire');
                }
                requireAccepted(endpoint.requestSpawn(
                    createProbeIntent(rejectedJ[0].position, {
                        health: 2,
                        commandTag: 'event-capacity-retry'
                    }),
                    4,
                    'actual-event-capacity:retry-probe'
                ), 'actual first-hit event-capacity retry probe');
            }
        });
        assert(capacityBoundary
            && director.getStatus().retryableFirstHitEventCapacityCount === 1
            && findRequiredBody(
                tick4.bodies,
                jHandles[0],
                'actual first-hit event-capacity retry target'
            ).atomicTransformState?.phase
                === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.SPLIT_PENDING
            && findRequiredBody(
                tick4.bodies,
                jHandles[1],
                'actual first-hit event-capacity untouched peer'
            ).atomicTransformState?.phase
                === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.ARMED,
        'actual first-hit event-capacity later-tick retry did not commit once');
        const retryProbeHandle = findSpawnHandle(
            tick4.lifecycle,
            'actual-event-capacity:retry-probe',
            'actual first-hit event-capacity retry'
        );
        const tick5 = await advanceActualTick({
            endpoint,
            director,
            tick: 5,
            label: 'actual first-hit event-capacity T5',
            beforeStage: () => requireAccepted(endpoint.requestDespawn(
                retryProbeHandle,
                'fixture-retire-event-capacity-retry',
                5,
                'actual-event-capacity:retry-probe-retire'
            ), 'actual first-hit event-capacity retry probe retire')
        });
        assert(tick5.boundary.triggerObservation.triggerCount === 1
            && tick5.boundary.triggerObservation.capacityRejectionCount === 0
            && tick5.atomicStage.candidateCount === 1
            && tick5.boundary.preparationObservation.transformCount === 1
            && tick5.lifecycle.atomicTransforms.length === 1
            && tick5.runtime.atomic.lastCommittedTransformCount === 1
            && countDefinition(endpoint, circlePrime.id) === 2
            && countDefinition(endpoint, BASIC_JORANG_ENEMY_DATA.id) === 1
            && !endpoint.requiresRecovery()
            && !director.requiresRecovery(),
        `actual first-hit event-capacity retry split did not succeed: ${JSON.stringify({
            prepare: tick5.boundary.prepare,
            preparationObservation:
                tick5.boundary.preparationObservation,
            lifecycle: tick5.lifecycle,
            runtimeAtomic: tick5.runtime.atomic,
            circlePrimeCount: countDefinition(endpoint, circlePrime.id),
            jorangCount: countDefinition(
                endpoint,
                BASIC_JORANG_ENEMY_DATA.id
            ),
            endpointRecovery: endpoint.requiresRecovery(),
            directorStatus: director.getStatus()
        })}`);

        return Object.freeze({
            rejectionReason:
                capacityBoundary.events
                    .atomicTransformFirstHitRejectionReason,
            retryable: capacityBoundary.events
                .retryableAtomicTransformFirstHitCapacityRejected,
            candidateCount: capacityBoundary.events
                .atomicTransformFirstHitCandidateCount,
            committedCount: capacityBoundary.events
                .atomicTransformFirstHitCommittedCount,
            eventBase: capacityBoundary.events
                .atomicTransformFirstHitEventBase,
            eventCapacity: capacityBoundary.events
                .atomicTransformFirstHitEventCapacity,
            triggerEventCountAtRejection:
                capacityBoundary.events.events.length,
            sourcePhaseUnchanged: true,
            sourceHealthUnchanged: true,
            sourcePoseFlowVelocityUnchanged: true,
            sourceMetadataUnchanged: true,
            sourceBudgetUnchanged: rejectedProbes.every(
                (body) => body.healthFixedPoint === 200
            ),
            effectInstancesUnchanged:
                JSON.stringify(rejectedEffects)
                    === JSON.stringify(baselineEffects),
            recoveryRequiredAtRejection: false,
            directorRetryableCapacityCount:
                director.getStatus().retryableFirstHitEventCapacityCount,
            retryTriggerCount: tick5.boundary.triggerObservation.triggerCount,
            retryPrepareCandidateCount: tick5.atomicStage.candidateCount,
            retryLifecycleTransformCount:
                tick5.lifecycle.atomicTransforms.length,
            retryGpuCommittedCount:
                tick5.runtime.atomic.lastCommittedTransformCount,
            finalCirclePrimeCount: countDefinition(endpoint, circlePrime.id),
            requiresRecovery: endpoint.requiresRecovery()
                || director.requiresRecovery()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function seedActualPrepare(endpoint, director, route, prefix) {
    requireAccepted(endpoint.requestSpawnBatch([
        {
            intent: createNaturalJorangIntent(route, 1, { x: 4, y: 4 }),
            targetFixedTick: 1,
            commandId: prefix + ':j:spawn'
        },
        {
            intent: createProbeIntent({ x: 4, y: 4 }, {
                health: 2,
                commandTag: prefix + '-first-hit'
            }),
            targetFixedTick: 1,
            commandId: prefix + ':probe:spawn'
        }
    ]), prefix + ' seed batch');
    const tick1 = await advanceActualTick({
        endpoint,
        director,
        tick: 1,
        label: prefix + ' T1'
    });
    const sourceHandle = findSpawnHandle(
        tick1.lifecycle,
        prefix + ':j:spawn',
        prefix
    );
    const pendingBody = findRequiredBody(
        tick1.bodies,
        sourceHandle,
        prefix + ' pending J'
    );
    assert(pendingBody.atomicTransformState?.phase
            === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.SPLIT_PENDING,
    prefix + ' did not author an authentic pending first hit');
    return Object.freeze({ sourceHandle, tick1 });
}

async function runActualUnpublishedTerminal(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const circlePrime = resolveBasicCirclePrimeTransformPrivateDefinition();
    const endpoint = createActualEndpoint(device, format, 4);
    let director = null;
    try {
        initializeActualEndpoint(endpoint, tileMap, 'unpublished terminal');
        director = createActualJorangDirector(endpoint);
        const seeded = await seedActualPrepare(
            endpoint,
            director,
            route,
            'actual-terminal-unpublished'
        );
        const boundary = drainActualBoundary(endpoint, director, 2);
        assert(boundary.preparationObservation.transformCount === 1
            && boundary.triggerObservation.triggerCount === 1,
        'unpublished terminal authentic prepare missing');
        director.closeForTerminal(2, 'run-defeated');
        endpoint.closeGameplayIngress('run-defeated', 2);
        const lifecycle = assertHealthyBoundary(
            endpoint.commitAtFixedBoundary(2),
            'unpublished terminal lifecycle'
        );
        director.observeFixedCommit(lifecycle, 2);
        director.observeLifecycle(lifecycle, 2);
        assert(endpoint.fixedUpdate(FIXED_DELTA, 2),
            'unpublished terminal final submit failed');
        const runtime = await waitForActualRuntime(
            endpoint,
            'unpublished terminal'
        );
        const bodies = await readBodies(endpoint.getBackend());
        const sourceBody = findRequiredBody(
            bodies,
            seeded.sourceHandle,
            'unpublished terminal source'
        );
        const terminal = endpoint.getTerminalAtomicTransformProgramCancelStatus();
        const directorTerminal = director.getStatus().terminal;
        assert(sourceBody.atomicTransformState?.phase
                === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.SPLIT_PENDING
            && countDefinition(endpoint, BASIC_JORANG_ENEMY_DATA.id) === 1
            && countDefinition(endpoint, circlePrime.id) === 0
            && lifecycle.atomicTransforms.length === 0
            && runtime.atomic.lastCommittedTransformCount === 0
            && terminal.owner?.abiVersion
                === GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION
            && terminal.owner?.pendingPrepareCount === 0
            && terminal.owner?.pendingTransformCount === 0
            && terminal.owner?.pendingReadbackCount === 0
            && terminal.backend?.state === 'submitted'
            && terminal.backend?.pendingPrepareCount === 0
            && terminal.backend?.pendingTransformCount === 0
            && terminal.backend?.pendingReadbackCount === 0
            && directorTerminal?.fixedCommitObserved === true
            && directorTerminal?.lifecycleObserved === true
            && directorTerminal?.rosterSealed === true
            && director.getStatus().lastFixedCommitTick === 2
            && !endpoint.requiresRecovery()
            && !director.requiresRecovery(),
        'unpublished terminal did not cancel before host publication');
        return Object.freeze({
            cancelledBeforePublication: true,
            sourceStayedPending: true,
            lifecycleTransformCount: lifecycle.atomicTransforms.length,
            circlePrimeCount: countDefinition(endpoint, circlePrime.id),
            gpuCommittedCount: runtime.atomic.lastCommittedTransformCount,
            ownerState: terminal.owner.state,
            ownerPendingPrepareCount: terminal.owner.pendingPrepareCount,
            ownerPendingTransformCount: terminal.owner.pendingTransformCount,
            ownerPendingReadbackCount: terminal.owner.pendingReadbackCount,
            backendState: terminal.backend.state,
            backendPendingPrepareCount: terminal.backend.pendingPrepareCount,
            backendPendingTransformCount: terminal.backend.pendingTransformCount,
            backendPendingReadbackCount: terminal.backend.pendingReadbackCount,
            fixedCommitObserved: directorTerminal.fixedCommitObserved,
            lifecycleObserved: directorTerminal.lifecycleObserved,
            rosterSealed: directorTerminal.rosterSealed,
            lastFixedCommitTick: director.getStatus().lastFixedCommitTick,
            requiresRecovery: endpoint.requiresRecovery()
                || director.requiresRecovery()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runActualPublishedTerminalAndReplacement(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const circlePrime = resolveBasicCirclePrimeTransformPrivateDefinition();
    const endpoint = createActualEndpoint(device, format, 4);
    let director = null;
    let oldPort = null;
    let oldSessionGeneration = 0;
    let published = null;
    try {
        initializeActualEndpoint(endpoint, tileMap, 'published terminal');
        director = createActualJorangDirector(endpoint);
        const seeded = await seedActualPrepare(
            endpoint,
            director,
            route,
            'actual-terminal-published'
        );
        oldPort = endpoint.getAtomicTransformCommandPort();
        oldSessionGeneration = endpoint.getStatus().sessionGeneration;

        const boundary = drainActualBoundary(endpoint, director, 2);
        assert(boundary.preparationObservation.transformCount === 1,
            'published terminal authentic prepare missing');
        const stage = director.stageForFixedTick({ targetFixedTick: 2 });
        requireAccepted(stage, 'published terminal T2 restage');
        const lifecycle = assertHealthyBoundary(
            endpoint.commitAtFixedBoundary(2),
            'published terminal lifecycle'
        );
        director.observeFixedCommit(lifecycle, 2);
        director.observeLifecycle(lifecycle, 2);
        const beforeCloseAtomic = endpoint.getBackend()
            .getAtomicTransformRuntimeStatus();
        assert(lifecycle.atomicTransforms.length === 1
            && countDefinition(endpoint, circlePrime.id) === 2
            && beforeCloseAtomic.pendingTransformCount === 1
            && director.getStatus().lastFixedCommitTick === 2,
        'published terminal host publication was not complete before close');

        director.closeForTerminal(2, 'run-defeated');
        const directorTerminal = director.getStatus().terminal;
        assert(directorTerminal?.fixedCommitObserved === true
            && directorTerminal?.lifecycleObserved === true
            && directorTerminal?.rosterSealed === true,
        'published terminal prior observations were not preserved at close');
        endpoint.closeGameplayIngress('run-defeated', 2);
        assert(endpoint.fixedUpdate(FIXED_DELTA, 2),
            'published terminal final submit failed');
        const runtime = await waitForActualRuntime(endpoint, 'published terminal');
        const bodies = await readBodies(endpoint.getBackend());
        const publishedHandles = lifecycle.atomicTransforms[0]
            .destinationHandles;
        assert(publishedHandles.every((handle) => findBody(bodies, handle))
            && bodies.filter((body) => publishedHandles.some(
                (handle) => exactHandle(body.handle, handle)
            )).length === 2,
        'published terminal registry/body parity mismatch');
        const terminal = endpoint.getTerminalAtomicTransformProgramCancelStatus();
        assert(runtime.atomic.runtimeStatus
                === GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.OK
            && runtime.atomic.lastCommittedTransformCount === 1
            && runtime.atomic.pendingReadbackCount === 0
            && terminal.owner?.abiVersion
                === GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION
            && terminal.owner?.state === 'armed'
            && terminal.owner?.pendingPrepareCount === 0
            && terminal.owner?.pendingTransformCount === 0
            && terminal.owner?.pendingReadbackCount === 0
            && terminal.backend?.state === 'submitted'
            && terminal.backend?.submittedTick === 2
            && terminal.backend?.pendingPrepareCount === 0
            && terminal.backend?.pendingTransformCount === 0
            && terminal.backend?.pendingReadbackCount === 0
            && !endpoint.requiresRecovery()
            && !director.requiresRecovery(),
        'published terminal GPU completion/readback settle mismatch');
        published = Object.freeze({
            hostPublishedBeforeClose: true,
            lifecycleTransformCount: lifecycle.atomicTransforms.length,
            registryCirclePrimeCount: countDefinition(endpoint, circlePrime.id),
            backendCommitRequestedBeforeClose:
                beforeCloseAtomic.pendingTransformCount === 1,
            gpuCommittedOnFinalSubmit:
                runtime.atomic.lastCommittedTransformCount === 1,
            readbackSettled: runtime.atomic.pendingReadbackCount === 0,
            bodyParityCount: 2,
            ownerState: terminal.owner.state,
            ownerPendingPrepareCount: terminal.owner.pendingPrepareCount,
            ownerPendingTransformCount: terminal.owner.pendingTransformCount,
            ownerPendingReadbackCount: terminal.owner.pendingReadbackCount,
            backendState: terminal.backend.state,
            backendSubmittedTick: terminal.backend.submittedTick,
            backendPendingPrepareCount: terminal.backend.pendingPrepareCount,
            backendPendingTransformCount: terminal.backend.pendingTransformCount,
            backendPendingReadbackCount: terminal.backend.pendingReadbackCount,
            fixedCommitObserved: directorTerminal.fixedCommitObserved,
            lifecycleObserved: directorTerminal.lifecycleObserved,
            rosterSealed: directorTerminal.rosterSealed,
            lastFixedCommitTick: director.getStatus().lastFixedCommitTick,
            requiresRecovery: endpoint.requiresRecovery()
                || director.requiresRecovery()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }

    const stalePrepare = oldPort.requestPrepareBatch({
        targetFixedTick: 4,
        records: []
    });
    const staleDiscard = oldPort.discardPreparedBatch({
        batchIdFingerprint: 1
    });
    const stableClosed = (result) => (
        result?.accepted === false
        && result?.reason === 'atomic-transform-ingress-closed'
        && result?.requiresRecovery === false
    );
    assert(stableClosed(stalePrepare) && stableClosed(staleDiscard),
        'destroyed AtomicTransform command port did not reject stably');

    const unpublished = await runActualUnpublishedTerminal(device, format);
    const replacementEndpoint = createActualEndpoint(device, format, 4);
    let replacementDirector = null;
    try {
        initializeActualEndpoint(
            replacementEndpoint,
            tileMap,
            'replacement endpoint'
        );
        replacementDirector = createActualJorangDirector(replacementEndpoint);
        requireAccepted(replacementEndpoint.requestSpawn(
            createNaturalJorangIntent(route, 1, { x: 4, y: 4 }),
            1,
            'actual-replacement:j:spawn'
        ), 'replacement J spawn');
        const tick1 = await advanceActualTick({
            endpoint: replacementEndpoint,
            director: replacementDirector,
            tick: 1,
            label: 'actual replacement T1'
        });
        const replacementHandle = findSpawnHandle(
            tick1.lifecycle,
            'actual-replacement:j:spawn',
            'actual replacement'
        );
        const replacementBody = findRequiredBody(
            tick1.bodies,
            replacementHandle,
            'actual replacement body'
        );
        const drained = drainActualBoundary(
            replacementEndpoint,
            replacementDirector,
            2
        );
        const replacementStatus = replacementEndpoint.getStatus();
        const replacementAtomic = replacementEndpoint.getBackend()
            .getAtomicTransformRuntimeStatus();
        const replacementEffects = await readActiveEffectInstances(
            replacementEndpoint,
            device
        );
        assert(drained.preparationObservation.transformCount === 0
            && replacementStatus.sessionGeneration !== oldSessionGeneration
            && replacementBody.atomicTransformState?.phase
                === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.ARMED
            && countDefinition(
                replacementEndpoint,
                BASIC_JORANG_ENEMY_DATA.id
            ) === 1
            && replacementEffects.length === 0
            && replacementStatus.atomicTransformCommands.pendingPrepareCount === 0
            && replacementStatus.atomicTransformCommands.pendingTransformCount === 0
            && replacementAtomic.pendingPrepareCount === 0
            && replacementAtomic.pendingTransformCount === 0
            && replacementAtomic.pendingReadbackCount === 0
            && !replacementEndpoint.requiresRecovery()
            && !replacementDirector.requiresRecovery(),
        'replacement world inherited stale AtomicTransform state');
        return Object.freeze({
            unpublished,
            published,
            replacement: Object.freeze({
                sessionGenerationChanged:
                    replacementStatus.sessionGeneration !== oldSessionGeneration,
                stalePrepareRejected: stableClosed(stalePrepare),
                staleDiscardRejected: stableClosed(staleDiscard),
                staleDiscardReason: staleDiscard.reason,
                staleDiscardRequiresRecovery: staleDiscard.requiresRecovery,
                freshJCount: countDefinition(
                    replacementEndpoint,
                    BASIC_JORANG_ENEMY_DATA.id
                ),
                armedPhase:
                    replacementBody.atomicTransformState.phase
                        === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.ARMED,
                activeEffectInstanceCount: replacementEffects.length,
                pendingPrepareCount:
                    replacementStatus.atomicTransformCommands
                        .pendingPrepareCount,
                pendingTransformCount:
                    replacementStatus.atomicTransformCommands
                        .pendingTransformCount,
                pendingReadbackCount: replacementAtomic.pendingReadbackCount,
                requiresRecovery: replacementEndpoint.requiresRecovery()
                    || replacementDirector.requiresRecovery()
            })
        });
    } finally {
        replacementDirector?.destroy();
        replacementEndpoint.destroy();
    }
}

async function runFixture(device, format) {
    const admitted = await runFirstHitBatch(device, format, 'admit');
    const pending = await runFirstHitBatch(device, format, 'pending');
    const nonClosest = await runFirstHitBatch(device, format, 'non-closest');
    const lineageRoundTrip = await runActualLineageRoundTrip(device, format);
    const fiveToFourPlusOne = await runActualFiveToFourPlusOne(device, format);
    const capacityRestage = await runActualCapacityRestage(device, format);
    const firstHitEventCapacity = await runActualFirstHitEventCapacityBackoff(
        device,
        format
    );
    const terminalReplacement = await runActualPublishedTerminalAndReplacement(
        device,
        format
    );
    const circlePrime = resolveBasicCirclePrimeTransformPrivateDefinition();
    assert(BASIC_JORANG_ENEMY_DATA.bountyBudget
            === JORANG_NATURAL_BOUNTY_BUDGET
        && JORANG_NATURAL_BOUNTY_BUDGET === 12
        && circlePrime.spawnPolicy === 'transform-private'
        && JORANG_RETURN_DELAY_FIXED_TICKS === 60,
    'J/C prime adopted data drift');
    return Object.freeze({
        scenario: 'jorang-first-hit-split-delayed-lineage',
        firstHit: Object.freeze({
            damageFixedPoint: 0,
            sourceBudgetConsumed: admitted.consumedSourceBudgetCount > 0,
            triggerEventCount: admitted.triggerEventCount > 0 ? 1 : 0,
            pendingRepeatDamageFixedPoint: 0,
            pendingRepeatSourceBudgetConsumed:
                pending.consumedSourceBudgetCount > 0,
            pendingRepeatEventCount: pending.triggerEventCount,
            sameTickEnterOnlyJCount: admitted.count,
            sameTickAdmittedCount: admitted.triggerEventCount,
            sameTickOrientedEventCount: admitted.orientedTriggerEventCount,
            sameTickPendingCount: admitted.pendingCount,
            sameTickConsumedSourceBudgetCount:
                admitted.consumedSourceBudgetCount
        }),
        triggerScope: Object.freeze({
            contract: 'first-valid-positive-damage-hit',
            commonProducerKinds: Object.freeze([
                'projectile',
                'explosion',
                'effect',
                'direct',
                'melee'
            ]),
            actualTriggerProducer: 'projectile',
            projectileHitPolicyValidatedBeforeCommonSeam: true,
            futureProducerExecutionClaimed: false,
            nonClosestTriggerEventCount: nonClosest.triggerEventCount,
            nonClosestPendingCount: nonClosest.pendingCount,
            nonClosestUnchangedJHealthCount:
                nonClosest.unchangedJHealthCount,
            nonClosestConsumedSourceBudgetCount:
                nonClosest.consumedSourceBudgetCount
        }),
        actualRuntime: Object.freeze({
            lineageRoundTrip,
            fiveToFourPlusOne,
            capacityRestage,
            firstHitEventCapacity,
            terminalReplacement
        }),
        storageProfile: Object.freeze({
            atomicTransformFirstHit:
                admitted.storageProfile.atomicTransformFirstHit,
            requiredMaximum: admitted.storageProfile.requiredMaximum
        }),
        presentation: Object.freeze({
            definitionShape: BASIC_JORANG_ENEMY_DATA.shapeDefinitionId,
            gpuShapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.JORANG,
            dedicatedJorangShape:
                BASIC_JORANG_ENEMY_DATA.shapeDefinitionId === 'jorang'
                && GPU_CIRCLE_BODY_RENDER_SHAPE.JORANG
                    !== GPU_CIRCLE_BODY_RENDER_SHAPE.GEN
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
        device = await adapter.requestDevice({
            requiredLimits: {
                maxStorageBuffersPerShaderStage: REQUIRED_STORAGE_BUFFER_LIMIT
            }
        });
        const uncapturedErrors = [];
        device.addEventListener('uncapturederror', (event) => {
            uncapturedErrors.push(event.error?.message ?? String(event.error));
        });
        result.productionEnemyJorangSplitLineage = await runFixture(
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
        assert(lost.reason === 'destroyed', `device lost reason: ${lost.reason}`);
        result.status = 'pass';
    } catch (error) {
        result.error = error?.stack ?? String(error);
        try {
            device?.destroy();
        } catch {
            // failed fixture cleanup is best effort
        }
    }
    require('node:fs').writeFileSync(
        resultPath,
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8'
    );
    nw.App.quit();
}

run();
