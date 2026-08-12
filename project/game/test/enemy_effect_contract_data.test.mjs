import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ENEMY_EFFECT_APPLICATION_POLICY,
    ENEMY_EFFECT_ATOMIC_TRANSFORM_TRANSFER_POLICY,
    ENEMY_EFFECT_FAMILY,
    ENEMY_EFFECT_STACK_POLICY,
    ENEMY_EFFECT_TARGET_POLICY_CODE,
    ENEMY_EFFECT_TARGET_POLICY_ID,
    normalizeEnemyEffectCatalog,
    normalizeEnemyEffectDefinition,
    normalizeEnemyEffectEmitterProfile
} = await loadGameModule('ingame/contract/enemy_effect_contract.js');
const {
    ENEMY_EFFECT_CATALOG,
    ENEMY_EFFECT_DEFINITION_BY_ID,
    ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
    GPU_ENEMY_EFFECT_DEFINITION_CODE,
    GPU_ENEMY_EFFECT_EMITTER_DEFINITION_CODE,
    PENTA_BOOST_EFFECT_DEFINITION,
    PENTA_BOOST_EFFECT_DEFINITION_ID,
    PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE,
    PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_ID
} = await loadGameModule('data/object/enemy/enemy_effect_catalog_data.js');
const {
    BASIC_ARROW_ENEMY_DATA,
    BASIC_OCTA_ENEMY_DATA,
    BASIC_PENTA_ENEMY_DATA,
    BASIC_RHOM_ENEMY_DATA,
    BASIC_SQUARE_ENEMY_DATA,
    BASIC_TRIANGLE_ENEMY_DATA
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    ENEMY_PROFILE_CATALOG
} = await loadGameModule('data/object/enemy/enemy_profile_catalog_data.js');
const {
    ENEMY_CAPABILITY_BIT,
    ENEMY_CAPABILITY_ID
} = await loadGameModule('ingame/contract/enemy_capability_contract.js');
const {
    normalizeEnemyDefinition
} = await loadGameModule('ingame/contract/enemy_profile_contract.js');
const {
    GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY,
    GPU_ENEMY_EFFECT_EMITTER_ROSTER_PORT,
    createGpuEnemySpawnIntent
} = await loadGameModule('ingame/object/enemy/gpu_enemy_spawn_adapter.js');
const {
    createGpuRegistryMetadata,
    normalizeGpuSpawnIntent
} = await loadGameModule('ingame/object/gpu_spawn_intent.js');
const {
    GPU_CIRCLE_BODY_FIXED_POINT,
    GPU_CIRCLE_BODY_RENDER_SHAPE,
    GPU_CIRCLE_ENEMY_BEHAVIOR_STATE
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');
const {
    GPU_EFFECT_EMITTER_FLAG,
    GPU_EFFECT_LAST_PULSE_TICK_INVALID
} = await loadGameModule('ingame/physics/gpu/gpu_effect_runtime_abi.js');

const FIXTURE_ROUTE = Object.freeze({
    gateId: 'effect-contract-gate',
    pathId: 'effect-contract-path',
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
        routeClosureProfileId: definition.routeClosureProfileId,
        capabilityIds: definition.capabilityIds,
        render: definition.render,
        ...overrides
    };
}

function futureEffectFixture({
    id,
    code,
    family,
    stackPolicy,
    applicationPolicy,
    healthDeltaFixedPerTick = 0,
    moveSpeedMultiplier = 1
}) {
    return Object.freeze({
        id,
        effectDefinitionCode: code,
        family,
        stackPolicy,
        applicationPolicy,
        atomicTransformTransferPolicy:
            ENEMY_EFFECT_ATOMIC_TRANSFORM_TRANSFER_POLICY
                .STABLE_INSTANCE_ID_MODULO_DESTINATION_COUNT,
        durationTicks: 60,
        healthDeltaFixedPerTick,
        healthDeltaMinimumStackCount: 1,
        attackMultiplier: 1,
        attackMinimumStackCount: 1,
        moveSpeedMultiplier,
        towerContactDamageEffectModifiable: false,
        projectileTowerDamageEffectModifiable: false,
        directCoreImpactDamageEffectModifiable: false,
        typedProjectileCoreDamageEffectModifiable: false,
        tags: Object.freeze(['non-production-fixture', family])
    });
}

test('Boost/P production catalog의 stable ID, GPU code, authored 값을 고정한다', () => {
    assert.deepEqual({ ...GPU_ENEMY_EFFECT_DEFINITION_CODE }, {
        NONE: 0,
        PENTA_BOOST: 1
    });
    assert.deepEqual({ ...GPU_ENEMY_EFFECT_EMITTER_DEFINITION_CODE }, {
        NONE: 0,
        PENTA_CLUSTER_BOOST_PULSE: 1
    });
    assert.equal(PENTA_BOOST_EFFECT_DEFINITION_ID, 'penta-boost-01');
    assert.equal(
        PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_ID,
        'penta-cluster-boost-pulse-01'
    );
    assert.strictEqual(
        ENEMY_EFFECT_DEFINITION_BY_ID[PENTA_BOOST_EFFECT_DEFINITION_ID],
        PENTA_BOOST_EFFECT_DEFINITION
    );
    assert.strictEqual(
        ENEMY_EFFECT_EMITTER_PROFILE_BY_ID[
            PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_ID
        ],
        PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE
    );
    assert.equal(Object.isFrozen(ENEMY_EFFECT_CATALOG), true);
    assert.equal(Object.isFrozen(PENTA_BOOST_EFFECT_DEFINITION), true);
    assert.equal(Object.isFrozen(PENTA_BOOST_EFFECT_DEFINITION.tags), true);
    assert.equal(GPU_CIRCLE_BODY_FIXED_POINT.HEALTH_SCALE, 100);
    assert.deepEqual({
        id: PENTA_BOOST_EFFECT_DEFINITION.id,
        code: PENTA_BOOST_EFFECT_DEFINITION.effectDefinitionCode,
        family: PENTA_BOOST_EFFECT_DEFINITION.family,
        stackPolicy: PENTA_BOOST_EFFECT_DEFINITION.stackPolicy,
        applicationPolicy: PENTA_BOOST_EFFECT_DEFINITION.applicationPolicy,
        atomicTransformTransferPolicy:
            PENTA_BOOST_EFFECT_DEFINITION.atomicTransformTransferPolicy,
        durationTicks: PENTA_BOOST_EFFECT_DEFINITION.durationTicks,
        healthDeltaFixedPerTick:
            PENTA_BOOST_EFFECT_DEFINITION.healthDeltaFixedPerTick,
        healthDeltaMinimumStackCount:
            PENTA_BOOST_EFFECT_DEFINITION.healthDeltaMinimumStackCount,
        attackMultiplier: PENTA_BOOST_EFFECT_DEFINITION.attackMultiplier,
        attackMinimumStackCount:
            PENTA_BOOST_EFFECT_DEFINITION.attackMinimumStackCount,
        moveSpeedMultiplier: PENTA_BOOST_EFFECT_DEFINITION.moveSpeedMultiplier,
        towerModifiable:
            PENTA_BOOST_EFFECT_DEFINITION.towerContactDamageEffectModifiable,
        projectileTowerModifiable:
            PENTA_BOOST_EFFECT_DEFINITION.projectileTowerDamageEffectModifiable,
        directCoreModifiable:
            PENTA_BOOST_EFFECT_DEFINITION.directCoreImpactDamageEffectModifiable,
        typedProjectileCoreModifiable:
            PENTA_BOOST_EFFECT_DEFINITION.typedProjectileCoreDamageEffectModifiable
    }, {
        id: 'penta-boost-01',
        code: 1,
        family: 'boost',
        stackPolicy: 'active-instance-count',
        applicationPolicy: 'append-independent',
        atomicTransformTransferPolicy:
            'stable-instance-id-modulo-destination-count',
        durationTicks: 180,
        healthDeltaFixedPerTick: 1,
        healthDeltaMinimumStackCount: 1,
        attackMultiplier: 1.25,
        attackMinimumStackCount: 2,
        moveSpeedMultiplier: 1,
        towerModifiable: true,
        projectileTowerModifiable: true,
        directCoreModifiable: false,
        typedProjectileCoreModifiable: false
    });
    assert.deepEqual({ ...PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE }, {
        id: 'penta-cluster-boost-pulse-01',
        emitterDefinitionCode: 1,
        effectDefinitionId: 'penta-boost-01',
        effectDefinitionCode: 1,
        targetPolicyId: ENEMY_EFFECT_TARGET_POLICY_ID.HOSTILE_ENEMY,
        targetPolicyCode: ENEMY_EFFECT_TARGET_POLICY_CODE.HOSTILE_ENEMY,
        seekRadiusTiles: 8,
        clusterRadiusTiles: 3,
        minimumClusterMemberCount: 2,
        retargetIntervalTicks: 15,
        holdRadiusTiles: 2,
        pulseRadiusTiles: 6,
        initialPulseDelayTicks: 120,
        pulseIntervalTicks: 120,
        selfTargetAllowed: false,
        pentaTargetAllowed: true
    });
});

test('Effect contract는 strict schema, exact catalog reference와 positive cadence를 검증한다', () => {
    assert.throws(() => normalizeEnemyEffectDefinition({
        ...PENTA_BOOST_EFFECT_DEFINITION,
        unknownField: true
    }), /알 수 없는 필드/);
    assert.throws(() => normalizeEnemyEffectDefinition({
        ...PENTA_BOOST_EFFECT_DEFINITION,
        atomicTransformTransferPolicy: 'child-zero-only'
    }), /transfer policy/);
    assert.throws(() => normalizeEnemyEffectEmitterProfile({
        ...PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE,
        initialPulseDelayTicks: 0
    }), /initialPulseDelayTicks.*양의 uint32/);
    assert.throws(() => normalizeEnemyEffectEmitterProfile({
        ...PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE,
        targetPolicyCode: 2
    }), /targetPolicyId\/code/);
    assert.throws(() => normalizeEnemyEffectCatalog({
        effectDefinitions: [
            PENTA_BOOST_EFFECT_DEFINITION,
            {
                ...PENTA_BOOST_EFFECT_DEFINITION,
                id: 'duplicate-code'
            }
        ],
        emitterProfiles: [PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE]
    }), /중복 code/);
    assert.throws(() => normalizeEnemyEffectCatalog({
        effectDefinitions: [PENTA_BOOST_EFFECT_DEFINITION],
        emitterProfiles: [{
            ...PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE,
            effectDefinitionCode: 2
        }]
    }), /exact EffectDefinition ID\/code/);
});

test('Poison/Burn/Freeze non-production fixture는 별도 family/stack policy로 normalize된다', () => {
    const fixtures = Object.freeze([
        futureEffectFixture({
            id: 'fixture-poison-01',
            code: 101,
            family: ENEMY_EFFECT_FAMILY.POISON,
            stackPolicy: ENEMY_EFFECT_STACK_POLICY.SUM_ACTIVE_MAGNITUDE,
            applicationPolicy: ENEMY_EFFECT_APPLICATION_POLICY.APPEND_PER_SOURCE,
            healthDeltaFixedPerTick: -1
        }),
        futureEffectFixture({
            id: 'fixture-burn-01',
            code: 102,
            family: ENEMY_EFFECT_FAMILY.BURN,
            stackPolicy: ENEMY_EFFECT_STACK_POLICY.PER_INSTANCE,
            applicationPolicy: ENEMY_EFFECT_APPLICATION_POLICY.APPEND_INDEPENDENT,
            healthDeltaFixedPerTick: -2
        }),
        futureEffectFixture({
            id: 'fixture-freeze-01',
            code: 103,
            family: ENEMY_EFFECT_FAMILY.FREEZE,
            stackPolicy: ENEMY_EFFECT_STACK_POLICY.STRONGEST_ACTIVE,
            applicationPolicy: ENEMY_EFFECT_APPLICATION_POLICY.REPLACE_WEAKER,
            moveSpeedMultiplier: 0.5
        })
    ]);
    const normalized = fixtures.map((fixture) => (
        normalizeEnemyEffectDefinition(fixture)
    ));
    assert.deepEqual(normalized.map(({ family }) => family), [
        'poison',
        'burn',
        'freeze'
    ]);
    assert.equal(new Set(normalized.map(({ stackPolicy }) => stackPolicy)).size, 3);
    assert.equal(normalized.every(Object.isFrozen), true);
});

test('EnemyDefinition EFFECT_EMITTER/profile은 양방향이고 P behavior union과 shape code는 불변이다', () => {
    assert.equal(
        BASIC_PENTA_ENEMY_DATA.effectEmitterProfileId,
        PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_ID
    );
    assert.equal(
        BASIC_PENTA_ENEMY_DATA.capabilityIds.includes(
            ENEMY_CAPABILITY_ID.EFFECT_EMITTER
        ),
        true
    );
    assert.equal(BASIC_SQUARE_ENEMY_DATA.effectEmitterProfileId, null);
    assert.equal(
        BASIC_SQUARE_ENEMY_DATA.capabilityIds.includes(
            ENEMY_CAPABILITY_ID.EFFECT_EMITTER
        ),
        false
    );
    assert.equal(
        GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY
            .byCapabilityId[ENEMY_CAPABILITY_ID.EFFECT_EMITTER].implementationId,
        'gpu-pentagon-effect-emitter'
    );
    assert.strictEqual(
        GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY
            .byCapabilityId[ENEMY_CAPABILITY_ID.EFFECT_EMITTER].rosterPort,
        GPU_ENEMY_EFFECT_EMITTER_ROSTER_PORT
    );
    assert.deepEqual(Object.keys(GPU_ENEMY_EFFECT_EMITTER_ROSTER_PORT), [
        'observeLifecycle',
        'observeCompletedEvents',
        'stageForFixedTick',
        'observeFixedCommit',
        'getStatus',
        'requiresRecovery',
        'resetGpuBinding',
        'destroy'
    ]);
    assert.equal(
        Object.values(GPU_ENEMY_EFFECT_EMITTER_ROSTER_PORT)
            .every((method) => typeof method === 'function'),
        true
    );
    assert.throws(() => normalizeEnemyDefinition(definitionSource(
        BASIC_PENTA_ENEMY_DATA,
        { effectEmitterProfileId: null }
    ), ENEMY_PROFILE_CATALOG), /EFFECT_EMITTER capability/);
    assert.throws(() => normalizeEnemyDefinition(definitionSource(
        BASIC_SQUARE_ENEMY_DATA,
        { effectEmitterProfileId: PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_ID }
    ), ENEMY_PROFILE_CATALOG), /EFFECT_EMITTER capability/);
    assert.equal(GPU_CIRCLE_BODY_RENDER_SHAPE.PENTA, 4);
    assert.deepEqual({ ...GPU_CIRCLE_ENEMY_BEHAVIOR_STATE }, {
        NONE: 0,
        SEEK_TOWER: 1,
        WINDUP: 2,
        CHARGE: 3,
        CONTACT_RECOIL: 4,
        RECOVER: 5,
        CORE_FALLBACK: 6,
        ORBIT_TOWER: 7
    });
});

test('P spawn은 string authority를 GPU codes로 한 번 materialize하고 registry에는 primitive만 남긴다', () => {
    const intent = createGpuEnemySpawnIntent({
        definition: BASIC_PENTA_ENEMY_DATA,
        route: FIXTURE_ROUTE,
        spawnSequence: 1
    });
    assert.equal(intent.renderStyle.shapeCode, GPU_CIRCLE_BODY_RENDER_SHAPE.PENTA);
    assert.equal(intent.effectEmitterProfileId, 'penta-cluster-boost-pulse-01');
    assert.equal(intent.effectEmitterDefinitionCode, 1);
    assert.equal(intent.effectDefinitionId, 'penta-boost-01');
    assert.equal(intent.effectDefinitionCode, 1);
    assert.deepEqual({
        effectSelfTargetAllowed: intent.effectSelfTargetAllowed,
        effectPentaTargetAllowed: intent.effectPentaTargetAllowed,
        effectTowerContactDamageModifiable:
            intent.effectTowerContactDamageModifiable,
        effectProjectileTowerDamageModifiable:
            intent.effectProjectileTowerDamageModifiable,
        effectDirectCoreImpactDamageModifiable:
            intent.effectDirectCoreImpactDamageModifiable,
        effectProjectileCoreDamageModifiable:
            intent.effectProjectileCoreDamageModifiable,
        effectClusterRetargetIntervalTicks:
            intent.effectClusterRetargetIntervalTicks
    }, {
        effectSelfTargetAllowed: false,
        effectPentaTargetAllowed: true,
        effectTowerContactDamageModifiable: true,
        effectProjectileTowerDamageModifiable: true,
        effectDirectCoreImpactDamageModifiable: false,
        effectProjectileCoreDamageModifiable: false,
        effectClusterRetargetIntervalTicks: 15
    });
    assert.deepEqual({ ...intent.effectEmitterState }, {
        emitterDefinitionCode: 1,
        effectDefinitionCode: 1,
        lastPulseTick: GPU_EFFECT_LAST_PULSE_TICK_INVALID,
        flags: GPU_EFFECT_EMITTER_FLAG.ENABLED
    });
    assert.equal('enemyBehaviorState' in intent, false);

    const normalizedIntent = normalizeGpuSpawnIntent(intent);
    const metadata = createGpuRegistryMetadata(normalizedIntent);
    assert.deepEqual({
        effectEmitterProfileId: metadata.effectEmitterProfileId,
        effectEmitterDefinitionCode: metadata.effectEmitterDefinitionCode,
        effectDefinitionId: metadata.effectDefinitionId,
        effectDefinitionCode: metadata.effectDefinitionCode,
        effectSelfTargetAllowed: metadata.effectSelfTargetAllowed,
        effectPentaTargetAllowed: metadata.effectPentaTargetAllowed,
        effectTowerContactDamageModifiable:
            metadata.effectTowerContactDamageModifiable,
        effectProjectileTowerDamageModifiable:
            metadata.effectProjectileTowerDamageModifiable,
        effectDirectCoreImpactDamageModifiable:
            metadata.effectDirectCoreImpactDamageModifiable,
        effectProjectileCoreDamageModifiable:
            metadata.effectProjectileCoreDamageModifiable,
        effectClusterRetargetIntervalTicks:
            metadata.effectClusterRetargetIntervalTicks
    }, {
        effectEmitterProfileId: 'penta-cluster-boost-pulse-01',
        effectEmitterDefinitionCode: 1,
        effectDefinitionId: 'penta-boost-01',
        effectDefinitionCode: 1,
        effectSelfTargetAllowed: false,
        effectPentaTargetAllowed: true,
        effectTowerContactDamageModifiable: true,
        effectProjectileTowerDamageModifiable: true,
        effectDirectCoreImpactDamageModifiable: false,
        effectProjectileCoreDamageModifiable: false,
        effectClusterRetargetIntervalTicks: 15
    });
    assert.equal('effectEmitterState' in metadata, false);
    assert.equal(Object.values(metadata).every((value) => (
        value === null
            || value === undefined
            || typeof value === 'string'
            || typeof value === 'number'
            || typeof value === 'boolean'
    )), true);

    assert.throws(() => normalizeGpuSpawnIntent({
        ...intent,
        effectEmitterState: {
            ...intent.effectEmitterState,
            effectDefinitionCode: 2
        }
    }), /effectEmitterState code/);
    assert.throws(() => normalizeGpuSpawnIntent({
        ...intent,
        capabilityMask: intent.capabilityMask & ~ENEMY_CAPABILITY_BIT.EFFECT_EMITTER
    }), /EFFECT_EMITTER capability/);
    assert.throws(() => normalizeGpuSpawnIntent({
        ...intent,
        effectEmitterProfileId: 'forged-emitter-profile'
    }), /exact catalog profile\/definition/);
    assert.throws(() => normalizeGpuSpawnIntent({
        ...intent,
        effectDefinitionId: 'forged-effect-definition'
    }), /exact catalog profile\/definition/);
    assert.throws(() => normalizeGpuSpawnIntent({
        ...intent,
        effectEmitterDefinitionCode: 2,
        effectEmitterState: {
            ...intent.effectEmitterState,
            emitterDefinitionCode: 2
        }
    }), /exact catalog profile\/definition/);
    assert.throws(() => normalizeGpuSpawnIntent({
        ...intent,
        effectDefinitionCode: 2,
        effectEmitterState: {
            ...intent.effectEmitterState,
            effectDefinitionCode: 2
        }
    }), /exact catalog profile\/definition/);
    assert.throws(() => normalizeGpuSpawnIntent({
        ...intent,
        effectSelfTargetAllowed: true
    }), /exact catalog profile\/definition/);
    assert.throws(() => normalizeGpuSpawnIntent({
        ...intent,
        effectEmitterState: {
            ...intent.effectEmitterState,
            lastPulseTick: 1
        }
    }), /canonical sentinel/);
});

test('C/T/A/M/O spawn은 Effect runtime metadata나 P behavior state를 획득하지 않는다', () => {
    const definitions = [
        BASIC_SQUARE_ENEMY_DATA,
        BASIC_TRIANGLE_ENEMY_DATA,
        BASIC_ARROW_ENEMY_DATA,
        BASIC_RHOM_ENEMY_DATA,
        BASIC_OCTA_ENEMY_DATA
    ];
    for (let index = 0; index < definitions.length; index++) {
        const intent = createGpuEnemySpawnIntent({
            definition: definitions[index],
            route: FIXTURE_ROUTE,
            spawnSequence: index
        });
        assert.equal(
            (intent.capabilityMask & ENEMY_CAPABILITY_BIT.EFFECT_EMITTER) !== 0,
            false
        );
        for (const field of [
            'effectEmitterProfileId',
            'effectEmitterDefinitionCode',
            'effectDefinitionId',
            'effectDefinitionCode',
            'effectSelfTargetAllowed',
            'effectPentaTargetAllowed',
            'effectTowerContactDamageModifiable',
            'effectProjectileTowerDamageModifiable',
            'effectDirectCoreImpactDamageModifiable',
            'effectProjectileCoreDamageModifiable',
            'effectClusterRetargetIntervalTicks',
            'effectEmitterState'
        ]) {
            assert.equal(field in intent, false, `${definitions[index].id}.${field}`);
        }
    }
});

console.log('enemy effect contract/data: ok');
