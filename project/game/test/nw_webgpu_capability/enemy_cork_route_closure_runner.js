import {
    BASIC_CORK_ENEMY_DATA
} from './production/script/data/object/enemy/basic_cork_enemy_data.js';
import {
    CORK_DUAL_ROUTE_MAP_DATA,
    CORK_DUAL_ROUTE_LOWER_PATH_ID,
    CORK_DUAL_ROUTE_ROUTE_SET_ID,
    CORK_DUAL_ROUTE_UPPER_CLOSURE_ID,
    CORK_DUAL_ROUTE_UPPER_PATH_ID
} from './production/script/data/scene/game/cork_dual_route_map_data.js';
import {
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
    TileMap
} from './production/script/module/ingame/map/tile_map.js';
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
    GPU_CIRCLE_BODY_ABI_VERSION
} from './production/script/module/ingame/physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_ROUTE_RUNTIME_ABI,
    GPU_ROUTE_RUNTIME_MAX_CLOSERS,
    GPU_ROUTE_RUNTIME_PHASE,
    GPU_ROUTE_RUNTIME_ROLE,
    readGpuRouteRuntimeState
} from './production/script/module/ingame/physics/gpu/gpu_route_runtime_abi.js';
import {
    GPU_ROUTE_RUNTIME_STORAGE_PROFILE
} from './production/script/module/ingame/physics/gpu/gpu_route_runtime_shaders.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const REQUIRED_STORAGE_BUFFER_LIMIT = 9;
const FIXED_DELTA = 1 / 60;
const CORK_EXPANSION_CLOSE_SUBMIT_TICK = 62;
const CORK_CLOSE_COMPLETION_TICK = 63;
const TOWER_BLOCKER_PROBE_START_DISTANCE = 3.2;

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
    assert(endpoint.init(tileMap), 'Cork endpoint init failed');
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

function validateFutureWaveSelection(harness, closedAvailability) {
    const wave = new WaveDirector({
        waveDefinition: CORK_DUAL_ROUTE_WAVE_01_DATA
    });
    wave.init(harness.tileMap);
    const requests = [];
    const queued = wave.queueSpawnsForFixedTick(901, {
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

async function runClosureRoutingAndInteraction(device, format) {
    const harness = createRouteHarness(device, format, 12);
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
    const closurePosition = upperRoute.waypoints[4];
    let corkHandle;
    let trappedHandle;
    let activeHandle;
    let towerHandle;
    let futureHandle;
    let projectileHandle;
    let assignmentCompletion = null;
    let closeCompletion = null;
    let reopenCompletion = null;
    let cleanupCompletion = null;
    let tick62Evidence = null;
    let tick63Evidence = null;
    let tick64Evidence = null;
    let towerBeforeBlock = null;
    let futureSpawnSelectedAlternative = false;
    let registryCountAtClose = 0;

    try {
        assert(endpoint.requestSpawnBatch([{
            intent: createCorkIntent(harness, 1, closurePosition),
            targetFixedTick: 1,
            commandId: 'cork-main:owner'
        }]).accepted, 'Cork owner spawn rejected');
        await advanceTick({
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
            label: 'Cork main T2'
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
                        ? {
                            commandId: 'cork-main:trapped',
                            spawnSequence: 29
                        }
                        : tick === 52
                            ? {
                                commandId: 'cork-main:active',
                                spawnSequence: 52
                            }
                            : null;
                    if (!actorPlan) return;
                    const intent = createDynamicRouteIntent({
                        definition: ROUTE_ACTOR_DEFINITION,
                        route: upperRoute,
                        position: upperRoute.waypoints[0],
                        spawnSequence: actorPlan.spawnSequence,
                        availability: director.getAvailabilitySnapshot(),
                        graphContentKey: initialRuntime.graphContentKey
                    });
                    assert(endpoint.requestSpawnBatch([{
                        intent,
                        targetFixedTick: tick,
                        commandId: actorPlan.commandId
                    }]).accepted, `${actorPlan.commandId} spawn rejected`);
                },
                afterCommit(lifecycle) {
                    if (tick === 29) {
                        trappedHandle = requireSpawnHandle(
                            lifecycle,
                            'cork-main:trapped'
                        );
                    } else if (tick === 52) {
                        activeHandle = requireSpawnHandle(
                            lifecycle,
                            'cork-main:active'
                        );
                    }
                }
            });
        }

        await advanceTick({
            harness,
            tick: 61,
            label: 'Cork routed actors approach T61'
        });

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
                assert(endpoint.requestSpawnBatch([{
                    intent: createGpuTowerSpawnIntent({ position: towerPosition }),
                    targetFixedTick: 62,
                    commandId: 'cork-main:tower'
                }]).accepted, 'active actor/Tower spawn rejected');
            },
            afterCommit(lifecycle) {
                towerHandle = requireSpawnHandle(lifecycle, 'cork-main:tower');
            }
        });
        tick62Evidence = tick62.evidence;
        registryCountAtClose = endpoint.getRegistry().getActiveCount();
        const corkAtClose = routeEntryFor(tick62Evidence, corkHandle);
        towerBeforeBlock = findBody(tick62Evidence.bodies, towerHandle);
        assert(corkAtClose?.routeState.phase === GPU_ROUTE_RUNTIME_PHASE.BLOCKING
            && Math.abs(corkAtClose.body.radius - 3) <= 0.0001,
        `Cork did not reach exact blocker state: ${JSON.stringify(corkAtClose)}`);

        const tick63 = await advanceTick({
            harness,
            tick: CORK_CLOSE_COMPLETION_TICK,
            label: 'Cork closed interaction T63',
            beforeCommit(boundary) {
                closeCompletion = boundary.route;
                assert(closeCompletion.closures.some(
                    ({ ownerHandle }) => exactHandle(ownerHandle, corkHandle)
                ) && closeCompletion.closedPathIds.length === 1,
                `Cork close completion missing: ${JSON.stringify(closeCompletion)}`);
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
            }
        });
        tick63Evidence = tick63.evidence;

        const upperPathIndex = getCompiledPathIndex(
            harness,
            CORK_DUAL_ROUTE_UPPER_PATH_ID
        );
        const lowerPathIndex = getCompiledPathIndex(
            harness,
            CORK_DUAL_ROUTE_LOWER_PATH_ID
        );
        const upperClosure = getCompiledUpperClosure(harness);
        const activeBefore = routeEntryFor(tick62Evidence, activeHandle);
        const activeAfter = routeEntryFor(tick63Evidence, activeHandle);
        const trappedWaiting = routeEntryFor(tick63Evidence, trappedHandle);
        const futureAfter = routeEntryFor(tick63Evidence, futureHandle);
        const towerAfterBlock = findBody(tick63Evidence.bodies, towerHandle);
        assert(activeBefore?.routeState.currentPathIndex === upperPathIndex,
            'active actor did not start on upper path');
        assert(activeAfter?.routeState.currentPathIndex === lowerPathIndex,
            `active actor did not reroute: ${JSON.stringify(activeAfter)}`);
        assert(trappedWaiting?.routeState.phase === GPU_ROUTE_RUNTIME_PHASE.WAITING
            && trappedWaiting.routeState.pendingFieldIndex
                === upperClosure.clearanceFieldIndex,
        `trapped actor did not wait: ${JSON.stringify(trappedWaiting)}`);
        assert(futureAfter?.routeState.currentPathIndex === lowerPathIndex,
            `future actor did not select alternative: ${JSON.stringify(futureAfter)}`);

        const tick64 = await advanceTick({
            harness,
            tick: 64,
            label: 'Cork projectile crossing T64',
            beforeCommit() {
                const projectilePosition = Object.freeze({
                    x: closurePosition.x - direction.x * 4,
                    y: closurePosition.y - direction.y * 4
                });
                assert(endpoint.requestSpawnBatch([{
                    intent: createProjectileIntent(
                        projectilePosition,
                        { x: direction.x * 360, y: direction.y * 360 },
                        64
                    ),
                    targetFixedTick: 64,
                    commandId: 'cork-main:projectile'
                }]).accepted, 'projectile spawn rejected');
                const control = endpoint.requestBodyControl({
                    handle: towerHandle,
                    moveIntentX: direction.x,
                    moveIntentY: direction.y
                }, 64, 'cork-main:tower-control-2');
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
        tick64Evidence = tick64.evidence;
        const projectileAfter = findBody(
            tick64Evidence.bodies,
            projectileHandle
        );
        const tick65 = await advanceTick({
            harness,
            tick: 65,
            label: 'Cork owner death/reopen T65',
            beforeCommit(boundary) {
                reopenCompletion = boundary.route;
            }
        });
        const tick66 = await advanceTick({
            harness,
            tick: 66,
            label: 'Cork cleanup T66',
            beforeCommit(boundary) {
                cleanupCompletion = boundary.route;
            }
        });

        const damageEvent = tick65.boundary.events.events.find((event) => (
            event.eventType === 'damage-applied'
                && event.entityId === projectileHandle.entityId
                && event.incarnation === projectileHandle.incarnation
                && event.otherEntityId === corkHandle.entityId
                && event.otherIncarnation === corkHandle.incarnation
                && event.damageFixedPoint > 0
        ));
        const deathEvent = tick65.boundary.events.deathEvents.find(
            (event) => exactHandle(event, corkHandle)
        );
        const exactDeathDespawn = tick65.lifecycle.despawned.find(
            (entry) => exactHandle(entry.handle, corkHandle)
        );
        const reopened = reopenCompletion.reopens.find(
            ({ ownerHandle }) => exactHandle(ownerHandle, corkHandle)
        );
        const cleaned = cleanupCompletion.cleanups.find(
            ({ ownerHandle }) => exactHandle(ownerHandle, corkHandle)
        );
        const trappedResumed = routeEntryFor(tick65.evidence, trappedHandle);
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
            intent: createCorkIntent(harness, 67, upperRoute.waypoints[4]),
            targetFixedTick: 67,
            commandId: 'cork-main:aba-replacement'
        }]).accepted, 'ABA replacement spawn rejected');
        let replacementHandle;
        const tick67 = await advanceTick({
            harness,
            tick: 67,
            label: 'Cork exact-slot replacement T67',
            afterCommit(lifecycle) {
                replacementHandle = requireSpawnHandle(
                    lifecycle,
                    'cork-main:aba-replacement'
                );
            }
        });
        const replacementBody = findBody(tick67.evidence.bodies, replacementHandle);
        const exactSlotIncarnationReused = Boolean(
            oldCorkBodyAtClose
            && replacementBody
            && replacementBody.index === oldCorkBodyAtClose.index
            && replacementHandle.entityId === corkHandle.entityId
            && replacementHandle.incarnation > corkHandle.incarnation
        );
        const tick68 = await advanceTick({
            harness,
            tick: 68,
            label: 'Cork replacement lease T68'
        });
        const replacementLease = tick68.boundary.route.assignments.find(
            ({ ownerHandle }) => exactHandle(ownerHandle, replacementHandle)
        );
        const staleBefore = director.getAvailabilitySnapshot();
        const rosterBeforeStale = director.getStatus();
        const staleRequest = endpoint.requestDespawn(
            corkHandle,
            'stale-route-owner',
            69,
            'cork-main:stale-owner'
        );
        assert(staleRequest.accepted === true,
            `stale ABA request queue failed: ${JSON.stringify(staleRequest)}`);
        const tick69 = await advanceTick({
            harness,
            tick: 69,
            label: 'Cork stale owner ABA T69'
        });
        const staleLifecycle = tick69.lifecycle;
        const staleAfter = director.getAvailabilitySnapshot();
        const rosterAfterStale = director.getStatus();
        const abaOldIncarnationDidNotReopen = exactSlotIncarnationReused
            && Boolean(replacementLease)
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
                activeActorReroutedForward:
                    activeBefore.routeState.currentPathIndex === upperPathIndex
                    && activeAfter.routeState.currentPathIndex === lowerPathIndex,
                trappedActorWaitedAtClearance:
                    trappedWaiting.routeState.phase
                        === GPU_ROUTE_RUNTIME_PHASE.WAITING
                    && trappedWaiting.routeState.pendingFieldIndex
                        === upperClosure.clearanceFieldIndex,
                waitingActorResumedAfterReopen:
                    trappedResumed?.routeState.phase
                        === GPU_ROUTE_RUNTIME_PHASE.TRAVEL,
                closedPathCount: closeCompletion.closedPathIds.length,
                finalClosedPathCount: cleanupCompletion.closedPathIds.length
            }),
            interaction: Object.freeze({
                towerBlocked: Boolean(
                    towerBeforeBlock
                    && towerAfterBlock
                    && TOWER_BLOCKER_PROBE_START_DISTANCE
                        < minimumTowerSeparation
                    && towerDistanceAlongRoute
                        <= -minimumTowerSeparation + 0.15
                    && towerDistanceAlongRoute < 0
                ),
                projectilePhysicallyPassed: Boolean(
                    projectileAfter && projectileDistanceAlongRoute > 0
                ),
                projectileDamagedCork: Boolean(damageEvent),
                projectilePenetrationRemaining: Boolean(
                    projectileAfter && projectileAfter.healthFixedPoint > 0
                )
            }),
            abaOldIncarnationDidNotReopen,
            coexistence: Object.freeze({
                bodyAbiVersion: simulationStatus.abiVersion,
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
                x: upperRoute.waypoints[4].x,
                y: upperRoute.waypoints[4].y + (index * 0.02)
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
        '8-Cork roster did not publish atomically');
        const ninthIntent = createDynamicRouteIntent({
            definition: BASIC_CORK_ENEMY_DATA,
            route: upperRoute,
            position: upperRoute.waypoints[4],
            spawnSequence: 9,
            availability: director.getAvailabilitySnapshot(),
            graphContentKey: initialRuntime.graphContentKey
        });
        assert(endpoint.requestSpawnBatch([{
            intent: ninthIntent,
            targetFixedTick: 2,
            commandId: 'cork-capacity:ninth'
        }]).accepted, 'ninth Cork ingress should reach route preflight');
        const tick2 = await advanceTick({
            harness,
            tick: 2,
            label: 'Cork capacity T2'
        });
        const rejected = tick2.lifecycle.rejected.find(
            ({ commandId }) => commandId === 'cork-capacity:ninth'
        );
        const runtime = endpoint.getRouteAvailabilityRuntimeStatus();
        return Object.freeze({
            maximumCloserCount: GPU_ROUTE_RUNTIME_MAX_CLOSERS,
            ninthRejectedWholeBatch: rejected?.code === 'route-roster-capacity'
                && tick2.lifecycle.rejected.length === 1
                && tick2.lifecycle.recoveryRequired === false
                && tick2.lifecycle.spawned.every(
                    ({ commandId }) => commandId !== 'cork-capacity:ninth'
                )
                && runtime.rosterCount === ROUTE_AVAILABILITY_MAX_CORK_ROSTER,
            ninthRejectionRecoveryRequired:
                tick2.lifecycle.recoveryRequired === true
                || endpoint.requiresRecovery(),
            activeCloserCount: runtime.rosterCount
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
            intent: createCorkIntent(harness, 1, upperRoute.waypoints[4]),
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

async function runFixture(device, format) {
    const main = await runClosureRoutingAndInteraction(device, format);
    const capacity = await runCapacity(device, format);
    const terminalReplacement = await runTerminalAndReplacement(device, format);
    return Object.freeze({
        scenario: 'cork-dynamic-route-closure',
        lifecycle: main.lifecycle,
        route: main.route,
        interaction: main.interaction,
        capacity: Object.freeze({
            ...capacity,
            abaOldIncarnationDidNotReopen: main.abaOldIncarnationDidNotReopen
        }),
        terminal: terminalReplacement.terminal,
        replacement: terminalReplacement.replacement,
        coexistence: Object.freeze({
            bodyAbiVersion: GPU_CIRCLE_BODY_ABI_VERSION,
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
