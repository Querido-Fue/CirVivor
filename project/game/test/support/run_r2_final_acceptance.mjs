import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, '..', '..', '..');
const ROOT_NODE_TEST_FILES = Object.freeze(readdirSync(
    path.resolve(PROJECT_DIRECTORY, 'game', 'test'),
    { withFileTypes: true }
).filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map((entry) => `game/test/${entry.name}`)
    .sort());

/** Default hardware route 다음에 모든 R2 dedicated stage를 명시적으로 실행합니다. */
export const R2_FINAL_HARDWARE_FIXTURE_STAGES = Object.freeze([
    Object.freeze({ id: 'full', fixtureStage: null }),
    Object.freeze({ id: 'enemy-arrow-charge', fixtureStage: 'enemy-arrow-charge' }),
    Object.freeze({
        id: 'maximum-damage-window',
        fixtureStage: 'maximum-damage-window'
    }),
    Object.freeze({ id: 'enemy-rhom-priority', fixtureStage: 'enemy-rhom-priority' }),
    Object.freeze({
        id: 'enemy-pentagon-effect',
        fixtureStage: 'enemy-pentagon-effect'
    }),
    Object.freeze({
        id: 'enemy-hexa-formation',
        fixtureStage: 'enemy-hexa-formation'
    }),
    Object.freeze({
        id: 'enemy-octagon-directional-defense',
        fixtureStage: 'enemy-octagon-directional-defense'
    }),
    Object.freeze({
        id: 'enemy-jorang-split-lineage',
        fixtureStage: 'enemy-jorang-split-lineage'
    }),
    Object.freeze({
        id: 'enemy-ring-projectile-capture',
        fixtureStage: 'enemy-ring-projectile-capture'
    }),
    Object.freeze({
        id: 'enemy-cork-route-closure',
        fixtureStage: 'enemy-cork-route-closure'
    })
]);

export const R2_FINAL_AUTOMATED_GATE_COMMANDS = Object.freeze([
    Object.freeze({
        id: 'node',
        executable: process.execPath,
        args: Object.freeze([
            '--experimental-vm-modules',
            '--test',
            ...ROOT_NODE_TEST_FILES
        ])
    }),
    Object.freeze({
        id: 'r2-gpu-churn-soak',
        contractVersion: 2,
        executionMode: 'single-nw-device-session',
        executable: process.execPath,
        args: Object.freeze([
            'game/test/support/run_r2_gpu_churn_soak.mjs',
            '--cycles=3'
        ])
    }),
    Object.freeze({
        id: 'wasm-flow-field-reproducibility',
        executable: process.execPath,
        args: Object.freeze([
            'game/test/support/build_enemy_ai_flow_field_wasm.mjs',
            '--check'
        ])
    }),
    Object.freeze({
        id: 'wasm-collision-contact-reproducibility',
        executable: process.execPath,
        args: Object.freeze([
            'game/test/support/build_collision_contact_wasm.mjs',
            '--check'
        ])
    }),
    Object.freeze({
        id: 'flow-field-stress',
        executable: process.execPath,
        args: Object.freeze([
            '--experimental-vm-modules',
            'game/test/stress/enemy_ai_flow_field_stress.mjs'
        ])
    }),
    Object.freeze({
        id: 'render-golden-audited',
        executable: process.execPath,
        args: Object.freeze([
            'game/test/support/run_nw_render_pipeline_golden.mjs',
            '--check'
        ])
    }),
    Object.freeze({
        id: 'title-ui-gpu-smoke',
        executable: process.execPath,
        args: Object.freeze([
            'game/test/support/run_nw_title_gpu_pipeline.mjs',
            '--profile',
            'smoke'
        ])
    }),
    Object.freeze({
        id: 'title-production-default-gpu-smoke',
        executable: process.execPath,
        args: Object.freeze([
            'game/test/support/run_nw_title_gpu_pipeline.mjs',
            '--profile',
            'smoke',
            '--pipeline-mode',
            'webgpu-gaussian',
            '--simulation-mode',
            'gpu'
        ])
    }),
    Object.freeze({
        id: 'diff-hygiene',
        executable: 'git',
        args: Object.freeze(['diff', '--check'])
    })
]);

/** 환경이 제공될 때 자동 gate 결과와 별도로 기록할 수동 증거 목록입니다. */
export const R2_FINAL_MANUAL_EVIDENCE_REQUIREMENTS = Object.freeze([
    Object.freeze({
        id: 'manual-showcase-smoke',
        automatedResult: false,
        requiredWhenEnvironmentAvailable: true,
        evidenceItems: Object.freeze([
            'showcase-waves-played',
            'every-enemy-visual-behavior-verified',
            'tower-damage-window-verified',
            'core-defeat-verified',
            'post-tower-death-camera-verified',
            'pause-resume-verified'
        ])
    })
]);

function runCommand(executable, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, {
            cwd: PROJECT_DIRECTORY,
            env: options.env ?? process.env,
            stdio: options.capture === true
                ? ['ignore', 'pipe', 'inherit']
                : 'inherit',
            windowsHide: true
        });
        let stdout = '';
        if (options.capture === true) {
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (chunk) => {
                stdout += chunk;
            });
        }
        child.once('error', reject);
        // `close`는 stdout/stderr pipe가 모두 닫힌 뒤 발생하므로 capture 결과의
        // 마지막 chunk까지 node --check 파일 목록에 포함됩니다.
        child.once('close', (exitCode, signal) => {
            if (exitCode !== 0 || signal !== null) {
                reject(new Error(
                    `${options.label ?? executable} failed: exit=${exitCode}, signal=${signal}`
                ));
                return;
            }
            resolve(stdout);
        });
    });
}

async function runChangedProductionSyntaxGate() {
    const [tracked, untracked] = await Promise.all([
        runCommand('git', [
            'diff', '--relative', '--name-only', '--diff-filter=ACMR', 'HEAD', '--',
            'game/script/**/*.js', 'game/script/**/*.mjs'
        ], { capture: true, label: 'changed production file list' }),
        runCommand('git', [
            'ls-files', '--others', '--exclude-standard', '--',
            'game/script/**/*.js', 'game/script/**/*.mjs'
        ], { capture: true, label: 'untracked production file list' })
    ]);
    const files = [...new Set(`${tracked}\n${untracked}`
        .split(/\r?\n/u)
        .map((value) => value.trim())
        .filter(Boolean))].sort();
    for (const file of files) {
        await runCommand(process.execPath, ['--check', file], {
            label: `node --check ${file}`
        });
    }
    return files;
}

async function runHardwareFixtures() {
    const completed = [];
    for (const fixture of R2_FINAL_HARDWARE_FIXTURE_STAGES) {
        const env = { ...process.env };
        if (fixture.fixtureStage === null) {
            delete env.CIRVIVOR_WEBGPU_FIXTURE_STAGE;
        } else {
            env.CIRVIVOR_WEBGPU_FIXTURE_STAGE = fixture.fixtureStage;
        }
        await runCommand(
            process.execPath,
            ['game/test/support/run_nw_webgpu_capability.mjs'],
            { env, label: `WebGPU ${fixture.id}` }
        );
        completed.push(fixture.id);
    }
    return completed;
}

export async function runR2FinalAutomatedAcceptance() {
    const hardwareStages = await runHardwareFixtures();
    const productionSyntaxFiles = await runChangedProductionSyntaxGate();
    const automatedGates = [];
    for (const command of R2_FINAL_AUTOMATED_GATE_COMMANDS) {
        await runCommand(command.executable, command.args, { label: command.id });
        automatedGates.push(command.id);
    }
    return Object.freeze({
        hardwareStages: Object.freeze(hardwareStages),
        productionSyntaxFiles: Object.freeze(productionSyntaxFiles),
        automatedGates: Object.freeze(automatedGates),
        manualEvidenceRequirements: R2_FINAL_MANUAL_EVIDENCE_REQUIREMENTS
    });
}

function printInventory() {
    process.stdout.write(`${JSON.stringify({
        hardwareStages: R2_FINAL_HARDWARE_FIXTURE_STAGES,
        automatedGates: R2_FINAL_AUTOMATED_GATE_COMMANDS,
        manualEvidenceRequirements: R2_FINAL_MANUAL_EVIDENCE_REQUIREMENTS
    }, null, 2)}\n`);
}

const directEntryUrl = process.argv[1]
    ? pathToFileURL(path.resolve(process.argv[1])).href
    : null;
if (directEntryUrl === import.meta.url) {
    if (process.argv.includes('--list')) {
        printInventory();
    } else {
        runR2FinalAutomatedAcceptance()
            .then((result) => {
                process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            })
            .catch((error) => {
                console.error(error?.stack ?? String(error));
                process.exitCode = 1;
            });
    }
}
