import { getHexaHiveType } from '../../_hexa_hive_layout.js';
import { incrementEnemyAIDebugCounter } from '../_enemy_ai_debug_stats.js';
import {
    segmentIntersectsRectByCoords,
    writeWallBounds
} from './_enemy_ai_navigation_geometry.js';

const HEXA_HIVE_TYPE = getHexaHiveType();
const wallBoundsCacheByWalls = new WeakMap();
const wallBoundsScratch = new Float64Array(4);
const WALL_BOUNDS_STRIDE = 4;
const LOS_SPATIAL_CELL_SIZE = 256;
const LOS_SPATIAL_MAX_RECT_CELL_COUNT = 64;
const LOS_SPATIAL_MAX_QUERY_CELL_COUNT = 256;
const LOS_SPATIAL_MIN_BOUND_COUNT = 8;
const LOS_SPATIAL_DENSE_CANDIDATE_RATIO = 0.75;

/**
 * 캐시된 벽 인덱스를 오름차순으로 비교합니다.
 * @param {number} left - 왼쪽 벽 인덱스입니다.
 * @param {number} right - 오른쪽 벽 인덱스입니다.
 * @returns {number} 정렬 비교 결과입니다.
 */
const compareCachedWallIndex = (left, right) => left - right;

/**
 * 직선 추적 판정에 사용할 벽 확장 반경을 반환합니다.
 * @param {object|null|undefined} enemy - 검사 대상 적입니다.
 * @param {number} navigationRadius - 네비게이션 반경입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @returns {number} 직선 경로 검사 패딩입니다.
 */
export const resolveDirectPathPad = (enemy, navigationRadius, profile) => {
    const ratio = enemy?.type === HEXA_HIVE_TYPE
        ? profile.HEXA_HIVE_NAV_DIRECT_CHECK_PAD_RATIO
        : profile.NAV_DIRECT_CHECK_PAD_RATIO;
    const safeRatio = Number.isFinite(ratio) && ratio >= 0
        ? ratio
        : profile.NAV_DIRECT_CHECK_PAD_RATIO;
    return Math.max(0, navigationRadius * safeRatio);
};

/**
 * 정적 walls 배열과 버전별로 LOS용 경계를 한 번만 구성합니다.
 * @param {object[]} walls - 벽 목록입니다.
 * @param {number|null} wallsVersion - ObjectSystem 벽 버전입니다.
 * @returns {{version:number, sourceLength:number, count:number, values:Float64Array}|null} 경계 캐시입니다.
 */
function getCachedWallBounds(walls, wallsVersion) {
    if (!Array.isArray(walls) || !Number.isInteger(wallsVersion)) return null;
    const cached = wallBoundsCacheByWalls.get(walls);
    if (cached?.version === wallsVersion && cached.sourceLength === walls.length) {
        return cached;
    }

    const values = new Float64Array(walls.length * WALL_BOUNDS_STRIDE);
    let count = 0;
    for (let i = 0; i < walls.length; i++) {
        if (writeWallBounds(walls[i], values, count * WALL_BOUNDS_STRIDE)) {
            count++;
        }
    }
    const next = { version: wallsVersion, sourceLength: walls.length, count, values };
    wallBoundsCacheByWalls.set(walls, next);
    return next;
}

/**
 * 내부 LOS fast path가 처음 필요할 때만 versioned bounds에 spatial index scratch를 붙입니다.
 * wall getter 평가는 getCachedWallBounds()의 기존 단일 배열 순회에서 이미 끝난 뒤에 수행됩니다.
 * @param {{count:number, values:Float64Array, spatialRows?:Map<number, Map<number, number[]>>, oversizedIndices?:number[], queryStamps?:Uint32Array, queryGeneration?:number, candidateIndices?:number[], spatialQueryDepth?:number}} cachedBounds - versioned wall bounds cache입니다.
 * @returns {{count:number, values:Float64Array, spatialRows:Map<number, Map<number, number[]>>, oversizedIndices:number[], queryStamps:Uint32Array, queryGeneration:number, candidateIndices:number[], spatialQueryDepth:number}} spatial scratch가 보장된 cache입니다.
 */
function ensureCachedWallSpatialIndex(cachedBounds) {
    if (cachedBounds.spatialRows instanceof Map) {
        return cachedBounds;
    }
    const spatialRows = new Map();
    const oversizedIndices = [];
    for (let i = 0; i < cachedBounds.count; i++) {
        const offset = i * WALL_BOUNDS_STRIDE;
        const minCx = Math.floor(cachedBounds.values[offset] / LOS_SPATIAL_CELL_SIZE);
        const maxCx = Math.floor(cachedBounds.values[offset + 1] / LOS_SPATIAL_CELL_SIZE);
        const minCy = Math.floor(cachedBounds.values[offset + 2] / LOS_SPATIAL_CELL_SIZE);
        const maxCy = Math.floor(cachedBounds.values[offset + 3] / LOS_SPATIAL_CELL_SIZE);
        if (
            !Number.isSafeInteger(minCx)
            || !Number.isSafeInteger(maxCx)
            || !Number.isSafeInteger(minCy)
            || !Number.isSafeInteger(maxCy)
        ) {
            oversizedIndices.push(i);
            continue;
        }
        const cellCount = (maxCx - minCx + 1) * (maxCy - minCy + 1);
        if (cellCount > LOS_SPATIAL_MAX_RECT_CELL_COUNT) {
            oversizedIndices.push(i);
            continue;
        }
        for (let cy = minCy; cy <= maxCy; cy++) {
            let row = spatialRows.get(cy);
            if (!row) {
                row = new Map();
                spatialRows.set(cy, row);
            }
            for (let cx = minCx; cx <= maxCx; cx++) {
                let bucket = row.get(cx);
                if (!bucket) {
                    bucket = [];
                    row.set(cx, bucket);
                }
                bucket.push(i);
            }
        }
    }
    cachedBounds.spatialRows = spatialRows;
    cachedBounds.oversizedIndices = oversizedIndices;
    cachedBounds.queryStamps = new Uint32Array(cachedBounds.count);
    cachedBounds.queryGeneration = 0;
    cachedBounds.candidateIndices = [];
    cachedBounds.spatialQueryDepth = 0;
    return cachedBounds;
}

/**
 * cached wall bounds의 모든 항목을 기존 exact LOS 판정으로 검사합니다.
 * @param {{count:number, values:Float64Array}} cachedBounds - 버전별 wall bounds cache입니다.
 * @param {number} startX - 선분 시작 X입니다.
 * @param {number} startY - 선분 시작 Y입니다.
 * @param {number} endX - 선분 끝 X입니다.
 * @param {number} endY - 선분 끝 Y입니다.
 * @param {number} safePad - 0 이상 확장 패딩입니다.
 * @param {object|null|undefined} aiDebugStats - 선택적인 AI debug 통계입니다.
 * @returns {boolean} 막힌 여부입니다.
 */
function isSegmentBlockedByCachedWallBoundsLinear(
    cachedBounds,
    startX,
    startY,
    endX,
    endY,
    safePad,
    aiDebugStats = null
) {
    const recordsDebugStats = aiDebugStats?.enabled === true;
    for (let i = 0; i < cachedBounds.count; i++) {
        const offset = i * WALL_BOUNDS_STRIDE;
        if (recordsDebugStats) {
            incrementEnemyAIDebugCounter(aiDebugStats, 'directPathRectTestCount');
        }
        if (segmentIntersectsRectByCoords(
            startX,
            startY,
            endX,
            endY,
            cachedBounds.values[offset] - safePad,
            cachedBounds.values[offset + 1] + safePad,
            cachedBounds.values[offset + 2] - safePad,
            cachedBounds.values[offset + 3] + safePad
        )) return true;
    }
    return false;
}

/**
 * spatial query의 중복 후보를 stamp로 제거하고 재사용 목록에 추가합니다.
 * @param {{queryStamps:Uint32Array}} cachedBounds - versioned wall bounds cache입니다.
 * @param {number} index - cached bounds 인덱스입니다.
 * @param {number} queryStamp - 현재 query 세대입니다.
 * @param {number[]} candidates - 재사용 후보 목록입니다.
 * @returns {boolean} 이번 query에 처음 추가했는지 여부입니다.
 */
function appendCachedWallSpatialCandidate(cachedBounds, index, queryStamp, candidates) {
    if (cachedBounds.queryStamps[index] === queryStamp) return false;
    cachedBounds.queryStamps[index] = queryStamp;
    candidates.push(index);
    return true;
}

/**
 * 정적 wall bounds의 보수적 spatial 후보만 기존 exact LOS 판정으로 검사합니다.
 * 후보가 조밀하거나 조회 AABB가 너무 크면 null을 반환해 linear 경로가 처리합니다.
 * @param {{count:number, values:Float64Array, spatialRows:Map<number, Map<number, number[]>>, oversizedIndices:number[], queryStamps:Uint32Array, queryGeneration:number, candidateIndices:number[], spatialQueryDepth:number}} cachedBounds - 버전별 wall bounds cache입니다.
 * @param {number} startX - 선분 시작 X입니다.
 * @param {number} startY - 선분 시작 Y입니다.
 * @param {number} endX - 선분 끝 X입니다.
 * @param {number} endY - 선분 끝 Y입니다.
 * @param {number} safePad - 0 이상 확장 패딩입니다.
 * @param {object|null|undefined} aiDebugStats - 선택적인 AI debug 통계입니다.
 * @returns {boolean|null} 막힌 여부 또는 dense/large query fallback 신호입니다.
 */
function tryIsSegmentBlockedByCachedWallBoundsSpatial(
    cachedBounds,
    startX,
    startY,
    endX,
    endY,
    safePad,
    aiDebugStats = null
) {
    if (cachedBounds.count < LOS_SPATIAL_MIN_BOUND_COUNT) {
        return null;
    }
    const minCx = Math.floor((Math.min(startX, endX) - safePad) / LOS_SPATIAL_CELL_SIZE);
    const maxCx = Math.floor((Math.max(startX, endX) + safePad) / LOS_SPATIAL_CELL_SIZE);
    const minCy = Math.floor((Math.min(startY, endY) - safePad) / LOS_SPATIAL_CELL_SIZE);
    const maxCy = Math.floor((Math.max(startY, endY) + safePad) / LOS_SPATIAL_CELL_SIZE);
    if (
        !Number.isSafeInteger(minCx)
        || !Number.isSafeInteger(maxCx)
        || !Number.isSafeInteger(minCy)
        || !Number.isSafeInteger(maxCy)
    ) {
        return null;
    }
    const queryCellCount = (maxCx - minCx + 1) * (maxCy - minCy + 1);
    if (!Number.isFinite(queryCellCount) || queryCellCount > LOS_SPATIAL_MAX_QUERY_CELL_COUNT) {
        return null;
    }
    cachedBounds = ensureCachedWallSpatialIndex(cachedBounds);
    if (cachedBounds.spatialQueryDepth > 0) {
        return null;
    }
    cachedBounds.spatialQueryDepth++;
    try {
        cachedBounds.queryGeneration = (cachedBounds.queryGeneration + 1) >>> 0;
        if (cachedBounds.queryGeneration === 0) {
            cachedBounds.queryStamps.fill(0);
            cachedBounds.queryGeneration = 1;
        }
        const queryStamp = cachedBounds.queryGeneration;
        const candidates = cachedBounds.candidateIndices;
        candidates.length = 0;
        const denseCandidateLimit = Math.ceil(cachedBounds.count * LOS_SPATIAL_DENSE_CANDIDATE_RATIO);

        for (let cy = minCy; cy <= maxCy; cy++) {
            const row = cachedBounds.spatialRows.get(cy);
            if (!row) continue;
            for (let cx = minCx; cx <= maxCx; cx++) {
                const bucket = row.get(cx);
                if (!bucket) continue;
                for (let i = 0; i < bucket.length; i++) {
                    if (
                        appendCachedWallSpatialCandidate(cachedBounds, bucket[i], queryStamp, candidates)
                        && candidates.length >= denseCandidateLimit
                    ) return null;
                }
            }
        }
        for (let i = 0; i < cachedBounds.oversizedIndices.length; i++) {
            if (
                appendCachedWallSpatialCandidate(
                    cachedBounds,
                    cachedBounds.oversizedIndices[i],
                    queryStamp,
                    candidates
                )
                && candidates.length >= denseCandidateLimit
            ) return null;
        }

        candidates.sort(compareCachedWallIndex);
        const recordsDebugStats = aiDebugStats?.enabled === true;
        if (recordsDebugStats) {
            incrementEnemyAIDebugCounter(aiDebugStats, 'directPathSpatialCandidateCount', candidates.length);
        }
        for (let i = 0; i < candidates.length; i++) {
            const offset = candidates[i] * WALL_BOUNDS_STRIDE;
            if (recordsDebugStats) {
                incrementEnemyAIDebugCounter(aiDebugStats, 'directPathRectTestCount');
            }
            if (segmentIntersectsRectByCoords(
                startX,
                startY,
                endX,
                endY,
                cachedBounds.values[offset] - safePad,
                cachedBounds.values[offset + 1] + safePad,
                cachedBounds.values[offset + 2] - safePad,
                cachedBounds.values[offset + 3] + safePad
            )) return true;
        }
        return false;
    } finally {
        cachedBounds.spatialQueryDepth--;
    }
}

/**
 * ObjectSystem의 versioned cached wall bounds에 한정한 LOS fast path입니다.
 * 공개 API의 linear semantics와 무버전 fallback은 이 helper를 통과하지 않습니다.
 * @param {number} startX - 선분 시작 X입니다.
 * @param {number} startY - 선분 시작 Y입니다.
 * @param {number} endX - 선분 끝 X입니다.
 * @param {number} endY - 선분 끝 Y입니다.
 * @param {object[]|null|undefined} walls - 벽 목록입니다.
 * @param {number} safePad - 0 이상 확장 패딩입니다.
 * @param {number|null} wallsVersion - ObjectSystem 벽 버전입니다.
 * @param {object|null|undefined} aiDebugStats - 선택적인 AI debug 통계입니다.
 * @returns {boolean} 막힌 여부입니다.
 */
function isSegmentBlockedByVersionedCachedWallBounds(
    startX,
    startY,
    endX,
    endY,
    walls,
    safePad,
    wallsVersion,
    aiDebugStats = null
) {
    const recordsDebugStats = aiDebugStats?.enabled === true;
    const cachedBounds = getCachedWallBounds(walls, wallsVersion);
    if (!cachedBounds) {
        return isSegmentBlockedByCoords(startX, startY, endX, endY, walls, safePad, null);
    }
    const isReentrantSpatialQuery = cachedBounds.spatialQueryDepth > 0;
    const spatialResult = tryIsSegmentBlockedByCachedWallBoundsSpatial(
        cachedBounds,
        startX,
        startY,
        endX,
        endY,
        safePad,
        aiDebugStats
    );
    if (spatialResult !== null) {
        return spatialResult;
    }
    if (recordsDebugStats && !isReentrantSpatialQuery) {
        incrementEnemyAIDebugCounter(aiDebugStats, 'directPathSpatialFallbackCount');
    }
    return isSegmentBlockedByCachedWallBoundsLinear(
        cachedBounds,
        startX,
        startY,
        endX,
        endY,
        safePad,
        isReentrantSpatialQuery ? null : aiDebugStats
    );
}

/**
 * 좌표 기반 선분이 벽에 막히는지 판정합니다.
 * @param {number} startX - 시작 X 좌표입니다.
 * @param {number} startY - 시작 Y 좌표입니다.
 * @param {number} endX - 끝 X 좌표입니다.
 * @param {number} endY - 끝 Y 좌표입니다.
 * @param {object[]|null|undefined} walls - 벽 목록입니다.
 * @param {number} [pad=0] - 벽 확장 패딩입니다.
 * @param {number|null} [wallsVersion=null] - 정적 벽 경계 캐시에 사용할 버전입니다.
 * @returns {boolean} 벽에 막혔는지 여부입니다.
 */
export const isSegmentBlockedByCoords = (
    startX,
    startY,
    endX,
    endY,
    walls,
    pad = 0,
    wallsVersion = null
) => {
    if (!Array.isArray(walls) || walls.length === 0) return false;
    const safePad = pad > 0 ? pad : 0;
    const cachedBounds = getCachedWallBounds(walls, wallsVersion);
    if (cachedBounds) {
        for (let i = 0; i < cachedBounds.count; i++) {
            const offset = i * WALL_BOUNDS_STRIDE;
            if (segmentIntersectsRectByCoords(
                startX,
                startY,
                endX,
                endY,
                cachedBounds.values[offset] - safePad,
                cachedBounds.values[offset + 1] + safePad,
                cachedBounds.values[offset + 2] - safePad,
                cachedBounds.values[offset + 3] + safePad
            )) return true;
        }
        return false;
    }

    for (let i = 0; i < walls.length; i++) {
        if (!writeWallBounds(walls[i], wallBoundsScratch, 0)) continue;
        if (segmentIntersectsRectByCoords(
            startX,
            startY,
            endX,
            endY,
            wallBoundsScratch[0] - safePad,
            wallBoundsScratch[1] + safePad,
            wallBoundsScratch[2] - safePad,
            wallBoundsScratch[3] + safePad
        )) return true;
    }
    return false;
};

/**
 * 현재 direct path 캐시가 같은 조건에 대해 유효한지 반환합니다.
 * @param {object} state - 적 AI 상태입니다.
 * @param {number} startX - 시작 X 좌표입니다.
 * @param {number} startY - 시작 Y 좌표입니다.
 * @param {number} targetX - 목표 X 좌표입니다.
 * @param {number} targetY - 목표 Y 좌표입니다.
 * @param {number} directPad - 직선 경로 검사 패딩입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {number} wallsVersion - 벽 버전입니다.
 * @returns {boolean} 캐시 재사용 가능 여부입니다.
 */
export const hasReusableDirectPathResult = (
    state,
    startX,
    startY,
    targetX,
    targetY,
    directPad,
    profile,
    wallsVersion
) => (
    state.hasDirectPathResult === true
    && state.lastDirectPathWallsVersion === wallsVersion
    && state.lastDirectPathPad === directPad
    && state.lastDirectPathStartX === startX
    && state.lastDirectPathStartY === startY
    && state.lastDirectPathTargetX === targetX
    && state.lastDirectPathTargetY === targetY
);

/**
 * direct path 캐시 메타데이터를 현재 조건으로 갱신합니다.
 * @param {object} state - 적 AI 상태입니다.
 * @param {number} startX - 시작 X 좌표입니다.
 * @param {number} startY - 시작 Y 좌표입니다.
 * @param {number} targetX - 목표 X 좌표입니다.
 * @param {number} targetY - 목표 Y 좌표입니다.
 * @param {number} directPad - 직선 경로 검사 패딩입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {number} wallsVersion - 벽 버전입니다.
 * @param {boolean} hasDirectPath - 직선 경로 가능 여부입니다.
 * @returns {void}
 */
export const updateDirectPathCache = (
    state,
    startX,
    startY,
    targetX,
    targetY,
    directPad,
    profile,
    wallsVersion,
    hasDirectPath
) => {
    state.hasDirectPathResult = true;
    state.lastDirectPath = hasDirectPath === true;
    state.lastDirectPathWallsVersion = wallsVersion;
    state.lastDirectPathPad = directPad;
    state.lastDirectPathStartX = startX;
    state.lastDirectPathStartY = startY;
    state.lastDirectPathTargetX = targetX;
    state.lastDirectPathTargetY = targetY;
};

/**
 * 버전별 공유 wall bounds를 사용해 현재 좌표의 direct path를 정확히 판정합니다.
 * 움직이는 적별 좌표 결과는 호출자가 숫자 필드 캐시로 관리합니다.
 * @param {object} context - AI 업데이트 문맥입니다.
 * @param {number} startX - 시작 X 좌표입니다.
 * @param {number} startY - 시작 Y 좌표입니다.
 * @param {number} targetX - 목표 X 좌표입니다.
 * @param {number} targetY - 목표 Y 좌표입니다.
 * @param {object[]|null|undefined} walls - 벽 목록입니다.
 * @param {number} directPad - 직선 경로 검사 패딩입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {number} wallsVersion - 벽 버전입니다.
 * @returns {boolean} 직선 경로 가능 여부입니다.
 */
export const getSharedDirectPathAvailability = (
    context,
    startX,
    startY,
    targetX,
    targetY,
    walls,
    directPad,
    profile,
    wallsVersion
) => {
    const cacheWallsVersion = Number.isInteger(context?.wallsVersion) ? wallsVersion : null;
    const aiDebugStats = context?.aiDebugStats ?? null;
    if (Number.isInteger(cacheWallsVersion)) {
        return !isSegmentBlockedByVersionedCachedWallBounds(
            startX,
            startY,
            targetX,
            targetY,
            walls,
            directPad > 0 ? directPad : 0,
            cacheWallsVersion,
            aiDebugStats
        );
    }
    return !isSegmentBlockedByCoords(
        startX,
        startY,
        targetX,
        targetY,
        walls,
        directPad,
        null
    );
};
