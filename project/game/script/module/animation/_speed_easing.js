import { clampFiniteNumber } from 'util/number_util.js';

const EASING_DERIVATIVE_STEP = 0.0001;

/**
 * 기존 easing 곡선의 현재 순간 속도를 수치 미분으로 계산합니다.
 * retarget 시점에만 호출되므로 frame hot path에 반복 비용을 추가하지 않습니다.
 * @param {Function} easingFn - 0~1 진행률을 보간 비율로 바꾸는 함수입니다.
 * @param {number} startValue - 애니메이션 시작값입니다.
 * @param {number} endValue - 애니메이션 종료값입니다.
 * @param {number} duration - 애니메이션 지속 시간(초)입니다.
 * @param {number} progress - 현재 0~1 진행률입니다.
 * @returns {number} 초당 값 변화량입니다.
 */
export function getEasedVelocity(
    easingFn,
    startValue,
    endValue,
    duration,
    progress
) {
    if (typeof easingFn !== 'function'
        || !Number.isFinite(duration)
        || duration <= 0) {
        return 0;
    }

    const safeProgress = clampFiniteNumber(progress, 0, 1, 0);
    if (safeProgress >= 1) {
        return 0;
    }

    const lowerProgress = Math.max(0, safeProgress - EASING_DERIVATIVE_STEP);
    const upperProgress = Math.min(
        1 - Number.EPSILON,
        safeProgress + EASING_DERIVATIVE_STEP
    );
    const progressSpan = upperProgress - lowerProgress;
    if (progressSpan <= 0) {
        return 0;
    }

    const lowerValue = easingFn(lowerProgress);
    const upperValue = easingFn(upperProgress);
    const normalizedVelocity = (upperValue - lowerValue) / progressSpan;
    const valueDistance = endValue - startValue;
    const velocity = (valueDistance * normalizedVelocity) / duration;
    return Number.isFinite(velocity) ? velocity : 0;
}

/**
 * 시작 속도를 유지하고 종료 속도를 0으로 수렴시키는 cubic Hermite 값을 계산합니다.
 * @param {number} startValue - retarget 시점의 현재 값입니다.
 * @param {number} endValue - 새 목표값입니다.
 * @param {number} startVelocity - retarget 직전 순간 속도입니다.
 * @param {number} duration - 새 애니메이션 지속 시간(초)입니다.
 * @param {number} progress - 현재 0~1 진행률입니다.
 * @returns {number} 보간된 값입니다.
 */
export function getSpeedEasedValue(
    startValue,
    endValue,
    startVelocity,
    duration,
    progress
) {
    const safeProgress = clampFiniteNumber(progress, 0, 1, 0);
    if (!Number.isFinite(duration) || duration <= 0) {
        return endValue;
    }

    const t2 = safeProgress * safeProgress;
    const t3 = t2 * safeProgress;
    const h00 = (2 * t3) - (3 * t2) + 1;
    const h10 = t3 - (2 * t2) + safeProgress;
    const h01 = (-2 * t3) + (3 * t2);
    const startTangent = (Number.isFinite(startVelocity) ? startVelocity : 0) * duration;
    return (h00 * startValue)
        + (h10 * startTangent)
        + (h01 * endValue);
}

/**
 * cubic Hermite speed easing의 현재 순간 속도를 계산합니다.
 * @param {number} startValue - retarget 시점의 현재 값입니다.
 * @param {number} endValue - 새 목표값입니다.
 * @param {number} startVelocity - retarget 직전 순간 속도입니다.
 * @param {number} duration - 새 애니메이션 지속 시간(초)입니다.
 * @param {number} progress - 현재 0~1 진행률입니다.
 * @returns {number} 초당 값 변화량입니다.
 */
export function getSpeedEasedVelocity(
    startValue,
    endValue,
    startVelocity,
    duration,
    progress
) {
    if (!Number.isFinite(duration) || duration <= 0) {
        return 0;
    }

    const safeProgress = clampFiniteNumber(progress, 0, 1, 0);
    if (safeProgress >= 1) {
        return 0;
    }

    const t2 = safeProgress * safeProgress;
    const dh00 = (6 * t2) - (6 * safeProgress);
    const dh10 = (3 * t2) - (4 * safeProgress) + 1;
    const dh01 = (-6 * t2) + (6 * safeProgress);
    const startTangent = (Number.isFinite(startVelocity) ? startVelocity : 0) * duration;
    const velocity = (
        (dh00 * startValue)
        + (dh10 * startTangent)
        + (dh01 * endValue)
    ) / duration;
    return Number.isFinite(velocity) ? velocity : 0;
}
