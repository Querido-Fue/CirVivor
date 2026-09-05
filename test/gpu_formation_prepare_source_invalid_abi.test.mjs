import test from 'node:test';
import assert from 'node:assert/strict';

import {
    GPU_FORMATION_IDENTITY_INVALID,
    GPU_FORMATION_PREPARE_PROGRAM_FLAG,
    createGpuFormationPrepareProgramStorage,
    readGpuFormationPrepareProgramRecord,
    writeGpuFormationPrepareProgramRecord
} from '../project/game/script/module/ingame/physics/gpu/gpu_formation_runtime_abi.js';

function sourceWith(overrides = {}) {
    return {
        sourceSlot: 7,
        sourceEntityId: 101,
        sourceIncarnation: 3,
        sourceTick: 29,
        prepareSequence: 0,
        fingerprint: 12345,
        flags: 0,
        ...overrides
    };
}

test('Formation prepare ABI는 lifecycle 증명이 있는 invalid source slot만 직렬화한다', () => {
    const storage = createGpuFormationPrepareProgramStorage(1);
    writeGpuFormationPrepareProgramRecord(storage, 0, sourceWith({
        sourceSlot: GPU_FORMATION_IDENTITY_INVALID,
        flags: GPU_FORMATION_PREPARE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID
    }));

    const record = readGpuFormationPrepareProgramRecord(storage, 0);
    assert.equal(record.sourceSlot, GPU_FORMATION_IDENTITY_INVALID);
    assert.equal(
        record.flags,
        GPU_FORMATION_PREPARE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID
    );
});

test('Formation prepare ABI는 lifecycle 증명 없는 invalid source slot을 거절한다', () => {
    const storage = createGpuFormationPrepareProgramStorage(1);
    assert.throws(
        () => writeGpuFormationPrepareProgramRecord(storage, 0, sourceWith({
            sourceSlot: GPU_FORMATION_IDENTITY_INVALID
        })),
        /formation prepare sourceSlot/
    );
});
