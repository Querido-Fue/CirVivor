import { getData } from 'data/data_handler.js';

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
export const DENSE_REBUILD_DENSITY_THRESHOLD = COLLISION_RESOLVE_TUNING.DENSE_REBUILD_DENSITY_THRESHOLD;
export const DENSE_REBUILD_MIN_RESOLVED = COLLISION_RESOLVE_TUNING.DENSE_REBUILD_MIN_RESOLVED;
const DENSE_REBUILD_MAX_EXTRA_PASSES = COLLISION_RESOLVE_TUNING.DENSE_REBUILD_MAX_EXTRA_PASSES;
const DENSE_MIN_ITERATION_FLOOR = COLLISION_RESOLVE_TUNING.DENSE_MIN_ITERATION_FLOOR;
export const DENSE_LOCAL_CANDIDATE_THRESHOLD = COLLISION_RESOLVE_TUNING.DENSE_LOCAL_CANDIDATE_THRESHOLD;
const DENSE_STABILIZE_MAX_PASSES = COLLISION_RESOLVE_TUNING.DENSE_STABILIZE_MAX_PASSES;
const DENSE_STABILIZE_LIGHT_MAX_PASSES = COLLISION_RESOLVE_TUNING.DENSE_STABILIZE_LIGHT_MAX_PASSES;
export const DENSE_STABILIZE_MIN_RESOLVED = COLLISION_RESOLVE_TUNING.DENSE_STABILIZE_MIN_RESOLVED;
export const DENSE_ADAPTIVE_LIGHT_DENSITY_THRESHOLD = COLLISION_RESOLVE_TUNING.DENSE_ADAPTIVE_LIGHT_DENSITY_THRESHOLD;
export const DENSE_ADAPTIVE_DENSITY_SCALE = COLLISION_RESOLVE_TUNING.DENSE_ADAPTIVE_DENSITY_SCALE;
export const DENSE_ADAPTIVE_MIN_ITERATIONS = COLLISION_RESOLVE_TUNING.DENSE_ADAPTIVE_MIN_ITERATIONS;
export const DENSE_STABILIZE_HEAVY_CANDIDATE_SCALE = COLLISION_RESOLVE_TUNING.DENSE_STABILIZE_HEAVY_CANDIDATE_SCALE;
const DENSE_ITERATION_RESOLVE_BOOST = COLLISION_RESOLVE_TUNING.DENSE_ITERATION_RESOLVE_BOOST;
const DENSE_RESOLVE_BOOST = COLLISION_RESOLVE_TUNING.DENSE_RESOLVE_BOOST;
const LARGE_POPULATION_DENSE_BODY_THRESHOLD = COLLISION_RESOLVE_TUNING.LARGE_POPULATION_DENSE_BODY_THRESHOLD;
const LARGE_POPULATION_DENSE_REBUILD_MAX_EXTRA_PASSES = COLLISION_RESOLVE_TUNING.LARGE_POPULATION_DENSE_REBUILD_MAX_EXTRA_PASSES;
const LARGE_POPULATION_DENSE_MIN_ITERATION_FLOOR = COLLISION_RESOLVE_TUNING.LARGE_POPULATION_DENSE_MIN_ITERATION_FLOOR;
const LARGE_POPULATION_DENSE_STABILIZE_MAX_PASSES = COLLISION_RESOLVE_TUNING.LARGE_POPULATION_DENSE_STABILIZE_MAX_PASSES;
const LARGE_POPULATION_DENSE_STABILIZE_LIGHT_MAX_PASSES = COLLISION_RESOLVE_TUNING.LARGE_POPULATION_DENSE_STABILIZE_LIGHT_MAX_PASSES;
const LARGE_POPULATION_DENSE_ITERATION_RESOLVE_BOOST = COLLISION_RESOLVE_TUNING.LARGE_POPULATION_DENSE_ITERATION_RESOLVE_BOOST;
const LARGE_POPULATION_DENSE_RESOLVE_BOOST = COLLISION_RESOLVE_TUNING.LARGE_POPULATION_DENSE_RESOLVE_BOOST;
const DENSE_CORRECTION_CANDIDATE_THRESHOLD = COLLISION_RESOLVE_TUNING.DENSE_CORRECTION_CANDIDATE_THRESHOLD;
const DENSE_CORRECTION_SCALE_PER_NEIGHBOR = COLLISION_RESOLVE_TUNING.DENSE_CORRECTION_SCALE_PER_NEIGHBOR;
const DENSE_CORRECTION_SCALE_MAX = COLLISION_RESOLVE_TUNING.DENSE_CORRECTION_SCALE_MAX;
const DENSE_FRAME_CANDIDATE_THRESHOLD = COLLISION_RESOLVE_TUNING.DENSE_FRAME_CANDIDATE_THRESHOLD;
const DENSE_FRAME_SCALE_PER_NEIGHBOR = COLLISION_RESOLVE_TUNING.DENSE_FRAME_SCALE_PER_NEIGHBOR;
const DENSE_FRAME_SCALE_MAX = COLLISION_RESOLVE_TUNING.DENSE_FRAME_SCALE_MAX;
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
 * 적 수에 따라 dense 충돌 해소 반복 상한을 반환합니다.
 * @param {number} dynamicBodyCount - 현재 동적 적 body 수입니다.
 * @returns {{largePopulation:boolean, denseRebuildMaxExtraPasses:number, denseMinIterationFloor:number, denseStabilizeMaxPasses:number, denseStabilizeLightMaxPasses:number, denseIterationResolveBoost:number, denseResolveBoost:number}} dense solve 튜닝 값입니다.
 */
export function getDenseSolveTuning(dynamicBodyCount) {
    const largePopulation = Number.isFinite(dynamicBodyCount)
        && dynamicBodyCount >= LARGE_POPULATION_DENSE_BODY_THRESHOLD;
    if (!largePopulation) {
        return {
            largePopulation: false,
            denseRebuildMaxExtraPasses: DENSE_REBUILD_MAX_EXTRA_PASSES,
            denseMinIterationFloor: DENSE_MIN_ITERATION_FLOOR,
            denseStabilizeMaxPasses: DENSE_STABILIZE_MAX_PASSES,
            denseStabilizeLightMaxPasses: DENSE_STABILIZE_LIGHT_MAX_PASSES,
            denseIterationResolveBoost: DENSE_ITERATION_RESOLVE_BOOST,
            denseResolveBoost: DENSE_RESOLVE_BOOST
        };
    }

    return {
        largePopulation: true,
        denseRebuildMaxExtraPasses: LARGE_POPULATION_DENSE_REBUILD_MAX_EXTRA_PASSES,
        denseMinIterationFloor: LARGE_POPULATION_DENSE_MIN_ITERATION_FLOOR,
        denseStabilizeMaxPasses: LARGE_POPULATION_DENSE_STABILIZE_MAX_PASSES,
        denseStabilizeLightMaxPasses: LARGE_POPULATION_DENSE_STABILIZE_LIGHT_MAX_PASSES,
        denseIterationResolveBoost: LARGE_POPULATION_DENSE_ITERATION_RESOLVE_BOOST,
        denseResolveBoost: LARGE_POPULATION_DENSE_RESOLVE_BOOST
    };
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
 * 양쪽 모두 적-적 보정 앵커인지 반환합니다.
 * @param {object} bodyA - 첫 번째 body입니다.
 * @param {object} bodyB - 두 번째 body입니다.
 * @returns {boolean} 양쪽 모두 앵커인지 여부입니다.
 */
export function areCollisionEnemyPairAnchors(bodyA, bodyB) {
    return isCollisionEnemyPairAnchorBody(bodyA, bodyB)
        && isCollisionEnemyPairAnchorBody(bodyB, bodyA);
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
 * @param {object} bodyA - 첫 번째 body입니다.
 * @param {object} bodyB - 두 번째 body입니다.
 * @returns {{weightA:number, weightB:number}} 위치 보정 가중치입니다.
 */
export function getCollisionPairResolveWeights(bodyA, bodyB) {
    const weightA = Number.isFinite(bodyA?.weight) ? bodyA.weight : 1;
    const weightB = Number.isFinite(bodyB?.weight) ? bodyB.weight : 1;
    if (bodyA?.kind !== 'enemy' || bodyB?.kind !== 'enemy') {
        return { weightA, weightB };
    }

    const pressureA = getCollisionBodyPressure(bodyA);
    const pressureB = getCollisionBodyPressure(bodyB);
    return {
        weightA: getCollisionResolveWeight(bodyA) * getCollisionEntryResistanceScale(pressureA),
        weightB: getCollisionResolveWeight(bodyB) * getCollisionEntryResistanceScale(pressureB)
    };
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
 * @returns {{moveAX:number, moveAY:number, moveBX:number, moveBY:number}} 튜닝된 이동량입니다.
 */
export function tuneCollisionResolutionMoves(resolved, manifold, bodyA, bodyB, resolveBoost = 1) {
    if (!resolved || !manifold) {
        return {
            moveAX: 0,
            moveAY: 0,
            moveBX: 0,
            moveBY: 0
        };
    }

    const rawPenetration = Number.isFinite(manifold.penetration) ? manifold.penetration : 0;
    const slopScale = resolveBoost > 1 ? (1 / resolveBoost) : 1;
    const effectivePenetration = Math.max(0, rawPenetration - (COLLISION_RESOLVE_SLOP * slopScale));
    if (effectivePenetration <= 0) {
        return {
            moveAX: 0,
            moveAY: 0,
            moveBX: 0,
            moveBY: 0
        };
    }

    const penetrationRatio = effectivePenetration / Math.max(EPSILON, rawPenetration);
    const correctionScale = COLLISION_RESOLVE_PERCENT * penetrationRatio * resolveBoost;

    const moveA = clampCollisionCorrectionVector(
        (resolved.moveAX || 0) * correctionScale,
        (resolved.moveAY || 0) * correctionScale,
        bodyA,
        resolveBoost
    );
    const moveB = clampCollisionCorrectionVector(
        (resolved.moveBX || 0) * correctionScale,
        (resolved.moveBY || 0) * correctionScale,
        bodyB,
        resolveBoost
    );

    return {
        moveAX: moveA.x,
        moveAY: moveA.y,
        moveBX: moveB.x,
        moveBY: moveB.y
    };
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
    const clamped = Math.max(PRESSURE_WEIGHT_MIN, Math.min(maxWeight, rawWeight));
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
 * @returns {{x:number, y:number}} 제한된 보정 벡터입니다.
 */
function clampCollisionCorrectionVector(dx, dy, body, resolveBoost = 1) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
    const mag = Math.hypot(dx, dy);
    if (mag <= EPSILON) return { x: 0, y: 0 };

    const radius = Number.isFinite(body?.resolveRadius)
        ? body.resolveRadius
        : (Number.isFinite(body?.boundRadius) ? body.boundRadius : COLLISION_RESOLVE_TUNING.DEFAULT_BODY_RADIUS);
    const baseMaxCorrection = Math.max(COLLISION_RESOLVE_MIN_MAX, radius * COLLISION_RESOLVE_MAX_RATIO);
    const maxCorrection = baseMaxCorrection * getCollisionDenseCorrectionScale(body) * resolveBoost;
    if (mag <= maxCorrection) {
        return { x: dx, y: dy };
    }

    const scale = maxCorrection / mag;
    return {
        x: dx * scale,
        y: dy * scale
    };
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
