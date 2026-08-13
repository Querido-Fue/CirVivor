import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RUN_DIRECTORY_PREFIX = 'cirvivor-r2-showcase-manual-';
const STAGED_PACKAGE_MAIN = 'game/test/nw_r2_showcase_manual/index.html';
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
const HARNESS_FILES = Object.freeze([
    'index.html',
    'bootstrap.js',
    'manual.css'
]);
const GAME_ASSET_DIRECTORIES = Object.freeze([
    'script',
    'font',
    'audio',
    'image'
]);

function waitForExit(child) {
    return new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
    });
}

function isSafeRunDirectory(runDirectory) {
    const resolved = path.resolve(runDirectory);
    return path.dirname(resolved) === path.resolve(os.tmpdir())
        && path.basename(resolved).startsWith(RUN_DIRECTORY_PREFIX);
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

async function prepareIsolatedNwRuntime(sourceExecutablePath, runDirectory) {
    const runtimeDirectory = path.join(runDirectory, 'runtime');
    const sourceDirectory = path.dirname(sourceExecutablePath);
    await fs.mkdir(runtimeDirectory, { recursive: true });
    const executablePath = path.join(runtimeDirectory, 'nw.exe');
    await linkRuntimeFile(sourceExecutablePath, executablePath);
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
    return executablePath;
}

async function prepareIsolatedHarnessApp(config, runDirectory) {
    const appDirectory = path.join(runDirectory, 'app');
    const stagedGameDirectory = path.join(appDirectory, 'game');
    const stagedHarnessDirectory = path.join(
        stagedGameDirectory,
        'test',
        'nw_r2_showcase_manual'
    );
    const stagedSupportDirectory = path.join(stagedGameDirectory, 'test', 'support');
    await fs.mkdir(stagedHarnessDirectory, { recursive: true });
    await fs.mkdir(stagedSupportDirectory, { recursive: true });

    for (const fileName of HARNESS_FILES) {
        await linkRuntimeFile(
            path.join(config.harnessDirectory, fileName),
            path.join(stagedHarnessDirectory, fileName)
        );
    }
    await linkRuntimeFile(
        path.join(config.supportDirectory, 'r2_showcase_manual_launcher.js'),
        path.join(stagedSupportDirectory, 'r2_showcase_manual_launcher.js')
    );
    await linkRuntimeFile(
        path.join(config.gameDirectory, 'style.css'),
        path.join(stagedGameDirectory, 'style.css')
    );
    for (const directoryName of GAME_ASSET_DIRECTORIES) {
        await linkRuntimeDirectory(
            path.join(config.gameDirectory, directoryName),
            path.join(stagedGameDirectory, directoryName)
        );
    }

    const harnessPackage = JSON.parse(await fs.readFile(
        path.join(config.harnessDirectory, 'package.json'),
        'utf8'
    ));
    if (harnessPackage.main !== STAGED_PACKAGE_MAIN) {
        throw new Error(
            `manual harness package main이 staged boundary와 다릅니다: ${harnessPackage.main}`
        );
    }
    await fs.writeFile(
        path.join(appDirectory, 'package.json'),
        `${JSON.stringify(harnessPackage, null, 4)}\n`,
        'utf8'
    );
    return appDirectory;
}

export function createManualShowcaseLaunchConfig(options = {}) {
    const supportDirectory = path.dirname(fileURLToPath(import.meta.url));
    const gameDirectory = path.resolve(supportDirectory, '..', '..');
    const projectDirectory = path.resolve(gameDirectory, '..');
    const repositoryDirectory = path.resolve(projectDirectory, '..');
    return Object.freeze({
        sourceExecutablePath: path.resolve(
            options.sourceExecutablePath
                ?? process.env.CIRVIVOR_NW_EXE
                ?? path.join(projectDirectory, 'lonely tower.exe')
        ),
        harnessDirectory: path.resolve(
            options.harnessDirectory
                ?? path.join(gameDirectory, 'test', 'nw_r2_showcase_manual')
        ),
        supportDirectory,
        gameDirectory,
        evidenceDirectory: path.resolve(
            options.evidenceDirectory
                ?? process.env.CIRVIVOR_R2_SHOWCASE_EVIDENCE_DIR
                ?? path.join(
                    repositoryDirectory,
                    'plan',
                    'post_r2_stabilization',
                    'evidence',
                    'manual_showcase'
                )
        )
    });
}

export async function runManualShowcase(options = {}) {
    const config = createManualShowcaseLaunchConfig(options);
    await fs.access(config.sourceExecutablePath);
    await fs.access(path.join(config.harnessDirectory, 'package.json'));
    const runDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), RUN_DIRECTORY_PREFIX)
    );
    let child = null;
    let interrupted = false;
    const handleInterrupt = () => {
        interrupted = true;
        child?.kill();
    };
    process.once('SIGINT', handleInterrupt);
    process.once('SIGTERM', handleInterrupt);
    try {
        const executablePath = await prepareIsolatedNwRuntime(
            config.sourceExecutablePath,
            runDirectory
        );
        const appDirectory = await prepareIsolatedHarnessApp(config, runDirectory);
        if (path.dirname(executablePath) === path.dirname(config.sourceExecutablePath)
            || appDirectory === path.dirname(config.sourceExecutablePath)) {
            throw new Error('production package root 직접 실행은 manual harness에서 금지됩니다.');
        }

        console.log(`Post-R2 manual showcase evidence: ${config.evidenceDirectory}`);
        console.log(`Isolated NW runtime: ${executablePath}`);
        console.log(`Isolated NW app: ${appDirectory}`);
        console.log('종료할 때 앱의 Safe Exit 버튼을 사용하세요.');
        child = spawn(executablePath, [
            `--user-data-dir=${path.join(runDirectory, 'user-data')}`,
            '--force-device-scale-factor=1',
            '--enable-logging=stderr',
            appDirectory
        ], {
            cwd: runDirectory,
            env: {
                ...process.env,
                CIRVIVOR_R2_SHOWCASE_EVIDENCE_DIR: config.evidenceDirectory
            },
            stdio: 'inherit',
            windowsHide: false
        });
        const result = await waitForExit(child);
        console.log(`NW manual showcase exit: ${JSON.stringify(result)}`);
        if (!interrupted && result.exitCode !== 0) {
            throw new Error(
                `NW manual showcase가 비정상 종료되었습니다: ${JSON.stringify(result)}`
            );
        }
        return Object.freeze({
            ...result,
            evidenceDirectory: config.evidenceDirectory
        });
    } finally {
        process.removeListener('SIGINT', handleInterrupt);
        process.removeListener('SIGTERM', handleInterrupt);
        if (!isSafeRunDirectory(runDirectory)) {
            throw new Error(`임시 실행 디렉터리 범위를 확인할 수 없습니다: ${runDirectory}`);
        }
        await fs.rm(runDirectory, {
            recursive: true,
            force: true,
            maxRetries: 20,
            retryDelay: 100
        });
        console.log(`Removed isolated manual showcase run directory: ${runDirectory}`);
    }
}

const invokedPath = process.argv[1]
    ? pathToFileURL(path.resolve(process.argv[1])).href
    : null;
if (invokedPath === import.meta.url) {
    runManualShowcase().catch((error) => {
        console.error(error?.stack ?? error);
        process.exitCode = 1;
    });
}
