import {
    GPU_TOWER_MERGE_ABI,
    GPU_TOWER_MERGE_ABI_VERSION,
    GPU_TOWER_MERGE_ERROR_FLAG,
    GPU_TOWER_MERGE_HARD_FAILURE_MASK,
    GPU_TOWER_MERGE_STATUS,
    GPU_TOWER_MERGE_STORAGE_PROFILE,
    createGpuTowerMergeHostStorage,
    readGpuTowerMergeResult,
    writeGpuTowerMergeProgram
} from './gpu_tower_merge_abi.js';
import {
    GPU_TOWER_MERGE_WGSL,
    GPU_TOWER_MERGE_WORKGROUP_SIZE
} from './gpu_tower_merge_shaders.js';

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
        throw new RangeError(`${label}는 uint32 범위여야 합니다.`);
    }
    return number;
}

function normalizeProtocol(source = {}) {
    return Object.freeze({
        sessionGeneration: requirePositiveInteger(
            source.sessionGeneration,
            'Tower merge sessionGeneration'
        ),
        deviceGeneration: requireNonNegativeInteger(
            source.deviceGeneration,
            'Tower merge deviceGeneration'
        ),
        authoritativeEpoch: requireNonNegativeInteger(
            source.authoritativeEpoch,
            'Tower merge authoritativeEpoch'
        )
    });
}

function sameProtocol(left, right) {
    return left?.sessionGeneration === right?.sessionGeneration
        && left?.deviceGeneration === right?.deviceGeneration
        && left?.authoritativeEpoch === right?.authoritativeEpoch;
}

function sameResources(left, right) {
    return [
        'physics',
        'simulation',
        'bodyControlStates',
        'abilityMetadata',
        'members',
        'roster'
    ].every((key) => left?.[key] === right?.[key]);
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
        throw new Error('Tower merge runtime에 필요한 WebGPU 상수가 없습니다.');
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
        label: 'cirvivor-gpu-tower-merge-layout',
        entries: Array.from({ length: 9 }, (_, binding) => ({
            binding,
            visibility: stage.COMPUTE,
            buffer: {
                type: binding === 7 ? 'read-only-storage' : 'storage'
            }
        }))
    });
    const module = device.createShaderModule({
        label: 'cirvivor-gpu-tower-merge-shader',
        code: GPU_TOWER_MERGE_WGSL
    });
    const pipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-tower-merge-pipeline-layout',
        bindGroupLayouts: [layout]
    });
    const createPipeline = (entryPoint) => device.createComputePipeline({
        label: `cirvivor-gpu-tower-merge-${entryPoint}`,
        layout: pipelineLayout,
        compute: { module, entryPoint }
    });
    cached = Object.freeze({
        layout,
        clear: createPipeline('clear_merge'),
        validate: createPipeline('validate_sources'),
        seal: createPipeline('seal_merge'),
        apply: createPipeline('apply_merge'),
        finalize: createPipeline('finalize_merge')
    });
    PIPELINES_BY_DEVICE.set(device, cached);
    return cached;
}

/**
 * Tower N→1 merge 하나를 main fixed encoder 안에서 all-or-none으로 수행합니다.
 * CPU에는 112-byte aggregate만 되돌리며 body/member 본문은 읽지 않습니다.
 */
export class GpuTowerMergeRuntime {
    constructor(options = {}) {
        this.bodyCapacity = requirePositiveInteger(
            options.bodyCapacity,
            'Tower merge bodyCapacity'
        );
        this.recordCapacity = requirePositiveInteger(
            options.recordCapacity ?? 256,
            'Tower merge recordCapacity'
        );
        if (this.recordCapacity > 256
            || this.recordCapacity > this.bodyCapacity) {
            throw new RangeError('Tower merge recordCapacity는 min(bodyCapacity, 256) 이하여야 합니다.');
        }
        this.readbackSlotCount = requirePositiveInteger(
            options.readbackSlotCount ?? DEFAULT_READBACK_SLOT_COUNT,
            'Tower merge readbackSlotCount'
        );
        this.host = createGpuTowerMergeHostStorage(this.recordCapacity);
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
        this.submittedCount = 0;
        this.committedCount = 0;
        this.rejectedCount = 0;
        this.protocolFailureCount = 0;
        this.ringRejectedCount = 0;
        this.staleCompletionCount = 0;
        this.lastSubmittedTick = 0;
        this.lastCompletedTick = 0;
        this.sourceCountHighWater = 0;
    }

    initialize(device, resources, protocolSource = {}) {
        if (!device || typeof device.createBuffer !== 'function'
            || !device.queue || typeof device.queue.writeBuffer !== 'function') {
            throw new TypeError('Tower merge runtime에는 GPUDevice/GPUQueue가 필요합니다.');
        }
        for (const key of [
            'physics',
            'simulation',
            'bodyControlStates',
            'abilityMetadata',
            'members',
            'roster'
        ]) {
            if (!resources?.[key]) {
                throw new TypeError(`Tower merge runtime ${key} buffer가 없습니다.`);
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
            * GPU_TOWER_MERGE_ABI.RECORD.STRIDE;
        const maximumBytes = Math.max(
            recordBytes,
            GPU_TOWER_MERGE_ABI.PROGRAM.STRIDE,
            GPU_TOWER_MERGE_ABI.RESULT.STRIDE
        );
        if (Number(device.limits?.maxStorageBuffersPerShaderStage ?? Infinity)
                < GPU_TOWER_MERGE_STORAGE_PROFILE.maximumStorageBuffersPerStage
            || maximumBytes
                > Number(device.limits?.maxStorageBufferBindingSize ?? Infinity)
            || maximumBytes > Number(device.limits?.maxBufferSize ?? Infinity)) {
            throw new RangeError('Tower merge runtime buffer/storage limit가 부족합니다.');
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
                'cirvivor-gpu-tower-merge-program',
                GPU_TOWER_MERGE_ABI.PROGRAM.STRIDE,
                usage.STORAGE | usage.COPY_DST
            ),
            records: createBuffer(
                device,
                'cirvivor-gpu-tower-merge-records',
                recordBytes,
                usage.STORAGE | usage.COPY_DST
            ),
            result: createBuffer(
                device,
                'cirvivor-gpu-tower-merge-result',
                GPU_TOWER_MERGE_ABI.RESULT.STRIDE,
                usage.STORAGE | usage.COPY_SRC | usage.COPY_DST
            )
        });
        this.bindGroup = device.createBindGroup({
            label: 'cirvivor-gpu-tower-merge-bind-group',
            layout: this.pipelines.layout,
            entries: [
                { binding: 0, resource: bufferResource(resources.physics) },
                { binding: 1, resource: bufferResource(resources.simulation) },
                {
                    binding: 2,
                    resource: bufferResource(resources.bodyControlStates)
                },
                {
                    binding: 3,
                    resource: bufferResource(resources.abilityMetadata)
                },
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
                    `cirvivor-gpu-tower-merge-readback-${index}`,
                    GPU_TOWER_MERGE_ABI.RESULT.STRIDE,
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
                reason: 'tower-merge-runtime-unavailable',
                recoveryRequired: this.state === 'failed'
            });
        }
        if (this.pending) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-merge-program-capacity',
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
                reason: 'tower-merge-result-ring-capacity',
                recoveryRequired: false
            });
        }
        let program;
        try {
            program = writeGpuTowerMergeProgram(this.host, {
                ...source,
                protocol: source.protocol ?? this.protocol,
                bodyCapacity: this.bodyCapacity
            });
            if (!sameProtocol(program.protocol, this.protocol)) {
                throw new Error('Tower merge program protocol이 runtime과 다릅니다.');
            }
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
                program.sourceCount * GPU_TOWER_MERGE_ABI.RECORD.STRIDE
            );
            this.device.queue.writeBuffer(
                this.buffers.result,
                0,
                this.host.result
            );
        } catch (error) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-merge-program-contract',
                failure: captureFailure('tower-merge-program-contract', error),
                recoveryRequired: false
            });
        }
        const envelope = Object.freeze({
            transactionId: program.transactionId,
            transactionFingerprint: program.transactionFingerprint,
            planFingerprint: program.planFingerprint,
            planFingerprintLane0: program.planFingerprintLane0,
            planFingerprintLane1: program.planFingerprintLane1,
            sourceIdentityFingerprint: program.sourceIdentityFingerprint,
            sourceTick: program.sourceTick,
            sourceCount: program.sourceCount,
            survivorRank: program.survivorRank,
            survivorEntityId: program.survivorEntityId,
            survivorIncarnation: program.survivorIncarnation,
            survivorSlot: program.survivorSlot,
            sourceGroupRevision: program.sourceGroupRevision,
            targetGroupRevision: program.targetGroupRevision,
            sourceRosterFingerprint: program.sourceRosterFingerprint,
            targetRosterFingerprint: program.targetRosterFingerprint,
            targetCurrentHpFixedPoint: program.targetCurrentHpFixedPoint,
            targetMaxHpFixedPoint: program.targetMaxHpFixedPoint,
            targetPowerFixedPoint: program.targetPowerFixedPoint,
            targetShareUnits: program.targetShareUnits,
            programFingerprint: program.programFingerprint,
            records: program.records,
            ...program.protocol,
            resourceLease: this.resourceLease
        });
        slot.state = 'reserved';
        slot.lease = this.resourceLease;
        slot.envelope = envelope;
        this.pending = {
            state: 'staged',
            slot,
            envelope
        };
        this.stagedCount++;
        this.sourceCountHighWater = Math.max(
            this.sourceCountHighWater,
            program.sourceCount
        );
        return Object.freeze({
            accepted: true,
            transactionId: envelope.transactionId,
            transactionFingerprint: envelope.transactionFingerprint,
            planFingerprint: envelope.planFingerprint,
            sourceTick: envelope.sourceTick,
            sourceCount: envelope.sourceCount,
            survivorHandle: Object.freeze({
                entityId: envelope.survivorEntityId,
                incarnation: envelope.survivorIncarnation
            }),
            sourceRosterFingerprint: envelope.sourceRosterFingerprint,
            targetRosterFingerprint: envelope.targetRosterFingerprint,
            recoveryRequired: false
        });
    }

    getStagedTransaction() {
        return this.pending?.state === 'staged' ? this.pending.envelope : null;
    }

    encode(pass, sourceTick) {
        const tick = requirePositiveInteger(sourceTick, 'Tower merge encode tick');
        if (!pass || typeof pass.setPipeline !== 'function'
            || this.pending?.state !== 'staged'
            || this.pending.envelope.sourceTick !== tick) {
            throw new Error('Tower merge encode 순서가 유효하지 않습니다.');
        }
        const recordWorkgroups = Math.ceil(
            this.pending.envelope.sourceCount / GPU_TOWER_MERGE_WORKGROUP_SIZE
        );
        for (const [pipeline, workgroups] of [
            [this.pipelines.clear, 1],
            [this.pipelines.validate, recordWorkgroups],
            [this.pipelines.seal, 1],
            [this.pipelines.apply, recordWorkgroups],
            [this.pipelines.finalize, 1]
        ]) {
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, this.bindGroup);
            pass.dispatchWorkgroups(workgroups);
        }
        this.pending.state = 'encoded';
        return true;
    }

    encodeReadback(encoder, sourceTick) {
        const tick = requirePositiveInteger(sourceTick, 'Tower merge copy tick');
        if (!encoder || typeof encoder.copyBufferToBuffer !== 'function'
            || this.pending?.state !== 'encoded'
            || this.pending.envelope.sourceTick !== tick) {
            throw new Error('Tower merge readback copy 순서가 유효하지 않습니다.');
        }
        encoder.copyBufferToBuffer(
            this.buffers.result,
            0,
            this.pending.slot.buffer,
            0,
            GPU_TOWER_MERGE_ABI.RESULT.STRIDE
        );
        this.pending.state = 'copied';
        return true;
    }

    markSubmitted(sourceTick) {
        const tick = requirePositiveInteger(sourceTick, 'Tower merge submit tick');
        if (this.pending?.state !== 'copied'
            || this.pending.envelope.sourceTick !== tick) {
            throw new Error('Tower merge submit 순서가 유효하지 않습니다.');
        }
        this.pending.state = 'submitted';
        this.pending.slot.state = 'in-flight';
        this.lastSubmittedTick = tick;
        this.submittedCount++;
        this.#beginReadback(this.pending);
        return true;
    }

    failEncoded(error) {
        if (!this.pending) return false;
        this.failure = captureFailure('tower-merge-fixed-submit', error);
        this.state = 'failed';
        this.#releaseSlot(this.pending.slot);
        this.pending = null;
        return true;
    }

    drainCompleted(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('Tower merge completion 출력은 배열이어야 합니다.');
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
                reason: 'tower-merge-already-submitted',
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
            abiVersion: GPU_TOWER_MERGE_ABI_VERSION,
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
            submittedCount: this.submittedCount,
            committedCount: this.committedCount,
            rejectedCount: this.rejectedCount,
            protocolFailureCount: this.protocolFailureCount,
            ringRejectedCount: this.ringRejectedCount,
            staleCompletionCount: this.staleCompletionCount,
            lastSubmittedTick: this.lastSubmittedTick,
            lastCompletedTick: this.lastCompletedTick,
            sourceCountHighWater: this.sourceCountHighWater,
            aggregateReadbackBytes: GPU_TOWER_MERGE_ABI.RESULT.STRIDE,
            metadataReceiptReadbackBytes: 0,
            perTowerCpuCommandCount: 0,
            fullBodyReadbackCount: 0,
            storageProfile: GPU_TOWER_MERGE_STORAGE_PROFILE,
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
            for (const buffer of Object.values(this.buffers)) {
                destroyBuffer(buffer);
            }
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
        if (reason !== 'destroyed') this.failure = null;
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
                this.staleCompletionCount++;
                try { slot.buffer.unmap(); } catch { /* retired */ }
                this.#releaseSlot(slot);
                return;
            }
            try {
                const result = readGpuTowerMergeResult(
                    slot.buffer.getMappedRange().slice(
                        0,
                        GPU_TOWER_MERGE_ABI.RESULT.STRIDE
                    )
                );
                const provenanceMatches = result.abiVersion
                        === GPU_TOWER_MERGE_ABI_VERSION
                    && result.resultFingerprintValid
                    && result.reserved === 0
                    && sameProtocol(result, envelope)
                    && result.sourceTick === envelope.sourceTick
                    && result.sourceCount === envelope.sourceCount
                    && result.survivorRank === envelope.survivorRank
                    && result.sourceGroupRevision
                        === envelope.sourceGroupRevision
                    && result.targetGroupRevision
                        === envelope.targetGroupRevision
                    && result.sourceRosterFingerprint
                        === envelope.sourceRosterFingerprint
                    && result.targetRosterFingerprint
                        === envelope.targetRosterFingerprint
                    && result.planFingerprint === envelope.planFingerprint
                    && result.transactionFingerprint
                        === envelope.transactionFingerprint
                    && result.sourceIdentityFingerprint
                        === envelope.sourceIdentityFingerprint
                    && result.survivorEntityId
                        === envelope.survivorEntityId
                    && result.survivorIncarnation
                        === envelope.survivorIncarnation
                    && result.survivorSlot === envelope.survivorSlot;
                const committedCounts = result.status
                        !== GPU_TOWER_MERGE_STATUS.COMMITTED
                    || (result.errorFlags === 0
                        && result.validatedCount === envelope.sourceCount
                        && result.appliedCount === envelope.sourceCount
                        && result.committedCount === 1
                        && result.consumedCount
                            === envelope.sourceCount - 1);
                const rejectedCounts = result.status
                        !== GPU_TOWER_MERGE_STATUS.REJECTED_SOURCE_CHANGED
                    || (result.appliedCount === 0
                        && result.committedCount === 0
                        && result.consumedCount === 0
                        && (result.errorFlags
                            & GPU_TOWER_MERGE_ERROR_FLAG.SOURCE_CHANGED) !== 0
                        && (result.errorFlags
                            & GPU_TOWER_MERGE_HARD_FAILURE_MASK) === 0);
                const terminalStatus = [
                    GPU_TOWER_MERGE_STATUS.COMMITTED,
                    GPU_TOWER_MERGE_STATUS.REJECTED_SOURCE_CHANGED,
                    GPU_TOWER_MERGE_STATUS.PROTOCOL_FAILURE
                ].includes(result.status);
                const protocolFailure = !provenanceMatches
                    || !committedCounts
                    || !rejectedCounts
                    || !terminalStatus
                    || (result.errorFlags
                        & GPU_TOWER_MERGE_HARD_FAILURE_MASK) !== 0
                    || result.status === GPU_TOWER_MERGE_STATUS.PROTOCOL_FAILURE;
                const completion = Object.freeze({
                    transactionId: envelope.transactionId,
                    transactionFingerprint: envelope.transactionFingerprint,
                    planFingerprint: envelope.planFingerprint,
                    sourceTick: envelope.sourceTick,
                    submittedTick: envelope.sourceTick,
                    sourceCount: envelope.sourceCount,
                    consumedCount: protocolFailure
                        ? 0
                        : result.consumedCount,
                    survivorHandle: Object.freeze({
                        entityId: envelope.survivorEntityId,
                        incarnation: envelope.survivorIncarnation
                    }),
                    sourceIdentityFingerprint:
                        envelope.sourceIdentityFingerprint,
                    committed: !protocolFailure
                        && result.status === GPU_TOWER_MERGE_STATUS.COMMITTED,
                    rejectedSourceChanged: !protocolFailure
                        && result.status
                            === GPU_TOWER_MERGE_STATUS.REJECTED_SOURCE_CHANGED,
                    protocolFailure,
                    recoveryRequired: protocolFailure,
                    evidence: result,
                    records: envelope.records,
                    ...this.protocol
                });
                if (completion.committed) {
                    this.committedCount++;
                } else if (completion.recoveryRequired) {
                    this.protocolFailureCount++;
                    this.state = 'failed';
                    this.failure = captureFailure(
                        'tower-merge-result-protocol',
                        new Error(
                            `status=${result.status}, flags=${result.errorFlags}`
                        )
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
                this.failure = captureFailure('tower-merge-result-readback', error);
                this.completed.push(Object.freeze({
                    transactionId: envelope.transactionId,
                    transactionFingerprint: envelope.transactionFingerprint,
                    planFingerprint: envelope.planFingerprint,
                    sourceTick: envelope.sourceTick,
                    submittedTick: envelope.sourceTick,
                    sourceCount: envelope.sourceCount,
                    consumedCount: 0,
                    committed: false,
                    rejectedSourceChanged: false,
                    protocolFailure: true,
                    recoveryRequired: true,
                    evidence: null,
                    records: envelope.records,
                    ...this.protocol
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
                this.failure = captureFailure('tower-merge-result-map', error);
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
