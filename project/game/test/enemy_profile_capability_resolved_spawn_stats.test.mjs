import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    BASIC_ARROW_ENEMY_DATA,
    BASIC_CIRCLE_ENEMY_DATA,
    BASIC_HEXA_ENEMY_DATA,
    BASIC_OCTA_ENEMY_DATA,
    BASIC_SQUARE_ENEMY_DATA,
    BASIC_TRIANGLE_ENEMY_DATA,
    INGAME_ENEMY_DEFINITION_BY_ID
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const { ARCHER_ENEMY_DATA: ARCHER_DEFINITION } = await loadGameModule(
    'data/object/enemy/archer_enemy_data.js'
);
const {
    CORRIDOR_EIGHT_MAP_DATA
} = await loadGameModule('data/scene/game/corridor_eight_map_data.js');
const {
    CORRIDOR_EIGHT_WAVE_01_DATA
} = await loadGameModule('data/scene/game/corridor_eight_wave_01_data.js');
const {
    ENEMY_CAPABILITY_BIT,
    ENEMY_CAPABILITY_BIT_BY_ID,
    ENEMY_CAPABILITY_ID,
    ENEMY_CAPABILITY_ROSTER_PORT_METHOD,
    assertEnemyCapabilityRegistry,
    assertEnemyCapabilityExactHandleRosterPort,
    assertEnemyDefinitionCapabilityImplementations,
    assertEnemyFixedCommandProducer,
    assertEnemyGameplayEventConsumer,
    assertEnemyLifecycleObserver,
    createEnemyCapabilityRegistry,
    createEnemyCapabilityMask,
    hasEnemyCapability,
    createEnemyCapabilityImplementationRegistry
} = await loadGameModule('ingame/contract/enemy_capability_contract.js');
const {
    normalizeEnemyDefinition,
    resolveEnemyDefinitionProfiles
} = await loadGameModule('ingame/contract/enemy_profile_contract.js');
const {
    ENEMY_PROFILE_CATALOG
} = await loadGameModule('data/object/enemy/enemy_profile_catalog_data.js');
const {
    createTileMap,
    TileMap
} = await loadGameModule('ingame/map/tile_map.js');
const { WaveDirector } = await loadGameModule('ingame/flow/wave_director.js');
const {
    GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY,
    GPU_ENEMY_CORE_IMPACT_ROSTER_PORT,
    createGpuEnemySpawnIntent
} = await loadGameModule('ingame/object/enemy/gpu_enemy_spawn_adapter.js');
const {
    ENEMY_SPAWN_STAT_ID,
    normalizeEnemyModifierSet,
    resolveEnemySpawnStats
} = await loadGameModule('ingame/object/enemy/resolved_enemy_spawn_stats.js');
const {
    createGpuRegistryMetadata
} = await loadGameModule('ingame/object/gpu_spawn_intent.js');
const {
    WorldRegistry
} = await loadGameModule('ingame/object/world_registry.js');
const {
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');

const ENEMY_CAPABILITY_CONTRACT_SOURCE = await readFile(
    new URL(
        '../script/module/ingame/contract/enemy_capability_contract.js',
        import.meta.url
    ),
    'utf8'
);
const ENEMY_SPAWN_ADAPTER_SOURCE = await readFile(
    new URL(
        '../script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js',
        import.meta.url
    ),
    'utf8'
);

const FIXTURE_ROUTE = Object.freeze({
    gateId: 'enemy-profile-test-gate',
    pathId: 'enemy-profile-test-path',
    waypoints: Object.freeze([
        Object.freeze({ x: 1, y: 2 }),
        Object.freeze({ x: 2, y: 2 })
    ])
});

function modifierScope(multipliers = {}, absolute = {}) {
    return { multipliers, absolute };
}

function modifierSet(global = {}, byEnemyDefinitionId = {}) {
    return { global, byEnemyDefinitionId };
}

function resolve(definition, mapEnemyModifiers, waveEnemyModifiers) {
    return resolveEnemySpawnStats({
        definition,
        mapEnemyModifiers,
        waveEnemyModifiers,
        knownDefinitionIds: Object.keys(INGAME_ENEMY_DEFINITION_BY_ID)
    });
}

function canonicalSource(definition, overrides = {}) {
    return {
        id: definition.id,
        spawnPolicy: definition.spawnPolicy,
        shapeDefinitionId: definition.shapeDefinitionId,
        physicsProfileId: definition.physicsProfileId,
        combatProfileId: definition.combatProfileId,
        behaviorProfileId: definition.behaviorProfileId,
        effectEmitterProfileId: definition.effectEmitterProfileId,
        formationDefinitionId: definition.formationDefinitionId,
        atomicTransformProfileId: definition.atomicTransformProfileId,
        projectileCaptureProfileId: definition.projectileCaptureProfileId,
        routeClosureProfileId: definition.routeClosureProfileId,
        capabilityIds: definition.capabilityIds,
        render: definition.render,
        ...overrides
    };
}

test('stable capability IDs, content-free contract, duplicate/missing registry, exact-handle port를 고정한다', () => {
    assert.equal(Object.isFrozen(ENEMY_CAPABILITY_ID), true);
    assert.deepEqual(Object.values(ENEMY_CAPABILITY_ID), [
        'enemy-navigation',
        'enemy-targeting',
        'enemy-contact-combat',
        'enemy-formation',
        'enemy-effect-emitter',
        'enemy-atomic-transform',
        'enemy-directional-defense',
        'enemy-projectile-capture',
        'enemy-route-closure',
        'enemy-core-impact',
        'enemy-charge',
        'enemy-orbit'
    ]);
    assert.equal(Object.isFrozen(ENEMY_CAPABILITY_ROSTER_PORT_METHOD), true);
    assert.equal(Object.isFrozen(ENEMY_CAPABILITY_BIT), true);
    assert.equal(Object.isFrozen(ENEMY_CAPABILITY_BIT_BY_ID), true);
    assert.deepEqual(Object.values(ENEMY_CAPABILITY_BIT), [
        0x001,
        0x002,
        0x004,
        0x008,
        0x010,
        0x020,
        0x040,
        0x080,
        0x100,
        0x200,
        0x400,
        0x800
    ]);
    const archerCapabilityMask = createEnemyCapabilityMask(
        ARCHER_DEFINITION.capabilityIds
    );
    assert.equal(
        hasEnemyCapability(archerCapabilityMask, ENEMY_CAPABILITY_ID.TARGETING),
        true
    );
    assert.equal(
        hasEnemyCapability(archerCapabilityMask, ENEMY_CAPABILITY_ID.FORMATION),
        false
    );
    assert.doesNotMatch(
        ENEMY_CAPABILITY_CONTRACT_SOURCE,
        /(?:from|import\()[^\n]*data\/object\/enemy/iu
    );

    assert.throws(() => createEnemyCapabilityImplementationRegistry([
        {
            capabilityId: ENEMY_CAPABILITY_ID.NAVIGATION,
            implementationId: 'one',
            assertDefinition() {}
        },
        {
            capabilityId: ENEMY_CAPABILITY_ID.NAVIGATION,
            implementationId: 'duplicate',
            assertDefinition() {}
        }
    ]), /중복 capability ID/);

    const navigationOnly = createEnemyCapabilityImplementationRegistry([
        {
            capabilityId: ENEMY_CAPABILITY_ID.NAVIGATION,
            implementationId: 'test-navigation',
            assertDefinition() {}
        }
    ]);
    assert.throws(
        () => assertEnemyDefinitionCapabilityImplementations(
            BASIC_SQUARE_ENEMY_DATA,
            navigationOnly
        ),
        /implementation이 등록되지 않았습니다: enemy-contact-combat/
    );
    assert.throws(
        () => assertEnemyCapabilityExactHandleRosterPort({}),
        /하나 이상의 roster method/
    );
    const port = {
        [ENEMY_CAPABILITY_ROSTER_PORT_METHOD.OBSERVE_LIFECYCLE]() {}
    };
    assert.strictEqual(assertEnemyCapabilityExactHandleRosterPort(port), port);
    assert.strictEqual(assertEnemyLifecycleObserver(port), port);
    const fixedAndEventPort = {
        [ENEMY_CAPABILITY_ROSTER_PORT_METHOD.OBSERVE_COMPLETED_EVENTS]() {},
        [ENEMY_CAPABILITY_ROSTER_PORT_METHOD.STAGE_FOR_FIXED_TICK]() {},
        [ENEMY_CAPABILITY_ROSTER_PORT_METHOD.OBSERVE_FIXED_COMMIT]() {}
    };
    assert.strictEqual(
        assertEnemyFixedCommandProducer(fixedAndEventPort),
        fixedAndEventPort
    );
    assert.strictEqual(
        assertEnemyGameplayEventConsumer(fixedAndEventPort),
        fixedAndEventPort
    );
    const namedRegistry = createEnemyCapabilityRegistry([{
        capabilityId: ENEMY_CAPABILITY_ID.CORE_IMPACT,
        implementationId: 'test-core-impact',
        rosterPort: fixedAndEventPort
    }]);
    assert.strictEqual(assertEnemyCapabilityRegistry(namedRegistry), namedRegistry);
    assert.strictEqual(
        GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY
            .byCapabilityId[ENEMY_CAPABILITY_ID.CORE_IMPACT].rosterPort,
        GPU_ENEMY_CORE_IMPACT_ROSTER_PORT
    );
    assert.doesNotThrow(() => assertEnemyDefinitionCapabilityImplementations(
        ARCHER_DEFINITION,
        GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY
    ));
});

test('모든 production definition은 frozen profile/capability를 해석하고 shape와 behavior는 독립이다', () => {
    const definitions = Object.values(INGAME_ENEMY_DEFINITION_BY_ID);
    assert.equal(definitions.length, 12);
    for (const definition of definitions) {
        const profiles = resolveEnemyDefinitionProfiles(definition, ENEMY_PROFILE_CATALOG);
        assert.equal(Object.isFrozen(definition), true);
        assert.equal(Object.isFrozen(definition.capabilityIds), true);
        assert.equal(Object.isFrozen(definition.render), true);
        assert.equal(Object.isFrozen(profiles), true);
        assert.equal(Object.isFrozen(profiles.physics), true);
        assert.equal(Object.isFrozen(profiles.combat), true);
        assert.equal(Object.isFrozen(profiles.behavior), true);
        assert.equal(definition.spawnPolicy, 'natural');
        assert.ok(definition.capabilityIds.includes(ENEMY_CAPABILITY_ID.NAVIGATION));
        assert.ok(definition.capabilityIds.includes(ENEMY_CAPABILITY_ID.CONTACT_COMBAT));
        assert.ok(definition.capabilityIds.includes(ENEMY_CAPABILITY_ID.CORE_IMPACT));
        assert.doesNotThrow(() => assertEnemyDefinitionCapabilityImplementations(
            definition,
            GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY
        ));
    }
    assert.equal(BASIC_ARROW_ENEMY_DATA.shapeDefinitionId, 'arrow');
    assert.equal(ARCHER_DEFINITION.shapeDefinitionId, 'arrow');
    assert.notEqual(
        BASIC_ARROW_ENEMY_DATA.behaviorProfileId,
        ARCHER_DEFINITION.behaviorProfileId
    );
    assert.ok(ARCHER_DEFINITION.capabilityIds.includes(ENEMY_CAPABILITY_ID.TARGETING));
    assert.equal(BASIC_ARROW_ENEMY_DATA.capabilityIds.includes(ENEMY_CAPABILITY_ID.TARGETING), false);
    assert.ok(BASIC_ARROW_ENEMY_DATA.capabilityIds.includes(ENEMY_CAPABILITY_ID.CHARGE));
    assert.equal(ARCHER_DEFINITION.capabilityIds.includes(ENEMY_CAPABILITY_ID.CHARGE), false);
    assert.equal(BASIC_OCTA_ENEMY_DATA.capabilityIds.includes(
        ENEMY_CAPABILITY_ID.TARGETING
    ), true);
    assert.equal(BASIC_OCTA_ENEMY_DATA.capabilityIds.includes(
        ENEMY_CAPABILITY_ID.DIRECTIONAL_DEFENSE
    ), true);
    assert.equal(BASIC_OCTA_ENEMY_DATA.capabilityIds.includes(
        ENEMY_CAPABILITY_ID.ORBIT
    ), true);
    assert.equal(
        createEnemyCapabilityMask(BASIC_OCTA_ENEMY_DATA.capabilityIds),
        0xA47
    );
    const arrowBehavior = resolveEnemyDefinitionProfiles(
        BASIC_ARROW_ENEMY_DATA,
        ENEMY_PROFILE_CATALOG
    ).behavior;
    assert.equal(arrowBehavior.id, 'arrow-tower-charge-01');
    assert.deepEqual({
        ...arrowBehavior.charge,
        telegraphColorRgba: [...arrowBehavior.charge.telegraphColorRgba]
    }, {
        windupTicks: 30,
        windupRangeTiles: 3,
        chargeSpeedTilesPerSecond: 6,
        chargeMaxTicks: 60,
        recoilImpulseTilesPerSecond: 4,
        recoilTicks: 12,
        recoverTicks: 30,
        telegraphStyleCode: 1,
        telegraphColorRgba: [1, 0.82, 0.2, 1],
        telegraphRadiusScale: 1.35
    });

    const squareArcherBehavior = normalizeEnemyDefinition({
        id: 'shape-independent-square-archer',
        spawnPolicy: ARCHER_DEFINITION.spawnPolicy,
        shapeDefinitionId: 'square',
        physicsProfileId: ARCHER_DEFINITION.physicsProfileId,
        combatProfileId: ARCHER_DEFINITION.combatProfileId,
        behaviorProfileId: ARCHER_DEFINITION.behaviorProfileId,
        formationDefinitionId: null,
        capabilityIds: ARCHER_DEFINITION.capabilityIds,
        render: ARCHER_DEFINITION.render
    }, ENEMY_PROFILE_CATALOG);
    assert.equal(squareArcherBehavior.shapeDefinitionId, 'square');
    assert.equal(
        squareArcherBehavior.behaviorProfileId,
        ARCHER_DEFINITION.behaviorProfileId
    );
    assert.equal(squareArcherBehavior.attackDefinitionId, ARCHER_DEFINITION.attackDefinitionId);

    assert.throws(() => normalizeEnemyDefinition(canonicalSource(
        ARCHER_DEFINITION,
        {
            id: 'archer-missing-targeting',
            capabilityIds: ARCHER_DEFINITION.capabilityIds.filter(
                (id) => id !== ENEMY_CAPABILITY_ID.TARGETING
            )
        }
    ), ENEMY_PROFILE_CATALOG), /TARGETING capability/);
    assert.throws(() => normalizeEnemyDefinition(canonicalSource(
        BASIC_ARROW_ENEMY_DATA,
        {
            id: 'basic-arrow-invalid-targeting',
            capabilityIds: [
                ...BASIC_ARROW_ENEMY_DATA.capabilityIds,
                ENEMY_CAPABILITY_ID.TARGETING
            ]
        }
    ), ENEMY_PROFILE_CATALOG), /TARGETING capability/);
    assert.throws(() => normalizeEnemyDefinition(canonicalSource(
        BASIC_SQUARE_ENEMY_DATA,
        {
            id: 'positive-contact-without-capability',
            capabilityIds: BASIC_SQUARE_ENEMY_DATA.capabilityIds.filter(
                (id) => id !== ENEMY_CAPABILITY_ID.CONTACT_COMBAT
            )
        }
    ), ENEMY_PROFILE_CATALOG), /CONTACT_COMBAT capability/);
    assert.throws(() => normalizeEnemyDefinition(canonicalSource(
        BASIC_SQUARE_ENEMY_DATA,
        {
            id: 'positive-core-impact-without-capability',
            capabilityIds: BASIC_SQUARE_ENEMY_DATA.capabilityIds.filter(
                (id) => id !== ENEMY_CAPABILITY_ID.CORE_IMPACT
            )
        }
    ), ENEMY_PROFILE_CATALOG), /CORE_IMPACT capability/);
    assert.throws(() => normalizeEnemyDefinition(canonicalSource(
        BASIC_HEXA_ENEMY_DATA,
        {
            id: 'hexa-missing-formation-capability',
            capabilityIds: BASIC_HEXA_ENEMY_DATA.capabilityIds.filter(
                (id) => id !== ENEMY_CAPABILITY_ID.FORMATION
            )
        }
    ), ENEMY_PROFILE_CATALOG), /FORMATION capability/);
    assert.throws(() => normalizeEnemyDefinition(canonicalSource(
        BASIC_HEXA_ENEMY_DATA,
        {
            id: 'hexa-missing-formation-definition',
            formationDefinitionId: null
        }
    ), ENEMY_PROFILE_CATALOG), /FORMATION capability/);
    assert.throws(() => normalizeEnemyDefinition(canonicalSource(
        BASIC_SQUARE_ENEMY_DATA,
        {
            id: 'square-forged-formation-definition',
            formationDefinitionId: BASIC_HEXA_ENEMY_DATA.formationDefinitionId
        }
    ), ENEMY_PROFILE_CATALOG), /FORMATION capability/);
});

test('Triangle T는 C baseline과 분리된 fast/light profile을 spawn 시 한 번 f32 resolve한다', () => {
    assert.notEqual(
        BASIC_TRIANGLE_ENEMY_DATA.physicsProfileId,
        BASIC_SQUARE_ENEMY_DATA.physicsProfileId
    );
    assert.notEqual(
        BASIC_TRIANGLE_ENEMY_DATA.combatProfileId,
        BASIC_SQUARE_ENEMY_DATA.combatProfileId
    );
    assert.notEqual(
        BASIC_TRIANGLE_ENEMY_DATA.behaviorProfileId,
        BASIC_SQUARE_ENEMY_DATA.behaviorProfileId
    );

    const triangleProfiles = resolveEnemyDefinitionProfiles(
        BASIC_TRIANGLE_ENEMY_DATA,
        ENEMY_PROFILE_CATALOG
    );
    assert.equal(triangleProfiles.physics.weight, 0.6);
    assert.equal(triangleProfiles.combat.maxHealth, 0.7);
    assert.equal(triangleProfiles.behavior.moveSpeedTilesPerSecond, 3.5);
    assert.equal(
        triangleProfiles.combat.towerContactDamage,
        ENEMY_PROFILE_CATALOG.combatById[BASIC_SQUARE_ENEMY_DATA.combatProfileId]
            .towerContactDamage
    );
    assert.equal(
        triangleProfiles.combat.coreImpactDamage,
        ENEMY_PROFILE_CATALOG.combatById[BASIC_SQUARE_ENEMY_DATA.combatProfileId]
            .coreImpactDamage
    );

    const intent = createGpuEnemySpawnIntent({
        definition: BASIC_TRIANGLE_ENEMY_DATA,
        route: FIXTURE_ROUTE,
        spawnSequence: 0
    });
    const resolvedWeight = Math.fround(0.6);
    assert.equal(intent.health, Math.fround(0.7));
    assert.equal(intent.flowSpeed, Math.fround(3.5));
    assert.equal(intent.velocity.x, Math.fround(3.5));
    assert.equal(intent.velocity.y, 0);
    assert.equal(intent.weight, resolvedWeight);
    assert.equal(intent.inverseMass, Math.fround(1 / resolvedWeight));
    assert.equal(intent.towerContactDamage, Math.fround(0.1));
    assert.equal(intent.coreImpactDamage, 1);
    assert.equal(intent.physicsProfileId, 'triangle-fast-light-physics-01');
    assert.equal(intent.combatProfileId, 'triangle-fast-light-combat-01');
    assert.equal(intent.behaviorProfileId, 'triangle-core-route-fast-01');
});

test('resolved stats는 identity, modifier precedence, absolute 마지막 승자와 final-only float32를 보장한다', () => {
    const identityStats = resolve(
        BASIC_SQUARE_ENEMY_DATA,
        createTileMap(CORRIDOR_EIGHT_MAP_DATA.id).getEnemyModifiers(),
        CORRIDOR_EIGHT_WAVE_01_DATA.enemyModifiers
    );
    assert.equal(identityStats.maxHealth, Math.fround(BASIC_SQUARE_ENEMY_DATA.maxHealth));
    assert.equal(
        identityStats.moveSpeedTilesPerSecond,
        Math.fround(BASIC_SQUARE_ENEMY_DATA.moveSpeedTilesPerSecond)
    );
    assert.equal(identityStats.weight, Math.fround(BASIC_SQUARE_ENEMY_DATA.collisionWeight));
    assert.equal(identityStats.inverseMass, Math.fround(1 / identityStats.weight));
    assert.equal(
        identityStats.towerContactDamage,
        Math.fround(BASIC_SQUARE_ENEMY_DATA.towerContactDamage)
    );
    assert.equal(identityStats.coreImpactDamage, BASIC_SQUARE_ENEMY_DATA.coreImpactDamage);
    assert.equal(identityStats.bountyBudget, BASIC_SQUARE_ENEMY_DATA.bountyBudget);
    assert.equal('pairCollisionRadiusScale' in identityStats, false);
    assert.deepEqual(Object.values(ENEMY_SPAWN_STAT_ID), [
        'maxHealth',
        'moveSpeedTilesPerSecond',
        'weight',
        'towerContactDamage',
        'coreImpactDamage',
        'bountyBudget'
    ]);

    const mapModifiers = modifierSet(
        modifierScope(
            {
                maxHealth: 2,
                moveSpeedTilesPerSecond: 1.0000001,
                coreImpactDamage: 2
            },
            { maxHealth: 7, coreImpactDamage: 7 }
        ),
        {
            [BASIC_SQUARE_ENEMY_DATA.id]: modifierScope(
                {
                    maxHealth: 3,
                    moveSpeedTilesPerSecond: 1.0000001,
                    coreImpactDamage: 3
                },
                { maxHealth: 8, coreImpactDamage: 8 }
            )
        }
    );
    const waveModifiers = modifierSet(
        modifierScope(
            {
                maxHealth: 5,
                moveSpeedTilesPerSecond: 1.000001,
                coreImpactDamage: 5
            },
            { maxHealth: 9, coreImpactDamage: 9 }
        ),
        {
            [BASIC_SQUARE_ENEMY_DATA.id]: modifierScope(
                { maxHealth: 11, coreImpactDamage: 11 },
                { maxHealth: 10, coreImpactDamage: 10 }
            )
        }
    );
    const resolved = resolve(BASIC_SQUARE_ENEMY_DATA, mapModifiers, waveModifiers);
    assert.equal(resolved.maxHealth, Math.fround(10));
    assert.equal(resolved.coreImpactDamage, 10);
    const rawSpeed = BASIC_SQUARE_ENEMY_DATA.moveSpeedTilesPerSecond
        * 1.0000001 * 1.0000001 * 1.000001;
    const stagedSpeed = Math.fround(
        Math.fround(
            Math.fround(BASIC_SQUARE_ENEMY_DATA.moveSpeedTilesPerSecond * 1.0000001)
            * 1.0000001
        ) * 1.000001
    );
    assert.equal(resolved.moveSpeedTilesPerSecond, Math.fround(rawSpeed));
    assert.notEqual(
        resolved.moveSpeedTilesPerSecond,
        stagedSpeed,
        'modifier 단계마다 f32 round하면 final-only policy를 위반합니다.'
    );

    const authoredWeight = 0.010000246913578;
    const exactMass = resolve(BASIC_SQUARE_ENEMY_DATA, modifierSet(
        modifierScope({}, { weight: authoredWeight })
    ), {});
    assert.equal(exactMass.weight, Math.fround(authoredWeight));
    assert.equal(exactMass.inverseMass, Math.fround(1 / exactMass.weight));
    assert.notEqual(
        exactMass.inverseMass,
        Math.fround(1 / authoredWeight),
        'inverseMass는 raw authoring 값이 아니라 반환된 final f32 weight에서 파생해야 합니다.'
    );
});

test('custom fixture HP는 canonical profile view 덮어쓰기가 아니라 exact resolvedStats로 주입한다', () => {
    const fixtureDefinition = Object.freeze({
        ...BASIC_CIRCLE_ENEMY_DATA,
        id: 'resolved-stats-custom-fixture'
    });
    const fixtureStats = resolveEnemySpawnStats({
        definition: fixtureDefinition,
        waveEnemyModifiers: modifierSet(
            modifierScope({}, { maxHealth: 20 })
        )
    });
    const intent = createGpuEnemySpawnIntent({
        definition: fixtureDefinition,
        route: FIXTURE_ROUTE,
        spawnSequence: 0,
        resolvedStats: fixtureStats
    });

    assert.equal(BASIC_CIRCLE_ENEMY_DATA.maxHealth, 1);
    assert.equal(fixtureStats.maxHealth, Math.fround(20));
    assert.equal(intent.health, fixtureStats.maxHealth);
    assert.equal(intent.physicsProfileId, fixtureDefinition.physicsProfileId);
    assert.equal(intent.combatProfileId, fixtureDefinition.combatProfileId);
    assert.equal(intent.behaviorProfileId, fixtureDefinition.behaviorProfileId);
});

test('modifier source mutation은 resolved 값과 WaveDirector immutable schedule input에 영향을 주지 않는다', () => {
    const mutableMapModifiers = modifierSet(
        modifierScope({ maxHealth: 2 }),
        {}
    );
    const mutableWaveModifiers = modifierSet(
        modifierScope({ maxHealth: 3 }),
        {}
    );
    const resolvedBeforeMutation = resolve(
        BASIC_SQUARE_ENEMY_DATA,
        mutableMapModifiers,
        mutableWaveModifiers
    );
    mutableMapModifiers.global.multipliers.maxHealth = 100;
    mutableWaveModifiers.global.multipliers.maxHealth = 100;
    assert.equal(resolvedBeforeMutation.maxHealth, Math.fround(6));
    assert.equal(Object.isFrozen(resolvedBeforeMutation), true);

    const mapDefinition = {
        ...CORRIDOR_EIGHT_MAP_DATA,
        enemyModifiers: modifierSet(modifierScope({ maxHealth: 2 }), {})
    };
    const waveDefinition = {
        waveId: 'queue-time-stats-wave',
        mapId: mapDefinition.id,
        enemyModifiers: modifierSet(modifierScope({ maxHealth: 3 }), {}),
        timeline: [{
            timelineEntryId: 'queue-time-stats-entry',
            type: 'SPAWN_GROUP',
            spawnGroup: {
                groupId: 'queue-time-stats-group',
                enemyDefinitionId: BASIC_SQUARE_ENEMY_DATA.id,
                routeBinding: {
                    gateId: mapDefinition.enemySpawnRoutes[0].gateId,
                    pathId: mapDefinition.enemySpawnRoutes[0].pathId
                },
                count: 1,
                policyId: 'corebound',
                laneOffsetsTiles: [0]
            }
        }]
    };
    const tileMap = new TileMap(mapDefinition);
    const director = new WaveDirector({ waveDefinition });
    assert.equal(director.init(tileMap), true);
    assert.equal('intent' in director.schedule[0], false);
    mapDefinition.enemyModifiers.global.multipliers.maxHealth = 99;
    waveDefinition.enemyModifiers.global.multipliers.maxHealth = 99;

    const queued = [];
    assert.equal(director.queueSpawnsForFixedTick(1, {
        requestSpawnBatch(requests) {
            queued.push(...requests);
            return {
                accepted: true,
                requestedCount: requests.length,
                queuedCount: requests.length
            };
        }
    }), 1);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].targetFixedTick, 1);
    assert.equal(
        queued[0].commandId,
        'authored-wave-spawn:queue-time-stats-wave:queue-time-stats-entry:queue-time-stats-group:spawn-0'
    );
    assert.equal(queued[0].intent.health, Math.fround(6));
    director.destroy();
});

test('invalid modifier/profile numbers는 fail-fast하고 intent는 continuous contact 및 allowlisted metadata만 전달한다', () => {
    assert.throws(() => normalizeEnemyModifierSet({
        global: modifierScope({ unknownStat: 1 })
    }), /알 수 없는 enemy stat field/);
    assert.throws(() => normalizeEnemyModifierSet({
        global: modifierScope({ pairCollisionRadiusScale: 1 })
    }), /알 수 없는 enemy stat field/);
    assert.throws(() => normalizeEnemyModifierSet(modifierSet({}, {
        unknown_enemy: modifierScope({ maxHealth: 1 })
    }), {
        knownDefinitionIds: Object.keys(INGAME_ENEMY_DEFINITION_BY_ID)
    }), /등록되지 않은 enemy definition ID/);
    assert.throws(() => resolve(BASIC_SQUARE_ENEMY_DATA, modifierSet(
        modifierScope({}, { weight: 0 })
    ), {}), /resolved weight/);
    assert.throws(() => resolve(BASIC_SQUARE_ENEMY_DATA, modifierSet(
        modifierScope({}, { towerContactDamage: -1 })
    ), {}), /resolved towerContactDamage/);

    const contactlessCanonical = Object.freeze({
        ...BASIC_SQUARE_ENEMY_DATA,
        capabilityIds: Object.freeze([
            ENEMY_CAPABILITY_ID.NAVIGATION
        ])
    });
    assert.throws(() => createGpuEnemySpawnIntent({
        definition: contactlessCanonical,
        route: FIXTURE_ROUTE,
        spawnSequence: 8
    }), /CONTACT_COMBAT capability/);

    const intent = createGpuEnemySpawnIntent({
        definition: BASIC_SQUARE_ENEMY_DATA,
        route: FIXTURE_ROUTE,
        spawnSequence: 9
    });
    assert.equal(
        intent.collisionMask,
        GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN
            | GPU_CIRCLE_BODY_COLLISION_LAYER.ROUTE_BLOCKER
    );
    assert.equal(
        intent.interactionMask,
        GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.CORE_PROXY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
    );
    assert.equal(
        intent.contactHandler.flags,
        GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS
    );
    assert.equal(intent.contactHandler.damageSelf, 0);
    assert.equal(
        intent.contactHandler.damageOther,
        Math.fround(BASIC_SQUARE_ENEMY_DATA.towerContactDamage)
    );
    assert.equal(
        intent.contactHandler.targetInteractionLayerMask,
        GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
    );
    assert.equal('capabilityIds' in intent, false);
    const expectedCapabilityMask = createEnemyCapabilityMask(
        BASIC_SQUARE_ENEMY_DATA.capabilityIds
    );
    assert.equal(intent.capabilityMask, expectedCapabilityMask);
    const metadata = createGpuRegistryMetadata(intent);
    assert.deepEqual({
        definitionId: metadata.definitionId,
        capabilityMask: metadata.capabilityMask,
        physicsProfileId: metadata.physicsProfileId,
        combatProfileId: metadata.combatProfileId,
        behaviorProfileId: metadata.behaviorProfileId,
        coreImpactDamage: metadata.coreImpactDamage,
        towerContactDamage: metadata.towerContactDamage,
        bountyBudget: metadata.bountyBudget,
        weight: metadata.weight
    }, {
        definitionId: BASIC_SQUARE_ENEMY_DATA.id,
        capabilityMask: expectedCapabilityMask,
        physicsProfileId: BASIC_SQUARE_ENEMY_DATA.physicsProfileId,
        combatProfileId: BASIC_SQUARE_ENEMY_DATA.combatProfileId,
        behaviorProfileId: BASIC_SQUARE_ENEMY_DATA.behaviorProfileId,
        coreImpactDamage: BASIC_SQUARE_ENEMY_DATA.coreImpactDamage,
        towerContactDamage: Math.fround(BASIC_SQUARE_ENEMY_DATA.towerContactDamage),
        bountyBudget: BASIC_SQUARE_ENEMY_DATA.bountyBudget,
        weight: Math.fround(BASIC_SQUARE_ENEMY_DATA.collisionWeight)
    });
    assert.equal('capabilityIds' in metadata, false);
    const arrowIntent = createGpuEnemySpawnIntent({
        definition: BASIC_ARROW_ENEMY_DATA,
        route: FIXTURE_ROUTE,
        spawnSequence: 10
    });
    assert.equal(
        arrowIntent.enemyBehaviorState.programId,
        GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.ARROW_TOWER_CHARGE
    );
    assert.equal(arrowIntent.enemyBehaviorState.windupTicks, 30);
    assert.equal(arrowIntent.enemyBehaviorState.chargeMaxTicks, 60);
    assert.equal(
        GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY
            .byCapabilityId[ENEMY_CAPABILITY_ID.CHARGE].implementationId,
        'gpu-exact-tower-charge'
    );
    assert.equal(
        'enemyBehaviorState' in createGpuRegistryMetadata(arrowIntent),
        false
    );
    const registry = new WorldRegistry({ capacity: 1 });
    const handle = registry.reserveEntity({
        kindId: intent.kindId,
        definitionId: intent.definitionId,
        createdAtTick: 1
    });
    assert.equal(registry.activateReserved(handle, metadata), true);
    assert.equal(
        registry.copyEntityView(handle, {}).metadata.capabilityMask,
        expectedCapabilityMask
    );
    registry.destroy();
    assert.doesNotMatch(ENEMY_SPAWN_ADAPTER_SOURCE, /\bnew\s+\w*(?:Enemy|AI|Capability)\b/u);
});

console.log('enemy profile/capability/resolved spawn stats contract: ok');
