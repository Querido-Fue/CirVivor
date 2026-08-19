import {
    GPU_TOWER_CREATION_ABI,
    GPU_TOWER_CREATION_ABI_VERSION,
    GPU_TOWER_CREATION_HARD_FAILURE_MASK,
    GPU_TOWER_CREATION_MODE,
    GPU_TOWER_CREATION_STATUS,
    GPU_TOWER_CREATION_STORAGE_PROFILE,
    createGpuTowerCreationHostStorage,
    computeGpuTowerCreationMetadataFingerprint,
    readGpuTowerCreationMetadataCommits,
    readGpuTowerCreationResult,
    writeGpuTowerCreationProgram
} from './gpu_tower_creation_abi.js';
import {
    GPU_TOWER_CREATION_ACTOR_ACTION_WGSL,
    GPU_TOWER_CREATION_WGSL,
    GPU_TOWER_CREATION_WORKGROUP_SIZE
} from './gpu_tower_creation_shaders.js';

const DEFAULT_READBACK_SLOT_COUNT = 3;
const PIPELINES_BY_DEVICE = new WeakMap();

function requirePositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number > 0xffffffff) {
        throw new RangeError(`${label}는 양의 uint32 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
        throw new RangeError(`${label}는 uint32 범위의 정수여야 합니다.`);
    }
    return number;
}

function normalizeProtocol(source = {}) {
    return Object.freeze({
        sessionGeneration: requirePositiveInteger(
            source.sessionGeneration,
            'Tower creation sessionGeneration'
        ),
        deviceGeneration: requireNonNegativeInteger(
            source.deviceGeneration,
            'Tower creation deviceGeneration'
        ),
        authoritativeEpoch: requireNonNegativeInteger(
            source.authoritativeEpoch,
            'Tower creation authoritativeEpoch'
        )
    });
}

function sameProtocol(left, right) {
    return left?.sessionGeneration === right?.sessionGeneration
        && left?.deviceGeneration === right?.deviceGeneration
        && left?.authoritativeEpoch === right?.authoritativeEpoch;
}

function sameResources(left, right) {
    return left?.counts === right?.counts
        && left?.physics === right?.physics
        && left?.simulation === right?.simulation
        && left?.abilityMetadata === right?.abilityMetadata
        && left?.actorTransit === right?.actorTransit
        && left?.members === right?.members
        && left?.roster === right?.roster;
}

function normalizeActorActionPlacementBinding(binding, program) {
    if (program.mode !== GPU_TOWER_CREATION_MODE.GPU_SUBJECT_ACTOR_ACTION) {
        if (binding !== undefined && binding !== null) {
            throw new RangeError('CPU Tower creation에는 placement binding을 허용하지 않습니다.');
        }
        return null;
    }
    if (!binding || typeof binding !== 'object' || !binding.buffer) {
        throw new TypeError('ActorAction Tower creation placement binding이 필요합니다.');
    }
    const exact = binding.subjectCount === program.childCount
        && binding.executionOrdinal === program.executionOrdinal
        && binding.commandFingerprint === program.commandFingerprint
        && binding.snapshotFingerprint === program.snapshotFingerprint
        && binding.destinationFingerprint === program.destinationFingerprint
        && binding.placementFingerprint === program.placementFingerprint
        && binding.actorActionProfileFingerprint
            === program.actorActionProfileFingerprint
        && binding.snapshotSourceTick === program.snapshotSourceTick
        && Number.isSafeInteger(binding.aggregateByteOffset)
        && binding.aggregateByteOffset >= 0
        && Number.isSafeInteger(binding.byteLength)
        && binding.byteLength > 0;
    if (!exact) {
        throw new RangeError('ActorAction Tower creation placement provenance가 다릅니다.');
    }
    return Object.freeze({ ...binding });
}

function captureFailure(stage, error) {
    return Object.freeze({
        stage,
        name: String(error?.name ?? 'Error'),
        message: String(error?.message ?? error)
    });
}

function requireGpuGlobals() {
    const usage = globalThis.GPUBufferUsage;
    const stage = globalThis.GPUShaderStage;
    const mapMode = globalThis.GPUMapMode;
    if (!usage || !stage || !mapMode
        || !Number.isSafeInteger(usage.STORAGE)
        || !Number.isSafeInteger(usage.COPY_SRC)
        || !Number.isSafeInteger(usage.COPY_DST)
        || !Number.isSafeInteger(usage.MAP_READ)
        || !Number.isSafeInteger(stage.COMPUTE)
        || !Number.isSafeInteger(mapMode.READ)) {
        throw new Error('Tower creation runtime에 필요한 WebGPU 상수가 없습니다.');
    }
    return { usage, stage, mapMode };
}

function createBuffer(device, label, size, usage) {
    return device.createBuffer({ label, size: Math.max(4, size), usage });
}

function bufferResource(buffer) {
    return { buffer };
}

function destroyBuffer(buffer) {
    try { buffer?.destroy?.(); } catch { /* retired */ }
}

function getPipelines(device, stage) {
    let cached = PIPELINES_BY_DEVICE.get(device);
    if (cached) return cached;
    const layout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-tower-creation-layout',
        entries: Array.from({ length: 9 }, (_, binding) => ({
            binding,
            visibility: stage.COMPUTE,
            buffer: {
                type: [2, 3, 4, 5, 8].includes(binding)
                    ? 'storage'
                    : 'read-only-storage'
            }
        }))
    });
    const module = device.createShaderModule({
        label: 'cirvivor-gpu-tower-creation-shader',
        code: GPU_TOWER_CREATION_WGSL
    });
    const pipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-tower-creation-pipeline-layout',
        bindGroupLayouts: [layout]
    });
    const createPipeline = (entryPoint) => device.createComputePipeline({
        label: `cirvivor-gpu-tower-creation-${entryPoint}`,
        layout: pipelineLayout,
        compute: { module, entryPoint }
    });
    const actorLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-tower-creation-actor-action-layout',
        entries: Array.from({ length: 9 }, (_, binding) => ({
            binding,
            visibility: stage.COMPUTE,
            buffer: {
                type: [2, 4, 5, 6, 7, 8].includes(binding)
                    ? 'storage'
                    : 'read-only-storage'
            }
        }))
    });
    const actorModule = device.createShaderModule({
        label: 'cirvivor-gpu-tower-creation-actor-action-shader',
        code: GPU_TOWER_CREATION_ACTOR_ACTION_WGSL
    });
    const actorPipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-tower-creation-actor-action-pipeline-layout',
        bindGroupLayouts: [actorLayout]
    });
    const createActorPipeline = (entryPoint) => device.createComputePipeline({
        label: `cirvivor-gpu-tower-creation-${entryPoint}`,
        layout: actorPipelineLayout,
        compute: { module: actorModule, entryPoint }
    });
    cached = Object.freeze({
        layout,
        actorLayout,
        clear: createPipeline('clear_creation'),
        validate: createPipeline('validate_creation'),
        seal: createPipeline('seal_creation'),
        apply: createPipeline('apply_creation'),
        publish: createPipeline('publish_creation_children'),
        finalize: createPipeline('finalize_creation'),
        validateActorAction: createActorPipeline(
            'validate_actor_action_placement'
        ),
        applyActorAction: createActorPipeline(
            'apply_actor_action_placement'
        ),
        sealActorActionMetadata: createActorPipeline(
            'seal_actor_action_metadata'
        )
    });
    PIPELINES_BY_DEVICE.set(device, cached);
    return cached;
}

/**
 * 한 번에 하나의 0/N Tower creation을 main fixed encoder 안에서 검증·적용합니다.
 * 결과만 64-byte ring으로 읽고 body/member 본문은 절대 readback하지 않습니다.
 */
export class GpuTowerCreationRuntime {
    constructor(options = {}) {
        this.bodyCapacity = requirePositiveInteger(
            options.bodyCapacity,
            'Tower creation bodyCapacity'
        );
        this.recordCapacity = requirePositiveInteger(
            options.recordCapacity,
            'Tower creation recordCapacity'
        );
        if (this.recordCapacity > this.bodyCapacity) {
            throw new RangeError('Tower creation recordCapacity는 bodyCapacity 이하여야 합니다.');
        }
        this.readbackSlotCount = requirePositiveInteger(
            options.readbackSlotCount ?? DEFAULT_READBACK_SLOT_COUNT,
            'Tower creation readbackSlotCount'
        );
        this.host = createGpuTowerCreationHostStorage(this.recordCapacity);
        this.device = null;
        this.protocol = null;
        this.resources = null;
        this.buffers = null;
        this.pipelines = null;
        this.bindGroup = null;
        this.mapReadMode = null;
        this.readbackSlots = [];
        this.readbackCursor = 0;
        this.resourceLease = 0;
        this.pending = null;
        this.completed = [];
        this.state = 'idle';
        this.failure = null;
        this.stagedCount = 0;
        this.committedCount = 0;
        this.rejectedCount = 0;
        this.protocolFailureCount = 0;
        this.ringRejectedCount = 0;
        this.lastSubmittedTick = 0;
        this.lastCompletedTick = 0;
        this.recordCountHighWater = 0;
    }

    initialize(device, resources, protocolSource = {}) {
        if (!device || typeof device.createBuffer !== 'function'
            || !device.queue || typeof device.queue.writeBuffer !== 'function') {
            throw new TypeError('Tower creation runtime에는 GPUDevice와 GPUQueue가 필요합니다.');
        }
        for (const key of [
            'counts',
            'physics',
            'simulation',
            'abilityMetadata',
            'members',
            'roster'
        ]) {
            if (!resources?.[key]) {
                throw new TypeError(`Tower creation runtime ${key} buffer가 없습니다.`);
            }
        }
        const protocol = normalizeProtocol(protocolSource);
        if (this.state === 'ready'
            && this.device === device
            && sameProtocol(this.protocol, protocol)
            && sameResources(this.resources, resources)) {
            return true;
        }
        const { usage, stage, mapMode } = requireGpuGlobals();
        const recordBytes = this.recordCapacity
            * GPU_TOWER_CREATION_ABI.RECORD.STRIDE;
        const metadataCommitBytes = this.recordCapacity
            * GPU_TOWER_CREATION_ABI.METADATA_COMMIT.STRIDE;
        const readbackBytes = GPU_TOWER_CREATION_ABI.RESULT.STRIDE
            + metadataCommitBytes;
        const maximumBytes = Math.max(
            recordBytes,
            metadataCommitBytes,
            readbackBytes,
            GPU_TOWER_CREATION_ABI.PROGRAM.STRIDE,
            GPU_TOWER_CREATION_ABI.RESULT.STRIDE
        );
        if (Number(device.limits?.maxStorageBuffersPerShaderStage ?? Infinity)
                < GPU_TOWER_CREATION_STORAGE_PROFILE.maximumStorageBuffersPerStage
            || maximumBytes
                > Number(device.limits?.maxStorageBufferBindingSize ?? Infinity)
            || maximumBytes > Number(device.limits?.maxBufferSize ?? Infinity)) {
            throw new RangeError('Tower creation runtime buffer/storage limit가 부족합니다.');
        }
        this.retire('reinitialize');
        this.device = device;
        this.protocol = protocol;
        this.resources = Object.freeze({ ...resources });
        this.mapReadMode = mapMode.READ;
        this.pipelines = getPipelines(device, stage);
        this.buffers = Object.freeze({
            program: createBuffer(
                device,
                'cirvivor-gpu-tower-creation-program',
                GPU_TOWER_CREATION_ABI.PROGRAM.STRIDE,
                usage.STORAGE | usage.COPY_DST
            ),
            records: createBuffer(
                device,
                'cirvivor-gpu-tower-creation-records',
                recordBytes,
                usage.STORAGE | usage.COPY_DST
            ),
            result: createBuffer(
                device,
                'cirvivor-gpu-tower-creation-result',
                GPU_TOWER_CREATION_ABI.RESULT.STRIDE,
                usage.STORAGE | usage.COPY_SRC | usage.COPY_DST
            ),
            metadataCommits: createBuffer(
                device,
                'cirvivor-gpu-tower-creation-metadata-commits',
                metadataCommitBytes,
                usage.STORAGE | usage.COPY_SRC | usage.COPY_DST
            )
        });
        this.bindGroup = device.createBindGroup({
            label: 'cirvivor-gpu-tower-creation-bind-group',
            layout: this.pipelines.layout,
            entries: [
                { binding: 0, resource: bufferResource(resources.counts) },
                { binding: 1, resource: bufferResource(resources.physics) },
                { binding: 2, resource: bufferResource(resources.simulation) },
                { binding: 3, resource: bufferResource(resources.abilityMetadata) },
                { binding: 4, resource: bufferResource(resources.members) },
                { binding: 5, resource: bufferResource(resources.roster) },
                { binding: 6, resource: bufferResource(this.buffers.program) },
                { binding: 7, resource: bufferResource(this.buffers.records) },
                { binding: 8, resource: bufferResource(this.buffers.result) }
            ]
        });
        const lease = ++this.resourceLease;
        this.readbackSlots = Array.from(
            { length: this.readbackSlotCount },
            (_, index) => ({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-tower-creation-readback-${index}`,
                    readbackBytes,
                    usage.COPY_DST | usage.MAP_READ
                ),
                state: 'free',
                lease,
                envelope: null
            })
        );
        this.readbackCursor = 0;
        this.pending = null;
        this.completed.length = 0;
        this.state = 'ready';
        this.failure = null;
        return true;
    }

    canAccept() {
        return this.state === 'ready'
            && this.pending === null
            && this.readbackSlots.some((slot) => slot.state === 'free');
    }

    stage(source = {}) {
        if (this.state !== 'ready' || !this.device || !this.buffers) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-runtime-unavailable',
                recoveryRequired: this.state === 'failed'
            });
        }
        if (this.pending) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-program-capacity',
                recoveryRequired: false
            });
        }
        let slot = null;
        for (let offset = 0; offset < this.readbackSlots.length; offset++) {
            const index = (this.readbackCursor + offset)
                % this.readbackSlots.length;
            if (this.readbackSlots[index].state === 'free') {
                slot = this.readbackSlots[index];
                this.readbackCursor = (index + 1) % this.readbackSlots.length;
                break;
            }
        }
        if (!slot) {
            this.ringRejectedCount++;
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-result-ring-capacity',
                recoveryRequired: false
            });
        }
        let program;
        let actorActionPlacementBinding = null;
        let actorBindGroup = null;
        try {
            program = writeGpuTowerCreationProgram(this.host, {
                ...source,
                protocol: source.protocol ?? this.protocol,
                bodyCapacity: this.bodyCapacity,
                rosterCapacity: this.bodyCapacity
            });
            if (!sameProtocol(program.protocol, this.protocol)) {
                throw new Error('Tower creation program protocol이 runtime과 다릅니다.');
            }
            actorActionPlacementBinding = normalizeActorActionPlacementBinding(
                source.actorActionPlacementBinding,
                program
            );
            if (actorActionPlacementBinding) {
                if (!this.resources.actorTransit) {
                    throw new TypeError(
                        'R5 ActorAction Tower creation에는 shared actorTransit buffer가 필요합니다.'
                    );
                }
                actorBindGroup = this.device.createBindGroup({
                    label: 'cirvivor-gpu-tower-creation-actor-action-bind-group',
                    layout: this.pipelines.actorLayout,
                    entries: [
                        { binding: 0, resource: bufferResource(this.buffers.program) },
                        { binding: 1, resource: bufferResource(this.buffers.records) },
                        { binding: 2, resource: bufferResource(this.buffers.result) },
                        {
                            binding: 3,
                            resource: {
                                buffer: actorActionPlacementBinding.buffer,
                                offset:
                                    actorActionPlacementBinding.aggregateByteOffset,
                                size: actorActionPlacementBinding.byteLength
                            }
                        },
                        { binding: 4, resource: bufferResource(this.resources.physics) },
                        {
                            binding: 5,
                            resource: bufferResource(this.resources.simulation)
                        },
                        {
                            binding: 6,
                            resource: bufferResource(this.resources.abilityMetadata)
                        },
                        {
                            binding: 7,
                            resource: bufferResource(this.resources.actorTransit)
                        },
                        {
                            binding: 8,
                            resource: bufferResource(this.buffers.metadataCommits)
                        }
                    ]
                });
            }
        } catch (error) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-program-contract',
                failure: captureFailure('tower-creation-program-contract', error),
                recoveryRequired: false
            });
        }
        try {
            this.device.queue.writeBuffer(
                this.buffers.program,
                0,
                this.host.program
            );
            this.device.queue.writeBuffer(
                this.buffers.records,
                0,
                this.host.records,
                0,
                program.recordCount * GPU_TOWER_CREATION_ABI.RECORD.STRIDE
            );
            this.device.queue.writeBuffer(
                this.buffers.result,
                0,
                this.host.result
            );
            this.device.queue.writeBuffer(
                this.buffers.metadataCommits,
                0,
                this.host.metadataCommits
            );
        } catch (error) {
            this.failure = captureFailure('tower-creation-program-upload', error);
            this.state = 'failed';
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-program-upload',
                failure: this.failure,
                recoveryRequired: true
            });
        }
        const envelope = Object.freeze({
            transactionId: String(source.transactionId),
            transactionFingerprint: program.transactionFingerprint,
            sourceTick: program.sourceTick,
            recordCount: program.recordCount,
            existingCount: program.existingCount,
            childCount: program.childCount,
            sourceGroupRevision: program.sourceGroupRevision,
            targetGroupRevision: program.targetGroupRevision,
            targetRosterFingerprint: program.targetRosterFingerprint,
            mode: program.mode,
            executionOrdinal: program.executionOrdinal,
            commandFingerprint: program.commandFingerprint,
            snapshotFingerprint: program.snapshotFingerprint,
            placementFingerprint: program.placementFingerprint,
            actorActionProfileFingerprint:
                program.actorActionProfileFingerprint,
            metadataCommitIdentity: Object.freeze(
                program.records.slice(program.existingCount).map(
                    (record, destinationRank) => Object.freeze({
                        destinationRank,
                        entityId: record.entityId,
                        incarnation: record.incarnation,
                        logicalTowerOrdinal: record.logicalTowerOrdinal,
                        actionCode: program.actionCode
                    })
                )
            ),
            ...program.protocol,
            resourceLease: this.resourceLease
        });
        slot.state = 'reserved';
        slot.lease = this.resourceLease;
        slot.envelope = envelope;
        this.pending = {
            state: 'staged',
            envelope,
            slot,
            program,
            actorActionPlacementBinding,
            actorBindGroup
        };
        this.stagedCount++;
        this.recordCountHighWater = Math.max(
            this.recordCountHighWater,
            program.recordCount
        );
        return Object.freeze({
            accepted: true,
            transactionId: envelope.transactionId,
            transactionFingerprint: envelope.transactionFingerprint,
            sourceTick: envelope.sourceTick,
            recordCount: envelope.recordCount,
            childCount: envelope.childCount,
            targetGroupRevision: envelope.targetGroupRevision,
            targetRosterFingerprint: envelope.targetRosterFingerprint,
            mode: envelope.mode,
            executionOrdinal: envelope.executionOrdinal,
            commandFingerprint: envelope.commandFingerprint,
            snapshotFingerprint: envelope.snapshotFingerprint,
            placementFingerprint: envelope.placementFingerprint,
            actorActionProfileFingerprint:
                envelope.actorActionProfileFingerprint,
            recoveryRequired: false
        });
    }

    getStagedTransaction() {
        return this.pending?.state === 'staged' ? this.pending.envelope : null;
    }

    encode(pass, sourceTick) {
        const tick = requirePositiveInteger(sourceTick, 'Tower creation encode tick');
        if (!pass || typeof pass.setPipeline !== 'function'
            || this.pending?.state !== 'staged'
            || this.pending.envelope.sourceTick !== tick) {
            throw new Error('Tower creation encode 순서가 유효하지 않습니다.');
        }
        const dispatchRecords = Math.ceil(
            this.pending.envelope.recordCount
                / GPU_TOWER_CREATION_WORKGROUP_SIZE
        );
        const dispatchChildren = Math.ceil(
            this.pending.envelope.childCount
                / GPU_TOWER_CREATION_WORKGROUP_SIZE
        );
        const stages = [
            [this.pipelines.clear, 1, this.bindGroup],
            [this.pipelines.validate, dispatchRecords, this.bindGroup]
        ];
        if (this.pending.actorBindGroup) {
            stages.push([
                this.pipelines.validateActorAction,
                dispatchChildren,
                this.pending.actorBindGroup
            ]);
        }
        stages.push(
            [this.pipelines.seal, 1, this.bindGroup],
            [this.pipelines.apply, dispatchRecords, this.bindGroup]
        );
        if (this.pending.actorBindGroup) {
            stages.push(
                [
                    this.pipelines.applyActorAction,
                    dispatchChildren,
                    this.pending.actorBindGroup
                ],
                [
                    this.pipelines.sealActorActionMetadata,
                    1,
                    this.pending.actorBindGroup
                ]
            );
        }
        stages.push(
            [this.pipelines.publish, dispatchChildren, this.bindGroup],
            [this.pipelines.finalize, 1, this.bindGroup]
        );
        for (const [pipeline, workgroups, bindGroup] of stages) {
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(workgroups);
        }
        this.pending.state = 'encoded';
        return true;
    }

    encodeReadback(encoder, sourceTick) {
        const tick = requirePositiveInteger(sourceTick, 'Tower creation copy tick');
        if (!encoder || typeof encoder.copyBufferToBuffer !== 'function'
            || this.pending?.state !== 'encoded'
            || this.pending.envelope.sourceTick !== tick) {
            throw new Error('Tower creation readback copy 순서가 유효하지 않습니다.');
        }
        encoder.copyBufferToBuffer(
            this.buffers.result,
            0,
            this.pending.slot.buffer,
            0,
            GPU_TOWER_CREATION_ABI.RESULT.STRIDE
        );
        if (this.pending.envelope.mode
            === GPU_TOWER_CREATION_MODE.GPU_SUBJECT_ACTOR_ACTION) {
            encoder.copyBufferToBuffer(
                this.buffers.metadataCommits,
                0,
                this.pending.slot.buffer,
                GPU_TOWER_CREATION_ABI.RESULT.STRIDE,
                this.pending.envelope.childCount
                    * GPU_TOWER_CREATION_ABI.METADATA_COMMIT.STRIDE
            );
        }
        this.pending.state = 'copied';
        return true;
    }

    markSubmitted(sourceTick) {
        const tick = requirePositiveInteger(sourceTick, 'Tower creation submit tick');
        if (this.pending?.state !== 'copied'
            || this.pending.envelope.sourceTick !== tick) {
            throw new Error('Tower creation submit 순서가 유효하지 않습니다.');
        }
        this.pending.state = 'submitted';
        this.pending.slot.state = 'in-flight';
        this.lastSubmittedTick = tick;
        this.#beginReadback(this.pending);
        return true;
    }

    failEncoded(error) {
        if (!this.pending) return false;
        this.failure = captureFailure('tower-creation-fixed-submit', error);
        this.state = 'failed';
        this.#releaseSlot(this.pending.slot);
        this.pending = null;
        return true;
    }

    drainCompleted(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('Tower creation completion 출력은 배열이어야 합니다.');
        }
        out.push(...this.completed);
        this.completed.length = 0;
        return out;
    }

    cancelPending(reason = 'cancelled') {
        if (!this.pending) {
            return Object.freeze({
                accepted: true,
                cancelledCount: 0,
                reason,
                recoveryRequired: false
            });
        }
        if (this.pending.state === 'submitted') {
            return Object.freeze({
                accepted: false,
                cancelledCount: 0,
                reason: 'tower-creation-already-submitted',
                recoveryRequired: true
            });
        }
        this.#releaseSlot(this.pending.slot);
        this.pending = null;
        return Object.freeze({
            accepted: true,
            cancelledCount: 1,
            reason,
            recoveryRequired: false
        });
    }

    getStatus() {
        return Object.freeze({
            state: this.state,
            failure: this.failure,
            abiVersion: GPU_TOWER_CREATION_ABI_VERSION,
            sessionGeneration: this.protocol?.sessionGeneration ?? 0,
            deviceGeneration: this.protocol?.deviceGeneration ?? 0,
            authoritativeEpoch: this.protocol?.authoritativeEpoch ?? 0,
            bodyCapacity: this.bodyCapacity,
            recordCapacity: this.recordCapacity,
            readbackSlotCount: this.readbackSlotCount,
            pendingReadbackCount: this.readbackSlots.filter((slot) => (
                slot.state === 'in-flight'
            )).length,
            pendingTransaction: this.pending?.envelope ?? null,
            completedCount: this.completed.length,
            stagedCount: this.stagedCount,
            committedCount: this.committedCount,
            rejectedCount: this.rejectedCount,
            protocolFailureCount: this.protocolFailureCount,
            ringRejectedCount: this.ringRejectedCount,
            lastSubmittedTick: this.lastSubmittedTick,
            lastCompletedTick: this.lastCompletedTick,
            recordCountHighWater: this.recordCountHighWater,
            actorTransitBufferAvailable:
                Boolean(this.resources?.actorTransit),
            resultReadbackBytes: GPU_TOWER_CREATION_ABI.RESULT.STRIDE,
            metadataCommitRecordBytes:
                GPU_TOWER_CREATION_ABI.METADATA_COMMIT.STRIDE,
            metadataCommitReadbackBytesMax: this.recordCapacity
                * GPU_TOWER_CREATION_ABI.METADATA_COMMIT.STRIDE,
            fullBodyReadbackCount: 0,
            storageProfile: GPU_TOWER_CREATION_STORAGE_PROFILE,
            requiresRecovery: this.state === 'failed'
        });
    }

    requiresRecovery() {
        return this.state === 'failed';
    }

    retire(reason = 'resource-retired') {
        this.resourceLease++;
        for (const slot of this.readbackSlots) {
            try { slot.buffer?.unmap?.(); } catch { /* not mapped */ }
            destroyBuffer(slot.buffer);
            slot.state = 'retired';
            slot.envelope = null;
        }
        this.readbackSlots = [];
        if (this.buffers) {
            for (const buffer of Object.values(this.buffers)) destroyBuffer(buffer);
        }
        this.device = null;
        this.protocol = null;
        this.resources = null;
        this.buffers = null;
        this.pipelines = null;
        this.bindGroup = null;
        this.mapReadMode = null;
        this.pending = null;
        this.completed.length = 0;
        this.state = 'idle';
        this.failure = reason === 'destroyed' ? this.failure : null;
    }

    destroy() {
        this.retire('destroyed');
    }

    #beginReadback(pending) {
        const { slot, envelope } = pending;
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            const authentic = this.state === 'ready'
                && this.pending === pending
                && pending.state === 'submitted'
                && slot.state === 'in-flight'
                && slot.lease === this.resourceLease
                && envelope.resourceLease === this.resourceLease
                && sameProtocol(envelope, this.protocol);
            if (!authentic) {
                try { slot.buffer.unmap(); } catch { /* retired */ }
                this.#releaseSlot(slot);
                return;
            }
            let completion;
            try {
                const mapped = slot.buffer.getMappedRange();
                const result = readGpuTowerCreationResult(
                    mapped.slice(0, GPU_TOWER_CREATION_ABI.RESULT.STRIDE)
                );
                const actorMode = envelope.mode
                    === GPU_TOWER_CREATION_MODE.GPU_SUBJECT_ACTOR_ACTION;
                const metadataCommits = actorMode && result.committed
                    ? readGpuTowerCreationMetadataCommits(
                        mapped.slice(
                            GPU_TOWER_CREATION_ABI.RESULT.STRIDE,
                            GPU_TOWER_CREATION_ABI.RESULT.STRIDE
                                + envelope.childCount
                                    * GPU_TOWER_CREATION_ABI
                                        .METADATA_COMMIT.STRIDE
                        ),
                        envelope.childCount
                    )
                    : Object.freeze([]);
                const metadataMatches = actorMode
                    ? (result.committed
                        ? (result.metadataCommitCount === envelope.childCount
                            && metadataCommits.every((record, index) => {
                                const expected
                                    = envelope.metadataCommitIdentity[index];
                                return record.fingerprintValid
                                    && record.destinationRank
                                        === expected.destinationRank
                                    && record.entityId === expected.entityId
                                    && record.incarnation
                                        === expected.incarnation
                                    && record.logicalTowerOrdinal
                                        === expected.logicalTowerOrdinal
                                    && record.actionCode
                                        === expected.actionCode;
                            })
                            && result.metadataCommitFingerprint
                                === computeGpuTowerCreationMetadataFingerprint(
                                    metadataCommits
                                ))
                        : result.metadataCommitCount === 0
                            && result.metadataCommitFingerprint === 0)
                    : result.metadataCommitCount === 0
                        && result.metadataCommitFingerprint === 0;
                const provenanceMatches = result.abiVersion
                        === GPU_TOWER_CREATION_ABI_VERSION
                    && result.fingerprintValid
                    && sameProtocol(result, envelope)
                    && result.sourceTick === envelope.sourceTick
                    && result.transactionFingerprint
                        === envelope.transactionFingerprint
                    && result.recordCount === envelope.recordCount
                    && result.sourceGroupRevision
                        === envelope.sourceGroupRevision
                    && result.targetGroupRevision
                        === envelope.targetGroupRevision
                    && result.targetRosterFingerprint
                        === envelope.targetRosterFingerprint
                    && result.mode === envelope.mode
                    && result.executionOrdinal === envelope.executionOrdinal
                    && result.commandFingerprint === envelope.commandFingerprint
                    && result.snapshotFingerprint
                        === envelope.snapshotFingerprint
                    && result.placementFingerprint
                        === envelope.placementFingerprint
                    && result.actorActionProfileFingerprint
                        === envelope.actorActionProfileFingerprint
                    && metadataMatches;
                const committedCounts = result.status
                        !== GPU_TOWER_CREATION_STATUS.COMMITTED
                    || (result.validatedCount === envelope.recordCount
                        && result.appliedCount === envelope.recordCount
                        && result.createdCount === envelope.childCount);
                const rejectedCounts = result.status
                        !== GPU_TOWER_CREATION_STATUS.REJECTED_SOURCE_CHANGED
                    || (result.appliedCount === 0
                        && result.createdCount === 0);
                const terminalStatus = [
                    GPU_TOWER_CREATION_STATUS.COMMITTED,
                    GPU_TOWER_CREATION_STATUS.REJECTED_SOURCE_CHANGED,
                    GPU_TOWER_CREATION_STATUS.PROTOCOL_FAILURE
                ].includes(result.status);
                const protocolFailure = !provenanceMatches
                    || !committedCounts
                    || !rejectedCounts
                    || !terminalStatus
                    || (result.errorFlags
                        & GPU_TOWER_CREATION_HARD_FAILURE_MASK) !== 0;
                completion = Object.freeze({
                    transactionId: envelope.transactionId,
                    transactionFingerprint: envelope.transactionFingerprint,
                    sourceTick: envelope.sourceTick,
                    submittedTick: envelope.sourceTick,
                    childCount: envelope.childCount,
                    result: protocolFailure
                        ? GPU_TOWER_CREATION_STATUS.PROTOCOL_FAILURE
                        : result.status,
                    committed: !protocolFailure && result.committed,
                    rejectedSourceChanged: !protocolFailure
                        && result.status
                            === GPU_TOWER_CREATION_STATUS
                                .REJECTED_SOURCE_CHANGED,
                    protocolFailure,
                    recoveryRequired: protocolFailure
                        || result.recoveryRequired,
                    evidence: result,
                    metadataCommits,
                    mode: envelope.mode,
                    executionOrdinal: envelope.executionOrdinal,
                    commandFingerprint: envelope.commandFingerprint,
                    snapshotFingerprint: envelope.snapshotFingerprint,
                    placementFingerprint: envelope.placementFingerprint,
                    actorActionProfileFingerprint:
                        envelope.actorActionProfileFingerprint,
                    ...this.protocol
                });
                if (completion.committed) {
                    this.committedCount++;
                } else if (completion.recoveryRequired) {
                    this.protocolFailureCount++;
                    this.state = 'failed';
                    this.failure = captureFailure(
                        'tower-creation-result-protocol',
                        new Error(`status=${result.status}, flags=${result.errorFlags}`)
                    );
                } else {
                    this.rejectedCount++;
                }
                this.completed.push(completion);
                this.lastCompletedTick = Math.max(
                    this.lastCompletedTick,
                    envelope.sourceTick
                );
            } catch (error) {
                this.protocolFailureCount++;
                this.state = 'failed';
                this.failure = captureFailure('tower-creation-result-readback', error);
                this.completed.push(Object.freeze({
                    transactionId: envelope.transactionId,
                    transactionFingerprint: envelope.transactionFingerprint,
                    sourceTick: envelope.sourceTick,
                    submittedTick: envelope.sourceTick,
                    childCount: envelope.childCount,
                    committed: false,
                    rejectedSourceChanged: false,
                    protocolFailure: true,
                    recoveryRequired: true,
                    evidence: null,
                    ...envelope
                }));
            } finally {
                slot.buffer.unmap();
                this.#releaseSlot(slot);
                if (this.pending === pending) this.pending = null;
            }
        }).catch((error) => {
            const authentic = slot.lease === this.resourceLease
                && envelope.resourceLease === this.resourceLease;
            if (authentic) {
                this.protocolFailureCount++;
                this.state = 'failed';
                this.failure = captureFailure('tower-creation-result-map', error);
            }
            this.#releaseSlot(slot);
            if (this.pending === pending) this.pending = null;
        });
    }

    #releaseSlot(slot) {
        if (!slot || slot.state === 'free' || slot.state === 'retired') return;
        slot.state = 'free';
        slot.envelope = null;
    }
}
