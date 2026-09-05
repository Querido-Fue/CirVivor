import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { waitForChildWithTimeout } from './nw_child_process_guard.mjs';

const RUN_DIRECTORY_PREFIX = 'cirvivor-r3-enemy-word-';
const RUN_TIMEOUT_MS = 180_000;
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

function assertResult(result) {
    const fixture = result?.r3EnemyWord;
    const valid = result?.status === 'pass'
        && fixture?.towerSentence?.subjectCount === 1
        && fixture.towerSentence.generatedCount === 1
        && fixture.towerSentence.sourceDeathAfterSnapshot === true
        && fixture.towerSentence.activeEnemyCount === 1
        && fixture?.recursion?.enemyCounts?.join(',') === '10,20,40'
        && fixture.recursion.subjectCounts?.join(',') === '10,20'
        && fixture.recursion.generatedCounts?.join(',') === '10,20'
        && fixture.recursion.sameExecutionExcluded === true
        && fixture?.capacity?.exactCommitted === true
        && fixture.capacity.oneShortRejected === true
        && fixture.capacity.oneShortGeneratedCount === 0
        && fixture.capacity.oneShortCooldownConsumed === false
        && fixture?.zeroSubject?.subjectCount === 0
        && fixture.zeroSubject.generatedCount === 0
        && fixture.zeroSubject.cooldownConsumed === false
        && fixture?.stress?.fanout256?.subjectCount === 256
        && fixture.stress.fanout256.generatedCount === 256
        && fixture.stress.fanout256.activeEnemyCount === 512
        && fixture.stress.fanout256.protocolFailureCount === 0
        && fixture?.stress?.fanout1000?.subjectCount === 1000
        && fixture.stress.fanout1000.generatedCount === 1000
        && fixture.stress.fanout1000.activeEnemyCount === 2000
        && fixture.stress.fanout1000.protocolFailureCount === 0
        && fixture?.stress?.doublingBoundary?.enemyCounts?.join(',')
            === '10,20,40,80,160,320,640'
        && fixture.stress.doublingBoundary.generatedCounts?.join(',')
            === '10,20,40,80,160,320,0'
        && fixture.stress.doublingBoundary
            .nextExecutionRejectedAtomically === true
        && fixture.stress.doublingBoundary.rejectedGeneratedCount === 0
        && fixture.stress.doublingBoundary
            .rejectedCooldownConsumed === false
        && fixture.stress.doublingBoundary.registryReservedCount === 0
        && fixture.stress.doublingBoundary.protocolFailureCount === 0
        && fixture.storageMaximum <= 9
        && fixture.recoveryRequired === false
        && result.uncapturedErrorCount === 0
        && result.deviceLostReason === 'destroyed';
    if (!valid) {
        throw new Error(`R3 Enemy Word actual WebGPU 계약 실패: ${JSON.stringify(result)}`);
    }
}

async function linkFile(sourcePath, destinationPath) {
    try {
        await fs.link(sourcePath, destinationPath);
    } catch (error) {
        if (!['EXDEV', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
        await fs.copyFile(sourcePath, destinationPath);
    }
}

async function linkDirectory(sourceDirectory, destinationDirectory) {
    await fs.mkdir(destinationDirectory, { recursive: true });
    const entries = await fs.readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
        const sourcePath = path.join(sourceDirectory, entry.name);
        const destinationPath = path.join(destinationDirectory, entry.name);
        if (entry.isDirectory()) {
            await linkDirectory(sourcePath, destinationPath);
        } else if (entry.isFile()) {
            await linkFile(sourcePath, destinationPath);
        }
    }
}

async function prepareRuntime(projectDirectory, runDirectory) {
    const runtimeDirectory = path.join(runDirectory, 'runtime');
    await fs.mkdir(runtimeDirectory, { recursive: true });
    await linkFile(
        path.join(projectDirectory, 'lonely tower.exe'),
        path.join(runtimeDirectory, 'nw.exe')
    );
    for (const fileName of NW_RUNTIME_ROOT_FILES) {
        await linkFile(
            path.join(projectDirectory, fileName),
            path.join(runtimeDirectory, fileName)
        );
    }
    for (const directoryName of NW_RUNTIME_DIRECTORIES) {
        await linkDirectory(
            path.join(projectDirectory, directoryName),
            path.join(runtimeDirectory, directoryName)
        );
    }
    return path.join(runtimeDirectory, 'nw.exe');
}

async function prepareApp(projectDirectory, runDirectory) {
    const harnessDirectory = path.join(
        projectDirectory, '..', 'test',
        'nw_webgpu_capability'
    );
    const appDirectory = path.join(runDirectory, 'app');
    await fs.mkdir(appDirectory, { recursive: true });
    const sourceIndex = await fs.readFile(
        path.join(harnessDirectory, 'index.html'),
        'utf8'
    );
    const importMap = JSON.stringify({
        imports: {
            'data/': './production/script/data/',
            'ingame/': './production/script/module/ingame/',
            'object/': './production/script/module/object/',
            'util/': './production/script/util/'
        }
    }, null, 4);
    const index = sourceIndex.replace(
        '</head>',
        `    <script type="importmap">\n${importMap}\n    </script>\n</head>`
    );
    await fs.writeFile(path.join(appDirectory, 'index.html'), index, 'utf8');
    await linkFile(
        path.join(harnessDirectory, 'enemy_word_sentence_runner.js'),
        path.join(appDirectory, 'runner.js')
    );
    await linkDirectory(
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
        throw new Error(`R3 임시 실행 디렉터리 범위가 잘못됐습니다: ${resolved}`);
    }
    await fs.rm(resolved, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100
    });
}

async function runHarness() {
    if (process.platform !== 'win32') {
        throw new Error(`R3 WebGPU 검사는 Windows만 지원합니다: ${process.platform}`);
    }
    const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
    const projectDirectory = path.resolve(scriptDirectory, '..', '..', 'project');
    const runDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), RUN_DIRECTORY_PREFIX)
    );
    const resultPath = path.join(runDirectory, 'result.json');
    try {
        const executablePath = await prepareRuntime(projectDirectory, runDirectory);
        const appDirectory = await prepareApp(projectDirectory, runDirectory);
        const child = spawn(executablePath, [
            `--user-data-dir=${path.join(runDirectory, 'user-data')}`,
            '--enable-logging=stderr',
            appDirectory
        ], {
            cwd: runDirectory,
            env: {
                ...process.env,
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
            let checkpoint = null;
            try {
                checkpoint = JSON.parse(await fs.readFile(resultPath, 'utf8'));
            } catch {
                checkpoint = null;
            }
            throw new Error([
                `R3 WebGPU 실행 제한시간 초과: ${RUN_TIMEOUT_MS}ms`,
                `termination=${processResult.terminationMethod}`,
                `checkpoint=${JSON.stringify(checkpoint)}`
            ].join(', '));
        }
        const result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
        if (exit.exitCode !== 0 || exit.signal !== null) {
            throw new Error(result.error
                ?? `R3 WebGPU process 실패: ${JSON.stringify(exit)}`);
        }
        assertResult(result);
        console.log(JSON.stringify(result, null, 2));
        await removeRunDirectory(runDirectory);
        return result;
    } catch (error) {
        console.error(`R3 WebGPU 임시 디렉터리 보존: ${runDirectory}`);
        throw error;
    }
}

runHarness().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
});
