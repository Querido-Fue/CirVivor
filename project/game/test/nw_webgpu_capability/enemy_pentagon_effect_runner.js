import {
    ARCHER_ENEMY_DATA
} from './production/script/data/object/enemy/archer_enemy_data.js';
import {
    ARCHER_ATTACK_DATA
} from './production/script/data/object/enemy/archer_attack_data.js';
import {
    BASIC_PENTA_ENEMY_DATA,
    BASIC_SQUARE_ENEMY_DATA
} from './production/script/data/object/enemy/basic_circle_enemy_data.js';
import {
    HOSTILE_BASIC_BULLET_DATA
} from './production/script/data/object/projectile/hostile_basic_bullet_data.js';
import {
    PENTA_BOOST_EFFECT_DEFINITION,
    PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE
} from './production/script/data/object/enemy/enemy_effect_catalog_data.js';
import { createTileMap } from './production/script/module/ingame/map/tile_map.js';
import { EnemySimulationBackend } from './production/script/module/ingame/object/enemy/enemy_simulation_backend.js';
import { createGpuEnemySpawnIntent } from './production/script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js';
import {
    GPU_PROJECTILE_SPAWN_MODE,
    requestGpuProjectile
} from './production/script/module/ingame/object/projectile/gpu_projectile_spawn_adapter.js';
import {
    createGpuTowerSpawnIntent
} from './production/script/module/ingame/object/tower/gpu_tower_spawn_adapter.js';
import {
    GAMEPLAY_TEAM_ID
} from './production/script/module/ingame/contract/gameplay_team_contract.js';
import {
    GPU_CIRCLE_BODY_COLLISION_LAYER
} from './production/script/module/ingame/physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_EFFECT_EVENT_TYPE,
    GPU_EFFECT_DAMAGE_CHANNEL_FLAG,
    GPU_EFFECT_EMITTER_FLAG,
    GPU_EFFECT_PRESENTATION_TAG,
    GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
    GPU_EFFECT_PULSE_PROGRAM_FLAG,
    GPU_EFFECT_PULSE_PROGRAM_RESULT,
    GPU_EFFECT_RUNTIME_ABI,
    GPU_EFFECT_RUNTIME_STATUS,
    GPU_EFFECT_SUMMARY_FLAG,
    GPU_EFFECT_TARGET_POLICY,
    GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION,
    readGpuEffectPoolState
} from './production/script/module/ingame/physics/gpu/gpu_effect_runtime_abi.js';
import {
    GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION,
    GPU_SPAWN_PROGRAM_REQUEST_FLAGS
} from './production/script/module/ingame/physics/gpu/gpu_fixed_primitive_abi.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const REQUIRED_STORAGE_BUFFER_LIMIT = 9;
const HARDWARE_FIXED_SUBMIT_SETTLE_INTERVAL_TICKS = 16;
const REQUIRED_EFFECT_FLAGS = GPU_EFFECT_PULSE_PROGRAM_FLAG.PENTA_TARGET_ALLOWED
    | GPU_EFFECT_PULSE_PROGRAM_FLAG.TOWER_CONTACT_DAMAGE_MODIFIABLE
    | GPU_EFFECT_PULSE_PROGRAM_FLAG.PROJECTILE_TOWER_DAMAGE_MODIFIABLE;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
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

function withIdentity(intent, entityId, incarnation = 1, overrides = {}) {
    return Object.freeze({
        ...intent,
        entityId,
        incarnation,
        ...overrides
    });
}

async function readGpuBufferBytes(device, source, byteLength) {
    const target = device.createBuffer({
        label: 'cirvivor-nw-effect-diagnostic-readback',
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(source, 0, target, 0, byteLength);
        device.queue.submit([encoder.finish()]);
        await target.mapAsync(GPUMapMode.READ);
        return new Uint8Array(target.getMappedRange()).slice().buffer;
    } finally {
        try {
            target.unmap();
        } catch {
            // already unmapped
        }
        target.destroy();
    }
}

async function readRenderTexturePixels(device, texture, width, height) {
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const target = device.createBuffer({
        label: 'cirvivor-nw-effect-render-readback',
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = device.createCommandEncoder({
            label: 'cirvivor-nw-effect-render-copy'
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

function readRenderPixel(frame, x, y) {
    const offset = (y * frame.bytesPerRow) + (x * 4);
    return Object.freeze(Array.from(frame.bytes.slice(offset, offset + 4)));
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

async function readEffectBodyPlanes(backend, device, bodyCount) {
    const summaryBytes = await readGpuBufferBytes(
        device,
        backend.simulation.buffers.effectSummaries,
        bodyCount * GPU_EFFECT_RUNTIME_ABI.SUMMARY.STRIDE
    );
    const emitterBytes = await readGpuBufferBytes(
        device,
        backend.simulation.buffers.effectEmitterStates,
        bodyCount * GPU_EFFECT_RUNTIME_ABI.EMITTER_STATE.STRIDE
    );
    const summaries = new DataView(summaryBytes);
    const emitters = new DataView(emitterBytes);
    return Object.freeze({
        summary(slot) {
            const abi = GPU_EFFECT_RUNTIME_ABI.SUMMARY;
            const offset = slot * abi.STRIDE;
            return Object.freeze({
                entityId: summaries.getUint32(offset + abi.ENTITY_ID, true),
                incarnation: summaries.getUint32(offset + abi.INCARNATION, true),
                resolvedBaseDamageOther: summaries.getFloat32(
                    offset + abi.RESOLVED_BASE_DAMAGE_OTHER,
                    true
                ),
                boostStackCount: summaries.getUint32(
                    offset + abi.BOOST_STACK_COUNT,
                    true
                ),
                regenPerTickFixedPoint: summaries.getInt32(
                    offset + abi.REGEN_PER_TICK_FIXED_POINT,
                    true
                ),
                attackMultiplier: summaries.getFloat32(
                    offset + abi.ATTACK_MULTIPLIER,
                    true
                ),
                presentationTags: summaries.getUint32(
                    offset + abi.PRESENTATION_TAGS,
                    true
                ),
                presentationMagnitude: summaries.getFloat32(
                    offset + abi.PRESENTATION_MAGNITUDE,
                    true
                ),
                summaryTick: summaries.getUint32(
                    offset + abi.SUMMARY_TICK,
                    true
                ),
                sourceSnapshotTick: summaries.getUint32(
                    offset + abi.SOURCE_SNAPSHOT_TICK,
                    true
                ),
                flags: summaries.getUint32(offset + abi.FLAGS, true)
            });
        },
        emitter(slot) {
            const abi = GPU_EFFECT_RUNTIME_ABI.EMITTER_STATE;
            const offset = slot * abi.STRIDE;
            return Object.freeze({
                lastPulseTick: emitters.getUint32(
                    offset + abi.LAST_PULSE_TICK,
                    true
                ),
                flags: emitters.getUint32(offset + abi.FLAGS, true),
                lastRetargetTick: emitters.getUint32(
                    offset + abi.LAST_RETARGET_TICK,
                    true
                )
            });
        }
    });
}

async function readEffectPool(backend, device) {
    return readGpuEffectPoolState(await readGpuBufferBytes(
        device,
        backend.simulation.buffers.effectPoolState,
        GPU_EFFECT_RUNTIME_ABI.POOL_STATE.STRIDE
    ));
}

function createPulseRecord(source, sourceTick, pulseSequence, fingerprint, flags) {
    return Object.freeze({
        sourceEntityId: source.entityId,
        sourceIncarnation: source.incarnation,
        effectDefinitionCode: PENTA_BOOST_EFFECT_DEFINITION.effectDefinitionCode,
        emitterDefinitionCode:
            PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.emitterDefinitionCode,
        sourceTick,
        pulseSequence,
        radiusTiles: PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.pulseRadiusTiles,
        targetLayerMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        targetPolicy: GPU_EFFECT_TARGET_POLICY.HOSTILE_ENEMY,
        fingerprint,
        flags,
        retargetIntervalTicks:
            PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE.retargetIntervalTicks
    });
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
        `Effect completion timeout: ${JSON.stringify(backend.getEffectRuntimeStatus())}`
    );
}

async function waitForSpawnCompletion(backend, device, timeoutMs = 5_000) {
    await device.queue.onSubmittedWorkDone();
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        const completed = backend.drainCompletedSpawnProgramBatches([]);
        if (completed.length > 0) {
            return completed[0];
        }
        await new Promise((resolve) => setTimeout(resolve, 4));
    }
    throw new Error(
        `Spawn completion timeout: ${JSON.stringify(backend.getStatus().gpu)}`
    );
}

async function advanceFixedTicksWithReadbackYields(
    backend,
    device,
    firstTick,
    lastTick,
    label
) {
    let ticksSinceSettle = 0;
    for (let tick = firstTick; tick <= lastTick; tick++) {
        assert(backend.fixedUpdate(1 / 60, tick), `${label} tick ${tick} failed`);
        ticksSinceSettle++;
        // 독립 hardware runner에는 browser frame yield가 없으므로 bounded
        // telemetry readback ring이 정상적으로 lease를 반환할 기회를 줍니다.
        if (ticksSinceSettle === HARDWARE_FIXED_SUBMIT_SETTLE_INTERVAL_TICKS
            || tick === lastTick) {
            await device.queue.onSubmittedWorkDone();
            await new Promise((resolve) => setTimeout(resolve, 0));
            ticksSinceSettle = 0;
        }
    }
}

async function runPentagonEffectFixture(device, format) {
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: 8,
        effectCommandCapacity: 4,
        effectInstanceCapacity: 16,
        effectCandidateCapacity: 16,
        effectEventCapacity: 20,
        sessionGeneration: 17
    });
    backend.init(tileMap);

    const sourceIntent = createGpuEnemySpawnIntent({
        definition: BASIC_PENTA_ENEMY_DATA,
        route,
        spawnSequence: 0,
        laneOffsetTiles: 0
    });
    const source = withIdentity(sourceIntent, 101, 1, { contactHandler: null });
    const leftIntent = createGpuEnemySpawnIntent({
        definition: BASIC_SQUARE_ENEMY_DATA,
        route,
        spawnSequence: 1,
        laneOffsetTiles: -2
    });
    const leftTarget = withIdentity(leftIntent, 102, 1, {
        contactHandler: null,
        maxHealth: leftIntent.health,
        health: leftIntent.health - 0.02
    });
    const rightIntent = createGpuEnemySpawnIntent({
        definition: BASIC_SQUARE_ENEMY_DATA,
        route,
        spawnSequence: 2,
        laneOffsetTiles: 2
    });
    const rightTarget = withIdentity(rightIntent, 103, 1, {
        contactHandler: null,
        maxHealth: rightIntent.health,
        health: rightIntent.health - 0.02
    });
    const replacement = backend.replaceBodies([source, leftTarget, rightTarget]);
    assert(replacement.accepted === 3, 'Effect fixture body replacement failed');

    const flags = REQUIRED_EFFECT_FLAGS;
    const stage = backend.stageEffectPulseProgramBatch({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x170001,
        sourceTick: 1,
        records: [createPulseRecord(source, 1, 0, 0x170101, flags)]
    });
    assert(stage.accepted === true && stage.stagedCount === 1, 'Effect batch stage failed');
    assert(backend.fixedUpdate(1 / 60, 1) === true, 'Effect fixed submit failed');

    const completion = await waitForEffectCompletion(backend, device);
    assert(completion.status === GPU_EFFECT_RUNTIME_STATUS.OK, 'Effect runtime status failed');
    assert(completion.sourceTick === 1, 'Effect sourceTick mismatch');
    assert(completion.completedThroughTick === 1, 'Effect watermark mismatch');
    assert(completion.pulseResults.length === 1, 'Effect pulse result count mismatch');
    const pulseResult = completion.pulseResults[0];
    assert(pulseResult.programIndex === 0, 'Effect program order mismatch');
    assert(
        pulseResult.resultCode === GPU_EFFECT_PULSE_PROGRAM_RESULT.APPLIED,
        `Effect pulse did not apply: ${pulseResult.resultCode}`
    );
    assert(pulseResult.candidateCount === 2, 'Effect candidate count mismatch');
    assert(pulseResult.appliedCount === 2, 'Effect applied count mismatch');
    assert(completion.eventCount === 3, 'Effect event count mismatch');
    assert(
        completion.events.filter(({ type }) => (
            type === GPU_EFFECT_EVENT_TYPE.PULSE_EMITTED
        )).length === 1,
        'Effect pulse event composition mismatch'
    );
    assert(
        completion.events.filter(({ type }) => (
            type === GPU_EFFECT_EVENT_TYPE.INSTANCE_APPLIED
        )).length === 2,
        'Effect instance event composition mismatch'
    );

    const firstPlanes = await readEffectBodyPlanes(backend, device, 3);
    const firstLeft = firstPlanes.summary(1);
    const firstSource = firstPlanes.summary(0);
    assert(firstLeft.boostStackCount === 1, 'Effect stack1 summary mismatch');
    assert(firstLeft.regenPerTickFixedPoint === 1, 'Effect stack1 regen mismatch');
    assert(firstLeft.attackMultiplier === 1, 'Effect stack1 attack threshold mismatch');
    assert(
        (firstLeft.presentationTags & GPU_EFFECT_PRESENTATION_TAG.BOOST) !== 0,
        'Effect target halo presentation tag missing'
    );
    assert(
        (firstSource.presentationTags & GPU_EFFECT_PRESENTATION_TAG.PULSE) !== 0,
        'Effect source pulse presentation tag missing'
    );
    assert(firstPlanes.emitter(0).lastRetargetTick === 1,
        'P retarget initial tick mismatch');
    const firstBodies = await backend.simulation.readbackBodies();
    const firstLeftBody = firstBodies.find(({ handle }) => (
        handle?.entityId === leftTarget.entityId
    ));
    assert(
        Math.abs(firstLeftBody.health - (leftTarget.health + 0.01)) < 0.000001,
        'Effect stack1 regen fixed-point application mismatch'
    );

    const overlappingStage = backend.stageEffectPulseProgramBatch({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x170002,
        sourceTick: 2,
        records: [createPulseRecord(source, 2, 1, 0x170102, flags)]
    });
    assert(overlappingStage.accepted === true, 'Effect overlapping stage failed');
    assert(backend.fixedUpdate(1 / 60, 2) === true, 'Effect overlapping submit failed');
    const overlapping = await waitForEffectCompletion(backend, device);
    assert(overlapping.appliedInstanceCount === 2, 'Effect overlapping apply mismatch');
    const overlappingPlanes = await readEffectBodyPlanes(backend, device, 3);
    const overlappingLeft = overlappingPlanes.summary(1);
    assert(overlappingLeft.boostStackCount === 2, 'Effect independent stack2 mismatch');
    assert(overlappingLeft.attackMultiplier === 1.25, 'Effect stack2 attack mismatch');
    assert(
        (overlappingLeft.flags & GPU_EFFECT_DAMAGE_CHANNEL_FLAG.TOWER_CONTACT) !== 0
            && (overlappingLeft.flags
                & GPU_EFFECT_DAMAGE_CHANNEL_FLAG.PROJECTILE_TOWER) !== 0
            && (overlappingLeft.flags
                & GPU_EFFECT_DAMAGE_CHANNEL_FLAG.DIRECT_CORE_IMPACT) === 0
            && (overlappingLeft.flags
                & GPU_EFFECT_DAMAGE_CHANNEL_FLAG.PROJECTILE_CORE) === 0,
        'Effect Tower/Core damage-channel summary mismatch'
    );
    assert(overlappingPlanes.emitter(0).lastRetargetTick === 1,
        'P retarget interval advanced early');
    const secondBodies = await backend.simulation.readbackBodies();
    const secondLeftBody = secondBodies.find(({ handle }) => (
        handle?.entityId === leftTarget.entityId
    ));
    assert(Math.abs(secondLeftBody.health - leftIntent.health) < 0.000001,
        'Effect regeneration max-health clamp mismatch');

    for (let tick = 3; tick <= 16; tick++) {
        assert(backend.fixedUpdate(1 / 60, tick), `Effect interval tick ${tick} failed`);
    }
    await device.queue.onSubmittedWorkDone();
    const intervalPlanes = await readEffectBodyPlanes(backend, device, 3);
    assert(intervalPlanes.emitter(0).lastRetargetTick === 16,
        'P retarget interval boundary mismatch');
    await advanceFixedTicksWithReadbackYields(
        backend,
        device,
        17,
        180,
        'Effect lifetime'
    );
    const beforeExpiry = await readEffectBodyPlanes(backend, device, 3);
    assert(beforeExpiry.summary(1).boostStackCount === 2,
        'Effect half-open pre-expiry stack mismatch');
    assert(backend.fixedUpdate(1 / 60, 181), 'Effect first expiry submit failed');
    await device.queue.onSubmittedWorkDone();
    const firstExpiry = await readEffectBodyPlanes(backend, device, 3);
    assert(firstExpiry.summary(1).boostStackCount === 1,
        'Effect first half-open expiry mismatch');
    assert(backend.fixedUpdate(1 / 60, 182), 'Effect final expiry submit failed');
    await device.queue.onSubmittedWorkDone();
    const finalExpiry = await readEffectBodyPlanes(backend, device, 3);
    assert(finalExpiry.summary(1).boostStackCount === 0,
        'Effect final half-open expiry mismatch');

    const statusBeforeTerminal = backend.getEffectRuntimeStatus();
    const gpuStatus = backend.getStatus().gpu;
    assert(statusBeforeTerminal.pendingPulseProgramCount === 0, 'Effect pulse queue not drained');
    assert(statusBeforeTerminal.pendingEffectReadbackCount === 0, 'Effect readback not drained');
    assert(gpuStatus.effects.storageBuffersPerStage === 9, 'Effect storage profile mismatch');
    assert(gpuStatus.fixedPrimitives.storageProfile.sourceResolve === 9,
        'Effect source-resolve storage profile mismatch');
    assert(backend.requiresRecovery() === false,
        'Effect lifetime pacing unexpectedly entered recovery');

    const terminal = backend.cancelPendingEffectProgramsForTerminal({
        abiVersion: GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION,
        finalFixedTick: 183
    });
    assert(terminal.state === 'armed', 'Effect terminal cancel was not armed');
    assert(backend.fixedUpdate(1 / 60, 183) === true, 'Effect terminal submit failed');
    const terminalStatus = backend.getEffectRuntimeStatus().terminal;
    assert(terminalStatus.state === 'submitted', 'Effect terminal evidence not submitted');
    assert(terminalStatus.submittedTick === 183, 'Effect terminal submittedTick mismatch');
    assert(terminalStatus.pendingPulseProgramCount === 0, 'Effect terminal pulse pending');
    assert(terminalStatus.pendingEffectReadbackCount === 0, 'Effect terminal readback pending');

    backend.destroy();
    return Object.freeze({
        scenario: 'penta-independent-boost-pulse-whole-tick',
        pulseResult,
        candidateCount: completion.candidateCount,
        appliedInstanceCount: completion.appliedInstanceCount,
        eventCount: completion.eventCount,
        eventTypes: Object.freeze(completion.events.map(({ type }) => type)),
        independentLifetime: Object.freeze({
            stackAt180: beforeExpiry.summary(1).boostStackCount,
            stackAt181: firstExpiry.summary(1).boostStackCount,
            stackAt182: finalExpiry.summary(1).boostStackCount
        }),
        regeneration: Object.freeze({
            stack1Health: firstLeftBody.health,
            clampedHealth: secondLeftBody.health,
            maxHealth: leftIntent.health
        }),
        presentation: Object.freeze({
            sourceTags: firstSource.presentationTags,
            targetTags: firstLeft.presentationTags,
            magnitude: firstLeft.presentationMagnitude
        }),
        flags,
        damageChannels: Object.freeze({
            towerContact: PENTA_BOOST_EFFECT_DEFINITION
                .towerContactDamageEffectModifiable,
            projectileTower: PENTA_BOOST_EFFECT_DEFINITION
                .projectileTowerDamageEffectModifiable,
            directCore: PENTA_BOOST_EFFECT_DEFINITION
                .directCoreImpactDamageEffectModifiable,
            projectileCore: PENTA_BOOST_EFFECT_DEFINITION
                .typedProjectileCoreDamageEffectModifiable
        }),
        storageProfile: gpuStatus.fixedPrimitives.storageProfile,
        effectStorageBuffersPerStage: gpuStatus.effects.storageBuffersPerStage,
        terminal: terminalStatus
    });
}

async function runEffectCapacityAtomicityFixture(device, format, kind) {
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: 4,
        effectCommandCapacity: 1,
        effectInstanceCapacity: kind === 'instance' ? 1 : 8,
        effectCandidateCapacity: 8,
        effectEventCapacity: kind === 'event' ? 2 : 8,
        sessionGeneration: kind === 'instance' ? 31 : 32
    });
    backend.init(tileMap);
    const sourceIntent = createGpuEnemySpawnIntent({
        definition: BASIC_PENTA_ENEMY_DATA,
        route,
        spawnSequence: 0
    });
    const source = withIdentity(sourceIntent, 301, 1, { contactHandler: null });
    const targets = [0, 1].map((index) => withIdentity(
        createGpuEnemySpawnIntent({
            definition: BASIC_SQUARE_ENEMY_DATA,
            route,
            spawnSequence: index + 1,
            laneOffsetTiles: index === 0 ? -1 : 1
        }),
        302 + index,
        1,
        { contactHandler: null }
    ));
    assert(backend.replaceBodies([source, ...targets]).accepted === 3,
        `Effect ${kind} capacity replace failed`);
    const staged = backend.stageEffectPulseProgramBatch({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: kind === 'instance' ? 0x310001 : 0x320001,
        sourceTick: 1,
        records: [createPulseRecord(
            source,
            1,
            0,
            kind === 'instance' ? 0x310101 : 0x320101,
            REQUIRED_EFFECT_FLAGS
        )]
    });
    assert(staged.accepted, `Effect ${kind} one-short stage failed`);
    assert(backend.fixedUpdate(1 / 60, 1), `Effect ${kind} one-short submit failed`);
    const completion = await waitForEffectCompletion(backend, device);
    const expectedStatus = kind === 'instance'
        ? GPU_EFFECT_RUNTIME_STATUS.INSTANCE_CAPACITY_EXCEEDED
        : GPU_EFFECT_RUNTIME_STATUS.EVENT_CAPACITY_EXCEEDED;
    assert((completion.status & expectedStatus) !== 0,
        `Effect ${kind} capacity status mismatch: ${completion.status}`);
    assert(completion.appliedInstanceCount === 0 && completion.eventCount === 0,
        `Effect ${kind} capacity was partially applied`);
    assert(
        completion.pulseResults[0].resultCode
            === GPU_EFFECT_PULSE_PROGRAM_RESULT.CAPACITY_REJECTED,
        `Effect ${kind} capacity result mismatch`
    );
    const status = backend.getEffectRuntimeStatus();
    backend.destroy();
    return Object.freeze({
        kind,
        status: completion.status,
        candidateCount: completion.candidateCount,
        appliedInstanceCount: completion.appliedInstanceCount,
        eventCount: completion.eventCount,
        pendingPulseProgramCount: status.pendingPulseProgramCount,
        pendingEffectReadbackCount: status.pendingEffectReadbackCount
    });
}

async function runEffectNoReviveFixture(device, format) {
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: 2,
        effectCommandCapacity: 1,
        effectInstanceCapacity: 2,
        effectCandidateCapacity: 2,
        effectEventCapacity: 3,
        sessionGeneration: 33
    });
    backend.init(tileMap);
    const source = withIdentity(createGpuEnemySpawnIntent({
        definition: BASIC_PENTA_ENEMY_DATA,
        route,
        spawnSequence: 0
    }), 331, 1, { contactHandler: null });
    const targetIntent = createGpuEnemySpawnIntent({
        definition: BASIC_SQUARE_ENEMY_DATA,
        route,
        spawnSequence: 1
    });
    const target = withIdentity(targetIntent, 332, 1, {
        contactHandler: null,
        maxHealth: targetIntent.health,
        health: 0
    });
    assert(backend.replaceBodies([source, target]).accepted === 2,
        'Effect no-revive replace failed');
    assert(backend.stageEffectPulseProgramBatch({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x330001,
        sourceTick: 1,
        records: [createPulseRecord(source, 1, 0, 0x330101, REQUIRED_EFFECT_FLAGS)]
    }).accepted, 'Effect no-revive stage failed');
    assert(backend.fixedUpdate(1 / 60, 1), 'Effect no-revive submit failed');
    await waitForEffectCompletion(backend, device);
    const bodies = await backend.simulation.readbackBodies();
    assert(!bodies.some(({ handle }) => handle?.entityId === target.entityId),
        'Effect regeneration revived a zero-health body');
    backend.destroy();
    return Object.freeze({ targetEntityId: target.entityId, revived: false });
}

async function runEffectAbaResetFixture(device, format) {
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: 3,
        effectCommandCapacity: 1,
        effectInstanceCapacity: 4,
        effectCandidateCapacity: 4,
        effectEventCapacity: 5,
        sessionGeneration: 34
    });
    backend.init(tileMap);
    const source = withIdentity(createGpuEnemySpawnIntent({
        definition: BASIC_PENTA_ENEMY_DATA,
        route,
        spawnSequence: 0
    }), 341, 1, { contactHandler: null });
    const oldTarget = withIdentity(createGpuEnemySpawnIntent({
        definition: BASIC_SQUARE_ENEMY_DATA,
        route,
        spawnSequence: 1
    }), 342, 1, { contactHandler: null });
    assert(backend.replaceBodies([source, oldTarget]).accepted === 2,
        'Effect ABA replace failed');
    assert(backend.stageEffectPulseProgramBatch({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x340001,
        sourceTick: 1,
        records: [createPulseRecord(source, 1, 0, 0x340101, REQUIRED_EFFECT_FLAGS)]
    }).accepted, 'Effect ABA stage failed');
    assert(backend.fixedUpdate(1 / 60, 1), 'Effect ABA submit failed');
    await waitForEffectCompletion(backend, device);
    const before = await readEffectBodyPlanes(backend, device, 2);
    assert(before.summary(1).boostStackCount === 1, 'Effect ABA setup stack missing');
    assert(backend.despawnBodies([oldTarget]).removed === 1, 'Effect ABA despawn failed');
    const replacement = withIdentity(createGpuEnemySpawnIntent({
        definition: BASIC_SQUARE_ENEMY_DATA,
        route,
        spawnSequence: 2
    }), 343, 2, { contactHandler: null });
    assert(backend.spawnBodies([replacement]).accepted === 1, 'Effect ABA respawn failed');
    await device.queue.onSubmittedWorkDone();
    const after = await readEffectBodyPlanes(backend, device, 2);
    const reset = after.summary(1);
    assert(reset.entityId === replacement.entityId
        && reset.incarnation === replacement.incarnation
        && reset.boostStackCount === 0
        && reset.sourceSnapshotTick === 0
        && reset.flags === 0,
    'Effect ABA reused transient state');
    assert(backend.fixedUpdate(1 / 60, 2), 'Effect ABA cleanup tick failed');
    await device.queue.onSubmittedWorkDone();
    const stable = await readEffectBodyPlanes(backend, device, 2);
    assert(stable.summary(1).boostStackCount === 0,
        'Effect ABA stale instance rebound to replacement');
    backend.destroy();
    return Object.freeze({
        oldIdentity: Object.freeze({ entityId: oldTarget.entityId, incarnation: 1 }),
        replacementIdentity: Object.freeze({
            entityId: replacement.entityId,
            incarnation: replacement.incarnation
        }),
        resetStackCount: stable.summary(1).boostStackCount
    });
}

async function runPentaOverflowFailCloseFixture(device, format) {
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: 70,
        effectCommandCapacity: 1,
        sessionGeneration: 35
    });
    backend.init(tileMap);
    const sourceIntent = createGpuEnemySpawnIntent({
        definition: BASIC_PENTA_ENEMY_DATA,
        route,
        spawnSequence: 0
    });
    const source = withIdentity(sourceIntent, 351, 1, { contactHandler: null });
    const crowded = Array.from({ length: 65 }, (_, index) => withIdentity(
        createGpuEnemySpawnIntent({
            definition: BASIC_SQUARE_ENEMY_DATA,
            route,
            spawnSequence: index + 1
        }),
        352 + index,
        1,
        {
            contactHandler: null,
            position: source.position,
            velocity: source.velocity
        }
    ));
    assert(backend.replaceBodies([source, ...crowded]).accepted === 66,
        'P overflow replace failed');
    assert(backend.fixedUpdate(1 / 60, 1), 'P overflow no-pulse submit failed');
    await device.queue.onSubmittedWorkDone();
    const planes = await readEffectBodyPlanes(backend, device, 66);
    assert(
        (planes.emitter(0).flags
            & GPU_EFFECT_EMITTER_FLAG.GRID_OVERFLOW_OBSERVED) !== 0,
        'P navigation did not sticky fail-close tick-start overflow'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overflow = backend.getStatus().gpu.overflow;
    assert(overflow.totalSmallCount > 0 || overflow.totalBigCount > 0,
        'P navigation overflow recovery evidence missing');
    backend.destroy();
    return Object.freeze({
        emitterFlags: planes.emitter(0).flags,
        totalSmallCount: overflow.totalSmallCount,
        totalBigCount: overflow.totalBigCount
    });
}

async function runEffectIdleEpochFixture(device, format) {
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: 2,
        effectCommandCapacity: 1,
        effectInstanceCapacity: 2,
        effectCandidateCapacity: 2,
        effectEventCapacity: 3,
        sessionGeneration: 36
    });
    backend.init(tileMap);
    const source = withIdentity(createGpuEnemySpawnIntent({
        definition: BASIC_PENTA_ENEMY_DATA,
        route,
        spawnSequence: 0
    }), 361, 1, { contactHandler: null });
    const target = withIdentity(createGpuEnemySpawnIntent({
        definition: BASIC_SQUARE_ENEMY_DATA,
        route,
        spawnSequence: 1
    }), 362, 1, { contactHandler: null });
    assert(backend.replaceBodies([source, target]).accepted === 2,
        'Effect idle epoch replace failed');
    assert(backend.stageEffectPulseProgramBatch({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x360001,
        sourceTick: 1,
        records: [createPulseRecord(source, 1, 0, 0x360101, REQUIRED_EFFECT_FLAGS)]
    }).accepted, 'Effect idle epoch stage failed');
    assert(backend.fixedUpdate(1 / 60, 1), 'Effect idle epoch submit failed');
    await waitForEffectCompletion(backend, device);
    const oldPool = await readEffectPool(backend, device);
    assert(oldPool.nextInstanceId > 1, 'Effect idle epoch setup instance missing');
    await device.queue.onSubmittedWorkDone();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(backend.despawnBodies([source, target]).removed === 2,
        'Effect idle epoch despawn failed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const nextSource = withIdentity(createGpuEnemySpawnIntent({
        definition: BASIC_PENTA_ENEMY_DATA,
        route,
        spawnSequence: 2
    }), 363, 2, { contactHandler: null });
    const nextTarget = withIdentity(createGpuEnemySpawnIntent({
        definition: BASIC_SQUARE_ENEMY_DATA,
        route,
        spawnSequence: 3
    }), 364, 2, { contactHandler: null });
    assert(backend.spawnBodies([nextSource, nextTarget]).accepted === 2,
        'Effect idle epoch respawn failed');
    await device.queue.onSubmittedWorkDone();
    const nextPool = await readEffectPool(backend, device);
    const planes = await readEffectBodyPlanes(backend, device, 2);
    assert(nextPool.instanceEpoch !== oldPool.instanceEpoch
        && nextPool.nextInstanceId === 1
        && nextPool.inputCount === 0
        && planes.summary(1).boostStackCount === 0
        && planes.emitter(0).lastPulseTick === 0xffffffff,
    'Effect idle release reused pool/timer identity');
    backend.destroy();
    return Object.freeze({
        oldInstanceEpoch: oldPool.instanceEpoch,
        newInstanceEpoch: nextPool.instanceEpoch,
        newNextInstanceId: nextPool.nextInstanceId
    });
}

async function runEffectTerminalPendingFixture(device, format) {
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: 2,
        effectCommandCapacity: 1,
        effectInstanceCapacity: 2,
        effectCandidateCapacity: 2,
        effectEventCapacity: 3,
        sessionGeneration: 37
    });
    backend.init(tileMap);
    const source = withIdentity(createGpuEnemySpawnIntent({
        definition: BASIC_PENTA_ENEMY_DATA,
        route,
        spawnSequence: 0
    }), 371, 1, { contactHandler: null });
    const target = withIdentity(createGpuEnemySpawnIntent({
        definition: BASIC_SQUARE_ENEMY_DATA,
        route,
        spawnSequence: 1
    }), 372, 1, { contactHandler: null });
    assert(backend.replaceBodies([source, target]).accepted === 2,
        'Effect pending terminal replace failed');
    assert(backend.stageEffectPulseProgramBatch({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x370001,
        sourceTick: 1,
        records: [createPulseRecord(source, 1, 0, 0x370101, REQUIRED_EFFECT_FLAGS)]
    }).accepted, 'Effect pending terminal stage failed');
    assert(backend.fixedUpdate(1 / 60, 1), 'Effect pending terminal first submit failed');
    const beforeFixedClose = backend.getEffectRuntimeStatus();
    assert(beforeFixedClose.pendingPulseProgramCount === 1
        && beforeFixedClose.pendingEffectReadbackCount === 1,
    'Effect pending terminal setup mismatch');
    const fixedClose = backend.cancelPendingFixedProgramsForTerminal({
        abiVersion: GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION,
        finalFixedTick: 2,
        destinationHandles: [],
        priorityControls: []
    });
    assert(fixedClose.state === 'armed', 'Fixed terminal close did not arm');
    const afterFixedClose = backend.getEffectRuntimeStatus();
    assert(afterFixedClose.pendingPulseProgramCount === 1
        && afterFixedClose.pendingEffectReadbackCount === 1,
    'Fixed terminal close retired Effect-owned lease');
    const effectClose = backend.cancelPendingEffectProgramsForTerminal({
        abiVersion: GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION,
        finalFixedTick: 2
    });
    assert(effectClose.state === 'armed'
        && effectClose.pulseProgramCount === 1
        && effectClose.pendingPulseProgramCount === 0
        && effectClose.pendingEffectReadbackCount === 0,
    'Effect terminal close did not exclusively retire pending pulse');
    assert(backend.fixedUpdate(1 / 60, 2), 'Effect pending terminal final submit failed');
    await device.queue.onSubmittedWorkDone();
    const terminal = backend.getEffectRuntimeStatus().terminal;
    assert(terminal.state === 'submitted'
        && terminal.finalFixedTick === 2
        && terminal.submittedTick === 2
        && terminal.pulseProgramCount === 1
        && terminal.pendingPulseProgramCount === 0
        && terminal.pendingEffectReadbackCount === 0,
    'Effect pending terminal evidence mismatch');
    backend.destroy();
    return terminal;
}

async function runEffectZeroBodySourceInvalidFixture(device, format) {
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: 2,
        effectCommandCapacity: 1,
        effectInstanceCapacity: 2,
        effectCandidateCapacity: 2,
        effectEventCapacity: 3,
        sessionGeneration: 38
    });
    backend.init(tileMap);
    const source = withIdentity(createGpuEnemySpawnIntent({
        definition: BASIC_PENTA_ENEMY_DATA,
        route,
        spawnSequence: 0
    }), 381, 1, { contactHandler: null });
    const target = withIdentity(createGpuEnemySpawnIntent({
        definition: BASIC_SQUARE_ENEMY_DATA,
        route,
        spawnSequence: 1
    }), 382, 1, { contactHandler: null });
    assert(backend.replaceBodies([source, target]).accepted === 2,
        'Effect zero-body replace failed');
    assert(backend.stageEffectPulseProgramBatch({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x380001,
        sourceTick: 1,
        records: [createPulseRecord(
            source,
            1,
            0,
            0x380101,
            REQUIRED_EFFECT_FLAGS
                | GPU_EFFECT_PULSE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID
        )]
    }).accepted, 'Effect zero-body authorized stage failed');
    assert(backend.despawnBodies([source, target]).removed === 2,
        'Effect zero-body lifecycle despawn failed');
    assert(backend.fixedUpdate(1 / 60, 1),
        'Effect zero-body staged completion submit was swallowed');
    const completion = await waitForEffectCompletion(backend, device);
    assert(completion.status === GPU_EFFECT_RUNTIME_STATUS.OK
        && completion.pulseResults.length === 1
        && completion.pulseResults[0].resultCode
            === GPU_EFFECT_PULSE_PROGRAM_RESULT.SOURCE_INVALID
        && completion.candidateCount === 0
        && completion.appliedInstanceCount === 0
        && completion.eventCount === 0,
    'Effect zero-body SOURCE_INVALID completion mismatch');
    const status = backend.getEffectRuntimeStatus();
    assert(status.pendingPulseProgramCount === 0
        && status.pendingEffectReadbackCount === 0,
    'Effect zero-body completion lease remained pending');
    backend.destroy();
    return Object.freeze({
        resultCode: completion.pulseResults[0].resultCode,
        pendingPulseProgramCount: status.pendingPulseProgramCount,
        pendingEffectReadbackCount: status.pendingEffectReadbackCount
    });
}

async function runProjectileAttackSnapshotFixture(device, format) {
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const worldBounds = tileMap.getWorldBounds();
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: 6,
        spawnProgramCapacity: 2,
        effectCommandCapacity: 2,
        effectInstanceCapacity: 8,
        effectCandidateCapacity: 8,
        effectEventCapacity: 10,
        sessionGeneration: 39
    });
    backend.init(tileMap);

    const pentaAIntent = createGpuEnemySpawnIntent({
        definition: BASIC_PENTA_ENEMY_DATA,
        route,
        spawnSequence: 0,
        laneOffsetTiles: 0
    });
    const pentaBIntent = createGpuEnemySpawnIntent({
        definition: BASIC_PENTA_ENEMY_DATA,
        route,
        spawnSequence: 1,
        laneOffsetTiles: 0.5
    });
    const archerIntent = createGpuEnemySpawnIntent({
        definition: ARCHER_ENEMY_DATA,
        route,
        spawnSequence: 2,
        laneOffsetTiles: 1
    });
    const origin = pentaAIntent.position;
    const towerPosition = Object.freeze({
        x: Math.min(worldBounds.width - 2, origin.x + 4),
        y: Math.min(worldBounds.height - 2, Math.max(2, origin.y))
    });
    const pentaA = withIdentity(pentaAIntent, 391, 1, {
        contactHandler: null,
        position: Object.freeze({ x: origin.x, y: origin.y })
    });
    const pentaB = withIdentity(pentaBIntent, 392, 1, {
        contactHandler: null,
        position: Object.freeze({ x: origin.x + 0.5, y: origin.y })
    });
    const archer = withIdentity(archerIntent, 393, 1, {
        contactHandler: null,
        position: Object.freeze({ x: origin.x + 1, y: origin.y })
    });
    const tower = withIdentity(createGpuTowerSpawnIntent({
        position: towerPosition
    }), 394, 1);
    assert(backend.replaceBodies([pentaA, pentaB, archer, tower]).accepted === 4,
        'Effect projectile snapshot replacement failed');

    const stage = backend.stageEffectPulseProgramBatch({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x390001,
        sourceTick: 1,
        records: [
            createPulseRecord(pentaA, 1, 0, 0x390101, REQUIRED_EFFECT_FLAGS),
            createPulseRecord(pentaB, 1, 0, 0x390102, REQUIRED_EFFECT_FLAGS)
        ]
    });
    assert(stage.accepted === true && stage.stagedCount === 2,
        'Effect projectile snapshot pulse stage failed');
    assert(backend.fixedUpdate(1 / 60, 1),
        'Effect projectile snapshot pulse submit failed');
    const effectCompletion = await waitForEffectCompletion(backend, device);
    assert(effectCompletion.appliedInstanceCount === 4,
        'Effect projectile snapshot stack materialization failed');
    const boostedSource = (await readEffectBodyPlanes(backend, device, 4)).summary(2);
    assert(boostedSource.boostStackCount === 2
        && Math.abs(boostedSource.attackMultiplier - 1.25) < 0.000001,
    'Effect projectile source stack2 attack multiplier mismatch');

    const captured = [];
    const captureEndpoint = Object.freeze({
        requestSourceRelativeSpawn(intent, targetFixedTick, commandId) {
            captured.push(Object.freeze({ intent, targetFixedTick, commandId }));
            return Object.freeze({ accepted: true, targetFixedTick, commandId });
        }
    });
    requestGpuProjectile({
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        endpoint: captureEndpoint,
        definition: HOSTILE_BASIC_BULLET_DATA,
        targetFixedTick: 2,
        spawnSequence: 0,
        sourceHandle: archer,
        ownerHandle: archer,
        targetHandle: tower,
        positionOffset: ARCHER_ATTACK_DATA.positionOffset,
        targetOffset: ARCHER_ATTACK_DATA.targetOffset,
        launchSpeed: ARCHER_ATTACK_DATA.launchSpeed,
        producerId: ARCHER_ATTACK_DATA.producerId,
        sourceAbilityId: ARCHER_ATTACK_DATA.sourceAbilityId,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        allegiancePolicy: ARCHER_ATTACK_DATA.allegiancePolicy,
        targetPolicyId: ARCHER_ATTACK_DATA.targetPolicyId
    });
    requestGpuProjectile({
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
        endpoint: captureEndpoint,
        definition: HOSTILE_BASIC_BULLET_DATA,
        targetFixedTick: 2,
        spawnSequence: 1,
        sourceHandle: archer,
        ownerHandle: archer,
        positionOffset: ARCHER_ATTACK_DATA.positionOffset,
        aimWorldPoint: towerPosition,
        launchSpeed: ARCHER_ATTACK_DATA.launchSpeed,
        producerId: ARCHER_ATTACK_DATA.producerId,
        sourceAbilityId: ARCHER_ATTACK_DATA.sourceAbilityId,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        allegiancePolicy: ARCHER_ATTACK_DATA.allegiancePolicy,
        targetPolicyId: ARCHER_ATTACK_DATA.targetPolicyId
    });
    assert(captured.length === 2
        && captured[0].intent.requestFlags
            === GPU_SPAWN_PROGRAM_REQUEST_FLAGS.TOWER_DAMAGE_CHANNEL
        && (captured[1].intent.requestFlags ?? 0) === 0,
    'Effect projectile Tower/non-Tower damage-channel authoring mismatch');

    const towerProjectileHandle = Object.freeze({ entityId: 395, incarnation: 1 });
    const untypedProjectileHandle = Object.freeze({ entityId: 396, incarnation: 1 });
    const spawnStage = backend.stageFixedPrograms({
        targetFixedTick: 2,
        controls: [],
        sourceRelativeSpawns: [
            { ...captured[0].intent, destinationHandle: towerProjectileHandle },
            { ...captured[1].intent, destinationHandle: untypedProjectileHandle }
        ]
    });
    assert(spawnStage.accepted === 2 && spawnStage.sourceRelativeSpawnCount === 2,
        `Effect projectile fixed stage failed: ${JSON.stringify(spawnStage)}`);
    assert(backend.fixedUpdate(1 / 60, 2),
        'Effect projectile source-resolve submit failed');
    const spawnCompletion = await waitForSpawnCompletion(backend, device);
    assert(spawnCompletion.failure === null
        && spawnCompletion.outcomes.length === 2,
    `Effect projectile source-resolve completion failed: ${JSON.stringify(spawnCompletion)}`);

    const resolvedPlanes = await readEffectBodyPlanes(backend, device, 6);
    const towerProjectile = resolvedPlanes.summary(4);
    const untypedProjectile = resolvedPlanes.summary(5);
    const expectedBoostedDamage = HOSTILE_BASIC_BULLET_DATA.damage * 1.25;
    assert(Math.abs(towerProjectile.resolvedBaseDamageOther - expectedBoostedDamage)
            < 0.000001
        && towerProjectile.sourceSnapshotTick === 2
        && (towerProjectile.flags
            & GPU_EFFECT_SUMMARY_FLAG.PROJECTILE_ATTACK_SNAPSHOT) !== 0,
    'Effect Tower projectile attack snapshot mismatch');
    assert(Math.abs(untypedProjectile.resolvedBaseDamageOther
            - HOSTILE_BASIC_BULLET_DATA.damage) < 0.000001
        && untypedProjectile.sourceSnapshotTick === 0
        && (untypedProjectile.flags
            & GPU_EFFECT_SUMMARY_FLAG.PROJECTILE_ATTACK_SNAPSHOT) === 0,
    'Effect non-Tower projectile damage was modified');

    assert(backend.fixedUpdate(1 / 60, 3),
        'Effect projectile snapshot persistence submit failed');
    await device.queue.onSubmittedWorkDone();
    const persistedPlanes = await readEffectBodyPlanes(backend, device, 6);
    assert(Math.abs(persistedPlanes.summary(4).resolvedBaseDamageOther
            - expectedBoostedDamage) < 0.000001
        && persistedPlanes.summary(4).sourceSnapshotTick === 2
        && (persistedPlanes.summary(4).flags
            & GPU_EFFECT_SUMMARY_FLAG.PROJECTILE_ATTACK_SNAPSHOT) !== 0,
    'Effect projectile immutable snapshot was cleared on the next tick');

    const beforeReplacementBodies = await backend.simulation.readbackBodies();
    const towerBeforeReplacement = beforeReplacementBodies.find(({ handle }) => (
        handle?.entityId === tower.entityId
            && handle?.incarnation === tower.incarnation
    ));
    assert(towerBeforeReplacement, 'Effect replacement Tower readback missing');
    const replacementTower = Object.freeze({
        ...tower,
        health: towerBeforeReplacement.health
    });
    assert(backend.replaceBodies([pentaA, pentaB, archer, replacementTower]).accepted === 4,
        'Effect transient world replacement failed');
    await device.queue.onSubmittedWorkDone();
    const resetPlanes = await readEffectBodyPlanes(backend, device, 4);
    const replacementBodies = await backend.simulation.readbackBodies();
    const towerAfterReplacement = replacementBodies.find(({ handle }) => (
        handle?.entityId === tower.entityId
            && handle?.incarnation === tower.incarnation
    ));
    assert(resetPlanes.summary(2).boostStackCount === 0
        && resetPlanes.summary(2).sourceSnapshotTick === 0
        && resetPlanes.summary(2).presentationTags === 0,
    'Effect transient state survived GPU-world replacement');
    assert(towerAfterReplacement
        && towerAfterReplacement.health === towerBeforeReplacement.health,
    'GPU-world replacement did not preserve authored Tower HP');

    backend.destroy();
    return Object.freeze({
        towerDamage: towerProjectile.resolvedBaseDamageOther,
        untypedDamage: untypedProjectile.resolvedBaseDamageOther,
        snapshotTick: towerProjectile.sourceSnapshotTick,
        persistedSnapshotTick: persistedPlanes.summary(4).sourceSnapshotTick,
        replacementTowerHealth: towerAfterReplacement.health,
        replacementBoostStackCount: resetPlanes.summary(2).boostStackCount
    });
}

async function runEffectPresentationPixelFixture(device, format) {
    const width = 128;
    const height = 128;
    const renderTexture = device.createTexture({
        label: 'cirvivor-nw-effect-offscreen-render-target',
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
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format, frameTarget)
    }, {
        capacity: 2,
        effectCommandCapacity: 1,
        effectInstanceCapacity: 2,
        effectCandidateCapacity: 2,
        effectEventCapacity: 3,
        sessionGeneration: 40
    });
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    backend.init(tileMap);
    const sourceIntent = createGpuEnemySpawnIntent({
        definition: BASIC_PENTA_ENEMY_DATA,
        route,
        spawnSequence: 0,
        laneOffsetTiles: 0
    });
    const targetIntent = createGpuEnemySpawnIntent({
        definition: BASIC_SQUARE_ENEMY_DATA,
        route,
        spawnSequence: 1,
        laneOffsetTiles: 0
    });
    const origin = sourceIntent.position;
    const source = withIdentity(sourceIntent, 401, 1, {
        contactHandler: null,
        position: Object.freeze({ x: origin.x, y: origin.y }),
        velocity: Object.freeze({ x: 0, y: 0 }),
        flowSpeed: 0,
        maxSpeed: 0
    });
    const target = withIdentity(targetIntent, 402, 1, {
        contactHandler: null,
        // west route의 첫 corridor는 column 0..5입니다. x + 3은 첫 blocked
        // column에 걸리므로 baseline 뒤 SDF solver가 body를 이동시킵니다.
        position: Object.freeze({ x: origin.x + 2, y: origin.y }),
        velocity: Object.freeze({ x: 0, y: 0 }),
        flowSpeed: 0,
        maxSpeed: 0
    });
    const targetTile = tileMap.worldToTile(target.position.x, target.position.y);
    assert(targetTile.inside
        && tileMap.isWalkableTile(targetTile.row, targetTile.column),
    'Effect offscreen target must start on a walkable tile');
    assert(backend.replaceBodies([source, target]).accepted === 2,
        'Effect offscreen presentation replacement failed');

    const scale = 20;
    const sourceCenter = Object.freeze({ x: 32, y: 64 });
    const targetCenter = Object.freeze({
        x: sourceCenter.x + ((target.position.x - origin.x) * scale),
        y: sourceCenter.y + ((target.position.y - origin.y) * scale)
    });
    const camera = Object.freeze({
        worldToViewport(x, y, out) {
            out.x = sourceCenter.x + ((x - origin.x) * scale);
            out.y = sourceCenter.y + ((y - origin.y) * scale);
            return out;
        },
        getScale: () => scale
    });
    let renderFrameId = 0;
    const render = async () => {
        renderFrameId++;
        backend.updatePresentation({
            frameDelta: 0,
            fixedDelta: 1 / 60,
            fixedAlpha: 1,
            renderFrameId
        });
        assert(backend.draw(camera), 'Effect offscreen presentation draw failed');
        await device.queue.onSubmittedWorkDone();
        return readRenderTexturePixels(device, renderTexture, width, height);
    };

    const baseline = await render();
    const baselineSourcePixels = countOpaquePixels(baseline, sourceCenter, 14);
    const baselineTargetPixel = readRenderPixel(
        baseline,
        targetCenter.x,
        targetCenter.y
    );
    assert(backend.stageEffectPulseProgramBatch({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x400001,
        sourceTick: 1,
        records: [createPulseRecord(
            source,
            1,
            0,
            0x400101,
            REQUIRED_EFFECT_FLAGS
        )]
    }).accepted, 'Effect offscreen presentation pulse stage failed');
    assert(backend.fixedUpdate(1 / 60, 1),
        'Effect offscreen presentation pulse submit failed');
    await waitForEffectCompletion(backend, device);
    const pulsed = await render();
    const pulsedSourcePixels = countOpaquePixels(pulsed, sourceCenter, 14);
    const boostedTargetPixel = readRenderPixel(
        pulsed,
        targetCenter.x,
        targetCenter.y
    );
    assert(pulsedSourcePixels > baselineSourcePixels,
        'Effect PULSE tag did not expand rendered source pixels');
    assert(JSON.stringify(boostedTargetPixel) !== JSON.stringify(baselineTargetPixel),
        'Effect BOOST tag did not change rendered target color');

    assert(backend.fixedUpdate(1 / 60, 2),
        'Effect offscreen pulse-clear submit failed');
    await device.queue.onSubmittedWorkDone();
    const pulseCleared = await render();
    assert(countOpaquePixels(pulseCleared, sourceCenter, 14) === baselineSourcePixels,
        'Effect PULSE visual survived its tick-local presentation interval');
    assert(JSON.stringify(readRenderPixel(
        pulseCleared,
        targetCenter.x,
        targetCenter.y
    )) === JSON.stringify(boostedTargetPixel),
    'Effect BOOST visual disappeared before expiry');

    await advanceFixedTicksWithReadbackYields(
        backend,
        device,
        3,
        180,
        'Effect offscreen lifetime'
    );
    const beforeExpiryPlanes = await readEffectBodyPlanes(backend, device, 2);
    const beforeExpirySummary = beforeExpiryPlanes.summary(1);
    assert(beforeExpirySummary.summaryTick === 180
        && beforeExpirySummary.boostStackCount === 1
        && (beforeExpirySummary.presentationTags
            & GPU_EFFECT_PRESENTATION_TAG.BOOST) !== 0,
    'Effect offscreen pre-expiry summary mismatch');

    assert(backend.fixedUpdate(1 / 60, 181),
        'Effect offscreen expiry submit failed');
    await device.queue.onSubmittedWorkDone();
    const expiredPlanes = await readEffectBodyPlanes(backend, device, 2);
    const expiredSummary = expiredPlanes.summary(1);
    assert(expiredSummary.summaryTick === 181
        && expiredSummary.boostStackCount === 0
        && (expiredSummary.presentationTags
            & GPU_EFFECT_PRESENTATION_TAG.BOOST) === 0,
    'Effect offscreen expired summary mismatch');
    const expired = await render();
    const expiredTargetPixel = readRenderPixel(
        expired,
        targetCenter.x,
        targetCenter.y
    );
    const expiredBodies = await backend.simulation.readbackBodies();
    const expiredTargetBody = expiredBodies.find(({ handle }) => (
        handle?.entityId === target.entityId
            && handle.incarnation === target.incarnation
    ));
    assert(expiredTargetBody, 'Effect offscreen expired target body missing');
    const expiryPixelEvidence = Object.freeze({
        baselineTargetPixel,
        boostedTargetPixel,
        expiredTargetPixel,
        sampledTargetCenter: targetCenter,
        authoredTargetPosition: target.position,
        targetRenderStyle: target.renderStyle,
        tick181Body: Object.freeze({
            position: expiredTargetBody.position,
            previousPosition: expiredTargetBody.previousPosition,
            predictedPosition: expiredTargetBody.predictedPosition,
            velocity: expiredTargetBody.velocity,
            radius: expiredTargetBody.radius,
            health: expiredTargetBody.health,
            healthFixedPoint: expiredTargetBody.healthFixedPoint,
            flowSpeed: expiredTargetBody.flowSpeed,
            simulationMeta: expiredTargetBody.simulationMeta
        })
    });
    assert(JSON.stringify(expiredTargetPixel) === JSON.stringify(baselineTargetPixel),
        `Effect BOOST visual did not disappear at half-open expiry: ${JSON.stringify(expiryPixelEvidence)}`);

    backend.destroy();
    renderTexture.destroy();
    return Object.freeze({
        baselineSourcePixels,
        pulsedSourcePixels,
        baselineTargetPixel,
        boostedTargetPixel,
        expiredTargetPixel,
        beforeExpirySummary,
        expiredSummary,
        expiryPixelEvidence
    });
}

async function runEffectBigBucketFixture(device, format) {
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const backend = new EnemySimulationBackend({
        webGpuPlatformPort: createPlatformPort(device, format)
    }, {
        capacity: 2,
        effectCommandCapacity: 1,
        effectInstanceCapacity: 2,
        effectCandidateCapacity: 2,
        effectEventCapacity: 3,
        sessionGeneration: 41
    });
    backend.init(tileMap);
    const sourceIntent = createGpuEnemySpawnIntent({
        definition: BASIC_PENTA_ENEMY_DATA,
        route,
        spawnSequence: 0
    });
    const targetIntent = createGpuEnemySpawnIntent({
        definition: BASIC_SQUARE_ENEMY_DATA,
        route,
        spawnSequence: 1
    });
    const source = withIdentity(sourceIntent, 411, 1, { contactHandler: null });
    const target = withIdentity(targetIntent, 412, 1, {
        contactHandler: null,
        position: Object.freeze({
            x: sourceIntent.position.x,
            y: sourceIntent.position.y + 3
        }),
        radius: 2,
        // 지름이 grid cell을 넘는 body는 3x3 dynamic 탐색에 들어갈 수
        // 없으며, multi-cell big bucket은 static proxy로만 유효합니다.
        inverseMass: 0
    });
    const targetTile = tileMap.worldToTile(target.position.x, target.position.y);
    assert(targetTile.inside
        && tileMap.isWalkableTile(targetTile.row, targetTile.column),
    'Effect big-bucket target must start on a walkable tile');
    const minimumGridCellSize = Math.min(
        backend.simulation.gridCellSize.x,
        backend.simulation.gridCellSize.y
    );
    assert(target.inverseMass === 0 && (target.radius * 2) > minimumGridCellSize,
        'Effect big-bucket target must be a static multi-cell body');
    assert(backend.replaceBodies([source, target]).accepted === 2,
        'Effect big-bucket replacement failed');
    assert(backend.stageEffectPulseProgramBatch({
        abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
        batchIdFingerprint: 0x410001,
        sourceTick: 1,
        records: [createPulseRecord(
            source,
            1,
            0,
            0x410101,
            REQUIRED_EFFECT_FLAGS
        )]
    }).accepted, 'Effect big-bucket stage failed');
    assert(backend.fixedUpdate(1 / 60, 1), 'Effect big-bucket submit failed');
    const completion = await waitForEffectCompletion(backend, device);
    assert(completion.candidateCount === 1
        && completion.appliedInstanceCount === 1
        && completion.eventCount === 2,
    `Effect big-bucket canonical dedupe failed: ${JSON.stringify(completion)}`);
    const summary = (await readEffectBodyPlanes(backend, device, 2)).summary(1);
    assert(summary.boostStackCount === 1,
        'Effect big-bucket target summary missing');
    backend.destroy();
    return Object.freeze({
        candidateCount: completion.candidateCount,
        appliedInstanceCount: completion.appliedInstanceCount,
        eventCount: completion.eventCount,
        boostStackCount: summary.boostStackCount,
        targetRadius: target.radius,
        targetInverseMass: target.inverseMass,
        minimumGridCellSize,
        targetTile
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
        assert(
            adapter.limits.maxStorageBuffersPerShaderStage
                >= REQUIRED_STORAGE_BUFFER_LIMIT,
            'WebGPU storage buffer limit below 9'
        );
        device = await adapter.requestDevice({
            requiredLimits: {
                maxStorageBuffersPerShaderStage: REQUIRED_STORAGE_BUFFER_LIMIT
            }
        });
        const uncapturedErrors = [];
        device.addEventListener('uncapturederror', (event) => {
            uncapturedErrors.push(event.error?.message ?? String(event.error));
        });
        result.productionEnemyPentagonEffect = await runPentagonEffectFixture(
            device,
            navigator.gpu.getPreferredCanvasFormat()
        );
        const format = navigator.gpu.getPreferredCanvasFormat();
        result.enemyPentagonEffectExtended = Object.freeze({
            instanceCapacityAtomicity: await runEffectCapacityAtomicityFixture(
                device,
                format,
                'instance'
            ),
            eventCapacityAtomicity: await runEffectCapacityAtomicityFixture(
                device,
                format,
                'event'
            ),
            noRevive: await runEffectNoReviveFixture(device, format),
            targetAbaReset: await runEffectAbaResetFixture(device, format),
            idleReleaseEpochReset: await runEffectIdleEpochFixture(device, format),
            pendingTerminalOwnership: await runEffectTerminalPendingFixture(
                device,
                format
            ),
            zeroBodySourceInvalid: await runEffectZeroBodySourceInvalidFixture(
                device,
                format
            ),
            projectileAttackSnapshot: await runProjectileAttackSnapshotFixture(
                device,
                format
            ),
            presentationPixels: await runEffectPresentationPixelFixture(
                device,
                format
            ),
            bigBucketCanonicalDedupe: await runEffectBigBucketFixture(
                device,
                format
            ),
            navigationOverflowFailClose: await runPentaOverflowFailCloseFixture(
                device,
                format
            )
        });
        await device.queue.onSubmittedWorkDone();
        result.uncapturedErrorCount = uncapturedErrors.length;
        assert(
            uncapturedErrors.length === 0,
            `uncaptured WebGPU error: ${uncapturedErrors.join(' | ')}`
        );
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
