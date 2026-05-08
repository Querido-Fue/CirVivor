import { ENEMY_AI_CONSTANTS } from '../../../../data/object/enemy/enemy_ai_constants.js';
import { incrementEnemyAIDebugCounter } from './_enemy_ai_debug_stats.js';

const EPSILON = ENEMY_AI_CONSTANTS.EPSILON;
const INF = ENEMY_AI_CONSTANTS.INF;
const DIAGONAL_COST = ENEMY_AI_CONSTANTS.DIAGONAL_COST;
const HEXA_HIVE_TYPE = 'hexa_hive';

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

let navGridCache = null;
let navGridCacheKey = '';
const flowFieldCache = new Map();
const flowFieldScratchGoalCellRaw = { cx: 0, cy: 0 };
const flowFieldScratchGoalCell = { cx: 0, cy: 0 };

/**
 * 값을 지정 범위로 제한합니다.
 * @param {number} value - 원본 값입니다.
 * @param {number} min - 최솟값입니다.
 * @param {number} max - 최댓값입니다.
 * @returns {number} 제한된 값입니다.
 */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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
    const rect = typeof wall.getCollisionRect === 'function' ? wall.getCollisionRect() : wall;
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
 * @param {{minX: number, maxX: number, minY: number, maxY: number}} rect - 검사할 사각형입니다.
 * @returns {boolean} 교차 여부입니다.
 */
const segmentIntersectsRectByCoords = (startX, startY, endX, endY, rect) => {
    let tMin = 0;
    let tMax = 1;
    const dx = endX - startX;
    const dy = endY - startY;

    const axisTest = (p, q) => {
        if (Math.abs(p) <= EPSILON) return q >= 0;
        const t = q / p;
        if (p < 0) {
            if (t > tMax) return false;
            if (t > tMin) tMin = t;
        } else {
            if (t < tMin) return false;
            if (t < tMax) tMax = t;
        }
        return true;
    };

    if (!axisTest(-dx, startX - rect.minX)) return false;
    if (!axisTest(dx, rect.maxX - startX)) return false;
    if (!axisTest(-dy, startY - rect.minY)) return false;
    if (!axisTest(dy, rect.maxY - startY)) return false;
    return tMax >= tMin;
};

/**
 * 좌표 기반 선분이 벽에 막히는지 판정합니다.
 * @param {number} startX - 시작 X 좌표입니다.
 * @param {number} startY - 시작 Y 좌표입니다.
 * @param {number} endX - 끝 X 좌표입니다.
 * @param {number} endY - 끝 Y 좌표입니다.
 * @param {object[]|null|undefined} walls - 벽 목록입니다.
 * @param {number} [pad=0] - 벽 확장 패딩입니다.
 * @returns {boolean} 벽에 막혔는지 여부입니다.
 */
export const isSegmentBlockedByCoords = (startX, startY, endX, endY, walls, pad = 0) => {
    if (!Array.isArray(walls) || walls.length === 0) return false;
    for (let i = 0; i < walls.length; i++) {
        const bounds = getRectBounds(walls[i]);
        if (!bounds) continue;
        const testRect = pad > 0 ? expandRect(bounds, pad) : bounds;
        if (segmentIntersectsRectByCoords(startX, startY, endX, endY, testRect)) return true;
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
 * @returns {string} 캐시 키입니다.
 */
const buildGridCacheKey = (walls, width, height, cellSize, clearance) => {
    const parts = [
        Math.round(width),
        Math.round(height),
        cellSize,
        clearance
    ];

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
 * @param {object} profile - AI 품질 프로필입니다.
 * @returns {number} 정규화한 clearance 값입니다.
 */
const getClearanceBucket = (clearanceRaw, profile) => Math.max(
    profile.CLEARANCE_BUCKET_STEP,
    Math.round(clearanceRaw / profile.CLEARANCE_BUCKET_STEP) * profile.CLEARANCE_BUCKET_STEP
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
            const minCx = clamp(Math.floor(expanded.minX / cellSize), 0, cols - 1);
            const maxCx = clamp(Math.floor(expanded.maxX / cellSize), 0, cols - 1);
            const minCy = clamp(Math.floor(expanded.minY / cellSize), 0, rows - 1);
            const maxCy = clamp(Math.floor(expanded.maxY / cellSize), 0, rows - 1);

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
 * @returns {{grid: object, gridKey: string, clearance: number}} 그리드 조회 결과입니다.
 */
export const getNavGrid = (walls, width, height, profile, clearanceRaw) => {
    const clearance = getClearanceBucket(clearanceRaw, profile);
    const key = buildGridCacheKey(walls, width, height, profile.NAV_CELL_SIZE, clearance);

    if (navGridCache && navGridCacheKey === key) {
        return { grid: navGridCache, gridKey: key, clearance };
    }

    navGridCacheKey = key;
    navGridCache = buildNavGrid(walls, width, height, profile.NAV_CELL_SIZE, clearance);
    return { grid: navGridCache, gridKey: key, clearance };
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
    out.cx = clamp(Math.floor(x / grid.cellSize), 0, grid.cols - 1);
    out.cy = clamp(Math.floor(y / grid.cellSize), 0, grid.rows - 1);
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
 * 목표 셀에서 모든 셀까지의 flow field를 생성합니다.
 * @param {{cols: number, rows: number, size: number, blocked: Uint8Array}} grid - 네비게이션 그리드입니다.
 * @param {{cx: number, cy: number}} goalCell - 목표 셀입니다.
 * @returns {{integration: Float32Array, dirX: Float32Array, dirY: Float32Array, goalIndex: number}} flow field입니다.
 */
const buildFlowField = (grid, goalCell) => {
    const size = grid.size;
    const integration = new Float32Array(size);
    const dirX = new Float32Array(size);
    const dirY = new Float32Array(size);
    integration.fill(INF);

    const openList = [];
    const openFlags = new Uint8Array(size);
    const goalIndex = toIndex(goalCell.cx, goalCell.cy, grid.cols);
    integration[goalIndex] = 0;
    openFlags[goalIndex] = 1;
    openList.push(goalIndex);

    while (openList.length > 0) {
        let bestPos = 0;
        let bestIndex = openList[0];
        let bestCost = integration[bestIndex];
        for (let i = 1; i < openList.length; i++) {
            const idx = openList[i];
            const c = integration[idx];
            if (c < bestCost) {
                bestCost = c;
                bestPos = i;
                bestIndex = idx;
            }
        }

        const last = openList.length - 1;
        openList[bestPos] = openList[last];
        openList.pop();
        openFlags[bestIndex] = 0;
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

            if (!openFlags[nIndex]) {
                openFlags[nIndex] = 1;
                openList.push(nIndex);
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
 * @returns {{key: string, grid: object, clearance: number, field: object}|null} flow field 조회 결과입니다.
 */
const getFlowFieldForTargetCoords = (walls, width, height, profile, clearance, targetX, targetY) => {
    const nav = getNavGrid(walls, width, height, profile, clearance);
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
        return {
            key,
            grid,
            clearance: nav.clearance,
            field: cached
        };
    }

    const field = buildFlowField(grid, goalCell);
    flowFieldCache.set(key, field);
    if (flowFieldCache.size > profile.FLOW_CACHE_LIMIT) {
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
    `${profile.KEY}|${policyKey}|${getClearanceBucket(clearance, profile)}|${Math.floor(targetX / profile.NAV_CELL_SIZE)}|${Math.floor(targetY / profile.NAV_CELL_SIZE)}`
);

/**
 * 월드 좌표를 LOS 캐시용 셀 버킷 좌표로 변환합니다.
 * @param {number} value - 월드 좌표입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @returns {number} 셀 버킷 좌표입니다.
 */
const getLineOfSightBucketCoord = (value, profile) => Math.floor(value / profile.NAV_CELL_SIZE);

/**
 * 현재 decision tick 안에서 공용 direct path 조회 키를 구성합니다.
 * @param {number} startX - 시작 X 좌표입니다.
 * @param {number} startY - 시작 Y 좌표입니다.
 * @param {number} targetX - 목표 X 좌표입니다.
 * @param {number} targetY - 목표 Y 좌표입니다.
 * @param {number} directPad - 직선 경로 검사 패딩입니다.
 * @param {object} profile - AI 품질 프로필입니다.
 * @param {number} wallsVersion - 벽 버전입니다.
 * @returns {string} 공유 direct path 캐시 키입니다.
 */
const buildSharedDirectPathDecisionKey = (startX, startY, targetX, targetY, directPad, profile, wallsVersion) => (
    `${profile.KEY}|${wallsVersion}|${getClearanceBucket(directPad, profile)}|${getLineOfSightBucketCoord(startX, profile)}|${getLineOfSightBucketCoord(startY, profile)}|${getLineOfSightBucketCoord(targetX, profile)}|${getLineOfSightBucketCoord(targetY, profile)}`
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
    && state.lastDirectPathPadBucket === getClearanceBucket(directPad, profile)
    && state.lastDirectPathStartCx === getLineOfSightBucketCoord(startX, profile)
    && state.lastDirectPathStartCy === getLineOfSightBucketCoord(startY, profile)
    && state.lastDirectPathTargetCx === getLineOfSightBucketCoord(targetX, profile)
    && state.lastDirectPathTargetCy === getLineOfSightBucketCoord(targetY, profile)
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
    state.lastDirectPathPadBucket = getClearanceBucket(directPad, profile);
    state.lastDirectPathStartCx = getLineOfSightBucketCoord(startX, profile);
    state.lastDirectPathStartCy = getLineOfSightBucketCoord(startY, profile);
    state.lastDirectPathTargetCx = getLineOfSightBucketCoord(targetX, profile);
    state.lastDirectPathTargetCy = getLineOfSightBucketCoord(targetY, profile);
};

/**
 * 현재 decision tick 안에서 direct path 판정 결과를 재사용합니다.
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
    const aiDebugStats = context?.aiDebugStats ?? null;
    const sharedDirectPathByKey = context?.sharedDirectPathByKey instanceof Map
        ? context.sharedDirectPathByKey
        : null;
    const decisionKey = buildSharedDirectPathDecisionKey(
        startX,
        startY,
        targetX,
        targetY,
        directPad,
        profile,
        wallsVersion
    );

    if (sharedDirectPathByKey?.has(decisionKey)) {
        incrementEnemyAIDebugCounter(aiDebugStats, 'sharedDirectPathCacheHitCount');
        return sharedDirectPathByKey.get(decisionKey) === true;
    }

    const hasDirectPath = !isSegmentBlockedByCoords(startX, startY, targetX, targetY, walls, directPad);
    if (sharedDirectPathByKey) {
        sharedDirectPathByKey.set(decisionKey, hasDirectPath);
    }
    return hasDirectPath;
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
 * @returns {{key: string, grid: object, clearance: number, field: object}|null} flow field 조회 결과입니다.
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
    if (!sharedFlowFieldByKey) {
        return getFlowFieldForTargetCoords(walls, width, height, profile, clearance, targetX, targetY);
    }

    const decisionKey = buildSharedFlowDecisionKey(clearance, targetX, targetY, profile, policyKey);
    if (sharedFlowFieldByKey.has(decisionKey)) {
        incrementEnemyAIDebugCounter(aiDebugStats, 'sharedFlowFieldCacheHitCount');
        return sharedFlowFieldByKey.get(decisionKey);
    }

    const flow = getFlowFieldForTargetCoords(walls, width, height, profile, clearance, targetX, targetY);
    sharedFlowFieldByKey.set(decisionKey, flow ?? null);
    return flow;
};
