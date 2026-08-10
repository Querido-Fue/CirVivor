import {
    BASIC_HEXA_ENEMY_DATA,
    BASIC_HEXA_MAXIMUM_MEMBER_COUNT,
    mergeBasicHexaHealthCenti,
    resolveBasicHexaFormationStats
} from './production/script/data/object/enemy/basic_hexa_enemy_data.js';
import {
    BASIC_PENTA_ENEMY_DATA
} from './production/script/data/object/enemy/basic_circle_enemy_data.js';
import {
    MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE
} from './production/script/data/object/enemy/enemy_profile_catalog_data.js';
import {
    HEXA_HIVE_SIX_RING_FORMATION_DEFINITION
} from './production/script/data/object/enemy/enemy_formation_catalog_data.js';
import {
    PENTA_BOOST_EFFECT_DEFINITION,
    PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE
} from './production/script/data/object/enemy/enemy_effect_catalog_data.js';
import {
    ENEMY_FORMATION_POLICY_CODE,
    createFormationLineageHash
} from './production/script/module/ingame/contract/enemy_formation_contract.js';
import {
    ENEMY_LIFECYCLE_DISPOSITION_ID
} from './production/script/module/ingame/contract/enemy_lifecycle_disposition_contract.js';
import {
    TileMap,
    createTileMap,
    resolveIngameMapDefinition
} from './production/script/module/ingame/map/tile_map.js';
import {
    createRouteFlowFieldAtlas
} from './production/script/module/ingame/navigation/route_flow_field_atlas.js';
import { WorldRegistry } from './production/script/module/ingame/object/world_registry.js';
import {
    createGpuRegistryMetadata
} from './production/script/module/ingame/object/gpu_spawn_intent.js';
import {
    EnemyLifecycleCommandOwner
} from './production/script/module/ingame/object/enemy/enemy_lifecycle_command_owner.js';
import { EnemySimulationBackend } from './production/script/module/ingame/object/enemy/enemy_simulation_backend.js';
import {
    createGpuEnemySpawnIntent,
    materializeNaturalHexaFormationActivation
} from './production/script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js';
import {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    encodeGpuCircleBodyFixedPoint
} from './production/script/module/ingame/physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_EFFECT_INSTANCE_FLAG,
    GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
    GPU_EFFECT_PULSE_PROGRAM_FLAG,
    GPU_EFFECT_RUNTIME_ABI,
    GPU_EFFECT_RUNTIME_STATUS,
    GPU_EFFECT_TARGET_POLICY,
    GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION,
    readGpuEffectPoolState
} from './production/script/module/ingame/physics/gpu/gpu_effect_runtime_abi.js';
import {
    GPU_FORMATION_BODY_STATE_FLAG,
    GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG,
    GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
    GPU_FORMATION_PREPARE_RESULT,
    GPU_FORMATION_RUNTIME_ABI,
    GPU_FORMATION_RUNTIME_STATUS,
    GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION,
    GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
    readGpuFormationBodyState
} from './production/script/module/ingame/physics/gpu/gpu_formation_runtime_abi.js';
import {
    createGpuSignedDistanceField
} from './production/script/module/ingame/physics/gpu/gpu_signed_distance_field.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const REQUIRED_STORAGE_BUFFER_LIMIT = 9;
const FIXED_DELTA = 1 / 60;
const UINT32_MAX = 0xffffffff;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function compareHandles(left, right) {
    return left.entityId - right.entityId
        || left.incarnation - right.incarnation;
}

function createPlatformPort(device, format, frameTarget = null) {
    return Object.freeze({
        getState: () => Object.freeze({ status: 'ready' }),
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => 1,
        acquireFrameTarget: () => frameTarget,
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

function createNaturalHexa(route, spawnSequence, handle, position) {
    const raw = createGpuEnemySpawnIntent({
        definition: BASIC_HEXA_ENEMY_DATA,
        route,
        spawnSequence,
        laneOffsetTiles: 0
    });
    const activated = materializeNaturalHexaFormationActivation(raw, handle);
    return withIdentity(activated, handle, {
        position: Object.freeze({ x: position.x, y: position.y })
    });
}

function createPenta(route, spawnSequence, handle, position) {
    return withIdentity(createGpuEnemySpawnIntent({
        definition: BASIC_PENTA_ENEMY_DATA,
        route,
        spawnSequence,
        laneOffsetTiles: 0
    }), handle, {
        contactHandler: null,
        position: Object.freeze({ x: position.x, y: position.y })
    });
}

function createPulseRecord(source, sourceTick) {
    return Object.freeze({
        sourceEntityId: source.entityId,
        sourceIncarnation: source.incarnation,
        effectDefinitionCode: PENTA_BOOST_EFFECT_DEFINITION.effectDefinitionCode,
        emitterDefinitionCode:
            PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.emitterDefinitionCode,
        sourceTick,
        pulseSequence: 0,
        radiusTiles: PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.pulseRadiusTiles,
        targetLayerMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        targetPolicy: GPU_EFFECT_TARGET_POLICY.HOSTILE_ENEMY,
        fingerprint: 0x4a1001,
        flags: GPU_EFFECT_PULSE_PROGRAM_FLAG.PENTA_TARGET_ALLOWED
            | GPU_EFFECT_PULSE_PROGRAM_FLAG.TOWER_CONTACT_DAMAGE_MODIFIABLE
            | GPU_EFFECT_PULSE_PROGRAM_FLAG.PROJECTILE_TOWER_DAMAGE_MODIFIABLE,
        retargetIntervalTicks:
            PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.retargetIntervalTicks
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
        return new Uint8Array(target.getMappedRange()).slice().buffer;
    } finally {
        try { target.unmap(); } catch { /* already unmapped */ }
        target.destroy();
    }
}

async function readRenderTexturePixels(device, texture, width, height) {
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const target = device.createBuffer({
        label: 'cirvivor-nw-hexa-render-readback',
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = device.createCommandEncoder({
            label: 'cirvivor-nw-hexa-render-copy'
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

function countOpaquePixels(frame, center, halfSize) {
    let count = 0;
    for (let y = center.y - halfSize; y <= center.y + halfSize; y++) {
        for (let x = center.x - halfSize; x <= center.x + halfSize; x++) {
            const offset = (y * frame.bytesPerRow) + (x * 4);
            count += Number(frame.bytes[offset + 3] !== 0);
        }
    }
    return count;
}

function countChangedPixels(left, right) {
    assert(left.bytes.length === right.bytes.length, 'render frame size mismatch');
    let count = 0;
    for (let offset = 0; offset < left.bytes.length; offset += 4) {
        if (left.bytes[offset] !== right.bytes[offset]
            || left.bytes[offset + 1] !== right.bytes[offset + 1]
            || left.bytes[offset + 2] !== right.bytes[offset + 2]
            || left.bytes[offset + 3] !== right.bytes[offset + 3]) {
            count++;
        }
    }
    return count;
}

function decodeRenderPixel(frame, x, y, format) {
    const clampedX = Math.max(0, Math.min(frame.width - 1, Math.round(x)));
    const clampedY = Math.max(0, Math.min(frame.height - 1, Math.round(y)));
    const offset = (clampedY * frame.bytesPerRow) + (clampedX * 4);
    const first = frame.bytes[offset];
    const second = frame.bytes[offset + 1];
    const third = frame.bytes[offset + 2];
    return format.startsWith('bgra')
        ? Object.freeze({ r: third, g: second, b: first, a: frame.bytes[offset + 3] })
        : Object.freeze({ r: first, g: second, b: third, a: frame.bytes[offset + 3] });
}

function patchHasPixel(frame, x, y, format, predicate, radius = 1) {
    for (let offsetY = -radius; offsetY <= radius; offsetY++) {
        for (let offsetX = -radius; offsetX <= radius; offsetX++) {
            if (predicate(decodeRenderPixel(
                frame,
                x + offsetX,
                y + offsetY,
                format
            ))) {
                return true;
            }
        }
    }
    return false;
}

function countPixelsInRoi(frame, center, halfSize, format, predicate) {
    let count = 0;
    const minimumX = Math.max(0, Math.floor(center.x - halfSize.x));
    const maximumX = Math.min(frame.width - 1, Math.ceil(center.x + halfSize.x));
    const minimumY = Math.max(0, Math.floor(center.y - halfSize.y));
    const maximumY = Math.min(frame.height - 1, Math.ceil(center.y + halfSize.y));
    for (let y = minimumY; y <= maximumY; y++) {
        for (let x = minimumX; x <= maximumX; x++) {
            count += Number(predicate(decodeRenderPixel(frame, x, y, format)));
        }
    }
    return count;
}

function countChangedPixelsInRoi(left, right, center, halfSize) {
    assert(left.bytes.length === right.bytes.length, 'render frame size mismatch');
    let count = 0;
    const minimumX = Math.max(0, Math.floor(center.x - halfSize.x));
    const maximumX = Math.min(left.width - 1, Math.ceil(center.x + halfSize.x));
    const minimumY = Math.max(0, Math.floor(center.y - halfSize.y));
    const maximumY = Math.min(left.height - 1, Math.ceil(center.y + halfSize.y));
    for (let y = minimumY; y <= maximumY; y++) {
        for (let x = minimumX; x <= maximumX; x++) {
            const offset = (y * left.bytesPerRow) + (x * 4);
            if (left.bytes[offset] !== right.bytes[offset]
                || left.bytes[offset + 1] !== right.bytes[offset + 1]
                || left.bytes[offset + 2] !== right.bytes[offset + 2]
                || left.bytes[offset + 3] !== right.bytes[offset + 3]) {
                count++;
            }
        }
    }
    return count;
}

function summarizeRoiColors(frame, center, halfSize, format, targetColor) {
    const minimumX = Math.max(0, Math.floor(center.x - halfSize.x));
    const maximumX = Math.min(frame.width - 1, Math.ceil(center.x + halfSize.x));
    const minimumY = Math.max(0, Math.floor(center.y - halfSize.y));
    const maximumY = Math.min(frame.height - 1, Math.ceil(center.y + halfSize.y));
    const frequencies = new Map();
    let sampledPixelCount = 0;
    let nonTransparentPixelCount = 0;
    const maximumRaw = { r: 0, g: 0, b: 0, a: 0 };
    const maximumUnpremultiplied = { r: 0, g: 0, b: 0 };
    for (let y = minimumY; y <= maximumY; y++) {
        for (let x = minimumX; x <= maximumX; x++) {
            sampledPixelCount++;
            const pixel = decodeRenderPixel(frame, x, y, format);
            if (pixel.a === 0) { continue; }
            nonTransparentPixelCount++;
            maximumRaw.r = Math.max(maximumRaw.r, pixel.r);
            maximumRaw.g = Math.max(maximumRaw.g, pixel.g);
            maximumRaw.b = Math.max(maximumRaw.b, pixel.b);
            maximumRaw.a = Math.max(maximumRaw.a, pixel.a);
            const unpremultiplied = Object.freeze({
                r: Math.min(255, Math.round((pixel.r * 255) / pixel.a)),
                g: Math.min(255, Math.round((pixel.g * 255) / pixel.a)),
                b: Math.min(255, Math.round((pixel.b * 255) / pixel.a))
            });
            maximumUnpremultiplied.r = Math.max(
                maximumUnpremultiplied.r,
                unpremultiplied.r
            );
            maximumUnpremultiplied.g = Math.max(
                maximumUnpremultiplied.g,
                unpremultiplied.g
            );
            maximumUnpremultiplied.b = Math.max(
                maximumUnpremultiplied.b,
                unpremultiplied.b
            );
            const key = `${pixel.r},${pixel.g},${pixel.b},${pixel.a}`;
            const previous = frequencies.get(key);
            if (previous) {
                previous.count++;
            } else {
                frequencies.set(key, {
                    raw: pixel,
                    unpremultiplied,
                    count: 1,
                    targetDistanceSquared:
                        ((unpremultiplied.r - targetColor.r) ** 2)
                        + ((unpremultiplied.g - targetColor.g) ** 2)
                        + ((unpremultiplied.b - targetColor.b) ** 2)
                });
            }
        }
    }
    const colors = [...frequencies.values()];
    const toEvidence = (entry) => Object.freeze({
        raw: entry.raw,
        unpremultiplied: entry.unpremultiplied,
        count: entry.count,
        targetDistanceSquared: entry.targetDistanceSquared
    });
    return Object.freeze({
        bounds: Object.freeze({ minimumX, maximumX, minimumY, maximumY }),
        sampledPixelCount,
        nonTransparentPixelCount,
        uniqueColorCount: colors.length,
        maximumRaw: Object.freeze(maximumRaw),
        maximumUnpremultiplied: Object.freeze(maximumUnpremultiplied),
        mostFrequent: Object.freeze(colors.slice().sort((left, right) => (
            right.count - left.count
                || left.targetDistanceSquared - right.targetDistanceSquared
        )).slice(0, 8).map(toEvidence)),
        closestToTarget: Object.freeze(colors.slice().sort((left, right) => (
            left.targetDistanceSquared - right.targetDistanceSquared
                || right.count - left.count
        )).slice(0, 8).map(toEvidence))
    });
}

async function waitForFormationPrepare(backend, device, timeoutMs = 5_000) {
    await device.queue.onSubmittedWorkDone();
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        const completed = backend.drainCompletedFormationPrepareBatches([]);
        if (completed.length > 0) {
            return completed[0];
        }
        await new Promise((resolve) => setTimeout(resolve, 4));
    }
    throw new Error(
        `Formation prepare timeout: ${JSON.stringify(backend.getFormationRuntimeStatus())}`
    );
}

async function waitForFormationTransform(
    backend,
    device,
    targetFixedTick,
    timeoutMs = 5_000
) {
    await device.queue.onSubmittedWorkDone();
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        const completion = backend.getFormationRuntimeStatus()
            .lastTransformCompletion;
        if (completion?.sourceTick === targetFixedTick) {
            return completion;
        }
        await new Promise((resolve) => setTimeout(resolve, 4));
    }
    throw new Error(
        `Formation transform timeout: ${JSON.stringify(backend.getFormationRuntimeStatus())}`
    );
}

async function waitForEffectCompletion(backend, device, timeoutMs = 5_000) {
    await device.queue.onSubmittedWorkDone();
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        const completed = backend.drainCompletedEffectProgramBatches([]);
        if (completed.length > 0) {
            return completed[0];
        }
        await new Promise((resolve) => setTimeout(resolve, 4));
    }
    throw new Error(
        `Formation fixture Effect timeout: ${JSON.stringify(backend.getEffectRuntimeStatus())}`
    );
}

async function readFormationPlanes(backend, device, capacity) {
    const formationBytes = await readGpuBufferBytes(
        device,
        backend.simulation.buffers.formationStates,
        capacity * GPU_FORMATION_RUNTIME_ABI.BODY_STATE.STRIDE,
        'cirvivor-nw-hexa-formation-state'
    );
    const physicsBytes = await readGpuBufferBytes(
        device,
        backend.simulation.buffers.physics,
        capacity * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE,
        'cirvivor-nw-hexa-physics'
    );
    const simulationBytes = await readGpuBufferBytes(
        device,
        backend.simulation.buffers.simulation,
        capacity * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE,
        'cirvivor-nw-hexa-simulation'
    );
    const effectSummaryBytes = await readGpuBufferBytes(
        device,
        backend.simulation.buffers.effectSummaries,
        capacity * GPU_EFFECT_RUNTIME_ABI.SUMMARY.STRIDE,
        'cirvivor-nw-hexa-effect-summary'
    );
    const contactHandlerBytes = await readGpuBufferBytes(
        device,
        backend.simulation.buffers.contactHandlers,
        capacity * GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE,
        'cirvivor-nw-hexa-contact-handler'
    );
    const physics = new DataView(physicsBytes);
    const simulation = new DataView(simulationBytes);
    const effectSummaries = new DataView(effectSummaryBytes);
    const contactHandlers = new DataView(contactHandlerBytes);
    return Object.freeze(Array.from({ length: capacity }, (_, slot) => {
        const state = readGpuFormationBodyState(formationBytes, slot);
        const physicsOffset = slot * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE;
        const simulationOffset = slot * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
        const summaryOffset = slot * GPU_EFFECT_RUNTIME_ABI.SUMMARY.STRIDE;
        const contactOffset = slot * GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE;
        return Object.freeze({
            slot,
            state,
            position: Object.freeze({
                x: physics.getFloat32(
                    physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_X,
                    true
                ),
                y: physics.getFloat32(
                    physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_Y,
                    true
                )
            }),
            velocity: Object.freeze({
                x: physics.getFloat32(
                    physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_X,
                    true
                ),
                y: physics.getFloat32(
                    physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_Y,
                    true
                )
            }),
            radius: physics.getFloat32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.RADIUS,
                true
            ),
            inverseMass: physics.getFloat32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INVERSE_MASS,
                true
            ),
            healthFixedPoint: simulation.getInt32(
                simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH,
                true
            ),
            maxHealthFixedPoint: effectSummaries.getInt32(
                summaryOffset + GPU_EFFECT_RUNTIME_ABI.SUMMARY
                    .MAX_HEALTH_FIXED_POINT,
                true
            ),
            resolvedBaseTowerContactDamage: effectSummaries.getFloat32(
                summaryOffset + GPU_EFFECT_RUNTIME_ABI.SUMMARY
                    .RESOLVED_BASE_DAMAGE_OTHER,
                true
            ),
            boostStackCount: effectSummaries.getUint32(
                summaryOffset + GPU_EFFECT_RUNTIME_ABI.SUMMARY
                    .BOOST_STACK_COUNT,
                true
            ),
            attackMultiplier: effectSummaries.getFloat32(
                summaryOffset + GPU_EFFECT_RUNTIME_ABI.SUMMARY
                    .ATTACK_MULTIPLIER,
                true
            ),
            flowFieldIndex: simulation.getUint32(
                simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_FIELD_INDEX,
                true
            ),
            flowSpeed: simulation.getFloat32(
                simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_SPEED,
                true
            ),
            towerContactDamage: contactHandlers.getFloat32(
                contactOffset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_OTHER,
                true
            )
        });
    }));
}

async function readFormationMotionDiagnostics(backend, device, capacity) {
    const abi = GPU_FORMATION_RUNTIME_ABI.CANDIDATE_STATE;
    const bytes = await readGpuBufferBytes(
        device,
        backend.simulation.buffers.formationCandidates,
        capacity * abi.STRIDE,
        'cirvivor-nw-hexa-motion-diagnostics'
    );
    const view = new DataView(bytes);
    return Object.freeze(Array.from({ length: capacity }, (_, slot) => {
        const offset = slot * abi.STRIDE;
        return Object.freeze({
            slot,
            programIndex: view.getUint32(offset + abi.PROGRAM_INDEX, true),
            candidateSlot: view.getUint32(offset + abi.CANDIDATE_SLOT, true),
            forwardStageDelta: view.getUint32(
                offset + abi.MOTION_FORWARD_STAGE_DELTA,
                true
            ),
            forwardCostDelta: view.getFloat32(
                offset + abi.MOTION_FORWARD_COST_DELTA_BITS,
                true
            ),
            diagnosticFlags: view.getUint32(
                offset + abi.MOTION_DIAGNOSTIC_FLAGS,
                true
            )
        });
    }));
}

async function readActiveEffectInstances(backend, device, capacity) {
    const status = backend.getEffectRuntimeStatus();
    const pool = status.activePoolIndex === 0
        ? backend.simulation.buffers.effectInstancesA
        : backend.simulation.buffers.effectInstancesB;
    const bytes = await readGpuBufferBytes(
        device,
        pool,
        capacity * GPU_EFFECT_RUNTIME_ABI.INSTANCE.STRIDE,
        'cirvivor-nw-hexa-effect-instances'
    );
    const view = new DataView(bytes);
    const abi = GPU_EFFECT_RUNTIME_ABI.INSTANCE;
    const records = [];
    for (let index = 0; index < capacity; index++) {
        const offset = index * abi.STRIDE;
        const flags = view.getUint32(offset + abi.FLAGS, true);
        if ((flags & GPU_EFFECT_INSTANCE_FLAG.ACTIVE) === 0) { continue; }
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

async function readEffectPoolActiveCounts(backend, device, capacity) {
    const abi = GPU_EFFECT_RUNTIME_ABI.INSTANCE;
    const count = async (buffer, label) => {
        const bytes = await readGpuBufferBytes(
            device,
            buffer,
            capacity * abi.STRIDE,
            label
        );
        const view = new DataView(bytes);
        let activeCount = 0;
        for (let index = 0; index < capacity; index++) {
            const flags = view.getUint32((index * abi.STRIDE) + abi.FLAGS, true);
            activeCount += Number(
                (flags & GPU_EFFECT_INSTANCE_FLAG.ACTIVE) !== 0
            );
        }
        return activeCount;
    };
    return Object.freeze({
        poolA: await count(
            backend.simulation.buffers.effectInstancesA,
            'cirvivor-nw-hexa-effect-pool-a'
        ),
        poolB: await count(
            backend.simulation.buffers.effectInstancesB,
            'cirvivor-nw-hexa-effect-pool-b'
        )
    });
}

async function readAuthoritativeEffectPoolEvidence(backend, device, capacity) {
    const status = backend.getEffectRuntimeStatus();
    const rawCounts = await readEffectPoolActiveCounts(
        backend,
        device,
        capacity
    );
    const poolStateBytes = await readGpuBufferBytes(
        device,
        backend.simulation.buffers.effectPoolState,
        GPU_EFFECT_RUNTIME_ABI.POOL_STATE.STRIDE,
        'cirvivor-nw-hexa-effect-pool-state'
    );
    const poolState = readGpuEffectPoolState(poolStateBytes);
    const authoritativeActiveCount = status.activePoolIndex === 0
        ? rawCounts.poolA
        : rawCounts.poolB;
    return Object.freeze({
        activePoolIndex: status.activePoolIndex,
        authoritativeActiveCount,
        inputCount: poolState.inputCount,
        poolA: rawCounts.poolA,
        poolB: rawCounts.poolB
    });
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

function createPrepareRecords(groups, tick) {
    return groups
        .slice()
        .sort((left, right) => compareHandles(left.handle, right.handle))
        .map((group, index) => Object.freeze({
            sourceEntityId: group.handle.entityId,
            sourceIncarnation: group.handle.incarnation,
            prepareSequence: index,
            fingerprint: ((tick * 4099) + index + 1) >>> 0,
            flags: 0
        }));
}

function sourceSnapshot(result) {
    return Object.freeze({
        entityId: result.sourceEntityId,
        incarnation: result.sourceIncarnation,
        memberCount: result.memberCount,
        occupiedSlotMask: result.occupiedSlotMask,
        rotationStep: result.rotationStep,
        generation: result.generation,
        lineageHash: result.lineageHash,
        currentHealthCenti: result.currentHealthCenti,
        maxHealthCenti: result.maxHealthCenti
    });
}

function buildTransformRecords(completion, groupByHandle, targetFixedTick) {
    const roots = completion.results.filter((result) => (
        result.result === GPU_FORMATION_PREPARE_RESULT.MUTUAL_PAIR
            && result.programIndex === result.rootProgramIndex
    ));
    return Object.freeze(roots.map((root, index) => {
        const pair = completion.results[root.pairProgramIndex];
        assert(pair, 'Formation pair result missing');
        const rootGroup = groupByHandle.get(
            `${root.sourceEntityId}:${root.sourceIncarnation}`
        );
        const pairGroup = groupByHandle.get(
            `${pair.sourceEntityId}:${pair.sourceIncarnation}`
        );
        assert(rootGroup && pairGroup, 'Formation group lineage missing');
        const lineage = [...rootGroup.lineage, ...pairGroup.lineage]
            .sort(compareHandles);
        const destinationHandle = Object.freeze({
            entityId: root.sourceEntityId,
            incarnation: root.sourceIncarnation + 1
        });
        const memberCount = root.destinationMemberCount;
        const stats = resolveBasicHexaFormationStats(memberCount);
        const destination = Object.freeze({
            ...destinationHandle,
            definitionCode: root.definitionCode,
            coordinateSystemCode: root.coordinateSystemCode,
            policyCode: memberCount === BASIC_HEXA_MAXIMUM_MEMBER_COUNT
                ? ENEMY_FORMATION_POLICY_CODE.KEEP_FORMATION
                : ENEMY_FORMATION_POLICY_CODE.SEEK_FORMATION,
            memberCount,
            occupiedSlotMask: root.destinationOccupiedSlotMask,
            rotationStep: root.destinationRotationStep,
            generation: Math.max(root.generation, pair.generation) + 1,
            flags: GPU_FORMATION_BODY_STATE_FLAG.ACTIVE,
            lineageHash: createFormationLineageHash(lineage)
        });
        const expected = mergeBasicHexaHealthCenti({
            sourceACurrentHealthCenti: root.currentHealthCenti,
            sourceAMaxHealthCenti: root.maxHealthCenti,
            sourceBCurrentHealthCenti: pair.currentHealthCenti,
            sourceBMaxHealthCenti: pair.maxHealthCenti
        });
        assert(
            expected.currentHealthCenti
                    === root.expectedMergedCurrentHealthCenti
                && expected.maxHealthCenti
                    === root.expectedMergedMaxHealthCenti,
            'Formation integer HP prepare parity mismatch'
        );
        const motionSourceIndex = root.motionRootProgramIndex
            === root.programIndex ? 0 : 1;
        return Object.freeze({
            sourceA: sourceSnapshot(root),
            sourceB: sourceSnapshot(pair),
            destination,
            expectedCurrentHealthCenti: expected.currentHealthCenti,
            expectedMaxHealthCenti: expected.maxHealthCenti,
            destinationRadius: rootGroup.radius,
            destinationInverseMass: stats.inverseMass,
            destinationFlowSpeed: stats.moveSpeedTilesPerSecond,
            destinationTowerContactDamage: stats.towerContactDamage,
            motionSourceIndex,
            fingerprint: ((targetFixedTick * 65537) + index + 1) >>> 0,
            lineage
        });
    }));
}

function publicTransformRecord(record) {
    const { lineage: _lineage, ...publicRecord } = record;
    return publicRecord;
}

async function renderBackend(backend, device, texture, camera, frameId) {
    backend.updatePresentation({
        frameDelta: 0,
        fixedDelta: FIXED_DELTA,
        fixedAlpha: 1,
        renderFrameId: frameId
    });
    assert(backend.draw(camera), 'Hexa offscreen draw failed');
    await device.queue.onSubmittedWorkDone();
    return readRenderTexturePixels(
        device,
        texture,
        texture.width,
        texture.height
    );
}

async function runPrimaryFormationFixture(device, format) {
    const width = 192;
    const height = 128;
    const renderTexture = device.createTexture({
        label: 'cirvivor-nw-hexa-offscreen-render-target',
        size: { width, height },
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    const frameTarget = Object.freeze({
        device,
        texture: renderTexture,
        view: renderTexture.createView(),
        format,
        deviceGeneration: 1,
        width,
        height
    });
    const capacity = 8;
    const effectInstanceCapacity = 32;
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format, frameTarget)
    }, {
        capacity,
        effectCommandCapacity: 2,
        effectInstanceCapacity,
        effectCandidateCapacity: 16,
        effectEventCapacity: 24,
        formationCommandCapacity: 8,
        formationTransformCapacity: 4,
        sessionGeneration: 71
    });
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    backend.init(tileMap);
    const pairBase = tileMap.tileToWorld(7, 1, {});
    const pairCenters = Object.freeze([
        Object.freeze({ x: pairBase.x, y: pairBase.y - 0.45 }),
        Object.freeze({ x: pairBase.x, y: pairBase.y + 0.25 }),
        Object.freeze({ x: pairBase.x, y: pairBase.y - 1.15 })
    ]);
    const pairHalfSeparation = 0.325;
    const positions = Object.freeze(pairCenters.flatMap((center) => ([
        Object.freeze({
            x: center.x - pairHalfSeparation,
            y: center.y
        }),
        Object.freeze({
            x: center.x + pairHalfSeparation,
            y: center.y
        })
    ])));
    for (const position of positions) {
        const tile = tileMap.worldToTile(position.x, position.y, {});
        assert(tileMap.isWalkableTile(tile.row, tile.column),
            'Hexa primary pair position must be walkable');
    }
    const firstFieldIndex = backend.flowRouteByPathId.get(route.pathId)
        ?.firstFieldIndex;
    const atlas = backend.flowFieldAtlas;
    const integrationCosts = positions.map((position) => {
        const tile = tileMap.worldToTile(position.x, position.y, {});
        return atlas.integrationCosts[
            (firstFieldIndex * atlas.size)
                + (tile.row * atlas.cols)
                + tile.column
        ];
    });
    assert(Number.isSafeInteger(firstFieldIndex)
        && integrationCosts.slice(0, 4).every(
            (cost) => cost === integrationCosts[0]
        )
        && integrationCosts.slice(4).every(
            (cost) => cost === integrationCosts[4]
        )
        && integrationCosts[4] > integrationCosts[0],
    'Hexa primary A/B contour and chasing C contour mismatch');
    const groups = positions.map((position, index) => {
        const handle = Object.freeze({ entityId: 501 + index, incarnation: 1 });
        const body = createNaturalHexa(
            route,
            index,
            handle,
            position
        );
        return {
            handle,
            body,
            radius: body.radius,
            lineage: Object.freeze([handle])
        };
    });
    const mateDistance = pairHalfSeparation * 2;
    const mergeCommitDistance =
        HEXA_HIVE_SIX_RING_FORMATION_DEFINITION.mergeCommitDistanceTiles;
    const solverMinimumDistance = mergeCommitDistance
        * MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE;
    const crossPairDistances = [];
    for (let leftPair = 0; leftPair < pairCenters.length; leftPair++) {
        for (let rightPair = leftPair + 1;
            rightPair < pairCenters.length;
            rightPair++) {
            for (let leftMember = 0; leftMember < 2; leftMember++) {
                for (let rightMember = 0; rightMember < 2; rightMember++) {
                    const left = positions[(leftPair * 2) + leftMember];
                    const right = positions[(rightPair * 2) + rightMember];
                    crossPairDistances.push(Math.hypot(
                        right.x - left.x,
                        right.y - left.y
                    ));
                }
            }
        }
    }
    const minimumCrossPairDistance = Math.min(...crossPairDistances);
    const maximumInitialTravel = groups[0].body.flowSpeed * FIXED_DELTA;
    const minimumRowMargin = Math.min(...pairCenters.map((center) => {
        const rowFraction = center.y - Math.floor(center.y);
        return Math.min(rowFraction, 1 - rowFraction);
    }));
    assert(mateDistance > solverMinimumDistance
        && mateDistance < mergeCommitDistance
        && minimumCrossPairDistance > mateDistance
        && minimumCrossPairDistance < mergeCommitDistance,
    'Hexa primary mate/cross solver and commit distance invariant failed');
    assert(minimumRowMargin > maximumInitialTravel,
        'Hexa primary pair center lacks one-tick row margin');
    const pentaHandle = Object.freeze({ entityId: 590, incarnation: 1 });
    const pentaPosition = Object.freeze(tileMap.tileToWorld(10, 1, {}));
    const pentaTile = tileMap.worldToTile(
        pentaPosition.x,
        pentaPosition.y,
        {}
    );
    const pentaTargetDistances = positions.map((position) => Math.hypot(
        position.x - pentaPosition.x,
        position.y - pentaPosition.y
    ));
    assert(tileMap.isWalkableTile(pentaTile.row, pentaTile.column)
        && Math.min(...pentaTargetDistances) > mergeCommitDistance
        && Math.max(...pentaTargetDistances)
            <= PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.pulseRadiusTiles,
    'Hexa primary Penta must be walkable, non-contact, and cover all H');
    const penta = createPenta(
        route,
        7,
        pentaHandle,
        pentaPosition
    );
    assert(
        backend.replaceBodies([...groups.map(({ body }) => body), penta])
            .accepted === 7,
        'Hexa primary replacement failed'
    );

    let activeGroups = groups.map(({ handle, radius, lineage }) => ({
        handle,
        radius,
        lineage,
        expectedMemberCount: 1,
        expectedOccupiedSlotMask: 1,
        expectedRotationStep: 0,
        expectedGeneration: 1,
        expectedLineageHash: createFormationLineageHash(lineage)
    }));
    let tick = 1;
    let mergeCount = 0;
    let integerHealthParity = true;
    let effectEvidence = null;
    let initialEffectInstances = null;
    let wholeChainEffectParity = true;
    let preparedEffectRekeyTotal = 0;
    let actualEffectRekeyTotal = 0;
    const consumedHandles = new Set();
    const transformCompletions = [];
    const transformStatRecords = [];
    for (let attempt = 0;
        attempt < 90 && activeGroups.length > 1;
        attempt++) {
        const prepareProtocol = backend.getEventProtocolState();
        const prepareBatchIdFingerprint = (0x510000 + tick) >>> 0;
        const stage = backend.stageFormationPrepareBatch({
            abiVersion: GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
            batchIdFingerprint: prepareBatchIdFingerprint,
            targetFixedTick: tick,
            records: createPrepareRecords(activeGroups, tick)
        });
        assert(stage.accepted, `Formation prepare stage failed: ${stage.reason}`);
        let stagedPulse = false;
        if (tick === 1) {
            const effectStage = backend.stageEffectPulseProgramBatch({
                abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
                batchIdFingerprint: 0x510100,
                sourceTick: tick,
                records: [createPulseRecord(penta, tick)]
            });
            assert(effectStage.accepted, 'Hexa source Effect pulse stage failed');
            stagedPulse = true;
        }
        assert(backend.fixedUpdate(FIXED_DELTA, tick), 'Formation prepare submit failed');
        const prepare = await waitForFormationPrepare(backend, device);
        assert(prepare.abiVersion === GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
            'Formation prepare completion ABI mismatch');
        assert(prepare.status === GPU_FORMATION_RUNTIME_STATUS.OK,
            `Formation prepare status=${prepare.status}`);
        assert(prepare.gridSmallOverflow === 0 && prepare.gridBigOverflow === 0,
            'Formation primary grid overflowed');
        if (stagedPulse) {
            const effect = await waitForEffectCompletion(backend, device);
            assert(effect.status === GPU_EFFECT_RUNTIME_STATUS.OK,
                `Formation source Effect status=${effect.status}`);
            assert(effect.appliedInstanceCount === 6,
                `Formation source Effect target count=${effect.appliedInstanceCount}`);
            initialEffectInstances = (await readActiveEffectInstances(
                backend,
                device,
                effectInstanceCapacity
            )).filter((instance) => groups.some(({ handle }) => (
                instance.targetEntityId === handle.entityId
                    && instance.targetIncarnation === handle.incarnation
            )));
            assert(initialEffectInstances.length === 6,
                'Formation chain initial Effect snapshot is not exact six');
            if (prepare.pairCount !== 3) {
                const [planes, diagnostics] = await Promise.all([
                    readFormationPlanes(backend, device, capacity),
                    readFormationMotionDiagnostics(backend, device, capacity)
                ]);
                assert(false,
                    `Formation first append-independent pairCount=${prepare.pairCount}: `
                    + JSON.stringify({ planes, diagnostics }));
            }
            assert(prepare.pairCount === 3,
                `Formation first append-independent pairCount=${prepare.pairCount}`);
        }
        if (prepare.pairCount === 0) {
            tick++;
            continue;
        }
        const groupByHandle = new Map(activeGroups.map((group) => [
            handleKey(group.handle),
            group
        ]));
        const transformRecords = buildTransformRecords(
            prepare,
            groupByHandle,
            tick + 1
        );
        assert(transformRecords.length === prepare.pairCount,
            'Formation transform pair count mismatch');
        transformStatRecords.push(...transformRecords.map((record) => (
            Object.freeze({
                targetFixedTick: tick + 1,
                sourceA: record.sourceA,
                sourceB: record.sourceB,
                destination: record.destination,
                destinationRadius: record.destinationRadius,
                destinationInverseMass: record.destinationInverseMass,
                destinationFlowSpeed: record.destinationFlowSpeed,
                destinationTowerContactDamage:
                    record.destinationTowerContactDamage
            })
        )));
        const consumedThisBatch = new Set();
        const destinationBySource = new Map();
        const preTransformPlanes = await readFormationPlanes(
            backend,
            device,
            capacity
        );
        const slotByHandle = new Map(preTransformPlanes.map((entry) => [
            `${entry.state.entityId}:${entry.state.incarnation}`,
            entry.slot
        ]));
        for (const record of transformRecords) {
            const destinationSlot = slotByHandle.get(handleKey(record.sourceA));
            assert(Number.isInteger(destinationSlot),
                'Formation destination root slot evidence missing');
            for (const source of [record.sourceA, record.sourceB]) {
                consumedThisBatch.add(handleKey(source));
                consumedHandles.add(handleKey(source));
                destinationBySource.set(handleKey(source), Object.freeze({
                    handle: record.destination,
                    slot: destinationSlot
                }));
            }
        }
        const effectsBefore = (await readActiveEffectInstances(
            backend,
            device,
            effectInstanceCapacity
        )).filter((instance) => destinationBySource.has(
            `${instance.targetEntityId}:${instance.targetIncarnation}`
        ));
        if (effectEvidence === null) {
            const first = transformRecords[0];
            const sourceACount = effectsBefore.filter((instance) => (
                instance.targetEntityId === first.sourceA.entityId
                    && instance.targetIncarnation === first.sourceA.incarnation
            )).length;
            const sourceBCount = effectsBefore.filter((instance) => (
                instance.targetEntityId === first.sourceB.entityId
                    && instance.targetIncarnation === first.sourceB.incarnation
            )).length;
            assert(effectsBefore.length > 0 && sourceACount > 0 && sourceBCount > 0,
                'Formation transform lacks nonzero Effect sources');
            effectEvidence = {
                effectsBefore,
                sourceACount,
                sourceBCount,
                beforeCount: initialEffectInstances?.length ?? 0
            };
        }
        const arm = backend.armPreparedFormationTransformBatch({
            abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
            batchIdFingerprint: (0x610000 + tick) >>> 0,
            prepareBatchIdFingerprint,
            preparedSourceTick: tick,
            targetFixedTick: tick + 1,
            prepareProtocol,
            records: transformRecords.map(publicTransformRecord)
        });
        assert(arm.accepted, `Formation transform arm failed: ${arm.reason}`);
        const committed = backend.commitArmedFormationTransformBatch(arm.receipt);
        assert(committed.accepted && committed.commitRequested,
            'Formation transform commit request failed');
        assert(backend.fixedUpdate(FIXED_DELTA, tick + 1),
            'Formation transform submit failed');
        const transform = await waitForFormationTransform(
            backend,
            device,
            tick + 1
        );
        assert(transform.abiVersion === GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
            'Formation transform completion ABI mismatch');
        assert(transform.status === GPU_FORMATION_RUNTIME_STATUS.OK
            && transform.committedCount === transformRecords.length,
        `Formation transform completion failed: ${transform.status}`);
        assert(transform.preparedEffectRekeyCount === transform.effectRekeyCount,
            'Formation Effect prepared/actual rekey mismatch');
        assert(transform.preparedEffectRekeyCount === effectsBefore.length,
            'Formation Effect transform-step expected count mismatch');
        preparedEffectRekeyTotal += transform.preparedEffectRekeyCount;
        actualEffectRekeyTotal += transform.effectRekeyCount;
        transformCompletions.push(transform);
        const postTransformPlanes = await readFormationPlanes(
            backend,
            device,
            capacity
        );
        for (const record of transformRecords) {
            const live = postTransformPlanes.find(({ state }) => (
                state.entityId === record.destination.entityId
                    && state.incarnation === record.destination.incarnation
            ));
            const exactCurrent = Math.min(
                record.expectedMaxHealthCenti,
                record.expectedCurrentHealthCenti + 1
            );
            assert(live
                && live.healthFixedPoint === exactCurrent
                && live.maxHealthFixedPoint === record.expectedMaxHealthCenti,
            'Formation live GPU centi-HP/max does not match integer merge');
        }
        {
            const allEffectsAfter = await readActiveEffectInstances(
                backend,
                device,
                effectInstanceCapacity
            );
            const afterByIdentity = new Map(allEffectsAfter.map((instance) => [
                `${instance.effectInstanceId}:${instance.instanceIncarnation}`,
                instance
            ]));
            let stepParity = true;
            for (const before of effectsBefore) {
                const after = afterByIdentity.get(
                    `${before.effectInstanceId}:${before.instanceIncarnation}`
                );
                const destination = destinationBySource.get(
                    `${before.targetEntityId}:${before.targetIncarnation}`
                );
                stepParity = stepParity
                    && Boolean(after)
                    && exactEffectPayloadEqual(before, after)
                    && after.targetEntityId === destination.handle.entityId
                    && after.targetIncarnation === destination.handle.incarnation
                    && after.targetSlot === destination.slot;
            }
            const afterCount = effectsBefore.filter((before) => (
                afterByIdentity.has(
                    `${before.effectInstanceId}:${before.instanceIncarnation}`
                )
            )).length;
            wholeChainEffectParity = wholeChainEffectParity && stepParity;
            assert(stepParity && afterCount === effectsBefore.length,
            'Formation exact active Effect transfer failed');
            if (!effectEvidence.effectsAfter) {
                Object.assign(effectEvidence, {
                effectsAfter: allEffectsAfter,
                afterCount,
                exactIdentityPayloadParity: stepParity,
                preparedEffectRekeyCount: transform.preparedEffectRekeyCount,
                actualEffectRekeyCount: transform.effectRekeyCount
                });
            }
        }
        const nextGroups = activeGroups.filter((group) => (
            !consumedThisBatch.has(handleKey(group.handle))
        ));
        for (const record of transformRecords) {
            nextGroups.push(Object.freeze({
                handle: Object.freeze({
                    entityId: record.destination.entityId,
                    incarnation: record.destination.incarnation
                }),
                radius: record.destinationRadius,
                lineage: Object.freeze(record.lineage),
                expectedMemberCount: record.destination.memberCount,
                expectedOccupiedSlotMask:
                    record.destination.occupiedSlotMask,
                expectedRotationStep: record.destination.rotationStep,
                expectedGeneration: record.destination.generation,
                expectedLineageHash: record.destination.lineageHash,
                expectedCurrentHealthCenti: Math.min(
                    record.expectedMaxHealthCenti,
                    record.expectedCurrentHealthCenti + 1
                ),
                expectedMaxHealthCenti: record.expectedMaxHealthCenti
            }));
            integerHealthParity = integerHealthParity
                && record.expectedCurrentHealthCenti > 0
                && record.expectedCurrentHealthCenti
                    <= record.expectedMaxHealthCenti;
        }
        activeGroups = nextGroups;
        mergeCount += transformRecords.length;
        tick += 2;
    }
    if (activeGroups.length !== 1) {
        const [plateauPlanes, plateauDiagnostics] = await Promise.all([
            readFormationPlanes(backend, device, capacity),
            readFormationMotionDiagnostics(backend, device, capacity)
        ]);
        const plateauFlowEvidence = plateauPlanes.map((plane) => {
            const tile = tileMap.worldToTile(
                plane.position.x,
                plane.position.y,
                {}
            );
            const fieldIndex = plane.flowFieldIndex;
            const cellIndex = (tile.row * atlas.cols) + tile.column;
            const fieldOffset = (fieldIndex * atlas.size) + cellIndex;
            const directionOffset = fieldOffset * 2;
            const fieldValid = Number.isSafeInteger(fieldIndex)
                && fieldIndex >= 0
                && fieldIndex < atlas.fieldCount
                && tile.row >= 0
                && tile.row < atlas.rows
                && tile.column >= 0
                && tile.column < atlas.cols;
            return Object.freeze({
                slot: plane.slot,
                entityId: plane.state.entityId,
                incarnation: plane.state.incarnation,
                tile: Object.freeze({ row: tile.row, column: tile.column }),
                flowFieldIndex: fieldIndex,
                integrationCost: fieldValid
                    ? atlas.integrationCosts[fieldOffset]
                    : null,
                flowDirection: fieldValid
                    ? Object.freeze({
                        x: atlas.directions[directionOffset],
                        y: atlas.directions[directionOffset + 1]
                    })
                    : null
            });
        });
        assert(false, 'Formation chain did not converge to HX: '
            + JSON.stringify({
                tick,
                mergeCount,
                activeGroups: activeGroups.map((group) => Object.freeze({
                    handle: group.handle,
                    lineage: group.lineage,
                    expectedMemberCount: group.expectedMemberCount,
                    expectedOccupiedSlotMask:
                        group.expectedOccupiedSlotMask,
                    expectedRotationStep: group.expectedRotationStep,
                    expectedGeneration: group.expectedGeneration,
                    expectedLineageHash: group.expectedLineageHash
                })),
                planes: plateauPlanes,
                flow: plateauFlowEvidence,
                diagnostics: plateauDiagnostics,
                transformCompletions,
                formationStatus: backend.getFormationRuntimeStatus()
            }));
    }
    assert(mergeCount === 5, `Formation merge count=${mergeCount}`);
    const finalGroup = activeGroups[0];
    const planes = await readFormationPlanes(backend, device, capacity);
    const activeFormation = planes.filter(({ state }) => (
        (state.flags & GPU_FORMATION_BODY_STATE_FLAG.ACTIVE) !== 0
    ));
    assert(activeFormation.length === 1,
        `Formation active destination count=${activeFormation.length}`);
    const finalPlane = activeFormation[0];
    assert(finalPlane.state.entityId === finalGroup.handle.entityId
        && finalPlane.state.incarnation === finalGroup.handle.incarnation,
    'Formation final exact handle mismatch');
    assert(finalPlane.state.memberCount === 6
        && finalPlane.state.occupiedSlotMask === 0x3f,
    'Formation final HX state mismatch');
    const initialLineage = groups.map(({ handle }) => handle).sort(compareHandles);
    const expectedLineageHash = createFormationLineageHash(initialLineage);
    assert(finalPlane.state.memberCount === finalGroup.expectedMemberCount
        && finalPlane.state.occupiedSlotMask
            === finalGroup.expectedOccupiedSlotMask
        && finalPlane.state.rotationStep === finalGroup.expectedRotationStep
        && finalPlane.state.generation === finalGroup.expectedGeneration
        && finalPlane.state.lineageHash === finalGroup.expectedLineageHash
        && finalPlane.state.lineageHash === expectedLineageHash,
    'Formation final lineage/generation/rotation mismatch');
    assert(finalPlane.healthFixedPoint === finalGroup.expectedCurrentHealthCenti
        && finalPlane.maxHealthFixedPoint === finalGroup.expectedMaxHealthCenti,
    'Formation final live HP/max parity mismatch');
    const finalStats = resolveBasicHexaFormationStats(6);
    const expectedEffectiveTowerContactDamage = Math.fround(
        finalStats.towerContactDamage * finalPlane.attackMultiplier
    );
    const expectedGpuRadius = Math.fround(finalGroup.radius);
    const finalStatEvidence = Object.freeze({
        expected: Object.freeze({
            authoredRadius: finalGroup.radius,
            gpuRadius: expectedGpuRadius,
            inverseMass: finalStats.inverseMass,
            derivedWeight: finalStats.weight,
            flowSpeed: finalStats.moveSpeedTilesPerSecond,
            baseTowerContactDamage: finalStats.towerContactDamage,
            effectiveTowerContactDamage:
                expectedEffectiveTowerContactDamage
        }),
        actual: Object.freeze({
            radius: finalPlane.radius,
            inverseMass: finalPlane.inverseMass,
            derivedWeight: Math.fround(1 / finalPlane.inverseMass),
            flowSpeed: finalPlane.flowSpeed,
            baseTowerContactDamage:
                finalPlane.resolvedBaseTowerContactDamage,
            boostStackCount: finalPlane.boostStackCount,
            attackMultiplier: finalPlane.attackMultiplier,
            effectiveTowerContactDamage: finalPlane.towerContactDamage,
            effectSummaryMaxHealthFixedPoint:
                finalPlane.maxHealthFixedPoint
        }),
        transformStatRecords: Object.freeze(transformStatRecords.slice()),
        transformCompletions: Object.freeze(transformCompletions.slice())
    });
    assert(finalPlane.radius === expectedGpuRadius
        && finalPlane.inverseMass === finalStats.inverseMass
        && Math.fround(1 / finalPlane.inverseMass) === finalStats.weight
        && finalPlane.flowSpeed === finalStats.moveSpeedTilesPerSecond
        && finalPlane.resolvedBaseTowerContactDamage
            === finalStats.towerContactDamage
        && finalPlane.towerContactDamage
            === expectedEffectiveTowerContactDamage,
    `Formation final GPU n-table stat materialization mismatch: ${
        JSON.stringify(finalStatEvidence)
    }`);
    const survivingConsumed = planes.filter(({ state }) => (
        consumedHandles.has(`${state.entityId}:${state.incarnation}`)
    ));
    assert(survivingConsumed.length === 0,
        'Formation consumed source survived transform');
    const reservedSlotCount = activeFormation.filter(({ state }) => (
        (state.presentationFlags
            & GPU_FORMATION_BODY_STATE_FLAG.PRESENTATION_RESERVATION) !== 0
    )).length;
    assert(reservedSlotCount === 0, 'HX retained a stale reservation');
    const finalEffects = await readActiveEffectInstances(
        backend,
        device,
        effectInstanceCapacity
    );
    const finalTargetEffects = finalEffects.filter((instance) => (
        instance.targetEntityId === finalGroup.handle.entityId
            && instance.targetIncarnation === finalGroup.handle.incarnation
    ));
    assert(finalTargetEffects.length === 6,
        `HX active Effect target count=${finalTargetEffects.length}`);
    const finalEffectByIdentity = new Map(finalTargetEffects.map((instance) => [
        `${instance.effectInstanceId}:${instance.instanceIncarnation}`,
        instance
    ]));
    let finalExactIdentityPayloadTargetSlotParity
        = initialEffectInstances?.length === 6;
    for (const initial of initialEffectInstances ?? []) {
        const final = finalEffectByIdentity.get(
            `${initial.effectInstanceId}:${initial.instanceIncarnation}`
        );
        finalExactIdentityPayloadTargetSlotParity
            = finalExactIdentityPayloadTargetSlotParity
                && Boolean(final)
                && exactEffectPayloadEqual(initial, final)
                && final.targetEntityId === finalGroup.handle.entityId
                && final.targetIncarnation === finalGroup.handle.incarnation
                && final.targetSlot === finalPlane.slot;
    }
    assert(wholeChainEffectParity
        && finalExactIdentityPayloadTargetSlotParity
        && preparedEffectRekeyTotal === actualEffectRekeyTotal,
    'Formation whole-chain Effect exact identity/target-slot parity failed');

    const scale = 26;
    const center = Object.freeze({ x: 96, y: 58 });
    const camera = Object.freeze({
        worldToViewport(x, y, out) {
            out.x = center.x + ((x - finalPlane.position.x) * scale);
            out.y = center.y + ((y - finalPlane.position.y) * scale);
            return out;
        },
        getScale: () => scale
    });
    const fullHealthFrame = await renderBackend(
        backend,
        device,
        renderTexture,
        camera,
        1
    );
    const occupiedPixels = countOpaquePixels(fullHealthFrame, center, 34);
    assert(occupiedPixels > 100, 'HX occupied cells were not rendered');
    const formationDirections = Object.freeze([
        Object.freeze({ x: 1, y: 0 }),
        Object.freeze({ x: 0.5, y: -0.8660254037844386 }),
        Object.freeze({ x: -0.5, y: -0.8660254037844386 }),
        Object.freeze({ x: -1, y: 0 }),
        Object.freeze({ x: -0.5, y: 0.8660254037844386 }),
        Object.freeze({ x: 0.5, y: 0.8660254037844386 })
    ]);
    const formationPixelRadius = finalGroup.radius * scale;
    const localToPixel = (local) => Object.freeze({
        x: center.x + (local.x * formationPixelRadius),
        y: center.y + (local.y * formationPixelRadius)
    });
    const occupiedCellSampleCount = formationDirections.filter((direction) => {
        const sample = localToPixel({
            x: direction.x * 0.54,
            y: direction.y * 0.54
        });
        return patchHasPixel(
            fullHealthFrame,
            sample.x,
            sample.y,
            format,
            (pixel) => pixel.a > 0,
            1
        );
    }).length;
    const memberLinkSampleCount = formationDirections.filter((direction, index) => {
        const next = formationDirections[(index + 1) % formationDirections.length];
        const sample = localToPixel({
            x: ((direction.x + next.x) * 0.5) * 0.54,
            y: ((direction.y + next.y) * 0.5) * 0.54
        });
        return patchHasPixel(
            fullHealthFrame,
            sample.x,
            sample.y,
            format,
            (pixel) => pixel.a > 0,
            1
        );
    }).length;
    const goldenCellSampleCount = formationDirections.filter((direction) => {
        const sample = localToPixel({
            x: direction.x * 0.54,
            y: direction.y * 0.54
        });
        return patchHasPixel(
            fullHealthFrame,
            sample.x,
            sample.y,
            format,
            (pixel) => pixel.a > 0 && pixel.r > pixel.g && pixel.g > pixel.b,
            1
        );
    }).length;
    assert(occupiedCellSampleCount === 6
        && memberLinkSampleCount === 6
        && goldenCellSampleCount === 6,
    'HX six-ring cell/link/golden position samples mismatch');
    const healthBytes = new ArrayBuffer(4);
    new DataView(healthBytes).setInt32(
        0,
        Math.max(1, Math.floor(finalPlane.healthFixedPoint / 2)),
        true
    );
    device.queue.writeBuffer(
        backend.simulation.buffers.simulation,
        (finalPlane.slot * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE)
            + GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH,
        healthBytes
    );
    await device.queue.onSubmittedWorkDone();
    const halfHealthFrame = await renderBackend(
        backend,
        device,
        renderTexture,
        camera,
        2
    );
    const hxHealthBarChangedPixels = countChangedPixels(
        fullHealthFrame,
        halfHealthFrame
    );
    const hxHealthBarRoiPixelDelta = countChangedPixelsInRoi(
        fullHealthFrame,
        halfHealthFrame,
        localToPixel({ x: 0, y: 0.86 }),
        {
            x: Math.max(2, formationPixelRadius * 0.72),
            y: Math.max(2, formationPixelRadius * 0.11)
        }
    );
    assert(hxHealthBarChangedPixels > 0,
        'HX separate health bar did not change rendered pixels');
    assert(hxHealthBarRoiPixelDelta > 0,
        'HX health bar bounded ROI did not change rendered pixels');

    const replacementFormationStatusBefore
        = backend.getFormationRuntimeStatus();
    const replacementEffectStatusBefore = backend.getEffectRuntimeStatus();
    const replacementEpochBefore
        = replacementFormationStatusBefore.authoritativeEpoch;
    const replacementActiveHxBefore = activeFormation.filter(({ state }) => (
        state.memberCount === 6
    )).length;
    const replacementActiveEffectCountBefore = finalTargetEffects.length;
    const replacementPresentationMergePulseBefore
        = finalPlane.state.presentationFlags
            & GPU_FORMATION_BODY_STATE_FLAG.PRESENTATION_MERGE_PULSE;
    const replacementEffectPoolsBefore
        = await readAuthoritativeEffectPoolEvidence(
        backend,
        device,
        effectInstanceCapacity
    );
    assert(backend.replaceBodies([]).accepted === 0,
        'HX authoritative replacement clear failed');
    const replacementFormationStatus = backend.getFormationRuntimeStatus();
    const replacementEffectStatus = backend.getEffectRuntimeStatus();
    const replacementResourcesReleased = backend.simulation.buffers === null;
    const replacementActiveBodyCountAfter = backend.simulation.activeBodyCount;
    assert(replacementActiveHxBefore === 1
        && replacementActiveEffectCountBefore === 6
        && replacementEffectStatusBefore.ingressOpen === true
        && (replacementEffectPoolsBefore.activePoolIndex === 0
            || replacementEffectPoolsBefore.activePoolIndex === 1)
        && replacementEffectPoolsBefore.authoritativeActiveCount === 6
        && replacementEffectPoolsBefore.inputCount === 6
        && replacementPresentationMergePulseBefore
            === GPU_FORMATION_BODY_STATE_FLAG.PRESENTATION_MERGE_PULSE
        && replacementActiveBodyCountAfter === 0
        && replacementResourcesReleased
        && replacementFormationStatus.authoritativeEpoch
            > replacementEpochBefore
        && replacementFormationStatus.pendingPrepareProgramCount === 0
        && replacementFormationStatus.pendingPrepareReadbackCount === 0
        && replacementFormationStatus.armedTransformCount === 0
        && replacementFormationStatus.pendingTransformReadbackCount === 0
        && replacementEffectStatus.pendingPulseProgramCount === 0
        && replacementEffectStatus.pendingEffectReadbackCount === 0,
    'HX authoritative replacement did not retire transient GPU world');

    const replacementRespawnHandle = Object.freeze({
        entityId: finalGroup.handle.entityId,
        incarnation: finalGroup.handle.incarnation + 1
    });
    const replacementRespawn = createNaturalHexa(
        route,
        99,
        replacementRespawnHandle,
        finalPlane.position
    );
    assert(backend.replaceBodies([replacementRespawn]).accepted === 1,
        'HX authoritative replacement fresh n1 respawn failed');
    const replacementRespawnPlanes = await readFormationPlanes(
        backend,
        device,
        capacity
    );
    const replacementRespawnActive = replacementRespawnPlanes.filter(({ state }) => (
        (state.flags & GPU_FORMATION_BODY_STATE_FLAG.ACTIVE) !== 0
    ));
    const replacementRespawnEffectPools
        = await readAuthoritativeEffectPoolEvidence(
        backend,
        device,
        effectInstanceCapacity
    );
    const replacementRespawnFormationStatus = backend.getFormationRuntimeStatus();
    const replacementRespawnEffectStatus = backend.getEffectRuntimeStatus();
    const replacementRespawnResourcesPresent = backend.simulation.buffers !== null;
    const replacementRespawnOldHandleCount = replacementRespawnPlanes.filter(({
        state
    }) => state.entityId === finalGroup.handle.entityId
        && state.incarnation === finalGroup.handle.incarnation).length;
    const replacementRespawnActiveHxCount = replacementRespawnActive.filter(({
        state
    }) => state.memberCount === 6).length;
    const replacementRespawnPresentationCount = replacementRespawnActive.filter(({
        state
    }) => state.presentationFlags !== 0).length;
    assert(replacementRespawnResourcesPresent
        && replacementRespawnFormationStatus.authoritativeEpoch
            > replacementFormationStatus.authoritativeEpoch
        && replacementRespawnActive.length === 1
        && replacementRespawnActive[0].state.entityId
            === replacementRespawnHandle.entityId
        && replacementRespawnActive[0].state.incarnation
            === replacementRespawnHandle.incarnation
        && replacementRespawnActive[0].state.memberCount === 1
        && replacementRespawnActive[0].state.generation === 1
        && replacementRespawnActive[0].state.lineageHash
            === createFormationLineageHash([replacementRespawnHandle])
        && replacementRespawnOldHandleCount === 0
        && replacementRespawnActiveHxCount === 0
        && replacementRespawnPresentationCount === 0
        && replacementRespawnEffectPools.poolA === 0
        && replacementRespawnEffectPools.poolB === 0
        && replacementRespawnEffectPools.authoritativeActiveCount === 0
        && replacementRespawnEffectPools.inputCount === 0
        && replacementRespawnFormationStatus.ingressOpen === true
        && replacementRespawnEffectStatus.ingressOpen === true
        && replacementRespawnFormationStatus.pendingPrepareProgramCount === 0
        && replacementRespawnFormationStatus.pendingPrepareReadbackCount === 0
        && replacementRespawnFormationStatus.armedTransformCount === 0
        && replacementRespawnFormationStatus.pendingTransformReadbackCount === 0
        && replacementRespawnEffectStatus.pendingPulseProgramCount === 0
        && replacementRespawnEffectStatus.pendingEffectReadbackCount === 0,
    'HX authoritative replacement fresh allocation retained transient state');

    const finalFixedTick = tick;
    const formationTerminal = backend.cancelPendingFormationProgramsForTerminal({
        abiVersion: GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION,
        finalFixedTick
    });
    const effectTerminal = backend.cancelPendingEffectProgramsForTerminal({
        abiVersion: GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION,
        finalFixedTick
    });
    assert(formationTerminal.state === 'armed' && effectTerminal.state === 'armed',
        'Formation/Effect terminal arm failed');
    assert(backend.fixedUpdate(FIXED_DELTA, finalFixedTick),
        'Formation terminal final submit failed');
    await device.queue.onSubmittedWorkDone();
    const formationStatus = backend.getFormationRuntimeStatus();
    const effectStatus = backend.getEffectRuntimeStatus();
    const storageProfile = formationStatus.storageProfile;
    assert(storageProfile?.maximum === 9 && storageProfile?.render === 8,
        `Formation storage telemetry mismatch: ${JSON.stringify(storageProfile)}`);
    assert(formationStatus.terminal?.state === 'submitted'
        && formationStatus.terminal.submittedTick === finalFixedTick,
    'Formation terminal evidence mismatch');
    assert(effectStatus.terminal?.state === 'submitted'
        && effectStatus.terminal.submittedTick === finalFixedTick,
    'Effect terminal evidence mismatch');
    assert(formationStatus.pendingPrepareProgramCount === 0
        && formationStatus.pendingPrepareReadbackCount === 0
        && formationStatus.pendingTransformReadbackCount === 0
        && formationStatus.armedTransformCount === 0
        && effectStatus.pendingPulseProgramCount === 0
        && effectStatus.pendingEffectReadbackCount === 0,
    'Terminal left Formation/Effect work pending');

    backend.destroy();
    renderTexture.destroy();
    return Object.freeze({
        scenario: 'hexa-independent-formation-n1-through-hx',
        chain: Object.freeze({
            finalMemberCount: finalPlane.state.memberCount,
            finalOccupiedSlotMask: finalPlane.state.occupiedSlotMask,
            expectedRotationStep: finalGroup.expectedRotationStep,
            finalRotationStep: finalPlane.state.rotationStep,
            expectedGeneration: finalGroup.expectedGeneration,
            finalGeneration: finalPlane.state.generation,
            finalLineageMemberCount: initialLineage.length,
            expectedLineageHash,
            liveLineageHash: finalPlane.state.lineageHash,
            mergeCount,
            integerHealthParity,
            effectRekeyParity: finalExactIdentityPayloadTargetSlotParity,
            finalBounty: resolveBasicHexaFormationStats(6).bountyBudget,
            consumedSourceCount: consumedHandles.size,
            remainingSourceBodies: survivingConsumed.length,
            activeDestinationCount: activeFormation.length,
            reservedSlotCount,
            expectedCurrentHealthCenti: finalGroup.expectedCurrentHealthCenti,
            liveCurrentHealthCenti: finalPlane.healthFixedPoint,
            expectedMaxHealthCenti: finalGroup.expectedMaxHealthCenti,
            liveMaxHealthCenti: finalPlane.maxHealthFixedPoint,
            authoredRadius: finalGroup.radius,
            canonicalRadius: expectedGpuRadius,
            liveRadius: finalPlane.radius,
            canonicalInverseMass: finalStats.inverseMass,
            liveInverseMass: finalPlane.inverseMass,
            canonicalWeight: finalStats.weight,
            liveWeight: Math.fround(1 / finalPlane.inverseMass),
            canonicalFlowSpeed: finalStats.moveSpeedTilesPerSecond,
            liveFlowSpeed: finalPlane.flowSpeed,
            canonicalTowerContactDamage: finalStats.towerContactDamage,
            liveBaseTowerContactDamage:
                finalPlane.resolvedBaseTowerContactDamage,
            activeBoostStackCount: finalPlane.boostStackCount,
            activeAttackMultiplier: finalPlane.attackMultiplier,
            expectedEffectiveTowerContactDamage,
            liveEffectiveTowerContactDamage: finalPlane.towerContactDamage,
            canonicalCoreImpactDamage: finalStats.coreImpactDamage
        }),
        effectTransfer: Object.freeze({
            beforeCount: effectEvidence?.beforeCount ?? 0,
            sourceATargetCount: effectEvidence?.sourceACount ?? 0,
            sourceBTargetCount: effectEvidence?.sourceBCount ?? 0,
            afterCount: effectEvidence?.afterCount ?? 0,
            exactIdentityPayloadParity:
                effectEvidence?.exactIdentityPayloadParity === true,
            preparedEffectRekeyCount:
                effectEvidence?.preparedEffectRekeyCount ?? 0,
            actualEffectRekeyCount:
                effectEvidence?.actualEffectRekeyCount ?? 0,
            preparedEffectRekeyTotal,
            actualEffectRekeyTotal,
            finalDestinationEffectCount: finalTargetEffects.length,
            finalExactIdentityPayloadTargetSlotParity
        }),
        presentation: Object.freeze({
            occupiedCellsVisible: occupiedPixels > 100,
            occupiedPixelCount: occupiedPixels,
            occupiedCellSampleCount,
            memberLinkSampleCount,
            goldenCellSampleCount,
            hxHealthBarChangedPixels: hxHealthBarChangedPixels > 0,
            hxHealthBarPixelDelta: hxHealthBarChangedPixels,
            hxHealthBarRoiPixelDelta
        }),
        terminal: Object.freeze({
            state: formationStatus.terminal.state,
            finalFixedTick,
            submittedTick: formationStatus.terminal.submittedTick,
            prepareProgramCount:
                formationStatus.terminal.prepareProgramCount,
            terminalArmedTransformCount:
                formationStatus.terminal.armedTransformCount,
            pendingPrepareProgramCount:
                formationStatus.pendingPrepareProgramCount,
            pendingPrepareReadbackCount:
                formationStatus.pendingPrepareReadbackCount,
            armedTransformCount: formationStatus.armedTransformCount,
            pendingTransformReadbackCount:
                formationStatus.pendingTransformReadbackCount,
            effectPulseProgramCount:
                effectStatus.terminal.pulseProgramCount,
            pendingEffectProgramCount: effectStatus.pendingPulseProgramCount,
            pendingEffectReadbackCount: effectStatus.pendingEffectReadbackCount
        }),
        replacementReset: Object.freeze({
            activeHxCountBefore: replacementActiveHxBefore,
            activeFormationCountBefore: activeFormation.length,
            activeEffectCountBefore: replacementActiveEffectCountBefore,
            effectActivePoolIndexBefore:
                replacementEffectPoolsBefore.activePoolIndex,
            authoritativeEffectPoolActiveCountBefore:
                replacementEffectPoolsBefore.authoritativeActiveCount,
            effectPoolInputCountBefore:
                replacementEffectPoolsBefore.inputCount,
            effectPoolAActiveCountBefore: replacementEffectPoolsBefore.poolA,
            effectPoolBActiveCountBefore: replacementEffectPoolsBefore.poolB,
            formationIngressOpenBefore:
                replacementFormationStatusBefore.ingressOpen,
            effectIngressOpenBefore: replacementEffectStatusBefore.ingressOpen,
            presentationFlagsBefore: finalPlane.state.presentationFlags,
            presentationMergePulseFlagBefore:
                replacementPresentationMergePulseBefore,
            authoritativeEpochBefore: replacementEpochBefore,
            authoritativeEpochAfter:
                replacementFormationStatus.authoritativeEpoch,
            activeBodyCountAfter: replacementActiveBodyCountAfter,
            gpuResourcesReleased: replacementResourcesReleased,
            pendingPrepareProgramCountAfter:
                replacementFormationStatus.pendingPrepareProgramCount,
            pendingPrepareReadbackCountAfter:
                replacementFormationStatus.pendingPrepareReadbackCount,
            armedTransformCountAfter:
                replacementFormationStatus.armedTransformCount,
            pendingTransformReadbackCountAfter:
                replacementFormationStatus.pendingTransformReadbackCount,
            pendingEffectProgramCountAfter:
                replacementEffectStatus.pendingPulseProgramCount,
            pendingEffectReadbackCountAfter:
                replacementEffectStatus.pendingEffectReadbackCount,
            respawnAuthoritativeEpoch:
                replacementRespawnFormationStatus.authoritativeEpoch,
            respawnGpuResourcesPresent: replacementRespawnResourcesPresent,
            respawnActiveFormationCount: replacementRespawnActive.length,
            respawnActiveHxCount: replacementRespawnActiveHxCount,
            respawnOldHandleCount: replacementRespawnOldHandleCount,
            respawnPresentationCount: replacementRespawnPresentationCount,
            respawnEffectActivePoolIndex:
                replacementRespawnEffectPools.activePoolIndex,
            respawnAuthoritativeEffectPoolActiveCount:
                replacementRespawnEffectPools.authoritativeActiveCount,
            respawnEffectPoolInputCount:
                replacementRespawnEffectPools.inputCount,
            respawnEffectPoolAActiveCount:
                replacementRespawnEffectPools.poolA,
            respawnEffectPoolBActiveCount:
                replacementRespawnEffectPools.poolB,
            respawnFormationIngressOpen:
                replacementRespawnFormationStatus.ingressOpen,
            respawnEffectIngressOpen:
                replacementRespawnEffectStatus.ingressOpen,
            respawnMemberCount: replacementRespawnActive[0].state.memberCount,
            respawnGeneration: replacementRespawnActive[0].state.generation,
            respawnExpectedLineageHash:
                createFormationLineageHash([replacementRespawnHandle]),
            respawnLiveLineageHash:
                replacementRespawnActive[0].state.lineageHash,
            respawnPendingPrepareProgramCount:
                replacementRespawnFormationStatus.pendingPrepareProgramCount,
            respawnPendingPrepareReadbackCount:
                replacementRespawnFormationStatus.pendingPrepareReadbackCount,
            respawnArmedTransformCount:
                replacementRespawnFormationStatus.armedTransformCount,
            respawnPendingTransformReadbackCount:
                replacementRespawnFormationStatus.pendingTransformReadbackCount,
            respawnPendingEffectProgramCount:
                replacementRespawnEffectStatus.pendingPulseProgramCount,
            respawnPendingEffectReadbackCount:
                replacementRespawnEffectStatus.pendingEffectReadbackCount
        }),
        storageProfile,
        transformCompletionCount: transformCompletions.length
    });
}

async function runReservationPresentationFixture(device, format) {
    const width = 128;
    const height = 96;
    const texture = device.createTexture({
        label: 'cirvivor-nw-hexa-reservation-target',
        size: { width, height },
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    const target = Object.freeze({
        device,
        texture,
        view: texture.createView(),
        format,
        deviceGeneration: 1,
        width,
        height
    });
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format, target)
    }, {
        capacity: 2,
        formationCommandCapacity: 2,
        formationTransformCapacity: 1,
        sessionGeneration: 72
    });
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    backend.init(tileMap);
    const reservationWorldCenter = tileMap.tileToWorld(7, 1, {});
    const mergeCommitDistance =
        HEXA_HIVE_SIX_RING_FORMATION_DEFINITION.mergeCommitDistanceTiles;
    const reservationSeparation = mergeCommitDistance + 0.1;
    const reservationHalfSeparation = reservationSeparation * 0.5;
    const reservationPositions = Object.freeze([
        Object.freeze({
            x: reservationWorldCenter.x - reservationHalfSeparation,
            y: reservationWorldCenter.y
        }),
        Object.freeze({
            x: reservationWorldCenter.x + reservationHalfSeparation,
            y: reservationWorldCenter.y
        })
    ]);
    const reservationFieldIndex = backend.flowRouteByPathId.get(route.pathId)
        ?.firstFieldIndex;
    const reservationAtlas = backend.flowFieldAtlas;
    const reservationTiles = reservationPositions.map((position) => {
        const tile = tileMap.worldToTile(position.x, position.y, {});
        assert(tileMap.isWalkableTile(tile.row, tile.column),
            'Hexa reservation position must be walkable');
        return Object.freeze({ row: tile.row, column: tile.column });
    });
    const reservationCosts = reservationTiles.map((tile) => (
        reservationAtlas.integrationCosts[
            (reservationFieldIndex * reservationAtlas.size)
                + (tile.row * reservationAtlas.cols)
                + tile.column
        ]
    ));
    assert(Number.isSafeInteger(reservationFieldIndex)
        && reservationTiles[0].row === reservationTiles[1].row
        && reservationTiles[0].column === reservationTiles[1].column
        && reservationCosts[0] === reservationCosts[1]
        && reservationSeparation > mergeCommitDistance
        && reservationSeparation
            < HEXA_HIVE_SIX_RING_FORMATION_DEFINITION.mergeSeekRadiusTiles,
    'Hexa reservation pair must share one exact pre-commit contour');
    const left = createNaturalHexa(
        route,
        0,
        { entityId: 701, incarnation: 1 },
        reservationPositions[0]
    );
    const right = createNaturalHexa(
        route,
        1,
        { entityId: 702, incarnation: 1 },
        reservationPositions[1]
    );
    assert(backend.replaceBodies([left, right]).accepted === 2,
        'Hexa reservation replacement failed');
    const center = Object.freeze({ x: 42, y: 48 });
    const scale = 20;
    const camera = Object.freeze({
        worldToViewport(x, y, out) {
            out.x = center.x + ((x - reservationWorldCenter.x) * scale);
            out.y = center.y + ((y - reservationWorldCenter.y) * scale);
            return out;
        },
        getScale: () => scale
    });
    const before = await renderBackend(backend, device, texture, camera, 1);
    assert(backend.fixedUpdate(FIXED_DELTA, 1),
        'Hexa reservation motion submit failed');
    await device.queue.onSubmittedWorkDone();
    const states = await readFormationPlanes(backend, device, 2);
    const reserved = states.filter(({ state }) => (
        (state.presentationFlags
            & GPU_FORMATION_BODY_STATE_FLAG.PRESENTATION_RESERVATION) !== 0
    ));
    if (reserved.length === 0) {
        const diagnostics = await readFormationMotionDiagnostics(
            backend,
            device,
            2
        );
        const flow = states.map((entry) => {
            const tile = tileMap.worldToTile(
                entry.position.x,
                entry.position.y,
                {}
            );
            const fieldOffset = (entry.flowFieldIndex * reservationAtlas.size)
                + (tile.row * reservationAtlas.cols)
                + tile.column;
            return Object.freeze({
                slot: entry.slot,
                entityId: entry.state.entityId,
                incarnation: entry.state.incarnation,
                tile: Object.freeze({ row: tile.row, column: tile.column }),
                flowFieldIndex: entry.flowFieldIndex,
                integrationCost:
                    reservationAtlas.integrationCosts[fieldOffset],
                direction: Object.freeze({
                    x: reservationAtlas.directions[fieldOffset * 2],
                    y: reservationAtlas.directions[(fieldOffset * 2) + 1]
                })
            });
        });
        assert(false, 'Hexa reservation flag was not materialized: '
            + JSON.stringify({
                expected: Object.freeze({
                    positions: reservationPositions,
                    tiles: reservationTiles,
                    integrationCosts: reservationCosts,
                    separation: reservationSeparation,
                    mergeCommitDistance
                }),
                planes: states,
                flow,
                diagnostics,
                formationStatus: backend.getFormationRuntimeStatus()
            }));
    }
    const after = await renderBackend(backend, device, texture, camera, 2);
    const changed = countChangedPixels(before, after);
    const reservationCenter = Object.freeze({
        x: center.x + ((reserved[0].position.x
            - reservationWorldCenter.x) * scale),
        y: center.y + ((reserved[0].position.y
            - reservationWorldCenter.y) * scale)
    });
    const reservationHalfSize = Object.freeze({
        x: Math.ceil(left.radius * scale),
        y: Math.ceil(left.radius * scale)
    });
    const isReservationCyan = (pixel) => pixel.a > 0
        && (pixel.b * 255) >= (190 * pixel.a)
        && (pixel.g * 255) >= (180 * pixel.a)
        && (pixel.r * 255) <= (180 * pixel.a);
    const reservationCyanPixelsBefore = countPixelsInRoi(
        before,
        reservationCenter,
        reservationHalfSize,
        format,
        isReservationCyan
    );
    const reservationCyanPixelsAfter = countPixelsInRoi(
        after,
        reservationCenter,
        reservationHalfSize,
        format,
        isReservationCyan
    );
    const reservationRoiChangedPixels = countChangedPixelsInRoi(
        before,
        after,
        reservationCenter,
        reservationHalfSize
    );
    if (changed <= 0
        || reservationCyanPixelsAfter <= reservationCyanPixelsBefore) {
        const temporaryBytes = await readGpuBufferBytes(
            device,
            backend.simulation.buffers.temporaries,
            2 * GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE,
            'cirvivor-nw-hexa-reservation-temporary'
        );
        const temporaryView = new DataView(temporaryBytes);
        const projectPosition = (position) => {
            const projected = {};
            camera.worldToViewport(position.x, position.y, projected);
            return Object.freeze({ x: projected.x, y: projected.y });
        };
        const presentationPoses = reserved.map((entry) => {
            const offset = entry.slot * GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE;
            const previous = Object.freeze({
                x: temporaryView.getFloat32(
                    offset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_X,
                    true
                ),
                y: temporaryView.getFloat32(
                    offset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_Y,
                    true
                )
            });
            const predicted = Object.freeze({
                x: temporaryView.getFloat32(
                    offset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREDICTED_X,
                    true
                ),
                y: temporaryView.getFloat32(
                    offset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREDICTED_Y,
                    true
                )
            });
            const delta = Object.freeze({
                x: temporaryView.getFloat32(
                    offset + GPU_CIRCLE_BODY_ABI.TEMPORARY.DELTA_X,
                    true
                ),
                y: temporaryView.getFloat32(
                    offset + GPU_CIRCLE_BODY_ABI.TEMPORARY.DELTA_Y,
                    true
                )
            });
            return Object.freeze({
                slot: entry.slot,
                handle: Object.freeze({
                    entityId: entry.state.entityId,
                    incarnation: entry.state.incarnation
                }),
                velocity: entry.velocity,
                current: entry.position,
                previous,
                predicted,
                delta,
                projected: Object.freeze({
                    current: projectPosition(entry.position),
                    previous: projectPosition(previous),
                    predicted: projectPosition(predicted)
                })
            });
        });
        const reservationTargetColor = Object.freeze({
            r: Math.round(0.25 * 255),
            g: Math.round(0.95 * 255),
            b: 255
        });
        const diagnostic = Object.freeze({
            center: reservationCenter,
            halfSize: reservationHalfSize,
            presentationPoses: Object.freeze(presentationPoses),
            changedPixelCount: changed,
            roiChangedPixelCount: reservationRoiChangedPixels,
            cyanPixelCountBefore: reservationCyanPixelsBefore,
            cyanPixelCountAfter: reservationCyanPixelsAfter,
            cyanPredicate: Object.freeze({
                alphaPositive: true,
                alphaAwareUnpremultiply: true,
                minimumBlue: 190,
                minimumGreen: 180,
                maximumRed: 180
            }),
            reservationTargetColor,
            beforeColors: summarizeRoiColors(
                before,
                reservationCenter,
                reservationHalfSize,
                format,
                reservationTargetColor
            ),
            afterColors: summarizeRoiColors(
                after,
                reservationCenter,
                reservationHalfSize,
                format,
                reservationTargetColor
            )
        });
        assert(changed > 0,
            `Hexa reservation did not change rendered pixels: ${
                JSON.stringify(diagnostic)
            }`);
        assert(reservationCyanPixelsAfter > reservationCyanPixelsBefore,
            `Hexa reservation cyan bounded ROI evidence missing: ${
                JSON.stringify(diagnostic)
            }`);
    }
    backend.destroy();
    texture.destroy();
    return Object.freeze({
        reservationChangedPixels: true,
        reservationPixelDelta: changed,
        reservationBodyCount: reserved.length,
        reservationRoiPixelDelta: reservationRoiChangedPixels,
        reservationCyanPixelsBefore,
        reservationCyanPixelsAfter,
        reservationCyanPixelDelta:
            reservationCyanPixelsAfter - reservationCyanPixelsBefore
    });
}

async function runAtomicRejectFixture(device, format) {
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: 3,
        effectCommandCapacity: 1,
        effectInstanceCapacity: 4,
        effectCandidateCapacity: 3,
        effectEventCapacity: 4,
        formationCommandCapacity: 2,
        formationTransformCapacity: 1,
        sessionGeneration: 73
    });
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    backend.init(tileMap);
    const pairCenter = tileMap.tileToWorld(7, 1, {});
    const pairHalfSeparation = 0.325;
    const pairPositions = Object.freeze([-1, 1].map((direction) => (
        Object.freeze({
            x: pairCenter.x + (direction * pairHalfSeparation),
            y: pairCenter.y
        })
    )));
    const firstFieldIndex = backend.flowRouteByPathId.get(route.pathId)
        ?.firstFieldIndex;
    const atlas = backend.flowFieldAtlas;
    const pairTiles = pairPositions.map((position) => {
        const tile = tileMap.worldToTile(position.x, position.y, {});
        assert(tileMap.isWalkableTile(tile.row, tile.column),
            'Hexa atomic reject pair must be walkable');
        return Object.freeze({ row: tile.row, column: tile.column });
    });
    const pairCosts = pairTiles.map((tile) => atlas.integrationCosts[
        (firstFieldIndex * atlas.size)
            + (tile.row * atlas.cols)
            + tile.column
    ]);
    const pairDistance = pairHalfSeparation * 2;
    const mergeCommitDistance =
        HEXA_HIVE_SIX_RING_FORMATION_DEFINITION.mergeCommitDistanceTiles;
    const solverMinimumDistance = mergeCommitDistance
        * MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE;
    assert(Number.isSafeInteger(firstFieldIndex)
        && pairTiles[0].row === pairTiles[1].row
        && pairTiles[0].column === pairTiles[1].column
        && pairCosts[0] === pairCosts[1]
        && pairDistance > solverMinimumDistance
        && pairDistance < mergeCommitDistance,
    'Hexa atomic reject pair contour/distance invariant failed');
    const bodies = pairPositions.map((position, index) => createNaturalHexa(
        route,
        index,
        { entityId: 731 + index, incarnation: 1 },
        position
    ));
    const pentaPosition = Object.freeze(tileMap.tileToWorld(10, 1, {}));
    const pentaDistances = pairPositions.map((position) => Math.hypot(
        position.x - pentaPosition.x,
        position.y - pentaPosition.y
    ));
    const pentaTile = tileMap.worldToTile(
        pentaPosition.x,
        pentaPosition.y,
        {}
    );
    assert(tileMap.isWalkableTile(pentaTile.row, pentaTile.column)
        && Math.min(...pentaDistances) > mergeCommitDistance
        && Math.max(...pentaDistances)
            <= PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.pulseRadiusTiles,
    'Hexa atomic reject Penta placement invariant failed');
    const penta = createPenta(
        route,
        2,
        { entityId: 739, incarnation: 1 },
        pentaPosition
    );
    assert(backend.replaceBodies([...bodies, penta]).accepted === 3,
        'Hexa atomic reject replacement failed');
    const protocol = backend.getEventProtocolState();
    assert(backend.stageFormationPrepareBatch({
        abiVersion: GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x730001,
        targetFixedTick: 1,
        records: bodies.map((body, index) => ({
            sourceEntityId: body.entityId,
            sourceIncarnation: body.incarnation,
            prepareSequence: index,
            fingerprint: 0x730100 + index,
            flags: 0
        }))
    }).accepted, 'Hexa atomic reject prepare stage failed');
    assert(backend.stageEffectPulseProgramBatch({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x730050,
        sourceTick: 1,
        records: [createPulseRecord(penta, 1)]
    }).accepted, 'Hexa atomic reject Effect stage failed');
    assert(backend.fixedUpdate(FIXED_DELTA, 1),
        'Hexa atomic reject prepare submit failed');
    const prepare = await waitForFormationPrepare(backend, device);
    const effectCompletion = await waitForEffectCompletion(backend, device);
    assert(effectCompletion.appliedInstanceCount === 2,
        'Hexa atomic reject Effect materialization failed');
    if (prepare.pairCount !== 1) {
        const [planes, diagnostics] = await Promise.all([
            readFormationPlanes(backend, device, 3),
            readFormationMotionDiagnostics(backend, device, 3)
        ]);
        assert(false, 'Hexa atomic reject pair missing: '
            + JSON.stringify({
                expected: Object.freeze({
                    pairPositions,
                    pairTiles,
                    pairCosts,
                    pairDistance,
                    solverMinimumDistance,
                    mergeCommitDistance,
                    pentaPosition,
                    pentaDistances
                }),
                prepare,
                planes,
                diagnostics,
                formationStatus: backend.getFormationRuntimeStatus()
            }));
    }
    const groups = new Map(bodies.map((body) => [
        handleKey(body),
        { handle: body, radius: body.radius, lineage: [body] }
    ]));
    const record = publicTransformRecord(buildTransformRecords(
        prepare,
        groups,
        2
    )[0]);
    const before = await readFormationPlanes(backend, device, 3);
    const effectsBefore = await readActiveEffectInstances(backend, device, 4);
    assert(effectsBefore.length === 2,
        'Hexa atomic reject requires nonzero active Effects');
    const reservedSlotCountBefore = before.filter(({ state }) => (
        (state.presentationFlags
            & GPU_FORMATION_BODY_STATE_FLAG.PRESENTATION_RESERVATION) !== 0
    )).length;
    const sourceCountBefore = before.filter(({ state }) => (
        bodies.some((body) => body.entityId === state.entityId
            && body.incarnation === state.incarnation)
    )).length;
    const bountyBefore = bodies.reduce((sum, body) => (
        sum + body.bountyBudget
    ), 0);
    const arm = backend.armPreparedFormationTransformBatch({
        abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x730002,
        prepareBatchIdFingerprint: 0x730001,
        preparedSourceTick: 1,
        targetFixedTick: 2,
        prepareProtocol: protocol,
        records: [record, { ...record, fingerprint: record.fingerprint + 1 }]
    });
    assert(arm.accepted === false
        && arm.reason === 'formation-transform-capacity'
        && arm.armedCount === 0,
    `Hexa transform capacity rejection mismatch: ${arm.reason}`);
    const after = await readFormationPlanes(backend, device, 3);
    const effectsAfter = await readActiveEffectInstances(backend, device, 4);
    const unchanged = before.every((entry, index) => (
        JSON.stringify(entry.state) === JSON.stringify(after[index].state)
            && entry.healthFixedPoint === after[index].healthFixedPoint
    ));
    const effectUnchanged = JSON.stringify(effectsBefore)
        === JSON.stringify(effectsAfter);
    const reservedSlotCountAfter = after.filter(({ state }) => (
        (state.presentationFlags
            & GPU_FORMATION_BODY_STATE_FLAG.PRESENTATION_RESERVATION) !== 0
    )).length;
    const sourceCountAfter = after.filter(({ state }) => (
        bodies.some((body) => body.entityId === state.entityId
            && body.incarnation === state.incarnation)
    )).length;
    const bountyAfter = bodies.reduce((sum, body) => (
        sum + body.bountyBudget
    ), 0);
    const zeroPartial = unchanged && effectUnchanged
        && reservedSlotCountBefore === reservedSlotCountAfter
        && sourceCountBefore === sourceCountAfter
        && bountyBefore === bountyAfter
        && backend.getFormationRuntimeStatus().armedTransformCount === 0;
    assert(zeroPartial,
        'Hexa capacity reject partially mutated sources');
    backend.destroy();
    return Object.freeze({
        zeroPartial,
        sourceCountBefore,
        sourceCountAfter,
        activeEffectCountBefore: effectsBefore.length,
        activeEffectCountAfter: effectsAfter.length,
        effectInstanceIdentityPreserved: effectUnchanged,
        bountyBefore,
        bountyAfter,
        presentationReservationCountBefore: reservedSlotCountBefore,
        presentationReservationCountAfter: reservedSlotCountAfter,
        noPartialSourceEffectBountySlot: unchanged && effectUnchanged
    });
}

function snapshotMapRecords(source) {
    return [...source.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => Object.freeze({ key, value }));
}

function snapshotRegistryViews(registry, groups) {
    return groups
        .map(({ handle }) => registry.copyEntityView(handle, {}))
        .filter(Boolean)
        .sort(compareHandles)
        .map((view) => Object.freeze({
            entityId: view.entityId,
            incarnation: view.incarnation,
            definitionId: view.definitionId,
            memberCount: view.metadata.formationMemberCount,
            generation: view.metadata.formationGeneration,
            lineageHash: view.metadata.formationLineageHash,
            bountyBudget: view.metadata.bountyBudget
        }));
}

function sumRegistryBounty(registry, groups) {
    return groups.reduce((sum, { handle }) => {
        const view = registry.copyEntityView(handle, {});
        assert(view, `Host atomic bounty source missing: ${handleKey(handle)}`);
        return sum + view.metadata.bountyBudget;
    }, 0);
}

/**
 * 실제 WorldRegistry + EnemyLifecycleCommandOwner privileged transaction을
 * 사용해 CPU registry/bounty/allocator 원자성을 별도로 증명합니다. GPU Effect
 * rekey는 primary fixture가 실제 buffer identity로 검증하고, 여기의 bounded
 * effect ledger는 lifecycle commit 호출 전후 transaction ownership만 검증합니다.
 */
function runHostAtomicLifecycleFixture() {
    const registryAuthority = Object.freeze({});
    const registry = new WorldRegistry({
        capacity: BASIC_HEXA_MAXIMUM_MEMBER_COUNT,
        atomicTransformAuthority: registryAuthority
    });
    const issuedPermits = new WeakSet();
    const atomicTransformAuthority = Object.freeze({
        consumePermit(permit) {
            if (!issuedPermits.has(permit)) {
                return false;
            }
            issuedPermits.delete(permit);
            return true;
        }
    });
    const issuePermit = () => {
        const permit = Object.freeze({});
        issuedPermits.add(permit);
        return permit;
    };
    const bodyKeys = new Set();
    const slotByHandle = new Map();
    const freeSlots = new Set();
    const effectLedger = new Map();
    const initialEffectIdentities = [];
    const transactionCommits = [];
    const armedReceipts = new WeakMap();
    let rejectNextArm = true;
    let receiptSequence = 1;
    const backend = Object.freeze({
        spawnBodies() { return Object.freeze({ accepted: 0 }); },
        despawnBodies() { return Object.freeze({ removed: 0 }); },
        hasBody(handle) { return bodyKeys.has(handleKey(handle)); },
        requiresRecovery() { return false; },
        getRuntimeState() { return 'ready'; }
    });
    const transactionPort = Object.freeze({
        armPreparedFormationTransformBatch(batch) {
            if (rejectNextArm) {
                rejectNextArm = false;
                return Object.freeze({
                    accepted: false,
                    requiresRecovery: false,
                    reason: 'fixture-host-arm-capacity'
                });
            }
            const receipt = Object.freeze({ receiptSequence: receiptSequence++ });
            armedReceipts.set(receipt, batch);
            return Object.freeze({
                accepted: true,
                receipt,
                requiresRecovery: false
            });
        },
        commitArmedFormationTransformBatch(receipt) {
            const batch = armedReceipts.get(receipt);
            if (!batch) {
                return Object.freeze({
                    accepted: false,
                    requiresRecovery: true,
                    reason: 'fixture-host-receipt-stale'
                });
            }
            armedReceipts.delete(receipt);
            for (const record of batch.records) {
                const [root, other] = record.sourceHandles;
                const rootKey = handleKey(root);
                const otherKey = handleKey(other);
                const destinationKey = handleKey(record.destinationHandle);
                const rootSlot = slotByHandle.get(rootKey);
                const otherSlot = slotByHandle.get(otherKey);
                assert(Number.isInteger(rootSlot) && Number.isInteger(otherSlot),
                    'Host atomic allocator source slot missing');
                assert(rootSlot !== otherSlot,
                    'Host atomic allocator source slots alias');
                const sourceEffects = [
                    ...(effectLedger.get(rootKey) ?? []),
                    ...(effectLedger.get(otherKey) ?? [])
                ];
                assert(sourceEffects.length > 0,
                    'Host atomic transaction lost source Effect evidence');
                bodyKeys.delete(rootKey);
                bodyKeys.delete(otherKey);
                bodyKeys.add(destinationKey);
                slotByHandle.delete(rootKey);
                slotByHandle.delete(otherKey);
                slotByHandle.set(destinationKey, rootSlot);
                freeSlots.add(otherSlot);
                effectLedger.delete(rootKey);
                effectLedger.delete(otherKey);
                effectLedger.set(destinationKey, Object.freeze(
                    sourceEffects.map((effect) => Object.freeze({
                        ...effect,
                        targetEntityId: record.destinationHandle.entityId,
                        targetIncarnation: record.destinationHandle.incarnation,
                        targetSlot: rootSlot
                    }))
                ));
                transactionCommits.push(Object.freeze({
                    root,
                    other,
                    destination: record.destinationHandle,
                    rootSlot,
                    otherSlot,
                    destinationSlot: slotByHandle.get(destinationKey),
                    rekeyedEffectCount: sourceEffects.length,
                    destinationCurrentHealthCenti:
                        record.destinationIntent.healthFixedPoint,
                    destinationMaxHealthCenti:
                        record.destinationIntent.maxHealthFixedPoint,
                    destinationRadius: record.destinationIntent.radius,
                    destinationInverseMass:
                        record.destinationIntent.inverseMass,
                    destinationFlowSpeed: record.destinationIntent.flowSpeed,
                    destinationTowerContactDamage:
                        record.destinationIntent.towerContactDamage,
                    destinationCoreImpactDamage:
                        record.destinationIntent.coreImpactDamage,
                    destinationBountyBudget:
                        record.destinationIntent.bountyBudget,
                    destinationWeight: record.destinationIntent.weight,
                    destinationLineageHash:
                        record.destinationIntent.formationLineageHash,
                    destinationGeneration:
                        record.destinationIntent.formationGeneration,
                    destinationRotationStep:
                        record.destinationIntent.formationRotationStep
                }));
            }
            return Object.freeze({
                accepted: true,
                committedCount: batch.records.length,
                requiresRecovery: false
            });
        },
        cancelArmedFormationTransformBatch(receipt) {
            const cancelled = armedReceipts.delete(receipt);
            return Object.freeze({
                accepted: cancelled,
                cancelledCount: cancelled ? 1 : 0,
                requiresRecovery: false
            });
        }
    });
    const owner = new EnemyLifecycleCommandOwner(backend, registry, {
        atomicTransformAuthority,
        atomicTransformRegistryAuthority: registryAuthority,
        atomicTransformTransactionPort: transactionPort
    });
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const seed = createGpuEnemySpawnIntent({
        definition: BASIC_HEXA_ENEMY_DATA,
        route,
        spawnSequence: 0
    });
    const groups = [];
    for (let index = 0; index < BASIC_HEXA_MAXIMUM_MEMBER_COUNT; index++) {
        const handle = registry.reserveEntity({
            kindId: 'enemy',
            definitionId: BASIC_HEXA_ENEMY_DATA.id,
            createdAtTick: 1
        });
        assert(handle, 'Host atomic natural H reservation failed');
        const activation = createNaturalHexa(
            route,
            index,
            handle,
            { x: seed.position.x + (index * 0.3), y: seed.position.y }
        );
        assert(registry.activateReserved(
            handle,
            createGpuRegistryMetadata(activation)
        ), 'Host atomic natural H activation failed');
        const key = handleKey(handle);
        bodyKeys.add(key);
        slotByHandle.set(key, index);
        const effect = Object.freeze({
            effectInstanceId: 0x790100 + index,
            instanceIncarnation: 1,
            effectDefinitionCode:
                PENTA_BOOST_EFFECT_DEFINITION.effectDefinitionCode,
            sourceEntityId: 0x790001,
            sourceIncarnation: 1,
            appliedAtFixedTick: 1,
            expiresAtFixedTick: 180,
            magnitude: PENTA_BOOST_EFFECT_DEFINITION.attackMultiplier,
            payload: PENTA_BOOST_EFFECT_DEFINITION.healthDeltaFixedPerTick,
            flags: GPU_EFFECT_INSTANCE_FLAG.ACTIVE,
            targetEntityId: handle.entityId,
            targetIncarnation: handle.incarnation,
            targetSlot: index
        });
        effectLedger.set(key, Object.freeze([effect]));
        initialEffectIdentities.push(effect);
        const currentHealthCenti = encodeGpuCircleBodyFixedPoint(
            activation.health
        );
        const maxHealthCenti = currentHealthCenti;
        assert(currentHealthCenti > 0
            && maxHealthCenti > 0
            && currentHealthCenti <= maxHealthCenti,
        'Host atomic natural H centi-HP authority mismatch');
        groups.push(Object.freeze({
            handle,
            lineage: Object.freeze([handle]),
            currentHealthCenti,
            maxHealthCenti
        }));
    }
    assert(registry.getStatus().activeCount === 6
        && registry.getStatus().reservedCount === 0,
    'Host atomic natural roster cardinality mismatch');

    const descriptorFor = (sourceA, sourceB) => {
        const ordered = [sourceA, sourceB]
            .sort((left, right) => compareHandles(left.handle, right.handle));
        const views = ordered.map(({ handle }) => (
            registry.copyEntityView(handle, {})
        ));
        assert(views.every(Boolean), 'Host atomic descriptor source missing');
        const health = mergeBasicHexaHealthCenti({
            sourceACurrentHealthCenti: ordered[0].currentHealthCenti,
            sourceAMaxHealthCenti: ordered[0].maxHealthCenti,
            sourceBCurrentHealthCenti: ordered[1].currentHealthCenti,
            sourceBMaxHealthCenti: ordered[1].maxHealthCenti
        });
        const lineage = ordered
            .flatMap((group) => group.lineage)
            .sort(compareHandles);
        const memberCount = lineage.length;
        return Object.freeze({
            ordered: Object.freeze(ordered),
            lineage: Object.freeze(lineage),
            descriptor: Object.freeze({
                memberCount,
                currentHealthCenti: health.currentHealthCenti,
                maxHealthCenti: health.maxHealthCenti,
                formationOccupiedSlotMask: (1 << memberCount) - 1,
                formationRotationStep: 0,
                formationGeneration: Math.max(
                    views[0].metadata.formationGeneration,
                    views[1].metadata.formationGeneration
                ) + 1,
                formationLineageHash: createFormationLineageHash(lineage)
            })
        });
    };
    const createAtomicRequest = (sourceA, sourceB, prepareSourceTick) => {
        const facts = descriptorFor(sourceA, sourceB);
        return Object.freeze({
            facts,
            request: Object.freeze({
                prepareSourceTick,
                batchIdFingerprint: (0x790000 + prepareSourceTick) >>> 0,
                records: Object.freeze([Object.freeze({
                    sourceHandles: Object.freeze(
                        facts.ordered.map(({ handle }) => handle)
                    ),
                    sourceLineages: Object.freeze(
                        facts.ordered.map(({ lineage }) => lineage)
                    ),
                    destinationDescriptor: facts.descriptor,
                    disposition: facts.descriptor.memberCount === 6
                        ? ENEMY_LIFECYCLE_DISPOSITION_ID.TRANSFORM_CONSUMED
                        : ENEMY_LIFECYCLE_DISPOSITION_ID.MERGE_CONSUMED
                })])
            })
        });
    };

    const rejectionFacts = createAtomicRequest(groups[0], groups[1], 1);
    const rejectedViewsBefore = snapshotRegistryViews(registry, groups);
    const rejectedSlotsBefore = snapshotMapRecords(slotByHandle);
    const rejectedEffectsBefore = snapshotMapRecords(effectLedger);
    const rejectedBountyBefore = sumRegistryBounty(registry, groups);
    const rejectedStatusBefore = registry.getStatus();
    const rejectedStage = owner.requestAtomicTransformBatch(
        rejectionFacts.request,
        2,
        'hexa-host-atomic-reject',
        issuePermit()
    );
    assert(rejectedStage.accepted, 'Host atomic reject batch ingress failed');
    const rejectedCommit = owner.commitAtFixedBoundary(2);
    const rejectedViewsAfter = snapshotRegistryViews(registry, groups);
    const rejectedSlotsAfter = snapshotMapRecords(slotByHandle);
    const rejectedEffectsAfter = snapshotMapRecords(effectLedger);
    const rejectedBountyAfter = sumRegistryBounty(registry, groups);
    const rejectedStatusAfter = registry.getStatus();
    const rejectedStateUnchanged = JSON.stringify(rejectedViewsBefore)
            === JSON.stringify(rejectedViewsAfter)
        && JSON.stringify(rejectedSlotsBefore) === JSON.stringify(rejectedSlotsAfter)
        && JSON.stringify(rejectedEffectsBefore)
            === JSON.stringify(rejectedEffectsAfter)
        && rejectedBountyBefore === rejectedBountyAfter
        && rejectedStatusBefore.activeCount === rejectedStatusAfter.activeCount
        && rejectedStatusBefore.reservedCount === rejectedStatusAfter.reservedCount;
    assert(rejectedCommit.state === 'committed-with-rejections'
        && rejectedCommit.recoveryRequired === false
        && rejectedCommit.spawned.length === 0
        && rejectedCommit.despawned.length === 0
        && rejectedCommit.rejected.length === 1,
    'Host atomic arm reject outcome mismatch');
    assert(rejectedStateUnchanged,
    'Host atomic rejected transaction partially mutated registry/backend state');
    const rejectedEffectCountAfter = [...effectLedger.values()]
        .reduce((sum, effects) => sum + effects.length, 0);

    const consumedHandles = new Set();
    let sourceBountyEligibleFalseCount = 0;
    let sourcePayout = 0;
    let acceptedMergeCount = 0;
    const performMerge = (sourceA, sourceB, targetFixedTick) => {
        const facts = createAtomicRequest(
            sourceA,
            sourceB,
            targetFixedTick - 1
        );
        const sourceBountyByKey = new Map(facts.facts.ordered.map(({ handle }) => {
            const view = registry.copyEntityView(handle, {});
            return [handleKey(handle), view.metadata.bountyBudget];
        }));
        const stage = owner.requestAtomicTransformBatch(
            facts.request,
            targetFixedTick,
            `hexa-host-atomic-commit-${targetFixedTick}`,
            issuePermit()
        );
        assert(stage.accepted && stage.transformCount === 1,
            'Host atomic merge ingress failed');
        const commit = owner.commitAtFixedBoundary(targetFixedTick);
        assert(commit.state === 'committed'
            && commit.recoveryRequired === false
            && commit.spawned.length === 1
            && commit.despawned.length === 2
            && commit.rejected.length === 0,
        'Host atomic merge commit failed');
        const destinationHandle = commit.spawned[0].handle;
        const destinationView = registry.copyEntityView(destinationHandle, {});
        const transaction = transactionCommits[transactionCommits.length - 1];
        assert(destinationView
            && destinationView.metadata.formationMemberCount
                === facts.facts.descriptor.memberCount
            && destinationView.metadata.formationOccupiedSlotMask
                === facts.facts.descriptor.formationOccupiedSlotMask
            && destinationView.metadata.formationRotationStep
                === facts.facts.descriptor.formationRotationStep
            && destinationView.metadata.formationGeneration
                === facts.facts.descriptor.formationGeneration
            && destinationView.metadata.formationLineageHash
                === facts.facts.descriptor.formationLineageHash
            && transaction?.destinationCurrentHealthCenti
                === facts.facts.descriptor.currentHealthCenti
            && transaction.destinationMaxHealthCenti
                === facts.facts.descriptor.maxHealthCenti,
        'Host atomic destination registry/transaction evidence mismatch');
        for (const despawn of commit.despawned) {
            consumedHandles.add(handleKey(despawn.handle));
            assert(despawn.bountyEligible === false,
                'Host atomic consumed source became bounty eligible');
            sourceBountyEligibleFalseCount++;
            sourcePayout += despawn.bountyEligible
                ? sourceBountyByKey.get(handleKey(despawn.handle))
                : 0;
        }
        assert(transaction
            && transaction.destination.entityId === destinationHandle.entityId
            && transaction.destination.incarnation === destinationHandle.incarnation
            && transaction.rootSlot === transaction.destinationSlot
            && freeSlots.has(transaction.otherSlot),
        'Host atomic root/other allocator slot evidence mismatch');
        acceptedMergeCount++;
        return Object.freeze({
            handle: destinationHandle,
            lineage: facts.facts.lineage,
            currentHealthCenti:
                facts.facts.descriptor.currentHealthCenti,
            maxHealthCenti: facts.facts.descriptor.maxHealthCenti
        });
    };

    const group01 = performMerge(groups[0], groups[1], 3);
    const group012 = performMerge(group01, groups[2], 4);
    const group34 = performMerge(groups[3], groups[4], 5);
    const group345 = performMerge(group34, groups[5], 6);
    const finalGroup = performMerge(group012, group345, 7);
    const finalView = registry.copyEntityView(finalGroup.handle, {});
    const finalEffects = effectLedger.get(handleKey(finalGroup.handle)) ?? [];
    const initialIdentityById = new Map(initialEffectIdentities.map((effect) => [
        `${effect.effectInstanceId}:${effect.instanceIncarnation}`,
        effect
    ]));
    const finalEffectIdentityParity = finalEffects.every((effect) => {
        const initial = initialIdentityById.get(
            `${effect.effectInstanceId}:${effect.instanceIncarnation}`
        );
        return initial
            && effect.effectDefinitionCode === initial.effectDefinitionCode
            && effect.sourceEntityId === initial.sourceEntityId
            && effect.sourceIncarnation === initial.sourceIncarnation
            && effect.appliedAtFixedTick === initial.appliedAtFixedTick
            && effect.expiresAtFixedTick === initial.expiresAtFixedTick
            && effect.magnitude === initial.magnitude
            && effect.payload === initial.payload
            && effect.flags === initial.flags
            && effect.targetEntityId === finalGroup.handle.entityId
            && effect.targetIncarnation === finalGroup.handle.incarnation
            && effect.targetSlot === slotByHandle.get(handleKey(finalGroup.handle));
    });
    const remainingConsumedSourceCount = [...consumedHandles]
        .filter((key) => bodyKeys.has(key))
        .length;
    const finalTransaction = transactionCommits[transactionCommits.length - 1];
    const hostFinalStats = resolveBasicHexaFormationStats(6);
    const hostExpectedLineageHash = createFormationLineageHash(
        groups.flatMap((group) => group.lineage).sort(compareHandles)
    );
    assert(acceptedMergeCount === 5
        && consumedHandles.size === 10
        && remainingConsumedSourceCount === 0
        && sourceBountyEligibleFalseCount === 10
        && sourcePayout === 0
        && finalView?.metadata.bountyBudget === 10
        && registry.getStatus().activeCount === 1
        && registry.getStatus().reservedCount === 0
        && bodyKeys.size === 1
        && slotByHandle.size === 1
        && freeSlots.size === 5
        && finalEffects.length === 6
        && finalEffectIdentityParity
        && finalView.metadata.formationMemberCount === 6
        && finalView.metadata.formationOccupiedSlotMask === 0x3f
        && finalView.metadata.formationRotationStep === 0
        && finalView.metadata.formationGeneration === 4
        && finalView.metadata.formationLineageHash === hostExpectedLineageHash
        && finalView.metadata.towerContactDamage
            === hostFinalStats.towerContactDamage
        && finalView.metadata.coreImpactDamage === hostFinalStats.coreImpactDamage
        && finalView.metadata.weight === hostFinalStats.weight
        && finalTransaction.destinationCurrentHealthCenti
            === finalGroup.currentHealthCenti
        && finalTransaction.destinationMaxHealthCenti
            === finalGroup.maxHealthCenti
        && finalTransaction.destinationRadius === seed.radius
        && finalTransaction.destinationInverseMass === hostFinalStats.inverseMass
        && finalTransaction.destinationFlowSpeed
            === hostFinalStats.moveSpeedTilesPerSecond
        && finalTransaction.destinationTowerContactDamage
            === hostFinalStats.towerContactDamage
        && finalTransaction.destinationCoreImpactDamage
            === hostFinalStats.coreImpactDamage
        && finalTransaction.destinationBountyBudget === hostFinalStats.bountyBudget
        && finalTransaction.destinationWeight === hostFinalStats.weight,
    'Host atomic full-chain cardinality/bounty/slot/Effect evidence mismatch');
    const finalSlot = slotByHandle.get(handleKey(finalGroup.handle));
    const finalRegistryStatus = registry.getStatus();
    const rootSlotReuseCount = transactionCommits.filter((entry) => (
        entry.rootSlot === entry.destinationSlot
    )).length;
    owner.destroy();
    registry.destroy();
    return Object.freeze({
        rejected: Object.freeze({
            sourceHandleCount: rejectionFacts.facts.ordered.length,
            activeSourceCountBefore: rejectedStatusBefore.activeCount,
            activeSourceCountAfter: rejectedStatusAfter.activeCount,
            reservedSlotCountBefore: rejectedStatusBefore.reservedCount,
            reservedSlotCountAfter: rejectedStatusAfter.reservedCount,
            bountyBudgetBefore: rejectedBountyBefore,
            bountyBudgetAfter: rejectedBountyAfter,
            activeEffectCountBefore: initialEffectIdentities.length,
            activeEffectCountAfter: rejectedEffectCountAfter,
            allocatorSlotCountBefore: rejectedSlotsBefore.length,
            allocatorSlotCountAfter: rejectedSlotsAfter.length,
            spawnedCount: rejectedCommit.spawned.length,
            despawnedCount: rejectedCommit.despawned.length,
            rejectedCount: rejectedCommit.rejected.length,
            exactStateUnchanged: rejectedStateUnchanged
        }),
        committed: Object.freeze({
            mergeCount: acceptedMergeCount,
            consumedSourceCount: consumedHandles.size,
            remainingConsumedSourceCount,
            sourceBountyEligibleFalseCount,
            sourcePayout,
            finalBountyBudget: finalView.metadata.bountyBudget,
            activeDestinationCount: 1,
            finalDefinitionId: finalView.definitionId,
            finalMemberCount: finalView.metadata.formationMemberCount,
            finalOccupiedSlotMask:
                finalView.metadata.formationOccupiedSlotMask,
            finalRotationStep: finalView.metadata.formationRotationStep,
            finalGeneration: finalView.metadata.formationGeneration,
            finalLineageMemberCount: finalGroup.lineage.length,
            expectedLineageHash: hostExpectedLineageHash,
            liveLineageHash: finalView.metadata.formationLineageHash,
            preparedCurrentHealthCenti: finalGroup.currentHealthCenti,
            materializedCurrentHealthCenti:
                finalTransaction.destinationCurrentHealthCenti,
            preparedMaxHealthCenti: finalGroup.maxHealthCenti,
            materializedMaxHealthCenti:
                finalTransaction.destinationMaxHealthCenti,
            canonicalRadius: seed.radius,
            materializedRadius: finalTransaction.destinationRadius,
            canonicalInverseMass: hostFinalStats.inverseMass,
            materializedInverseMass:
                finalTransaction.destinationInverseMass,
            canonicalFlowSpeed: hostFinalStats.moveSpeedTilesPerSecond,
            materializedFlowSpeed: finalTransaction.destinationFlowSpeed,
            canonicalTowerContactDamage: hostFinalStats.towerContactDamage,
            materializedTowerContactDamage:
                finalTransaction.destinationTowerContactDamage,
            canonicalCoreImpactDamage: hostFinalStats.coreImpactDamage,
            materializedCoreImpactDamage:
                finalTransaction.destinationCoreImpactDamage,
            canonicalWeight: hostFinalStats.weight,
            materializedWeight: finalTransaction.destinationWeight,
            reservedSlotCount: finalRegistryStatus.reservedCount,
            activeAllocatorSlotCount: slotByHandle.size,
            freeAllocatorSlotCount: freeSlots.size,
            destinationRootSlot: finalSlot,
            rootSlotEvidenceCount: transactionCommits.length,
            rootSlotReuseCount,
            activeEffectCountBefore: initialEffectIdentities.length,
            activeEffectCountAfter: finalEffects.length,
            exactEffectIdentityPayloadTargetSlotParity:
                finalEffectIdentityParity
        })
    });
}

async function runAbaResetFixture(device, format) {
    const effectInstanceCapacity = 8;
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: 3,
        effectCommandCapacity: 1,
        effectInstanceCapacity,
        effectCandidateCapacity: 4,
        effectEventCapacity: 8,
        formationCommandCapacity: 2,
        formationTransformCapacity: 1,
        sessionGeneration: 74
    });
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    backend.init(tileMap);
    const seed = createGpuEnemySpawnIntent({
        definition: BASIC_HEXA_ENEMY_DATA,
        route,
        spawnSequence: 0
    });
    const pairCenter = tileMap.tileToWorld(7, 1, {});
    const pairHalfSeparation = 0.325;
    const pairPositions = Object.freeze([-1, 1].map((direction) => (
        Object.freeze({
            x: pairCenter.x + (direction * pairHalfSeparation),
            y: pairCenter.y
        })
    )));
    const firstFieldIndex = backend.flowRouteByPathId.get(route.pathId)
        ?.firstFieldIndex;
    const atlas = backend.flowFieldAtlas;
    const pairTiles = pairPositions.map((position) => {
        const tile = tileMap.worldToTile(position.x, position.y, {});
        assert(tileMap.isWalkableTile(tile.row, tile.column),
            'Hexa ABA pair must be walkable');
        return Object.freeze({ row: tile.row, column: tile.column });
    });
    const pairCosts = pairTiles.map((tile) => atlas.integrationCosts[
        (firstFieldIndex * atlas.size)
            + (tile.row * atlas.cols)
            + tile.column
    ]);
    const pairDistance = pairHalfSeparation * 2;
    const mergeCommitDistance =
        HEXA_HIVE_SIX_RING_FORMATION_DEFINITION.mergeCommitDistanceTiles;
    const solverMinimumDistance = mergeCommitDistance
        * MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE;
    assert(Number.isSafeInteger(firstFieldIndex)
        && pairTiles[0].row === pairTiles[1].row
        && pairTiles[0].column === pairTiles[1].column
        && pairCosts[0] === pairCosts[1]
        && pairDistance > solverMinimumDistance
        && pairDistance < mergeCommitDistance,
    'Hexa ABA pair contour/distance invariant failed');
    const oldHandle = Object.freeze({ entityId: 741, incarnation: 1 });
    const oldPeerHandle = Object.freeze({ entityId: 742, incarnation: 1 });
    const oldBody = createNaturalHexa(
        route,
        0,
        oldHandle,
        pairPositions[0]
    );
    const oldPeer = createNaturalHexa(
        route,
        1,
        oldPeerHandle,
        pairPositions[1]
    );
    const pentaPosition = Object.freeze(tileMap.tileToWorld(10, 1, {}));
    const pentaDistances = pairPositions.map((position) => Math.hypot(
        position.x - pentaPosition.x,
        position.y - pentaPosition.y
    ));
    const pentaTile = tileMap.worldToTile(
        pentaPosition.x,
        pentaPosition.y,
        {}
    );
    assert(tileMap.isWalkableTile(pentaTile.row, pentaTile.column)
        && Math.min(...pentaDistances) > mergeCommitDistance
        && Math.max(...pentaDistances)
            <= PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.pulseRadiusTiles,
    'Hexa ABA Penta placement invariant failed');
    const penta = createPenta(
        route,
        2,
        { entityId: 749, incarnation: 1 },
        pentaPosition
    );
    assert(backend.replaceBodies([oldBody, oldPeer, penta]).accepted === 3,
        'Hexa ABA initial replacement failed');
    const prepareProtocol = backend.getEventProtocolState();
    assert(backend.stageFormationPrepareBatch({
        abiVersion: GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x740001,
        targetFixedTick: 1,
        records: createPrepareRecords([
            { handle: oldHandle },
            { handle: oldPeerHandle }
        ], 1)
    }).accepted, 'Hexa ABA prepare stage failed');
    assert(backend.stageEffectPulseProgramBatch({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x740002,
        sourceTick: 1,
        records: [createPulseRecord(penta, 1)]
    }).accepted, 'Hexa ABA Effect stage failed');
    assert(backend.fixedUpdate(FIXED_DELTA, 1),
        'Hexa ABA seed submit failed');
    const prepare = await waitForFormationPrepare(backend, device);
    const effect = await waitForEffectCompletion(backend, device);
    if (prepare.pairCount !== 1 || effect.appliedInstanceCount !== 2) {
        const [planes, diagnostics] = await Promise.all([
            readFormationPlanes(backend, device, 3),
            readFormationMotionDiagnostics(backend, device, 3)
        ]);
        assert(false, 'Hexa ABA pre-reset Formation/Effect evidence missing: '
            + JSON.stringify({
                expected: Object.freeze({
                    pairPositions,
                    pairTiles,
                    pairCosts,
                    pairDistance,
                    solverMinimumDistance,
                    mergeCommitDistance,
                    pentaPosition,
                    pentaDistances
                }),
                prepare,
                effect,
                planes,
                diagnostics,
                formationStatus: backend.getFormationRuntimeStatus(),
                effectStatus: backend.getEffectRuntimeStatus()
            }));
    }
    const record = publicTransformRecord(buildTransformRecords(
        prepare,
        new Map([
            [handleKey(oldHandle), {
                handle: oldHandle,
                radius: oldBody.radius,
                lineage: [oldHandle]
            }],
            [handleKey(oldPeerHandle), {
                handle: oldPeerHandle,
                radius: oldPeer.radius,
                lineage: [oldPeerHandle]
            }]
        ]),
        2
    )[0]);
    const arm = backend.armPreparedFormationTransformBatch({
        abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x740003,
        prepareBatchIdFingerprint: 0x740001,
        preparedSourceTick: 1,
        targetFixedTick: 2,
        prepareProtocol,
        records: [record]
    });
    assert(arm.accepted, 'Hexa ABA transform arm failed');
    const preFormationStatus = backend.getFormationRuntimeStatus();
    const preEffectStatus = backend.getEffectRuntimeStatus();
    const preEffectPools = await readAuthoritativeEffectPoolEvidence(
        backend,
        device,
        effectInstanceCapacity
    );
    const preActiveEffectCount = preEffectPools.authoritativeActiveCount;
    assert(preFormationStatus.armedTransformCount === 1
        && preFormationStatus.pendingTransformReadbackCount === 1
        && preActiveEffectCount === 2
        && preEffectPools.inputCount === 2,
    'Hexa ABA reset precondition is not nonzero');
    const oldEpoch = backend.getFormationRuntimeStatus().authoritativeEpoch;
    assert(backend.replaceBodies([]).accepted === 0, 'Hexa ABA clear failed');
    const clearFormationStatus = backend.getFormationRuntimeStatus();
    const clearEffectStatus = backend.getEffectRuntimeStatus();
    const clearHostFormationStates = Array.from({ length: 3 }, (_, slot) => (
        readGpuFormationBodyState(
            backend.simulation.hostFormationBodyState,
            slot
        )
    ));
    const clearActiveFormationCount = clearHostFormationStates.filter((state) => (
        (state.flags & GPU_FORMATION_BODY_STATE_FLAG.ACTIVE) !== 0
    )).length;
    const clearActiveHxCount = clearHostFormationStates.filter((state) => (
        (state.flags & GPU_FORMATION_BODY_STATE_FLAG.ACTIVE) !== 0
            && state.memberCount === 6
    )).length;
    const clearPresentationCount = clearHostFormationStates.filter((state) => (
        (state.presentationFlags & (
            GPU_FORMATION_BODY_STATE_FLAG.PRESENTATION_RESERVATION
            | GPU_FORMATION_BODY_STATE_FLAG.PRESENTATION_MERGE_PULSE
        )) !== 0
    )).length;
    const clearGpuResourcesReleased = backend.simulation.buffers === null;
    let clearEffectPools = null;
    if (!clearGpuResourcesReleased) {
        clearEffectPools = await readEffectPoolActiveCounts(
            backend,
            device,
            effectInstanceCapacity
        );
    }
    assert(clearFormationStatus.authoritativeEpoch > oldEpoch
        && clearActiveFormationCount === 0
        && clearActiveHxCount === 0
        && clearPresentationCount === 0
        && clearFormationStatus.stagedPrepareProgramCount === 0
        && clearFormationStatus.pendingPrepareProgramCount === 0
        && clearFormationStatus.pendingPrepareReadbackCount === 0
        && clearFormationStatus.armedTransformCount === 0
        && clearFormationStatus.pendingTransformReadbackCount === 0
        && clearEffectStatus.stagedProgramCount === 0
        && clearEffectStatus.pendingPulseProgramCount === 0
        && clearEffectStatus.pendingEffectReadbackCount === 0
        && backend.simulation.activeBodyCount === 0
        && (clearGpuResourcesReleased
            || (clearEffectPools.poolA === 0 && clearEffectPools.poolB === 0)),
    'Hexa replacement clear snapshot retained transient GPU authority');
    const staleCommit = backend.commitArmedFormationTransformBatch(arm.receipt);
    assert(staleCommit.accepted === false,
        'Hexa ABA stale armed receipt survived replacement');
    const newHandle = Object.freeze({ entityId: 741, incarnation: 2 });
    const newBody = createNaturalHexa(route, 1, newHandle, seed.position);
    assert(backend.replaceBodies([newBody]).accepted === 1,
        'Hexa ABA respawn failed');
    const planes = await readFormationPlanes(backend, device, 3);
    const active = planes.filter(({ state }) => (
        (state.flags & GPU_FORMATION_BODY_STATE_FLAG.ACTIVE) !== 0
    ));
    const postFormationStatus = backend.getFormationRuntimeStatus();
    const postEffectStatus = backend.getEffectRuntimeStatus();
    const postEffectPools = await readAuthoritativeEffectPoolEvidence(
        backend,
        device,
        effectInstanceCapacity
    );
    const postActiveEffectCount = postEffectPools.authoritativeActiveCount;
    const newEpoch = postFormationStatus.authoritativeEpoch;
    const presentationMask = GPU_FORMATION_BODY_STATE_FLAG.PRESENTATION_RESERVATION
        | GPU_FORMATION_BODY_STATE_FLAG.PRESENTATION_MERGE_PULSE;
    const passed = active.length === 1
        && active[0].state.entityId === newHandle.entityId
        && active[0].state.incarnation === newHandle.incarnation
        && active[0].state.generation === 1
        && active[0].state.lineageHash
            === createFormationLineageHash([newHandle])
        && (active[0].state.presentationFlags & presentationMask) === 0
        && active[0].boostStackCount === 0
        && active[0].attackMultiplier === 1
        && active.every(({ state }) => state.incarnation !== oldHandle.incarnation)
        && newEpoch > oldEpoch
        && backend.hasBody(oldHandle) === false
        && backend.hasBody(oldPeerHandle) === false
        && backend.hasBody(newHandle) === true
        && postFormationStatus.stagedPrepareProgramCount === 0
        && postFormationStatus.pendingPrepareProgramCount === 0
        && postFormationStatus.pendingPrepareReadbackCount === 0
        && postFormationStatus.armedTransformCount === 0
        && postFormationStatus.pendingTransformReadbackCount === 0
        && postEffectStatus.stagedProgramCount === 0
        && postEffectStatus.pendingPulseProgramCount === 0
        && postEffectStatus.pendingEffectReadbackCount === 0
        && postActiveEffectCount === 0
        && postEffectPools.inputCount === 0
        && postEffectPools.poolA === 0
        && postEffectPools.poolB === 0;
    assert(passed, 'Hexa idle/replacement ABA reset failed');
    backend.destroy();
    return Object.freeze({
        abaReset: passed,
        oldEpoch,
        newEpoch,
        activeIncarnation: active[0].state.incarnation,
        preArmedTransformCount: preFormationStatus.armedTransformCount,
        prePendingTransformReadbackCount:
            preFormationStatus.pendingTransformReadbackCount,
        preActiveEffectCount,
        preEffectActivePoolIndex: preEffectPools.activePoolIndex,
        preAuthoritativeEffectPoolActiveCount:
            preEffectPools.authoritativeActiveCount,
        preEffectPoolInputCount: preEffectPools.inputCount,
        preEffectPoolAActiveCount: preEffectPools.poolA,
        preEffectPoolBActiveCount: preEffectPools.poolB,
        clearAuthoritativeEpoch: clearFormationStatus.authoritativeEpoch,
        clearActiveBodyCount: 0,
        clearHostActiveFormationCount: clearActiveFormationCount,
        clearHostActiveHxCount: clearActiveHxCount,
        clearHostPresentationCount: clearPresentationCount,
        clearGpuResourcesReleased,
        clearStagedPrepareProgramCount:
            clearFormationStatus.stagedPrepareProgramCount,
        clearPendingPrepareProgramCount:
            clearFormationStatus.pendingPrepareProgramCount,
        clearPendingPrepareReadbackCount:
            clearFormationStatus.pendingPrepareReadbackCount,
        clearArmedTransformCount: clearFormationStatus.armedTransformCount,
        clearPendingTransformReadbackCount:
            clearFormationStatus.pendingTransformReadbackCount,
        clearStagedEffectProgramCount: clearEffectStatus.stagedProgramCount,
        clearPendingEffectProgramCount:
            clearEffectStatus.pendingPulseProgramCount,
        clearPendingEffectReadbackCount:
            clearEffectStatus.pendingEffectReadbackCount,
        clearEffectPoolAActiveCount: clearEffectPools?.poolA ?? null,
        clearEffectPoolBActiveCount: clearEffectPools?.poolB ?? null,
        staleCommitAccepted: staleCommit.accepted,
        postStagedPrepareProgramCount:
            postFormationStatus.stagedPrepareProgramCount,
        postPendingPrepareProgramCount:
            postFormationStatus.pendingPrepareProgramCount,
        postPendingPrepareReadbackCount:
            postFormationStatus.pendingPrepareReadbackCount,
        postArmedTransformCount: postFormationStatus.armedTransformCount,
        postPendingTransformReadbackCount:
            postFormationStatus.pendingTransformReadbackCount,
        postPendingEffectProgramCount:
            postEffectStatus.pendingPulseProgramCount,
        postPendingEffectReadbackCount:
            postEffectStatus.pendingEffectReadbackCount,
        postActiveEffectCount,
        postEffectActivePoolIndex: postEffectPools.activePoolIndex,
        postAuthoritativeEffectPoolActiveCount:
            postEffectPools.authoritativeActiveCount,
        postEffectPoolInputCount: postEffectPools.inputCount,
        postEffectPoolAActiveCount: postEffectPools.poolA,
        postEffectPoolBActiveCount: postEffectPools.poolB,
        postFormationMemberCount: active[0].state.memberCount,
        postFormationGeneration: active[0].state.generation,
        postPresentationFlags:
            active[0].state.presentationFlags & presentationMask,
        postBoostStackCount: active[0].boostStackCount
    });
}

async function runGridOverflowFailCloseFixture(device, format) {
    const count = 66;
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: count,
        formationCommandCapacity: count,
        formationTransformCapacity: 1,
        sessionGeneration: 75
    });
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    backend.init(tileMap);
    const seed = createGpuEnemySpawnIntent({
        definition: BASIC_HEXA_ENEMY_DATA,
        route,
        spawnSequence: 0
    });
    const bodies = Array.from({ length: count }, (_, index) => createNaturalHexa(
        route,
        index,
        { entityId: 800 + index, incarnation: 1 },
        seed.position
    ));
    assert(backend.replaceBodies(bodies).accepted === count,
        'Hexa overflow replacement failed');
    assert(backend.fixedUpdate(FIXED_DELTA, 1),
        'Hexa overflow no-prepare submit failed');
    await device.queue.onSubmittedWorkDone();
    const planes = await readFormationPlanes(backend, device, count);
    const observed = planes.filter(({ state }) => (
        (state.flags & GPU_FORMATION_BODY_STATE_FLAG.GRID_OVERFLOW_OBSERVED) !== 0
    )).length;
    assert(observed > 0, 'Hexa grid overflow was not fail-closed/observed');
    assert(backend.getFormationRuntimeStatus().armedTransformCount === 0,
        'Hexa grid overflow armed a transform');
    backend.destroy();
    return Object.freeze({
        gridOverflowFailClose: true,
        overflowObservedBodyCount: observed
    });
}

async function runMotionDiagnosticCase(
    device,
    format,
    sessionGeneration,
    bodies,
    expectedFlag,
    tileMap = createTileMap(),
    captureMotionBeforePrepare = false
) {
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: bodies.length,
        formationCommandCapacity: bodies.length,
        formationTransformCapacity: 1,
        sessionGeneration
    });
    backend.init(tileMap);
    assert(backend.replaceBodies(bodies).accepted === bodies.length,
        'Formation motion diagnostic replacement failed');
    const before = await readFormationPlanes(
        backend,
        device,
        bodies.length
    );
    let diagnostics = null;
    if (captureMotionBeforePrepare) {
        assert(backend.fixedUpdate(FIXED_DELTA, 1),
            'Formation pre-prepare motion diagnostic submit failed');
        await device.queue.onSubmittedWorkDone();
        diagnostics = await readFormationMotionDiagnostics(
            backend,
            device,
            bodies.length
        );
    }
    const prepareTick = captureMotionBeforePrepare ? 2 : 1;
    assert(backend.stageFormationPrepareBatch({
        abiVersion: GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: (0x760000 + sessionGeneration) >>> 0,
        targetFixedTick: prepareTick,
        records: bodies.map((body, index) => Object.freeze({
            sourceEntityId: body.entityId,
            sourceIncarnation: body.incarnation,
            prepareSequence: index,
            fingerprint: (0x761000 + (sessionGeneration * 8) + index) >>> 0,
            flags: 0
        }))
    }).accepted, 'Formation motion diagnostic prepare stage failed');
    assert(backend.fixedUpdate(FIXED_DELTA, prepareTick),
        'Formation motion diagnostic submit failed');
    const completion = await waitForFormationPrepare(backend, device);
    if (diagnostics === null) {
        diagnostics = await readFormationMotionDiagnostics(
            backend,
            device,
            bodies.length
        );
    }
    const after = await readFormationPlanes(backend, device, bodies.length);
    const observedCount = diagnostics.filter(({ diagnosticFlags }) => (
        (diagnosticFlags & expectedFlag) !== 0
    )).length;
    const velocityDots = before.map((entry, index) => (
        (entry.velocity.x * after[index].velocity.x)
            + (entry.velocity.y * after[index].velocity.y)
    ));
    const minimumVelocityDot = Math.min(...velocityDots);
    const rejectedPairCount = completion.results.filter(({ result }) => (
        result === GPU_FORMATION_PREPARE_RESULT.NO_PAIR
            || result === GPU_FORMATION_PREPARE_RESULT.POLICY_REJECTED
    )).length;
    const acceptedDiagnostics = diagnostics.filter(({ diagnosticFlags }) => (
        (diagnosticFlags
            & GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG.CANDIDATE_ACCEPTED) !== 0
    ));
    backend.destroy();
    return Object.freeze({
        observedCount,
        rejectedPairCount,
        pairCount: completion.pairCount,
        minimumVelocityDot,
        beforeFlowFieldIndices: Object.freeze(before.map(({ flowFieldIndex }) => (
            flowFieldIndex
        ))),
        afterFlowFieldIndices: Object.freeze(after.map(({ flowFieldIndex }) => (
            flowFieldIndex
        ))),
        selectedForwardStageDeltas: Object.freeze(
            acceptedDiagnostics.map(({ forwardStageDelta }) => forwardStageDelta)
        ),
        selectedForwardCostDeltas: Object.freeze(
            acceptedDiagnostics.map(({ forwardCostDelta }) => forwardCostDelta)
        ),
        completionResults: Object.freeze(completion.results.map(({ result }) => (
            result
        ))),
        diagnostics
    });
}

async function runMotionPolicyFixture(device, format) {
    const mapDefinition = resolveIngameMapDefinition();
    const sourceRoute = mapDefinition.enemySpawnRoutes[0];
    const fixtureRoute = Object.freeze({
        ...sourceRoute,
        gateId: `${sourceRoute.gateId}-formation-motion-fixture`,
        pathId: `${sourceRoute.pathId}-formation-motion-fixture`
    });
    const tileMap = new TileMap(Object.freeze({
        ...mapDefinition,
        id: `${mapDefinition.id}-formation-motion-fixture`,
        enemySpawnRoutes: Object.freeze([sourceRoute, fixtureRoute])
    }));
    const routes = tileMap.getSpawnRoutes();
    assert(routes.length === 2
        && routes[0].gateId !== routes[1].gateId
        && routes[0].pathId !== routes[1].pathId,
    'Cross-route Formation fixture needs two exact route identities');
    const firstSeed = createGpuEnemySpawnIntent({
        definition: BASIC_HEXA_ENEMY_DATA,
        route: routes[0],
        spawnSequence: 0
    });
    const crossRouteBodies = [
        createNaturalHexa(
            routes[0],
            0,
            { entityId: 901, incarnation: 1 },
            firstSeed.position
        ),
        createNaturalHexa(
            routes[1],
            1,
            { entityId: 902, incarnation: 1 },
            { x: firstSeed.position.x + 2, y: firstSeed.position.y }
        )
    ];
    const crossRoute = await runMotionDiagnosticCase(
        device,
        format,
        76,
        crossRouteBodies,
        GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG.ROUTE_SPAN_REJECTED,
        tileMap
    );
    assert(crossRoute.observedCount > 0
        && crossRoute.pairCount === 0
        && crossRoute.beforeFlowFieldIndices.length === 2
        && crossRoute.beforeFlowFieldIndices[0]
            !== crossRoute.beforeFlowFieldIndices[1],
        'Formation cross-route candidate did not fail-close');

    const waypoints = routes[0].waypoints;
    assert(waypoints.length >= 2, 'Reverse Formation fixture needs two waypoints');
    const dx = waypoints[1].x - waypoints[0].x;
    const dy = waypoints[1].y - waypoints[0].y;
    const length = Math.hypot(dx, dy);
    assert(length > 0, 'Reverse Formation route segment is degenerate');
    const unit = { x: dx / length, y: dy / length };
    const behind = {
        x: waypoints[0].x + (unit.x * 0.4),
        y: waypoints[0].y + (unit.y * 0.4)
    };
    const ahead = {
        x: behind.x + (unit.x * Math.min(2.5, length * 0.5)),
        y: behind.y + (unit.y * Math.min(2.5, length * 0.5))
    };
    const reverseBodies = [
        createNaturalHexa(
            routes[0],
            0,
            { entityId: 911, incarnation: 1 },
            ahead
        ),
        createNaturalHexa(
            routes[0],
            1,
            { entityId: 912, incarnation: 1 },
            behind
        )
    ];
    const reverse = await runMotionDiagnosticCase(
        device,
        format,
        77,
        reverseBodies,
        GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG.REVERSE_PROGRESS_REJECTED
    );
    assert(reverse.observedCount > 0
        && reverse.pairCount === 0
        && reverse.minimumVelocityDot >= -0.000001,
    'Formation reverse candidate/no-reverse velocity failed');

    const blockedLeft = Object.freeze(tileMap.tileToWorld(10, 5, {}));
    const blockedRight = Object.freeze(tileMap.tileToWorld(12, 8, {}));
    const blockedPositions = Object.freeze([blockedRight, blockedLeft]);
    const blockedTiles = blockedPositions.map((position) => Object.freeze(
        tileMap.worldToTile(position.x, position.y, {})
    ));
    const blockedBodies = blockedPositions.map((position, index) => (
        createNaturalHexa(
            routes[0],
            index,
            { entityId: 921 + index, incarnation: 1 },
            position
        )
    ));
    const blockedAtlas = createRouteFlowFieldAtlas(tileMap);
    const blockedRouteSpan = blockedAtlas.routes.find(({ pathId }) => (
        pathId === routes[0].pathId
    ));
    const blockedFieldIndex = blockedRouteSpan?.firstFieldIndex;
    const blockedCosts = blockedTiles.map((tile) => (
        blockedAtlas.integrationCosts[
            (blockedFieldIndex * blockedAtlas.size)
                + (tile.row * blockedAtlas.cols)
                + tile.column
        ]
    ));
    const blockedDistance = Math.hypot(
        blockedRight.x - blockedLeft.x,
        blockedRight.y - blockedLeft.y
    );
    const grid = tileMap.getNavigationGrid();
    const sdf = createGpuSignedDistanceField(grid);
    const requiredSdfSamples = Math.max(
        1,
        Math.ceil(blockedDistance / grid.cellSize)
    );
    const worldBounds = tileMap.getWorldBounds();
    const sdfSamples = Object.freeze(Array.from(
        { length: requiredSdfSamples + 1 },
        (_, sample) => {
            const t = sample / requiredSdfSamples;
            const position = Object.freeze({
                x: blockedRight.x + ((blockedLeft.x - blockedRight.x) * t),
                y: blockedRight.y + ((blockedLeft.y - blockedRight.y) * t)
            });
            const uvX = Math.max(0, Math.min(
                0.999999,
                position.x / worldBounds.width
            ));
            const uvY = Math.max(0, Math.min(
                0.999999,
                position.y / worldBounds.height
            ));
            const column = Math.floor(uvX * sdf.cols);
            const row = Math.floor(uvY * sdf.rows);
            const boundary = Math.min(
                position.x,
                worldBounds.width - position.x,
                position.y,
                worldBounds.height - position.y
            );
            return Object.freeze({
                sample,
                position,
                column,
                row,
                distance: Math.min(
                    boundary,
                    sdf.values[(row * sdf.cols) + column] * grid.cellSize
                )
            });
        }
    ));
    const blockedClearance = Math.fround(
        Math.fround(blockedBodies[0].radius)
            * Math.fround(
                HEXA_HIVE_SIX_RING_FORMATION_DEFINITION
                    .corridorClearanceRadiusScale
            )
    );
    assert(blockedTiles.every(({ row, column }) => (
        tileMap.isWalkableTile(row, column)
    ))
        && blockedRouteSpan?.gateId === routes[0].gateId
        && blockedRouteSpan.pathId === routes[0].pathId
        && Number.isSafeInteger(blockedFieldIndex)
        && blockedFieldIndex >= 0
        && blockedRouteSpan.fieldCount > 0
        && blockedFieldIndex + blockedRouteSpan.fieldCount
            <= blockedAtlas.fieldCount
        && blockedCosts[0] > blockedCosts[1]
        && blockedDistance
            < HEXA_HIVE_SIX_RING_FORMATION_DEFINITION.mergeSeekRadiusTiles
        && requiredSdfSamples
            <= HEXA_HIVE_SIX_RING_FORMATION_DEFINITION
                .maximumSdfSegmentSamples
        && Math.min(...sdfSamples.map(({ distance }) => distance))
            < blockedClearance,
    'Formation deterministic blocked SDF fixture invariant failed');
    const blocked = await runMotionDiagnosticCase(
        device,
        format,
        78,
        blockedBodies,
        GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG.SDF_SEGMENT_REJECTED,
        tileMap,
        true
    );
    assert(blocked.observedCount > 0 && blocked.pairCount === 0,
        `Formation blocked SDF segment did not fail-close: ${JSON.stringify({
            blockedPositions,
            blockedTiles,
            blockedRouteSpan,
            blockedFieldIndex,
            blockedCosts,
            blockedDistance,
            requiredSdfSamples,
            blockedClearance,
            sdfSamples,
            evidence: blocked
        })}`);
    return Object.freeze({
        sameRouteOnly: true,
        crossRouteRejectedPairCount: crossRoute.rejectedPairCount,
        crossRouteObservedCount: crossRoute.observedCount,
        noReverse: true,
        reverseRejectedPairCount: reverse.rejectedPairCount,
        reverseObservedCount: reverse.observedCount,
        minimumVelocityDot: reverse.minimumVelocityDot,
        reverseBeforeFlowFieldIndices: reverse.beforeFlowFieldIndices,
        reverseAfterFlowFieldIndices: reverse.afterFlowFieldIndices,
        sdfFailClose: true,
        sdfRejectedPairCount: blocked.rejectedPairCount,
        sdfRejectedSegmentCount: blocked.observedCount
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
        const format = navigator.gpu.getPreferredCanvasFormat();
        const primary = await runPrimaryFormationFixture(device, format);
        const reservation = await runReservationPresentationFixture(device, format);
        const atomicity = await runAtomicRejectFixture(device, format);
        const hostAtomicity = runHostAtomicLifecycleFixture();
        const aba = await runAbaResetFixture(device, format);
        const motion = await runMotionPolicyFixture(device, format);
        const overflow = await runGridOverflowFailCloseFixture(device, format);
        result.productionEnemyHexaFormation = Object.freeze({
            scenario: primary.scenario,
            chain: primary.chain,
            effectTransfer: primary.effectTransfer,
            motion: Object.freeze({
                ...motion,
                gridOverflowFailClose: overflow.gridOverflowFailClose,
                overflowObservedBodyCount: overflow.overflowObservedBodyCount
            }),
            atomicity: Object.freeze({
                ...atomicity,
                ...aba,
                hostRegistryLifecycle: hostAtomicity
            }),
            presentation: Object.freeze({
                ...primary.presentation,
                ...reservation
            }),
            storageProfile: primary.storageProfile,
            terminal: primary.terminal,
            replacementReset: primary.replacementReset,
            transformCompletionCount: primary.transformCompletionCount,
            formationDefinitionCode:
                HEXA_HIVE_SIX_RING_FORMATION_DEFINITION.definitionCode,
            invalidIdentitySentinel: UINT32_MAX
        });
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
