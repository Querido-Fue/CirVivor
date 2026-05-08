export const DEFAULT_AI_DECISION_GROUP_COUNT = 60;
export const DEFAULT_AI_DECISION_INTERVAL_SECONDS = 1;
export const DEFAULT_OUTSIDE_CULL_RATIO = 0.1;

/**
 * 적 시스템 상태의 기본값을 생성합니다.
 * @returns {{aiDecisionGroupCursor: number, aiDecisionGroupCount: number, aiDecisionIntervalSeconds: number, enemyCullOutsideRatio: number}}
 */
export function createDefaultEnemySystemState() {
    return {
        aiDecisionGroupCursor: 0,
        aiDecisionGroupCount: DEFAULT_AI_DECISION_GROUP_COUNT,
        aiDecisionIntervalSeconds: DEFAULT_AI_DECISION_INTERVAL_SECONDS,
        enemyCullOutsideRatio: DEFAULT_OUTSIDE_CULL_RATIO
    };
}

/**
 * 적 시스템 상태 스냅샷을 정규화합니다.
 * @param {object|null|undefined} enemySystem - 원본 적 시스템 상태입니다.
 * @returns {{aiDecisionGroupCursor: number, aiDecisionGroupCount: number, aiDecisionIntervalSeconds: number, enemyCullOutsideRatio: number}}
 */
export function cloneEnemySystemSnapshot(enemySystem) {
    const defaults = createDefaultEnemySystemState();
    return {
        aiDecisionGroupCursor: Number.isInteger(enemySystem?.aiDecisionGroupCursor)
            ? Math.max(0, enemySystem.aiDecisionGroupCursor)
            : defaults.aiDecisionGroupCursor,
        aiDecisionGroupCount: Number.isInteger(enemySystem?.aiDecisionGroupCount) && enemySystem.aiDecisionGroupCount > 0
            ? enemySystem.aiDecisionGroupCount
            : defaults.aiDecisionGroupCount,
        aiDecisionIntervalSeconds: Number.isFinite(enemySystem?.aiDecisionIntervalSeconds) && enemySystem.aiDecisionIntervalSeconds > 0
            ? enemySystem.aiDecisionIntervalSeconds
            : defaults.aiDecisionIntervalSeconds,
        enemyCullOutsideRatio: Number.isFinite(enemySystem?.enemyCullOutsideRatio) && enemySystem.enemyCullOutsideRatio >= 0
            ? enemySystem.enemyCullOutsideRatio
            : defaults.enemyCullOutsideRatio
    };
}

/**
 * 적 시스템 상태를 기존 객체에 in-place로 반영합니다.
 * @param {object} targetEnemySystem - 갱신할 적 시스템 상태입니다.
 * @param {object|null|undefined} sourceEnemySystem - 원본 적 시스템 상태입니다.
 */
export function assignShadowEnemySystem(targetEnemySystem, sourceEnemySystem) {
    if (!targetEnemySystem || !sourceEnemySystem || typeof sourceEnemySystem !== 'object') {
        return;
    }

    targetEnemySystem.aiDecisionGroupCursor = Number.isInteger(sourceEnemySystem.aiDecisionGroupCursor)
        ? Math.max(0, sourceEnemySystem.aiDecisionGroupCursor)
        : 0;
    targetEnemySystem.aiDecisionGroupCount = Number.isInteger(sourceEnemySystem.aiDecisionGroupCount)
        && sourceEnemySystem.aiDecisionGroupCount > 0
        ? sourceEnemySystem.aiDecisionGroupCount
        : DEFAULT_AI_DECISION_GROUP_COUNT;
    targetEnemySystem.aiDecisionIntervalSeconds = Number.isFinite(sourceEnemySystem.aiDecisionIntervalSeconds)
        && sourceEnemySystem.aiDecisionIntervalSeconds > 0
        ? sourceEnemySystem.aiDecisionIntervalSeconds
        : DEFAULT_AI_DECISION_INTERVAL_SECONDS;
    targetEnemySystem.enemyCullOutsideRatio = Number.isFinite(sourceEnemySystem.enemyCullOutsideRatio)
        && sourceEnemySystem.enemyCullOutsideRatio >= 0
        ? sourceEnemySystem.enemyCullOutsideRatio
        : DEFAULT_OUTSIDE_CULL_RATIO;
}

/**
 * 적 ID를 바탕으로 AI 결정 그룹을 계산합니다.
 * @param {object|null|undefined} enemy - 적 상태입니다.
 * @param {number} fallbackIndex - ID가 없을 때 사용할 인덱스입니다.
 * @param {number} decisionGroupCount - 전체 결정 그룹 수입니다.
 * @returns {number}
 */
export function getShadowEnemyDecisionGroup(enemy, fallbackIndex, decisionGroupCount) {
    const safeCount = Number.isInteger(decisionGroupCount) && decisionGroupCount > 0
        ? decisionGroupCount
        : DEFAULT_AI_DECISION_GROUP_COUNT;
    const sourceId = Number.isInteger(enemy?.id) ? enemy.id : fallbackIndex;
    const mod = sourceId % safeCount;
    return mod < 0 ? mod + safeCount : mod;
}
