import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    BASIC_OCTA_ENEMY_CAPABILITY_IDS,
    BASIC_OCTA_ENEMY_CAPABILITY_MASK,
    BASIC_OCTA_ENEMY_DATA,
    BASIC_OCTA_ENEMY_DEFINITION_ID,
    BASIC_OCTA_FUTURE_TARGET_REACQUISITION_REQUIREMENT,
    BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE,
    BASIC_OCTA_ORBIT_CAPACITY_POLICY,
    BASIC_OCTA_ORBIT_SLOT_CAPACITY,
    BASIC_OCTA_ORBIT_SLOT_FILL_ORDER
} = await loadGameModule('data/object/enemy/basic_octa_enemy_data.js');
const {
    BASIC_OCTA_ENEMY_DATA: BASIC_OCTA_CATALOG_ALIAS,
    INGAME_ENEMY_DEFINITION_BY_ID,
    INGAME_ENEMY_DEFINITIONS
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    CORRIDOR_EIGHT_WAVE_01_DATA
} = await loadGameModule('data/scene/game/corridor_eight_wave_01_data.js');
const {
    ENEMY_CAPABILITY_BIT,
    ENEMY_CAPABILITY_ID,
    createEnemyCapabilityMask
} = await loadGameModule('ingame/contract/enemy_capability_contract.js');
const {
    ENEMY_DIRECTIONAL_DEFENSE_BOUNDARY_POLICY,
    ENEMY_DIRECTIONAL_DEFENSE_FIXED_POINT_SCALE,
    ENEMY_DIRECTIONAL_DEFENSE_ZERO_DIRECTION_POLICY,
    ENEMY_ORBIT_CENTER_TARGET_POLICY,
    ENEMY_ORBIT_CAPACITY_OVERFLOW_POLICY,
    ENEMY_ORBIT_CAPACITY_RETRY_POLICY,
    ENEMY_ORBIT_FIXED_TICKS_PER_SECOND,
    ENEMY_ORBIT_FUTURE_TARGET_REACQUISITION_POLICY,
    ENEMY_ORBIT_FUTURE_TARGET_SELECTION_POLICY,
    ENEMY_ORBIT_LEASE_METADATA_FIELDS,
    ENEMY_ORBIT_PHASE_Q32_SCALE,
    ENEMY_ORBIT_SLOT_CAPACITY,
    ENEMY_ORBIT_SLOT_UNASSIGNED,
    ENEMY_ORBIT_TOWER_LOSS_POLICY,
    encodeEnemyDirectionalDefenseFixedPoint,
    encodeEnemyOrbitAngularStepQ32,
    hasAnyEnemyOrbitLeaseMetadata,
    normalizeEnemyDirectionalDefenseProfile,
    normalizeEnemyOrbitProfile,
    normalizeEnemyOrbitSlotLease
} = await loadGameModule(
    'ingame/contract/enemy_orbit_directional_defense_contract.js'
);
const {
    FORMATION_COORDINATE_SYSTEM,
    FORMATION_COORDINATE_SYSTEM_CODE,
    FORMATION_COORDINATE_SYSTEM_CODE_BY_ID
} = await loadGameModule('ingame/contract/enemy_formation_contract.js');
const {
    ENEMY_PROFILE_CATALOG
} = await loadGameModule('data/object/enemy/enemy_profile_catalog_data.js');
const {
    normalizeEnemyDefinition,
    resolveEnemyDefinitionProfiles
} = await loadGameModule('ingame/contract/enemy_profile_contract.js');
const {
    GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY,
    createGpuEnemySpawnIntent
} = await loadGameModule('ingame/object/enemy/gpu_enemy_spawn_adapter.js');
const {
    normalizeGpuSpawnIntent
} = await loadGameModule('ingame/object/gpu_spawn_intent.js');
const {
    GPU_CIRCLE_BODY_RENDER_SHAPE,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');

const FIXTURE_ROUTE = Object.freeze({
    gateId: 'octagon-contract-gate',
    pathId: 'octagon-contract-path',
    waypoints: Object.freeze([
        Object.freeze({ x: 2, y: 3 }),
        Object.freeze({ x: 3, y: 3 })
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
        routeClosureProfileId: definition.routeClosureProfileId,
        capabilityIds: definition.capabilityIds,
        render: definition.render,
        ...overrides
    };
}

test('O data는 exact RING_SLOTS/orbit/directional-defense 단일 authority다', () => {
    assert.equal(BASIC_OCTA_ENEMY_DEFINITION_ID, 'basic-octa-enemy');
    assert.strictEqual(BASIC_OCTA_CATALOG_ALIAS, BASIC_OCTA_ENEMY_DATA);
    assert.strictEqual(
        INGAME_ENEMY_DEFINITION_BY_ID[BASIC_OCTA_ENEMY_DEFINITION_ID],
        BASIC_OCTA_ENEMY_DATA
    );
    assert.equal(INGAME_ENEMY_DEFINITIONS.includes(BASIC_OCTA_ENEMY_DATA), true);
    assert.equal(BASIC_OCTA_ENEMY_DATA.shapeDefinitionId, 'octa');
    assert.equal(BASIC_OCTA_ENEMY_DATA.physicsProfileId,
        'octagon-heavy-physics-01');
    assert.equal(BASIC_OCTA_ENEMY_DATA.behaviorProfileId,
        'octagon-tower-orbit-01');
    assert.equal(BASIC_OCTA_ENEMY_DATA.formationDefinitionId, null);
    assert.deepEqual(Array.from(BASIC_OCTA_ENEMY_CAPABILITY_IDS), [
        ENEMY_CAPABILITY_ID.NAVIGATION,
        ENEMY_CAPABILITY_ID.TARGETING,
        ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
        ENEMY_CAPABILITY_ID.CORE_IMPACT,
        ENEMY_CAPABILITY_ID.DIRECTIONAL_DEFENSE,
        ENEMY_CAPABILITY_ID.ORBIT
    ]);
    assert.equal(ENEMY_CAPABILITY_BIT.ORBIT, 0x800);
    assert.equal(BASIC_OCTA_ENEMY_CAPABILITY_MASK, 0xA47);
    assert.equal(
        createEnemyCapabilityMask(BASIC_OCTA_ENEMY_CAPABILITY_IDS),
        0xA47
    );
    assert.equal(
        GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY
            .byCapabilityId[ENEMY_CAPABILITY_ID.DIRECTIONAL_DEFENSE]
            .implementationId,
        'gpu-octagon-directional-flat-defense'
    );
    assert.equal(
        GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY
            .byCapabilityId[ENEMY_CAPABILITY_ID.ORBIT].implementationId,
        'gpu-octagon-tower-orbit'
    );

    const profiles = resolveEnemyDefinitionProfiles(
        BASIC_OCTA_ENEMY_DATA,
        ENEMY_PROFILE_CATALOG
    );
    assert.strictEqual(profiles.behavior, BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE);
    assert.equal(profiles.physics.weight, Math.fround(2.5));
    assert.equal(profiles.behavior.moveSpeedTilesPerSecond, Math.fround(2.5));
    assert.deepEqual({ ...profiles.behavior.orbit }, {
        coordinateSystemId: FORMATION_COORDINATE_SYSTEM.RING_SLOTS,
        coordinateSystemCode: FORMATION_COORDINATE_SYSTEM_CODE.RING_SLOTS,
        orbitRadiusTiles: Math.fround(6),
        angularSpeedRadiansPerSecond: Math.fround(0.25),
        fixedTicksPerSecond: 60,
        slotCapacity: 8,
        slotFillOrder: BASIC_OCTA_ORBIT_SLOT_FILL_ORDER,
        centerTargetPolicy: ENEMY_ORBIT_CENTER_TARGET_POLICY.EXACT_GPU_TOWER,
        towerLossPolicy: ENEMY_ORBIT_TOWER_LOSS_POLICY.LATCH_CORE_FALLBACK
    });
    assert.deepEqual({ ...profiles.behavior.directionalDefense }, {
        totalFacetCount: 8,
        armoredFacetCount: 3,
        armoredFacetIndices: profiles.behavior.directionalDefense
            .armoredFacetIndices,
        flatReduction: Math.fround(0.5),
        flatReductionFixedPoint: 50,
        minimumDamage: null,
        minimumDamageFixedPoint: null,
        boundaryPolicy: ENEMY_DIRECTIONAL_DEFENSE_BOUNDARY_POLICY.INCLUSIVE,
        zeroDirectionPolicy:
            ENEMY_DIRECTIONAL_DEFENSE_ZERO_DIRECTION_POLICY.NORMAL_DAMAGE
    });
    assert.deepEqual(
        Array.from(profiles.behavior.directionalDefense.armoredFacetIndices),
        [7, 0, 1]
    );
    assert.equal(Object.isFrozen(profiles.behavior.orbit), true);
    assert.equal(Object.isFrozen(profiles.behavior.directionalDefense), true);
    assert.equal(Object.isFrozen(BASIC_OCTA_ORBIT_SLOT_FILL_ORDER), true);
    assert.equal(BASIC_OCTA_ORBIT_SLOT_CAPACITY, 8);
    assert.deepEqual(Array.from(BASIC_OCTA_ORBIT_SLOT_FILL_ORDER),
        [0, 4, 2, 6, 1, 5, 3, 7]);
});

test('orbit/defense vocabulary와 f32→fixed/Q32 변환은 fail-fast exact다', () => {
    assert.equal(ENEMY_ORBIT_FIXED_TICKS_PER_SECOND, 60);
    assert.equal(ENEMY_ORBIT_SLOT_CAPACITY, 8);
    assert.equal(ENEMY_ORBIT_SLOT_UNASSIGNED, 0xffffffff);
    assert.equal(ENEMY_ORBIT_PHASE_Q32_SCALE, 0x100000000);
    assert.equal(ENEMY_DIRECTIONAL_DEFENSE_FIXED_POINT_SCALE, 100);
    assert.deepEqual(Array.from(ENEMY_ORBIT_LEASE_METADATA_FIELDS), [
        'orbitCoordinateSystemId',
        'orbitCoordinateSystemCode',
        'orbitSlotIndex',
        'orbitSlotCapacity'
    ]);
    assert.equal(Object.isFrozen(ENEMY_ORBIT_LEASE_METADATA_FIELDS), true);
    assert.equal(FORMATION_COORDINATE_SYSTEM_CODE_BY_ID.RING_SLOTS, 4);
    assert.equal(encodeEnemyDirectionalDefenseFixedPoint(0.5), 50);
    assert.equal(encodeEnemyDirectionalDefenseFixedPoint(Math.fround(0.29)), 29);
    assert.equal(encodeEnemyOrbitAngularStepQ32(0.25), 2_848_189);

    const orbit = normalizeEnemyOrbitProfile({
        coordinateSystemId: FORMATION_COORDINATE_SYSTEM.RING_SLOTS,
        coordinateSystemCode: FORMATION_COORDINATE_SYSTEM_CODE.RING_SLOTS,
        orbitRadiusTiles: 6,
        angularSpeedRadiansPerSecond: 0.25,
        fixedTicksPerSecond: 60,
        slotCapacity: 8,
        slotFillOrder: [0, 4, 2, 6, 1, 5, 3, 7],
        centerTargetPolicy: ENEMY_ORBIT_CENTER_TARGET_POLICY.EXACT_GPU_TOWER,
        towerLossPolicy: ENEMY_ORBIT_TOWER_LOSS_POLICY.LATCH_CORE_FALLBACK
    });
    const defense = normalizeEnemyDirectionalDefenseProfile({
        totalFacetCount: 8,
        armoredFacetCount: 3,
        armoredFacetIndices: [7, 0, 1],
        flatReduction: 0.5,
        minimumDamage: null,
        boundaryPolicy: ENEMY_DIRECTIONAL_DEFENSE_BOUNDARY_POLICY.INCLUSIVE,
        zeroDirectionPolicy:
            ENEMY_DIRECTIONAL_DEFENSE_ZERO_DIRECTION_POLICY.NORMAL_DAMAGE
    });
    assert.equal(Object.isFrozen(orbit), true);
    assert.equal(Object.isFrozen(orbit.slotFillOrder), true);
    assert.equal(Object.isFrozen(defense), true);
    assert.equal(Object.isFrozen(defense.armoredFacetIndices), true);
    assert.equal(defense.flatReductionFixedPoint, 50);
    assert.equal(defense.minimumDamageFixedPoint, null);
    assert.throws(() => normalizeEnemyOrbitProfile({
        ...orbit,
        coordinateSystemCode: FORMATION_COORDINATE_SYSTEM_CODE.PATH_RELATIVE
    }), /exact RING_SLOTS/);
    assert.throws(() => normalizeEnemyOrbitProfile({
        ...orbit,
        slotFillOrder: [0, 4, 2, 6, 1, 5, 3, 3]
    }), /permutation/);
    assert.throws(() => normalizeEnemyOrbitProfile({
        ...orbit,
        orbitRadiusTiles: Number.MIN_VALUE
    }), /float32/);
    assert.throws(() => normalizeEnemyOrbitProfile({
        ...orbit,
        orbitRadiusTiles: Number.MAX_VALUE
    }), /float32/);
    assert.throws(() => normalizeEnemyDirectionalDefenseProfile({
        ...defense,
        flatReduction: Number.MIN_VALUE
    }), /float32|positive centi/);
    assert.throws(() => normalizeEnemyDirectionalDefenseProfile({
        ...defense,
        flatReduction: Number.MAX_VALUE
    }), /float32/);
    assert.throws(() => normalizeEnemyDirectionalDefenseProfile({
        ...defense,
        armoredFacetIndices: [7, 1, 0]
    }), /순환 순서/);
    assert.throws(() => normalizeEnemyDirectionalDefenseProfile({
        ...defense,
        armoredFacetIndices: [0, 1, 2]
    }), /exact front-facing/);
    assert.throws(() => normalizeEnemyDirectionalDefenseProfile({
        ...defense,
        totalFacetCount: 7
    }), /exact 3\/8 facet/);
    assert.throws(() => normalizeEnemyDirectionalDefenseProfile({
        ...defense,
        armoredFacetCount: 2,
        armoredFacetIndices: [7, 0]
    }), /exact 3\/8 facet/);
    assert.throws(() => normalizeEnemyDirectionalDefenseProfile({
        ...defense,
        minimumDamage: -0.01
    }), /no-minimum|null/);
});

test('O 8-slot overflow와 future Tower reacquisition은 data-owned carry-forward다', () => {
    assert.deepEqual({ ...BASIC_OCTA_ORBIT_CAPACITY_POLICY }, {
        maximumSimultaneousActors: 8,
        overflowPolicyId:
            ENEMY_ORBIT_CAPACITY_OVERFLOW_POLICY
                .REJECT_WHOLE_FIXED_TICK_SPAWN_BATCH,
        retryPolicyId:
            ENEMY_ORBIT_CAPACITY_RETRY_POLICY
                .AUTHORED_STAGGER_AFTER_SLOT_AVAILABLE,
        wholeBatchZeroMutation: true,
        recoveryRequired: false
    });
    assert.equal(Object.isFrozen(BASIC_OCTA_ORBIT_CAPACITY_POLICY), true);
    assert.deepEqual({ ...BASIC_OCTA_FUTURE_TARGET_REACQUISITION_REQUIREMENT }, {
        currentSingleTowerLossPolicyId:
            ENEMY_ORBIT_TOWER_LOSS_POLICY.LATCH_CORE_FALLBACK,
        futurePolicyId:
            ENEMY_ORBIT_FUTURE_TARGET_REACQUISITION_POLICY
                .EXACT_LIVING_TOWER_ON_ROSTER_CHANGE,
        selectionPolicyId:
            ENEMY_ORBIT_FUTURE_TARGET_SELECTION_POLICY
                .LOWEST_ENTITY_ID_THEN_INCARNATION,
        requiredForTowerReappearance: true,
        requiredForMultipleLivingTowers: true,
        activeInCurrentSingleTowerRuntime: false
    });
    assert.equal(
        BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE.orbit.towerLossPolicy,
        ENEMY_ORBIT_TOWER_LOSS_POLICY.LATCH_CORE_FALLBACK
    );
    assert.equal(
        BASIC_OCTA_FUTURE_TARGET_REACQUISITION_REQUIREMENT
            .activeInCurrentSingleTowerRuntime,
        false
    );
});

test('raw O spawn은 unassigned lease와 program3 payload를 함께 갖고 lifecycle 외 materialize를 거부한다', () => {
    const rawIntent = createGpuEnemySpawnIntent({
        definition: BASIC_OCTA_ENEMY_DATA,
        route: FIXTURE_ROUTE,
        spawnSequence: 3
    });
    assert.equal(rawIntent.capabilityMask, 0xA47);
    assert.equal(rawIntent.orbitCoordinateSystemId,
        FORMATION_COORDINATE_SYSTEM.RING_SLOTS);
    assert.equal(rawIntent.orbitCoordinateSystemCode, 4);
    assert.equal(rawIntent.orbitSlotIndex, ENEMY_ORBIT_SLOT_UNASSIGNED);
    assert.equal(rawIntent.orbitSlotCapacity, 8);
    assert.equal(rawIntent.renderStyle.shapeCode, GPU_CIRCLE_BODY_RENDER_SHAPE.OCTA);
    assert.deepEqual({ ...rawIntent.enemyBehaviorState }, {
        programId: GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT,
        coordinateSystemCode: 4,
        orbitRadiusTiles: Math.fround(6),
        angularStepQ32: 2_848_189,
        orbitSlotIndex: ENEMY_ORBIT_SLOT_UNASSIGNED,
        orbitSlotCapacity: 8,
        flatReductionFixedPoint: 50,
        armoredFacetCount: 3,
        totalFacetCount: 8
    });
    assert.equal(hasAnyEnemyOrbitLeaseMetadata(rawIntent), true);
    assert.deepEqual({ ...normalizeEnemyOrbitSlotLease(rawIntent, {
        allowUnassigned: true,
        expectedSlotCapacity: 8
    }) }, {
        orbitCoordinateSystemId: FORMATION_COORDINATE_SYSTEM.RING_SLOTS,
        orbitCoordinateSystemCode: 4,
        orbitSlotIndex: ENEMY_ORBIT_SLOT_UNASSIGNED,
        orbitSlotCapacity: 8
    });
    assert.throws(() => normalizeEnemyOrbitSlotLease(rawIntent),
        /materialize되지 않았습니다/);
    assert.doesNotThrow(() => normalizeGpuSpawnIntent(rawIntent));
    assert.throws(() => normalizeGpuSpawnIntent({
        ...rawIntent,
        orbitSlotIndex: 0,
        enemyBehaviorState: {
            ...rawIntent.enemyBehaviorState,
            orbitSlotIndex: 0
        }
    }), /lifecycle sentinel/);
    assert.throws(() => normalizeGpuSpawnIntent({
        ...rawIntent,
        enemyBehaviorState: {
            ...rawIntent.enemyBehaviorState,
            orbitSlotCapacity: 7
        }
    }), /exact 동기화/);
    assert.throws(() => normalizeGpuSpawnIntent({
        ...rawIntent,
        capabilityMask: rawIntent.capabilityMask & ~ENEMY_CAPABILITY_BIT.ORBIT
    }), /ORBIT capability/);
});

test('O definition capability/profile forge와 automatic production wave 삽입을 거부한다', () => {
    assert.throws(() => normalizeEnemyDefinition(definitionSource(
        BASIC_OCTA_ENEMY_DATA,
        {
            capabilityIds: BASIC_OCTA_ENEMY_CAPABILITY_IDS.filter(
                (id) => id !== ENEMY_CAPABILITY_ID.DIRECTIONAL_DEFENSE
            )
        }
    ), ENEMY_PROFILE_CATALOG), /directionalDefense|DIRECTIONAL_DEFENSE/);
    assert.throws(() => normalizeEnemyDefinition(definitionSource(
        BASIC_OCTA_ENEMY_DATA,
        {
            capabilityIds: BASIC_OCTA_ENEMY_CAPABILITY_IDS.filter(
                (id) => id !== ENEMY_CAPABILITY_ID.ORBIT
            )
        }
    ), ENEMY_PROFILE_CATALOG), /orbit|ORBIT/);
    const productionGroup = CORRIDOR_EIGHT_WAVE_01_DATA.timeline[0]
        .spawnGroups[0];
    assert.equal(productionGroup.count, 32);
    assert.equal(productionGroup.intervalTicks, 5);
    assert.equal(
        Array.from(productionGroup.enemyDefinitionIds)
            .includes(BASIC_OCTA_ENEMY_DEFINITION_ID),
        false
    );
});
