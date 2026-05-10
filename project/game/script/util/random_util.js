import { resolveFiniteNumber } from './number_util.js';

/**
 * 지정 범위의 실수 난수를 반환합니다.
 * @param {number} min - 최솟값입니다.
 * @param {number} max - 최댓값입니다.
 * @returns {number} min 이상 max 미만의 난수입니다.
 */
export function randomRange(min, max) {
    const safeMin = resolveFiniteNumber(Number(min), 0);
    const safeMax = resolveFiniteNumber(Number(max), safeMin);
    return (Math.random() * (safeMax - safeMin)) + safeMin;
}

/**
 * 지정 범위의 정수 난수를 반환합니다.
 * @param {number} min - 최솟값입니다.
 * @param {number} max - 최댓값입니다.
 * @returns {number} min 이상 max 이하의 정수 난수입니다.
 */
export function randomIntInclusive(min, max) {
    const safeMin = Math.ceil(resolveFiniteNumber(Number(min), 0));
    const safeMax = Math.floor(resolveFiniteNumber(Number(max), safeMin));
    if (safeMax <= safeMin) {
        return safeMin;
    }

    return Math.floor(randomRange(safeMin, safeMax + 1));
}
