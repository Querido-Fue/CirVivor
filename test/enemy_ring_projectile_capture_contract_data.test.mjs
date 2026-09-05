import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const localValue = (value) => JSON.parse(JSON.stringify(value));

const {
    ENEMY_CAPABILITY_ID
} = await loadGameModule('ingame/contract/enemy_capability_contract.js');
const {
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');
const {
    PROJECTILE_CAPTURE_CAPTOR_CORE_IMPACT_POLICY,
    PROJECTILE_CAPTURE_CAPTOR_DEATH_POLICY,
    PROJECTILE_CAPTURE_EXIT_POLICY,
    PROJECTILE_CAPTURE_FUNNEL_BOUNDARY_POLICY,
    PROJECTILE_CAPTURE_FUNNEL_APPROACH_POLICY,
    PROJECTILE_CAPTURE_FUNNEL_FACING_POLICY,
    PROJECTILE_CAPTURE_LIFETIME_POLICY,
    PROJECTILE_CAPTURE_POLICY_ID,
    PROJECTILE_CAPTURE_PROJECTILE_DEATH_POLICY,
    PROJECTILE_CAPTURE_RELEASE_AIM_POLICY,
    PROJECTILE_CAPTURE_RELEASE_SPEED_POLICY,
    PROJECTILE_CAPTURE_TERMINAL_POLICY,
    PROJECTILE_CAPTURE_VISIBILITY_POLICY,
    PROJECTILE_ORIGIN_PROVENANCE_KEYS,
    PROJECTILE_ORIGIN_PROVENANCE_SCHEMA_VERSION,
    normalizeEnemyProjectileCaptureProfile,
    normalizeEnemyProjectileCaptureProfileCatalog,
    normalizeProjectileLogicalMetadata,
    normalizeProjectileOriginProvenance
} = await loadGameModule('ingame/contract/projectile_capture_contract.js');
const {
    PROJECTILE_TARGET_POLICY_ID
} = await loadGameModule('ingame/contract/projectile_target_policy_contract.js');
const {
    normalizeEnemyDefinition
} = await loadGameModule('ingame/contract/enemy_profile_contract.js');
const {
    BASIC_RING_ENEMY_CAPABILITY_IDS,
    BASIC_RING_ENEMY_CAPABILITY_MASK,
    BASIC_RING_ENEMY_DATA,
    BASIC_RING_ENEMY_DEFINITION_ID
} = await loadGameModule('data/object/enemy/basic_ring_enemy_data.js');
const {
    GPU_ENEMY_PROJECTILE_CAPTURE_PROFILE_CODE,
    ENEMY_PROJECTILE_CAPTURE_PROFILE_BY_CODE,
    ENEMY_PROJECTILE_CAPTURE_PROFILE_BY_ID,
    ENEMY_PROJECTILE_CAPTURE_PROFILE_CATALOG,
    RING_PROJECTILE_CAPTURE_DELAY_FIXED_TICKS,
    RING_PROJECTILE_CAPTURE_EXIT_CLEARANCE_TILES,
    RING_PROJECTILE_CAPTURE_FUNNEL_HALF_ANGLE_RADIANS,
    RING_PROJECTILE_CAPTURE_PROFILE,
    RING_PROJECTILE_CAPTURE_PROFILE_ID,
    RING_PROJECTILE_CAPTURE_SLOT_CAPACITY
} = await loadGameModule(
    'data/object/enemy/enemy_projectile_capture_catalog_data.js'
);
const {
    BASIC_RING_ENEMY_DATA: BASIC_RING_FROM_CATALOG,
    BASIC_SQUARE_ENEMY_DATA,
    INGAME_ENEMY_DEFINITIONS,
    INGAME_ENEMY_DEFINITION_BY_ID
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    ENEMY_PROFILE_CATALOG
} = await loadGameModule('data/object/enemy/enemy_profile_catalog_data.js');
const {
    ENEMY_SHAPE_TYPES
} = await loadGameModule('data/object/enemy/enemy_catalog_data.js');
const {
    ENEMY_NORMALIZED_RENDER_GEOMETRY,
    ENEMY_SHAPE_GEOMETRY,
    ENEMY_SHAPE_PATH_KIND,
    LEGACY_SQUARE_ENEMY_COLLISION_RADIUS_TILES,
    RING_ENEMY_INNER_RADIUS,
    RING_ENEMY_OUTER_RADIUS,
    RING_ENEMY_SEGMENT_COUNT
} = await loadGameModule('data/object/enemy/enemy_shape_geometry_data.js');
const {
    BASIC_BULLET_LOGICAL_PROJECTILE_METADATA,
    BASIC_BULLET_PROJECTILE_DATA,
    BASIC_BULLET_PROJECTILE_DEFINITION_ID
} = await loadGameModule('data/object/projectile/basic_bullet_data.js');

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
        siegeWeight: definition.siegeWeight,
        capabilityIds: definition.capabilityIds,
        render: definition.render,
        ...overrides
    };
}

function originProvenance(overrides = {}) {
    return {
        schemaVersion: PROJECTILE_ORIGIN_PROVENANCE_SCHEMA_VERSION,
        archetypeId: 'fireball_01',
        wordTagMask: 0x15,
        modifierSetId: 'modifier-set-7',
        sourceExecutionId: 'sentence-execution-11',
        projectileGeneration: 3,
        originProducerId: 'tower-fireball-producer',
        originSourceAbilityId: 'fireball-ability',
        originOwnerEntityId: 17,
        originOwnerIncarnation: 4,
        originSourceEntityId: 19,
        originSourceIncarnation: 2,
        originTargetEntityId: null,
        originTargetIncarnation: null,
        ...overrides
    };
}

test('R capture catalog은 single-slot 60-tick inclusive funnel과 exact release policy를 고정한다', () => {
    assert.deepEqual(localValue(GPU_ENEMY_PROJECTILE_CAPTURE_PROFILE_CODE), {
        NONE: 0,
        RING_SINGLE_SLOT: 1
    });
    assert.equal(RING_PROJECTILE_CAPTURE_PROFILE_ID, 'ring-projectile-capture-01');
    assert.equal(RING_PROJECTILE_CAPTURE_SLOT_CAPACITY, 1);
    assert.equal(RING_PROJECTILE_CAPTURE_DELAY_FIXED_TICKS, 60);
    assert.equal(RING_PROJECTILE_CAPTURE_FUNNEL_HALF_ANGLE_RADIANS, Math.PI / 4);
    assert.equal(RING_PROJECTILE_CAPTURE_EXIT_CLEARANCE_TILES, 1 / 1024);
    assert.equal(Object.isFrozen(ENEMY_PROJECTILE_CAPTURE_PROFILE_CATALOG), true);
    assert.equal(Object.isFrozen(RING_PROJECTILE_CAPTURE_PROFILE), true);
    assert.strictEqual(
        ENEMY_PROJECTILE_CAPTURE_PROFILE_BY_ID[RING_PROJECTILE_CAPTURE_PROFILE_ID],
        RING_PROJECTILE_CAPTURE_PROFILE
    );
    assert.strictEqual(
        ENEMY_PROJECTILE_CAPTURE_PROFILE_BY_CODE[1],
        RING_PROJECTILE_CAPTURE_PROFILE
    );
    assert.deepEqual(localValue(RING_PROJECTILE_CAPTURE_PROFILE), {
        id: 'ring-projectile-capture-01',
        definitionCode: 1,
        slotCapacity: 1,
        captureDelayFixedTicks: 60,
        captureTeamId: GAMEPLAY_TEAM_ID.PLAYER,
        funnelHalfAngleRadians: Math.PI / 4,
        funnelBoundaryPolicy: PROJECTILE_CAPTURE_FUNNEL_BOUNDARY_POLICY.INCLUSIVE,
        funnelApproachPolicy:
            PROJECTILE_CAPTURE_FUNNEL_APPROACH_POLICY
                .RELATIVE_VELOCITY_STRICTLY_CLOSING,
        funnelFacingPolicy:
            PROJECTILE_CAPTURE_FUNNEL_FACING_POLICY.LAST_NONZERO_ROUTE_VELOCITY,
        capturedVisibilityPolicy: PROJECTILE_CAPTURE_VISIBILITY_POLICY.HIDDEN,
        capturedLifetimePolicy:
            PROJECTILE_CAPTURE_LIFETIME_POLICY.CONTINUE_WHILE_CAPTURED,
        releaseTeamId: GAMEPLAY_TEAM_ID.HOSTILE,
        releaseSpeedPolicy:
            PROJECTILE_CAPTURE_RELEASE_SPEED_POLICY.PRESERVE_CAPTURED_SPEED,
        releaseAimPolicy:
            PROJECTILE_CAPTURE_RELEASE_AIM_POLICY
                .EXACT_LIVING_TOWER_THEN_STORED_FORWARD,
        releaseTargetPolicyId:
            PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
        exitPolicy: PROJECTILE_CAPTURE_EXIT_POLICY.CAPTOR_FORWARD_OUTSIDE_RADII,
        exitClearanceTiles: 1 / 1024,
        captorDeathPolicy:
            PROJECTILE_CAPTURE_CAPTOR_DEATH_POLICY.RELEASE_HOSTILE_FORWARD,
        captorCoreImpactPolicy:
            PROJECTILE_CAPTURE_CAPTOR_CORE_IMPACT_POLICY.RELEASE_HOSTILE_FORWARD,
        projectileDeathPolicy:
            PROJECTILE_CAPTURE_PROJECTILE_DEATH_POLICY.CLEAR_SLOT_NO_RELEASE,
        terminalPolicy:
            PROJECTILE_CAPTURE_TERMINAL_POLICY.TOMBSTONE_HELD_UNPUBLISHED
    });
    assert.equal('funnelCosineThreshold' in RING_PROJECTILE_CAPTURE_PROFILE, false);
    assert.equal(
        Object.values(PROJECTILE_CAPTURE_RELEASE_AIM_POLICY).includes(
            'exact-living-tower-then-core-then-forward'
        ),
        false
    );
});

test('R profile normalizer는 phantom Core fallback, accessor, extra와 duplicate code를 거절한다', () => {
    assert.throws(() => normalizeEnemyProjectileCaptureProfile({
        ...RING_PROJECTILE_CAPTURE_PROFILE,
        funnelApproachPolicy: 'allow-outbound-overlap'
    }), /알려진 projectile capture policy/);
    assert.throws(() => normalizeEnemyProjectileCaptureProfile({
        ...RING_PROJECTILE_CAPTURE_PROFILE,
        releaseAimPolicy: 'exact-living-tower-then-core-then-forward'
    }), /알려진 projectile capture policy/);
    assert.throws(() => normalizeEnemyProjectileCaptureProfile({
        ...RING_PROJECTILE_CAPTURE_PROFILE,
        releaseTargetPolicyId: PROJECTILE_TARGET_POLICY_ID.CORE_PROXY_AND_TERRAIN
    }), /PLAYER_DAMAGEABLE_AND_TERRAIN/);

    let getterCalls = 0;
    const accessor = { ...RING_PROJECTILE_CAPTURE_PROFILE };
    Object.defineProperty(accessor, 'captureDelayFixedTicks', {
        enumerable: true,
        get() {
            getterCalls += 1;
            return 60;
        }
    });
    assert.throws(
        () => normalizeEnemyProjectileCaptureProfile(accessor),
        /getter\/setter/
    );
    assert.equal(getterCalls, 0);
    assert.throws(() => normalizeEnemyProjectileCaptureProfile({
        ...RING_PROJECTILE_CAPTURE_PROFILE,
        unknownPolicy: true
    }), /exact id\/definitionCode/);
    assert.throws(() => normalizeEnemyProjectileCaptureProfileCatalog({
        profiles: [
            RING_PROJECTILE_CAPTURE_PROFILE,
            {
                ...RING_PROJECTILE_CAPTURE_PROFILE,
                id: 'duplicate-code-profile'
            }
        ]
    }), /중복 definition code/);
});

test('basic_ring_01은 common-C stats와 capture bit/profile을 GPU definition catalog에서만 갖는다', () => {
    assert.equal(BASIC_RING_ENEMY_DEFINITION_ID, 'basic_ring_01');
    assert.strictEqual(BASIC_RING_FROM_CATALOG, BASIC_RING_ENEMY_DATA);
    assert.strictEqual(
        INGAME_ENEMY_DEFINITION_BY_ID[BASIC_RING_ENEMY_DEFINITION_ID],
        BASIC_RING_ENEMY_DATA
    );
    assert.equal(INGAME_ENEMY_DEFINITIONS.includes(BASIC_RING_ENEMY_DATA), true);
    assert.equal(BASIC_RING_ENEMY_DATA.shapeDefinitionId, 'ring');
    assert.equal(
        BASIC_RING_ENEMY_DATA.projectileCaptureProfileId,
        RING_PROJECTILE_CAPTURE_PROFILE_ID
    );
    assert.deepEqual(Array.from(BASIC_RING_ENEMY_CAPABILITY_IDS), [
        ENEMY_CAPABILITY_ID.NAVIGATION,
        ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
        ENEMY_CAPABILITY_ID.CORE_IMPACT,
        ENEMY_CAPABILITY_ID.PROJECTILE_CAPTURE
    ]);
    assert.equal(BASIC_RING_ENEMY_CAPABILITY_MASK, 0x285);
    assert.equal(
        BASIC_RING_ENEMY_DATA.capabilityIds.includes(ENEMY_CAPABILITY_ID.TARGETING),
        false
    );
    assert.equal(BASIC_RING_ENEMY_DATA.physicsProfileId,
        BASIC_SQUARE_ENEMY_DATA.physicsProfileId);
    assert.equal(BASIC_RING_ENEMY_DATA.combatProfileId,
        BASIC_SQUARE_ENEMY_DATA.combatProfileId);
    assert.equal(BASIC_RING_ENEMY_DATA.behaviorProfileId,
        BASIC_SQUARE_ENEMY_DATA.behaviorProfileId);
    assert.deepEqual({
        maxHealth: BASIC_RING_ENEMY_DATA.maxHealth,
        moveSpeedTilesPerSecond: BASIC_RING_ENEMY_DATA.moveSpeedTilesPerSecond,
        collisionWeight: BASIC_RING_ENEMY_DATA.collisionWeight,
        towerContactDamage: BASIC_RING_ENEMY_DATA.towerContactDamage,
        coreImpactDamage: BASIC_RING_ENEMY_DATA.coreImpactDamage,
        bountyBudget: BASIC_RING_ENEMY_DATA.bountyBudget
    }, {
        maxHealth: 1,
        moveSpeedTilesPerSecond: 5,
        collisionWeight: 1,
        towerContactDamage: 0.1,
        coreImpactDamage: 1,
        bountyBudget: 1
    });

    // CPU legacy pool roster에는 Ring class가 없으므로 GPU-only R을 섞지 않습니다.
    assert.deepEqual(Array.from(ENEMY_SHAPE_TYPES), [
        'square', 'triangle', 'arrow', 'hexa',
        'penta', 'rhom', 'octa', 'gen', 'jorang'
    ]);
    assert.equal(ENEMY_SHAPE_TYPES.includes('ring'), false);
});

test('PROJECTILE_CAPTURE capability와 projectileCaptureProfileId는 양방향이다', () => {
    assert.throws(() => normalizeEnemyDefinition(definitionSource(
        BASIC_RING_ENEMY_DATA,
        {
            capabilityIds: BASIC_RING_ENEMY_DATA.capabilityIds.filter(
                (id) => id !== ENEMY_CAPABILITY_ID.PROJECTILE_CAPTURE
            )
        }
    ), ENEMY_PROFILE_CATALOG), /PROJECTILE_CAPTURE/);
    assert.throws(() => normalizeEnemyDefinition(definitionSource(
        BASIC_RING_ENEMY_DATA,
        { projectileCaptureProfileId: null }
    ), ENEMY_PROFILE_CATALOG), /PROJECTILE_CAPTURE/);
});

test('ring geometry는 evenodd hollow source와 normalized outer/inner radius를 공유한다', () => {
    assert.equal(RING_ENEMY_OUTER_RADIUS, 0.47);
    assert.equal(RING_ENEMY_INNER_RADIUS, 0.28);
    assert.equal(RING_ENEMY_SEGMENT_COUNT, 32);
    const path = ENEMY_SHAPE_GEOMETRY.ring.paths[0];
    assert.equal(path.kind, ENEMY_SHAPE_PATH_KIND.COMPOUND);
    assert.equal(path.fillRule, 'evenodd');
    assert.equal(path.paths.length, 2);
    assert.equal(path.paths[0].kind, ENEMY_SHAPE_PATH_KIND.POLYGON);
    assert.equal(path.paths[0].points.length, 32);
    assert.equal(path.paths[1].points.length, 32);
    const scale = 0.9 / LEGACY_SQUARE_ENEMY_COLLISION_RADIUS_TILES;
    assert.equal(
        ENEMY_NORMALIZED_RENDER_GEOMETRY.ring.outerRadius,
        Math.abs(RING_ENEMY_OUTER_RADIUS * scale)
    );
    assert.equal(
        ENEMY_NORMALIZED_RENDER_GEOMETRY.ring.innerRadius,
        Math.abs(RING_ENEMY_INNER_RADIUS * scale)
    );
    assert.ok(
        ENEMY_NORMALIZED_RENDER_GEOMETRY.ring.outerRadius
            > ENEMY_NORMALIZED_RENDER_GEOMETRY.ring.innerRadius
    );
});

test('basic bullet은 capturable logical metadata를 definition authority에서 선언한다', () => {
    assert.equal(BASIC_BULLET_PROJECTILE_DEFINITION_ID, 'basic_bullet_01');
    assert.equal(
        BASIC_BULLET_PROJECTILE_DATA.projectileCapturePolicyId,
        PROJECTILE_CAPTURE_POLICY_ID.CAPTURABLE
    );
    assert.strictEqual(
        BASIC_BULLET_PROJECTILE_DATA.archetypeId,
        BASIC_BULLET_LOGICAL_PROJECTILE_METADATA.archetypeId
    );
    assert.deepEqual(localValue(BASIC_BULLET_LOGICAL_PROJECTILE_METADATA), {
        archetypeId: 'basic_bullet_01',
        wordTagMask: 0,
        modifierSetId: null,
        sourceExecutionId: null,
        projectileGeneration: 1
    });
    assert.deepEqual(localValue(normalizeProjectileLogicalMetadata({
        archetypeId: 'basic_bullet_01',
        wordTagMask: 0,
        modifierSetId: null,
        sourceExecutionId: null,
        projectileGeneration: 1
    })), localValue(BASIC_BULLET_LOGICAL_PROJECTILE_METADATA));
});

test('origin provenance는 nullable exact pairs와 subject metadata를 immutable하게 보존한다', () => {
    assert.deepEqual(Array.from(PROJECTILE_ORIGIN_PROVENANCE_KEYS), [
        'schemaVersion',
        'archetypeId',
        'wordTagMask',
        'modifierSetId',
        'sourceExecutionId',
        'projectileGeneration',
        'originProducerId',
        'originSourceAbilityId',
        'originOwnerEntityId',
        'originOwnerIncarnation',
        'originSourceEntityId',
        'originSourceIncarnation',
        'originTargetEntityId',
        'originTargetIncarnation'
    ]);
    const normalized = normalizeProjectileOriginProvenance(originProvenance());
    assert.equal(Object.isFrozen(normalized), true);
    assert.deepEqual(localValue(normalized), originProvenance());
    assert.equal('ownerEntityId' in normalized, false);
    assert.equal('sourceEntityId' in normalized, false);
    assert.equal('targetEntityId' in normalized, false);
    assert.equal('teamId' in normalized, false);
    assert.equal('targetPolicyId' in normalized, false);

    assert.throws(() => normalizeProjectileOriginProvenance(originProvenance({
        originTargetEntityId: 23,
        originTargetIncarnation: null
    })), /함께 null이거나 함께 live/);
    assert.throws(() => normalizeProjectileOriginProvenance(originProvenance({
        projectileGeneration: 0xffffffff
    })), /positive non-sentinel uint32/);

    let getterCalls = 0;
    const accessor = originProvenance();
    Object.defineProperty(accessor, 'originSourceEntityId', {
        enumerable: true,
        get() {
            getterCalls += 1;
            return 19;
        }
    });
    assert.throws(
        () => normalizeProjectileOriginProvenance(accessor),
        /getter\/setter/
    );
    assert.equal(getterCalls, 0);
    const hiddenExtra = originProvenance();
    Object.defineProperty(hiddenExtra, 'currentOwnerEntityId', { value: 99 });
    assert.throws(
        () => normalizeProjectileOriginProvenance(hiddenExtra),
        /exact schemaVersion/
    );
});
