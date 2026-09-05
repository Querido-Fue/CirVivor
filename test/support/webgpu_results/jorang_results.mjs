export function validateEnemyJorangSplitLineage(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.productionEnemyJorangSplitLineage;
    const actual = fixture?.actualRuntime;
    const lineage = actual?.lineageRoundTrip;
    const split = lineage?.split;
    const core = lineage?.coreForfeiture;
    const delayed = lineage?.delayedReturn;
    const burst = actual?.fiveToFourPlusOne;
    const capacity = actual?.capacityRestage;
    const firstHitEventCapacity = actual?.firstHitEventCapacity;
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
        && fixture.triggerScope?.contract
            === 'first-valid-positive-damage-hit'
        && fixture.triggerScope.actualTriggerProducer === 'projectile'
        && fixture.triggerScope
            .projectileHitPolicyValidatedBeforeCommonSeam === true
        && fixture.triggerScope.futureProducerExecutionClaimed === false
        && fixture.triggerScope.commonProducerKinds?.join(',')
            === 'projectile,explosion,effect,direct,melee'
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
        && (split.effectDefinitionTransferDestinationIndex === 0
            || split.effectDefinitionTransferDestinationIndex === 1)
        && split.effectDistributionPolicy
            === 'stable-instance-id-modulo-destination-count'
        && split.sourceEffectInstanceCount === 2
        && split.sourceEffectInstanceIds?.length === 2
        && new Set(split.sourceEffectInstanceIds).size === 2
        && split.sourceEffectDestinationParity?.length === 2
        && split.sourceEffectDestinationParity.every(
            (value) => value === 0 || value === 1
        )
        && new Set(split.sourceEffectDestinationParity).size === 2
        && split.distributedEffectInstanceCount === 2
        && split.distributedEffectInstanceIds?.join(',')
            === split.sourceEffectInstanceIds.join(',')
        && split.everyEffectRekeyedExactlyOnce === true
        && split.effectCloneCount === 0
        && split.effectDropCount === 0
        && split.child0EffectInstanceCount === 1
        && split.child1EffectInstanceCount === 1
        && split.effectTargetSlotMatchesBody === true
        && split.exactEffectPayloadPreserved === true
        && split.gpuCommittedCount === 1
        && split.gpuEffectRekeyCount === 2
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
        && firstHitEventCapacity?.rejectionReason
            === 'atomic-transform-first-hit-event-capacity'
        && firstHitEventCapacity.retryable === true
        && firstHitEventCapacity.candidateCount === 2
        && firstHitEventCapacity.committedCount === 0
        && firstHitEventCapacity.eventBase === 0
        && firstHitEventCapacity.eventCapacity === 1
        && firstHitEventCapacity.triggerEventCountAtRejection === 0
        && firstHitEventCapacity.sourcePhaseUnchanged === true
        && firstHitEventCapacity.sourceHealthUnchanged === true
        && firstHitEventCapacity.sourcePoseFlowVelocityUnchanged === true
        && firstHitEventCapacity.sourceMetadataUnchanged === true
        && firstHitEventCapacity.sourceBudgetUnchanged === true
        && firstHitEventCapacity.effectInstancesUnchanged === true
        && firstHitEventCapacity.recoveryRequiredAtRejection === false
        && firstHitEventCapacity.directorRetryableCapacityCount === 1
        && firstHitEventCapacity.retryTriggerCount === 1
        && firstHitEventCapacity.retryPrepareCandidateCount === 1
        && firstHitEventCapacity.retryLifecycleTransformCount === 1
        && firstHitEventCapacity.retryGpuCommittedCount === 1
        && firstHitEventCapacity.finalCirclePrimeCount === 2
        && firstHitEventCapacity.requiresRecovery === false
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
        && fixture.presentation?.definitionShape === 'jorang'
        && fixture.presentation.gpuShapeCode === 10
        && fixture.presentation.dedicatedJorangShape === true
        && fixture.storageProfile?.atomicTransformFirstHit === 9
        && fixture.storageProfile.requiredMaximum === 9;
    return { fixture, scenarioValid };
}
