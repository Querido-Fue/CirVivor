export const COLLISION_BROAD_STRIDE = 14;
export const COLLISION_RELATION_BROAD_STRIDE = 8;
export const COLLISION_CONTACT_RESULT_STRIDE = 8;

export const COLLISION_BODY_KIND_NONE = 0;
export const COLLISION_BODY_KIND_ENEMY = 1;
export const COLLISION_BODY_KIND_PLAYER = 2;
export const COLLISION_BODY_KIND_WALL = 3;
export const COLLISION_BODY_KIND_PROJECTILE = 4;
export const COLLISION_BODY_KIND_ITEM = 5;

export const COLLISION_BODY_SHAPE_NONE = 0;
export const COLLISION_BODY_SHAPE_CIRCLE = 1;
export const COLLISION_BODY_SHAPE_CIRCLE_PARTS = 2;
export const COLLISION_BODY_SHAPE_RECT = 3;

export const COLLISION_RELATION_INDEX = Object.freeze({
    MIN_X: 0,
    MAX_X: 1,
    MIN_Y: 2,
    MAX_Y: 3,
    CENTER_X: 4,
    CENTER_Y: 5,
    ENEMY_PAIR_RADIUS: 6,
    PROJECTILE_RADIUS: 7
});

export const COLLISION_CONTACT_RESULT_INDEX = Object.freeze({
    PAIR_INDEX: 0,
    BODY_A_INDEX: 1,
    BODY_B_INDEX: 2,
    NORMAL_X: 3,
    NORMAL_Y: 4,
    PENETRATION: 5,
    POINT_X: 6,
    POINT_Y: 7
});

/**
 * body kind 문자열을 SoA 레이아웃용 숫자 코드로 변환합니다.
 * @param {string|null|undefined} kind
 * @returns {number}
 */
export function getCollisionBodyKindCode(kind) {
    if (kind === 'enemy') return COLLISION_BODY_KIND_ENEMY;
    if (kind === 'player') return COLLISION_BODY_KIND_PLAYER;
    if (kind === 'wall') return COLLISION_BODY_KIND_WALL;
    if (kind === 'projectile') return COLLISION_BODY_KIND_PROJECTILE;
    if (kind === 'item') return COLLISION_BODY_KIND_ITEM;
    return COLLISION_BODY_KIND_NONE;
}

/**
 * body shape 문자열을 SoA 레이아웃용 숫자 코드로 변환합니다.
 * @param {string|null|undefined} shape
 * @returns {number}
 */
export function getCollisionBodyShapeCode(shape) {
    if (shape === 'circle') return COLLISION_BODY_SHAPE_CIRCLE;
    if (shape === 'circleParts') return COLLISION_BODY_SHAPE_CIRCLE_PARTS;
    if (shape === 'rect') return COLLISION_BODY_SHAPE_RECT;
    return COLLISION_BODY_SHAPE_NONE;
}
