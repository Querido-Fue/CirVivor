import { clampNumber } from 'util/number_util.js';
import { incrementEnemyAIDebugCounter } from '../_enemy_ai_debug_stats.js';
import { buildEnemyAIFlowField } from '../wasm/_enemy_ai_flow_field_backend.js';
import {
    expandRect,
    getRectBounds
} from './_enemy_ai_navigation_geometry.js';

/** @typedef {import('../wasm/_enemy_ai_flow_field_backend.js').EnemyAIFlowFieldGrid} EnemyAIFlowFieldGrid */
/** @typedef {import('../wasm/_enemy_ai_flow_field_backend.js').EnemyAIFlowFieldGoalCell} EnemyAIFlowFieldGoalCell */
/** @typedef {import('../wasm/_enemy_ai_flow_field_backend.js').EnemyAIFlowFieldResult} EnemyAIFlowFieldResult */

const EPSILON = 1e-6;
const INF = 1e20;
const DIAGONAL_COST = 1.41421356237;
const CLEARANCE_BUCKET_STEP = 4;
const NAV_GRID_CACHE_LIMIT = 12;
const FLOW_CACHE_LIMIT = 18;

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
