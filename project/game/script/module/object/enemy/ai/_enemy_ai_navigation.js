import { clampNumber } from 'util/number_util.js';
import { getHexaHiveType } from '../_hexa_hive_layout.js';
import { incrementEnemyAIDebugCounter } from './_enemy_ai_debug_stats.js';
import { buildEnemyAIFlowField } from './wasm/_enemy_ai_flow_field_backend.js';

/** @typedef {import('./wasm/_enemy_ai_flow_field_backend.js').EnemyAIFlowFieldGrid} EnemyAIFlowFieldGrid */
/** @typedef {import('./wasm/_enemy_ai_flow_field_backend.js').EnemyAIFlowFieldGoalCell} EnemyAIFlowFieldGoalCell */
/** @typedef {import('./wasm/_enemy_ai_flow_field_backend.js').EnemyAIFlowFieldResult} EnemyAIFlowFieldResult */

const EPSILON = 1e-6;
const INF = 1e20;
const DIAGONAL_COST = 1.41421356237;
const CLEARANCE_BUCKET_STEP = 4;
const NAV_GRID_CACHE_LIMIT = 12;
const FLOW_CACHE_LIMIT = 18;
const HEXA_HIVE_TYPE = getHexaHiveType();

const DIRS = Object.freeze([
    Object.freeze({ dx: 1, dy: 0, cost: 1 }),
    Object.freeze({ dx: -1, dy: 0, cost: 1 }),
    Object.freeze({ dx: 0, dy: 1, cost: 1 }),
    Object.freeze({ dx: 0, dy: -1, cost: 1 }),
    Object.freeze({ dx: 1, dy: 1, cost: DIAGONAL_COST }),
    Object.freeze({ dx: 1, dy: -1, cost: DIAGONAL_COST }),
    Object.freeze({ dx: -1, dy: 1, cost: DIAGONAL_COST }),
    Object.freeze({ dx: -1, dy: -1, cost: DIAGONAL_COST })
]);

const navGridCache = new Map();
const flowFieldCache = new Map();
const flowFieldScratchGoalCellRaw = { cx: 0, cy: 0 };
const flowFieldScratchGoalCell = { cx: 0, cy: 0 };
const flowOpenHeap = [];
let flowOpenPositions = new Int32Array(0);
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
 * clearance가 큰 적도 막힌 셀 밖의 후보를 찾을 수 있도록 탐색 반경을 계산합니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {number} clearance - 셀 clearance 값입니다.
 * @returns {number} 탐색 반경 셀 수입니다.
 */
const getNearestWalkableSearchRadius = (profile, clearance) => {
    const baseRadius = Number.isInteger(profile.NAV_NEAREST_FREE_RADIUS)
        ? profile.NAV_NEAREST_FREE_RADIUS
        : 1;
    const extraCells = Number.isInteger(profile.NAV_NEAREST_FREE_CLEARANCE_EXTRA_CELLS)
        ? Math.max(0, profile.NAV_NEAREST_FREE_CLEARANCE_EXTRA_CELLS)
        : 0;
    const clearanceCells = Number.isFinite(clearance) && clearance > 0
        ? Math.ceil(clearance / Math.max(1, profile.NAV_CELL_SIZE))
        : 0;
    return Math.max(baseRadius, clearanceCells + extraCells);
};

/**
 * 벽 객체를 축 정렬 사각형 경계로 변환합니다.
 * @param {object|null|undefined} wall - 벽 객체입니다.
 * @returns {{minX: number, maxX: number, minY: number, maxY: number}|null} 사각형 경계입니다.
 */
const getRectBounds = (wall) => {
    if (!wall) return null;
    const hasDirectRect = Number.isFinite(wall.x)
        && Number.isFinite(wall.y)
        && Number.isFinite(wall.w)
        && Number.isFinite(wall.h);
    const rect = hasDirectRect && (wall.kind === 'wall' || typeof wall.getCollisionRect !== 'function')
        ? wall
        : (typeof wall.getCollisionRect === 'function' ? wall.getCollisionRect() : wall);
    if (!rect) return null;
    const w = Number.isFinite(rect.w) ? rect.w : 0;
    const h = Number.isFinite(rect.h) ? rect.h : 0;
    if (w <= 0 || h <= 0) return null;
    const centered = rect.origin === 'center' || rect.isCenter === true;
    const cx = centered ? rect.x : (rect.x + (w * 0.5));
    const cy = centered ? rect.y : (rect.y + (h * 0.5));
    const hw = w * 0.5;
    const hh = h * 0.5;
    return {
        minX: cx - hw,
        maxX: cx + hw,
        minY: cy - hh,
        maxY: cy + hh
    };
};

/**
 * 벽 경계를 SoA 버퍼의 지정 위치에 기록합니다.
 * @param {object|null|undefined} wall - 벽 객체입니다.
 * @param {Float64Array} target - 경계 출력 버퍼입니다.
 * @param {number} offset - 기록 시작 위치입니다.
 * @returns {boolean} 유효한 경계를 기록했는지 여부입니다.
 */
function writeWallBounds(wall, target, offset) {
    const bounds = getRectBounds(wall);
    if (!bounds) return false;
    target[offset] = bounds.minX;
    target[offset + 1] = bounds.maxX;
    target[offset + 2] = bounds.minY;
    target[offset + 3] = bounds.maxY;
    return true;
}

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
 * 사각형 경계를 지정 패딩만큼 확장합니다.
 * @param {{minX: number, maxX: number, minY: number, maxY: number}} rect - 원본 경계입니다.
 * @param {number} pad - 확장 패딩입니다.
 * @returns {{minX: number, maxX: number, minY: number, maxY: number}} 확장된 경계입니다.
 */
const expandRect = (rect, pad) => {
    const p = Math.max(0, pad);
    return {
        minX: rect.minX - p,
        maxX: rect.maxX + p,
        minY: rect.minY - p,
        maxY: rect.maxY + p
    };
};

/**
 * 선분과 사각형의 교차 여부를 좌표 기반으로 판정합니다.
 * @param {number} startX - 시작 X 좌표입니다.
 * @param {number} startY - 시작 Y 좌표입니다.
 * @param {number} endX - 끝 X 좌표입니다.
 * @param {number} endY - 끝 Y 좌표입니다.
 * @param {number} minX - 사각형 최소 X입니다.
 * @param {number} maxX - 사각형 최대 X입니다.
 * @param {number} minY - 사각형 최소 Y입니다.
 * @param {number} maxY - 사각형 최대 Y입니다.
 * @returns {boolean} 교차 여부입니다.
 */
const segmentIntersectsRectByCoords = (startX, startY, endX, endY, minX, maxX, minY, maxY) => {
    let tMin = 0;
    let tMax = 1;
    const dx = endX - startX;
    const dy = endY - startY;

    if (Math.abs(dx) <= EPSILON) {
        if (startX < minX || startX > maxX) return false;
    } else {
        let txMin = (minX - startX) / dx;
        let txMax = (maxX - startX) / dx;
        if (txMin > txMax) {
            const swap = txMin;
            txMin = txMax;
            txMax = swap;
        }
        tMin = Math.max(tMin, txMin);
        tMax = Math.min(tMax, txMax);
        if (tMax < tMin) return false;
    }

    if (Math.abs(dy) <= EPSILON) {
        if (startY < minY || startY > maxY) return false;
    } else {
        let tyMin = (minY - startY) / dy;
        let tyMax = (maxY - startY) / dy;
        if (tyMin > tyMax) {
            const swap = tyMin;
            tyMin = tyMax;
            tyMax = swap;
        }
        tMin = Math.max(tMin, tyMin);
        tMax = Math.min(tMax, tyMax);
        if (tMax < tMin) return false;
    }
    return tMax >= tMin;
};

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
 * 셀 좌표를 grid 배열 인덱스로 변환합니다.
 * @param {number} cx - 셀 X 좌표입니다.
 * @param {number} cy - 셀 Y 좌표입니다.
 * @param {number} cols - 그리드 열 수입니다.
 * @returns {number} 배열 인덱스입니다.
 */
export const toIndex = (cx, cy, cols) => (cy * cols) + cx;

/**
 * 벽/그리드 설정 기반 캐시 키를 생성합니다.
 * @param {object[]|null|undefined} walls - 벽 목록입니다.
 * @param {number} width - 월드 너비입니다.
 * @param {number} height - 월드 높이입니다.
 * @param {number} cellSize - 셀 크기입니다.
 * @param {number} clearance - clearance 값입니다.
 * @param {number|null} [wallsVersion=null] - ObjectSystem 벽 버전입니다.
 * @returns {string} 캐시 키입니다.
 */
const buildGridCacheKey = (walls, width, height, cellSize, clearance, wallsVersion = null) => {
    const parts = [
        Math.round(width),
        Math.round(height),
        cellSize,
        clearance
    ];

    if (Number.isInteger(wallsVersion)) {
        parts.push(`v${wallsVersion}`);
        return parts.join('|');
    }

    if (!Array.isArray(walls)) return parts.join('|');
    for (let i = 0; i < walls.length; i++) {
        const rect = getRectBounds(walls[i]);
        if (!rect) continue;
        parts.push(
            Math.round(rect.minX),
            Math.round(rect.maxX),
            Math.round(rect.minY),
            Math.round(rect.maxY)
        );
    }
    return parts.join('|');
};

/**
 * clearance 값을 캐시 버킷 단위로 정규화합니다.
 * @param {number} clearanceRaw - 원본 clearance 값입니다.
 * @returns {number} 정규화한 clearance 값입니다.
 */
const getClearanceBucket = (clearanceRaw) => Math.max(
    CLEARANCE_BUCKET_STEP,
    Math.round(clearanceRaw / CLEARANCE_BUCKET_STEP) * CLEARANCE_BUCKET_STEP
);

/**
 * 벽 목록으로 네비게이션 그리드를 생성합니다.
 * @param {object[]|null|undefined} walls - 벽 목록입니다.
 * @param {number} width - 월드 너비입니다.
 * @param {number} height - 월드 높이입니다.
 * @param {number} cellSize - 셀 크기입니다.
 * @param {number} clearance - clearance 값입니다.
 * @returns {{cols: number, rows: number, size: number, cellSize: number, blocked: Uint8Array}} 네비게이션 그리드입니다.
 */
const buildNavGrid = (walls, width, height, cellSize, clearance) => {
    const cols = Math.max(4, Math.ceil(width / cellSize));
    const rows = Math.max(4, Math.ceil(height / cellSize));
    const size = cols * rows;
    const blocked = new Uint8Array(size);

    if (Array.isArray(walls)) {
        for (let i = 0; i < walls.length; i++) {
            const rect = getRectBounds(walls[i]);
            if (!rect) continue;
            const expanded = expandRect(rect, clearance);
            const minCx = clampNumber(Math.floor(expanded.minX / cellSize), 0, cols - 1);
            const maxCx = clampNumber(Math.floor(expanded.maxX / cellSize), 0, cols - 1);
            const minCy = clampNumber(Math.floor(expanded.minY / cellSize), 0, rows - 1);
            const maxCy = clampNumber(Math.floor(expanded.maxY / cellSize), 0, rows - 1);

            for (let cy = minCy; cy <= maxCy; cy++) {
                const rowOffset = cy * cols;
                for (let cx = minCx; cx <= maxCx; cx++) {
                    blocked[rowOffset + cx] = 1;
                }
            }
        }
    }

    return { cols, rows, size, cellSize, blocked };
};

/**
 * 네비게이션 그리드를 조회하거나 생성합니다.
 * @param {object[]|null|undefined} walls - 벽 목록입니다.
 * @param {number} width - 월드 너비입니다.
 * @param {number} height - 월드 높이입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {number} clearanceRaw - 원본 clearance 값입니다.
 * @param {number|null} [wallsVersion=null] - ObjectSystem 벽 버전입니다.
 * @returns {{grid: object, gridKey: string, clearance: number}} 그리드 조회 결과입니다.
 */
export const getNavGrid = (walls, width, height, profile, clearanceRaw, wallsVersion = null) => {
    const clearance = getClearanceBucket(clearanceRaw);
    const key = buildGridCacheKey(
        walls,
        width,
        height,
        profile.NAV_CELL_SIZE,
        clearance,
        wallsVersion
    );
    const cachedGrid = navGridCache.get(key);

    if (cachedGrid) {
        navGridCache.delete(key);
        navGridCache.set(key, cachedGrid);
        return { grid: cachedGrid, gridKey: key, clearance };
    }

    const grid = buildNavGrid(walls, width, height, profile.NAV_CELL_SIZE, clearance);
    navGridCache.set(key, grid);
    if (navGridCache.size > NAV_GRID_CACHE_LIMIT) {
        const oldestKey = navGridCache.keys().next().value;
        if (oldestKey !== undefined) {
            navGridCache.delete(oldestKey);
        }
    }
    return { grid, gridKey: key, clearance };
};

/**
 * 월드 좌표를 네비게이션 셀 좌표로 변환해 출력 객체에 기록합니다.
 * @param {number} x - 월드 X 좌표입니다.
 * @param {number} y - 월드 Y 좌표입니다.
 * @param {{cellSize: number, cols: number, rows: number}} grid - 네비게이션 그리드입니다.
 * @param {{cx: number, cy: number}} out - 출력 버퍼입니다.
 * @returns {{cx: number, cy: number}} 출력 버퍼입니다.
 */
export const worldToCellInto = (x, y, grid, out) => {
    out.cx = clampNumber(Math.floor(x / grid.cellSize), 0, grid.cols - 1);
    out.cy = clampNumber(Math.floor(y / grid.cellSize), 0, grid.rows - 1);
    return out;
};

/**
 * 셀이 막혔는지 반환합니다.
 * @param {{cols: number, rows: number, blocked: Uint8Array}} grid - 네비게이션 그리드입니다.
 * @param {number} cx - 셀 X 좌표입니다.
 * @param {number} cy - 셀 Y 좌표입니다.
 * @returns {boolean} 막힌 셀 여부입니다.
 */
export const isBlockedCell = (grid, cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return true;
    return grid.blocked[toIndex(cx, cy, grid.cols)] !== 0;
};

/**
 * 가장 가까운 보행 가능 셀을 찾아 출력 객체에 기록합니다.
 * @param {{cols: number, rows: number, blocked: Uint8Array}} grid - 네비게이션 그리드입니다.
 * @param {number} cx - 기준 셀 X 좌표입니다.
 * @param {number} cy - 기준 셀 Y 좌표입니다.
 * @param {{cx: number, cy: number}} out - 출력 버퍼입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {number} [clearance=0] - clearance 값입니다.
 * @returns {{cx: number, cy: number}|null} 보행 가능 셀입니다.
 */
export const findNearestWalkableCellInto = (grid, cx, cy, out, profile, clearance = 0) => {
    if (!isBlockedCell(grid, cx, cy)) {
        out.cx = cx;
        out.cy = cy;
        return out;
    }

    let best = null;
    let bestDistSq = Number.POSITIVE_INFINITY;
    const searchRadius = getNearestWalkableSearchRadius(profile, clearance);
    for (let r = 1; r <= searchRadius; r++) {
        const minX = cx - r;
        const maxX = cx + r;
        const minY = cy - r;
        const maxY = cy + r;

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                if (x <= minX || x >= maxX || y <= minY || y >= maxY) {
                    if (isBlockedCell(grid, x, y)) continue;
                    const dx = x - cx;
                    const dy = y - cy;
                    const d2 = (dx * dx) + (dy * dy);
                    if (d2 < bestDistSq) {
                        bestDistSq = d2;
                        if (!best) {
                            best = out;
                        }
                        best.cx = x;
                        best.cy = y;
                    }
                }
            }
        }
        if (best) return best;
    }

    return null;
};

/**
 * flow field용 indexed min-heap scratch 용량을 보장합니다.
 * @param {number} size - 필요한 셀 수입니다.
 * @returns {Int32Array} heap 위치 배열입니다.
 */
function prepareFlowOpenHeap(size) {
    if (flowOpenPositions.length < size) {
        flowOpenPositions = new Int32Array(size);
    }
    flowOpenPositions.fill(-1, 0, size);
    flowOpenHeap.length = 0;
    return flowOpenPositions;
}

/**
 * integration cost와 셀 인덱스로 heap 우선순위를 결정합니다.
 * @param {number} leftIndex - 왼쪽 셀 인덱스입니다.
 * @param {number} rightIndex - 오른쪽 셀 인덱스입니다.
 * @param {Float32Array} integration - 누적 비용입니다.
 * @returns {boolean} 왼쪽이 먼저 나와야 하는지 여부입니다.
 */
function isFlowHeapNodeBefore(leftIndex, rightIndex, integration) {
    const leftCost = integration[leftIndex];
    const rightCost = integration[rightIndex];
    return leftCost < rightCost || (leftCost === rightCost && leftIndex < rightIndex);
}

/**
 * 새 셀을 indexed min-heap에 삽입합니다.
 * @param {number[]} heap - heap 배열입니다.
 * @param {Int32Array} positions - 셀별 heap 위치입니다.
 * @param {Float32Array} integration - 누적 비용입니다.
 * @param {number} cellIndex - 삽입할 셀 인덱스입니다.
 * @returns {void}
 */
function pushFlowHeapNode(heap, positions, integration, cellIndex) {
    let position = heap.length;
    heap.push(cellIndex);
    positions[cellIndex] = position;

    while (position > 0) {
        const parentPosition = (position - 1) >> 1;
        const parentIndex = heap[parentPosition];
        if (!isFlowHeapNodeBefore(cellIndex, parentIndex, integration)) {
            break;
        }
        heap[position] = parentIndex;
        positions[parentIndex] = position;
        position = parentPosition;
    }
    heap[position] = cellIndex;
    positions[cellIndex] = position;
}

/**
 * 비용이 낮아진 기존 heap 셀을 위로 이동합니다.
 * @param {number[]} heap - heap 배열입니다.
 * @param {Int32Array} positions - 셀별 heap 위치입니다.
 * @param {Float32Array} integration - 누적 비용입니다.
 * @param {number} cellIndex - 갱신된 셀 인덱스입니다.
 * @returns {void}
 */
function decreaseFlowHeapNode(heap, positions, integration, cellIndex) {
    let position = positions[cellIndex];
    if (position < 0) return;

    while (position > 0) {
        const parentPosition = (position - 1) >> 1;
        const parentIndex = heap[parentPosition];
        if (!isFlowHeapNodeBefore(cellIndex, parentIndex, integration)) {
            break;
        }
        heap[position] = parentIndex;
        positions[parentIndex] = position;
        position = parentPosition;
    }
    heap[position] = cellIndex;
    positions[cellIndex] = position;
}

/**
 * indexed min-heap에서 최소 비용 셀을 제거합니다.
 * @param {number[]} heap - heap 배열입니다.
 * @param {Int32Array} positions - 셀별 heap 위치입니다.
 * @param {Float32Array} integration - 누적 비용입니다.
 * @returns {number} 최소 비용 셀 인덱스입니다.
 */
function popFlowHeapNode(heap, positions, integration) {
    const rootIndex = heap[0];
    const lastIndex = heap.pop();
    positions[rootIndex] = -1;
    if (heap.length === 0) {
        return rootIndex;
    }

    let position = 0;
    heap[0] = lastIndex;
    positions[lastIndex] = 0;
    while (true) {
        const leftPosition = (position * 2) + 1;
        if (leftPosition >= heap.length) break;
        const rightPosition = leftPosition + 1;
        let nextPosition = leftPosition;
        if (
            rightPosition < heap.length
            && isFlowHeapNodeBefore(heap[rightPosition], heap[leftPosition], integration)
        ) {
            nextPosition = rightPosition;
        }
        if (!isFlowHeapNodeBefore(heap[nextPosition], lastIndex, integration)) {
            break;
        }

        const nextIndex = heap[nextPosition];
        heap[position] = nextIndex;
        positions[nextIndex] = position;
        position = nextPosition;
    }
    heap[position] = lastIndex;
    positions[lastIndex] = position;
    return rootIndex;
}

/**
 * 목표 셀에서 모든 셀까지의 flow field를 생성합니다.
 * @param {EnemyAIFlowFieldGrid} grid - 네비게이션 그리드입니다.
 * @param {EnemyAIFlowFieldGoalCell} goalCell - 목표 셀입니다.
 * @returns {EnemyAIFlowFieldResult} flow field입니다.
 */
const buildFlowField = (grid, goalCell) => {
    const size = grid.size;
    const integration = new Float32Array(size);
    const dirX = new Float32Array(size);
    const dirY = new Float32Array(size);
    integration.fill(INF);

    const openList = flowOpenHeap;
    const openPositions = prepareFlowOpenHeap(size);
    const goalIndex = toIndex(goalCell.cx, goalCell.cy, grid.cols);
    integration[goalIndex] = 0;
    pushFlowHeapNode(openList, openPositions, integration, goalIndex);

    while (openList.length > 0) {
        const bestIndex = popFlowHeapNode(openList, openPositions, integration);
        const cellCx = bestIndex % grid.cols;
        const cellCy = Math.floor(bestIndex / grid.cols);

        for (let i = 0; i < DIRS.length; i++) {
            const dir = DIRS[i];
            const nx = cellCx + dir.dx;
            const ny = cellCy + dir.dy;
            if (isBlockedCell(grid, nx, ny)) continue;

            if (dir.dx !== 0 && dir.dy !== 0) {
                if (isBlockedCell(grid, cellCx + dir.dx, cellCy)) continue;
                if (isBlockedCell(grid, cellCx, cellCy + dir.dy)) continue;
            }

            const nIndex = toIndex(nx, ny, grid.cols);
            const candidate = integration[bestIndex] + dir.cost;
            if (candidate + EPSILON >= integration[nIndex]) continue;
            integration[nIndex] = candidate;

            if (openPositions[nIndex] < 0) {
                pushFlowHeapNode(openList, openPositions, integration, nIndex);
            } else {
                decreaseFlowHeapNode(openList, openPositions, integration, nIndex);
            }
        }
    }

    for (let cy = 0; cy < grid.rows; cy++) {
        for (let cx = 0; cx < grid.cols; cx++) {
            const idx = toIndex(cx, cy, grid.cols);
            if (grid.blocked[idx] || integration[idx] >= INF * 0.5) {
                dirX[idx] = 0;
                dirY[idx] = 0;
                continue;
            }

            let bestIdx = idx;
            let bestCost = integration[idx];
            for (let i = 0; i < DIRS.length; i++) {
                const dir = DIRS[i];
                const nx = cx + dir.dx;
                const ny = cy + dir.dy;
                if (isBlockedCell(grid, nx, ny)) continue;
                if (dir.dx !== 0 && dir.dy !== 0) {
                    if (isBlockedCell(grid, cx + dir.dx, cy)) continue;
                    if (isBlockedCell(grid, cx, cy + dir.dy)) continue;
                }
                const nIdx = toIndex(nx, ny, grid.cols);
                const c = integration[nIdx];
                if (c + EPSILON < bestCost) {
                    bestCost = c;
                    bestIdx = nIdx;
                }
            }

            if (bestIdx === idx) {
                dirX[idx] = 0;
                dirY[idx] = 0;
            } else {
                const nx = (bestIdx % grid.cols) - cx;
                const ny = Math.floor(bestIdx / grid.cols) - cy;
                const len = Math.hypot(nx, ny);
                if (len <= EPSILON) {
                    dirX[idx] = 0;
                    dirY[idx] = 0;
                } else {
                    dirX[idx] = nx / len;
                    dirY[idx] = ny / len;
                }
            }
        }
    }

    return { integration, dirX, dirY, goalIndex };
};

/**
 * 목표 좌표 기준 flow field를 조회하거나 생성합니다.
 * @param {object[]|null|undefined} walls - 벽 목록입니다.
 * @param {number} width - 월드 너비입니다.
 * @param {number} height - 월드 높이입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {number} clearance - clearance 값입니다.
 * @param {number} targetX - 목표 X 좌표입니다.
 * @param {number} targetY - 목표 Y 좌표입니다.
 * @param {number|null} [wallsVersion=null] - ObjectSystem 벽 버전입니다.
 * @returns {{key: string, grid: object, clearance: number, field: EnemyAIFlowFieldResult}|null} flow field 조회 결과입니다.
 */
const getFlowFieldForTargetCoords = (
    walls,
    width,
    height,
    profile,
    clearance,
    targetX,
    targetY,
    wallsVersion = null
) => {
    const nav = getNavGrid(walls, width, height, profile, clearance, wallsVersion);
    const grid = nav.grid;
    const goalCellRaw = worldToCellInto(targetX, targetY, grid, flowFieldScratchGoalCellRaw);
    const goalCell = findNearestWalkableCellInto(
        grid,
        goalCellRaw.cx,
        goalCellRaw.cy,
        flowFieldScratchGoalCell,
        profile,
        nav.clearance
    );
    if (!goalCell) return null;

    const key = `${nav.gridKey}|g:${goalCell.cx},${goalCell.cy}`;
    const cached = flowFieldCache.get(key);
    if (cached) {
        flowFieldCache.delete(key);
        flowFieldCache.set(key, cached);
        return {
            key,
            grid,
            clearance: nav.clearance,
            field: cached
        };
    }

    const field = buildEnemyAIFlowField(grid, goalCell, buildFlowField);
    flowFieldCache.set(key, field);
    if (flowFieldCache.size > FLOW_CACHE_LIMIT) {
        const firstKey = flowFieldCache.keys().next().value;
        if (firstKey !== undefined) flowFieldCache.delete(firstKey);
    }

    return {
        key,
        grid,
        clearance: nav.clearance,
        field
    };
};

/**
 * 현재 decision tick 안에서 공용 flow field 조회 키를 구성합니다.
 * @param {number} clearance - clearance 값입니다.
 * @param {number} targetX - 목표 X 좌표입니다.
 * @param {number} targetY - 목표 Y 좌표입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {string} [policyKey='chase'] - 정책 캐시 키입니다.
 * @returns {string} 공유 flow 캐시 키입니다.
 */
const buildSharedFlowDecisionKey = (clearance, targetX, targetY, profile, policyKey = 'chase') => (
    `${profile.KEY}|${policyKey}|${getClearanceBucket(clearance)}|${Math.floor(targetX / profile.NAV_CELL_SIZE)}|${Math.floor(targetY / profile.NAV_CELL_SIZE)}`
);

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
export const hasReusableDirectPathResult = (state, startX, startY, targetX, targetY, directPad, profile, wallsVersion) => (
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
export const updateDirectPathCache = (state, startX, startY, targetX, targetY, directPad, profile, wallsVersion, hasDirectPath) => {
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

/**
 * 현재 decision tick 안에서 flow field 결과를 재사용합니다.
 * @param {object} context - AI 업데이트 문맥입니다.
 * @param {object[]|null|undefined} walls - 벽 목록입니다.
 * @param {number} width - 월드 너비입니다.
 * @param {number} height - 월드 높이입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {number} clearance - clearance 값입니다.
 * @param {number} targetX - 목표 X 좌표입니다.
 * @param {number} targetY - 목표 Y 좌표입니다.
 * @param {string} [policyKey='chase'] - 정책 캐시 키입니다.
 * @returns {{key: string, grid: object, clearance: number, field: EnemyAIFlowFieldResult}|null} flow field 조회 결과입니다.
 */
export const getSharedFlowFieldForTargetCoords = (
    context,
    walls,
    width,
    height,
    profile,
    clearance,
    targetX,
    targetY,
    policyKey = 'chase'
) => {
    const aiDebugStats = context?.aiDebugStats ?? null;
    const sharedFlowFieldByKey = context?.sharedFlowFieldByKey instanceof Map
        ? context.sharedFlowFieldByKey
        : null;
    const wallsVersion = Number.isInteger(context?.wallsVersion) ? context.wallsVersion : null;
    if (!sharedFlowFieldByKey) {
        return getFlowFieldForTargetCoords(
            walls,
            width,
            height,
            profile,
            clearance,
            targetX,
            targetY,
            wallsVersion
        );
    }

    const decisionKey = buildSharedFlowDecisionKey(clearance, targetX, targetY, profile, policyKey);
    if (sharedFlowFieldByKey.has(decisionKey)) {
        incrementEnemyAIDebugCounter(aiDebugStats, 'sharedFlowFieldCacheHitCount');
        return sharedFlowFieldByKey.get(decisionKey);
    }

    const flow = getFlowFieldForTargetCoords(
        walls,
        width,
        height,
        profile,
        clearance,
        targetX,
        targetY,
        wallsVersion
    );
    sharedFlowFieldByKey.set(decisionKey, flow ?? null);
    return flow;
};
