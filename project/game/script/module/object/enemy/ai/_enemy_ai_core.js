import { ENEMY_AI_CONSTANTS } from '../../../../data/object/enemy/enemy_ai_constants.js';
import { incrementEnemyAIDebugCounter, recordEnemyAIDebugPolicySample } from './_enemy_ai_debug_stats.js';
import {
    requiresDensityAnchor,
    resolveEnemyAIPolicy,
    stepArrowChargeState,
    updatePolicyIntent
} from './_enemy_ai_policy_intent.js';
import { resolveEnemyAISteeringDirection } from './_enemy_ai_steering.js';
import { applyEnemyAIRotationIntent } from './_enemy_ai_rotation.js';
import {
    applyEnemyAISteeringResult,
    ensureEnemyAIUpdateFrame,
    resolveEnemyAIUpdateFrameInto,
    shouldRefreshEnemyAIDecision
} from './_enemy_ai_fixed_update_context.js';

export {
    resolveEnemyAIFootprintMetricsPx,
    resolveEnemyAINavigationRadiusPx
} from './_enemy_ai_footprint.js';

const ENEMY_AI_POLICY = ENEMY_AI_CONSTANTS.POLICY;
const ENEMY_AI_QUALITY_PROFILES = ENEMY_AI_CONSTANTS.QUALITY_PROFILES;
const ENEMY_AI_STATE_DEFAULTS = ENEMY_AI_CONSTANTS.STATE_DEFAULTS;
const DEFAULT_ENEMY_AI_QUALITY_PROFILE = ENEMY_AI_CONSTANTS.DEFAULT_QUALITY_PROFILE;
const ENEMY_AI_STATE_SCHEMA_VERSION = ENEMY_AI_CONSTANTS.STATE_SCHEMA_VERSION;
const DEFAULT_ENEMY_AI_BASE_DESIRED_SPEED = ENEMY_AI_STATE_DEFAULTS.BASE_DESIRED_SPEED_PX;
const DEFAULT_ENEMY_AI_CHARGE_COOLDOWN_BASE_SECONDS = ENEMY_AI_STATE_DEFAULTS.CHARGE_COOLDOWN_BASE_SECONDS;
const DEFAULT_ENEMY_AI_CHARGE_COOLDOWN_ID_BUCKETS = ENEMY_AI_STATE_DEFAULTS.CHARGE_COOLDOWN_ID_BUCKETS;
const DEFAULT_ENEMY_AI_CHARGE_COOLDOWN_BUCKET_SECONDS = ENEMY_AI_STATE_DEFAULTS.CHARGE_COOLDOWN_BUCKET_SECONDS;

/**
 * 2D 벡터 길이를 계산합니다.
 * @param {number} x - x 성분입니다.
 * @param {number} y - y 성분입니다.
 * @returns {number} 벡터 길이입니다.
 */
const measureEnemyAIVectorLength = (x, y) => Math.hypot(x, y);

/**
 * 음수 ID도 양수 bucket 범위로 정규화합니다.
 * @param {number} value - 원본 값입니다.
 * @param {number} bucketCount - bucket 개수입니다.
 * @returns {number} 정규화된 bucket 인덱스입니다.
 */
function normalizeEnemyAIIdBucket(value, bucketCount) {
    return (((value % bucketCount) + bucketCount) % bucketCount);
}

/**
 * 적 ID 기반 기본 orbit 방향을 계산합니다.
 * @param {number} enemyId - 적 ID입니다.
 * @returns {-1|1} orbit 방향입니다.
 */
function resolveEnemyAIOrbitDirection(enemyId) {
    return normalizeEnemyAIIdBucket(enemyId, 2) === 0 ? 1 : -1;
}

/**
 * 적 ID 기반 초기 돌진 쿨다운을 계산합니다.
 * @param {number} enemyId - 적 ID입니다.
 * @returns {number} 초기 쿨다운 초입니다.
 */
function resolveEnemyAIChargeCooldown(enemyId) {
    const bucket = normalizeEnemyAIIdBucket(enemyId, DEFAULT_ENEMY_AI_CHARGE_COOLDOWN_ID_BUCKETS);
    return DEFAULT_ENEMY_AI_CHARGE_COOLDOWN_BASE_SECONDS
        + (bucket * DEFAULT_ENEMY_AI_CHARGE_COOLDOWN_BUCKET_SECONDS);
}

/**
 * AI 상태 초기화에 사용할 안전한 적 ID를 반환합니다.
 * @param {object|null|undefined} enemy - 적 인스턴스입니다.
 * @returns {number} 정규화 전 적 ID입니다.
 */
function resolveEnemyAIStateSeedId(enemy) {
    return Number.isInteger(enemy?.id) ? enemy.id : 0;
}

/**
 * 기본 희망 이동 속도를 계산합니다.
 * @param {number} currentSpeed - 현재 속도 크기입니다.
 * @returns {number} 기본 희망 이동 속도입니다.
 */
function resolveEnemyAIBaseDesiredSpeed(currentSpeed) {
    return Math.max(
        DEFAULT_ENEMY_AI_BASE_DESIRED_SPEED,
        currentSpeed || DEFAULT_ENEMY_AI_BASE_DESIRED_SPEED
    );
}

/**
 * 현재 업데이트 문맥에 맞는 AI 품질 프로필을 반환합니다.
 * @param {object|null|undefined} context - AI fixedUpdate 문맥입니다.
 * @returns {object} AI 품질 프로필입니다.
 */
function getEnemyAIProfile(context) {
    const requestedProfileKey = typeof context?.enemyAIQualityProfile === 'string'
        ? context.enemyAIQualityProfile
        : DEFAULT_ENEMY_AI_QUALITY_PROFILE;
    return ENEMY_AI_QUALITY_PROFILES[requestedProfileKey]
        || ENEMY_AI_QUALITY_PROFILES[DEFAULT_ENEMY_AI_QUALITY_PROFILE];
}

/**
 * 육각형 합체 추적 목표에 충분히 가까워져 재선택이 필요한지 확인합니다.
 * @param {object} state - 적 AI 상태입니다.
 * @param {object} updateFrame - 현재 fixedUpdate 좌표 문맥입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @returns {boolean} 목표 재선택 필요 여부입니다.
 */
const shouldRefreshHexaClusterTarget = (state, updateFrame, profile) => {
    if (state.policyId !== ENEMY_AI_POLICY.CLUSTER_JOIN) {
        return false;
    }
    if (!Number.isFinite(state.targetX) || !Number.isFinite(state.targetY)) {
        return true;
    }

    const refreshDistance = Number.isFinite(profile.HEXA_CLUSTER_TARGET_REFRESH_DISTANCE_PX)
        ? Math.max(0, profile.HEXA_CLUSTER_TARGET_REFRESH_DISTANCE_PX)
        : 32;
    const dx = state.targetX - updateFrame.startX;
    const dy = state.targetY - updateFrame.startY;
    return measureEnemyAIVectorLength(dx, dy) <= refreshDistance;
};

/**
 * 재사용 좌표 버퍼를 보장합니다.
 * @param {{x?: number, y?: number}|null|undefined} point
 * @param {number} fallbackX
 * @param {number} fallbackY
 * @returns {{x: number, y: number}}
 */
const ensureScratchPoint = (point, fallbackX, fallbackY) => {
    const nextPoint = point && typeof point === 'object' ? point : {};
    nextPoint.x = Number.isFinite(nextPoint.x) ? nextPoint.x : fallbackX;
    nextPoint.y = Number.isFinite(nextPoint.y) ? nextPoint.y : fallbackY;
    return nextPoint;
};

/**
 * 재사용 셀 좌표 버퍼를 보장합니다.
 * @param {{cx?: number, cy?: number}|null|undefined} cell
 * @returns {{cx: number, cy: number}}
 */
const ensureScratchCell = (cell) => {
    const nextCell = cell && typeof cell === 'object' ? cell : {};
    nextCell.cx = Number.isFinite(nextCell.cx) ? nextCell.cx : 0;
    nextCell.cy = Number.isFinite(nextCell.cy) ? nextCell.cy : 0;
    return nextCell;
};

/**
 * 재사용 밀도 목표 버퍼를 보장합니다.
 * @param {{x?: number, y?: number, count?: number}|null|undefined} goal
 * @returns {{x: number, y: number, count: number}}
 */
const ensureScratchDensityGoal = (goal) => {
    const nextGoal = ensureScratchPoint(goal, 0, 0);
    nextGoal.count = Number.isFinite(nextGoal.count) ? nextGoal.count : 0;
    return nextGoal;
};

/**
 * 전송 과정에서 생략될 수 있는 AI 임시 버퍼를 보장합니다.
 * @param {object} state
 * @returns {object}
 */
const ensureEnemyAIStateScratchObjects = (state) => {
    state.flowData = state.flowData ?? null;
    state.scratchDir = ensureScratchPoint(state.scratchDir, 1, 0);
    state.scratchCell = ensureScratchCell(state.scratchCell);
    state.scratchGoalCell = ensureScratchCell(state.scratchGoalCell);
    state.scratchPolicyPoint = ensureScratchPoint(state.scratchPolicyPoint, 0, 0);
    state.scratchDensityGoal = ensureScratchDensityGoal(state.scratchDensityGoal);
    state.scratchUpdateFrame = ensureEnemyAIUpdateFrame(state.scratchUpdateFrame);
    return state;
};

/**
 * 적 인스턴스에 AI 상태 저장소를 보장합니다.
 * @param {object} enemy
 * @param {object} [profile]
 * @returns {object}
 */
export const ensureEnemyAIState = (enemy, profile = getEnemyAIProfile()) => {
    if (
        enemy._enemyAIState
        && enemy._enemyAIState.__initialized === true
        && enemy._enemyAIState.__schemaVersion === ENEMY_AI_STATE_SCHEMA_VERSION
    ) {
        return ensureEnemyAIStateScratchObjects(enemy._enemyAIState);
    }

    const currentSpeed = measureEnemyAIVectorLength(enemy.speed?.x ?? 0, enemy.speed?.y ?? 0);
    const seedId = resolveEnemyAIStateSeedId(enemy);
    const nextState = enemy._enemyAIState && typeof enemy._enemyAIState === 'object'
        ? enemy._enemyAIState
        : {};

    nextState.__initialized = true;
    nextState.__schemaVersion = ENEMY_AI_STATE_SCHEMA_VERSION;
    nextState.policyId = typeof nextState.policyId === 'string'
        ? nextState.policyId
        : resolveEnemyAIPolicy(enemy?.type);
    nextState.dirX = Number.isFinite(nextState.dirX) ? nextState.dirX : 1;
    nextState.dirY = Number.isFinite(nextState.dirY) ? nextState.dirY : 0;
    nextState.baseDesiredSpeed = Number.isFinite(nextState.baseDesiredSpeed) && nextState.baseDesiredSpeed > 0
        ? nextState.baseDesiredSpeed
        : resolveEnemyAIBaseDesiredSpeed(currentSpeed);
    nextState.desiredSpeed = Number.isFinite(nextState.desiredSpeed) && nextState.desiredSpeed > 0
        ? nextState.desiredSpeed
        : nextState.baseDesiredSpeed;
    nextState.baseAccelResponse = Number.isFinite(nextState.baseAccelResponse) && nextState.baseAccelResponse > 0
        ? nextState.baseAccelResponse
        : profile.TURN_RESPONSE;
    nextState.accelResponse = Number.isFinite(nextState.accelResponse) && nextState.accelResponse > 0
        ? nextState.accelResponse
        : nextState.baseAccelResponse;
    nextState.targetX = Number.isFinite(nextState.targetX) ? nextState.targetX : Number.NaN;
    nextState.targetY = Number.isFinite(nextState.targetY) ? nextState.targetY : Number.NaN;
    nextState.flowPolicyKey = typeof nextState.flowPolicyKey === 'string'
        ? nextState.flowPolicyKey
        : nextState.policyId;
    nextState.flowKey = typeof nextState.flowKey === 'string' ? nextState.flowKey : '';
    nextState.flowData = nextState.flowData ?? null;
    nextState.lastTargetCellX = Number.isInteger(nextState.lastTargetCellX) ? nextState.lastTargetCellX : 0;
    nextState.lastTargetCellY = Number.isInteger(nextState.lastTargetCellY) ? nextState.lastTargetCellY : 0;
    nextState.lastDecisionGroup = Number.isInteger(nextState.lastDecisionGroup) ? nextState.lastDecisionGroup : -1;
    nextState.hasDirectPathResult = nextState.hasDirectPathResult === true;
    nextState.lastDirectPath = nextState.lastDirectPath === true;
    nextState.lastDirectPathWallsVersion = Number.isInteger(nextState.lastDirectPathWallsVersion)
        ? nextState.lastDirectPathWallsVersion
        : -1;
    nextState.lastDirectPathPadBucket = Number.isInteger(nextState.lastDirectPathPadBucket)
        ? nextState.lastDirectPathPadBucket
        : -1;
    nextState.lastDirectPathStartCx = Number.isInteger(nextState.lastDirectPathStartCx)
        ? nextState.lastDirectPathStartCx
        : 0;
    nextState.lastDirectPathStartCy = Number.isInteger(nextState.lastDirectPathStartCy)
        ? nextState.lastDirectPathStartCy
        : 0;
    nextState.lastDirectPathTargetCx = Number.isInteger(nextState.lastDirectPathTargetCx)
        ? nextState.lastDirectPathTargetCx
        : 0;
    nextState.lastDirectPathTargetCy = Number.isInteger(nextState.lastDirectPathTargetCy)
        ? nextState.lastDirectPathTargetCy
        : 0;
    nextState.orbitDirection = nextState.orbitDirection === -1 || nextState.orbitDirection === 1
        ? nextState.orbitDirection
        : resolveEnemyAIOrbitDirection(seedId);
    nextState.chargeState = typeof nextState.chargeState === 'string' ? nextState.chargeState : 'idle';
    nextState.chargeCooldownRemaining = Number.isFinite(nextState.chargeCooldownRemaining)
        ? Math.max(0, nextState.chargeCooldownRemaining)
        : resolveEnemyAIChargeCooldown(seedId);
    nextState.chargeDurationRemaining = Number.isFinite(nextState.chargeDurationRemaining)
        ? Math.max(0, nextState.chargeDurationRemaining)
        : 0;
    nextState.chargeRecoverRemaining = Number.isFinite(nextState.chargeRecoverRemaining)
        ? Math.max(0, nextState.chargeRecoverRemaining)
        : 0;
    nextState.chargeTargetX = Number.isFinite(nextState.chargeTargetX) ? nextState.chargeTargetX : 0;
    nextState.chargeTargetY = Number.isFinite(nextState.chargeTargetY) ? nextState.chargeTargetY : 0;
    ensureEnemyAIStateScratchObjects(nextState);
    enemy._enemyAIState = nextState;
    return nextState;
};

/**
 * 적 AI 상태를 초기화 상태로 되돌립니다.
 * @param {object|null|undefined} enemy - 적 인스턴스입니다.
 */
export function resetEnemyAIState(enemy) {
    if (!enemy) return;
    enemy._enemyAIState = null;
}

/**
 * 전투 적 AI의 고정 스텝 갱신을 수행합니다.
 * @param {object} enemy - 적 인스턴스입니다.
 * @param {number} stepDelta - fixedUpdate 델타입니다.
 * @param {object} [context={}] - AI fixedUpdate 문맥입니다.
 */
export function fixedUpdateEnemyAI(enemy, stepDelta, context = {}) {
    const profile = getEnemyAIProfile(context);
    const state = ensureEnemyAIState(enemy, profile);
    state.baseAccelResponse = profile.TURN_RESPONSE;
    state.policyId = resolveEnemyAIPolicy(enemy?.type);
    const aiDebugStats = context?.aiDebugStats ?? null;
    const profileStartTime = aiDebugStats?.enabled === true ? performance.now() : -1;

    const updateFrame = resolveEnemyAIUpdateFrameInto(enemy, context, state.scratchUpdateFrame);
    if (!updateFrame) {
        enemy.setAcc(0, 0);
        return;
    }

    const forcedPolicyRefresh = stepArrowChargeState(
        state,
        stepDelta,
        updateFrame.targetX,
        updateFrame.targetY,
        profile
    );
    const shouldRefreshDecision = shouldRefreshEnemyAIDecision(state, context, forcedPolicyRefresh);
    const shouldRefreshClusterTarget = shouldRefreshHexaClusterTarget(state, updateFrame, profile);

    if (shouldRefreshDecision || shouldRefreshClusterTarget || !requiresDensityAnchor(state.policyId)) {
        updatePolicyIntent(
            enemy,
            state,
            context,
            profile,
            updateFrame.startX,
            updateFrame.startY,
            updateFrame.targetX,
            updateFrame.targetY,
            updateFrame.enemyRadius,
            updateFrame.footprintMetrics
        );
        state.lastDecisionGroup = Number.isInteger(context?.decisionGroup) ? context.decisionGroup : -1;
    }
    if (shouldRefreshDecision) {
        incrementEnemyAIDebugCounter(aiDebugStats, 'heavyDecisionCount');
    }

    const scratchDir = resolveEnemyAISteeringDirection({
        enemy,
        state,
        context,
        profile,
        startX: updateFrame.startX,
        startY: updateFrame.startY,
        targetX: updateFrame.targetX,
        targetY: updateFrame.targetY,
        walls: updateFrame.walls,
        enemyRadius: updateFrame.enemyRadius,
        footprintMetrics: updateFrame.footprintMetrics,
        wallsVersion: updateFrame.wallsVersion,
        forcedPolicyRefresh,
        aiDebugStats
    });

    applyEnemyAISteeringResult(enemy, state, scratchDir);
    applyEnemyAIRotationIntent(enemy, state, scratchDir, updateFrame.footprintMetrics, profile);

    if (profileStartTime >= 0) {
        const durationMs = performance.now() - profileStartTime;
        incrementEnemyAIDebugCounter(aiDebugStats, 'enemyUpdateCount');
        incrementEnemyAIDebugCounter(aiDebugStats, 'totalMs', durationMs);
        recordEnemyAIDebugPolicySample(aiDebugStats, state.policyId, durationMs);
    }
}

export {
    ENEMY_AI_POLICY
};
