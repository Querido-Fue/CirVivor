import { ENEMY_AI_CONSTANTS } from '../../../../data/object/enemy/enemy_ai_constants.js';

const ENEMY_AI_POLICY = ENEMY_AI_CONSTANTS.POLICY;

/**
 * 정책 ID를 디버그 카운터 키로 변환합니다.
 * @param {string} policyId
 * @returns {string}
 */
export const getEnemyAIDebugPolicyKey = (policyId) => {
    switch (policyId) {
        case ENEMY_AI_POLICY.CHARGE_CHASE:
            return 'chargeChase';
        case ENEMY_AI_POLICY.KEEP_RANGE:
            return 'keepRange';
        case ENEMY_AI_POLICY.CLUSTER_JOIN:
            return 'clusterJoin';
        case ENEMY_AI_POLICY.ALLY_DENSITY_SEEK:
            return 'allyDensitySeek';
        case ENEMY_AI_POLICY.FORMATION_FOLLOW:
            return 'formationFollow';
        case ENEMY_AI_POLICY.CHASE:
        default:
            return 'chase';
    }
};

/**
 * AI 디버그 통계 카운터를 증가시킵니다.
 * @param {object|null|undefined} stats
 * @param {string} fieldName
 * @param {number} [amount=1]
 */
export const incrementEnemyAIDebugCounter = (stats, fieldName, amount = 1) => {
    if (stats?.enabled !== true || typeof fieldName !== 'string' || fieldName.length === 0) {
        return;
    }

    const safeAmount = Number.isFinite(amount) ? amount : 1;
    stats[fieldName] = (Number.isFinite(stats[fieldName]) ? stats[fieldName] : 0) + safeAmount;
};

/**
 * 정책별 실행 시간과 호출 수를 누적합니다.
 * @param {object|null|undefined} stats
 * @param {string} policyId
 * @param {number} durationMs
 */
export const recordEnemyAIDebugPolicySample = (stats, policyId, durationMs) => {
    if (stats?.enabled !== true || !Number.isFinite(durationMs) || durationMs < 0) {
        return;
    }

    const policyKey = getEnemyAIDebugPolicyKey(policyId);
    if (!stats.policyCounts || typeof stats.policyCounts !== 'object') {
        stats.policyCounts = {};
    }
    if (!stats.policyMs || typeof stats.policyMs !== 'object') {
        stats.policyMs = {};
    }

    stats.policyCounts[policyKey] = (Number.isFinite(stats.policyCounts[policyKey]) ? stats.policyCounts[policyKey] : 0) + 1;
    stats.policyMs[policyKey] = (Number.isFinite(stats.policyMs[policyKey]) ? stats.policyMs[policyKey] : 0) + durationMs;
};
