import {
    ENEMY_CAPABILITY_ID
} from 'ingame/contract/enemy_capability_contract.js';
import {
    normalizeEnemyDefinition
} from 'ingame/contract/enemy_profile_contract.js';
import {
    PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_ID
} from './enemy_effect_catalog_data.js';
import {
    CORE_ROUTE_ENEMY_BEHAVIOR_PROFILE_ID,
    ENEMY_PROFILE_CATALOG,
    MAIN_GPU_ENEMY_COLOR_RGBA,
    MAIN_GPU_ENEMY_COMBAT_PROFILE_ID,
    MAIN_GPU_ENEMY_PHYSICS_PROFILE_ID
} from './enemy_profile_catalog_data.js';
import {
    MAIN_GPU_ENEMY_DEFAULT_CAPABILITY_IDS
} from './main_gpu_enemy_definition_data.js';

/** Pentagon P는 Core-route fallback과 독립 Effect Emitter capability를 함께 선언합니다. */
export const BASIC_PENTA_ENEMY_DATA = normalizeEnemyDefinition(Object.freeze({
    id: 'basic_penta_01',
    shapeDefinitionId: 'penta',
    physicsProfileId: MAIN_GPU_ENEMY_PHYSICS_PROFILE_ID,
    combatProfileId: MAIN_GPU_ENEMY_COMBAT_PROFILE_ID,
    behaviorProfileId: CORE_ROUTE_ENEMY_BEHAVIOR_PROFILE_ID,
    effectEmitterProfileId: PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_ID,
    capabilityIds: Object.freeze([
        ...MAIN_GPU_ENEMY_DEFAULT_CAPABILITY_IDS,
        ENEMY_CAPABILITY_ID.EFFECT_EMITTER
    ]),
    render: Object.freeze({
        colorRgba: MAIN_GPU_ENEMY_COLOR_RGBA,
        radiusScale: 1
    })
}), ENEMY_PROFILE_CATALOG);
