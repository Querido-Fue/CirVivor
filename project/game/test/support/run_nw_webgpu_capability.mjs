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
    'data/object/enemy/basic_hexa_enemy_data.js',
    'data/object/enemy/basic_penta_enemy_data.js',
    'data/object/enemy/basic_rhom_attack_data.js',
    'data/object/enemy/basic_rhom_enemy_data.js',
    'data/object/enemy/basic_rhom_profile_data.js',
    'data/object/enemy/enemy_ai_data.js',
    'data/object/enemy/enemy_catalog_data.js',
    'data/object/enemy/enemy_effect_catalog_data.js',
    'data/object/enemy/enemy_formation_catalog_data.js',
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
    'module/ingame/contract/enemy_effect_contract.js',
    'module/ingame/contract/enemy_formation_contract.js',
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
    'module/ingame/object/enemy/gpu_effect_command_owner.js',
    'module/ingame/object/enemy/gpu_formation_command_owner.js',
    'module/ingame/object/enemy/gpu_enemy_spawn_adapter.js',
    'module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js',
    'module/ingame/object/enemy/hostile_attack_director.js',
    'module/ingame/object/enemy/pentagon_effect_director.js',
    'module/ingame/object/enemy/formation_runtime_director.js',
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
    'module/ingame/physics/gpu/gpu_effect_runtime_abi.js',
    'module/ingame/physics/gpu/gpu_effect_runtime_shaders.js',
    'module/ingame/physics/gpu/gpu_fixed_primitive_abi.js',
    'module/ingame/physics/gpu/gpu_formation_runtime_abi.js',
    'module/ingame/physics/gpu/gpu_formation_runtime_shaders.js',
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
        scenarioValid = fixture?.states?.trackedPoseIndependent?.entered === 1
            && fixture.states.trackedPoseIndependent.expires === 31
            && fixture.states?.fallback?.entered === 3
            && fixture.targetingPorts?.gameplayTarget?.abiVersion === 1
            && fixture.targetingPorts.gameplayTarget.recordByteSize === 16
            && fixture.targetingPorts.gameplayTarget.storageBuffersPerStage === 8
            && fixture.targetingPorts.gameplayTarget.configured === false
            && fixture.targetingPorts.trackedPoseConfigured === false
            && fixture.storageProfile?.enemyBehavior === 8
            && fixture.storageProfile?.trackedPose === 6;
    } else if (fixtureStage === 'maximum-damage-window') {
        fixture = result?.productionMaximumDamageWindow;
    } else if (fixtureStage === 'enemy-rhom-priority') {
        fixture = result?.productionEnemyRhomPriority;
        scenarioValid = result?.productionEnemyRhomPriority?.scenario
            === 'rhom-core-priority-selected-target';
    } else if (fixtureStage === 'enemy-pentagon-effect') {
        fixture = result?.productionEnemyPentagonEffect;
        scenarioValid = fixture?.scenario
                === 'penta-independent-boost-pulse-whole-tick'
            && fixture.candidateCount === 2
            && fixture.appliedInstanceCount === 2
            && fixture.eventCount === 3
            && fixture.damageChannels?.towerContact === true
            && fixture.damageChannels?.projectileTower === true
            && fixture.damageChannels?.directCore === false
            && fixture.damageChannels?.projectileCore === false
            && fixture.storageProfile?.sourceResolve === 9
            && fixture.effectStorageBuffersPerStage === 9
            && fixture.terminal?.state === 'submitted'
            && fixture.terminal?.pendingPulseProgramCount === 0
            && fixture.terminal?.pendingEffectReadbackCount === 0;
    } else if (fixtureStage === 'enemy-hexa-formation') {
        fixture = result?.productionEnemyHexaFormation;
        const chain = fixture?.chain;
        const effect = fixture?.effectTransfer;
        const motion = fixture?.motion;
        const atomicity = fixture?.atomicity;
        const hostRejected = atomicity?.hostRegistryLifecycle?.rejected;
        const hostCommitted = atomicity?.hostRegistryLifecycle?.committed;
        const presentation = fixture?.presentation;
        const terminal = fixture?.terminal;
        const replacement = fixture?.replacementReset;
        const storageEntries = Object.values(
            fixture?.storageProfile?.byEntryPoint ?? {}
        );
        scenarioValid = fixture?.scenario
                === 'hexa-independent-formation-n1-through-hx'
            && chain?.finalMemberCount === 6
            && chain.finalOccupiedSlotMask === 0x3f
            && chain.finalRotationStep >= 0
            && chain.finalRotationStep < 6
            && chain.finalRotationStep === chain.expectedRotationStep
            && chain.finalGeneration === 4
            && chain.finalGeneration === chain.expectedGeneration
            && chain.finalLineageMemberCount === 6
            && chain.expectedLineageHash > 0
            && chain.liveLineageHash === chain.expectedLineageHash
            && chain.mergeCount === 5
            && chain.consumedSourceCount === 10
            && chain.remainingSourceBodies === 0
            && chain.activeDestinationCount === 1
            && chain.reservedSlotCount === 0
            && chain.finalBounty === 10
            && chain.expectedCurrentHealthCenti > 0
            && chain.liveCurrentHealthCenti
                === chain.expectedCurrentHealthCenti
            && chain.expectedMaxHealthCenti >= chain.expectedCurrentHealthCenti
            && chain.liveMaxHealthCenti === chain.expectedMaxHealthCenti
            && chain.integerHealthParity === true
            && chain.effectRekeyParity === true
            && chain.liveRadius === chain.canonicalRadius
            && chain.liveInverseMass === chain.canonicalInverseMass
            && chain.liveWeight === chain.canonicalWeight
            && chain.liveFlowSpeed === chain.canonicalFlowSpeed
            && chain.liveBaseTowerContactDamage
                === chain.canonicalTowerContactDamage
            && chain.liveEffectiveTowerContactDamage
                === chain.expectedEffectiveTowerContactDamage
            && chain.activeBoostStackCount === 6
            && chain.activeAttackMultiplier === 1.25
            && chain.canonicalCoreImpactDamage === 1
            && effect?.beforeCount === 6
            && effect.sourceATargetCount === 1
            && effect.sourceBTargetCount === 1
            && effect.afterCount === effect.beforeCount
            && effect.preparedEffectRekeyCount === effect.beforeCount
            && effect.actualEffectRekeyCount === effect.beforeCount
            && effect.preparedEffectRekeyTotal === 16
            && effect.actualEffectRekeyTotal === 16
            && effect.finalDestinationEffectCount === effect.beforeCount
            && effect.exactIdentityPayloadParity === true
            && effect.finalExactIdentityPayloadTargetSlotParity === true
            && motion?.sameRouteOnly === true
            && motion.crossRouteRejectedPairCount > 0
            && motion.crossRouteObservedCount > 0
            && motion.noReverse === true
            && motion.reverseRejectedPairCount > 0
            && motion.reverseObservedCount > 0
            && motion.minimumVelocityDot >= -0.000001
            && Array.isArray(motion.reverseBeforeFlowFieldIndices)
            && motion.reverseBeforeFlowFieldIndices.length === 2
            && Array.isArray(motion.reverseAfterFlowFieldIndices)
            && motion.reverseAfterFlowFieldIndices.length === 2
            && motion.sdfFailClose === true
            && motion.sdfRejectedPairCount > 0
            && motion.sdfRejectedSegmentCount > 0
            && motion.gridOverflowFailClose === true
            && motion.overflowObservedBodyCount > 0
            && atomicity?.zeroPartial === true
            && atomicity.sourceCountBefore === 2
            && atomicity.sourceCountAfter === atomicity.sourceCountBefore
            && atomicity.activeEffectCountBefore === 2
            && atomicity.activeEffectCountAfter
                === atomicity.activeEffectCountBefore
            && atomicity.effectInstanceIdentityPreserved === true
            && atomicity.bountyBefore > 0
            && atomicity.bountyAfter === atomicity.bountyBefore
            && atomicity.presentationReservationCountAfter
                === atomicity.presentationReservationCountBefore
            && atomicity.noPartialSourceEffectBountySlot === true
            && hostRejected?.sourceHandleCount === 2
            && hostRejected.activeSourceCountBefore === 6
            && hostRejected.activeSourceCountAfter
                === hostRejected.activeSourceCountBefore
            && hostRejected.reservedSlotCountBefore === 0
            && hostRejected.reservedSlotCountAfter === 0
            && hostRejected.bountyBudgetBefore === 6
            && hostRejected.bountyBudgetAfter
                === hostRejected.bountyBudgetBefore
            && hostRejected.activeEffectCountBefore === 6
            && hostRejected.activeEffectCountAfter
                === hostRejected.activeEffectCountBefore
            && hostRejected.allocatorSlotCountBefore === 6
            && hostRejected.allocatorSlotCountAfter
                === hostRejected.allocatorSlotCountBefore
            && hostRejected.spawnedCount === 0
            && hostRejected.despawnedCount === 0
            && hostRejected.rejectedCount === 1
            && hostRejected.exactStateUnchanged === true
            && hostCommitted?.mergeCount === 5
            && hostCommitted.consumedSourceCount === 10
            && hostCommitted.remainingConsumedSourceCount === 0
            && hostCommitted.sourceBountyEligibleFalseCount === 10
            && hostCommitted.sourcePayout === 0
            && hostCommitted.finalBountyBudget === 10
            && hostCommitted.activeDestinationCount === 1
            && hostCommitted.finalDefinitionId === 'basic_hexa_hive_01'
            && hostCommitted.finalMemberCount === 6
            && hostCommitted.finalOccupiedSlotMask === 0x3f
            && hostCommitted.finalRotationStep === 0
            && hostCommitted.finalGeneration === 4
            && hostCommitted.finalLineageMemberCount === 6
            && hostCommitted.expectedLineageHash > 0
            && hostCommitted.liveLineageHash
                === hostCommitted.expectedLineageHash
            && hostCommitted.materializedCurrentHealthCenti
                === hostCommitted.preparedCurrentHealthCenti
            && hostCommitted.materializedMaxHealthCenti
                === hostCommitted.preparedMaxHealthCenti
            && hostCommitted.materializedRadius === hostCommitted.canonicalRadius
            && hostCommitted.materializedInverseMass
                === hostCommitted.canonicalInverseMass
            && hostCommitted.materializedFlowSpeed
                === hostCommitted.canonicalFlowSpeed
            && hostCommitted.materializedTowerContactDamage
                === hostCommitted.canonicalTowerContactDamage
            && hostCommitted.materializedCoreImpactDamage
                === hostCommitted.canonicalCoreImpactDamage
            && hostCommitted.materializedWeight === hostCommitted.canonicalWeight
            && hostCommitted.activeAllocatorSlotCount === 1
            && hostCommitted.freeAllocatorSlotCount === 5
            && Number.isInteger(hostCommitted.destinationRootSlot)
            && hostCommitted.rootSlotEvidenceCount === 5
            && hostCommitted.rootSlotReuseCount === 5
            && hostCommitted.reservedSlotCount === 0
            && hostCommitted.activeEffectCountBefore === 6
            && hostCommitted.activeEffectCountAfter === 6
            && hostCommitted.exactEffectIdentityPayloadTargetSlotParity === true
            && atomicity.abaReset === true
            && atomicity.newEpoch > atomicity.oldEpoch
            && atomicity.preArmedTransformCount === 1
            && atomicity.prePendingTransformReadbackCount === 1
            && atomicity.preActiveEffectCount === 2
            && (atomicity.preEffectActivePoolIndex === 0
                || atomicity.preEffectActivePoolIndex === 1)
            && atomicity.preAuthoritativeEffectPoolActiveCount === 2
            && atomicity.preEffectPoolInputCount === 2
            && atomicity.clearAuthoritativeEpoch > atomicity.oldEpoch
            && atomicity.clearActiveBodyCount === 0
            && atomicity.clearHostActiveFormationCount === 0
            && atomicity.clearHostActiveHxCount === 0
            && atomicity.clearHostPresentationCount === 0
            && atomicity.clearGpuResourcesReleased === true
            && atomicity.clearStagedPrepareProgramCount === 0
            && atomicity.clearPendingPrepareProgramCount === 0
            && atomicity.clearPendingPrepareReadbackCount === 0
            && atomicity.clearArmedTransformCount === 0
            && atomicity.clearPendingTransformReadbackCount === 0
            && atomicity.clearStagedEffectProgramCount === 0
            && atomicity.clearPendingEffectProgramCount === 0
            && atomicity.clearPendingEffectReadbackCount === 0
            && atomicity.clearEffectPoolAActiveCount === null
            && atomicity.clearEffectPoolBActiveCount === null
            && atomicity.newEpoch > atomicity.clearAuthoritativeEpoch
            && atomicity.staleCommitAccepted === false
            && atomicity.postStagedPrepareProgramCount === 0
            && atomicity.postPendingPrepareProgramCount === 0
            && atomicity.postPendingPrepareReadbackCount === 0
            && atomicity.postArmedTransformCount === 0
            && atomicity.postPendingTransformReadbackCount === 0
            && atomicity.postPendingEffectProgramCount === 0
            && atomicity.postPendingEffectReadbackCount === 0
            && atomicity.postActiveEffectCount === 0
            && (atomicity.postEffectActivePoolIndex === 0
                || atomicity.postEffectActivePoolIndex === 1)
            && atomicity.postAuthoritativeEffectPoolActiveCount === 0
            && atomicity.postEffectPoolInputCount === 0
            && atomicity.postEffectPoolAActiveCount === 0
            && atomicity.postEffectPoolBActiveCount === 0
            && atomicity.postFormationMemberCount === 1
            && atomicity.postFormationGeneration === 1
            && atomicity.postPresentationFlags === 0
            && atomicity.postBoostStackCount === 0
            && presentation?.occupiedCellsVisible === true
            && presentation.occupiedPixelCount > 100
            && presentation.occupiedCellSampleCount === 6
            && presentation.memberLinkSampleCount === 6
            && presentation.goldenCellSampleCount === 6
            && presentation.reservationChangedPixels === true
            && presentation.reservationPixelDelta > 0
            && presentation.reservationBodyCount > 0
            && presentation.reservationCyanPixelDelta > 0
            && presentation.reservationCyanPixelsAfter
                > presentation.reservationCyanPixelsBefore
            && presentation.hxHealthBarChangedPixels === true
            && presentation.hxHealthBarPixelDelta > 0
            && presentation.hxHealthBarRoiPixelDelta > 0
            && fixture.storageProfile?.maximum === 9
            && fixture.storageProfile?.render === 8
            && storageEntries.length > 0
            && storageEntries.every((count) => Number.isInteger(count)
                && count >= 0 && count <= 9)
            && terminal?.state === 'submitted'
            && terminal.finalFixedTick === terminal.submittedTick
            && terminal.prepareProgramCount === 0
            && terminal.terminalArmedTransformCount === 0
            && terminal.pendingPrepareProgramCount === 0
            && terminal.pendingPrepareReadbackCount === 0
            && terminal.armedTransformCount === 0
            && terminal.pendingTransformReadbackCount === 0
            && terminal.effectPulseProgramCount === 0
            && terminal.pendingEffectProgramCount === 0
            && terminal.pendingEffectReadbackCount === 0
            && replacement?.activeHxCountBefore === 1
            && replacement.activeFormationCountBefore === 1
            && replacement.activeEffectCountBefore === 6
            && (replacement.effectActivePoolIndexBefore === 0
                || replacement.effectActivePoolIndexBefore === 1)
            && replacement.authoritativeEffectPoolActiveCountBefore === 6
            && replacement.effectPoolInputCountBefore === 6
            && replacement.formationIngressOpenBefore === true
            && replacement.effectIngressOpenBefore === true
            && replacement.presentationMergePulseFlagBefore === 4
            && (replacement.presentationFlagsBefore
                & replacement.presentationMergePulseFlagBefore) === 4
            && replacement.authoritativeEpochAfter
                > replacement.authoritativeEpochBefore
            && replacement.activeBodyCountAfter === 0
            && replacement.gpuResourcesReleased === true
            && replacement.pendingPrepareProgramCountAfter === 0
            && replacement.pendingPrepareReadbackCountAfter === 0
            && replacement.armedTransformCountAfter === 0
            && replacement.pendingTransformReadbackCountAfter === 0
            && replacement.pendingEffectProgramCountAfter === 0
            && replacement.pendingEffectReadbackCountAfter === 0
            && replacement.respawnAuthoritativeEpoch
                > replacement.authoritativeEpochAfter
            && replacement.respawnGpuResourcesPresent === true
            && replacement.respawnActiveFormationCount === 1
            && replacement.respawnActiveHxCount === 0
            && replacement.respawnOldHandleCount === 0
            && replacement.respawnPresentationCount === 0
            && (replacement.respawnEffectActivePoolIndex === 0
                || replacement.respawnEffectActivePoolIndex === 1)
            && replacement.respawnAuthoritativeEffectPoolActiveCount === 0
            && replacement.respawnEffectPoolInputCount === 0
            && replacement.respawnEffectPoolAActiveCount === 0
            && replacement.respawnEffectPoolBActiveCount === 0
            && replacement.respawnFormationIngressOpen === true
            && replacement.respawnEffectIngressOpen === true
            && replacement.respawnMemberCount === 1
            && replacement.respawnGeneration === 1
            && replacement.respawnExpectedLineageHash > 0
            && replacement.respawnLiveLineageHash
                === replacement.respawnExpectedLineageHash
            && replacement.respawnPendingPrepareProgramCount === 0
            && replacement.respawnPendingPrepareReadbackCount === 0
            && replacement.respawnArmedTransformCount === 0
            && replacement.respawnPendingTransformReadbackCount === 0
            && replacement.respawnPendingEffectProgramCount === 0
            && replacement.respawnPendingEffectReadbackCount === 0
            && fixture.transformCompletionCount === 3;
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
        || fixtureStage === 'enemy-pentagon-effect'
        || fixtureStage === 'enemy-hexa-formation'
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
    const fixtureStage = process.env.CIRVIVOR_WEBGPU_FIXTURE_STAGE || 'full';
    const runnerFileName = fixtureStage === 'enemy-pentagon-effect'
        ? 'enemy_pentagon_effect_runner.js'
        : fixtureStage === 'enemy-hexa-formation'
            ? 'enemy_hexa_formation_runner.js'
            : 'runner.js';
    await linkRuntimeFile(
        path.join(harnessDirectory, runnerFileName),
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
            fs.access(path.join(
                harnessDirectory,
                'enemy_pentagon_effect_runner.js'
            )),
            fs.access(path.join(
                harnessDirectory,
                'enemy_hexa_formation_runner.js'
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
