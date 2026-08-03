import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { GpuCircleBodySimulation } = await loadGameModule(
    'ingame/physics/gpu/gpu_circle_body_simulation.js'
);
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
        layerMask: 1,
        collisionMask: 1,
        alive: true
    };
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
        this.data = new ArrayBuffer(descriptor.size);
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
        this.deferOverflowMaps = false;
        this.overflowMapRequests = [];
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
                if (target.label.includes('event-readback')) {
                    device.#writeEventReadbackCopy(source, target, targetOffset);
                    return;
                }
                new Uint8Array(target.data, targetOffset, size).set(
                    new Uint8Array(source.data, sourceOffset, size)
                );
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

    #writeEventReadbackCopy(source, target, targetOffset) {
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
                view.setInt32(offset + 16, event.damageFixedPoint, true);
                view.setUint32(offset + 20, event.flags ?? 0, true);
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
        simulationMeta: 1
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
                flags: 1,
                x: 1.5,
                y: -2
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
            sensorMask: 1,
            health: 3.25,
            contactHandler: {
                damageSelf: 1,
                damageOther: 2.5
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
            'contact-handling'
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
            'contact-handling': 9
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
            operations.slice(0, 8).map((operation) => operation.entryPoint),
            [
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
        assert.equal(operations[3].mode, 'direct');
        assert.equal(operations[3].workgroups, 1);
        assert.equal(operations[6].mode, 'direct');
        assert.equal(operations[6].workgroups, 1);
        assert.deepEqual(
            operations.slice(0, 8).map(({ pipelineLayout }) => pipelineLayout),
            [
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
            'cirvivor-gpu-circle-compute-bodies-base',
            'cirvivor-gpu-circle-compute-world-full',
            'cirvivor-gpu-circle-compute-params'
        ]);
        assert.deepEqual(operations[4].bindGroups, [
            'cirvivor-gpu-circle-compute-bodies-with-handlers',
            'cirvivor-gpu-circle-compute-world-grid',
            'cirvivor-gpu-circle-compute-params',
            'cirvivor-gpu-circle-compute-contact-events'
        ]);
        assert.deepEqual(operations[5].bindGroups, [
            'cirvivor-gpu-circle-compute-bodies-base',
            'cirvivor-gpu-circle-compute-world-sdf',
            'cirvivor-gpu-circle-compute-params',
            'cirvivor-gpu-circle-compute-contact-events'
        ]);
        assert.deepEqual(operations[6].bindGroups, [
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
        assert.equal(batches[0].sourceTick, 100);
        assert.equal(batches[0].submittedTick, 1);
        assert.equal(batches[0].deviceGeneration, 1);
        assert.equal(batches[0].completedThroughTick, 101);
        assert.equal(batches[0].events.length, 2);
        const contact = batches[0].events[0];
        assert.equal(contact.type, 'contact');
        assert.equal(contact.sequence, 0);
        assert.equal(contact.entityId, 11);
        assert.equal(contact.incarnation, 2);
        assert.equal(contact.other.entityId, 22);
        assert.equal(contact.other.incarnation, 3);
        assert.equal(contact.damageFixedPoint, 123);
        assert.equal(contact.damage, 1.23);
        assert.equal(contact.position.x, 1.5);
        assert.equal(contact.position.y, -2);
        assert.equal(contact.flags, 1);
        assert.equal(contact.reason, 'target-died');
        const death = batches[0].events[1];
        assert.equal(death.type, 'death');
        assert.equal(death.sequence, 1);
        assert.equal(death.entityId, 22);
        assert.equal(death.incarnation, 3);
        assert.equal(death.bodyId, 1);
        assert.equal(death.damageFixedPoint, 0);
        assert.equal(death.reason, 'health');
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
            sensorMask: 1
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
            sensorMask: 1
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
