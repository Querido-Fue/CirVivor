import {
    createEnemyCapabilityMask,
    ENEMY_CAPABILITY_ID
} from 'ingame/contract/enemy_capability_contract.js';
import {
    ENEMY_SPAWN_POLICY,
    normalizeEnemyDefinition
} from 'ingame/contract/enemy_profile_contract.js';
import {
    ENEMY_ORBIT_CAPACITY_OVERFLOW_POLICY,
    ENEMY_ORBIT_CAPACITY_RETRY_POLICY,
    ENEMY_ORBIT_FUTURE_TARGET_REACQUISITION_POLICY,
    ENEMY_ORBIT_FUTURE_TARGET_SELECTION_POLICY,
    ENEMY_ORBIT_TOWER_LOSS_POLICY
} from 'ingame/contract/enemy_orbit_directional_defense_contract.js';
import {
    ENEMY_PROFILE_CATALOG,
    MAIN_GPU_ENEMY_COLOR_RGBA,
    MAIN_GPU_ENEMY_COMBAT_PROFILE_ID,
    OCTAGON_HEAVY_ENEMY_PHYSICS_PROFILE_ID,
    OCTAGON_TOWER_ORBIT_ENEMY_BEHAVIOR_PROFILE_ID
} from './enemy_profile_catalog_data.js';

export const BASIC_OCTA_ENEMY_DEFINITION_ID = 'basic-octa-enemy';

export const BASIC_OCTA_ENEMY_CAPABILITY_IDS = Object.freeze([
    ENEMY_CAPABILITY_ID.NAVIGATION,
    ENEMY_CAPABILITY_ID.TARGETING,
    ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
    ENEMY_CAPABILITY_ID.CORE_IMPACT,
    ENEMY_CAPABILITY_ID.DIRECTIONAL_DEFENSE,
    ENEMY_CAPABILITY_ID.ORBIT
]);

export const BASIC_OCTA_ENEMY_CAPABILITY_MASK = createEnemyCapabilityMask(
    BASIC_OCTA_ENEMY_CAPABILITY_IDS,
    'basic O capabilityIds'
);

/** Lifecycle/GPU adapter가 같은 normalized orbit data를 참조하는 authority입니다. */
export const BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE = ENEMY_PROFILE_CATALOG.behaviorById[
    OCTAGON_TOWER_ORBIT_ENEMY_BEHAVIOR_PROFILE_ID
];
export const BASIC_OCTA_ORBIT_SLOT_CAPACITY
    = BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE.orbit.slotCapacity;
export const BASIC_OCTA_ORBIT_SLOT_FILL_ORDER
    = BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE.orbit.slotFillOrder;

/**
 * O의 8-slot bounded roster 정책입니다. 초과는 expected normal rejection이며
 * authored showcase/wave가 slot availability 뒤의 별도 fixed tick으로 나눕니다.
 */
export const BASIC_OCTA_ORBIT_CAPACITY_POLICY = Object.freeze({
    maximumSimultaneousActors: BASIC_OCTA_ORBIT_SLOT_CAPACITY,
    overflowPolicyId:
        ENEMY_ORBIT_CAPACITY_OVERFLOW_POLICY
            .REJECT_WHOLE_FIXED_TICK_SPAWN_BATCH,
    retryPolicyId:
        ENEMY_ORBIT_CAPACITY_RETRY_POLICY
            .AUTHORED_STAGGER_AFTER_SLOT_AVAILABLE,
    wholeBatchZeroMutation: true,
    recoveryRequired: false
});

/**
 * R2 single-Tower baseline은 loss 뒤 Core fallback을 latch합니다. Tower가 다시
 * 나타나거나 여러 Tower가 공존하는 future gameplay는 roster-change 경계에서
 * exact living Tower를 동적으로 재획득해야 하며 이 요구는 아직 활성화하지 않습니다.
 */
export const BASIC_OCTA_FUTURE_TARGET_REACQUISITION_REQUIREMENT = Object.freeze({
    currentSingleTowerLossPolicyId:
        ENEMY_ORBIT_TOWER_LOSS_POLICY.LATCH_CORE_FALLBACK,
    futurePolicyId:
        ENEMY_ORBIT_FUTURE_TARGET_REACQUISITION_POLICY
            .EXACT_LIVING_TOWER_ON_ROSTER_CHANGE,
    selectionPolicyId:
        ENEMY_ORBIT_FUTURE_TARGET_SELECTION_POLICY
            .LOWEST_ENTITY_ID_THEN_INCARNATION,
    requiredForTowerReappearance: true,
    requiredForMultipleLivingTowers: true,
    activeInCurrentSingleTowerRuntime: false
});

export const BASIC_OCTA_ENEMY_DATA = normalizeEnemyDefinition(Object.freeze({
    id: BASIC_OCTA_ENEMY_DEFINITION_ID,
    spawnPolicy: ENEMY_SPAWN_POLICY.NATURAL,
    shapeDefinitionId: 'octa',
    physicsProfileId: OCTAGON_HEAVY_ENEMY_PHYSICS_PROFILE_ID,
    combatProfileId: MAIN_GPU_ENEMY_COMBAT_PROFILE_ID,
    behaviorProfileId: OCTAGON_TOWER_ORBIT_ENEMY_BEHAVIOR_PROFILE_ID,
    formationDefinitionId: null,
    siegeWeight: 1,
    capabilityIds: BASIC_OCTA_ENEMY_CAPABILITY_IDS,
    render: Object.freeze({
        colorRgba: MAIN_GPU_ENEMY_COLOR_RGBA,
        radiusScale: 1
    })
}), ENEMY_PROFILE_CATALOG);
