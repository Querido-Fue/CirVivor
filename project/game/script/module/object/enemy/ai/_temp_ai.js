import { getObjectWH, getWW } from 'display/display_system.js';

const EPSILON = 1e-6;
const TURN_RESPONSE = 8;
const NAV_CELL_SIZE = 16;
const NAV_NEAREST_FREE_RADIUS = 8;
const NAV_DIRECT_CHECK_PAD_RATIO = 0.5;
const CLEARANCE_BUCKET_STEP = 4;
const FLOW_CACHE_LIMIT = 18;
const INF = 1e20;
const DIAGONAL_COST = 1.41421356237;

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

const length = (x, y) => Math.hypot(x, y);

const normalize = (x, y) => {
    const len = length(x, y);
    if (len <= EPSILON) return { x: 1, y: 0 };
    return { x: x / len, y: y / len };
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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

const expandRect = (rect, pad) => {
    const p = Math.max(0, pad);
    return {
        minX: rect.minX - p,
        maxX: rect.maxX + p,
        minY: rect.minY - p,
        maxY: rect.maxY + p
    };
};

const segmentIntersectsRect = (a, b, rect) => {
    let tMin = 0;
    let tMax = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;

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

    if (!axisTest(-dx, a.x - rect.minX)) return false;
    if (!axisTest(dx, rect.maxX - a.x)) return false;
    if (!axisTest(-dy, a.y - rect.minY)) return false;
    if (!axisTest(dy, rect.maxY - a.y)) return false;
    return tMax >= tMin;
};

const isSegmentBlocked = (start, end, walls, pad = 0) => {
    if (!Array.isArray(walls) || walls.length === 0) return false;
    for (let i = 0; i < walls.length; i++) {
        const bounds = getRectBounds(walls[i]);
        if (!bounds) continue;
        const testRect = pad > 0 ? expandRect(bounds, pad) : bounds;
        if (segmentIntersectsRect(start, end, testRect)) return true;
    }
    return false;
};

const toIndex = (cx, cy, cols) => (cy * cols) + cx;

const fromIndex = (index, cols) => ({
    cx: index % cols,
    cy: Math.floor(index / cols)
});

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

const getNavGrid = (walls, width, height, clearanceRaw) => {
    const clearance = Math.max(
        CLEARANCE_BUCKET_STEP,
        Math.round(clearanceRaw / CLEARANCE_BUCKET_STEP) * CLEARANCE_BUCKET_STEP
    );
    const key = buildGridCacheKey(walls, width, height, NAV_CELL_SIZE, clearance);

    if (navGridCache && navGridCacheKey === key) {
        return { grid: navGridCache, gridKey: key, clearance };
    }

    navGridCacheKey = key;
    navGridCache = buildNavGrid(walls, width, height, NAV_CELL_SIZE, clearance);
    return { grid: navGridCache, gridKey: key, clearance };
};

const worldToCell = (x, y, grid) => ({
    cx: clamp(Math.floor(x / grid.cellSize), 0, grid.cols - 1),
    cy: clamp(Math.floor(y / grid.cellSize), 0, grid.rows - 1)
});

const isBlockedCell = (grid, cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return true;
    return grid.blocked[toIndex(cx, cy, grid.cols)] !== 0;
};

const findNearestWalkableCell = (grid, cx, cy) => {
    if (!isBlockedCell(grid, cx, cy)) return { cx, cy };

    let best = null;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (let r = 1; r <= NAV_NEAREST_FREE_RADIUS; r++) {
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
                        best = { cx: x, cy: y };
                    }
                }
            }
        }
        if (best) return best;
    }

    return null;
};

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
        const cell = fromIndex(bestIndex, grid.cols);

        for (let i = 0; i < DIRS.length; i++) {
            const dir = DIRS[i];
            const nx = cell.cx + dir.dx;
            const ny = cell.cy + dir.dy;
            if (isBlockedCell(grid, nx, ny)) continue;

            if (dir.dx !== 0 && dir.dy !== 0) {
                if (isBlockedCell(grid, cell.cx + dir.dx, cell.cy)) continue;
                if (isBlockedCell(grid, cell.cx, cell.cy + dir.dy)) continue;
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
                const bestCell = fromIndex(bestIdx, grid.cols);
                const nx = bestCell.cx - cx;
                const ny = bestCell.cy - cy;
                const n = normalize(nx, ny);
                dirX[idx] = n.x;
                dirY[idx] = n.y;
            }
        }
    }

    return { integration, dirX, dirY, goalIndex };
};

const getFlowField = (walls, width, height, clearance, target) => {
    const nav = getNavGrid(walls, width, height, clearance);
    const grid = nav.grid;
    const goalCellRaw = worldToCell(target.x, target.y, grid);
    const goalCell = findNearestWalkableCell(grid, goalCellRaw.cx, goalCellRaw.cy);
    if (!goalCell) return null;

    const key = `${nav.gridKey}|g:${goalCell.cx},${goalCell.cy}`;
    const cached = flowFieldCache.get(key);
    if (cached) {
        return {
            key,
            grid,
            field: cached
        };
    }

    const field = buildFlowField(grid, goalCell);
    flowFieldCache.set(key, field);
    if (flowFieldCache.size > FLOW_CACHE_LIMIT) {
        const firstKey = flowFieldCache.keys().next().value;
        if (firstKey !== undefined) flowFieldCache.delete(firstKey);
    }

    return {
        key,
        grid,
        field
    };
};

const ensureTempAIState = (enemy) => {
    if (!enemy._tempAI || typeof enemy._tempAI !== 'object') {
        enemy._tempAI = {
            dirX: 1,
            dirY: 0,
            desiredSpeed: 40,
            accelResponse: TURN_RESPONSE,
            flowKey: '',
            flowData: null
        };
    }

    if (!Number.isFinite(enemy._tempAI.desiredSpeed) || enemy._tempAI.desiredSpeed <= 0) {
        const currentSpeed = length(enemy.speed.x, enemy.speed.y);
        enemy._tempAI.desiredSpeed = Math.max(40, currentSpeed || 40);
    }
    if (!Number.isFinite(enemy._tempAI.accelResponse) || enemy._tempAI.accelResponse <= 0) {
        enemy._tempAI.accelResponse = TURN_RESPONSE;
    }
    if (typeof enemy._tempAI.flowKey !== 'string') {
        enemy._tempAI.flowKey = '';
    }
};

/**
 * 임시 추격 AI (Flow Field)
 * - 타겟 셀 기준 Integration/Direction Field를 공유 캐시로 생성
 * - 적은 자기 셀의 방향 벡터만 조회해 이동 (개별 A* 제거)
 * - 필드 계산은 외부 스케줄러 shouldUpdateDecision 타이밍에만 갱신
 */
export const tempAI = {
    id: 'tempAI',

    init(enemy) {
        ensureTempAIState(enemy);
    },

    reset(enemy) {
        if (!enemy) return;
        enemy._tempAI = null;
    },

    fixedUpdate(enemy, stepDelta, context = {}) {
        ensureTempAIState(enemy);
        const state = enemy._tempAI;

        const player = context.player;
        if (!player || !player.position) {
            enemy.setAcc(0, 0);
            return;
        }

        const start = { x: enemy.position.x, y: enemy.position.y };
        const target = { x: player.position.x, y: player.position.y };
        const walls = Array.isArray(context.walls) ? context.walls : [];
        const enemyRadius = Math.max(8, (enemy.getRenderHeightPx?.() || 24) * 0.45);
        const directPad = enemyRadius * NAV_DIRECT_CHECK_PAD_RATIO;

        let dir;
        if (!isSegmentBlocked(start, target, walls, directPad)) {
            dir = normalize(target.x - start.x, target.y - start.y);
            state.flowData = null;
            state.flowKey = '';
        } else {
            if (context.shouldUpdateDecision === true || !state.flowData) {
                const flow = getFlowField(walls, getWW(), getObjectWH(), enemyRadius, target);
                if (flow) {
                    state.flowData = flow;
                    state.flowKey = flow.key;
                } else {
                    state.flowData = null;
                    state.flowKey = '';
                }
            }

            if (state.flowData) {
                const grid = state.flowData.grid;
                const field = state.flowData.field;
                const cellRaw = worldToCell(start.x, start.y, grid);
                const cell = isBlockedCell(grid, cellRaw.cx, cellRaw.cy)
                    ? findNearestWalkableCell(grid, cellRaw.cx, cellRaw.cy)
                    : cellRaw;

                if (cell) {
                    const idx = toIndex(cell.cx, cell.cy, grid.cols);
                    const fx = field.dirX[idx];
                    const fy = field.dirY[idx];
                    if (Math.abs(fx) > EPSILON || Math.abs(fy) > EPSILON) {
                        dir = { x: fx, y: fy };
                    }
                }
            }

            if (!dir) {
                dir = normalize(target.x - start.x, target.y - start.y);
            }
        }

        state.dirX = dir.x;
        state.dirY = dir.y;

        const desiredVx = state.dirX * state.desiredSpeed;
        const desiredVy = state.dirY * state.desiredSpeed;
        enemy.setAcc(desiredVx - enemy.speed.x, desiredVy - enemy.speed.y);
        enemy.accSpeed = state.accelResponse;
    }
};
