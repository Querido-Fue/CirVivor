import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_TEAM_ID,
    isGameplayDamageAllowed,
    normalizeGameplayAllegiancePolicy,
    normalizeGameplayDamagePolicyId,
    normalizeGameplayTeamId,
    resolveGameplayAllegianceTeam
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');
const {
    createGpuRegistryMetadata,
    normalizeGpuSpawnIntent
} = await loadGameModule('ingame/object/gpu_spawn_intent.js');

function assertThrowsNamed(callback, expectedName) {
    assert.throws(callback, (error) => error?.name === expectedName);
}

function createProjectileIntent(overrides = {}) {
    return {
        kindId: 'projectile',
        definitionId: 'team-contract-projectile',
        position: { x: 1, y: 2 },
        velocity: { x: 3, y: 4 },
        radius: 0.25,
        inverseMass: 1,
        bodyLayer: 2,
        collisionMask: 0,
        interactionLayer: 2,
        interactionMask: 1,
        health: 1,
        lifetime: 2,
        alive: true,
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
        damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        ownerEntityId: 41,
        ownerIncarnation: 3,
        sourceEntityId: 41,
        sourceIncarnation: 3,
        producerId: 'team-contract-producer',
        sourceAbilityId: 'team-contract-ability',
        targetPolicyId: 'hostile-only',
        spawnSequence: 7,
        ...overrides
    };
}

test('stable gameplay team/policy ID와 allegiance vocabulary는 numeric/string 계약으로 고정된다', () => {
    assert.equal(Object.isFrozen(GAMEPLAY_TEAM_ID), true);
    assert.equal(Object.isFrozen(GAMEPLAY_DAMAGE_POLICY_ID), true);
    assert.equal(Object.isFrozen(GAMEPLAY_ALLEGIANCE_POLICY), true);
    assert.deepEqual({ ...GAMEPLAY_TEAM_ID }, {
        NEUTRAL: 0,
        PLAYER: 1,
        HOSTILE: 2
    });
    assert.deepEqual({ ...GAMEPLAY_DAMAGE_POLICY_ID }, {
        DEFAULT_TEAM_MATRIX: 0
    });
    assert.deepEqual({ ...GAMEPLAY_ALLEGIANCE_POLICY }, {
        FIXED_PLAYER: 'fixed-player',
        FIXED_HOSTILE: 'fixed-hostile',
        INHERIT_SUBJECT: 'inherit-subject',
        EXPLICIT_OVERRIDE: 'explicit-override'
    });

    for (const teamId of Object.values(GAMEPLAY_TEAM_ID)) {
        assert.equal(normalizeGameplayTeamId(teamId), teamId);
    }
    assert.equal(
        normalizeGameplayDamagePolicyId(),
        GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
    );
    for (const policy of Object.values(GAMEPLAY_ALLEGIANCE_POLICY)) {
        assert.equal(normalizeGameplayAllegiancePolicy(policy), policy);
    }
    for (const invalidTeamId of [-1, 3, 0.5, Number.NaN, null]) {
        assertThrowsNamed(() => normalizeGameplayTeamId(invalidTeamId), 'RangeError');
    }
    assertThrowsNamed(() => normalizeGameplayDamagePolicyId(1), 'RangeError');
    assertThrowsNamed(() => normalizeGameplayAllegiancePolicy('inherit-owner'), 'RangeError');
});

test('allegiance resolution은 fixed, explicit, exact subject inheritance의 충돌을 fail-fast한다', () => {
    assert.equal(
        resolveGameplayAllegianceTeam({
            policy: GAMEPLAY_ALLEGIANCE_POLICY.FIXED_PLAYER
        }),
        GAMEPLAY_TEAM_ID.PLAYER
    );
    assert.equal(
        resolveGameplayAllegianceTeam({
            policy: GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE
        }),
        GAMEPLAY_TEAM_ID.HOSTILE
    );
    assert.equal(
        resolveGameplayAllegianceTeam({
            policy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
            teamId: GAMEPLAY_TEAM_ID.NEUTRAL
        }),
        GAMEPLAY_TEAM_ID.NEUTRAL
    );
    assert.equal(
        resolveGameplayAllegianceTeam({
            policy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
            subjectTeamId: GAMEPLAY_TEAM_ID.HOSTILE
        }),
        GAMEPLAY_TEAM_ID.HOSTILE
    );
    assertThrowsNamed(() => resolveGameplayAllegianceTeam({
        policy: GAMEPLAY_ALLEGIANCE_POLICY.FIXED_PLAYER,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE
    }), 'RangeError');
    assertThrowsNamed(() => resolveGameplayAllegianceTeam({
        policy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE
    }), 'TypeError');
    assertThrowsNamed(() => resolveGameplayAllegianceTeam({
        policy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
        subjectTeamId: GAMEPLAY_TEAM_ID.PLAYER,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE
    }), 'RangeError');
});

test('기본 damage matrix는 적대 Player↔Hostile만 허용하며 Neutral/same-team은 거절한다', () => {
    const expectedAllowedPairs = new Set([
        `${GAMEPLAY_TEAM_ID.PLAYER}:${GAMEPLAY_TEAM_ID.HOSTILE}`,
        `${GAMEPLAY_TEAM_ID.HOSTILE}:${GAMEPLAY_TEAM_ID.PLAYER}`
    ]);
    for (const sourceTeamId of Object.values(GAMEPLAY_TEAM_ID)) {
        for (const targetTeamId of Object.values(GAMEPLAY_TEAM_ID)) {
            assert.equal(
                isGameplayDamageAllowed(sourceTeamId, targetTeamId),
                expectedAllowedPairs.has(`${sourceTeamId}:${targetTeamId}`),
                `${sourceTeamId}->${targetTeamId} damage matrix`
            );
        }
    }
    assertThrowsNamed(() => isGameplayDamageAllowed(3, GAMEPLAY_TEAM_ID.PLAYER), 'RangeError');
    assertThrowsNamed(() => isGameplayDamageAllowed(
        GAMEPLAY_TEAM_ID.PLAYER,
        GAMEPLAY_TEAM_ID.HOSTILE,
        1
    ), 'RangeError');
});

test('canonical spawn ingress는 explicit team/provenance를 보존하고 inherit subject injection을 거절한다', () => {
    const explicit = normalizeGpuSpawnIntent(createProjectileIntent());
    assert.equal(explicit.teamId, GAMEPLAY_TEAM_ID.PLAYER);
    assert.equal(
        explicit.damagePolicyId,
        GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
    );
    assert.equal(
        explicit.allegiancePolicy,
        GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE
    );
    assert.equal(Object.isFrozen(explicit), true);

    const metadata = createGpuRegistryMetadata(explicit);
    assert.equal(metadata.teamId, GAMEPLAY_TEAM_ID.PLAYER);
    assert.equal(
        metadata.damagePolicyId,
        GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
    );
    assert.equal(
        metadata.allegiancePolicy,
        GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE
    );
    assert.equal(metadata.ownerEntityId, 41);
    assert.equal(metadata.ownerIncarnation, 3);
    assert.equal(metadata.sourceEntityId, 41);
    assert.equal(metadata.sourceIncarnation, 3);
    assert.equal(metadata.producerId, 'team-contract-producer');
    assert.equal(metadata.sourceAbilityId, 'team-contract-ability');
    assert.equal(metadata.targetPolicyId, 'hostile-only');

    const inherited = normalizeGpuSpawnIntent(createProjectileIntent({
        teamId: undefined,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT
    }), {
        subjectTeamId: GAMEPLAY_TEAM_ID.HOSTILE
    });
    assert.equal(inherited.teamId, GAMEPLAY_TEAM_ID.HOSTILE);
    assert.equal(
        inherited.allegiancePolicy,
        GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT
    );

    assertThrowsNamed(() => normalizeGpuSpawnIntent(createProjectileIntent({
        teamId: undefined
    })), 'TypeError');
    assertThrowsNamed(() => normalizeGpuSpawnIntent(createProjectileIntent({
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT
    }), {
        subjectTeamId: GAMEPLAY_TEAM_ID.HOSTILE
    }), 'RangeError');
});
