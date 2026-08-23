import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ACTOR_PAYLOAD_CARDINALITY_REASON,
    evaluateActorPayloadCardinality
} = await loadGameModule('ingame/word/actor_payload_budget.js');
const {
    GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI,
    GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI_VERSION
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_payload_materialization_abi.js'
);
const {
    GPU_ACTOR_ACTION_PLACEMENT_ABI,
    GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_action_placement_abi.js'
);
const {
    GPU_ACTOR_TRANSIT_ABI_VERSION
} = await loadGameModule('ingame/physics/gpu/gpu_actor_transit_abi.js');
const {
    GPU_ACTOR_ACTION_PLACEMENT_WGSL
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_action_placement_shaders.js'
);
const {
    GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_payload_materialization_runtime.js'
);
const {
    ABILITY_EXECUTION_OUTCOME_CODE,
    WordSystem
} = await loadGameModule('ingame/word/word_system.js');

const endpointSource = await readFile(new URL(
    '../script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js',
    import.meta.url
), 'utf8');
const materializerSource = await readFile(new URL(
    '../script/module/ingame/word/actor_payload_materializer.js',
    import.meta.url
), 'utf8');

test('destination cardinality는 overflow/budget/capacity를 clamp 없이 구분한다', () => {
    assert.deepEqual(evaluateActorPayloadCardinality({
        subjectCount: 125,
        copiesPerSubject: 2,
        registryAvailable: 250,
        bodyAvailable: 250,
        generatedBodyBudget: 1000
    }), {
        valid: true,
        reason: null,
        subjectCount: 125,
        copiesPerSubject: 2,
        effectiveGeneratedCount: 250,
        multiplicationOverflow: false,
        requiredBodies: 250,
        availableBodies: 250,
        registryAvailable: 250,
        bodyAvailable: 250,
        generatedBodyBudget: 1000,
        shortfall: 0
    });
    assert.equal(evaluateActorPayloadCardinality({
        subjectCount: 501,
        copiesPerSubject: 2,
        registryAvailable: 2000,
        bodyAvailable: 2000,
        generatedBodyBudget: 1000
    }).reason, ACTOR_PAYLOAD_CARDINALITY_REASON
        .GENERATED_BODY_BUDGET_EXCEEDED);
    assert.equal(evaluateActorPayloadCardinality({
        subjectCount: 1,
        copiesPerSubject: 2,
        registryAvailable: 2,
        bodyAvailable: 1,
        generatedBodyBudget: 1000
    }).reason, ACTOR_PAYLOAD_CARDINALITY_REASON
        .DESTINATION_CAPACITY_EXCEEDED);
    const overflow = evaluateActorPayloadCardinality({
        subjectCount: 0x80000000,
        copiesPerSubject: 2,
        registryAvailable: 0xffffffff,
        bodyAvailable: 0xffffffff,
        generatedBodyBudget: 0xffffffff
    });
    assert.equal(overflow.reason,
        ACTOR_PAYLOAD_CARDINALITY_REASON.GENERATED_COUNT_OVERFLOW);
    assert.equal(overflow.effectiveGeneratedCount, 0);
});

test('R7 actor payload/placement/transit ABI는 cardinality를 원자적으로 표현한다', () => {
    assert.equal(GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI_VERSION, 5);
    assert.equal(GPU_ACTOR_ACTION_PLACEMENT_ABI_VERSION, 3);
    assert.equal(GPU_ACTOR_TRANSIT_ABI_VERSION, 2);
    assert.equal(GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.LEASE_HEADER.STRIDE, 192);
    assert.equal(GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.AGGREGATE.STRIDE, 88);
    assert.equal(GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE.STRIDE, 112);
    for (const abi of [
        GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.LEASE_HEADER,
        GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.AGGREGATE,
        GPU_ACTOR_ACTION_PLACEMENT_ABI.PROGRAM_HEADER,
        GPU_ACTOR_ACTION_PLACEMENT_ABI.AGGREGATE
    ]) {
        assert.equal(Number.isSafeInteger(abi.SUBJECT_COUNT), true);
        assert.equal(Number.isSafeInteger(abi.DESTINATION_COUNT), true);
        assert.equal(Number.isSafeInteger(abi.COPIES_PER_SUBJECT), true);
        assert.equal(Number.isSafeInteger(abi.MODIFIER_SET_FINGERPRINT), true);
    }
    assert.equal(
        Number.isSafeInteger(
            GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.DESTINATION_LEASE.COPY_INDEX
        ),
        true
    );
    assert.equal(
        Number.isSafeInteger(
            GPU_ACTOR_ACTION_PLACEMENT_ABI.DESTINATION_LEASE.COPY_INDEX
        ),
        true
    );
});

test('GPU destination dispatch는 stable source/copy rank와 modifier provenance를 검증한다', () => {
    for (const source of [
        GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        GPU_ACTOR_ACTION_PLACEMENT_WGSL
    ]) {
        assert.match(source, /destination_count/);
        assert.match(source, /copies_per_subject/);
        assert.match(source, /copy_index/);
        assert.match(source, /source_rank/);
    }
    assert.match(GPU_ACTOR_ACTION_PLACEMENT_WGSL,
        /modifier_set_fingerprint/);
    assert.match(
        GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        new RegExp(`header\\(${
            GPU_ACTOR_PAYLOAD_MATERIALIZATION_ABI.LEASE_HEADER
                .MODIFIER_SET_FINGERPRINT / 4
        }u\\)`)
    );
    assert.match(GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        /source_rank != rank \/ copies_per_subject/);
    assert.match(GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        /copy_index != rank % copies_per_subject/);
    assert.doesNotMatch(GPU_ACTOR_PAYLOAD_MATERIALIZATION_WGSL,
        /INVALID_U32 \/ copies_per_subject/);
    assert.doesNotMatch(GPU_ACTOR_ACTION_PLACEMENT_WGSL,
        /INVALID_U32 \/ copies_per_subject/);
});

test('endpoint는 모든 capacity/ring preflight를 registry/body prelease보다 먼저 한다', () => {
    const methodStart = endpointSource.indexOf(
        'requestActorPayloadMaterialization(request'
    );
    const methodEnd = endpointSource.indexOf(
        'drainCompletedActorPayloadMaterializations',
        methodStart
    );
    const method = endpointSource.slice(methodStart, methodEnd);
    const reserve = method.indexOf('this.registry.reserveEntity');
    const bodyPrelease = method.indexOf('.preleaseActorPayloadBodies');
    for (const gate of [
        'evaluateActorPayloadCardinality',
        'canStageActorPayloadMaterialization',
        'canStageActorActionPlacement',
        'transitCanStage'
    ]) {
        const gateIndex = method.indexOf(gate);
        assert.ok(gateIndex >= 0 && gateIndex < reserve, gate);
    }
    assert.ok(reserve >= 0 && reserve < bodyPrelease);
    assert.match(method, /reservationCount: 0,[\s\S]*cooldownConsumed: false/);
});

test('materializer와 final receipt는 exact destination modifier provenance를 보존한다', () => {
    assert.match(materializerSource,
        /completion\.destinationCount === destinationCount/);
    assert.match(materializerSource,
        /completion\.copiesPerSubject === copiesPerSubject/);
    assert.match(materializerSource,
        /completion\.modifierSetFingerprint[\s\S]*modifierSetFingerprint/);
    assert.match(materializerSource,
        /completion\.destinationFingerprint[\s\S]*record\.destinationFingerprint/);
    assert.match(materializerSource,
        /completion\.generatedCount === completion\.destinationCount/);

    const words = new WordSystem();
    try {
        assert.equal(words.recordExecutionOutcome({
            abilityRequestId: 'request.r7.receipt',
            executionId: 'execution.r7.receipt',
            executionOrdinal: 7,
            slotId: 'Q',
            code: ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED,
            completedFixedTick: 20,
            subjectCount: 50,
            generatedCount: 200,
            copiesPerSubject: 4,
            modifierSetFingerprint: 0xdecafbad,
            cooldownConsumed: true
        }), true);
        const outcome = words.getStatusView().lastExecutionOutcome;
        assert.equal(outcome.copiesPerSubject, 4);
        assert.equal(outcome.modifierSetFingerprint, 0xdecafbad);
        assert.equal(outcome.generatedCount, 200);
        assert.equal(outcome.cooldownConsumed, true);
    } finally {
        words.destroy();
    }
});
