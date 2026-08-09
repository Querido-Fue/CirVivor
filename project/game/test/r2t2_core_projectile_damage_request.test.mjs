import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    CORE_DAMAGE_REQUEST_EVENT_TYPE,
    CORE_IMPACT_FACT_TYPE,
    EnemyCoreImpactDirector
} = await loadGameModule(
    'ingame/object/enemy/enemy_core_impact_director.js'
);
const {
    CoreIntegrity
} = await loadGameModule('ingame/state/core_integrity.js');
const {
    BASIC_RHOM_ATTACK_DATA
} = await loadGameModule('data/object/enemy/basic_rhom_attack_data.js');
const {
    HOSTILE_RHOM_PROJECTILE_DATA
} = await loadGameModule(
    'data/object/projectile/hostile_rhom_projectile_data.js'
);
const {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');

const PROTOCOL = Object.freeze({
    sessionGeneration: 21,
    deviceGeneration: 4,
    authoritativeEpoch: 8
});
const CORE_HANDLE = Object.freeze({ entityId: 9, incarnation: 2 });
const SOURCE_HANDLE = Object.freeze({ entityId: 300, incarnation: 7 });

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function createEndpoint() {
    return Object.freeze({
        getStatus() {
            return Object.freeze({
                sessionGeneration: PROTOCOL.sessionGeneration,
                backend: PROTOCOL
            });
        },
        getBackend() {
            return Object.freeze({
                getEventProtocolState: () => PROTOCOL
            });
        },
        requestDespawn() {
            throw new Error('projectile Core damage request는 Enemy despawn을 요청하지 않는다.');
        }
    });
}

function createProjectileMetadata(spawnSequence, overrides = {}) {
    return Object.freeze({
        definitionId: HOSTILE_RHOM_PROJECTILE_DATA.id,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
        damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        targetPolicyId: HOSTILE_RHOM_PROJECTILE_DATA.targetPolicyId,
        towerTargetPolicyId:
            HOSTILE_RHOM_PROJECTILE_DATA.towerTargetPolicyId,
        coreTargetPolicyId: HOSTILE_RHOM_PROJECTILE_DATA.coreTargetPolicyId,
        coreDamageRequestPolicyId:
            HOSTILE_RHOM_PROJECTILE_DATA.coreDamageRequestPolicyId,
        targetSelectionPolicyId: BASIC_RHOM_ATTACK_DATA.targetSelectionPolicy,
        distancePolicyId: BASIC_RHOM_ATTACK_DATA.distancePolicy,
        attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
        requiresExactSelectedTarget: true,
        coreTargetEntityId: CORE_HANDLE.entityId,
        coreTargetIncarnation: CORE_HANDLE.incarnation,
        selectedTargetKind: 'core',
        selectedTargetEntityId: CORE_HANDLE.entityId,
        selectedTargetIncarnation: CORE_HANDLE.incarnation,
        selectedTargetPolicyId:
            HOSTILE_RHOM_PROJECTILE_DATA.coreTargetPolicyId,
        selectionSourceTick: 11,
        selectionSequence: spawnSequence,
        attackFingerprint: 123456,
        sourceEntityId: SOURCE_HANDLE.entityId,
        sourceIncarnation: SOURCE_HANDLE.incarnation,
        ownerEntityId: SOURCE_HANDLE.entityId,
        ownerIncarnation: SOURCE_HANDLE.incarnation,
        producerId: BASIC_RHOM_ATTACK_DATA.producerId,
        sourceAbilityId: BASIC_RHOM_ATTACK_DATA.sourceAbilityId,
        coreDamage: HOSTILE_RHOM_PROJECTILE_DATA.coreDamage,
        coreDamageFixedPoint: 500,
        spawnSequence,
        ...overrides
    });
}

function createRegistry(projectiles) {
    const records = new Map();
    records.set(handleKey(CORE_HANDLE), Object.freeze({
        ...CORE_HANDLE,
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        metadata: Object.freeze({})
    }));
    for (const projectile of projectiles) {
        records.set(handleKey(projectile.handle), Object.freeze({
            ...projectile.handle,
            kindId: 'projectile',
            definitionId: HOSTILE_RHOM_PROJECTILE_DATA.id,
            createdAtTick: 11,
            metadata: projectile.metadata
        }));
    }
    // SOURCE_HANDLE은 의도적으로 등록하지 않습니다. Projectile source Enemy의
    // active liveness는 committed Core request 인증 조건이 아닙니다.
    return Object.freeze({
        copyEntityView(handle, out = {}) {
            const record = records.get(handleKey(handle));
            if (!record) {
                return null;
            }
            Object.assign(out, record);
            return out;
        }
    });
}

function coreDamageRequest(projectileHandle, {
    sourceTick = 17,
    sequence = 0,
    valueFixedPoint = 500,
    coreHandle = CORE_HANDLE,
    disposition = 'applied'
} = {}) {
    return Object.freeze({
        type: 'contact',
        eventType: CORE_DAMAGE_REQUEST_EVENT_TYPE,
        disposition,
        ...PROTOCOL,
        sourceTick,
        sequence,
        entityId: projectileHandle.entityId,
        incarnation: projectileHandle.incarnation,
        other: coreHandle,
        valueFixedPoint,
        damageFixedPoint: 0,
        maximumDamageWindow: false
    });
}

function snapshot(events) {
    return Object.freeze({
        protocolFailure: null,
        events: Object.freeze(events)
    });
}

test('typed Core damage request는 append 순서와 source liveness에 무관하게 exact 정렬·dedupe한다', () => {
    const projectile40 = Object.freeze({ entityId: 40, incarnation: 5 });
    const projectile50 = Object.freeze({ entityId: 50, incarnation: 1 });
    const registry = createRegistry([
        {
            handle: projectile40,
            metadata: createProjectileMetadata(2)
        },
        {
            handle: projectile50,
            metadata: createProjectileMetadata(3)
        }
    ]);
    const core = new CoreIntegrity({ maxIntegrity: 7 });
    const director = new EnemyCoreImpactDirector({
        coreIntegrity: core,
        endpoint: createEndpoint()
    });
    const observed = director.observeCompletedEvents(snapshot([
        coreDamageRequest(projectile50, { sequence: 0 }),
        coreDamageRequest(projectile40, { sequence: 1 }),
        // append sequence가 달라도 same projectile/Core semantic request입니다.
        coreDamageRequest(projectile40, { sequence: 2 })
    ]), registry);

    const requests = observed.facts.filter(
        ({ type }) => type === CORE_IMPACT_FACT_TYPE.DAMAGE_REQUEST
    );
    assert.deepEqual(
        requests.map(({ projectileHandle }) => projectileHandle.entityId),
        [40, 50]
    );
    assert.deepEqual(
        requests.map(({ requestedDamage }) => requestedDamage),
        [5, 5]
    );
    assert.equal(requests[0].sequence, 1);
    assert.deepEqual(
        requests.map(({ appliedDamage }) => appliedDamage),
        [5, 2]
    );
    assert.ok(requests.every(({ sourceHandle }) => (
        sourceHandle.entityId === SOURCE_HANDLE.entityId
        && sourceHandle.incarnation === SOURCE_HANDLE.incarnation
    )));
    assert.equal(core.getCurrentIntegrity(), 0);
    assert.equal(observed.pendingCleanupCount, 0);
    assert.equal(
        observed.facts.filter(
            ({ type }) => type === CORE_IMPACT_FACT_TYPE.DEPLETED
        ).length,
        1
    );
    const status = director.getStatus();
    assert.equal(status.coreDamageRequestCommittedCount, 2);
    assert.equal(status.coreDamageRequestAppliedCount, 2);
    assert.equal(status.dedupedCount, 1);
    assert.equal(status.recoveryRequired, false);
});

test('한 completed snapshot의 forged typed request는 앞선 valid candidate도 원자적으로 폐기한다', () => {
    const validProjectile = Object.freeze({ entityId: 70, incarnation: 2 });
    const forgedProjectile = Object.freeze({ entityId: 71, incarnation: 1 });
    const core = new CoreIntegrity({ maxIntegrity: 20 });
    const director = new EnemyCoreImpactDirector({
        coreIntegrity: core,
        endpoint: createEndpoint()
    });
    const registry = createRegistry([
        {
            handle: validProjectile,
            metadata: createProjectileMetadata(4)
        },
        {
            handle: forgedProjectile,
            metadata: createProjectileMetadata(5, {
                producerId: 'forged-producer'
            })
        }
    ]);
    const before = director.getStatus();
    const observed = director.observeCompletedEvents(snapshot([
        coreDamageRequest(validProjectile, { sourceTick: 20, sequence: 0 }),
        coreDamageRequest(forgedProjectile, { sourceTick: 20, sequence: 1 })
    ]), registry);
    const after = director.getStatus();
    assert.equal(observed.facts.length, 0);
    assert.equal(core.getCurrentIntegrity(), 20);
    assert.equal(after.dedupedCount, before.dedupedCount);
    assert.equal(
        after.coreDamageRequestCommittedCount,
        before.coreDamageRequestCommittedCount
    );
    assert.deepEqual(after.lastCommittedFacts, before.lastCommittedFacts);
    assert.equal(after.pendingCleanupCount, before.pendingCleanupCount);
    assert.equal(after.recoveryRequired, true);
});

test('typed Core request의 fixed-point 또는 exact Core metadata 위조는 HP mutation 없이 recovery한다', () => {
    const projectile = Object.freeze({ entityId: 60, incarnation: 4 });
    const core = new CoreIntegrity({ maxIntegrity: 10 });
    const director = new EnemyCoreImpactDirector({
        coreIntegrity: core,
        endpoint: createEndpoint()
    });
    const registry = createRegistry([{
        handle: projectile,
        metadata: createProjectileMetadata(0)
    }]);
    const forged = director.observeCompletedEvents(snapshot([
        coreDamageRequest(projectile, { valueFixedPoint: 499 })
    ]), registry);
    assert.equal(forged.facts.length, 0);
    assert.equal(core.getCurrentIntegrity(), 10);
    assert.equal(forged.recoveryRequired, true);
    assert.equal(
        director.getStatus().coreDamageRequestFailure.reason,
        'metadata-authentication'
    );

    const wrongCore = Object.freeze({ entityId: 99, incarnation: 1 });
    const secondCore = new CoreIntegrity({ maxIntegrity: 10 });
    const secondDirector = new EnemyCoreImpactDirector({
        coreIntegrity: secondCore,
        endpoint: createEndpoint()
    });
    const wrongExact = secondDirector.observeCompletedEvents(snapshot([
        coreDamageRequest(projectile, { coreHandle: wrongCore })
    ]), registry);
    assert.equal(wrongExact.facts.length, 0);
    assert.equal(secondCore.getCurrentIntegrity(), 10);
    assert.equal(wrongExact.recoveryRequired, true);
    assert.equal(
        secondDirector.getStatus().coreDamageRequestFailure.reason,
        'exact-entity-contract'
    );
});

test('endpoint가 확정한 duplicate/replay/stale Core request는 registry 인증 없이 telemetry만 반영한다', () => {
    const projectile = Object.freeze({ entityId: 80, incarnation: 3 });
    const core = new CoreIntegrity({ maxIntegrity: 10 });
    const director = new EnemyCoreImpactDirector({
        coreIntegrity: core,
        endpoint: createEndpoint()
    });
    const registry = createRegistry([]);
    const before = director.getStatus();
    const observed = director.observeCompletedEvents(snapshot([
        coreDamageRequest(projectile, {
            disposition: 'duplicate',
            sequence: 0
        }),
        coreDamageRequest(projectile, {
            disposition: 'replay',
            sequence: 1
        }),
        coreDamageRequest(projectile, {
            disposition: 'stale',
            sequence: 2
        })
    ]), registry);
    const after = director.getStatus();
    assert.equal(observed.facts.length, 0);
    assert.equal(core.getCurrentIntegrity(), 10);
    assert.equal(after.dedupedCount - before.dedupedCount, 2);
    assert.equal(after.ignoredCount - before.ignoredCount, 1);
    assert.equal(after.coreDamageRequestCommittedCount, 0);
    assert.equal(after.coreDamageRequestFailure, null);
    assert.equal(after.recoveryRequired, false);
    assert.deepEqual(after.binding, before.binding);
    assert.deepEqual(after.lastCommittedFacts, before.lastCommittedFacts);
});

test('unknown Core request disposition만 sticky recovery하며 앞선 dedupe telemetry도 원자적으로 폐기한다', () => {
    const projectile = Object.freeze({ entityId: 81, incarnation: 4 });
    const core = new CoreIntegrity({ maxIntegrity: 10 });
    const director = new EnemyCoreImpactDirector({
        coreIntegrity: core,
        endpoint: createEndpoint()
    });
    const before = director.getStatus();
    const observed = director.observeCompletedEvents(snapshot([
        coreDamageRequest(projectile, {
            disposition: 'duplicate',
            sequence: 0
        }),
        coreDamageRequest(projectile, {
            disposition: 'observed',
            sequence: 1
        })
    ]), createRegistry([]));
    const after = director.getStatus();
    assert.equal(observed.facts.length, 0);
    assert.equal(core.getCurrentIntegrity(), 10);
    assert.equal(after.dedupedCount, before.dedupedCount);
    assert.equal(after.coreDamageRequestCommittedCount, 0);
    assert.equal(after.coreDamageRequestFailure.reason, 'unknown-disposition');
    assert.equal(after.recoveryRequired, true);
});
