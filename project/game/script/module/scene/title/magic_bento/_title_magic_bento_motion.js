/**
 * 정삼각형의 높이 대비 너비 비율입니다.
 * @type {number}
 */
export const EQUILATERAL_TRIANGLE_WIDTH_RATIO = Math.sqrt(3) / 2;

export {
    clampNumber as clamp,
    dampNumber as damp,
    easeOutExpo,
    lerpNumber as lerp
} from 'util/number_util.js';
