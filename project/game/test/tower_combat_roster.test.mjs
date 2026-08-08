import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    PRIMARY_TOWER_LOGICAL_ID,
    TOWER_COMBAT_FACT_TYPE,
    TowerCombatRoster
} = await loadGameModule('ingame/object/tower/tower_combat_roster.js');

const TOWER_A = Object.freeze({ entityId: 101, incarnation: 7 });
const TOWER_B = Object.freeze({ entityId: 101, incarnation: 8 });
const PROJECTILE_A = Object.freeze({ entityId: 401, incarnation: 3 });
const PROJECTILE_B = Object.freeze({ entityId: 402, incarnation: 4 });
const PROJECTILE_C = Object.freeze({ entityId: 403, incarnation: 5 });

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function createProtocol(overrides = {}) {
    return {
        sessionGeneration: 4,
        deviceGeneration: 2,
        authoritativeEpoch: 9,
        ...overrides
    };
}

function createSourceRegistry(entries) {
    const metadataByHandle = new Map(entries.map(({ handle, ...metadata }) => [
        handleKey(handle),
        Object.freeze(metadata)
    ]));
    const calls = [];
    return {
        calls,
        copyEntityView(handle) {
            calls.push({ ...handle });
            const metadata = metadataByHandle.get(handleKey(handle));
            return metadata ? { metadata } : null;
        }
    };
}

function createDamageEvent({
    protocol = createProtocol(),
    source = PROJECTILE_A,
    target = TOWER_A,
    key = `damage:${handleKey(source)}:${handleKey(target)}`,
    sourceTick = 1,
    sequence = 0,
    damageFixedPoint = 100,
    disposition = 'applied',
    reason = null
} = {}) {
    return {
        type: 'contact',
        eventType: 'damage-applied',
        disposition,
        entityId: source.entityId,
        incarnation: source.incarnation,
        other: { ...target },
        ...protocol,
        sourceTick,
        sequence,
        key,
        damageFixedPoint,
        reason
    };
}

function createDeathEvent({
    protocol = createProtocol(),
    target = TOWER_A,
    key = `death:${handleKey(target)}`,
    sourceTick = 1,
    sequence = 0,
    disposition = 'despawn-requested',
    reason = 'health-depleted',
    reasonFlags = 0
} = {}) {
    return {
        type: 'death',
        eventType: 'death',
        disposition,
        entityId: target.entityId,
        incarnation: target.incarnation,
        ...protocol,
        sourceTick,
        sequence,
        key,
        reason,
        reasonFlags
    };
}

function assertHandle(actual, expected) {
    assert.equal(actual.entityId, expected.entityId);
    assert.equal(actual.incarnation, expected.incarnation);
}

test('strict completed Tower damage/death fact는 30→17→0과 exact projectile provenance를 보존한다', () => {
    const protocol = createProtocol();
    const registry = createSourceRegistry([
        {
            handle: PROJECTILE_A,
            producerId: 'hostile-archer-a',
            sourceAbilityId: 'archer-shot-a',
            teamId: 2
        },
        {
            handle: PROJECTILE_B,
            producerId: 'hostile-archer-b',
            sourceAbilityId: 'archer-shot-b',
            teamId: 2
        }
    ]);
    const roster = new TowerCombatRoster({ maxHp: 30 });
    roster.bindGpuBody(TOWER_A, protocol);

    const ignoredDamageFacts = roster.commitCompletedEvents({
        events: [createDamageEvent({
            protocol,
            source: PROJECTILE_A,
            target: TOWER_A,
            key: 'not-completed-damage',
            sourceTick: 1,
            damageFixedPoint: 1300,
            disposition: 'queued'
        })]
    }, registry);
    assert.deepEqual([...ignoredDamageFacts], []);
    assert.equal(roster.getPrimaryTowerCurrentHp(), 30);

    const firstDamageFacts = roster.commitCompletedEvents({
        events: [createDamageEvent({
            protocol,
            source: PROJECTILE_A,
            target: TOWER_A,
            key: 'tower-damage-30-to-17',
            sourceTick: 2,
            damageFixedPoint: 1300
        })]
    }, registry);
    assert.equal(firstDamageFacts.length, 1);
    const firstDamage = firstDamageFacts[0];
    assert.equal(firstDamage.type, TOWER_COMBAT_FACT_TYPE.DAMAGE_APPLIED);
    assert.equal(firstDamage.logicalTowerId, PRIMARY_TOWER_LOGICAL_ID);
    assertHandle(firstDamage.sourceHandle, PROJECTILE_A);
    assertHandle(firstDamage.targetHandle, TOWER_A);
    assert.equal(firstDamage.producerId, 'hostile-archer-a');
    assert.equal(firstDamage.sourceAbilityId, 'archer-shot-a');
    assert.equal(firstDamage.sourceTeamId, 2);
    assert.equal(firstDamage.damageFixedPoint, 1300);
    assert.equal(firstDamage.currentHp, 17);
    assert.equal(firstDamage.maxHp, 30);
    assert.equal(firstDamage.targetDied, false);
    assert.equal(roster.getPrimaryTowerCurrentHp(), 17);

    const secondDamageFacts = roster.commitCompletedEvents({
        events: [createDamageEvent({
            protocol,
            source: PROJECTILE_B,
            target: TOWER_A,
            key: 'tower-damage-17-to-0',
            sourceTick: 3,
            damageFixedPoint: 1700,
            reason: 'target-died'
        })]
    }, registry);
    assert.equal(secondDamageFacts.length, 1);
    const secondDamage = secondDamageFacts[0];
    assert.equal(secondDamage.type, TOWER_COMBAT_FACT_TYPE.DAMAGE_APPLIED);
    assertHandle(secondDamage.sourceHandle, PROJECTILE_B);
    assertHandle(secondDamage.targetHandle, TOWER_A);
    assert.equal(secondDamage.currentHp, 0);
    assert.equal(secondDamage.targetDied, true);
    assert.equal(roster.getPrimaryTowerCurrentHp(), 0);

    const ignoredDeathFacts = roster.commitCompletedEvents({
        events: [createDeathEvent({
            protocol,
            target: TOWER_A,
            key: 'not-completed-death',
            sourceTick: 3,
            sequence: 1,
            disposition: 'applied'
        })]
    }, registry);
    assert.deepEqual([...ignoredDeathFacts], []);
    assert.equal(roster.isPrimaryTowerAlive(), true);

    const deathFacts = roster.commitCompletedEvents({
        events: [createDeathEvent({
            protocol,
            target: TOWER_A,
            key: 'tower-death',
            sourceTick: 3,
            sequence: 1
        })]
    }, registry);
    assert.deepEqual(
        [...deathFacts].map((fact) => fact.type),
        [
            TOWER_COMBAT_FACT_TYPE.DIED,
            TOWER_COMBAT_FACT_TYPE.NO_LIVING_TOWERS
        ]
    );
    const [death, noLivingTowers] = deathFacts;
    assertHandle(death.targetHandle, TOWER_A);
    assertHandle(death.sourceHandle, PROJECTILE_B);
    assert.equal(death.producerId, 'hostile-archer-b');
    assert.equal(death.sourceAbilityId, 'archer-shot-b');
    assert.equal(death.sourceTeamId, 2);
    assert.equal(death.currentHp, 0);
    assert.equal(noLivingTowers.logicalTowerId, PRIMARY_TOWER_LOGICAL_ID);
    assert.equal(noLivingTowers.livingTowerCount, 0);
    assert.equal(roster.isPrimaryTowerAlive(), false);
    assert.equal(roster.getLivingTowerCount(), 0);
});

test('duplicate, stale, old generation, old incarnation completed event는 Tower 상태를 바꾸지 않는다', () => {
    const protocol = createProtocol();
    const registry = createSourceRegistry([
        {
            handle: PROJECTILE_A,
            producerId: 'hostile-a',
            sourceAbilityId: 'shot-a',
            teamId: 2
        },
        {
            handle: PROJECTILE_B,
            producerId: 'hostile-b',
            sourceAbilityId: 'shot-b',
            teamId: 2
        }
    ]);
    const roster = new TowerCombatRoster({ maxHp: 30 });
    roster.bindGpuBody(TOWER_A, protocol);

    const accepted = createDamageEvent({
        protocol,
        source: PROJECTILE_A,
        target: TOWER_A,
        key: 'accepted-once',
        sourceTick: 10,
        damageFixedPoint: 1300
    });
    assert.equal(roster.commitCompletedEvents({ events: [accepted] }, registry).length, 1);
    assert.equal(roster.getPrimaryTowerCurrentHp(), 17);

    const ignoredFacts = roster.commitCompletedEvents({
        events: [
            createDamageEvent({
                protocol,
                source: PROJECTILE_A,
                target: TOWER_A,
                key: 'accepted-once',
                sourceTick: 11,
                damageFixedPoint: 100
            }),
            createDamageEvent({
                protocol,
                source: PROJECTILE_A,
                target: TOWER_A,
                key: 'stale-tick',
                sourceTick: 9,
                sequence: 9,
                damageFixedPoint: 100
            }),
            createDamageEvent({
                protocol: createProtocol({ sessionGeneration: 3 }),
                source: PROJECTILE_A,
                target: TOWER_A,
                key: 'old-generation',
                sourceTick: 12,
                damageFixedPoint: 100
            }),
            createDamageEvent({
                protocol,
                source: PROJECTILE_A,
                target: { entityId: TOWER_A.entityId, incarnation: 6 },
                key: 'old-incarnation-contact',
                sourceTick: 13,
                damageFixedPoint: 100
            }),
            createDeathEvent({
                protocol,
                target: { entityId: TOWER_A.entityId, incarnation: 6 },
                key: 'old-incarnation-death',
                sourceTick: 14
            })
        ]
    }, registry);
    assert.deepEqual([...ignoredFacts], []);
    assert.equal(roster.getPrimaryTowerCurrentHp(), 17);
    assert.equal(roster.isPrimaryTowerAlive(), true);
    assert.equal(registry.calls.length, 1);

    const nextFacts = roster.commitCompletedEvents({
        events: [createDamageEvent({
            protocol,
            source: PROJECTILE_B,
            target: TOWER_A,
            key: 'next-valid-event',
            sourceTick: 11,
            damageFixedPoint: 100
        })]
    }, registry);
    assert.equal(nextFacts.length, 1);
    assert.equal(roster.getPrimaryTowerCurrentHp(), 16);
    assert.equal(registry.calls.length, 2);
});

test('GPU session recovery는 HP를 보존하고 새 세션 무damage death에 이전 provenance를 계승하지 않는다', () => {
    const oldProtocol = createProtocol({
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0
    });
    const newProtocol = createProtocol({
        sessionGeneration: 2,
        deviceGeneration: 3,
        authoritativeEpoch: 5
    });
    const registry = createSourceRegistry([{
        handle: PROJECTILE_A,
        producerId: 'old-session-producer',
        sourceAbilityId: 'old-session-ability',
        teamId: 2
    }]);
    const roster = new TowerCombatRoster({ maxHp: 30 });
    roster.bindGpuBody(TOWER_A, oldProtocol);
    roster.commitCompletedEvents({
        events: [createDamageEvent({
            protocol: oldProtocol,
            source: PROJECTILE_A,
            target: TOWER_A,
            key: 'old-session-target-died-damage',
            sourceTick: 10,
            damageFixedPoint: 1300,
            reason: 'target-died'
        })]
    }, registry);
    assert.equal(roster.getPrimaryTowerCurrentHp(), 17);

    assert.equal(roster.releaseGpuBinding(), true);
    assert.equal(roster.getStatus().boundGpuBody, null);
    roster.bindGpuBody(TOWER_B, newProtocol);
    assertHandle(roster.getStatus().boundGpuBody, TOWER_B);
    assert.equal(roster.getPrimaryTowerCurrentHp(), 17);
    assert.equal(roster.getLivingTowerCount(), 1);

    const oldGenerationFacts = roster.commitCompletedEvents({
        events: [createDamageEvent({
            protocol: oldProtocol,
            source: PROJECTILE_A,
            target: TOWER_B,
            key: 'old-session-replacement-target',
            sourceTick: 11,
            damageFixedPoint: 100
        })]
    }, registry);
    assert.deepEqual([...oldGenerationFacts], []);
    assert.equal(roster.getPrimaryTowerCurrentHp(), 17);

    const recoveryDeathFacts = roster.commitCompletedEvents({
        events: [createDeathEvent({
            protocol: newProtocol,
            target: TOWER_B,
            key: 'new-session-no-damage-death',
            sourceTick: 10
        })]
    }, registry);
    assert.deepEqual(
        [...recoveryDeathFacts].map((fact) => fact.type),
        [
            TOWER_COMBAT_FACT_TYPE.DIED,
            TOWER_COMBAT_FACT_TYPE.NO_LIVING_TOWERS
        ]
    );
    const [death] = recoveryDeathFacts;
    assertHandle(death.targetHandle, TOWER_B);
    assert.equal(death.sourceHandle, null);
    assert.equal(death.producerId, null);
    assert.equal(death.sourceAbilityId, null);
    assert.equal(death.sourceTeamId, null);
    assert.equal(roster.getPrimaryTowerCurrentHp(), 0);
    assert.equal(roster.isPrimaryTowerAlive(), false);
});

test('status는 immutable이며 completed event key history는 configured capacity 안에 유지된다', () => {
    const protocol = createProtocol();
    const roster = new TowerCombatRoster({
        maxHp: 30,
        eventHistoryCapacity: 2
    });
    roster.bindGpuBody(TOWER_A, protocol);

    for (const [index, source] of [PROJECTILE_A, PROJECTILE_B, PROJECTILE_C].entries()) {
        const facts = roster.commitCompletedEvents({
            events: [createDamageEvent({
                protocol,
                source,
                target: TOWER_A,
                key: `bounded-event-${index}`,
                sourceTick: index + 1,
                damageFixedPoint: 1
            })]
        });
        assert.equal(facts.length, 1);
    }

    const status = roster.getStatus();
    assert.equal(Object.isFrozen(status), true);
    assert.equal(Object.isFrozen(status.boundGpuBody), true);
    assert.equal(Object.isFrozen(status.lastCommittedDamage), true);
    assert.equal(Object.isFrozen(status.lastCommittedFacts), true);
    assert.equal('knownEventKeys' in status, false);
    assert.equal('eventKeyHistory' in status, false);
    assert.throws(() => {
        status.currentHp = 999;
    }, (error) => error?.name === 'TypeError');
    assert.equal(roster.getStatus().currentHpFixedPoint, 2997);
    assert.equal(roster.knownEventKeys.size, 2);
    assert.equal(
        roster.eventKeyHistory.length - roster.eventKeyHead,
        2
    );
});
