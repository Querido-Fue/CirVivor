import { getData } from 'data/data_handler.js';

const HEXA_HIVE_LAYOUT_DATA = getData('HEXA_HIVE_LAYOUT_DATA');

/**
 * 육각형 합체 레이아웃 스키마 버전입니다.
 * @type {number}
 */
export const HEXA_HIVE_LAYOUT_SCHEMA_VERSION = HEXA_HIVE_LAYOUT_DATA.SCHEMA_VERSION;

/**
 * 육각형 합체 적 타입 문자열입니다.
 * @type {string}
 */
export const HEXA_HIVE_TYPE = HEXA_HIVE_LAYOUT_DATA.TYPE;

/**
 * 정규화된 육각형 기본 반지름입니다.
 * @type {number}
 */
export const HEXA_NORMALIZED_RADIUS = HEXA_HIVE_LAYOUT_DATA.NORMALIZED_RADIUS;

/**
 * 합체 적 전경 조각 렌더 스케일입니다.
 * @type {number}
 */
export const HEXA_HIVE_FRONT_RENDER_SCALE = HEXA_HIVE_LAYOUT_DATA.FRONT_RENDER_SCALE;

/**
 * 합체 적 배경 실루엣 렌더 스케일입니다.
 * @type {number}
 */
export const HEXA_HIVE_BACKDROP_RENDER_SCALE = HEXA_HIVE_LAYOUT_DATA.BACKDROP_RENDER_SCALE;

/**
 * 합체 적 외곽선 두께 비율입니다.
 * @type {number}
 */
export const HEXA_HIVE_OUTLINE_THICKNESS_RATIO = HEXA_HIVE_LAYOUT_DATA.OUTLINE_THICKNESS_RATIO;

/**
 * 레이아웃 계산용 부동소수 허용 오차입니다.
 * @type {number}
 */
export const EPSILON = HEXA_HIVE_LAYOUT_DATA.EPSILON;

/**
 * 정점 좌표를 key로 만들 때 사용하는 정밀도 배율입니다.
 * @type {number}
 */
export const VERTEX_KEY_SCALE = HEXA_HIVE_LAYOUT_DATA.VERTEX_KEY_SCALE;

/**
 * axial 인접 방향 목록입니다.
 * @type {{q:number, r:number}[]}
 */
export const HEXA_AXIAL_DIRECTIONS = HEXA_HIVE_LAYOUT_DATA.AXIAL_DIRECTIONS;

/**
 * 노출 edge 방향 목록입니다.
 * @type {{q:number, r:number}[]}
 */
export const HEXA_EXPOSED_EDGE_DIRECTIONS = HEXA_HIVE_LAYOUT_DATA.EXPOSED_EDGE_DIRECTIONS;

/**
 * 셀 중심 기준 로컬 꼭짓점 목록입니다.
 * @type {{x:number, y:number}[]}
 */
export const HEXA_LOCAL_VERTICES = HEXA_HIVE_LAYOUT_DATA.LOCAL_VERTICES;
