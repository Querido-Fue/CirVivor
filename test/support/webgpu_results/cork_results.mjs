import {
    GPU_CIRCLE_BODY_ABI_VERSION
} from '../../../project/game/script/module/ingame/physics/gpu/gpu_circle_body_abi.js';

export function validateEnemyCorkRouteClosure(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.productionEnemyCorkRouteClosure;
    const lifecycle = fixture?.lifecycle;
    const route = fixture?.route;
    const effect = fixture?.effect;
    const formation = fixture?.formation;
    const crossSystem = fixture?.crossSystem;
    const interaction = fixture?.interaction;
    const capacity = fixture?.capacity;
    const terminal = fixture?.terminal;
    const replacement = fixture?.replacement;
    const mixedChurn = fixture?.mixedChurn;
    const churnCycles = mixedChurn?.cycles ?? [];
    const storageValues = Object.values(fixture?.storageProfile ?? {});
    scenarioValid = fixture?.scenario
            === 'cork-dynamic-route-closure'
        && lifecycle?.helperBodyCount === 0
        && lifecycle.assigned === true
        && lifecycle.expanded === true
        && lifecycle.precloseExpandNonblockingOpen === true
        && lifecycle.stagedCloseAnchoredNonblocking === true
        && lifecycle.flowPublishedBlocking === true
        && lifecycle.closed === true
        && lifecycle.reopened === true
        && lifecycle.exactOwnerDeath === true
        && route?.futureSpawnSelectedAlternative === true
        && route.activeActorFollowedRebuiltFlow === true
        && route.blockedBranchActorDidNotWait === true
        && route.blockedBranchActorStayedTraveling === true
        && route.closeSourceTick === 62
        && Number.isSafeInteger(route.closeAvailabilityVersion)
        && route.closeAvailabilityVersion >= 2
        && route.closeCompletedVersionMatch === true
        && route.closeFlowReadyVersionMatch === true
        && Number.isSafeInteger(route.closeFlowPublicationFrameCount)
        && route.closeFlowPublicationFrameCount > 0
        && route.closeFlowPublicationFrameCount <= 240
        && route.reopenFlowReadyVersionMatch === true
        && Number.isSafeInteger(route.reopenFlowPublicationFrameCount)
        && route.reopenFlowPublicationFrameCount > 0
        && route.reopenFlowPublicationFrameCount <= 240
        && route.precloseGpuSourceTick === 61
        && route.precloseGpuAvailabilityState === 1
        && route.closeSubmitGpuSourceTick === 62
        && route.closeSubmitGpuClosedState === 2
        && route.closedPathCount === 1
        && route.finalClosedPathCount === 0
        && effect?.sourceDefinitionId === 'basic_penta_01'
        && effect.blockingCorkBoostApplied === true
        && effect.exactTarget === true
        && effect.appliedInstanceCount >= 1
        && effect.boostStackCount === 1
        && effect.targetPhysicalLayer === 1024
        && effect.targetInteractionLayer === 1
        && effect.recoveryRequired === false
        && formation?.firstRowMemberCount === 2
        && formation.closeQueuedMemberCount === 0
        && formation.closeSinkCallCount === 0
        && formation.backlogMemberCount === 2
        && formation.backlogRetained === true
        && formation.reopenBatchCount === 1
        && formation.reopenedMemberCount === 2
        && formation.reopenedOnOriginalPath === true
        && formation.partialRowCount === 0
        && formation.arbitraryRowSplit === false
        && formation.finalBacklogMemberCount === 0
        && crossSystem?.behaviorActorsAvoidedWait === true
        && crossSystem.behaviorRerouteActors?.length === 3
        && crossSystem.behaviorRerouteActors.map(({ key }) => key).join(',')
            === 'arrow,rhom,octagon'
        && crossSystem.behaviorRerouteActors.map(
            ({ programId }) => programId
        ).join(',') === '1,2,3'
        && crossSystem.behaviorRerouteActors.every((entry) => (
            entry.routePhase === 2
            && entry.routeOwnedWait === false
            && entry.navigationActive === true
            && entry.recoveryRequired === false
        ))
        && crossSystem.flowRerouteActors?.length === 3
        && crossSystem.flowRerouteActors.map(({ key }) => key).join(',')
            === 'ring,jorang,hexa'
        && crossSystem.flowRerouteActors.every((entry) => (
            entry.routePhase === 2
            && entry.navigationActive === true
            && entry.waited === false
            && entry.recoveryRequired === false
        ))
        && crossSystem.ringCaptureRole === 1
        && crossSystem.ringCapturePhase === 0
        && crossSystem.ringCaptureStatePreserved === true
        && crossSystem.jorangAtomicPhase === 1
        && crossSystem.jorangAtomicStatePreserved === true
        && (crossSystem.hexaFormationFlags & 1) !== 0
        && crossSystem.hexaFormationStateActive === true
        && crossSystem.hexaFormationMemberCount === 1
        && crossSystem.recoveryRequired === false
        && interaction?.towerBlocked === true
        && interaction.projectilePhysicallyPassed === true
        && interaction.projectileDamagedCork === true
        && interaction.blockingCorkInverseMass === 0
        && interaction.projectilePenetrationRemaining === true
        && capacity?.maximumCloserCount === 8
        && capacity.branchSpecializationLimit === 1
        && capacity.excessCorksSpawnedAsNormal === true
        && capacity.ninthSpawnedAsNormal === true
        && capacity.prospectiveDeathReleasedAdmission === true
        && capacity.normalFallbackRecoveryRequired === false
        && capacity.activeCloserCount === 1
        && capacity.leaseGenerationAdvanced === true
        && capacity.abaOldIncarnationDidNotReopen === true
        && terminal?.allOpen === true
        && terminal.rosterCount === 0
        && terminal.pendingReadbackCount === 0
        && terminal.rosterSealed === true
        && replacement?.sessionGenerationAdvanced === true
        && replacement.allOpen === true
        && replacement.rosterCount === 0
        && replacement.staleAuthorityRejected === true
        && mixedChurn?.contractVersion === 2
        && mixedChurn.scenario
            === 'single-device-single-session-mixed-o-j-r-z-h-p-projectile-churn'
        && Number.isSafeInteger(mixedChurn.requestedCycles)
        && mixedChurn.requestedCycles >= 1
        && mixedChurn.requestedCycles <= 12
        && mixedChurn.completedCycles === mixedChurn.requestedCycles
        && mixedChurn.oneEndpoint === true
        && mixedChurn.stableTuple === true
        && mixedChurn.cycleTuple?.sessionGeneration
            === mixedChurn.initialTuple.sessionGeneration
        && mixedChurn.cycleTuple.deviceGeneration
            === mixedChurn.initialTuple.deviceGeneration
        && mixedChurn.cycleTuple.captureSessionGeneration
            === mixedChurn.initialTuple.captureSessionGeneration
        && mixedChurn.cycleTuple.captureDeviceGeneration
            === mixedChurn.initialTuple.captureDeviceGeneration
        && mixedChurn.cycleTuple.authoritativeEpoch > 0
        && mixedChurn.cycleTuple.captureAuthoritativeEpoch > 0
        && mixedChurn.exactIncarnationChurn === true
        && mixedChurn.roster?.join(',')
            === 'octagon,jorang,ring,cork,hexa,penta,projectile'
        && mixedChurn.capacity === 12
        && mixedChurn.peakActiveCount === 8
        && mixedChurn.boundedHighWater === true
        && mixedChurn.lifetimeSentinelActive === true
        && mixedChurn.finalActiveCount === 1
        && mixedChurn.finalChurnActiveCount === 0
        && mixedChurn.finalReservedCount === 0
        && mixedChurn.finalGpuBodyCount === 1
        && mixedChurn.finalChurnGpuBodyCount === 0
        && mixedChurn.finalRouteAllOpen === true
        && mixedChurn.finalRouteRosterCount === 0
        && mixedChurn.finalRouteLeaseCount === 0
        && mixedChurn.finalPendingAllZero === true
        && mixedChurn.submittedTickCount
            === mixedChurn.expectedSubmittedTickCount
        && mixedChurn.expectedSubmittedTickCount
            === mixedChurn.requestedCycles * 2
        && mixedChurn.storageMaximum === 9
        && mixedChurn.recoveryRequired === false
        && churnCycles.length === mixedChurn.requestedCycles
        && churnCycles.every((cycle, index) => (
            cycle.cycle === index + 1
            && cycle.spawnTick === (index * 2) + 1
            && cycle.cleanupTick === (index * 2) + 2
            && cycle.tupleStable === true
            && cycle.reusedEntityIds === true
            && cycle.incarnationAdvanced === true
            && cycle.roster?.length === 7
            && cycle.roster.map(({ key }) => key).join(',')
                === 'octagon,jorang,ring,cork,hexa,penta,projectile'
            && cycle.roster.every((entry) => (
                Number.isSafeInteger(entry.handle?.entityId)
                && Number.isSafeInteger(entry.handle?.incarnation)
                && (index === 0
                    || (entry.reusedEntityId === true
                        && entry.incarnationAdvanced === true))
            ))
            && cycle.activeCountAtPeak === 8
            && cycle.activeCountAfterCleanup === 1
            && cycle.reservedCountAfterCleanup === 0
            && cycle.gpuBodyCountAfterCleanup === 1
            && cycle.sidePlanesValid === true
            && cycle.pentaEmitterDefinitionCode > 0
            && cycle.hexaFormationMemberCount === 1
            && cycle.ringCaptureRole === 1
            && cycle.ringCapturePhase === 0
            && cycle.jorangAtomicPhase === 1
            && cycle.octagonProgramId === 3
            && cycle.octagonOrbitSlotIndex === 0
            && cycle.corkRouteRole === 2
            && Number.isSafeInteger(cycle.corkLeaseGeneration)
            && cycle.corkLeaseGeneration > 0
            && (index === 0
                || cycle.corkLeaseGeneration
                    > churnCycles[index - 1].corkLeaseGeneration)
            && Number.isSafeInteger(cycle.projectileEntityId)
            && cycle.routeAllOpen === true
            && cycle.routeRosterCount === 0
            && cycle.routeLeaseCount === 0
            && cycle.pendingAllZero === true
            && cycle.fixedTickDelta === 2
            && cycle.submittedTickDelta === 2
            && cycle.recoveryRequired === false
        ))
        && churnCycles.every((cycle) => (
            cycle.tuple.sessionGeneration
                === mixedChurn.cycleTuple.sessionGeneration
            && cycle.tuple.deviceGeneration
                === mixedChurn.cycleTuple.deviceGeneration
            && cycle.tuple.authoritativeEpoch
                === mixedChurn.cycleTuple.authoritativeEpoch
            && cycle.tuple.captureSessionGeneration
                === mixedChurn.cycleTuple.captureSessionGeneration
            && cycle.tuple.captureDeviceGeneration
                === mixedChurn.cycleTuple.captureDeviceGeneration
            && cycle.tuple.captureAuthoritativeEpoch
                === mixedChurn.cycleTuple.captureAuthoritativeEpoch
        ))
        && fixture?.coexistence?.bodyAbiVersion === GPU_CIRCLE_BODY_ABI_VERSION
        && fixture.coexistence.mainHarnessCapacity === 20
        && fixture.coexistence.peakActiveCount === 13
        && fixture.coexistence.peakCapacityHeadroom === 7
        && fixture.coexistence.previousDomainsPreserved === true
        && storageValues.length > 0
        && storageValues.every((count) => Number.isSafeInteger(count)
            && count > 0 && count <= 9)
        && Math.max(...storageValues) === 9
        && result.requestedMaxStorageBuffersPerShaderStage === 9
        && result.adapterMaxStorageBuffersPerShaderStage >= 9
        && result.deviceMaxStorageBuffersPerShaderStage >= 9;
    return { fixture, scenarioValid };
}
