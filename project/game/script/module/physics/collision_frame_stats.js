import { getData } from 'data/data_handler.js';

const COLLISION_FRAME_STATS = getData('COLLISION_CONSTANTS').FRAME_STATS;
const COLLISION_BASE_STAT_FIELDS = COLLISION_FRAME_STATS.BASE_FIELDS;
const COLLISION_PROFILE_STAT_FIELDS = COLLISION_FRAME_STATS.PROFILE_FIELDS;

/**
 * 충돌 프레임 통계 기본 객체를 생성합니다.
 * @returns {object}
 */
export function createCollisionFrameStats() {
    const stats = {};
    resetCollisionFrameStats(stats);
    return stats;
}

/**
 * 충돌 프레임 통계를 0으로 초기화합니다.
 * @param {object} stats - 초기화할 통계 객체입니다.
 */
export function resetCollisionFrameStats(stats) {
    for (let i = 0; i < COLLISION_BASE_STAT_FIELDS.length; i++) {
        stats[COLLISION_BASE_STAT_FIELDS[i]] = 0;
    }
    for (let i = 0; i < COLLISION_PROFILE_STAT_FIELDS.length; i++) {
        stats[COLLISION_PROFILE_STAT_FIELDS[i]] = 0;
    }
}

/**
 * 충돌 프레임 통계의 외부 노출용 스냅샷을 생성합니다.
 * @param {object} frameStats - 내부 프레임 통계 객체입니다.
 * @returns {object}
 */
export function createCollisionFrameStatsSnapshot(frameStats) {
    const stats = {};
    for (let i = 0; i < COLLISION_BASE_STAT_FIELDS.length; i++) {
        const fieldName = COLLISION_BASE_STAT_FIELDS[i];
        stats[fieldName] = Number.isFinite(frameStats[fieldName]) ? frameStats[fieldName] : 0;
    }
    for (let i = 0; i < COLLISION_PROFILE_STAT_FIELDS.length; i++) {
        const fieldName = COLLISION_PROFILE_STAT_FIELDS[i];
        stats[fieldName] = Number.isFinite(frameStats[fieldName]) ? frameStats[fieldName] : 0;
    }
    return stats;
}
