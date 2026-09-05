import { assertDedicatedFixtureResult } from './webgpu_results/index.mjs';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { waitForChildWithTimeout } from './nw_child_process_guard.mjs';

const RUN_DIRECTORY_PREFIX = 'cirvivor-webgpu-capability-';
const RUN_TIMEOUT_MS = 180_000;
const PRODUCTION_SCRIPT_MODULE_FILES = Object.freeze([
    'data/object/enemy/archer_attack_data.js',
    'data/object/enemy/archer_enemy_data.js',
    'data/object/enemy/basic_circle_enemy_data.js',
    'data/object/enemy/basic_cork_enemy_data.js',
    'data/object/enemy/basic_hexa_enemy_data.js',
    'data/object/enemy/basic_jorang_enemy_data.js',
    'data/object/enemy/basic_octa_enemy_data.js',
    'data/object/enemy/basic_penta_enemy_data.js',
    'data/object/enemy/basic_ring_enemy_data.js',
    'data/object/enemy/basic_rhom_attack_data.js',
    'data/object/enemy/basic_rhom_enemy_data.js',
    'data/object/enemy/basic_rhom_profile_data.js',
    'data/object/enemy/enemy_ai_data.js',
    'data/object/enemy/enemy_catalog_data.js',
    'data/object/enemy/enemy_effect_catalog_data.js',
    'data/object/enemy/enemy_formation_catalog_data.js',
    'data/object/enemy/enemy_jorang_split_catalog_data.js',
    'data/object/enemy/enemy_jorang_split_runtime_data.js',
    'data/object/enemy/enemy_profile_catalog_data.js',
    'data/object/enemy/enemy_projectile_capture_catalog_data.js',
    'data/object/enemy/enemy_route_closure_catalog_data.js',
    'data/object/enemy/enemy_shape_geometry_data.js',
    'data/object/enemy/hostile_attack_runtime_data.js',
    'data/object/enemy/main_gpu_enemy_definition_data.js',
    'data/object/core/the_core_data.js',
    'data/object/projectile/basic_bullet_data.js',
    'data/object/projectile/hostile_basic_bullet_data.js',
    'data/object/projectile/hostile_rhom_projectile_data.js',
    'data/object/tower/the_tower_data.js',
    'data/word/r3_word_catalog_data.js',
    'data/word/r5_actor_action_profile_data.js',
    'data/word/r6_tower_group_operation_profile_data.js',
    'data/word/r7_sentence_modifier_profile_data.js',
    'data/scene/game/corridor_eight_map_data.js',
    'data/scene/game/corridor_eight_wave_01_data.js',
    'data/scene/game/cork_dual_route_map_data.js',
    'data/scene/game/cork_dual_route_wave_01_data.js',
    'data/scene/game/performance_serpentine_map_data.js',
    'data/scene/game/purple_crystal_map_visual_theme_data.js',
    'module/ingame/contract/camera_control_contract.js',
    'module/ingame/contract/ability_execution_contract.js',
    'module/ingame/contract/actor_action_contract.js',
    'module/ingame/contract/actor_payload_contract.js',
    'module/ingame/contract/core_integrity_contract.js',
    'module/ingame/contract/enemy_capability_contract.js',
    'module/ingame/contract/enemy_atomic_transform_contract.js',
    'module/ingame/contract/enemy_effect_contract.js',
    'module/ingame/contract/enemy_formation_contract.js',
    'module/ingame/contract/enemy_lifecycle_disposition_contract.js',
    'module/ingame/contract/enemy_orbit_directional_defense_contract.js',
    'module/ingame/contract/enemy_profile_contract.js',
    'module/ingame/contract/enemy_jorang_split_contract.js',
    'module/ingame/contract/tile_navigation_contract.js',
    'module/ingame/contract/word_sentence_contract.js',
    'module/ingame/contract/gameplay_team_contract.js',
    'module/ingame/contract/map_visual_theme_contract.js',
    'module/ingame/contract/player_controllable_contract.js',
    'module/ingame/contract/projectile_target_policy_contract.js',
    'module/ingame/contract/projectile_capture_contract.js',
    'module/ingame/contract/enemy_route_closure_contract.js',
    'module/ingame/contract/route_availability_contract.js',
    'module/ingame/contract/run_outcome_contract.js',
    'module/ingame/contract/sentence_modifier_contract.js',
    'module/ingame/contract/tower_group_operation_contract.js',
    'module/ingame/contract/tower_merge_identity_proof_contract.js',
    'module/ingame/game_world_session_mode.js',
    'module/ingame/flow/authored_wave_timeline_contract.js',
    'module/ingame/flow/wave_director.js',
    'module/ingame/gpu_simulation_endpoint.js',
    'module/ingame/map/tile_map.js',
    'module/ingame/map/world_camera_2d.js',
    'module/ingame/navigation/route_flow_field_atlas.js',
    'module/ingame/state/core_integrity.js',
    'module/ingame/state/run_outcome.js',
    'module/ingame/word/actor_payload_budget.js',
    'module/ingame/word/ability_runtime.js',
    'module/ingame/word/actor_payload_materializer.js',
    'module/ingame/word/sentence_compiler.js',
    'module/ingame/word/sentence_modifier_resolver.js',
    'module/ingame/word/sentence_runtime_estimator.js',
    'module/ingame/word/word_system.js',
    'module/ingame/object/enemy/enemy_core_impact_director.js',
    'module/ingame/object/enemy/enemy_lifecycle_command_owner.js',
    'module/ingame/object/enemy/enemy_simulation_backend.js',
    'module/ingame/object/enemy/gpu_atomic_transform_command_owner.js',
    'module/ingame/object/enemy/gpu_effect_command_owner.js',
    'module/ingame/object/enemy/gpu_formation_command_owner.js',
    'module/ingame/object/enemy/gpu_enemy_spawn_adapter.js',
    'module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js',
    'module/ingame/object/enemy/hostile_attack_director.js',
    'module/ingame/object/enemy/hostile_attack_catalog.js',
    'module/ingame/object/enemy/hostile_attack_protocol.js',
    'module/ingame/object/enemy/jorang_split_lineage_director.js',
    'module/ingame/object/enemy/pentagon_effect_director.js',
    'module/ingame/object/enemy/formation_runtime_director.js',
    'module/ingame/object/enemy/projectile_capture_director.js',
    'module/ingame/object/enemy/cork_route_closure_director.js',
    'module/ingame/object/enemy/resolved_enemy_spawn_stats.js',
    'module/ingame/object/core/gpu_core_proxy_spawn_adapter.js',
    'module/ingame/object/gpu_fixed_command_owner.js',
    'module/ingame/object/gpu_spawn_intent.js',
    'module/ingame/object/projectile/gpu_primary_projectile_controller.js',
    'module/ingame/object/projectile/gpu_projectile_spawn_adapter.js',
    'module/ingame/object/tower/gpu_tower_actor_facade.js',
    'module/ingame/object/tower/gpu_tower_group_facade.js',
    'module/ingame/object/tower/gpu_tower_spawn_adapter.js',
    'module/ingame/object/tower/tower_creation_coordinator.js',
    'module/ingame/object/tower/tower_combat_roster.js',
    'module/ingame/object/tower/tower_group_contract.js',
    'module/ingame/object/tower/tower_group_state.js',
    'module/ingame/object/tower/tower_share_ledger.js',
    'module/ingame/object/tower_core_camera_follow_target.js',
    'module/ingame/object/world_registry.js',
    'module/ingame/physics/gpu/gpu_atomic_transform_runtime_abi.js',
    'module/ingame/physics/gpu/gpu_atomic_transform_positive_damage_hit_shaders.js',
    'module/ingame/physics/gpu/gpu_atomic_transform_runtime_shaders.js',
    'module/ingame/physics/gpu/gpu_ability_subject_snapshot_abi.js',
    'module/ingame/physics/gpu/gpu_ability_subject_snapshot_runtime.js',
    'module/ingame/physics/gpu/gpu_actor_payload_materialization_abi.js',
    'module/ingame/physics/gpu/gpu_actor_payload_materialization_runtime.js',
    'module/ingame/physics/gpu/gpu_actor_action_placement_abi.js',
    'module/ingame/physics/gpu/gpu_actor_action_placement_runtime.js',
    'module/ingame/physics/gpu/gpu_actor_action_placement_shaders.js',
    'module/ingame/physics/gpu/gpu_actor_transit_abi.js',
    'module/ingame/physics/gpu/gpu_actor_transit_runtime.js',
    'module/ingame/physics/gpu/gpu_actor_transit_shaders.js',
    'module/ingame/physics/gpu/gpu_body_presentation_clock.js',
    'module/ingame/physics/gpu/gpu_circle_body_abi.js',
    'module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    'module/ingame/physics/gpu/gpu_resource_allocation.js',
    'module/ingame/physics/gpu/gpu_circle_pipeline_profiles.js',
    'module/ingame/physics/gpu/gpu_circle_pipeline_layouts.js',
    'module/ingame/physics/gpu/gpu_circle_pipelines.js',
    'module/ingame/physics/gpu/gpu_circle_bind_groups.js',
    'module/ingame/physics/gpu/gpu_circle_pipeline_set.js',
    'module/ingame/physics/gpu/gpu_route_flow_field_generator.js',
    'module/ingame/physics/gpu/gpu_collision_grid_contract.js',
    'module/ingame/physics/gpu/gpu_collision_shaders.js',
    'module/ingame/physics/gpu/shaders/collision_atomic_transform.js',
    'module/ingame/physics/gpu/shaders/collision_common.js',
    'module/ingame/physics/gpu/shaders/collision_compute.js',
    'module/ingame/physics/gpu/shaders/collision_contact_detection.js',
    'module/ingame/physics/gpu/shaders/collision_contact_resolution.js',
    'module/ingame/physics/gpu/shaders/collision_damage_window.js',
    'module/ingame/physics/gpu/shaders/collision_enemy_behavior.js',
    'module/ingame/physics/gpu/shaders/collision_fixed_commands.js',
    'module/ingame/physics/gpu/shaders/collision_indirect.js',
    'module/ingame/physics/gpu/shaders/collision_integration_grid.js',
    'module/ingame/physics/gpu/shaders/collision_position_solver.js',
    'module/ingame/physics/gpu/shaders/collision_render.js',
    'module/ingame/physics/gpu/shaders/collision_wgsl_values.js',
    'module/ingame/physics/gpu/gpu_spawn_admission_shaders.js',
    'module/ingame/physics/gpu/gpu_crowd_density_runtime.js',
    'module/ingame/physics/gpu/gpu_effect_runtime_abi.js',
    'module/ingame/physics/gpu/gpu_effect_runtime_shaders.js',
    'module/ingame/physics/gpu/gpu_fixed_primitive_abi.js',
    'module/ingame/physics/gpu/gpu_formation_runtime_abi.js',
    'module/ingame/physics/gpu/gpu_formation_runtime_shaders.js',
    'module/ingame/physics/gpu/gpu_projectile_capture_runtime_abi.js',
    'module/ingame/physics/gpu/gpu_projectile_capture_runtime_shaders.js',
    'module/ingame/physics/gpu/gpu_route_runtime_abi.js',
    'module/ingame/physics/gpu/gpu_route_runtime_shaders.js',
    'module/ingame/physics/gpu/gpu_signed_distance_field.js',
    'module/ingame/physics/gpu/gpu_tower_group_abi.js',
    'module/ingame/physics/gpu/gpu_tower_group_runtime.js',
    'module/ingame/physics/gpu/gpu_tower_group_shaders.js',
    'module/ingame/physics/gpu/gpu_tower_merge_abi.js',
    'module/ingame/physics/gpu/gpu_tower_merge_runtime.js',
    'module/ingame/physics/gpu/gpu_tower_merge_shaders.js',
    'module/ingame/physics/gpu/gpu_tower_transaction_runtime_mux.js',
    'module/ingame/physics/gpu/gpu_tower_creation_abi.js',
    'module/ingame/physics/gpu/gpu_tower_creation_runtime.js',
    'module/ingame/physics/gpu/gpu_tower_creation_shaders.js',
    'module/ingame/physics/gpu/gpu_tower_target_query_abi.js',
    'module/ingame/physics/gpu/gpu_tower_target_query_runtime.js',
    'module/ingame/physics/gpu/gpu_tower_target_query_shaders.js',
    'module/ingame/physics/gpu/gpu_transient_vfx_runtime.js',
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
    'module/simulation/simulation_runtime.js',
    'util/math_util.js',
    'util/min_heap.js',
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
            === 'tower-lethal-published-then-stale-control-rejected'
        && fixture.publicationPolicy
            === 'capture-release-generic-per-boundary'
        && fixture.settledBeforeDeathPublication === true
        && fixture.deadControlRequestAccepted === true
        && fixture.deadControlGpuSubmitted === false
        && fixture.sourceTicks?.deadControl === fixture.sourceTicks?.lethal + 1
        && fixture.submissions?.deadControl?.fixedCommandCount === 1
        && fixture.submissions.deadControl.rejectionCode === 'stale-handle'
        && fixture.submissions.deadControl.publishedBatchCountBeforeCommit === 1
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

function assertFixtureStageResult(result) {
    const fixtureStage = process.env.CIRVIVOR_WEBGPU_FIXTURE_STAGE || 'full';
    if (fixtureStage === 'full') {
        assertDeadControlRaceResult(result);
        return;
    }
    if (
        fixtureStage === 'enemy-arrow-charge'
        || fixtureStage === 'actor-action-placement'
        || fixtureStage === 'r5-actor-verbs'
        || fixtureStage === 'r7-actor-payload-multiplicity'
        || fixtureStage === 'r9-overtime-pressure'
        || fixtureStage === 'r9-multi-wave'
        || fixtureStage === 'post-r5-live-bugfix'
        || fixtureStage === 'tower-group-target-query'
        || fixtureStage === 'maximum-damage-window'
        || fixtureStage === 'enemy-rhom-priority'
        || fixtureStage === 'enemy-rhom-source-death-projectile'
        || fixtureStage === 'enemy-pentagon-effect'
        || fixtureStage === 'enemy-hexa-formation'
        || fixtureStage === 'enemy-jorang-split-lineage'
        || fixtureStage === 'enemy-octagon-directional-defense'
        || fixtureStage === 'enemy-ring-projectile-capture'
        || fixtureStage === 'enemy-cork-route-closure'
        || fixtureStage === 'r6-tower-merge'
    ) {
        assertDedicatedFixtureResult(result, fixtureStage);
        return;
    }
    throw new Error(`지원하지 않는 NW WebGPU fixture stage입니다: ${fixtureStage}`);
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
    const fixtureStage = process.env.CIRVIVOR_WEBGPU_FIXTURE_STAGE || 'full';
    const runnerFileName = fixtureStage === 'r6-tower-merge'
        ? 'tower_merge_runner.js'
        : fixtureStage === 'r9-multi-wave'
            ? 'r9_multi_wave_runner.js'
        : fixtureStage === 'r9-overtime-pressure'
            ? 'r9_overtime_pressure_runner.js'
        : fixtureStage === 'tower-group-target-query'
        ? 'tower_group_target_query_runner.js'
        : fixtureStage === 'r5-actor-verbs'
            ? 'r5_actor_verbs_bootstrap.js'
        : fixtureStage === 'r7-actor-payload-multiplicity'
            ? 'r7_actor_payload_multiplicity_runner.js'
        : fixtureStage === 'post-r5-live-bugfix'
            ? 'post_r5_live_bugfix_runner.js'
        : fixtureStage === 'actor-action-placement'
            ? 'actor_action_placement_runner.js'
        : fixtureStage === 'enemy-pentagon-effect'
        ? 'enemy_pentagon_effect_runner.js'
        : fixtureStage === 'enemy-rhom-source-death-projectile'
            ? 'enemy_rhom_source_death_projectile_runner.js'
        : fixtureStage === 'enemy-hexa-formation'
            ? 'enemy_hexa_formation_runner.js'
            : fixtureStage === 'enemy-jorang-split-lineage'
                ? 'enemy_jorang_split_lineage_runner.js'
                : fixtureStage === 'enemy-octagon-directional-defense'
                    ? 'enemy_octagon_directional_defense_runner.js'
                    : fixtureStage === 'enemy-ring-projectile-capture'
                        ? 'enemy_ring_projectile_capture_runner.js'
                        : fixtureStage === 'enemy-cork-route-closure'
                            ? 'enemy_cork_route_closure_runner.js'
                        : 'runner.js';
    await linkRuntimeFile(
        path.join(harnessDirectory, runnerFileName),
        path.join(appDirectory, 'runner.js')
    );
    if (fixtureStage === 'r5-actor-verbs'
        || fixtureStage === 'r7-actor-payload-multiplicity') {
        await linkRuntimeFile(
            path.join(harnessDirectory, 'r5_actor_verbs_runner.js'),
            path.join(appDirectory, 'r5_actor_verbs_runner.js')
        );
    }
    const productionDirectory = path.join(appDirectory, 'production');
    await fs.mkdir(productionDirectory, { recursive: true });
    if (fixtureStage === 'post-r5-live-bugfix'
        || fixtureStage === 'r6-tower-merge'
        || fixtureStage === 'r9-overtime-pressure'
        || fixtureStage === 'r9-multi-wave') {
        await linkRuntimeDirectory(
            gameScriptDirectory,
            path.join(productionDirectory, 'script')
        );
    } else {
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
    const projectDirectory = path.resolve(scriptDirectory, '..', '..', 'project');
    const harnessDirectory = path.join(
        projectDirectory, '..', 'test',
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
            fs.access(path.join(
                harnessDirectory,
                'tower_group_target_query_runner.js'
            )),
            fs.access(path.join(
                harnessDirectory,
                'tower_merge_runner.js'
            )),
            fs.access(path.join(
                harnessDirectory,
                'actor_action_placement_runner.js'
            )),
            fs.access(path.join(
                harnessDirectory,
                'enemy_pentagon_effect_runner.js'
            )),
            fs.access(path.join(
                harnessDirectory,
                'enemy_rhom_source_death_projectile_runner.js'
            )),
            fs.access(path.join(
                harnessDirectory,
                'enemy_hexa_formation_runner.js'
            )),
            fs.access(path.join(
                harnessDirectory,
                'enemy_jorang_split_lineage_runner.js'
            )),
            fs.access(path.join(
                harnessDirectory,
                'enemy_octagon_directional_defense_runner.js'
            )),
            fs.access(path.join(
                harnessDirectory,
                'enemy_ring_projectile_capture_runner.js'
            )),
            fs.access(path.join(
                harnessDirectory,
                'enemy_cork_route_closure_runner.js'
            )),
            fs.access(path.join(
                harnessDirectory,
                'post_r5_live_bugfix_runner.js'
            )),
            fs.access(path.join(
                harnessDirectory,
                'r7_actor_payload_multiplicity_runner.js'
            )),
            fs.access(path.join(
                harnessDirectory,
                'r9_overtime_pressure_runner.js'
            )),
            fs.access(path.join(
                harnessDirectory,
                'r9_multi_wave_runner.js'
            )),
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
                `NW.js WebGPU capability 실행 제한시간 초과: ${RUN_TIMEOUT_MS}ms`,
                `termination=${processResult.terminationMethod}`,
                `checkpoint=${JSON.stringify(checkpoint)}`
            ].join(', '));
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
