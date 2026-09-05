import {
    BASIC_PENTA_ENEMY_DATA
} from './production/script/data/object/enemy/basic_circle_enemy_data.js';
import {
    BASIC_HEXA_ENEMY_DATA
} from './production/script/data/object/enemy/basic_hexa_enemy_data.js';
import {
    BASIC_JORANG_ENEMY_DATA
} from './production/script/data/object/enemy/basic_jorang_enemy_data.js';
import {
    BASIC_OCTA_ENEMY_DATA
} from './production/script/data/object/enemy/basic_octa_enemy_data.js';
import {
    BASIC_RING_ENEMY_DATA
} from './production/script/data/object/enemy/basic_ring_enemy_data.js';
import {
    RING_PROJECTILE_CAPTURE_DELAY_FIXED_TICKS
} from './production/script/data/object/enemy/enemy_projectile_capture_catalog_data.js';
import {
    BASIC_BULLET_PROJECTILE_DATA
} from './production/script/data/object/projectile/basic_bullet_data.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} from './production/script/module/ingame/contract/gameplay_team_contract.js';
import {
    PROJECTILE_CAPTURE_POLICY_ID,
    PROJECTILE_ORIGIN_PROVENANCE_KEYS
} from './production/script/module/ingame/contract/projectile_capture_contract.js';
import {
    TileMap
} from './production/script/module/ingame/map/tile_map.js';
import {
    EnemySimulationBackend
} from './production/script/module/ingame/object/enemy/enemy_simulation_backend.js';
import {
    EnemyCoreImpactDirector
} from './production/script/module/ingame/object/enemy/enemy_core_impact_director.js';
import {
    GpuEnemySimulationEndpoint
} from './production/script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js';
import {
    createGpuEnemySpawnIntent
} from './production/script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js';
import {
    RingProjectileCaptureDirector
} from './production/script/module/ingame/object/enemy/projectile_capture_director.js';
import {
    createGpuProjectileSpawnIntent
} from './production/script/module/ingame/object/projectile/gpu_projectile_spawn_adapter.js';
import {
    createGpuCoreProxySpawnIntent
} from './production/script/module/ingame/object/core/gpu_core_proxy_spawn_adapter.js';
import {
    createGpuTowerSpawnIntent
} from './production/script/module/ingame/object/tower/gpu_tower_spawn_adapter.js';
import {
    CoreIntegrity
} from './production/script/module/ingame/state/core_integrity.js';
import {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_SIMULATION_FLAG,
    GPU_PROJECTILE_CAPTURE_PHASE,
    GPU_PROJECTILE_CAPTURE_POLICY_CODE,
    GPU_PROJECTILE_CAPTURE_ROLE,
    unpackGpuProjectileCaptureStateMeta
} from './production/script/module/ingame/physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_PROJECTILE_CAPTURE_RELEASE_REASON,
    GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR
} from './production/script/module/ingame/physics/gpu/gpu_projectile_capture_runtime_abi.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const REQUIRED_STORAGE_BUFFER_LIMIT = 9;
const FIXED_DELTA = 1 / 60;
const INVALID_U32 = 0xffffffff;
const DIRECTOR_BINDING = new WeakMap();
const CAPTURE_STATE_FIELDS = Object.freeze([
    'role',
    'phase',
    'profileCode',
    'policyCode',
    'flags',
    'selfEntityId',
    'selfIncarnation',
    'peerBodySlot',
    'peerEntityId',
    'peerIncarnation',
    'capturedAtFixedTick',
    'releaseDueFixedTick',
    'captureSequence',
    'capturedSpeed',
    'facingX',
    'facingY'
]);
const CAPTURE_OWNERSHIP_STATE_FIELDS = Object.freeze(
    CAPTURE_STATE_FIELDS.filter((field) => (
        field !== 'facingX' && field !== 'facingY'
    ))
);
const OPEN_MAP_DATA = Object.freeze({
    id: 'nw-ring-projectile-capture-open-map',
    macroRows: 1,
    macroColumns: 3,
    pathWidthTiles: 16,
    directionBlueprint: Object.freeze(['abc']),
    coreMacroCell: Object.freeze([0, 2]),
    towerSpawnMacroCell: Object.freeze([0, 1]),
    enemySpawnRoutes: Object.freeze([Object.freeze({
        gateId: 'nw-ring-open-gate',
        pathId: 'nw-ring-open-path',
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

function copyHandle(handle) {
    return Object.freeze({
        entityId: handle.entityId,
        incarnation: handle.incarnation
    });
}

function copyVector(vector) {
    return Object.freeze({ x: vector.x, y: vector.y });
}

function copyJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function createPlatformPort(device, format, frameTarget = null) {
    return Object.freeze({
        getState: () => Object.freeze({ ready: true, status: 'ready' }),
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => 1,
        acquireFrameTarget: () => frameTarget,
        clearCanvas: () => true,
        markCanvasDrawn() {},
        markCanvasCleared() {}
    });
}

function createEndpoint(
    device,
    format,
    capacity,
    frameTarget = null,
    corePortReceiver = null,
    endpointOptions = null
) {
    const dependencies = {
        webGpuPlatformPort: createPlatformPort(device, format, frameTarget),
        enemySimulationBackendFactory: (dependencies, options) => (
            new EnemySimulationBackend(dependencies, options)
        )
    };
    if (corePortReceiver) {
        dependencies.coreImpactCleanupPortReceiver = corePortReceiver;
    }
    return new GpuEnemySimulationEndpoint(dependencies, {
        capacity,
        ...(endpointOptions ?? null)
    });
}

function initializeEndpoint(endpoint, tileMap, label) {
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
}

function createDirector(endpoint) {
    const runtime = endpoint.getProjectileCaptureRuntimeStatus();
    const commandPort = endpoint.getProjectileCaptureCommandPort();
    const commandPortMethods = Object.keys(commandPort).sort();
    assert(Object.isFrozen(commandPort)
        && JSON.stringify(commandPortMethods) === JSON.stringify([
            'discardPreparedBatch',
            'requestPreparedReleaseBatch',
            'requestTerminalHeldProjectileDespawn'
        ]), 'projectile capture high-level command port drift');
    const director = new RingProjectileCaptureDirector({
        registry: endpoint.getRegistry(),
        projectileCaptureCommandPort: commandPort,
        sessionGeneration: runtime.sessionGeneration,
        deviceGeneration: runtime.deviceGeneration,
        authoritativeEpoch: runtime.authoritativeEpoch,
        capacity: endpoint.getCapacity()
    });
    DIRECTOR_BINDING.set(director, Object.freeze({
        commandPort,
        runtime: Object.freeze({
            sessionGeneration: runtime.sessionGeneration,
            deviceGeneration: runtime.deviceGeneration,
            authoritativeEpoch: runtime.authoritativeEpoch
        }),
        capacity: endpoint.getCapacity(),
        commandPortMethods: Object.freeze(commandPortMethods)
    }));
    return director;
}

function refreshIdleDirectorBinding(endpoint, director, label) {
    const runtime = endpoint.getProjectileCaptureRuntimeStatus();
    const status = director.getStatus();
    if (runtime.sessionGeneration === status.sessionGeneration
        && runtime.deviceGeneration === status.deviceGeneration
        && runtime.authoritativeEpoch === status.authoritativeEpoch) {
        return;
    }
    assert(status.capturedProjectileCount === 0
        && status.releasePendingCount === 0
        && status.pendingBatchCount === 0
        && status.terminalCleanupPendingCount === 0
        && status.pendingReadbackCount === 0
        && status.recoveryRequired === false
        && status.terminal === null,
    `${label}: active capture tuple drift ${JSON.stringify({ runtime, status })}`);
    const commandPort = endpoint.getProjectileCaptureCommandPort();
    assert(director.resetGpuBinding(
        endpoint.getRegistry(),
        commandPort,
        runtime.sessionGeneration,
        runtime.deviceGeneration,
        runtime.authoritativeEpoch
    ), `${label}: idle capture rebind failed`);
    DIRECTOR_BINDING.set(director, Object.freeze({
        commandPort,
        runtime: Object.freeze({
            sessionGeneration: runtime.sessionGeneration,
            deviceGeneration: runtime.deviceGeneration,
            authoritativeEpoch: runtime.authoritativeEpoch
        }),
        capacity: endpoint.getCapacity(),
        commandPortMethods: Object.freeze(Object.keys(commandPort).sort())
    }));
}

function createRingIntent(route, spawnSequence, position) {
    return Object.freeze({
        ...createGpuEnemySpawnIntent({
            definition: BASIC_RING_ENEMY_DATA,
            route,
            spawnSequence,
            waveId: 'nw-ring-projectile-capture',
            policyId: 'hardware-fixture'
        }),
        position: Object.freeze({ ...position })
    });
}

function createOtherEnemyIntent(definition, route, spawnSequence, position) {
    return Object.freeze({
        ...createGpuEnemySpawnIntent({
            definition,
            route,
            spawnSequence,
            waveId: 'nw-ring-coexistence',
            policyId: 'hardware-fixture'
        }),
        position: Object.freeze({ ...position })
    });
}

function createBulletIntent(position, velocity, options = {}) {
    const definition = Object.freeze({
        ...BASIC_BULLET_PROJECTILE_DATA,
        id: options.definitionId ?? BASIC_BULLET_PROJECTILE_DATA.id,
        projectileCapturePolicyId: options.capturePolicyId
            ?? PROJECTILE_CAPTURE_POLICY_ID.CAPTURABLE,
        lifetimeSeconds: options.lifetimeSeconds
            ?? BASIC_BULLET_PROJECTILE_DATA.lifetimeSeconds,
        damage: options.damage ?? BASIC_BULLET_PROJECTILE_DATA.damage
    });
    return createGpuProjectileSpawnIntent({
        definition,
        position,
        velocity,
        spawnSequence: options.spawnSequence ?? 0,
        ownerHandle: options.ownerHandle ?? null,
        sourceHandle: options.sourceHandle ?? options.ownerHandle ?? null,
        targetHandle: options.targetHandle ?? null,
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        producerId: options.producerId ?? 'nw-ring-origin-producer',
        sourceAbilityId: options.sourceAbilityId ?? 'nw-ring-origin-ability'
    });
}

function createLethalEnemyHitIntent(body, options = {}) {
    return createBulletIntent(
        {
            x: body.position.x + 0.65,
            y: body.position.y
        },
        {
            x: body.velocity.x - 18,
            y: body.velocity.y
        },
        {
            definitionId: options.definitionId,
            capturePolicyId: PROJECTILE_CAPTURE_POLICY_ID.NOT_CAPTURABLE,
            damage: 100,
            spawnSequence: options.spawnSequence
        }
    );
}

function requireSpawnHandle(commit, commandId) {
    const handle = commit?.spawned?.find(
        (entry) => entry.commandId === commandId
    )?.handle;
    assert(handle, `spawn handle missing: ${commandId}`);
    return handle;
}

function copyRegistryView(endpoint, handle, label) {
    const view = endpoint.getRegistry().copyEntityView(handle, {});
    assert(view, `${label}: registry view missing`);
    return Object.freeze({
        handle: copyHandle(handle),
        kindId: view.kindId,
        definitionId: view.definitionId,
        metadataRevision: view.metadataRevision,
        metadata: Object.freeze(copyJson(view.metadata))
    });
}

async function waitForSimulation(endpoint, label, timeoutMs = 5_000) {
    const backend = endpoint.getBackend();
    const simulation = backend.simulation;
    assert(simulation, `${label}: production simulation missing`);
    await simulation.device.queue.onSubmittedWorkDone();
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        const status = endpoint.getProjectileCaptureRuntimeStatus();
        const pending = Number(status?.pendingReadbackCount ?? 0)
            + Number(status?.pendingCaptureReadbackCount ?? 0)
            + Number(status?.pendingReleaseReadbackCount ?? 0);
        if (pending === 0) return status;
        await new Promise((resolve) => setTimeout(resolve, 4));
    }
    throw new Error(`${label}: capture readback timeout ${JSON.stringify(
        endpoint.getProjectileCaptureRuntimeStatus()
    )}`);
}

async function readBodies(endpoint) {
    const backend = endpoint.getBackend();
    const promise = backend.simulation.readbackBodies();
    await backend.simulation.device.queue.onSubmittedWorkDone();
    return promise;
}

async function readGpuCapturePlanesAtSlot(endpoint, bodySlot, label) {
    const simulation = endpoint.getBackend().simulation;
    const physicsLayout = GPU_CIRCLE_BODY_ABI.PHYSICS;
    const simulationLayout = GPU_CIRCLE_BODY_ABI.SIMULATION;
    const stateLayout = GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE;
    const candidateLayout = GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_CANDIDATE;
    const stateOffset = 0;
    const candidateOffset = stateLayout.STRIDE;
    const physicsOffset = candidateOffset + candidateLayout.STRIDE;
    const simulationOffset = physicsOffset + physicsLayout.STRIDE;
    const readback = simulation.device.createBuffer({
        label: `cirvivor-nw-ring-capture-plane-${label}`,
        size: stateLayout.STRIDE
            + candidateLayout.STRIDE
            + physicsLayout.STRIDE
            + simulationLayout.STRIDE,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = simulation.device.createCommandEncoder({
            label: `cirvivor-nw-ring-capture-plane-copy-${label}`
        });
        encoder.copyBufferToBuffer(
            simulation.buffers.projectileCaptureStates,
            bodySlot * stateLayout.STRIDE,
            readback,
            stateOffset,
            stateLayout.STRIDE
        );
        encoder.copyBufferToBuffer(
            simulation.buffers.projectileCaptureCandidates,
            bodySlot * candidateLayout.STRIDE,
            readback,
            candidateOffset,
            candidateLayout.STRIDE
        );
        encoder.copyBufferToBuffer(
            simulation.buffers.physics,
            bodySlot * physicsLayout.STRIDE,
            readback,
            physicsOffset,
            physicsLayout.STRIDE
        );
        encoder.copyBufferToBuffer(
            simulation.buffers.simulation,
            bodySlot * simulationLayout.STRIDE,
            readback,
            simulationOffset,
            simulationLayout.STRIDE
        );
        simulation.device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const view = new DataView(readback.getMappedRange());
        const meta = unpackGpuProjectileCaptureStateMeta(view.getUint32(
            stateOffset + stateLayout.ROLE_PHASE_PROFILE_POLICY,
            true
        ));
        return Object.freeze({
            bodySlot,
            state: Object.freeze({
                ...meta,
                selfEntityId: view.getUint32(
                    stateOffset + stateLayout.SELF_ENTITY_ID,
                    true
                ),
                selfIncarnation: view.getUint32(
                    stateOffset + stateLayout.SELF_INCARNATION,
                    true
                ),
                peerBodySlot: view.getUint32(
                    stateOffset + stateLayout.PEER_BODY_SLOT,
                    true
                ),
                peerEntityId: view.getUint32(
                    stateOffset + stateLayout.PEER_ENTITY_ID,
                    true
                ),
                peerIncarnation: view.getUint32(
                    stateOffset + stateLayout.PEER_INCARNATION,
                    true
                ),
                capturedAtFixedTick: view.getUint32(
                    stateOffset + stateLayout.CAPTURED_AT_FIXED_TICK,
                    true
                ),
                releaseDueFixedTick: view.getUint32(
                    stateOffset + stateLayout.RELEASE_DUE_FIXED_TICK,
                    true
                ),
                captureSequence: view.getUint32(
                    stateOffset + stateLayout.CAPTURE_SEQUENCE,
                    true
                ),
                capturedSpeed: view.getFloat32(
                    stateOffset + stateLayout.CAPTURED_SPEED,
                    true
                ),
                facingX: view.getFloat32(
                    stateOffset + stateLayout.FACING_X,
                    true
                ),
                facingY: view.getFloat32(
                    stateOffset + stateLayout.FACING_Y,
                    true
                )
            }),
            candidate: Object.freeze({
                distanceSquaredBits: view.getUint32(
                    candidateOffset + candidateLayout.DISTANCE_SQUARED_BITS,
                    true
                ),
                peerEntityId: view.getUint32(
                    candidateOffset + candidateLayout.PEER_ENTITY_ID,
                    true
                ),
                peerIncarnation: view.getUint32(
                    candidateOffset + candidateLayout.PEER_INCARNATION,
                    true
                ),
                status: view.getUint32(
                    candidateOffset + candidateLayout.STATUS,
                    true
                )
            }),
            physics: Object.freeze({
                position: Object.freeze({
                    x: view.getFloat32(
                        physicsOffset + physicsLayout.POSITION_X,
                        true
                    ),
                    y: view.getFloat32(
                        physicsOffset + physicsLayout.POSITION_Y,
                        true
                    )
                }),
                velocity: Object.freeze({
                    x: view.getFloat32(
                        physicsOffset + physicsLayout.VELOCITY_X,
                        true
                    ),
                    y: view.getFloat32(
                        physicsOffset + physicsLayout.VELOCITY_Y,
                        true
                    )
                })
            }),
            simulation: Object.freeze({
                lifetime: view.getFloat32(
                    simulationOffset + simulationLayout.LIFETIME,
                    true
                ),
                healthFixedPoint: view.getInt32(
                    simulationOffset + simulationLayout.HEALTH,
                    true
                ),
                flags: view.getUint32(
                    simulationOffset + simulationLayout.FLAGS,
                    true
                )
            })
        });
    } finally {
        try { readback.unmap(); } catch { /* already unmapped */ }
        readback.destroy();
    }
}

async function readGpuCapturePlanes(endpoint, handle, label) {
    const audit = copyCaptureBodyAudit(endpoint, handle, label);
    return Object.freeze({
        audit,
        gpu: await readGpuCapturePlanesAtSlot(
            endpoint,
            audit.bodySlot,
            label
        )
    });
}

function writeGpuBodyKinematicsAtSlot(
    endpoint,
    bodySlot,
    { position, velocity },
    label
) {
    assert(Number.isInteger(bodySlot) && bodySlot >= 0,
        `${label}: invalid body slot`);
    assert([position.x, position.y, velocity.x, velocity.y].every(
        Number.isFinite
    ), `${label}: non-finite kinematics`);
    const simulation = endpoint.getBackend().simulation;
    const physics = GPU_CIRCLE_BODY_ABI.PHYSICS;
    const positionBytes = new ArrayBuffer(8);
    const positionView = new DataView(positionBytes);
    positionView.setFloat32(0, position.x, true);
    positionView.setFloat32(4, position.y, true);
    const velocityBytes = new ArrayBuffer(8);
    const velocityView = new DataView(velocityBytes);
    velocityView.setFloat32(0, velocity.x, true);
    velocityView.setFloat32(4, velocity.y, true);
    simulation.device.queue.writeBuffer(
        simulation.buffers.physics,
        (bodySlot * physics.STRIDE) + physics.POSITION_X,
        positionBytes
    );
    simulation.device.queue.writeBuffer(
        simulation.buffers.physics,
        (bodySlot * physics.STRIDE) + physics.VELOCITY_X,
        velocityBytes
    );
}

async function placeCapturePairForRetry(
    endpoint,
    captorHandle,
    projectileHandle,
    label,
    { currentValid }
) {
    const captor = await readGpuCapturePlanes(
        endpoint,
        captorHandle,
        `${label}-captor`
    );
    const projectileAudit = copyCaptureBodyAudit(
        endpoint,
        projectileHandle,
        `${label}-projectile`
    );
    const velocity = captor.gpu.physics.velocity;
    const velocityLength = Math.hypot(velocity.x, velocity.y);
    const storedFacing = {
        x: captor.gpu.state.facingX,
        y: captor.gpu.state.facingY
    };
    const storedFacingLength = Math.hypot(storedFacing.x, storedFacing.y);
    const forward = velocityLength > 0.000001
        ? { x: velocity.x / velocityLength, y: velocity.y / velocityLength }
        : storedFacingLength > 0.000001
            ? {
                x: storedFacing.x / storedFacingLength,
                y: storedFacing.y / storedFacingLength
            }
            : { x: 1, y: 0 };
    const radialDistance = currentValid ? 0.3 : 3;
    const relativeRadialSpeed = currentValid ? -0.25 : 1;
    const position = {
        x: captor.gpu.physics.position.x + (forward.x * radialDistance),
        y: captor.gpu.physics.position.y + (forward.y * radialDistance)
    };
    const projectileVelocity = {
        x: velocity.x + (forward.x * relativeRadialSpeed),
        y: velocity.y + (forward.y * relativeRadialSpeed)
    };
    writeGpuBodyKinematicsAtSlot(
        endpoint,
        projectileAudit.bodySlot,
        { position, velocity: projectileVelocity },
        label
    );
    return Object.freeze({
        currentValid,
        captorBodySlot: captor.audit.bodySlot,
        projectileBodySlot: projectileAudit.bodySlot,
        position: Object.freeze(position),
        velocity: Object.freeze(projectileVelocity),
        forward: Object.freeze(forward)
    });
}

function findBody(bodies, handle, label) {
    const body = bodies.find((candidate) => (
        candidate.entityId === handle.entityId
        && candidate.incarnation === handle.incarnation
    ));
    assert(body, `${label}: body missing ${JSON.stringify(handle)}`);
    return body;
}

function copyBody(body) {
    return Object.freeze({
        handle: Object.freeze({
            entityId: body.entityId,
            incarnation: body.incarnation
        }),
        index: body.index,
        position: copyVector(body.position),
        velocity: copyVector(body.velocity),
        radius: body.radius,
        lifetime: body.lifetime,
        healthFixedPoint: body.healthFixedPoint,
        simulationMeta: body.simulationMeta,
        interactionMeta: body.interactionMeta,
        gridIndex: body.gridIndex
    });
}

function snapshotCaptureRecord(record) {
    const evidence = record.prepareEvidence ?? null;
    const rawTargetHandle = record.targetHandle ?? evidence?.targetHandle;
    return Object.freeze({
        captorHandle: copyHandle(record.captorHandle),
        projectileHandle: copyHandle(record.projectileHandle),
        sourceTick: record.sourceTick,
        capturedAtFixedTick: record.capturedAtFixedTick
            ?? evidence?.capturedAtFixedTick
            ?? record.sourceTick,
        releaseDueFixedTick: record.releaseDueFixedTick
            ?? evidence?.releaseDueFixedTick
            ?? null,
        captureSequence: record.captureSequence,
        capturedSpeed: record.capturedSpeed ?? evidence?.capturedSpeed ?? null,
        targetSelector: record.targetSelector
            ?? evidence?.targetSelector
            ?? null,
        targetHandle: rawTargetHandle
            && rawTargetHandle.entityId !== INVALID_U32
            ? copyHandle(rawTargetHandle)
            : null,
        releaseReason: record.releaseReason ?? record.reason ?? 0,
        prepareSourceTick: record.prepareSourceTick ?? null,
        batchIdFingerprint: record.batchIdFingerprint ?? null,
        prepareFingerprint: record.prepareFingerprint
            ?? evidence?.prepareFingerprint
            ?? null,
        commandIdFingerprint: record.commandIdFingerprint ?? null,
        publicationFixedTick: record.publicationFixedTick ?? null,
        anchor: (record.anchor ?? evidence?.anchor)
            ? copyVector(record.anchor ?? evidence.anchor)
            : null,
        facing: (record.facing ?? evidence?.facing)
            ? copyVector(record.facing ?? evidence.facing)
            : null
    });
}

function copyCaptureBodyAudit(endpoint, handle, label) {
    const audit = endpoint.getBackend().getProjectileCaptureBodyState(handle);
    assert(audit && exactHandle(audit.handle, handle),
        `${label}: capture body audit missing`);
    return Object.freeze({
        handle: copyHandle(audit.handle),
        bodySlot: audit.bodySlot,
        capturedMirror: audit.capturedMirror,
        releaseCommitRequested: audit.releaseCommitRequested,
        state: Object.freeze({ ...audit.state })
    });
}

function copyCaptureState(state, label) {
    const copy = {};
    for (const field of CAPTURE_STATE_FIELDS) {
        assert(Object.hasOwn(state, field), `${label}: missing ${field}`);
        copy[field] = state[field];
    }
    return Object.freeze(copy);
}

function captureOwnershipStateIsExact(left, right) {
    return CAPTURE_OWNERSHIP_STATE_FIELDS.every((field) => (
        Object.is(left[field], right[field])
    ));
}

function registryViewIsExact(left, right) {
    return exactHandle(left.handle, right.handle)
        && left.kindId === right.kindId
        && left.definitionId === right.definitionId
        && left.metadataRevision === right.metadataRevision
        && JSON.stringify(left.metadata) === JSON.stringify(right.metadata);
}

async function snapshotIdleCaptureMember(
    endpoint,
    handle,
    expectedRole,
    label
) {
    const plane = await readGpuCapturePlanes(endpoint, handle, label);
    const gpuState = copyCaptureState(plane.gpu.state, `${label} GPU state`);
    const hostState = copyCaptureState(
        plane.audit.state,
        `${label} host state`
    );
    const gpuCapturedMirror = (
        plane.gpu.simulation.flags
            & GPU_CIRCLE_BODY_SIMULATION_FLAG.PROJECTILE_CAPTURED
    ) !== 0;
    const gpuFacingLength = Math.hypot(gpuState.facingX, gpuState.facingY);
    const hostFacingLength = Math.hypot(hostState.facingX, hostState.facingY);
    const velocityLength = Math.hypot(
        plane.gpu.physics.velocity.x,
        plane.gpu.physics.velocity.y
    );
    const gpuFacingMatchesCurrentVelocity = expectedRole
            !== GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR
        || velocityLength <= 0.000001
        || (
            gpuFacingLength > 0.000001
            && ((gpuState.facingX * plane.gpu.physics.velocity.x)
                + (gpuState.facingY * plane.gpu.physics.velocity.y))
                / (gpuFacingLength * velocityLength) >= 0.9999
        );
    assert(captureOwnershipStateIsExact(gpuState, hostState),
        `${label}: host/GPU capture ownership mismatch ${JSON.stringify({
            hostState,
            gpuState
        })}`);
    assert([
        gpuState.facingX,
        gpuState.facingY,
        hostState.facingX,
        hostState.facingY,
        gpuFacingLength,
        hostFacingLength,
        velocityLength
    ].every(Number.isFinite)
        && gpuFacingMatchesCurrentVelocity,
    `${label}: current GPU facing authority contradiction ${JSON.stringify({
        gpuFacing: { x: gpuState.facingX, y: gpuState.facingY },
        hostFacing: { x: hostState.facingX, y: hostState.facingY },
        velocity: plane.gpu.physics.velocity,
        gpuFacingMatchesCurrentVelocity
    })}`);
    assert(plane.audit.capturedMirror === gpuCapturedMirror,
        `${label}: host/GPU captured mirror mismatch`);
    assert(gpuState.role === expectedRole
        && gpuState.phase === GPU_PROJECTILE_CAPTURE_PHASE.IDLE
        && gpuState.selfEntityId === handle.entityId
        && gpuState.selfIncarnation === handle.incarnation
        && gpuState.peerBodySlot === INVALID_U32
        && gpuState.peerEntityId === INVALID_U32
        && gpuState.peerIncarnation === INVALID_U32
        && gpuState.capturedAtFixedTick === 0
        && gpuState.releaseDueFixedTick === 0
        && gpuState.captureSequence === 0
        && gpuState.capturedSpeed === 0
        && plane.audit.capturedMirror === false
        && gpuCapturedMirror === false,
    `${label}: idle bilateral state contradiction ${JSON.stringify({
        gpuState,
        hostCapturedMirror: plane.audit.capturedMirror,
        gpuCapturedMirror
    })}`);
    return Object.freeze({
        handle: copyHandle(handle),
        bodySlot: plane.audit.bodySlot,
        expectedRole,
        gpuState,
        hostState,
        capturedMirror: Object.freeze({
            host: plane.audit.capturedMirror,
            gpu: gpuCapturedMirror
        }),
        facingAuthority: Object.freeze({
            host: Object.freeze({
                x: hostState.facingX,
                y: hostState.facingY,
                length: hostFacingLength
            }),
            gpu: Object.freeze({
                x: gpuState.facingX,
                y: gpuState.facingY,
                length: gpuFacingLength
            }),
            currentVelocity: Object.freeze({
                ...plane.gpu.physics.velocity,
                length: velocityLength
            }),
            gpuMatchesCurrentVelocity: gpuFacingMatchesCurrentVelocity
        }),
        registry: copyRegistryView(endpoint, handle, `${label} registry`),
        gpuSimulation: Object.freeze({ ...plane.gpu.simulation }),
        candidate: Object.freeze({ ...plane.gpu.candidate })
    });
}

async function snapshotIdleBilateralCapture(
    endpoint,
    captorHandle,
    projectileHandle,
    label
) {
    const [captor, projectile] = await Promise.all([
        snapshotIdleCaptureMember(
            endpoint,
            captorHandle,
            GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR,
            `${label} captor`
        ),
        snapshotIdleCaptureMember(
            endpoint,
            projectileHandle,
            GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE,
            `${label} projectile`
        )
    ]);
    return Object.freeze({ captor, projectile });
}

function assertIdleBilateralCaptureUnchanged(before, after, label) {
    const evidence = {};
    for (const side of ['captor', 'projectile']) {
        const left = before[side];
        const right = after[side];
        const ownershipStateUnchanged = captureOwnershipStateIsExact(
            left.gpuState,
            right.gpuState
        ) && captureOwnershipStateIsExact(left.hostState, right.hostState);
        const mirrorUnchanged = left.capturedMirror.host === false
            && left.capturedMirror.gpu === false
            && right.capturedMirror.host === false
            && right.capturedMirror.gpu === false;
        const registryUnchanged = registryViewIsExact(
            left.registry,
            right.registry
        );
        const facingAuthorityCoherent
            = left.facingAuthority.gpuMatchesCurrentVelocity === true
            && right.facingAuthority.gpuMatchesCurrentVelocity === true;
        assert(exactHandle(left.handle, right.handle)
            && left.bodySlot === right.bodySlot
            && ownershipStateUnchanged
            && mirrorUnchanged
            && registryUnchanged
            && facingAuthorityCoherent,
        `${label} ${side}: CaptureState/metadata mutation ${JSON.stringify({
            before: left,
            after: right
        })}`);
        evidence[side] = Object.freeze({
            handle: right.handle,
            bodySlot: right.bodySlot,
            ownershipStateUnchanged,
            mirrorUnchanged,
            registryUnchanged,
            facingAuthorityCoherent,
            fullState: Object.freeze({
                beforeHost: left.hostState,
                beforeGpu: left.gpuState,
                afterHost: right.hostState,
                afterGpu: right.gpuState
            }),
            facingAuthority: Object.freeze({
                before: left.facingAuthority,
                after: right.facingAuthority
            }),
            capturedMirror: right.capturedMirror,
            metadataRevision: right.registry.metadataRevision,
            metadata: right.registry.metadata
        });
    }
    return Object.freeze({
        verified: true,
        captor: evidence.captor,
        projectile: evidence.projectile
    });
}

function candidateIsCleared(candidate) {
    return candidate.distanceSquaredBits === 0x7f800000
        && candidate.peerEntityId === INVALID_U32
        && candidate.peerIncarnation === INVALID_U32
        && candidate.status === 0;
}

function assertZeroCaptureRetryCompletion(
    completion,
    runtime,
    endpoint,
    director,
    label
) {
    assert(completion.retryBatch === true
        && completion.retryBacklogRemaining === false
        && completion.retryOriginTick === 1
        && completion.captureCount === 0
        && completion.captures.length === 0
        && completion.releasePreparations.length === 0
        && completion.cleanups.length === 0
        && runtime.retryMode === false
        && runtime.retryBacklogRemaining === false
        && runtime.requiresRecovery === false
        && endpoint.requiresRecovery() === false
        && director.requiresRecovery() === false,
    `${label}: stale retry did not complete at zero demand ${JSON.stringify({
        completion,
        runtime,
        director: director.getStatus()
    })}`);
    return Object.freeze({
        retryBatch: completion.retryBatch,
        retryOriginTick: completion.retryOriginTick,
        retryBacklogRemaining: completion.retryBacklogRemaining,
        captureCount: completion.captureCount,
        captureRecordCount: completion.captures.length,
        releasePreparationCount: completion.releasePreparations.length,
        cleanupCount: completion.cleanups.length,
        retryMode: runtime.retryMode,
        recoveryRequired: false
    });
}

function assertBoundaryHealthy(value, label) {
    assert(value && value.recoveryRequired !== true,
        `${label}: ${JSON.stringify(value)}`);
    return value;
}

function drainCaptureBoundary(
    endpoint,
    director,
    targetFixedTick,
    coreDirector = null
) {
    const captures = endpoint
        .commitCompletedProjectileCaptureProgramsAtFixedBoundary(
            targetFixedTick
        );
    assert(captures?.protocolFailure == null,
        `T${targetFixedTick}: capture protocol ${JSON.stringify(captures)}`);
    const captureObservation = director.observeCompletedCapturePrograms(
        captures
    );
    assert(captureObservation?.requiresRecovery !== true,
        `T${targetFixedTick}: capture observe ${JSON.stringify(
            director.getStatus()
        )}`);
    const releases = endpoint
        .commitCompletedProjectileCaptureReleaseProgramsAtFixedBoundary(
            targetFixedTick
        );
    assert(releases?.protocolFailure == null,
        `T${targetFixedTick}: release protocol ${JSON.stringify(releases)}`);
    const releaseObservation = director.observeCompletedReleasePrograms(
        releases
    );
    assert(releaseObservation?.requiresRecovery !== true,
        `T${targetFixedTick}: release observe ${JSON.stringify(
            director.getStatus()
        )}`);
    const events = endpoint.commitCompletedEventsAtFixedBoundary(
        targetFixedTick
    );
    assert(events?.protocolFailure == null,
        `T${targetFixedTick}: event protocol ${JSON.stringify(events)}`);
    const eventObservation = director.observeCompletedEvents(events);
    assert(eventObservation?.requiresRecovery !== true,
        `T${targetFixedTick}: event observe ${JSON.stringify({
            status: director.getStatus(),
            events
        })}`);
    const coreObservation = coreDirector
        ? coreDirector.observeCompletedEvents(events, endpoint.getRegistry())
        : null;
    assert(coreObservation?.recoveryRequired !== true,
        `T${targetFixedTick}: Core observe ${JSON.stringify(coreObservation)}`);
    return Object.freeze({
        captures,
        captureObservation,
        releases,
        releaseObservation,
        events,
        eventObservation,
        coreObservation
    });
}

async function advanceTick({
    endpoint,
    director,
    tick,
    towerTargetHandle = null,
    coreDirector = null,
    afterCommit = null,
    label
}) {
    const boundary = drainCaptureBoundary(
        endpoint,
        director,
        tick,
        coreDirector
    );
    const coreStage = coreDirector?.stageForFixedTick({
        endpoint,
        targetFixedTick: tick
    }) ?? null;
    assert(coreStage?.recoveryRequired !== true,
        `${label}: Core stage ${JSON.stringify(coreStage)}`);
    const stage = director.stageForFixedTick({
        targetFixedTick: tick,
        towerTargetHandle
    });
    assert(stage?.accepted === true && stage.requiresRecovery !== true,
        `${label}: capture stage ${JSON.stringify({
            stage,
            director: director.getStatus()
        })}`);
    const lifecycle = assertBoundaryHealthy(
        endpoint.commitAtFixedBoundary(tick),
        `${label}: lifecycle`
    );
    refreshIdleDirectorBinding(endpoint, director, label);
    director.observeFixedCommit(lifecycle, tick);
    director.observeLifecycle(lifecycle, tick);
    coreDirector?.observeFixedCommit(lifecycle, tick);
    assert(!director.requiresRecovery(),
        `${label}: director ${JSON.stringify(director.getStatus())}`);
    await afterCommit?.(lifecycle);
    assert(endpoint.fixedUpdate(FIXED_DELTA, tick),
        `${label}: fixed submit failed`);
    const runtime = await waitForSimulation(endpoint, label);
    assert(!endpoint.requiresRecovery(),
        `${label}: endpoint recovery ${JSON.stringify(runtime)}`);
    const bodies = await readBodies(endpoint);
    return Object.freeze({
        boundary,
        coreStage,
        stage,
        lifecycle,
        runtime,
        bodies
    });
}

async function readTexturePixels(device, texture, width, height) {
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const target = device.createBuffer({
        label: 'cirvivor-nw-ring-render-readback',
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = device.createCommandEncoder({
            label: 'cirvivor-nw-ring-render-copy'
        });
        encoder.copyTextureToBuffer(
            { texture },
            { buffer: target, bytesPerRow, rowsPerImage: height },
            [width, height]
        );
        device.queue.submit([encoder.finish()]);
        await target.mapAsync(GPUMapMode.READ);
        return Object.freeze({
            bytes: new Uint8Array(target.getMappedRange()).slice(),
            bytesPerRow,
            width,
            height
        });
    } finally {
        try { target.unmap(); } catch { /* already unmapped */ }
        target.destroy();
    }
}

function alphaAt(frame, x, y) {
    const px = Math.max(0, Math.min(frame.width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(frame.height - 1, Math.round(y)));
    return frame.bytes[(py * frame.bytesPerRow) + (px * 4) + 3];
}

async function runFunnelCase(
    device,
    format,
    label,
    angleRadians,
    approachDirection = 'inbound'
) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const endpoint = createEndpoint(device, format, 3);
    let director = null;
    try {
        initializeEndpoint(endpoint, tileMap, label);
        director = createDirector(endpoint);
        const center = Object.freeze({ x: 4, y: 4 });
        const distance = 0.3;
        const projectilePosition = Object.freeze({
            x: center.x + (Math.cos(angleRadians) * distance),
            y: center.y + (Math.sin(angleRadians) * distance)
        });
        const ringIntent = createRingIntent(route, 1, center);
        const radialUnit = Object.freeze({
            x: Math.cos(angleRadians),
            y: Math.sin(angleRadians)
        });
        // Projectile의 절대 속도에 authored R route 속도를 먼저 더해, contact
        // prediction 뒤에도 relative radial path의 각도와 closing 부호를 보존합니다.
        const relativeRadialSpeed
            = approachDirection === 'outbound' ? 4 : -1;
        assert(endpoint.requestSpawnBatch([{
            intent: ringIntent,
            targetFixedTick: 1,
            commandId: `${label}:ring`
        }, {
            intent: createBulletIntent(
                projectilePosition,
                {
                    x: ringIntent.velocity.x
                        + (relativeRadialSpeed * radialUnit.x),
                    y: ringIntent.velocity.y
                        + (relativeRadialSpeed * radialUnit.y)
                },
                { spawnSequence: 1 }
            ),
            targetFixedTick: 1,
            commandId: `${label}:projectile`
        }]).accepted, `${label}: spawn batch rejected`);
        let relativeClosingDot = null;
        let preSubmitCaptorVelocity = null;
        let preSubmitProjectileVelocity = null;
        const tick1 = await advanceTick({
            endpoint,
            director,
            tick: 1,
            label: `${label} T1`,
            async afterCommit(lifecycle) {
                const captorHandle = requireSpawnHandle(
                    lifecycle,
                    `${label}:ring`
                );
                const projectileHandle = requireSpawnHandle(
                    lifecycle,
                    `${label}:projectile`
                );
                const bodies = await readBodies(endpoint);
                const captor = findBody(bodies, captorHandle, `${label} pre-submit R`);
                const projectile = findBody(
                    bodies,
                    projectileHandle,
                    `${label} pre-submit projectile`
                );
                const relativeVelocity = {
                    x: projectile.velocity.x - captor.velocity.x,
                    y: projectile.velocity.y - captor.velocity.y
                };
                const radialDelta = {
                    x: projectile.position.x - captor.position.x,
                    y: projectile.position.y - captor.position.y
                };
                relativeClosingDot = (relativeVelocity.x * radialDelta.x)
                    + (relativeVelocity.y * radialDelta.y);
                preSubmitCaptorVelocity = copyVector(captor.velocity);
                preSubmitProjectileVelocity = copyVector(projectile.velocity);
                assert(Number.isFinite(relativeClosingDot)
                    && (approachDirection === 'outbound'
                        ? relativeClosingDot > 0
                        : relativeClosingDot < 0),
                `${label}: actual relative closing dot mismatch ${relativeClosingDot}`);
            }
        });
        const captorHandle = requireSpawnHandle(tick1.lifecycle, `${label}:ring`);
        const projectileHandle = requireSpawnHandle(
            tick1.lifecycle,
            `${label}:projectile`
        );
        // Uncaptured basic projectiles can consume their penetration and be
        // authentically despawned at T2. Preserve the post-contact T1 body and
        // capture-plane evidence before that lifecycle cleanup runs.
        const projectileBody = copyBody(findBody(
            tick1.bodies,
            projectileHandle,
            `${label} T1 projectile`
        ));
        const projectileAudit = copyCaptureBodyAudit(
            endpoint,
            projectileHandle,
            `${label} T1 projectile audit`
        );
        const tick2 = await advanceTick({
            endpoint,
            director,
            tick: 2,
            label: `${label} T2`
        });
        const records = tick2.boundary.captures.captures ?? [];
        assert(records.length <= 1, `${label}: multiple captures`);
        if (records.length === 1) {
            assert(exactHandle(records[0].captorHandle, captorHandle)
                && exactHandle(records[0].projectileHandle, projectileHandle),
            `${label}: capture identity mismatch`);
        }
        return Object.freeze({
            angleRadians,
            approachDirection,
            relativeClosingDot,
            preSubmitCaptorVelocity,
            preSubmitProjectileVelocity,
            captorHandle: copyHandle(captorHandle),
            projectileHandle: copyHandle(projectileHandle),
            captureRecords: Object.freeze(records.map(snapshotCaptureRecord)),
            directorStatus: director.getStatus(),
            projectileBody,
            projectileAudit,
            runtimeStatus: tick2.runtime
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runOneCaptorTwoProjectiles(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const endpoint = createEndpoint(device, format, 4);
    let director = null;
    try {
        initializeEndpoint(endpoint, tileMap, 'one-captor-two');
        director = createDirector(endpoint);
        const center = Object.freeze({ x: 4, y: 4 });
        const requests = [{
            intent: createRingIntent(route, 1, center),
            targetFixedTick: 1,
            commandId: 'one-captor-two:ring'
        }, ...[0, 0.2].map((offset, index) => ({
            intent: createBulletIntent(
                { x: 4.3, y: 4 + offset },
                { x: -1, y: 0 },
                { spawnSequence: index + 1 }
            ),
            targetFixedTick: 1,
            commandId: `one-captor-two:projectile:${index}`
        }))];
        assert(endpoint.requestSpawnBatch(requests).accepted,
            'one-captor-two spawn rejected');
        const tick1 = await advanceTick({
            endpoint,
            director,
            tick: 1,
            label: 'one-captor-two T1'
        });
        const captorHandle = requireSpawnHandle(
            tick1.lifecycle,
            'one-captor-two:ring'
        );
        const projectileHandles = [0, 1].map((index) => requireSpawnHandle(
            tick1.lifecycle,
            `one-captor-two:projectile:${index}`
        ));
        const tick2 = await advanceTick({
            endpoint,
            director,
            tick: 2,
            label: 'one-captor-two T2'
        });
        const records = tick2.boundary.captures.captures ?? [];
        assert(records.length === 1
            && exactHandle(records[0].captorHandle, captorHandle)
            && exactHandle(records[0].projectileHandle, projectileHandles[0]),
        `one-captor-two deterministic winner mismatch ${JSON.stringify(records)}`);
        return Object.freeze({
            captorHandle: copyHandle(captorHandle),
            projectileHandles: Object.freeze(projectileHandles.map(copyHandle)),
            captureRecords: Object.freeze(records.map(snapshotCaptureRecord)),
            capturedProjectileCount:
                director.getStatus().capturedProjectileCount
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runTwoCaptorsOneProjectile(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const endpoint = createEndpoint(device, format, 4);
    let director = null;
    try {
        initializeEndpoint(endpoint, tileMap, 'two-captors-one');
        director = createDirector(endpoint);
        const requests = [0, 0.25].map((offset, index) => ({
            intent: createRingIntent(route, index + 1, {
                x: 4,
                y: 4 + offset
            }),
            targetFixedTick: 1,
            commandId: `two-captors-one:ring:${index}`
        }));
        requests.push({
            intent: createBulletIntent(
                { x: 4.3, y: 4.02 },
                { x: -1, y: 0 },
                { spawnSequence: 1 }
            ),
            targetFixedTick: 1,
            commandId: 'two-captors-one:projectile'
        });
        assert(endpoint.requestSpawnBatch(requests).accepted,
            'two-captors-one spawn rejected');
        const tick1 = await advanceTick({
            endpoint,
            director,
            tick: 1,
            label: 'two-captors-one T1'
        });
        const captorHandles = [0, 1].map((index) => requireSpawnHandle(
            tick1.lifecycle,
            `two-captors-one:ring:${index}`
        ));
        const projectileHandle = requireSpawnHandle(
            tick1.lifecycle,
            'two-captors-one:projectile'
        );
        const tick2 = await advanceTick({
            endpoint,
            director,
            tick: 2,
            label: 'two-captors-one T2'
        });
        const records = tick2.boundary.captures.captures ?? [];
        assert(records.length === 1
            && exactHandle(records[0].captorHandle, captorHandles[0])
            && exactHandle(records[0].projectileHandle, projectileHandle),
        `two-captors-one deterministic winner mismatch ${JSON.stringify(records)}`);
        return Object.freeze({
            captorHandles: Object.freeze(captorHandles.map(copyHandle)),
            projectileHandle: copyHandle(projectileHandle),
            captureRecords: Object.freeze(records.map(snapshotCaptureRecord)),
            capturedProjectileCount:
                director.getStatus().capturedProjectileCount
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function seedCapacityRejectedCaptureRetry({
    endpoint,
    director,
    route,
    prefix,
    projectileOptions = Object.freeze([{}, {}])
}) {
    const ringIntents = [0, 1].map((index) => createRingIntent(
        route,
        index + 1,
        { x: 4, y: 4 + (index * 2) }
    ));
    assert(endpoint.requestSpawnBatch([0, 1].flatMap((index) => ([{
        intent: ringIntents[index],
        targetFixedTick: 1,
        commandId: `${prefix}:ring:${index}`
    }, {
        intent: createBulletIntent(
            { x: 4.3, y: 4 + (index * 2) },
            {
                x: ringIntents[index].velocity.x - 0.25,
                y: ringIntents[index].velocity.y
            },
            {
                spawnSequence: index + 1,
                ...(projectileOptions[index] ?? null)
            }
        ),
        targetFixedTick: 1,
        commandId: `${prefix}:projectile:${index}`
    }]))).accepted, `${prefix}: capacity retry seed rejected`);
    let ringHandles = null;
    let projectileHandles = null;
    let beforeRejection = null;
    await advanceTick({
        endpoint,
        director,
        tick: 1,
        label: `${prefix} T1 rejection submit`,
        async afterCommit(lifecycle) {
            ringHandles = [0, 1].map((index) => requireSpawnHandle(
                lifecycle,
                `${prefix}:ring:${index}`
            ));
            projectileHandles = [0, 1].map((index) => requireSpawnHandle(
                lifecycle,
                `${prefix}:projectile:${index}`
            ));
            beforeRejection = Object.freeze(await Promise.all([0, 1].map(
                (index) => snapshotIdleBilateralCapture(
                    endpoint,
                    ringHandles[index],
                    projectileHandles[index],
                    `${prefix} pair-${index} before rejection`
                )
            )));
        }
    });
    assert(beforeRejection && ringHandles && projectileHandles,
        `${prefix}: rejection seed evidence missing`);
    const afterRejection = Object.freeze(await Promise.all([0, 1].map(
        (index) => snapshotIdleBilateralCapture(
            endpoint,
            ringHandles[index],
            projectileHandles[index],
            `${prefix} pair-${index} after rejection`
        )
    )));
    const rejectionInvariant = Object.freeze(afterRejection.map(
        (snapshot, index) => assertIdleBilateralCaptureUnchanged(
            beforeRejection[index],
            snapshot,
            `${prefix} pair-${index} capacity rejection`
        )
    ));
    assert(afterRejection.every((pair) => (
        pair.captor.candidate.peerEntityId === pair.projectile.handle.entityId
        && pair.captor.candidate.peerIncarnation
            === pair.projectile.handle.incarnation
        && pair.captor.candidate.status !== 0
        && pair.projectile.candidate.peerEntityId === pair.captor.handle.entityId
        && pair.projectile.candidate.peerIncarnation
            === pair.captor.handle.incarnation
        && pair.projectile.candidate.status !== 0
    )), `${prefix}: exact retry backlog token missing`);
    const rejected = drainCaptureBoundary(endpoint, director, 2);
    const runtime = endpoint.getProjectileCaptureRuntimeStatus();
    assert(rejected.captures.capacityRejected === true
        && rejected.captures.retryable === true
        && rejected.captures.captureDemandCount === 2
        && rejected.captures.captureCapacity === 1
        && rejected.captures.captures.length === 0
        && rejected.captures.releasePreparations.length === 0
        && rejected.captures.cleanups.length === 0
        && runtime.retryMode === true
        && runtime.retryOriginTick === 1
        && runtime.requiresRecovery === false
        && endpoint.requiresRecovery() === false
        && director.requiresRecovery() === false,
    `${prefix}: capacity retry rejection mismatch ${JSON.stringify({
        captures: rejected.captures,
        runtime
    })}`);
    return Object.freeze({
        ringIntents: Object.freeze(ringIntents),
        ringHandles: Object.freeze(ringHandles),
        projectileHandles: Object.freeze(projectileHandles),
        beforeRejection,
        afterRejection,
        rejectionInvariant,
        rejected,
        runtime
    });
}

async function runCapacityWholeBatchRejection(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const endpoint = createEndpoint(
        device,
        format,
        5,
        null,
        null,
        Object.freeze({
            projectileCaptureCompletionCapacity: 1,
            projectileCaptureReleasePreparationCapacity: 1,
            projectileCaptureCleanupCapacity: 1
        })
    );
    let director = null;
    try {
        initializeEndpoint(endpoint, tileMap, 'capture-capacity');
        director = createDirector(endpoint);
        const ringIntents = [0, 1].map((index) => createRingIntent(
            route,
            index + 1,
            { x: 4, y: 4 + (index * 2) }
        ));
        assert(endpoint.requestSpawnBatch([0, 1].flatMap((index) => ([{
            intent: ringIntents[index],
            targetFixedTick: 1,
            commandId: `capture-capacity:ring:${index}`
        }, {
            intent: createBulletIntent(
                { x: 4.3, y: 4 + (index * 2) },
                {
                    x: ringIntents[index].velocity.x - 0.25,
                    y: ringIntents[index].velocity.y
                },
                { spawnSequence: index + 1 }
            ),
            targetFixedTick: 1,
            commandId: `capture-capacity:projectile:${index}`
        }]))).accepted, 'capture-capacity spawn batch rejected');
        let ringHandles = null;
        let projectileHandles = null;
        let beforePlanes = null;
        let metadataBefore = null;
        const tick1 = await advanceTick({
            endpoint,
            director,
            tick: 1,
            label: 'capture-capacity T1',
            async afterCommit(lifecycle) {
                ringHandles = [0, 1].map((index) => requireSpawnHandle(
                    lifecycle,
                    `capture-capacity:ring:${index}`
                ));
                projectileHandles = [0, 1].map((index) => requireSpawnHandle(
                    lifecycle,
                    `capture-capacity:projectile:${index}`
                ));
                beforePlanes = Object.freeze(await Promise.all([
                    ...ringHandles.map((handle, index) => readGpuCapturePlanes(
                        endpoint,
                        handle,
                        `capture-capacity-before-ring-${index}`
                    )),
                    ...projectileHandles.map(
                        (handle, index) => readGpuCapturePlanes(
                            endpoint,
                            handle,
                            `capture-capacity-before-projectile-${index}`
                        )
                    )
                ]));
                metadataBefore = Object.freeze(projectileHandles.map(
                    (handle, index) => copyRegistryView(
                        endpoint,
                        handle,
                        `capture-capacity metadata before ${index}`
                    )
                ));
            }
        });
        assert(beforePlanes && metadataBefore,
            'capture-capacity pre-submit evidence missing');
        const afterPlanes = Object.freeze(await Promise.all([
            ...ringHandles.map((handle, index) => readGpuCapturePlanes(
                endpoint,
                handle,
                `capture-capacity-after-ring-${index}`
            )),
            ...projectileHandles.map((handle, index) => readGpuCapturePlanes(
                endpoint,
                handle,
                `capture-capacity-after-projectile-${index}`
            ))
        ]));
        const metadataAfter = Object.freeze(projectileHandles.map(
            (handle, index) => copyRegistryView(
                endpoint,
                handle,
                `capture-capacity metadata after ${index}`
            )
        ));
        const boundary = drainCaptureBoundary(endpoint, director, 2);
        assert(boundary.captures.capacityRejected === true
            && boundary.captures.retryable === true
            && boundary.captures.rejectionReason
                === 'projectile-capture-completion-capacity'
            && boundary.captures.captureDemandCount === 2
            && boundary.captures.captureCapacity === 1
            && boundary.captures.captures.length === 0
            && boundary.captures.releasePreparations.length === 0
            && boundary.captures.cleanups.length === 0
            && boundary.captureObservation.capacityRejected === true
            && boundary.captureObservation.retryable === true
            && boundary.captureObservation.retryAfterFixedTick === 2,
        `capture-capacity envelope mismatch ${JSON.stringify(boundary.captures)}`);
        const stateBefore = beforePlanes.map((plane) => plane.gpu.state);
        const stateAfter = afterPlanes.map((plane) => plane.gpu.state);
        assert(JSON.stringify(stateAfter) === JSON.stringify(stateBefore),
            'capture-capacity rejection mutated CaptureState');
        assert(metadataAfter.every((view, index) => (
            view.metadataRevision === metadataBefore[index].metadataRevision
            && JSON.stringify(view.metadata)
                === JSON.stringify(metadataBefore[index].metadata)
        )), 'capture-capacity rejection mutated registry metadata');
        const status = endpoint.getProjectileCaptureRuntimeStatus();
        assert(status.capacityRejected === true
            && status.retryableCapacityRejected === true
            && status.retryMode === true
            && status.retryOriginTick === 1
            && status.requiresRecovery === false
            && endpoint.requiresRecovery() === false
            && director.requiresRecovery() === false,
        `capture-capacity incorrectly required recovery ${JSON.stringify(status)}`);
        const retrySubmitOne = await advanceTick({
            endpoint,
            director,
            tick: 2,
            label: 'capture-capacity retry 1 submit',
            async afterCommit() {
                await Promise.all([0, 1].map((index) => placeCapturePairForRetry(
                    endpoint,
                    ringHandles[index],
                    projectileHandles[index],
                    `capture-capacity retry-1 pair-${index}`,
                    { currentValid: true }
                )));
            }
        });
        const retrySubmitTwo = await advanceTick({
            endpoint,
            director,
            tick: 3,
            label: 'capture-capacity retry 2 submit',
            async afterCommit() {
                await placeCapturePairForRetry(
                    endpoint,
                    ringHandles[1],
                    projectileHandles[1],
                    'capture-capacity retry-2 pair-1',
                    { currentValid: true }
                );
            }
        });
        const retryComplete = await advanceTick({
            endpoint,
            director,
            tick: 4,
            label: 'capture-capacity retry complete'
        });
        const retryOne = retrySubmitTwo.boundary.captures;
        const retryTwo = retryComplete.boundary.captures;
        assert(retrySubmitOne.runtime.retryMode === true
            && retryOne.retryBatch === true
            && retryOne.retryBacklogRemaining === true
            && retryOne.retryOriginTick === 1
            && retryOne.captureCount === 1
            && retryOne.captures.length === 1
            && retryOne.releasePreparations.length === 0
            && retryOne.cleanups.length === 0
            && retryTwo.retryBatch === true
            && retryTwo.retryBacklogRemaining === false
            && retryTwo.retryOriginTick === 1
            && retryTwo.captureCount === 1
            && retryTwo.captures.length === 1
            && retryTwo.releasePreparations.length === 0
            && retryTwo.cleanups.length === 0
            && retryComplete.runtime.retryMode === false,
        `capture-capacity bounded retry mismatch ${JSON.stringify({
            retryOne,
            retryTwo,
            runtime: retryComplete.runtime
        })}`);
        const retryCaptureRecords = Object.freeze([
            ...retryOne.captures,
            ...retryTwo.captures
        ]);
        assert(retryCaptureRecords.length === 2
            && retryCaptureRecords.every((record, index) => (
                exactHandle(record.captorHandle, ringHandles[index])
                && exactHandle(record.projectileHandle, projectileHandles[index])
            ))
            && director.getStatus().capturedProjectileCount === 2,
        'capture-capacity retry ordering/roster mismatch');
        return Object.freeze({
            capacityRejected: boundary.captures.capacityRejected,
            retryable: boundary.captures.retryable,
            rejectionReason: boundary.captures.rejectionReason,
            capacityRejectionFlags:
                boundary.captures.capacityRejectionFlags,
            captureDemandCount: boundary.captures.captureDemandCount,
            captureCapacity: boundary.captures.captureCapacity,
            retryAfterFixedTick:
                boundary.captureObservation.retryAfterFixedTick,
            recordCount: boundary.captures.captures.length
                + boundary.captures.releasePreparations.length
                + boundary.captures.cleanups.length,
            stateUnchanged:
                JSON.stringify(stateAfter) === JSON.stringify(stateBefore),
            metadataUnchanged: metadataAfter.every((view, index) => (
                view.metadataRevision === metadataBefore[index].metadataRevision
                && JSON.stringify(view.metadata)
                    === JSON.stringify(metadataBefore[index].metadata)
            )),
            retry: Object.freeze({
                originSourceTick: retryOne.retryOriginTick,
                firstBacklogRemaining: retryOne.retryBacklogRemaining,
                secondBacklogRemaining: retryTwo.retryBacklogRemaining,
                firstCommittedCount: retryOne.captureCount,
                remainingDemandAndCommittedCount: retryTwo.captureCount,
                firstRecords: Object.freeze(
                    retryOne.captures.map(snapshotCaptureRecord)
                ),
                secondRecords: Object.freeze(
                    retryTwo.captures.map(snapshotCaptureRecord)
                ),
                finalCapturedProjectileCount:
                    director.getStatus().capturedProjectileCount
            }),
            runtimeStatus: status,
            finalRuntimeStatus: retryComplete.runtime,
            directorStatus: director.getStatus()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runCapacityCurrentTickInvalidation(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const endpoint = createEndpoint(
        device,
        format,
        5,
        null,
        null,
        Object.freeze({
            projectileCaptureCompletionCapacity: 1,
            projectileCaptureReleasePreparationCapacity: 1,
            projectileCaptureCleanupCapacity: 1
        })
    );
    let director = null;
    try {
        initializeEndpoint(endpoint, tileMap, 'capture-retry-current-tick');
        director = createDirector(endpoint);
        const ringIntents = [0, 1].map((index) => createRingIntent(
            route,
            index + 1,
            { x: 4, y: 4 + (index * 2) }
        ));
        assert(endpoint.requestSpawnBatch([0, 1].flatMap((index) => ([{
            intent: ringIntents[index],
            targetFixedTick: 1,
            commandId: `capture-retry-current:ring:${index}`
        }, {
            intent: createBulletIntent(
                { x: 4.3, y: 4 + (index * 2) },
                {
                    x: ringIntents[index].velocity.x - 0.25,
                    y: ringIntents[index].velocity.y
                },
                { spawnSequence: index + 1 }
            ),
            targetFixedTick: 1,
            commandId: `capture-retry-current:projectile:${index}`
        }]))).accepted, 'capture-retry-current spawn batch rejected');
        let ringHandles = null;
        let projectileHandles = null;
        await advanceTick({
            endpoint,
            director,
            tick: 1,
            label: 'capture-retry-current T1',
            afterCommit(lifecycle) {
                ringHandles = [0, 1].map((index) => requireSpawnHandle(
                    lifecycle,
                    `capture-retry-current:ring:${index}`
                ));
                projectileHandles = [0, 1].map((index) => requireSpawnHandle(
                    lifecycle,
                    `capture-retry-current:projectile:${index}`
                ));
            }
        });
        const rejected = drainCaptureBoundary(endpoint, director, 2);
        assert(rejected.captures.capacityRejected === true
            && rejected.captures.retryable === true
            && rejected.captures.captureDemandCount === 2
            && rejected.captures.captureCapacity === 1
            && rejected.captures.captures.length === 0
            && endpoint.getProjectileCaptureRuntimeStatus().retryMode === true
            && endpoint.requiresRecovery() === false
            && director.requiresRecovery() === false,
        `capture-retry-current rejection mismatch ${JSON.stringify(
            rejected.captures
        )}`);
        let validPlacement = null;
        let invalidPlacement = null;
        let invalidPairBeforeRetry = null;
        const retrySubmit = await advanceTick({
            endpoint,
            director,
            tick: 2,
            label: 'capture-retry-current T2 retry',
            async afterCommit() {
                [validPlacement, invalidPlacement] = await Promise.all([
                    placeCapturePairForRetry(
                        endpoint,
                        ringHandles[0],
                        projectileHandles[0],
                        'capture-retry-current valid-pair',
                        { currentValid: true }
                    ),
                    placeCapturePairForRetry(
                        endpoint,
                        ringHandles[1],
                        projectileHandles[1],
                        'capture-retry-current invalid-pair',
                        { currentValid: false }
                    )
                ]);
                invalidPairBeforeRetry = await snapshotIdleBilateralCapture(
                    endpoint,
                    ringHandles[1],
                    projectileHandles[1],
                    'capture-retry-current invalid pair before retry'
                );
            }
        });
        const invalidPairAfterRetry = await snapshotIdleBilateralCapture(
            endpoint,
            ringHandles[1],
            projectileHandles[1],
            'capture-retry-current invalid pair after retry'
        );
        const invalidPairInvariant = assertIdleBilateralCaptureUnchanged(
            invalidPairBeforeRetry,
            invalidPairAfterRetry,
            'capture-retry-current invalid pair retry'
        );
        assert(validPlacement?.currentValid === true
            && invalidPlacement?.currentValid === false
            && invalidPairInvariant.verified === true
            && retrySubmit.runtime.retryMode === false
            && retrySubmit.runtime.retryBacklogRemaining === false
            && retrySubmit.runtime.requiresRecovery === false
            && endpoint.requiresRecovery() === false
            && director.requiresRecovery() === false,
        `capture-retry-current retry status mismatch ${JSON.stringify(
            retrySubmit.runtime
        )}`);
        const normalSubmit = await advanceTick({
            endpoint,
            director,
            tick: 3,
            label: 'capture-retry-current T3 normal clear'
        });
        const completion = normalSubmit.boundary.captures;
        assert(completion.retryBatch === true
            && completion.retryBacklogRemaining === false
            && completion.retryOriginTick === 1
            && completion.captureCount === 1
            && completion.captures.length === 1
            && exactHandle(
                completion.captures[0].captorHandle,
                ringHandles[0]
            )
            && exactHandle(
                completion.captures[0].projectileHandle,
                projectileHandles[0]
            )
            && !completion.captures.some((record) => exactHandle(
                record.projectileHandle,
                projectileHandles[1]
            ))
            && completion.releasePreparations.length === 0
            && completion.cleanups.length === 0
            && normalSubmit.runtime.retryMode === false
            && normalSubmit.runtime.requiresRecovery === false,
        `capture-retry-current completion mismatch ${JSON.stringify(
            completion
        )}`);
        const stalePlanes = Object.freeze(await Promise.all([
            readGpuCapturePlanes(
                endpoint,
                ringHandles[1],
                'capture-retry-current stale-ring-after-normal-clear'
            ),
            readGpuCapturePlanes(
                endpoint,
                projectileHandles[1],
                'capture-retry-current stale-projectile-after-normal-clear'
            )
        ]));
        assert(stalePlanes.every(({ gpu }) => (
            gpu.candidate.distanceSquaredBits === 0x7f800000
            && gpu.candidate.peerEntityId === INVALID_U32
            && gpu.candidate.peerIncarnation === INVALID_U32
            && gpu.candidate.status === 0
            && gpu.state.phase === GPU_PROJECTILE_CAPTURE_PHASE.IDLE
        ))
            && director.getStatus().capturedProjectileCount === 1
            && endpoint.requiresRecovery() === false
            && director.requiresRecovery() === false,
        `capture-retry-current stale token cleanup mismatch ${JSON.stringify(
            stalePlanes
        )}`);
        return Object.freeze({
            rejectedDemandCount: rejected.captures.captureDemandCount,
            validPlacement,
            invalidPlacement,
            retryBatch: completion.retryBatch,
            retryBacklogRemaining: completion.retryBacklogRemaining,
            currentValidDemandAndCommittedCount: completion.captureCount,
            validCaptureRecords: Object.freeze(
                completion.captures.map(snapshotCaptureRecord)
            ),
            invalidCaptureCount: completion.captures.filter((record) => (
                exactHandle(record.projectileHandle, projectileHandles[1])
            )).length,
            invalidPairInvariant,
            staleCandidateCleared: stalePlanes.every(({ gpu }) => (
                gpu.candidate.distanceSquaredBits === 0x7f800000
                && gpu.candidate.peerEntityId === INVALID_U32
                && gpu.candidate.peerIncarnation === INVALID_U32
                && gpu.candidate.status === 0
            )),
            finalRuntimeStatus: normalSubmit.runtime,
            directorStatus: director.getStatus()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runCapacityRetryProjectileAba(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const prefix = 'capture-retry-aba';
    const endpoint = createEndpoint(
        device,
        format,
        5,
        null,
        null,
        Object.freeze({
            projectileCaptureCompletionCapacity: 1,
            projectileCaptureReleasePreparationCapacity: 1,
            projectileCaptureCleanupCapacity: 1
        })
    );
    let director = null;
    try {
        initializeEndpoint(endpoint, tileMap, prefix);
        director = createDirector(endpoint);
        const seed = await seedCapacityRejectedCaptureRetry({
            endpoint,
            director,
            route,
            prefix
        });
        const oldProjectileHandle = seed.projectileHandles[0];
        const oldProjectileSlot = seed.afterRejection[0]
            .projectile.bodySlot;
        assert(endpoint.requestDespawn(
            oldProjectileHandle,
            'capture-retry-aba',
            2,
            `${prefix}:despawn-old-projectile`
        ).accepted, `${prefix}: old projectile despawn rejected`);
        assert(endpoint.requestSpawn(
            createBulletIntent(
                { x: 4.3, y: 4 },
                {
                    x: seed.ringIntents[0].velocity.x - 0.25,
                    y: seed.ringIntents[0].velocity.y
                },
                { spawnSequence: 3 }
            ),
            2,
            `${prefix}:replacement-projectile`
        ).accepted, `${prefix}: replacement spawn rejected`);
        let replacementHandle = null;
        let beforeRetry = null;
        let validPlacement = null;
        let invalidPlacement = null;
        const retrySubmit = await advanceTick({
            endpoint,
            director,
            tick: 2,
            label: `${prefix} T2 ABA retry`,
            async afterCommit(lifecycle) {
                assert(lifecycle.despawned?.some((entry) => exactHandle(
                    entry.handle,
                    oldProjectileHandle
                )), `${prefix}: old projectile was not despawned`);
                replacementHandle = requireSpawnHandle(
                    lifecycle,
                    `${prefix}:replacement-projectile`
                );
                assert(replacementHandle.entityId === oldProjectileHandle.entityId
                    && replacementHandle.incarnation
                        === oldProjectileHandle.incarnation + 1,
                `${prefix}: exact ABA identity was not reused`);
                const replacementPlane = await readGpuCapturePlanes(
                    endpoint,
                    replacementHandle,
                    `${prefix} replacement materialization`
                );
                assert(replacementPlane.audit.bodySlot === oldProjectileSlot,
                    `${prefix}: exact ABA slot was not reused`);
                assertFreshCapturePlane(
                    replacementPlane,
                    replacementHandle,
                    GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE,
                    `${prefix} replacement materialization`
                );
                [validPlacement, invalidPlacement] = await Promise.all([
                    placeCapturePairForRetry(
                        endpoint,
                        seed.ringHandles[0],
                        replacementHandle,
                        `${prefix} replacement current contact`,
                        { currentValid: true }
                    ),
                    placeCapturePairForRetry(
                        endpoint,
                        seed.ringHandles[1],
                        seed.projectileHandles[1],
                        `${prefix} control invalidation`,
                        { currentValid: false }
                    )
                ]);
                beforeRetry = await snapshotIdleBilateralCapture(
                    endpoint,
                    seed.ringHandles[0],
                    replacementHandle,
                    `${prefix} replacement before retry`
                );
            }
        });
        assert(replacementHandle && beforeRetry
            && validPlacement?.currentValid === true
            && invalidPlacement?.currentValid === false
            && endpoint.getRegistry().has(oldProjectileHandle) === false,
        `${prefix}: ABA mutation evidence missing`);
        const afterRetry = await snapshotIdleBilateralCapture(
            endpoint,
            seed.ringHandles[0],
            replacementHandle,
            `${prefix} replacement after retry`
        );
        const bilateralInvariant = assertIdleBilateralCaptureUnchanged(
            beforeRetry,
            afterRetry,
            `${prefix} replacement retry`
        );
        assert(retrySubmit.runtime.retryMode === false
            && retrySubmit.runtime.requiresRecovery === false,
        `${prefix}: retry runtime mismatch ${JSON.stringify(
            retrySubmit.runtime
        )}`);
        const normalSubmit = await advanceTick({
            endpoint,
            director,
            tick: 3,
            label: `${prefix} T3 completion and normal clear`,
            async afterCommit() {
                await Promise.all([
                    placeCapturePairForRetry(
                        endpoint,
                        seed.ringHandles[0],
                        replacementHandle,
                        `${prefix} replacement normal invalidation`,
                        { currentValid: false }
                    ),
                    placeCapturePairForRetry(
                        endpoint,
                        seed.ringHandles[1],
                        seed.projectileHandles[1],
                        `${prefix} control normal invalidation`,
                        { currentValid: false }
                    )
                ]);
            }
        });
        const zeroCompletion = assertZeroCaptureRetryCompletion(
            normalSubmit.boundary.captures,
            normalSubmit.runtime,
            endpoint,
            director,
            prefix
        );
        const replacementCaptureCount = normalSubmit.boundary.captures
            .captures.filter((record) => exactHandle(
                record.projectileHandle,
                replacementHandle
            )).length;
        const cleared = Object.freeze(await Promise.all([
            readGpuCapturePlanes(
                endpoint,
                seed.ringHandles[0],
                `${prefix} captor after normal clear`
            ),
            readGpuCapturePlanes(
                endpoint,
                replacementHandle,
                `${prefix} replacement after normal clear`
            )
        ]));
        assert(cleared.every((plane) => candidateIsCleared(
            plane.gpu.candidate
        ))
            && cleared[1].gpu.state.phase
                === GPU_PROJECTILE_CAPTURE_PHASE.IDLE
            && cleared[1].gpu.state.captureSequence === 0
            && cleared[1].audit.capturedMirror === false
            && replacementCaptureCount === 0
            && director.getStatus().capturedProjectileCount === 0,
        `${prefix}: stale ABA state survived normal clear ${JSON.stringify(
            cleared
        )}`);
        return Object.freeze({
            rejectedDemandCount: seed.rejected.captures.captureDemandCount,
            rejectionInvariant: seed.rejectionInvariant,
            oldProjectileHandle: copyHandle(oldProjectileHandle),
            replacementHandle: copyHandle(replacementHandle),
            exactEntityIdReused:
                replacementHandle.entityId === oldProjectileHandle.entityId,
            incarnationAdvanced:
                replacementHandle.incarnation
                    === oldProjectileHandle.incarnation + 1,
            exactSlotReused:
                afterRetry.projectile.bodySlot === oldProjectileSlot,
            oldRegistryEntryRemoved:
                endpoint.getRegistry().has(oldProjectileHandle) === false,
            replacementCurrentContact: validPlacement,
            replacementCaptureCount,
            bilateralInvariant,
            zeroCompletion,
            staleCandidateCleared: cleared.every((plane) => (
                candidateIsCleared(plane.gpu.candidate)
            )),
            finalRuntimeStatus: normalSubmit.runtime,
            directorStatus: director.getStatus(),
            recoveryRequired: endpoint.requiresRecovery()
                || director.requiresRecovery()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runCapacityRetryDeathInvalidation(device, format, mode) {
    assert(mode === 'captor' || mode === 'projectile',
        `capture retry death mode invalid: ${mode}`);
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const prefix = `capture-retry-${mode}-death`;
    const endpoint = createEndpoint(
        device,
        format,
        6,
        null,
        null,
        Object.freeze({
            projectileCaptureCompletionCapacity: 1,
            projectileCaptureReleasePreparationCapacity: 1,
            projectileCaptureCleanupCapacity: 1
        })
    );
    let director = null;
    try {
        initializeEndpoint(endpoint, tileMap, prefix);
        director = createDirector(endpoint);
        const projectileOptions = mode === 'projectile'
            ? Object.freeze([Object.freeze({
                definitionId: `${prefix}-expiring-projectile`,
                lifetimeSeconds: FIXED_DELTA * 1.5
            }), Object.freeze({})])
            : Object.freeze([Object.freeze({}), Object.freeze({})]);
        const seed = await seedCapacityRejectedCaptureRetry({
            endpoint,
            director,
            route,
            prefix,
            projectileOptions
        });
        let interventionHandle = null;
        if (mode === 'captor') {
            const bodies = await readBodies(endpoint);
            const captorBody = findBody(
                bodies,
                seed.ringHandles[0],
                `${prefix} lethal target`
            );
            assert(endpoint.requestSpawn(
                createLethalEnemyHitIntent(captorBody, {
                    definitionId: `${prefix}-lethal-projectile`,
                    spawnSequence: 3
                }),
                2,
                `${prefix}:lethal`
            ).accepted, `${prefix}: lethal intervention rejected`);
        }
        let beforeRetry = null;
        let targetPlacement = null;
        let controlPlacement = null;
        const retrySubmit = await advanceTick({
            endpoint,
            director,
            tick: 2,
            label: `${prefix} T2 death retry`,
            async afterCommit(lifecycle) {
                if (mode === 'captor') {
                    interventionHandle = requireSpawnHandle(
                        lifecycle,
                        `${prefix}:lethal`
                    );
                }
                [targetPlacement, controlPlacement] = await Promise.all([
                    placeCapturePairForRetry(
                        endpoint,
                        seed.ringHandles[0],
                        seed.projectileHandles[0],
                        `${prefix} target current contact`,
                        { currentValid: true }
                    ),
                    placeCapturePairForRetry(
                        endpoint,
                        seed.ringHandles[1],
                        seed.projectileHandles[1],
                        `${prefix} control invalidation`,
                        { currentValid: false }
                    )
                ]);
                beforeRetry = await snapshotIdleBilateralCapture(
                    endpoint,
                    seed.ringHandles[0],
                    seed.projectileHandles[0],
                    `${prefix} pair before retry`
                );
            }
        });
        const afterRetry = await snapshotIdleBilateralCapture(
            endpoint,
            seed.ringHandles[0],
            seed.projectileHandles[0],
            `${prefix} pair after retry death`
        );
        const bilateralInvariant = assertIdleBilateralCaptureUnchanged(
            beforeRetry,
            afterRetry,
            `${prefix} pair retry death`
        );
        const deadMember = mode === 'captor'
            ? afterRetry.captor
            : afterRetry.projectile;
        const targetHandle = mode === 'captor'
            ? seed.ringHandles[0]
            : seed.projectileHandles[0];
        const survivorHandle = mode === 'captor'
            ? seed.projectileHandles[0]
            : seed.ringHandles[0];
        assert((deadMember.gpuSimulation.flags
                & GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE) === 0
            && (mode === 'captor'
                ? deadMember.gpuSimulation.healthFixedPoint <= 0
                : deadMember.gpuSimulation.lifetime === 0)
            && targetPlacement?.currentValid === true
            && controlPlacement?.currentValid === false
            && retrySubmit.runtime.retryMode === false
            && retrySubmit.runtime.requiresRecovery === false
            && endpoint.getRegistry().has(targetHandle) === true,
        `${prefix}: current GPU death did not invalidate retry ${JSON.stringify({
            deadMember,
            runtime: retrySubmit.runtime
        })}`);
        const targetSlot = deadMember.bodySlot;
        const normalSubmit = await advanceTick({
            endpoint,
            director,
            tick: 3,
            label: `${prefix} T3 death publication and clear`,
            afterCommit(lifecycle) {
                assert(lifecycle.despawned?.some((entry) => exactHandle(
                    entry.handle,
                    targetHandle
                )), `${prefix}: exact dead target was not despawned`);
            }
        });
        const zeroCompletion = assertZeroCaptureRetryCompletion(
            normalSubmit.boundary.captures,
            normalSubmit.runtime,
            endpoint,
            director,
            prefix
        );
        const targetCaptureCount = normalSubmit.boundary.captures
            .captures.filter((record) => (
                exactHandle(record.captorHandle, targetHandle)
                || exactHandle(record.projectileHandle, targetHandle)
            )).length;
        const tombstone = await readGpuCapturePlanesAtSlot(
            endpoint,
            targetSlot,
            `${prefix} target tombstone`
        );
        assertTombstoneCapturePlane(tombstone, `${prefix} target tombstone`);
        const survivor = await readGpuCapturePlanes(
            endpoint,
            survivorHandle,
            `${prefix} survivor after normal clear`
        );
        assert(candidateIsCleared(survivor.gpu.candidate)
            && survivor.gpu.state.phase === GPU_PROJECTILE_CAPTURE_PHASE.IDLE
            && survivor.gpu.state.peerBodySlot === INVALID_U32
            && survivor.gpu.state.peerEntityId === INVALID_U32
            && survivor.gpu.state.peerIncarnation === INVALID_U32
            && survivor.gpu.state.captureSequence === 0
            && survivor.audit.capturedMirror === false
            && endpoint.getRegistry().has(targetHandle) === false
            && endpoint.getRegistry().has(survivorHandle) === true
            && targetCaptureCount === 0
            && director.getStatus().capturedProjectileCount === 0,
        `${prefix}: death cleanup left stale capture state ${JSON.stringify({
            survivor,
            tombstone
        })}`);
        return Object.freeze({
            mode,
            rejectedDemandCount: seed.rejected.captures.captureDemandCount,
            rejectionInvariant: seed.rejectionInvariant,
            targetHandle: copyHandle(targetHandle),
            survivorHandle: copyHandle(survivorHandle),
            interventionHandle: interventionHandle
                ? copyHandle(interventionHandle)
                : null,
            targetWasCurrentContact: targetPlacement.currentValid,
            gpuDeathEvidence: Object.freeze({
                alive: false,
                healthFixedPoint:
                    deadMember.gpuSimulation.healthFixedPoint,
                lifetime: deadMember.gpuSimulation.lifetime
            }),
            bilateralInvariant,
            targetCaptureCount,
            zeroCompletion,
            lifecycleRemovedExactTarget:
                endpoint.getRegistry().has(targetHandle) === false,
            tombstoneCleared: candidateIsCleared(tombstone.candidate),
            survivorCandidateCleared:
                candidateIsCleared(survivor.gpu.candidate),
            deathEvents: copyEventEvidence(normalSubmit.boundary.events),
            finalRuntimeStatus: normalSubmit.runtime,
            directorStatus: director.getStatus(),
            recoveryRequired: endpoint.requiresRecovery()
                || director.requiresRecovery()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runCapacityRetryOldGenerationRollover(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const options = Object.freeze({
        projectileCaptureCompletionCapacity: 1,
        projectileCaptureReleasePreparationCapacity: 1,
        projectileCaptureCleanupCapacity: 1
    });
    const oldEndpoint = createEndpoint(
        device,
        format,
        5,
        null,
        null,
        options
    );
    let oldDirector = null;
    let oldPort = null;
    let oldSeed = null;
    try {
        initializeEndpoint(
            oldEndpoint,
            tileMap,
            'capture-retry-old-generation-old'
        );
        oldDirector = createDirector(oldEndpoint);
        oldPort = DIRECTOR_BINDING.get(oldDirector).commandPort;
        oldSeed = await seedCapacityRejectedCaptureRetry({
            endpoint: oldEndpoint,
            director: oldDirector,
            route,
            prefix: 'capture-retry-old-generation-old'
        });
        assert(oldSeed.runtime.retryMode === true
            && oldSeed.runtime.requiresRecovery === false,
        'capture-retry-old-generation: old backlog missing');
    } finally {
        oldDirector?.destroy();
        oldEndpoint.destroy();
    }
    const stalePortRequest = oldPort.requestPreparedReleaseBatch({
        commandId: 'capture-retry-old-generation:stale-port',
        prepareSourceTick: 1,
        targetFixedTick: 2,
        batchIdFingerprint: 1,
        records: Object.freeze([])
    });
    assert(stalePortRequest?.accepted === false
        && stalePortRequest.reason
            === 'projectile-capture-release-ingress-revoked'
        && stalePortRequest.requiresRecovery === false,
    `capture-retry-old-generation: old binding stayed live ${JSON.stringify(
        stalePortRequest
    )}`);

    const endpoint = createEndpoint(
        device,
        format,
        5,
        null,
        null,
        options
    );
    let director = null;
    try {
        const prefix = 'capture-retry-old-generation-new';
        initializeEndpoint(endpoint, tileMap, prefix);
        director = createDirector(endpoint);
        const newRuntimeAtStart = endpoint.getProjectileCaptureRuntimeStatus();
        assert(newRuntimeAtStart.sessionGeneration
                !== oldSeed.runtime.sessionGeneration
            && newRuntimeAtStart.retryMode === false
            && newRuntimeAtStart.retryOriginTick === 0,
        `capture-retry-old-generation: generation/backlog rollover mismatch ${JSON.stringify({
            old: oldSeed.runtime,
            next: newRuntimeAtStart
        })}`);
        const ringIntents = [0, 1].map((index) => createRingIntent(
            route,
            index + 1,
            { x: 4, y: 4 + (index * 2) }
        ));
        assert(endpoint.requestSpawnBatch([0, 1].flatMap((index) => ([{
            intent: ringIntents[index],
            targetFixedTick: 1,
            commandId: `${prefix}:ring:${index}`
        }, {
            intent: createBulletIntent(
                { x: 7, y: 4 + (index * 2) },
                {
                    x: ringIntents[index].velocity.x + 1,
                    y: ringIntents[index].velocity.y
                },
                { spawnSequence: index + 1 }
            ),
            targetFixedTick: 1,
            commandId: `${prefix}:projectile:${index}`
        }]))).accepted, `${prefix}: replacement generation seed rejected`);
        let ringHandles = null;
        let projectileHandles = null;
        let beforeSubmit = null;
        await advanceTick({
            endpoint,
            director,
            tick: 1,
            label: `${prefix} T1 zero-capture submit`,
            async afterCommit(lifecycle) {
                ringHandles = [0, 1].map((index) => requireSpawnHandle(
                    lifecycle,
                    `${prefix}:ring:${index}`
                ));
                projectileHandles = [0, 1].map((index) => requireSpawnHandle(
                    lifecycle,
                    `${prefix}:projectile:${index}`
                ));
                assert(ringHandles.every((handle, index) => exactHandle(
                    handle,
                    oldSeed.ringHandles[index]
                )) && projectileHandles.every((handle, index) => exactHandle(
                    handle,
                    oldSeed.projectileHandles[index]
                )), `${prefix}: numeric identities did not repeat across session`);
                beforeSubmit = Object.freeze(await Promise.all([0, 1].map(
                    (index) => snapshotIdleBilateralCapture(
                        endpoint,
                        ringHandles[index],
                        projectileHandles[index],
                        `${prefix} pair-${index} before submit`
                    )
                )));
            }
        });
        const afterSubmit = Object.freeze(await Promise.all([0, 1].map(
            (index) => snapshotIdleBilateralCapture(
                endpoint,
                ringHandles[index],
                projectileHandles[index],
                `${prefix} pair-${index} after submit`
            )
        )));
        const bilateralInvariant = Object.freeze(afterSubmit.map(
            (snapshot, index) => assertIdleBilateralCaptureUnchanged(
                beforeSubmit[index],
                snapshot,
                `${prefix} pair-${index} old-generation isolation`
            )
        ));
        const publish = await advanceTick({
            endpoint,
            director,
            tick: 2,
            label: `${prefix} T2 zero-capture publication`
        });
        const completion = publish.boundary.captures;
        assert(completion.capacityRejected === false
            && completion.retryBatch === false
            && completion.captureCount === 0
            && completion.captures.length === 0
            && completion.releasePreparations.length === 0
            && completion.cleanups.length === 0
            && publish.runtime.retryMode === false
            && publish.runtime.retryOriginTick === 0
            && publish.runtime.requiresRecovery === false
            && afterSubmit.every((pair) => (
                candidateIsCleared(pair.captor.candidate)
                && candidateIsCleared(pair.projectile.candidate)
            ))
            && director.getStatus().capturedProjectileCount === 0
            && endpoint.requiresRecovery() === false
            && director.requiresRecovery() === false,
        `${prefix}: old backlog crossed generation ${JSON.stringify({
            completion,
            runtime: publish.runtime
        })}`);
        return Object.freeze({
            oldRejectedDemandCount:
                oldSeed.rejected.captures.captureDemandCount,
            oldRejectionInvariant: oldSeed.rejectionInvariant,
            oldRuntimeTuple: Object.freeze({
                sessionGeneration: oldSeed.runtime.sessionGeneration,
                deviceGeneration: oldSeed.runtime.deviceGeneration,
                authoritativeEpoch: oldSeed.runtime.authoritativeEpoch
            }),
            oldRetryModeBeforeRollover: oldSeed.runtime.retryMode,
            stalePortRequest: Object.freeze({ ...stalePortRequest }),
            newRuntimeTuple: Object.freeze({
                sessionGeneration: newRuntimeAtStart.sessionGeneration,
                deviceGeneration: newRuntimeAtStart.deviceGeneration,
                authoritativeEpoch: newRuntimeAtStart.authoritativeEpoch
            }),
            sessionGenerationAdvanced:
                newRuntimeAtStart.sessionGeneration
                    !== oldSeed.runtime.sessionGeneration,
            numericHandlesRepeated: true,
            oldBacklogCleared: newRuntimeAtStart.retryMode === false
                && newRuntimeAtStart.retryOriginTick === 0,
            newGenerationCaptureCount: completion.captures.length,
            bilateralInvariant,
            finalRuntimeStatus: publish.runtime,
            directorStatus: director.getStatus(),
            recoveryRequired: endpoint.requiresRecovery()
                || director.requiresRecovery()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runReleasePreparationCapacityRetry(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const endpoint = createEndpoint(device, format, 8, null, null, Object.freeze({
        projectileCaptureCompletionCapacity: 2,
        projectileCaptureReleasePreparationCapacity: 1,
        projectileCaptureCleanupCapacity: 2
    }));
    let director = null;
    try {
        initializeEndpoint(endpoint, tileMap, 'release-capacity');
        director = createDirector(endpoint);
        assert(endpoint.requestSpawnBatch([0, 1].flatMap((index) => ([{
            intent: createRingIntent(route, index + 1, {
                x: 4,
                y: 4 + (index * 2)
            }),
            targetFixedTick: 1,
            commandId: `release-capacity:ring:${index}`
        }, {
            intent: createBulletIntent(
                { x: 4.3, y: 4 + (index * 2) },
                { x: -1, y: 0 },
                { spawnSequence: index + 1 }
            ),
            targetFixedTick: 1,
            commandId: `release-capacity:held:${index}`
        }]))).accepted, 'release-capacity seed rejected');
        const tick1 = await advanceTick({
            endpoint,
            director,
            tick: 1,
            label: 'release-capacity T1'
        });
        const ringHandles = [0, 1].map((index) => requireSpawnHandle(
            tick1.lifecycle,
            `release-capacity:ring:${index}`
        ));
        const projectileHandles = [0, 1].map((index) => requireSpawnHandle(
            tick1.lifecycle,
            `release-capacity:held:${index}`
        ));
        assert(endpoint.requestSpawnBatch(ringHandles.map((handle, index) => ({
            intent: createLethalEnemyHitIntent(findBody(
                tick1.bodies,
                handle,
                `release-capacity R ${index}`
            ), {
                definitionId: `nw-ring-release-capacity-lethal-${index}`,
                spawnSequence: index + 3
            }),
            targetFixedTick: 2,
            commandId: `release-capacity:lethal:${index}`
        }))).accepted, 'release-capacity lethal batch rejected');
        let beforePlanes = null;
        let metadataBefore = null;
        const tick2 = await advanceTick({
            endpoint,
            director,
            tick: 2,
            label: 'release-capacity T2 rejection submit',
            async afterCommit() {
                beforePlanes = Object.freeze(await Promise.all([
                    ...ringHandles.map((handle, index) => readGpuCapturePlanes(
                        endpoint,
                        handle,
                        `release-capacity-before-ring-${index}`
                    )),
                    ...projectileHandles.map(
                        (handle, index) => readGpuCapturePlanes(
                            endpoint,
                            handle,
                            `release-capacity-before-projectile-${index}`
                        )
                    )
                ]));
                metadataBefore = Object.freeze(projectileHandles.map(
                    (handle, index) => copyRegistryView(
                        endpoint,
                        handle,
                        `release-capacity metadata before ${index}`
                    )
                ));
            }
        });
        assert(tick2.boundary.captures.captures.length === 2,
            'release-capacity initial captures missing');
        const afterPlanes = Object.freeze(await Promise.all([
            ...ringHandles.map((handle, index) => readGpuCapturePlanes(
                endpoint,
                handle,
                `release-capacity-after-ring-${index}`
            )),
            ...projectileHandles.map((handle, index) => readGpuCapturePlanes(
                endpoint,
                handle,
                `release-capacity-after-projectile-${index}`
            ))
        ]));
        const metadataAfter = Object.freeze(projectileHandles.map(
            (handle, index) => copyRegistryView(
                endpoint,
                handle,
                `release-capacity metadata after ${index}`
            )
        ));
        const rejection = drainCaptureBoundary(endpoint, director, 3);
        assert(rejection.captures.capacityRejected === true
            && rejection.captures.retryable === true
            && rejection.captures.captureDemandCount === 0
            && rejection.captures.releasePreparationDemandCount === 2
            && rejection.captures.releasePreparationCapacity === 1
            && rejection.captures.cleanupDemandCount === 0
            && rejection.captures.captures.length === 0
            && rejection.captures.releasePreparations.length === 0
            && rejection.captures.cleanups.length === 0,
        `release-capacity rejection mismatch ${JSON.stringify({
            captures: rejection.captures,
            events: rejection.events
        })}`);
        assert(JSON.stringify(afterPlanes.map((plane) => plane.gpu.state))
                === JSON.stringify(beforePlanes.map((plane) => plane.gpu.state)),
        'release-capacity rejection mutated CaptureState');
        assert(metadataAfter.every((view, index) => (
            view.metadataRevision === metadataBefore[index].metadataRevision
            && JSON.stringify(view.metadata)
                === JSON.stringify(metadataBefore[index].metadata)
        )), 'release-capacity rejection mutated registry metadata');
        const rejectedBodies = projectileHandles.map((handle, index) => findBody(
            tick2.bodies,
            handle,
            `release-capacity rejected held ${index}`
        ));
        assert(rejectedBodies.every((body, index) => {
            const captorPosition = afterPlanes[index].gpu.physics.position;
            return (body.simulationMeta
                    & GPU_CIRCLE_BODY_SIMULATION_FLAG.PROJECTILE_CAPTURED) !== 0
                && Math.hypot(
                    body.position.x - captorPosition.x,
                    body.position.y - captorPosition.y
                ) <= 0.0001;
        }), 'release-capacity rejection broke held pose/flag maintenance');
        const retrySubmitOne = await advanceTick({
            endpoint,
            director,
            tick: 3,
            label: 'release-capacity retry 1 submit'
        });
        const retrySubmitTwo = await advanceTick({
            endpoint,
            director,
            tick: 4,
            label: 'release-capacity retry 2 submit'
        });
        const retryPublishTwo = await advanceTick({
            endpoint,
            director,
            tick: 5,
            label: 'release-capacity retry 2 publish'
        });
        const retryComplete = await advanceTick({
            endpoint,
            director,
            tick: 6,
            label: 'release-capacity releases complete'
        });
        const firstRetry = retrySubmitTwo.boundary.captures;
        const secondRetry = retryPublishTwo.boundary.captures;
        const releaseCompletions = [
            ...retryPublishTwo.boundary.releases.releaseCompletions,
            ...retryComplete.boundary.releases.releaseCompletions
        ];
        assert(retrySubmitOne.runtime.retryMode === true
            && firstRetry.retryBatch === true
            && firstRetry.retryBacklogRemaining === true
            && firstRetry.releasePreparations.length === 1
            && secondRetry.retryBatch === true
            && secondRetry.retryBacklogRemaining === false
            && secondRetry.releasePreparations.length === 1
            && retryPublishTwo.runtime.retryMode === false
            && releaseCompletions.length === 2
            && director.getStatus().capturedProjectileCount === 0
            && ringHandles.every((handle) => !endpoint.getRegistry().has(handle))
            && endpoint.requiresRecovery() === false
            && director.requiresRecovery() === false,
        `release-capacity bounded retry mismatch ${JSON.stringify({
            firstRetry,
            secondRetry,
            releaseCompletions,
            director: director.getStatus()
        })}`);
        return Object.freeze({
            capacityRejected: true,
            releasePreparationDemandCount:
                rejection.captures.releasePreparationDemandCount,
            releasePreparationCapacity:
                rejection.captures.releasePreparationCapacity,
            stateUnchanged: true,
            metadataUnchanged: true,
            heldPoseMaintained: true,
            firstRetry: Object.freeze({
                backlogRemaining: firstRetry.retryBacklogRemaining,
                records: Object.freeze(
                    firstRetry.releasePreparations.map(snapshotCaptureRecord)
                )
            }),
            secondRetry: Object.freeze({
                backlogRemaining: secondRetry.retryBacklogRemaining,
                records: Object.freeze(
                    secondRetry.releasePreparations.map(snapshotCaptureRecord)
                )
            }),
            releaseCompletions: Object.freeze(
                releaseCompletions.map(snapshotCaptureRecord)
            ),
            finalCapturedProjectileCount:
                director.getStatus().capturedProjectileCount,
            captorRegistryCount:
                ringHandles.filter((handle) => endpoint.getRegistry().has(handle))
                    .length,
            recoveryRequired: endpoint.requiresRecovery()
                || director.requiresRecovery()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runCleanupCapacityRetry(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const endpoint = createEndpoint(device, format, 5, null, null, Object.freeze({
        projectileCaptureCompletionCapacity: 2,
        projectileCaptureReleasePreparationCapacity: 2,
        projectileCaptureCleanupCapacity: 1
    }));
    let director = null;
    try {
        initializeEndpoint(endpoint, tileMap, 'cleanup-capacity');
        director = createDirector(endpoint);
        assert(endpoint.requestSpawnBatch([0, 1].flatMap((index) => ([{
            intent: createRingIntent(route, index + 1, {
                x: 4,
                y: 4 + (index * 2)
            }),
            targetFixedTick: 1,
            commandId: `cleanup-capacity:ring:${index}`
        }, {
            intent: createBulletIntent(
                { x: 4.3, y: 4 + (index * 2) },
                { x: -1, y: 0 },
                {
                    definitionId: `nw-ring-cleanup-capacity-held-${index}`,
                    lifetimeSeconds: FIXED_DELTA * 1.5,
                    spawnSequence: index + 1
                }
            ),
            targetFixedTick: 1,
            commandId: `cleanup-capacity:projectile:${index}`
        }]))).accepted, 'cleanup-capacity seed rejected');
        let ringHandles = null;
        let projectileHandles = null;
        const tick1 = await advanceTick({
            endpoint,
            director,
            tick: 1,
            label: 'cleanup-capacity T1',
            afterCommit(lifecycle) {
                ringHandles = [0, 1].map((index) => requireSpawnHandle(
                    lifecycle,
                    `cleanup-capacity:ring:${index}`
                ));
                projectileHandles = [0, 1].map((index) => requireSpawnHandle(
                    lifecycle,
                    `cleanup-capacity:projectile:${index}`
                ));
            }
        });
        let beforePlanes = null;
        let metadataBefore = null;
        const tick2 = await advanceTick({
            endpoint,
            director,
            tick: 2,
            label: 'cleanup-capacity T2 rejection submit',
            async afterCommit() {
                beforePlanes = Object.freeze(await Promise.all([
                    ...ringHandles.map((handle, index) => readGpuCapturePlanes(
                        endpoint,
                        handle,
                        `cleanup-capacity-before-ring-${index}`
                    )),
                    ...projectileHandles.map(
                        (handle, index) => readGpuCapturePlanes(
                            endpoint,
                            handle,
                            `cleanup-capacity-before-projectile-${index}`
                        )
                    )
                ]));
                metadataBefore = Object.freeze(projectileHandles.map(
                    (handle, index) => copyRegistryView(
                        endpoint,
                        handle,
                        `cleanup-capacity metadata before ${index}`
                    )
                ));
            }
        });
        assert(tick2.boundary.captures.captures.length === 2,
            'cleanup-capacity initial captures missing');
        const afterPlanes = Object.freeze(await Promise.all([
            ...ringHandles.map((handle, index) => readGpuCapturePlanes(
                endpoint,
                handle,
                `cleanup-capacity-after-ring-${index}`
            )),
            ...projectileHandles.map((handle, index) => readGpuCapturePlanes(
                endpoint,
                handle,
                `cleanup-capacity-after-projectile-${index}`
            ))
        ]));
        const metadataAfter = Object.freeze(projectileHandles.map(
            (handle, index) => copyRegistryView(
                endpoint,
                handle,
                `cleanup-capacity metadata after ${index}`
            )
        ));
        const rejection = drainCaptureBoundary(endpoint, director, 3);
        assert(rejection.captures.capacityRejected === true
            && rejection.captures.retryable === true
            && rejection.captures.captureDemandCount === 0
            && rejection.captures.releasePreparationDemandCount === 0
            && rejection.captures.cleanupDemandCount === 2
            && rejection.captures.cleanupCapacity === 1
            && rejection.captures.captures.length === 0
            && rejection.captures.releasePreparations.length === 0
            && rejection.captures.cleanups.length === 0,
        `cleanup-capacity rejection mismatch ${JSON.stringify(
            rejection.captures
        )}`);
        assert(JSON.stringify(afterPlanes.map((plane) => plane.gpu.state))
                === JSON.stringify(beforePlanes.map((plane) => plane.gpu.state)),
        'cleanup-capacity rejection mutated CaptureState');
        assert(metadataAfter.every((view, index) => (
            view.metadataRevision === metadataBefore[index].metadataRevision
            && JSON.stringify(view.metadata)
                === JSON.stringify(metadataBefore[index].metadata)
        )), 'cleanup-capacity rejection mutated registry metadata');
        assert(projectileHandles.every((_handle, index) => {
            const captorPosition = afterPlanes[index].gpu.physics.position;
            const projectilePlane = afterPlanes[2 + index].gpu;
            return (projectilePlane.simulation.flags
                    & GPU_CIRCLE_BODY_SIMULATION_FLAG.PROJECTILE_CAPTURED) !== 0
                && projectilePlane.simulation.lifetime === 0
                && Math.hypot(
                    projectilePlane.physics.position.x - captorPosition.x,
                    projectilePlane.physics.position.y - captorPosition.y
                ) <= 0.0001;
        }), 'cleanup-capacity rejection broke held expiry pose/flag/lifetime');
        const retrySubmitOne = await advanceTick({
            endpoint,
            director,
            tick: 3,
            label: 'cleanup-capacity retry 1 submit'
        });
        const retrySubmitTwo = await advanceTick({
            endpoint,
            director,
            tick: 4,
            label: 'cleanup-capacity retry 2 submit'
        });
        const retryComplete = await advanceTick({
            endpoint,
            director,
            tick: 5,
            label: 'cleanup-capacity retry complete'
        });
        const firstRetry = retrySubmitTwo.boundary.captures;
        const secondRetry = retryComplete.boundary.captures;
        assert(retrySubmitOne.runtime.retryMode === true
            && firstRetry.retryBatch === true
            && firstRetry.retryBacklogRemaining === true
            && firstRetry.cleanups.length === 1
            && secondRetry.retryBatch === true
            && secondRetry.retryBacklogRemaining === false
            && secondRetry.cleanups.length === 1
            && retryComplete.runtime.retryMode === false
            && director.getStatus().capturedProjectileCount === 0
            && projectileHandles.every(
                (handle) => !endpoint.getRegistry().has(handle)
            )
            && endpoint.requiresRecovery() === false
            && director.requiresRecovery() === false,
        `cleanup-capacity bounded retry mismatch ${JSON.stringify({
            firstRetry,
            secondRetry,
            director: director.getStatus()
        })}`);
        return Object.freeze({
            capacityRejected: true,
            cleanupDemandCount: rejection.captures.cleanupDemandCount,
            cleanupCapacity: rejection.captures.cleanupCapacity,
            stateUnchanged: true,
            metadataUnchanged: true,
            heldExpiryPoseMaintained: true,
            firstRetry: Object.freeze({
                backlogRemaining: firstRetry.retryBacklogRemaining,
                records: Object.freeze(
                    firstRetry.cleanups.map(snapshotCaptureRecord)
                )
            }),
            secondRetry: Object.freeze({
                backlogRemaining: secondRetry.retryBacklogRemaining,
                records: Object.freeze(
                    secondRetry.cleanups.map(snapshotCaptureRecord)
                )
            }),
            finalCapturedProjectileCount:
                director.getStatus().capturedProjectileCount,
            projectileRegistryCount: projectileHandles.filter(
                (handle) => endpoint.getRegistry().has(handle)
            ).length,
            recoveryRequired: endpoint.requiresRecovery()
                || director.requiresRecovery()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runFunnelAndMutualSelection(device, format) {
    const inside = await runFunnelCase(
        device,
        format,
        'funnel-inside-inbound',
        0,
        'inbound'
    );
    const boundary = await runFunnelCase(
        device,
        format,
        'funnel-boundary',
        Math.PI / 4,
        'inbound'
    );
    const outside = await runFunnelCase(
        device,
        format,
        'funnel-outside',
        (Math.PI / 4) + 0.08,
        'inbound'
    );
    const insideOutbound = await runFunnelCase(
        device,
        format,
        'funnel-inside-outbound',
        0,
        'outbound'
    );
    assert(inside.captureRecords.length === 1,
        'inside funnel did not capture');
    assert(boundary.captureRecords.length === 1,
        'inclusive boundary did not capture');
    assert(outside.captureRecords.length === 0,
        'outside funnel captured');
    assert(insideOutbound.captureRecords.length === 0,
        'inside outbound overlap captured');
    return Object.freeze({
        inside,
        boundary,
        outside,
        insideOutbound,
        oneCaptorTwoProjectiles:
            await runOneCaptorTwoProjectiles(device, format),
        twoCaptorsOneProjectile:
            await runTwoCaptorsOneProjectile(device, format)
    });
}

function copyOriginMetadata(metadata) {
    const result = Object.create(null);
    for (const key of PROJECTILE_ORIGIN_PROVENANCE_KEYS) {
        result[key] = metadata[key];
    }
    return Object.freeze(result);
}

function copyReleaseMetadata(metadata) {
    return Object.freeze({
        teamId: metadata.teamId,
        allegiancePolicy: metadata.allegiancePolicy,
        damagePolicyId: metadata.damagePolicyId,
        ownerEntityId: metadata.ownerEntityId,
        ownerIncarnation: metadata.ownerIncarnation,
        sourceEntityId: metadata.sourceEntityId,
        sourceIncarnation: metadata.sourceIncarnation,
        targetEntityId: metadata.targetEntityId,
        targetIncarnation: metadata.targetIncarnation,
        targetPolicyId: metadata.targetPolicyId,
        projectileCapturePolicyId: metadata.projectileCapturePolicyId
    });
}

function copyEventEvidence(snapshot) {
    return Object.freeze((snapshot?.events ?? []).map((event) => Object.freeze({
        type: event.type,
        eventType: event.eventType,
        entityId: event.entityId,
        incarnation: event.incarnation,
        other: event.other ? copyHandle(event.other) : null,
        sessionGeneration: event.sessionGeneration,
        deviceGeneration: event.deviceGeneration,
        authoritativeEpoch: event.authoritativeEpoch,
        sourceTick: event.sourceTick,
        damageFixedPoint: event.damageFixedPoint,
        disposition: event.disposition
    })));
}

async function renderHeldRingCenter(
    endpoint,
    device,
    texture,
    width,
    height,
    ringBody
) {
    endpoint.updatePresentation({
        frameDelta: 0,
        fixedDelta: FIXED_DELTA,
        fixedAlpha: 1,
        renderFrameId: 1
    });
    const scale = 48;
    const camera = Object.freeze({
        worldToViewport(x, y, out) {
            out.x = (width * 0.5) + ((x - ringBody.position.x) * scale);
            out.y = (height * 0.5) + ((y - ringBody.position.y) * scale);
            return out;
        },
        getScale: () => scale
    });
    assert(endpoint.draw(camera), 'held projectile render draw failed');
    await device.queue.onSubmittedWorkDone();
    const frame = await readTexturePixels(device, texture, width, height);
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const radiusPixels = ringBody.radius * scale;
    const innerBandRadius = radiusPixels * 0.45;
    const outerBandRadius = radiusPixels * 1.35;
    let ringBandAlpha = 0;
    for (let y = Math.floor(centerY - outerBandRadius);
        y <= Math.ceil(centerY + outerBandRadius); y += 1) {
        for (let x = Math.floor(centerX - outerBandRadius);
            x <= Math.ceil(centerX + outerBandRadius); x += 1) {
            const distance = Math.hypot(x - centerX, y - centerY);
            if (distance < innerBandRadius || distance > outerBandRadius) {
                continue;
            }
            ringBandAlpha = Math.max(ringBandAlpha, alphaAt(frame, x, y));
        }
    }
    return Object.freeze({
        centerAlpha: alphaAt(frame, centerX, centerY),
        ringBandAlpha,
        width,
        height,
        scale
    });
}

async function runReleaseRoundTrip(device, format, { withTower, render }) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const width = 160;
    const height = 160;
    const texture = render ? device.createTexture({
        label: 'cirvivor-nw-ring-held-render-target',
        size: [width, height],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    }) : null;
    const frameTarget = texture ? Object.freeze({
        device,
        deviceGeneration: 1,
        texture,
        view: texture.createView(),
        format,
        width,
        height
    }) : null;
    const endpoint = createEndpoint(device, format, 5, frameTarget);
    let director = null;
    const prefix = withTower ? 'release-tower' : 'release-forward';
    try {
        initializeEndpoint(endpoint, tileMap, prefix);
        director = createDirector(endpoint);
        let towerHandle = null;
        let firstTick = 1;
        if (withTower) {
            assert(endpoint.requestSpawn(
                createGpuTowerSpawnIntent({ position: { x: 7, y: 4 } }),
                1,
                `${prefix}:tower`
            ).accepted, `${prefix}: Tower spawn rejected`);
            const towerTick = await advanceTick({
                endpoint,
                director,
                tick: 1,
                label: `${prefix} Tower T1`
            });
            towerHandle = requireSpawnHandle(
                towerTick.lifecycle,
                `${prefix}:tower`
            );
            assert(endpoint.configureTowerGameplayTarget(towerHandle).accepted,
                `${prefix}: Tower target rejected`);
            firstTick = 2;
        }
        const ringPosition = Object.freeze({ x: 4, y: 4 });
        const captureRequests = [{
            intent: createRingIntent(route, 1, ringPosition),
            targetFixedTick: firstTick,
            commandId: `${prefix}:ring`
        }, {
            intent: createBulletIntent(
                { x: 4.3, y: 4 },
                { x: -1, y: 0 },
                {
                    spawnSequence: 1,
                    ownerHandle: towerHandle,
                    sourceHandle: towerHandle
                }
            ),
            targetFixedTick: firstTick,
            commandId: `${prefix}:projectile`
        }];
        assert(endpoint.requestSpawnBatch(captureRequests).accepted,
            `${prefix}: capture spawn batch rejected`);
        let captorHandle = null;
        let projectileHandle = null;
        let coreProxyHandle = null;
        let preCaptureProjectileBody = null;
        const captureSubmit = await advanceTick({
            endpoint,
            director,
            tick: firstTick,
            towerTargetHandle: towerHandle,
            label: `${prefix} capture submit`,
            async afterCommit(lifecycle) {
                captorHandle = requireSpawnHandle(
                    lifecycle,
                    `${prefix}:ring`
                );
                projectileHandle = requireSpawnHandle(
                    lifecycle,
                    `${prefix}:projectile`
                );
                coreProxyHandle = null;
                preCaptureProjectileBody = copyBody(findBody(
                    await readBodies(endpoint),
                    projectileHandle,
                    `${prefix} pre-capture projectile`
                ));
            }
        });
        assert(captorHandle && projectileHandle && preCaptureProjectileBody,
            `${prefix}: pre-capture GPU evidence missing`);
        const capturedCaptorBody = copyBody(findBody(
            captureSubmit.bodies,
            captorHandle,
            `${prefix} captured R`
        ));
        const capturedProjectileBody = copyBody(findBody(
            captureSubmit.bodies,
            projectileHandle,
            `${prefix} captured projectile`
        ));
        const capturedCaptorAudit = copyCaptureBodyAudit(
            endpoint,
            captorHandle,
            `${prefix} captured R audit`
        );
        const capturedProjectileAudit = copyCaptureBodyAudit(
            endpoint,
            projectileHandle,
            `${prefix} captured projectile audit`
        );
        const metadataBefore = copyRegistryView(
            endpoint,
            projectileHandle,
            `${prefix} before release`
        );
        const renderEvidence = texture
            ? await renderHeldRingCenter(
                endpoint,
                device,
                texture,
                width,
                height,
                capturedCaptorBody
            )
            : null;
        const observedCapture = await advanceTick({
            endpoint,
            director,
            tick: firstTick + 1,
            towerTargetHandle: towerHandle,
            label: `${prefix} capture observation`
        });
        const captureRecords = observedCapture.boundary.captures.captures ?? [];
        assert(captureRecords.length === 1,
            `${prefix}: authentic capture completion missing`);
        const captureRecord = captureRecords[0];
        const releaseTick = firstTick
            + RING_PROJECTILE_CAPTURE_DELAY_FIXED_TICKS;
        assert(releaseTick === firstTick
                + RING_PROJECTILE_CAPTURE_DELAY_FIXED_TICKS,
            `${prefix}: release due tick mismatch`);
        let heldSample = observedCapture;
        let heldCaptorAudit = null;
        let heldProjectileAudit = null;
        for (let tick = firstTick + 2; tick < releaseTick; tick++) {
            const progressed = await advanceTick({
                endpoint,
                director,
                tick,
                towerTargetHandle: towerHandle,
                label: `${prefix} held T${tick}`
            });
            if (tick === firstTick + 10) {
                heldSample = progressed;
                heldCaptorAudit = copyCaptureBodyAudit(
                    endpoint,
                    captorHandle,
                    `${prefix} held R audit`
                );
                heldProjectileAudit = copyCaptureBodyAudit(
                    endpoint,
                    projectileHandle,
                    `${prefix} held projectile audit`
                );
            }
        }
        const heldCaptorBody = copyBody(findBody(
            heldSample.bodies,
            captorHandle,
            `${prefix} held R`
        ));
        const heldProjectileBody = copyBody(findBody(
            heldSample.bodies,
            projectileHandle,
            `${prefix} held projectile`
        ));
        assert(heldCaptorAudit && heldProjectileAudit,
            `${prefix}: held body audit sample missing`);
        let preReleaseCaptorBody = null;
        const releaseSubmit = await advanceTick({
            endpoint,
            director,
            tick: releaseTick,
            towerTargetHandle: towerHandle,
            label: `${prefix} release publication`,
            async afterCommit() {
                preReleaseCaptorBody = copyBody(findBody(
                    await readBodies(endpoint),
                    captorHandle,
                    `${prefix} pre-release R`
                ));
            }
        });
        const preparations = releaseSubmit.boundary.captures
            .releasePreparations ?? [];
        assert(preparations.length === 1,
            `${prefix}: release preparation missing`);
        assert(preparations[0].prepareEvidence?.releaseDueFixedTick
                === releaseTick,
            `${prefix}: release due evidence mismatch`);
        const lifecycleRelease = releaseSubmit.lifecycle
            .projectileCaptureReleases?.[0];
        assert(lifecycleRelease
            && exactHandle(lifecycleRelease.projectileHandle, projectileHandle),
        `${prefix}: lifecycle release missing`);
        const metadataAfter = copyRegistryView(
            endpoint,
            projectileHandle,
            `${prefix} after release`
        );
        const releasedProjectileBody = copyBody(findBody(
            releaseSubmit.bodies,
            projectileHandle,
            `${prefix} released projectile`
        ));
        const releasedCaptorBody = copyBody(findBody(
            releaseSubmit.bodies,
            captorHandle,
            `${prefix} released R`
        ));
        const releasedProjectileAudit = copyCaptureBodyAudit(
            endpoint,
            projectileHandle,
            `${prefix} released projectile audit`
        );
        const completionTick = await advanceTick({
            endpoint,
            director,
            tick: releaseTick + 1,
            towerTargetHandle: towerHandle,
            label: `${prefix} release completion`
        });
        const releaseCompletions = completionTick.boundary.releases
            .releaseCompletions ?? [];
        assert(releaseCompletions.length === 1
            && exactHandle(
                releaseCompletions[0].projectileHandle,
                projectileHandle
            ), `${prefix}: release completion missing`);
        assert(director.getStatus().capturedProjectileCount === 0,
            `${prefix}: director slot not cleared`);
        return Object.freeze({
            withTower,
            captorHandle: copyHandle(captorHandle),
            projectileHandle: copyHandle(projectileHandle),
            towerHandle: towerHandle ? copyHandle(towerHandle) : null,
            coreProxyHandle: coreProxyHandle
                ? copyHandle(coreProxyHandle)
                : null,
            captureRecord: snapshotCaptureRecord(captureRecord),
            releasePreparation: snapshotCaptureRecord(preparations[0]),
            lifecycleRelease: Object.freeze({
                projectileHandle: copyHandle(lifecycleRelease.projectileHandle),
                captorHandle: copyHandle(lifecycleRelease.captorHandle),
                captureSequence: lifecycleRelease.captureSequence,
                releaseReason: lifecycleRelease.releaseReason,
                commandIdFingerprint:
                    lifecycleRelease.commandIdFingerprint,
                batchIdFingerprint: lifecycleRelease.batchIdFingerprint,
                prepareFingerprint: lifecycleRelease.prepareFingerprint,
                prepareSourceTick: lifecycleRelease.prepareSourceTick,
                targetFixedTick: lifecycleRelease.targetFixedTick,
                targetHandle: lifecycleRelease.targetHandle
                    ? copyHandle(lifecycleRelease.targetHandle)
                    : null,
                metadataRevision: lifecycleRelease.metadataRevision,
                backendCommitRequested:
                    lifecycleRelease.backendCommitRequested
            }),
            releaseCompletion: snapshotCaptureRecord(releaseCompletions[0]),
            preCaptureProjectileBody,
            capturedCaptorBody,
            capturedProjectileBody,
            capturedCaptorAudit,
            capturedProjectileAudit,
            heldCaptorBody,
            heldProjectileBody,
            heldCaptorAudit,
            heldProjectileAudit,
            preReleaseCaptorBody,
            releasedCaptorBody,
            releasedProjectileBody,
            releasedProjectileAudit,
            captureTickEvents: copyEventEvidence(
                observedCapture.boundary.events
            ),
            metadataBefore: Object.freeze({
                ...metadataBefore,
                origin: copyOriginMetadata(metadataBefore.metadata),
                releaseFields: copyReleaseMetadata(metadataBefore.metadata)
            }),
            metadataAfter: Object.freeze({
                ...metadataAfter,
                origin: copyOriginMetadata(metadataAfter.metadata),
                releaseFields: copyReleaseMetadata(metadataAfter.metadata)
            }),
            render: renderEvidence,
            finalDirectorStatus: director.getStatus(),
            finalRuntimeStatus: completionTick.runtime
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
        texture?.destroy();
    }
}

async function runCaptorExitRelease(device, format, mode) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    let coreBinding = null;
    const endpoint = createEndpoint(
        device,
        format,
        6,
        null,
        mode === 'core-impact'
            ? (binding) => { coreBinding = binding; }
            : null
    );
    let director = null;
    let coreDirector = null;
    const prefix = `captor-${mode}`;
    try {
        initializeEndpoint(endpoint, tileMap, prefix);
        director = createDirector(endpoint);
        if (mode === 'core-impact') {
            assert(coreBinding?.port, `${prefix}: Core cleanup port missing`);
            coreDirector = new EnemyCoreImpactDirector({
                coreIntegrity: new CoreIntegrity({ maxIntegrity: 100 }),
                endpoint,
                coreImpactCleanupPort: coreBinding.port
            });
        }
        assert(endpoint.requestSpawnBatch([{
            intent: createRingIntent(route, 1, { x: 4, y: 4 }),
            targetFixedTick: 1,
            commandId: `${prefix}:ring`
        }, {
            intent: createBulletIntent(
                { x: 4.3, y: 4 },
                { x: -1, y: 0 },
                { spawnSequence: 1 }
            ),
            targetFixedTick: 1,
            commandId: `${prefix}:held`
        }]).accepted, `${prefix}: seed batch rejected`);
        const tick1 = await advanceTick({
            endpoint,
            director,
            coreDirector,
            tick: 1,
            label: `${prefix} T1`
        });
        const captorHandle = requireSpawnHandle(
            tick1.lifecycle,
            `${prefix}:ring`
        );
        const projectileHandle = requireSpawnHandle(
            tick1.lifecycle,
            `${prefix}:held`
        );
        const captorBody = findBody(tick1.bodies, captorHandle, `${prefix} R`);
        const interventionIntent = mode === 'core-impact'
            ? createGpuCoreProxySpawnIntent({ position: captorBody.position })
            : createLethalEnemyHitIntent(captorBody, {
                definitionId: 'nw-ring-non-capturable-lethal-projectile',
                spawnSequence: 2
            });
        assert(endpoint.requestSpawn(
            interventionIntent,
            2,
            `${prefix}:intervention`
        ).accepted, `${prefix}: intervention rejected`);
        const tick2 = await advanceTick({
            endpoint,
            director,
            coreDirector,
            tick: 2,
            label: `${prefix} T2`
        });
        const interventionHandle = requireSpawnHandle(
            tick2.lifecycle,
            `${prefix}:intervention`
        );
        const captureRecords = tick2.boundary.captures.captures ?? [];
        assert(captureRecords.length === 1,
            `${prefix}: capture completion missing`);
        const preparedCaptorAudit = copyCaptureBodyAudit(
            endpoint,
            captorHandle,
            `${prefix} prepared R audit`
        );
        const preparedProjectileAudit = copyCaptureBodyAudit(
            endpoint,
            projectileHandle,
            `${prefix} prepared projectile audit`
        );
        const tick3 = await advanceTick({
            endpoint,
            director,
            coreDirector,
            tick: 3,
            label: `${prefix} T3 release publication`
        });
        const preparations = tick3.boundary.captures.releasePreparations ?? [];
        assert(preparations.length === 1,
            `${prefix}: same-tick release preparation missing`);
        const expectedReason = mode === 'core-impact'
            ? GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT
            : GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_DEATH;
        assert((preparations[0].releaseReason ?? preparations[0].reason)
                === expectedReason,
            `${prefix}: release reason mismatch ${JSON.stringify(preparations[0])}`);
        const lifecycleRelease = tick3.lifecycle.projectileCaptureReleases?.[0];
        assert(lifecycleRelease
            && lifecycleRelease.releaseReason === expectedReason,
        `${prefix}: lifecycle release mismatch`);
        const releasedBody = copyBody(findBody(
            tick3.bodies,
            projectileHandle,
            `${prefix} released projectile`
        ));
        const releasedAudit = copyCaptureBodyAudit(
            endpoint,
            projectileHandle,
            `${prefix} released projectile audit`
        );
        const tick4 = await advanceTick({
            endpoint,
            director,
            coreDirector,
            tick: 4,
            label: `${prefix} T4 completion`
        });
        const releaseCompletions = tick4.boundary.releases
            .releaseCompletions ?? [];
        assert(releaseCompletions.length === 1,
            `${prefix}: release completion missing`);
        return Object.freeze({
            mode,
            captorHandle: copyHandle(captorHandle),
            projectileHandle: copyHandle(projectileHandle),
            interventionHandle: copyHandle(interventionHandle),
            captureRecord: snapshotCaptureRecord(captureRecords[0]),
            releasePreparation: snapshotCaptureRecord(preparations[0]),
            lifecycleRelease: Object.freeze({
                projectileHandle: copyHandle(lifecycleRelease.projectileHandle),
                captorHandle: copyHandle(lifecycleRelease.captorHandle),
                captureSequence: lifecycleRelease.captureSequence,
                releaseReason: lifecycleRelease.releaseReason,
                commandIdFingerprint:
                    lifecycleRelease.commandIdFingerprint,
                batchIdFingerprint: lifecycleRelease.batchIdFingerprint,
                prepareFingerprint: lifecycleRelease.prepareFingerprint,
                prepareSourceTick: lifecycleRelease.prepareSourceTick,
                targetFixedTick: lifecycleRelease.targetFixedTick,
                targetHandle: lifecycleRelease.targetHandle
                    ? copyHandle(lifecycleRelease.targetHandle)
                    : null,
                metadataRevision: lifecycleRelease.metadataRevision,
                backendCommitRequested:
                    lifecycleRelease.backendCommitRequested
            }),
            releaseCompletion: snapshotCaptureRecord(releaseCompletions[0]),
            releasedBody,
            preparedCaptorAudit,
            preparedProjectileAudit,
            releasedAudit,
            eventEvidence: copyEventEvidence(tick3.boundary.events),
            directorBinding: DIRECTOR_BINDING.get(director).runtime,
            capturedProjectileCount:
                director.getStatus().capturedProjectileCount,
            registryHasCaptor: endpoint.getRegistry().has(captorHandle),
            registryHasProjectile: endpoint.getRegistry().has(projectileHandle),
            recoveryRequired: endpoint.requiresRecovery()
                || director.requiresRecovery()
                || coreDirector?.requiresRecovery?.() === true
        });
    } finally {
        coreDirector?.destroy?.();
        director?.destroy();
        endpoint.destroy();
    }
}

async function runHeldProjectileExpiry(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const endpoint = createEndpoint(device, format, 3);
    let director = null;
    try {
        initializeEndpoint(endpoint, tileMap, 'held-expiry');
        director = createDirector(endpoint);
        assert(endpoint.requestSpawnBatch([{
            intent: createRingIntent(route, 1, { x: 4, y: 4 }),
            targetFixedTick: 1,
            commandId: 'held-expiry:ring'
        }, {
            intent: createBulletIntent(
                { x: 4.3, y: 4 },
                { x: -1, y: 0 },
                {
                    definitionId: 'nw-ring-short-lived-projectile',
                    lifetimeSeconds: FIXED_DELTA * 1.5,
                    spawnSequence: 1
                }
            ),
            targetFixedTick: 1,
            commandId: 'held-expiry:projectile'
        }]).accepted, 'held-expiry seed rejected');
        const tick1 = await advanceTick({
            endpoint,
            director,
            tick: 1,
            label: 'held-expiry T1'
        });
        const captorHandle = requireSpawnHandle(
            tick1.lifecycle,
            'held-expiry:ring'
        );
        const projectileHandle = requireSpawnHandle(
            tick1.lifecycle,
            'held-expiry:projectile'
        );
        const heldBody = copyBody(findBody(
            tick1.bodies,
            projectileHandle,
            'held-expiry held projectile'
        ));
        const heldAudit = copyCaptureBodyAudit(
            endpoint,
            projectileHandle,
            'held-expiry held projectile audit'
        );
        const tick2 = await advanceTick({
            endpoint,
            director,
            tick: 2,
            label: 'held-expiry T2'
        });
        const captureRecords = tick2.boundary.captures.captures ?? [];
        assert(captureRecords.length === 1,
            'held-expiry capture completion missing');
        const tick3 = await advanceTick({
            endpoint,
            director,
            tick: 3,
            label: 'held-expiry T3 cleanup'
        });
        const cleanups = tick3.boundary.captures.cleanups ?? [];
        assert(cleanups.length === 1,
            `held-expiry cleanup missing ${JSON.stringify(tick3.boundary)}`);
        assert((tick3.lifecycle.projectileCaptureReleases ?? []).length === 0,
            'held-expiry incorrectly published release');
        return Object.freeze({
            captorHandle: copyHandle(captorHandle),
            projectileHandle: copyHandle(projectileHandle),
            heldBody,
            heldAudit,
            captureRecord: snapshotCaptureRecord(captureRecords[0]),
            cleanupRecord: snapshotCaptureRecord(cleanups[0]),
            lifecycleReleaseCount:
                tick3.lifecycle.projectileCaptureReleases?.length ?? 0,
            capturedProjectileCount:
                director.getStatus().capturedProjectileCount,
            registryHasProjectile: endpoint.getRegistry().has(projectileHandle),
            eventEvidence: copyEventEvidence(tick3.boundary.events),
            recoveryRequired: endpoint.requiresRecovery()
                || director.requiresRecovery()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function seedHeldPair(endpoint, director, route, prefix) {
    assert(endpoint.requestSpawnBatch([{
        intent: createRingIntent(route, 1, { x: 4, y: 4 }),
        targetFixedTick: 1,
        commandId: `${prefix}:ring`
    }, {
        intent: createBulletIntent(
            { x: 4.3, y: 4 },
            { x: -1, y: 0 },
            { spawnSequence: 1 }
        ),
        targetFixedTick: 1,
        commandId: `${prefix}:projectile`
    }]).accepted, `${prefix}: seed batch rejected`);
    const tick1 = await advanceTick({
        endpoint,
        director,
        tick: 1,
        label: `${prefix} T1`
    });
    const captorHandle = requireSpawnHandle(
        tick1.lifecycle,
        `${prefix}:ring`
    );
    const projectileHandle = requireSpawnHandle(
        tick1.lifecycle,
        `${prefix}:projectile`
    );
    const tick2 = await advanceTick({
        endpoint,
        director,
        tick: 2,
        label: `${prefix} T2`
    });
    const records = tick2.boundary.captures.captures ?? [];
    assert(records.length === 1, `${prefix}: capture completion missing`);
    return Object.freeze({
        captorHandle,
        projectileHandle,
        captureRecord: records[0],
        tick1,
        tick2
    });
}

async function runUnpublishedTerminal(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const endpoint = createEndpoint(device, format, 4);
    let director = null;
    try {
        initializeEndpoint(endpoint, tileMap, 'terminal-unpublished');
        director = createDirector(endpoint);
        const seeded = await seedHeldPair(
            endpoint,
            director,
            route,
            'terminal-unpublished'
        );
        const beforeBody = copyBody(findBody(
            seeded.tick2.bodies,
            seeded.projectileHandle,
            'terminal-unpublished held body'
        ));
        const beforeAudit = copyCaptureBodyAudit(
            endpoint,
            seeded.projectileHandle,
            'terminal-unpublished held audit'
        );
        const finalTick = 3;
        const preTerminalBoundary = drainCaptureBoundary(
            endpoint,
            director,
            finalTick
        );
        assert(preTerminalBoundary.captures.sourceTick === finalTick - 1
            && preTerminalBoundary.captures.pending === false,
        'terminal-unpublished pre-terminal boundary missing');
        director.closeForTerminal(finalTick, 'core-depleted');
        endpoint.closeGameplayIngress('core-depleted', finalTick);
        const lifecycle = assertBoundaryHealthy(
            endpoint.commitAtFixedBoundary(finalTick),
            'terminal-unpublished lifecycle'
        );
        director.observeFixedCommit(lifecycle, finalTick);
        director.observeLifecycle(lifecycle, finalTick);
        const finalSubmitted = endpoint.fixedUpdate(FIXED_DELTA, finalTick);
        const simulation = endpoint.getBackend().simulation;
        assert(finalSubmitted,
            `terminal-unpublished final submit failed ${JSON.stringify({
                endpointRecovery: endpoint.requiresRecovery(),
                runtime: endpoint.getProjectileCaptureRuntimeStatus(),
                terminal: endpoint
                    .getTerminalProjectileCaptureProgramCancelStatus(),
                terminalStates: {
                    fixed: simulation.terminalFixedProgramCancelStatus,
                    effect: simulation.terminalEffectProgramCancelStatus,
                    formation: simulation.terminalFormationProgramCancelStatus,
                    atomic: simulation.terminalAtomicTransformProgramCancelStatus,
                    capture:
                        simulation.terminalProjectileCaptureProgramCancelStatus,
                    route:
                        simulation.terminalRouteAvailabilityProgramCancelStatus
                },
                lifecycle
            })}`);
        await waitForSimulation(
            endpoint,
            'terminal-unpublished'
        );
        const terminalBoundary = drainCaptureBoundary(
            endpoint,
            director,
            finalTick
        );
        const bodies = await readBodies(endpoint);
        const body = bodies.find((candidate) => (
            candidate.entityId === seeded.projectileHandle.entityId
            && candidate.incarnation === seeded.projectileHandle.incarnation
        ));
        const terminal = endpoint
            .getTerminalProjectileCaptureProgramCancelStatus();
        const runtime = endpoint.getProjectileCaptureRuntimeStatus();
        const survivingCaptorAudit = copyCaptureBodyAudit(
            endpoint,
            seeded.captorHandle,
            'terminal-unpublished surviving captor audit'
        );
        return Object.freeze({
            finalFixedTick: finalTick,
            captorHandle: copyHandle(seeded.captorHandle),
            projectileHandle: copyHandle(seeded.projectileHandle),
            captureRecord: snapshotCaptureRecord(seeded.captureRecord),
            beforeBody,
            beforeAudit,
            survivingCaptorAudit,
            afterBody: body ? copyBody(body) : null,
            lifecycleReleaseCount:
                lifecycle.projectileCaptureReleases?.length ?? 0,
            registryHasProjectile:
                endpoint.getRegistry().has(seeded.projectileHandle),
            terminalBoundary: Object.freeze({
                captureSourceTick: terminalBoundary.captures.sourceTick,
                captureCompletedThroughTick:
                    terminalBoundary.captures.completedThroughTick,
                releaseSourceTick: terminalBoundary.releases.sourceTick,
                releaseCompletedThroughTick:
                    terminalBoundary.releases.completedThroughTick,
                captureCount:
                    terminalBoundary.captures.captures?.length ?? 0,
                releasePreparationCount:
                    terminalBoundary.captures.releasePreparations?.length ?? 0,
                cleanupCount:
                    terminalBoundary.captures.cleanups?.length ?? 0,
                releaseCompletionCount:
                    terminalBoundary.releases.releaseCompletions?.length ?? 0
            }),
            terminal,
            directorStatus: director.getStatus(),
            runtimeStatus: runtime,
            recoveryRequired: endpoint.requiresRecovery()
                || director.requiresRecovery()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runPublishedTerminal(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const endpoint = createEndpoint(device, format, 5);
    let director = null;
    try {
        initializeEndpoint(endpoint, tileMap, 'terminal-published');
        director = createDirector(endpoint);
        const seeded = await seedHeldPair(
            endpoint,
            director,
            route,
            'terminal-published'
        );
        const captorBody = findBody(
            seeded.tick2.bodies,
            seeded.captorHandle,
            'terminal-published R'
        );
        assert(endpoint.requestSpawn(
            createLethalEnemyHitIntent(captorBody, {
                definitionId:
                    'nw-ring-terminal-non-capturable-lethal-projectile',
                spawnSequence: 2
            }),
            3,
            'terminal-published:lethal'
        ).accepted, 'terminal-published lethal spawn rejected');
        const tick3 = await advanceTick({
            endpoint,
            director,
            tick: 3,
            label: 'terminal-published T3 death'
        });
        const lethalHandle = requireSpawnHandle(
            tick3.lifecycle,
            'terminal-published:lethal'
        );
        const boundary = drainCaptureBoundary(endpoint, director, 4);
        const preparations = boundary.captures.releasePreparations ?? [];
        assert(preparations.length === 1,
            'terminal-published release preparation missing');
        const preparedAudit = copyCaptureBodyAudit(
            endpoint,
            seeded.projectileHandle,
            'terminal-published prepared audit'
        );
        const stage = director.stageForFixedTick({ targetFixedTick: 4 });
        assert(stage.accepted === true && stage.releaseCount === 1,
            `terminal-published stage failed ${JSON.stringify(stage)}`);
        const lifecycle = assertBoundaryHealthy(
            endpoint.commitAtFixedBoundary(4),
            'terminal-published lifecycle'
        );
        director.observeFixedCommit(lifecycle, 4);
        director.observeLifecycle(lifecycle, 4);
        assert(lifecycle.projectileCaptureReleases?.length === 1,
            'terminal-published host release missing');
        const metadataAfterPublication = copyRegistryView(
            endpoint,
            seeded.projectileHandle,
            'terminal-published metadata'
        );
        director.closeForTerminal(4, 'core-depleted');
        endpoint.closeGameplayIngress('core-depleted', 4);
        assert(endpoint.fixedUpdate(FIXED_DELTA, 4),
            'terminal-published final submit failed');
        await waitForSimulation(endpoint, 'terminal-published');
        const terminalBoundary = drainCaptureBoundary(endpoint, director, 4);
        const bodies = await readBodies(endpoint);
        const projectileBody = copyBody(findBody(
            bodies,
            seeded.projectileHandle,
            'terminal-published released body'
        ));
        const projectileAudit = copyCaptureBodyAudit(
            endpoint,
            seeded.projectileHandle,
            'terminal-published released audit'
        );
        const terminal = endpoint
            .getTerminalProjectileCaptureProgramCancelStatus();
        const runtime = endpoint.getProjectileCaptureRuntimeStatus();
        return Object.freeze({
            finalFixedTick: 4,
            captorHandle: copyHandle(seeded.captorHandle),
            projectileHandle: copyHandle(seeded.projectileHandle),
            lethalHandle: copyHandle(lethalHandle),
            releasePreparation: snapshotCaptureRecord(preparations[0]),
            preparedAudit,
            lifecycleReleaseCount:
                lifecycle.projectileCaptureReleases.length,
            lifecycleRelease: Object.freeze({
                ...lifecycle.projectileCaptureReleases[0],
                projectileHandle: copyHandle(
                    lifecycle.projectileCaptureReleases[0].projectileHandle
                ),
                captorHandle: copyHandle(
                    lifecycle.projectileCaptureReleases[0].captorHandle
                )
            }),
            metadataAfterPublication,
            projectileBody,
            projectileAudit,
            registryHasProjectile:
                endpoint.getRegistry().has(seeded.projectileHandle),
            terminalBoundary: Object.freeze({
                captureSourceTick: terminalBoundary.captures.sourceTick,
                captureCompletedThroughTick:
                    terminalBoundary.captures.completedThroughTick,
                releaseSourceTick: terminalBoundary.releases.sourceTick,
                releaseCompletedThroughTick:
                    terminalBoundary.releases.completedThroughTick,
                captureCount:
                    terminalBoundary.captures.captures?.length ?? 0,
                releasePreparationCount:
                    terminalBoundary.captures.releasePreparations?.length ?? 0,
                cleanupCount:
                    terminalBoundary.captures.cleanups?.length ?? 0,
                releaseCompletionCount:
                    terminalBoundary.releases.releaseCompletions?.length ?? 0
            }),
            terminal,
            directorStatus: director.getStatus(),
            runtimeStatus: runtime,
            recoveryRequired: endpoint.requiresRecovery()
                || director.requiresRecovery()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runTerminalAndReplacement(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const endpoint = createEndpoint(device, format, 4);
    let director = null;
    let oldPort = null;
    let oldSessionGeneration = 0;
    let oldCaptorHandle = null;
    let oldProjectileHandle = null;
    try {
        initializeEndpoint(endpoint, tileMap, 'replacement-old');
        director = createDirector(endpoint);
        const binding = DIRECTOR_BINDING.get(director);
        oldPort = binding.commandPort;
        oldSessionGeneration = binding.runtime.sessionGeneration;
        const seeded = await seedHeldPair(
            endpoint,
            director,
            route,
            'replacement-old'
        );
        oldCaptorHandle = copyHandle(seeded.captorHandle);
        oldProjectileHandle = copyHandle(seeded.projectileHandle);
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
    const staleRequest = oldPort.requestPreparedReleaseBatch({
        commandId: 'replacement-old:stale-release',
        prepareSourceTick: 2,
        targetFixedTick: 3,
        batchIdFingerprint: 1,
        records: Object.freeze([])
    });
    const staleDiscard = oldPort.discardPreparedBatch({
        batchIdFingerprint: 1
    });
    assert(staleRequest?.accepted === false
        && staleRequest.reason === 'projectile-capture-release-ingress-revoked'
        && staleRequest.requiresRecovery === false,
        `replacement-old release port stayed live ${JSON.stringify(
            staleRequest
        )}`);
    assert(staleDiscard?.accepted === false
        && staleDiscard.reason === 'projectile-capture-release-ingress-revoked'
        && staleDiscard.requiresRecovery === false,
        `replacement-old discard port stayed live ${JSON.stringify(
            staleDiscard
        )}`);
    const staleTerminalCleanup = oldPort.requestTerminalHeldProjectileDespawn({
        handle: oldProjectileHandle,
        targetFixedTick: 3,
        commandId: 'ring-projectile-capture-terminal:old-port'
    });
    assert(staleTerminalCleanup?.accepted === false
        && staleTerminalCleanup.reason
            === 'projectile-capture-terminal-cleanup-rejected'
        && staleTerminalCleanup.requiresRecovery === false,
        `replacement-old terminal cleanup port stayed live ${JSON.stringify(
            staleTerminalCleanup
        )}`);
    const unpublished = await runUnpublishedTerminal(device, format);
    const published = await runPublishedTerminal(device, format);
    const replacement = createEndpoint(device, format, 4);
    let replacementDirector = null;
    try {
        initializeEndpoint(replacement, tileMap, 'replacement-new');
        replacementDirector = createDirector(replacement);
        const seeded = await seedHeldPair(
            replacement,
            replacementDirector,
            route,
            'replacement-new'
        );
        const status = replacement.getProjectileCaptureRuntimeStatus();
        return Object.freeze({
            unpublished,
            published,
            replacement: Object.freeze({
                oldSessionGeneration,
                newSessionGeneration:
                    replacement.getStatus().sessionGeneration,
                oldCaptorHandle,
                oldProjectileHandle,
                newCaptorHandle: copyHandle(seeded.captorHandle),
                newProjectileHandle: copyHandle(seeded.projectileHandle),
                staleRequest: Object.freeze({ ...staleRequest }),
                staleDiscard: Object.freeze({ ...staleDiscard }),
                staleTerminalCleanup: Object.freeze({
                    ...staleTerminalCleanup
                }),
                captureRecord: snapshotCaptureRecord(seeded.captureRecord),
                capturedProjectileCount:
                    replacementDirector.getStatus().capturedProjectileCount,
                runtimeStatus: status,
                recoveryRequired: replacement.requiresRecovery()
                    || replacementDirector.requiresRecovery()
            })
        });
    } finally {
        replacementDirector?.destroy();
        replacement.destroy();
    }
}

function assertFreshCapturePlane(plane, handle, role, label) {
    const state = plane.gpu.state;
    const candidate = plane.gpu.candidate;
    assert(plane.audit.bodySlot === plane.gpu.bodySlot,
        `${label}: host/GPU slot mismatch`);
    assert(state.selfEntityId === handle.entityId
        && state.selfIncarnation === handle.incarnation,
    `${label}: GPU exact self identity missing`);
    assert(state.role === role
        && state.phase === GPU_PROJECTILE_CAPTURE_PHASE.IDLE
        && state.flags === 0
        && state.peerBodySlot === INVALID_U32
        && state.peerEntityId === INVALID_U32
        && state.peerIncarnation === INVALID_U32
        && state.capturedAtFixedTick === 0
        && state.releaseDueFixedTick === 0
        && state.captureSequence === 0
        && state.capturedSpeed === 0,
    `${label}: GPU fresh capture state is stale ${JSON.stringify(state)}`);
    assert(role === GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR
        ? state.profileCode === 1
            && state.policyCode
                === GPU_PROJECTILE_CAPTURE_POLICY_CODE.NOT_CAPTURABLE
            && Math.abs(Math.hypot(state.facingX, state.facingY) - 1)
                <= 0.0001
        : state.profileCode === 0
            && state.policyCode
                === GPU_PROJECTILE_CAPTURE_POLICY_CODE.CAPTURABLE
            && state.facingX === 0
            && state.facingY === 0,
    `${label}: GPU role/profile/policy materialization mismatch`);
    assert(candidate.distanceSquaredBits === 0x7f800000
        && candidate.peerEntityId === INVALID_U32
        && candidate.peerIncarnation === INVALID_U32
        && candidate.status === 0,
    `${label}: GPU candidate plane is stale ${JSON.stringify(candidate)}`);
}

function assertTombstoneCapturePlane(plane, label) {
    const state = plane.state;
    const candidate = plane.candidate;
    assert(state.role === GPU_PROJECTILE_CAPTURE_ROLE.NONE
        && state.phase === GPU_PROJECTILE_CAPTURE_PHASE.IDLE
        && state.profileCode === 0
        && state.policyCode
            === GPU_PROJECTILE_CAPTURE_POLICY_CODE.NOT_CAPTURABLE
        && state.flags === 0
        && state.selfEntityId === INVALID_U32
        && state.selfIncarnation === 0
        && state.peerBodySlot === INVALID_U32
        && state.peerEntityId === INVALID_U32
        && state.peerIncarnation === INVALID_U32
        && state.capturedAtFixedTick === 0
        && state.releaseDueFixedTick === 0
        && state.captureSequence === 0
        && state.capturedSpeed === 0
        && state.facingX === 0
        && state.facingY === 0,
    `${label}: tombstone state retained capture data ${JSON.stringify(state)}`);
    assert(candidate.distanceSquaredBits === 0x7f800000
        && candidate.peerEntityId === INVALID_U32
        && candidate.peerIncarnation === INVALID_U32
        && candidate.status === 0,
    `${label}: tombstone candidate retained capture data ${JSON.stringify(
        candidate
    )}`);
}

async function runCapturePlaneSlotReuse(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const endpoint = createEndpoint(device, format, 3);
    let director = null;
    try {
        initializeEndpoint(endpoint, tileMap, 'capture-plane-reuse');
        director = createDirector(endpoint);
        assert(endpoint.requestSpawnBatch([{
            intent: createGpuTowerSpawnIntent({ position: { x: 9, y: 4 } }),
            targetFixedTick: 1,
            commandId: 'capture-plane-reuse:tower'
        }, {
            intent: createRingIntent(route, 1, { x: 4, y: 4 }),
            targetFixedTick: 1,
            commandId: 'capture-plane-reuse:old-ring'
        }, {
            intent: createBulletIntent(
                { x: 4.3, y: 4 },
                { x: -1, y: 0 },
                {
                    definitionId: 'nw-ring-capture-plane-expiring-projectile',
                    lifetimeSeconds: FIXED_DELTA * 1.5,
                    spawnSequence: 1
                }
            ),
            targetFixedTick: 1,
            commandId: 'capture-plane-reuse:old-projectile'
        }]).accepted, 'capture-plane-reuse seed rejected');
        let towerHandle = null;
        let oldRingHandle = null;
        let oldProjectileHandle = null;
        let oldMaterialization = null;
        const tick1 = await advanceTick({
            endpoint,
            director,
            tick: 1,
            label: 'capture-plane-reuse T1',
            async afterCommit(lifecycle) {
                towerHandle = requireSpawnHandle(
                    lifecycle,
                    'capture-plane-reuse:tower'
                );
                oldRingHandle = requireSpawnHandle(
                    lifecycle,
                    'capture-plane-reuse:old-ring'
                );
                oldProjectileHandle = requireSpawnHandle(
                    lifecycle,
                    'capture-plane-reuse:old-projectile'
                );
                const ring = await readGpuCapturePlanes(
                    endpoint,
                    oldRingHandle,
                    'old-ring-materialized'
                );
                const projectile = await readGpuCapturePlanes(
                    endpoint,
                    oldProjectileHandle,
                    'old-projectile-materialized'
                );
                assertFreshCapturePlane(
                    ring,
                    oldRingHandle,
                    GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR,
                    'old R materialization'
                );
                assertFreshCapturePlane(
                    projectile,
                    oldProjectileHandle,
                    GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE,
                    'old projectile materialization'
                );
                oldMaterialization = Object.freeze({ ring, projectile });
            }
        });
        const oldHeld = Object.freeze({
            ring: await readGpuCapturePlanes(
                endpoint,
                oldRingHandle,
                'old-ring-held'
            ),
            projectile: await readGpuCapturePlanes(
                endpoint,
                oldProjectileHandle,
                'old-projectile-held'
            )
        });
        assert(oldHeld.ring.gpu.state.phase
                === GPU_PROJECTILE_CAPTURE_PHASE.HELD
            && oldHeld.projectile.gpu.state.phase
                === GPU_PROJECTILE_CAPTURE_PHASE.HELD
            && oldHeld.ring.gpu.state.captureSequence === 1
            && oldHeld.projectile.gpu.state.captureSequence === 1
            && oldHeld.ring.gpu.candidate.peerEntityId
                === oldProjectileHandle.entityId
            && oldHeld.ring.gpu.candidate.peerIncarnation
                === oldProjectileHandle.incarnation
            && oldHeld.projectile.gpu.candidate.peerEntityId
                === oldRingHandle.entityId
            && oldHeld.projectile.gpu.candidate.peerIncarnation
                === oldRingHandle.incarnation
            && oldHeld.projectile.gpu.candidate.status !== 0,
        'capture-plane-reuse old live evidence did not become non-zero');
        const tick2 = await advanceTick({
            endpoint,
            director,
            tick: 2,
            label: 'capture-plane-reuse T2'
        });
        assert(tick2.boundary.captures.captures?.length === 1,
            'capture-plane-reuse old capture completion missing');
        const oldRingSlot = oldMaterialization.ring.audit.bodySlot;
        const oldProjectileSlot = oldMaterialization.projectile.audit.bodySlot;
        let projectileTombstone = null;
        const tick3 = await advanceTick({
            endpoint,
            director,
            tick: 3,
            label: 'capture-plane-reuse T3 expired tombstone',
            async afterCommit(lifecycle) {
                assert(lifecycle.despawned?.some((entry) => exactHandle(
                    entry.handle,
                    oldProjectileHandle
                )), 'capture-plane-reuse expired projectile was not despawned');
                assert(endpoint.getBackend().getProjectileCaptureBodyState(
                    oldProjectileHandle
                ) === null, 'capture-plane-reuse expired handle survived');
                projectileTombstone = await readGpuCapturePlanesAtSlot(
                    endpoint,
                    oldProjectileSlot,
                    'old-projectile-tombstone'
                );
                assertTombstoneCapturePlane(
                    projectileTombstone,
                    'old projectile tombstone'
                );
            }
        });
        assert(tick3.boundary.captures.cleanups?.length === 1
            && exactHandle(
                tick3.boundary.captures.cleanups[0].projectileHandle,
                oldProjectileHandle
            )
            && director.getStatus().capturedProjectileCount === 0,
        'capture-plane-reuse expired capture roster was not cleared');
        assert(endpoint.getRegistry().has(towerHandle),
            'capture-plane-reuse sentinel Tower disappeared');
        assert(endpoint.requestDespawn(
            oldRingHandle,
            'capture-plane-reuse',
            4,
            'capture-plane-reuse:despawn-old-ring'
        ).accepted, 'capture-plane-reuse old R despawn rejected');
        let ringTombstone = null;
        const tick4 = await advanceTick({
            endpoint,
            director,
            tick: 4,
            label: 'capture-plane-reuse T4 R tombstone',
            async afterCommit(lifecycle) {
                assert(lifecycle.despawned?.some((entry) => exactHandle(
                    entry.handle,
                    oldRingHandle
                )), 'capture-plane-reuse old R was not despawned');
                assert(endpoint.getBackend().getProjectileCaptureBodyState(
                    oldRingHandle
                ) === null, 'capture-plane-reuse old R handle survived');
                ringTombstone = await readGpuCapturePlanesAtSlot(
                    endpoint,
                    oldRingSlot,
                    'old-ring-tombstone'
                );
                assertTombstoneCapturePlane(ringTombstone, 'old R tombstone');
            }
        });
        const tombstones = Object.freeze({
            ring: ringTombstone,
            projectile: projectileTombstone
        });
        assert(endpoint.requestSpawnBatch([{
            intent: createRingIntent(route, 2, { x: 4, y: 4 }),
            targetFixedTick: 5,
            commandId: 'capture-plane-reuse:new-ring'
        }, {
            intent: createBulletIntent(
                { x: 4.3, y: 4 },
                { x: -1, y: 0 },
                { spawnSequence: 2 }
            ),
            targetFixedTick: 5,
            commandId: 'capture-plane-reuse:new-projectile'
        }]).accepted, 'capture-plane-reuse replacement rejected');
        let newRingHandle = null;
        let newProjectileHandle = null;
        let replacementMaterialization = null;
        const tick5 = await advanceTick({
            endpoint,
            director,
            tick: 5,
            label: 'capture-plane-reuse T5 replacement',
            async afterCommit(lifecycle) {
                newRingHandle = requireSpawnHandle(
                    lifecycle,
                    'capture-plane-reuse:new-ring'
                );
                newProjectileHandle = requireSpawnHandle(
                    lifecycle,
                    'capture-plane-reuse:new-projectile'
                );
                const ring = await readGpuCapturePlanes(
                    endpoint,
                    newRingHandle,
                    'new-ring-materialized'
                );
                const projectile = await readGpuCapturePlanes(
                    endpoint,
                    newProjectileHandle,
                    'new-projectile-materialized'
                );
                assertFreshCapturePlane(
                    ring,
                    newRingHandle,
                    GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR,
                    'replacement R materialization'
                );
                assertFreshCapturePlane(
                    projectile,
                    newProjectileHandle,
                    GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE,
                    'replacement projectile materialization'
                );
                const reusedSlots = [ring.audit.bodySlot, projectile.audit.bodySlot]
                    .sort((left, right) => left - right);
                const oldSlots = [oldRingSlot, oldProjectileSlot]
                    .sort((left, right) => left - right);
                assert(JSON.stringify(reusedSlots) === JSON.stringify(oldSlots),
                    'capture-plane-reuse did not reuse exact old slots');
                replacementMaterialization = Object.freeze({
                    ring,
                    projectile,
                    reusedSlots: Object.freeze(reusedSlots)
                });
            }
        });
        const replacementHeld = Object.freeze({
            ring: await readGpuCapturePlanes(
                endpoint,
                newRingHandle,
                'new-ring-held'
            ),
            projectile: await readGpuCapturePlanes(
                endpoint,
                newProjectileHandle,
                'new-projectile-held'
            )
        });
        assert(replacementHeld.ring.gpu.state.phase
                === GPU_PROJECTILE_CAPTURE_PHASE.HELD
            && replacementHeld.projectile.gpu.state.phase
                === GPU_PROJECTILE_CAPTURE_PHASE.HELD
            && replacementHeld.ring.gpu.state.captureSequence === 1
            && replacementHeld.projectile.gpu.state.captureSequence === 1
            && replacementHeld.ring.gpu.state.peerEntityId
                === newProjectileHandle.entityId
            && replacementHeld.ring.gpu.state.peerIncarnation
                === newProjectileHandle.incarnation
            && replacementHeld.projectile.gpu.state.peerEntityId
                === newRingHandle.entityId
            && replacementHeld.projectile.gpu.state.peerIncarnation
                === newRingHandle.incarnation
            && replacementHeld.ring.gpu.candidate.peerEntityId
                === newProjectileHandle.entityId
            && replacementHeld.ring.gpu.candidate.peerIncarnation
                === newProjectileHandle.incarnation
            && replacementHeld.projectile.gpu.candidate.peerEntityId
                === newRingHandle.entityId
            && replacementHeld.projectile.gpu.candidate.peerIncarnation
                === newRingHandle.incarnation
            && replacementHeld.projectile.gpu.candidate.status !== 0,
        'capture-plane-reuse replacement did not materialize fresh held state');
        const tick6 = await advanceTick({
            endpoint,
            director,
            tick: 6,
            label: 'capture-plane-reuse T6 completion'
        });
        const replacementCaptures = tick6.boundary.captures.captures ?? [];
        assert(replacementCaptures.length === 1
            && exactHandle(replacementCaptures[0].captorHandle, newRingHandle)
            && exactHandle(
                replacementCaptures[0].projectileHandle,
                newProjectileHandle
            )
            && replacementCaptures[0].captureSequence === 1,
        'capture-plane-reuse replacement capture retained stale identity/sequence');
        return Object.freeze({
            towerHandle: copyHandle(towerHandle),
            oldRingHandle: copyHandle(oldRingHandle),
            oldProjectileHandle: copyHandle(oldProjectileHandle),
            newRingHandle: copyHandle(newRingHandle),
            newProjectileHandle: copyHandle(newProjectileHandle),
            oldCaptureRecord: snapshotCaptureRecord(
                tick2.boundary.captures.captures[0]
            ),
            replacementCaptureRecord:
                snapshotCaptureRecord(replacementCaptures[0]),
            oldMaterialization,
            oldHeld,
            tombstones,
            replacementMaterialization,
            replacementHeld,
            oldSlots: Object.freeze([oldRingSlot, oldProjectileSlot]
                .sort((left, right) => left - right)),
            tick3RuntimeStatus: tick3.runtime,
            tick4RuntimeStatus: tick4.runtime,
            tick5RuntimeStatus: tick5.runtime,
            finalRuntimeStatus: tick6.runtime,
            recoveryRequired: endpoint.requiresRecovery()
                || director.requiresRecovery()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runCoexistence(device, format) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const endpoint = createEndpoint(device, format, 9);
    let director = null;
    try {
        initializeEndpoint(endpoint, tileMap, 'coexistence');
        director = createDirector(endpoint);
        const requests = [{
            intent: createGpuTowerSpawnIntent({ position: { x: 8, y: 4 } }),
            targetFixedTick: 1,
            commandId: 'coexistence:tower'
        }, {
            intent: createRingIntent(route, 1, { x: 4, y: 4 }),
            targetFixedTick: 1,
            commandId: 'coexistence:ring'
        }, {
            intent: createBulletIntent(
                { x: 4.3, y: 4 },
                { x: -1, y: 0 },
                { spawnSequence: 1 }
            ),
            targetFixedTick: 1,
            commandId: 'coexistence:projectile'
        }, {
            intent: createOtherEnemyIntent(
                BASIC_OCTA_ENEMY_DATA,
                route,
                2,
                { x: 12, y: 3 }
            ),
            targetFixedTick: 1,
            commandId: 'coexistence:o'
        }, {
            intent: createOtherEnemyIntent(
                BASIC_PENTA_ENEMY_DATA,
                route,
                3,
                { x: 14, y: 5 }
            ),
            targetFixedTick: 1,
            commandId: 'coexistence:p'
        }, {
            intent: createOtherEnemyIntent(
                BASIC_HEXA_ENEMY_DATA,
                route,
                4,
                { x: 16, y: 7 }
            ),
            targetFixedTick: 1,
            commandId: 'coexistence:h'
        }, {
            intent: createOtherEnemyIntent(
                BASIC_JORANG_ENEMY_DATA,
                route,
                5,
                { x: 18, y: 9 }
            ),
            targetFixedTick: 1,
            commandId: 'coexistence:j'
        }];
        assert(endpoint.requestSpawnBatch(requests).accepted,
            'coexistence spawn batch rejected');
        let towerHandle = null;
        const tick1 = await advanceTick({
            endpoint,
            director,
            tick: 1,
            label: 'coexistence T1',
            afterCommit(lifecycle) {
                towerHandle = requireSpawnHandle(
                    lifecycle,
                    'coexistence:tower'
                );
                assert(endpoint.configureTowerGameplayTarget(towerHandle).accepted,
                    'coexistence Tower target rejected');
            }
        });
        const commandIds = ['ring', 'projectile', 'o', 'p', 'h', 'j'];
        const handles = Object.freeze(Object.fromEntries(commandIds.map(
            (name) => [name, copyHandle(requireSpawnHandle(
                tick1.lifecycle,
                `coexistence:${name}`
            ))]
        )));
        const tick2 = await advanceTick({
            endpoint,
            director,
            tick: 2,
            towerTargetHandle: towerHandle,
            label: 'coexistence T2'
        });
        const captureRecords = tick2.boundary.captures.captures ?? [];
        assert(captureRecords.length === 1
            && exactHandle(captureRecords[0].captorHandle, handles.ring)
            && exactHandle(captureRecords[0].projectileHandle, handles.projectile),
        'coexistence R capture missing');
        const registryEvidence = Object.freeze(
            ['ring', 'o', 'p', 'h', 'j'].map((name) => {
                const view = copyRegistryView(
                    endpoint,
                    handles[name],
                    `coexistence ${name}`
                );
                return Object.freeze({
                    name,
                    handle: view.handle,
                    kindId: view.kindId,
                    definitionId: view.definitionId,
                    metadataRevision: view.metadataRevision
                });
            })
        );
        const simulationStatus = endpoint.getBackend().simulation.getStatus();
        const captureRuntimeStatus
            = endpoint.getProjectileCaptureRuntimeStatus();
        const collisionStorageValues = [
            ...Object.values(simulationStatus.collision?.storageProfile ?? {}),
            simulationStatus.formations?.storageProfile?.render
        ].filter((value) => Number.isSafeInteger(value) && value > 0);
        return Object.freeze({
            towerHandle: copyHandle(towerHandle),
            handles,
            captureRecord: snapshotCaptureRecord(captureRecords[0]),
            projectileAudit: copyCaptureBodyAudit(
                endpoint,
                handles.projectile,
                'coexistence captured projectile audit'
            ),
            registryEvidence,
            activeEnemyCount: endpoint.getRegistry().getActiveCount('enemy'),
            bodyAbiVersion: simulationStatus.abiVersion,
            captureRuntimeStatus,
            directorBinding: Object.freeze({
                runtime: DIRECTOR_BINDING.get(director).runtime,
                capacity: DIRECTOR_BINDING.get(director).capacity,
                commandPortMethods:
                    DIRECTOR_BINDING.get(director).commandPortMethods
            }),
            collisionStorageProfile: Object.freeze({
                ...(simulationStatus.collision?.storageProfile ?? {}),
                render:
                    simulationStatus.formations?.storageProfile?.render ?? null,
                requiredMaximum: Math.max(...collisionStorageValues)
            }),
            captureStorageProfile: Object.freeze({
                ...captureRuntimeStatus.storageProfile
            }),
            recoveryRequired: endpoint.requiresRecovery()
                || director.requiresRecovery()
        });
    } finally {
        director?.destroy();
        endpoint.destroy();
    }
}

async function runFixture(device, format) {
    return Object.freeze({
        scenario: 'ring-single-slot-projectile-capture-release',
        actualRuntime: Object.freeze({
            funnelAndMutualSelection:
                await runFunnelAndMutualSelection(device, format),
            capacityWholeBatchRejection:
                await runCapacityWholeBatchRejection(device, format),
            capacityCurrentTickInvalidation:
                await runCapacityCurrentTickInvalidation(device, format),
            capacityRetryProjectileAba:
                await runCapacityRetryProjectileAba(device, format),
            capacityRetryCaptorDeath:
                await runCapacityRetryDeathInvalidation(
                    device,
                    format,
                    'captor'
                ),
            capacityRetryProjectileDeath:
                await runCapacityRetryDeathInvalidation(
                    device,
                    format,
                    'projectile'
                ),
            capacityRetryOldGeneration:
                await runCapacityRetryOldGenerationRollover(device, format),
            releasePreparationCapacityRetry:
                await runReleasePreparationCapacityRetry(device, format),
            cleanupCapacityRetry:
                await runCleanupCapacityRetry(device, format),
            heldTowerRelease: await runReleaseRoundTrip(
                device,
                format,
                { withTower: true, render: true }
            ),
            forwardReleaseNoCore: await runReleaseRoundTrip(
                device,
                format,
                { withTower: false, render: false }
            ),
            captorDeath: await runCaptorExitRelease(
                device,
                format,
                'death'
            ),
            captorCoreImpact: await runCaptorExitRelease(
                device,
                format,
                'core-impact'
            ),
            heldProjectileExpiry:
                await runHeldProjectileExpiry(device, format),
            terminalReplacement:
                await runTerminalAndReplacement(device, format),
            capturePlaneSlotReuse:
                await runCapturePlaneSlotReuse(device, format),
            coexistence: await runCoexistence(device, format)
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
        result.productionEnemyRingProjectileCapture = await runFixture(
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
