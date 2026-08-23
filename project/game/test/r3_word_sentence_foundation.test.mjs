import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ACTOR_PAYLOAD_CODE,
    ABILITY_SLOT_ID,
    ABILITY_SLOT_IDS,
    SENTENCE_ACTION_CODE,
    SENTENCE_COMPILE_ERROR_CODE,
    SENTENCE_RUNTIME_PHASE,
    SUBJECT_SELECTOR_CODE,
    WORD_DEFINITION_ID,
    WORD_GRAMMATICAL_ROLE,
    WORD_KIND,
    WORD_RUNTIME_SUPPORT,
    isFixedHostileEnemyPayload,
    normalizeSentenceDefinition,
    normalizeWordDefinition
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');
const {
    BASIC_CIRCLE_ENEMY_DATA
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    ENEMY_ENTITY_WORD_DEFINITION,
    R3_ENEMIES_SHOOT_ENEMIES_SENTENCE,
    R3_SENTENCE_DEFINITION_BY_ID,
    R3_SHOOT_WORD_INSTANCE,
    R3_TOWER_SHOOTS_ENEMY_SENTENCE,
    R3_TOWER_WORD_INSTANCE,
    R3_WORD_DEFINITION_BY_ID,
    R3_WORD_DEFINITIONS,
    R3_WORD_INSTANCE_BY_ID,
    SHOOT_VERB_WORD_DEFINITION,
    TOWER_ENTITY_WORD_DEFINITION
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    SentenceCompiler
} = await loadGameModule('ingame/word/sentence_compiler.js');
const {
    ABILITY_ACTIVATION_RESULT_CODE,
    WordSystem
} = await loadGameModule('ingame/word/word_system.js');
const {
    SentenceSlotController
} = await loadGameModule('ingame/word/sentence_slot_controller.js');
const {
    INPUT_DISPOSITIONS,
    PLAYER_ACTION_TYPES
} = await loadGameModule('ingame/contract/player_controllable_contract.js');

function assertDeepFrozen(value, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) {
        return;
    }
    visited.add(value);
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
        assertDeepFrozen(child, visited);
    }
}

test('R3 stable WordDefinition/WordInstance와 Enemy normal catalog metadata가 고정된다', () => {
    assert.deepEqual({ ...WORD_DEFINITION_ID }, {
        TOWER: 'word.entity.tower',
        ENEMY: 'word.entity.enemy',
        SHOOT: 'verb.shoot',
        THROW: 'verb.throw',
        EMIT: 'verb.emit',
        SUMMON: 'verb.summon',
        MERGE: 'verb.merge'
    });
    assert.equal(R3_TOWER_WORD_INSTANCE.definitionId, WORD_DEFINITION_ID.TOWER);
    assert.equal(R3_SHOOT_WORD_INSTANCE.definitionId, WORD_DEFINITION_ID.SHOOT);
    assert.equal(ENEMY_ENTITY_WORD_DEFINITION.shopEligible, true);
    assert.equal(ENEMY_ENTITY_WORD_DEFINITION.kind, WORD_KIND.ENTITY);
    assert.deepEqual(Array.from(ENEMY_ENTITY_WORD_DEFINITION.roles), [
        WORD_GRAMMATICAL_ROLE.SUBJECT,
        WORD_GRAMMATICAL_ROLE.PAYLOAD
    ]);
    assert.equal(
        ENEMY_ENTITY_WORD_DEFINITION.subject.selectorCode,
        SUBJECT_SELECTOR_CODE.ENEMY
    );
    assert.equal(
        ENEMY_ENTITY_WORD_DEFINITION.subject.teamId,
        GAMEPLAY_TEAM_ID.HOSTILE
    );
    assert.equal(
        ENEMY_ENTITY_WORD_DEFINITION.payload.payloadCode,
        ACTOR_PAYLOAD_CODE.ENEMY
    );
    assert.equal(
        ENEMY_ENTITY_WORD_DEFINITION.payload.definitionId,
        BASIC_CIRCLE_ENEMY_DATA.id
    );
    assert.equal(
        ENEMY_ENTITY_WORD_DEFINITION.payload.allegiancePolicy,
        GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE
    );
    assert.equal(isFixedHostileEnemyPayload(ENEMY_ENTITY_WORD_DEFINITION), true);
    assert.equal(
        TOWER_ENTITY_WORD_DEFINITION.payload.runtimeSupport,
        WORD_RUNTIME_SUPPORT.R5
    );
    assert.equal(SHOOT_VERB_WORD_DEFINITION.actionCode, SENTENCE_ACTION_CODE.SHOOT);
    assertDeepFrozen(R3_WORD_DEFINITIONS);
    assertDeepFrozen(R3_SENTENCE_DEFINITION_BY_ID);
});

test('SentenceCompiler는 두 R3 문장을 compile하고 cache replay에서 같은 immutable ability를 반환한다', () => {
    const compiler = new SentenceCompiler();
    const towerAbility = compiler.compile(R3_TOWER_SHOOTS_ENEMY_SENTENCE);
    const towerReplay = compiler.compile(R3_TOWER_SHOOTS_ENEMY_SENTENCE);
    const enemyAbility = compiler.compile(R3_ENEMIES_SHOOT_ENEMIES_SENTENCE);

    assert.strictEqual(towerReplay, towerAbility);
    assert.equal(compiler.getCacheSize(), 2);
    assert.equal(towerAbility.subjectSelector.code, SUBJECT_SELECTOR_CODE.TOWER);
    assert.equal(enemyAbility.subjectSelector.code, SUBJECT_SELECTOR_CODE.ENEMY);
    assert.equal(enemyAbility.actionCode, SENTENCE_ACTION_CODE.SHOOT);
    assert.equal(enemyAbility.payloadCode, ACTOR_PAYLOAD_CODE.ENEMY);
    assert.equal(enemyAbility.payloadDefinitionId, BASIC_CIRCLE_ENEMY_DATA.id);
    assert.equal(enemyAbility.allegiancePolicy, GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE);
    assert.equal(enemyAbility.executionPolicy.atomic, true);
    assert.equal(
        enemyAbility.executionPolicy.generatedSubjectsJoinCurrentExecution,
        false
    );
    assert.equal(enemyAbility.budgets.subjectCount, 1000);
    assertDeepFrozen(towerAbility);
    assertDeepFrozen(enemyAbility);
    assert.doesNotMatch(
        JSON.stringify(enemyAbility),
        /harmful|suicide|exploit|recommended/i
    );
});

test('localized singular/plural display 변경은 compiler semantic identity를 바꾸지 않는다', () => {
    const localizedDefinitions = R3_WORD_DEFINITIONS.map((definition) => (
        normalizeWordDefinition({
            ...definition,
            display: {
                test: {
                    singular: `${definition.id}.one`,
                    plural: `${definition.id}.many`
                }
            }
        })
    ));
    const localizedCompiler = new SentenceCompiler({
        wordDefinitionsById: Object.freeze(Object.fromEntries(
            localizedDefinitions.map((definition) => [definition.id, definition])
        )),
        wordInstancesById: R3_WORD_INSTANCE_BY_ID
    });
    const canonicalCompiler = new SentenceCompiler();
    assert.equal(
        localizedCompiler.compile(R3_ENEMIES_SHOOT_ENEMIES_SENTENCE)
            .compiledAbilityId,
        canonicalCompiler.compile(R3_ENEMIES_SHOOT_ENEMIES_SENTENCE)
            .compiledAbilityId
    );
});

test('Tower Payload는 R5 typed plan이고 modifier/missing/Shop은 정확한 이유로 거절된다', () => {
    const compiler = new SentenceCompiler();
    const towerPayload = normalizeSentenceDefinition({
        id: 'sentence.r5.tower-shoots-tower.typed',
        subjectWordInstanceId: R3_TOWER_SHOOTS_ENEMY_SENTENCE.subjectWordInstanceId,
        verbWordInstanceId: R3_TOWER_SHOOTS_ENEMY_SENTENCE.verbWordInstanceId,
        payloadWordInstanceId: R3_TOWER_WORD_INSTANCE.id,
        modifierWordInstanceIds: []
    });
    const towerPayloadResult = compiler.tryCompile(towerPayload);
    assert.equal(towerPayloadResult.valid, true);
    assert.equal(towerPayloadResult.compiledAbility.payloadCode,
        ACTOR_PAYLOAD_CODE.TOWER);
    assert.equal(
        compiler.tryCompile({
            ...R3_TOWER_SHOOTS_ENEMY_SENTENCE,
            id: 'sentence.r3.modifier.unsupported',
            modifierWordInstanceIds: ['word-instance.modifier.unknown']
        }).code,
        SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_MODIFIER
    );
    assert.equal(
        compiler.tryCompile({
            ...R3_TOWER_SHOOTS_ENEMY_SENTENCE,
            id: 'sentence.r3.missing',
            payloadWordInstanceId: ''
        }).code,
        SENTENCE_COMPILE_ERROR_CODE.MISSING_SLOT
    );
    assert.equal(
        compiler.tryCompile(R3_TOWER_SHOOTS_ENEMY_SENTENCE, {
            executionPhase: SENTENCE_RUNTIME_PHASE.SHOP
        }).code,
        SENTENCE_COMPILE_ERROR_CODE.INVALID_PHASE
    );
});

test('WordSystem은 5개 slot과 bounded immutable view를 제공하고 cooldown 전 semantic request만 만든다', () => {
    const wordSystem = new WordSystem({
        loadout: {
            [ABILITY_SLOT_ID.Q]: R3_TOWER_SHOOTS_ENEMY_SENTENCE,
            [ABILITY_SLOT_ID.E]: R3_ENEMIES_SHOOT_ENEMIES_SENTENCE
        }
    });
    const views = wordSystem.getSlotViews();
    assert.deepEqual(views.map(({ slotId }) => slotId), Array.from(ABILITY_SLOT_IDS));
    assert.equal(views[0].structuralValidity.code, 'EMPTY_SLOT');
    assert.equal(
        wordSystem.getSlotView(ABILITY_SLOT_ID.Q).structuralValidity.valid,
        true
    );
    assertDeepFrozen(views);

    wordSystem.beginFixedTick(7);
    const requested = wordSystem.requestSlotActivation(ABILITY_SLOT_ID.Q);
    assert.equal(requested.code, ABILITY_ACTIVATION_RESULT_CODE.REQUESTED);
    assert.equal(wordSystem.getSlotView(ABILITY_SLOT_ID.Q).cooldown.remainingTicks, 0);
    const duplicate = wordSystem.requestSlotActivation(ABILITY_SLOT_ID.Q);
    assert.equal(duplicate.code, ABILITY_ACTIVATION_RESULT_CODE.DUPLICATE);
    const drained = wordSystem.drainActivationRequests();
    assert.equal(drained.length, 1);
    assert.equal(drained[0].slotId, ABILITY_SLOT_ID.Q);
    assertDeepFrozen(drained);

    wordSystem.setRuntimePhase(SENTENCE_RUNTIME_PHASE.PAUSE);
    assert.equal(
        wordSystem.requestSlotActivation(ABILITY_SLOT_ID.E).code,
        ABILITY_ACTIVATION_RESULT_CODE.WRONG_PHASE
    );
    assert.equal(wordSystem.drainActivationRequests().length, 0);
    wordSystem.destroy();
});

test('SentenceSlotController는 PRIMARY empty compatibility를 보존하고 assigned primary는 한 edge만 요청한다', () => {
    const emptySystem = new WordSystem();
    const emptyController = new SentenceSlotController(emptySystem);
    emptySystem.beginFixedTick(1);
    assert.equal(
        emptyController.handlePlayerAction({
            type: PLAYER_ACTION_TYPES.PRIMARY_POINTER_FIRE,
            payload: { pressed: true }
        }),
        INPUT_DISPOSITIONS.PASS
    );
    assert.equal(emptySystem.drainActivationRequests().length, 0);
    emptyController.destroy();
    emptySystem.destroy();

    const assignedSystem = new WordSystem({
        loadout: {
            [ABILITY_SLOT_ID.PRIMARY_POINTER]:
                R3_TOWER_SHOOTS_ENEMY_SENTENCE
        }
    });
    const assignedController = new SentenceSlotController(assignedSystem);
    assignedSystem.beginFixedTick(1);
    for (const pressed of [true, true, false]) {
        assert.equal(
            assignedController.handlePlayerAction({
                type: PLAYER_ACTION_TYPES.PRIMARY_POINTER_FIRE,
                payload: { pressed }
            }),
            INPUT_DISPOSITIONS.CONSUMED
        );
    }
    assert.equal(assignedSystem.drainActivationRequests().length, 1);
    assignedController.destroy();
    assignedSystem.destroy();
});
