import {
    BASIC_CIRCLE_ENEMY_DATA
} from './production/script/data/object/enemy/basic_circle_enemy_data.js';
import {
    R3_SHOWCASE_SENTENCE_LOADOUT,
    R3_WORD_PROTOCOL_DATA
} from './production/script/data/word/r3_word_catalog_data.js';
import {
    BASIC_BULLET_PROJECTILE_DATA
} from './production/script/data/object/projectile/basic_bullet_data.js';
import {
    ABILITY_SLOT_ID
} from './production/script/module/ingame/contract/word_sentence_contract.js';
import {
    ABILITY_CREATION_ORIGIN_CODE,
    createAbilityEntityMetadata
} from './production/script/module/ingame/contract/ability_execution_contract.js';
import {
    ENEMY_LIFECYCLE_DISPOSITION_ID
} from './production/script/module/ingame/contract/enemy_lifecycle_disposition_contract.js';
import {
    GAMEPLAY_TEAM_ID
} from './production/script/module/ingame/contract/gameplay_team_contract.js';
import {
    createGpuCoreProxySpawnIntent,
    createGpuProjectileSpawnIntent,
    createGpuSimulationEndpoint
} from './production/script/module/ingame/gpu_simulation_endpoint.js';
import {
    createGpuEnemySpawnIntent
} from './production/script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js';
import {
    createGpuTowerSpawnIntent
} from './production/script/module/ingame/object/tower/gpu_tower_spawn_adapter.js';
import {
    HostileParticipationTracker
} from './production/script/module/ingame/state/hostile_participation_tracker.js';
import {
    CoreIntegrity
} from './production/script/module/ingame/state/core_integrity.js';
import {
    GoldLedger
} from './production/script/module/ingame/state/gold_ledger.js';
import {
    BountyRewardDirector
} from './production/script/module/ingame/object/enemy/bounty_reward_director.js';
import {
    CORE_IMPACT_FACT_TYPE,
    EnemyCoreImpactDirector
} from './production/script/module/ingame/object/enemy/enemy_core_impact_director.js';
import {
    ActorPayloadMaterializer
} from './production/script/module/ingame/word/actor_payload_materializer.js';
import {
    ABILITY_EXECUTION_STATE,
    AbilityRuntime
} from './production/script/module/ingame/word/ability_runtime.js';
import {
    ABILITY_ACTIVATION_RESULT_CODE,
    ABILITY_EXECUTION_OUTCOME_CODE,
    WordSystem
} from './production/script/module/ingame/word/word_system.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const FIXED_DELTA = 1 / 60;
const REQUIRED_STORAGE_BUFFER_LIMIT = 9;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function createPlatformPort(device) {
    return Object.freeze({
        getState: () => Object.freeze({
            ready: true,
            status: 'ready',
            deviceGeneration: 1
        }),
        getDevice: () => device,
        getCanvasFormat: () => navigator.gpu.getPreferredCanvasFormat(),
        getDeviceGeneration: () => 1,
        acquireFrameTarget: () => null,
        clearCanvas: () => true,
        markCanvasDrawn() {},
        markCanvasCleared() {}
    });
}

function createNavigationSource(options = {}) {
    const columns = options.columns ?? 32;
    const rows = options.rows ?? 24;
    const corePosition = Object.freeze({
        x: options.coreX ?? columns - 4,
        y: options.coreY ?? rows / 2,
        row: options.coreRow ?? Math.floor(rows / 2),
        column: options.coreColumn ?? columns - 4
    });
    const entryPosition = Object.freeze({
        x: options.entryX ?? 4,
        y: options.entryY ?? rows / 2,
        row: options.entryRow ?? Math.floor(rows / 2),
        column: options.entryColumn ?? 4
    });
    const route = Object.freeze({
        gateId: 'r3-enemy-word-gate',
        pathId: 'r3-enemy-word-route',
        waypoints: Object.freeze([entryPosition, corePosition])
    });
    return Object.freeze({
        corePosition,
        route,
        getNavigationGrid: () => Object.freeze({
            cols: columns,
            rows,
            size: columns * rows,
            cellSize: 1,
            sdfSubdivisions: 8,
            blocked: new Uint8Array(columns * rows)
        }),
        getSpawnRoutes: () => Object.freeze([route]),
        getWorldBounds: () => Object.freeze({
            minX: 0,
            minY: 0,
            maxX: columns,
            maxY: rows,
            width: columns,
            height: rows
        })
    });
}

function nextTask() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(device, readStatus, predicate, label) {
    for (let attempt = 0; attempt < 180; attempt++) {
        await device.queue.onSubmittedWorkDone();
        await nextTask();
        const status = readStatus();
        if (predicate(status)) return status;
        if (status?.requiresRecovery === true) {
            throw new Error(`${label} recovery: ${JSON.stringify(status)}`);
        }
    }
    throw new Error(`${label} timeout: ${JSON.stringify(readStatus())}`);
}

async function openGenericBoundary(device, endpoint, fixedTick) {
    const orderedDomains = Object.freeze([
        'commitCompletedProjectileCaptureProgramsAtFixedBoundary',
        'commitCompletedProjectileCaptureReleaseProgramsAtFixedBoundary',
        'commitCompletedAtomicTransformProgramsAtFixedBoundary',
        'commitCompletedEffectProgramsAtFixedBoundary',
        'commitCompletedFormationProgramsAtFixedBoundary',
        'commitCompletedEventsAtFixedBoundary'
    ]);
    let completed = null;
    for (const method of orderedDomains) {
        for (let attempt = 0; attempt < 180; attempt++) {
            completed = endpoint[method](fixedTick);
            if (completed.pending !== true) break;
            await device.queue.onSubmittedWorkDone();
            await nextTask();
        }
        assert(completed?.pending !== true,
            `${method} boundary ${fixedTick} timeout`);
        assert(!completed?.protocolFailure,
            `${method} protocol 실패: ${JSON.stringify(completed)}`);
    }
    return completed;
}

function createHarness(device, capacity, navigationOptions = {}) {
    const navigationSource = createNavigationSource(navigationOptions);
    let coreCleanupBinding = null;
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPlatformPort(device),
        coreImpactCleanupPortReceiver(binding) {
            coreCleanupBinding = binding;
        }
    }, {
        capacity,
        abilitySubjectCommandCapacity: 4,
        abilitySubjectCapacity: 1000,
        abilitySubjectReadbackSlotCount: 3,
        actorPayloadCommandCapacity: 4,
        actorPayloadReadbackSlotCount: 3
    });
    endpoint.init(navigationSource);
    const wordSystem = new WordSystem({
        loadout: R3_SHOWCASE_SENTENCE_LOADOUT,
        ...(navigationOptions.generationLimit === undefined
            ? null
            : {
                compilerOptions: {
                    protocol: {
                        ...R3_WORD_PROTOCOL_DATA,
                        generationLimit: navigationOptions.generationLimit
                    }
                }
            })
    });
    const abilityRuntime = new AbilityRuntime({ wordSystem, endpoint });
    const materializer = new ActorPayloadMaterializer({
        abilityRuntime,
        endpoint
    });
    return {
        device,
        navigationSource,
        enemyFixtureLayout: navigationOptions.enemyFixtureLayout ?? null,
        endpoint,
        wordSystem,
        abilityRuntime,
        materializer,
        getCoreCleanupBinding: () => coreCleanupBinding,
        commandSequence: 0
    };
}

function requestSpawn(harness, intent, fixedTick, label) {
    const commandId = `r3:${label}:${harness.commandSequence++}`;
    const receipt = harness.endpoint.requestSpawn(intent, fixedTick, commandId);
    assert(receipt.accepted === true,
        `${label} spawn request 실패: ${JSON.stringify(receipt)}`);
    return commandId;
}

function requestEnemyBatch(harness, count, fixedTick, label) {
    const requests = Array.from({ length: count }, (_, index) => ({
        intent: createEnemyIntent(harness, index),
        targetFixedTick: fixedTick,
        commandId: `r3:${label}:${harness.commandSequence++}`
    }));
    const receipt = harness.endpoint.requestSpawnBatch(requests);
    assert(receipt.accepted === true && receipt.queuedCount === count,
        `${label} spawn batch 실패: ${JSON.stringify(receipt)}`);
    return receipt;
}

function createEnemyIntent(harness, index) {
    const layout = harness.enemyFixtureLayout;
    const columnCount = layout?.columnCount ?? 40;
    const rowCount = layout?.rowCount ?? 25;
    const column = index % columnCount;
    const row = Math.floor(index / columnCount) % rowCount;
    return createGpuEnemySpawnIntent({
        definition: BASIC_CIRCLE_ENEMY_DATA,
        route: harness.navigationSource.route,
        spawnSequence: index,
        laneOffsetTiles: 0,
        initialWorldOffsetTiles: Object.freeze({
            x: (layout?.startX ?? -3)
                + column * (layout?.spacingX ?? 0.76),
            y: (layout?.startY ?? -9.5)
                + row * (layout?.spacingY ?? 0.76)
        }),
        waveId: 'r3-enemy-word-fixture',
        policyId: 'r3-enemy-word-natural'
    });
}

function sameHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

function spawnedHandlesOfKind(harness, commit, kindId) {
    const registry = harness.endpoint.getRegistry();
    return commit.spawned.map(({ handle }) => handle).filter((handle) => (
        registry.copyEntityView(handle, {})?.kindId === kindId
    ));
}

function synchronizeEnemyGenerations(harness, commit, generations) {
    const handles = spawnedHandlesOfKind(harness, commit, 'enemy');
    assert(handles.length === generations.length,
        `generation fixture cardinality 불일치: ${handles.length}/${generations.length}`);
    const registry = harness.endpoint.getRegistry();
    const backend = harness.endpoint.getBackend();
    const entries = handles.map((handle, index) => {
        const view = registry.copyEntityView(handle, {});
        const binding = backend.resolveExactAbilityBodySlot(handle);
        assert(view && binding && sameHandle(binding, handle),
            `generation fixture exact binding 누락: ${JSON.stringify(handle)}`);
        return Object.freeze({
            slot: binding.slot,
            metadata: createAbilityEntityMetadata(view, {
                generation: generations[index]
            })
        });
    });
    const synchronized = backend.synchronizeAbilityEntityMetadata(entries);
    assert(synchronized.accepted === true
        && synchronized.updatedCount === generations.length,
    `generation metadata sync 실패: ${JSON.stringify(synchronized)}`);
    return Object.freeze(handles);
}

async function readBodies(harness) {
    const backend = harness.endpoint.getBackend();
    const pending = backend.simulation.readbackBodies();
    await harness.device.queue.onSubmittedWorkDone();
    return pending;
}

function findBody(bodies, handle) {
    return bodies.find((body) => sameHandle(body.handle, handle)) ?? null;
}

function snapshotStatus(harness) {
    return Object.freeze({
        endpoint: harness.endpoint.getStatus(),
        ability: harness.abilityRuntime.getStatus(),
        payload: harness.materializer.getStatus(),
        word: harness.wordSystem.getStatusView()
    });
}

function getStorageMaximum(status) {
    return Math.max(
        status.endpoint.abilitySubjectSnapshots.storageBindingCount ?? 0,
        status.endpoint.actorPayloadMaterializations.storageBindingCount ?? 0
    );
}

function createCastMetrics() {
    return {
        snapshotLatencyMs: null,
        materializationLatencyMs: null,
        abilityCommandHighWater: 0,
        abilityReadbackHighWater: 0,
        payloadCommandHighWater: 0,
        payloadReadbackHighWater: 0,
        payloadStageRetryCount: 0
    };
}

function sampleCastHighWater(harness, metrics) {
    const ability = harness.endpoint.getAbilitySubjectSnapshotStatus();
    const payload = harness.endpoint.getActorPayloadMaterializationStatus();
    metrics.abilityCommandHighWater = Math.max(
        metrics.abilityCommandHighWater,
        ability.pendingCommandCount ?? 0
    );
    metrics.abilityReadbackHighWater = Math.max(
        metrics.abilityReadbackHighWater,
        ability.pendingReadbackCount ?? 0
    );
    metrics.payloadCommandHighWater = Math.max(
        metrics.payloadCommandHighWater,
        payload.pendingCount ?? 0
    );
    metrics.payloadReadbackHighWater = Math.max(
        metrics.payloadReadbackHighWater,
        payload.inFlightCount ?? 0
    );
}

function freezeCastMetrics(metrics) {
    return Object.freeze({ ...metrics });
}

async function executeCast(harness, slotId, fixedTick, options = {}) {
    const {
        device,
        endpoint,
        wordSystem,
        abilityRuntime,
        materializer
    } = harness;
    const metrics = createCastMetrics();
    await openGenericBoundary(device, endpoint, fixedTick);
    wordSystem.beginFixedTick(fixedTick);
    const activation = wordSystem.requestSlotActivation(slotId, {
        aimViewport: options.aimPoint ?? { x: 24, y: 12 }
    });
    assert(activation.code === ABILITY_ACTIVATION_RESULT_CODE.REQUESTED,
        `activation 실패: ${JSON.stringify(activation)}`);
    const staged = abilityRuntime.stageForFixedTick({
        targetFixedTick: fixedTick
    });
    assert(staged.acceptedCount === 1,
        `ability stage 실패: ${JSON.stringify(staged)}`);
    sampleCastHighWater(harness, metrics);
    const commit = endpoint.commitAtFixedBoundary(fixedTick);
    assert(commit.recoveryRequired !== true
        && commit.rejected.length === 0,
    `cast lifecycle commit 실패: ${JSON.stringify(commit)}`);
    options.afterLifecycleCommit?.({ harness, commit });
    const snapshotStartedAt = performance.now();
    assert(endpoint.fixedUpdate(FIXED_DELTA, fixedTick),
        `ability fixed submit ${fixedTick} 실패`);
    sampleCastHighWater(harness, metrics);
    await waitFor(
        device,
        () => endpoint.getAbilitySubjectSnapshotStatus(),
        (status) => status.pendingReadbackCount === 0
            && status.completedQueueCount > 0,
        `ability completion ${fixedTick}`
    );
    metrics.snapshotLatencyMs = performance.now() - snapshotStartedAt;
    sampleCastHighWater(harness, metrics);
    const abilityObservation = abilityRuntime
        .observeCompletedSubjectSnapshots(fixedTick + 1);
    assert(abilityObservation.recoveryRequired !== true,
        `ability observe 실패: ${JSON.stringify(abilityObservation)}`);
    const outcomeAfterSubject = wordSystem.getStatusView().lastExecutionOutcome;
    if (abilityObservation.readyCount === 0) {
        return Object.freeze({
            activation,
            commit,
            abilityObservation,
            payloadStage: null,
            payloadObservation: null,
            outcome: outcomeAfterSubject,
            nextFixedTick: fixedTick + 1,
            metrics: freezeCastMetrics(metrics),
            status: snapshotStatus(harness)
        });
    }

    options.beforeMaterialization?.({ harness, commit });
    let payloadStage = null;
    let payloadBoundaryOpened = false;
    for (let attempt = 0; attempt < 180; attempt++) {
        payloadStage = materializer.stageReadyForFixedTick({
            targetFixedTick: fixedTick + 1
        });
        sampleCastHighWater(harness, metrics);
        if (payloadStage.stagedCount > 0
            || payloadStage.rejectedCount > 0
            || payloadStage.recoveryRequired === true) {
            break;
        }
        metrics.payloadStageRetryCount++;
        if (!payloadBoundaryOpened) {
            await openGenericBoundary(device, endpoint, fixedTick + 1);
            payloadBoundaryOpened = true;
        } else {
            await device.queue.onSubmittedWorkDone();
            await nextTask();
        }
    }
    assert(payloadStage !== null,
        `payload stage 결과 누락: fixedTick=${fixedTick + 1}`);
    assert(payloadStage.recoveryRequired !== true,
        `payload stage recovery: ${JSON.stringify({
            payloadStage,
            materializer: materializer.getStatus(),
            endpoint: endpoint.getActorPayloadMaterializationStatus()
        })}`);
    assert(payloadStage.stagedCount > 0 || payloadStage.rejectedCount > 0,
        `payload stage retry timeout: ${JSON.stringify(payloadStage)}`);
    if (payloadStage.stagedCount === 0) {
        return Object.freeze({
            activation,
            commit,
            abilityObservation,
            payloadStage,
            payloadObservation: null,
            outcome: wordSystem.getStatusView().lastExecutionOutcome,
            nextFixedTick: fixedTick + 1,
            metrics: freezeCastMetrics(metrics),
            status: snapshotStatus(harness)
        });
    }

    if (!payloadBoundaryOpened) {
        await openGenericBoundary(device, endpoint, fixedTick + 1);
    }
    const payloadCommit = endpoint.commitAtFixedBoundary(fixedTick + 1);
    assert(payloadCommit.recoveryRequired !== true,
        `payload lifecycle commit 실패: ${JSON.stringify(payloadCommit)}`);
    const materializationStartedAt = performance.now();
    assert(endpoint.fixedUpdate(FIXED_DELTA, fixedTick + 1),
        `payload fixed submit ${fixedTick + 1} 실패`);
    sampleCastHighWater(harness, metrics);
    await waitFor(
        device,
        () => endpoint.getActorPayloadMaterializationStatus(),
        (status) => status.inFlightCount === 0
            && status.completedQueueCount > 0,
        `payload completion ${fixedTick + 1}`
    );
    metrics.materializationLatencyMs
        = performance.now() - materializationStartedAt;
    sampleCastHighWater(harness, metrics);
    const payloadObservation = materializer.observeCompleted(fixedTick + 2);
    assert(payloadObservation.recoveryRequired !== true
        && payloadObservation.committedCount === 1,
    `payload observe 실패: ${JSON.stringify({
        payloadObservation,
        outcome: wordSystem.getStatusView().lastExecutionOutcome,
        materializer: materializer.getStatus(),
        endpoint: endpoint.getActorPayloadMaterializationStatus()
    })}`);
    return Object.freeze({
        activation,
        commit,
        abilityObservation,
        payloadStage,
        payloadObservation,
        outcome: wordSystem.getStatusView().lastExecutionOutcome,
        nextFixedTick: fixedTick + 2,
        metrics: freezeCastMetrics(metrics),
        status: snapshotStatus(harness)
    });
}

async function destroyHarness(harness) {
    harness.materializer.destroy();
    harness.abilityRuntime.destroy();
    harness.wordSystem.destroy();
    harness.endpoint.destroy();
    await harness.device.queue.onSubmittedWorkDone();
}

async function runTowerSourceDeathScenario(device) {
    const harness = createHarness(device, 2);
    try {
        const towerCommandId = requestSpawn(
            harness,
            createGpuTowerSpawnIntent({ position: { x: 20, y: 12 } }),
            1,
            'tower-source'
        );
        const cast = await executeCast(harness, ABILITY_SLOT_ID.Q, 1, {
            aimPoint: { x: 24, y: 12 },
            beforeMaterialization({ harness: activeHarness, commit }) {
                const towerHandle = commit.spawned.find(
                    ({ commandId }) => commandId === towerCommandId
                )?.handle;
                assert(towerHandle, 'source death Tower handle 누락');
                const receipt = activeHarness.endpoint.requestDespawn(
                    towerHandle,
                    'r3-source-death-after-snapshot',
                    2,
                    'r3:source-death'
                );
                assert(receipt.accepted === true,
                    `source death request 실패: ${JSON.stringify(receipt)}`);
            }
        });
        const registry = harness.endpoint.getRegistry();
        const status = snapshotStatus(harness);
        assert(cast.outcome.code === ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED
            && cast.outcome.subjectCount === 1
            && cast.outcome.generatedCount === 1,
        `Tower sentence 결과 불일치: ${JSON.stringify(cast.outcome)}`);
        assert(registry.getActiveCount('tower') === 0
            && registry.getActiveCount('enemy') === 1,
        `source death publication 불일치: ${JSON.stringify(status.endpoint)}`);
        return Object.freeze({
            subjectCount: cast.outcome.subjectCount,
            generatedCount: cast.outcome.generatedCount,
            sourceDeathAfterSnapshot: true,
            activeTowerCount: registry.getActiveCount('tower'),
            activeEnemyCount: registry.getActiveCount('enemy'),
            terminalState: status.ability.lastExecutionState.state,
            stateSequence: status.ability.executionStateHistory.map(
                ({ state }) => state
            ),
            cooldownConsumed: cast.outcome.cooldownConsumed,
            storageMaximum: getStorageMaximum(status),
            recoveryRequired: status.endpoint.recoveryRequired
                || status.ability.recoveryRequired
                || status.payload.recoveryRequired
        });
    } finally {
        await destroyHarness(harness);
    }
}

async function runRecursionScenario(device) {
    const harness = createHarness(device, 48);
    try {
        requestSpawn(
            harness,
            createGpuTowerSpawnIntent({ position: { x: 20, y: 12 } }),
            1,
            'recursion-tower'
        );
        for (let index = 0; index < 10; index++) {
            requestSpawn(harness, createEnemyIntent(harness, index), 1,
                `recursion-enemy-${index}`);
        }
        const first = await executeCast(harness, ABILITY_SLOT_ID.E, 1);
        const afterFirst = harness.endpoint.getRegistry().getActiveCount('enemy');
        const second = await executeCast(
            harness,
            ABILITY_SLOT_ID.E,
            first.nextFixedTick
        );
        const afterSecond = harness.endpoint.getRegistry().getActiveCount('enemy');
        const status = snapshotStatus(harness);
        assert(first.outcome.subjectCount === 10
            && first.outcome.generatedCount === 10
            && afterFirst === 20
            && second.outcome.subjectCount === 20
            && second.outcome.generatedCount === 20
            && afterSecond === 40,
        `10→20→40 recursion 불일치: ${JSON.stringify({
            first: first.outcome,
            afterFirst,
            second: second.outcome,
            afterSecond
        })}`);
        return Object.freeze({
            enemyCounts: Object.freeze([10, afterFirst, afterSecond]),
            subjectCounts: Object.freeze([
                first.outcome.subjectCount,
                second.outcome.subjectCount
            ]),
            generatedCounts: Object.freeze([
                first.outcome.generatedCount,
                second.outcome.generatedCount
            ]),
            sameExecutionExcluded: first.outcome.subjectCount === 10
                && first.outcome.generatedCount === 10,
            storageMaximum: getStorageMaximum(status),
            recoveryRequired: status.endpoint.recoveryRequired
                || status.ability.recoveryRequired
                || status.payload.recoveryRequired
        });
    } finally {
        await destroyHarness(harness);
    }
}

function collectStressReceipt(harness, cast) {
    const status = snapshotStatus(harness);
    const gpu = status.endpoint.backend?.gpu ?? {};
    const tracker = new HostileParticipationTracker();
    const participation = tracker.refresh(
        harness.endpoint.getRegistry(),
        harness.endpoint.getPendingHostileParticipationView()
    );
    tracker.destroy();
    return Object.freeze({
        subjectCount: cast.outcome.subjectCount,
        generatedCount: cast.outcome.generatedCount,
        activeEnemyCount: status.endpoint.activeEnemyCount,
        snapshotLatencyMs: cast.metrics.snapshotLatencyMs,
        materializationLatencyMs: cast.metrics.materializationLatencyMs,
        bodyHighWater: gpu.bodyCountHighWater
            ?? status.endpoint.activeCount,
        activeBodyHighWater: gpu.activeBodyCountHighWater
            ?? status.endpoint.activeCount,
        preleasedBodyHighWater: cast.outcome.generatedCount,
        preleaseTransactionHighWater:
            status.endpoint.actorPayloadMaterializations
                .bodyPreleaseHighWater ?? 0,
        commandReadbackHighWater: Object.freeze({
            abilityCommand: cast.metrics.abilityCommandHighWater,
            abilityReadback: cast.metrics.abilityReadbackHighWater,
            payloadCommand: cast.metrics.payloadCommandHighWater,
            payloadReadback: cast.metrics.payloadReadbackHighWater,
            payloadStageRetries: cast.metrics.payloadStageRetryCount
        }),
        gold: 0,
        hostileActorCount: participation.hostileActorCount,
        pendingHostileActorCount:
            participation.pendingHostileActorCount,
        siegeWeight: participation.siegeWeight,
        postExecutionCapacityView: harness.endpoint.getActorPayloadCapacityView(
            cast.outcome.subjectCount
        ),
        actorPayloadFailure:
            status.endpoint.actorPayloadMaterializations.failure ?? null,
        backendPreleaseFailure:
            status.endpoint.actorPayloadMaterializations.preleaseFailure
                ?? null,
        materializerFailure: status.payload.failure ?? null,
        storageMaximum: getStorageMaximum(status),
        protocolFailureCount:
            status.endpoint.events.protocolFailure ? 1 : 0,
        recoveryRequired: status.endpoint.recoveryRequired
            || status.ability.recoveryRequired
            || status.payload.recoveryRequired
    });
}

async function runFanoutScenario(device, subjectCount) {
    const harness = createHarness(device, subjectCount * 2, {
        columns: 128,
        rows: 128,
        entryX: 16,
        entryY: 32,
        entryColumn: 16,
        entryRow: 32,
        coreX: 120,
        coreY: 64,
        coreColumn: 120,
        coreRow: 64,
        enemyFixtureLayout: Object.freeze({
            columnCount: 40,
            rowCount: 25,
            startX: 0,
            startY: 0,
            spacingX: 2.4,
            spacingY: 2.4
        })
    });
    try {
        requestEnemyBatch(
            harness,
            subjectCount,
            1,
            `fanout-${subjectCount}`
        );
        const cast = await executeCast(harness, ABILITY_SLOT_ID.E, 1);
        const receipt = collectStressReceipt(harness, cast);
        assert(cast.outcome.code === ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED
            && receipt.subjectCount === subjectCount
            && receipt.generatedCount === subjectCount
            && receipt.activeEnemyCount === subjectCount * 2
            && receipt.hostileActorCount === subjectCount * 2
            && receipt.pendingHostileActorCount === 0
            && receipt.protocolFailureCount === 0
            && receipt.recoveryRequired === false,
        `${subjectCount} fanout 불일치: ${JSON.stringify({
            outcome: cast.outcome,
            receipt
        })}`);
        return receipt;
    } finally {
        await destroyHarness(harness);
    }
}

async function runDoublingBoundaryScenario(device) {
    const harness = createHarness(device, 1000, {
        columns: 128,
        rows: 128,
        entryX: 32,
        entryY: 64,
        entryColumn: 32,
        entryRow: 64,
        coreX: 112,
        coreY: 64,
        coreColumn: 112,
        coreRow: 64,
        enemyFixtureLayout: Object.freeze({
            columnCount: 5,
            rowCount: 2,
            startX: -16,
            startY: -12,
            spacingX: 10,
            spacingY: 24
        })
    });
    try {
        requestEnemyBatch(harness, 10, 1, 'doubling-boundary');
        const enemyCounts = [10];
        const subjectCounts = [];
        const generatedCounts = [];
        const latencies = [];
        const highWater = {
            abilityCommand: 0,
            abilityReadback: 0,
            payloadCommand: 0,
            payloadReadback: 0,
            payloadStageRetries: 0
        };
        let fixedTick = 1;
        let rejection = null;
        for (let attempt = 0; attempt < 16; attempt++) {
            const cast = await executeCast(
                harness,
                ABILITY_SLOT_ID.E,
                fixedTick
            );
            subjectCounts.push(cast.outcome.subjectCount);
            generatedCounts.push(cast.outcome.generatedCount);
            latencies.push(Object.freeze({
                snapshotLatencyMs: cast.metrics.snapshotLatencyMs,
                materializationLatencyMs:
                    cast.metrics.materializationLatencyMs
            }));
            highWater.abilityCommand = Math.max(
                highWater.abilityCommand,
                cast.metrics.abilityCommandHighWater
            );
            highWater.abilityReadback = Math.max(
                highWater.abilityReadback,
                cast.metrics.abilityReadbackHighWater
            );
            highWater.payloadCommand = Math.max(
                highWater.payloadCommand,
                cast.metrics.payloadCommandHighWater
            );
            highWater.payloadReadback = Math.max(
                highWater.payloadReadback,
                cast.metrics.payloadReadbackHighWater
            );
            highWater.payloadStageRetries = Math.max(
                highWater.payloadStageRetries,
                cast.metrics.payloadStageRetryCount
            );
            if (cast.outcome.code
                === ABILITY_EXECUTION_OUTCOME_CODE.DESTINATION_CAPACITY_REJECTED) {
                rejection = cast;
                break;
            }
            assert(cast.outcome.code
                === ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED,
            `doubling execution 실패: ${JSON.stringify(cast.outcome)}`);
            enemyCounts.push(
                harness.endpoint.getRegistry().getActiveCount('enemy')
            );
            fixedTick = cast.nextFixedTick;
        }
        const status = snapshotStatus(harness);
        const tracker = new HostileParticipationTracker();
        const participation = tracker.refresh(
            harness.endpoint.getRegistry(),
            harness.endpoint.getPendingHostileParticipationView()
        );
        tracker.destroy();
        assert(enemyCounts.join(',') === '10,20,40,80,160,320,640'
            && subjectCounts.join(',') === '10,20,40,80,160,320,640'
            && generatedCounts.join(',') === '10,20,40,80,160,320,0'
            && rejection?.outcome.generatedCount === 0
            && rejection.outcome.cooldownConsumed === false
            && harness.endpoint.getRegistry().getReservedCount() === 0
            && participation.hostileActorCount === 640
            && status.endpoint.recoveryRequired === false,
        `doubling capacity boundary 불일치: ${JSON.stringify({
            enemyCounts,
            subjectCounts,
            generatedCounts,
            rejection: rejection?.outcome,
            participation,
            status
        })}`);
        return Object.freeze({
            capacity: 1000,
            enemyCounts: Object.freeze(enemyCounts),
            subjectCounts: Object.freeze(subjectCounts),
            generatedCounts: Object.freeze(generatedCounts),
            nextExecutionRejectedAtomically: true,
            rejectedGeneratedCount: rejection.outcome.generatedCount,
            rejectedCooldownConsumed: rejection.outcome.cooldownConsumed,
            registryReservedCount: harness.endpoint.getRegistry()
                .getReservedCount(),
            bodyHighWater: status.endpoint.backend?.gpu
                ?.bodyCountHighWater ?? status.endpoint.activeCount,
            preleaseTransactionHighWater:
                status.endpoint.actorPayloadMaterializations
                    .bodyPreleaseHighWater ?? 0,
            commandReadbackHighWater: Object.freeze({ ...highWater }),
            latencies: Object.freeze(latencies),
            gold: 0,
            hostileActorCount: participation.hostileActorCount,
            pendingHostileActorCount:
                participation.pendingHostileActorCount,
            siegeWeight: participation.siegeWeight,
            protocolFailureCount:
                status.endpoint.events.protocolFailure ? 1 : 0,
            recoveryRequired: status.endpoint.recoveryRequired
                || status.ability.recoveryRequired
                || status.payload.recoveryRequired
        });
    } finally {
        await destroyHarness(harness);
    }
}

async function runOneShortCapacityScenario(device) {
    const harness = createHarness(device, 1);
    try {
        requestSpawn(
            harness,
            createGpuTowerSpawnIntent({ position: { x: 20, y: 12 } }),
            1,
            'capacity-tower'
        );
        const cast = await executeCast(harness, ABILITY_SLOT_ID.Q, 1);
        const status = snapshotStatus(harness);
        assert(cast.payloadStage?.rejectedCount === 1
            && cast.outcome.code
                === ABILITY_EXECUTION_OUTCOME_CODE.DESTINATION_CAPACITY_REJECTED
            && cast.outcome.generatedCount === 0
            && cast.outcome.cooldownConsumed === false
            && status.ability.lastExecutionState.state
                === ABILITY_EXECUTION_STATE.REJECTED_CAPACITY,
        `one-short capacity 불일치: ${JSON.stringify({ cast, status })}`);
        return Object.freeze({
            rejected: true,
            generatedCount: cast.outcome.generatedCount,
            cooldownConsumed: cast.outcome.cooldownConsumed,
            terminalState: status.ability.lastExecutionState.state,
            recoveryRequired: status.endpoint.recoveryRequired
                || status.ability.recoveryRequired
                || status.payload.recoveryRequired
        });
    } finally {
        await destroyHarness(harness);
    }
}

async function runZeroSubjectScenario(device) {
    const harness = createHarness(device, 2);
    try {
        requestSpawn(harness, createEnemyIntent(harness, 0), 1, 'zero-enemy');
        const cast = await executeCast(harness, ABILITY_SLOT_ID.Q, 1);
        const status = snapshotStatus(harness);
        assert(cast.outcome.code === ABILITY_EXECUTION_OUTCOME_CODE.ZERO_SUBJECT
            && cast.outcome.subjectCount === 0
            && cast.outcome.generatedCount === 0
            && cast.outcome.cooldownConsumed === false
            && status.ability.lastExecutionState.state
                === ABILITY_EXECUTION_STATE.ZERO_SUBJECT,
        `zero subject 불일치: ${JSON.stringify({ cast, status })}`);
        return Object.freeze({
            subjectCount: cast.outcome.subjectCount,
            generatedCount: cast.outcome.generatedCount,
            cooldownConsumed: cast.outcome.cooldownConsumed,
            terminalState: status.ability.lastExecutionState.state,
            activeEnemyCount: harness.endpoint.getRegistry()
                .getActiveCount('enemy'),
            recoveryRequired: status.endpoint.recoveryRequired
                || status.ability.recoveryRequired
                || status.payload.recoveryRequired
        });
    } finally {
        await destroyHarness(harness);
    }
}

async function runGenerationBoundaryScenario(device) {
    let mixedHarness = createHarness(device, 6, { generationLimit: 3 });
    let allExcludedHarness = null;
    try {
        requestSpawn(
            mixedHarness,
            createGpuCoreProxySpawnIntent({
                position: mixedHarness.navigationSource.corePosition
            }),
            1,
            'generation-core'
        );
        requestEnemyBatch(mixedHarness, 2, 1, 'generation-mixed');
        const mixed = await executeCast(
            mixedHarness,
            ABILITY_SLOT_ID.E,
            1,
            {
                afterLifecycleCommit({ harness, commit }) {
                    synchronizeEnemyGenerations(harness, commit, [2, 3]);
                }
            }
        );
        const childHandle = mixed.payloadObservation?.committedHandles?.[0];
        const childView = childHandle
            ? mixedHarness.endpoint.getRegistry().copyEntityView(childHandle, {})
            : null;
        const nextExecution = await executeCast(
            mixedHarness,
            ABILITY_SLOT_ID.E,
            mixed.nextFixedTick
        );
        assert(mixed.outcome.code === ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED
            && mixed.outcome.subjectCount === 1
            && mixed.outcome.generatedCount === 1
            && childView?.metadata?.generation === null
            && childView.metadata.generationAuthority === 'GPU_ABILITY_METADATA'
            && nextExecution.outcome.code
                === ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED
            && nextExecution.outcome.subjectCount === 1
            && nextExecution.outcome.generatedCount === 1
            && mixedHarness.endpoint.getRegistry().getActiveCount('enemy') === 4,
        `generation mixed boundary 불일치: ${JSON.stringify({
            outcome: mixed.outcome,
            nextOutcome: nextExecution.outcome,
            childView,
            status: snapshotStatus(mixedHarness)
        })}`);
        const mixedResult = Object.freeze({
            generationLimit: 3,
            sourceGenerations: Object.freeze([2, 3]),
            subjectCount: mixed.outcome.subjectCount,
            generatedCount: mixed.outcome.generatedCount,
            nextExecutionSubjectCount: nextExecution.outcome.subjectCount,
            childGeneration: 3,
            childGenerationProof: 'excluded-from-next-generation-limit-3-cast',
            limitSourceExcluded: true,
            coreFallbackMaterialized: true,
            cooldownConsumed: mixed.outcome.cooldownConsumed,
            storageMaximum: getStorageMaximum(mixed.status),
            recoveryRequired: mixed.status.endpoint.recoveryRequired
                || mixed.status.ability.recoveryRequired
                || mixed.status.payload.recoveryRequired
        });
        await destroyHarness(mixedHarness);
        mixedHarness = null;

        allExcludedHarness = createHarness(device, 2, { generationLimit: 3 });
        requestEnemyBatch(allExcludedHarness, 2, 1, 'generation-all-excluded');
        const allExcluded = await executeCast(
            allExcludedHarness,
            ABILITY_SLOT_ID.E,
            1,
            {
                afterLifecycleCommit({ harness, commit }) {
                    synchronizeEnemyGenerations(harness, commit, [3, 3]);
                }
            }
        );
        const allExcludedStatus = snapshotStatus(allExcludedHarness);
        assert(allExcluded.outcome.code === ABILITY_EXECUTION_OUTCOME_CODE.ZERO_SUBJECT
            && allExcluded.outcome.subjectCount === 0
            && allExcluded.outcome.generatedCount === 0
            && allExcluded.outcome.cooldownConsumed === false
            && allExcludedStatus.endpoint.recoveryRequired === false
            && allExcludedStatus.ability.recoveryRequired === false
            && allExcludedStatus.payload.recoveryRequired === false,
        `generation all-excluded boundary 불일치: ${JSON.stringify({
            outcome: allExcluded.outcome,
            status: allExcludedStatus
        })}`);
        return Object.freeze({
            mixed: mixedResult,
            allExcluded: Object.freeze({
                sourceGenerations: Object.freeze([3, 3]),
                subjectCount: allExcluded.outcome.subjectCount,
                generatedCount: allExcluded.outcome.generatedCount,
                cooldownConsumed: allExcluded.outcome.cooldownConsumed,
                terminalState:
                    allExcludedStatus.ability.lastExecutionState.state,
                recoveryRequired: false
            })
        });
    } finally {
        if (mixedHarness) await destroyHarness(mixedHarness);
        if (allExcludedHarness) await destroyHarness(allExcludedHarness);
    }
}

async function runGeneratedEnemyGoldScenario(device) {
    const harness = createHarness(device, 4);
    const goldLedger = new GoldLedger();
    const bountyDirector = new BountyRewardDirector({
        goldLedger,
        sessionGeneration: harness.endpoint.getStatus().sessionGeneration
    });
    const tracker = new HostileParticipationTracker();
    let towerHandle = null;
    try {
        const towerCommandId = requestSpawn(
            harness,
            createGpuTowerSpawnIntent({ position: { x: 20, y: 12 } }),
            1,
            'gold-tower'
        );
        const cast = await executeCast(harness, ABILITY_SLOT_ID.Q, 1, {
            aimPoint: { x: 24, y: 12 },
            afterLifecycleCommit({ harness: activeHarness, commit }) {
                towerHandle = commit.spawned.find(
                    ({ commandId }) => commandId === towerCommandId
                )?.handle ?? null;
                assert(towerHandle, 'Gold fixture Tower handle 누락');
                const configured = activeHarness.endpoint
                    .configureTowerGameplayTarget(towerHandle);
                assert(configured.accepted === true,
                    `Gold fixture Tower target 실패: ${JSON.stringify(configured)}`);
            }
        });
        const generatedHandle = cast.payloadObservation?.committedHandles?.[0];
        const registry = harness.endpoint.getRegistry();
        const generatedView = generatedHandle
            ? registry.copyEntityView(generatedHandle, {})
            : null;
        assert(generatedView?.metadata?.abilityCreationOriginCode
                === ABILITY_CREATION_ORIGIN_CODE.SENTENCE_PAYLOAD
            && generatedView.metadata.rewardEligible === true
            && generatedView.metadata.bountyBudget === 1
            && generatedView.metadata.siegeWeight === 1,
        `generated Enemy provenance 불일치: ${JSON.stringify(generatedView)}`);
        const beforeKill = tracker.refresh(
            registry,
            harness.endpoint.getPendingHostileParticipationView()
        );
        assert(beforeKill.hostileActorCount === 1
            && beforeKill.siegeWeight === 1,
        `generated Enemy aggregate 불일치: ${JSON.stringify(beforeKill)}`);

        const bodies = await readBodies(harness);
        const generatedBody = findBody(bodies, generatedHandle);
        assert(generatedBody, 'generated Enemy GPU body 누락');
        requestSpawn(
            harness,
            createGpuProjectileSpawnIntent({
                definition: BASIC_BULLET_PROJECTILE_DATA,
                position: {
                    x: generatedBody.position.x - 0.65,
                    y: generatedBody.position.y
                },
                velocity: { x: 24, y: 0 },
                teamId: GAMEPLAY_TEAM_ID.PLAYER,
                sourceHandle: towerHandle,
                ownerHandle: towerHandle,
                targetHandle: generatedHandle,
                producerId: 'r3-gold-actual-player-projectile',
                sourceAbilityId: 'r3-gold-actual-lethal'
            }),
            3,
            'gold-player-projectile'
        );
        await openGenericBoundary(device, harness.endpoint, 3);
        const projectileCommit = harness.endpoint.commitAtFixedBoundary(3);
        assert(projectileCommit.recoveryRequired !== true
            && projectileCommit.rejected.length === 0,
        `Gold projectile commit 실패: ${JSON.stringify(projectileCommit)}`);
        assert(harness.endpoint.fixedUpdate(FIXED_DELTA, 3),
            'Gold projectile fixed submit 실패');
        await device.queue.onSubmittedWorkDone();

        const lethalEvents = await openGenericBoundary(
            device,
            harness.endpoint,
            4
        );
        const stagedClaims = bountyDirector.observeCompletedEvents(
            lethalEvents,
            registry
        );
        assert(stagedClaims.stagedClaimCount === 1,
            `Gold lethal proof 누락: ${JSON.stringify({ stagedClaims, lethalEvents })}`);
        const lifecycle = harness.endpoint.commitAtFixedBoundary(4);
        const playerKill = lifecycle.despawned.find((entry) => (
            sameHandle(entry.handle, generatedHandle)
        ));
        assert(playerKill?.disposition
                === ENEMY_LIFECYCLE_DISPOSITION_ID.PLAYER_KILL
            && playerKill.bountyEligible === true,
        `PLAYER_KILL lifecycle 누락: ${JSON.stringify(lifecycle)}`);
        const payout = bountyDirector.observeLifecycle(lifecycle, 4);
        const afterKill = tracker.refresh(
            registry,
            harness.endpoint.getPendingHostileParticipationView(),
            { lifecycle }
        );
        const replayClaims = bountyDirector.observeCompletedEvents(
            lethalEvents,
            registry
        );
        const replayPayout = bountyDirector.observeLifecycle(lifecycle, 4);
        assert(payout.payoutCount === 1
            && payout.payoutAmount === 1
            && goldLedger.getBalance() === 1
            && replayClaims.stagedClaimCount === 0
            && replayPayout.payoutCount === 0
            && afterKill.hostileActorCount === 0
            && afterKill.siegeWeight === 0,
        `Gold payout/replay 불일치: ${JSON.stringify({
            payout,
            replayClaims,
            replayPayout,
            afterKill,
            bounty: bountyDirector.getStatus()
        })}`);
        assert(harness.endpoint.fixedUpdate(FIXED_DELTA, 4),
            'Gold cleanup fixed submit 실패');
        await device.queue.onSubmittedWorkDone();
        const postCleanupBodies = await readBodies(harness);
        assert(!findBody(postCleanupBodies, generatedHandle)
            && registry.getActiveCount('enemy') === 0
            && registry.getActiveCount('projectile') === 0,
        `Gold registry/body cleanup 실패: ${JSON.stringify({
            bodies: postCleanupBodies,
            endpoint: harness.endpoint.getStatus()
        })}`);
        return Object.freeze({
            generatedCount: cast.outcome.generatedCount,
            sentenceProvenance: true,
            rewardEligible: generatedView.metadata.rewardEligible,
            bountyBudget: generatedView.metadata.bountyBudget,
            playerKillDisposition: playerKill.disposition,
            payoutCount: payout.payoutCount,
            payoutAmount: payout.payoutAmount,
            gold: goldLedger.getBalance(),
            replayPayoutAmount: replayPayout.payoutAmount,
            hostileBefore: beforeKill.hostileActorCount,
            hostileAfter: afterKill.hostileActorCount,
            siegeBefore: beforeKill.siegeWeight,
            siegeAfter: afterKill.siegeWeight,
            registryEnemyCount: registry.getActiveCount('enemy'),
            registryProjectileCount: registry.getActiveCount('projectile'),
            bodyCleanup: !findBody(postCleanupBodies, generatedHandle),
            storageMaximum: getStorageMaximum(snapshotStatus(harness)),
            recoveryRequired: harness.endpoint.requiresRecovery()
                || bountyDirector.requiresRecovery()
        });
    } finally {
        tracker.destroy();
        bountyDirector.destroy();
        goldLedger.destroy();
        await destroyHarness(harness);
    }
}

async function runGeneratedEnemyCoreImpactScenario(device) {
    const harness = createHarness(device, 4);
    const goldLedger = new GoldLedger();
    const bountyDirector = new BountyRewardDirector({
        goldLedger,
        sessionGeneration: harness.endpoint.getStatus().sessionGeneration
    });
    const coreIntegrity = new CoreIntegrity({ maxIntegrity: 100 });
    let coreDirector = null;
    let towerHandle = null;
    let coreHandle = null;
    try {
        const cleanupBinding = harness.getCoreCleanupBinding();
        assert(cleanupBinding?.port, 'Core impact cleanup port 누락');
        coreDirector = new EnemyCoreImpactDirector({
            coreIntegrity,
            endpoint: harness.endpoint,
            coreImpactCleanupPort: cleanupBinding.port
        });
        const towerCommandId = requestSpawn(
            harness,
            createGpuTowerSpawnIntent({ position: { x: 24.5, y: 12 } }),
            1,
            'core-impact-tower'
        );
        const coreCommandId = requestSpawn(
            harness,
            createGpuCoreProxySpawnIntent({ position: { x: 28, y: 12 } }),
            1,
            'core-impact-core'
        );
        const cast = await executeCast(harness, ABILITY_SLOT_ID.Q, 1, {
            aimPoint: { x: 28, y: 12 },
            afterLifecycleCommit({ harness: activeHarness, commit }) {
                towerHandle = commit.spawned.find(
                    ({ commandId }) => commandId === towerCommandId
                )?.handle ?? null;
                coreHandle = commit.spawned.find(
                    ({ commandId }) => commandId === coreCommandId
                )?.handle ?? null;
                assert(towerHandle && coreHandle,
                    'Core impact Tower/Core handle 누락');
                const configured = activeHarness.endpoint
                    .configureTowerGameplayTarget(towerHandle);
                assert(configured.accepted === true,
                    `Core impact Tower target 실패: ${JSON.stringify(configured)}`);
            }
        });
        const generatedHandle = cast.payloadObservation?.committedHandles?.[0];
        const registry = harness.endpoint.getRegistry();
        const generatedView = generatedHandle
            ? registry.copyEntityView(generatedHandle, {})
            : null;
        assert(generatedView?.metadata?.abilityCreationOriginCode
            === ABILITY_CREATION_ORIGIN_CODE.SENTENCE_PAYLOAD,
        `Core impact generated provenance 누락: ${JSON.stringify(generatedView)}`);

        let impactTick = null;
        let coreObservation = null;
        let coreStage = null;
        let coreCommit = null;
        let lifecycle = null;
        let stagedClaims = null;
        let payout = null;
        let impactFact = null;
        let coreImpact = null;
        for (let fixedTick = 3; fixedTick <= 32; fixedTick++) {
            const completed = await openGenericBoundary(
                device,
                harness.endpoint,
                fixedTick
            );
            const observation = coreDirector.observeCompletedEvents(
                completed,
                registry
            );
            const claims = bountyDirector.observeCompletedEvents(
                completed,
                registry
            );
            const stage = coreDirector.stageForFixedTick({
                endpoint: harness.endpoint,
                targetFixedTick: fixedTick
            });
            assert(stage.recoveryRequired !== true,
                `Core impact T${fixedTick} stage 실패: ${JSON.stringify(stage)}`);
            const fixedLifecycle = harness.endpoint.commitAtFixedBoundary(
                fixedTick
            );
            const commitObservation = coreDirector.observeFixedCommit(
                fixedLifecycle,
                fixedTick
            );
            const fixedPayout = bountyDirector.observeLifecycle(
                fixedLifecycle,
                fixedTick
            );
            const observedImpactFact = observation.facts?.find((fact) => (
                fact.type === CORE_IMPACT_FACT_TYPE.IMPACT
                    && sameHandle(fact.enemyHandle, generatedHandle)
            ));
            const observedCoreImpact = fixedLifecycle.despawned.find((entry) => (
                sameHandle(entry.handle, generatedHandle)
            ));
            assert(harness.endpoint.fixedUpdate(FIXED_DELTA, fixedTick),
                `Core impact T${fixedTick} fixed submit 실패`);
            await device.queue.onSubmittedWorkDone();
            if (observedImpactFact || observedCoreImpact) {
                impactTick = fixedTick;
                coreObservation = observation;
                coreStage = stage;
                coreCommit = commitObservation;
                lifecycle = fixedLifecycle;
                stagedClaims = claims;
                payout = fixedPayout;
                impactFact = observedImpactFact;
                coreImpact = observedCoreImpact;
                break;
            }
            assert(observation.recoveryRequired !== true
                && commitObservation.recoveryRequired !== true
                && claims.stagedClaimCount === 0
                && fixedPayout.payoutAmount === 0,
            `Core impact bounded wait 실패: tick=${fixedTick}, result=${JSON.stringify({ observation, stage, commitObservation, claims, fixedPayout })}`);
        }
        const stalledBodies = impactTick === null
            ? await readBodies(harness)
            : null;
        assert(impactFact
            && impactTick !== null
            && impactFact.bountyEligible === false
            && coreImpact?.disposition
                === ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
            && coreImpact.bountyEligible === false
            && stagedClaims.stagedClaimCount === 0
            && payout.payoutAmount === 0
            && goldLedger.getBalance() === 0
            && coreIntegrity.getCurrentIntegrity() === 99,
        `generated Enemy Core impact 불일치: ${JSON.stringify({
            impactTick,
            coreObservation,
            coreStage,
            coreCommit,
            lifecycle,
            stagedClaims,
            payout,
            stalledGeneratedBody: stalledBodies
                ? findBody(stalledBodies, generatedHandle)
                : null,
            stalledBodies,
            integrity: coreIntegrity.getCurrentIntegrity()
        })}`);
        const postCleanupBodies = await readBodies(harness);
        assert(!findBody(postCleanupBodies, generatedHandle)
            && registry.getActiveCount('enemy') === 0,
        `Core impact cleanup 실패: ${JSON.stringify({
            bodies: postCleanupBodies,
            endpoint: harness.endpoint.getStatus()
        })}`);
        return Object.freeze({
            generatedCount: cast.outcome.generatedCount,
            sentenceProvenance: true,
            impactFixedTick: impactTick,
            disposition: coreImpact.disposition,
            bountyEligible: coreImpact.bountyEligible,
            payoutAmount: payout.payoutAmount,
            gold: goldLedger.getBalance(),
            integrityBefore: 100,
            integrityAfter: coreIntegrity.getCurrentIntegrity(),
            registryEnemyCount: registry.getActiveCount('enemy'),
            bodyCleanup: !findBody(postCleanupBodies, generatedHandle),
            storageMaximum: getStorageMaximum(snapshotStatus(harness)),
            recoveryRequired: harness.endpoint.requiresRecovery()
                || coreDirector.requiresRecovery()
                || bountyDirector.requiresRecovery()
        });
    } finally {
        coreDirector?.destroy();
        bountyDirector.destroy();
        goldLedger.destroy();
        await destroyHarness(harness);
    }
}

async function run() {
    const result = {
        status: 'fail',
        runtime: {
            nw: process.versions.nw || '',
            chrome: process.versions.chrome || '',
            protocol: location.protocol,
            secureContext: isSecureContext
        }
    };
    let device = null;
    try {
        assert(resultPath, 'CIRVIVOR_WEBGPU_RESULT_PATH missing');
        assert(isSecureContext, `secure context required: ${location.protocol}`);
        assert(navigator.gpu, 'navigator.gpu unavailable');
        const adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance'
        });
        assert(adapter, 'WebGPU adapter unavailable');
        assert(adapter.limits.maxStorageBuffersPerShaderStage
            >= REQUIRED_STORAGE_BUFFER_LIMIT,
        'WebGPU storage buffer limit below 9');
        device = await adapter.requestDevice({
            requiredLimits: {
                maxStorageBuffersPerShaderStage:
                    REQUIRED_STORAGE_BUFFER_LIMIT
            }
        });
        const uncapturedErrors = [];
        device.addEventListener('uncapturederror', (event) => {
            uncapturedErrors.push(event.error?.message ?? String(event.error));
        });
        const towerSentence = await runTowerSourceDeathScenario(device);
        const recursion = await runRecursionScenario(device);
        const oneShort = await runOneShortCapacityScenario(device);
        const zeroSubject = await runZeroSubjectScenario(device);
        const generationBoundary = await runGenerationBoundaryScenario(device);
        const generatedEnemyGold = await runGeneratedEnemyGoldScenario(device);
        const generatedEnemyCoreImpact
            = await runGeneratedEnemyCoreImpactScenario(device);
        const fanout256 = await runFanoutScenario(device, 256);
        const fanout1000 = await runFanoutScenario(device, 1000);
        const doublingBoundary = await runDoublingBoundaryScenario(device);
        const storageMaximum = Math.max(
            towerSentence.storageMaximum,
            recursion.storageMaximum,
            generationBoundary.mixed.storageMaximum,
            generatedEnemyGold.storageMaximum,
            generatedEnemyCoreImpact.storageMaximum,
            fanout256.storageMaximum,
            fanout1000.storageMaximum
        );
        result.r3EnemyWord = Object.freeze({
            towerSentence,
            recursion,
            capacity: Object.freeze({
                exactCommitted: towerSentence.generatedCount === 1,
                oneShortRejected: oneShort.rejected,
                oneShortGeneratedCount: oneShort.generatedCount,
                oneShortCooldownConsumed: oneShort.cooldownConsumed,
                oneShortTerminalState: oneShort.terminalState
            }),
            zeroSubject,
            generationBoundary,
            gold: Object.freeze({
                generatedEnemyKill: generatedEnemyGold,
                generatedEnemyCoreImpact
            }),
            stress: Object.freeze({
                fanout256,
                fanout1000,
                doublingBoundary
            }),
            storageMaximum,
            recoveryRequired: towerSentence.recoveryRequired
                || recursion.recoveryRequired
                || oneShort.recoveryRequired
                || zeroSubject.recoveryRequired
                || generationBoundary.mixed.recoveryRequired
                || generationBoundary.allExcluded.recoveryRequired
                || generatedEnemyGold.recoveryRequired
                || generatedEnemyCoreImpact.recoveryRequired
                || fanout256.recoveryRequired
                || fanout1000.recoveryRequired
                || doublingBoundary.recoveryRequired
        });
        await device.queue.onSubmittedWorkDone();
        result.uncapturedErrorCount = uncapturedErrors.length;
        assert(uncapturedErrors.length === 0,
            `uncaptured WebGPU error: ${uncapturedErrors.join(' | ')}`);
        assert(storageMaximum <= REQUIRED_STORAGE_BUFFER_LIMIT,
            `R3 storage binding maximum 초과: ${storageMaximum}`);
        assert(result.r3EnemyWord.recoveryRequired === false,
            `R3 recovery 발생: ${JSON.stringify(result.r3EnemyWord)}`);
        const lostPromise = device.lost;
        device.destroy();
        const lost = await lostPromise;
        result.deviceLostReason = lost.reason;
        assert(lost.reason === 'destroyed',
            `device lost reason: ${lost.reason}`);
        result.status = 'pass';
    } catch (error) {
        result.error = error?.stack ?? String(error);
        try {
            device?.destroy();
        } catch {
            // 실패 경로 cleanup은 best effort입니다.
        }
    }
    require('node:fs').writeFileSync(
        resultPath,
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8'
    );
    nw.App.quit();
}

run();
