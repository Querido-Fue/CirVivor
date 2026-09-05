import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const source = await readFile(
    new URL('../project/game/script/module/scene/title/webgpu/_title_webgpu_base_graph.js', import.meta.url),
    'utf8'
);
const module = await loadGameModule('scene/title/webgpu/_title_webgpu_base_graph.js');
const checkpointModule = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_checkpoint_registry.js'
);

const {
    TitleWebGpuBaseGraph,
    getTitleWebGpuBaseGraphBlurAlgorithmId
} = module;

test('pipeline mode는 optimized Kawase/Gaussian ID에 명시적으로 매핑된다', () => {
    assert.doesNotMatch(
        source,
        /from\s+['"]display\/webgpu\/webgpu_gaussian_blur_algorithm\.js/u,
        'Gaussian 구현 parse/import 실패가 Kawase graph 로드를 막으면 안 됨'
    );
    assert.doesNotMatch(
        source,
        /from\s+['"]display\/webgpu\/webgpu_optimized_kawase_blur_algorithm\.js/u,
        'optimized Kawase 구현 parse/import 실패가 compatibility graph 로드를 막으면 안 됨'
    );
    assert.equal(
        getTitleWebGpuBaseGraphBlurAlgorithmId('webgpu-kawase'),
        'kawase-optimized'
    );
    assert.equal(
        getTitleWebGpuBaseGraphBlurAlgorithmId('webgpu-gaussian'),
        'gaussian-quality'
    );
    assert.equal(getTitleWebGpuBaseGraphBlurAlgorithmId('legacy-webgl'), null);
});

test('legacy center Kawase offset은 quality 경로에서 시각 sigma로 변환되고 halo도 변환값을 따른다', () => {
    const kawase = createFixture({ blurAlgorithmId: 'kawase-compatibility' });
    const kawaseInput = createInput({ introBlur: 0 });
    kawaseInput.centerCommand.backdropBlur = 0.1;
    assert.equal(kawase.graph.encode(kawaseInput), true);
    assert.equal(kawase.blurRequests[0].sigma, 0.1);
    kawase.framePort.abort();

    const kawaseFallback = createFixture({ blurAlgorithmId: 'kawase-compatibility' });
    const kawaseFallbackInput = createInput({ introBlur: 0 });
    delete kawaseFallbackInput.centerCommand.backdropBlur;
    assert.equal(kawaseFallback.graph.encode(kawaseFallbackInput), true);
    assert.equal(kawaseFallback.blurRequests[0].sigma, 0.1);
    kawaseFallback.framePort.abort();

    const gaussian = createFixture({ blurAlgorithmId: 'gaussian-quality' });
    const gaussianInput = createInput({ introBlur: 0 });
    gaussianInput.centerCommand.backdropBlur = 0.1;
    assert.equal(gaussian.graph.encode(gaussianInput), true);
    assert.equal(gaussian.blurRequests[0].sigma, 6.5);
    assert.equal(gaussian.blurRequests[0].halo.left, 22);
    gaussian.framePort.abort();

    const optimizedKawase = createFixture({ blurAlgorithmId: 'kawase-optimized' });
    const optimizedInput = createInput({ introBlur: 0 });
    optimizedInput.centerCommand.backdropBlur = 0.1;
    assert.equal(optimizedKawase.graph.encode(optimizedInput), true);
    assert.equal(optimizedKawase.blurRequests[0].sigma, 6.5);
    assert.equal(optimizedKawase.blurRequests[0].halo.left, 22);
    optimizedKawase.framePort.abort();
});

test('algorithm halo preflight가 fallback보다 크면 crop 전에 ROI에 반영한다', () => {
    const fixture = createFixture({
        blurAlgorithmId: 'kawase-optimized',
        requiredHaloResolver({ algorithmId, sigma }) {
            assert.equal(algorithmId, 'kawase-optimized');
            return sigma === 7.5625 ? 32 : null;
        }
    });
    const input = createInput({ introBlur: 7.5625 });
    assert.equal(fixture.graph.encode(input), true);
    assert.equal(fixture.blurRequests[1].sigma, 7.5625);
    assert.equal(fixture.blurRequests[1].halo.left, 32);
    assert.ok(fixture.graph.getDiagnostics().lastRoi.width >= 424);
    fixture.framePort.abort();
});

test('base graph는 A→center snapshot→shield→center→intro blur→A in-place overlay:0 순서를 shadow-only로 기록한다', () => {
    const fixture = createFixture();
    const input = createInput({ introBlur: 10, logoRevision: 4 });

    assert.equal(
        fixture.graph.encode(input),
        true,
        fixture.framePort.lastError?.stack ?? 'graph encode failed'
    );
    assert.deepEqual(fixture.trace, [
        'pool:begin:1:1:1280x720',
        'gradient:clear',
        'enemy:load',
        'composite:title-center-backdrop-crop:1:clear:scene',
        'shield:clear',
        'blur:title:center-backdrop',
        'center:load',
        'blur:title:intro-effect',
        'atlas:upload:4',
        'composite:title-base-checkpoint:1:load:blur:title:intro-effect>logo:4'
    ]);

    const centerCheckpoint = fixture.graph.getCheckpoint(
        checkpointModule.TITLE_WEBGPU_CENTER_BACKDROP_ID
    );
    const baseCheckpoint = fixture.graph.getCheckpoint(
        checkpointModule.TITLE_WEBGPU_BASE_CHECKPOINT_ID
    );
    assert.ok(centerCheckpoint);
    assert.ok(baseCheckpoint);
    assert.notStrictEqual(centerCheckpoint.texture, baseCheckpoint.texture);
    assert.strictEqual(baseCheckpoint.texture, baseCheckpoint.view.texture);
    assert.equal(fixture.finalCompositeSafety.length, 1);
    assert.deepEqual(fixture.finalCompositeSafety[0], {
        targetIsScene: true,
        sourceAliasesTarget: false,
        layerCount: 2
    });
    assert.equal(fixture.framePort.context.device.createdDescriptors.filter(
        (descriptor) => descriptor.size.width === 1280 && descriptor.size.height === 720
    ).length, 1, 'final B 전해상도 texture allocation 금지');
    assert.equal(fixture.graph.getDiagnostics().texturePool.textureCount, 3);
    assert.equal(fixture.framePort.canvasWriteCount, 0);
    assert.equal(fixture.framePort.markCount, 0);

    const centerBlur = fixture.blurRequests[0];
    assert.strictEqual(centerBlur.sourceTexture, centerCheckpoint.texture);
    assert.equal(centerBlur.checkpointId, 'title:center-backdrop');
    assert.equal(centerBlur.sigma, 6.5);
    assert.equal(centerCheckpoint.width, 400);
    assert.equal(centerCheckpoint.height, 400);
    assert.equal(centerBlur.bounds.width, 360);
    assert.ok(
        fixture.poolAcquireDescriptors[2].width > centerCheckpoint.width,
        'intro effect ROI와 center backdrop ROI를 독립 크기로 유지'
    );
    assert.equal(fixture.blurRequests[1].checkpointId, 'title:intro-effect');
    assert.equal(fixture.blurRequests[1].sigma, 10);
    assert.ok(fixture.blurRequests[1].bounds.width > centerBlur.bounds.width);

    fixture.framePort.commit();
    assert.equal(fixture.trace.at(-1), 'pool:end');
    assert.equal(fixture.graph.getCheckpoint('title:overlay:0'), null);
    const diagnostics = fixture.graph.getDiagnostics();
    assert.equal(diagnostics.commitCount, 1);
    assert.equal(diagnostics.abortCount, 0);
});

test('intro blur가 0이면 shield는 scene에 직접 그리고 center만 작은 ROI에서 합성한다', () => {
    const fixture = createFixture();
    const first = createInput({ introBlur: 0, logoRevision: 8 });

    assert.equal(fixture.graph.encode(first), true);
    assert.equal(fixture.blurRequests.length, 1);
    assert.equal(fixture.blurRequests[0].checkpointId, 'title:center-backdrop');
    assert.deepEqual({ ...fixture.graph.getDiagnostics().lastRoi }, {
        x: 440,
        y: 160,
        width: 400,
        height: 400
    });
    assert.equal(fixture.graph.getDiagnostics().texturePool.textureCount, 2);
    assert.deepEqual(fixture.trace.slice(0, -1), [
        'pool:begin:1:1:1280x720',
        'gradient:clear',
        'enemy:load',
        'composite:title-center-backdrop-crop:1:clear:scene',
        'shield:load',
        'blur:title:center-backdrop',
        'center:load',
        'atlas:upload:8'
    ]);
    assert.match(
        fixture.trace.at(-1),
        /^composite:title-base-checkpoint:1:load:logo:8$/u
    );
    assert.equal(fixture.shieldInputs.length, 1);
    assert.strictEqual(fixture.shieldInputs[0].targetView, fixture.sceneView());
    assert.deepEqual({
        targetWidth: fixture.shieldInputs[0].targetWidth,
        targetHeight: fixture.shieldInputs[0].targetHeight,
        originX: fixture.shieldInputs[0].originX,
        originY: fixture.shieldInputs[0].originY,
        loadOp: fixture.shieldInputs[0].loadOp
    }, {
        targetWidth: 1280,
        targetHeight: 720,
        originX: 0,
        originY: 0,
        loadOp: 'load'
    });
    assert.deepEqual(fixture.finalCompositeSafety[0], {
        targetIsScene: true,
        sourceAliasesTarget: false,
        layerCount: 1
    });
    assert.match(fixture.trace.at(-1), /:logo:8$/);
    fixture.framePort.commit();

    fixture.framePort.nextFrame({ frameId: 2 });
    fixture.trace.length = 0;
    fixture.poolAcquireDescriptors.length = 0;
    assert.equal(fixture.graph.encode(first), true);
    assert.strictEqual(fixture.finalLayerArrays[0], fixture.finalLayerArrays[1]);
    assert.equal(fixture.uiAtlas.uploadCount, 1);
    assert.equal(fixture.uiAtlas.cacheHitCount, 1);
    assert.equal(fixture.graph.getDiagnostics().texturePool.allocationCount, 0);
    assert.equal(fixture.graph.getDiagnostics().texturePool.reuseCount, 2);
    assert.equal(fixture.poolAcquireDescriptors.length, 2);
    assert.equal(fixture.poolAcquireDescriptors.filter(
        (descriptor) => descriptor.width === 400 && descriptor.height === 400
    ).length, 1, 'center snapshot만 center ROI 크기로 유지');
    assert.equal(fixture.poolAcquireDescriptors.filter(
        (descriptor) => descriptor.width === 1280 && descriptor.height === 720
    ).length, 1, 'warm frame에서도 scene A 외 전해상도 lease 금지');
    fixture.framePort.commit();

    fixture.framePort.nextFrame({ frameId: 3 });
    assert.equal(fixture.graph.encode(createInput({ introBlur: 0, logoRevision: 9 })), true);
    assert.equal(fixture.uiAtlas.uploadCount, 2);
    fixture.framePort.commit();
});

test('비활성 shield는 fieldRadius ROI와 pass를 생략하고 center ROI만 blur한다', () => {
    const fixture = createFixture();
    const input = createInput({ introBlur: 0, logoRevision: 3 });
    input.shieldCommand.impacts.length = 0;
    input.shieldCommand.dents.length = 0;

    assert.equal(fixture.graph.encode(input), true);
    assert.equal(fixture.trace.includes('shield:clear'), false);
    assert.deepEqual({ ...fixture.graph.getDiagnostics().lastRoi }, {
        x: 440,
        y: 160,
        width: 400,
        height: 400
    });
    assert.equal(fixture.graph.getDiagnostics().shieldInactiveSkipCount, 1);
    assert.equal(fixture.blurRequests[0].bounds.width, 360);
    assert.equal(fixture.blurRequests[0].bounds.height, 360);
    fixture.framePort.commit();
});

test('effect와 logo가 없으면 scene A를 추가 composite 없이 바로 overlay:0으로 seal한다', () => {
    const fixture = createFixture();
    const input = createInput({ introBlur: 0 });
    input.centerCommand = null;
    input.shieldCommand = null;
    input.logoPacket = null;

    assert.equal(fixture.graph.encode(input), true);
    assert.deepEqual(fixture.trace, [
        'pool:begin:1:1:1280x720',
        'gradient:clear',
        'enemy:load'
    ]);
    const checkpoint = fixture.graph.getCheckpoint(
        checkpointModule.TITLE_WEBGPU_BASE_CHECKPOINT_ID
    );
    assert.ok(checkpoint);
    assert.strictEqual(checkpoint.texture, checkpoint.view.texture);
    assert.equal(fixture.finalLayerArrays.length, 0);
    assert.equal(fixture.graph.getDiagnostics().texturePool.textureCount, 1);
    fixture.framePort.commit();
});

test('같은 active frame 중복 encode, abort, resize와 generation 교체를 fail-closed로 처리한다', () => {
    const fixture = createFixture();
    const input = createInput({ introBlur: 5, logoRevision: 1 });
    assert.equal(fixture.graph.encode(input), true);
    assert.equal(fixture.graph.encode(input), false);
    fixture.framePort.abort();
    assert.equal(fixture.graph.getDiagnostics().abortCount, 1);
    assert.equal(fixture.graph.getDiagnostics().texturePool.frameActive, false);

    fixture.framePort.nextFrame({ frameId: 2, width: 1920, height: 1080 });
    assert.equal(fixture.graph.encode(input), true);
    const resizedRoi = fixture.graph.getDiagnostics().lastRoi;
    assert.equal(resizedRoi.x, 426);
    assert.equal(resizedRoi.y, 146);
    assert.equal(resizedRoi.width, 428);
    assert.equal(resizedRoi.height, 428);
    fixture.framePort.commit();

    const replacementDevice = createDevice();
    fixture.framePort.nextFrame({
        frameId: 3,
        deviceGeneration: 2,
        device: replacementDevice
    });
    assert.equal(fixture.graph.encode(input), true);
    assert.equal(fixture.graph.getDiagnostics().lastDeviceGeneration, 1);
    fixture.framePort.commit();
    assert.equal(fixture.graph.getDiagnostics().lastDeviceGeneration, 2);
});

test('same-generation device drift는 pool을 건드리기 전에 거부하고 기존 cache로 정상 재개한다', () => {
    const fixture = createFixture();
    const input = createInput({ introBlur: 0 });
    const originalDevice = fixture.framePort.context.device;
    assert.equal(fixture.graph.encode(input), true);
    fixture.framePort.commit();
    const cachedTextures = Array.from(
        fixture.graph.texturePool.entries,
        (entry) => entry.texture
    );
    assert.equal(cachedTextures.length, 2);

    const driftDevice = createDevice();
    fixture.framePort.nextFrame({ frameId: 2, device: driftDevice });
    assert.equal(fixture.graph.encode(input), false);
    assert.match(
        fixture.framePort.lastError?.message ?? '',
        /generation 변경 없는 title base graph device drift/u
    );
    assert.equal(driftDevice.createdDescriptors.length, 0);
    assert.equal(cachedTextures.every((texture) => texture.destroyed === false), true);
    assert.equal(fixture.graph.texturePool.entries.size, 2);

    fixture.framePort.nextFrame({ frameId: 3, device: originalDevice });
    assert.equal(fixture.graph.encode(input), true);
    assert.equal(fixture.graph.getDiagnostics().texturePool.allocationCount, 0);
    fixture.framePort.commit();
});

test('destroy는 active frame callback 뒤 graph-owned 리소스를 정확히 한 번 정리한다', () => {
    const fixture = createFixture();
    assert.equal(fixture.graph.encode(createInput()), true);
    assert.equal(fixture.graph.destroy(), true);
    assert.equal(fixture.graph.destroy(), false);
    assert.equal(fixture.destroyCounts.total, 0);
    fixture.framePort.abort();
    assert.equal(fixture.destroyCounts.total, 6);
    assert.equal(fixture.uiAtlas.destroyed, true);
    assert.equal(fixture.graph.getDiagnostics().status, 'destroyed');
});

function createFixture({
    blurAlgorithmId = 'kawase-compatibility',
    requiredHaloResolver = null
} = {}) {
    const trace = [];
    const blurRequests = [];
    const finalLayerArrays = [];
    const finalCompositeSafety = [];
    const poolAcquireDescriptors = [];
    const shieldInputs = [];
    const framePort = new FakeFramePort(createContext());
    const uiAtlas = new FakeUiAtlas(trace);
    const destroyCounts = { total: 0 };
    let sceneView = null;
    const graph = new TitleWebGpuBaseGraph({
        framePort,
        blurAlgorithmId,
        blurPort: {
            getRequiredHalo(request) {
                return requiredHaloResolver?.(request) ?? null;
            },
            encode(request) {
                blurRequests.push(request);
                trace.push(`blur:${request.checkpointId}`);
                const texture = { id: `blur-texture:${request.checkpointId}` };
                return {
                    texture,
                    view: { id: `blur:${request.checkpointId}`, texture },
                    width: Math.max(1, Math.floor(request.bounds.width / 8)),
                    height: Math.max(1, Math.floor(request.bounds.height / 8))
                };
            }
        },
        uiAtlas,
        gradientPass: createPass(destroyCounts, {
            encode(input) {
                assert.equal(input.context, framePort.context);
                sceneView = input.targetView;
                trace.push('gradient:clear');
            }
        }),
        enemyPass: createPass(destroyCounts, {
            encode(context, input) {
                assert.equal(context, framePort.context);
                trace.push(`enemy:${input.loadOp}`);
                return true;
            }
        }),
        shieldPass: createPass(destroyCounts, {
            encode(context, input) {
                shieldInputs.push(input);
                trace.push(`shield:${input.loadOp}`);
                return true;
            }
        }),
        centerPass: createPass(destroyCounts, {
            encode(context, input) {
                assert.notStrictEqual(input.targetView, input.backdropView);
                assert.ok(input.targetWidth > 0 && input.targetHeight > 0);
                trace.push(`center:${input.loadOp}`);
                return true;
            }
        }),
        compositePass: createPass(destroyCounts, {
            encode(context, input) {
                const ids = input.layers.map((layer) => (
                    layer.view === sceneView ? 'scene' : layer.view.id
                )).join('>');
                trace.push(`composite:${input.label}:${input.loadOp}:${ids}`);
                if (input.label.startsWith('title-base-checkpoint:')) {
                    finalLayerArrays.push(input.layers);
                    finalCompositeSafety.push({
                        targetIsScene: input.targetView === sceneView,
                        sourceAliasesTarget: input.layers.some(
                            (layer) => layer.view.texture === input.targetView.texture
                        ),
                        layerCount: input.layers.length
                    });
                }
                return true;
            }
        })
    });
    const originalPoolBegin = graph.texturePool.beginFrame.bind(graph.texturePool);
    const originalPoolAcquire = graph.texturePool.acquire.bind(graph.texturePool);
    const originalPoolEnd = graph.texturePool.endFrame.bind(graph.texturePool);
    graph.texturePool.beginFrame = (context) => {
        trace.push(`pool:begin:${context.frameId}:${context.deviceGeneration}:${context.width}x${context.height}`);
        return originalPoolBegin(context);
    };
    graph.texturePool.acquire = (descriptor) => {
        poolAcquireDescriptors.push({
            width: descriptor.width,
            height: descriptor.height,
            format: descriptor.format
        });
        return originalPoolAcquire(descriptor);
    };
    graph.texturePool.endFrame = () => {
        trace.push('pool:end');
        return originalPoolEnd();
    };
    const originalPoolDestroy = graph.texturePool.destroy.bind(graph.texturePool);
    graph.texturePool.destroy = () => {
        destroyCounts.total += 1;
        return originalPoolDestroy();
    };
    return {
        graph,
        framePort,
        trace,
        blurRequests,
        uiAtlas,
        finalLayerArrays,
        finalCompositeSafety,
        poolAcquireDescriptors,
        shieldInputs,
        sceneView: () => sceneView,
        destroyCounts
    };
}

function createInput({ introBlur = 10, logoRevision = 1 } = {}) {
    return {
        presentationSeconds: 12.5,
        gradientColors: new Float32Array(15),
        enemyPacket: { id: 'enemy-packet' },
        enemyPalette: new Float32Array(24),
        centerCommand: {
            x: 640,
            y: 360,
            radius: 90,
            outlineWidth: 3,
            scissorPaddingMin: 28,
            scissorPaddingRatio: 0.86,
            backdropBlur: 6.5,
            backdropRefractionStrength: 4.5
        },
        shieldCommand: {
            x: 640,
            y: 360,
            radius: 110,
            fieldRadius: 150,
            ringThickness: 4,
            glowWidth: 12,
            impacts: [{ angle: 0, intensity: 1, width: 0.2, progress: 0.1 }],
            dents: []
        },
        introBlur,
        logoPacket: {
            canvas: {},
            revision: logoRevision,
            destX: 500,
            destY: 220,
            width: 280,
            height: 90
        }
    };
}

class FakeFramePort {
    constructor(context) {
        this.context = context;
        this.active = true;
        this.callbacks = null;
        this.canvasWriteCount = 0;
        this.markCount = 0;
    }

    isFrameActive() {
        return this.active;
    }

    encodeCommands(callback) {
        if (!this.active) return false;
        try {
            callback(this.context);
            return true;
        } catch (error) {
            this.lastError = error;
            this.abort();
            return false;
        }
    }

    deferFrameCallbacks(callbacks) {
        if (!this.active) return false;
        this.callbacks = callbacks;
        return true;
    }

    commit() {
        this.active = false;
        this.callbacks?.committed?.({ frameId: this.context.frameId });
        this.callbacks = null;
    }

    abort() {
        if (!this.active) return;
        this.active = false;
        this.callbacks?.aborted?.({ frameId: this.context.frameId });
        this.callbacks = null;
    }

    nextFrame(overrides = {}) {
        this.context = createContext({ ...this.context, ...overrides });
        this.active = true;
    }
}

class FakeUiAtlas {
    constructor(trace) {
        this.trace = trace;
        this.revision = null;
        this.uploadCount = 0;
        this.cacheHitCount = 0;
        this.destroyed = false;
    }

    getOrUpload(input) {
        if (input.revision === this.revision) {
            this.cacheHitCount += 1;
        } else {
            this.revision = input.revision;
            this.uploadCount += 1;
            this.trace.push(`atlas:upload:${input.revision}`);
        }
        const texture = { id: `logo-texture:${input.revision}` };
        return {
            texture,
            view: { id: `logo:${input.revision}`, texture },
            uvScaleX: 1,
            uvScaleY: 1
        };
    }

    getDiagnostics() {
        return {
            uploadCount: this.uploadCount,
            cacheHitCount: this.cacheHitCount
        };
    }

    destroy() {
        this.destroyed = true;
    }
}

function createPass(destroyCounts, methods) {
    return {
        ...methods,
        destroy() {
            destroyCounts.total += 1;
        }
    };
}

let nextTextureId = 0;
function createDevice() {
    return {
        createdDescriptors: [],
        createTexture(descriptor) {
            this.createdDescriptors.push(cloneTextureDescriptor(descriptor));
            const id = ++nextTextureId;
            const texture = {
                id: `texture:${id}`,
                width: descriptor.size.width,
                height: descriptor.size.height,
                destroyed: false,
                createView() {
                    return { id: id === 1 ? 'scene' : `view:${id}`, texture };
                },
                destroy() {
                    this.destroyed = true;
                }
            };
            return texture;
        }
    };
}

function cloneTextureDescriptor(descriptor) {
    return {
        size: {
            width: descriptor.size.width,
            height: descriptor.size.height,
            depthOrArrayLayers: descriptor.size.depthOrArrayLayers
        },
        format: descriptor.format,
        usage: descriptor.usage
    };
}

function createContext(overrides = {}) {
    const device = overrides.device ?? createDevice();
    return {
        frameId: overrides.frameId ?? 1,
        device,
        deviceGeneration: overrides.deviceGeneration ?? 1,
        encoder: overrides.encoder ?? {},
        target: overrides.target ?? {},
        format: overrides.format ?? 'bgra8unorm',
        width: overrides.width ?? 1280,
        height: overrides.height ?? 720
    };
}
