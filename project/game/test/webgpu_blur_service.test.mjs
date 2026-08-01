import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { WebGpuBlurService } = await loadGameModule(
    'display/webgpu/webgpu_blur_service.js'
);

function createComposerHarness() {
    const records = {
        active: true,
        insideEncodeCommands: false,
        encodeCommandsCount: 0,
        acquireCount: 0,
        finishCount: 0,
        submitCount: 0,
        markDrawnCount: 0,
        markClearedCount: 0
    };
    const devices = new Map();
    const getDevice = (deviceLabel) => {
        let device = devices.get(deviceLabel);
        if (!device) {
            device = {
                label: deviceLabel,
                queue: {
                    submit() {
                        records.submitCount += 1;
                    }
                }
            };
            devices.set(deviceLabel, device);
        }
        return device;
    };
    const contexts = {
        current: createContext(1, 1, getDevice('device-1'), records)
    };
    const composerPort = Object.freeze({
        encodeCommands(callback) {
            records.encodeCommandsCount += 1;
            if (!records.active) {
                return false;
            }
            records.insideEncodeCommands = true;
            try {
                return callback(contexts.current);
            } finally {
                records.insideEncodeCommands = false;
            }
        },
        isFrameActive() {
            return records.active;
        },
        acquireFrameTarget() {
            records.acquireCount += 1;
        },
        markCanvasDrawn() {
            records.markDrawnCount += 1;
        },
        markCanvasCleared() {
            records.markClearedCount += 1;
        }
    });

    return {
        composerPort,
        contexts,
        records,
        setContext(deviceGeneration, frameId, deviceLabel = `device-${deviceGeneration}`) {
            contexts.current = createContext(
                deviceGeneration,
                frameId,
                getDevice(deviceLabel),
                records
            );
        }
    };
}

function createContext(deviceGeneration, frameId, device, records = null) {
    const format = 'bgra8unorm';
    const width = 1920;
    const height = 1080;
    return Object.freeze({
        frameId,
        device,
        deviceGeneration,
        encoder: {
            finish() {
                if (records) records.finishCount += 1;
                return {};
            }
        },
        target: Object.freeze({
            device,
            deviceGeneration,
            format,
            width,
            height,
            texture: {},
            view: {}
        }),
        format,
        width,
        height
    });
}

function createAlgorithmRegistry(composerRecords) {
    const records = {
        factories: [],
        prepares: [],
        encodes: [],
        destroys: []
    };

    function createFactory(algorithmId) {
        return ({ device, deviceGeneration }) => {
            assert.equal(
                composerRecords.insideEncodeCommands,
                true,
                'algorithm factory도 composer encodeCommands context 안에서 생성되어야 합니다.'
            );
            const instanceId = `${algorithmId}@${deviceGeneration}`;
            const preparedResources = [];
            records.factories.push({ algorithmId, device, deviceGeneration, instanceId });
            return {
                prepare({ context, request, key }) {
                    assert.equal(composerRecords.insideEncodeCommands, true);
                    const prepared = {
                        instanceId,
                        preparedId: `${instanceId}:prepared:${preparedResources.length + 1}`,
                        destroyed: false
                    };
                    preparedResources.push(prepared);
                    records.prepares.push({ algorithmId, context, request, key, prepared });
                    return prepared;
                },
                encode({ context, request, key, prepared }) {
                    assert.equal(composerRecords.insideEncodeCommands, true);
                    assert.equal(prepared.instanceId, instanceId);
                    const output = Object.freeze({
                        algorithmId,
                        instanceId,
                        frameId: context.frameId,
                        key,
                        preparedId: prepared.preparedId,
                        outputSerial: records.encodes.length + 1
                    });
                    records.encodes.push({ algorithmId, context, request, key, prepared, output });
                    return output;
                },
                destroy() {
                    for (const prepared of preparedResources) {
                        prepared.destroyed = true;
                    }
                    records.destroys.push({
                        algorithmId,
                        instanceId,
                        deviceGeneration,
                        preparedResources: [...preparedResources]
                    });
                }
            };
        };
    }

    return {
        factories: new Map([
            ['gaussian', createFactory('gaussian')],
            ['kawase', createFactory('kawase')]
        ]),
        records
    };
}

function createRequest(overrides = {}) {
    return {
        algorithmId: 'gaussian',
        sourceTexture: overrides.sourceTexture || {},
        sourceRevision: 4,
        checkpointId: 'modal-depth-1',
        bounds: { x: 10, y: 12, width: 300, height: 180 },
        halo: 9,
        sigma: 6,
        edgeMode: 'clamp',
        colorSpace: 'srgb',
        format: 'rgba16float',
        ...overrides
    };
}

function assertNoForbiddenOwnership(records) {
    assert.deepEqual({
        acquireCount: records.acquireCount,
        finishCount: records.finishCount,
        submitCount: records.submitCount,
        markDrawnCount: records.markDrawnCount,
        markClearedCount: records.markClearedCount
    }, {
        acquireCount: 0,
        finishCount: 0,
        submitCount: 0,
        markDrawnCount: 0,
        markClearedCount: 0
    });
}

test('blur service는 composer callback 안에서만 선택한 algorithm prepare/encode를 호출한다', () => {
    const composer = createComposerHarness();
    const registry = createAlgorithmRegistry(composer.records);
    const service = new WebGpuBlurService({
        composerPort: composer.composerPort,
        algorithmFactories: registry.factories
    });
    const sourceTexture = {};

    const output = service.encode(createRequest({
        algorithmId: 'kawase',
        sourceTexture,
        sourceRevision: 3.9,
        checkpointId: '  menu-depth  ',
        bounds: { x: 10.8, y: -2.1, w: 100.2, h: 40.01 },
        halo: { horizontal: 4.2, vertical: 2.1 },
        sigma: -5,
        edgeMode: ' CLAMP ',
        colorSpace: ' SRGB ',
        format: ' RGBA8UNORM '
    }));

    assert.equal(output.algorithmId, 'kawase');
    assert.equal(registry.records.factories.length, 1);
    assert.equal(registry.records.prepares.length, 1);
    assert.equal(registry.records.encodes.length, 1);
    const normalized = registry.records.prepares[0].request;
    assert.strictEqual(normalized.sourceTexture, sourceTexture);
    assert.deepEqual({
        sourceRevision: normalized.sourceRevision,
        checkpointId: normalized.checkpointId,
        bounds: { ...normalized.bounds },
        halo: { ...normalized.halo },
        sigma: normalized.sigma,
        edgeMode: normalized.edgeMode,
        colorSpace: normalized.colorSpace,
        format: normalized.format
    }, {
        sourceRevision: 3,
        checkpointId: 'menu-depth',
        bounds: { x: 10, y: -3, width: 101, height: 41 },
        halo: { left: 5, top: 3, right: 5, bottom: 3 },
        sigma: 0,
        edgeMode: 'clamp',
        colorSpace: 'srgb',
        format: 'rgba8unorm'
    });
    assert.equal(Object.isFrozen(normalized), true);
    assert.equal(Object.isFrozen(service.getPort()), true);
    assert.equal(service.getSnapshot().maxPreparedEntries, 256);
    assertNoForbiddenOwnership(composer.records);
    service.destroy();
});

test('동일 frame+key는 output을 공유하고 checkpoint, source revision, texture, profile은 분리한다', () => {
    const composer = createComposerHarness();
    const registry = createAlgorithmRegistry(composer.records);
    const service = new WebGpuBlurService({
        composerPort: composer.composerPort,
        algorithmFactories: registry.factories
    });
    const sourceTexture = {};
    const base = createRequest({ sourceTexture });

    const first = service.encode(base);
    const merged = service.encode(createRequest({
        sourceTexture,
        bounds: { x: 10, y: 12, w: 300, h: 180 },
        halo: { left: 9, top: 9, right: 9, bottom: 9 }
    }));
    assert.strictEqual(merged, first);
    assert.equal(registry.records.prepares.length, 1);
    assert.equal(registry.records.encodes.length, 1);

    const checkpoint = service.encode(createRequest({
        sourceTexture,
        checkpointId: 'floating-depth'
    }));
    const revision = service.encode(createRequest({
        sourceTexture,
        sourceRevision: 5
    }));
    const texture = service.encode(createRequest({
        sourceTexture: {},
        sourceRevision: 4
    }));
    const profile = service.encode(createRequest({
        sourceTexture,
        sigma: 8,
        edgeMode: 'mirror',
        colorSpace: 'linear-srgb',
        format: 'rgba8unorm'
    }));
    assert.notStrictEqual(checkpoint, first);
    assert.notStrictEqual(revision, first);
    assert.notStrictEqual(texture, first);
    assert.notStrictEqual(profile, first);
    assert.equal(registry.records.prepares.length, 5);
    assert.equal(registry.records.encodes.length, 5);

    composer.setContext(1, 2, 'device-1');
    const nextFrame = service.encode(base);
    assert.notStrictEqual(nextFrame, first);
    assert.equal(registry.records.prepares.length, 5, 'prepare cache는 generation 동안 유지됩니다.');
    assert.equal(registry.records.encodes.length, 6);

    const snapshot = service.getSnapshot();
    assert.equal(snapshot.sharedOutputHitCount, 1);
    assert.equal(snapshot.prepareCount, 5);
    assert.equal(snapshot.prepareCacheHitCount, 1);
    assert.equal(snapshot.encodedOutputCount, 6);
    assert.equal(snapshot.algorithmInstanceCount, 1);
    assertNoForbiddenOwnership(composer.records);
    service.destroy();
});

test('algorithmId routing은 generation마다 algorithm instance 하나만 만들고 진단을 분리한다', () => {
    const composer = createComposerHarness();
    const registry = createAlgorithmRegistry(composer.records);
    const service = new WebGpuBlurService({
        composerPort: composer.composerPort,
        algorithmFactories: registry.factories
    });
    const sourceTexture = {};

    service.encode(createRequest({ sourceTexture, algorithmId: 'gaussian' }));
    service.encode(createRequest({ sourceTexture, algorithmId: 'kawase' }));
    service.encode(createRequest({ sourceTexture, algorithmId: 'kawase', sigma: 7 }));

    assert.deepEqual(
        registry.records.factories.map((entry) => entry.algorithmId),
        ['gaussian', 'kawase']
    );
    assert.deepEqual(
        registry.records.encodes.map((entry) => entry.algorithmId),
        ['gaussian', 'kawase', 'kawase']
    );
    const snapshot = service.getSnapshot();
    assert.equal(snapshot.algorithmCreateCount, 2);
    assert.deepEqual(Array.from(snapshot.algorithms, (entry) => ({
        algorithmId: entry.algorithmId,
        createCount: entry.createCount,
        prepareCount: entry.prepareCount,
        encodeCount: entry.encodeCount
    })), [
        { algorithmId: 'gaussian', createCount: 1, prepareCount: 1, encodeCount: 1 },
        { algorithmId: 'kawase', createCount: 1, prepareCount: 2, encodeCount: 2 }
    ]);
    assertNoForbiddenOwnership(composer.records);
    service.destroy();
});

test('device generation 증가 시 이전 algorithm/resource cache를 destroy하고 새 instance를 만든다', () => {
    const composer = createComposerHarness();
    const registry = createAlgorithmRegistry(composer.records);
    const service = new WebGpuBlurService({
        composerPort: composer.composerPort,
        algorithmFactories: registry.factories
    });
    const sourceTexture = {};

    const generationOne = service.encode(createRequest({ sourceTexture }));
    const firstPrepared = registry.records.prepares[0].prepared;
    composer.setContext(2, 1, 'device-2');
    const generationTwo = service.encode(createRequest({ sourceTexture }));

    assert.notStrictEqual(generationTwo, generationOne);
    assert.equal(firstPrepared.destroyed, true);
    assert.deepEqual(
        registry.records.factories.map((entry) => entry.deviceGeneration),
        [1, 2]
    );
    assert.deepEqual(
        registry.records.destroys.map((entry) => entry.deviceGeneration),
        [1]
    );
    const snapshot = service.getSnapshot();
    assert.equal(snapshot.deviceGeneration, 2);
    assert.equal(snapshot.generationChangeCount, 1);
    assert.equal(snapshot.algorithmCreateCount, 2);
    assert.equal(snapshot.algorithmDestroyCount, 1);
    assert.equal(snapshot.preparedCacheEntryCount, 1);

    service.destroy();
    service.destroy();
    assert.deepEqual(
        registry.records.destroys.map((entry) => entry.deviceGeneration),
        [1, 2]
    );
    assert.equal(service.getSnapshot().status, 'destroyed');
    assertNoForbiddenOwnership(composer.records);
});

test('이전 device generation과 역행 frame은 algorithm 호출 없이 stale로 거부한다', () => {
    const composer = createComposerHarness();
    const registry = createAlgorithmRegistry(composer.records);
    const service = new WebGpuBlurService({
        composerPort: composer.composerPort,
        algorithmFactories: registry.factories
    });
    const sourceTexture = {};

    service.encode(createRequest({ sourceTexture }));
    composer.setContext(2, 5, 'device-2');
    service.encode(createRequest({ sourceTexture }));
    const encodeCountBeforeReject = registry.records.encodes.length;

    composer.setContext(1, 999, 'device-1');
    assert.equal(service.encode(createRequest({ sourceTexture })), null);
    composer.setContext(2, 4, 'device-2');
    assert.equal(service.encode(createRequest({ sourceTexture })), null);
    assert.equal(registry.records.encodes.length, encodeCountBeforeReject);
    assert.deepEqual(
        registry.records.destroys.map((entry) => entry.deviceGeneration),
        [1]
    );

    const snapshot = service.getSnapshot();
    assert.equal(snapshot.deviceGeneration, 2);
    assert.equal(snapshot.currentFrameId, 5);
    assert.equal(snapshot.staleGenerationRejectCount, 1);
    assert.equal(snapshot.staleFrameRejectCount, 1);
    assert.equal(snapshot.lastRejectReason, 'stale-frame');
    assertNoForbiddenOwnership(composer.records);
    service.destroy();
});

test('inactive composer frame은 null을 반환하고 algorithm factory를 만들지 않는다', () => {
    const composer = createComposerHarness();
    const registry = createAlgorithmRegistry(composer.records);
    const service = new WebGpuBlurService({
        composerPort: composer.composerPort,
        algorithmFactories: registry.factories
    });
    composer.records.active = false;

    assert.equal(service.encode(createRequest()), null);
    assert.equal(registry.records.factories.length, 0);
    assert.equal(service.getSnapshot().inactiveFrameRejectCount, 1);
    assertNoForbiddenOwnership(composer.records);
    service.destroy();
});

test('opaque undefined output도 동일 frame+key에서 재인코딩하지 않는다', () => {
    const composer = createComposerHarness();
    let encodeCount = 0;
    const service = new WebGpuBlurService({
        composerPort: composer.composerPort,
        algorithmFactories: {
            opaque: () => ({
                prepare() {
                    return undefined;
                },
                encode() {
                    encodeCount += 1;
                    return undefined;
                },
                destroy() {}
            })
        }
    });
    const sourceTexture = {};
    const request = createRequest({ algorithmId: 'opaque', sourceTexture });

    assert.equal(service.encode(request), undefined);
    assert.equal(service.encode(request), undefined);
    assert.equal(encodeCount, 1);
    assert.equal(service.getSnapshot().sharedOutputHitCount, 1);
    assertNoForbiddenOwnership(composer.records);
    service.destroy();
});

test('prepare cache LRU는 hit를 갱신하고 eviction 시 algorithm resource를 파괴하지 않는다', () => {
    const composer = createComposerHarness();
    const registry = createAlgorithmRegistry(composer.records);
    const createService = (maxPreparedEntries) => new WebGpuBlurService({
        composerPort: composer.composerPort,
        algorithmFactories: registry.factories,
        maxPreparedEntries
    });
    assert.throws(() => createService(0), /maxPreparedEntries/);
    assert.throws(() => createService(1.5), /maxPreparedEntries/);

    const service = createService(3);
    const sourceTexture = {};
    const encodeRevision = (sourceRevision, frameId) => {
        composer.setContext(1, frameId, 'device-1');
        return service.encode(createRequest({ sourceTexture, sourceRevision }));
    };

    encodeRevision(1, 1);
    encodeRevision(2, 2);
    encodeRevision(3, 3);
    encodeRevision(1, 4); // revision 1을 MRU로 갱신합니다.
    encodeRevision(4, 5); // revision 2가 eviction됩니다.
    encodeRevision(2, 6); // evicted revision 2는 다시 prepare됩니다.

    assert.deepEqual(
        registry.records.prepares.map((entry) => entry.request.sourceRevision),
        [1, 2, 3, 4, 2]
    );
    const snapshot = service.getSnapshot();
    assert.equal(snapshot.maxPreparedEntries, 3);
    assert.equal(snapshot.preparedCacheEntryCount, 3);
    assert.equal(snapshot.prepareCacheHitCount, 1);
    assert.equal(snapshot.preparedCacheEvictionCount, 2);
    assert.equal(registry.records.destroys.length, 0);
    assert.equal(
        registry.records.prepares.every((entry) => entry.prepared.destroyed === false),
        true
    );

    service.destroy();
    assert.equal(
        registry.records.prepares.every((entry) => entry.prepared.destroyed === true),
        true
    );
    assertNoForbiddenOwnership(composer.records);
});

test('1000개 animated request에서도 generation prepare cache는 상한을 넘지 않는다', () => {
    const composer = createComposerHarness();
    const registry = createAlgorithmRegistry(composer.records);
    const maxPreparedEntries = 17;
    const service = new WebGpuBlurService({
        composerPort: composer.composerPort,
        algorithmFactories: registry.factories,
        maxPreparedEntries
    });
    const sourceTexture = {};

    for (let index = 0; index < 1000; index += 1) {
        composer.setContext(1, index + 1, 'device-1');
        service.encode(createRequest({ sourceTexture, sourceRevision: index }));
        assert.ok(service.getSnapshot().preparedCacheEntryCount <= maxPreparedEntries);
    }

    const snapshot = service.getSnapshot();
    assert.equal(snapshot.preparedCacheEntryCount, maxPreparedEntries);
    assert.equal(snapshot.preparedCacheEvictionCount, 1000 - maxPreparedEntries);
    assert.equal(snapshot.prepareCount, 1000);
    assert.equal(snapshot.frameOutputCount, 1);
    assert.equal(registry.records.destroys.length, 0);
    assertNoForbiddenOwnership(composer.records);
    service.destroy();
});

test('composer 고정 context와 target identity drift는 algorithm 호출 전에 fail-closed 거부한다', () => {
    const composer = createComposerHarness();
    const registry = createAlgorithmRegistry(composer.records);
    const service = new WebGpuBlurService({
        composerPort: composer.composerPort,
        algorithmFactories: registry.factories
    });
    const validContext = composer.contexts.current;
    const invalidContexts = [
        Object.freeze({ ...validContext, encoder: null }),
        Object.freeze({ ...validContext, target: null }),
        Object.freeze({ ...validContext, format: '' }),
        Object.freeze({ ...validContext, width: 0 }),
        Object.freeze({ ...validContext, height: 0 }),
        Object.freeze({
            ...validContext,
            target: Object.freeze({ ...validContext.target, device: {} })
        }),
        Object.freeze({
            ...validContext,
            target: Object.freeze({ ...validContext.target, deviceGeneration: 2 })
        }),
        Object.freeze({
            ...validContext,
            target: Object.freeze({ ...validContext.target, format: 'rgba8unorm' })
        }),
        Object.freeze({
            ...validContext,
            target: Object.freeze({ ...validContext.target, width: 1919 })
        }),
        Object.freeze({
            ...validContext,
            target: Object.freeze({ ...validContext.target, height: 1079 })
        })
    ];
    const request = createRequest({ sourceTexture: {} });

    for (const invalidContext of invalidContexts) {
        composer.contexts.current = invalidContext;
        assert.equal(service.encode(request), null);
    }
    assert.equal(registry.records.factories.length, 0);
    assert.equal(service.getSnapshot().invalidContextRejectCount, invalidContexts.length);
    assert.equal(service.getSnapshot().lastRejectReason, 'invalid-composer-context');

    composer.contexts.current = validContext;
    assert.equal(service.encode(request).algorithmId, 'gaussian');
    assert.equal(registry.records.factories.length, 1);
    assertNoForbiddenOwnership(composer.records);
    service.destroy();
});
