import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUN_DIRECTORY_PREFIX = 'cirvivor-title-gpu-';
const EXPECTED_PLATFORM = 'win32';
const DEFAULT_TITLE_WEBGPU_GPU_BUDGET_MS = 1.0;
const TITLE_WEBGPU_PROVISIONAL_SCOPE = 'title-webgpu-base-shadow-graph';
const TITLE_WEBGPU_UNIFIED_SCOPE = 'title-webgpu-unified-full-scene';
const TITLE_WEBGL_OVERLAY_SCOPE = 'legacy-overlay-blur-composite';
const TITLE_SCENARIOS = Object.freeze(['T0', 'T1', 'T2', 'T3', 'T4', 'T5']);
const TITLE_PIPELINE_MODES = Object.freeze([
    'legacy-webgl',
    'webgpu-kawase',
    'webgpu-gaussian'
]);
const TITLE_SIMULATION_MODES = Object.freeze(['cpu', 'gpu']);
const NW_RUNTIME_ROOT_FILES = Object.freeze([
    'd3dcompiler_47.dll',
    'dxcompiler.dll',
    'dxil.dll',
    'ffmpeg.dll',
    'icudtl.dat',
    'libEGL.dll',
    'libGLESv2.dll',
    'node.dll',
    'notification_helper.exe',
    'nw_100_percent.pak',
    'nw_200_percent.pak',
    'nw_elf.dll',
    'nw.dll',
    'resources.pak',
    'v8_context_snapshot.bin',
    'vk_swiftshader_icd.json',
    'vk_swiftshader.dll',
    'vulkan-1.dll'
]);
const NW_RUNTIME_DIRECTORIES = Object.freeze(['Dictionaries', 'locales', 'swiftshader']);
const HARNESS_FILES = Object.freeze([
    'bootstrap.js',
    'coverage_validation.js',
    'runner.js',
    'scenario_driver.js',
    'title_harness_adapter.js'
]);

const PROFILE_DEFAULTS = Object.freeze({
    smoke: Object.freeze({
        scenarios: TITLE_SCENARIOS,
        coldStarts: 1,
        warmupMs: 1000,
        requestedSamples: 240,
        cycles: 4,
        timeoutMs: 300_000,
        capture: false,
        timing: true,
        requireGpuTimestamps: false,
        pipelineMode: 'webgpu-kawase',
        simulationMode: 'cpu'
    }),
    qa: Object.freeze({
        scenarios: TITLE_SCENARIOS,
        coldStarts: 1,
        warmupMs: 0,
        requestedSamples: 12,
        cycles: 1,
        timeoutMs: 300_000,
        capture: true,
        timing: false,
        requireGpuTimestamps: false,
        pipelineMode: 'webgpu-kawase',
        simulationMode: 'cpu'
    }),
    full: Object.freeze({
        scenarios: Object.freeze(['T4', 'T5']),
        coldStarts: 5,
        warmupMs: 10_000,
        requestedSamples: 2000,
        cycles: 70,
        timeoutMs: 1_200_000,
        capture: false,
        timing: true,
        requireGpuTimestamps: true,
        pipelineMode: 'webgpu-kawase',
        simulationMode: 'cpu'
    })
});

function printHelp() {
    console.log([
        'NW.js production title GPU pipeline 하네스',
        '',
        '사용법:',
        '  node game/test/support/run_nw_title_gpu_pipeline.mjs --profile smoke',
        '  node game/test/support/run_nw_title_gpu_pipeline.mjs --profile full',
        '',
        '옵션:',
        '  --scenarios T0,T1,...   실행 scenario',
        '  --cold-starts N         독립 process trial 수',
        '  --warmup-ms N           title steady warmup',
        '  --samples N             steady valid frame 목표',
        '  --cycles N              T3/T4 transition cycle',
        '  --seed N                deterministic RNG seed',
        '  --clock-step-ms N       synthetic rAF timestamp 간격',
        '  --pipeline-mode MODE    legacy-webgl | webgpu-kawase | webgpu-gaussian',
        '  --simulation-mode MODE  cpu | gpu',
        '  --capture               timing을 끄고 compositor PNG 저장',
        '  --output PATH           aggregate JSON 저장 경로',
        '  --keep-run-directory    성공한 임시 실행 디렉터리도 보존'
    ].join('\n'));
}

function parsePositiveInteger(value, optionName) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${optionName}은 양의 정수여야 합니다: ${value}`);
    }
    return parsed;
}

function parseNonNegativeNumber(value, optionName) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${optionName}은 0 이상의 유한수여야 합니다: ${value}`);
    }
    return parsed;
}

function parsePositiveNumber(value, optionName) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${optionName}은 0보다 큰 유한수여야 합니다: ${value}`);
    }
    return parsed;
}

function splitArgument(argument) {
    const equalsIndex = argument.indexOf('=');
    return equalsIndex < 0
        ? [argument, null]
        : [argument.slice(0, equalsIndex), argument.slice(equalsIndex + 1)];
}

/**
 * title GPU launcher CLI를 해석합니다.
 * @param {string[]} args - process argv tail입니다.
 * @returns {object} 정규화된 설정입니다.
 */
export function parseArguments(args) {
    if (args.includes('--help') || args.includes('-h')) {
        return { help: true };
    }
    const raw = { profile: 'smoke' };
    const valueOptions = new Set([
        '--profile', '--scenarios', '--cold-starts', '--warmup-ms', '--samples',
        '--cycles', '--seed', '--clock-step-ms', '--pipeline-mode',
        '--simulation-mode', '--output', '--nw-exe'
    ]);
    for (let index = 0; index < args.length; index++) {
        const [name, inlineValue] = splitArgument(args[index]);
        if (name === '--capture' || name === '--keep-run-directory') {
            raw[name.slice(2)] = true;
            continue;
        }
        if (!valueOptions.has(name)) {
            throw new Error(`알 수 없는 옵션입니다: ${name}`);
        }
        const value = inlineValue ?? args[++index];
        if (value === undefined) {
            throw new Error(`${name} 값이 없습니다.`);
        }
        raw[name.slice(2)] = value;
    }

    if (!PROFILE_DEFAULTS[raw.profile]) {
        throw new Error(`지원하지 않는 profile입니다: ${raw.profile}`);
    }
    const defaults = PROFILE_DEFAULTS[raw.profile];
    const requestedScenarios = raw.scenarios
        ? raw.scenarios.split(',').map((value) => value.trim()).filter(Boolean)
        : [...defaults.scenarios];
    const invalidScenario = requestedScenarios.find((value) => !TITLE_SCENARIOS.includes(value));
    if (invalidScenario) {
        throw new Error(`지원하지 않는 scenario입니다: ${invalidScenario}`);
    }
    const scenarioSet = new Set(requestedScenarios);
    const scenarios = TITLE_SCENARIOS.filter((scenarioId) => scenarioSet.has(scenarioId));
    if (scenarios.length === 0) {
        throw new Error('scenario를 하나 이상 지정해야 합니다.');
    }

    const capture = raw.capture === true || defaults.capture;
    const pipelineMode = raw['pipeline-mode'] ?? defaults.pipelineMode;
    const simulationMode = raw['simulation-mode'] ?? defaults.simulationMode;
    if (!TITLE_PIPELINE_MODES.includes(pipelineMode)) {
        throw new Error(`지원하지 않는 title pipeline mode입니다: ${pipelineMode}`);
    }
    if (!TITLE_SIMULATION_MODES.includes(simulationMode)) {
        throw new Error(`지원하지 않는 title simulation mode입니다: ${simulationMode}`);
    }
    if (pipelineMode === 'legacy-webgl' && simulationMode === 'gpu') {
        throw new Error('GPU title simulation에는 WebGPU title pipeline이 필요합니다.');
    }
    return {
        help: false,
        profile: raw.profile,
        scenarios,
        coldStarts: raw['cold-starts'] === undefined
            ? defaults.coldStarts
            : parsePositiveInteger(raw['cold-starts'], '--cold-starts'),
        warmupMs: raw['warmup-ms'] === undefined
            ? defaults.warmupMs
            : parseNonNegativeNumber(raw['warmup-ms'], '--warmup-ms'),
        requestedSamples: raw.samples === undefined
            ? defaults.requestedSamples
            : parsePositiveInteger(raw.samples, '--samples'),
        cycles: raw.cycles === undefined
            ? defaults.cycles
            : parsePositiveInteger(raw.cycles, '--cycles'),
        seed: raw.seed === undefined ? 0x719 : parseNonNegativeNumber(raw.seed, '--seed'),
        clockStepMs: raw['clock-step-ms'] === undefined
            ? 1000 / 60
            : parsePositiveNumber(raw['clock-step-ms'], '--clock-step-ms'),
        capture,
        timing: capture ? false : defaults.timing,
        requireGpuTimestamps: capture ? false : defaults.requireGpuTimestamps,
        pipelineMode,
        simulationMode,
        timeoutMs: defaults.timeoutMs,
        output: raw.output ? path.resolve(raw.output) : null,
        nwExecutable: raw['nw-exe'] ? path.resolve(raw['nw-exe']) : null,
        keepRunDirectory: raw['keep-run-directory'] === true
    };
}

/** nearest-rank percentile helper입니다. */
export function nearestRank(values, percentile) {
    if (!Array.isArray(values) || values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const rank = Math.max(1, Math.ceil(percentile * sorted.length));
    return sorted[Math.min(sorted.length - 1, rank - 1)];
}

/** 안전한 하네스 임시 디렉터리인지 확인합니다. */
export function isSafeRunDirectory(runDirectory) {
    const resolved = path.resolve(runDirectory);
    return path.dirname(resolved) === path.resolve(os.tmpdir())
        && path.basename(resolved).startsWith(RUN_DIRECTORY_PREFIX);
}

function waitForChild(child) {
    return new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
    });
}

async function removeRunDirectory(runDirectory) {
    if (!isSafeRunDirectory(runDirectory)) {
        throw new Error(`임시 실행 디렉터리 범위를 확인할 수 없습니다: ${runDirectory}`);
    }
    await fs.rm(runDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

async function linkRuntimeFile(sourcePath, destinationPath) {
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    try {
        await fs.link(sourcePath, destinationPath);
    } catch (error) {
        if (!['EXDEV', 'EPERM', 'EACCES'].includes(error?.code)) {
            throw error;
        }
        await fs.copyFile(sourcePath, destinationPath);
    }
}

async function linkRuntimeDirectory(sourceDirectory, destinationDirectory) {
    await fs.mkdir(destinationDirectory, { recursive: true });
    for (const entry of await fs.readdir(sourceDirectory, { withFileTypes: true })) {
        const sourcePath = path.join(sourceDirectory, entry.name);
        const destinationPath = path.join(destinationDirectory, entry.name);
        if (entry.isDirectory()) {
            await linkRuntimeDirectory(sourcePath, destinationPath);
        } else if (entry.isFile()) {
            await linkRuntimeFile(sourcePath, destinationPath);
        }
    }
}

async function prepareIsolatedNwRuntime(sourceExecutable, runDirectory) {
    const runtimeDirectory = path.join(runDirectory, 'runtime');
    const sourceDirectory = path.dirname(sourceExecutable);
    await fs.mkdir(runtimeDirectory, { recursive: true });
    await linkRuntimeFile(sourceExecutable, path.join(runtimeDirectory, 'nw.exe'));
    for (const fileName of NW_RUNTIME_ROOT_FILES) {
        await linkRuntimeFile(
            path.join(sourceDirectory, fileName),
            path.join(runtimeDirectory, fileName)
        );
    }
    for (const directoryName of NW_RUNTIME_DIRECTORIES) {
        await linkRuntimeDirectory(
            path.join(sourceDirectory, directoryName),
            path.join(runtimeDirectory, directoryName)
        );
    }
    return path.join(runtimeDirectory, 'nw.exe');
}

function injectHarnessScripts(productionIndex) {
    const mainScript = '    <script type="module" src="./script/main.js"></script>';
    if (!productionIndex.includes(mainScript) || !productionIndex.includes('</body>')) {
        throw new Error('production game/index.html의 script 삽입 경계를 찾지 못했습니다.');
    }
    const bootstrapScript = [
        '    <!-- title GPU harness: production main보다 먼저 deterministic state를 설치합니다. -->',
        '    <script type="module" src="./test/nw_title_gpu_pipeline/bootstrap.js"></script>',
        mainScript
    ].join('\n');
    const runnerScript = [
        '    <script type="module" src="./test/nw_title_gpu_pipeline/runner.js"></script>',
        '</body>'
    ].join('\n');
    return productionIndex
        .replace(mainScript, bootstrapScript)
        .replace('</body>', runnerScript);
}

async function prepareHarnessApp(projectDirectory, harnessDirectory, runDirectory) {
    const appDirectory = path.join(runDirectory, 'app');
    const gameDirectory = path.join(appDirectory, 'game');
    const stagedHarnessDirectory = path.join(gameDirectory, 'test', 'nw_title_gpu_pipeline');
    await fs.mkdir(stagedHarnessDirectory, { recursive: true });

    for (const fileName of HARNESS_FILES) {
        await linkRuntimeFile(
            path.join(harnessDirectory, fileName),
            path.join(stagedHarnessDirectory, fileName)
        );
    }
    await linkRuntimeFile(
        path.join(projectDirectory, 'game', 'style.css'),
        path.join(gameDirectory, 'style.css')
    );
    for (const directoryName of ['script', 'font', 'audio', 'image']) {
        await linkRuntimeDirectory(
            path.join(projectDirectory, 'game', directoryName),
            path.join(gameDirectory, directoryName)
        );
    }
    const productionIndex = await fs.readFile(
        path.join(projectDirectory, 'game', 'index.html'),
        'utf8'
    );
    await fs.writeFile(
        path.join(gameDirectory, 'index.html'),
        injectHarnessScripts(productionIndex),
        'utf8'
    );
    const harnessPackage = JSON.parse(
        await fs.readFile(path.join(harnessDirectory, 'package.json'), 'utf8')
    );
    harnessPackage.main = 'game/index.html';
    await fs.writeFile(
        path.join(appDirectory, 'package.json'),
        `${JSON.stringify(harnessPackage, null, 4)}\n`,
        'utf8'
    );
    return appDirectory;
}

async function runColdTrial(options, projectDirectory, harnessDirectory, coldStartIndex) {
    const runDirectory = await fs.mkdtemp(path.join(os.tmpdir(), RUN_DIRECTORY_PREFIX));
    const resultPath = path.join(runDirectory, 'result.json');
    const artifactDirectory = path.join(runDirectory, 'artifacts');
    const sourceExecutable = options.nwExecutable
        || process.env.CIRVIVOR_NW_EXE
        || path.join(projectDirectory, 'lonely tower.exe');
    const runId = `${Date.now()}-${process.pid}-${coldStartIndex}`;
    const childConfig = {
        ...options,
        output: undefined,
        nwExecutable: undefined,
        keepRunDirectory: undefined,
        runId,
        coldStartIndex,
        coldStartCount: options.coldStarts
    };

    try {
        await fs.access(sourceExecutable);
        const executablePath = await prepareIsolatedNwRuntime(sourceExecutable, runDirectory);
        const appDirectory = await prepareHarnessApp(projectDirectory, harnessDirectory, runDirectory);
        const child = spawn(executablePath, [
            `--user-data-dir=${path.join(runDirectory, 'user-data')}`,
            '--force-device-scale-factor=1',
            '--enable-logging=stderr',
            appDirectory
        ], {
            cwd: runDirectory,
            env: {
                ...process.env,
                CIRVIVOR_TITLE_GPU_CONFIG: JSON.stringify(childConfig),
                CIRVIVOR_TITLE_GPU_RESULT_PATH: resultPath,
                CIRVIVOR_TITLE_GPU_ARTIFACT_DIR: artifactDirectory,
                CIRVIVOR_TITLE_GPU_RUN_ROOT: runDirectory,
                CIRVIVOR_TITLE_GPU_BUILD_REVISION: process.env.GITHUB_SHA || 'working-tree'
            },
            stdio: 'inherit',
            windowsHide: false
        });
        let timedOut = false;
        const timeoutId = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, options.timeoutMs);
        let exit;
        try {
            exit = await waitForChild(child);
        } finally {
            clearTimeout(timeoutId);
        }
        if (timedOut) {
            throw new Error(`NW title GPU trial 제한시간 초과: ${options.timeoutMs}ms`);
        }
        let result;
        try {
            result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
        } catch (error) {
            throw new Error(
                `NW 결과 파일을 읽지 못했습니다. exit=${exit.exitCode}, signal=${exit.signal}: ${error.message}`
            );
        }
        if (exit.exitCode !== 0 || exit.signal !== null) {
            throw new Error(`NW 비정상 종료: exit=${exit.exitCode}, signal=${exit.signal}`);
        }
        if (result.status !== 'pass') {
            throw new Error(result.error || 'NW title GPU trial이 실패했습니다.');
        }
        if (!options.keepRunDirectory) {
            await removeRunDirectory(runDirectory);
        } else {
            console.log(`성공 실행 디렉터리 보존: ${runDirectory}`);
        }
        return result;
    } catch (error) {
        try {
            console.error(`마지막 NW 단계: ${(await fs.readFile(`${resultPath}.progress`, 'utf8')).trim()}`);
        } catch {
            // runner 시작 전 실패입니다.
        }
        console.error(`실패 실행 디렉터리 보존: ${runDirectory}`);
        throw error;
    }
}

function isFullyCutOver(status) {
    return Boolean(status
        && typeof status === 'object'
        && status.fullCutoverActive === true
        && status.legacyVisibleSurfaceCount === 0
        && status.webGpuSurfaceVisible === true
        && status.topControlSurfacePreserved === true
        && status.cssPresentationNeutralized === true
        && status.fallbackPending !== true
        && status.destroyed !== true);
}

function validateTitleWebGpuFullOverlayReceipt(trial, trialIndex) {
    const coordinator = trial?.validation?.titleWebGpuShadowDiagnostics
        ?.overlay?.coordinator;
    const receipt = coordinator?.lastGraphReceipt;
    const cutover = coordinator?.cutover;
    const failures = [];

    if (!coordinator || typeof coordinator !== 'object') {
        failures.push('missing-coordinator-diagnostics');
    }
    if (!receipt || typeof receipt !== 'object') {
        failures.push('missing-last-graph-receipt');
    } else {
        if (receipt.status !== 'committed' || receipt.committed !== true) {
            failures.push('receipt-not-committed');
        }
        if (receipt.submitted !== true) failures.push('receipt-not-submitted');
        if (!Number.isSafeInteger(receipt.frameId) || receipt.frameId < 0
            || !Number.isSafeInteger(receipt.deviceGeneration)
            || receipt.deviceGeneration < 0) {
            failures.push('receipt-identity-invalid');
        }
        if (receipt.finalOverlayIncluded !== true) {
            failures.push('final-overlay-not-included');
        }
        if (receipt.baseCheckpointConsumed !== true) {
            failures.push('base-checkpoint-not-consumed');
        }
        if (receipt.vignetteIncluded !== true) failures.push('vignette-not-included');
        if (receipt.fullScenePresented !== true) failures.push('full-scene-not-presented');
        if (receipt.finalCanvasPassCount !== 1) {
            failures.push('final-canvas-pass-count-not-one');
        }
        if (receipt.presentPassCount !== 1) failures.push('present-pass-count-not-one');
        if (receipt.failure !== null) failures.push('receipt-failure-present');
        if (receipt.abortReason !== null) failures.push('receipt-abort-reason-present');
        if (!isFullyCutOver(receipt.cutoverStatus)) {
            failures.push('receipt-cutover-not-qualified');
        }
    }

    if (!isFullyCutOver(cutover)) {
        failures.push('coordinator-cutover-not-qualified');
    }
    const committedFrameId = cutover?.lastCommittedFrameId;
    const committedDeviceGeneration = cutover?.lastCommittedDeviceGeneration;
    if (!Number.isSafeInteger(committedFrameId) || committedFrameId < 0
        || !Number.isSafeInteger(committedDeviceGeneration)
        || committedDeviceGeneration < 0) {
        failures.push('cutover-commit-identity-invalid');
    } else if (receipt?.frameId !== committedFrameId
        || receipt?.deviceGeneration !== committedDeviceGeneration) {
        failures.push('stale-cutover-commit-identity');
    }

    return Object.freeze({
        trialIndex,
        coldStartIndex: Number.isSafeInteger(trial?.coldStartIndex)
            ? trial.coldStartIndex
            : null,
        qualified: failures.length === 0,
        frameId: Number.isSafeInteger(receipt?.frameId) ? receipt.frameId : null,
        deviceGeneration: Number.isSafeInteger(receipt?.deviceGeneration)
            ? receipt.deviceGeneration
            : null,
        failures: Object.freeze(failures)
    });
}

/**
 * cold trial 결과를 median/worst p99로 집계합니다.
 * @param {object[]} trials - trial results입니다.
 * @returns {object} aggregate result입니다.
 */
export function aggregateTrials(trials) {
    const pipelineMode = trials.find((trial) => (
        typeof trial.config?.pipelineMode === 'string'
    ))?.config.pipelineMode ?? 'legacy-webgl';
    const usesWebGpuPipeline = pipelineMode !== 'legacy-webgl';
    const metric = usesWebGpuPipeline
        ? 'title.webgpu_graph.gpu_ms'
        : 'title.overlay_blur_composite.gpu_ms';
    const receiptTrials = usesWebGpuPipeline
        ? trials.map(validateTitleWebGpuFullOverlayReceipt)
        : [];
    const allReceiptsQualified = !usesWebGpuPipeline
        || receiptTrials.every((entry) => entry.qualified);
    const scenarioIds = new Set();
    for (const trial of trials) {
        for (const scenarioId of trial.config?.scenarios || []) {
            scenarioIds.add(scenarioId);
        }
        for (const scenario of trial.scenarios || []) {
            scenarioIds.add(scenario.id);
        }
    }
    const scenarios = [];
    for (const scenarioId of scenarioIds) {
        const trialP99 = [];
        const trialSampleCounts = [];
        let missingTrialCount = 0;
        let invalidTrialCount = 0;
        let insufficientSampleTrialCount = 0;
        let budgetRequiredTrialCount = 0;
        let budgetEvidenceTrialCount = 0;
        let budgetMissingEvidenceTrialCount = 0;
        let budgetUnqualifiedReceiptTrialCount = 0;
        const overBudgetTrials = [];
        for (let trialIndex = 0; trialIndex < trials.length; trialIndex++) {
            const trial = trials[trialIndex];
            const scenario = (trial.scenarios || []).find((entry) => entry.id === scenarioId);
            const metricResult = usesWebGpuPipeline
                ? scenario?.webgpu?.scopes?.[metric]
                : scenario?.gpu?.scopes?.[metric];
            const frameTotal = metricResult?.frameTotal;
            const sampleCount = Number.isFinite(frameTotal?.count) ? frameTotal.count : null;
            const p99 = Number.isFinite(frameTotal?.p99) ? frameTotal.p99 : null;
            trialP99.push(p99);
            trialSampleCounts.push(sampleCount);

            const expectedScenarios = trial.config?.scenarios || [];
            const trialProfile = trial.profile ?? trial.config?.profile;
            const budgetRequiredForTrial = usesWebGpuPipeline
                && trialProfile === 'full'
                && expectedScenarios.includes(scenarioId);
            if (budgetRequiredForTrial) {
                budgetRequiredTrialCount += 1;
                const receiptQualified = receiptTrials[trialIndex]?.qualified === true;
                if (!receiptQualified) {
                    budgetMissingEvidenceTrialCount += 1;
                    budgetUnqualifiedReceiptTrialCount += 1;
                } else if (p99 === null) {
                    budgetMissingEvidenceTrialCount += 1;
                } else {
                    budgetEvidenceTrialCount += 1;
                    if (p99 > DEFAULT_TITLE_WEBGPU_GPU_BUDGET_MS) {
                        overBudgetTrials.push({
                            trialIndex,
                            coldStartIndex: Number.isSafeInteger(trial.coldStartIndex)
                                ? trial.coldStartIndex
                                : null,
                            p99,
                            limitMs: DEFAULT_TITLE_WEBGPU_GPU_BUDGET_MS,
                            overByMs: p99 - DEFAULT_TITLE_WEBGPU_GPU_BUDGET_MS
                        });
                    }
                }
            }

            const strict = trial.config?.requireGpuTimestamps === true;
            if (!strict || !expectedScenarios.includes(scenarioId)) {
                continue;
            }
            if (!metricResult) {
                missingTrialCount += 1;
                continue;
            }
            if (!Number.isFinite(frameTotal?.p99)
                || !Number.isInteger(frameTotal?.count)
                || frameTotal.count < 0) {
                invalidTrialCount += 1;
                continue;
            }
            const requestedSamples = trial.config?.requestedSamples;
            if (!Number.isInteger(requestedSamples)
                || requestedSamples <= 0
                || sampleCount < requestedSamples) {
                insufficientSampleTrialCount += 1;
            }
        }
        const validP99 = trialP99.filter(Number.isFinite);
        const budgetRequired = budgetRequiredTrialCount > 0;
        const budgetPassed = !budgetRequired
            || (budgetMissingEvidenceTrialCount === 0 && overBudgetTrials.length === 0);
        scenarios.push({
            id: scenarioId,
            metric,
            trialP99,
            trialSampleCounts,
            missingTrialCount,
            invalidTrialCount,
            insufficientSampleTrialCount,
            medianP99: nearestRank(validP99, 0.5),
            worstP99: validP99.length > 0 ? Math.max(...validP99) : null,
            budgetRequired,
            budgetLimitMs: usesWebGpuPipeline
                ? DEFAULT_TITLE_WEBGPU_GPU_BUDGET_MS
                : null,
            budgetRequiredTrialCount,
            budgetEvidenceTrialCount,
            budgetMissingEvidenceTrialCount,
            budgetUnqualifiedReceiptTrialCount,
            overBudgetTrialCount: overBudgetTrials.length,
            overBudgetTrials,
            budgetPassed
        });
    }
    const strictCoveragePassed = scenarios.every((scenario) => (
        scenario.missingTrialCount === 0
        && scenario.invalidTrialCount === 0
        && scenario.insufficientSampleTrialCount === 0
    ));
    const budgetRequired = scenarios.some((scenario) => scenario.budgetRequired);
    const budgetPassed = scenarios.every((scenario) => scenario.budgetPassed);
    const measurement = usesWebGpuPipeline
        ? (allReceiptsQualified ? {
            metric,
            scope: TITLE_WEBGPU_UNIFIED_SCOPE,
            provisional: false,
            finalOverlayIncluded: true,
            qualification: 'unified-full-scene',
            receiptValidation: {
                required: true,
                passed: true,
                qualifiedTrialCount: receiptTrials.length,
                unqualifiedTrialCount: 0,
                trials: receiptTrials
            }
        } : {
            metric,
            scope: TITLE_WEBGPU_PROVISIONAL_SCOPE,
            provisional: true,
            finalOverlayIncluded: false,
            qualification: 'full-overlay-receipt-unqualified',
            receiptValidation: {
                required: true,
                passed: false,
                qualifiedTrialCount: receiptTrials.filter((entry) => entry.qualified).length,
                unqualifiedTrialCount: receiptTrials.filter((entry) => !entry.qualified).length,
                trials: receiptTrials
            }
        })
        : {
            metric,
            scope: TITLE_WEBGL_OVERLAY_SCOPE,
            provisional: false,
            finalOverlayIncluded: true,
            qualification: 'legacy-overlay'
        };
    return {
        schemaVersion: 1,
        status: trials.every((trial) => trial.status === 'pass')
            && strictCoveragePassed
            && allReceiptsQualified
            && budgetPassed
            ? 'pass'
            : 'fail',
        percentileDefinition: 'nearest-rank',
        trialCount: trials.length,
        measurement,
        budget: {
            percentile: 'p99',
            limitMs: usesWebGpuPipeline
                ? DEFAULT_TITLE_WEBGPU_GPU_BUDGET_MS
                : null,
            required: budgetRequired,
            policy: usesWebGpuPipeline
                ? 'every-required-cold-trial-p99-lte-limit'
                : 'not-applied',
            passed: budgetPassed,
            provisional: measurement.provisional,
            finalOverlayIncluded: measurement.finalOverlayIncluded
        },
        scenarios,
        trials
    };
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }
    if (process.platform !== EXPECTED_PLATFORM) {
        throw new Error(`NW title GPU 하네스는 Windows만 지원합니다: ${process.platform}`);
    }
    const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
    const projectDirectory = path.resolve(scriptDirectory, '..', '..', '..');
    const harnessDirectory = path.join(projectDirectory, 'game', 'test', 'nw_title_gpu_pipeline');
    for (const fileName of ['package.json', ...HARNESS_FILES]) {
        await fs.access(path.join(harnessDirectory, fileName));
    }

    const trials = [];
    for (let coldStartIndex = 0; coldStartIndex < options.coldStarts; coldStartIndex++) {
        console.log(`title GPU cold trial ${coldStartIndex + 1}/${options.coldStarts}`);
        trials.push(await runColdTrial(options, projectDirectory, harnessDirectory, coldStartIndex));
    }
    const aggregate = aggregateTrials(trials);
    if (options.output) {
        await fs.mkdir(path.dirname(options.output), { recursive: true });
        await fs.writeFile(options.output, `${JSON.stringify(aggregate, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify({
        status: aggregate.status,
        trialCount: aggregate.trialCount,
        scenarios: aggregate.scenarios,
        output: options.output
    }, null, 2));
    if (aggregate.status !== 'pass') {
        process.exitCode = 1;
    }
}

const isDirectExecution = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
    main().catch((error) => {
        console.error(error?.stack || error);
        process.exitCode = 1;
    });
}
