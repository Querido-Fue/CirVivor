/** Projectile Team과 독립적인 안정 target-interaction policy ID입니다. */
export const PROJECTILE_TARGET_POLICY_ID = Object.freeze({
    ENEMY_AND_TERRAIN: 'enemy-and-terrain',
    PLAYER_DAMAGEABLE_AND_TERRAIN: 'player-damageable-and-terrain',
    CORE_PROXY_AND_TERRAIN: 'core-proxy-and-terrain',
    GPU_SELECTED_CORE_OR_PLAYER_DAMAGEABLE_AND_TERRAIN:
        'gpu-selected-core-or-player-damageable-and-terrain'
});

/** GPU tick-start exact candidate selection의 stable host policy vocabulary입니다. */
export const PROJECTILE_SELECTED_TARGET_POLICY_ID = Object.freeze({
    CORE_FIRST_IN_RANGE_THEN_TOWER: 'core-first-in-range-then-tower'
});

export const PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID = Object.freeze({
    TICK_START_CENTER_INCLUSIVE: 'tick-start-center-inclusive'
});

export const PROJECTILE_CORE_DAMAGE_REQUEST_POLICY_ID = Object.freeze({
    TYPED_CPU_CORE_DAMAGE: 'typed-cpu-core-damage-request'
});

const VALID_PROJECTILE_TARGET_POLICY_IDS = new Set(
    Object.values(PROJECTILE_TARGET_POLICY_ID)
);

/** @returns {string} 검증된 projectile target policy ID입니다. */
export function normalizeProjectileTargetPolicyId(
    value = PROJECTILE_TARGET_POLICY_ID.ENEMY_AND_TERRAIN,
    label = 'targetPolicyId'
) {
    if (typeof value !== 'string'
        || !VALID_PROJECTILE_TARGET_POLICY_IDS.has(value)) {
        throw new RangeError(`${label}은 알려진 projectile target policy ID여야 합니다.`);
    }
    return value;
}
