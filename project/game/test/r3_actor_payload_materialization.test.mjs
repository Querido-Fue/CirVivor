import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ACTOR_PAYLOAD_MATERIALIZATION_STATUS,
    R3_ENEMY_ACTOR_PAYLOAD_DEFINITION
} = await loadGameModule('ingame/contract/actor_payload_contract.js');
const {
    GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_payload_materialization_abi.js'
);
const {
    GPU_ACTOR_PAYLOAD_MATERIALIZATION_STORAGE_BINDING_COUNT,
    GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_payload_materialization_runtime.js'
);
const {
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI
} = await loadGameModule(
    'ingame/physics/gpu/gpu_ability_subject_snapshot_abi.js'
);
const { WorldRegistry } = await loadGameModule(
    'ingame/object/world_registry.js'
);
const { ActorPayloadMaterializer } = await loadGameModule(
    'ingame/word/actor_payload_materializer.js'
);
const {
    ABILITY_EXECUTION_OUTCOME_CODE
} = await loadGameModule('ingame/word/word_system.js');

const BACKEND_SOURCE = await readFile(new URL(
    '../script/module/ingame/object/enemy/enemy_simulation_backend.js',
    import.meta.url
), 'utf8');
const ENDPOINT_SOURCE = await readFile(new URL(
    '../script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js',
    import.meta.url
), 'utf8');
const RUNTIME_SOURCE = await readFile(new URL(
    '../script/module/ingame/physics/gpu/gpu_actor_payload_materialization_runtime.js',
    import.meta.url
), 'utf8');

function readyRecord(executionOrdinal = 7, subjectCount = 2) {
    const snapshotToken = Object.freeze({});
    return Object.freeze({
        request: Object.freeze({
            abilityRequestId: `request-${executionOrdinal}`,
            slotId: 'E'
        }),
        command: Object.freeze({
            executionId: `execution-${executionOrdinal}`,
            executionOrdinal,
            fingerprint: 1000 + executionOrdinal,
            payloadCode: 1
        }),
        completion: Object.freeze({
            executionId: `execution-${executionOrdinal}`,
            executionOrdinal,
            subjectCount,
            capacityDemand: subjectCount,
            snapshotFingerprint: 2000 + executionOrdinal,
            snapshotToken
        })
    });
}

class FakeAbilityRuntime {
    constructor(ready = []) {
        this.ready = [...ready];
        this.completed = [];
        this.rejected = [];
    }

    drainReadySnapshots(out) {
        out.push(...this.ready);
        this.ready.length = 0;
        return out;
    }

    returnReadySnapshot(record) {
        this.ready.unshift(record);
        return true;
    }

    markGpuMaterializationPending(record, fixedTick) {
        this.pending = { record, fixedTick };
        return true;
    }

    completeSnapshotExecution(record, options) {
        this.completed.push({ record, options });
        return true;
    }

    rejectSnapshotExecution(record, code, options) {
        this.rejected.push({ record, code, options });
        return true;
    }
}

class FakeEndpoint {
    constructor() {
        this.requests = [];
        this.completed = [];
        this.capacityRejected = false;
        this.retryable = false;
    }

    requestActorPayloadMaterialization(request) {
        this.requests.push(request);
        if (this.retryable) {
            return {
                accepted: false,
                retryable: true,
                reason: 'event-backpressure',
                requiresRecovery: false
            };
        }
        return this.capacityRejected
            ? {
                accepted: false,
                capacityRejected: true,
                reason: 'actor-payload-capacity',
                reservationCount: 0,
                spawnCount: 0,
                requiresRecovery: false
            }
            : { accepted: true, transactionId: request.transactionId };
    }

    drainCompletedActorPayloadMaterializations(out) {
        out.push(...this.completed);
        this.completed.length = 0;
        return out;
    }

    cancelPendingActorPayloadMaterializations() {
        return { cancelledExecutionCount: this.requests.length };
    }

    getActorPayloadMaterializationStatus() {
        return { requiresRecovery: false };
    }
}

test('Enemy actor payload definition은 persistent ordinary Hostile C다', () => {
    const definition = R3_ENEMY_ACTOR_PAYLOAD_DEFINITION;
    assert.equal(definition.definitionId, 'basic_circle_01');
    assert.equal(definition.kindId, 'enemy');
    assert.equal(definition.teamId, 2);
    assert.equal(definition.allegiancePolicy, 'fixed-hostile');
    assert.equal(definition.projectile, false);
    assert.equal(definition.ordinaryEnemy, true);
    assert.equal(definition.rewardEligible, true);
    assert.equal(definition.visibleExecutionOffset, 1);
    assert.equal(definition.aiActivationFixedTickOffset, 1);
});

test('snapshot/lease/materialization ABI는 rank i 대응과 aggregate-only readback을 고정한다', () => {
    assert.equal(GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE, 112);
    assert.equal(GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.LEASE_HEADER.STRIDE, 160);
    assert.equal(
        GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.DESTINATION_LEASE.STRIDE,
        32
    );
    assert.equal(GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.AGGREGATE.STRIDE, 64);
    assert.match(GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        /snapshot_word\(rank,[\s\S]*lease_word\([\s\S]*rank/);
    assert.match(BACKEND_SOURCE, /snapshotRank: index/);
    assert.match(BACKEND_SOURCE, /destinationFingerprint/);
});

test('materialization pass는 preflight 전체 후에만 N개 body를 쓰므로 partial publication을 막는다', () => {
    const preflight = GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL.indexOf(
        'for (var rank = 0u; rank < subject_count; rank++)'
    );
    const materialize = GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL.indexOf(
        'for (var rank = 0u; rank < subject_count; rank++)',
        preflight + 1
    );
    const firstWrite = GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL.indexOf(
        'physics.values[destination_slot].position',
        materialize
    );
    assert.ok(preflight >= 0 && materialize > preflight);
    assert.ok(firstWrite > materialize);
    assert.match(ENDPOINT_SOURCE, /activateReservedBatch/);
    assert.match(ENDPOINT_SOURCE, /commitActorPayloadBodyPrelease/);
});

test('Tower aim/Enemy Tower→Core→facing, route inheritance, SDF를 GPU에서 결정한다', () => {
    assert.match(GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        /header\(\d+u\) == TOWER_SELECTOR/);
    assert.match(GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        /nearest_slot[\s\S]*core_slot[\s\S]*return facing/);
    assert.match(GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        /selector == ENEMY_SELECTOR[\s\S]*flow_field_index[\s\S]*current_path_index/);
    assert.match(GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        /sample_sdf\(position\) >= radius/);
    assert.match(GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        /STATUS_SDF_REJECTED[\s\S]*ERROR_SDF_PLACEMENT/);
});

test('child metadata는 exact source/provenance, generation+1, current+1을 GPU에 기록한다', () => {
    assert.match(GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        /owner_entity_id[\s\S]*snapshot_word\(rank, \d+u\)/);
    assert.match(GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        /owner_incarnation[\s\S]*snapshot_word\(rank, \d+u\)/);
    assert.match(GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        /\.generation[\s\S]*snapshot_word\(rank, \d+u\) \+ 1u/);
    assert.match(GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        /visible_from_execution_ordinal[\s\S]*header\(\d+u\) \+ 1u/);
    assert.match(GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        /header\(\d+u\) != HOSTILE_TEAM/);
});

test('IActorPayloadMaterializer는 committed aggregate에서만 cooldown 자격을 완료한다', () => {
    const ready = readyRecord();
    const ability = new FakeAbilityRuntime([ready]);
    const endpoint = new FakeEndpoint();
    const materializer = new ActorPayloadMaterializer({
        abilityRuntime: ability,
        endpoint
    });
    const stage = materializer.stageReadyForFixedTick({ targetFixedTick: 9 });
    assert.equal(stage.stagedCount, 1);
    const transactionId = endpoint.requests[0].transactionId;
    endpoint.completed.push({
        transactionId,
        executionOrdinal: ready.command.executionOrdinal,
        commandFingerprint: ready.command.fingerprint,
        snapshotFingerprint: ready.completion.snapshotFingerprint,
        subjectCount: ready.completion.subjectCount,
        materializationTargetTick: 9,
        status: ACTOR_PAYLOAD_MATERIALIZATION_STATUS.COMPLETE,
        state: 'COMMITTED',
        committed: true,
        generatedCount: ready.completion.subjectCount,
        requiresRecovery: false
    });
    const observed = materializer.observeCompleted(10);
    assert.equal(observed.committedCount, 1);
    assert.equal(ability.completed.length, 1);
    assert.equal(ability.completed[0].options.generatedCount, 2);
    assert.equal(ability.rejected.length, 0);
});

test('capacity one-short는 reservation/spawn/cooldown 0으로 즉시 거절한다', () => {
    const ready = readyRecord(8, 3);
    const ability = new FakeAbilityRuntime([ready]);
    const endpoint = new FakeEndpoint();
    endpoint.capacityRejected = true;
    const materializer = new ActorPayloadMaterializer({
        abilityRuntime: ability,
        endpoint
    });
    const stage = materializer.stageReadyForFixedTick({ targetFixedTick: 11 });
    assert.equal(stage.stagedCount, 0);
    assert.equal(stage.rejectedCount, 1);
    assert.equal(ability.completed.length, 0);
    assert.equal(
        ability.rejected[0].code,
        ABILITY_EXECUTION_OUTCOME_CODE.DESTINATION_CAPACITY_REJECTED
    );
});

test('임시 GPU event backpressure는 snapshot identity를 보존해 재시도한다', () => {
    const ready = readyRecord(9, 1000);
    const ability = new FakeAbilityRuntime([ready]);
    const endpoint = new FakeEndpoint();
    endpoint.retryable = true;
    const materializer = new ActorPayloadMaterializer({
        abilityRuntime: ability,
        endpoint
    });
    const stage = materializer.stageReadyForFixedTick({ targetFixedTick: 12 });
    assert.equal(stage.stagedCount, 0);
    assert.equal(stage.rejectedCount, 0);
    assert.equal(stage.recoveryRequired, false);
    assert.equal(ability.ready.length, 1);
    assert.equal(ability.ready[0], ready);
    assert.equal(ability.rejected.length, 0);
});

test('WorldRegistry destination batch activation은 stale 하나에도 0/N이다', () => {
    const registry = new WorldRegistry({ capacity: 4 });
    const first = registry.reserveEntity({
        kindId: 'enemy',
        definitionId: 'basic_circle_01',
        createdAtTick: 3
    });
    const second = registry.reserveEntity({
        kindId: 'enemy',
        definitionId: 'basic_circle_01',
        createdAtTick: 3
    });
    const rejected = registry.activateReservedBatch([
        { handle: first, metadata: { sourceSnapshotRank: 0 } },
        {
            handle: { ...second, incarnation: second.incarnation + 1 },
            metadata: { sourceSnapshotRank: 1 }
        }
    ]);
    assert.equal(rejected.accepted, false);
    assert.equal(registry.getActiveCount(), 0);
    assert.equal(registry.getReservedCount(), 2);
    const committed = registry.activateReservedBatch([
        { handle: first, metadata: { sourceSnapshotRank: 0 } },
        { handle: second, metadata: { sourceSnapshotRank: 1 } }
    ]);
    assert.equal(committed.accepted, true);
    assert.equal(registry.getActiveCount('enemy'), 2);
});

test('Actor payload compute는 storage 9개 이하이고 per-subject CPU command가 없다', () => {
    const bindings = Array.from(
        GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL.matchAll(
            /@group\(0\)\s+@binding\((\d+)\)\s+var<storage/g
        ),
        (match) => Number(match[1])
    );
    assert.deepEqual(bindings, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(
        GPU_ACTOR_PAYLOAD_MATERIALIZATION_STORAGE_BINDING_COUNT,
        bindings.length
    );
    assert.ok(bindings.length <= 9);
    assert.match(RUNTIME_SOURCE, /perSubjectCpuCommandCount:\s*0/);
    assert.doesNotMatch(ENDPOINT_SOURCE, /readGpuAbilitySubjectSnapshotRecord/);
    const preleaseBody = BACKEND_SOURCE.slice(
        BACKEND_SOURCE.indexOf('preleaseActorPayloadBodies(request = {})'),
        BACKEND_SOURCE.indexOf('stageActorPayloadMaterialization(request = {})')
    );
    assert.match(BACKEND_SOURCE, /uploadActorPayloadPreleaseRanges/);
    assert.match(BACKEND_SOURCE,
        /isRetryableActorPayloadBodySpawnReason/);
    assert.match(ENDPOINT_SOURCE,
        /bodyCapacityRejected[\s\S]*retryable/);
    assert.doesNotMatch(preleaseBody, /queue\.writeBuffer/);
});
