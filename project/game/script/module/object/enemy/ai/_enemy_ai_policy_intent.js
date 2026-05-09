import { ENEMY_AI_CONSTANTS } from '../../../../data/object/enemy/enemy_ai_constants.js';
import { getSimulationObjectWH, getSimulationWW } from '../../../simulation/simulation_runtime.js';
import {
    projectEnemyAIFootprintRadiusForDirection,
    readPositivePixelValue,
    resolveEnemyAIFootprintMetricsPx
} from './_enemy_ai_footprint.js';
import {
    getDensityCountAtPosition,
    getSharedDensityField,
    getSharedDensityGoal
} from './_enemy_ai_density_field.js';
import {
    findNearestWalkableCellInto,
    getNavGrid,
    isSegmentBlockedByCoords,
    resolveDirectPathPad,
    worldToCellInto
} from './_enemy_ai_navigation.js';

const ENEMY_AI_POLICY = ENEMY_AI_CONSTANTS.POLICY;
const ENEMY_AI_POLICY_BY_TYPE = ENEMY_AI_CONSTANTS.POLICY_BY_TYPE;
const EPSILON = ENEMY_AI_CONSTANTS.EPSILON;
const INF = ENEMY_AI_CONSTANTS.INF;
const HEXA_TYPE = 'hexa';
const HEXA_HIVE_TYPE = 'hexa_hive';

/**
 * 두 성분으로 구성된 벡터 길이를 반환합니다.
 * @param {number} x - X 성분입니다.
 * @param {number} y - Y 성분입니다.
 * @returns {number} 벡터 길이입니다.
 */
const length = (x, y) => Math.hypot(x, y);

/**
 * 값을 지정 범위로 제한합니다.
 * @param {number} value - 원본 값입니다.
 * @param {number} min - 최솟값입니다.
 * @param {number} max - 최댓값입니다.
 * @returns {number} 제한된 값입니다.
 */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * 적 타입에 대응하는 네비게이션 정책을 반환합니다.
 * @param {string|null|undefined} enemyType - 적 타입입니다.
 * @returns {string} 정책 ID입니다.
 */
export const resolveEnemyAIPolicy = (enemyType) => {
    if (typeof enemyType !== 'string') {
        return ENEMY_AI_POLICY.CHASE;
    }

    return ENEMY_AI_POLICY_BY_TYPE[enemyType] ?? ENEMY_AI_POLICY.CHASE;
};

/**
 * 정책이 밀도 기반 앵커를 필요로 하는지 반환합니다.
 * @param {string} policyId - 정책 ID입니다.
 * @returns {boolean} 밀도 앵커 필요 여부입니다.
 */
export const requiresDensityAnchor = (policyId) => (
    policyId === ENEMY_AI_POLICY.CLUSTER_JOIN
    || policyId === ENEMY_AI_POLICY.ALLY_DENSITY_SEEK
);

/**
 * 거리 유지형 적의 목표 앵커를 계산합니다.
 * @param {object} state - 적 AI 상태입니다.
 * @param {number} startX - 시작 X 좌표입니다.
 * @param {number} startY - 시작 Y 좌표입니다.
 * @param {number} targetX - 대상 X 좌표입니다.
 * @param {number} targetY - 대상 Y 좌표입니다.
 * @param {number} preferredRange - 선호 거리입니다.
 * @param {number} rangeBand - 유지 거리 허용 밴드입니다.
 * @param {{x: number, y: number}} out - 출력 버퍼입니다.
 * @returns {{x: number, y: number}} 출력 버퍼입니다.
 */
const resolveKeepRangeGoalInto = (state, startX, startY, targetX, targetY, preferredRange, rangeBand, out) => {
    const deltaX = startX - targetX;
    const deltaY = startY - targetY;
    const distance = length(deltaX, deltaY);
    const safeDistance = distance > EPSILON ? distance : 1;
    const radialX = distance > EPSILON ? (deltaX / safeDistance) : 1;
    const radialY = distance > EPSILON ? (deltaY / safeDistance) : 0;
    const tangentX = -radialY * state.orbitDirection;
    const tangentY = radialX * state.orbitDirection;
    const tangentOffset = Math.min(preferredRange * 0.45, 96);

    if (distance < (preferredRange - rangeBand)) {
        out.x = targetX + (radialX * (preferredRange + (rangeBand * 0.75)));
        out.y = targetY + (radialY * (preferredRange + (rangeBand * 0.75)));
        return out;
    }

    if (distance > (preferredRange + rangeBand)) {
        out.x = targetX + (radialX * preferredRange) + (tangentX * (tangentOffset * 0.35));
        out.y = targetY + (radialY * preferredRange) + (tangentY * (tangentOffset * 0.35));
        return out;
    }

    out.x = targetX + (radialX * preferredRange) + (tangentX * tangentOffset);
    out.y = targetY + (radialY * preferredRange) + (tangentY * tangentOffset);
    return out;
};

/**
 * 화살표 적의 돌진 상태 머신을 한 스텝 진행합니다.
 * @param {object} state - 적 AI 상태입니다.
 * @param {number} stepDelta - 고정 틱 델타입니다.
 * @param {number} targetX - 대상 X 좌표입니다.
 * @param {number} targetY - 대상 Y 좌표입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @returns {boolean} 정책 강제 갱신 필요 여부입니다.
 */
export const stepArrowChargeState = (state, stepDelta, targetX, targetY, profile) => {
    if (state.policyId !== ENEMY_AI_POLICY.CHARGE_CHASE) {
        return false;
    }

    if (state.chargeState === 'charge') {
        state.chargeDurationRemaining = Math.max(0, state.chargeDurationRemaining - stepDelta);
        if (state.chargeDurationRemaining === 0) {
            state.chargeState = 'recover';
            state.chargeRecoverRemaining = profile.ARROW_CHARGE_RECOVER_SECONDS;
            return true;
        }
        return false;
    }

    if (state.chargeState === 'recover') {
        state.chargeRecoverRemaining = Math.max(0, state.chargeRecoverRemaining - stepDelta);
        if (state.chargeRecoverRemaining === 0) {
            state.chargeState = 'idle';
            state.chargeCooldownRemaining = profile.ARROW_CHARGE_COOLDOWN_SECONDS;
            return true;
        }
        return false;
    }

    state.chargeCooldownRemaining = Math.max(0, state.chargeCooldownRemaining - stepDelta);
    if (state.chargeCooldownRemaining > 0) {
        return false;
    }

    state.chargeState = 'charge';
    state.chargeDurationRemaining = profile.ARROW_CHARGE_DURATION_SECONDS;
    state.chargeRecoverRemaining = 0;
    state.chargeTargetX = targetX;
    state.chargeTargetY = targetY;
    return true;
};

/**
 * 합체 대상으로 추적할 수 있는 육각형 계열 적인지 확인합니다.
 * @param {object|null|undefined} enemy - 검사 대상 적입니다.
 * @returns {boolean} 합체 대상 여부입니다.
 */
const isHexaMergeTargetEnemy = (enemy) => (
    enemy?.type === HEXA_TYPE
    || enemy?.type === HEXA_HIVE_TYPE
);

/**
 * 현재 육각형 적이 따라갈 실제 합체 후보 목표를 찾습니다.
 * @param {object} enemy - 현재 적 객체입니다.
 * @param {object[]|null} enemies - 전체 적 목록입니다.
 * @param {number} startX - 현재 X 좌표입니다.
 * @param {number} startY - 현재 Y 좌표입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {{x: number, y: number, count?: number}} out - 출력 버퍼입니다.
 * @returns {{x: number, y: number, count?: number}|null} 선택한 합체 후보 목표입니다.
 */
const findHexaMergePartnerGoalInto = (enemy, enemies, startX, startY, profile, out) => {
    if (!Array.isArray(enemies) || enemies.length === 0) {
        return null;
    }

    const currentId = Number.isInteger(enemy?.id) ? enemy.id : null;
    const searchRadius = Number.isFinite(profile.HEXA_CLUSTER_PARTNER_SEARCH_RADIUS_PX)
        ? Math.max(0, profile.HEXA_CLUSTER_PARTNER_SEARCH_RADIUS_PX)
        : 640;
    const searchRadiusSq = searchRadius * searchRadius;
    const hiveJoinMultiplier = Number.isFinite(profile.HEXA_CLUSTER_HIVE_JOIN_SCORE_MULTIPLIER)
        ? Math.max(0.1, profile.HEXA_CLUSTER_HIVE_JOIN_SCORE_MULTIPLIER)
        : 0.85;
    let bestScore = INF;
    let found = false;

    for (let i = 0; i < enemies.length; i++) {
        const candidate = enemies[i];
        if (!candidate || candidate === enemy || candidate.active === false || !candidate.position) {
            continue;
        }
        if (currentId !== null && candidate.id === currentId) {
            continue;
        }
        if (!isHexaMergeTargetEnemy(candidate)) {
            continue;
        }

        const candidateX = Number.isFinite(candidate.position.x) ? candidate.position.x : 0;
        const candidateY = Number.isFinite(candidate.position.y) ? candidate.position.y : 0;
        const dx = candidateX - startX;
        const dy = candidateY - startY;
        const distanceSq = (dx * dx) + (dy * dy);
        if (distanceSq > searchRadiusSq) {
            continue;
        }

        const score = candidate.type === HEXA_HIVE_TYPE
            ? distanceSq * hiveJoinMultiplier
            : distanceSq;
        if (score >= bestScore) {
            continue;
        }

        bestScore = score;
        found = true;
        out.x = candidateX;
        out.y = candidateY;
        out.count = 1;
    }

    return found ? out : null;
};

/**
 * 합체 육각형이 실제 footprint로 닿을 수 있는 플레이어 주변 목표를 고릅니다.
 * @param {object} enemy - 적 객체입니다.
 * @param {object} state - 적 AI 상태입니다.
 * @param {object} context - AI 업데이트 문맥입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {number} startX - 시작 X 좌표입니다.
 * @param {number} startY - 시작 Y 좌표입니다.
 * @param {number} playerX - 플레이어 X 좌표입니다.
 * @param {number} playerY - 플레이어 Y 좌표입니다.
 * @param {number} navigationRadius - 네비게이션 반경입니다.
 * @param {{baseRadius: number, halfWidth: number, halfHeight: number, radius: number}|null} footprintMetrics - footprint 메트릭입니다.
 * @param {{x: number, y: number}} out - 출력 버퍼입니다.
 * @returns {{x: number, y: number}} 출력 버퍼입니다.
 */
const resolveHexaHiveApproachGoalInto = (
    enemy,
    state,
    context,
    profile,
    startX,
    startY,
    playerX,
    playerY,
    navigationRadius,
    footprintMetrics,
    out
) => {
    out.x = playerX;
    out.y = playerY;
    if (enemy?.type !== HEXA_HIVE_TYPE) {
        return out;
    }

    const metrics = footprintMetrics ?? resolveEnemyAIFootprintMetricsPx(enemy, navigationRadius);
    const clearance = Math.max(readPositivePixelValue(navigationRadius), readPositivePixelValue(metrics?.radius));
    const walls = Array.isArray(context?.walls) ? context.walls : [];
    const nav = getNavGrid(walls, getSimulationWW(), getSimulationObjectWH(), profile, clearance);
    const grid = nav.grid;
    let baseDirX = startX - playerX;
    let baseDirY = startY - playerY;
    const baseDistance = Math.hypot(baseDirX, baseDirY);
    if (baseDistance > EPSILON) {
        baseDirX /= baseDistance;
        baseDirY /= baseDistance;
    } else {
        baseDirX = Number.isFinite(state.dirX) ? state.dirX : 1;
        baseDirY = Number.isFinite(state.dirY) ? state.dirY : 0;
        const fallbackDistance = Math.hypot(baseDirX, baseDirY);
        if (fallbackDistance > EPSILON) {
            baseDirX /= fallbackDistance;
            baseDirY /= fallbackDistance;
        } else {
            baseDirX = 1;
            baseDirY = 0;
        }
    }

    const sampleCount = Math.max(
        8,
        Number.isInteger(profile.HEXA_HIVE_APPROACH_GOAL_SAMPLE_COUNT)
            ? profile.HEXA_HIVE_APPROACH_GOAL_SAMPLE_COUNT
            : 16
    );
    const innerRingRatio = clamp(
        Number.isFinite(profile.HEXA_HIVE_APPROACH_GOAL_INNER_RING_RATIO)
            ? profile.HEXA_HIVE_APPROACH_GOAL_INNER_RING_RATIO
            : 0.82,
        0.25,
        1
    );
    const outerRingRatio = Math.max(
        1,
        Number.isFinite(profile.HEXA_HIVE_APPROACH_GOAL_OUTER_RING_RATIO)
            ? profile.HEXA_HIVE_APPROACH_GOAL_OUTER_RING_RATIO
            : 1.18
    );
    const extraRatio = Math.max(
        0,
        Number.isFinite(profile.HEXA_HIVE_APPROACH_GOAL_EXTRA_RATIO)
            ? profile.HEXA_HIVE_APPROACH_GOAL_EXTRA_RATIO
            : 0.12
    );
    const minExtraPx = Math.max(
        0,
        Number.isFinite(profile.HEXA_HIVE_APPROACH_GOAL_MIN_EXTRA_PX)
            ? profile.HEXA_HIVE_APPROACH_GOAL_MIN_EXTRA_PX
            : 10
    );
    const directPenaltyRatio = Math.max(
        0,
        Number.isFinite(profile.HEXA_HIVE_APPROACH_GOAL_DIRECT_BLOCK_PENALTY)
            ? profile.HEXA_HIVE_APPROACH_GOAL_DIRECT_BLOCK_PENALTY
            : 0.35
    );
    const alignmentWeight = Math.max(
        0,
        Number.isFinite(profile.HEXA_HIVE_APPROACH_GOAL_ALIGNMENT_WEIGHT)
            ? profile.HEXA_HIVE_APPROACH_GOAL_ALIGNMENT_WEIGHT
            : 0.25
    );
    const distanceErrorWeight = Math.max(
        0,
        Number.isFinite(profile.HEXA_HIVE_APPROACH_GOAL_DISTANCE_ERROR_WEIGHT)
            ? profile.HEXA_HIVE_APPROACH_GOAL_DISTANCE_ERROR_WEIGHT
            : 4
    );
    const playerRadius = readPositivePixelValue(context?.player?.radius);
    const directPad = resolveDirectPathPad(enemy, clearance, profile);
    const baseAngle = Math.atan2(baseDirY, baseDirX);
    const angleStep = (Math.PI * 2) / sampleCount;
    let bestScore = INF;

    for (let ringIndex = 0; ringIndex < 3; ringIndex++) {
        const ringRatio = ringIndex === 0
            ? innerRingRatio
            : (ringIndex === 1 ? 1 : outerRingRatio);
        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
            const offsetIndex = sampleIndex === 0
                ? 0
                : Math.ceil(sampleIndex * 0.5) * (sampleIndex % 2 === 1 ? 1 : -1);
            const angle = baseAngle + (offsetIndex * angleStep);
            const dirX = Math.cos(angle);
            const dirY = Math.sin(angle);
            const projectedRadius = projectEnemyAIFootprintRadiusForDirection(metrics, dirX, dirY);
            const desiredDistance = playerRadius + projectedRadius + Math.max(minExtraPx, projectedRadius * extraRatio);
            const candidateDistance = desiredDistance * ringRatio;
            const candidateX = playerX + (dirX * candidateDistance);
            const candidateY = playerY + (dirY * candidateDistance);
            const rawCell = worldToCellInto(candidateX, candidateY, grid, state.scratchCell);
            const walkableCell = findNearestWalkableCellInto(
                grid,
                rawCell.cx,
                rawCell.cy,
                state.scratchGoalCell,
                profile,
                nav.clearance
            );
            if (!walkableCell) {
                continue;
            }

            const snappedX = (walkableCell.cx + 0.5) * grid.cellSize;
            const snappedY = (walkableCell.cy + 0.5) * grid.cellSize;
            const startDistanceSq = ((snappedX - startX) * (snappedX - startX))
                + ((snappedY - startY) * (snappedY - startY));
            const playerDeltaX = snappedX - playerX;
            const playerDeltaY = snappedY - playerY;
            const snappedPlayerDistance = Math.hypot(playerDeltaX, playerDeltaY);
            const distanceError = Math.abs(snappedPlayerDistance - desiredDistance);
            const snappedDirX = snappedPlayerDistance > EPSILON ? playerDeltaX / snappedPlayerDistance : dirX;
            const snappedDirY = snappedPlayerDistance > EPSILON ? playerDeltaY / snappedPlayerDistance : dirY;
            const alignmentPenalty = 1 - clamp((snappedDirX * baseDirX) + (snappedDirY * baseDirY), -1, 1);
            const isDirectBlocked = isSegmentBlockedByCoords(startX, startY, snappedX, snappedY, walls, directPad);
            const directPenalty = isDirectBlocked
                ? desiredDistance * desiredDistance * directPenaltyRatio
                : 0;
            const score = startDistanceSq
                + (distanceError * distanceError * distanceErrorWeight)
                + (alignmentPenalty * desiredDistance * desiredDistance * alignmentWeight)
                + directPenalty;
            if (score >= bestScore) {
                continue;
            }

            bestScore = score;
            out.x = snappedX;
            out.y = snappedY;
        }
    }

    return out;
};

/**
 * 현재 정책에 맞는 목표 좌표와 이동 배율을 계산합니다.
 * @param {object} enemy - 적 객체입니다.
 * @param {object} state - 적 AI 상태입니다.
 * @param {object} context - AI 업데이트 문맥입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {number} startX - 시작 X 좌표입니다.
 * @param {number} startY - 시작 Y 좌표입니다.
 * @param {number} playerX - 플레이어 X 좌표입니다.
 * @param {number} playerY - 플레이어 Y 좌표입니다.
 * @param {number} navigationRadius - 네비게이션 반경입니다.
 * @param {{baseRadius: number, halfWidth: number, halfHeight: number, radius: number}|null} footprintMetrics - footprint 메트릭입니다.
 * @returns {void}
 */
export const updatePolicyIntent = (
    enemy,
    state,
    context,
    profile,
    startX,
    startY,
    playerX,
    playerY,
    navigationRadius,
    footprintMetrics
) => {
    const simulationWW = getSimulationWW();
    const simulationObjectWH = getSimulationObjectWH();
    const enemies = Array.isArray(context?.enemies) ? context.enemies : null;
    const policyId = resolveEnemyAIPolicy(enemy?.type);
    const isHeavyRefresh = context.shouldUpdateDecision === true;
    const policyPoint = state.scratchPolicyPoint;

    state.policyId = policyId;
    state.desiredSpeed = state.baseDesiredSpeed;
    state.accelResponse = state.baseAccelResponse;
    state.flowPolicyKey = policyId;

    if (policyId === ENEMY_AI_POLICY.CHARGE_CHASE && state.chargeState === 'charge') {
        state.targetX = state.chargeTargetX;
        state.targetY = state.chargeTargetY;
        state.desiredSpeed = state.baseDesiredSpeed * profile.ARROW_CHARGE_SPEED_MULTIPLIER;
        state.accelResponse = state.baseAccelResponse * profile.ARROW_CHARGE_ACCEL_MULTIPLIER;
        state.flowPolicyKey = 'charge_lunge';
        return;
    }

    if (policyId === ENEMY_AI_POLICY.KEEP_RANGE) {
        const preferredRange = Math.max(120, simulationObjectWH * profile.KEEP_RANGE_RATIO);
        const rangeBand = Math.max(profile.KEEP_RANGE_MIN_BAND_PX, simulationObjectWH * profile.KEEP_RANGE_BAND_RATIO);
        resolveKeepRangeGoalInto(
            state,
            startX,
            startY,
            playerX,
            playerY,
            preferredRange,
            rangeBand,
            policyPoint
        );
        state.targetX = policyPoint.x;
        state.targetY = policyPoint.y;
        state.flowPolicyKey = 'keep_range';
        return;
    }

    if (policyId === ENEMY_AI_POLICY.CLUSTER_JOIN) {
        const partnerGoal = findHexaMergePartnerGoalInto(
            enemy,
            enemies,
            startX,
            startY,
            profile,
            state.scratchDensityGoal
        );
        if (partnerGoal) {
            state.targetX = partnerGoal.x;
            state.targetY = partnerGoal.y;
            state.flowPolicyKey = 'cluster_partner_join';
        } else {
            state.targetX = playerX;
            state.targetY = playerY;
            state.flowPolicyKey = 'cluster_join_player';
        }
        return;
    }

    if (policyId === ENEMY_AI_POLICY.ALLY_DENSITY_SEEK) {
        const densityField = getSharedDensityField(
            context,
            enemies,
            simulationWW,
            simulationObjectWH,
            'all',
            profile
        );
        const localDensityCount = getDensityCountAtPosition(densityField, startX, startY);
        if (isHeavyRefresh || !Number.isFinite(state.targetX) || !Number.isFinite(state.targetY)) {
            const densityGoal = getSharedDensityGoal(
                context,
                enemies,
                simulationWW,
                simulationObjectWH,
                profile,
                'all',
                'ally_density_seek',
                startX,
                startY,
                profile.DENSITY_SEARCH_RADIUS_CELLS,
                3,
                state.scratchDensityGoal
            );
            const shouldHoldCurrentCell = localDensityCount >= 5;
            if (densityGoal && (densityGoal.count > localDensityCount || shouldHoldCurrentCell)) {
                state.targetX = densityGoal.x;
                state.targetY = densityGoal.y;
            } else {
                state.targetX = playerX;
                state.targetY = playerY;
            }
        }
        state.flowPolicyKey = 'ally_density_seek';
        return;
    }

    if (policyId === ENEMY_AI_POLICY.CHASE && enemy?.type === HEXA_HIVE_TYPE) {
        resolveHexaHiveApproachGoalInto(
            enemy,
            state,
            context,
            profile,
            startX,
            startY,
            playerX,
            playerY,
            navigationRadius,
            footprintMetrics,
            policyPoint
        );
        state.targetX = policyPoint.x;
        state.targetY = policyPoint.y;
        state.flowPolicyKey = 'hexa_hive_approach';
        return;
    }

    state.targetX = playerX;
    state.targetY = playerY;
};
