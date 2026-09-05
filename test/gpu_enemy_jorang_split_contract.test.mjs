import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_CIRCLE_APPLIED_EVENT_FLAG,
    GPU_CIRCLE_APPLIED_EVENT_TYPE,
    GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE,
    GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM,
    GPU_CIRCLE_BODY_ABI,
    createGpuCircleBodyAbiStorage,
    packGpuCircleAppliedEventMeta,
    readGpuCircleAtomicTransformState,
    unpackGpuCircleAppliedEventMeta,
    writeGpuCircleAtomicTransformState
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');
const {
    GPU_ATOMIC_TRANSFORM_RUNTIME_ABI,
    GPU_ATOMIC_TRANSFORM_RUNTIME_STORAGE_PROFILE,
    GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE,
    createGpuAtomicTransformPrepareStorage,
    createGpuAtomicTransformProgramStorage,
    readGpuAtomicTransformPrepareHeader,
    readGpuAtomicTransformPrepareRecord,
    readGpuAtomicTransformProgramHeader,
    writeGpuAtomicTransformPrepareHeader,
    writeGpuAtomicTransformProgramHeader,
    writeGpuAtomicTransformProgramRecord
} = await loadGameModule(
    'ingame/physics/gpu/gpu_atomic_transform_runtime_abi.js'
);
const {
    GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL,
    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT
} = await loadGameModule(
    'ingame/physics/gpu/gpu_atomic_transform_runtime_shaders.js'
);
const {
    GPU_ATOMIC_TRANSFORM_POSITIVE_DAMAGE_HIT_WGSL
} = await loadGameModule(
    'ingame/physics/gpu/gpu_atomic_transform_positive_damage_hit_shaders.js'
);

const { GPU_COLLISION_COMPUTE_WGSL: COLLISION_SHADER_SOURCE } = await loadGameModule(
    'ingame/physics/gpu/gpu_collision_shaders.js'
);
const SIMULATION_SOURCE = await readFile(new URL(
    '../project/game/script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    import.meta.url
), 'utf8');
const GAME_OBJECT_SYSTEM_SOURCE = await readFile(new URL(
    '../project/game/script/module/ingame/object/game_object_system.js',
    import.meta.url
), 'utf8');
const LIFECYCLE_SOURCE = await readFile(new URL(
    '../project/game/script/module/ingame/object/enemy/enemy_lifecycle_command_owner.js',
    import.meta.url
), 'utf8');
const ATOMIC_COMMAND_OWNER_SOURCE = await readFile(new URL(
    '../project/game/script/module/ingame/object/enemy/gpu_atomic_transform_command_owner.js',
    import.meta.url
), 'utf8');
const {
    GpuAtomicTransformCommandOwner
} = await loadGameModule(
    'ingame/object/enemy/gpu_atomic_transform_command_owner.js'
);

const ATOMIC_FIRST_HIT_ENTRY_POINTS = Object.freeze([
    'clear_atomic_transform_first_hit_candidates',
    'select_atomic_transform_first_hit_source',
    'resolve_atomic_transform_first_hit_contact',
    'seal_atomic_transform_first_hits',
    'commit_atomic_transform_first_hits',
    'finalize_atomic_transform_first_hits',
    'shield_atomic_transform_first_hit_contacts'
]);

test('prepare ABI v1 is exact 32+64N and derives program/phase from topology', () => {
    assert.deepEqual(GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_HEADER, {
        STRIDE: 32,
        ABI_VERSION: 0,
        SOURCE_TICK: 4,
        TARGET_FIXED_TICK: 8,
        BATCH_ID_FINGERPRINT: 12,
        CAPACITY: 16,
        RECORD_COUNT: 20,
        STATUS: 24,
        RESERVED_0: 28
    });
    assert.deepEqual(GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_RECORD, {
        STRIDE: 64,
        TOPOLOGY_CODE: 0,
        SOURCE_SLOT: 4,
        SOURCE_ENTITY_ID: 8,
        SOURCE_INCARNATION: 12,
        DUE_FIXED_TICK: 16,
        LINEAGE_ROOT_ENTITY_ID: 20,
        LINEAGE_ROOT_INCARNATION: 24,
        BRANCH_INDEX: 28,
        BOUNTY_BUDGET: 32,
        COMMAND_GENERATION: 36,
        CURRENT_HEALTH_FIXED_POINT: 40,
        MAX_HEALTH_FIXED_POINT: 44,
        TRIGGER_SOURCE_TICK: 48,
        TRIGGER_SEQUENCE: 52,
        RESULT: 56,
        RECORD_FINGERPRINT: 60
    });
    const storage = createGpuAtomicTransformPrepareStorage(2);
    assert.equal(storage.buffer.byteLength, 32 + (64 * 2));
    writeGpuAtomicTransformPrepareHeader(storage, {
        sourceTick: 10,
        targetFixedTick: 11,
        batchIdFingerprint: 77,
        recordCount: 2
    });
    assert.deepEqual(readGpuAtomicTransformPrepareHeader(storage), {
        abiVersion: 1,
        sourceTick: 10,
        targetFixedTick: 11,
        batchIdFingerprint: 77,
        capacity: 2,
        recordCount: 2,
        status: 0
    });
    const recordAbi = GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_RECORD;
    const headerStride = GPU_ATOMIC_TRANSFORM_RUNTIME_ABI
        .PREPARE_HEADER.STRIDE;
    const writePrepareRecord = (index, values) => {
        const base = headerStride + (index * recordAbi.STRIDE);
        for (const [offset, value] of [
            [recordAbi.TOPOLOGY_CODE, values.topologyCode],
            [recordAbi.SOURCE_SLOT, values.sourceSlot],
            [recordAbi.SOURCE_ENTITY_ID, values.sourceEntityId],
            [recordAbi.SOURCE_INCARNATION, values.sourceIncarnation],
            [recordAbi.DUE_FIXED_TICK, values.dueFixedTick],
            [recordAbi.LINEAGE_ROOT_ENTITY_ID, values.lineageRootEntityId],
            [
                recordAbi.LINEAGE_ROOT_INCARNATION,
                values.lineageRootIncarnation
            ],
            [recordAbi.BRANCH_INDEX, values.branchIndex],
            [recordAbi.BOUNTY_BUDGET, values.bountyBudget],
            [recordAbi.COMMAND_GENERATION, values.commandGeneration],
            [recordAbi.TRIGGER_SOURCE_TICK, values.triggerSourceTick],
            [recordAbi.TRIGGER_SEQUENCE, values.triggerSequence],
            [recordAbi.RESULT, values.result],
            [recordAbi.RECORD_FINGERPRINT, values.recordFingerprint]
        ]) {
            storage.view.setUint32(base + offset, value, true);
        }
        storage.view.setInt32(
            base + recordAbi.CURRENT_HEALTH_FIXED_POINT,
            values.currentHealthFixedPoint,
            true
        );
        storage.view.setInt32(
            base + recordAbi.MAX_HEALTH_FIXED_POINT,
            values.maxHealthFixedPoint,
            true
        );
    };
    writePrepareRecord(0, {
        topologyCode: GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_MANY,
        sourceSlot: 3,
        sourceEntityId: 41,
        sourceIncarnation: 2,
        dueFixedTick: 0,
        lineageRootEntityId: 41,
        lineageRootIncarnation: 2,
        branchIndex: 0,
        bountyBudget: 12,
        commandGeneration: 4,
        currentHealthFixedPoint: 75,
        maxHealthFixedPoint: 100,
        triggerSourceTick: 10,
        triggerSequence: 7,
        result: 1,
        recordFingerprint: 91
    });
    writePrepareRecord(1, {
        topologyCode:
            GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_ONE_DELAYED,
        sourceSlot: 7,
        sourceEntityId: 52,
        sourceIncarnation: 3,
        dueFixedTick: 71,
        lineageRootEntityId: 41,
        lineageRootIncarnation: 2,
        branchIndex: 1,
        bountyBudget: 6,
        commandGeneration: 5,
        currentHealthFixedPoint: 76,
        maxHealthFixedPoint: 100,
        triggerSourceTick: 0,
        triggerSequence: 0,
        result: 1,
        recordFingerprint: 92
    });
    assert.deepEqual(readGpuAtomicTransformPrepareRecord(storage, 0), {
        topologyCode: GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_MANY,
        sourceSlot: 3,
        sourceEntityId: 41,
        sourceIncarnation: 2,
        programId: GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.J_SPLIT_FIRST_HIT,
        phase: GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.SPLIT_PENDING,
        dueFixedTick: 0,
        lineageRootEntityId: 41,
        lineageRootIncarnation: 2,
        branchIndex: 0,
        bountyBudget: 12,
        commandGeneration: 4,
        currentHealthFixedPoint: 75,
        maxHealthFixedPoint: 100,
        triggerSourceTick: 10,
        triggerSequence: 7,
        result: 1,
        recordFingerprint: 91
    });
    assert.deepEqual(readGpuAtomicTransformPrepareRecord(storage, 1), {
        topologyCode:
            GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_ONE_DELAYED,
        sourceSlot: 7,
        sourceEntityId: 52,
        sourceIncarnation: 3,
        programId:
            GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.C_PRIME_DELAYED_RECOMBINE,
        phase: GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.CHILD_DELAYED,
        dueFixedTick: 71,
        lineageRootEntityId: 41,
        lineageRootIncarnation: 2,
        branchIndex: 1,
        bountyBudget: 6,
        commandGeneration: 5,
        currentHealthFixedPoint: 76,
        maxHealthFixedPoint: 100,
        triggerSourceTick: 0,
        triggerSequence: 0,
        result: 1,
        recordFingerprint: 92
    });
    const prepareStructStart = GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL
        .indexOf('struct PrepareRecord');
    const prepareStructEnd = GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL
        .indexOf('\n}', prepareStructStart);
    assert.ok(prepareStructStart >= 0 && prepareStructEnd > prepareStructStart);
    const prepareStruct = GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL.slice(
        prepareStructStart,
        prepareStructEnd
    );
    assert.match(prepareStruct,
        /topology_code[\s\S]*trigger_source_tick[\s\S]*trigger_sequence[\s\S]*result[\s\S]*record_fingerprint/);
    assert.doesNotMatch(prepareStruct, /\bprogram_id\b|\bphase\b/);
    const sliceFunction = (name, nextMarker) => {
        const start = GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL
            .indexOf(`fn ${name}`);
        const end = GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL
            .indexOf(nextMarker, start);
        assert.ok(start >= 0 && end > start, `${name} WGSL slice missing`);
        return GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL.slice(start, end);
    };
    const fingerprintFieldOrder = /record\.topology_code[\s\S]*record\.source_slot[\s\S]*record\.source_entity_id[\s\S]*record\.source_incarnation[\s\S]*canonical_program_for_topology\(record\.topology_code\)[\s\S]*canonical_phase_for_topology\(record\.topology_code\)[\s\S]*record\.due_fixed_tick[\s\S]*record\.lineage_root_entity_id[\s\S]*record\.lineage_root_incarnation[\s\S]*record\.branch_index[\s\S]*record\.bounty_budget[\s\S]*record\.command_generation[\s\S]*record\.current_health_fixed_point[\s\S]*record\.max_health_fixed_point[\s\S]*record\.trigger_source_tick[\s\S]*record\.trigger_sequence/;
    for (const fingerprintFunction of [
        sliceFunction(
            'authentic_record_fingerprint',
            'fn transform_source_fingerprint'
        ),
        sliceFunction(
            'transform_source_fingerprint',
            '@compute @workgroup_size(1)'
        )
    ]) {
        assert.match(fingerprintFunction, fingerprintFieldOrder);
    }
    const prepareStart = GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL
        .indexOf('fn prepare_atomic_transforms');
    const prepareEnd = GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL
        .indexOf('fn fail_transform', prepareStart);
    const prepare = GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL.slice(
        prepareStart,
        prepareEnd
    );
    assert.match(prepare, /let record_due\s*=\s*stored_due/);
    assert.doesNotMatch(prepare,
        /record_due\s*=\s*prepare_program\.header\.target_fixed_tick/);
    const preflightStart = GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL
        .indexOf('fn preflight_atomic_transform_records');
    const preflightEnd = GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL
        .indexOf('fn seal_atomic_transform_program', preflightStart);
    const preflight = GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL.slice(
        preflightStart,
        preflightEnd
    );
    assert.match(preflight,
        /let source_due\s*=\s*atomic_transform_states\.values\[record\.source_slot\]\.due_fixed_tick/);
    assert.doesNotMatch(preflight,
        /let source_due\s*=\s*select\([\s\S]*?target_fixed_tick/);
});

test('generic atomic runtime ABI carries 1-to-2 destinations and reserved legacy transfer field', () => {
    assert.deepEqual(GPU_ATOMIC_TRANSFORM_RUNTIME_STORAGE_PROFILE, {
        prepare: 5,
        transformBodies: 9,
        transformState: 7,
        transformAuxiliary: 9,
        transformControl: 5,
        effectRekey: 3,
        requiredMaximum: 9
    });
    const storage = createGpuAtomicTransformProgramStorage(2);
    writeGpuAtomicTransformProgramHeader(storage, {
        count: 1,
        batchIdFingerprint: 77,
        preparedSourceTick: 10,
        targetFixedTick: 11,
        expectedEffectRekeyCount: 1
    });
    writeGpuAtomicTransformProgramRecord(storage, 0, {
        topologyCode: GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_MANY,
        sourceSlot: 3,
        sourceEntityId: 41,
        sourceIncarnation: 2,
        destinationHandles: [
            { slot: 3, entityId: 41, incarnation: 3 },
            { slot: 7, entityId: 52, incarnation: 1 }
        ],
        effectTransferDestinationIndex: 0,
        prepareRecordFingerprint: 91,
        commandGeneration: 4,
        sourceCurrentHealthFixedPoint: 75,
        sourceMaxHealthFixedPoint: 100,
        triggerSourceTick: 10,
        triggerSequence: 7
    });
    assert.deepEqual(readGpuAtomicTransformProgramHeader(storage), {
        abiVersion: 1,
        count: 1,
        capacity: 2,
        batchIdFingerprint: 77,
        preparedSourceTick: 10,
        targetFixedTick: 11,
        status: 0,
        batchAccepted: 0,
        committedCount: 0,
        effectRekeyCount: 0,
        expectedEffectRekeyCount: 1,
        failureRecordIndex: 0xffffffff
    });
    const base = GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_HEADER.STRIDE;
    const record = GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_RECORD;
    assert.equal(storage.view.getUint32(
        base + record.DESTINATION_COUNT,
        true
    ), 2);
    assert.equal(storage.view.getUint32(
        base + record.EFFECT_TRANSFER_DESTINATION_INDEX,
        true
    ), 0);
    assert.equal(storage.view.getUint32(
        base + record.DESTINATION_1_ENTITY_ID,
        true
    ), 52);
    assert.deepEqual(Object.values(GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT), [
        'clear_atomic_transform_prepare',
        'prepare_atomic_transforms',
        'clear_atomic_transform_program',
        'preflight_atomic_transform_records',
        'preflight_atomic_transform_effect_rekeys',
        'seal_atomic_transform_program',
        'commit_atomic_transform_bodies',
        'commit_atomic_transform_state',
        'commit_atomic_transform_auxiliary',
        'commit_atomic_transform_control',
        'commit_atomic_transform_route_state',
        'rekey_atomic_transform_effect_instances',
        'finalize_atomic_transform_program'
    ]);
    for (const entryPoint of Object.values(
        GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT
    )) {
        assert.match(GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL,
            new RegExp(`fn ${entryPoint}\\b`));
    }
});

test('atomic runtime copies exact source pose, velocity, and flow to both split children', () => {
    assert.match(GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL,
        /let source_position\s*=\s*physics\.values\[source_slot\]\.position/);
    assert.match(GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL,
        /let source_velocity\s*=\s*physics\.values\[source_slot\]\.velocity/);
    assert.match(GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL,
        /let source_flow_field_index\s*=\s*simulations\.values\[source_slot\]\.flow_field_index/);
    assert.match(GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL,
        /let source_flow_speed\s*=\s*simulations\.values\[source_slot\]\.flow_speed/);
    assert.match(GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL,
        /write_body_destination\(record,\s*record\.destination_0_slot,\s*record\.destination_0_slot,\s*source_position,\s*source_velocity,\s*source_previous_position,\s*source_predicted_position,\s*source_position_delta,\s*source_grid_index,\s*source_previous_flow_field_index,\s*source_flow_field_index,\s*source_flow_speed,\s*source_flags\)/);
    assert.match(GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL,
        /write_body_destination\(record,\s*record\.destination_1_slot,\s*record\.destination_1_slot,\s*source_position,\s*source_velocity,\s*source_previous_position,\s*source_predicted_position,\s*source_position_delta,\s*source_grid_index,\s*source_previous_flow_field_index,\s*source_flow_field_index,\s*source_flow_speed,\s*source_flags\)/);
    const rekeyStart = GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL.indexOf(
        'fn rekey_atomic_transform_effect_instances'
    );
    const rekeyEnd = GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL.indexOf(
        'fn finalize_atomic_transform_program',
        rekeyStart
    );
    const rekey = GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL.slice(
        rekeyStart,
        rekeyEnd
    );
    assert.match(rekey, /effect_atomic_transform_destination_index/);
    assert.match(rekey,
        /transform_program\.records\[index\]\.destination_0_(?:slot|entity_id|incarnation)/);
    assert.match(rekey,
        /transform_program\.records\[index\]\.destination_1_(?:slot|entity_id|incarnation)/);
    assert.match(GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL,
        /effect_instance_id\s*%\s*record\.destination_count/);
    assert.match(GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL,
        /effect_atomic_transform_transfer_policy\(\s*effect_definition_code/);
    assert.match(GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL,
        /fn effect_atomic_transform_transfer_policy[\s\S]*return 0u/);
    assert.match(GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL,
        /destination_index[\s\S]*>=\s*transform_program\.records\[[^\]]+\][\s\S]*\.destination_count[\s\S]*STATUS_EFFECT_REKEY_MISMATCH/);
});

test('J/C′ state ABI preserves exact handles, branch budget, and delayed due tick', () => {
    assert.deepEqual(GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM, {
        NONE: 0,
        J_SPLIT_FIRST_HIT: 1,
        C_PRIME_DELAYED_RECOMBINE: 2
    });
    assert.deepEqual(GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE, {
        NONE: 0,
        ARMED: 1,
        SPLIT_PENDING: 2,
        CHILD_DELAYED: 3,
        TRANSFORM_ARMED: 4
    });
    assert.deepEqual(GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE, {
        STRIDE: 48,
        PROGRAM_ID: 0,
        PHASE: 4,
        ENTITY_ID: 8,
        INCARNATION: 12,
        DUE_FIXED_TICK: 16,
        LINEAGE_ROOT_ENTITY_ID: 20,
        LINEAGE_ROOT_INCARNATION: 24,
        BRANCH_INDEX: 28,
        BOUNTY_BUDGET: 32,
        TRIGGER_SOURCE_TICK: 36,
        TRIGGER_SEQUENCE: 40,
        COMMAND_GENERATION: 44
    });
    const storage = createGpuCircleBodyAbiStorage(2);
    writeGpuCircleAtomicTransformState(storage, 0, {
        programId: GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.J_SPLIT_FIRST_HIT,
        phase: GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.ARMED,
        entityId: 41,
        incarnation: 3,
        lineageRootEntityId: 41,
        lineageRootIncarnation: 3,
        branchIndex: 0,
        bountyBudget: 12,
        commandGeneration: 1
    });
    writeGpuCircleAtomicTransformState(storage, 1, {
        programId: GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.C_PRIME_DELAYED_RECOMBINE,
        phase: GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.CHILD_DELAYED,
        entityId: 52,
        incarnation: 7,
        dueFixedTick: 160,
        lineageRootEntityId: 41,
        lineageRootIncarnation: 3,
        branchIndex: 1,
        bountyBudget: 6,
        commandGeneration: 2
    });
    assert.deepEqual(readGpuCircleAtomicTransformState(storage, 0), {
        programId: 1,
        phase: 1,
        entityId: 41,
        incarnation: 3,
        dueFixedTick: 0,
        lineageRootEntityId: 41,
        lineageRootIncarnation: 3,
        branchIndex: 0,
        bountyBudget: 12,
        triggerSourceTick: 0,
        triggerSequence: 0,
        commandGeneration: 1
    });
    assert.deepEqual(readGpuCircleAtomicTransformState(storage, 1), {
        programId: 2,
        phase: 3,
        entityId: 52,
        incarnation: 7,
        dueFixedTick: 160,
        lineageRootEntityId: 41,
        lineageRootIncarnation: 3,
        branchIndex: 1,
        bountyBudget: 6,
        triggerSourceTick: 0,
        triggerSequence: 0,
        commandGeneration: 2
    });
    assert.throws(() => writeGpuCircleAtomicTransformState(storage, 1, {
        programId: GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.C_PRIME_DELAYED_RECOMBINE,
        phase: GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.CHILD_DELAYED,
        entityId: 52,
        incarnation: 7,
        dueFixedTick: 0,
        lineageRootEntityId: 41,
        lineageRootIncarnation: 3,
        branchIndex: 1,
        bountyBudget: 6,
        commandGeneration: 2
    }), /C prime|dueFixedTick/);
});

test('first valid hit has a dedicated zero-damage applied-event flag', () => {
    assert.equal(
        GPU_CIRCLE_APPLIED_EVENT_FLAG.ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT,
        1 << 15
    );
    const packed = packGpuCircleAppliedEventMeta(
        GPU_CIRCLE_APPLIED_EVENT_TYPE.DAMAGE_APPLIED,
        GPU_CIRCLE_APPLIED_EVENT_FLAG.CONTINUOUS_POLICY
            | GPU_CIRCLE_APPLIED_EVENT_FLAG.ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT
    );
    assert.deepEqual(unpackGpuCircleAppliedEventMeta(packed), {
        type: GPU_CIRCLE_APPLIED_EVENT_TYPE.DAMAGE_APPLIED,
        flags: GPU_CIRCLE_APPLIED_EVENT_FLAG.CONTINUOUS_POLICY
            | GPU_CIRCLE_APPLIED_EVENT_FLAG.ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT
    });
    assert.match(COLLISION_SHADER_SOURCE,
        /APPLIED_EVENT_FLAG_ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT/);
    assert.match(COLLISION_SHADER_SOURCE,
        /AppliedEvent\([\s\S]*?contact\.other_incarnation,\s*0,\s*APPLIED_EVENT_TYPE_DAMAGE_APPLIED[\s\S]*?APPLIED_EVENT_FLAG_ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT/);
    assert.match(GPU_ATOMIC_TRANSFORM_POSITIVE_DAMAGE_HIT_WGSL,
        /atomicCompareExchangeWeak\([\s\S]*ATOMIC_TRANSFORM_PHASE_ARMED[\s\S]*ATOMIC_TRANSFORM_PHASE_SPLIT_PENDING/);
    assert.match(SIMULATION_SOURCE,
        /const atomicTransformTriggerFirstHit\s*=\s*\([\s\S]*?GPU_CIRCLE_APPLIED_EVENT_FLAG\.ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT[\s\S]*?\)\s*!==\s*0/);
});

test('projectile validates its own hit policy before the producer-neutral positive-damage seam', () => {
    const helperStart = COLLISION_SHADER_SOURCE.indexOf(
        'fn atomic_transform_projectile_positive_damage_after_hit_policy'
    );
    const helperEnd = COLLISION_SHADER_SOURCE.indexOf(
        'fn atomic_transform_first_hit_candidate_is_valid',
        helperStart
    );
    assert.ok(helperStart >= 0 && helperEnd > helperStart);
    const helper = COLLISION_SHADER_SOURCE.slice(helperStart, helperEnd);
    assert.match(helper, /BODY_LAYER_PROJECTILE/);
    assert.match(helper, /CONTACT_HANDLER_FLAG_CLOSEST_ONLY/);
    assert.match(helper, /damage_self\s*<=\s*0/);
    assert.match(helper, /let final_damage\s*=\s*resolve_contact_target_mitigation/);
    assert.match(helper,
        /atomic_transform_positive_damage_hit_is_valid_for_phase\([\s\S]*POSITIVE_DAMAGE_PRODUCER_PROJECTILE,[\s\S]*true/);
    assert.match(COLLISION_SHADER_SOURCE,
        /valid_pending[\s\S]*?atomic_transform_projectile_positive_damage_after_hit_policy/);
    assert.match(COLLISION_SHADER_SOURCE,
        /try_commit_atomic_transform_first_valid_positive_damage_hit\([\s\S]*?source_body_id,[\s\S]*?target_body_id,[\s\S]*?validated_positive_damage,[\s\S]*?POSITIVE_DAMAGE_PRODUCER_PROJECTILE,[\s\S]*?true/);
});

test('common J split seam is contact/budget independent and admits all authored producer kinds', () => {
    assert.match(GPU_ATOMIC_TRANSFORM_POSITIVE_DAMAGE_HIT_WGSL,
        /fn try_commit_atomic_transform_first_valid_positive_damage_hit\(\s*source_body_id:\s*u32,\s*target_body_id:\s*u32,\s*target_incarnation:\s*u32,\s*final_positive_damage:\s*i32,\s*producer_kind:\s*u32,\s*producer_hit_policy_validated:\s*bool/);
    for (const producer of [
        'PROJECTILE',
        'EXPLOSION',
        'EFFECT',
        'DIRECT',
        'MELEE'
    ]) {
        assert.match(GPU_ATOMIC_TRANSFORM_POSITIVE_DAMAGE_HIT_WGSL,
            new RegExp(`POSITIVE_DAMAGE_PRODUCER_${producer}`));
    }
    assert.match(GPU_ATOMIC_TRANSFORM_POSITIVE_DAMAGE_HIT_WGSL,
        /final_positive_damage\s*<=\s*0/);
    assert.match(GPU_ATOMIC_TRANSFORM_POSITIVE_DAMAGE_HIT_WGSL,
        /!producer_hit_policy_validated/);
    assert.doesNotMatch(GPU_ATOMIC_TRANSFORM_POSITIVE_DAMAGE_HIT_WGSL,
        /\bContact\b|contact_handlers|damage_self|BODY_LAYER_PROJECTILE/);
});

test('first-hit classification/seal/commit/shield runs before normal damage handling', () => {
    let previousIndex = -1;
    for (const entryPoint of ATOMIC_FIRST_HIT_ENTRY_POINTS) {
        const sourceIndex = SIMULATION_SOURCE.indexOf(`'${entryPoint}'`, previousIndex + 1);
        assert.ok(sourceIndex > previousIndex,
            `${entryPoint} ordering evidence가 없습니다.`);
        previousIndex = sourceIndex;
    }
    const fixedSubmitSource = SIMULATION_SOURCE.slice(
        SIMULATION_SOURCE.indexOf("'clear_atomic_transform_first_hit_candidates'", 20_000)
    );
    assert.ok(fixedSubmitSource.indexOf(
        'shield_atomic_transform_first_hit_contacts'
    ) < fixedSubmitSource.indexOf('handle_contacts'));
    assert.match(COLLISION_SHADER_SOURCE,
        /ATOMIC_TRANSFORM_PHASE_SPLIT_PENDING[\s\S]*ATOMIC_TRANSFORM_FIRST_HIT_MARKER_SHIELD/);
});

test('all seven first-hit entrypoints use a 6+3=9 storage-buffer profile', () => {
    assert.match(SIMULATION_SOURCE,
        /const REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE = 9;/);
    for (const entryPoint of ATOMIC_FIRST_HIT_ENTRY_POINTS) {
        assert.match(SIMULATION_SOURCE, new RegExp(
            `${entryPoint}:[\\s\\S]{0,120}`
                + 'COMPUTE_PIPELINE_PROFILE\\.ATOMIC_TRANSFORM_FIRST_HIT'
        ));
    }
    assert.match(SIMULATION_SOURCE,
        /computeAtomicTransformFirstHitBodiesLayout[\s\S]*?entries:\s*\[[\s\S]*?storageLayoutEntry\(0\)[\s\S]*?storageLayoutEntry\(1\)[\s\S]*?storageLayoutEntry\(2\)[\s\S]*?storageLayoutEntry\(4,[\s\S]*?storageLayoutEntry\(14\)[\s\S]*?storageLayoutEntry\(15\)[\s\S]*?\][\s\S]*?\}\);/);
    assert.match(SIMULATION_SOURCE,
        /computeMaximumDamageWindowEventsLayout[\s\S]*?\[0, 1, 2\]\.map/);
    assert.match(SIMULATION_SOURCE,
        /ATOMIC_TRANSFORM_FIRST_HIT\]:\s*\[[\s\S]*?computeAtomicTransformFirstHitBodiesLayout[\s\S]*?computeMaximumDamageWindowEventsLayout/);
});

test('GPU admits every same-tick J first hit without applying the host quota of four', () => {
    const sealStart = COLLISION_SHADER_SOURCE.indexOf(
        'fn seal_atomic_transform_first_hits'
    );
    const sealEnd = COLLISION_SHADER_SOURCE.indexOf(
        'fn commit_atomic_transform_first_hits',
        sealStart
    );
    assert.ok(sealStart >= 0 && sealEnd > sealStart);
    const seal = COLLISION_SHADER_SOURCE.slice(sealStart, sealEnd);
    assert.match(seal, /selected_count\s*\+=\s*1u/);
    assert.match(seal,
        /selected_count\s*>\s*params\.max_events\s*-\s*event_base/);
    assert.doesNotMatch(seal, /max(?:imum)?[_A-Za-z]*starts|\b4u?\b/i);
    assert.match(COLLISION_SHADER_SOURCE,
        /atomic_transform_committed_count[\s\S]*?event_index/);
});

test('first-hit event capacity is a singleton retryable whole-batch rejection', () => {
    const sealStart = COLLISION_SHADER_SOURCE.indexOf(
        'fn seal_atomic_transform_first_hits'
    );
    const sealEnd = COLLISION_SHADER_SOURCE.indexOf(
        'fn commit_atomic_transform_first_hits',
        sealStart
    );
    const seal = COLLISION_SHADER_SOURCE.slice(sealStart, sealEnd);
    assert.match(seal,
        /atomic_transform_candidate_count,\s*selected_count/);
    assert.match(seal,
        /atomic_transform_event_base,\s*event_base/);
    assert.match(seal,
        /selected_count\s*>\s*params\.max_events\s*-\s*event_base[\s\S]*ATOMIC_TRANSFORM_CANDIDATE_STATUS_EVENT_CAPACITY_EXCEEDED[\s\S]*return/);
    assert.ok(seal.indexOf('atomic_transform_candidate_count')
        < seal.indexOf('ATOMIC_TRANSFORM_CANDIDATE_STATUS_EVENT_CAPACITY_EXCEEDED'));
    assert.ok(seal.indexOf('atomic_transform_event_base')
        < seal.indexOf('ATOMIC_TRANSFORM_CANDIDATE_STATUS_EVENT_CAPACITY_EXCEEDED'));
    const finalizeStart = COLLISION_SHADER_SOURCE.indexOf(
        'fn finalize_atomic_transform_first_hits'
    );
    const finalizeEnd = COLLISION_SHADER_SOURCE.indexOf(
        'fn shield_atomic_transform_first_hit_contacts',
        finalizeStart
    );
    const finalize = COLLISION_SHADER_SOURCE.slice(finalizeStart, finalizeEnd);
    assert.match(finalize,
        /atomic_transform_protocol_status[\s\S]*==\s*ATOMIC_TRANSFORM_CANDIDATE_STATUS_EVENT_CAPACITY_EXCEEDED[\s\S]*return/);
    assert.match(SIMULATION_SOURCE,
        /atomicTransformProtocolStatus\s*===\s*GPU_CIRCLE_ATOMIC_TRANSFORM_CANDIDATE_STATUS\s*\.EVENT_CAPACITY_EXCEEDED/);
    assert.match(SIMULATION_SOURCE,
        /atomicTransformCandidateCount\s*>\s*this\.eventCapacity\s*-\s*atomicTransformEventBase/);
    assert.match(SIMULATION_SOURCE,
        /atomicTransformFirstHitCapacityRejected/);
    assert.match(GAME_OBJECT_SYSTEM_SOURCE,
        /retryableJorangFirstHitCapacityBackoff[\s\S]*capacityRejectionCount\s*===\s*1/);
});

test('lifecycle owner uses generic J atomic transaction port names while H keeps its formation port', () => {
    const jAtomicStart = LIFECYCLE_SOURCE.indexOf(
        '#commitEnemyAtomicTransforms(commands'
    );
    const jAtomicEnd = LIFECYCLE_SOURCE.indexOf(
        '#commitProjectileCaptureReleases',
        jAtomicStart
    );
    assert.ok(jAtomicStart >= 0 && jAtomicEnd > jAtomicStart);
    const jAtomicSource = LIFECYCLE_SOURCE.slice(jAtomicStart, jAtomicEnd);
    for (const methodName of [
        'armPreparedAtomicTransformBatch',
        'commitArmedAtomicTransformBatch',
        'cancelArmedAtomicTransformBatch'
    ]) {
        assert.match(jAtomicSource, new RegExp(methodName));
    }
    assert.doesNotMatch(jAtomicSource,
        /transactionPort\.armPreparedFormationTransformBatch/);
    assert.match(jAtomicSource,
        /retryDisposition:\s*'restage-next-prepare'[\s\S]*?sourcePendingPreserved:\s*true[\s\S]*?attemptConsumed:\s*true/);
    assert.match(jAtomicSource,
        /const armRecords[\s\S]*?destinationHandles:[\s\S]*?destinationIntents:[\s\S]*?effectTransferDestinationIndex:/);
    assert.match(jAtomicSource,
        /result\.atomicTransforms\.push\([\s\S]*?destinationHandles[\s\S]*?effectTransferDestinationIndex:/);
});

test('dedicated atomic command owner exposes prepare, commit, discard, and terminal cancel seams', () => {
    assert.match(ATOMIC_COMMAND_OWNER_SOURCE,
        /export class GpuAtomicTransformCommandOwner/);
    for (const methodName of [
        'requestPrepareBatch',
        'requestPreparedTransformBatch',
        'discardPreparedBatch'
    ]) {
        assert.match(ATOMIC_COMMAND_OWNER_SOURCE,
            new RegExp(`\\b${methodName}\\s*\\(`));
    }
    assert.match(ATOMIC_COMMAND_OWNER_SOURCE,
        /closeForTerminal[\s\S]*?cancelPendingAtomicTransformProgramsForTerminal/);
});

test('closed and destroyed atomic command ports reject discard without backend mutation', () => {
    const createOwnerFixture = () => {
        let discardCallCount = 0;
        const backendPort = Object.freeze({
            stageAtomicTransformPrepareBatch() {
                return Object.freeze({ accepted: true });
            },
            drainCompletedAtomicTransformPrepareBatches(out) {
                return out;
            },
            discardPreparedAtomicTransformBatch() {
                discardCallCount++;
                return Object.freeze({ accepted: true });
            },
            cancelPendingAtomicTransformProgramsForTerminal({ finalFixedTick }) {
                return Object.freeze({
                    state: 'armed',
                    finalFixedTick,
                    sessionGeneration: 1,
                    deviceGeneration: 1,
                    authoritativeEpoch: 1
                });
            },
            getAtomicTransformRuntimeStatus() {
                return Object.freeze({ pendingReadbackCount: 0 });
            }
        });
        const owner = new GpuAtomicTransformCommandOwner({
            backendPort,
            lifecyclePort: Object.freeze({
                requestAtomicTransformBatch() {
                    return Object.freeze({ accepted: true });
                }
            }),
            sessionGeneration: 1,
            capacity: 4,
            transformStartCapacity: 4
        });
        return Object.freeze({
            owner,
            port: owner.getCommandPort(),
            getDiscardCallCount: () => discardCallCount
        });
    };
    const expected = {
        accepted: false,
        reason: 'atomic-transform-ingress-closed',
        requiresRecovery: false
    };

    const closed = createOwnerFixture();
    closed.owner.closeForTerminal(3);
    const closedCalls = closed.getDiscardCallCount();
    const closedResult = closed.port.discardPreparedBatch({
        batchIdFingerprint: 77
    });
    assert.deepEqual(closedResult, expected);
    assert.equal(Object.isFrozen(closedResult), true);
    assert.equal(closed.getDiscardCallCount(), closedCalls);

    const destroyed = createOwnerFixture();
    destroyed.owner.destroy();
    const destroyedCalls = destroyed.getDiscardCallCount();
    const destroyedResult = destroyed.port.discardPreparedBatch({
        batchIdFingerprint: 77
    });
    assert.deepEqual(destroyedResult, expected);
    assert.equal(Object.isFrozen(destroyedResult), true);
    assert.equal(destroyed.getDiscardCallCount(), destroyedCalls);
});
