import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    HOSTILE_ATTACK_COMMAND_NAMESPACE,
    HOSTILE_ATTACK_SHOT_STATE,
    HostileAttackDirector,
    computeHostileAttackPhaseOffset,
    createHostileAttackCommandId
} = await loadGameModule(
    'ingame/object/enemy/hostile_attack_director.js'
);
const {
    ARCHER_ENEMY_DATA
} = await loadGameModule('data/object/enemy/archer_enemy_data.js');
const {
    ARCHER_ATTACK_DATA
} = await loadGameModule('data/object/enemy/archer_attack_data.js');
const {
    HOSTILE_BASIC_BULLET_DATA
} = await loadGameModule(
    'data/object/projectile/hostile_basic_bullet_data.js'
);
const {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');
const {
    PROJECTILE_TARGET_POLICY_ID
} = await loadGameModule(
    'ingame/contract/projectile_target_policy_contract.js'
);
const {
    createEnemyCapabilityMask,
    ENEMY_CAPABILITY_ID
} = await loadGameModule('ingame/contract/enemy_capability_contract.js');
const {
    GPU_PROJECTILE_SPAWN_MODE
} = await loadGameModule('ingame/gpu_simulation_endpoint.js');

const SESSION_GENERATION = 7;
const ARCHER_CAPABILITY_MASK = createEnemyCapabilityMask(
    ARCHER_ENEMY_DATA.capabilityIds
);
const BASIC_ENEMY_CAPABILITY_MASK = createEnemyCapabilityMask([
    ENEMY_CAPABILITY_ID.NAVIGATION,
    ENEMY_CAPABILITY_ID.CONTACT_COMBAT
]);

function createArcherMetadata(capabilityMask = ARCHER_CAPABILITY_MASK) {
    return Object.freeze({
        definitionId: ARCHER_ENEMY_DATA.id,
        enemyDefinitionId: ARCHER_ENEMY_DATA.id,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        capabilityMask,
        physicsProfileId: ARCHER_ENEMY_DATA.physicsProfileId,
        combatProfileId: ARCHER_ENEMY_DATA.combatProfileId,
        behaviorProfileId: ARCHER_ENEMY_DATA.behaviorProfileId
    });
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

class ExactRegistryFixture {
    constructor() {
        this.records = new Map();
        this.fullScanCallCount = 0;
    }

    add(handle, {
        kindId = 'enemy',
        definitionId = ARCHER_ENEMY_DATA.id,
        createdAtTick = 1,
        metadata = undefined
    } = {}) {
        const resolvedMetadata = metadata === undefined && kindId === 'enemy'
            ? definitionId === ARCHER_ENEMY_DATA.id
                ? createArcherMetadata()
                : Object.freeze({ capabilityMask: BASIC_ENEMY_CAPABILITY_MASK })
            : metadata ?? null;
        this.records.set(handleKey(handle), {
            entityId: handle.entityId,
            incarnation: handle.incarnation,
            kindId,
            definitionId,
            createdAtTick,
            metadata: resolvedMetadata
        });
    }

    remove(handle) {
        return this.records.delete(handleKey(handle));
    }

    has(handle) {
        return this.records.has(handleKey(handle));
    }

    copyEntityView(handle, out = {}) {
        const record = this.records.get(handleKey(handle));
        if (!record) {
            return null;
        }
        Object.assign(out, record);
        return out;
    }

    copyActiveHandlesInto() {
        this.fullScanCallCount++;
        throw new Error('HostileAttackDirector는 full registry scan을 호출하면 안 됩니다.');
    }
}

class ExactBackendFixture {
    constructor() {
        this.handles = new Set();
    }

    add(handle) {
        this.handles.add(handleKey(handle));
    }

    remove(handle) {
        this.handles.delete(handleKey(handle));
    }

    hasBody(handle) {
        return this.handles.has(handleKey(handle));
    }
}

class ProjectileAdapterFixture {
    constructor() {
        this.calls = [];
        this.receipts = [];
    }

    queueReceipt(receipt) {
        this.receipts.push(receipt);
    }

    requestProjectile(options) {
        this.calls.push(options);
        const queued = this.receipts.shift();
        if (queued) {
            return {
                commandId: options.commandId,
                targetFixedTick: options.targetFixedTick,
                ...queued
            };
        }
        return Object.freeze({
            accepted: true,
            commandId: options.commandId,
            targetFixedTick: options.targetFixedTick
        });
    }
}

function createFixture(options = {}) {
    const registry = new ExactRegistryFixture();
    const backend = new ExactBackendFixture();
    const adapter = new ProjectileAdapterFixture();
    const director = new HostileAttackDirector({
        registry,
        backend,
        projectileSpawnAdapter: adapter,
        sessionGeneration: SESSION_GENERATION,
        historyCapacity: options.historyCapacity ?? 16,
        enemyDefinitions: options.enemyDefinitions,
        maximumSourceAuditsPerFixedTick:
            options.maximumSourceAuditsPerFixedTick
    });
    return { registry, backend, adapter, director };
}

function addExactBody(fixture, handle, descriptor = {}) {
    fixture.registry.add(handle, descriptor);
    fixture.backend.add(handle);
    return handle;
}

function emptyFixedCommands(overrides = {}) {
    return {
        state: 'committed',
        sourceRelativeSpawns: [],
        rejected: [],
        completed: [],
        recoveryRequired: false,
        protocolFailure: null,
        ...overrides
    };
}

function observeLifecycle(fixture, fixedTick, overrides = {}) {
    return fixture.director.observeFixedCommit({
        fixedTick,
        state: 'committed',
        spawned: [],
        despawned: [],
        fixedCommands: emptyFixedCommands(),
        ...overrides
    }, fixedTick);
}

function registerArcher(fixture, handle, createdAtTick = 1) {
    addExactBody(fixture, handle, { createdAtTick });
    const observed = observeLifecycle(fixture, createdAtTick, {
        spawned: [{ commandId: `spawn:${handleKey(handle)}`, handle }]
    });
    assert.equal(observed.recoveryRequired, false);
    assert.equal(observed.spawnedArcherCount, 1);
    return fixture.director.getStatus().archers.find(({ handle: current }) => (
        handleKey(current) === handleKey(handle)
    ));
}

function addTower(fixture, handle = { entityId: 900, incarnation: 1 }) {
    return addExactBody(fixture, handle, {
        kindId: 'tower',
        definitionId: 'the_tower_gpu_01',
        createdAtTick: 1
    });
}

function acceptPendingAtFixedCommit(fixture, fixedTick, destinationHandle) {
    const [{ commandId }] = fixture.adapter.calls.slice(-1);
    const result = observeLifecycle(fixture, fixedTick, {
        fixedCommands: emptyFixedCommands({
            sourceRelativeSpawns: [{
                commandId,
                handle: destinationHandle,
                state: 'gpu-resolve-pending'
            }]
        })
    });
    assert.equal(result.recoveryRequired, false);
    assert.equal(result.fixedAcceptedCount, 1);
    return commandId;
}

function completePending(fixture, fixedTick, commandId, destinationHandle, outcome) {
    return observeLifecycle(fixture, fixedTick, {
        fixedCommands: emptyFixedCommands({
            completed: [{ commandId, handle: destinationHandle, outcome }]
        })
    });
}

test('integer-safe phase와 Archer command ID는 exact identity에서 replay-stable하다', () => {
    const input = {
        entityId: 31,
        incarnation: 4,
        phaseSpreadTicks: ARCHER_ATTACK_DATA.phaseSpreadTicks
    };
    const originalRandom = Math.random;
    const originalNow = Date.now;
    Math.random = () => {
        throw new Error('phase는 random을 읽으면 안 됩니다.');
    };
    Date.now = () => {
        throw new Error('phase는 wall clock을 읽으면 안 됩니다.');
    };
    try {
        assert.equal(
            computeHostileAttackPhaseOffset(input),
            computeHostileAttackPhaseOffset(input)
        );
        assert.equal(computeHostileAttackPhaseOffset({
            entityId: 31,
            incarnation: 4,
            phaseSpreadTicks: 0
        }), 0);
        const spread = new Set();
        for (let entityId = 31; entityId < 39; entityId++) {
            spread.add(computeHostileAttackPhaseOffset({
                entityId,
                incarnation: 4,
                phaseSpreadTicks: 30
            }));
        }
        assert.ok(spread.size > 1);
    } finally {
        Math.random = originalRandom;
        Date.now = originalNow;
    }

    const commandId = createHostileAttackCommandId({
        sessionGeneration: SESSION_GENERATION,
        sourceHandle: { entityId: 31, incarnation: 4 },
        targetHandle: { entityId: 47, incarnation: 9 },
        targetFixedTick: 55,
        shotSequence: 2,
        attackDefinitionId: ARCHER_ATTACK_DATA.id
    });
    assert.equal(HOSTILE_ATTACK_COMMAND_NAMESPACE, 'gpu-hostile-archer-shot');
    assert.equal(
        commandId,
        'gpu-hostile-archer-shot:7:31:4:47:9:55:2:archer_basic_shot_01'
    );
    assert.throws(() => createHostileAttackCommandId({
        sessionGeneration: SESSION_GENERATION,
        sourceHandle: { entityId: 31, incarnation: 4 },
        targetHandle: { entityId: 0, incarnation: 9 },
        targetFixedTick: 55,
        shotSequence: 2,
        attackDefinitionId: ARCHER_ATTACK_DATA.id
    }), /targetHandle.entityId/);
});

test('lifecycle roster는 Archer만 exact 등록하고 duplicate/stale incarnation을 scan 없이 처리한다', () => {
    const fixture = createFixture();
    const nonArcher = addExactBody(fixture, { entityId: 1, incarnation: 1 }, {
        definitionId: 'basic_arrow_01',
        createdAtTick: 2
    });
    const archerV1 = addExactBody(fixture, { entityId: 2, incarnation: 1 }, {
        createdAtTick: 2
    });
    const first = observeLifecycle(fixture, 2, {
        spawned: [
            { commandId: 'spawn:basic-arrow', handle: nonArcher },
            { commandId: 'spawn:archer-v1', handle: archerV1 }
        ]
    });
    assert.equal(first.spawnedArcherCount, 1);
    assert.equal(fixture.director.getStatus().activeArcherCount, 1);
    assert.equal(
        fixture.director.getStatus().archers[0].nextEligibleFixedTick,
        2 + ARCHER_ATTACK_DATA.initialDelayTicks
            + computeHostileAttackPhaseOffset({
                ...archerV1,
                phaseSpreadTicks: ARCHER_ATTACK_DATA.phaseSpreadTicks
            })
    );
    const tower = addTower(fixture);
    assert.equal(fixture.director.stageForFixedTick({
        targetFixedTick: 2,
        targetHandle: tower
    }).attemptedCount, 0, 'spawn commit tick에는 새 Archer가 발사하면 안 됩니다.');

    const duplicate = observeLifecycle(fixture, 2, {
        spawned: [{ commandId: 'spawn:archer-v1', handle: archerV1 }]
    });
    assert.equal(duplicate.spawnedArcherCount, 0);
    assert.equal(
        fixture.director.getStatus().telemetry.duplicateSpawnObservations,
        1
    );

    fixture.registry.remove(archerV1);
    fixture.backend.remove(archerV1);
    const archerV2 = addExactBody(fixture, { entityId: 2, incarnation: 2 }, {
        createdAtTick: 3
    });
    const replacement = observeLifecycle(fixture, 3, {
        spawned: [{ commandId: 'spawn:archer-v2', handle: archerV2 }]
    });
    assert.equal(replacement.spawnedArcherCount, 1);
    assert.deepEqual(
        JSON.parse(JSON.stringify(
            fixture.director.getStatus().archers.map(({ handle }) => handle)
        )),
        [{ ...archerV2 }]
    );

    const oldRemoval = observeLifecycle(fixture, 4, {
        despawned: [{ commandId: 'despawn:old', handle: archerV1 }]
    });
    assert.equal(oldRemoval.removedArcherCount, 0);
    assert.equal(fixture.director.getStatus().activeArcherCount, 1);
    assert.equal(fixture.registry.fullScanCallCount, 0);
});

test('동일 boundary의 registry-only 비공격 spawn은 무시하되 실제 attack source parity는 fail-close한다', () => {
    const nonAttackFixture = createFixture();
    const formationDestination = { entityId: 5, incarnation: 2 };
    nonAttackFixture.registry.add(formationDestination, {
        definitionId: 'basic_hexa_01',
        createdAtTick: 9
    });
    const ignored = observeLifecycle(nonAttackFixture, 9, {
        spawned: [{
            commandId: 'formation-transform:destination',
            handle: formationDestination
        }]
    });
    assert.equal(ignored.recoveryRequired, false);
    assert.equal(ignored.spawnedSourceCount, 0);
    assert.equal(nonAttackFixture.director.getStatus().activeSourceCount, 0);
    assert.equal(
        nonAttackFixture.director.getStatus().telemetry.nonAttackSpawnsIgnored,
        1
    );

    const attackFixture = createFixture();
    const registryOnlyArcher = { entityId: 6, incarnation: 1 };
    attackFixture.registry.add(registryOnlyArcher, { createdAtTick: 9 });
    const rejected = observeLifecycle(attackFixture, 9, {
        spawned: [{
            commandId: 'spawn:registry-only-archer',
            handle: registryOnlyArcher
        }]
    });
    assert.equal(rejected.recoveryRequired, true);
    assert.equal(
        rejected.protocolFailure.code,
        'spawn-registry-backend-desync'
    );
    assert.equal(attackFixture.director.getStatus().activeSourceCount, 0);
});

test('Hostile roster와 attack catalog는 TARGETING capability bit를 exact runtime authority로 사용한다', () => {
    const missingTargetingDefinition = Object.freeze({
        ...ARCHER_ENEMY_DATA,
        capabilityIds: Object.freeze(
            ARCHER_ENEMY_DATA.capabilityIds.filter(
                (id) => id !== ENEMY_CAPABILITY_ID.TARGETING
            )
        )
    });
    assert.throws(() => createFixture({
        enemyDefinitions: Object.freeze({
            [missingTargetingDefinition.id]: missingTargetingDefinition
        })
    }), /TARGETING capability/);

    const invalidFixture = createFixture();
    const annotationOnly = addExactBody(
        invalidFixture,
        { entityId: 7, incarnation: 1 },
        {
            createdAtTick: 2,
            metadata: createArcherMetadata(BASIC_ENEMY_CAPABILITY_MASK)
        }
    );
    const invalidObserved = observeLifecycle(invalidFixture, 2, {
        spawned: [{
            commandId: 'spawn:annotation-only-archer',
            handle: annotationOnly
        }]
    });
    assert.equal(invalidObserved.spawnedArcherCount, 0);
    assert.equal(invalidObserved.recoveryRequired, true);
    assert.equal(
        invalidObserved.protocolFailure.code,
        'spawn-source-metadata-contract'
    );

    const fixture = createFixture();
    const targetingArcher = addExactBody(
        fixture,
        { entityId: 8, incarnation: 1 },
        {
            createdAtTick: 2,
            metadata: createArcherMetadata()
        }
    );
    const observed = observeLifecycle(fixture, 2, {
        spawned: [{ commandId: 'spawn:targeting-archer', handle: targetingArcher }]
    });
    assert.equal(observed.spawnedArcherCount, 1);
    assert.equal(observed.recoveryRequired, false);
    assert.deepEqual(
        { ...fixture.director.getStatus().archers[0].handle },
        targetingArcher
    );
    assert.equal(fixture.director.getStatus().telemetry.nonAttackSpawnsIgnored, 0);
});

test('completed death와 lifecycle despawn은 exact Archer를 staging 전에 제거한다', () => {
    const deathFixture = createFixture();
    const archer = { entityId: 11, incarnation: 3 };
    registerArcher(deathFixture, archer, 5);
    const tower = addTower(deathFixture);
    const death = deathFixture.director.observeCompletedEvents({
        deathEvents: [{
            type: 'death',
            disposition: 'despawn-requested',
            sessionGeneration: SESSION_GENERATION,
            ...archer
        }]
    });
    assert.equal(death.removedArcherCount, 1);
    assert.equal(death.recoveryRequired, false);
    assert.equal(deathFixture.director.stageForFixedTick({
        targetFixedTick: 100,
        targetHandle: tower
    }).attemptedCount, 0);

    const despawnFixture = createFixture();
    const archerV2 = { entityId: 12, incarnation: 4 };
    registerArcher(despawnFixture, archerV2, 5);
    const despawn = observeLifecycle(despawnFixture, 6, {
        despawned: [{ commandId: 'despawn:archer', handle: archerV2 }]
    });
    assert.equal(despawn.removedArcherCount, 1);
    assert.equal(despawnFixture.director.getStatus().activeArcherCount, 0);
});

test('자가복구 source 감사는 gameplay refresh와 독립된 bounded budget으로 순환한다', () => {
    const fixture = createFixture();
    const handles = Array.from({ length: 9 }, (_, index) => ({
        entityId: 100 + index,
        incarnation: 1
    }));
    for (const handle of handles) {
        registerArcher(fixture, handle, 1);
        fixture.registry.remove(handle);
        fixture.backend.remove(handle);
    }

    assert.equal(
        fixture.director.getStatus().maximumSourceAuditsPerFixedTick,
        8
    );
    const first = fixture.director.stageForFixedTick({
        targetFixedTick: 2,
        targetHandle: null
    });
    assert.equal(first.removedStaleCount, 8);
    assert.equal(fixture.director.getStatus().activeSourceCount, 1);

    const second = fixture.director.stageForFixedTick({
        targetFixedTick: 3,
        targetHandle: null
    });
    assert.equal(second.removedStaleCount, 1);
    assert.equal(fixture.director.getStatus().activeSourceCount, 0);
    assert.equal(fixture.director.requiresRecovery(), false);
});

test('eligible order와 per-tick budget은 deterministic하며 deferred Archer cooldown을 소비하지 않는다', () => {
    const fixture = createFixture();
    const tower = addTower(fixture);
    const handles = [
        { entityId: 21, incarnation: 1 },
        { entityId: 22, incarnation: 1 },
        { entityId: 23, incarnation: 1 },
        { entityId: 24, incarnation: 1 },
        { entityId: 25, incarnation: 1 },
        { entityId: 26, incarnation: 1 }
    ];
    handles.forEach((handle, index) => registerArcher(
        fixture,
        handle,
        2 + (index % 2)
    ));
    const before = fixture.director.getStatus().archers;
    const expectedOrder = [...before].sort((left, right) => (
        left.nextEligibleFixedTick - right.nextEligibleFixedTick
        || left.createdAtTick - right.createdAtTick
        || left.handle.entityId - right.handle.entityId
        || left.handle.incarnation - right.handle.incarnation
    ));

    const staged = fixture.director.stageForFixedTick({
        targetFixedTick: 100,
        targetHandle: tower
    });
    assert.deepEqual({
        eligibleCount: staged.eligibleCount,
        attemptedCount: staged.attemptedCount,
        acceptedCount: staged.acceptedCount,
        deferredCount: staged.deferredCount
    }, {
        eligibleCount: 6,
        attemptedCount: 4,
        acceptedCount: 4,
        deferredCount: 2
    });
    assert.deepEqual(
        fixture.adapter.calls.map(({ sourceHandle }) => ({ ...sourceHandle })),
        expectedOrder.slice(0, 4).map(({ handle }) => ({ ...handle }))
    );
    const deferredKeys = new Set(
        expectedOrder.slice(4).map(({ handle }) => handleKey(handle))
    );
    for (const record of fixture.director.getStatus().archers) {
        if (!deferredKeys.has(handleKey(record.handle))) {
            continue;
        }
        const original = before.find(({ handle }) => (
            handleKey(handle) === handleKey(record.handle)
        ));
        assert.equal(record.shotSequence, 0);
        assert.equal(record.nextEligibleFixedTick, original.nextEligibleFixedTick);
        assert.equal(record.state, HOSTILE_ATTACK_SHOT_STATE.IDLE);
    }
    const repeated = fixture.director.stageForFixedTick({
        targetFixedTick: 100,
        targetHandle: tower
    });
    assert.equal(repeated.attemptedCount, 0);
    assert.equal(repeated.deferredCount, 2);
    assert.equal(fixture.adapter.calls.length, 4);

    const call = fixture.adapter.calls[0];
    assert.equal(call.mode, GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY);
    assert.strictEqual(call.definition, HOSTILE_BASIC_BULLET_DATA);
    assert.deepEqual({ ...call.targetHandle }, { ...tower });
    assert.deepEqual({ ...call.ownerHandle }, { ...call.sourceHandle });
    assert.equal(call.launchSpeed, ARCHER_ATTACK_DATA.launchSpeed);
    assert.equal(call.allegiancePolicy, GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT);
    assert.equal(
        call.targetPolicyId,
        PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
    );
    assert.equal(call.producerId, ARCHER_ATTACK_DATA.producerId);
    assert.equal(call.sourceAbilityId, ARCHER_ATTACK_DATA.sourceAbilityId);
});

test('request/fixed/GPU completion은 resolved에서만 sequence와 cooldown을 한 번 소비한다', () => {
    const fixture = createFixture();
    const archer = { entityId: 31, incarnation: 2 };
    const initial = registerArcher(fixture, archer, 10);
    const tower = addTower(fixture);
    const shotTick = initial.nextEligibleFixedTick;
    const staged = fixture.director.stageForFixedTick({
        targetFixedTick: shotTick,
        targetHandle: tower
    });
    assert.equal(staged.acceptedCount, 1);
    let status = fixture.director.getStatus();
    assert.equal(status.archers[0].state, HOSTILE_ATTACK_SHOT_STATE.REQUESTED_FOR_FIXED_TICK);
    assert.equal(status.archers[0].shotSequence, 0);
    assert.equal(status.archers[0].nextEligibleFixedTick, shotTick);

    const destination = { entityId: 701, incarnation: 1 };
    const commandId = acceptPendingAtFixedCommit(fixture, shotTick, destination);
    status = fixture.director.getStatus();
    assert.equal(status.archers[0].state, HOSTILE_ATTACK_SHOT_STATE.GPU_RESOLVE_PENDING);
    assert.equal(status.archers[0].shotSequence, 0);
    assert.equal(fixture.director.stageForFixedTick({
        targetFixedTick: shotTick + 1,
        targetHandle: tower
    }).attemptedCount, 0);
    assert.equal(fixture.adapter.calls.length, 1, 'readback delay 중 duplicate shot이 없어야 합니다.');

    const completed = completePending(
        fixture,
        shotTick + 2,
        commandId,
        destination,
        'resolved'
    );
    assert.equal(completed.completedCount, 1);
    assert.equal(completed.recoveryRequired, false);
    status = fixture.director.getStatus();
    assert.equal(status.pendingShotCount, 0);
    assert.equal(status.archers[0].state, HOSTILE_ATTACK_SHOT_STATE.IDLE);
    assert.equal(status.archers[0].shotSequence, 1);
    assert.equal(
        status.archers[0].nextEligibleFixedTick,
        shotTick + ARCHER_ATTACK_DATA.intervalTicks
    );

    const duplicate = completePending(
        fixture,
        shotTick + 3,
        commandId,
        destination,
        'resolved'
    );
    assert.equal(duplicate.completedCount, 0);
    assert.equal(duplicate.recoveryRequired, false);
    assert.equal(fixture.director.getStatus().archers[0].shotSequence, 1);
});

test('request/fixed rejection과 target-invalid/source-invalid은 cooldown을 소비하지 않는다', () => {
    const requestFixture = createFixture();
    const requestArcher = { entityId: 41, incarnation: 1 };
    const requestInitial = registerArcher(requestFixture, requestArcher, 1);
    const requestTower = addTower(requestFixture);
    requestFixture.adapter.queueReceipt({
        accepted: false,
        reason: 'command-capacity'
    });
    const requestRejected = requestFixture.director.stageForFixedTick({
        targetFixedTick: requestInitial.nextEligibleFixedTick,
        targetHandle: requestTower
    });
    assert.equal(requestRejected.rejectedCount, 1);
    assert.equal(requestRejected.recoveryRequired, false);
    assert.equal(requestFixture.director.getStatus().pendingShotCount, 0);
    assert.equal(requestFixture.director.getStatus().archers[0].shotSequence, 0);
    assert.equal(requestFixture.director.stageForFixedTick({
        targetFixedTick: requestInitial.nextEligibleFixedTick,
        targetHandle: requestTower
    }).attemptedCount, 0, '같은 tick request reject를 반복하지 않습니다.');
    assert.equal(requestFixture.director.stageForFixedTick({
        targetFixedTick: requestInitial.nextEligibleFixedTick + 1,
        targetHandle: requestTower
    }).acceptedCount, 1);

    const fixedFixture = createFixture();
    const fixedArcher = { entityId: 42, incarnation: 1 };
    const fixedInitial = registerArcher(fixedFixture, fixedArcher, 1);
    const fixedTower = addTower(fixedFixture);
    const fixedTick = fixedInitial.nextEligibleFixedTick;
    fixedFixture.director.stageForFixedTick({
        targetFixedTick: fixedTick,
        targetHandle: fixedTower
    });
    const [{ commandId: rejectedCommandId }] = fixedFixture.adapter.calls;
    const fixedRejected = observeLifecycle(fixedFixture, fixedTick, {
        fixedCommands: emptyFixedCommands({
            rejected: [{
                commandId: rejectedCommandId,
                domain: 'spawn',
                code: 'spawn-program-capacity'
            }]
        })
    });
    assert.equal(fixedRejected.fixedRejectedCount, 1);
    assert.equal(fixedRejected.recoveryRequired, false);
    assert.equal(fixedFixture.director.getStatus().archers[0].shotSequence, 0);
    assert.equal(fixedFixture.director.stageForFixedTick({
        targetFixedTick: fixedTick + 1,
        targetHandle: fixedTower
    }).acceptedCount, 1);

    const targetFixture = createFixture();
    const targetArcher = { entityId: 43, incarnation: 1 };
    const targetInitial = registerArcher(targetFixture, targetArcher, 1);
    const targetTower = addTower(targetFixture);
    const targetTick = targetInitial.nextEligibleFixedTick;
    targetFixture.director.stageForFixedTick({
        targetFixedTick: targetTick,
        targetHandle: targetTower
    });
    const targetDestination = { entityId: 703, incarnation: 1 };
    const targetCommandId = acceptPendingAtFixedCommit(
        targetFixture,
        targetTick,
        targetDestination
    );
    targetFixture.registry.remove(targetTower);
    targetFixture.backend.remove(targetTower);
    const targetInvalid = completePending(
        targetFixture,
        targetTick + 1,
        targetCommandId,
        targetDestination,
        'target-invalid'
    );
    assert.equal(targetInvalid.recoveryRequired, false);
    assert.equal(targetFixture.director.getStatus().archers[0].shotSequence, 0);
    assert.equal(
        targetFixture.director.getStatus().archers[0].nextEligibleFixedTick,
        targetTick
    );

    const sourceFixture = createFixture();
    const sourceArcher = { entityId: 44, incarnation: 1 };
    const sourceInitial = registerArcher(sourceFixture, sourceArcher, 1);
    const sourceTower = addTower(sourceFixture);
    const sourceTick = sourceInitial.nextEligibleFixedTick;
    sourceFixture.director.stageForFixedTick({
        targetFixedTick: sourceTick,
        targetHandle: sourceTower
    });
    const sourceDestination = { entityId: 704, incarnation: 1 };
    const sourceCommandId = acceptPendingAtFixedCommit(
        sourceFixture,
        sourceTick,
        sourceDestination
    );
    const sourceInvalid = completePending(
        sourceFixture,
        sourceTick + 1,
        sourceCommandId,
        sourceDestination,
        'source-invalid'
    );
    assert.equal(sourceInvalid.recoveryRequired, false);
    assert.equal(sourceFixture.director.getStatus().activeArcherCount, 0);
    assert.equal(sourceFixture.director.getStatus().shotResolvedCount, 0);
});

test('null/dead Tower는 request 0이고 source death 뒤 legitimate pending completion은 exact 정리된다', () => {
    const fixture = createFixture();
    const archer = { entityId: 51, incarnation: 1 };
    const initial = registerArcher(fixture, archer, 1);
    const tower = addTower(fixture);
    assert.equal(fixture.director.stageForFixedTick({
        targetFixedTick: initial.nextEligibleFixedTick,
        targetHandle: null
    }).attemptedCount, 0);
    fixture.registry.remove(tower);
    fixture.backend.remove(tower);
    assert.equal(fixture.director.stageForFixedTick({
        targetFixedTick: initial.nextEligibleFixedTick + 1,
        targetHandle: tower
    }).attemptedCount, 0);
    addExactBody(fixture, tower, {
        kindId: 'tower',
        definitionId: 'the_tower_gpu_01',
        createdAtTick: 1
    });
    const shotTick = initial.nextEligibleFixedTick + 2;
    assert.equal(fixture.director.stageForFixedTick({
        targetFixedTick: shotTick,
        targetHandle: tower
    }).acceptedCount, 1);
    const destination = { entityId: 705, incarnation: 1 };
    const commandId = acceptPendingAtFixedCommit(fixture, shotTick, destination);

    const death = fixture.director.observeCompletedEvents({
        deathEvents: [{
            type: 'death',
            disposition: 'despawn-requested',
            sessionGeneration: SESSION_GENERATION,
            ...archer
        }]
    });
    assert.equal(death.removedArcherCount, 1);
    assert.equal(fixture.director.getStatus().activeArcherCount, 0);
    assert.equal(fixture.director.getStatus().pendingShotCount, 1);
    assert.equal(fixture.director.stageForFixedTick({
        targetFixedTick: shotTick + 1,
        targetHandle: tower
    }).attemptedCount, 0);

    const completion = completePending(
        fixture,
        shotTick + 1,
        commandId,
        destination,
        'resolved'
    );
    assert.equal(completion.completedCount, 1);
    assert.equal(completion.recoveryRequired, false);
    assert.equal(fixture.director.getStatus().pendingShotCount, 0);
    assert.equal(fixture.director.getStatus().activeArcherCount, 0);
});

test('old/unrelated/duplicate 결과는 bounded하게 drop하고 same-session unknown은 sticky fail-closed다', () => {
    const fixture = createFixture({ historyCapacity: 2 });
    const unrelated = observeLifecycle(fixture, 1, {
        fixedCommands: emptyFixedCommands({
            completed: [{
                commandId: 'gpu-primary-projectile:1:1:1',
                handle: { entityId: 1, incarnation: 1 },
                outcome: 'resolved'
            }, {
                commandId: 'gpu-hostile-archer-shot:6:1:1:2:1:1:0:archer_basic_shot_01',
                handle: { entityId: 2, incarnation: 1 },
                outcome: 'resolved'
            }]
        })
    });
    assert.equal(unrelated.recoveryRequired, false);
    assert.equal(unrelated.staleResultCount, 1);

    const archer = { entityId: 61, incarnation: 1 };
    const initial = registerArcher(fixture, archer, 2);
    const tower = addTower(fixture);
    const shotTick = initial.nextEligibleFixedTick;
    fixture.director.stageForFixedTick({ targetFixedTick: shotTick, targetHandle: tower });
    const destination = { entityId: 706, incarnation: 1 };
    const commandId = acceptPendingAtFixedCommit(fixture, shotTick, destination);
    fixture.director.reset();
    const resetStale = completePending(
        fixture,
        shotTick + 1,
        commandId,
        destination,
        'resolved'
    );
    assert.equal(resetStale.recoveryRequired, false);
    assert.equal(fixture.director.getStatus().activeArcherCount, 0);

    const unknownCommandId = createHostileAttackCommandId({
        sessionGeneration: SESSION_GENERATION,
        sourceHandle: { entityId: 71, incarnation: 1 },
        targetHandle: tower,
        targetFixedTick: shotTick + 2,
        shotSequence: 0,
        attackDefinitionId: ARCHER_ATTACK_DATA.id
    });
    const unknown = observeLifecycle(fixture, shotTick + 2, {
        fixedCommands: emptyFixedCommands({
            completed: [{
                commandId: unknownCommandId,
                handle: { entityId: 707, incarnation: 1 },
                outcome: 'resolved'
            }]
        })
    });
    assert.equal(unknown.recoveryRequired, true);
    assert.equal(
        unknown.protocolFailure.code,
        'unknown-current-session-command'
    );
    assert.equal(fixture.director.getStatus().recoveryRequired, true);
    assert.equal(fixture.director.getStatus().terminalHistoryCapacity, 2);
    assert.equal(fixture.director.getStatus().terminalHistoryCount <= 2, true);

    fixture.director.destroy();
    fixture.director.destroy();
    assert.equal(fixture.director.getStatus().destroyed, true);
    assert.equal(fixture.director.getStatus().activeArcherCount, 0);
    assert.throws(() => fixture.director.observeCompletedEvents({}), /destroy/);
});

test('future session과 desync/control-domain rejection은 즉시 sticky recovery로 전환한다', () => {
    const futureFixture = createFixture();
    const future = observeLifecycle(futureFixture, 1, {
        fixedCommands: emptyFixedCommands({
            completed: [{
                commandId: 'gpu-hostile-archer-shot:8:1:1:2:1:1:0:archer_basic_shot_01',
                handle: { entityId: 3, incarnation: 1 },
                outcome: 'resolved'
            }]
        })
    });
    assert.equal(future.recoveryRequired, true);
    assert.equal(future.protocolFailure.code, 'future-session-command');
    assert.equal(futureFixture.director.requiresRecovery(), true);

    for (const rejection of [{
        domain: 'spawn',
        code: 'registry-backend-desync',
        expectedCode: 'registry-backend-desync'
    }, {
        domain: 'control',
        code: 'body-tick-conflict',
        expectedCode: 'rejected-domain-contract'
    }]) {
        const fixture = createFixture();
        const archer = { entityId: 81, incarnation: 1 };
        const initial = registerArcher(fixture, archer, 1);
        const tower = addTower(fixture);
        const tick = initial.nextEligibleFixedTick;
        fixture.director.stageForFixedTick({
            targetFixedTick: tick,
            targetHandle: tower
        });
        const [{ commandId }] = fixture.adapter.calls;
        const observed = observeLifecycle(fixture, tick, {
            fixedCommands: emptyFixedCommands({
                rejected: [{ commandId, ...rejection }]
            })
        });
        assert.equal(observed.recoveryRequired, true);
        assert.equal(observed.protocolFailure.code, rejection.expectedCode);
        assert.equal(fixture.director.requiresRecovery(), true);
        assert.equal(
            fixture.director.getStatus().pendingShotCount,
            1,
            'desync/잘못된 domain 결과로 pending을 정상 clear하면 안 됩니다.'
        );
    }
});

test('fixed acceptance state와 rejection domain 누락은 exact contract failure다', () => {
    const acceptanceFixture = createFixture();
    const acceptanceArcher = { entityId: 91, incarnation: 1 };
    const acceptanceInitial = registerArcher(
        acceptanceFixture,
        acceptanceArcher,
        1
    );
    const acceptanceTower = addTower(acceptanceFixture);
    const acceptanceTick = acceptanceInitial.nextEligibleFixedTick;
    acceptanceFixture.director.stageForFixedTick({
        targetFixedTick: acceptanceTick,
        targetHandle: acceptanceTower
    });
    const [{ commandId: acceptedCommandId }] = acceptanceFixture.adapter.calls;
    const missingState = observeLifecycle(acceptanceFixture, acceptanceTick, {
        fixedCommands: emptyFixedCommands({
            sourceRelativeSpawns: [{
                commandId: acceptedCommandId,
                handle: { entityId: 801, incarnation: 1 }
            }]
        })
    });
    assert.equal(missingState.recoveryRequired, true);
    assert.equal(missingState.protocolFailure.code, 'accepted-state-contract');
    assert.equal(acceptanceFixture.director.getStatus().pendingShotCount, 1);

    const rejectionFixture = createFixture();
    const rejectionArcher = { entityId: 92, incarnation: 1 };
    const rejectionInitial = registerArcher(rejectionFixture, rejectionArcher, 1);
    const rejectionTower = addTower(rejectionFixture);
    const rejectionTick = rejectionInitial.nextEligibleFixedTick;
    rejectionFixture.director.stageForFixedTick({
        targetFixedTick: rejectionTick,
        targetHandle: rejectionTower
    });
    const [{ commandId: rejectedCommandId }] = rejectionFixture.adapter.calls;
    const missingDomain = observeLifecycle(rejectionFixture, rejectionTick, {
        fixedCommands: emptyFixedCommands({
            rejected: [{
                commandId: rejectedCommandId,
                code: 'spawn-program-capacity'
            }]
        })
    });
    assert.equal(missingDomain.recoveryRequired, true);
    assert.equal(missingDomain.protocolFailure.code, 'rejected-domain-contract');
    assert.equal(rejectionFixture.director.getStatus().pendingShotCount, 1);
});

test('production Archer moderate churn은 exact incarnation과 SpawnProgram result ring을 격리하고 history를 bounded 유지한다', () => {
    const historyCapacity = 4;
    const fixture = createFixture({ historyCapacity });
    const tower = addTower(fixture);
    const rejectedCommands = [];
    const retiredHandles = [];
    let createdAtTick = 2;

    for (let incarnation = 1; incarnation <= 12; incarnation++) {
        const archer = { entityId: 301, incarnation };
        const initial = registerArcher(fixture, archer, createdAtTick);
        const view = fixture.registry.copyEntityView(archer, {});
        assert.equal(view.definitionId, ARCHER_ENEMY_DATA.id);
        assert.equal(fixture.backend.hasBody(archer), true);

        const shotTick = initial.nextEligibleFixedTick;
        const staged = fixture.director.stageForFixedTick({
            targetFixedTick: shotTick,
            targetHandle: tower
        });
        assert.equal(staged.acceptedCount, 1);
        const commandId = staged.commandIds[0];
        assert.match(
            commandId,
            new RegExp(`^${HOSTILE_ATTACK_COMMAND_NAMESPACE}:${SESSION_GENERATION}:301:${incarnation}:`)
        );
        const rejected = observeLifecycle(fixture, shotTick, {
            fixedCommands: emptyFixedCommands({
                rejected: [{
                    commandId,
                    domain: 'spawn',
                    code: 'spawn-program-capacity'
                }]
            })
        });
        assert.equal(rejected.fixedRejectedCount, 1);
        assert.equal(rejected.recoveryRequired, false);
        assert.equal(fixture.director.getStatus().pendingShotCount, 0);
        assert.equal(fixture.director.getStatus().archers[0].shotSequence, 0);
        rejectedCommands.push(commandId);

        fixture.registry.remove(archer);
        fixture.backend.remove(archer);
        const removed = observeLifecycle(fixture, shotTick + 1, {
            despawned: [{ commandId: `retire:${incarnation}`, handle: archer }]
        });
        assert.equal(removed.removedArcherCount, 1);
        assert.equal(fixture.director.getStatus().activeArcherCount, 0);
        retiredHandles.push(archer);
        createdAtTick = shotTick + 2;
    }

    const replacement = { entityId: 301, incarnation: 13 };
    registerArcher(fixture, replacement, createdAtTick);
    const lateRetirements = observeLifecycle(fixture, createdAtTick + 1, {
        despawned: retiredHandles.map((handle, index) => ({
            commandId: `late-retire:${index}`,
            handle
        }))
    });
    assert.equal(lateRetirements.removedArcherCount, 0);
    assert.equal(fixture.registry.has(replacement), true);
    assert.equal(fixture.backend.hasBody(replacement), true);
    assert.equal(fixture.director.getStatus().activeArcherCount, 1);
    assert.deepEqual(
        { ...fixture.director.getStatus().archers[0].handle },
        replacement
    );

    const duplicateCountBefore = fixture.director.getStatus().telemetry
        .duplicateResults;
    const recentRejectedCommands = rejectedCommands.slice(-historyCapacity);
    const replay = observeLifecycle(fixture, createdAtTick + 2, {
        fixedCommands: emptyFixedCommands({
            rejected: recentRejectedCommands.map((commandId) => ({
                commandId,
                domain: 'spawn',
                code: 'spawn-program-capacity'
            }))
        })
    });
    assert.equal(replay.fixedRejectedCount, 0);
    assert.equal(replay.recoveryRequired, false);
    const status = fixture.director.getStatus();
    assert.equal(
        status.telemetry.duplicateResults,
        duplicateCountBefore + historyCapacity
    );
    assert.equal(status.terminalHistoryCapacity, historyCapacity);
    assert.equal(status.terminalHistoryCount <= historyCapacity, true);
    assert.equal(status.pendingShotCount, 0);
    assert.equal(status.activeArcherCount, 1);
    assert.equal(status.recoveryRequired, false);
    assert.equal(fixture.registry.fullScanCallCount, 0);
});
