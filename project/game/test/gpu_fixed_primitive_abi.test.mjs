import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_BODY_CONTROL_PROGRAM_ABI_VERSION,
    GPU_FIXED_PRIMITIVE_ABI,
    GPU_FIXED_PROGRAM_STATUS,
    GPU_SPAWN_PROGRAM_ABI_VERSION,
    GPU_SPAWN_PROGRAM_MODE,
    GPU_SPAWN_PROGRAM_RESULT,
    createGpuBodyControlProgramStorage,
    createGpuSpawnProgramStorage,
    readGpuBodyControlProgramHeader,
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

test('fixed primitive ABI의 header, control, spawn, tracked-pose stride와 offset을 고정한다', () => {
    const header = GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER;
    assert.equal(header.STRIDE, 16);
    assert.equal(header.ABI_VERSION, 0);
    assert.equal(header.COUNT, 4);
    assert.equal(header.CAPACITY, 8);
    assert.equal(header.STATUS, 12);

    const control = GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_RECORD;
    assert.equal(control.STRIDE, 32);
    assert.equal(control.DESTINATION_SLOT, 0);
    assert.equal(control.ENTITY_ID, 4);
    assert.equal(control.INCARNATION, 8);
    assert.equal(control.FLAGS, 12);
    assert.equal(control.MOVE_INTENT_X, 16);
    assert.equal(control.MOVE_INTENT_Y, 20);
    assert.equal(control.RESERVED_0, 24);
    assert.equal(control.RESERVED_1, 28);

    const controlState = GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_STATE;
    assert.equal(controlState.STRIDE, 16);
    assert.equal(controlState.MOVE_INTENT_X, 0);
    assert.equal(controlState.MOVE_INTENT_Y, 4);
    assert.equal(controlState.ENTITY_ID, 8);
    assert.equal(controlState.INCARNATION, 12);

    const spawn = GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD;
    assert.equal(spawn.STRIDE, 64);
    assert.equal(spawn.DESTINATION_SLOT, 0);
    assert.equal(spawn.DESTINATION_ENTITY_ID, 4);
    assert.equal(spawn.DESTINATION_INCARNATION, 8);
    assert.equal(spawn.SOURCE_SLOT, 12);
    assert.equal(spawn.SOURCE_ENTITY_ID, 16);
    assert.equal(spawn.SOURCE_INCARNATION, 20);
    assert.equal(spawn.MODE_FLAGS, 24);
    assert.equal(spawn.RESULT, 28);
    assert.equal(spawn.POSITION_OFFSET_X, 32);
    assert.equal(spawn.POSITION_OFFSET_Y, 36);
    assert.equal(spawn.LAUNCH_VELOCITY_X, 40);
    assert.equal(spawn.LAUNCH_VELOCITY_Y, 44);
    assert.equal(spawn.SOURCE_VELOCITY_SCALE, 48);
    assert.equal(spawn.SOURCE_TICK, 52);
    assert.equal(spawn.RESERVED_0, 56);
    assert.equal(spawn.RESERVED_1, 60);

    const trackedConfig = GPU_FIXED_PRIMITIVE_ABI.TRACKED_POSE_CONFIG;
    assert.equal(trackedConfig.STRIDE, 16);
    assert.equal(trackedConfig.SOURCE_SLOT, 0);
    assert.equal(trackedConfig.ENTITY_ID, 4);
    assert.equal(trackedConfig.INCARNATION, 8);
    assert.equal(trackedConfig.ENABLED, 12);

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

test('body-control program은 16-byte header와 32-byte record의 little-endian fixture를 고정한다', () => {
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
        flags: 0,
        moveIntentX: 0.5,
        moveIntentY: -0.5
    });

    assert.equal(storage.buffer.byteLength, 16 + 32);
    assert.equal(toHex(storage.buffer), [
        '01000000010000000100000000000000',
        '09000000110000000200000000000000',
        '0000003f000000bf0000000000000000'
    ].join(''));
    const header = readGpuBodyControlProgramHeader(storage);
    assert.equal(header.abiVersion, GPU_BODY_CONTROL_PROGRAM_ABI_VERSION);
    assert.equal(header.count, 1);
    assert.equal(header.capacity, 1);
    assert.equal(header.status, GPU_FIXED_PROGRAM_STATUS.OK);
});

test('SpawnProgram v1은 16-byte header와 64-byte record의 exact binary fixture를 round-trip한다', () => {
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

    assert.equal(storage.buffer.byteLength, 16 + 64);
    assert.equal(toHex(storage.buffer), [
        '01000000010000000100000000000000',
        '03000000040302010500000007000000',
        '0d0c0b0a0b0000000100000000000000',
        '0000c03f000010c000008040000000bf',
        '0000803e250000000000000000000000'
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
    assert.equal(record.modeFlags, GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TICK_START);
    assert.equal(record.result, GPU_SPAWN_PROGRAM_RESULT.PENDING);
    assert.equal(record.positionOffset.x, 1.5);
    assert.equal(record.positionOffset.y, -2.25);
    assert.equal(record.launchVelocity.x, 4);
    assert.equal(record.launchVelocity.y, -0.5);
    assert.equal(record.sourceVelocityScale, 0.25);
    assert.equal(record.sourceTick, 37);
    assert.equal(record.reserved0, 0);
    assert.equal(record.reserved1, 0);
});

test('program header의 version mismatch와 capacity 초과는 host에서 fail closed한다', () => {
    const spawnStorage = createGpuSpawnProgramStorage(1);
    new DataView(spawnStorage.buffer).setUint32(0, 2, true);
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
