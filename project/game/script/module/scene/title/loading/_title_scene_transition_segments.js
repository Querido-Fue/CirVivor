import { clampFiniteNumber } from 'util/number_util.js';

const EXPO_BOUNDARY_SLOPE = 10 * Math.LN2;

/**
 * 가속·등속·감속 구간의 경계 속도가 이어지는 전환 세그먼트를 만듭니다.
 * @param {object} options - 세그먼트 생성 옵션입니다.
 * @param {number} options.startValue - 전체 전환 시작값입니다.
 * @param {number} options.endValue - 전체 전환 종료값입니다.
 * @param {object} options.motion - 구간별 지속시간과 easing 설정입니다.
 * @returns {Array<{startValue:number,endValue:number,duration:number,delay:number,type:string}>} MixedAnimation 세그먼트입니다.
 */
export function buildTitleSceneTransitionSegments({ startValue, endValue, motion }) {
    const safeStartValue = Number.isFinite(startValue) ? startValue : 0;
    const safeEndValue = Number.isFinite(endValue) ? endValue : safeStartValue;
    const accelDuration = clampFiniteNumber(motion?.ACCEL?.DURATION, 0, Infinity, 0);
    const cruiseDuration = clampFiniteNumber(motion?.CRUISE?.DURATION, 0, Infinity, 0);
    const decelDuration = clampFiniteNumber(motion?.DECEL?.DURATION, 0, Infinity, 0);
    const velocityWeightedDuration = (accelDuration / EXPO_BOUNDARY_SLOPE)
        + cruiseDuration
        + (decelDuration / EXPO_BOUNDARY_SLOPE);

    if (!(velocityWeightedDuration > 0)) {
        return [{
            startValue: safeStartValue,
            endValue: safeEndValue,
            duration: 0,
            delay: 0,
            type: 'linear'
        }];
    }

    const cruiseVelocity = (safeEndValue - safeStartValue) / velocityWeightedDuration;
    const accelEndValue = safeStartValue
        + ((cruiseVelocity * accelDuration) / EXPO_BOUNDARY_SLOPE);
    const cruiseEndValue = accelEndValue + (cruiseVelocity * cruiseDuration);

    return [
        {
            startValue: safeStartValue,
            endValue: accelEndValue,
            duration: accelDuration,
            delay: 0,
            type: motion?.ACCEL?.EASING || 'easeInExpo'
        },
        {
            startValue: accelEndValue,
            endValue: cruiseEndValue,
            duration: cruiseDuration,
            delay: accelDuration,
            type: motion?.CRUISE?.EASING || 'linear'
        },
        {
            startValue: cruiseEndValue,
            endValue: safeEndValue,
            duration: decelDuration,
            delay: accelDuration + cruiseDuration,
            type: motion?.DECEL?.EASING || 'easeOutExpo'
        }
    ];
}
