import {
    createMainGpuEnemyDefinition
} from './main_gpu_enemy_definition_data.js';
import {
    ENEMY_CAPABILITY_ID
} from 'ingame/contract/enemy_capability_contract.js';
import {
    ARCHER_ATTACK_DEFINITION_ID as ARCHER_ATTACK_PROFILE_DEFINITION_ID,
    ARCHER_CORE_ROUTE_ENEMY_BEHAVIOR_PROFILE_ID
} from './enemy_profile_catalog_data.js';

export const ARCHER_ENEMY_DEFINITION_ID = 'archer_01';
export const ARCHER_ATTACK_DEFINITION_ID = ARCHER_ATTACK_PROFILE_DEFINITION_ID;

const ARCHER_CAPABILITY_IDS = Object.freeze([
    ENEMY_CAPABILITY_ID.NAVIGATION,
    ENEMY_CAPABILITY_ID.TARGETING,
    ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
    ENEMY_CAPABILITY_ID.CORE_IMPACT
]);

/**
 * R1 Turn 4 technical Archer content입니다.
 * 기존 Core route 이동과 arrow geometry를 공유하지만 basic_arrow_01과는 별도 identity입니다.
 */
export const ARCHER_ENEMY_DATA = createMainGpuEnemyDefinition(
    ARCHER_ENEMY_DEFINITION_ID,
    'arrow',
    {
        behaviorProfileId: ARCHER_CORE_ROUTE_ENEMY_BEHAVIOR_PROFILE_ID,
        capabilityIds: ARCHER_CAPABILITY_IDS
    }
);
