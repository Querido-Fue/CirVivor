export function validateEnemyOctagonDirectionalDefense(result) {
    let fixture = null;
    let scenarioValid = true;

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
        && orbit.gpuTrigPositionTolerance === 0.005
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
            Number.isFinite(error)
            && error <= orbit.gpuTrigPositionTolerance
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
            - (5 / 60 / 6)) <= 0.00001
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
        && damage.fullyAbsorbedBudgetBefore === 2
        && damage.fullyAbsorbedBudgetAfter === 1
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
        && storage.behavior === 9
        && storage.render === 9
        && storage.contactHandling === 9
        && storage.maximum === 9;
    return { fixture, scenarioValid };
}
