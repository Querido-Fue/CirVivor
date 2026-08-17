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
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI,
    writeGpuAbilityEntityMetadata
} from './production/script/module/ingame/physics/gpu/gpu_ability_subject_snapshot_abi.js';
import {
    GpuAbilitySubjectSnapshotRuntime
} from './production/script/module/ingame/physics/gpu/gpu_ability_subject_snapshot_runtime.js';
import {
    GPU_TOWER_GROUP_ABI,
    GPU_TOWER_GROUP_MEMBER_FLAG,
    createGpuTowerGroupHostStorage,
    writeGpuTowerGroupRoster
} from './production/script/module/ingame/physics/gpu/gpu_tower_group_abi.js';
import {
    GpuTowerGroupRuntime
} from './production/script/module/ingame/physics/gpu/gpu_tower_group_runtime.js';
import {
    GPU_TOWER_CREATION_RECORD_KIND,
    fingerprintGpuTowerCreationTransaction
} from './production/script/module/ingame/physics/gpu/gpu_tower_creation_abi.js';
import {
    GpuTowerCreationRuntime
} from './production/script/module/ingame/physics/gpu/gpu_tower_creation_runtime.js';
import {
    GPU_TOWER_TARGET_QUERY_ABI,
    GPU_TOWER_TARGET_QUERY_FLAG,
    readGpuTowerTargetQueryResult
} from './production/script/module/ingame/physics/gpu/gpu_tower_target_query_abi.js';
import {
    GpuTowerTargetQueryRuntime
} from './production/script/module/ingame/physics/gpu/gpu_tower_target_query_runtime.js';
import {
    ABILITY_CREATION_ORIGIN_CODE,
    ABILITY_SUBJECT_SNAPSHOT_STATUS,
    createAbilityEntityMetadata
} from './production/script/module/ingame/contract/ability_execution_contract.js';
import {
    ACTOR_PAYLOAD_CODE,
    ABILITY_TARGET_POLICY_CODE,
    GAMEPLAY_NOUN_MASK,
    SENTENCE_ACTION_CODE,
    SUBJECT_SELECTOR_CODE
} from './production/script/module/ingame/contract/word_sentence_contract.js';
import {
    GAMEPLAY_TEAM_ID
} from './production/script/module/ingame/contract/gameplay_team_contract.js';
import {
    GPU_ROUTE_RUNTIME_ABI
} from './production/script/module/ingame/physics/gpu/gpu_route_runtime_abi.js';
import {
    TOWER_COMBAT_FACT_TYPE,
    TOWER_CREATION_RESULT,
    TOWER_SHARE_SCALE,
    TowerGroupState
} from './production/script/module/ingame/object/tower/tower_group_state.js';

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

async function readGpuBuffer(device, source, byteLength, label) {
    const readback = createBuffer(
        device,
        label,
        byteLength,
        GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    );
    try {
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(source, 0, readback, 0, byteLength);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        return readback.getMappedRange().slice(0);
    } finally {
        try { readback.unmap(); } catch { /* not mapped */ }
        readback.destroy();
    }
}

async function waitForTowerSummary(runtime, device) {
    await device.queue.onSubmittedWorkDone();
    for (let attempt = 0; attempt < 30; attempt++) {
        const summary = runtime.getLatestSummary();
        if (summary.valid) return summary;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(
        `TowerGroup summary timeout: ${JSON.stringify(runtime.getStatus())}`
    );
}

async function runTowerGroupControlCase(device, count, sourceTick) {
    const usage = GPUBufferUsage.STORAGE
        | GPUBufferUsage.COPY_DST
        | GPUBufferUsage.COPY_SRC;
    const countsBytes = new ArrayBuffer(GPU_CIRCLE_BODY_ABI.COUNTS.STRIDE);
    const physicsBytes = new ArrayBuffer(
        count * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE
    );
    const simulationBytes = new ArrayBuffer(
        count * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE
    );
    const controlByteLength = count
        * GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_STATE.STRIDE;
    const countsView = new DataView(countsBytes);
    const physicsView = new DataView(physicsBytes);
    const simulationView = new DataView(simulationBytes);
    countsView.setUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.BODY_COUNT,
        count,
        true
    );
    countsView.setUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.ABI_VERSION,
        GPU_CIRCLE_BODY_ABI_VERSION,
        true
    );

    const shareFloor = Math.floor(1_000_000_000 / count);
    const shareRemainder = 1_000_000_000 - (shareFloor * count);
    const maxHpFloor = Math.floor(3_000 / count);
    const maxHpRemainder = 3_000 - (maxHpFloor * count);
    const powerFloor = Math.floor(1_000 / count);
    const powerRemainder = 1_000 - (powerFloor * count);
    const members = [];
    for (let index = 0; index < count; index++) {
        const physicsOffset = index * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE;
        const simulationOffset = index
            * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
        physicsView.setFloat32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_X,
            index * 0.25,
            true
        );
        physicsView.setFloat32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_Y,
            index * -0.125,
            true
        );
        physicsView.setFloat32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.RADIUS,
            0.5,
            true
        );
        physicsView.setUint32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INTERACTION_META,
            GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE,
            true
        );
        simulationView.setUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.GAMEPLAY_META,
            GAMEPLAY_TEAM_ID.PLAYER,
            true
        );
        simulationView.setUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
            GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE,
            true
        );
        simulationView.setUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.ENTITY_ID,
            5_000 + index,
            true
        );
        simulationView.setUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.INCARNATION,
            3,
            true
        );
        members.push({
            slot: index,
            entityId: 5_000 + index,
            incarnation: 3,
            logicalTowerOrdinal: index + 1,
            shareUnits: shareFloor + (index < shareRemainder ? 1 : 0),
            maxHpFixedPoint: maxHpFloor + (index < maxHpRemainder ? 1 : 0),
            powerFixedPoint: powerFloor + (index < powerRemainder ? 1 : 0),
            flags: GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
                | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING
        });
    }

    const resources = {
        counts: createBuffer(device, `group-${count}-counts`, 16, usage, countsBytes),
        physics: createBuffer(
            device,
            `group-${count}-physics`,
            physicsBytes.byteLength,
            usage,
            physicsBytes
        ),
        simulation: createBuffer(
            device,
            `group-${count}-simulation`,
            simulationBytes.byteLength,
            usage,
            simulationBytes
        ),
        bodyControlStates: createBuffer(
            device,
            `group-${count}-body-control`,
            controlByteLength,
            usage
        )
    };
    const runtime = new GpuTowerGroupRuntime({
        capacity: count,
        readbackSlotCount: 2
    });
    try {
        runtime.initialize(device, resources, PROTOCOL);
        runtime.synchronizeRoster({
            protocol: PROTOCOL,
            groupRevision: 1,
            members
        });
        runtime.stageCommand({
            protocol: PROTOCOL,
            sourceTick,
            moveIntent: { x: 0.6, y: -0.8 },
            aimWorldPoint: { x: 91, y: -37 }
        });
        const encoder = device.createCommandEncoder({
            label: `group-${count}-control-encoder`
        });
        const pass = encoder.beginComputePass({
            label: `group-${count}-control-pass`
        });
        runtime.encodeControl(pass, sourceTick);
        pass.end();
        device.queue.submit([encoder.finish()]);
        assert(runtime.submitSummary({ sourceTick }) === true,
            `group ${count} summary submission rejected`);

        const controlCopy = await readGpuBuffer(
            device,
            resources.bodyControlStates,
            controlByteLength,
            `group-${count}-control-readback`
        );
        const controlView = new DataView(controlCopy);
        const controlAbi = GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_STATE;
        const expectedMoveX = Math.fround(0.6);
        const expectedMoveY = Math.fround(-0.8);
        for (let index = 0; index < count; index++) {
            const offset = index * controlAbi.STRIDE;
            assert(
                controlView.getFloat32(offset + controlAbi.MOVE_INTENT_X, true)
                    === expectedMoveX,
                `group ${count} move x mismatch at ${index}`
            );
            assert(
                controlView.getFloat32(offset + controlAbi.MOVE_INTENT_Y, true)
                    === expectedMoveY,
                `group ${count} move y mismatch at ${index}`
            );
            assert(
                controlView.getUint32(offset + controlAbi.ENTITY_ID, true)
                    === 5_000 + index,
                `group ${count} entity mismatch at ${index}`
            );
            assert(
                controlView.getUint32(offset + controlAbi.INCARNATION, true)
                    === 3,
                `group ${count} incarnation mismatch at ${index}`
            );
        }

        const summary = await waitForTowerSummary(runtime, device);
        const expectedCentroidX = (count - 1) * 0.125;
        const expectedCentroidY = (count - 1) * -0.0625;
        assert(summary.livingCount === count,
            `group ${count} summary living mismatch: ${summary.livingCount}`);
        assert(summary.livingShareUnits === 1_000_000_000,
            `group ${count} summary share mismatch: ${summary.livingShareUnits}`);
        assert(summary.excludedMemberCount === 0,
            `group ${count} summary excluded: ${summary.excludedMemberCount}`);
        assert(summary.primaryHandle?.entityId === 5_000,
            `group ${count} primary mismatch: ${JSON.stringify(summary)}`);
        assert(Math.abs(summary.centroid.x - expectedCentroidX) < 0.02,
            `group ${count} centroid x mismatch: ${summary.centroid.x}`);
        assert(Math.abs(summary.centroid.y - expectedCentroidY) < 0.02,
            `group ${count} centroid y mismatch: ${summary.centroid.y}`);

        const status = runtime.getStatus();
        assert(status.groupCommandCount === 1,
            `group ${count} command count: ${status.groupCommandCount}`);
        assert(status.perTowerCpuCommandCount === 0,
            `group ${count} per-Tower CPU command detected`);
        assert(status.fullBodyReadbackCount === 0,
            `group ${count} full-body readback detected`);
        assert(status.storageProfile.maximumStorageBuffersPerStage <= 9,
            `group ${count} storage profile exceeded`);
        return Object.freeze({
            towerCount: count,
            groupCommandCount: status.groupCommandCount,
            perTowerCpuCommandCount: status.perTowerCpuCommandCount,
            fullBodyReadbackCount: status.fullBodyReadbackCount,
            summaryReadbackBytes: status.summaryReadbackBytes,
            summaryRingDrops: status.droppedSummaryCount,
            storageMaximum:
                status.storageProfile.maximumStorageBuffersPerStage,
            livingCount: summary.livingCount,
            livingShareUnits: summary.livingShareUnits,
            excludedMemberCount: summary.excludedMemberCount,
            primaryEntityId: summary.primaryHandle.entityId,
            centroid: summary.centroid
        });
    } finally {
        runtime.destroy();
        for (const buffer of Object.values(resources)) buffer.destroy();
    }
}

async function runTowerGroupControlFixture(device) {
    const group256 = await runTowerGroupControlCase(device, 256, 101);
    const group1000 = await runTowerGroupControlCase(device, 1_000, 102);
    return Object.freeze({
        group256,
        group1000,
        capacityPermits1000: true
    });
}

function createRecoveryGroupResources(
    device,
    label,
    entityBase,
    positionBase
) {
    const count = 2;
    const usage = GPUBufferUsage.STORAGE
        | GPUBufferUsage.COPY_DST
        | GPUBufferUsage.COPY_SRC;
    const countsBytes = new ArrayBuffer(GPU_CIRCLE_BODY_ABI.COUNTS.STRIDE);
    const physicsBytes = new ArrayBuffer(
        count * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE
    );
    const simulationBytes = new ArrayBuffer(
        count * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE
    );
    const countsView = new DataView(countsBytes);
    const physicsView = new DataView(physicsBytes);
    const simulationView = new DataView(simulationBytes);
    countsView.setUint32(GPU_CIRCLE_BODY_ABI.COUNTS.BODY_COUNT, count, true);
    countsView.setUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.ABI_VERSION,
        GPU_CIRCLE_BODY_ABI_VERSION,
        true
    );
    const members = [];
    for (let slot = 0; slot < count; slot++) {
        const physicsOffset = slot * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE;
        const simulationOffset = slot
            * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
        physicsView.setFloat32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_X,
            positionBase + (slot * 2),
            true
        );
        physicsView.setFloat32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_Y,
            positionBase - slot,
            true
        );
        physicsView.setFloat32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.RADIUS,
            0.5,
            true
        );
        physicsView.setUint32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INTERACTION_META,
            GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE,
            true
        );
        simulationView.setUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.GAMEPLAY_META,
            GAMEPLAY_TEAM_ID.PLAYER,
            true
        );
        simulationView.setUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
            GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE,
            true
        );
        simulationView.setUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.ENTITY_ID,
            entityBase + slot,
            true
        );
        simulationView.setUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.INCARNATION,
            7,
            true
        );
        members.push({
            slot,
            entityId: entityBase + slot,
            incarnation: 7,
            logicalTowerOrdinal: slot + 1,
            shareUnits: 500_000_000,
            maxHpFixedPoint: 1_500,
            powerFixedPoint: 500,
            flags: GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
                | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING
        });
    }
    return {
        members,
        resources: {
            counts: createBuffer(
                device, `${label}-counts`, countsBytes.byteLength, usage, countsBytes
            ),
            physics: createBuffer(
                device,
                `${label}-physics`,
                physicsBytes.byteLength,
                usage,
                physicsBytes
            ),
            simulation: createBuffer(
                device,
                `${label}-simulation`,
                simulationBytes.byteLength,
                usage,
                simulationBytes
            ),
            bodyControlStates: createBuffer(
                device,
                `${label}-body-control`,
                count * GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_STATE.STRIDE,
                usage
            )
        }
    };
}

function submitTowerGroupControl(runtime, device, sourceTick, label) {
    const encoder = device.createCommandEncoder({
        label: `${label}-control-encoder`
    });
    const pass = encoder.beginComputePass({
        label: `${label}-control-pass`
    });
    runtime.encodeControl(pass, sourceTick);
    pass.end();
    device.queue.submit([encoder.finish()]);
    assert(runtime.submitSummary({ sourceTick }) === true,
        `${label} summary submission failed`);
}

async function runTowerGroupRecoveryFixture(device) {
    const nextProtocol = Object.freeze({
        sessionGeneration: PROTOCOL.sessionGeneration,
        deviceGeneration: PROTOCOL.deviceGeneration + 1,
        authoritativeEpoch: PROTOCOL.authoritativeEpoch + 1
    });
    const oldWorld = createRecoveryGroupResources(
        device,
        'recovery-old-world',
        70_000,
        -10
    );
    const newWorld = createRecoveryGroupResources(
        device,
        'recovery-new-world',
        80_000,
        20
    );
    const runtime = new GpuTowerGroupRuntime({
        capacity: 2,
        readbackSlotCount: 1
    });
    try {
        runtime.initialize(device, oldWorld.resources, PROTOCOL);
        runtime.synchronizeRoster({
            protocol: PROTOCOL,
            groupRevision: 5,
            members: oldWorld.members
        });
        runtime.stageCommand({
            protocol: PROTOCOL,
            sourceTick: 201,
            moveIntent: { x: 1, y: 0 },
            aimWorldPoint: { x: -4, y: 3 }
        });
        submitTowerGroupControl(runtime, device, 201, 'recovery-old-world');

        // Old summary map callback이 살아 있는 동안 generation/resources를 교체합니다.
        runtime.initialize(device, newWorld.resources, nextProtocol);
        runtime.synchronizeRoster({
            protocol: nextProtocol,
            groupRevision: 5,
            members: newWorld.members
        });
        runtime.stageCommand({
            protocol: nextProtocol,
            sourceTick: 202,
            moveIntent: { x: 0.25, y: 0.5 },
            aimWorldPoint: { x: 33, y: -12 }
        });
        submitTowerGroupControl(runtime, device, 202, 'recovery-new-world');

        const controlCopy = await readGpuBuffer(
            device,
            newWorld.resources.bodyControlStates,
            2 * GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_STATE.STRIDE,
            'recovery-new-world-control-readback'
        );
        const controlView = new DataView(controlCopy);
        const controlAbi = GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_STATE;
        for (let slot = 0; slot < 2; slot++) {
            const offset = slot * controlAbi.STRIDE;
            assert(controlView.getUint32(
                offset + controlAbi.ENTITY_ID,
                true
            ) === 80_000 + slot, `recovery rebind identity mismatch at ${slot}`);
            assert(controlView.getFloat32(
                offset + controlAbi.MOVE_INTENT_X,
                true
            ) === Math.fround(0.25), `recovery held move x mismatch at ${slot}`);
            assert(controlView.getFloat32(
                offset + controlAbi.MOVE_INTENT_Y,
                true
            ) === Math.fround(0.5), `recovery held move y mismatch at ${slot}`);
        }
        const summary = await waitForTowerSummary(runtime, device);
        assert(summary.deviceGeneration === nextProtocol.deviceGeneration,
            `recovery summary generation mismatch: ${JSON.stringify(summary)}`);
        assert(summary.authoritativeEpoch === nextProtocol.authoritativeEpoch,
            `recovery summary epoch mismatch: ${JSON.stringify(summary)}`);
        assert(summary.primaryHandle?.entityId === 80_000,
            `recovery summary primary mismatch: ${JSON.stringify(summary)}`);
        for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const afterOldCallback = runtime.getLatestSummary();
        const status = runtime.getStatus();
        assert(afterOldCallback.sourceTick === 202,
            `old callback replaced current summary: ${JSON.stringify(afterOldCallback)}`);
        assert(afterOldCallback.primaryHandle?.entityId === 80_000,
            'old callback replaced rebound primary');
        assert(status.readbackFailureCount === 0,
            `recovery readback failure: ${JSON.stringify(status.failure)}`);
        assert(status.hardFailureStatus === 0,
            `recovery hard failure status: ${status.hardFailureStatus}`);
        assert(status.pendingReadbacks === 0,
            `recovery pending readback leak: ${status.pendingReadbacks}`);
        return Object.freeze({
            oldDeviceGeneration: PROTOCOL.deviceGeneration,
            newDeviceGeneration: nextProtocol.deviceGeneration,
            oldAuthoritativeEpoch: PROTOCOL.authoritativeEpoch,
            newAuthoritativeEpoch: nextProtocol.authoritativeEpoch,
            reboundTowerCount: 2,
            heldMoveRestaged: true,
            latestSourceTick: afterOldCallback.sourceTick,
            latestPrimaryEntityId: afterOldCallback.primaryHandle.entityId,
            oldCallbackIsolated: true,
            readbackFailureCount: status.readbackFailureCount,
            protocolFailureCount: status.hardFailureStatus === 0 ? 0 : 1,
            recoveryFailureCount: runtime.requiresRecovery() ? 1 : 0,
            pendingReadbackCount: status.pendingReadbacks,
            storageMaximum:
                status.storageProfile.maximumStorageBuffersPerStage,
            fullBodyReadbackCount: status.fullBodyReadbackCount
        });
    } finally {
        runtime.destroy();
        for (const fixture of [oldWorld, newWorld]) {
            for (const buffer of Object.values(fixture.resources)) {
                buffer.destroy();
            }
        }
    }
}

function createTowerDamageEvent(handle, sourceTick, damageFixedPoint, key) {
    return {
        type: 'contact',
        eventType: 'damage-applied',
        disposition: 'applied',
        entityId: 90_000 + sourceTick,
        incarnation: 1,
        other: { entityId: handle.entityId, incarnation: handle.incarnation },
        ...PROTOCOL,
        sourceTick,
        sequence: 0,
        key,
        damageFixedPoint,
        reason: null
    };
}

function createTowerDeathEvent(handle, sourceTick, key) {
    return {
        type: 'death',
        eventType: 'death',
        disposition: 'despawn-requested',
        entityId: handle.entityId,
        incarnation: handle.incarnation,
        ...PROTOCOL,
        sourceTick,
        sequence: 0,
        key,
        reason: 'health-depleted',
        reasonFlags: 0
    };
}

function toTowerMember(record, handle, slot) {
    return {
        slot,
        entityId: handle.entityId,
        incarnation: handle.incarnation,
        logicalTowerOrdinal: record.logicalTowerOrdinal,
        shareUnits: record.shareUnits,
        maxHpFixedPoint: record.maxHpFixedPoint,
        powerFixedPoint: record.powerFixedPoint,
        flags: GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
            | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING
    };
}

async function waitForCreationCompletion(runtime, device, label) {
    await device.queue.onSubmittedWorkDone();
    for (let attempt = 0; attempt < 40; attempt++) {
        const completed = runtime.drainCompleted([]);
        if (completed.length > 0) return completed[0];
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(
        `${label} creation completion timeout: ${JSON.stringify(runtime.getStatus())}`
    );
}

async function waitForSubjectCompletion(runtime, device, label) {
    await device.queue.onSubmittedWorkDone();
    for (let attempt = 0; attempt < 40; attempt++) {
        const completed = runtime.drainCompleted([]);
        if (completed.length > 0) return completed[0];
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(
        `${label} subject completion timeout: ${JSON.stringify(runtime.getStatus())}`
    );
}

async function runR3TowerSubjectAfterSplit(
    device,
    resources,
    records,
    handlesByLogicalId,
    label
) {
    const usage = GPUBufferUsage.STORAGE
        | GPUBufferUsage.COPY_DST
        | GPUBufferUsage.COPY_SRC;
    const capacity = records.length;
    const sideBuffers = {
        contactHandlers: createBuffer(
            device,
            `${label}-subject-contacts`,
            capacity * GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE,
            usage
        ),
        enemyBehaviorStates: createBuffer(
            device,
            `${label}-subject-behaviors`,
            capacity * GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE,
            usage
        ),
        routeRuntimeStates: createBuffer(
            device,
            `${label}-subject-routes`,
            capacity * GPU_ROUTE_RUNTIME_ABI.BODY_STATE.STRIDE,
            usage
        )
    };
    const runtime = new GpuAbilitySubjectSnapshotRuntime({
        capacity,
        sessionGeneration: PROTOCOL.sessionGeneration,
        commandCapacity: 2,
        subjectCapacity: 1_000,
        readbackSlotCount: 2
    });
    try {
        runtime.initialize(device, {
            counts: resources.counts,
            physics: resources.physics,
            simulation: resources.simulation,
            ...sideBuffers
        }, PROTOCOL);
        const metadataEntries = records.map((record, slot) => {
            const handle = handlesByLogicalId.get(record.logicalTowerId);
            return {
                slot,
                metadata: createAbilityEntityMetadata({
                    entityId: handle.entityId,
                    incarnation: handle.incarnation,
                    kindId: 'tower',
                    definitionId: 'tower.player.v1',
                    createdAtTick: 1,
                    metadata: { powerFixedPoint: record.powerFixedPoint }
                }, {
                    nounMask: GAMEPLAY_NOUN_MASK.TOWER,
                    creationOriginCode: ABILITY_CREATION_ORIGIN_CODE.NATURAL,
                    powerFixedPoint: record.powerFixedPoint
                })
            };
        });
        const synchronized = runtime.synchronizeEntityMetadata(metadataEntries);
        assert(synchronized.accepted === true,
            `${label} ability metadata synchronization failed`);

        const compiledAbility = Object.freeze({
            compiledAbilityId: 'r3.tower-shoots-enemy.actual-split',
            schemaVersion: 1,
            protocolVersion: 'r3',
            subjectSelector: Object.freeze({
                code: SUBJECT_SELECTOR_CODE.TOWER,
                nounMask: GAMEPLAY_NOUN_MASK.TOWER,
                teamId: GAMEPLAY_TEAM_ID.PLAYER
            }),
            actionCode: SENTENCE_ACTION_CODE.SHOOT,
            payloadCode: ACTOR_PAYLOAD_CODE.ENEMY,
            targetPolicyCode: ABILITY_TARGET_POLICY_CODE.SHARED_AIM_POINT,
            budgets: Object.freeze({ subjectCount: 1_000, generation: 65_535 })
        });
        const staged = runtime.stageExecution({
            compiledAbility,
            executionId: `${label}-r3-q`,
            executionOrdinal: 1,
            targetFixedTick: 301,
            aimPoint: { x: 4, y: -2 }
        });
        assert(staged.accepted === true,
            `${label} R3 Q subject stage failed: ${JSON.stringify(staged)}`);
        const submitted = runtime.submitPendingForFixedTick(301);
        assert(submitted.submittedCount === 1,
            `${label} R3 Q subject submit failed: ${JSON.stringify(submitted)}`);
        const completion = await waitForSubjectCompletion(runtime, device, label);
        assert(completion.status === ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE,
            `${label} R3 Q subject status: ${JSON.stringify(completion)}`);
        assert(completion.subjectCount === records.length,
            `${label} R3 Q subject count: ${completion.subjectCount}`);
        assert(completion.capacityDemand === records.length,
            `${label} R3 Q capacity demand: ${completion.capacityDemand}`);
        const binding = runtime.getSnapshotGpuBinding(completion.snapshotToken);
        assert(binding?.subjectCount === records.length,
            `${label} R3 Q snapshot binding mismatch`);
        const status = runtime.getStatus();
        assert(status.storageBindingCount <= 9,
            `${label} R3 Q storage exceeded`);
        assert(status.subjectReadbackPolicy === 'aggregate-only',
            `${label} R3 Q readback policy mismatch`);
        runtime.releaseSnapshot(completion.snapshotToken);
        return Object.freeze({
            subjectCount: completion.subjectCount,
            capacityDemand: completion.capacityDemand,
            aggregateReadbackBytes: status.aggregateReadbackByteSize,
            storageMaximum: status.storageBindingCount,
            subjectReadbackPolicy: status.subjectReadbackPolicy,
            protocolRejectedCount: status.protocolRejectedCount
        });
    } finally {
        runtime.destroy();
        for (const buffer of Object.values(sideBuffers)) buffer.destroy();
    }
}

async function runTowerCreationCase(device, options) {
    const label = String(options.label);
    const childCount = Number(options.childCount);
    const damageFixedPoint = Number(options.damageFixedPoint ?? 0);
    const technicalOneShort = options.technicalOneShort === true;
    const state = new TowerGroupState();
    const initialHandle = Object.freeze({
        entityId: 20_000 + (options.caseOrdinal * 2_000),
        incarnation: 1
    });
    const initialLogicalId = state.getPrimaryTowerRecord().logicalTowerId;
    state.bindGpuBody(initialLogicalId, initialHandle, PROTOCOL);
    if (damageFixedPoint > 0) {
        const damageFacts = state.commitCompletedEvents({
            events: [createTowerDamageEvent(
                initialHandle,
                1,
                damageFixedPoint,
                `${label}-damage`
            )]
        });
        assert(damageFacts.some((fact) => (
            fact.type === TOWER_COMBAT_FACT_TYPE.DAMAGE_APPLIED
        )), `${label} damage was not committed`);
    }

    const beforeRecords = state.getTowerRecords();
    const plan = state.planCreation({
        transactionId: `${label}-transaction`,
        childCount
    });
    assert(plan.accepted === true, `${label} CPU plan rejected`);
    const targetRecords = [...plan.existing, ...plan.children]
        .sort((left, right) => (
            left.logicalTowerOrdinal - right.logicalTowerOrdinal
        ));
    const targetCount = targetRecords.length;
    const capacity = technicalOneShort ? targetCount - 1 : targetCount;
    assert(capacity > 0, `${label} invalid capacity`);

    const sourceByLogicalId = new Map(beforeRecords.map((record) => (
        [record.logicalTowerId, record]
    )));
    const handlesByLogicalId = new Map();
    const slotsByLogicalId = new Map();
    targetRecords.forEach((record, slot) => {
        const sourceRecord = sourceByLogicalId.get(record.logicalTowerId);
        const handle = sourceRecord?.exactGpuBinding ?? Object.freeze({
            entityId: initialHandle.entityId + slot,
            incarnation: 1
        });
        handlesByLogicalId.set(record.logicalTowerId, handle);
        slotsByLogicalId.set(record.logicalTowerId, slot);
    });
    const sourceRevision = state.getStatus().groupRevision;
    const targetRevision = sourceRevision + 1;
    const sourceMembers = beforeRecords.map((record) => toTowerMember(
        record,
        record.exactGpuBinding,
        slotsByLogicalId.get(record.logicalTowerId)
    ));
    const targetMembers = targetRecords.map((record) => toTowerMember(
        record,
        handlesByLogicalId.get(record.logicalTowerId),
        slotsByLogicalId.get(record.logicalTowerId)
    ));
    const sourceRosterStorage = createGpuTowerGroupHostStorage(capacity);
    const sourceRoster = writeGpuTowerGroupRoster(sourceRosterStorage, {
        protocol: PROTOCOL,
        groupRevision: sourceRevision,
        members: sourceMembers
    });
    const targetRosterStorage = createGpuTowerGroupHostStorage(targetCount);
    const targetRoster = writeGpuTowerGroupRoster(targetRosterStorage, {
        protocol: PROTOCOL,
        groupRevision: targetRevision,
        members: targetMembers
    });
    const creationRecords = targetRecords.map((record, rosterRank) => {
        const source = sourceByLogicalId.get(record.logicalTowerId);
        const handle = handlesByLogicalId.get(record.logicalTowerId);
        return {
            kind: source
                ? GPU_TOWER_CREATION_RECORD_KIND.EXISTING
                : GPU_TOWER_CREATION_RECORD_KIND.CHILD,
            slot: slotsByLogicalId.get(record.logicalTowerId),
            entityId: handle.entityId,
            incarnation: handle.incarnation,
            logicalTowerOrdinal: record.logicalTowerOrdinal,
            sourceCurrentHpFixedPoint: source?.currentHpFixedPoint ?? 0,
            targetCurrentHpFixedPoint: record.currentHpFixedPoint,
            sourceShareUnits: source?.shareUnits ?? 0,
            targetShareUnits: record.shareUnits,
            sourceMaxHpFixedPoint: source?.maxHpFixedPoint ?? 0,
            targetMaxHpFixedPoint: record.maxHpFixedPoint,
            sourcePowerFixedPoint: source?.powerFixedPoint ?? 0,
            targetPowerFixedPoint: record.powerFixedPoint,
            sourceGroupRevision: source ? sourceRevision : 0,
            targetGroupRevision: targetRevision,
            rosterRank
        };
    });

    const countsBytes = new ArrayBuffer(GPU_CIRCLE_BODY_ABI.COUNTS.STRIDE);
    const physicsBytes = new ArrayBuffer(
        capacity * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE
    );
    const simulationBytes = new ArrayBuffer(
        capacity * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE
    );
    const abilityBytes = new ArrayBuffer(
        capacity * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA.STRIDE
    );
    const countsView = new DataView(countsBytes);
    const physicsView = new DataView(physicsBytes);
    const simulationView = new DataView(simulationBytes);
    countsView.setUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.BODY_COUNT,
        capacity,
        true
    );
    countsView.setUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.ABI_VERSION,
        GPU_CIRCLE_BODY_ABI_VERSION,
        true
    );
    for (let slot = 0; slot < Math.min(capacity, targetCount); slot++) {
        const target = targetRecords[slot];
        const source = sourceByLogicalId.get(target.logicalTowerId);
        const handle = handlesByLogicalId.get(target.logicalTowerId);
        const physicsOffset = slot * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE;
        const simulationOffset = slot
            * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
        physicsView.setFloat32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_X,
            slot * 0.75,
            true
        );
        physicsView.setFloat32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_Y,
            slot * -0.5,
            true
        );
        physicsView.setFloat32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.RADIUS,
            0.5,
            true
        );
        physicsView.setUint32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INTERACTION_META,
            GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE,
            true
        );
        simulationView.setUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH,
            source?.currentHpFixedPoint ?? target.currentHpFixedPoint,
            true
        );
        simulationView.setUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.GAMEPLAY_META,
            GAMEPLAY_TEAM_ID.PLAYER,
            true
        );
        simulationView.setUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
            source ? GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE : 0,
            true
        );
        simulationView.setUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.ENTITY_ID,
            handle.entityId,
            true
        );
        simulationView.setUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.INCARNATION,
            handle.incarnation,
            true
        );
    }
    writeGpuAbilityEntityMetadata(
        abilityBytes,
        capacity,
        0,
        createAbilityEntityMetadata({
            entityId: initialHandle.entityId,
            incarnation: initialHandle.incarnation,
            kindId: 'tower',
            definitionId: 'tower.player.v1',
            createdAtTick: 1,
            metadata: { powerFixedPoint: beforeRecords[0].powerFixedPoint }
        }, {
            nounMask: GAMEPLAY_NOUN_MASK.TOWER,
            creationOriginCode: ABILITY_CREATION_ORIGIN_CODE.NATURAL,
            powerFixedPoint: beforeRecords[0].powerFixedPoint
        })
    );

    const usage = GPUBufferUsage.STORAGE
        | GPUBufferUsage.COPY_DST
        | GPUBufferUsage.COPY_SRC;
    const resources = {
        counts: createBuffer(
            device, `${label}-counts`, countsBytes.byteLength, usage, countsBytes
        ),
        physics: createBuffer(
            device, `${label}-physics`, physicsBytes.byteLength, usage, physicsBytes
        ),
        simulation: createBuffer(
            device,
            `${label}-simulation`,
            simulationBytes.byteLength,
            usage,
            simulationBytes
        ),
        abilityMetadata: createBuffer(
            device,
            `${label}-ability-metadata`,
            abilityBytes.byteLength,
            usage,
            abilityBytes
        ),
        members: createBuffer(
            device,
            `${label}-members`,
            sourceRosterStorage.memberStates.byteLength,
            usage,
            sourceRosterStorage.memberStates
        ),
        roster: createBuffer(
            device,
            `${label}-roster`,
            sourceRosterStorage.roster.byteLength,
            usage,
            sourceRosterStorage.roster
        )
    };
    const runtime = new GpuTowerCreationRuntime({
        bodyCapacity: capacity,
        recordCapacity: capacity,
        readbackSlotCount: 2
    });
    try {
        runtime.initialize(device, resources, PROTOCOL);
        const staged = runtime.stage({
            transactionId: `${label}-transaction`,
            transactionFingerprint: fingerprintGpuTowerCreationTransaction(
                label,
                childCount,
                damageFixedPoint
            ),
            sourceTick: 10 + options.caseOrdinal,
            sourceGroupRevision: sourceRevision,
            targetGroupRevision: targetRevision,
            sourceRosterFingerprint: sourceRoster.fingerprint,
            targetRosterFingerprint: targetRoster.fingerprint,
            existingCount: beforeRecords.length,
            childCount,
            towerDefinitionCode: 777,
            records: creationRecords,
            protocol: PROTOCOL
        });
        if (technicalOneShort) {
            assert(staged.accepted === false,
                `${label} one-short unexpectedly staged`);
            const rejection = state.rejectCreation(plan, staged.reason);
            assert(rejection.result === TOWER_CREATION_RESULT.REJECTED_CAPACITY,
                `${label} one-short state rejection mismatch`);
            assert(JSON.stringify(state.getTowerRecords())
                === JSON.stringify(beforeRecords), `${label} rejection mutated records`);
            const status = runtime.getStatus();
            assert(status.pendingTransaction === null,
                `${label} one-short leaked pending transaction`);
            assert(status.stagedCount === 0,
                `${label} one-short staged count changed`);
            return Object.freeze({
                requestedTowerCount: targetCount,
                technicalCapacity: capacity,
                accepted: false,
                reason: staged.reason,
                stateMutationCount: 0,
                pendingTransactionCount: status.pendingTransaction ? 1 : 0,
                pendingReadbackCount: status.pendingReadbackCount,
                fullBodyReadbackCount: status.fullBodyReadbackCount,
                storageMaximum:
                    status.storageProfile.maximumStorageBuffersPerStage
            });
        }

        assert(staged.accepted === true,
            `${label} creation stage failed: ${JSON.stringify(staged)}`);
        const encoder = device.createCommandEncoder({
            label: `${label}-creation-encoder`
        });
        const pass = encoder.beginComputePass({
            label: `${label}-creation-pass`
        });
        runtime.encode(pass, staged.sourceTick);
        pass.end();
        runtime.encodeReadback(encoder, staged.sourceTick);
        device.queue.submit([encoder.finish()]);
        runtime.markSubmitted(staged.sourceTick);
        const completion = await waitForCreationCompletion(runtime, device, label);
        assert(completion.committed === true,
            `${label} GPU creation failed: ${JSON.stringify(completion)}`);
        assert(completion.protocolFailure === false,
            `${label} GPU creation protocol failure`);
        assert(completion.evidence.validatedCount === targetCount,
            `${label} validated count mismatch`);
        assert(completion.evidence.appliedCount === targetCount,
            `${label} applied count mismatch`);
        assert(completion.evidence.createdCount === childCount,
            `${label} created count mismatch`);

        const committed = state.commitCreation(plan);
        assert(committed.result === TOWER_CREATION_RESULT.COMMITTED,
            `${label} CPU creation commit failed`);
        for (const record of state.getTowerRecords()) {
            if (record.exactGpuBinding) continue;
            state.bindGpuBody(
                record.logicalTowerId,
                handlesByLogicalId.get(record.logicalTowerId),
                PROTOCOL
            );
        }
        const committedRecords = state.getTowerRecords();
        const committedStatus = state.getStatus();
        assert(committedRecords.length === targetCount,
            `${label} committed Tower count mismatch`);
        assert(committedStatus.livingShareUnits === TOWER_SHARE_SCALE,
            `${label} committed Share mismatch`);
        assert(committedRecords.reduce(
            (sum, record) => sum + record.currentHpFixedPoint,
            0
        ) === 3_000 - damageFixedPoint, `${label} current HP total mismatch`);
        assert(state.auditInvariants().valid === true,
            `${label} state invariant failed`);

        const r3Subject = options.verifyR3Subject
            ? await runR3TowerSubjectAfterSplit(
                device,
                resources,
                committedRecords,
                handlesByLogicalId,
                label
            )
            : null;

        let deathEvidence = null;
        if (options.deathMode) {
            const victims = options.deathMode === 'all'
                ? committedRecords
                : [committedRecords.at(-1)];
            let previousLost = 0;
            let noRunFailed = true;
            let lastFacts = [];
            let deathTick = 500 + (options.caseOrdinal * 10);
            for (const victim of victims) {
                lastFacts = state.commitCompletedEvents({
                    events: [createTowerDeathEvent(
                        victim.exactGpuBinding,
                        deathTick++,
                        `${label}-death-${victim.logicalTowerOrdinal}`
                    )]
                });
                noRunFailed = noRunFailed
                    && !lastFacts.some((fact) => fact.type === 'RunFailed');
                const lost = state.getStatus().lostShareUnits;
                assert(lost > previousLost, `${label} Lost Share not monotonic`);
                previousLost = lost;
            }
            deathEvidence = Object.freeze({
                deathCount: victims.length,
                livingTowerCount: state.getStatus().livingTowerCount,
                livingShareUnits: state.getStatus().livingShareUnits,
                lostShareUnits: state.getStatus().lostShareUnits,
                noRunFailed,
                noLivingTowersFact: lastFacts.some((fact) => (
                    fact.type === TOWER_COMBAT_FACT_TYPE.NO_LIVING_TOWERS
                ))
            });
            if (options.deathMode === 'all') {
                assert(deathEvidence.livingTowerCount === 0,
                    `${label} all-death left living Towers`);
                assert(deathEvidence.lostShareUnits === TOWER_SHARE_SCALE,
                    `${label} all-death Lost Share mismatch`);
                assert(deathEvidence.noRunFailed === true,
                    `${label} all-death emitted RunFailed`);
            }
        }

        const status = runtime.getStatus();
        assert(status.pendingTransaction === null,
            `${label} pending transaction leak`);
        assert(status.pendingReadbackCount === 0,
            `${label} pending readback leak`);
        assert(status.protocolFailureCount === 0,
            `${label} protocol failure count`);
        assert(status.fullBodyReadbackCount === 0,
            `${label} full-body readback detected`);
        return Object.freeze({
            childCount,
            towerCount: targetCount,
            damageFixedPoint,
            currentHpTotal: committedRecords.reduce(
                (sum, record) => sum + record.currentHpFixedPoint,
                0
            ),
            livingShareUnits: committedStatus.livingShareUnits,
            lostShareUnits: committedStatus.lostShareUnits,
            validatedCount: completion.evidence.validatedCount,
            appliedCount: completion.evidence.appliedCount,
            createdCount: completion.evidence.createdCount,
            partialCreationCount: completion.evidence.appliedCount === targetCount
                    && completion.evidence.createdCount === childCount
                ? 0
                : 1,
            pendingTransactionCount: status.pendingTransaction ? 1 : 0,
            pendingReadbackCount: status.pendingReadbackCount,
            recordCountHighWater: status.recordCountHighWater,
            resultReadbackBytes: status.resultReadbackBytes,
            fullBodyReadbackCount: status.fullBodyReadbackCount,
            storageMaximum:
                status.storageProfile.maximumStorageBuffersPerStage,
            protocolFailureCount: status.protocolFailureCount,
            r3Subject,
            death: deathEvidence
        });
    } finally {
        runtime.destroy();
        state.destroy();
        for (const buffer of Object.values(resources)) buffer.destroy();
    }
}

async function runTowerCreationFixture(device) {
    const full = await runTowerCreationCase(device, {
        label: 'creation-full-1-to-2',
        caseOrdinal: 1,
        childCount: 1
    });
    const damaged = await runTowerCreationCase(device, {
        label: 'creation-damaged-1-to-2',
        caseOrdinal: 2,
        childCount: 1,
        damageFixedPoint: 1_200,
        deathMode: 'all'
    });
    const oneToHundred = await runTowerCreationCase(device, {
        label: 'creation-1-to-100',
        caseOrdinal: 3,
        childCount: 99,
        verifyR3Subject: true
    });
    const capacityOneShort = await runTowerCreationCase(device, {
        label: 'creation-capacity-one-short',
        caseOrdinal: 4,
        childCount: 99,
        technicalOneShort: true
    });
    const churn = [];
    for (let index = 0; index < 8; index++) {
        churn.push(await runTowerCreationCase(device, {
            label: `creation-churn-${index}`,
            caseOrdinal: 10 + index,
            childCount: 1 + (index % 3),
            damageFixedPoint: index % 2 === 0 ? 0 : 300,
            deathMode: 'one'
        }));
    }
    const cases = [full, damaged, oneToHundred, ...churn];
    return Object.freeze({
        full30Split: full,
        damaged18Split: damaged,
        oneToHundred,
        capacityOneShort,
        churn: Object.freeze({
            cycleCount: churn.length,
            creationRequestedCount: churn.length,
            creationAppliedCount: churn.filter((entry) => (
                entry.partialCreationCount === 0
            )).length,
            deathCount: churn.reduce(
                (sum, entry) => sum + entry.death.deathCount,
                0
            )
        }),
        creationRequestedCount: cases.length + 1,
        creationAppliedCount: cases.length,
        creationRejectedCount: 1,
        partialCreationCount: cases.reduce(
            (sum, entry) => sum + entry.partialCreationCount,
            0
        ),
        reservationLeakCount: cases.reduce(
            (sum, entry) => sum + entry.pendingTransactionCount,
            capacityOneShort.pendingTransactionCount
        ),
        readbackLeakCount: cases.reduce(
            (sum, entry) => sum + entry.pendingReadbackCount,
            capacityOneShort.pendingReadbackCount
        ),
        protocolFailureCount: cases.reduce(
            (sum, entry) => sum + entry.protocolFailureCount,
            0
        ),
        bodyHighWater: oneToHundred.towerCount,
        memberHighWater: oneToHundred.towerCount,
        preleaseHighWater: oneToHundred.childCount,
        storageMaximum: Math.max(
            capacityOneShort.storageMaximum,
            ...cases.map((entry) => entry.storageMaximum),
            oneToHundred.r3Subject.storageMaximum
        ),
        fullBodyReadbackCount: cases.reduce(
            (sum, entry) => sum + entry.fullBodyReadbackCount,
            capacityOneShort.fullBodyReadbackCount
        )
    });
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
        result.towerGroupControl = await runTowerGroupControlFixture(device);
        result.towerCreation = await runTowerCreationFixture(device);
        result.towerGroupRecovery = await runTowerGroupRecoveryFixture(device);
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
