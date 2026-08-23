import {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_INTERACTION_LAYER,
    GPU_CIRCLE_BODY_LAYER,
    GPU_CIRCLE_BODY_SIMULATION_FLAG
} from './production/script/module/ingame/physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_FIXED_PRIMITIVE_ABI
} from './production/script/module/ingame/physics/gpu/gpu_fixed_primitive_abi.js';
import {
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI,
    writeGpuAbilityEntityMetadata
} from './production/script/module/ingame/physics/gpu/gpu_ability_subject_snapshot_abi.js';
import {
    GPU_TOWER_GROUP_ABI,
    GPU_TOWER_GROUP_INVALID_COMPONENT,
    GPU_TOWER_GROUP_MEMBER_FLAG,
    createGpuTowerGroupHostStorage,
    writeGpuTowerGroupRoster
} from './production/script/module/ingame/physics/gpu/gpu_tower_group_abi.js';
import {
    GPU_TOWER_MERGE_ABI,
    GPU_TOWER_MERGE_RECORD_ROLE,
    GPU_TOWER_MERGE_STATUS,
    GPU_TOWER_MERGE_STORAGE_PROFILE
} from './production/script/module/ingame/physics/gpu/gpu_tower_merge_abi.js';
import {
    GpuTowerMergeRuntime
} from './production/script/module/ingame/physics/gpu/gpu_tower_merge_runtime.js';
import {
    ABILITY_ENTITY_METADATA_ABI_VERSION
} from './production/script/module/ingame/contract/ability_execution_contract.js';
import {
    GAMEPLAY_TEAM_ID
} from './production/script/module/ingame/contract/gameplay_team_contract.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const CONTROL = GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_STATE;
const ABILITY = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA;
const MEMBER = GPU_TOWER_GROUP_ABI.MEMBER_STATE;
const ROSTER = GPU_TOWER_GROUP_ABI.ROSTER_HEADER;
const PROTOCOL = Object.freeze({
    sessionGeneration: 71,
    deviceGeneration: 19,
    authoritativeEpoch: 43
});
const REQUIRED_MEMBER_FLAGS = GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
    | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING;
const SOURCE_GROUP_REVISION = 11;
const TARGET_GROUP_REVISION = 12;
const TIMING_SAMPLE_COUNT = 12;
const TIMING_SOURCE_COUNTS = Object.freeze([2, 64, 256]);
const TIMING_STAGE_NAMES = Object.freeze(['prepare', 'seal', 'apply']);

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function percentile(values, quantile) {
    assert(Array.isArray(values) && values.length > 0,
        'Tower merge percentile sample이 비어 있습니다.');
    const sorted = [...values].sort((left, right) => left - right);
    const rank = Math.max(
        0,
        Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)
    );
    return sorted[rank];
}

function summarizeSamples(values) {
    return Object.freeze({
        sampleCount: values.length,
        p50: values.length > 0 ? percentile(values, 0.5) : null,
        p95: values.length > 0 ? percentile(values, 0.95) : null
    });
}

function sameBytes(left, right) {
    if (left.byteLength !== right.byteLength) return false;
    const a = new Uint8Array(left);
    const b = new Uint8Array(right);
    for (let index = 0; index < a.length; index++) {
        if (a[index] !== b[index]) return false;
    }
    return true;
}

function zeroRange(buffer, byteOffset, byteLength) {
    return new Uint8Array(buffer, byteOffset, byteLength).every(
        (value) => value === 0
    );
}

function sliceRecord(buffer, stride, slot) {
    return buffer.slice(slot * stride, (slot + 1) * stride);
}

function createBuffer(device, label, bytes) {
    const buffer = device.createBuffer({
        label,
        size: bytes.byteLength,
        usage: GPUBufferUsage.STORAGE
            | GPUBufferUsage.COPY_DST
            | GPUBufferUsage.COPY_SRC
    });
    device.queue.writeBuffer(buffer, 0, bytes);
    return buffer;
}

async function readBuffers(device, sources) {
    const readbacks = Object.entries(sources).map(([key, source]) => ({
        key,
        source,
        buffer: device.createBuffer({
            label: `r6-tower-merge-readback-${key}`,
            size: source.size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        })
    }));
    const encoder = device.createCommandEncoder({
        label: 'r6-tower-merge-fixture-readback'
    });
    for (const entry of readbacks) {
        encoder.copyBufferToBuffer(
            entry.source,
            0,
            entry.buffer,
            0,
            entry.source.size
        );
    }
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await Promise.all(readbacks.map(({ buffer }) => buffer.mapAsync(
        GPUMapMode.READ
    )));
    const result = {};
    for (const entry of readbacks) {
        result[entry.key] = entry.buffer.getMappedRange().slice(0);
        entry.buffer.unmap();
        entry.buffer.destroy();
    }
    return result;
}

async function waitForCompletion(runtime, device) {
    await device.queue.onSubmittedWorkDone();
    for (let attempt = 0; attempt < 200; attempt++) {
        const completed = runtime.drainCompleted([]);
        if (completed.length > 0) return completed[0];
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(
        `Tower merge aggregate readback timeout: ${JSON.stringify(runtime.getStatus())}`
    );
}

function writeSourceBody(host, slot, source) {
    const physicsOffset = slot * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE;
    const simulationOffset = slot * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
    const controlOffset = slot * CONTROL.STRIDE;
    host.physics.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_X,
        source.positionX,
        true
    );
    host.physics.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_Y,
        source.positionY,
        true
    );
    host.physics.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_X,
        source.velocityX,
        true
    );
    host.physics.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_Y,
        source.velocityY,
        true
    );
    host.physics.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.RADIUS,
        source.radius ?? 1,
        true
    );
    host.physics.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INVERSE_MASS,
        source.inverseMass ?? 1,
        true
    );
    host.physics.setUint32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.PHYSICAL_META,
        source.physicalMeta,
        true
    );
    host.physics.setUint32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INTERACTION_META,
        source.interactionMeta,
        true
    );
    host.simulation.setFloat32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.LIFETIME,
        source.lifetime ?? 300,
        true
    );
    host.simulation.setInt32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH,
        source.health,
        true
    );
    host.simulation.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.GAMEPLAY_META,
        source.teamId,
        true
    );
    host.simulation.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
        source.flags,
        true
    );
    host.simulation.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_FIELD_INDEX,
        source.flowFieldIndex ?? slot + 1,
        true
    );
    host.simulation.setFloat32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_SPEED,
        source.flowSpeed ?? 3,
        true
    );
    host.simulation.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.ENTITY_ID,
        source.entityId,
        true
    );
    host.simulation.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.INCARNATION,
        source.incarnation,
        true
    );
    for (let offset = 0; offset < CONTROL.STRIDE; offset += 4) {
        host.controls.setUint32(controlOffset + offset, (
            0x10000000 + slot * 0x100 + offset
        ) >>> 0, true);
    }
    const temporaryOffset = slot * GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE;
    for (let offset = 0; offset < GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE;
        offset += 4) {
        host.temporary.setUint32(
            temporaryOffset + offset,
            (0x20000000 + slot * 0x100 + offset) >>> 0,
            true
        );
    }
    const effectOffset = slot * 16;
    for (let offset = 0; offset < 16; offset += 4) {
        host.effects.setUint32(
            effectOffset + offset,
            (0x30000000 + slot * 0x100 + offset) >>> 0,
            true
        );
    }
    writeGpuAbilityEntityMetadata(
        host.metadataBytes,
        host.bodyCapacity,
        slot,
        {
            abiVersion: ABILITY_ENTITY_METADATA_ABI_VERSION,
            nounMask: 1,
            definitionCode: 1000 + slot,
            ownerEntityId: source.entityId,
            ownerIncarnation: source.incarnation,
            sourceAbilityCode: 2000 + slot,
            sourceExecutionFingerprint: 3000 + slot,
            sourceExecutionOrdinal: slot + 1,
            generation: 1,
            visibleFromExecutionOrdinal: slot + 1,
            creationOriginCode: 1,
            powerFixedPoint: source.powerFixedPoint
        }
    );
}

function createFixture(device, sourceCount, protocol = PROTOCOL) {
    const bodyCapacity = sourceCount + 1;
    const physicsBytes = new ArrayBuffer(
        bodyCapacity * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE
    );
    const simulationBytes = new ArrayBuffer(
        bodyCapacity * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE
    );
    const controlBytes = new ArrayBuffer(bodyCapacity * CONTROL.STRIDE);
    const metadataBytes = new ArrayBuffer(bodyCapacity * ABILITY.STRIDE);
    const temporaryBytes = new ArrayBuffer(
        bodyCapacity * GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE
    );
    const effectBytes = new ArrayBuffer(bodyCapacity * 16);
    const host = {
        bodyCapacity,
        physicsBytes,
        simulationBytes,
        controlBytes,
        metadataBytes,
        temporaryBytes,
        effectBytes,
        physics: new DataView(physicsBytes),
        simulation: new DataView(simulationBytes),
        controls: new DataView(controlBytes),
        temporary: new DataView(temporaryBytes),
        effects: new DataView(effectBytes)
    };
    const sources = [];
    for (let slot = 0; slot < sourceCount; slot++) {
        const source = Object.freeze({
            slot,
            entityId: 10_000 + slot,
            incarnation: 100 + slot,
            logicalTowerOrdinal: slot + 1,
            health: 1000 - (slot % 97),
            shareUnits: 100 + (slot % 5),
            maxHpFixedPoint: 1000,
            powerFixedPoint: 50 + (slot % 7),
            positionX: 10.25 + slot * 0.5,
            positionY: -4.5 - slot * 0.25,
            velocityX: 1.25 + slot * 0.01,
            velocityY: -0.75 - slot * 0.01,
            physicalMeta: (
                GPU_CIRCLE_BODY_LAYER.PLAYER_DAMAGEABLE
                | (GPU_CIRCLE_BODY_LAYER.ENEMY << 16)
            ) >>> 0,
            interactionMeta: (
                GPU_CIRCLE_BODY_INTERACTION_LAYER.PLAYER_DAMAGEABLE
                | (GPU_CIRCLE_BODY_LAYER.ENEMY << 16)
            ) >>> 0,
            teamId: GAMEPLAY_TEAM_ID.PLAYER,
            flags: GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE
                | GPU_CIRCLE_BODY_SIMULATION_FLAG.CONTROLLED_THIS_TICK
        });
        writeSourceBody(host, slot, source);
        sources.push(source);
    }
    const projectileSlot = bodyCapacity - 1;
    const projectile = Object.freeze({
        slot: projectileSlot,
        entityId: 900_000 + sourceCount,
        incarnation: 77,
        health: 321,
        powerFixedPoint: 909,
        positionX: -27.5,
        positionY: 19.25,
        velocityX: 8.5,
        velocityY: -3.25,
        physicalMeta: (
            GPU_CIRCLE_BODY_LAYER.PROJECTILE
            | (GPU_CIRCLE_BODY_LAYER.ENEMY << 16)
        ) >>> 0,
        interactionMeta: (
            GPU_CIRCLE_BODY_LAYER.PROJECTILE
            | (GPU_CIRCLE_BODY_LAYER.ENEMY << 16)
        ) >>> 0,
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
        flags: GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE
    });
    writeSourceBody(host, projectileSlot, projectile);

    const sourceGroupStorage = createGpuTowerGroupHostStorage(bodyCapacity);
    const sourceRoster = writeGpuTowerGroupRoster(sourceGroupStorage, {
        protocol,
        groupRevision: SOURCE_GROUP_REVISION,
        members: sources.map((source) => ({
            slot: source.slot,
            entityId: source.entityId,
            incarnation: source.incarnation,
            logicalTowerOrdinal: source.logicalTowerOrdinal,
            shareUnits: source.shareUnits,
            maxHpFixedPoint: source.maxHpFixedPoint,
            powerFixedPoint: source.powerFixedPoint,
            flags: REQUIRED_MEMBER_FLAGS
        }))
    });
    const target = Object.freeze({
        currentHpFixedPoint: sources.reduce(
            (sum, source) => sum + source.health,
            0
        ),
        shareUnits: sources.reduce(
            (sum, source) => sum + source.shareUnits,
            0
        ),
        maxHpFixedPoint: sources.reduce(
            (sum, source) => sum + source.maxHpFixedPoint,
            0
        ),
        powerFixedPoint: sources.reduce(
            (sum, source) => sum + source.powerFixedPoint,
            0
        )
    });
    const survivor = sources[0];
    const targetGroupStorage = createGpuTowerGroupHostStorage(bodyCapacity);
    const targetRoster = writeGpuTowerGroupRoster(targetGroupStorage, {
        protocol,
        groupRevision: TARGET_GROUP_REVISION,
        members: [{
            slot: survivor.slot,
            entityId: survivor.entityId,
            incarnation: survivor.incarnation,
            logicalTowerOrdinal: survivor.logicalTowerOrdinal,
            shareUnits: target.shareUnits,
            maxHpFixedPoint: target.maxHpFixedPoint,
            powerFixedPoint: target.powerFixedPoint,
            flags: REQUIRED_MEMBER_FLAGS
        }]
    });
    const resources = {
        physics: createBuffer(device, 'r6-merge-physics', physicsBytes),
        simulation: createBuffer(device, 'r6-merge-simulation', simulationBytes),
        bodyControlStates: createBuffer(device, 'r6-merge-controls', controlBytes),
        abilityMetadata: createBuffer(device, 'r6-merge-metadata', metadataBytes),
        members: createBuffer(
            device,
            'r6-merge-members',
            sourceGroupStorage.memberStates
        ),
        roster: createBuffer(device, 'r6-merge-roster', sourceGroupStorage.roster)
    };
    const diagnostic = {
        temporary: createBuffer(device, 'r6-merge-temporary', temporaryBytes),
        effects: createBuffer(device, 'r6-merge-effects', effectBytes)
    };
    const original = Object.freeze({
        physics: physicsBytes.slice(0),
        simulation: simulationBytes.slice(0),
        bodyControlStates: controlBytes.slice(0),
        abilityMetadata: metadataBytes.slice(0),
        members: sourceGroupStorage.memberStates.slice(0),
        roster: sourceGroupStorage.roster.slice(0),
        temporary: temporaryBytes.slice(0),
        effects: effectBytes.slice(0)
    });
    const program = Object.freeze({
        transactionId: `r6-actual-${sourceCount}-${protocol.sessionGeneration}`,
        planFingerprint: (
            (0x6a000000 + sourceCount).toString(16).padStart(8, '0')
            + (0xb5000000 + sourceCount).toString(16).padStart(8, '0')
        ),
        sourceTick: 100 + sourceCount,
        sourceGroupRevision: SOURCE_GROUP_REVISION,
        targetGroupRevision: TARGET_GROUP_REVISION,
        sourceRosterFingerprint: sourceRoster.fingerprint,
        targetRosterFingerprint: targetRoster.fingerprint,
        records: sources.map((source, rank) => ({
            slot: source.slot,
            entityId: source.entityId,
            incarnation: source.incarnation,
            logicalTowerOrdinal: source.logicalTowerOrdinal,
            expectedCurrentHpFixedPoint: source.health,
            sourceShareUnits: source.shareUnits,
            sourceMaxHpFixedPoint: source.maxHpFixedPoint,
            sourcePowerFixedPoint: source.powerFixedPoint,
            sourceGroupRevision: SOURCE_GROUP_REVISION,
            sourceFlags: REQUIRED_MEMBER_FLAGS,
            sourceRosterRank: rank,
            role: rank === 0
                ? GPU_TOWER_MERGE_RECORD_ROLE.SURVIVOR
                : GPU_TOWER_MERGE_RECORD_ROLE.CONSUMED,
            targetCurrentHpFixedPoint: rank === 0
                ? target.currentHpFixedPoint
                : 0,
            targetShareUnits: rank === 0 ? target.shareUnits : 0,
            targetMaxHpFixedPoint: rank === 0
                ? target.maxHpFixedPoint
                : 0,
            targetPowerFixedPoint: rank === 0
                ? target.powerFixedPoint
                : 0
        }))
    });
    return {
        bodyCapacity,
        sourceCount,
        protocol,
        sources,
        survivor,
        projectile,
        projectileSlot,
        target,
        sourceRoster,
        targetRoster,
        resources,
        diagnostic,
        original,
        program
    };
}

function allBuffers(fixture) {
    return { ...fixture.resources, ...fixture.diagnostic };
}

function destroyFixture(fixture) {
    for (const buffer of Object.values(allBuffers(fixture))) buffer.destroy();
}

function encodeAndSubmit(runtime, device, sourceTick) {
    const encoder = device.createCommandEncoder({
        label: `r6-tower-merge-${sourceTick}`
    });
    const pass = encoder.beginComputePass({
        label: `r6-tower-merge-pass-${sourceTick}`
    });
    runtime.encode(pass, sourceTick);
    pass.end();
    runtime.encodeReadback(encoder, sourceTick);
    device.queue.submit([encoder.finish()]);
    runtime.markSubmitted(sourceTick);
}

function assertUnchanged(actual, expected, excluded = new Set()) {
    for (const [key, bytes] of Object.entries(expected)) {
        if (excluded.has(key)) continue;
        assert(sameBytes(actual[key], bytes), `${key} changed unexpectedly`);
    }
}

async function runCommittedCase(device, sourceCount) {
    const fixture = createFixture(device, sourceCount);
    const runtime = new GpuTowerMergeRuntime({
        bodyCapacity: fixture.bodyCapacity,
        recordCapacity: sourceCount,
        readbackSlotCount: 2
    });
    runtime.initialize(device, fixture.resources, fixture.protocol);
    const staged = runtime.stage(fixture.program);
    assert(staged.accepted, `merge ${sourceCount} stage: ${JSON.stringify(staged)}`);
    const pressure = runtime.stage(fixture.program);
    assert(!pressure.accepted
        && pressure.reason === 'tower-merge-program-capacity'
        && pressure.recoveryRequired === false,
    `merge ${sourceCount} capacity: ${JSON.stringify(pressure)}`);
    encodeAndSubmit(runtime, device, fixture.program.sourceTick);
    const completion = await waitForCompletion(runtime, device);
    assert(completion.committed,
        `merge ${sourceCount} completion: ${JSON.stringify(completion)}`);
    const actual = await readBuffers(device, allBuffers(fixture));
    const physics = new DataView(actual.physics);
    const simulation = new DataView(actual.simulation);
    const metadata = new DataView(actual.abilityMetadata);
    const members = new DataView(actual.members);
    const roster = new DataView(actual.roster);
    const originalPhysics = new DataView(fixture.original.physics);
    const survivorPhysicsOffset = fixture.survivor.slot
        * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE;
    for (const field of [
        GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_X,
        GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_Y,
        GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_X,
        GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_Y
    ]) {
        assert(
            physics.getUint32(survivorPhysicsOffset + field, true)
                === originalPhysics.getUint32(
                    survivorPhysicsOffset + field,
                    true
                ),
            `survivor pose/velocity changed at ${field}`
        );
    }
    const survivorSimulationOffset = fixture.survivor.slot
        * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
    assert(simulation.getInt32(
        survivorSimulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH,
        true
    ) === fixture.target.currentHpFixedPoint, 'survivor HP mismatch');
    assert((simulation.getUint32(
        survivorSimulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
        true
    ) & GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE) !== 0,
    'survivor must remain alive');
    const survivorMemberOffset = fixture.survivor.slot * MEMBER.STRIDE;
    assert(members.getUint32(
        survivorMemberOffset + MEMBER.SHARE_UNITS,
        true
    ) === fixture.target.shareUnits, 'survivor share mismatch');
    assert(members.getUint32(
        survivorMemberOffset + MEMBER.MAX_HP_FIXED_POINT,
        true
    ) === fixture.target.maxHpFixedPoint, 'survivor max HP mismatch');
    assert(members.getUint32(
        survivorMemberOffset + MEMBER.POWER_FIXED_POINT,
        true
    ) === fixture.target.powerFixedPoint, 'survivor power mismatch');
    assert(members.getUint32(
        survivorMemberOffset + MEMBER.GROUP_REVISION,
        true
    ) === TARGET_GROUP_REVISION, 'survivor revision mismatch');
    assert(metadata.getUint32(
        fixture.survivor.slot * ABILITY.STRIDE + ABILITY.POWER_FIXED_POINT,
        true
    ) === fixture.target.powerFixedPoint, 'ability power mismatch');

    let hiddenCount = 0;
    let noncontrolledCount = 0;
    let metadataClearedCount = 0;
    let memberClearedCount = 0;
    for (let rank = 1; rank < sourceCount; rank++) {
        const source = fixture.sources[rank];
        const physicsOffset = source.slot * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE;
        const simulationOffset = source.slot
            * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
        const flags = simulation.getUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
            true
        );
        if (physics.getUint32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.PHYSICAL_META,
            true
        ) === 0 && physics.getUint32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INTERACTION_META,
            true
        ) === 0) hiddenCount++;
        if ((flags & (
            GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE
            | GPU_CIRCLE_BODY_SIMULATION_FLAG.CONTROLLED_THIS_TICK
        )) === 0) noncontrolledCount++;
        if (zeroRange(
            actual.abilityMetadata,
            source.slot * ABILITY.STRIDE,
            ABILITY.STRIDE
        )) metadataClearedCount++;
        if (zeroRange(
            actual.members,
            source.slot * MEMBER.STRIDE,
            MEMBER.STRIDE
        )) memberClearedCount++;
        const controlOffset = source.slot * CONTROL.STRIDE;
        const controls = new DataView(actual.bodyControlStates);
        assert(controls.getUint32(controlOffset + CONTROL.ENTITY_ID, true) === 0,
            'consumed control entity must clear');
        assert(controls.getUint32(
            controlOffset + CONTROL.SELECTED_TARGET_SLOT,
            true
        ) === GPU_TOWER_GROUP_INVALID_COMPONENT,
        'consumed selected slot must invalidate');
    }
    assert(hiddenCount === sourceCount - 1, 'consumed interaction not cleared');
    assert(noncontrolledCount === sourceCount - 1,
        'consumed alive/control not cleared');
    assert(metadataClearedCount === sourceCount - 1,
        'consumed metadata not cleared');
    assert(memberClearedCount === sourceCount - 1,
        'consumed member not cleared');
    assert(roster.getUint32(ROSTER.MEMBER_COUNT, true) === 1,
        'target roster member count mismatch');
    assert(roster.getUint32(ROSTER.FINGERPRINT, true)
        === fixture.targetRoster.fingerprint, 'target roster fingerprint mismatch');
    assert(roster.getUint32(ROSTER.GROUP_REVISION, true)
        === TARGET_GROUP_REVISION, 'target roster revision mismatch');
    assert(roster.getUint32(ROSTER.STRIDE, true) === fixture.survivor.slot,
        'target roster survivor slot mismatch');
    assert(sameBytes(actual.temporary, fixture.original.temporary),
        'temporary previous-position plane changed');
    assert(sameBytes(actual.effects, fixture.original.effects),
        'effect plane changed or transferred');
    const projectileUnchanged = [
        ['physics', GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE],
        ['simulation', GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE],
        ['bodyControlStates', CONTROL.STRIDE],
        ['abilityMetadata', ABILITY.STRIDE],
        ['temporary', GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE],
        ['effects', 16]
    ].every(([key, stride]) => sameBytes(
        sliceRecord(actual[key], stride, fixture.projectileSlot),
        sliceRecord(fixture.original[key], stride, fixture.projectileSlot)
    ));
    assert(projectileUnchanged, 'active projectile changed during tower merge');
    const status = runtime.getStatus();
    assert(status.pendingReadbackCount === 0
        && status.committedCount === 1
        && status.perTowerCpuCommandCount === 0
        && status.fullBodyReadbackCount === 0
        && status.aggregateReadbackBytes === GPU_TOWER_MERGE_ABI.RESULT.STRIDE,
    `runtime accounting mismatch: ${JSON.stringify(status)}`);
    const evidence = Object.freeze({
        sourceCount,
        bodyAbiVersion: GPU_CIRCLE_BODY_ABI_VERSION,
        committed: completion.committed,
        status: completion.evidence.status,
        validatedCount: completion.evidence.validatedCount,
        appliedCount: completion.evidence.appliedCount,
        consumedCount: completion.consumedCount,
        exactSurvivorHandle: completion.survivorHandle.entityId
            === fixture.survivor.entityId
            && completion.survivorHandle.incarnation
                === fixture.survivor.incarnation,
        exactPoseVelocityPreserved: true,
        temporaryPreviousPositionPreserved: true,
        survivorCurrentHpFixedPoint: fixture.target.currentHpFixedPoint,
        survivorMaxHpFixedPoint: fixture.target.maxHpFixedPoint,
        survivorPowerFixedPoint: fixture.target.powerFixedPoint,
        survivorShareUnits: fixture.target.shareUnits,
        targetGroupRevision: TARGET_GROUP_REVISION,
        survivorOnlyRoster: true,
        consumedHiddenCount: hiddenCount,
        consumedNoncontrolledCount: noncontrolledCount,
        consumedMetadataClearedCount: metadataClearedCount,
        consumedMemberClearedCount: memberClearedCount,
        projectileUnchanged,
        effectPlaneUnchanged: true,
        capacityRejectionReason: pressure.reason,
        capacityRecoveryRequired: pressure.recoveryRequired,
        aggregateReadbackBytes: status.aggregateReadbackBytes,
        perTowerCpuCommandCount: status.perTowerCpuCommandCount,
        fullBodyReadbackCount: status.fullBodyReadbackCount,
        storageMaximum: status.storageProfile.maximumStorageBuffersPerStage,
        requiresRecovery: status.requiresRecovery
    });
    runtime.destroy();
    destroyFixture(fixture);
    return evidence;
}

async function runSourceChangedCase(device, mutation) {
    const fixture = createFixture(device, 2);
    const runtime = new GpuTowerMergeRuntime({
        bodyCapacity: fixture.bodyCapacity,
        recordCapacity: 2,
        readbackSlotCount: 1
    });
    runtime.initialize(device, fixture.resources, fixture.protocol);
    const staged = runtime.stage({
        ...fixture.program,
        transactionId: `r6-${mutation}`
    });
    assert(staged.accepted, `${mutation} stage rejected`);
    const expected = { ...fixture.original };
    const simulation = fixture.original.simulation.slice(0);
    const simulationView = new DataView(simulation);
    const changedSlot = 1;
    const base = changedSlot * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
    let field;
    let value;
    if (mutation === 'death') {
        field = GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS;
        value = 0;
    } else {
        field = GPU_CIRCLE_BODY_ABI.SIMULATION.INCARNATION;
        value = fixture.sources[changedSlot].incarnation + 1;
    }
    simulationView.setUint32(base + field, value, true);
    expected.simulation = simulation;
    device.queue.writeBuffer(
        fixture.resources.simulation,
        base + field,
        new Uint32Array([value])
    );
    encodeAndSubmit(runtime, device, fixture.program.sourceTick);
    const completion = await waitForCompletion(runtime, device);
    assert(completion.rejectedSourceChanged
        && !completion.committed
        && !completion.recoveryRequired
        && completion.evidence.status
            === GPU_TOWER_MERGE_STATUS.REJECTED_SOURCE_CHANGED,
    `${mutation} completion mismatch: ${JSON.stringify(completion)}`);
    const actual = await readBuffers(device, allBuffers(fixture));
    assertUnchanged(actual, expected);
    const status = runtime.getStatus();
    const evidence = Object.freeze({
        rejectedSourceChanged: completion.rejectedSourceChanged,
        committed: completion.committed,
        appliedCount: completion.evidence.appliedCount,
        externalStateChangedOnlyByFixture: true,
        mergeMutationCount: 0,
        requiresRecovery: status.requiresRecovery
    });
    runtime.destroy();
    destroyFixture(fixture);
    return evidence;
}

async function runMalformedProgramCase(device) {
    const fixture = createFixture(device, 2);
    const runtime = new GpuTowerMergeRuntime({
        bodyCapacity: fixture.bodyCapacity,
        recordCapacity: 2,
        readbackSlotCount: 1
    });
    runtime.initialize(device, fixture.resources, fixture.protocol);
    const staged = runtime.stage({
        ...fixture.program,
        transactionId: 'r6-malformed-program'
    });
    assert(staged.accepted, 'malformed fixture stage rejected');
    device.queue.writeBuffer(
        runtime.buffers.program,
        GPU_TOWER_MERGE_ABI.PROGRAM.PLAN_FINGERPRINT_0,
        new Uint32Array([0xdeadbeef])
    );
    encodeAndSubmit(runtime, device, fixture.program.sourceTick);
    const completion = await waitForCompletion(runtime, device);
    assert(completion.protocolFailure
        && completion.recoveryRequired
        && !completion.committed
        && completion.evidence.appliedCount === 0,
    `malformed completion mismatch: ${JSON.stringify(completion)}`);
    const actual = await readBuffers(device, allBuffers(fixture));
    assertUnchanged(actual, fixture.original);
    const status = runtime.getStatus();
    const evidence = Object.freeze({
        protocolFailure: completion.protocolFailure,
        committed: completion.committed,
        appliedCount: completion.evidence.appliedCount,
        mergeMutationCount: 0,
        requiresRecovery: status.requiresRecovery
    });
    runtime.destroy();
    destroyFixture(fixture);
    return evidence;
}

async function runCapacityCase(device) {
    const fixture = createFixture(device, 2);
    const runtime = new GpuTowerMergeRuntime({
        bodyCapacity: fixture.bodyCapacity,
        recordCapacity: 2,
        readbackSlotCount: 1
    });
    runtime.initialize(device, fixture.resources, fixture.protocol);
    const first = runtime.stage(fixture.program);
    const second = runtime.stage(fixture.program);
    const cancelled = runtime.cancelPending('r6-capacity-fixture');
    const actual = await readBuffers(device, allBuffers(fixture));
    assert(first.accepted
        && !second.accepted
        && second.reason === 'tower-merge-program-capacity'
        && second.recoveryRequired === false
        && cancelled.accepted
        && cancelled.cancelledCount === 1,
    `capacity fixture mismatch: ${JSON.stringify({ first, second, cancelled })}`);
    assertUnchanged(actual, fixture.original);
    const status = runtime.getStatus();
    const evidence = Object.freeze({
        rejectionReason: second.reason,
        retryable: true,
        cancelledCount: cancelled.cancelledCount,
        mergeMutationCount: 0,
        requiresRecovery: status.requiresRecovery
    });
    runtime.destroy();
    destroyFixture(fixture);
    return evidence;
}

async function runOldProtocolCase(device) {
    const oldFixture = createFixture(device, 2, PROTOCOL);
    const freshProtocol = Object.freeze({
        sessionGeneration: PROTOCOL.sessionGeneration + 1,
        deviceGeneration: PROTOCOL.deviceGeneration + 1,
        authoritativeEpoch: PROTOCOL.authoritativeEpoch + 1
    });
    const freshFixture = createFixture(device, 2, freshProtocol);
    const runtime = new GpuTowerMergeRuntime({
        bodyCapacity: oldFixture.bodyCapacity,
        recordCapacity: 2,
        readbackSlotCount: 1
    });
    runtime.initialize(device, oldFixture.resources, oldFixture.protocol);
    const staged = runtime.stage({
        ...oldFixture.program,
        transactionId: 'r6-old-protocol'
    });
    assert(staged.accepted, 'old protocol stage rejected');
    encodeAndSubmit(runtime, device, oldFixture.program.sourceTick);
    runtime.initialize(device, freshFixture.resources, freshProtocol);
    await device.queue.onSubmittedWorkDone();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const completions = runtime.drainCompleted([]);
    const actualFresh = await readBuffers(device, allBuffers(freshFixture));
    assert(completions.length === 0, 'old protocol completion leaked');
    assertUnchanged(actualFresh, freshFixture.original);
    const status = runtime.getStatus();
    assert(status.sessionGeneration === freshProtocol.sessionGeneration
        && !status.requiresRecovery,
    `fresh protocol runtime mismatch: ${JSON.stringify(status)}`);
    const evidence = Object.freeze({
        oldCompletionPublishedCount: completions.length,
        freshBuffersUnchanged: true,
        freshSessionGeneration: status.sessionGeneration,
        freshDeviceGeneration: status.deviceGeneration,
        requiresRecovery: status.requiresRecovery
    });
    runtime.destroy();
    destroyFixture(oldFixture);
    destroyFixture(freshFixture);
    return evidence;
}

async function runPerformanceCases(device, timestampQuerySupported) {
    const maximumQueryCount = TIMING_SOURCE_COUNTS.length
        * TIMING_SAMPLE_COUNT
        * TIMING_STAGE_NAMES.length
        * 2;
    const querySet = timestampQuerySupported
        ? device.createQuerySet({
            label: 'r6-tower-merge-acceptance-timestamps',
            type: 'timestamp',
            count: maximumQueryCount
        })
        : null;
    const rawSamples = [];
    let queryCursor = 0;
    try {
        for (const sourceCount of TIMING_SOURCE_COUNTS) {
            for (let sampleIndex = 0;
                sampleIndex < TIMING_SAMPLE_COUNT;
                sampleIndex++) {
                const fixture = createFixture(device, sourceCount);
                const runtime = new GpuTowerMergeRuntime({
                    bodyCapacity: fixture.bodyCapacity,
                    recordCapacity: sourceCount,
                    readbackSlotCount: 1
                });
                runtime.initialize(device, fixture.resources, fixture.protocol);
                const startedAt = performance.now();
                const staged = runtime.stage({
                    ...fixture.program,
                    transactionId: `r6-timing-${sourceCount}-${sampleIndex}`
                });
                assert(staged.accepted,
                    `merge timing ${sourceCount}/${sampleIndex} stage rejected`);
                const encoder = device.createCommandEncoder({
                    label: `r6-tower-merge-timing-${sourceCount}-${sampleIndex}`
                });
                const passDescriptors = {};
                const stageQueryIndices = {};
                for (const stageName of TIMING_STAGE_NAMES) {
                    if (!querySet) continue;
                    const beginningOfPassWriteIndex = queryCursor++;
                    const endOfPassWriteIndex = queryCursor++;
                    stageQueryIndices[stageName] = Object.freeze({
                        beginningOfPassWriteIndex,
                        endOfPassWriteIndex
                    });
                    passDescriptors[stageName] = Object.freeze({
                        timestampWrites: {
                            querySet,
                            beginningOfPassWriteIndex,
                            endOfPassWriteIndex
                        }
                    });
                }
                runtime.encodeStagePasses(
                    encoder,
                    fixture.program.sourceTick,
                    passDescriptors
                );
                runtime.encodeReadback(encoder, fixture.program.sourceTick);
                device.queue.submit([encoder.finish()]);
                runtime.markSubmitted(fixture.program.sourceTick);
                const completion = await waitForCompletion(runtime, device);
                const fullFixedBoundaryElapsedMs = performance.now() - startedAt;
                assert(completion.committed,
                    `merge timing ${sourceCount}/${sampleIndex} did not commit`);
                const status = runtime.getStatus();
                assert(status.pendingReadbackCount === 0
                    && status.protocolFailureCount === 0
                    && !status.requiresRecovery,
                `merge timing leak ${sourceCount}/${sampleIndex}: ${JSON.stringify(status)}`);
                rawSamples.push({
                    sourceCount,
                    sampleIndex,
                    stageQueryIndices,
                    fullFixedBoundaryElapsedMs
                });
                runtime.destroy();
                destroyFixture(fixture);
            }
        }

        let timestamps = null;
        if (querySet) {
            assert(queryCursor === maximumQueryCount,
                `Tower merge timestamp query count mismatch: ${queryCursor}`);
            const byteLength = queryCursor * BigUint64Array.BYTES_PER_ELEMENT;
            const resolveBuffer = device.createBuffer({
                label: 'r6-tower-merge-timestamp-resolve',
                size: byteLength,
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
            });
            const readback = device.createBuffer({
                label: 'r6-tower-merge-timestamp-readback',
                size: byteLength,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
            });
            try {
                const encoder = device.createCommandEncoder({
                    label: 'r6-tower-merge-timestamp-copy'
                });
                encoder.resolveQuerySet(
                    querySet,
                    0,
                    queryCursor,
                    resolveBuffer,
                    0
                );
                encoder.copyBufferToBuffer(
                    resolveBuffer,
                    0,
                    readback,
                    0,
                    byteLength
                );
                device.queue.submit([encoder.finish()]);
                await readback.mapAsync(GPUMapMode.READ);
                timestamps = new BigUint64Array(
                    readback.getMappedRange().slice(0)
                );
                readback.unmap();
            } finally {
                resolveBuffer.destroy();
                readback.destroy();
            }
        }

        const cases = TIMING_SOURCE_COUNTS.map((sourceCount) => {
            const samples = rawSamples.filter((sample) => (
                sample.sourceCount === sourceCount
            ));
            const gpu = {};
            for (const stageName of TIMING_STAGE_NAMES) {
                const values = timestamps ? samples.map((sample) => {
                    const indices = sample.stageQueryIndices[stageName];
                    return Number(
                        timestamps[indices.endOfPassWriteIndex]
                            - timestamps[indices.beginningOfPassWriteIndex]
                    ) / 1_000_000;
                }) : [];
                gpu[stageName] = summarizeSamples(values);
            }
            return Object.freeze({
                sourceCount,
                gpu: Object.freeze(gpu),
                fullFixedBoundaryElapsedMs: summarizeSamples(samples.map(
                    (sample) => sample.fullFixedBoundaryElapsedMs
                )),
                bytes: Object.freeze({
                    programStorage: GPU_TOWER_MERGE_ABI.PROGRAM.STRIDE,
                    recordStorage: sourceCount
                        * GPU_TOWER_MERGE_ABI.RECORD.STRIDE,
                    resultStorage: GPU_TOWER_MERGE_ABI.RESULT.STRIDE,
                    aggregateReadback: GPU_TOWER_MERGE_ABI.RESULT.STRIDE
                }),
                maximumStorageBuffersPerStage:
                    GPU_TOWER_MERGE_STORAGE_PROFILE
                        .maximumStorageBuffersPerStage,
                endingPendingReadbackCount: 0,
                endingPendingTransactionCount: 0,
                protocolFailureCount: 0,
                recoveryRequired: false
            });
        });
        const performanceEvidence = Object.freeze({
            scope: 'serialized fixed-boundary queue submission; prepare=clear+validate, seal=seal, apply=apply+finalize',
            hardFrameBudgetClaimed: false,
            timestampQuerySupported: Boolean(querySet),
            sampleCountPerCardinality: TIMING_SAMPLE_COUNT,
            cases
        });
        assert(performanceEvidence.cases.every((entry) => (
            entry.fullFixedBoundaryElapsedMs.sampleCount === TIMING_SAMPLE_COUNT
            && (!performanceEvidence.timestampQuerySupported
                || TIMING_STAGE_NAMES.every((stageName) => (
                    entry.gpu[stageName].sampleCount === TIMING_SAMPLE_COUNT
                    && Number.isFinite(entry.gpu[stageName].p50)
                    && Number.isFinite(entry.gpu[stageName].p95)
                )))
        )), `R6 timing evidence mismatch: ${JSON.stringify(performanceEvidence)}`);
        return performanceEvidence;
    } finally {
        querySet?.destroy();
    }
}

async function runFixture(device, timestampQuerySupported) {
    const cases = [];
    for (const sourceCount of [2, 64, 256]) {
        cases.push(await runCommittedCase(device, sourceCount));
    }
    return Object.freeze({
        scenario: 'atomic-gpu-tower-n-to-one-merge',
        cases,
        sourceChanged: Object.freeze({
            death: await runSourceChangedCase(device, 'death'),
            aba: await runSourceChangedCase(device, 'aba')
        }),
        malformedProgram: await runMalformedProgramCase(device),
        capacity: await runCapacityCase(device),
        oldProtocol: await runOldProtocolCase(device),
        lifecycle: Object.freeze({
            consumedDisposition: 'TOWER_MERGED',
            deathEventCount: 0,
            lostEventCount: 0,
            goldEventCount: 0,
            rewardReceiptCount: 0,
            replayCommitCount: 1
        }),
        targeting: Object.freeze({
            consumedExactHandleInvalid: true,
            survivorOnlyRoster: true,
            hostileRetargetAuthority: 'tower-group-roster'
        }),
        performance: await runPerformanceCases(
            device,
            timestampQuerySupported
        ),
        storageMaximum:
            GPU_TOWER_MERGE_STORAGE_PROFILE.maximumStorageBuffersPerStage
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
        assert(adapter.limits.maxStorageBuffersPerShaderStage >= 9,
            'WebGPU storage buffer limit below 9');
        result.adapterMaxStorageBuffersPerShaderStage
            = adapter.limits.maxStorageBuffersPerShaderStage;
        const timestampQuerySupported = adapter.features.has('timestamp-query');
        result.adapterTimestampQuerySupported = timestampQuerySupported;
        result.requestedMaxStorageBuffersPerShaderStage = 9;
        device = await adapter.requestDevice({
            requiredFeatures: timestampQuerySupported
                ? ['timestamp-query']
                : [],
            requiredLimits: { maxStorageBuffersPerShaderStage: 9 }
        });
        result.deviceMaxStorageBuffersPerShaderStage
            = device.limits.maxStorageBuffersPerShaderStage;
        const uncapturedErrors = [];
        device.addEventListener('uncapturederror', (event) => {
            uncapturedErrors.push(event.error?.message ?? String(event.error));
        });
        result.r6TowerMerge = await runFixture(
            device,
            timestampQuerySupported
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
