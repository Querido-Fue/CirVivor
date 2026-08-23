import {
    GPU_ACTOR_TRANSIT_ABI,
    GPU_ACTOR_TRANSIT_ABI_VERSION,
    GPU_ACTOR_TRANSIT_STATUS,
    computeActorTransitActivationTick,
    createGpuActorTransitCommandStorage,
    createGpuActorTransitDispatchArgs,
    readGpuActorTransitAggregate
} from './gpu_actor_transit_abi.js';
import {
    GPU_ACTOR_TRANSIT_STORAGE_BINDING_COUNT,
    GPU_ACTOR_TRANSIT_WGSL,
    GPU_ACTOR_TRANSIT_WORKGROUP_SIZE
} from './gpu_actor_transit_shaders.js';

const DEFAULT_READBACK_SLOT_COUNT = 4;
const PIPELINES_BY_DEVICE = new WeakMap();

function requirePositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number > 0xffffffff) {
        throw new RangeError(`${label}은 양의 uint32 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
        throw new RangeError(`${label}은 uint32 정수여야 합니다.`);
    }
    return number;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requireExactHandle(source, label) {
    const entityId = requirePositiveInteger(source?.entityId, `${label}.entityId`);
    const incarnation = requirePositiveInteger(
        source?.incarnation,
        `${label}.incarnation`
    );
    return Object.freeze({ entityId, incarnation });
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function sameResources(left, right) {
    return left?.physics === right?.physics
        && left?.simulation === right?.simulation
        && left?.abilityMetadata === right?.abilityMetadata
        && left?.enemyBehaviorStates === right?.enemyBehaviorStates;
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
        || !Number.isSafeInteger(usage.COPY_DST)
        || !Number.isSafeInteger(usage.COPY_SRC)
        || !Number.isSafeInteger(usage.INDIRECT)
        || !Number.isSafeInteger(usage.MAP_READ)
        || !Number.isSafeInteger(stage.COMPUTE)
        || !Number.isSafeInteger(mapMode.READ)) {
        throw new Error('ActorTransit WebGPU globals가 준비되지 않았습니다.');
    }
    return { usage, stage, mapMode };
}

function createPipelines(device, stage) {
    const cached = PIPELINES_BY_DEVICE.get(device);
    if (cached) return cached;
    const layout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-actor-transit-layout',
        entries: Array.from(
            { length: GPU_ACTOR_TRANSIT_STORAGE_BINDING_COUNT },
            (_, binding) => ({
                binding,
                visibility: stage.COMPUTE,
                buffer: { type: binding === 0 ? 'read-only-storage' : 'storage' }
            })
        )
    });
    const module = device.createShaderModule({
        label: 'cirvivor-gpu-actor-transit-shader',
        code: GPU_ACTOR_TRANSIT_WGSL
    });
    const pipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-actor-transit-pipeline-layout',
        bindGroupLayouts: [layout]
    });
    const pipeline = (entryPoint) => device.createComputePipeline({
        label: `cirvivor-gpu-actor-transit-${entryPoint}`,
        layout: pipelineLayout,
        compute: { module, entryPoint }
    });
    const result = Object.freeze({
        layout,
        initialize: pipeline('initialize_actor_transit_aggregate'),
        advance: pipeline('advance_actor_transits'),
        seal: pipeline('seal_actor_transit_aggregate')
    });
    PIPELINES_BY_DEVICE.set(device, result);
    return result;
}

/**
 * Stable body slot과 1:1인 persistent AIRBORNE side-plane입니다. 위치/activation은
 * GPU가 fixed tick으로 전진시키고 CPU는 aggregate와 이미 소유한 exact handle만 봅니다.
 */
export class GpuActorTransitRuntime {
    constructor(options = {}) {
        this.sessionGeneration = requirePositiveInteger(
            options.sessionGeneration ?? 1,
            'sessionGeneration'
        );
        this.readbackSlotCount = requirePositiveInteger(
            options.readbackSlotCount ?? DEFAULT_READBACK_SLOT_COUNT,
            'readbackSlotCount'
        );
        this.device = null;
        this.deviceGeneration = 0;
        this.authoritativeEpoch = 0;
        this.bodyCapacity = 0;
        this.resources = null;
        this.buffers = null;
        this.pipelines = null;
        this.bindGroup = null;
        this.mapReadMode = null;
        this.readbacks = [];
        this.readbackCursor = 0;
        this.resourceLease = 0;
        this.state = 'idle';
        this.failure = null;
        this.destroyed = false;
        this.batches = new Map();
        this.airborneHandles = new Map();
        this.completed = [];
        this.latestAggregate = null;
        this.submittedCount = 0;
        this.completedReadbackCount = 0;
        this.deferredReadbackCount = 0;
        this.batchHighWater = 0;
        this.actorHighWater = 0;
        this.landedActorCount = 0;
        this.cancelledBatchCount = 0;
    }

    initialize(device, resources, protocol = {}) {
        if (this.destroyed) return false;
        if (!device || typeof device.createBuffer !== 'function'
            || !device.queue || typeof device.queue.writeBuffer !== 'function') {
            throw new TypeError('ActorTransit에 GPUDevice와 GPUQueue가 필요합니다.');
        }
        for (const key of [
            'physics',
            'simulation',
            'abilityMetadata',
            'enemyBehaviorStates'
        ]) {
            if (!resources?.[key]) {
                throw new TypeError(`ActorTransit ${key} buffer가 없습니다.`);
            }
        }
        const sessionGeneration = requirePositiveInteger(
            protocol.sessionGeneration ?? this.sessionGeneration,
            'protocol.sessionGeneration'
        );
        if (sessionGeneration !== this.sessionGeneration) {
            throw new RangeError('ActorTransit session generation이 다릅니다.');
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
        if (this.device === device
            && this.deviceGeneration === deviceGeneration
            && this.authoritativeEpoch === authoritativeEpoch
            && this.bodyCapacity === bodyCapacity
            && sameResources(this.resources, resources)
            && this.state === 'ready') {
            return true;
        }
        const { usage, stage, mapMode } = requireGpuGlobals();
        if (Number(device.limits?.maxStorageBuffersPerShaderStage ?? Infinity)
            < GPU_ACTOR_TRANSIT_STORAGE_BINDING_COUNT) {
            throw new RangeError('ActorTransit storage binding limit가 부족합니다.');
        }
        this.#retireResources('resource-rebind');
        this.device = device;
        this.deviceGeneration = deviceGeneration;
        this.authoritativeEpoch = authoritativeEpoch;
        this.bodyCapacity = bodyCapacity;
        this.resources = Object.freeze({ ...resources });
        this.pipelines = createPipelines(device, stage);
        this.mapReadMode = mapMode.READ;
        const recordByteLength = bodyCapacity
            * GPU_ACTOR_TRANSIT_ABI.RECORD.STRIDE;
        this.buffers = Object.freeze({
            command: device.createBuffer({
                label: 'cirvivor-gpu-actor-transit-command',
                size: GPU_ACTOR_TRANSIT_ABI.COMMAND.STRIDE,
                usage: usage.STORAGE | usage.COPY_DST
            }),
            records: device.createBuffer({
                label: 'cirvivor-gpu-actor-transit-records',
                size: recordByteLength,
                usage: usage.STORAGE | usage.COPY_DST | usage.COPY_SRC
            }),
            aggregate: device.createBuffer({
                label: 'cirvivor-gpu-actor-transit-aggregate',
                size: GPU_ACTOR_TRANSIT_ABI.AGGREGATE.STRIDE,
                usage: usage.STORAGE | usage.COPY_SRC
            }),
            dispatch: device.createBuffer({
                label: 'cirvivor-gpu-actor-transit-dispatch',
                size: GPU_ACTOR_TRANSIT_ABI.DISPATCH_ARGS.STRIDE,
                usage: usage.INDIRECT | usage.COPY_DST
            })
        });
        device.queue.writeBuffer(
            this.buffers.records,
            0,
            new ArrayBuffer(recordByteLength)
        );
        device.queue.writeBuffer(
            this.buffers.dispatch,
            0,
            createGpuActorTransitDispatchArgs(
                bodyCapacity,
                GPU_ACTOR_TRANSIT_WORKGROUP_SIZE
            )
        );
        this.bindGroup = device.createBindGroup({
            label: 'cirvivor-gpu-actor-transit-bind',
            layout: this.pipelines.layout,
            entries: [
                { binding: 0, resource: { buffer: this.buffers.command } },
                { binding: 1, resource: { buffer: this.buffers.records } },
                { binding: 2, resource: { buffer: resources.physics } },
                { binding: 3, resource: { buffer: resources.simulation } },
                { binding: 4, resource: { buffer: resources.abilityMetadata } },
                { binding: 5, resource: { buffer: resources.enemyBehaviorStates } },
                { binding: 6, resource: { buffer: this.buffers.aggregate } }
            ]
        });
        const lease = ++this.resourceLease;
        this.readbacks = Array.from(
            { length: this.readbackSlotCount },
            (_, index) => ({
                buffer: device.createBuffer({
                    label: `cirvivor-gpu-actor-transit-readback-${index}`,
                    size: GPU_ACTOR_TRANSIT_ABI.AGGREGATE.STRIDE,
                    usage: usage.COPY_DST | usage.MAP_READ
                }),
                inFlight: false,
                sourceTick: 0,
                lease
            })
        );
        this.readbackCursor = 0;
        this.state = 'ready';
        this.failure = null;
        this.latestAggregate = null;
        return true;
    }

    getGpuBinding() {
        if (this.destroyed || this.state !== 'ready' || !this.buffers) {
            return null;
        }
        return Object.freeze({
            abiVersion: GPU_ACTOR_TRANSIT_ABI_VERSION,
            buffer: this.buffers.records,
            recordStride: GPU_ACTOR_TRANSIT_ABI.RECORD.STRIDE,
            bodyCapacity: this.bodyCapacity,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: this.deviceGeneration,
            authoritativeEpoch: this.authoritativeEpoch
        });
    }

    registerCommittedBatch(source = {}) {
        if (this.destroyed || this.state !== 'ready') return false;
        const transactionId = requireNonEmptyString(
            source.transactionId,
            'transactionId'
        );
        if (this.batches.has(transactionId)) {
            throw new RangeError('actor transit transactionId가 중복됐습니다.');
        }
        if (!Array.isArray(source.handles) || source.handles.length === 0) {
            throw new TypeError('actor transit handles는 비어 있지 않아야 합니다.');
        }
        const seen = new Set();
        const handles = Object.freeze(source.handles.map((handle, index) => {
            const exact = requireExactHandle(handle, `handles[${index}]`);
            const key = handleKey(exact);
            if (seen.has(key) || this.airborneHandles.has(key)) {
                throw new RangeError('actor transit handle이 중복됐습니다.');
            }
            seen.add(key);
            return exact;
        }));
        const startTick = requireNonNegativeInteger(source.startTick, 'startTick');
        const durationFixedTicks = requirePositiveInteger(
            source.durationFixedTicks,
            'durationFixedTicks'
        );
        const activationTick = computeActorTransitActivationTick(
            startTick,
            durationFixedTicks
        );
        if (source.activationTick !== undefined
            && requireNonNegativeInteger(
                source.activationTick,
                'activationTick'
            ) !== activationTick) {
            throw new RangeError('actor transit activation tick이 duration과 다릅니다.');
        }
        const subjectCount = requirePositiveInteger(
            source.subjectCount ?? handles.length,
            'subjectCount'
        );
        const copiesPerSubject = requirePositiveInteger(
            source.copiesPerSubject ?? 1,
            'copiesPerSubject'
        );
        if (subjectCount > Math.floor(0xffffffff / copiesPerSubject)
            || subjectCount * copiesPerSubject !== handles.length) {
            throw new RangeError('actor transit cardinality가 일관되지 않습니다.');
        }
        const modifierSetFingerprint = requireNonNegativeInteger(
            source.modifierSetFingerprint ?? 0,
            'modifierSetFingerprint'
        );
        const batch = Object.freeze({
            transactionId,
            completionOwner: requireNonEmptyString(
                source.completionOwner ?? 'actor-transit',
                'completionOwner'
            ),
            handles,
            subjectCount,
            destinationCount: handles.length,
            copiesPerSubject,
            modifierSetFingerprint,
            startTick,
            activationTick,
            durationFixedTicks,
            actionCode: requirePositiveInteger(source.actionCode, 'actionCode'),
            payloadCode: requirePositiveInteger(source.payloadCode, 'payloadCode'),
            executionOrdinal: requirePositiveInteger(
                source.executionOrdinal,
                'executionOrdinal'
            ),
            executionFingerprint: requirePositiveInteger(
                source.executionFingerprint,
                'executionFingerprint'
            ),
            actorActionProfileFingerprint: requirePositiveInteger(
                source.actorActionProfileFingerprint,
                'actorActionProfileFingerprint'
            ),
            placementFingerprint: requirePositiveInteger(
                source.placementFingerprint,
                'placementFingerprint'
            ),
            registeredAfterAggregateTick:
                this.latestAggregate?.sourceTick ?? 0
        });
        this.batches.set(transactionId, batch);
        for (const handle of handles) {
            this.airborneHandles.set(handleKey(handle), transactionId);
        }
        this.batchHighWater = Math.max(this.batchHighWater, this.batches.size);
        this.actorHighWater = Math.max(
            this.actorHighWater,
            this.airborneHandles.size
        );
        return true;
    }

    advanceForFixedTick(sourceTick) {
        const tick = requireNonNegativeInteger(sourceTick, 'sourceTick');
        if (this.destroyed || this.state !== 'ready') return false;
        try {
            const command = createGpuActorTransitCommandStorage({
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: this.deviceGeneration,
                authoritativeEpoch: this.authoritativeEpoch,
                sourceTick: tick,
                bodyCapacity: this.bodyCapacity
            });
            this.device.queue.writeBuffer(this.buffers.command, 0, command);
            const readback = this.#claimReadback(tick);
            const encoder = this.device.createCommandEncoder({
                label: `cirvivor-gpu-actor-transit-${tick}`
            });
            const pass = encoder.beginComputePass({
                label: `cirvivor-gpu-actor-transit-pass-${tick}`
            });
            pass.setBindGroup(0, this.bindGroup);
            pass.setPipeline(this.pipelines.initialize);
            pass.dispatchWorkgroups(1);
            pass.setPipeline(this.pipelines.advance);
            pass.dispatchWorkgroupsIndirect(this.buffers.dispatch, 0);
            pass.setPipeline(this.pipelines.seal);
            pass.dispatchWorkgroups(1);
            pass.end();
            if (readback) {
                encoder.copyBufferToBuffer(
                    this.buffers.aggregate,
                    0,
                    readback.buffer,
                    0,
                    GPU_ACTOR_TRANSIT_ABI.AGGREGATE.STRIDE
                );
            } else {
                this.deferredReadbackCount++;
            }
            this.device.queue.submit([encoder.finish()]);
            this.submittedCount++;
            if (readback) this.#beginReadback(readback);
            return true;
        } catch (error) {
            this.failure = captureFailure('actor-transit-submit', error);
            this.state = 'failed';
            return false;
        }
    }

    drainCompleted(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('actor transit completion output은 배열이어야 합니다.');
        }
        out.push(...this.completed);
        this.completed.length = 0;
        return out;
    }

    isAirborne(handle) {
        if (this.destroyed || !handle) return false;
        try {
            return this.airborneHandles.has(handleKey(requireExactHandle(
                handle,
                'handle'
            )));
        } catch {
            return false;
        }
    }

    cancelAll(reason = 'cancelled') {
        const cancellationReason = String(reason || 'cancelled');
        for (const batch of this.batches.values()) {
            this.completed.push(Object.freeze({
                ...batch,
                state: 'CANCELLED',
                reason: cancellationReason,
                landed: false,
                requiresRecovery: false
            }));
            this.cancelledBatchCount++;
        }
        this.batches.clear();
        this.airborneHandles.clear();
        return true;
    }

    requiresRecovery() {
        return this.state === 'failed' || this.failure !== null;
    }

    getStatus() {
        return Object.freeze({
            abiVersion: GPU_ACTOR_TRANSIT_ABI_VERSION,
            state: this.destroyed ? 'destroyed' : this.state,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: this.deviceGeneration,
            authoritativeEpoch: this.authoritativeEpoch,
            bodyCapacity: this.bodyCapacity,
            recordStride: GPU_ACTOR_TRANSIT_ABI.RECORD.STRIDE,
            storageBindingCount: GPU_ACTOR_TRANSIT_STORAGE_BINDING_COUNT,
            workgroupSize: GPU_ACTOR_TRANSIT_WORKGROUP_SIZE,
            dispatchModel: 'stable-slot-indirect-workgroups',
            aggregateReadbackByteSize: GPU_ACTOR_TRANSIT_ABI.AGGREGATE.STRIDE,
            readbackSlotCount: this.readbackSlotCount,
            pendingReadbackCount: this.readbacks.filter(
                (slot) => slot.inFlight
            ).length,
            activeBatchCount: this.batches.size,
            activeActorCount: this.airborneHandles.size,
            activeBatchHighWater: this.batchHighWater,
            activeActorHighWater: this.actorHighWater,
            landedActorCount: this.landedActorCount,
            cancelledBatchCount: this.cancelledBatchCount,
            submittedCount: this.submittedCount,
            completedReadbackCount: this.completedReadbackCount,
            deferredReadbackCount: this.deferredReadbackCount,
            latestAggregate: this.latestAggregate,
            failure: this.failure,
            requiresRecovery: this.requiresRecovery(),
            fullRecordReadbackCount: 0,
            perActorCpuAdvanceCount: 0
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.cancelAll('destroyed');
        this.destroyed = true;
        this.#retireResources('destroyed');
        this.completed.length = 0;
        this.state = 'destroyed';
    }

    #claimReadback(sourceTick) {
        for (let offset = 0; offset < this.readbacks.length; offset++) {
            const index = (this.readbackCursor + offset)
                % this.readbacks.length;
            const slot = this.readbacks[index];
            if (!slot.inFlight) {
                slot.inFlight = true;
                slot.sourceTick = sourceTick;
                slot.lease = this.resourceLease;
                this.readbackCursor = (index + 1) % this.readbacks.length;
                return slot;
            }
        }
        return null;
    }

    #releaseReadback(slot) {
        if (!slot) return;
        slot.inFlight = false;
        slot.sourceTick = 0;
    }

    #beginReadback(slot) {
        const lease = this.resourceLease;
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            const authentic = !this.destroyed
                && this.state === 'ready'
                && slot.inFlight
                && slot.lease === lease
                && lease === this.resourceLease;
            if (!authentic) {
                try { slot.buffer.unmap(); } catch { /* retired */ }
                this.#releaseReadback(slot);
                return;
            }
            try {
                const aggregate = readGpuActorTransitAggregate(
                    slot.buffer.getMappedRange().slice(0)
                );
                const exact = aggregate.sessionGeneration
                        === this.sessionGeneration
                    && aggregate.deviceGeneration === this.deviceGeneration
                    && aggregate.authoritativeEpoch === this.authoritativeEpoch
                    && aggregate.sourceTick === slot.sourceTick
                    && aggregate.bodyCapacity === this.bodyCapacity;
                if (!exact) {
                    throw new RangeError('actor transit aggregate provenance가 다릅니다.');
                }
                if (aggregate.status
                    !== GPU_ACTOR_TRANSIT_STATUS.COMPLETE) {
                    throw new RangeError(
                        `actor transit protocol rejected: flags=${aggregate.errorFlags}`
                    );
                }
                if (!this.latestAggregate
                    || aggregate.sourceTick > this.latestAggregate.sourceTick) {
                    this.latestAggregate = aggregate;
                    this.#settleBatches(aggregate);
                }
                this.completedReadbackCount++;
            } catch (error) {
                this.failure = captureFailure('actor-transit-readback', error);
                this.state = 'failed';
            } finally {
                try { slot.buffer.unmap(); } catch { /* retired */ }
                this.#releaseReadback(slot);
            }
        }).catch((error) => {
            if (slot.lease === this.resourceLease) {
                this.failure = captureFailure('actor-transit-map', error);
                this.state = 'failed';
            }
            this.#releaseReadback(slot);
        });
    }

    #settleBatches(aggregate) {
        for (const [transactionId, batch] of [...this.batches]) {
            if (batch.activationTick > aggregate.sourceTick
                || aggregate.sourceTick <= batch.registeredAfterAggregateTick
                || aggregate.processedCount < batch.handles.length
                || aggregate.activeRecordCount < batch.handles.length) {
                continue;
            }
            this.batches.delete(transactionId);
            for (const handle of batch.handles) {
                this.airborneHandles.delete(handleKey(handle));
            }
            this.landedActorCount += batch.handles.length;
            this.completed.push(Object.freeze({
                ...batch,
                state: 'LANDED',
                landed: true,
                completedFixedTick: aggregate.sourceTick,
                aggregateSourceTick: aggregate.sourceTick,
                requiresRecovery: false
            }));
        }
    }

    #retireResources(reason) {
        this.resourceLease++;
        this.cancelAll(reason);
        for (const slot of this.readbacks) {
            try { slot.buffer?.unmap?.(); } catch { /* not mapped */ }
            try { slot.buffer?.destroy?.(); } catch { /* retired */ }
        }
        this.readbacks = [];
        if (this.buffers) {
            for (const buffer of Object.values(this.buffers)) {
                try { buffer?.destroy?.(); } catch { /* retired */ }
            }
        }
        this.device = null;
        this.resources = null;
        this.buffers = null;
        this.pipelines = null;
        this.bindGroup = null;
        this.mapReadMode = null;
        this.latestAggregate = null;
        if (!this.destroyed) this.state = 'idle';
    }
}
