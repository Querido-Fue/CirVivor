import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SERVICE_PATH = fileURLToPath(new URL(
    '../script/module/display/webgpu/webgpu_platform_service.js',
    import.meta.url
));
const INDEX_PATH = fileURLToPath(new URL('../index.html', import.meta.url));
const STYLE_PATH = fileURLToPath(new URL('../style.css', import.meta.url));
const [serviceSource, indexSource, styleSource] = await Promise.all([
    readFile(SERVICE_PATH, 'utf8'),
    readFile(INDEX_PATH, 'utf8'),
    readFile(STYLE_PATH, 'utf8')
]);

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function loadServiceModule(globals = {}) {
    const context = vm.createContext({ console, ...globals });
    const module = new vm.SourceTextModule(serviceSource, {
        context,
        identifier: SERVICE_PATH
    });
    await module.link(() => {
        throw new Error('WebGpuPlatformService에는 import가 없어야 합니다.');
    });
    await module.evaluate();
    return module.namespace;
}

function createReadyHarness(deviceCount = 1) {
    const records = {
        adapterRequests: [],
        deviceRequests: 0,
        deviceRequestOptions: [],
        contextTypes: [],
        configurations: [],
        unconfigureCount: 0,
        textureRequests: 0,
        viewRequests: 0,
        encoders: [],
        renderPasses: [],
        passEndCount: 0,
        finishes: 0,
        submissions: [],
        deviceDestroyCount: 0
    };
    const devices = [];
    const adapters = [];

    for (let index = 0; index < deviceCount; index += 1) {
        const lost = createDeferred();
        const commandBuffer = { id: `command-buffer:${index}` };
        const device = {
            limits: {
                maxBufferSize: 268_435_456,
                maxStorageBufferBindingSize: 134_217_728,
                maxStorageBuffersPerShaderStage: 10,
                maxStorageTexturesPerShaderStage: 4,
                maxBindGroups: 4,
                maxBindingsPerBindGroup: 1000,
                maxComputeWorkgroupSizeX: 256,
                maxComputeInvocationsPerWorkgroup: 256,
                maxComputeWorkgroupsPerDimension: 65_535,
                maxComputeWorkgroupStorageSize: 16_384,
                maxTextureDimension2D: 8192,
                minStorageBufferOffsetAlignment: 256,
                minUniformBufferOffsetAlignment: 256
            },
            features: new Set(['timestamp-query']),
            lost: lost.promise,
            queue: {
                submit(commandBuffers) {
                    records.submissions.push(commandBuffers);
                }
            },
            createCommandEncoder(options) {
                records.encoders.push(options);
                return {
                    beginRenderPass(descriptor) {
                        records.renderPasses.push(descriptor);
                        return {
                            end() {
                                records.passEndCount += 1;
                            }
                        };
                    },
                    finish() {
                        records.finishes += 1;
                        return commandBuffer;
                    }
                };
            },
            destroy() {
                records.deviceDestroyCount += 1;
                lost.resolve({ reason: 'destroyed', message: 'test destroy' });
            },
            resolveLoss(info = { reason: 'unknown', message: 'test loss' }) {
                lost.resolve(info);
            }
        };
        const adapter = {
            info: {
                vendor: 'test-vendor',
                architecture: `test-architecture:${index}`,
                device: `test-device:${index}`,
                description: 'test adapter'
            },
            limits: device.limits,
            features: device.features,
            async requestDevice(options) {
                records.deviceRequests += 1;
                records.deviceRequestOptions.push(options);
                return device;
            }
        };
        devices.push(device);
        adapters.push(adapter);
    }

    let adapterIndex = 0;
    const gpu = {
        async requestAdapter(options) {
            records.adapterRequests.push(options);
            const adapter = adapters[Math.min(adapterIndex, adapters.length - 1)] ?? null;
            adapterIndex += 1;
            return adapter;
        },
        getPreferredCanvasFormat() {
            return 'bgra8unorm';
        }
    };
    const textureView = { id: 'texture-view' };
    const texture = {
        createView() {
            records.viewRequests += 1;
            return textureView;
        }
    };
    const context = {
        configure(configuration) {
            records.configurations.push(configuration);
        },
        unconfigure() {
            records.unconfigureCount += 1;
        },
        getCurrentTexture() {
            records.textureRequests += 1;
            return texture;
        }
    };
    const canvas = {
        width: 64,
        height: 36,
        getContext(type) {
            records.contextTypes.push(type);
            return context;
        }
    };
    return { records, devices, adapters, gpu, context, canvas, texture, textureView };
}

async function flushUntil(predicate, label) {
    for (let index = 0; index < 64; index += 1) {
        if (predicate()) return;
        await Promise.resolve();
    }
    assert.fail(`${label} 조건이 Promise queue 안에서 충족되지 않았습니다.`);
}

test('gpu-object canvas는 background와 object 사이의 투명 비입력 레이어다', () => {
    const backgroundIndex = indexSource.indexOf('id="background"');
    const gpuObjectIndex = indexSource.indexOf('id="gpu-object"');
    const objectIndex = indexSource.indexOf('id="object"');
    assert.ok(backgroundIndex >= 0);
    assert.ok(backgroundIndex < gpuObjectIndex);
    assert.ok(gpuObjectIndex < objectIndex);

    const gpuObjectStyle = styleSource.match(/#gpu-object\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(gpuObjectStyle, /z-index:\s*5\s*;/);
    assert.match(gpuObjectStyle, /background-color:\s*rgba\(0,\s*0,\s*0,\s*0\)\s*;/);
    assert.match(gpuObjectStyle, /pointer-events:\s*none\s*;/);
});

test('capability probe 실패는 reject하지 않고 구체적인 unsupported 이유를 노출한다', async () => {
    const namespace = await loadServiceModule();
    const { WebGpuPlatformService } = namespace;
    const canvas = { width: 1, height: 1, getContext: () => ({}) };
    const scenarios = [
        {
            reason: 'insecure-context',
            options: {
                canvas,
                secureContext: false,
                navigatorObject: Object.defineProperty({}, 'gpu', {
                    get() {
                        throw new Error('secure context guard 뒤 gpu를 읽으면 안 됩니다.');
                    }
                })
            }
        },
        {
            reason: 'navigator-gpu-unavailable',
            options: { canvas, secureContext: true, navigatorObject: {} }
        },
        {
            reason: 'canvas-unavailable',
            options: {
                canvas: null,
                secureContext: true,
                navigatorObject: {
                    gpu: { requestAdapter: async () => ({ requestDevice: async () => ({}) }) }
                }
            }
        },
        {
            reason: 'adapter-unavailable',
            options: {
                canvas,
                secureContext: true,
                navigatorObject: { gpu: { requestAdapter: async () => null } }
            }
        },
        {
            reason: 'adapter-limit-insufficient:maxStorageBuffersPerShaderStage:8<9',
            options: {
                canvas,
                secureContext: true,
                navigatorObject: {
                    gpu: {
                        requestAdapter: async () => ({
                            limits: { maxStorageBuffersPerShaderStage: 8 },
                            requestDevice: async () => {
                                throw new Error('한도 확인 실패 뒤 device를 요청하면 안 됩니다.');
                            }
                        })
                    }
                }
            }
        },
        {
            reason: 'device-request-failed:device denied',
            options: {
                canvas,
                secureContext: true,
                navigatorObject: {
                    gpu: {
                        requestAdapter: async () => ({
                            limits: { maxStorageBuffersPerShaderStage: 9 },
                            requestDevice: async () => {
                                throw new Error('device denied');
                            }
                        })
                    }
                }
            }
        },
        {
            reason: 'canvas-webgpu-context-unavailable',
            options: {
                canvas: { width: 1, height: 1, getContext: () => null },
                secureContext: true,
                navigatorObject: {
                    gpu: {
                        requestAdapter: async () => ({
                            limits: { maxStorageBuffersPerShaderStage: 9 },
                            requestDevice: async () => ({ destroy() {} })
                        }),
                        getPreferredCanvasFormat: () => 'bgra8unorm'
                    }
                }
            }
        }
    ];

    for (const scenario of scenarios) {
        const service = new WebGpuPlatformService(scenario.options);
        const state = await service.init();
        assert.equal(state.status, 'unsupported');
        assert.equal(state.ready, false);
        assert.equal(state.reason, scenario.reason);
        assert.equal(service.getDevice(), null);
        assert.equal(service.acquireFrameTarget(), null);
        assert.equal((await service.init()).reason, scenario.reason);
        service.destroy();
    }
});

test('READY 서비스는 premultiplied context, limits, frame target, clear/draw, resize port를 제공한다', async () => {
    const harness = createReadyHarness();
    const namespace = await loadServiceModule();
    const stateEvents = [];
    let drawCount = 0;
    let clearCount = 0;
    const service = new namespace.WebGpuPlatformService({
        canvas: harness.canvas,
        navigatorObject: { gpu: harness.gpu },
        secureContext: true,
        onStateChange: (state) => stateEvents.push(state.status),
        onCanvasDrawn: () => { drawCount += 1; },
        onCanvasCleared: () => { clearCount += 1; }
    });

    const state = await service.init();
    assert.equal(state.status, 'ready');
    assert.equal(state.ready, true);
    assert.equal(state.deviceGeneration, 1);
    assert.equal(state.format, 'bgra8unorm');
    assert.equal(state.limits.maxComputeWorkgroupSizeX, 256);
    assert.deepEqual(Array.from(state.features), ['timestamp-query']);
    assert.equal(state.adapterInfo.vendor, 'test-vendor');
    assert.equal(harness.records.adapterRequests.length, 1);
    assert.equal(harness.records.adapterRequests[0].powerPreference, 'high-performance');
    assert.equal(harness.records.deviceRequestOptions.length, 1);
    assert.equal(
        harness.records.deviceRequestOptions[0]
            .requiredLimits.maxStorageBuffersPerShaderStage,
        9
    );
    assert.deepEqual(harness.records.contextTypes, ['webgpu']);
    assert.equal(harness.records.configurations.length, 1);
    assert.equal(harness.records.configurations[0].device, harness.devices[0]);
    assert.equal(harness.records.configurations[0].format, 'bgra8unorm');
    assert.equal(harness.records.configurations[0].alphaMode, 'premultiplied');
    assert.deepEqual(stateEvents, ['probing', 'ready']);
    assert.equal(clearCount, 1);

    const port = service.getPort();
    assert.strictEqual(service.getPort(), port);
    assert.strictEqual(port.getDevice(), harness.devices[0]);
    assert.strictEqual(port.getCanvasContext(), harness.context);
    assert.equal(port.getCanvasFormat(), 'bgra8unorm');
    assert.equal(port.getDeviceGeneration(), 1);
    const frame = port.acquireFrameTarget();
    assert.strictEqual(frame.device, harness.devices[0]);
    assert.strictEqual(frame.texture, harness.texture);
    assert.strictEqual(frame.view, harness.textureView);
    assert.equal(frame.width, 64);
    assert.equal(frame.height, 36);

    assert.equal(port.markCanvasDrawn(), true);
    assert.equal(drawCount, 1);
    assert.equal(clearCount, 2);
    assert.equal(port.clearCanvas(), true);
    assert.equal(clearCount, 3);
    assert.equal(harness.records.textureRequests, 2);
    assert.equal(harness.records.viewRequests, 2);
    assert.equal(harness.records.renderPasses.length, 1);
    const clearValue = harness.records.renderPasses[0].colorAttachments[0].clearValue;
    assert.equal(clearValue.r, 0);
    assert.equal(clearValue.g, 0);
    assert.equal(clearValue.b, 0);
    assert.equal(clearValue.a, 0);
    assert.equal(harness.records.passEndCount, 1);
    assert.equal(harness.records.finishes, 1);
    assert.equal(harness.records.submissions.length, 1);
    assert.equal(harness.records.submissions[0].length, 1);
    assert.equal(harness.records.submissions[0][0].id, 'command-buffer:0');

    assert.equal(service.resize(64, 36), false);
    assert.equal(service.resize(128, 72), true);
    assert.equal(harness.canvas.width, 128);
    assert.equal(harness.canvas.height, 72);
    assert.equal(harness.records.configurations.length, 2);
    assert.equal(clearCount, 4);

    const subscribedStates = [];
    const unsubscribe = port.subscribe((nextState) => subscribedStates.push(nextState.status));
    assert.deepEqual(subscribedStates, ['ready']);
    unsubscribe();
    service.destroy();
    assert.equal(service.getState().status, 'destroyed');
    assert.equal(port.getDevice(), null);
    assert.equal(port.acquireFrameTarget(), null);
    assert.equal(harness.records.unconfigureCount, 1);
    assert.equal(harness.records.deviceDestroyCount, 1);
});

test('frame composer attachment는 stable identity를 노출하고 detach와 service destroy에서 참조만 끊는다', async () => {
    const namespace = await loadServiceModule();
    let composerDestroyCount = 0;
    const composerPort = Object.freeze({
        id: 'frame-composer-port',
        destroy() {
            composerDestroyCount += 1;
        }
    });
    const service = new namespace.WebGpuPlatformService({
        canvas: null,
        navigatorObject: {},
        secureContext: false
    });
    const port = service.getPort();

    assert.strictEqual(service.getPort(), port);
    assert.equal(port.getFrameComposer(), null);
    assert.strictEqual(service.attachFrameComposer(composerPort), composerPort);
    assert.strictEqual(port.getFrameComposer(), composerPort);
    assert.strictEqual(service.attachFrameComposer(composerPort), composerPort);
    assert.strictEqual(port.getFrameComposer(), composerPort);
    assert.equal(service.attachFrameComposer(null), null);
    assert.equal(port.getFrameComposer(), null);
    assert.throws(
        () => service.attachFrameComposer('invalid-port'),
        /객체, 함수 또는 null/
    );

    assert.strictEqual(service.attachFrameComposer(composerPort), composerPort);
    service.destroy();
    assert.equal(port.getFrameComposer(), null);
    assert.equal(composerDestroyCount, 0);
    assert.equal(service.attachFrameComposer(composerPort), null);
    assert.equal(port.getFrameComposer(), null);
    assert.equal(composerDestroyCount, 0);
});

test('frame composer attachment는 reinitialize와 device loss 복구에서 유지되고 자원을 직접 파괴하지 않는다', async () => {
    const harness = createReadyHarness(3);
    const namespace = await loadServiceModule();
    let composerDestroyCount = 0;
    const composerPort = {
        destroy() {
            composerDestroyCount += 1;
        }
    };
    const service = new namespace.WebGpuPlatformService({
        canvas: harness.canvas,
        navigatorObject: { gpu: harness.gpu },
        secureContext: true
    });
    const port = service.getPort();

    assert.strictEqual(service.attachFrameComposer(composerPort), composerPort);
    assert.equal((await service.init()).deviceGeneration, 1);
    assert.strictEqual(port.getFrameComposer(), composerPort);

    const reinitialized = await service.reinitialize();
    assert.equal(reinitialized.status, 'ready');
    assert.equal(reinitialized.deviceGeneration, 2);
    assert.strictEqual(port.getFrameComposer(), composerPort);
    assert.equal(composerDestroyCount, 0);

    harness.devices[1].resolveLoss({ reason: 'unknown', message: 'composer recovery' });
    await flushUntil(
        () => service.getState().status === 'ready'
            && service.getState().deviceGeneration === 3,
        'composer attachment device generation 3 복구'
    );
    assert.strictEqual(port.getFrameComposer(), composerPort);
    assert.equal(composerDestroyCount, 0);

    service.destroy();
    assert.equal(port.getFrameComposer(), null);
    assert.equal(composerDestroyCount, 0);
});

test('canvas signal은 snapshot 없이 clear→draw 순서로 매 프레임 surface revision을 재무장한다', async () => {
    const harness = createReadyHarness();
    const namespace = await loadServiceModule();
    const signalEvents = [];
    const signalArgumentCounts = [];
    const surface = {
        contentRevision: 0,
        drawCountThisFrame: 0,
        isEmpty: true
    };
    const service = new namespace.WebGpuPlatformService({
        canvas: harness.canvas,
        navigatorObject: { gpu: harness.gpu },
        secureContext: true,
        onCanvasDrawn(...args) {
            signalEvents.push('draw');
            signalArgumentCounts.push(args.length);
            surface.drawCountThisFrame += 1;
            surface.isEmpty = false;
            if (surface.drawCountThisFrame === 1) {
                surface.contentRevision += 1;
            }
        },
        onCanvasCleared(...args) {
            signalEvents.push('clear');
            signalArgumentCounts.push(args.length);
            const wasNonEmpty = surface.isEmpty !== true;
            surface.drawCountThisFrame = 0;
            surface.isEmpty = true;
            if (wasNonEmpty) {
                surface.contentRevision += 1;
            }
        }
    });

    await service.init();
    assert.deepEqual(signalEvents, ['clear']);
    signalEvents.length = 0;
    signalArgumentCounts.length = 0;

    const originalGetState = service.getState;
    let stateSnapshotReads = 0;
    service.getState = function (...args) {
        stateSnapshotReads += 1;
        return originalGetState.apply(this, args);
    };

    const port = service.getPort();
    assert.equal(port.markCanvasDrawn(), true);
    const firstFrameRevision = surface.contentRevision;
    assert.deepEqual(signalEvents, ['clear', 'draw']);
    assert.equal(surface.drawCountThisFrame, 1);
    assert.equal(surface.isEmpty, false);
    assert.equal(firstFrameRevision, 1);

    assert.equal(port.markCanvasDrawn(), true);
    assert.deepEqual(signalEvents, ['clear', 'draw', 'clear', 'draw']);
    assert.equal(surface.drawCountThisFrame, 1);
    assert.equal(surface.isEmpty, false);
    assert.equal(surface.contentRevision, 3);
    assert.ok(surface.contentRevision > firstFrameRevision);

    signalEvents.length = 0;
    assert.equal(port.clearCanvas(), true);
    assert.deepEqual(signalEvents, ['clear']);
    assert.equal(surface.drawCountThisFrame, 0);
    assert.equal(surface.isEmpty, true);
    assert.equal(surface.contentRevision, 4);
    assert.equal(stateSnapshotReads, 0);
    assert.deepEqual(signalArgumentCounts, [0, 0, 0, 0, 0]);

    service.getState = originalGetState;
    const diagnosticState = service.getState();
    assert.equal(diagnosticState.status, 'ready');
    assert.equal(Object.isFrozen(diagnosticState), true);
    assert.equal(Object.isFrozen(diagnosticState.limits), true);
    assert.equal(Object.isFrozen(diagnosticState.features), true);

    const subscribedArguments = [];
    const unsubscribe = port.subscribe(function (...args) {
        subscribedArguments.push(args);
    });
    assert.equal(subscribedArguments.length, 1);
    assert.equal(subscribedArguments[0].length, 1);
    assert.equal(subscribedArguments[0][0].status, 'ready');
    assert.equal(Object.isFrozen(subscribedArguments[0][0]), true);
    unsubscribe();
    service.destroy();
});

test('device.lost는 surface를 비우고 새 device generation으로 한 번 자동 복구한다', async () => {
    const harness = createReadyHarness(2);
    const namespace = await loadServiceModule();
    const statuses = [];
    let clearCount = 0;
    const service = new namespace.WebGpuPlatformService({
        canvas: harness.canvas,
        navigatorObject: { gpu: harness.gpu },
        secureContext: true,
        onStateChange: (state) => statuses.push(state.status),
        onCanvasCleared: () => { clearCount += 1; }
    });

    await service.init();
    harness.devices[0].resolveLoss({ reason: 'unknown', message: 'driver reset' });
    await flushUntil(
        () => service.getState().status === 'ready'
            && service.getState().deviceGeneration === 2,
        'device generation 2 복구'
    );

    const recovered = service.getState();
    assert.equal(recovered.ready, true);
    assert.equal(recovered.deviceGeneration, 2);
    assert.strictEqual(service.getDevice(), harness.devices[1]);
    assert.deepEqual(statuses, ['probing', 'ready', 'lost', 'probing', 'ready']);
    assert.equal(harness.records.adapterRequests.length, 2);
    assert.equal(harness.records.deviceRequests, 2);
    assert.equal(harness.records.contextTypes.length, 2);
    assert.equal(harness.records.configurations.length, 2);
    assert.equal(harness.records.unconfigureCount, 1);
    assert.equal(clearCount, 3);

    service.destroy();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(service.getState().status, 'destroyed');
    assert.equal(harness.records.adapterRequests.length, 2);
    assert.equal(harness.records.deviceDestroyCount, 1);
    assert.equal(harness.records.unconfigureCount, 2);
});
