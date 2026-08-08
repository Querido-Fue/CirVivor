import {
    ARCHER_ENEMY_DATA
} from './archer_enemy_data.js';
import {
    createMainGpuEnemyDefinition
} from './main_gpu_enemy_definition_data.js';

export {
    MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES,
    MAIN_GPU_ENEMY_COLOR_RGBA,
    MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE
} from './main_gpu_enemy_definition_data.js';

/** main GPU wave에서 사용하는 시각 archetype 6종의 불변 선언입니다. */
export const BASIC_SQUARE_ENEMY_DATA = createMainGpuEnemyDefinition(
    'basic_square_01',
    'square'
);
export const BASIC_TRIANGLE_ENEMY_DATA = createMainGpuEnemyDefinition(
    'basic_triangle_01',
    'triangle'
);
export const BASIC_ARROW_ENEMY_DATA = createMainGpuEnemyDefinition(
    'basic_arrow_01',
    'arrow'
);
export const BASIC_PENTA_ENEMY_DATA = createMainGpuEnemyDefinition(
    'basic_penta_01',
    'penta'
);
export const BASIC_HEXA_ENEMY_DATA = createMainGpuEnemyDefinition(
    'basic_hexa_01',
    'hexa'
);
export const BASIC_GEN_ENEMY_DATA = createMainGpuEnemyDefinition(
    'basic_gen_01',
    'gen'
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
    BASIC_GEN_ENEMY_DATA
]);

/** 적 definition ID를 선언 데이터로 해석하는 읽기 전용 catalog입니다. */
export const INGAME_ENEMY_DEFINITION_BY_ID = Object.freeze(
    Object.fromEntries([
        ...INGAME_ENEMY_DEFINITIONS,
        BASIC_CIRCLE_ENEMY_DATA,
        ARCHER_ENEMY_DATA
    ].map((definition) => [definition.id, definition]))
);
