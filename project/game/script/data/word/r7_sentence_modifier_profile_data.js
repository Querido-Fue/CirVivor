import {
    MODIFIER_APPLICATION_PHASE,
    MODIFIER_PROFILE_ABI_VERSION,
    MODIFIER_PROFILE_ID,
    MODIFIER_SCOPE,
    MODIFIER_STACKING_POLICY,
    normalizeModifierProfile
} from 'ingame/contract/sentence_modifier_contract.js';
import {
    ACTOR_PAYLOAD_CODE,
    SENTENCE_ACTION_CODE,
    SENTENCE_MODIFIER_CODE
} from 'ingame/contract/word_sentence_contract.js';

export const R7_TWICE_MODIFIER_PROFILE = normalizeModifierProfile({
    abiVersion: MODIFIER_PROFILE_ABI_VERSION,
    id: MODIFIER_PROFILE_ID.TWICE,
    modifierCode: SENTENCE_MODIFIER_CODE.TWICE,
    applicationPhase: MODIFIER_APPLICATION_PHASE.EXECUTION_CARDINALITY,
    scope: MODIFIER_SCOPE.ACTOR_ACTION,
    stackingPolicy: MODIFIER_STACKING_POLICY.MULTIPLY,
    factorNumerator: 2,
    factorDenominator: 1,
    maxStacks: 3,
    priority: 100,
    supportedActionCodes: [
        SENTENCE_ACTION_CODE.SHOOT,
        SENTENCE_ACTION_CODE.THROW,
        SENTENCE_ACTION_CODE.EMIT,
        SENTENCE_ACTION_CODE.SUMMON
    ],
    supportedPayloadCodes: [
        ACTOR_PAYLOAD_CODE.ENEMY,
        ACTOR_PAYLOAD_CODE.TOWER
    ],
    conflictGroup: null,
    persistentOnSpawnedActor: false
}, 'R7 twice modifier profile');

export const R7_SENTENCE_MODIFIER_PROFILES = Object.freeze([
    R7_TWICE_MODIFIER_PROFILE
]);

export const R7_SENTENCE_MODIFIER_PROFILE_BY_ID = Object.freeze(
    Object.fromEntries(R7_SENTENCE_MODIFIER_PROFILES.map((profile) => (
        [profile.id, profile]
    )))
);

export const R7_SENTENCE_MODIFIER_PROFILE_BY_CODE = Object.freeze(
    Object.fromEntries(R7_SENTENCE_MODIFIER_PROFILES.map((profile) => (
        [profile.modifierCode, profile]
    )))
);
