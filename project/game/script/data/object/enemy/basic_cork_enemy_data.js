import {
    ENEMY_CAPABILITY_ID,
    createEnemyCapabilityMask
} from 'ingame/contract/enemy_capability_contract.js';
import {
    CORK_ROUTE_CLOSURE_BEHAVIOR_PROFILE_ID
} from './enemy_profile_catalog_data.js';
import {
    CORK_ROUTE_CLOSURE_PROFILE_ID
} from './enemy_route_closure_catalog_data.js';
import {
    createMainGpuEnemyDefinition
} from './main_gpu_enemy_definition_data.js';

export const BASIC_CORK_ENEMY_DEFINITION_ID = 'basic_cork_01';

export const BASIC_CORK_ENEMY_CAPABILITY_IDS = Object.freeze([
    ENEMY_CAPABILITY_ID.NAVIGATION,
    ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
    ENEMY_CAPABILITY_ID.CORE_IMPACT,
    ENEMY_CAPABILITY_ID.ROUTE_CLOSURE
]);

export const BASIC_CORK_ENEMY_CAPABILITY_MASK = createEnemyCapabilityMask(
    BASIC_CORK_ENEMY_CAPABILITY_IDS,
    'BASIC_CORK_ENEMY_CAPABILITY_IDS'
);

/** Z는 helper body가 없는 단일 logical cork-stopper enemy입니다. */
export const BASIC_CORK_ENEMY_DATA = createMainGpuEnemyDefinition(
    BASIC_CORK_ENEMY_DEFINITION_ID,
    'cork',
    {
        behaviorProfileId: CORK_ROUTE_CLOSURE_BEHAVIOR_PROFILE_ID,
        routeClosureProfileId: CORK_ROUTE_CLOSURE_PROFILE_ID,
        capabilityIds: BASIC_CORK_ENEMY_CAPABILITY_IDS
    }
);
