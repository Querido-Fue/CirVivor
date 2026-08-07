import {
    LEGACY_SQUARE_ENEMY_COLLISION_RADIUS_TILES
} from './enemy_shape_geometry_data.js';

/**
 * 신규 플레이의 GPU 적은 원형 collider를 공유합니다. 기존 절반 반경에 정확히
 * 1.3을 곱한 값으로, legacy 1타일 square 외접 원 반경의 0.65배입니다.
 * body ABI와 렌더가 이 기본값을 함께 사용하며 shape별 별도 반경은 두지 않습니다.
 * 적-적 physical solve의 유효 반경만 아래 pair scale로 별도 조정합니다.
 */
export const MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES = (
    LEGACY_SQUARE_ENEMY_COLLISION_RADIUS_TILES / 2
) * 1.3;

/**
 * 적-적 physical solve에서 각 적의 기본 body radius 중 사용하는 비율입니다.
 * 렌더와 다른 collision/interaction pair의 반경은 그대로 유지합니다.
 */
export const MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE = 0.8;

const MAIN_GPU_ENEMY_COLOR_RGBA = Object.freeze([
    1,
    0.4235294117647059,
    0.4235294117647059,
    1
]);

function createMainGpuEnemyDefinition(id, shapeType) {
    return Object.freeze({
        id,
        shapeType,
        // legacy 기본 steering의 40 px/s와 16 px navigation cell을 타일 grid로 환산합니다.
        moveSpeedTilesPerSecond: 2.5,
        collisionRadiusTiles: MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES,
        collisionWeight: 1,
        maxHealth: 1,
        colorRgba: MAIN_GPU_ENEMY_COLOR_RGBA,
        radiusScale: 1
    });
}

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
        BASIC_CIRCLE_ENEMY_DATA
    ].map((definition) => [definition.id, definition]))
);
