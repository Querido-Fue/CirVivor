import {
    BASIC_CIRCLE_ENEMY_DATA
} from './production/script/data/object/enemy/basic_circle_enemy_data.js';
import {
    R3_ENEMY_WORD_INSTANCE,
    R3_TOWER_WORD_INSTANCE,
    R5_EMIT_WORD_INSTANCE,
    R5_SHOWCASE_SENTENCE_LOADOUT,
    R5_SUMMON_WORD_INSTANCE
} from './production/script/data/word/r3_word_catalog_data.js';
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
    loadout = R5_SHOWCASE_SENTENCE_LOADOUT
) {
    const navigationSource = createNavigationSource();
    let coreCleanupBinding = null;
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPlatformPort(device),
        coreImpactCleanupPortReceiver(binding) {
            coreCleanupBinding = binding;
        }
    }, {
        capacity,
        abilitySubjectCommandCapacity: 4,
        abilitySubjectCapacity: 1_000,
        abilitySubjectReadbackSlotCount: 3,
        actorActionPlacementCommandCapacity: 4,
        actorActionPlacementSubjectCapacity: 256,
        actorActionPlacementReadbackSlotCount: 3,
        towerGroupMemberCapacity: Math.min(capacity, 256),
        towerGroupReadbackSlotCount: 3,
        towerCreationReadbackSlotCount: 3
    });
    endpoint.init(navigationSource);
    assert(coreCleanupBinding !== null, 'Core cleanup binding missing');
    const backend = endpoint.getBackend();
    const registry = endpoint.getRegistry();
    const towerGroupState = new TowerGroupState();
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
    const wordSystem = new WordSystem({
        loadout
    });
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
    assert(harness.endpoint.fixedUpdate(FIXED_DELTA, fixedTick),
        'primary Tower fixed submit failed');
    await harness.device.queue.onSubmittedWorkDone();
    const roster = harness.backend.synchronizeTowerGroupRoster({
        groupRevision: harness.towerGroupState.getStatus().groupRevision,
        records: harness.towerGroupState.getTowerRecords()
    });
    assert(roster.accepted === true,
        `primary Tower roster sync failed: ${JSON.stringify(roster)}`);
    await harness.device.queue.onSubmittedWorkDone();
    return handle;
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
    assert(endpoint.fixedUpdate(FIXED_DELTA, fixedTick),
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
        const rejected = harness.materializer.observeTowerCreationCompletion(
            coordinatorStage,
            fixedTick + 1
        );
        return Object.freeze({
            activation,
            lifecycle,
            abilityObservation,
            payloadStage,
            coordinatorStage,
            towerRequest,
            towerReceipt: coordinatorStage,
            materializerObservation: rejected,
            outcome: harness.wordSystem.getStatusView().lastExecutionOutcome,
            nextFixedTick: fixedTick + 2,
            storageMaximum: storageMaximum(harness)
        });
    }
    assert(coordinatorStage.phase === 'actor-action-placement',
        `placement phase missing: ${JSON.stringify(coordinatorStage)}`);
    assert(endpoint.fixedUpdate(FIXED_DELTA, fixedTick + 1),
        `placement fixed submit ${fixedTick + 1} failed`);
    await waitFor(
        device,
        () => backend.getActorActionPlacementRuntimeStatus(),
        (status) => status.inFlightCount === 0
            && status.completedCount > placementCompletedBefore,
        `actor placement ${fixedTick + 1}`
    );

    const creationStage = harness.coordinator
        .observeCompletedAtFixedBoundary(fixedTick + 2);
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
    await openGenericBoundary(device, endpoint, fixedTick + 2);
    const creationLifecycle = endpoint.commitAtFixedBoundary(fixedTick + 2);
    assert(creationLifecycle.recoveryRequired !== true,
        `creation lifecycle failed: ${JSON.stringify(creationLifecycle)}`);
    assert(endpoint.fixedUpdate(FIXED_DELTA, fixedTick + 2),
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
    const materializerObservation = harness.materializer
        .observeTowerCreationCompletion(towerReceipt, fixedTick + 3);
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
        creationStage,
        towerRequest,
        towerReceipt,
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
    assert(endpoint.fixedUpdate(FIXED_DELTA, fixedTick),
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
    assert(endpoint.fixedUpdate(FIXED_DELTA, fixedTick + 1),
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
    assert(endpoint.fixedUpdate(FIXED_DELTA, fixedTick + 2),
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

async function destroyHarness(harness) {
    harness.materializer.destroy();
    harness.abilityRuntime.destroy();
    harness.wordSystem.destroy();
    harness.estimator.destroy();
    harness.coordinator.destroy();
    harness.towerGroupState.destroy();
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
            recoveryRequired: recoveryRequired(harness)
        });
    } finally {
        destroyedTeardown = await destroyHarness(harness);
    }
    return Object.freeze({ ...result, destroyedTeardown });
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

        checkpoint('tower-recursion:start');
        const towerRecursion = await runTowerRecursion(device);
        checkpoint('enemy-ten:start');
        const enemyTen = await runEnemyCount(device, 10, 32, 'enemy-ten');
        checkpoint('capacity-exact:start');
        const exact = await runEnemyCount(device, 255, 520, 'capacity-exact');
        checkpoint('capacity-over:start');
        const over = await runEnemyCount(device, 256, 300, 'capacity-over');
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
        const storageMaximum = Math.max(
            towerRecursion.storageMaximum,
            enemyTen.storageMaximum,
            exact.storageMaximum,
            over.storageMaximum,
            sourceDeath.storageMaximum,
            towerSourceDeath.storageMaximum,
            zeroShare.storageMaximum,
            injectedImmediateMatrix.storageMaximum
        );
        const destroyedTeardown = [
            towerRecursion,
            enemyTen,
            exact,
            over,
            sourceDeath,
            towerSourceDeath,
            zeroShare,
            injectedImmediateMatrix
        ]
            .every((fixture) => fixture.destroyedTeardown === true);
        result.r5ActorVerbs = Object.freeze({
            scenario: 'r5-shoot-tower-production-vertical-slice',
            towerRecursion,
            enemyTen,
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
            sourceDeath,
            towerSourceDeath,
            zeroShare,
            injectedImmediateMatrix,
            enemyTenTotalsConserved: enemyTen.totalsConserved,
            profileFingerprintBound: towerRecursion.profileFingerprintBound
                && enemyTen.profileFingerprintBound
                && exact.profileFingerprintBound
                && over.profileFingerprintBound,
            storageMaximum,
            recoveryRequired: towerRecursion.recoveryRequired
                || enemyTen.recoveryRequired
                || exact.recoveryRequired
                || over.recoveryRequired
                || sourceDeath.recoveryRequired
                || towerSourceDeath.recoveryRequired
                || zeroShare.recoveryRequired
                || injectedImmediateMatrix.recoveryRequired,
            destroyedTeardown
        });
        await device.queue.onSubmittedWorkDone();
        result.uncapturedErrorCount = uncapturedErrors.length;
        assert(uncapturedErrors.length === 0,
            `uncaptured WebGPU error: ${uncapturedErrors.join(' | ')}`);
        assert(storageMaximum <= REQUIRED_STORAGE_BUFFER_LIMIT,
            `R5 storage binding maximum exceeded: ${storageMaximum}`);
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

run();
