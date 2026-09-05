import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    R2_FINAL_ACCEPTED_BASE_COMMIT,
    R2_FINAL_AUTOMATED_GATE_COMMANDS,
    R2_FINAL_FOCUSED_NODE_TEST_FILES,
    R2_FINAL_HARDWARE_FIXTURE_STAGES,
    R2_FINAL_MANUAL_EVIDENCE_REQUIREMENTS
} from './support/run_r2_final_acceptance.mjs';
import {
    parseR2GpuChurnSoakArguments,
    R2_GPU_CHURN_SOAK_CONTRACT_VERSION,
    R2_GPU_CHURN_SOAK_DEFAULT_CYCLES,
    R2_GPU_CHURN_SOAK_MAXIMUM_CYCLES,
    R2_GPU_CHURN_SOAK_ROSTER,
    R2_GPU_CHURN_SOAK_STAGES
} from './support/run_r2_gpu_churn_soak.mjs';

const EXPECTED_HARDWARE_STAGE_IDS = Object.freeze([
    'full',
    'enemy-arrow-charge',
    'maximum-damage-window',
    'enemy-rhom-priority',
    'enemy-pentagon-effect',
    'enemy-hexa-formation',
    'enemy-octagon-directional-defense',
    'enemy-jorang-split-lineage',
    'enemy-ring-projectile-capture',
    'enemy-cork-route-closure'
]);

test('R2 final hardware inventory는 full과 모든 dedicated stage를 정확히 열거한다', () => {
    assert.deepEqual(
        R2_FINAL_HARDWARE_FIXTURE_STAGES.map(({ id }) => id),
        EXPECTED_HARDWARE_STAGE_IDS
    );
    assert.equal(R2_FINAL_HARDWARE_FIXTURE_STAGES[0].fixtureStage, null);
    assert.deepEqual(
        R2_FINAL_HARDWARE_FIXTURE_STAGES.slice(1).map(({ fixtureStage }) => (
            fixtureStage
        )),
        EXPECTED_HARDWARE_STAGE_IDS.slice(1)
    );
    assert.ok(Object.isFrozen(R2_FINAL_HARDWARE_FIXTURE_STAGES));
    assert.ok(R2_FINAL_HARDWARE_FIXTURE_STAGES.every(Object.isFrozen));
});

test('Turn 9 O/J와 carry-forward Ring/Cork dedicated hardware gate가 명시돼 있다', () => {
    const stageIds = new Set(
        R2_FINAL_HARDWARE_FIXTURE_STAGES.map(({ id }) => id)
    );
    for (const required of [
        'enemy-octagon-directional-defense',
        'enemy-jorang-split-lineage',
        'enemy-ring-projectile-capture',
        'enemy-cork-route-closure'
    ]) {
        assert.equal(stageIds.has(required), true, required);
    }
});

test('Node/churn/WASM/stress/render-golden/diff automated gates는 versioned command로 고정된다', () => {
    assert.deepEqual(
        R2_FINAL_AUTOMATED_GATE_COMMANDS.map(({ id }) => id),
        [
            'focused-node',
            'node',
            'r2-gpu-churn-soak',
            'wasm-flow-field-reproducibility',
            'wasm-collision-contact-reproducibility',
            'flow-field-stress',
            'render-golden-audited',
            'title-ui-gpu-smoke',
            'title-production-default-gpu-smoke',
            'diff-hygiene'
        ]
    );
    const [focusedNodeGate, nodeGate, ...remainingGates]
        = R2_FINAL_AUTOMATED_GATE_COMMANDS;
    assert.equal(focusedNodeGate.executable, process.execPath);
    assert.deepEqual(focusedNodeGate.args.slice(0, 2), [
        '--experimental-vm-modules',
        '--test'
    ]);
    assert.deepEqual(
        focusedNodeGate.args.slice(2),
        R2_FINAL_FOCUSED_NODE_TEST_FILES
    );
    assert.equal(R2_FINAL_FOCUSED_NODE_TEST_FILES.length, 23);
    assert.equal(nodeGate.executable, process.execPath);
    assert.deepEqual(nodeGate.args.slice(0, 2), [
        '--experimental-vm-modules',
        '--test'
    ]);
    assert.ok(nodeGate.args.length > 2);
    assert.ok(nodeGate.args.slice(2).every((file) => (
        /^\.\.\/test\/[^/]+\.test\.mjs$/u.test(file)
    )));
    assert.equal(remainingGates[0].contractVersion, 2);
    assert.equal(
        remainingGates[0].executionMode,
        'single-nw-device-session'
    );
    assert.deepEqual(
        remainingGates.map(({ args }) => args.join(' ')),
        [
            '../test/support/run_r2_gpu_churn_soak.mjs --cycles=3',
            '../test/support/build_enemy_ai_flow_field_wasm.mjs --check',
            '../test/support/build_collision_contact_wasm.mjs --check',
            '--experimental-vm-modules ../test/stress/enemy_ai_flow_field_stress.mjs',
            '../test/support/run_nw_render_pipeline_golden.mjs --check',
            '../test/support/run_nw_title_gpu_pipeline.mjs --profile smoke --pipeline-mode webgpu-kawase --simulation-mode cpu',
            '../test/support/run_nw_title_gpu_pipeline.mjs --profile smoke --pipeline-mode webgpu-gaussian --simulation-mode gpu',
            ''
        ]
    );
    const diffGate = remainingGates.at(-1);
    assert.equal(diffGate.kind, 'composite');
    assert.equal(diffGate.acceptedBaseCommit, R2_FINAL_ACCEPTED_BASE_COMMIT);
    assert.deepEqual(diffGate.scopes, [
        'accepted-base-to-head',
        'index',
        'worktree',
        'untracked'
    ]);
    assert.equal(diffGate.executable, null);
    assert.ok(R2_FINAL_AUTOMATED_GATE_COMMANDS.every(Object.isFrozen));
    assert.ok(R2_FINAL_AUTOMATED_GATE_COMMANDS.every(
        ({ args }) => Object.isFrozen(args)
    ));
});

test('clean HEAD에서도 accepted base부터 syntax/diff 증거를 revision-bound로 검사한다', async () => {
    assert.equal(
        R2_FINAL_ACCEPTED_BASE_COMMIT,
        '478fd5c96ca15f92a3a1c84867b165b76184b2ab'
    );
    const source = await readFile(new URL(
        './support/run_r2_final_acceptance.mjs',
        import.meta.url
    ), 'utf8');
    assert.match(
        source,
        /'diff', '--relative', '--name-only', '--diff-filter=ACMR',[\s\S]*R2_FINAL_ACCEPTED_BASE_COMMIT, 'HEAD', '--', 'game\/script'/u
    );
    assert.match(
        source,
        /'diff', '--check', R2_FINAL_ACCEPTED_BASE_COMMIT, 'HEAD'/u
    );
    assert.match(source, /'diff', '--cached', '--check'/u);
    assert.match(source, /'hash-object', '--', file/u);
    assert.match(source, /'diff', '--no-index', '--check'/u);
    assert.match(source, /acceptedBaseCommit: R2_FINAL_ACCEPTED_BASE_COMMIT/u);
    assert.match(source, /headCommit: headCommit\.trim\(\)/u);
    assert.match(source, /headTree: headTree\.trim\(\)/u);
    assert.match(
        source,
        /R2 final acceptance 실행 중 HEAD revision\/tree가 변경됐습니다/u
    );
});

test('R2 churn soak는 O/J/R/Z/H/P actual stage를 versioned bounded cycles로 반복한다', async () => {
    assert.equal(R2_GPU_CHURN_SOAK_CONTRACT_VERSION, 2);
    assert.equal(R2_GPU_CHURN_SOAK_DEFAULT_CYCLES, 3);
    assert.equal(R2_GPU_CHURN_SOAK_MAXIMUM_CYCLES, 12);
    assert.deepEqual(R2_GPU_CHURN_SOAK_STAGES, [
        'enemy-cork-route-closure'
    ]);
    assert.deepEqual(R2_GPU_CHURN_SOAK_ROSTER, [
        'octagon',
        'jorang',
        'ring',
        'cork',
        'hexa',
        'penta',
        'projectile'
    ]);
    assert.deepEqual(parseR2GpuChurnSoakArguments([]), { cycles: 3 });
    assert.deepEqual(parseR2GpuChurnSoakArguments(['--cycles=1']), { cycles: 1 });
    assert.throws(() => parseR2GpuChurnSoakArguments(['--cycles=0']), /1\.\.12|형식/u);
    assert.throws(() => parseR2GpuChurnSoakArguments(['--cycles=13']), /1\.\.12/u);
    assert.throws(() => parseR2GpuChurnSoakArguments(['--cycles', '3']), /하나만/u);
    assert.throws(() => parseR2GpuChurnSoakArguments(['--unknown=3']), /형식/u);

    const source = await readFile(new URL(
        './support/run_r2_gpu_churn_soak.mjs',
        import.meta.url
    ), 'utf8');
    assert.match(source, /spawn\(process\.execPath, \[CAPABILITY_RUNNER_PATH\]/u);
    assert.match(source, /CIRVIVOR_WEBGPU_FIXTURE_STAGE: stageId/u);
    assert.match(source, /CIRVIVOR_R2_CHURN_CYCLES: String\(cycles\)/u);
    assert.match(source, /exitCode !== 0 \|\| signal !== null/u);
    assert.match(source, /stdio: \['ignore', 'pipe', 'inherit'\]/u);
    assert.match(source, /process\.stderr\.write\(chunk\)/u);
    assert.match(source, /for \(const stageId of R2_GPU_CHURN_SOAK_STAGES\)/u);
    assert.doesNotMatch(source, /for \(let cycle = 1; cycle <= cycles/u);
    assert.doesNotMatch(source, /synthetic|fake[-_ ]success|mock[-_ ]success/iu);
});

test('R2 churn v2는 Cork actual 안의 단일 endpoint/device 3-cycle 증거를 fail-close한다', async () => {
    const [runnerSource, validatorSource] = await Promise.all([
        readFile(new URL(
            './nw_webgpu_capability/enemy_cork_route_closure_runner.js',
            import.meta.url
        ), 'utf8'),
        readFile(new URL(
            './support/webgpu_results/cork_results.mjs',
            import.meta.url
        ), 'utf8')
    ]);
    assert.match(runnerSource, /MIXED_CHURN_CONTRACT_VERSION = 2/u);
    assert.match(runnerSource, /async function runMixedSingleSessionChurn/u);
    assert.match(
        runnerSource,
        /for \(let cycle = 1; cycle <= requestedCycles; cycle\+\+\)/u
    );
    assert.match(
        runnerSource,
        /single-device-single-session-mixed-o-j-r-z-h-p-projectile-churn/u
    );
    assert.match(runnerSource, /exactIncarnationChurn/u);
    assert.match(runnerSource, /pendingAllZero/u);
    assert.match(runnerSource, /storageMaximum/u);
    assert.match(runnerSource, /submittedTickDelta/u);
    assert.doesNotMatch(
        runnerSource,
        /device\.destroy\(\)[\s\S]*runMixedSingleSessionChurn/u
    );
    assert.match(validatorSource, /mixedChurn\?\.contractVersion === 2/u);
    assert.match(validatorSource, /mixedChurn\.oneEndpoint === true/u);
    assert.match(validatorSource, /mixedChurn\.stableTuple === true/u);
    assert.match(validatorSource, /mixedChurn\.exactIncarnationChurn === true/u);
    assert.match(validatorSource, /cycle\.pendingAllZero === true/u);
    assert.match(validatorSource, /cycle\.submittedTickDelta === 2/u);
    assert.match(validatorSource, /mixedChurn\.storageMaximum === 9/u);
});

test('final runner는 환경 stage별 실제 capability command를 직렬 실행한다', async () => {
    const source = await readFile(new URL(
        './support/run_r2_final_acceptance.mjs',
        import.meta.url
    ), 'utf8');
    assert.match(source, /env\.CIRVIVOR_WEBGPU_FIXTURE_STAGE = fixture\.fixtureStage/u);
    assert.match(source, /delete env\.CIRVIVOR_WEBGPU_FIXTURE_STAGE/u);
    assert.match(
        source,
        /process\.execPath,[\s\S]*?\['\.\.\/test\/support\/run_nw_webgpu_capability\.mjs'\]/u
    );
    assert.match(source, /for \(const fixture of R2_FINAL_HARDWARE_FIXTURE_STAGES\)/u);
    assert.doesNotMatch(source, /npm\.cmd|NPM_EXECUTABLE/u);
    assert.doesNotMatch(source, /synthetic|fake[-_ ]success|mock[-_ ]success/iu);
    assert.match(source, /'diff', '--relative', '--name-only'/u);
    assert.match(source, /R2_FINAL_ACCEPTED_BASE_COMMIT, 'HEAD'/u);
    assert.match(source, /'diff', '--cached', '--check'/u);
    assert.match(source, /'hash-object', '--', file/u);
    assert.match(source, /'diff', '--no-index', '--check'/u);
    assert.match(source, /headTree/u);
    assert.match(source, /assertAcceptanceWorkspaceClean\('start'\)/u);
    assert.match(source, /assertAcceptanceWorkspaceClean\('finish'\)/u);
    assert.match(source, /--porcelain=v1', '-z', '--untracked-files=all/u);
    assert.match(source, /child\.once\('close'/u);
});

test('manual showcase smoke는 자동 PASS가 아닌 환경 가용 시 별도 증거 요구사항이다', () => {
    assert.deepEqual(R2_FINAL_MANUAL_EVIDENCE_REQUIREMENTS.map(({ id }) => id), [
        'manual-showcase-smoke'
    ]);
    assert.equal(R2_FINAL_MANUAL_EVIDENCE_REQUIREMENTS[0].automatedResult, false);
    assert.equal(
        R2_FINAL_MANUAL_EVIDENCE_REQUIREMENTS[0].reason,
        '최종 누적 실행은 비대화형 자동 runner였고, 사람의 interactive showcase 플레이/시각 검증 및 pause/resume 세션을 실행하지 않았다.'
    );
    assert.equal(
        R2_FINAL_MANUAL_EVIDENCE_REQUIREMENTS[0].requiredWhenEnvironmentAvailable,
        true
    );
    assert.deepEqual(R2_FINAL_MANUAL_EVIDENCE_REQUIREMENTS[0].evidenceItems, [
        'showcase-waves-played',
        'every-enemy-visual-behavior-verified',
        'tower-damage-window-verified',
        'core-defeat-verified',
        'post-tower-death-camera-verified',
        'pause-resume-verified'
    ]);
});
