import {
    GPU_CIRCLE_BODY_ABI_VERSION
} from '../../../project/game/script/module/ingame/physics/gpu/gpu_circle_body_abi.js';

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

function ringFiniteVector(vector) {
    return Number.isFinite(vector?.x) && Number.isFinite(vector?.y);
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
        && storageValues.length === 27
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

function ringTerminalWatermarkValid(value) {
    const finalFixedTick = value?.finalFixedTick;
    const owner = value?.terminal?.owner;
    const backend = value?.terminal?.backend;
    const runtime = value?.runtimeStatus;
    const director = value?.directorStatus;
    const boundary = value?.terminalBoundary;
    return Number.isSafeInteger(finalFixedTick) && finalFixedTick > 0
        && owner?.accepted === true
        && owner.abiVersion === 1
        && owner.finalFixedTick === finalFixedTick
        && owner.submittedTick === finalFixedTick
        && owner.completedThroughTick === finalFixedTick
        && backend?.abiVersion === 1
        && backend.accepted === true
        && backend.finalFixedTick === finalFixedTick
        && backend.submittedTick === finalFixedTick
        && backend.completedThroughTick === finalFixedTick
        && owner.sessionGeneration === backend.sessionGeneration
        && owner.deviceGeneration === backend.deviceGeneration
        && owner.authoritativeEpoch === backend.authoritativeEpoch
        && runtime?.sessionGeneration === backend.sessionGeneration
        && runtime.deviceGeneration === backend.deviceGeneration
        && runtime.authoritativeEpoch === backend.authoritativeEpoch
        && runtime?.completedThroughTick === finalFixedTick
        && director?.sessionGeneration === owner.sessionGeneration
        && director.deviceGeneration === owner.deviceGeneration
        && director.authoritativeEpoch === owner.authoritativeEpoch
        && director.lastCompletedCaptureTick === finalFixedTick
        && director.lastCompletedReleaseTick === finalFixedTick
        && boundary?.captureSourceTick === finalFixedTick
        && boundary.captureCompletedThroughTick === finalFixedTick
        && boundary.releaseSourceTick === finalFixedTick
        && boundary.releaseCompletedThroughTick === finalFixedTick;
}

export function validateEnemyRingProjectileCapture(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.productionEnemyRingProjectileCapture;
    const actual = fixture?.actualRuntime;
    const funnel = actual?.funnelAndMutualSelection;
    const inside = funnel?.inside;
    const boundary = funnel?.boundary;
    const outside = funnel?.outside;
    const insideOutbound = funnel?.insideOutbound;
    const oneCaptor = funnel?.oneCaptorTwoProjectiles;
    const twoCaptors = funnel?.twoCaptorsOneProjectile;
    const capacityRejection = actual?.capacityWholeBatchRejection;
    const releaseCapacityRetry = actual?.releasePreparationCapacityRetry;
    const cleanupCapacityRetry = actual?.cleanupCapacityRetry;
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
        && inside.approachDirection === 'inbound'
        && Math.abs(boundary?.angleRadians - (Math.PI / 4)) <= 1e-12
        && boundary.approachDirection === 'inbound'
        && outside?.angleRadians > Math.PI / 4
        && outside.approachDirection === 'inbound'
        && insideOutbound?.angleRadians === 0
        && insideOutbound.approachDirection === 'outbound'
        && inside.relativeClosingDot < 0
        && boundary.relativeClosingDot < 0
        && outside.relativeClosingDot < 0
        && insideOutbound.relativeClosingDot > 0
        && [inside, boundary, outside, insideOutbound].every((entry) => (
            Number.isFinite(entry.relativeClosingDot)
            && ringFiniteVector(entry.preSubmitCaptorVelocity)
            && ringFiniteVector(entry.preSubmitProjectileVelocity)
        ))
        && inside.captureRecords?.length === 1
        && boundary.captureRecords?.length === 1
        && outside.captureRecords?.length === 0
        && insideOutbound.captureRecords?.length === 0
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
        && insideOutbound.projectileAudit?.capturedMirror === false
        && insideOutbound.projectileAudit?.state?.role === 2
        && insideOutbound.projectileAudit?.state?.phase === 0
        && insideOutbound.projectileAudit?.state?.captureSequence === 0
        && ringRuntimeHealthy(inside.runtimeStatus)
        && ringRuntimeHealthy(boundary.runtimeStatus)
        && ringRuntimeHealthy(outside.runtimeStatus)
        && ringRuntimeHealthy(insideOutbound.runtimeStatus)
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
            tower.preReleaseCaptorBody.position,
            tower.releasePreparation.anchor
        ) >= tower.preReleaseCaptorBody.radius
            + tower.releasedProjectileBody.radius
        && ringVectorDistance(
            tower.releasedProjectileBody.position,
            {
                x: tower.releasePreparation.anchor.x
                    + tower.releasedProjectileBody.velocity.x / 60,
                y: tower.releasePreparation.anchor.y
                    + tower.releasedProjectileBody.velocity.y / 60
            }
        ) <= 0.0001
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
        && forward.coreProxyHandle === null
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
        && JSON.stringify(forward.metadataBefore?.origin)
            === JSON.stringify(forward.metadataAfter?.origin)
        && ringReleasedAuditValid(
            forward.releasedProjectileAudit,
            forward.projectileHandle
        )
        && forward.finalDirectorStatus?.capturedProjectileCount === 0
        && ringRuntimeHealthy(forward.finalRuntimeStatus);
    const capacityRejectionValid = capacityRejection?.capacityRejected === true
        && capacityRejection.retryable === true
        && capacityRejection.rejectionReason
            === 'projectile-capture-completion-capacity'
        && capacityRejection.capacityRejectionFlags === 1
        && capacityRejection.captureDemandCount === 2
        && capacityRejection.captureCapacity === 1
        && capacityRejection.retryAfterFixedTick === 2
        && capacityRejection.recordCount === 0
        && capacityRejection.stateUnchanged === true
        && capacityRejection.metadataUnchanged === true
        && capacityRejection.retry?.originSourceTick === 1
        && capacityRejection.retry.firstBacklogRemaining === true
        && capacityRejection.retry.secondBacklogRemaining === false
        && capacityRejection.retry.firstRecords?.length === 1
        && capacityRejection.retry.secondRecords?.length === 1
        && capacityRejection.retry.finalCapturedProjectileCount === 2
        && capacityRejection.runtimeStatus?.retryMode === true
        && capacityRejection.runtimeStatus.requiresRecovery === false
        && capacityRejection.finalRuntimeStatus?.retryMode === false
        && capacityRejection.finalRuntimeStatus.requiresRecovery === false
        && capacityRejection.directorStatus?.capturedProjectileCount === 2
        && capacityRejection.directorStatus.recoveryRequired === false;
    const releaseCapacityRetryValid = releaseCapacityRetry
            ?.capacityRejected === true
        && releaseCapacityRetry.releasePreparationDemandCount === 2
        && releaseCapacityRetry.releasePreparationCapacity === 1
        && releaseCapacityRetry.stateUnchanged === true
        && releaseCapacityRetry.metadataUnchanged === true
        && releaseCapacityRetry.heldPoseMaintained === true
        && releaseCapacityRetry.firstRetry?.backlogRemaining === true
        && releaseCapacityRetry.firstRetry.records?.length === 1
        && releaseCapacityRetry.secondRetry?.backlogRemaining === false
        && releaseCapacityRetry.secondRetry.records?.length === 1
        && releaseCapacityRetry.releaseCompletions?.length === 2
        && releaseCapacityRetry.finalCapturedProjectileCount === 0
        && releaseCapacityRetry.captorRegistryCount === 0
        && releaseCapacityRetry.recoveryRequired === false;
    const cleanupCapacityRetryValid = cleanupCapacityRetry
            ?.capacityRejected === true
        && cleanupCapacityRetry.cleanupDemandCount === 2
        && cleanupCapacityRetry.cleanupCapacity === 1
        && cleanupCapacityRetry.stateUnchanged === true
        && cleanupCapacityRetry.metadataUnchanged === true
        && cleanupCapacityRetry.heldExpiryPoseMaintained === true
        && cleanupCapacityRetry.firstRetry?.backlogRemaining === true
        && cleanupCapacityRetry.firstRetry.records?.length === 1
        && cleanupCapacityRetry.secondRetry?.backlogRemaining === false
        && cleanupCapacityRetry.secondRetry.records?.length === 1
        && cleanupCapacityRetry.finalCapturedProjectileCount === 0
        && cleanupCapacityRetry.projectileRegistryCount === 0
        && cleanupCapacityRetry.recoveryRequired === false;
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
            && (event.eventType === 'interaction-enter'
                || event.eventType === 'interaction-continuous')
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
        && value.registryHasProjectile === true
        && value.recoveryRequired === false;
    const exitValid = exitReleaseValid(death, 2)
        && death.registryHasCaptor === false
        && deathEventExact === true
        && exitReleaseValid(core, 3)
        && core.registryHasCaptor === false
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
        && unpublished.survivingCaptorAudit?.capturedMirror === false
        && unpublished.survivingCaptorAudit.state?.role === 1
        && unpublished.survivingCaptorAudit.state.phase === 0
        && unpublished.survivingCaptorAudit.state.profileCode === 1
        && unpublished.survivingCaptorAudit.state.policyCode === 0
        && unpublished.survivingCaptorAudit.state.flags === 0
        && unpublished.survivingCaptorAudit.state.peerBodySlot === 0xffffffff
        && unpublished.survivingCaptorAudit.state.peerEntityId === 0xffffffff
        && unpublished.survivingCaptorAudit.state.peerIncarnation
            === 0xffffffff
        && unpublished.terminalBoundary?.releasePreparationCount === 0
        && unpublished.terminalBoundary?.releaseCompletionCount === 0
        && unpublished.terminal?.hostCleanup?.requestedHeldDespawnCount === 1
        && unpublished.terminal.hostCleanup.completedHeldDespawnCount === 1
        && unpublished.directorStatus?.capturedProjectileCount === 0
        && unpublished.directorStatus.terminal?.reason === 'core-depleted'
        && unpublished.directorStatus.terminal?.cleanupRequestedCount === 1
        && unpublished.directorStatus.terminal.publishedReleaseCount === 0
        && unpublished.directorStatus.terminal.rosterSealed === true
        && ringTerminalWatermarkValid(unpublished)
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
        && ringTerminalWatermarkValid(published)
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
        && coexistence.bodyAbiVersion === GPU_CIRCLE_BODY_ABI_VERSION
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
        && captureStorageValues.length === 27
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
        && capacityRejectionValid
        && releaseCapacityRetryValid
        && cleanupCapacityRetryValid
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
    return { fixture, scenarioValid };
}
