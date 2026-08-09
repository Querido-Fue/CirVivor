import {
    ARCHER_ENEMY_DATA
} from './archer_enemy_data.js';
import {
    createMainGpuEnemyDefinition,
    MAIN_GPU_ENEMY_COLOR_RGBA,
    MAIN_GPU_ENEMY_DEFAULT_CAPABILITY_IDS
} from './main_gpu_enemy_definition_data.js';
import {
    ENEMY_CAPABILITY_ID
} from 'ingame/contract/enemy_capability_contract.js';
import {
    normalizeEnemyDefinition
} from 'ingame/contract/enemy_profile_contract.js';
import {
    ARROW_TOWER_CHARGE_ENEMY_BEHAVIOR_PROFILE_ID,
    ENEMY_PROFILE_CATALOG,
    TRIANGLE_FAST_LIGHT_ENEMY_BEHAVIOR_PROFILE_ID,
    TRIANGLE_FAST_LIGHT_ENEMY_COMBAT_PROFILE_ID,
    TRIANGLE_FAST_LIGHT_ENEMY_PHYSICS_PROFILE_ID
} from './enemy_profile_catalog_data.js';
import {
    BASIC_RHOM_ENEMY_DEFINITION_SOURCE
} from './basic_rhom_enemy_data.js';
import {
    BASIC_PENTA_ENEMY_DATA
} from './basic_penta_enemy_data.js';

export {
    MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES,
    MAIN_GPU_ENEMY_COLOR_RGBA,
    MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE
} from './main_gpu_enemy_definition_data.js';
export { BASIC_PENTA_ENEMY_DATA } from './basic_penta_enemy_data.js';

/** main GPU wave에서 사용하는 시각 archetype 6종의 불변 선언입니다. */
export const BASIC_SQUARE_ENEMY_DATA = createMainGpuEnemyDefinition(
    'basic_square_01',
    'square'
);
export const BASIC_TRIANGLE_ENEMY_DATA = normalizeEnemyDefinition(
    Object.freeze({
        id: 'basic_triangle_01',
        shapeDefinitionId: 'triangle',
        physicsProfileId: TRIANGLE_FAST_LIGHT_ENEMY_PHYSICS_PROFILE_ID,
        combatProfileId: TRIANGLE_FAST_LIGHT_ENEMY_COMBAT_PROFILE_ID,
        behaviorProfileId: TRIANGLE_FAST_LIGHT_ENEMY_BEHAVIOR_PROFILE_ID,
        capabilityIds: MAIN_GPU_ENEMY_DEFAULT_CAPABILITY_IDS,
        render: Object.freeze({
            colorRgba: MAIN_GPU_ENEMY_COLOR_RGBA,
            radiusScale: 1
        })
    }),
    ENEMY_PROFILE_CATALOG
);
export const BASIC_ARROW_ENEMY_DATA = createMainGpuEnemyDefinition(
    'basic_arrow_01',
    'arrow',
    {
        behaviorProfileId: ARROW_TOWER_CHARGE_ENEMY_BEHAVIOR_PROFILE_ID,
        capabilityIds: Object.freeze([
            ENEMY_CAPABILITY_ID.NAVIGATION,
            ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
            ENEMY_CAPABILITY_ID.CORE_IMPACT,
            ENEMY_CAPABILITY_ID.CHARGE
        ])
    }
);
export const BASIC_HEXA_ENEMY_DATA = createMainGpuEnemyDefinition(
    'basic_hexa_01',
    'hexa'
);
export const BASIC_GEN_ENEMY_DATA = createMainGpuEnemyDefinition(
    'basic_gen_01',
    'gen'
);
export const BASIC_RHOM_ENEMY_DATA = normalizeEnemyDefinition(
    BASIC_RHOM_ENEMY_DEFINITION_SOURCE,
    ENEMY_PROFILE_CATALOG
);

/**
 * @deprecated 새 메인 wave catalog에는 포함하지 않는 legacy 원형 definition입니다.
 * 기존 import/저장 데이터의 content identity를 보존하기 위해 독립 객체로 유지합니다.
 */
export const BASIC_CIRCLE_ENEMY_DATA = createMainGpuEnemyDefinition(
    'basic_circle_01',
    'circle'
);

export const INGAME_ENEMY_DEFINITIONS = Object.freeze([
    BASIC_SQUARE_ENEMY_DATA,
    BASIC_TRIANGLE_ENEMY_DATA,
    BASIC_ARROW_ENEMY_DATA,
    BASIC_PENTA_ENEMY_DATA,
    BASIC_HEXA_ENEMY_DATA,
    BASIC_GEN_ENEMY_DATA,
    BASIC_RHOM_ENEMY_DATA
]);

/** 적 definition ID를 선언 데이터로 해석하는 읽기 전용 catalog입니다. */
export const INGAME_ENEMY_DEFINITION_BY_ID = Object.freeze(
    Object.fromEntries([
        ...INGAME_ENEMY_DEFINITIONS,
        BASIC_CIRCLE_ENEMY_DATA,
        ARCHER_ENEMY_DATA
    ].map((definition) => [definition.id, definition]))
);
