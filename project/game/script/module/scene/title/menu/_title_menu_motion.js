/**
 * 값을 주어진 범위로 제한합니다.
 * @param {number} value - 제한할 값입니다.
 * @param {number} min - 최소값입니다.
 * @param {number} max - 최대값입니다.
 * @returns {number} 제한된 값입니다.
 */
export function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * 선형 보간을 수행합니다.
 * @param {number} startValue - 시작 값입니다.
 * @param {number} endValue - 종료 값입니다.
 * @param {number} progress - 0~1 범위 보간 비율입니다.
 * @returns {number} 보간 결과입니다.
 */
export function lerpValue(startValue, endValue, progress) {
    return startValue + ((endValue - startValue) * progress);
}

/**
 * 지수 감속 이징을 적용합니다.
 * @param {number} progress - 원본 진행률입니다.
 * @returns {number} 이징 적용 결과입니다.
 */
export function easeOutExpo(progress) {
    const clamped = clampNumber(progress, 0, 1);
    if (clamped <= 0) {
        return 0;
    }
    if (clamped >= 1) {
        return 1;
    }
    return 1 - Math.pow(2, -10 * clamped);
}

/**
 * 삼차 감속 이징을 적용합니다.
 * @param {number} progress - 원본 진행률입니다.
 * @returns {number} 이징 적용 결과입니다.
 */
export function easeOutCubic(progress) {
    const clamped = clampNumber(progress, 0, 1);
    return 1 - Math.pow(1 - clamped, 3);
}
