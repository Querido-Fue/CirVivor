import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ENEMY_LIFECYCLE_DISPOSITION_ID,
    isEnemyDispositionBountyEligible
} = await loadGameModule('ingame/contract/enemy_lifecycle_disposition_contract.js');
const {
    EnemyCoreImpactDirector
} = await loadGameModule('ingame/object/enemy/enemy_core_impact_director.js');
const {
    EnemyLifecycleCommandOwner
} = await loadGameModule('ingame/object/enemy/enemy_lifecycle_command_owner.js');
const {
    createGpuSimulationEndpoint
} = await loadGameModule('ingame/object/enemy/gpu_enemy_simulation_endpoint.js');
const {
    createGpuEnemySpawnIntent
} = await loadGameModule('ingame/object/enemy/gpu_enemy_spawn_adapter.js');
const {
    createGpuCoreProxySpawnIntent
} = await loadGameModule('ingame/object/core/gpu_core_proxy_spawn_adapter.js');
const { WorldRegistry } = await loadGameModule('ingame/object/world_registry.js');
const { CoreIntegrity } = await loadGameModule('ingame/state/core_integrity.js');
const {
    ENEMY_CAPABILITY_ID,
    createEnemyCapabilityMask
} = await loadGameModule('ingame/contract/enemy_capability_contract.js');

const PROTOCOL = Object.freeze({
    sessionGeneration: 71,
    deviceGeneration: 4,
    authoritativeEpoch: 9
});
const CORE_IMPACT_CAPABILITY_MASK = createEnemyCapabilityMask([
    ENEMY_CAPABILITY_ID.CORE_IMPACT
]);

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function createRegistry(records) {
    const byKey = new Map(records.map((record) => [
        handleKey(record),
        Object.freeze({
            entityId: record.entityId,
            incarnation: record.incarnation,
            kindId: record.kindId,
            definitionId: record.definitionId ?? null,
            metadata: Object.freeze({
                ...(record.kindId === 'enemy'
                    && !Object.prototype.hasOwnProperty.call(
                        record.metadata ?? {},
                        'capabilityMask'
                    )
                    ? { capabilityMask: CORE_IMPACT_CAPABILITY_MASK }
                    : null),
                ...(record.metadata ?? {})
            })
        })
    ]));
    return Object.freeze({
        copyEntityView(handle, out) {
            const record = byKey.get(handleKey(handle));
            if (!record) {
                return null;
            }
            Object.assign(out, record);
            return out;
        }
    });
}

function createEndpoint(responses = []) {
    const requests = [];
    return Object.freeze({
        requests,
        getStatus: () => Object.freeze({
            sessionGeneration: PROTOCOL.sessionGeneration,
            backend: Object.freeze({ ...PROTOCOL })
        }),
        getBackend: () => Object.freeze({
            getEventProtocolState: () => PROTOCOL
        }),
        requestDespawn(handle, reason, targetFixedTick, commandId, options) {
            requests.push(Object.freeze({
                handle: Object.freeze({ ...handle }),
                reason,
                targetFixedTick,
                commandId,
                options
            }));
            return responses.length > 0
                ? responses.shift()
                : Object.freeze({ accepted: true, commandId, targetFixedTick });
        }
    });
}

function createMutableProtocolEndpoint(initialProtocol = PROTOCOL) {
    let protocol = Object.freeze({ ...initialProtocol });
    const requests = [];
    return {
        requests,
        setProtocol(nextProtocol) {
            protocol = Object.freeze({ ...nextProtocol });
        },
        getStatus() {
            return Object.freeze({
                sessionGeneration: protocol.sessionGeneration,
                backend: protocol
            });
        },
        getBackend() {
            return Object.freeze({ getEventProtocolState: () => protocol });
        },
        requestDespawn(handle, reason, targetFixedTick, commandId, options) {
            requests.push(Object.freeze({
                handle: Object.freeze({ ...handle }),
                reason,
                targetFixedTick,
                commandId,
                options
            }));
            return Object.freeze({ accepted: true, commandId, targetFixedTick });
        }
    };
}

function createCommittedEventBackend() {
    const bodies = new Map();
    const completedEventBatches = [];
    let protocol = null;
    return {
        bodies,
        completedEventBatches,
        setProtocol(nextProtocol) {
            protocol = Object.freeze({ ...nextProtocol });
        },
        getCapacity() { return 8; },
        init() { return true; },
        spawnBodies(source) {
            const spawnBodies = Array.from(source);
            const handles = spawnBodies.map((body) => {
                const handle = Object.freeze({
                    entityId: body.entityId,
                    incarnation: body.incarnation
                });
                bodies.set(handleKey(handle), body);
                return handle;
            });
            return Object.freeze({
                accepted: handles.length,
                rejected: 0,
                handles
            });
        },
        despawnBodies(source) {
            const handles = Array.from(source);
            let removed = 0;
            for (const handle of handles) {
                removed += bodies.delete(handleKey(handle)) ? 1 : 0;
            }
            return Object.freeze({ removed, rejected: handles.length - removed });
        },
        hasBody(handle) { return bodies.has(handleKey(handle)); },
        hasActiveBodies() { return bodies.size > 0; },
        fixedUpdate() { return true; },
        drainCompletedEventBatches(out) {
            out.push(...completedEventBatches.splice(0));
            return out;
        },
        getEventProtocolState() { return protocol; },
        updatePresentation() {},
        synchronizePresentation() {},
        draw() { return true; },
        getRuntimeState() { return 'gpu-ready'; },
        requiresRecovery() { return false; },
        getStatus() {
            return Object.freeze({
                state: 'gpu-ready',
                ...(protocol ?? {})
            });
        },
        destroy() { bodies.clear(); }
    };
}

function coreEnter({
    entityId,
    incarnation,
    otherEntityId,
    otherIncarnation,
    sequence,
    protocol = PROTOCOL
}) {
    return Object.freeze({
        type: 'contact',
        eventType: 'interaction-enter',
        disposition: 'applied',
        ...protocol,
        sourceTick: 17,
        sequence,
        entityId,
        incarnation,
        other: Object.freeze({
            entityId: otherEntityId,
            incarnation: otherIncarnation
        })
    });
}

function snapshot(events) {
    return Object.freeze({
        protocolFailure: null,
        events: Object.freeze(events)
    });
}

test('Core impact는 semantic exact handle로 한 번만 damage하고 모든 같은-batch cleanup을 disposition과 함께 stage한다', () => {
    const core = new CoreIntegrity({ maxIntegrity: 10 });
    const endpoint = createEndpoint();
    const registry = createRegistry([
        { entityId: 10, incarnation: 1, kindId: 'core-proxy' },
        {
            entityId: 20,
            incarnation: 1,
            kindId: 'enemy',
            definitionId: 'basic_square_01',
            metadata: {
                definitionId: 'basic_square_01',
                coreImpactDamage: 3,
                bountyBudget: 2,
                physicsProfileId: 'physics.square',
                combatProfileId: 'combat.square',
                behaviorProfileId: 'behavior.corebound'
            }
        },
        {
            entityId: 21,
            incarnation: 4,
            kindId: 'enemy',
            definitionId: 'archer_01',
            metadata: {
                definitionId: 'archer_01',
                coreImpactDamage: 8,
                bountyBudget: 7,
                physicsProfileId: 'physics.archer',
                combatProfileId: 'combat.archer',
                behaviorProfileId: 'behavior.archer'
            }
        }
    ]);
    const director = new EnemyCoreImpactDirector({ coreIntegrity: core, endpoint });

    const observed = director.observeCompletedEvents(snapshot([
        coreEnter({
            entityId: 10,
            incarnation: 1,
            otherEntityId: 20,
            otherIncarnation: 1,
            sequence: 0
        }),
        // 동일 enemy/core pair의 역방향 append는 semantic duplicate입니다.
        coreEnter({
            entityId: 20,
            incarnation: 1,
            otherEntityId: 10,
            otherIncarnation: 1,
            sequence: 1
        }),
        coreEnter({
            entityId: 21,
            incarnation: 4,
            otherEntityId: 10,
            otherIncarnation: 1,
            sequence: 2
        })
    ]), registry);

    const impacts = observed.facts.filter(({ type }) => type === 'CoreImpact');
    const damages = observed.facts.filter(({ type }) => type === 'CoreDamaged');
    const depleted = observed.facts.filter(({ type }) => type === 'CoreDepleted');
    assert.equal(impacts.length, 2);
    assert.equal(damages.length, 2);
    assert.equal(depleted.length, 1);
    assert.deepEqual(Array.from(damages, ({ damage }) => damage), [3, 7]);
    assert.equal(core.getCurrentIntegrity(), 0);
    assert.equal(core.isTerminallySealed(), true);
    assert.equal(core.restoreIntegrity(5), 0);
    assert.ok(impacts.every(({ disposition, bountyEligible }) => (
        disposition === ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
        && bountyEligible === false
    )));

    const staged = director.stageForFixedTick({ targetFixedTick: 18, endpoint });
    assert.equal(staged.requested, 2);
    assert.equal(endpoint.requests.length, 2);
    assert.ok(endpoint.requests.every(({ reason, options }) => (
        reason === 'core-impact'
        && options.disposition === ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
    )));
    director.observeFixedCommit(Object.freeze({
        despawned: Object.freeze(endpoint.requests.map(({ commandId, handle }) => Object.freeze({
            commandId,
            handle,
            reason: 'core-impact',
            disposition: ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT,
            bountyEligible: false
        }))),
        rejected: Object.freeze([])
    }), 18);
    assert.equal(director.getStatus().pendingCleanupCount, 0);
    assert.equal(director.getStatus().trackedCleanupCount, 0);
    assert.equal(director.requiresRecovery(), false);

    // Depletion 뒤의 새 arrival는 Core damage나 duplicate cleanup을 만들지 않습니다.
    director.observeCompletedEvents(snapshot([
        coreEnter({
            entityId: 10,
            incarnation: 1,
            otherEntityId: 20,
            otherIncarnation: 1,
            sequence: 99
        })
    ]), registry);
    assert.equal(core.getCurrentIntegrity(), 0);
    assert.equal(endpoint.requests.length, 2);
});

test('Core impact fact publication은 configured capacity로 bounded되고 terminal fact를 보존한다', () => {
    const core = new CoreIntegrity({ maxIntegrity: 3 });
    const endpoint = createEndpoint();
    const registry = createRegistry([
        { entityId: 1, incarnation: 1, kindId: 'core-proxy' },
        {
            entityId: 2,
            incarnation: 1,
            kindId: 'enemy',
            metadata: { coreImpactDamage: 3, bountyBudget: 0 }
        }
    ]);
    const director = new EnemyCoreImpactDirector({
        coreIntegrity: core,
        endpoint,
        factCapacity: 2
    });
    const observed = director.observeCompletedEvents(snapshot([
        coreEnter({
            entityId: 1,
            incarnation: 1,
            otherEntityId: 2,
            otherIncarnation: 1,
            sequence: 0
        })
    ]), registry);

    assert.equal(observed.facts.length, 2);
    assert.equal(Object.isFrozen(observed.facts), true);
    assert.equal(observed.facts.at(-1).type, 'CoreDepleted');
    assert.equal(director.getStatus().recentFacts.length, 2);
    assert.equal(director.getStatus().factCapacity, 2);
});

test('같은 snapshot의 첫 impact가 Core를 소진해도 후속 impact는 appliedDamage 0과 exact cleanup을 남긴다', () => {
    const core = new CoreIntegrity({ maxIntegrity: 3 });
    const endpoint = createEndpoint();
    const registry = createRegistry([
        { entityId: 1, incarnation: 1, kindId: 'core-proxy' },
        {
            entityId: 2,
            incarnation: 1,
            kindId: 'enemy',
            metadata: { coreImpactDamage: 3, bountyBudget: 1 }
        },
        {
            entityId: 3,
            incarnation: 1,
            kindId: 'enemy',
            metadata: { coreImpactDamage: 9, bountyBudget: 2 }
        }
    ]);
    const director = new EnemyCoreImpactDirector({ coreIntegrity: core, endpoint });

    const observed = director.observeCompletedEvents(snapshot([
        coreEnter({
            entityId: 1,
            incarnation: 1,
            otherEntityId: 2,
            otherIncarnation: 1,
            sequence: 0
        }),
        coreEnter({
            entityId: 1,
            incarnation: 1,
            otherEntityId: 3,
            otherIncarnation: 1,
            sequence: 1
        })
    ]), registry);
    const impacts = observed.facts.filter(({ type }) => type === 'CoreImpact');
    assert.deepEqual(Array.from(impacts, ({ appliedDamage }) => appliedDamage), [3, 0]);
    assert.equal(observed.facts.filter(({ type }) => type === 'CoreDamaged').length, 1);
    assert.equal(observed.facts.filter(({ type }) => type === 'CoreDepleted').length, 1);
    assert.equal(observed.pendingCleanupCount, 2);
    assert.equal(core.getCurrentIntegrity(), 0);

    const staged = director.stageForFixedTick({ targetFixedTick: 18, endpoint });
    assert.equal(staged.requested, 2);
    assert.equal(endpoint.requests.length, 2);
    assert.deepEqual(
        endpoint.requests.map(({ handle }) => handle.entityId),
        [2, 3]
    );
});

test('Core cleanup commit은 exact lifecycle provenance 전체가 맞지 않으면 fail-close recovery한다', () => {
    const contradictions = [
        {
            label: 'wrong exact handle',
            buildResult: (entry) => ({
                despawned: [{
                    ...entry,
                    handle: { entityId: entry.handle.entityId, incarnation: 99 }
                }],
                rejected: []
            })
        },
        {
            label: 'wrong direct reason',
            buildResult: (entry) => ({
                despawned: [{ ...entry, reason: 'gpu-death' }],
                rejected: []
            })
        },
        {
            label: 'wrong disposition',
            buildResult: (entry) => ({
                despawned: [{ ...entry, disposition: 'killed' }],
                rejected: []
            })
        },
        {
            label: 'bounty eligible contradiction',
            buildResult: (entry) => ({
                despawned: [{ ...entry, bountyEligible: true }],
                rejected: []
            })
        },
        {
            label: 'despawn and rejection contradiction',
            buildResult: (entry) => ({
                despawned: [entry],
                rejected: [{ commandId: entry.commandId, code: 'stale-handle' }]
            })
        },
        {
            label: 'duplicate committed command',
            buildResult: (entry) => ({
                despawned: [entry, { ...entry }],
                rejected: []
            })
        },
        {
            label: 'duplicate exact handle with distinct command',
            buildResult: (entry) => ({
                despawned: [entry, {
                    ...entry,
                    commandId: 'other-lifecycle-command'
                }],
                rejected: []
            })
        }
    ];

    for (const { label, buildResult } of contradictions) {
        const core = new CoreIntegrity({ maxIntegrity: 10 });
        const endpoint = createEndpoint();
        const registry = createRegistry([
            { entityId: 1, incarnation: 1, kindId: 'core-proxy' },
            {
                entityId: 2,
                incarnation: 3,
                kindId: 'enemy',
                metadata: { coreImpactDamage: 1, bountyBudget: 0 }
            }
        ]);
        const director = new EnemyCoreImpactDirector({ coreIntegrity: core, endpoint });
        director.observeCompletedEvents(snapshot([coreEnter({
            entityId: 1,
            incarnation: 1,
            otherEntityId: 2,
            otherIncarnation: 3,
            sequence: 0
        })]), registry);
        assert.equal(
            director.stageForFixedTick({ targetFixedTick: 18, endpoint }).requested,
            1,
            label
        );
        const request = endpoint.requests[0];
        const exactCommit = {
            commandId: request.commandId,
            handle: request.handle,
            reason: 'core-impact',
            disposition: ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT,
            bountyEligible: false
        };

        const outcome = director.observeFixedCommit(
            buildResult(exactCommit),
            18
        );
        const status = director.getStatus();
        assert.equal(outcome.recoveryRequired, true, label);
        assert.equal(status.cleanupCommittedCount, 0, label);
        assert.equal(status.trackedCleanupCount, 0, label);
        assert.equal(
            status.cleanupFailure?.reason,
            'despawn-commit-provenance-contract',
            label
        );
    }
});

test('Core cleanup commit batch는 provenance 인증 전에 일부 cleanup을 전진시키지 않는다', () => {
    const core = new CoreIntegrity({ maxIntegrity: 10 });
    const endpoint = createEndpoint();
    const registry = createRegistry([
        { entityId: 1, incarnation: 1, kindId: 'core-proxy' },
        {
            entityId: 2,
            incarnation: 1,
            kindId: 'enemy',
            metadata: { coreImpactDamage: 1, bountyBudget: 0 }
        },
        {
            entityId: 3,
            incarnation: 1,
            kindId: 'enemy',
            metadata: { coreImpactDamage: 1, bountyBudget: 0 }
        }
    ]);
    const director = new EnemyCoreImpactDirector({ coreIntegrity: core, endpoint });
    director.observeCompletedEvents(snapshot([
        coreEnter({
            entityId: 1,
            incarnation: 1,
            otherEntityId: 2,
            otherIncarnation: 1,
            sequence: 0
        }),
        coreEnter({
            entityId: 1,
            incarnation: 1,
            otherEntityId: 3,
            otherIncarnation: 1,
            sequence: 1
        })
    ]), registry);
    assert.equal(
        director.stageForFixedTick({ targetFixedTick: 18, endpoint }).requested,
        2
    );
    const exactCommits = endpoint.requests.map(({ commandId, handle }) => ({
        commandId,
        handle,
        reason: 'core-impact',
        disposition: ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT,
        bountyEligible: false
    }));
    exactCommits[1] = { ...exactCommits[1], reason: 'forged-cleanup' };

    const outcome = director.observeFixedCommit({
        despawned: exactCommits,
        rejected: []
    }, 18);
    const status = director.getStatus();
    assert.equal(outcome.recoveryRequired, true);
    assert.equal(status.cleanupCommittedCount, 0);
    assert.equal(status.pendingCleanupCount, 1);
    assert.equal(
        status.cleanupFailure?.reason,
        'despawn-commit-provenance-contract'
    );
});

test('old protocol/stale event는 Core를 건드리지 않고 same-tick GPU death cleanup duplicate는 정상 성공이다', () => {
    const core = new CoreIntegrity({ maxIntegrity: 9 });
    const endpoint = createEndpoint([
        Object.freeze({
            accepted: false,
            reason: 'duplicate-despawn',
            commandId: 'gpu-death:exact-fixture',
            handle: Object.freeze({ entityId: 2, incarnation: 3 }),
            targetFixedTick: 18,
            disposition: ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT,
            authenticTerminalCleanup: true
        })
    ]);
    const registry = createRegistry([
        { entityId: 1, incarnation: 1, kindId: 'core-proxy' },
        {
            entityId: 2,
            incarnation: 3,
            kindId: 'enemy',
            metadata: {
                coreImpactDamage: 4,
                bountyBudget: 1,
                physicsProfileId: 'p',
                combatProfileId: 'c',
                behaviorProfileId: 'b'
            }
        }
    ]);
    const director = new EnemyCoreImpactDirector({ coreIntegrity: core, endpoint });

    const staleProtocol = Object.freeze({ ...PROTOCOL, deviceGeneration: 3 });
    director.observeCompletedEvents(snapshot([
        coreEnter({
            entityId: 1,
            incarnation: 1,
            otherEntityId: 2,
            otherIncarnation: 3,
            sequence: 0,
            protocol: staleProtocol
        })
    ]), registry);
    assert.equal(core.getCurrentIntegrity(), 9);

    director.observeCompletedEvents(snapshot([
        coreEnter({
            entityId: 1,
            incarnation: 1,
            otherEntityId: 2,
            otherIncarnation: 3,
            sequence: 1
        })
    ]), registry);
    assert.equal(core.getCurrentIntegrity(), 5);
    const staged = director.stageForFixedTick({ targetFixedTick: 18, endpoint });
    assert.equal(staged.requested, 0);
    assert.equal(staged.cleanupDeduped, 1);
    assert.equal(director.requiresRecovery(), false);
    assert.equal(director.getStatus().trackedCleanupCount, 1);
    director.observeFixedCommit({
        despawned: Object.freeze([Object.freeze({
            commandId: 'gpu-death:exact-fixture',
            handle: Object.freeze({ entityId: 2, incarnation: 3 }),
            reason: 'gpu-death',
            disposition: ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT,
            bountyEligible: false
        })]),
        rejected: Object.freeze([])
    }, 18);
    assert.equal(director.getStatus().trackedCleanupCount, 0);

    // GPU death event가 먼저 auto-queue한 despawn과 director request가 겹쳐도 damage는 한 번입니다.
    director.observeCompletedEvents(snapshot([
        coreEnter({
            entityId: 2,
            incarnation: 3,
            otherEntityId: 1,
            otherIncarnation: 1,
            sequence: 2
        })
    ]), registry);
    assert.equal(core.getCurrentIntegrity(), 5);
    assert.equal(director.getStatus().cleanupDedupedCount, 1);
});

test('Core director는 exact registry CORE_IMPACT bit를 요구하고 bare duplicate-command를 recovery로 올린다', () => {
    const core = new CoreIntegrity({ maxIntegrity: 5 });
    const endpoint = createEndpoint([
        Object.freeze({ accepted: false, reason: 'duplicate-command' })
    ]);
    const noCapabilityRegistry = createRegistry([
        { entityId: 1, incarnation: 1, kindId: 'core-proxy' },
        {
            entityId: 2,
            incarnation: 1,
            kindId: 'enemy',
            metadata: {
                capabilityMask: 0,
                coreImpactDamage: 2,
                bountyBudget: 1
            }
        }
    ]);
    const director = new EnemyCoreImpactDirector({ coreIntegrity: core, endpoint });
    const noCapability = director.observeCompletedEvents(snapshot([
        coreEnter({
            entityId: 1,
            incarnation: 1,
            otherEntityId: 2,
            otherIncarnation: 1,
            sequence: 0
        })
    ]), noCapabilityRegistry);
    assert.equal(noCapability.facts.length, 0);
    assert.equal(core.getCurrentIntegrity(), 5);

    const capableRegistry = createRegistry([
        { entityId: 1, incarnation: 1, kindId: 'core-proxy' },
        {
            entityId: 3,
            incarnation: 1,
            kindId: 'enemy',
            metadata: { coreImpactDamage: 2, bountyBudget: 1 }
        }
    ]);
    director.observeCompletedEvents(snapshot([
        coreEnter({
            entityId: 1,
            incarnation: 1,
            otherEntityId: 3,
            otherIncarnation: 1,
            sequence: 1
        })
    ]), capableRegistry);
    const staged = director.stageForFixedTick({ targetFixedTick: 18, endpoint });
    assert.equal(staged.recoveryRequired, true);
    assert.equal(director.getStatus().cleanupFailure.reason, 'duplicate-command');
});

test('committed current-device forward epoch은 rebind하고 prior epoch callback은 다시 damage하지 않는다', () => {
    const core = new CoreIntegrity({ maxIntegrity: 10 });
    const endpoint = createMutableProtocolEndpoint();
    const registry = createRegistry([
        { entityId: 1, incarnation: 1, kindId: 'core-proxy' },
        {
            entityId: 2,
            incarnation: 1,
            kindId: 'enemy',
            metadata: { coreImpactDamage: 3, bountyBudget: 1 }
        }
    ]);
    const director = new EnemyCoreImpactDirector({ coreIntegrity: core, endpoint });
    const forwardProtocol = Object.freeze({
        ...PROTOCOL,
        authoritativeEpoch: PROTOCOL.authoritativeEpoch + 1
    });
    endpoint.setProtocol(forwardProtocol);
    director.observeCompletedEvents(snapshot([
        coreEnter({
            entityId: 1,
            incarnation: 1,
            otherEntityId: 2,
            otherIncarnation: 1,
            sequence: 0,
            protocol: forwardProtocol
        })
    ]), registry);
    assert.equal(core.getCurrentIntegrity(), 7);
    assert.equal(
        director.getStatus().binding.authoritativeEpoch,
        forwardProtocol.authoritativeEpoch
    );

    director.observeCompletedEvents(snapshot([
        coreEnter({
            entityId: 1,
            incarnation: 1,
            otherEntityId: 2,
            otherIncarnation: 1,
            sequence: 1,
            protocol: PROTOCOL
        })
    ]), registry);
    assert.equal(core.getCurrentIntegrity(), 7);
    assert.equal(endpoint.requests.length, 0);
});

test('production endpoint는 주입되지 않은 Core cleanup capability를 legacy public despawn으로 대체하지 않는다', () => {
    const endpoint = createGpuSimulationEndpoint({
        enemySimulationBackend: createCommittedEventBackend()
    });
    const core = new CoreIntegrity({ maxIntegrity: 1 });
    assert.throws(
        () => new EnemyCoreImpactDirector({ coreIntegrity: core, endpoint }),
        /전용 Core-impact cleanup port/
    );
    endpoint.destroy();
});

test('Director는 일반 same/future despawn과 commandId 선점 경합의 actual owner ID를 commit까지 추적한다', () => {
    const backend = createCommittedEventBackend();
    let cleanupBinding = null;
    const endpoint = createGpuSimulationEndpoint({
        enemySimulationBackend: backend,
        coreImpactCleanupPortReceiver(binding) {
            cleanupBinding = binding;
        }
    });
    assert.equal(endpoint.init({ id: 'core-impact-race-map' }), true);
    const protocol = Object.freeze({
        sessionGeneration: endpoint.getStatus().sessionGeneration,
        deviceGeneration: 8,
        authoritativeEpoch: 3
    });
    backend.setProtocol(protocol);
    assert.equal(endpoint.requestSpawn(
        createGpuCoreProxySpawnIntent({ position: { x: 0, y: 0 } }),
        1,
        'core-impact-race:core'
    ).accepted, true);
    for (let spawnSequence = 0; spawnSequence < 3; spawnSequence++) {
        assert.equal(endpoint.requestSpawn(createGpuEnemySpawnIntent({
            definition: {
                id: `core-impact-race-enemy-${spawnSequence}`,
                shapeType: 'square',
                maxHealth: 1,
                moveSpeedTilesPerSecond: 1,
                collisionRadiusTiles: 0.5,
                collisionWeight: 1,
                coreImpactDamage: 1,
                towerContactDamage: 0,
                bountyBudget: 1,
                colorRgba: [1, 0, 0, 1],
                radiusScale: 1
            },
            route: {
                gateId: 'core-impact-race-gate',
                pathId: 'core-impact-race-path',
                waypoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }]
            },
            spawnSequence,
            policyId: 'corebound'
        }), 1, `core-impact-race:enemy:${spawnSequence}`).accepted, true);
    }
    const setup = endpoint.commitAtFixedBoundary(1).spawned;
    const coreHandle = setup[0].handle;
    const enemies = setup.slice(1).map(({ handle }) => handle);
    assert.equal(endpoint.requestDespawn(
        enemies[0],
        'scripted-cleanup',
        2,
        'core-impact-race:same'
    ).accepted, true);
    assert.equal(endpoint.requestDespawn(
        enemies[1],
        'player-kill',
        5,
        'core-impact-race:future'
    ).accepted, true);
    const collisionImpactKey = [
        protocol.sessionGeneration,
        protocol.deviceGeneration,
        protocol.authoritativeEpoch,
        coreHandle.entityId,
        coreHandle.incarnation,
        enemies[2].entityId,
        enemies[2].incarnation,
        'interaction-enter'
    ].join(':');
    const predictableCommandId = `core-impact:${collisionImpactKey}`;
    assert.equal(endpoint.requestDespawn(
        coreHandle,
        'scripted-preclaim',
        2,
        predictableCommandId
    ).accepted, true);

    const core = new CoreIntegrity({ maxIntegrity: 10 });
    const director = new EnemyCoreImpactDirector({
        coreIntegrity: core,
        endpoint,
        coreImpactCleanupPort: cleanupBinding.port
    });
    director.observeCompletedEvents(snapshot(enemies.map((enemy, sequence) => (
        coreEnter({
            entityId: coreHandle.entityId,
            incarnation: coreHandle.incarnation,
            otherEntityId: enemy.entityId,
            otherIncarnation: enemy.incarnation,
            sequence,
            protocol
        })
    ))), endpoint.getRegistry());
    assert.equal(core.getCurrentIntegrity(), 7);
    const staged = director.stageForFixedTick({ targetFixedTick: 2, endpoint });
    assert.equal(staged.requested, 1);
    assert.equal(staged.cleanupDeduped, 2);
    assert.equal(staged.pendingCleanupCount, 3);

    const committed = endpoint.commitAtFixedBoundary(2);
    const byHandle = new Map(committed.despawned.map((entry) => [
        handleKey(entry.handle),
        entry
    ]));
    assert.equal(byHandle.get(handleKey(enemies[0])).commandId, 'core-impact-race:same');
    assert.equal(byHandle.get(handleKey(enemies[0])).reason, 'scripted-cleanup');
    assert.equal(byHandle.get(handleKey(enemies[1])).commandId, 'core-impact-race:future');
    assert.equal(byHandle.get(handleKey(enemies[1])).reason, 'player-kill');
    const collisionCleanup = byHandle.get(handleKey(enemies[2]));
    assert.notEqual(collisionCleanup.commandId, predictableCommandId);
    assert.match(collisionCleanup.commandId, /^enemy-terminal-cleanup:/u);
    assert.equal(collisionCleanup.disposition, ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT);
    assert.equal(collisionCleanup.bountyEligible, false);
    director.observeFixedCommit(committed, 2);
    assert.equal(director.getStatus().cleanupCommittedCount, 3);
    assert.equal(director.getStatus().trackedCleanupCount, 0);
    assert.equal(director.requiresRecovery(), false);
    endpoint.destroy();
});

test('endpoint가 same-tick GPU death despawn을 먼저 queue해도 Core arrival은 한 번 authoritative하게 적용된다', () => {
    const backend = createCommittedEventBackend();
    let cleanupBinding = null;
    const endpoint = createGpuSimulationEndpoint({
        enemySimulationBackend: backend,
        coreImpactCleanupPortReceiver(binding) {
            cleanupBinding = binding;
        }
    });
    assert.equal(endpoint.init({ id: 'core-impact-fixture-map' }), true);
    const protocol = Object.freeze({
        sessionGeneration: endpoint.getStatus().sessionGeneration,
        deviceGeneration: 5,
        authoritativeEpoch: 2
    });
    backend.setProtocol(protocol);
    const coreReceipt = endpoint.requestSpawn(
        createGpuCoreProxySpawnIntent({ position: { x: 0, y: 0 } }),
        1,
        'core-impact-test:core'
    );
    const enemyReceipt = endpoint.requestSpawn(createGpuEnemySpawnIntent({
        definition: {
            id: 'core-impact-test-enemy',
            shapeType: 'square',
            maxHealth: 1,
            moveSpeedTilesPerSecond: 1,
            collisionRadiusTiles: 0.5,
            collisionWeight: 1,
            coreImpactDamage: 6,
            towerContactDamage: 0,
            bountyBudget: 4,
            colorRgba: [1, 0, 0, 1],
            radiusScale: 1
        },
        route: {
            gateId: 'test-gate',
            pathId: 'test-path',
            waypoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }]
        },
        spawnSequence: 0,
        policyId: 'corebound'
    }), 1, 'core-impact-test:enemy');
    assert.equal(coreReceipt.accepted, true);
    assert.equal(enemyReceipt.accepted, true);
    const setupCommit = endpoint.commitAtFixedBoundary(1);
    const [coreSpawn, enemySpawn] = setupCommit.spawned;
    const coreHandle = coreSpawn.handle;
    const enemyHandle = enemySpawn.handle;
    const registry = endpoint.getRegistry();
    backend.completedEventBatches.push(Object.freeze({
        ...protocol,
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 1,
        submittedTick: 1,
        completedThroughTick: 1,
        events: Object.freeze([
            Object.freeze({
                type: 'contact',
                eventType: 'interaction-enter',
                sequence: 0,
                entityId: coreHandle.entityId,
                incarnation: coreHandle.incarnation,
                otherEntityId: enemyHandle.entityId,
                otherIncarnation: enemyHandle.incarnation,
                valueFixedPoint: 0
            }),
            Object.freeze({
                type: 'death',
                sequence: 1,
                entityId: enemyHandle.entityId,
                incarnation: enemyHandle.incarnation,
                flags: 1,
                reason: 'health-depleted'
            })
        ])
    }));
    const core = new CoreIntegrity({ maxIntegrity: 10 });
    const director = new EnemyCoreImpactDirector({
        coreIntegrity: core,
        endpoint,
        coreImpactCleanupPort: cleanupBinding.port
    });

    const committed = endpoint.commitCompletedEventsAtFixedBoundary(2);
    assert.equal(committed.contactEvents[0].disposition, 'applied');
    assert.equal(committed.deathEvents[0].disposition, 'despawn-requested');
    const observed = director.observeCompletedEvents(committed, registry);
    assert.equal(observed.facts.filter(({ type }) => type === 'CoreImpact').length, 1);
    assert.equal(core.getCurrentIntegrity(), 4);
    const staged = director.stageForFixedTick({ targetFixedTick: 2, endpoint });
    assert.equal(staged.requested, 0);
    assert.equal(staged.cleanupDeduped, 1);
    assert.equal(director.requiresRecovery(), false);

    const lifecycle = endpoint.commitAtFixedBoundary(2);
    assert.equal(lifecycle.despawned.length, 1);
    assert.equal(lifecycle.despawned[0].reason, 'gpu-death');
    assert.equal(
        lifecycle.despawned[0].commandId,
        `gpu-death:${committed.deathEvents[0].key}`
    );
    assert.equal(
        lifecycle.despawned[0].disposition,
        ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
    );
    assert.equal(lifecycle.despawned[0].bountyEligible, false);
    assert.equal(registry.has(enemyHandle), false);
    director.observeFixedCommit(lifecycle, 2);
    assert.equal(director.getStatus().trackedCleanupCount, 0);
    endpoint.destroy();
});

test('CORE_IMPACT disposition은 exact lifecycle despawn 결과에 no-bounty policy로 보존된다', () => {
    const registry = new WorldRegistry({ capacity: 4 });
    const handle = registry.reserveEntity({
        kindId: 'enemy',
        definitionId: 'basic_square_01',
        createdAtTick: 1
    });
    assert.equal(registry.activateReserved(handle, null), true);
    const active = new Set([handleKey(handle)]);
    const backend = {
        hasBody: (candidate) => active.has(handleKey(candidate)),
        requiresRecovery: () => false,
        getRuntimeState: () => 'gpu-ready',
        spawnBodies: () => Object.freeze({ accepted: 0, rejected: 0 }),
        despawnBodies(handles) {
            for (const candidate of handles) {
                active.delete(handleKey(candidate));
            }
            return Object.freeze({ removed: handles.length, rejected: 0 });
        }
    };
    const owner = new EnemyLifecycleCommandOwner(backend, registry);
    const receipt = owner.requestDespawn(
        handle,
        'core-impact',
        2,
        'core-impact:fixture',
        Object.freeze({ disposition: ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT })
    );
    assert.equal(receipt.accepted, true);
    const result = owner.commitAtFixedBoundary(2);
    assert.equal(result.despawned.length, 1);
    assert.equal(
        result.despawned[0].disposition,
        ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
    );
    assert.equal(result.despawned[0].bountyEligible, false);
    assert.equal(
        isEnemyDispositionBountyEligible(
            ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
        ),
        false
    );
});
