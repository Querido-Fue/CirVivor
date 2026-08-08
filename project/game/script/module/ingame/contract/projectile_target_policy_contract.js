/** Projectile Team과 독립적인 안정 target-interaction policy ID입니다. */
export const PROJECTILE_TARGET_POLICY_ID = Object.freeze({
    ENEMY_AND_TERRAIN: 'enemy-and-terrain',
    PLAYER_DAMAGEABLE_AND_TERRAIN: 'player-damageable-and-terrain'
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
