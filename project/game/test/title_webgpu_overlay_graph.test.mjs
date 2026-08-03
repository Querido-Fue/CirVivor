import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const module = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_overlay_graph.js'
);
const {
    TITLE_WEBGPU_OVERLAY_DEFAULT_BLUR_ALGORITHM_ID,
    TITLE_WEBGPU_OVERLAY_STAGE_KIND,
    TITLE_WEBGPU_OVERLAY_STAGE_ORDER,
    TitleWebGpuOverlayGraph
} = module;

test('missing/stale/generation-mismatched C0를 canvas pass 전에 fail-closed한다', () => {
    const cases = [{
        name: 'missing',
        checkpoint: null,
        reason: 'missing-base-checkpoint',
        diagnostic: 'missingCheckpointRejectCount'
    }, {
        name: 'stale',
        checkpoint: createBaseCheckpoint({ frameId: 0 }),
        reason: 'stale-base-checkpoint',
        diagnostic: 'staleCheckpointRejectCount'
    }, {
        name: 'generation',
        checkpoint: createBaseCheckpoint({ deviceGeneration: 0 }),
        reason: 'generation-mismatched-base-checkpoint',
        diagnostic: 'generationCheckpointRejectCount'
    }];

    for (const entry of cases) {
        const fixture = createFixture();
        assert.equal(fixture.graph.beginFrame(1), true, entry.name);
        fixture.graph.recordVignette({ id: 'vignette' });
        assert.equal(fixture.graph.finalize(entry.checkpoint), false, entry.name);
        assert.equal(fixture.framePort.canvasPassCallCount, 0, entry.name);
        assert.equal(fixture.presentInputs.length, 0, entry.name);
        assert.equal(fixture.graph.getDiagnostics()[entry.diagnostic], 1, entry.name);
        const receipts = fixture.graph.drainReceipts();
        assert.equal(receipts.length, 1, entry.name);
        assert.equal(receipts[0].status, 'aborted', entry.name);
        assert.equal(receipts[0].failure, entry.reason, entry.name);
        assert.equal(receipts[0].finalOverlayIncluded, false, entry.name);
    }
});

test('등록 순서와 무관하게 고정 layer 순서를 만들고 floating backdrop은 root 이후 checkpoint를 본다', () => {
    const fixture = createFixture({
        cutoverStatusProvider: () => ({
            fullCutoverActive: true,
            legacyVisibleSurfaceCount: 0,
            webGpuSurfaceVisible: true,
            topControlSurfacePreserved: true,
            cssPresentationNeutralized: true,
            fallbackPending: false,
            destroyed: false
        })
    });
    const blur = createBlurRequest();
    assert.equal(fixture.graph.beginFrame(1), true);
    fixture.graph.recordTooltip({ id: 'tooltip' });
    fixture.graph.recordFloating({ id: 'floating', backdropBlur: blur });
    fixture.graph.recordRoot({ id: 'root', backdropBlur: blur });
    fixture.graph.recordDim({ id: 'dim' });
    fixture.graph.recordTitleMenu({ id: 'title-menu' });
    fixture.graph.recordVignette({ id: 'vignette' });

    assert.equal(
        fixture.graph.finalize(createBaseCheckpoint()),
        true,
        fixture.framePort.lastError?.stack
    );
    assert.deepEqual(
        fixture.stageInputs.map((entry) => entry.kind),
        Array.from(TITLE_WEBGPU_OVERLAY_STAGE_ORDER)
    );
    const rootMaterialization = fixture.materializeInputs.find(
        (entry) => entry.stageKind === TITLE_WEBGPU_OVERLAY_STAGE_KIND.ROOT
    );
    const floatingMaterialization = fixture.materializeInputs.find(
        (entry) => entry.stageKind === TITLE_WEBGPU_OVERLAY_STAGE_KIND.FLOATING
    );
    assert.ok(rootMaterialization);
    assert.ok(floatingMaterialization);
    assert.equal(rootMaterialization.stageKinds.includes('root'), false);
    assert.equal(floatingMaterialization.stageKinds.includes('root'), true);
    assert.ok(
        floatingMaterialization.checkpointRevision
            > rootMaterialization.checkpointRevision
    );
    assert.equal(fixture.framePort.canvasPassCallCount, 1);
    assert.equal(fixture.presentInputs.length, 1);

    assert.equal(fixture.graph.drainReceipts().length, 0);
    fixture.framePort.commit();
    const [receipt] = fixture.graph.drainReceipts();
    assert.deepEqual(
        Array.from(receipt.stageOrder),
        Array.from(TITLE_WEBGPU_OVERLAY_STAGE_ORDER)
    );
    const rootSource = receipt.stageSources.find((entry) => entry.kind === 'root');
    const floatingSource = receipt.stageSources.find(
        (entry) => entry.kind === 'floating'
    );
    assert.equal(
        floatingSource.sourceCheckpointRevision,
        rootSource.outputCheckpointRevision
    );
    assert.equal(floatingSource.sourceCheckpointId, rootSource.outputCheckpointId);
    assert.equal(receipt.presentPassCount, 1);
    assert.equal(receipt.committed, true);
    assert.equal(receipt.baseCheckpointConsumed, true);
    assert.equal(receipt.vignetteIncluded, true);
    assert.equal(receipt.fullScenePresented, true);
    assert.equal(receipt.finalCanvasPassCount, 1);
    assert.equal(receipt.finalOverlayIncluded, true);
    assert.equal(fixture.graph.getDiagnostics().presentPassCount, 1);
});

test('blur는 source checkpoint/texture/profile exact key에서만 공유하고 content source를 별도 ID로 격리한다', () => {
    const fixture = createFixture();
    const backdropA = createBlurRequest();
    const backdropAClone = createBlurRequest();
    const contentA = createBlurRequest({
        bounds: { x: 0, y: 0, width: 240, height: 120 }
    });
    const contentAClone = createBlurRequest({
        bounds: { x: 0, y: 0, width: 240, height: 120 }
    });

    fixture.graph.beginFrame(1);
    fixture.graph.recordRoot({
        id: 'root',
        backdropBlurs: [backdropA, backdropAClone],
        contentBlurs: [contentA, contentAClone]
    });
    fixture.graph.recordFloating({
        id: 'floating',
        backdropBlur: createBlurRequest()
    });
    assert.equal(fixture.graph.finalize(createBaseCheckpoint()), true);

    assert.equal(fixture.materializeInputs.length, 2);
    assert.equal(fixture.blurInputs.length, 3);
    const backdropEncodes = fixture.blurInputs.filter(
        (entry) => !entry.checkpointId.includes(':content:')
    );
    const contentEncodes = fixture.blurInputs.filter(
        (entry) => entry.checkpointId.includes(':content:')
    );
    assert.equal(backdropEncodes.length, 2);
    assert.equal(contentEncodes.length, 1);
    assert.notEqual(backdropEncodes[0].checkpointId, backdropEncodes[1].checkpointId);
    assert.notEqual(
        backdropEncodes[0].sourceRevision,
        backdropEncodes[1].sourceRevision
    );
    assert.match(contentEncodes[0].checkpointId, /^title:overlay:content:1:/u);
    assert.notEqual(contentEncodes[0].checkpointId, backdropEncodes[0].checkpointId);
    const rootNode = fixture.presentInputs[0].checkpoint.nodes.find(
        (entry) => entry.type === 'title-overlay-stage' && entry.id === 'root'
    );
    assert.deepEqual({ ...rootNode.contentBlurOutputs[0].logicalBounds }, {
        x: 32,
        y: 16,
        width: 240,
        height: 120
    });

    fixture.framePort.commit();
    const [receipt] = fixture.graph.drainReceipts();
    const rootBackdropReceipts = receipt.blurRequests.filter((entry) => (
        entry.stageId === 'root' && entry.purpose === 'backdrop'
    ));
    const rootContentReceipts = receipt.blurRequests.filter((entry) => (
        entry.stageId === 'root' && entry.purpose === 'content'
    ));
    assert.deepEqual(
        Array.from(rootBackdropReceipts, (entry) => entry.shared),
        [false, true]
    );
    assert.deepEqual(
        Array.from(rootContentReceipts, (entry) => entry.shared),
        [false, true]
    );
    const diagnostics = fixture.graph.getDiagnostics();
    assert.equal(diagnostics.blurRequestCount, 5);
    assert.equal(diagnostics.blurEncodeCount, 3);
    assert.equal(diagnostics.sharedBlurHitCount, 2);
    assert.equal(diagnostics.materializationRequestCount, 3);
    assert.equal(diagnostics.materializationCount, 2);
    assert.equal(diagnostics.materializationCacheHitCount, 1);
});

test('receipt는 composer callback 뒤에만 나오고 commit/cutover/abort 조건을 보수적으로 판정한다', () => {
    const provisional = createFixture();
    provisional.graph.beginFrame(1);
    provisional.graph.recordVignette({ id: 'vignette' });
    assert.equal(provisional.graph.finalize(createBaseCheckpoint()), true);
    assert.equal(provisional.graph.drainReceipts().length, 0);
    provisional.framePort.commit();
    assert.equal(provisional.graph.drainReceipts()[0].finalOverlayIncluded, false);

    const cutover = createFixture({
        cutoverStatusProvider: () => ({
            fullCutoverActive: true,
            legacyVisibleSurfaceCount: 0,
            webGpuSurfaceVisible: true,
            topControlSurfacePreserved: true,
            cssPresentationNeutralized: true,
            fallbackPending: false,
            destroyed: false
        })
    });
    cutover.graph.beginFrame(1);
    cutover.graph.recordVignette({ id: 'vignette' });
    assert.equal(cutover.graph.finalize(createBaseCheckpoint()), true);
    cutover.framePort.commit();
    const committed = cutover.graph.drainReceipts()[0];
    assert.equal(committed.status, 'committed');
    assert.equal(committed.submitted, true);
    assert.equal(committed.finalOverlayIncluded, true);

    const partialCutover = createFixture({
        cutoverStatusProvider: () => ({
            fullCutoverActive: true,
            legacyVisibleSurfaceCount: 0,
            webGpuSurfaceVisible: true,
            topControlSurfacePreserved: true,
            cssPresentationNeutralized: false,
            fallbackPending: false,
            destroyed: false
        })
    });
    partialCutover.graph.beginFrame(1);
    partialCutover.graph.recordVignette({ id: 'vignette' });
    assert.equal(partialCutover.graph.finalize(createBaseCheckpoint()), true);
    partialCutover.framePort.commit();
    assert.equal(
        partialCutover.graph.drainReceipts()[0].finalOverlayIncluded,
        false
    );

    const aborted = createFixture({
        cutoverStatusProvider: () => ({
            fullCutoverActive: true,
            legacyVisibleSurfaceCount: 0,
            webGpuSurfaceVisible: true,
            topControlSurfacePreserved: true,
            cssPresentationNeutralized: true,
            fallbackPending: false,
            destroyed: false
        })
    });
    aborted.graph.beginFrame(1);
    assert.equal(aborted.graph.finalize(createBaseCheckpoint()), true);
    aborted.framePort.abort('test-abort');
    const abortReceipt = aborted.graph.drainReceipts()[0];
    assert.equal(abortReceipt.status, 'aborted');
    assert.equal(abortReceipt.submitted, false);
    assert.equal(abortReceipt.finalOverlayIncluded, false);
});

test('optimized Kawase algorithm ID도 같은 graph 진입점으로 유지한다', () => {
    const fixture = createFixture({ blurAlgorithmId: 'kawase-optimized' });
    fixture.graph.beginFrame(1);
    fixture.graph.recordVignette({ id: 'vignette' });
    fixture.graph.recordRoot({
        id: 'root',
        backdropBlur: createBlurRequest()
    });
    assert.equal(fixture.graph.finalize(createBaseCheckpoint()), true);
    assert.equal(fixture.blurInputs.length, 1);
    assert.equal(fixture.blurInputs[0].algorithmId, 'kawase-optimized');
    assert.equal(fixture.graph.getDiagnostics().blurAlgorithmId, 'kawase-optimized');
    fixture.framePort.abort();
});

test('live-stage cap을 넘으면 compaction hook으로 stack을 제한하면서 final present는 한 번만 수행한다', () => {
    const fixture = createFixture({ maxLiveStages: 2 });
    fixture.graph.beginFrame(1);
    fixture.graph.recordTooltip({ id: 'tooltip' });
    fixture.graph.recordFloating({ id: 'floating' });
    fixture.graph.recordRoot({ id: 'root' });
    fixture.graph.recordDim({ id: 'dim' });
    fixture.graph.recordTitleMenu({ id: 'title-menu' });
    fixture.graph.recordVignette({ id: 'vignette' });

    assert.equal(fixture.graph.finalize(createBaseCheckpoint()), true);
    assert.equal(fixture.compactInputs.length, 2);
    assert.equal(
        fixture.compactInputs.every((entry) => entry.liveStageCount === 3),
        true
    );
    assert.ok(fixture.presentInputs[0].checkpoint.liveStageCount <= 2);
    assert.ok(fixture.presentInputs[0].checkpoint.nodes.length <= 2);
    assert.equal(fixture.framePort.canvasPassCallCount, 1);
    assert.equal(fixture.presentInputs.length, 1);

    fixture.framePort.commit();
    const receipt = fixture.graph.drainReceipts()[0];
    assert.equal(receipt.compactionCount, 2);
    assert.ok(receipt.maxRetainedLiveStageCount <= 2);
    assert.equal(fixture.graph.getDiagnostics().compactionCount, 2);
    assert.ok(fixture.graph.getDiagnostics().maxRetainedLiveStageCount <= 2);
});

test('receipt queue는 cap을 지키고 drain 뒤 비워진다', () => {
    const fixture = createFixture({ maxReceipts: 1 });
    fixture.graph.beginFrame(1);
    assert.equal(fixture.graph.finalize(createBaseCheckpoint()), true);
    fixture.framePort.commit();

    fixture.framePort.nextFrame({ frameId: 2 });
    fixture.graph.beginFrame(2);
    assert.equal(
        fixture.graph.finalize(createBaseCheckpoint({ frameId: 2, revision: 20 })),
        true
    );
    fixture.framePort.commit();

    const receipts = fixture.graph.drainReceipts();
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].frameId, 2);
    assert.equal(fixture.graph.getDiagnostics().droppedReceiptCount, 1);
    assert.equal(fixture.graph.getDiagnostics().queuedReceiptCount, 0);
});

test('record 전처리 실패는 active frame을 명시적으로 취소하고 다음 frame을 허용한다', () => {
    const fixture = createFixture();
    assert.equal(fixture.graph.beginFrame(1), true);
    fixture.graph.recordVignette({ id: 'vignette' });

    assert.equal(fixture.graph.cancelActiveFrame('snapshot-invalid'), true);
    assert.equal(fixture.graph.cancelActiveFrame('duplicate'), false);
    assert.equal(fixture.graph.drainReceipts().length, 0);
    assert.equal(fixture.graph.getDiagnostics().status, 'ready');
    assert.equal(fixture.graph.getDiagnostics().abortCount, 1);
    assert.equal(fixture.graph.getDiagnostics().cancelCount, 1);
    assert.equal(
        fixture.graph.getDiagnostics().lastFailure.message,
        'snapshot-invalid'
    );

    fixture.framePort.nextFrame({ frameId: 2 });
    assert.equal(fixture.graph.beginFrame(2), true);
});

function createFixture({
    cutoverStatusProvider,
    blurAlgorithmId,
    maxLiveStages = 8,
    maxReceipts = 64
} = {}) {
    const framePort = new FakeFramePort(createContext());
    const materializeInputs = [];
    const stageInputs = [];
    const blurInputs = [];
    const compactInputs = [];
    const presentInputs = [];
    let resourceSequence = 0;

    const createTrackedResource = (prefix, width = 320, height = 180, format = 'bgra8unorm') => {
        resourceSequence += 1;
        return createResource(`${prefix}:${resourceSequence}`, width, height, format);
    };
    const graph = new TitleWebGpuOverlayGraph({
        framePort,
        cutoverStatusProvider,
        blurAlgorithmId,
        maxLiveStages,
        maxReceipts,
        blurPort: {
            encode(input) {
                blurInputs.push({ ...input });
                return createTrackedResource(
                    `blur:${input.checkpointId}`,
                    Math.max(1, Math.ceil(input.bounds.width)),
                    Math.max(1, Math.ceil(input.bounds.height)),
                    input.format
                );
            }
        },
        materializePass: {
            encode(context, input) {
                materializeInputs.push({
                    stageId: input.stageId,
                    stageKind: input.stageKind,
                    checkpointId: input.checkpoint.id,
                    checkpointRevision: input.checkpoint.revision,
                    stageKinds: input.checkpoint.nodes
                        .map((node) => node.kind)
                        .filter(Boolean)
                });
                return createTrackedResource(
                    `roi:${input.checkpoint.id}`,
                    Math.max(1, Math.ceil(input.bounds.width)),
                    Math.max(1, Math.ceil(input.bounds.height)),
                    input.format
                );
            }
        },
        stagePass: {
            encode(context, input) {
                stageInputs.push({
                    kind: input.record.kind,
                    id: input.record.id,
                    sourceCheckpointId: input.sourceCheckpoint.id,
                    sourceCheckpointRevision: input.sourceCheckpoint.revision,
                    backdropOutputCount: input.backdropOutputs.length
                });
                const result = {
                    node: Object.freeze({ draw: input.record.id })
                };
                if (input.record.contentBlurs.length > 0) {
                    result.contentSource = Object.freeze({
                        ...createTrackedResource(
                            `content:${input.record.id}`,
                            240,
                            120,
                            context.format
                        ),
                        logicalBounds: Object.freeze({
                            x: 32,
                            y: 16,
                            width: 240,
                            height: 120
                        })
                    });
                }
                return result;
            }
        },
        compactPass: {
            encode(context, input) {
                compactInputs.push({
                    revision: input.checkpoint.revision,
                    liveStageCount: input.checkpoint.liveStageCount,
                    nodeCount: input.checkpoint.nodes.length
                });
                return {
                    node: Object.freeze({
                        compactedRevision: input.checkpoint.revision
                    })
                };
            }
        },
        presentPass: {
            encode(pass, context, input) {
                presentInputs.push(input);
                return true;
            }
        }
    });
    return {
        graph,
        framePort,
        materializeInputs,
        stageInputs,
        blurInputs,
        compactInputs,
        presentInputs
    };
}

class FakeFramePort {
    constructor(context) {
        this.context = context;
        this.active = true;
        this.callbacks = null;
        this.canvasPassCallCount = 0;
        this.lastError = null;
    }

    isFrameActive() {
        return this.active;
    }

    deferFrameCallbacks(callbacks) {
        if (!this.active || this.callbacks) return false;
        this.callbacks = callbacks;
        return true;
    }

    encodeCommands(callback) {
        if (!this.active) return false;
        try {
            callback(this.context);
            return true;
        } catch (error) {
            this.lastError = error;
            this.abort(error.titleWebGpuOverlayReason ?? 'command-error');
            return false;
        }
    }

    encodeCanvasPass(callback) {
        if (!this.active) return false;
        this.canvasPassCallCount += 1;
        try {
            callback({}, this.context);
            return true;
        } catch (error) {
            this.lastError = error;
            this.abort(error.titleWebGpuOverlayReason ?? 'present-error');
            return false;
        }
    }

    commit({ submitted = true } = {}) {
        if (!this.active) return false;
        this.active = false;
        const callbacks = this.callbacks;
        this.callbacks = null;
        callbacks?.committed?.({
            frameId: this.context.frameId,
            submitted,
            reason: null
        });
        return true;
    }

    abort(reason = 'test-abort') {
        if (!this.active) return false;
        this.active = false;
        const callbacks = this.callbacks;
        this.callbacks = null;
        callbacks?.aborted?.({
            frameId: this.context.frameId,
            submitted: false,
            reason
        });
        return true;
    }

    nextFrame(overrides = {}) {
        this.context = createContext({ ...this.context, ...overrides });
        this.active = true;
        this.callbacks = null;
        this.lastError = null;
    }
}

function createBaseCheckpoint(overrides = {}) {
    const frameId = overrides.frameId ?? 1;
    const deviceGeneration = overrides.deviceGeneration ?? 1;
    const width = overrides.width ?? 1280;
    const height = overrides.height ?? 720;
    const format = overrides.format ?? 'bgra8unorm';
    const resource = createResource(`base:${frameId}`, width, height, format);
    return Object.freeze({
        id: overrides.id ?? 'title:overlay:0',
        frameId,
        deviceGeneration,
        ...resource,
        revision: overrides.revision ?? 10,
        colorSpace: 'srgb-compat',
        alphaMode: 'premultiplied',
        lifetime: overrides.lifetime ?? 'frame'
    });
}

function createBlurRequest(overrides = {}) {
    return {
        sigma: overrides.sigma ?? 7.5,
        bounds: overrides.bounds ?? { x: 40, y: 30, width: 320, height: 180 },
        halo: overrides.halo ?? { left: 24, top: 24, right: 24, bottom: 24 },
        edgeMode: overrides.edgeMode ?? 'clamp'
    };
}

function createResource(id, width, height, format) {
    const texture = { id: `${id}:texture` };
    return Object.freeze({
        texture,
        view: Object.freeze({ id: `${id}:view`, texture }),
        width,
        height,
        format
    });
}

function createContext(overrides = {}) {
    return {
        frameId: overrides.frameId ?? 1,
        device: overrides.device ?? {},
        deviceGeneration: overrides.deviceGeneration ?? 1,
        encoder: overrides.encoder ?? {},
        target: overrides.target ?? {},
        format: overrides.format ?? 'bgra8unorm',
        width: overrides.width ?? 1280,
        height: overrides.height ?? 720
    };
}

assert.equal(TITLE_WEBGPU_OVERLAY_DEFAULT_BLUR_ALGORITHM_ID, 'gaussian-quality');
