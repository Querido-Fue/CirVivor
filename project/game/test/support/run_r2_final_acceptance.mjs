import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, '..', '..', '..');
const REPOSITORY_DIRECTORY = path.resolve(PROJECT_DIRECTORY, '..');
export const R2_FINAL_ACCEPTED_BASE_COMMIT
    = '478fd5c96ca15f92a3a1c84867b165b76184b2ab';
const ROOT_NODE_TEST_FILES = Object.freeze(readdirSync(
    path.resolve(PROJECT_DIRECTORY, 'game', 'test'),
    { withFileTypes: true }
).filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map((entry) => `game/test/${entry.name}`)
    .sort());
export const R2_FINAL_FOCUSED_NODE_TEST_FILES = Object.freeze([
    'game/test/enemy_core_impact_director.test.mjs',
    'game/test/enemy_effect_contract_data.test.mjs',
    'game/test/enemy_formation_contract_data.test.mjs',
    'game/test/enemy_jorang_split_contract_data.test.mjs',
    'game/test/enemy_jorang_split_spawn_boundary.test.mjs',
    'game/test/enemy_octagon_directional_defense_contract_data.test.mjs',
    'game/test/enemy_ring_projectile_capture_contract_data.test.mjs',
    'game/test/game_object_route_availability_integration.test.mjs',
    'game/test/gpu_circle_body_abi.test.mjs',
    'game/test/gpu_enemy_cork_route_closure_contract.test.mjs',
    'game/test/gpu_enemy_jorang_split_contract.test.mjs',
    'game/test/gpu_enemy_octagon_directional_defense_contract.test.mjs',
    'game/test/gpu_enemy_ring_projectile_capture_contract.test.mjs',
    'game/test/gpu_enemy_shape_pipeline.test.mjs',
    'game/test/ingame_core_terminal_outcome.test.mjs',
    'game/test/ingame_enemy_lifecycle_command_owner.test.mjs',
    'game/test/jorang_split_lineage_director.test.mjs',
    'game/test/projectile_capture_director.test.mjs',
    'game/test/projectile_capture_lifecycle.test.mjs',
    'game/test/r2_enemy_showcase_content_data.test.mjs',
    'game/test/r2_showcase_manual_launcher_contract.test.mjs',
    'game/test/route_availability_host_contract.test.mjs',
    'game/test/webgl_batch_lazy_state_binding.test.mjs'
]);

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
        id: 'focused-node',
        executable: process.execPath,
        args: Object.freeze([
            '--experimental-vm-modules',
            '--test',
            ...R2_FINAL_FOCUSED_NODE_TEST_FILES
        ])
    }),
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
            'smoke',
            '--pipeline-mode',
            'webgpu-kawase',
            '--simulation-mode',
            'cpu'
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
        kind: 'composite',
        acceptedBaseCommit: R2_FINAL_ACCEPTED_BASE_COMMIT,
        scopes: Object.freeze([
            'accepted-base-to-head',
            'index',
            'worktree',
            'untracked'
        ]),
        executable: null,
        args: Object.freeze([])
    })
]);

/** 환경이 제공될 때 자동 gate 결과와 별도로 기록할 수동 증거 목록입니다. */
export const R2_FINAL_MANUAL_EVIDENCE_REQUIREMENTS = Object.freeze([
    Object.freeze({
        id: 'manual-showcase-smoke',
        automatedResult: false,
        requiredWhenEnvironmentAvailable: true,
        reason: '최종 누적 실행은 비대화형 자동 runner였고, 사람의 interactive showcase 플레이/시각 검증 및 pause/resume 세션을 실행하지 않았다.',
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
            cwd: options.cwd ?? PROJECT_DIRECTORY,
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
            const allowedExitCodes = options.allowedExitCodes ?? [0];
            if (!allowedExitCodes.includes(exitCode) || signal !== null) {
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
    await runCommand('git', [
        'merge-base', '--is-ancestor', R2_FINAL_ACCEPTED_BASE_COMMIT, 'HEAD'
    ], {
        cwd: REPOSITORY_DIRECTORY,
        label: 'R2 accepted base ancestry'
    });
    const [committed, working, untracked] = await Promise.all([
        runCommand('git', [
            'diff', '--relative', '--name-only', '--diff-filter=ACMR',
            R2_FINAL_ACCEPTED_BASE_COMMIT, 'HEAD', '--', 'game/script'
        ], { capture: true, label: 'committed production file list' }),
        runCommand('git', [
            'diff', '--relative', '--name-only', '--diff-filter=ACMR',
            'HEAD', '--', 'game/script'
        ], { capture: true, label: 'working production file list' }),
        runCommand('git', [
            'ls-files', '--others', '--exclude-standard', '--',
            'game/script'
        ], { capture: true, label: 'untracked production file list' })
    ]);
    const files = [...new Set(`${committed}\n${working}\n${untracked}`
        .split(/\r?\n/u)
        .map((value) => value.trim())
        .filter((value) => /\.(?:js|mjs)$/u.test(value)))].sort();
    for (const file of files) {
        await runCommand(process.execPath, ['--check', file], {
            label: `node --check ${file}`
        });
    }
    return files;
}

async function runDiffHygieneGate() {
    await runCommand('git', [
        'merge-base', '--is-ancestor', R2_FINAL_ACCEPTED_BASE_COMMIT, 'HEAD'
    ], {
        cwd: REPOSITORY_DIRECTORY,
        label: 'R2 diff base ancestry'
    });
    await runCommand('git', [
        'diff', '--check', R2_FINAL_ACCEPTED_BASE_COMMIT, 'HEAD'
    ], {
        cwd: REPOSITORY_DIRECTORY,
        label: 'accepted-base-to-HEAD diff hygiene'
    });
    await runCommand('git', ['diff', '--cached', '--check'], {
        cwd: REPOSITORY_DIRECTORY,
        label: 'index diff hygiene'
    });
    await runCommand('git', ['diff', '--check'], {
        cwd: REPOSITORY_DIRECTORY,
        label: 'worktree diff hygiene'
    });
    const untracked = await runCommand('git', [
        'ls-files', '--others', '--exclude-standard', '-z'
    ], {
        cwd: REPOSITORY_DIRECTORY,
        capture: true,
        label: 'untracked diff hygiene file list'
    });
    const untrackedFiles = untracked.split('\0').filter(Boolean).sort();
    for (const file of untrackedFiles) {
        await runCommand('git', ['hash-object', '--', file], {
            cwd: REPOSITORY_DIRECTORY,
            label: `untracked blob readability ${file}`
        });
        await runCommand('git', [
            'diff', '--no-index', '--check', '--', '/dev/null', file
        ], {
            cwd: REPOSITORY_DIRECTORY,
            allowedExitCodes: [0, 1],
            label: `untracked diff hygiene ${file}`
        });
    }
    return Object.freeze({
        acceptedBaseCommit: R2_FINAL_ACCEPTED_BASE_COMMIT,
        headCommit: (await runCommand('git', ['rev-parse', 'HEAD'], {
            cwd: REPOSITORY_DIRECTORY,
            capture: true,
            label: 'diff hygiene HEAD revision'
        })).trim(),
        untrackedFileCount: untrackedFiles.length
    });
}

async function readAcceptanceRevision() {
    const [headCommit, headTree] = await Promise.all([
        runCommand('git', ['rev-parse', 'HEAD'], {
            cwd: REPOSITORY_DIRECTORY,
            capture: true,
            label: 'acceptance HEAD revision'
        }),
        runCommand('git', ['rev-parse', 'HEAD^{tree}'], {
            cwd: REPOSITORY_DIRECTORY,
            capture: true,
            label: 'acceptance HEAD tree'
        })
    ]);
    return Object.freeze({
        acceptedBaseCommit: R2_FINAL_ACCEPTED_BASE_COMMIT,
        headCommit: headCommit.trim(),
        headTree: headTree.trim()
    });
}

async function assertAcceptanceWorkspaceClean(label) {
    const status = await runCommand('git', [
        'status', '--porcelain=v1', '-z', '--untracked-files=all'
    ], {
        cwd: REPOSITORY_DIRECTORY,
        capture: true,
        label: `${label} workspace status`
    });
    if (status.length !== 0) {
        throw new Error(
            `R2 final acceptance는 clean committed workspace에서만 실행할 수 있습니다: ${label}`
        );
    }
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
    await assertAcceptanceWorkspaceClean('start');
    const revision = await readAcceptanceRevision();
    const hardwareStages = await runHardwareFixtures();
    const productionSyntaxFiles = await runChangedProductionSyntaxGate();
    const automatedGates = [];
    let diffHygiene = null;
    for (const command of R2_FINAL_AUTOMATED_GATE_COMMANDS) {
        if (command.id === 'diff-hygiene') {
            diffHygiene = await runDiffHygieneGate();
        } else {
            await runCommand(command.executable, command.args, { label: command.id });
        }
        automatedGates.push(command.id);
    }
    const finalRevision = await readAcceptanceRevision();
    await assertAcceptanceWorkspaceClean('finish');
    if (finalRevision.headCommit !== revision.headCommit
        || finalRevision.headTree !== revision.headTree
        || diffHygiene?.headCommit !== revision.headCommit) {
        throw new Error('R2 final acceptance 실행 중 HEAD revision/tree가 변경됐습니다.');
    }
    return Object.freeze({
        revision,
        hardwareStages: Object.freeze(hardwareStages),
        productionSyntaxFiles: Object.freeze(productionSyntaxFiles),
        automatedGates: Object.freeze(automatedGates),
        diffHygiene,
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
