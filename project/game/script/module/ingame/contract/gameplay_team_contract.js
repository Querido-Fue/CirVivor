/** GPU/host/save 경계에서 공유하는 안정적인 gameplay team ID입니다. */
export const GAMEPLAY_TEAM_ID = Object.freeze({
    NEUTRAL: 0,
    PLAYER: 1,
    HOSTILE: 2
});

/**
 * 현재 damage gate의 명시적 정책 seam입니다.
 * Turn 1에서는 기본 team matrix만 승인하며, 미래 정책은 새 ID와 테스트를 함께 추가합니다.
 */
export const GAMEPLAY_DAMAGE_POLICY_ID = Object.freeze({
    DEFAULT_TEAM_MATRIX: 0
});

/**
 * Damage policy와 별개인 target-side resolution seam입니다. DIRECT는 기존 per-hit
 * semantics를 유지하고, MAXIMUM_DAMAGE_WINDOW만 같은 fixed tick 후보를 한 번으로
 * 집계합니다.
 */
export const GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID = Object.freeze({
    DIRECT: 0,
    MAXIMUM_DAMAGE_WINDOW: 1
});

/** Spawn producer가 resolved team을 결정하는 host-side allegiance vocabulary입니다. */
export const GAMEPLAY_ALLEGIANCE_POLICY = Object.freeze({
    FIXED_PLAYER: 'fixed-player',
    FIXED_HOSTILE: 'fixed-hostile',
    INHERIT_SUBJECT: 'inherit-subject',
    EXPLICIT_OVERRIDE: 'explicit-override'
});

const VALID_TEAM_IDS = new Set(Object.values(GAMEPLAY_TEAM_ID));
const VALID_DAMAGE_POLICY_IDS = new Set(Object.values(GAMEPLAY_DAMAGE_POLICY_ID));
const VALID_DAMAGE_RESOLUTION_POLICY_IDS = new Set(
    Object.values(GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID)
);
const VALID_ALLEGIANCE_POLICIES = new Set(
    Object.values(GAMEPLAY_ALLEGIANCE_POLICY)
);

/** @returns {number} 검증된 stable gameplay team ID입니다. */
export function normalizeGameplayTeamId(value, label = 'teamId') {
    if (!Number.isSafeInteger(value) || !VALID_TEAM_IDS.has(value)) {
        throw new RangeError(`${label}은 알려진 gameplay team ID여야 합니다.`);
    }
    return value;
}

/** @returns {number} 검증된 stable damage-policy ID입니다. */
export function normalizeGameplayDamagePolicyId(
    value = GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
    label = 'damagePolicyId'
) {
    if (!Number.isSafeInteger(value) || !VALID_DAMAGE_POLICY_IDS.has(value)) {
        throw new RangeError(`${label}은 알려진 gameplay damage policy ID여야 합니다.`);
    }
    return value;
}

/** @returns {number} 검증된 target-side damage resolution policy ID입니다. */
export function normalizeGameplayDamageResolutionPolicyId(
    value = GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID.DIRECT,
    label = 'damageResolutionPolicyId'
) {
    if (!Number.isSafeInteger(value)
        || !VALID_DAMAGE_RESOLUTION_POLICY_IDS.has(value)) {
        throw new RangeError(`${label}은 알려진 gameplay damage resolution policy ID여야 합니다.`);
    }
    return value;
}

/** @returns {string} 검증된 host-side allegiance policy입니다. */
export function normalizeGameplayAllegiancePolicy(
    value = GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
    label = 'allegiancePolicy'
) {
    if (typeof value !== 'string' || !VALID_ALLEGIANCE_POLICIES.has(value)) {
        throw new RangeError(`${label}은 알려진 gameplay allegiance policy여야 합니다.`);
    }
    return value;
}

/**
 * Spawn request의 resolved team을 정책과 대조합니다.
 * INHERIT_SUBJECT는 exact source registry metadata와 일치해야 합니다.
 */
export function resolveGameplayAllegianceTeam(options = {}) {
    const policy = normalizeGameplayAllegiancePolicy(options.policy);
    const hasResolvedTeam = options.teamId !== undefined && options.teamId !== null;
    const resolvedTeamId = hasResolvedTeam
        ? normalizeGameplayTeamId(options.teamId)
        : null;

    if (policy === GAMEPLAY_ALLEGIANCE_POLICY.FIXED_PLAYER) {
        if (resolvedTeamId !== null && resolvedTeamId !== GAMEPLAY_TEAM_ID.PLAYER) {
            throw new RangeError('FIXED_PLAYER allegiance와 teamId가 충돌합니다.');
        }
        return GAMEPLAY_TEAM_ID.PLAYER;
    }
    if (policy === GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE) {
        if (resolvedTeamId !== null && resolvedTeamId !== GAMEPLAY_TEAM_ID.HOSTILE) {
            throw new RangeError('FIXED_HOSTILE allegiance와 teamId가 충돌합니다.');
        }
        return GAMEPLAY_TEAM_ID.HOSTILE;
    }
    if (policy === GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT) {
        const subjectTeamId = normalizeGameplayTeamId(
            options.subjectTeamId,
            'subjectTeamId'
        );
        if (resolvedTeamId !== null && resolvedTeamId !== subjectTeamId) {
            throw new RangeError('INHERIT_SUBJECT allegiance와 source team이 충돌합니다.');
        }
        return subjectTeamId;
    }
    if (resolvedTeamId === null) {
        throw new TypeError('EXPLICIT_OVERRIDE allegiance에는 teamId가 필요합니다.');
    }
    return resolvedTeamId;
}

/**
 * Turn 1 기본 damage matrix입니다. Team gate는 damage에만 적용되고 interaction/physics와
 * terrain policy는 호출자가 별도로 유지합니다.
 */
export function isGameplayDamageAllowed(
    sourceTeamId,
    targetTeamId,
    damagePolicyId = GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
) {
    const source = normalizeGameplayTeamId(sourceTeamId, 'sourceTeamId');
    const target = normalizeGameplayTeamId(targetTeamId, 'targetTeamId');
    normalizeGameplayDamagePolicyId(damagePolicyId);
    return (source === GAMEPLAY_TEAM_ID.PLAYER
            && target === GAMEPLAY_TEAM_ID.HOSTILE)
        || (source === GAMEPLAY_TEAM_ID.HOSTILE
            && target === GAMEPLAY_TEAM_ID.PLAYER);
}
