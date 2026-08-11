import {
    GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE,
    GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM
} from './gpu_circle_body_abi.js';

const INVALID_U32 = 0xffffffff;

export const GPU_ATOMIC_TRANSFORM_RUNTIME_ABI_VERSION = 1;
export const GPU_ATOMIC_TRANSFORM_PREPARE_PROGRAM_ABI_VERSION = 1;
export const GPU_ATOMIC_TRANSFORM_PROGRAM_ABI_VERSION = 1;
export const GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION = 1;

export const GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE = Object.freeze({
    NONE: 0,
    MANY_TO_ONE: 1,
    ONE_TO_MANY: 2,
    ONE_TO_ONE_DELAYED: 3
});

export const GPU_ATOMIC_TRANSFORM_PREPARE_RESULT = Object.freeze({
    PENDING: 0,
    AUTHENTIC: 1
});

export const GPU_ATOMIC_TRANSFORM_RESULT = Object.freeze({
    PENDING: 0,
    COMMITTED: 1,
    SOURCE_INVALID: 2,
    DESTINATION_INVALID: 3,
    BATCH_REJECTED: 4
});

export const GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS = Object.freeze({
    OK: 0,
    ABI_MISMATCH: 1 << 0,
    CAPACITY_EXCEEDED: 1 << 1,
    RECORD_INVALID: 1 << 2,
    SOURCE_CONFLICT: 1 << 3,
    DESTINATION_CONFLICT: 1 << 4,
    EFFECT_REKEY_MISMATCH: 1 << 5,
    COMMIT_COUNT_MISMATCH: 1 << 6
});

/**
 * Prepare는 mark_dead 뒤 GPU live state를 compact record로 증명합니다.
 * Transform record는 destination template plane과 exact slot/handle을 결합합니다.
 */
export const GPU_ATOMIC_TRANSFORM_RUNTIME_ABI = Object.freeze({
    PREPARE_HEADER: Object.freeze({
        STRIDE: 32,
        ABI_VERSION: 0,
        SOURCE_TICK: 4,
        TARGET_FIXED_TICK: 8,
        BATCH_ID_FINGERPRINT: 12,
        CAPACITY: 16,
        RECORD_COUNT: 20,
        STATUS: 24,
        RESERVED_0: 28
    }),
    PREPARE_RECORD: Object.freeze({
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
    }),
    TRANSFORM_HEADER: Object.freeze({
        STRIDE: 48,
        ABI_VERSION: 0,
        COUNT: 4,
        CAPACITY: 8,
        BATCH_ID_FINGERPRINT: 12,
        PREPARED_SOURCE_TICK: 16,
        TARGET_FIXED_TICK: 20,
        STATUS: 24,
        BATCH_ACCEPTED: 28,
        COMMITTED_COUNT: 32,
        EFFECT_REKEY_COUNT: 36,
        EXPECTED_EFFECT_REKEY_COUNT: 40,
        FAILURE_RECORD_INDEX: 44
    }),
    TRANSFORM_RECORD: Object.freeze({
        STRIDE: 80,
        TOPOLOGY_CODE: 0,
        SOURCE_SLOT: 4,
        SOURCE_ENTITY_ID: 8,
        SOURCE_INCARNATION: 12,
        DESTINATION_0_SLOT: 16,
        DESTINATION_0_ENTITY_ID: 20,
        DESTINATION_0_INCARNATION: 24,
        DESTINATION_1_SLOT: 28,
        DESTINATION_1_ENTITY_ID: 32,
        DESTINATION_1_INCARNATION: 36,
        DESTINATION_COUNT: 40,
        EFFECT_TRANSFER_DESTINATION_INDEX: 44,
        PREPARE_RECORD_FINGERPRINT: 48,
        COMMAND_GENERATION: 52,
        RESULT: 56,
        EFFECT_REKEY_COUNT: 60,
        SOURCE_CURRENT_HEALTH_FIXED_POINT: 64,
        SOURCE_MAX_HEALTH_FIXED_POINT: 68,
        TRIGGER_SOURCE_TICK: 72,
        TRIGGER_SEQUENCE: 76
    })
});

export const GPU_ATOMIC_TRANSFORM_RUNTIME_STORAGE_PROFILE = Object.freeze({
    prepare: 5,
    transformBodies: 9,
    transformState: 7,
    transformAuxiliary: 9,
    transformControl: 5,
    effectRekey: 3,
    requiredMaximum: 9
});

function requireCapacity(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value) || value <= 0 || value >= INVALID_U32) {
        throw new RangeError(`${label}은 live uint32 범위의 양의 정수여야 합니다.`);
    }
    return value;
}

function requireUint32(value, label, { positive = false, allowInvalid = false } = {}) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < (positive ? 1 : 0)
        || value > (allowInvalid ? INVALID_U32 : INVALID_U32 - 1)) {
        throw new RangeError(`${label}은 유효한 uint32여야 합니다.`);
    }
    return value >>> 0;
}

function requireInt32(value, label, { positive = false } = {}) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < (positive ? 1 : -0x80000000)
        || value > 0x7fffffff) {
        throw new RangeError(`${label}은 ${positive ? 'positive ' : ''}int32여야 합니다.`);
    }
    return value;
}

function requireStorage(storage, header, record, label) {
    if (!storage || !(storage.buffer instanceof ArrayBuffer)
        || !(storage.view instanceof DataView)
        || storage.view.buffer !== storage.buffer
        || !Number.isSafeInteger(storage.capacity)
        || storage.capacity <= 0
        || storage.buffer.byteLength
            !== header.STRIDE + storage.capacity * record.STRIDE) {
        throw new TypeError(`${label} storage가 ABI와 일치하지 않습니다.`);
    }
    return storage;
}

function createStorage(capacity, header, record) {
    const normalizedCapacity = requireCapacity(capacity, 'capacity');
    const buffer = new ArrayBuffer(
        header.STRIDE + normalizedCapacity * record.STRIDE
    );
    return Object.freeze({
        capacity: normalizedCapacity,
        buffer,
        view: new DataView(buffer)
    });
}

export function createGpuAtomicTransformPrepareStorage(capacity) {
    const storage = createStorage(
        capacity,
        GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_HEADER,
        GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_RECORD
    );
    writeGpuAtomicTransformPrepareHeader(storage, { capacity });
    return storage;
}

export function writeGpuAtomicTransformPrepareHeader(storage, source = {}) {
    requireStorage(
        storage,
        GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_HEADER,
        GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_RECORD,
        'AtomicTransform prepare'
    );
    const h = GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_HEADER;
    const view = storage.view;
    const recordCount = requireUint32(
        source.recordCount ?? 0,
        'recordCount'
    );
    if (recordCount > storage.capacity) {
        throw new RangeError('recordCount가 AtomicTransform prepare capacity를 넘었습니다.');
    }
    view.setUint32(h.ABI_VERSION, GPU_ATOMIC_TRANSFORM_PREPARE_PROGRAM_ABI_VERSION, true);
    view.setUint32(h.SOURCE_TICK, requireUint32(source.sourceTick ?? 0, 'sourceTick'), true);
    view.setUint32(h.TARGET_FIXED_TICK, requireUint32(source.targetFixedTick ?? 0, 'targetFixedTick'), true);
    view.setUint32(h.BATCH_ID_FINGERPRINT, requireUint32(source.batchIdFingerprint ?? 0, 'batchIdFingerprint'), true);
    view.setUint32(h.CAPACITY, storage.capacity, true);
    view.setUint32(h.RECORD_COUNT, recordCount, true);
    view.setUint32(h.STATUS, requireUint32(source.status ?? 0, 'status'), true);
    view.setUint32(h.RESERVED_0, 0, true);
}

export function readGpuAtomicTransformPrepareHeader(storage) {
    requireStorage(storage, GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_HEADER,
        GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_RECORD, 'AtomicTransform prepare');
    const h = GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_HEADER;
    const view = storage.view;
    return Object.freeze({
        abiVersion: view.getUint32(h.ABI_VERSION, true),
        sourceTick: view.getUint32(h.SOURCE_TICK, true),
        targetFixedTick: view.getUint32(h.TARGET_FIXED_TICK, true),
        batchIdFingerprint: view.getUint32(h.BATCH_ID_FINGERPRINT, true),
        capacity: view.getUint32(h.CAPACITY, true),
        recordCount: view.getUint32(h.RECORD_COUNT, true),
        status: view.getUint32(h.STATUS, true)
    });
}

export function readGpuAtomicTransformPrepareRecord(storage, index) {
    requireStorage(storage, GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_HEADER,
        GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_RECORD, 'AtomicTransform prepare');
    if (!Number.isSafeInteger(index) || index < 0 || index >= storage.capacity) {
        throw new RangeError('AtomicTransform prepare record index가 범위를 벗어났습니다.');
    }
    const r = GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_RECORD;
    const base = GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.PREPARE_HEADER.STRIDE
        + index * r.STRIDE;
    const view = storage.view;
    const topologyCode = view.getUint32(base + r.TOPOLOGY_CODE, true);
    const split = topologyCode
        === GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_MANY;
    const delayed = topologyCode
        === GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_ONE_DELAYED;
    return Object.freeze({
        topologyCode,
        sourceSlot: view.getUint32(base + r.SOURCE_SLOT, true),
        sourceEntityId: view.getUint32(base + r.SOURCE_ENTITY_ID, true),
        sourceIncarnation: view.getUint32(base + r.SOURCE_INCARNATION, true),
        // v1 64B record는 topology가 canonical program/phase를 결정합니다.
        // Unknown topology는 0으로 fail-close하며 decoder validation이 거부합니다.
        programId: split
            ? GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.J_SPLIT_FIRST_HIT
            : delayed
                ? GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM
                    .C_PRIME_DELAYED_RECOMBINE
                : GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.NONE,
        phase: split
            ? GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.SPLIT_PENDING
            : delayed
                ? GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.CHILD_DELAYED
                : GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.NONE,
        dueFixedTick: view.getUint32(base + r.DUE_FIXED_TICK, true),
        lineageRootEntityId: view.getUint32(base + r.LINEAGE_ROOT_ENTITY_ID, true),
        lineageRootIncarnation: view.getUint32(base + r.LINEAGE_ROOT_INCARNATION, true),
        branchIndex: view.getUint32(base + r.BRANCH_INDEX, true),
        bountyBudget: view.getUint32(base + r.BOUNTY_BUDGET, true),
        commandGeneration: view.getUint32(base + r.COMMAND_GENERATION, true),
        currentHealthFixedPoint: view.getInt32(base + r.CURRENT_HEALTH_FIXED_POINT, true),
        maxHealthFixedPoint: view.getInt32(base + r.MAX_HEALTH_FIXED_POINT, true),
        triggerSourceTick: view.getUint32(base + r.TRIGGER_SOURCE_TICK, true),
        triggerSequence: view.getUint32(base + r.TRIGGER_SEQUENCE, true),
        result: view.getUint32(base + r.RESULT, true),
        recordFingerprint: view.getUint32(base + r.RECORD_FINGERPRINT, true)
    });
}

export function createGpuAtomicTransformProgramStorage(capacity) {
    const storage = createStorage(
        capacity,
        GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_HEADER,
        GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_RECORD
    );
    writeGpuAtomicTransformProgramHeader(storage, { capacity });
    return storage;
}

export function writeGpuAtomicTransformProgramHeader(storage, source = {}) {
    requireStorage(storage, GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_HEADER,
        GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_RECORD, 'AtomicTransform program');
    const h = GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_HEADER;
    const view = storage.view;
    const count = requireUint32(source.count ?? 0, 'count');
    if (count > storage.capacity) {
        throw new RangeError('count가 AtomicTransform program capacity를 넘었습니다.');
    }
    view.setUint32(h.ABI_VERSION, GPU_ATOMIC_TRANSFORM_PROGRAM_ABI_VERSION, true);
    view.setUint32(h.COUNT, count, true);
    view.setUint32(h.CAPACITY, storage.capacity, true);
    view.setUint32(h.BATCH_ID_FINGERPRINT, requireUint32(source.batchIdFingerprint ?? 0, 'batchIdFingerprint'), true);
    view.setUint32(h.PREPARED_SOURCE_TICK, requireUint32(source.preparedSourceTick ?? 0, 'preparedSourceTick'), true);
    view.setUint32(h.TARGET_FIXED_TICK, requireUint32(source.targetFixedTick ?? 0, 'targetFixedTick'), true);
    view.setUint32(h.STATUS, requireUint32(source.status ?? 0, 'status'), true);
    view.setUint32(h.BATCH_ACCEPTED, requireUint32(source.batchAccepted ?? 0, 'batchAccepted'), true);
    view.setUint32(h.COMMITTED_COUNT, requireUint32(source.committedCount ?? 0, 'committedCount'), true);
    view.setUint32(h.EFFECT_REKEY_COUNT, requireUint32(source.effectRekeyCount ?? 0, 'effectRekeyCount'), true);
    view.setUint32(h.EXPECTED_EFFECT_REKEY_COUNT, requireUint32(source.expectedEffectRekeyCount ?? 0, 'expectedEffectRekeyCount'), true);
    view.setUint32(h.FAILURE_RECORD_INDEX, requireUint32(source.failureRecordIndex ?? INVALID_U32, 'failureRecordIndex', { allowInvalid: true }), true);
}

export function writeGpuAtomicTransformProgramRecord(storage, index, source) {
    requireStorage(storage, GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_HEADER,
        GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_RECORD, 'AtomicTransform program');
    if (!Number.isSafeInteger(index) || index < 0 || index >= storage.capacity) {
        throw new RangeError('AtomicTransform record index가 범위를 벗어났습니다.');
    }
    const r = GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_RECORD;
    const base = GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_HEADER.STRIDE
        + index * r.STRIDE;
    const view = storage.view;
    const topologyCode = requireUint32(source.topologyCode, 'topologyCode');
    const triggerSourceTick = requireUint32(
        source.triggerSourceTick,
        'triggerSourceTick'
    );
    const triggerSequence = requireUint32(
        source.triggerSequence,
        'triggerSequence'
    );
    const expectedDestinationCount = topologyCode
        === GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_MANY ? 2 : 1;
    if ((topologyCode === GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_MANY
            && triggerSourceTick === 0)
        || (topologyCode
                === GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_ONE_DELAYED
            && (triggerSourceTick !== 0 || triggerSequence !== 0))
        || (topologyCode !== GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_MANY
            && topologyCode
                !== GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE.ONE_TO_ONE_DELAYED)) {
        throw new RangeError('AtomicTransform topology/trigger proof가 일치하지 않습니다.');
    }
    if (!Array.isArray(source.destinationHandles)
        || source.destinationHandles.length !== expectedDestinationCount
        || source.effectTransferDestinationIndex !== 0) {
        throw new RangeError('AtomicTransform destination cardinality/effect transfer가 일치하지 않습니다.');
    }
    const sourceSlot = requireUint32(source.sourceSlot, 'sourceSlot');
    const sourceEntityId = requireUint32(
        source.sourceEntityId,
        'sourceEntityId',
        { positive: true }
    );
    const sourceIncarnation = requireUint32(
        source.sourceIncarnation,
        'sourceIncarnation',
        { positive: true }
    );
    const destination0 = source.destinationHandles[0];
    if (requireUint32(destination0?.slot, 'destination0.slot') !== sourceSlot
        || requireUint32(
            destination0?.entityId,
            'destination0.entityId',
            { positive: true }
        ) !== sourceEntityId
        || requireUint32(
            destination0?.incarnation,
            'destination0.incarnation',
            { positive: true }
        ) !== sourceIncarnation + 1) {
        throw new RangeError('AtomicTransform destination0은 source slot/incarnation+1이어야 합니다.');
    }
    if (sourceIncarnation >= INVALID_U32 - 1) {
        throw new RangeError('AtomicTransform source incarnation이 증가 가능한 live 범위여야 합니다.');
    }
    const destination1 = source.destinationHandles?.[1]
        ?? { slot: INVALID_U32, entityId: INVALID_U32, incarnation: INVALID_U32 };
    if (expectedDestinationCount === 2) {
        const destination1Slot = requireUint32(
            destination1.slot,
            'destination1.slot'
        );
        const destination1EntityId = requireUint32(
            destination1.entityId,
            'destination1.entityId',
            { positive: true }
        );
        requireUint32(
            destination1.incarnation,
            'destination1.incarnation',
            { positive: true }
        );
        if (destination1Slot === sourceSlot
            || destination1EntityId === sourceEntityId) {
            throw new RangeError('AtomicTransform destination1은 별도 slot/entityId여야 합니다.');
        }
    }
    const currentHealth = requireInt32(
        source.sourceCurrentHealthFixedPoint,
        'sourceCurrentHealthFixedPoint',
        { positive: true }
    );
    const maxHealth = requireInt32(
        source.sourceMaxHealthFixedPoint,
        'sourceMaxHealthFixedPoint',
        { positive: true }
    );
    if (currentHealth > maxHealth) {
        throw new RangeError('AtomicTransform source current health가 max health를 넘습니다.');
    }
    requireUint32(
        source.prepareRecordFingerprint,
        'prepareRecordFingerprint',
        { positive: true }
    );
    requireUint32(
        source.commandGeneration,
        'commandGeneration',
        { positive: true }
    );
    const values = [
        [r.TOPOLOGY_CODE, topologyCode], [r.SOURCE_SLOT, source.sourceSlot],
        [r.SOURCE_ENTITY_ID, source.sourceEntityId], [r.SOURCE_INCARNATION, source.sourceIncarnation],
        [r.DESTINATION_0_SLOT, source.destinationHandles?.[0]?.slot],
        [r.DESTINATION_0_ENTITY_ID, source.destinationHandles?.[0]?.entityId],
        [r.DESTINATION_0_INCARNATION, source.destinationHandles?.[0]?.incarnation],
        [r.DESTINATION_1_SLOT, destination1.slot], [r.DESTINATION_1_ENTITY_ID, destination1.entityId],
        [r.DESTINATION_1_INCARNATION, destination1.incarnation],
        [r.DESTINATION_COUNT, source.destinationHandles?.length],
        [r.EFFECT_TRANSFER_DESTINATION_INDEX, source.effectTransferDestinationIndex],
        [r.PREPARE_RECORD_FINGERPRINT, source.prepareRecordFingerprint],
        [r.COMMAND_GENERATION, source.commandGeneration], [r.RESULT, source.result ?? 0],
        [r.EFFECT_REKEY_COUNT, source.effectRekeyCount ?? 0],
        [r.TRIGGER_SOURCE_TICK, triggerSourceTick],
        [r.TRIGGER_SEQUENCE, triggerSequence]
    ];
    for (const [offset, value] of values) {
        view.setUint32(base + offset, requireUint32(value, `record.${offset}`, {
            allowInvalid: offset === r.DESTINATION_1_SLOT
                || offset === r.DESTINATION_1_ENTITY_ID
                || offset === r.DESTINATION_1_INCARNATION
        }), true);
    }
    view.setInt32(base + r.SOURCE_CURRENT_HEALTH_FIXED_POINT,
        currentHealth, true);
    view.setInt32(base + r.SOURCE_MAX_HEALTH_FIXED_POINT,
        maxHealth, true);
}

export function readGpuAtomicTransformProgramHeader(storage) {
    requireStorage(storage, GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_HEADER,
        GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_RECORD, 'AtomicTransform program');
    const h = GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_HEADER;
    const v = storage.view;
    return Object.freeze({
        abiVersion: v.getUint32(h.ABI_VERSION, true), count: v.getUint32(h.COUNT, true),
        capacity: v.getUint32(h.CAPACITY, true), batchIdFingerprint: v.getUint32(h.BATCH_ID_FINGERPRINT, true),
        preparedSourceTick: v.getUint32(h.PREPARED_SOURCE_TICK, true), targetFixedTick: v.getUint32(h.TARGET_FIXED_TICK, true),
        status: v.getUint32(h.STATUS, true), batchAccepted: v.getUint32(h.BATCH_ACCEPTED, true),
        committedCount: v.getUint32(h.COMMITTED_COUNT, true), effectRekeyCount: v.getUint32(h.EFFECT_REKEY_COUNT, true),
        expectedEffectRekeyCount: v.getUint32(h.EXPECTED_EFFECT_REKEY_COUNT, true),
        failureRecordIndex: v.getUint32(h.FAILURE_RECORD_INDEX, true)
    });
}

export function readGpuAtomicTransformProgramRecord(storage, index) {
    requireStorage(storage, GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_HEADER,
        GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_RECORD, 'AtomicTransform program');
    if (!Number.isSafeInteger(index) || index < 0 || index >= storage.capacity) {
        throw new RangeError('AtomicTransform transform record index가 범위를 벗어났습니다.');
    }
    const r = GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_RECORD;
    const base = GPU_ATOMIC_TRANSFORM_RUNTIME_ABI.TRANSFORM_HEADER.STRIDE
        + index * r.STRIDE;
    const v = storage.view;
    return Object.freeze({
        topologyCode: v.getUint32(base + r.TOPOLOGY_CODE, true),
        sourceSlot: v.getUint32(base + r.SOURCE_SLOT, true),
        sourceEntityId: v.getUint32(base + r.SOURCE_ENTITY_ID, true),
        sourceIncarnation: v.getUint32(base + r.SOURCE_INCARNATION, true),
        destinationHandles: Object.freeze([
            Object.freeze({
                slot: v.getUint32(base + r.DESTINATION_0_SLOT, true),
                entityId: v.getUint32(base + r.DESTINATION_0_ENTITY_ID, true),
                incarnation: v.getUint32(base + r.DESTINATION_0_INCARNATION, true)
            }),
            Object.freeze({
                slot: v.getUint32(base + r.DESTINATION_1_SLOT, true),
                entityId: v.getUint32(base + r.DESTINATION_1_ENTITY_ID, true),
                incarnation: v.getUint32(base + r.DESTINATION_1_INCARNATION, true)
            })
        ]),
        destinationCount: v.getUint32(base + r.DESTINATION_COUNT, true),
        effectTransferDestinationIndex: v.getUint32(
            base + r.EFFECT_TRANSFER_DESTINATION_INDEX, true
        ),
        prepareRecordFingerprint: v.getUint32(
            base + r.PREPARE_RECORD_FINGERPRINT, true
        ),
        commandGeneration: v.getUint32(base + r.COMMAND_GENERATION, true),
        result: v.getUint32(base + r.RESULT, true),
        effectRekeyCount: v.getUint32(base + r.EFFECT_REKEY_COUNT, true),
        sourceCurrentHealthFixedPoint: v.getInt32(
            base + r.SOURCE_CURRENT_HEALTH_FIXED_POINT, true
        ),
        sourceMaxHealthFixedPoint: v.getInt32(
            base + r.SOURCE_MAX_HEALTH_FIXED_POINT, true
        ),
        triggerSourceTick: v.getUint32(base + r.TRIGGER_SOURCE_TICK, true),
        triggerSequence: v.getUint32(base + r.TRIGGER_SEQUENCE, true)
    });
}
