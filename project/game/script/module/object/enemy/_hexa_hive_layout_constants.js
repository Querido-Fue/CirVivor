/**
 * 육각형 합체 레이아웃 스키마 버전입니다.
 * @type {number}
 */
export const HEXA_HIVE_LAYOUT_SCHEMA_VERSION = 1;

/**
 * 육각형 합체 적 타입 문자열입니다.
 * @type {string}
 */
export const HEXA_HIVE_TYPE = 'hexa_hive';

/**
 * 정규화된 육각형 기본 반지름입니다.
 * @type {number}
 */
export const HEXA_NORMALIZED_RADIUS = 0.47;

/**
 * 합체 적 전경 조각 렌더 스케일입니다.
 * @type {number}
 */
export const HEXA_HIVE_FRONT_RENDER_SCALE = 0.9;

/**
 * 합체 적 배경 실루엣 렌더 스케일입니다.
 * @type {number}
 */
export const HEXA_HIVE_BACKDROP_RENDER_SCALE = 1.14;

/**
 * 합체 적 외곽선 두께 비율입니다.
 * @type {number}
 */
export const HEXA_HIVE_OUTLINE_THICKNESS_RATIO = 0.12;

/**
 * 레이아웃 계산용 부동소수 허용 오차입니다.
 * @type {number}
 */
export const EPSILON = 1e-6;

/**
 * 정점 좌표를 key로 만들 때 사용하는 정밀도 배율입니다.
 * @type {number}
 */
export const VERTEX_KEY_SCALE = 10000;

/**
 * axial 인접 방향 목록입니다.
 * @type {{q:number, r:number}[]}
 */
export const HEXA_AXIAL_DIRECTIONS = Object.freeze([
    Object.freeze({ q: 1, r: 0 }),
    Object.freeze({ q: 1, r: -1 }),
    Object.freeze({ q: 0, r: -1 }),
    Object.freeze({ q: -1, r: 0 }),
    Object.freeze({ q: -1, r: 1 }),
    Object.freeze({ q: 0, r: 1 })
]);

/**
 * 노출 edge 방향 목록입니다.
 * @type {{q:number, r:number}[]}
 */
export const HEXA_EXPOSED_EDGE_DIRECTIONS = Object.freeze([
    Object.freeze({ q: 1, r: -1 }),
    Object.freeze({ q: 1, r: 0 }),
    Object.freeze({ q: 0, r: 1 }),
    Object.freeze({ q: -1, r: 1 }),
    Object.freeze({ q: -1, r: 0 }),
    Object.freeze({ q: 0, r: -1 })
]);

/**
 * 셀 중심 기준 로컬 꼭짓점 목록입니다.
 * @type {{x:number, y:number}[]}
 */
export const HEXA_LOCAL_VERTICES = Object.freeze([
    Object.freeze({ x: 0, y: -HEXA_NORMALIZED_RADIUS }),
    Object.freeze({
        x: Math.cos(-Math.PI / 6) * HEXA_NORMALIZED_RADIUS,
        y: Math.sin(-Math.PI / 6) * HEXA_NORMALIZED_RADIUS
    }),
    Object.freeze({
        x: Math.cos(Math.PI / 6) * HEXA_NORMALIZED_RADIUS,
        y: Math.sin(Math.PI / 6) * HEXA_NORMALIZED_RADIUS
    }),
    Object.freeze({ x: 0, y: HEXA_NORMALIZED_RADIUS }),
    Object.freeze({
        x: Math.cos((5 * Math.PI) / 6) * HEXA_NORMALIZED_RADIUS,
        y: Math.sin((5 * Math.PI) / 6) * HEXA_NORMALIZED_RADIUS
    }),
    Object.freeze({
        x: Math.cos((7 * Math.PI) / 6) * HEXA_NORMALIZED_RADIUS,
        y: Math.sin((7 * Math.PI) / 6) * HEXA_NORMALIZED_RADIUS
    })
]);
