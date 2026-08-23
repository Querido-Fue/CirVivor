import {
    R3_ENEMY_WORD_INSTANCE,
    R3_SHOOT_WORD_INSTANCE,
    R3_TOWER_WORD_INSTANCE,
    R5_SHOWCASE_SENTENCE_LOADOUT,
    R5_SUMMON_WORD_INSTANCE,
    R7_TWICE_WORD_INSTANCE_1,
    R7_TWICE_WORD_INSTANCE_2
} from './production/script/data/word/r3_word_catalog_data.js';
import {
    R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
    R8_WORD_SHOP_BALANCE
} from './production/script/data/word/r8_word_shop_catalog_data.js';
import {
    SHOP_OPEN_SOURCE_KIND,
    SHOP_PHASE_RESULT_CODE,
    SHOP_RUNTIME_PHASE,
    ShopPhaseCoordinator
} from './production/script/module/ingame/flow/shop_phase_coordinator.js';
import {
    RunCommerceState
} from './production/script/module/ingame/state/run_commerce_state.js';
import {
    ABILITY_SLOT_ID,
    SENTENCE_RUNTIME_PHASE,
    WORD_DEFINITION_ID,
    normalizeSentenceDefinition
} from './production/script/module/ingame/contract/word_sentence_contract.js';
import {
    WORD_SHOP_RESULT_CODE
} from './production/script/module/ingame/contract/word_shop_contract.js';
import {
    createGpuTowerSpawnIntent
} from './production/script/module/ingame/object/tower/gpu_tower_spawn_adapter.js';
import {
    SentenceBoardState
} from './production/script/module/ingame/word/sentence_board_state.js';
import {
    WordShopSession
} from './production/script/module/ingame/word/word_shop_session.js';
import {
    ABILITY_ACTIVATION_RESULT_CODE,
    WordSystem
} from './production/script/module/ingame/word/word_system.js';
import {
    FIXED_DELTA,
    captureRuntimeTelemetry,
    createHarness,
    destroyHarness,
    initializePrimaryTower,
    openGenericBoundary,
    recoveryRequired,
    requestEnemyBatch,
    storageMaximum,
    waitFor
} from './r5_actor_verbs_runner.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const REQUIRED_STORAGE_BUFFER_LIMIT = 9;
const FRAME_BUDGET_MS = 16.667;
const WARM_SAMPLE_COUNT_PER_SCENARIO = Number(
    process.env.CIRVIVOR_R8_WARM_SAMPLES_PER_SCENARIO ?? 25
);
const WARM_SCENARIO_COUNT = 4;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function percentile(values, quantile) {
    assert(Array.isArray(values) && values.length > 0,
        'R8 percentile sample이 비어 있습니다.');
    const sorted = [...values].sort((left, right) => left - right);
    const rank = Math.max(
        0,
        Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)
    );
    return sorted[rank];
}

function summarize(values) {
    return Object.freeze({
        sampleCount: values.length,
        p50: values.length > 0 ? percentile(values, 0.5) : null,
        p95: values.length > 0 ? percentile(values, 0.95) : null
    });
}

function createTimingRecorder(device, timestampQuerySupported, sampleCapacity) {
    const samples = [];
    const querySet = timestampQuerySupported
        ? device.createQuerySet({
            label: 'r8-warm-acceptance-timestamps',
            type: 'timestamp',
            count: sampleCapacity * 2
        })
        : null;
    let finalized = false;
    return Object.freeze({
        async submit(metadata, callback) {
            assert(!finalized, 'R8 timing recorder가 이미 finalize됐습니다.');
            assert(samples.length < sampleCapacity,
                'R8 timing sample capacity를 초과했습니다.');
            const sampleIndex = samples.length;
            if (querySet) {
                const encoder = device.createCommandEncoder({
                    label: `${metadata.label}-timestamp-begin`
                });
                const pass = encoder.beginComputePass({
                    timestampWrites: {
                        querySet,
                        beginningOfPassWriteIndex: sampleIndex * 2
                    }
                });
                pass.end();
                device.queue.submit([encoder.finish()]);
            }
            const startedAt = performance.now();
            const callbackResult = callback();
            if (querySet) {
                const encoder = device.createCommandEncoder({
                    label: `${metadata.label}-timestamp-end`
                });
                const pass = encoder.beginComputePass({
                    timestampWrites: {
                        querySet,
                        endOfPassWriteIndex: sampleIndex * 2 + 1
                    }
                });
                pass.end();
                device.queue.submit([encoder.finish()]);
            }
            await device.queue.onSubmittedWorkDone();
            samples.push({
                ...metadata,
                fullBoundaryElapsedMs: performance.now() - startedAt
            });
            return callbackResult;
        },
        async finalize() {
            assert(!finalized, 'R8 timing recorder finalize가 중복됐습니다.');
            finalized = true;
            if (querySet && samples.length > 0) {
                const byteLength = samples.length * 2
                    * BigUint64Array.BYTES_PER_ELEMENT;
                const resolveBuffer = device.createBuffer({
                    label: 'r8-warm-timestamp-resolve',
                    size: byteLength,
                    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
                });
                const readback = device.createBuffer({
                    label: 'r8-warm-timestamp-readback',
                    size: byteLength,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                });
                try {
                    const encoder = device.createCommandEncoder({
                        label: 'r8-warm-timestamp-copy'
                    });
                    encoder.resolveQuerySet(
                        querySet,
                        0,
                        samples.length * 2,
                        resolveBuffer,
                        0
                    );
                    encoder.copyBufferToBuffer(
                        resolveBuffer,
                        0,
                        readback,
                        0,
                        byteLength
                    );
                    device.queue.submit([encoder.finish()]);
                    await readback.mapAsync(GPUMapMode.READ);
                    const timestamps = new BigUint64Array(
                        readback.getMappedRange().slice(0)
                    );
                    samples.forEach((sample, index) => {
                        sample.gpuElapsedMs = Number(
                            timestamps[index * 2 + 1]
                                - timestamps[index * 2]
                        ) / 1_000_000;
                    });
                    readback.unmap();
                } finally {
                    resolveBuffer.destroy();
                    readback.destroy();
                    querySet.destroy();
                }
            }
            return Object.freeze(samples.map((sample) => Object.freeze({
                ...sample
            })));
        }
    });
}

function sentence({ id, subject, verb, payload, modifiers }) {
    return normalizeSentenceDefinition({
        id,
        subjectWordInstanceId: subject.id,
        verbWordInstanceId: verb.id,
        payloadWordInstanceId: payload.id,
        modifierWordInstanceIds: modifiers.map(({ id: instanceId }) => instanceId)
    });
}

const WARM_SCENARIOS = Object.freeze([
    Object.freeze({
        id: 'enemy-100-x2',
        subjectKind: 'enemy',
        subjectCount: 100,
        copiesPerSubject: 2,
        capacity: 384,
        metric: 'materialization',
        sentence: sentence({
            id: 'sentence.r8.warm.enemy-100-x2',
            subject: R3_ENEMY_WORD_INSTANCE,
            verb: R3_SHOOT_WORD_INSTANCE,
            payload: R3_ENEMY_WORD_INSTANCE,
            modifiers: [R7_TWICE_WORD_INSTANCE_1]
        })
    }),
    Object.freeze({
        id: 'enemy-50-x4',
        subjectKind: 'enemy',
        subjectCount: 50,
        copiesPerSubject: 4,
        capacity: 384,
        metric: 'materialization',
        sentence: sentence({
            id: 'sentence.r8.warm.enemy-50-x4',
            subject: R3_ENEMY_WORD_INSTANCE,
            verb: R3_SHOOT_WORD_INSTANCE,
            payload: R3_ENEMY_WORD_INSTANCE,
            modifiers: [
                R7_TWICE_WORD_INSTANCE_1,
                R7_TWICE_WORD_INSTANCE_2
            ]
        })
    }),
    Object.freeze({
        id: 'tower-1-x2',
        subjectKind: 'tower',
        subjectCount: 1,
        copiesPerSubject: 2,
        capacity: 16,
        metric: 'materialization',
        sentence: sentence({
            id: 'sentence.r8.warm.tower-1-x2',
            subject: R3_TOWER_WORD_INSTANCE,
            verb: R3_SHOOT_WORD_INSTANCE,
            payload: R3_ENEMY_WORD_INSTANCE,
            modifiers: [R7_TWICE_WORD_INSTANCE_1]
        })
    }),
    Object.freeze({
        id: 'summon-128-x2',
        subjectKind: 'enemy',
        subjectCount: 128,
        copiesPerSubject: 2,
        capacity: 512,
        metric: 'placement',
        sentence: sentence({
            id: 'sentence.r8.warm.summon-128-x2',
            subject: R3_ENEMY_WORD_INSTANCE,
            verb: R5_SUMMON_WORD_INSTANCE,
            payload: R3_ENEMY_WORD_INSTANCE,
            modifiers: [R7_TWICE_WORD_INSTANCE_1]
        })
    })
]);

function loadoutFor(sentenceDefinition) {
    return Object.freeze({ [ABILITY_SLOT_ID.Q]: sentenceDefinition });
}

async function stageSubjectSnapshot(harness, fixedTick, label) {
    await openGenericBoundary(harness.device, harness.endpoint, fixedTick);
    harness.wordSystem.beginFixedTick(fixedTick);
    const activation = harness.wordSystem.requestSlotActivation(
        ABILITY_SLOT_ID.Q,
        {
            targetFixedTick: fixedTick,
            aimViewport: Object.freeze({ x: 80, y: 64 })
        }
    );
    assert(activation.code === ABILITY_ACTIVATION_RESULT_CODE.REQUESTED,
        `${label} activation 실패: ${JSON.stringify(activation)}`);
    const staged = harness.abilityRuntime.stageForFixedTick({
        targetFixedTick: fixedTick
    });
    assert(staged.acceptedCount === 1,
        `${label} snapshot stage 실패: ${JSON.stringify(staged)}`);
    const lifecycle = harness.endpoint.commitAtFixedBoundary(fixedTick);
    assert(lifecycle.recoveryRequired !== true
        && lifecycle.rejected.length === 0,
    `${label} snapshot lifecycle 실패: ${JSON.stringify(lifecycle)}`);
    assert(harness.endpoint.fixedUpdate(FIXED_DELTA, fixedTick),
        `${label} snapshot fixed submit 실패`);
    await waitFor(
        harness.device,
        () => harness.endpoint.getAbilitySubjectSnapshotStatus(),
        (status) => status.pendingReadbackCount === 0
            && status.completedQueueCount >= 1,
        `${label} snapshot completion`
    );
    const observation = harness.abilityRuntime
        .observeCompletedSubjectSnapshots(fixedTick + 1);
    assert(observation.recoveryRequired !== true
        && observation.readyCount === 1,
    `${label} snapshot observation 실패: ${JSON.stringify(observation)}`);
    return Object.freeze({ activation, staged, lifecycle, observation });
}

async function executeDirectCast(
    harness,
    activationTick,
    label,
    timingRecorder = null,
    timingMetadata = null
) {
    const snapshots = await stageSubjectSnapshot(
        harness,
        activationTick,
        label
    );
    const materializationTick = activationTick + 1;
    const payloadStage = harness.materializer.stageReadyForFixedTick({
        targetFixedTick: materializationTick
    });
    assert(payloadStage.stagedCount === 1
        && payloadStage.rejectedCount === 0
        && payloadStage.recoveryRequired !== true,
    `${label} payload stage 실패: ${JSON.stringify(payloadStage)}`);
    await openGenericBoundary(
        harness.device,
        harness.endpoint,
        materializationTick
    );
    const lifecycle = harness.endpoint.commitAtFixedBoundary(
        materializationTick
    );
    assert(lifecycle.recoveryRequired !== true
        && lifecycle.rejected.length === 0,
    `${label} payload lifecycle 실패: ${JSON.stringify(lifecycle)}`);
    const completedBefore = harness.endpoint
        .getActorPayloadMaterializationStatus().completedQueueCount;
    const submit = () => harness.endpoint.fixedUpdate(
        FIXED_DELTA,
        materializationTick
    );
    const submitted = timingRecorder
        ? await timingRecorder.submit(timingMetadata, submit)
        : submit();
    assert(submitted === true, `${label} payload fixed submit 실패`);
    await waitFor(
        harness.device,
        () => harness.endpoint.getActorPayloadMaterializationStatus(),
        (status) => status.inFlightCount === 0
            && status.completedQueueCount > completedBefore,
        `${label} payload completion`
    );
    const payloadObservation = harness.materializer.observeCompleted(
        materializationTick + 1
    );
    assert(payloadObservation.recoveryRequired !== true
        && payloadObservation.committedCount === 1,
    `${label} payload settlement 실패: ${JSON.stringify({
        payloadObservation,
        materializer: harness.materializer.getStatus()
    })}`);
    const outcome = harness.wordSystem.getStatusView().lastExecutionOutcome;
    const history = harness.materializer.getStatus().history.at(-1);
    return Object.freeze({
        snapshots,
        payloadStage,
        payloadObservation,
        outcome,
        placement: history?.placement ?? null,
        nextFixedTick: materializationTick + 1
    });
}

async function executePlacementCast(
    harness,
    activationTick,
    label,
    timingRecorder,
    timingMetadata
) {
    const snapshots = await stageSubjectSnapshot(
        harness,
        activationTick,
        label
    );
    const payloadStage = harness.materializer.stageReadyForFixedTick({
        targetFixedTick: activationTick + 1
    });
    assert(payloadStage.stagedCount === 1
        && payloadStage.rejectedCount === 0
        && payloadStage.recoveryRequired !== true,
    `${label} placement payload stage 실패: ${JSON.stringify(payloadStage)}`);
    const placementTick = activationTick + 1;
    await openGenericBoundary(harness.device, harness.endpoint, placementTick);
    const placementLifecycle = harness.endpoint.commitAtFixedBoundary(
        placementTick
    );
    assert(placementLifecycle.recoveryRequired !== true
        && placementLifecycle.rejected.length === 0,
    `${label} placement lifecycle 실패: ${JSON.stringify(
        placementLifecycle
    )}`);
    const placementCompletedBefore = harness.backend
        .getActorActionPlacementRuntimeStatus().completedCount;
    const placementSubmit = () => harness.endpoint.fixedUpdate(
        FIXED_DELTA,
        placementTick
    );
    const placementSubmitted = await timingRecorder.submit(
        timingMetadata,
        placementSubmit
    );
    assert(placementSubmitted === true,
        `${label} placement fixed submit 실패`);
    await waitFor(
        harness.device,
        () => harness.backend.getActorActionPlacementRuntimeStatus(),
        (status) => status.inFlightCount === 0
            && status.completedCount > placementCompletedBefore,
        `${label} placement completion`
    );
    const placementObservation = harness.materializer.observeCompleted(
        placementTick + 1
    );
    assert(placementObservation.recoveryRequired !== true
        && placementObservation.observedCount === 0
        && placementObservation.committedCount === 0,
    `${label} placement handoff 실패: ${JSON.stringify(
        placementObservation
    )}`);
    const materializationTick = activationTick + 2;
    await openGenericBoundary(
        harness.device,
        harness.endpoint,
        materializationTick
    );
    const payloadLifecycle = harness.endpoint.commitAtFixedBoundary(
        materializationTick
    );
    assert(payloadLifecycle.recoveryRequired !== true
        && payloadLifecycle.rejected.length === 0,
    `${label} post-placement payload lifecycle 실패: ${JSON.stringify(
        payloadLifecycle
    )}`);
    const completedBefore = harness.endpoint
        .getActorPayloadMaterializationStatus().completedQueueCount;
    assert(harness.endpoint.fixedUpdate(FIXED_DELTA, materializationTick),
        `${label} post-placement payload fixed submit 실패`);
    await waitFor(
        harness.device,
        () => harness.endpoint.getActorPayloadMaterializationStatus(),
        (status) => status.inFlightCount === 0
            && status.completedQueueCount > completedBefore,
        `${label} post-placement payload completion`
    );
    const payloadObservation = harness.materializer.observeCompleted(
        materializationTick + 1
    );
    assert(payloadObservation.recoveryRequired !== true
        && payloadObservation.committedCount === 1,
    `${label} post-placement payload settlement 실패: ${JSON.stringify(
        payloadObservation
    )}`);
    const outcome = harness.wordSystem.getStatusView().lastExecutionOutcome;
    const history = harness.materializer.getStatus().history.at(-1);
    return Object.freeze({
        snapshots,
        payloadStage,
        placementObservation,
        payloadObservation,
        outcome,
        placement: history?.placement ?? null,
        nextFixedTick: materializationTick + 1
    });
}

async function cleanupGeneratedActors(
    harness,
    handles,
    fixedTick,
    label
) {
    handles.forEach((handle, index) => {
        const receipt = harness.endpoint.requestDespawn(
            handle,
            'r8-warm-sample-cleanup',
            fixedTick,
            `${label}:despawn:${index}`
        );
        assert(receipt.accepted === true,
            `${label} cleanup despawn 실패: ${JSON.stringify(receipt)}`);
    });
    await openGenericBoundary(harness.device, harness.endpoint, fixedTick);
    const lifecycle = harness.endpoint.commitAtFixedBoundary(fixedTick);
    assert(lifecycle.recoveryRequired !== true
        && lifecycle.rejected.length === 0,
    `${label} cleanup lifecycle 실패: ${JSON.stringify(lifecycle)}`);
    assert(harness.endpoint.fixedUpdate(FIXED_DELTA, fixedTick),
        `${label} cleanup fixed submit 실패`);
    await harness.device.queue.onSubmittedWorkDone();
    return fixedTick + 1;
}

function assertCleanHarness(harness, label) {
    const telemetry = captureRuntimeTelemetry(harness);
    assert(telemetry.reservedRegistryCount === 0
        && telemetry.pendingCommandCount === 0
        && telemetry.perSubjectCpuSpawnCommandCount === 0
        && telemetry.fullPlacementRecordReadbackCount === 0
        && telemetry.fullTransitRecordReadbackCount === 0
        && telemetry.perActorCpuAdvanceCount === 0
        && telemetry.gridOverflowCount === 0
        && storageMaximum(harness) <= REQUIRED_STORAGE_BUFFER_LIMIT
        && recoveryRequired(harness) === false,
    `${label} runtime invariant 실패: ${JSON.stringify(telemetry)}`);
    return telemetry;
}

async function runWarmScenario(device, recorder, definition) {
    const harness = createHarness(
        device,
        definition.capacity,
        loadoutFor(definition.sentence),
        {
            actorActionPlacementDestinationCapacity: definition.capacity
        }
    );
    let result = null;
    let destroyedTeardown = false;
    try {
        await initializePrimaryTower(harness);
        let activationTick = 2;
        if (definition.subjectKind === 'enemy') {
            requestEnemyBatch(
                harness,
                definition.subjectCount,
                activationTick,
                `${definition.id}-sources`
            );
        }
        const candidateAttempts = [];
        for (let index = 0;
            index <= WARM_SAMPLE_COUNT_PER_SCENARIO;
            index++) {
            const phase = index === 0 ? 'first-use' : 'warm';
            const timingMetadata = Object.freeze({
                phase,
                metric: definition.metric,
                scenarioId: definition.id,
                label: `r8-${definition.id}-${phase}-${index}`
            });
            const cast = definition.metric === 'placement'
                ? await executePlacementCast(
                    harness,
                    activationTick,
                    `${definition.id}-${phase}-${index}`,
                    recorder,
                    timingMetadata
                )
                : await executeDirectCast(
                    harness,
                    activationTick,
                    `${definition.id}-${phase}-${index}`,
                    recorder,
                    timingMetadata
                );
            assert(cast.outcome.subjectCount === definition.subjectCount
                && cast.outcome.copiesPerSubject
                    === definition.copiesPerSubject
                && cast.outcome.generatedCount
                    === definition.subjectCount * definition.copiesPerSubject
                && cast.outcome.cooldownConsumed === true,
            `${definition.id} cardinality 실패: ${JSON.stringify(cast.outcome)}`);
            candidateAttempts.push(
                cast.placement?.attemptedCandidateCount ?? 0
            );
            activationTick = await cleanupGeneratedActors(
                harness,
                cast.payloadObservation.committedHandles,
                cast.nextFixedTick,
                `${definition.id}-${phase}-${index}`
            );
            const expectedEnemyCount = definition.subjectKind === 'enemy'
                ? definition.subjectCount
                : 0;
            assert(harness.registry.getActiveCount('enemy')
                    === expectedEnemyCount,
            `${definition.id} cleanup cardinality 실패`);
            const nextEligible = harness.wordSystem.getSlotView(
                ABILITY_SLOT_ID.Q
            ).cooldown.nextEligibleFixedTick;
            activationTick = Math.max(activationTick, nextEligible);
        }
        const telemetry = assertCleanHarness(harness, definition.id);
        result = Object.freeze({
            id: definition.id,
            sampleCount: WARM_SAMPLE_COUNT_PER_SCENARIO,
            firstUseSampleCount: 1,
            subjectCount: definition.subjectCount,
            copiesPerSubject: definition.copiesPerSubject,
            generatedPerSample:
                definition.subjectCount * definition.copiesPerSubject,
            candidateAttempts: summarize(candidateAttempts.slice(1)),
            telemetry
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

function createShopAction(shop, overrides = {}) {
    const status = shop.getStatus();
    return {
        transactionId: 'r8.actual.shop.action',
        rowFingerprint: status.row.rowFingerprint,
        expectedCommerceRevision: status.commerceRevision,
        expectedInventoryRevision: status.inventoryRevision,
        ...overrides
    };
}

function endpointSubmittedTickCount(harness) {
    const status = harness.endpoint.getStatus();
    const count = status.backend?.gpu?.submittedTickCount
        ?? status.backend?.submittedTickCount;
    assert(Number.isSafeInteger(count) && count >= 0,
        `endpoint submittedTickCount가 없습니다: ${JSON.stringify(status)}`);
    return count;
}

function captureShopRecoveryState({ commerce, shop, board, wordSystem, phase }) {
    const commerceStatus = commerce.getStatus();
    const shopStatus = shop.getStatus();
    const boardStatus = board.getStatus();
    return Object.freeze({
        gold: commerceStatus.gold,
        commerceRevision: commerceStatus.commerceRevision,
        inventoryFingerprint: commerceStatus.inventoryFingerprint,
        inventoryRevision: commerceStatus.inventoryRevision,
        rowFingerprint: shopStatus.row.rowFingerprint,
        shopSessionOrdinal: shopStatus.shopSessionOrdinal,
        boardFingerprint: boardStatus.boardFingerprint,
        boardRevision: boardStatus.boardRevision,
        wordPhase: wordSystem.getStatusView().phase,
        shopPhase: phase.getPhase()
    });
}

async function initializeRecoveredTowers(harness, fixedTick = 1) {
    const records = harness.towerGroupState.getTowerRecords()
        .filter((record) => record.alive)
        .sort((left, right) => (
            left.logicalTowerOrdinal - right.logicalTowerOrdinal
        ));
    const groupRevision = harness.towerGroupState.getStatus().groupRevision;
    const requests = records.map((record) => {
        const position = record.recoverySpawnDescriptor?.position
            ?? (record.logicalTowerOrdinal === 1
                ? harness.navigationSource.towerPosition
                : null);
        assert(position, `${record.logicalTowerId} recovery position missing`);
        return Object.freeze({
            intent: createGpuTowerSpawnIntent({
                position,
                currentHpFixedPoint: record.currentHpFixedPoint,
                logicalTowerOrdinal: record.logicalTowerOrdinal,
                shareUnits: record.shareUnits,
                maxHpFixedPoint: record.maxHpFixedPoint,
                powerFixedPoint: record.powerFixedPoint,
                towerGroupRevision: groupRevision,
                creationMetadata: record.creationMetadata
            }),
            targetFixedTick: fixedTick,
            commandId: `r8-recovery:${record.logicalTowerOrdinal}`
        });
    });
    const requested = harness.endpoint.requestSpawnBatch(requests);
    assert(requested.accepted === true
        && requested.queuedCount === records.length,
    `R8 recovery Tower batch 실패: ${JSON.stringify(requested)}`);
    await openGenericBoundary(harness.device, harness.endpoint, fixedTick);
    const lifecycle = harness.endpoint.commitAtFixedBoundary(fixedTick);
    assert(lifecycle.recoveryRequired !== true
        && lifecycle.rejected.length === 0
        && lifecycle.spawned.length === records.length,
    `R8 recovery Tower lifecycle 실패: ${JSON.stringify(lifecycle)}`);
    for (const record of records) {
        const commandId = `r8-recovery:${record.logicalTowerOrdinal}`;
        const handle = lifecycle.spawned.find((entry) => (
            entry.commandId === commandId
        ))?.handle;
        assert(handle, `${commandId} handle missing`);
        harness.towerGroupState.bindGpuBody(
            record.logicalTowerId,
            handle,
            harness.backend.getEventProtocolState()
        );
    }
    assert(harness.endpoint.fixedUpdate(FIXED_DELTA, fixedTick),
        'R8 recovery Tower fixed submit 실패');
    const roster = harness.backend.synchronizeTowerGroupRoster({
        groupRevision,
        records: harness.towerGroupState.getTowerRecords()
    });
    assert(roster.accepted === true,
        `R8 recovery Tower roster sync 실패: ${JSON.stringify(roster)}`);
    await harness.device.queue.onSubmittedWorkDone();
    return records.length;
}

async function runShopEditorActual(device) {
    const commerce = new RunCommerceState({
        runSessionId: 'run.r8.actual',
        initialGold: R8_WORD_SHOP_BALANCE.QA_INITIAL_GOLD
    });
    const wordSystem = new WordSystem({
        loadout: R5_SHOWCASE_SENTENCE_LOADOUT
    });
    const board = new SentenceBoardState({
        inventory: commerce.inventory,
        wordSystem
    });
    const shop = new WordShopSession({
        commerceState: commerce,
        runSeed: R8_WORD_SHOP_BALANCE.QA_RUN_SEED,
        unlockedWordDefinitionIds: R8_ALL_UNLOCKED_WORD_DEFINITION_IDS
    });
    let harness = createHarness(
        device,
        64,
        R5_SHOWCASE_SENTENCE_LOADOUT,
        { wordSystem }
    );
    let phase = null;
    let oldDestroyed = false;
    let replacementDestroyed = false;
    let domainDestroyed = false;
    let result = null;
    let knownFixedTick = 1;
    let synchronizeCount = 0;
    try {
        await initializePrimaryTower(harness);
        const safeBoundary = {
            getSnapshot() {
                return Object.freeze({
                    fixedTick: knownFixedTick,
                    wordActivationCount:
                        wordSystem.getStatusView().pendingActivationCount,
                    abilityExecutionCount: 0,
                    towerCreationPendingCount: 0,
                    towerMergePendingCount: 0,
                    actorMaterializationPendingCount: 0,
                    actorTransitActiveCount: 0,
                    commercePendingCount:
                        commerce.getStatus().pendingTransactionCount,
                    endpointPendingFixedTick: 0,
                    wavePendingSpawnCount: 0,
                    endpointRecoveryRequired: recoveryRequired(harness),
                    recoveryProbationState: 'PASSED',
                    runDefeated: false
                });
            }
        };
        phase = new ShopPhaseCoordinator({
            wordSystem,
            shopSession: shop,
            sentenceBoard: board,
            commerceState: commerce,
            safeBoundaryPort: safeBoundary,
            presentationPort: {
                synchronize() {
                    synchronizeCount++;
                }
            }
        });
        const openRequested = phase.requestOpen({
            sourceKind: SHOP_OPEN_SOURCE_KIND.QA_EXPLICIT,
            sourceId: 'r8.actual.open.1',
            settlementOrdinal: 1,
            transactionId: 'r8.actual.phase.open.1',
            minimumFixedTick: 1
        });
        assert(openRequested.code === SHOP_PHASE_RESULT_CODE.OPEN_REQUESTED,
            'R8 first Shop open request 실패');
        const opened = phase.progressOpening();
        assert(opened.code === SHOP_PHASE_RESULT_CODE.OPENED
            && phase.getPhase() === SHOP_RUNTIME_PHASE.SHOP,
        `R8 first Shop open 실패: ${JSON.stringify(opened)}`);
        const initial = shop.getStatus();
        const initialSubmitCount = endpointSubmittedTickCount(harness);
        const twiceOffer = initial.row.offers.find(
            ({ definitionId }) => definitionId === WORD_DEFINITION_ID.TWICE
        );
        assert(twiceOffer, 'R8 QA 첫 Shop row에 twice가 없습니다.');
        const purchasedTwice = shop.purchaseOffer(createShopAction(shop, {
            transactionId: 'r8.actual.purchase.twice',
            offerId: twiceOffer.offerId
        }));
        assert(purchasedTwice.code === WORD_SHOP_RESULT_CODE.PURCHASED,
            `R8 twice purchase 실패: ${JSON.stringify(purchasedTwice)}`);
        const twiceInstanceId = purchasedTwice.commerceReceipt
            .inventoryReceipt.instance.instanceId;
        const oldUnsoldOffer = initial.row.offers.find(
            ({ offerId }) => offerId !== twiceOffer.offerId
        );
        const rerolled = shop.reroll(createShopAction(shop, {
            transactionId: 'r8.actual.reroll.1'
        }));
        assert(rerolled.code === WORD_SHOP_RESULT_CODE.REROLLED,
            `R8 reroll 실패: ${JSON.stringify(rerolled)}`);
        const staleOldOffer = shop.purchaseOffer({
            transactionId: 'r8.actual.purchase.stale-old-row',
            offerId: oldUnsoldOffer.offerId,
            rowFingerprint: initial.row.rowFingerprint,
            expectedCommerceRevision: shop.getStatus().commerceRevision,
            expectedInventoryRevision: shop.getStatus().inventoryRevision
        });
        assert(staleOldOffer.code === WORD_SHOP_RESULT_CODE.STALE_ROW,
            `R8 stale old row 거절 실패: ${JSON.stringify(staleOldOffer)}`);
        const anotherOffer = shop.getStatus().row.offers.find(
            ({ definitionId }) => definitionId !== WORD_DEFINITION_ID.TWICE
        );
        const purchasedAnother = shop.purchaseOffer(createShopAction(shop, {
            transactionId: 'r8.actual.purchase.another',
            offerId: anotherOffer.offerId
        }));
        assert(purchasedAnother.code === WORD_SHOP_RESULT_CODE.PURCHASED,
            `R8 second purchase 실패: ${JSON.stringify(purchasedAnother)}`);
        const upgraded = shop.upgradeOwnedWord(createShopAction(shop, {
            transactionId: 'r8.actual.upgrade.twice.1',
            instanceId: twiceInstanceId
        }));
        assert(upgraded.code === WORD_SHOP_RESULT_CODE.UPGRADED,
            `R8 twice upgrade 실패: ${JSON.stringify(upgraded)}`);
        const expectedGold = R8_WORD_SHOP_BALANCE.QA_INITIAL_GOLD
            - purchasedTwice.commerceReceipt.amount
            - rerolled.commerceReceipt.amount
            - purchasedAnother.commerceReceipt.amount
            - upgraded.commerceReceipt.amount;
        assert(commerce.getBalance() === expectedGold,
            `R8 exact Gold receipt 불일치: ${commerce.getBalance()}/${expectedGold}`);
        board.beginDraft();
        board.addModifier(ABILITY_SLOT_ID.Q, twiceInstanceId);
        const preview = board.validateDraft();
        const qPreview = preview.slotValidations.find(
            ({ slotId }) => slotId === ABILITY_SLOT_ID.Q
        )?.preview;
        assert(preview.valid === true
            && qPreview?.copiesPerSubject === 4,
        `R8 upgraded twice preview 불일치: ${JSON.stringify(preview)}`);
        const boardCommit = board.commitDraft({
            transactionId: 'r8.actual.board.commit.1'
        });
        assert(boardCommit.accepted === true,
            `R8 board commit 실패: ${JSON.stringify(boardCommit)}`);
        const shopFixedSubmitDelta = endpointSubmittedTickCount(harness)
            - initialSubmitCount;
        assert(shopFixedSubmitDelta === 0,
            `R8 Shop 중 GPU fixed submit 발생: ${shopFixedSubmitDelta}`);
        const closeRequested = phase.requestContinue({
            transactionId: 'r8.actual.phase.continue.1'
        });
        assert(closeRequested.code === SHOP_PHASE_RESULT_CODE.CLOSE_REQUESTED,
            `R8 first Continue 실패: ${JSON.stringify(closeRequested)}`);
        const closed = phase.progressClosing();
        assert(closed.code === SHOP_PHASE_RESULT_CODE.CLOSED,
            `R8 first Shop close 실패: ${JSON.stringify(closed)}`);
        const editedCast = await executeDirectCast(
            harness,
            2,
            'r8-edited-board-q'
        );
        knownFixedTick = editedCast.nextFixedTick;
        assert(editedCast.outcome.subjectCount === 1
            && editedCast.outcome.copiesPerSubject === 4
            && editedCast.outcome.generatedCount === 4,
        `R8 edited Ability actual 실행 불일치: ${JSON.stringify(
            editedCast.outcome
        )}`);
        const firstRowFingerprint = initial.row.rowFingerprint;
        const secondOpenRequest = phase.requestOpen({
            sourceKind: SHOP_OPEN_SOURCE_KIND.QA_EXPLICIT,
            sourceId: 'r8.actual.open.2',
            settlementOrdinal: 2,
            transactionId: 'r8.actual.phase.open.2',
            minimumFixedTick: knownFixedTick
        });
        assert(secondOpenRequest.code === SHOP_PHASE_RESULT_CODE.OPEN_REQUESTED,
            'R8 second Shop open request 실패');
        const secondOpened = phase.progressOpening();
        assert(secondOpened.code === SHOP_PHASE_RESULT_CODE.OPENED,
            `R8 second Shop open 실패: ${JSON.stringify(secondOpened)}`);
        const secondRowFingerprint = shop.getStatus().row.rowFingerprint;
        assert(secondRowFingerprint !== firstRowFingerprint,
            'R8 second Shop row가 first row와 같습니다.');
        const beforeRecovery = captureShopRecoveryState({
            commerce,
            shop,
            board,
            wordSystem,
            phase
        });
        const recoverySubmitBefore = endpointSubmittedTickCount(harness);
        const towerGroupState = harness.towerGroupState;
        towerGroupState.releaseGpuBindings();
        oldDestroyed = await destroyHarness(harness, {
            preserveRunDomain: true
        });
        harness = createHarness(
            device,
            64,
            R5_SHOWCASE_SENTENCE_LOADOUT,
            {
                deviceGeneration: 2,
                towerGroupState,
                wordSystem
            }
        );
        const recoverySubmitAfter = endpointSubmittedTickCount(harness);
        const afterRecovery = captureShopRecoveryState({
            commerce,
            shop,
            board,
            wordSystem,
            phase
        });
        const statePreserved = JSON.stringify(afterRecovery)
            === JSON.stringify(beforeRecovery);
        assert(statePreserved
            && afterRecovery.wordPhase === SENTENCE_RUNTIME_PHASE.SHOP
            && afterRecovery.shopPhase === SHOP_RUNTIME_PHASE.SHOP,
        `R8 recovery Shop state 불일치: ${JSON.stringify({
            beforeRecovery,
            afterRecovery
        })}`);
        // 새 endpoint는 SHOP에서 gameplay fixed submit을 시작하지 않습니다.
        const recoveryShopFixedSubmitDelta = recoverySubmitAfter;
        assert(recoverySubmitBefore >= 1
            && recoveryShopFixedSubmitDelta === 0,
        'R8 recovery endpoint가 SHOP에서 fixed submit을 수행했습니다.');
        const recoveryCloseRequested = phase.requestContinue({
            transactionId: 'r8.actual.phase.continue.2'
        });
        assert(recoveryCloseRequested.code
                === SHOP_PHASE_RESULT_CODE.CLOSE_REQUESTED,
        `R8 recovery Continue 실패: ${JSON.stringify(
            recoveryCloseRequested
        )}`);
        const recoveryClosed = phase.progressClosing();
        assert(recoveryClosed.code === SHOP_PHASE_RESULT_CODE.CLOSED,
            `R8 recovery Shop close 실패: ${JSON.stringify(recoveryClosed)}`);
        const rehydratedTowerCount = await initializeRecoveredTowers(harness, 1);
        const telemetry = assertCleanHarness(harness, 'r8-shop-editor-actual');
        result = Object.freeze({
            scenario: 'r8-shop-editor-actual-webgpu',
            shop: Object.freeze({
                initialOfferCount: initial.row.offers.length,
                initialUniqueOfferCount: new Set(initial.row.offers.map(
                    ({ definitionId }) => definitionId
                )).size,
                initialRowFingerprint: firstRowFingerprint,
                purchasedTwice: true,
                multiplePurchaseCount: 2,
                staleOldOfferRejected: true,
                rerollRowChanged:
                    rerolled.row.rowFingerprint !== firstRowFingerprint,
                secondSessionRowChanged:
                    secondRowFingerprint !== firstRowFingerprint,
                secondRowFingerprint,
                finalGold: commerce.getBalance(),
                expectedGold,
                purchaseCosts: Object.freeze([
                    purchasedTwice.commerceReceipt.amount,
                    purchasedAnother.commerceReceipt.amount
                ]),
                rerollCost: rerolled.commerceReceipt.amount,
                upgradeCost: upgraded.commerceReceipt.amount,
                inventoryCount:
                    commerce.getInventorySnapshot().instances.length,
                upgradedTwiceLevel: commerce.getInventorySnapshot()
                    .instancesById[twiceInstanceId].upgradeLevel
            }),
            editor: Object.freeze({
                starterBoardIdentityPreserved:
                    boardCommit.priorBoardRevision === 1,
                previewCopiesPerSubject: qPreview.copiesPerSubject,
                boardCommitted: boardCommit.accepted,
                boardRevision: boardCommit.boardRevision,
                boardFingerprint: boardCommit.boardFingerprint
            }),
            editedAbility: Object.freeze({
                subjectCount: editedCast.outcome.subjectCount,
                copiesPerSubject: editedCast.outcome.copiesPerSubject,
                generatedCount: editedCast.outcome.generatedCount,
                modifierSetFingerprint:
                    editedCast.outcome.modifierSetFingerprint,
                candidateAttempts:
                    editedCast.placement?.attemptedCandidateCount ?? 0
            }),
            phase: Object.freeze({
                shopFixedSubmitDelta,
                recoveryShopFixedSubmitDelta,
                presentationSynchronizeCount: synchronizeCount,
                finalPhase: phase.getPhase(),
                wordPhase: wordSystem.getStatusView().phase
            }),
            recovery: Object.freeze({
                statePreserved,
                oldDestroyed,
                deviceGeneration: 2,
                rehydratedTowerCount
            }),
            storageMaximum: telemetry.storageMaximum,
            extraPerSubjectReadbackCount:
                telemetry.perSubjectCpuSpawnCommandCount
                + telemetry.fullPlacementRecordReadbackCount
                + telemetry.fullTransitRecordReadbackCount,
            partialPublicationCount: 0,
            gridOverflowCount: telemetry.gridOverflowCount,
            protocolFailureCount: telemetry.towerProtocolFailureCount,
            recoveryFailureCount: Number(telemetry.recoveryRequired),
            telemetry
        });
    } finally {
        try { phase?.destroy(); } catch { /* best effort */ }
        if (harness) {
            replacementDestroyed = await destroyHarness(harness);
            harness = null;
        }
        try { board.destroy(); } catch { /* best effort */ }
        try { shop.destroy(); } catch { /* best effort */ }
        try { commerce.destroy(); } catch { /* best effort */ }
        domainDestroyed = wordSystem.destroyed === true;
    }
    return Object.freeze({
        ...result,
        recovery: Object.freeze({
            ...result.recovery,
            oldDestroyed
        }),
        destroyedTeardown:
            oldDestroyed && replacementDestroyed && domainDestroyed
    });
}

function buildPerformanceReport(samples, scenarioResults, timestampQuerySupported) {
    const firstUse = samples.filter(({ phase }) => phase === 'first-use');
    const warm = samples.filter(({ phase }) => phase === 'warm');
    const materialization = warm.filter(
        ({ metric }) => metric === 'materialization'
    );
    const placement = warm.filter(({ metric }) => metric === 'placement');
    const gpuValues = (entries) => entries
        .filter(({ gpuElapsedMs }) => Number.isFinite(gpuElapsedMs))
        .map(({ gpuElapsedMs }) => gpuElapsedMs);
    const scenarioSummaries = Object.fromEntries(WARM_SCENARIOS.map(
        ({ id }) => {
            const entries = warm.filter(({ scenarioId }) => scenarioId === id);
            const scenarioResult = scenarioResults.find((entry) => entry.id === id);
            return [id, Object.freeze({
                sampleCount: entries.length,
                gpuMs: summarize(gpuValues(entries)),
                wallMs: summarize(entries.map(
                    ({ fullBoundaryElapsedMs }) => fullBoundaryElapsedMs
                )),
                candidateAttempts: scenarioResult.candidateAttempts
            })];
        }
    ));
    const materializationGpuMs = summarize(gpuValues(materialization));
    const placementGpuMs = summarize(gpuValues(placement));
    const warmGpuMs = summarize(gpuValues(warm));
    const fullFixedBoundaryWallMs = summarize(warm.map(
        ({ fullBoundaryElapsedMs }) => fullBoundaryElapsedMs
    ));
    const p95WithinBudget = warmGpuMs.p95 !== null
        && warmGpuMs.p95 <= FRAME_BUDGET_MS;
    return Object.freeze({
        scope: 'single adapter/device, serialized successful fixed boundaries',
        hardFrameBudgetClaim: false,
        timestampQuerySupported,
        frameBudgetMs: FRAME_BUDGET_MS,
        firstUseCompile: Object.freeze({
            sampleCount: firstUse.length,
            gpuMs: summarize(gpuValues(firstUse)),
            wallMs: summarize(firstUse.map(
                ({ fullBoundaryElapsedMs }) => fullBoundaryElapsedMs
            ))
        }),
        warmSuccessful: Object.freeze({
            sampleCount: warm.length,
            materializationGpuMs,
            placementGpuMs,
            overallGpuMs: warmGpuMs,
            fullFixedBoundaryWallMs,
            droppedFixedTimeMs: 0,
            scenarios: Object.freeze(scenarioSummaries),
            p95WithinBudget
        }),
        separated: Object.freeze({
            firstUseCompile: true,
            impossiblePlacement: 'R7 actual regression gate',
            pressure: 'R7 actual regression gate'
        }),
        productionExposure: p95WithinBudget ? 'APPROVED' : 'PARTIAL',
        samples
    });
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
        assert(Number.isSafeInteger(WARM_SAMPLE_COUNT_PER_SCENARIO)
            && WARM_SAMPLE_COUNT_PER_SCENARIO >= 1
            && WARM_SAMPLE_COUNT_PER_SCENARIO <= 25,
        'CIRVIVOR_R8_WARM_SAMPLES_PER_SCENARIO는 1..25여야 합니다.');
        const adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance'
        });
        assert(adapter, 'WebGPU adapter unavailable');
        assert(adapter.limits.maxStorageBuffersPerShaderStage
            >= REQUIRED_STORAGE_BUFFER_LIMIT,
        'WebGPU storage buffer limit below 9');
        const timestampQuerySupported = adapter.features.has('timestamp-query');
        assert(timestampQuerySupported,
            'R8 warm performance에는 timestamp-query가 필요합니다.');
        device = await adapter.requestDevice({
            requiredFeatures: ['timestamp-query'],
            requiredLimits: {
                maxStorageBuffersPerShaderStage:
                    REQUIRED_STORAGE_BUFFER_LIMIT
            }
        });
        const uncapturedErrors = [];
        device.addEventListener('uncapturederror', (event) => {
            uncapturedErrors.push(event.error?.message ?? String(event.error));
        });
        const shopEditor = await runShopEditorActual(device);
        const recorder = createTimingRecorder(
            device,
            timestampQuerySupported,
            (WARM_SAMPLE_COUNT_PER_SCENARIO + 1) * WARM_SCENARIO_COUNT
        );
        const scenarioResults = [];
        for (const definition of WARM_SCENARIOS) {
            scenarioResults.push(await runWarmScenario(
                device,
                recorder,
                definition
            ));
        }
        const samples = await recorder.finalize();
        const performanceReport = buildPerformanceReport(
            samples,
            scenarioResults,
            timestampQuerySupported
        );
        await device.queue.onSubmittedWorkDone();
        await new Promise((resolve) => setTimeout(resolve, 25));
        assert(uncapturedErrors.length === 0,
            `uncaptured WebGPU errors: ${JSON.stringify(uncapturedErrors)}`);
        const combinedStorageMaximum = Math.max(
            shopEditor.storageMaximum,
            ...scenarioResults.map(({ telemetry }) => telemetry.storageMaximum)
        );
        assert(combinedStorageMaximum <= REQUIRED_STORAGE_BUFFER_LIMIT,
            `R8 storage maximum exceeded 9: ${combinedStorageMaximum}`);
        assert(shopEditor.destroyedTeardown === true
            && scenarioResults.every(({ destroyedTeardown }) => (
                destroyedTeardown === true
            )),
        'R8 harness teardown가 모든 runtime을 destroy하지 못했습니다.');
        result.r8ShopEditor = Object.freeze({
            ...shopEditor,
            storageMaximum: combinedStorageMaximum,
            warmScenarioResults: Object.freeze(scenarioResults)
        });
        result.performance = performanceReport;
        result.adapterTimestampQuerySupported = timestampQuerySupported;
        result.requestedMaxStorageBuffersPerShaderStage
            = REQUIRED_STORAGE_BUFFER_LIMIT;
        result.adapterMaxStorageBuffersPerShaderStage
            = adapter.limits.maxStorageBuffersPerShaderStage;
        result.deviceMaxStorageBuffersPerShaderStage
            = device.limits.maxStorageBuffersPerShaderStage;
        result.uncapturedErrorCount = uncapturedErrors.length;
        const lostPromise = device.lost;
        device.destroy();
        const lost = await lostPromise;
        result.deviceLostReason = lost.reason;
        assert(lost.reason === 'destroyed',
            `device lost reason: ${lost.reason}`);
        result.status = 'pass';
    } catch (error) {
        result.error = error?.stack ?? String(error);
        try { device?.destroy(); } catch { /* best effort */ }
    }
    require('node:fs').writeFileSync(
        resultPath,
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8'
    );
    nw.App.quit();
}

run();
