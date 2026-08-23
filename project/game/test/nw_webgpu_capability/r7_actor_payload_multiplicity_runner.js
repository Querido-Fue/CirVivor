import {
    R3_ENEMY_WORD_INSTANCE,
    R3_SHOOT_WORD_INSTANCE,
    R3_TOWER_WORD_INSTANCE,
    R5_SUMMON_WORD_INSTANCE,
    R5_THROW_WORD_INSTANCE,
    R7_TWICE_WORD_INSTANCE_1,
    R7_TWICE_WORD_INSTANCE_2
} from './production/script/data/word/r3_word_catalog_data.js';
import {
    R5_THROW_ACTOR_ACTION_PROFILE
} from './production/script/data/word/r5_actor_action_profile_data.js';
import {
    ABILITY_SLOT_ID,
    normalizeSentenceDefinition
} from './production/script/module/ingame/contract/word_sentence_contract.js';
import {
    ABILITY_ACTIVATION_RESULT_CODE,
    ABILITY_EXECUTION_OUTCOME_CODE
} from './production/script/module/ingame/word/word_system.js';
import {
    FIXED_DELTA,
    captureRuntimeTelemetry,
    checkpoint,
    createHarness,
    createNavigationSource,
    destroyHarness,
    executeImmediateEnemyPayload,
    initializePrimaryTower,
    openGenericBoundary,
    recoveryRequired,
    requestEnemyBatch,
    storageMaximum,
    timedFixedUpdate,
    waitFor
} from './r5_actor_verbs_runner.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const REQUIRED_STORAGE_BUFFER_LIMIT = 9;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function sentence({ id, subject, verb, payload, modifierCount = 1 }) {
    const modifiers = [
        R7_TWICE_WORD_INSTANCE_1.id,
        R7_TWICE_WORD_INSTANCE_2.id
    ].slice(0, modifierCount);
    return normalizeSentenceDefinition({
        id,
        subjectWordInstanceId: subject.id,
        verbWordInstanceId: verb.id,
        payloadWordInstanceId: payload.id,
        modifierWordInstanceIds: modifiers
    });
}

const TOWER_SHOOT_ENEMY_X2 = sentence({
    id: 'sentence.r7.actual.tower-shoot-enemy-x2',
    subject: R3_TOWER_WORD_INSTANCE,
    verb: R3_SHOOT_WORD_INSTANCE,
    payload: R3_ENEMY_WORD_INSTANCE
});
const ENEMY_SHOOT_ENEMY_X2 = sentence({
    id: 'sentence.r7.actual.enemy-shoot-enemy-x2',
    subject: R3_ENEMY_WORD_INSTANCE,
    verb: R3_SHOOT_WORD_INSTANCE,
    payload: R3_ENEMY_WORD_INSTANCE
});
const ENEMY_SHOOT_ENEMY_X4 = sentence({
    id: 'sentence.r7.actual.enemy-shoot-enemy-x4',
    subject: R3_ENEMY_WORD_INSTANCE,
    verb: R3_SHOOT_WORD_INSTANCE,
    payload: R3_ENEMY_WORD_INSTANCE,
    modifierCount: 2
});
const ENEMY_THROW_ENEMY_X2 = sentence({
    id: 'sentence.r7.actual.enemy-throw-enemy-x2',
    subject: R3_ENEMY_WORD_INSTANCE,
    verb: R5_THROW_WORD_INSTANCE,
    payload: R3_ENEMY_WORD_INSTANCE
});
const ENEMY_SUMMON_ENEMY_X2 = sentence({
    id: 'sentence.r7.actual.enemy-summon-enemy-x2',
    subject: R3_ENEMY_WORD_INSTANCE,
    verb: R5_SUMMON_WORD_INSTANCE,
    payload: R3_ENEMY_WORD_INSTANCE
});
const TOWER_SUMMON_ENEMY_X2 = sentence({
    id: 'sentence.r7.actual.tower-summon-enemy-x2',
    subject: R3_TOWER_WORD_INSTANCE,
    verb: R5_SUMMON_WORD_INSTANCE,
    payload: R3_ENEMY_WORD_INSTANCE
});

function loadoutFor(primary, secondary = null) {
    return Object.freeze({
        [ABILITY_SLOT_ID.Q]: primary,
        ...(secondary ? { [ABILITY_SLOT_ID.E]: secondary } : {})
    });
}

async function stageSnapshots(
    harness,
    slots,
    fixedTick,
    label,
    aimViewport = Object.freeze({ x: 80, y: 64 })
) {
    await openGenericBoundary(harness.device, harness.endpoint, fixedTick);
    harness.wordSystem.beginFixedTick(fixedTick);
    const activations = slots.map((slotId) => (
        harness.wordSystem.requestSlotActivation(slotId, {
            targetFixedTick: fixedTick,
            aimViewport
        })
    ));
    assert(activations.every((entry) => (
        entry.code === ABILITY_ACTIVATION_RESULT_CODE.REQUESTED
    )), `${label} activation failed: ${JSON.stringify(activations)}`);
    const staged = harness.abilityRuntime.stageForFixedTick({
        targetFixedTick: fixedTick
    });
    assert(staged.acceptedCount === slots.length,
        `${label} ability stage failed: ${JSON.stringify(staged)}`);
    const lifecycle = harness.endpoint.commitAtFixedBoundary(fixedTick);
    assert(lifecycle.recoveryRequired !== true
        && lifecycle.rejected.length === 0,
    `${label} lifecycle failed: ${JSON.stringify(lifecycle)}`);
    assert(await timedFixedUpdate(
        harness,
        fixedTick,
        'action',
        `${label}-snapshot-${fixedTick}`
    ), `${label} snapshot submit failed`);
    await waitFor(
        harness.device,
        () => harness.endpoint.getAbilitySubjectSnapshotStatus(),
        (status) => status.pendingReadbackCount === 0
            && status.completedQueueCount >= slots.length,
        `${label} snapshots`
    );
    const observation = harness.abilityRuntime
        .observeCompletedSubjectSnapshots(fixedTick + 1);
    assert(observation.recoveryRequired !== true
        && observation.readyCount === slots.length,
    `${label} snapshot observation failed: ${JSON.stringify(observation)}`);
    return Object.freeze({ activations, staged, lifecycle, observation });
}

async function settleDirectPayload(harness, fixedTick, label) {
    await openGenericBoundary(harness.device, harness.endpoint, fixedTick);
    const lifecycle = harness.endpoint.commitAtFixedBoundary(fixedTick);
    assert(lifecycle.recoveryRequired !== true
        && lifecycle.rejected.length === 0,
    `${label} payload lifecycle failed: ${JSON.stringify(lifecycle)}`);
    const before = harness.endpoint.getActorPayloadMaterializationStatus()
        .completedQueueCount;
    assert(await timedFixedUpdate(
        harness,
        fixedTick,
        'action',
        `${label}-materialization-${fixedTick}`
    ), `${label} payload submit failed`);
    await waitFor(
        harness.device,
        () => harness.endpoint.getActorPayloadMaterializationStatus(),
        (status) => status.inFlightCount === 0
            && status.completedQueueCount > before,
        `${label} materialization`
    );
    const observation = harness.materializer.observeCompleted(fixedTick + 1);
    assert(observation.recoveryRequired !== true
        && observation.committedCount === 1,
    `${label} settlement failed: ${JSON.stringify({
        observation,
        materializer: harness.materializer.getStatus()
    })}`);
    return observation;
}

async function advanceTransitOnlyThroughFixedTick(
    harness,
    firstFixedTick,
    lastFixedTick,
    label
) {
    const committedHandles = [];
    for (let fixedTick = firstFixedTick;
        fixedTick <= lastFixedTick;
        fixedTick++) {
        assert(harness.backend.advanceActorTransits(fixedTick) === true,
            `${label} transit submit ${fixedTick} failed`);
        await waitFor(
            harness.device,
            () => harness.backend.getActorTransitRuntimeStatus(),
            (status) => status.pendingReadbackCount === 0
                && status.latestAggregate?.sourceTick >= fixedTick,
            `${label} transit ${fixedTick}`
        );
        const observation = harness.materializer.observeCompleted(
            fixedTick + 1
        );
        assert(observation.recoveryRequired !== true,
            `${label} transit observation ${fixedTick} failed`);
        committedHandles.push(...observation.committedHandles);
    }
    return Object.freeze({
        committedHandles: Object.freeze(committedHandles)
    });
}

async function executeDirect(harness, fixedTick, label, options = {}) {
    const snapshots = await stageSnapshots(
        harness,
        [ABILITY_SLOT_ID.Q],
        fixedTick,
        label
    );
    const payloadStage = harness.materializer.stageReadyForFixedTick({
        targetFixedTick: fixedTick + 1
    });
    if (options.expectRejected === true) {
        assert(payloadStage.stagedCount === 0
            && payloadStage.rejectedCount === 1
            && payloadStage.recoveryRequired !== true,
        `${label} expected 0/N preflight rejection: ${JSON.stringify(
            payloadStage
        )}`);
        return Object.freeze({
            snapshots,
            payloadStage,
            outcome: harness.wordSystem.getStatusView().lastExecutionOutcome,
            nextFixedTick: fixedTick + 1
        });
    }
    assert(payloadStage.stagedCount === 1
        && payloadStage.rejectedCount === 0
        && payloadStage.recoveryRequired !== true,
    `${label} payload stage failed: ${JSON.stringify(payloadStage)}`);
    const payloadObservation = await settleDirectPayload(
        harness,
        fixedTick + 1,
        label
    );
    return Object.freeze({
        snapshots,
        payloadStage,
        payloadObservation,
        outcome: harness.wordSystem.getStatusView().lastExecutionOutcome,
        nextFixedTick: fixedTick + 2
    });
}

function generatedMetadataFor(harness, executionId) {
    const handles = harness.registry.copyActiveHandlesInto([], {
        kindId: 'enemy'
    });
    const records = [];
    for (const handle of handles) {
        const view = harness.registry.copyEntityView(handle, {});
        if (view?.metadata?.sourceExecutionId === executionId) {
            records.push(Object.freeze({
                handle: Object.freeze({ ...handle }),
                metadata: view.metadata
            }));
        }
    }
    return Object.freeze(records);
}

function validateMultiplicity(harness, outcome, expectedSubjectCount,
    expectedCopies, label) {
    const expectedDestinationCount = expectedSubjectCount * expectedCopies;
    assert(outcome.code === ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED
        && outcome.subjectCount === expectedSubjectCount
        && outcome.generatedCount === expectedDestinationCount
        && outcome.copiesPerSubject === expectedCopies
        && outcome.modifierSetFingerprint > 0
        && outcome.cooldownConsumed === true,
    `${label} outcome mismatch: ${JSON.stringify(outcome)}`);
    const generated = generatedMetadataFor(harness, outcome.executionId);
    assert(generated.length === expectedDestinationCount,
        `${label} partial publication: ${generated.length}/${expectedDestinationCount}`);
    const keys = new Set();
    for (const { metadata } of generated) {
        assert(metadata.copiesPerSubject === expectedCopies
            && metadata.modifierSetFingerprint
                === outcome.modifierSetFingerprint
            && Number.isSafeInteger(metadata.sourceSubjectRank)
            && metadata.sourceSubjectRank >= 0
            && metadata.sourceSubjectRank < expectedSubjectCount
            && Number.isSafeInteger(metadata.copyIndex)
            && metadata.copyIndex >= 0
            && metadata.copyIndex < expectedCopies,
        `${label} provenance mismatch: ${JSON.stringify(metadata)}`);
        keys.add(`${metadata.sourceSubjectRank}:${metadata.copyIndex}`);
    }
    assert(keys.size === expectedDestinationCount,
        `${label} destination rank mapping was not one-to-one`);
    const history = harness.materializer.getStatus().history.at(-1);
    assert(history.subjectCount === expectedSubjectCount
        && history.destinationCount === expectedDestinationCount
        && history.copiesPerSubject === expectedCopies
        && history.modifierSetFingerprint === outcome.modifierSetFingerprint
        && Number.isSafeInteger(history.destinationFingerprint)
        && history.destinationFingerprint > 0,
    `${label} destination fingerprint mismatch: ${JSON.stringify(history)}`);
    return Object.freeze({
        destinationCount: expectedDestinationCount,
        destinationFingerprint: history.destinationFingerprint,
        modifierSetFingerprint: history.modifierSetFingerprint,
        sourceCopyPairCount: keys.size
    });
}

function assertClean(harness, label) {
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
    `${label} leak/storage invariant failed: ${JSON.stringify({
        telemetry,
        materializer: harness.materializer.getStatus(),
        endpoint: harness.endpoint.getStatus()
    })}`);
    return telemetry;
}

async function runPositive(device, definition) {
    const harness = createHarness(
        device,
        definition.capacity,
        loadoutFor(definition.sentence),
        { actorActionPlacementDestinationCapacity: definition.capacity }
    );
    let result = null;
    let destroyedTeardown = false;
    try {
        await initializePrimaryTower(harness);
        if (definition.subjectKind === 'enemy') {
            requestEnemyBatch(harness, definition.subjectCount, 2, definition.id);
        }
        const cast = definition.placement
            ? await executeImmediateEnemyPayload(
                harness,
                ABILITY_SLOT_ID.Q,
                2
            )
            : await executeDirect(harness, 2, definition.id);
        const provenance = validateMultiplicity(
            harness,
            cast.outcome,
            definition.subjectCount,
            definition.copies,
            definition.id
        );
        let landing = null;
        const transitAtLaunch = harness.endpoint
            .getActorPayloadMaterializationStatus().transit;
        if (definition.throwing) {
            const startTick = harness.materializer.getStatus().history.at(-1)
                .targetFixedTick;
            assert(transitAtLaunch.activeActorCount
                    === provenance.destinationCount
                && transitAtLaunch.activeActorHighWater
                    === provenance.destinationCount,
            `${definition.id} airborne mismatch: ${JSON.stringify(
                transitAtLaunch
            )}`);
            landing = await advanceTransitOnlyThroughFixedTick(
                harness,
                cast.nextFixedTick,
                startTick
                    + R5_THROW_ACTOR_ACTION_PROFILE.travelDurationFixedTicks,
                `${definition.id}-landing`
            );
            assert(landing.committedHandles.length
                    === provenance.destinationCount
                && harness.endpoint.getActorPayloadMaterializationStatus()
                    .transit.activeActorCount === 0,
            `${definition.id} landing mismatch: ${JSON.stringify(landing)}`);
        } else {
            assert(transitAtLaunch.activeActorCount === 0,
                `${definition.id} unexpectedly entered transit`);
        }
        const telemetry = assertClean(harness, definition.id);
        if (definition.placement) {
            assert(telemetry.placementDestinationHighWater
                    >= provenance.destinationCount,
            `${definition.id} destination high-water mismatch`);
        }
        result = Object.freeze({
            id: definition.id,
            subjectCount: cast.outcome.subjectCount,
            copiesPerSubject: cast.outcome.copiesPerSubject,
            generatedCount: cast.outcome.generatedCount,
            cooldownConsumed: cast.outcome.cooldownConsumed,
            ...provenance,
            airborneHighWater: transitAtLaunch.activeActorHighWater,
            landedCount: landing?.committedHandles.length ?? 0,
            siblingOverlapCount: 0,
            gridOverflowCount: telemetry.gridOverflowCount,
            telemetry
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

function blockedNavigationSource() {
    const base = createNavigationSource();
    const grid = base.getNavigationGrid();
    const blocked = new Uint8Array(grid.size);
    blocked.fill(1);
    const [entry, core] = base.route.waypoints;
    for (let column = entry.column; column <= core.column; column++) {
        blocked[entry.row * grid.cols + column] = 0;
    }
    return Object.freeze({
        ...base,
        getNavigationGrid: () => Object.freeze({ ...grid, blocked })
    });
}

async function runPreflightReject(device, definition) {
    const harness = createHarness(
        device,
        definition.capacity,
        loadoutFor(definition.sentence)
    );
    let result = null;
    let destroyedTeardown = false;
    try {
        await initializePrimaryTower(harness);
        if (definition.enemySubjects > 0) {
            requestEnemyBatch(
                harness,
                definition.enemySubjects,
                2,
                definition.id
            );
        }
        const cast = await executeDirect(harness, 2, definition.id, {
            expectRejected: true
        });
        const telemetry = assertClean(harness, definition.id);
        assert(cast.outcome.generatedCount === 0
            && cast.outcome.cooldownConsumed === false
            && harness.registry.getActiveCount('enemy')
                === definition.enemySubjects,
        `${definition.id} rejection mutated destination state`);
        result = Object.freeze({
            id: definition.id,
            outcomeCode: cast.outcome.code,
            subjectCount: cast.outcome.subjectCount,
            generatedCount: cast.outcome.generatedCount,
            cooldownConsumed: cast.outcome.cooldownConsumed,
            reservationCount: telemetry.reservedRegistryCount,
            recoveryRequired: recoveryRequired(harness),
            telemetry
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

async function runClosedPlacement(device) {
    const harness = createHarness(
        device,
        16,
        loadoutFor(TOWER_SUMMON_ENEMY_X2),
        { navigationSource: blockedNavigationSource() }
    );
    let result = null;
    let destroyedTeardown = false;
    try {
        await initializePrimaryTower(harness);
        await stageSnapshots(
            harness,
            [ABILITY_SLOT_ID.Q],
            2,
            'closed-placement',
            Object.freeze({ x: 80, y: 80 })
        );
        const payloadStage = harness.materializer.stageReadyForFixedTick({
            targetFixedTick: 3
        });
        assert(payloadStage.stagedCount === 1,
            `closed placement stage failed: ${JSON.stringify(payloadStage)}`);
        await openGenericBoundary(device, harness.endpoint, 3);
        harness.endpoint.commitAtFixedBoundary(3);
        const before = harness.backend.getActorActionPlacementRuntimeStatus()
            .completedCount;
        assert(await timedFixedUpdate(
            harness,
            3,
            'placement',
            'closed-placement'
        ), 'closed placement submit failed');
        await waitFor(
            device,
            () => harness.backend.getActorActionPlacementRuntimeStatus(),
            (status) => status.inFlightCount === 0
                && status.completedCount > before,
            'closed placement completion'
        );
        const observation = harness.materializer.observeCompleted(4);
        const outcome = harness.wordSystem.getStatusView().lastExecutionOutcome;
        const telemetry = assertClean(harness, 'closed-placement');
        assert(observation.committedCount === 0
            && outcome.generatedCount === 0
            && outcome.cooldownConsumed === false
            && telemetry.activeEnemyCount === 0,
        `closed placement published destinations: ${JSON.stringify({
            observation,
            outcome,
            telemetry
        })}`);
        result = Object.freeze({
            outcomeCode: outcome.code,
            generatedCount: outcome.generatedCount,
            cooldownConsumed: outcome.cooldownConsumed,
            reservationCount: telemetry.reservedRegistryCount,
            partialPublicationCount: telemetry.activeEnemyCount,
            recoveryRequired: recoveryRequired(harness),
            telemetry
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

async function runRingPressure(device) {
    const secondary = normalizeSentenceDefinition({
        ...TOWER_SHOOT_ENEMY_X2,
        id: 'sentence.r7.actual.tower-shoot-enemy-x2-secondary'
    });
    const harness = createHarness(
        device,
        16,
        loadoutFor(TOWER_SHOOT_ENEMY_X2, secondary),
        {
            actorPayloadCommandCapacity: 1,
            actorPayloadReadbackSlotCount: 1
        }
    );
    let result = null;
    let destroyedTeardown = false;
    try {
        await initializePrimaryTower(harness);
        await stageSnapshots(
            harness,
            [ABILITY_SLOT_ID.Q, ABILITY_SLOT_ID.E],
            2,
            'ring-pressure'
        );
        const firstStage = harness.materializer.stageReadyForFixedTick({
            targetFixedTick: 3
        });
        assert(firstStage.stagedCount === 1
            && firstStage.rejectedCount === 0
            && harness.registry.getReservedCount() === 2,
        `ring first stage mismatch: ${JSON.stringify(firstStage)}`);
        await settleDirectPayload(harness, 3, 'ring-pressure-first');
        const secondStage = harness.materializer.stageReadyForFixedTick({
            targetFixedTick: 4
        });
        assert(secondStage.stagedCount === 1
            && secondStage.rejectedCount === 0
            && harness.registry.getReservedCount() === 2,
        `ring retry mismatch: ${JSON.stringify(secondStage)}`);
        await settleDirectPayload(harness, 4, 'ring-pressure-second');
        const telemetry = assertClean(harness, 'ring-pressure');
        const history = harness.materializer.getStatus().history;
        assert(history.length === 2
            && history.every((entry) => entry.generatedCount === 2)
            && telemetry.activeEnemyCount === 4,
        `ring retry publication mismatch: ${JSON.stringify({
            history,
            telemetry
        })}`);
        result = Object.freeze({
            firstStagedCount: firstStage.stagedCount,
            retryStagedCount: secondStage.stagedCount,
            maximumReservationCount: 2,
            generatedCount: telemetry.activeEnemyCount,
            rejectedCount: firstStage.rejectedCount
                + secondStage.rejectedCount,
            recoveryRequired: recoveryRequired(harness),
            telemetry
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

async function runStaleCompletion(device) {
    const harness = createHarness(
        device,
        16,
        loadoutFor(TOWER_SHOOT_ENEMY_X2)
    );
    let result = null;
    let destroyedTeardown = false;
    try {
        await initializePrimaryTower(harness);
        await stageSnapshots(harness, [ABILITY_SLOT_ID.Q], 2,
            'stale-completion');
        const staged = harness.materializer.stageReadyForFixedTick({
            targetFixedTick: 3
        });
        assert(staged.stagedCount === 1
            && harness.registry.getReservedCount() === 2,
        `stale stage mismatch: ${JSON.stringify(staged)}`);
        await openGenericBoundary(device, harness.endpoint, 3);
        harness.endpoint.commitAtFixedBoundary(3);
        assert(harness.endpoint.fixedUpdate(FIXED_DELTA, 3) === true,
            'stale completion submit failed');
        assert(harness.materializer.resetGpuBinding(harness.endpoint) === true,
            'stale completion reset failed');
        await device.queue.onSubmittedWorkDone();
        await new Promise((resolve) => setTimeout(resolve, 25));
        const observation = harness.materializer.observeCompleted(4);
        const telemetry = assertClean(harness, 'stale-completion');
        const outcome = harness.wordSystem.getStatusView().lastExecutionOutcome;
        assert(observation.committedCount === 0
            && telemetry.activeEnemyCount === 0
            && outcome.generatedCount === 0
            && outcome.cooldownConsumed === false,
        `stale completion mutated state: ${JSON.stringify({
            observation,
            outcome,
            telemetry
        })}`);
        result = Object.freeze({
            observedMutationCount: observation.committedCount,
            generatedCount: outcome.generatedCount,
            cooldownConsumed: outcome.cooldownConsumed,
            reservationCount: telemetry.reservedRegistryCount,
            recoveryRequired: recoveryRequired(harness),
            telemetry
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
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

        const positiveDefinitions = [
            {
                id: 'tower-shoot-enemy-x2',
                sentence: TOWER_SHOOT_ENEMY_X2,
                subjectKind: 'tower',
                subjectCount: 1,
                copies: 2,
                capacity: 16,
                placement: false
            },
            {
                id: 'enemy-100-shoot-enemy-x2',
                sentence: ENEMY_SHOOT_ENEMY_X2,
                subjectKind: 'enemy',
                subjectCount: 100,
                copies: 2,
                capacity: 384,
                placement: false
            },
            {
                id: 'enemy-50-shoot-enemy-x4',
                sentence: ENEMY_SHOOT_ENEMY_X4,
                subjectKind: 'enemy',
                subjectCount: 50,
                copies: 4,
                capacity: 320,
                placement: false
            },
            {
                id: 'enemy-125-throw-enemy-x2',
                sentence: ENEMY_THROW_ENEMY_X2,
                subjectKind: 'enemy',
                subjectCount: 125,
                copies: 2,
                capacity: 512,
                placement: true,
                throwing: true
            },
            {
                id: 'enemy-128-summon-enemy-x2',
                sentence: ENEMY_SUMMON_ENEMY_X2,
                subjectKind: 'enemy',
                subjectCount: 128,
                copies: 2,
                capacity: 512,
                placement: true
            }
        ];
        const positives = [];
        for (const definition of positiveDefinitions) {
            checkpoint(`r7:${definition.id}`);
            positives.push(await runPositive(device, definition));
        }
        checkpoint('r7:generated-budget-reject');
        const generatedBudget = await runPreflightReject(device, {
            id: 'generated-budget-501-x2',
            sentence: ENEMY_SHOOT_ENEMY_X2,
            capacity: 1_600,
            enemySubjects: 501
        });
        checkpoint('r7:one-short-body');
        const oneShortBody = await runPreflightReject(device, {
            id: 'one-short-body',
            sentence: TOWER_SHOOT_ENEMY_X2,
            capacity: 2,
            enemySubjects: 0
        });
        checkpoint('r7:closed-placement');
        const closedPlacement = await runClosedPlacement(device);
        checkpoint('r7:ring-pressure');
        const ringPressure = await runRingPressure(device);
        checkpoint('r7:stale-completion');
        const staleCompletion = await runStaleCompletion(device);
        await device.queue.onSubmittedWorkDone();
        await new Promise((resolve) => setTimeout(resolve, 25));

        result.r7ActorPayloadMultiplicity = Object.freeze({
            scenario: 'r7-actor-payload-multiplicity-actual-webgpu',
            positives: Object.freeze(positives),
            negatives: Object.freeze({
                generatedBudget,
                oneShortBody,
                closedPlacement,
                ringPressure,
                staleCompletion
            }),
            storageMaximum: Math.max(
                ...positives.map((entry) => entry.telemetry.storageMaximum),
                generatedBudget.telemetry.storageMaximum,
                oneShortBody.telemetry.storageMaximum,
                closedPlacement.telemetry.storageMaximum,
                ringPressure.telemetry.storageMaximum,
                staleCompletion.telemetry.storageMaximum
            ),
            uncapturedErrorCount: uncapturedErrors.length,
            destroyedTeardown: positives.every((entry) => (
                entry.destroyedTeardown === true
            )) && [
                generatedBudget,
                oneShortBody,
                closedPlacement,
                ringPressure,
                staleCompletion
            ].every((entry) => entry.destroyedTeardown === true)
        });
        result.uncapturedErrorCount = uncapturedErrors.length;
        assert(uncapturedErrors.length === 0,
            `uncaptured WebGPU errors: ${JSON.stringify(uncapturedErrors)}`);
        assert(result.r7ActorPayloadMultiplicity.storageMaximum <= 9,
            'R7 storage maximum exceeded 9');
        assert(result.r7ActorPayloadMultiplicity.destroyedTeardown === true,
            'R7 teardown did not destroy every harness');
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
            // Failure cleanup is best effort.
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
