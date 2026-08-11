import {
    createEnemyCapabilityMask,
    ENEMY_CAPABILITY_ID
} from 'ingame/contract/enemy_capability_contract.js';
import {
    ENEMY_SPAWN_POLICY,
    normalizeEnemyDefinition
} from 'ingame/contract/enemy_profile_contract.js';
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

export const BASIC_OCTA_ENEMY_DATA = normalizeEnemyDefinition(Object.freeze({
    id: BASIC_OCTA_ENEMY_DEFINITION_ID,
    spawnPolicy: ENEMY_SPAWN_POLICY.NATURAL,
    shapeDefinitionId: 'octa',
    physicsProfileId: OCTAGON_HEAVY_ENEMY_PHYSICS_PROFILE_ID,
    combatProfileId: MAIN_GPU_ENEMY_COMBAT_PROFILE_ID,
    behaviorProfileId: OCTAGON_TOWER_ORBIT_ENEMY_BEHAVIOR_PROFILE_ID,
    formationDefinitionId: null,
    capabilityIds: BASIC_OCTA_ENEMY_CAPABILITY_IDS,
    render: Object.freeze({
        colorRgba: MAIN_GPU_ENEMY_COLOR_RGBA,
        radiusScale: 1
    })
}), ENEMY_PROFILE_CATALOG);
