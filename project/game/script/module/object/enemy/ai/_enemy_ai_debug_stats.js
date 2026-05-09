import { ENEMY_AI_CONSTANTS } from '../../../../data/object/enemy/enemy_ai_constants.js';

const ENEMY_AI_POLICY = ENEMY_AI_CONSTANTS.POLICY;

const DEFAULT_POLICY_DEBUG_KEY = 'chase';
const ENEMY_AI_POLICY_DEBUG_KEY_BY_ID = Object.freeze({
    [ENEMY_AI_POLICY.CHASE]: DEFAULT_POLICY_DEBUG_KEY,
    [ENEMY_AI_POLICY.CHARGE_CHASE]: 'chargeChase',
    [ENEMY_AI_POLICY.KEEP_RANGE]: 'keepRange',
    [ENEMY_AI_POLICY.CLUSTER_JOIN]: 'clusterJoin',
    [ENEMY_AI_POLICY.ALLY_DENSITY_SEEK]: 'allyDensitySeek',
    [ENEMY_AI_POLICY.FORMATION_FOLLOW]: 'formationFollow'
});

/**
 * 유효하지 않은 누적값을 0으로 보정해 반환합니다.
 * @param {object|null|undefined} target
 * @param {string} fieldName
 * @returns {number}
 */
const getFiniteEnemyAIDebugValue = (target, fieldName) => {
    const value = target?.[fieldName];
    return Number.isFinite(value) ? value : 0;
};

/**
 * 정책별 디버그 누적 버킷을 보장합니다.
 * @param {object} stats
 * @param {string} bucketName
 * @returns {object}
 */
const ensureEnemyAIDebugBucket = (stats, bucketName) => {
    const bucket = stats[bucketName];
    if (bucket && typeof bucket === 'object') {
        return bucket;
    }

    stats[bucketName] = {};
    return stats[bucketName];
};

/**
 * 정책 ID를 디버그 카운터 키로 변환합니다.
 * @param {string} policyId
 * @returns {string}
 */
export const getEnemyAIDebugPolicyKey = (policyId) => ENEMY_AI_POLICY_DEBUG_KEY_BY_ID[policyId] ?? DEFAULT_POLICY_DEBUG_KEY;

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
    stats[fieldName] = getFiniteEnemyAIDebugValue(stats, fieldName) + safeAmount;
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
    const policyCounts = ensureEnemyAIDebugBucket(stats, 'policyCounts');
    const policyMs = ensureEnemyAIDebugBucket(stats, 'policyMs');

    policyCounts[policyKey] = getFiniteEnemyAIDebugValue(policyCounts, policyKey) + 1;
    policyMs[policyKey] = getFiniteEnemyAIDebugValue(policyMs, policyKey) + durationMs;
};
