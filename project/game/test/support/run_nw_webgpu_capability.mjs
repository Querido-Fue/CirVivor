import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUN_DIRECTORY_PREFIX = 'cirvivor-webgpu-capability-';
const RUN_TIMEOUT_MS = 180_000;
const PRODUCTION_SCRIPT_MODULE_FILES = Object.freeze([
    'data/object/enemy/archer_attack_data.js',
    'data/object/enemy/archer_enemy_data.js',
    'data/object/enemy/basic_circle_enemy_data.js',
    'data/object/enemy/basic_rhom_attack_data.js',
    'data/object/enemy/basic_rhom_enemy_data.js',
    'data/object/enemy/basic_rhom_profile_data.js',
    'data/object/enemy/enemy_ai_data.js',
    'data/object/enemy/enemy_catalog_data.js',
    'data/object/enemy/enemy_profile_catalog_data.js',
    'data/object/enemy/enemy_shape_geometry_data.js',
    'data/object/enemy/hostile_attack_runtime_data.js',
    'data/object/enemy/main_gpu_enemy_definition_data.js',
    'data/object/core/the_core_data.js',
    'data/object/projectile/basic_bullet_data.js',
    'data/object/projectile/hostile_basic_bullet_data.js',
    'data/object/projectile/hostile_rhom_projectile_data.js',
    'data/object/tower/the_tower_data.js',
    'data/scene/game/corridor_eight_map_data.js',
    'data/scene/game/corridor_eight_wave_01_data.js',
    'module/ingame/contract/camera_control_contract.js',
    'module/ingame/contract/core_integrity_contract.js',
    'module/ingame/contract/enemy_capability_contract.js',
    'module/ingame/contract/enemy_lifecycle_disposition_contract.js',
    'module/ingame/contract/enemy_profile_contract.js',
    'module/ingame/contract/tile_navigation_contract.js',
    'module/ingame/contract/gameplay_team_contract.js',
    'module/ingame/contract/player_controllable_contract.js',
    'module/ingame/contract/projectile_target_policy_contract.js',
    'module/ingame/contract/run_outcome_contract.js',
    'module/ingame/game_world_session_mode.js',
    'module/ingame/flow/authored_wave_timeline_contract.js',
    'module/ingame/flow/wave_director.js',
    'module/ingame/gpu_simulation_endpoint.js',
    'module/ingame/map/tile_map.js',
    'module/ingame/map/world_camera_2d.js',
    'module/ingame/navigation/route_flow_field_atlas.js',
    'module/ingame/state/core_integrity.js',
    'module/ingame/state/run_outcome.js',
    'module/ingame/object/enemy/enemy_core_impact_director.js',
    'module/ingame/object/enemy/enemy_lifecycle_command_owner.js',
    'module/ingame/object/enemy/enemy_simulation_backend.js',
    'module/ingame/object/enemy/gpu_enemy_spawn_adapter.js',
    'module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js',
    'module/ingame/object/enemy/hostile_attack_director.js',
    'module/ingame/object/enemy/resolved_enemy_spawn_stats.js',
    'module/ingame/object/core/gpu_core_proxy_spawn_adapter.js',
    'module/ingame/object/gpu_fixed_command_owner.js',
    'module/ingame/object/gpu_spawn_intent.js',
    'module/ingame/object/projectile/gpu_primary_projectile_controller.js',
    'module/ingame/object/projectile/gpu_projectile_spawn_adapter.js',
    'module/ingame/object/tower/gpu_tower_actor_facade.js',
    'module/ingame/object/tower/gpu_tower_spawn_adapter.js',
    'module/ingame/object/tower/tower_combat_roster.js',
    'module/ingame/object/tower_core_camera_follow_target.js',
    'module/ingame/object/world_registry.js',
    'module/ingame/physics/gpu/gpu_body_presentation_clock.js',
    'module/ingame/physics/gpu/gpu_circle_body_abi.js',
    'module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    'module/ingame/physics/gpu/gpu_collision_shaders.js',
    'module/ingame/physics/gpu/gpu_fixed_primitive_abi.js',
    'module/ingame/physics/gpu/gpu_signed_distance_field.js',
    'module/object/enemy/_hexa_hive_layout.js',
    'module/object/enemy/_hexa_hive_layout_accessors.js',
    'module/object/enemy/_hexa_hive_layout_constants.js',
    'module/object/enemy/ai/_enemy_ai_debug_stats.js',
    'module/object/enemy/ai/_enemy_ai_navigation.js',
    'module/object/enemy/ai/navigation/_enemy_ai_flow_field_store.js',
    'module/object/enemy/ai/navigation/_enemy_ai_line_of_sight.js',
    'module/object/enemy/ai/navigation/_enemy_ai_navigation_geometry.js',
    'module/object/enemy/ai/wasm/_enemy_ai_flow_field_backend.js',
    'module/object/enemy/ai/wasm/_enemy_ai_flow_field_wasm_bytes.js',
    'module/object/enemy/ai/wasm/_enemy_ai_flow_field_wasm_runtime.js',
    'module/scene/benchmark/gpu_benchmark_enemy_spawn_adapter.js',
    'module/scene/benchmark/gpu_benchmark_navigation_source.js',
    'util/math_util.js',
    'util/number_util.js'
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
const NW_RUNTIME_DIRECTORIES = Object.freeze(['Dictionaries', 'locales', 'swiftshader']);

function assertDeadControlRaceResult(result) {
    const fixture = result?.productionFixedPrimitives?.deadControlRace;
    const valid = fixture?.scenario
            === 'tower-lethal-then-exact-dead-control-two-submit'
        && fixture.settledBetweenSubmits === false
        && fixture.deadControlSubmitted === true
        && fixture.sourceTicks?.deadControl === fixture.sourceTicks?.lethal + 1
        && fixture.submissions?.deadControl?.fixedCommandCount === 2
        && fixture.submissions.deadControl.completedBatchCountBeforeSubmit === 0
        && fixture.towerDeath?.observed === true
        && fixture.towerDeath.towerRegistryPresentAfterCleanup === false
        && fixture.towerDeath.towerBackendPresentAfterCleanup === false
        && fixture.liveControl?.moved === true
        && fixture.enemyPersistence?.identityPreserved === true
        && fixture.enemyPersistence.flowProgressed === true
        && fixture.enemyPersistence.renderAlphaAfterRace > 0
        && fixture.enemyPersistence.renderAlphaAfterCleanup > 0
        && fixture.backend?.failure === null
        && fixture.backend.recoveryRequired === false
        && fixture.backend.requiresAuthoritativeRebuild === false
        && fixture.storageProfile?.requiredMaximum === 9
        && result.uncapturedErrorCount === 0
        && result.deviceLostReason === 'destroyed';
    if (!valid) {
        throw new Error(
            `NW dead-control race 결과 계약 실패: ${JSON.stringify({
                fixture,
                uncapturedErrorCount: result?.uncapturedErrorCount,
                deviceLostReason: result?.deviceLostReason
            })}`
        );
    }
}

function assertDedicatedFixtureResult(result, fixtureStage) {
    let fixture = null;
    let scenarioValid = true;

    if (fixtureStage === 'enemy-arrow-charge') {
        fixture = result?.productionEnemyArrowCharge;
    } else if (fixtureStage === 'maximum-damage-window') {
        fixture = result?.productionMaximumDamageWindow;
    } else if (fixtureStage === 'enemy-rhom-priority') {
        fixture = result?.productionEnemyRhomPriority;
        scenarioValid = result?.productionEnemyRhomPriority?.scenario
            === 'rhom-core-priority-selected-target';
    }

    const fixtureExists = fixture !== null
        && typeof fixture === 'object'
        && !Array.isArray(fixture);
    const valid = result?.status === 'pass'
        && fixtureExists
        && scenarioValid
        && result.uncapturedErrorCount === 0
        && result.deviceLostReason === 'destroyed';
    if (!valid) {
        throw new Error(
            `NW ${fixtureStage} 결과 계약 실패: ${JSON.stringify({
                fixture,
                fixtureExists,
                scenarioValid,
                status: result?.status,
                uncapturedErrorCount: result?.uncapturedErrorCount,
                deviceLostReason: result?.deviceLostReason
            })}`
        );
    }
}

function assertFixtureStageResult(result) {
    const fixtureStage = process.env.CIRVIVOR_WEBGPU_FIXTURE_STAGE || 'full';
    if (fixtureStage === 'full') {
        assertDeadControlRaceResult(result);
        return;
    }
    if (
        fixtureStage === 'enemy-arrow-charge'
        || fixtureStage === 'maximum-damage-window'
        || fixtureStage === 'enemy-rhom-priority'
    ) {
        assertDedicatedFixtureResult(result, fixtureStage);
        return;
    }
    throw new Error(`지원하지 않는 NW WebGPU fixture stage입니다: ${fixtureStage}`);
}

function waitForChild(child) {
    return new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
    });
}

async function removeRunDirectory(runDirectory) {
    const resolvedRunDirectory = path.resolve(runDirectory);
    const resolvedTempDirectory = path.resolve(os.tmpdir());
    if (path.dirname(resolvedRunDirectory) !== resolvedTempDirectory
        || !path.basename(resolvedRunDirectory).startsWith(RUN_DIRECTORY_PREFIX)) {
        throw new Error(`임시 WebGPU 실행 디렉터리 범위를 확인할 수 없습니다: ${resolvedRunDirectory}`);
    }
    await fs.rm(resolvedRunDirectory, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100
    });
}

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

async function prepareHarnessApp(
    harnessDirectory,
    gameScriptDirectory,
    runDirectory
) {
    const appDirectory = path.join(runDirectory, 'app');
    await fs.mkdir(appDirectory, { recursive: true });
    const sourceIndexHtml = await fs.readFile(
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
    const importMapMarkup = `    <script type="importmap">\n${JSON.stringify(importMap, null, 8)}\n    </script>\n`;
    if (!sourceIndexHtml.includes('</head>')) {
        throw new Error('NW WebGPU harness index.html에 </head>가 없습니다.');
    }
    await fs.writeFile(
        path.join(appDirectory, 'index.html'),
        sourceIndexHtml.replace('</head>', `${importMapMarkup}</head>`),
        'utf8'
    );
    await linkRuntimeFile(
        path.join(harnessDirectory, 'runner.js'),
        path.join(appDirectory, 'runner.js')
    );
    const productionDirectory = path.join(appDirectory, 'production');
    await fs.mkdir(productionDirectory, { recursive: true });
    for (const relativePath of PRODUCTION_SCRIPT_MODULE_FILES) {
        const destinationPath = path.join(
            productionDirectory,
            'script',
            ...relativePath.split('/')
        );
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await linkRuntimeFile(
            path.join(gameScriptDirectory, ...relativePath.split('/')),
            destinationPath
        );
    }
    const packageJson = JSON.parse(
        await fs.readFile(path.join(harnessDirectory, 'package.json'), 'utf8')
    );
    packageJson.main = 'index.html';
    await fs.writeFile(
        path.join(appDirectory, 'package.json'),
        `${JSON.stringify(packageJson, null, 4)}\n`,
        'utf8'
    );
    return appDirectory;
}

async function runHarness() {
    if (process.platform !== 'win32') {
        throw new Error(`NW.js WebGPU capability 검사는 Windows만 지원합니다: ${process.platform}`);
    }

    const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
    const projectDirectory = path.resolve(scriptDirectory, '..', '..', '..');
    const harnessDirectory = path.join(
        projectDirectory,
        'game',
        'test',
        'nw_webgpu_capability'
    );
    const gameScriptDirectory = path.join(projectDirectory, 'game', 'script');
    const runDirectory = await fs.mkdtemp(path.join(os.tmpdir(), RUN_DIRECTORY_PREFIX));
    const resultPath = path.join(runDirectory, 'result.json');

    try {
        await Promise.all([
            fs.access(path.join(projectDirectory, 'lonely tower.exe')),
            fs.access(path.join(harnessDirectory, 'package.json')),
            fs.access(path.join(harnessDirectory, 'index.html')),
            fs.access(path.join(harnessDirectory, 'runner.js')),
            ...PRODUCTION_SCRIPT_MODULE_FILES.map((relativePath) => (
                fs.access(path.join(gameScriptDirectory, ...relativePath.split('/')))
            ))
        ]);
        const executablePath = await prepareIsolatedNwRuntime(projectDirectory, runDirectory);
        const appDirectory = await prepareHarnessApp(
            harnessDirectory,
            gameScriptDirectory,
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
                CIRVIVOR_WEBGPU_RESULT_PATH: resultPath
            },
            stdio: 'inherit',
            windowsHide: true
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

        if (timedOut) {
            throw new Error(`NW.js WebGPU capability 실행 제한시간 초과: ${RUN_TIMEOUT_MS}ms`);
        }

        let result;
        try {
            result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
        } catch (error) {
            throw new Error(
                `NW.js WebGPU 결과를 읽지 못했습니다. exit=${exit.exitCode}, signal=${exit.signal}: ${error.message}`
            );
        }

        if (exit.exitCode !== 0 || exit.signal !== null || result.status !== 'pass') {
            throw new Error(
                result.error
                || `NW.js WebGPU capability 실패: exit=${exit.exitCode}, signal=${exit.signal}`
            );
        }
        assertFixtureStageResult(result);

        console.log(JSON.stringify(result, null, 2));
        await removeRunDirectory(runDirectory);
        return result;
    } catch (error) {
        console.error(`WebGPU capability 실행 임시 디렉터리 보존: ${runDirectory}`);
        throw error;
    }
}

runHarness().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
});
