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
    corePortReceiver = null
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
    return new GpuEnemySimulationEndpoint(dependencies, { capacity });
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
        metadata: Object.freeze({ ...view.metadata })
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
    const stateLayout = GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE;
    const candidateLayout = GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_CANDIDATE;
    const stateOffset = 0;
    const candidateOffset = stateLayout.STRIDE;
    const readback = simulation.device.createBuffer({
        label: `cirvivor-nw-ring-capture-plane-${label}`,
        size: stateLayout.STRIDE + candidateLayout.STRIDE,
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
        `T${targetFixedTick}: event observe ${JSON.stringify(
            director.getStatus()
        )}`);
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
        `${label}: capture stage ${JSON.stringify(stage)}`);
    const lifecycle = assertBoundaryHealthy(
        endpoint.commitAtFixedBoundary(tick),
        `${label}: lifecycle`
    );
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

async function runFunnelCase(device, format, label, angleRadians) {
    const tileMap = new TileMap(OPEN_MAP_DATA);
    const route = tileMap.getSpawnRoutes()[0];
    const endpoint = createEndpoint(device, format, 3);
    let director = null;
    try {
        assert(endpoint.init(tileMap), `${label}: endpoint init failed`);
        director = createDirector(endpoint);
        const center = Object.freeze({ x: 4, y: 4 });
        const distance = 0.3;
        const projectilePosition = Object.freeze({
            x: center.x + (Math.cos(angleRadians) * distance),
            y: center.y + (Math.sin(angleRadians) * distance)
        });
        assert(endpoint.requestSpawnBatch([{
            intent: createRingIntent(route, 1, center),
            targetFixedTick: 1,
            commandId: `${label}:ring`
        }, {
            intent: createBulletIntent(
                projectilePosition,
                {
                    x: -Math.cos(angleRadians),
                    y: -Math.sin(angleRadians)
                },
                { spawnSequence: 1 }
            ),
            targetFixedTick: 1,
            commandId: `${label}:projectile`
        }]).accepted, `${label}: spawn batch rejected`);
        const tick1 = await advanceTick({
            endpoint,
            director,
            tick: 1,
            label: `${label} T1`
        });
        const captorHandle = requireSpawnHandle(tick1.lifecycle, `${label}:ring`);
        const projectileHandle = requireSpawnHandle(
            tick1.lifecycle,
            `${label}:projectile`
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
            captorHandle: copyHandle(captorHandle),
            projectileHandle: copyHandle(projectileHandle),
            captureRecords: Object.freeze(records.map(snapshotCaptureRecord)),
            directorStatus: director.getStatus(),
            projectileBody: copyBody(findBody(
                tick2.bodies,
                projectileHandle,
                `${label} projectile`
            )),
            projectileAudit: copyCaptureBodyAudit(
                endpoint,
                projectileHandle,
                `${label} projectile audit`
            ),
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
        assert(endpoint.init(tileMap), 'one-captor-two endpoint init failed');
        director = createDirector(endpoint);
        const center = Object.freeze({ x: 4, y: 4 });
        const requests = [{
            intent: createRingIntent(route, 1, center),
            targetFixedTick: 1,
            commandId: 'one-captor-two:ring'
        }, ...[-0.08, 0.08].map((offset, index) => ({
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
        assert(endpoint.init(tileMap), 'two-captors-one endpoint init failed');
        director = createDirector(endpoint);
        const requests = [-0.08, 0.08].map((offset, index) => ({
            intent: createRingIntent(route, index + 1, {
                x: 4,
                y: 4 + offset
            }),
            targetFixedTick: 1,
            commandId: `two-captors-one:ring:${index}`
        }));
        requests.push({
            intent: createBulletIntent(
                { x: 4.3, y: 4 },
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

async function runFunnelAndMutualSelection(device, format) {
    const inside = await runFunnelCase(device, format, 'funnel-inside', 0);
    const boundary = await runFunnelCase(
        device,
        format,
        'funnel-boundary',
        Math.PI / 4
    );
    const outside = await runFunnelCase(
        device,
        format,
        'funnel-outside',
        (Math.PI / 4) + 0.08
    );
    assert(inside.captureRecords.length === 1,
        'inside funnel did not capture');
    assert(boundary.captureRecords.length === 1,
        'inclusive boundary did not capture');
    assert(outside.captureRecords.length === 0,
        'outside funnel captured');
    return Object.freeze({
        inside,
        boundary,
        outside,
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
    return Object.freeze({
        centerAlpha: alphaAt(frame, width * 0.5, height * 0.5),
        ringBandAlpha: alphaAt(
            frame,
            (width * 0.5) + (ringBody.radius * scale * 0.85),
            height * 0.5
        ),
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
        assert(endpoint.init(tileMap), `${prefix}: endpoint init failed`);
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
        if (!withTower) {
            captureRequests.push({
                intent: createGpuCoreProxySpawnIntent({
                    position: { x: 20, y: 12 }
                }),
                targetFixedTick: firstTick,
                commandId: `${prefix}:core-proxy`
            });
        }
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
                coreProxyHandle = withTower ? null : requireSpawnHandle(
                    lifecycle,
                    `${prefix}:core-proxy`
                );
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
        const releaseSubmit = await advanceTick({
            endpoint,
            director,
            tick: releaseTick,
            towerTargetHandle: towerHandle,
            label: `${prefix} release publication`
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
        assert(endpoint.init(tileMap), `${prefix}: endpoint init failed`);
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
            : createBulletIntent(
                captorBody.position,
                { x: 0, y: 0 },
                {
                    definitionId: 'nw-ring-non-capturable-lethal-projectile',
                    capturePolicyId:
                        PROJECTILE_CAPTURE_POLICY_ID.NOT_CAPTURABLE,
                    damage: 100,
                    spawnSequence: 2
                }
            );
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
                releaseReason: lifecycleRelease.releaseReason,
                commandIdFingerprint:
                    lifecycleRelease.commandIdFingerprint,
                batchIdFingerprint: lifecycleRelease.batchIdFingerprint,
                prepareFingerprint: lifecycleRelease.prepareFingerprint,
                targetHandle: lifecycleRelease.targetHandle
                    ? copyHandle(lifecycleRelease.targetHandle)
                    : null,
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
        assert(endpoint.init(tileMap), 'held-expiry endpoint init failed');
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
        assert(endpoint.init(tileMap), 'terminal-unpublished init failed');
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
        director.closeForTerminal(finalTick, 'core-depleted');
        endpoint.closeGameplayIngress('core-depleted', finalTick);
        const lifecycle = assertBoundaryHealthy(
            endpoint.commitAtFixedBoundary(finalTick),
            'terminal-unpublished lifecycle'
        );
        director.observeFixedCommit(lifecycle, finalTick);
        director.observeLifecycle(lifecycle, finalTick);
        assert(endpoint.fixedUpdate(FIXED_DELTA, finalTick),
            'terminal-unpublished final submit failed');
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
        return Object.freeze({
            finalFixedTick: finalTick,
            captorHandle: copyHandle(seeded.captorHandle),
            projectileHandle: copyHandle(seeded.projectileHandle),
            captureRecord: snapshotCaptureRecord(seeded.captureRecord),
            beforeBody,
            beforeAudit,
            afterBody: body ? copyBody(body) : null,
            lifecycleReleaseCount:
                lifecycle.projectileCaptureReleases?.length ?? 0,
            registryHasProjectile:
                endpoint.getRegistry().has(seeded.projectileHandle),
            terminalBoundary: Object.freeze({
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
        assert(endpoint.init(tileMap), 'terminal-published init failed');
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
            createBulletIntent(
                captorBody.position,
                { x: 0, y: 0 },
                {
                    definitionId:
                        'nw-ring-terminal-non-capturable-lethal-projectile',
                    capturePolicyId:
                        PROJECTILE_CAPTURE_POLICY_ID.NOT_CAPTURABLE,
                    damage: 100,
                    spawnSequence: 2
                }
            ),
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
        assert(endpoint.init(tileMap), 'replacement-old init failed');
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
        assert(replacement.init(tileMap), 'replacement-new init failed');
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
        assert(endpoint.init(tileMap), 'capture-plane-reuse endpoint init failed');
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
        assert(endpoint.init(tileMap), 'coexistence endpoint init failed');
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
                    simulationStatus.formations?.storageProfile?.render ?? null
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
