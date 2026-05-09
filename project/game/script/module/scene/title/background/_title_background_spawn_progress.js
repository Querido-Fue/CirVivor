import { clampFiniteNumber, clampNumber } from 'util/number_util.js';

/**
 * 초기 버스트 누적 스폰 비율을 easeOutExpo 형태로 반환합니다.
 * @param {number} progress - 0~1 범위의 진행률입니다.
 * @param {number} [expoPower=10] - 감속 이징 지수입니다.
 * @returns {number} 누적 스폰 비율입니다.
 */
export function getTitleInitialBurstSpawnProgress(progress, expoPower = 10) {
    const clampedProgress = clampFiniteNumber(progress, 0, 1, 0);
    if (clampedProgress >= 1) {
        return 1;
    }

    const normalizedExpoPower = clampFiniteNumber(expoPower, 1, Infinity, 10);
    return 1 - Math.pow(2, -(normalizedExpoPower * clampedProgress));
}

/**
 * 현재 초기 버스트 시점에서 누적되어야 할 목표 생성 수를 반환합니다.
 * @param {number} elapsedSeconds - 현재까지 지난 시간(초)입니다.
 * @param {number} burstTargetCount - 계층별 초기 버스트 목표 적 수입니다.
 * @param {number} burstDuration - 초기 버스트 전체 지속 시간(초)입니다.
 * @param {number} [expoPower=10] - 감속 이징 지수입니다.
 * @returns {number} 누적 목표 생성 수입니다.
 */
export function getTitleInitialBurstDesiredSpawnCount(
    elapsedSeconds,
    burstTargetCount,
    burstDuration,
    expoPower = 10
) {
    if (!(Number.isFinite(burstTargetCount) && burstTargetCount > 0)) {
        return 0;
    }
    if (!(Number.isFinite(burstDuration) && burstDuration > 0)) {
        return burstTargetCount;
    }

    const progress = elapsedSeconds / burstDuration;
    const easedProgress = getTitleInitialBurstSpawnProgress(progress, expoPower);
    return clampNumber(Math.round(burstTargetCount * easedProgress), 0, burstTargetCount);
}
