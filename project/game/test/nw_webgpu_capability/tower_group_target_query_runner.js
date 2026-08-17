import {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_SIMULATION_FLAG,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM
} from './production/script/module/ingame/physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_FIXED_PRIMITIVE_ABI,
    GPU_SPAWN_PROGRAM_ABI_VERSION,
    GPU_SPAWN_PROGRAM_MODE,
    GPU_SPAWN_PROGRAM_REQUEST_FLAGS
} from './production/script/module/ingame/physics/gpu/gpu_fixed_primitive_abi.js';
import {
    GPU_TOWER_GROUP_MEMBER_FLAG,
    createGpuTowerGroupHostStorage,
    writeGpuTowerGroupRoster
} from './production/script/module/ingame/physics/gpu/gpu_tower_group_abi.js';
import {
    GPU_TOWER_TARGET_QUERY_ABI,
    GPU_TOWER_TARGET_QUERY_FLAG,
    readGpuTowerTargetQueryResult
} from './production/script/module/ingame/physics/gpu/gpu_tower_target_query_abi.js';
import {
    GpuTowerTargetQueryRuntime
} from './production/script/module/ingame/physics/gpu/gpu_tower_target_query_runtime.js';
import {
    GAMEPLAY_TEAM_ID
} from './production/script/module/ingame/contract/gameplay_team_contract.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const CAPACITY = 8;
const BODY_COUNT = 6;
const PROTOCOL = Object.freeze({
    sessionGeneration: 1,
    deviceGeneration: 1,
    authoritativeEpoch: 1
});

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function createBuffer(device, label, size, usage, bytes = null) {
    const buffer = device.createBuffer({ label, size, usage });
    if (bytes) device.queue.writeBuffer(buffer, 0, bytes);
    return buffer;
}

function writeBody(storage, slot, source) {
    const physicsOffset = slot * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE;
    const simulationOffset = slot * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
    storage.physics.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_X,
        source.x,
        true
    );
    storage.physics.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_Y,
        source.y,
        true
    );
    storage.physics.setUint32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INTERACTION_META,
        source.interactionLayer ?? 0,
        true
    );
    storage.simulation.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.GAMEPLAY_META,
        source.teamId,
        true
    );
    storage.simulation.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
        source.alive === false ? 0 : GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE,
        true
    );
    storage.simulation.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.ENTITY_ID,
        source.entityId,
        true
    );
    storage.simulation.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.INCARNATION,
        source.incarnation ?? 1,
        true
    );
}

function createRosterBytes(revision, sources) {
    const storage = createGpuTowerGroupHostStorage(CAPACITY);
    const roster = writeGpuTowerGroupRoster(storage, {
        protocol: PROTOCOL,
        groupRevision: revision,
        members: sources.map((source, rank) => ({
            slot: source.slot,
            entityId: source.entityId,
            incarnation: source.incarnation ?? 1,
            logicalTowerOrdinal: rank + 1,
            shareUnits: source.shareUnits,
            maxHpFixedPoint: 1000,
            powerFixedPoint: 100,
            flags: GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
                | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING
        }))
    });
    return { storage, roster };
}

function writeSpawnProgram(device, buffer, source = null) {
    const header = GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER;
    const record = GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD;
    const bytes = new ArrayBuffer(header.STRIDE + CAPACITY * record.STRIDE);
    const view = new DataView(bytes);
    view.setUint32(header.ABI_VERSION, GPU_SPAWN_PROGRAM_ABI_VERSION, true);
    view.setUint32(header.COUNT, source ? 1 : 0, true);
    view.setUint32(header.CAPACITY, CAPACITY, true);
    if (source) {
        const base = header.STRIDE;
        view.setUint32(base + record.SOURCE_SLOT, source.sourceSlot, true);
        view.setUint32(base + record.SOURCE_ENTITY_ID, source.sourceEntityId, true);
        view.setUint32(base + record.SOURCE_INCARNATION, 1, true);
        view.setUint32(base + record.TARGET_SLOT, source.targetSlot, true);
        view.setUint32(base + record.TARGET_ENTITY_ID, source.targetEntityId, true);
        view.setUint32(base + record.TARGET_INCARNATION, 1, true);
        view.setUint32(
            base + record.MODE_FLAGS,
            GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
            true
        );
        view.setUint32(
            base + record.REQUEST_FLAGS,
            GPU_SPAWN_PROGRAM_REQUEST_FLAGS.TOWER_DAMAGE_CHANNEL,
            true
        );
    }
    device.queue.writeBuffer(buffer, 0, bytes);
}

async function readBuffers(device, results, spawnProgram) {
    const resultBytes = CAPACITY * GPU_TOWER_TARGET_QUERY_ABI.RESULT.STRIDE;
    const spawnBytes = GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STRIDE
        + CAPACITY * GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.STRIDE;
    const resultReadback = createBuffer(
        device,
        'tower-target-query-result-readback',
        resultBytes,
        GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    );
    const spawnReadback = createBuffer(
        device,
        'tower-target-query-spawn-readback',
        spawnBytes,
        GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    );
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(results, 0, resultReadback, 0, resultBytes);
    encoder.copyBufferToBuffer(spawnProgram, 0, spawnReadback, 0, spawnBytes);
    device.queue.submit([encoder.finish()]);
    await Promise.all([
        resultReadback.mapAsync(GPUMapMode.READ),
        spawnReadback.mapAsync(GPUMapMode.READ)
    ]);
    const resultCopy = resultReadback.getMappedRange().slice(0);
    const spawnCopy = spawnReadback.getMappedRange().slice(0);
    resultReadback.unmap();
    spawnReadback.unmap();
    resultReadback.destroy();
    spawnReadback.destroy();
    return { resultCopy, spawnCopy };
}

async function encodeAndRead(runtime, device, tick, results, spawnProgram) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    runtime.encode(pass, tick);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    return readBuffers(device, results, spawnProgram);
}

async function runFixture(device) {
    const countsBytes = new ArrayBuffer(GPU_CIRCLE_BODY_ABI.COUNTS.STRIDE);
    const countsView = new DataView(countsBytes);
    countsView.setUint32(GPU_CIRCLE_BODY_ABI.COUNTS.BODY_COUNT, BODY_COUNT, true);
    countsView.setUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.ABI_VERSION,
        GPU_CIRCLE_BODY_ABI_VERSION,
        true
    );
    const physicsBytes = new ArrayBuffer(CAPACITY * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE);
    const simulationBytes = new ArrayBuffer(CAPACITY * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE);
    const storage = {
        physics: new DataView(physicsBytes),
        simulation: new DataView(simulationBytes)
    };
    writeBody(storage, 0, { x: 0, y: 0, entityId: 100, teamId: GAMEPLAY_TEAM_ID.HOSTILE });
    writeBody(storage, 1, { x: 10, y: 0, entityId: 101, teamId: GAMEPLAY_TEAM_ID.HOSTILE });
    writeBody(storage, 2, { x: 0, y: 5, entityId: 102, teamId: GAMEPLAY_TEAM_ID.HOSTILE });
    writeBody(storage, 3, {
        x: 2, y: 0, entityId: 30, teamId: GAMEPLAY_TEAM_ID.PLAYER,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
    });
    writeBody(storage, 4, {
        x: -2, y: 0, entityId: 20, teamId: GAMEPLAY_TEAM_ID.PLAYER,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
    });
    writeBody(storage, 5, {
        x: 1, y: 0, entityId: 50, teamId: GAMEPLAY_TEAM_ID.PLAYER,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
    });

    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        | GPUBufferUsage.COPY_SRC;
    const counts = createBuffer(device, 'query-counts', countsBytes.byteLength, usage, countsBytes);
    const physics = createBuffer(device, 'query-physics', physicsBytes.byteLength, usage, physicsBytes);
    const simulation = createBuffer(device, 'query-simulation', simulationBytes.byteLength, usage, simulationBytes);
    const behaviorBytes = new ArrayBuffer(
        CAPACITY * GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE
    );
    new DataView(behaviorBytes).setUint32(
        GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE,
        GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT,
        true
    );
    const enemyBehaviorStates = createBuffer(
        device, 'query-behaviors', behaviorBytes.byteLength, usage, behaviorBytes
    );
    const rosterSource = [
        { slot: 3, entityId: 30, shareUnits: 100 },
        { slot: 4, entityId: 20, shareUnits: 200 },
        { slot: 5, entityId: 50, shareUnits: 1 }
    ];
    const initial = createRosterBytes(7, rosterSource);
    const members = createBuffer(
        device, 'query-members', initial.storage.memberStates.byteLength,
        usage, initial.storage.memberStates
    );
    const roster = createBuffer(
        device, 'query-roster', initial.storage.roster.byteLength,
        usage, initial.storage.roster
    );
    const results = createBuffer(
        device, 'query-results',
        CAPACITY * GPU_TOWER_TARGET_QUERY_ABI.RESULT.STRIDE,
        usage
    );
    const compatibilityTarget = createBuffer(
        device, 'query-compatibility',
        GPU_FIXED_PRIMITIVE_ABI.TOWER_GAMEPLAY_TARGET_CONFIG.STRIDE,
        usage
    );
    const spawnProgram = createBuffer(
        device, 'query-spawn-program',
        GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STRIDE
            + CAPACITY * GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.STRIDE,
        usage
    );
    writeSpawnProgram(device, spawnProgram);

    const runtime = new GpuTowerTargetQueryRuntime({ capacity: CAPACITY });
    runtime.initialize(device, {
        counts,
        physics,
        simulation,
        enemyBehaviorStates,
        members,
        roster,
        results,
        compatibilityTarget,
        spawnProgram
    }, PROTOCOL);

    const first = await encodeAndRead(runtime, device, 1, results, spawnProgram);
    const nearest = readGpuTowerTargetQueryResult(first.resultCopy, 0);
    const octagon = readGpuTowerTargetQueryResult(first.resultCopy, 1);
    assert(nearest.targetEntityId === 50, `nearest mismatch: ${JSON.stringify(nearest)}`);
    assert(octagon.targetEntityId === 20, `O identity mismatch: ${JSON.stringify(octagon)}`);

    storage.physics.setFloat32(
        5 * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE,
        20,
        true
    );
    device.queue.writeBuffer(physics, 0, physicsBytes);
    const second = await encodeAndRead(runtime, device, 2, results, spawnProgram);
    const shareTie = readGpuTowerTargetQueryResult(second.resultCopy, 0);
    assert(shareTie.targetEntityId === 20, `share tie mismatch: ${JSON.stringify(shareTie)}`);

    const revised = createRosterBytes(8, [
        { slot: 3, entityId: 30, shareUnits: 200 },
        { slot: 4, entityId: 20, shareUnits: 200 }
    ]);
    device.queue.writeBuffer(members, 0, revised.storage.memberStates);
    device.queue.writeBuffer(roster, 0, revised.storage.roster);
    const third = await encodeAndRead(runtime, device, 3, results, spawnProgram);
    const revision = readGpuTowerTargetQueryResult(third.resultCopy, 0);
    assert(revision.targetEntityId === 20, `identity tie mismatch: ${JSON.stringify(revision)}`);
    assert((revision.flags & GPU_TOWER_TARGET_QUERY_FLAG.ROSTER_CHANGED) !== 0,
        `revision flag missing: ${JSON.stringify(revision)}`);

    storage.simulation.setUint32(
        4 * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE
            + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
        0,
        true
    );
    device.queue.writeBuffer(simulation, 0, simulationBytes);
    const fourth = await encodeAndRead(runtime, device, 4, results, spawnProgram);
    const death = readGpuTowerTargetQueryResult(fourth.resultCopy, 0);
    assert(death.targetEntityId === 30, `death retarget mismatch: ${JSON.stringify(death)}`);
    assert((death.flags & GPU_TOWER_TARGET_QUERY_FLAG.ROSTER_CHANGED) === 0,
        `death must not invent revision: ${JSON.stringify(death)}`);

    const empty = createRosterBytes(9, []);
    device.queue.writeBuffer(members, 0, empty.storage.memberStates);
    device.queue.writeBuffer(roster, 0, empty.storage.roster);
    const fifth = await encodeAndRead(runtime, device, 5, results, spawnProgram);
    const zero = readGpuTowerTargetQueryResult(fifth.resultCopy, 0);
    assert(zero.valid === false, `zero roster fallback mismatch: ${JSON.stringify(zero)}`);

    // Archer record의 authored target은 30이지만 valid roster nearest 50으로 교체됩니다.
    storage.simulation.setUint32(
        4 * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE
            + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
        GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE,
        true
    );
    device.queue.writeBuffer(simulation, 0, simulationBytes);
    device.queue.writeBuffer(members, 0, initial.storage.memberStates);
    device.queue.writeBuffer(roster, 0, initial.storage.roster);
    storage.physics.setFloat32(5 * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE, 1, true);
    device.queue.writeBuffer(physics, 0, physicsBytes);
    writeSpawnProgram(device, spawnProgram, {
        sourceSlot: 0,
        sourceEntityId: 100,
        targetSlot: 3,
        targetEntityId: 30
    });
    const sixth = await encodeAndRead(runtime, device, 6, results, spawnProgram);
    const spawnView = new DataView(sixth.spawnCopy);
    const spawnBase = GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STRIDE;
    const rewrittenEntity = spawnView.getUint32(
        spawnBase + GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.TARGET_ENTITY_ID,
        true
    );
    assert(rewrittenEntity === 50, `Archer rewrite mismatch: ${rewrittenEntity}`);

    const evidence = Object.freeze({
        nearestEntityId: nearest.targetEntityId,
        octagonIdentityEntityId: octagon.targetEntityId,
        shareTieEntityId: shareTie.targetEntityId,
        revisionEntityId: revision.targetEntityId,
        revisionChanged: (revision.flags
            & GPU_TOWER_TARGET_QUERY_FLAG.ROSTER_CHANGED) !== 0,
        deathRetargetEntityId: death.targetEntityId,
        deathInventedRevision: (death.flags
            & GPU_TOWER_TARGET_QUERY_FLAG.ROSTER_CHANGED) !== 0,
        zeroRosterValid: zero.valid,
        archerRewrittenEntityId: rewrittenEntity,
        resultStride: GPU_TOWER_TARGET_QUERY_ABI.RESULT.STRIDE,
        storageMaximum: runtime.getStatus().storageBuffersPerStage,
        noCpuRosterOrPoseReadback:
            runtime.getStatus().noCpuRosterOrPoseReadback
    });
    runtime.destroy();
    for (const buffer of [
        counts, physics, simulation, enemyBehaviorStates, members, roster,
        results, compatibilityTarget, spawnProgram
    ]) buffer.destroy();
    return evidence;
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
        assert(adapter.limits.maxStorageBuffersPerShaderStage >= 9,
            'WebGPU storage buffer limit below 9');
        result.adapterMaxStorageBuffersPerShaderStage
            = adapter.limits.maxStorageBuffersPerShaderStage;
        result.requestedMaxStorageBuffersPerShaderStage = 9;
        device = await adapter.requestDevice({
            requiredLimits: { maxStorageBuffersPerShaderStage: 9 }
        });
        result.deviceMaxStorageBuffersPerShaderStage
            = device.limits.maxStorageBuffersPerShaderStage;
        const uncapturedErrors = [];
        device.addEventListener('uncapturederror', (event) => {
            uncapturedErrors.push(event.error?.message ?? String(event.error));
        });
        result.towerGroupTargetQuery = await runFixture(device);
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
