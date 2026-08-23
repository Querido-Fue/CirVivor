import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ACTOR_PAYLOAD_CODE,
    SENTENCE_ACTION_CODE,
    normalizeSentenceDefinition
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    normalizeAbilityExecutionCommand
} = await loadGameModule('ingame/contract/ability_execution_contract.js');
const {
    ABILITY_EXECUTION_OUTCOME_CODE
} = await loadGameModule('ingame/word/word_system.js');
const {
    SentenceCompiler
} = await loadGameModule('ingame/word/sentence_compiler.js');
const {
    ActorPayloadMaterializer
} = await loadGameModule('ingame/word/actor_payload_materializer.js');
const {
    R3_ENEMY_WORD_INSTANCE,
    R3_SHOOT_WORD_INSTANCE,
    R3_TOWER_WORD_INSTANCE,
    R5_EMIT_WORD_INSTANCE,
    R5_SUMMON_WORD_INSTANCE,
    R5_THROW_WORD_INSTANCE
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    GPU_ACTOR_ACTION_ENEMY_MATERIALIZATION_WGSL
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_payload_materialization_runtime.js'
);
const {
    GPU_TOWER_CREATION_ACTOR_ACTION_WGSL
} = await loadGameModule(
    'ingame/physics/gpu/gpu_tower_creation_shaders.js'
);
const {
    GPU_ACTOR_ACTION_PLACEMENT_WGSL,
    GPU_ACTOR_ACTION_PLACEMENT_STORAGE_BINDING_COUNT
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_action_placement_shaders.js'
);
const {
    ACTOR_PAYLOAD_MATERIALIZATION_STATUS
} = await loadGameModule('ingame/contract/actor_payload_contract.js');

const ENEMY_ENDPOINT_SOURCE = await readFile(new URL(
    '../script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js',
    import.meta.url
), 'utf8');

const SUBJECTS = [R3_TOWER_WORD_INSTANCE, R3_ENEMY_WORD_INSTANCE];
const VERBS = [
    R3_SHOOT_WORD_INSTANCE,
    R5_THROW_WORD_INSTANCE,
    R5_EMIT_WORD_INSTANCE,
    R5_SUMMON_WORD_INSTANCE
];
const PAYLOADS = [R3_TOWER_WORD_INSTANCE, R3_ENEMY_WORD_INSTANCE];

function createSentence(subject, verb, payload, suffix) {
    return normalizeSentenceDefinition({
        id: `sentence.r5.matrix.${suffix}`,
        subjectWordInstanceId: subject.id,
        verbWordInstanceId: verb.id,
        payloadWordInstanceId: payload.id,
        modifierWordInstanceIds: []
    });
}

function createReadyRecord(compiledAbility, ordinal) {
    const command = normalizeAbilityExecutionCommand({
        executionId: `execution.r5.matrix.${ordinal}`,
        executionOrdinal: ordinal,
        targetFixedTick: 20,
        aimPoint: { x: 12, y: 8 },
        compiledAbility
    });
    const completion = Object.freeze({
        status: 2,
        snapshotToken: Object.freeze({ ordinal }),
        executionId: command.executionId,
        executionOrdinal: command.executionOrdinal,
        commandFingerprint: command.fingerprint,
        snapshotFingerprint: (0x50000000 + ordinal) >>> 0,
        subjectCount: 1,
        capacityDemand: 1,
        sourceTick: 20
    });
    return Object.freeze({ command, completion });
}

function createHarness(ready, endpointResult = Object.freeze({
    accepted: true,
    destinationFingerprint: 0x5ecafbad
})) {
    const endpointRequests = [];
    const towerRequests = [];
    const completed = [];
    const settlements = [];
    let drained = false;
    const abilityRuntime = {
        drainReadySnapshots(out) {
            if (!drained) out.push(ready);
            drained = true;
            return out;
        },
        returnReadySnapshot() { return true; },
        markGpuMaterializationPending() { return true; },
        completeSnapshotExecution(record, evidence) {
            settlements.push({ type: 'complete', record, evidence });
            return true;
        },
        rejectSnapshotExecution(record, code, evidence) {
            settlements.push({ type: 'reject', record, code, evidence });
            return true;
        }
    };
    const endpoint = {
        requestActorPayloadMaterialization(request) {
            endpointRequests.push(request);
            return endpointResult;
        },
        drainCompletedActorPayloadMaterializations(out) {
            out.push(...completed.splice(0));
            return out;
        },
        drainCompletedActorTransits(out) { return out; },
        cancelPendingActorPayloadMaterializations() {
            return Object.freeze({ cancelledExecutionCount: 0 });
        },
        getActorPayloadMaterializationStatus() {
            return Object.freeze({ requiresRecovery: false });
        }
    };
    const coordinator = {
        getStatus() { return Object.freeze({ state: 'idle' }); },
        requestTowerCreation(request) {
            towerRequests.push(request);
            return Object.freeze({
                accepted: true,
                requestFingerprint: request.command.fingerprint
            });
        },
        cancelPending() { return true; }
    };
    const materializer = new ActorPayloadMaterializer({
        abilityRuntime,
        endpoint,
        towerCreationCoordinatorProvider: () => coordinator,
        towerPayloadContextProvider: () => Object.freeze({
            runtimeAvailable: true,
            sdf: Object.freeze({
                cols: 1,
                rows: 1,
                enabled: false,
                worldWidth: 32,
                worldHeight: 24
            }),
            recoveryPlacementPolicy: Object.freeze({
                policyId: 'fixture-lattice',
                mapRecoveryAnchorId: 'fixture-anchor',
                mapLatticeVersion: 1,
                anchorPosition: Object.freeze({ x: 4, y: 4 })
            })
        })
    });
    return {
        completed,
        endpointRequests,
        materializer,
        settlements,
        towerRequests
    };
}

test('Tower/Enemy Subject × 네 verb × Tower/Enemy Payload가 공용 materializer ingress를 통과한다', () => {
    const compiler = new SentenceCompiler();
    let ordinal = 1;
    for (const subject of SUBJECTS) {
        for (const verb of VERBS) {
            for (const payload of PAYLOADS) {
                const compiledAbility = compiler.compile(createSentence(
                    subject,
                    verb,
                    payload,
                    `${ordinal}`
                ));
                const ready = createReadyRecord(compiledAbility, ordinal++);
                const harness = createHarness(ready);
                const staged = harness.materializer.stageReadyForFixedTick({
                    targetFixedTick: 20
                });
                assert.equal(staged.stagedCount, 1,
                    `${subject.id}/${verb.id}/${payload.id}`);
                assert.equal(staged.rejectedCount, 0);
                const towerPayload = compiledAbility.payloadCode
                    === ACTOR_PAYLOAD_CODE.TOWER;
                assert.equal(harness.towerRequests.length,
                    towerPayload ? 1 : 0);
                assert.equal(harness.endpointRequests.length,
                    towerPayload ? 0 : 1);
                const request = towerPayload
                    ? harness.towerRequests[0]
                    : harness.endpointRequests[0];
                assert.equal(request.command.actionCode,
                    compiledAbility.actionCode);
                assert.equal(
                    request.command.actorActionProfileFingerprint,
                    compiledAbility.actorActionProfileFingerprint
                );
                harness.materializer.destroy();
            }
        }
    }
});

test('Enemy Emit/Summon은 launch completion에서 ordinary handle과 cooldown을 한 번 공개한다', () => {
    const compiler = new SentenceCompiler();
    for (const [ordinal, verb] of [
        [101, R5_EMIT_WORD_INSTANCE],
        [102, R5_SUMMON_WORD_INSTANCE]
    ]) {
        const ability = compiler.compile(createSentence(
            R3_TOWER_WORD_INSTANCE,
            verb,
            R3_ENEMY_WORD_INSTANCE,
            `ordinary-${ordinal}`
        ));
        const ready = createReadyRecord(ability, ordinal);
        const harness = createHarness(ready);
        assert.equal(harness.materializer.stageReadyForFixedTick({
            targetFixedTick: 20
        }).stagedCount, 1);
        const handles = Object.freeze([
            Object.freeze({ entityId: ordinal, incarnation: 1 })
        ]);
        harness.completed.push(Object.freeze({
            transactionId: `actor-payload.r3:${ready.command.executionId}`,
            executionOrdinal: ready.command.executionOrdinal,
            commandFingerprint: ready.command.fingerprint,
            snapshotFingerprint: ready.completion.snapshotFingerprint,
            subjectCount: 1,
            destinationCount: 1,
            copiesPerSubject: 1,
            modifierSetFingerprint: 0,
            destinationFingerprint: 0x5ecafbad,
            generatedCount: 1,
            materializationTargetTick: 20,
            status: ACTOR_PAYLOAD_MATERIALIZATION_STATUS.COMPLETE,
            state: 'COMMITTED',
            committed: true,
            airborne: false,
            handles,
            requiresRecovery: false
        }));
        const observed = harness.materializer.observeCompleted(21);
        assert.equal(observed.committedCount, 1);
        assert.deepEqual(observed.committedHandles, handles);
        assert.equal(harness.settlements.length, 1);
        assert.equal(harness.settlements[0].type, 'complete');
        harness.materializer.destroy();
    }
});

test('네 verb의 Enemy capacity reject는 body/handle/cooldown 0인 정상 결과다', () => {
    const compiler = new SentenceCompiler();
    let ordinal = 201;
    for (const verb of VERBS) {
        const ability = compiler.compile(createSentence(
            R3_TOWER_WORD_INSTANCE,
            verb,
            R3_ENEMY_WORD_INSTANCE,
            `capacity-${ordinal}`
        ));
        const ready = createReadyRecord(ability, ordinal++);
        const harness = createHarness(ready, Object.freeze({
            accepted: false,
            capacityRejected: true,
            reason: 'actor-payload-capacity',
            reservationCount: 0,
            spawnCount: 0,
            cooldownConsumed: false,
            requiresRecovery: false
        }));
        const staged = harness.materializer.stageReadyForFixedTick({
            targetFixedTick: 20
        });
        assert.equal(staged.stagedCount, 0);
        assert.equal(staged.rejectedCount, 1);
        assert.equal(staged.recoveryRequired, false);
        assert.equal(harness.settlements.length, 1);
        assert.equal(harness.settlements[0].type, 'reject');
        assert.equal(harness.settlements[0].code,
            ABILITY_EXECUTION_OUTCOME_CODE.DESTINATION_CAPACITY_REJECTED);
        harness.materializer.destroy();
    }
});

test('Emit/Summon 소비 shader는 immediate activation과 no-transit, 9-storage를 고정한다', () => {
    for (const shader of [
        GPU_ACTOR_ACTION_ENEMY_MATERIALIZATION_WGSL,
        GPU_TOWER_CREATION_ACTOR_ACTION_WGSL
    ]) {
        const bindings = new Set([...shader.matchAll(
            /@binding\((\d+)\)/g
        )].map((match) => Number(match[1])));
        assert.equal(bindings.size, 9);
        assert.match(shader, /ACTOR_EMIT/);
        assert.match(shader, /ACTOR_SUMMON/);
        assert.match(shader, /PLACEMENT_TRANSIT_PENDING/);
        assert.match(shader, /activation_tick != target_tick \+ 1u/);
        assert.match(shader, /set_transit_word\(slot, word, 0u\)/);
    }
    assert.equal(GPU_ACTOR_ACTION_PLACEMENT_STORAGE_BINDING_COUNT, 9);
    assert.match(GPU_ACTOR_ACTION_PLACEMENT_WGSL, /fn lattice_offset/);
    assert.match(GPU_ACTOR_ACTION_PLACEMENT_WGSL,
        /minimum_distance \* minimum_distance/);
    assert.match(GPU_ACTOR_ACTION_PLACEMENT_WGSL, /STATUS_SDF_REJECTED/);
    assert.doesNotMatch(GPU_ACTOR_ACTION_PLACEMENT_WGSL, /atomicAdd/);
    assert.equal(SENTENCE_ACTION_CODE.EMIT, 3);
    assert.equal(SENTENCE_ACTION_CODE.SUMMON, 4);
});

test('Enemy placement ingress는 fixed tick에서 pending GPU placement를 실제 제출한다', () => {
    assert.match(ENEMY_ENDPOINT_SOURCE,
        /ACTOR_PAYLOAD_PLACEMENT_BACKEND_METHODS[\s\S]*'submitActorActionPlacements'/);
    assert.match(ENEMY_ENDPOINT_SOURCE,
        /placementStatus\?\.pendingCount[\s\S]*submitActorActionPlacements\(Number\(sourceTick\)\)/);
    assert.match(ENEMY_ENDPOINT_SOURCE,
        /return submitted \|\| actorPayloadPlacementSubmitted/);
});
