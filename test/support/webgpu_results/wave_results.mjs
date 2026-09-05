export function validateR9OvertimePressure(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.r9OvertimePressure;
    const handles = fixture?.createdHandles ?? [];
    scenarioValid = fixture?.scenario
            === 'r9-overtime-pressure-actual-webgpu'
        && fixture.gpuCreateCount === 2
        && fixture.gpuCreateSiegeWeight === 12
        && handles.length === 2
        && new Set(handles.map(({ entityId, incarnation }) => (
            `${entityId}:${incarnation}`
        ))).size === 2
        && fixture.firstPulseDamage === 3
        && fixture.firstPulseOrdinal === 1
        && fixture.remainingCountAfterFirstDeath === 1
        && fixture.remainingSiegeWeightAfterFirstDeath === 8
        && fixture.secondPulseDamage === 2
        && fixture.secondPulseOrdinal === 2
        && fixture.finalHostileCount === 0
        && fixture.finalPulseSuppressed === true
        && fixture.finalWaveState === 'CLEAR_CANDIDATE'
        && fixture.finalCoreIntegrity === 5
        && fixture.lethal?.defeated === true
        && fixture.lethal.coreDepleted === true
        && fixture.lethal.runFailedFactCount === 1
        && fixture.lethal.waveFailedFactCount === 1
        && fixture.lethal.waveState === 'RUN_DEFEATED'
        && fixture.hostileBufferBytes === 32
        && fixture.storageMaximum === 2
        && fixture.recoveryRequired === false
        && result.requestedMaxStorageBuffersPerShaderStage === 9
        && result.adapterMaxStorageBuffersPerShaderStage >= 9
        && result.deviceMaxStorageBuffersPerShaderStage >= 9;
    return { fixture, scenarioValid };
}

export function validateR9MultiWave(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.r9MultiWave;
    scenarioValid = fixture?.scenario
            === 'r9-three-wave-progression-actual-webgpu'
        && fixture.directorCreateCount === 3
        && fixture.directorSequence?.length === 3
        && fixture.directorSequence.map(({ fixedTickOffset }) => (
            fixedTickOffset
        )).join(',') === '0,1,2'
        && fixture.destroyedWaveIds?.length === 2
        && fixture.sameGpuEndpoint === true
        && fixture.endpointProgress?.totalSpawnCount === 3
        && fixture.endpointProgress.liveHostileCount === 0
        && fixture.endpointProgress.completedWaveCount === 3
        && fixture.endpointProgress.lastWaveOrdinal === 3
        && fixture.firstSpawnFixedTicks?.join(',') === '1,2,3'
        && fixture.uniqueSpawnCommandCount === 3
        && fixture.noCloseBoundarySpawn === true
        && fixture.overtimeObserved === true
        && fixture.finalState === 'MAP_CLEAR_READY'
        && fixture.finalContinueState === 'MAP_CLEAR_READY'
        && fixture.mapClearFactCount === 1
        && fixture.nextDirectorCreatedAfterFinal === false
        && fixture.preservedOwnerIdentity === true
        && fixture.routeAllOpen === true
        && Number.isSafeInteger(fixture.planFingerprint)
        && fixture.planFingerprint > 0
        && fixture.storageMaximum === 2
        && fixture.recoveryRequired === false
        && result.requestedMaxStorageBuffersPerShaderStage === 9
        && result.adapterMaxStorageBuffersPerShaderStage >= 9
        && result.deviceMaxStorageBuffersPerShaderStage >= 9;
    return { fixture, scenarioValid };
}
