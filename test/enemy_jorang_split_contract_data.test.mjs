import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ENEMY_CAPABILITY_ID
} = await loadGameModule('ingame/contract/enemy_capability_contract.js');
const {
    ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID
} = await loadGameModule('ingame/contract/enemy_atomic_transform_contract.js');
const {
    JORANG_SPLIT_BOUNTY_POLICY,
    JORANG_SPLIT_EFFECT_POLICY,
    JORANG_SPLIT_FORFEIT_POLICY,
    JORANG_SPLIT_HEALTH_POLICY,
    JORANG_SPLIT_KINEMATICS_POLICY,
    JORANG_SPLIT_LINEAGE_POLICY,
    JORANG_SPLIT_PENDING_HIT_POLICY,
    JORANG_SPLIT_POSITIVE_DAMAGE_PRODUCER_KIND,
    JORANG_SPLIT_TRIGGER_POLICY,
    normalizeJorangLineageBranchState,
    normalizeJorangLineageRootHandle,
    normalizeJorangSplitProfile,
    normalizeJorangSplitProfileCatalog,
    splitJorangBountyBudget
} = await loadGameModule('ingame/contract/enemy_jorang_split_contract.js');
const {
    ENEMY_SPAWN_POLICY,
    normalizeEnemyDefinition,
    normalizeEnemyProfileCatalog
} = await loadGameModule('ingame/contract/enemy_profile_contract.js');
const {
    BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID,
    BASIC_JORANG_ENEMY_CAPABILITY_IDS,
    BASIC_JORANG_ENEMY_CAPABILITY_MASK,
    BASIC_JORANG_ENEMY_DATA,
    BASIC_JORANG_ENEMY_DEFINITION_ID,
    resolveBasicCirclePrimeTransformPrivateDefinition
} = await loadGameModule('data/object/enemy/basic_jorang_enemy_data.js');
const {
    CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID,
    ENEMY_JORANG_SPLIT_PROFILE_BY_ID,
    ENEMY_JORANG_SPLIT_PROFILE_CATALOG,
    JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID
} = await loadGameModule('data/object/enemy/enemy_jorang_split_catalog_data.js');
const {
    JORANG_MAXIMUM_TRANSFORM_STARTS_PER_FIXED_TICK,
    JORANG_NATURAL_BOUNTY_BUDGET,
    JORANG_RETURN_DELAY_FIXED_TICKS,
    JORANG_SPLIT_RUNTIME_CONFIG
} = await loadGameModule('data/object/enemy/enemy_jorang_split_runtime_data.js');
const {
    ENEMY_PROFILE_CATALOG,
    JORANG_NATURAL_ENEMY_COMBAT_PROFILE_ID
} = await loadGameModule('data/object/enemy/enemy_profile_catalog_data.js');
const {
    BASIC_GEN_ENEMY_DATA,
    INGAME_ENEMY_DEFINITION_BY_ID,
    INGAME_ENEMY_DEFINITIONS
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    BASIC_HEXA_ENEMY_DATA,
    HEXA_MANY_TO_ONE_ATOMIC_TRANSFORM_PROFILE_ID,
    resolveBasicHexaTransformPrivateDefinition
} = await loadGameModule('data/object/enemy/basic_hexa_enemy_data.js');
const {
    GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY,
    assertGpuEnemyDefinitionCapabilities
} = await loadGameModule('ingame/object/enemy/gpu_enemy_spawn_adapter.js');
const {
    GPU_ENEMY_JORANG_ATOMIC_TRANSFORM_ROSTER_PORT,
    JorangSplitLineageDirector
} = await loadGameModule('ingame/object/enemy/jorang_split_lineage_director.js');
const {
    CORRIDOR_EIGHT_WAVE_01_DATA
} = await loadGameModule('data/scene/game/corridor_eight_wave_01_data.js');

function createDefinitionSource(definition, overrides = {}) {
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
        routeClosureProfileId: definition.routeClosureProfileId,
        siegeWeight: definition.siegeWeight,
        capabilityIds: definition.capabilityIds,
        render: definition.render,
        ...overrides
    };
}

test('J/C′ immutable definitions preserve adopted IDs, policies, and authored ingress', () => {
    const circlePrime = resolveBasicCirclePrimeTransformPrivateDefinition();
    assert.equal(BASIC_JORANG_ENEMY_DEFINITION_ID, 'basic_gen_01');
    assert.equal(BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID, 'basic_circle_prime_01');
    assert.equal(BASIC_JORANG_ENEMY_DATA, BASIC_GEN_ENEMY_DATA);
    assert.equal(BASIC_JORANG_ENEMY_DATA.spawnPolicy, ENEMY_SPAWN_POLICY.NATURAL);
    assert.equal(BASIC_JORANG_ENEMY_DATA.shapeDefinitionId, 'jorang');
    assert.equal(BASIC_JORANG_ENEMY_DATA.atomicTransformProfileId,
        JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID);
    assert.equal(BASIC_JORANG_ENEMY_DATA.combatProfileId,
        JORANG_NATURAL_ENEMY_COMBAT_PROFILE_ID);
    assert.deepEqual(BASIC_JORANG_ENEMY_CAPABILITY_IDS, [
        ENEMY_CAPABILITY_ID.NAVIGATION,
        ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
        ENEMY_CAPABILITY_ID.CORE_IMPACT,
        ENEMY_CAPABILITY_ID.ATOMIC_TRANSFORM
    ]);
    assert.equal(BASIC_JORANG_ENEMY_CAPABILITY_MASK, 0x225);
    assert.equal(BASIC_JORANG_ENEMY_DATA.maxHealth, 1);
    assert.equal(BASIC_JORANG_ENEMY_DATA.moveSpeedTilesPerSecond, 5);
    assert.equal(BASIC_JORANG_ENEMY_DATA.collisionWeight, 1);
    assert.equal(BASIC_JORANG_ENEMY_DATA.towerContactDamage, 0.1);
    assert.equal(BASIC_JORANG_ENEMY_DATA.coreImpactDamage, 1);
    assert.equal(BASIC_JORANG_ENEMY_DATA.bountyBudget, 12);

    assert.equal(circlePrime.id, BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID);
    assert.equal(circlePrime.spawnPolicy, ENEMY_SPAWN_POLICY.TRANSFORM_PRIVATE);
    assert.equal(circlePrime.shapeDefinitionId, 'circle');
    assert.equal(circlePrime.atomicTransformProfileId,
        CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID);
    assert.equal(circlePrime.maxHealth, 1);
    assert.equal(circlePrime.moveSpeedTilesPerSecond, 5);
    assert.equal(circlePrime.collisionWeight, 1);
    assert.equal(circlePrime.towerContactDamage, 0.1);
    assert.equal(circlePrime.coreImpactDamage, 1);
    assert.deepEqual(circlePrime.capabilityIds, BASIC_JORANG_ENEMY_CAPABILITY_IDS);
    assert.equal(Object.isFrozen(BASIC_JORANG_ENEMY_DATA), true);
    assert.equal(Object.isFrozen(circlePrime), true);

    assert.equal(INGAME_ENEMY_DEFINITION_BY_ID[BASIC_JORANG_ENEMY_DEFINITION_ID],
        BASIC_JORANG_ENEMY_DATA);
    assert.equal(INGAME_ENEMY_DEFINITION_BY_ID[BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID],
        undefined);
    assert.equal(INGAME_ENEMY_DEFINITIONS.includes(circlePrime), false);
});

test('J split catalog freezes exact topology and transfer policies', () => {
    const split = ENEMY_JORANG_SPLIT_PROFILE_BY_ID[
        JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID
    ];
    const returned = ENEMY_JORANG_SPLIT_PROFILE_BY_ID[
        CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID
    ];
    assert.equal(Object.isFrozen(ENEMY_JORANG_SPLIT_PROFILE_CATALOG), true);
    assert.equal(Object.isFrozen(ENEMY_JORANG_SPLIT_PROFILE_BY_ID), true);
    assert.equal(split.topologyId, ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY);
    assert.equal(returned.topologyId,
        ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED);
    assert.equal(split.sourceDefinitionId, BASIC_JORANG_ENEMY_DEFINITION_ID);
    assert.equal(split.destinationDefinitionId,
        BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID);
    assert.equal(returned.sourceDefinitionId,
        BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID);
    assert.equal(returned.destinationDefinitionId,
        BASIC_JORANG_ENEMY_DEFINITION_ID);
    assert.equal(split.triggerPolicy,
        JORANG_SPLIT_TRIGGER_POLICY.FIRST_VALID_POSITIVE_DAMAGE_HIT);
    assert.equal(JORANG_SPLIT_TRIGGER_POLICY.FIRST_VALID_POSITIVE_DAMAGE_HIT,
        'first-valid-positive-damage-hit');
    assert.deepEqual({ ...JORANG_SPLIT_POSITIVE_DAMAGE_PRODUCER_KIND }, {
        PROJECTILE: 1,
        EXPLOSION: 2,
        EFFECT: 3,
        DIRECT: 4,
        MELEE: 5
    });
    assert.equal(returned.triggerPolicy,
        JORANG_SPLIT_TRIGGER_POLICY.DELAYED_EXACT_HANDLE);
    assert.equal(split.kinematicsPolicy,
        JORANG_SPLIT_KINEMATICS_POLICY.COPY_EXACT_GPU_POSE_VELOCITY_FLOW);
    assert.equal(returned.kinematicsPolicy,
        JORANG_SPLIT_KINEMATICS_POLICY.PRESERVE_EXACT_GPU_POSE_VELOCITY_FLOW);
    assert.equal(split.healthPolicy,
        JORANG_SPLIT_HEALTH_POLICY.FRESH_FULL_COMMON_CIRCLE);
    assert.equal(returned.healthPolicy,
        JORANG_SPLIT_HEALTH_POLICY.PRESERVE_CURRENT_AND_MAXIMUM);
    assert.equal(split.bountyPolicy,
        JORANG_SPLIT_BOUNTY_POLICY.UINT32_CHILD_ZERO_REMAINDER);
    assert.equal(returned.bountyPolicy, JORANG_SPLIT_BOUNTY_POLICY.PRESERVE_BRANCH);
    assert.equal(split.effectPolicy,
        JORANG_SPLIT_EFFECT_POLICY
            .EFFECT_DEFINITION_OWNED_NON_DUPLICATING_DISTRIBUTION);
    assert.equal(returned.effectPolicy,
        JORANG_SPLIT_EFFECT_POLICY.PRESERVE_EXACT_INSTANCES);
    assert.equal(split.lineagePolicy,
        JORANG_SPLIT_LINEAGE_POLICY.EXACT_ROOT_HANDLE_PAIR);
    assert.equal(split.pendingHitPolicy,
        JORANG_SPLIT_PENDING_HIT_POLICY.ZERO_DAMAGE_NO_SOURCE_BUDGET_OR_EVENT);
    assert.equal(returned.pendingHitPolicy,
        JORANG_SPLIT_PENDING_HIT_POLICY.NORMAL_DAMAGE);
    assert.equal(split.forfeitPolicy,
        JORANG_SPLIT_FORFEIT_POLICY
            .CORE_IMPACT_CONSUMES_BRANCH_WITHOUT_BOUNTY_OR_RETURN);
    assert.equal(returned.forfeitPolicy,
        JORANG_SPLIT_FORFEIT_POLICY
            .CORE_IMPACT_CONSUMES_BRANCH_WITHOUT_BOUNTY_OR_RETURN);
    assert.throws(() => normalizeJorangSplitProfile({
        ...split,
        healthPolicy: JORANG_SPLIT_HEALTH_POLICY.PRESERVE_CURRENT_AND_MAXIMUM
    }), /정확히 일치/);
    assert.throws(() => normalizeJorangSplitProfile({
        ...returned,
        sourceDefinitionId: BASIC_JORANG_ENEMY_DEFINITION_ID
    }), /정확히 일치/);
});

test('J runtime constants and bounty split are exact bounded integers', () => {
    assert.equal(JORANG_NATURAL_BOUNTY_BUDGET, 12);
    assert.equal(JORANG_RETURN_DELAY_FIXED_TICKS, 60);
    assert.equal(JORANG_MAXIMUM_TRANSFORM_STARTS_PER_FIXED_TICK, 4);
    assert.deepEqual(JORANG_SPLIT_RUNTIME_CONFIG, {
        returnDelayFixedTicks: 60,
        maximumTransformStartsPerFixedTick: 4
    });
    assert.deepEqual(splitJorangBountyBudget(12), [6, 6]);
    assert.deepEqual(splitJorangBountyBudget(13), [7, 6]);
    assert.deepEqual(splitJorangBountyBudget(1), [1, 0]);
    assert.deepEqual(splitJorangBountyBudget(0), [0, 0]);
    assert.deepEqual(splitJorangBountyBudget(0xffffffff), [0x80000000, 0x7fffffff]);
    assert.throws(() => splitJorangBountyBudget(1.5), /uint32/);
    assert.throws(() => splitJorangBountyBudget(0x100000000), /uint32/);
});

test('J lineage uses an ABA-safe root pair and a transaction-local branch order', () => {
    assert.deepEqual(normalizeJorangLineageRootHandle({
        entityId: 17,
        incarnation: 4
    }), { entityId: 17, incarnation: 4 });
    assert.deepEqual(normalizeJorangLineageBranchState({
        lineageRootEntityId: 17,
        lineageRootIncarnation: 4,
        branchIndex: 1,
        bountyBudget: 6,
        transformAtTick: 160
    }), {
        lineageRootEntityId: 17,
        lineageRootIncarnation: 4,
        branchIndex: 1,
        bountyBudget: 6,
        transformAtTick: 160
    });
    assert.throws(() => normalizeJorangLineageRootHandle({
        entityId: 17
    }), /entityId\/incarnation/);
    assert.throws(() => normalizeJorangLineageRootHandle({
        entityId: 17,
        incarnation: 0xffffffff
    }), /live exact-handle/);
    assert.throws(() => normalizeJorangLineageBranchState({
        lineageRootEntityId: 17,
        lineageRootIncarnation: 4,
        branchIndex: 2,
        bountyBudget: 6,
        transformAtTick: 160
    }), /0 또는 1/);
});

test('J lineage/profile normalizers accept exact own data snapshots only', () => {
    const split = ENEMY_JORANG_SPLIT_PROFILE_BY_ID[
        JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID
    ];
    const returned = ENEMY_JORANG_SPLIT_PROFILE_BY_ID[
        CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID
    ];
    let getterCalls = 0;
    const rootAccessor = { entityId: 17 };
    Object.defineProperty(rootAccessor, 'incarnation', {
        enumerable: true,
        get() {
            getterCalls += 1;
            return 4;
        }
    });
    assert.throws(
        () => normalizeJorangLineageRootHandle(rootAccessor),
        /getter\/setter/
    );
    assert.equal(getterCalls, 0);

    const rootWithHiddenExtra = { entityId: 17, incarnation: 4 };
    Object.defineProperty(rootWithHiddenExtra, 'hidden', { value: true });
    assert.throws(
        () => normalizeJorangLineageRootHandle(rootWithHiddenExtra),
        /exact entityId\/incarnation/
    );
    assert.throws(() => normalizeJorangLineageRootHandle({
        entityId: 17,
        incarnation: 4,
        [Symbol('extra')]: true
    }), /exact entityId\/incarnation/);

    const branchAccessor = {
        lineageRootEntityId: 17,
        lineageRootIncarnation: 4,
        branchIndex: 1,
        transformAtTick: 160
    };
    Object.defineProperty(branchAccessor, 'bountyBudget', {
        enumerable: true,
        get() {
            getterCalls += 1;
            return 6;
        }
    });
    assert.throws(
        () => normalizeJorangLineageBranchState(branchAccessor),
        /getter\/setter/
    );
    assert.equal(getterCalls, 0);
    const branchWithSymbol = {
        lineageRootEntityId: 17,
        lineageRootIncarnation: 4,
        branchIndex: 1,
        bountyBudget: 6,
        transformAtTick: 160,
        [Symbol('extra')]: true
    };
    assert.throws(
        () => normalizeJorangLineageBranchState(branchWithSymbol),
        /exact lineageRootEntityId/
    );

    const profileAccessor = { ...split };
    Object.defineProperty(profileAccessor, 'healthPolicy', {
        enumerable: true,
        get() {
            getterCalls += 1;
            return split.healthPolicy;
        }
    });
    assert.throws(
        () => normalizeJorangSplitProfile(profileAccessor),
        /getter\/setter/
    );
    assert.equal(getterCalls, 0);
    const profileWithHiddenExtra = { ...split };
    Object.defineProperty(profileWithHiddenExtra, 'hidden', { value: true });
    assert.throws(
        () => normalizeJorangSplitProfile(profileWithHiddenExtra),
        /exact id\/topologyId/
    );

    const catalogWithExtra = [split, returned];
    catalogWithExtra.extra = true;
    assert.throws(
        () => normalizeJorangSplitProfileCatalog(catalogWithExtra),
        /extra property 없는 dense 배열/
    );
    const catalogAccessor = [split, returned];
    Object.defineProperty(catalogAccessor, '0', {
        enumerable: true,
        get() {
            getterCalls += 1;
            return split;
        }
    });
    assert.throws(
        () => normalizeJorangSplitProfileCatalog(catalogAccessor),
        /getter\/setter/
    );
    assert.equal(getterCalls, 0);
    const catalogWithSymbol = [split, returned];
    catalogWithSymbol[Symbol('extra')] = true;
    assert.throws(
        () => normalizeJorangSplitProfileCatalog(catalogWithSymbol),
        /extra property 없는 dense 배열/
    );
});

test('ATOMIC_TRANSFORM capability and profile ID are bidirectionally authored', () => {
    const withoutCapability = createDefinitionSource(BASIC_JORANG_ENEMY_DATA, {
        capabilityIds: BASIC_JORANG_ENEMY_DATA.capabilityIds.filter(
            (id) => id !== ENEMY_CAPABILITY_ID.ATOMIC_TRANSFORM
        )
    });
    assert.throws(() => normalizeEnemyDefinition(
        withoutCapability,
        ENEMY_PROFILE_CATALOG
    ), /ATOMIC_TRANSFORM/);
    assert.throws(() => normalizeEnemyDefinition(createDefinitionSource(
        BASIC_JORANG_ENEMY_DATA,
        {
        atomicTransformProfileId: null
        }
    ), ENEMY_PROFILE_CATALOG), /ATOMIC_TRANSFORM/);

    const profileSource = {
        physics: Object.values(ENEMY_PROFILE_CATALOG.physicsById),
        combat: Object.values(ENEMY_PROFILE_CATALOG.combatById).map((profile) => (
            profile.id === JORANG_NATURAL_ENEMY_COMBAT_PROFILE_ID
                ? { ...profile, bountyBudget: 12.5 }
                : profile
        )),
        behavior: Object.values(ENEMY_PROFILE_CATALOG.behaviorById)
    };
    assert.throws(() => normalizeEnemyProfileCatalog(profileSource), /uint32/);

    assert.equal(BASIC_HEXA_ENEMY_DATA.atomicTransformProfileId,
        HEXA_MANY_TO_ONE_ATOMIC_TRANSFORM_PROFILE_ID);
    assert.equal(resolveBasicHexaTransformPrivateDefinition(2).atomicTransformProfileId,
        HEXA_MANY_TO_ONE_ATOMIC_TRANSFORM_PROFILE_ID);
    assert.equal(resolveBasicHexaTransformPrivateDefinition(6).atomicTransformProfileId,
        null);
});

test('profile-discriminated capability authoring accepts only H, J, and private C prime families', () => {
    const circlePrime = resolveBasicCirclePrimeTransformPrivateDefinition();
    const hexaGroup = resolveBasicHexaTransformPrivateDefinition(2);
    for (const definition of [
        BASIC_HEXA_ENEMY_DATA,
        hexaGroup,
        BASIC_JORANG_ENEMY_DATA,
        circlePrime
    ]) {
        assert.doesNotThrow(() => assertGpuEnemyDefinitionCapabilities(definition));
    }
    assert.throws(() => assertGpuEnemyDefinitionCapabilities({
        ...BASIC_JORANG_ENEMY_DATA,
        atomicTransformProfileId:
            CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID
    }), /canonical|profile/i);
    assert.throws(() => assertGpuEnemyDefinitionCapabilities({
        ...circlePrime,
        atomicTransformProfileId: JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID
    }), /canonical|profile/i);
    assert.throws(() => assertGpuEnemyDefinitionCapabilities({
        ...BASIC_JORANG_ENEMY_DATA,
        id: 'future-arbitrary-atomic-transform',
        atomicTransformProfileId: 'future-arbitrary-atomic-profile'
    }), /canonical|profile/i);

    const atomicImplementation = (
        GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY.byCapabilityId[
            ENEMY_CAPABILITY_ID.ATOMIC_TRANSFORM
        ]
    );
    assert.equal(atomicImplementation.implementationId,
        'profile-discriminated-atomic-transform');
    assert.equal(atomicImplementation.rosterPort, null);
    assert.strictEqual(
        GPU_ENEMY_JORANG_ATOMIC_TRANSFORM_ROSTER_PORT.observeLifecycle,
        JorangSplitLineageDirector.prototype.observeLifecycle
    );
    assert.strictEqual(
        GPU_ENEMY_JORANG_ATOMIC_TRANSFORM_ROSTER_PORT.observeCompletedEvents,
        JorangSplitLineageDirector.prototype.observeCompletedEvents
    );
    assert.strictEqual(
        GPU_ENEMY_JORANG_ATOMIC_TRANSFORM_ROSTER_PORT
            .observeCompletedPreparations,
        JorangSplitLineageDirector.prototype.observeCompletedPreparations
    );
    assert.strictEqual(
        GPU_ENEMY_JORANG_ATOMIC_TRANSFORM_ROSTER_PORT.stageForFixedTick,
        JorangSplitLineageDirector.prototype.stageForFixedTick
    );
});

test('Turn 6 authoring does not silently add J or C′ to the production wave', () => {
    const authoredIds = CORRIDOR_EIGHT_WAVE_01_DATA.timeline.flatMap(
        (entry) => entry.spawnGroups.flatMap(
            (group) => group.enemyDefinitionIds ?? [group.enemyDefinitionId]
        )
    );
    assert.equal(authoredIds.includes(BASIC_JORANG_ENEMY_DEFINITION_ID), false);
    assert.equal(authoredIds.includes(BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID), false);
});
