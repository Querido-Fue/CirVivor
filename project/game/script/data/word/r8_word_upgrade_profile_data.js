import {
    WORD_UPGRADE_PROFILE_ABI_VERSION,
    normalizeWordUpgradeProfile
} from 'ingame/contract/word_upgrade_contract.js';
import { WORD_DEFINITION_ID } from 'ingame/contract/word_sentence_contract.js';

export const R8_WORD_UPGRADE_PROFILE_ID = Object.freeze({
    TWICE: 'word-upgrade.twice.v1'
});

export const R8_TWICE_UPGRADE_COST = Object.freeze({
    LEVEL_0_TO_1: 5,
    LEVEL_1_TO_2: 10
});

export const R8_TWICE_WORD_UPGRADE_PROFILE = normalizeWordUpgradeProfile({
    abiVersion: WORD_UPGRADE_PROFILE_ABI_VERSION,
    id: R8_WORD_UPGRADE_PROFILE_ID.TWICE,
    definitionId: WORD_DEFINITION_ID.TWICE,
    levels: [
        {
            level: 0,
            stackContribution: 1,
            upgradeCostToNext: R8_TWICE_UPGRADE_COST.LEVEL_0_TO_1
        },
        {
            level: 1,
            stackContribution: 2,
            upgradeCostToNext: R8_TWICE_UPGRADE_COST.LEVEL_1_TO_2
        },
        {
            level: 2,
            stackContribution: 3,
            upgradeCostToNext: null
        }
    ]
}, 'R8 twice WordUpgradeProfile');

export const R8_WORD_UPGRADE_PROFILES = Object.freeze([
    R8_TWICE_WORD_UPGRADE_PROFILE
]);

export const R8_WORD_UPGRADE_PROFILE_BY_ID = Object.freeze(
    Object.fromEntries(R8_WORD_UPGRADE_PROFILES.map((profile) => (
        [profile.id, profile]
    )))
);

export const R8_WORD_UPGRADE_PROFILE_BY_DEFINITION_ID = Object.freeze(
    Object.fromEntries(R8_WORD_UPGRADE_PROFILES.map((profile) => (
        [profile.definitionId, profile]
    )))
);
