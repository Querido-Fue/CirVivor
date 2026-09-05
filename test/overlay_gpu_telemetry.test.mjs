import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { OverlayEffectRenderer } = await loadGameModule(
    'display/webgl/_overlay_effect_renderer.js'
);
const telemetryState = await loadGameModule(
    'display/webgl/_webgl_gpu_telemetry_state.js'
);

/**
 * OverlayEffectRenderer의 전체 draw 경로와 WebGL1 timer query를 실행하는 합성 GL을 만듭니다.
 * @returns {{gl: object, records: object, markQueriesAvailable: () => void}} 테스트 하네스입니다.
 */
function createOverlayTelemetryHarness() {
    const records = {
        extensionRequests: [],
        queries: [],
        events: [],
        activeQuery: null,
        maxActiveQueryCount: 0,
        overlappingQueryAttemptCount: 0,
        disjointReadCount: 0,
        finishCallCount: 0,
        readPixelsCallCount: 0,
        throwOnDraw: false,
        throwOnTexImage: false,
        texImageCallCount: 0
    };
    const queryDurationsNanoseconds = [1_750_000, 250_000];
    let nextHandleId = 1;

    const canvasListeners = new Map();
    const canvas = {
        dataset: { surfaceId: 'synthetic-overlay' },
        addEventListener(type, listener) {
            let listeners = canvasListeners.get(type);
            if (!listeners) {
                listeners = new Set();
                canvasListeners.set(type, listeners);
            }
            listeners.add(listener);
        },
        removeEventListener(type, listener) {
            canvasListeners.get(type)?.delete(listener);
        }
    };

    const createHandle = (kind) => ({ kind, id: nextHandleId++ });
    const timerExtension = {
        TIME_ELAPSED_EXT: 0x88BF,
        GPU_DISJOINT_EXT: 0x8FBB,
        QUERY_RESULT_AVAILABLE_EXT: 0x8867,
        QUERY_RESULT_EXT: 0x8866,
        createQueryEXT() {
            const query = {
                id: records.queries.length + 1,
                available: false,
                resultNanoseconds: queryDurationsNanoseconds[records.queries.length] ?? 0,
                deleted: false
            };
            records.queries.push(query);
            return query;
        },
        deleteQueryEXT(query) {
            query.deleted = true;
        },
        beginQueryEXT(target, query) {
            assert.equal(target, this.TIME_ELAPSED_EXT);
            if (records.activeQuery) {
                records.overlappingQueryAttemptCount += 1;
            }
            assert.equal(records.activeQuery, null, 'timer query는 중첩되면 안 됩니다.');
            records.activeQuery = query;
            records.maxActiveQueryCount = Math.max(records.maxActiveQueryCount, 1);
            records.events.push({ type: 'query-begin', queryId: query.id });
        },
        endQueryEXT(target) {
            assert.equal(target, this.TIME_ELAPSED_EXT);
            assert.notEqual(records.activeQuery, null, '활성 query 없이 종료하면 안 됩니다.');
            records.events.push({ type: 'query-end', queryId: records.activeQuery.id });
            records.activeQuery = null;
        },
        getQueryObjectEXT(query, parameter) {
            if (parameter === this.QUERY_RESULT_AVAILABLE_EXT) {
                return query.available;
            }
            assert.equal(parameter, this.QUERY_RESULT_EXT);
            return query.resultNanoseconds;
        }
    };

    const gl = {
        canvas,
        ARRAY_BUFFER: 0x8892,
        STATIC_DRAW: 0x88E4,
        VERTEX_SHADER: 0x8B31,
        FRAGMENT_SHADER: 0x8B30,
        COMPILE_STATUS: 0x8B81,
        LINK_STATUS: 0x8B82,
        TEXTURE_2D: 0x0DE1,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        CLAMP_TO_EDGE: 0x812F,
        LINEAR: 0x2601,
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
        FRAMEBUFFER: 0x8D40,
        COLOR_BUFFER_BIT: 0x4000,
        COLOR_ATTACHMENT0: 0x8CE0,
        BLEND: 0x0BE2,
        ONE: 1,
        ONE_MINUS_SRC_ALPHA: 0x0303,
        FLOAT: 0x1406,
        TEXTURE0: 0x84C0,
        TRIANGLE_STRIP: 0x0005,
        UNPACK_FLIP_Y_WEBGL: 0x9240,
        UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
        getExtension(name) {
            records.extensionRequests.push(name);
            return name === 'EXT_disjoint_timer_query' ? timerExtension : null;
        },
        getParameter(parameter) {
            assert.equal(parameter, timerExtension.GPU_DISJOINT_EXT);
            records.disjointReadCount += 1;
            return false;
        },
        createShader: () => createHandle('shader'),
        shaderSource() {},
        compileShader() {},
        getShaderParameter: () => true,
        getShaderInfoLog: () => '',
        deleteShader() {},
        createProgram: () => createHandle('program'),
        attachShader() {},
        linkProgram() {},
        getProgramParameter: () => true,
        getProgramInfoLog: () => '',
        deleteProgram() {},
        getUniformLocation: (_program, name) => name,
        getAttribLocation: () => 0,
        createBuffer: () => createHandle('buffer'),
        bindBuffer() {},
        bufferData() {},
        deleteBuffer() {},
        createTexture: () => createHandle('texture'),
        bindTexture() {},
        texParameteri() {},
        texImage2D() {
            records.texImageCallCount += 1;
            if (records.throwOnTexImage) {
                throw new Error('synthetic texImage2D failure');
            }
        },
        texSubImage2D() {},
        deleteTexture() {},
        createFramebuffer: () => createHandle('framebuffer'),
        bindFramebuffer() {},
        framebufferTexture2D() {},
        deleteFramebuffer() {},
        viewport() {},
        clearColor() {},
        clear() {},
        enable() {},
        blendFunc() {},
        useProgram() {},
        enableVertexAttribArray() {},
        vertexAttribPointer() {},
        activeTexture() {},
        uniform1i() {},
        uniform1f() {},
        uniform2f() {},
        uniform4f() {},
        uniform4fv() {},
        uniformMatrix4fv() {},
        pixelStorei() {},
        drawArrays() {
            records.events.push({
                type: 'draw',
                queryId: records.activeQuery?.id ?? null
            });
            if (records.throwOnDraw) {
                throw new Error('synthetic draw failure');
            }
        },
        finish() {
            records.finishCallCount += 1;
            assert.fail('telemetry 경로는 gl.finish()를 호출하면 안 됩니다.');
        },
        readPixels() {
            records.readPixelsCallCount += 1;
            assert.fail('telemetry 경로는 gl.readPixels()를 호출하면 안 됩니다.');
        }
    };

    return {
        gl,
        records,
        dispatchContextLost() {
            const listeners = Array.from(canvasListeners.get('webglcontextlost') || []);
            for (const listener of listeners) {
                listener({ type: 'webglcontextlost' });
            }
        },
        markQueriesAvailable() {
            for (const query of records.queries) {
                query.available = true;
            }
        }
    };
}

function createOverlayCommand(overrides = {}) {
    const sourceCanvas = { width: 8, height: 4 };
    const panelCanvas = {
        width: 6,
        height: 5,
        __overlayTextureRevision: 1
    };
    const snapshotIdentity = {};
    return {
        shape: 'glassPanel',
        x: 4,
        y: 3,
        w: 24,
        h: 16,
        radius: 3,
        blur: 8,
        blurRevision: 1,
        alpha: 0.9,
        lineWidth: 1,
        fill: [0.1, 0.2, 0.3, 0.4],
        stroke: [0.8, 0.8, 0.8, 0.5],
        tintColor: [1, 1, 1, 1],
        edgeColor: [1, 1, 1, 1],
        shadowRadius: 2,
        shadowColor: [0, 0, 0, 0.5],
        effectTextureCanvas: panelCanvas,
        sourceProvider: () => ({
            snapshotIdentity,
            sourceRevision: 1,
            sources: [
                { kind: 'canvas', canvas: sourceCanvas, revision: 1, opacity: 1 },
                { kind: 'dim', opacity: 0.25 }
            ]
        }),
        ...overrides
    };
}

/**
 * vm 모듈 realm의 GPU sample을 host realm 객체로 복사합니다.
 * @param {Array<object>} samples - 원본 sample입니다.
 * @returns {Array<object>} 비교 가능한 sample입니다.
 */
function toHostGpuSamples(samples) {
    return Array.from(samples, (sample) => ({
        rendererId: sample.rendererId,
        trialGeneration: sample.trialGeneration,
        scope: sample.scope,
        frameId: sample.frameId,
        gpuMs: sample.gpuMs
    }));
}

test('overlay GPU telemetry는 기본 비활성이고 활성화할 때만 WebGL1 256-slot ring을 만든다', () => {
    telemetryState.setWebGLGpuTelemetryEnabled(false);
    telemetryState.resetRetiredWebGLGpuTelemetry();
    const harness = createOverlayTelemetryHarness();
    const renderer = new OverlayEffectRenderer(harness.gl, {
        rendererId: 'title-overlay-lazy'
    });

    const disabledSnapshot = renderer.getGpuTelemetrySnapshot();
    assert.equal(renderer.gpuTimerQueryRing, null);
    assert.equal(disabledSnapshot.enabled, false);
    assert.equal(disabledSnapshot.timer.status, 'disabled');
    assert.equal(disabledSnapshot.timer.reason, 'telemetry-not-enabled');
    assert.equal(disabledSnapshot.timer.capacity, 0);
    assert.equal(renderer.gpuTelemetryFrameSamples, null);
    assert.equal(renderer.gpuTelemetryFrameSampleCount, 0);
    assert.deepEqual(harness.records.extensionRequests, []);

    renderer.beginFrame(64, 32);
    renderer.render(createOverlayCommand({
        sampleBackdrop: false,
        effectTextureCanvas: null,
        shadowRadius: 0
    }));
    assert.equal(renderer.gpuTelemetryFrameSamples, null);
    assert.equal(renderer.gpuTelemetryFrameSampleCount, 0);
    assert.equal(renderer.getGpuTelemetrySnapshot().completedFrameSampleCount, 0);
    assert.deepEqual(harness.records.extensionRequests, []);

    assert.equal(renderer.setGpuTelemetryEnabled(true), true);
    assert.equal(telemetryState.isWebGLGpuTelemetryEnabled(), true);
    const timerRing = renderer.gpuTimerQueryRing;
    const enabledSnapshot = renderer.getGpuTelemetrySnapshot();
    assert.notEqual(timerRing, null);
    assert.equal(timerRing.slots.length, 256);
    assert.equal(enabledSnapshot.timer.capacity, 256);
    assert.equal(enabledSnapshot.timer.api, 'webgl1');
    assert.equal(enabledSnapshot.timer.allocatedQueryCount, 0);
    assert.deepEqual(harness.records.extensionRequests, [
        'EXT_disjoint_timer_query_webgl2',
        'EXT_disjoint_timer_query'
    ]);

    assert.equal(renderer.setGpuTelemetryEnabled(true), true);
    assert.strictEqual(renderer.gpuTimerQueryRing, timerRing);
    assert.equal(harness.records.extensionRequests.length, 2);

    telemetryState.setWebGLGpuTelemetryEnabled(false);
    renderer.beginFrame(64, 32);
    assert.equal(renderer.getGpuTelemetrySnapshot().enabled, false);
    assert.equal(harness.records.disjointReadCount, 0);
    renderer.destroy();
    telemetryState.resetRetiredWebGLGpuTelemetry();
});

test('overlay GPU telemetry는 capture+Kawase와 glass draw를 순차 query하고 다음 frame에 샘플과 카운터를 반환한다', () => {
    telemetryState.setWebGLGpuTelemetryEnabled(false);
    telemetryState.resetRetiredWebGLGpuTelemetry();
    telemetryState.resetWebGLGpuTelemetryFrameId();
    const trialGeneration = telemetryState.getWebGLGpuTelemetryTrialGeneration();
    const harness = createOverlayTelemetryHarness();
    const renderer = new OverlayEffectRenderer(harness.gl, {
        rendererId: 'title-menu-overlay-effect'
    });
    renderer.setGpuTelemetryEnabled(true);
    renderer.setGpuTelemetryFrameId(77);
    renderer.beginFrame(64, 32);
    renderer.render(createOverlayCommand());

    let timerSnapshot = renderer.getGpuTelemetrySnapshot().timer;
    assert.equal(timerSnapshot.pendingCount, 2);
    assert.equal(timerSnapshot.totalBeginCount, 2);
    assert.equal(timerSnapshot.totalEndCount, 2);
    assert.equal(timerSnapshot.overlappingBeginCount, 0);
    assert.equal(timerSnapshot.active, false);
    assert.deepEqual(toHostGpuSamples(renderer.drainGpuTelemetry().gpuSamples), []);

    harness.markQueriesAvailable();
    renderer.setGpuTelemetryFrameId(78);
    renderer.beginFrame(64, 32);
    const telemetry = renderer.drainGpuTelemetry();

    assert.deepEqual(toHostGpuSamples(telemetry.gpuSamples), [
        {
            rendererId: 'title-menu-overlay-effect',
            trialGeneration,
            scope: 'title.overlay_blur_composite.gpu_ms',
            frameId: 77,
            gpuMs: 1.75
        },
        {
            rendererId: 'title-menu-overlay-effect',
            trialGeneration,
            scope: 'title.overlay_glass_draw.gpu_ms',
            frameId: 77,
            gpuMs: 0.25
        }
    ]);
    assert.equal(telemetry.frameSamples.length, 1);
    const frameSample = telemetry.frameSamples[0];
    assert.deepEqual({
        rendererId: frameSample.rendererId,
        frameId: frameSample.frameId,
        renderCallCount: frameSample.renderCallCount,
        blurRefreshCount: frameSample.blurRefreshCount,
        sourceCount: frameSample.sourceCount,
        sourceTextureAllocationCount: frameSample.sourceTextureAllocationCount,
        sourceUploadCount: frameSample.sourceUploadCount,
        sourceFullUploadCount: frameSample.sourceFullUploadCount,
        sourceSubUploadCount: frameSample.sourceSubUploadCount,
        sourceUploadPixelCount: frameSample.sourceUploadPixelCount,
        panelTextureAllocationCount: frameSample.panelTextureAllocationCount,
        panelUploadCount: frameSample.panelUploadCount,
        panelUploadPixelCount: frameSample.panelUploadPixelCount,
        compositeDrawCount: frameSample.compositeDrawCount,
        blurDownPassCount: frameSample.blurDownPassCount,
        blurUpPassCount: frameSample.blurUpPassCount,
        glassDrawCount: frameSample.glassDrawCount,
        shadowDrawCount: frameSample.shadowDrawCount,
        panelTextureDrawCount: frameSample.panelTextureDrawCount
    }, {
        rendererId: 'title-menu-overlay-effect',
        frameId: 77,
        renderCallCount: 1,
        blurRefreshCount: 1,
        sourceCount: 2,
        sourceTextureAllocationCount: 1,
        sourceUploadCount: 1,
        sourceFullUploadCount: 1,
        sourceSubUploadCount: 0,
        sourceUploadPixelCount: 32,
        panelTextureAllocationCount: 1,
        panelUploadCount: 1,
        panelUploadPixelCount: 30,
        compositeDrawCount: 2,
        blurDownPassCount: 4,
        blurUpPassCount: 3,
        glassDrawCount: 1,
        shadowDrawCount: 1,
        panelTextureDrawCount: 1
    });

    const queryEvents = harness.records.events.filter((event) => event.type !== 'draw');
    assert.deepEqual(queryEvents, [
        { type: 'query-begin', queryId: 1 },
        { type: 'query-end', queryId: 1 },
        { type: 'query-begin', queryId: 2 },
        { type: 'query-end', queryId: 2 }
    ]);
    assert.equal(
        harness.records.events.filter((event) => event.type === 'draw' && event.queryId === 1).length,
        9
    );
    assert.equal(
        harness.records.events.filter((event) => event.type === 'draw' && event.queryId === 2).length,
        3
    );
    assert.equal(harness.records.maxActiveQueryCount, 1);
    assert.equal(harness.records.overlappingQueryAttemptCount, 0);
    assert.equal(harness.records.activeQuery, null);
    assert.equal(harness.records.finishCallCount, 0);
    assert.equal(harness.records.readPixelsCallCount, 0);

    timerSnapshot = renderer.getGpuTelemetrySnapshot().timer;
    assert.equal(timerSnapshot.pendingCount, 0);
    assert.equal(timerSnapshot.totalSampleCount, 2);
    renderer.destroy();
    telemetryState.setWebGLGpuTelemetryEnabled(false);
    telemetryState.resetRetiredWebGLGpuTelemetry();
});

test('telemetry frame ID 재사용은 ALWAYS blur의 단조 render serial을 바꾸지 않는다', () => {
    telemetryState.setWebGLGpuTelemetryEnabled(false);
    telemetryState.resetRetiredWebGLGpuTelemetry();
    const harness = createOverlayTelemetryHarness();
    const renderer = new OverlayEffectRenderer(harness.gl, {
        rendererId: 'serial-independent-overlay'
    });
    const command = createOverlayCommand({ blurUpdateMode: 'always' });

    renderer.setGpuTelemetryEnabled(true);
    renderer.setGpuTelemetryFrameId(5);
    renderer.beginFrame(64, 32);
    renderer.render(command);
    renderer.setGpuTelemetryFrameId(5);
    renderer.beginFrame(64, 32);
    renderer.render(command);

    assert.equal(renderer.frameSerial, 2);
    assert.equal(renderer.lastBlurFrameSerial, 2);
    assert.equal(renderer.getGpuTelemetrySnapshot().timer.totalBeginCount, 4);

    harness.markQueriesAvailable();
    renderer.setGpuTelemetryFrameId(6);
    renderer.beginFrame(64, 32);
    const telemetry = renderer.drainGpuTelemetry();
    assert.equal(telemetry.frameSamples.length, 2);
    assert.deepEqual(Array.from(telemetry.frameSamples, (sample) => ({
        frameId: sample.frameId,
        blurRefreshCount: sample.blurRefreshCount
    })), [
        { frameId: 5, blurRefreshCount: 1 },
        { frameId: 5, blurRefreshCount: 1 }
    ]);

    renderer.destroy();
    telemetryState.setWebGLGpuTelemetryEnabled(false);
    telemetryState.resetRetiredWebGLGpuTelemetry();
});

test('surface destroy는 pending query와 마지막 frame을 retired collector에 넘긴다', () => {
    telemetryState.setWebGLGpuTelemetryEnabled(true);
    telemetryState.resetRetiredWebGLGpuTelemetry();
    telemetryState.resetWebGLGpuTelemetryFrameId();
    const harness = createOverlayTelemetryHarness();
    const renderer = new OverlayEffectRenderer(harness.gl, {
        rendererId: 'closing-modal-effect'
    });

    renderer.setGpuTelemetryFrameId(31);
    renderer.beginFrame(64, 32);
    renderer.render(createOverlayCommand());
    renderer.destroy();

    let retiredState = telemetryState.getRetiredWebGLGpuTelemetrySnapshot();
    assert.equal(retiredState.collectorCount, 1);
    assert.equal(retiredState.pendingQueryCount, 2);
    assert.equal(retiredState.bufferedFrameSampleCount, 1);
    assert.equal(harness.records.queries.some((query) => query.deleted), false);

    harness.markQueriesAvailable();
    const retired = telemetryState.drainRetiredWebGLGpuTelemetry();
    assert.equal(retired.gpuSamples.length, 2);
    assert.equal(retired.frameSamples.length, 1);
    assert.equal(retired.collectorSnapshots[0].completed, true);
    assert.equal(retired.collectorSnapshots[0].rendererId, 'closing-modal-effect');
    retiredState = telemetryState.getRetiredWebGLGpuTelemetrySnapshot();
    assert.equal(retiredState.collectorCount, 0);
    assert.equal(retiredState.droppedGpuSampleCount, 0);
    assert.equal(harness.records.queries.every((query) => query.deleted), true);

    telemetryState.setWebGLGpuTelemetryEnabled(false);
    telemetryState.resetRetiredWebGLGpuTelemetry();
});

test('draw 예외의 partial query는 정상 GPU sample 대신 abort와 실패 frame으로 남는다', () => {
    telemetryState.setWebGLGpuTelemetryEnabled(true);
    telemetryState.resetRetiredWebGLGpuTelemetry();
    const harness = createOverlayTelemetryHarness();
    const renderer = new OverlayEffectRenderer(harness.gl, {
        rendererId: 'failing-overlay-effect'
    });
    harness.records.throwOnDraw = true;

    renderer.setGpuTelemetryFrameId(44);
    renderer.beginFrame(64, 32);
    assert.throws(() => renderer.render(createOverlayCommand()), /synthetic draw failure/);
    let timer = renderer.getGpuTelemetrySnapshot().timer;
    assert.equal(timer.pendingCount, 0);
    assert.equal(timer.abortedQueryCount, 1);
    assert.equal(timer.discardedQueryCount, 1);
    assert.deepEqual(toHostGpuSamples(renderer.drainGpuTelemetry().gpuSamples), []);

    renderer.setGpuTelemetryFrameId(45);
    renderer.beginFrame(64, 32);
    const telemetry = renderer.drainGpuTelemetry();
    assert.equal(telemetry.frameSamples.length, 1);
    assert.equal(telemetry.frameSamples[0].failedBlurRefreshCount, 1);
    assert.equal(telemetry.frameSamples[0].failedGlassDrawCount, 0);

    renderer.destroy();
    const retired = telemetryState.drainRetiredWebGLGpuTelemetry();
    assert.equal(retired.collectorSnapshots.length, 1);
    timer = retired.collectorSnapshots[0].timer;
    assert.equal(timer.abortedQueryCount, 1);
    assert.equal(timer.discardedQueryCount, 1);

    telemetryState.setWebGLGpuTelemetryEnabled(false);
    telemetryState.resetRetiredWebGLGpuTelemetry();
});

test('sourceProvider 예외는 GPU query를 시작하지 않고 provider와 blur 실패 카운터로 남는다', () => {
    telemetryState.setWebGLGpuTelemetryEnabled(false);
    telemetryState.resetRetiredWebGLGpuTelemetry();
    const harness = createOverlayTelemetryHarness();
    const renderer = new OverlayEffectRenderer(harness.gl, {
        rendererId: 'provider-failing-overlay'
    });
    renderer.setGpuTelemetryEnabled(true);

    renderer.setGpuTelemetryFrameId(51);
    renderer.beginFrame(64, 32);
    assert.throws(() => renderer.render(createOverlayCommand({
        sourceProvider() {
            throw new Error('synthetic source provider failure');
        }
    })), /synthetic source provider failure/);
    assert.equal(renderer.getGpuTelemetrySnapshot().timer.totalBeginCount, 0);

    renderer.setGpuTelemetryFrameId(52);
    renderer.beginFrame(64, 32);
    const telemetry = renderer.drainGpuTelemetry();
    assert.equal(telemetry.gpuSamples.length, 0);
    assert.equal(telemetry.frameSamples.length, 1);
    assert.deepEqual({
        frameId: telemetry.frameSamples[0].frameId,
        renderCallCount: telemetry.frameSamples[0].renderCallCount,
        blurRefreshCount: telemetry.frameSamples[0].blurRefreshCount,
        sourceProviderFailureCount: telemetry.frameSamples[0].sourceProviderFailureCount,
        failedBlurRefreshCount: telemetry.frameSamples[0].failedBlurRefreshCount,
        failedGlassDrawCount: telemetry.frameSamples[0].failedGlassDrawCount
    }, {
        frameId: 51,
        renderCallCount: 1,
        blurRefreshCount: 0,
        sourceProviderFailureCount: 1,
        failedBlurRefreshCount: 1,
        failedGlassDrawCount: 0
    });

    renderer.destroy();
    telemetryState.setWebGLGpuTelemetryEnabled(false);
    telemetryState.resetRetiredWebGLGpuTelemetry();
});

test('source texImage2D 업로드 실패는 partial blur query를 폐기하고 frame 실패를 명시한다', () => {
    telemetryState.setWebGLGpuTelemetryEnabled(false);
    telemetryState.resetRetiredWebGLGpuTelemetry();
    const harness = createOverlayTelemetryHarness();
    const renderer = new OverlayEffectRenderer(harness.gl, {
        rendererId: 'upload-failing-overlay'
    });
    renderer.setGpuTelemetryEnabled(true);

    renderer.setGpuTelemetryFrameId(61);
    renderer.beginFrame(64, 32);
    harness.records.throwOnTexImage = true;
    renderer.render(createOverlayCommand({ effectTextureCanvas: null }));

    const timer = renderer.getGpuTelemetrySnapshot().timer;
    assert.equal(timer.totalBeginCount, 2);
    assert.equal(timer.totalEndCount, 2);
    assert.equal(timer.abortedQueryCount, 1);
    assert.equal(timer.discardedQueryCount, 1);
    assert.equal(timer.pendingCount, 1);

    renderer.setGpuTelemetryFrameId(62);
    renderer.beginFrame(64, 32);
    const telemetry = renderer.drainGpuTelemetry();
    assert.equal(telemetry.gpuSamples.length, 0);
    assert.equal(telemetry.frameSamples.length, 1);
    assert.deepEqual({
        frameId: telemetry.frameSamples[0].frameId,
        blurRefreshCount: telemetry.frameSamples[0].blurRefreshCount,
        failedBlurRefreshCount: telemetry.frameSamples[0].failedBlurRefreshCount,
        sourceCount: telemetry.frameSamples[0].sourceCount,
        sourceTextureAllocationCount: telemetry.frameSamples[0].sourceTextureAllocationCount,
        sourceUploadCount: telemetry.frameSamples[0].sourceUploadCount,
        sourceUploadFailureCount: telemetry.frameSamples[0].sourceUploadFailureCount,
        compositeDrawCount: telemetry.frameSamples[0].compositeDrawCount,
        glassDrawCount: telemetry.frameSamples[0].glassDrawCount
    }, {
        frameId: 61,
        blurRefreshCount: 1,
        failedBlurRefreshCount: 1,
        sourceCount: 2,
        sourceTextureAllocationCount: 1,
        sourceUploadCount: 0,
        sourceUploadFailureCount: 1,
        compositeDrawCount: 1,
        glassDrawCount: 1
    });

    renderer.destroy();
    telemetryState.setWebGLGpuTelemetryEnabled(false);
    telemetryState.resetRetiredWebGLGpuTelemetry();
});

test('synthetic webglcontextlost는 pending query와 frame을 무효화된 retired collector로 단 한 번 이관한다', () => {
    telemetryState.setWebGLGpuTelemetryEnabled(true);
    telemetryState.resetRetiredWebGLGpuTelemetry();
    const harness = createOverlayTelemetryHarness();
    const renderer = new OverlayEffectRenderer(harness.gl, {
        rendererId: 'context-lost-overlay'
    });

    renderer.setGpuTelemetryFrameId(71);
    renderer.beginFrame(64, 32);
    renderer.render(createOverlayCommand());
    assert.equal(renderer.getGpuTelemetrySnapshot().timer.pendingCount, 2);

    harness.dispatchContextLost();
    harness.dispatchContextLost();
    assert.equal(renderer.gpuTimerQueryRing, null);
    assert.equal(renderer.getGpuTelemetrySnapshot().enabled, false);
    let retiredState = telemetryState.getRetiredWebGLGpuTelemetrySnapshot();
    assert.equal(retiredState.contextLossCount, 1);
    assert.equal(retiredState.collectorCount, 1);
    assert.equal(retiredState.pendingQueryCount, 0);
    assert.equal(retiredState.bufferedFrameSampleCount, 1);
    assert.equal(harness.records.queries.every((query) => query.deleted), true);

    const retired = telemetryState.drainRetiredWebGLGpuTelemetry();
    assert.equal(retired.gpuSamples.length, 0);
    assert.equal(retired.frameSamples.length, 1);
    assert.equal(retired.frameSamples[0].frameId, 71);
    assert.equal(retired.collectorSnapshots.length, 1);
    assert.equal(retired.collectorSnapshots[0].completed, true);
    assert.equal(retired.collectorSnapshots[0].timer.status, 'faulted');
    assert.equal(retired.collectorSnapshots[0].timer.reason, 'webgl-context-lost');
    assert.equal(retired.collectorSnapshots[0].timer.contextInvalidationCount, 1);
    assert.equal(retired.collectorSnapshots[0].timer.contextDiscardedQueryCount, 2);
    assert.equal(retired.collectorSnapshots[0].timer.discardedQueryCount, 2);
    retiredState = telemetryState.getRetiredWebGLGpuTelemetrySnapshot();
    assert.equal(retiredState.collectorCount, 0);
    assert.equal(retiredState.contextLossCount, 1);

    renderer.destroy();
    telemetryState.setWebGLGpuTelemetryEnabled(false);
    telemetryState.resetRetiredWebGLGpuTelemetry();
});
