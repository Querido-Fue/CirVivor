import {
    ROUTE_AVAILABILITY_ABI_VERSION
} from '../contract/route_availability_contract.js';
import {
    GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION
} from '../physics/gpu/gpu_fixed_primitive_abi.js';
import {
    GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION
} from '../physics/gpu/gpu_effect_runtime_abi.js';
import {
    GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION
} from '../physics/gpu/gpu_formation_runtime_abi.js';
import {
    GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION
} from '../physics/gpu/gpu_atomic_transform_runtime_abi.js';
import {
    GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION
} from '../physics/gpu/gpu_projectile_capture_runtime_abi.js';

/**
 * 최종 submit의 owner/backend/roster 증거를 같은 fixed tick으로 대조합니다.
 * 읽기 전용 검사이며 ingress, tick, RunOutcome의 변경은 GameObjectSystem이 소유합니다.
 * 모든 증거를 읽은 뒤 기존 우선순위의 첫 실패만 반환합니다. 성공은 null입니다.
 */
export function inspectGpuWorldTerminalEvidence({
    fixedTick,
    enemySimulationEndpoint,
    towerGameplayTargetConfigured,
    pentagonEffectDirector,
    formationRuntimeDirector,
    jorangSplitLineageDirector,
    projectileCaptureDirector,
    corkRouteClosureDirector
}) {
    const terminalCancel = enemySimulationEndpoint
        .getTerminalFixedProgramCancelStatus?.() ?? null;
    const ownerEvidence = terminalCancel?.owner;
    const backendEvidence = terminalCancel?.backend;
    const effectTerminalCancel = enemySimulationEndpoint
        .getTerminalEffectProgramCancelStatus?.() ?? null;
    const effectOwnerEvidence = effectTerminalCancel?.owner;
    const effectBackendEvidence = effectTerminalCancel?.backend;
    const effectRosterEvidence = pentagonEffectDirector?.getStatus() ?? null;
    const formationTerminalCancel = enemySimulationEndpoint
        .getTerminalFormationProgramCancelStatus?.() ?? null;
    const formationOwnerEvidence = formationTerminalCancel?.owner;
    const formationBackendEvidence = formationTerminalCancel?.backend;
    const formationRosterEvidence
        = formationRuntimeDirector?.getStatus() ?? null;
    const atomicTransformTerminalCancel = enemySimulationEndpoint
        .getTerminalAtomicTransformProgramCancelStatus?.() ?? null;
    const atomicTransformOwnerEvidence
        = atomicTransformTerminalCancel?.owner;
    const atomicTransformBackendEvidence
        = atomicTransformTerminalCancel?.backend;
    const atomicTransformRosterEvidence
        = jorangSplitLineageDirector?.getStatus() ?? null;
    const projectileCaptureTerminal = enemySimulationEndpoint
        .getTerminalProjectileCaptureProgramCancelStatus?.() ?? null;
    const projectileCaptureOwnerEvidence
        = projectileCaptureTerminal?.owner;
    const projectileCaptureBackendEvidence
        = projectileCaptureTerminal?.backend;
    const projectileCaptureHostCleanupEvidence
        = projectileCaptureTerminal?.hostCleanup;
    const projectileCaptureRosterEvidence
        = projectileCaptureDirector?.getStatus() ?? null;
    const projectileCaptureRuntimeEvidence
        = enemySimulationEndpoint
            .getProjectileCaptureRuntimeStatus?.() ?? null;
    const routeAvailabilityTerminal = corkRouteClosureDirector
        ? enemySimulationEndpoint
            .getTerminalRouteAvailabilityProgramCancelStatus?.() ?? null
        : null;
    const routeAvailabilityOwnerEvidence
        = routeAvailabilityTerminal?.owner;
    const routeAvailabilityBackendEvidence
        = routeAvailabilityTerminal?.backend;
    const routeAvailabilityCleanupEvidence
        = routeAvailabilityTerminal?.lifecycleCleanup;
    const routeAvailabilityRosterEvidence
        = corkRouteClosureDirector?.getStatus() ?? null;
    const endpointStatus = enemySimulationEndpoint.getStatus();
    const gpuStatus = endpointStatus.backend?.gpu
        ?? endpointStatus.backend
        ?? {};
    const towerGameplayTargetEvidence = gpuStatus.fixedPrimitives
        ?.towerGameplayTarget ?? null;
    const towerGameplayTargetCleared
        = towerGameplayTargetConfigured === false
            && towerGameplayTargetEvidence?.configured === false;
    const cancellationSubmitted = ownerEvidence?.accepted === true
        && ownerEvidence.abiVersion
            === GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION
        && ownerEvidence.finalFixedTick === fixedTick
        && ownerEvidence.state === 'armed'
        && backendEvidence?.accepted === true
        && backendEvidence.abiVersion
            === GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION
        && backendEvidence.finalFixedTick === fixedTick
        && backendEvidence.state === 'submitted'
        && backendEvidence.submittedSourceTick === fixedTick
        && backendEvidence.destinationCount
            === ownerEvidence.destinationCount
        && backendEvidence.priorityControlCount
            === ownerEvidence.priorityControlCount
        && backendEvidence.pendingBodyCount === 0
        && backendEvidence.pendingSpawnProgramReadbacks === 0;
    const effectCancellationSubmitted = effectOwnerEvidence?.abiVersion
            === GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION
        && effectOwnerEvidence.state === 'armed'
        && effectOwnerEvidence.finalFixedTick === fixedTick
        && effectOwnerEvidence.submittedTick === 0
        && effectOwnerEvidence.failure === null
        && effectBackendEvidence?.abiVersion
            === GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION
        && effectBackendEvidence.state === 'submitted'
        && effectBackendEvidence.finalFixedTick === fixedTick
        && effectBackendEvidence.submittedTick === fixedTick
        && effectBackendEvidence.pulseProgramCount
            === effectOwnerEvidence.pulseProgramCount
        && effectBackendEvidence.pendingPulseProgramCount === 0
        && effectBackendEvidence.pendingEffectReadbackCount === 0
        && effectBackendEvidence.failure === null
        && endpointStatus
            .effectCommands.pendingPulseProgramCount === 0;
    const effectRosterSealed = effectRosterEvidence?.recoveryRequired === false
        && effectRosterEvidence.pendingPulseCount === 0
        && effectRosterEvidence.pendingBatchCount === 0
        && effectRosterEvidence.pendingStaleCompletionCount === 0
        && effectRosterEvidence.terminal?.finalFixedTick === fixedTick
        && effectRosterEvidence.terminal.fixedCommitObserved === true
        && effectRosterEvidence.terminal.lifecycleObserved === true
        && effectRosterEvidence.terminal.rosterSealed === true;
    const formationCancellationSubmitted
        = formationOwnerEvidence?.abiVersion
            === GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION
        && formationOwnerEvidence.state === 'armed'
        && formationOwnerEvidence.finalFixedTick === fixedTick
        && formationOwnerEvidence.submittedTick === 0
        && formationOwnerEvidence.failure === null
        && formationBackendEvidence?.abiVersion
            === GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION
        && formationBackendEvidence.state === 'submitted'
        && formationBackendEvidence.finalFixedTick === fixedTick
        && formationBackendEvidence.submittedTick === fixedTick
        && formationBackendEvidence.prepareProgramCount
            === formationOwnerEvidence.prepareProgramCount
        && formationBackendEvidence.armedTransformCount
            === formationOwnerEvidence.armedTransformCount
        && formationBackendEvidence.pendingPrepareProgramCount === 0
        && formationBackendEvidence.pendingPrepareReadbackCount === 0
        && formationBackendEvidence.failure === null
        && endpointStatus.formationCommands.pendingPrepareBatchCount === 0
        && endpointStatus.formationCommands.inFlightPrepareBatchCount === 0
        && endpointStatus.formationCommands.preparedTransformBatchCount === 0
        && endpointStatus.formationCommands.armedTransformBatchCount === 0
        && endpointStatus.formationCommands
            .pendingTransformCompletionCount === 0
        && endpointStatus.formationCommands.backend
            ?.pendingTransformReadbackCount === 0;
    const formationRosterSealed
        = formationRosterEvidence?.recoveryRequired === false
        && formationRosterEvidence.pendingTransformBatchCount === 0
        && formationRosterEvidence.terminal?.finalFixedTick === fixedTick
        && formationRosterEvidence.terminal.fixedCommitObserved === true
        && formationRosterEvidence.terminal.lifecycleObserved === true
        && formationRosterEvidence.terminal.rosterSealed === true;
    const atomicTransformCancellationSubmitted
        = atomicTransformOwnerEvidence?.abiVersion
            === GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION
        && atomicTransformOwnerEvidence.state === 'armed'
        && atomicTransformOwnerEvidence.finalFixedTick === fixedTick
        && atomicTransformOwnerEvidence.submittedTick === 0
        && atomicTransformOwnerEvidence.pendingPrepareCount === 0
        && atomicTransformOwnerEvidence.pendingTransformCount === 0
        && atomicTransformOwnerEvidence.pendingReadbackCount === 0
        && atomicTransformOwnerEvidence.failure === null
        && atomicTransformBackendEvidence?.abiVersion
            === GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION
        && atomicTransformBackendEvidence.state === 'submitted'
        && atomicTransformBackendEvidence.finalFixedTick === fixedTick
        && atomicTransformBackendEvidence.submittedTick === fixedTick
        && atomicTransformBackendEvidence.pendingPrepareCount === 0
        && atomicTransformBackendEvidence.pendingTransformCount === 0
        && atomicTransformBackendEvidence.pendingReadbackCount === 0
        && atomicTransformBackendEvidence.failure === null
        && atomicTransformBackendEvidence.sessionGeneration
            === atomicTransformOwnerEvidence.sessionGeneration
        && atomicTransformBackendEvidence.deviceGeneration
            === atomicTransformOwnerEvidence.deviceGeneration
        && atomicTransformBackendEvidence.authoritativeEpoch
            === atomicTransformOwnerEvidence.authoritativeEpoch
        && endpointStatus.atomicTransformCommands?.pendingPrepareCount === 0
        && endpointStatus.atomicTransformCommands?.pendingTransformCount === 0
        && endpointStatus.atomicTransformCommands?.pendingReadbackCount === 0;
    const atomicTransformRosterSealed
        = atomicTransformRosterEvidence?.recoveryRequired === false
        && atomicTransformRosterEvidence.pendingTransformBatchCount === 0
        && atomicTransformRosterEvidence.pendingFirstHitCount === 0
        && atomicTransformRosterEvidence.circlePrimeDueCount === 0
        && atomicTransformRosterEvidence.terminal?.finalFixedTick
            === fixedTick
        && atomicTransformRosterEvidence.terminal.fixedCommitObserved === true
        && atomicTransformRosterEvidence.terminal.lifecycleObserved === true
        && atomicTransformRosterEvidence.terminal.rosterSealed === true;
    const projectileCaptureSettlementSubmitted
        = projectileCaptureOwnerEvidence?.accepted === true
        && projectileCaptureOwnerEvidence.abiVersion
            === GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION
        && projectileCaptureOwnerEvidence.state === 'settled'
        && projectileCaptureOwnerEvidence.finalFixedTick === fixedTick
        && projectileCaptureOwnerEvidence.submittedTick === fixedTick
        && projectileCaptureOwnerEvidence.completedThroughTick === fixedTick
        && projectileCaptureOwnerEvidence.pendingPreparedBatchCount === 0
        && projectileCaptureOwnerEvidence.armedBatchCount === 0
        && projectileCaptureOwnerEvidence.terminalHeldDespawnRequestCount
            === projectileCaptureHostCleanupEvidence
                ?.requestedHeldDespawnCount
        && projectileCaptureOwnerEvidence.failure === null
        && projectileCaptureBackendEvidence?.abiVersion
            === GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION
        && projectileCaptureBackendEvidence.accepted === true
        && projectileCaptureBackendEvidence.state === 'settled'
        && projectileCaptureBackendEvidence.finalFixedTick === fixedTick
        && projectileCaptureBackendEvidence.submittedTick === fixedTick
        && projectileCaptureBackendEvidence.completedThroughTick === fixedTick
        && projectileCaptureOwnerEvidence.sessionGeneration
            === projectileCaptureBackendEvidence.sessionGeneration
        && projectileCaptureOwnerEvidence.deviceGeneration
            === projectileCaptureBackendEvidence.deviceGeneration
        && projectileCaptureOwnerEvidence.authoritativeEpoch
            === projectileCaptureBackendEvidence.authoritativeEpoch
        && projectileCaptureBackendEvidence.stagedReleaseCount === 0
        && projectileCaptureBackendEvidence.commitRequested
            === projectileCaptureOwnerEvidence.commitRequested
        && projectileCaptureBackendEvidence.pendingCaptureReadbackCount === 0
        && projectileCaptureBackendEvidence.pendingReleaseReadbackCount === 0
        && projectileCaptureBackendEvidence.failure === null
        && projectileCaptureHostCleanupEvidence?.authority
            === 'lifecycle-terminal-despawn'
        && projectileCaptureHostCleanupEvidence.failure === null
        && projectileCaptureHostCleanupEvidence.requestedHeldDespawnCount
            === projectileCaptureHostCleanupEvidence
                .completedHeldDespawnCount
        && projectileCaptureHostCleanupEvidence.pendingHeldDespawnCount === 0
        && projectileCaptureHostCleanupEvidence
            .releaseCommittedExcluded === true
        && projectileCaptureRuntimeEvidence?.abiVersion
            === GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION
        && projectileCaptureRuntimeEvidence.sessionGeneration
            === projectileCaptureBackendEvidence.sessionGeneration
        && projectileCaptureRuntimeEvidence.deviceGeneration
            === projectileCaptureBackendEvidence.deviceGeneration
        && projectileCaptureRuntimeEvidence.authoritativeEpoch
            === projectileCaptureBackendEvidence.authoritativeEpoch
        && projectileCaptureRuntimeEvidence.completedThroughTick === fixedTick
        && projectileCaptureRuntimeEvidence.stagedReleaseCount === 0
        && projectileCaptureRuntimeEvidence.pendingCaptureReadbackCount === 0
        && projectileCaptureRuntimeEvidence.pendingReleaseReadbackCount === 0
        && projectileCaptureRuntimeEvidence.requiresRecovery === false
        && projectileCaptureRosterEvidence?.sessionGeneration
            === projectileCaptureOwnerEvidence.sessionGeneration
        && projectileCaptureRosterEvidence.deviceGeneration
            === projectileCaptureOwnerEvidence.deviceGeneration
        && projectileCaptureRosterEvidence.authoritativeEpoch
            === projectileCaptureOwnerEvidence.authoritativeEpoch
        && projectileCaptureRosterEvidence.lastCompletedCaptureTick
            === fixedTick
        && projectileCaptureRosterEvidence.lastCompletedReleaseTick
            === fixedTick;
    const projectileCaptureRosterSealed
        = projectileCaptureRosterEvidence?.recoveryRequired === false
        && projectileCaptureRosterEvidence.capturedProjectileCount === 0
        && projectileCaptureRosterEvidence.heldCount === 0
        && projectileCaptureRosterEvidence.releasePendingCount === 0
        && projectileCaptureRosterEvidence.pendingBatchCount === 0
        && projectileCaptureRosterEvidence
            .terminalCleanupPendingCount === 0
        && projectileCaptureRosterEvidence.pendingReadbackCount === 0
        && projectileCaptureRosterEvidence.terminal?.finalFixedTick
            === fixedTick
        && projectileCaptureRosterEvidence.terminal.fixedCommitObserved
            === true
        && projectileCaptureRosterEvidence.terminal.lifecycleObserved
            === true
        && projectileCaptureRosterEvidence.terminal.rosterSealed === true;
    const routeAvailabilitySettlementSubmitted
        = corkRouteClosureDirector === null
            || (routeAvailabilityTerminal?.abiVersion
                    === ROUTE_AVAILABILITY_ABI_VERSION
                && routeAvailabilityTerminal.state === 'settled'
                && routeAvailabilityTerminal.accepted === true
                && routeAvailabilityTerminal.finalFixedTick === fixedTick
                && routeAvailabilityTerminal.failure === null
                && routeAvailabilityOwnerEvidence?.state === 'settled'
                && routeAvailabilityOwnerEvidence.accepted === true
                && routeAvailabilityOwnerEvidence.finalFixedTick === fixedTick
                && routeAvailabilityOwnerEvidence.completedThroughTick
                    >= fixedTick
                && routeAvailabilityOwnerEvidence.failure === null
                && routeAvailabilityOwnerEvidence.rosterSealed === true
                && routeAvailabilityOwnerEvidence.rosterCount === 0
                && Array.isArray(
                    routeAvailabilityOwnerEvidence.closedPathIds
                )
                && routeAvailabilityOwnerEvidence.closedPathIds.length === 0
                && routeAvailabilityBackendEvidence?.state === 'settled'
                && routeAvailabilityBackendEvidence.accepted === true
                && routeAvailabilityBackendEvidence.finalFixedTick
                    === fixedTick
                && routeAvailabilityBackendEvidence.completedThroughTick
                    >= fixedTick
                && routeAvailabilityBackendEvidence.failure === null
                && routeAvailabilityBackendEvidence.rosterCount === 0
                && routeAvailabilityBackendEvidence.allOpen === true
                && routeAvailabilityBackendEvidence.leaseCount === 0
                && Array.isArray(
                    routeAvailabilityBackendEvidence.closedPathIds
                )
                && routeAvailabilityBackendEvidence.closedPathIds.length === 0
                && routeAvailabilityBackendEvidence.stagedCount === 0
                && routeAvailabilityBackendEvidence.commitRequested === false
                && routeAvailabilityBackendEvidence.pendingReadbackCount === 0
                && routeAvailabilityBackendEvidence
                    .pendingCompletionBatchCount === 0
                && routeAvailabilityBackendEvidence
                    .lifecycleReservationCount === 0
                && routeAvailabilityBackendEvidence.sessionGeneration
                    === routeAvailabilityRosterEvidence?.sessionGeneration
                && routeAvailabilityBackendEvidence.deviceGeneration
                    === routeAvailabilityRosterEvidence?.deviceGeneration
                && routeAvailabilityBackendEvidence.authoritativeEpoch
                    === routeAvailabilityRosterEvidence?.authoritativeEpoch
                && routeAvailabilityBackendEvidence.availabilityVersion
                    === routeAvailabilityRosterEvidence?.availabilityVersion
                && routeAvailabilityCleanupEvidence?.state === 'settled'
                && routeAvailabilityCleanupEvidence.accepted === true
                && routeAvailabilityCleanupEvidence.finalFixedTick
                    === fixedTick
                && routeAvailabilityCleanupEvidence.completedThroughTick
                    >= fixedTick
                && routeAvailabilityCleanupEvidence.failure === null
                && routeAvailabilityCleanupEvidence.reservationCount === 0
                && routeAvailabilityCleanupEvidence.stagedCount === 0
                && routeAvailabilityCleanupEvidence.pendingReadbackCount === 0
                && routeAvailabilityCleanupEvidence.pendingCount === 0
                && routeAvailabilityCleanupEvidence.requestedCount
                    === routeAvailabilityCleanupEvidence.completedCount);
    const routeAvailabilityRosterSealed
        = corkRouteClosureDirector === null
            || (routeAvailabilityRosterEvidence?.recoveryRequired === false
                && routeAvailabilityRosterEvidence.rosterCount === 0
                && routeAvailabilityRosterEvidence.assignedLeaseCount === 0
                && routeAvailabilityRosterEvidence.pendingAssignmentCount === 0
                && routeAvailabilityRosterEvidence.normalFallbackCount === 0
                && routeAvailabilityRosterEvidence.pendingCleanupCount === 0
                && routeAvailabilityRosterEvidence.pending === false
                && routeAvailabilityRosterEvidence.closedPathIds.length === 0
                && routeAvailabilityRosterEvidence.completedThroughTick
                    >= fixedTick
                && routeAvailabilityRosterEvidence.terminal?.finalFixedTick
                    === fixedTick
                && routeAvailabilityRosterEvidence.terminal
                    .fixedCommitObserved === true
                && routeAvailabilityRosterEvidence.terminal
                    .lifecycleObserved === true
                && routeAvailabilityRosterEvidence.terminal.rosterSealed
                    === true);
    if (!towerGameplayTargetCleared) {
        return Object.freeze({
            stage: 'terminal-tower-gameplay-target-evidence',
            detail: towerGameplayTargetEvidence
        });
    }
    if (!cancellationSubmitted) {
        return Object.freeze({
            stage: 'terminal-fixed-program-cancel',
            detail: backendEvidence ?? ownerEvidence ?? terminalCancel
        });
    }
    if (!effectCancellationSubmitted) {
        return Object.freeze({
            stage: 'terminal-effect-program-cancel',
            detail: effectBackendEvidence
                ?? effectOwnerEvidence
                ?? effectTerminalCancel
        });
    }
    if (!effectRosterSealed) {
        return Object.freeze({
            stage: 'terminal-effect-roster-seal',
            detail: effectRosterEvidence
        });
    }
    if (!formationCancellationSubmitted) {
        return Object.freeze({
            stage: 'terminal-formation-program-cancel',
            detail: formationBackendEvidence
                ?? formationOwnerEvidence
                ?? formationTerminalCancel
        });
    }
    if (!formationRosterSealed) {
        return Object.freeze({
            stage: 'terminal-formation-roster-seal',
            detail: formationRosterEvidence
        });
    }
    if (!atomicTransformCancellationSubmitted) {
        return Object.freeze({
            stage: 'terminal-atomic-transform-program-cancel',
            detail: atomicTransformBackendEvidence
                ?? atomicTransformOwnerEvidence
                ?? atomicTransformTerminalCancel
        });
    }
    if (!atomicTransformRosterSealed) {
        return Object.freeze({
            stage: 'terminal-atomic-transform-roster-seal',
            detail: atomicTransformRosterEvidence
        });
    }
    if (!projectileCaptureSettlementSubmitted) {
        return Object.freeze({
            stage: 'terminal-projectile-capture-settlement',
            detail: projectileCaptureBackendEvidence
                ?? projectileCaptureOwnerEvidence
                ?? projectileCaptureTerminal
        });
    }
    if (!projectileCaptureRosterSealed) {
        return Object.freeze({
            stage: 'terminal-projectile-capture-roster-seal',
            detail: projectileCaptureRosterEvidence
        });
    }
    if (!routeAvailabilitySettlementSubmitted) {
        return Object.freeze({
            stage: 'terminal-route-availability-settlement',
            detail: routeAvailabilityBackendEvidence
                ?? routeAvailabilityOwnerEvidence
                ?? routeAvailabilityCleanupEvidence
                ?? routeAvailabilityTerminal
        });
    }
    if (!routeAvailabilityRosterSealed) {
        return Object.freeze({
            stage: 'terminal-route-availability-roster-seal',
            detail: routeAvailabilityRosterEvidence
        });
    }
    return null;
}
