import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, '..', '..', '..');
const CAPABILITY_RUNNER_PATH = 'game/test/support/run_nw_webgpu_capability.mjs';

export const R2_GPU_CHURN_SOAK_CONTRACT_VERSION = 2;
export const R2_GPU_CHURN_SOAK_DEFAULT_CYCLES = 3;
export const R2_GPU_CHURN_SOAK_MAXIMUM_CYCLES = 12;

/** 같은 NW/device/session의 bounded actual mixed roster입니다. */
export const R2_GPU_CHURN_SOAK_STAGES = Object.freeze([
    'enemy-cork-route-closure'
]);
export const R2_GPU_CHURN_SOAK_ROSTER = Object.freeze([
    'octagon',
    'jorang',
    'ring',
    'cork',
    'hexa',
    'penta',
    'projectile'
]);

export function parseR2GpuChurnSoakArguments(args) {
    if (!Array.isArray(args)) {
        throw new TypeError('R2 GPU churn soak args는 배열이어야 합니다.');
    }
    if (args.length === 0) {
        return Object.freeze({ cycles: R2_GPU_CHURN_SOAK_DEFAULT_CYCLES });
    }
    if (args.length !== 1) {
        throw new RangeError('R2 GPU churn soak는 --cycles=N 인자 하나만 허용합니다.');
    }
    const match = /^--cycles=([1-9][0-9]*)$/u.exec(args[0]);
    if (match === null) {
        throw new RangeError('R2 GPU churn soak cycles 형식은 --cycles=N 이어야 합니다.');
    }
    const cycles = Number(match[1]);
    if (!Number.isSafeInteger(cycles) || cycles > R2_GPU_CHURN_SOAK_MAXIMUM_CYCLES) {
        throw new RangeError(
            `R2 GPU churn soak cycles는 1..${R2_GPU_CHURN_SOAK_MAXIMUM_CYCLES} 범위여야 합니다.`
        );
    }
    return Object.freeze({ cycles });
}

function runActualHardwareStage(stageId, cycles) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CAPABILITY_RUNNER_PATH], {
            cwd: PROJECT_DIRECTORY,
            env: {
                ...process.env,
                CIRVIVOR_WEBGPU_FIXTURE_STAGE: stageId,
                CIRVIVOR_R2_CHURN_CYCLES: String(cycles)
            },
            stdio: ['ignore', 'pipe', 'inherit'],
            windowsHide: true
        });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            process.stderr.write(chunk);
        });
        child.once('error', (error) => {
            reject(new Error(
                `R2 GPU churn child 시작 실패: cycles=${cycles}, stage=${stageId}`,
                { cause: error }
            ));
        });
        child.once('close', (exitCode, signal) => {
            if (exitCode !== 0 || signal !== null) {
                reject(new Error(
                    `R2 GPU churn child 실패: cycles=${cycles}, stage=${stageId}, exit=${exitCode}, signal=${signal}`
                ));
                return;
            }
            resolve();
        });
    });
}

export async function runR2GpuChurnSoak({
    cycles = R2_GPU_CHURN_SOAK_DEFAULT_CYCLES
} = {}) {
    if (!Number.isSafeInteger(cycles)
        || cycles < 1
        || cycles > R2_GPU_CHURN_SOAK_MAXIMUM_CYCLES) {
        throw new RangeError(
            `R2 GPU churn soak cycles는 1..${R2_GPU_CHURN_SOAK_MAXIMUM_CYCLES} 범위여야 합니다.`
        );
    }
    const startedAt = performance.now();
    for (const stageId of R2_GPU_CHURN_SOAK_STAGES) {
        await runActualHardwareStage(stageId, cycles);
    }
    return Object.freeze({
        version: R2_GPU_CHURN_SOAK_CONTRACT_VERSION,
        executionMode: 'single-nw-device-session',
        cycles,
        stages: R2_GPU_CHURN_SOAK_STAGES,
        roster: R2_GPU_CHURN_SOAK_ROSTER,
        elapsed: Math.round(performance.now() - startedAt),
        elapsedUnit: 'milliseconds'
    });
}

const directEntryUrl = process.argv[1]
    ? pathToFileURL(path.resolve(process.argv[1])).href
    : null;
if (directEntryUrl === import.meta.url) {
    let options;
    try {
        options = parseR2GpuChurnSoakArguments(process.argv.slice(2));
    } catch (error) {
        console.error(error?.stack ?? String(error));
        process.exitCode = 1;
    }
    if (options !== undefined) {
        runR2GpuChurnSoak(options)
            .then((result) => {
                process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            })
            .catch((error) => {
                console.error(error?.stack ?? String(error));
                process.exitCode = 1;
            });
    }
}
