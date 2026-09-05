export function validateEnemyHexaFormation(result) {
    let fixture = null;
    let scenarioValid = true;

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
        && chain.canonicalCoreImpactDamage > 0
        && chain.canonicalCoreImpactDamage
            === hostCommitted?.canonicalCoreImpactDamage
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
        && presentation.reservationGuideHidden === true
        && presentation.reservationCenterOpaque === true
        && presentation.reservationCyanPixelDelta === 0
        && presentation.reservationCyanPixelsBefore === 0
        && presentation.reservationCyanPixelsAfter === 0
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
        && replacement.respawnCenterOpaque === true
        && replacement.respawnOpaquePixelCount > 100
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
    return { fixture, scenarioValid };
}
