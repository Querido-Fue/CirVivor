import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ENEMY_CAPABILITY_ID
} = await loadGameModule('ingame/contract/enemy_capability_contract.js');
const {
    ENEMY_ROUTE_CLOSURE_ACTIVATION_POLICY,
    ENEMY_ROUTE_CLOSURE_BLOCKING_MOTION_POLICY,
    ENEMY_ROUTE_CLOSURE_CONFLICT_POLICY,
    ENEMY_ROUTE_CLOSURE_NO_AVAILABLE_ROUTE_POLICY,
    ENEMY_ROUTE_CLOSURE_REOPEN_POLICY,
    ENEMY_ROUTE_CLOSURE_ROUTE_SELECTION_POLICY,
    ENEMY_ROUTE_CLOSURE_TRAPPED_POLICY,
    normalizeEnemyRouteClosureProfile,
    normalizeEnemyRouteClosureProfileCatalog
} = await loadGameModule('ingame/contract/enemy_route_closure_contract.js');
const {
    normalizeEnemyDefinition
} = await loadGameModule('ingame/contract/enemy_profile_contract.js');
const {
    BASIC_CORK_ENEMY_CAPABILITY_IDS,
    BASIC_CORK_ENEMY_CAPABILITY_MASK,
    BASIC_CORK_ENEMY_DATA,
    BASIC_CORK_ENEMY_DEFINITION_ID
} = await loadGameModule('data/object/enemy/basic_cork_enemy_data.js');
const {
    BASIC_CORK_ENEMY_DATA: BASIC_CORK_FROM_CATALOG,
    BASIC_SQUARE_ENEMY_DATA,
    INGAME_ENEMY_DEFINITIONS,
    INGAME_ENEMY_DEFINITION_BY_ID
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    CORK_BLOCKER_DIAMETER_TILES,
    CORK_EXPANDED_RADIUS_TILES,
    CORK_EXPANSION_DURATION_FIXED_TICKS,
    CORK_ROUTE_CLOSURE_PROFILE,
    CORK_ROUTE_CLOSURE_PROFILE_ID,
    ENEMY_ROUTE_CLOSURE_PROFILE_BY_CODE,
    ENEMY_ROUTE_CLOSURE_PROFILE_BY_ID,
    ENEMY_ROUTE_CLOSURE_PROFILE_CATALOG,
    GPU_ENEMY_ROUTE_CLOSURE_PROFILE_CODE
} = await loadGameModule(
    'data/object/enemy/enemy_route_closure_catalog_data.js'
);
const {
    CORK_ROUTE_CLOSURE_BEHAVIOR_PROFILE_ID,
    ENEMY_PROFILE_CATALOG
} = await loadGameModule('data/object/enemy/enemy_profile_catalog_data.js');
const {
    ENEMY_SHAPE_TYPES
} = await loadGameModule('data/object/enemy/enemy_catalog_data.js');

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
        atomicTransformProfileId: definition.atomicTransformProfileId,
        projectileCaptureProfileId: definition.projectileCaptureProfileId,
        routeClosureProfileId: definition.routeClosureProfileId,
        capabilityIds: definition.capabilityIds,
        render: definition.render,
        ...overrides
    };
}

test('Z route-closure profile은 path-width 6 단일 circle과 exact policy를 고정한다', () => {
    assert.deepEqual(GPU_ENEMY_ROUTE_CLOSURE_PROFILE_CODE, {
        NONE: 0,
        CORK_SINGLE_LOGICAL_CIRCLE: 1
    });
    assert.equal(CORK_ROUTE_CLOSURE_PROFILE_ID, 'cork-route-closure-01');
    assert.equal(CORK_BLOCKER_DIAMETER_TILES, 6);
    assert.equal(CORK_EXPANDED_RADIUS_TILES, 3);
    assert.equal(CORK_EXPANSION_DURATION_FIXED_TICKS, 60);
    assert.equal(Object.isFrozen(ENEMY_ROUTE_CLOSURE_PROFILE_CATALOG), true);
    assert.equal(Object.isFrozen(CORK_ROUTE_CLOSURE_PROFILE), true);
    assert.strictEqual(
        ENEMY_ROUTE_CLOSURE_PROFILE_BY_ID[CORK_ROUTE_CLOSURE_PROFILE_ID],
        CORK_ROUTE_CLOSURE_PROFILE
    );
    assert.strictEqual(
        ENEMY_ROUTE_CLOSURE_PROFILE_BY_CODE[1],
        CORK_ROUTE_CLOSURE_PROFILE
    );
    assert.deepEqual(CORK_ROUTE_CLOSURE_PROFILE, {
        id: 'cork-route-closure-01',
        definitionCode: 1,
        blockerDiameterTiles: 6,
        expandedRadiusTiles: 3,
        expansionDurationFixedTicks: 60,
        routeSelectionPolicyId:
            ENEMY_ROUTE_CLOSURE_ROUTE_SELECTION_POLICY
                .LOWEST_OPEN_PRIORITY_THEN_CLOSURE_ID,
        closureConflictPolicyId:
            ENEMY_ROUTE_CLOSURE_CONFLICT_POLICY.ONE_EXACT_OWNER_DUPLICATE_WAIT,
        closureActivationPolicyId:
            ENEMY_ROUTE_CLOSURE_ACTIVATION_POLICY.CLOSE_ON_EXPANSION_COMPLETE,
        noAvailableRoutePolicyId:
            ENEMY_ROUTE_CLOSURE_NO_AVAILABLE_ROUTE_POLICY.WAIT_AT_ROUTE_ENTRY,
        reopenPolicyId: ENEMY_ROUTE_CLOSURE_REOPEN_POLICY.EXACT_OWNER_DEATH,
        trappedPolicyId:
            ENEMY_ROUTE_CLOSURE_TRAPPED_POLICY
                .ADVANCE_CLEARANCE_THEN_WAIT_CAPABILITIES_CONTINUE,
        blockingMotionPolicyId:
            ENEMY_ROUTE_CLOSURE_BLOCKING_MOTION_POLICY
                .ANCHORED_KINEMATIC_AT_AUTHORED_ENTRANCE
    });
    assert.equal('helperCount' in CORK_ROUTE_CLOSURE_PROFILE, false);
    assert.equal('thicknessTiles' in CORK_ROUTE_CLOSURE_PROFILE, false);
});

test('route-closure profile normalizer는 accessor, extra, invalid geometry와 duplicate code를 거절한다', () => {
    let getterCalls = 0;
    const accessor = { ...CORK_ROUTE_CLOSURE_PROFILE };
    Object.defineProperty(accessor, 'expandedRadiusTiles', {
        enumerable: true,
        get() {
            getterCalls += 1;
            return 3;
        }
    });
    assert.throws(
        () => normalizeEnemyRouteClosureProfile(accessor),
        /enumerable own data field/
    );
    assert.equal(getterCalls, 0);
    assert.throws(() => normalizeEnemyRouteClosureProfile({
        ...CORK_ROUTE_CLOSURE_PROFILE,
        blockerDiameterTiles: 5
    }), /정확히 두 배/);
    assert.throws(() => normalizeEnemyRouteClosureProfile({
        ...CORK_ROUTE_CLOSURE_PROFILE,
        helperCount: 2
    }), /exact schema/);
    assert.throws(() => normalizeEnemyRouteClosureProfileCatalog({
        profiles: [
            CORK_ROUTE_CLOSURE_PROFILE,
            {
                ...CORK_ROUTE_CLOSURE_PROFILE,
                id: 'duplicate-code'
            }
        ]
    }), /중복 definition code/);
});

test('basic_cork_01은 common-C 수치와 ROUTE_CLOSURE profile/capability를 선언한다', () => {
    assert.equal(BASIC_CORK_ENEMY_DEFINITION_ID, 'basic_cork_01');
    assert.strictEqual(BASIC_CORK_FROM_CATALOG, BASIC_CORK_ENEMY_DATA);
    assert.strictEqual(
        INGAME_ENEMY_DEFINITION_BY_ID[BASIC_CORK_ENEMY_DEFINITION_ID],
        BASIC_CORK_ENEMY_DATA
    );
    assert.equal(INGAME_ENEMY_DEFINITIONS.includes(BASIC_CORK_ENEMY_DATA), true);
    assert.equal(BASIC_CORK_ENEMY_DATA.shapeDefinitionId, 'circle');
    assert.equal(
        BASIC_CORK_ENEMY_DATA.behaviorProfileId,
        CORK_ROUTE_CLOSURE_BEHAVIOR_PROFILE_ID
    );
    assert.equal(
        BASIC_CORK_ENEMY_DATA.routeClosureProfileId,
        CORK_ROUTE_CLOSURE_PROFILE_ID
    );
    assert.deepEqual(BASIC_CORK_ENEMY_CAPABILITY_IDS, [
        ENEMY_CAPABILITY_ID.NAVIGATION,
        ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
        ENEMY_CAPABILITY_ID.CORE_IMPACT,
        ENEMY_CAPABILITY_ID.ROUTE_CLOSURE
    ]);
    assert.equal(BASIC_CORK_ENEMY_CAPABILITY_MASK, 0x305);
    assert.equal(BASIC_CORK_ENEMY_DATA.physicsProfileId,
        BASIC_SQUARE_ENEMY_DATA.physicsProfileId);
    assert.equal(BASIC_CORK_ENEMY_DATA.combatProfileId,
        BASIC_SQUARE_ENEMY_DATA.combatProfileId);
    assert.deepEqual({
        maxHealth: BASIC_CORK_ENEMY_DATA.maxHealth,
        moveSpeedTilesPerSecond: BASIC_CORK_ENEMY_DATA.moveSpeedTilesPerSecond,
        collisionWeight: BASIC_CORK_ENEMY_DATA.collisionWeight,
        towerContactDamage: BASIC_CORK_ENEMY_DATA.towerContactDamage,
        coreImpactDamage: BASIC_CORK_ENEMY_DATA.coreImpactDamage,
        bountyBudget: BASIC_CORK_ENEMY_DATA.bountyBudget
    }, {
        maxHealth: 1,
        moveSpeedTilesPerSecond: 2.5,
        collisionWeight: 1,
        towerContactDamage: 0.1,
        coreImpactDamage: 1,
        bountyBudget: 1
    });
    for (const forbidden of [
        'helperBodyCount',
        'helperDefinitionId',
        'blockerThicknessTiles'
    ]) {
        assert.equal(forbidden in BASIC_CORK_ENEMY_DATA, false);
    }

    // 신규 GPU-only content는 CPU legacy pool shape roster를 확장하지 않습니다.
    assert.deepEqual(ENEMY_SHAPE_TYPES, [
        'square', 'triangle', 'arrow', 'hexa',
        'penta', 'rhom', 'octa', 'gen', 'jorang'
    ]);
    assert.equal(ENEMY_SHAPE_TYPES.includes('cork'), false);
});

test('ROUTE_CLOSURE capability와 routeClosureProfileId는 양방향이며 공통 capability를 요구한다', () => {
    assert.throws(() => normalizeEnemyDefinition(definitionSource(
        BASIC_CORK_ENEMY_DATA,
        {
            capabilityIds: BASIC_CORK_ENEMY_DATA.capabilityIds.filter(
                (id) => id !== ENEMY_CAPABILITY_ID.ROUTE_CLOSURE
            )
        }
    ), ENEMY_PROFILE_CATALOG), /ROUTE_CLOSURE/);
    assert.throws(() => normalizeEnemyDefinition(definitionSource(
        BASIC_CORK_ENEMY_DATA,
        { routeClosureProfileId: null }
    ), ENEMY_PROFILE_CATALOG), /ROUTE_CLOSURE/);
    for (const requiredId of [
        ENEMY_CAPABILITY_ID.NAVIGATION,
        ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
        ENEMY_CAPABILITY_ID.CORE_IMPACT
    ]) {
        assert.throws(() => normalizeEnemyDefinition(definitionSource(
            BASIC_CORK_ENEMY_DATA,
            {
                capabilityIds: BASIC_CORK_ENEMY_DATA.capabilityIds.filter(
                    (id) => id !== requiredId
                )
            }
        ), ENEMY_PROFILE_CATALOG));
    }
});

test('projectile은 physical collisionMask 0과 ENEMY interaction 경계를 유지한다', async () => {
    const projectileAdapterSource = await readFile(new URL(
        '../script/module/ingame/object/projectile/gpu_projectile_spawn_adapter.js',
        import.meta.url
    ), 'utf8');
    const enemyAdapterSource = await readFile(new URL(
        '../script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js',
        import.meta.url
    ), 'utf8');
    assert.match(projectileAdapterSource, /collisionMask:\s*0,/);
    assert.match(
        projectileAdapterSource,
        /interactionMask\s*=\s*GPU_CIRCLE_BODY_COLLISION_LAYER\.ENEMY\s*\|\s*GPU_CIRCLE_BODY_COLLISION_LAYER\.TERRAIN/
    );
    assert.match(
        enemyAdapterSource,
        /interactionLayer:\s*GPU_CIRCLE_BODY_COLLISION_LAYER\.ENEMY,/
    );
    assert.match(
        enemyAdapterSource,
        /interactionMask:\s*GPU_CIRCLE_BODY_COLLISION_LAYER\.PROJECTILE/
    );
});
