import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { WorldRegistry } = await loadGameModule(
    'ingame/object/world_registry.js'
);
const {
    FormationRuntimeDirector
} = await loadGameModule('ingame/object/enemy/formation_runtime_director.js');
const {
    BASIC_HEXA_ENEMY_DATA,
    mergeBasicHexaHealthCenti
} = await loadGameModule('data/object/enemy/basic_hexa_enemy_data.js');
const {
    ENEMY_LIFECYCLE_DISPOSITION_ID
} = await loadGameModule(
    'ingame/contract/enemy_lifecycle_disposition_contract.js'
);
const {
    ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID
} = await loadGameModule(
    'ingame/contract/enemy_atomic_transform_contract.js'
);
const {
    createFormationLineageHash
} = await loadGameModule('ingame/contract/enemy_formation_contract.js');
const {
    createGpuEnemySpawnIntent,
    createGpuPrivateHexaTransformDestinationIntent,
    materializeNaturalHexaFormationActivation
} = await loadGameModule('ingame/object/enemy/gpu_enemy_spawn_adapter.js');
const {
    createGpuRegistryMetadata
} = await loadGameModule('ingame/object/gpu_spawn_intent.js');
const {
    encodeGpuCircleBodyFixedPoint
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');

const ROUTE = Object.freeze({
    gateId: 'formation-host-gate',
    pathId: 'formation-host-path',
    waypoints: Object.freeze([
        Object.freeze({ x: 1, y: 1 }),
        Object.freeze({ x: 2, y: 1 })
    ])
});

function activateNaturalH(registry, spawnSequence, createdAtTick = 1) {
    const intent = createGpuEnemySpawnIntent({
        definition: BASIC_HEXA_ENEMY_DATA,
        route: ROUTE,
        spawnSequence,
        waveId: 'formation-host-wave'
    });
    const handle = registry.reserveEntity({
        kindId: 'enemy',
        definitionId: BASIC_HEXA_ENEMY_DATA.id,
        createdAtTick
    });
    assert.ok(handle);
    const activation = materializeNaturalHexaFormationActivation(intent, handle);
    assert.equal(
        registry.activateReserved(handle, createGpuRegistryMetadata(activation)),
        true
    );
    return Object.freeze({
        handle,
        activation,
        healthCenti: encodeGpuCircleBodyFixedPoint(activation.health)
    });
}

function lifecycleCommit(
    fixedTick,
    spawned = [],
    despawned = [],
    rejected = [],
    atomicTransforms = []
) {
    return Object.freeze({
        fixedTick,
        state: 'committed',
        spawned: Object.freeze(spawned),
        despawned: Object.freeze(despawned),
        rejected: Object.freeze(rejected),
        atomicTransforms: Object.freeze(atomicTransforms),
        recoveryRequired: false
    });
}

function createCommandHarness() {
    const prepareRequests = [];
    const transformRequests = [];
    let prepareMode = 'accept';
    return {
        prepareRequests,
        transformRequests,
        setPrepareMode(mode) { prepareMode = mode; },
        port: Object.freeze({
            requestPrepareBatch(request) {
                prepareRequests.push(request);
                if (prepareMode === 'reject') {
                    return Object.freeze({
                        accepted: false,
                        requiresRecovery: false,
                        reason: 'formation-prepare-capacity'
                    });
                }
                return Object.freeze({
                    accepted: true,
                    targetFixedTick: request.targetFixedTick,
                    stagedCount: request.records.length,
                    batchIdFingerprint: 101 + request.targetFixedTick,
                    replayed: false,
                    requiresRecovery: false
                });
            },
            requestPreparedTransformBatch(request) {
                transformRequests.push(request);
                return Object.freeze({
                    accepted: true,
                    commandId: request.commandId,
                    transformCount: request.records.length,
                    requiresRecovery: false
                });
            },
            discardPreparedBatch() {
                return Object.freeze({ accepted: true, requiresRecovery: false });
            }
        })
    };
}

function preparedSource(source, destination, partner) {
    const metadata = source.activation;
    return Object.freeze({
        sourceEntityId: source.handle.entityId,
        sourceIncarnation: source.handle.incarnation,
        definitionCode: metadata.formationDefinitionCode,
        coordinateSystemCode: metadata.formationCoordinateSystemCode,
        policyCode: metadata.formationPolicyCode,
        memberCount: metadata.formationMemberCount,
        occupiedSlotMask: metadata.formationOccupiedSlotMask,
        rotationStep: metadata.formationRotationStep,
        generation: metadata.formationGeneration,
        lineageHash: metadata.formationLineageHash,
        currentHealthCenti: source.healthCenti,
        maxHealthCenti: source.healthCenti,
        pairSourceEntityId: partner.handle.entityId,
        pairSourceIncarnation: partner.handle.incarnation,
        destinationMemberCount: 2,
        destinationOccupiedSlotMask: 0b000011,
        destinationRotationStep: 0,
        expectedMergedCurrentHealthCenti: destination.currentHealthCenti,
        expectedMergedMaxHealthCenti: destination.maxHealthCenti
    });
}

test('Formation roster는 accepted prepare에서만 sequence를 전진하고 rejected retry identity를 보존한다', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({ capacity: 4, atomicTransformAuthority: authority });
    const left = activateNaturalH(registry, 1);
    const right = activateNaturalH(registry, 2);
    const harness = createCommandHarness();
    const director = new FormationRuntimeDirector({
        registry,
        formationCommandPort: harness.port,
        sessionGeneration: 7,
        capacity: 4,
        prepareCadenceTicks: 1
    });
    director.observeLifecycle(lifecycleCommit(1, [
        Object.freeze({ handle: left.handle }),
        Object.freeze({ handle: right.handle })
    ]), 1);
    assert.equal(director.getStatus().activeGroupCount, 2);
    assert.equal(director.getMemberCount(left.handle), 1);
    assert.equal(director.hasExactMember(left.handle, left.handle), true);

    const first = director.stageForFixedTick({ targetFixedTick: 2 });
    assert.equal(first.accepted, true);
    assert.deepEqual(
        Array.from(
            harness.prepareRequests[0].records,
            ({ prepareSequence }) => prepareSequence
        ),
        [0, 0]
    );
    assert.equal(director.stageForFixedTick({ targetFixedTick: 2 }).replayed, true);
    assert.equal(harness.prepareRequests.length, 1);

    harness.setPrepareMode('reject');
    const rejected = director.stageForFixedTick({ targetFixedTick: 3 });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.requiresRecovery, false);
    assert.deepEqual(
        Array.from(
            harness.prepareRequests[1].records,
            ({ prepareSequence }) => prepareSequence
        ),
        [1, 1]
    );
    harness.setPrepareMode('accept');
    assert.equal(director.stageForFixedTick({ targetFixedTick: 4 }).accepted, true);
    assert.deepEqual(
        Array.from(
            harness.prepareRequests[2].records,
            ({ prepareSequence }) => prepareSequence
        ),
        [1, 1],
        'rejected batch는 sequence를 소비하지 않는다'
    );
    assert.equal(director.requiresRecovery(), false);
});

test('대규모 H roster prepare는 bounded overlapping round-robin batch로 전수 순회한다', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({
        capacity: 8,
        atomicTransformAuthority: authority
    });
    const sources = Array.from({ length: 8 }, (_, index) => (
        activateNaturalH(registry, index + 1)
    ));
    const harness = createCommandHarness();
    const director = new FormationRuntimeDirector({
        registry,
        formationCommandPort: harness.port,
        sessionGeneration: 71,
        capacity: 8,
        maximumPrepareRecordsPerFixedTick: 3,
        prepareCadenceTicks: 1
    });
    director.observeLifecycle(lifecycleCommit(
        1,
        sources.map(({ handle }) => Object.freeze({ handle }))
    ), 1);

    const observed = new Set();
    for (let tick = 2; tick <= 5; tick++) {
        const staged = director.stageForFixedTick({ targetFixedTick: tick });
        assert.equal(staged.accepted, true);
        const records = harness.prepareRequests.at(-1).records;
        assert.equal(records.length, 3);
        for (const { sourceHandle } of records) {
            observed.add(`${sourceHandle.entityId}:${sourceHandle.incarnation}`);
        }
    }
    assert.equal(observed.size, 8);
    assert.equal(director.getStatus().maximumPrepareRecordsPerFixedTick, 3);
    assert.equal(director.requiresRecovery(), false);
});

test('Formation prepare cadence는 비대상 tick을 bounded no-op으로 넘기고 경계 tick만 stage한다', () => {
    const registry = new WorldRegistry({
        capacity: 2,
        atomicTransformAuthority: Object.freeze({})
    });
    const left = activateNaturalH(registry, 1);
    const right = activateNaturalH(registry, 2);
    const harness = createCommandHarness();
    const director = new FormationRuntimeDirector({
        registry,
        formationCommandPort: harness.port,
        sessionGeneration: 74,
        capacity: 2
    });
    director.observeLifecycle(lifecycleCommit(1, [
        Object.freeze({ handle: left.handle }),
        Object.freeze({ handle: right.handle })
    ]), 1);

    const deferred = director.stageForFixedTick({ targetFixedTick: 2 });
    assert.deepEqual({ ...deferred }, {
        accepted: true,
        targetFixedTick: 2,
        stagedCount: 0,
        cadenceDeferred: true,
        replayed: false
    });
    assert.equal(
        director.stageForFixedTick({ targetFixedTick: 2 }).replayed,
        true
    );
    assert.equal(harness.prepareRequests.length, 0);

    const staged = director.stageForFixedTick({ targetFixedTick: 4 });
    assert.equal(staged.accepted, true);
    assert.equal(staged.stagedCount, 2);
    assert.equal(harness.prepareRequests.length, 1);
    assert.equal(director.getStatus().prepareCadenceTicks, 4);
});

test('J/C′ atomic transform lifecycle은 독립 Formation roster를 오염시키지 않는다', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({
        capacity: 4,
        atomicTransformAuthority: authority
    });
    const hexa = activateNaturalH(registry, 1);
    const director = new FormationRuntimeDirector({
        registry,
        formationCommandPort: createCommandHarness().port,
        sessionGeneration: 72,
        capacity: 4
    });
    director.observeLifecycle(lifecycleCommit(1, [
        Object.freeze({ handle: hexa.handle })
    ]), 1);

    const parentCommandId = 'jorang-atomic-transform:1:561:443448905';
    const sourceHandle = Object.freeze({ entityId: 10, incarnation: 1 });
    const destinationHandles = Object.freeze([
        Object.freeze({ entityId: 10, incarnation: 2 }),
        Object.freeze({ entityId: 5, incarnation: 39 })
    ]);
    const topologyId = ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY;
    director.observeLifecycle(lifecycleCommit(2, [
        Object.freeze({
            commandId: `${parentCommandId}:transform:0:destination:0`,
            parentCommandId,
            handle: destinationHandles[0],
            transform: true,
            topologyId,
            transformIndex: 0,
            destinationIndex: 0
        }),
        Object.freeze({
            commandId: `${parentCommandId}:transform:0:destination:1`,
            parentCommandId,
            handle: destinationHandles[1],
            transform: true,
            topologyId,
            transformIndex: 0,
            destinationIndex: 1
        })
    ], [
        Object.freeze({
            commandId: `${parentCommandId}:transform:0:source:0`,
            parentCommandId,
            handle: sourceHandle,
            reason: 'atomic-transform',
            bountyEligible: false,
            transformedInto: destinationHandles[0],
            transformedIntoHandles: destinationHandles
        })
    ], [], [
        Object.freeze({
            commandId: parentCommandId,
            topologyId,
            sourceHandles: Object.freeze([sourceHandle]),
            destinationHandles,
            effectTransferDestinationIndex: 0,
            disposition: 'atomic-transform'
        })
    ]), 2);

    const status = director.getStatus();
    assert.equal(status.recoveryRequired, false);
    assert.equal(status.failure, null);
    assert.equal(status.lastObservedFixedTick, 2);
    assert.equal(status.activeGroupCount, 1);
    assert.equal(status.totalOriginalMemberCount, 1);
    assert.equal(director.hasExactMember(hexa.handle, hexa.handle), true);
});

test('미등록 MANY_TO_ONE parent는 topology routing 뒤에도 fail-close한다', () => {
    const registry = new WorldRegistry({
        capacity: 2,
        atomicTransformAuthority: Object.freeze({})
    });
    const hexa = activateNaturalH(registry, 1);
    const director = new FormationRuntimeDirector({
        registry,
        formationCommandPort: createCommandHarness().port,
        sessionGeneration: 73,
        capacity: 2
    });
    director.observeLifecycle(lifecycleCommit(1, [
        Object.freeze({ handle: hexa.handle })
    ]), 1);

    const parentCommandId = 'formation-transform:73:2:forged';
    const destinationHandle = Object.freeze({ entityId: 2, incarnation: 2 });
    director.observeLifecycle(lifecycleCommit(2, [Object.freeze({
        commandId: `${parentCommandId}:transform:0:spawn`,
        parentCommandId,
        handle: destinationHandle,
        transform: true
    })], [], [], [Object.freeze({
        commandId: parentCommandId,
        topologyId: ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.MANY_TO_ONE,
        sourceHandles: Object.freeze([
            hexa.handle,
            Object.freeze({ entityId: 2, incarnation: 1 })
        ]),
        destinationHandles: Object.freeze([destinationHandle]),
        effectTransferDestinationIndex: 0,
        disposition: 'atomic-transform'
    })]), 2);

    const status = director.getStatus();
    assert.equal(status.recoveryRequired, true);
    assert.equal(status.failure?.code, 'lifecycle-preflight');
    assert.match(status.failure?.detail ?? '', /unknown transform spawn parent/);
    assert.equal(status.activeGroupCount, 1);
    assert.equal(director.hasExactMember(hexa.handle, hexa.handle), true);
});

test('two-source exact lineage는 prepare→privileged lifecycle→destination SoA까지 보존된다', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({ capacity: 2, atomicTransformAuthority: authority });
    const left = activateNaturalH(registry, 1);
    const right = activateNaturalH(registry, 2);
    const harness = createCommandHarness();
    const director = new FormationRuntimeDirector({
        registry,
        formationCommandPort: harness.port,
        sessionGeneration: 8,
        capacity: 2
    });
    director.observeLifecycle(lifecycleCommit(1, [
        Object.freeze({ handle: left.handle }),
        Object.freeze({ handle: right.handle })
    ]), 1);
    const mergedHealth = mergeBasicHexaHealthCenti({
        sourceACurrentHealthCenti: left.healthCenti,
        sourceAMaxHealthCenti: left.healthCenti,
        sourceBCurrentHealthCenti: right.healthCenti,
        sourceBMaxHealthCenti: right.healthCenti
    });
    const prepared = director.observeCompletedPreparations({
        sourceTick: 10,
        targetFixedTick: 11,
        batchIdFingerprint: 777,
        pairs: Object.freeze([Object.freeze({
            left: preparedSource(left, mergedHealth, right),
            right: preparedSource(right, mergedHealth, left)
        })])
    });
    assert.equal(prepared.accepted, true);
    assert.equal(prepared.transformCount, 1);
    const requested = harness.transformRequests[0];
    assert.deepEqual(
        Array.from(requested.records[0].sourceHandles),
        [left.handle, right.handle]
    );
    assert.deepEqual(
        Array.from(
            requested.records[0].sourceLineages,
            (lineage) => Array.from(lineage)
        ),
        [[left.handle], [right.handle]]
    );
    const combinedLineage = [left.handle, right.handle];
    assert.equal(
        requested.records[0].destinationDescriptor.formationLineageHash,
        createFormationLineageHash(combinedLineage)
    );

    const descriptor = requested.records[0].destinationDescriptor;
    const rootView = registry.copyEntityView(left.handle, {});
    const preflight = registry.preflightAtomicTransformBatch({
        transforms: [{
            sourceHandles: [left.handle, right.handle],
            destination: {
                kindId: 'enemy',
                definitionId: 'basic_hexa_group_01',
                createdAtTick: 11,
                metadata: null
            }
        }]
    }, authority);
    const destinationIntent = createGpuPrivateHexaTransformDestinationIntent({
        ...descriptor,
        sourceRootView: rootView,
        destinationHandle: preflight.transforms[0].destinationHandle
    });
    registry.cancelAtomicTransformBatch(preflight.token, authority);
    const publishPlan = registry.preflightAtomicTransformBatch({
        transforms: [{
            sourceHandles: [left.handle, right.handle],
            destination: {
                kindId: destinationIntent.kindId,
                definitionId: destinationIntent.definitionId,
                createdAtTick: 11,
                metadata: createGpuRegistryMetadata(destinationIntent)
            }
        }]
    }, authority);
    const published = registry.commitAtomicTransformBatch(publishPlan.token, authority);
    const destinationHandle = published.transforms[0].destinationHandle;
    const parent = prepared.commandId;
    const disposition = ENEMY_LIFECYCLE_DISPOSITION_ID.MERGE_CONSUMED;
    const commit = lifecycleCommit(11, [Object.freeze({
        commandId: `${parent}:transform:0:spawn`,
        parentCommandId: parent,
        handle: destinationHandle,
        transform: true
    })], [
        Object.freeze({
            commandId: `${parent}:transform:0:source:0`,
            parentCommandId: parent,
            handle: left.handle,
            reason: 'formation-transform',
            disposition,
            bountyEligible: false,
            transformedInto: destinationHandle
        }),
        Object.freeze({
            commandId: `${parent}:transform:0:source:1`,
            parentCommandId: parent,
            handle: right.handle,
            reason: 'formation-transform',
            disposition,
            bountyEligible: false,
            transformedInto: destinationHandle
        })
    ], [], [Object.freeze({
        commandId: parent,
        topologyId: ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.MANY_TO_ONE,
        sourceHandles: Object.freeze([left.handle, right.handle]),
        destinationHandles: Object.freeze([destinationHandle]),
        effectTransferDestinationIndex: 0,
        disposition: 'atomic-transform'
    })]);
    director.observeLifecycle(commit, 11);
    assert.equal(director.requiresRecovery(), false);
    assert.equal(director.getStatus().activeGroupCount, 1);
    assert.equal(director.getMemberCount(destinationHandle), 2);
    assert.equal(director.hasExactMember(destinationHandle, left.handle), true);
    assert.equal(director.hasExactMember(destinationHandle, right.handle), true);
    assert.deepEqual(
        director.copyExactMemberHandleAt(destinationHandle, 0, {}),
        { ...left.handle }
    );
    assert.deepEqual(
        director.copyExactMemberHandleAt(destinationHandle, 1, {}),
        { ...right.handle }
    );
    assert.equal(director.getMemberCount(left.handle), 0);
    assert.equal(director.getMemberCount(right.handle), 0);
});

test('forged transform child provenance는 roster mutation 전에 fail-close한다', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({ capacity: 2, atomicTransformAuthority: authority });
    const left = activateNaturalH(registry, 1);
    const right = activateNaturalH(registry, 2);
    const harness = createCommandHarness();
    const director = new FormationRuntimeDirector({
        registry,
        formationCommandPort: harness.port,
        sessionGeneration: 9,
        capacity: 2
    });
    director.observeLifecycle(lifecycleCommit(1, [
        Object.freeze({ handle: left.handle }),
        Object.freeze({ handle: right.handle })
    ]), 1);
    const before = director.getStatus();
    director.observeLifecycle(lifecycleCommit(2, [], [Object.freeze({
        commandId: 'raw-forged-transform',
        handle: left.handle,
        reason: 'formation-transform',
        disposition: ENEMY_LIFECYCLE_DISPOSITION_ID.MERGE_CONSUMED,
        bountyEligible: false
    })]), 2);
    assert.equal(director.requiresRecovery(), true);
    assert.equal(director.getStatus().activeGroupCount, before.activeGroupCount);
    assert.equal(director.hasExactMember(left.handle, left.handle), true);
    assert.equal(director.hasExactMember(right.handle, right.handle), true);
});

test('GPU-world replacement는 old Formation director roster를 폐기하고 fresh roster를 empty로 시작한다', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({
        capacity: 2,
        atomicTransformAuthority: authority
    });
    const left = activateNaturalH(registry, 1);
    const right = activateNaturalH(registry, 2);
    const director = new FormationRuntimeDirector({
        registry,
        formationCommandPort: createCommandHarness().port,
        sessionGeneration: 10,
        capacity: 2
    });
    director.observeLifecycle(lifecycleCommit(1, [
        Object.freeze({ handle: left.handle }),
        Object.freeze({ handle: right.handle })
    ]), 1);
    assert.equal(director.getStatus().activeGroupCount, 2);

    director.destroy();
    const destroyed = director.getStatus();
    assert.equal(destroyed.destroyed, true);
    assert.equal(destroyed.activeGroupCount, 0);
    assert.equal(destroyed.activeHiveCount, 0);
    assert.equal(destroyed.totalOriginalMemberCount, 0);
    assert.equal(destroyed.pendingTransformBatchCount, 0);
    assert.equal(destroyed.recoveryRequired, false);
    assert.deepEqual(
        { ...director.stageForFixedTick({ targetFixedTick: 2 }) },
        {
            accepted: false,
            reason: 'formation-unavailable'
        }
    );

    const replacementRegistry = new WorldRegistry({
        capacity: 2,
        atomicTransformAuthority: Object.freeze({})
    });
    const replacement = new FormationRuntimeDirector({
        registry: replacementRegistry,
        formationCommandPort: createCommandHarness().port,
        sessionGeneration: 11,
        capacity: 2
    });
    const fresh = replacement.getStatus();
    assert.equal(fresh.destroyed, false);
    assert.equal(fresh.activeGroupCount, 0);
    assert.equal(fresh.activeHiveCount, 0);
    assert.equal(fresh.totalOriginalMemberCount, 0);
    assert.equal(fresh.pendingTransformBatchCount, 0);
    assert.equal(fresh.recoveryRequired, false);
});

console.log('FormationRuntimeDirector host contract: ok');
