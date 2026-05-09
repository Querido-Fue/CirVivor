import { resolveEnemyAIFootprintMetricsPx } from '../object/enemy/ai/_enemy_ai_core.js';
import { clonePointSnapshot } from './game_scene_shadow_snapshot_entities.js';

/**
 * 적 AI 상태를 워커 전송용 최소 필드만 남겨 복제합니다.
 * @param {object|null|undefined} state - 원본 적 AI 상태입니다.
 * @returns {object|null} 전송 가능한 적 AI 상태입니다.
 */
export function cloneShadowEnemyAIStateForWorkerTransfer(state) {
    if (!state || typeof state !== 'object') {
        return null;
    }

    return {
        __initialized: state.__initialized === true,
        __schemaVersion: Number.isInteger(state.__schemaVersion) ? state.__schemaVersion : 0,
        policyId: typeof state.policyId === 'string' ? state.policyId : '',
        dirX: Number.isFinite(state.dirX) ? state.dirX : 1,
        dirY: Number.isFinite(state.dirY) ? state.dirY : 0,
        baseDesiredSpeed: Number.isFinite(state.baseDesiredSpeed) ? state.baseDesiredSpeed : 40,
        desiredSpeed: Number.isFinite(state.desiredSpeed) ? state.desiredSpeed : 40,
        baseAccelResponse: Number.isFinite(state.baseAccelResponse) ? state.baseAccelResponse : 0,
        accelResponse: Number.isFinite(state.accelResponse) ? state.accelResponse : 0,
        targetX: Number.isFinite(state.targetX) ? state.targetX : Number.NaN,
        targetY: Number.isFinite(state.targetY) ? state.targetY : Number.NaN,
        flowPolicyKey: typeof state.flowPolicyKey === 'string' ? state.flowPolicyKey : '',
        flowKey: typeof state.flowKey === 'string' ? state.flowKey : '',
        lastTargetCellX: Number.isInteger(state.lastTargetCellX) ? state.lastTargetCellX : 0,
        lastTargetCellY: Number.isInteger(state.lastTargetCellY) ? state.lastTargetCellY : 0,
        lastDecisionGroup: Number.isInteger(state.lastDecisionGroup) ? state.lastDecisionGroup : -1,
        hasDirectPathResult: state.hasDirectPathResult === true,
        lastDirectPath: state.lastDirectPath === true,
        lastDirectPathWallsVersion: Number.isInteger(state.lastDirectPathWallsVersion) ? state.lastDirectPathWallsVersion : -1,
        lastDirectPathPadBucket: Number.isInteger(state.lastDirectPathPadBucket) ? state.lastDirectPathPadBucket : -1,
        lastDirectPathStartCx: Number.isInteger(state.lastDirectPathStartCx) ? state.lastDirectPathStartCx : 0,
        lastDirectPathStartCy: Number.isInteger(state.lastDirectPathStartCy) ? state.lastDirectPathStartCy : 0,
        lastDirectPathTargetCx: Number.isInteger(state.lastDirectPathTargetCx) ? state.lastDirectPathTargetCx : 0,
        lastDirectPathTargetCy: Number.isInteger(state.lastDirectPathTargetCy) ? state.lastDirectPathTargetCy : 0,
        orbitDirection: state.orbitDirection === -1 ? -1 : 1,
        chargeState: typeof state.chargeState === 'string' ? state.chargeState : 'idle',
        chargeCooldownRemaining: Number.isFinite(state.chargeCooldownRemaining) ? state.chargeCooldownRemaining : 0,
        chargeDurationRemaining: Number.isFinite(state.chargeDurationRemaining) ? state.chargeDurationRemaining : 0,
        chargeRecoverRemaining: Number.isFinite(state.chargeRecoverRemaining) ? state.chargeRecoverRemaining : 0,
        chargeTargetX: Number.isFinite(state.chargeTargetX) ? state.chargeTargetX : 0,
        chargeTargetY: Number.isFinite(state.chargeTargetY) ? state.chargeTargetY : 0
    };
}

/**
 * 적 AI 워커용 플레이어 요약 정보를 생성합니다.
 * @param {object|null|undefined} player - 현재 플레이어 상태입니다.
 * @returns {object|null} 워커 전송용 플레이어 요약입니다.
 */
export function createShadowEnemyAIPlayerSummary(player) {
    if (!player || typeof player !== 'object') {
        return null;
    }

    return {
        active: player.active !== false,
        position: clonePointSnapshot(player.position)
    };
}

/**
 * 적 AI 워커용 적 요약 정보를 생성합니다.
 * @param {object} options - 적 요약 생성 옵션입니다.
 * @param {object|null|undefined} options.enemy - 현재 적 상태입니다.
 * @param {boolean} options.shouldUpdateDecision - 이번 스텝에 의사결정 갱신 대상인지 여부입니다.
 * @param {object|null|undefined} [options.enemyAIState=null] - 적 AI 내부 상태입니다.
 * @param {number} [options.renderHeightPx=0] - 적 렌더 높이(px)입니다.
 * @returns {object|null} 워커 전송용 적 요약입니다.
 */
export function createShadowEnemyAIWorkerEnemySummary({
    enemy,
    shouldUpdateDecision,
    enemyAIState = null,
    renderHeightPx = 0
}) {
    if (!enemy || typeof enemy !== 'object' || enemy.active === false || !Number.isInteger(enemy.id)) {
        return null;
    }

    const footprintMetrics = resolveEnemyAIFootprintMetricsPx(enemy, null, renderHeightPx);
    return {
        id: enemy.id,
        active: enemy.active !== false,
        type: typeof enemy.type === 'string' ? enemy.type : 'square',
        position: clonePointSnapshot(enemy.position),
        speed: clonePointSnapshot(enemy.speed),
        accSpeed: Number.isFinite(enemy.accSpeed) ? enemy.accSpeed : 0,
        renderHeightPx,
        navigationRadiusPx: footprintMetrics.radius,
        navigationHalfWidthPx: footprintMetrics.halfWidth,
        navigationHalfHeightPx: footprintMetrics.halfHeight,
        navigationAxisLocalDeg: Number.isFinite(footprintMetrics.axisLocalDeg) ? footprintMetrics.axisLocalDeg : 0,
        navigationAxisAnisotropy: Number.isFinite(footprintMetrics.axisAnisotropy)
            ? footprintMetrics.axisAnisotropy
            : 0,
        rotation: Number.isFinite(enemy.rotation) ? enemy.rotation : 0,
        angularVelocity: Number.isFinite(enemy.angularVelocity) ? enemy.angularVelocity : 0,
        angularDeceleration: Number.isFinite(enemy.angularDeceleration) ? enemy.angularDeceleration : 0,
        shouldUpdateDecision: shouldUpdateDecision === true,
        enemyAIState: cloneShadowEnemyAIStateForWorkerTransfer(enemyAIState)
    };
}
