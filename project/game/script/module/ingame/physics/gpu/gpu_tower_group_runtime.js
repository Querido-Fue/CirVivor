import {
    GPU_TOWER_GROUP_ABI,
    GPU_TOWER_GROUP_ABI_VERSION,
    GPU_TOWER_GROUP_HARD_FAILURE_MASK,
    GPU_TOWER_GROUP_STORAGE_PROFILE,
    createGpuTowerGroupHostStorage,
    readGpuTowerGroupSummary,
    writeGpuTowerGroupCommand,
    writeGpuTowerGroupFixedParams,
    writeGpuTowerGroupRoster
} from './gpu_tower_group_abi.js';
import {
    GPU_TOWER_GROUP_CONTROL_WGSL,
    GPU_TOWER_GROUP_SUMMARY_WGSL
} from './gpu_tower_group_shaders.js';

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
            'TowerGroup sessionGeneration'
        ),
        deviceGeneration: requireNonNegativeInteger(
            source.deviceGeneration,
            'TowerGroup deviceGeneration'
        ),
        authoritativeEpoch: requireNonNegativeInteger(
            source.authoritativeEpoch,
            'TowerGroup authoritativeEpoch'
        )
    });
}

function sameProtocol(left, right) {
    return left?.sessionGeneration === right?.sessionGeneration
        && left?.deviceGeneration === right?.deviceGeneration
        && left?.authoritativeEpoch === right?.authoritativeEpoch;
}

function captureFailure(stage, error) {
    return Object.freeze({
        stage,
        name: String(error?.name ?? 'Error'),
        message: String(error?.message ?? error)
    });
}

function createInvalidSummary(protocol = null, reason = 'not-sampled') {
    return Object.freeze({
        valid: false,
        reason,
        abiVersion: GPU_TOWER_GROUP_ABI_VERSION,
        status: 0,
        sessionGeneration: protocol?.sessionGeneration ?? 0,
        deviceGeneration: protocol?.deviceGeneration ?? 0,
        authoritativeEpoch: protocol?.authoritativeEpoch ?? 0,
        sourceTick: 0,
        submittedTick: 0,
        groupRevision: 0,
        livingCount: 0,
        centroid: Object.freeze({ x: 0, y: 0 }),
        bounds: Object.freeze({ minX: 0, minY: 0, maxX: 0, maxY: 0 }),
        primaryHandle: null,
        primaryLogicalTowerOrdinal: 0xffffffff,
        livingShareUnits: 0,
        rosterFingerprint: 0,
        excludedMemberCount: 0
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
        || !Number.isSafeInteger(usage.UNIFORM)
        || !Number.isSafeInteger(usage.MAP_READ)
        || !Number.isSafeInteger(stage.COMPUTE)
        || !Number.isSafeInteger(mapMode.READ)) {
        throw new Error('TowerGroup runtime에 필요한 WebGPU 상수가 없습니다.');
    }
    return { usage, stage, mapMode };
}

function createBuffer(device, label, size, usage) {
    return device.createBuffer({ label, size: Math.max(4, size), usage });
}

function bufferResource(buffer) {
    return { buffer };
}

function createLayout(device, stage, label, entries) {
    const layout = device.createBindGroupLayout({ label, entries });
    return Object.freeze({
        layout,
        pipelineLayout: device.createPipelineLayout({
            label: `${label}-pipeline`,
            bindGroupLayouts: [layout]
        })
    });
}

function getPipelines(device, stage) {
    let cached = PIPELINES_BY_DEVICE.get(device);
    if (cached) return cached;
    const controlLayout = createLayout(
        device,
        stage,
        'cirvivor-gpu-tower-group-control-layout',
        [
            { binding: 0, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 1, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 3, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 4, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 5, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 6, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 7, visibility: stage.COMPUTE, buffer: { type: 'uniform' } }
        ]
    );
    const summaryLayout = createLayout(
        device,
        stage,
        'cirvivor-gpu-tower-group-summary-layout',
        [
            { binding: 0, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 1, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 3, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 4, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 5, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 6, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 7, visibility: stage.COMPUTE, buffer: { type: 'uniform' } }
        ]
    );
    const controlModule = device.createShaderModule({
        label: 'cirvivor-gpu-tower-group-control-shader',
        code: GPU_TOWER_GROUP_CONTROL_WGSL
    });
    const summaryModule = device.createShaderModule({
        label: 'cirvivor-gpu-tower-group-summary-shader',
        code: GPU_TOWER_GROUP_SUMMARY_WGSL
    });
    cached = Object.freeze({
        controlLayout: controlLayout.layout,
        summaryLayout: summaryLayout.layout,
        control: device.createComputePipeline({
            label: 'cirvivor-gpu-tower-group-control',
            layout: controlLayout.pipelineLayout,
            compute: { module: controlModule, entryPoint: 'broadcast_control' }
        }),
        summary: device.createComputePipeline({
            label: 'cirvivor-gpu-tower-group-summary',
            layout: summaryLayout.pipelineLayout,
            compute: { module: summaryModule, entryPoint: 'reduce_summary' }
        })
    });
    PIPELINES_BY_DEVICE.set(device, cached);
    return cached;
}

function destroyBuffer(buffer) {
    try { buffer?.destroy?.(); } catch { /* retired */ }
}

export class GpuTowerGroupRuntime {
    constructor(options = {}) {
        this.capacity = requirePositiveInteger(options.capacity, 'TowerGroup capacity');
        this.readbackSlotCount = requirePositiveInteger(
            options.readbackSlotCount ?? DEFAULT_READBACK_SLOT_COUNT,
            'TowerGroup readbackSlotCount'
        );
        this.host = createGpuTowerGroupHostStorage(this.capacity);
        this.device = null;
        this.protocol = null;
        this.resources = null;
        this.buffers = null;
        this.pipelines = null;
        this.bindGroups = null;
        this.mapReadMode = null;
        this.readbackSlots = [];
        this.readbackCursor = 0;
        this.resourceLease = 0;
        this.pendingReadbacks = 0;
        this.roster = null;
        this.stagedCommand = null;
        this.lastEncodedTick = 0;
        this.lastSubmittedTick = 0;
        this.lastCompletedTick = 0;
        this.groupCommandCount = 0;
        this.controlDispatchCount = 0;
        this.summaryDispatchCount = 0;
        this.droppedSummaryCount = 0;
        this.staleSummaryCount = 0;
        this.readbackFailureCount = 0;
        this.hardFailureStatus = 0;
        this.state = 'idle';
        this.failure = null;
        this.latestSummary = createInvalidSummary();
    }

    initialize(device, resources, protocolSource = {}) {
        if (!device || typeof device.createBuffer !== 'function'
            || !device.queue || typeof device.queue.writeBuffer !== 'function') {
            throw new TypeError('TowerGroup runtime에는 GPUDevice와 GPUQueue가 필요합니다.');
        }
        for (const key of ['counts', 'physics', 'simulation', 'bodyControlStates']) {
            if (!resources?.[key]) {
                throw new TypeError(`TowerGroup runtime ${key} buffer가 없습니다.`);
            }
        }
        const protocol = normalizeProtocol(protocolSource);
        const { usage, stage, mapMode } = requireGpuGlobals();
        const memberByteSize = this.capacity * GPU_TOWER_GROUP_ABI.MEMBER_STATE.STRIDE;
        const rosterByteSize = GPU_TOWER_GROUP_ABI.ROSTER_HEADER.STRIDE
            + (this.capacity * GPU_TOWER_GROUP_ABI.ROSTER_SLOT.STRIDE);
        const maximumByteSize = Math.max(memberByteSize, rosterByteSize);
        if (Number(device.limits?.maxStorageBuffersPerShaderStage ?? Infinity)
                < GPU_TOWER_GROUP_STORAGE_PROFILE.maximumStorageBuffersPerStage
            || maximumByteSize
                > Number(device.limits?.maxStorageBufferBindingSize ?? Infinity)
            || maximumByteSize > Number(device.limits?.maxBufferSize ?? Infinity)) {
            throw new RangeError('TowerGroup runtime buffer/storage limit가 부족합니다.');
        }
        this.retire('reinitialize');
        this.device = device;
        this.protocol = protocol;
        this.resources = resources;
        this.mapReadMode = mapMode.READ;
        this.pipelines = getPipelines(device, stage);
        this.buffers = {
            members: createBuffer(
                device,
                'cirvivor-gpu-tower-group-members',
                memberByteSize,
                usage.STORAGE | usage.COPY_DST
            ),
            roster: createBuffer(
                device,
                'cirvivor-gpu-tower-group-roster',
                rosterByteSize,
                usage.STORAGE | usage.COPY_DST
            ),
            command: createBuffer(
                device,
                'cirvivor-gpu-tower-group-command',
                GPU_TOWER_GROUP_ABI.COMMAND.STRIDE,
                usage.STORAGE | usage.COPY_DST
            ),
            fixedParams: createBuffer(
                device,
                'cirvivor-gpu-tower-group-fixed-params',
                GPU_TOWER_GROUP_ABI.FIXED_PARAMS.STRIDE,
                usage.UNIFORM | usage.COPY_DST
            ),
            summary: createBuffer(
                device,
                'cirvivor-gpu-tower-group-summary',
                GPU_TOWER_GROUP_ABI.SUMMARY.STRIDE,
                usage.STORAGE | usage.COPY_SRC | usage.COPY_DST
            )
        };
        this.bindGroups = {
            control: device.createBindGroup({
                label: 'cirvivor-gpu-tower-group-control-bind-group',
                layout: this.pipelines.controlLayout,
                entries: [
                    { binding: 0, resource: bufferResource(resources.counts) },
                    { binding: 1, resource: bufferResource(resources.physics) },
                    { binding: 2, resource: bufferResource(resources.simulation) },
                    { binding: 3, resource: bufferResource(resources.bodyControlStates) },
                    { binding: 4, resource: bufferResource(this.buffers.members) },
                    { binding: 5, resource: bufferResource(this.buffers.roster) },
                    { binding: 6, resource: bufferResource(this.buffers.command) },
                    { binding: 7, resource: bufferResource(this.buffers.fixedParams) }
                ]
            }),
            summary: device.createBindGroup({
                label: 'cirvivor-gpu-tower-group-summary-bind-group',
                layout: this.pipelines.summaryLayout,
                entries: [
                    { binding: 0, resource: bufferResource(resources.counts) },
                    { binding: 1, resource: bufferResource(resources.physics) },
                    { binding: 2, resource: bufferResource(resources.simulation) },
                    { binding: 3, resource: bufferResource(this.buffers.members) },
                    { binding: 4, resource: bufferResource(this.buffers.roster) },
                    { binding: 5, resource: bufferResource(this.buffers.command) },
                    { binding: 6, resource: bufferResource(this.buffers.summary) },
                    { binding: 7, resource: bufferResource(this.buffers.fixedParams) }
                ]
            })
        };
        const lease = ++this.resourceLease;
        this.readbackSlots = Array.from(
            { length: this.readbackSlotCount },
            (_, index) => ({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-tower-group-summary-readback-${index}`,
                    GPU_TOWER_GROUP_ABI.SUMMARY.STRIDE,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                lease,
                envelope: null
            })
        );
        this.readbackCursor = 0;
        this.pendingReadbacks = 0;
        this.roster = null;
        this.stagedCommand = null;
        this.lastEncodedTick = 0;
        this.lastSubmittedTick = 0;
        this.lastCompletedTick = 0;
        this.groupCommandCount = 0;
        this.controlDispatchCount = 0;
        this.summaryDispatchCount = 0;
        this.droppedSummaryCount = 0;
        this.staleSummaryCount = 0;
        this.readbackFailureCount = 0;
        this.hardFailureStatus = 0;
        this.failure = null;
        this.state = 'ready';
        this.latestSummary = createInvalidSummary(protocol, 'awaiting-summary');
        return true;
    }

    synchronizeRoster(source = {}) {
        this.#requireReady();
        const protocol = normalizeProtocol(source.protocol ?? this.protocol);
        if (!sameProtocol(protocol, this.protocol)) {
            throw new Error('TowerGroup roster protocol이 runtime generation과 다릅니다.');
        }
        const roster = writeGpuTowerGroupRoster(this.host, {
            ...source,
            protocol
        });
        this.device.queue.writeBuffer(
            this.buffers.members,
            0,
            this.host.memberStates
        );
        this.device.queue.writeBuffer(this.buffers.roster, 0, this.host.roster);
        this.roster = roster;
        return roster;
    }

    stageCommand(source = {}) {
        this.#requireReady();
        if (!this.roster) {
            throw new Error('TowerGroup command 전에 roster 동기화가 필요합니다.');
        }
        const protocol = normalizeProtocol(source.protocol ?? this.protocol);
        if (!sameProtocol(protocol, this.protocol)) {
            throw new Error('TowerGroup command protocol이 runtime generation과 다릅니다.');
        }
        const sourceTick = requirePositiveInteger(source.sourceTick, 'TowerGroup sourceTick');
        if (sourceTick <= this.lastEncodedTick
            || (this.stagedCommand
                && this.stagedCommand.sourceTick > this.lastEncodedTick)) {
            throw new Error(`TowerGroup fixed tick ${sourceTick} command는 정확히 한 번만 stage할 수 있습니다.`);
        }
        const command = writeGpuTowerGroupCommand(this.host, {
            ...source,
            protocol,
            sourceTick,
            groupRevision: this.roster.groupRevision,
            rosterFingerprint: this.roster.fingerprint
        });
        writeGpuTowerGroupFixedParams(this.host, { protocol, sourceTick });
        this.device.queue.writeBuffer(this.buffers.command, 0, this.host.command);
        this.device.queue.writeBuffer(
            this.buffers.fixedParams,
            0,
            this.host.fixedParams
        );
        this.stagedCommand = command;
        this.groupCommandCount++;
        return command;
    }

    encodeControl(pass, sourceTick) {
        this.#requireReady();
        const tick = requirePositiveInteger(sourceTick, 'TowerGroup encode sourceTick');
        if (!pass || typeof pass.setPipeline !== 'function'
            || this.stagedCommand?.sourceTick !== tick
            || this.lastEncodedTick >= tick) {
            throw new Error('TowerGroup control encode 순서가 유효하지 않습니다.');
        }
        pass.setPipeline(this.pipelines.control);
        pass.setBindGroup(0, this.bindGroups.control);
        pass.dispatchWorkgroups(1);
        this.lastEncodedTick = tick;
        this.controlDispatchCount++;
        return true;
    }

    submitSummary(source = {}) {
        this.#requireReady();
        const sourceTick = requirePositiveInteger(source.sourceTick, 'summary sourceTick');
        const submittedTick = requirePositiveInteger(
            source.submittedTick ?? sourceTick,
            'summary submittedTick'
        );
        if (this.lastEncodedTick !== sourceTick
            || this.stagedCommand?.sourceTick !== sourceTick) {
            throw new Error('TowerGroup summary는 control이 encode된 같은 tick만 제출할 수 있습니다.');
        }
        let slot = null;
        for (let offset = 0; offset < this.readbackSlots.length; offset++) {
            const index = (this.readbackCursor + offset) % this.readbackSlots.length;
            if (!this.readbackSlots[index].inFlight) {
                slot = this.readbackSlots[index];
                this.readbackCursor = (index + 1) % this.readbackSlots.length;
                break;
            }
        }
        if (!slot) {
            this.droppedSummaryCount++;
            this.lastSubmittedTick = Math.max(this.lastSubmittedTick, submittedTick);
            return false;
        }
        const envelope = Object.freeze({
            sourceTick,
            submittedTick,
            groupRevision: this.roster.groupRevision,
            rosterFingerprint: this.roster.fingerprint,
            ...this.protocol,
            resourceLease: this.resourceLease
        });
        slot.inFlight = true;
        slot.lease = this.resourceLease;
        slot.envelope = envelope;
        this.pendingReadbacks++;
        try {
            const encoder = this.device.createCommandEncoder({
                label: 'cirvivor-gpu-tower-group-summary-encoder'
            });
            const pass = encoder.beginComputePass({
                label: 'cirvivor-gpu-tower-group-summary-pass'
            });
            pass.setPipeline(this.pipelines.summary);
            pass.setBindGroup(0, this.bindGroups.summary);
            pass.dispatchWorkgroups(1);
            pass.end();
            encoder.copyBufferToBuffer(
                this.buffers.summary,
                0,
                slot.buffer,
                0,
                GPU_TOWER_GROUP_ABI.SUMMARY.STRIDE
            );
            this.device.queue.submit([encoder.finish()]);
            this.summaryDispatchCount++;
            this.lastSubmittedTick = Math.max(this.lastSubmittedTick, submittedTick);
            this.#beginReadback(slot);
            return true;
        } catch (error) {
            this.failure = captureFailure('tower-group-summary-submit', error);
            this.readbackFailureCount++;
            this.#releaseSlot(slot);
            return false;
        }
    }

    getLatestSummary() {
        return this.latestSummary;
    }

    getStagedCommand() {
        return this.stagedCommand;
    }

    getStatus() {
        return Object.freeze({
            state: this.state,
            failure: this.failure,
            abiVersion: GPU_TOWER_GROUP_ABI_VERSION,
            sessionGeneration: this.protocol?.sessionGeneration ?? 0,
            deviceGeneration: this.protocol?.deviceGeneration ?? 0,
            authoritativeEpoch: this.protocol?.authoritativeEpoch ?? 0,
            capacity: this.capacity,
            rosterMemberCount: this.roster?.memberCount ?? 0,
            groupRevision: this.roster?.groupRevision ?? 0,
            rosterFingerprint: this.roster?.fingerprint ?? 0,
            pendingReadbacks: this.pendingReadbacks,
            readbackSlotCount: this.readbackSlotCount,
            groupCommandCount: this.groupCommandCount,
            perTowerCpuCommandCount: 0,
            controlDispatchCount: this.controlDispatchCount,
            summaryDispatchCount: this.summaryDispatchCount,
            droppedSummaryCount: this.droppedSummaryCount,
            staleSummaryCount: this.staleSummaryCount,
            readbackFailureCount: this.readbackFailureCount,
            lastEncodedTick: this.lastEncodedTick,
            lastSubmittedTick: this.lastSubmittedTick,
            lastCompletedTick: this.lastCompletedTick,
            hardFailureStatus: this.hardFailureStatus,
            summaryReadbackBytes: GPU_TOWER_GROUP_ABI.SUMMARY.STRIDE,
            fullBodyReadbackCount: 0,
            gameplayAuthority: false,
            backpressurePolicy: 'drop-summary',
            storageProfile: GPU_TOWER_GROUP_STORAGE_PROFILE
        });
    }

    requiresRecovery() {
        return this.state === 'failed'
            || (this.hardFailureStatus & GPU_TOWER_GROUP_HARD_FAILURE_MASK) !== 0;
    }

    retire(reason = 'resource-retired') {
        this.resourceLease++;
        for (const slot of this.readbackSlots) {
            slot.inFlight = false;
            slot.envelope = null;
            try { slot.buffer?.unmap?.(); } catch { /* not mapped */ }
            destroyBuffer(slot.buffer);
        }
        this.readbackSlots = [];
        this.pendingReadbacks = 0;
        if (this.buffers) {
            for (const buffer of Object.values(this.buffers)) destroyBuffer(buffer);
        }
        const protocol = this.protocol;
        this.device = null;
        this.protocol = null;
        this.resources = null;
        this.buffers = null;
        this.pipelines = null;
        this.bindGroups = null;
        this.mapReadMode = null;
        this.roster = null;
        this.stagedCommand = null;
        this.state = 'idle';
        this.latestSummary = createInvalidSummary(protocol, reason);
    }

    destroy() {
        this.retire('destroyed');
    }

    #beginReadback(slot) {
        const envelope = slot.envelope;
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            const authentic = this.state === 'ready'
                && slot.inFlight
                && slot.lease === this.resourceLease
                && envelope.resourceLease === this.resourceLease
                && sameProtocol(envelope, this.protocol);
            if (!authentic) {
                try { slot.buffer.unmap(); } catch { /* retired */ }
                this.#releaseSlot(slot);
                return;
            }
            try {
                const mapped = slot.buffer.getMappedRange();
                const summary = readGpuTowerGroupSummary(mapped);
                const provenanceMatches = summary.abiVersion === GPU_TOWER_GROUP_ABI_VERSION
                    && sameProtocol(summary, envelope)
                    && summary.sourceTick === envelope.sourceTick
                    && summary.groupRevision === envelope.groupRevision
                    && summary.rosterFingerprint === envelope.rosterFingerprint;
                if (!provenanceMatches) {
                    this.staleSummaryCount++;
                    return;
                }
                if (summary.status !== 0) {
                    this.hardFailureStatus |= summary.status;
                    this.state = 'failed';
                    this.failure = captureFailure(
                        'tower-group-summary-status',
                        new Error(`status=${summary.status}`)
                    );
                    return;
                }
                if (envelope.submittedTick < this.lastCompletedTick) {
                    this.staleSummaryCount++;
                    return;
                }
                this.latestSummary = Object.freeze({
                    valid: true,
                    reason: null,
                    ...summary,
                    submittedTick: envelope.submittedTick
                });
                this.lastCompletedTick = envelope.submittedTick;
            } catch (error) {
                this.readbackFailureCount++;
                this.failure = captureFailure('tower-group-summary-readback', error);
            } finally {
                slot.buffer.unmap();
                this.#releaseSlot(slot);
            }
        }).catch((error) => {
            const authentic = slot.lease === this.resourceLease
                && envelope.resourceLease === this.resourceLease;
            if (authentic) {
                this.readbackFailureCount++;
                this.failure = captureFailure('tower-group-summary-map', error);
            }
            this.#releaseSlot(slot);
        });
    }

    #releaseSlot(slot) {
        if (!slot?.inFlight) return;
        slot.inFlight = false;
        slot.envelope = null;
        this.pendingReadbacks = Math.max(0, this.pendingReadbacks - 1);
    }

    #requireReady() {
        if (this.state !== 'ready' || !this.device || !this.buffers) {
            throw new Error('TowerGroup runtime이 ready 상태가 아닙니다.');
        }
    }
}

export { createInvalidSummary as createInvalidGpuTowerGroupSummary };
