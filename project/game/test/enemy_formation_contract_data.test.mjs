import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    BASIC_ARROW_ENEMY_DATA,
    BASIC_HEXA_ENEMY_DATA,
    BASIC_PENTA_ENEMY_DATA,
    BASIC_RHOM_ENEMY_DATA,
    BASIC_SQUARE_ENEMY_DATA,
    BASIC_TRIANGLE_ENEMY_DATA,
    INGAME_ENEMY_DEFINITION_BY_ID,
    INGAME_ENEMY_DEFINITIONS
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    BASIC_HEXA_ENEMY_DEFINITION_ID,
    BASIC_HEXA_FORMATION_CAPABILITY_IDS,
    BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID,
    BASIC_HEXA_HIVE_CAPABILITY_IDS,
    BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID,
    BASIC_HEXA_RAW_STATS_BY_MEMBER_COUNT,
    mergeBasicHexaHealthCenti,
    resolveBasicHexaFormationStats,
    resolveBasicHexaTransformPrivateDefinition
} = await loadGameModule('data/object/enemy/basic_hexa_enemy_data.js');
const {
    ENEMY_FORMATION_CATALOG,
    GPU_ENEMY_FORMATION_DEFINITION_CODE,
    HEXA_HIVE_SIX_RING_FORMATION_DEFINITION,
    HEXA_HIVE_SIX_RING_FORMATION_DEFINITION_ID
} = await loadGameModule('data/object/enemy/enemy_formation_catalog_data.js');
const {
    ENEMY_FORMATION_POLICY,
    ENEMY_FORMATION_POLICY_CODE,
    FORMATION_ATOMIC_TRANSFORM_METHOD,
    FORMATION_COORDINATE_SYSTEM,
    FORMATION_COORDINATE_SYSTEM_CODE,
    FORMATION_COORDINATE_SYSTEM_METHOD,
    FORMATION_JOIN_CANDIDATE_FIELDS,
    FORMATION_MEMBERSHIP_METHOD,
    FORMATION_MOTION_POLICY_METHOD,
    FORMATION_SLOT_GRAPH_METHOD,
    assertFormationAtomicTransform,
    assertFormationCoordinateSystem,
    assertFormationMembership,
    assertFormationMotionPolicy,
    assertFormationSlotGraph,
    acceptsFormationRouteProgress,
    compareFormationJoinCandidates,
    createFormationIdFromExactHandle,
    createFormationLineageHash,
    isConnectedFormationOccupancyMask,
    resolvePositive60FormationSlotIndex,
    rotateHexAxialCoordinatePositive60
} = await loadGameModule('ingame/contract/enemy_formation_contract.js');
const {
    ENEMY_CAPABILITY_ID
} = await loadGameModule('ingame/contract/enemy_capability_contract.js');
const {
    ENEMY_SPAWN_POLICY,
    normalizeEnemyDefinition,
    resolveEnemyDefinitionProfiles
} = await loadGameModule('ingame/contract/enemy_profile_contract.js');
const {
    ENEMY_PROFILE_CATALOG
} = await loadGameModule('data/object/enemy/enemy_profile_catalog_data.js');
const {
    GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY,
    GPU_ENEMY_FORMATION_ATOMIC_TRANSFORM_PORT,
    GPU_ENEMY_FORMATION_MEMBERSHIP_PORT,
    GPU_ENEMY_FORMATION_MOTION_POLICY_PORT,
    GPU_ENEMY_FORMATION_ROSTER_PORT,
    GPU_PRIVATE_HEXA_TRANSFORM_DESTINATION_FIELDS,
    assertGpuEnemyDefinitionCapabilities,
    createGpuEnemySpawnIntent,
    createGpuPrivateHexaTransformDestinationIntent,
    materializeNaturalHexaFormationActivation,
    normalizeGpuPrivateHexaTransformDestinationIntent
} = await loadGameModule('ingame/object/enemy/gpu_enemy_spawn_adapter.js');
const {
    FormationRuntimeDirector
} = await loadGameModule('ingame/object/enemy/formation_runtime_director.js');
const {
    createGpuRegistryMetadata,
    normalizeGpuSpawnIntent
} = await loadGameModule('ingame/object/gpu_spawn_intent.js');
const {
    resolveEnemySpawnStats
} = await loadGameModule('ingame/object/enemy/resolved_enemy_spawn_stats.js');
const {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_RENDER_SHAPE,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');
const {
    GPU_FORMATION_RUNTIME_ABI,
    GPU_FORMATION_RUNTIME_ABI_VERSION,
    hashGpuFormationHandle
} = await loadGameModule('ingame/physics/gpu/gpu_formation_runtime_abi.js');
const {
    GPU_EFFECT_RUNTIME_ABI,
    GPU_EFFECT_RUNTIME_ABI_VERSION
} = await loadGameModule('ingame/physics/gpu/gpu_effect_runtime_abi.js');

const FIXTURE_ROUTE = Object.freeze({
    gateId: 'formation-contract-gate',
    pathId: 'formation-contract-path',
    waypoints: Object.freeze([
        Object.freeze({ x: 1, y: 2 }),
        Object.freeze({ x: 2, y: 2 })
    ])
});

function definitionSource(definition, overrides = {}) {
    return {
        id: definition.id,
        spawnPolicy: definition.spawnPolicy,
        shapeDefinitionId: definition.shapeDefinitionId,
        physicsProfileId: definition.physicsProfileId,
        combatProfileId: definition.combatProfileId,
        behaviorProfileId: definition.behaviorProfileId,
        effectEmitterProfileId: definition.effectEmitterProfileId,
        formationDefinitionId: definition.formationDefinitionId,
        capabilityIds: definition.capabilityIds,
        render: definition.render,
        ...overrides
    };
}

test('Formation coordinate/policy/interface vocabulary는 exact frozen identity다', () => {
    assert.deepEqual({ ...FORMATION_COORDINATE_SYSTEM }, {
        LINEAR_GRID: 'LINEAR_GRID',
        HEX_AXIAL: 'HEX_AXIAL',
        PATH_RELATIVE: 'PATH_RELATIVE'
    });
    assert.deepEqual({ ...FORMATION_COORDINATE_SYSTEM_CODE }, {
        NONE: 0,
        LINEAR_GRID: 1,
        HEX_AXIAL: 2,
        PATH_RELATIVE: 3
    });
    assert.deepEqual({ ...ENEMY_FORMATION_POLICY }, {
        NONE: 'none',
        SEEK_FORMATION: 'seek-formation',
        KEEP_FORMATION: 'keep-formation'
    });
    assert.deepEqual({ ...ENEMY_FORMATION_POLICY_CODE }, {
        NONE: 0,
        SEEK_FORMATION: 1,
        KEEP_FORMATION: 2
    });
    assert.deepEqual(Object.values(FORMATION_COORDINATE_SYSTEM_METHOD), [
        'resolveLocalOffset',
        'rotateCoordinate'
    ]);
    assert.deepEqual(Object.values(FORMATION_SLOT_GRAPH_METHOD), [
        'getSlotCount',
        'getNeighborMask',
        'rotateSlotIndex',
        'isConnectedOccupancyMask'
    ]);
    assert.deepEqual(Object.values(FORMATION_MEMBERSHIP_METHOD), [
        'getMemberCount',
        'hasExactMember',
        'copyExactMemberHandleAt'
    ]);
    assert.deepEqual(Object.values(FORMATION_MOTION_POLICY_METHOD), [
        'acceptsRouteProgress',
        'compareJoinCandidates'
    ]);
    assert.deepEqual(Object.values(FORMATION_ATOMIC_TRANSFORM_METHOD), [
        'preflightTransform',
        'commitPreflightedTransform',
        'cancelPreflightedTransform'
    ]);

    const port = (...methods) => Object.fromEntries(methods.map((method) => [
        method,
        () => {}
    ]));
    assert.doesNotThrow(() => assertFormationCoordinateSystem(port(
        ...Object.values(FORMATION_COORDINATE_SYSTEM_METHOD)
    )));
    assert.doesNotThrow(() => assertFormationSlotGraph(port(
        ...Object.values(FORMATION_SLOT_GRAPH_METHOD)
    )));
    assert.doesNotThrow(() => assertFormationMembership(port(
        ...Object.values(FORMATION_MEMBERSHIP_METHOD)
    )));
    assert.doesNotThrow(() => assertFormationMotionPolicy(port(
        ...Object.values(FORMATION_MOTION_POLICY_METHOD)
    )));
    assert.doesNotThrow(() => assertFormationAtomicTransform(port(
        ...Object.values(FORMATION_ATOMIC_TRANSFORM_METHOD)
    )));
    assert.deepEqual([...FORMATION_JOIN_CANDIDATE_FIELDS], [
        'distanceSquared',
        'forwardStageDelta',
        'forwardCostDelta',
        'rootEntityId',
        'rootIncarnation',
        'slotIndex',
        'rotationStep'
    ]);
    assert.equal(acceptsFormationRouteProgress(2, 8, 3, 99), true);
    assert.equal(acceptsFormationRouteProgress(2, 8, 2, 8), true);
    assert.equal(acceptsFormationRouteProgress(2, 8, 2, 7), true);
    assert.equal(acceptsFormationRouteProgress(2, 8, 2, 9), false);
    assert.equal(acceptsFormationRouteProgress(2, 8, 1, 0), false);
    assert.throws(() => acceptsFormationRouteProgress('2', 8, 3, 0), /uint32/);

    const joinCandidate = Object.freeze({
        distanceSquared: 4,
        forwardStageDelta: 0,
        forwardCostDelta: 1,
        rootEntityId: 10,
        rootIncarnation: 2,
        slotIndex: 3,
        rotationStep: 1
    });
    for (const [field, smaller, larger] of [
        ['distanceSquared', 3, 5],
        ['forwardStageDelta', 0, 1],
        ['forwardCostDelta', 0, 2],
        ['rootEntityId', 9, 11],
        ['rootIncarnation', 1, 3],
        ['slotIndex', 2, 4],
        ['rotationStep', 0, 2]
    ]) {
        assert.equal(compareFormationJoinCandidates(
            { ...joinCandidate, [field]: smaller },
            { ...joinCandidate, [field]: larger }
        ), -1, field);
    }
    assert.equal(compareFormationJoinCandidates(joinCandidate, joinCandidate), 0);
    assert.throws(() => compareFormationJoinCandidates(
        { ...joinCandidate, eligible: true },
        joinCandidate
    ), /알 수 없는 필드/);
    assert.throws(() => compareFormationJoinCandidates(
        { ...joinCandidate, rootEntityId: '10' },
        joinCandidate
    ), /uint32/);
});

test('six-ring catalog는 empty center, graph, +60 rotation, connectivity를 고정한다', () => {
    const definition = HEXA_HIVE_SIX_RING_FORMATION_DEFINITION;
    assert.equal(Object.isFrozen(ENEMY_FORMATION_CATALOG), true);
    assert.equal(Object.isFrozen(definition), true);
    assert.deepEqual({ ...GPU_ENEMY_FORMATION_DEFINITION_CODE }, {
        NONE: 0,
        HEXA_HIVE_SIX_RING: 1
    });
    assert.equal(definition.id, HEXA_HIVE_SIX_RING_FORMATION_DEFINITION_ID);
    assert.deepEqual(Array.from(
        definition.slotCoordinates,
        (entry) => ({ q: entry.q, r: entry.r })
    ), [
        { q: 1, r: 0 },
        { q: 1, r: -1 },
        { q: 0, r: -1 },
        { q: -1, r: 0 },
        { q: -1, r: 1 },
        { q: 0, r: 1 }
    ]);
    assert.deepEqual([...definition.neighborMasks], [34, 5, 10, 20, 40, 17]);
    assert.equal(definition.emptyCenterRequired, true);
    assert.equal(definition.maximumMemberCount, 6);
    assert.equal(definition.maximumSdfSegmentSamples, 64);
    assert.deepEqual(
        Array.from({ length: 6 }, (_, index) => (
            resolvePositive60FormationSlotIndex(definition, index)
        )),
        [5, 0, 1, 2, 3, 4]
    );
    let coordinate = { q: 1, r: 0 };
    for (let index = 0; index < 6; index++) {
        coordinate = rotateHexAxialCoordinatePositive60(coordinate, {});
    }
    assert.deepEqual(coordinate, { q: 1, r: 0 });
    assert.equal(isConnectedFormationOccupancyMask(definition.neighborMasks, 0b000111), true);
    assert.equal(isConnectedFormationOccupancyMask(definition.neighborMasks, 0b001001), false);
});

test('H/group/HX identity, spawn boundary, capability/profile 3-way를 고정한다', () => {
    assert.equal(BASIC_HEXA_ENEMY_DATA.id, BASIC_HEXA_ENEMY_DEFINITION_ID);
    assert.equal(BASIC_HEXA_ENEMY_DATA.spawnPolicy, ENEMY_SPAWN_POLICY.NATURAL);
    assert.equal(BASIC_HEXA_ENEMY_DATA.shapeDefinitionId, 'hexa');
    assert.equal(BASIC_HEXA_ENEMY_DATA.formationDefinitionId,
        HEXA_HIVE_SIX_RING_FORMATION_DEFINITION_ID);
    assert.deepEqual([...BASIC_HEXA_ENEMY_DATA.capabilityIds], [
        ...BASIC_HEXA_FORMATION_CAPABILITY_IDS
    ]);
    const groupDefinitions = [2, 3, 4, 5].map(
        resolveBasicHexaTransformPrivateDefinition
    );
    assert.equal(new Set(groupDefinitions).size, 1);
    assert.equal(groupDefinitions[0].id, BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID);
    assert.equal(groupDefinitions[0].spawnPolicy, ENEMY_SPAWN_POLICY.TRANSFORM_PRIVATE);
    assert.equal(groupDefinitions[0].shapeDefinitionId, 'hexa');
    assert.equal(groupDefinitions[0].effectEmitterProfileId, null);
    const hive = resolveBasicHexaTransformPrivateDefinition(6);
    assert.equal(hive.id, BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID);
    assert.equal(hive.spawnPolicy, ENEMY_SPAWN_POLICY.TRANSFORM_PRIVATE);
    assert.equal(hive.shapeDefinitionId, 'hexa');
    assert.equal(hive.effectEmitterProfileId, null);
    assert.deepEqual([...hive.capabilityIds], [...BASIC_HEXA_HIVE_CAPABILITY_IDS]);
    assert.equal(hive.capabilityIds.includes(ENEMY_CAPABILITY_ID.ATOMIC_TRANSFORM), false);
    assert.equal(
        resolveEnemyDefinitionProfiles(BASIC_HEXA_ENEMY_DATA, ENEMY_PROFILE_CATALOG)
            .behavior.formationPolicy,
        ENEMY_FORMATION_POLICY.SEEK_FORMATION
    );
    assert.equal(
        resolveEnemyDefinitionProfiles(hive, ENEMY_PROFILE_CATALOG)
            .behavior.formationPolicy,
        ENEMY_FORMATION_POLICY.KEEP_FORMATION
    );
    assert.strictEqual(
        INGAME_ENEMY_DEFINITION_BY_ID[BASIC_HEXA_ENEMY_DEFINITION_ID],
        BASIC_HEXA_ENEMY_DATA
    );
    assert.equal(INGAME_ENEMY_DEFINITION_BY_ID[BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID], undefined);
    assert.equal(INGAME_ENEMY_DEFINITION_BY_ID[BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID], undefined);
    assert.equal(INGAME_ENEMY_DEFINITIONS.includes(BASIC_HEXA_ENEMY_DATA), true);
    assert.throws(() => resolveBasicHexaTransformPrivateDefinition(1), /natural definition/);
    assert.throws(() => resolveBasicHexaTransformPrivateDefinition(7), /1\.\.6/);
    assert.throws(() => resolveBasicHexaTransformPrivateDefinition('2'), /1\.\.6/);
    assert.doesNotThrow(() => assertGpuEnemyDefinitionCapabilities(
        BASIC_HEXA_ENEMY_DATA
    ));
    assert.doesNotThrow(() => assertGpuEnemyDefinitionCapabilities(
        groupDefinitions[0]
    ));
    assert.doesNotThrow(() => assertGpuEnemyDefinitionCapabilities(hive));
    assert.strictEqual(
        GPU_ENEMY_FORMATION_ROSTER_PORT.observeLifecycle,
        FormationRuntimeDirector.prototype.observeLifecycle
    );
    assert.strictEqual(
        GPU_ENEMY_FORMATION_ROSTER_PORT.observeCompletedPreparations,
        FormationRuntimeDirector.prototype.observeCompletedPreparations
    );
    assert.strictEqual(
        GPU_ENEMY_FORMATION_ROSTER_PORT.closeForTerminal,
        FormationRuntimeDirector.prototype.closeForTerminal
    );
    assert.strictEqual(
        GPU_ENEMY_FORMATION_MEMBERSHIP_PORT.copyExactMemberHandleAt,
        FormationRuntimeDirector.prototype.copyExactMemberHandleAt
    );
    assert.strictEqual(
        GPU_ENEMY_FORMATION_MOTION_POLICY_PORT.compareJoinCandidates,
        FormationRuntimeDirector.prototype.compareJoinCandidates
    );
    assert.strictEqual(
        GPU_ENEMY_FORMATION_ATOMIC_TRANSFORM_PORT.preflightTransform,
        FormationRuntimeDirector.prototype.preflightTransform
    );
    assert.equal(
        GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY.byCapabilityId[
            ENEMY_CAPABILITY_ID.FORMATION
        ].rosterPort,
        GPU_ENEMY_FORMATION_ROSTER_PORT
    );
    assert.equal(
        GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY.byCapabilityId[
            ENEMY_CAPABILITY_ID.ATOMIC_TRANSFORM
        ].rosterPort,
        GPU_ENEMY_FORMATION_ROSTER_PORT
    );

    assert.throws(() => normalizeEnemyDefinition(definitionSource(
        BASIC_HEXA_ENEMY_DATA,
        { formationDefinitionId: null }
    ), ENEMY_PROFILE_CATALOG), /FORMATION capability/);
    assert.throws(() => normalizeEnemyDefinition(definitionSource(
        BASIC_HEXA_ENEMY_DATA,
        {
            capabilityIds: BASIC_HEXA_ENEMY_DATA.capabilityIds.filter(
                (id) => id !== ENEMY_CAPABILITY_ID.FORMATION
            )
        }
    ), ENEMY_PROFILE_CATALOG), /FORMATION capability/);
    assert.throws(() => normalizeEnemyDefinition(definitionSource(
        BASIC_SQUARE_ENEMY_DATA,
        { formationDefinitionId: HEXA_HIVE_SIX_RING_FORMATION_DEFINITION_ID }
    ), ENEMY_PROFILE_CATALOG), /FORMATION capability/);
    const hexaBehavior = ENEMY_PROFILE_CATALOG.behaviorById[
        BASIC_HEXA_ENEMY_DATA.behaviorProfileId
    ];
    const forgedNoFormationPolicyCatalog = {
        physicsById: ENEMY_PROFILE_CATALOG.physicsById,
        combatById: ENEMY_PROFILE_CATALOG.combatById,
        behaviorById: {
            ...ENEMY_PROFILE_CATALOG.behaviorById,
            [hexaBehavior.id]: {
                ...hexaBehavior,
                formationPolicy: ENEMY_FORMATION_POLICY.NONE
            }
        }
    };
    assert.throws(() => normalizeEnemyDefinition(
        definitionSource(BASIC_HEXA_ENEMY_DATA),
        forgedNoFormationPolicyCatalog
    ), /FORMATION capability/);
    assert.throws(() => normalizeEnemyDefinition({
        ...definitionSource(BASIC_SQUARE_ENEMY_DATA),
        spawnPolicy: undefined
    }, ENEMY_PROFILE_CATALOG), /spawnPolicy/);
    const futureAtomicWithoutFormation = normalizeEnemyDefinition(definitionSource(
        BASIC_SQUARE_ENEMY_DATA,
        {
            id: 'future-atomic-transform-without-formation',
            capabilityIds: Object.freeze([
                ...BASIC_SQUARE_ENEMY_DATA.capabilityIds,
                ENEMY_CAPABILITY_ID.ATOMIC_TRANSFORM
            ])
        }
    ), ENEMY_PROFILE_CATALOG);
    assert.doesNotThrow(() => assertGpuEnemyDefinitionCapabilities(
        futureAtomicWithoutFormation
    ));
});

test('n1..6 raw stats와 final-only f32/inverseMass/Core/bounty를 고정한다', () => {
    assert.equal(Object.isFrozen(BASIC_HEXA_RAW_STATS_BY_MEMBER_COUNT), true);
    const expected = [
        [0.1, 2.5, 1, 1],
        [0.12, 2.25, 2, 2],
        [0.144, 2.025, 4, 4],
        [0.1728, 1.8225, 8, 6],
        [0.20736, 1.64025, 16, 8],
        [0.248832, 1.476225, 32, 10]
    ];
    for (let memberCount = 1; memberCount <= 6; memberCount++) {
        const raw = BASIC_HEXA_RAW_STATS_BY_MEMBER_COUNT[memberCount];
        const resolved = resolveBasicHexaFormationStats(memberCount);
        assert.deepEqual([
            raw.towerContactDamage,
            raw.moveSpeedTilesPerSecond,
            raw.weight,
            raw.bountyBudget
        ], expected[memberCount - 1]);
        assert.equal(resolved.towerContactDamage, Math.fround(expected[memberCount - 1][0]));
        assert.equal(resolved.moveSpeedTilesPerSecond, Math.fround(expected[memberCount - 1][1]));
        assert.equal(resolved.weight, Math.fround(expected[memberCount - 1][2]));
        assert.equal(resolved.inverseMass, Math.fround(1 / resolved.weight));
        assert.equal(resolved.bountyBudget, expected[memberCount - 1][3]);
        assert.equal(resolved.coreImpactDamage, 1);
    }
});

test('merge centi-HP는 current/max 각각 sum+floor(sum/10), remainder, overflow를 검증한다', () => {
    assert.deepEqual({ ...mergeBasicHexaHealthCenti({
        sourceACurrentHealthCenti: 101,
        sourceAMaxHealthCenti: 200,
        sourceBCurrentHealthCenti: 100,
        sourceBMaxHealthCenti: 200
    }) }, {
        currentHealthCenti: 221,
        maxHealthCenti: 440
    });
    assert.deepEqual({ ...mergeBasicHexaHealthCenti({
        sourceACurrentHealthCenti: 1,
        sourceAMaxHealthCenti: 9,
        sourceBCurrentHealthCenti: 8,
        sourceBMaxHealthCenti: 10
    }) }, {
        currentHealthCenti: 9,
        maxHealthCenti: 20
    });
    assert.throws(() => mergeBasicHexaHealthCenti({
        sourceACurrentHealthCenti: 11,
        sourceAMaxHealthCenti: 10,
        sourceBCurrentHealthCenti: 1,
        sourceBMaxHealthCenti: 1
    }), /current centi-HP/);
    assert.throws(() => mergeBasicHexaHealthCenti({
        sourceACurrentHealthCenti: 0x7fffffff,
        sourceAMaxHealthCenti: 0x7fffffff,
        sourceBCurrentHealthCenti: 1,
        sourceBMaxHealthCenti: 1
    }), /signed-int32/);
    assert.throws(() => mergeBasicHexaHealthCenti({
        sourceACurrentHealthCenti: '100',
        sourceAMaxHealthCenti: 100,
        sourceBCurrentHealthCenti: 100,
        sourceBMaxHealthCenti: 100
    }), /signed-int32/);
    assert.throws(() => mergeBasicHexaHealthCenti({
        sourceACurrentHealthCenti: 100,
        sourceAMaxHealthCenti: 100,
        sourceBCurrentHealthCenti: 100,
        sourceBMaxHealthCenti: 100,
        expectedEffectRekeyCount: 0
    }), /금지\/unknown field/);
});

test('public raw/private transform ingress와 natural H registry facts는 분리된다', () => {
    const baseNaturalHexaStats = resolveEnemySpawnStats({
        definition: BASIC_HEXA_ENEMY_DATA
    });
    assert.throws(() => createGpuEnemySpawnIntent({
        definition: BASIC_HEXA_ENEMY_DATA,
        route: FIXTURE_ROUTE,
        spawnSequence: 3,
        resolvedStats: Object.freeze({
            ...baseNaturalHexaStats,
            moveSpeedTilesPerSecond: Math.fround(3)
        })
    }), /fixed n1 table/);
    const rawIntent = createGpuEnemySpawnIntent({
        definition: BASIC_HEXA_ENEMY_DATA,
        route: FIXTURE_ROUTE,
        spawnSequence: 4
    });
    assert.equal(rawIntent.spawnPolicy, ENEMY_SPAWN_POLICY.NATURAL);
    assert.equal(rawIntent.formationMemberCount, 1);
    assert.equal('formationState' in rawIntent, false);
    assert.equal('enemyBehaviorState' in rawIntent, false);
    assert.throws(() => normalizeGpuSpawnIntent({
        ...rawIntent,
        flowSpeed: Math.fround(3)
    }), /fixed n1 table/);
    assert.throws(() => normalizeGpuSpawnIntent({
        ...rawIntent,
        formationPolicyId: ENEMY_FORMATION_POLICY.KEEP_FORMATION,
        formationPolicyCode: ENEMY_FORMATION_POLICY_CODE.KEEP_FORMATION
    }), /exact public catalog/);
    assert.throws(() => normalizeGpuSpawnIntent({
        ...rawIntent,
        formationMemberCount: '1'
    }), /uint32/);
    const normalizedRaw = normalizeGpuSpawnIntent(rawIntent);
    const handle = Object.freeze({ entityId: 41, incarnation: 3 });
    const activated = materializeNaturalHexaFormationActivation(normalizedRaw, handle);
    assert.equal(activated.formationId, createFormationIdFromExactHandle(handle));
    assert.equal(activated.formationGeneration, 1);
    assert.equal(activated.formationOccupiedSlotMask, 1);
    assert.equal(activated.formationLineageHash, createFormationLineageHash([handle]));
    assert.equal(activated.formationLineageHash, hashGpuFormationHandle(handle));
    assert.equal(activated.formationState.memberCount, 1);
    const metadata = createGpuRegistryMetadata(activated);
    assert.equal(metadata.formationId, activated.formationId);
    assert.equal(metadata.formationLineageHash, activated.formationLineageHash);
    assert.equal('formationState' in metadata, false);
    assert.equal('spawnPolicy' in metadata, false);
    for (const field of [
        'formationGroupId',
        'formationAuthoredCoordinateSystemId',
        'formationAuthoredMemberCount',
        'formationRows',
        'formationColumns',
        'formationMemberIndex',
        'formationMemberSlotIndex',
        'formationRowIndex',
        'formationColumnIndex',
        'formationAuthoredOccupiedSlotMask'
    ]) {
        assert.equal(metadata[field], null, field);
    }
    assert.equal(Object.values(metadata).every((value) => (
        value === null
            || value === undefined
            || typeof value === 'string'
            || typeof value === 'number'
            || typeof value === 'boolean'
    )), true);

    const authoredProvenance = Object.freeze({
        formationGroupId: 'authored-six-ring',
        formationAuthoredCoordinateSystemId:
            FORMATION_COORDINATE_SYSTEM.HEX_AXIAL,
        formationAuthoredMemberCount: 6,
        formationRows: 3,
        formationColumns: 3,
        formationMemberIndex: 0,
        formationMemberSlotIndex: 2,
        formationRowIndex: 0,
        formationColumnIndex: 1,
        formationAuthoredOccupiedSlotMask: 0x3f
    });
    assert.throws(() => createGpuEnemySpawnIntent({
        definition: BASIC_HEXA_ENEMY_DATA,
        route: FIXTURE_ROUTE,
        spawnSequence: 5,
        formationProvenance: authoredProvenance
    }), /waveId/);
    const authoredRaw = normalizeGpuSpawnIntent(createGpuEnemySpawnIntent({
        definition: BASIC_HEXA_ENEMY_DATA,
        route: FIXTURE_ROUTE,
        spawnSequence: 5,
        waveId: 'authored-six-ring-wave',
        formationProvenance: authoredProvenance
    }));
    const authoredHandle = Object.freeze({ entityId: 43, incarnation: 1 });
    const authoredActivated = materializeNaturalHexaFormationActivation(
        authoredRaw,
        authoredHandle
    );
    assert.equal(authoredActivated.formationMemberSlotIndex, 2);
    assert.equal(authoredActivated.formationOccupiedSlotMask, 1 << 2);
    assert.equal(authoredActivated.formationAuthoredOccupiedSlotMask, 0x3f);
    const authoredMetadata = createGpuRegistryMetadata(authoredActivated);
    assert.equal(authoredMetadata.formationMemberSlotIndex, 2);
    assert.equal(authoredMetadata.formationOccupiedSlotMask, 1 << 2);
    assert.equal(authoredMetadata.formationAuthoredOccupiedSlotMask, 0x3f);

    const privateGroup = resolveBasicHexaTransformPrivateDefinition(2);
    assert.throws(() => createGpuEnemySpawnIntent({
        definition: privateGroup,
        route: FIXTURE_ROUTE,
        spawnSequence: 5
    }), /transform-private/);
    assert.throws(() => normalizeGpuSpawnIntent({
        ...rawIntent,
        definitionId: privateGroup.id,
        enemyDefinitionId: privateGroup.id,
        spawnPolicy: ENEMY_SPAWN_POLICY.NATURAL
    }), /transform-private/);
    assert.throws(() => normalizeGpuSpawnIntent({
        ...rawIntent,
        spawnPolicy: null
    }), /spawnPolicy/);
    assert.throws(() => normalizeGpuSpawnIntent({
        ...rawIntent,
        formationLineageHash: 1,
        formationState: {}
    }), /raw Enemy spawn/);

    const privateFacts = normalizeGpuPrivateHexaTransformDestinationIntent({
        memberCount: 2,
        currentHealthCenti: 220,
        maxHealthCenti: 220,
        formationOccupiedSlotMask: 0b000011,
        formationRotationStep: 0,
        formationGeneration: 2,
        formationLineageHash: createFormationLineageHash([
            handle,
            { entityId: 42, incarnation: 1 }
        ])
    });
    assert.equal(Object.isFrozen(privateFacts), true);
    let getterReadCount = 0;
    const accessorSource = {};
    for (const [field, value] of Object.entries(privateFacts)) {
        Object.defineProperty(accessorSource, field, {
            enumerable: true,
            get() {
                getterReadCount++;
                return value;
            }
        });
    }
    getterReadCount = 0;
    assert.deepEqual(
        { ...normalizeGpuPrivateHexaTransformDestinationIntent(accessorSource) },
        { ...privateFacts }
    );
    assert.equal(getterReadCount, Object.keys(privateFacts).length);
    assert.throws(() => normalizeGpuPrivateHexaTransformDestinationIntent({
        ...privateFacts,
        entityId: 99
    }), /금지\/unknown field/);
    assert.throws(() => normalizeGpuPrivateHexaTransformDestinationIntent({
        ...privateFacts,
        memberCount: '2'
    }), /number/);
    const sourceRootView = Object.freeze({
        entityId: handle.entityId,
        incarnation: handle.incarnation,
        kindId: 'enemy',
        definitionId: BASIC_HEXA_ENEMY_DATA.id,
        metadata
    });
    const destination = createGpuPrivateHexaTransformDestinationIntent({
        ...privateFacts,
        sourceRootView,
        destinationHandle: { entityId: handle.entityId, incarnation: 4 }
    });
    const createAccessorSource = {};
    let createGetterReadCount = 0;
    for (const [key, value] of Object.entries({
        ...privateFacts,
        sourceRootView,
        destinationHandle: { entityId: handle.entityId, incarnation: 4 }
    })) {
        Object.defineProperty(createAccessorSource, key, {
            enumerable: true,
            get() {
                createGetterReadCount++;
                return value;
            }
        });
    }
    assert.equal(
        createGpuPrivateHexaTransformDestinationIntent(createAccessorSource)
            .definitionId,
        BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID
    );
    assert.equal(
        createGetterReadCount,
        GPU_PRIVATE_HEXA_TRANSFORM_DESTINATION_FIELDS.length + 2
    );
    assert.equal(destination.definitionId, BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID);
    assert.equal(destination.spawnPolicy, ENEMY_SPAWN_POLICY.TRANSFORM_PRIVATE);
    assert.equal(destination.healthFixedPoint, 220);
    assert.equal(destination.maxHealthFixedPoint, 220);
    assert.equal(destination.formationMemberCount, 2);
    assert.equal('position' in destination, false);
    assert.equal('velocity' in destination, false);
    assert.equal('enemyBehaviorState' in destination, false);
    const destinationMetadata = createGpuRegistryMetadata(destination);
    assert.equal(destinationMetadata.formationMemberCount, 2);
    assert.equal('healthFixedPoint' in destinationMetadata, false);
    assert.equal('maxHealthFixedPoint' in destinationMetadata, false);
    assert.throws(() => normalizeGpuPrivateHexaTransformDestinationIntent({
        ...privateFacts,
        activeEffectExpectedCount: 1
    }), /금지\/unknown field/);
    assert.throws(() => createGpuPrivateHexaTransformDestinationIntent({
        ...privateFacts,
        sourceRootView,
        destinationHandle: { entityId: handle.entityId, incarnation: 4 },
        activeEffectExpectedCount: 1
    }), /금지\/unknown field/);

    const hiveLineage = [
        handle,
        { entityId: 42, incarnation: 1 },
        { entityId: 44, incarnation: 1 },
        { entityId: 45, incarnation: 1 },
        { entityId: 46, incarnation: 1 },
        { entityId: 47, incarnation: 1 }
    ];
    const hiveDestination = createGpuPrivateHexaTransformDestinationIntent({
        ...normalizeGpuPrivateHexaTransformDestinationIntent({
            memberCount: 6,
            currentHealthCenti: 660,
            maxHealthCenti: 660,
            formationOccupiedSlotMask: 0x3f,
            formationRotationStep: 0,
            formationGeneration: 2,
            formationLineageHash: createFormationLineageHash(hiveLineage)
        }),
        sourceRootView,
        destinationHandle: { entityId: handle.entityId, incarnation: 4 }
    });
    assert.equal(hiveDestination.definitionId, BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID);
    assert.equal(hiveDestination.bountyBudget, 10);
    assert.equal(hiveDestination.formationOccupiedSlotMask, 0x3f);
    assert.equal(hiveDestination.formationState.occupiedSlotMask, 0x3f);
    assert.equal('activeEffectExpectedCount' in hiveDestination, false);
    const hiveMetadata = createGpuRegistryMetadata(hiveDestination);
    assert.equal(hiveMetadata.bountyBudget, 10);
    assert.equal(hiveMetadata.formationOccupiedSlotMask, 0x3f);
    assert.equal('healthFixedPoint' in hiveMetadata, false);
    assert.equal(GPU_FORMATION_RUNTIME_ABI.TRANSFORM_HEADER.EFFECT_REKEY_COUNT, 36);
    assert.equal(GPU_FORMATION_RUNTIME_ABI.TRANSFORM_RECORD.EFFECT_REKEY_COUNT, 168);
    assert.throws(() => createGpuPrivateHexaTransformDestinationIntent({
        ...privateFacts,
        sourceRootView: {
            ...sourceRootView,
            metadata: {
                ...metadata,
                formationPolicyCode: metadata.formationPolicyCode + 1
            }
        },
        destinationHandle: { entityId: handle.entityId, incarnation: 4 }
    }), /canonical source/);
    assert.throws(() => createGpuPrivateHexaTransformDestinationIntent({
        ...privateFacts,
        sourceRootView,
        destinationHandle: { entityId: handle.entityId + 1, incarnation: 1 }
    }), /next incarnation/);
    assert.throws(() => createGpuPrivateHexaTransformDestinationIntent({
        ...privateFacts,
        sourceRootView: { ...sourceRootView, entityId: String(handle.entityId) },
        destinationHandle: { entityId: handle.entityId, incarnation: 4 }
    }), /uint32/);
});

test('C/T/A/M/P, render shape, 80-byte exclusive behavior union은 Formation과 독립이다', () => {
    for (const definition of Object.values(INGAME_ENEMY_DEFINITION_BY_ID)) {
        assert.equal(
            Object.prototype.hasOwnProperty.call(definition, 'spawnPolicy'),
            true,
            definition.id
        );
        assert.equal(
            Object.prototype.hasOwnProperty.call(definition, 'formationDefinitionId'),
            true,
            definition.id
        );
        assert.equal(definition.spawnPolicy, ENEMY_SPAWN_POLICY.NATURAL);
    }
    for (const definition of [
        BASIC_SQUARE_ENEMY_DATA,
        BASIC_TRIANGLE_ENEMY_DATA,
        BASIC_ARROW_ENEMY_DATA,
        BASIC_RHOM_ENEMY_DATA,
        BASIC_PENTA_ENEMY_DATA
    ]) {
        assert.equal(definition.spawnPolicy, ENEMY_SPAWN_POLICY.NATURAL);
        assert.equal(definition.formationDefinitionId, null);
        assert.equal(definition.capabilityIds.includes(ENEMY_CAPABILITY_ID.FORMATION), false);
    }
    assert.deepEqual({ ...GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM }, {
        NONE: 0,
        ARROW_TOWER_CHARGE: 1,
        SELECTED_TARGET_PROJECTILE: 2
    });
    assert.equal(GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE, 80);
    assert.equal(GPU_FORMATION_RUNTIME_ABI_VERSION, 1);
    assert.equal(GPU_EFFECT_RUNTIME_ABI_VERSION, 1);
    assert.notStrictEqual(
        GPU_FORMATION_RUNTIME_ABI.BODY_STATE,
        GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE
    );
    assert.notStrictEqual(
        GPU_FORMATION_RUNTIME_ABI.BODY_STATE,
        GPU_EFFECT_RUNTIME_ABI.SUMMARY
    );
    assert.equal('FORMATION' in GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM, false);
    assert.equal('EFFECT' in GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM, false);
    assert.equal(GPU_CIRCLE_BODY_RENDER_SHAPE.HEXA, 5);
    assert.equal('HEXA_HIVE' in GPU_CIRCLE_BODY_RENDER_SHAPE, false);
});

console.log('enemy Formation contract/data: ok');
