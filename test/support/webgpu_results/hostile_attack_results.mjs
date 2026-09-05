export function validateEnemyArrowCharge(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.productionEnemyArrowCharge;
    const charge = fixture?.motion?.charge;
    const impact = fixture?.motion?.impact;
    const recoilDamping = fixture?.motion?.recoilDamping;
    const impactDeltaError = Math.max(
        Math.abs(
            (impact?.actualArrowVelocityDelta?.x ?? Infinity)
                - (impact?.expectedArrowVelocityDelta?.x ?? 0)
        ),
        Math.abs(
            (impact?.actualArrowVelocityDelta?.y ?? Infinity)
                - (impact?.expectedArrowVelocityDelta?.y ?? 0)
        ),
        Math.abs(
            (impact?.actualTowerVelocityDelta?.x ?? Infinity)
                - (impact?.expectedTowerVelocityDelta?.x ?? 0)
        ),
        Math.abs(
            (impact?.actualTowerVelocityDelta?.y ?? Infinity)
                - (impact?.expectedTowerVelocityDelta?.y ?? 0)
        )
    );
    scenarioValid = fixture?.states?.trackedPoseIndependent?.entered === 1
        && fixture.states.trackedPoseIndependent.expires === 31
        && fixture.states?.fallback?.entered === 3
        && charge?.authoredSpeed === 6
        && charge.accelerationAccumulation <= 0.0001
        && charge.fullOracle?.authoredSpeed === 6
        && charge.fullOracle.accelerationAccumulation <= 0.0001
        && impact?.normalSpeed < 0
        && Math.abs(Math.hypot(
            impact?.normal?.x ?? 0,
            impact?.normal?.y ?? 0
        ) - 1) <= 0.00001
        && impact.arrowInverseMass > impact.towerInverseMass
        && impact.restitution === 0.55
        && impact.tangentialRetention === 0.85
        && impactDeltaError <= 0.002
        && impact.appliedAfterOrdinaryReconstruction === true
        && impact.exactOnce === true
        && Math.hypot(
            impact.postContactCustomDelta?.x ?? Infinity,
            impact.postContactCustomDelta?.y ?? Infinity
        ) <= 0.0001
        && recoilDamping?.authored === 0.9
        && recoilDamping.scriptedExpoOverwrite === false
        && fixture.maximumDamageWindow?.arrowAppliedFixedPoint === 0
        && fixture.targetingPorts?.gameplayTarget?.abiVersion === 1
        && fixture.targetingPorts.gameplayTarget.recordByteSize === 16
        && fixture.targetingPorts.gameplayTarget.storageBuffersPerStage === 8
        && fixture.targetingPorts.gameplayTarget.configured === false
        && fixture.targetingPorts.trackedPoseConfigured === false
        && fixture.storageProfile?.enemyBehavior === 9
        && fixture.storageProfile?.trackedPose === 6;
    return { fixture, scenarioValid };
}

export function validateMaximumDamageWindow(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.productionMaximumDamageWindow;
    return { fixture, scenarioValid };
}

export function validateEnemyRhomPriority(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.productionEnemyRhomPriority;
    scenarioValid = result?.productionEnemyRhomPriority?.scenario
        === 'rhom-core-priority-selected-target';
    return { fixture, scenarioValid };
}

export function validateEnemyRhomSourceDeathProjectile(result) {
    let fixture = null;
    let scenarioValid = true;

    fixture = result?.productionEnemyRhomSourceDeathProjectile;
    const launch = fixture?.launch;
    const sourceDeath = fixture?.sourceDeath;
    const windowPrime = fixture?.windowPrime;
    const windowPrimeEntry = windowPrime?.entryGeometry;
    const impact = fixture?.impact;
    const cleanup = fixture?.cleanup;
    const runtime = fixture?.runtime;
    const snapshotFlag = 1 << 16;
    scenarioValid = fixture?.scenario
            === 'rhom-tower-selected-direct-projectile-survives-source-death'
        && launch?.selectedTargetOutcome === 'tower'
        && launch.projectileAlive === true
        && launch.selectedTowerBehaviorExact === true
        && Number.isFinite(launch.coreDistance)
        && launch.coreDistance > launch.attackRangeTiles
        && Number.isSafeInteger(launch?.sourceHandle?.entityId)
        && Number.isSafeInteger(launch?.sourceHandle?.incarnation)
        && Number.isSafeInteger(launch?.projectileHandle?.entityId)
        && Number.isSafeInteger(launch?.projectileHandle?.incarnation)
        && Number.isSafeInteger(launch?.targetTowerHandle?.entityId)
        && Number.isSafeInteger(launch?.targetTowerHandle?.incarnation)
        && Number.isSafeInteger(launch?.wrongTowerHandle?.entityId)
        && Number.isSafeInteger(launch?.wrongTowerHandle?.incarnation)
        && Number.isSafeInteger(launch?.coreHandle?.entityId)
        && Number.isSafeInteger(launch?.coreHandle?.incarnation)
        && launch.snapshot?.entityId === launch.projectileHandle.entityId
        && launch.snapshot?.incarnation === launch.projectileHandle.incarnation
        && launch.snapshot.resolvedBaseDamageOther === 5
        && launch.snapshot.attackMultiplier === 1
        && launch.snapshot.sourceSnapshotTick === 2
        && (launch.snapshot.flags & snapshotFlag) !== 0
        && launch.authority?.sourceEntityId === launch.sourceHandle.entityId
        && launch.authority?.sourceIncarnation
            === launch.sourceHandle.incarnation
        && launch.authority?.selectedTargetKind === 'tower'
        && launch.authority?.selectedTargetEntityId
            === launch.targetTowerHandle.entityId
        && launch.authority?.selectedTargetIncarnation
            === launch.targetTowerHandle.incarnation
        && launch.authority?.selectionSourceTick === 2
        && launch.authority?.selectionSequence === 1
        && Number.isSafeInteger(launch.authority?.attackFingerprint)
        && launch.authority.attackFingerprint > 0
        && sourceDeath?.fixedTick === 4
        && sourceDeath.exactSourceDespawned === true
        && sourceDeath.sourceRegistryPresent === false
        && sourceDeath.sourceBackendPresent === false
        && sourceDeath.projectileRegistryPresent === true
        && sourceDeath.projectileBackendPresent === true
        && sourceDeath.projectileAliveAfterSourceDeath === true
        && sourceDeath.provenancePreserved === true
        && sourceDeath.selectedTowerAuthorityPreserved === true
        && sourceDeath.immutableSnapshotPreserved === true
        && JSON.stringify(sourceDeath.snapshot) === JSON.stringify(launch.snapshot)
        && JSON.stringify(sourceDeath.authority) === JSON.stringify(launch.authority)
        && windowPrime?.spawnTick === 5
        && windowPrime.publicationTick === 6
        && Number.isSafeInteger(windowPrime?.projectileHandle?.entityId)
        && Number.isSafeInteger(windowPrime?.projectileHandle?.incarnation)
        && Number.isFinite(windowPrimeEntry?.targetPosition?.x)
        && Number.isFinite(windowPrimeEntry?.targetPosition?.y)
        && Number.isFinite(windowPrimeEntry?.startPosition?.x)
        && Number.isFinite(windowPrimeEntry?.startPosition?.y)
        && windowPrimeEntry.startPosition.x
            < windowPrimeEntry.targetPosition.x
        && windowPrimeEntry.startPosition.y
            === windowPrimeEntry.targetPosition.y
        && windowPrimeEntry.velocity?.x > 0
        && windowPrimeEntry.velocity?.y === 0
        && windowPrimeEntry.previousDistance > windowPrimeEntry.contactRadius
        && windowPrimeEntry.predictedDistance > 0
        && windowPrimeEntry.predictedDistance < windowPrimeEntry.contactRadius
        && Math.abs(
            windowPrimeEntry.targetPosition.x
                - windowPrimeEntry.startPosition.x
                - windowPrimeEntry.previousDistance
        ) <= 0.000001
        && Math.abs(
            windowPrimeEntry.previousDistance
                - (windowPrimeEntry.velocity.x / 60)
                - windowPrimeEntry.predictedDistance
        ) <= 0.000001
        && windowPrime.targetHpBefore === 30
        && windowPrime.targetHpAfter === 29
        && windowPrime.damageFixedPoint === 100
        && windowPrime.maximumDamageWindow === true
        && windowPrime.peakFinalDamageFixedPoint === 100
        && windowPrime.expiresAtFixedTick === 65
        && windowPrime.peakSourceEntityId
            === windowPrime.projectileHandle.entityId
        && windowPrime.peakSourceIncarnation
            === windowPrime.projectileHandle.incarnation
        && typeof windowPrime.projectileDeath?.reason === 'string'
        && Number.isSafeInteger(windowPrime.projectileDeath?.sourceTick)
        && typeof windowPrime.projectileDeath?.disposition === 'string'
        && windowPrime.terminalCleanupExact === true
        && impact?.targetHpBefore === 29
        && impact.targetHpAfter === 25
        && impact.wrongTowerHpBefore === 30
        && impact.wrongTowerHpAfter === 30
        && impact.coreHealthAfter === impact.coreHealthBefore
        && impact.coreUnchanged === true
        && impact.wrongTowerUnchanged === true
        && impact.noSourceRevalidation === true
        && impact.projectileDamageFixedPoint === 500
        && impact.appliedDamageFixedPoint === 400
        && impact.maximumDamageWindow === true
        && impact.directDiscreteDamage === false
        && impact.commonMaximumDamageWindow === true
        && impact.windowActiveBeforeImpact === true
        && impact.sourceTick < windowPrime.expiresAtFixedTick
        && impact.windowPeakBeforeImpactFixedPoint === 100
        && impact.windowPeakAfterImpactFixedPoint === 500
        && impact.windowExpiryBeforeImpact === windowPrime.expiresAtFixedTick
        && impact.windowExpiryAfterImpact === impact.sourceTick + 60
        && impact.windowExpiryAfterImpact > impact.windowExpiryBeforeImpact
        && impact.windowStatePreserved === false
        && impact.windowStateReset === true
        && impact.projectileSelfBudgetBefore === 1
        && typeof impact.projectileDeath?.reason === 'string'
        && Number.isSafeInteger(impact.projectileDeath?.sourceTick)
        && typeof impact.projectileDeath?.disposition === 'string'
        && impact.wrongOrCoreDamageEventCount === 0
        && cleanup?.terminalCleanupExact === true
        && cleanup.projectileRegistryPresent === false
        && cleanup.projectileBackendPresent === false
        && cleanup.sourceRegistryPresent === false
        && cleanup.sourceBackendPresent === false
        && cleanup.noRevive === true
        && cleanup.targetHpAfterCleanup === 25
        && cleanup.activeCount === 3
        && cleanup.activeProjectileCount === 0
        && cleanup.reservedCount === 0
        && cleanup.pendingCommandCount === 0
        && runtime?.recoveryRequired === false
        && runtime.endpointRequiresRecovery === false
        && runtime.storageMaximum === 9
        && runtime.pendingEventReadbacks === 0
        && runtime.pendingSpawnProgramReadbacks === 0
        && runtime.uncapturedErrorCount === 0
        && runtime.deviceTeardownExpected === 'destroyed';
    return { fixture, scenarioValid };
}
