export function validateTowerGroupTargetQuery(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.towerGroupTargetQuery;
    scenarioValid = fixture?.nearestEntityId === 50
        && fixture.octagonIdentityEntityId === 20
        && fixture.shareTieEntityId === 20
        && fixture.revisionEntityId === 20
        && fixture.revisionChanged === true
        && fixture.deathRetargetEntityId === 30
        && fixture.deathInventedRevision === false
        && fixture.zeroRosterValid === false
        && fixture.archerRewrittenEntityId === 50
        && fixture.resultStride === 40
        && fixture.storageMaximum === 9
        && fixture.noCpuRosterOrPoseReadback === true;
    return { fixture, scenarioValid };
}

export function validateR6TowerMerge(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.r6TowerMerge;
    const cases = fixture?.cases ?? [];
    const sourceChanged = fixture?.sourceChanged;
    const sameTickDamage = fixture?.sameTickDamage;
    const malformed = fixture?.malformedProgram;
    const capacity = fixture?.capacity;
    const oldProtocol = fixture?.oldProtocol;
    const lifecycle = fixture?.lifecycle;
    const targeting = fixture?.targeting;
    scenarioValid = fixture?.scenario
            === 'atomic-gpu-tower-n-to-one-merge'
        && cases.map(({ sourceCount }) => sourceCount).join(',')
            === '2,64,256'
        && cases.every((entry) => (
            entry.bodyAbiVersion === 10
            && entry.committed === true
            && entry.status === 2
            && entry.validatedCount === entry.sourceCount
            && entry.appliedCount === entry.sourceCount
            && entry.consumedCount === entry.sourceCount - 1
            && entry.exactSurvivorHandle === true
            && entry.exactPoseVelocityPreserved === true
            && entry.temporaryPreviousPositionPreserved === true
            && entry.survivorCurrentHpFixedPoint > 0
            && entry.survivorMaxHpFixedPoint
                >= entry.survivorCurrentHpFixedPoint
            && entry.survivorPowerFixedPoint > 0
            && entry.survivorShareUnits > 0
            && entry.targetGroupRevision === 12
            && entry.survivorOnlyRoster === true
            && entry.consumedHiddenCount === entry.sourceCount - 1
            && entry.consumedNoncontrolledCount
                === entry.sourceCount - 1
            && entry.consumedMetadataClearedCount
                === entry.sourceCount - 1
            && entry.consumedMemberClearedCount
                === entry.sourceCount - 1
            && entry.projectileUnchanged === true
            && entry.effectPlaneUnchanged === true
            && entry.capacityRejectionReason
                === 'tower-merge-program-capacity'
            && entry.capacityRecoveryRequired === false
            && entry.aggregateReadbackBytes === 112
            && entry.perTowerCpuCommandCount === 0
            && entry.fullBodyReadbackCount === 0
            && entry.storageMaximum === 9
            && entry.requiresRecovery === false
        ))
        && ['death', 'aba'].every((key) => (
            sourceChanged?.[key]?.rejectedSourceChanged === true
            && sourceChanged[key].committed === false
            && sourceChanged[key].appliedCount === 0
            && sourceChanged[key].externalStateChangedOnlyByFixture === true
            && sourceChanged[key].mergeMutationCount === 0
            && sourceChanged[key].requiresRecovery === false
        ))
        && sameTickDamage?.committed === true
        && sameTickDamage.damageFixedPoint === 137
        && sameTickDamage.gpuTargetCurrentHpFixedPoint
            === sameTickDamage.stagedTargetCurrentHpFixedPoint
                - sameTickDamage.damageFixedPoint
        && sameTickDamage.survivorCurrentHpFixedPoint
            === sameTickDamage.gpuTargetCurrentHpFixedPoint
        && sameTickDamage.appliedCount === 2
        && sameTickDamage.executionOrder
            === 'post-contact-damage-death-same-encoder'
        && sameTickDamage.requiresRecovery === false
        && malformed?.protocolFailure === true
        && malformed.committed === false
        && malformed.appliedCount === 0
        && malformed.mergeMutationCount === 0
        && malformed.requiresRecovery === true
        && capacity?.rejectionReason === 'tower-merge-program-capacity'
        && capacity.retryable === true
        && capacity.cancelledCount === 1
        && capacity.mergeMutationCount === 0
        && capacity.requiresRecovery === false
        && oldProtocol?.oldCompletionPublishedCount === 0
        && oldProtocol.freshBuffersUnchanged === true
        && oldProtocol.freshSessionGeneration === 72
        && oldProtocol.freshDeviceGeneration === 20
        && oldProtocol.requiresRecovery === false
        && lifecycle?.consumedDisposition === 'TOWER_MERGED'
        && lifecycle.deathEventCount === 0
        && lifecycle.lostEventCount === 0
        && lifecycle.goldEventCount === 0
        && lifecycle.rewardReceiptCount === 0
        && lifecycle.replayCommitCount === 1
        && targeting?.consumedExactHandleInvalid === true
        && targeting.survivorOnlyRoster === true
        && targeting.hostileRetargetAuthority === 'tower-group-roster'
        && fixture.storageMaximum === 9
        && result.requestedMaxStorageBuffersPerShaderStage === 9
        && result.adapterMaxStorageBuffersPerShaderStage >= 9
        && result.deviceMaxStorageBuffersPerShaderStage >= 9;
    return { fixture, scenarioValid };
}
