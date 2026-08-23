import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ABILITY_SLOT_ID,
    SENTENCE_ACTION_CODE,
    SENTENCE_COMPILE_ERROR_CODE,
    SENTENCE_PAYLOAD_REQUIREMENT,
    SENTENCE_RUNTIME_AVAILABILITY,
    SUBJECT_SELECTOR_CODE,
    WORD_DEFINITION_ID,
    WORD_RUNTIME_SUPPORT,
    normalizeSentenceDefinition
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    TOWER_GROUP_OPERATION_AUTHORITY,
    TOWER_GROUP_OPERATION_KIND,
    TOWER_GROUP_OPERATION_PROFILE_ID,
    TOWER_GROUP_SUBJECT_SELECTION_POLICY
} = await loadGameModule(
    'ingame/contract/tower_group_operation_contract.js'
);
const {
    R5_ACTOR_ACTION_PROFILE_BY_ACTION_CODE
} = await loadGameModule('data/word/r5_actor_action_profile_data.js');
const {
    MERGE_VERB_WORD_DEFINITION,
    R3_ENEMY_WORD_INSTANCE,
    R3_SHOOT_WORD_INSTANCE,
    R3_TOWER_WORD_INSTANCE,
    R5_EMIT_WORD_INSTANCE,
    R5_SENTENCE_DEFINITIONS,
    R5_SHOWCASE_SENTENCE_LOADOUT,
    R5_SUMMON_WORD_INSTANCE,
    R5_THROW_WORD_INSTANCE,
    R6_MERGE_WORD_INSTANCE,
    R6_QA_SENTENCE_LOADOUT,
    R6_SENTENCE_DEFINITION_BY_ID,
    R6_TOWERS_MERGE_SENTENCE,
    R6_WORD_DEFINITIONS,
    R6_WORD_INSTANCES
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    R6_TOWER_MERGE_GROUP_OPERATION_PROFILE
} = await loadGameModule(
    'data/word/r6_tower_group_operation_profile_data.js'
);
const {
    SentenceCompiler
} = await loadGameModule('ingame/word/sentence_compiler.js');
const {
    ABILITY_ACTIVATION_RESULT_CODE,
    WordSystem
} = await loadGameModule('ingame/word/word_system.js');

function assertDeepFrozen(value, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
        assertDeepFrozen(child, visited);
    }
}

function abilitySha256(ability) {
    return createHash('sha256').update(JSON.stringify(ability)).digest('hex');
}

function actorSentence(subject, verb, payload, suffix) {
    return normalizeSentenceDefinition({
        id: `sentence.r6.identity.${suffix}`,
        subjectWordInstanceId: subject.id,
        verbWordInstanceId: verb.id,
        payloadWordInstanceId: payload.id,
        modifierWordInstanceIds: []
    });
}

test('R6 append-only vocabulary는 R3/R5 action/profile/compiled identity를 exact 보존한다', () => {
    assert.deepEqual({ ...SENTENCE_ACTION_CODE }, {
        SHOOT: 1,
        THROW: 2,
        EMIT: 3,
        SUMMON: 4,
        MERGE: 5
    });
    assert.equal(WORD_DEFINITION_ID.MERGE, 'verb.merge');
    assert.equal(WORD_RUNTIME_SUPPORT.R6, 'r6');

    const baselineHashes = new Map([
        ['sentence.r3.tower-shoots-enemy',
            '9f2a7fa8f3d729468aa4e9b63de6f09b6efc7d2d93d0b427cb2f927da898ddc0'],
        ['sentence.r3.enemies-shoot-enemies',
            'db8da920fe6f11645f05c31382a1e75bfd9251a7ec0bfb43f964455e5b2dd473'],
        ['sentence.r5.tower-shoots-tower',
            'f8ba80bb5f552bbf408576bf08021d9645fe12b5dd7a6d9ac3f9bd57ea2c07c0'],
        ['sentence.r5.enemies-shoot-tower',
            '27899a002ccfdd56ee161d9c28f86a5142ef12ef071bf450c506f725542ffabe']
    ]);
    const baselineCompiler = new SentenceCompiler();
    for (const sentence of R5_SENTENCE_DEFINITIONS) {
        assert.equal(
            abilitySha256(baselineCompiler.compile(sentence)),
            baselineHashes.get(sentence.id),
            sentence.id
        );
    }

    const subjects = [R3_TOWER_WORD_INSTANCE, R3_ENEMY_WORD_INSTANCE];
    const verbs = [
        R3_SHOOT_WORD_INSTANCE,
        R5_THROW_WORD_INSTANCE,
        R5_EMIT_WORD_INSTANCE,
        R5_SUMMON_WORD_INSTANCE
    ];
    const payloads = [R3_TOWER_WORD_INSTANCE, R3_ENEMY_WORD_INSTANCE];
    const expectedProfileFingerprintByActionCode = new Map([
        [SENTENCE_ACTION_CODE.SHOOT, 2654657154],
        [SENTENCE_ACTION_CODE.THROW, 736207154],
        [SENTENCE_ACTION_CODE.EMIT, 3152785069],
        [SENTENCE_ACTION_CODE.SUMMON, 2048560214]
    ]);
    const compiler = new SentenceCompiler();
    let ordinal = 0;
    for (const subject of subjects) {
        for (const verb of verbs) {
            for (const payload of payloads) {
                const sentence = actorSentence(
                    subject,
                    verb,
                    payload,
                    ordinal++
                );
                const ability = compiler.compile(sentence);
                assert.strictEqual(compiler.compile(sentence), ability);
                const profile = R5_ACTOR_ACTION_PROFILE_BY_ACTION_CODE[
                    ability.actionCode
                ];
                const expectedId = ability.actionCode
                        === SENTENCE_ACTION_CODE.SHOOT
                    && payload === R3_ENEMY_WORD_INSTANCE
                    ? [
                        'compiled-ability.r3',
                        subject.definitionId,
                        verb.definitionId,
                        payload.definitionId,
                        'abi1'
                    ].join(':')
                    : [
                        'compiled-ability.r5',
                        subject.definitionId,
                        verb.definitionId,
                        payload.definitionId,
                        profile.id,
                        'abi1'
                    ].join(':');
                assert.equal(ability.compiledAbilityId, expectedId);
                assert.equal(
                    ability.actorActionProfileFingerprint,
                    expectedProfileFingerprintByActionCode.get(
                        ability.actionCode
                    )
                );
            }
        }
    }
    assert.equal(compiler.getCacheSize(), 16);
});

test('The Towers merge는 Payload 없이 별도 immutable group-operation으로 compile된다', () => {
    const compiler = new SentenceCompiler();
    const ability = compiler.compile(R6_TOWERS_MERGE_SENTENCE);
    assert.strictEqual(compiler.compile(R6_TOWERS_MERGE_SENTENCE), ability);
    assert.equal(
        ability.compiledAbilityId,
        'compiled-ability.r6:word.entity.tower:verb.merge:'
            + 'tower-group-operation.merge.v1:abi1'
    );
    assert.equal(ability.actionCode, SENTENCE_ACTION_CODE.MERGE);
    assert.equal(ability.operationKind, TOWER_GROUP_OPERATION_KIND.MERGE);
    assert.equal(
        ability.groupOperationProfileId,
        TOWER_GROUP_OPERATION_PROFILE_ID.MERGE
    );
    assert.strictEqual(
        ability.groupOperationProfile,
        R6_TOWER_MERGE_GROUP_OPERATION_PROFILE
    );
    assert.equal(
        ability.subjectSelector.code,
        SUBJECT_SELECTOR_CODE.TOWER
    );
    assert.equal(ability.subjectSelector.snapshotPolicy, 'execution-start');
    assert.equal(
        ability.subjectSelectionPolicy,
        TOWER_GROUP_SUBJECT_SELECTION_POLICY.ALL_LIVING_TOWERS
    );
    assert.equal(
        ability.payloadRequirement,
        SENTENCE_PAYLOAD_REQUIREMENT.FORBIDDEN
    );
    assert.equal(ability.payloadAbsent, true);
    assert.equal(ability.payloadCode, null);
    assert.equal(ability.payloadDefinitionId, null);
    assert.equal(ability.executionPolicy.atomic, true);
    assert.equal(ability.generatedBodyCount, 0);
    assert.equal(ability.budgets.generatedBodyCount, 0);
    assert.equal(ability.cooldownTicks, 1);
    assert.equal(ability.budgets.subjectCount, 1000);
    assert.deepEqual(ability.authorities, {
        cooldown: TOWER_GROUP_OPERATION_AUTHORITY.WORD_PROTOCOL,
        subjectBudget: TOWER_GROUP_OPERATION_AUTHORITY.WORD_PROTOCOL,
        generatedBodyBudget:
            TOWER_GROUP_OPERATION_AUTHORITY.PROFILE_FIXED_ZERO
    });
    assert.equal(ability.runtimeSupport, WORD_RUNTIME_SUPPORT.R6);
    assert.equal(
        ability.runtimeAvailability,
        SENTENCE_RUNTIME_AVAILABILITY.RUNTIME_UNAVAILABLE
    );
    assert.equal(Object.hasOwn(ability, 'actorActionProfile'), false);
    assert.equal(Object.hasOwn(ability, 'actorActionProfileId'), false);
    assert.doesNotMatch(
        JSON.stringify(ability.groupOperationProfile),
        /spawnAnchor|placementPolicy|transit/
    );
    assertDeepFrozen(ability);
});

test('Payload null 허용은 Merge FORBIDDEN contract에만 한정되고 modifier는 계속 범위 밖이다', () => {
    const compiler = new SentenceCompiler();
    assert.equal(
        compiler.tryCompile({
            ...R6_TOWERS_MERGE_SENTENCE,
            payloadWordInstanceId: R3_TOWER_WORD_INSTANCE.id
        }).code,
        SENTENCE_COMPILE_ERROR_CODE.PAYLOAD_FORBIDDEN
    );
    for (const payloadWordInstanceId of [null, '', undefined]) {
        assert.equal(
            compiler.tryCompile({
                id: `sentence.r6.required-payload.${String(payloadWordInstanceId)}`,
                subjectWordInstanceId: R3_TOWER_WORD_INSTANCE.id,
                verbWordInstanceId: R3_SHOOT_WORD_INSTANCE.id,
                payloadWordInstanceId,
                modifierWordInstanceIds: []
            }).code,
            SENTENCE_COMPILE_ERROR_CODE.MISSING_SLOT
        );
    }
    assert.equal(
        compiler.tryCompile({
            ...R6_TOWERS_MERGE_SENTENCE,
            modifierWordInstanceIds: ['word-instance.modifier.out-of-scope']
        }).code,
        SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_MODIFIER
    );
    assert.equal(
        compiler.tryCompile({
            ...R6_TOWERS_MERGE_SENTENCE,
            subjectWordInstanceId: R3_ENEMY_WORD_INSTANCE.id
        }).code,
        SENTENCE_COMPILE_ERROR_CODE.WRONG_WORD_KIND
    );
    assert.throws(() => normalizeSentenceDefinition({
        ...R6_TOWERS_MERGE_SENTENCE
    }), /payloadWordInstanceId/);
});

test('R6 catalog/loadout은 immutable injection-only이고 activation은 명시적 RUNTIME_UNAVAILABLE다', () => {
    assert.equal(
        MERGE_VERB_WORD_DEFINITION.payloadRequirement,
        SENTENCE_PAYLOAD_REQUIREMENT.FORBIDDEN
    );
    assert.equal(R6_MERGE_WORD_INSTANCE.definitionId, WORD_DEFINITION_ID.MERGE);
    assert.strictEqual(
        R6_SENTENCE_DEFINITION_BY_ID[R6_TOWERS_MERGE_SENTENCE.id],
        R6_TOWERS_MERGE_SENTENCE
    );
    assert.equal(R6_TOWERS_MERGE_SENTENCE.payloadWordInstanceId, null);
    assert.notStrictEqual(R6_QA_SENTENCE_LOADOUT, R5_SHOWCASE_SENTENCE_LOADOUT);
    assert.notStrictEqual(
        R5_SHOWCASE_SENTENCE_LOADOUT[ABILITY_SLOT_ID.SHIFT],
        R6_TOWERS_MERGE_SENTENCE
    );
    assert.strictEqual(
        R6_QA_SENTENCE_LOADOUT[ABILITY_SLOT_ID.SHIFT],
        R6_TOWERS_MERGE_SENTENCE
    );
    assertDeepFrozen(R6_WORD_DEFINITIONS);
    assertDeepFrozen(R6_WORD_INSTANCES);
    assertDeepFrozen(R6_SENTENCE_DEFINITION_BY_ID);
    assertDeepFrozen(R6_QA_SENTENCE_LOADOUT);

    const wordSystem = new WordSystem({
        loadout: {
            [ABILITY_SLOT_ID.SHIFT]: R6_TOWERS_MERGE_SENTENCE.id
        }
    });
    wordSystem.beginFixedTick(7);
    assert.equal(wordSystem.hasCompiledAbility(ABILITY_SLOT_ID.SHIFT), true);
    const result = wordSystem.requestSlotActivation(ABILITY_SLOT_ID.SHIFT, {
        targetFixedTick: 7
    });
    assert.equal(result.accepted, false);
    assert.equal(result.code,
        ABILITY_ACTIVATION_RESULT_CODE.RUNTIME_UNAVAILABLE);
    assert.equal(result.reason, 'RUNTIME_UNAVAILABLE');
    assert.equal(wordSystem.drainActivationRequests().length, 0);
    assert.equal(
        wordSystem.getSlotView(ABILITY_SLOT_ID.SHIFT)
            .cooldown.remainingTicks,
        0
    );
    wordSystem.destroy();
});
