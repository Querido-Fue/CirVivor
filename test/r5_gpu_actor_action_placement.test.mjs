import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ABILITY_SUBJECT_SNAPSHOT_STATUS,
    normalizeAbilityExecutionCommand
} = await loadGameModule('ingame/contract/ability_execution_contract.js');
const {
    R5_ACTOR_ACTION_PROFILES,
    R5_SHOOT_ACTOR_ACTION_PROFILE,
    R5_SUMMON_ACTOR_ACTION_PROFILE,
    R5_THROW_ACTOR_ACTION_PROFILE
} = await loadGameModule('data/word/r5_actor_action_profile_data.js');
const {
    R3_TOWER_SHOOTS_ENEMY_SENTENCE
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    SentenceCompiler
} = await loadGameModule('ingame/word/sentence_compiler.js');
const {
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI,
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION
} = await loadGameModule(
    'ingame/physics/gpu/gpu_ability_subject_snapshot_abi.js'
);
const {
    GPU_ACTOR_ACTION_PLACEMENT_ABI,
    GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION,
    GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS,
    GPU_ACTOR_ACTION_PLACEMENT_STATUS,
    GPU_ACTOR_ACTION_TRANSIT_FLAG,
    computeActorActionSummonLatticeOffset,
    computeActorActionSummonLatticePosition,
    computeGpuActorActionDestinationFingerprint,
    createGpuActorActionPlacementOutputLayout,
    createGpuActorActionProgramStorage,
    encodeGpuActorActionProfile,
    readGpuActorActionPlacementAggregate,
    readGpuActorActionPlacementRecord,
    readGpuActorActionTransitRecord,
    isActorActionSummonAnchorDistanceValid,
    resolveActorActionDegenerateDirection,
    writeGpuActorActionDestinationLease,
    writeGpuActorActionProgramHeader
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_action_placement_abi.js'
);
const {
    GPU_ACTOR_ACTION_DISPATCH_STORAGE_BINDING_COUNT,
    GPU_ACTOR_ACTION_DISPATCH_WGSL,
    GPU_ACTOR_ACTION_PLACEMENT_STORAGE_BINDING_COUNT,
    GPU_ACTOR_ACTION_PLACEMENT_WGSL
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_action_placement_shaders.js'
);
const {
    GpuActorActionPlacementRuntime
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_action_placement_runtime.js'
);
const {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_ABI_VERSION
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');
const {
    GPU_TOWER_GROUP_ABI
} = await loadGameModule('ingame/physics/gpu/gpu_tower_group_abi.js');
const {
    ACTOR_ACTION_PROFILE_ABI_VERSION
} = await loadGameModule('ingame/contract/actor_action_contract.js');

const LITTLE_ENDIAN = true;

function withFakeGpuGlobals(callback) {
    const previous = {
        GPUBufferUsage: globalThis.GPUBufferUsage,
        GPUShaderStage: globalThis.GPUShaderStage,
        GPUMapMode: globalThis.GPUMapMode
    };
    globalThis.GPUBufferUsage = Object.freeze({
        MAP_READ: 1,
        COPY_SRC: 4,
        COPY_DST: 8,
        STORAGE: 128,
        INDIRECT: 256
    });
    globalThis.GPUShaderStage = Object.freeze({ COMPUTE: 4 });
    globalThis.GPUMapMode = Object.freeze({ READ: 1 });
    try {
        return callback();
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
}

function fakeBuffer(size, label = 'fixture') {
    return {
        size,
        label,
        destroyed: false,
        destroy() { this.destroyed = true; }
    };
}

function fakeDevice(maxStorageBuffersPerShaderStage = 9) {
    return {
        limits: { maxStorageBuffersPerShaderStage },
        queue: {
            writeBuffer(buffer, offset, source) {
                assert.equal(buffer.destroyed, false);
                assert.equal(offset, 0);
                assert.ok(source instanceof ArrayBuffer);
            },
            submit() {}
        },
        createBuffer({ size, label }) { return fakeBuffer(size, label); },
        createBindGroupLayout(descriptor) { return descriptor; },
        createShaderModule(descriptor) { return descriptor; },
        createPipelineLayout(descriptor) { return descriptor; },
        createComputePipeline(descriptor) { return descriptor; }
    };
}

function createStageFixture(subjectCount = 2) {
    const compiledAbility = new SentenceCompiler().compile(
        R3_TOWER_SHOOTS_ENEMY_SENTENCE
    );
    const command = {
        executionId: `execution.r5.placement.${subjectCount}`,
        executionOrdinal: 7,
        targetFixedTick: 11,
        subjectLimit: 1000,
        generationLimit: 65535,
        aimPoint: { x: 8, y: 6 },
        compiledAbility
    };
    const normalized = normalizeAbilityExecutionCommand(command);
    const snapshot = fakeBuffer(
        subjectCount * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE,
        'snapshot'
    );
    const completion = Object.freeze({
        status: ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE,
        subjectCount,
        capacityDemand: subjectCount,
        errorFlags: 0,
        executionOrdinal: normalized.executionOrdinal,
        commandFingerprint: normalized.fingerprint,
        snapshotFingerprint: 0x12345678,
        sourceTick: 11
    });
    const snapshotBinding = Object.freeze({
        abiVersion: GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION,
        buffer: snapshot,
        byteOffset: 0,
        wordOffset: 0,
        byteLength: snapshot.size,
        recordStride: GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE,
        subjectCount,
        executionOrdinal: normalized.executionOrdinal,
        commandFingerprint: normalized.fingerprint,
        snapshotFingerprint: completion.snapshotFingerprint,
        sessionGeneration: 1,
        deviceGeneration: 2,
        authoritativeEpoch: 3,
        sourceTick: completion.sourceTick
    });
    const bodyCapacity = subjectCount + 6;
    const towerMemberCapacity = 4;
    const resources = Object.freeze({
        snapshot,
        physics: fakeBuffer(
            bodyCapacity * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE,
            'physics'
        ),
        simulation: fakeBuffer(
            bodyCapacity * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE,
            'simulation'
        ),
        abilityMetadata: fakeBuffer(
            bodyCapacity
                * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA.STRIDE,
            'metadata'
        ),
        towerMembers: fakeBuffer(
            towerMemberCapacity * GPU_TOWER_GROUP_ABI.MEMBER_STATE.STRIDE,
            'tower-members'
        ),
        towerRoster: fakeBuffer(
            GPU_TOWER_GROUP_ABI.ROSTER_HEADER.STRIDE
                + towerMemberCapacity * GPU_TOWER_GROUP_ABI.ROSTER_SLOT.STRIDE,
            'tower-roster'
        ),
        sdf: fakeBuffer(4, 'sdf'),
        params: fakeBuffer(4224, 'params'),
        gridCounts: fakeBuffer(4, 'grid-counts'),
        gridBodies: fakeBuffer(32, 'grid-bodies')
    });
    const destinationLeases = Object.freeze(Array.from(
        { length: subjectCount },
        (_, rank) => Object.freeze({
            destinationSlot: bodyCapacity - subjectCount + rank,
            destinationEntityId: 1000 + rank,
            destinationIncarnation: 2000 + rank,
            snapshotRank: rank,
            destinationRank: rank,
            baselineFlags: 0
        })
    ));
    const request = Object.freeze({
        transactionId: 'transaction.r5.placement.unit',
        command,
        subjectCompletion: completion,
        snapshotBinding,
        destinationLeases,
        actorActionProfile: R5_SHOOT_ACTOR_ACTION_PROFILE,
        targetFixedTick: 11,
        sdf: Object.freeze({
            cols: 1,
            rows: 1,
            enabled: false,
            worldWidth: 16,
            worldHeight: 12
        })
    });
    return {
        bodyCapacity,
        towerMemberCapacity,
        resources,
        request,
        normalized
    };
}

test('ActorAction placement ABI는 word-aligned side-plane과 aggregate-only 구역을 고정한다', () => {
    for (const layout of Object.values(GPU_ACTOR_ACTION_PLACEMENT_ABI)) {
        assert.equal(layout.STRIDE % 4, 0);
        for (const [name, offset] of Object.entries(layout)) {
            if (name !== 'STRIDE') assert.equal(offset % 4, 0);
        }
    }
    const output = createGpuActorActionPlacementOutputLayout(3);
    assert.deepEqual(output, {
        subjectCount: 3,
        destinationCount: 3,
        aggregateByteOffset: 0,
        placementByteOffset: 112,
        placementByteLength: 456,
        transitByteOffset: 568,
        transitByteLength: 240,
        byteLength: 808,
        placementWordOffset: 28,
        transitWordOffset: 142,
        outputWordCapacity: 202
    });
    assert.equal(GPU_ACTOR_ACTION_PLACEMENT_STORAGE_BINDING_COUNT, 9);
    assert.equal(GPU_ACTOR_ACTION_DISPATCH_STORAGE_BINDING_COUNT, 2);
});

test('4개 actor profile GPU encoding은 독립 identity와 Throw transit를 보존한다', () => {
    const encoded = R5_ACTOR_ACTION_PROFILES.map(encodeGpuActorActionProfile);
    assert.equal(new Set(encoded.map(({ actionCode }) => actionCode)).size, 4);
    assert.equal(new Set(encoded.map(({ fingerprint }) => fingerprint)).size, 4);
    assert.ok(encoded.every(({ fingerprint }) => fingerprint !== 0));
    assert.ok(encoded.every(({ profile, fingerprint }) => (
        fingerprint === profile.actorActionProfileFingerprint
    )));
    const throwing = encodeGpuActorActionProfile(
        R5_THROW_ACTOR_ACTION_PROFILE
    );
    assert.equal(throwing.travelDurationFixedTicks, 30);
    assert.equal(throwing.travelSpeed, 0);
    assert.equal(throwing.transitFlags, Object.values(
        GPU_ACTOR_ACTION_TRANSIT_FLAG
    ).reduce((mask, flag) => mask | flag, 0));
    assert.equal(
        encodeGpuActorActionProfile(R5_SUMMON_ACTOR_ACTION_PROFILE)
            .summonLatticeSpacing,
        Math.fround(1.0625)
    );
});

test('program header와 destination lease는 multiplicity 및 stable rank fingerprint를 고정한다', () => {
    const count = 2;
    const storage = createGpuActorActionProgramStorage(count);
    const leases = [
        { destinationSlot: 7, destinationEntityId: 70,
            destinationIncarnation: 700, snapshotRank: 0,
            destinationRank: 0 },
        { destinationSlot: 8, destinationEntityId: 80,
            destinationIncarnation: 800, snapshotRank: 1,
            destinationRank: 1 }
    ];
    const destinationFingerprint
        = computeGpuActorActionDestinationFingerprint(leases, 123);
    const result = writeGpuActorActionProgramHeader(storage, {
        actorActionProfile: R5_THROW_ACTOR_ACTION_PROFILE,
        actorActionProfileFingerprint:
            R5_THROW_ACTOR_ACTION_PROFILE.actorActionProfileFingerprint,
        sessionGeneration: 1,
        deviceGeneration: 2,
        authoritativeEpoch: 3,
        snapshotSourceTick: 4,
        placementTargetTick: 5,
        executionOrdinal: 6,
        commandFingerprint: 123,
        snapshotFingerprint: 456,
        destinationFingerprint,
        subjectCount: count,
        sourceSelectorCode: 1,
        actionCode: R5_THROW_ACTOR_ACTION_PROFILE.actionCode,
        payloadCode: 1,
        targetPolicyCode: 1,
        snapshotWordOffset: 9,
        generationLimit: 65535,
        coreTarget: null,
        sdf: { cols: 1, rows: 1, enabled: false,
            worldWidth: 16, worldHeight: 12 },
        towerMemberCapacity: 256,
        aimPoint: { x: 3, y: 4 }
    });
    leases.forEach((lease, index) => writeGpuActorActionDestinationLease(
        storage,
        count,
        index,
        lease
    ));
    const view = new DataView(storage);
    const h = GPU_ACTOR_ACTION_PLACEMENT_ABI.PROGRAM_HEADER;
    assert.equal(
        view.getUint32(h.ABI_VERSION, LITTLE_ENDIAN),
        GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION
    );
    assert.equal(view.getUint32(h.DESTINATION_FINGERPRINT, LITTLE_ENDIAN),
        destinationFingerprint);
    assert.equal(view.getUint32(h.PROFILE_FINGERPRINT, LITTLE_ENDIAN),
        result.profile.actorActionProfileFingerprint);
    assert.equal(view.getUint32(h.DESTINATION_COUNT, LITTLE_ENDIAN), count);
    assert.equal(view.getUint32(h.COPIES_PER_SUBJECT, LITTLE_ENDIAN), 1);
    assert.equal(view.getUint32(h.MODIFIER_SET_FINGERPRINT, LITTLE_ENDIAN), 0);
    assert.equal(view.getUint32(h.RESERVED_3, LITTLE_ENDIAN), 0);
    assert.equal(result.output.byteLength,
        createGpuActorActionPlacementOutputLayout(count).byteLength);
    assert.throws(() => computeGpuActorActionDestinationFingerprint([
        { ...leases[0], snapshotRank: 1 }
    ], 123), /multiplicity rank/);
});

test('Summon square spiral과 degenerate direction chain은 host oracle에서 결정적이다', () => {
    assert.deepEqual(
        Array.from({ length: 9 }, (_, rank) => (
            computeActorActionSummonLatticeOffset(rank)
        )),
        [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
            { x: -1, y: 1 },
            { x: -1, y: 0 },
            { x: -1, y: -1 },
            { x: 0, y: -1 },
            { x: 1, y: -1 }
        ]
    );
    assert.deepEqual(
        Array.from({ length: 4 }, (_, rank) => (
            computeActorActionSummonLatticePosition(
                { x: 10, y: 20 },
                rank,
                1.0625
            )
        )),
        [
            { x: 10, y: 20 },
            { x: 11.0625, y: 20 },
            { x: 11.0625, y: 21.0625 },
            { x: 10, y: 21.0625 }
        ]
    );
    assert.equal(isActorActionSummonAnchorDistanceValid({
        sourcePosition: { x: 2, y: 2 },
        anchorPosition: { x: 3, y: 2 },
        sourceRadius: 0.5,
        destinationRadius: 0.5
    }), true);
    assert.equal(isActorActionSummonAnchorDistanceValid({
        sourcePosition: { x: 2, y: 2 },
        anchorPosition: { x: 2.999, y: 2 },
        sourceRadius: 0.5,
        destinationRadius: 0.5
    }), false);
    const base = {
        sourcePosition: { x: 2, y: 2 },
        targetPosition: { x: 5, y: 6 },
        sourceVelocity: { x: 9, y: 0 },
        sourceFacing: { x: 0, y: -2 }
    };
    assert.deepEqual(resolveActorActionDegenerateDirection(base),
        { x: Math.fround(0.6), y: Math.fround(0.8) });
    assert.deepEqual(resolveActorActionDegenerateDirection({
        ...base,
        targetPosition: base.sourcePosition
    }), { x: 1, y: 0 });
    assert.deepEqual(resolveActorActionDegenerateDirection({
        ...base,
        targetPosition: base.sourcePosition,
        sourceVelocity: { x: 0, y: 0 }
    }), { x: 0, y: -1 });
    assert.deepEqual(resolveActorActionDegenerateDirection({
        ...base,
        targetPosition: base.sourcePosition,
        sourceVelocity: { x: 0, y: 0 },
        sourceFacing: { x: 0, y: 0 }
    }), { x: 1, y: 0 });
});

test('aggregate/placement/transit readers는 complete record와 invalid ABI를 구분한다', () => {
    const a = GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE;
    const aggregateBytes = new ArrayBuffer(a.STRIDE);
    const aggregateView = new DataView(aggregateBytes);
    const u32 = (field, value) => aggregateView.setUint32(
        field,
        value,
        LITTLE_ENDIAN
    );
    u32(a.ABI_VERSION, GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION);
    u32(a.SNAPSHOT_ABI_VERSION, GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION);
    u32(a.BODY_ABI_VERSION, GPU_CIRCLE_BODY_ABI_VERSION);
    u32(a.PROFILE_ABI_VERSION, ACTOR_ACTION_PROFILE_ABI_VERSION);
    u32(a.STATUS, GPU_ACTOR_ACTION_PLACEMENT_STATUS.COMPLETE);
    u32(a.SUBJECT_COUNT, 1);
    u32(a.DESTINATION_COUNT, 1);
    u32(a.VALID_COUNT, 1);
    u32(a.PLACEMENT_FINGERPRINT, 99);
    u32(a.PROFILE_FINGERPRINT,
        R5_SHOOT_ACTOR_ACTION_PROFILE.actorActionProfileFingerprint);
    u32(a.COPIES_PER_SUBJECT, 1);
    assert.equal(readGpuActorActionPlacementAggregate(aggregateBytes).status,
        GPU_ACTOR_ACTION_PLACEMENT_STATUS.COMPLETE);

    const p = GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD;
    const placementBytes = new ArrayBuffer(p.STRIDE);
    const placementView = new DataView(placementBytes);
    placementView.setUint32(p.ABI_VERSION,
        GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION, LITTLE_ENDIAN);
    placementView.setUint32(p.STATUS,
        GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS.VALID, LITTLE_ENDIAN);
    assert.equal(readGpuActorActionPlacementRecord(placementBytes).status,
        GPU_ACTOR_ACTION_PLACEMENT_RECORD_STATUS.VALID);

    const t = GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD;
    const transitBytes = new ArrayBuffer(t.STRIDE);
    new DataView(transitBytes).setUint32(t.ABI_VERSION,
        GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION, LITTLE_ENDIAN);
    assert.equal(readGpuActorActionTransitRecord(transitBytes).abiVersion,
        GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION);
    placementView.setUint32(p.STATUS, 999, LITTLE_ENDIAN);
    assert.throws(() => readGpuActorActionPlacementRecord(placementBytes),
        /ABI\/status/);
});

test('WGSL은 GPU count indirect, frozen snapshot, compact roster, atomic SDF 집계를 고정한다', () => {
    assert.equal((GPU_ACTOR_ACTION_DISPATCH_WGSL.match(/@binding\(/g) ?? []).length,
        2);
    assert.equal((GPU_ACTOR_ACTION_PLACEMENT_WGSL.match(/@binding\(/g) ?? []).length,
        9);
    for (const entryPoint of [
        'initialize_actor_action_program',
        'resolve_actor_action_placement',
        'validate_actor_action_placement',
        'aggregate_actor_action_placement'
    ]) {
        assert.match(GPU_ACTOR_ACTION_PLACEMENT_WGSL,
            new RegExp(`fn ${entryPoint}\\(`));
    }
    assert.match(GPU_ACTOR_ACTION_DISPATCH_WGSL,
        /\(count \+ WORKGROUP_SIZE - 1u\) \/ WORKGROUP_SIZE/);
    assert.match(GPU_ACTOR_ACTION_PLACEMENT_WGSL,
        /snapshot_word\(source_rank,/);
    assert.match(GPU_ACTOR_ACTION_PLACEMENT_WGSL,
        /roster_rank < tower_roster\.member_count/);
    assert.match(GPU_ACTOR_ACTION_PLACEMENT_WGSL,
        /STATUS_SDF_REJECTED/);
    assert.match(GPU_ACTOR_ACTION_PLACEMENT_WGSL,
        /resolved_target\.position - spawn_position/);
    assert.match(GPU_ACTOR_ACTION_PLACEMENT_WGSL,
        /PLACE_SOURCE_AND_LANDING/);
    assert.match(GPU_ACTOR_ACTION_PLACEMENT_WGSL,
        /minimum_distance \* minimum_distance/);
    assert.doesNotMatch(GPU_ACTOR_ACTION_PLACEMENT_WGSL, /atomicAdd/);
    assert.doesNotMatch(GPU_ACTOR_ACTION_PLACEMENT_WGSL,
        /(?:physics|simulations|ability_metadata|tower_members)\.values\[[^\]]+\]\s*=(?!=)/);
});

test('runtime stage는 exact snapshot/lease와 capacity를 검증하고 aggregate-only 상태를 노출한다', () => {
    withFakeGpuGlobals(() => {
        const fixture = createStageFixture();
        const runtime = new GpuActorActionPlacementRuntime({
            sessionGeneration: 1,
            commandCapacity: 2,
            readbackSlotCount: 1,
            subjectCapacity: 2
        });
        assert.equal(runtime.initialize(
            fakeDevice(),
            fixture.resources,
            {
                sessionGeneration: 1,
                deviceGeneration: 2,
                authoritativeEpoch: 3,
                bodyCapacity: fixture.bodyCapacity,
                towerMemberCapacity: fixture.towerMemberCapacity
            }
        ), true);
        const accepted = runtime.stage(fixture.request);
        assert.equal(accepted.accepted, true);
        assert.notEqual(accepted.destinationFingerprint, 0);
        assert.equal(runtime.stage(fixture.request).reason,
            'duplicate-actor-action-placement-transaction');

        const wrongProfile = runtime.stage({
            ...fixture.request,
            transactionId: 'transaction.r5.placement.profile-mismatch',
            actorActionProfile: R5_THROW_ACTOR_ACTION_PROFILE
        });
        assert.equal(wrongProfile.accepted, false);
        assert.match(wrongProfile.message, /fingerprint|actionCode/);

        const oneShort = runtime.stage({
            ...fixture.request,
            transactionId: 'transaction.r5.placement.short',
            destinationLeases: fixture.request.destinationLeases.slice(0, 1)
        });
        assert.equal(oneShort.accepted, false);
        assert.match(oneShort.message, /lease 수/);

        const staleDevice = runtime.stage({
            ...fixture.request,
            transactionId: 'transaction.r5.placement.stale-device',
            snapshotBinding: {
                ...fixture.request.snapshotBinding,
                deviceGeneration: 999
            }
        });
        assert.equal(staleDevice.accepted, false);
        assert.match(staleDevice.message, /snapshot contract/);

        const status = runtime.getStatus();
        assert.equal(status.storageBindingCount, 9);
        assert.equal(status.admissionStorageBindingCount, 8);
        assert.equal(
            status.admissionPolicy,
            'payload-local-candidates/shared-grid-verdict/stable-rank-claim'
        );
        assert.equal(status.dispatchStorageBindingCount, 2);
        assert.equal(status.aggregateReadbackByteSize, 112);
        assert.equal(status.perSubjectCpuCommandCount, 0);
        assert.equal(status.placementRecordCpuReadback, false);
        assert.equal(status.transitRecordCpuReadback, false);
        assert.equal(status.bodyStateCommitCount, 0);
        assert.equal(status.commandHighWater, 1);
        assert.equal(status.subjectHighWater, 2);
        assert.equal(status.retainedPlacementHighWater, 0);
        runtime.destroy();
    });
});

test('runtime source는 records를 CPU로 열지 않고 indirect dispatch와 aggregate copy만 사용한다', async () => {
    const source = await readFile(new URL(
        '../project/game/script/module/ingame/physics/gpu/gpu_actor_action_placement_runtime.js',
        import.meta.url
    ), 'utf8');
    assert.match(source, /dispatchWorkgroupsIndirect\(entry\.dispatchBuffer, 0\)/);
    assert.match(source, /this\.aggregateReadbackByteSize/);
    assert.doesNotMatch(source, /readGpuActorActionPlacementRecord/);
    assert.doesNotMatch(source, /readGpuActorActionTransitRecord/);
    assert.equal((source.match(/copyBufferToBuffer\(/g) ?? []).length, 1);
});
