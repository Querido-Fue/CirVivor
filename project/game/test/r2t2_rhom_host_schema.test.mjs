import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    BASIC_RHOM_CAPABILITY_IDS,
    BASIC_RHOM_ENEMY_DEFINITION_ID,
    BASIC_RHOM_ENEMY_DEFINITION_SOURCE
} = await loadGameModule('data/object/enemy/basic_rhom_enemy_data.js');
const {
    BASIC_RHOM_ENEMY_DATA
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    BASIC_RHOM_ATTACK_DATA,
    HOSTILE_RANGED_DISTANCE_POLICY_ID,
    HOSTILE_RANGED_TARGET_SELECTION_POLICY_ID
} = await loadGameModule('data/object/enemy/basic_rhom_attack_data.js');
const {
    HOSTILE_ATTACK_RUNTIME_DATA
} = await loadGameModule('data/object/enemy/hostile_attack_runtime_data.js');
const {
    HOSTILE_RHOM_PROJECTILE_DATA
} = await loadGameModule(
    'data/object/projectile/hostile_rhom_projectile_data.js'
);
const {
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');
const {
    createEnemyCapabilityMask
} = await loadGameModule('ingame/contract/enemy_capability_contract.js');
const {
    GPU_PROJECTILE_SPAWN_MODE,
    createGpuSelectedTargetProjectileCommandId,
    createGpuSelectedTargetProjectileIntent,
    requestGpuSelectedTargetProjectile
} = await loadGameModule(
    'ingame/object/projectile/gpu_projectile_spawn_adapter.js'
);
const {
    HostileAttackDirector
} = await loadGameModule('ingame/object/enemy/hostile_attack_director.js');
const {
    GPU_BODY_CONTROL_PROGRAM_RESULT,
    GPU_BODY_CONTROL_SELECTED_TARGET_KIND,
    GPU_BODY_CONTROL_STATE_FLAGS
} = await loadGameModule('ingame/physics/gpu/gpu_fixed_primitive_abi.js');

const CORE_HANDLE = Object.freeze({ entityId: 700, incarnation: 3 });
const SOURCE_HANDLE = Object.freeze({ entityId: 40, incarnation: 2 });
const TOWER_HANDLE = Object.freeze({ entityId: 701, incarnation: 4 });
const PROJECTILE_HANDLE = Object.freeze({ entityId: 702, incarnation: 1 });

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function createSelectedIntent(overrides = {}) {
    return createGpuSelectedTargetProjectileIntent({
        definition: HOSTILE_RHOM_PROJECTILE_DATA,
        sourceHandle: SOURCE_HANDLE,
        ownerHandle: SOURCE_HANDLE,
        coreTargetHandle: CORE_HANDLE,
        towerTargetHandle: null,
        positionOffset: BASIC_RHOM_ATTACK_DATA.positionOffset,
        targetOffset: BASIC_RHOM_ATTACK_DATA.targetOffset,
        launchSpeed: BASIC_RHOM_ATTACK_DATA.launchSpeed,
        attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
        targetSelectionPolicyId:
            BASIC_RHOM_ATTACK_DATA.targetSelectionPolicy,
        distancePolicyId: BASIC_RHOM_ATTACK_DATA.distancePolicy,
        stopWhileTargetInRange: true,
        targetPolicyId: BASIC_RHOM_ATTACK_DATA.targetPolicyId,
        allegiancePolicy: BASIC_RHOM_ATTACK_DATA.allegiancePolicy,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        producerId: BASIC_RHOM_ATTACK_DATA.producerId,
        sourceAbilityId: BASIC_RHOM_ATTACK_DATA.sourceAbilityId,
        spawnSequence: 5,
        ...overrides
    });
}

class ExactRegistryFixture {
    constructor() {
        this.records = new Map();
    }

    add(handle, descriptor) {
        this.records.set(handleKey(handle), Object.freeze({
            ...handle,
            ...descriptor
        }));
    }

    remove(handle) {
        return this.records.delete(handleKey(handle));
    }

    has(handle) {
        return this.records.has(handleKey(handle));
    }

    copyEntityView(handle, out = {}) {
        const view = this.records.get(handleKey(handle));
        if (!view) {
            return null;
        }
        Object.assign(out, view);
        return out;
    }
}

class BackendFixture {
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

    getEventProtocolState() {
        return Object.freeze({
            sessionGeneration: 9,
            deviceGeneration: 4,
            authoritativeEpoch: 2
        });
    }
}

class ProjectileAdapterFixture {
    constructor() {
        this.calls = [];
    }

    requestProjectile(options) {
        this.calls.push(options);
        return Object.freeze({
            accepted: true,
            commandId: options.commandId,
            targetFixedTick: options.targetFixedTick
        });
    }
}

class RejectingProjectileAdapterFixture extends ProjectileAdapterFixture {
    requestProjectile(options) {
        this.calls.push(options);
        return Object.freeze({
            accepted: false,
            commandId: options.commandId,
            reason: 'fixed-program-capacity'
        });
    }
}

class PriorityControlPortFixture {
    constructor() {
        this.calls = [];
    }

    requestPriorityTargetControl(command, targetFixedTick, commandId) {
        this.calls.push({ command, targetFixedTick, commandId });
        return Object.freeze({
            accepted: true,
            commandId,
            targetFixedTick,
            attackFingerprint: 123
        });
    }
}

function emptyFixedCommands(overrides = {}) {
    return Object.freeze({
        state: 'committed',
        completed: Object.freeze([]),
        sourceRelativeSpawns: Object.freeze([]),
        selectedTargetSpawns: Object.freeze([]),
        rejected: Object.freeze([]),
        recoveryRequired: false,
        protocolFailure: null,
        ...overrides
    });
}

function priorityControlResult(call, outcome = 'core', overrides = {}) {
    const isCore = outcome === 'core';
    const isTower = outcome === 'tower';
    const isSourceInvalid = outcome === 'source-invalid';
    const isCoreInvalid = outcome === 'core-invalid';
    return Object.freeze({
        commandId: call.commandId,
        sourceHandle: call.command.sourceHandle,
        coreTargetHandle: call.command.coreTargetHandle,
        towerTargetHandle: call.command.towerTargetHandle,
        targetFixedTick: call.targetFixedTick,
        sourceTick: call.targetFixedTick,
        selectionSequence: call.command.selectionSequence,
        attackFingerprint: 123,
        attackRangeTiles: call.command.attackRangeTiles,
        attackDefinitionId: call.command.attackDefinitionId,
        projectileDefinitionId: call.command.projectileDefinitionId,
        producerId: call.command.producerId,
        sourceAbilityId: call.command.sourceAbilityId,
        result: isCore
            ? GPU_BODY_CONTROL_PROGRAM_RESULT.CORE_SELECTED
            : isTower
                ? GPU_BODY_CONTROL_PROGRAM_RESULT.TOWER_SELECTED
                : isSourceInvalid
                    ? GPU_BODY_CONTROL_PROGRAM_RESULT.SOURCE_INVALID
                    : isCoreInvalid
                        ? GPU_BODY_CONTROL_PROGRAM_RESULT.CORE_INVALID
                        : GPU_BODY_CONTROL_PROGRAM_RESULT.NO_TARGET,
        outcome,
        selectedTargetKind: isCore
            ? GPU_BODY_CONTROL_SELECTED_TARGET_KIND.CORE
            : isTower
                ? GPU_BODY_CONTROL_SELECTED_TARGET_KIND.TOWER
                : GPU_BODY_CONTROL_SELECTED_TARGET_KIND.NONE,
        stateFlags: isCore
            ? GPU_BODY_CONTROL_STATE_FLAGS.STOP
                | GPU_BODY_CONTROL_STATE_FLAGS.CORE_SELECTED
            : isTower
                ? GPU_BODY_CONTROL_STATE_FLAGS.STOP
                    | GPU_BODY_CONTROL_STATE_FLAGS.TOWER_SELECTED
                : isSourceInvalid || isCoreInvalid
                    ? 0
                    : GPU_BODY_CONTROL_STATE_FLAGS.ROUTE_FLOW,
        selectedTargetHandle: isCore
            ? call.command.coreTargetHandle
            : isTower
                ? call.command.towerTargetHandle
                : null,
        ...overrides
    });
}

function createDirectorFixture(options = {}) {
    const registry = new ExactRegistryFixture();
    const backend = new BackendFixture();
    const adapter = new ProjectileAdapterFixture();
    const priorityControlPort = new PriorityControlPortFixture();
    const director = new HostileAttackDirector({
        registry,
        backend,
        projectileSpawnAdapter: adapter,
        priorityTargetControlPort: priorityControlPort,
        sessionGeneration: 9,
        ...options
    });
    return { registry, backend, adapter, priorityControlPort, director };
}

function addExact(fixture, handle, descriptor) {
    fixture.registry.add(handle, descriptor);
    fixture.backend.add(handle);
}

function registerRhom(fixture, handle = SOURCE_HANDLE, metadataOverrides = {}) {
    addExact(fixture, handle, {
        kindId: 'enemy',
        definitionId: BASIC_RHOM_ENEMY_DEFINITION_ID,
        createdAtTick: 1,
        metadata: Object.freeze({
            definitionId: BASIC_RHOM_ENEMY_DATA.id,
            enemyDefinitionId: BASIC_RHOM_ENEMY_DATA.id,
            teamId: GAMEPLAY_TEAM_ID.HOSTILE,
            capabilityMask: createEnemyCapabilityMask(BASIC_RHOM_CAPABILITY_IDS),
            physicsProfileId: BASIC_RHOM_ENEMY_DATA.physicsProfileId,
            combatProfileId: BASIC_RHOM_ENEMY_DATA.combatProfileId,
            behaviorProfileId: BASIC_RHOM_ENEMY_DATA.behaviorProfileId,
            ...metadataOverrides
        })
    });
    fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: 1,
        spawned: Object.freeze([Object.freeze({
            commandId: 'spawn:rhom',
            handle
        })]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands()
    }), 1);
}

test('M authored data와 selected-target host descriptor는 exact Core와 inclusive range를 고정한다', () => {
    assert.equal(BASIC_RHOM_ENEMY_DEFINITION_SOURCE.id, 'basic_rhom_01');
    assert.equal(BASIC_RHOM_ENEMY_DEFINITION_SOURCE.shapeDefinitionId, 'rhom');
    assert.equal(BASIC_RHOM_ATTACK_DATA.attackRangeTiles, 8);
    assert.equal(
        BASIC_RHOM_ATTACK_DATA.distancePolicy,
        HOSTILE_RANGED_DISTANCE_POLICY_ID.TICK_START_CENTER_INCLUSIVE
    );
    assert.equal(
        BASIC_RHOM_ATTACK_DATA.targetSelectionPolicy,
        HOSTILE_RANGED_TARGET_SELECTION_POLICY_ID
            .CORE_FIRST_IN_RANGE_THEN_TOWER
    );
    assert.equal(
        HOSTILE_ATTACK_RUNTIME_DATA.MAXIMUM_STARTS_PER_FIXED_TICK,
        4
    );
    assert.equal(
        HOSTILE_ATTACK_RUNTIME_DATA.PRIORITY_CONTROL_REFRESH_INTERVAL_TICKS,
        30
    );
    assert.equal(
        HOSTILE_ATTACK_RUNTIME_DATA
            .MAXIMUM_PRIORITY_CONTROL_REFRESHES_PER_FIXED_TICK,
        64
    );
    assert.ok(Object.isFrozen(BASIC_RHOM_ENEMY_DEFINITION_SOURCE));
    assert.ok(Object.isFrozen(BASIC_RHOM_ATTACK_DATA));
    assert.ok(Object.isFrozen(HOSTILE_RHOM_PROJECTILE_DATA));

    const intent = createSelectedIntent();
    assert.equal(
        intent.mode,
        GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_SELECTED_TARGET
    );
    assert.deepEqual({ ...intent.coreTargetHandle }, { ...CORE_HANDLE });
    assert.equal(intent.towerTargetHandle, null);
    assert.equal(intent.stopWhileTargetInRange, true);
    assert.equal(intent.attackRangeTiles, BASIC_RHOM_ATTACK_DATA.attackRangeTiles);
    assert.equal(
        intent.destinationSpawn.coreTargetEntityId,
        CORE_HANDLE.entityId
    );
    assert.equal(
        intent.destinationSpawn.coreDamageFixedPoint,
        500
    );
    assert.throws(
        () => createSelectedIntent({ stopWhileTargetInRange: false }),
        /in-range/
    );

    const commandId = createGpuSelectedTargetProjectileCommandId({
        sourceHandle: SOURCE_HANDLE,
        coreTargetHandle: CORE_HANDLE,
        towerTargetHandle: null,
        targetFixedTick: 31,
        spawnSequence: 5,
        definitionId: HOSTILE_RHOM_PROJECTILE_DATA.id
    });
    const unavailable = requestGpuSelectedTargetProjectile({
        endpoint: Object.freeze({}),
        ...createSelectedIntent(),
        definition: HOSTILE_RHOM_PROJECTILE_DATA,
        targetFixedTick: 31,
        spawnSequence: 5,
        commandId
    });
    assert.equal(unavailable.accepted, false);
    assert.equal(
        unavailable.reason,
        'selected-target-fixed-primitive-unavailable'
    );

    const requested = [];
    const endpoint = new class SelectedTargetEndpointFixture {
        requestSelectedTargetSpawn(intent, targetFixedTick, requestedCommandId) {
            requested.push({ intent, targetFixedTick, requestedCommandId });
            return Object.freeze({
                accepted: true,
                commandId: requestedCommandId,
                targetFixedTick
            });
        }
    }();
    const accepted = requestGpuSelectedTargetProjectile({
        endpoint,
        ...createSelectedIntent(),
        definition: HOSTILE_RHOM_PROJECTILE_DATA,
        targetFixedTick: 31,
        spawnSequence: 5,
        commandId
    });
    assert.equal(accepted.accepted, true);
    assert.equal(requested.length, 1);
    assert.equal(requested[0].targetFixedTick, 31);
    assert.equal(requested[0].requestedCommandId, commandId);
    assert.equal('endpoint' in requested[0].intent, false);
});

test('M priority control은 GPU 상태를 유지하며 refresh ingress를 fixed tick당 64개로 제한한다', () => {
    const fixture = createDirectorFixture();
    const handles = Array.from({ length: 160 }, (_, index) => Object.freeze({
        entityId: 1_000 + index,
        incarnation: 1
    }));
    for (const handle of handles) {
        registerRhom(fixture, handle);
    }
    addExact(fixture, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy'
    });
    addExact(fixture, TOWER_HANDLE, {
        kindId: 'tower',
        definitionId: 'the-tower'
    });

    const drainControls = (tick, staged) => {
        const callsById = new Map(
            fixture.priorityControlPort.calls.map((call) => [call.commandId, call])
        );
        const results = staged.controlCommandIds.map((commandId) => (
            priorityControlResult(callsById.get(commandId), 'no-target')
        ));
        fixture.director.observeFixedCommit(Object.freeze({
            fixedTick: tick,
            spawned: Object.freeze([]),
            despawned: Object.freeze([]),
            fixedCommands: emptyFixedCommands({
                priorityTargetControlResults: Object.freeze(results),
                priorityTargetControlCompletedThroughTick: tick
            })
        }), tick);
        assert.equal(fixture.director.requiresRecovery(), false);
    };

    const first = fixture.director.stageForFixedTick({
        targetFixedTick: 2,
        coreTargetHandle: CORE_HANDLE,
        towerTargetHandle: TOWER_HANDLE
    });
    assert.equal(first.eligibleCount, 0);
    assert.equal(first.controlAcceptedCount, 64);
    drainControls(2, first);

    const second = fixture.director.stageForFixedTick({
        targetFixedTick: 3,
        coreTargetHandle: CORE_HANDLE,
        towerTargetHandle: TOWER_HANDLE
    });
    assert.equal(second.controlAcceptedCount, 64);
    drainControls(3, second);

    const third = fixture.director.stageForFixedTick({
        targetFixedTick: 4,
        coreTargetHandle: CORE_HANDLE,
        towerTargetHandle: TOWER_HANDLE
    });
    assert.equal(third.controlAcceptedCount, 32);
    drainControls(4, third);

    const settled = fixture.director.stageForFixedTick({
        targetFixedTick: 5,
        coreTargetHandle: CORE_HANDLE,
        towerTargetHandle: TOWER_HANDLE
    });
    assert.equal(settled.controlAcceptedCount, 0);
    assert.equal(settled.recoveryRequired, false);
    assert.equal(fixture.priorityControlPort.calls.length, 160);
});

test('M selected shot 후보는 refresh budget이 포화되어도 같은 tick priority control을 먼저 받는다', () => {
    const fixture = createDirectorFixture({
        maximumStartsPerFixedTick: 2,
        maximumPriorityControlRefreshesPerFixedTick: 1
    });
    const handles = Array.from({ length: 6 }, (_, index) => Object.freeze({
        entityId: 2_000 + index,
        incarnation: 1
    }));
    for (const handle of handles) {
        registerRhom(fixture, handle);
    }
    addExact(fixture, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy'
    });
    addExact(fixture, TOWER_HANDLE, {
        kindId: 'tower',
        definitionId: 'the-tower'
    });

    const tick = fixture.director.getStatus().sources[0]
        .nextEligibleFixedTick;
    const staged = fixture.director.stageForFixedTick({
        targetFixedTick: tick,
        coreTargetHandle: CORE_HANDLE,
        towerTargetHandle: TOWER_HANDLE
    });
    assert.equal(staged.attemptedCount, 2);
    assert.equal(staged.controlAcceptedCount, 3);
    const controlledSourceKeys = new Set(
        fixture.priorityControlPort.calls.map((call) => (
            handleKey(call.command.sourceHandle)
        ))
    );
    for (const shot of fixture.adapter.calls) {
        assert.equal(
            controlledSourceKeys.has(handleKey(shot.sourceHandle)),
            true
        );
    }
});

test('accepted no-target attempt도 fairness cursor를 전진시켜 다음 M source starvation을 막는다', () => {
    const fixture = createDirectorFixture({ maximumStartsPerFixedTick: 1 });
    const secondSource = Object.freeze({ entityId: 41, incarnation: 1 });
    registerRhom(fixture, SOURCE_HANDLE);
    registerRhom(fixture, secondSource);
    addExact(fixture, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    const firstEligibleTick = Math.max(
        ...fixture.director.getStatus().sources.map(
            ({ nextEligibleFixedTick }) => nextEligibleFixedTick
        )
    );
    const first = fixture.director.stageForFixedTick({
        targetFixedTick: firstEligibleTick,
        coreTargetHandle: CORE_HANDLE
    });
    assert.equal(first.acceptedCount, 1);
    const firstCall = fixture.adapter.calls.at(-1);
    const destinationHandle = Object.freeze({ entityId: 920, incarnation: 1 });
    fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: firstEligibleTick,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            selectedTargetSpawns: Object.freeze([Object.freeze({
                commandId: firstCall.commandId,
                handle: destinationHandle,
                state: 'gpu-resolve-pending'
            })])
        })
    }), firstEligibleTick);
    fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: firstEligibleTick + 1,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            completed: Object.freeze([Object.freeze({
                commandId: firstCall.commandId,
                handle: destinationHandle,
                outcome: 'no-target'
            })])
        })
    }), firstEligibleTick + 1);
    const second = fixture.director.stageForFixedTick({
        targetFixedTick: firstEligibleTick + 1,
        coreTargetHandle: CORE_HANDLE
    });
    assert.equal(second.acceptedCount, 1);
    assert.notDeepEqual(
        fixture.adapter.calls.at(-1).sourceHandle,
        firstCall.sourceHandle
    );
});

test('HostileAttackDirector는 M source를 canonical 집계하고 no-target에 sequence/cooldown을 소비하지 않는다', () => {
    const fixture = createDirectorFixture();
    registerRhom(fixture);
    addExact(fixture, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    const initial = fixture.director.getStatus();
    assert.equal(initial.activeSourceCount, 1);
    assert.equal(initial.activeArcherCount, 0);
    assert.equal(initial.sources.length, 1);
    assert.equal(initial.archers.length, 0);
    assert.equal(
        initial.maximumStartsPerFixedTick,
        HOSTILE_ATTACK_RUNTIME_DATA.MAXIMUM_STARTS_PER_FIXED_TICK
    );
    const eligibleTick = initial.sources[0].nextEligibleFixedTick;
    const staged = fixture.director.stageForFixedTick({
        targetFixedTick: eligibleTick,
        coreTargetHandle: CORE_HANDLE,
        // Invalid Tower exact identity는 absent이며 Core 계약을 오염시키지 않습니다.
        towerTargetHandle: Object.freeze({ entityId: 0, incarnation: 1 })
    });
    assert.equal(staged.acceptedCount, 1);
    assert.equal(staged.controlAcceptedCount, 1);
    assert.equal(staged.recoveryRequired, false);
    assert.equal(fixture.adapter.calls.length, 1);
    assert.equal(
        fixture.adapter.calls[0].mode,
        GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_SELECTED_TARGET
    );
    assert.equal(fixture.adapter.calls[0].towerTargetHandle, null);
    assert.equal(fixture.priorityControlPort.calls.length, 1);
    assert.deepEqual(
        { ...fixture.priorityControlPort.calls[0].command.coreTargetHandle },
        { ...CORE_HANDLE }
    );

    const commandId = fixture.adapter.calls[0].commandId;
    const destinationHandle = Object.freeze({ entityId: 901, incarnation: 1 });
    fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: eligibleTick,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            selectedTargetSpawns: Object.freeze([Object.freeze({
                commandId,
                handle: destinationHandle,
                state: 'gpu-resolve-pending'
            })])
        })
    }), eligibleTick);
    fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: eligibleTick + 1,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            completed: Object.freeze([Object.freeze({
                commandId,
                handle: destinationHandle,
                outcome: 'no-target'
            })])
        })
    }), eligibleTick + 1);
    const afterNoTarget = fixture.director.getStatus().sources[0];
    assert.equal(afterNoTarget.shotSequence, 0);
    assert.equal(afterNoTarget.nextEligibleFixedTick, eligibleTick);
    assert.equal(afterNoTarget.pendingCommandId, null);

    const retried = fixture.director.stageForFixedTick({
        targetFixedTick: eligibleTick + 1,
        coreTargetHandle: CORE_HANDLE
    });
    assert.equal(retried.acceptedCount, 1);
    assert.equal(retried.controlAcceptedCount, 1);
});

test('M source의 Core exact target 누락은 fail-closed recovery이다', () => {
    const fixture = createDirectorFixture();
    registerRhom(fixture);
    const eligibleTick = fixture.director.getStatus()
        .sources[0].nextEligibleFixedTick;
    const result = fixture.director.stageForFixedTick({
        targetFixedTick: eligibleTick
    });
    assert.equal(result.acceptedCount, 0);
    assert.equal(result.recoveryRequired, true);
    assert.equal(
        result.protocolFailure.code,
        'core-target-handle-contract'
    );
});

test('M runtime source metadata는 capability/team/profile canonical equality를 요구한다', () => {
    const fixture = createDirectorFixture();
    registerRhom(fixture, SOURCE_HANDLE, {
        teamId: GAMEPLAY_TEAM_ID.PLAYER
    });
    const status = fixture.director.getStatus();
    assert.equal(status.activeSourceCount, 0);
    assert.equal(status.recoveryRequired, true);
    assert.equal(
        status.protocolFailure.code,
        'spawn-source-metadata-contract'
    );
});

test('priority control accepted command는 next completion family의 exact core 결과로만 완료된다', () => {
    const fixture = createDirectorFixture();
    registerRhom(fixture);
    addExact(fixture, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    const tick = fixture.director.getStatus().sources[0].nextEligibleFixedTick;
    const staged = fixture.director.stageForFixedTick({
        targetFixedTick: tick,
        coreTargetHandle: CORE_HANDLE
    });
    assert.equal(staged.controlAcceptedCount, 1);
    assert.equal(fixture.director.getStatus().pendingControlCount, 1);
    const shot = fixture.adapter.calls.at(-1);
    const destination = Object.freeze({ entityId: 930, incarnation: 1 });
    const observed = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            priorityTargetControlResults: Object.freeze([
                priorityControlResult(fixture.priorityControlPort.calls.at(-1))
            ]),
            priorityTargetControlCompletedThroughTick: tick,
            selectedTargetSpawns: Object.freeze([Object.freeze({
                commandId: shot.commandId,
                handle: destination,
                state: 'gpu-resolve-pending'
            })])
        })
    }), tick);
    assert.equal(observed.controlCompletedCount, 1);
    assert.equal(observed.recoveryRequired, false);
    assert.equal(fixture.director.getStatus().pendingControlCount, 0);
});

test('priority control completed-through의 missing 또는 fingerprint mismatch는 recovery이다', () => {
    const createStaged = () => {
        const fixture = createDirectorFixture();
        registerRhom(fixture);
        addExact(fixture, CORE_HANDLE, {
            kindId: 'core-proxy',
            definitionId: 'the-core-interaction-proxy',
            createdAtTick: 1,
            metadata: null
        });
        const tick = fixture.director.getStatus()
            .sources[0].nextEligibleFixedTick;
        fixture.director.stageForFixedTick({
            targetFixedTick: tick,
            coreTargetHandle: CORE_HANDLE
        });
        const shot = fixture.adapter.calls.at(-1);
        return { fixture, tick, shot };
    };
    const missing = createStaged();
    missing.fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: missing.tick,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            priorityTargetControlResults: Object.freeze([]),
            priorityTargetControlCompletedThroughTick: missing.tick,
            selectedTargetSpawns: Object.freeze([Object.freeze({
                commandId: missing.shot.commandId,
                handle: Object.freeze({ entityId: 931, incarnation: 1 }),
                state: 'gpu-resolve-pending'
            })])
        })
    }), missing.tick);
    assert.equal(
        missing.fixture.director.getStatus().protocolFailure.code,
        'missing-control-result'
    );

    const mismatch = createStaged();
    const call = mismatch.fixture.priorityControlPort.calls.at(-1);
    mismatch.fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: mismatch.tick,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            priorityTargetControlResults: Object.freeze([
                priorityControlResult(call, 'core', {
                    attackFingerprint: 124
                })
            ]),
            priorityTargetControlCompletedThroughTick: mismatch.tick
        })
    }), mismatch.tick);
    assert.equal(
        mismatch.fixture.director.getStatus().protocolFailure.code,
        'control-result-provenance-contract'
    );
});

test('terminal ingress cancel은 unresolved control과 shot을 recovery 없이 bounded 폐기한다', () => {
    const fixture = createDirectorFixture();
    registerRhom(fixture);
    addExact(fixture, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    const tick = fixture.director.getStatus().sources[0].nextEligibleFixedTick;
    fixture.director.stageForFixedTick({
        targetFixedTick: tick,
        coreTargetHandle: CORE_HANDLE
    });
    const observed = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            ingressOpen: false,
            ingressCloseReason: 'core-depleted',
            priorityTargetControlResults: Object.freeze([]),
            priorityTargetControlCompletedThroughTick: 0
        })
    }), tick);
    assert.equal(observed.recoveryRequired, false);
    const status = fixture.director.getStatus();
    assert.equal(status.pendingControlCount, 0);
    assert.equal(status.pendingShotCount, 0);
    assert.equal(status.telemetry.controlTerminalCancelled, 1);
    assert.equal(status.telemetry.shotTerminalCancelled, 1);
});

test('committed exact GPU death 뒤 M control/selected shot source-invalid는 bounded terminal-cancel이다', () => {
    const fixture = createDirectorFixture({ historyCapacity: 4 });
    registerRhom(fixture);
    addExact(fixture, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    const tick = fixture.director.getStatus().sources[0].nextEligibleFixedTick;
    fixture.director.stageForFixedTick({
        targetFixedTick: tick,
        coreTargetHandle: CORE_HANDLE
    });
    const controlCall = fixture.priorityControlPort.calls.at(-1);
    const shotCall = fixture.adapter.calls.at(-1);
    const destination = Object.freeze({ entityId: 940, incarnation: 1 });
    const accepted = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            selectedTargetSpawns: Object.freeze([Object.freeze({
                commandId: shotCall.commandId,
                handle: destination,
                state: 'gpu-resolve-pending'
            })])
        })
    }), tick);
    assert.equal(accepted.recoveryRequired, false);

    const death = fixture.director.observeCompletedEvents(Object.freeze({
        protocolFailure: null,
        deathEvents: Object.freeze([Object.freeze({
            type: 'death',
            eventType: 'death',
            disposition: 'despawn-requested',
            sessionGeneration: 9,
            deviceGeneration: 4,
            authoritativeEpoch: 2,
            sourceTick: tick,
            sequence: 0,
            ...SOURCE_HANDLE
        })])
    }));
    assert.equal(death.removedSourceCount, 1);
    fixture.registry.remove(SOURCE_HANDLE);
    fixture.backend.remove(SOURCE_HANDLE);

    const observed = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick + 1,
        spawned: Object.freeze([]),
        despawned: Object.freeze([Object.freeze({
            commandId: 'gpu-death:fixture:rhom',
            handle: SOURCE_HANDLE,
            reason: 'gpu-death'
        })]),
        fixedCommands: emptyFixedCommands({
            priorityTargetControlResults: Object.freeze([
                priorityControlResult(controlCall, 'source-invalid')
            ]),
            priorityTargetControlCompletedThroughTick: tick,
            completed: Object.freeze([Object.freeze({
                commandId: shotCall.commandId,
                handle: destination,
                outcome: 'source-invalid'
            })])
        })
    }), tick + 1);
    assert.equal(observed.recoveryRequired, false);
    const status = fixture.director.getStatus();
    assert.equal(status.activeSourceCount, 0);
    assert.equal(status.pendingControlCount, 0);
    assert.equal(status.pendingShotCount, 0);
    assert.equal(status.committedGpuDeathCount, 1);
    assert.equal(status.committedGpuDeathCapacity, 4);
    assert.equal(status.telemetry.sourceTerminalCancelledControls, 1);
    assert.equal(status.telemetry.sourceTerminalCancelledShots, 1);
});

test('M completed-death protocol read mismatch는 record를 보존하고 canonical lifecycle proof로 late result를 종결한다', () => {
    const fixture = createDirectorFixture({ historyCapacity: 4 });
    registerRhom(fixture);
    addExact(fixture, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    const tick = fixture.director.getStatus().sources[0].nextEligibleFixedTick;
    fixture.director.stageForFixedTick({
        targetFixedTick: tick,
        coreTargetHandle: CORE_HANDLE
    });
    const controlCall = fixture.priorityControlPort.calls.at(-1);
    const shotCall = fixture.adapter.calls.at(-1);
    const destination = Object.freeze({ entityId: 943, incarnation: 1 });
    const accepted = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            selectedTargetSpawns: Object.freeze([Object.freeze({
                commandId: shotCall.commandId,
                handle: destination,
                state: 'gpu-resolve-pending'
            })])
        })
    }), tick);
    assert.equal(accepted.recoveryRequired, false);
    const sourceBeforeDeath = fixture.director.getStatus().sources[0];

    fixture.backend.getEventProtocolState = () => Object.freeze({
        sessionGeneration: 9,
        deviceGeneration: 5,
        authoritativeEpoch: 2
    });
    const death = fixture.director.observeCompletedEvents(Object.freeze({
        protocolFailure: null,
        deathEvents: Object.freeze([Object.freeze({
            type: 'death',
            eventType: 'death',
            disposition: 'despawn-requested',
            sessionGeneration: 9,
            deviceGeneration: 4,
            authoritativeEpoch: 2,
            sourceTick: tick,
            sequence: 0,
            ...SOURCE_HANDLE
        })])
    }));
    assert.equal(death.recoveryRequired, false);
    assert.equal(death.removedSourceCount, 0);
    assert.deepEqual(
        fixture.director.getStatus().sources[0],
        sourceBeforeDeath
    );
    assert.equal(fixture.director.getStatus().pendingControlCount, 1);
    assert.equal(fixture.director.getStatus().pendingShotCount, 1);
    assert.equal(fixture.director.getStatus().committedGpuDeathCount, 0);

    fixture.registry.remove(SOURCE_HANDLE);
    fixture.backend.remove(SOURCE_HANDLE);
    const lifecycle = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick + 1,
        spawned: Object.freeze([]),
        despawned: Object.freeze([Object.freeze({
            commandId: 'gpu-death:fixture:protocol-read-mismatch',
            handle: SOURCE_HANDLE,
            reason: 'gpu-death'
        })]),
        fixedCommands: emptyFixedCommands()
    }), tick + 1);
    assert.equal(lifecycle.recoveryRequired, false);
    assert.equal(lifecycle.removedSourceCount, 1);
    assert.equal(fixture.director.getStatus().activeSourceCount, 0);
    assert.equal(
        fixture.director.getStatus().committedLifecycleDespawnCount,
        1
    );

    const delayedBoundary = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick + 2,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands()
    }), tick + 2);
    assert.equal(delayedBoundary.recoveryRequired, false);
    const completed = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick + 3,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            priorityTargetControlResults: Object.freeze([
                priorityControlResult(controlCall, 'source-invalid')
            ]),
            priorityTargetControlCompletedThroughTick: tick,
            completed: Object.freeze([Object.freeze({
                commandId: shotCall.commandId,
                handle: destination,
                outcome: 'source-invalid'
            })])
        })
    }), tick + 3);
    assert.equal(completed.recoveryRequired, false);
    const status = fixture.director.getStatus();
    assert.equal(status.pendingControlCount, 0);
    assert.equal(status.pendingShotCount, 0);
    assert.equal(status.telemetry.sourceTerminalCancelledControls, 1);
    assert.equal(status.telemetry.sourceTerminalCancelledShots, 1);
});

test('증거 없는 M completed-death는 상태를 전진시키지 않고 late source-invalid/ABA를 fail-close한다', () => {
    const createPendingFixture = (destinationEntityId) => {
        const fixture = createDirectorFixture({ historyCapacity: 4 });
        registerRhom(fixture);
        addExact(fixture, CORE_HANDLE, {
            kindId: 'core-proxy',
            definitionId: 'the-core-interaction-proxy',
            createdAtTick: 1,
            metadata: null
        });
        const tick = fixture.director.getStatus().sources[0]
            .nextEligibleFixedTick;
        fixture.director.stageForFixedTick({
            targetFixedTick: tick,
            coreTargetHandle: CORE_HANDLE
        });
        const controlCall = fixture.priorityControlPort.calls.at(-1);
        const shotCall = fixture.adapter.calls.at(-1);
        const destination = Object.freeze({
            entityId: destinationEntityId,
            incarnation: 1
        });
        fixture.director.observeFixedCommit(Object.freeze({
            fixedTick: tick,
            spawned: Object.freeze([]),
            despawned: Object.freeze([]),
            fixedCommands: emptyFixedCommands({
                selectedTargetSpawns: Object.freeze([Object.freeze({
                    commandId: shotCall.commandId,
                    handle: destination,
                    state: 'gpu-resolve-pending'
                })])
            })
        }), tick);
        return { fixture, tick, controlCall, shotCall, destination };
    };
    const observeForgedDeath = ({ fixture, tick }) => {
        const sourceBeforeDeath = fixture.director.getStatus().sources[0];
        const observed = fixture.director.observeCompletedEvents(Object.freeze({
            protocolFailure: null,
            deathEvents: Object.freeze([Object.freeze({
                type: 'death',
                eventType: 'death',
                disposition: 'despawn-requested',
                sessionGeneration: 9,
                deviceGeneration: 4,
                authoritativeEpoch: 999,
                sourceTick: tick,
                sequence: 0,
                ...SOURCE_HANDLE
            })])
        }));
        assert.equal(observed.recoveryRequired, false);
        assert.equal(observed.removedSourceCount, 0);
        assert.deepEqual(
            fixture.director.getStatus().sources[0],
            sourceBeforeDeath
        );
        assert.equal(fixture.director.getStatus().committedGpuDeathCount, 0);
    };

    const noLifecycle = createPendingFixture(944);
    observeForgedDeath(noLifecycle);
    noLifecycle.fixture.registry.remove(SOURCE_HANDLE);
    noLifecycle.fixture.backend.remove(SOURCE_HANDLE);
    const missingProof = noLifecycle.fixture.director.observeFixedCommit(
        Object.freeze({
            fixedTick: noLifecycle.tick + 1,
            spawned: Object.freeze([]),
            despawned: Object.freeze([]),
            fixedCommands: emptyFixedCommands({
                priorityTargetControlResults: Object.freeze([
                    priorityControlResult(
                        noLifecycle.controlCall,
                        'source-invalid'
                    )
                ]),
                priorityTargetControlCompletedThroughTick: noLifecycle.tick
            })
        }),
        noLifecycle.tick + 1
    );
    assert.equal(missingProof.recoveryRequired, true);
    assert.equal(
        missingProof.protocolFailure.code,
        'source-terminal-proof-missing'
    );

    const aba = createPendingFixture(945);
    aba.fixture.backend.getEventProtocolState = () => Object.freeze({
        sessionGeneration: 9,
        deviceGeneration: 5,
        authoritativeEpoch: 2
    });
    observeForgedDeath(aba);
    aba.fixture.registry.remove(SOURCE_HANDLE);
    aba.fixture.backend.remove(SOURCE_HANDLE);
    const lifecycle = aba.fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: aba.tick + 1,
        spawned: Object.freeze([]),
        despawned: Object.freeze([Object.freeze({
            commandId: 'gpu-death:fixture:protocol-read-mismatch-aba',
            handle: SOURCE_HANDLE,
            reason: 'gpu-death'
        })]),
        fixedCommands: emptyFixedCommands()
    }), aba.tick + 1);
    assert.equal(lifecycle.recoveryRequired, false);
    addExact(aba.fixture, SOURCE_HANDLE, {
        kindId: 'enemy',
        definitionId: BASIC_RHOM_ENEMY_DEFINITION_ID,
        createdAtTick: aba.tick + 1,
        metadata: Object.freeze({
            definitionId: BASIC_RHOM_ENEMY_DATA.id,
            enemyDefinitionId: BASIC_RHOM_ENEMY_DATA.id,
            teamId: GAMEPLAY_TEAM_ID.HOSTILE,
            capabilityMask: createEnemyCapabilityMask(BASIC_RHOM_CAPABILITY_IDS),
            physicsProfileId: BASIC_RHOM_ENEMY_DATA.physicsProfileId,
            combatProfileId: BASIC_RHOM_ENEMY_DATA.combatProfileId,
            behaviorProfileId: BASIC_RHOM_ENEMY_DATA.behaviorProfileId
        })
    });
    const reactivated = aba.fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: aba.tick + 2,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            priorityTargetControlResults: Object.freeze([
                priorityControlResult(aba.controlCall, 'source-invalid')
            ]),
            priorityTargetControlCompletedThroughTick: aba.tick
        })
    }), aba.tick + 2);
    assert.equal(reactivated.recoveryRequired, true);
    assert.equal(
        reactivated.protocolFailure.code,
        'source-terminal-liveness-contract'
    );
});

test('resolved M Tower projectile 뒤 source lifecycle death는 projectile을 cascade-cancel하지 않는다', () => {
    const fixture = createDirectorFixture();
    registerRhom(fixture);
    addExact(fixture, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    addExact(fixture, TOWER_HANDLE, {
        kindId: 'tower',
        definitionId: 'the-tower',
        createdAtTick: 1,
        metadata: null
    });
    const tick = fixture.director.getStatus().sources[0].nextEligibleFixedTick;
    const staged = fixture.director.stageForFixedTick({
        targetFixedTick: tick,
        coreTargetHandle: CORE_HANDLE,
        towerTargetHandle: TOWER_HANDLE
    });
    assert.equal(staged.acceptedCount, 1);
    assert.equal(staged.controlAcceptedCount, 1);
    const control = fixture.priorityControlPort.calls.at(-1);
    const shot = fixture.adapter.calls.at(-1);
    const accepted = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            selectedTargetSpawns: Object.freeze([Object.freeze({
                commandId: shot.commandId,
                handle: PROJECTILE_HANDLE,
                state: 'gpu-resolve-pending'
            })])
        })
    }), tick);
    assert.equal(accepted.recoveryRequired, false);
    addExact(fixture, PROJECTILE_HANDLE, {
        kindId: 'projectile',
        definitionId: HOSTILE_RHOM_PROJECTILE_DATA.id,
        createdAtTick: tick,
        metadata: Object.freeze({
            sourceEntityId: SOURCE_HANDLE.entityId,
            sourceIncarnation: SOURCE_HANDLE.incarnation,
            selectedTargetKind: 'tower',
            selectedTargetEntityId: TOWER_HANDLE.entityId,
            selectedTargetIncarnation: TOWER_HANDLE.incarnation,
            selectedTargetPolicyId: HOSTILE_RHOM_PROJECTILE_DATA.towerTargetPolicyId
        })
    });
    const resolved = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick + 1,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            priorityTargetControlResults: Object.freeze([
                priorityControlResult(control, 'tower')
            ]),
            priorityTargetControlCompletedThroughTick: tick,
            completed: Object.freeze([Object.freeze({
                commandId: shot.commandId,
                handle: PROJECTILE_HANDLE,
                outcome: 'resolved',
                selectedTargetKind: 'tower',
                targetHandle: TOWER_HANDLE
            })])
        })
    }), tick + 1);
    assert.equal(resolved.recoveryRequired, false);
    assert.equal(fixture.director.getStatus().pendingControlCount, 0);
    assert.equal(fixture.director.getStatus().pendingShotCount, 0);
    assert.equal(fixture.director.getStatus().shotResolvedCount, 1);

    fixture.registry.remove(SOURCE_HANDLE);
    fixture.backend.remove(SOURCE_HANDLE);
    const sourceDespawn = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick + 2,
        spawned: Object.freeze([]),
        despawned: Object.freeze([Object.freeze({
            commandId: 'gpu-death:fixture:resolved-tower-shot',
            handle: SOURCE_HANDLE,
            reason: 'gpu-death'
        })]),
        fixedCommands: emptyFixedCommands()
    }), tick + 2);
    assert.equal(sourceDespawn.recoveryRequired, false);
    assert.equal(sourceDespawn.removedSourceCount, 1);
    assert.equal(fixture.director.getStatus().activeSourceCount, 0);
    assert.equal(fixture.registry.has(PROJECTILE_HANDLE), true);
    assert.equal(fixture.backend.hasBody(PROJECTILE_HANDLE), true);
    assert.equal(fixture.registry.has(CORE_HANDLE), true);
    assert.equal(fixture.backend.hasBody(CORE_HANDLE), true);
    assert.equal(fixture.registry.has(TOWER_HANDLE), true);
    assert.equal(fixture.backend.hasBody(TOWER_HANDLE), true);
});

test('committed lifecycle despawn은 지연된 M source-invalid까지 bounded terminal 증거로 유지된다', () => {
    const fixture = createDirectorFixture({ historyCapacity: 4 });
    registerRhom(fixture);
    addExact(fixture, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    const tick = fixture.director.getStatus().sources[0].nextEligibleFixedTick;
    fixture.director.stageForFixedTick({
        targetFixedTick: tick,
        coreTargetHandle: CORE_HANDLE
    });
    const controlCall = fixture.priorityControlPort.calls.at(-1);
    const shotCall = fixture.adapter.calls.at(-1);
    const destination = Object.freeze({ entityId: 941, incarnation: 1 });
    const accepted = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            selectedTargetSpawns: Object.freeze([Object.freeze({
                commandId: shotCall.commandId,
                handle: destination,
                state: 'gpu-resolve-pending'
            })])
        })
    }), tick);
    assert.equal(accepted.recoveryRequired, false);

    fixture.registry.remove(SOURCE_HANDLE);
    fixture.backend.remove(SOURCE_HANDLE);
    const despawned = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick + 1,
        spawned: Object.freeze([]),
        despawned: Object.freeze([Object.freeze({
            commandId: 'gpu-death:fixture:delayed-rhom',
            handle: SOURCE_HANDLE,
            reason: 'gpu-death'
        })]),
        fixedCommands: emptyFixedCommands()
    }), tick + 1);
    assert.equal(despawned.recoveryRequired, false);
    assert.equal(despawned.removedSourceCount, 1);
    assert.equal(fixture.director.getStatus().pendingControlCount, 1);
    assert.equal(fixture.director.getStatus().pendingShotCount, 1);
    assert.equal(
        fixture.director.getStatus().committedLifecycleDespawnCount,
        1
    );

    const completed = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick + 2,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            priorityTargetControlResults: Object.freeze([
                priorityControlResult(controlCall, 'source-invalid')
            ]),
            priorityTargetControlCompletedThroughTick: tick,
            completed: Object.freeze([Object.freeze({
                commandId: shotCall.commandId,
                handle: destination,
                outcome: 'source-invalid'
            })])
        })
    }), tick + 2);
    assert.equal(completed.recoveryRequired, false);
    const status = fixture.director.getStatus();
    assert.equal(status.activeSourceCount, 0);
    assert.equal(status.pendingControlCount, 0);
    assert.equal(status.pendingShotCount, 0);
    assert.equal(status.telemetry.sourceTerminalCancelledControls, 1);
    assert.equal(status.telemetry.sourceTerminalCancelledShots, 1);
});

test('과거 lifecycle despawn 증거는 같은 exact handle의 비정상 재활성화를 숨기지 않는다', () => {
    const fixture = createDirectorFixture();
    registerRhom(fixture);
    addExact(fixture, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    const tick = fixture.director.getStatus().sources[0].nextEligibleFixedTick;
    fixture.director.stageForFixedTick({
        targetFixedTick: tick,
        coreTargetHandle: CORE_HANDLE
    });
    const controlCall = fixture.priorityControlPort.calls.at(-1);
    const shotCall = fixture.adapter.calls.at(-1);
    const destination = Object.freeze({ entityId: 942, incarnation: 1 });
    const accepted = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            selectedTargetSpawns: Object.freeze([Object.freeze({
                commandId: shotCall.commandId,
                handle: destination,
                state: 'gpu-resolve-pending'
            })])
        })
    }), tick);
    assert.equal(accepted.recoveryRequired, false);
    fixture.registry.remove(SOURCE_HANDLE);
    fixture.backend.remove(SOURCE_HANDLE);
    const despawned = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick + 1,
        spawned: Object.freeze([]),
        despawned: Object.freeze([Object.freeze({
            commandId: 'gpu-death:fixture:rhom-aba',
            handle: SOURCE_HANDLE,
            reason: 'gpu-death'
        })]),
        fixedCommands: emptyFixedCommands()
    }), tick + 1);
    assert.equal(despawned.recoveryRequired, false);

    addExact(fixture, SOURCE_HANDLE, {
        kindId: 'enemy',
        definitionId: BASIC_RHOM_ENEMY_DEFINITION_ID,
        createdAtTick: tick + 1,
        metadata: Object.freeze({
            definitionId: BASIC_RHOM_ENEMY_DATA.id,
            enemyDefinitionId: BASIC_RHOM_ENEMY_DATA.id,
            teamId: GAMEPLAY_TEAM_ID.HOSTILE,
            capabilityMask: createEnemyCapabilityMask(BASIC_RHOM_CAPABILITY_IDS),
            physicsProfileId: BASIC_RHOM_ENEMY_DATA.physicsProfileId,
            combatProfileId: BASIC_RHOM_ENEMY_DATA.combatProfileId,
            behaviorProfileId: BASIC_RHOM_ENEMY_DATA.behaviorProfileId
        })
    });
    const replay = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick + 2,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            priorityTargetControlResults: Object.freeze([
                priorityControlResult(controlCall, 'source-invalid')
            ]),
            priorityTargetControlCompletedThroughTick: tick
        })
    }), tick + 2);
    assert.equal(replay.recoveryRequired, true);
    assert.equal(
        replay.protocolFailure.code,
        'source-terminal-liveness-contract'
    );
});

test('committed M GPU-death exact evidence는 session-local history capacity를 넘지 않는다', () => {
    const fixture = createDirectorFixture({ historyCapacity: 2 });
    const handles = [
        Object.freeze({ entityId: 51, incarnation: 1 }),
        Object.freeze({ entityId: 52, incarnation: 1 }),
        Object.freeze({ entityId: 53, incarnation: 1 })
    ];
    handles.forEach((handle, index) => {
        registerRhom(fixture, handle);
        fixture.director.observeCompletedEvents(Object.freeze({
            deathEvents: Object.freeze([Object.freeze({
                type: 'death',
                eventType: 'death',
                disposition: 'despawn-requested',
                sessionGeneration: 9,
                deviceGeneration: 4,
                authoritativeEpoch: 2,
                sourceTick: index + 1,
                sequence: 0,
                ...handle
            })])
        }));
        fixture.registry.remove(handle);
        fixture.backend.remove(handle);
    });
    const status = fixture.director.getStatus();
    assert.equal(status.committedGpuDeathCount, 2);
    assert.equal(status.committedGpuDeathCapacity, 2);
    assert.equal(status.telemetry.committedGpuDeathSources, 3);
});

test('committed M lifecycle-despawn exact evidence도 session-local history capacity를 넘지 않는다', () => {
    const fixture = createDirectorFixture({ historyCapacity: 2 });
    const handles = [
        Object.freeze({ entityId: 61, incarnation: 1 }),
        Object.freeze({ entityId: 62, incarnation: 1 }),
        Object.freeze({ entityId: 63, incarnation: 1 })
    ];
    handles.forEach((handle, index) => {
        registerRhom(fixture, handle);
        fixture.registry.remove(handle);
        fixture.backend.remove(handle);
        const observed = fixture.director.observeFixedCommit(Object.freeze({
            fixedTick: index + 2,
            spawned: Object.freeze([]),
            despawned: Object.freeze([Object.freeze({
                commandId: `gpu-death:fixture:lifecycle-history:${index}`,
                handle,
                reason: 'gpu-death'
            })]),
            fixedCommands: emptyFixedCommands()
        }), index + 2);
        assert.equal(observed.recoveryRequired, false);
    });
    const status = fixture.director.getStatus();
    assert.equal(status.committedLifecycleDespawnCount, 2);
    assert.equal(status.committedLifecycleDespawnCapacity, 2);
    assert.equal(status.telemetry.committedLifecycleDespawnSources, 3);
});

test('same-boundary exact canonical lifecycle despawn만 M stale control/shot을 terminal-cancel한다', () => {
    const authentic = createDirectorFixture();
    registerRhom(authentic);
    addExact(authentic, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    const tick = authentic.director.getStatus().sources[0].nextEligibleFixedTick;
    authentic.director.stageForFixedTick({
        targetFixedTick: tick,
        coreTargetHandle: CORE_HANDLE
    });
    const control = authentic.priorityControlPort.calls.at(-1);
    const shot = authentic.adapter.calls.at(-1);
    authentic.registry.remove(SOURCE_HANDLE);
    authentic.backend.remove(SOURCE_HANDLE);
    const cancelled = authentic.director.observeFixedCommit(Object.freeze({
        fixedTick: tick,
        spawned: Object.freeze([]),
        despawned: Object.freeze([Object.freeze({
            commandId: 'core-impact:fixture:rhom',
            handle: SOURCE_HANDLE,
            reason: 'core-impact',
            disposition: 'CORE_IMPACT',
            bountyEligible: false
        })]),
        fixedCommands: emptyFixedCommands({
            rejected: Object.freeze([
                Object.freeze({
                    commandId: control.commandId,
                    domain: 'control',
                    code: 'stale-handle'
                }),
                Object.freeze({
                    commandId: shot.commandId,
                    domain: 'spawn',
                    code: 'stale-source'
                })
            ])
        })
    }), tick);
    assert.equal(cancelled.recoveryRequired, false);
    assert.equal(authentic.director.getStatus().activeSourceCount, 0);
    assert.equal(authentic.director.getStatus().pendingControlCount, 0);
    assert.equal(authentic.director.getStatus().pendingShotCount, 0);
    assert.equal(
        authentic.director.getStatus().telemetry
            .sourceTerminalCancelledControls,
        1
    );
    assert.equal(
        authentic.director.getStatus().telemetry.sourceTerminalCancelledShots,
        1
    );
    const contradictoryReplay = authentic.director.observeFixedCommit(
        Object.freeze({
            fixedTick: tick + 1,
            spawned: Object.freeze([]),
            despawned: Object.freeze([]),
            fixedCommands: emptyFixedCommands({
                priorityTargetControlResults: Object.freeze([
                    priorityControlResult(control, 'core')
                ])
            })
        }),
        tick + 1
    );
    assert.equal(contradictoryReplay.recoveryRequired, true);
    assert.equal(
        contradictoryReplay.protocolFailure.code,
        'terminal-result-contradiction'
    );

    const ordinary = createDirectorFixture();
    registerRhom(ordinary);
    addExact(ordinary, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    const ordinaryTick = ordinary.director.getStatus()
        .sources[0].nextEligibleFixedTick;
    ordinary.director.stageForFixedTick({
        targetFixedTick: ordinaryTick,
        coreTargetHandle: CORE_HANDLE
    });
    const ordinaryControl = ordinary.priorityControlPort.calls.at(-1);
    const ordinaryShot = ordinary.adapter.calls.at(-1);
    ordinary.registry.remove(SOURCE_HANDLE);
    ordinary.backend.remove(SOURCE_HANDLE);
    const ordinaryResult = ordinary.director.observeFixedCommit(Object.freeze({
        fixedTick: ordinaryTick,
        spawned: Object.freeze([]),
        despawned: Object.freeze([Object.freeze({
            commandId: 'general-despawn:rhom',
            handle: SOURCE_HANDLE,
            reason: 'manual'
        })]),
        fixedCommands: emptyFixedCommands({
            rejected: Object.freeze([
                Object.freeze({
                    commandId: ordinaryControl.commandId,
                    domain: 'control',
                    code: 'stale-handle'
                }),
                Object.freeze({
                    commandId: ordinaryShot.commandId,
                    domain: 'spawn',
                    code: 'stale-source'
                })
            ])
        })
    }), ordinaryTick);
    assert.equal(ordinaryResult.recoveryRequired, false);
    assert.equal(ordinary.director.getStatus().pendingControlCount, 0);
    assert.equal(ordinary.director.getStatus().pendingShotCount, 0);

    const noProof = createDirectorFixture();
    registerRhom(noProof);
    addExact(noProof, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    const noProofTick = noProof.director.getStatus()
        .sources[0].nextEligibleFixedTick;
    noProof.director.stageForFixedTick({
        targetFixedTick: noProofTick,
        coreTargetHandle: CORE_HANDLE
    });
    const noProofControl = noProof.priorityControlPort.calls.at(-1);
    noProof.registry.remove(SOURCE_HANDLE);
    noProof.backend.remove(SOURCE_HANDLE);
    const rejected = noProof.director.observeFixedCommit(Object.freeze({
        fixedTick: noProofTick,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            rejected: Object.freeze([Object.freeze({
                commandId: noProofControl.commandId,
                domain: 'control',
                code: 'stale-handle'
            })])
        })
    }), noProofTick);
    assert.equal(rejected.recoveryRequired, true);
    assert.equal(
        rejected.protocolFailure.code,
        'source-terminal-proof-missing'
    );
});

test('same-boundary gpu-death에서 CORE_IMPACT로 승격된 exact lifecycle shape도 terminal-cancel 증거다', () => {
    const fixture = createDirectorFixture();
    registerRhom(fixture);
    addExact(fixture, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    const tick = fixture.director.getStatus().sources[0].nextEligibleFixedTick;
    fixture.director.stageForFixedTick({
        targetFixedTick: tick,
        coreTargetHandle: CORE_HANDLE
    });
    const control = fixture.priorityControlPort.calls.at(-1);
    const shot = fixture.adapter.calls.at(-1);
    fixture.registry.remove(SOURCE_HANDLE);
    fixture.backend.remove(SOURCE_HANDLE);

    const observed = fixture.director.observeFixedCommit(Object.freeze({
        fixedTick: tick,
        spawned: Object.freeze([]),
        despawned: Object.freeze([Object.freeze({
            commandId: 'gpu-death:fixture:promoted-rhom',
            handle: SOURCE_HANDLE,
            reason: 'gpu-death',
            disposition: 'CORE_IMPACT',
            bountyEligible: false
        })]),
        fixedCommands: emptyFixedCommands({
            rejected: Object.freeze([
                Object.freeze({
                    commandId: control.commandId,
                    domain: 'control',
                    code: 'stale-handle'
                }),
                Object.freeze({
                    commandId: shot.commandId,
                    domain: 'spawn',
                    code: 'stale-source'
                })
            ])
        })
    }), tick);

    assert.equal(observed.recoveryRequired, false);
    assert.equal(fixture.director.getStatus().pendingControlCount, 0);
    assert.equal(fixture.director.getStatus().pendingShotCount, 0);
    assert.equal(
        fixture.director.getStatus().telemetry.sourceTerminalCancelledControls,
        1
    );
    assert.equal(
        fixture.director.getStatus().telemetry.sourceTerminalCancelledShots,
        1
    );
});

test('exact terminal 증거가 있어도 core-invalid와 forged source provenance는 recovery이다', () => {
    const coreInvalid = createDirectorFixture();
    registerRhom(coreInvalid);
    addExact(coreInvalid, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    const coreInvalidTick = coreInvalid.director.getStatus()
        .sources[0].nextEligibleFixedTick;
    coreInvalid.director.stageForFixedTick({
        targetFixedTick: coreInvalidTick,
        coreTargetHandle: CORE_HANDLE
    });
    const coreInvalidControl = coreInvalid.priorityControlPort.calls.at(-1);
    coreInvalid.registry.remove(SOURCE_HANDLE);
    coreInvalid.backend.remove(SOURCE_HANDLE);
    const coreInvalidResult = coreInvalid.director.observeFixedCommit(
        Object.freeze({
            fixedTick: coreInvalidTick,
            spawned: Object.freeze([]),
            despawned: Object.freeze([Object.freeze({
                commandId: 'core-impact:fixture:core-invalid',
                handle: SOURCE_HANDLE,
                reason: 'core-impact',
                disposition: 'CORE_IMPACT',
                bountyEligible: false
            })]),
            fixedCommands: emptyFixedCommands({
                priorityTargetControlResults: Object.freeze([
                    priorityControlResult(
                        coreInvalidControl,
                        'core-invalid'
                    )
                ])
            })
        }),
        coreInvalidTick
    );
    assert.equal(coreInvalidResult.recoveryRequired, true);
    assert.equal(coreInvalidResult.protocolFailure.code, 'core-invalid');

    const forged = createDirectorFixture();
    registerRhom(forged);
    addExact(forged, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    const forgedTick = forged.director.getStatus()
        .sources[0].nextEligibleFixedTick;
    forged.director.stageForFixedTick({
        targetFixedTick: forgedTick,
        coreTargetHandle: CORE_HANDLE
    });
    const forgedControl = forged.priorityControlPort.calls.at(-1);
    forged.director.observeCompletedEvents(Object.freeze({
        deathEvents: Object.freeze([Object.freeze({
            type: 'death',
            eventType: 'death',
            disposition: 'despawn-requested',
            sessionGeneration: 9,
            deviceGeneration: 4,
            authoritativeEpoch: 2,
            sourceTick: forgedTick,
            sequence: 0,
            ...SOURCE_HANDLE
        })])
    }));
    forged.registry.remove(SOURCE_HANDLE);
    forged.backend.remove(SOURCE_HANDLE);
    const forgedResult = forged.director.observeFixedCommit(Object.freeze({
        fixedTick: forgedTick + 1,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        fixedCommands: emptyFixedCommands({
            priorityTargetControlResults: Object.freeze([
                priorityControlResult(forgedControl, 'source-invalid', {
                    attackFingerprint: 124
                })
            ])
        })
    }), forgedTick + 1);
    assert.equal(forgedResult.recoveryRequired, true);
    assert.equal(
        forgedResult.protocolFailure.code,
        'control-result-provenance-contract'
    );
});

test('normal request rejection도 attempt ordinal을 전진시켜 다음 M source를 선택한다', () => {
    const adapter = new RejectingProjectileAdapterFixture();
    const fixture = createDirectorFixture({
        maximumStartsPerFixedTick: 1,
        projectileSpawnAdapter: adapter
    });
    const secondSource = Object.freeze({ entityId: 41, incarnation: 1 });
    registerRhom(fixture, SOURCE_HANDLE);
    registerRhom(fixture, secondSource);
    addExact(fixture, CORE_HANDLE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: null
    });
    const tick = Math.max(...fixture.director.getStatus().sources.map(
        ({ nextEligibleFixedTick }) => nextEligibleFixedTick
    ));
    assert.equal(fixture.director.stageForFixedTick({
        targetFixedTick: tick,
        coreTargetHandle: CORE_HANDLE
    }).rejectedCount, 1);
    const firstSource = adapter.calls.at(-1).sourceHandle;
    assert.equal(fixture.director.stageForFixedTick({
        targetFixedTick: tick + 1,
        coreTargetHandle: CORE_HANDLE
    }).rejectedCount, 1);
    assert.notDeepEqual(adapter.calls.at(-1).sourceHandle, firstSource);
    assert.ok(fixture.director.getStatus().sources.every(
        ({ lastAttemptOrdinal }) => lastAttemptOrdinal > 0
    ));
});
