import { clampNumber } from 'util/number_util.js';

/**
 * 연속 입력 목표를 따라가는 프레임 독립 지수 보간 계수를 계산합니다.
 * 60Hz에서 smoothing 값과 같은 비율만큼 남은 거리를 줄이며 다른 FPS에서도 같은 감쇠를 유지합니다.
 * @param {number} smoothing - 0~1 범위의 60Hz 기준 스무딩 값입니다.
 * @param {number} deltaSeconds - 현재 프레임 델타(초)입니다.
 * @returns {number} 0~1 범위의 보간 계수입니다.
 */
export function getContinuousInputBlend(smoothing, deltaSeconds) {
    const clampedSmoothing = clampNumber(smoothing, 0, 0.999);
    const safeDelta = Math.max(0, deltaSeconds || 0);
    const frames = safeDelta * 60;
    return 1 - Math.pow(1 - clampedSmoothing, frames);
}
