import { getData } from 'data/data_handler.js';
import { randomRange } from 'util/random_util.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_LOADING = TITLE_CONSTANTS.TITLE_LOADING;

/**
 * 가짜 로딩 체크포인트를 생성합니다.
 * @returns {Array<{targetProgress:number, endTime:number}>} 목표 진행률과 도달 시간 리스트입니다.
 */
export function buildTitleLoadingSchedule() {
    return [
        {
            targetProgress: randomRange(0.2, 0.4),
            endTime: randomRange(0.6, 1)
        },
        {
            targetProgress: randomRange(0.7, 0.85),
            endTime: randomRange(1.4, 1.8)
        },
        {
            targetProgress: TITLE_LOADING.COMPLETE_PROGRESS,
            endTime: randomRange(2.2, 2.5)
        }
    ];
}
