import { ENEMY_AI_CONSTANTS } from '../../../../data/object/enemy/enemy_ai_constants.js';
import { incrementEnemyAIDebugCounter } from './_enemy_ai_debug_stats.js';

const INF = ENEMY_AI_CONSTANTS.INF;

/**
 * 값을 지정 범위로 제한합니다.
 * @param {number} value - 원본 값입니다.
 * @param {number} min - 최솟값입니다.
 * @param {number} max - 최댓값입니다.
 * @returns {number} 제한된 값입니다.
 */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * 적 목록에서 공유 밀도 필드를 생성합니다.
 * @param {object[]|null|undefined} enemies - 적 목록입니다.
 * @param {number} width - 필드 너비입니다.
 * @param {number} height - 필드 높이입니다.
 * @param {string} filterType - 집계할 적 타입입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @returns {{cols: number, rows: number, cellSize: number, counts: Uint16Array}} 밀도 필드입니다.
 */
const buildDensityField = (enemies, width, height, filterType, profile) => {
    const densityCellSize = profile.DENSITY_CELL_SIZE;
    const cols = Math.max(2, Math.ceil(width / densityCellSize));
    const rows = Math.max(2, Math.ceil(height / densityCellSize));
    const counts = new Uint16Array(cols * rows);

    if (!Array.isArray(enemies)) {
        return { cols, rows, cellSize: densityCellSize, counts };
    }

    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        if (!enemy || enemy.active === false || !enemy.position) {
            continue;
        }

        if (filterType !== 'all' && enemy.type !== filterType) {
            continue;
        }

        const cx = clamp(Math.floor(enemy.position.x / densityCellSize), 0, cols - 1);
        const cy = clamp(Math.floor(enemy.position.y / densityCellSize), 0, rows - 1);
        const index = (cy * cols) + cx;
        counts[index] = Math.min(65535, counts[index] + 1);
    }

    return { cols, rows, cellSize: densityCellSize, counts };
};

/**
 * decision tick 동안 공유 밀도 필드를 조회하거나 생성합니다.
 * @param {object} context - AI 업데이트 문맥입니다.
 * @param {object[]|null|undefined} enemies - 적 목록입니다.
 * @param {number} width - 필드 너비입니다.
 * @param {number} height - 필드 높이입니다.
 * @param {string} filterType - 집계할 적 타입입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @returns {{cols: number, rows: number, cellSize: number, counts: Uint16Array}} 밀도 필드입니다.
 */
export const getSharedDensityField = (context, enemies, width, height, filterType, profile) => {
    const aiDebugStats = context?.aiDebugStats ?? null;
    const sharedDensityFieldByKey = context?.sharedDensityFieldByKey instanceof Map
        ? context.sharedDensityFieldByKey
        : null;
    const densityKey = `${profile.KEY}|${filterType}|${Math.round(width)}|${Math.round(height)}|${profile.DENSITY_CELL_SIZE}`;

    if (sharedDensityFieldByKey?.has(densityKey)) {
        incrementEnemyAIDebugCounter(aiDebugStats, 'sharedDensityFieldCacheHitCount');
        return sharedDensityFieldByKey.get(densityKey);
    }

    const densityField = buildDensityField(enemies, width, height, filterType, profile);
    incrementEnemyAIDebugCounter(aiDebugStats, 'densityFieldBuildCount');
    if (sharedDensityFieldByKey) {
        sharedDensityFieldByKey.set(densityKey, densityField);
    }
    return densityField;
};

/**
 * 밀도 필드에서 현재 위치 기준으로 가장 유리한 셀 중심을 찾습니다.
 * @param {{cols: number, rows: number, cellSize: number, counts: Uint16Array}} densityField - 밀도 필드입니다.
 * @param {number} startX - 시작 X 좌표입니다.
 * @param {number} startY - 시작 Y 좌표입니다.
 * @param {number} searchRadiusCells - 탐색 반경 셀 수입니다.
 * @param {number} minCount - 최소 밀도 수입니다.
 * @param {{x: number, y: number, count: number}} out - 출력 버퍼입니다.
 * @returns {{x: number, y: number, count: number}|null} 선택한 목표입니다.
 */
const findDensityGoalInto = (densityField, startX, startY, searchRadiusCells, minCount, out) => {
    if (!densityField || !(densityField.counts instanceof Uint16Array)) {
        return null;
    }

    const originCx = clamp(Math.floor(startX / densityField.cellSize), 0, densityField.cols - 1);
    const originCy = clamp(Math.floor(startY / densityField.cellSize), 0, densityField.rows - 1);
    const radius = Math.max(1, Math.floor(searchRadiusCells));

    let bestScore = -INF;
    let found = false;
    for (let cy = Math.max(0, originCy - radius); cy <= Math.min(densityField.rows - 1, originCy + radius); cy++) {
        for (let cx = Math.max(0, originCx - radius); cx <= Math.min(densityField.cols - 1, originCx + radius); cx++) {
            const count = densityField.counts[(cy * densityField.cols) + cx];
            if (count < minCount) {
                continue;
            }

            const dx = cx - originCx;
            const dy = cy - originCy;
            const distancePenalty = (dx * dx) + (dy * dy);
            const score = (count * 12) - (distancePenalty * 1.75);
            if (score <= bestScore) {
                continue;
            }

            bestScore = score;
            found = true;
            out.x = (cx + 0.5) * densityField.cellSize;
            out.y = (cy + 0.5) * densityField.cellSize;
            out.count = count;
        }
    }

    return found ? out : null;
};

/**
 * 현재 좌표가 속한 밀도 셀의 적 수를 반환합니다.
 * @param {{cols: number, rows: number, cellSize: number, counts: Uint16Array}|null|undefined} densityField - 밀도 필드입니다.
 * @param {number} x - X 좌표입니다.
 * @param {number} y - Y 좌표입니다.
 * @returns {number} 해당 셀의 적 수입니다.
 */
export const getDensityCountAtPosition = (densityField, x, y) => {
    if (!densityField || !(densityField.counts instanceof Uint16Array)) {
        return 0;
    }

    const cx = clamp(Math.floor(x / densityField.cellSize), 0, densityField.cols - 1);
    const cy = clamp(Math.floor(y / densityField.cellSize), 0, densityField.rows - 1);
    const index = (cy * densityField.cols) + cx;
    return Number.isFinite(densityField.counts[index]) ? densityField.counts[index] : 0;
};

/**
 * 정책 기반 밀도 앵커를 decision tick 동안 재사용합니다.
 * @param {object} context - AI 업데이트 문맥입니다.
 * @param {object[]|null|undefined} enemies - 적 목록입니다.
 * @param {number} width - 필드 너비입니다.
 * @param {number} height - 필드 높이입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {string} filterType - 집계할 적 타입입니다.
 * @param {string} policyKey - 정책 캐시 키입니다.
 * @param {number} startX - 시작 X 좌표입니다.
 * @param {number} startY - 시작 Y 좌표입니다.
 * @param {number} searchRadiusCells - 탐색 반경 셀 수입니다.
 * @param {number} minCount - 최소 밀도 수입니다.
 * @param {{x: number, y: number, count: number}} out - 출력 버퍼입니다.
 * @returns {{x: number, y: number, count: number}|null} 선택한 목표입니다.
 */
export const getSharedDensityGoal = (
    context,
    enemies,
    width,
    height,
    profile,
    filterType,
    policyKey,
    startX,
    startY,
    searchRadiusCells,
    minCount,
    out
) => {
    const aiDebugStats = context?.aiDebugStats ?? null;
    const sharedPolicyTargetByKey = context?.sharedPolicyTargetByKey instanceof Map
        ? context.sharedPolicyTargetByKey
        : null;
    const densityCellSize = profile.DENSITY_CELL_SIZE;
    const originCx = Math.floor(startX / densityCellSize);
    const originCy = Math.floor(startY / densityCellSize);
    const decisionKey = `${profile.KEY}|${policyKey}|${filterType}|${originCx}|${originCy}|${searchRadiusCells}|${minCount}`;

    if (sharedPolicyTargetByKey?.has(decisionKey)) {
        incrementEnemyAIDebugCounter(aiDebugStats, 'sharedPolicyTargetCacheHitCount');
        const cachedGoal = sharedPolicyTargetByKey.get(decisionKey);
        if (!cachedGoal) {
            return null;
        }

        out.x = cachedGoal.x;
        out.y = cachedGoal.y;
        out.count = cachedGoal.count;
        return out;
    }

    const densityField = getSharedDensityField(context, enemies, width, height, filterType, profile);
    const goal = findDensityGoalInto(densityField, startX, startY, searchRadiusCells, minCount, out);
    if (sharedPolicyTargetByKey) {
        sharedPolicyTargetByKey.set(
            decisionKey,
            goal ? { x: goal.x, y: goal.y, count: goal.count } : null
        );
    }
    return goal;
};
