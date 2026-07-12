import { getData } from 'data/data_handler.js';
import { clampNumber } from 'util/number_util.js';

const COLLISION_CONSTANTS = getData('COLLISION_CONSTANTS');
const COLLISION_RESOLVE_TUNING = COLLISION_CONSTANTS.RESOLVE_TUNING;
const EPSILON = COLLISION_CONSTANTS.EPSILON;

export const COLLISION_RESOLVE_FRAME_MAX_RATIO = COLLISION_RESOLVE_TUNING.FRAME_MAX_RATIO;
export const COLLISION_RESOLVE_FRAME_MIN_MAX = COLLISION_RESOLVE_TUNING.FRAME_MIN_MAX;
export const COLLISION_RESOLVE_MIN_MAX = COLLISION_RESOLVE_TUNING.MIN_MAX;
export const HEXA_HIVE_COLLISION_RESOLVE_RADIUS_SCALE = COLLISION_RESOLVE_TUNING.HEXA_HIVE_RADIUS_SCALE;
export const HEXA_HIVE_COLLISION_RESOLVE_RADIUS_ROOT_SCALE = COLLISION_RESOLVE_TUNING.HEXA_HIVE_RADIUS_ROOT_SCALE;
export const ENEMY_PAIR_COLLISION_RADIUS_BASE_SCALE = COLLISION_RESOLVE_TUNING.ENEMY_PAIR_RADIUS_BASE_SCALE;
export const ENEMY_PROJECTILE_COLLISION_RADIUS_BASE_SCALE = COLLISION_RESOLVE_TUNING.ENEMY_PROJECTILE_RADIUS_BASE_SCALE;
const COLLISION_RESOLVE_PERCENT = COLLISION_RESOLVE_TUNING.PERCENT;
const COLLISION_RESOLVE_SLOP = COLLISION_RESOLVE_TUNING.SLOP;
const COLLISION_RESOLVE_MAX_RATIO = COLLISION_RESOLVE_TUNING.MAX_RATIO;
const COLLISION_RADIUS_TUNING_SCALE = COLLISION_RESOLVE_TUNING.RADIUS_TUNING_SCALE;
export const ENEMY_PAIR_COLLISION_RADIUS_SCALE = ENEMY_PAIR_COLLISION_RADIUS_BASE_SCALE * COLLISION_RADIUS_TUNING_SCALE;
export const ENEMY_PROJECTILE_COLLISION_RADIUS_SCALE = ENEMY_PROJECTILE_COLLISION_RADIUS_BASE_SCALE * COLLISION_RADIUS_TUNING_SCALE;
export const HEXA_HIVE_CELL_COLLISION_RADIUS = COLLISION_RESOLVE_TUNING.HEXA_HIVE_CELL_RADIUS_BASE / ENEMY_PAIR_COLLISION_RADIUS_BASE_SCALE;
export const DENSE_POSITION_SOLVE_MAX_PASSES = COLLISION_RESOLVE_TUNING.DENSE_POSITION_SOLVE_MAX_PASSES;
const DENSE_PRESSURE_LOCAL_START = COLLISION_RESOLVE_TUNING.DENSE_PRESSURE_LOCAL_START;
const DENSE_PRESSURE_LOCAL_FULL = COLLISION_RESOLVE_TUNING.DENSE_PRESSURE_LOCAL_FULL;
const DENSE_PRESSURE_GLOBAL_FULL = COLLISION_RESOLVE_TUNING.DENSE_PRESSURE_GLOBAL_FULL;
const DENSE_POPULATION_BLEND_START = COLLISION_RESOLVE_TUNING.DENSE_POPULATION_BLEND_START;
const DENSE_POPULATION_BLEND_END = COLLISION_RESOLVE_TUNING.DENSE_POPULATION_BLEND_END;
const DENSE_ITERATION_RESOLVE_BOOST_MIN = COLLISION_RESOLVE_TUNING.DENSE_ITERATION_RESOLVE_BOOST_MIN;
const DENSE_ITERATION_RESOLVE_BOOST_MAX = COLLISION_RESOLVE_TUNING.DENSE_ITERATION_RESOLVE_BOOST_MAX;
const DENSE_RESOLVE_BOOST_MIN = COLLISION_RESOLVE_TUNING.DENSE_RESOLVE_BOOST_MIN;
const DENSE_RESOLVE_BOOST_MAX = COLLISION_RESOLVE_TUNING.DENSE_RESOLVE_BOOST_MAX;
const DENSE_CORRECTION_CANDIDATE_THRESHOLD = COLLISION_RESOLVE_TUNING.DENSE_CORRECTION_CANDIDATE_THRESHOLD;
const DENSE_CORRECTION_SCALE_PER_NEIGHBOR = COLLISION_RESOLVE_TUNING.DENSE_CORRECTION_SCALE_PER_NEIGHBOR;
const DENSE_CORRECTION_SCALE_MAX = COLLISION_RESOLVE_TUNING.DENSE_CORRECTION_SCALE_MAX;
const DENSE_FRAME_CANDIDATE_THRESHOLD = COLLISION_RESOLVE_TUNING.DENSE_FRAME_CANDIDATE_THRESHOLD;
const DENSE_FRAME_SCALE_PER_NEIGHBOR = COLLISION_RESOLVE_TUNING.DENSE_FRAME_SCALE_PER_NEIGHBOR;
const DENSE_FRAME_SCALE_MAX = COLLISION_RESOLVE_TUNING.DENSE_FRAME_SCALE_MAX;
export const COLLISION_CANDIDATE_SWEEP_PAD_SCALE = DENSE_FRAME_SCALE_MAX * Math.max(
    DENSE_ITERATION_RESOLVE_BOOST_MAX,
    DENSE_RESOLVE_BOOST_MAX
);
const PRESSURE_WEIGHT_MIN = COLLISION_RESOLVE_TUNING.PRESSURE_WEIGHT_MIN;
const PRESSURE_WEIGHT_MAX = COLLISION_RESOLVE_TUNING.PRESSURE_WEIGHT_MAX;
const PRESSURE_HEXA_HIVE_WEIGHT_MAX = COLLISION_RESOLVE_TUNING.PRESSURE_HEXA_HIVE_WEIGHT_MAX;
const PRESSURE_WEIGHT_EXPONENT = COLLISION_RESOLVE_TUNING.PRESSURE_WEIGHT_EXPONENT;
export const MERGE_PENDING_RESOLVE_WEIGHT = COLLISION_RESOLVE_TUNING.MERGE_PENDING_RESOLVE_WEIGHT;
const PRESSURE_ENTRY_THRESHOLD = COLLISION_RESOLVE_TUNING.PRESSURE_ENTRY_THRESHOLD;
const PRESSURE_ENTRY_SCALE_PER_NEIGHBOR = COLLISION_RESOLVE_TUNING.PRESSURE_ENTRY_SCALE_PER_NEIGHBOR;
const PRESSURE_ENTRY_SCALE_MAX = COLLISION_RESOLVE_TUNING.PRESSURE_ENTRY_SCALE_MAX;
const PRESSURE_ESCAPE_THRESHOLD = COLLISION_RESOLVE_TUNING.PRESSURE_ESCAPE_THRESHOLD;
const PRESSURE_ESCAPE_SCALE_PER_NEIGHBOR = COLLISION_RESOLVE_TUNING.PRESSURE_ESCAPE_SCALE_PER_NEIGHBOR;
const PRESSURE_ESCAPE_SCALE_MAX = COLLISION_RESOLVE_TUNING.PRESSURE_ESCAPE_SCALE_MAX;
const HEXA_HIVE_WALL_MIN_PARTS = COLLISION_RESOLVE_TUNING.HEXA_HIVE_WALL_MIN_PARTS;
/**
 * 첫 해소 패스의 전역·국소 접촉량을 0~1의 연속 압력으로 변환합니다.
 * @param {number} resolvedCount - 첫 패스에서 해소한 pair 수입니다.
 * @param {number} bodyCount - 현재 충돌 body 수입니다.
 * @param {number} peakCandidatePairs - 한 body의 최대 후보 pair 수입니다.
 * @returns {number} 정규화된 dense 압력입니다.
 */
export function getCollisionDensePressure(resolvedCount, bodyCount, peakCandidatePairs) {
    const localRange = Math.max(EPSILON, DENSE_PRESSURE_LOCAL_FULL - DENSE_PRESSURE_LOCAL_START);
    const localPressure = clampNumber(
        (peakCandidatePairs - DENSE_PRESSURE_LOCAL_START) / localRange,
        0,
        1
    );
    const globalDensity = Math.max(0, resolvedCount) / Math.max(1, bodyCount);
    const globalPressure = clampNumber(
        globalDensity / Math.max(EPSILON, DENSE_PRESSURE_GLOBAL_FULL),
        0,
        1
    );
    return Math.max(localPressure, globalPressure);
}

/**
 * 개체 수와 dense 압력을 연속 보간해 해소 패스의 보정 배율을 반환합니다.
 * @param {number} passIndex - 0부터 시작하는 위치 해소 패스 인덱스입니다.
 * @param {number} dynamicBodyCount - 현재 동적 적 body 수입니다.
 * @param {number} densePressure - 첫 패스에서 계산한 0~1 압력입니다.
 * @returns {number} 해당 패스의 해소 보정 배율입니다.
 */
export function getCollisionResolvePassBoost(passIndex, dynamicBodyCount, densePressure) {
    if (passIndex <= 0) {
        return 1;
    }

    const populationRange = Math.max(1, DENSE_POPULATION_BLEND_END - DENSE_POPULATION_BLEND_START);
    const populationBlend = clampNumber(
        (dynamicBodyCount - DENSE_POPULATION_BLEND_START) / populationRange,
        0,
        1
    );
    const pressure = clampNumber(densePressure, 0, 1);
    const minBoost = passIndex === 1
        ? DENSE_ITERATION_RESOLVE_BOOST_MIN
        : DENSE_RESOLVE_BOOST_MIN;
    const maxBoost = passIndex === 1
        ? DENSE_ITERATION_RESOLVE_BOOST_MAX
        : DENSE_RESOLVE_BOOST_MAX;
    const populationBoost = minBoost + ((maxBoost - minBoost) * populationBlend);
    return 1 + ((populationBoost - 1) * pressure);
}

/**
 * 충돌 관계별 가상 원 반지름 스케일을 반환합니다.
 * @param {object} body - 기준 body입니다.
 * @param {object} otherBody - 상대 body입니다.
 * @returns {number} 관계별 반지름 스케일입니다.
 */
export function getCollisionBodyCollisionRadiusScale(body, otherBody) {
    if (body?.kind !== 'enemy') {
        return 1;
    }
    if (otherBody?.kind === 'projectile') {
        return ENEMY_PROJECTILE_COLLISION_RADIUS_SCALE;
    }
    if (otherBody?.kind === 'enemy') {
        return ENEMY_PAIR_COLLISION_RADIUS_SCALE;
    }
    return 1;
}

/**
 * 2셀 이상 합체한 hive가 적-적 충돌에서 벽처럼 고정되어야 하는지 반환합니다.
 * @param {object} body - 검사 대상 body입니다.
 * @returns {boolean} 적-적 충돌 앵커 후보 여부입니다.
 */
export function isCollisionHexaHiveWallBody(body) {
    if (body?.kind !== 'enemy' || body?.ref?.type !== 'hexa_hive') {
        return false;
    }

    const partCount = Number.isFinite(body.circlePartCount)
        ? Math.floor(body.circlePartCount)
        : 0;
    if (partCount >= HEXA_HIVE_WALL_MIN_PARTS) {
        return true;
    }

    const layout = body.ref?.hexaHiveLayout;
    const filledCount = Array.isArray(layout?.filledLocalCenters) ? layout.filledLocalCenters.length : 0;
    const visibleCount = Array.isArray(layout?.visibleLocalCenters) ? layout.visibleLocalCenters.length : 0;
    return Math.max(filledCount, visibleCount) >= HEXA_HIVE_WALL_MIN_PARTS;
}

/**
 * body가 현재 적-적 pair에서 위치 보정 앵커인지 반환합니다.
 * @param {object} body - 기준 body입니다.
 * @param {object} otherBody - 상대 body입니다.
 * @returns {boolean} 위치 보정 앵커 여부입니다.
 */
export function isCollisionEnemyPairAnchorBody(body, otherBody) {
    if (otherBody?.kind !== 'enemy' || !isCollisionHexaHiveWallBody(body)) {
        return false;
    }

    return !isCollisionHexaHiveWallBody(otherBody);
}

/**
 * 현재 pair에서 body가 위치 보정으로 이동 가능한지 반환합니다.
 * @param {object} body - 기준 body입니다.
 * @param {object} otherBody - 상대 body입니다.
 * @param {boolean|null} ruleMovable - 충돌 규칙의 이동 가능 플래그입니다.
 * @returns {boolean} 위치 보정 이동 가능 여부입니다.
 */
export function isCollisionPairResolveMovable(body, otherBody, ruleMovable) {
    const movable = ruleMovable === null ? body?.movable !== false : ruleMovable !== false;
    if (!movable) {
        return false;
    }

    return !isCollisionEnemyPairAnchorBody(body, otherBody);
}

/**
 * 과밀한 쪽이 덜 과밀한 쪽에게 밀리지 않도록 해소용 weight를 재계산합니다.
 * @param {object} body - 가중치를 계산할 body입니다.
 * @param {object} otherBody - 상대 body입니다.
 * @returns {number} 위치 보정 가중치입니다.
 */
export function getCollisionPairResolveWeight(body, otherBody) {
    const weight = Number.isFinite(body?.weight) ? body.weight : 1;
    if (body?.kind !== 'enemy' || otherBody?.kind !== 'enemy') {
        return weight;
    }

    return getCollisionResolveWeight(body) * getCollisionEntryResistanceScale(getCollisionBodyPressure(body));
}

/**
 * 과밀 코어에 끼인 적끼리의 충돌은 추가 분리 부스트를 적용합니다.
 * @param {object} bodyA - 첫 번째 body입니다.
 * @param {object} bodyB - 두 번째 body입니다.
 * @returns {number} pair 해소 부스트입니다.
 */
export function getCollisionPairEscapeBoost(bodyA, bodyB) {
    if (bodyA?.kind !== 'enemy' || bodyB?.kind !== 'enemy') return 1;
    const jamPressure = Math.min(getCollisionBodyPressure(bodyA), getCollisionBodyPressure(bodyB));
    if (jamPressure < PRESSURE_ESCAPE_THRESHOLD) return 1;
    const extra = jamPressure - PRESSURE_ESCAPE_THRESHOLD + 1;
    return Math.min(
        PRESSURE_ESCAPE_SCALE_MAX,
        1 + (extra * PRESSURE_ESCAPE_SCALE_PER_NEIGHBOR)
    );
}

/**
 * body가 현재 얼마나 압축된 상태인지 후보/해결 충돌 수로 추정합니다.
 * @param {object} body - 검사 대상 body입니다.
 * @returns {number} 압력 추정값입니다.
 */
export function getCollisionBodyPressure(body) {
    const candidateCount = Number.isFinite(body?._candidatePairCount) ? body._candidatePairCount : 0;
    const resolvedCount = Number.isFinite(body?._resolvedPairCount) ? body._resolvedPairCount : 0;
    return Math.max(candidateCount, resolvedCount);
}

/**
 * 침투량 보정 이동을 감쇠/상한 처리하여 과도한 순간 이동을 억제합니다.
 * @param {object|null} resolved - detector가 계산한 원본 이동량입니다.
 * @param {object|null} manifold - 충돌 manifold입니다.
 * @param {object} bodyA - 첫 번째 body입니다.
 * @param {object} bodyB - 두 번째 body입니다.
 * @param {number} [resolveBoost=1] - 해소 부스트입니다.
 * @returns {object|null} 이동량을 제자리에서 갱신한 resolved 객체입니다.
 */
export function tuneCollisionResolutionMoves(resolved, manifold, bodyA, bodyB, resolveBoost = 1) {
    if (!resolved || !manifold) {
        return null;
    }

    const rawPenetration = Number.isFinite(manifold.penetration) ? manifold.penetration : 0;
    const slopScale = resolveBoost > 1 ? (1 / resolveBoost) : 1;
    const effectivePenetration = Math.max(0, rawPenetration - (COLLISION_RESOLVE_SLOP * slopScale));
    if (effectivePenetration <= 0) {
        resolved.moveAX = 0;
        resolved.moveAY = 0;
        resolved.moveBX = 0;
        resolved.moveBY = 0;
        return resolved;
    }

    const penetrationRatio = effectivePenetration / Math.max(EPSILON, rawPenetration);
    const correctionScale = COLLISION_RESOLVE_PERCENT * penetrationRatio * resolveBoost;

    const rawMoveAX = (resolved.moveAX || 0) * correctionScale;
    const rawMoveAY = (resolved.moveAY || 0) * correctionScale;
    const rawMoveBX = (resolved.moveBX || 0) * correctionScale;
    const rawMoveBY = (resolved.moveBY || 0) * correctionScale;
    const clampScaleA = getCollisionCorrectionVectorScale(
        rawMoveAX,
        rawMoveAY,
        bodyA,
        resolveBoost
    );
    const clampScaleB = getCollisionCorrectionVectorScale(
        rawMoveBX,
        rawMoveBY,
        bodyB,
        resolveBoost
    );
    resolved.moveAX = rawMoveAX * clampScaleA;
    resolved.moveAY = rawMoveAY * clampScaleA;
    resolved.moveBX = rawMoveBX * clampScaleB;
    resolved.moveBY = rawMoveBY * clampScaleB;
    return resolved;
}

/**
 * 고밀도 접촉 상태에서 프레임당 이동 상한을 제한적으로 높입니다.
 * @param {object} body - 검사 대상 body입니다.
 * @returns {number} 프레임 이동 상한 배율입니다.
 */
export function getCollisionDenseFrameScale(body) {
    const candidateCount = getCollisionBodyPressure(body);
    if (candidateCount < DENSE_FRAME_CANDIDATE_THRESHOLD) return 1;
    const extra = candidateCount - DENSE_FRAME_CANDIDATE_THRESHOLD + 1;
    return Math.min(
        DENSE_FRAME_SCALE_MAX,
        1 + (extra * DENSE_FRAME_SCALE_PER_NEIGHBOR)
    );
}

/**
 * 해소에 쓰는 weight는 원본 차이를 압축해 과도한 고정벽화를 줄입니다.
 * @param {object} body - 검사 대상 body입니다.
 * @returns {number} 위치 보정 가중치입니다.
 */
function getCollisionResolveWeight(body) {
    const rawWeight = Number.isFinite(body?.weight) ? body.weight : 1;
    if (body?.mergeLock === true) {
        return MERGE_PENDING_RESOLVE_WEIGHT;
    }

    const maxWeight = body?.ref?.type === 'hexa_hive'
        ? PRESSURE_HEXA_HIVE_WEIGHT_MAX
        : PRESSURE_WEIGHT_MAX;
    const clamped = clampNumber(rawWeight, PRESSURE_WEIGHT_MIN, maxWeight);
    return Math.pow(clamped, PRESSURE_WEIGHT_EXPONENT);
}

/**
 * 과밀할수록 entry resistance를 키워 덜 과밀한 적이 안쪽으로 파고드는 것을 줄입니다.
 * @param {number} pressure - 압력 추정값입니다.
 * @returns {number} 진입 저항 배율입니다.
 */
function getCollisionEntryResistanceScale(pressure) {
    if (!Number.isFinite(pressure) || pressure < PRESSURE_ENTRY_THRESHOLD) return 1;
    const extra = pressure - PRESSURE_ENTRY_THRESHOLD + 1;
    return Math.min(
        PRESSURE_ENTRY_SCALE_MAX,
        1 + (extra * PRESSURE_ENTRY_SCALE_PER_NEIGHBOR)
    );
}

/**
 * 침투 보정 벡터 크기를 body별 최대 보정량으로 제한합니다.
 * @param {number} dx - X축 이동량입니다.
 * @param {number} dy - Y축 이동량입니다.
 * @param {object} body - 대상 body입니다.
 * @param {number} [resolveBoost=1] - 해소 부스트입니다.
 * @returns {number} 원본 벡터에 곱할 제한 배율입니다.
 */
function getCollisionCorrectionVectorScale(dx, dy, body, resolveBoost = 1) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
    const mag = Math.hypot(dx, dy);
    if (mag <= EPSILON) return 0;

    const radius = Number.isFinite(body?.resolveRadius)
        ? body.resolveRadius
        : (Number.isFinite(body?.boundRadius) ? body.boundRadius : COLLISION_RESOLVE_TUNING.DEFAULT_BODY_RADIUS);
    const baseMaxCorrection = Math.max(COLLISION_RESOLVE_MIN_MAX, radius * COLLISION_RESOLVE_MAX_RATIO);
    const maxCorrection = baseMaxCorrection * getCollisionDenseCorrectionScale(body) * resolveBoost;
    if (mag <= maxCorrection) {
        return 1;
    }

    return maxCorrection / mag;
}

/**
 * 고밀도 접촉 상태에서만 분리 보정 상한을 제한적으로 높입니다.
 * @param {object} body - 검사 대상 body입니다.
 * @returns {number} 보정 상한 배율입니다.
 */
function getCollisionDenseCorrectionScale(body) {
    const candidateCount = getCollisionBodyPressure(body);
    if (candidateCount < DENSE_CORRECTION_CANDIDATE_THRESHOLD) return 1;
    const extra = candidateCount - DENSE_CORRECTION_CANDIDATE_THRESHOLD + 1;
    return Math.min(
        DENSE_CORRECTION_SCALE_MAX,
        1 + (extra * DENSE_CORRECTION_SCALE_PER_NEIGHBOR)
    );
}
