import { getData } from 'data/data_handler.js';

const COLLISION_SOA_LAYOUT = getData('COLLISION_CONSTANTS').SOA_LAYOUT;
const COLLISION_BODY_KIND = COLLISION_SOA_LAYOUT.BODY_KIND;
const COLLISION_BODY_SHAPE = COLLISION_SOA_LAYOUT.BODY_SHAPE;
const COLLISION_BODY_KIND_CODE_BY_NAME = COLLISION_SOA_LAYOUT.BODY_KIND_CODE_BY_NAME;
const COLLISION_BODY_SHAPE_CODE_BY_NAME = COLLISION_SOA_LAYOUT.BODY_SHAPE_CODE_BY_NAME;

/** broad-phase SoA 레코드 stride입니다. */
export const COLLISION_BROAD_STRIDE = COLLISION_SOA_LAYOUT.BROAD_STRIDE;
/** enemy relation SoA 레코드 stride입니다. */
export const COLLISION_RELATION_BROAD_STRIDE = COLLISION_SOA_LAYOUT.RELATION_BROAD_STRIDE;
/** contact 결과 SoA 레코드 stride입니다. */
export const COLLISION_CONTACT_RESULT_STRIDE = COLLISION_SOA_LAYOUT.CONTACT_RESULT_STRIDE;

/** 등록되지 않은 충돌 body kind 코드입니다. */
export const COLLISION_BODY_KIND_NONE = COLLISION_BODY_KIND.NONE;
/** 적 충돌 body kind 코드입니다. */
export const COLLISION_BODY_KIND_ENEMY = COLLISION_BODY_KIND.ENEMY;
/** 플레이어 충돌 body kind 코드입니다. */
export const COLLISION_BODY_KIND_PLAYER = COLLISION_BODY_KIND.PLAYER;
/** 벽 충돌 body kind 코드입니다. */
export const COLLISION_BODY_KIND_WALL = COLLISION_BODY_KIND.WALL;
/** 투사체 충돌 body kind 코드입니다. */
export const COLLISION_BODY_KIND_PROJECTILE = COLLISION_BODY_KIND.PROJECTILE;
/** 아이템 충돌 body kind 코드입니다. */
export const COLLISION_BODY_KIND_ITEM = COLLISION_BODY_KIND.ITEM;

/** 등록되지 않은 충돌 body shape 코드입니다. */
export const COLLISION_BODY_SHAPE_NONE = COLLISION_BODY_SHAPE.NONE;
/** 원형 충돌 body shape 코드입니다. */
export const COLLISION_BODY_SHAPE_CIRCLE = COLLISION_BODY_SHAPE.CIRCLE;
/** 원형 part 묶음 충돌 body shape 코드입니다. */
export const COLLISION_BODY_SHAPE_CIRCLE_PARTS = COLLISION_BODY_SHAPE.CIRCLE_PARTS;
/** 사각형 충돌 body shape 코드입니다. */
export const COLLISION_BODY_SHAPE_RECT = COLLISION_BODY_SHAPE.RECT;

/** enemy relation SoA 필드 index 매핑입니다. */
export const COLLISION_RELATION_INDEX = COLLISION_SOA_LAYOUT.RELATION_INDEX;
/** contact 결과 SoA 필드 index 매핑입니다. */
export const COLLISION_CONTACT_RESULT_INDEX = COLLISION_SOA_LAYOUT.CONTACT_RESULT_INDEX;

/**
 * 정적 코드 매핑에서 유한 숫자 코드를 조회합니다.
 * @param {object} codeByName - 문자열 이름별 숫자 코드 매핑입니다.
 * @param {string|null|undefined} name - 조회할 문자열 이름입니다.
 * @param {number} fallbackCode - 매핑이 없을 때 반환할 코드입니다.
 * @returns {number} SoA 레이아웃용 숫자 코드입니다.
 */
function getCollisionLayoutCode(codeByName, name, fallbackCode) {
    const code = codeByName[name];
    return Number.isFinite(code) ? code : fallbackCode;
}

/**
 * body kind 문자열을 SoA 레이아웃용 숫자 코드로 변환합니다.
 * @param {string|null|undefined} kind - 충돌 body kind 문자열입니다.
 * @returns {number} SoA 레이아웃용 body kind 코드입니다.
 */
export function getCollisionBodyKindCode(kind) {
    return getCollisionLayoutCode(COLLISION_BODY_KIND_CODE_BY_NAME, kind, COLLISION_BODY_KIND_NONE);
}

/**
 * body shape 문자열을 SoA 레이아웃용 숫자 코드로 변환합니다.
 * @param {string|null|undefined} shape - 충돌 body shape 문자열입니다.
 * @returns {number} SoA 레이아웃용 body shape 코드입니다.
 */
export function getCollisionBodyShapeCode(shape) {
    return getCollisionLayoutCode(COLLISION_BODY_SHAPE_CODE_BY_NAME, shape, COLLISION_BODY_SHAPE_NONE);
}
