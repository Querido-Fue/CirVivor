import { ENEMY_AI_CONSTANTS } from '../../../../data/object/enemy/enemy_ai_constants.js';
import { getSimulationObjectWH, getSimulationWW } from '../../../simulation/simulation_runtime.js';

const ENEMY_AI_POLICY = ENEMY_AI_CONSTANTS.POLICY;
const ENEMY_AI_POLICY_BY_TYPE = ENEMY_AI_CONSTANTS.POLICY_BY_TYPE;
const ENEMY_AI_QUALITY_PROFILES = ENEMY_AI_CONSTANTS.QUALITY_PROFILES;
const DEFAULT_ENEMY_AI_QUALITY_PROFILE = ENEMY_AI_CONSTANTS.DEFAULT_QUALITY_PROFILE;
const EPSILON = ENEMY_AI_CONSTANTS.EPSILON;
const INF = ENEMY_AI_CONSTANTS.INF;
const DIAGONAL_COST = ENEMY_AI_CONSTANTS.DIAGONAL_COST;
const ENEMY_AI_STATE_SCHEMA_VERSION = ENEMY_AI_CONSTANTS.STATE_SCHEMA_VERSION;

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

const length = (x, y) => Math.hypot(x, y);

/**
 * 현재 업데이트 문맥에 맞는 AI 품질 프로필을 반환합니다.
 * @param {object|null|undefined} context
 * @returns {object}
 */
function getEnemyAIProfile(context) {
    const requestedProfileKey = typeof context?.enemyAIQualityProfile === 'string'
        ? context.enemyAIQualityProfile
        : DEFAULT_ENEMY_AI_QUALITY_PROFILE;
    return ENEMY_AI_QUALITY_PROFILES[requestedProfileKey]
        || ENEMY_AI_QUALITY_PROFILES[DEFAULT_ENEMY_AI_QUALITY_PROFILE];
}

/**
 * 벡터를 정규화해 재사용 가능한 출력 객체에 기록합니다.
 * @param {number} x
 * @param {number} y
 * @param {{x: number, y: number}} out
 * @returns {{x: number, y: number}}
 */
const normalizeInto = (x, y, out) => {
    const len = length(x, y);
    if (len <= EPSILON) {
        out.x = 1;
        out.y = 0;
        return out;
    }

    out.x = x / len;
    out.y = y / len;
    return out;
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

/**
 * 선분과 사각형의 교차 여부를 좌표 기반으로 판정합니다.
 * @param {number} startX
 * @param {number} startY
 * @param {number} endX
 * @param {number} endY
 * @param {{minX: number, maxX: number, minY: number, maxY: number}} rect
 * @returns {boolean}
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
 * @param {number} startX
 * @param {number} startY
 * @param {number} endX
 * @param {number} endY
 * @param {object[]|null|undefined} walls
 * @param {number} [pad=0]
 * @returns {boolean}
 */
const isSegmentBlockedByCoords = (startX, startY, endX, endY, walls, pad = 0) => {
    if (!Array.isArray(walls) || walls.length === 0) return false;
    for (let i = 0; i < walls.length; i++) {
        const bounds = getRectBounds(walls[i]);
        if (!bounds) continue;
        const testRect = pad > 0 ? expandRect(bounds, pad) : bounds;
        if (segmentIntersectsRectByCoords(startX, startY, endX, endY, testRect)) return true;
    }
    return false;
};

const isSegmentBlocked = (start, end, walls, pad = 0) => {
    return isSegmentBlockedByCoords(start.x, start.y, end.x, end.y, walls, pad);
};

const toIndex = (cx, cy, cols) => (cy * cols) + cx;

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
 * @param {number} clearanceRaw
 * @returns {number}
 */
const getClearanceBucket = (clearanceRaw, profile) => Math.max(
    profile.CLEARANCE_BUCKET_STEP,
    Math.round(clearanceRaw / profile.CLEARANCE_BUCKET_STEP) * profile.CLEARANCE_BUCKET_STEP
);

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

const getNavGrid = (walls, width, height, profile, clearanceRaw) => {
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
 * @param {number} x
 * @param {number} y
 * @param {{cellSize: number, cols: number, rows: number}} grid
 * @param {{cx: number, cy: number}} out
 * @returns {{cx: number, cy: number}}
 */
const worldToCellInto = (x, y, grid, out) => {
    out.cx = clamp(Math.floor(x / grid.cellSize), 0, grid.cols - 1);
    out.cy = clamp(Math.floor(y / grid.cellSize), 0, grid.rows - 1);
    return out;
};

const isBlockedCell = (grid, cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return true;
    return grid.blocked[toIndex(cx, cy, grid.cols)] !== 0;
};

/**
 * 가장 가까운 보행 가능 셀을 찾아 출력 객체에 기록합니다.
 * @param {{cols: number, rows: number, blocked: Uint8Array}} grid
 * @param {number} cx
 * @param {number} cy
 * @param {{cx: number, cy: number}} out
 * @returns {{cx: number, cy: number}|null}
 */
const findNearestWalkableCellInto = (grid, cx, cy, out, profile) => {
    if (!isBlockedCell(grid, cx, cy)) {
        out.cx = cx;
        out.cy = cy;
        return out;
    }

    let best = null;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (let r = 1; r <= profile.NAV_NEAREST_FREE_RADIUS; r++) {
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

const getFlowField = (walls, width, height, profile, clearance, target) => {
    const nav = getNavGrid(walls, width, height, profile, clearance);
    const grid = nav.grid;
    const goalCellRaw = worldToCellInto(target.x, target.y, grid, flowFieldScratchGoalCellRaw);
    const goalCell = findNearestWalkableCellInto(
        grid,
        goalCellRaw.cx,
        goalCellRaw.cy,
        flowFieldScratchGoalCell,
        profile
    );
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
    if (flowFieldCache.size > profile.FLOW_CACHE_LIMIT) {
        const firstKey = flowFieldCache.keys().next().value;
        if (firstKey !== undefined) flowFieldCache.delete(firstKey);
    }

    return {
        key,
        grid,
        field
    };
};

/**
 * 목표 좌표 기준 flow field를 조회하거나 생성합니다.
 * @param {object[]|null|undefined} walls
 * @param {number} width
 * @param {number} height
 * @param {number} clearance
 * @param {number} targetX
 * @param {number} targetY
 * @returns {{key: string, grid: object, field: object}|null}
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
        profile
    );
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
    if (flowFieldCache.size > profile.FLOW_CACHE_LIMIT) {
        const firstKey = flowFieldCache.keys().next().value;
        if (firstKey !== undefined) flowFieldCache.delete(firstKey);
    }

    return {
        key,
        grid,
        field
    };
};

/**
 * 현재 decision tick 안에서 공용 flow field 조회 키를 구성합니다.
 * @param {number} clearance
 * @param {number} targetX
 * @param {number} targetY
 * @param {string} [policyKey='chase']
 * @returns {string}
 */
const buildSharedFlowDecisionKey = (clearance, targetX, targetY, profile, policyKey = 'chase') => (
    `${profile.KEY}|${policyKey}|${getClearanceBucket(clearance, profile)}|${Math.floor(targetX / profile.NAV_CELL_SIZE)}|${Math.floor(targetY / profile.NAV_CELL_SIZE)}`
);

/**
 * 월드 좌표를 LOS 캐시용 셀 버킷 좌표로 변환합니다.
 * @param {number} value
 * @returns {number}
 */
const getLineOfSightBucketCoord = (value, profile) => Math.floor(value / profile.NAV_CELL_SIZE);

/**
 * 현재 decision tick 안에서 공용 direct path 조회 키를 구성합니다.
 * @param {number} startX
 * @param {number} startY
 * @param {number} targetX
 * @param {number} targetY
 * @param {number} directPad
 * @param {number} wallsVersion
 * @returns {string}
 */
const buildSharedDirectPathDecisionKey = (startX, startY, targetX, targetY, directPad, profile, wallsVersion) => (
    `${profile.KEY}|${wallsVersion}|${getClearanceBucket(directPad, profile)}|${getLineOfSightBucketCoord(startX, profile)}|${getLineOfSightBucketCoord(startY, profile)}|${getLineOfSightBucketCoord(targetX, profile)}|${getLineOfSightBucketCoord(targetY, profile)}`
);

/**
 * 현재 direct path 캐시가 같은 조건에 대해 유효한지 반환합니다.
 * @param {object} state
 * @param {number} startX
 * @param {number} startY
 * @param {number} targetX
 * @param {number} targetY
 * @param {number} directPad
 * @param {number} wallsVersion
 * @returns {boolean}
 */
const hasReusableDirectPathResult = (state, startX, startY, targetX, targetY, directPad, profile, wallsVersion) => (
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
 * @param {object} state
 * @param {number} startX
 * @param {number} startY
 * @param {number} targetX
 * @param {number} targetY
 * @param {number} directPad
 * @param {number} wallsVersion
 * @param {boolean} hasDirectPath
 */
const updateDirectPathCache = (state, startX, startY, targetX, targetY, directPad, profile, wallsVersion, hasDirectPath) => {
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
 * @param {object} context
 * @param {number} startX
 * @param {number} startY
 * @param {number} targetX
 * @param {number} targetY
 * @param {object[]|null|undefined} walls
 * @param {number} directPad
 * @param {number} wallsVersion
 * @returns {boolean}
 */
const getSharedDirectPathAvailability = (
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
 * @param {object} context
 * @param {object[]|null|undefined} walls
 * @param {number} width
 * @param {number} height
 * @param {number} clearance
 * @param {number} targetX
 * @param {number} targetY
 * @param {string} [policyKey='chase']
 * @returns {{key: string, grid: object, field: object}|null}
 */
const getSharedFlowFieldForTargetCoords = (
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

/**
 * 적 타입에 대응하는 네비게이션 정책을 반환합니다.
 * @param {string|null|undefined} enemyType
 * @returns {string}
 */
const resolveEnemyAIPolicy = (enemyType) => {
    if (typeof enemyType !== 'string') {
        return ENEMY_AI_POLICY.CHASE;
    }

    return ENEMY_AI_POLICY_BY_TYPE[enemyType] ?? ENEMY_AI_POLICY.CHASE;
};

/**
 * 정책이 밀도 기반 앵커를 필요로 하는지 반환합니다.
 * @param {string} policyId
 * @returns {boolean}
 */
const requiresDensityAnchor = (policyId) => (
    policyId === ENEMY_AI_POLICY.CLUSTER_JOIN
    || policyId === ENEMY_AI_POLICY.ALLY_DENSITY_SEEK
);

/**
 * 정책 ID를 디버그 카운터 키로 변환합니다.
 * @param {string} policyId
 * @returns {string}
 */
const getEnemyAIDebugPolicyKey = (policyId) => {
    switch (policyId) {
        case ENEMY_AI_POLICY.CHARGE_CHASE:
            return 'chargeChase';
        case ENEMY_AI_POLICY.KEEP_RANGE:
            return 'keepRange';
        case ENEMY_AI_POLICY.CLUSTER_JOIN:
            return 'clusterJoin';
        case ENEMY_AI_POLICY.ALLY_DENSITY_SEEK:
            return 'allyDensitySeek';
        case ENEMY_AI_POLICY.FORMATION_FOLLOW:
            return 'formationFollow';
        case ENEMY_AI_POLICY.CHASE:
        default:
            return 'chase';
    }
};

/**
 * AI 디버그 통계 카운터를 증가시킵니다.
 * @param {object|null|undefined} stats
 * @param {string} fieldName
 * @param {number} [amount=1]
 */
const incrementEnemyAIDebugCounter = (stats, fieldName, amount = 1) => {
    if (stats?.enabled !== true || typeof fieldName !== 'string' || fieldName.length === 0) {
        return;
    }

    const safeAmount = Number.isFinite(amount) ? amount : 1;
    stats[fieldName] = (Number.isFinite(stats[fieldName]) ? stats[fieldName] : 0) + safeAmount;
};

/**
 * 정책별 실행 시간과 호출 수를 누적합니다.
 * @param {object|null|undefined} stats
 * @param {string} policyId
 * @param {number} durationMs
 */
const recordEnemyAIDebugPolicySample = (stats, policyId, durationMs) => {
    if (stats?.enabled !== true || !Number.isFinite(durationMs) || durationMs < 0) {
        return;
    }

    const policyKey = getEnemyAIDebugPolicyKey(policyId);
    if (!stats.policyCounts || typeof stats.policyCounts !== 'object') {
        stats.policyCounts = {};
    }
    if (!stats.policyMs || typeof stats.policyMs !== 'object') {
        stats.policyMs = {};
    }

    stats.policyCounts[policyKey] = (Number.isFinite(stats.policyCounts[policyKey]) ? stats.policyCounts[policyKey] : 0) + 1;
    stats.policyMs[policyKey] = (Number.isFinite(stats.policyMs[policyKey]) ? stats.policyMs[policyKey] : 0) + durationMs;
};

/**
 * 적 목록에서 공유 밀도 필드를 생성합니다.
 * @param {object[]|null|undefined} enemies
 * @param {number} width
 * @param {number} height
 * @param {string} filterType
 * @param {object} profile
 * @returns {{cols: number, rows: number, cellSize: number, counts: Uint16Array}}
 */
const buildDensityField = (enemies, width, height, filterType, profile) => {
    const densityCellSize = profile.DENSITY_CELL_SIZE;
    const cols = Math.max(2, Math.ceil(width / densityCellSize));
    const rows = Math.max(2, Math.ceil(height / densityCellSize));
    const counts = new Uint16Array(cols * rows);

    if (!Array.isArray(enemies)) {
        return { cols, rows, cellSize: densityCellSize, counts };
    }

    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        if (!enemy || enemy.active === false || !enemy.position) {
            continue;
        }

        if (filterType !== 'all' && enemy.type !== filterType) {
            continue;
        }

        const cx = clamp(Math.floor(enemy.position.x / densityCellSize), 0, cols - 1);
        const cy = clamp(Math.floor(enemy.position.y / densityCellSize), 0, rows - 1);
        const index = (cy * cols) + cx;
        counts[index] = Math.min(65535, counts[index] + 1);
    }

    return { cols, rows, cellSize: densityCellSize, counts };
};

/**
 * decision tick 동안 공유 밀도 필드를 조회하거나 생성합니다.
 * @param {object} context
 * @param {object[]|null|undefined} enemies
 * @param {number} width
 * @param {number} height
 * @param {string} filterType
 * @param {object} profile
 * @returns {{cols: number, rows: number, cellSize: number, counts: Uint16Array}}
 */
const getSharedDensityField = (context, enemies, width, height, filterType, profile) => {
    const aiDebugStats = context?.aiDebugStats ?? null;
    const sharedDensityFieldByKey = context?.sharedDensityFieldByKey instanceof Map
        ? context.sharedDensityFieldByKey
        : null;
    const densityKey = `${profile.KEY}|${filterType}|${Math.round(width)}|${Math.round(height)}|${profile.DENSITY_CELL_SIZE}`;

    if (sharedDensityFieldByKey?.has(densityKey)) {
        incrementEnemyAIDebugCounter(aiDebugStats, 'sharedDensityFieldCacheHitCount');
        return sharedDensityFieldByKey.get(densityKey);
    }

    const densityField = buildDensityField(enemies, width, height, filterType, profile);
    incrementEnemyAIDebugCounter(aiDebugStats, 'densityFieldBuildCount');
    if (sharedDensityFieldByKey) {
        sharedDensityFieldByKey.set(densityKey, densityField);
    }
    return densityField;
};

/**
 * 밀도 필드에서 현재 위치 기준으로 가장 유리한 셀 중심을 찾습니다.
 * @param {{cols: number, rows: number, cellSize: number, counts: Uint16Array}} densityField
 * @param {number} startX
 * @param {number} startY
 * @param {number} searchRadiusCells
 * @param {number} minCount
 * @param {{x: number, y: number, count: number}} out
 * @returns {{x: number, y: number, count: number}|null}
 */
const findDensityGoalInto = (densityField, startX, startY, searchRadiusCells, minCount, out) => {
    if (!densityField || !(densityField.counts instanceof Uint16Array)) {
        return null;
    }

    const originCx = clamp(Math.floor(startX / densityField.cellSize), 0, densityField.cols - 1);
    const originCy = clamp(Math.floor(startY / densityField.cellSize), 0, densityField.rows - 1);
    const radius = Math.max(1, Math.floor(searchRadiusCells));

    let bestScore = -INF;
    let found = false;
    for (let cy = Math.max(0, originCy - radius); cy <= Math.min(densityField.rows - 1, originCy + radius); cy++) {
        for (let cx = Math.max(0, originCx - radius); cx <= Math.min(densityField.cols - 1, originCx + radius); cx++) {
            const count = densityField.counts[(cy * densityField.cols) + cx];
            if (count < minCount) {
                continue;
            }

            const dx = cx - originCx;
            const dy = cy - originCy;
            const distancePenalty = (dx * dx) + (dy * dy);
            const score = (count * 12) - (distancePenalty * 1.75);
            if (score <= bestScore) {
                continue;
            }

            bestScore = score;
            found = true;
            out.x = (cx + 0.5) * densityField.cellSize;
            out.y = (cy + 0.5) * densityField.cellSize;
            out.count = count;
        }
    }

    return found ? out : null;
};

/**
 * 현재 좌표가 속한 밀도 셀의 적 수를 반환합니다.
 * @param {{cols: number, rows: number, cellSize: number, counts: Uint16Array}|null|undefined} densityField
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
const getDensityCountAtPosition = (densityField, x, y) => {
    if (!densityField || !(densityField.counts instanceof Uint16Array)) {
        return 0;
    }

    const cx = clamp(Math.floor(x / densityField.cellSize), 0, densityField.cols - 1);
    const cy = clamp(Math.floor(y / densityField.cellSize), 0, densityField.rows - 1);
    const index = (cy * densityField.cols) + cx;
    return Number.isFinite(densityField.counts[index]) ? densityField.counts[index] : 0;
};

/**
 * 정책 기반 밀도 앵커를 decision tick 동안 재사용합니다.
 * @param {object} context
 * @param {object[]|null|undefined} enemies
 * @param {number} width
 * @param {number} height
 * @param {object} profile
 * @param {string} filterType
 * @param {string} policyKey
 * @param {number} startX
 * @param {number} startY
 * @param {number} searchRadiusCells
 * @param {number} minCount
 * @param {{x: number, y: number, count: number}} out
 * @returns {{x: number, y: number, count: number}|null}
 */
const getSharedDensityGoal = (
    context,
    enemies,
    width,
    height,
    profile,
    filterType,
    policyKey,
    startX,
    startY,
    searchRadiusCells,
    minCount,
    out
) => {
    const aiDebugStats = context?.aiDebugStats ?? null;
    const sharedPolicyTargetByKey = context?.sharedPolicyTargetByKey instanceof Map
        ? context.sharedPolicyTargetByKey
        : null;
    const densityCellSize = profile.DENSITY_CELL_SIZE;
    const originCx = Math.floor(startX / densityCellSize);
    const originCy = Math.floor(startY / densityCellSize);
    const decisionKey = `${profile.KEY}|${policyKey}|${filterType}|${originCx}|${originCy}|${searchRadiusCells}|${minCount}`;

    if (sharedPolicyTargetByKey?.has(decisionKey)) {
        incrementEnemyAIDebugCounter(aiDebugStats, 'sharedPolicyTargetCacheHitCount');
        const cachedGoal = sharedPolicyTargetByKey.get(decisionKey);
        if (!cachedGoal) {
            return null;
        }

        out.x = cachedGoal.x;
        out.y = cachedGoal.y;
        out.count = cachedGoal.count;
        return out;
    }

    const densityField = getSharedDensityField(context, enemies, width, height, filterType, profile);
    const goal = findDensityGoalInto(densityField, startX, startY, searchRadiusCells, minCount, out);
    if (sharedPolicyTargetByKey) {
        sharedPolicyTargetByKey.set(
            decisionKey,
            goal ? { x: goal.x, y: goal.y, count: goal.count } : null
        );
    }
    return goal;
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
        return enemy._enemyAIState;
    }

    const currentSpeed = length(enemy.speed?.x ?? 0, enemy.speed?.y ?? 0);
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
        : Math.max(40, currentSpeed || 40);
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
        : ((((Number.isInteger(enemy?.id) ? enemy.id : 0) % 2) + 2) % 2 === 0 ? 1 : -1);
    nextState.chargeState = typeof nextState.chargeState === 'string' ? nextState.chargeState : 'idle';
    nextState.chargeCooldownRemaining = Number.isFinite(nextState.chargeCooldownRemaining)
        ? Math.max(0, nextState.chargeCooldownRemaining)
        : (0.4 + ((((Number.isInteger(enemy?.id) ? enemy.id : 0) % 7) + 7) % 7) * 0.18);
    nextState.chargeDurationRemaining = Number.isFinite(nextState.chargeDurationRemaining)
        ? Math.max(0, nextState.chargeDurationRemaining)
        : 0;
    nextState.chargeRecoverRemaining = Number.isFinite(nextState.chargeRecoverRemaining)
        ? Math.max(0, nextState.chargeRecoverRemaining)
        : 0;
    nextState.chargeTargetX = Number.isFinite(nextState.chargeTargetX) ? nextState.chargeTargetX : 0;
    nextState.chargeTargetY = Number.isFinite(nextState.chargeTargetY) ? nextState.chargeTargetY : 0;
    nextState.scratchDir = nextState.scratchDir && typeof nextState.scratchDir === 'object'
        ? nextState.scratchDir
        : { x: 1, y: 0 };
    nextState.scratchCell = nextState.scratchCell && typeof nextState.scratchCell === 'object'
        ? nextState.scratchCell
        : { cx: 0, cy: 0 };
    nextState.scratchGoalCell = nextState.scratchGoalCell && typeof nextState.scratchGoalCell === 'object'
        ? nextState.scratchGoalCell
        : { cx: 0, cy: 0 };
    nextState.scratchPolicyPoint = nextState.scratchPolicyPoint && typeof nextState.scratchPolicyPoint === 'object'
        ? nextState.scratchPolicyPoint
        : { x: 0, y: 0 };
    nextState.scratchDensityGoal = nextState.scratchDensityGoal && typeof nextState.scratchDensityGoal === 'object'
        ? nextState.scratchDensityGoal
        : { x: 0, y: 0, count: 0 };
    enemy._enemyAIState = nextState;
    return nextState;
};

/**
 * 거리 유지형 적의 목표 앵커를 계산합니다.
 * @param {object} state
 * @param {number} startX
 * @param {number} startY
 * @param {number} targetX
 * @param {number} targetY
 * @param {number} preferredRange
 * @param {number} rangeBand
 * @param {{x: number, y: number}} out
 * @returns {{x: number, y: number}}
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
 * @param {object} state
 * @param {number} stepDelta
 * @param {number} targetX
 * @param {number} targetY
 * @param {object} profile
 * @returns {boolean}
 */
const stepArrowChargeState = (state, stepDelta, targetX, targetY, profile) => {
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
 * 현재 정책에 맞는 목표 좌표와 이동 배율을 계산합니다.
 * @param {object} enemy
 * @param {object} state
 * @param {object} context
 * @param {object} profile
 * @param {number} startX
 * @param {number} startY
 * @param {number} playerX
 * @param {number} playerY
 */
const updatePolicyIntent = (enemy, state, context, profile, startX, startY, playerX, playerY) => {
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
        if (isHeavyRefresh || !Number.isFinite(state.targetX) || !Number.isFinite(state.targetY)) {
            const densityGoal = getSharedDensityGoal(
                context,
                enemies,
                simulationWW,
                simulationObjectWH,
                profile,
                'hexa',
                'cluster_join',
                startX,
                startY,
                3,
                2,
                state.scratchDensityGoal
            );
            if (densityGoal) {
                state.targetX = densityGoal.x;
                state.targetY = densityGoal.y;
            } else {
                state.targetX = playerX;
                state.targetY = playerY;
            }
        }
        state.flowPolicyKey = 'cluster_join';
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

    state.targetX = playerX;
    state.targetY = playerY;
};

/**
 * 적 AI 상태를 초기화 상태로 되돌립니다.
 * @param {object|null|undefined} enemy
 */
export function resetEnemyAIState(enemy) {
    if (!enemy) return;
    enemy._enemyAIState = null;
}

/**
 * 전투 적 AI의 고정 스텝 갱신을 수행합니다.
 * @param {object} enemy
 * @param {number} stepDelta
 * @param {object} [context={}]
 */
export function fixedUpdateEnemyAI(enemy, stepDelta, context = {}) {
    const profile = getEnemyAIProfile(context);
    const state = ensureEnemyAIState(enemy, profile);
    state.baseAccelResponse = profile.TURN_RESPONSE;
    state.policyId = resolveEnemyAIPolicy(enemy?.type);
    const aiDebugStats = context?.aiDebugStats ?? null;
    const profileStartTime = aiDebugStats?.enabled === true ? performance.now() : -1;

    const player = context.player;
    if (!player || !player.position) {
        enemy.setAcc(0, 0);
        return;
    }

    const startX = enemy.position.x;
    const startY = enemy.position.y;
    const targetX = player.position.x;
    const targetY = player.position.y;
    const walls = Array.isArray(context.walls) ? context.walls : [];
    const enemyRadius = Math.max(8, (enemy.getRenderHeightPx?.() || 24) * 0.45);
    const directPad = enemyRadius * profile.NAV_DIRECT_CHECK_PAD_RATIO;
    const scratchDir = state.scratchDir;
    const scratchCell = state.scratchCell;
    const wallsVersion = Number.isInteger(context?.wallsVersion) ? context.wallsVersion : 0;
    const forcedPolicyRefresh = stepArrowChargeState(state, stepDelta, targetX, targetY, profile);
    const shouldRefreshDecision = context.shouldUpdateDecision === true
        || forcedPolicyRefresh
        || !Number.isFinite(state.targetX)
        || !Number.isFinite(state.targetY);

    if (shouldRefreshDecision || !requiresDensityAnchor(state.policyId)) {
        updatePolicyIntent(enemy, state, context, profile, startX, startY, targetX, targetY);
        state.lastDecisionGroup = Number.isInteger(context?.decisionGroup) ? context.decisionGroup : -1;
    }
    if (shouldRefreshDecision) {
        incrementEnemyAIDebugCounter(aiDebugStats, 'heavyDecisionCount');
    }

    let hasDirection = false;
    const canReuseDirectPath = hasReusableDirectPathResult(
        state,
        startX,
        startY,
        state.targetX,
        state.targetY,
        directPad,
        profile,
        wallsVersion
    );
    if (canReuseDirectPath) {
        incrementEnemyAIDebugCounter(aiDebugStats, 'localDirectPathReuseCount');
    }
    const hasDirectPath = canReuseDirectPath
        ? state.lastDirectPath === true
        : getSharedDirectPathAvailability(
            context,
            startX,
            startY,
            state.targetX,
            state.targetY,
            walls,
            directPad,
            profile,
            wallsVersion
        );
    if (!canReuseDirectPath) {
        updateDirectPathCache(
            state,
            startX,
            startY,
            state.targetX,
            state.targetY,
            directPad,
            profile,
            wallsVersion,
            hasDirectPath
        );
    }

    if (hasDirectPath) {
        normalizeInto(state.targetX - startX, state.targetY - startY, scratchDir);
        state.flowData = null;
        state.flowKey = '';
        hasDirection = true;
    } else {
        if (context.shouldUpdateDecision === true || forcedPolicyRefresh || !state.flowData) {
            incrementEnemyAIDebugCounter(aiDebugStats, 'flowRefreshCount');
            const flow = getSharedFlowFieldForTargetCoords(
                context,
                walls,
                getSimulationWW(),
                getSimulationObjectWH(),
                profile,
                enemyRadius,
                state.targetX,
                state.targetY,
                state.flowPolicyKey
            );
            if (flow) {
                state.flowData = flow;
                state.flowKey = flow.key;
                state.lastTargetCellX = Math.floor(state.targetX / profile.NAV_CELL_SIZE);
                state.lastTargetCellY = Math.floor(state.targetY / profile.NAV_CELL_SIZE);
            } else {
                state.flowData = null;
                state.flowKey = '';
            }
        }

        if (state.flowData) {
            const grid = state.flowData.grid;
            const field = state.flowData.field;
            const cellRaw = worldToCellInto(startX, startY, grid, scratchCell);
            const cell = isBlockedCell(grid, cellRaw.cx, cellRaw.cy)
                ? findNearestWalkableCellInto(grid, cellRaw.cx, cellRaw.cy, state.scratchGoalCell, profile)
                : cellRaw;

            if (cell) {
                const idx = toIndex(cell.cx, cell.cy, grid.cols);
                const fx = field.dirX[idx];
                const fy = field.dirY[idx];
                if (Math.abs(fx) > EPSILON || Math.abs(fy) > EPSILON) {
                    scratchDir.x = fx;
                    scratchDir.y = fy;
                    hasDirection = true;
                }
            }
        }

        if (!hasDirection) {
            normalizeInto(state.targetX - startX, state.targetY - startY, scratchDir);
            hasDirection = true;
        }
    }

    state.dirX = scratchDir.x;
    state.dirY = scratchDir.y;

    const desiredVx = state.dirX * state.desiredSpeed;
    const desiredVy = state.dirY * state.desiredSpeed;
    enemy.setAcc(desiredVx - enemy.speed.x, desiredVy - enemy.speed.y);
    enemy.accSpeed = state.accelResponse;

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
