import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const module = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_overlay_renderer.js'
);
const {
    TITLE_WEBGPU_OVERLAY_ROI_ALIGNMENT,
    TitleWebGpuOverlayRenderer
} = module;
const { TitleWebGpuOverlayGraph } = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_overlay_graph.js'
);
const { recordTitleWebGpuOverlayFrame } = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_overlay_recording.js'
);

test('logical checkpoint를 stable order로 16px aligned/clamped ROI에 materialize한다', () => {
    const fixture = createFixture({ width: 128, height: 96 });
    const base = fixture.resource('base', 128, 96);
    const root = fixture.resource('root', 128, 96);
    const floating = fixture.resource('floating', 128, 96);
    const checkpoint = createCheckpoint({
        width: 128,
        height: 96,
        nodes: [
            { type: 'title-overlay-base', resource: base },
            stageNode('root', textureNode(root, 128, 96)),
            stageNode('floating', textureNode(floating, 128, 96))
        ]
    });

    assert.equal(TITLE_WEBGPU_OVERLAY_ROI_ALIGNMENT, 16);
    assert.equal(fixture.renderer.beginFrame(1), true);
    const output = fixture.renderer.getPorts().materializePass.encode(
        fixture.context,
        {
            stageId: 'next',
            checkpoint,
            bounds: { x: -3, y: 85, width: 40, height: 30 },
            halo: { left: 5, top: 5, right: 5, bottom: 5 },
            format: 'bgra8unorm'
        }
    );

    assert.deepEqual({ ...output.logicalBounds }, {
        x: 0,
        y: 80,
        width: 48,
        height: 16
    });
    assert.equal(output.width, 48);
    assert.equal(output.height, 16);
    const pass = fixture.gpu.records.renderPasses.find(
        (entry) => entry.label.startsWith('title-overlay-materialize:')
    );
    assert.ok(pass);
    assert.deepEqual(pass.sampledViews, [base.view.id, root.view.id, floating.view.id]);
    assert.equal(fixture.renderer.getDiagnostics().roiMaterializeCount, 1);
    fixture.framePort.abort('roi-complete');
    assert.equal(fixture.renderer.getDiagnostics().texturePool.frameActive, false);
});

test('passthrough analytic checkpoint는 full-screen 승격 없이 ROI에서 logical 좌표를 보존한다', () => {
    const fixture = createFixture({ width: 160, height: 96 });
    const base = fixture.resource('analytic-roi-base', 160, 96);
    const analyticNodes = Object.freeze([Object.freeze({
        kind: 'dim',
        color: Object.freeze([0, 0, 0, 0.3]),
        opacity: 0.8
    }), Object.freeze({
        kind: 'vignette',
        color: Object.freeze([0, 0, 0, 0.7]),
        opacity: 0.9,
        edgeWidth: 18,
        cornerRadius: 12
    })]);
    const checkpoint = createCheckpoint({
        width: 160,
        height: 96,
        nodes: [
            { type: 'title-overlay-base', resource: base },
            stageNode('analytic-roi', analyticNodes)
        ]
    });

    fixture.renderer.beginFrame(1);
    const roi = fixture.renderer.getPorts().materializePass.encode(
        fixture.context,
        {
            stageId: 'after-analytic',
            checkpoint,
            bounds: { x: 32, y: 16, width: 80, height: 64 },
            halo: 0
        }
    );
    assert.deepEqual({ ...roi.logicalBounds }, {
        x: 32,
        y: 16,
        width: 80,
        height: 64
    });

    const finalPass = fixture.gpu.createCallerPass('analytic-roi-final');
    assert.equal(fixture.renderer.getPorts().presentPass.encode(
        finalPass,
        fixture.context,
        { checkpoint }
    ), true);
    assert.equal(finalPass.record.drawCount, 3);

    const layerWrites = fixture.gpu.records.bufferWrites.filter(
        (entry) => entry.buffer.descriptor?.label?.startsWith(
            'title-layer-stack-uniform-buffer:'
        )
    );
    assert.equal(layerWrites.length, 2);
    const roiUniforms = layerWrites[0].bytes;
    const fullUniforms = layerWrites[1].bytes;
    const dimSlot = 64;
    const vignetteSlot = 128;
    for (const slot of [dimSlot, vignetteSlot]) {
        assert.deepEqual([
            readFloat32(roiUniforms, slot + 6),
            readFloat32(roiUniforms, slot + 7),
            readFloat32(roiUniforms, slot + 8),
            readFloat32(roiUniforms, slot + 9)
        ], [32, 16, 160, 96]);
        assert.deepEqual([
            readFloat32(fullUniforms, slot + 6),
            readFloat32(fullUniforms, slot + 7),
            readFloat32(fullUniforms, slot + 8),
            readFloat32(fullUniforms, slot + 9)
        ], [0, 0, 160, 96]);
    }
    assert.ok(Math.abs(
        analyticDimAlphaFromBytes(fullUniforms, dimSlot)
        - analyticDimAlphaFromBytes(roiUniforms, dimSlot)
    ) < 1e-7);
    for (const [localX, localY] of [
        [0.5, 0.5],
        [40.5, 0.5],
        [79.5, 63.5],
        [40.5, 32.5]
    ]) {
        const fullAlpha = analyticVignetteAlphaFromBytes(
            fullUniforms,
            vignetteSlot,
            32 + localX,
            16 + localY
        );
        const roiAlpha = analyticVignetteAlphaFromBytes(
            roiUniforms,
            vignetteSlot,
            localX,
            localY
        );
        assert.ok(Math.abs(fullAlpha - roiAlpha) < 1e-7);
    }
    const diagnostics = fixture.renderer.getDiagnostics();
    assert.equal(diagnostics.roiMaterializeCount, 1);
    assert.equal(diagnostics.fullScreenMaterializeFallbackCount, 0);
    fixture.framePort.abort('analytic-roi-complete');
});

test('stage는 analytic → glass → UI 순서를 유지하고 flat/effect texture를 별도 처리한다', () => {
    const fixture = createFixture({ width: 320, height: 180 });
    const backdrop = fixture.resource('backdrop', 96, 64, {
        logicalBounds: { x: 32, y: 16, width: 96, height: 64 }
    });
    const uiCanvas = { width: 120, height: 40 };
    const effectCanvas = {
        width: 48,
        height: 24,
        __overlayTextureRevision: 4,
        __overlayTextureFlipY: true
    };
    const record = createRecord({
        id: 'root',
        bounds: { x: 40, y: 30, width: 220, height: 120 },
        backdropBlurs: [{
            bounds: { x: 40, y: 30, width: 180, height: 100 },
            halo: 16
        }],
        payload: {
            analyticNodes: [{
                kind: 'dim',
                color: [0, 0, 0, 0.25],
                opacity: 1
            }],
            glassPanels: [{
                panel: {
                    x: 48,
                    y: 36,
                    w: 160,
                    h: 88,
                    radius: 12,
                    fill: 'rgba(255,255,255,0.1)',
                    effectTextureCanvas: effectCanvas,
                    effectTextureRect: { x: 52, y: 40, width: 32, height: 16 }
                }
            }, {
                panel: {
                    x: 224,
                    y: 44,
                    w: 64,
                    h: 52,
                    radius: 8,
                    fill: '#ffffff22',
                    sampleBackdrop: false
                }
            }, {
                backdropIndex: null,
                panel: {
                    x: 500,
                    y: 500,
                    w: 32,
                    h: 32,
                    radius: 4,
                    fill: '#ffffff22',
                    sampleBackdrop: true
                }
            }],
            uiSurfaces: [{
                canvas: uiCanvas,
                revision: 7,
                width: 120,
                height: 40,
                capacityWidth: 128,
                capacityHeight: 64,
                bounds: { x: 64, y: 56, width: 120, height: 40 },
                opacity: 0.8
            }]
        }
    });

    fixture.renderer.beginFrame(1);
    const result = fixture.renderer.getPorts().stagePass.encode(fixture.context, {
        frameId: 1,
        record,
        sourceCheckpoint: createCheckpoint({ width: 320, height: 180 }),
        backdropOutputs: [backdrop]
    });

    assert.equal(result.node.kind, 'texture');
    assert.strictEqual(result.node.view, result.contentSource.view);
    assert.equal(result.contentSource.width, 320);
    assert.equal(result.contentSource.height, 180);
    const labels = fixture.gpu.records.renderPasses.map((entry) => entry.label);
    assert.match(labels[0], /^title-overlay-stage-base:/u);
    const firstGlass = labels.findIndex((label) => label.startsWith('title-overlay-glass-pass:'));
    const uiPass = labels.findIndex((label) => label.startsWith('title-overlay-stage-ui:'));
    assert.ok(firstGlass > 0);
    assert.ok(uiPass > firstGlass);
    assert.equal(labels.filter((label) => label.startsWith('title-overlay-glass-pass:')).length, 1);
    const glassPass = fixture.gpu.records.renderPasses[firstGlass];
    assert.equal(glassPass.drawCount, 2);
    assert.equal(glassPass.drawRecords.length, 2);
    assert.equal(
        glassPass.drawRecords[0].resources.get(2),
        backdrop.view
    );
    assert.equal(
        glassPass.drawRecords[1].resources.get(2),
        glassPass.drawRecords[1].resources.get(3)
    );
    const glassWrites = fixture.gpu.records.bufferWrites.filter(
        (entry) => entry.buffer.descriptor?.label?.startsWith(
            'title-overlay-glass-uniform:'
        )
    );
    assert.equal(glassWrites.length, 2);
    assert.equal(readFloat32(glassWrites[0].bytes, 59), 1);
    assert.equal(readFloat32(glassWrites[1].bytes, 59), 0);
    assert.equal(labels.filter((label) => label.startsWith('title-overlay-transparent-fallback:')).length, 1);
    assert.equal(fixture.gpu.records.externalCopies.length, 2);
    assert.deepEqual(
        fixture.gpu.records.externalCopies.map((entry) => ({ ...entry.size })),
        [{ width: 48, height: 24, depthOrArrayLayers: 1 },
            { width: 120, height: 40, depthOrArrayLayers: 1 }]
    );
    const diagnostics = fixture.renderer.getDiagnostics();
    assert.equal(diagnostics.glassPanelCount, 3);
    assert.equal(diagnostics.flatGlassPanelCount, 1);
    assert.equal(diagnostics.missingBackdropFallbackCount, 1);
    assert.equal(diagnostics.uiUploadCount, 1);
    assert.equal(diagnostics.effectTextureUploadCount, 1);
    assert.equal(diagnostics.externalUploadCount, 2);

    fixture.framePort.commit();
    fixture.nextFrame({ frameId: 2 });
    fixture.renderer.beginFrame(2);
    fixture.renderer.getPorts().stagePass.encode(fixture.context, {
        frameId: 2,
        record,
        sourceCheckpoint: createCheckpoint({ frameId: 2, width: 320, height: 180 }),
        backdropOutputs: [backdrop]
    });
    const steady = fixture.renderer.getDiagnostics();
    assert.equal(steady.externalUploadCount, 2);
    assert.equal(steady.steadyUiCacheHitCount, 1);
    assert.equal(steady.steadyEffectTextureCacheHitCount, 1);
    fixture.framePort.abort('stage-complete');
});

test('explicit renderBounds stage는 cropped texture에서 global glass/UI 좌표를 보존한다', () => {
    const fixture = createFixture({ width: 160, height: 96 });
    const backdrop = fixture.resource('cropped-stage-backdrop', 96, 64, {
        logicalBounds: { x: 32, y: 16, width: 96, height: 64 }
    });
    const record = createRecord({
        id: 'cropped-stage',
        bounds: { x: 0, y: 0, width: 160, height: 96 },
        backdropBlurs: [{
            bounds: { x: 48, y: 32, width: 64, height: 32 },
            halo: 16
        }],
        payload: {
            renderBounds: { x: 32, y: 16, width: 96, height: 64 },
            glassPanels: [{
                panel: {
                    x: 48,
                    y: 32,
                    w: 64,
                    h: 32,
                    radius: 6,
                    fill: '#ffffff18'
                }
            }],
            uiSurfaces: [{
                canvas: { width: 160, height: 96 },
                revision: 1,
                width: 160,
                height: 96,
                bounds: { x: 0, y: 0, width: 160, height: 96 },
                opacity: 1,
                contentScale: 1
            }]
        }
    });

    fixture.renderer.beginFrame(1);
    const result = fixture.renderer.getPorts().stagePass.encode(fixture.context, {
        record,
        sourceCheckpoint: createCheckpoint({ width: 160, height: 96 }),
        backdropOutputs: [backdrop]
    });

    assert.equal(result.contentSource.width, 96);
    assert.equal(result.contentSource.height, 64);
    assert.deepEqual({ ...result.contentSource.logicalBounds }, {
        x: 32,
        y: 16,
        width: 96,
        height: 64
    });
    assert.deepEqual({ ...result.node.screenBounds }, {
        x: 32,
        y: 16,
        width: 96,
        height: 64
    });
    assert.deepEqual({ ...result.node.sourceLogicalOrigin }, { x: 32, y: 16 });
    const stageTexture = fixture.gpu.records.textures.find(
        (entry) => entry.label === undefined && entry.width === 96 && entry.height === 64
    );
    assert.ok(stageTexture);
    const glassPass = fixture.gpu.records.renderPasses.find(
        ({ label }) => label.startsWith('title-overlay-glass-pass:')
    );
    assert.deepEqual(glassPass.drawRecords[0].scissor, {
        x: 14,
        y: 14,
        width: 68,
        height: 36
    });
    const glassWrite = fixture.gpu.records.bufferWrites.find(
        (entry) => entry.buffer.descriptor?.label?.startsWith(
            'title-overlay-glass-uniform:'
        )
    );
    assert.equal(readFloat32(glassWrite.bytes, 8), 32);
    assert.equal(readFloat32(glassWrite.bytes, 9), 16);
    const diagnostics = fixture.renderer.getDiagnostics();
    assert.equal(diagnostics.stageRoiCropCount, 1);
    assert.equal(diagnostics.stageRoiCroppedPixelCount, 96 * 64);
    fixture.framePort.abort('cropped-stage-complete');
});

test('순수 dim/vignette stage는 중간 texture 없이 final logical stack으로 직결한다', () => {
    const fixture = createFixture({ width: 160, height: 96 });
    const analyticNodes = Object.freeze([Object.freeze({
        kind: 'dim',
        color: Object.freeze([0, 0, 0, 0.2]),
        opacity: 1
    }), Object.freeze({
        kind: 'vignette',
        color: Object.freeze([0, 0, 0, 0.45]),
        opacity: 1,
        edgeWidth: 18,
        cornerRadius: 12
    })]);
    const record = createRecord({
        id: 'analytic-only',
        bounds: { x: 0, y: 0, width: 160, height: 96 },
        payload: {
            opacity: 1,
            contentScale: 1,
            analyticNodes
        }
    });

    fixture.renderer.beginFrame(1);
    const result = fixture.renderer.getPorts().stagePass.encode(fixture.context, {
        record,
        sourceCheckpoint: createCheckpoint({ width: 160, height: 96 }),
        backdropOutputs: []
    });

    assert.equal(Array.isArray(result.node), true);
    assert.deepEqual(result.node, analyticNodes);
    assert.equal(Object.isFrozen(result.node), true);
    assert.equal(result.contentSource, null);
    assert.equal(fixture.gpu.records.renderPasses.length, 0);
    assert.equal(fixture.gpu.records.textures.length, 0);
    let diagnostics = fixture.renderer.getDiagnostics();
    assert.equal(diagnostics.stageCount, 1);
    assert.equal(diagnostics.stageTextureCount, 0);
    assert.equal(diagnostics.analyticPassthroughStageCount, 1);
    assert.equal(diagnostics.analyticPassthroughNodeCount, 2);

    const finalPass = fixture.gpu.createCallerPass('analytic-final');
    assert.equal(fixture.renderer.getPorts().presentPass.encode(
        finalPass,
        fixture.context,
        {
            checkpoint: createCheckpoint({
                width: 160,
                height: 96,
                nodes: [stageNode('analytic-only', result.node)]
            })
        }
    ), true);
    assert.equal(finalPass.record.drawCount, 2);
    assert.deepEqual(finalPass.record.pipelineLabels, [
        'title-layer-stack-dim-pipeline:bgra8unorm',
        'title-layer-stack-vignette-pipeline:bgra8unorm'
    ]);
    diagnostics = fixture.renderer.getDiagnostics();
    assert.equal(diagnostics.presentCount, 1);
    assert.equal(fixture.gpu.records.renderPasses.length, 0);
    fixture.framePort.commit();
});

test('analytic이 없으면 glass가 투명 clear first writer가 되어 빈 base pass를 없앤다', () => {
    const fixture = createFixture({ width: 160, height: 96 });
    const backdrop = fixture.resource('glass-first-backdrop', 80, 48, {
        logicalBounds: { x: 0, y: 0, width: 160, height: 96 }
    });
    const record = createRecord({
        id: 'glass-first',
        bounds: { x: 0, y: 0, width: 160, height: 96 },
        backdropBlurs: [{
            bounds: { x: 0, y: 0, width: 160, height: 96 },
            halo: 0
        }],
        payload: {
            glassPanels: [{
                panel: {
                    x: 24,
                    y: 16,
                    w: 96,
                    h: 56,
                    radius: 8,
                    fill: '#ffffff18'
                }
            }]
        }
    });

    fixture.renderer.beginFrame(1);
    const result = fixture.renderer.getPorts().stagePass.encode(fixture.context, {
        record,
        sourceCheckpoint: createCheckpoint({ width: 160, height: 96 }),
        backdropOutputs: [backdrop]
    });

    assert.equal(result.node.kind, 'texture');
    const labels = fixture.gpu.records.renderPasses.map((entry) => entry.label);
    assert.equal(labels.some((label) => label.startsWith('title-overlay-stage-base:')), false);
    assert.deepEqual(labels, ['title-overlay-glass-pass:1']);
    const attachment = fixture.gpu.records.renderPasses[0].descriptor.colorAttachments[0];
    assert.equal(attachment.loadOp, 'clear');
    assert.deepEqual({ ...attachment.clearValue }, { r: 0, g: 0, b: 0, a: 0 });
    const diagnostics = fixture.renderer.getDiagnostics();
    assert.equal(diagnostics.emptyAnalyticBasePassElisionCount, 1);
    assert.equal(diagnostics.glassFirstWriterClearCount, 1);
    assert.equal(diagnostics.uiFirstWriterClearCount, 0);
    assert.equal(diagnostics.emptyStageFallbackClearCount, 0);
    assert.equal(diagnostics.glassPass.clearBatchCount, 1);
    assert.equal(diagnostics.glassPass.loadBatchCount, 0);
    fixture.framePort.abort('glass-first-complete');
});

test('analytic/glass가 없으면 UI pass가 투명 clear first writer가 된다', () => {
    const fixture = createFixture({ width: 160, height: 96 });
    const record = createRecord({
        id: 'ui-first',
        bounds: { x: 0, y: 0, width: 160, height: 96 },
        payload: {
            uiSurfaces: [{
                canvas: { width: 80, height: 32 },
                revision: 1,
                width: 80,
                height: 32,
                bounds: { x: 40, y: 24, width: 80, height: 32 },
                opacity: 1
            }]
        }
    });

    fixture.renderer.beginFrame(1);
    const result = fixture.renderer.getPorts().stagePass.encode(fixture.context, {
        record,
        sourceCheckpoint: createCheckpoint({ width: 160, height: 96 }),
        backdropOutputs: []
    });

    assert.equal(result.node.kind, 'texture');
    assert.deepEqual(
        fixture.gpu.records.renderPasses.map((entry) => entry.label),
        ['title-overlay-stage-ui:1:ui-first']
    );
    const attachment = fixture.gpu.records.renderPasses[0].descriptor.colorAttachments[0];
    assert.equal(attachment.loadOp, 'clear');
    assert.deepEqual({ ...attachment.clearValue }, { r: 0, g: 0, b: 0, a: 0 });
    const diagnostics = fixture.renderer.getDiagnostics();
    assert.equal(diagnostics.emptyAnalyticBasePassElisionCount, 1);
    assert.equal(diagnostics.glassFirstWriterClearCount, 0);
    assert.equal(diagnostics.uiFirstWriterClearCount, 1);
    assert.equal(diagnostics.emptyStageFallbackClearCount, 0);
    fixture.framePort.abort('ui-first-complete');
});

test('glass 후보가 전부 skip되면 뒤 UI가 first writer clear를 인계받는다', () => {
    const fixture = createFixture({ width: 160, height: 96 });
    const backdrop = fixture.resource('skipped-glass-backdrop', 80, 48, {
        logicalBounds: { x: 0, y: 0, width: 160, height: 96 }
    });
    const record = createRecord({
        id: 'skipped-glass-ui',
        bounds: { x: 0, y: 0, width: 160, height: 96 },
        backdropBlurs: [{
            bounds: { x: 0, y: 0, width: 160, height: 96 },
            halo: 0
        }],
        payload: {
            glassPanels: [{
                panel: {
                    x: 24,
                    y: 16,
                    w: 96,
                    h: 56,
                    alpha: 0,
                    fill: '#ffffff18'
                }
            }],
            uiSurfaces: [{
                canvas: { width: 80, height: 32 },
                revision: 1,
                width: 80,
                height: 32,
                bounds: { x: 40, y: 24, width: 80, height: 32 }
            }]
        }
    });

    fixture.renderer.beginFrame(1);
    fixture.renderer.getPorts().stagePass.encode(fixture.context, {
        record,
        sourceCheckpoint: createCheckpoint({ width: 160, height: 96 }),
        backdropOutputs: [backdrop]
    });

    const labels = fixture.gpu.records.renderPasses.map((entry) => entry.label);
    assert.equal(labels.some((label) => label.startsWith('title-overlay-glass-pass:')), false);
    assert.deepEqual(labels, ['title-overlay-stage-ui:1:skipped-glass-ui']);
    assert.equal(
        fixture.gpu.records.renderPasses[0].descriptor.colorAttachments[0].loadOp,
        'clear'
    );
    const diagnostics = fixture.renderer.getDiagnostics();
    assert.equal(diagnostics.glassFirstWriterClearCount, 0);
    assert.equal(diagnostics.uiFirstWriterClearCount, 1);
    assert.equal(diagnostics.glassPass.clearBatchCount, 0);
    assert.equal(diagnostics.glassPass.lastBatchLoadOp, null);
    fixture.framePort.abort('skipped-glass-ui-complete');
});

test('작성자가 없는 materialized stage는 정의된 투명 texture로 fail-closed한다', () => {
    const fixture = createFixture({ width: 160, height: 96 });
    const record = createRecord({
        id: 'empty-stage',
        bounds: { x: 0, y: 0, width: 160, height: 96 },
        payload: {}
    });

    fixture.renderer.beginFrame(1);
    const result = fixture.renderer.getPorts().stagePass.encode(fixture.context, {
        record,
        sourceCheckpoint: createCheckpoint({ width: 160, height: 96 }),
        backdropOutputs: []
    });

    assert.equal(result.node.kind, 'texture');
    assert.deepEqual(
        fixture.gpu.records.renderPasses.map((entry) => entry.label),
        ['title-overlay-stage-empty:1:empty-stage']
    );
    const attachment = fixture.gpu.records.renderPasses[0].descriptor.colorAttachments[0];
    assert.equal(attachment.loadOp, 'clear');
    assert.equal(fixture.gpu.records.renderPasses[0].drawCount, 0);
    const diagnostics = fixture.renderer.getDiagnostics();
    assert.equal(diagnostics.emptyAnalyticBasePassElisionCount, 1);
    assert.equal(diagnostics.emptyStageFallbackClearCount, 1);
    fixture.framePort.abort('empty-stage-complete');
});

test('단일 trusted content request는 aligned ROI texture로 crop하고 full stage node는 보존한다', () => {
    const fixture = createFixture({ width: 160, height: 96 });
    const record = createRecord({
        id: 'content-roi',
        bounds: { x: 0, y: 0, width: 160, height: 96 },
        backdropBlurs: [],
        contentBlurs: [{
            sigma: 6,
            bounds: { x: 34, y: 22, width: 80, height: 40 },
            halo: { left: 8, top: 8, right: 8, bottom: 8 }
        }],
        payload: {
            uiSurfaces: [{
                canvas: { width: 160, height: 96 },
                revision: 1,
                width: 160,
                height: 96,
                bounds: { x: 0, y: 0, width: 160, height: 96 },
                opacity: 1
            }]
        }
    });

    fixture.renderer.beginFrame(1);
    const result = fixture.renderer.getPorts().stagePass.encode(fixture.context, {
        frameId: 1,
        record,
        sourceCheckpoint: createCheckpoint({ width: 160, height: 96 }),
        backdropOutputs: []
    });

    assert.deepEqual({ ...result.node.screenBounds }, {
        x: 0,
        y: 0,
        width: 160,
        height: 96
    });
    assert.deepEqual({ ...result.contentSource.logicalBounds }, {
        x: 16,
        y: 0,
        width: 112,
        height: 80
    });
    assert.equal(result.contentSource.width, 112);
    assert.equal(result.contentSource.height, 80);
    assert.notStrictEqual(result.node.view, result.contentSource.view);
    const cropPass = fixture.gpu.records.renderPasses.find(
        (entry) => entry.label === 'title-overlay-content-roi:1:content-roi'
    );
    assert.ok(cropPass);
    assert.deepEqual(cropPass.sampledViews, [result.node.view.id]);
    const diagnostics = fixture.renderer.getDiagnostics();
    assert.equal(diagnostics.contentRoiCropCount, 1);
    assert.equal(diagnostics.contentRoiCroppedPixelCount, 112 * 80);
    assert.equal(diagnostics.contentFullScreenSourceCount, 0);
    assert.deepEqual({ ...diagnostics.contentFullScreenSourceReasons }, {});
    fixture.framePort.abort('content-roi-complete');
});

test('content ROI full-screen fallback reason을 renderer 누적 진단에 보존한다', () => {
    const fixture = createFixture({ width: 160, height: 96 });
    const record = createRecord({
        id: 'content-full-screen',
        bounds: { x: 0, y: 0, width: 160, height: 96 },
        contentBlurs: [{
            sigma: 6,
            bounds: { x: 0, y: 0, width: 160, height: 96 },
            halo: { left: 0, top: 0, right: 0, bottom: 0 },
            contentRoi: {
                mode: 'full-screen',
                reason: 'explicit-content-authority-missing'
            }
        }],
        payload: {
            uiSurfaces: [{
                canvas: { width: 160, height: 96 },
                revision: 1,
                width: 160,
                height: 96,
                bounds: { x: 0, y: 0, width: 160, height: 96 },
                opacity: 1
            }]
        }
    });

    fixture.renderer.beginFrame(1);
    const result = fixture.renderer.getPorts().stagePass.encode(fixture.context, {
        frameId: 1,
        record,
        sourceCheckpoint: createCheckpoint({ width: 160, height: 96 }),
        backdropOutputs: []
    });
    assert.strictEqual(result.contentSource.view, result.node.view);
    const diagnostics = fixture.renderer.getDiagnostics();
    assert.equal(diagnostics.contentRoiCropCount, 0);
    assert.equal(diagnostics.contentFullScreenSourceCount, 1);
    assert.deepEqual({ ...diagnostics.contentFullScreenSourceReasons }, {
        'explicit-content-authority-missing': 1
    });
    assert.equal(Object.isFrozen(diagnostics.contentFullScreenSourceReasons), true);
    fixture.framePort.abort('content-full-screen-complete');
});

test('final present는 content blur의 마지막 output을 치환하고 caller pass에 한 번만 기록한다', () => {
    const fixture = createFixture({ width: 256, height: 144 });
    const base = fixture.resource('base', 256, 144);
    const stage = fixture.resource('stage', 256, 144);
    const firstBlur = fixture.resource('blur-first', 128, 72);
    const lastBlur = fixture.resource('blur-last', 64, 36, {
        logicalBounds: { x: 32, y: 16, width: 64, height: 48 }
    });
    const checkpoint = createCheckpoint({
        width: 256,
        height: 144,
        nodes: [
            { type: 'title-overlay-base', resource: base },
            stageNode(
                'root',
                textureNode(stage, 256, 144),
                [firstBlur, lastBlur]
            )
        ]
    });
    const finalPass = fixture.gpu.createCallerPass('canvas-final');

    fixture.renderer.beginFrame(1);
    assert.equal(fixture.renderer.getPorts().presentPass.encode(
        finalPass,
        fixture.context,
        { checkpoint }
    ), true);
    assert.deepEqual(finalPass.record.sampledViews, [base.view.id, lastBlur.view.id]);
    assert.equal(finalPass.record.drawCount, 2);
    const finalUniformWrite = fixture.gpu.records.bufferWrites.findLast(
        (entry) => entry.buffer.descriptor?.label?.startsWith(
            'title-layer-stack-uniform-buffer:'
        )
    );
    const secondNodeOffset = 64;
    assert.equal(readFloat32(finalUniformWrite.bytes, secondNodeOffset + 2), 32);
    assert.equal(readFloat32(finalUniformWrite.bytes, secondNodeOffset + 3), 16);
    assert.equal(readFloat32(finalUniformWrite.bytes, secondNodeOffset + 4), 64);
    assert.equal(readFloat32(finalUniformWrite.bytes, secondNodeOffset + 5), 48);
    assert.equal(readFloat32(finalUniformWrite.bytes, secondNodeOffset + 6), 32);
    assert.equal(readFloat32(finalUniformWrite.bytes, secondNodeOffset + 7), 16);
    assert.equal(readFloat32(finalUniformWrite.bytes, secondNodeOffset + 8), 64);
    assert.equal(readFloat32(finalUniformWrite.bytes, secondNodeOffset + 9), 48);
    assert.throws(
        () => fixture.renderer.getPorts().presentPass.encode(
            finalPass,
            fixture.context,
            { checkpoint }
        ),
        /frame당 한 번/
    );
    assert.equal(fixture.renderer.getDiagnostics().presentCount, 1);
    fixture.framePort.commit();
    assert.equal(fixture.renderer.getDiagnostics().lastSettledFrame.presentCount, 1);
});

test('compact는 full-screen texture node를 만들고 abort/generation drift에서 resource를 정리한다', () => {
    const firstGpu = createGpu('first');
    const fixture = createFixture({ width: 192, height: 108, gpu: firstGpu });
    const base = fixture.resource('base', 192, 108);
    const checkpoint = createCheckpoint({
        width: 192,
        height: 108,
        nodes: [{ type: 'title-overlay-base', resource: base }]
    });

    fixture.renderer.beginFrame(1);
    const compacted = fixture.renderer.getPorts().compactPass.encode(
        fixture.context,
        { checkpoint }
    );
    assert.equal(compacted.node.kind, 'texture');
    assert.deepEqual({ ...compacted.node.screenBounds }, {
        x: 0,
        y: 0,
        width: 192,
        height: 108
    });
    fixture.framePort.abort('forced-abort');
    assert.equal(fixture.renderer.getDiagnostics().abortCount, 1);
    assert.equal(fixture.renderer.getDiagnostics().texturePool.frameActive, false);
    const transientTexture = firstGpu.records.textures.find(
        (entry) => entry.label === undefined && entry.width === 192
    );
    assert.ok(transientTexture);

    const secondGpu = createGpu('second');
    fixture.nextFrame({
        frameId: 2,
        deviceGeneration: 2,
        gpu: secondGpu
    });
    fixture.renderer.beginFrame(2);
    fixture.renderer.getPorts().compactPass.encode(fixture.context, {
        checkpoint: createCheckpoint({
            frameId: 2,
            deviceGeneration: 2,
            width: 192,
            height: 108,
            nodes: [{
                type: 'title-overlay-base',
                resource: fixture.resource('base-next', 192, 108)
            }]
        })
    });
    assert.equal(transientTexture.destroyCount, 1);
    assert.equal(fixture.renderer.getDiagnostics().generationRecreateCount, 1);
    assert.ok(fixture.renderer.getDiagnostics().passDestroyCount >= 1);
    fixture.framePort.commit();
    assert.equal(fixture.renderer.getDiagnostics().commitCount, 1);
    assert.equal(fixture.renderer.destroy(), true);
    assert.equal(fixture.renderer.destroy(), false);
});

test('recording → graph → renderer가 caller-selected blur와 한 canvas pass로 연결된다', () => {
    const gpu = createGpu('integrated');
    const framePort = new FakeFramePort();
    const context = createContext(gpu, { width: 320, height: 180 });
    framePort.setContext(context, gpu);
    const blurRequests = [];
    const blurPort = {
        encode(request) {
            blurRequests.push(request);
            const width = request.sourceTexture.width;
            const height = request.sourceTexture.height;
            return createResource(gpu, `blur:${blurRequests.length}`, width, height, {
                algorithmId: request.algorithmId,
                bounds: request.bounds,
                halo: request.halo
            });
        },
        getRequiredHalo() {
            return 12;
        },
        getSnapshot() {
            return Object.freeze({ status: 'ready' });
        }
    };
    const renderer = new TitleWebGpuOverlayRenderer({ framePort, blurPort });
    const graph = new TitleWebGpuOverlayGraph({
        framePort,
        blurPort,
        ...renderer.getPorts(),
        blurAlgorithmId: 'caller-selected'
    });
    const uiCanvas = { width: 320, height: 180 };
    const snapshot = Object.freeze({
        frameId: 1,
        sessionIdentity: 'title-menu',
        sortOrderBase: 10_000,
        dim: null,
        root: Object.freeze({
            order: 10_000,
            effectSurface: Object.freeze({ id: 'title-effect' }),
            uiSurface: Object.freeze({
                id: 'title-ui',
                canvas: uiCanvas,
                contentRevision: 9,
                width: 320,
                height: 180,
                isEmpty: false,
                opacity: 1
            }),
            glassCommands: Object.freeze([Object.freeze({
                x: 80,
                y: 50,
                w: 160,
                h: 80,
                radius: 12,
                blur: 6,
                fill: '#ffffff18',
                sampleBackdrop: true
            })])
        }),
        floating: null,
        presentation: Object.freeze({
            contentBlur: 0,
            contentScale: 1,
            contentOrigin: Object.freeze({ x: 0.5, y: 0.5 })
        })
    });

    assert.equal(renderer.beginFrame(1), true);
    assert.equal(graph.beginFrame(1), true);
    const recorded = recordTitleWebGpuOverlayFrame({
        graph,
        frameId: 1,
        width: 320,
        height: 180,
        blurAlgorithmId: 'caller-selected',
        blurPort,
        vignettePacket: Object.freeze({
            visible: true,
            color: Object.freeze([0, 0, 0, 0.45]),
            edgeWidth: 32,
            cornerRadius: 24
        }),
        mainSnapshot: snapshot,
        managerSnapshots: Object.freeze([]),
        dynamicSurfaces: Object.freeze([])
    });
    assert.equal(recorded.complete, true);
    const base = createResource(gpu, 'integrated-base', 320, 180);
    const baseCheckpoint = Object.freeze({
        id: 'title:overlay:0',
        frameId: 1,
        deviceGeneration: 1,
        ...base,
        revision: 1,
        colorSpace: 'srgb',
        alphaMode: 'premultiplied',
        lifetime: 'frame'
    });
    assert.equal(graph.finalize(baseCheckpoint), true, framePort.lastError?.stack);
    assert.equal(framePort.canvasPassCallCount, 1);
    assert.equal(blurRequests.length, 1);
    assert.equal(blurRequests[0].algorithmId, 'caller-selected');
    assert.equal(renderer.getDiagnostics().uiUploadCount, 1);
    assert.equal(renderer.getDiagnostics().presentCount, 1);
    framePort.commit();
    const [receipt] = graph.drainReceipts();
    assert.equal(receipt.committed, true);
    assert.deepEqual(Array.from(receipt.stageOrder), ['vignette', 'titleMenu']);
    assert.equal(renderer.getDiagnostics().lastSettledFrame.presentCount, 1);
    renderer.destroy();
    graph.destroy();
});

test('renderer는 algorithm ID나 presentation command ownership을 만들지 않는다', async () => {
    const source = await readFile(new URL(
        '../script/module/scene/title/webgpu/_title_webgpu_overlay_renderer.js',
        import.meta.url
    ), 'utf8');
    assert.doesNotMatch(source, /gaussian-quality|kawase-(?:optimized|compatibility)/u);
    assert.doesNotMatch(
        source,
        /getCurrentTexture|acquireFrameTarget|createCommandEncoder/u
    );
    assert.doesNotMatch(source, /\.finish\s*\(|queue\.submit|markCanvas(?:Drawn|Cleared)/u);
});

test('cap을 넘는 서로 다른 ROI/stage/UI texture는 outcome 전 폐기하지 않고 callback에서 trim한다', () => {
    const fixture = createFixture({
        width: 128,
        height: 96,
        maxTextures: 2,
        maxUiEntries: 2
    });
    const base = fixture.resource('frame-safe-base', 128, 96);
    const baseCheckpoint = createCheckpoint({
        width: 128,
        height: 96,
        nodes: [{ type: 'title-overlay-base', resource: base }]
    });
    const stageNodes = [];

    fixture.renderer.beginFrame(1);
    for (let index = 0; index < 5; index += 1) {
        const id = `overflow-${index}`;
        const bounds = {
            x: 0,
            y: 0,
            width: 8 + index * 16,
            height: 16
        };
        const backdrop = fixture.renderer.getPorts().materializePass.encode(
            fixture.context,
            { stageId: id, checkpoint: baseCheckpoint, bounds, halo: 0 }
        );
        const staged = fixture.renderer.getPorts().stagePass.encode(
            fixture.context,
            {
                record: createRecord({
                    id,
                    bounds,
                    backdropBlurs: [{ bounds, halo: 0 }],
                    payload: {
                        glassPanels: [{
                            panel: {
                                x: 0,
                                y: 0,
                                w: 32,
                                h: 24,
                                radius: 4,
                                fill: '#ffffff18'
                            }
                        }],
                        uiSurfaces: [{
                            canvas: { width: 16, height: 8 },
                            revision: 0,
                            bounds: { x: index * 4, y: 0, width: 16, height: 8 }
                        }]
                    }
                }),
                sourceCheckpoint: baseCheckpoint,
                backdropOutputs: [backdrop]
            }
        );
        stageNodes.push(stageNode(id, staged.node));
    }
    fixture.renderer.getPorts().presentPass.encode(
        fixture.gpu.createCallerPass('frame-safe-present'),
        fixture.context,
        {
            checkpoint: createCheckpoint({
                width: 128,
                height: 96,
                nodes: [
                    { type: 'title-overlay-base', resource: base },
                    ...stageNodes
                ]
            })
        }
    );

    const beforeOutcome = fixture.renderer.getDiagnostics();
    const transientTextures = fixture.gpu.records.textures.filter(
        (entry) => entry.label === undefined
    );
    const atlasTextures = fixture.gpu.records.textures.filter(
        (entry) => entry.label === 'title-ui-atlas-slot'
    );
    assert.ok(beforeOutcome.texturePool.textureCount > 2);
    assert.ok(beforeOutcome.texturePool.overflowAllocationCount > 0);
    assert.ok(beforeOutcome.uiAtlas.entryCount > 2);
    assert.ok(beforeOutcome.uiAtlas.overflowAllocationCount > 0);
    assert.equal(beforeOutcome.texturePool.destroyCount, 0);
    assert.equal(beforeOutcome.uiAtlas.destroyCount, 0);
    assert.equal(transientTextures.some((entry) => entry.destroyCount !== 0), false);
    assert.equal(atlasTextures.some((entry) => entry.destroyCount !== 0), false);

    fixture.framePort.commit();
    const afterOutcome = fixture.renderer.getDiagnostics();
    assert.equal(afterOutcome.texturePool.textureCount, 2);
    assert.equal(afterOutcome.uiAtlas.entryCount, 2);
    assert.ok(afterOutcome.texturePool.destroyCount > 0);
    assert.ok(afterOutcome.uiAtlas.destroyCount > 0);
    assert.equal(transientTextures.some((entry) => entry.destroyCount > 0), true);
    assert.equal(atlasTextures.some((entry) => entry.destroyCount > 0), true);
});

test('active frame destroy는 GPU resource 폐기를 abort callback 뒤까지 지연한다', () => {
    const fixture = createFixture({ width: 64, height: 64, maxTextures: 2 });
    const base = fixture.resource('destroy-base', 64, 64);
    fixture.renderer.beginFrame(1);
    fixture.renderer.getPorts().compactPass.encode(fixture.context, {
        checkpoint: createCheckpoint({
            width: 64,
            height: 64,
            nodes: [{ type: 'title-overlay-base', resource: base }]
        })
    });
    const transient = fixture.gpu.records.textures.find(
        (entry) => entry.label === undefined
    );
    assert.ok(transient);

    assert.equal(fixture.renderer.destroy(), true);
    assert.equal(fixture.renderer.getDiagnostics().resourcesDestroyed, false);
    assert.equal(transient.destroyCount, 0);

    fixture.framePort.abort('destroy-active-frame');
    assert.equal(fixture.renderer.getDiagnostics().resourcesDestroyed, true);
    assert.equal(transient.destroyCount, 1);
    assert.equal(fixture.renderer.destroy(), false);
});

function createFixture({
    width,
    height,
    gpu = createGpu('gpu'),
    maxTextures = 16,
    maxUiEntries = 8
}) {
    const framePort = new FakeFramePort();
    const renderer = new TitleWebGpuOverlayRenderer({
        framePort,
        blurPort: {
            encode() {
                throw new Error('renderer가 blur algorithm을 직접 선택하면 안 됩니다.');
            },
            getSnapshot() {
                return Object.freeze({ status: 'ready' });
            }
        },
        maxTextures,
        maxUiEntries
    });
    const fixture = {
        renderer,
        framePort,
        gpu,
        context: createContext(gpu, { width, height }),
        resource(label, resourceWidth, resourceHeight, extras = {}) {
            return createResource(
                fixture.gpu,
                label,
                resourceWidth,
                resourceHeight,
                extras
            );
        },
        nextFrame({ frameId, deviceGeneration = 1, gpu: nextGpu = fixture.gpu }) {
            fixture.gpu = nextGpu;
            fixture.context = createContext(nextGpu, {
                frameId,
                deviceGeneration,
                width,
                height
            });
            framePort.nextFrame();
            framePort.setContext(fixture.context, fixture.gpu);
        }
    };
    framePort.setContext(fixture.context, fixture.gpu);
    return fixture;
}

class FakeFramePort {
    constructor() {
        this.active = true;
        this.callbacks = [];
        this.context = null;
        this.gpu = null;
        this.canvasPassCallCount = 0;
        this.lastError = null;
    }

    isFrameActive() {
        return this.active;
    }

    deferFrameCallbacks(callbacks) {
        if (!this.active) return false;
        this.callbacks.push(callbacks);
        return true;
    }

    setContext(context, gpu) {
        this.context = context;
        this.gpu = gpu;
    }

    encodeCommands(callback) {
        if (!this.active || !this.context) return false;
        try {
            callback(this.context);
            return true;
        } catch (error) {
            this.lastError = error;
            this.abort(error.titleWebGpuOverlayReason ?? 'encode-error');
            return false;
        }
    }

    encodeCanvasPass(callback) {
        if (!this.active || !this.context || !this.gpu) return false;
        this.canvasPassCallCount += 1;
        const pass = this.gpu.createCallerPass(`canvas:${this.context.frameId}`);
        try {
            callback(pass, this.context);
            pass.end();
            return true;
        } catch (error) {
            this.lastError = error;
            this.abort(error.titleWebGpuOverlayReason ?? 'canvas-error');
            return false;
        }
    }

    commit() {
        if (!this.active) return false;
        this.active = false;
        const callbacks = this.callbacks.splice(0);
        for (const entry of callbacks) {
            entry.committed?.({ submitted: true });
        }
        return true;
    }

    abort(reason = 'test-abort') {
        if (!this.active) return false;
        this.active = false;
        const callbacks = this.callbacks.splice(0);
        for (const entry of callbacks) {
            entry.aborted?.({ submitted: false, reason });
        }
        return true;
    }

    nextFrame() {
        this.active = true;
        this.callbacks.length = 0;
        this.lastError = null;
    }
}

function createGpu(label) {
    const records = {
        textures: [],
        renderPasses: [],
        externalCopies: [],
        bufferWrites: [],
        pipelines: []
    };
    let nextId = 0;
    const device = {
        label,
        queue: {
            writeBuffer(buffer, offset, data) {
                records.bufferWrites.push({
                    buffer,
                    offset,
                    bytes: copyBytes(data)
                });
            },
            copyExternalImageToTexture(source, destination, size) {
                records.externalCopies.push({ source, destination, size });
            }
        },
        createTexture(descriptor) {
            const size = descriptor.size;
            const textureRecord = {
                id: `${label}:texture:${++nextId}`,
                label: descriptor.label,
                width: size.width,
                height: size.height,
                format: descriptor.format,
                descriptor,
                destroyCount: 0,
                views: []
            };
            const texture = {
                width: size.width,
                height: size.height,
                format: descriptor.format,
                createView(viewDescriptor = {}) {
                    const view = {
                        id: `${textureRecord.id}:view:${textureRecord.views.length}`,
                        texture
                    };
                    textureRecord.views.push({ viewDescriptor, view });
                    return view;
                },
                destroy() {
                    textureRecord.destroyCount += 1;
                }
            };
            textureRecord.texture = texture;
            records.textures.push(textureRecord);
            return texture;
        },
        createShaderModule(descriptor) {
            return { descriptor };
        },
        createSampler(descriptor) {
            return { descriptor };
        },
        createRenderPipeline(descriptor) {
            const pipeline = {
                descriptor,
                getBindGroupLayout(index) {
                    return { pipeline, index };
                }
            };
            records.pipelines.push(pipeline);
            return pipeline;
        },
        createBuffer(descriptor) {
            return {
                descriptor,
                destroyCount: 0,
                destroy() {
                    this.destroyCount += 1;
                }
            };
        },
        createBindGroup(descriptor) {
            return { descriptor };
        }
    };

    function makePassRecord(label, descriptor = null) {
        const record = {
            label,
            descriptor,
            drawCount: 0,
            drawRecords: [],
            sampledViews: [],
            pipelineLabels: [],
            ended: false
        };
        let currentBindGroup = null;
        let currentScissor = null;
        const pass = {
            record,
            setPipeline(pipeline) {
                record.pipelineLabels.push(pipeline.descriptor?.label ?? null);
            },
            setBindGroup(_index, bindGroup) {
                currentBindGroup = bindGroup;
            },
            setViewport() {},
            setScissorRect(x, y, width, height) {
                currentScissor = { x, y, width, height };
            },
            draw() {
                record.drawCount += 1;
                const resources = new Map();
                for (const entry of currentBindGroup?.descriptor?.entries ?? []) {
                    resources.set(entry.binding, entry.resource);
                }
                record.drawRecords.push({
                    bindGroup: currentBindGroup,
                    resources,
                    scissor: currentScissor ? { ...currentScissor } : null
                });
                const sampled = currentBindGroup?.descriptor?.entries?.find(
                    (entry) => entry.binding === 1
                )?.resource;
                if (sampled?.id) record.sampledViews.push(sampled.id);
            },
            end() {
                record.ended = true;
            }
        };
        return pass;
    }

    const encoder = {
        beginRenderPass(descriptor) {
            const pass = makePassRecord(descriptor.label, descriptor);
            records.renderPasses.push(pass.record);
            return pass;
        }
    };
    return {
        device,
        encoder,
        records,
        createCallerPass(label) {
            return makePassRecord(label);
        }
    };
}

function copyBytes(data) {
    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data.slice(0));
    }
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(
            data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        );
    }
    return new Uint8Array(data).slice();
}

function readFloat32(bytes, index) {
    return new Float32Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength / Float32Array.BYTES_PER_ELEMENT
    )[index];
}

function analyticDimAlphaFromBytes(bytes, offset) {
    return readFloat32(bytes, offset + 15) * readFloat32(bytes, offset + 16);
}

function analyticVignetteAlphaFromBytes(bytes, offset, localX, localY) {
    const logicalX = localX + readFloat32(bytes, offset + 6);
    const logicalY = localY + readFloat32(bytes, offset + 7);
    const halfWidth = readFloat32(bytes, offset + 8) * 0.5;
    const halfHeight = readFloat32(bytes, offset + 9) * 0.5;
    const radius = Math.max(
        0,
        Math.min(readFloat32(bytes, offset + 19), halfWidth, halfHeight)
    );
    const roundedX = Math.abs(logicalX - halfWidth) - (halfWidth - radius);
    const roundedY = Math.abs(logicalY - halfHeight) - (halfHeight - radius);
    const signedDistance = Math.hypot(
        Math.max(roundedX, 0),
        Math.max(roundedY, 0)
    ) + Math.min(Math.max(roundedX, roundedY), 0) - radius;
    const inwardDistance = Math.max(0, -signedDistance);
    const edgeWidth = Math.max(readFloat32(bytes, offset + 18), 0.0001);
    const t = Math.max(0, Math.min(1, inwardDistance / edgeWidth));
    const edge = 1 - (t * t * (3 - (2 * t)));
    return readFloat32(bytes, offset + 15)
        * readFloat32(bytes, offset + 16)
        * edge;
}

function createContext(gpu, {
    frameId = 1,
    deviceGeneration = 1,
    width,
    height,
    format = 'bgra8unorm'
}) {
    return Object.freeze({
        frameId,
        deviceGeneration,
        device: gpu.device,
        encoder: gpu.encoder,
        target: Object.freeze({ id: `target:${frameId}:${deviceGeneration}` }),
        width,
        height,
        format
    });
}

function createResource(gpu, label, width, height, extras = {}) {
    const texture = gpu.device.createTexture({
        label,
        size: { width, height, depthOrArrayLayers: 1 },
        format: 'bgra8unorm',
        usage: 0x14
    });
    return Object.freeze({
        texture,
        view: texture.createView(),
        width,
        height,
        format: 'bgra8unorm',
        ...extras
    });
}

function createCheckpoint({
    frameId = 1,
    deviceGeneration = 1,
    width = 128,
    height = 72,
    nodes = []
} = {}) {
    return Object.freeze({
        id: 'title:overlay:test',
        frameId,
        deviceGeneration,
        width,
        height,
        format: 'bgra8unorm',
        revision: 10,
        colorSpace: 'srgb-compat',
        alphaMode: 'premultiplied',
        nodes: Object.freeze(nodes)
    });
}

function createRecord({ id, bounds, backdropBlurs = [], contentBlurs = [], payload }) {
    return Object.freeze({
        id,
        kind: 'root',
        order: 0,
        sequence: 0,
        bounds,
        backdropBlurs: Object.freeze(backdropBlurs),
        contentBlurs: Object.freeze(contentBlurs),
        payload
    });
}

function textureNode(resource, width, height) {
    return Object.freeze({
        kind: 'texture',
        texture: resource.texture,
        view: resource.view,
        resource,
        screenBounds: Object.freeze({ x: 0, y: 0, width, height }),
        sourceLogicalOrigin: Object.freeze({ x: 0, y: 0 }),
        sourceLogicalSize: Object.freeze({ width, height }),
        opacity: 1,
        contentScale: 1,
        contentOrigin: Object.freeze({ x: 0.5, y: 0.5 })
    });
}

function stageNode(id, layer, contentBlurOutputs = []) {
    return Object.freeze({
        type: 'title-overlay-stage',
        id,
        kind: id,
        order: 0,
        sequence: 0,
        layer,
        contentBlurOutputs: Object.freeze(contentBlurOutputs)
    });
}
