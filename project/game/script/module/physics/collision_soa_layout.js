import { getData } from 'data/data_handler.js';

const COLLISION_SOA_LAYOUT = getData('COLLISION_CONSTANTS').SOA_LAYOUT;
const COLLISION_BODY_KIND = COLLISION_SOA_LAYOUT.BODY_KIND;
const COLLISION_BODY_SHAPE = COLLISION_SOA_LAYOUT.BODY_SHAPE;

export const COLLISION_BROAD_STRIDE = COLLISION_SOA_LAYOUT.BROAD_STRIDE;
export const COLLISION_RELATION_BROAD_STRIDE = COLLISION_SOA_LAYOUT.RELATION_BROAD_STRIDE;
export const COLLISION_CONTACT_RESULT_STRIDE = COLLISION_SOA_LAYOUT.CONTACT_RESULT_STRIDE;

export const COLLISION_BODY_KIND_NONE = COLLISION_BODY_KIND.NONE;
export const COLLISION_BODY_KIND_ENEMY = COLLISION_BODY_KIND.ENEMY;
export const COLLISION_BODY_KIND_PLAYER = COLLISION_BODY_KIND.PLAYER;
export const COLLISION_BODY_KIND_WALL = COLLISION_BODY_KIND.WALL;
export const COLLISION_BODY_KIND_PROJECTILE = COLLISION_BODY_KIND.PROJECTILE;
export const COLLISION_BODY_KIND_ITEM = COLLISION_BODY_KIND.ITEM;

export const COLLISION_BODY_SHAPE_NONE = COLLISION_BODY_SHAPE.NONE;
export const COLLISION_BODY_SHAPE_CIRCLE = COLLISION_BODY_SHAPE.CIRCLE;
export const COLLISION_BODY_SHAPE_CIRCLE_PARTS = COLLISION_BODY_SHAPE.CIRCLE_PARTS;
export const COLLISION_BODY_SHAPE_RECT = COLLISION_BODY_SHAPE.RECT;

export const COLLISION_RELATION_INDEX = COLLISION_SOA_LAYOUT.RELATION_INDEX;
export const COLLISION_CONTACT_RESULT_INDEX = COLLISION_SOA_LAYOUT.CONTACT_RESULT_INDEX;

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
