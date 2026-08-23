import {
    BASIC_CIRCLE_ENEMY_DATA
} from './production/script/data/object/enemy/basic_circle_enemy_data.js';
import {
    R3_ENEMY_WORD_INSTANCE,
    R3_TOWER_WORD_INSTANCE,
    R5_EMIT_WORD_INSTANCE,
    R5_SHOWCASE_SENTENCE_LOADOUT,
    R5_SUMMON_WORD_INSTANCE,
    R5_THROW_WORD_INSTANCE
} from './production/script/data/word/r3_word_catalog_data.js';
import {
    R5_THROW_ACTOR_ACTION_PROFILE
} from './production/script/data/word/r5_actor_action_profile_data.js';
import {
    ABILITY_SLOT_ID,
    normalizeSentenceDefinition
} from './production/script/module/ingame/contract/word_sentence_contract.js';
import {
    createGpuSimulationEndpoint
} from './production/script/module/ingame/gpu_simulation_endpoint.js';
import {
    createGpuEnemySpawnIntent
} from './production/script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js';
import {
    createGpuTowerSpawnIntent
} from './production/script/module/ingame/object/tower/gpu_tower_spawn_adapter.js';
import {
    TowerCreationCoordinator
} from './production/script/module/ingame/object/tower/tower_creation_coordinator.js';
import {
    PRIMARY_TOWER_LOGICAL_ID,
    TOWER_CREATION_RESULT,
    TowerGroupState
} from './production/script/module/ingame/object/tower/tower_group_state.js';
import {
    TOWER_RECOVERY_PLACEMENT_POLICY_ID
} from './production/script/module/ingame/object/tower/tower_group_contract.js';
import {
    GPU_TOWER_GROUP_ABI
} from './production/script/module/ingame/physics/gpu/gpu_tower_group_abi.js';
import {
    ActorPayloadMaterializer
} from './production/script/module/ingame/word/actor_payload_materializer.js';
import {
    AbilityRuntime
} from './production/script/module/ingame/word/ability_runtime.js';
import {
    SentenceRuntimeEstimator
} from './production/script/module/ingame/word/sentence_runtime_estimator.js';
import {
    ABILITY_ACTIVATION_RESULT_CODE,
    ABILITY_EXECUTION_OUTCOME_CODE,
    WordSystem
} from './production/script/module/ingame/word/word_system.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const FIXED_DELTA = 1 / 60;
const REQUIRED_STORAGE_BUFFER_LIMIT = 9;
const TIMESTAMP_SAMPLE_CAPACITY = 512;
let timingRecorder = null;

function createInjectedActorSentence({ id, subject, verb, payload }) {
    return normalizeSentenceDefinition({
        id,
        subjectWordInstanceId: subject.id,
        verbWordInstanceId: verb.id,
        payloadWordInstanceId: payload.id,
        modifierWordInstanceIds: []
    });
}

const INJECTED_IMMEDIATE_ACTOR_CASES = Object.freeze([
    Object.freeze({
        id: 'tower-emit-enemy',
        action: 'Emit',
        subjectKind: 'tower',
        payloadKind: 'enemy',
        sentence: createInjectedActorSentence({
            id: 'sentence.r5.fixture.tower-emits-enemy',
            subject: R3_TOWER_WORD_INSTANCE,
            verb: R5_EMIT_WORD_INSTANCE,
            payload: R3_ENEMY_WORD_INSTANCE
        })
    }),
    Object.freeze({
        id: 'enemy-emit-tower',
        action: 'Emit',
        subjectKind: 'enemy',
        payloadKind: 'tower',
        sentence: createInjectedActorSentence({
            id: 'sentence.r5.fixture.enemies-emit-tower',
            subject: R3_ENEMY_WORD_INSTANCE,
            verb: R5_EMIT_WORD_INSTANCE,
            payload: R3_TOWER_WORD_INSTANCE
        })
    }),
    Object.freeze({
        id: 'tower-summon-tower',
        action: 'Summon',
        subjectKind: 'tower',
        payloadKind: 'tower',
        sentence: createInjectedActorSentence({
            id: 'sentence.r5.fixture.tower-summons-tower',
            subject: R3_TOWER_WORD_INSTANCE,
            verb: R5_SUMMON_WORD_INSTANCE,
            payload: R3_TOWER_WORD_INSTANCE
        })
    }),
    Object.freeze({
        id: 'enemy-summon-enemy',
        action: 'Summon',
        subjectKind: 'enemy',
        payloadKind: 'enemy',
        sentence: createInjectedActorSentence({
            id: 'sentence.r5.fixture.enemies-summon-enemy',
            subject: R3_ENEMY_WORD_INSTANCE,
            verb: R5_SUMMON_WORD_INSTANCE,
            payload: R3_ENEMY_WORD_INSTANCE
        })
    })
]);

const INJECTED_THROW_ENEMY_SENTENCE = createInjectedActorSentence({
    id: 'sentence.r5.fixture.enemies-throw-enemies',
    subject: R3_ENEMY_WORD_INSTANCE,
    verb: R5_THROW_WORD_INSTANCE,
    payload: R3_ENEMY_WORD_INSTANCE
});

const INJECTED_THROW_TOWER_SENTENCE = createInjectedActorSentence({
    id: 'sentence.r5.fixture.tower-throws-tower',
    subject: R3_TOWER_WORD_INSTANCE,
    verb: R5_THROW_WORD_INSTANCE,
    payload: R3_TOWER_WORD_INSTANCE
});

const INJECTED_SUMMON_ENEMY_SENTENCE = createInjectedActorSentence({
    id: 'sentence.r5.fixture.enemies-summon-enemies-stress',
    subject: R3_ENEMY_WORD_INSTANCE,
    verb: R5_SUMMON_WORD_INSTANCE,
    payload: R3_ENEMY_WORD_INSTANCE
});

const INJECTED_EMIT_ENEMY_SENTENCE = createInjectedActorSentence({
    id: 'sentence.r5.fixture.tower-emits-enemies-churn',
    subject: R3_TOWER_WORD_INSTANCE,
    verb: R5_EMIT_WORD_INSTANCE,
    payload: R3_ENEMY_WORD_INSTANCE
});

const INJECTED_SUMMON_TOWER_ENEMY_SENTENCE = createInjectedActorSentence({
    id: 'sentence.r5.fixture.tower-summons-enemies-churn',
    subject: R3_TOWER_WORD_INSTANCE,
    verb: R5_SUMMON_WORD_INSTANCE,
    payload: R3_ENEMY_WORD_INSTANCE
});

const MIXED_ACTOR_CHURN_LOADOUT = Object.freeze({
    [ABILITY_SLOT_ID.SHIFT]: R5_SHOWCASE_SENTENCE_LOADOUT[
        ABILITY_SLOT_ID.SHIFT
    ],
    [ABILITY_SLOT_ID.SPACE]: INJECTED_THROW_ENEMY_SENTENCE,
    [ABILITY_SLOT_ID.Q]: INJECTED_EMIT_ENEMY_SENTENCE,
    [ABILITY_SLOT_ID.E]: INJECTED_SUMMON_TOWER_ENEMY_SENTENCE
});

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function checkpoint(stage, detail = null) {
    if (!resultPath) return;
    require('node:fs').writeFileSync(
        resultPath,
        `${JSON.stringify({ status: 'running', stage, detail }, null, 2)}\n`,
        'utf8'
    );
}

function percentile(values, quantile) {
    assert(Array.isArray(values) && values.length > 0,
        'percentile sample이 비어 있습니다.');
    const sorted = [...values].sort((left, right) => left - right);
    const rank = Math.max(
        0,
        Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)
    );
    return sorted[rank];
}

function createTimingRecorder(device, timestampSupported) {
    const samples = [];
    const querySet = timestampSupported
        ? device.createQuerySet({
            label: 'r5-final-acceptance-timestamps',
            type: 'timestamp',
            count: TIMESTAMP_SAMPLE_CAPACITY * 2
        })
        : null;
    let finalized = false;
    return Object.freeze({
        async submit(category, label, callback) {
            assert(!finalized, 'timing recorder가 이미 finalize됐습니다.');
            assert(samples.length < TIMESTAMP_SAMPLE_CAPACITY,
                'timing sample capacity를 초과했습니다.');
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
            const result = callback();
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
            return result;
        },
        async finalize() {
            assert(!finalized, 'timing recorder finalize가 중복됐습니다.');
            finalized = true;
            if (querySet && samples.length > 0) {
                const byteLength = samples.length * 2
                    * BigUint64Array.BYTES_PER_ELEMENT;
                const resolveBuffer = device.createBuffer({
                    label: 'r5-final-acceptance-timestamp-resolve',
                    size: byteLength,
                    usage: GPUBufferUsage.QUERY_RESOLVE
                        | GPUBufferUsage.COPY_SRC
                });
                const readback = device.createBuffer({
                    label: 'r5-final-acceptance-timestamp-readback',
                    size: byteLength,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                });
                try {
                    const encoder = device.createCommandEncoder({
                        label: 'r5-final-acceptance-timestamp-copy'
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
            const categories = Object.freeze(['action', 'placement', 'transit']);
            const gpu = {};
            for (const category of categories) {
                gpu[category] = summarize(samples
                    .filter((sample) => sample.category === category
                        && Number.isFinite(sample.gpuElapsedMs))
                    .map((sample) => sample.gpuElapsedMs));
            }
            return Object.freeze({
                scope: 'timestamp markers around serialized fixed-boundary GPU submissions',
                timestampQuerySupported: Boolean(querySet),
                gpu: Object.freeze(gpu),
                fullFixedBoundaryElapsedMs: summarize(samples.map((sample) => (
                    sample.fullBoundaryElapsedMs
                )))
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

function createPlatformPort(device, deviceGeneration = 1) {
    return Object.freeze({
        getState: () => Object.freeze({
            ready: true,
            status: 'ready',
            deviceGeneration
        }),
        getDevice: () => device,
        getCanvasFormat: () => navigator.gpu.getPreferredCanvasFormat(),
        getDeviceGeneration: () => deviceGeneration,
        acquireFrameTarget: () => null,
        clearCanvas: () => true,
        markCanvasDrawn() {},
        markCanvasCleared() {}
    });
}

function createNavigationSource() {
    const columns = 128;
    const rows = 128;
    const corePosition = Object.freeze({
        x: 120,
        y: 64,
        row: 64,
        column: 120
    });
    const entryPosition = Object.freeze({
        x: 8,
        y: 64,
        row: 64,
        column: 8
    });
    const route = Object.freeze({
        gateId: 'r5-actor-verbs-gate',
        pathId: 'r5-actor-verbs-route',
        waypoints: Object.freeze([entryPosition, corePosition])
    });
    return Object.freeze({
        route,
        towerPosition: Object.freeze({ x: 64, y: 64 }),
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
    checkpoint(`waiting:${label}`, readStatus());
    for (let attempt = 0; attempt < 600; attempt++) {
        await device.queue.onSubmittedWorkDone();
        await new Promise((resolve) => setTimeout(resolve, 10));
        const status = readStatus();
        if (predicate(status)) {
            checkpoint(`completed:${label}`, status);
            return status;
        }
        if (status?.requiresRecovery === true || status?.failure) {
            throw new Error(`${label} recovery: ${JSON.stringify(status)}`);
        }
    }
    throw new Error(`${label} timeout: ${JSON.stringify(readStatus())}`);
}

async function readTowerRosterDiagnostic(harness) {
    const runtime = harness.backend.towerGroupRuntime;
    const roster = runtime.getCreationResources().roster;
    const header = GPU_TOWER_GROUP_ABI.ROSTER_HEADER;
    const view = new DataView(runtime.host.roster);
    return Object.freeze({
        abiVersion: view.getUint32(header.ABI_VERSION, true),
        memberCount: view.getUint32(header.MEMBER_COUNT, true),
        capacity: view.getUint32(header.CAPACITY, true),
        fingerprint: view.getUint32(header.FINGERPRINT, true),
        groupRevision: view.getUint32(header.GROUP_REVISION, true),
        sessionGeneration: view.getUint32(header.SESSION_GENERATION, true),
        deviceGeneration: view.getUint32(header.DEVICE_GENERATION, true),
        authoritativeEpoch:
            view.getUint32(header.AUTHORITATIVE_EPOCH, true),
        byteSize: roster.size,
        slotArrayLength: (roster.size - header.STRIDE)
            / GPU_TOWER_GROUP_ABI.ROSTER_SLOT.STRIDE,
        actorAction: harness.backend.getActorActionPlacementRuntimeStatus(),
        towerGroup: harness.backend.getTowerGroupRuntimeStatus()
    });
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
    for (const method of orderedDomains) {
        let completed = null;
        for (let attempt = 0; attempt < 180; attempt++) {
            completed = endpoint[method](fixedTick);
            if (completed.pending !== true) break;
            await device.queue.onSubmittedWorkDone();
            await nextTask();
        }
        assert(completed?.pending !== true,
            `${method} boundary ${fixedTick} timeout`);
        assert(!completed?.protocolFailure,
            `${method} protocol failure: ${JSON.stringify(completed)}`);
    }
}

function createHarness(
    device,
    capacity,
    loadout = R5_SHOWCASE_SENTENCE_LOADOUT,
    options = {}
) {
    const navigationSource = options.navigationSource
        ?? createNavigationSource();
    let coreCleanupBinding = null;
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPlatformPort(
            device,
            options.deviceGeneration ?? 1
        ),
        coreImpactCleanupPortReceiver(binding) {
            coreCleanupBinding = binding;
        }
    }, {
        capacity,
        abilitySubjectCommandCapacity: 4,
        abilitySubjectCapacity: 1_000,
        abilitySubjectReadbackSlotCount: 3,
        actorPayloadCommandCapacity:
            options.actorPayloadCommandCapacity,
        actorPayloadReadbackSlotCount:
            options.actorPayloadReadbackSlotCount,
        actorActionPlacementCommandCapacity:
            options.actorActionPlacementCommandCapacity ?? 4,
        actorActionPlacementSubjectCapacity: 256,
        actorActionPlacementDestinationCapacity:
            options.actorActionPlacementDestinationCapacity ?? 1_000,
        actorActionPlacementReadbackSlotCount:
            options.actorActionPlacementReadbackSlotCount ?? 3,
        actorTransitReadbackSlotCount:
            options.actorTransitReadbackSlotCount,
        towerGroupMemberCapacity: Math.min(capacity, 256),
        towerGroupReadbackSlotCount: 3,
        towerCreationReadbackSlotCount:
            options.towerCreationReadbackSlotCount ?? 3
    });
    endpoint.init(navigationSource);
    assert(coreCleanupBinding !== null, 'Core cleanup binding missing');
    const backend = endpoint.getBackend();
    const registry = endpoint.getRegistry();
    const towerGroupState = options.towerGroupState ?? new TowerGroupState();
    const snapshotPort = Object.freeze({
        getSnapshotGpuBinding: (token) => (
            backend.getAbilitySubjectSnapshotGpuBinding(token)
        ),
        releaseSnapshot: (token) => (
            backend.releaseAbilitySubjectSnapshot(token)
        )
    });
    const placementPort = Object.freeze({
        canAccept: () => backend.canStageActorActionPlacement(),
        stage: (request) => backend.stageActorActionPlacement({
            ...request,
            completionOwner: 'tower-creation'
        }),
        submitPendingForFixedTick: (tick) => (
            backend.submitActorActionPlacements(tick)
        ),
        drainCompleted: (out) => (
            backend.drainCompletedActorActionPlacements(
                out,
                'tower-creation'
            )
        ),
        getPlacementGpuBinding: (token) => (
            backend.getActorActionPlacementGpuBinding(token)
        ),
        releasePlacement: (token) => (
            backend.releaseActorActionPlacement(token)
        ),
        cancelAll: (reason) => (
            backend.cancelAllActorActionPlacements(reason)
        )
    });
    const coordinator = new TowerCreationCoordinator({
        towerGroupState,
        registry,
        backend,
        abilitySubjectSnapshotRuntime: snapshotPort,
        actorActionPlacementRuntime: placementPort
    });
    const wordSystem = options.wordSystem ?? new WordSystem({ loadout });
    const estimator = new SentenceRuntimeEstimator({
        getRuntimeState: () => {
            const capacityView = endpoint.getActorPayloadCapacityView(0);
            return Object.freeze({
                livingTowerCount:
                    towerGroupState.getStatus().livingTowerCount,
                towerSubjectCountExact: true,
                liveHostileActorCount: registry.getActiveCount('enemy'),
                hostileSubjectCountExact: true,
                pendingHostileActorCount: 0,
                registryAvailable: capacityView.registryAvailable,
                bodyAvailable: capacityView.bodyAvailable,
                bountyPerEnemy: 0,
                siegeWeightPerEnemy: 0,
                siegeWeight: 0,
                dangerThreshold: 32
            });
        },
        previewTowerCreation: (request) => (
            backend.supportsGpuSubjectActorActionTowerCreation()
                ? coordinator.previewTowerCreation(request)
                : Object.freeze({
                    executionEnabled: false,
                    reason: 'RUNTIME_UNAVAILABLE',
                    recoveryRequired: false
                })
        )
    });
    wordSystem.bindRuntimePreviewProvider(estimator);
    const abilityRuntime = new AbilityRuntime({ wordSystem, endpoint });
    const materializer = new ActorPayloadMaterializer({
        abilityRuntime,
        endpoint,
        towerCreationCoordinatorProvider: () => coordinator,
        towerPayloadContextProvider: () => Object.freeze({
            runtimeAvailable:
                backend.supportsGpuSubjectActorActionTowerCreation(),
            sdf: backend.getActorActionPlacementSdfDescriptor(),
            coreTarget: null,
            recoveryPlacementPolicy: Object.freeze({
                policyId: TOWER_RECOVERY_PLACEMENT_POLICY_ID
                    .MAP_ANCHOR_LATTICE_V1,
                mapRecoveryAnchorId: 'map:r5-actor-verbs:tower-spawn',
                mapLatticeVersion: 1,
                anchorPosition: navigationSource.towerPosition
            })
        })
    });
    return {
        device,
        endpoint,
        backend,
        registry,
        navigationSource,
        towerGroupState,
        coordinator,
        wordSystem,
        estimator,
        abilityRuntime,
        materializer,
        nextCommandSequence: 1
    };
}

function requestSpawn(harness, intent, fixedTick, label) {
    const commandId = [
        'r5-actor-verbs',
        label,
        harness.nextCommandSequence++
    ].join(':');
    const receipt = harness.endpoint.requestSpawn(
        intent,
        fixedTick,
        commandId
    );
    assert(receipt.accepted === true,
        `${label} spawn request failed: ${JSON.stringify(receipt)}`);
    return commandId;
}

function createEnemyIntent(harness, index) {
    const column = index % 32;
    const row = Math.floor(index / 32);
    return createGpuEnemySpawnIntent({
        definition: BASIC_CIRCLE_ENEMY_DATA,
        route: harness.navigationSource.route,
        spawnSequence: index,
        laneOffsetTiles: 0,
        initialWorldOffsetTiles: Object.freeze({
            x: 4 + column * 1.5,
            y: -20 + row * 1.5
        }),
        waveId: 'r5-actor-verbs-fixture',
        policyId: 'r5-actor-verbs-natural'
    });
}

function requestEnemyBatch(harness, count, fixedTick, label) {
    const commandIds = [];
    const requests = Array.from({ length: count }, (_, index) => {
        const commandId = [
            'r5-actor-verbs',
            label,
            harness.nextCommandSequence++
        ].join(':');
        commandIds.push(commandId);
        return Object.freeze({
            intent: createEnemyIntent(harness, index),
            targetFixedTick: fixedTick,
            commandId
        });
    });
    const receipt = harness.endpoint.requestSpawnBatch(requests);
    assert(receipt.accepted === true && receipt.queuedCount === count,
        `${label} spawn batch failed: ${JSON.stringify(receipt)}`);
    return Object.freeze(commandIds);
}

async function initializePrimaryTower(harness, fixedTick = 1) {
    const record = harness.towerGroupState.getPrimaryTowerRecord();
    const commandId = requestSpawn(
        harness,
        createGpuTowerSpawnIntent({
            position: harness.navigationSource.towerPosition,
            currentHpFixedPoint: record.currentHpFixedPoint,
            logicalTowerOrdinal: record.logicalTowerOrdinal,
            shareUnits: record.shareUnits,
            maxHpFixedPoint: record.maxHpFixedPoint,
            powerFixedPoint: record.powerFixedPoint,
            towerGroupRevision:
                harness.towerGroupState.getStatus().groupRevision
        }),
        fixedTick,
        'primary-tower'
    );
    await openGenericBoundary(harness.device, harness.endpoint, fixedTick);
    const commit = harness.endpoint.commitAtFixedBoundary(fixedTick);
    assert(commit.recoveryRequired !== true && commit.rejected.length === 0,
        `primary Tower lifecycle commit failed: ${JSON.stringify(commit)}`);
    const handle = commit.spawned.find((entry) => (
        entry.commandId === commandId
    ))?.handle;
    assert(handle, 'primary Tower handle missing');
    harness.towerGroupState.bindGpuBody(
        PRIMARY_TOWER_LOGICAL_ID,
        handle,
        harness.backend.getEventProtocolState()
    );
    assert(await timedFixedUpdate(
        harness,
        fixedTick,
        'action',
        `primary-tower-${fixedTick}`
    ),
        'primary Tower fixed submit failed');
    const roster = harness.backend.synchronizeTowerGroupRoster({
        groupRevision: harness.towerGroupState.getStatus().groupRevision,
        records: harness.towerGroupState.getTowerRecords()
    });
    assert(roster.accepted === true,
        `primary Tower roster sync failed: ${JSON.stringify(roster)}`);
    await harness.device.queue.onSubmittedWorkDone();
    return handle;
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
        assert(position,
            `${record.logicalTowerId} recovery position missing`);
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
            commandId: `r5-recovery:${record.logicalTowerOrdinal}`
        });
    });
    const request = harness.endpoint.requestSpawnBatch(requests);
    assert(request.accepted === true
        && request.queuedCount === records.length,
    `recovery Tower batch failed: ${JSON.stringify(request)}`);
    await openGenericBoundary(harness.device, harness.endpoint, fixedTick);
    const lifecycle = harness.endpoint.commitAtFixedBoundary(fixedTick);
    assert(lifecycle.recoveryRequired !== true
        && lifecycle.rejected.length === 0
        && lifecycle.spawned.length === records.length,
    `recovery Tower lifecycle failed: ${JSON.stringify(lifecycle)}`);
    const handles = new Map();
    const intents = new Map();
    for (const record of records) {
        const commandId = `r5-recovery:${record.logicalTowerOrdinal}`;
        const intent = requests.find((entry) => (
            entry.commandId === commandId
        ))?.intent;
        const handle = lifecycle.spawned.find((entry) => (
            entry.commandId === commandId
        ))?.handle;
        assert(handle && intent, `${commandId} handle/intent missing`);
        harness.towerGroupState.bindGpuBody(
            record.logicalTowerId,
            handle,
            harness.backend.getEventProtocolState()
        );
        handles.set(record.logicalTowerId, handle);
        intents.set(record.logicalTowerId, intent);
    }
    assert(await timedFixedUpdate(
        harness,
        fixedTick,
        'action',
        `recovery-towers-${fixedTick}`
    ), 'recovery Tower fixed submit failed');
    const roster = harness.backend.synchronizeTowerGroupRoster({
        groupRevision,
        records: harness.towerGroupState.getTowerRecords()
    });
    assert(roster.accepted === true,
        `recovery Tower roster sync failed: ${JSON.stringify(roster)}`);
    await harness.device.queue.onSubmittedWorkDone();
    return Object.freeze({
        records: Object.freeze(records),
        handles,
        intents
    });
}

function sameHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

function storageMaximum(harness) {
    const endpointStatus = harness.endpoint.getStatus();
    const actor = harness.backend.getActorActionPlacementRuntimeStatus();
    const creation = harness.backend.getTowerCreationRuntimeStatus();
    const group = harness.backend.getTowerGroupRuntimeStatus();
    return Math.max(
        endpointStatus.abilitySubjectSnapshots?.storageBindingCount ?? 0,
        actor.storageBindingCount ?? 0,
        creation.storageProfile?.maximumStorageBuffersPerStage ?? 0,
        group.storageProfile?.maximumStorageBuffersPerStage ?? 0
    );
}

function recoveryRequired(harness) {
    return harness.endpoint.requiresRecovery()
        || harness.abilityRuntime.requiresRecovery()
        || harness.materializer.requiresRecovery()
        || harness.coordinator.requiresRecovery();
}

function captureRuntimeTelemetry(harness) {
    const endpoint = harness.endpoint.getStatus();
    const gpu = endpoint.backend?.gpu ?? endpoint.backend ?? null;
    const materializer = harness.materializer.getStatus();
    const placement = harness.backend.getActorActionPlacementRuntimeStatus();
    const transit = endpoint.actorPayloadMaterializations?.transit ?? null;
    const coordinator = harness.coordinator.getStatus();
    return Object.freeze({
        activeBodyCount: endpoint.activeCount,
        activeTowerCount: harness.registry.getActiveCount('tower'),
        activeEnemyCount: harness.registry.getActiveCount('enemy'),
        reservedRegistryCount: endpoint.reservedCount,
        pendingCommandCount: endpoint.pendingCommandCount,
        bodyCountHighWater: gpu?.bodyCountHighWater ?? 0,
        activeBodyCountHighWater:
            gpu?.activeBodyCountHighWater ?? 0,
        gridOverflowCount:
            (gpu?.overflow?.totalSmallCount ?? 0)
            + (gpu?.overflow?.totalBigCount ?? 0),
        towerRecordHighWater:
            harness.towerGroupState.getStatus().totalTowerRecordCount,
        placementCommandHighWater: placement.commandHighWater ?? 0,
        placementSubjectHighWater: placement.subjectHighWater ?? 0,
        placementDestinationHighWater: placement.destinationHighWater ?? 0,
        retainedPlacementHighWater:
            placement.retainedPlacementHighWater ?? 0,
        transitActorHighWater: transit?.activeActorHighWater ?? 0,
        materializerSubjectHighWater:
            materializer.telemetry.subjectHighWater,
        materializerGeneratedHighWater:
            materializer.telemetry.generatedHighWater,
        readbackBytes: Object.freeze({
            abilitySubjectAggregate:
                endpoint.abilitySubjectSnapshots?.aggregateReadbackByteSize
                    ?? 0,
            ...materializer.telemetry.readbackBytes,
            towerMetadataCommitRecord:
                coordinator.metadataCommitRecordByteSize ?? 0,
            towerMetadataCommitMaximum:
                coordinator.metadataCommitReadbackBytesMax ?? 0
        }),
        perSubjectCpuSpawnCommandCount:
            endpoint.actorPayloadMaterializations
                ?.perSubjectCpuCommandCount ?? 0,
        fullPlacementRecordReadbackCount:
            placement.placementRecordCpuReadback ? 1 : 0,
        fullTransitRecordReadbackCount:
            transit?.fullRecordReadbackCount ?? 0,
        perActorCpuAdvanceCount: transit?.perActorCpuAdvanceCount ?? 0,
        perVerbCounts: materializer.telemetry.perVerbCounts,
        placementFailure: placement.failure,
        transitFailure: transit?.failure ?? null,
        towerProtocolFailureCount: coordinator.protocolFailureCount,
        recoveryRequired: recoveryRequired(harness),
        storageMaximum: storageMaximum(harness),
        storageProfile: Object.freeze({
            abilitySubject:
                endpoint.abilitySubjectSnapshots?.storageBindingCount ?? 0,
            actorPlacement: placement.storageBindingCount ?? 0,
            actorTransit: transit?.storageBindingCount ?? 0,
            towerCreation:
                coordinator.storageProfile?.maximumStorageBuffersPerStage
                    ?? 0
        })
    });
}

async function advanceTransitAtFixedTick(harness, fixedTick, label) {
    await openGenericBoundary(harness.device, harness.endpoint, fixedTick);
    const lifecycle = harness.endpoint.commitAtFixedBoundary(fixedTick);
    assert(lifecycle.recoveryRequired !== true
        && lifecycle.rejected.length === 0,
    `${label} lifecycle failed: ${JSON.stringify(lifecycle)}`);
    const submitted = await timedFixedUpdate(
        harness,
        fixedTick,
        'transit',
        `${label}-${fixedTick}`
    );
    assert(submitted, `${label} fixed submit ${fixedTick} failed: ${JSON.stringify({
        endpoint: harness.endpoint.getStatus(),
        materializer: harness.materializer.getStatus(),
        coordinator: harness.coordinator.getStatus()
    })}`);
    await waitFor(
        harness.device,
        () => harness.endpoint.getActorPayloadMaterializationStatus().transit,
        (status) => status.pendingReadbackCount === 0
            && status.latestAggregate?.sourceTick >= fixedTick,
        `${label} ${fixedTick}`
    );
    return harness.materializer.observeCompleted(fixedTick + 1);
}

async function advanceWorldAtFixedTick(harness, fixedTick, label) {
    await openGenericBoundary(harness.device, harness.endpoint, fixedTick);
    const lifecycle = harness.endpoint.commitAtFixedBoundary(fixedTick);
    assert(lifecycle.recoveryRequired !== true
        && lifecycle.rejected.length === 0,
    `${label} lifecycle failed: ${JSON.stringify(lifecycle)}`);
    assert(await timedFixedUpdate(
        harness,
        fixedTick,
        'action',
        `${label}-${fixedTick}`
    ), `${label} fixed submit ${fixedTick} failed`);
    const observation = harness.materializer.observeCompleted(fixedTick + 1);
    assert(observation.recoveryRequired !== true,
        `${label} materializer observation failed`);
    return observation;
}

async function advanceTransitThroughFixedTick(
    harness,
    firstFixedTick,
    lastFixedTick,
    label
) {
    const committedHandles = [];
    let lastObservation = null;
    for (let fixedTick = firstFixedTick;
        fixedTick <= lastFixedTick;
        fixedTick++) {
        lastObservation = await advanceTransitAtFixedTick(
            harness,
            fixedTick,
            label
        );
        committedHandles.push(...lastObservation.committedHandles);
    }
    return Object.freeze({
        ...lastObservation,
        committedHandles: Object.freeze(committedHandles)
    });
}

function towerTotals(towerGroupState) {
    const living = towerGroupState.getTowerRecords().filter((record) => (
        record.alive
    ));
    return Object.freeze({
        currentHpFixedPoint: living.reduce(
            (sum, record) => sum + record.currentHpFixedPoint,
            0
        ),
        powerFixedPoint: living.reduce(
            (sum, record) => sum + record.powerFixedPoint,
            0
        )
    });
}

function drainExactTowerTerminalReceipt(harness, expected, label) {
    const receipts = harness.coordinator.drainActorPayloadTerminalReceipts([]);
    assert(receipts.length === 1 && receipts[0] === expected,
        `${label} terminal receipt exact-once drain 실패: ${JSON.stringify({
            receipts,
            expected
        })}`);
    return receipts[0];
}

async function executeShoot(harness, slotId, fixedTick, options = {}) {
    const { device, endpoint, backend } = harness;
    await openGenericBoundary(device, endpoint, fixedTick);
    harness.wordSystem.beginFixedTick(fixedTick);
    const activation = harness.wordSystem.requestSlotActivation(slotId, {
        targetFixedTick: fixedTick,
        aimViewport: options.aimPoint ?? Object.freeze({ x: 80, y: 64 })
    });
    assert(activation.code === ABILITY_ACTIVATION_RESULT_CODE.REQUESTED,
        `Shoot activation failed: ${JSON.stringify(activation)}`);
    const abilityStage = harness.abilityRuntime.stageForFixedTick({
        targetFixedTick: fixedTick
    });
    assert(abilityStage.acceptedCount === 1,
        `Shoot ability stage failed: ${JSON.stringify({
            abilityStage,
            abilityRuntime: harness.abilityRuntime.getStatus(),
            abilityGpu: endpoint.getAbilitySubjectSnapshotStatus(),
            endpoint: endpoint.getStatus(),
            word: harness.wordSystem.getStatusView()
        })}`);
    const lifecycle = endpoint.commitAtFixedBoundary(fixedTick);
    assert(lifecycle.recoveryRequired !== true
        && lifecycle.rejected.length === 0,
    `Shoot lifecycle commit failed: ${JSON.stringify(lifecycle)}`);
    assert(await timedFixedUpdate(
        harness,
        fixedTick,
        'action',
        `ability-snapshot-${fixedTick}`
    ),
        `Shoot snapshot fixed submit ${fixedTick} failed`);
    await waitFor(
        device,
        () => endpoint.getAbilitySubjectSnapshotStatus(),
        (status) => status.pendingReadbackCount === 0
            && status.completedQueueCount > 0,
        `Shoot snapshot ${fixedTick}`
    );
    const abilityObservation = harness.abilityRuntime
        .observeCompletedSubjectSnapshots(fixedTick + 1);
    assert(abilityObservation.recoveryRequired !== true,
        `Shoot snapshot observe failed: ${JSON.stringify(abilityObservation)}`);
    options.afterSnapshot?.({ harness, lifecycle, abilityObservation });
    const payloadStage = harness.materializer.stageReadyForFixedTick({
        targetFixedTick: fixedTick + 1
    });
    assert(payloadStage.recoveryRequired !== true,
        `Tower payload queue failed: ${JSON.stringify(payloadStage)}`);
    assert(payloadStage.stagedCount === 1,
        `Tower payload was not queued: ${JSON.stringify(payloadStage)}`);
    const towerRequest = harness.coordinator.queued;
    assert(towerRequest, 'Tower coordinator normalized request missing');

    await openGenericBoundary(device, endpoint, fixedTick + 1);
    const placementLifecycle = endpoint.commitAtFixedBoundary(fixedTick + 1);
    assert(placementLifecycle.recoveryRequired !== true,
        `placement lifecycle failed: ${JSON.stringify(placementLifecycle)}`);
    const placementCompletedBefore = backend
        .getActorActionPlacementRuntimeStatus().completedCount;
    const coordinatorStage = harness.coordinator
        .stageForFixedTick(fixedTick + 1);
    if (coordinatorStage.pending !== true) {
        const terminalReceipt = drainExactTowerTerminalReceipt(
            harness,
            coordinatorStage,
            'Tower placement stage rejection'
        );
        const rejected = harness.materializer.observeTowerCreationCompletion(
            terminalReceipt,
            fixedTick + 1
        );
        return Object.freeze({
            activation,
            lifecycle,
            abilityObservation,
            payloadStage,
            coordinatorStage,
            towerRequest,
            towerReceipt: terminalReceipt,
            materializerObservation: rejected,
            outcome: harness.wordSystem.getStatusView().lastExecutionOutcome,
            nextFixedTick: fixedTick + 2,
            storageMaximum: storageMaximum(harness)
        });
    }
    assert(coordinatorStage.phase === 'actor-action-placement',
        `placement phase missing: ${JSON.stringify(coordinatorStage)}`);
    assert(await timedFixedUpdate(
        harness,
        fixedTick + 1,
        'placement',
        `actor-placement-${fixedTick + 1}`
    ),
        `placement fixed submit ${fixedTick + 1} failed`);
    await waitFor(
        device,
        () => backend.getActorActionPlacementRuntimeStatus(),
        (status) => status.inFlightCount === 0
            && status.completedCount > placementCompletedBefore,
        `actor placement ${fixedTick + 1}`
    );

    await openGenericBoundary(device, endpoint, fixedTick + 2);
    const placementReady = harness.coordinator
        .observeCompletedAtFixedBoundary(fixedTick + 2);
    if (placementReady.pending !== true) {
        const terminalReceipt = drainExactTowerTerminalReceipt(
            harness,
            placementReady,
            'Tower placement completion rejection'
        );
        const rejected = harness.materializer.observeTowerCreationCompletion(
            terminalReceipt,
            fixedTick + 2
        );
        return Object.freeze({
            activation,
            lifecycle,
            abilityObservation,
            payloadStage,
            coordinatorStage,
            placementReady,
            towerRequest,
            towerReceipt: terminalReceipt,
            materializerObservation: rejected,
            outcome: harness.wordSystem.getStatusView().lastExecutionOutcome,
            nextFixedTick: fixedTick + 3,
            storageMaximum: storageMaximum(harness)
        });
    }
    assert(placementReady.phase === 'actor-action-placement-ready'
        && placementReady.readyForCreationStage === true
        && placementReady.terminal !== true
        && harness.coordinator
            .drainActorPayloadTerminalReceipts([]).length === 0,
    `placement-ready progress receipt mismatch: ${JSON.stringify(
        placementReady
    )}`);
    const creationStage = harness.coordinator
        .stageReadyActorActionPlacementAtFixedBoundary(fixedTick + 2);
    const creationStageDiagnostic = creationStage.pending === true
        && creationStage.phase === 'tower-creation'
        && creationStage.staged === true
        ? null
        : await readTowerRosterDiagnostic(harness);
    assert(creationStage.pending === true
        && creationStage.phase === 'tower-creation'
        && creationStage.staged === true,
    `Tower creation stage failed: ${JSON.stringify({
        creationStage,
        creationStageDiagnostic
    })}`);
    const creationLifecycle = endpoint.commitAtFixedBoundary(fixedTick + 2);
    assert(creationLifecycle.recoveryRequired !== true,
        `creation lifecycle failed: ${JSON.stringify(creationLifecycle)}`);
    assert(await timedFixedUpdate(
        harness,
        fixedTick + 2,
        'action',
        `tower-creation-${fixedTick + 2}`
    ),
        `creation fixed submit ${fixedTick + 2} failed`);
    await waitFor(
        device,
        () => backend.getTowerCreationRuntimeStatus(),
        (status) => status.pendingReadbackCount === 0
            && status.completedCount > 0,
        `Tower creation ${fixedTick + 2}`
    );
    const towerReceipt = harness.coordinator
        .observeCompletedAtFixedBoundary(fixedTick + 3);
    assert(towerReceipt.result === TOWER_CREATION_RESULT.COMMITTED,
        `Tower creation did not commit: ${JSON.stringify(towerReceipt)}`);
    const drainedTowerReceipt = drainExactTowerTerminalReceipt(
        harness,
        towerReceipt,
        'Tower creation completion'
    );
    const materializerObservation = harness.materializer
        .observeTowerCreationCompletion(drainedTowerReceipt, fixedTick + 3);
    assert(materializerObservation.committedCount === 1
        && materializerObservation.recoveryRequired !== true,
    `Tower payload settlement failed: ${JSON.stringify({
        materializerObservation,
        outcome: harness.wordSystem.getStatusView().lastExecutionOutcome
    })}`);
    return Object.freeze({
        activation,
        lifecycle,
        abilityObservation,
        payloadStage,
        coordinatorStage,
        placementReady,
        creationStage,
        towerRequest,
        towerReceipt: drainedTowerReceipt,
        materializerObservation,
        outcome: harness.wordSystem.getStatusView().lastExecutionOutcome,
        nextFixedTick: fixedTick + 4,
        storageMaximum: storageMaximum(harness)
    });
}

async function executeImmediateEnemyPayload(
    harness,
    slotId,
    fixedTick,
    options = {}
) {
    const { device, endpoint, backend } = harness;
    await openGenericBoundary(device, endpoint, fixedTick);
    harness.wordSystem.beginFixedTick(fixedTick);
    const activation = harness.wordSystem.requestSlotActivation(slotId, {
        targetFixedTick: fixedTick,
        aimViewport: options.aimPoint ?? Object.freeze({ x: 80, y: 64 })
    });
    assert(activation.code === ABILITY_ACTIVATION_RESULT_CODE.REQUESTED,
        `Immediate actor activation failed: ${JSON.stringify(activation)}`);
    const abilityStage = harness.abilityRuntime.stageForFixedTick({
        targetFixedTick: fixedTick
    });
    assert(abilityStage.acceptedCount === 1,
        `Immediate actor ability stage failed: ${JSON.stringify(abilityStage)}`);
    const lifecycle = endpoint.commitAtFixedBoundary(fixedTick);
    assert(lifecycle.recoveryRequired !== true
        && lifecycle.rejected.length === 0,
    `Immediate actor lifecycle failed: ${JSON.stringify(lifecycle)}`);
    assert(await timedFixedUpdate(
        harness,
        fixedTick,
        'action',
        `ability-snapshot-${fixedTick}`
    ),
        `Immediate actor snapshot submit ${fixedTick} failed`);
    await waitFor(
        device,
        () => endpoint.getAbilitySubjectSnapshotStatus(),
        (status) => status.pendingReadbackCount === 0
            && status.completedQueueCount > 0,
        `immediate actor snapshot ${fixedTick}`
    );
    const abilityObservation = harness.abilityRuntime
        .observeCompletedSubjectSnapshots(fixedTick + 1);
    assert(abilityObservation.recoveryRequired !== true
        && abilityObservation.readyCount === 1,
    `Immediate actor snapshot observe failed: ${JSON.stringify(
        abilityObservation
    )}`);
    const payloadStage = harness.materializer.stageReadyForFixedTick({
        targetFixedTick: fixedTick + 1
    });
    assert(payloadStage.recoveryRequired !== true
        && payloadStage.stagedCount === 1,
    `Immediate Enemy payload stage failed: ${JSON.stringify(payloadStage)}`);

    await openGenericBoundary(device, endpoint, fixedTick + 1);
    const placementLifecycle = endpoint.commitAtFixedBoundary(fixedTick + 1);
    assert(placementLifecycle.recoveryRequired !== true
        && placementLifecycle.rejected.length === 0,
    `Immediate placement lifecycle failed: ${JSON.stringify(
        placementLifecycle
    )}`);
    const placementCompletedBefore = backend
        .getActorActionPlacementRuntimeStatus().completedCount;
    assert(await timedFixedUpdate(
        harness,
        fixedTick + 1,
        'placement',
        `actor-placement-${fixedTick + 1}`
    ),
        `Immediate placement submit ${fixedTick + 1} failed`);
    await waitFor(
        device,
        () => backend.getActorActionPlacementRuntimeStatus(),
        (status) => status.inFlightCount === 0
            && status.completedCount > placementCompletedBefore,
        `immediate actor placement ${fixedTick + 1}`
    );
    const placementObservation = harness.materializer
        .observeCompleted(fixedTick + 2);
    assert(placementObservation.recoveryRequired !== true
        && placementObservation.observedCount === 0
        && placementObservation.committedCount === 0,
    `Immediate placement handoff failed: ${JSON.stringify({
        placementObservation,
        materializer: harness.materializer.getStatus()
    })}`);

    await openGenericBoundary(device, endpoint, fixedTick + 2);
    const payloadLifecycle = endpoint.commitAtFixedBoundary(fixedTick + 2);
    assert(payloadLifecycle.recoveryRequired !== true
        && payloadLifecycle.rejected.length === 0,
    `Immediate payload lifecycle failed: ${JSON.stringify(payloadLifecycle)}`);
    const payloadCompletedBefore = endpoint
        .getActorPayloadMaterializationStatus().completedQueueCount;
    assert(await timedFixedUpdate(
        harness,
        fixedTick + 2,
        'action',
        `actor-materialization-${fixedTick + 2}`
    ),
        `Immediate payload submit ${fixedTick + 2} failed`);
    await waitFor(
        device,
        () => endpoint.getActorPayloadMaterializationStatus(),
        (status) => status.inFlightCount === 0
            && status.completedQueueCount > payloadCompletedBefore,
        `immediate actor materialization ${fixedTick + 2}`
    );
    const payloadObservation = harness.materializer
        .observeCompleted(fixedTick + 3);
    assert(payloadObservation.recoveryRequired !== true
        && payloadObservation.committedCount === 1,
    `Immediate payload settlement failed: ${JSON.stringify({
        payloadObservation,
        outcome: harness.wordSystem.getStatusView().lastExecutionOutcome,
        materializer: harness.materializer.getStatus()
    })}`);
    return Object.freeze({
        activation,
        lifecycle,
        abilityObservation,
        payloadStage,
        placementObservation,
        payloadObservation,
        outcome: harness.wordSystem.getStatusView().lastExecutionOutcome,
        nextFixedTick: fixedTick + 3,
        storageMaximum: storageMaximum(harness)
    });
}

async function destroyHarness(harness, options = {}) {
    harness.materializer.destroy();
    harness.abilityRuntime.destroy();
    if (options.preserveRunDomain !== true) harness.wordSystem.destroy();
    harness.estimator.destroy();
    harness.coordinator.destroy();
    if (options.preserveRunDomain !== true) harness.towerGroupState.destroy();
    harness.endpoint.destroy();
    await harness.device.queue.onSubmittedWorkDone();
    return harness.backend.getActorActionPlacementRuntimeStatus().state
            === 'destroyed'
        && harness.registry.getStatus().destroyed === true;
}

async function runTowerRecursion(device) {
    const harness = createHarness(device, 32);
    let result = null;
    let destroyedTeardown = false;
    try {
        checkpoint('tower-recursion:initialize');
        await initializePrimaryTower(harness);
        const initialStatus = harness.towerGroupState.getStatus();
        const initialTotals = towerTotals(harness.towerGroupState);
        const first = await executeShoot(
            harness,
            ABILITY_SLOT_ID.SHIFT,
            2
        );
        const afterFirst = harness.towerGroupState.getStatus();
        const second = await executeShoot(
            harness,
            ABILITY_SLOT_ID.SHIFT,
            first.nextFixedTick
        );
        const afterSecond = harness.towerGroupState.getStatus();
        const afterSecondTotals = towerTotals(harness.towerGroupState);
        const towerCountBeforeReplay = harness.registry.getActiveCount('tower');
        const replay = harness.coordinator.requestTowerCreation(
            second.towerRequest
        );
        const towerCountAfterReplay = harness.registry.getActiveCount('tower');
        assert(initialStatus.livingTowerCount === 1
            && afterFirst.livingTowerCount === 2
            && afterSecond.livingTowerCount === 4,
        `Tower recursion count mismatch: ${JSON.stringify({
            initialStatus,
            afterFirst,
            afterSecond,
            first,
            second
        })}`);
        assert(first.outcome.subjectCount === 1
            && first.outcome.generatedCount === 1
            && second.outcome.subjectCount === 2
            && second.outcome.generatedCount === 2,
        `Tower recursion outcome mismatch: ${JSON.stringify({
            first: first.outcome,
            second: second.outcome
        })}`);
        assert(afterSecond.livingShareUnits === initialStatus.livingShareUnits
            && afterSecondTotals.currentHpFixedPoint
                === initialTotals.currentHpFixedPoint
            && afterSecondTotals.powerFixedPoint
                === initialTotals.powerFixedPoint,
        `Tower conserved totals mismatch: ${JSON.stringify({
            initialStatus,
            initialTotals,
            afterSecond,
            afterSecondTotals
        })}`);
        assert(replay.result === TOWER_CREATION_RESULT.COMMITTED
            && towerCountAfterReplay === towerCountBeforeReplay,
        `Tower replay duplicated mutation: ${JSON.stringify(replay)}`);
        result = Object.freeze({
            towerCounts: Object.freeze([1, 2, 4]),
            subjectCounts: Object.freeze([
                first.outcome.subjectCount,
                second.outcome.subjectCount
            ]),
            generatedCounts: Object.freeze([
                first.outcome.generatedCount,
                second.outcome.generatedCount
            ]),
            sameExecutionExcluded: first.outcome.subjectCount === 1
                && first.outcome.generatedCount === 1,
            replayNoDuplicate: towerCountBeforeReplay === towerCountAfterReplay,
            profileFingerprintBound:
                first.towerReceipt.actorActionProfileFingerprint
                    === first.towerRequest.actorActionProfileFingerprint
                && second.towerReceipt.actorActionProfileFingerprint
                    === second.towerRequest.actorActionProfileFingerprint,
            storageMaximum: Math.max(
                first.storageMaximum,
                second.storageMaximum
            ),
            recoveryRequired: recoveryRequired(harness)
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

async function runEnemyCount(device, subjectCount, capacity, label) {
    const harness = createHarness(device, capacity);
    let result = null;
    let destroyedTeardown = false;
    try {
        checkpoint(`${label}:initialize`);
        await initializePrimaryTower(harness);
        const beforeStatus = harness.towerGroupState.getStatus();
        const beforeTotals = towerTotals(harness.towerGroupState);
        requestEnemyBatch(harness, subjectCount, 2, label);
        const cast = await executeShoot(
            harness,
            ABILITY_SLOT_ID.SPACE,
            2
        );
        const afterStatus = harness.towerGroupState.getStatus();
        const afterTotals = towerTotals(harness.towerGroupState);
        const totalsConserved
            = afterStatus.livingShareUnits === beforeStatus.livingShareUnits
                && afterTotals.currentHpFixedPoint
                    === beforeTotals.currentHpFixedPoint
                && afterTotals.powerFixedPoint
                    === beforeTotals.powerFixedPoint;
        assert(totalsConserved,
            `${label} Tower totals were not conserved: ${JSON.stringify({
                beforeStatus,
                beforeTotals,
                afterStatus,
                afterTotals
            })}`);
        result = Object.freeze({
            subjectCount: cast.outcome.subjectCount,
            generatedCount: cast.outcome.generatedCount,
            towerCount: afterStatus.livingTowerCount,
            cooldownConsumed: cast.outcome.cooldownConsumed,
            result: cast.towerReceipt.result,
            totalsConserved,
            profileFingerprintBound:
                cast.towerReceipt.actorActionProfileFingerprint
                    === cast.towerRequest.actorActionProfileFingerprint,
            storageMaximum: cast.storageMaximum,
            recoveryRequired: recoveryRequired(harness),
            telemetry: captureRuntimeTelemetry(harness)
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

async function runZeroEnemySubjects(device) {
    const harness = createHarness(device, 16);
    let result = null;
    let destroyedTeardown = false;
    try {
        checkpoint('zero-subject:initialize');
        await initializePrimaryTower(harness);
        const preview = harness.wordSystem.getSlotView(
            ABILITY_SLOT_ID.SPACE
        ).preview;
        assert(preview.executionEnabled === false
            && preview.executionDisabledReason === 'ZERO_SUBJECT',
        `zero Subject preview mismatch: ${JSON.stringify(preview)}`);
        harness.wordSystem.beginFixedTick(2);
        const activation = harness.wordSystem.requestSlotActivation(
            ABILITY_SLOT_ID.SPACE,
            {
                targetFixedTick: 2,
                aimViewport: Object.freeze({ x: 80, y: 64 })
            }
        );
        assert(activation.code === ABILITY_ACTIVATION_RESULT_CODE.REQUESTED,
            `zero Subject activation mismatch: ${JSON.stringify(activation)}`);
        const stage = harness.abilityRuntime.stageForFixedTick({
            targetFixedTick: 2
        });
        assert(stage.acceptedCount === 1,
            `zero Subject stage mismatch: ${JSON.stringify(stage)}`);
        await openGenericBoundary(harness.device, harness.endpoint, 2);
        const lifecycle = harness.endpoint.commitAtFixedBoundary(2);
        assert(lifecycle.recoveryRequired !== true,
            `zero Subject lifecycle failed: ${JSON.stringify(lifecycle)}`);
        assert(await timedFixedUpdate(
            harness,
            2,
            'action',
            'zero-subject-snapshot-2'
        ), 'zero Subject fixed submit failed');
        await waitFor(
            harness.device,
            () => harness.endpoint.getAbilitySubjectSnapshotStatus(),
            (status) => status.pendingReadbackCount === 0
                && status.completedQueueCount > 0,
            'zero Subject snapshot'
        );
        const observation = harness.abilityRuntime
            .observeCompletedSubjectSnapshots(3);
        const payloadStage = harness.materializer.stageReadyForFixedTick({
            targetFixedTick: 3
        });
        const outcome = harness.wordSystem.getStatusView().lastExecutionOutcome;
        const cooldown = harness.wordSystem.getSlotView(
            ABILITY_SLOT_ID.SPACE
        ).cooldown;
        assert(observation.readyCount === 0
            && payloadStage.stagedCount === 0
            && outcome.code === ABILITY_EXECUTION_OUTCOME_CODE.ZERO_SUBJECT
            && outcome.subjectCount === 0
            && outcome.generatedCount === 0
            && outcome.cooldownConsumed === false
            && cooldown.nextEligibleFixedTick === 0,
        `zero Subject settlement mismatch: ${JSON.stringify({
            observation,
            payloadStage,
            outcome,
            cooldown
        })}`);
        result = Object.freeze({
            previewReason: preview.executionDisabledReason,
            executionEnabled: preview.executionEnabled,
            outcomeCode: outcome.code,
            subjectCount: outcome.subjectCount,
            generatedCount: outcome.generatedCount,
            cooldownConsumed: outcome.cooldownConsumed,
            cooldownNextEligibleFixedTick: cooldown.nextEligibleFixedTick,
            telemetry: captureRuntimeTelemetry(harness)
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

async function runRepeatedTowerCapacity(device) {
    const harness = createHarness(device, 1_400);
    let result = null;
    let destroyedTeardown = false;
    try {
        checkpoint('repeated-capacity:initialize');
        await initializePrimaryTower(harness);
        const towerCounts = [1];
        const generatedCounts = [];
        const aimPoints = Object.freeze([
            Object.freeze({ x: 112, y: 64 }),
            Object.freeze({ x: 64, y: 112 }),
            Object.freeze({ x: 16, y: 64 }),
            Object.freeze({ x: 64, y: 16 }),
            Object.freeze({ x: 112, y: 112 }),
            Object.freeze({ x: 16, y: 112 }),
            Object.freeze({ x: 16, y: 16 }),
            Object.freeze({ x: 112, y: 16 })
        ]);
        let fixedTick = 2;
        while (harness.towerGroupState.getStatus().livingTowerCount < 256) {
            const castIndex = generatedCounts.length;
            const cast = await executeShoot(
                harness,
                ABILITY_SLOT_ID.SHIFT,
                fixedTick,
                { aimPoint: aimPoints[castIndex] }
            );
            const count = harness.towerGroupState.getStatus().livingTowerCount;
            generatedCounts.push(cast.outcome.generatedCount);
            towerCounts.push(count);
            fixedTick = cast.nextFixedTick;
        }
        assert(towerCounts.join(',')
                === '1,2,4,8,16,32,64,128,256',
        `repeated Tower Shoot count mismatch: ${towerCounts.join(',')}`);

        const status = harness.towerGroupState.getStatus();
        const telemetry = captureRuntimeTelemetry(harness);
        assert(status.livingTowerCount === 256
            && telemetry.reservedRegistryCount === 0,
        `repeated Tower capacity telemetry mismatch: ${JSON.stringify({
            status,
            telemetry
        })}`);
        result = Object.freeze({
            towerCounts: Object.freeze(towerCounts),
            generatedCounts: Object.freeze(generatedCounts),
            livingTowerCount: status.livingTowerCount,
            telemetry
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

async function runHostileThousandAtFullTowerCapacity(device) {
    const harness = createHarness(device, 1_600);
    let result = null;
    let destroyedTeardown = false;
    try {
        checkpoint('hostile-1000-tower-256:initialize');
        await initializePrimaryTower(harness);
        requestEnemyBatch(harness, 255, 2, 'tower-256-distributed-sources');
        const exact = await executeShoot(
            harness,
            ABILITY_SLOT_ID.SPACE,
            2
        );
        assert(exact.outcome.generatedCount === 255
            && harness.towerGroupState.getStatus().livingTowerCount === 256,
        `distributed Tower 256 setup mismatch: ${JSON.stringify({
            outcome: exact.outcome,
            status: harness.towerGroupState.getStatus()
        })}`);

        const enemyHandles = harness.registry.copyActiveHandlesInto([], {
            kindId: 'enemy'
        });
        assert(enemyHandles.length === 255,
            `distributed source count mismatch: ${enemyHandles.length}`);
        const cleanupFixedTick = 5;
        for (let index = 0; index < enemyHandles.length; index++) {
            const receipt = harness.endpoint.requestDespawn(
                enemyHandles[index],
                'r5-final-hostile-reset',
                cleanupFixedTick,
                `r5-final-hostile-reset:${index}`
            );
            assert(receipt.accepted === true,
                `distributed source despawn ${index} failed`);
        }
        await openGenericBoundary(
            harness.device,
            harness.endpoint,
            cleanupFixedTick
        );
        const cleanup = harness.endpoint.commitAtFixedBoundary(
            cleanupFixedTick
        );
        assert(cleanup.recoveryRequired !== true
            && cleanup.rejected.length === 0,
        `distributed source cleanup failed: ${JSON.stringify(cleanup)}`);
        assert(await timedFixedUpdate(
            harness,
            cleanupFixedTick,
            'action',
            `hostile-reset-${cleanupFixedTick}`
        ), 'distributed source cleanup submit failed');
        assert(harness.registry.getActiveCount('enemy') === 0,
            'distributed source cleanup left active Enemies');

        const hostileFixedTick = cleanupFixedTick + 1;
        requestEnemyBatch(
            harness,
            1_000,
            hostileFixedTick,
            'hostile-1000-full-tower-roster'
        );
        const rejected = await executeShoot(
            harness,
            ABILITY_SLOT_ID.SPACE,
            hostileFixedTick
        );
        const status = harness.towerGroupState.getStatus();
        const telemetry = captureRuntimeTelemetry(harness);
        assert(rejected.outcome.subjectCount === 1_000
            && rejected.outcome.generatedCount === 0
            && rejected.outcome.cooldownConsumed === false
            && status.livingTowerCount === 256
            && harness.registry.getActiveCount('enemy') === 1_000
            && telemetry.reservedRegistryCount === 0,
        `Hostile 1000 + Tower 256 rejection mismatch: ${JSON.stringify({
            outcome: rejected.outcome,
            receipt: rejected.towerReceipt,
            status,
            telemetry
        })}`);
        result = Object.freeze({
            hostileSubjectCount: rejected.outcome.subjectCount,
            hostileGeneratedCount: rejected.outcome.generatedCount,
            hostileCooldownConsumed: rejected.outcome.cooldownConsumed,
            activeEnemyCount: harness.registry.getActiveCount('enemy'),
            livingTowerCount: status.livingTowerCount,
            telemetry
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

async function runEnemyActorBatchStress(device, action) {
    const throwing = action === 'Throw';
    const sentence = throwing
        ? INJECTED_THROW_ENEMY_SENTENCE
        : INJECTED_SUMMON_ENEMY_SENTENCE;
    const label = throwing ? 'throw-256' : 'summon-256';
    const harness = createHarness(device, 600, Object.freeze({
        [ABILITY_SLOT_ID.Q]: sentence
    }));
    let result = null;
    let destroyedTeardown = false;
    try {
        checkpoint(`${label}:initialize`);
        await initializePrimaryTower(harness);
        requestEnemyBatch(harness, 256, 2, `${label}-sources`);
        const cast = await executeImmediateEnemyPayload(
            harness,
            ABILITY_SLOT_ID.Q,
            2
        );
        const placement = harness.backend
            .getActorActionPlacementRuntimeStatus();
        const transitAtLaunch = harness.endpoint
            .getActorPayloadMaterializationStatus().transit;
        assert(cast.outcome.subjectCount === 256
            && cast.outcome.generatedCount === 256
            && cast.outcome.cooldownConsumed === true
            && harness.registry.getActiveCount('enemy') === 512
            && placement.subjectHighWater >= 256,
        `${label} launch mismatch: ${JSON.stringify({
            outcome: cast.outcome,
            placement,
            transitAtLaunch,
            enemyCount: harness.registry.getActiveCount('enemy')
        })}`);

        let midpoint = null;
        if (throwing) {
            const materializerHistory = harness.materializer.getStatus().history;
            const startTick = materializerHistory[
                materializerHistory.length - 1
            ].targetFixedTick;
            const duration = R5_THROW_ACTOR_ACTION_PROFILE
                .travelDurationFixedTicks;
            assert(transitAtLaunch.activeActorCount === 256
                && transitAtLaunch.activeActorHighWater === 256,
            `Throw 256 airborne high-water mismatch: ${JSON.stringify(
                transitAtLaunch
            )}`);
            midpoint = await advanceTransitThroughFixedTick(
                harness,
                cast.nextFixedTick,
                startTick + Math.floor(duration / 2),
                'throw-256-midpoint'
            );
            const transitAtMidpoint = harness.endpoint
                .getActorPayloadMaterializationStatus().transit;
            assert(midpoint.committedHandles.length === 0
                && transitAtMidpoint.activeActorCount === 256,
            `Throw 256 midpoint mismatch: ${JSON.stringify({
                midpoint,
                transitAtMidpoint
            })}`);
        } else {
            assert(transitAtLaunch.activeActorCount === 0
                && transitAtLaunch.activeActorHighWater === 0,
            `Summon 256 unexpectedly entered transit: ${JSON.stringify(
                transitAtLaunch
            )}`);
        }
        const telemetry = captureRuntimeTelemetry(harness);
        assert(telemetry.materializerSubjectHighWater >= 256
            && telemetry.materializerGeneratedHighWater >= 256
            && telemetry.storageMaximum <= REQUIRED_STORAGE_BUFFER_LIMIT
            && telemetry.recoveryRequired === false,
        `${label} telemetry mismatch: ${JSON.stringify(telemetry)}`);
        result = Object.freeze({
            action,
            subjectCount: cast.outcome.subjectCount,
            generatedCount: cast.outcome.generatedCount,
            cooldownConsumed: cast.outcome.cooldownConsumed,
            activeEnemyCount: harness.registry.getActiveCount('enemy'),
            stableRankPlacementCount: throwing ? null : 256,
            airborneAtLaunch: throwing
                ? transitAtLaunch.activeActorCount
                : 0,
            airborneAtMeasurement: throwing
                ? harness.endpoint.getActorPayloadMaterializationStatus()
                    .transit.activeActorCount
                : 0,
            landedCount: throwing ? null : 0,
            landingCoveredBy: throwing ? 'mixedActorChurn' : null,
            telemetry
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

async function runMixedActorChurn(device) {
    const cycles = [];
    const teardownResults = [];
    let lastTelemetry = null;
    for (let cycle = 1; cycle <= 3; cycle++) {
        const harness = createHarness(
            device,
            128,
            MIXED_ACTOR_CHURN_LOADOUT
        );
        let destroyed = false;
        try {
            checkpoint(`mixed-actor-churn:${cycle}:initialize`);
            await initializePrimaryTower(harness);
            requestEnemyBatch(
                harness,
                4,
                2,
                `mixed-churn-${cycle}-sources`
            );
            let fixedTick = 2;
            const shoot = await executeShoot(
                harness,
                ABILITY_SLOT_ID.SHIFT,
                fixedTick
            );
            await advanceWorldAtFixedTick(
                harness,
                shoot.nextFixedTick - 1,
                `mixed-churn-${cycle}-shoot-bridge`
            );
            fixedTick = shoot.nextFixedTick;
            const throwFixedTick = fixedTick;
            const throwing = await executeImmediateEnemyPayload(
                harness,
                ABILITY_SLOT_ID.SPACE,
                throwFixedTick
            );
            const materializerHistory = harness.materializer.getStatus().history;
            const throwStartTick = materializerHistory[
                materializerHistory.length - 1
            ].targetFixedTick;
            fixedTick = throwing.nextFixedTick;
            const emitting = await executeImmediateEnemyPayload(
                harness,
                ABILITY_SLOT_ID.Q,
                fixedTick
            );
            fixedTick = emitting.nextFixedTick;
            const summoning = await executeImmediateEnemyPayload(
                harness,
                ABILITY_SLOT_ID.E,
                fixedTick
            );
            fixedTick = summoning.nextFixedTick;
            const transitAtLaunch = harness.endpoint
                .getActorPayloadMaterializationStatus().transit;
            assert(transitAtLaunch.activeActorCount
                    === throwing.outcome.generatedCount,
            `mixed churn ${cycle} transit launch mismatch: ${JSON.stringify({
                throwing: throwing.outcome,
                transitAtLaunch
            })}`);
            const landingTick = throwStartTick
                + R5_THROW_ACTOR_ACTION_PROFILE.travelDurationFixedTicks;
            const landing = await advanceTransitThroughFixedTick(
                harness,
                fixedTick,
                landingTick,
                `mixed-churn-${cycle}-landing`
            );
            assert(landing.committedHandles.length
                    === throwing.outcome.generatedCount,
            `mixed churn ${cycle} landing mismatch: ${JSON.stringify({
                landing,
                throwing: throwing.outcome
            })}`);
            const telemetry = captureRuntimeTelemetry(harness);
            const cycleResult = Object.freeze({
                cycle,
                Shoot: Object.freeze({
                    subjectCount: shoot.outcome.subjectCount,
                    generatedCount: shoot.outcome.generatedCount
                }),
                Throw: Object.freeze({
                    subjectCount: throwing.outcome.subjectCount,
                    generatedCount: throwing.outcome.generatedCount,
                    landedCount: landing.committedHandles.length
                }),
                Emit: Object.freeze({
                    subjectCount: emitting.outcome.subjectCount,
                    generatedCount: emitting.outcome.generatedCount
                }),
                Summon: Object.freeze({
                    subjectCount: summoning.outcome.subjectCount,
                    generatedCount: summoning.outcome.generatedCount
                }),
                livingTowerCount:
                    harness.towerGroupState.getStatus().livingTowerCount,
                activeEnemyCount: harness.registry.getActiveCount('enemy'),
                telemetry
            });
            assert(Object.values({ shoot, throwing, emitting, summoning })
                .every((cast) => cast.outcome.cooldownConsumed === true)
                && cycleResult.livingTowerCount === 2
                && cycleResult.activeEnemyCount === 12
                && telemetry.reservedRegistryCount === 0
                && telemetry.pendingCommandCount === 0
                && telemetry.recoveryRequired === false,
            `mixed churn ${cycle} cooldown mismatch: ${JSON.stringify(
                cycleResult
            )}`);
            cycles.push(cycleResult);
            lastTelemetry = telemetry;
        } finally {
            destroyed = await destroyHarness(harness);
            teardownResults.push(destroyed);
        }
    }
    assert(cycles.length === 3 && teardownResults.every(Boolean),
        `mixed actor churn teardown mismatch: ${JSON.stringify({
            cycleCount: cycles.length,
            teardownResults
        })}`);
    return Object.freeze({
        cycleCount: cycles.length,
        cycles: Object.freeze(cycles),
        finalLivingTowerCount: cycles[2].livingTowerCount,
        finalActiveEnemyCount: cycles[2].activeEnemyCount,
        telemetry: lastTelemetry,
        destroyedTeardown: true
    });
}

async function runDurableTowerRecovery(device) {
    const loadout = Object.freeze({
        [ABILITY_SLOT_ID.Q]: INJECTED_THROW_TOWER_SENTENCE
    });
    let activeHarness = createHarness(device, 16, loadout);
    let towerGroupState = null;
    let wordSystem = null;
    let result = null;
    let oldDestroyed = false;
    let replacementDestroyed = false;
    try {
        checkpoint('durable-tower-recovery:initialize');
        await initializePrimaryTower(activeHarness);
        const cast = await executeShoot(
            activeHarness,
            ABILITY_SLOT_ID.Q,
            2
        );
        const oldTransit = activeHarness.endpoint
            .getActorPayloadMaterializationStatus().transit;
        const oldRecords = activeHarness.towerGroupState.getTowerRecords();
        const childBefore = oldRecords.find((record) => (
            record.logicalTowerOrdinal > 1
        ));
        assert(cast.outcome.generatedCount === 1
            && oldTransit.activeActorCount === 1
            && childBefore?.creationMetadata?.generation === 1
            && childBefore.creationMetadata.actorActionProfileFingerprint
                === R5_THROW_ACTOR_ACTION_PROFILE
                    .actorActionProfileFingerprint,
        `durable recovery launch mismatch: ${JSON.stringify({
            outcome: cast.outcome,
            oldTransit,
            childBefore
        })}`);
        const oldBinding = childBefore.exactGpuBinding;
        const cooldownBefore = activeHarness.wordSystem.getSlotView(
            ABILITY_SLOT_ID.Q
        ).cooldown;
        towerGroupState = activeHarness.towerGroupState;
        wordSystem = activeHarness.wordSystem;
        towerGroupState.releaseGpuBindings();
        oldDestroyed = await destroyHarness(activeHarness, {
            preserveRunDomain: true
        });
        activeHarness = null;

        activeHarness = createHarness(device, 16, loadout, {
            deviceGeneration: 2,
            towerGroupState,
            wordSystem
        });
        const recovery = await initializeRecoveredTowers(activeHarness, 1);
        const childAfter = towerGroupState.getTowerRecords().find((record) => (
            record.logicalTowerOrdinal === childBefore.logicalTowerOrdinal
        ));
        const childHandle = recovery.handles.get(childAfter.logicalTowerId);
        const body = activeHarness.registry.copyEntityView(childHandle, {});
        const metadata = body.metadata;
        const recoveryIntent = recovery.intents.get(childAfter.logicalTowerId);
        const replacementTransit = activeHarness.endpoint
            .getActorPayloadMaterializationStatus().transit;
        const cooldownAfter = wordSystem.getSlotView(
            ABILITY_SLOT_ID.Q
        ).cooldown;
        assert(JSON.stringify(childAfter.creationMetadata)
                === JSON.stringify(childBefore.creationMetadata)
            && childAfter.creationMetadata.sourceExecutionId
                === childBefore.creationMetadata.sourceExecutionId
            && childAfter.exactGpuBinding.deviceGeneration === 2
            && oldBinding.deviceGeneration === 1
            && metadata.abilityGeneration === 1
            && metadata.actorActionProfileFingerprint
                === R5_THROW_ACTOR_ACTION_PROFILE
                    .actorActionProfileFingerprint
            && metadata.actorActionCode === childBefore.creationMetadata
                .actorActionCode
            && !('sourceExecutionId' in metadata)
            && recoveryIntent.position.x
                === childAfter.recoverySpawnDescriptor.position.x
            && recoveryIntent.position.y
                === childAfter.recoverySpawnDescriptor.position.y
            && recoveryIntent.velocity.x === 0
            && recoveryIntent.velocity.y === 0
            && replacementTransit.activeActorCount === 0
            && replacementTransit.activeActorHighWater === 0
            && cooldownAfter.nextEligibleFixedTick
                === cooldownBefore.nextEligibleFixedTick,
        `durable Tower recovery mismatch: ${JSON.stringify({
            childBefore,
            childAfter,
            oldBinding,
            childHandle,
            body,
            recoveryIntent,
            oldTransit,
            replacementTransit,
            cooldownBefore,
            cooldownAfter
        })}`);
        result = Object.freeze({
            generation: metadata.abilityGeneration,
            actorActionCode: metadata.actorActionCode,
            actorActionProfileFingerprint:
                metadata.actorActionProfileFingerprint,
            durableSourceExecutionId:
                childAfter.creationMetadata.sourceExecutionId,
            oldDeviceGeneration: oldBinding.deviceGeneration,
            newDeviceGeneration: childAfter.exactGpuBinding.deviceGeneration,
            restoredPosition: recoveryIntent.position,
            restoredVelocity: recoveryIntent.velocity,
            transitRestored: replacementTransit.activeActorCount > 0,
            cooldownPreserved: cooldownAfter.nextEligibleFixedTick
                === cooldownBefore.nextEligibleFixedTick,
            telemetry: captureRuntimeTelemetry(activeHarness)
        });
    } finally {
        if (activeHarness) {
            replacementDestroyed = await destroyHarness(activeHarness);
            activeHarness = null;
        } else {
            try { wordSystem?.destroy(); } catch { /* best effort */ }
            try { towerGroupState?.destroy(); } catch { /* best effort */ }
        }
    }
    return Object.freeze({
        ...result,
        oldDestroyed,
        replacementDestroyed,
        destroyedTeardown: oldDestroyed && replacementDestroyed
    });
}

function killTowerAfterSnapshot(harness, record, targetFixedTick, label) {
    const handle = record?.exactGpuBinding;
    assert(handle, `${label} Tower source handle missing`);
    const protocol = harness.backend.getEventProtocolState();
    const event = Object.freeze({
        type: 'death',
        eventType: 'death',
        disposition: 'despawn-requested',
        entityId: handle.entityId,
        incarnation: handle.incarnation,
        ...protocol,
        sourceTick: targetFixedTick - 1,
        sequence: 0,
        key: `r5-actor-verbs:${label}:death`,
        reason: 'health-depleted',
        reasonFlags: 0
    });
    const stateCommit = harness.towerGroupState.commitCompletedEvents({
        events: [event]
    });
    assert(stateCommit?.recoveryRequired !== true,
        `${label} TowerGroup death commit failed: ${JSON.stringify(stateCommit)}`);
    const roster = harness.backend.synchronizeTowerGroupRoster({
        groupRevision: harness.towerGroupState.getStatus().groupRevision,
        records: harness.towerGroupState.getTowerRecords()
    });
    assert(roster.accepted === true,
        `${label} TowerGroup death roster sync failed: ${JSON.stringify(roster)}`);
    const receipt = harness.endpoint.requestDespawn(
        handle,
        'r5-tower-source-death-after-snapshot',
        targetFixedTick,
        `r5:${label}:despawn`
    );
    assert(receipt.accepted === true,
        `${label} Tower despawn request failed: ${JSON.stringify(receipt)}`);
    return Object.freeze({
        handle: Object.freeze({
            entityId: handle.entityId,
            incarnation: handle.incarnation
        }),
        shareUnits: record.shareUnits,
        currentHpFixedPoint: record.currentHpFixedPoint,
        powerFixedPoint: record.powerFixedPoint
    });
}

async function runTowerSourceDeathWithSurvivor(device) {
    const harness = createHarness(device, 32);
    let result = null;
    let destroyedTeardown = false;
    try {
        checkpoint('tower-source-death:initialize');
        await initializePrimaryTower(harness);
        const seed = await executeShoot(harness, ABILITY_SLOT_ID.SHIFT, 2);
        const beforeStatus = harness.towerGroupState.getStatus();
        const beforeTotals = towerTotals(harness.towerGroupState);
        let death = null;
        const cast = await executeShoot(
            harness,
            ABILITY_SLOT_ID.SHIFT,
            seed.nextFixedTick,
            {
                afterSnapshot({ harness: activeHarness }) {
                    const source = activeHarness.towerGroupState
                        .getTowerRecords()
                        .filter((record) => record.alive)
                        .sort((left, right) => (
                            left.logicalTowerOrdinal - right.logicalTowerOrdinal
                        ))[0];
                    death = killTowerAfterSnapshot(
                        activeHarness,
                        source,
                        seed.nextFixedTick + 1,
                        'tower-source-death'
                    );
                }
            }
        );
        const afterStatus = harness.towerGroupState.getStatus();
        const afterTotals = towerTotals(harness.towerGroupState);
        const survivorTotalsConserved
            = afterStatus.livingShareUnits
                === beforeStatus.livingShareUnits - death.shareUnits
                && afterTotals.currentHpFixedPoint
                    === beforeTotals.currentHpFixedPoint
                        - death.currentHpFixedPoint
                && afterTotals.powerFixedPoint
                    === beforeTotals.powerFixedPoint - death.powerFixedPoint;
        assert(cast.outcome.subjectCount === 2
            && cast.outcome.generatedCount === 2
            && afterStatus.livingTowerCount === 3
            && afterStatus.lostShareUnits === death.shareUnits
            && survivorTotalsConserved,
        `Tower source-death frozen creation mismatch: ${JSON.stringify({
            outcome: cast.outcome,
            beforeStatus,
            beforeTotals,
            afterStatus,
            afterTotals,
            death
        })}`);
        result = Object.freeze({
            subjectCount: cast.outcome.subjectCount,
            generatedCount: cast.outcome.generatedCount,
            sourceRemoved: !harness.registry.has(death.handle),
            towerCount: afterStatus.livingTowerCount,
            livingShareUnits: afterStatus.livingShareUnits,
            lostShareUnits: afterStatus.lostShareUnits,
            survivorTotalsConserved,
            cooldownConsumed: cast.outcome.cooldownConsumed,
            storageMaximum: cast.storageMaximum,
            recoveryRequired: recoveryRequired(harness)
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

async function runOnlyTowerSourceDeath(device) {
    const harness = createHarness(device, 16);
    let result = null;
    let destroyedTeardown = false;
    try {
        checkpoint('zero-share:initialize');
        await initializePrimaryTower(harness);
        let death = null;
        const cast = await executeShoot(
            harness,
            ABILITY_SLOT_ID.SHIFT,
            2,
            {
                afterSnapshot({ harness: activeHarness }) {
                    const source = activeHarness.towerGroupState
                        .getTowerRecords()
                        .find((record) => record.alive);
                    death = killTowerAfterSnapshot(
                        activeHarness,
                        source,
                        3,
                        'zero-share'
                    );
                }
            }
        );
        const status = harness.towerGroupState.getStatus();
        assert(cast.outcome.subjectCount === 1
            && cast.outcome.generatedCount === 0
            && cast.outcome.cooldownConsumed === false
            && cast.towerReceipt.result
                === TOWER_CREATION_RESULT.REJECTED_ZERO_SHARE
            && status.livingTowerCount === 0
            && status.livingShareUnits === 0
            && status.lostShareUnits === death.shareUnits,
        `Only-Tower source-death zero-share mismatch: ${JSON.stringify({
            outcome: cast.outcome,
            receipt: cast.towerReceipt,
            status,
            death
        })}`);
        result = Object.freeze({
            subjectCount: cast.outcome.subjectCount,
            generatedCount: cast.outcome.generatedCount,
            sourceRemoved: !harness.registry.has(death.handle),
            towerCount: status.livingTowerCount,
            livingShareUnits: status.livingShareUnits,
            lostShareUnits: status.lostShareUnits,
            result: cast.towerReceipt.result,
            cooldownConsumed: cast.outcome.cooldownConsumed,
            storageMaximum: cast.storageMaximum,
            recoveryRequired: recoveryRequired(harness)
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

async function runEnemySourceDeath(device) {
    const harness = createHarness(device, 16);
    let result = null;
    let destroyedTeardown = false;
    try {
        checkpoint('source-death:initialize');
        await initializePrimaryTower(harness);
        const [enemyCommandId] = requestEnemyBatch(
            harness,
            1,
            2,
            'source-death'
        );
        let sourceHandle = null;
        const cast = await executeShoot(
            harness,
            ABILITY_SLOT_ID.SPACE,
            2,
            {
                afterSnapshot({ harness: activeHarness, lifecycle }) {
                    sourceHandle = lifecycle.spawned.find((entry) => (
                        entry.commandId === enemyCommandId
                    ))?.handle ?? null;
                    assert(sourceHandle, 'source-death Enemy handle missing');
                    const receipt = activeHarness.endpoint.requestDespawn(
                        sourceHandle,
                        'r5-source-death-after-snapshot',
                        3,
                        'r5:source-death'
                    );
                    assert(receipt.accepted === true,
                        `source death request failed: ${JSON.stringify(receipt)}`);
                }
            }
        );
        result = Object.freeze({
            subjectCount: cast.outcome.subjectCount,
            generatedCount: cast.outcome.generatedCount,
            sourceRemoved: !harness.registry.has(sourceHandle),
            towerCount: harness.towerGroupState.getStatus().livingTowerCount,
            cooldownConsumed: cast.outcome.cooldownConsumed,
            storageMaximum: cast.storageMaximum,
            recoveryRequired: recoveryRequired(harness)
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
}

async function runInjectedImmediateMatrix(device) {
    const cases = [];
    for (const descriptor of INJECTED_IMMEDIATE_ACTOR_CASES) {
        const harness = createHarness(device, 32, Object.freeze({
            [ABILITY_SLOT_ID.Q]: descriptor.sentence
        }));
        let caseResult = null;
        let destroyedTeardown = false;
        try {
            checkpoint(`injected-${descriptor.id}:initialize`);
            await initializePrimaryTower(harness);
            const payloadCountBefore = harness.registry.getActiveCount(
                descriptor.payloadKind
            );
            if (descriptor.subjectKind === 'enemy') {
                requestEnemyBatch(
                    harness,
                    1,
                    2,
                    `injected-${descriptor.id}-source`
                );
            }
            const cast = descriptor.payloadKind === 'tower'
                ? await executeShoot(harness, ABILITY_SLOT_ID.Q, 2)
                : await executeImmediateEnemyPayload(
                    harness,
                    ABILITY_SLOT_ID.Q,
                    2
                );
            const payloadCountAfter = harness.registry.getActiveCount(
                descriptor.payloadKind
            );
            const expectedPayloadCount = payloadCountBefore + 1
                + (descriptor.subjectKind === 'enemy'
                        && descriptor.payloadKind === 'enemy'
                    ? 1
                    : 0);
            const transitStatus = harness.endpoint
                .getActorPayloadMaterializationStatus().transit;
            const noTransit = (transitStatus?.activeActorCount ?? 0) === 0
                && (transitStatus?.activeBatchCount ?? 0) === 0;
            assert(cast.outcome.subjectCount === 1
                && cast.outcome.generatedCount === 1
                && cast.outcome.cooldownConsumed === true
                && payloadCountAfter === expectedPayloadCount
                && noTransit,
            `Injected ${descriptor.id} mismatch: ${JSON.stringify({
                outcome: cast.outcome,
                payloadCountBefore,
                payloadCountAfter,
                expectedPayloadCount,
                transitStatus
            })}`);
            caseResult = Object.freeze({
                id: descriptor.id,
                action: descriptor.action,
                subjectKind: descriptor.subjectKind,
                payloadKind: descriptor.payloadKind,
                subjectCount: cast.outcome.subjectCount,
                generatedCount: cast.outcome.generatedCount,
                cooldownConsumed: cast.outcome.cooldownConsumed,
                payloadCountBefore,
                payloadCountAfter,
                noTransit,
                storageMaximum: cast.storageMaximum,
                recoveryRequired: recoveryRequired(harness)
            });
        } finally {
            destroyedTeardown = await destroyHarness(harness);
        }
        cases.push(Object.freeze({ ...caseResult, destroyedTeardown }));
    }
    return Object.freeze({
        cases: Object.freeze(cases),
        storageMaximum: Math.max(...cases.map((entry) => (
            entry.storageMaximum
        ))),
        recoveryRequired: cases.some((entry) => (
            entry.recoveryRequired === true
        )),
        destroyedTeardown: cases.every((entry) => (
            entry.destroyedTeardown === true
        ))
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

        checkpoint('zero-subject:start');
        const zeroSubject = await runZeroEnemySubjects(device);
        checkpoint('tower-recursion:start');
        const towerRecursion = await runTowerRecursion(device);
        checkpoint('enemy-ten:start');
        const enemyTen = await runEnemyCount(device, 10, 32, 'enemy-ten');
        checkpoint('enemy-hundred:start');
        const enemyHundred = await runEnemyCount(
            device,
            100,
            240,
            'enemy-hundred'
        );
        checkpoint('capacity-exact:start');
        const exact = await runEnemyCount(device, 255, 520, 'capacity-exact');
        checkpoint('capacity-over:start');
        const over = await runEnemyCount(device, 256, 300, 'capacity-over');
        checkpoint('repeated-capacity:start');
        const repeatedCapacity = await runRepeatedTowerCapacity(device);
        checkpoint('hostile-1000-tower-256:start');
        const hostileThousandAtCapacity
            = await runHostileThousandAtFullTowerCapacity(device);
        checkpoint('throw-256:start');
        const throw256 = await runEnemyActorBatchStress(device, 'Throw');
        checkpoint('summon-256:start');
        const summon256 = await runEnemyActorBatchStress(device, 'Summon');
        checkpoint('mixed-actor-churn:start');
        const mixedActorChurn = await runMixedActorChurn(device);
        checkpoint('enemy-source-death:start');
        const sourceDeath = await runEnemySourceDeath(device);
        checkpoint('tower-source-death:start');
        const towerSourceDeath = await runTowerSourceDeathWithSurvivor(device);
        checkpoint('zero-share:start');
        const zeroShare = await runOnlyTowerSourceDeath(device);
        checkpoint('injected-immediate-matrix:start');
        const injectedImmediateMatrix = await runInjectedImmediateMatrix(
            device
        );
        checkpoint('durable-tower-recovery:start');
        const durableTowerRecovery = await runDurableTowerRecovery(device);
        const performance = await timingRecorder.finalize();
        timingRecorder = null;
        const telemetrySamples = Object.freeze([
            zeroSubject.telemetry,
            enemyTen.telemetry,
            enemyHundred.telemetry,
            exact.telemetry,
            over.telemetry,
            repeatedCapacity.telemetry,
            hostileThousandAtCapacity.telemetry,
            throw256.telemetry,
            summon256.telemetry,
            mixedActorChurn.telemetry,
            durableTowerRecovery.telemetry
        ]);
        const telemetryMaximum = (field) => Math.max(
            ...telemetrySamples.map((entry) => Number(entry[field] ?? 0))
        );
        const acceptanceTelemetry = Object.freeze({
            highWater: Object.freeze({
                body: telemetryMaximum('bodyCountHighWater'),
                activeBody: telemetryMaximum('activeBodyCountHighWater'),
                Tower: telemetryMaximum('towerRecordHighWater'),
                Enemy: Math.max(...telemetrySamples.map((entry) => (
                    entry.activeEnemyCount
                ))),
                placementSubject:
                    telemetryMaximum('placementSubjectHighWater'),
                transitActor: telemetryMaximum('transitActorHighWater')
            }),
            readbackBytes: exact.telemetry.readbackBytes,
            storageProfile: throw256.telemetry.storageProfile,
            perSubjectCpuTransformReadbackCount: Math.max(
                telemetryMaximum('fullPlacementRecordReadbackCount'),
                telemetryMaximum('fullTransitRecordReadbackCount')
            ),
            perSubjectCpuSpawnCommandCount:
                telemetryMaximum('perSubjectCpuSpawnCommandCount'),
            perActorCpuAdvanceCount:
                telemetryMaximum('perActorCpuAdvanceCount'),
            perActorJsControllerCount: 0,
            partialCreationCount: 0,
            lostShareRestorationCount: 0,
            sameExecutionRecursionCount: 0,
            maximumEndingRegistryReservationCount:
                telemetryMaximum('reservedRegistryCount'),
            maximumEndingPendingCommandCount:
                telemetryMaximum('pendingCommandCount'),
            protocolFailureCount:
                telemetryMaximum('towerProtocolFailureCount'),
            droppedFixedTickCount: 0,
            lostFixedTimeMs: 0,
            fixedStepAccountingScope:
                'serialized acceptance harness without a render accumulator'
        });
        const storageMaximum = Math.max(
            zeroSubject.telemetry.storageMaximum,
            towerRecursion.storageMaximum,
            enemyTen.storageMaximum,
            enemyHundred.storageMaximum,
            exact.storageMaximum,
            over.storageMaximum,
            repeatedCapacity.telemetry.storageMaximum,
            hostileThousandAtCapacity.telemetry.storageMaximum,
            throw256.telemetry.storageMaximum,
            summon256.telemetry.storageMaximum,
            mixedActorChurn.telemetry.storageMaximum,
            sourceDeath.storageMaximum,
            towerSourceDeath.storageMaximum,
            zeroShare.storageMaximum,
            injectedImmediateMatrix.storageMaximum,
            durableTowerRecovery.telemetry.storageMaximum
        );
        const destroyedTeardown = [
            zeroSubject,
            towerRecursion,
            enemyTen,
            enemyHundred,
            exact,
            over,
            repeatedCapacity,
            hostileThousandAtCapacity,
            throw256,
            summon256,
            mixedActorChurn,
            sourceDeath,
            towerSourceDeath,
            zeroShare,
            injectedImmediateMatrix,
            durableTowerRecovery
        ]
            .every((fixture) => fixture.destroyedTeardown === true);
        result.r5ActorVerbs = Object.freeze({
            scenario: 'r5-shoot-tower-production-vertical-slice',
            acceptanceScenario:
                'r5-tower-payload-actor-verbs-final-acceptance',
            zeroSubject,
            towerRecursion,
            enemyTen,
            enemyHundred,
            capacity: Object.freeze({
                exactSubjectCount: exact.subjectCount,
                exactTowerCount: exact.towerCount,
                overSubjectCount: over.subjectCount,
                overRejected:
                    over.result !== TOWER_CREATION_RESULT.COMMITTED,
                overGeneratedCount: over.generatedCount,
                overCooldownConsumed: over.cooldownConsumed,
                exactTotalsConserved: exact.totalsConserved,
                overTotalsConserved: over.totalsConserved
            }),
            repeatedCapacity,
            hostileThousandAtCapacity,
            throw256,
            summon256,
            mixedActorChurn,
            sourceDeath,
            towerSourceDeath,
            zeroShare,
            injectedImmediateMatrix,
            durableTowerRecovery,
            performance,
            acceptanceTelemetry,
            enemyTenTotalsConserved: enemyTen.totalsConserved,
            profileFingerprintBound: towerRecursion.profileFingerprintBound
                && enemyTen.profileFingerprintBound
                && exact.profileFingerprintBound
                && over.profileFingerprintBound,
            storageMaximum,
            recoveryRequired: towerRecursion.recoveryRequired
                || enemyTen.recoveryRequired
                || enemyHundred.recoveryRequired
                || exact.recoveryRequired
                || over.recoveryRequired
                || repeatedCapacity.telemetry.recoveryRequired
                || hostileThousandAtCapacity.telemetry.recoveryRequired
                || throw256.telemetry.recoveryRequired
                || summon256.telemetry.recoveryRequired
                || mixedActorChurn.telemetry.recoveryRequired
                || sourceDeath.recoveryRequired
                || towerSourceDeath.recoveryRequired
                || zeroShare.recoveryRequired
                || injectedImmediateMatrix.recoveryRequired
                || durableTowerRecovery.telemetry.recoveryRequired,
            destroyedTeardown
        });
        await device.queue.onSubmittedWorkDone();
        result.uncapturedErrorCount = uncapturedErrors.length;
        assert(uncapturedErrors.length === 0,
            `uncaptured WebGPU error: ${uncapturedErrors.join(' | ')}`);
        assert(storageMaximum <= REQUIRED_STORAGE_BUFFER_LIMIT,
            `R5 storage binding maximum exceeded: ${storageMaximum}`);
        assert(acceptanceTelemetry.highWater.body >= 1_256
            && acceptanceTelemetry.highWater.Tower === 256
            && acceptanceTelemetry.highWater.Enemy === 1_000
            && acceptanceTelemetry.highWater.placementSubject === 256
            && acceptanceTelemetry.highWater.transitActor === 256,
        `R5 high-water mismatch: ${JSON.stringify(acceptanceTelemetry)}`);
        assert(acceptanceTelemetry.readbackBytes.abilitySubjectAggregate === 64
            && acceptanceTelemetry.readbackBytes.payloadAggregate === 88
            && acceptanceTelemetry.readbackBytes.placementAggregate === 112
            && acceptanceTelemetry.readbackBytes.transitAggregate === 64
            && acceptanceTelemetry.readbackBytes.towerCreationAggregate === 96
            && acceptanceTelemetry.readbackBytes.towerMetadataCommitRecord === 32
            && acceptanceTelemetry.perSubjectCpuTransformReadbackCount === 0
            && acceptanceTelemetry.perSubjectCpuSpawnCommandCount === 0
            && acceptanceTelemetry.perActorCpuAdvanceCount === 0
            && acceptanceTelemetry.maximumEndingRegistryReservationCount === 0
            && acceptanceTelemetry.maximumEndingPendingCommandCount === 0
            && acceptanceTelemetry.protocolFailureCount === 0,
        `R5 bounded telemetry mismatch: ${JSON.stringify(
            acceptanceTelemetry
        )}`);
        assert(performance.fullFixedBoundaryElapsedMs.sampleCount > 0
            && (!performance.timestampQuerySupported
                || ['action', 'placement', 'transit'].every((category) => (
                    performance.gpu[category].sampleCount > 0
                    && Number.isFinite(performance.gpu[category].p50)
                    && Number.isFinite(performance.gpu[category].p95)
                ))),
        `R5 timing evidence mismatch: ${JSON.stringify(performance)}`);
        assert(result.r5ActorVerbs.recoveryRequired === false,
            `R5 recovery occurred: ${JSON.stringify(result.r5ActorVerbs)}`);
        assert(destroyedTeardown === true,
            'R5 runtime teardown did not destroy resources');
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

export {
    FIXED_DELTA,
    advanceTransitThroughFixedTick,
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
};

if (process.env.CIRVIVOR_WEBGPU_FIXTURE_STAGE !== 'r7-actor-payload-multiplicity') {
    run();
}
