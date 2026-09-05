import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const gameObjectSystemUrl = new URL(
    '../project/game/script/module/ingame/object/game_object_system.js',
    import.meta.url
);
const lifecycleOwnerUrl = new URL(
    '../project/game/script/module/ingame/object/enemy/enemy_lifecycle_command_owner.js',
    import.meta.url
);
const routeShaderUrl = new URL(
    '../project/game/script/module/ingame/physics/gpu/gpu_atomic_transform_runtime_shaders.js',
    import.meta.url
);
const formationShaderUrl = new URL(
    '../project/game/script/module/ingame/physics/gpu/gpu_formation_runtime_shaders.js',
    import.meta.url
);
const routeRuntimeShaderUrl = new URL(
    '../project/game/script/module/ingame/physics/gpu/gpu_route_runtime_shaders.js',
    import.meta.url
);
const simulationUrl = new URL(
    '../project/game/script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    import.meta.url
);
const endpointUrl = new URL(
    '../project/game/script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js',
    import.meta.url
);
const [
    gameObjectSource,
    lifecycleSource,
    routeShaderSource,
    formationShaderSource,
    routeRuntimeShaderSource,
    simulationSource,
    endpointSource
] = await Promise.all([
    readFile(fileURLToPath(gameObjectSystemUrl), 'utf8'),
    readFile(fileURLToPath(lifecycleOwnerUrl), 'utf8'),
    readFile(fileURLToPath(routeShaderUrl), 'utf8'),
    readFile(fileURLToPath(formationShaderUrl), 'utf8'),
    readFile(fileURLToPath(routeRuntimeShaderUrl), 'utf8'),
    readFile(fileURLToPath(simulationUrl), 'utf8'),
    readFile(fileURLToPath(endpointUrl), 'utf8')
]);

function assertOrdered(source, labels) {
    let previous = -1;
    for (const label of labels) {
        const index = source.indexOf(label, previous + 1);
        assert.ok(index > previous, `ordering marker가 없거나 역전되었습니다: ${label}`);
        previous = index;
    }
}

test('GameObject fixed boundary는 route completion을 generic event consumer보다 먼저 확정한다', () => {
    const fixedUpdateStart = gameObjectSource.indexOf('fixedUpdate(delta, proposedFixedTick');
    const fixedUpdateEnd = gameObjectSource.indexOf('\n    update(', fixedUpdateStart);
    const fixedUpdateSource = gameObjectSource.slice(fixedUpdateStart, fixedUpdateEnd);
    assertOrdered(fixedUpdateSource, [
        'commitCompletedRouteAvailabilityProgramsAtFixedBoundary',
        'corkRouteClosureDirector.observeCompletedPrograms',
        '#refreshCorkRouteClosureDirectorBindingAtIdleBoundary',
        'getRouteAvailabilityRuntimeStatus',
        'commitCompletedEventsAtFixedBoundary',
        'waveDirector?.queueSpawnsForFixedTick',
        'commitAtFixedBoundary',
        'corkRouteClosureDirector?.observeFixedCommit',
        'corkRouteClosureDirector?.observeLifecycle'
    ]);
    assert.match(
        fixedUpdateSource,
        /#refreshCorkRouteClosureDirectorBindingAtIdleBoundary/
    );
    assert.match(
        fixedUpdateSource,
        /corkRouteClosureDirector\?\.requiresRecovery\(\) === true/
    );
    const idleRefreshStart = gameObjectSource.indexOf(
        '    #refreshCorkRouteClosureDirectorBindingAtIdleBoundary('
    );
    const idleRefreshEnd = gameObjectSource.indexOf(
        '    #refreshProjectileCaptureDirectorBindingAtIdleBoundary(',
        idleRefreshStart
    );
    const idleRefreshSource = gameObjectSource.slice(
        idleRefreshStart,
        idleRefreshEnd
    );
    assertOrdered(idleRefreshSource, [
        'runtimeStatus.leaseCount === 0',
        'runtimeStatus.lifecycleReservationCount === 0',
        'runtimeStatus.queuedBatchCount === 0',
        'runtimeStatus.availabilityVersion === 1',
        'waveDirector.canResetRouteAvailabilityBinding',
        'director.resetGpuBinding',
        'waveDirector.resetRouteAvailabilityBinding'
    ]);
    assert.match(idleRefreshSource, /directorStatus\.terminal === null/);
    assert.match(idleRefreshSource, /runtimeStatus\.terminal === null/);
    assert.match(
        fixedUpdateSource,
        /observeCompletedPrograms\([\s\S]*#refreshCorkRouteClosureDirectorBindingAtIdleBoundary[\s\S]*observeRuntimeStatus/
    );
});

test('terminal은 Director close 후 endpoint ingress를 닫고 owner/backend/cleanup/roster 4증거로 봉인한다', () => {
    const terminalStart = gameObjectSource.indexOf(
        '    #beginTerminalFinalization(fixedTick, runFailedFact) {'
    );
    const terminalEnd = gameObjectSource.indexOf(
        '#settleTerminalRouteAvailabilityReadbacks(',
        terminalStart
    );
    const terminalCloseSource = gameObjectSource.slice(terminalStart, terminalEnd);
    assertOrdered(terminalCloseSource, [
        'corkRouteClosureDirector?.closeForTerminal',
        'enemySimulationEndpoint.closeGameplayIngress'
    ]);

    const sealStart = gameObjectSource.indexOf(
        '    #sealTerminalSuccess(fixedTick) {'
    );
    const sealEnd = gameObjectSource.indexOf(
        '    #sealTerminalFailure(stage, fixedTick, detail = null) {',
        sealStart
    );
    const sealSource = gameObjectSource.slice(sealStart, sealEnd);
    for (const marker of [
        'getTerminalRouteAvailabilityProgramCancelStatus',
        'routeAvailabilityTerminal?.owner',
        'routeAvailabilityTerminal?.backend',
        'routeAvailabilityTerminal?.lifecycleCleanup',
        'routeAvailabilitySettlementSubmitted',
        'routeAvailabilityRosterSealed',
        "'terminal-route-availability-settlement'",
        "'terminal-route-availability-roster-seal'"
    ]) {
        assert.ok(sealSource.includes(marker), `terminal route evidence 누락: ${marker}`);
    }
});

test('terminal Ring+Cork settlement은 submit 전후 재진입 모두 Capture T를 Route generic join보다 먼저 확정한다', () => {
    const submittedRetryStart = gameObjectSource.indexOf(
        "if (atomicBackend?.state === 'submitted')"
    );
    const submittedRetryEnd = gameObjectSource.indexOf(
        'const hasActiveBodies =',
        submittedRetryStart
    );
    assertOrdered(
        gameObjectSource.slice(submittedRetryStart, submittedRetryEnd),
        [
            '#settleTerminalProjectileCaptureReadbacks',
            '#settleTerminalRouteAvailabilityReadbacks'
        ]
    );

    const finalSubmitStart = gameObjectSource.indexOf(
        'const gpuSubmitted = this.enemySimulationEndpoint.fixedUpdate('
    );
    const finalSubmitEnd = gameObjectSource.indexOf(
        'this.enemySimulationPaused = false;',
        finalSubmitStart
    );
    assertOrdered(
        gameObjectSource.slice(finalSubmitStart, finalSubmitEnd),
        [
            '#settleTerminalProjectileCaptureReadbacks',
            '#settleTerminalRouteAvailabilityReadbacks'
        ]
    );
    const routeSettleStart = gameObjectSource.indexOf(
        '    #settleTerminalRouteAvailabilityReadbacks(fixedTick) {'
    );
    const routeSettleEnd = gameObjectSource.indexOf(
        '    #settleTerminalProjectileCaptureReadbacks(fixedTick) {',
        routeSettleStart
    );
    const routeSettleSource = gameObjectSource.slice(
        routeSettleStart,
        routeSettleEnd
    );
    assert.match(routeSettleSource, /observeCompletedPrograms\(programs\)/);
    assert.doesNotMatch(
        routeSettleSource,
        /getRouteAvailabilityRuntimeStatus\(\)/
    );
});

test('route endpoint는 generic 지연 중 exact bypass queue-front만 drain하고 terminal source-0 idle 합성을 금지한다', () => {
    const commitStart = endpointSource.indexOf(
        '    commitCompletedRouteAvailabilityProgramsAtFixedBoundary('
    );
    const commitEnd = endpointSource.indexOf(
        '    /**\n     * 완료된 GPU event batch를 현재 fixed 경계에서 lifecycle 명령으로 변환합니다.',
        commitStart
    );
    const commitSource = endpointSource.slice(commitStart, commitEnd);
    assertOrdered(commitSource, [
        'const genericExpectedSourceReady',
        'const allowIdleCompletion = exactIdle && !terminalEventBoundary',
        'const completedReadbackBypassReady',
        '&& !completedReadbackBypassReady)',
        'this.backend.drainCompletedRouteAvailabilityBatches(drained)',
        'if (allowIdleCompletion)',
        'const authenticatedReadbackBypass',
        '&& !authenticatedReadbackBypass)'
    ]);
    assert.match(
        commitSource,
        /runtimeStatus\.readbackBypassEligible === true[\s\S]*runtimeStatus\.completedReadbackBypassSourceTick[\s\S]*=== expectedSourceTick/
    );
    assert.match(
        commitSource,
        /batch\.readbackBypassed === true[\s\S]*batch\.lastEventBase === 0[\s\S]*batch\.lastEventCount === 0/
    );
    assert.match(
        commitSource,
        /terminalBackendStatus[\s\S]*replayProtocolStatus[\s\S]*lastCompletedRouteAvailabilityPrograms/
    );
    assert.doesNotMatch(
        commitSource,
        /if \(exactIdle\)[\s\S]{0,500}sourceTick: 0/
    );
});

test('replacement는 새 endpoint all-open Director를 먼저 만들고 old Director/endpoint를 폐기한 뒤 swap한다', () => {
    const restartStart = gameObjectSource.indexOf(
        '    restartGpuWorldAtSafeWaveBoundary() {'
    );
    const restartEnd = gameObjectSource.indexOf(
        'restartEnemyGpuWorldAtSafeWaveBoundary()',
        restartStart
    );
    const restartSource = gameObjectSource.slice(restartStart, restartEnd);
    assertOrdered(restartSource, [
        'replacementEndpoint.init(this.tileMap)',
        'replacementCorkRouteClosureDirector',
        '= this.corkRouteClosureDirector',
        '? this.#createCorkRouteClosureDirector(replacementEndpoint)',
        'this.corkRouteClosureDirector?.destroy()',
        'this.enemySimulationEndpoint.destroy()',
        'this.#installGpuEndpoint',
        'this.corkRouteClosureDirector',
        '= replacementCorkRouteClosureDirector'
    ]);
});

test('graph-enabled map은 unsupported route backend status를 Director binding으로 받지 않는다', () => {
    const protocolStart = gameObjectSource.indexOf(
        '    #readRouteAvailabilityProtocol(endpoint) {'
    );
    const protocolEnd = gameObjectSource.indexOf(
        '    #resetProjectileCaptureDirectorBinding(',
        protocolStart
    );
    const protocolSource = gameObjectSource.slice(protocolStart, protocolEnd);
    for (const marker of [
        'status.graphEnabled !== true',
        'status.closureCount !== expectedClosureCount',
        'status.availabilityVersion <= 0',
        'status.lifecycleReservationCount',
        'status.queuedBatchCount',
        'status.ingressOpen !== true',
        'status.runtimeStatus !== 0',
        'status.requiresRecovery !== false',
        'status.failure !== null'
    ]) {
        assert.ok(
            protocolSource.includes(marker),
            `route runtime protocol fail-close marker 누락: ${marker}`
        );
    }
});

test('lifecycle은 Cork exact activation 후 독립 spawn/despawn route sub-transaction을 게시한다', () => {
    for (const marker of [
        'materializeNaturalCorkRouteClosureActivation',
        'preflightRouteLifecycleBatch',
        'commitRouteLifecycleBatch',
        'cancelRouteLifecycleBatch',
        'routeRuntimeBinding'
    ]) {
        assert.ok(lifecycleSource.includes(marker), `route lifecycle marker 누락: ${marker}`);
    }
    const spawnStart = lifecycleSource.indexOf(
        '    #commitSpawns('
    );
    const spawnEnd = lifecycleSource.indexOf(
        '\n    #activateReservation(',
        spawnStart
    );
    const spawnSource = lifecycleSource.slice(spawnStart, spawnEnd);
    assertOrdered(spawnSource, [
        'reserveEntity',
        'materializeNaturalCorkRouteClosureActivation',
        'preflightRouteLifecycleBatch',
        'backend.spawnBodies',
        '#finalizeRouteSpawnTransaction'
    ]);

    const despawnStart = lifecycleSource.indexOf(
        '    #commitDespawns(commands, result, consumedCommandIds) {'
    );
    const despawnEnd = lifecycleSource.indexOf('#commitFormationAtomicTransformCommand(', despawnStart);
    const despawnSource = lifecycleSource.slice(despawnStart, despawnEnd);
    assertOrdered(despawnSource, [
        'copyEntityView',
        'preflightRouteLifecycleBatch',
        'backend.despawnBodies',
        'registry.remove',
        'commitRouteLifecycleBatch'
    ]);
});

test('H/J atomic transform은 GPU route plane을 source에서 복사하고 Z combination은 전용 lifecycle만 소유한다', () => {
    const atomicRouteCopyContract = [
        'source_route_state',
        'route_states.values[destination_slot]',
        'self_entity_id',
        'self_incarnation'
    ];
    assert.equal(
        atomicRouteCopyContract.every((marker) => routeShaderSource.includes(marker)),
        true,
        'GPU atomic transform route-plane source-copy/self-rekey 계약이 필요합니다.'
    );
    assert.match(
        lifecycleSource,
        /materializeNaturalCorkRouteClosureActivation[\s\S]*preflightRouteLifecycleBatch/
    );
    assert.doesNotMatch(
        lifecycleSource,
        /materializeNaturalCorkRouteClosureActivation\([\s\S]{0,200}#commitAtomicTransforms/
    );
});

test('Formation 2→1은 live motion-root route plane을 destination identity로 rekey한 뒤 body를 commit한다', () => {
    for (const marker of [
        'preflight_formation_route_rekeys',
        'commit_formation_route_state',
        'motion_root_slot',
        'source_route_state',
        'clear_formation_route_state(record.source_b_slot)',
        'record.destination_entity_id',
        'record.destination_incarnation'
    ]) {
        assert.ok(
            formationShaderSource.includes(marker),
            `Formation route rekey marker 누락: ${marker}`
        );
    }
    const formationCommitStart = simulationSource.indexOf(
        'if (!terminalFinalSubmit\n                && armedFormationTransform?.commitRequested)'
    );
    const formationCommitEnd = simulationSource.indexOf(
        '// 모든 independent capability는 movement 전 exact tick-start grid를 공유합니다.',
        formationCommitStart
    );
    assertOrdered(
        simulationSource.slice(formationCommitStart, formationCommitEnd),
        [
            'PREFLIGHT_TRANSFORMS',
            'PREFLIGHT_ROUTE_REKEYS',
            'PREFLIGHT_EFFECT_REKEYS',
            'SEAL_TRANSFORM',
            'REKEY_EFFECTS',
            'COMMIT_ROUTE_STATE',
            'COMMIT_BODIES'
        ]
    );
});

test('route-owned WAIT는 external Formation/Penta motion 뒤 grid 전 마지막 velocity 권위를 가진다', () => {
    for (const marker of [
        'enter_route_owned_wait',
        'restore_route_wait_base_velocity',
        'FLAG_DEFERRED_FLOW_RESUME',
        'enforce_route_owned_wait_after_external_motion'
    ]) {
        assert.ok(
            routeRuntimeShaderSource.includes(marker),
            `Route WAIT ownership marker 누락: ${marker}`
        );
    }
    const motionStart = simulationSource.indexOf(
        'GPU_FORMATION_RUNTIME_ENTRY_POINT.ADVANCE_MOTION'
    );
    const gridStart = simulationSource.indexOf(
        "this.#dispatchBodies(pass, 'build_grid')",
        motionStart
    );
    const gridEnd = simulationSource.indexOf(';', gridStart) + 1;
    assertOrdered(simulationSource.slice(motionStart, gridEnd), [
        'GPU_FORMATION_RUNTIME_ENTRY_POINT.ADVANCE_MOTION',
        'GPU_EFFECT_RUNTIME_ENTRY_POINT.ADVANCE_PENTA_NAVIGATION',
        'this.pipelines.routeRuntime.enforceWait',
        "this.#dispatchBodies(pass, 'build_grid')"
    ]);
});
