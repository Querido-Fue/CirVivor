import { getData } from 'data/data_handler.js';

const TITLE_LOGO_DATA = getData('TITLE_LOGO_DATA');

/**
 * 로고 재생 상태를 다음 프레임으로 진행합니다.
 * @param {object} options - 재생 상태 옵션입니다.
 * @param {number} options.elapsed - 현재 누적 재생 시간입니다.
 * @param {number} options.delta - 이번 프레임 경과 시간입니다.
 * @param {boolean} options.isPlaying - 현재 재생 중인지 여부입니다.
 * @param {boolean} options.isFinished - 이미 완료되었는지 여부입니다.
 * @param {number} [options.totalDuration] - 전체 재생 시간입니다.
 * @returns {{elapsed:number, isPlaying:boolean, isFinished:boolean, elapsedChanged:boolean}} 갱신된 재생 상태입니다.
 */
export function advanceTitleLogoPlayback({
    elapsed,
    delta,
    isPlaying,
    isFinished,
    totalDuration = TITLE_LOGO_DATA.TOTAL_DURATION
}) {
    const safeElapsed = Number.isFinite(elapsed) ? elapsed : 0;
    const safeDuration = Math.max(0, Number.isFinite(totalDuration) ? totalDuration : 0);
    if (!isPlaying || isFinished || !Number.isFinite(delta) || delta <= 0) {
        return {
            elapsed: safeElapsed,
            isPlaying,
            isFinished,
            elapsedChanged: false
        };
    }

    const nextElapsed = Math.min(safeDuration, safeElapsed + delta);
    const nextFinished = nextElapsed >= safeDuration;
    return {
        elapsed: nextElapsed,
        isPlaying: nextFinished ? false : isPlaying,
        isFinished: nextFinished,
        elapsedChanged: nextElapsed !== safeElapsed
    };
}

/**
 * 누적 재생 시간에서 0~1 범위의 로고 재생 진행률을 계산합니다.
 * @param {number} elapsed - 누적 재생 시간입니다.
 * @param {number} [totalDuration] - 전체 재생 시간입니다.
 * @returns {number} 0~1 범위의 재생 진행률입니다.
 */
export function calculateTitleLogoPlaybackProgress(elapsed, totalDuration = TITLE_LOGO_DATA.TOTAL_DURATION) {
    const safeDuration = Number.isFinite(totalDuration) ? totalDuration : 0;
    if (safeDuration <= 0) {
        return 1;
    }

    const safeElapsed = Number.isFinite(elapsed) ? elapsed : 0;
    return Math.min(safeElapsed / safeDuration, 1);
}

/**
 * 지정한 재생 진행률까지 남은 시간을 계산합니다.
 * @param {number} elapsed - 현재 누적 재생 시간입니다.
 * @param {number} targetProgress - 0~1 범위 목표 진행률입니다.
 * @param {number} [totalDuration] - 전체 재생 시간입니다.
 * @returns {number} 남은 시간(초)입니다.
 */
export function calculateTitleLogoRemainingTimeToProgress(
    elapsed,
    targetProgress,
    totalDuration = TITLE_LOGO_DATA.TOTAL_DURATION
) {
    const safeDuration = Number.isFinite(totalDuration) ? totalDuration : 0;
    if (safeDuration <= 0) {
        return 0;
    }

    const safeElapsed = Number.isFinite(elapsed) ? elapsed : 0;
    const safeTargetProgress = Number.isFinite(targetProgress) ? targetProgress : 0;
    const clampedTargetProgress = Math.max(0, Math.min(1, safeTargetProgress));
    const targetElapsed = safeDuration * clampedTargetProgress;
    return Math.max(0, targetElapsed - safeElapsed);
}
