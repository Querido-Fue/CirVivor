import {
    normalizeJorangBountyBudget
} from 'ingame/contract/enemy_jorang_split_contract.js';

export const JORANG_NATURAL_BOUNTY_BUDGET = normalizeJorangBountyBudget(12);
export const JORANG_RETURN_DELAY_FIXED_TICKS = 60;
export const JORANG_MAXIMUM_TRANSFORM_STARTS_PER_FIXED_TICK = 4;

/** J lineage에만 적용됩니다. 기존 H Formation runtime quota는 독립입니다. */
export const JORANG_SPLIT_RUNTIME_CONFIG = Object.freeze({
    returnDelayFixedTicks: JORANG_RETURN_DELAY_FIXED_TICKS,
    maximumTransformStartsPerFixedTick:
        JORANG_MAXIMUM_TRANSFORM_STARTS_PER_FIXED_TICK
});
