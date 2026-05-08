import { getData } from 'data/data_handler.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_LOADING = TITLE_CONSTANTS.TITLE_LOADING;

/**
 * 가짜 로딩 체크포인트를 생성합니다.
 * @returns {Array<{targetProgress:number, endTime:number}>} 목표 진행률과 도달 시간 리스트입니다.
 */
export function buildTitleLoadingSchedule() {
    return [
        {
            targetProgress: getRandomValueInRange(0.2, 0.4),
            endTime: getRandomValueInRange(0.6, 1)
        },
        {
            targetProgress: getRandomValueInRange(0.7, 0.85),
            endTime: getRandomValueInRange(1.4, 1.8)
        },
        {
            targetProgress: TITLE_LOADING.COMPLETE_PROGRESS,
            endTime: getRandomValueInRange(2.2, 2.5)
        }
    ];
}

/**
 * 주어진 범위 안에서 랜덤 실수 값을 반환합니다.
 * @param {number} min - 최소값입니다.
 * @param {number} max - 최대값입니다.
 * @returns {number} 랜덤으로 선택된 값입니다.
 */
function getRandomValueInRange(min, max) {
    return min + (Math.random() * (max - min));
}
