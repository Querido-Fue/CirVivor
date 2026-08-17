import {
    ENEMY_CAPABILITY_ID,
    createEnemyCapabilityMask
} from 'ingame/contract/enemy_capability_contract.js';
import {
    RING_PROJECTILE_CAPTURE_PROFILE_ID
} from './enemy_projectile_capture_catalog_data.js';
import {
    createMainGpuEnemyDefinition,
    MAIN_GPU_ENEMY_DEFAULT_CAPABILITY_IDS
} from './main_gpu_enemy_definition_data.js';

export const BASIC_RING_ENEMY_DEFINITION_ID = 'basic_ring_01';

export const BASIC_RING_ENEMY_CAPABILITY_IDS = Object.freeze([
    ...MAIN_GPU_ENEMY_DEFAULT_CAPABILITY_IDS,
    ENEMY_CAPABILITY_ID.PROJECTILE_CAPTURE
]);

export const BASIC_RING_ENEMY_CAPABILITY_MASK = createEnemyCapabilityMask(
    BASIC_RING_ENEMY_CAPABILITY_IDS
);

/** Common-C stats를 사용하는 GPU-only hollow Ring R definition입니다. */
export const BASIC_RING_ENEMY_DATA = createMainGpuEnemyDefinition(
    BASIC_RING_ENEMY_DEFINITION_ID,
    'ring',
    {
        siegeWeight: 1,
        projectileCaptureProfileId: RING_PROJECTILE_CAPTURE_PROFILE_ID,
        capabilityIds: BASIC_RING_ENEMY_CAPABILITY_IDS
    }
);
