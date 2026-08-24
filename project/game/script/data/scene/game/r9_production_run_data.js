import {
    R9_PRODUCTION_WAVE_RUN_PLANS,
    R9_WAVE_RUN_PLAN_ID
} from 'data/scene/game/r9_wave_run_plan_data.js';
import {
    R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
    R8_WORD_SHOP_BALANCE
} from 'data/word/r8_word_shop_catalog_data.js';
import {
    fingerprintUnlockedWordPool
} from 'ingame/contract/word_shop_contract.js';

export const R9_POST_R8_PRODUCTION_SHOP_EXPOSURE = Object.freeze({
    status: 'APPROVED',
    sourceId: 'post-r8-scheduler-shop-hardening',
    minimumCandidateDefinitionCount: R8_WORD_SHOP_BALANCE.OFFER_COUNT,
    automaticWaveSettlementShopAllowed: true
});

export const R9_PRODUCTION_RUN_SEED_BY_PLAN_ID = Object.freeze({
    [R9_WAVE_RUN_PLAN_ID.CORRIDOR_PRODUCTION]: 0x9a25_0101,
    [R9_WAVE_RUN_PLAN_ID.R2_SHOWCASE_PRODUCTION]: 0x9a25_0201,
    [R9_WAVE_RUN_PLAN_ID.PERFORMANCE_PRODUCTION]: 0x9a25_0301
});

const unlockedPoolFingerprint = fingerprintUnlockedWordPool(
    R8_ALL_UNLOCKED_WORD_DEFINITION_IDS
);

export const R9_PRODUCTION_RUN_IDENTITY_BY_PLAN_ID = Object.freeze(
    Object.fromEntries(R9_PRODUCTION_WAVE_RUN_PLANS.map((plan) => [
        plan.planId,
        Object.freeze({
            runSessionId: `run.r9.production.${plan.planId}`,
            runSeed: R9_PRODUCTION_RUN_SEED_BY_PLAN_ID[plan.planId],
            unlockedWordDefinitionIds:
                R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
            unlockedPoolFingerprint
        })
    ]))
);

export function resolveR9ProductionRunIdentity(planId) {
    return R9_PRODUCTION_RUN_IDENTITY_BY_PLAN_ID[planId] ?? null;
}

/**
 * 정적 Post-R8 승인과 후보 catalog 크기를 확인합니다. 실제 소유/upgrade 의미성은
 * WordShopSession.previewOpen()이 Wave reward 게시 전에 다시 판정합니다.
 */
export function isR9ProductionShopExposureApproved(identity) {
    if (R9_POST_R8_PRODUCTION_SHOP_EXPOSURE.status !== 'APPROVED'
        || R9_POST_R8_PRODUCTION_SHOP_EXPOSURE
            .automaticWaveSettlementShopAllowed !== true
        || !Array.isArray(identity?.unlockedWordDefinitionIds)
        || identity.unlockedWordDefinitionIds.length
            < R9_POST_R8_PRODUCTION_SHOP_EXPOSURE
                .minimumCandidateDefinitionCount) {
        return false;
    }
    try {
        return fingerprintUnlockedWordPool(
            identity.unlockedWordDefinitionIds
        ) === identity.unlockedPoolFingerprint;
    } catch {
        return false;
    }
}
