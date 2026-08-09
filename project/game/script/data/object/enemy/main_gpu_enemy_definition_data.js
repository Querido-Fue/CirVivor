import {
    ENEMY_CAPABILITY_ID
} from 'ingame/contract/enemy_capability_contract.js';
import {
    ENEMY_SPAWN_POLICY,
    normalizeEnemyDefinition
} from 'ingame/contract/enemy_profile_contract.js';
import {
    CORE_ROUTE_ENEMY_BEHAVIOR_PROFILE_ID,
    ENEMY_PROFILE_CATALOG,
    MAIN_GPU_ENEMY_COLOR_RGBA,
    MAIN_GPU_ENEMY_COMBAT_PROFILE_ID,
    MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES,
    MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE,
    MAIN_GPU_ENEMY_PHYSICS_PROFILE_ID
} from './enemy_profile_catalog_data.js';

export {
    MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES,
    MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE,
    MAIN_GPU_ENEMY_COLOR_RGBA
} from './enemy_profile_catalog_data.js';

/** 모든 main GPU enemy가 실제로 사용하는 공통 runtime capability입니다. */
export const MAIN_GPU_ENEMY_DEFAULT_CAPABILITY_IDS = Object.freeze([
    ENEMY_CAPABILITY_ID.NAVIGATION,
    ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
    ENEMY_CAPABILITY_ID.CORE_IMPACT
]);

/**
 * main GPU enemy의 공통 Core-route 수치를 한 definition으로 조합합니다.
 * content별 필드는 공통 gameplay 수치를 덮어쓸 수 없습니다.
 */
export function createMainGpuEnemyDefinition(
    id,
    shapeDefinitionId,
    options = {}
) {
    const allowedOptionKeys = new Set([
        'spawnPolicy',
        'behaviorProfileId',
        'formationDefinitionId',
        'capabilityIds',
        'render'
    ]);
    if (!options
        || typeof options !== 'object'
        || Array.isArray(options)) {
        throw new TypeError('main GPU enemy definition options는 plain object여야 합니다.');
    }
    for (const key of Object.keys(options)) {
        if (!allowedOptionKeys.has(key)) {
            throw new RangeError(`main GPU enemy definition option은 지원하지 않습니다: ${key}`);
        }
    }
    const render = options.render ?? {
        colorRgba: MAIN_GPU_ENEMY_COLOR_RGBA,
        radiusScale: 1
    };
    return normalizeEnemyDefinition({
        id,
        spawnPolicy: options.spawnPolicy ?? ENEMY_SPAWN_POLICY.NATURAL,
        shapeDefinitionId,
        physicsProfileId: MAIN_GPU_ENEMY_PHYSICS_PROFILE_ID,
        combatProfileId: MAIN_GPU_ENEMY_COMBAT_PROFILE_ID,
        behaviorProfileId: options.behaviorProfileId
            ?? CORE_ROUTE_ENEMY_BEHAVIOR_PROFILE_ID,
        formationDefinitionId: options.formationDefinitionId ?? null,
        capabilityIds: options.capabilityIds
            ?? MAIN_GPU_ENEMY_DEFAULT_CAPABILITY_IDS,
        render
    }, ENEMY_PROFILE_CATALOG);
}
