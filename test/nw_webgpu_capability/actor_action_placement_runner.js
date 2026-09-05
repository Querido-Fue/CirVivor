import {
    ABILITY_SUBJECT_SNAPSHOT_STATUS,
    normalizeAbilityExecutionCommand
} from './production/script/module/ingame/contract/ability_execution_contract.js';
import {
    ACTOR_PAYLOAD_CODE,
    ABILITY_TARGET_POLICY_CODE,
    GAMEPLAY_NOUN_MASK,
    SUBJECT_SELECTOR_CODE
} from './production/script/module/ingame/contract/word_sentence_contract.js';
import {
    GAMEPLAY_TEAM_ID
} from './production/script/module/ingame/contract/gameplay_team_contract.js';
import {
    R5_EMIT_ACTOR_ACTION_PROFILE,
    R5_SHOOT_ACTOR_ACTION_PROFILE,
    R5_SUMMON_ACTOR_ACTION_PROFILE,
    R5_THROW_ACTOR_ACTION_PROFILE
} from './production/script/data/word/r5_actor_action_profile_data.js';
import {
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI,
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION
} from './production/script/module/ingame/physics/gpu/gpu_ability_subject_snapshot_abi.js';
import {
    GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS,
    GPU_ACTOR_ACTION_PLACEMENT_STATUS,
    GPU_ACTOR_ACTION_TARGET_KIND,
    GPU_ACTOR_ACTION_TRANSIT_PHASE,
    computeGpuActorActionDestinationFingerprint,
    readGpuActorActionPlacementRecord,
    readGpuActorActionTransitRecord
} from './production/script/module/ingame/physics/gpu/gpu_actor_action_placement_abi.js';
import {
    GpuActorActionPlacementRuntime
} from './production/script/module/ingame/physics/gpu/gpu_actor_action_placement_runtime.js';
import {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_GAMEPLAY_META,
    GPU_CIRCLE_BODY_META,
    GPU_CIRCLE_BODY_SIMULATION_FLAG
} from './production/script/module/ingame/physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_TOWER_GROUP_ABI,
    createGpuTowerGroupHostStorage,
    writeGpuTowerGroupRoster
} from './production/script/module/ingame/physics/gpu/gpu_tower_group_abi.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const LITTLE_ENDIAN = true;
const BODY_CAPACITY = 16;
const TOWER_MEMBER_CAPACITY = 16;
const DESTINATION_SLOT_BASE = 12;
const GRID_COLUMNS = 20;
const GRID_ROWS = 20;
const GRID_MAX_BODIES_PER_CELL = 32;
const GRID_BODY_STRIDE = 32;
const SIMULATION_PARAMS_STRIDE = 4224;
const PROTOCOL = Object.freeze({
    sessionGeneration: 1,
    deviceGeneration: 1,
    authoritativeEpoch: 1
});

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function nearly(left, right, epsilon = 0.0001) {
    return Math.abs(Number(left) - Number(right)) <= epsilon;
}

function createBuffer(device, label, bytes, usage) {
    const size = bytes instanceof ArrayBuffer
        ? bytes.byteLength
        : bytes.byteLength;
    const buffer = device.createBuffer({ label, size, usage });
    device.queue.writeBuffer(buffer, 0, bytes);
    return buffer;
}

function teamGameplayMeta(teamId) {
    return ((teamId & GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_MASK)
        << GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_SHIFT) >>> 0;
}

function writeBody(physicsBytes, simulationBytes, slot, source = {}) {
    const physics = new DataView(physicsBytes);
    const simulation = new DataView(simulationBytes);
    const p = GPU_CIRCLE_BODY_ABI.PHYSICS;
    const s = GPU_CIRCLE_BODY_ABI.SIMULATION;
    const pBase = slot * p.STRIDE;
    const sBase = slot * s.STRIDE;
    physics.setFloat32(pBase + p.POSITION_X, source.position?.x ?? 0,
        LITTLE_ENDIAN);
    physics.setFloat32(pBase + p.POSITION_Y, source.position?.y ?? 0,
        LITTLE_ENDIAN);
    physics.setFloat32(pBase + p.VELOCITY_X, source.velocity?.x ?? 0,
        LITTLE_ENDIAN);
    physics.setFloat32(pBase + p.VELOCITY_Y, source.velocity?.y ?? 0,
        LITTLE_ENDIAN);
    physics.setFloat32(pBase + p.RADIUS, source.radius ?? 0.5,
        LITTLE_ENDIAN);
    physics.setFloat32(pBase + p.INVERSE_MASS, source.inverseMass ?? 1,
        LITTLE_ENDIAN);
    physics.setUint32(pBase + p.PHYSICAL_META, source.physicalMeta ?? 0,
        LITTLE_ENDIAN);
    physics.setUint32(pBase + p.INTERACTION_META,
        source.interactionMeta ?? 0, LITTLE_ENDIAN);
    simulation.setFloat32(sBase + s.LIFETIME, source.lifetime ?? 10,
        LITTLE_ENDIAN);
    simulation.setInt32(sBase + s.HEALTH, source.health ?? 100,
        LITTLE_ENDIAN);
    simulation.setUint32(sBase + s.GAMEPLAY_META,
        teamGameplayMeta(source.teamId ?? GAMEPLAY_TEAM_ID.NEUTRAL),
        LITTLE_ENDIAN);
    simulation.setUint32(sBase + s.FLAGS,
        source.alive === true ? GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE : 0,
        LITTLE_ENDIAN);
    simulation.setUint32(sBase + s.ENTITY_ID, source.entityId ?? 0,
        LITTLE_ENDIAN);
    simulation.setUint32(sBase + s.INCARNATION, source.incarnation ?? 0,
        LITTLE_ENDIAN);
}

function writeAbilityMetadata(metadataBytes, slot, nounMask) {
    const view = new DataView(metadataBytes);
    const layout = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA;
    const base = slot * layout.STRIDE;
    view.setUint32(base + layout.ABI_VERSION, 1, LITTLE_ENDIAN);
    view.setUint32(base + layout.NOUN_MASK, nounMask, LITTLE_ENDIAN);
}

function writeSnapshot(snapshotBytes, rank, source) {
    const view = new DataView(snapshotBytes);
    const r = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD;
    const base = rank * r.STRIDE;
    const uintValues = [
        [r.PRIVATE_SLOT, source.slot],
        [r.ENTITY_ID, source.entityId],
        [r.INCARNATION, source.incarnation],
        [r.TEAM_ID, source.teamId],
        [r.FLOW_FIELD_INDEX, source.flowFieldIndex ?? 0],
        [r.ROUTE_PATH_INDEX, source.routePathIndex ?? 0],
        [r.ROUTE_SET_INDEX, source.routeSetIndex ?? 0],
        [r.DEFINITION_CODE, source.definitionCode ?? 1],
        [r.GENERATION, source.generation ?? 0],
        [r.OWNER_ENTITY_ID, 0],
        [r.OWNER_INCARNATION, 0],
        [r.DAMAGE_INPUT_BITS, 0],
        [r.HEALTH_FIXED_POINT, 100],
        [r.SOURCE_EXECUTION_ORDINAL, 0],
        [r.POWER_FIXED_POINT, 100],
        [r.SOURCE_EXECUTION_FINGERPRINT, 0],
        [r.SOURCE_ABILITY_CODE, 0],
        [r.CREATION_ORIGIN_CODE, 1],
        [r.ROUTE_META, 0],
        [r.ROUTE_PROFILE_CODE, 0]
    ];
    for (const [offset, value] of uintValues) {
        view.setUint32(base + offset, value >>> 0, LITTLE_ENDIAN);
    }
    const floatValues = [
        [r.POSITION_X, source.position.x],
        [r.POSITION_Y, source.position.y],
        [r.VELOCITY_X, source.velocity?.x ?? 0],
        [r.VELOCITY_Y, source.velocity?.y ?? 0],
        [r.FACING_X, source.facing?.x ?? 0],
        [r.FACING_Y, source.facing?.y ?? 0],
        [r.RADIUS, source.radius ?? 0.5],
        [r.FLOW_SPEED, source.flowSpeed ?? 0]
    ];
    for (const [offset, value] of floatValues) {
        view.setFloat32(base + offset, value, LITTLE_ENDIAN);
    }
}

function createCommand({ selectorCode, profile, aimPoint, ordinal }) {
    const towerSubject = selectorCode === SUBJECT_SELECTOR_CODE.TOWER;
    const actionCode = profile.actionCode;
    const compiledAbility = Object.freeze({
        compiledAbilityId: `fixture.r5.actor-action.${selectorCode}.${actionCode}`,
        schemaVersion: 1,
        protocolVersion: 1,
        subjectSelector: Object.freeze({
            code: selectorCode,
            nounMask: towerSubject
                ? GAMEPLAY_NOUN_MASK.TOWER
                : GAMEPLAY_NOUN_MASK.ENEMY,
            teamId: towerSubject
                ? GAMEPLAY_TEAM_ID.PLAYER
                : GAMEPLAY_TEAM_ID.HOSTILE
        }),
        actionCode,
        actorActionProfileId: profile.id,
        actorActionProfileFingerprint:
            profile.actorActionProfileFingerprint,
        actorActionProfile: profile,
        payloadCode: ACTOR_PAYLOAD_CODE.ENEMY,
        targetPolicyCode: towerSubject
            ? ABILITY_TARGET_POLICY_CODE.SHARED_AIM_POINT
            : ABILITY_TARGET_POLICY_CODE.NEAREST_TOWER_THEN_CORE_THEN_FACING,
        budgets: Object.freeze({ subjectCount: 1000, generation: 65535 })
    });
    return Object.freeze({
        executionId: `execution.r5.actor-action.${ordinal}`,
        executionOrdinal: ordinal,
        targetFixedTick: 1,
        subjectLimit: 1000,
        generationLimit: 65535,
        aimPoint,
        compiledAbility
    });
}

function defaultPlayerSubject(rank = 0, overrides = {}) {
    return Object.freeze({
        slot: rank,
        entityId: 100 + rank,
        incarnation: 1000 + rank,
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
        position: Object.freeze({ x: 5, y: 5 }),
        velocity: Object.freeze({ x: 0, y: 0 }),
        facing: Object.freeze({ x: 1, y: 0 }),
        radius: 0.5,
        generation: 0,
        ...overrides
    });
}

function defaultHostileSubject(overrides = {}) {
    return defaultPlayerSubject(0, {
        entityId: 500,
        incarnation: 5000,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        position: Object.freeze({ x: 10, y: 10 }),
        ...overrides
    });
}

function makeDestinationLeases(subjectCount) {
    return Object.freeze(Array.from({ length: subjectCount }, (_, rank) => (
        Object.freeze({
            destinationSlot: DESTINATION_SLOT_BASE + rank,
            destinationEntityId: 900 + rank,
            destinationIncarnation: 9000 + rank,
            snapshotRank: rank,
            destinationRank: rank,
            baselineFlags: 0
        })
    )));
}

function createCaseResources(device, source = {}) {
    const subjects = source.subjects ?? [defaultPlayerSubject()];
    const destinations = source.destinations ?? subjects.map(() => ({
        radius: 0.5
    }));
    const towers = source.towers ?? [];
    const core = source.core ?? null;
    const physicsBytes = new ArrayBuffer(
        BODY_CAPACITY * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE
    );
    const simulationBytes = new ArrayBuffer(
        BODY_CAPACITY * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE
    );
    const metadataBytes = new ArrayBuffer(
        BODY_CAPACITY
            * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA.STRIDE
    );
    const snapshotBytes = new ArrayBuffer(
        subjects.length
            * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE
    );

    subjects.forEach((subject, rank) => {
        writeSnapshot(snapshotBytes, rank, subject);
        writeBody(physicsBytes, simulationBytes, subject.slot, {
            ...subject,
            alive: false
        });
    });
    const destinationLeases = makeDestinationLeases(subjects.length);
    destinations.forEach((destination, rank) => {
        const lease = destinationLeases[rank];
        writeBody(physicsBytes, simulationBytes, lease.destinationSlot, {
            position: { x: 0, y: 0 },
            radius: destination.radius ?? 0.5,
            entityId: lease.destinationEntityId,
            incarnation: lease.destinationIncarnation,
            alive: false,
            teamId: GAMEPLAY_TEAM_ID.NEUTRAL
        });
    });
    towers.forEach((tower) => {
        writeBody(physicsBytes, simulationBytes, tower.slot, {
            ...tower,
            alive: true,
            radius: tower.radius ?? 0.5,
            teamId: GAMEPLAY_TEAM_ID.PLAYER,
            interactionMeta:
                GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
        });
        writeAbilityMetadata(metadataBytes, tower.slot,
            GAMEPLAY_NOUN_MASK.TOWER);
    });
    if (core) {
        writeBody(physicsBytes, simulationBytes, core.slot, {
            ...core,
            alive: true,
            radius: core.radius ?? 0.75,
            teamId: GAMEPLAY_TEAM_ID.NEUTRAL
        });
    }

    const towerStorage = createGpuTowerGroupHostStorage(
        TOWER_MEMBER_CAPACITY
    );
    writeGpuTowerGroupRoster(towerStorage, {
        protocol: PROTOCOL,
        groupRevision: source.groupRevision ?? 1,
        members: towers.map((tower, index) => ({
            slot: tower.slot,
            entityId: tower.entityId,
            incarnation: tower.incarnation,
            logicalTowerOrdinal: tower.logicalTowerOrdinal ?? index + 1,
            shareUnits: tower.shareUnits ?? 100,
            maxHpFixedPoint: 100,
            powerFixedPoint: 100
        }))
    });
    const sdfValues = new Float32Array(source.sdfValues ?? [100]);
    const paramsBytes = new ArrayBuffer(SIMULATION_PARAMS_STRIDE);
    const paramsView = new DataView(paramsBytes);
    paramsView.setFloat32(0, 20, LITTLE_ENDIAN);
    paramsView.setFloat32(4, 20, LITTLE_ENDIAN);
    paramsView.setFloat32(8, 1, LITTLE_ENDIAN);
    paramsView.setFloat32(12, 1, LITTLE_ENDIAN);
    paramsView.setUint32(16, GRID_COLUMNS, LITTLE_ENDIAN);
    paramsView.setUint32(20, GRID_ROWS, LITTLE_ENDIAN);
    paramsView.setUint32(24, GRID_MAX_BODIES_PER_CELL, LITTLE_ENDIAN);
    paramsView.setFloat32(32, 1 / 60, LITTLE_ENDIAN);
    paramsView.setFloat32(36, 60, LITTLE_ENDIAN);
    paramsView.setUint32(40, sdfValues.length, LITTLE_ENDIAN);
    paramsView.setUint32(44, 1, LITTLE_ENDIAN);
    paramsView.setUint32(48, source.sdfEnabled === true ? 1 : 0,
        LITTLE_ENDIAN);
    paramsView.setFloat32(4192 + 12, 0.75, LITTLE_ENDIAN);
    const gridCounterCount = GRID_COLUMNS * GRID_ROWS * 2;
    const gridCounts = new Uint32Array(gridCounterCount);
    const gridBodies = new ArrayBuffer(
        gridCounterCount * GRID_MAX_BODIES_PER_CELL * GRID_BODY_STRIDE
    );
    const storageUsage = GPUBufferUsage.STORAGE
        | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const buffers = Object.freeze({
        snapshot: createBuffer(device, 'r5-placement-snapshot',
            snapshotBytes, storageUsage),
        physics: createBuffer(device, 'r5-placement-physics',
            physicsBytes, storageUsage),
        simulation: createBuffer(device, 'r5-placement-simulation',
            simulationBytes, storageUsage),
        abilityMetadata: createBuffer(device, 'r5-placement-metadata',
            metadataBytes, storageUsage),
        towerMembers: createBuffer(device, 'r5-placement-tower-members',
            towerStorage.memberStates, storageUsage),
        towerRoster: createBuffer(device, 'r5-placement-tower-roster',
            towerStorage.roster, storageUsage),
        sdf: createBuffer(device, 'r5-placement-sdf',
            sdfValues, storageUsage),
        params: createBuffer(device, 'r5-placement-params', paramsBytes,
            GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
        gridCounts: createBuffer(device, 'r5-placement-grid-counts',
            gridCounts, storageUsage),
        gridBodies: createBuffer(device, 'r5-placement-grid-bodies',
            gridBodies, storageUsage)
    });
    return Object.freeze({
        subjects,
        destinations,
        destinationLeases,
        snapshotBytes,
        simulationBytes,
        buffers,
        coreTarget: core ? Object.freeze({
            slot: core.slot,
            entityId: core.entityId,
            incarnation: core.incarnation
        }) : null,
        sdf: Object.freeze({
            cols: sdfValues.length,
            rows: 1,
            enabled: source.sdfEnabled === true,
            worldWidth: 20,
            worldHeight: 20
        }),
        destroy() {
            for (const buffer of Object.values(buffers)) buffer.destroy();
        }
    });
}

async function readPlacementBinding(device, binding) {
    const byteLength = binding.placementByteLength + binding.transitByteLength;
    const readback = device.createBuffer({
        label: 'r5-placement-diagnostic-readback',
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const encoder = device.createCommandEncoder({
        label: 'r5-placement-diagnostic-copy'
    });
    encoder.copyBufferToBuffer(
        binding.buffer,
        binding.placementByteOffset,
        readback,
        0,
        binding.placementByteLength
    );
    encoder.copyBufferToBuffer(
        binding.buffer,
        binding.transitByteOffset,
        readback,
        binding.placementByteLength,
        binding.transitByteLength
    );
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const copied = readback.getMappedRange().slice(0);
    readback.unmap();
    readback.destroy();
    const placementBytes = copied.slice(0, binding.placementByteLength);
    const transitBytes = copied.slice(binding.placementByteLength);
    return Object.freeze({
        placements: Object.freeze(Array.from(
            { length: binding.destinationCount },
            (_, rank) => readGpuActorActionPlacementRecord(
                placementBytes,
                rank
            )
        )),
        transits: Object.freeze(Array.from(
            { length: binding.destinationCount },
            (_, rank) => readGpuActorActionTransitRecord(transitBytes, rank)
        ))
    });
}

async function waitForCompletion(runtime) {
    await runtime.device.queue.onSubmittedWorkDone();
    for (let attempt = 0; attempt < 500; attempt++) {
        const completed = runtime.drainCompleted([]);
        if (completed.length > 0) return completed[0];
        const status = runtime.getStatus();
        if (status.state === 'failed' || status.failure) {
            throw new Error(
                `ActorAction placement aggregate readback failed: ${JSON.stringify(status)}`
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(
        `ActorAction placement aggregate readback timeout: ${JSON.stringify(runtime.getStatus())}`
    );
}

async function runGpuCase(device, source) {
    const resources = createCaseResources(device, source);
    const command = createCommand({
        selectorCode: source.selectorCode,
        profile: source.profile,
        aimPoint: source.aimPoint,
        ordinal: source.ordinal
    });
    const normalized = normalizeAbilityExecutionCommand(command);
    const snapshotFingerprint = (0x50000000 + source.ordinal) >>> 0;
    const completion = Object.freeze({
        status: ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE,
        subjectCount: resources.subjects.length,
        capacityDemand: resources.subjects.length,
        errorFlags: 0,
        executionOrdinal: normalized.executionOrdinal,
        commandFingerprint: normalized.fingerprint,
        snapshotFingerprint,
        sourceTick: 1
    });
    const snapshotBinding = Object.freeze({
        abiVersion: GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION,
        buffer: resources.buffers.snapshot,
        byteOffset: 0,
        wordOffset: 0,
        byteLength: resources.snapshotBytes.byteLength,
        recordStride: GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE,
        subjectCount: resources.subjects.length,
        executionOrdinal: normalized.executionOrdinal,
        commandFingerprint: normalized.fingerprint,
        snapshotFingerprint,
        sessionGeneration: PROTOCOL.sessionGeneration,
        deviceGeneration: PROTOCOL.deviceGeneration,
        authoritativeEpoch: PROTOCOL.authoritativeEpoch,
        sourceTick: 1
    });
    const runtime = new GpuActorActionPlacementRuntime({
        sessionGeneration: PROTOCOL.sessionGeneration,
        commandCapacity: 2,
        readbackSlotCount: 1,
        subjectCapacity: 8
    });
    runtime.initialize(device, resources.buffers, {
        ...PROTOCOL,
        bodyCapacity: BODY_CAPACITY,
        towerMemberCapacity: TOWER_MEMBER_CAPACITY
    });
    const staged = runtime.stage({
        transactionId: `transaction.r5.actor-action.${source.ordinal}`,
        command,
        subjectCompletion: completion,
        snapshotBinding,
        destinationLeases: resources.destinationLeases,
        actorActionProfile: source.profile,
        targetFixedTick: 1,
        coreTarget: resources.coreTarget,
        sdf: resources.sdf
    });
    assert(staged.accepted, `placement stage rejected: ${staged.message}`);
    const submitted = runtime.submitPendingForFixedTick(1);
    assert(submitted.submittedCount === 1,
        `placement submit count: ${submitted.submittedCount}`);
    const completionResult = await waitForCompletion(runtime);
    let diagnostic = Object.freeze({ placements: [], transits: [] });
    if (completionResult.placementToken) {
        const binding = runtime.getPlacementGpuBinding(
            completionResult.placementToken
        );
        assert(binding, 'complete placement token binding missing');
        diagnostic = await readPlacementBinding(device, binding);
        assert(runtime.releasePlacement(completionResult.placementToken),
            'placement token release failed');
    }
    const status = runtime.getStatus();
    runtime.destroy();
    resources.destroy();
    return Object.freeze({
        completion: completionResult,
        placements: diagnostic.placements,
        transits: diagnostic.transits,
        status,
        sourceBodiesWereDead: resources.subjects.every((subject) => {
            const view = new DataView(resources.simulationBytes);
            const base = subject.slot * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
            const flags = view.getUint32(
                base + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
                LITTLE_ENDIAN
            );
            return (flags & GPU_CIRCLE_BODY_META.ALIVE_BIT) === 0;
        })
    });
}

async function runNegativeContracts(device) {
    const resources = createCaseResources(device, {
        subjects: [defaultPlayerSubject()],
        sdfValues: [100]
    });
    const command = createCommand({
        selectorCode: SUBJECT_SELECTOR_CODE.TOWER,
        profile: R5_SHOOT_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 10, y: 5 },
        ordinal: 100
    });
    const normalized = normalizeAbilityExecutionCommand(command);
    const completion = Object.freeze({
        status: ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE,
        subjectCount: 1,
        capacityDemand: 1,
        errorFlags: 0,
        executionOrdinal: normalized.executionOrdinal,
        commandFingerprint: normalized.fingerprint,
        snapshotFingerprint: 0x71000001,
        sourceTick: 1
    });
    const binding = Object.freeze({
        abiVersion: GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION,
        buffer: resources.buffers.snapshot,
        byteOffset: 0,
        wordOffset: 0,
        byteLength: resources.snapshotBytes.byteLength,
        recordStride: GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE,
        subjectCount: 1,
        executionOrdinal: normalized.executionOrdinal,
        commandFingerprint: normalized.fingerprint,
        snapshotFingerprint: completion.snapshotFingerprint,
        ...PROTOCOL,
        sourceTick: 1
    });
    const runtime = new GpuActorActionPlacementRuntime({
        sessionGeneration: 1,
        commandCapacity: 1,
        readbackSlotCount: 1,
        subjectCapacity: 1
    });
    runtime.initialize(device, resources.buffers, {
        ...PROTOCOL,
        bodyCapacity: BODY_CAPACITY,
        towerMemberCapacity: TOWER_MEMBER_CAPACITY
    });
    const base = {
        command,
        subjectCompletion: completion,
        snapshotBinding: binding,
        destinationLeases: resources.destinationLeases,
        actorActionProfile: R5_SHOOT_ACTOR_ACTION_PROFILE,
        targetFixedTick: 1,
        sdf: resources.sdf
    };
    const oneShort = runtime.stage({
        ...base,
        transactionId: 'negative.one-short',
        destinationLeases: []
    });
    const stableRank = runtime.stage({
        ...base,
        transactionId: 'negative.stable-rank',
        destinationLeases: [{
            ...resources.destinationLeases[0],
            snapshotRank: 1
        }]
    });
    const staleDevice = runtime.stage({
        ...base,
        transactionId: 'negative.stale-device',
        snapshotBinding: { ...binding, deviceGeneration: 2 }
    });
    const staleDestination = runtime.stage({
        ...base,
        transactionId: 'negative.destination-fingerprint',
        destinationFingerprint: (
            computeGpuActorActionDestinationFingerprint(
                resources.destinationLeases,
                normalized.fingerprint
            ) ^ 1
        ) >>> 0
    });
    const accepted = runtime.stage({
        ...base,
        transactionId: 'negative.capacity.first'
    });
    const capacity = runtime.stage({
        ...base,
        transactionId: 'negative.capacity.second'
    });
    const status = runtime.getStatus();
    runtime.destroy();
    resources.destroy();
    return Object.freeze({
        oneShortRejected: oneShort.accepted === false,
        stableRankRejected: stableRank.accepted === false,
        staleDeviceRejected: staleDevice.accepted === false,
        staleDestinationFingerprintRejected:
            staleDestination.accepted === false,
        capacityRejected: accepted.accepted === true
            && capacity.accepted === false
            && capacity.reason === 'actor-action-placement-capacity',
        status
    });
}

async function runFixture(device) {
    let ordinal = 1;
    const nextOrdinal = () => ordinal++;
    const shoot = await runGpuCase(device, {
        ordinal: nextOrdinal(),
        selectorCode: SUBJECT_SELECTOR_CODE.TOWER,
        profile: R5_SHOOT_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 10, y: 5 },
        subjects: [defaultPlayerSubject()],
        sdfValues: [100]
    });
    const emit = await runGpuCase(device, {
        ordinal: nextOrdinal(),
        selectorCode: SUBJECT_SELECTOR_CODE.TOWER,
        profile: R5_EMIT_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 10, y: 5 },
        subjects: [defaultPlayerSubject()],
        sdfValues: [100]
    });
    const summonSubjects = Array.from({ length: 3 }, (_, rank) => (
        defaultPlayerSubject(rank)
    ));
    const summon = await runGpuCase(device, {
        ordinal: nextOrdinal(),
        selectorCode: SUBJECT_SELECTOR_CODE.TOWER,
        profile: R5_SUMMON_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 10, y: 5 },
        subjects: summonSubjects,
        sdfValues: [100]
    });
    const throwing = await runGpuCase(device, {
        ordinal: nextOrdinal(),
        selectorCode: SUBJECT_SELECTOR_CODE.TOWER,
        profile: R5_THROW_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 10, y: 5 },
        subjects: [defaultPlayerSubject()],
        sdfValues: [100]
    });
    const exactThrowSdf = new Array(20).fill(0.5);
    const blockedThrowSourceSdf = new Array(20).fill(0);
    const blockedThrowLandingSdf = exactThrowSdf.slice();
    blockedThrowLandingSdf[9] = 0;
    blockedThrowLandingSdf[10] = 0;
    const throwSdfExact = await runGpuCase(device, {
        ordinal: nextOrdinal(),
        selectorCode: SUBJECT_SELECTOR_CODE.TOWER,
        profile: R5_THROW_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 10, y: 5 },
        subjects: [defaultPlayerSubject()],
        destinations: [{ radius: 0.5 }],
        sdfValues: exactThrowSdf,
        sdfEnabled: true
    });
    const throwSourceSdfReject = await runGpuCase(device, {
        ordinal: nextOrdinal(),
        selectorCode: SUBJECT_SELECTOR_CODE.TOWER,
        profile: R5_THROW_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 10, y: 5 },
        subjects: [defaultPlayerSubject()],
        destinations: [{ radius: 0.5 }],
        sdfValues: blockedThrowSourceSdf,
        sdfEnabled: true
    });
    const throwLandingSdfReject = await runGpuCase(device, {
        ordinal: nextOrdinal(),
        selectorCode: SUBJECT_SELECTOR_CODE.TOWER,
        profile: R5_THROW_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 10, y: 5 },
        subjects: [defaultPlayerSubject()],
        destinations: [{ radius: 0.5 }],
        sdfValues: blockedThrowLandingSdf,
        sdfEnabled: true
    });

    const nearestTower = await runGpuCase(device, {
        ordinal: nextOrdinal(),
        selectorCode: SUBJECT_SELECTOR_CODE.ENEMY,
        profile: R5_SHOOT_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 0, y: 0 },
        subjects: [defaultHostileSubject()],
        towers: [
            { slot: 2, entityId: 202, incarnation: 2002,
                position: { x: 12, y: 10 }, logicalTowerOrdinal: 1 },
            { slot: 3, entityId: 203, incarnation: 2003,
                position: { x: 15, y: 10 }, logicalTowerOrdinal: 2 }
        ],
        sdfValues: [100]
    });
    const coreFallback = await runGpuCase(device, {
        ordinal: nextOrdinal(),
        selectorCode: SUBJECT_SELECTOR_CODE.ENEMY,
        profile: R5_SHOOT_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 0, y: 0 },
        subjects: [defaultHostileSubject()],
        core: { slot: 4, entityId: 304, incarnation: 3004,
            position: { x: 8, y: 10 } },
        sdfValues: [100]
    });
    const facingFallback = await runGpuCase(device, {
        ordinal: nextOrdinal(),
        selectorCode: SUBJECT_SELECTOR_CODE.ENEMY,
        profile: R5_SHOOT_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 0, y: 0 },
        subjects: [defaultHostileSubject({ facing: { x: 0, y: -1 } })],
        sdfValues: [100]
    });

    const velocityDirection = await runGpuCase(device, {
        ordinal: nextOrdinal(),
        selectorCode: SUBJECT_SELECTOR_CODE.TOWER,
        profile: R5_SHOOT_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 5, y: 5 },
        subjects: [defaultPlayerSubject(0, {
            velocity: { x: 0, y: 2 }, facing: { x: -1, y: 0 }
        })],
        sdfValues: [100]
    });
    const facingDirection = await runGpuCase(device, {
        ordinal: nextOrdinal(),
        selectorCode: SUBJECT_SELECTOR_CODE.TOWER,
        profile: R5_SHOOT_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 5, y: 5 },
        subjects: [defaultPlayerSubject(0, {
            velocity: { x: 0, y: 0 }, facing: { x: -1, y: 0 }
        })],
        sdfValues: [100]
    });
    const positiveXDirection = await runGpuCase(device, {
        ordinal: nextOrdinal(),
        selectorCode: SUBJECT_SELECTOR_CODE.TOWER,
        profile: R5_SHOOT_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 5, y: 5 },
        subjects: [defaultPlayerSubject(0, {
            velocity: { x: 0, y: 0 }, facing: { x: 0, y: 0 }
        })],
        sdfValues: [100]
    });

    const sdfExact = await runGpuCase(device, {
        ordinal: nextOrdinal(),
        selectorCode: SUBJECT_SELECTOR_CODE.TOWER,
        profile: R5_SHOOT_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 10, y: 5 },
        subjects: [defaultPlayerSubject()],
        destinations: [{ radius: 0.5 }],
        sdfValues: [0.5],
        sdfEnabled: true
    });
    const sdfAtomicReject = await runGpuCase(device, {
        ordinal: nextOrdinal(),
        selectorCode: SUBJECT_SELECTOR_CODE.TOWER,
        profile: R5_SHOOT_ACTOR_ACTION_PROFILE,
        aimPoint: { x: 10, y: 5 },
        subjects: [defaultPlayerSubject(0), defaultPlayerSubject(1)],
        destinations: [{ radius: 0.5 }, { radius: 0.75 }],
        sdfValues: [0.5],
        sdfEnabled: true
    });
    const negative = await runNegativeContracts(device);

    const completedAction = (value) => value.completion.status
            === GPU_ACTOR_ACTION_PLACEMENT_STATUS.COMPLETE
        && value.placements.every((record) => (
            record.status === GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS.VALID
        ));
    for (const [name, value] of Object.entries({
        shoot,
        emit,
        summon,
        throw: throwing
    })) {
        assert(completedAction(value), `${name} action placement incomplete`);
    }
    const summonExpected = [[10, 5], [11.0625, 5], [11.0625, 6.0625]];
    const stableLattice = summon.placements.every((record, rank) => (
        nearly(record.spawnPosition.x, summonExpected[rank][0])
        && nearly(record.spawnPosition.y, summonExpected[rank][1])
    ));
    const throwTransit = throwing.transits[0];
    const throwRecord = throwing.placements[0];

    const evidence = Object.freeze({
        scenario: 'r5-gpu-actor-action-placement-side-plane',
        actions: Object.freeze({
            shoot: Object.freeze({
                status: shoot.completion.status,
                validCount: shoot.completion.validCount,
                subjectCount: shoot.completion.subjectCount,
                launchExact: nearly(shoot.placements[0].spawnPosition.x, 6.0625)
                    && nearly(shoot.placements[0].initialVelocity.x, 7)
                    && shoot.placements[0].activationTick === 2
            }),
            emit: Object.freeze({
                status: emit.completion.status,
                validCount: emit.completion.validCount,
                subjectCount: emit.completion.subjectCount,
                zeroVelocity: nearly(emit.placements[0].initialVelocity.x, 0)
                    && nearly(emit.placements[0].initialVelocity.y, 0)
            }),
            summon: Object.freeze({
                status: summon.completion.status,
                validCount: summon.completion.validCount,
                subjectCount: summon.completion.subjectCount,
                stableLattice
            }),
            throw: Object.freeze({
                status: throwing.completion.status,
                validCount: throwing.completion.validCount,
                subjectCount: throwing.completion.subjectCount,
                airborneExact: throwTransit.phase
                        === GPU_ACTOR_ACTION_TRANSIT_PHASE.AIRBORNE
                    && throwRecord.transitDurationFixedTicks === 30
                    && throwRecord.activationTick === 31
                    && throwTransit.durationFixedTicks === 30
                    && throwTransit.flags === 15
                    && nearly(throwTransit.landingPosition.x, 10)
                    && nearly(throwTransit.landingPosition.y, 5),
                durationDerivedGroundSpeed:
                    nearly(
                        throwRecord.initialVelocity.x,
                        (throwRecord.targetPosition.x
                            - throwRecord.spawnPosition.x) * 60 / 30
                    )
                    && nearly(
                        throwRecord.initialVelocity.y,
                        (throwRecord.targetPosition.y
                            - throwRecord.spawnPosition.y) * 60 / 30
                    )
            })
        }),
        targeting: Object.freeze({
            sharedAim: shoot.placements[0].targetKind
                    === GPU_ACTOR_ACTION_TARGET_KIND.AIM
                && nearly(shoot.placements[0].targetPosition.x, 10),
            nearestTower: nearestTower.placements[0].targetKind
                    === GPU_ACTOR_ACTION_TARGET_KIND.TOWER
                && nearestTower.placements[0].targetSlot === 2
                && nearestTower.placements[0].targetEntityId === 202,
            coreFallback: coreFallback.placements[0].targetKind
                    === GPU_ACTOR_ACTION_TARGET_KIND.CORE
                && coreFallback.placements[0].targetSlot === 4,
            facingFallback: facingFallback.placements[0].targetKind
                    === GPU_ACTOR_ACTION_TARGET_KIND.FACING
                && nearly(facingFallback.placements[0].direction.x, 0)
                && nearly(facingFallback.placements[0].direction.y, -1)
        }),
        degenerate: Object.freeze({
            velocityFallback: nearly(
                velocityDirection.placements[0].direction.x,
                0
            ) && nearly(velocityDirection.placements[0].direction.y, 1),
            facingFallback: nearly(facingDirection.placements[0].direction.x,
                -1) && nearly(facingDirection.placements[0].direction.y, 0),
            positiveXFallback: nearly(
                positiveXDirection.placements[0].direction.x,
                1
            ) && nearly(positiveXDirection.placements[0].direction.y, 0)
        }),
        sdf: Object.freeze({
            exactStatus: sdfExact.completion.status,
            atomicRejectStatus: sdfAtomicReject.completion.status,
            atomicRejectValidCount: sdfAtomicReject.completion.validCount,
            atomicRejectSubjectCount: sdfAtomicReject.completion.subjectCount,
            throwExactStatus: throwSdfExact.completion.status,
            throwSourceRejectStatus: throwSourceSdfReject.completion.status,
            throwLandingRejectStatus: throwLandingSdfReject.completion.status
        }),
        contracts: Object.freeze({
            actorActionProfileFingerprintBound: [
                [shoot, R5_SHOOT_ACTOR_ACTION_PROFILE],
                [emit, R5_EMIT_ACTOR_ACTION_PROFILE],
                [summon, R5_SUMMON_ACTOR_ACTION_PROFILE],
                [throwing, R5_THROW_ACTOR_ACTION_PROFILE]
            ].every(([result, profile]) => (
                result.completion.actorActionProfileFingerprint
                    === profile.actorActionProfileFingerprint
            )),
            sourceDeathSnapshotComplete: shoot.sourceBodiesWereDead
                && completedAction(shoot),
            stableRankRejected: negative.stableRankRejected,
            oneShortRejected: negative.oneShortRejected,
            capacityRejected: negative.capacityRejected,
            staleDeviceRejected: negative.staleDeviceRejected,
            staleDestinationFingerprintRejected:
                negative.staleDestinationFingerprintRejected,
            aggregateReadbackByteSize:
                negative.status.aggregateReadbackByteSize,
            placementRecordCpuReadback:
                negative.status.placementRecordCpuReadback,
            transitRecordCpuReadback:
                negative.status.transitRecordCpuReadback,
            bodyStateCommitCount: negative.status.bodyStateCommitCount,
            storageMaximum: negative.status.storageBindingCount,
            dispatchStorageBindingCount:
                negative.status.dispatchStorageBindingCount
        })
    });
    assert(stableLattice, 'Summon stable-rank lattice mismatch');
    assert(evidence.actions.throw.durationDerivedGroundSpeed,
        'Throw ground speed was not derived from distance/duration');
    assert(evidence.contracts.actorActionProfileFingerprintBound,
        'ActorAction profile fingerprint did not survive completion identity');
    assert(sdfAtomicReject.completion.status
        === GPU_ACTOR_ACTION_PLACEMENT_STATUS.SDF_REJECTED,
    'SDF one-invalid batch did not reject atomically');
    assert(throwSdfExact.completion.status
        === GPU_ACTOR_ACTION_PLACEMENT_STATUS.COMPLETE,
    'Throw exact source/landing SDF did not complete');
    assert(throwSourceSdfReject.completion.status
        === GPU_ACTOR_ACTION_PLACEMENT_STATUS.SDF_REJECTED,
    'Throw invalid source spawn SDF was not rejected');
    assert(throwLandingSdfReject.completion.status
        === GPU_ACTOR_ACTION_PLACEMENT_STATUS.SDF_REJECTED,
    'Throw invalid landing SDF was not rejected');
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
        result.actorActionPlacement = await runFixture(device);
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
