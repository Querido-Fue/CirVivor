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
    'data/scene/game/corridor_eight_map_data.js',
    'data/scene/game/corridor_eight_wave_01_data.js',
    'data/scene/game/cork_dual_route_map_data.js',
    'data/scene/game/cork_dual_route_wave_01_data.js',
    'module/ingame/contract/camera_control_contract.js',
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
    'module/ingame/contract/gameplay_team_contract.js',
    'module/ingame/contract/player_controllable_contract.js',
    'module/ingame/contract/projectile_target_policy_contract.js',
    'module/ingame/contract/projectile_capture_contract.js',
    'module/ingame/contract/enemy_route_closure_contract.js',
    'module/ingame/contract/route_availability_contract.js',
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
    'module/ingame/object/enemy/gpu_atomic_transform_command_owner.js',
    'module/ingame/object/enemy/gpu_effect_command_owner.js',
    'module/ingame/object/enemy/gpu_formation_command_owner.js',
    'module/ingame/object/enemy/gpu_enemy_spawn_adapter.js',
    'module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js',
    'module/ingame/object/enemy/hostile_attack_director.js',
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
    'module/ingame/object/tower/gpu_tower_spawn_adapter.js',
    'module/ingame/object/tower/tower_combat_roster.js',
    'module/ingame/object/tower_core_camera_follow_target.js',
    'module/ingame/object/world_registry.js',
    'module/ingame/physics/gpu/gpu_atomic_transform_runtime_abi.js',
    'module/ingame/physics/gpu/gpu_atomic_transform_runtime_shaders.js',
    'module/ingame/physics/gpu/gpu_body_presentation_clock.js',
    'module/ingame/physics/gpu/gpu_circle_body_abi.js',
    'module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    'module/ingame/physics/gpu/gpu_collision_shaders.js',
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

function ringSameHandle(left, right) {
    return Number.isSafeInteger(left?.entityId)
        && Number.isSafeInteger(left?.incarnation)
        && left.entityId === right?.entityId
        && left.incarnation === right?.incarnation;
}

function ringVectorDistance(left, right) {
    return Math.hypot(
        Number(left?.x) - Number(right?.x),
        Number(left?.y) - Number(right?.y)
    );
}

function ringVectorLength(vector) {
    return Math.hypot(Number(vector?.x), Number(vector?.y));
}

function ringRuntimeHealthy(status) {
    const storageValues = Object.values(status?.storageProfile ?? {});
    const nonNegativeIntegerFields = [
        'activeDomainBodyCount',
        'pendingCaptureReadbackCount',
        'pendingReleaseReadbackCount',
        'pendingCaptureBatchCount',
        'pendingReleaseBatchCount',
        'preparedBatchCount',
        'armedReleaseCount',
        'stagedReleaseCount',
        'targetFixedTick',
        'sourceTick',
        'completedThroughTick',
        'lastReleaseCommittedTick',
        'runtimeStatus'
    ];
    return status?.abiVersion === 1
        && typeof status.state === 'string'
        && status.state.length > 0
        && status.requiresRecovery === false
        && status.failure === null
        && status.errorFlags === 0
        && typeof status.ingressOpen === 'boolean'
        && status.captureCapacity > 0
        && status.releasePreparationCapacity > 0
        && status.cleanupCapacity > 0
        && typeof status.commitRequested === 'boolean'
        && Number.isSafeInteger(status.sessionGeneration)
        && status.sessionGeneration > 0
        && Number.isSafeInteger(status.deviceGeneration)
        && status.deviceGeneration > 0
        && Number.isSafeInteger(status.authoritativeEpoch)
        && status.authoritativeEpoch > 0
        && nonNegativeIntegerFields.every((key) => (
            Number.isSafeInteger(status[key]) && status[key] >= 0
        ))
        && storageValues.length === 23
        && storageValues.every((value) => (
            Number.isSafeInteger(value) && value > 0 && value <= 9
        ))
        && Math.max(...storageValues) === 7;
}

function ringHeldAuditValid(audit, handle, peer, role) {
    const state = audit?.state;
    return ringSameHandle(audit?.handle, handle)
        && Number.isSafeInteger(audit.bodySlot)
        && audit.bodySlot >= 0
        && audit.capturedMirror === (role === 2)
        && audit.releaseCommitRequested === false
        && state?.role === role
        && state.phase === 1
        && state.flags === 0
        && (role === 1
            ? state.profileCode === 1 && state.policyCode === 0
            : state.profileCode === 0 && state.policyCode === 1)
        && state.selfEntityId === handle.entityId
        && state.selfIncarnation === handle.incarnation
        && state.peerEntityId === peer.entityId
        && state.peerIncarnation === peer.incarnation
        && Number.isSafeInteger(state.peerBodySlot)
        && state.peerBodySlot >= 0
        && state.capturedAtFixedTick > 0
        && state.releaseDueFixedTick === state.capturedAtFixedTick + 60
        && state.captureSequence > 0
        && state.captureSequence < 0xffffffff
        && Number.isFinite(state.capturedSpeed)
        && state.capturedSpeed > 0
        && Math.abs(Math.hypot(state.facingX, state.facingY) - 1) <= 0.0001;
}

function ringReleasedAuditValid(audit, handle) {
    const state = audit?.state;
    return ringSameHandle(audit?.handle, handle)
        && audit.capturedMirror === false
        && audit.releaseCommitRequested === false
        && state?.role === 2
        && state.phase === 0
        && state.policyCode === 1
        && state.peerBodySlot === 0xffffffff
        && state.peerEntityId === 0xffffffff
        && state.peerIncarnation === 0xffffffff
        && state.captureSequence > 0
        && state.captureSequence < 0xffffffff
        && state.facingX === 0
        && state.facingY === 0;
}

function ringFreshGpuPlaneValid(plane, handle, role) {
    const state = plane?.gpu?.state;
    const candidate = plane?.gpu?.candidate;
    return ringSameHandle(plane?.audit?.handle, handle)
        && plane.audit.bodySlot === plane.gpu.bodySlot
        && plane.audit.capturedMirror === false
        && plane.audit.releaseCommitRequested === false
        && state?.selfEntityId === handle.entityId
        && state.selfIncarnation === handle.incarnation
        && state.role === role
        && state.phase === 0
        && state.flags === 0
        && state.peerBodySlot === 0xffffffff
        && state.peerEntityId === 0xffffffff
        && state.peerIncarnation === 0xffffffff
        && state.capturedAtFixedTick === 0
        && state.releaseDueFixedTick === 0
        && state.captureSequence === 0
        && state.capturedSpeed === 0
        && (role === 1
            ? state.profileCode === 1
                && state.policyCode === 0
                && Math.abs(Math.hypot(state.facingX, state.facingY) - 1)
                    <= 0.0001
            : state.profileCode === 0
                && state.policyCode === 1
                && state.facingX === 0
                && state.facingY === 0)
        && candidate?.distanceSquaredBits === 0x7f800000
        && candidate.peerEntityId === 0xffffffff
        && candidate.peerIncarnation === 0xffffffff
        && candidate.status === 0;
}

function ringTombstoneGpuPlaneValid(plane) {
    const state = plane?.state;
    const candidate = plane?.candidate;
    return Number.isSafeInteger(plane?.bodySlot)
        && plane.bodySlot >= 0
        && state?.role === 0
        && state.phase === 0
        && state.profileCode === 0
        && state.policyCode === 0
        && state.flags === 0
        && state.selfEntityId === 0xffffffff
        && state.selfIncarnation === 0
        && state.peerBodySlot === 0xffffffff
        && state.peerEntityId === 0xffffffff
        && state.peerIncarnation === 0xffffffff
        && state.capturedAtFixedTick === 0
        && state.releaseDueFixedTick === 0
        && state.captureSequence === 0
        && state.capturedSpeed === 0
        && state.facingX === 0
        && state.facingY === 0
        && candidate?.distanceSquaredBits === 0x7f800000
        && candidate.peerEntityId === 0xffffffff
        && candidate.peerIncarnation === 0xffffffff
        && candidate.status === 0;
}

function ringTerminalSettled(terminal) {
    return terminal?.owner?.state === 'settled'
        && terminal.backend?.state === 'settled'
        && terminal.backend.failure === null
        && terminal.backend.pendingCaptureReadbackCount === 0
        && terminal.backend.pendingReleaseReadbackCount === 0
        && terminal.backend.pendingReadbackCount === 0
        && terminal.backend.pendingCompletionBatchCount === 0
        && terminal.backend.unpublishedPreparedProofCount === 0
        && terminal.backend.stagedReleaseCount === 0
        && terminal.hostCleanup?.pendingHeldDespawnCount === 0
        && terminal.hostCleanup.failure === null
        && terminal.hostCleanup.releaseCommittedExcluded === true;
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
            && fixture.storageProfile?.render === 9
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
    } else if (fixtureStage === 'enemy-jorang-split-lineage') {
        fixture = result?.productionEnemyJorangSplitLineage;
        const actual = fixture?.actualRuntime;
        const lineage = actual?.lineageRoundTrip;
        const split = lineage?.split;
        const core = lineage?.coreForfeiture;
        const delayed = lineage?.delayedReturn;
        const burst = actual?.fiveToFourPlusOne;
        const capacity = actual?.capacityRestage;
        const terminal = actual?.terminalReplacement;
        const unpublished = terminal?.unpublished;
        const published = terminal?.published;
        const replacement = terminal?.replacement;
        scenarioValid = fixture?.scenario
                === 'jorang-first-hit-split-delayed-lineage'
            && fixture.firstHit?.damageFixedPoint === 0
            && fixture.firstHit.sourceBudgetConsumed === true
            && fixture.firstHit.triggerEventCount === 1
            && fixture.firstHit.pendingRepeatDamageFixedPoint === 0
            && fixture.firstHit.pendingRepeatSourceBudgetConsumed === false
            && fixture.firstHit.pendingRepeatEventCount === 0
            && fixture.firstHit.sameTickEnterOnlyJCount === 5
            && fixture.firstHit.sameTickAdmittedCount === 5
            && fixture.firstHit.sameTickOrientedEventCount === 5
            && fixture.firstHit.sameTickPendingCount === 5
            && fixture.firstHit.sameTickConsumedSourceBudgetCount === 5
            && fixture.triggerScope?.nonClosestTriggerEventCount === 0
            && fixture.triggerScope.nonClosestPendingCount === 0
            && fixture.triggerScope.nonClosestUnchangedJHealthCount === 0
            && fixture.triggerScope.nonClosestConsumedSourceBudgetCount === 5
            && split?.publicationTick === 4
            && split.topologyId === 'ONE_TO_MANY'
            && split.sourceConsumed === true
            && split.childCount === 2
            && split.child0RootIdentity === true
            && split.child1DistinctIdentity === true
            && split.postStepPoseFlowAndVelocityConserved === true
            && split.childHealthCenti?.join(',') === '100,100'
            && split.childMaximumHealthCenti?.join(',') === '100,100'
            && split.childBountyBudgets?.join(',') === '6,6'
            && split.lineageRootPairPreserved === true
            && split.branchIndices?.join(',') === '0,1'
            && split.effectTransferDestinationIndex === 0
            && split.child0EffectInstanceCount === 1
            && split.child1EffectInstanceCount === 0
            && split.effectTargetSlotMatchesBody === true
            && split.exactEffectPayloadPreserved === true
            && split.gpuCommittedCount === 1
            && split.gpuEffectRekeyCount === 1
            && core?.impactFactCount === 1
            && core.cleanupCommitted === true
            && core.forfeitedBudget === 6
            && core.bountyEligible === false
            && core.returnedJCount === 0
            && core.coreIntegrity === 99
            && delayed?.notDuePrepareCandidateCount === 0
            && delayed.preparedAtTick === 63
            && delayed.publicationTick === 64
            && delayed.delayFixedTicks === 60
            && delayed.topologyId === 'ONE_TO_ONE_DELAYED'
            && delayed.returnedJCount === 1
            && delayed.exactRootIdentity === true
            && delayed.postStepPoseFlowVelocityPreserved === true
            && delayed.preparedHealthCenti < delayed.maximumHealthCenti
            && delayed.returnedHealthCenti
                === delayed.preparedHealthCenti + 1
            && delayed.maximumHealthCenti === 100
            && delayed.effectInstanceCount === 1
            && delayed.effectTargetSlotMatchesBody === true
            && delayed.exactEffectPayloadPreserved === true
            && delayed.bountyBudget === 6
            && delayed.gpuCommittedCount === 1
            && delayed.gpuEffectRekeyCount === 1
            && lineage.requiresRecovery === false
            && burst?.admittedFirstHitCount === 5
            && burst.firstPrepareCandidateCount === 5
            && burst.firstLifecycleTransformCount === 4
            && burst.firstGpuCommittedCount === 4
            && burst.secondPrepareCandidateCount === 1
            && burst.secondLifecycleTransformCount === 1
            && burst.secondGpuCommittedCount === 1
            && burst.sourceOrderExact === true
            && burst.hostStartsByTick?.join(',') === '4,1'
            && burst.finalCirclePrimeCount === 10
            && burst.pendingFirstHitCount === 0
            && burst.requiresRecovery === false
            && capacity?.rejectionCode === 'atomic-transform-capacity'
            && capacity.retryable === true
            && capacity.retryDisposition === 'restage-next-prepare'
            && capacity.sourcePendingPreserved === true
            && capacity.attemptConsumed === true
            && capacity.recoveryRequiredAtRejection === false
            && capacity.pendingPhasePreserved === true
            && capacity.halfChildCount === 0
            && capacity.effectInstanceCountAtRejection === 0
            && capacity.freshCommandId === true
            && capacity.freshPrepareFingerprint === true
            && capacity.retryLifecycleTransformCount === 1
            && capacity.retryGpuCommittedCount === 1
            && capacity.finalCirclePrimeCount === 2
            && capacity.requiresRecovery === false
            && unpublished?.cancelledBeforePublication === true
            && unpublished.sourceStayedPending === true
            && unpublished.lifecycleTransformCount === 0
            && unpublished.circlePrimeCount === 0
            && unpublished.gpuCommittedCount === 0
            && unpublished.ownerState === 'armed'
            && unpublished.ownerPendingPrepareCount === 0
            && unpublished.ownerPendingTransformCount === 0
            && unpublished.ownerPendingReadbackCount === 0
            && unpublished.backendState === 'submitted'
            && unpublished.backendPendingPrepareCount === 0
            && unpublished.backendPendingTransformCount === 0
            && unpublished.backendPendingReadbackCount === 0
            && unpublished.fixedCommitObserved === true
            && unpublished.lifecycleObserved === true
            && unpublished.rosterSealed === true
            && unpublished.lastFixedCommitTick === 3
            && unpublished.requiresRecovery === false
            && published?.hostPublishedBeforeClose === true
            && published.lifecycleTransformCount === 1
            && published.registryCirclePrimeCount === 2
            && published.backendCommitRequestedBeforeClose === true
            && published.gpuCommittedOnFinalSubmit === true
            && published.readbackSettled === true
            && published.bodyParityCount === 2
            && published.ownerState === 'armed'
            && published.ownerPendingPrepareCount === 0
            && published.ownerPendingTransformCount === 0
            && published.ownerPendingReadbackCount === 0
            && published.backendState === 'submitted'
            && published.backendSubmittedTick === 3
            && published.backendPendingPrepareCount === 0
            && published.backendPendingTransformCount === 0
            && published.backendPendingReadbackCount === 0
            && published.fixedCommitObserved === true
            && published.lifecycleObserved === true
            && published.rosterSealed === true
            && published.lastFixedCommitTick === 3
            && published.requiresRecovery === false
            && replacement?.sessionGenerationChanged === true
            && replacement.stalePrepareRejected === true
            && replacement.staleDiscardRejected === true
            && replacement.staleDiscardReason
                === 'atomic-transform-ingress-closed'
            && replacement.staleDiscardRequiresRecovery === false
            && replacement.freshJCount === 1
            && replacement.armedPhase === true
            && replacement.activeEffectInstanceCount === 0
            && replacement.pendingPrepareCount === 0
            && replacement.pendingTransformCount === 0
            && replacement.pendingReadbackCount === 0
            && replacement.requiresRecovery === false
            && fixture.storageProfile?.atomicTransformFirstHit === 9
            && fixture.storageProfile.requiredMaximum === 9;
    } else if (fixtureStage === 'enemy-octagon-directional-defense') {
        fixture = result?.productionEnemyOctagonDirectionalDefense;
        const contract = fixture?.contract;
        const lifecycle = fixture?.lifecycle;
        const orbit = fixture?.orbit;
        const approach = fixture?.approach;
        const facing = fixture?.facing;
        const damage = fixture?.damage;
        const protection = fixture?.protection;
        const towerLoss = fixture?.towerLoss;
        const seekTowerLoss = fixture?.seekTowerLoss;
        const terminal = fixture?.terminal;
        const replacement = fixture?.replacementReset;
        const cleanup = fixture?.cleanup;
        const storage = fixture?.storageProfile;
        const exactTowerHandle = lifecycle?.exactTowerHandle;
        const targetHandles = lifecycle?.targetHandles ?? [];
        const activeHandles = lifecycle?.activeHandles ?? [];
        const stableSlots = lifecycle?.stableSlots ?? [];
        const facingSamples = facing?.samples ?? [];
        scenarioValid = fixture?.scenario
                === 'octagon-ring-slots-directional-defense'
            && contract?.definitionId === 'basic-octa-enemy'
            && contract.capabilityMask === 0xA47
            && contract.coordinateSystemId === 'RING_SLOTS'
            && contract.coordinateSystemCode === 4
            && contract.orbitCapabilityBit === 0x800
            && contract.behaviorProgram === 3
            && contract.initialBehaviorState === 1
            && contract.behaviorState === 7
            && contract.behaviorFlag === 1 << 6
            && contract.renderShapeCode === 8
            && contract.radius === 6
            && contract.angularSpeed === 0.25
            && contract.slotCapacity === 8
            && contract.flatReductionCenti === 50
            && contract.unassignedSlot === 0xffffffff
            && JSON.stringify(contract.armoredFacetIndices)
                === JSON.stringify([7, 0, 1])
            && JSON.stringify(contract.leaseOrder)
                === JSON.stringify([0, 4, 2, 6, 1, 5, 3, 7])
            && lifecycle?.requestedCount === 3
            && lifecycle.acceptedCount === 3
            && lifecycle.uniqueHandleCount === 3
            && lifecycle.uniqueSlotCount === 3
            && JSON.stringify(stableSlots) === JSON.stringify([0, 4, 2])
            && JSON.stringify(lifecycle.allStableSlots)
                === JSON.stringify([0, 4, 2, 6, 1, 5, 3, 7])
            && activeHandles.length === 3
            && new Set(activeHandles.map(({ entityId, incarnation }) => (
                `${entityId}:${incarnation}`
            ))).size === 3
            && Number.isSafeInteger(exactTowerHandle?.entityId)
            && Number.isSafeInteger(exactTowerHandle?.incarnation)
            && targetHandles.length === 3
            && targetHandles.every(({ entityId, incarnation }) => (
                entityId === exactTowerHandle.entityId
                && incarnation === exactTowerHandle.incarnation
            ))
            && lifecycle.shortage?.reason === 'orbit-slot-capacity'
            && lifecycle.shortage.requestedCount === 2
            && lifecycle.shortage.acceptedCount === 0
            && lifecycle.shortage.activeCountBefore
                === lifecycle.shortage.activeCountAfter
            && lifecycle.shortage.reservedCountBefore === 0
            && lifecycle.shortage.reservedCountAfter === 0
            && lifecycle.shortage.slotCountBefore
                === lifecycle.shortage.slotCountAfter
            && JSON.stringify(lifecycle.shortage.consumedRetryReasons)
                === JSON.stringify(['duplicate-command', 'duplicate-command'])
            && lifecycle.shortage.recoveryRequired === false
            && lifecycle.corruptedMetadata?.code
                === 'orbit-slot-metadata-corruption'
            && lifecycle.corruptedMetadata?.recoveryRequired === true
            && lifecycle.corruptedMetadata.pendingCount === 1
            && lifecycle.corruptedMetadata.reservedCount === 0
            && lifecycle.corruptedMetadata.spawnCallCount === 0
            && orbit?.mapId === 'nw-octagon-open-orbit-authority'
            && orbit.phaseBaseQ32 === 0x80000000
            && orbit.captureSeedRadius === 5.999
            && Number.isFinite(orbit.towerPosition?.x)
            && Number.isFinite(orbit.towerPosition?.y)
            && Number.isFinite(orbit.slotZeroDesiredPosition?.x)
            && Number.isFinite(orbit.slotZeroDesiredPosition?.y)
            && orbit.slotZeroDesiredPosition.x < orbit.towerPosition.x
            && Math.abs(Math.hypot(
                orbit.slotZeroDesiredPosition.x - orbit.towerPosition.x,
                orbit.slotZeroDesiredPosition.y - orbit.towerPosition.y
            ) - 6) <= 0.001
            && Number.isFinite(orbit.slotZeroSeedPosition?.x)
            && Number.isFinite(orbit.slotZeroSeedPosition?.y)
            && Math.abs(Math.hypot(
                orbit.slotZeroSeedPosition.x - orbit.towerPosition.x,
                orbit.slotZeroSeedPosition.y - orbit.towerPosition.y
            ) - 5.999) <= 0.001
            && orbit?.sampleCount >= 3
            && Array.isArray(orbit.radiusSamples)
            && orbit.radiusSamples.length === orbit.sampleCount
            && orbit.radiusSamples.every((radius) => (
                Number.isFinite(radius) && Math.abs(radius - 6) <= 0.001
            ))
            && Array.isArray(orbit.angularStepSamples)
            && orbit.angularStepSamples.length > 0
            && orbit.angularStepSamples.every((step) => (
                Number.isFinite(step) && Math.abs(step - (0.25 / 60)) <= 0.00001
            ))
            && Number.isFinite(orbit.bodyRadius)
            && orbit.bodyRadius > 0
            && orbit.expectedFinalFlowFieldIndex === 1
            && Array.isArray(orbit.flowFieldIndexSamples)
            && orbit.flowFieldIndexSamples.length === 3
            && orbit.flowFieldIndexSamples.every((index) => index === 1)
            && Array.isArray(orbit.captureStateSamples)
            && orbit.captureStateSamples.length === 3
            && orbit.captureStateSamples.every((sample) => (
                sample?.state === 7
                && sample.flags === 65
                && sample.flowEnabled === false
            ))
            && Array.isArray(orbit.desiredPositionErrorSamples)
            && orbit.desiredPositionErrorSamples.length === 8
            && orbit.desiredPositionErrorSamples.every((error) => (
                Number.isFinite(error) && error <= 0.001
            ))
            && Array.isArray(orbit.captureSeedSquaredDistanceSamples)
            && orbit.captureSeedSquaredDistanceSamples.length === 8
            && orbit.captureSeedSquaredDistanceSamples.every((squared) => (
                Number.isFinite(squared)
                && squared > 35.98
                && squared < 36
            ))
            && Array.isArray(orbit.spawnPositionEvidence)
            && orbit.spawnPositionEvidence.length === 8
            && orbit.spawnPositionEvidence.every((sample) => (
                Number.isFinite(sample?.x)
                && Number.isFinite(sample?.y)
                && Number.isInteger(sample?.row)
                && Number.isInteger(sample?.column)
                && Number.isFinite(sample?.signedDistance)
                && sample.signedDistance > orbit.bodyRadius
            ))
            && Array.isArray(orbit.captureSeedPositionEvidence)
            && orbit.captureSeedPositionEvidence.length === 8
            && orbit.captureSeedPositionEvidence.every((sample) => (
                Number.isFinite(sample?.x)
                && Number.isFinite(sample?.y)
                && Number.isInteger(sample?.row)
                && Number.isInteger(sample?.column)
                && Number.isFinite(sample?.signedDistance)
                && sample.signedDistance > orbit.bodyRadius
            ))
            && approach?.mapId === 'nw-octagon-open-orbit-authority'
            && Number.isSafeInteger(approach.towerHandle?.entityId)
            && Number.isSafeInteger(approach.towerHandle?.incarnation)
            && Number.isSafeInteger(approach.octaHandle?.entityId)
            && Number.isSafeInteger(approach.octaHandle?.incarnation)
            && approach.initialState === 1
            && approach.initialDistance > 6
            && approach.initialFlowEnabled === true
            && approach.initialFlags === 1
            && approach.initialDefenseActive === false
            && Math.abs(approach.initialFacingLength - 1) <= 0.001
            && Math.abs(approach.initialFacingDot - 1) <= 0.001
            && approach.initialFlowFieldIndex === 0
            && Number.isInteger(approach.captureTick)
            && approach.captureTick >= 2
            && approach.captureTick <= 360
            && Number.isFinite(approach.lastOutsideDistance)
            && approach.lastOutsideDistance > 6
            && Number.isFinite(approach.preCaptureDistance)
            && approach.preCaptureDistance >= 5.9
            && approach.preCaptureDistance <= 6.05
            && Number.isFinite(approach.captureDistance)
            && approach.captureDistance >= 5.9
            && approach.captureDistance <= 6.05
            && approach.captureState === 7
            && approach.captureFlags === 65
            && approach.captureFlowEnabled === false
            && approach.captureDefenseActive === true
            && approach.captureTargetHandle?.entityId
                === approach.towerHandle.entityId
            && approach.captureTargetHandle?.incarnation
                === approach.towerHandle.incarnation
            && Number.isFinite(approach.settle?.capturePhaseError)
            && Number.isFinite(approach.settle?.nextPhaseError)
            && approach.settle.capturePhaseError > 0
            && approach.settle.nextPhaseError
                < approach.settle.capturePhaseError
            && Number.isFinite(approach.settle.angularDisplacement)
            && approach.settle.angularDisplacement > 0
            && approach.settle.angularDisplacement
                <= approach.settle.maximumAngularStep + 0.0001
            && Math.abs(approach.settle.maximumAngularStep
                - (2.5 / 60 / 6)) <= 0.00001
            && Math.abs(approach.settle.radius - 6) <= 0.001
            && facing?.byteOffsetX === 32
            && facing.byteOffsetY === 36
            && facingSamples.length >= 3
            && facingSamples.every(({ x, y, radialX, radialY }) => (
                Number.isFinite(x)
                && Number.isFinite(y)
                && Number.isFinite(radialX)
                && Number.isFinite(radialY)
                && Math.abs((x * radialX + y * radialY) + 1) <= 0.01
            ))
            && fixture.render?.visibleFacetCount === 3
            && JSON.stringify(fixture.render.visibleFacetIndices)
                === JSON.stringify([7, 0, 1])
            && fixture.render.armoredPixelCount > 0
            && fixture.render.frontArmorPixelCount > 0
            && fixture.render.rearArmorPixelCount === 0
            && Number.isFinite(fixture.render.frontArmorScore)
            && Number.isFinite(fixture.render.rearArmorScore)
            && fixture.render.frontArmorScore
                >= fixture.render.rearArmorScore + 40
            && fixture.render.frontStrongestRgba?.a > 0
            && fixture.render.rearStrongestRgba?.a > 0
            && damage?.inputDamageCenti === 100
            && damage.frontDamageCenti === 50
            && (damage.frontEventFlags & (1 << 14)) !== 0
            && damage.frontBoundaryDamageCenti === 50
            && damage.frontBoundaryInsideDamageCenti === 50
            && damage.frontBoundaryOutsideDamageCenti === 100
            && (damage.frontBoundaryInsideEventFlags & (1 << 14)) !== 0
            && (damage.frontBoundaryOutsideEventFlags & (1 << 14)) === 0
            && damage.rearDamageCenti === 100
            && (damage.rearEventFlags & (1 << 14)) === 0
            && damage.sideDamageCenti === 100
            && (damage.sideEventFlags & (1 << 14)) === 0
            && damage.zeroDirectionDamageCenti === 100
            && (damage.zeroDirectionEventFlags & (1 << 14)) === 0
            && Number.isFinite(damage.zeroDirectionPredictedDeltaSquared)
            && damage.zeroDirectionPredictedDeltaSquared === 0
            && damage.zeroDirectionIsolationFlowSpeed === 0
            && damage.zeroDirectionSourceVelocity?.x === 0
            && damage.zeroDirectionSourceVelocity?.y === 0
            && damage.zeroDirectionTargetVelocity?.x === 0
            && damage.zeroDirectionTargetVelocity?.y === 0
            && damage.returningOriginDamageCenti === 100
            && damage.fullyAbsorbedInputCenti === 50
            && damage.fullyAbsorbedAppliedCenti === 0
            && damage.fullyAbsorbedBudgetBefore === 1
            && damage.fullyAbsorbedBudgetAfter === 0
            && damage.friendlyBudgetBefore > 0
            && damage.friendlyBudgetBefore === damage.friendlyBudgetAfter
            && damage.friendlyDamageEventCount === 0
            && damage.staleBudgetBefore > 0
            && damage.staleBudgetBefore === damage.staleBudgetAfter
            && Number.isSafeInteger(damage.staleOldHandle?.entityId)
            && Number.isSafeInteger(damage.staleOldHandle?.incarnation)
            && damage.staleReplacementHandle?.entityId
                === damage.staleOldHandle.entityId
            && damage.staleReplacementHandle?.incarnation
                !== damage.staleOldHandle.incarnation
            && damage.staleRejectionCode === 'stale-handle'
            && damage.staleRejectionCount === 1
            && damage.staleEventCount === 0
            && damage.staleRecoveryRequired === false
            && damage.absorbedDamageEventCount === 1
            && damage.absorbedEventValueFixedPoint === 0
            && (damage.absorbedEventFlags & (1 << 14)) !== 0
            && (damage.absorbedEventFlags & (1 << 11)) !== 0
            && (damage.absorbedEventFlags & (1 << 13)) === 0
            && (damage.absorbedEventFlags & (1 << 8)) === 0
            && Number.isSafeInteger(damage.absorbedSourceHandle?.entityId)
            && Number.isSafeInteger(damage.absorbedSourceHandle?.incarnation)
            && Number.isSafeInteger(damage.absorbedTargetHandle?.entityId)
            && Number.isSafeInteger(damage.absorbedTargetHandle?.incarnation)
            && Number.isSafeInteger(damage.shieldRearTargetHandle?.entityId)
            && Number.isSafeInteger(damage.shieldRearTargetHandle?.incarnation)
            && damage.shieldRearTargetHealthBeforeCenti
                === damage.shieldRearTargetHealthAfterCenti
            && damage.shieldRearTargetDamageEventCount === 0
            && Number.isFinite(damage.contactSeparation)
            && Number.isFinite(damage.contactRadiusSum)
            && damage.contactSeparation > 0
            && damage.contactSeparation < damage.contactRadiusSum
            && Number.isFinite(damage.shieldRearTargetContactDistance)
            && Number.isFinite(damage.shieldRearTargetContactRadiusSum)
            && damage.shieldRearTargetContactDistance > 0
            && damage.shieldRearTargetContactDistance
                < damage.shieldRearTargetContactRadiusSum
            && damage.contactSeparation
                < damage.shieldRearTargetContactDistance
            && Number.isFinite(damage.shieldSourceOctaDistanceAfter)
            && Number.isFinite(damage.shieldSourceRearDistanceAfter)
            && damage.shieldSourceOctaDistanceAfter
                < damage.contactRadiusSum
            && damage.shieldSourceRearDistanceAfter
                < damage.shieldRearTargetContactRadiusSum
            && damage.shieldSourceOctaDistanceAfter
                < damage.shieldSourceRearDistanceAfter
            && Number.isFinite(damage.damageCaptureSeedSquaredDistance)
            && damage.damageCaptureSeedSquaredDistance > 35.98
            && damage.damageCaptureSeedSquaredDistance < 36
            && damage.damageCaptureState === 7
            && damage.damageCaptureFlags === 65
            && Math.abs(damage.contactSeparation - 0.1) <= 0.00001
            && Math.abs(
                damage.shieldRearTargetContactDistance - 0.75
            ) <= 0.00001
            && Math.abs(damage.shieldOctaRearDistance - 0.65) <= 0.00001
            && damage.shieldEnemyPairCollisionRadiusScale === 0.8
            && Number.isFinite(damage.shieldEnemyPairCollisionRadius)
            && damage.shieldOctaRearDistance
                > damage.shieldEnemyPairCollisionRadius
            && Number.isFinite(damage.shieldOctaRearDistanceAfter)
            && damage.shieldOctaRearDistanceAfter
                > damage.shieldEnemyPairCollisionRadius
            && Array.isArray(damage.mapIds)
            && damage.mapIds.length === 10
            && damage.mapIds.every((mapId) => (
                mapId === 'nw-octagon-open-orbit-authority'
            ))
            && protection?.mapId === 'nw-octagon-open-orbit-authority'
            && protection.physicalShieldDisplacementCenti > 0
            && protection.towerPushDisplacementCenti > 0
            && protection.towerContactDamageCenti > 0
            && towerLoss?.modeBefore === 'ORBIT_TOWER'
            && towerLoss.modeAfter === 'CORE_FALLBACK'
            && towerLoss.latchedMode === 'CORE_FALLBACK'
            && Number.isSafeInteger(towerLoss.towerHandleBefore?.entityId)
            && Number.isSafeInteger(towerLoss.towerHandleBefore?.incarnation)
            && Number.isSafeInteger(towerLoss.replacementTowerHandle?.entityId)
            && Number.isSafeInteger(
                towerLoss.replacementTowerHandle?.incarnation
            )
            && (
                towerLoss.replacementTowerHandle.entityId
                    !== towerLoss.towerHandleBefore.entityId
                || towerLoss.replacementTowerHandle.incarnation
                    !== towerLoss.towerHandleBefore.incarnation
            )
            && towerLoss.targetHandleAfter === null
            && Number.isInteger(towerLoss.orbitSlotBefore)
            && towerLoss.orbitSlotAfter === towerLoss.orbitSlotBefore
            && towerLoss.coreDistanceAfter < towerLoss.coreDistanceBefore
            && towerLoss.defenseActiveAfter === false
            && towerLoss.flowEnabledAfter === true
            && towerLoss.reorbitAttemptCount === 0
            && towerLoss.recoveryRequired === false
            && seekTowerLoss?.mapId === 'nw-octagon-open-orbit-authority'
            && seekTowerLoss.modeBefore === 'SEEK_TOWER'
            && seekTowerLoss.modeAfter === 'CORE_FALLBACK'
            && seekTowerLoss.latchedMode === 'CORE_FALLBACK'
            && Number.isSafeInteger(seekTowerLoss.towerHandleBefore?.entityId)
            && Number.isSafeInteger(seekTowerLoss.towerHandleBefore?.incarnation)
            && Number.isSafeInteger(
                seekTowerLoss.replacementTowerHandle?.entityId
            )
            && Number.isSafeInteger(
                seekTowerLoss.replacementTowerHandle?.incarnation
            )
            && (
                seekTowerLoss.replacementTowerHandle.entityId
                    !== seekTowerLoss.towerHandleBefore.entityId
                || seekTowerLoss.replacementTowerHandle.incarnation
                    !== seekTowerLoss.towerHandleBefore.incarnation
            )
            && seekTowerLoss.targetHandleAfter === null
            && seekTowerLoss.defenseActiveAfter === false
            && seekTowerLoss.flowEnabledAfter === true
            && seekTowerLoss.coreDistanceAfter
                < seekTowerLoss.coreDistanceBefore
            && seekTowerLoss.recoveryRequired === false
            && terminal?.mapId === 'nw-octagon-open-orbit-authority'
            && terminal.activeCountBefore > 0
            && terminal.activeCountAfter === 0
            && terminal.reservedCountAfter === 0
            && terminal.pendingLifecycleCountAfter === 0
            && replacement?.mapId === 'nw-octagon-open-orbit-authority'
            && replacement.oldSessionGeneration > 0
            && replacement.newSessionGeneration
                > replacement.oldSessionGeneration
            && replacement.oldHandleCountAfter === 0
            && replacement.oldRegistryDestroyed === true
            && replacement.oldRegistryActiveCountAfter === 0
            && replacement.oldRegistryReservedCountAfter === 0
            && replacement.freshActiveCountBeforeAuthor === 0
            && replacement.freshReservedCountBeforeAuthor === 0
            && replacement.freshOrbitSlotCountBeforeAuthor === 0
            && replacement.freshRawOrbitSlotBefore === 0xffffffff
            && replacement.freshRawBehaviorSlotBefore === 0xffffffff
            && Number.isSafeInteger(replacement.freshHandle?.entityId)
            && Number.isSafeInteger(replacement.freshHandle?.incarnation)
            && replacement.freshOrbitSlotAfter === 0
            && replacement.activeCountAfterAuthor === 1
            && replacement.reservedCountAfterAuthor === 0
            && replacement.orbitSlotCountAfterAuthor === 1
            && cleanup?.mapId === 'nw-octagon-open-orbit-authority'
            && cleanup.despawnRequestedCount === 3
            && cleanup.despawnedCount === 3
            && cleanup.activeCountAfter === 0
            && cleanup.reservedCountAfter === 0
            && cleanup.orbitSlotCountAfter === 0
            && storage?.classifier === 8
            && storage.behavior === 8
            && storage.render === 9
            && storage.contactHandling === 9
            && storage.maximum === 9;
    } else if (fixtureStage === 'enemy-ring-projectile-capture') {
        fixture = result?.productionEnemyRingProjectileCapture;
        const actual = fixture?.actualRuntime;
        const funnel = actual?.funnelAndMutualSelection;
        const inside = funnel?.inside;
        const boundary = funnel?.boundary;
        const outside = funnel?.outside;
        const oneCaptor = funnel?.oneCaptorTwoProjectiles;
        const twoCaptors = funnel?.twoCaptorsOneProjectile;
        const tower = actual?.heldTowerRelease;
        const forward = actual?.forwardReleaseNoCore;
        const death = actual?.captorDeath;
        const core = actual?.captorCoreImpact;
        const expiry = actual?.heldProjectileExpiry;
        const terminal = actual?.terminalReplacement;
        const unpublished = terminal?.unpublished;
        const published = terminal?.published;
        const replacement = terminal?.replacement;
        const reuse = actual?.capturePlaneSlotReuse;
        const coexistence = actual?.coexistence;
        const positiveProofs = (values) => values.every((value) => (
            Number.isSafeInteger(value) && value > 0 && value < 0xffffffff
        ));
        const coherentReleaseProof = (preparation, lifecycle, completion) => (
            preparation?.batchIdFingerprint === lifecycle?.batchIdFingerprint
            && lifecycle.batchIdFingerprint
                === completion?.batchIdFingerprint
            && preparation.prepareFingerprint === lifecycle.prepareFingerprint
            && lifecycle.prepareFingerprint === completion.prepareFingerprint
            && lifecycle.commandIdFingerprint
                === completion.commandIdFingerprint
        );
        const capturePair = (record, captor, projectile) => (
            ringSameHandle(record?.captorHandle, captor)
            && ringSameHandle(record?.projectileHandle, projectile)
            && Number.isSafeInteger(record.captureSequence)
            && record.captureSequence > 0
            && record.captureSequence < 0xffffffff
        );
        const noDamageEvents = (events) => Array.isArray(events)
            && events.every((event) => (
                Number(event?.damageFixedPoint) === 0
            ));
        const funnelValid = inside?.angleRadians === 0
            && Math.abs(boundary?.angleRadians - (Math.PI / 4)) <= 1e-12
            && outside?.angleRadians > Math.PI / 4
            && inside.captureRecords?.length === 1
            && boundary.captureRecords?.length === 1
            && outside.captureRecords?.length === 0
            && capturePair(
                inside.captureRecords[0],
                inside.captorHandle,
                inside.projectileHandle
            )
            && capturePair(
                boundary.captureRecords[0],
                boundary.captorHandle,
                boundary.projectileHandle
            )
            && ringHeldAuditValid(
                inside.projectileAudit,
                inside.projectileHandle,
                inside.captorHandle,
                2
            )
            && ringHeldAuditValid(
                boundary.projectileAudit,
                boundary.projectileHandle,
                boundary.captorHandle,
                2
            )
            && outside.projectileAudit?.capturedMirror === false
            && outside.projectileAudit?.state?.role === 2
            && outside.projectileAudit?.state?.phase === 0
            && outside.projectileAudit?.state?.captureSequence === 0
            && ringRuntimeHealthy(inside.runtimeStatus)
            && ringRuntimeHealthy(boundary.runtimeStatus)
            && ringRuntimeHealthy(outside.runtimeStatus)
            && oneCaptor?.captureRecords?.length === 1
            && oneCaptor.capturedProjectileCount === 1
            && oneCaptor.projectileHandles?.length === 2
            && capturePair(
                oneCaptor.captureRecords[0],
                oneCaptor.captorHandle,
                oneCaptor.projectileHandles[0]
            )
            && !ringSameHandle(
                oneCaptor.captureRecords[0].projectileHandle,
                oneCaptor.projectileHandles[1]
            )
            && twoCaptors?.captureRecords?.length === 1
            && twoCaptors.capturedProjectileCount === 1
            && twoCaptors.captorHandles?.length === 2
            && capturePair(
                twoCaptors.captureRecords[0],
                twoCaptors.captorHandles[0],
                twoCaptors.projectileHandle
            )
            && !ringSameHandle(
                twoCaptors.captureRecords[0].captorHandle,
                twoCaptors.captorHandles[1]
            );
        const towerProofs = [
            tower?.releasePreparation?.batchIdFingerprint,
            tower?.releasePreparation?.prepareFingerprint,
            tower?.lifecycleRelease?.commandIdFingerprint,
            tower?.lifecycleRelease?.batchIdFingerprint,
            tower?.lifecycleRelease?.prepareFingerprint,
            tower?.releaseCompletion?.commandIdFingerprint,
            tower?.releaseCompletion?.batchIdFingerprint,
            tower?.releaseCompletion?.prepareFingerprint
        ];
        const towerVelocity = tower?.releasedProjectileBody?.velocity;
        const towerFacing = tower?.releasePreparation?.facing;
        const towerOriginExact = tower?.metadataBefore?.origin
            && tower?.metadataAfter?.origin
            && JSON.stringify(tower.metadataBefore.origin)
                === JSON.stringify(tower.metadataAfter.origin);
        const towerReleaseFields = tower?.metadataAfter?.releaseFields;
        const towerValid = tower?.withTower === true
            && capturePair(
                tower.captureRecord,
                tower.captorHandle,
                tower.projectileHandle
            )
            && capturePair(
                tower.releasePreparation,
                tower.captorHandle,
                tower.projectileHandle
            )
            && capturePair(
                tower.lifecycleRelease,
                tower.captorHandle,
                tower.projectileHandle
            )
            && capturePair(
                tower.releaseCompletion,
                tower.captorHandle,
                tower.projectileHandle
            )
            && tower.releasePreparation.releaseReason === 1
            && tower.lifecycleRelease.releaseReason === 1
            && tower.releaseCompletion.releaseReason === 1
            && tower.releasePreparation.targetSelector === 1
            && ringSameHandle(
                tower.releasePreparation.targetHandle,
                tower.towerHandle
            )
            && ringSameHandle(
                tower.lifecycleRelease.targetHandle,
                tower.towerHandle
            )
            && ringSameHandle(
                tower.releaseCompletion.targetHandle,
                tower.towerHandle
            )
            && tower.releasePreparation.releaseDueFixedTick
                === tower.captureRecord.capturedAtFixedTick + 60
            && tower.lifecycleRelease.prepareSourceTick
                === tower.releasePreparation.prepareSourceTick
            && tower.lifecycleRelease.backendCommitRequested === true
            && positiveProofs(towerProofs)
            && coherentReleaseProof(
                tower.releasePreparation,
                tower.lifecycleRelease,
                tower.releaseCompletion
            )
            && ringHeldAuditValid(
                tower.capturedCaptorAudit,
                tower.captorHandle,
                tower.projectileHandle,
                1
            )
            && ringHeldAuditValid(
                tower.capturedProjectileAudit,
                tower.projectileHandle,
                tower.captorHandle,
                2
            )
            && ringHeldAuditValid(
                tower.heldCaptorAudit,
                tower.captorHandle,
                tower.projectileHandle,
                1
            )
            && ringHeldAuditValid(
                tower.heldProjectileAudit,
                tower.projectileHandle,
                tower.captorHandle,
                2
            )
            && ringReleasedAuditValid(
                tower.releasedProjectileAudit,
                tower.projectileHandle
            )
            && ringVectorDistance(
                tower.capturedCaptorBody.position,
                tower.capturedProjectileBody.position
            ) <= 0.0001
            && ringVectorDistance(
                tower.heldCaptorBody.position,
                tower.heldProjectileBody.position
            ) <= 0.0001
            && ringVectorDistance(
                tower.capturedCaptorBody.position,
                tower.heldCaptorBody.position
            ) > 0
            && ringVectorLength(tower.capturedProjectileBody.velocity) === 0
            && ringVectorLength(tower.heldProjectileBody.velocity) === 0
            && Math.abs(
                ringVectorLength(tower.preCaptureProjectileBody.velocity)
                    - tower.capturedProjectileAudit.state.capturedSpeed
            ) <= 0.0001
            && tower.capturedProjectileBody.gridIndex === -1
            && tower.heldProjectileBody.gridIndex === -1
            && (tower.capturedProjectileBody.simulationMeta & 32) !== 0
            && (tower.heldProjectileBody.simulationMeta & 32) !== 0
            && tower.capturedProjectileBody.lifetime
                < tower.preCaptureProjectileBody.lifetime
            && tower.heldProjectileBody.lifetime
                < tower.capturedProjectileBody.lifetime
            && tower.capturedProjectileBody.healthFixedPoint
                === tower.preCaptureProjectileBody.healthFixedPoint
            && tower.heldProjectileBody.healthFixedPoint
                === tower.capturedProjectileBody.healthFixedPoint
            && noDamageEvents(tower.captureTickEvents)
            && tower.render?.centerAlpha === 0
            && tower.render.ringBandAlpha > 0
            && ringVectorDistance(
                tower.releasedCaptorBody.position,
                tower.releasedProjectileBody.position
            ) >= tower.releasedCaptorBody.radius
                + tower.releasedProjectileBody.radius
            && Math.abs(
                ringVectorLength(towerVelocity)
                    - tower.releasePreparation.capturedSpeed
            ) <= 0.0001
            && Math.abs(
                (towerVelocity.x * towerFacing.x)
                    + (towerVelocity.y * towerFacing.y)
                    - tower.releasePreparation.capturedSpeed
            ) <= 0.0001
            && towerOriginExact
            && ringSameHandle(
                tower.metadataBefore.handle,
                tower.projectileHandle
            )
            && ringSameHandle(
                tower.metadataAfter.handle,
                tower.projectileHandle
            )
            && tower.metadataBefore.kindId === 'projectile'
            && tower.metadataAfter.kindId === 'projectile'
            && tower.metadataAfter.definitionId
                === tower.metadataBefore.definitionId
            && tower.metadataBefore.origin.schemaVersion === 1
            && tower.metadataAfter.metadataRevision
                === tower.metadataBefore.metadataRevision + 1
            && tower.lifecycleRelease.metadataRevision
                === tower.metadataAfter.metadataRevision
            && towerReleaseFields?.teamId === 2
            && towerReleaseFields.allegiancePolicy === 'fixed-hostile'
            && towerReleaseFields.damagePolicyId === 0
            && towerReleaseFields.ownerEntityId === tower.captorHandle.entityId
            && towerReleaseFields.ownerIncarnation
                === tower.captorHandle.incarnation
            && towerReleaseFields.sourceEntityId === tower.captorHandle.entityId
            && towerReleaseFields.sourceIncarnation
                === tower.captorHandle.incarnation
            && towerReleaseFields.targetEntityId === tower.towerHandle.entityId
            && towerReleaseFields.targetIncarnation
                === tower.towerHandle.incarnation
            && towerReleaseFields.targetPolicyId
                === 'player-damageable-and-terrain'
            && towerReleaseFields.projectileCapturePolicyId === 'capturable'
            && tower.finalDirectorStatus?.capturedProjectileCount === 0
            && ringRuntimeHealthy(tower.finalRuntimeStatus);
        const forwardVelocity = forward?.releasedProjectileBody?.velocity;
        const forwardFacing = forward?.releasePreparation?.facing;
        const forwardFields = forward?.metadataAfter?.releaseFields;
        const forwardValid = forward?.withTower === false
            && forward.towerHandle === null
            && Number.isSafeInteger(forward.coreProxyHandle?.entityId)
            && Number.isSafeInteger(forward.coreProxyHandle?.incarnation)
            && forward.releasePreparation?.releaseReason === 1
            && forward.releasePreparation.targetSelector === 0
            && forward.releasePreparation.targetHandle === null
            && forward.lifecycleRelease?.targetHandle === null
            && forward.releaseCompletion?.targetHandle === null
            && forwardFields?.targetEntityId === null
            && forwardFields.targetIncarnation === null
            && forwardFields.targetPolicyId
                === 'player-damageable-and-terrain'
            && Math.abs(
                ringVectorLength(forwardVelocity)
                    - forward.releasePreparation.capturedSpeed
            ) <= 0.0001
            && Math.abs(
                (forwardVelocity.x * forwardFacing.x)
                    + (forwardVelocity.y * forwardFacing.y)
                    - forward.releasePreparation.capturedSpeed
            ) <= 0.0001
            && !ringSameHandle(
                forward.releasePreparation.targetHandle,
                forward.coreProxyHandle
            )
            && JSON.stringify(forward.metadataBefore?.origin)
                === JSON.stringify(forward.metadataAfter?.origin)
            && ringReleasedAuditValid(
                forward.releasedProjectileAudit,
                forward.projectileHandle
            )
            && forward.finalDirectorStatus?.capturedProjectileCount === 0
            && ringRuntimeHealthy(forward.finalRuntimeStatus);
        const deathEventExact = death?.eventEvidence?.some((event) => (
            event?.type === 'death'
            && event.entityId === death.captorHandle.entityId
            && event.incarnation === death.captorHandle.incarnation
        ));
        const coreEvent = core?.eventEvidence?.find((event) => {
            const subject = {
                entityId: event?.entityId,
                incarnation: event?.incarnation
            };
            return event?.type === 'contact'
                && event.eventType === 'interaction-enter'
                && event.disposition === 'applied'
                && (ringSameHandle(subject, core.captorHandle)
                    && ringSameHandle(event.other, core.interventionHandle)
                    || ringSameHandle(subject, core.interventionHandle)
                        && ringSameHandle(event.other, core.captorHandle));
        });
        const exitReleaseValid = (value, reason) => capturePair(
            value?.captureRecord,
            value?.captorHandle,
            value?.projectileHandle
        )
            && capturePair(
                value?.releasePreparation,
                value?.captorHandle,
                value?.projectileHandle
            )
            && capturePair(
                value?.lifecycleRelease,
                value?.captorHandle,
                value?.projectileHandle
            )
            && capturePair(
                value?.releaseCompletion,
                value?.captorHandle,
                value?.projectileHandle
            )
            && value.releasePreparation.releaseReason === reason
            && value.releasePreparation.targetSelector === 0
            && value.releasePreparation.targetHandle === null
            && value.lifecycleRelease.releaseReason === reason
            && value.lifecycleRelease.targetHandle === null
            && value.lifecycleRelease.backendCommitRequested === true
            && value.releaseCompletion.releaseReason === reason
            && value.releaseCompletion.targetHandle === null
            && positiveProofs([
                value.releasePreparation.batchIdFingerprint,
                value.releasePreparation.prepareFingerprint,
                value.lifecycleRelease.commandIdFingerprint,
                value.lifecycleRelease.batchIdFingerprint,
                value.lifecycleRelease.prepareFingerprint,
                value.releaseCompletion.commandIdFingerprint,
                value.releaseCompletion.batchIdFingerprint,
                value.releaseCompletion.prepareFingerprint
            ])
            && coherentReleaseProof(
                value.releasePreparation,
                value.lifecycleRelease,
                value.releaseCompletion
            )
            && ringReleasedAuditValid(
                value.releasedAudit,
                value.projectileHandle
            )
            && Math.abs(
                ringVectorLength(value.releasedBody.velocity)
                    - value.releasePreparation.capturedSpeed
            ) <= 0.0001
            && Math.abs(
                (value.releasedBody.velocity.x
                    * value.releasePreparation.facing.x)
                + (value.releasedBody.velocity.y
                    * value.releasePreparation.facing.y)
                - value.releasePreparation.capturedSpeed
            ) <= 0.0001
            && value.capturedProjectileCount === 0
            && value.registryHasCaptor === false
            && value.registryHasProjectile === true
            && value.recoveryRequired === false;
        const exitValid = exitReleaseValid(death, 2)
            && deathEventExact === true
            && exitReleaseValid(core, 3)
            && coreEvent
            && coreEvent.sourceTick === core.releasePreparation.prepareSourceTick
            && coreEvent.sessionGeneration
                === core.directorBinding?.sessionGeneration
            && coreEvent.deviceGeneration === core.directorBinding?.deviceGeneration
            && coreEvent.authoritativeEpoch
                === core.directorBinding?.authoritativeEpoch;
        const expiryValid = capturePair(
            expiry?.captureRecord,
            expiry?.captorHandle,
            expiry?.projectileHandle
        )
            && capturePair(
                expiry?.cleanupRecord,
                expiry?.captorHandle,
                expiry?.projectileHandle
            )
            && ringHeldAuditValid(
                expiry?.heldAudit,
                expiry?.projectileHandle,
                expiry?.captorHandle,
                2
            )
            && expiry.heldBody.lifetime > 0
            && expiry.cleanupRecord.releaseReason === 0
            && expiry.lifecycleReleaseCount === 0
            && expiry.capturedProjectileCount === 0
            && expiry.registryHasProjectile === false
            && noDamageEvents(expiry.eventEvidence)
            && expiry.recoveryRequired === false;
        const unpublishedValid = unpublished?.afterBody === null
            && unpublished.lifecycleReleaseCount === 0
            && unpublished.registryHasProjectile === false
            && unpublished.beforeAudit?.capturedMirror === true
            && unpublished.terminalBoundary?.releasePreparationCount === 0
            && unpublished.terminalBoundary?.releaseCompletionCount === 0
            && unpublished.terminal?.hostCleanup?.requestedHeldDespawnCount === 1
            && unpublished.terminal.hostCleanup.completedHeldDespawnCount === 1
            && unpublished.directorStatus?.capturedProjectileCount === 0
            && unpublished.directorStatus.terminal?.reason === 'core-depleted'
            && unpublished.directorStatus.terminal?.cleanupRequestedCount === 1
            && unpublished.directorStatus.terminal.publishedReleaseCount === 0
            && unpublished.directorStatus.terminal.rosterSealed === true
            && ringTerminalSettled(unpublished.terminal)
            && ringRuntimeHealthy(unpublished.runtimeStatus);
        const publishedValid = published?.lifecycleReleaseCount === 1
            && published.registryHasProjectile === true
            && published.projectileBody
            && ringReleasedAuditValid(
                published.projectileAudit,
                published.projectileHandle
            )
            && published.terminalBoundary?.releaseCompletionCount === 1
            && published.terminal?.hostCleanup?.requestedHeldDespawnCount === 0
            && published.terminal.hostCleanup.completedHeldDespawnCount === 0
            && published.directorStatus?.capturedProjectileCount === 0
            && published.directorStatus.terminal?.reason === 'core-depleted'
            && published.directorStatus.terminal?.cleanupRequestedCount === 0
            && published.directorStatus.terminal.publishedReleaseCount === 1
            && published.directorStatus.terminal.rosterSealed === true
            && ringTerminalSettled(published.terminal)
            && ringRuntimeHealthy(published.runtimeStatus);
        const replacementValid = replacement?.oldSessionGeneration > 0
            && replacement.newSessionGeneration
                > replacement.oldSessionGeneration
            && replacement.staleRequest?.accepted === false
            && replacement.staleRequest.reason
                === 'projectile-capture-release-ingress-revoked'
            && replacement.staleRequest.requiresRecovery === false
            && replacement.staleDiscard?.accepted === false
            && replacement.staleDiscard.reason
                === 'projectile-capture-release-ingress-revoked'
            && replacement.staleDiscard.requiresRecovery === false
            && replacement.staleTerminalCleanup?.accepted === false
            && replacement.staleTerminalCleanup.reason
                === 'projectile-capture-terminal-cleanup-rejected'
            && replacement.staleTerminalCleanup.requiresRecovery === false
            && ringSameHandle(
                replacement.oldCaptorHandle,
                replacement.newCaptorHandle
            )
            && ringSameHandle(
                replacement.oldProjectileHandle,
                replacement.newProjectileHandle
            )
            && capturePair(
                replacement.captureRecord,
                replacement.newCaptorHandle,
                replacement.newProjectileHandle
            )
            && replacement.capturedProjectileCount === 1
            && ringRuntimeHealthy(replacement.runtimeStatus)
            && replacement.recoveryRequired === false;
        const reusedSlots = reuse?.replacementMaterialization?.reusedSlots;
        const reuseValid = ringFreshGpuPlaneValid(
            reuse?.oldMaterialization?.ring,
            reuse?.oldRingHandle,
            1
        )
            && ringFreshGpuPlaneValid(
                reuse?.oldMaterialization?.projectile,
                reuse?.oldProjectileHandle,
                2
            )
            && reuse.oldHeld?.ring?.gpu?.state?.phase === 1
            && reuse.oldHeld.projectile?.gpu?.state?.phase === 1
            && reuse.oldHeld.ring.gpu.state.captureSequence === 1
            && reuse.oldHeld.projectile.gpu.state.captureSequence === 1
            && reuse.oldHeld.ring.gpu.candidate.peerEntityId
                === reuse.oldProjectileHandle.entityId
            && reuse.oldHeld.ring.gpu.candidate.peerIncarnation
                === reuse.oldProjectileHandle.incarnation
            && reuse.oldHeld.projectile.gpu.candidate.peerEntityId
                === reuse.oldRingHandle.entityId
            && reuse.oldHeld.projectile.gpu.candidate.peerIncarnation
                === reuse.oldRingHandle.incarnation
            && reuse.oldHeld.projectile.gpu.candidate.status !== 0
            && ringTombstoneGpuPlaneValid(reuse.tombstones?.ring)
            && ringTombstoneGpuPlaneValid(reuse.tombstones?.projectile)
            && ringFreshGpuPlaneValid(
                reuse.replacementMaterialization?.ring,
                reuse.newRingHandle,
                1
            )
            && ringFreshGpuPlaneValid(
                reuse.replacementMaterialization?.projectile,
                reuse.newProjectileHandle,
                2
            )
            && Array.isArray(reuse.oldSlots)
            && Array.isArray(reusedSlots)
            && JSON.stringify(reuse.oldSlots) === JSON.stringify(reusedSlots)
            && !ringSameHandle(reuse.oldRingHandle, reuse.newRingHandle)
            && !ringSameHandle(
                reuse.oldProjectileHandle,
                reuse.newProjectileHandle
            )
            && capturePair(
                reuse.replacementCaptureRecord,
                reuse.newRingHandle,
                reuse.newProjectileHandle
            )
            && reuse.replacementCaptureRecord.captureSequence === 1
            && reuse.replacementHeld?.ring?.gpu?.state?.captureSequence === 1
            && reuse.replacementHeld?.projectile?.gpu?.state
                ?.captureSequence === 1
            && reuse.replacementHeld.ring.gpu.state.peerEntityId
                === reuse.newProjectileHandle.entityId
            && reuse.replacementHeld.ring.gpu.state.peerIncarnation
                === reuse.newProjectileHandle.incarnation
            && reuse.replacementHeld.projectile.gpu.state.peerEntityId
                === reuse.newRingHandle.entityId
            && reuse.replacementHeld.projectile.gpu.state.peerIncarnation
                === reuse.newRingHandle.incarnation
            && reuse.replacementHeld.ring.gpu.candidate.peerEntityId
                === reuse.newProjectileHandle.entityId
            && reuse.replacementHeld.ring.gpu.candidate.peerIncarnation
                === reuse.newProjectileHandle.incarnation
            && reuse.replacementHeld.projectile.gpu.candidate.peerEntityId
                === reuse.newRingHandle.entityId
            && reuse.replacementHeld.projectile.gpu.candidate.peerIncarnation
                === reuse.newRingHandle.incarnation
            && reuse.replacementHeld.projectile.gpu.candidate.status !== 0
            && ringRuntimeHealthy(reuse.finalRuntimeStatus)
            && reuse.recoveryRequired === false;
        const expectedDefinitions = {
            ring: 'basic_ring_01',
            o: 'basic-octa-enemy',
            p: 'basic_penta_01',
            h: 'basic_hexa_01',
            j: 'basic_gen_01'
        };
        const registryByName = new Map(
            coexistence?.registryEvidence?.map((entry) => [entry.name, entry])
                ?? []
        );
        const captureStorageValues = Object.values(
            coexistence?.captureStorageProfile ?? {}
        );
        const collisionStorageValues = Object.values(
            coexistence?.collisionStorageProfile ?? {}
        ).filter((value) => Number.isFinite(value));
        const coexistenceValid = coexistence?.activeEnemyCount === 5
            && coexistence.bodyAbiVersion === 8
            && Object.entries(expectedDefinitions).every(([name, definition]) => (
                registryByName.get(name)?.kindId === 'enemy'
                && registryByName.get(name)?.definitionId === definition
                && Number.isSafeInteger(
                    registryByName.get(name)?.metadataRevision
                )
                && registryByName.get(name).metadataRevision > 0
                && ringSameHandle(
                    registryByName.get(name)?.handle,
                    coexistence.handles?.[name]
                )
            ))
            && capturePair(
                coexistence.captureRecord,
                coexistence.handles?.ring,
                coexistence.handles?.projectile
            )
            && ringHeldAuditValid(
                coexistence.projectileAudit,
                coexistence.handles?.projectile,
                coexistence.handles?.ring,
                2
            )
            && ringRuntimeHealthy(coexistence.captureRuntimeStatus)
            && coexistence.directorBinding?.runtime?.sessionGeneration
                === coexistence.captureRuntimeStatus.sessionGeneration
            && coexistence.directorBinding.runtime.deviceGeneration
                === coexistence.captureRuntimeStatus.deviceGeneration
            && coexistence.directorBinding.runtime.authoritativeEpoch
                === coexistence.captureRuntimeStatus.authoritativeEpoch
            && coexistence.directorBinding.capacity === 9
            && JSON.stringify(coexistence.directorBinding.commandPortMethods)
                === JSON.stringify([
                    'discardPreparedBatch',
                    'requestPreparedReleaseBatch',
                    'requestTerminalHeldProjectileDespawn'
                ])
            && captureStorageValues.length === 23
            && captureStorageValues.every((value) => (
                Number.isSafeInteger(value) && value > 0 && value <= 9
            ))
            && Math.max(...captureStorageValues) === 7
            && collisionStorageValues.length > 0
            && Math.max(...collisionStorageValues) <= 9
            && coexistence.collisionStorageProfile?.render === 9
            && coexistence.collisionStorageProfile.requiredMaximum === 9
            && coexistence.recoveryRequired === false;
        scenarioValid = fixture?.scenario
                === 'ring-single-slot-projectile-capture-release'
            && actual && typeof actual === 'object'
            && funnelValid
            && towerValid
            && forwardValid
            && exitValid
            && expiryValid
            && unpublishedValid
            && publishedValid
            && replacementValid
            && reuseValid
            && coexistenceValid
            && result.requestedMaxStorageBuffersPerShaderStage === 9
            && result.adapterMaxStorageBuffersPerShaderStage >= 9
            && result.deviceMaxStorageBuffersPerShaderStage >= 9;
    } else if (fixtureStage === 'enemy-cork-route-closure') {
        fixture = result?.productionEnemyCorkRouteClosure;
        const lifecycle = fixture?.lifecycle;
        const route = fixture?.route;
        const interaction = fixture?.interaction;
        const capacity = fixture?.capacity;
        const terminal = fixture?.terminal;
        const replacement = fixture?.replacement;
        const storageValues = Object.values(fixture?.storageProfile ?? {});
        scenarioValid = fixture?.scenario
                === 'cork-dynamic-route-closure'
            && lifecycle?.helperBodyCount === 0
            && lifecycle.assigned === true
            && lifecycle.expanded === true
            && lifecycle.closed === true
            && lifecycle.reopened === true
            && lifecycle.exactOwnerDeath === true
            && route?.futureSpawnSelectedAlternative === true
            && route.activeActorReroutedForward === true
            && route.trappedActorWaitedAtClearance === true
            && route.waitingActorResumedAfterReopen === true
            && route.closedPathCount === 1
            && route.finalClosedPathCount === 0
            && interaction?.towerBlocked === true
            && interaction.projectilePhysicallyPassed === true
            && interaction.projectileDamagedCork === true
            && interaction.projectilePenetrationRemaining === true
            && capacity?.maximumCloserCount === 8
            && capacity.ninthRejectedWholeBatch === true
            && capacity.ninthRejectionRecoveryRequired === false
            && capacity.abaOldIncarnationDidNotReopen === true
            && terminal?.allOpen === true
            && terminal.rosterCount === 0
            && terminal.pendingReadbackCount === 0
            && terminal.rosterSealed === true
            && replacement?.sessionGenerationAdvanced === true
            && replacement.allOpen === true
            && replacement.rosterCount === 0
            && replacement.staleAuthorityRejected === true
            && fixture?.coexistence?.bodyAbiVersion === 8
            && fixture.coexistence.previousDomainsPreserved === true
            && storageValues.length > 0
            && storageValues.every((count) => Number.isSafeInteger(count)
                && count > 0 && count <= 9)
            && Math.max(...storageValues) === 9
            && result.requestedMaxStorageBuffersPerShaderStage === 9
            && result.adapterMaxStorageBuffersPerShaderStage >= 9
            && result.deviceMaxStorageBuffersPerShaderStage >= 9;
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
        || fixtureStage === 'enemy-jorang-split-lineage'
        || fixtureStage === 'enemy-octagon-directional-defense'
        || fixtureStage === 'enemy-ring-projectile-capture'
        || fixtureStage === 'enemy-cork-route-closure'
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
