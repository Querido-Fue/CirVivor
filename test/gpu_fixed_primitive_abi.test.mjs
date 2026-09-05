import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_BODY_CONTROL_PROGRAM_ABI_VERSION,
    GPU_BODY_CONTROL_PROGRAM_MODE,
    GPU_BODY_CONTROL_PROGRAM_RESULT,
    GPU_BODY_CONTROL_SELECTED_TARGET_KIND,
    GPU_BODY_CONTROL_SELECTION_POLICY,
    GPU_FIXED_PRIMITIVE_ABI,
    GPU_FIXED_PRIMITIVE_IDENTITY,
    GPU_FIXED_PROGRAM_STATUS,
    GPU_SPAWN_PROGRAM_ABI_VERSION,
    GPU_SPAWN_PROGRAM_MODE,
    GPU_SPAWN_PROGRAM_REQUEST_FLAGS,
    GPU_SPAWN_PROGRAM_RESULT,
    GPU_TOWER_GAMEPLAY_TARGET_CONFIG_ABI_VERSION,
    createGpuBodyControlProgramStorage,
    createGpuSpawnProgramStorage,
    readGpuBodyControlProgramHeader,
    readGpuBodyControlProgramRecord,
    readGpuSpawnProgramHeader,
    readGpuSpawnProgramRecord,
    writeGpuBodyControlProgramHeader,
    writeGpuBodyControlProgramRecord,
    writeGpuSpawnProgramHeader,
    writeGpuSpawnProgramRecord
} = await loadGameModule(
    'ingame/physics/gpu/gpu_fixed_primitive_abi.js'
);

function toHex(buffer) {
    return Array.from(new Uint8Array(buffer), (value) => (
        value.toString(16).padStart(2, '0')
    )).join('');
}

test('fixed primitive ABI의 control/spawn과 독립 Tower/tracked config offset을 고정한다', () => {
    assert.equal(GPU_BODY_CONTROL_PROGRAM_ABI_VERSION, 2);
    assert.equal(GPU_SPAWN_PROGRAM_ABI_VERSION, 4);
    assert.equal(GPU_TOWER_GAMEPLAY_TARGET_CONFIG_ABI_VERSION, 1);
    assert.equal(
        GPU_BODY_CONTROL_SELECTION_POLICY.CORE_FIRST_IN_RANGE_THEN_TOWER,
        1
    );
    const header = GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER;
    assert.equal(header.STRIDE, 16);
    assert.equal(header.ABI_VERSION, 0);
    assert.equal(header.COUNT, 4);
    assert.equal(header.CAPACITY, 8);
    assert.equal(header.STATUS, 12);

    const control = GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_RECORD;
    assert.equal(control.STRIDE, 96);
    assert.equal(control.DESTINATION_SLOT, 0);
    assert.equal(control.ENTITY_ID, 4);
    assert.equal(control.INCARNATION, 8);
    assert.equal(control.MODE_FLAGS, 12);
    assert.equal(control.MOVE_INTENT_X, 16);
    assert.equal(control.MOVE_INTENT_Y, 20);
    assert.equal(control.SOURCE_TICK, 24);
    assert.equal(control.SELECTION_SEQUENCE, 28);
    assert.equal(control.CORE_TARGET_SLOT, 32);
    assert.equal(control.CORE_TARGET_ENTITY_ID, 36);
    assert.equal(control.CORE_TARGET_INCARNATION, 40);
    assert.equal(control.TOWER_TARGET_SLOT, 44);
    assert.equal(control.TOWER_TARGET_ENTITY_ID, 48);
    assert.equal(control.TOWER_TARGET_INCARNATION, 52);
    assert.equal(control.ATTACK_RANGE, 56);
    assert.equal(control.RESULT, 60);
    assert.equal(control.SELECTED_TARGET_KIND, 64);
    assert.equal(control.SELECTED_TARGET_SLOT, 68);
    assert.equal(control.SELECTED_TARGET_ENTITY_ID, 72);
    assert.equal(control.SELECTED_TARGET_INCARNATION, 76);
    assert.equal(control.STATE_FLAGS, 80);
    assert.equal(control.ATTACK_FINGERPRINT, 84);
    assert.equal(control.SELECTION_POLICY, 88);
    assert.equal(control.RESERVED_0, 92);

    const controlState = GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_STATE;
    assert.equal(controlState.STRIDE, 64);
    assert.equal(controlState.MOVE_INTENT_X, 0);
    assert.equal(controlState.MOVE_INTENT_Y, 4);
    assert.equal(controlState.ENTITY_ID, 8);
    assert.equal(controlState.INCARNATION, 12);
    assert.equal(controlState.SOURCE_TICK, 16);
    assert.equal(controlState.SELECTION_SEQUENCE, 20);
    assert.equal(controlState.ATTACK_FINGERPRINT, 24);
    assert.equal(controlState.RESULT, 28);
    assert.equal(controlState.SELECTED_TARGET_KIND, 32);
    assert.equal(controlState.SELECTED_TARGET_SLOT, 36);
    assert.equal(controlState.SELECTED_TARGET_ENTITY_ID, 40);
    assert.equal(controlState.SELECTED_TARGET_INCARNATION, 44);
    assert.equal(controlState.STATE_FLAGS, 48);
    assert.equal(controlState.SELECTION_POLICY, 52);
    assert.equal(controlState.ATTACK_RANGE, 56);
    assert.equal(controlState.RESERVED_0, 60);

    const spawn = GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD;
    assert.equal(spawn.STRIDE, 96);
    assert.equal(spawn.DESTINATION_SLOT, 0);
    assert.equal(spawn.DESTINATION_ENTITY_ID, 4);
    assert.equal(spawn.DESTINATION_INCARNATION, 8);
    assert.equal(spawn.SOURCE_SLOT, 12);
    assert.equal(spawn.SOURCE_ENTITY_ID, 16);
    assert.equal(spawn.SOURCE_INCARNATION, 20);
    assert.equal(spawn.TARGET_SLOT, 24);
    assert.equal(spawn.TARGET_ENTITY_ID, 28);
    assert.equal(spawn.TARGET_INCARNATION, 32);
    assert.equal(spawn.MODE_FLAGS, 36);
    assert.equal(spawn.RESULT, 40);
    assert.equal(spawn.SOURCE_TICK, 44);
    assert.equal(spawn.POSITION_OFFSET_X, 48);
    assert.equal(spawn.POSITION_OFFSET_Y, 52);
    assert.equal(spawn.TARGET_OFFSET_X, 56);
    assert.equal(spawn.TARGET_OFFSET_Y, 60);
    assert.equal(spawn.MODE_VECTOR_X, 64);
    assert.equal(spawn.MODE_VECTOR_Y, 68);
    assert.equal(spawn.MODE_SCALAR, 72);
    assert.equal(spawn.VECTOR_X, 64);
    assert.equal(spawn.VECTOR_Y, 68);
    assert.equal(spawn.SCALAR, 72);
    assert.equal(spawn.LAUNCH_VELOCITY_X, 64);
    assert.equal(spawn.LAUNCH_VELOCITY_Y, 68);
    assert.equal(spawn.SOURCE_VELOCITY_SCALE, 72);
    assert.equal(spawn.RESERVED_0, 76);
    assert.equal(spawn.SELECTION_SEQUENCE, 80);
    assert.equal(spawn.ATTACK_FINGERPRINT, 84);
    assert.equal(spawn.SELECTED_TARGET_KIND, 88);
    assert.equal(spawn.REQUEST_FLAGS, 92);

    const trackedConfig = GPU_FIXED_PRIMITIVE_ABI.TRACKED_POSE_CONFIG;
    assert.equal(trackedConfig.STRIDE, 16);
    assert.equal(trackedConfig.SOURCE_SLOT, 0);
    assert.equal(trackedConfig.ENTITY_ID, 4);
    assert.equal(trackedConfig.INCARNATION, 8);
    assert.equal(trackedConfig.ENABLED, 12);

    const towerGameplayTarget
        = GPU_FIXED_PRIMITIVE_ABI.TOWER_GAMEPLAY_TARGET_CONFIG;
    assert.equal(towerGameplayTarget.STRIDE, 16);
    assert.equal(towerGameplayTarget.TARGET_SLOT, 0);
    assert.equal(towerGameplayTarget.ENTITY_ID, 4);
    assert.equal(towerGameplayTarget.INCARNATION, 8);
    assert.equal(towerGameplayTarget.ENABLED, 12);
    assert.notStrictEqual(towerGameplayTarget, trackedConfig);

    const trackedPose = GPU_FIXED_PRIMITIVE_ABI.TRACKED_POSE_RECORD;
    assert.equal(trackedPose.STRIDE, 32);
    assert.equal(trackedPose.POSITION_X, 0);
    assert.equal(trackedPose.POSITION_Y, 4);
    assert.equal(trackedPose.VELOCITY_X, 8);
    assert.equal(trackedPose.VELOCITY_Y, 12);
    assert.equal(trackedPose.PREVIOUS_POSITION_X, 16);
    assert.equal(trackedPose.PREVIOUS_POSITION_Y, 20);
    assert.equal(trackedPose.ENTITY_ID, 24);
    assert.equal(trackedPose.INCARNATION, 28);
});

test('BodyControlProgram v2는 16-byte header와 96-byte record의 little-endian fixture를 고정한다', () => {
    const storage = createGpuBodyControlProgramStorage(1);
    writeGpuBodyControlProgramHeader(
        storage,
        1,
        GPU_FIXED_PROGRAM_STATUS.OK
    );
    writeGpuBodyControlProgramRecord(storage, 0, {
        destinationSlot: 9,
        entityId: 17,
        incarnation: 2,
        modeFlags: GPU_BODY_CONTROL_PROGRAM_MODE.MOVE_INTENT,
        moveIntentX: 0.5,
        moveIntentY: -0.5
    });

    assert.equal(storage.buffer.byteLength, 16 + 96);
    assert.equal(toHex(storage.buffer), [
        '02000000010000000100000000000000',
        '09000000110000000200000001000000',
        '0000003f000000bf0000000000000000',
        'ffffffffffffffffffffffffffffffff',
        'ffffffffffffffff0000000000000000',
        '00000000ffffffffffffffffffffffff',
        '00000000000000000000000000000000'
    ].join(''));
    const header = readGpuBodyControlProgramHeader(storage);
    assert.equal(header.abiVersion, GPU_BODY_CONTROL_PROGRAM_ABI_VERSION);
    assert.equal(header.count, 1);
    assert.equal(header.capacity, 1);
    assert.equal(header.status, GPU_FIXED_PROGRAM_STATUS.OK);
    const record = readGpuBodyControlProgramRecord(storage, 0);
    assert.equal(record.modeFlags, GPU_BODY_CONTROL_PROGRAM_MODE.MOVE_INTENT);
    assert.equal(record.sourceTick, 0);
    assert.equal(record.result, GPU_BODY_CONTROL_PROGRAM_RESULT.PENDING);
    assert.equal(
        record.selectedTargetKind,
        GPU_BODY_CONTROL_SELECTED_TARGET_KIND.NONE
    );
});

test('SpawnProgram v4 velocity mode는 16-byte header와 96-byte record의 exact binary fixture를 round-trip한다', () => {
    const storage = createGpuSpawnProgramStorage(1);
    writeGpuSpawnProgramHeader(storage, 1);
    writeGpuSpawnProgramRecord(storage, 0, {
        destinationSlot: 3,
        destinationEntityId: 0x01020304,
        destinationIncarnation: 5,
        sourceSlot: 7,
        sourceEntityId: 0x0a0b0c0d,
        sourceIncarnation: 11,
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TICK_START,
        result: GPU_SPAWN_PROGRAM_RESULT.PENDING,
        positionOffset: { x: 1.5, y: -2.25 },
        launchVelocity: { x: 4, y: -0.5 },
        sourceVelocityScale: 0.25,
        sourceTick: 37
    });

    assert.equal(storage.buffer.byteLength, 16 + 96);
    assert.equal(toHex(storage.buffer), [
        '04000000010000000100000000000000',
        '03000000040302010500000007000000',
        '0d0c0b0a0b000000ffffffffffffffff',
        'ffffffff010000000000000025000000',
        '0000c03f000010c00000000000000000',
        '00008040000000bf0000803e00000000',
        '00000000000000000000000000000000'
    ].join(''));

    const header = readGpuSpawnProgramHeader(storage);
    assert.equal(header.abiVersion, GPU_SPAWN_PROGRAM_ABI_VERSION);
    assert.equal(header.count, 1);
    assert.equal(header.capacity, 1);
    assert.equal(header.status, GPU_FIXED_PROGRAM_STATUS.OK);

    const record = readGpuSpawnProgramRecord(storage, 0);
    assert.equal(record.destinationSlot, 3);
    assert.equal(record.destinationEntityId, 0x01020304);
    assert.equal(record.destinationIncarnation, 5);
    assert.equal(record.sourceSlot, 7);
    assert.equal(record.sourceEntityId, 0x0a0b0c0d);
    assert.equal(record.sourceIncarnation, 11);
    assert.equal(
        record.targetSlot,
        GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT
    );
    assert.equal(
        record.targetEntityId,
        GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT
    );
    assert.equal(
        record.targetIncarnation,
        GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT
    );
    assert.equal(record.modeFlags, GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TICK_START);
    assert.equal(record.result, GPU_SPAWN_PROGRAM_RESULT.PENDING);
    assert.equal(record.positionOffset.x, 1.5);
    assert.equal(record.positionOffset.y, -2.25);
    assert.deepEqual({ ...record.targetOffset }, { x: 0, y: 0 });
    assert.equal(record.vector.x, 4);
    assert.equal(record.vector.y, -0.5);
    assert.equal(record.scalar, 0.25);
    assert.equal(record.launchVelocity.x, 4);
    assert.equal(record.launchVelocity.y, -0.5);
    assert.equal(record.sourceVelocityScale, 0.25);
    assert.equal(record.sourceTick, 37);
    assert.equal(record.reserved0, 0);
    assert.equal(Object.isFrozen(record), true);
    assert.equal(Object.isFrozen(record.positionOffset), true);
    assert.equal(Object.isFrozen(record.targetOffset), true);
    assert.equal(Object.isFrozen(record.vector), true);
    assert.strictEqual(record.vector, record.launchVelocity);
});

test('SpawnProgram v4 aim-point mode는 동일 96-byte record의 mode vector/scalar offset을 사용한다', () => {
    const storage = createGpuSpawnProgramStorage(1);
    writeGpuSpawnProgramHeader(storage, 1);
    writeGpuSpawnProgramRecord(storage, 0, {
        destinationSlot: 3,
        destinationEntityId: 0x01020304,
        destinationIncarnation: 5,
        sourceSlot: 7,
        sourceEntityId: 0x0a0b0c0d,
        sourceIncarnation: 11,
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT,
        positionOffset: { x: -1, y: 2.5 },
        aimWorldPoint: { x: 8, y: -4 },
        launchSpeed: 18,
        sourceTick: 37
    });

    assert.equal(storage.buffer.byteLength, 16 + 96);
    assert.equal(toHex(storage.buffer), [
        '04000000010000000100000000000000',
        '03000000040302010500000007000000',
        '0d0c0b0a0b000000ffffffffffffffff',
        'ffffffff020000000000000025000000',
        '000080bf000020400000000000000000',
        '00000041000080c00000904100000000',
        '00000000000000000000000000000000'
    ].join(''));

    const record = readGpuSpawnProgramRecord(storage, 0);
    assert.equal(record.modeFlags, GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT);
    assert.deepEqual({ ...record.positionOffset }, { x: -1, y: 2.5 });
    assert.deepEqual({ ...record.vector }, { x: 8, y: -4 });
    assert.strictEqual(record.vector, record.aimWorldPoint);
    assert.equal(record.scalar, 18);
    assert.equal(record.launchSpeed, 18);
    assert.equal('launchVelocity' in record, false);
    assert.equal('sourceVelocityScale' in record, false);
    assert.equal(Object.isFrozen(record.aimWorldPoint), true);
});

test('SpawnProgram v4 target-entity mode는 exact target identity/offset과 zero vector를 round-trip한다', () => {
    const storage = createGpuSpawnProgramStorage(1);
    writeGpuSpawnProgramHeader(storage, 1);
    writeGpuSpawnProgramRecord(storage, 0, {
        destinationSlot: 3,
        destinationEntityId: 0x01020304,
        destinationIncarnation: 5,
        sourceSlot: 7,
        sourceEntityId: 0x0a0b0c0d,
        sourceIncarnation: 11,
        targetSlot: 9,
        targetEntityId: 0x11121314,
        targetIncarnation: 13,
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        positionOffset: { x: 0.5, y: -0.25 },
        targetOffset: { x: 2, y: -1 },
        launchSpeed: 12,
        sourceTick: 37
    });

    assert.equal(storage.buffer.byteLength, 16 + 96);
    assert.equal(toHex(storage.buffer), [
        '04000000010000000100000000000000',
        '03000000040302010500000007000000',
        '0d0c0b0a0b0000000900000014131211',
        '0d000000030000000000000025000000',
        '0000003f000080be00000040000080bf',
        '00000000000000000000404100000000',
        '00000000000000000000000000000000'
    ].join(''));

    const record = readGpuSpawnProgramRecord(storage, 0);
    assert.equal(
        record.modeFlags,
        GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY
    );
    assert.equal(record.targetSlot, 9);
    assert.equal(record.targetEntityId, 0x11121314);
    assert.equal(record.targetIncarnation, 13);
    assert.deepEqual({ ...record.positionOffset }, { x: 0.5, y: -0.25 });
    assert.deepEqual({ ...record.targetOffset }, { x: 2, y: -1 });
    assert.deepEqual({ ...record.vector }, { x: 0, y: 0 });
    assert.equal(record.scalar, 12);
    assert.equal(record.launchSpeed, 12);
    assert.equal('aimWorldPoint' in record, false);
    assert.equal('launchVelocity' in record, false);
    assert.equal(Object.isFrozen(record.targetOffset), true);
});

test('SpawnProgram v4 selected-target mode는 launchSpeed를 velocity payload로 오판하지 않고 round-trip한다', () => {
    const storage = createGpuSpawnProgramStorage(1);
    writeGpuSpawnProgramHeader(storage, 1);
    assert.doesNotThrow(() => writeGpuSpawnProgramRecord(storage, 0, {
        destinationSlot: 3,
        destinationEntityId: 0x01020304,
        destinationIncarnation: 5,
        sourceSlot: 7,
        sourceEntityId: 0x0a0b0c0d,
        sourceIncarnation: 11,
        modeFlags:
            GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET,
        positionOffset: { x: 0.5, y: -0.25 },
        targetOffset: { x: 2, y: -1 },
        launchSpeed: 12,
        sourceTick: 37,
        selectionSequence: 9,
        attackFingerprint: 77,
        selectedTargetKind: GPU_BODY_CONTROL_SELECTED_TARGET_KIND.NONE,
        requestFlags:
            GPU_SPAWN_PROGRAM_REQUEST_FLAGS.REQUIRE_EXACT_SELECTED_TARGET
    }));
    const record = readGpuSpawnProgramRecord(storage, 0);
    assert.equal(
        record.modeFlags,
        GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET
    );
    assert.equal(record.targetSlot, GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT);
    assert.equal(record.targetEntityId, GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT);
    assert.equal(record.targetIncarnation, GPU_FIXED_PRIMITIVE_IDENTITY.INVALID_COMPONENT);
    assert.deepEqual({ ...record.targetOffset }, { x: 2, y: -1 });
    assert.equal(record.launchSpeed, 12);
    assert.equal(record.selectionSequence, 9);
    assert.equal(record.attackFingerprint, 77);
    assert.equal(
        record.requestFlags,
        GPU_SPAWN_PROGRAM_REQUEST_FLAGS.REQUIRE_EXACT_SELECTED_TARGET
    );
});

test('SpawnProgram v4 writer는 mode별 forbidden field와 identity/result/reserved 계약을 fail closed한다', () => {
    const storage = createGpuSpawnProgramStorage(1);
    const common = {
        destinationSlot: 1,
        destinationEntityId: 2,
        destinationIncarnation: 3,
        sourceSlot: 4,
        sourceEntityId: 5,
        sourceIncarnation: 6,
        positionOffset: { x: 0, y: 0 },
        sourceTick: 7
    };

    assert.doesNotThrow(() => writeGpuSpawnProgramRecord(storage, 0, {
        ...common,
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        targetSlot: 0,
        targetEntityId: 10,
        targetIncarnation: 11,
        launchSpeed: 12
    }));
    assert.throws(() => writeGpuSpawnProgramRecord(storage, 0, {
        ...common,
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        targetSlot: 0,
        targetEntityId: 0,
        targetIncarnation: 11,
        launchSpeed: 12
    }), /exact target identity/);
    assert.throws(() => writeGpuSpawnProgramRecord(storage, 0, {
        ...common,
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        targetSlot: 0,
        targetEntityId: 10,
        targetIncarnation: 0,
        launchSpeed: 12
    }), /exact target identity/);

    assert.throws(() => writeGpuSpawnProgramRecord(storage, 0, {
        ...common,
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY,
        launchVelocity: { x: 1, y: 0 },
        sourceVelocityScale: 0,
        aimWorldPoint: { x: 4, y: 5 }
    }), /aimWorldPoint\/launchSpeed/);
    assert.throws(() => writeGpuSpawnProgramRecord(storage, 0, {
        ...common,
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT,
        aimWorldPoint: { x: 4, y: 5 },
        launchSpeed: 18,
        launchVelocity: { x: 1, y: 0 }
    }), /launchVelocity\/sourceVelocityScale/);
    assert.throws(() => writeGpuSpawnProgramRecord(storage, 0, {
        ...common,
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT,
        aimWorldPoint: { x: 4, y: 5 },
        launchSpeed: 0
    }), /launchSpeed/);
    assert.throws(() => writeGpuSpawnProgramRecord(storage, 0, {
        ...common,
        modeFlags: 99,
        vector: { x: 1, y: 0 },
        scalar: 0
    }), /v4 ingress/);
    assert.throws(() => writeGpuSpawnProgramRecord(storage, 0, {
        ...common,
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY,
        launchVelocity: { x: 1, y: 0 },
        sourceVelocityScale: 0,
        result: GPU_SPAWN_PROGRAM_RESULT.RESOLVED
    }), /v4 ingress/);
    assert.throws(() => writeGpuSpawnProgramRecord(storage, 0, {
        ...common,
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY,
        launchVelocity: { x: 1, y: 0 },
        sourceVelocityScale: 0,
        reserved0: 1
    }), /v4 ingress/);

    assert.throws(() => writeGpuSpawnProgramRecord(storage, 0, {
        ...common,
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        targetSlot: 9,
        targetEntityId: 10,
        launchSpeed: 12
    }), /exact target identity/);
    assert.throws(() => writeGpuSpawnProgramRecord(storage, 0, {
        ...common,
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY,
        targetOffset: { x: 1, y: 0 },
        launchVelocity: { x: 1, y: 0 },
        sourceVelocityScale: 0
    }), /sentinel\/zero/);
    assert.throws(() => writeGpuSpawnProgramRecord(storage, 0, {
        ...common,
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        targetSlot: 9,
        targetEntityId: 10,
        targetIncarnation: 11,
        targetOffset: { x: 0, y: 0 },
        launchSpeed: 12,
        launchVelocity: { x: 1, y: 0 }
    }), /velocity\/aim-point payload/);
    assert.throws(() => writeGpuSpawnProgramRecord(storage, 0, {
        ...common,
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        targetSlot: 9,
        targetEntityId: 10,
        targetIncarnation: 11,
        targetOffset: { x: 0, y: 0 },
        vector: { x: 1, y: 0 },
        launchSpeed: 12
    }), /modeVector/);
});

test('program header의 version mismatch와 capacity 초과는 host에서 fail closed한다', () => {
    const spawnStorage = createGpuSpawnProgramStorage(1);
    assert.equal(GPU_BODY_CONTROL_PROGRAM_ABI_VERSION, 2);
    assert.equal(GPU_SPAWN_PROGRAM_ABI_VERSION, 4);
    new DataView(spawnStorage.buffer).setUint32(0, 1, true);
    assert.throws(
        () => readGpuSpawnProgramHeader(spawnStorage),
        /ABI version mismatch/
    );

    const controlStorage = createGpuBodyControlProgramStorage(1);
    assert.throws(
        () => writeGpuBodyControlProgramHeader(controlStorage, 2),
        /capacity/
    );
    assert.throws(
        () => writeGpuBodyControlProgramRecord(controlStorage, 0, {
            destinationSlot: 0,
            entityId: 1,
            incarnation: 1,
            moveIntentX: 1,
            moveIntentY: 1
        }),
        /크기는 1 이하/
    );
});
