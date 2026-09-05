import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
    aggregateTrials,
    isSafeRunDirectory,
    nearestRank,
    parseArguments
} from './support/run_nw_title_gpu_pipeline.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(testDirectory, '..', 'project');
const harnessDirectory = path.join(testDirectory, 'nw_title_gpu_pipeline');

async function readHarnessFile(fileName) {
    return fs.readFile(path.join(harnessDirectory, fileName), 'utf8');
}

async function executeBootstrap(config) {
    const source = await readHarnessFile('bootstrap.js');
    const telemetryEvents = [];
    const rolloutEvents = [];
    const context = vm.createContext({
        console,
        process: {
            env: {
                CIRVIVOR_TITLE_GPU_CONFIG: JSON.stringify(config)
            }
        },
        window: {
            requestAnimationFrame() {
                return 1;
            },
            cancelAnimationFrame() {}
        }
    });
    const telemetryModule = new vm.SyntheticModule([
        'resetRetiredWebGLGpuTelemetry',
        'resetWebGLGpuTelemetryFrameId',
        'setWebGLGpuTelemetryEnabled'
    ], function initialize() {
        this.setExport('resetRetiredWebGLGpuTelemetry', () => {
            telemetryEvents.push('reset-retired');
        });
        this.setExport('resetWebGLGpuTelemetryFrameId', () => {
            telemetryEvents.push('reset-frame-id');
        });
        this.setExport('setWebGLGpuTelemetryEnabled', (enabled) => {
            telemetryEvents.push(`enabled:${enabled}`);
        });
    }, { context });
    const bootstrapModule = new vm.SourceTextModule(source, {
        context,
        identifier: 'nw_title_gpu_pipeline/bootstrap.js'
    });
    await bootstrapModule.link((specifier) => {
        if (specifier === 'display/webgl/_webgl_gpu_telemetry_state.js') {
            return telemetryModule;
        }
        assert.equal(specifier, 'scene/title/_title_gpu_rollout.js');
        return new vm.SyntheticModule(['setTitleGpuRolloutTestOverride'], function initialize() {
            this.setExport('setTitleGpuRolloutTestOverride', (profile) => {
                rolloutEvents.push(profile === null ? null : {
                    pipelineMode: profile.pipelineMode,
                    simulationMode: profile.simulationMode
                });
                return profile;
            });
        }, { context });
    });
    await bootstrapModule.evaluate();
    return { telemetryEvents, rolloutEvents };
}

function createFullOverlayValidation({
    frameId = 41,
    deviceGeneration = 3,
    receiptOverrides = {},
    cutoverOverrides = {}
} = {}) {
    const fullCutover = {
        fullCutoverActive: true,
        legacyVisibleSurfaceCount: 0,
        webGpuSurfaceVisible: true,
        topControlSurfacePreserved: true,
        cssPresentationNeutralized: true,
        fallbackPending: false,
        destroyed: false
    };
    return {
        titleWebGpuShadowDiagnostics: {
            overlay: {
                coordinator: {
                    lastGraphReceipt: {
                        status: 'committed',
                        committed: true,
                        submitted: true,
                        frameId,
                        deviceGeneration,
                        finalOverlayIncluded: true,
                        baseCheckpointConsumed: true,
                        vignetteIncluded: true,
                        fullScenePresented: true,
                        finalCanvasPassCount: 1,
                        presentPassCount: 1,
                        failure: null,
                        abortReason: null,
                        cutoverStatus: { ...fullCutover },
                        ...receiptOverrides
                    },
                    cutover: {
                        ...fullCutover,
                        lastCommittedFrameId: frameId,
                        lastCommittedDeviceGeneration: deviceGeneration,
                        ...cutoverOverrides
                    }
                }
            }
        }
    };
}

test('smoke CLI는 T0~T5와 bounded 1회 profile을 정규화한다', () => {
    const config = parseArguments(['--profile', 'smoke']);
    assert.deepEqual(config.scenarios, ['T0', 'T1', 'T2', 'T3', 'T4', 'T5']);
    assert.equal(config.coldStarts, 1);
    assert.equal(config.warmupMs, 1000);
    assert.equal(config.requestedSamples, 240);
    assert.equal(config.cycles, 4);
    assert.equal(config.capture, false);
    assert.equal(config.timing, true);
    assert.equal(config.pipelineMode, 'webgpu-kawase');
    assert.equal(config.simulationMode, 'cpu');

    const selected = parseArguments([
        '--profile=smoke',
        '--scenarios=T5,T2,T4',
        '--samples=12',
        '--cycles=2',
        '--pipeline-mode=webgpu-gaussian',
        '--simulation-mode=cpu',
        '--capture'
    ]);
    assert.deepEqual(selected.scenarios, ['T2', 'T4', 'T5']);
    assert.equal(selected.requestedSamples, 12);
    assert.equal(selected.cycles, 2);
    assert.equal(selected.capture, true);
    assert.equal(selected.timing, false, 'capture와 timing은 같은 run에서 섞지 않습니다.');
    assert.equal(selected.pipelineMode, 'webgpu-gaussian');
    assert.equal(selected.simulationMode, 'cpu');
    assert.throws(() => parseArguments(['--scenarios', 'T9']), /지원하지 않는 scenario/);
    assert.throws(() => parseArguments(['--samples', '0']), /양의 정수/);
    assert.throws(() => parseArguments(['--clock-step-ms', '0']), /0보다 큰/);
    assert.throws(() => parseArguments(['--pipeline-mode', 'unknown']), /pipeline mode/);
    assert.throws(() => parseArguments(['--simulation-mode', 'unknown']), /simulation mode/);
    assert.throws(
        () => parseArguments(['--pipeline-mode', 'legacy-webgl', '--simulation-mode', 'gpu']),
        /WebGPU title pipeline/
    );
});

test('nearest-rank와 cold trial aggregate는 raw trial p99를 임의 제거하지 않는다', () => {
    assert.equal(nearestRank([5, 1, 4, 3, 2], 0.99), 5);
    assert.equal(nearestRank([1, 2, 3, 4], 0.5), 2);
    assert.equal(nearestRank([], 0.99), null);

    const makeTrial = (p99) => ({
        status: 'pass',
        scenarios: [{
            id: 'T4',
            gpu: {
                scopes: {
                    'title.overlay_blur_composite.gpu_ms': { frameTotal: { p99 } }
                }
            }
        }]
    });
    const aggregate = aggregateTrials([makeTrial(0.8), makeTrial(1.1), makeTrial(0.9)]);
    assert.deepEqual(aggregate.scenarios[0].trialP99, [0.8, 1.1, 0.9]);
    assert.deepEqual(aggregate.scenarios[0].trialSampleCounts, [null, null, null]);
    assert.equal(aggregate.scenarios[0].missingTrialCount, 0);
    assert.equal(aggregate.scenarios[0].invalidTrialCount, 0);
    assert.equal(aggregate.scenarios[0].insufficientSampleTrialCount, 0);
    assert.equal(aggregate.scenarios[0].medianP99, 0.9);
    assert.equal(aggregate.scenarios[0].worstP99, 1.1);
    assert.equal(aggregate.status, 'pass');
});

test('strict aggregate는 expected metric 누락과 requested sample 부족 trial을 실패 처리한다', () => {
    const metric = 'title.overlay_blur_composite.gpu_ms';
    const makeStrictTrial = (scenarios) => ({
        status: 'pass',
        config: {
            requireGpuTimestamps: true,
            requestedSamples: 2000,
            scenarios: ['T4', 'T5']
        },
        scenarios
    });
    const aggregate = aggregateTrials([
        makeStrictTrial([{
            id: 'T4',
            gpu: { scopes: { [metric]: { frameTotal: { count: 2000, p99: 0.8 } } } }
        }]),
        makeStrictTrial([{
            id: 'T4',
            gpu: { scopes: { [metric]: { frameTotal: { count: 1999, p99: 0.9 } } } }
        }, {
            id: 'T5',
            gpu: { scopes: { [metric]: { frameTotal: { count: 2000, p99: 0.7 } } } }
        }])
    ]);

    const t4 = aggregate.scenarios.find((scenario) => scenario.id === 'T4');
    const t5 = aggregate.scenarios.find((scenario) => scenario.id === 'T5');
    assert.deepEqual(t4.trialP99, [0.8, 0.9]);
    assert.deepEqual(t4.trialSampleCounts, [2000, 1999]);
    assert.equal(t4.missingTrialCount, 0);
    assert.equal(t4.invalidTrialCount, 0);
    assert.equal(t4.insufficientSampleTrialCount, 1);
    assert.deepEqual(t5.trialP99, [null, 0.7]);
    assert.deepEqual(t5.trialSampleCounts, [null, 2000]);
    assert.equal(t5.missingTrialCount, 1);
    assert.equal(t5.invalidTrialCount, 0);
    assert.equal(t5.insufficientSampleTrialCount, 0);
    assert.equal(aggregate.status, 'fail');
});

test('strict aggregate는 충분한 count라도 invalid p99와 비정수 count를 실패 처리한다', () => {
    const metric = 'title.overlay_blur_composite.gpu_ms';
    const makeStrictTrial = (frameTotal) => ({
        status: 'pass',
        config: {
            requireGpuTimestamps: true,
            requestedSamples: 2000,
            scenarios: ['T4']
        },
        scenarios: [{
            id: 'T4',
            gpu: { scopes: { [metric]: { frameTotal } } }
        }]
    });
    const aggregate = aggregateTrials([
        makeStrictTrial({ count: 2000, p99: null }),
        makeStrictTrial({ count: 2000.5, p99: 0.8 })
    ]);
    const t4 = aggregate.scenarios[0];

    assert.deepEqual(t4.trialP99, [null, 0.8]);
    assert.deepEqual(t4.trialSampleCounts, [2000, 2000.5]);
    assert.equal(t4.missingTrialCount, 0);
    assert.equal(t4.invalidTrialCount, 2);
    assert.equal(t4.insufficientSampleTrialCount, 0);
    assert.equal(aggregate.status, 'fail');
});

test('WebGPU pipeline aggregate는 WebGL scope와 섞지 않고 composer graph metric만 사용한다', () => {
    const webGpuMetric = 'title.webgpu_graph.gpu_ms';
    const aggregate = aggregateTrials([{
        status: 'pass',
        profile: 'full',
        coldStartIndex: 0,
        config: {
            profile: 'full',
            pipelineMode: 'webgpu-gaussian',
            requireGpuTimestamps: true,
            requestedSamples: 2000,
            scenarios: ['T5']
        },
        validation: createFullOverlayValidation(),
        scenarios: [{
            id: 'T5',
            gpu: {
                scopes: {
                    'title.overlay_blur_composite.gpu_ms': {
                        frameTotal: { count: 2000, p99: 0.01 }
                    }
                }
            },
            webgpu: {
                scopes: {
                    [webGpuMetric]: {
                        frameTotal: { count: 2000, p99: 0.94 }
                    }
                }
            }
        }]
    }]);

    assert.equal(aggregate.status, 'pass');
    assert.equal(aggregate.scenarios[0].metric, webGpuMetric);
    assert.deepEqual(aggregate.scenarios[0].trialP99, [0.94]);
    assert.equal(aggregate.scenarios[0].worstP99, 0.94);
    assert.deepEqual(aggregate.measurement, {
        metric: webGpuMetric,
        scope: 'title-webgpu-unified-full-scene',
        provisional: false,
        finalOverlayIncluded: true,
        qualification: 'unified-full-scene',
        receiptValidation: {
            required: true,
            passed: true,
            qualifiedTrialCount: 1,
            unqualifiedTrialCount: 0,
            trials: [{
                trialIndex: 0,
                coldStartIndex: 0,
                qualified: true,
                frameId: 41,
                deviceGeneration: 3,
                failures: []
            }]
        }
    });
    assert.deepEqual(aggregate.budget, {
        percentile: 'p99',
        limitMs: 1,
        required: true,
        policy: 'every-required-cold-trial-p99-lte-limit',
        passed: true,
        provisional: false,
        finalOverlayIncluded: true
    });
    assert.equal(aggregate.scenarios[0].budgetRequiredTrialCount, 1);
    assert.equal(aggregate.scenarios[0].budgetEvidenceTrialCount, 1);
    assert.equal(aggregate.scenarios[0].budgetMissingEvidenceTrialCount, 0);
    assert.equal(aggregate.scenarios[0].overBudgetTrialCount, 0);
    assert.equal(aggregate.scenarios[0].budgetPassed, true);
});

test('nonlegacy full aggregate는 cold trial p99 1.0ms 초과와 근거를 명시적으로 실패 처리한다', () => {
    const metric = 'title.webgpu_graph.gpu_ms';
    const makeTrial = (coldStartIndex, p99) => ({
        status: 'pass',
        profile: 'full',
        coldStartIndex,
        config: {
            profile: 'full',
            pipelineMode: 'webgpu-kawase',
            requireGpuTimestamps: true,
            requestedSamples: 12,
            scenarios: ['T4']
        },
        validation: createFullOverlayValidation({ frameId: 50 + coldStartIndex }),
        scenarios: [{
            id: 'T4',
            gpu: {
                scopes: {
                    'title.overlay_blur_composite.gpu_ms': {
                        frameTotal: { count: 12, p99: 0.01 }
                    }
                }
            },
            webgpu: {
                scopes: {
                    [metric]: { frameTotal: { count: 12, p99 } }
                }
            }
        }]
    });
    const aggregate = aggregateTrials([
        makeTrial(0, 1.0),
        makeTrial(1, 1.000001)
    ]);
    const scenario = aggregate.scenarios[0];

    assert.equal(aggregate.status, 'fail');
    assert.equal(aggregate.budget.required, true);
    assert.equal(aggregate.budget.passed, false);
    assert.equal(scenario.worstP99, 1.000001);
    assert.equal(scenario.budgetLimitMs, 1);
    assert.equal(scenario.budgetRequiredTrialCount, 2);
    assert.equal(scenario.budgetEvidenceTrialCount, 2);
    assert.equal(scenario.budgetMissingEvidenceTrialCount, 0);
    assert.equal(scenario.budgetUnqualifiedReceiptTrialCount, 0);
    assert.equal(scenario.overBudgetTrialCount, 1);
    assert.equal(scenario.budgetPassed, false);
    assert.equal(scenario.overBudgetTrials[0].trialIndex, 1);
    assert.equal(scenario.overBudgetTrials[0].coldStartIndex, 1);
    assert.equal(scenario.overBudgetTrials[0].p99, 1.000001);
    assert.equal(scenario.overBudgetTrials[0].limitMs, 1);
    assert.ok(Math.abs(scenario.overBudgetTrials[0].overByMs - 0.000001) < 1e-12);
});

test('nonlegacy full budget evidence 결측은 timestamp strict flag와 무관하게 fail-closed다', () => {
    const aggregate = aggregateTrials([{
        status: 'pass',
        profile: 'full',
        coldStartIndex: 2,
        config: {
            profile: 'full',
            pipelineMode: 'webgpu-gaussian',
            requireGpuTimestamps: false,
            requestedSamples: 12,
            scenarios: ['T5']
        },
        validation: createFullOverlayValidation(),
        scenarios: [{ id: 'T5', gpu: { scopes: {} }, webgpu: { scopes: {} } }]
    }]);
    const scenario = aggregate.scenarios[0];

    assert.equal(aggregate.status, 'fail');
    assert.equal(aggregate.budget.required, true);
    assert.equal(aggregate.budget.passed, false);
    assert.equal(scenario.budgetRequiredTrialCount, 1);
    assert.equal(scenario.budgetEvidenceTrialCount, 0);
    assert.equal(scenario.budgetMissingEvidenceTrialCount, 1);
    assert.equal(scenario.budgetUnqualifiedReceiptTrialCount, 0);
    assert.equal(scenario.overBudgetTrialCount, 0);
    assert.equal(scenario.budgetPassed, false);
});

test('WebGPU full aggregate는 missing, malformed, stale receipt를 p99 근거로 인정하지 않는다', () => {
    const metric = 'title.webgpu_graph.gpu_ms';
    const makeTrial = (coldStartIndex, validation) => ({
        status: 'pass',
        profile: 'full',
        coldStartIndex,
        config: {
            profile: 'full',
            pipelineMode: 'webgpu-gaussian',
            requireGpuTimestamps: true,
            requestedSamples: 12,
            scenarios: ['T5']
        },
        validation,
        scenarios: [{
            id: 'T5',
            webgpu: {
                scopes: {
                    [metric]: { frameTotal: { count: 12, p99: 0.5 } }
                }
            }
        }]
    });
    const missing = makeTrial(0, {});
    const malformed = makeTrial(1, createFullOverlayValidation({
        receiptOverrides: { finalCanvasPassCount: 2 }
    }));
    const stale = makeTrial(2, createFullOverlayValidation({
        frameId: 70,
        cutoverOverrides: { lastCommittedFrameId: 71 }
    }));
    const aggregate = aggregateTrials([missing, malformed, stale]);
    const scenario = aggregate.scenarios[0];
    const receiptTrials = aggregate.measurement.receiptValidation.trials;

    assert.equal(aggregate.status, 'fail');
    assert.equal(aggregate.measurement.scope, 'title-webgpu-base-shadow-graph');
    assert.equal(aggregate.measurement.provisional, true);
    assert.equal(aggregate.measurement.finalOverlayIncluded, false);
    assert.equal(
        aggregate.measurement.qualification,
        'full-overlay-receipt-unqualified'
    );
    assert.equal(aggregate.measurement.receiptValidation.passed, false);
    assert.equal(aggregate.measurement.receiptValidation.qualifiedTrialCount, 0);
    assert.equal(aggregate.measurement.receiptValidation.unqualifiedTrialCount, 3);
    assert.deepEqual(receiptTrials[0].failures, [
        'missing-coordinator-diagnostics',
        'missing-last-graph-receipt',
        'coordinator-cutover-not-qualified',
        'cutover-commit-identity-invalid'
    ]);
    assert.deepEqual(receiptTrials[1].failures, [
        'final-canvas-pass-count-not-one'
    ]);
    assert.deepEqual(receiptTrials[2].failures, [
        'stale-cutover-commit-identity'
    ]);
    assert.deepEqual(scenario.trialP99, [0.5, 0.5, 0.5]);
    assert.equal(scenario.budgetRequiredTrialCount, 3);
    assert.equal(scenario.budgetEvidenceTrialCount, 0);
    assert.equal(scenario.budgetMissingEvidenceTrialCount, 3);
    assert.equal(scenario.budgetUnqualifiedReceiptTrialCount, 3);
    assert.equal(scenario.budgetPassed, false);
    assert.equal(aggregate.budget.passed, false);
});

test('recursive cleanup 대상은 os temp 바로 아래의 전용 prefix로 제한한다', () => {
    assert.equal(
        isSafeRunDirectory(path.join(os.tmpdir(), 'cirvivor-title-gpu-contract')),
        true
    );
    assert.equal(isSafeRunDirectory(projectDirectory), false);
    assert.equal(isSafeRunDirectory(path.join(os.tmpdir(), 'unrelated-directory')), false);
});

test('bootstrap은 production main 전 telemetry state와 deterministic clock을 설치한다', async () => {
    const [bootstrapSource, launcherSource] = await Promise.all([
        readHarnessFile('bootstrap.js'),
        fs.readFile(path.join(testDirectory, 'support', 'run_nw_title_gpu_pipeline.mjs'), 'utf8')
    ]);
    assert.match(bootstrapSource, /resetWebGLGpuTelemetryFrameId/);
    assert.match(bootstrapSource, /resetRetiredWebGLGpuTelemetry/);
    assert.match(bootstrapSource, /setWebGLGpuTelemetryEnabled\(config\.timing === true\)/);
    assert.ok(
        bootstrapSource.indexOf('resetRetiredWebGLGpuTelemetry();')
            < bootstrapSource.indexOf('resetWebGLGpuTelemetryFrameId();')
    );
    assert.ok(
        bootstrapSource.indexOf('resetWebGLGpuTelemetryFrameId();')
            < bootstrapSource.indexOf('setWebGLGpuTelemetryEnabled(config.timing === true);')
    );
    assert.deepEqual(await executeBootstrap({
        timing: true,
        pipelineMode: 'webgpu-kawase',
        simulationMode: 'cpu'
    }), {
        telemetryEvents: ['reset-retired', 'reset-frame-id', 'enabled:true'],
        rolloutEvents: [{ pipelineMode: 'webgpu-kawase', simulationMode: 'cpu' }]
    });
    assert.deepEqual(await executeBootstrap({ timing: false, capture: true }), {
        telemetryEvents: ['reset-retired', 'reset-frame-id', 'enabled:false'],
        rolloutEvents: [null]
    });
    assert.match(bootstrapSource, /createMulberry32/);
    assert.match(bootstrapSource, /installSyntheticRafClock/);
    assert.match(bootstrapSource, /setTitleGpuRolloutTestOverride/);
    assert.match(launcherSource, /bootstrap\.js[^]*script\/main\.js/);
    await assert.rejects(
        fs.access(path.join(harnessDirectory, 'index.html')),
        /ENOENT/,
        'production index를 runtime staging하고 중복 HTML은 두지 않습니다.'
    );
});

test('runner는 live renderer를 열거하고 rendererId를 붙여 비동기 telemetry만 회수한다', async () => {
    const [runnerSource, scenarioSource, adapterSource] = await Promise.all([
        readHarnessFile('runner.js'),
        readHarnessFile('scenario_driver.js'),
        readHarnessFile('title_harness_adapter.js')
    ]);
    assert.match(runnerSource, /webGLHandler\?\.layerRenderers/);
    assert.match(runnerSource, /renderer\.drainGpuTelemetry\(\)/);
    assert.match(runnerSource, /drainRetiredWebGLGpuTelemetry\(\)/);
    assert.match(runnerSource, /getRetiredWebGLGpuTelemetrySnapshot\(\)/);
    assert.match(runnerSource, /trialGeneration/);
    assert.match(runnerSource, /rendererId: sample\.rendererId \|\| rendererId/);
    assert.match(runnerSource, /QUERY_DRAIN_FRAME_LIMIT/);
    assert.match(runnerSource, /getTitleWebGpuShadowDiagnostics/);
    assert.match(runnerSource, /encodeSuccessCount/);
    assert.match(runnerSource, /config\.pipelineMode !== 'legacy-webgl'/);
    assert.match(runnerSource, /getWebGpuFrameTelemetryPort/);
    assert.match(runnerSource, /webGpuTelemetryPort\?\.setEnabled/);
    assert.match(runnerSource, /webGpuTelemetryPort\?\.drainSamples/);
    assert.match(runnerSource, /title\.webgpu_graph\.gpu_ms/);
    assert.match(runnerSource, /webGpuSamples/);
    assert.match(
        runnerSource,
        /const timingFrameId = collectWebGpu \? webGpuFrameId : frameId;/,
        'nonlegacy timing window는 비활성 WebGL counter가 아니라 composer frame identity를 사용합니다.'
    );
    assert.match(runnerSource, /record\.firstFrameId \?\?= timingFrameId;/);
    assert.match(runnerSource, /record\.lastFrameId = timingFrameId;/);
    for (const scenarioId of ['T0', 'T1', 'T2', 'T3', 'T4', 'T5']) {
        assert.match(scenarioSource, new RegExp(`run${scenarioId}`));
    }
    assert.match(adapterSource, /openExternalLinkWarningOverlay/);
    assert.match(adapterSource, /openTitleOverlay\?\.\('setting'\)/);
    assert.match(adapterSource, /control_windowMode/);
    assert.doesNotMatch(scenarioSource, /quiesceOverlay/);

    const timingSources = `${runnerSource}\n${scenarioSource}\n${adapterSource}`;
    for (const forbiddenCall of ['gl.finish(', 'readPixels(', 'mapAsync(', 'onSubmittedWorkDone(']) {
        assert.equal(
            timingSources.includes(forbiddenCall),
            false,
            `timing harness에 동기 GPU 작업이 없어야 합니다: ${forbiddenCall}`
        );
    }
});

test('package scripts는 smoke, timing 분리 QA, full benchmark를 노출한다', async () => {
    const packageJson = JSON.parse(
        await fs.readFile(path.join(projectDirectory, 'package.json'), 'utf8')
    );
    assert.equal(
        packageJson.scripts['test:title-gpu:smoke'],
        'node ../test/support/run_nw_title_gpu_pipeline.mjs --profile smoke'
    );
    assert.match(packageJson.scripts['test:title-gpu:qa'], /--profile qa/);
    assert.match(packageJson.scripts['test:title-gpu:qa'], /--keep-run-directory/);
    assert.equal(
        packageJson.scripts['benchmark:title-gpu'],
        'node ../test/support/run_nw_title_gpu_pipeline.mjs --profile full'
    );
});
