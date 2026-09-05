import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { waitForChildWithTimeout } from './nw_child_process_guard.mjs';

const RUN_DIRECTORY_PREFIX = 'cirvivor-render-golden-';
const RUN_TIMEOUT_MS = 120_000;
const EXPECTED_PLATFORM = 'win32';
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

/**
 * 사용 가능한 명령을 출력합니다.
 * @returns {void}
 */
function printHelp() {
    console.log([
        'NW.js 통합 렌더 pixel-golden 하네스',
        '',
        '사용법:',
        '  node ../test/support/run_nw_render_pipeline_golden.mjs --check',
        '  node ../test/support/run_nw_render_pipeline_golden.mjs --update',
        '',
        '--check  저장소를 변경하지 않고 승인된 profile golden과 전체 RGBA를 비교합니다.',
        '--update 현재 profile의 tracked golden을 생성하거나 덮어씁니다.'
    ].join('\n'));
}

/**
 * 단일 실행 모드를 해석합니다.
 * @param {string[]} args - 명령행 인수입니다.
 * @returns {'check'|'update'|'help'} 실행 모드입니다.
 */
function parseMode(args) {
    if (args.includes('--help') || args.includes('-h')) {
        return 'help';
    }

    const hasCheck = args.includes('--check');
    const hasUpdate = args.includes('--update');
    if (hasCheck === hasUpdate) {
        throw new Error('정확히 하나의 모드만 지정해야 합니다: --check 또는 --update');
    }
    return hasUpdate ? 'update' : 'check';
}

/**
 * 실행용 임시 디렉터리만 안전하게 제거합니다.
 * @param {string} runDirectory - `mkdtemp()`로 만든 디렉터리입니다.
 * @returns {Promise<void>}
 */
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

/**
 * 동일 볼륨에서는 hard link로 NW 런타임 파일을 공유하고 불가능할 때만 복사합니다.
 * @param {string} sourcePath - 원본 파일입니다.
 * @param {string} destinationPath - 임시 런타임 파일입니다.
 * @returns {Promise<void>}
 */
async function linkRuntimeFile(sourcePath, destinationPath) {
    try {
        await fs.link(sourcePath, destinationPath);
    } catch (error) {
        if (error?.code !== 'EXDEV' && error?.code !== 'EPERM' && error?.code !== 'EACCES') {
            throw error;
        }
        await fs.copyFile(sourcePath, destinationPath);
    }
}

/**
 * NW 런타임 보조 디렉터리를 임시 위치에 hard link 트리로 구성합니다.
 * @param {string} sourceDirectory - 원본 디렉터리입니다.
 * @param {string} destinationDirectory - 임시 디렉터리입니다.
 * @returns {Promise<void>}
 */
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

/**
 * 프로젝트 package 자동 실행을 피하도록 package.json이 없는 임시 NW 런타임을 구성합니다.
 * @param {string} projectDirectory - 번들 NW 런타임이 있는 프로젝트 루트입니다.
 * @param {string} runDirectory - 격리 실행 디렉터리입니다.
 * @returns {Promise<string>} 임시 `nw.exe` 절대 경로입니다.
 */
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

/**
 * production 모듈·스타일·폰트를 앱 패키지 경계 안에서 읽을 수 있는 임시 하네스 앱을 구성합니다.
 * 동일 볼륨 파일은 hard link하므로 원본 복사 비용과 저장소 변경이 없습니다.
 * @param {string} projectDirectory - 프로젝트 루트입니다.
 * @param {string} harnessDirectory - tracked 하네스 소스 디렉터리입니다.
 * @param {string} runDirectory - 격리 실행 디렉터리입니다.
 * @returns {Promise<string>} 임시 NW 앱 루트 절대 경로입니다.
 */
async function prepareHarnessApp(projectDirectory, harnessDirectory, runDirectory) {
    const appDirectory = path.join(runDirectory, 'app');
    const gameDirectory = path.join(appDirectory, 'game');
    const stagedHarnessDirectory = path.join(
        gameDirectory,
        'test',
        'nw_render_pipeline_golden'
    );
    await fs.mkdir(stagedHarnessDirectory, { recursive: true });

    for (const fileName of ['index.html', 'runner.js']) {
        await linkRuntimeFile(
            path.join(harnessDirectory, fileName),
            path.join(stagedHarnessDirectory, fileName)
        );
    }
    await linkRuntimeFile(
        path.join(projectDirectory, 'game', 'style.css'),
        path.join(gameDirectory, 'style.css')
    );
    await linkRuntimeDirectory(
        path.join(projectDirectory, 'game', 'script'),
        path.join(gameDirectory, 'script')
    );
    await linkRuntimeDirectory(
        path.join(projectDirectory, 'game', 'font'),
        path.join(gameDirectory, 'font')
    );

    const harnessPackage = JSON.parse(
        await fs.readFile(path.join(harnessDirectory, 'package.json'), 'utf8')
    );
    harnessPackage.main = 'game/test/nw_render_pipeline_golden/index.html';
    await fs.writeFile(
        path.join(appDirectory, 'package.json'),
        `${JSON.stringify(harnessPackage, null, 4)}\n`,
        'utf8'
    );
    return appDirectory;
}

/**
 * NW.js 하네스를 실행하고 결과 JSON을 반환합니다.
 * @param {'check'|'update'} mode - 실행 모드입니다.
 * @returns {Promise<object>} runner 결과입니다.
 */
async function runHarness(mode) {
    if (process.platform !== EXPECTED_PLATFORM) {
        throw new Error(`1단계 golden profile은 Windows만 지원합니다: ${process.platform}`);
    }

    const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
    const projectDirectory = path.resolve(scriptDirectory, '..', '..', 'project');
    const harnessDirectory = path.join(
        projectDirectory, '..', 'test',
        'nw_render_pipeline_golden'
    );
    const goldenDirectory = path.join(harnessDirectory, 'goldens');
    const runDirectory = await fs.mkdtemp(path.join(os.tmpdir(), RUN_DIRECTORY_PREFIX));
    const artifactDirectory = path.join(runDirectory, 'artifacts');
    const resultPath = path.join(runDirectory, 'result.json');

    try {
        await fs.access(path.join(harnessDirectory, 'package.json'));
        const executablePath = await prepareIsolatedNwRuntime(projectDirectory, runDirectory);
        const appDirectory = await prepareHarnessApp(
            projectDirectory,
            harnessDirectory,
            runDirectory
        );

        const child = spawn(executablePath, [
            `--user-data-dir=${path.join(runDirectory, 'user-data')}`,
            '--force-device-scale-factor=1',
            '--enable-logging=stderr',
            appDirectory
        ], {
            cwd: runDirectory,
            env: {
                ...process.env,
                CIRVIVOR_RENDER_GOLDEN_MODE: mode,
                CIRVIVOR_RENDER_GOLDEN_ROOT: goldenDirectory,
                CIRVIVOR_RENDER_GOLDEN_RESULT_PATH: resultPath,
                CIRVIVOR_RENDER_GOLDEN_ARTIFACT_DIR: artifactDirectory,
                CIRVIVOR_RENDER_GOLDEN_RUN_ROOT: runDirectory
            },
            stdio: 'inherit',
            windowsHide: false
        });

        const processResult = await waitForChildWithTimeout(
            child,
            RUN_TIMEOUT_MS
        );
        const exit = processResult.exit;
        if (processResult.timedOut) {
            let checkpoint = null;
            try {
                checkpoint = JSON.parse(await fs.readFile(resultPath, 'utf8'));
            } catch {
                checkpoint = null;
            }
            throw new Error([
                `NW.js 렌더 golden 실행 제한시간 초과: ${RUN_TIMEOUT_MS}ms`,
                `termination=${processResult.terminationMethod}`,
                `checkpoint=${JSON.stringify(checkpoint)}`
            ].join(', '));
        }

        let result;
        try {
            result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
        } catch (error) {
            throw new Error(
                `NW.js 결과 파일을 읽지 못했습니다. exit=${exit.exitCode}, signal=${exit.signal}: ${error.message}`
            );
        }
        if (exit.exitCode !== 0 || exit.signal !== null) {
            throw new Error(
                `NW.js가 비정상 종료했습니다. exit=${exit.exitCode}, signal=${exit.signal}`
            );
        }

        if (result.status !== 'pass') {
            console.error(`실패 진단 디렉터리: ${artifactDirectory}`);
            throw new Error(result.error || 'NW.js 렌더 golden 검사가 실패했습니다.');
        }

        console.log([
            `PASS: ${result.mode}`,
            `profile: ${result.profileId}`,
            `surface: ${result.surfaceCount}`,
            `case: ${result.caseCount}`
        ].join('\n'));
        await removeRunDirectory(runDirectory);
        return result;
    } catch (error) {
        try {
            const progress = (await fs.readFile(`${resultPath}.progress`, 'utf8')).trim();
            console.error(`마지막 NW.js 단계: ${progress}`);
        } catch {
            // runner가 시작되기 전 실패에는 progress 파일이 없습니다.
        }
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
