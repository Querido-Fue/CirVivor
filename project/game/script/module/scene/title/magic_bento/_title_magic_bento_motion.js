/**
 * 정삼각형의 높이 대비 너비 비율입니다.
 * @type {number}
 */
export const EQUILATERAL_TRIANGLE_WIDTH_RATIO = Math.sqrt(3) / 2;

/**
 * 값을 지정 범위로 제한합니다.
 * @param {number} value - 보정할 값
 * @param {number} min - 최소값
 * @param {number} max - 최대값
 * @returns {number} 제한된 값
 */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * 두 값 사이를 선형 보간합니다.
 * @param {number} start - 시작값
 * @param {number} end - 종료값
 * @param {number} progress - 0~1 범위 진행률
 * @returns {number} 보간 결과
 */
export function lerp(start, end, progress) {
    return start + ((end - start) * progress);
}

/**
 * 현재 값이 목표값으로 부드럽게 수렴하도록 보간합니다.
 * @param {number} current - 현재값
 * @param {number} target - 목표값
 * @param {number} speed - 프레임 기반 수렴 속도
 * @returns {number} 보간된 값
 */
export function damp(current, target, speed) {
    return lerp(current, target, clamp(speed, 0, 1));
}

/**
 * 0~1 범위 진행률에 지수형 감속 이징을 적용합니다.
 * @param {number} progress - 원본 진행률
 * @returns {number} 이징이 적용된 진행률
 */
export function easeOutExpo(progress) {
    if (progress <= 0) {
        return 0;
    }
    if (progress >= 1) {
        return 1;
    }
    return 1 - Math.pow(2, -10 * progress);
}
