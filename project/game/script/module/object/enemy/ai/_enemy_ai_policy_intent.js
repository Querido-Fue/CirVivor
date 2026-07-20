import { ENEMY_AI_CONSTANTS } from '../../../../data/object/enemy/enemy_ai_constants.js';
import { ENEMY_CONSTANTS } from '../../../../data/object/enemy/enemy_constants.js';
import { getSimulationObjectWH, getSimulationWW } from '../../../simulation/simulation_runtime.js';
import { clampNumber } from 'util/number_util.js';
import { getHexaHiveType, getHexaMergeMemberCount } from '../_hexa_hive_layout.js';
import {
    resolveEnemyAIFootprintPathClearancePx,
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
import { ENEMY_SPATIAL_TYPE_MASK } from './enemy_spatial_index.js';

const ENEMY_AI_POLICY = ENEMY_AI_CONSTANTS.POLICY;
const ENEMY_AI_POLICY_BY_TYPE = ENEMY_AI_CONSTANTS.POLICY_BY_TYPE;
const EPSILON = ENEMY_AI_CONSTANTS.EPSILON;
const INF = ENEMY_AI_CONSTANTS.INF;
const HEXA_TYPE = 'hexa';
const HEXA_HIVE_TYPE = getHexaHiveType();
const HEXA_HIVE_MERGE_CONSTANTS = ENEMY_CONSTANTS.HEXA_HIVE.MERGE;
const HEXA_HIVE_MAX_MEMBER_COUNT = Number.isInteger(HEXA_HIVE_MERGE_CONSTANTS.MAX_MEMBER_COUNT)
    ? Math.max(2, HEXA_HIVE_MERGE_CONSTANTS.MAX_MEMBER_COUNT)
    : Number.POSITIVE_INFINITY;
const INVALID_ENEMY_ID = -1;

/**
 * 두 성분으로 구성된 벡터 길이를 반환합니다.
 * @param {number} x - X 성분입니다.
 * @param {number} y - Y 성분입니다.
 * @returns {number} 벡터 길이입니다.
 */
const length = (x, y) => Math.hypot(x, y);

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
 * 현재 적과 후보가 최대 합체 구성원 수 안에서 합류할 수 있는지 반환합니다.
 * @param {object|null|undefined} enemy - 현재 적 객체입니다.
 * @param {object|null|undefined} candidate - 합류 후보 적 객체입니다.
 * @returns {boolean} 합류 가능 여부입니다.
 */
const canJoinHexaMergeTarget = (enemy, candidate) => {
    const enemyMemberCount = getHexaMergeMemberCount(enemy);
    const candidateMemberCount = getHexaMergeMemberCount(candidate);
    return enemyMemberCount > 0
        && candidateMemberCount > 0
        && enemyMemberCount + candidateMemberCount <= HEXA_HIVE_MAX_MEMBER_COUNT;
};

/**
 * 동일 점수 후보를 정수 enemy ID, 원본 배열 순서 순으로 결정적으로 비교합니다.
 * @param {object} candidate - 비교할 적입니다.
 * @param {number} sourceIndex - tick 시작 배열 인덱스입니다.
 * @param {object} query - 파트너 조회 문맥입니다.
 * @returns {boolean} 기존 최적 후보보다 우선하는지 여부입니다.
 */
function isPreferredHexaPartnerTie(candidate, sourceIndex, query) {
    const candidateId = Number.isInteger(candidate?.id) ? candidate.id : Number.MAX_SAFE_INTEGER;
    if (candidateId !== query.bestTieId) {
        return candidateId < query.bestTieId;
    }
    return sourceIndex < query.bestSourceIndex;
}

/**
 * 일반 육각형 파트너 공간 조회 후보를 평가합니다.
 * @param {object} candidate - 후보 적입니다.
 * @param {number} candidateX - tick 시작 후보 X입니다.
 * @param {number} candidateY - tick 시작 후보 Y입니다.
 * @param {number} sourceIndex - tick 시작 배열 인덱스입니다.
 * @param {object} query - 재사용 조회 문맥입니다.
 * @returns {void}
 */
function visitHexaMergePartnerCandidate(candidate, candidateX, candidateY, sourceIndex, query) {
    if (
        !candidate
        || candidate === query.enemy
        || candidate.active === false
        || (query.currentId !== null && candidate.id === query.currentId)
        || !isHexaMergeTargetEnemy(candidate)
        || !canJoinHexaMergeTarget(query.enemy, candidate)
    ) {
        return;
    }

    const dx = candidateX - query.startX;
    const dy = candidateY - query.startY;
    const distanceSq = (dx * dx) + (dy * dy);
    if (distanceSq > query.searchRadiusSq) {
        return;
    }

    const score = candidate.type === HEXA_HIVE_TYPE
        ? distanceSq * query.hiveScoreMultiplier
        : distanceSq;
    if (score > query.bestScore || (score === query.bestScore && !isPreferredHexaPartnerTie(candidate, sourceIndex, query))) {
        return;
    }

    query.bestScore = score;
    query.bestTieId = Number.isInteger(candidate.id) ? candidate.id : Number.MAX_SAFE_INTEGER;
    query.bestSourceIndex = sourceIndex;
    query.bestEnemyId = Number.isInteger(candidate.id) ? candidate.id : INVALID_ENEMY_ID;
    query.bestX = candidateX;
    query.bestY = candidateY;
    query.found = true;
}

/**
 * 합체 육각형 파트너 공간 조회 후보를 평가합니다.
 * @param {object} candidate - 후보 적입니다.
 * @param {number} candidateX - tick 시작 후보 X입니다.
 * @param {number} candidateY - tick 시작 후보 Y입니다.
 * @param {number} sourceIndex - tick 시작 배열 인덱스입니다.
 * @param {object} query - 재사용 조회 문맥입니다.
 * @returns {void}
 */
function visitHexaHiveMergePartnerCandidate(candidate, candidateX, candidateY, sourceIndex, query) {
    if (
        !candidate
        || candidate === query.enemy
        || candidate.active === false
        || (query.currentId !== null && candidate.id === query.currentId)
        || !isHexaMergeTargetEnemy(candidate)
        || !canJoinHexaMergeTarget(query.enemy, candidate)
    ) {
        return;
    }

    const candidatePlayerDistance = length(query.playerX - candidateX, query.playerY - candidateY);
    if (candidatePlayerDistance + query.advanceMinPx >= query.selfPlayerDistance) {
        return;
    }

    const dx = candidateX - query.startX;
    const dy = candidateY - query.startY;
    const distanceSq = (dx * dx) + (dy * dy);
    if (distanceSq > query.searchRadiusSq) {
        return;
    }

    const hiveScore = candidate.type === HEXA_HIVE_TYPE ? query.hiveScoreMultiplier : 1;
    const score = (distanceSq * hiveScore)
        + (candidatePlayerDistance * candidatePlayerDistance * query.playerScoreWeight);
    if (score > query.bestScore || (score === query.bestScore && !isPreferredHexaPartnerTie(candidate, sourceIndex, query))) {
        return;
    }

    query.bestScore = score;
    query.bestTieId = Number.isInteger(candidate.id) ? candidate.id : Number.MAX_SAFE_INTEGER;
    query.bestSourceIndex = sourceIndex;
    query.bestEnemyId = Number.isInteger(candidate.id) ? candidate.id : INVALID_ENEMY_ID;
    query.bestX = candidateX;
    query.bestY = candidateY;
    query.found = true;
}

/**
 * 공간 인덱스를 우선 사용하고, 독립 호출 환경에서는 기존 배열 순회를 fallback으로 제공합니다.
 * @param {object} context - AI 문맥입니다.
 * @param {object[]|null} enemies - fallback 적 목록입니다.
 * @param {number} startX - 조회 중심 X입니다.
 * @param {number} startY - 조회 중심 Y입니다.
 * @param {number} searchRadius - 조회 반경입니다.
 * @param {Function} visitor - 후보 평가 함수입니다.
 * @param {object} query - 재사용 조회 문맥입니다.
 * @returns {void}
 */
function forEachHexaPartnerCandidate(context, enemies, startX, startY, searchRadius, visitor, query) {
    const enemySpatialIndex = context?.enemySpatialIndex;
    if (typeof enemySpatialIndex?.forEachInCircle === 'function') {
        enemySpatialIndex.forEachInCircle(
            startX,
            startY,
            searchRadius,
            ENEMY_SPATIAL_TYPE_MASK.HEXA_MERGE,
            visitor,
            query
        );
        return;
    }

    if (!Array.isArray(enemies)) {
        return;
    }
    for (let i = 0; i < enemies.length; i++) {
        const candidate = enemies[i];
        if (!candidate?.position) continue;
        visitor(
            candidate,
            Number.isFinite(candidate.position.x) ? candidate.position.x : 0,
            Number.isFinite(candidate.position.y) ? candidate.position.y : 0,
            i,
            query
        );
    }
}

/**
 * 현재 육각형 적이 따라갈 실제 합체 후보 목표를 공간 인덱스에서 찾습니다.
 * @param {object} enemy - 현재 적 객체입니다.
 * @param {object} context - AI 문맥입니다.
 * @param {object[]|null} enemies - fallback 전체 적 목록입니다.
 * @param {number} startX - 현재 X 좌표입니다.
 * @param {number} startY - 현재 Y 좌표입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {{x: number, y: number, count?: number, enemyId?: number}} out - 출력 버퍼입니다.
 * @param {object} query - 재사용 조회 문맥입니다.
 * @returns {{x: number, y: number, count?: number, enemyId?: number}|null} 선택한 합체 후보 목표입니다.
 */
const findHexaMergePartnerGoalInto = (enemy, context, enemies, startX, startY, profile, out, query) => {
    const searchRadius = Number.isFinite(profile.HEXA_CLUSTER_PARTNER_SEARCH_RADIUS_PX)
        ? Math.max(0, profile.HEXA_CLUSTER_PARTNER_SEARCH_RADIUS_PX)
        : 640;
    query.enemy = enemy;
    query.currentId = Number.isInteger(enemy?.id) ? enemy.id : null;
    query.startX = startX;
    query.startY = startY;
    query.searchRadiusSq = searchRadius * searchRadius;
    query.hiveScoreMultiplier = Number.isFinite(profile.HEXA_CLUSTER_HIVE_JOIN_SCORE_MULTIPLIER)
        ? Math.max(0.1, profile.HEXA_CLUSTER_HIVE_JOIN_SCORE_MULTIPLIER)
        : 0.85;
    query.bestScore = INF;
    query.bestTieId = Number.MAX_SAFE_INTEGER;
    query.bestSourceIndex = Number.MAX_SAFE_INTEGER;
    query.bestEnemyId = INVALID_ENEMY_ID;
    query.bestX = 0;
    query.bestY = 0;
    query.found = false;

    forEachHexaPartnerCandidate(
        context,
        enemies,
        startX,
        startY,
        searchRadius,
        visitHexaMergePartnerCandidate,
        query
    );
    if (!query.found) {
        return null;
    }

    out.x = query.bestX;
    out.y = query.bestY;
    out.count = 1;
    out.enemyId = query.bestEnemyId;
    return out;
};

/**
 * 합체 육각형이 플레이어 방향으로 전진하는 다른 육각 계열 합류 목표를 찾습니다.
 * @param {object} enemy - 현재 적 객체입니다.
 * @param {object} context - AI 문맥입니다.
 * @param {object[]|null} enemies - fallback 전체 적 목록입니다.
 * @param {number} startX - 현재 X 좌표입니다.
 * @param {number} startY - 현재 Y 좌표입니다.
 * @param {number} playerX - 플레이어 X 좌표입니다.
 * @param {number} playerY - 플레이어 Y 좌표입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {{x: number, y: number, count?: number, enemyId?: number}} out - 출력 버퍼입니다.
 * @param {object} query - 재사용 조회 문맥입니다.
 * @returns {{x: number, y: number, count?: number, enemyId?: number}|null} 선택한 합류 목표입니다.
 */
const findHexaHiveMergePartnerGoalInto = (
    enemy,
    context,
    enemies,
    startX,
    startY,
    playerX,
    playerY,
    profile,
    out,
    query
) => {
    const searchRadius = Number.isFinite(profile.HEXA_HIVE_MERGE_PARTNER_SEARCH_RADIUS_PX)
        ? Math.max(0, profile.HEXA_HIVE_MERGE_PARTNER_SEARCH_RADIUS_PX)
        : 1280;
    const selfPlayerDistance = length(playerX - startX, playerY - startY);
    if (!Number.isFinite(selfPlayerDistance)) {
        return null;
    }

    query.enemy = enemy;
    query.currentId = Number.isInteger(enemy?.id) ? enemy.id : null;
    query.startX = startX;
    query.startY = startY;
    query.playerX = playerX;
    query.playerY = playerY;
    query.selfPlayerDistance = selfPlayerDistance;
    query.advanceMinPx = Number.isFinite(profile.HEXA_HIVE_MERGE_PARTNER_PLAYER_ADVANCE_MIN_PX)
        ? Math.max(0, profile.HEXA_HIVE_MERGE_PARTNER_PLAYER_ADVANCE_MIN_PX)
        : 48;
    query.hiveScoreMultiplier = Number.isFinite(profile.HEXA_HIVE_MERGE_PARTNER_HIVE_SCORE_MULTIPLIER)
        ? Math.max(0.1, profile.HEXA_HIVE_MERGE_PARTNER_HIVE_SCORE_MULTIPLIER)
        : 0.65;
    query.playerScoreWeight = Number.isFinite(profile.HEXA_HIVE_MERGE_PARTNER_PLAYER_SCORE_WEIGHT)
        ? Math.max(0, profile.HEXA_HIVE_MERGE_PARTNER_PLAYER_SCORE_WEIGHT)
        : 0.35;
    query.searchRadiusSq = searchRadius * searchRadius;
    query.bestScore = INF;
    query.bestTieId = Number.MAX_SAFE_INTEGER;
    query.bestSourceIndex = Number.MAX_SAFE_INTEGER;
    query.bestEnemyId = INVALID_ENEMY_ID;
    query.bestX = 0;
    query.bestY = 0;
    query.found = false;

    forEachHexaPartnerCandidate(
        context,
        enemies,
        startX,
        startY,
        searchRadius,
        visitHexaHiveMergePartnerCandidate,
        query
    );
    if (!query.found) {
        return null;
    }

    out.x = query.bestX;
    out.y = query.bestY;
    out.count = 1;
    out.enemyId = query.bestEnemyId;
    return out;
};

/**
 * AI 문맥의 O(1) ID 인덱스를 우선 사용해 기존 파트너의 tick 시작 스냅샷을 찾습니다.
 * @param {object} context - AI 문맥입니다.
 * @param {number} enemyId - 조회할 적 ID입니다.
 * @param {{enemy?: object|null, x?: number, y?: number, sourceIndex?: number}} out - 결과 버퍼입니다.
 * @returns {{enemy: object, x: number, y: number, sourceIndex: number}|null} 적 스냅샷입니다.
 */
function findEnemySnapshotByIdFromAIContext(context, enemyId, out) {
    if (!Number.isInteger(enemyId) || enemyId === INVALID_ENEMY_ID) {
        return null;
    }

    const enemySpatialIndex = context?.enemySpatialIndex;
    if (typeof enemySpatialIndex?.getEnemySnapshotById === 'function') {
        return enemySpatialIndex.getEnemySnapshotById(enemyId, out);
    }
    if (typeof enemySpatialIndex?.getEnemyById === 'function') {
        const enemy = enemySpatialIndex.getEnemyById(enemyId);
        if (!enemy?.position) return null;
        out.enemy = enemy;
        out.x = Number.isFinite(enemy.position.x) ? enemy.position.x : 0;
        out.y = Number.isFinite(enemy.position.y) ? enemy.position.y : 0;
        out.sourceIndex = -1;
        return out;
    }

    const enemies = Array.isArray(context?.enemies) ? context.enemies : [];
    for (let i = 0; i < enemies.length; i++) {
        if (enemies[i]?.id === enemyId) {
            const enemy = enemies[i];
            if (!enemy.position) return null;
            out.enemy = enemy;
            out.x = Number.isFinite(enemy.position.x) ? enemy.position.x : 0;
            out.y = Number.isFinite(enemy.position.y) ? enemy.position.y : 0;
            out.sourceIndex = i;
            return out;
        }
    }
    return null;
}

/**
 * 파트너 추적 상태를 제거합니다.
 * @param {object} state - AI 상태입니다.
 * @returns {void}
 */
function clearHexaPartnerTargetState(state) {
    state.targetEnemyId = INVALID_ENEMY_ID;
    state.targetEnemyTtlSeconds = 0;
    state.targetEnemyWallsVersion = -1;
}

/**
 * 선택한 파트너를 짧은 유효 기간 동안 ID로 보관합니다.
 * @param {object} enemy - 현재 적입니다.
 * @param {object} state - AI 상태입니다.
 * @param {object} context - AI 문맥입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {{enemyId?: number}} partnerGoal - 선택한 파트너 목표입니다.
 * @returns {void}
 */
function retainHexaPartnerTargetState(enemy, state, context, profile, partnerGoal) {
    state.targetEnemyId = Number.isInteger(partnerGoal?.enemyId)
        ? partnerGoal.enemyId
        : INVALID_ENEMY_ID;
    const fallbackTtl = enemy?.type === HEXA_HIVE_TYPE ? 0.15 : 1;
    const configuredTtl = enemy?.type === HEXA_HIVE_TYPE
        ? profile.HEXA_HIVE_MERGE_PARTNER_TTL_SECONDS
        : profile.HEXA_CLUSTER_PARTNER_TTL_SECONDS;
    const decisionInterval = Number.isFinite(context?.decisionInterval)
        ? Math.max(0, context.decisionInterval)
        : 0;
    const ttl = Number.isFinite(configuredTtl) ? Math.max(0, configuredTtl) : fallbackTtl;
    state.targetEnemyTtlSeconds = enemy?.type === HEXA_HIVE_TYPE
        ? ttl
        : Math.max(ttl, decisionInterval);
    state.targetEnemyWallsVersion = Number.isInteger(context?.wallsVersion)
        ? context.wallsVersion
        : 0;
}

/**
 * fixed tick마다 파트너 TTL만 경량 갱신합니다.
 * @param {object} state - AI 상태입니다.
 * @param {number} stepDelta - fixed step 델타입니다.
 * @returns {void}
 */
export function stepEnemyAIPartnerTargetTtl(state, stepDelta) {
    const ttl = Number.isFinite(state?.targetEnemyTtlSeconds)
        ? state.targetEnemyTtlSeconds
        : 0;
    state.targetEnemyTtlSeconds = Math.max(0, ttl - Math.max(0, stepDelta));
}

/**
 * 기존 파트너가 활성·반경·구성원·플레이어 전진 조건을 계속 만족하면 tick 시작 좌표로 갱신합니다.
 * 점수 기반 새 파트너 선택은 TTL 만료 또는 heavy decision에서만 수행합니다.
 * @param {object} enemy - 현재 적입니다.
 * @param {object} state - AI 상태입니다.
 * @param {object} context - AI 문맥입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {number} startX - 현재 X입니다.
 * @param {number} startY - 현재 Y입니다.
 * @param {number} playerX - 플레이어 X입니다.
 * @param {number} playerY - 플레이어 Y입니다.
 * @returns {boolean} 기존 파트너를 계속 사용할 수 있는지 여부입니다.
 */
export function refreshCachedHexaPartnerIntent(
    enemy,
    state,
    context,
    profile,
    startX,
    startY,
    playerX,
    playerY
) {
    if (
        state.targetEnemyTtlSeconds <= 0
        || !Number.isInteger(state.targetEnemyId)
        || state.targetEnemyId === INVALID_ENEMY_ID
        || state.targetEnemyWallsVersion !== (Number.isInteger(context?.wallsVersion) ? context.wallsVersion : 0)
    ) {
        return false;
    }

    const candidateSnapshot = findEnemySnapshotByIdFromAIContext(
        context,
        state.targetEnemyId,
        state.scratchPartnerQuery
    );
    const candidate = candidateSnapshot?.enemy;
    if (
        !candidate
        || candidate === enemy
        || candidate.active === false
        || !candidate.position
        || !isHexaMergeTargetEnemy(candidate)
        || !canJoinHexaMergeTarget(enemy, candidate)
    ) {
        clearHexaPartnerTargetState(state);
        return false;
    }

    const candidateX = candidateSnapshot.x;
    const candidateY = candidateSnapshot.y;
    const dx = candidateX - startX;
    const dy = candidateY - startY;
    const searchRadius = enemy?.type === HEXA_HIVE_TYPE
        ? profile.HEXA_HIVE_MERGE_PARTNER_SEARCH_RADIUS_PX
        : profile.HEXA_CLUSTER_PARTNER_SEARCH_RADIUS_PX;
    const safeSearchRadius = Number.isFinite(searchRadius)
        ? Math.max(0, searchRadius)
        : (enemy?.type === HEXA_HIVE_TYPE ? 1280 : 640);
    if ((dx * dx) + (dy * dy) > safeSearchRadius * safeSearchRadius) {
        clearHexaPartnerTargetState(state);
        return false;
    }

    if (enemy?.type === HEXA_HIVE_TYPE) {
        const selfPlayerDistance = length(playerX - startX, playerY - startY);
        const candidatePlayerDistance = length(playerX - candidateX, playerY - candidateY);
        const advanceMinPx = Number.isFinite(profile.HEXA_HIVE_MERGE_PARTNER_PLAYER_ADVANCE_MIN_PX)
            ? Math.max(0, profile.HEXA_HIVE_MERGE_PARTNER_PLAYER_ADVANCE_MIN_PX)
            : 48;
        if (
            !Number.isFinite(selfPlayerDistance)
            || !Number.isFinite(candidatePlayerDistance)
            || candidatePlayerDistance + advanceMinPx >= selfPlayerDistance
        ) {
            clearHexaPartnerTargetState(state);
            return false;
        }
    }

    state.targetX = candidateX;
    state.targetY = candidateY;
    return true;
}

/**
 * 합체 육각형의 고비용 정책 목표를 이번 tick에 다시 계산해야 하는지 반환합니다.
 * @param {object} enemy - 현재 적입니다.
 * @param {object} state - AI 상태입니다.
 * @param {object} context - AI 문맥입니다.
 * @param {boolean} hasCachedPartner - 유효한 캐시 파트너가 있는지 여부입니다.
 * @returns {boolean} 정책 목표 재계산 필요 여부입니다.
 */
export function shouldRefreshHexaHivePolicyIntent(enemy, state, context, hasCachedPartner) {
    if (enemy?.type !== HEXA_HIVE_TYPE) {
        return false;
    }
    if (state.flowPolicyKey === 'hexa_hive_merge_partner') {
        return !hasCachedPartner;
    }
    if (!Number.isFinite(state.targetX) || !Number.isFinite(state.targetY)) {
        return true;
    }
    const wallsVersion = Number.isInteger(context?.wallsVersion) ? context.wallsVersion : 0;
    return state.policyIntentWallsVersion !== wallsVersion;
}

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
    const clearance = resolveEnemyAIFootprintPathClearancePx(metrics, profile)
        || Math.max(readPositivePixelValue(navigationRadius), readPositivePixelValue(metrics?.radius));
    const walls = Array.isArray(context?.walls) ? context.walls : [];
    const nav = getNavGrid(
        walls,
        getSimulationWW(),
        getSimulationObjectWH(),
        profile,
        clearance,
        Number.isInteger(context?.wallsVersion) ? context.wallsVersion : null
    );
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
    const innerRingRatio = clampNumber(
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
            const alignmentPenalty = 1 - clampNumber((snappedDirX * baseDirX) + (snappedDirY * baseDirY), -1, 1);
            const isDirectBlocked = isSegmentBlockedByCoords(
                startX,
                startY,
                snappedX,
                snappedY,
                walls,
                directPad,
                Number.isInteger(context?.wallsVersion) ? context.wallsVersion : null
            );
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
    state.policyIntentWallsVersion = Number.isInteger(context?.wallsVersion) ? context.wallsVersion : 0;
    clearHexaPartnerTargetState(state);

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
            context,
            enemies,
            startX,
            startY,
            profile,
            state.scratchDensityGoal,
            state.scratchPartnerQuery
        );
        if (partnerGoal) {
            state.targetX = partnerGoal.x;
            state.targetY = partnerGoal.y;
            state.flowPolicyKey = 'cluster_partner_join';
            retainHexaPartnerTargetState(enemy, state, context, profile, partnerGoal);
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
        const mergePartnerGoal = findHexaHiveMergePartnerGoalInto(
            enemy,
            context,
            enemies,
            startX,
            startY,
            playerX,
            playerY,
            profile,
            state.scratchDensityGoal,
            state.scratchPartnerQuery
        );
        if (mergePartnerGoal) {
            state.targetX = mergePartnerGoal.x;
            state.targetY = mergePartnerGoal.y;
            state.flowPolicyKey = 'hexa_hive_merge_partner';
            retainHexaPartnerTargetState(enemy, state, context, profile, mergePartnerGoal);
            return;
        }

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
