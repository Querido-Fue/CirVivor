export function validateR5ActorVerbs(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.r5ActorVerbs;
    scenarioValid = fixture?.scenario
            === 'r5-shoot-tower-production-vertical-slice'
        && fixture?.towerRecursion?.towerCounts?.join(',') === '1,2,4'
        && fixture.towerRecursion.subjectCounts?.join(',') === '1,2'
        && fixture.towerRecursion.generatedCounts?.join(',') === '1,2'
        && fixture.towerRecursion.sameExecutionExcluded === true
        && fixture.towerRecursion.replayNoDuplicate === true
        && fixture?.enemyTen?.subjectCount === 10
        && fixture.enemyTen.generatedCount === 10
        && fixture.enemyTen.towerCount === 11
        && fixture.enemyTenTotalsConserved === true
        && fixture?.capacity?.exactSubjectCount === 255
        && fixture.capacity.exactTowerCount === 256
        && fixture.capacity.overSubjectCount === 256
        && fixture.capacity.overRejected === true
        && fixture.capacity.overGeneratedCount === 0
        && fixture.capacity.overCooldownConsumed === false
        && fixture.capacity.exactTotalsConserved === true
        && fixture.capacity.overTotalsConserved === true
        && fixture?.sourceDeath?.subjectCount === 1
        && fixture.sourceDeath.generatedCount === 1
        && fixture.sourceDeath.sourceRemoved === true
        && fixture.sourceDeath.towerCount === 2
        && fixture?.towerSourceDeath?.subjectCount === 2
        && fixture.towerSourceDeath.generatedCount === 2
        && fixture.towerSourceDeath.sourceRemoved === true
        && fixture.towerSourceDeath.towerCount === 3
        && fixture.towerSourceDeath.survivorTotalsConserved === true
        && fixture.towerSourceDeath.cooldownConsumed === true
        && fixture?.zeroShare?.subjectCount === 1
        && fixture.zeroShare.generatedCount === 0
        && fixture.zeroShare.sourceRemoved === true
        && fixture.zeroShare.towerCount === 0
        && fixture.zeroShare.livingShareUnits === 0
        && fixture.zeroShare.result === 'REJECTED_ZERO_SHARE'
        && fixture.zeroShare.cooldownConsumed === false
        && fixture.profileFingerprintBound === true
        && fixture.storageMaximum <= 9
        && fixture.recoveryRequired === false
        && fixture.destroyedTeardown === true;
    return { fixture, scenarioValid };
}

export function validateR7ActorPayloadMultiplicity(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.r7ActorPayloadMultiplicity;
    const positives = fixture?.positives ?? [];
    const byId = Object.fromEntries(positives.map((entry) => [
        entry.id,
        entry
    ]));
    const exactPositive = (id, subjectCount, copiesPerSubject,
        generatedCount) => {
        const entry = byId[id];
        return entry?.subjectCount === subjectCount
            && entry.copiesPerSubject === copiesPerSubject
            && entry.generatedCount === generatedCount
            && entry.cooldownConsumed === true
            && entry.sourceCopyPairCount === generatedCount
            && entry.destinationCount === generatedCount
            && entry.destinationFingerprint > 0
            && entry.siblingOverlapCount === 0
            && entry.gridOverflowCount === 0
            && entry.destroyedTeardown === true;
    };
    const negatives = fixture?.negatives;
    const cleanReject = (entry) => entry?.generatedCount === 0
        && entry.cooldownConsumed === false
        && entry.reservationCount === 0
        && entry.recoveryRequired === false
        && entry.destroyedTeardown === true;
    scenarioValid = fixture?.scenario
            === 'r7-actor-payload-multiplicity-actual-webgpu'
        && positives.length === 5
        && exactPositive('tower-shoot-enemy-x2', 1, 2, 2)
        && exactPositive('enemy-100-shoot-enemy-x2', 100, 2, 200)
        && exactPositive('enemy-50-shoot-enemy-x4', 50, 4, 200)
        && exactPositive('enemy-125-throw-enemy-x2', 125, 2, 250)
        && byId['enemy-125-throw-enemy-x2']?.airborneHighWater === 250
        && byId['enemy-125-throw-enemy-x2']?.landedCount === 250
        && exactPositive('enemy-128-summon-enemy-x2', 128, 2, 256)
        && cleanReject(negatives?.generatedBudget)
        && negatives.generatedBudget.subjectCount === 501
        && cleanReject(negatives?.oneShortBody)
        && cleanReject(negatives?.closedPlacement)
        && negatives.closedPlacement.partialPublicationCount === 0
        && negatives?.ringPressure?.firstStagedCount === 1
        && negatives.ringPressure.retryStagedCount === 1
        && negatives.ringPressure.maximumReservationCount === 2
        && negatives.ringPressure.generatedCount === 4
        && negatives.ringPressure.rejectedCount === 0
        && negatives.ringPressure.recoveryRequired === false
        && negatives.ringPressure.destroyedTeardown === true
        && negatives?.staleCompletion?.observedMutationCount === 0
        && cleanReject(negatives.staleCompletion)
        && fixture.storageMaximum <= 9
        && fixture.uncapturedErrorCount === 0
        && fixture.destroyedTeardown === true;
    return { fixture, scenarioValid };
}

export function validatePostR5LiveBugfix(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.postR5LiveBugfix;
    const safeCases = fixture?.safePlacement?.cases ?? [];
    const actualCasts = fixture?.actualR2?.abilityCasts ?? [];
    const healthy = (health) => health?.restartCountDelta === 0
        && health.sessionGenerationDelta === 0
        && health.gridOverflowCount === 0
        && health.recoveryRequired === false
        && health.recoveryCauseStage === null
        && health.materializerRecoveryRequired === false
        && health.towerProtocolFailureCount === 0
        && health.projectileCaptureRecoveryRequired === false
        && health.projectileCaptureFailure === null
        && health.registryReservedCount === 0
        && health.pendingCommandCount === 0
        && health.materializerInFlightCount === 0
        && health.storageMaximum <= 9;
    scenarioValid = fixture?.scenario
            === 'post-r5-live-bugfix-production-ordering'
        && safeCases.map(({ subjectCount }) => subjectCount).join(',')
            === '100,256,735'
        && safeCases.every((entry) => (
            entry.generatedCount === entry.subjectCount
            && entry.exactDoubling === true
            && entry.cooldownConsumed === true
        ))
        && fixture.safePlacement.edgeCases?.length === 5
        && fixture.safePlacement.perSubjectCpuCommandCount === 0
        && healthy(fixture.safePlacement.health)
        && fixture?.impossiblePlacement?.generatedCount === 0
        && fixture.impossiblePlacement.cooldownConsumed === false
        && fixture.impossiblePlacement.reason?.code
            === 'NO_VALID_GLOBAL_PLACEMENT'
        && fixture.impossiblePlacement.reason.attemptedCandidateCount
            === 142
        && fixture.impossiblePlacement.reason.candidateRound === 8
        && healthy(fixture.impossiblePlacement.health)
        && fixture?.actualR2?.mapId === 'r2_enemy_showcase_01'
        && actualCasts.filter(({ slotId }) => slotId === 'E').length === 4
        && actualCasts.filter(({ slotId }) => slotId === 'SHIFT').length
            === 3
        && actualCasts.filter(({ slotId }) => slotId === 'SPACE').length
            === 2
        && actualCasts.every((cast) => cast.generatedCount > 0
            && cast.cooldownConsumed === true)
        && fixture.actualR2.stageReceiptEvidence?.length >= 5
        && fixture.actualR2.towerCountBeforeReplacement === 76
        && fixture.actualR2.postReplacementTowerCount === 156
        && fixture.actualR2.replacement?.sessionGenerationDelta === 1
        && fixture.actualR2.replacement.deviceGenerationDelta === 0
        && fixture.actualR2.replacement.probation?.state === 'PASSED'
        && fixture.actualR2.recoveryGrid?.towerCount === 76
        && fixture.actualR2.recoveryGrid.distinctPositionCount === 76
        && fixture.actualR2.recoveryGrid.gridOverflowCount === 0
        && fixture.actualR2.finalGrid?.towerCount === 156
        && fixture.actualR2.finalGrid.gridOverflowCount === 0
        && fixture.actualR2.longRun?.advancedTickCount === 300
        && fixture?.tower256Recovery?.casts?.length === 8
        && fixture.tower256Recovery.casts.at(-1)?.towerCount === 256
        && fixture.tower256Recovery.replacement?.deviceGenerationDelta === 0
        && fixture.tower256Recovery.replacement.probation?.state === 'PASSED'
        && fixture.tower256Recovery.recoveryGrid?.towerCount === 256
        && fixture.tower256Recovery.recoveryGrid.distinctPositionCount
            === 256
        && fixture.tower256Recovery.recoveryGrid.gridOverflowCount === 0
        && fixture.tower256Recovery.finalGrid?.gridOverflowCount === 0
        && fixture.tower256Recovery.longRun?.advancedTickCount === 180
        && fixture.tower256Recovery.towerShare
            ?.invariantViolationCount === 0
        && healthy(fixture.tower256Recovery.health)
        && fixture?.actualArrow?.mapId === 'r2_enemy_showcase_01'
        && fixture.actualArrow.chargeSamples?.length >= 4
        && fixture.actualArrow.chargeSpeedTilesPerSecond === 6
        && fixture.actualArrow.accelerationAccumulationMaximum <= 0.0001
        && fixture.actualArrow.recoilSamples?.length >= 2
        && fixture.actualArrow.contactEventCount === 1
        && fixture.actualArrow.damageEventCount === 1
        && fixture.actualArrow.impactEvidence?.normalSpeed < 0
        && fixture.actualArrow.impactEvidence.error <= 0.005
        && fixture.actualArrow.impactEvidence
            .appliedAfterOrdinaryReconstruction === true
        && Math.hypot(
            fixture.actualArrow.exactOnceEvidence?.arrowCustomDelta?.x
                ?? Infinity,
            fixture.actualArrow.exactOnceEvidence?.arrowCustomDelta?.y
                ?? Infinity
        ) <= 0.0001
        && Math.hypot(
            fixture.actualArrow.exactOnceEvidence?.towerCustomDelta?.x
                ?? Infinity,
            fixture.actualArrow.exactOnceEvidence?.towerCustomDelta?.y
                ?? Infinity
        ) <= 0.0001
        && fixture.actualArrow.exactOnceEvidence.duplicateEvent === false
        && fixture.actualArrow.recoilDamping?.scriptedExpoOverwrite === false
        && fixture.actualArrow.sawRecover === true
        && fixture.actualArrow.sawRearm === true
        && fixture.actualArrow.targetMovedAfterLock === true
        && fixture.actualR2.towerShare?.invariantViolationCount === 0
        && healthy(fixture.actualR2.health)
        && healthy(fixture.actualArrow.health);
    return { fixture, scenarioValid };
}

export function validateActorActionPlacement(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.actorActionPlacement;
    const actions = fixture?.actions;
    const targeting = fixture?.targeting;
    const degenerate = fixture?.degenerate;
    const sdf = fixture?.sdf;
    const contracts = fixture?.contracts;
    scenarioValid = fixture?.scenario
            === 'r5-gpu-actor-action-placement-side-plane'
        && ['shoot', 'emit', 'summon', 'throw'].every((key) => (
            actions?.[key]?.status === 2
            && actions[key].validCount === actions[key].subjectCount
        ))
        && actions.shoot.launchExact === true
        && actions.emit.zeroVelocity === true
        && actions.summon.stableLattice === true
        && actions.throw.airborneExact === true
        && actions.throw.durationDerivedGroundSpeed === true
        && targeting?.sharedAim === true
        && targeting.nearestTower === true
        && targeting.coreFallback === true
        && targeting.facingFallback === true
        && degenerate?.velocityFallback === true
        && degenerate.facingFallback === true
        && degenerate.positiveXFallback === true
        && sdf?.exactStatus === 2
        && sdf.atomicRejectStatus === 3
        && sdf.atomicRejectValidCount === 1
        && sdf.atomicRejectSubjectCount === 2
        && sdf.throwExactStatus === 2
        && sdf.throwSourceRejectStatus === 3
        && sdf.throwLandingRejectStatus === 3
        && contracts?.actorActionProfileFingerprintBound === true
        && contracts.sourceDeathSnapshotComplete === true
        && contracts.stableRankRejected === true
        && contracts.oneShortRejected === true
        && contracts.capacityRejected === true
        && contracts.staleDeviceRejected === true
        && contracts.staleDestinationFingerprintRejected === true
        && contracts.aggregateReadbackByteSize === 112
        && contracts.placementRecordCpuReadback === false
        && contracts.transitRecordCpuReadback === false
        && contracts.bodyStateCommitCount === 0
        && contracts.storageMaximum === 9
        && contracts.dispatchStorageBindingCount === 2;
    return { fixture, scenarioValid };
}
