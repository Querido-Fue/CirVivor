import {
    LEGACY_SQUARE_ENEMY_COLLISION_RADIUS_TILES
} from './enemy_shape_geometry_data.js';

/**
 * 신규 플레이의 GPU 적이 공유하는 원형 collider 반경입니다.
 * legacy 1타일 square 외접 원 반경의 0.65배를 단일 권위로 유지합니다.
 */
export const MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES = (
    LEGACY_SQUARE_ENEMY_COLLISION_RADIUS_TILES / 2
) * 1.3;

/** 적-적 physical solve에서 각 적의 기본 body radius 중 사용하는 비율입니다. */
export const MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE = 0.8;

/** main GPU enemy archetype이 공유하는 불변 hostile color입니다. */
export const MAIN_GPU_ENEMY_COLOR_RGBA = Object.freeze([
    1,
    0.4235294117647059,
    0.4235294117647059,
    1
]);

/**
 * main GPU enemy의 공통 Core-route 수치를 한 definition으로 조합합니다.
 * content별 필드는 공통 gameplay 수치를 덮어쓸 수 없습니다.
 */
export function createMainGpuEnemyDefinition(
    id,
    shapeType,
    contentFields = {}
) {
    return Object.freeze({
        ...contentFields,
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
