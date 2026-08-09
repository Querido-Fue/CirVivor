import {
    GAMEPLAY_ALLEGIANCE_POLICY
} from 'ingame/contract/gameplay_team_contract.js';
import {
    PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID,
    PROJECTILE_SELECTED_TARGET_POLICY_ID,
    PROJECTILE_TARGET_POLICY_ID
} from 'ingame/contract/projectile_target_policy_contract.js';
import {
    BASIC_RHOM_ATTACK_DEFINITION_ID,
    BASIC_RHOM_ENEMY_DEFINITION_ID
} from './basic_rhom_enemy_data.js';
import {
    HOSTILE_RHOM_PROJECTILE_DATA,
    HOSTILE_RHOM_PROJECTILE_PRODUCER_ID
} from '../projectile/hostile_rhom_projectile_data.js';

const ZERO_OFFSET = Object.freeze({ x: 0, y: 0 });

export const HOSTILE_RANGED_TARGET_SELECTION_POLICY_ID
    = PROJECTILE_SELECTED_TARGET_POLICY_ID;

export const HOSTILE_RANGED_DISTANCE_POLICY_ID
    = PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID;

export const HOSTILE_RANGED_MOVEMENT_POLICY_ID = Object.freeze({
    STOP_WHILE_TARGET_IN_RANGE: 'stop-while-target-in-range'
});

export const HOSTILE_RANGED_TARGET_SNAPSHOT_POLICY_ID = Object.freeze({
    GPU_FIXED_TICK_EXACT_PRIORITY: 'gpu-fixed-tick-exact-priority'
});

/** Diamond M의 Turn 2 technical authored baseline입니다. */
export const BASIC_RHOM_ATTACK_DATA = Object.freeze({
    id: BASIC_RHOM_ATTACK_DEFINITION_ID,
    sourceEnemyDefinitionId: BASIC_RHOM_ENEMY_DEFINITION_ID,
    projectileDefinitionId: HOSTILE_RHOM_PROJECTILE_DATA.id,
    launchSpeed: 12,
    positionOffset: ZERO_OFFSET,
    targetOffset: ZERO_OFFSET,
    initialDelayTicks: 30,
    intervalTicks: 90,
    phaseSpreadTicks: 30,
    targetSelectionPolicy:
        HOSTILE_RANGED_TARGET_SELECTION_POLICY_ID
            .CORE_FIRST_IN_RANGE_THEN_TOWER,
    targetSnapshotPolicy:
        HOSTILE_RANGED_TARGET_SNAPSHOT_POLICY_ID
            .GPU_FIXED_TICK_EXACT_PRIORITY,
    distancePolicy:
        HOSTILE_RANGED_DISTANCE_POLICY_ID.TICK_START_CENTER_INCLUSIVE,
    movementPolicy:
        HOSTILE_RANGED_MOVEMENT_POLICY_ID.STOP_WHILE_TARGET_IN_RANGE,
    attackRangeTiles: 8,
    allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
    targetPolicyId:
        PROJECTILE_TARGET_POLICY_ID
            .GPU_SELECTED_CORE_OR_PLAYER_DAMAGEABLE_AND_TERRAIN,
    towerTargetPolicyId:
        PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
    coreTargetPolicyId:
        PROJECTILE_TARGET_POLICY_ID.CORE_PROXY_AND_TERRAIN,
    coreDamage: HOSTILE_RHOM_PROJECTILE_DATA.coreDamage,
    producerId: HOSTILE_RHOM_PROJECTILE_PRODUCER_ID,
    sourceAbilityId: 'enemy.rhom.shoot.core-priority-projectile'
});

export const BASIC_RHOM_ATTACK_DEFINITION_BY_ID = Object.freeze({
    [BASIC_RHOM_ATTACK_DATA.id]: BASIC_RHOM_ATTACK_DATA
});
