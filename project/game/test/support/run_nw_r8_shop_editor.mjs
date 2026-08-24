import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { waitForChildWithTimeout } from './nw_child_process_guard.mjs';

const RUN_DIRECTORY_PREFIX = 'cirvivor-r8-shop-editor-';
const RUN_TIMEOUT_MS = 600_000;
const REGRESSION_TIMEOUT_MS = 300_000;
const REQUIRED_STORAGE_BUFFER_LIMIT = 9;
const FINAL_RESULT_RELATIVE_PATH = Object.freeze([
    'logs',
    'acceptance',
    'post-r8-shop-editor-result.json'
]);
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
const NW_RUNTIME_DIRECTORIES = Object.freeze([
    'Dictionaries',
    'locales',
    'swiftshader'
]);

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function linkRuntimeFile(sourcePath, destinationPath) {
    try {
        await fs.link(sourcePath, destinationPath);
    } catch (error) {
        if (!['EXDEV', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
        await fs.copyFile(sourcePath, destinationPath);
    }
}

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

async function prepareIsolatedRuntime(projectDirectory, runDirectory) {
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

async function prepareHarnessApp(projectDirectory, runDirectory) {
    const harnessDirectory = path.join(
        projectDirectory,
        'game',
        'test',
        'nw_webgpu_capability'
    );
    const appDirectory = path.join(runDirectory, 'app');
    await fs.mkdir(appDirectory, { recursive: true });
    const sourceIndex = await fs.readFile(
        path.join(harnessDirectory, 'index.html'),
        'utf8'
    );
    const importMap = {
        imports: {
            'data/': './production/script/data/',
            'ingame/': './production/script/module/ingame/',
            'object/': './production/script/module/object/',
            'util/': './production/script/util/'
        }
    };
    const markup = `    <script type="importmap">\n${JSON.stringify(
        importMap,
        null,
        8
    )}\n    </script>\n`;
    assert(sourceIndex.includes('</head>'), 'R8 NW index에 </head>가 없습니다.');
    await fs.writeFile(
        path.join(appDirectory, 'index.html'),
        sourceIndex.replace('</head>', `${markup}</head>`),
        'utf8'
    );
    await linkRuntimeFile(
        path.join(harnessDirectory, 'r8_shop_editor_runner.js'),
        path.join(appDirectory, 'runner.js')
    );
    await linkRuntimeFile(
        path.join(harnessDirectory, 'r5_actor_verbs_runner.js'),
        path.join(appDirectory, 'r5_actor_verbs_runner.js')
    );
    await linkRuntimeDirectory(
        path.join(projectDirectory, 'game', 'script'),
        path.join(appDirectory, 'production', 'script')
    );
    const packageJson = JSON.parse(await fs.readFile(
        path.join(harnessDirectory, 'package.json'),
        'utf8'
    ));
    packageJson.main = 'index.html';
    await fs.writeFile(
        path.join(appDirectory, 'package.json'),
        `${JSON.stringify(packageJson, null, 4)}\n`,
        'utf8'
    );
    return appDirectory;
}

async function removeRunDirectory(runDirectory) {
    const resolved = path.resolve(runDirectory);
    const temp = path.resolve(os.tmpdir());
    if (path.dirname(resolved) !== temp
        || !path.basename(resolved).startsWith(RUN_DIRECTORY_PREFIX)) {
        throw new Error(`R8 임시 디렉터리 범위를 확인할 수 없습니다: ${resolved}`);
    }
    await fs.rm(resolved, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100
    });
}

function collectStream(stream) {
    let output = '';
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk) => {
        output += chunk;
    });
    return () => output;
}

async function runRegressionGate(projectDirectory, scriptName, label) {
    const child = spawn(
        process.execPath,
        [path.join('game', 'test', 'support', scriptName)],
        {
            cwd: projectDirectory,
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        }
    );
    const stdout = collectStream(child.stdout);
    const stderr = collectStream(child.stderr);
    const processResult = await waitForChildWithTimeout(
        child,
        REGRESSION_TIMEOUT_MS
    );
    const exit = processResult.exit;
    if (processResult.timedOut || exit.exitCode !== 0 || exit.signal !== null) {
        throw new Error([
            `${label} actual regression gate 실패`,
            `timeout=${processResult.timedOut}`,
            `exit=${exit.exitCode}`,
            `signal=${exit.signal}`,
            stderr().slice(-4_000),
            stdout().slice(-4_000)
        ].join('\n'));
    }
    try {
        return JSON.parse(stdout().trim());
    } catch (error) {
        throw new Error(
            `${label} actual 결과 JSON을 읽지 못했습니다: ${error.message}`
        );
    }
}

export function validateR8Result(result) {
    const fixture = result?.r8ShopEditor;
    const warm = result?.performance?.warmSuccessful;
    const requiredScenarios = [
        'enemy-100-x2',
        'enemy-50-x4',
        'tower-1-x2',
        'summon-128-x2'
    ];
    const valid = result?.status === 'pass'
        && fixture?.scenario === 'r8-shop-editor-actual-webgpu'
        && fixture.shop?.initialOfferCount === 5
        && fixture.shop?.initialUniqueOfferCount === 5
        && fixture.shop?.purchasedTwice === true
        && fixture.shop?.multiplePurchaseCount === 2
        && fixture.shop?.staleOldOfferRejected === true
        && fixture.shop?.rerollRowChanged === true
        && fixture.shop?.secondSessionRowChanged === true
        && fixture.editor?.previewCopiesPerSubject === 4
        && fixture.editor?.boardCommitted === true
        && fixture.editedAbility?.subjectCount === 1
        && fixture.editedAbility?.copiesPerSubject === 4
        && fixture.editedAbility?.generatedCount === 4
        && fixture.phase?.shopFixedSubmitDelta === 0
        && fixture.phase?.recoveryShopFixedSubmitDelta === 0
        && fixture.phase?.finalPhase === 'COMBAT'
        && fixture.recovery?.statePreserved === true
        && fixture.recovery?.oldDestroyed === true
        && fixture.recovery?.rehydratedTowerCount === 1
        && fixture.storageMaximum <= REQUIRED_STORAGE_BUFFER_LIMIT
        && fixture.extraPerSubjectReadbackCount === 0
        && fixture.partialPublicationCount === 0
        && fixture.gridOverflowCount === 0
        && fixture.protocolFailureCount === 0
        && fixture.recoveryFailureCount === 0
        && fixture.destroyedTeardown === true
        && warm?.sampleCount >= 100
        && requiredScenarios.every((id) => (
            warm.scenarios?.[id]?.sampleCount >= 25
        ))
        && Number.isFinite(warm.materializationGpuMs?.p50)
        && Number.isFinite(warm.materializationGpuMs?.p95)
        && Number.isFinite(warm.placementGpuMs?.p50)
        && Number.isFinite(warm.placementGpuMs?.p95)
        && Number.isFinite(warm.fullFixedBoundaryWallMs?.p50)
        && Number.isFinite(warm.fullFixedBoundaryWallMs?.p95)
        && Number.isFinite(warm.overallGpuMs?.p50)
        && Number.isFinite(warm.overallGpuMs?.p95)
        && result.performance?.timestampQuerySupported === true
        && warm.p95WithinBudget === true
        && result.performance?.productionExposure === 'APPROVED'
        && warm.droppedFixedTimeMs === 0
        && result.uncapturedErrorCount === 0
        && result.deviceLostReason === 'destroyed';
    if (!valid) {
        throw new Error(`R8 actual 결과 계약 실패: ${JSON.stringify(result)}`);
    }
}

function summarizeRegressionEvidence(r6, r7, skipped) {
    if (skipped) {
        return Object.freeze({
            skipped: true,
            reason: 'CIRVIVOR_R8_SKIP_REGRESSION_CHILDREN=1'
        });
    }
    assert(r6?.status === 'pass' && r6?.deviceLostReason === 'destroyed',
        'R6 Merge regression 결과가 pass가 아닙니다.');
    assert(r7?.status === 'pass'
        && r7?.deviceLostReason === 'destroyed'
        && r7?.r7ActorPayloadMultiplicity?.storageMaximum <= 9
        && r7?.uncapturedErrorCount === 0,
    'R7 modifier regression 결과가 pass가 아닙니다.');
    return Object.freeze({
        skipped: false,
        r6Merge: Object.freeze({
            status: r6.status,
            scenario: r6.r6TowerMerge?.scenario ?? null,
            deviceLostReason: r6.deviceLostReason
        }),
        r7Modifier: Object.freeze({
            status: r7.status,
            scenario: r7.r7ActorPayloadMultiplicity?.scenario ?? null,
            storageMaximum: r7.r7ActorPayloadMultiplicity?.storageMaximum,
            impossiblePlacementSeparated:
                r7.r7ActorPayloadMultiplicity?.pressures?.sdfImpossible
                    ?.recoveryRequired === false,
            pressureSamplesSeparated:
                r7.r7ActorPayloadMultiplicity?.pressures
                    ?.gridCellCapacity?.recoveryRequired === false,
            priorDiagnosticSampleCount:
                r7.performance?.fullFixedBoundaryElapsedMs?.sampleCount ?? 0,
            deviceLostReason: r7.deviceLostReason
        })
    });
}

async function runHarness() {
    if (process.platform !== 'win32') {
        throw new Error(`R8 NW WebGPU 검사는 Windows만 지원합니다: ${process.platform}`);
    }
    const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
    const projectDirectory = path.resolve(scriptDirectory, '..', '..', '..');
    const runDirectory = await fs.mkdtemp(path.join(
        os.tmpdir(),
        RUN_DIRECTORY_PREFIX
    ));
    const resultPath = path.join(runDirectory, 'result.json');
    const skipRegressions = process.env.CIRVIVOR_R8_SKIP_REGRESSION_CHILDREN
        === '1';
    try {
        await Promise.all([
            fs.access(path.join(projectDirectory, 'lonely tower.exe')),
            fs.access(path.join(
                projectDirectory,
                'game',
                'test',
                'nw_webgpu_capability',
                'r8_shop_editor_runner.js'
            )),
            fs.access(path.join(
                projectDirectory,
                'game',
                'test',
                'nw_webgpu_capability',
                'r5_actor_verbs_runner.js'
            ))
        ]);
        let r6 = null;
        let r7 = null;
        if (!skipRegressions) {
            r6 = await runRegressionGate(
                projectDirectory,
                'run_nw_r6_tower_merge.mjs',
                'R6 Merge'
            );
            r7 = await runRegressionGate(
                projectDirectory,
                'run_nw_r7_actor_payload_multiplicity.mjs',
                'R7 modifier'
            );
        }
        const executablePath = await prepareIsolatedRuntime(
            projectDirectory,
            runDirectory
        );
        const appDirectory = await prepareHarnessApp(
            projectDirectory,
            runDirectory
        );
        const child = spawn(executablePath, [
            `--user-data-dir=${path.join(runDirectory, 'user-data')}`,
            '--enable-logging=stderr',
            appDirectory
        ], {
            cwd: runDirectory,
            env: {
                ...process.env,
                // r5_actor_verbs_runner.js를 helper module로만 로드합니다.
                CIRVIVOR_WEBGPU_FIXTURE_STAGE:
                    'r7-actor-payload-multiplicity',
                CIRVIVOR_WEBGPU_RESULT_PATH: resultPath
            },
            stdio: 'inherit',
            windowsHide: true
        });
        const processResult = await waitForChildWithTimeout(
            child,
            RUN_TIMEOUT_MS
        );
        const exit = processResult.exit;
        if (processResult.timedOut) {
            throw new Error(
                `R8 NW 실행 제한시간 초과: ${RUN_TIMEOUT_MS}ms, `
                + `termination=${processResult.terminationMethod}`
            );
        }
        let result;
        try {
            result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
        } catch (error) {
            throw new Error(
                `R8 NW 결과를 읽지 못했습니다. exit=${exit.exitCode}, `
                + `signal=${exit.signal}: ${error.message}`
            );
        }
        if (exit.exitCode !== 0 || exit.signal !== null || result.status !== 'pass') {
            throw new Error(result.error
                || `R8 NW 실패: exit=${exit.exitCode}, signal=${exit.signal}`);
        }
        validateR8Result(result);
        const finalResultPath = path.join(
            projectDirectory,
            ...FINAL_RESULT_RELATIVE_PATH
        );
        const combined = Object.freeze({
            ...result,
            acceptanceEvidencePath: finalResultPath,
            regressionGates: summarizeRegressionEvidence(
                r6,
                r7,
                skipRegressions
            )
        });
        await fs.mkdir(path.dirname(finalResultPath), { recursive: true });
        await fs.writeFile(
            finalResultPath,
            `${JSON.stringify(combined, null, 2)}\n`,
            'utf8'
        );
        console.log(JSON.stringify(combined, null, 2));
        await removeRunDirectory(runDirectory);
        return combined;
    } catch (error) {
        console.error(`R8 WebGPU 임시 디렉터리 보존: ${runDirectory}`);
        throw error;
    }
}

const isDirectExecution = process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectExecution) {
    runHarness().catch((error) => {
        console.error(error?.stack ?? error);
        process.exitCode = 1;
    });
}
