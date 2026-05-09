import { ENEMY_AI_CONSTANTS } from '../../../../data/object/enemy/enemy_ai_constants.js';
import { getSimulationObjectWH, getSimulationWW } from '../../../simulation/simulation_runtime.js';
import { incrementEnemyAIDebugCounter } from './_enemy_ai_debug_stats.js';
import {
    projectEnemyAIFootprintRadiusForDirection,
    readPositivePixelValue
} from './_enemy_ai_footprint.js';
import {
    findNearestWalkableCellInto,
    getSharedDirectPathAvailability,
    getSharedFlowFieldForTargetCoords,
    hasReusableDirectPathResult,
    isBlockedCell,
    resolveDirectPathPad,
    toIndex,
    updateDirectPathCache,
    worldToCellInto
} from './_enemy_ai_navigation.js';

const ENEMY_AI_POLICY = ENEMY_AI_CONSTANTS.POLICY;
const EPSILON = ENEMY_AI_CONSTANTS.EPSILON;
const HEXA_HIVE_TYPE = 'hexa_hive';

/**
 * 두 성분으로 구성된 벡터 길이를 반환합니다.
 * @param {number} x - X 성분입니다.
 * @param {number} y - Y 성분입니다.
 * @returns {number} 벡터 길이입니다.
 */
const length = (x, y) => Math.hypot(x, y);

/**
 * 벡터를 정규화해 재사용 가능한 출력 객체에 기록합니다.
 * @param {number} x - X 성분입니다.
 * @param {number} y - Y 성분입니다.
 * @param {{x: number, y: number}} out - 출력 버퍼입니다.
 * @returns {{x: number, y: number}} 출력 버퍼입니다.
 */
const normalizeInto = (x, y, out) => {
    const len = length(x, y);
    if (len <= EPSILON) {
        out.x = 1;
        out.y = 0;
        return out;
    }

    out.x = x / len;
    out.y = y / len;
    return out;
};

/**
 * 정책 목표에 도착했을 때 사용할 안정적인 방향을 기록합니다.
 * @param {object} state - 적 AI 상태입니다.
 * @param {number} startX - 현재 X 좌표입니다.
 * @param {number} startY - 현재 Y 좌표입니다.
 * @param {number} playerX - 플레이어 X 좌표입니다.
 * @param {number} playerY - 플레이어 Y 좌표입니다.
 * @param {{x: number, y: number}} out - 출력 버퍼입니다.
 * @returns {{x: number, y: number}} 출력 버퍼입니다.
 */
const resolveArrivedTargetDirectionInto = (state, startX, startY, playerX, playerY, out) => {
    if (state.flowPolicyKey === 'hexa_hive_approach') {
        const playerDx = playerX - startX;
        const playerDy = playerY - startY;
        if (length(playerDx, playerDy) > EPSILON) {
            return normalizeInto(playerDx, playerDy, out);
        }
    }

    out.x = 0;
    out.y = 0;
    return out;
};

/**
 * 합체 육각형의 현재 진행 방향에서 직선 경로 패딩을 계산합니다.
 * @param {object|null|undefined} enemy - 적 객체입니다.
 * @param {number} enemyRadius - 기본 네비게이션 반경입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {object|null|undefined} footprintMetrics - AI footprint 메트릭입니다.
 * @param {number} startX - 시작 X 좌표입니다.
 * @param {number} startY - 시작 Y 좌표입니다.
 * @param {number} endX - 끝 X 좌표입니다.
 * @param {number} endY - 끝 Y 좌표입니다.
 * @returns {number} 직선 경로 검사 패딩입니다.
 */
const resolveSteeringDirectPathPad = (
    enemy,
    enemyRadius,
    profile,
    footprintMetrics,
    startX,
    startY,
    endX,
    endY
) => {
    const basePad = resolveDirectPathPad(enemy, enemyRadius, profile);
    if (enemy?.type !== HEXA_HIVE_TYPE || !footprintMetrics) {
        return basePad;
    }

    const dx = endX - startX;
    const dy = endY - startY;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        return basePad;
    }

    const distance = length(dx, dy);
    if (!Number.isFinite(distance) || distance <= EPSILON) {
        return basePad;
    }

    const dirX = dx / distance;
    const dirY = dy / distance;
    const sideRadius = projectEnemyAIFootprintRadiusForDirection(footprintMetrics, -dirY, dirX);
    if (!Number.isFinite(sideRadius) || sideRadius <= EPSILON) {
        return basePad;
    }

    const baseRadius = readPositivePixelValue(footprintMetrics.baseRadius);
    const ratio = Number.isFinite(profile.HEXA_HIVE_NAV_DIRECT_CHECK_PAD_RATIO)
        ? Math.max(0, profile.HEXA_HIVE_NAV_DIRECT_CHECK_PAD_RATIO)
        : 1;
    return Math.max(baseRadius, Math.min(basePad, sideRadius * ratio));
};

/**
 * 합체 육각형이 접근 링 목표를 지나 플레이어까지 직접 들어갈 수 있는지 확인합니다.
 * @param {object} state - 적 AI 상태입니다.
 * @param {object} context - AI 업데이트 문맥입니다.
 * @param {number} startX - 현재 X 좌표입니다.
 * @param {number} startY - 현재 Y 좌표입니다.
 * @param {number} playerX - 플레이어 X 좌표입니다.
 * @param {number} playerY - 플레이어 Y 좌표입니다.
 * @param {object[]|null|undefined} walls - 벽 목록입니다.
 * @param {number} playerDirectPad - 플레이어 직선 경로 검사 패딩입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {number} wallsVersion - 벽 버전입니다.
 * @returns {boolean} 직접 최종 접근 가능 여부입니다.
 */
const canUseHexaHiveFinalApproach = (
    state,
    context,
    startX,
    startY,
    playerX,
    playerY,
    walls,
    playerDirectPad,
    profile,
    wallsVersion
) => {
    if (state.flowPolicyKey !== 'hexa_hive_approach') {
        return false;
    }

    const playerDx = playerX - startX;
    const playerDy = playerY - startY;
    if (length(playerDx, playerDy) <= EPSILON) {
        return false;
    }

    return getSharedDirectPathAvailability(
        context,
        startX,
        startY,
        playerX,
        playerY,
        walls,
        playerDirectPad,
        profile,
        wallsVersion
    );
};

/**
 * 적 AI의 현재 target 기준 steering 방향을 계산하고 flow/direct-path 캐시 상태를 갱신합니다.
 * @param {object} options - steering 계산 옵션입니다.
 * @param {object} options.enemy - 적 객체입니다.
 * @param {object} options.state - 적 AI 상태입니다.
 * @param {object} options.context - AI 업데이트 문맥입니다.
 * @param {object} options.profile - AI 품질 프로필입니다.
 * @param {number} options.startX - 시작 X 좌표입니다.
 * @param {number} options.startY - 시작 Y 좌표입니다.
 * @param {number} options.targetX - 플레이어 X 좌표입니다.
 * @param {number} options.targetY - 플레이어 Y 좌표입니다.
 * @param {object[]|null|undefined} options.walls - 벽 목록입니다.
 * @param {number} options.enemyRadius - 네비게이션 반경입니다.
 * @param {object|null|undefined} options.footprintMetrics - AI footprint 메트릭입니다.
 * @param {number} options.wallsVersion - 벽 버전입니다.
 * @param {boolean} options.forcedPolicyRefresh - 정책 강제 갱신 여부입니다.
 * @param {object|null|undefined} options.aiDebugStats - AI 디버그 통계입니다.
 * @returns {{x: number, y: number}} steering 방향입니다.
 */
export function resolveEnemyAISteeringDirection({
    enemy,
    state,
    context,
    profile,
    startX,
    startY,
    targetX,
    targetY,
    walls,
    enemyRadius,
    footprintMetrics,
    wallsVersion,
    forcedPolicyRefresh,
    aiDebugStats
}) {
    const scratchDir = state.scratchDir;
    const scratchCell = state.scratchCell;
    const directPad = resolveSteeringDirectPathPad(
        enemy,
        enemyRadius,
        profile,
        footprintMetrics,
        startX,
        startY,
        state.targetX,
        state.targetY
    );
    const playerDirectPad = resolveSteeringDirectPathPad(
        enemy,
        enemyRadius,
        profile,
        footprintMetrics,
        startX,
        startY,
        targetX,
        targetY
    );
    let hasDirection = false;
    if (canUseHexaHiveFinalApproach(
        state,
        context,
        startX,
        startY,
        targetX,
        targetY,
        walls,
        playerDirectPad,
        profile,
        wallsVersion
    )) {
        normalizeInto(targetX - startX, targetY - startY, scratchDir);
        state.flowData = null;
        state.flowKey = '';
        return scratchDir;
    }

    const canReuseDirectPath = hasReusableDirectPathResult(
        state,
        startX,
        startY,
        state.targetX,
        state.targetY,
        directPad,
        profile,
        wallsVersion
    );
    if (canReuseDirectPath) {
        incrementEnemyAIDebugCounter(aiDebugStats, 'localDirectPathReuseCount');
    }
    const hasDirectPath = canReuseDirectPath
        ? state.lastDirectPath === true
        : getSharedDirectPathAvailability(
            context,
            startX,
            startY,
            state.targetX,
            state.targetY,
            walls,
            directPad,
            profile,
            wallsVersion
        );
    if (!canReuseDirectPath) {
        updateDirectPathCache(
            state,
            startX,
            startY,
            state.targetX,
            state.targetY,
            directPad,
            profile,
            wallsVersion,
            hasDirectPath
        );
    }

    if (hasDirectPath) {
        const targetDx = state.targetX - startX;
        const targetDy = state.targetY - startY;
        const arriveEpsilon = Number.isFinite(profile.NAV_TARGET_ARRIVE_EPSILON_PX)
            ? Math.max(0, profile.NAV_TARGET_ARRIVE_EPSILON_PX)
            : 2;
        if (length(targetDx, targetDy) <= arriveEpsilon) {
            resolveArrivedTargetDirectionInto(state, startX, startY, targetX, targetY, scratchDir);
        } else {
            normalizeInto(targetDx, targetDy, scratchDir);
        }
        state.flowData = null;
        state.flowKey = '';
        return scratchDir;
    }

    if (context.shouldUpdateDecision === true || forcedPolicyRefresh || !state.flowData) {
        incrementEnemyAIDebugCounter(aiDebugStats, 'flowRefreshCount');
        const shouldUseSharedPlayerFlowForKeepRange = state.policyId === ENEMY_AI_POLICY.KEEP_RANGE;
        const flowTargetX = shouldUseSharedPlayerFlowForKeepRange ? targetX : state.targetX;
        const flowTargetY = shouldUseSharedPlayerFlowForKeepRange ? targetY : state.targetY;
        const flowPolicyKey = shouldUseSharedPlayerFlowForKeepRange
            ? 'keep_range_player'
            : state.flowPolicyKey;
        const flow = getSharedFlowFieldForTargetCoords(
            context,
            walls,
            getSimulationWW(),
            getSimulationObjectWH(),
            profile,
            enemyRadius,
            flowTargetX,
            flowTargetY,
            flowPolicyKey
        );
        if (flow) {
            state.flowData = flow;
            state.flowKey = flow.key;
            state.lastTargetCellX = Math.floor(flowTargetX / profile.NAV_CELL_SIZE);
            state.lastTargetCellY = Math.floor(flowTargetY / profile.NAV_CELL_SIZE);
        } else {
            state.flowData = null;
            state.flowKey = '';
        }
    }

    if (state.flowData) {
        const grid = state.flowData.grid;
        const field = state.flowData.field;
        const cellRaw = worldToCellInto(startX, startY, grid, scratchCell);
        const flowClearance = Number.isFinite(state.flowData.clearance)
            ? state.flowData.clearance
            : enemyRadius;
        const isCurrentCellBlocked = isBlockedCell(grid, cellRaw.cx, cellRaw.cy);
        const cell = isCurrentCellBlocked
            ? findNearestWalkableCellInto(
                grid,
                cellRaw.cx,
                cellRaw.cy,
                state.scratchGoalCell,
                profile,
                flowClearance
            )
            : cellRaw;

        if (cell) {
            if (isCurrentCellBlocked) {
                const escapeX = (cell.cx + 0.5) * grid.cellSize;
                const escapeY = (cell.cy + 0.5) * grid.cellSize;
                const escapeDx = escapeX - startX;
                const escapeDy = escapeY - startY;
                if (Math.hypot(escapeDx, escapeDy) > EPSILON) {
                    normalizeInto(escapeDx, escapeDy, scratchDir);
                    hasDirection = true;
                }
            }

            if (!hasDirection) {
                const idx = toIndex(cell.cx, cell.cy, grid.cols);
                const fx = field.dirX[idx];
                const fy = field.dirY[idx];
                if (Math.abs(fx) > EPSILON || Math.abs(fy) > EPSILON) {
                    scratchDir.x = fx;
                    scratchDir.y = fy;
                    hasDirection = true;
                }
            }
        }
    }

    if (!hasDirection) {
        const targetDx = state.targetX - startX;
        const targetDy = state.targetY - startY;
        const arriveEpsilon = Number.isFinite(profile.NAV_TARGET_ARRIVE_EPSILON_PX)
            ? Math.max(0, profile.NAV_TARGET_ARRIVE_EPSILON_PX)
            : 2;
        if (length(targetDx, targetDy) <= arriveEpsilon) {
            resolveArrivedTargetDirectionInto(state, startX, startY, targetX, targetY, scratchDir);
        } else {
            normalizeInto(targetDx, targetDy, scratchDir);
        }
    }
    return scratchDir;
}
