import {
    R7_WORD_DEFINITIONS
} from 'data/word/r3_word_catalog_data.js';
import {
    R8_WORD_UPGRADE_PROFILE_ID
} from 'data/word/r8_word_upgrade_profile_data.js';
import {
    WORD_SHOP_OFFER_COUNT,
    normalizeWordShopCatalog
} from 'ingame/contract/word_shop_contract.js';
import {
    WORD_DEFINITION_ID
} from 'ingame/contract/word_sentence_contract.js';

export const R8_WORD_SHOP_BALANCE = Object.freeze({
    OFFER_COUNT: WORD_SHOP_OFFER_COUNT,
    REROLL_COST: 3,
    QA_INITIAL_GOLD: 100,
    // QA 첫 행에 modifier.twice가 포함되어 exact R8 acceptance route를
    // 입력 순서 변경 없이 수행할 수 있는 결정적 seed입니다.
    QA_RUN_SEED: 0x8a24c001
});

export const R8_WORD_PURCHASE_COST = Object.freeze({
    TOWER: 7,
    ENEMY: 5,
    SHOOT: 4,
    THROW: 5,
    EMIT: 5,
    SUMMON: 7,
    MERGE: 8,
    TWICE: 9
});

export const R8_WORD_OFFER_WEIGHT = Object.freeze({
    TOWER: 12,
    ENEMY: 14,
    SHOOT: 12,
    THROW: 10,
    EMIT: 10,
    SUMMON: 8,
    MERGE: 6,
    TWICE: 5
});

const CATALOG_SOURCE = Object.freeze([
    {
        definitionId: WORD_DEFINITION_ID.TOWER,
        basePurchaseCost: R8_WORD_PURCHASE_COST.TOWER,
        offerWeight: R8_WORD_OFFER_WEIGHT.TOWER,
        rarityId: 'common',
        upgradeProfileId: null,
        unlockKey: 'unlock.word.entity.tower',
        shopEligible: true
    },
    {
        definitionId: WORD_DEFINITION_ID.ENEMY,
        basePurchaseCost: R8_WORD_PURCHASE_COST.ENEMY,
        offerWeight: R8_WORD_OFFER_WEIGHT.ENEMY,
        rarityId: 'common',
        upgradeProfileId: null,
        unlockKey: 'unlock.word.entity.enemy',
        shopEligible: true
    },
    {
        definitionId: WORD_DEFINITION_ID.SHOOT,
        basePurchaseCost: R8_WORD_PURCHASE_COST.SHOOT,
        offerWeight: R8_WORD_OFFER_WEIGHT.SHOOT,
        rarityId: 'common',
        upgradeProfileId: null,
        unlockKey: 'unlock.verb.shoot',
        shopEligible: true
    },
    {
        definitionId: WORD_DEFINITION_ID.THROW,
        basePurchaseCost: R8_WORD_PURCHASE_COST.THROW,
        offerWeight: R8_WORD_OFFER_WEIGHT.THROW,
        rarityId: 'common',
        upgradeProfileId: null,
        unlockKey: 'unlock.verb.throw',
        shopEligible: true
    },
    {
        definitionId: WORD_DEFINITION_ID.EMIT,
        basePurchaseCost: R8_WORD_PURCHASE_COST.EMIT,
        offerWeight: R8_WORD_OFFER_WEIGHT.EMIT,
        rarityId: 'common',
        upgradeProfileId: null,
        unlockKey: 'unlock.verb.emit',
        shopEligible: true
    },
    {
        definitionId: WORD_DEFINITION_ID.SUMMON,
        basePurchaseCost: R8_WORD_PURCHASE_COST.SUMMON,
        offerWeight: R8_WORD_OFFER_WEIGHT.SUMMON,
        rarityId: 'uncommon',
        upgradeProfileId: null,
        unlockKey: 'unlock.verb.summon',
        shopEligible: true
    },
    {
        definitionId: WORD_DEFINITION_ID.MERGE,
        basePurchaseCost: R8_WORD_PURCHASE_COST.MERGE,
        offerWeight: R8_WORD_OFFER_WEIGHT.MERGE,
        rarityId: 'uncommon',
        upgradeProfileId: null,
        unlockKey: 'unlock.verb.merge',
        shopEligible: true
    },
    {
        definitionId: WORD_DEFINITION_ID.TWICE,
        basePurchaseCost: R8_WORD_PURCHASE_COST.TWICE,
        offerWeight: R8_WORD_OFFER_WEIGHT.TWICE,
        rarityId: 'rare',
        upgradeProfileId: R8_WORD_UPGRADE_PROFILE_ID.TWICE,
        unlockKey: 'unlock.modifier.twice',
        shopEligible: true
    }
]);

const DEFINITION_BY_ID = Object.freeze(Object.fromEntries(
    R7_WORD_DEFINITIONS.map((definition) => [definition.id, definition])
));

for (const record of CATALOG_SOURCE) {
    const definition = DEFINITION_BY_ID[record.definitionId];
    if (!definition || definition.shopEligible !== true) {
        throw new Error(`R8 Shop catalog definition이 shopEligible이 아닙니다: ${record.definitionId}`);
    }
}

export const R8_WORD_SHOP_CATALOG = normalizeWordShopCatalog(CATALOG_SOURCE);

export const R8_WORD_SHOP_CATALOG_BY_DEFINITION_ID = Object.freeze(
    Object.fromEntries(R8_WORD_SHOP_CATALOG.map((record) => (
        [record.definitionId, record]
    )))
);

export const R8_ALL_UNLOCKED_WORD_DEFINITION_IDS = Object.freeze(
    R8_WORD_SHOP_CATALOG.map((record) => record.definitionId)
);
