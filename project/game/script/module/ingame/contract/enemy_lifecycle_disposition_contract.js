/**
 * Enemy가 world에서 사라지는 의미와 future reward 정책을 분리하는 안정 vocabulary입니다.
 * 이 계약은 content/profile을 import하지 않으며 Gold를 직접 지급하지 않습니다.
 */
export const ENEMY_LIFECYCLE_DISPOSITION_ID = Object.freeze({
    PLAYER_KILL: 'PLAYER_KILL',
    CORE_IMPACT: 'CORE_IMPACT',
    MERGE_CONSUMED: 'MERGE_CONSUMED',
    TRANSFORM_CONSUMED: 'TRANSFORM_CONSUMED',
    SCRIPTED_DESPAWN: 'SCRIPTED_DESPAWN'
});

const DISPOSITION_POLICIES = Object.freeze({
    [ENEMY_LIFECYCLE_DISPOSITION_ID.PLAYER_KILL]: Object.freeze({
        bountyEligible: true,
        bountyOwnership: 'DIRECT'
    }),
    [ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT]: Object.freeze({
        bountyEligible: false,
        bountyOwnership: 'FORFEITED'
    }),
    [ENEMY_LIFECYCLE_DISPOSITION_ID.MERGE_CONSUMED]: Object.freeze({
        bountyEligible: false,
        bountyOwnership: 'TRANSFERRED'
    }),
    [ENEMY_LIFECYCLE_DISPOSITION_ID.TRANSFORM_CONSUMED]: Object.freeze({
        bountyEligible: false,
        bountyOwnership: 'TRANSFERRED'
    }),
    [ENEMY_LIFECYCLE_DISPOSITION_ID.SCRIPTED_DESPAWN]: Object.freeze({
        bountyEligible: false,
        bountyOwnership: 'NONE'
    })
});

/** @param {*} disposition - 확인할 stable disposition ID입니다. */
export function isEnemyLifecycleDisposition(disposition) {
    return typeof disposition === 'string'
        && Object.hasOwn(DISPOSITION_POLICIES, disposition);
}

/** @param {*} disposition - 확인할 stable disposition ID입니다. */
export function assertEnemyLifecycleDisposition(disposition) {
    if (!isEnemyLifecycleDisposition(disposition)) {
        throw new RangeError(`알 수 없는 Enemy lifecycle disposition입니다: ${String(disposition)}`);
    }
    return disposition;
}

/** @param {*} disposition - stable disposition ID입니다. */
export function getEnemyLifecycleDispositionPolicy(disposition) {
    return DISPOSITION_POLICIES[assertEnemyLifecycleDisposition(disposition)];
}

/** Gold 시스템 없이 future bounty eligibility만 반환합니다. */
export function isEnemyBountyEligibleForDisposition(disposition) {
    return getEnemyLifecycleDispositionPolicy(disposition).bountyEligible;
}

/** 안정된 public policy 명칭입니다. */
export function isEnemyDispositionBountyEligible(disposition) {
    return isEnemyBountyEligibleForDisposition(disposition);
}
