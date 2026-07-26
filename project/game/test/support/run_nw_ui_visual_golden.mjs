import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUN_DIRECTORY_PREFIX = 'cirvivor-ui-golden-';
const RUN_TIMEOUT_MS = 120_000;
const EXPECTED_PLATFORM = 'win32';
const GOLDEN_SCHEMA_VERSION = 2;
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
const APP_GAME_DIRECTORIES = Object.freeze(['audio', 'font', 'image', 'script']);
const SUPPORTED_ACTIONS = Object.freeze([
    'activateOverlayElement',
    'advanceFrames',
    'clickMouseButton',
    'closeTitleOverlay',
    'flushAsyncJobs',
    'movePointerToTitleEntry',
    'openExitOverlay',
    'openExternalLinkWarningOverlay',
    'openTitleOverlay'
]);

/** 사용 가능한 실행 모드를 출력합니다. */
function printHelp() {
    console.log([
        'NW.js production 타이틀/오버레이 UI pixel-golden 하네스',
        '',
        '사용법:',
        '  node game/test/support/run_nw_ui_visual_golden.mjs --check',
        '  node game/test/support/run_nw_ui_visual_golden.mjs --update',
        '',
        '--check  same-profile hash manifest와 최종 PNG RGBA를 21개 시나리오에서 exact 비교합니다.',
        '--update 현재 profile의 최종 PNG 21개와 전체 surface hash manifest를 갱신합니다.'
    ].join('\n'));
}

/** 명령행에서 단일 실행 모드를 해석합니다. */
function parseMode(args) {
    if (args.includes('--help') || args.includes('-h')) return 'help';
    const hasCheck = args.includes('--check');
    const hasUpdate = args.includes('--update');
    if (hasCheck === hasUpdate) {
        throw new Error('정확히 하나의 모드만 지정해야 합니다: --check 또는 --update');
    }
    return hasUpdate ? 'update' : 'check';
}

/** 값의 SHA-256을 반환합니다. */
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

/** child process 종료를 기다립니다. */
function waitForChild(child) {
    return new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
    });
}

/** 검증된 mkdtemp 실행 디렉터리만 제거합니다. */
async function removeRunDirectory(runDirectory) {
    const resolvedRunDirectory = path.resolve(runDirectory);
    const resolvedTempDirectory = path.resolve(os.tmpdir());
    if (path.dirname(resolvedRunDirectory) !== resolvedTempDirectory
        || !path.basename(resolvedRunDirectory).startsWith(RUN_DIRECTORY_PREFIX)) {
        throw new Error(`임시 실행 디렉터리 범위를 확인할 수 없습니다: ${resolvedRunDirectory}`);
    }
    await fs.rm(resolvedRunDirectory, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100
    });
}

/** 동일 볼륨에서는 hard link, 불가능할 때는 파일 복사를 사용합니다. */
async function linkRuntimeFile(sourcePath, destinationPath) {
    try {
        await fs.link(sourcePath, destinationPath);
    } catch (error) {
        if (!['EXDEV', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
        await fs.copyFile(sourcePath, destinationPath);
    }
}

/** 디렉터리를 hard-link 기반 트리로 구성합니다. */
async function linkRuntimeDirectory(sourceDirectory, destinationDirectory) {
    await fs.mkdir(destinationDirectory, { recursive: true });
    const entries = await fs.readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
        const sourcePath = path.join(sourceDirectory, entry.name);
        const destinationPath = path.join(destinationDirectory, entry.name);
        if (entry.isDirectory()) {
            await linkRuntimeDirectory(sourcePath, destinationPath);
        } else if (entry.isFile()) {
            await linkRuntimeFile(sourcePath, destinationPath);
        }
    }
}

/** 프로젝트 자동 실행을 피하는 package 없는 격리 NW 런타임을 구성합니다. */
async function prepareIsolatedNwRuntime(projectDirectory, runDirectory) {
    const runtimeDirectory = path.join(runDirectory, 'runtime');
    await fs.mkdir(runtimeDirectory, { recursive: true });
    await linkRuntimeFile(
        path.join(projectDirectory, 'lonely tower.exe'),
        path.join(runtimeDirectory, 'nw.exe')
    );
    for (const fileName of NW_RUNTIME_ROOT_FILES) {
        await linkRuntimeFile(
            path.join(projectDirectory, fileName),
            path.join(runtimeDirectory, fileName)
        );
    }
    for (const directoryName of NW_RUNTIME_DIRECTORIES) {
        await linkRuntimeDirectory(
            path.join(projectDirectory, directoryName),
            path.join(runtimeDirectory, directoryName)
        );
    }
    return path.join(runtimeDirectory, 'nw.exe');
}

/** production 모듈·asset·폰트와 tracked 시나리오를 포함한 임시 NW 앱을 만듭니다. */
async function prepareHarnessApp(projectDirectory, harnessDirectory, runDirectory) {
    const appDirectory = path.join(runDirectory, 'app');
    const gameDirectory = path.join(appDirectory, 'game');
    const stagedHarnessDirectory = path.join(gameDirectory, 'test', 'nw_ui_visual_golden');
    const stagedFixtureDirectory = path.join(gameDirectory, 'test', 'fixtures', 'ui_visual');
    await fs.mkdir(stagedHarnessDirectory, { recursive: true });
    await fs.mkdir(stagedFixtureDirectory, { recursive: true });
    for (const fileName of ['index.html', 'runner.js']) {
        await linkRuntimeFile(
            path.join(harnessDirectory, fileName),
            path.join(stagedHarnessDirectory, fileName)
        );
    }
    await linkRuntimeFile(
        path.join(projectDirectory, 'game', 'test', 'fixtures', 'ui_visual', 'scenarios_v1.json'),
        path.join(stagedFixtureDirectory, 'scenarios_v1.json')
    );
    await linkRuntimeFile(
        path.join(projectDirectory, 'game', 'style.css'),
        path.join(gameDirectory, 'style.css')
    );
    for (const directoryName of APP_GAME_DIRECTORIES) {
        await linkRuntimeDirectory(
            path.join(projectDirectory, 'game', directoryName),
            path.join(gameDirectory, directoryName)
        );
    }
    const harnessPackage = JSON.parse(
        await fs.readFile(path.join(harnessDirectory, 'package.json'), 'utf8')
    );
    harnessPackage.main = 'game/test/nw_ui_visual_golden/index.html';
    await fs.writeFile(
        path.join(appDirectory, 'package.json'),
        `${JSON.stringify(harnessPackage, null, 4)}\n`,
        'utf8'
    );
    return appDirectory;
}

/** 시나리오별 저장 설정을 격리 실행 루트에 기록합니다. */
async function prepareScenarioSave(scenarioRoot, manifest, scenario) {
    const saveDirectory = path.join(scenarioRoot, 'save');
    await fs.mkdir(saveDirectory, { recursive: true });
    const settings = {
        ...manifest.oracle.settings,
        ...(scenario.settingsOverride || {})
    };
    await fs.writeFile(
        path.join(saveDirectory, 'settings.json'),
        `${JSON.stringify(settings, null, 4)}\n`,
        'utf8'
    );
}

/** UI golden runner를 단일 시나리오용 NW 프로세스로 실행합니다. */
async function runScenario({
    mode,
    scenario,
    manifest,
    executablePath,
    appDirectory,
    goldenRoot,
    captureDirectory,
    artifactDirectory,
    runDirectory
}) {
    const scenarioRoot = path.join(runDirectory, 'scenarios', scenario.id);
    const resultPath = path.join(scenarioRoot, 'result.json');
    await fs.mkdir(scenarioRoot, { recursive: true });
    await prepareScenarioSave(scenarioRoot, manifest, scenario);
    const child = spawn(executablePath, [
        `--user-data-dir=${path.join(scenarioRoot, 'user-data')}`,
        '--force-device-scale-factor=1',
        '--enable-logging=stderr',
        appDirectory
    ], {
        cwd: scenarioRoot,
        env: {
            ...process.env,
            CIRVIVOR_UI_GOLDEN_MODE: mode,
            CIRVIVOR_UI_GOLDEN_SCENARIO_ID: scenario.id,
            CIRVIVOR_UI_GOLDEN_APP_ROOT: appDirectory,
            CIRVIVOR_UI_GOLDEN_SCENARIO_ROOT: scenarioRoot,
            CIRVIVOR_UI_GOLDEN_ROOT: goldenRoot,
            CIRVIVOR_UI_GOLDEN_CAPTURE_DIR: captureDirectory,
            CIRVIVOR_UI_GOLDEN_ARTIFACT_DIR: artifactDirectory,
            CIRVIVOR_UI_GOLDEN_RESULT_PATH: resultPath
        },
        stdio: 'inherit',
        windowsHide: false
    });

    let timedOut = false;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill();
    }, RUN_TIMEOUT_MS);
    let exit;
    try {
        exit = await waitForChild(child);
    } finally {
        clearTimeout(timeoutId);
    }
    if (timedOut) throw new Error(`${scenario.id}: NW 실행 제한시간 초과 ${RUN_TIMEOUT_MS}ms`);

    let result;
    try {
        result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
    } catch (error) {
        throw new Error(`${scenario.id}: 결과 파일을 읽지 못했습니다. exit=${exit.exitCode}: ${error.message}`);
    }
    if (exit.exitCode !== 0 || exit.signal !== null) {
        throw new Error(`${scenario.id}: NW 비정상 종료 exit=${exit.exitCode}, signal=${exit.signal}`);
    }
    if (result.status !== 'pass') {
        throw new Error(result.error || `${scenario.id}: UI golden runner 실패`);
    }
    return result;
}

/** 모든 시나리오 결과로 profile manifest를 구성합니다. */
function createGoldenManifest(manifestSource, sourceManifest, results) {
    const profile = results[0].profile;
    const scenarios = results.map(({ scenarioRecord }) => scenarioRecord);
    const rawCaptureCount = results.reduce((sum, result) => sum + result.rawCaptureCount, 0);
    const rawByteLength = results.reduce((sum, result) => sum + result.rawByteLength, 0);
    const pngByteLength = results.reduce((sum, result) => sum + result.pngByteLength, 0);
    const captureSetSha256 = sha256(Buffer.from(JSON.stringify(
        scenarios.map((scenario) => ({
            id: scenario.id,
            static: scenario.staticSurfaces.map(({ sha256: hash }) => hash),
            dynamic: scenario.dynamicSurfaces.map(({ sha256: hash }) => hash),
            final: scenario.final.sha256,
            png: scenario.final.reviewPngSha256
        }))
    ), 'utf8'));
    return {
        schemaVersion: GOLDEN_SCHEMA_VERSION,
        suite: {
            id: sourceManifest.suiteId,
            source: 'game/test/fixtures/ui_visual/scenarios_v1.json',
            sourceSha256: sha256(Buffer.from(manifestSource, 'utf8')),
            oracle: sourceManifest.oracle,
            capture: sourceManifest.capture
        },
        profile,
        capabilities: {
            status: 'complete',
            productionPath: [
                'SystemHandler',
                'SceneSystem',
                'LoadingScene',
                'TitleScene',
                'OverlayManager'
            ],
            supportedActions: SUPPORTED_ACTIONS,
            executedScenarioIds: scenarios.map(({ id }) => id),
            unsupportedScenarios: []
        },
        scenarios,
        summary: {
            scenarioCount: scenarios.length,
            staticSurfaceCount: scenarios.reduce((sum, scenario) => sum + scenario.staticSurfaces.length, 0),
            dynamicSurfaceCount: scenarios.reduce((sum, scenario) => sum + scenario.dynamicSurfaces.length, 0),
            finalCompositeCount: scenarios.length,
            rawCaptureCount,
            generatedRawByteLength: rawByteLength,
            pngByteLength,
            trackedCaptureByteLength: pngByteLength,
            captureSetSha256
        }
    };
}

/** update 결과의 최종 PNG만 tracked profile에 복사하고 hash manifest를 마지막에 기록합니다. */
async function updateGolden(goldenRoot, captureDirectory, goldenManifest) {
    const profileDirectory = path.resolve(goldenRoot, goldenManifest.profile.id);
    const resolvedGoldenRoot = path.resolve(goldenRoot);
    if (path.dirname(profileDirectory) !== resolvedGoldenRoot) {
        throw new Error(`golden profile 경로 범위를 확인할 수 없습니다: ${profileDirectory}`);
    }
    await fs.rm(profileDirectory, { recursive: true, force: true });
    await fs.mkdir(profileDirectory, { recursive: true });
    const fileNames = goldenManifest.scenarios.map(({ final }) => final.reviewPng);
    for (const fileName of fileNames) {
        await fs.copyFile(
            path.join(captureDirectory, fileName),
            path.join(profileDirectory, fileName)
        );
    }
    await fs.writeFile(
        path.join(profileDirectory, 'manifest.json'),
        `${JSON.stringify(goldenManifest, null, 4)}\n`,
        'utf8'
    );
    return profileDirectory;
}

/** check 결과 집계가 tracked manifest와 JSON-exact인지 확인합니다. */
async function checkGoldenManifest(goldenRoot, goldenManifest) {
    const manifestPath = path.join(goldenRoot, goldenManifest.profile.id, 'manifest.json');
    const expected = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (JSON.stringify(expected) !== JSON.stringify(goldenManifest)) {
        throw new Error(`집계 UI golden manifest 불일치: ${manifestPath}`);
    }
    return path.dirname(manifestPath);
}

/** 전체 21개 UI 시나리오를 격리 NW app state에서 순차 실행합니다. */
async function runHarness(mode) {
    if (process.platform !== EXPECTED_PLATFORM) {
        throw new Error(`UI golden profile은 Windows만 지원합니다: ${process.platform}`);
    }
    const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
    const projectDirectory = path.resolve(scriptDirectory, '..', '..', '..');
    const harnessDirectory = path.join(projectDirectory, 'game', 'test', 'nw_ui_visual_golden');
    const fixturePath = path.join(projectDirectory, 'game', 'test', 'fixtures', 'ui_visual', 'scenarios_v1.json');
    const goldenRoot = path.join(harnessDirectory, 'goldens');
    const manifestSource = await fs.readFile(fixturePath, 'utf8');
    const sourceManifest = JSON.parse(manifestSource);
    const runDirectory = await fs.mkdtemp(path.join(os.tmpdir(), RUN_DIRECTORY_PREFIX));
    const captureDirectory = path.join(runDirectory, 'captures');
    const artifactDirectory = path.join(runDirectory, 'artifacts');
    let lastScenarioId = null;

    try {
        const executablePath = await prepareIsolatedNwRuntime(projectDirectory, runDirectory);
        const appDirectory = await prepareHarnessApp(projectDirectory, harnessDirectory, runDirectory);
        const results = [];
        for (let index = 0; index < sourceManifest.scenarios.length; index++) {
            const scenario = sourceManifest.scenarios[index];
            lastScenarioId = scenario.id;
            console.log(`[${index + 1}/${sourceManifest.scenarios.length}] ${scenario.id}`);
            const result = await runScenario({
                mode,
                scenario,
                manifest: sourceManifest,
                executablePath,
                appDirectory,
                goldenRoot,
                captureDirectory,
                artifactDirectory,
                runDirectory
            });
            results.push(result);
        }
        const profileJson = JSON.stringify(results[0]?.profile);
        if (!profileJson || results.some((result) => JSON.stringify(result.profile) !== profileJson)) {
            throw new Error('시나리오별 runtime profile이 일치하지 않습니다.');
        }
        if (results.some((result) => result.suiteSourceSha256 !== results[0].suiteSourceSha256)) {
            throw new Error('시나리오별 suite source SHA-256이 일치하지 않습니다.');
        }
        const goldenManifest = createGoldenManifest(manifestSource, sourceManifest, results);
        const profileDirectory = mode === 'update'
            ? await updateGolden(goldenRoot, captureDirectory, goldenManifest)
            : await checkGoldenManifest(goldenRoot, goldenManifest);
        console.log([
            `PASS: ${mode}`,
            `profile: ${goldenManifest.profile.id}`,
            `scenario: ${goldenManifest.summary.scenarioCount}`,
            `raw capture: ${goldenManifest.summary.rawCaptureCount}`,
            `static/dynamic/final: ${goldenManifest.summary.staticSurfaceCount}/${goldenManifest.summary.dynamicSurfaceCount}/${goldenManifest.summary.finalCompositeCount}`,
            `generated raw bytes: ${goldenManifest.summary.generatedRawByteLength}`,
            `tracked PNG bytes: ${goldenManifest.summary.trackedCaptureByteLength}`,
            `capture set sha256: ${goldenManifest.summary.captureSetSha256}`,
            `golden: ${profileDirectory}`
        ].join('\n'));
        await removeRunDirectory(runDirectory);
        return goldenManifest;
    } catch (error) {
        if (lastScenarioId) {
            const progressPath = path.join(runDirectory, 'scenarios', lastScenarioId, 'result.json.progress');
            try {
                console.error(`마지막 NW.js 단계: ${(await fs.readFile(progressPath, 'utf8')).trim()}`);
            } catch {
                // bootstrap 전 실패에는 progress 파일이 없습니다.
            }
        }
        console.error(`실패 artifact 디렉터리: ${artifactDirectory}`);
        console.error(`실행 임시 디렉터리 보존: ${runDirectory}`);
        throw error;
    }
}

async function main() {
    const mode = parseMode(process.argv.slice(2));
    if (mode === 'help') {
        printHelp();
        return;
    }
    await runHarness(mode);
}

main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
});
