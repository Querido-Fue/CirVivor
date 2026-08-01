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
const projectDirectory = path.resolve(testDirectory, '..', '..');
const harnessDirectory = path.join(testDirectory, 'nw_title_gpu_pipeline');

async function readHarnessFile(fileName) {
    return fs.readFile(path.join(harnessDirectory, fileName), 'utf8');
}

async function executeBootstrap(config) {
    const source = await readHarnessFile('bootstrap.js');
    const telemetryEvents = [];
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
        assert.equal(specifier, 'display/webgl/_webgl_gpu_telemetry_state.js');
        return telemetryModule;
    });
    await bootstrapModule.evaluate();
    return telemetryEvents;
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

    const selected = parseArguments([
        '--profile=smoke',
        '--scenarios=T5,T2,T4',
        '--samples=12',
        '--cycles=2',
        '--capture'
    ]);
    assert.deepEqual(selected.scenarios, ['T2', 'T4', 'T5']);
    assert.equal(selected.requestedSamples, 12);
    assert.equal(selected.cycles, 2);
    assert.equal(selected.capture, true);
    assert.equal(selected.timing, false, 'capture와 timing은 같은 run에서 섞지 않습니다.');
    assert.throws(() => parseArguments(['--scenarios', 'T9']), /지원하지 않는 scenario/);
    assert.throws(() => parseArguments(['--samples', '0']), /양의 정수/);
    assert.throws(() => parseArguments(['--clock-step-ms', '0']), /0보다 큰/);
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
    assert.deepEqual(
        await executeBootstrap({ timing: true }),
        ['reset-retired', 'reset-frame-id', 'enabled:true']
    );
    assert.deepEqual(
        await executeBootstrap({ timing: false, capture: true }),
        ['reset-retired', 'reset-frame-id', 'enabled:false']
    );
    assert.match(bootstrapSource, /createMulberry32/);
    assert.match(bootstrapSource, /installSyntheticRafClock/);
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
        'node game/test/support/run_nw_title_gpu_pipeline.mjs --profile smoke'
    );
    assert.match(packageJson.scripts['test:title-gpu:qa'], /--profile qa/);
    assert.match(packageJson.scripts['test:title-gpu:qa'], /--keep-run-directory/);
    assert.equal(
        packageJson.scripts['benchmark:title-gpu'],
        'node game/test/support/run_nw_title_gpu_pipeline.mjs --profile full'
    );
});
