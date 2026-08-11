import {
    BASIC_CIRCLE_ENEMY_DATA,
    MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE
} from './production/script/data/object/enemy/basic_circle_enemy_data.js';
import {
    BASIC_OCTA_ENEMY_CAPABILITY_MASK,
    BASIC_OCTA_ENEMY_DATA,
    BASIC_OCTA_ENEMY_DEFINITION_ID,
    BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE,
    BASIC_OCTA_ORBIT_SLOT_FILL_ORDER
} from './production/script/data/object/enemy/basic_octa_enemy_data.js';
import {
    TileMap
} from './production/script/module/ingame/map/tile_map.js';
import {
    ENEMY_CAPABILITY_BIT
} from './production/script/module/ingame/contract/enemy_capability_contract.js';
import {
    ENEMY_ORBIT_SLOT_UNASSIGNED
} from './production/script/module/ingame/contract/enemy_orbit_directional_defense_contract.js';
import {
    FORMATION_COORDINATE_SYSTEM_CODE
} from './production/script/module/ingame/contract/enemy_formation_contract.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_TEAM_ID
} from './production/script/module/ingame/contract/gameplay_team_contract.js';
import {
    GpuEnemySimulationEndpoint
} from './production/script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js';
import {
    EnemySimulationBackend
} from './production/script/module/ingame/object/enemy/enemy_simulation_backend.js';
import {
    ENEMY_ORBIT_SLOT_METADATA_CORRUPTION_CODE,
    EnemyLifecycleCommandOwner
} from './production/script/module/ingame/object/enemy/enemy_lifecycle_command_owner.js';
import {
    createGpuEnemySpawnIntent
} from './production/script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js';
import {
    createGpuRegistryMetadata
} from './production/script/module/ingame/object/gpu_spawn_intent.js';
import {
    createGpuTowerSpawnIntent
} from './production/script/module/ingame/object/tower/gpu_tower_spawn_adapter.js';
import {
    GPU_CIRCLE_APPLIED_EVENT_FLAG,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    GPU_CIRCLE_BODY_RENDER_SHAPE,
    GPU_CIRCLE_BODY_SIMULATION_FLAG,
    GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM,
    GPU_CIRCLE_ENEMY_BEHAVIOR_STATE,
    GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI
} from './production/script/module/ingame/physics/gpu/gpu_circle_body_abi.js';
import {
    createGpuSignedDistanceFieldSnapshot,
    sampleGpuWorldSignedDistance
} from './production/script/module/ingame/physics/gpu/gpu_signed_distance_field.js';
import { WorldRegistry } from './production/script/module/ingame/object/world_registry.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const REQUIRED_STORAGE_BUFFER_LIMIT = 9;
const FIXED_DELTA = 1 / 60;
const ORBIT_PHASE_SCALE = 0x100000000;
const ORBIT_RADIUS = 6;
const ORBIT_CAPTURE_SEED_RADIUS = 5.999;
const DAMAGE_SCALE = 100;
const DAMAGE_PROBE_RADIUS = 0.4;
const SHIELD_SOURCE_TO_OCTA_DISTANCE = 0.1;
const SHIELD_OCTA_TO_REAR_DISTANCE = 0.65;
const OPEN_ORBIT_MAP_DATA = Object.freeze({
    id: 'nw-octagon-open-orbit-authority',
    macroRows: 1,
    macroColumns: 3,
    pathWidthTiles: 16,
    directionBlueprint: Object.freeze(['abc']),
    coreMacroCell: Object.freeze([0, 2]),
    towerSpawnMacroCell: Object.freeze([0, 1]),
    enemySpawnRoutes: Object.freeze([
        Object.freeze({
            gateId: 'nw-octagon-open-gate',
            pathId: 'nw-octagon-open-path',
            macroCells: Object.freeze([
                Object.freeze([0, 0]),
                Object.freeze([0, 1]),
                Object.freeze([0, 2])
            ])
        })
    ])
});

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertNear(actual, expected, tolerance, label) {
    assert(
        Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
        `${label}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`
    );
}

function exactHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function createOpenOrbitTileMap() {
    return new TileMap(OPEN_ORBIT_MAP_DATA);
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

function withIdentity(intent, entityId, incarnation = 1, overrides = {}) {
    return Object.freeze({
        ...intent,
        entityId,
        incarnation,
        ...overrides
    });
}

function createOctaIntent(route, spawnSequence, overrides = {}) {
    return Object.freeze({
        ...createGpuEnemySpawnIntent({
            definition: BASIC_OCTA_ENEMY_DATA,
            route,
            spawnSequence,
            waveId: 'nw-octagon-directional-defense',
            policyId: 'hardware-fixture'
        }),
        ...overrides
    });
}

function materializeOctaIntent(route, spawnSequence, orbitSlotIndex, overrides = {}) {
    const raw = createOctaIntent(route, spawnSequence);
    return Object.freeze({
        ...raw,
        orbitSlotIndex,
        enemyBehaviorState: Object.freeze({
            ...raw.enemyBehaviorState,
            orbitSlotIndex
        }),
        ...overrides
    });
}

function createEndpoint(device, format, capacity, frameTarget = null) {
    return new GpuEnemySimulationEndpoint({
        webGpuPlatformPort: createPlatformPort(device, format, frameTarget),
        enemySimulationBackendFactory: (dependencies, options) => (
            new EnemySimulationBackend(dependencies, options)
        )
    }, {
        capacity
    });
}

async function waitForSimulation(endpointOrBackend, label, timeoutMs = 5_000) {
    const backend = typeof endpointOrBackend.getBackend === 'function'
        ? endpointOrBackend.getBackend()
        : endpointOrBackend;
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

async function readBodies(endpointOrBackend) {
    const backend = typeof endpointOrBackend.getBackend === 'function'
        ? endpointOrBackend.getBackend()
        : endpointOrBackend;
    const promise = backend.simulation.readbackBodies();
    await backend.simulation.device.queue.onSubmittedWorkDone();
    return promise;
}

function findBody(bodies, handle, label) {
    const body = bodies.find((candidate) => exactHandle(candidate.handle, handle));
    assert(body, `${label}: ${JSON.stringify(handle)}`);
    return body;
}

function orbitAngle(slotIndex, fixedTick, angularStepQ32) {
    const phase = (
        0x80000000
        + ((slotIndex << 29) >>> 0)
        + Math.imul(fixedTick >>> 0, angularStepQ32 >>> 0)
    ) >>> 0;
    return phase * ((Math.PI * 2) / ORBIT_PHASE_SCALE);
}

function orbitPosition(
    center,
    slotIndex,
    fixedTick,
    angularStepQ32,
    radius = ORBIT_RADIUS
) {
    const angle = orbitAngle(slotIndex, fixedTick, angularStepQ32);
    return Object.freeze({
        x: Math.fround(center.x + (Math.cos(angle) * radius)),
        y: Math.fround(center.y + (Math.sin(angle) * radius))
    });
}

function gpuF32SquaredDistance(left, right) {
    const deltaX = Math.fround(
        Math.fround(left.x) - Math.fround(right.x)
    );
    const deltaY = Math.fround(
        Math.fround(left.y) - Math.fround(right.y)
    );
    return Math.fround(
        Math.fround(deltaX * deltaX) + Math.fround(deltaY * deltaY)
    );
}

function predictGpuF32Position(position, velocity, deltaSeconds) {
    const fixedDelta = Math.fround(deltaSeconds);
    return Object.freeze({
        x: Math.fround(
            Math.fround(position.x)
            + Math.fround(Math.fround(velocity.x) * fixedDelta)
        ),
        y: Math.fround(
            Math.fround(position.y)
            + Math.fround(Math.fround(velocity.y) * fixedDelta)
        )
    });
}

function assertCaptureSeedInside(center, position, label) {
    const squaredDistance = gpuF32SquaredDistance(center, position);
    const squaredRadius = Math.fround(ORBIT_RADIUS * ORBIT_RADIUS);
    assert(squaredDistance < squaredRadius,
        `${label}: f32 capture seed is outside radius ${JSON.stringify({
            center,
            position,
            squaredDistance,
            squaredRadius
        })}`);
    return squaredDistance;
}

function assertOrbitSpawnPositionValid(
    tileMap,
    signedDistanceField,
    position,
    bodyRadius,
    label
) {
    const tile = tileMap.worldToTile(position.x, position.y, {});
    const signedDistance = sampleGpuWorldSignedDistance(
        signedDistanceField,
        tileMap.getWorldBounds(),
        position.x,
        position.y
    );
    assert(tile.inside && tileMap.isWalkableTile(tile.row, tile.column),
        `${label}: desired slot is not on walkable open-map authority`);
    assert(Number.isFinite(signedDistance) && signedDistance > bodyRadius,
        `${label}: insufficient SDF clearance ${signedDistance} <= ${bodyRadius}`);
    return Object.freeze({
        slotLabel: label,
        x: position.x,
        y: position.y,
        row: tile.row,
        column: tile.column,
        signedDistance
    });
}

function normalizedAngleDelta(before, after) {
    let delta = after - before;
    while (delta < 0) delta += Math.PI * 2;
    while (delta >= Math.PI * 2) delta -= Math.PI * 2;
    return delta;
}

function shortestAngleDelta(before, after) {
    return Math.atan2(Math.sin(after - before), Math.cos(after - before));
}

function activeOrbitSlotCount(registry) {
    return registry.copyActiveHandlesInto([], { kindId: 'enemy' })
        .map((handle) => registry.copyEntityView(handle, {}))
        .filter((view) => Number.isInteger(view?.metadata?.orbitSlotIndex))
        .length;
}

async function submitEndpointTick(endpoint, tick, label, commit = true) {
    const lifecycle = commit ? endpoint.commitAtFixedBoundary(tick) : null;
    assert(!lifecycle?.recoveryRequired,
        `${label}: commit recovery ${JSON.stringify(lifecycle)}`);
    assert(endpoint.fixedUpdate(FIXED_DELTA, tick), `${label}: fixed submit failed`);
    await waitForSimulation(endpoint, label);
    const bodies = await readBodies(endpoint);
    const completed = endpoint.commitCompletedEventsAtFixedBoundary(tick + 1);
    assert(completed.protocolFailure === null,
        `${label}: completed event failure ${JSON.stringify(completed)}`);
    return Object.freeze({ lifecycle, bodies, completed });
}

async function readTexturePixels(device, texture, width, height) {
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const target = device.createBuffer({
        label: 'cirvivor-nw-octagon-render-readback',
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer(
            { texture },
            { buffer: target, bytesPerRow, rowsPerImage: height },
            [width, height]
        );
        device.queue.submit([encoder.finish()]);
        await target.mapAsync(GPUMapMode.READ);
        return Object.freeze({
            bytes: new Uint8Array(target.getMappedRange()).slice(),
            bytesPerRow
        });
    } finally {
        try {
            target.unmap();
        } catch {
            // already unmapped
        }
        target.destroy();
    }
}

function readRgbaPixel(frame, format, x, y) {
    const offset = (y * frame.bytesPerRow) + (x * 4);
    const bytes = frame.bytes.slice(offset, offset + 4);
    return format.startsWith('bgra')
        ? Object.freeze({ r: bytes[2], g: bytes[1], b: bytes[0], a: bytes[3] })
        : Object.freeze({ r: bytes[0], g: bytes[1], b: bytes[2], a: bytes[3] });
}

function unpremultiplyRgba(rgba) {
    if (rgba.a === 0) {
        return Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
    }
    const inverseAlpha = 255 / rgba.a;
    return Object.freeze({
        r: Math.min(255, rgba.r * inverseAlpha),
        g: Math.min(255, rgba.g * inverseAlpha),
        b: Math.min(255, rgba.b * inverseAlpha),
        a: rgba.a
    });
}

function analyzeArmorRoi(frame, format, center, halfSize = 2) {
    let opaquePixelCount = 0;
    let armorPixelCount = 0;
    let maximumArmorScore = Number.NEGATIVE_INFINITY;
    let strongest = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
    for (let y = center.y - halfSize; y <= center.y + halfSize; y++) {
        for (let x = center.x - halfSize; x <= center.x + halfSize; x++) {
            const rgba = readRgbaPixel(frame, format, x, y);
            if (rgba.a === 0) continue;
            opaquePixelCount++;
            const unpremultiplied = unpremultiplyRgba(rgba);
            const armorScore = (unpremultiplied.g + unpremultiplied.b)
                - (2 * unpremultiplied.r);
            if (armorScore > maximumArmorScore) {
                maximumArmorScore = armorScore;
                strongest = unpremultiplied;
            }
            armorPixelCount += Number(armorScore >= 40);
        }
    }
    return Object.freeze({
        opaquePixelCount,
        armorPixelCount,
        maximumArmorScore,
        strongest
    });
}

async function runLifecycleOrbitTowerLoss(device, format) {
    const tileMap = createOpenOrbitTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const towerPosition = tileMap.getTowerSpawnPosition();
    const corePosition = tileMap.getCorePosition();
    const signedDistanceField = createGpuSignedDistanceFieldSnapshot(
        tileMap.getNavigationGrid()
    );
    const width = 256;
    const height = 256;
    const texture = device.createTexture({
        label: 'cirvivor-nw-octagon-render-target',
        size: [width, height],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    const frameTarget = Object.freeze({
        device,
        deviceGeneration: 1,
        texture,
        view: texture.createView(),
        format,
        width,
        height
    });
    const endpoint = createEndpoint(device, format, 16, frameTarget);
    let towerHandle;
    let initialHandles;
    try {
        endpoint.init(tileMap);
        const rawOcta = createOctaIntent(route, 0);
        const angularStepQ32 = rawOcta.enemyBehaviorState.angularStepQ32;
        const initialSlots = [0, 4, 2];
        const initialDesiredPositions = initialSlots.map((slot) => (
            orbitPosition(towerPosition, slot, 1, angularStepQ32)
        ));
        const initialSeedPositions = initialSlots.map((slot) => (
            orbitPosition(
                towerPosition,
                slot,
                1,
                angularStepQ32,
                ORBIT_CAPTURE_SEED_RADIUS
            )
        ));
        const initialCaptureSeedSquaredDistanceSamples = initialSeedPositions.map(
            (position, index) => assertCaptureSeedInside(
                towerPosition,
                position,
                `initial-slot-${initialSlots[index]}`
            )
        );
        const initialPositionEvidence = initialDesiredPositions.map(
            (position, index) => assertOrbitSpawnPositionValid(
                tileMap,
                signedDistanceField,
                position,
                rawOcta.radius,
                `initial-slot-${initialSlots[index]}`
            )
        );
        const initialSeedPositionEvidence = initialSeedPositions.map(
            (position, index) => assertOrbitSpawnPositionValid(
                tileMap,
                signedDistanceField,
                position,
                rawOcta.radius,
                `initial-seed-${initialSlots[index]}`
            )
        );
        const requests = [{
            intent: createGpuTowerSpawnIntent({ position: towerPosition }),
            targetFixedTick: 1,
            commandId: 'octagon:tower:initial'
        }, ...Array.from({ length: 3 }, (_, index) => ({
            intent: createOctaIntent(route, index, {
                position: initialSeedPositions[index],
                waypointIndex: route.waypoints.length - 1
            }),
            targetFixedTick: 1,
            commandId: `octagon:initial:${index}`
        }))];
        const receipt = endpoint.requestSpawnBatch(requests);
        assert(receipt.accepted && receipt.queuedCount === 4,
            `initial batch rejected ${JSON.stringify(receipt)}`);
        const firstCommit = endpoint.commitAtFixedBoundary(1);
        towerHandle = firstCommit.spawned.find(
            ({ commandId }) => commandId === 'octagon:tower:initial'
        )?.handle;
        initialHandles = firstCommit.spawned
            .filter(({ commandId }) => commandId.startsWith('octagon:initial:'))
            .map(({ handle }) => handle);
        assert(firstCommit.state === 'committed'
            && towerHandle
            && initialHandles.length === 3,
        `initial exact handles missing ${JSON.stringify(firstCommit)}`);
        assert(endpoint.configureTowerGameplayTarget(towerHandle).accepted,
            'exact Tower gameplay target rejected');
        const first = await submitEndpointTick(endpoint, 1, 'octagon first orbit', false);
        const registry = endpoint.getRegistry();
        const firstBodies = initialHandles.map((handle) => (
            findBody(first.bodies, handle, 'initial O body')
        ));
        const towerBody = findBody(first.bodies, towerHandle, 'initial Tower body');
        const stableSlots = initialHandles.map((handle) => (
            registry.copyEntityView(handle, {}).metadata.orbitSlotIndex
        ));
        assert(JSON.stringify(stableSlots) === JSON.stringify([0, 4, 2]),
            `initial slots drift ${JSON.stringify(stableSlots)}`);
        const desiredPositionErrorSamples = firstBodies.map((body, index) => (
            Math.hypot(
                body.position.x - initialDesiredPositions[index].x,
                body.position.y - initialDesiredPositions[index].y
            )
        ));
        desiredPositionErrorSamples.forEach((error, index) => (
            assertNear(error, 0, 0.001, `initial slot ${initialSlots[index]} desired pose`)
        ));
        const radiusSamples = firstBodies.map((body) => Math.hypot(
            body.position.x - towerBody.position.x,
            body.position.y - towerBody.position.y
        ));
        const expectedFinalFlowFieldIndex = route.waypoints.length - 2;
        const flowFieldIndexSamples = firstBodies.map(({ flowFieldIndex }) => (
            flowFieldIndex
        ));
        assert(flowFieldIndexSamples.every(
            (flowFieldIndex) => flowFieldIndex === expectedFinalFlowFieldIndex
        ), `initial O flow stage is not Core authority ${JSON.stringify({
            expectedFinalFlowFieldIndex,
            flowFieldIndexSamples
        })}`);
        const facingSamples = firstBodies.map((body) => {
            const radialLength = Math.hypot(
                body.position.x - towerBody.position.x,
                body.position.y - towerBody.position.y
            );
            const sample = Object.freeze({
                x: body.enemyBehaviorState.facing.x,
                y: body.enemyBehaviorState.facing.y,
                radialX: (body.position.x - towerBody.position.x) / radialLength,
                radialY: (body.position.y - towerBody.position.y) / radialLength
            });
            assertNear(Math.hypot(sample.x, sample.y), 1, 0.001, 'facing length');
            assertNear(
                (sample.x * sample.radialX) + (sample.y * sample.radialY),
                -1,
                0.01,
                'facing inward dot'
            );
            return sample;
        });
        const targetHandles = firstBodies.map((body) => Object.freeze({
            entityId: body.enemyBehaviorState.targetEntityId,
            incarnation: body.enemyBehaviorState.targetIncarnation
        }));
        assert(targetHandles.every((handle) => exactHandle(handle, towerHandle)),
            `O target handle mismatch ${JSON.stringify(targetHandles)}`);
        const captureStateSamples = firstBodies.map((body) => Object.freeze({
            state: body.enemyBehaviorState.state,
            flags: body.enemyBehaviorState.flags,
            flowEnabled: (body.simulationMeta
                & GPU_CIRCLE_BODY_SIMULATION_FLAG.USE_FLOW) !== 0
        }));
        assert(captureStateSamples.every((sample) => (
            sample.state === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.ORBIT_TOWER
            && sample.flags === (
                GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.TARGET_VALID
                | GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.DIRECTIONAL_DEFENSE_ACTIVE
            )
            && sample.flowEnabled === false
        )), `prepositioned O did not capture orbit ${JSON.stringify(captureStateSamples)}`);

        endpoint.updatePresentation({
            frameDelta: 0,
            fixedDelta: FIXED_DELTA,
            fixedAlpha: 1,
            renderFrameId: 1
        });
        const scale = 12;
        const renderCamera = Object.freeze({
            worldToViewport(x, y, out) {
                out.x = (width * 0.5) + ((x - towerPosition.x) * scale);
                out.y = (height * 0.5) + ((y - towerPosition.y) * scale);
                return out;
            },
            getScale: () => scale
        });
        assert(endpoint.draw(renderCamera), 'octagon hardware draw failed');
        await device.queue.onSubmittedWorkDone();
        const pixels = await readTexturePixels(device, texture, width, height);
        const renderBody = firstBodies[0];
        const renderFacing = renderBody.enemyBehaviorState.facing;
        const renderRadiusPixels = renderBody.radius
            * (renderBody.renderStyle?.radiusScale ?? 1)
            * scale;
        const renderCenter = Object.freeze(renderCamera.worldToViewport(
            renderBody.position.x,
            renderBody.position.y,
            {}
        ));
        const frontCenter = Object.freeze({
            x: Math.round(renderCenter.x
                + (renderFacing.x * renderRadiusPixels * 0.9)),
            y: Math.round(renderCenter.y
                + (renderFacing.y * renderRadiusPixels * 0.9))
        });
        const rearCenter = Object.freeze({
            x: Math.round(renderCenter.x
                - (renderFacing.x * renderRadiusPixels * 0.9)),
            y: Math.round(renderCenter.y
                - (renderFacing.y * renderRadiusPixels * 0.9))
        });
        for (const [label, center] of [
            ['front', frontCenter],
            ['rear', rearCenter]
        ]) {
            assert(Number.isFinite(center.x)
                && Number.isFinite(center.y)
                && center.x >= 2
                && center.x < width - 2
                && center.y >= 2
                && center.y < height - 2,
            `${label} armor ROI is outside translated viewport ${JSON.stringify(center)}`);
        }
        const frontArmor = analyzeArmorRoi(pixels, format, frontCenter);
        const rearArmor = analyzeArmorRoi(pixels, format, rearCenter);
        assert(frontArmor.opaquePixelCount > 0
            && rearArmor.opaquePixelCount > 0
            && frontArmor.armorPixelCount > 0
            && rearArmor.armorPixelCount === 0
            && frontArmor.maximumArmorScore
                >= rearArmor.maximumArmorScore + 40,
        `front/rear armor pixels not separated ${JSON.stringify({
            frontCenter,
            rearCenter,
            frontArmor,
            rearArmor
        })}`);

        const fillSlots = [6, 1, 5, 3, 7];
        const fillDesiredPositions = fillSlots.map((slot) => (
            orbitPosition(towerPosition, slot, 2, angularStepQ32)
        ));
        const fillSeedPositions = fillSlots.map((slot) => (
            orbitPosition(
                towerPosition,
                slot,
                2,
                angularStepQ32,
                ORBIT_CAPTURE_SEED_RADIUS
            )
        ));
        const fillCaptureSeedSquaredDistanceSamples = fillSeedPositions.map(
            (position, index) => assertCaptureSeedInside(
                towerPosition,
                position,
                `fill-slot-${fillSlots[index]}`
            )
        );
        const fillPositionEvidence = fillDesiredPositions.map(
            (position, index) => assertOrbitSpawnPositionValid(
                tileMap,
                signedDistanceField,
                position,
                rawOcta.radius,
                `fill-slot-${fillSlots[index]}`
            )
        );
        const fillSeedPositionEvidence = fillSeedPositions.map(
            (position, index) => assertOrbitSpawnPositionValid(
                tileMap,
                signedDistanceField,
                position,
                rawOcta.radius,
                `fill-seed-${fillSlots[index]}`
            )
        );
        assert(endpoint.requestSpawnBatch(Array.from({ length: 5 }, (_, index) => ({
            intent: createOctaIntent(route, 3 + index, {
                position: fillSeedPositions[index],
                waypointIndex: route.waypoints.length - 1
            }),
            targetFixedTick: 2,
            commandId: `octagon:fill:${index}`
        }))).accepted, 'five O fill batch rejected');
        const second = await submitEndpointTick(endpoint, 2, 'octagon second orbit');
        const secondBodies = initialHandles.map((handle) => (
            findBody(second.bodies, handle, 'second O body')
        ));
        const fillHandles = second.lifecycle.spawned
            .filter(({ commandId }) => commandId.startsWith('octagon:fill:'))
            .map(({ handle }) => handle);
        assert(fillHandles.length === 5, 'fill O exact handles missing');
        const leasedFillSlots = fillHandles.map((handle) => (
            registry.copyEntityView(handle, {}).metadata.orbitSlotIndex
        ));
        assert(JSON.stringify(leasedFillSlots) === JSON.stringify(fillSlots),
            `fill slots drift ${JSON.stringify(leasedFillSlots)}`);
        const fillDesiredPositionErrorSamples = fillHandles.map((handle, index) => {
            const body = findBody(second.bodies, handle, 'fill O body');
            return Math.hypot(
                body.position.x - fillDesiredPositions[index].x,
                body.position.y - fillDesiredPositions[index].y
            );
        });
        fillDesiredPositionErrorSamples.forEach((error, index) => (
            assertNear(error, 0, 0.001, `fill slot ${fillSlots[index]} desired pose`)
        ));
        const angularStepSamples = firstBodies.map((body, index) => {
            const before = Math.atan2(
                body.position.y - towerBody.position.y,
                body.position.x - towerBody.position.x
            );
            const after = Math.atan2(
                secondBodies[index].position.y - towerPosition.y,
                secondBodies[index].position.x - towerPosition.x
            );
            return normalizedAngleDelta(before, after);
        });
        angularStepSamples.forEach((value) => (
            assertNear(value, 0.25 / 60, 0.00001, 'angular step')
        ));
        assert(activeOrbitSlotCount(registry) === 8,
            'eight-slot fill did not lease all slots');

        const activeCountBefore = registry.getActiveCount();
        const reservedCountBefore = registry.getReservedCount();
        const slotCountBefore = activeOrbitSlotCount(registry);
        const shortageReceipt = endpoint.requestSpawnBatch([{
            intent: createGpuEnemySpawnIntent({
                definition: BASIC_CIRCLE_ENEMY_DATA,
                route,
                spawnSequence: 90,
                waveId: 'nw-octagon-capacity',
                policyId: 'hardware-fixture'
            }),
            targetFixedTick: 3,
            commandId: 'octagon:capacity:normal-prefix'
        }, {
            intent: createOctaIntent(route, 91),
            targetFixedTick: 3,
            commandId: 'octagon:capacity:overflow'
        }]);
        assert(shortageReceipt.accepted, 'capacity batch ingress rejected early');
        const shortageCommit = endpoint.commitAtFixedBoundary(3);
        assert(shortageCommit.state === 'committed-with-rejections'
            && shortageCommit.spawned.length === 0
            && shortageCommit.rejected.length === 2
            && shortageCommit.rejected.every(
                ({ code }) => code === 'orbit-slot-capacity'
            )
            && shortageCommit.recoveryRequired === false,
        `capacity whole-batch rejection mismatch ${JSON.stringify(shortageCommit)}`);
        await submitEndpointTick(endpoint, 3, 'octagon capacity submit', false);
        const consumedRetryReasons = [
            endpoint.requestSpawn(
                createGpuEnemySpawnIntent({
                    definition: BASIC_CIRCLE_ENEMY_DATA,
                    route,
                    spawnSequence: 92,
                    waveId: 'nw-octagon-capacity',
                    policyId: 'hardware-fixture'
                }),
                4,
                'octagon:capacity:normal-prefix'
            ).reason,
            endpoint.requestSpawn(
                createOctaIntent(route, 93),
                4,
                'octagon:capacity:overflow'
            ).reason
        ];
        assert(consumedRetryReasons.every((reason) => reason === 'duplicate-command'),
            `capacity rejection did not consume command IDs ${JSON.stringify(consumedRetryReasons)}`);
        const shortage = Object.freeze({
            reason: 'orbit-slot-capacity',
            requestedCount: 2,
            acceptedCount: 0,
            activeCountBefore,
            activeCountAfter: registry.getActiveCount(),
            reservedCountBefore,
            reservedCountAfter: registry.getReservedCount(),
            slotCountBefore,
            slotCountAfter: activeOrbitSlotCount(registry),
            consumedRetryReasons,
            recoveryRequired: shortageCommit.recoveryRequired
        });
        assert(shortage.activeCountBefore === shortage.activeCountAfter
            && shortage.reservedCountBefore === shortage.reservedCountAfter
            && shortage.slotCountBefore === shortage.slotCountAfter,
        `capacity zero-mutation mismatch ${JSON.stringify(shortage)}`);

        const towerLossTick = 4;
        assert(endpoint.requestDespawn(
            towerHandle,
            'octagon-tower-loss',
            towerLossTick,
            'octagon:tower:loss'
        ).accepted, 'Tower despawn request rejected');
        const beforeLossBody = findBody(
            second.bodies,
            initialHandles[0],
            'pre-loss O'
        );
        const orbitSlotBefore = registry.copyEntityView(
            initialHandles[0],
            {}
        ).metadata.orbitSlotIndex;
        const loss = await submitEndpointTick(
            endpoint,
            towerLossTick,
            'octagon Tower loss'
        );
        let fallbackBody = findBody(loss.bodies, initialHandles[0], 'fallback O');
        assert(fallbackBody.enemyBehaviorState.state
            === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.CORE_FALLBACK,
        `Tower loss did not latch fallback ${JSON.stringify(fallbackBody)}`);
        const coreDistanceBefore = Math.hypot(
            fallbackBody.position.x - corePosition.x,
            fallbackBody.position.y - corePosition.y
        );
        let coreDistanceAfter = coreDistanceBefore;
        let nextTick = towerLossTick + 1;
        for (; nextTick <= towerLossTick + 12; nextTick++) {
            const progressed = await submitEndpointTick(
                endpoint,
                nextTick,
                `octagon Core fallback ${nextTick}`
            );
            fallbackBody = findBody(progressed.bodies, initialHandles[0], 'progressing O');
            coreDistanceAfter = Math.hypot(
                fallbackBody.position.x - corePosition.x,
                fallbackBody.position.y - corePosition.y
            );
            if (coreDistanceAfter < coreDistanceBefore) break;
        }
        assert(coreDistanceAfter < coreDistanceBefore,
            `Core fallback did not decrease distance ${coreDistanceBefore} -> ${coreDistanceAfter}`);

        const replacementTick = nextTick + 1;
        assert(endpoint.requestSpawn(
            createGpuTowerSpawnIntent({ position: towerPosition }),
            replacementTick,
            'octagon:tower:replacement'
        ).accepted, 'replacement Tower ingress rejected');
        const replacementCommit = endpoint.commitAtFixedBoundary(replacementTick);
        const replacementTower = replacementCommit.spawned[0]?.handle;
        assert(replacementTower && !exactHandle(replacementTower, towerHandle),
            `Tower ABA identity not replaced ${JSON.stringify(replacementCommit)}`);
        assert(endpoint.configureTowerGameplayTarget(replacementTower).accepted,
            'replacement Tower configure rejected');
        const rebound = await submitEndpointTick(
            endpoint,
            replacementTick,
            'octagon replacement no-reorbit',
            false
        );
        const latched = findBody(rebound.bodies, initialHandles[0], 'latched O');
        assert(latched.enemyBehaviorState.state
            === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.CORE_FALLBACK
            && latched.enemyBehaviorState.flags === 0
            && bodyUsesFlow(latched),
        `replacement Tower rebound O ${JSON.stringify(latched.enemyBehaviorState)}`);
        const orbitSlotAfter = registry.copyEntityView(
            initialHandles[0],
            {}
        ).metadata.orbitSlotIndex;
        assert(orbitSlotAfter === orbitSlotBefore,
            'Tower loss incorrectly released active O lease');

        const gpuStatus = endpoint.getStatus().backend.gpu;
        const storage = gpuStatus.fixedPrimitives.storageProfile;
        assert(storage.directionalDefenseClassifier === 8
            && storage.enemyBehavior === 8
            && gpuStatus.formations.storageProfile.render === 8
            && storage.contactHandling === 9
            && storage.requiredMaximum === 9,
        `storage profile drift ${JSON.stringify({ storage, formations: gpuStatus.formations })}`);

        return Object.freeze({
            lifecycle: Object.freeze({
                requestedCount: 3,
                acceptedCount: 3,
                uniqueHandleCount: new Set(initialHandles.map(handleKey)).size,
                uniqueSlotCount: new Set(stableSlots).size,
                stableSlots,
                activeHandles: initialHandles.map((handle) => Object.freeze({ ...handle })),
                allStableSlots: [...stableSlots, ...leasedFillSlots],
                exactTowerHandle: Object.freeze({ ...towerHandle }),
                targetHandles,
                shortage,
                corruptedMetadata: runCorruptedMetadataContract(route)
            }),
            orbit: Object.freeze({
                mapId: tileMap.mapId,
                phaseBaseQ32: 0x80000000,
                captureSeedRadius: ORBIT_CAPTURE_SEED_RADIUS,
                towerPosition: Object.freeze({
                    x: towerPosition.x,
                    y: towerPosition.y
                }),
                slotZeroDesiredPosition: initialDesiredPositions[0],
                slotZeroSeedPosition: initialSeedPositions[0],
                sampleCount: radiusSamples.length,
                radiusSamples,
                angularStepSamples,
                bodyRadius: rawOcta.radius,
                expectedFinalFlowFieldIndex,
                flowFieldIndexSamples,
                captureStateSamples,
                desiredPositionErrorSamples: [
                    ...desiredPositionErrorSamples,
                    ...fillDesiredPositionErrorSamples
                ],
                captureSeedSquaredDistanceSamples: [
                    ...initialCaptureSeedSquaredDistanceSamples,
                    ...fillCaptureSeedSquaredDistanceSamples
                ],
                spawnPositionEvidence: [
                    ...initialPositionEvidence,
                    ...fillPositionEvidence
                ],
                captureSeedPositionEvidence: [
                    ...initialSeedPositionEvidence,
                    ...fillSeedPositionEvidence
                ]
            }),
            facing: Object.freeze({
                byteOffsetX: GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI.FACING_X,
                byteOffsetY: GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI.FACING_Y,
                samples: facingSamples
            }),
            render: Object.freeze({
                visibleFacetCount: 3,
                visibleFacetIndices: Array.from(
                    BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE.directionalDefense
                        .armoredFacetIndices
                ),
                armoredPixelCount: frontArmor.armorPixelCount,
                frontArmorPixelCount: frontArmor.armorPixelCount,
                rearArmorPixelCount: rearArmor.armorPixelCount,
                frontArmorScore: frontArmor.maximumArmorScore,
                rearArmorScore: rearArmor.maximumArmorScore,
                frontStrongestRgba: frontArmor.strongest,
                rearStrongestRgba: rearArmor.strongest
            }),
            towerLoss: Object.freeze({
                modeBefore: beforeLossBody.enemyBehaviorState.state
                    === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.ORBIT_TOWER
                    ? 'ORBIT_TOWER'
                    : 'unexpected',
                modeAfter: 'CORE_FALLBACK',
                latchedMode: latched.enemyBehaviorState.state
                    === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.CORE_FALLBACK
                    ? 'CORE_FALLBACK'
                    : 'unexpected',
                towerHandleBefore: Object.freeze({ ...towerHandle }),
                replacementTowerHandle: Object.freeze({ ...replacementTower }),
                targetHandleAfter: latched.enemyBehaviorState.targetEntityId === 0
                    && latched.enemyBehaviorState.targetIncarnation === 0
                    ? null
                    : Object.freeze({
                        entityId: latched.enemyBehaviorState.targetEntityId,
                        incarnation: latched.enemyBehaviorState.targetIncarnation
                    }),
                orbitSlotBefore,
                orbitSlotAfter,
                coreDistanceBefore,
                coreDistanceAfter,
                defenseActiveAfter: (latched.enemyBehaviorState.flags
                    & GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.DIRECTIONAL_DEFENSE_ACTIVE) !== 0,
                flowEnabledAfter: bodyUsesFlow(latched),
                reorbitAttemptCount: 0,
                recoveryRequired: endpoint.requiresRecovery()
            }),
            storageProfile: Object.freeze({
                classifier: storage.directionalDefenseClassifier,
                behavior: storage.enemyBehavior,
                render: gpuStatus.formations.storageProfile.render,
                contactHandling: storage.contactHandling,
                maximum: storage.requiredMaximum
            })
        });
    } finally {
        endpoint.destroy();
        texture.destroy();
    }
}

function bodyTargetHandle(body) {
    return Object.freeze({
        entityId: body.enemyBehaviorState.targetEntityId,
        incarnation: body.enemyBehaviorState.targetIncarnation
    });
}

function bodyUsesFlow(body) {
    return (body.simulationMeta & GPU_CIRCLE_BODY_SIMULATION_FLAG.USE_FLOW) !== 0;
}

async function runNaturalSeekCapture(device, format) {
    const tileMap = createOpenOrbitTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const towerPosition = tileMap.getTowerSpawnPosition();
    const endpoint = createEndpoint(device, format, 3);
    try {
        endpoint.init(tileMap);
        assert(endpoint.requestSpawnBatch([{
            intent: createGpuTowerSpawnIntent({ position: towerPosition }),
            targetFixedTick: 1,
            commandId: 'octagon:approach:tower'
        }, {
            intent: createOctaIntent(route, 500),
            targetFixedTick: 1,
            commandId: 'octagon:approach:natural-o'
        }]).accepted, 'natural O approach ingress rejected');
        const commit = endpoint.commitAtFixedBoundary(1);
        const towerHandle = commit.spawned.find(
            ({ commandId }) => commandId === 'octagon:approach:tower'
        )?.handle;
        const octaHandle = commit.spawned.find(
            ({ commandId }) => commandId === 'octagon:approach:natural-o'
        )?.handle;
        assert(towerHandle && octaHandle, 'natural O approach exact handles missing');
        assert(endpoint.configureTowerGameplayTarget(towerHandle).accepted,
            'natural O approach Tower target rejected');
        const first = await submitEndpointTick(
            endpoint,
            1,
            'natural O initial seek',
            false
        );
        const towerBody = findBody(first.bodies, towerHandle, 'approach Tower');
        let octaBody = findBody(first.bodies, octaHandle, 'approach O');
        const firstDistance = Math.hypot(
            octaBody.position.x - towerBody.position.x,
            octaBody.position.y - towerBody.position.y
        );
        const initialTowerDirection = Object.freeze({
            x: (towerBody.position.x - octaBody.position.x) / firstDistance,
            y: (towerBody.position.y - octaBody.position.y) / firstDistance
        });
        const initialFacingDot = (octaBody.enemyBehaviorState.facing.x
            * initialTowerDirection.x)
            + (octaBody.enemyBehaviorState.facing.y * initialTowerDirection.y);
        const initialFacingLength = Math.hypot(
            octaBody.enemyBehaviorState.facing.x,
            octaBody.enemyBehaviorState.facing.y
        );
        const initialFlags = octaBody.enemyBehaviorState.flags;
        const initialFlowFieldIndex = octaBody.flowFieldIndex;
        assert(octaBody.enemyBehaviorState.state
            === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.SEEK_TOWER
            && bodyUsesFlow(octaBody)
            && octaBody.enemyBehaviorState.flags
                === GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.TARGET_VALID
            && exactHandle(bodyTargetHandle(octaBody), towerHandle)
            && Math.abs(initialFacingLength - 1) <= 0.001
            && Math.abs(initialFacingDot - 1) <= 0.001
            && firstDistance > ORBIT_RADIUS,
        `natural O initial SEEK contract mismatch ${JSON.stringify({
            octaBody,
            towerHandle,
            firstDistance
        })}`);

        let previousDistance = firstDistance;
        let lastOutsideDistance = firstDistance;
        let captureTick = 0;
        let captureBody = null;
        for (let tick = 2; tick <= 360; tick++) {
            const progressed = await submitEndpointTick(
                endpoint,
                tick,
                `natural O approach ${tick}`
            );
            octaBody = findBody(progressed.bodies, octaHandle, 'approaching O');
            const distance = Math.hypot(
                octaBody.position.x - towerPosition.x,
                octaBody.position.y - towerPosition.y
            );
            if (octaBody.enemyBehaviorState.state
                === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.ORBIT_TOWER) {
                captureTick = tick;
                captureBody = octaBody;
                break;
            }
            assert(octaBody.enemyBehaviorState.state
                === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.SEEK_TOWER
                && bodyUsesFlow(octaBody)
                && octaBody.enemyBehaviorState.flags
                    === GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.TARGET_VALID
                && exactHandle(bodyTargetHandle(octaBody), towerHandle),
            `natural O pre-capture state drift at ${tick}: ${JSON.stringify(octaBody)}`);
            previousDistance = distance;
            if (distance > ORBIT_RADIUS) {
                lastOutsideDistance = distance;
            }
        }
        assert(captureTick > 0
            && captureBody
            && lastOutsideDistance > ORBIT_RADIUS
            && previousDistance <= ORBIT_RADIUS + 0.05
            && Math.hypot(
                captureBody.position.x - towerPosition.x,
                captureBody.position.y - towerPosition.y
            ) <= ORBIT_RADIUS + 0.05
            && bodyUsesFlow(captureBody) === false
            && captureBody.enemyBehaviorState.flags === (
                GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.TARGET_VALID
                | GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.DIRECTIONAL_DEFENSE_ACTIVE
            )
            && exactHandle(bodyTargetHandle(captureBody), towerHandle),
        `natural O radius capture mismatch ${JSON.stringify({
            captureTick,
            lastOutsideDistance,
            previousDistance,
            captureBody,
            towerHandle
        })}`);
        const angularStepQ32 = createOctaIntent(route, 0)
            .enemyBehaviorState.angularStepQ32;
        const captureRadialAngle = Math.atan2(
            captureBody.position.y - towerPosition.y,
            captureBody.position.x - towerPosition.x
        );
        const captureDesiredAngle = orbitAngle(0, captureTick, angularStepQ32);
        const capturePhaseError = Math.abs(shortestAngleDelta(
            captureRadialAngle,
            captureDesiredAngle
        ));
        const settleStep = await submitEndpointTick(
            endpoint,
            captureTick + 1,
            'natural O bounded angular settle'
        );
        const settleBody = findBody(
            settleStep.bodies,
            octaHandle,
            'settling natural O'
        );
        const settleRadialAngle = Math.atan2(
            settleBody.position.y - towerPosition.y,
            settleBody.position.x - towerPosition.x
        );
        const settleDesiredAngle = orbitAngle(
            0,
            captureTick + 1,
            angularStepQ32
        );
        const settlePhaseError = Math.abs(shortestAngleDelta(
            settleRadialAngle,
            settleDesiredAngle
        ));
        const settleAngularDisplacement = Math.abs(shortestAngleDelta(
            captureRadialAngle,
            settleRadialAngle
        ));
        const maximumAngularSettleStep = settleBody.flowSpeed
            * FIXED_DELTA / ORBIT_RADIUS;
        const settleRadius = Math.hypot(
            settleBody.position.x - towerPosition.x,
            settleBody.position.y - towerPosition.y
        );
        assert(settleBody.enemyBehaviorState.state
            === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.ORBIT_TOWER
            && settleAngularDisplacement > 0
            && settleAngularDisplacement <= maximumAngularSettleStep + 0.0001
            && settlePhaseError < capturePhaseError
            && settleRadius >= ORBIT_RADIUS - 0.001,
        `natural O angular settle crossed chord or diverged ${JSON.stringify({
            capturePhaseError,
            settlePhaseError,
            settleAngularDisplacement,
            maximumAngularSettleStep,
            settleRadius
        })}`);
        return Object.freeze({
            mapId: tileMap.mapId,
            towerHandle: Object.freeze({ ...towerHandle }),
            octaHandle: Object.freeze({ ...octaHandle }),
            initialState: GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.SEEK_TOWER,
            initialDistance: firstDistance,
            initialFlowEnabled: true,
            initialFlags,
            initialDefenseActive: false,
            initialFacingLength,
            initialFacingDot,
            initialFlowFieldIndex,
            captureTick,
            lastOutsideDistance,
            preCaptureDistance: previousDistance,
            captureDistance: Math.hypot(
                captureBody.position.x - towerPosition.x,
                captureBody.position.y - towerPosition.y
            ),
            captureState: captureBody.enemyBehaviorState.state,
            captureFlags: captureBody.enemyBehaviorState.flags,
            captureFlowEnabled: bodyUsesFlow(captureBody),
            captureDefenseActive: (captureBody.enemyBehaviorState.flags
                & GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.DIRECTIONAL_DEFENSE_ACTIVE) !== 0,
            captureTargetHandle: bodyTargetHandle(captureBody),
            settle: Object.freeze({
                capturePhaseError,
                nextPhaseError: settlePhaseError,
                angularDisplacement: settleAngularDisplacement,
                maximumAngularStep: maximumAngularSettleStep,
                radius: settleRadius
            })
        });
    } finally {
        endpoint.destroy();
    }
}

async function runSeekTowerLossLatch(device, format) {
    const tileMap = createOpenOrbitTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const towerPosition = tileMap.getTowerSpawnPosition();
    const corePosition = tileMap.getCorePosition();
    const endpoint = createEndpoint(device, format, 3);
    try {
        endpoint.init(tileMap);
        assert(endpoint.requestSpawnBatch([{
            intent: createGpuTowerSpawnIntent({ position: towerPosition }),
            targetFixedTick: 1,
            commandId: 'octagon:seek-loss:tower'
        }, {
            intent: createOctaIntent(route, 600),
            targetFixedTick: 1,
            commandId: 'octagon:seek-loss:o'
        }]).accepted, 'SEEK Tower-loss ingress rejected');
        const commit = endpoint.commitAtFixedBoundary(1);
        const towerHandle = commit.spawned.find(
            ({ commandId }) => commandId === 'octagon:seek-loss:tower'
        )?.handle;
        const octaHandle = commit.spawned.find(
            ({ commandId }) => commandId === 'octagon:seek-loss:o'
        )?.handle;
        assert(towerHandle && octaHandle, 'SEEK Tower-loss handles missing');
        assert(endpoint.configureTowerGameplayTarget(towerHandle).accepted,
            'SEEK Tower-loss target rejected');
        const seeking = await submitEndpointTick(
            endpoint,
            1,
            'SEEK before Tower loss',
            false
        );
        const seekingBody = findBody(seeking.bodies, octaHandle, 'SEEK loss O');
        assert(seekingBody.enemyBehaviorState.state
            === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.SEEK_TOWER,
        'SEEK loss fixture captured before Tower loss');

        assert(endpoint.requestDespawn(
            towerHandle,
            'octagon-seek-tower-loss',
            2,
            'octagon:seek-loss:despawn'
        ).accepted, 'SEEK Tower despawn rejected');
        const lost = await submitEndpointTick(endpoint, 2, 'SEEK Tower loss');
        const fallback = findBody(lost.bodies, octaHandle, 'SEEK fallback O');
        const coreDistanceBefore = Math.hypot(
            fallback.position.x - corePosition.x,
            fallback.position.y - corePosition.y
        );
        assert(fallback.enemyBehaviorState.state
            === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.CORE_FALLBACK
            && fallback.enemyBehaviorState.flags === 0
            && fallback.enemyBehaviorState.targetEntityId === 0
            && fallback.enemyBehaviorState.targetIncarnation === 0
            && bodyUsesFlow(fallback),
        `SEEK Tower loss did not enter fallback ${JSON.stringify(fallback)}`);

        assert(endpoint.requestSpawn(
            createGpuTowerSpawnIntent({ position: towerPosition }),
            3,
            'octagon:seek-loss:replacement'
        ).accepted, 'SEEK replacement Tower ingress rejected');
        const replacementCommit = endpoint.commitAtFixedBoundary(3);
        const replacementTowerHandle = replacementCommit.spawned[0]?.handle;
        assert(replacementTowerHandle && !exactHandle(replacementTowerHandle, towerHandle),
            'SEEK replacement Tower ABA handle did not change');
        assert(endpoint.configureTowerGameplayTarget(replacementTowerHandle).accepted,
            'SEEK replacement Tower target rejected');
        const latched = await submitEndpointTick(
            endpoint,
            3,
            'SEEK replacement latch',
            false
        );
        const latchedBody = findBody(latched.bodies, octaHandle, 'latched SEEK-loss O');
        const coreDistanceAfter = Math.hypot(
            latchedBody.position.x - corePosition.x,
            latchedBody.position.y - corePosition.y
        );
        assert(latchedBody.enemyBehaviorState.state
            === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.CORE_FALLBACK
            && latchedBody.enemyBehaviorState.flags === 0
            && latchedBody.enemyBehaviorState.targetEntityId === 0
            && latchedBody.enemyBehaviorState.targetIncarnation === 0
            && bodyUsesFlow(latchedBody)
            && coreDistanceAfter < coreDistanceBefore,
        `SEEK Tower replacement rebound ${JSON.stringify({
            latchedBody,
            coreDistanceBefore,
            coreDistanceAfter
        })}`);
        return Object.freeze({
            mapId: tileMap.mapId,
            modeBefore: 'SEEK_TOWER',
            modeAfter: 'CORE_FALLBACK',
            latchedMode: 'CORE_FALLBACK',
            towerHandleBefore: Object.freeze({ ...towerHandle }),
            replacementTowerHandle: Object.freeze({ ...replacementTowerHandle }),
            targetHandleAfter: latchedBody.enemyBehaviorState.targetEntityId === 0
                && latchedBody.enemyBehaviorState.targetIncarnation === 0
                ? null
                : bodyTargetHandle(latchedBody),
            defenseActiveAfter: false,
            flowEnabledAfter: bodyUsesFlow(latchedBody),
            coreDistanceBefore,
            coreDistanceAfter,
            recoveryRequired: endpoint.requiresRecovery()
        });
    } finally {
        endpoint.destroy();
    }
}

function runCorruptedMetadataContract(route) {
    const bodies = new Map();
    let spawnCallCount = 0;
    const backend = {
        spawnBodies(entries) {
            spawnCallCount++;
            for (const entry of entries) bodies.set(handleKey(entry), entry);
            return Object.freeze({
                accepted: entries.length,
                rejected: 0,
                handles: entries.map(({ entityId, incarnation }) => (
                    Object.freeze({ entityId, incarnation })
                )),
                requiresRecovery: false
            });
        },
        despawnBodies(handles) {
            let removed = 0;
            for (const handle of handles) removed += Number(bodies.delete(handleKey(handle)));
            return Object.freeze({ removed, rejected: handles.length - removed });
        },
        hasBody: (handle) => bodies.has(handleKey(handle)),
        requiresRecovery: () => false,
        getRuntimeState: () => 'gpu-ready'
    };
    const registry = new WorldRegistry({ capacity: 4 });
    const owner = new EnemyLifecycleCommandOwner(backend, registry);
    const materialized = materializeOctaIntent(route, 0, 0);
    const handle = registry.reserveEntity({
        kindId: 'enemy',
        definitionId: BASIC_OCTA_ENEMY_DEFINITION_ID,
        createdAtTick: 1
    });
    const body = Object.freeze({
        ...materialized,
        entityId: handle.entityId,
        incarnation: handle.incarnation
    });
    bodies.set(handleKey(handle), body);
    assert(registry.activateReserved(handle, {
        ...createGpuRegistryMetadata(materialized),
        orbitSlotCapacity: null
    }), 'corrupted active metadata seed rejected');
    assert(owner.requestSpawn(createOctaIntent(route, 1), 2,
        'octagon:corruption:probe').accepted,
    'corruption probe ingress rejected');
    const failed = owner.commitAtFixedBoundary(2);
    assert(failed.state === 'failed'
        && failed.recoveryRequired === true
        && failed.rejected[0]?.code === ENEMY_ORBIT_SLOT_METADATA_CORRUPTION_CODE
        && owner.getPendingCount() === 1,
    `corruption fail-close mismatch ${JSON.stringify(failed)}`);
    return Object.freeze({
        code: ENEMY_ORBIT_SLOT_METADATA_CORRUPTION_CODE,
        recoveryRequired: failed.recoveryRequired,
        pendingCount: owner.getPendingCount(),
        reservedCount: registry.getReservedCount(),
        spawnCallCount
    });
}

function createDamageProbe(position, entityId, {
    inputDamageCenti,
    teamId = GAMEPLAY_TEAM_ID.PLAYER,
    incarnation = 1
}) {
    return Object.freeze({
        kindId: 'projectile',
        definitionId: 'nw-octagon-directional-probe',
        entityId,
        incarnation,
        position: Object.freeze({ ...position }),
        velocity: Object.freeze({ x: 0, y: 0 }),
        radius: DAMAGE_PROBE_RADIUS,
        inverseMass: 1,
        bodyLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
        collisionMask: 0,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
        interactionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        teamId,
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
            damageOther: inputDamageCenti / DAMAGE_SCALE,
            flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS
                | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY
        })
    });
}

function createDamageProbeIntent(position, inputDamageCenti = 100) {
    const {
        entityId: _entityId,
        incarnation: _incarnation,
        ...intent
    } = createDamageProbe(position, 1, { inputDamageCenti });
    return Object.freeze(intent);
}

async function runStaleAbaBudgetFixture(device, format) {
    const tileMap = createOpenOrbitTileMap();
    const endpoint = createEndpoint(device, format, 2);
    const probePosition = Object.freeze({ x: 4, y: 4 });
    let oldHandle;
    let replacementHandle;
    try {
        endpoint.init(tileMap);
        assert(endpoint.requestSpawn(
            createDamageProbeIntent(probePosition),
            1,
            'octagon:stale:old-spawn'
        ).accepted, 'old ABA probe spawn rejected');
        const oldSpawn = await submitEndpointTick(endpoint, 1, 'old ABA probe');
        oldHandle = oldSpawn.lifecycle.spawned[0]?.handle;
        assert(oldHandle, 'old ABA probe handle missing');

        assert(endpoint.requestDespawn(
            oldHandle,
            'aba-retire',
            2,
            'octagon:stale:old-despawn'
        ).accepted, 'old ABA probe despawn rejected');
        const retired = await submitEndpointTick(endpoint, 2, 'retire ABA probe');
        assert(retired.lifecycle.despawned.length === 1
            && !endpoint.hasBody(oldHandle),
        `old ABA probe not retired ${JSON.stringify(retired.lifecycle)}`);

        assert(endpoint.requestSpawn(
            createDamageProbeIntent(probePosition),
            3,
            'octagon:stale:replacement-spawn'
        ).accepted, 'replacement ABA probe spawn rejected');
        const replacement = await submitEndpointTick(
            endpoint,
            3,
            'replacement ABA probe'
        );
        replacementHandle = replacement.lifecycle.spawned[0]?.handle;
        assert(replacementHandle
            && replacementHandle.entityId === oldHandle.entityId
            && replacementHandle.incarnation !== oldHandle.incarnation,
        `replacement ABA identity mismatch ${JSON.stringify({
            oldHandle,
            replacementHandle
        })}`);
        const replacementBefore = findBody(
            replacement.bodies,
            replacementHandle,
            'replacement ABA probe before stale request'
        );

        assert(endpoint.requestDespawn(
            oldHandle,
            'stale-aba-ingress',
            4,
            'octagon:stale:retired-handle'
        ).accepted, 'stale ABA ingress was not queued for exact commit check');
        const stale = await submitEndpointTick(endpoint, 4, 'stale ABA exact rejection');
        const replacementAfter = findBody(
            stale.bodies,
            replacementHandle,
            'replacement ABA probe after stale request'
        );
        assert(stale.lifecycle.state === 'committed-with-rejections'
            && stale.lifecycle.rejected.length === 1
            && stale.lifecycle.rejected[0].code === 'stale-handle'
            && stale.lifecycle.recoveryRequired === false
            && stale.completed.events.length === 0
            && replacementBefore.health === replacementAfter.health,
        `stale ABA budget proof mismatch ${JSON.stringify({
            lifecycle: stale.lifecycle,
            completed: stale.completed,
            replacementBefore,
            replacementAfter
        })}`);
        return Object.freeze({
            mapId: tileMap.mapId,
            oldHandle: Object.freeze({ ...oldHandle }),
            replacementHandle: Object.freeze({ ...replacementHandle }),
            rejectionCode: stale.lifecycle.rejected[0].code,
            rejectionCount: stale.lifecycle.rejected.length,
            eventCount: stale.completed.events.length,
            budgetBefore: Math.round(replacementBefore.health * DAMAGE_SCALE),
            budgetAfter: Math.round(replacementAfter.health * DAMAGE_SCALE),
            recoveryRequired: stale.lifecycle.recoveryRequired
        });
    } finally {
        endpoint.destroy();
    }
}

async function runDamageScenario(device, format, label, angleOffset, {
    inputDamageCenti = 100,
    teamId = GAMEPLAY_TEAM_ID.PLAYER,
    coincident = false,
    includeRearTarget = false
} = {}) {
    const tileMap = createOpenOrbitTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const towerPosition = tileMap.getTowerSpawnPosition();
    const angularStepQ32 = createOctaIntent(route, 0)
        .enemyBehaviorState.angularStepQ32;
    const octaPosition = orbitPosition(
        towerPosition,
        0,
        1,
        angularStepQ32,
        ORBIT_CAPTURE_SEED_RADIUS
    );
    const captureSeedSquaredDistance = assertCaptureSeedInside(
        towerPosition,
        octaPosition,
        `${label}:damage-capture-seed`
    );
    const radial = {
        x: (octaPosition.x - towerPosition.x) / ORBIT_RADIUS,
        y: (octaPosition.y - towerPosition.y) / ORBIT_RADIUS
    };
    const facingAngle = Math.atan2(-radial.y, -radial.x);
    const incomingAngle = facingAngle + angleOffset;
    const incoming = { x: Math.cos(incomingAngle), y: Math.sin(incomingAngle) };
    const rawOcta = materializeOctaIntent(route, 0, 0);
    const contactRadiusSum = rawOcta.radius + DAMAGE_PROBE_RADIUS;
    const contactSeparation = Math.fround(includeRearTarget
        ? SHIELD_SOURCE_TO_OCTA_DISTANCE
        : contactRadiusSum - 0.05);
    const projectilePosition = coincident
        ? octaPosition
        : Object.freeze({
            x: Math.fround(octaPosition.x + (incoming.x * contactSeparation)),
            y: Math.fround(octaPosition.y + (incoming.y * contactSeparation))
        });
    const actualContactSeparation = Math.hypot(
        projectilePosition.x - octaPosition.x,
        projectilePosition.y - octaPosition.y
    );
    assert(coincident
        ? actualContactSeparation === 0
        : actualContactSeparation > 0
            && actualContactSeparation < contactRadiusSum,
    `${label}: invalid contact geometry ${JSON.stringify({
        projectilePosition,
        octaPosition,
        actualContactSeparation,
        contactRadiusSum
    })}`);
    const rawRearTarget = includeRearTarget
        ? createGpuEnemySpawnIntent({
            definition: BASIC_CIRCLE_ENEMY_DATA,
            route,
            spawnSequence: 400,
            waveId: 'nw-octagon-shield-rear-target',
            policyId: 'hardware-fixture'
        })
        : null;
    const rearTargetPosition = includeRearTarget
        ? Object.freeze({
            x: Math.fround(octaPosition.x - (
                incoming.x * SHIELD_OCTA_TO_REAR_DISTANCE
            )),
            y: Math.fround(octaPosition.y - (
                incoming.y * SHIELD_OCTA_TO_REAR_DISTANCE
            ))
        })
        : null;
    const rearTargetContactDistance = includeRearTarget
        ? Math.hypot(
            projectilePosition.x - rearTargetPosition.x,
            projectilePosition.y - rearTargetPosition.y
        )
        : null;
    const rearTargetContactRadiusSum = includeRearTarget
        ? DAMAGE_PROBE_RADIUS + rawRearTarget.radius
        : null;
    const octaRearDistance = includeRearTarget
        ? Math.hypot(
            octaPosition.x - rearTargetPosition.x,
            octaPosition.y - rearTargetPosition.y
        )
        : null;
    const enemyPairCollisionRadius = includeRearTarget
        ? (rawOcta.radius + rawRearTarget.radius)
            * MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE
        : null;
    if (includeRearTarget) {
        assert(actualContactSeparation > 0
            && actualContactSeparation < contactRadiusSum
            && rearTargetContactDistance > 0
            && rearTargetContactDistance < rearTargetContactRadiusSum
            && actualContactSeparation < rearTargetContactDistance
            && octaRearDistance > enemyPairCollisionRadius,
        `${label}: shield candidates are not simultaneous/strict/non-contact ${JSON.stringify({
            actualContactSeparation,
            contactRadiusSum,
            rearTargetContactDistance,
            rearTargetContactRadiusSum,
            octaRearDistance,
            enemyPairCollisionRadius,
            projectilePosition,
            octaPosition,
            rearTargetPosition
        })}`);
    }
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: includeRearTarget ? 4 : 3,
        sessionGeneration: 31
    });
    const towerHandle = Object.freeze({ entityId: 1, incarnation: 1 });
    const octaHandle = Object.freeze({ entityId: 2, incarnation: 1 });
    const projectileHandle = Object.freeze({ entityId: 3, incarnation: 1 });
    const rearTargetHandle = includeRearTarget
        ? Object.freeze({ entityId: 4, incarnation: 1 })
        : null;
    try {
        backend.init(tileMap);
        const tower = withIdentity(
            createGpuTowerSpawnIntent({ position: towerPosition }),
            towerHandle.entityId
        );
        const octa = withIdentity(
            rawOcta,
            octaHandle.entityId,
            1,
            {
                position: octaPosition,
                ...(coincident ? {
                    flowSpeed: 0,
                    velocity: Object.freeze({ x: 0, y: 0 })
                } : {})
            }
        );
        const projectile = createDamageProbe(projectilePosition, 3, {
            inputDamageCenti,
            teamId
        });
        const zeroDirectionPredictedDeltaSquared = coincident
            ? gpuF32SquaredDistance(
                predictGpuF32Position(
                    projectile.position,
                    projectile.velocity,
                    FIXED_DELTA
                ),
                predictGpuF32Position(
                    octa.position,
                    octa.velocity,
                    FIXED_DELTA
                )
            )
            : null;
        if (coincident) {
            assert(octa.flowSpeed === 0
                && octa.velocity.x === 0
                && octa.velocity.y === 0
                && projectile.velocity.x === 0
                && projectile.velocity.y === 0
                && zeroDirectionPredictedDeltaSquared === 0,
            `${label}: predicted-position zero direction drift ${JSON.stringify({
                octaFlowSpeed: octa.flowSpeed,
                octaPosition: octa.position,
                octaVelocity: octa.velocity,
                projectilePosition: projectile.position,
                projectileVelocity: projectile.velocity,
                zeroDirectionPredictedDeltaSquared
            })}`);
        }
        const rearTarget = includeRearTarget
            ? withIdentity(rawRearTarget, 4, 1, {
                position: rearTargetPosition,
                flowSpeed: 0,
                velocity: Object.freeze({ x: 0, y: 0 })
            })
            : null;
        const bodiesToReplace = rearTarget === null
            ? [tower, octa, projectile]
            : [tower, octa, projectile, rearTarget];
        const replaced = backend.replaceBodies(bodiesToReplace);
        assert(replaced.accepted === bodiesToReplace.length,
            `${label}: replace failed ${JSON.stringify(replaced)}`);
        assert(backend.configureTowerGameplayTarget(towerHandle).accepted,
            `${label}: Tower target rejected`);
        assert(backend.fixedUpdate(FIXED_DELTA, 1), `${label}: fixed submit failed`);
        await waitForSimulation(backend, label);
        const bodies = await readBodies(backend);
        const targetAfter = findBody(bodies, octaHandle, `${label} target`);
        const sourceAfter = findBody(bodies, projectileHandle, `${label} source`);
        const rearTargetAfter = rearTargetHandle === null
            ? null
            : findBody(bodies, rearTargetHandle, `${label} rear target`);
        assert(targetAfter.enemyBehaviorState.state
            === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.ORBIT_TOWER
            && targetAfter.enemyBehaviorState.flags === (
                GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.TARGET_VALID
                | GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.DIRECTIONAL_DEFENSE_ACTIVE
            ),
        `${label}: damage target did not capture before classification ${JSON.stringify({
            captureSeedSquaredDistance,
            state: targetAfter.enemyBehaviorState.state,
            flags: targetAfter.enemyBehaviorState.flags
        })}`);
        const octaRearDistanceAfter = rearTargetAfter === null
            ? null
            : Math.hypot(
                targetAfter.position.x - rearTargetAfter.position.x,
                targetAfter.position.y - rearTargetAfter.position.y
            );
        const sourceOctaDistanceAfter = Math.hypot(
            sourceAfter.position.x - targetAfter.position.x,
            sourceAfter.position.y - targetAfter.position.y
        );
        const sourceRearDistanceAfter = rearTargetAfter === null
            ? null
            : Math.hypot(
                sourceAfter.position.x - rearTargetAfter.position.x,
                sourceAfter.position.y - rearTargetAfter.position.y
            );
        if (rearTargetAfter !== null) {
            assert(sourceOctaDistanceAfter < contactRadiusSum
                && sourceRearDistanceAfter < rearTargetContactRadiusSum
                && sourceOctaDistanceAfter < sourceRearDistanceAfter
                && octaRearDistanceAfter > enemyPairCollisionRadius,
            `${label}: post-tick shield geometry drift ${JSON.stringify({
                    sourceOctaDistanceAfter,
                    sourceRearDistanceAfter,
                    octaRearDistanceAfter,
                    enemyPairCollisionRadius,
                    targetAfter: targetAfter.position,
                    rearTargetAfter: rearTargetAfter.position
                })}`);
        }
        const events = backend.drainCompletedEventBatches([])
            .flatMap(({ events: batchEvents }) => batchEvents);
        const damageEvents = events.filter((event) => (
            event.eventType === 'damage-applied'
            && event.entityId === projectileHandle.entityId
            && event.incarnation === projectileHandle.incarnation
            && event.otherEntityId === octaHandle.entityId
            && event.otherIncarnation === octaHandle.incarnation
        ));
        const damageEvent = damageEvents[0];
        const rearTargetDamageEvents = rearTargetHandle === null
            ? []
            : events.filter((event) => (
                event.eventType === 'damage-applied'
                && event.otherEntityId === rearTargetHandle.entityId
                && event.otherIncarnation === rearTargetHandle.incarnation
            ));
        const targetBeforeCenti = Math.round(octa.health * DAMAGE_SCALE);
        const targetAfterCenti = Math.round(targetAfter.health * DAMAGE_SCALE);
        const appliedDamageCenti = damageEvent?.valueFixedPoint
            ?? targetBeforeCenti - targetAfterCenti;
        return Object.freeze({
            mapId: tileMap.mapId,
            appliedDamageCenti,
            budgetBefore: Math.round(projectile.health * DAMAGE_SCALE),
            budgetAfter: Math.round(sourceAfter.health * DAMAGE_SCALE),
            eventFlags: damageEvent?.flags ?? 0,
            eventValueFixedPoint: damageEvent?.valueFixedPoint ?? null,
            damageEventCount: damageEvents.length,
            targetBeforeCenti,
            targetAfterCenti,
            sourceHandle: projectileHandle,
            targetHandle: octaHandle,
            captureSeedSquaredDistance,
            captureState: targetAfter.enemyBehaviorState.state,
            captureFlags: targetAfter.enemyBehaviorState.flags,
            predictedDeltaSquared: zeroDirectionPredictedDeltaSquared,
            isolationFlowSpeed: coincident ? octa.flowSpeed : null,
            isolationSourceVelocity: coincident
                ? projectile.velocity
                : null,
            isolationTargetVelocity: coincident ? octa.velocity : null,
            contactSeparation: actualContactSeparation,
            contactRadiusSum,
            rearTargetHandle,
            rearTargetBeforeCenti: rearTarget === null
                ? null
                : Math.round(rearTarget.health * DAMAGE_SCALE),
            rearTargetAfterCenti: rearTargetAfter === null
                ? null
                : Math.round(rearTargetAfter.health * DAMAGE_SCALE),
            rearTargetDamageEventCount: rearTargetDamageEvents.length,
            rearTargetContactDistance,
            rearTargetContactRadiusSum,
            sourceOctaDistanceAfter,
            sourceRearDistanceAfter,
            octaRearDistance,
            octaRearDistanceAfter,
            enemyPairCollisionRadius,
            enemyPairCollisionRadiusScale:
                MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE
        });
    } finally {
        backend.destroy();
    }
}

async function runDirectionalDamageFixture(device, format) {
    const front = await runDamageScenario(device, format, 'front', 0);
    const boundaryInside = await runDamageScenario(
        device,
        format,
        'front-boundary-inside',
        (3 * Math.PI / 8) - 0.005
    );
    const boundaryOutside = await runDamageScenario(
        device,
        format,
        'front-boundary-outside',
        (3 * Math.PI / 8) + 0.005
    );
    const rear = await runDamageScenario(device, format, 'rear', Math.PI);
    const side = await runDamageScenario(device, format, 'side', Math.PI / 2);
    const returning = await runDamageScenario(
        device,
        format,
        'returning-origin',
        Math.PI
    );
    const zeroDirection = await runDamageScenario(
        device,
        format,
        'zero-direction',
        0,
        { coincident: true }
    );
    const absorbed = await runDamageScenario(device, format, 'fully-absorbed', 0, {
        inputDamageCenti: 50,
        includeRearTarget: true
    });
    const friendly = await runDamageScenario(device, format, 'friendly', 0, {
        teamId: GAMEPLAY_TEAM_ID.HOSTILE
    });
    const stale = await runStaleAbaBudgetFixture(device, format);
    const mapIds = [
        front,
        boundaryInside,
        boundaryOutside,
        rear,
        side,
        returning,
        zeroDirection,
        absorbed,
        friendly,
        stale
    ].map(({ mapId }) => mapId);
    assert(mapIds.every((mapId) => (
        mapId === OPEN_ORBIT_MAP_DATA.id
    )), `damage fixture escaped open-ring authority ${JSON.stringify(mapIds)}`);
    assert(front.appliedDamageCenti === 50
        && boundaryInside.appliedDamageCenti === 50
        && boundaryOutside.appliedDamageCenti === 100
        && rear.appliedDamageCenti === 100
        && side.appliedDamageCenti === 100
        && returning.appliedDamageCenti === 100
        && zeroDirection.appliedDamageCenti === 100,
    `directional damage mismatch ${JSON.stringify({
        front,
        boundaryInside,
        boundaryOutside,
        rear,
        side,
        returning,
        zeroDirection
    })}`);
    assert((front.eventFlags
        & GPU_CIRCLE_APPLIED_EVENT_FLAG.DIRECTIONAL_DEFENSE) !== 0
        && (boundaryInside.eventFlags
            & GPU_CIRCLE_APPLIED_EVENT_FLAG.DIRECTIONAL_DEFENSE) !== 0
        && [boundaryOutside, rear, side, returning, zeroDirection].every(
            ({ eventFlags }) => (
                eventFlags & GPU_CIRCLE_APPLIED_EVENT_FLAG.DIRECTIONAL_DEFENSE
            ) === 0
        ),
    `directional event flag mismatch ${JSON.stringify({
        front,
        boundaryInside,
        boundaryOutside,
        rear,
        side,
        returning,
        zeroDirection
    })}`);
    assert(absorbed.appliedDamageCenti === 0
        && absorbed.budgetBefore === 100
        && absorbed.budgetAfter === 0
        && absorbed.damageEventCount === 1
        && absorbed.eventValueFixedPoint === 0
        && (absorbed.eventFlags
            & GPU_CIRCLE_APPLIED_EVENT_FLAG.DIRECTIONAL_DEFENSE) !== 0
        && (absorbed.eventFlags
            & GPU_CIRCLE_APPLIED_EVENT_FLAG.CONTINUOUS_POLICY) !== 0
        && (absorbed.eventFlags
            & GPU_CIRCLE_APPLIED_EVENT_FLAG.TARGET_DIED) === 0,
    `fully absorbed budget mismatch ${JSON.stringify(absorbed)}`);
    assert(absorbed.rearTargetHandle
        && absorbed.rearTargetBeforeCenti === absorbed.rearTargetAfterCenti
        && absorbed.rearTargetDamageEventCount === 0,
    `fully absorbed O did not shield exact rear target ${JSON.stringify(absorbed)}`);
    assert(friendly.budgetBefore === friendly.budgetAfter
        && friendly.damageEventCount === 0,
        `friendly hit consumed budget ${JSON.stringify(friendly)}`);
    for (const sample of [
        front,
        boundaryInside,
        boundaryOutside,
        rear,
        side,
        returning,
        zeroDirection,
        absorbed
    ]) {
        assert(sample.damageEventCount === 1,
            `valid contact event cardinality drift ${JSON.stringify(sample)}`);
    }
    return Object.freeze({
        mapIds,
        inputDamageCenti: 100,
        frontDamageCenti: front.appliedDamageCenti,
        frontEventFlags: front.eventFlags,
        frontBoundaryDamageCenti: boundaryInside.appliedDamageCenti,
        frontBoundaryInsideDamageCenti: boundaryInside.appliedDamageCenti,
        frontBoundaryOutsideDamageCenti: boundaryOutside.appliedDamageCenti,
        frontBoundaryInsideEventFlags: boundaryInside.eventFlags,
        frontBoundaryOutsideEventFlags: boundaryOutside.eventFlags,
        rearDamageCenti: rear.appliedDamageCenti,
        rearEventFlags: rear.eventFlags,
        sideDamageCenti: side.appliedDamageCenti,
        sideEventFlags: side.eventFlags,
        zeroDirectionDamageCenti: zeroDirection.appliedDamageCenti,
        zeroDirectionEventFlags: zeroDirection.eventFlags,
        zeroDirectionPredictedDeltaSquared:
            zeroDirection.predictedDeltaSquared,
        zeroDirectionIsolationFlowSpeed:
            zeroDirection.isolationFlowSpeed,
        zeroDirectionSourceVelocity:
            zeroDirection.isolationSourceVelocity,
        zeroDirectionTargetVelocity:
            zeroDirection.isolationTargetVelocity,
        returningOriginDamageCenti: returning.appliedDamageCenti,
        fullyAbsorbedInputCenti: 50,
        fullyAbsorbedAppliedCenti: absorbed.appliedDamageCenti,
        fullyAbsorbedBudgetBefore: absorbed.budgetBefore / 100,
        fullyAbsorbedBudgetAfter: absorbed.budgetAfter / 100,
        friendlyBudgetBefore: friendly.budgetBefore,
        friendlyBudgetAfter: friendly.budgetAfter,
        friendlyDamageEventCount: friendly.damageEventCount,
        staleBudgetBefore: stale.budgetBefore,
        staleBudgetAfter: stale.budgetAfter,
        staleOldHandle: stale.oldHandle,
        staleReplacementHandle: stale.replacementHandle,
        staleRejectionCode: stale.rejectionCode,
        staleRejectionCount: stale.rejectionCount,
        staleEventCount: stale.eventCount,
        staleRecoveryRequired: stale.recoveryRequired,
        absorbedEventFlags: absorbed.eventFlags,
        absorbedEventValueFixedPoint: absorbed.eventValueFixedPoint,
        absorbedDamageEventCount: absorbed.damageEventCount,
        absorbedSourceHandle: absorbed.sourceHandle,
        absorbedTargetHandle: absorbed.targetHandle,
        shieldRearTargetHandle: absorbed.rearTargetHandle,
        shieldRearTargetHealthBeforeCenti: absorbed.rearTargetBeforeCenti,
        shieldRearTargetHealthAfterCenti: absorbed.rearTargetAfterCenti,
        shieldRearTargetDamageEventCount: absorbed.rearTargetDamageEventCount,
        contactSeparation: absorbed.contactSeparation,
        contactRadiusSum: absorbed.contactRadiusSum,
        shieldRearTargetContactDistance: absorbed.rearTargetContactDistance,
        shieldRearTargetContactRadiusSum: absorbed.rearTargetContactRadiusSum,
        shieldSourceOctaDistanceAfter: absorbed.sourceOctaDistanceAfter,
        shieldSourceRearDistanceAfter: absorbed.sourceRearDistanceAfter,
        damageCaptureSeedSquaredDistance:
            absorbed.captureSeedSquaredDistance,
        damageCaptureState: absorbed.captureState,
        damageCaptureFlags: absorbed.captureFlags,
        shieldOctaRearDistance: absorbed.octaRearDistance,
        shieldOctaRearDistanceAfter: absorbed.octaRearDistanceAfter,
        shieldEnemyPairCollisionRadius: absorbed.enemyPairCollisionRadius,
        shieldEnemyPairCollisionRadiusScale:
            absorbed.enemyPairCollisionRadiusScale
    });
}

async function runProtectionFixture(device, format) {
    const tileMap = createOpenOrbitTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const towerPosition = tileMap.getTowerSpawnPosition();
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: 2,
        sessionGeneration: 41
    });
    const towerHandle = Object.freeze({ entityId: 1, incarnation: 1 });
    const octaHandle = Object.freeze({ entityId: 2, incarnation: 1 });
    try {
        backend.init(tileMap);
        const tower = withIdentity(
            createGpuTowerSpawnIntent({ position: towerPosition }),
            1
        );
        const rawOcta = materializeOctaIntent(route, 0, 0);
        const octaPosition = Object.freeze({
            x: towerPosition.x + ((tower.radius + rawOcta.radius) * 0.5),
            y: towerPosition.y
        });
        assertCaptureSeedInside(
            towerPosition,
            octaPosition,
            'physical-protection-capture-seed'
        );
        const octa = withIdentity(rawOcta, 2, 1, {
            position: octaPosition,
            contactHandler: Object.freeze({
                ...rawOcta.contactHandler,
                flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS
            })
        });
        assert(backend.replaceBodies([tower, octa]).accepted === 2,
            'protection replace failed');
        assert(backend.fixedUpdate(FIXED_DELTA, 1), 'protection fixed submit failed');
        await waitForSimulation(backend, 'protection');
        const bodies = await readBodies(backend);
        const towerAfter = findBody(bodies, towerHandle, 'protection Tower');
        const octaAfter = findBody(bodies, octaHandle, 'protection O');
        const physicalShieldDisplacementCenti = Math.round(Math.hypot(
            octaAfter.position.x - octaPosition.x,
            octaAfter.position.y - octaPosition.y
        ) * 100);
        const towerPushDisplacementCenti = Math.round(Math.hypot(
            towerAfter.position.x - towerPosition.x,
            towerAfter.position.y - towerPosition.y
        ) * 100);
        const towerContactDamageCenti = Math.round(
            (tower.health - towerAfter.health) * 100
        );
        assert(physicalShieldDisplacementCenti > 0
            && towerPushDisplacementCenti > 0
            && towerContactDamageCenti > 0,
        `physical protection mismatch ${JSON.stringify({
            physicalShieldDisplacementCenti,
            towerPushDisplacementCenti,
            towerContactDamageCenti,
            towerAfter,
            octaAfter
        })}`);
        return Object.freeze({
            mapId: tileMap.mapId,
            physicalShieldDisplacementCenti,
            towerPushDisplacementCenti,
            towerContactDamageCenti
        });
    } finally {
        backend.destroy();
    }
}

async function runTerminalCleanupReplacement(device, format) {
    const tileMap = createOpenOrbitTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const endpoint = createEndpoint(device, format, 6);
    let handles = [];
    let allOldHandles = [];
    let oldSessionGeneration = 0;
    try {
        endpoint.init(tileMap);
        assert(endpoint.requestSpawnBatch([{
            intent: createGpuTowerSpawnIntent({
                position: tileMap.getTowerSpawnPosition()
            }),
            targetFixedTick: 1,
            commandId: 'octagon:cleanup:tower'
        }, ...Array.from({ length: 3 }, (_, index) => ({
            intent: createOctaIntent(route, 200 + index),
            targetFixedTick: 1,
            commandId: `octagon:cleanup:spawn:${index}`
        }))]).accepted, 'cleanup spawn ingress rejected');
        const spawned = await submitEndpointTick(endpoint, 1, 'cleanup spawn');
        allOldHandles = spawned.lifecycle.spawned.map(
            ({ handle }) => handle
        );
        handles = spawned.lifecycle.spawned
            .filter(({ commandId }) => commandId.startsWith('octagon:cleanup:spawn:'))
            .map(({ handle }) => handle);
        assert(handles.length === 3, 'cleanup exact O handles missing');
        const activeCountBefore = endpoint.getStatus().activeEnemyCount;
        const cleanupReceipts = handles.map((handle, index) => endpoint.requestDespawn(
            handle,
            'octagon-terminal-cleanup',
            2,
            `octagon:cleanup:despawn:${index}`
        ));
        assert(cleanupReceipts.every(({ accepted }) => accepted),
            `cleanup ingress rejected ${JSON.stringify(cleanupReceipts)}`);
        const cleanupCommit = endpoint.commitAtFixedBoundary(2);
        assert(cleanupCommit.despawned.length === 3
            && cleanupCommit.recoveryRequired === false,
        `cleanup commit mismatch ${JSON.stringify(cleanupCommit)}`);
        const terminalClose = endpoint.closeGameplayIngress('run-defeated', 2);
        assert(terminalClose.closed, 'terminal ingress did not close');
        await submitEndpointTick(endpoint, 2, 'terminal final submit', false);
        const finalStatus = endpoint.getStatus();
        assert(finalStatus.activeEnemyCount === 0
            && finalStatus.reservedCount === 0
            && finalStatus.pendingCommandCount === 0,
        `terminal cleanup not empty ${JSON.stringify(finalStatus)}`);
        oldSessionGeneration = finalStatus.sessionGeneration;
        const terminal = Object.freeze({
            mapId: tileMap.mapId,
            activeCountBefore,
            activeCountAfter: finalStatus.activeEnemyCount,
            reservedCountAfter: finalStatus.reservedCount,
            pendingLifecycleCountAfter: finalStatus.lifecycle.pendingCount
        });
        const cleanup = Object.freeze({
            mapId: tileMap.mapId,
            despawnRequestedCount: cleanupReceipts.length,
            despawnedCount: cleanupCommit.despawned.length,
            activeCountAfter: finalStatus.activeEnemyCount,
            reservedCountAfter: finalStatus.reservedCount,
            orbitSlotCountAfter: activeOrbitSlotCount(endpoint.getRegistry())
        });
        const oldRegistry = endpoint.getRegistry();
        endpoint.destroy();
        const oldRegistryStatus = oldRegistry.getStatus();
        assert(allOldHandles.every((handle) => !endpoint.hasBody(handle))
            && oldRegistryStatus.destroyed === true
            && oldRegistryStatus.activeCount === 0
            && oldRegistryStatus.reservedCount === 0,
        `destroyed endpoint/registry retained old world ${JSON.stringify({
            allOldHandles,
            oldRegistryStatus
        })}`);

        const replacement = createEndpoint(device, format, 6);
        try {
            replacement.init(tileMap);
            const emptyReplacementStatus = replacement.getStatus();
            assert(emptyReplacementStatus.sessionGeneration > oldSessionGeneration
                && emptyReplacementStatus.activeCount === 0
                && emptyReplacementStatus.reservedCount === 0
                && activeOrbitSlotCount(replacement.getRegistry()) === 0,
            `replacement empty reset mismatch ${JSON.stringify(emptyReplacementStatus)}`);
            const freshRawOcta = createOctaIntent(route, 300);
            assert(freshRawOcta.orbitSlotIndex === ENEMY_ORBIT_SLOT_UNASSIGNED
                && freshRawOcta.enemyBehaviorState.orbitSlotIndex
                    === ENEMY_ORBIT_SLOT_UNASSIGNED,
            `fresh authored O did not start unleased ${JSON.stringify(freshRawOcta)}`);
            assert(replacement.requestSpawn(
                freshRawOcta,
                1,
                'octagon:replacement:fresh-o'
            ).accepted, 'fresh replacement O ingress rejected');
            const freshCommit = replacement.commitAtFixedBoundary(1);
            const freshHandle = freshCommit.spawned[0]?.handle;
            const freshSlot = freshHandle
                ? replacement.getRegistry().copyEntityView(
                    freshHandle,
                    {}
                ).metadata.orbitSlotIndex
                : null;
            const authoredReplacementStatus = replacement.getStatus();
            assert(freshCommit.state === 'committed'
                && freshHandle
                && replacement.hasBody(freshHandle)
                && freshSlot === 0
                && authoredReplacementStatus.activeCount === 1
                && authoredReplacementStatus.reservedCount === 0
                && activeOrbitSlotCount(replacement.getRegistry()) === 1,
            `replacement fresh O lease mismatch ${JSON.stringify({
                freshCommit,
                freshHandle,
                freshSlot,
                authoredReplacementStatus
            })}`);
            return Object.freeze({
                terminal,
                cleanup,
                replacementReset: Object.freeze({
                    mapId: tileMap.mapId,
                    oldSessionGeneration,
                    newSessionGeneration:
                        emptyReplacementStatus.sessionGeneration,
                    oldHandleCountAfter: allOldHandles.filter(
                        (handle) => endpoint.hasBody(handle)
                    ).length,
                    oldRegistryDestroyed: oldRegistryStatus.destroyed,
                    oldRegistryActiveCountAfter:
                        oldRegistryStatus.activeCount,
                    oldRegistryReservedCountAfter:
                        oldRegistryStatus.reservedCount,
                    freshActiveCountBeforeAuthor:
                        emptyReplacementStatus.activeCount,
                    freshReservedCountBeforeAuthor:
                        emptyReplacementStatus.reservedCount,
                    freshOrbitSlotCountBeforeAuthor: 0,
                    freshRawOrbitSlotBefore: freshRawOcta.orbitSlotIndex,
                    freshRawBehaviorSlotBefore:
                        freshRawOcta.enemyBehaviorState.orbitSlotIndex,
                    freshHandle: Object.freeze({ ...freshHandle }),
                    freshOrbitSlotAfter: freshSlot,
                    activeCountAfterAuthor:
                        authoredReplacementStatus.activeCount,
                    reservedCountAfterAuthor:
                        authoredReplacementStatus.reservedCount,
                    orbitSlotCountAfterAuthor: activeOrbitSlotCount(
                        replacement.getRegistry()
                    )
                })
            });
        } finally {
            replacement.destroy();
        }
    } finally {
        endpoint.destroy();
    }
}

async function runFixture(device, format) {
    assert(BASIC_OCTA_ENEMY_CAPABILITY_MASK === 0xA47,
        'O capability mask drift');
    assert(ENEMY_CAPABILITY_BIT.ORBIT === 0x800, 'ORBIT bit drift');
    assert(FORMATION_COORDINATE_SYSTEM_CODE.RING_SLOTS === 4,
        'RING_SLOTS code drift');
    assert(BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE.orbit.orbitRadiusTiles === 6
        && BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE.orbit.angularSpeedRadiansPerSecond
            === Math.fround(0.25),
    'O orbit profile drift');
    assert(BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE.directionalDefense
        .flatReductionFixedPoint === 50,
    'O flat reduction drift');
    const primary = await runLifecycleOrbitTowerLoss(device, format);
    const approach = await runNaturalSeekCapture(device, format);
    const seekTowerLoss = await runSeekTowerLossLatch(device, format);
    const damage = await runDirectionalDamageFixture(device, format);
    const protection = await runProtectionFixture(device, format);
    const reset = await runTerminalCleanupReplacement(device, format);
    return Object.freeze({
        scenario: 'octagon-ring-slots-directional-defense',
        contract: Object.freeze({
            definitionId: BASIC_OCTA_ENEMY_DEFINITION_ID,
            capabilityMask: BASIC_OCTA_ENEMY_CAPABILITY_MASK,
            coordinateSystemId: 'RING_SLOTS',
            coordinateSystemCode: FORMATION_COORDINATE_SYSTEM_CODE.RING_SLOTS,
            orbitCapabilityBit: ENEMY_CAPABILITY_BIT.ORBIT,
            behaviorProgram:
                GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT,
            initialBehaviorState: GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.SEEK_TOWER,
            behaviorState: GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.ORBIT_TOWER,
            behaviorFlag:
                GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.DIRECTIONAL_DEFENSE_ACTIVE,
            renderShapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.OCTA,
            radius: BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE.orbit.orbitRadiusTiles,
            angularSpeed: BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE.orbit
                .angularSpeedRadiansPerSecond,
            slotCapacity: 8,
            flatReductionCenti: BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE
                .directionalDefense.flatReductionFixedPoint,
            armoredFacetIndices: Array.from(
                BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE.directionalDefense
                    .armoredFacetIndices
            ),
            leaseOrder: Array.from(BASIC_OCTA_ORBIT_SLOT_FILL_ORDER),
            unassignedSlot: ENEMY_ORBIT_SLOT_UNASSIGNED
        }),
        lifecycle: primary.lifecycle,
        orbit: primary.orbit,
        approach,
        facing: primary.facing,
        render: primary.render,
        damage,
        protection,
        towerLoss: primary.towerLoss,
        seekTowerLoss,
        terminal: reset.terminal,
        replacementReset: reset.replacementReset,
        cleanup: reset.cleanup,
        storageProfile: primary.storageProfile
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
        result.productionEnemyOctagonDirectionalDefense = await runFixture(
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
