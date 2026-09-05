import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(
    new URL('../project/game/script/module/scene/title/_title_scene_presentation.js', import.meta.url),
    'utf8'
);

test('legacy profile은 graph를 만들지 않고 기존 visible draw 순서만 유지한다', async () => {
    const fixture = await createPresentationFixture();
    let factoryCount = 0;
    const presentation = new fixture.TitleScenePresentation(fixture.controller, {
        titleGpuRolloutProfile: Object.freeze({
            pipelineMode: 'legacy-webgl',
            simulationMode: 'cpu'
        }),
        titleWebGpuBaseGraphFactory() {
            factoryCount += 1;
            return createFakeGraph(fixture.trace);
        }
    });

    presentation.draw();
    assert.equal(factoryCount, 0);
    assert.deepEqual(fixture.trace, ['gradient', 'background', 'content']);
    assert.equal(presentation.getTitleWebGpuShadowDiagnostics().status, 'legacy-visible');
});

test('optimized Kawase shadow graph는 session에 한 번 고정되고 visible draw 뒤 encode되며 실패를 격리한다', async () => {
    const fixture = await createPresentationFixture();
    const graph = createFakeGraph(fixture.trace);
    let factoryCount = 0;
    let dependencies = null;
    const profile = Object.freeze({
        pipelineMode: 'webgpu-kawase',
        simulationMode: 'cpu'
    });
    const framePort = { id: 'frame-port' };
    const blurPort = { id: 'blur-port' };
    const presentation = new fixture.TitleScenePresentation(fixture.controller, {
        titleGpuRolloutProfile: profile,
        webGpuFramePort: framePort,
        webGpuBlurPort: blurPort,
        titleWebGpuBaseGraphFactory(input) {
            factoryCount += 1;
            dependencies = input;
            return graph;
        }
    });

    assert.equal(factoryCount, 1);
    assert.strictEqual(dependencies.framePort, framePort);
    assert.strictEqual(dependencies.blurPort, blurPort);
    assert.equal(dependencies.blurAlgorithmId, 'kawase-optimized');
    assert.strictEqual(presentation.getTitleGpuRolloutProfile(), profile);

    presentation.draw();
    assert.deepEqual(fixture.trace, ['gradient', 'background', 'content', 'shadow']);
    assert.strictEqual(graph.lastInput.titleBackground, presentation.titleBackground);
    assert.strictEqual(graph.lastInput.centerCircle, presentation.content.centerCircle);
    assert.strictEqual(graph.lastInput.titleLogo, presentation.content.titleLogo);

    fixture.trace.length = 0;
    graph.throwOnEncode = true;
    assert.doesNotThrow(() => presentation.draw());
    assert.deepEqual(fixture.trace, ['gradient', 'background', 'content', 'shadow']);
    assert.equal(presentation.getTitleWebGpuShadowDiagnostics().failureCount, 1);

    assert.equal(presentation.beginTitleScenePhase(), true);
    assert.strictEqual(presentation.titleWebGpuBaseGraph, graph);
    assert.equal(factoryCount, 1);
    presentation.destroy();
    presentation.destroy();
    assert.equal(graph.destroyCount, 1);
});

test('Gaussian은 등록 ID가 명시되지 않으면 shadow-unavailable이고 legacy visible을 계속 그린다', async () => {
    const fixture = await createPresentationFixture();
    let factoryCount = 0;
    let registrationCheckCount = 0;
    const unavailable = new fixture.TitleScenePresentation(fixture.controller, {
        titleGpuRolloutProfile: Object.freeze({
            pipelineMode: 'webgpu-gaussian',
            simulationMode: 'cpu'
        }),
        webGpuFramePort: {},
        webGpuBlurPort: {
            hasAlgorithm() {
                registrationCheckCount += 1;
                return false;
            }
        },
        titleWebGpuBaseGraphFactory() {
            factoryCount += 1;
            return createFakeGraph(fixture.trace);
        }
    });
    unavailable.draw();
    unavailable.draw();
    assert.equal(factoryCount, 0);
    assert.equal(registrationCheckCount, 1, 'immutable registry miss는 session에 latch해야 합니다.');
    assert.deepEqual(fixture.trace, [
        'gradient', 'background', 'content',
        'gradient', 'background', 'content'
    ]);
    assert.equal(unavailable.getTitleWebGpuShadowDiagnostics().status, 'shadow-unavailable');
    assert.equal(
        unavailable.getTitleWebGpuShadowDiagnostics().reason,
        'blur-algorithm-not-registered'
    );

    fixture.trace.length = 0;
    const graph = createFakeGraph(fixture.trace);
    const available = new fixture.TitleScenePresentation(fixture.controller, {
        titleGpuRolloutProfile: Object.freeze({
            pipelineMode: 'webgpu-gaussian',
            simulationMode: 'cpu'
        }),
        webGpuFramePort: {},
        webGpuBlurPort: {
            hasAlgorithm(algorithmId) {
                return algorithmId === 'gaussian-quality';
            }
        },
        titleWebGpuBaseGraphFactory(input) {
            assert.equal(input.blurAlgorithmId, 'gaussian-quality');
            return graph;
        }
    });
    available.draw();
    assert.deepEqual(fixture.trace, ['gradient', 'background', 'content', 'shadow']);
});

test('optimized Kawase 미등록은 compatibility로 숨기지 않고 session에 unavailable로 고정한다', async () => {
    const fixture = await createPresentationFixture();
    let factoryCount = 0;
    let registrationCheckCount = 0;
    const presentation = new fixture.TitleScenePresentation(fixture.controller, {
        titleGpuRolloutProfile: Object.freeze({
            pipelineMode: 'webgpu-kawase',
            simulationMode: 'cpu'
        }),
        webGpuFramePort: {},
        webGpuBlurPort: {
            hasAlgorithm(algorithmId) {
                registrationCheckCount += 1;
                assert.equal(algorithmId, 'kawase-optimized');
                return algorithmId === 'kawase-compatibility';
            }
        },
        titleWebGpuBaseGraphFactory() {
            factoryCount += 1;
            return createFakeGraph(fixture.trace);
        }
    });

    presentation.draw();
    presentation.draw();
    assert.equal(factoryCount, 0);
    assert.equal(registrationCheckCount, 1);
    assert.equal(presentation.getTitleWebGpuShadowDiagnostics().status, 'shadow-unavailable');
    assert.equal(
        presentation.getTitleWebGpuShadowDiagnostics().reason,
        'blur-algorithm-not-registered'
    );
    assert.deepEqual(fixture.trace, [
        'gradient', 'background', 'content',
        'gradient', 'background', 'content'
    ]);
});

test('Display port가 늦게 준비되면 같은 session profile로 graph를 한 번만 lazy 생성한다', async () => {
    const fixture = await createPresentationFixture({ displayPortsReady: false });
    let factoryCount = 0;
    const graph = createFakeGraph(fixture.trace);
    const presentation = new fixture.TitleScenePresentation(fixture.controller, {
        titleGpuRolloutProfile: Object.freeze({
            pipelineMode: 'webgpu-kawase',
            simulationMode: 'cpu'
        }),
        titleWebGpuBaseGraphFactory() {
            factoryCount += 1;
            return graph;
        }
    });
    assert.equal(factoryCount, 0);
    presentation.draw();
    assert.deepEqual(fixture.trace, ['gradient', 'background', 'content']);
    assert.equal(factoryCount, 0);

    fixture.setDisplayPorts({ framePort: {}, blurPort: {} });
    fixture.trace.length = 0;
    presentation.draw();
    presentation.draw();
    assert.equal(factoryCount, 1);
    assert.deepEqual(fixture.trace, [
        'gradient', 'background', 'content', 'shadow',
        'gradient', 'background', 'content', 'shadow'
    ]);
    assert.equal(presentation.getTitleWebGpuShadowDiagnostics().status, 'shadow-ready');
});

test('overlay pipeline은 draw 전 capture를 열고 모든 overlay draw 뒤 같은 frame C0를 최종화한다', async () => {
    const fixture = await createPresentationFixture({ overlayDisplayReady: true });
    const graph = createFakeGraph(fixture.trace);
    const coordinator = createFakeOverlayCoordinator(fixture.trace);
    let pipelineInput = null;
    const presentation = new fixture.TitleScenePresentation(fixture.controller, {
        titleGpuRolloutProfile: Object.freeze({
            pipelineMode: 'webgpu-kawase',
            simulationMode: 'cpu'
        }),
        webGpuFramePort: { id: 'frame-port' },
        webGpuBlurPort: { id: 'blur-port' },
        displaySystem: fixture.displaySystem,
        titleWebGpuBaseGraphFactory() {
            return graph;
        },
        titleWebGpuOverlayPipelineFactory(input) {
            pipelineInput = input;
            return coordinator;
        }
    });
    const mainSnapshot = Object.freeze({ frameId: 17, sessionIdentity: 'main' });
    presentation.content.titleMenu = {
        session: {
            getTitleWebGpuPresentationSnapshot() {
                fixture.trace.push('main-snapshot');
                return mainSnapshot;
            }
        }
    };
    const managerSnapshots = Object.freeze([
        Object.freeze({ frameId: 17, sessionIdentity: 'manager' })
    ]);

    presentation.draw();
    assert.deepEqual(fixture.trace, [
        'overlay-begin',
        'capture-begin',
        'gradient',
        'background',
        'content',
        'shadow'
    ]);
    assert.equal(pipelineInput.blurAlgorithmId, 'kawase-optimized');
    assert.equal(pipelineInput.surfaceProvider().length, 2);

    assert.equal(presentation.finalizeWebGpuPresentation({
        overlaySnapshots: managerSnapshots
    }), true);
    assert.deepEqual(fixture.trace.slice(-3), [
        'main-snapshot',
        'overlay-finalize',
        'capture-end'
    ]);
    assert.strictEqual(coordinator.lastFinalize.mainSnapshot, mainSnapshot);
    assert.strictEqual(coordinator.lastFinalize.managerSnapshots, managerSnapshots);
    assert.equal(coordinator.lastFinalize.dynamicSurfaces.length, 1);
    assert.equal(coordinator.lastFinalize.vignettePacket.revision, 3);

    fixture.trace.length = 0;
    presentation.draw();
    assert.equal(presentation.finalizeWebGpuPresentation({
        overlaySnapshots: null
    }), false);
    assert.deepEqual(fixture.trace.slice(-2), ['overlay-abort', 'capture-end']);

    presentation.destroy();
    assert.equal(coordinator.destroyCount, 1);
});

test('active cutover는 legacy raster만 생략하고 content 준비와 base graph encode를 유지한다', async () => {
    const fixture = await createPresentationFixture({ overlayDisplayReady: true });
    const graph = createFakeGraph(fixture.trace);
    const coordinator = createFakeOverlayCoordinator(fixture.trace, {
        legacyDrawRequired: false
    });
    const presentation = new fixture.TitleScenePresentation(fixture.controller, {
        titleGpuRolloutProfile: Object.freeze({
            pipelineMode: 'webgpu-gaussian',
            simulationMode: 'cpu'
        }),
        webGpuFramePort: { id: 'frame-port' },
        webGpuBlurPort: { id: 'blur-port' },
        displaySystem: fixture.displaySystem,
        titleWebGpuBaseGraphFactory: () => graph,
        titleWebGpuOverlayPipelineFactory: () => coordinator
    });

    presentation.draw();
    assert.deepEqual(fixture.trace, [
        'overlay-begin',
        'capture-begin',
        'content',
        'shadow'
    ]);
    assert.equal(presentation.titleGradientBackground.prepareCount, 1);
    assert.equal(presentation.content.lastDrawOptions.legacyDrawRequired, false);
    assert.equal(presentation.finalizeWebGpuPresentation({ overlaySnapshots: [] }), true);

    coordinator.legacyDrawRequired = true;
    fixture.trace.length = 0;
    presentation.draw();
    assert.deepEqual(fixture.trace, [
        'overlay-begin',
        'capture-begin',
        'gradient',
        'background',
        'content',
        'shadow'
    ]);
    assert.equal(presentation.titleGradientBackground.prepareCount, 2);
    assert.equal(presentation.content.lastDrawOptions.legacyDrawRequired, true);
    assert.equal(presentation.finalizeWebGpuPresentation({ overlaySnapshots: [] }), true);
    presentation.destroy();
});

test('overlay begin 거부 뒤 완성된 legacy draw만 post-flush fallback 완료를 한 번 요청한다', async () => {
    const fixture = await createPresentationFixture({ overlayDisplayReady: true });
    const coordinator = createFakeOverlayCoordinator(fixture.trace, {
        failureMode: 'begin-rejected'
    });
    const presentation = new fixture.TitleScenePresentation(fixture.controller, {
        titleGpuRolloutProfile: Object.freeze({
            pipelineMode: 'webgpu-gaussian',
            simulationMode: 'cpu'
        }),
        webGpuFramePort: { id: 'frame-port' },
        webGpuBlurPort: { id: 'blur-port' },
        displaySystem: fixture.displaySystem,
        titleWebGpuBaseGraphFactory: () => createFakeGraph(fixture.trace),
        titleWebGpuOverlayPipelineFactory: () => coordinator
    });

    presentation.draw();
    assert.equal(presentation.completePresentationFallback(), true);
    assert.equal(presentation.completePresentationFallback(), false);
    assert.equal(fixture.trace.filter((entry) => entry === 'overlay-fallback-complete').length, 1);
    presentation.destroy();
});

test('GPU simulation은 overlay begin/finalize의 모든 실패 출구에서 CPU epoch로 fail-closed한다', async () => {
    for (const failureMode of [
        'begin-rejected',
        'frame-unavailable',
        'finalize-rejected',
        'finalize-threw'
    ]) {
        const fixture = await createPresentationFixture({ overlayDisplayReady: true });
        const graph = createFakeGraph(fixture.trace);
        const coordinator = createFakeOverlayCoordinator(fixture.trace, { failureMode });
        const presentation = new fixture.TitleScenePresentation(fixture.controller, {
            titleGpuRolloutProfile: Object.freeze({
                pipelineMode: 'webgpu-gaussian',
                simulationMode: 'gpu'
            }),
            webGpuFramePort: { id: 'frame-port' },
            webGpuBlurPort: { id: 'blur-port' },
            displaySystem: fixture.displaySystem,
            titleWebGpuBaseGraphFactory() {
                return graph;
            },
            titleWebGpuOverlayPipelineFactory() {
                return coordinator;
            }
        });

        if (failureMode === 'frame-unavailable') {
            assert.equal(presentation.finalizeWebGpuPresentation({ overlaySnapshots: [] }), false);
        } else {
            presentation.draw();
            if (failureMode !== 'begin-rejected') {
                assert.equal(presentation.finalizeWebGpuPresentation({ overlaySnapshots: [] }), false);
            }
        }

        assert.equal(presentation.titleBackground.simulationMode, 'cpu');
        assert.equal(presentation.titleBackground.fallbackReasons.length, 1);
        assert.match(presentation.titleBackground.fallbackReasons[0], /^overlay-/u);
        presentation.destroy();
    }
});

async function createPresentationFixture({
    displayPortsReady = true,
    overlayDisplayReady = false
} = {}) {
    const trace = [];
    const context = vm.createContext({ console });
    let displayFramePort = displayPortsReady ? { id: 'display-frame' } : null;
    let displayBlurPort = displayPortsReady ? { id: 'display-blur' } : null;
    let activeCaptureToken = null;
    const gpuCanvas = { width: 1280, height: 720, style: {} };
    const dynamicCanvas = { width: 1280, height: 720, style: {} };
    const displaySystem = overlayDisplayReady ? {
        webGpuFrameSerial: 17,
        surfaceMap: new Map([
            ['gpu-object', {
                id: 'gpu-object',
                canvas: gpuCanvas,
                dynamic: false
            }],
            ['dynamic:ui:1', {
                id: 'dynamic:ui:1',
                canvas: dynamicCanvas,
                dynamic: true,
                contentRevision: 2
            }]
        ]),
        getSurface(id) {
            return this.surfaceMap.get(id) ?? null;
        },
        vignetteRenderer: {
            getWebGpuPresentationPacket() {
                return Object.freeze({ revision: 3, visible: true });
            }
        }
    } : null;
    class Gradient {
        constructor() {
            this.elapsed = 3;
            this.colorData = new Float32Array(15);
            this.prepareCount = 0;
        }

        prepareFrame() {
            this.prepareCount += 1;
        }

        draw() {
            this.prepareFrame();
            trace.push('gradient');
        }

        destroy() {}
    }
    class Background {
        constructor(controller, options = {}) {
            this.shieldEffect = {};
            this.simulationMode = options.simulationMode ?? 'cpu';
            this.fallbackReasons = [];
        }

        draw() {
            trace.push('background');
        }

        fallbackToCpuSimulation(reason) {
            if (this.simulationMode !== 'gpu') return false;
            this.simulationMode = 'cpu';
            this.fallbackReasons.push(reason);
            trace.push(`simulation-fallback:${reason}`);
            return true;
        }

        destroy() {}
    }
    class LoadingContent {
        constructor() {
            this.centerCircle = { introBlur: 7 };
            this.titleLogo = { id: 'logo' };
            this.ready = true;
        }

        draw(options = {}) {
            this.lastDrawOptions = options;
            trace.push('content');
        }

        releaseTitleIntroAssets() {
            if (!this.ready) return null;
            return {
                centerCircle: this.centerCircle,
                titleLogo: this.titleLogo,
                titleMenu: {},
                centerIntroBlurAnimId: -1
            };
        }

        destroy() {}
    }
    class IntroContent {
        constructor(controller, assets) {
            this.centerCircle = assets.centerCircle;
            this.titleLogo = assets.titleLogo;
        }

        draw() {
            trace.push('content');
        }

        destroy() {}
    }
    const modules = new Map([
        ['display/display_system.js', new vm.SyntheticModule([
            'getDisplaySystem',
            'getWebGpuBlurPort',
            'getWebGpuFrameContributorPort'
        ], function init() {
            this.setExport('getDisplaySystem', () => displaySystem);
            this.setExport('getWebGpuBlurPort', () => displayBlurPort);
            this.setExport('getWebGpuFrameContributorPort', () => displayFramePort);
        }, { context })],
        ['./_title_background.js', exportClass(context, 'TitleBackGround', Background)],
        ['./_title_gradient_background.js', exportClass(
            context,
            'TitleGradientBackground',
            Gradient
        )],
        ['./_title_loading_sequence.js', exportClass(
            context,
            'TitleLoadingSequence',
            LoadingContent
        )],
        ['./_title_scene_intro_sequence.js', exportClass(
            context,
            'TitleSceneIntroSequence',
            IntroContent
        )],
        ['./_title_gpu_rollout.js', new vm.SyntheticModule(['TITLE_PIPELINE_MODE'], function init() {
            this.setExport('TITLE_PIPELINE_MODE', {
                LEGACY_WEBGL: 'legacy-webgl',
                WEBGPU_KAWASE: 'webgpu-kawase',
                WEBGPU_GAUSSIAN: 'webgpu-gaussian'
            });
        }, { context })],
        ['./webgpu/_title_webgpu_base_graph.js', new vm.SyntheticModule([
            'getTitleWebGpuBaseGraphBlurAlgorithmId',
            'TitleWebGpuBaseGraph'
        ], function init() {
            this.setExport('getTitleWebGpuBaseGraphBlurAlgorithmId', (pipelineMode) => ({
                'webgpu-kawase': 'kawase-optimized',
                'webgpu-gaussian': 'gaussian-quality'
            })[pipelineMode] ?? null);
            this.setExport('TitleWebGpuBaseGraph', class TitleWebGpuBaseGraph {});
        }, { context })],
        ['./webgpu/_title_webgpu_overlay_capture_gate.js', new vm.SyntheticModule([
            'beginTitleWebGpuOverlayCapture',
            'endTitleWebGpuOverlayCapture'
        ], function init() {
            this.setExport('beginTitleWebGpuOverlayCapture', (display, frameId) => {
                if (!display || activeCaptureToken) return null;
                activeCaptureToken = Object.freeze({ display, frameId });
                trace.push('capture-begin');
                return activeCaptureToken;
            });
            this.setExport('endTitleWebGpuOverlayCapture', (display, token) => {
                if (token !== activeCaptureToken || token?.display !== display) return false;
                activeCaptureToken = null;
                trace.push('capture-end');
                return true;
            });
        }, { context })],
        ['./webgpu/_title_webgpu_overlay_pipeline.js', new vm.SyntheticModule([
            'createTitleWebGpuOverlayPipeline'
        ], function init() {
            this.setExport('createTitleWebGpuOverlayPipeline', () => null);
        }, { context })]
    ]);
    const runtimeModule = new vm.SourceTextModule(source, {
        context,
        identifier: '_title_scene_presentation.js'
    });
    await runtimeModule.link((specifier) => modules.get(specifier));
    await runtimeModule.evaluate();
    const controller = {
        content: null,
        setTitleContent(content) {
            this.content = content;
        },
        syncViewportMetrics() {}
    };
    return {
        TitleScenePresentation: runtimeModule.namespace.TitleScenePresentation,
        controller,
        trace,
        displaySystem,
        setDisplayPorts({ framePort, blurPort }) {
            displayFramePort = framePort;
            displayBlurPort = blurPort;
        }
    };
}

function createFakeOverlayCoordinator(
    trace,
    { failureMode = null, legacyDrawRequired = true } = {}
) {
    return {
        lastFinalize: null,
        destroyCount: 0,
        legacyDrawRequired,
        beginFrame(input) {
            trace.push('overlay-begin');
            if (failureMode === 'begin-rejected') {
                return Object.freeze({ accepted: false, reason: 'synthetic-begin-rejection' });
            }
            return Object.freeze({
                accepted: true,
                frameId: input.frameId,
                legacyDrawRequired: this.legacyDrawRequired,
                fullCutoverActive: this.legacyDrawRequired === false
            });
        },
        finalizeFrame(input) {
            trace.push('overlay-finalize');
            this.lastFinalize = input;
            if (failureMode === 'finalize-threw') {
                throw new Error('synthetic-finalize-failure');
            }
            if (failureMode === 'finalize-rejected') {
                return Object.freeze({
                    accepted: false,
                    reason: 'synthetic-finalize-rejection'
                });
            }
            return Object.freeze({ accepted: true, frameId: input.frameId });
        },
        abortFrame() {
            trace.push('overlay-abort');
            return true;
        },
        restoreNow() {
            return false;
        },
        completeFallbackRedraw() {
            trace.push('overlay-fallback-complete');
            return true;
        },
        getDiagnostics() {
            return { status: 'ready' };
        },
        destroy() {
            this.destroyCount += 1;
            return true;
        }
    };
}

function exportClass(context, name, value) {
    return new vm.SyntheticModule([name], function init() {
        this.setExport(name, value);
    }, { context });
}

function createFakeGraph(trace) {
    return {
        throwOnEncode: false,
        destroyCount: 0,
        lastInput: null,
        encode(input) {
            trace.push('shadow');
            this.lastInput = input;
            if (this.throwOnEncode) {
                throw new Error('shadow failure');
            }
            return true;
        },
        getDiagnostics() {
            return { lastFailure: null };
        },
        destroy() {
            this.destroyCount += 1;
        }
    };
}
