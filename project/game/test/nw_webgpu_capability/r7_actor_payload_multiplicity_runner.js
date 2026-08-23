import {
    R3_ENEMY_WORD_INSTANCE,
    R3_SHOOT_WORD_INSTANCE,
    R3_TOWER_WORD_INSTANCE,
    R5_SUMMON_WORD_INSTANCE,
    R5_THROW_WORD_INSTANCE,
    R7_TWICE_WORD_INSTANCE_1,
    R7_TWICE_WORD_INSTANCE_2,
    R7_TWICE_WORD_INSTANCE_3
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
    TOWER_CREATION_RESULT,
    TOWER_SHARE_SCALE
} from './production/script/module/ingame/object/tower/tower_group_contract.js';
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
    waitFor
} from './r5_actor_verbs_runner.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const REQUIRED_STORAGE_BUFFER_LIMIT = 9;
const TIMESTAMP_SAMPLE_CAPACITY = 256;
let timingRecorder = null;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function percentile(values, quantile) {
    assert(Array.isArray(values) && values.length > 0,
        'R7 timing percentile sample이 비어 있습니다.');
    const sorted = [...values].sort((left, right) => left - right);
    const rank = Math.max(
        0,
        Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)
    );
    return sorted[rank];
}

function createTimingRecorder(device, timestampQuerySupported) {
    const samples = [];
    const querySet = timestampQuerySupported
        ? device.createQuerySet({
            label: 'r7-modifier-acceptance-timestamps',
            type: 'timestamp',
            count: TIMESTAMP_SAMPLE_CAPACITY * 2
        })
        : null;
    let finalized = false;
    return Object.freeze({
        async submit(category, label, callback) {
            assert(!finalized, 'R7 timing recorder가 이미 finalize됐습니다.');
            assert(samples.length < TIMESTAMP_SAMPLE_CAPACITY,
                'R7 timing sample capacity를 초과했습니다.');
            const sampleIndex = samples.length;
            if (querySet) {
                const encoder = device.createCommandEncoder({
                    label: `${label}-timestamp-begin`
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
                    label: `${label}-timestamp-end`
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
                category,
                label,
                fullBoundaryElapsedMs: performance.now() - startedAt
            });
            return callbackResult;
        },
        async finalize() {
            assert(!finalized, 'R7 timing recorder finalize가 중복됐습니다.');
            finalized = true;
            if (querySet && samples.length > 0) {
                const byteLength = samples.length * 2
                    * BigUint64Array.BYTES_PER_ELEMENT;
                const resolveBuffer = device.createBuffer({
                    label: 'r7-modifier-timestamp-resolve',
                    size: byteLength,
                    usage: GPUBufferUsage.QUERY_RESOLVE
                        | GPUBufferUsage.COPY_SRC
                });
                const readback = device.createBuffer({
                    label: 'r7-modifier-timestamp-readback',
                    size: byteLength,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                });
                try {
                    const encoder = device.createCommandEncoder({
                        label: 'r7-modifier-timestamp-copy'
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
            const summarize = (values) => Object.freeze({
                sampleCount: values.length,
                p50: values.length > 0 ? percentile(values, 0.5) : null,
                p95: values.length > 0 ? percentile(values, 0.95) : null
            });
            const categories = [...new Set(samples.map((sample) => (
                sample.category
            )))];
            const gpu = {};
            const wall = {};
            for (const category of categories) {
                const categorySamples = samples.filter((sample) => (
                    sample.category === category
                ));
                gpu[category] = summarize(categorySamples
                    .filter((sample) => Number.isFinite(sample.gpuElapsedMs))
                    .map((sample) => sample.gpuElapsedMs));
                wall[category] = summarize(categorySamples.map((sample) => (
                    sample.fullBoundaryElapsedMs
                )));
            }
            return Object.freeze({
                scope: 'serialized R7 fixed-boundary timestamp markers; diagnostic only',
                hardFrameBudgetClaim: false,
                timestampQuerySupported,
                gpu: Object.freeze(gpu),
                wall: Object.freeze(wall),
                fullFixedBoundaryElapsedMs: summarize(samples.map((sample) => (
                    sample.fullBoundaryElapsedMs
                ))),
                samples: Object.freeze(samples.map((sample) => Object.freeze({
                    ...sample
                })))
            });
        }
    });
}

async function timedFixedUpdate(harness, fixedTick, category, label) {
    const submit = () => harness.endpoint.fixedUpdate(FIXED_DELTA, fixedTick);
    return timingRecorder
        ? timingRecorder.submit(category, label, submit)
        : submit();
}

function sentence({ id, subject, verb, payload, modifierCount = 1 }) {
    const modifiers = [
        R7_TWICE_WORD_INSTANCE_1.id,
        R7_TWICE_WORD_INSTANCE_2.id,
        R7_TWICE_WORD_INSTANCE_3.id
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
const TOWER_SHOOT_TOWER_X2 = sentence({
    id: 'sentence.r7.actual.tower-shoot-tower-x2',
    subject: R3_TOWER_WORD_INSTANCE,
    verb: R3_SHOOT_WORD_INSTANCE,
    payload: R3_TOWER_WORD_INSTANCE
});
const TOWER_SHOOT_ENEMY_X8 = sentence({
    id: 'sentence.r7.actual.tower-shoot-enemy-x8',
    subject: R3_TOWER_WORD_INSTANCE,
    verb: R3_SHOOT_WORD_INSTANCE,
    payload: R3_ENEMY_WORD_INSTANCE,
    modifierCount: 3
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
        'snapshot',
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

async function settleDirectPayload(harness, fixedTick, label, options = {}) {
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
        'materialization',
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
    const expectedCommittedCount = options.expectPlacementRejected === true
        ? 0
        : 1;
    assert(observation.recoveryRequired !== true
        && observation.committedCount === expectedCommittedCount,
    `${label} settlement failed: ${JSON.stringify({
        expectedCommittedCount,
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
        const submit = () => harness.backend.advanceActorTransits(fixedTick);
        const submitted = timingRecorder
            ? await timingRecorder.submit(
                'transit',
                `${label}-transit-${fixedTick}`,
                submit
            )
            : submit();
        assert(submitted === true,
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

async function advanceTransitWithReadbackPressure(
    harness,
    firstFixedTick,
    lastFixedTick,
    label
) {
    const firstAccepted = harness.backend.advanceActorTransits(
        firstFixedTick
    );
    const firstStatus = harness.backend.getActorTransitRuntimeStatus();
    const saturatedAccepted = harness.backend.advanceActorTransits(
        firstFixedTick + 1
    );
    const saturatedStatus = harness.backend.getActorTransitRuntimeStatus();
    assert(firstAccepted === true
        && firstStatus.pendingReadbackCount === 1
        && saturatedAccepted === true
        && saturatedStatus.pendingReadbackCount === 1
        && saturatedStatus.deferredReadbackCount >= 1
        && recoveryRequired(harness) === false,
    `${label} transit readback pressure mismatch: ${JSON.stringify({
        firstAccepted,
        saturatedAccepted,
        saturatedStatus
    })}`);
    await waitFor(
        harness.device,
        () => harness.backend.getActorTransitRuntimeStatus(),
        (status) => status.pendingReadbackCount === 0
            && status.latestAggregate?.sourceTick >= firstFixedTick,
        `${label} first transit pressure completion`
    );
    const committedHandles = [];
    const firstObservation = harness.materializer.observeCompleted(
        firstFixedTick + 1
    );
    assert(firstObservation.recoveryRequired !== true,
        `${label} first transit pressure observation failed`);
    committedHandles.push(...firstObservation.committedHandles);

    const retryTick = firstFixedTick + 1;
    const retrySubmit = () => harness.backend.advanceActorTransits(
        retryTick
    );
    const retryAccepted = timingRecorder
        ? await timingRecorder.submit(
            'transit',
            `${label}-retry-transit-${retryTick}`,
            retrySubmit
        )
        : retrySubmit();
    assert(retryAccepted === true,
        `${label} transit readback retry was not accepted`);
    await waitFor(
        harness.device,
        () => harness.backend.getActorTransitRuntimeStatus(),
        (status) => status.pendingReadbackCount === 0
            && status.latestAggregate?.sourceTick >= retryTick,
        `${label} transit pressure retry completion`
    );
    const retryObservation = harness.materializer.observeCompleted(
        retryTick + 1
    );
    assert(retryObservation.recoveryRequired !== true,
        `${label} transit pressure retry observation failed`);
    committedHandles.push(...retryObservation.committedHandles);

    if (retryTick + 1 <= lastFixedTick) {
        const remainder = await advanceTransitOnlyThroughFixedTick(
            harness,
            retryTick + 1,
            lastFixedTick,
            label
        );
        committedHandles.push(...remainder.committedHandles);
    }
    return Object.freeze({
        committedHandles: Object.freeze(committedHandles),
        pressure: Object.freeze({
            readbackSlotCount: 1,
            firstAccepted,
            saturatedPendingReadbackCount:
                saturatedStatus.pendingReadbackCount,
            saturatedAccepted,
            deferredReadbackCount:
                saturatedStatus.deferredReadbackCount,
            retryAccepted,
            recoveryRequired: recoveryRequired(harness)
        })
    });
}

async function executeDirect(harness, fixedTick, label, options = {}) {
    const slotId = options.slotId ?? ABILITY_SLOT_ID.Q;
    const snapshots = await stageSnapshots(
        harness,
        [slotId],
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
        label,
        options
    );
    return Object.freeze({
        snapshots,
        payloadStage,
        payloadObservation,
        outcome: harness.wordSystem.getStatusView().lastExecutionOutcome,
        nextFixedTick: fixedTick + 2
    });
}

function drainExactTowerTerminalReceipt(harness, expected, label) {
    const receipts = harness.coordinator.drainActorPayloadTerminalReceipts([]);
    assert(receipts.length === 1 && receipts[0] === expected,
        `${label} terminal receipt mismatch: ${JSON.stringify({
            receipts,
            expected
        })}`);
    return receipts[0];
}

async function executeTowerPayload(harness, fixedTick, label) {
    const snapshots = await stageSnapshots(
        harness,
        [ABILITY_SLOT_ID.Q],
        fixedTick,
        label
    );
    const payloadStage = harness.materializer.stageReadyForFixedTick({
        targetFixedTick: fixedTick + 1
    });
    assert(payloadStage.recoveryRequired !== true,
        `${label} Tower payload stage requested recovery`);
    if (payloadStage.stagedCount === 0) {
        assert(payloadStage.rejectedCount === 1,
            `${label} Tower payload rejection cardinality mismatch`);
        return Object.freeze({
            snapshots,
            payloadStage,
            towerRequest: null,
            towerReceipt: null,
            materializerObservation: null,
            outcome: harness.wordSystem.getStatusView().lastExecutionOutcome,
            rejected: true,
            rejectedAt: 'payload-preflight',
            nextFixedTick: fixedTick + 2,
            storageMaximum: storageMaximum(harness)
        });
    }
    assert(payloadStage.stagedCount === 1
        && payloadStage.rejectedCount === 0,
    `${label} Tower payload queue mismatch: ${JSON.stringify(payloadStage)}`);
    const towerRequest = harness.coordinator.queued;
    assert(towerRequest, `${label} normalized Tower request missing`);

    await openGenericBoundary(harness.device, harness.endpoint, fixedTick + 1);
    const placementLifecycle = harness.endpoint.commitAtFixedBoundary(
        fixedTick + 1
    );
    assert(placementLifecycle.recoveryRequired !== true
        && placementLifecycle.rejected.length === 0,
    `${label} placement lifecycle failed: ${JSON.stringify(
        placementLifecycle
    )}`);
    const placementCompletedBefore = harness.backend
        .getActorActionPlacementRuntimeStatus().completedCount;
    const coordinatorStage = harness.coordinator.stageForFixedTick(
        fixedTick + 1
    );
    if (coordinatorStage.pending !== true) {
        const towerReceipt = drainExactTowerTerminalReceipt(
            harness,
            coordinatorStage,
            `${label} placement-stage rejection`
        );
        const materializerObservation = harness.materializer
            .observeTowerCreationCompletion(towerReceipt, fixedTick + 1);
        return Object.freeze({
            snapshots,
            payloadStage,
            coordinatorStage,
            towerRequest,
            towerReceipt,
            materializerObservation,
            outcome: harness.wordSystem.getStatusView().lastExecutionOutcome,
            rejected: true,
            rejectedAt: 'placement-stage',
            nextFixedTick: fixedTick + 2,
            storageMaximum: storageMaximum(harness)
        });
    }
    assert(coordinatorStage.phase === 'actor-action-placement',
        `${label} placement phase mismatch`);
    assert(await timedFixedUpdate(
        harness,
        fixedTick + 1,
        'placement',
        `${label}-placement-${fixedTick + 1}`
    ), `${label} placement submit failed`);
    await waitFor(
        harness.device,
        () => harness.backend.getActorActionPlacementRuntimeStatus(),
        (status) => status.inFlightCount === 0
            && status.completedCount > placementCompletedBefore,
        `${label} placement completion`
    );

    await openGenericBoundary(harness.device, harness.endpoint, fixedTick + 2);
    const placementReady = harness.coordinator
        .observeCompletedAtFixedBoundary(fixedTick + 2);
    if (placementReady.pending !== true) {
        const towerReceipt = drainExactTowerTerminalReceipt(
            harness,
            placementReady,
            `${label} placement-completion rejection`
        );
        const materializerObservation = harness.materializer
            .observeTowerCreationCompletion(towerReceipt, fixedTick + 2);
        return Object.freeze({
            snapshots,
            payloadStage,
            coordinatorStage,
            placementReady,
            towerRequest,
            towerReceipt,
            materializerObservation,
            outcome: harness.wordSystem.getStatusView().lastExecutionOutcome,
            rejected: true,
            rejectedAt: 'placement-completion',
            nextFixedTick: fixedTick + 3,
            storageMaximum: storageMaximum(harness)
        });
    }
    assert(placementReady.phase === 'actor-action-placement-ready'
        && placementReady.readyForCreationStage === true,
    `${label} placement-ready receipt mismatch: ${JSON.stringify(
        placementReady
    )}`);
    const creationCompletedBefore = harness.backend
        .getTowerCreationRuntimeStatus().completedCount;
    const creationStage = harness.coordinator
        .stageReadyActorActionPlacementAtFixedBoundary(fixedTick + 2);
    assert(creationStage.pending === true
        && creationStage.phase === 'tower-creation'
        && creationStage.staged === true,
    `${label} Tower creation stage failed: ${JSON.stringify(creationStage)}`);
    const creationLifecycle = harness.endpoint.commitAtFixedBoundary(
        fixedTick + 2
    );
    assert(creationLifecycle.recoveryRequired !== true
        && creationLifecycle.rejected.length === 0,
    `${label} creation lifecycle failed: ${JSON.stringify(
        creationLifecycle
    )}`);
    assert(await timedFixedUpdate(
        harness,
        fixedTick + 2,
        'tower-creation',
        `${label}-tower-creation-${fixedTick + 2}`
    ), `${label} Tower creation submit failed`);
    await waitFor(
        harness.device,
        () => harness.backend.getTowerCreationRuntimeStatus(),
        (status) => status.pendingReadbackCount === 0
            && status.completedCount > creationCompletedBefore,
        `${label} Tower creation completion`
    );
    await openGenericBoundary(
        harness.device,
        harness.endpoint,
        fixedTick + 3
    );
    const observedReceipt = harness.coordinator
        .observeCompletedAtFixedBoundary(fixedTick + 3);
    const towerReceipt = drainExactTowerTerminalReceipt(
        harness,
        observedReceipt,
        `${label} creation settlement`
    );
    const materializerObservation = harness.materializer
        .observeTowerCreationCompletion(towerReceipt, fixedTick + 3);
    const committed = towerReceipt.result === TOWER_CREATION_RESULT.COMMITTED;
    assert(committed
        && materializerObservation.committedCount === 1
        && materializerObservation.recoveryRequired !== true,
    `${label} Tower creation did not commit: ${JSON.stringify({
        towerReceipt,
        materializerObservation
    })}`);
    return Object.freeze({
        snapshots,
        payloadStage,
        coordinatorStage,
        placementReady,
        creationStage,
        towerRequest,
        towerReceipt,
        materializerObservation,
        outcome: harness.wordSystem.getStatusView().lastExecutionOutcome,
        rejected: false,
        rejectedAt: null,
        nextFixedTick: fixedTick + 4,
        storageMaximum: storageMaximum(harness)
    });
}

async function settleQueuedTowerPayload(
    harness,
    fixedTick,
    label,
    captureRingPressure = false
) {
    const towerRequest = harness.coordinator.queued;
    assert(towerRequest, `${label} queued Tower request missing`);
    await openGenericBoundary(harness.device, harness.endpoint, fixedTick);
    const placementLifecycle = harness.endpoint.commitAtFixedBoundary(
        fixedTick
    );
    assert(placementLifecycle.recoveryRequired !== true
        && placementLifecycle.rejected.length === 0,
    `${label} Tower pressure placement lifecycle failed`);
    const placementCompletedBefore = harness.backend
        .getActorActionPlacementRuntimeStatus().completedCount;
    const coordinatorStage = harness.coordinator.stageForFixedTick(fixedTick);
    assert(coordinatorStage.pending === true
        && coordinatorStage.phase === 'actor-action-placement',
    `${label} Tower pressure placement stage failed`);
    assert(await timedFixedUpdate(
        harness,
        fixedTick,
        'placement',
        `${label}-placement-${fixedTick}`
    ), `${label} Tower pressure placement submit failed`);
    await waitFor(
        harness.device,
        () => harness.backend.getActorActionPlacementRuntimeStatus(),
        (status) => status.inFlightCount === 0
            && status.completedCount > placementCompletedBefore,
        `${label} Tower pressure placement completion`
    );

    await openGenericBoundary(
        harness.device,
        harness.endpoint,
        fixedTick + 1
    );
    const placementReady = harness.coordinator
        .observeCompletedAtFixedBoundary(fixedTick + 1);
    assert(placementReady.pending === true
        && placementReady.readyForCreationStage === true,
    `${label} Tower pressure placement-ready failed`);
    const creationCompletedBefore = harness.backend
        .getTowerCreationRuntimeStatus().completedCount;
    const creationStage = harness.coordinator
        .stageReadyActorActionPlacementAtFixedBoundary(fixedTick + 1);
    assert(creationStage.pending === true
        && creationStage.phase === 'tower-creation'
        && creationStage.staged === true,
    `${label} Tower pressure creation stage failed`);
    const creationLifecycle = harness.endpoint.commitAtFixedBoundary(
        fixedTick + 1
    );
    assert(creationLifecycle.recoveryRequired !== true
        && creationLifecycle.rejected.length === 0,
    `${label} Tower pressure creation lifecycle failed`);
    const blockedBeforeSubmit
        = harness.backend.canStageTowerCreation() === false;
    let saturatedStatus = null;
    if (captureRingPressure) {
        assert(harness.endpoint.fixedUpdate(
            FIXED_DELTA,
            fixedTick + 1
        ), `${label} Tower ring submit failed`);
        saturatedStatus = harness.backend.getTowerCreationRuntimeStatus();
        assert(blockedBeforeSubmit
            && saturatedStatus.pendingReadbackCount === 1
            && harness.backend.canStageTowerCreation() === false
            && recoveryRequired(harness) === false,
        `${label} Tower creation ring pressure mismatch: ${JSON.stringify({
            blockedBeforeSubmit,
            saturatedStatus
        })}`);
    } else {
        assert(await timedFixedUpdate(
            harness,
            fixedTick + 1,
            'tower-creation',
            `${label}-tower-creation-${fixedTick + 1}`
        ), `${label} Tower pressure creation submit failed`);
    }
    await waitFor(
        harness.device,
        () => harness.backend.getTowerCreationRuntimeStatus(),
        (status) => status.pendingReadbackCount === 0
            && status.completedCount > creationCompletedBefore,
        `${label} Tower pressure creation completion`
    );
    await openGenericBoundary(
        harness.device,
        harness.endpoint,
        fixedTick + 2
    );
    const observedReceipt = harness.coordinator
        .observeCompletedAtFixedBoundary(fixedTick + 2);
    const towerReceipt = drainExactTowerTerminalReceipt(
        harness,
        observedReceipt,
        `${label} Tower pressure settlement`
    );
    const materializerObservation = harness.materializer
        .observeTowerCreationCompletion(towerReceipt, fixedTick + 2);
    assert(towerReceipt.result === TOWER_CREATION_RESULT.COMMITTED
        && materializerObservation.committedCount === 1
        && materializerObservation.recoveryRequired !== true,
    `${label} Tower pressure did not commit`);
    return Object.freeze({
        towerRequest,
        towerReceipt,
        materializerObservation,
        outcome: harness.wordSystem.getStatusView().lastExecutionOutcome,
        pressure: captureRingPressure
            ? Object.freeze({
                readbackSlotCount: 1,
                blockedBeforeSubmit,
                saturatedPendingReadbackCount:
                    saturatedStatus.pendingReadbackCount,
                recoveryRequired: recoveryRequired(harness)
            })
            : null,
        nextFixedTick: fixedTick + 3
    });
}

async function runTowerCreationRingPressure(device) {
    const secondary = normalizeSentenceDefinition({
        ...TOWER_SHOOT_TOWER_X2,
        id: 'sentence.r7.actual.tower-shoot-tower-x2-secondary'
    });
    const harness = createHarness(
        device,
        32,
        loadoutFor(TOWER_SHOOT_TOWER_X2, secondary),
        {
            actorActionPlacementDestinationCapacity: 8,
            towerCreationReadbackSlotCount: 1
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
            'tower-creation-ring-pressure'
        );
        const firstStage = harness.materializer.stageReadyForFixedTick({
            targetFixedTick: 3
        });
        assert(firstStage.stagedCount === 1
            && firstStage.rejectedCount === 0,
        `Tower creation first ring stage mismatch: ${JSON.stringify(
            firstStage
        )}`);
        const first = await settleQueuedTowerPayload(
            harness,
            3,
            'tower-creation-ring-pressure-first',
            true
        );
        const availableAfterFirst
            = harness.backend.canStageTowerCreation() === true;
        const retryStage = harness.materializer.stageReadyForFixedTick({
            targetFixedTick: first.nextFixedTick
        });
        assert(availableAfterFirst
            && retryStage.stagedCount === 1
            && retryStage.rejectedCount === 0,
        `Tower creation ring retry stage mismatch: ${JSON.stringify({
            availableAfterFirst,
            retryStage
        })}`);
        const retry = await settleQueuedTowerPayload(
            harness,
            first.nextFixedTick,
            'tower-creation-ring-pressure-retry'
        );
        const telemetry = assertClean(harness, 'tower-creation-ring-pressure');
        assert(first.outcome.subjectCount === 1
            && first.outcome.generatedCount === 2
            && retry.outcome.subjectCount === 1
            && retry.outcome.generatedCount === 2
            && harness.towerGroupState.getStatus().livingTowerCount === 5,
        `Tower creation ring retry publication mismatch: ${JSON.stringify({
            first,
            retry,
            towerStatus: harness.towerGroupState.getStatus()
        })}`);
        result = Object.freeze({
            readbackSlotCount: 1,
            firstStagedCount: firstStage.stagedCount,
            blockedBeforeSubmit: first.pressure.blockedBeforeSubmit,
            saturatedPendingReadbackCount:
                first.pressure.saturatedPendingReadbackCount,
            availableAfterFirst,
            retryStagedCount: retryStage.stagedCount,
            resultingLivingTowerCount:
                harness.towerGroupState.getStatus().livingTowerCount,
            recoveryRequired: recoveryRequired(harness),
            telemetry
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

function towerAggregate(harness) {
    const living = harness.towerGroupState.getTowerRecords().filter(
        (record) => record.alive
    );
    return Object.freeze({
        livingCount: living.length,
        shareUnits: living.reduce(
            (sum, record) => sum + record.shareUnits,
            0
        ),
        currentHpFixedPoint: living.reduce(
            (sum, record) => sum + record.currentHpFixedPoint,
            0
        ),
        maxHpFixedPoint: living.reduce(
            (sum, record) => sum + record.maxHpFixedPoint,
            0
        ),
        powerFixedPoint: living.reduce(
            (sum, record) => sum + record.powerFixedPoint,
            0
        ),
        lostShareUnits: harness.towerGroupState.getStatus().lostShareUnits
    });
}

async function runTowerGrowth(device) {
    const harness = createHarness(
        device,
        512,
        loadoutFor(TOWER_SHOOT_TOWER_X2, TOWER_SHOOT_ENEMY_X8),
        { actorActionPlacementDestinationCapacity: 256 }
    );
    let result = null;
    let destroyedTeardown = false;
    try {
        await initializePrimaryTower(harness);
        const copiesEightCast = await executeDirect(
            harness,
            2,
            'tower-1-shoot-enemy-x8',
            { slotId: ABILITY_SLOT_ID.E }
        );
        const copiesEight = validateMultiplicity(
            harness,
            copiesEightCast.outcome,
            1,
            8,
            'tower-1-shoot-enemy-x8'
        );
        const initial = towerAggregate(harness);
        const towerCounts = [initial.livingCount];
        const executions = [];
        let fixedTick = copiesEightCast.nextFixedTick;
        for (const expectedLivingCount of [3, 9, 27, 81, 243]) {
            const before = towerAggregate(harness);
            const cast = await executeTowerPayload(
                harness,
                fixedTick,
                `tower-growth-${before.livingCount}-to-${expectedLivingCount}`
            );
            assert(cast.rejected === false,
                `Tower growth rejected at ${before.livingCount}`);
            const after = towerAggregate(harness);
            const outcome = cast.outcome;
            assert(outcome.code === ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED
                && outcome.subjectCount === before.livingCount
                && outcome.generatedCount === before.livingCount * 2
                && outcome.copiesPerSubject === 2
                && outcome.modifierSetFingerprint > 0
                && outcome.cooldownConsumed === true,
            `Tower growth outcome mismatch: ${JSON.stringify(outcome)}`);
            assert(after.livingCount === expectedLivingCount
                && after.shareUnits + after.lostShareUnits
                    === TOWER_SHARE_SCALE
                && after.currentHpFixedPoint
                    === initial.currentHpFixedPoint
                && after.maxHpFixedPoint === initial.maxHpFixedPoint
                && after.powerFixedPoint === initial.powerFixedPoint,
            `Tower growth aggregate mismatch: ${JSON.stringify({
                initial,
                before,
                after
            })}`);
            const created = harness.towerGroupState.getTowerRecords().filter(
                (record) => record.creationMetadata?.sourceExecutionId
                    === outcome.executionId
            );
            const sourceCopyKeys = new Set(created.map((record) => (
                `${record.creationMetadata.sourceSubjectRank}:`
                + `${record.creationMetadata.copyIndex}`
            )));
            assert(created.length === outcome.generatedCount
                && sourceCopyKeys.size === outcome.generatedCount
                && created.every((record) => (
                    record.creationMetadata.copiesPerSubject === 2
                    && record.creationMetadata.destinationCount
                        === outcome.generatedCount
                    && record.creationMetadata.modifierSetFingerprint
                        === outcome.modifierSetFingerprint
                )),
            `Tower growth provenance mismatch at ${expectedLivingCount}`);
            towerCounts.push(after.livingCount);
            executions.push(Object.freeze({
                subjectCount: outcome.subjectCount,
                generatedCount: outcome.generatedCount,
                resultingLivingTowerCount: after.livingCount,
                modifierSetFingerprint: outcome.modifierSetFingerprint,
                sourceCopyPairCount: sourceCopyKeys.size,
                storageMaximum: cast.storageMaximum
            }));
            fixedTick = cast.nextFixedTick;
        }

        const beforeReject = towerAggregate(harness);
        const recordCountBeforeReject = harness.towerGroupState
            .getTowerRecords().length;
        const capReject = await executeTowerPayload(
            harness,
            fixedTick,
            'tower-growth-243-cap-reject'
        );
        const afterReject = towerAggregate(harness);
        assert(capReject.rejected === true
            && capReject.outcome.generatedCount === 0
            && capReject.outcome.cooldownConsumed === false
            && afterReject.livingCount === 243
            && harness.towerGroupState.getTowerRecords().length
                === recordCountBeforeReject
            && harness.registry.getReservedCount() === 0,
        `Tower cap rejection mutated state: ${JSON.stringify({
            capReject,
            beforeReject,
            afterReject
        })}`);
        const livingOrdinals = harness.towerGroupState.getTowerRecords()
            .filter((record) => record.alive)
            .map((record) => record.logicalTowerOrdinal);
        assert(livingOrdinals.length === 243
            && livingOrdinals.every((ordinal, index) => ordinal === index + 1),
        'Tower growth logical ordinals are not monotonic');
        const telemetry = assertClean(harness, 'tower-growth');
        result = Object.freeze({
            copiesEightTiming: Object.freeze({
                subjectCount: copiesEightCast.outcome.subjectCount,
                copiesPerSubject:
                    copiesEightCast.outcome.copiesPerSubject,
                generatedCount: copiesEightCast.outcome.generatedCount,
                ...copiesEight
            }),
            towerCounts: Object.freeze(towerCounts),
            executions: Object.freeze(executions),
            capReject: Object.freeze({
                rejectedAt: capReject.rejectedAt,
                result: capReject.towerReceipt?.result ?? null,
                reason: capReject.towerReceipt?.reason ?? null,
                outcomeCode: capReject.outcome.code,
                generatedCount: capReject.outcome.generatedCount,
                cooldownConsumed: capReject.outcome.cooldownConsumed,
                mutationCount: afterReject.livingCount
                    - beforeReject.livingCount
            }),
            finalAggregate: afterReject,
            ordinalMinimum: livingOrdinals[0],
            ordinalMaximum: livingOrdinals.at(-1),
            telemetry,
            recoveryRequired: recoveryRequired(harness)
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
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
        {
            actorActionPlacementDestinationCapacity: definition.capacity,
            actorTransitReadbackSlotCount: definition.throwing ? 1 : undefined
        }
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
            landing = await advanceTransitWithReadbackPressure(
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
            transitReadbackPressure: landing?.pressure ?? null,
            siblingOverlapCount: 0,
            gridOverflowCount: telemetry.gridOverflowCount,
            telemetry
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

async function runStackedTimingCardinality(device) {
    const harness = createHarness(
        device,
        800,
        loadoutFor(ENEMY_SHOOT_ENEMY_X4, ENEMY_SHOOT_ENEMY_X2)
    );
    let result = null;
    let destroyedTeardown = false;
    try {
        await initializePrimaryTower(harness);
        requestEnemyBatch(harness, 50, 2, 'enemy-50-x4-then-250-x2');
        const copiesFourCast = await executeDirect(
            harness,
            2,
            'enemy-50-shoot-enemy-x4'
        );
        const copiesFour = validateMultiplicity(
            harness,
            copiesFourCast.outcome,
            50,
            4,
            'enemy-50-shoot-enemy-x4'
        );
        assert(harness.registry.getActiveCount('enemy') === 250,
            'x4 timing fixture did not produce 250 follow-up Subjects');
        const subjects250Cast = await executeDirect(
            harness,
            copiesFourCast.nextFixedTick,
            'enemy-250-shoot-enemy-x2',
            {
                slotId: ABILITY_SLOT_ID.E,
                expectPlacementRejected: true
            }
        );
        const subjects250Outcome = subjects250Cast.outcome;
        const subjects250History = harness.materializer.getStatus()
            .history.at(-1);
        assert(subjects250Outcome.subjectCount === 250
            && subjects250Outcome.copiesPerSubject === 2
            && subjects250Outcome.generatedCount === 0
            && subjects250Outcome.cooldownConsumed === false
            && subjects250Outcome.modifierSetFingerprint > 0
            && subjects250History.state === 'REJECTED_PLACEMENT'
            && subjects250History.reason?.code
                === 'NO_VALID_GLOBAL_PLACEMENT',
        `250-Subject grid pressure mismatch: ${JSON.stringify({
            subjects250Outcome,
            subjects250History
        })}`);
        const telemetry = assertClean(
            harness,
            'enemy-50-x4-then-250-x2'
        );
        assert(telemetry.activeEnemyCount === 250,
            '250-Subject pressure partially published');
        result = Object.freeze({
            id: 'enemy-50-x4-then-250-x2',
            casts: Object.freeze([
                Object.freeze({
                    subjectCount: copiesFourCast.outcome.subjectCount,
                    copiesPerSubject:
                        copiesFourCast.outcome.copiesPerSubject,
                    generatedCount: copiesFourCast.outcome.generatedCount,
                    ...copiesFour
                }),
                Object.freeze({
                    subjectCount: subjects250Outcome.subjectCount,
                    copiesPerSubject:
                        subjects250Outcome.copiesPerSubject,
                    requestedDestinationCount: 500,
                    generatedCount: subjects250Outcome.generatedCount,
                    cooldownConsumed:
                        subjects250Outcome.cooldownConsumed,
                    outcomeCode: subjects250Outcome.code,
                    reason: subjects250History.reason,
                    recoveryRequired: recoveryRequired(harness)
                })
            ]),
            cooldownConsumed: copiesFourCast.outcome.cooldownConsumed,
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

async function runOneShortCapacityPressure(device, domain) {
    const harness = createHarness(
        device,
        3,
        loadoutFor(TOWER_SHOOT_ENEMY_X2)
    );
    let result = null;
    let destroyedTeardown = false;
    let registryReservation = null;
    let bodyPreleaseToken = null;
    try {
        await initializePrimaryTower(harness);
        if (domain === 'registry') {
            registryReservation = harness.registry.reserveEntity({
                kindId: 'enemy',
                definitionId: 'r7-pressure-registry-reservation',
                createdAtTick: 2
            });
            assert(registryReservation,
                'registry one-short reservation failed');
        } else {
            const bodyPrelease = harness.backend.preleaseActorPayloadBodies({
                handles: [Object.freeze({
                    entityId: 0x7fff0001,
                    incarnation: 1
                })],
                spawnTemplate: harness.backend
                    .createAbilityEnemyPayloadSpawnTemplate(1)
            });
            assert(bodyPrelease.accepted === true
                && bodyPrelease.preleasedCount === 1,
            `body one-short prelease failed: ${JSON.stringify(bodyPrelease)}`);
            bodyPreleaseToken = bodyPrelease.token;
        }
        const capacityView = harness.endpoint.getActorPayloadCapacityView(2);
        assert(capacityView.valid === false
            && capacityView.shortfall === 1
            && (domain === 'registry'
                ? capacityView.registryAvailable === 1
                    && capacityView.bodyAvailable === 2
                : capacityView.registryAvailable === 2
                    && capacityView.bodyAvailable === 1),
        `${domain} one-short capacity view mismatch: ${JSON.stringify(
            capacityView
        )}`);
        const cast = await executeDirect(
            harness,
            2,
            `${domain}-one-short`,
            { expectRejected: true }
        );
        if (registryReservation) {
            assert(harness.registry.cancelReservation(registryReservation),
                'registry one-short cleanup failed');
            registryReservation = null;
        }
        if (bodyPreleaseToken) {
            const cancelled = harness.backend
                .cancelActorPayloadBodyPrelease(
                    bodyPreleaseToken,
                    'r7-body-one-short-cleanup'
                );
            assert(cancelled.accepted === true
                && cancelled.cancelledCount === 1
                && cancelled.requiresRecovery === false,
            `body one-short cleanup failed: ${JSON.stringify(cancelled)}`);
            bodyPreleaseToken = null;
        }
        const telemetry = assertClean(harness, `${domain}-one-short`);
        assert(cast.outcome.generatedCount === 0
            && cast.outcome.cooldownConsumed === false
            && recoveryRequired(harness) === false,
        `${domain} one-short mutated execution state`);
        result = Object.freeze({
            domain,
            requestedDestinationCount: 2,
            registryAvailable: capacityView.registryAvailable,
            bodyAvailable: capacityView.bodyAvailable,
            capacityReason: `${domain.toUpperCase()}_ONE_SHORT`,
            outcomeCode: cast.outcome.code,
            generatedCount: cast.outcome.generatedCount,
            cooldownConsumed: cast.outcome.cooldownConsumed,
            recoveryRequired: recoveryRequired(harness),
            telemetry
        });
    } finally {
        if (registryReservation) {
            harness.registry.cancelReservation(registryReservation);
        }
        if (bodyPreleaseToken) {
            harness.backend.cancelActorPayloadBodyPrelease(
                bodyPreleaseToken,
                'r7-body-one-short-finally'
            );
        }
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

async function settleQueuedPlacementPayload(
    harness,
    fixedTick,
    label
) {
    await openGenericBoundary(harness.device, harness.endpoint, fixedTick);
    const placementLifecycle = harness.endpoint.commitAtFixedBoundary(
        fixedTick
    );
    assert(placementLifecycle.recoveryRequired !== true
        && placementLifecycle.rejected.length === 0,
    `${label} placement pressure lifecycle failed`);
    const placementCompletedBefore = harness.backend
        .getActorActionPlacementRuntimeStatus().completedCount;
    assert(await timedFixedUpdate(
        harness,
        fixedTick,
        'placement',
        `${label}-placement-${fixedTick}`
    ), `${label} placement pressure submit failed`);
    await waitFor(
        harness.device,
        () => harness.backend.getActorActionPlacementRuntimeStatus(),
        (status) => status.inFlightCount === 0
            && status.completedCount > placementCompletedBefore,
        `${label} placement pressure completion`
    );
    const placementObservation = harness.materializer.observeCompleted(
        fixedTick + 1
    );
    assert(placementObservation.recoveryRequired !== true
        && placementObservation.committedCount === 0,
    `${label} placement pressure handoff failed`);

    await openGenericBoundary(
        harness.device,
        harness.endpoint,
        fixedTick + 1
    );
    const payloadLifecycle = harness.endpoint.commitAtFixedBoundary(
        fixedTick + 1
    );
    assert(payloadLifecycle.recoveryRequired !== true
        && payloadLifecycle.rejected.length === 0,
    `${label} payload pressure lifecycle failed`);
    const payloadCompletedBefore = harness.endpoint
        .getActorPayloadMaterializationStatus().completedQueueCount;
    assert(await timedFixedUpdate(
        harness,
        fixedTick + 1,
        'materialization',
        `${label}-materialization-${fixedTick + 1}`
    ), `${label} payload pressure submit failed`);
    await waitFor(
        harness.device,
        () => harness.endpoint.getActorPayloadMaterializationStatus(),
        (status) => status.inFlightCount === 0
            && status.completedQueueCount > payloadCompletedBefore,
        `${label} payload pressure completion`
    );
    const payloadObservation = harness.materializer.observeCompleted(
        fixedTick + 2
    );
    assert(payloadObservation.recoveryRequired !== true
        && payloadObservation.committedCount === 1,
    `${label} payload pressure settlement failed`);
    return Object.freeze({
        placementObservation,
        payloadObservation,
        outcome: harness.wordSystem.getStatusView().lastExecutionOutcome,
        nextFixedTick: fixedTick + 2
    });
}

async function runPlacementCommandPressure(device) {
    const secondary = normalizeSentenceDefinition({
        ...TOWER_SUMMON_ENEMY_X2,
        id: 'sentence.r7.actual.tower-summon-enemy-x2-secondary'
    });
    const harness = createHarness(
        device,
        16,
        loadoutFor(TOWER_SUMMON_ENEMY_X2, secondary),
        {
            actorActionPlacementCommandCapacity: 1,
            actorActionPlacementReadbackSlotCount: 1
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
            'placement-command-pressure'
        );
        const firstStage = harness.materializer.stageReadyForFixedTick({
            targetFixedTick: 3
        });
        const blockedWhileFirstStaged
            = harness.backend.canStageActorActionPlacement() === false;
        assert(firstStage.stagedCount === 1
            && firstStage.rejectedCount === 0
            && blockedWhileFirstStaged,
        `placement command pressure was not observed: ${JSON.stringify({
            firstStage,
            placement: harness.backend
                .getActorActionPlacementRuntimeStatus()
        })}`);
        const first = await settleQueuedPlacementPayload(
            harness,
            3,
            'placement-command-pressure-first'
        );
        const availableAfterFirst
            = harness.backend.canStageActorActionPlacement() === true;
        const retryStage = harness.materializer.stageReadyForFixedTick({
            targetFixedTick: first.nextFixedTick
        });
        assert(availableAfterFirst
            && retryStage.stagedCount === 1
            && retryStage.rejectedCount === 0,
        `placement command retry was not accepted: ${JSON.stringify({
            availableAfterFirst,
            retryStage
        })}`);
        const retry = await settleQueuedPlacementPayload(
            harness,
            first.nextFixedTick,
            'placement-command-pressure-retry'
        );
        const telemetry = assertClean(harness, 'placement-command-pressure');
        assert(first.outcome.generatedCount === 2
            && retry.outcome.generatedCount === 2
            && telemetry.activeEnemyCount === 4
            && telemetry.placementCommandHighWater === 1,
        `placement command retry publication mismatch: ${JSON.stringify({
            first,
            retry,
            telemetry
        })}`);
        result = Object.freeze({
            commandCapacity: 1,
            firstStagedCount: firstStage.stagedCount,
            blockedWhileFirstStaged,
            availableAfterFirst,
            retryStagedCount: retryStage.stagedCount,
            generatedCount: telemetry.activeEnemyCount,
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
        const timestampQuerySupported = adapter.features.has(
            'timestamp-query'
        );
        result.adapterTimestampQuerySupported = timestampQuerySupported;
        device = await adapter.requestDevice({
            requiredFeatures: timestampQuerySupported
                ? ['timestamp-query']
                : [],
            requiredLimits: {
                maxStorageBuffersPerShaderStage:
                    REQUIRED_STORAGE_BUFFER_LIMIT
            }
        });
        timingRecorder = createTimingRecorder(
            device,
            timestampQuerySupported
        );
        const uncapturedErrors = [];
        device.addEventListener('uncapturederror', (event) => {
            uncapturedErrors.push(event.error?.message ?? String(event.error));
        });

        checkpoint('r7:tower-growth');
        const towerGrowth = await runTowerGrowth(device);

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
        checkpoint('r7:enemy-50-x4-then-250-x2');
        const stackedTimingAndGridPressure
            = await runStackedTimingCardinality(device);
        const copiesFour = stackedTimingAndGridPressure.casts[0];
        positives.push(Object.freeze({
            id: 'enemy-50-shoot-enemy-x4',
            subjectCount: copiesFour.subjectCount,
            copiesPerSubject: copiesFour.copiesPerSubject,
            generatedCount: copiesFour.generatedCount,
            cooldownConsumed: true,
            destinationCount: copiesFour.destinationCount,
            destinationFingerprint: copiesFour.destinationFingerprint,
            modifierSetFingerprint: copiesFour.modifierSetFingerprint,
            sourceCopyPairCount: copiesFour.sourceCopyPairCount,
            airborneHighWater: 0,
            landedCount: 0,
            siblingOverlapCount: 0,
            gridOverflowCount: 0,
            telemetry: stackedTimingAndGridPressure.telemetry,
            destroyedTeardown:
                stackedTimingAndGridPressure.destroyedTeardown
        }));
        checkpoint('r7:registry-one-short');
        const registryOneShort = await runOneShortCapacityPressure(
            device,
            'registry'
        );
        checkpoint('r7:body-one-short');
        const bodyOneShort = await runOneShortCapacityPressure(
            device,
            'body'
        );
        checkpoint('r7:placement-command-pressure');
        const placementCommandPressure
            = await runPlacementCommandPressure(device);
        checkpoint('r7:tower-creation-ring-pressure');
        const towerCreationRingPressure
            = await runTowerCreationRingPressure(device);
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
        const performance = await timingRecorder.finalize();
        timingRecorder = null;
        const transitReadbackPressure = positives.find((entry) => (
            entry.id === 'enemy-125-throw-enemy-x2'
        ))?.transitReadbackPressure ?? null;
        const pressures = Object.freeze({
            registryOneShort,
            bodyOneShort,
            placementCommand: placementCommandPressure,
            materializationResultRing: ringPressure,
            towerCreationRing: towerCreationRingPressure,
            transitReadback: transitReadbackPressure,
            sdfImpossible: closedPlacement,
            gridCellCapacity:
                stackedTimingAndGridPressure.casts[1]
        });
        assert(Object.values(pressures).every((entry) => (
            entry?.recoveryRequired === false
        )), `R7 normal pressure requested recovery: ${JSON.stringify(
            pressures
        )}`);

        result.r7ActorPayloadMultiplicity = Object.freeze({
            scenario: 'r7-actor-payload-multiplicity-actual-webgpu',
            positives: Object.freeze(positives),
            towerGrowth,
            stackedTimingAndGridPressure,
            pressures,
            negatives: Object.freeze({
                generatedBudget,
                registryOneShort,
                oneShortBody,
                bodyOneShort,
                placementCommandPressure,
                closedPlacement,
                ringPressure,
                towerCreationRingPressure,
                transitReadbackPressure,
                staleCompletion,
                gridCellCapacity:
                    stackedTimingAndGridPressure.casts[1]
            }),
            storageMaximum: Math.max(
                ...positives.map((entry) => entry.telemetry.storageMaximum),
                generatedBudget.telemetry.storageMaximum,
                oneShortBody.telemetry.storageMaximum,
                closedPlacement.telemetry.storageMaximum,
                ringPressure.telemetry.storageMaximum,
                staleCompletion.telemetry.storageMaximum,
                towerGrowth.telemetry.storageMaximum,
                stackedTimingAndGridPressure.telemetry.storageMaximum,
                registryOneShort.telemetry.storageMaximum,
                bodyOneShort.telemetry.storageMaximum,
                placementCommandPressure.telemetry.storageMaximum,
                towerCreationRingPressure.telemetry.storageMaximum
            ),
            performance,
            uncapturedErrorCount: uncapturedErrors.length,
            destroyedTeardown: positives.every((entry) => (
                entry.destroyedTeardown === true
            )) && [
                generatedBudget,
                oneShortBody,
                closedPlacement,
                ringPressure,
                staleCompletion,
                towerGrowth,
                stackedTimingAndGridPressure,
                registryOneShort,
                bodyOneShort,
                placementCommandPressure,
                towerCreationRingPressure
            ].every((entry) => entry.destroyedTeardown === true)
        });
        result.performance = performance;
        result.uncapturedErrorCount = uncapturedErrors.length;
        assert(uncapturedErrors.length === 0,
            `uncaptured WebGPU errors: ${JSON.stringify(uncapturedErrors)}`);
        assert(result.r7ActorPayloadMultiplicity.storageMaximum <= 9,
            'R7 storage maximum exceeded 9');
        assert(result.r7ActorPayloadMultiplicity.destroyedTeardown === true,
            'R7 teardown did not destroy every harness');
        assert(JSON.stringify(towerGrowth.towerCounts)
                === JSON.stringify([1, 3, 9, 27, 81, 243])
            && towerGrowth.capReject.generatedCount === 0
            && towerGrowth.capReject.cooldownConsumed === false
            && towerGrowth.capReject.mutationCount === 0,
        `R7 Tower growth evidence mismatch: ${JSON.stringify(towerGrowth)}`);
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
