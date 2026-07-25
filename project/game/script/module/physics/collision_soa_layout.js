/** broad-phase SoA 레코드 stride입니다. */
export const COLLISION_BROAD_STRIDE = 14;
/** enemy relation SoA 레코드 stride입니다. */
export const COLLISION_RELATION_BROAD_STRIDE = 8;
/** enemy 후보 sweep SoA 레코드 stride입니다. */
export const COLLISION_CANDIDATE_SWEEP_STRIDE = 8;
/** contact 결과 SoA 레코드 stride입니다. */
export const COLLISION_CONTACT_RESULT_STRIDE = 8;

/** 등록되지 않은 충돌 body kind 코드입니다. */
export const COLLISION_BODY_KIND_NONE = 0;
/** 적 충돌 body kind 코드입니다. */
export const COLLISION_BODY_KIND_ENEMY = 1;
/** 플레이어 충돌 body kind 코드입니다. */
export const COLLISION_BODY_KIND_PLAYER = 2;
/** 벽 충돌 body kind 코드입니다. */
export const COLLISION_BODY_KIND_WALL = 3;
/** 투사체 충돌 body kind 코드입니다. */
export const COLLISION_BODY_KIND_PROJECTILE = 4;
/** 아이템 충돌 body kind 코드입니다. */
export const COLLISION_BODY_KIND_ITEM = 5;

/** 등록되지 않은 충돌 body shape 코드입니다. */
export const COLLISION_BODY_SHAPE_NONE = 0;
/** 원형 충돌 body shape 코드입니다. */
export const COLLISION_BODY_SHAPE_CIRCLE = 1;
/** 원형 part 묶음 충돌 body shape 코드입니다. */
export const COLLISION_BODY_SHAPE_CIRCLE_PARTS = 2;
/** 사각형 충돌 body shape 코드입니다. */
export const COLLISION_BODY_SHAPE_RECT = 3;

const COLLISION_BODY_KIND_CODE_BY_NAME = Object.freeze({
    enemy: COLLISION_BODY_KIND_ENEMY,
    player: COLLISION_BODY_KIND_PLAYER,
    wall: COLLISION_BODY_KIND_WALL,
    projectile: COLLISION_BODY_KIND_PROJECTILE,
    item: COLLISION_BODY_KIND_ITEM
});
const COLLISION_BODY_SHAPE_CODE_BY_NAME = Object.freeze({
    circle: COLLISION_BODY_SHAPE_CIRCLE,
    circleParts: COLLISION_BODY_SHAPE_CIRCLE_PARTS,
    rect: COLLISION_BODY_SHAPE_RECT
});

/** enemy relation SoA 필드 index 매핑입니다. */
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
/** enemy 후보 sweep SoA 필드 index 매핑입니다. */
export const COLLISION_CANDIDATE_SWEEP_INDEX = Object.freeze({
    MIN_X: 0,
    MAX_X: 1,
    MIN_Y: 2,
    MAX_Y: 3,
    CENTER_X: 4,
    CENTER_Y: 5,
    RADIUS: 6,
    PAD: 7
});
/** contact 결과 SoA 필드 index 매핑입니다. */
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
