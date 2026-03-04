/**
 * 적을 렌더링할 때 화면 높이에 대비한 비율 상향치
 */
export const ENEMY_DRAW_HEIGHT_RATIO = 0.03;/**
 * 게임 내 적의 형태 종류 목록
 */
export const ENEMY_SHAPE_TYPES = Object.freeze([
    'square',
    'triangle',
    'arrow',
    'hexa',
    'penta',
    'rhom',
    'octa',
    'gen'
]);/**
 * 각 적 형태별 종횡비 (너비/높이)
 */
export const ENEMY_ASPECT_RATIO = Object.freeze({
    square: 1.0,
    triangle: 1.0,
    arrow: 0.96,
    hexa: 1.0,
    penta: 1.0,
    rhom: 0.81,
    octa: 1.0,
    gen: 1.05
});/**
 * 각 적 형태별 렌더링 높이 보정 비율
 */
export const ENEMY_HEIGHT_SCALE = Object.freeze({
    square: 1.0,
    triangle: 1.0,
    arrow: 0.9,
    hexa: 1.0,
    penta: 1.0,
    rhom: 1.0,
    octa: 1.0,
    gen: 1.0
});/**
 * 특정 형태 종류를 기반으로 적의 스프라이트 키를 반환합니다.
 * @param {string} type 적 형태 종류 (예: 'square', 'hexa')
 * @returns {string} 스프라이트 식별용 키
 */
export const getEnemyShapeKey = (type) => {
    return `enemy_${type}`;
};/**
 * WebGL 렌더링에 사용되는 적의 모든 형태 키 목록
 */
export const ENEMY_WEBGL_SHAPES = Object.freeze(
    ENEMY_SHAPE_TYPES.map((type) => getEnemyShapeKey(type))
);
