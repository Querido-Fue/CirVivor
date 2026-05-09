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
 * 유효하지 않은 숫자를 fallback으로 바꾼 뒤 주어진 범위로 제한합니다.
 * @param {number} value - 제한할 값입니다.
 * @param {number} min - 최소값입니다.
 * @param {number} max - 최대값입니다.
 * @param {number} [fallback=min] - 값이 유효하지 않을 때 사용할 값입니다.
 * @returns {number} 제한된 값입니다.
 */
export function clampFiniteNumber(value, min, max, fallback = min) {
    return clampNumber(Number.isFinite(value) ? value : fallback, min, max);
}

/**
 * 값을 0~1 범위로 제한합니다.
 * @param {number} value - 제한할 값입니다.
 * @returns {number} 0~1 범위 값입니다.
 */
export function clamp01(value) {
    return clampNumber(value, 0, 1);
}

/**
 * 두 숫자 사이를 선형 보간합니다.
 * @param {number} startValue - 시작 값입니다.
 * @param {number} endValue - 종료 값입니다.
 * @param {number} progress - 보간 비율입니다.
 * @returns {number} 보간 결과입니다.
 */
export function lerpNumber(startValue, endValue, progress) {
    return startValue + ((endValue - startValue) * progress);
}

/**
 * 현재 값이 목표값으로 부드럽게 수렴하도록 보간합니다.
 * @param {number} current - 현재 값입니다.
 * @param {number} target - 목표 값입니다.
 * @param {number} speed - 0~1 범위 수렴 속도입니다.
 * @returns {number} 보간된 값입니다.
 */
export function dampNumber(current, target, speed) {
    return lerpNumber(current, target, clamp01(speed));
}

/**
 * 지수 감속 이징을 적용합니다.
 * @param {number} progress - 원본 진행률입니다.
 * @returns {number} 이징 적용 결과입니다.
 */
export function easeOutExpo(progress) {
    const clamped = clamp01(progress);
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
    const clamped = clamp01(progress);
    return 1 - Math.pow(1 - clamped, 3);
}
