import {
    ABILITY_SUBJECT_SNAPSHOT_STATUS,
    normalizeAbilityExecutionCommand
} from '../../contract/ability_execution_contract.js';
import {
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI,
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION
} from './gpu_ability_subject_snapshot_abi.js';
import {
    GPU_ACTOR_ACTION_PLACEMENT_ABI,
    GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION,
    GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG,
    GPU_ACTOR_ACTION_PLACEMENT_STATUS,
    computeGpuActorActionDestinationFingerprint,
    createGpuActorActionPlacementOutputLayout,
    createGpuActorActionProgramStorage,
    readGpuActorActionPlacementAggregate,
    writeGpuActorActionDestinationLease,
    writeGpuActorActionProgramHeader
} from './gpu_actor_action_placement_abi.js';
import {
    GPU_ACTOR_ACTION_ADMISSION_STORAGE_BINDING_COUNT,
    GPU_ACTOR_ACTION_DISPATCH_STORAGE_BINDING_COUNT,
    GPU_ACTOR_ACTION_DISPATCH_WGSL,
    GPU_ACTOR_ACTION_PLACEMENT_STORAGE_BINDING_COUNT,
    GPU_ACTOR_ACTION_PLACEMENT_WGSL,
    GPU_ACTOR_ACTION_SPAWN_ADMISSION_WGSL
} from './gpu_actor_action_placement_shaders.js';
import { GPU_CIRCLE_BODY_ABI } from './gpu_circle_body_abi.js';
import { GPU_TOWER_GROUP_ABI } from './gpu_tower_group_abi.js';

const UINT32_MAX = 0xffffffff;
const DEFAULT_COMMAND_CAPACITY = 4;
const DEFAULT_READBACK_SLOT_COUNT = 4;
const DEFAULT_SUBJECT_CAPACITY = 1000;
const PIPELINES_BY_DEVICE = new WeakMap();

export const GPU_ACTOR_ACTION_PLACEMENT_DEFAULT_COMMAND_CAPACITY
    = DEFAULT_COMMAND_CAPACITY;
export const GPU_ACTOR_ACTION_PLACEMENT_DEFAULT_READBACK_SLOTS
    = DEFAULT_READBACK_SLOT_COUNT;
export const GPU_ACTOR_ACTION_PLACEMENT_DEFAULT_SUBJECT_CAPACITY
    = DEFAULT_SUBJECT_CAPACITY;

function requireRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label}은 object여야 합니다.`);
    }
    return value;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requireUint32(value, label, { positive = false } = {}) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > UINT32_MAX
        || (positive && (number === 0 || number === UINT32_MAX))) {
        throw new RangeError(`${label}은 올바른 uint32여야 합니다.`);
    }
    return number >>> 0;
}

function requirePositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 정수여야 합니다.`);
    }
    return number;
}

function requireGpuGlobals() {
    const usage = globalThis.GPUBufferUsage;
    const stage = globalThis.GPUShaderStage;
    const mapMode = globalThis.GPUMapMode;
    if (!usage || !stage || !mapMode
        || !Number.isSafeInteger(usage.STORAGE)
        || !Number.isSafeInteger(usage.COPY_DST)
        || !Number.isSafeInteger(usage.COPY_SRC)
        || !Number.isSafeInteger(usage.MAP_READ)
        || !Number.isSafeInteger(usage.INDIRECT)
        || !Number.isSafeInteger(stage.COMPUTE)
        || !Number.isSafeInteger(mapMode.READ)) {
        throw new Error('ActorActionPlacement WebGPU globals가 준비되지 않았습니다.');
    }
    return { usage, stage, mapMode };
}

function createBuffer(device, label, size, usage) {
    return device.createBuffer({ label, size, usage });
}

function assertBufferSize(buffer, minimum, label) {
    if (Number.isSafeInteger(buffer?.size) && buffer.size < minimum) {
        throw new RangeError(`${label} buffer가 ${minimum} bytes보다 짧습니다.`);
    }
}

function sameResources(left, right) {
    if (!left || !right) return false;
    return [
        'snapshot',
        'physics',
        'simulation',
        'abilityMetadata',
        'towerMembers',
        'towerRoster',
        'sdf',
        'params',
        'gridCounts',
        'gridBodies'
    ].every((key) => left[key] === right[key]);
}

function captureFailure(stage, error) {
    return Object.freeze({
        stage,
        name: String(error?.name ?? 'Error'),
        message: String(error?.message ?? error)
    });
}

function createPipelines(device, stage) {
    const cached = PIPELINES_BY_DEVICE.get(device);
    if (cached) return cached;

    const dispatchLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-actor-action-dispatch-layout',
        entries: [
            {
                binding: 0,
                visibility: stage.COMPUTE,
                buffer: { type: 'read-only-storage' }
            },
            {
                binding: 1,
                visibility: stage.COMPUTE,
                buffer: { type: 'storage' }
            }
        ]
    });
    const placementLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-actor-action-placement-layout',
        entries: Array.from(
            { length: GPU_ACTOR_ACTION_PLACEMENT_STORAGE_BINDING_COUNT },
            (_, binding) => ({
                binding,
                visibility: stage.COMPUTE,
                buffer: {
                    type: binding === 8 ? 'storage' : 'read-only-storage'
                }
            })
        )
    });
    const admissionLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-actor-action-admission-layout',
        entries: Array.from(
            { length: GPU_ACTOR_ACTION_ADMISSION_STORAGE_BINDING_COUNT },
            (_, binding) => ({
                binding,
                visibility: stage.COMPUTE,
                buffer: {
                    type: binding === 5 || binding === 6
                        ? 'storage'
                        : 'read-only-storage'
                }
            })
        )
    });
    const admissionParamsLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-actor-action-admission-params-layout',
        entries: [{
            binding: 0,
            visibility: stage.COMPUTE,
            buffer: { type: 'uniform' }
        }]
    });
    const dispatchModule = device.createShaderModule({
        label: 'cirvivor-gpu-actor-action-dispatch-wgsl',
        code: GPU_ACTOR_ACTION_DISPATCH_WGSL
    });
    const placementModule = device.createShaderModule({
        label: 'cirvivor-gpu-actor-action-placement-wgsl',
        code: GPU_ACTOR_ACTION_PLACEMENT_WGSL
    });
    const admissionModule = device.createShaderModule({
        label: 'cirvivor-gpu-actor-action-admission-wgsl',
        code: GPU_ACTOR_ACTION_SPAWN_ADMISSION_WGSL
    });
    const dispatchPipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-actor-action-dispatch-pipeline-layout',
        bindGroupLayouts: [dispatchLayout]
    });
    const placementPipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-actor-action-placement-pipeline-layout',
        bindGroupLayouts: [placementLayout]
    });
    const pipeline = (label, entryPoint) => device.createComputePipeline({
        label,
        layout: placementPipelineLayout,
        compute: { module: placementModule, entryPoint }
    });
    const result = Object.freeze({
        dispatchLayout,
        placementLayout,
        admissionLayout,
        admissionParamsLayout,
        prepareDispatch: device.createComputePipeline({
            label: 'cirvivor-gpu-actor-action-prepare-dispatch',
            layout: dispatchPipelineLayout,
            compute: {
                module: dispatchModule,
                entryPoint: 'prepare_actor_action_dispatch'
            }
        }),
        initialize: pipeline(
            'cirvivor-gpu-actor-action-initialize',
            'initialize_actor_action_program'
        ),
        resolve: pipeline(
            'cirvivor-gpu-actor-action-resolve',
            'resolve_actor_action_placement'
        ),
        admission: device.createComputePipeline({
            label: 'cirvivor-gpu-actor-action-admission',
            layout: device.createPipelineLayout({
                label: 'cirvivor-gpu-actor-action-admission-pipeline-layout',
                bindGroupLayouts: [admissionLayout, admissionParamsLayout]
            }),
            compute: {
                module: admissionModule,
                entryPoint: 'admit_actor_action_spawns'
            }
        }),
        validate: pipeline(
            'cirvivor-gpu-actor-action-validate',
            'validate_actor_action_placement'
        ),
        aggregate: pipeline(
            'cirvivor-gpu-actor-action-aggregate',
            'aggregate_actor_action_placement'
        )
    });
    PIPELINES_BY_DEVICE.set(device, result);
    return result;
}

function normalizeDestinationLeases(source, subjectCount, bodyCapacity) {
    if (!Array.isArray(source) || source.length !== subjectCount) {
        throw new RangeError('destination lease 수가 snapshot subject 수와 다릅니다.');
    }
    const slots = new Set();
    return Object.freeze(source.map((lease, index) => {
        requireRecord(lease, `destinationLeases[${index}]`);
        const destinationSlot = requireUint32(
            lease.destinationSlot,
            `destinationLeases[${index}].destinationSlot`
        );
        if (destinationSlot >= bodyCapacity || slots.has(destinationSlot)) {
            throw new RangeError('destination slot이 중복되거나 body capacity를 벗어났습니다.');
        }
        slots.add(destinationSlot);
        const snapshotRank = requireUint32(
            lease.snapshotRank,
            `destinationLeases[${index}].snapshotRank`
        );
        const destinationRank = requireUint32(
            lease.destinationRank ?? index,
            `destinationLeases[${index}].destinationRank`
        );
        if (snapshotRank !== index || destinationRank !== index) {
            throw new RangeError('destination rank는 stable snapshot rank여야 합니다.');
        }
        return Object.freeze({
            destinationSlot,
            destinationEntityId: requireUint32(
                lease.destinationEntityId,
                `destinationLeases[${index}].destinationEntityId`,
                { positive: true }
            ),
            destinationIncarnation: requireUint32(
                lease.destinationIncarnation,
                `destinationLeases[${index}].destinationIncarnation`,
                { positive: true }
            ),
            snapshotRank,
            destinationRank,
            baselineFlags: requireUint32(
                lease.baselineFlags ?? 0,
                `destinationLeases[${index}].baselineFlags`
            )
        });
    }));
}

function normalizeSdf(source, sdfBuffer) {
    requireRecord(source, 'sdf');
    const cols = requirePositiveInteger(source.cols, 'sdf.cols');
    const rows = requirePositiveInteger(source.rows, 'sdf.rows');
    const cellCount = cols * rows;
    if (!Number.isSafeInteger(cellCount) || cellCount > UINT32_MAX) {
        throw new RangeError('sdf cell 수가 uint32 범위를 벗어났습니다.');
    }
    assertBufferSize(sdfBuffer, cellCount * 4, 'sdf');
    const worldWidth = Math.fround(Number(source.worldWidth));
    const worldHeight = Math.fround(Number(source.worldHeight));
    if (!(worldWidth > 0) || !(worldHeight > 0)
        || !Number.isFinite(worldWidth) || !Number.isFinite(worldHeight)) {
        throw new RangeError('sdf world size는 양의 finite float32여야 합니다.');
    }
    return Object.freeze({
        cols,
        rows,
        enabled: source.enabled === true,
        worldWidth,
        worldHeight
    });
}

function normalizeCoreTarget(source, bodyCapacity) {
    if (source === undefined || source === null) return null;
    requireRecord(source, 'coreTarget');
    const slot = requireUint32(source.slot, 'coreTarget.slot');
    if (slot >= bodyCapacity) {
        throw new RangeError('coreTarget.slot이 body capacity를 벗어났습니다.');
    }
    return Object.freeze({
        slot,
        entityId: requireUint32(
            source.entityId,
            'coreTarget.entityId',
            { positive: true }
        ),
        incarnation: requireUint32(
            source.incarnation,
            'coreTarget.incarnation',
            { positive: true }
        )
    });
}

function validateSnapshotContract({
    command,
    completion,
    binding,
    resources,
    sessionGeneration,
    deviceGeneration,
    authoritativeEpoch,
    subjectCapacity
}) {
    if (!completion || !binding
        || completion.status !== ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE
        || completion.subjectCount <= 0
        || completion.subjectCount > subjectCapacity
        || completion.capacityDemand !== completion.subjectCount
        || completion.errorFlags !== 0
        || completion.executionOrdinal !== command.executionOrdinal
        || completion.commandFingerprint !== command.fingerprint
        || binding.buffer !== resources.snapshot
        || binding.abiVersion !== GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION
        || binding.recordStride
            !== GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE
        || binding.subjectCount !== completion.subjectCount
        || binding.executionOrdinal !== command.executionOrdinal
        || binding.commandFingerprint !== command.fingerprint
        || binding.snapshotFingerprint !== completion.snapshotFingerprint
        || binding.sessionGeneration !== sessionGeneration
        || binding.deviceGeneration !== deviceGeneration
        || binding.authoritativeEpoch !== authoritativeEpoch
        || binding.sourceTick !== completion.sourceTick
        || !Number.isSafeInteger(binding.wordOffset)
        || binding.wordOffset < 0
        || binding.byteOffset !== binding.wordOffset * 4
        || binding.byteLength !== completion.subjectCount
            * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE) {
        throw new RangeError('actor action snapshot contract가 exact하지 않습니다.');
    }
    const requiredSnapshotBytes = binding.byteOffset + binding.byteLength;
    assertBufferSize(binding.buffer, requiredSnapshotBytes, 'snapshot');
}

function freezeCompletion(entry, aggregate, extra = {}) {
    return Object.freeze({
        abiVersion: GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION,
        transactionId: entry.transactionId,
        executionId: entry.command.executionId,
        targetFixedTick: entry.targetFixedTick,
        ...aggregate,
        ...extra
    });
}

/**
 * R3 frozen Subject snapshot을 읽어 독립 ActorAction placement/transit side-plane을
 * 생성합니다. CPU에는 aggregate만 readback하며 body/Tower/Enemy state는 쓰지 않습니다.
 */
export class GpuActorActionPlacementRuntime {
    constructor(options = {}) {
        this.sessionGeneration = requirePositiveInteger(
            options.sessionGeneration ?? 1,
            'sessionGeneration'
        );
        this.commandCapacity = requirePositiveInteger(
            options.commandCapacity ?? DEFAULT_COMMAND_CAPACITY,
            'commandCapacity'
        );
        this.readbackSlotCount = requirePositiveInteger(
            options.readbackSlotCount ?? DEFAULT_READBACK_SLOT_COUNT,
            'readbackSlotCount'
        );
        this.subjectCapacity = requirePositiveInteger(
            options.subjectCapacity ?? DEFAULT_SUBJECT_CAPACITY,
            'subjectCapacity'
        );
        if (this.readbackSlotCount > this.commandCapacity) {
            throw new RangeError('placement readback slot은 command capacity 이하여야 합니다.');
        }
        this.pending = [];
        this.inFlight = new Set();
        this.completed = [];
        this.knownTransactionIds = new Set();
        this.placementRecords = new WeakMap();
        this.retainedPlacementTokens = new Set();
        this.readbackSlots = [];
        this.readbackCursor = 0;
        this.resourceLease = 0;
        this.device = null;
        this.deviceGeneration = 0;
        this.authoritativeEpoch = 0;
        this.bodyCapacity = 0;
        this.towerMemberCapacity = 0;
        this.resources = null;
        this.pipelines = null;
        this.mapReadMode = null;
        this.state = 'idle';
        this.failure = null;
        this.destroyed = false;
        this.submittedCount = 0;
        this.completedCount = 0;
        this.cancelledCount = 0;
        this.sdfRejectedCount = 0;
        this.protocolRejectedCount = 0;
        this.ringDeferredCount = 0;
        this.commandHighWater = 0;
        this.subjectHighWater = 0;
        this.retainedPlacementHighWater = 0;
        this.aggregateReadbackByteSize
            = GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.STRIDE;
    }

    initialize(device, resources, protocol = {}) {
        if (this.destroyed) return false;
        if (!device || typeof device.createBuffer !== 'function') {
            throw new TypeError('ActorActionPlacement에 GPUDevice가 필요합니다.');
        }
        for (const key of [
            'snapshot',
            'physics',
            'simulation',
            'abilityMetadata',
            'towerMembers',
            'towerRoster',
            'sdf',
            'params',
            'gridCounts',
            'gridBodies'
        ]) {
            if (!resources?.[key]) {
                throw new TypeError(`ActorActionPlacement ${key} buffer가 없습니다.`);
            }
        }
        const protocolSession = requirePositiveInteger(
            protocol.sessionGeneration ?? this.sessionGeneration,
            'protocol.sessionGeneration'
        );
        if (protocolSession !== this.sessionGeneration) {
            throw new RangeError('ActorActionPlacement session generation이 다릅니다.');
        }
        const deviceGeneration = requireNonNegativeInteger(
            protocol.deviceGeneration ?? 0,
            'deviceGeneration'
        );
        const authoritativeEpoch = requireNonNegativeInteger(
            protocol.authoritativeEpoch ?? 0,
            'authoritativeEpoch'
        );
        const bodyCapacity = requirePositiveInteger(
            protocol.bodyCapacity,
            'bodyCapacity'
        );
        const towerMemberCapacity = requirePositiveInteger(
            protocol.towerMemberCapacity,
            'towerMemberCapacity'
        );
        if (this.device === device
            && this.deviceGeneration === deviceGeneration
            && this.authoritativeEpoch === authoritativeEpoch
            && this.bodyCapacity === bodyCapacity
            && this.towerMemberCapacity === towerMemberCapacity
            && sameResources(this.resources, resources)
            && this.state === 'ready') {
            return true;
        }

        const { usage, stage, mapMode } = requireGpuGlobals();
        if (Number(device.limits?.maxStorageBuffersPerShaderStage ?? Infinity)
            < GPU_ACTOR_ACTION_PLACEMENT_STORAGE_BINDING_COUNT) {
            throw new RangeError('ActorActionPlacement storage binding limit가 부족합니다.');
        }
        assertBufferSize(
            resources.physics,
            bodyCapacity * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE,
            'physics'
        );
        assertBufferSize(
            resources.simulation,
            bodyCapacity * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE,
            'simulation'
        );
        assertBufferSize(
            resources.abilityMetadata,
            bodyCapacity
                * GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA.STRIDE,
            'abilityMetadata'
        );
        assertBufferSize(
            resources.towerMembers,
            towerMemberCapacity * GPU_TOWER_GROUP_ABI.MEMBER_STATE.STRIDE,
            'towerMembers'
        );
        assertBufferSize(
            resources.towerRoster,
            GPU_TOWER_GROUP_ABI.ROSTER_HEADER.STRIDE
                + towerMemberCapacity
                    * GPU_TOWER_GROUP_ABI.ROSTER_SLOT.STRIDE,
            'towerRoster'
        );

        this.#retireResources('resource-rebind');
        this.device = device;
        this.deviceGeneration = deviceGeneration;
        this.authoritativeEpoch = authoritativeEpoch;
        this.bodyCapacity = bodyCapacity;
        this.towerMemberCapacity = towerMemberCapacity;
        this.resources = Object.freeze({ ...resources });
        this.pipelines = createPipelines(device, stage);
        this.mapReadMode = mapMode.READ;
        const lease = ++this.resourceLease;
        this.readbackSlots = Array.from(
            { length: this.readbackSlotCount },
            (_, index) => ({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-actor-action-readback-${index}`,
                    this.aggregateReadbackByteSize,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                entry: null,
                lease
            })
        );
        this.readbackCursor = 0;
        this.state = 'ready';
        this.failure = null;
        return true;
    }

    canAccept() {
        return !this.destroyed && this.state === 'ready'
            && this.pending.length + this.inFlight.size
                + this.retainedPlacementTokens.size < this.commandCapacity;
    }

    stage(request = {}) {
        if (!this.canAccept()) {
            return Object.freeze({
                accepted: false,
                retryable: this.state === 'ready',
                reason: this.destroyed
                    ? 'destroyed'
                    : 'actor-action-placement-capacity'
            });
        }
        let transactionId = null;
        try {
            transactionId = requireNonEmptyString(
                request.transactionId,
                'transactionId'
            );
            if (this.knownTransactionIds.has(transactionId)) {
                return Object.freeze({
                    accepted: false,
                    reason: 'duplicate-actor-action-placement-transaction'
                });
            }
            const command = normalizeAbilityExecutionCommand(request.command);
            const completion = request.subjectCompletion;
            const snapshotBinding = request.snapshotBinding;
            validateSnapshotContract({
                command,
                completion,
                binding: snapshotBinding,
                resources: this.resources,
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: this.deviceGeneration,
                authoritativeEpoch: this.authoritativeEpoch,
                subjectCapacity: this.subjectCapacity
            });
            const subjectCount = completion.subjectCount;
            const destinationLeases = normalizeDestinationLeases(
                request.destinationLeases,
                subjectCount,
                this.bodyCapacity
            );
            const destinationFingerprint
                = computeGpuActorActionDestinationFingerprint(
                    destinationLeases,
                    command.fingerprint
                );
            if (request.destinationFingerprint !== undefined
                && requireUint32(
                    request.destinationFingerprint,
                    'destinationFingerprint',
                    { positive: true }
                ) !== destinationFingerprint) {
                throw new RangeError('destination fingerprint가 lease와 다릅니다.');
            }
            const targetFixedTick = requireUint32(
                request.targetFixedTick ?? command.targetFixedTick,
                'targetFixedTick',
                { positive: true }
            );
            if (targetFixedTick < completion.sourceTick) {
                throw new RangeError('placement target tick이 snapshot source tick보다 빠릅니다.');
            }
            const sdf = normalizeSdf(request.sdf, this.resources.sdf);
            const coreTarget = normalizeCoreTarget(
                request.coreTarget,
                this.bodyCapacity
            );
            const programBytes = createGpuActorActionProgramStorage(subjectCount);
            const { profile, output } = writeGpuActorActionProgramHeader(
                programBytes,
                {
                    actorActionProfile: request.actorActionProfile,
                    actorActionProfileFingerprint:
                        command.actorActionProfileFingerprint,
                    sessionGeneration: this.sessionGeneration,
                    deviceGeneration: this.deviceGeneration,
                    authoritativeEpoch: this.authoritativeEpoch,
                    snapshotSourceTick: completion.sourceTick,
                    placementTargetTick: targetFixedTick,
                    executionOrdinal: command.executionOrdinal,
                    commandFingerprint: command.fingerprint,
                    snapshotFingerprint: completion.snapshotFingerprint,
                    destinationFingerprint,
                    subjectCount,
                    sourceSelectorCode: command.selectorCode,
                    actionCode: command.actionCode,
                    payloadCode: command.payloadCode,
                    targetPolicyCode: command.targetPolicyCode,
                    snapshotWordOffset: snapshotBinding.wordOffset,
                    generationLimit: command.generationLimit,
                    coreTarget,
                    sdf,
                    towerMemberCapacity: this.towerMemberCapacity,
                    aimPoint: command.aimPoint
                }
            );
            for (let index = 0; index < subjectCount; index++) {
                writeGpuActorActionDestinationLease(
                    programBytes,
                    subjectCount,
                    index,
                    destinationLeases[index]
                );
            }

            const usage = globalThis.GPUBufferUsage;
            const programBuffer = createBuffer(
                this.device,
                `cirvivor-gpu-actor-action-program-${transactionId}`,
                programBytes.byteLength,
                usage.STORAGE | usage.COPY_DST
            );
            const outputBuffer = createBuffer(
                this.device,
                `cirvivor-gpu-actor-action-output-${transactionId}`,
                output.byteLength,
                usage.STORAGE | usage.COPY_SRC
            );
            const dispatchBuffer = createBuffer(
                this.device,
                `cirvivor-gpu-actor-action-dispatch-${transactionId}`,
                GPU_ACTOR_ACTION_PLACEMENT_ABI.DISPATCH_ARGS.STRIDE,
                usage.STORAGE | usage.INDIRECT
            );
            this.device.queue.writeBuffer(programBuffer, 0, programBytes);
            const entry = {
                transactionId,
                command,
                completion,
                targetFixedTick,
                subjectCount,
                destinationFingerprint,
                profile,
                output,
                programBuffer,
                outputBuffer,
                dispatchBuffer,
                resourceLease: this.resourceLease,
                state: 'pending',
                readback: null
            };
            this.pending.push(entry);
            this.knownTransactionIds.add(transactionId);
            this.commandHighWater = Math.max(
                this.commandHighWater,
                this.pending.length + this.inFlight.size
                    + this.retainedPlacementTokens.size
            );
            this.subjectHighWater = Math.max(
                this.subjectHighWater,
                subjectCount
            );
            return Object.freeze({
                accepted: true,
                transactionId,
                subjectCount,
                destinationFingerprint,
                profileFingerprint: profile.fingerprint
            });
        } catch (error) {
            return Object.freeze({
                accepted: false,
                reason: 'actor-action-placement-contract',
                transactionId,
                message: String(error?.message ?? error)
            });
        }
    }

    submitPendingForFixedTick(sourceTick) {
        const tick = requireNonNegativeInteger(sourceTick, 'sourceTick');
        if (this.destroyed || this.state !== 'ready'
            || this.pending.length === 0) {
            return Object.freeze({ submittedCount: 0, deferredCount: 0 });
        }
        const claims = [];
        for (let index = 0; index < this.pending.length;) {
            const entry = this.pending[index];
            if (entry.targetFixedTick > tick) {
                index++;
                continue;
            }
            const readback = this.#claimReadbackSlot();
            if (!readback) break;
            this.pending.splice(index, 1);
            entry.state = 'in-flight';
            entry.readback = readback;
            readback.entry = entry;
            this.inFlight.add(entry);
            claims.push(entry);
        }
        const deferredCount = this.pending.filter(
            (entry) => entry.targetFixedTick <= tick
        ).length;
        this.ringDeferredCount += deferredCount;
        if (claims.length === 0) {
            return Object.freeze({ submittedCount: 0, deferredCount });
        }

        try {
            const encoder = this.device.createCommandEncoder({
                label: `cirvivor-gpu-actor-action-placement-${tick}`
            });
            for (const entry of claims) {
                const dispatchBindGroup = this.device.createBindGroup({
                    label: `cirvivor-gpu-actor-action-dispatch-bind-${entry.transactionId}`,
                    layout: this.pipelines.dispatchLayout,
                    entries: [
                        { binding: 0, resource: { buffer: entry.programBuffer } },
                        { binding: 1, resource: { buffer: entry.dispatchBuffer } }
                    ]
                });
                const placementBindGroup = this.device.createBindGroup({
                    label: `cirvivor-gpu-actor-action-bind-${entry.transactionId}`,
                    layout: this.pipelines.placementLayout,
                    entries: [
                        { binding: 0, resource: { buffer: this.resources.snapshot } },
                        { binding: 1, resource: { buffer: entry.programBuffer } },
                        { binding: 2, resource: { buffer: this.resources.physics } },
                        { binding: 3, resource: { buffer: this.resources.simulation } },
                        { binding: 4, resource: { buffer: this.resources.abilityMetadata } },
                        { binding: 5, resource: { buffer: this.resources.towerMembers } },
                        { binding: 6, resource: { buffer: this.resources.towerRoster } },
                        { binding: 7, resource: { buffer: this.resources.sdf } },
                        { binding: 8, resource: { buffer: entry.outputBuffer } }
                    ]
                });
                const admissionBindGroup = this.device.createBindGroup({
                    label: `cirvivor-gpu-actor-action-admission-bind-${entry.transactionId}`,
                    layout: this.pipelines.admissionLayout,
                    entries: [
                        { binding: 0, resource: { buffer: this.resources.snapshot } },
                        { binding: 1, resource: { buffer: entry.programBuffer } },
                        { binding: 2, resource: { buffer: this.resources.physics } },
                        { binding: 3, resource: { buffer: this.resources.simulation } },
                        { binding: 4, resource: { buffer: this.resources.sdf } },
                        { binding: 5, resource: { buffer: entry.outputBuffer } },
                        { binding: 6, resource: { buffer: this.resources.gridCounts } },
                        { binding: 7, resource: { buffer: this.resources.gridBodies } }
                    ]
                });
                const admissionParamsBindGroup = this.device.createBindGroup({
                    label: `cirvivor-gpu-actor-action-admission-params-bind-${entry.transactionId}`,
                    layout: this.pipelines.admissionParamsLayout,
                    entries: [{
                        binding: 0,
                        resource: { buffer: this.resources.params }
                    }]
                });
                const dispatch = (
                    pipeline,
                    label,
                    bindGroup,
                    indirect = false,
                    secondaryBindGroup = null
                ) => {
                    const pass = encoder.beginComputePass({
                        label: `cirvivor-gpu-actor-action-${label}-pass`
                    });
                    pass.setPipeline(pipeline);
                    pass.setBindGroup(0, bindGroup);
                    if (secondaryBindGroup) {
                        pass.setBindGroup(1, secondaryBindGroup);
                    }
                    if (indirect) {
                        pass.dispatchWorkgroupsIndirect(entry.dispatchBuffer, 0);
                    } else {
                        pass.dispatchWorkgroups(1);
                    }
                    pass.end();
                };
                dispatch(
                    this.pipelines.prepareDispatch,
                    'prepare-dispatch',
                    dispatchBindGroup
                );
                dispatch(
                    this.pipelines.initialize,
                    'initialize',
                    placementBindGroup,
                    true
                );
                dispatch(
                    this.pipelines.resolve,
                    'resolve',
                    placementBindGroup,
                    true
                );
                dispatch(
                    this.pipelines.admission,
                    'spawn-admission',
                    admissionBindGroup,
                    false,
                    admissionParamsBindGroup
                );
                dispatch(
                    this.pipelines.validate,
                    'validate',
                    placementBindGroup,
                    true
                );
                dispatch(
                    this.pipelines.aggregate,
                    'aggregate',
                    placementBindGroup
                );
                encoder.copyBufferToBuffer(
                    entry.outputBuffer,
                    entry.output.aggregateByteOffset,
                    entry.readback.buffer,
                    0,
                    this.aggregateReadbackByteSize
                );
            }
            this.device.queue.submit([encoder.finish()]);
            this.submittedCount += claims.length;
            for (const entry of claims) this.#beginReadback(entry);
        } catch (error) {
            this.failure = captureFailure('actor-action-placement-submit', error);
            this.state = 'failed';
            for (const entry of claims) {
                this.inFlight.delete(entry);
                this.#releaseReadbackSlot(entry.readback);
                this.#destroyEntryBuffers(entry, true);
                this.knownTransactionIds.delete(entry.transactionId);
                this.completed.push(freezeCompletion(entry, {
                    sessionGeneration: this.sessionGeneration,
                    deviceGeneration: this.deviceGeneration,
                    authoritativeEpoch: this.authoritativeEpoch,
                    snapshotSourceTick: entry.completion.sourceTick,
                    placementTargetTick: entry.targetFixedTick,
                    executionOrdinal: entry.command.executionOrdinal,
                    status: GPU_ACTOR_ACTION_PLACEMENT_STATUS.PROTOCOL_REJECTED,
                    subjectCount: entry.subjectCount,
                    validCount: 0,
                    commandFingerprint: entry.command.fingerprint,
                    snapshotFingerprint: entry.completion.snapshotFingerprint,
                    destinationFingerprint: entry.destinationFingerprint,
                    placementFingerprint: 0,
                    errorFlags:
                        GPU_ACTOR_ACTION_PLACEMENT_ERROR_FLAG.HEADER_ABI,
                    actionCode: entry.command.actionCode,
                    profileCode: entry.profile.profileCode,
                    payloadCode: entry.command.payloadCode,
                    placementByteLength: entry.output.placementByteLength,
                    transitByteLength: entry.output.transitByteLength,
                    actorActionProfileFingerprint:
                        entry.command.actorActionProfileFingerprint
                }, { placementToken: null, failure: this.failure }));
            }
            return Object.freeze({
                submittedCount: 0,
                deferredCount,
                failure: this.failure
            });
        }
        return Object.freeze({
            submittedCount: claims.length,
            deferredCount
        });
    }

    drainCompleted(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('actor action placement completion output은 배열이어야 합니다.');
        }
        out.push(...this.completed);
        this.completed.length = 0;
        return out;
    }

    getPlacementGpuBinding(token) {
        const record = token && typeof token === 'object'
            ? this.placementRecords.get(token)
            : null;
        if (!record || record.resourceLease !== this.resourceLease
            || this.destroyed || this.state !== 'ready') {
            return null;
        }
        return Object.freeze({
            abiVersion: GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION,
            buffer: record.buffer,
            aggregateByteOffset: record.output.aggregateByteOffset,
            aggregateByteLength:
                GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.STRIDE,
            placementByteOffset: record.output.placementByteOffset,
            placementByteLength: record.output.placementByteLength,
            placementRecordStride:
                GPU_ACTOR_ACTION_PLACEMENT_ABI.PLACEMENT_RECORD.STRIDE,
            transitByteOffset: record.output.transitByteOffset,
            transitByteLength: record.output.transitByteLength,
            transitRecordStride:
                GPU_ACTOR_ACTION_PLACEMENT_ABI.TRANSIT_RECORD.STRIDE,
            byteLength: record.output.byteLength,
            subjectCount: record.subjectCount,
            executionOrdinal: record.executionOrdinal,
            commandFingerprint: record.commandFingerprint,
            snapshotFingerprint: record.snapshotFingerprint,
            destinationFingerprint: record.destinationFingerprint,
            placementFingerprint: record.placementFingerprint,
            actorActionProfileFingerprint:
                record.actorActionProfileFingerprint,
            sessionGeneration: record.sessionGeneration,
            deviceGeneration: record.deviceGeneration,
            authoritativeEpoch: record.authoritativeEpoch,
            snapshotSourceTick: record.snapshotSourceTick,
            placementTargetTick: record.placementTargetTick,
            transactionId: record.transactionId
        });
    }

    releasePlacement(token) {
        const record = token && typeof token === 'object'
            ? this.placementRecords.get(token)
            : null;
        if (!record) return false;
        this.placementRecords.delete(token);
        this.retainedPlacementTokens.delete(token);
        this.knownTransactionIds.delete(record.transactionId);
        try { record.buffer?.destroy?.(); } catch { /* retired */ }
        return true;
    }

    cancelAll(reason = 'cancelled') {
        const cancellationReason = String(reason || 'cancelled');
        let cancelledCount = 0;
        for (const entry of this.pending.splice(0)) {
            this.knownTransactionIds.delete(entry.transactionId);
            this.#destroyEntryBuffers(entry, true);
            this.completed.push(this.#cancelledCompletion(
                entry,
                cancellationReason
            ));
            cancelledCount++;
        }
        for (const entry of [...this.inFlight]) {
            this.inFlight.delete(entry);
            this.knownTransactionIds.delete(entry.transactionId);
            this.#releaseReadbackSlot(entry.readback);
            this.#destroyEntryBuffers(entry, true);
            this.completed.push(this.#cancelledCompletion(
                entry,
                cancellationReason
            ));
            cancelledCount++;
        }
        this.cancelledCount += cancelledCount;
        return Object.freeze({
            cancelledCount,
            reason: cancellationReason
        });
    }

    getStatus() {
        return Object.freeze({
            abiVersion: GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION,
            state: this.destroyed ? 'destroyed' : this.state,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: this.deviceGeneration,
            authoritativeEpoch: this.authoritativeEpoch,
            bodyCapacity: this.bodyCapacity,
            towerMemberCapacity: this.towerMemberCapacity,
            commandCapacity: this.commandCapacity,
            subjectCapacity: this.subjectCapacity,
            readbackSlotCount: this.readbackSlotCount,
            pendingCount: this.pending.length,
            inFlightCount: this.inFlight.size,
            retainedPlacementCount: this.retainedPlacementTokens.size,
            submittedCount: this.submittedCount,
            completedCount: this.completedCount,
            cancelledCount: this.cancelledCount,
            sdfRejectedCount: this.sdfRejectedCount,
            protocolRejectedCount: this.protocolRejectedCount,
            ringDeferredCount: this.ringDeferredCount,
            commandHighWater: this.commandHighWater,
            subjectHighWater: this.subjectHighWater,
            retainedPlacementHighWater:
                this.retainedPlacementHighWater,
            storageBindingCount:
                GPU_ACTOR_ACTION_PLACEMENT_STORAGE_BINDING_COUNT,
            admissionStorageBindingCount:
                GPU_ACTOR_ACTION_ADMISSION_STORAGE_BINDING_COUNT,
            admissionPolicy:
                'payload-local-candidates/shared-grid-verdict/stable-rank-claim',
            dispatchStorageBindingCount:
                GPU_ACTOR_ACTION_DISPATCH_STORAGE_BINDING_COUNT,
            aggregateReadbackByteSize: this.aggregateReadbackByteSize,
            perSubjectCpuCommandCount: 0,
            placementRecordCpuReadback: false,
            transitRecordCpuReadback: false,
            bodyStateCommitCount: 0,
            failure: this.failure
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.cancelAll('destroyed');
        this.destroyed = true;
        this.#retireResources('destroyed');
        this.device = null;
        this.resources = null;
        this.pipelines = null;
        this.state = 'destroyed';
    }

    #claimReadbackSlot() {
        for (let offset = 0; offset < this.readbackSlots.length; offset++) {
            const index = (this.readbackCursor + offset)
                % this.readbackSlots.length;
            const slot = this.readbackSlots[index];
            if (!slot.inFlight) {
                slot.inFlight = true;
                slot.entry = null;
                this.readbackCursor = (index + 1) % this.readbackSlots.length;
                return slot;
            }
        }
        return null;
    }

    #releaseReadbackSlot(slot) {
        if (!slot?.inFlight) return;
        slot.inFlight = false;
        slot.entry = null;
    }

    #beginReadback(entry) {
        const slot = entry.readback;
        const lease = entry.resourceLease;
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            const authentic = !this.destroyed
                && this.state === 'ready'
                && slot.inFlight
                && slot.entry === entry
                && slot.lease === this.resourceLease
                && lease === this.resourceLease
                && this.inFlight.has(entry);
            if (!authentic) {
                try { slot.buffer.unmap(); } catch { /* retired */ }
                this.#releaseReadbackSlot(slot);
                return;
            }
            try {
                const aggregate = readGpuActorActionPlacementAggregate(
                    slot.buffer.getMappedRange().slice(0)
                );
                const exactEnvelope = aggregate.sessionGeneration
                        === this.sessionGeneration
                    && aggregate.deviceGeneration === this.deviceGeneration
                    && aggregate.authoritativeEpoch === this.authoritativeEpoch
                    && aggregate.snapshotSourceTick === entry.completion.sourceTick
                    && aggregate.placementTargetTick === entry.targetFixedTick
                    && aggregate.executionOrdinal === entry.command.executionOrdinal
                    && aggregate.subjectCount === entry.subjectCount
                    && aggregate.commandFingerprint === entry.command.fingerprint
                    && aggregate.snapshotFingerprint
                        === entry.completion.snapshotFingerprint
                    && aggregate.destinationFingerprint
                        === entry.destinationFingerprint
                    && aggregate.actionCode === entry.command.actionCode
                    && aggregate.profileCode === entry.profile.profileCode
                    && aggregate.actorActionProfileFingerprint
                        === entry.command.actorActionProfileFingerprint
                    && aggregate.payloadCode === entry.command.payloadCode
                    && aggregate.placementByteLength
                        === entry.output.placementByteLength
                    && aggregate.transitByteLength
                        === entry.output.transitByteLength;
                if (!exactEnvelope) {
                    throw new RangeError('actor action aggregate provenance가 다릅니다.');
                }

                let placementToken = null;
                if (aggregate.status
                    === GPU_ACTOR_ACTION_PLACEMENT_STATUS.COMPLETE) {
                    placementToken = Object.freeze({});
                    this.placementRecords.set(placementToken, Object.freeze({
                        ...aggregate,
                        transactionId: entry.transactionId,
                        buffer: entry.outputBuffer,
                        output: entry.output,
                        resourceLease: this.resourceLease
                    }));
                    this.retainedPlacementTokens.add(placementToken);
                    this.retainedPlacementHighWater = Math.max(
                        this.retainedPlacementHighWater,
                        this.retainedPlacementTokens.size
                    );
                    this.#destroyEntryBuffers(entry, false);
                } else {
                    this.#destroyEntryBuffers(entry, true);
                    this.knownTransactionIds.delete(entry.transactionId);
                    if (aggregate.status
                        === GPU_ACTOR_ACTION_PLACEMENT_STATUS.SDF_REJECTED) {
                        this.sdfRejectedCount++;
                    } else {
                        this.protocolRejectedCount++;
                    }
                }
                this.completed.push(freezeCompletion(
                    entry,
                    aggregate,
                    { placementToken, reason: null }
                ));
                this.completedCount++;
            } catch (error) {
                this.#destroyEntryBuffers(entry, true);
                this.knownTransactionIds.delete(entry.transactionId);
                this.protocolRejectedCount++;
                this.failure = captureFailure('actor-action-placement-readback', error);
                this.state = 'failed';
            } finally {
                this.inFlight.delete(entry);
                try { slot.buffer.unmap(); } catch { /* retired */ }
                this.#releaseReadbackSlot(slot);
            }
        }).catch((error) => {
            const authentic = slot.lease === this.resourceLease
                && lease === this.resourceLease;
            if (authentic) {
                this.inFlight.delete(entry);
                this.knownTransactionIds.delete(entry.transactionId);
                this.#destroyEntryBuffers(entry, true);
                this.protocolRejectedCount++;
                this.failure = captureFailure('actor-action-placement-map', error);
                this.state = 'failed';
            }
            this.#releaseReadbackSlot(slot);
        });
    }

    #cancelledCompletion(entry, reason) {
        return freezeCompletion(entry, {
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: this.deviceGeneration,
            authoritativeEpoch: this.authoritativeEpoch,
            snapshotSourceTick: entry.completion.sourceTick,
            placementTargetTick: entry.targetFixedTick,
            executionOrdinal: entry.command.executionOrdinal,
            status: GPU_ACTOR_ACTION_PLACEMENT_STATUS.CANCELLED,
            subjectCount: entry.subjectCount,
            validCount: 0,
            commandFingerprint: entry.command.fingerprint,
            snapshotFingerprint: entry.completion.snapshotFingerprint,
            destinationFingerprint: entry.destinationFingerprint,
            placementFingerprint: 0,
            errorFlags: 0,
            actionCode: entry.command.actionCode,
            profileCode: entry.profile.profileCode,
            payloadCode: entry.command.payloadCode,
            placementByteLength: entry.output.placementByteLength,
            transitByteLength: entry.output.transitByteLength,
            actorActionProfileFingerprint:
                entry.command.actorActionProfileFingerprint
        }, { placementToken: null, reason });
    }

    #destroyEntryBuffers(entry, includeOutput) {
        try { entry.programBuffer?.destroy?.(); } catch { /* retired */ }
        try { entry.dispatchBuffer?.destroy?.(); } catch { /* retired */ }
        if (includeOutput) {
            try { entry.outputBuffer?.destroy?.(); } catch { /* retired */ }
        }
    }

    #retireResources(reason) {
        this.cancelAll(reason);
        for (const token of [...this.retainedPlacementTokens]) {
            const record = this.placementRecords.get(token);
            this.placementRecords.delete(token);
            try { record?.buffer?.destroy?.(); } catch { /* retired */ }
        }
        this.retainedPlacementTokens.clear();
        this.knownTransactionIds.clear();
        for (const slot of this.readbackSlots) {
            try { slot.buffer?.destroy?.(); } catch { /* retired */ }
        }
        this.readbackSlots = [];
        this.readbackCursor = 0;
        this.resourceLease++;
        if (!this.destroyed) this.state = 'idle';
    }
}
