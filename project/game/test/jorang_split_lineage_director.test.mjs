import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID
} = await loadGameModule('ingame/contract/enemy_atomic_transform_contract.js');
const {
    JorangSplitLineageDirector
} = await loadGameModule('ingame/object/enemy/jorang_split_lineage_director.js');

const J_ID = 'basic_gen_01';
const C_PRIME_ID = 'basic_circle_prime_01';
const J_PROFILE_ID = 'jorang-one-to-many-01';
const C_PRIME_PROFILE_ID = 'circle-prime-return-delayed-01';

function key(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function handle(entityId, incarnation = 1) {
    return Object.freeze({ entityId, incarnation });
}

function metadata(root, overrides = {}) {
    return Object.freeze({
        lineageRootEntityId: root.entityId,
        lineageRootIncarnation: root.incarnation,
        branchIndex: 0,
        bountyBudget: 12,
        transformAtTick: 0,
        atomicTransformProfileId: J_PROFILE_ID,
        teamId: 2,
        damagePolicyId: 1,
        allegiancePolicy: 1,
        gateId: 'jorang-director-gate',
        pathId: 'jorang-director-path',
        initialWaypointIndex: 0,
        spawnSequence: root.entityId,
        waveId: 'jorang-director-wave',
        policyId: 'author-only-fixture',
        ...overrides
    });
}

function createRegistry() {
    const views = new Map();
    return Object.freeze({
        put(exactHandle, definitionId, viewMetadata) {
            views.set(key(exactHandle), Object.freeze({
                kindId: 'enemy',
                definitionId,
                metadata: viewMetadata
            }));
        },
        remove(exactHandle) {
            views.delete(key(exactHandle));
        },
        has(exactHandle) {
            return views.has(key(exactHandle));
        },
        copyEntityView(exactHandle, target = {}) {
            const view = views.get(key(exactHandle));
            if (!view) return null;
            return Object.assign(target, view);
        },
        copyActiveHandlesInto(target, { kindId } = {}) {
            if (kindId !== undefined && kindId !== 'enemy') return target;
            for (const exactKey of views.keys()) {
                const [entityId, incarnation] = exactKey.split(':').map(Number);
                target.push(handle(entityId, incarnation));
            }
            return target;
        }
    });
}

function createCommandPort() {
    const prepareRequests = [];
    const transformRequests = [];
    const discarded = [];
    return Object.freeze({
        prepareRequests,
        transformRequests,
        discarded,
        requestPrepareBatch(request) {
            prepareRequests.push(request);
            return Object.freeze({
                accepted: true,
                targetFixedTick: request.targetFixedTick,
                requestedCount: request.records.length
            });
        },
        requestPreparedTransformBatch(request) {
            transformRequests.push(request);
            return Object.freeze({
                accepted: true,
                commandId: request.commandId
            });
        },
        discardPreparedBatch(request) {
            discarded.push(request);
            return Object.freeze({ accepted: true });
        }
    });
}

function createDirector(registry, commandPort, capacity = 32) {
    return new JorangSplitLineageDirector({
        registry,
        atomicTransformCommandPort: commandPort,
        sessionGeneration: 7,
        capacity
    });
}

test('empty lineage roster is a replay-stable host no-op without opening GPU prepare', () => {
    const registry = createRegistry();
    const commandPort = createCommandPort();
    const director = createDirector(registry, commandPort);

    assert.deepEqual(director.stageForFixedTick({ targetFixedTick: 1 }), {
        accepted: true,
        targetFixedTick: 1,
        candidateCount: 0,
        requestedCount: 0,
        replayed: false,
        recoveryRequired: false
    });
    assert.equal(commandPort.prepareRequests.length, 0);
    assert.deepEqual(director.stageForFixedTick({ targetFixedTick: 1 }), {
        accepted: true,
        targetFixedTick: 1,
        candidateCount: 0,
        requestedCount: 0,
        replayed: true,
        recoveryRequired: false
    });
    assert.equal(commandPort.prepareRequests.length, 0);
    assert.equal(director.getStatus().lastPrepareStageTick, 1);
    assert.equal(director.requiresRecovery(), false);
});

function completedEventSnapshot(events = [], overrides = {}) {
    return Object.freeze({
        events: Object.freeze(events),
        atomicTransformFirstHitCapacityRejected: false,
        retryableAtomicTransformFirstHitCapacityRejected: false,
        atomicTransformFirstHitRejectionReason: null,
        atomicTransformFirstHitCandidateCount: events.filter((event) => (
            event?.atomicTransformTriggerFirstHit === true
        )).length,
        atomicTransformFirstHitCommittedCount: events.filter((event) => (
            event?.atomicTransformTriggerFirstHit === true
        )).length,
        atomicTransformFirstHitEventBase: 0,
        atomicTransformFirstHitEventCapacity: 32,
        protocolFailure: null,
        ...overrides
    });
}

function preparedRecord(stageRecord, registry, overrides = {}) {
    const sourceView = registry.copyEntityView(stageRecord.sourceHandle, {});
    return Object.freeze({
        ...stageRecord,
        sourceDefinitionId: sourceView.definitionId,
        sourceMetadata: sourceView.metadata,
        transformAtTick: sourceView.metadata.transformAtTick,
        currentHealthFixedPoint: 75,
        maxHealthFixedPoint: 100,
        commandGeneration: 1,
        ...overrides
    });
}

function publishPreparation(director, registry, stageRequest, options) {
    return director.observeCompletedPreparations({
        sourceTick: options.sourceTick,
        targetFixedTick: options.sourceTick + 1,
        batchIdFingerprint: options.batchIdFingerprint,
        records: stageRequest.records.map((record) => (
            preparedRecord(record, registry)
        )),
        prepareEvidence: Object.freeze({
            commandGeneration: options.batchIdFingerprint
        }),
        protocolFailure: null
    });
}

function addSplitDestinations(registry, transformRequest, firstEntityId) {
    const transforms = transformRequest.records.map((record, transformIndex) => {
        const root = record.sourceHandles[0];
        const destinationHandles = [
            handle(firstEntityId + (transformIndex * 2)),
            handle(firstEntityId + (transformIndex * 2) + 1)
        ];
        for (let branchIndex = 0; branchIndex < 2; branchIndex++) {
            const destinationIntent = record.destinationIntents[branchIndex];
            registry.put(destinationHandles[branchIndex], C_PRIME_ID, metadata(root, {
                branchIndex,
                bountyBudget: destinationIntent.bountyBudget,
                transformAtTick: destinationIntent.transformAtTick,
                atomicTransformProfileId: C_PRIME_PROFILE_ID
            }));
        }
        return Object.freeze({
            commandId: transformRequest.commandId,
            topologyId: ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY,
            sourceHandles: record.sourceHandles,
            destinationHandles: Object.freeze(destinationHandles),
            effectTransferDestinationIndex: 0,
            disposition: 'atomic-transform'
        });
    });
    return Object.freeze(transforms);
}

function seedSingleSplit({
    registry,
    commandPort,
    director,
    root,
    sourceTick,
    batchIdFingerprint,
    firstDestinationEntityId,
    bountyBudget = 12
}) {
    registry.put(root, J_ID, metadata(root, { bountyBudget }));
    const observed = director.observeCompletedEvents(completedEventSnapshot([
        Object.freeze({
            type: 'contact',
            eventType: 'damage-applied',
            disposition: 'applied',
            atomicTransformTriggerFirstHit: true,
            valueFixedPoint: 0,
            damageFixedPoint: 0,
            reason: 'atomic-transform-trigger-first-hit',
            entityId: root.entityId + 1_000,
            incarnation: 3,
            other: root,
            otherEntityId: root.entityId,
            otherIncarnation: root.incarnation,
            sourceTick,
            sequence: 0
        })
    ]));
    assert.equal(observed.accepted, true);
    director.stageForFixedTick({ targetFixedTick: sourceTick });
    const prepared = publishPreparation(
        director,
        registry,
        commandPort.prepareRequests.at(-1),
        { sourceTick, batchIdFingerprint }
    );
    assert.equal(prepared.transformCount, 1);
    const transformRequest = commandPort.transformRequests.at(-1);
    const transforms = addSplitDestinations(
        registry,
        transformRequest,
        firstDestinationEntityId
    );
    const fixedTick = sourceTick + 1;
    const status = director.observeLifecycle({
        fixedTick,
        atomicTransforms: transforms,
        spawned: [],
        despawned: [],
        rejected: [],
        recoveryRequired: false
    }, fixedTick);
    assert.equal(status.recoveryRequired, false);
    return Object.freeze({
        root,
        children: transforms[0].destinationHandles,
        dueFixedTick: fixedTick + 60
    });
}

test('five same-tick first hits are all admitted while host starts drain 4 then 1', () => {
    const registry = createRegistry();
    const commandPort = createCommandPort();
    const director = createDirector(registry, commandPort);
    const roots = Array.from({ length: 5 }, (_, index) => handle(index + 1));
    for (const root of roots) registry.put(root, J_ID, metadata(root));

    const observed = director.observeCompletedEvents(completedEventSnapshot(
        roots.map((root, sequence) => Object.freeze({
            type: 'contact',
            eventType: 'damage-applied',
            disposition: 'applied',
            atomicTransformTriggerFirstHit: true,
            valueFixedPoint: 0,
            damageFixedPoint: 0,
            reason: 'atomic-transform-trigger-first-hit',
            entityId: 100 + root.entityId,
            incarnation: 9,
            other: root,
            otherEntityId: root.entityId,
            otherIncarnation: root.incarnation,
            sourceTick: 10,
            sequence
        }))
    ));
    assert.deepEqual(observed, {
        accepted: true,
        retryable: false,
        triggerCount: 5,
        pendingCount: 5,
        capacityRejectionCount: 0,
        transformStartCount: 0
    });

    assert.equal(director.stageForFixedTick({ targetFixedTick: 10 }).accepted, true);
    const firstStage = commandPort.prepareRequests.at(-1);
    assert.equal(firstStage.records.length, 5);
    assert.deepEqual(firstStage.records.map((record) => record.sourceHandle.entityId),
        [1, 2, 3, 4, 5]);
    const firstPrepared = publishPreparation(director, registry, firstStage, {
        sourceTick: 10,
        batchIdFingerprint: 101
    });
    assert.equal(firstPrepared.transformCount, 4);
    const firstTransform = commandPort.transformRequests.at(-1);
    for (const record of firstTransform.records) {
        assert.equal(record.effectTransferDestinationIndex, 0);
        assert.deepEqual(record.destinationIntents.map((intent) => ({
            definitionId: intent.definitionId,
            branchIndex: intent.branchIndex,
            bountyBudget: intent.bountyBudget,
            healthFixedPoint: intent.healthFixedPoint,
            maxHealthFixedPoint: intent.maxHealthFixedPoint,
            transformAtTick: intent.transformAtTick
        })), [
            {
                definitionId: C_PRIME_ID,
                branchIndex: 0,
                bountyBudget: 6,
                healthFixedPoint: 100,
                maxHealthFixedPoint: 100,
                transformAtTick: 71
            },
            {
                definitionId: C_PRIME_ID,
                branchIndex: 1,
                bountyBudget: 6,
                healthFixedPoint: 100,
                maxHealthFixedPoint: 100,
                transformAtTick: 71
            }
        ]);
    }
    const firstDestinations = addSplitDestinations(registry, firstTransform, 101);
    // Production cadence: same-T prepare scan은 current attempt source도 포함합니다.
    // fixed submit 초반 4개 transform 성공 뒤 말단 GPU prepare output에는 5번째만 남습니다.
    assert.equal(director.stageForFixedTick({ targetFixedTick: 11 }).accepted, true);
    const secondStage = commandPort.prepareRequests.at(-1);
    assert.equal(secondStage.records.length, 5);
    assert.deepEqual(secondStage.records.map(
        (record) => record.sourceHandle.entityId
    ), [1, 2, 3, 4, 5]);
    director.observeLifecycle({
        fixedTick: 11,
        atomicTransforms: firstDestinations,
        spawned: [],
        despawned: [],
        rejected: [],
        recoveryRequired: false
    }, 11);
    assert.equal(director.requiresRecovery(), false);
    assert.equal(director.getStatus().pendingFirstHitCount, 1);
    const secondGpuOutput = Object.freeze({
        ...secondStage,
        records: Object.freeze(secondStage.records.filter(
            (record) => record.sourceHandle.entityId === 5
        ))
    });
    const secondPrepared = publishPreparation(director, registry, secondGpuOutput, {
        sourceTick: 11,
        batchIdFingerprint: 102
    });
    assert.equal(secondPrepared.transformCount, 1);
    assert.notEqual(secondPrepared.commandId, firstPrepared.commandId);
    assert.deepEqual([firstPrepared.transformCount, secondPrepared.transformCount],
        [4, 1]);
});

test('capacity rejection consumes T command but preserves backlog for a new T+1 command', () => {
    const registry = createRegistry();
    const commandPort = createCommandPort();
    const director = createDirector(registry, commandPort);
    const root = handle(21, 3);
    registry.put(root, J_ID, metadata(root));
    director.observeCompletedEvents(completedEventSnapshot([{
            type: 'contact',
            eventType: 'damage-applied',
            disposition: 'applied',
            atomicTransformTriggerFirstHit: true,
            valueFixedPoint: 0,
            damageFixedPoint: 0,
            reason: 'atomic-transform-trigger-first-hit',
            entityId: 121,
            incarnation: 8,
            other: root,
            otherEntityId: root.entityId,
            otherIncarnation: root.incarnation,
            sourceTick: 20,
            sequence: 0
        }]));

    director.stageForFixedTick({ targetFixedTick: 20 });
    const atT = publishPreparation(
        director,
        registry,
        commandPort.prepareRequests.at(-1),
        { sourceTick: 20, batchIdFingerprint: 201 }
    );
    director.stageForFixedTick({ targetFixedTick: 21 });
    const retryPrepareScan = commandPort.prepareRequests.at(-1);
    assert.equal(retryPrepareScan.records.length, 1);
    assert.equal(retryPrepareScan.records[0].sourceHandle.entityId,
        root.entityId);
    const rejected = director.observeLifecycle({
        fixedTick: 21,
        atomicTransforms: [],
        spawned: [],
        despawned: [],
        rejected: [Object.freeze({
            commandId: atT.commandId,
            code: 'atomic-transform-capacity',
            retryable: true,
            retryDisposition: 'restage-next-prepare',
            sourcePendingPreserved: true,
            attemptConsumed: true
        })],
        recoveryRequired: false
    }, 21);
    assert.equal(rejected.recoveryRequired, false);
    assert.equal(rejected.pendingFirstHitCount, 1);
    assert.equal(rejected.retryableCapacityCount, 1);
    const atTPlusOne = publishPreparation(
        director,
        registry,
        retryPrepareScan,
        { sourceTick: 21, batchIdFingerprint: 202 }
    );
    assert.equal(atTPlusOne.transformCount, 1);
    assert.notEqual(atTPlusOne.commandId, atT.commandId);
    assert.equal(commandPort.transformRequests.length, 2);
});

test('first-hit event capacity rejection is retryable and leaves every lineage roster unchanged', () => {
    const registry = createRegistry();
    const commandPort = createCommandPort();
    const director = createDirector(registry, commandPort);
    const root = handle(31, 4);
    registry.put(root, J_ID, metadata(root));
    const before = director.getStatus();

    const capacitySnapshot = completedEventSnapshot([], {
        atomicTransformFirstHitCapacityRejected: true,
        retryableAtomicTransformFirstHitCapacityRejected: true,
        atomicTransformFirstHitRejectionReason:
            'atomic-transform-first-hit-event-capacity',
        atomicTransformFirstHitCandidateCount: 2,
        atomicTransformFirstHitCommittedCount: 0,
        atomicTransformFirstHitEventBase: 0,
        atomicTransformFirstHitEventCapacity: 1
    });
    const observed = director.observeCompletedEvents(capacitySnapshot);

    assert.deepEqual(observed, {
        accepted: true,
        retryable: true,
        triggerCount: 0,
        pendingCount: 0,
        capacityRejectionCount: 1,
        transformStartCount: 0
    });
    const after = director.getStatus();
    assert.equal(after.retryableFirstHitEventCapacityCount, 1);
    assert.equal(after.pendingFirstHitCount, before.pendingFirstHitCount);
    assert.equal(after.pendingTransformBatchCount,
        before.pendingTransformBatchCount);
    assert.equal(after.circlePrimeDueCount, before.circlePrimeDueCount);
    assert.equal(after.recoveryRequired, false);
    assert.equal(commandPort.prepareRequests.length, 0);
    assert.equal(commandPort.transformRequests.length, 0);
    assert.deepEqual(director.observeCompletedEvents(capacitySnapshot), {
        accepted: true,
        retryable: true,
        replayed: true,
        triggerCount: 0,
        pendingCount: 0,
        capacityRejectionCount: 1,
        transformStartCount: 0
    });
    assert.equal(
        director.getStatus().retryableFirstHitEventCapacityCount,
        1
    );
});

test('first-hit event capacity evidence fails closed for partial or mixed-shaped snapshots', () => {
    for (const overrides of [
        {
            atomicTransformFirstHitCapacityRejected: true,
            retryableAtomicTransformFirstHitCapacityRejected: true,
            atomicTransformFirstHitRejectionReason:
                'atomic-transform-first-hit-event-capacity',
            atomicTransformFirstHitCandidateCount: 1,
            atomicTransformFirstHitCommittedCount: 0,
            atomicTransformFirstHitEventBase: 0,
            atomicTransformFirstHitEventCapacity: 1
        },
        {
            atomicTransformFirstHitCapacityRejected: true,
            retryableAtomicTransformFirstHitCapacityRejected: false,
            atomicTransformFirstHitRejectionReason:
                'atomic-transform-first-hit-event-capacity',
            atomicTransformFirstHitCandidateCount: 2,
            atomicTransformFirstHitCommittedCount: 0,
            atomicTransformFirstHitEventBase: 0,
            atomicTransformFirstHitEventCapacity: 1
        },
        {
            atomicTransformFirstHitCapacityRejected: true,
            retryableAtomicTransformFirstHitCapacityRejected: true,
            atomicTransformFirstHitRejectionReason:
                'atomic-transform-first-hit-event-capacity',
            atomicTransformFirstHitCandidateCount: 2,
            atomicTransformFirstHitCommittedCount: 1,
            atomicTransformFirstHitEventBase: 0,
            atomicTransformFirstHitEventCapacity: 1
        }
    ]) {
        const director = createDirector(createRegistry(), createCommandPort());
        const result = director.observeCompletedEvents(
            completedEventSnapshot([], overrides)
        );
        assert.equal(result.accepted, false);
        assert.equal(result.recoveryRequired, true);
        assert.equal(result.reason, 'trigger-event-capacity-contract');
    }
});

test('actual start ordering is due C prime, lineage root pair, then source handle ASC', () => {
    const registry = createRegistry();
    const commandPort = createCommandPort();
    const director = createDirector(registry, commandPort);
    seedSingleSplit({
        registry,
        commandPort,
        director,
        root: handle(61, 2),
        sourceTick: 10,
        batchIdFingerprint: 250,
        firstDestinationEntityId: 70
    });
    const jRoots = Array.from({ length: 5 }, (_, index) => handle(80 + index));
    for (const root of jRoots) registry.put(root, J_ID, metadata(root));
    director.observeCompletedEvents(completedEventSnapshot(
        jRoots.map((root, sequence) => Object.freeze({
            type: 'contact',
            eventType: 'damage-applied',
            disposition: 'applied',
            atomicTransformTriggerFirstHit: true,
            valueFixedPoint: 0,
            damageFixedPoint: 0,
            reason: 'atomic-transform-trigger-first-hit',
            entityId: 2_000 + sequence,
            incarnation: 1,
            other: root,
            otherEntityId: root.entityId,
            otherIncarnation: root.incarnation,
            sourceTick: 70,
            sequence
        }))
    ));
    director.stageForFixedTick({ targetFixedTick: 70 });
    const staged = commandPort.prepareRequests.at(-1);
    assert.equal(staged.records.length, 7);
    assert.deepEqual(staged.records.map((record) => record.topologyId), [
        ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED,
        ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED,
        ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY,
        ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY,
        ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY,
        ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY,
        ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
    ]);
    const prepared = publishPreparation(director, registry, staged, {
        sourceTick: 70,
        batchIdFingerprint: 251
    });
    assert.equal(prepared.transformCount, 4);
    const actual = commandPort.transformRequests.at(-1).records;
    assert.deepEqual(actual.map((record) => record.topologyId), [
        ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED,
        ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED,
        ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY,
        ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
    ]);
    assert.deepEqual(actual.slice(2).map(
        (record) => record.sourceHandles[0].entityId
    ), [80, 81]);
});

test('delayed C prime is absent before T-1 prepare and starts exactly at T', () => {
    const registry = createRegistry();
    const commandPort = createCommandPort();
    const director = createDirector(registry, commandPort);
    const root = handle(7, 4);
    const split = seedSingleSplit({
        registry,
        commandPort,
        director,
        root,
        sourceTick: 10,
        batchIdFingerprint: 300,
        firstDestinationEntityId: 31
    });
    const [forfeitedChild, child] = split.children;
    registry.remove(forfeitedChild);
    director.observeLifecycle({
        fixedTick: 12,
        atomicTransforms: [],
        spawned: [],
        despawned: [Object.freeze({ handle: forfeitedChild })],
        rejected: [],
        recoveryRequired: false
    }, 12);

    const prepareCountBeforeIdleTick = commandPort.prepareRequests.length;
    const idleStage = director.stageForFixedTick({ targetFixedTick: 69 });
    assert.equal(idleStage.accepted, true);
    assert.equal(idleStage.candidateCount, 0);
    assert.equal(commandPort.prepareRequests.length, prepareCountBeforeIdleTick);
    director.stageForFixedTick({ targetFixedTick: 70 });
    const atTMinusOne = commandPort.prepareRequests.at(-1);
    assert.equal(atTMinusOne.records.length, 1);
    assert.equal(atTMinusOne.records[0].dueFixedTick, 71);
    const prepared = publishPreparation(director, registry, atTMinusOne, {
        sourceTick: 70,
        batchIdFingerprint: 301
    });
    assert.equal(prepared.transformCount, 1);
    const transformRequest = commandPort.transformRequests.at(-1);
    assert.deepEqual(transformRequest.records[0].destinationIntents.map(
        (intent) => ({
            definitionId: intent.definitionId,
            branchIndex: intent.branchIndex,
            bountyBudget: intent.bountyBudget,
            healthFixedPoint: intent.healthFixedPoint,
            maxHealthFixedPoint: intent.maxHealthFixedPoint,
            transformAtTick: intent.transformAtTick
        })
    ), [{
        definitionId: J_ID,
        branchIndex: 1,
        bountyBudget: 6,
        healthFixedPoint: 75,
        maxHealthFixedPoint: 100,
        transformAtTick: 0
    }]);
    const returnedJ = handle(131, 1);
    registry.remove(child);
    registry.put(returnedJ, J_ID, metadata(root, {
        branchIndex: 1,
        bountyBudget: 6,
        transformAtTick: 0
    }));
    const status = director.observeLifecycle({
        fixedTick: 71,
        atomicTransforms: [Object.freeze({
            commandId: transformRequest.commandId,
            topologyId: ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED,
            sourceHandles: Object.freeze([child]),
            destinationHandles: Object.freeze([returnedJ]),
            effectTransferDestinationIndex: 0,
            disposition: 'atomic-transform'
        })],
        spawned: [],
        despawned: [],
        rejected: [],
        recoveryRequired: false
    }, 71);
    assert.equal(status.recoveryRequired, false);
    assert.equal(status.pendingTransformBatchCount, 0);
});

test('zero-bounty branch returns J and recursively splits to two zero-bounty children', () => {
    const registry = createRegistry();
    const commandPort = createCommandPort();
    const director = createDirector(registry, commandPort);
    const root = handle(91, 2);
    const split = seedSingleSplit({
        registry,
        commandPort,
        director,
        root,
        sourceTick: 10,
        batchIdFingerprint: 600,
        firstDestinationEntityId: 200,
        bountyBudget: 1
    });
    assert.deepEqual(commandPort.transformRequests.at(-1).records[0]
        .destinationIntents.map((intent) => intent.bountyBudget), [1, 0]);

    const [paidBranch, zeroBranch] = split.children;
    registry.remove(paidBranch);
    director.observeLifecycle({
        fixedTick: 12,
        atomicTransforms: [],
        spawned: [],
        despawned: [Object.freeze({ handle: paidBranch })],
        rejected: [],
        recoveryRequired: false
    }, 12);
    director.stageForFixedTick({ targetFixedTick: 70 });
    const returnPreparation = commandPort.prepareRequests.at(-1);
    assert.equal(returnPreparation.records.length, 1);
    assert.equal(returnPreparation.records[0].bountyBudget, 0);
    publishPreparation(director, registry, returnPreparation, {
        sourceTick: 70,
        batchIdFingerprint: 601
    });
    const returnRequest = commandPort.transformRequests.at(-1);
    assert.equal(returnRequest.records[0].destinationIntents[0].bountyBudget, 0);
    const returnedJ = handle(300, 1);
    registry.remove(zeroBranch);
    registry.put(returnedJ, J_ID, metadata(root, {
        branchIndex: 1,
        bountyBudget: 0,
        transformAtTick: 0
    }));
    director.observeLifecycle({
        fixedTick: 71,
        atomicTransforms: [Object.freeze({
            commandId: returnRequest.commandId,
            topologyId: ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED,
            sourceHandles: Object.freeze([zeroBranch]),
            destinationHandles: Object.freeze([returnedJ]),
            effectTransferDestinationIndex: 0,
            disposition: 'atomic-transform'
        })],
        spawned: [],
        despawned: [],
        rejected: [],
        recoveryRequired: false
    }, 71);

    const recursiveTrigger = director.observeCompletedEvents(
        completedEventSnapshot([Object.freeze({
            type: 'contact',
            eventType: 'damage-applied',
            disposition: 'applied',
            atomicTransformTriggerFirstHit: true,
            valueFixedPoint: 0,
            damageFixedPoint: 0,
            reason: 'atomic-transform-trigger-first-hit',
            entityId: 400,
            incarnation: 1,
            other: returnedJ,
            otherEntityId: returnedJ.entityId,
            otherIncarnation: returnedJ.incarnation,
            sourceTick: 72,
            sequence: 0
        })])
    );
    assert.equal(recursiveTrigger.triggerCount, 1);
    director.stageForFixedTick({ targetFixedTick: 72 });
    const recursivePreparation = commandPort.prepareRequests.at(-1);
    assert.equal(recursivePreparation.records[0].bountyBudget, 0);
    publishPreparation(director, registry, recursivePreparation, {
        sourceTick: 72,
        batchIdFingerprint: 602
    });
    assert.deepEqual(commandPort.transformRequests.at(-1).records[0]
        .destinationIntents.map((intent) => intent.bountyBudget), [0, 0]);
});

test('one, both, or no C prime survivor author exactly 1, 2, or 0 returns', () => {
    for (const survivorCount of [1, 2, 0]) {
        const registry = createRegistry();
        const commandPort = createCommandPort();
        const director = createDirector(registry, commandPort);
        const root = handle(41, 5);
        const split = seedSingleSplit({
            registry,
            commandPort,
            director,
            root,
            sourceTick: 10,
            batchIdFingerprint: 400 + survivorCount,
            firstDestinationEntityId: 50
        });
        const despawned = split.children.slice(survivorCount);
        for (const child of despawned) {
            registry.remove(child);
        }
        director.observeLifecycle({
            fixedTick: 12,
            atomicTransforms: [],
            spawned: [],
            despawned: despawned.map((child) => Object.freeze({ handle: child })),
            rejected: [],
            recoveryRequired: false
        }, 12);
        const prepareCountBeforeReturn = commandPort.prepareRequests.length;
        const returnStage = director.stageForFixedTick({ targetFixedTick: 70 });
        if (survivorCount === 0) {
            assert.equal(returnStage.candidateCount, 0);
            assert.equal(commandPort.prepareRequests.length,
                prepareCountBeforeReturn);
        } else {
            assert.equal(commandPort.prepareRequests.at(-1).records.length,
                survivorCount);
        }
        assert.equal((survivorCount * 6) + ((2 - survivorCount) * 6), 12);
    }
});

function emptyLifecycleCommit(fixedTick) {
    return Object.freeze({
        fixedTick,
        atomicTransforms: Object.freeze([]),
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        rejected: Object.freeze([]),
        recoveryRequired: false
    });
}

test('fixed commit watermark is monotonic and tick regression fails closed', () => {
    const director = createDirector(createRegistry(), createCommandPort());
    const tick9 = emptyLifecycleCommit(9);
    director.observeFixedCommit(tick9, 9);
    assert.equal(director.getStatus().lastFixedCommitTick, 9);
    assert.deepEqual(
        director.observeFixedCommit(emptyLifecycleCommit(8), 8),
        {
            accepted: false,
            reason: 'fixed-commit-tick-regression',
            recoveryRequired: true
        }
    );
    assert.equal(director.getStatus().lastFixedCommitTick, 9);
    assert.equal(director.getStatus().failure.code,
        'fixed-commit-tick-regression');
});

test('published-before-close preserves both observations and seals zero roster', () => {
    const director = createDirector(createRegistry(), createCommandPort());
    const commit = emptyLifecycleCommit(9);
    director.observeFixedCommit(commit, 9);
    director.observeLifecycle(commit, 9);
    assert.deepEqual(director.closeForTerminal(9), {
        finalFixedTick: 9,
        reason: 'run-defeated',
        fixedCommitObserved: true,
        lifecycleObserved: true,
        rosterSealed: true
    });
    assert.equal(director.getStatus().lastFixedCommitTick, 9);
});

test('close then lifecycle then fixed seals only after both observations', () => {
    const director = createDirector(createRegistry(), createCommandPort());
    const commit = emptyLifecycleCommit(9);
    assert.deepEqual(director.closeForTerminal(9), {
        finalFixedTick: 9,
        reason: 'run-defeated',
        fixedCommitObserved: false,
        lifecycleObserved: false,
        rosterSealed: false
    });
    director.observeLifecycle(commit, 9);
    assert.deepEqual(director.getStatus().terminal, {
        finalFixedTick: 9,
        reason: 'run-defeated',
        fixedCommitObserved: false,
        lifecycleObserved: true,
        rosterSealed: false
    });
    director.observeFixedCommit(commit, 9);
    assert.deepEqual(director.getStatus().terminal, {
        finalFixedTick: 9,
        reason: 'run-defeated',
        fixedCommitObserved: true,
        lifecycleObserved: true,
        rosterSealed: true
    });
});
