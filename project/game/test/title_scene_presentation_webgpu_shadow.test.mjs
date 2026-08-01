import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(
    new URL('../script/module/scene/title/_title_scene_presentation.js', import.meta.url),
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

test('Kawase shadow graph는 session에 한 번 고정되고 visible draw 뒤 encode되며 실패를 격리한다', async () => {
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
    assert.equal(dependencies.blurAlgorithmId, 'kawase-compatibility');
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

async function createPresentationFixture({ displayPortsReady = true } = {}) {
    const trace = [];
    const context = vm.createContext({ console });
    let displayFramePort = displayPortsReady ? { id: 'display-frame' } : null;
    let displayBlurPort = displayPortsReady ? { id: 'display-blur' } : null;
    class Gradient {
        constructor() {
            this.elapsed = 3;
            this.colorData = new Float32Array(15);
        }

        draw() {
            trace.push('gradient');
        }

        destroy() {}
    }
    class Background {
        constructor() {
            this.shieldEffect = {};
        }

        draw() {
            trace.push('background');
        }

        destroy() {}
    }
    class LoadingContent {
        constructor() {
            this.centerCircle = { introBlur: 7 };
            this.titleLogo = { id: 'logo' };
            this.ready = true;
        }

        draw() {
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
            'getWebGpuBlurPort',
            'getWebGpuFrameContributorPort'
        ], function init() {
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
                'webgpu-kawase': 'kawase-compatibility',
                'webgpu-gaussian': 'gaussian-quality'
            })[pipelineMode] ?? null);
            this.setExport('TitleWebGpuBaseGraph', class TitleWebGpuBaseGraph {});
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
        setDisplayPorts({ framePort, blurPort }) {
            displayFramePort = framePort;
            displayBlurPort = blurPort;
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
