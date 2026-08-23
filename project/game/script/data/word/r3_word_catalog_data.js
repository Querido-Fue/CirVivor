import {
    BASIC_CIRCLE_ENEMY_DATA
} from 'data/object/enemy/basic_circle_enemy_data.js';
import {
    THE_TOWER_DEFINITION_ID
} from 'data/object/tower/the_tower_data.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} from 'ingame/contract/gameplay_team_contract.js';
import {
    ACTOR_PAYLOAD_CODE,
    ABILITY_SLOT_ID,
    GAMEPLAY_NOUN_MASK,
    SENTENCE_ACTION_CODE,
    SENTENCE_PAYLOAD_REQUIREMENT,
    SUBJECT_SELECTOR_CODE,
    WORD_DEFINITION_ID,
    WORD_GRAMMATICAL_ROLE,
    WORD_KIND,
    WORD_RUNTIME_SUPPORT,
    normalizeSentenceDefinition,
    normalizeWordDefinition,
    normalizeWordInstance
} from 'ingame/contract/word_sentence_contract.js';

export const R3_WORD_PROTOCOL_DATA = Object.freeze({
    abiVersion: 1,
    cooldownTicks: 1,
    subjectBudget: 1000,
    generatedBodyBudget: 1000,
    generationLimit: 65535,
    previewFormulaId: 'preview.actor-payload.enemy.v1'
});

/** R5 typed compiler가 R3 GPU command budgets/ABI를 append-only로 계승합니다. */
export const R5_WORD_PROTOCOL_DATA = R3_WORD_PROTOCOL_DATA;

/** R6 group operation은 기존 cooldown/Subject budget ABI를 그대로 사용합니다. */
export const R6_WORD_PROTOCOL_DATA = R5_WORD_PROTOCOL_DATA;

export const TOWER_ENTITY_WORD_DEFINITION = normalizeWordDefinition({
    id: WORD_DEFINITION_ID.TOWER,
    kind: WORD_KIND.ENTITY,
    roles: [
        WORD_GRAMMATICAL_ROLE.SUBJECT,
        WORD_GRAMMATICAL_ROLE.PAYLOAD
    ],
    display: {
        english: { singular: 'The Tower', plural: 'The Towers' },
        korean: { singular: '타워', plural: '타워들' }
    },
    shopEligible: true,
    subject: {
        selectorCode: SUBJECT_SELECTOR_CODE.TOWER,
        nounMask: GAMEPLAY_NOUN_MASK.TOWER,
        teamId: GAMEPLAY_TEAM_ID.PLAYER
    },
    payload: {
        payloadCode: ACTOR_PAYLOAD_CODE.TOWER,
        definitionId: THE_TOWER_DEFINITION_ID,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.FIXED_PLAYER,
        runtimeSupport: WORD_RUNTIME_SUPPORT.R5,
        previewFormulaId: 'preview.actor-payload.tower.v1'
    },
    actionCode: null
});

export const ENEMY_ENTITY_WORD_DEFINITION = normalizeWordDefinition({
    id: WORD_DEFINITION_ID.ENEMY,
    kind: WORD_KIND.ENTITY,
    roles: [
        WORD_GRAMMATICAL_ROLE.SUBJECT,
        WORD_GRAMMATICAL_ROLE.PAYLOAD
    ],
    display: {
        english: { singular: 'Enemy', plural: 'Enemies' },
        korean: { singular: '적', plural: '적들' }
    },
    shopEligible: true,
    subject: {
        selectorCode: SUBJECT_SELECTOR_CODE.ENEMY,
        nounMask: GAMEPLAY_NOUN_MASK.ENEMY,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE
    },
    payload: {
        payloadCode: ACTOR_PAYLOAD_CODE.ENEMY,
        definitionId: BASIC_CIRCLE_ENEMY_DATA.id,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE,
        runtimeSupport: WORD_RUNTIME_SUPPORT.R3,
        previewFormulaId: R3_WORD_PROTOCOL_DATA.previewFormulaId
    },
    actionCode: null
});

export const SHOOT_VERB_WORD_DEFINITION = normalizeWordDefinition({
    id: WORD_DEFINITION_ID.SHOOT,
    kind: WORD_KIND.VERB,
    roles: [],
    display: {
        english: { singular: 'shoots', plural: 'shoot' },
        korean: { singular: '발사한다', plural: '발사한다' }
    },
    shopEligible: true,
    subject: null,
    payload: null,
    actionCode: SENTENCE_ACTION_CODE.SHOOT,
    payloadRequirement: SENTENCE_PAYLOAD_REQUIREMENT.REQUIRED
});

export const THROW_VERB_WORD_DEFINITION = normalizeWordDefinition({
    id: WORD_DEFINITION_ID.THROW,
    kind: WORD_KIND.VERB,
    roles: [],
    display: {
        english: { singular: 'throws', plural: 'throw' },
        korean: { singular: '던진다', plural: '던진다' }
    },
    shopEligible: true,
    subject: null,
    payload: null,
    actionCode: SENTENCE_ACTION_CODE.THROW,
    payloadRequirement: SENTENCE_PAYLOAD_REQUIREMENT.REQUIRED
});

export const EMIT_VERB_WORD_DEFINITION = normalizeWordDefinition({
    id: WORD_DEFINITION_ID.EMIT,
    kind: WORD_KIND.VERB,
    roles: [],
    display: {
        english: { singular: 'emits', plural: 'emit' },
        korean: { singular: '방출한다', plural: '방출한다' }
    },
    shopEligible: true,
    subject: null,
    payload: null,
    actionCode: SENTENCE_ACTION_CODE.EMIT,
    payloadRequirement: SENTENCE_PAYLOAD_REQUIREMENT.REQUIRED
});

export const SUMMON_VERB_WORD_DEFINITION = normalizeWordDefinition({
    id: WORD_DEFINITION_ID.SUMMON,
    kind: WORD_KIND.VERB,
    roles: [],
    display: {
        english: { singular: 'summons', plural: 'summon' },
        korean: { singular: '소환한다', plural: '소환한다' }
    },
    shopEligible: true,
    subject: null,
    payload: null,
    actionCode: SENTENCE_ACTION_CODE.SUMMON,
    payloadRequirement: SENTENCE_PAYLOAD_REQUIREMENT.REQUIRED
});

export const MERGE_VERB_WORD_DEFINITION = normalizeWordDefinition({
    id: WORD_DEFINITION_ID.MERGE,
    kind: WORD_KIND.VERB,
    roles: [],
    display: {
        english: { singular: 'merges', plural: 'merge' },
        korean: { singular: '합친다', plural: '합친다' }
    },
    shopEligible: true,
    subject: null,
    payload: null,
    actionCode: SENTENCE_ACTION_CODE.MERGE,
    payloadRequirement: SENTENCE_PAYLOAD_REQUIREMENT.FORBIDDEN
});

export const R3_WORD_DEFINITIONS = Object.freeze([
    TOWER_ENTITY_WORD_DEFINITION,
    ENEMY_ENTITY_WORD_DEFINITION,
    SHOOT_VERB_WORD_DEFINITION
]);

export const R3_WORD_DEFINITION_BY_ID = Object.freeze(Object.fromEntries(
    R3_WORD_DEFINITIONS.map((definition) => [definition.id, definition])
));

export const R5_WORD_DEFINITIONS = Object.freeze([
    ...R3_WORD_DEFINITIONS,
    THROW_VERB_WORD_DEFINITION,
    EMIT_VERB_WORD_DEFINITION,
    SUMMON_VERB_WORD_DEFINITION
]);

export const R5_WORD_DEFINITION_BY_ID = Object.freeze(Object.fromEntries(
    R5_WORD_DEFINITIONS.map((definition) => [definition.id, definition])
));

export const R6_WORD_DEFINITIONS = Object.freeze([
    ...R5_WORD_DEFINITIONS,
    MERGE_VERB_WORD_DEFINITION
]);

export const R6_WORD_DEFINITION_BY_ID = Object.freeze(Object.fromEntries(
    R6_WORD_DEFINITIONS.map((definition) => [definition.id, definition])
));

/** R8 shop transaction 전에도 normal offer semantics를 공유하는 bounded catalog view입니다. */
export const R3_ENEMY_WORD_OFFER_METADATA = Object.freeze({
    wordDefinitionId: ENEMY_ENTITY_WORD_DEFINITION.id,
    wordKind: 'Entity Word',
    roles: ENEMY_ENTITY_WORD_DEFINITION.roles,
    shopEligible: ENEMY_ENTITY_WORD_DEFINITION.shopEligible,
    subjectSelectorCode:
        ENEMY_ENTITY_WORD_DEFINITION.subject.selectorCode,
    payloadCode: ENEMY_ENTITY_WORD_DEFINITION.payload.payloadCode,
    payloadDefinitionId:
        ENEMY_ENTITY_WORD_DEFINITION.payload.definitionId,
    payloadTeamId: GAMEPLAY_TEAM_ID.HOSTILE,
    payloadAllegiancePolicy:
        GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE,
    bountyPolicy: 'DEFINITION_RESOLVED_ORDINARY_ENEMY',
    countsTowardHostile: true,
    countsTowardSiege: true,
    runtimePreviewFormulaId: R3_WORD_PROTOCOL_DATA.previewFormulaId
});

export const R3_WORD_OFFER_CATALOG = Object.freeze([
    R3_ENEMY_WORD_OFFER_METADATA
]);

export const R3_TOWER_WORD_INSTANCE = normalizeWordInstance({
    id: 'word-instance.r3.tower',
    definitionId: WORD_DEFINITION_ID.TOWER
});

export const R3_ENEMY_WORD_INSTANCE = normalizeWordInstance({
    id: 'word-instance.r3.enemy',
    definitionId: WORD_DEFINITION_ID.ENEMY
});

export const R3_SHOOT_WORD_INSTANCE = normalizeWordInstance({
    id: 'word-instance.r3.shoot',
    definitionId: WORD_DEFINITION_ID.SHOOT
});

export const R5_THROW_WORD_INSTANCE = normalizeWordInstance({
    id: 'word-instance.r5.throw',
    definitionId: WORD_DEFINITION_ID.THROW
});

export const R5_EMIT_WORD_INSTANCE = normalizeWordInstance({
    id: 'word-instance.r5.emit',
    definitionId: WORD_DEFINITION_ID.EMIT
});

export const R5_SUMMON_WORD_INSTANCE = normalizeWordInstance({
    id: 'word-instance.r5.summon',
    definitionId: WORD_DEFINITION_ID.SUMMON
});

export const R6_MERGE_WORD_INSTANCE = normalizeWordInstance({
    id: 'word-instance.r6.merge',
    definitionId: WORD_DEFINITION_ID.MERGE
});

export const R3_WORD_INSTANCES = Object.freeze([
    R3_TOWER_WORD_INSTANCE,
    R3_ENEMY_WORD_INSTANCE,
    R3_SHOOT_WORD_INSTANCE
]);

export const R3_WORD_INSTANCE_BY_ID = Object.freeze(Object.fromEntries(
    R3_WORD_INSTANCES.map((instance) => [instance.id, instance])
));

export const R5_WORD_INSTANCES = Object.freeze([
    ...R3_WORD_INSTANCES,
    R5_THROW_WORD_INSTANCE,
    R5_EMIT_WORD_INSTANCE,
    R5_SUMMON_WORD_INSTANCE
]);

export const R5_WORD_INSTANCE_BY_ID = Object.freeze(Object.fromEntries(
    R5_WORD_INSTANCES.map((instance) => [instance.id, instance])
));

export const R6_WORD_INSTANCES = Object.freeze([
    ...R5_WORD_INSTANCES,
    R6_MERGE_WORD_INSTANCE
]);

export const R6_WORD_INSTANCE_BY_ID = Object.freeze(Object.fromEntries(
    R6_WORD_INSTANCES.map((instance) => [instance.id, instance])
));

export const R3_TOWER_SHOOTS_ENEMY_SENTENCE = normalizeSentenceDefinition({
    id: 'sentence.r3.tower-shoots-enemy',
    subjectWordInstanceId: R3_TOWER_WORD_INSTANCE.id,
    verbWordInstanceId: R3_SHOOT_WORD_INSTANCE.id,
    payloadWordInstanceId: R3_ENEMY_WORD_INSTANCE.id,
    modifierWordInstanceIds: []
});

export const R3_ENEMIES_SHOOT_ENEMIES_SENTENCE = normalizeSentenceDefinition({
    id: 'sentence.r3.enemies-shoot-enemies',
    subjectWordInstanceId: R3_ENEMY_WORD_INSTANCE.id,
    verbWordInstanceId: R3_SHOOT_WORD_INSTANCE.id,
    payloadWordInstanceId: R3_ENEMY_WORD_INSTANCE.id,
    modifierWordInstanceIds: []
});

export const R3_SENTENCE_DEFINITIONS = Object.freeze([
    R3_TOWER_SHOOTS_ENEMY_SENTENCE,
    R3_ENEMIES_SHOOT_ENEMIES_SENTENCE
]);

export const R3_SENTENCE_DEFINITION_BY_ID = Object.freeze(Object.fromEntries(
    R3_SENTENCE_DEFINITIONS.map((sentence) => [sentence.id, sentence])
));

export const R5_TOWER_SHOOTS_TOWER_SENTENCE = normalizeSentenceDefinition({
    id: 'sentence.r5.tower-shoots-tower',
    subjectWordInstanceId: R3_TOWER_WORD_INSTANCE.id,
    verbWordInstanceId: R3_SHOOT_WORD_INSTANCE.id,
    payloadWordInstanceId: R3_TOWER_WORD_INSTANCE.id,
    modifierWordInstanceIds: []
});

export const R5_ENEMIES_SHOOT_TOWER_SENTENCE = normalizeSentenceDefinition({
    id: 'sentence.r5.enemies-shoot-tower',
    subjectWordInstanceId: R3_ENEMY_WORD_INSTANCE.id,
    verbWordInstanceId: R3_SHOOT_WORD_INSTANCE.id,
    payloadWordInstanceId: R3_TOWER_WORD_INSTANCE.id,
    modifierWordInstanceIds: []
});

export const R5_SENTENCE_DEFINITIONS = Object.freeze([
    ...R3_SENTENCE_DEFINITIONS,
    R5_TOWER_SHOOTS_TOWER_SENTENCE,
    R5_ENEMIES_SHOOT_TOWER_SENTENCE
]);

export const R5_SENTENCE_DEFINITION_BY_ID = Object.freeze(Object.fromEntries(
    R5_SENTENCE_DEFINITIONS.map((sentence) => [sentence.id, sentence])
));

export const R6_TOWERS_MERGE_SENTENCE = normalizeSentenceDefinition({
    id: 'sentence.r6.towers-merge',
    subjectWordInstanceId: R3_TOWER_WORD_INSTANCE.id,
    verbWordInstanceId: R6_MERGE_WORD_INSTANCE.id,
    payloadWordInstanceId: null,
    modifierWordInstanceIds: []
}, 'R6 Towers Merge sentence', {
    payloadRequirement: SENTENCE_PAYLOAD_REQUIREMENT.FORBIDDEN
});

export const R6_SENTENCE_DEFINITIONS = Object.freeze([
    ...R5_SENTENCE_DEFINITIONS,
    R6_TOWERS_MERGE_SENTENCE
]);

export const R6_SENTENCE_DEFINITION_BY_ID = Object.freeze(Object.fromEntries(
    R6_SENTENCE_DEFINITIONS.map((sentence) => [sentence.id, sentence])
));

/** Production showcase에서만 주입하는 R3 문장 loadout입니다. */
export const R3_SHOWCASE_SENTENCE_LOADOUT = Object.freeze({
    [ABILITY_SLOT_ID.Q]: R3_TOWER_SHOOTS_ENEMY_SENTENCE,
    [ABILITY_SLOT_ID.E]: R3_ENEMIES_SHOOT_ENEMIES_SENTENCE
});

/** Turn 4 production vertical slice의 SHIFT/SPACE Shoot + R3 호환 loadout입니다. */
export const R5_SHOWCASE_SENTENCE_LOADOUT = Object.freeze({
    [ABILITY_SLOT_ID.SHIFT]: R5_TOWER_SHOOTS_TOWER_SENTENCE,
    [ABILITY_SLOT_ID.SPACE]: R5_ENEMIES_SHOOT_TOWER_SENTENCE,
    [ABILITY_SLOT_ID.Q]: R3_TOWER_SHOOTS_ENEMY_SENTENCE,
    [ABILITY_SLOT_ID.E]: R3_ENEMIES_SHOOT_ENEMIES_SENTENCE
});

/** Production key binding과 분리된 actual GameScene R6 QA 주입용 loadout입니다. */
export const R6_QA_SENTENCE_LOADOUT = Object.freeze({
    [ABILITY_SLOT_ID.SHIFT]: R6_TOWERS_MERGE_SENTENCE,
    [ABILITY_SLOT_ID.Q]: R3_TOWER_SHOOTS_ENEMY_SENTENCE,
    [ABILITY_SLOT_ID.E]: R3_ENEMIES_SHOOT_ENEMIES_SENTENCE
});
