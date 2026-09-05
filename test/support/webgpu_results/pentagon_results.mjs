export function validateEnemyPentagonEffect(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.productionEnemyPentagonEffect;
    const extended = result?.enemyPentagonEffectExtended;
    const instanceCapacity = extended?.instanceCapacityAtomicity;
    const eventCapacity = extended?.eventCapacityAtomicity;
    const progress = extended?.phaseAlignedCapacityProgress;
    const firstResults = progress?.firstTick?.results ?? [];
    scenarioValid = fixture?.scenario
            === 'penta-independent-boost-pulse-whole-tick'
        && fixture.candidateCount === 2
        && fixture.appliedInstanceCount === 2
        && fixture.eventCount === 3
        && fixture.damageChannels?.towerContact === true
        && fixture.damageChannels?.projectileTower === true
        && fixture.damageChannels?.directCore === true
        && fixture.damageChannels?.projectileCore === true
        && fixture.storageProfile?.sourceResolve === 9
        && fixture.effectStorageBuffersPerStage === 9
        && fixture.terminal?.state === 'submitted'
        && fixture.terminal?.pendingPulseProgramCount === 0
        && fixture.terminal?.pendingEffectReadbackCount === 0
        && [instanceCapacity, eventCapacity].every((capacity) => (
            capacity?.status === 0
            && capacity.candidateCount === 0
            && capacity.appliedInstanceCount === 0
            && capacity.eventCount === 0
            && capacity.deferredPulseCount === 1
            && capacity.rawCandidateCount === 2
            && capacity.requiresRecovery === false
            && capacity.pendingPulseProgramCount === 0
            && capacity.pendingEffectReadbackCount === 0
        ))
        && firstResults.length === 2
        && firstResults[0]?.programIndex === 0
        && firstResults[0].pulseSequence === 0
        && firstResults[0].resultCode === 4
        && firstResults[0].candidateCount === 3
        && firstResults[0].appliedCount === 0
        && firstResults[1]?.programIndex === 1
        && firstResults[1].pulseSequence === 0
        && firstResults[1].resultCode === 1
        && firstResults[1].candidateCount === 3
        && firstResults[1].appliedCount === 3
        && progress.firstTick.candidateCount === 3
        && progress.firstTick.appliedInstanceCount === 3
        && progress.firstTick.eventCount === 4
        && progress.firstTick.deferredPulseCount === 1
        && progress.retryTick?.pulseSequence === 0
        && progress.retryTick.resultCode === 1
        && progress.retryTick.candidateCount === 3
        && progress.retryTick.appliedCount === 3
        && progress.retryTick.deferredPulseCount === 0
        && progress.highWater?.candidate === 3
        && progress.highWater.instance === 6
        && progress.highWater.event === 4
        && progress.requiresRecovery === false;
    return { fixture, scenarioValid };
}
