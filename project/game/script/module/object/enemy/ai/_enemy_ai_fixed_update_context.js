import {
    resolveEnemyAIFootprintMetricsPx,
    resolveEnemyAINavigationRadiusPx,
    resolveEnemyAIRenderHeightPx
} from './_enemy_ai_footprint.js';
import { getHexaHiveType } from '../_hexa_hive_layout.js';

const HEXA_HIVE_TYPE = getHexaHiveType();

/**
 * fixedUpdate 중 재사용할 문맥 버퍼를 보장합니다.
 * @param {object|null|undefined} frame - 기존 문맥 버퍼입니다.
 * @returns {object}
 */
export function ensureEnemyAIUpdateFrame(frame) {
    return frame && typeof frame === 'object' ? frame : {};
}

/**
 * fixedUpdate에서 반복 사용되는 위치/반경 문맥을 버퍼에 채웁니다.
 * @param {object} enemy - 적 인스턴스입니다.
 * @param {object} context - AI 업데이트 문맥입니다.
 * @param {object} out - 값을 기록할 재사용 버퍼입니다.
 * @returns {object|null}
 */
export function resolveEnemyAIUpdateFrameInto(enemy, context, out) {
    const safeContext = context ?? {};
    const targetFrame = ensureEnemyAIUpdateFrame(out);
    const player = safeContext.player;
    if (!player || !player.position) {
        return null;
    }

    targetFrame.startX = enemy.position.x;
    targetFrame.startY = enemy.position.y;
    targetFrame.targetX = player.position.x;
    targetFrame.targetY = player.position.y;
    targetFrame.walls = Array.isArray(safeContext.walls) ? safeContext.walls : [];
    targetFrame.fallbackRadius = Math.max(8, resolveEnemyAIRenderHeightPx(enemy) * 0.45);
    targetFrame.footprintMetrics = enemy?.type === HEXA_HIVE_TYPE
        ? resolveEnemyAIFootprintMetricsPx(enemy, targetFrame.fallbackRadius)
        : null;
    targetFrame.enemyRadius = targetFrame.footprintMetrics
        ? targetFrame.footprintMetrics.radius
        : resolveEnemyAINavigationRadiusPx(enemy, targetFrame.fallbackRadius);
    targetFrame.wallsVersion = Number.isInteger(safeContext.wallsVersion) ? safeContext.wallsVersion : 0;
    return targetFrame;
}

/**
 * 정책 목표를 새로 계산해야 하는지 확인합니다.
 * @param {object} state - 적 AI 상태입니다.
 * @param {object} context - AI 업데이트 문맥입니다.
 * @param {boolean} forcedPolicyRefresh - 정책 상태 전환으로 강제 갱신이 필요한지 여부입니다.
 * @returns {boolean}
 */
export function shouldRefreshEnemyAIDecision(state, context, forcedPolicyRefresh) {
    return context.shouldUpdateDecision === true
        || forcedPolicyRefresh
        || !Number.isFinite(state.targetX)
        || !Number.isFinite(state.targetY);
}

/**
 * steering 결과를 적 가속도에 반영합니다.
 * @param {object} enemy - 적 인스턴스입니다.
 * @param {object} state - 적 AI 상태입니다.
 * @param {{x: number, y: number}} scratchDir - 계산된 steering 방향입니다.
 */
export function applyEnemyAISteeringResult(enemy, state, scratchDir) {
    state.dirX = scratchDir.x;
    state.dirY = scratchDir.y;

    const desiredVx = state.dirX * state.desiredSpeed;
    const desiredVy = state.dirY * state.desiredSpeed;
    enemy.setAcc(desiredVx - enemy.speed.x, desiredVy - enemy.speed.y);
    enemy.accSpeed = state.accelResponse;
}
