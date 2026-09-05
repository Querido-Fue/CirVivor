import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    BASIC_RHOM_ATTACK_DATA
} = await loadGameModule('data/object/enemy/basic_rhom_attack_data.js');
const {
    HOSTILE_RHOM_PROJECTILE_DATA
} = await loadGameModule(
    'data/object/projectile/hostile_rhom_projectile_data.js'
);
const {
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');
const {
    createGpuSelectedTargetProjectileIntent
} = await loadGameModule(
    'ingame/object/projectile/gpu_projectile_spawn_adapter.js'
);
const {
    GpuFixedCommandOwner
} = await loadGameModule('ingame/object/gpu_fixed_command_owner.js');
const {
    GPU_BODY_CONTROL_PROGRAM_ABI_VERSION,
    GPU_BODY_CONTROL_PROGRAM_MODE,
    GPU_BODY_CONTROL_PROGRAM_RESULT,
    GPU_BODY_CONTROL_SELECTED_TARGET_KIND,
    GPU_BODY_CONTROL_SELECTION_POLICY,
    GPU_BODY_CONTROL_STATE_FLAGS,
    GPU_FIXED_PRIMITIVE_ABI,
    GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION,
    GPU_SPAWN_PROGRAM_ABI_VERSION,
    GPU_SPAWN_PROGRAM_MODE,
    GPU_SPAWN_PROGRAM_REQUEST_FLAGS,
    GPU_SPAWN_PROGRAM_RESULT,
    createGpuBodyControlProgramStorage,
    createGpuSpawnProgramStorage,
    readGpuSpawnProgramRecord,
    writeGpuBodyControlProgramRecord,
    writeGpuSpawnProgramRecord
} = await loadGameModule('ingame/physics/gpu/gpu_fixed_primitive_abi.js');

const SOURCE = Object.freeze({ entityId: 10, incarnation: 2 });
const CORE = Object.freeze({ entityId: 20, incarnation: 3 });
const TOWER = Object.freeze({ entityId: 30, incarnation: 4 });
const ROSTER_TOWER = Object.freeze({ entityId: 31, incarnation: 5 });
const PROTOCOL = Object.freeze({
    sessionGeneration: 7,
    deviceGeneration: 1,
    authoritativeEpoch: 2
});

function key(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

class RegistryFixture {
    constructor() {
        this.active = new Map();
        this.reserved = new Map();
        this.nextEntityId = 1000;
    }

    add(handle, descriptor) {
        this.active.set(key(handle), Object.freeze({ ...handle, ...descriptor }));
    }

    has(handle) {
        return this.active.has(key(handle));
    }

    remove(handle) {
        return this.active.delete(key(handle));
    }

    copyEntityView(handle, out = {}) {
        const value = this.active.get(key(handle));
        if (!value) {
            return null;
        }
        Object.assign(out, value);
        return out;
    }

    reserveEntity(descriptor) {
        const handle = Object.freeze({
            entityId: this.nextEntityId++,
            incarnation: 1
        });
        this.reserved.set(key(handle), { handle, descriptor });
        return handle;
    }

    activateReserved(handle, metadata) {
        const reserved = this.reserved.get(key(handle));
        if (!reserved) {
            return false;
        }
        this.reserved.delete(key(handle));
        this.add(handle, {
            kindId: reserved.descriptor.kindId,
            definitionId: reserved.descriptor.definitionId,
            createdAtTick: reserved.descriptor.createdAtTick,
            metadata
        });
        return true;
    }

    cancelReservation(handle) {
        return this.reserved.delete(key(handle));
    }

    hasReservation(handle) {
        return this.reserved.has(key(handle));
    }

    getRevision() {
        return 0;
    }

    getStatus() {
        return Object.freeze({ activeCount: this.active.size });
    }
}

class BackendFixture {
    constructor() {
        this.active = new Set();
        this.plans = [];
        this.bodyControlCompletionBatches = [];
        this.completionBatches = [];
        this.terminalCancelStatus = null;
    }

    add(handle) {
        this.active.add(key(handle));
    }

    hasBody(handle) {
        return this.active.has(key(handle));
    }

    canControlBody() {
        return false;
    }

    stageFixedPrograms(plan) {
        this.plans.push(plan);
        return Object.freeze({
            controls: Object.freeze({
                accepted: plan.controls.length,
                rejected: 0
            }),
            sourceRelativeSpawns: Object.freeze({
                accepted: plan.sourceRelativeSpawns.length,
                rejected: 0
            }),
            requiresRecovery: false
        });
    }

    drainCompletedSpawnProgramBatches(out) {
        out.push(...this.completionBatches.splice(0));
    }

    drainCompletedBodyControlProgramBatches(out) {
        out.push(...this.bodyControlCompletionBatches.splice(0));
    }

    cancelPendingFixedProgramsForTerminal(request) {
        this.terminalCancelStatus = Object.freeze({
            abiVersion: GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION,
            finalFixedTick: request.finalFixedTick,
            accepted: true,
            state: 'armed',
            reason: null,
            destinationCount: request.destinationHandles.length,
            priorityControlCount: request.priorityControls.length
        });
        return this.terminalCancelStatus;
    }

    getTerminalFixedProgramCancelStatus() {
        return this.terminalCancelStatus;
    }

    getEventProtocolState() {
        return PROTOCOL;
    }

    requiresRecovery() {
        return false;
    }

    getRuntimeState() {
        return 'gpu-ready';
    }
}

function createSelectedIntent(
    spawnSequence = 0,
    sourceHandle = SOURCE,
    destinationOverrides = null
) {
    const intent = createGpuSelectedTargetProjectileIntent({
        definition: HOSTILE_RHOM_PROJECTILE_DATA,
        sourceHandle,
        ownerHandle: sourceHandle,
        coreTargetHandle: CORE,
        towerTargetHandle: TOWER,
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
        spawnSequence
    });
    return destinationOverrides === null
        ? intent
        : Object.freeze({
            ...intent,
            destinationSpawn: Object.freeze({
                ...intent.destinationSpawn,
                ...destinationOverrides
            })
        });
}

test('BodyControl v2/Spawn v4는 priority selection과 same-tick fingerprint layout을 고정한다', () => {
    assert.equal(GPU_BODY_CONTROL_PROGRAM_ABI_VERSION, 2);
    assert.equal(GPU_SPAWN_PROGRAM_ABI_VERSION, 4);
    assert.equal(GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_RECORD.STRIDE, 96);
    assert.equal(GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_STATE.STRIDE, 64);
    assert.equal(GPU_FIXED_PRIMITIVE_ABI.SPAWN_PROGRAM_RECORD.STRIDE, 96);
    assert.deepEqual({ ...GPU_BODY_CONTROL_STATE_FLAGS }, {
        STOP: 1,
        ROUTE_FLOW: 2,
        CORE_SELECTED: 4,
        TOWER_SELECTED: 8
    });
    assert.equal(GPU_SPAWN_PROGRAM_RESULT.NO_TARGET, 5);
    assert.equal(GPU_SPAWN_PROGRAM_RESULT.CONTROL_STATE_MISMATCH, 6);
    assert.equal(GPU_SPAWN_PROGRAM_RESULT.CORE_TARGET_INVALID, 7);

    const controlStorage = createGpuBodyControlProgramStorage(1);
    writeGpuBodyControlProgramRecord(controlStorage, 0, {
        destinationSlot: 5,
        entityId: SOURCE.entityId,
        incarnation: SOURCE.incarnation,
        modeFlags: GPU_BODY_CONTROL_PROGRAM_MODE.PRIORITY_TARGET_IN_RANGE,
        sourceTick: 31,
        selectionSequence: 0,
        coreTargetSlot: 6,
        coreTargetEntityId: CORE.entityId,
        coreTargetIncarnation: CORE.incarnation,
        towerTargetSlot: 7,
        towerTargetEntityId: TOWER.entityId,
        towerTargetIncarnation: TOWER.incarnation,
        attackRange: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
        result: GPU_BODY_CONTROL_PROGRAM_RESULT.PENDING,
        selectedTargetKind: GPU_BODY_CONTROL_SELECTED_TARGET_KIND.NONE,
        attackFingerprint: 77,
        selectionPolicy:
            GPU_BODY_CONTROL_SELECTION_POLICY.CORE_FIRST_IN_RANGE_THEN_TOWER
    });

    const spawnStorage = createGpuSpawnProgramStorage(1);
    writeGpuSpawnProgramRecord(spawnStorage, 0, {
        destinationSlot: 8,
        destinationEntityId: 100,
        destinationIncarnation: 1,
        sourceSlot: 5,
        sourceEntityId: SOURCE.entityId,
        sourceIncarnation: SOURCE.incarnation,
        modeFlags:
            GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET,
        sourceTick: 31,
        positionOffset: { x: 0, y: 0 },
        targetOffset: { x: 0, y: 0 },
        launchSpeed: BASIC_RHOM_ATTACK_DATA.launchSpeed,
        selectionSequence: 0,
        attackFingerprint: 77,
        selectedTargetKind: GPU_BODY_CONTROL_SELECTED_TARGET_KIND.NONE,
        requestFlags:
            GPU_SPAWN_PROGRAM_REQUEST_FLAGS.REQUIRE_EXACT_SELECTED_TARGET
    });
    const record = readGpuSpawnProgramRecord(spawnStorage, 0);
    assert.equal(record.sourceTick, 31);
    assert.equal(record.selectionSequence, 0);
    assert.equal(record.attackFingerprint, 77);
});

test('fixed owner는 priority control을 shot budget과 분리하고 selected spawn을 exact control에 결합한다', () => {
    const registry = new RegistryFixture();
    const backend = new BackendFixture();
    registry.add(SOURCE, {
        kindId: 'enemy',
        definitionId: 'basic_rhom_01',
        createdAtTick: 1,
        metadata: Object.freeze({ teamId: GAMEPLAY_TEAM_ID.HOSTILE })
    });
    registry.add(CORE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: Object.freeze({})
    });
    registry.add(TOWER, {
        kindId: 'tower',
        definitionId: 'the-tower',
        createdAtTick: 1,
        metadata: Object.freeze({})
    });
    backend.add(SOURCE);
    backend.add(CORE);
    backend.add(TOWER);
    const owner = new GpuFixedCommandOwner(backend, registry);
    const controlCommandId = 'rhom-control:31';
    const control = owner.requestPriorityTargetControl({
        sourceHandle: SOURCE,
        coreTargetHandle: CORE,
        towerTargetHandle: TOWER,
        attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
        targetSelectionPolicyId:
            BASIC_RHOM_ATTACK_DATA.targetSelectionPolicy,
        distancePolicyId: BASIC_RHOM_ATTACK_DATA.distancePolicy,
        stopWhileTargetInRange: true,
        selectionSequence: 0,
        attackDefinitionId: BASIC_RHOM_ATTACK_DATA.id,
        projectileDefinitionId: HOSTILE_RHOM_PROJECTILE_DATA.id,
        producerId: BASIC_RHOM_ATTACK_DATA.producerId,
        sourceAbilityId: BASIC_RHOM_ATTACK_DATA.sourceAbilityId
    }, 31, controlCommandId);
    assert.equal(control.accepted, true);
    const selected = owner.requestSelectedTargetSpawn(
        createSelectedIntent(),
        31,
        'rhom-shot:31:0'
    );
    assert.equal(selected.accepted, true);
    assert.equal(owner.requestSelectedTargetSpawn(
        createSelectedIntent(),
        31,
        'rhom-shot:31:duplicate-binding'
    ).reason, 'duplicate-selection-binding');
    const selectedReplay = owner.requestSelectedTargetSpawn(
        createSelectedIntent(),
        31,
        'rhom-shot:31:0'
    );
    assert.equal(selectedReplay.accepted, true);
    assert.equal(selectedReplay.replay, true);

    const committed = owner.commitAtFixedBoundary(31);
    assert.equal(committed.controls.length, 1);
    assert.equal(committed.sourceRelativeSpawns.length, 0);
    assert.equal(committed.selectedTargetSpawns.length, 1);
    assert.equal(owner.getStatus().pendingSelectionBindingCount, 1);
    assert.equal(backend.plans.length, 1);
    assert.equal(
        backend.plans[0].controls[0].modeFlags,
        GPU_BODY_CONTROL_PROGRAM_MODE.PRIORITY_TARGET_IN_RANGE
    );
    assert.equal(
        backend.plans[0].sourceRelativeSpawns[0].modeFlags,
        GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET
    );
    assert.equal(
        backend.plans[0].controls[0].attackFingerprint,
        backend.plans[0].sourceRelativeSpawns[0].attackFingerprint
    );
    const destinationHandle = committed.selectedTargetSpawns[0].handle;
    backend.add(destinationHandle);
    const firstControl = backend.plans[0].controls[0];
    backend.bodyControlCompletionBatches.push(Object.freeze({
        ...PROTOCOL,
        sourceTick: 31,
        outcomes: Object.freeze([Object.freeze({
            sourceHandle: SOURCE,
            coreTargetHandle: CORE,
            towerTargetHandle: TOWER,
            sourceTick: 31,
            selectionSequence: 0,
            attackFingerprint: firstControl.attackFingerprint,
            attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
            result: GPU_BODY_CONTROL_PROGRAM_RESULT.CORE_SELECTED,
            outcome: 'core',
            selectedTargetKind: GPU_BODY_CONTROL_SELECTED_TARGET_KIND.CORE,
            stateFlags: GPU_BODY_CONTROL_STATE_FLAGS.STOP
                | GPU_BODY_CONTROL_STATE_FLAGS.CORE_SELECTED,
            selectedTargetHandle: CORE
        })])
    }));
    backend.completionBatches.push(Object.freeze({
        ...PROTOCOL,
        sourceTick: 31,
        outcomes: Object.freeze([Object.freeze({
            destinationHandle,
            sourceHandle: SOURCE,
            targetHandle: CORE,
            selectedTargetKind: 'core',
            reason: 'resolved'
        })])
    }));
    const completed = owner.commitCompletedAtFixedBoundary(32);
    assert.equal(completed.protocolFailure, null);
    assert.equal(completed.priorityTargetControlResults.length, 1);
    assert.equal(completed.priorityTargetControlResults[0].outcome, 'core');
    assert.equal(owner.getStatus().pendingSelectionBindingCount, 0);
    const projectile = registry.copyEntityView(destinationHandle, {});
    assert.equal(projectile.metadata.selectedTargetKind, 'core');
    assert.equal(
        projectile.metadata.selectedTargetPolicyId,
        HOSTILE_RHOM_PROJECTILE_DATA.coreTargetPolicyId
    );
    assert.equal(
        projectile.metadata.coreDamageFixedPoint,
        500
    );

    const noTargetControlId = 'rhom-control:33';
    assert.equal(owner.requestPriorityTargetControl({
        sourceHandle: SOURCE,
        coreTargetHandle: CORE,
        towerTargetHandle: TOWER,
        attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
        targetSelectionPolicyId:
            BASIC_RHOM_ATTACK_DATA.targetSelectionPolicy,
        distancePolicyId: BASIC_RHOM_ATTACK_DATA.distancePolicy,
        stopWhileTargetInRange: true,
        selectionSequence: 1,
        attackDefinitionId: BASIC_RHOM_ATTACK_DATA.id,
        projectileDefinitionId: HOSTILE_RHOM_PROJECTILE_DATA.id,
        producerId: BASIC_RHOM_ATTACK_DATA.producerId,
        sourceAbilityId: BASIC_RHOM_ATTACK_DATA.sourceAbilityId
    }, 33, noTargetControlId).accepted, true);
    assert.equal(owner.requestSelectedTargetSpawn(
        createSelectedIntent(1),
        33,
        'rhom-shot:33:1'
    ).accepted, true);
    const noTargetCommit = owner.commitAtFixedBoundary(33);
    const noTargetDestination = noTargetCommit.selectedTargetSpawns[0].handle;
    assert.equal(owner.getStatus().pendingSelectionBindingCount, 1);
    const noTargetControl = backend.plans.at(-1).controls[0];
    backend.bodyControlCompletionBatches.push(Object.freeze({
        ...PROTOCOL,
        sourceTick: 33,
        outcomes: Object.freeze([Object.freeze({
            sourceHandle: SOURCE,
            coreTargetHandle: CORE,
            towerTargetHandle: TOWER,
            sourceTick: 33,
            selectionSequence: 1,
            attackFingerprint: noTargetControl.attackFingerprint,
            attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
            result: GPU_BODY_CONTROL_PROGRAM_RESULT.NO_TARGET,
            outcome: 'no-target',
            selectedTargetKind: GPU_BODY_CONTROL_SELECTED_TARGET_KIND.NONE,
            stateFlags: GPU_BODY_CONTROL_STATE_FLAGS.ROUTE_FLOW,
            selectedTargetHandle: null
        })])
    }));
    backend.completionBatches.push(Object.freeze({
        ...PROTOCOL,
        sourceTick: 33,
        outcomes: Object.freeze([Object.freeze({
            destinationHandle: noTargetDestination,
            sourceHandle: SOURCE,
            targetHandle: null,
            selectedTargetKind: 'none',
            reason: 'no-target'
        })])
    }));
    const noTargetCompleted = owner.commitCompletedAtFixedBoundary(34);
    assert.equal(noTargetCompleted.protocolFailure, null);
    assert.equal(noTargetCompleted.completed.at(-1).outcome, 'no-target');
    assert.equal(registry.copyEntityView(noTargetDestination, {}), null);
    assert.equal(owner.getStatus().pendingSelectionBindingCount, 0);
});

test('resolved Tower projectile authority는 launch 뒤 source exact death와 독립적으로 유지된다', () => {
    const registry = new RegistryFixture();
    const backend = new BackendFixture();
    registry.add(SOURCE, {
        kindId: 'enemy',
        definitionId: 'basic_rhom_01',
        createdAtTick: 1,
        metadata: Object.freeze({ teamId: GAMEPLAY_TEAM_ID.HOSTILE })
    });
    registry.add(CORE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: Object.freeze({})
    });
    registry.add(TOWER, {
        kindId: 'tower',
        definitionId: 'the-tower',
        createdAtTick: 1,
        metadata: Object.freeze({})
    });
    backend.add(SOURCE);
    backend.add(CORE);
    backend.add(TOWER);
    const owner = new GpuFixedCommandOwner(backend, registry);
    const control = owner.requestPriorityTargetControl({
        sourceHandle: SOURCE,
        coreTargetHandle: CORE,
        towerTargetHandle: TOWER,
        attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
        targetSelectionPolicyId:
            BASIC_RHOM_ATTACK_DATA.targetSelectionPolicy,
        distancePolicyId: BASIC_RHOM_ATTACK_DATA.distancePolicy,
        stopWhileTargetInRange: true,
        selectionSequence: 9,
        attackDefinitionId: BASIC_RHOM_ATTACK_DATA.id,
        projectileDefinitionId: HOSTILE_RHOM_PROJECTILE_DATA.id,
        producerId: BASIC_RHOM_ATTACK_DATA.producerId,
        sourceAbilityId: BASIC_RHOM_ATTACK_DATA.sourceAbilityId
    }, 51, 'rhom-tower-control:51');
    assert.equal(control.accepted, true);
    assert.equal(owner.requestSelectedTargetSpawn(
        createSelectedIntent(9),
        51,
        'rhom-tower-shot:51:9'
    ).accepted, true);

    const committed = owner.commitAtFixedBoundary(51);
    const destinationHandle = committed.selectedTargetSpawns[0].handle;
    const stagedControl = backend.plans[0].controls[0];
    backend.add(destinationHandle);
    backend.bodyControlCompletionBatches.push(Object.freeze({
        ...PROTOCOL,
        sourceTick: 51,
        outcomes: Object.freeze([Object.freeze({
            sourceHandle: SOURCE,
            coreTargetHandle: CORE,
            towerTargetHandle: TOWER,
            sourceTick: 51,
            selectionSequence: 9,
            attackFingerprint: stagedControl.attackFingerprint,
            attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
            result: GPU_BODY_CONTROL_PROGRAM_RESULT.TOWER_SELECTED,
            outcome: 'tower',
            selectedTargetKind: GPU_BODY_CONTROL_SELECTED_TARGET_KIND.TOWER,
            stateFlags: GPU_BODY_CONTROL_STATE_FLAGS.STOP
                | GPU_BODY_CONTROL_STATE_FLAGS.TOWER_SELECTED,
            selectedTargetHandle: TOWER
        })])
    }));
    backend.completionBatches.push(Object.freeze({
        ...PROTOCOL,
        sourceTick: 51,
        outcomes: Object.freeze([Object.freeze({
            destinationHandle,
            sourceHandle: SOURCE,
            targetHandle: TOWER,
            selectedTargetKind: 'tower',
            reason: 'resolved'
        })])
    }));

    const resolved = owner.commitCompletedAtFixedBoundary(52);
    assert.equal(resolved.protocolFailure, null);
    assert.deepEqual(resolved.completed, [Object.freeze({
        commandId: 'rhom-tower-shot:51:9',
        handle: destinationHandle,
        outcome: 'resolved',
        selectedTargetKind: 'tower',
        targetHandle: TOWER
    })]);
    const beforeSourceDeath = registry.copyEntityView(destinationHandle, {});
    const authorityBeforeSourceDeath = Object.freeze({
        selectedTargetKind: beforeSourceDeath.metadata.selectedTargetKind,
        selectedTargetEntityId:
            beforeSourceDeath.metadata.selectedTargetEntityId,
        selectedTargetIncarnation:
            beforeSourceDeath.metadata.selectedTargetIncarnation,
        selectedTargetPolicyId:
            beforeSourceDeath.metadata.selectedTargetPolicyId,
        selectionSourceTick: beforeSourceDeath.metadata.selectionSourceTick,
        selectionSequence: beforeSourceDeath.metadata.selectionSequence,
        attackFingerprint: beforeSourceDeath.metadata.attackFingerprint
    });
    assert.deepEqual(authorityBeforeSourceDeath, {
        selectedTargetKind: 'tower',
        selectedTargetEntityId: TOWER.entityId,
        selectedTargetIncarnation: TOWER.incarnation,
        selectedTargetPolicyId: HOSTILE_RHOM_PROJECTILE_DATA.towerTargetPolicyId,
        selectionSourceTick: 51,
        selectionSequence: 9,
        attackFingerprint: stagedControl.attackFingerprint
    });

    assert.equal(registry.remove(SOURCE), true);
    assert.equal(backend.active.delete(key(SOURCE)), true);
    assert.equal(registry.has(SOURCE), false);
    assert.equal(backend.hasBody(SOURCE), false);
    assert.equal(registry.has(destinationHandle), true);
    assert.equal(backend.hasBody(destinationHandle), true);
    const afterSourceDeath = registry.copyEntityView(destinationHandle, {});
    assert.deepEqual({
        selectedTargetKind: afterSourceDeath.metadata.selectedTargetKind,
        selectedTargetEntityId: afterSourceDeath.metadata.selectedTargetEntityId,
        selectedTargetIncarnation: afterSourceDeath.metadata.selectedTargetIncarnation,
        selectedTargetPolicyId: afterSourceDeath.metadata.selectedTargetPolicyId,
        selectionSourceTick: afterSourceDeath.metadata.selectionSourceTick,
        selectionSequence: afterSourceDeath.metadata.selectionSequence,
        attackFingerprint: afterSourceDeath.metadata.attackFingerprint
    }, authorityBeforeSourceDeath);
    assert.equal(owner.commitCompletedAtFixedBoundary(53).protocolFailure, null);
});

test('authoritative Tower completion은 비동기 readback 전 roster 변경과 target retirement를 허용한다', () => {
    const registry = new RegistryFixture();
    const backend = new BackendFixture();
    let rosterReady = true;
    backend.getTowerGroupRuntimeStatus = () => rosterReady
        ? Object.freeze({
            state: 'ready',
            groupRevision: 3,
            rosterFingerprint: 0x12345678
        })
        : Object.freeze({ state: 'unavailable' });
    registry.add(SOURCE, {
        kindId: 'enemy',
        definitionId: 'basic_rhom_01',
        createdAtTick: 1,
        metadata: Object.freeze({ teamId: GAMEPLAY_TEAM_ID.HOSTILE })
    });
    registry.add(CORE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: Object.freeze({})
    });
    for (const towerHandle of [TOWER, ROSTER_TOWER]) {
        registry.add(towerHandle, {
            kindId: 'tower',
            definitionId: 'the-tower',
            createdAtTick: 1,
            metadata: Object.freeze({
                definitionId: 'the-tower',
                teamId: GAMEPLAY_TEAM_ID.PLAYER
            })
        });
        backend.add(towerHandle);
    }
    backend.add(SOURCE);
    backend.add(CORE);
    const owner = new GpuFixedCommandOwner(backend, registry);
    assert.equal(owner.requestPriorityTargetControl({
        sourceHandle: SOURCE,
        coreTargetHandle: CORE,
        towerTargetHandle: TOWER,
        attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
        targetSelectionPolicyId: BASIC_RHOM_ATTACK_DATA.targetSelectionPolicy,
        distancePolicyId: BASIC_RHOM_ATTACK_DATA.distancePolicy,
        stopWhileTargetInRange: true,
        selectionSequence: 10,
        attackDefinitionId: BASIC_RHOM_ATTACK_DATA.id,
        projectileDefinitionId: HOSTILE_RHOM_PROJECTILE_DATA.id,
        producerId: BASIC_RHOM_ATTACK_DATA.producerId,
        sourceAbilityId: BASIC_RHOM_ATTACK_DATA.sourceAbilityId
    }, 61, 'rhom-roster-control:61').accepted, true);
    assert.equal(owner.requestSelectedTargetSpawn(
        createSelectedIntent(10),
        61,
        'rhom-roster-shot:61:10'
    ).accepted, true);

    const committed = owner.commitAtFixedBoundary(61);
    const destinationHandle = committed.selectedTargetSpawns[0].handle;
    const stagedControl = backend.plans[0].controls[0];
    backend.add(destinationHandle);
    backend.bodyControlCompletionBatches.push(Object.freeze({
        ...PROTOCOL,
        sourceTick: 61,
        outcomes: Object.freeze([Object.freeze({
            sourceHandle: SOURCE,
            coreTargetHandle: CORE,
            towerTargetHandle: TOWER,
            sourceTick: 61,
            selectionSequence: 10,
            attackFingerprint: stagedControl.attackFingerprint,
            attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
            result: GPU_BODY_CONTROL_PROGRAM_RESULT.TOWER_SELECTED,
            outcome: 'tower',
            selectedTargetKind: GPU_BODY_CONTROL_SELECTED_TARGET_KIND.TOWER,
            stateFlags: GPU_BODY_CONTROL_STATE_FLAGS.STOP
                | GPU_BODY_CONTROL_STATE_FLAGS.TOWER_SELECTED,
            selectedTargetHandle: ROSTER_TOWER
        })])
    }));
    backend.completionBatches.push(Object.freeze({
        ...PROTOCOL,
        sourceTick: 61,
        outcomes: Object.freeze([Object.freeze({
            destinationHandle,
            sourceHandle: SOURCE,
            targetHandle: ROSTER_TOWER,
            selectedTargetKind: 'tower',
            reason: 'resolved'
        })])
    }));

    rosterReady = false;
    assert.equal(registry.remove(ROSTER_TOWER), true);
    assert.equal(backend.active.delete(key(ROSTER_TOWER)), true);
    const completed = owner.commitCompletedAtFixedBoundary(62);

    assert.equal(completed.protocolFailure, null);
    assert.equal(owner.requiresRecovery(), false);
    assert.deepEqual(completed.priorityTargetControlResults[0].selectedTargetHandle, {
        ...ROSTER_TOWER
    });
    assert.deepEqual(completed.completed[0].targetHandle, { ...ROSTER_TOWER });
    const projectile = registry.copyEntityView(destinationHandle, {});
    assert.equal(
        projectile.metadata.selectedTargetEntityId,
        ROSTER_TOWER.entityId
    );
    assert.equal(
        projectile.metadata.selectedTargetIncarnation,
        ROSTER_TOWER.incarnation
    );
    assert.equal(
        projectile.metadata.towerTargetEntityId,
        ROSTER_TOWER.entityId
    );
    assert.equal(
        projectile.metadata.towerTargetIncarnation,
        ROSTER_TOWER.incarnation
    );
});

test('completion activation metadata는 whole-batch preflight 뒤에만 registry와 history를 변경한다', () => {
    const registry = new RegistryFixture();
    const backend = new BackendFixture();
    const secondSource = Object.freeze({ entityId: 11, incarnation: 3 });
    for (const sourceHandle of [SOURCE, secondSource]) {
        registry.add(sourceHandle, {
            kindId: 'enemy',
            definitionId: 'basic_rhom_01',
            createdAtTick: 1,
            metadata: Object.freeze({ teamId: GAMEPLAY_TEAM_ID.HOSTILE })
        });
        backend.add(sourceHandle);
    }
    registry.add(CORE, {
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        createdAtTick: 1,
        metadata: Object.freeze({})
    });
    registry.add(TOWER, {
        kindId: 'tower',
        definitionId: 'the-tower',
        createdAtTick: 1,
        metadata: Object.freeze({})
    });
    backend.add(CORE);
    backend.add(TOWER);
    const owner = new GpuFixedCommandOwner(backend, registry);
    const requestControl = (sourceHandle, selectionSequence, commandId) => (
        owner.requestPriorityTargetControl({
            sourceHandle,
            coreTargetHandle: CORE,
            towerTargetHandle: TOWER,
            attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
            targetSelectionPolicyId:
                BASIC_RHOM_ATTACK_DATA.targetSelectionPolicy,
            distancePolicyId: BASIC_RHOM_ATTACK_DATA.distancePolicy,
            stopWhileTargetInRange: true,
            selectionSequence,
            attackDefinitionId: BASIC_RHOM_ATTACK_DATA.id,
            projectileDefinitionId: HOSTILE_RHOM_PROJECTILE_DATA.id,
            producerId: BASIC_RHOM_ATTACK_DATA.producerId,
            sourceAbilityId: BASIC_RHOM_ATTACK_DATA.sourceAbilityId
        }, 40, commandId)
    );
    assert.equal(requestControl(SOURCE, 10, 'control-valid:40').accepted, true);
    assert.equal(requestControl(
        secondSource,
        11,
        'control-malformed:40'
    ).accepted, true);
    assert.equal(owner.requestSelectedTargetSpawn(
        createSelectedIntent(10, SOURCE),
        40,
        'selected-valid:40'
    ).accepted, true);
    assert.equal(owner.requestSelectedTargetSpawn(
        createSelectedIntent(11, secondSource, {
            coreDamageFixedPoint: 499
        }),
        40,
        'selected-malformed:40'
    ).accepted, true);
    const committed = owner.commitAtFixedBoundary(40);
    assert.equal(committed.selectedTargetSpawns.length, 2);
    const [valid, malformed] = committed.selectedTargetSpawns;
    backend.add(valid.handle);
    backend.add(malformed.handle);
    backend.completionBatches.push(Object.freeze({
        ...PROTOCOL,
        sourceTick: 40,
        outcomes: Object.freeze([
            Object.freeze({
                destinationHandle: valid.handle,
                sourceHandle: SOURCE,
                targetHandle: CORE,
                selectedTargetKind: 'core',
                reason: 'resolved'
            }),
            Object.freeze({
                destinationHandle: malformed.handle,
                sourceHandle: secondSource,
                targetHandle: CORE,
                selectedTargetKind: 'core',
                reason: 'resolved'
            })
        ])
    }));
    const completed = owner.commitCompletedAtFixedBoundary(41);
    assert.equal(
        completed.protocolFailure.code,
        'activation-metadata-contract'
    );
    assert.equal(completed.completed.length, 0);
    assert.equal(registry.copyEntityView(valid.handle, {}), null);
    assert.equal(registry.copyEntityView(malformed.handle, {}), null);
    assert.equal(registry.reserved.size, 2);
    assert.equal(owner.getStatus().pendingDestinationCount, 2);
    assert.equal(owner.getStatus().pendingSelectionBindingCount, 2);
    assert.equal(owner.getStatus().telemetry.completedResolved, 0);
});
