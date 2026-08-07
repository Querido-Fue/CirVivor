import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { GpuCircleBodySimulation } = await loadGameModule(
    'ingame/physics/gpu/gpu_circle_body_simulation.js'
);
const {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_RENDER_SHAPE,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    GPU_CIRCLE_APPLIED_EVENT_TYPE,
    GPU_CIRCLE_APPLIED_EVENT_FLAG,
    packGpuCircleAppliedEventMeta
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');
const {
    GPU_FIXED_PRIMITIVE_ABI,
    GPU_SPAWN_PROGRAM_MODE,
    GPU_SPAWN_PROGRAM_RESULT
} = await loadGameModule('ingame/physics/gpu/gpu_fixed_primitive_abi.js');
const gameModuleGlobal = GpuCircleBodySimulation.constructor('return globalThis')();
const { createTileMap } = await loadGameModule('ingame/map/tile_map.js');
const { createRouteFlowFieldAtlas } = await loadGameModule(
    'ingame/navigation/route_flow_field_atlas.js'
);

function createUnavailablePlatformPort() {
    return {
        getState: () => ({ status: 'unsupported' }),
        getDevice: () => null,
        getCanvasFormat: () => null,
        getDeviceGeneration: () => 0,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    };
}

function createBody(x) {
    return {
        position: { x, y: 2 },
        velocity: { x: 1, y: 0 },
        radius: 0.25,
        inverseMass: 1,
        bodyLayer: 1,
        collisionMask: 1,
        interactionLayer: 1,
        interactionMask: 0,
        alive: true
    };
}

function createSourceRelativeSpawn({
    sourceEntityId = 1,
    sourceIncarnation = 1,
    destinationEntityId,
    destinationIncarnation = 1,
    modeFlags = GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY
}) {
    const isAimPoint = modeFlags
        === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT;
    return {
        sourceHandle: {
            entityId: sourceEntityId,
            incarnation: sourceIncarnation
        },
        destinationHandle: {
            entityId: destinationEntityId,
            incarnation: destinationIncarnation
        },
        destinationSpawn: {
            ...createBody(0),
            radius: 0.1,
            inverseMass: 1
        },
        modeFlags,
        positionOffset: { x: 0.25, y: -0.5 },
        ...(isAimPoint ? {
            aimWorldPoint: { x: 7, y: -3 },
            launchSpeed: 18
        } : {
            launchVelocity: { x: 4, y: 1 },
            sourceVelocityScale: 0.5
        })
    };
}

function createFlowFieldAtlasFixture({
    goalPosition = { x: 0.25, y: 0.75 },
    atlasTransitionRadius,
    stageTransitionRadius
} = {}) {
    const atlas = {
        cols: 1,
        rows: 1,
        fieldCount: 1,
        origin: { x: 0, y: 0 },
        cellSize: { x: 2, y: 4 },
        directions: new gameModuleGlobal.Float32Array([0, 0]),
        stages: [{
            goalCell: { column: 0, row: 0 },
            goalPosition,
            nextFieldIndex: -1,
            ...(stageTransitionRadius === undefined
                ? {}
                : { transitionRadius: stageTransitionRadius })
        }]
    };
    if (atlasTransitionRadius !== undefined) {
        atlas.transitionRadius = atlasTransitionRadius;
    }
    return atlas;
}

function installFakeWebGpuGlobals() {
    const previous = {
        GPUBufferUsage: gameModuleGlobal.GPUBufferUsage,
        GPUTextureUsage: gameModuleGlobal.GPUTextureUsage,
        GPUShaderStage: gameModuleGlobal.GPUShaderStage,
        GPUMapMode: gameModuleGlobal.GPUMapMode
    };
    gameModuleGlobal.GPUBufferUsage = {
        STORAGE: 1 << 0,
        COPY_DST: 1 << 1,
        COPY_SRC: 1 << 2,
        UNIFORM: 1 << 3,
        INDIRECT: 1 << 4,
        MAP_READ: 1 << 5
    };
    gameModuleGlobal.GPUTextureUsage = { TEXTURE_BINDING: 1 << 0, COPY_DST: 1 << 1 };
    gameModuleGlobal.GPUShaderStage = { COMPUTE: 1 << 0, VERTEX: 1 << 1 };
    gameModuleGlobal.GPUMapMode = { READ: 1 };
    return () => {
        for (const [name, value] of Object.entries(previous)) {
            if (value === undefined) {
                delete gameModuleGlobal[name];
            } else {
                gameModuleGlobal[name] = value;
            }
        }
    };
}

class FakeGpuBuffer {
    constructor(device, descriptor) {
        this.device = device;
        this.label = descriptor.label;
        this.size = descriptor.size;
        this.data = new gameModuleGlobal.ArrayBuffer(descriptor.size);
        this.destroyed = false;
        this.mapped = false;
    }

    mapAsync() {
        if (this.label.includes('event-readback')) {
            return new Promise((resolve, reject) => {
                this.device.eventMapRequests.push({
                    buffer: this,
                    resolved: false,
                    resolve: () => {
                        this.mapped = true;
                        resolve();
                    },
                    reject
                });
            });
        }
        if (this.label.includes('spawn-program-readback')
            && this.device.deferSpawnProgramMaps) {
            return new Promise((resolve, reject) => {
                this.device.spawnProgramMapRequests.push({
                    buffer: this,
                    resolved: false,
                    resolve: () => {
                        this.mapped = true;
                        resolve();
                    },
                    reject
                });
            });
        }
        if (this.label.includes('tracked-pose-readback')
            && this.device.deferTrackedPoseMaps) {
            return new Promise((resolve, reject) => {
                this.device.trackedPoseMapRequests.push({
                    buffer: this,
                    resolved: false,
                    resolve: () => {
                        this.mapped = true;
                        resolve();
                    },
                    reject
                });
            });
        }
        if (this.label.includes('overflow-readback') && this.device.deferOverflowMaps) {
            return new Promise((resolve, reject) => {
                this.device.overflowMapRequests.push({
                    buffer: this,
                    resolved: false,
                    resolve: () => {
                        this.mapped = true;
                        resolve();
                    },
                    reject
                });
            });
        }
        this.mapped = true;
        return Promise.resolve();
    }

    getMappedRange() {
        return this.data;
    }

    unmap() {
        this.mapped = false;
    }

    destroy() {
        this.destroyed = true;
    }
}

class FakeGpuDevice {
    constructor() {
        this.limits = {
            maxStorageBufferBindingSize: 1 << 28,
            maxStorageBuffersPerShaderStage: 9,
            maxBufferSize: 1 << 29,
            maxComputeWorkgroupsPerDimension: 65535,
            maxUniformBufferBindingSize: 65536,
            maxTextureDimension2D: 16384,
            maxTextureArrayLayers: 256
        };
        this.buffers = new Map();
        this.bindGroupLayouts = new Map();
        this.pipelineLayouts = new Map();
        this.bindGroups = new Map();
        this.computePasses = [];
        this.commandEncoderDescriptors = [];
        this.renderPasses = [];
        this.finishCount = 0;
        this.submissions = [];
        this.eventPayloads = [];
        this.eventPayloadCursor = 0;
        this.eventMapRequests = [];
        this.deferSpawnProgramMaps = false;
        this.spawnProgramMapRequests = [];
        this.spawnProgramResultPayloads = [];
        this.spawnProgramResultCursor = 0;
        this.deferTrackedPoseMaps = false;
        this.trackedPoseMapRequests = [];
        this.trackedPosePayloads = [];
        this.trackedPosePayloadCursor = 0;
        this.deferOverflowMaps = false;
        this.overflowMapRequests = [];
        this.bufferCopies = [];
        this.queue = {
            writeBuffer: (buffer, targetOffset, source, sourceOffset = 0, size) => {
                const sourceBytes = ArrayBuffer.isView(source)
                    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
                    : new Uint8Array(source);
                const byteSize = size ?? (sourceBytes.byteLength - sourceOffset);
                new Uint8Array(buffer.data, targetOffset, byteSize).set(
                    sourceBytes.subarray(sourceOffset, sourceOffset + byteSize)
                );
            },
            writeTexture: () => {},
            submit: (commandBuffers) => {
                this.submissions.push(commandBuffers);
            }
        };
    }

    createBuffer(descriptor) {
        const buffer = new FakeGpuBuffer(this, descriptor);
        this.buffers.set(descriptor.label, buffer);
        return buffer;
    }

    createTexture() {
        return {
            createView: () => ({}),
            destroy: () => {}
        };
    }

    createBindGroupLayout(descriptor) {
        this.bindGroupLayouts.set(descriptor.label, descriptor);
        return descriptor;
    }

    createPipelineLayout(descriptor) {
        this.pipelineLayouts.set(descriptor.label, descriptor);
        return descriptor;
    }

    createShaderModule(descriptor) {
        return descriptor;
    }

    createComputePipeline(descriptor) {
        return {
            label: descriptor.label,
            entryPoint: descriptor.compute.entryPoint,
            layout: descriptor.layout
        };
    }

    createRenderPipeline(descriptor) {
        return descriptor;
    }

    createBindGroup(descriptor) {
        this.bindGroups.set(descriptor.label, descriptor);
        return descriptor;
    }

    createCommandEncoder(descriptor = {}) {
        const device = this;
        this.commandEncoderDescriptors.push(descriptor);
        return {
            beginComputePass() {
                const operations = [];
                let currentEntryPoint = null;
                let currentPipeline = null;
                const currentBindGroups = [];
                device.computePasses.push(operations);
                const captureOperation = (mode, workgroups = null) => {
                    const bindGroupCount = currentPipeline.layout.bindGroupLayouts.length;
                    operations.push({
                        entryPoint: currentEntryPoint,
                        mode,
                        ...(workgroups === null ? {} : { workgroups }),
                        pipelineLayout: currentPipeline.layout.label,
                        bindGroups: currentBindGroups
                            .slice(0, bindGroupCount)
                            .map((bindGroup) => bindGroup?.label ?? null)
                    });
                };
                return {
                    setBindGroup(index, bindGroup) {
                        currentBindGroups[index] = bindGroup;
                    },
                    setPipeline(pipeline) {
                        currentPipeline = pipeline;
                        currentEntryPoint = pipeline.entryPoint;
                    },
                    dispatchWorkgroups(workgroups) {
                        captureOperation('direct', workgroups);
                    },
                    dispatchWorkgroupsIndirect() {
                        captureOperation('indirect');
                    },
                    end: () => {}
                };
            },
            beginRenderPass(renderDescriptor) {
                const operations = [];
                const renderPass = { descriptor: renderDescriptor, operations };
                device.renderPasses.push(renderPass);
                return {
                    setPipeline(pipeline) {
                        operations.push({ type: 'pipeline', value: pipeline });
                    },
                    setBindGroup(index, bindGroup) {
                        operations.push({ type: 'bind-group', index, value: bindGroup });
                    },
                    drawIndirect(buffer, offset) {
                        operations.push({ type: 'draw-indirect', buffer, offset });
                    },
                    end() {
                        operations.push({ type: 'end' });
                    }
                };
            },
            copyBufferToBuffer(source, sourceOffset, target, targetOffset, size) {
                device.bufferCopies.push({
                    sourceLabel: source.label,
                    sourceOffset,
                    targetLabel: target.label,
                    targetOffset,
                    size
                });
                if (target.label.includes('event-readback')) {
                    device.#writeEventReadbackCopy(
                        source,
                        sourceOffset,
                        target,
                        targetOffset,
                        size
                    );
                    return;
                }
                new Uint8Array(target.data, targetOffset, size).set(
                    new Uint8Array(source.data, sourceOffset, size)
                );
                if (target.label.includes('spawn-program-readback')) {
                    device.#writeSpawnProgramResult(target);
                }
                if (target.label.includes('tracked-pose-readback')) {
                    device.#writeTrackedPosePayload(target);
                }
            },
            finish() {
                device.finishCount += 1;
                return { id: `command-buffer:${device.finishCount}` };
            }
        };
    }

    resolveEventMap(index) {
        const request = this.eventMapRequests[index];
        assert.ok(request, `event map request ${index}`);
        if (!request.resolved) {
            request.resolved = true;
            request.resolve();
        }
    }

    pendingEventMapIndices() {
        const result = [];
        for (let index = 0; index < this.eventMapRequests.length; index++) {
            if (!this.eventMapRequests[index].resolved) {
                result.push(index);
            }
        }
        return result;
    }

    resolveSpawnProgramMap(index) {
        const request = this.spawnProgramMapRequests[index];
        assert.ok(request, `spawn program map request ${index}`);
        if (!request.resolved) {
            request.resolved = true;
            request.resolve();
        }
    }

    pendingSpawnProgramMapIndices() {
        const result = [];
        for (let index = 0; index < this.spawnProgramMapRequests.length; index++) {
            if (!this.spawnProgramMapRequests[index].resolved) {
                result.push(index);
            }
        }
        return result;
    }

    resolveTrackedPoseMap(index) {
        const request = this.trackedPoseMapRequests[index];
        assert.ok(request, `tracked pose map request ${index}`);
        if (!request.resolved) {
            request.resolved = true;
            request.resolve();
        }
    }

    pendingTrackedPoseMapIndices() {
        const result = [];
        for (let index = 0; index < this.trackedPoseMapRequests.length; index++) {
            if (!this.trackedPoseMapRequests[index].resolved) {
                result.push(index);
            }
        }
        return result;
    }

    resolveOverflowMap(index) {
        const request = this.overflowMapRequests[index];
        assert.ok(request, `overflow map request ${index}`);
        if (!request.resolved) {
            request.resolved = true;
            request.resolve();
        }
    }

    pendingOverflowMapIndices() {
        const result = [];
        for (let index = 0; index < this.overflowMapRequests.length; index++) {
            if (!this.overflowMapRequests[index].resolved) {
                result.push(index);
            }
        }
        return result;
    }

    #writeEventReadbackCopy(source, sourceOffset, target, targetOffset, size) {
        if (source.label.includes('body-control-program')) {
            new Uint8Array(target.data, targetOffset, size).set(
                new Uint8Array(source.data, sourceOffset, size)
            );
            return;
        }
        if (source.label.includes('contact-state')) {
            const payload = this.eventPayloads[this.eventPayloadCursor++] ?? {};
            target.eventPayload = payload;
            new Uint8Array(target.data).fill(0);
            const view = new DataView(target.data);
            view.setUint32(0, payload.contactCount ?? 0, true);
            view.setUint32(4, payload.contactOverflow ?? 0, true);
            view.setUint32(8, payload.applied?.length ?? 0, true);
            view.setUint32(12, payload.appliedOverflow ?? 0, true);
            view.setUint32(16, payload.deaths?.length ?? 0, true);
            view.setUint32(20, payload.deathOverflow ?? 0, true);
            view.setUint32(24, payload.abiStatus ?? 1, true);
            view.setUint32(
                28,
                payload.eventEncodingVersion ?? GPU_CIRCLE_BODY_ABI_VERSION,
                true
            );
            return;
        }
        const payload = target.eventPayload ?? {};
        const view = new DataView(target.data);
        if (source.label.includes('applied-events')) {
            for (let index = 0; index < (payload.applied?.length ?? 0); index++) {
                const event = payload.applied[index];
                const offset = targetOffset + (index * 32);
                view.setUint32(offset, event.entityId, true);
                view.setUint32(offset + 4, event.incarnation, true);
                view.setUint32(offset + 8, event.otherEntityId, true);
                view.setUint32(offset + 12, event.otherIncarnation, true);
                view.setInt32(
                    offset + 16,
                    event.valueFixedPoint ?? event.damageFixedPoint ?? 0,
                    true
                );
                view.setUint32(offset + 20, event.eventMeta ?? 0, true);
                view.setFloat32(offset + 24, event.x ?? 0, true);
                view.setFloat32(offset + 28, event.y ?? 0, true);
            }
            return;
        }
        if (source.label.includes('death-events')) {
            for (let index = 0; index < (payload.deaths?.length ?? 0); index++) {
                const event = payload.deaths[index];
                const offset = targetOffset + (index * 16);
                view.setUint32(offset, event.entityId, true);
                view.setUint32(offset + 4, event.incarnation, true);
                view.setUint32(offset + 8, event.bodyId, true);
                view.setUint32(offset + 12, event.flags ?? 0, true);
            }
        }
    }

    #writeSpawnProgramResult(target) {
        const payload = this.spawnProgramResultPayloads[
            this.spawnProgramResultCursor++
        ];
        if (payload === undefined) {
            return;
        }
        const view = new DataView(target.data);
        const count = view.getUint32(
            GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.COUNT,
            true
        );
        const results = Array.isArray(payload)
            ? payload
            : Array.from({ length: count }, () => payload);
        assert.equal(results.length, count);
        for (let index = 0; index < count; index++) {
            const offset = GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STRIDE
                + (index * GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.STRIDE)
                + GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.RESULT;
            view.setUint32(offset, results[index], true);
        }
    }

    #writeTrackedPosePayload(target) {
        const payload = this.trackedPosePayloads[this.trackedPosePayloadCursor++];
        if (!payload) {
            return;
        }
        const abi = GPU_FIXED_PRIMITIVE_ABI.TRACKED_POSE_RECORD;
        const view = new DataView(target.data);
        view.setFloat32(abi.POSITION_X, payload.position.x, true);
        view.setFloat32(abi.POSITION_Y, payload.position.y, true);
        view.setFloat32(abi.VELOCITY_X, payload.velocity.x, true);
        view.setFloat32(abi.VELOCITY_Y, payload.velocity.y, true);
        view.setFloat32(abi.PREVIOUS_POSITION_X, payload.previousPosition.x, true);
        view.setFloat32(abi.PREVIOUS_POSITION_Y, payload.previousPosition.y, true);
        view.setUint32(abi.ENTITY_ID, payload.entityId, true);
        view.setUint32(abi.INCARNATION, payload.incarnation, true);
    }
}

function createFakePlatformPort(device) {
    return {
        getState: () => ({ status: 'ready' }),
        getDevice: () => device,
        getCanvasFormat: () => 'rgba8unorm',
        getDeviceGeneration: () => 1,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    };
}

function createPresentationPlatform(device, composerPort = null) {
    const records = {
        acquireFrameTargetCount: 0,
        clearCanvasCount: 0,
        markCanvasDrawnCount: 0,
        markCanvasClearedCount: 0
    };
    const port = {
        getState: () => ({ status: 'ready' }),
        getDevice: () => device,
        getCanvasFormat: () => 'rgba8unorm',
        getDeviceGeneration: () => 1,
        getFrameComposer: () => composerPort,
        acquireFrameTarget() {
            records.acquireFrameTargetCount += 1;
            return {
                device,
                deviceGeneration: 1,
                format: 'rgba8unorm',
                view: { id: `legacy-view:${records.acquireFrameTargetCount}` },
                width: 640,
                height: 360
            };
        },
        clearCanvas() {
            records.clearCanvasCount += 1;
            return true;
        },
        markCanvasDrawn() {
            records.markCanvasDrawnCount += 1;
            return true;
        },
        markCanvasCleared() {
            records.markCanvasClearedCount += 1;
            return true;
        }
    };
    return { port, records };
}

function createFrameComposerHarness(device, overrides = {}) {
    const records = {
        encodeCanvasPassCount: 0,
        clearCanvasCount: 0,
        deferredCallbackCount: 0,
        renderPasses: []
    };
    let active = true;
    let callbacks = [];
    let clearResult = true;
    let contextOverrides = { ...overrides };

    function abortCallbacks(reason) {
        const pending = callbacks;
        callbacks = [];
        active = false;
        for (const entry of pending) {
            entry.aborted?.({ reason });
        }
    }

    const port = Object.freeze({
        isFrameActive: () => active,
        deferFrameCallbacks(entry) {
            if (!active) return false;
            records.deferredCallbackCount += 1;
            callbacks.push(entry);
            return true;
        },
        encodeCanvasPass(callback) {
            if (!active) return false;
            records.encodeCanvasPassCount += 1;
            const operations = [];
            const pass = {
                setPipeline(pipeline) {
                    operations.push({ type: 'pipeline', value: pipeline });
                },
                setBindGroup(index, bindGroup) {
                    operations.push({ type: 'bind-group', index, value: bindGroup });
                },
                drawIndirect(buffer, offset) {
                    operations.push({ type: 'draw-indirect', buffer, offset });
                }
            };
            records.renderPasses.push({ operations });
            const generation = contextOverrides.deviceGeneration ?? 1;
            const format = contextOverrides.format ?? 'rgba8unorm';
            const contextDevice = contextOverrides.device ?? device;
            const context = {
                frameId: contextOverrides.frameId ?? 1,
                device: contextDevice,
                deviceGeneration: generation,
                encoder: {},
                target: {
                    device: contextOverrides.targetDevice ?? contextDevice,
                    deviceGeneration:
                        contextOverrides.targetGeneration ?? generation,
                    format: contextOverrides.targetFormat ?? format
                },
                format,
                width: contextOverrides.width ?? 800,
                height: contextOverrides.height ?? 450
            };
            try {
                callback(pass, context);
                return true;
            } catch {
                abortCallbacks('encode-failed');
                return false;
            }
        },
        clearCanvas() {
            if (!active || !clearResult) return false;
            records.clearCanvasCount += 1;
            return true;
        }
    });

    return {
        port,
        records,
        begin(nextOverrides = {}) {
            assert.equal(active, false, '이전 composer frame을 먼저 종료해야 합니다.');
            active = true;
            callbacks = [];
            contextOverrides = { ...nextOverrides };
        },
        commit() {
            assert.equal(active, true);
            const pending = callbacks;
            callbacks = [];
            active = false;
            for (const entry of pending) {
                entry.committed?.({ submitted: true });
            }
        },
        abort(reason = 'test-abort') {
            assert.equal(active, true);
            abortCallbacks(reason);
        },
        setClearResult(value) {
            clearResult = value;
        }
    };
}

function createCamera() {
    return {
        worldToViewport(x, y, out) {
            out.x = x + 12;
            out.y = y + 34;
            return out;
        },
        getScale: () => 2
    };
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

test('활성 composer draw/clear는 direct submit 없이 commit 뒤에만 canvas 상태를 바꾼다', () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    const composer = createFrameComposerHarness(device);
    const platform = createPresentationPlatform(device, composer.port);
    const simulation = new GpuCircleBodySimulation(platform.port, {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        assert.equal(simulation.replaceBodies([createBody(1)]).accepted, 1);
        const encoderCountBeforeDraw = device.commandEncoderDescriptors.length;
        const submitCountBeforeDraw = device.submissions.length;
        assert.equal(simulation.draw(createCamera()), true);
        assert.equal(simulation.draw(createCamera()), true, '같은 frame의 draw는 coalesce됩니다.');
        assert.equal(composer.records.encodeCanvasPassCount, 1);
        assert.equal(composer.records.deferredCallbackCount, 1);
        assert.equal(device.commandEncoderDescriptors.length, encoderCountBeforeDraw);
        assert.equal(device.submissions.length, submitCountBeforeDraw);
        assert.equal(platform.records.acquireFrameTargetCount, 0);
        assert.equal(platform.records.markCanvasDrawnCount, 0);
        assert.equal(platform.records.markCanvasClearedCount, 0);
        assert.equal(simulation.canvasHasDrawnBodies, false);
        assert.deepEqual(
            composer.records.renderPasses[0].operations.map((operation) => (
                operation.type === 'bind-group'
                    ? `${operation.type}:${operation.index}`
                    : operation.type
            )),
            ['pipeline', 'bind-group:0', 'bind-group:1', 'draw-indirect']
        );
        const renderParams = new DataView(
            device.buffers.get('cirvivor-gpu-circle-render-params').data
        );
        assert.equal(renderParams.getFloat32(8, true), 800);
        assert.equal(renderParams.getFloat32(12, true), 450);

        composer.commit();
        assert.equal(simulation.canvasHasDrawnBodies, true);
        assert.equal(simulation.replaceBodies([]).accepted, 0);

        composer.begin({ frameId: 2 });
        assert.equal(simulation.draw(createCamera()), true);
        assert.equal(simulation.draw(createCamera()), true, '같은 frame의 clear도 coalesce됩니다.');
        assert.equal(composer.records.clearCanvasCount, 1);
        assert.equal(composer.records.deferredCallbackCount, 2);
        assert.equal(platform.records.clearCanvasCount, 0);
        assert.equal(simulation.canvasHasDrawnBodies, true);
        composer.abort();
        assert.equal(simulation.canvasHasDrawnBodies, true, 'abort는 기존 draw 상태를 보존합니다.');

        composer.begin({ frameId: 3 });
        assert.equal(simulation.draw(createCamera()), true);
        composer.commit();
        assert.equal(simulation.canvasHasDrawnBodies, false);
        assert.equal(device.submissions.length, submitCountBeforeDraw);
        assert.equal(platform.records.clearCanvasCount, 0);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('composer clear 실패는 기존 canvas 상태와 재시도 가능성을 보존한다', () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    const composer = createFrameComposerHarness(device);
    const platform = createPresentationPlatform(device, composer.port);
    const simulation = new GpuCircleBodySimulation(platform.port, {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        simulation.canvasHasDrawnBodies = true;
        composer.setClearResult(false);
        assert.equal(simulation.draw(createCamera()), false);
        assert.equal(simulation.canvasHasDrawnBodies, true);
        composer.setClearResult(true);
        assert.equal(simulation.draw(createCamera()), true);
        assert.equal(composer.records.deferredCallbackCount, 2);
        composer.commit();
        assert.equal(simulation.canvasHasDrawnBodies, false);
        assert.equal(platform.records.clearCanvasCount, 0);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('composer generation/context mismatch는 legacy submit으로 우회하지 않고 fail-closed 한다', () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    const composer = createFrameComposerHarness(device, { deviceGeneration: 2 });
    const platform = createPresentationPlatform(device, composer.port);
    const simulation = new GpuCircleBodySimulation(platform.port, {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        assert.equal(simulation.replaceBodies([createBody(1)]).accepted, 1);
        const encoderCount = device.commandEncoderDescriptors.length;
        const submitCount = device.submissions.length;
        assert.equal(simulation.draw(createCamera()), false);
        assert.equal(composer.port.isFrameActive(), false);
        assert.equal(simulation.canvasHasDrawnBodies, false);
        assert.equal(device.commandEncoderDescriptors.length, encoderCount);
        assert.equal(device.submissions.length, submitCount);
        assert.equal(platform.records.acquireFrameTargetCount, 0);
        assert.equal(platform.records.markCanvasDrawnCount, 0);
        assert.equal(platform.records.clearCanvasCount, 0);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('composer 비활성 legacy draw/clear와 destroy는 기존 직접 제출 계약을 보존한다', () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    const inactiveComposer = Object.freeze({ isFrameActive: () => false });
    const platform = createPresentationPlatform(device, inactiveComposer);
    const simulation = new GpuCircleBodySimulation(platform.port, {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        assert.equal(simulation.replaceBodies([createBody(1)]).accepted, 1);
        const submitCount = device.submissions.length;
        assert.equal(simulation.draw(createCamera()), true);
        assert.equal(device.submissions.length, submitCount + 1);
        assert.equal(platform.records.acquireFrameTargetCount, 1);
        assert.equal(platform.records.markCanvasDrawnCount, 1);
        assert.equal(simulation.canvasHasDrawnBodies, true);
        assert.deepEqual(
            device.renderPasses.at(-1).operations.map((operation) => (
                operation.type === 'bind-group'
                    ? `${operation.type}:${operation.index}`
                    : operation.type
            )),
            ['pipeline', 'bind-group:0', 'bind-group:1', 'draw-indirect', 'end']
        );

        assert.equal(simulation.replaceBodies([]).accepted, 0);
        assert.equal(simulation.draw(createCamera()), true);
        assert.equal(platform.records.clearCanvasCount, 1);
        assert.equal(simulation.canvasHasDrawnBodies, false);
        simulation.canvasHasDrawnBodies = true;
        simulation.destroy();
        assert.equal(platform.records.clearCanvasCount, 2);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('unsupported WebGPU는 spawn 성공으로 오인하지 않고 명시적으로 거부한다', () => {
    const simulation = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 2,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });

    assert.equal(simulation.init(), false);
    assert.deepEqual({ ...simulation.replaceBodies([createBody(1), createBody(2)]) }, {
        accepted: 0,
        rejected: 2,
        capacity: 2,
        reason: 'unavailable'
    });
    assert.deepEqual({ ...simulation.replaceBodies([
        createBody(1),
        createBody(2),
        createBody(3)
    ]) }, {
        accepted: 0,
        rejected: 3,
        capacity: 2
    });
    assert.equal(simulation.getStatus().bodyCount, 0);
    assert.equal(simulation.fixedUpdate(1 / 60), false);
    assert.equal(simulation.getStatus().state, 'unavailable');
});

test('render style shapeCode는 byte 24에 기록되고 tombstone/reuse에서 circle 기본값으로 초기화된다', () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        const first = simulation.spawnBodies([{
            ...createBody(1),
            entityId: 7,
            incarnation: 1,
            renderStyle: {
                color: [1, 0.2, 0.1, 1],
                radiusScale: 1,
                visible: true,
                shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.HEXA
            }
        }]);
        assert.equal(first.accepted, 1);
        const styleBuffer = device.buffers.get('cirvivor-gpu-circle-render-styles');
        const styleView = new DataView(styleBuffer.data);
        assert.equal(
            styleView.getUint32(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.SHAPE_CODE, true),
            GPU_CIRCLE_BODY_RENDER_SHAPE.HEXA
        );
        assert.equal(
            styleView.getUint32(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.RESERVED, true),
            0
        );

        assert.deepEqual({ ...simulation.despawnBodies([first.handles[0]]) }, {
            removed: 1,
            rejected: 0,
            capacity: 1
        });
        assert.equal(
            styleView.getUint32(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.SHAPE_CODE, true),
            GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE
        );

        const reused = simulation.spawnBodies([{
            ...createBody(2),
            entityId: 7,
            incarnation: 2
        }]);
        assert.equal(reused.accepted, 1);
        assert.equal(reused.handles[0].entityId, 7);
        assert.equal(reused.handles[0].incarnation, 2);
        assert.equal(
            styleView.getUint32(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.SHAPE_CODE, true),
            GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE
        );
        assert.equal(
            styleView.getUint32(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.RESERVED, true),
            0
        );
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('incremental spawn은 stable entity handle을 강제하고 실패 시 host 상태를 보존한다', () => {
    const simulation = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 2,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    assert.throws(() => simulation.spawnBodies([createBody(1)]), /entityId와 incarnation/);
    assert.throws(() => simulation.spawnBodies([
        { ...createBody(1), entityId: 7, incarnation: 2 },
        { ...createBody(2), entityId: 7, incarnation: 2 }
    ]), /이미 활성 상태인 enemy handle/);
    assert.throws(() => simulation.spawnBodies([{
        ...createBody(1),
        entityId: 7,
        incarnation: 2,
        simulationMeta: 0
    }]), /ALIVE flag와 alive 입력/);
    assert.deepEqual({ ...simulation.spawnBodies([{
        ...createBody(1),
        entityId: 7,
        incarnation: 2
    }]) }, {
        accepted: 0,
        rejected: 1,
        capacity: 2,
        reason: 'unavailable'
    });
    assert.equal(simulation.hasBody({ entityId: 7, incarnation: 2 }), false);
    assert.equal(simulation.getStatus().bodyCount, 0);
    assert.equal(simulation.getStatus().activeBodyCount, 0);
});

test('frame delta 0은 pause 안전 규칙으로 reference prediction age를 제거한다', () => {
    const simulation = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    simulation.replaceBodies([createBody(1)]);
    simulation.fixedUpdate(1 / 60);
    simulation.updatePresentation({ frameDelta: 0.05, renderFrameId: 1 });
    assert.equal(
        simulation.getStatus().presentation.predictionDelta,
        Math.fround(0.05)
    );

    simulation.updatePresentation({ frameDelta: 0, renderFrameId: 2 });
    assert.equal(simulation.getStatus().presentation.predictionDelta, 0);
});

test('동적 body 지름이 grid cell을 넘으면 누락 가능한 3x3 구성을 거부한다', () => {
    const simulation = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    assert.throws(() => simulation.replaceBodies([{
        ...createBody(1),
        radius: 0.51
    }]), /동적 body 지름/);
});

test('static/dynamic epsilon 경계가 모호한 inverse mass는 host에서 거부한다', () => {
    const simulation = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    assert.throws(() => simulation.replaceBodies([{
        ...createBody(1),
        inverseMass: 0.000001
    }]), /inverseMass는 0 또는/);
});

test('flow body는 기존 JS/WASM atlas 범위와 per-body speed 계약을 검증한다', () => {
    const tileMap = createTileMap();
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const simulation = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 1,
        worldSize: {
            x: tileMap.getWorldBounds().width,
            y: tileMap.getWorldBounds().height
        },
        gridCellSize: { x: 1.5, y: 1.5 },
        sdf: null,
        flowFieldAtlas: atlas
    });
    assert.throws(() => simulation.replaceBodies([{
        ...createBody(1),
        flowFieldIndex: atlas.fieldCount,
        flowSpeed: 6.25
    }]), /flowFieldIndex가 atlas 범위/);
    assert.throws(() => simulation.replaceBodies([{
        ...createBody(1),
        flowFieldIndex: 0,
        flowSpeed: -1
    }]), /flowSpeed/);
    assert.deepEqual({ ...simulation.replaceBodies([{
        ...createBody(1),
        flowFieldIndex: 0,
        flowSpeed: 6.25
    }]) }, {
        accepted: 0,
        rejected: 1,
        capacity: 1,
        reason: 'unavailable'
    });
});

test('flow stage는 authored goalPosition과 transition radius를 16-byte uniform에 보존한다', () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 },
        flowFieldAtlas: createFlowFieldAtlasFixture()
    });
    try {
        assert.equal(simulation.init(), true);
        assert.deepEqual(
            { ...simulation.flowFieldAtlas.stages[0].goalPosition },
            { x: 0.25, y: 0.75 }
        );
        assert.equal(simulation.flowFieldAtlas.stages[0].transitionRadius, 1.5);

        const params = new DataView(
            device.buffers.get('cirvivor-gpu-circle-compute-params').data
        );
        const flowStageOffset = 96;
        assert.equal(params.getFloat32(flowStageOffset, true), 0.25);
        assert.equal(params.getFloat32(flowStageOffset + 4, true), 0.75);
        assert.equal(params.getInt32(flowStageOffset + 8, true), -1);
        assert.equal(params.getFloat32(flowStageOffset + 12, true), 1.5);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }

    const atlasOverride = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 },
        flowFieldAtlas: createFlowFieldAtlasFixture({ atlasTransitionRadius: 1.25 })
    });
    const stageOverride = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 },
        flowFieldAtlas: createFlowFieldAtlasFixture({
            atlasTransitionRadius: 1.25,
            stageTransitionRadius: 0.5
        })
    });
    assert.equal(atlasOverride.flowFieldAtlas.stages[0].transitionRadius, 1.25);
    assert.equal(stageOverride.flowFieldAtlas.stages[0].transitionRadius, 0.5);
    atlasOverride.destroy();
    stageOverride.destroy();

    assert.throws(() => new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 },
        flowFieldAtlas: createFlowFieldAtlasFixture({
            goalPosition: { x: Number.NaN, y: 0.75 }
        })
    }), /goalPosition은 유한/);
    assert.throws(() => new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 },
        flowFieldAtlas: createFlowFieldAtlasFixture({ stageTransitionRadius: 0 })
    }), /transitionRadius/);
});

test('contact/event capacity 기본값과 override 상한을 생성 시점에 고정한다', () => {
    const defaultSimulation = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 300,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    assert.equal(defaultSimulation.getStatus().contact.capacity, 1200);
    assert.equal(defaultSimulation.getStatus().events.capacity, 1200);
    assert.equal(defaultSimulation.getStatus().events.deathCapacity, 300);

    const overridden = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 4,
        contactCapacity: 8,
        eventCapacity: 4,
        deathEventCapacity: 2,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    assert.equal(overridden.getStatus().contact.capacity, 8);
    assert.equal(overridden.getStatus().events.capacity, 4);
    assert.equal(overridden.getStatus().events.deathCapacity, 2);
    const output = [];
    assert.equal(overridden.drainCompletedEventBatches(output), output);
    assert.equal(output.length, 0);
    assert.throws(() => overridden.drainCompletedEventBatches(null), /push 가능한/);

    assert.throws(() => new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 4,
        contactCapacity: 4,
        eventCapacity: 5,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    }), /eventCapacity.*4 이하/);
    assert.throws(() => new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 4,
        deathEventCapacity: 5,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    }), /deathEventCapacity.*4 이하/);
    assert.throws(() => new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 4,
        contactCapacity: 65537,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    }), /contactCapacity.*65536 이하/);
});

test('source-relative program은 validate→resolve 뒤 control을 적용하고 physics integration으로 진입한다', () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 2,
        controlCommandCapacity: 2,
        spawnProgramCapacity: 2,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        assert.equal(simulation.spawnBodies([{
            ...createBody(1),
            entityId: 1,
            incarnation: 1
        }]).accepted, 1);
        const staged = simulation.stageFixedPrograms({
            targetFixedTick: 1,
            controls: [{
                entityId: 1,
                incarnation: 1,
                moveIntentX: 1,
                moveIntentY: 0
            }],
            sourceRelativeSpawns: [createSourceRelativeSpawn({
                destinationEntityId: 2
            })]
        });
        assert.equal(staged.accepted, 2);
        assert.equal(staged.controlCount, 1);
        assert.equal(staged.sourceRelativeSpawnCount, 1);
        assert.equal(simulation.fixedUpdate(1 / 60, 1), true);

        assert.deepEqual(
            device.computePasses[0].slice(0, 9).map(({ entryPoint }) => entryPoint),
            [
                'update_indirect_args',
                'validate_source_relative_spawns',
                'resolve_source_relative_spawns',
                'clear_body_control_states',
                'validate_body_control_commands',
                'apply_body_control_commands',
                'apply_controlled_motion',
                'prepare_bodies',
                'clear_grid'
            ]
        );
        assert.deepEqual(
            device.computePasses[0].slice(1, 8).map(({ pipelineLayout }) => (
                pipelineLayout
            )),
            [
                'cirvivor-gpu-circle-compute-source-resolve-pipeline-layout',
                'cirvivor-gpu-circle-compute-source-resolve-pipeline-layout',
                'cirvivor-gpu-circle-compute-fixed-control-pipeline-layout',
                'cirvivor-gpu-circle-compute-fixed-control-pipeline-layout',
                'cirvivor-gpu-circle-compute-fixed-control-pipeline-layout',
                'cirvivor-gpu-circle-compute-fixed-control-pipeline-layout',
                'cirvivor-gpu-circle-compute-physics-pipeline-layout'
            ]
        );
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('control capacity/contract failure는 hard recovery이고 SpawnProgram capacity는 control-only stage로 격리한다', () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 4,
        controlCommandCapacity: 1,
        spawnProgramCapacity: 2,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    const source = { entityId: 1, incarnation: 1 };
    const control = {
        ...source,
        moveIntentX: 1,
        moveIntentY: 0
    };
    try {
        assert.equal(simulation.spawnBodies([{
            ...createBody(1),
            ...source
        }]).accepted, 1);

        const controlOverflow = simulation.stageFixedPrograms({
            targetFixedTick: 1,
            controls: [control, control],
            sourceRelativeSpawns: [createSourceRelativeSpawn({
                destinationEntityId: 2
            })]
        });
        assert.equal(controlOverflow.accepted, 0);
        assert.equal(controlOverflow.rejected, 3);
        assert.equal(controlOverflow.reason, 'control-program-capacity');
        assert.equal(controlOverflow.requiresRecovery, true);
        assert.deepEqual({ ...controlOverflow.controls }, {
            accepted: 0,
            rejected: 2,
            reason: 'control-program-capacity'
        });
        assert.deepEqual({ ...controlOverflow.sourceRelativeSpawns }, {
            accepted: 0,
            rejected: 1,
            reason: 'control-program-capacity'
        });
        assert.equal(
            simulation.getStatus().fixedPrimitives.spawnProgram.overflowCount,
            0,
            'control capacity reject는 SpawnProgram overflow telemetry를 오염시키지 않습니다.'
        );

        const spawnOverflow = simulation.stageFixedPrograms({
            targetFixedTick: 1,
            controls: [control],
            sourceRelativeSpawns: [2, 3, 4].map((destinationEntityId) => (
                createSourceRelativeSpawn({ destinationEntityId })
            ))
        });
        assert.equal(spawnOverflow.accepted, 1);
        assert.equal(spawnOverflow.rejected, 3);
        assert.equal(spawnOverflow.reason, 'spawn-program-capacity');
        assert.equal(spawnOverflow.requiresRecovery, false);
        assert.deepEqual({ ...spawnOverflow.controls }, {
            accepted: 1,
            rejected: 0,
            reason: null
        });
        assert.deepEqual({ ...spawnOverflow.sourceRelativeSpawns }, {
            accepted: 0,
            rejected: 3,
            reason: 'spawn-program-capacity'
        });
        assert.equal(
            simulation.getStatus().fixedPrimitives.spawnProgram.overflowCount,
            1,
            'capacity 2에 3 records를 요청하면 초과한 1 record만 누적합니다.'
        );

        let status = simulation.getStatus();
        assert.equal(status.activeBodyCount, 1);
        assert.equal(status.pendingBodyCount, 0);
        assert.equal(status.bodyCount, 1);
        assert.equal(status.fixedPrimitives.control.stagedCount, 1);
        assert.equal(status.fixedPrimitives.spawnProgram.stagedCount, 0);
        assert.equal(simulation.hasBody({ entityId: 2, incarnation: 1 }), false);
        assert.equal(simulation.hasBody({ entityId: 3, incarnation: 1 }), false);
        assert.equal(simulation.hasBody({ entityId: 4, incarnation: 1 }), false);

        const submitCount = device.submissions.length;
        assert.equal(simulation.fixedUpdate(1 / 60, 1), true);
        assert.equal(device.submissions.length, submitCount + 1);
        const entryPoints = device.computePasses[0].map(({ entryPoint }) => entryPoint);
        assert.equal(entryPoints.includes('validate_body_control_commands'), true);
        assert.equal(entryPoints.includes('apply_body_control_commands'), true);
        assert.equal(entryPoints.includes('validate_source_relative_spawns'), false);
        assert.equal(entryPoints.includes('resolve_source_relative_spawns'), false);

        const staleMidBatch = simulation.stageFixedPrograms({
            targetFixedTick: 2,
            controls: [control],
            sourceRelativeSpawns: [
                createSourceRelativeSpawn({ destinationEntityId: 2 }),
                createSourceRelativeSpawn({
                    sourceEntityId: 99,
                    destinationEntityId: 3
                })
            ]
        });
        assert.equal(staleMidBatch.accepted, 0);
        assert.equal(staleMidBatch.rejected, 3);
        assert.equal(staleMidBatch.reason, 'stale-source');
        assert.equal(staleMidBatch.requiresRecovery, true);
        assert.equal(staleMidBatch.controls.rejected, 1);
        assert.equal(staleMidBatch.sourceRelativeSpawns.rejected, 2);

        status = simulation.getStatus();
        assert.equal(status.activeBodyCount, 1);
        assert.equal(status.pendingBodyCount, 0);
        assert.equal(status.bodyCount, 1);
        assert.equal(status.fixedPrimitives.control.stagedCount, 0);
        assert.equal(status.fixedPrimitives.spawnProgram.stagedCount, 0);
        assert.equal(status.fixedPrimitives.spawnProgram.overflowCount, 1);
        assert.equal(simulation.hasBody({ entityId: 2, incarnation: 1 }), false);
        assert.equal(simulation.hasBody({ entityId: 3, incarnation: 1 }), false);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('body capacity pressure는 source batch 전체를 거부하고 동일 tick control을 한 submit에 적용한다', () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 2,
        controlCommandCapacity: 1,
        spawnProgramCapacity: 2,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        assert.equal(simulation.spawnBodies([{
            ...createBody(1),
            entityId: 1,
            incarnation: 1
        }, {
            ...createBody(3),
            entityId: 9,
            incarnation: 1
        }]).accepted, 2);
        const staged = simulation.stageFixedPrograms({
            targetFixedTick: 1,
            controls: [{
                entityId: 1,
                incarnation: 1,
                moveIntentX: 1,
                moveIntentY: 0
            }],
            sourceRelativeSpawns: [
                createSourceRelativeSpawn({ destinationEntityId: 2 }),
                createSourceRelativeSpawn({ destinationEntityId: 3 })
            ]
        });
        assert.equal(staged.accepted, 1);
        assert.equal(staged.rejected, 2);
        assert.equal(staged.reason, 'body-capacity');
        assert.equal(staged.requiresRecovery, false);
        assert.deepEqual({ ...staged.controls }, {
            accepted: 1,
            rejected: 0,
            reason: null
        });
        assert.deepEqual({ ...staged.sourceRelativeSpawns }, {
            accepted: 0,
            rejected: 2,
            reason: 'body-capacity'
        });
        assert.equal(simulation.getStatus().pendingBodyCount, 0);
        assert.equal(simulation.hasBody({ entityId: 2, incarnation: 1 }), false);
        assert.equal(simulation.hasBody({ entityId: 3, incarnation: 1 }), false);

        const submitCount = device.submissions.length;
        assert.equal(simulation.fixedUpdate(1 / 60, 1), true);
        assert.equal(device.submissions.length, submitCount + 1);
        const entryPoints = device.computePasses[0].map(({ entryPoint }) => entryPoint);
        assert.equal(entryPoints.includes('validate_body_control_commands'), true);
        assert.equal(entryPoints.includes('validate_source_relative_spawns'), false);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('tracked pose는 4×32-byte ring 포화 시 sample만 drop하고 역순 완료에서는 newest exact pose를 보존한다', async () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    device.deferTrackedPoseMaps = true;
    device.trackedPosePayloads.push(...Array.from({ length: 4 }, (_, index) => ({
        entityId: 91,
        incarnation: 3,
        position: { x: 10 + index, y: 20 + index },
        velocity: { x: 1 + index, y: 2 + index },
        previousPosition: { x: 9 + index, y: 19 + index }
    })));
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        assert.equal(simulation.spawnBodies([{
            ...createBody(1),
            entityId: 91,
            incarnation: 3
        }]).accepted, 1);
        assert.deepEqual({ ...simulation.configureTrackedBody({
            entityId: 91,
            incarnation: 3
        }) }, {
            accepted: true,
            tracked: true
        });

        for (let tick = 1; tick <= 5; tick++) {
            assert.equal(simulation.fixedUpdate(1 / 60, tick), true);
        }
        let trackedStatus = simulation.getStatus().fixedPrimitives.trackedPose;
        assert.equal(trackedStatus.ringSlotCount, 4);
        assert.equal(trackedStatus.recordByteSize, 32);
        assert.equal(trackedStatus.maximumBytesPerTick, 32);
        assert.equal(trackedStatus.pendingReadbacks, 4);
        assert.equal(trackedStatus.droppedSamples, 1);
        assert.equal(device.pendingTrackedPoseMapIndices().length, 4);
        assert.equal(
            Array.from(device.buffers.values()).filter(({ label, size }) => (
                label.includes('tracked-pose-readback') && size === 32
            )).length,
            4
        );
        const trackedCopies = device.bufferCopies.filter(({ targetLabel }) => (
            targetLabel.includes('tracked-pose-readback')
        ));
        assert.equal(trackedCopies.length, 4);
        assert.ok(trackedCopies.every(({ size }) => size === 32));
        assert.equal(
            device.computePasses.filter((operations) => (
                operations.some(({ entryPoint }) => entryPoint === 'pack_tracked_pose')
            )).length,
            4
        );

        const submittedStatus = simulation.getStatus();
        device.resolveTrackedPoseMap(3);
        await flushMicrotasks();
        trackedStatus = simulation.getStatus().fixedPrimitives.trackedPose;
        assert.equal(trackedStatus.pendingReadbacks, 3);
        assert.equal(trackedStatus.publishedSamples, 1);
        assert.equal(trackedStatus.latest.valid, true);
        assert.equal(trackedStatus.latest.entityId, 91);
        assert.equal(trackedStatus.latest.incarnation, 3);
        assert.equal(trackedStatus.latest.sourceTick, 4);
        assert.equal(trackedStatus.latest.submittedTick, 4);
        assert.equal(trackedStatus.latest.observedThroughTick, 4);
        assert.equal(
            trackedStatus.latest.sessionGeneration,
            submittedStatus.sessionGeneration
        );
        assert.equal(trackedStatus.latest.deviceGeneration, 1);
        assert.equal(
            trackedStatus.latest.authoritativeEpoch,
            submittedStatus.authoritativeEpoch
        );
        assert.deepEqual({ ...trackedStatus.latest.position }, { x: 13, y: 23 });

        device.resolveTrackedPoseMap(2);
        device.resolveTrackedPoseMap(1);
        await flushMicrotasks();
        trackedStatus = simulation.getStatus().fixedPrimitives.trackedPose;
        assert.equal(trackedStatus.pendingReadbacks, 1);
        assert.equal(trackedStatus.publishedSamples, 1);
        assert.equal(trackedStatus.latest.sourceTick, 4);
        assert.deepEqual({ ...trackedStatus.latest.position }, { x: 13, y: 23 });

        const physicsBuffer = device.buffers.get('cirvivor-gpu-circle-physics');
        assert.equal(simulation.despawnBodies([{
            entityId: 91,
            incarnation: 3
        }]).removed, 1);
        assert.equal(simulation.getStatus().activeBodyCount, 0);
        assert.equal(physicsBuffer.destroyed, false);

        device.resolveTrackedPoseMap(0);
        await flushMicrotasks();
        const releasedStatus = simulation.getStatus();
        assert.equal(releasedStatus.state, 'idle');
        assert.equal(
            releasedStatus.fixedPrimitives.trackedPose.publishedSamples,
            1
        );
        assert.equal(releasedStatus.fixedPrimitives.trackedPose.latest.valid, false);
        assert.equal(physicsBuffer.destroyed, true);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('generation/epoch 교체 뒤 늦은 tracked pose callback은 새 exact pose를 덮지 않는다', async () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    device.deferTrackedPoseMaps = true;
    device.trackedPosePayloads.push({
        entityId: 91,
        incarnation: 3,
        position: { x: 10, y: 20 },
        velocity: { x: 1, y: 2 },
        previousPosition: { x: 9, y: 19 }
    }, {
        entityId: 92,
        incarnation: 4,
        position: { x: 30, y: 40 },
        velocity: { x: 3, y: 4 },
        previousPosition: { x: 29, y: 39 }
    });
    let deviceGeneration = 1;
    const basePlatform = createFakePlatformPort(device);
    const platform = {
        ...basePlatform,
        getDeviceGeneration: () => deviceGeneration
    };
    const simulation = new GpuCircleBodySimulation(platform, {
        capacity: 1,
        sessionGeneration: 77,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        assert.equal(simulation.replaceBodies([{
            ...createBody(1),
            entityId: 91,
            incarnation: 3
        }]).accepted, 1);
        assert.equal(simulation.configureTrackedBody({
            entityId: 91,
            incarnation: 3
        }).accepted, true);
        assert.equal(simulation.fixedUpdate(1 / 60, 40), true);

        const oldStatus = simulation.getStatus();
        const oldPhysicsBuffer = device.buffers.get('cirvivor-gpu-circle-physics');
        assert.equal(oldStatus.deviceGeneration, 1);
        assert.equal(oldStatus.fixedPrimitives.trackedPose.pendingReadbacks, 1);
        assert.equal(oldStatus.fixedPrimitives.trackedPose.publishedSamples, 0);

        deviceGeneration = 2;
        assert.equal(simulation.replaceBodies([{
            ...createBody(3),
            entityId: 92,
            incarnation: 4
        }]).accepted, 1);
        const replacementStatus = simulation.getStatus();
        const replacementPhysicsBuffer = device.buffers.get(
            'cirvivor-gpu-circle-physics'
        );
        assert.equal(replacementStatus.deviceGeneration, 2);
        assert.ok(replacementStatus.authoritativeEpoch > oldStatus.authoritativeEpoch);
        assert.equal(replacementStatus.fixedPrimitives.trackedPose.pendingReadbacks, 0);
        assert.equal(replacementStatus.fixedPrimitives.trackedPose.latest.valid, false);
        assert.notStrictEqual(replacementPhysicsBuffer, oldPhysicsBuffer);
        assert.equal(oldPhysicsBuffer.destroyed, true);
        assert.equal(replacementPhysicsBuffer.destroyed, false);

        assert.equal(simulation.configureTrackedBody({
            entityId: 92,
            incarnation: 4
        }).accepted, true);
        assert.equal(simulation.fixedUpdate(1 / 60, 41), true);
        assert.deepEqual(device.pendingTrackedPoseMapIndices(), [0, 1]);

        device.resolveTrackedPoseMap(1);
        await flushMicrotasks();
        const newestStatus = simulation.getStatus();
        const newestPose = newestStatus.fixedPrimitives.trackedPose.latest;
        assert.equal(newestStatus.fixedPrimitives.trackedPose.publishedSamples, 1);
        assert.equal(newestPose.valid, true);
        assert.equal(newestPose.entityId, 92);
        assert.equal(newestPose.incarnation, 4);
        assert.equal(newestPose.sourceTick, 41);
        assert.equal(newestPose.submittedTick, 1);
        assert.equal(newestPose.observedThroughTick, 41);
        assert.equal(newestPose.sessionGeneration, 77);
        assert.equal(newestPose.deviceGeneration, 2);
        assert.equal(newestPose.authoritativeEpoch, replacementStatus.authoritativeEpoch);
        assert.deepEqual({ ...newestPose.position }, { x: 30, y: 40 });

        device.resolveTrackedPoseMap(0);
        await flushMicrotasks();
        const afterOldCallback = simulation.getStatus();
        const preservedPose = afterOldCallback.fixedPrimitives.trackedPose.latest;
        assert.equal(afterOldCallback.deviceGeneration, 2);
        assert.equal(
            afterOldCallback.authoritativeEpoch,
            replacementStatus.authoritativeEpoch
        );
        assert.equal(
            afterOldCallback.fixedPrimitives.trackedPose.publishedSamples,
            1
        );
        assert.equal(afterOldCallback.fixedPrimitives.trackedPose.pendingReadbacks, 0);
        assert.equal(preservedPose.entityId, 92);
        assert.equal(preservedPose.incarnation, 4);
        assert.equal(preservedPose.sourceTick, 41);
        assert.equal(preservedPose.deviceGeneration, 2);
        assert.equal(preservedPose.authoritativeEpoch, replacementStatus.authoritativeEpoch);
        assert.deepEqual({ ...preservedPose.position }, { x: 30, y: 40 });
        assert.equal(replacementPhysicsBuffer.destroyed, false);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('SpawnProgram result ring은 4개로 bounded되고 pending outcome/event drain까지 idle release를 지연한다', async () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    device.deferSpawnProgramMaps = true;
    device.spawnProgramResultPayloads.push(
        GPU_SPAWN_PROGRAM_RESULT.SOURCE_INVALID,
        GPU_SPAWN_PROGRAM_RESULT.SOURCE_INVALID,
        GPU_SPAWN_PROGRAM_RESULT.SOURCE_INVALID,
        GPU_SPAWN_PROGRAM_RESULT.SOURCE_INVALID
    );
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 8,
        spawnProgramCapacity: 4,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        assert.equal(simulation.spawnBodies([{
            ...createBody(1),
            entityId: 1,
            incarnation: 1
        }]).accepted, 1);
        for (let tick = 1; tick <= 4; tick++) {
            const staged = simulation.stageFixedPrograms({
                targetFixedTick: tick,
                sourceRelativeSpawns: [createSourceRelativeSpawn({
                    destinationEntityId: 100 + tick
                })]
            });
            assert.equal(staged.accepted, 1);
            assert.equal(simulation.fixedUpdate(1 / 60, tick), true);
        }

        let status = simulation.getStatus();
        assert.equal(status.activeBodyCount, 1);
        assert.equal(status.pendingBodyCount, 4);
        assert.equal(status.fixedPrimitives.spawnProgram.ringSlotCount, 4);
        assert.equal(status.fixedPrimitives.spawnProgram.pendingReadbacks, 4);
        assert.equal(device.pendingSpawnProgramMapIndices().length, 4);
        const resultCopies = device.bufferCopies.filter(({ targetLabel }) => (
            targetLabel.includes('spawn-program-readback')
        ));
        assert.equal(resultCopies.length, 4);
        assert.ok(resultCopies.every(({ size }) => (
            size === GPU_FIXED_PRIMITIVE_ABI.PROGRAM_HEADER.STRIDE
                + (4 * GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.STRIDE)
        )));

        const rejected = simulation.stageFixedPrograms({
            targetFixedTick: 5,
            controls: [{
                entityId: 1,
                incarnation: 1,
                moveIntentX: 1,
                moveIntentY: 0
            }],
            sourceRelativeSpawns: [createSourceRelativeSpawn({
                destinationEntityId: 105
            })]
        });
        assert.equal(rejected.accepted, 1);
        assert.equal(rejected.rejected, 1);
        assert.equal(rejected.reason, 'spawn-program-readback-capacity');
        assert.equal(rejected.requiresRecovery, false);
        assert.deepEqual({ ...rejected.controls }, {
            accepted: 1,
            rejected: 0,
            reason: null
        });
        assert.deepEqual({ ...rejected.sourceRelativeSpawns }, {
            accepted: 0,
            rejected: 1,
            reason: 'spawn-program-readback-capacity'
        });
        assert.equal(simulation.getStatus().pendingBodyCount, 4);
        assert.equal(simulation.hasBody({ entityId: 105, incarnation: 1 }), false);
        const submitCount = device.submissions.length;
        assert.equal(simulation.fixedUpdate(1 / 60, 5), true);
        assert.equal(device.submissions.length, submitCount + 1);
        const fifthTickOperations = device.computePasses[4].map(
            ({ entryPoint }) => entryPoint
        );
        assert.equal(
            fifthTickOperations.includes('validate_body_control_commands'),
            true
        );
        assert.equal(
            fifthTickOperations.includes('validate_source_relative_spawns'),
            false
        );

        for (const index of device.pendingEventMapIndices()) {
            device.resolveEventMap(index);
        }
        await flushMicrotasks();
        assert.equal(simulation.drainCompletedEventBatches([]).length, 5);

        const physicsBuffer = device.buffers.get('cirvivor-gpu-circle-physics');
        assert.equal(simulation.despawnBodies([{
            entityId: 1,
            incarnation: 1
        }]).removed, 1);
        assert.equal(simulation.getStatus().activeBodyCount, 0);
        assert.equal(physicsBuffer.destroyed, false);

        for (const index of device.pendingSpawnProgramMapIndices()) {
            device.resolveSpawnProgramMap(index);
        }
        await flushMicrotasks();
        status = simulation.getStatus();
        assert.equal(status.fixedPrimitives.spawnProgram.pendingReadbacks, 0);
        assert.equal(status.fixedPrimitives.spawnProgram.queuedBatches, 4);
        assert.equal(physicsBuffer.destroyed, false);

        const batches = simulation.drainCompletedSpawnProgramBatches([]);
        assert.equal(batches.length, 4);
        assert.ok(batches.every((batch) => (
            batch.failure === null
                && batch.outcomes.length === 1
                && batch.outcomes[0].result
                    === GPU_SPAWN_PROGRAM_RESULT.SOURCE_INVALID
        )), JSON.stringify(batches));
        status = simulation.getStatus();
        assert.equal(status.pendingBodyCount, 0);
        assert.equal(status.state, 'idle');
        assert.equal(physicsBuffer.destroyed, true);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('mixed contact pass와 event ring은 확정 binding, dispatch, 순서 watermark를 지킨다', async () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 2,
        contactCapacity: 8,
        eventCapacity: 4,
        deathEventCapacity: 2,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        device.eventPayloads.push({
            contactCount: 1,
            applied: [{
                entityId: 11,
                incarnation: 2,
                otherEntityId: 22,
                otherIncarnation: 3,
                damageFixedPoint: 123,
                eventMeta: packGpuCircleAppliedEventMeta(
                    GPU_CIRCLE_APPLIED_EVENT_TYPE.DAMAGE_APPLIED,
                    GPU_CIRCLE_APPLIED_EVENT_FLAG.TARGET_DIED
                        | GPU_CIRCLE_APPLIED_EVENT_FLAG.ENTER_POLICY
                ),
                x: 1.5,
                y: -2
            }, {
                entityId: 11,
                incarnation: 2,
                otherEntityId: 0,
                otherIncarnation: 0,
                damageFixedPoint: 0,
                eventMeta: packGpuCircleAppliedEventMeta(
                    GPU_CIRCLE_APPLIED_EVENT_TYPE.INTERACTION_ENTER,
                    GPU_CIRCLE_APPLIED_EVENT_FLAG.ENTER_POLICY
                        | GPU_CIRCLE_APPLIED_EVENT_FLAG.TERRAIN_CONTACT
                ),
                x: 2,
                y: 3
            }],
            deaths: [{
                entityId: 22,
                incarnation: 3,
                bodyId: 1,
                flags: 1
            }]
        }, {});
        const replaceResult = simulation.replaceBodies([{
            ...createBody(1),
            entityId: 11,
            incarnation: 2,
            interactionMask: 1,
            health: 3.25,
            contactHandler: {
                damageSelf: 1,
                damageOther: 2.5,
                flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
            }
        }]);
        assert.equal(
            replaceResult.accepted,
            1,
            JSON.stringify(simulation.getStatus().failure)
        );

        const initialStatus = simulation.getStatus();
        assert.equal(initialStatus.events.eventProducingBodyCount, 1);
        assert.equal(initialStatus.maximumBodyRadius, 0.25);
        assert.equal(initialStatus.uploadedMaximumBodyRadius, 0.25);
        const paramsView = new DataView(
            device.buffers.get('cirvivor-gpu-circle-compute-params').data
        );
        assert.equal(paramsView.byteLength, 4208);
        assert.equal(paramsView.getUint32(4192, true), 8);
        assert.equal(paramsView.getUint32(4196, true), 4);
        assert.equal(paramsView.getUint32(4200, true), 2);
        assert.equal(paramsView.getFloat32(4204, true), 0.25);
        const handlerView = new DataView(
            device.buffers.get('cirvivor-gpu-circle-contact-handlers').data
        );
        assert.equal(handlerView.getFloat32(0, true), 1);
        assert.equal(handlerView.getFloat32(4, true), 2.5);
        const simulationView = new DataView(
            device.buffers.get('cirvivor-gpu-circle-simulation').data
        );
        assert.equal(simulationView.getInt32(4, true), 325);

        const computeBodiesWithHandlersLayout = device.bindGroupLayouts.get(
            'cirvivor-gpu-circle-compute-bodies-with-handlers-layout'
        );
        assert.equal(computeBodiesWithHandlersLayout.entries.length, 5);
        assert.equal(computeBodiesWithHandlersLayout.entries[4].binding, 4);
        assert.equal(
            computeBodiesWithHandlersLayout.entries[4].buffer.type,
            'read-only-storage'
        );
        const computeContactEventsLayout = device.bindGroupLayouts.get(
            'cirvivor-gpu-circle-compute-contact-events-layout'
        );
        assert.deepEqual(
            Array.from(computeContactEventsLayout.entries, (entry) => entry.binding),
            [0, 1]
        );
        const computeAllEventsLayout = device.bindGroupLayouts.get(
            'cirvivor-gpu-circle-compute-all-events-layout'
        );
        assert.deepEqual(
            Array.from(computeAllEventsLayout.entries, (entry) => entry.binding),
            [0, 1, 2, 3]
        );
        const storageBindingCount = (pipelineLayout) => (
            pipelineLayout.bindGroupLayouts.reduce((total, bindGroupLayout) => (
                total + bindGroupLayout.entries.filter(({ buffer }) => (
                    buffer?.type === 'storage' || buffer?.type === 'read-only-storage'
                )).length
            ), 0)
        );
        const profileStorageCounts = Object.fromEntries([
            'physics',
            'body-contacts',
            'world-contacts',
            'contact-handling',
            'fixed-control',
            'source-resolve',
            'tracked-pose'
        ].map((profile) => {
            const layout = device.pipelineLayouts.get(
                `cirvivor-gpu-circle-compute-${profile}-pipeline-layout`
            );
            assert.ok(layout, `${profile} compute pipeline layout이 없습니다.`);
            return [profile, storageBindingCount(layout)];
        }));
        assert.deepEqual(profileStorageCounts, {
            physics: 8,
            'body-contacts': 9,
            'world-contacts': 7,
            'contact-handling': 9,
            'fixed-control': 5,
            'source-resolve': 5,
            'tracked-pose': 6
        });
        assert.ok(
            Object.values(profileStorageCounts).every((count) => count <= 9),
            JSON.stringify(profileStorageCounts)
        );
        const renderBodiesLayout = device.bindGroupLayouts.get(
            'cirvivor-gpu-circle-render-bodies-layout'
        );
        assert.equal(renderBodiesLayout.entries[4].binding, 4);
        assert.equal(renderBodiesLayout.entries[4].buffer.type, 'read-only-storage');

        assert.equal(simulation.fixedUpdate(1 / 60, 100), true);
        assert.equal(simulation.fixedUpdate(1 / 60, 101), true);
        const operations = device.computePasses[0];
        assert.deepEqual(
            operations.slice(0, 11).map((operation) => operation.entryPoint),
            [
                'update_indirect_args',
                'clear_body_control_states',
                'apply_controlled_motion',
                'prepare_bodies',
                'clear_grid',
                'build_grid',
                'clear_contact_state',
                'generate_body_contacts',
                'generate_world_contacts',
                'handle_contacts',
                'mark_dead'
            ]
        );
        assert.equal(operations[0].mode, 'direct');
        assert.equal(operations[0].workgroups, 1);
        assert.equal(operations[6].mode, 'direct');
        assert.equal(operations[6].workgroups, 1);
        assert.equal(operations[9].mode, 'direct');
        assert.equal(operations[9].workgroups, 1);
        assert.deepEqual(
            operations.slice(0, 11).map(({ pipelineLayout }) => pipelineLayout),
            [
                'cirvivor-gpu-circle-indirect-pipeline-layout',
                'cirvivor-gpu-circle-compute-fixed-control-pipeline-layout',
                'cirvivor-gpu-circle-compute-fixed-control-pipeline-layout',
                'cirvivor-gpu-circle-compute-physics-pipeline-layout',
                'cirvivor-gpu-circle-compute-physics-pipeline-layout',
                'cirvivor-gpu-circle-compute-physics-pipeline-layout',
                'cirvivor-gpu-circle-compute-contact-handling-pipeline-layout',
                'cirvivor-gpu-circle-compute-body-contacts-pipeline-layout',
                'cirvivor-gpu-circle-compute-world-contacts-pipeline-layout',
                'cirvivor-gpu-circle-compute-contact-handling-pipeline-layout',
                'cirvivor-gpu-circle-compute-contact-handling-pipeline-layout'
            ]
        );
        assert.deepEqual(operations[0].bindGroups, [
            'cirvivor-gpu-circle-indirect'
        ]);
        assert.deepEqual(operations[1].bindGroups, [
            'cirvivor-gpu-circle-compute-fixed-control',
            'cirvivor-gpu-circle-compute-empty',
            'cirvivor-gpu-circle-compute-params'
        ]);
        assert.deepEqual(operations[3].bindGroups, [
            'cirvivor-gpu-circle-compute-bodies-base',
            'cirvivor-gpu-circle-compute-world-full',
            'cirvivor-gpu-circle-compute-params'
        ]);
        assert.deepEqual(operations[7].bindGroups, [
            'cirvivor-gpu-circle-compute-bodies-with-handlers',
            'cirvivor-gpu-circle-compute-world-grid',
            'cirvivor-gpu-circle-compute-params',
            'cirvivor-gpu-circle-compute-contact-events'
        ]);
        assert.deepEqual(operations[8].bindGroups, [
            'cirvivor-gpu-circle-compute-bodies-base',
            'cirvivor-gpu-circle-compute-world-sdf',
            'cirvivor-gpu-circle-compute-params',
            'cirvivor-gpu-circle-compute-contact-events'
        ]);
        assert.deepEqual(operations[9].bindGroups, [
            'cirvivor-gpu-circle-compute-bodies-with-handlers',
            'cirvivor-gpu-circle-compute-empty',
            'cirvivor-gpu-circle-compute-params',
            'cirvivor-gpu-circle-compute-all-events'
        ]);
        assert.equal(
            operations.filter((operation) => operation.entryPoint === 'solve_body_body').length,
            6
        );

        device.resolveEventMap(1);
        await flushMicrotasks();
        assert.equal(simulation.drainCompletedEventBatches([]).length, 0);
        device.resolveEventMap(0);
        await flushMicrotasks();
        const batches = simulation.drainCompletedEventBatches([]);
        assert.equal(batches.length, 2);
        assert.equal(batches[0].previousSourceTick, 0);
        assert.equal(batches[0].previousSubmittedTick, 0);
        assert.equal(batches[0].sourceTick, 100);
        assert.equal(batches[0].submittedTick, 1);
        assert.equal(batches[0].deviceGeneration, 1);
        assert.equal(batches[0].completedThroughTick, 101);
        assert.equal(batches[0].events.length, 3);
        const contact = batches[0].events[0];
        assert.equal(contact.type, 'contact');
        assert.equal(contact.eventType, 'damage-applied');
        assert.equal(contact.sequence, 0);
        assert.equal(contact.entityId, 11);
        assert.equal(contact.incarnation, 2);
        assert.equal(contact.other.entityId, 22);
        assert.equal(contact.other.incarnation, 3);
        assert.equal(contact.damageFixedPoint, 123);
        assert.equal(contact.damage, 1.23);
        assert.equal(contact.position.x, 1.5);
        assert.equal(contact.position.y, -2);
        assert.equal(
            contact.flags,
            GPU_CIRCLE_APPLIED_EVENT_FLAG.TARGET_DIED
                | GPU_CIRCLE_APPLIED_EVENT_FLAG.ENTER_POLICY
        );
        assert.equal(contact.reason, 'target-died');
        const terrain = batches[0].events[1];
        assert.equal(terrain.type, 'contact');
        assert.equal(terrain.eventType, 'interaction-enter');
        assert.equal(terrain.sequence, 1);
        assert.equal(terrain.other, null);
        assert.equal(terrain.valueFixedPoint, 0);
        assert.equal(terrain.reason, 'terrain-interaction');
        const death = batches[0].events[2];
        assert.equal(death.type, 'death');
        assert.equal(death.sequence, 2);
        assert.equal(death.entityId, 22);
        assert.equal(death.incarnation, 3);
        assert.equal(death.bodyId, 1);
        assert.equal(death.damageFixedPoint, 0);
        assert.equal(death.reason, 'health');
        assert.equal(batches[1].previousSourceTick, 100);
        assert.equal(batches[1].previousSubmittedTick, 1);
        assert.equal(batches[1].sourceTick, 101);
        assert.equal(batches[1].events.length, 0);
        assert.equal(simulation.getStatus().events.lastStatsTick, 2);
        assert.equal(simulation.getStatus().events.lastAppliedCount, 0);

        for (let index = 0; index < 8; index++) {
            assert.equal(simulation.fixedUpdate(1 / 60, 200 + index), true);
        }
        assert.equal(simulation.fixedUpdate(1 / 60, 999), false);
        assert.equal(simulation.getStatus().state, 'event-backpressure');
        assert.equal(simulation.getStatus().events.backpressureCount, 1);
        const pending = device.pendingEventMapIndices();
        assert.equal(pending.length, 8);
        device.resolveEventMap(pending[0]);
        await flushMicrotasks();
        assert.equal(simulation.getStatus().state, 'ready');
        assert.equal(simulation.getStatus().failure, null);
        assert.equal(simulation.fixedUpdate(1 / 60, 999), true);

        const stalePending = device.pendingEventMapIndices()[0];
        simulation.destroy();
        device.resolveEventMap(stalePending);
        await flushMicrotasks();
        assert.equal(simulation.getStatus().state, 'destroyed');
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('health 0 active body는 interaction/lifetime 없이도 death readback을 예약한다', async () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 1,
        eventCapacity: 1,
        deathEventCapacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        device.eventPayloads.push({
            deaths: [{
                entityId: 73,
                incarnation: 1,
                bodyId: 0,
                flags: 1
            }]
        });
        assert.equal(simulation.replaceBodies([{
            ...createBody(2),
            entityId: 73,
            incarnation: 1,
            health: 0
        }]).accepted, 1);
        assert.equal(simulation.getStatus().events.eventProducingBodyCount, 1);
        assert.equal(simulation.fixedUpdate(1 / 60, 1), true);
        assert.equal(simulation.getStatus().events.pendingReadbacks, 1);
        device.resolveEventMap(0);
        await flushMicrotasks();
        const batches = simulation.drainCompletedEventBatches([]);
        assert.equal(batches.length, 1);
        assert.equal(batches[0].events.length, 1);
        assert.equal(batches[0].events[0].type, 'death');
        assert.equal(batches[0].events[0].entityId, 73);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('overflow readback slot 반환은 다음 fixed tick 없이 telemetry backpressure를 해제한다', async () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    device.deferOverflowMaps = true;
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        const replaceResult = simulation.replaceBodies([{
            ...createBody(1),
            entityId: 31,
            incarnation: 1
        }]);
        assert.equal(
            replaceResult.accepted,
            1,
            JSON.stringify(simulation.getStatus().failure)
        );
        assert.equal(simulation.getStatus().events.eventProducingBodyCount, 0);

        for (let tick = 1; tick <= 59; tick++) {
            assert.equal(simulation.fixedUpdate(1 / 60, tick), true);
        }
        assert.equal(simulation.fixedUpdate(1 / 60, 60), false);
        assert.equal(simulation.getStatus().state, 'telemetry-backpressure');
        assert.equal(simulation.getStatus().overflow.pendingReadbacks, 4);

        const pending = device.pendingOverflowMapIndices();
        assert.equal(pending.length, 4);
        device.resolveOverflowMap(pending[0]);
        await flushMicrotasks();
        assert.equal(simulation.getStatus().state, 'ready');
        assert.equal(simulation.getStatus().failure, null);
        assert.equal(simulation.getStatus().submittedTickCount, 59);
        assert.equal(simulation.getStatus().overflow.pendingReadbacks, 3);

        const stalePending = device.pendingOverflowMapIndices()[0];
        simulation.destroy();
        device.resolveOverflowMap(stalePending);
        await flushMicrotasks();
        assert.equal(simulation.getStatus().state, 'destroyed');
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('마지막 despawn은 지연된 0-event batch drain 뒤 watermark를 보존하고 idle release한다', async () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 1,
        contactCapacity: 4,
        eventCapacity: 4,
        deathEventCapacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        device.eventPayloads.push({});
        const replaceResult = simulation.replaceBodies([{
            ...createBody(1),
            entityId: 41,
            incarnation: 7,
            interactionMask: 1,
            contactHandler: {
                flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
            }
        }]);
        assert.equal(
            replaceResult.accepted,
            1,
            JSON.stringify(simulation.getStatus().failure)
        );
        assert.equal(simulation.fixedUpdate(1 / 60, 400), true);

        const physicsBuffer = device.buffers.get('cirvivor-gpu-circle-physics');
        const eventReadbackBuffer = device.eventMapRequests[0].buffer;
        const epochBeforeDespawn = simulation.getStatus().authoritativeEpoch;
        assert.deepEqual({ ...simulation.despawnBodies([{
            entityId: 41,
            incarnation: 7
        }]) }, {
            removed: 1,
            rejected: 0,
            capacity: 1
        });

        let status = simulation.getStatus();
        assert.equal(status.activeBodyCount, 0);
        assert.equal(status.state, 'ready');
        assert.equal(status.deviceGeneration, 1);
        assert.equal(status.authoritativeEpoch, epochBeforeDespawn);
        assert.equal(status.events.pendingReadbacks, 1);
        assert.equal(status.events.queuedBatches, 1);
        assert.equal(physicsBuffer.destroyed, false);
        assert.equal(eventReadbackBuffer.destroyed, false);

        device.resolveEventMap(0);
        await flushMicrotasks();
        status = simulation.getStatus();
        assert.equal(status.state, 'ready');
        assert.equal(status.deviceGeneration, 1);
        assert.equal(status.authoritativeEpoch, epochBeforeDespawn);
        assert.equal(status.events.pendingReadbacks, 0);
        assert.equal(status.events.queuedBatches, 1);
        assert.equal(status.events.completedThroughTick, 400);
        assert.equal(physicsBuffer.destroyed, false);
        assert.equal(eventReadbackBuffer.destroyed, false);

        const batches = simulation.drainCompletedEventBatches([]);
        assert.equal(batches.length, 1);
        assert.equal(batches[0].previousSourceTick, 0);
        assert.equal(batches[0].previousSubmittedTick, 0);
        assert.equal(batches[0].sourceTick, 400);
        assert.equal(batches[0].completedThroughTick, 400);
        assert.equal(batches[0].events.length, 0);
        status = simulation.getStatus();
        assert.equal(status.state, 'idle');
        assert.equal(status.deviceGeneration, -1);
        assert.equal(status.authoritativeEpoch, epochBeforeDespawn + 1);
        assert.equal(status.events.pendingReadbacks, 0);
        assert.equal(status.events.queuedBatches, 0);
        assert.equal(status.events.completedThroughTick, 400);
        assert.equal(physicsBuffer.destroyed, true);
        assert.equal(eventReadbackBuffer.destroyed, true);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('contact raw count가 capacity를 넘으면 부분 event를 방출하지 않고 degraded 된다', async () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 1,
        contactCapacity: 4,
        eventCapacity: 4,
        deathEventCapacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        device.eventPayloads.push({ contactCount: 5, contactOverflow: 1 });
        const replaceResult = simulation.replaceBodies([{
            ...createBody(1),
            entityId: 9,
            incarnation: 1,
            interactionMask: 1,
            contactHandler: {
                flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
            }
        }]);
        assert.equal(
            replaceResult.accepted,
            1,
            JSON.stringify(simulation.getStatus().failure)
        );
        assert.equal(simulation.fixedUpdate(1 / 60, 1), true);
        device.resolveEventMap(0);
        await flushMicrotasks();
        const status = simulation.getStatus();
        assert.equal(status.state, 'contact-overflow-degraded');
        assert.equal(status.requiresAuthoritativeRebuild, true);
        assert.equal(status.contact.lastCount, 4);
        assert.equal(status.contact.lastOverflowCount, 1);
        assert.equal(status.events.pendingReadbacks, 0);
        assert.equal(simulation.drainCompletedEventBatches([]).length, 0);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('host ABI version mismatch는 fixed submit과 event watermark를 fail-closed 한다', () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        assert.equal(simulation.replaceBodies([{
            ...createBody(1),
            entityId: 51,
            incarnation: 1
        }]).accepted, 1);
        const submittedBefore = device.submissions.length;
        new DataView(simulation.hostStorage.countsBuffer).setUint32(
            GPU_CIRCLE_BODY_ABI.COUNTS.ABI_VERSION,
            GPU_CIRCLE_BODY_ABI_VERSION - 1,
            true
        );

        assert.equal(simulation.fixedUpdate(1 / 60, 500), false);
        const status = simulation.getStatus();
        assert.equal(status.state, 'requires-rebuild');
        assert.equal(status.failure.stage, 'abi-version');
        assert.equal(status.events.completedThroughTick, 0);
        assert.equal(device.submissions.length, submittedBefore);
        assert.equal(simulation.drainCompletedEventBatches([]).length, 0);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('contact event encoding mismatch는 stale payload를 decode하지 않고 rebuild를 요구한다', async () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 1,
        contactCapacity: 4,
        eventCapacity: 4,
        deathEventCapacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        device.eventPayloads.push({
            abiStatus: 0,
            eventEncodingVersion: GPU_CIRCLE_BODY_ABI_VERSION - 1,
            applied: [{
                entityId: 61,
                incarnation: 1,
                otherEntityId: 62,
                otherIncarnation: 1,
                damageFixedPoint: 100,
                eventMeta: packGpuCircleAppliedEventMeta(
                    GPU_CIRCLE_APPLIED_EVENT_TYPE.DAMAGE_APPLIED
                )
            }]
        });
        assert.equal(simulation.replaceBodies([{
            ...createBody(1),
            entityId: 61,
            incarnation: 1,
            interactionMask: 1,
            contactHandler: {
                damageOther: 1,
                flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
            }
        }]).accepted, 1);
        assert.equal(simulation.fixedUpdate(1 / 60, 600), true);
        device.resolveEventMap(0);
        await flushMicrotasks();

        const status = simulation.getStatus();
        assert.equal(status.state, 'requires-rebuild');
        assert.equal(status.failure.stage, 'event-readback');
        assert.equal(status.events.completedThroughTick, 0);
        assert.equal(simulation.drainCompletedEventBatches([]).length, 0);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('typed applied event의 unknown/모순 flag 조합은 decode 전에 fail-closed 한다', async () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const invalidCases = [{
        eventType: GPU_CIRCLE_APPLIED_EVENT_TYPE.INTERACTION_ENTER,
        flags: GPU_CIRCLE_APPLIED_EVENT_FLAG.CONTINUOUS_POLICY,
        valueFixedPoint: 0
    }, {
        eventType: GPU_CIRCLE_APPLIED_EVENT_TYPE.INTERACTION_CONTINUOUS,
        flags: GPU_CIRCLE_APPLIED_EVENT_FLAG.CONTINUOUS_POLICY
            | GPU_CIRCLE_APPLIED_EVENT_FLAG.TARGET_DIED,
        valueFixedPoint: 0
    }, {
        eventType: GPU_CIRCLE_APPLIED_EVENT_TYPE.DAMAGE_APPLIED,
        flags: GPU_CIRCLE_APPLIED_EVENT_FLAG.ENTER_POLICY | (1 << 20),
        valueFixedPoint: 100
    }];
    try {
        for (let index = 0; index < invalidCases.length; index++) {
            const invalid = invalidCases[index];
            const device = new FakeGpuDevice();
            const simulation = new GpuCircleBodySimulation(
                createFakePlatformPort(device),
                {
                    capacity: 1,
                    contactCapacity: 4,
                    eventCapacity: 4,
                    deathEventCapacity: 1,
                    worldSize: { x: 8, y: 8 },
                    gridCellSize: { x: 1, y: 1 }
                }
            );
            try {
                device.eventPayloads.push({
                    applied: [{
                        entityId: 71,
                        incarnation: 1,
                        otherEntityId: 72,
                        otherIncarnation: 1,
                        damageFixedPoint: invalid.valueFixedPoint,
                        eventMeta: packGpuCircleAppliedEventMeta(
                            invalid.eventType,
                            invalid.flags
                        )
                    }]
                });
                assert.equal(simulation.replaceBodies([{
                    ...createBody(1),
                    entityId: 71,
                    incarnation: 1,
                    interactionMask: 1,
                    contactHandler: {
                        damageOther: 1,
                        flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
                    }
                }]).accepted, 1);
                assert.equal(simulation.fixedUpdate(1 / 60, 700 + index), true);
                device.resolveEventMap(0);
                await flushMicrotasks();

                const status = simulation.getStatus();
                assert.equal(status.state, 'requires-rebuild');
                assert.equal(status.failure.stage, 'event-readback');
                assert.equal(status.events.completedThroughTick, 0);
                assert.equal(simulation.drainCompletedEventBatches([]).length, 0);
            } finally {
                simulation.destroy();
            }
        }
    } finally {
        restoreGlobals();
    }
});

test('마지막 non-event despawn은 in-flight overflow map 종료까지 GPU resource를 보존한다', async () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    device.deferOverflowMaps = true;
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        assert.equal(simulation.spawnBodies([{
            ...createBody(1),
            entityId: 71,
            incarnation: 1
        }]).accepted, 1);
        assert.equal(simulation.fixedUpdate(1 / 60, 700), true);
        assert.equal(simulation.getStatus().overflow.pendingReadbacks, 1);
        const physicsBuffer = device.buffers.get('cirvivor-gpu-circle-physics');
        const overflowBuffer = device.overflowMapRequests[0].buffer;

        assert.equal(simulation.despawnBodies([{
            entityId: 71,
            incarnation: 1
        }]).removed, 1);
        let status = simulation.getStatus();
        assert.equal(status.activeBodyCount, 0);
        assert.equal(status.overflow.pendingReadbacks, 1);
        assert.equal(status.state, 'ready');
        assert.equal(physicsBuffer.destroyed, false);
        assert.equal(overflowBuffer.destroyed, false);

        device.resolveOverflowMap(0);
        await flushMicrotasks();
        status = simulation.getStatus();
        assert.equal(status.state, 'idle');
        assert.equal(status.deviceGeneration, -1);
        assert.equal(status.overflow.pendingReadbacks, 0);
        assert.equal(physicsBuffer.destroyed, true);
        assert.equal(overflowBuffer.destroyed, true);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});

test('rebuild 뒤 완료된 old overflow callback은 새 epoch와 resource를 변경하지 않는다', async () => {
    const restoreGlobals = installFakeWebGpuGlobals();
    const device = new FakeGpuDevice();
    device.deferOverflowMaps = true;
    const simulation = new GpuCircleBodySimulation(createFakePlatformPort(device), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        assert.equal(simulation.replaceBodies([{
            ...createBody(1),
            entityId: 81,
            incarnation: 1
        }]).accepted, 1);
        assert.equal(simulation.fixedUpdate(1 / 60, 800), true);
        const oldPhysicsBuffer = device.buffers.get('cirvivor-gpu-circle-physics');
        const oldOverflowRequest = device.overflowMapRequests[0];
        const oldEpoch = simulation.getStatus().authoritativeEpoch;

        assert.equal(simulation.replaceBodies([{
            ...createBody(3),
            entityId: 82,
            incarnation: 1
        }]).accepted, 1);
        const newPhysicsBuffer = device.buffers.get('cirvivor-gpu-circle-physics');
        const beforeOldCallback = simulation.getStatus();
        assert.ok(beforeOldCallback.authoritativeEpoch > oldEpoch);
        assert.equal(beforeOldCallback.state, 'ready');
        assert.equal(beforeOldCallback.activeBodyCount, 1);
        assert.equal(beforeOldCallback.overflow.pendingReadbacks, 0);
        assert.notStrictEqual(newPhysicsBuffer, oldPhysicsBuffer);
        assert.equal(oldPhysicsBuffer.destroyed, true);
        assert.equal(newPhysicsBuffer.destroyed, false);

        oldOverflowRequest.resolve();
        await flushMicrotasks();
        const afterOldCallback = simulation.getStatus();
        assert.equal(afterOldCallback.authoritativeEpoch, beforeOldCallback.authoritativeEpoch);
        assert.equal(afterOldCallback.state, 'ready');
        assert.equal(afterOldCallback.activeBodyCount, 1);
        assert.equal(afterOldCallback.overflow.pendingReadbacks, 0);
        assert.equal(newPhysicsBuffer.destroyed, false);
        assert.equal(simulation.hasBody({ entityId: 82, incarnation: 1 }), true);
    } finally {
        simulation.destroy();
        restoreGlobals();
    }
});
