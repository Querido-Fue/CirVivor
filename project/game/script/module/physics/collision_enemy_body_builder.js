import { getData } from 'data/data_handler.js';
import { getSimulationObjectWH } from '../simulation/simulation_runtime.js';
import { getEnemyCircleCollisionRadius, getEnemyResolveRadius } from './_collision_enemy_geometry.js';
import {
    COLLISION_RESOLVE_MIN_MAX,
    ENEMY_PAIR_COLLISION_RADIUS_SCALE,
    ENEMY_PROJECTILE_COLLISION_RADIUS_SCALE,
    HEXA_HIVE_CELL_COLLISION_RADIUS,
    HEXA_HIVE_COLLISION_RESOLVE_RADIUS_ROOT_SCALE,
    HEXA_HIVE_COLLISION_RESOLVE_RADIUS_SCALE,
    MERGE_PENDING_RESOLVE_WEIGHT
} from './_collision_resolve_tuning.js';

const COLLISION_CONSTANTS = getData('COLLISION_CONSTANTS');
const COLLISION_BODY_BUILDER = COLLISION_CONSTANTS.BODY_BUILDER;
const DEFAULT_EPSILON = COLLISION_CONSTANTS.EPSILON;
const ENEMY_DRAW_HEIGHT_RATIO = getData('ENEMY_DRAW_HEIGHT_RATIO');
const CIRCLE_PART_STRIDE = COLLISION_BODY_BUILDER.CIRCLE_PART_STRIDE;
const BOUND_RADIUS_HALF_SCALE = COLLISION_BODY_BUILDER.BOUND_RADIUS_HALF_SCALE;
const DEGREES_TO_RADIANS = COLLISION_BODY_BUILDER.DEGREES_TO_RADIANS;
const ENEMY_RESOLVE_RADIUS_TUNING = Object.freeze({
    minRadius: COLLISION_RESOLVE_MIN_MAX,
    hexaHiveRadiusScale: HEXA_HIVE_COLLISION_RESOLVE_RADIUS_SCALE,
    hexaHiveRootScale: HEXA_HIVE_COLLISION_RESOLVE_RADIUS_ROOT_SCALE
});

/**
 * 적 body 생성 옵션에서 유한 숫자 값을 조회합니다.
 * @param {object|null|undefined} options - body 생성 옵션입니다.
 * @param {string} key - 조회할 옵션 키입니다.
 * @param {number} fallback - 값이 유효하지 않을 때 사용할 기본값입니다.
 * @returns {number} 유한 숫자로 보정한 옵션 값입니다.
 */
function getCollisionEnemyBodyOption(options, key, fallback) {
    const value = options?.[key];
    return Number.isFinite(value) ? value : fallback;
}

/**
 * 적 충돌 이전 위치 축 값을 조회합니다.
 * @param {object} enemy - 원본 적 객체입니다.
 * @param {'x'|'y'} axis - 조회할 축입니다.
 * @param {number} currentValue - 현재 위치 축 값입니다.
 * @param {boolean} sleeping - 이번 프레임 sleep 상태 여부입니다.
 * @returns {number} 이전 위치 축 값입니다.
 */
function getCollisionEnemyPreviousAxisValue(enemy, axis, currentValue, sleeping) {
    if (sleeping) {
        return currentValue;
    }

    const collisionField = axis === 'x' ? '__collisionPrevX' : '__collisionPrevY';
    if (Number.isFinite(enemy[collisionField])) {
        return enemy[collisionField];
    }

    const previousValue = enemy.prevPosition?.[axis];
    return Number.isFinite(previousValue) ? previousValue : currentValue;
}

/**
 * 적 충돌 body 필드를 현재 프레임 상태로 채웁니다.
 * @param {object} body - 값을 채울 충돌 body입니다.
 * @param {object} enemy - 원본 적 객체입니다.
 * @param {number} delta - fixed step delta입니다.
 * @param {boolean} [sleeping=false] - 이번 프레임 sleep 상태로 취급할지 여부입니다.
 * @param {{epsilon:number, frameResolveMinMax:number, frameResolveMaxRatio:number}} options - 계산 상수입니다.
 * @returns {boolean} 유효한 적 body를 구성했는지 여부입니다.
 */
export function writeCollisionEnemyBody(body, enemy, delta, sleeping = false, options = {}) {
    const epsilon = getCollisionEnemyBodyOption(options, 'epsilon', DEFAULT_EPSILON);
    const frameResolveMinMax = getCollisionEnemyBodyOption(options, 'frameResolveMinMax', 0);
    const frameResolveMaxRatio = getCollisionEnemyBodyOption(options, 'frameResolveMaxRatio', 0);
    const baseHeight = typeof enemy.getRenderHeightPx === 'function'
        ? enemy.getRenderHeightPx()
        : (getSimulationObjectWH() * ENEMY_DRAW_HEIGHT_RATIO * (enemy.size || 1));
    const width = baseHeight * (enemy.aspectRatio ?? 1);
    const height = baseHeight * (enemy.heightScale ?? 1);
    const hexaHiveCenters = Array.isArray(enemy?.hexaHiveLayout?.filledLocalCenters) && enemy.hexaHiveLayout.filledLocalCenters.length > 0
        ? enemy.hexaHiveLayout.filledLocalCenters
        : (Array.isArray(enemy?.hexaHiveLayout?.visibleLocalCenters) ? enemy.hexaHiveLayout.visibleLocalCenters : null);
    const useHiveCells = enemy?.type === 'hexa_hive' && Array.isArray(hexaHiveCenters) && hexaHiveCenters.length > 0;
    const partCount = useHiveCells ? hexaHiveCenters.length : 1;
    if (partCount <= 0) {
        return false;
    }

    let cos = 1;
    let sin = 0;
    if (useHiveCells) {
        const rotationDeg = Number.isFinite(enemy.rotation) ? enemy.rotation : 0;
        const rad = rotationDeg * DEGREES_TO_RADIANS;
        cos = Math.cos(rad);
        sin = Math.sin(rad);
    }

    const centerX = enemy.position.x;
    const centerY = enemy.position.y;
    if (!_writeCollisionEnemyShapeMetrics(
        body,
        enemy,
        hexaHiveCenters,
        useHiveCells,
        partCount,
        width,
        height,
        centerX,
        centerY,
        cos,
        sin
    )) {
        return false;
    }

    const prevX = getCollisionEnemyPreviousAxisValue(enemy, 'x', centerX, sleeping);
    const prevY = getCollisionEnemyPreviousAxisValue(enemy, 'y', centerY, sleeping);
    const invDelta = 1 / Math.max(epsilon, delta);
    const velX = (centerX - prevX) * invDelta;
    const velY = (centerY - prevY) * invDelta;
    const resolveRadius = getEnemyResolveRadius(
        enemy,
        body.boundRadius,
        baseHeight,
        ENEMY_RESOLVE_RADIUS_TUNING
    );
    const frameResolvePad = Math.max(frameResolveMinMax, resolveRadius * frameResolveMaxRatio);
    const velocitySweepPadX = sleeping ? 0 : (Math.abs(velX) * delta);
    const velocitySweepPadY = sleeping ? 0 : (Math.abs(velY) * delta);
    const sweepPadX = velocitySweepPadX + frameResolvePad;
    const sweepPadY = velocitySweepPadY + frameResolvePad;

    body.id = Number.isInteger(enemy.id) ? enemy.id : -1;
    body.kind = 'enemy';
    body.shape = useHiveCells ? 'circleParts' : 'circle';
    body.circleParts = useHiveCells ? enemy.__collisionWorldCircles : null;
    body.circlePartCount = useHiveCells ? partCount : 0;
    body.ref = enemy;
    syncCollisionEnemyBodyResolveState(body, enemy, epsilon);
    body.movable = true;
    body.centerX = centerX;
    body.centerY = centerY;
    body.x = centerX;
    body.y = centerY;
    body.sweepMinX = body.minX - sweepPadX;
    body.sweepMaxX = body.maxX + sweepPadX;
    body.sweepMinY = body.minY - sweepPadY;
    body.sweepMaxY = body.maxY + sweepPadY;
    body.resolveRadius = resolveRadius;
    body.velocityX = velX;
    body.velocityY = velY;
    body._candidatePairCount = 0;
    body._resolvedPairCount = 0;
    body._passPairProcessCount = 0;
    body._frameResolveMoved = 0;
    body._frameResolveMax = frameResolvePad;
    body._sleeping = sleeping === true;
    return true;
}

/**
 * prepare 이후 바뀔 수 있는 합체 pending/weight 상태를 body에 동기화합니다.
 * @param {object} body - 갱신할 충돌 body입니다.
 * @param {object} enemy - 원본 적 객체입니다.
 * @param {number} [epsilon=DEFAULT_EPSILON] - 최소 weight입니다.
 */
export function syncCollisionEnemyBodyResolveState(body, enemy, epsilon = DEFAULT_EPSILON) {
    const safeEpsilon = Number.isFinite(epsilon) ? epsilon : DEFAULT_EPSILON;
    body.mergeLock = enemy?.hexaHiveMergePending === true;
    body.weight = body.mergeLock
        ? Math.max(
            MERGE_PENDING_RESOLVE_WEIGHT,
            Number.isFinite(enemy.hexaHiveMergePendingWeight)
                ? enemy.hexaHiveMergePendingWeight
                : MERGE_PENDING_RESOLVE_WEIGHT
        )
        : Math.max(safeEpsilon, Number.isFinite(enemy.weight) ? enemy.weight : 1);
}

/**
 * 적 충돌 body의 원형/복합 원형 경계 정보를 계산합니다.
 * @param {object} body - 경계 정보를 기록할 body입니다.
 * @param {object} enemy - 원본 적 객체입니다.
 * @param {Array<object>|null} hexaHiveCenters - hexa hive 로컬 셀 중심 목록입니다.
 * @param {boolean} useHiveCells - hexa hive 셀 충돌 사용 여부입니다.
 * @param {number} partCount - 충돌 part 개수입니다.
 * @param {number} width - 렌더 기준 너비입니다.
 * @param {number} height - 렌더 기준 높이입니다.
 * @param {number} centerX - 적 중심 X 좌표입니다.
 * @param {number} centerY - 적 중심 Y 좌표입니다.
 * @param {number} cos - 회전 cos 값입니다.
 * @param {number} sin - 회전 sin 값입니다.
 * @returns {boolean} 경계 정보를 기록했으면 true입니다.
 */
function _writeCollisionEnemyShapeMetrics(
    body,
    enemy,
    hexaHiveCenters,
    useHiveCells,
    partCount,
    width,
    height,
    centerX,
    centerY,
    cos,
    sin
) {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let enemyPairMinX = Number.POSITIVE_INFINITY;
    let enemyPairMaxX = Number.NEGATIVE_INFINITY;
    let enemyPairMinY = Number.POSITIVE_INFINITY;
    let enemyPairMaxY = Number.NEGATIVE_INFINITY;
    let projectileMinX = Number.POSITIVE_INFINITY;
    let projectileMaxX = Number.NEGATIVE_INFINITY;
    let projectileMinY = Number.POSITIVE_INFINITY;
    let projectileMaxY = Number.NEGATIVE_INFINITY;
    let broadRadius = 0;
    let enemyPairBroadRadius = 0;
    let projectileBroadRadius = 0;
    let singleCircleRadius;
    if (useHiveCells) {
        singleCircleRadius = HEXA_HIVE_CELL_COLLISION_RADIUS * Math.max(width, height);
    } else if (
        enemy.__collisionRadiusCacheType === enemy.type
        && enemy.__collisionRadiusCacheWidth === width
        && enemy.__collisionRadiusCacheHeight === height
        && Number.isFinite(enemy.__collisionRadiusCacheValue)
    ) {
        singleCircleRadius = enemy.__collisionRadiusCacheValue;
    } else {
        singleCircleRadius = getEnemyCircleCollisionRadius(enemy.type, width, height);
        enemy.__collisionRadiusCacheType = enemy.type;
        enemy.__collisionRadiusCacheWidth = width;
        enemy.__collisionRadiusCacheHeight = height;
        enemy.__collisionRadiusCacheValue = singleCircleRadius;
    }

    if (useHiveCells) {
        const circleBufferLength = partCount * CIRCLE_PART_STRIDE;
        if (!(enemy.__collisionWorldCircles instanceof Float32Array) || enemy.__collisionWorldCircles.length !== circleBufferLength) {
            enemy.__collisionWorldCircles = new Float32Array(circleBufferLength);
        }
        const radius = singleCircleRadius;
        const enemyPairRadius = radius * ENEMY_PAIR_COLLISION_RADIUS_SCALE;
        const projectileRadius = radius * ENEMY_PROJECTILE_COLLISION_RADIUS_SCALE;
        let maxCenterDistance = 0;

        for (let p = 0; p < partCount; p++) {
            const localCenter = hexaHiveCenters[p];
            const lx = (Number.isFinite(localCenter?.x) ? localCenter.x : 0) * width;
            const ly = (Number.isFinite(localCenter?.y) ? localCenter.y : 0) * height;
            const wx = centerX + (lx * cos) - (ly * sin);
            const wy = centerY + (lx * sin) + (ly * cos);
            const offset = p * CIRCLE_PART_STRIDE;
            enemy.__collisionWorldCircles[offset] = wx;
            enemy.__collisionWorldCircles[offset + 1] = wy;
            enemy.__collisionWorldCircles[offset + 2] = radius;

            minX = Math.min(minX, wx - radius);
            maxX = Math.max(maxX, wx + radius);
            minY = Math.min(minY, wy - radius);
            maxY = Math.max(maxY, wy + radius);
            enemyPairMinX = Math.min(enemyPairMinX, wx - enemyPairRadius);
            enemyPairMaxX = Math.max(enemyPairMaxX, wx + enemyPairRadius);
            enemyPairMinY = Math.min(enemyPairMinY, wy - enemyPairRadius);
            enemyPairMaxY = Math.max(enemyPairMaxY, wy + enemyPairRadius);
            projectileMinX = Math.min(projectileMinX, wx - projectileRadius);
            projectileMaxX = Math.max(projectileMaxX, wx + projectileRadius);
            projectileMinY = Math.min(projectileMinY, wy - projectileRadius);
            projectileMaxY = Math.max(projectileMaxY, wy + projectileRadius);

            const centerDistance = Math.hypot(wx - centerX, wy - centerY);
            maxCenterDistance = Math.max(maxCenterDistance, centerDistance);
        }
        broadRadius = Math.max(0, maxCenterDistance + radius);
        enemyPairBroadRadius = Math.max(0, maxCenterDistance + enemyPairRadius);
        projectileBroadRadius = Math.max(0, maxCenterDistance + projectileRadius);
    } else {
        const radius = singleCircleRadius;
        const enemyPairRadius = radius * ENEMY_PAIR_COLLISION_RADIUS_SCALE;
        const projectileRadius = radius * ENEMY_PROJECTILE_COLLISION_RADIUS_SCALE;
        minX = centerX - radius;
        maxX = centerX + radius;
        minY = centerY - radius;
        maxY = centerY + radius;
        enemyPairMinX = centerX - enemyPairRadius;
        enemyPairMaxX = centerX + enemyPairRadius;
        enemyPairMinY = centerY - enemyPairRadius;
        enemyPairMaxY = centerY + enemyPairRadius;
        projectileMinX = centerX - projectileRadius;
        projectileMaxX = centerX + projectileRadius;
        projectileMinY = centerY - projectileRadius;
        projectileMaxY = centerY + projectileRadius;
        broadRadius = radius;
        enemyPairBroadRadius = enemyPairRadius;
        projectileBroadRadius = projectileRadius;
    }

    body.radius = singleCircleRadius;
    body.minX = minX;
    body.maxX = maxX;
    body.minY = minY;
    body.maxY = maxY;
    body.enemyPairMinX = enemyPairMinX;
    body.enemyPairMaxX = enemyPairMaxX;
    body.enemyPairMinY = enemyPairMinY;
    body.enemyPairMaxY = enemyPairMaxY;
    body.projectileMinX = projectileMinX;
    body.projectileMaxX = projectileMaxX;
    body.projectileMinY = projectileMinY;
    body.projectileMaxY = projectileMaxY;
    body.broadRadius = broadRadius;
    body.enemyPairBroadRadius = enemyPairBroadRadius;
    body.projectileBroadRadius = projectileBroadRadius;
    body.boundRadius = Math.max(
        (maxX - minX) * BOUND_RADIUS_HALF_SCALE,
        (maxY - minY) * BOUND_RADIUS_HALF_SCALE
    );
    return Number.isFinite(body.boundRadius) && body.boundRadius > 0;
}
