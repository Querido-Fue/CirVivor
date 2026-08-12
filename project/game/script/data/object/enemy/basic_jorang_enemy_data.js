import {
    ENEMY_CAPABILITY_ID,
    createEnemyCapabilityMask
} from 'ingame/contract/enemy_capability_contract.js';
import {
    ENEMY_SPAWN_POLICY
} from 'ingame/contract/enemy_profile_contract.js';
import {
    JORANG_NATURAL_ENEMY_COMBAT_PROFILE_ID,
    MAIN_GPU_ENEMY_COMBAT_PROFILE_ID,
    MAIN_GPU_ENEMY_PHYSICS_PROFILE_ID,
    CORE_ROUTE_ENEMY_BEHAVIOR_PROFILE_ID
} from './enemy_profile_catalog_data.js';
import {
    createMainGpuEnemyDefinition
} from './main_gpu_enemy_definition_data.js';
import {
    BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID,
    BASIC_JORANG_ENEMY_DEFINITION_ID,
    CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID,
    JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID
} from './enemy_jorang_split_catalog_data.js';

export {
    BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID,
    BASIC_JORANG_ENEMY_DEFINITION_ID
} from './enemy_jorang_split_catalog_data.js';

export const BASIC_JORANG_ENEMY_CAPABILITY_IDS = Object.freeze([
    ENEMY_CAPABILITY_ID.NAVIGATION,
    ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
    ENEMY_CAPABILITY_ID.CORE_IMPACT,
    ENEMY_CAPABILITY_ID.ATOMIC_TRANSFORM
]);

export const BASIC_JORANG_ENEMY_CAPABILITY_MASK = createEnemyCapabilityMask(
    BASIC_JORANG_ENEMY_CAPABILITY_IDS,
    'BASIC_JORANG_ENEMY_CAPABILITY_IDS'
);

export const BASIC_JORANG_ENEMY_DATA = createMainGpuEnemyDefinition(
    BASIC_JORANG_ENEMY_DEFINITION_ID,
    'jorang',
    {
        spawnPolicy: ENEMY_SPAWN_POLICY.NATURAL,
        combatProfileId: JORANG_NATURAL_ENEMY_COMBAT_PROFILE_ID,
        atomicTransformProfileId: JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID,
        capabilityIds: BASIC_JORANG_ENEMY_CAPABILITY_IDS
    }
);

const BASIC_CIRCLE_PRIME_ENEMY_DATA = createMainGpuEnemyDefinition(
    BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID,
    'circle',
    {
        spawnPolicy: ENEMY_SPAWN_POLICY.TRANSFORM_PRIVATE,
        atomicTransformProfileId:
            CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID,
        capabilityIds: BASIC_JORANG_ENEMY_CAPABILITY_IDS
    }
);

/** Atomic transform materializer만 C′ definition을 요청할 수 있는 private resolver입니다. */
export function resolveBasicCirclePrimeTransformPrivateDefinition() {
    return BASIC_CIRCLE_PRIME_ENEMY_DATA;
}

/** Private materializer가 common-C identity와 profile을 exact 검증할 때 쓰는 authority입니다. */
export const BASIC_CIRCLE_PRIME_PRIVATE_PROFILE_IDENTITY = Object.freeze({
    physicsProfileId: MAIN_GPU_ENEMY_PHYSICS_PROFILE_ID,
    combatProfileId: MAIN_GPU_ENEMY_COMBAT_PROFILE_ID,
    behaviorProfileId: CORE_ROUTE_ENEMY_BEHAVIOR_PROFILE_ID,
    atomicTransformProfileId:
        CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID
});
