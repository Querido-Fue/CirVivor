import {
    ENEMY_FORMATION_POLICY
} from 'ingame/contract/enemy_profile_contract.js';
import {
    PROJECTILE_SELECTED_TARGET_POLICY_ID
} from 'ingame/contract/projectile_target_policy_contract.js';

export const BASIC_RHOM_ENEMY_DEFINITION_ID = 'basic_rhom_01';
export const BASIC_RHOM_ATTACK_DEFINITION_ID
    = 'basic_rhom_core_priority_shot_01';
export const BASIC_RHOM_BEHAVIOR_PROFILE_ID
    = 'basic-rhom-core-priority-ranged-01';

/** Central profile catalog가 cycle 없이 import하는 M 전용 behavior source입니다. */
export const BASIC_RHOM_BEHAVIOR_PROFILE_SOURCE = Object.freeze({
    id: BASIC_RHOM_BEHAVIOR_PROFILE_ID,
    navigationObjective: 'core-priority-ranged-with-route-fallback',
    navigationMode: 'gpu-core-priority-ranged',
    moveSpeedTilesPerSecond: 2.5,
    towerEngagement: 'projectile',
    towerTargetSelection:
        PROJECTILE_SELECTED_TARGET_POLICY_ID.CORE_FIRST_IN_RANGE_THEN_TOWER,
    towerPhysicalResponse: 'weight-based-pushable',
    fallback: 'route-stage-goal',
    attackDefinitionId: BASIC_RHOM_ATTACK_DEFINITION_ID,
    coreImpactPolicy: 'despawn-on-core-impact',
    formationPolicy: ENEMY_FORMATION_POLICY.NONE
});
